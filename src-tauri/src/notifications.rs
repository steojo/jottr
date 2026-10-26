//! macOS owns delivery, including while Jottr is closed. A single worker reconciles SQLite
//! with Notification Center; ticket commands only wake it, never wait on the native API.

use std::collections::HashSet;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now, Db};
use crate::store::{self, err, CmdResult};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as native;

const PREFIX: &str = "due:";
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
    Flush(mpsc::Sender<()>),
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
        .on_event(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                // Finish edits before quit, otherwise an old reminder could survive a completed
                // ticket. Native completion callbacks run off the main thread.
                let (tx, rx) = mpsc::channel();
                let sent = app
                    .state::<Notifications>()
                    .worker
                    .lock()
                    .ok()
                    .and_then(|worker| worker.as_ref().map(|worker| worker.send(Work::Flush(tx)).is_ok()))
                    .unwrap_or(false);
                if sent {
                    let _ = rx.recv_timeout(Duration::from_secs(8));
                }
            }
        })
        .build()
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = mpsc::channel();
    *app.state::<Notifications>().worker.lock().unwrap() = Some(tx);
    let worker_app = app.clone();
    std::thread::spawn(move || loop {
        let app = &worker_app;
        let first = match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(work) => Some(work),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let mut flushes = Vec::new();
        for work in first.into_iter().chain(rx.try_iter()) {
            if let Work::Flush(ack) = work {
                flushes.push(ack);
            }
        }
        let result = native::with_pool(|| reconcile(app));
        let error = result.err();
        let state = app.state::<Notifications>();
        if let Ok(mut previous) = state.error.lock() {
            if *previous != error {
                if let Some(error) = &error {
                    eprintln!("due reminders: {error}");
                }
                *previous = error;
            }
        }
        // A native focus event also wakes this worker. Refresh permission changes made in
        // System Settings even when WebKit's document visibility hasn't changed.
        let _ = app.emit_to("main", STATUS_EVENT, ());
        for ack in flushes {
            let _ = ack.send(());
        }
    });
    refresh(app);
}

pub fn refresh(app: &AppHandle) {
    if let Some(state) = app.try_state::<Notifications>() {
        if let Ok(worker) = state.worker.lock() {
            if let Some(worker) = worker.as_ref() {
                let _ = worker.send(Work::Sync);
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
    if due_at > current {
        Some(due_at)
    } else {
        // Calendar triggers have second precision. Keep the ledger on that same boundary.
        let soon = (current / 1_000 + 2) * 1_000;
        Some(previous.filter(|time| *time > current && *time <= soon).unwrap_or(soon))
    }
}

fn reconcile(app: &AppHandle) -> CmdResult<()> {
    let db = app.state::<Db>();
    let (settings, tickets, schedules) = {
        let conn = db.0.lock().map_err(err)?;
        (
            store::get_settings(&conn)?,
            store::reminder_tickets(&conn)?,
            store::reminder_schedules(&conn)?,
        )
    };
    let permission = native::permission()?;
    if permission == Permission::Unavailable {
        return if settings.due_reminders {
            Err("Due reminders need the packaged Jottr.app.".into())
        } else {
            Ok(())
        };
    }
    let enabled = settings.due_reminders && permission == Permission::Granted;
    let current = now();
    let today = native::today();
    let active: HashSet<_> = tickets
        .iter()
        .filter(|_| enabled)
        .map(|t| identifier(&t.id, &t.due_date))
        .collect();
    let pending = native::pending()?;
    let delivered: HashSet<_> = native::delivered()?.into_iter().collect();
    let obsolete: Vec<_> = pending
        .keys()
        .chain(delivered.iter())
        .filter(|id| id.starts_with(PREFIX) && !active.contains(*id))
        .cloned()
        .collect();
    native::remove(&obsolete)?;
    {
        let conn = db.0.lock().map_err(err)?;
        for ((id, date), time) in &schedules {
            if *time > current && !active.contains(&identifier(id, date)) {
                store::forget_reminder_schedule(&conn, id, date)?;
            }
        }
    }
    if !enabled {
        return Ok(());
    }
    for ticket in tickets {
        // Older versions only checked the date's shape. Don't normalize impossible dates
        // (e.g. February 31) into a reminder on a different day.
        if !store::is_valid_date(&ticket.due_date) {
            continue;
        }
        let id = identifier(&ticket.id, &ticket.due_date);
        if delivered.contains(&id) {
            continue;
        }
        let previous = schedules.get(&(ticket.id.clone(), ticket.due_date.clone())).copied();
        let due_at = native::due_at(&ticket.due_date, &settings.reminder_time)?;
        // Re-read the clock for each request: a large catch-up batch must not schedule
        // its later notifications at a time which passed while macOS accepted the first.
        let Some(time) = schedule_time(&ticket.due_date, &today, due_at, previous, now()) else {
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
        // Persist intent first. A crash can retry a future request with the same identifier,
        // but must never replay one whose delivery time has already passed.
        store::save_reminder_schedule(&*db.0.lock().map_err(err)?, &ticket.id, &ticket.due_date, time)?;
        if let Err(error) = native::schedule(&id, &title, &ticket.title, time) {
            store::forget_reminder_schedule(&*db.0.lock().map_err(err)?, &ticket.id, &ticket.due_date)?;
            return Err(error);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedules_once_and_only_on_the_due_date() {
        let today = "2026-10-26";
        assert_eq!(schedule_time(today, today, 200, None, 100), Some(200));
        assert_eq!(schedule_time(today, today, 50, None, 100), Some(2_000));
        assert_eq!(schedule_time("2026-10-25", today, 50, None, 100), None);
        assert_eq!(
            schedule_time(today, today, 300, Some(50), 100),
            None,
            "moving the time later can't repeat a reminder"
        );
        assert_eq!(
            schedule_time(today, today, 50, Some(200), 100),
            Some(200),
            "an immediate reminder must not slide on each sync"
        );
        assert_eq!(schedule_time(today, today, 300, Some(200), 100), Some(300));
        assert_eq!(schedule_time(today, today, 300, Some(100), 100), None);
        assert_eq!(
            schedule_time(today, today, 50, Some(30_000), 100),
            Some(2_000),
            "moving the time into the past catches up today"
        );
    }
}
