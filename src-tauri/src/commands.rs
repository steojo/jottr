use tauri::State;

use crate::db::Db;
use crate::models::{Board, NewBoard, NewTicket, Ticket, TicketPatch};
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

/// Moves a ticket to another board, or to the Inbox when `board_id` is `None`.
/// The ticket gets a new number on the destination board and leaves its project.
#[tauri::command]
#[specta::specta]
pub async fn move_ticket(db: State<'_, Db>, id: String, board_id: Option<String>) -> CmdResult<Ticket> {
    store::move_ticket(&mut *db.0.lock().map_err(err)?, id, board_id)
}
