//! macOS owns delivery, including while Jottr is closed. A single worker reconciles SQLite
//! with Notification Center; ticket commands only wake it, never wait on the native API.

use std::collections::HashSet;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now, Db};
use crate::store::{self, err, CmdResult, ReminderTicket};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as native;

const PREFIX: &str = "due:";
/// macOS keeps only the soonest 64 pending requests per app and drops the rest, which each
/// sync would then add again. Later tickets are scheduled as these fire.
const MAX_PENDING: usize = 60;
pub const OPEN_EVENT: &str = "notification-open-ticket";
const STATUS_EVENT: &str = "notification-status-changed";

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    NotDetermined,
    Denied,
    Granted,
    Unavailable,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    pub permission: Permission,
    pub error: Option<String>,
}

enum Work {
    Sync,
    Focus,
}

#[derive(Default)]
pub struct Notifications {
    worker: Mutex<Option<mpsc::Sender<Work>>>,
    open_ticket: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
}

/// Plugin setup runs before the event loop starts, so a cold-launch notification response
/// cannot arrive before the delegate and its pending-ticket mailbox exist.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("due-reminders")
        .setup(|app, _| {
            app.manage(Notifications::default());
            native::install_delegate(app);
            Ok(())
        })
        .build()
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = mpsc::channel();
    *app.state::<Notifications>().worker.lock().unwrap() = Some(tx);
    let worker_app = app.clone();
    std::thread::spawn(move || {
        let app = &worker_app;
        // With reminders off, wait for the next change instead of checking every minute.
        let mut poll = true;
        let mut cleared = false;
        loop {
            let first = if poll {
                match rx.recv_timeout(Duration::from_secs(60)) {
                    Ok(work) => Some(work),
                    Err(mpsc::RecvTimeoutError::Timeout) => None,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            } else {
                match rx.recv() {
                    Ok(work) => Some(work),
                    Err(_) => break,
                }
            };
            // One sync covers everything queued. Each change wakes the worker straight away, so
            // there's nothing left to flush at quit.
            let focused = first
                .into_iter()
                .chain(rx.try_iter())
                .fold(false, |focused, work| focused | matches!(work, Work::Focus));
            let result = native::with_pool(|| reconcile(app, &mut cleared));
            poll = *result.as_ref().unwrap_or(&true);
            report(app, result.err());
            // Permission can change in System Settings while WebKit's document visibility doesn't.
            if focused {
                let _ = app.emit_to("main", STATUS_EVENT, ());
            }
        }
    });
    refresh(app);
}

fn report(app: &AppHandle, error: Option<String>) {
    let state = app.state::<Notifications>();
    if let Ok(mut previous) = state.error.lock() {
        if *previous != error {
            if let Some(error) = &error {
                eprintln!("due reminders: {error}");
            }
            *previous = error;
        }
    };
}

pub fn refresh(app: &AppHandle) {
    send(app, Work::Sync);
}

/// The main window came forward: sync, and let Settings recheck the permission.
pub fn focused(app: &AppHandle) {
    send(app, Work::Focus);
}

fn send(app: &AppHandle, work: Work) {
    if let Some(state) = app.try_state::<Notifications>() {
        if let Ok(worker) = state.worker.lock() {
            if let Some(worker) = worker.as_ref() {
                let _ = worker.send(work);
            }
        }
    }
}

pub fn after_change<T>(app: &AppHandle, result: CmdResult<T>) -> CmdResult<T> {
    if result.is_ok() {
        refresh(app);
    }
    result
}

pub async fn status(app: AppHandle) -> CmdResult<NotificationStatus> {
    let permission = tauri::async_runtime::spawn_blocking(|| native::with_pool(native::permission))
        .await
        .map_err(err)??;
    let error = app.state::<Notifications>().error.lock().map_err(err)?.clone();
    Ok(NotificationStatus { permission, error })
}

pub async fn request_permission() -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(|| native::with_pool(native::request_permission))
        .await
        .map_err(err)?
}

pub fn take_ticket(app: &AppHandle) -> CmdResult<Option<String>> {
    Ok(app.state::<Notifications>().open_ticket.lock().map_err(err)?.take())
}

fn open_ticket(app: &AppHandle, identifier: &str) {
    let Some((id, _date)) = identifier.strip_prefix(PREFIX).and_then(|s| s.split_once(':')) else {
        return;
    };
    if uuid::Uuid::parse_str(id).is_err() {
        return;
    }
    if let Ok(mut pending) = app.state::<Notifications>().open_ticket.lock() {
        *pending = Some(id.to_owned());
    }
    // Queue first, then emit. React subscribes before draining, so neither cold nor warm
    // launches lose the click, and an event racing the initial drain cannot open it twice.
    let _ = app.emit_to("main", OPEN_EVENT, ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn identifier(id: &str, date: &str) -> String {
    format!("{PREFIX}{id}:{date}")
}

/// Already elapsed schedules are never replayed, even after dismissal or a time change.
/// A date set to today after the chosen time gets one immediate reminder; older dates don't.
fn schedule_time(date: &str, today: &str, due_at: i64, previous: Option<i64>, current: i64) -> Option<i64> {
    if date < today || previous.is_some_and(|time| time <= current) {
        return None;
    }
    Some(due_at.max(current))
}

/// The tickets to keep scheduled: ones due today or later that haven't reminded yet, soonest
/// first, up to what macOS will hold. `tickets` is in due date order.
fn upcoming<'a>(tickets: &'a [ReminderTicket], today: &str, delivered: &HashSet<String>) -> Vec<&'a ReminderTicket> {
    tickets
        .iter()
        .filter(|t| t.due_date.as_str() >= today && !delivered.contains(&identifier(&t.id, &t.due_date)))
        .take(MAX_PENDING)
        .collect()
}

/// Returns whether reminders are on, so the worker knows whether to keep checking each minute.
/// `cleared` remembers that nothing is left to remove while they're off.
fn reconcile(app: &AppHandle, cleared: &mut bool) -> CmdResult<bool> {
    let db = app.state::<Db>();
    let (settings, tickets, schedules) = {
        let conn = db.0.lock().map_err(err)?;
        (
            store::get_settings(&conn)?,
            store::reminder_tickets(&conn)?,
            store::reminder_schedules(&conn)?,
        )
    };
    if !settings.due_reminders && *cleared {
        return Ok(false);
    }
    let permission = native::permission()?;
    // Settings explains that reminders need the packaged app.
    if permission == Permission::Unavailable {
        *cleared = true;
        return Ok(false);
    }
    let enabled = settings.due_reminders && permission == Permission::Granted;
    let current = now();
    let today = native::today();
    // Older versions only checked the date's shape. Don't normalize impossible dates
    // (e.g. February 31) into a reminder on a different day.
    let tickets: Vec<_> = tickets
        .into_iter()
        .filter(|t| enabled && store::is_valid_date(&t.due_date))
        .collect();
    let pending = native::pending()?;
    let delivered: HashSet<_> = native::delivered()?.into_iter().collect();
    // Delivered reminders stay until their ticket is finished, even after the due date.
    let shown: HashSet<_> = tickets.iter().map(|t| identifier(&t.id, &t.due_date)).collect();
    let upcoming = upcoming(&tickets, &today, &delivered);
    let scheduled: HashSet<_> = upcoming.iter().map(|t| identifier(&t.id, &t.due_date)).collect();
    let obsolete: Vec<_> = pending
        .keys()
        .filter(|id| !scheduled.contains(*id))
        .chain(delivered.iter().filter(|id| !shown.contains(*id)))
        .filter(|id| id.starts_with(PREFIX))
        .cloned()
        .collect();
    native::remove(&obsolete)?;
    {
        let conn = db.0.lock().map_err(err)?;
        for ((id, date), time) in &schedules {
            if *time > current && !scheduled.contains(&identifier(id, date)) {
                store::forget_reminder_schedule(&conn, id, date)?;
            }
        }
    }
    *cleared = !settings.due_reminders;
    if !enabled {
        return Ok(settings.due_reminders);
    }
    // Keep going after a failure, so one bad request can't hold up every later ticket.
    let mut failure = None;
    for ticket in upcoming {
        let id = identifier(&ticket.id, &ticket.due_date);
        let previous = schedules.get(&(ticket.id.clone(), ticket.due_date.clone())).copied();
        let due_at = match native::due_at(&ticket.due_date, &settings.reminder_time) {
            Ok(time) => time,
            Err(error) => {
                failure.get_or_insert(error);
                continue;
            }
        };
        // Re-read the clock for each request: a large catch-up batch must not schedule
        // its later notifications at a time which passed while macOS accepted the first.
        let current = now();
        let Some(time) = schedule_time(&ticket.due_date, &today, due_at, previous, current) else {
            continue;
        };
        let title = ticket
            .key
            .as_ref()
            .map_or_else(|| "Due today".into(), |key| format!("{key} · Due today"));
        if previous == Some(time)
            && pending
                .get(&id)
                .is_some_and(|p| p == &(title.clone(), ticket.title.clone()))
        {
            continue;
        }
        // A calendar trigger that has passed by the time macOS adds it never fires, so anything
        // due within a couple of seconds is delivered now instead.
        let at = (time > current + 2_000).then_some(time);
        // Persist intent first. A crash can retry a future request with the same identifier,
        // but must never replay one whose delivery time has already passed.
        let recorded = at.unwrap_or(current);
        store::save_reminder_schedule(&*db.0.lock().map_err(err)?, &ticket.id, &ticket.due_date, recorded)?;
        if let Err(error) = native::schedule(&id, &title, &ticket.title, at) {
            store::forget_reminder_schedule(&*db.0.lock().map_err(err)?, &ticket.id, &ticket.due_date)?;
            failure.get_or_insert(error);
        }
    }
    failure.map_or(Ok(true), Err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedules_once_and_only_on_the_due_date() {
        let today = "2026-10-26";
        assert_eq!(schedule_time(today, today, 200, None, 100), Some(200));
        assert_eq!(schedule_time(today, today, 50, None, 100), Some(100), "a missed time today reminds now");
        assert_eq!(schedule_time("2026-10-25", today, 50, None, 100), None);
        assert_eq!(
            schedule_time(today, today, 300, Some(50), 100),
            None,
            "moving the time later can't repeat a reminder"
        );
        assert_eq!(schedule_time(today, today, 300, Some(200), 100), Some(300));
        assert_eq!(schedule_time(today, today, 300, Some(100), 100), None);
        assert_eq!(
            schedule_time(today, today, 50, Some(30_000), 100),
            Some(100),
            "moving the time into the past catches up today"
        );
    }

    #[test]
    fn schedules_only_the_soonest_reminders_macos_keeps() {
        let ticket = |n: usize, date: &str| ReminderTicket {
            id: format!("t{n:03}"),
            due_date: date.into(),
            title: String::new(),
            key: None,
        };
        let mut tickets = vec![ticket(0, "2026-10-25"), ticket(1, "2026-10-26")];
        tickets.extend((2..80).map(|n| ticket(n, "2026-11-01")));
        let delivered = HashSet::from([identifier("t001", "2026-10-26")]);
        let ids: Vec<_> = upcoming(&tickets, "2026-10-26", &delivered).iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids.len(), MAX_PENDING);
        assert_eq!((ids[0], ids[MAX_PENDING - 1]), ("t002", "t061"), "past and delivered reminders don't take a slot");
    }
}
