mod commands;
mod db;
mod models;
mod store;

use std::sync::Mutex;

use tauri::Manager;
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        // Command errors reject the promise instead of returning a Result object.
        .error_handling(ErrorHandlingMode::Throw)
        .commands(collect_commands![
            commands::list_boards,
            commands::create_board,
            commands::list_tickets,
            commands::create_ticket,
            commands::update_ticket,
            commands::move_ticket,
            commands::reposition_ticket,
            commands::set_due_date,
            commands::list_checklist,
            commands::add_checklist_item,
            commands::update_checklist_item,
            commands::delete_checklist_item,
        ])
}

/// Writes `src/bindings.ts`, the typed TypeScript client for every command.
#[cfg(debug_assertions)]
fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("jottr.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
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
