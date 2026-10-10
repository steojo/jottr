mod commands;
mod db;
mod models;
mod store;

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        // Command errors reject the promise instead of returning a Result object.
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            commands::list_boards,
            commands::create_board,
            commands::list_projects,
            commands::create_project,
            commands::rename_project,
            commands::delete_project,
            commands::get_notes,
            commands::set_notes,
            commands::list_labels,
            commands::create_label,
            commands::update_label,
            commands::delete_label,
            commands::set_ticket_label,
            commands::list_tickets,
            commands::search_tickets,
            commands::list_focus,
            commands::get_ticket,
            commands::create_ticket,
            commands::create_tickets,
            commands::update_ticket,
            commands::move_ticket,
            commands::reposition_ticket,
            commands::delete_ticket,
            commands::set_due_date,
            commands::list_checklist,
            commands::add_checklist_item,
            commands::update_checklist_item,
            commands::delete_checklist_item,
            commands::list_archived,
            commands::auto_archive,
            commands::restore_ticket,
            commands::get_settings,
            commands::update_settings,
            commands::list_attachments,
            commands::add_attachments,
            commands::add_attachment_data,
            commands::delete_attachment,
            commands::open_attachment,
        ])
}

/// Writes `src/bindings.ts`, the typed TypeScript client for every command.
#[cfg(debug_assertions)]
fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("failed to export TypeScript bindings");
}

/// What the window remembers between launches. Visibility is left out so hidden windows stay hidden.
const WINDOW_STATE: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(WINDOW_STATE).build())
        // The plugin only saves on quit. Saving when Jottr loses focus too means a crash, or
        // `tauri dev` restarting the app, still reopens the window where you left it.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window.app_handle().save_window_state(WINDOW_STATE);
            }
        })
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("jottr.db"))?;
            // Archive before the first list loads, so old Done tickets never flash up.
            if let Err(e) = store::auto_archive(&conn) {
                eprintln!("auto-archive failed: {e}");
            }
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(db::AttachmentsDir(dir.join("attachments")));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// `cargo test export_bindings` regenerates the bindings without launching the app.
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
