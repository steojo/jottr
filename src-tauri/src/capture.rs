//! Quick capture: a global shortcut opens a small box over whatever app is in front, and Enter
//! adds a ticket to the bottom of the Inbox. The box is the `capture` window in
//! `tauri.conf.json`, created hidden at launch so it shows instantly.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, LogicalPosition, Manager, WebviewWindow, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::models::Settings;
use crate::store::{err, CmdResult};

/// The capture window's label in `tauri.conf.json`.
pub const LABEL: &str = "capture";

/// Sent to the main window with each captured ticket, so the Inbox shows it at once.
pub const CAPTURED_EVENT: &str = "ticket-captured";

/// Quick capture is the only global shortcut, so the handler needn't check which one fired.
pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _, event| {
            if event.state() == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .build()
}

/// Turns the capture window into a panel and registers the shortcut. Failures are logged rather
/// than stopping launch, since the rest of Jottr works without quick capture.
pub fn setup(app: &AppHandle, settings: &Settings) {
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(e) = panel::convert(&window) {
            eprintln!("quick capture panel failed: {e}");
        }
    }
    if let Err(e) = register(app, settings) {
        eprintln!("quick capture shortcut failed: {e}");
    }
}

/// Reads a shortcut such as `Alt+Space`. It needs ⌘, ⌃ or ⌥, so it can't take over typing in
/// every other app.
pub fn parse_shortcut(text: &str) -> CmdResult<Shortcut> {
    let shortcut: Shortcut = text.parse().map_err(|_| format!("“{text}” isn't a shortcut"))?;
    if !shortcut.mods.intersects(Modifiers::SUPER | Modifiers::CONTROL | Modifiers::ALT) {
        return Err("The shortcut needs ⌘, ⌃ or ⌥".into());
    }
    Ok(shortcut)
}

/// Registers the shortcut `settings` asks for in place of any other, or none when quick capture
/// is off.
pub fn register(app: &AppHandle, settings: &Settings) -> CmdResult<()> {
    let shortcut = parse_shortcut(&settings.capture_shortcut)?;
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(err)?;
    if settings.quick_capture {
        shortcuts.register(shortcut).map_err(|e| format!("Couldn't use that shortcut: {e}"))?;
    }
    Ok(())
}

/// Shows the box over whatever app is in front, or hides it if it's showing.
pub fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    if let Err(e) = place(app, &window) {
        eprintln!("couldn't place quick capture: {e}");
    }
    // As a panel it takes typing without activating Jottr, so the app you were in stays in front.
    let _ = window.show();
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// Centres the box near the top of the screen the pointer is on, like Spotlight.
fn place(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let cursor = app.cursor_position()?;
    let Some(monitor) = app.monitor_from_point(cursor.x, cursor.y)?.or(app.primary_monitor()?) else {
        return Ok(());
    };
    // Work in points: each monitor's physical pixels use its own scale.
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (left, top) = (f64::from(area.position.x) / scale, f64::from(area.position.y) / scale);
    let (width, height) = (f64::from(area.size.width) / scale, f64::from(area.size.height) / scale);
    let size = window.outer_size()?.to_logical::<f64>(window.scale_factor()?);
    window.set_position(LogicalPosition::new(left + (width - size.width) / 2.0, top + height / 5.0))
}

#[cfg(target_os = "macos")]
mod panel {
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder};
    use objc2::ClassType;
    use objc2_app_kit::{NSPanel, NSWindowButton, NSWindowCollectionBehavior, NSWindowStyleMask};
    use tauri::WebviewWindow;

    /// `NSPanel` plus the `focusable` ivar tao's window class adds, so swapping a tao window to
    /// this class keeps its layout.
    fn class() -> &'static AnyClass {
        static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
        CLASS.get_or_init(|| {
            let mut builder =
                ClassBuilder::new(c"JottrCapturePanel", NSPanel::class()).expect("JottrCapturePanel already exists");
            builder.add_ivar::<Bool>(c"focusable");
            builder.register()
        })
    }

    /// Makes the window a non-activating panel: it takes typing without bringing Jottr to the
    /// front, and floats over every Space, full-screen apps included.
    pub fn convert(window: &WebviewWindow) -> Result<(), String> {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
        // SAFETY: `ns_window` is tao's live NSWindow subclass, and we're on the main thread
        // (`setup`). Its class is only swapped when the panel class has the same instance size,
        // and tao only reaches the window through NSWindow methods and the `focusable` ivar.
        unsafe {
            let object = &*ns_window;
            if object.class().instance_size() != class().instance_size() {
                return Err(format!("{} has a different layout to NSPanel", object.class().name().to_string_lossy()));
            }
            AnyObject::set_class(object, class());
            let panel = &*(ns_window as *const NSPanel);
            panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
            panel.setCollectionBehavior(
                panel.collectionBehavior()
                    | NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );
            // The title bar stays for its rounded corners and shadow, without the traffic lights.
            for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
                if let Some(button) = panel.standardWindowButton(kind) {
                    button.setHidden(true);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_need_a_modifier() {
        assert!(parse_shortcut("Alt+Space").is_ok());
        assert!(parse_shortcut("Super+Shift+KeyJ").is_ok());
        assert!(parse_shortcut("Control+Digit1").is_ok());
        assert!(parse_shortcut("Space").is_err(), "would take over the space bar everywhere");
        assert!(parse_shortcut("Shift+KeyJ").is_err(), "would take over capital J");
        assert!(parse_shortcut("Alt+Nope").is_err());
        assert!(parse_shortcut("").is_err());
    }
}
