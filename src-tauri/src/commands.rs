use tauri::State;

use crate::db::Db;
use crate::models::{
    Board, ChecklistItem, ChecklistPatch, Color, Label, LabelPatch, NewBoard, NewTicket, Project, Settings, Status,
    Ticket, TicketPatch,
};
use crate::store::{self, err, CmdResult};

#[tauri::command]
#[specta::specta]
pub async fn list_boards(db: State<'_, Db>) -> CmdResult<Vec<Board>> {
    store::list_boards(&*db.0.lock().map_err(err)?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_board(db: State<'_, Db>, input: NewBoard) -> CmdResult<Board> {
    store::create_board(&*db.0.lock().map_err(err)?, input)
}

/// Tickets on a board, or in the Inbox when `board_id` is `None`.
#[tauri::command]
#[specta::specta]
pub async fn list_tickets(db: State<'_, Db>, board_id: Option<String>) -> CmdResult<Vec<Ticket>> {
    store::list_tickets(&*db.0.lock().map_err(err)?, board_id)
}

/// New tickets go to the top of their status group.
#[tauri::command]
#[specta::specta]
pub async fn create_ticket(db: State<'_, Db>, input: NewTicket) -> CmdResult<Ticket> {
    store::create_ticket(&mut *db.0.lock().map_err(err)?, input)
}

#[tauri::command]
#[specta::specta]
pub async fn update_ticket(db: State<'_, Db>, id: String, patch: TicketPatch) -> CmdResult<Ticket> {
    store::update_ticket(&mut *db.0.lock().map_err(err)?, id, patch)
}

/// Moves a ticket to a board (or the Inbox when `board_id` is `None`) and a project on it
/// (or none). Changing boards gives the ticket that board's next number.
#[tauri::command]
#[specta::specta]
pub async fn move_ticket(
    db: State<'_, Db>,
    id: String,
    board_id: Option<String>,
    project_id: Option<String>,
) -> CmdResult<Ticket> {
    store::move_ticket(&mut *db.0.lock().map_err(err)?, id, board_id, project_id)
}

/// `due_date` is `YYYY-MM-DD`, or `None` to clear it.
#[tauri::command]
#[specta::specta]
pub async fn set_due_date(db: State<'_, Db>, id: String, due_date: Option<String>) -> CmdResult<Ticket> {
    store::set_due_date(&*db.0.lock().map_err(err)?, id, due_date)
}

#[tauri::command]
#[specta::specta]
pub async fn list_checklist(db: State<'_, Db>, ticket_id: String) -> CmdResult<Vec<ChecklistItem>> {
    store::list_checklist(&*db.0.lock().map_err(err)?, ticket_id)
}

#[tauri::command]
#[specta::specta]
pub async fn add_checklist_item(db: State<'_, Db>, ticket_id: String, text: String) -> CmdResult<ChecklistItem> {
    store::add_checklist_item(&*db.0.lock().map_err(err)?, ticket_id, text)
}

#[tauri::command]
#[specta::specta]
pub async fn update_checklist_item(
    db: State<'_, Db>,
    id: String,
    patch: ChecklistPatch,
) -> CmdResult<ChecklistItem> {
    store::update_checklist_item(&*db.0.lock().map_err(err)?, id, patch)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_checklist_item(db: State<'_, Db>, id: String) -> CmdResult<()> {
    store::delete_checklist_item(&*db.0.lock().map_err(err)?, id)
}

/// Places a ticket at an exact status and position, e.g. after a drag and drop.
#[tauri::command]
#[specta::specta]
pub async fn reposition_ticket(db: State<'_, Db>, id: String, status: Status, position: f64) -> CmdResult<Ticket> {
    store::reposition_ticket(&*db.0.lock().map_err(err)?, id, status, position)
}

#[tauri::command]
#[specta::specta]
pub async fn list_projects(db: State<'_, Db>) -> CmdResult<Vec<Project>> {
    store::list_projects(&*db.0.lock().map_err(err)?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_project(db: State<'_, Db>, board_id: String, name: String) -> CmdResult<Project> {
    store::create_project(&*db.0.lock().map_err(err)?, board_id, name)
}

#[tauri::command]
#[specta::specta]
pub async fn rename_project(db: State<'_, Db>, id: String, name: String) -> CmdResult<Project> {
    store::rename_project(&*db.0.lock().map_err(err)?, id, name)
}

/// The project's tickets stay on the board, without a project.
#[tauri::command]
#[specta::specta]
pub async fn delete_project(db: State<'_, Db>, id: String) -> CmdResult<()> {
    store::delete_project(&*db.0.lock().map_err(err)?, id)
}

#[tauri::command]
#[specta::specta]
pub async fn list_labels(db: State<'_, Db>) -> CmdResult<Vec<Label>> {
    store::list_labels(&*db.0.lock().map_err(err)?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_label(db: State<'_, Db>, name: String, color: Color) -> CmdResult<Label> {
    store::create_label(&*db.0.lock().map_err(err)?, name, color)
}

#[tauri::command]
#[specta::specta]
pub async fn update_label(db: State<'_, Db>, id: String, patch: LabelPatch) -> CmdResult<Label> {
    store::update_label(&*db.0.lock().map_err(err)?, id, patch)
}

/// Also removes it from every ticket.
#[tauri::command]
#[specta::specta]
pub async fn delete_label(db: State<'_, Db>, id: String) -> CmdResult<()> {
    store::delete_label(&*db.0.lock().map_err(err)?, id)
}

/// Adds the label to the ticket, or removes it when `applied` is false.
#[tauri::command]
#[specta::specta]
pub async fn set_ticket_label(
    db: State<'_, Db>,
    ticket_id: String,
    label_id: String,
    applied: bool,
) -> CmdResult<Ticket> {
    store::set_ticket_label(&*db.0.lock().map_err(err)?, ticket_id, label_id, applied)
}

/// Permanently deletes a ticket with its checklist and labels.
#[tauri::command]
#[specta::specta]
pub async fn delete_ticket(db: State<'_, Db>, id: String) -> CmdResult<()> {
    store::delete_ticket(&*db.0.lock().map_err(err)?, id)
}

/// Tickets on every board and in the Inbox, best matches first.
#[tauri::command]
#[specta::specta]
pub async fn search_tickets(db: State<'_, Db>, query: String) -> CmdResult<Vec<Ticket>> {
    store::search_tickets(&*db.0.lock().map_err(err)?, query)
}

/// My Focus: open tickets anywhere that are in progress, in review, or due by `due_by`.
#[tauri::command]
#[specta::specta]
pub async fn list_focus(db: State<'_, Db>, due_by: String) -> CmdResult<Vec<Ticket>> {
    store::list_focus(&*db.0.lock().map_err(err)?, due_by)
}

/// Archived tickets from every board and the Inbox, most recently finished first.
#[tauri::command]
#[specta::specta]
pub async fn list_archived(db: State<'_, Db>) -> CmdResult<Vec<Ticket>> {
    store::list_archived(&*db.0.lock().map_err(err)?)
}

/// Archives Done tickets that are due, if auto-archive is on. Returns how many it archived.
#[tauri::command]
#[specta::specta]
pub async fn auto_archive(db: State<'_, Db>) -> CmdResult<i32> {
    store::auto_archive(&*db.0.lock().map_err(err)?)
}

/// Brings a ticket back from the Archive to the top of its status group.
#[tauri::command]
#[specta::specta]
pub async fn restore_ticket(db: State<'_, Db>, id: String) -> CmdResult<Ticket> {
    store::restore_ticket(&*db.0.lock().map_err(err)?, id)
}

#[tauri::command]
#[specta::specta]
pub async fn get_settings(db: State<'_, Db>) -> CmdResult<Settings> {
    store::get_settings(&*db.0.lock().map_err(err)?)
}

/// Saves the settings, then archives anything they now make due.
#[tauri::command]
#[specta::specta]
pub async fn update_settings(db: State<'_, Db>, settings: Settings) -> CmdResult<Settings> {
    store::update_settings(&*db.0.lock().map_err(err)?, settings)
}
