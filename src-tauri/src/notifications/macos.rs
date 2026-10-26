use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::{DynBlock, RcBlock};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{
    NSArray, NSBundle, NSCalendar, NSCalendarIdentifierGregorian, NSCalendarUnit, NSDate, NSDateComponents, NSError,
    NSObject, NSObjectProtocol, NSString, NSTimeZone,
};
use objc2_user_notifications::*;
use tauri::{AppHandle, Manager};

use super::Permission;
use crate::store::{err, CmdResult};

pub fn with_pool<T>(f: impl FnOnce() -> T) -> T {
    autoreleasepool(|_| f())
}

fn center() -> CmdResult<Retained<UNUserNotificationCenter>> {
    // currentNotificationCenter raises an Objective-C exception in an unbundled executable
    // (tauri dev and cargo test). Check before calling it, rather than crashing the app.
    let bundle = NSBundle::mainBundle();
    if bundle.bundleIdentifier().is_none() || !bundle.bundlePath().to_string().ends_with(".app") {
        return Err(
            "Due reminders are available in the packaged Jottr.app. Build and open the app to enable them.".into(),
        );
    }
    Ok(UNUserNotificationCenter::currentNotificationCenter())
}

define_class!(
    // NSObject has no subclassing requirements. The only ivar is a thread-safe AppHandle;
    // Notification Center may call these methods on its own queue.
    #[unsafe(super = NSObject)]
    #[thread_kind = AnyThread]
    #[ivars = AppHandle]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            if response
                .actionIdentifier()
                .isEqualToString(unsafe { UNNotificationDefaultActionIdentifier })
            {
                super::open_ticket(
                    self.ivars(),
                    &response.notification().request().identifier().to_string(),
                );
            }
            completion.call(());
        }
    }
);

// All access to the AppHandle is thread-safe, and there are no other mutable ivars.
unsafe impl Send for NotificationDelegate {}
unsafe impl Sync for NotificationDelegate {}

pub fn install_delegate(app: &AppHandle) {
    if let Ok(center) = center() {
        let delegate = NotificationDelegate::alloc().set_ivars(app.clone());
        // SAFETY: NSObject's init initializes the allocated subclass; ivars are already set.
        let delegate: Retained<NotificationDelegate> = unsafe { msg_send![super(delegate), init] };
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The system's delegate property is weak. Keep this one alive for the app's lifetime.
        app.manage(delegate);
    }
}

pub fn permission() -> CmdResult<Permission> {
    let Ok(center) = center() else {
        return Ok(Permission::Unavailable);
    };
    let (tx, rx) = mpsc::channel();
    center.getNotificationSettingsWithCompletionHandler(&RcBlock::new(
        move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: Apple supplies a live settings object for the callback's duration.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let permission = match status {
                UNAuthorizationStatus::NotDetermined => Permission::NotDetermined,
                UNAuthorizationStatus::Denied => Permission::Denied,
                _ => Permission::Granted,
            };
            let _ = tx.send(permission);
        },
    ));
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "macOS didn't return notification permissions.".into())
}

pub fn request_permission() -> CmdResult<()> {
    match permission()? {
        Permission::Granted => return Ok(()),
        Permission::Denied => {
            return Err(
                "Allow notifications for Jottr in System Settings → Notifications, then enable due reminders.".into(),
            )
        }
        Permission::NotDetermined | Permission::Unavailable => {}
    }
    let center = center()?;
    let (tx, rx) = mpsc::channel();
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &RcBlock::new(move |granted: Bool, error: *mut NSError| {
            let result = if !error.is_null() {
                // SAFETY: Apple keeps the error alive until this callback returns.
                Err(unsafe { &*error }.localizedDescription().to_string())
            } else if granted.as_bool() {
                Ok(())
            } else {
                Err(
                    "Allow notifications for Jottr in System Settings → Notifications, then enable due reminders."
                        .into(),
                )
            };
            let _ = tx.send(result);
        }),
    );
    rx.recv_timeout(Duration::from_secs(120)).map_err(|_| {
        "macOS didn't confirm notification permission. Check System Settings → Notifications, then try again."
            .to_string()
    })?
}

fn calendar() -> Retained<NSCalendar> {
    // Due dates are Gregorian YYYY-MM-DD regardless of the user's display calendar.
    let calendar = unsafe { NSCalendar::calendarWithIdentifier(NSCalendarIdentifierGregorian) }.unwrap();
    calendar.setTimeZone(&NSTimeZone::localTimeZone());
    calendar
}

const COMPONENTS: NSCalendarUnit = NSCalendarUnit::Year
    .union(NSCalendarUnit::Month)
    .union(NSCalendarUnit::Day)
    .union(NSCalendarUnit::Hour)
    .union(NSCalendarUnit::Minute)
    .union(NSCalendarUnit::Second);

pub fn today() -> String {
    let date = calendar().components_fromDate(COMPONENTS, &NSDate::date());
    format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day())
}

pub fn due_at(date: &str, time: &str) -> CmdResult<i64> {
    if !crate::store::is_valid_date(date) || !crate::store::is_valid_time(time) {
        return Err("Invalid reminder date or time.".into());
    }
    let parts = NSDateComponents::new();
    parts.setYear(date[..4].parse().map_err(err)?);
    parts.setMonth(date[5..7].parse().map_err(err)?);
    parts.setDay(date[8..].parse().map_err(err)?);
    parts.setHour(time[..2].parse().map_err(err)?);
    parts.setMinute(time[3..].parse().map_err(err)?);
    parts.setSecond(0);
    calendar()
        .dateFromComponents(&parts)
        .map(|date| (date.timeIntervalSince1970() * 1_000.0) as i64)
        .ok_or_else(|| "Couldn't schedule that reminder time.".into())
}

pub fn pending() -> CmdResult<HashMap<String, (String, String)>> {
    let (tx, rx) = mpsc::channel();
    center()?.getPendingNotificationRequestsWithCompletionHandler(&RcBlock::new(
        move |requests: NonNull<NSArray<UNNotificationRequest>>| {
            // SAFETY: The array and its requests are valid throughout this callback.
            let requests = unsafe { requests.as_ref() };
            let values = requests
                .iter()
                .map(|r| {
                    (
                        r.identifier().to_string(),
                        (r.content().title().to_string(), r.content().body().to_string()),
                    )
                })
                .collect();
            let _ = tx.send(values);
        },
    ));
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Couldn't read scheduled notifications from macOS.".into())
}

pub fn delivered() -> CmdResult<Vec<String>> {
    let (tx, rx) = mpsc::channel();
    center()?.getDeliveredNotificationsWithCompletionHandler(&RcBlock::new(
        move |notifications: NonNull<NSArray<UNNotification>>| {
            // SAFETY: Apple owns the array for this callback's duration.
            let values = unsafe { notifications.as_ref() }
                .iter()
                .map(|n| n.request().identifier().to_string())
                .collect();
            let _ = tx.send(values);
        },
    ));
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Couldn't read delivered notifications from macOS.".into())
}

pub fn remove(identifiers: &[String]) -> CmdResult<()> {
    if identifiers.is_empty() {
        return Ok(());
    }
    let center = center()?;
    let identifiers =
        NSArray::from_retained_slice(&identifiers.iter().map(|id| NSString::from_str(id)).collect::<Vec<_>>());
    center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
    center.removeDeliveredNotificationsWithIdentifiers(&identifiers);
    Ok(())
}

/// Delivers at `time`, or right away when it's `None`.
pub fn schedule(identifier: &str, title: &str, body: &str, time: Option<i64>) -> CmdResult<()> {
    let center = center()?;
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let trigger = time.map(|time| {
        let calendar = calendar();
        let components = calendar.components_fromDate(
            COMPONENTS,
            &NSDate::dateWithTimeIntervalSince1970(time as f64 / 1_000.0),
        );
        components.setCalendar(Some(&calendar));
        UNCalendarNotificationTrigger::triggerWithDateMatchingComponents_repeats(&components, false)
    });
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(identifier),
        &content,
        trigger.as_deref().map(|trigger| -> &UNNotificationTrigger { trigger }),
    );
    let (tx, rx) = mpsc::channel();
    center.addNotificationRequest_withCompletionHandler(
        &request,
        Some(&RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            }
            // SAFETY: An error, when present, is valid until the completion handler returns.
            else {
                Err(unsafe { &*error }.localizedDescription().to_string())
            };
            let _ = tx.send(result);
        })),
    );
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "macOS didn't confirm the scheduled reminder.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_calendar_dates_without_starting_notification_center() {
        with_pool(|| {
            assert!(due_at("2026-02-30", "09:00").is_err());
            assert!(due_at("2026-10-26", "24:00").is_err());
            let time = due_at("2026-10-26", "09:15").unwrap();
            let parts = calendar().components_fromDate(
                COMPONENTS,
                &NSDate::dateWithTimeIntervalSince1970(time as f64 / 1_000.0),
            );
            assert_eq!(
                (parts.year(), parts.month(), parts.day(), parts.hour(), parts.minute()),
                (2026, 10, 26, 9, 15)
            );
        });
    }
}
