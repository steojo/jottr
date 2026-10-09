//! Data operations. Each takes a connection so it can be tested without Tauri.

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{new_id, now};
use crate::models::{
    Board, ChecklistItem, ChecklistPatch, NewBoard, NewTicket, Status, Ticket, TicketPatch,
};

pub type CmdResult<T> = Result<T, String>;

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn get_board(conn: &Connection, id: &str) -> CmdResult<Board> {
    conn.query_row(
        &format!("SELECT {} FROM boards WHERE id = ?1", Board::COLUMNS),
        [id],
        Board::from_row,
    )
    .map_err(err)
}

fn get_ticket(conn: &Connection, id: &str) -> CmdResult<Ticket> {
    conn.query_row(
        &format!(
            "SELECT {} FROM tickets t LEFT JOIN boards b ON b.id = t.board_id WHERE t.id = ?1",
            Ticket::COLUMNS
        ),
        [id],
        Ticket::from_row,
    )
    .map_err(err)
}

/// Position that sorts above every ticket currently in the same board and status.
fn top_position(conn: &Connection, board_id: Option<&str>, status: Status) -> CmdResult<f64> {
    conn.query_row(
        "SELECT COALESCE(MIN(position), 1) - 1 FROM tickets
         WHERE board_id IS ?1 AND status = ?2 AND archived_at IS NULL",
        params![board_id, status],
        |row| row.get(0),
    )
    .map_err(err)
}

/// Claims the next ticket number on a board.
fn next_number(conn: &Connection, board_id: &str) -> CmdResult<i32> {
    conn.query_row(
        "UPDATE boards SET next_ticket_number = next_ticket_number + 1
         WHERE id = ?1 RETURNING next_ticket_number - 1",
        [board_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "Board not found".to_string())
}

fn is_valid_key(key: &str) -> bool {
    (1..=5).contains(&key.len())
        && key.starts_with(|c: char| c.is_ascii_uppercase())
        && key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

pub fn list_boards(conn: &Connection) -> CmdResult<Vec<Board>> {
    let mut stmt = conn
        .prepare(&format!("SELECT {} FROM boards ORDER BY position", Board::COLUMNS))
        .map_err(err)?;
    let boards = stmt.query_map([], Board::from_row).map_err(err)?;
    boards.collect::<Result<_, _>>().map_err(err)
}

pub fn create_board(conn: &Connection, input: NewBoard) -> CmdResult<Board> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Board name can't be empty".into());
    }
    let key = input.key.trim().to_uppercase();
    if !is_valid_key(&key) {
        return Err("Key must be 1–5 letters or digits, starting with a letter".into());
    }

    let taken: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM boards WHERE key = ?1)", [&key], |row| row.get(0))
        .map_err(err)?;
    if taken {
        return Err(format!("A board with the key {key} already exists"));
    }

    let position: f64 = conn
        .query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM boards", [], |row| row.get(0))
        .map_err(err)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO boards (id, name, key, color, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, name, key, input.color, position, now()],
    )
    .map_err(err)?;
    get_board(conn, &id)
}

/// Tickets on a board, or in the Inbox when `board_id` is `None`.
pub fn list_tickets(conn: &Connection, board_id: Option<String>) -> CmdResult<Vec<Ticket>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM tickets t LEFT JOIN boards b ON b.id = t.board_id
             WHERE t.board_id IS ?1 AND t.archived_at IS NULL
             ORDER BY t.position",
            Ticket::COLUMNS
        ))
        .map_err(err)?;
    let tickets = stmt.query_map([board_id], Ticket::from_row).map_err(err)?;
    tickets.collect::<Result<_, _>>().map_err(err)
}

/// New tickets go to the top of their status group.
pub fn create_ticket(conn: &mut Connection, input: NewTicket) -> CmdResult<Ticket> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Ticket title can't be empty".into());
    }

    let tx = conn.transaction().map_err(err)?;
    let board_id = input.board_id.as_deref();
    let number = board_id.map(|id| next_number(&tx, id)).transpose()?;
    let position = top_position(&tx, board_id, input.status)?;
    let ts = now();
    let completed_at = (input.status == Status::Done).then_some(ts);
    let id = new_id();
    tx.execute(
        "INSERT INTO tickets (id, board_id, number, title, status, priority, position,
                              created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)",
        params![id, board_id, number, title, input.status, input.priority, position, ts, completed_at],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    get_ticket(conn, &id)
}

pub fn update_ticket(conn: &mut Connection, id: String, patch: TicketPatch) -> CmdResult<Ticket> {
    let tx = conn.transaction().map_err(err)?;
    let (board_id, status): (Option<String>, Status) = tx
        .query_row("SELECT board_id, status FROM tickets WHERE id = ?1", [&id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(err)?
        .ok_or_else(|| "Ticket not found".to_string())?;
    let ts = now();

    if let Some(title) = patch.title {
        let title = title.trim();
        if title.is_empty() {
            return Err("Ticket title can't be empty".into());
        }
        tx.execute(
            "UPDATE tickets SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, title, ts],
        )
        .map_err(err)?;
    }

    if let Some(description) = patch.description {
        tx.execute(
            "UPDATE tickets SET description = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, description, ts],
        )
        .map_err(err)?;
    }

    if let Some(priority) = patch.priority {
        tx.execute(
            "UPDATE tickets SET priority = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, priority, ts],
        )
        .map_err(err)?;
    }

    // A status change moves the ticket to the top of its new group.
    if let Some(new_status) = patch.status.filter(|s| *s != status) {
        let position = top_position(&tx, board_id.as_deref(), new_status)?;
        let completed_at = (new_status == Status::Done).then_some(ts);
        tx.execute(
            "UPDATE tickets SET status = ?2, position = ?3, completed_at = ?4, updated_at = ?5
             WHERE id = ?1",
            params![id, new_status, position, completed_at, ts],
        )
        .map_err(err)?;
    }

    tx.commit().map_err(err)?;
    get_ticket(conn, &id)
}

/// Moves a ticket to another board, or to the Inbox when `board_id` is `None`.
/// The ticket gets a new number on the destination board and leaves its project.
pub fn move_ticket(conn: &mut Connection, id: String, board_id: Option<String>) -> CmdResult<Ticket> {
    let tx = conn.transaction().map_err(err)?;
    let (current_board, status): (Option<String>, Status) = tx
        .query_row("SELECT board_id, status FROM tickets WHERE id = ?1", [&id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(err)?
        .ok_or_else(|| "Ticket not found".to_string())?;

    if current_board != board_id {
        let number = board_id.as_deref().map(|b| next_number(&tx, b)).transpose()?;
        let position = top_position(&tx, board_id.as_deref(), status)?;
        tx.execute(
            "UPDATE tickets SET board_id = ?2, number = ?3, project_id = NULL, position = ?4,
                                updated_at = ?5
             WHERE id = ?1",
            params![id, board_id, number, position, now()],
        )
        .map_err(err)?;
    }

    tx.commit().map_err(err)?;
    get_ticket(conn, &id)
}

fn is_valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// `due_date` is `YYYY-MM-DD`, or `None` to clear it.
pub fn set_due_date(conn: &Connection, id: String, due_date: Option<String>) -> CmdResult<Ticket> {
    if due_date.as_deref().is_some_and(|d| !is_valid_date(d)) {
        return Err("Due date must be YYYY-MM-DD".into());
    }
    let changed = conn
        .execute(
            "UPDATE tickets SET due_date = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, due_date, now()],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err("Ticket not found".into());
    }
    get_ticket(conn, &id)
}

fn get_checklist_item(conn: &Connection, id: &str) -> CmdResult<ChecklistItem> {
    conn.query_row(
        &format!("SELECT {} FROM checklist_items WHERE id = ?1", ChecklistItem::COLUMNS),
        [id],
        ChecklistItem::from_row,
    )
    .map_err(err)
}

pub fn list_checklist(conn: &Connection, ticket_id: String) -> CmdResult<Vec<ChecklistItem>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM checklist_items WHERE ticket_id = ?1 ORDER BY position",
            ChecklistItem::COLUMNS
        ))
        .map_err(err)?;
    let items = stmt.query_map([ticket_id], ChecklistItem::from_row).map_err(err)?;
    items.collect::<Result<_, _>>().map_err(err)
}

/// New items go to the end of the checklist.
pub fn add_checklist_item(conn: &Connection, ticket_id: String, text: String) -> CmdResult<ChecklistItem> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Checklist item can't be empty".into());
    }
    let position: f64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM checklist_items WHERE ticket_id = ?1",
            [&ticket_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO checklist_items (id, ticket_id, text, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, ticket_id, text, position, now()],
    )
    .map_err(err)?;
    get_checklist_item(conn, &id)
}

pub fn update_checklist_item(conn: &Connection, id: String, patch: ChecklistPatch) -> CmdResult<ChecklistItem> {
    if let Some(text) = patch.text {
        let text = text.trim();
        if text.is_empty() {
            return Err("Checklist item can't be empty".into());
        }
        conn.execute("UPDATE checklist_items SET text = ?2 WHERE id = ?1", params![id, text])
            .map_err(err)?;
    }
    if let Some(done) = patch.done {
        conn.execute("UPDATE checklist_items SET done = ?2 WHERE id = ?1", params![id, done])
            .map_err(err)?;
    }
    get_checklist_item(conn, &id)
}

pub fn delete_checklist_item(conn: &Connection, id: String) -> CmdResult<()> {
    conn.execute("DELETE FROM checklist_items WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BoardColor, Priority};

    fn db() -> Connection {
        crate::db::open_in_memory().unwrap()
    }

    fn board(conn: &Connection, key: &str) -> Board {
        create_board(conn, NewBoard { name: key.into(), key: key.into(), color: BoardColor::Blue }).unwrap()
    }

    fn ticket(conn: &mut Connection, board_id: Option<&str>, status: Status) -> Ticket {
        let input = NewTicket {
            board_id: board_id.map(String::from),
            title: "Ticket".into(),
            status,
            priority: Priority::None,
        };
        create_ticket(conn, input).unwrap()
    }

    fn set_status(conn: &mut Connection, t: &Ticket, status: Status) -> Ticket {
        let patch = TicketPatch { title: None, description: None, status: Some(status), priority: None };
        update_ticket(conn, t.id.clone(), patch).unwrap()
    }

    #[test]
    fn numbers_tickets_per_board() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let ops = board(&conn, "OPS");
        assert_eq!(ticket(&mut conn, Some(&eng.id), Status::Backlog).number, Some(1));
        assert_eq!(ticket(&mut conn, Some(&eng.id), Status::Backlog).number, Some(2));
        assert_eq!(ticket(&mut conn, Some(&ops.id), Status::Backlog).number, Some(1));
        let inbox = ticket(&mut conn, None, Status::Backlog);
        assert_eq!((inbox.number, inbox.board_key), (None, None));
    }

    #[test]
    fn new_tickets_go_to_the_top_of_their_group() {
        let mut conn = db();
        let first = ticket(&mut conn, None, Status::Backlog);
        let second = ticket(&mut conn, None, Status::Backlog);
        assert!(second.position < first.position);
    }

    #[test]
    fn rejects_bad_board_keys_and_empty_names() {
        let conn = db();
        board(&conn, "ENG");
        let new = |name: &str, key: &str| NewBoard { name: name.into(), key: key.into(), color: BoardColor::Red };
        assert!(create_board(&conn, new("Again", "eng")).is_err(), "duplicate key, case-insensitive");
        assert!(create_board(&conn, new("Digits", "1AB")).is_err());
        assert!(create_board(&conn, new("Long", "TOOLONG")).is_err());
        assert!(create_board(&conn, new("  ", "OK")).is_err());
    }

    #[test]
    fn status_changes_track_completion_and_move_to_the_top() {
        let mut conn = db();
        let waiting = ticket(&mut conn, None, Status::Ready);
        let t = ticket(&mut conn, None, Status::Backlog);

        let ready = set_status(&mut conn, &t, Status::Ready);
        assert!(ready.position < waiting.position);
        assert_eq!(ready.completed_at, None);

        let done = set_status(&mut conn, &ready, Status::Done);
        assert!(done.completed_at.is_some());
        assert_eq!(set_status(&mut conn, &done, Status::InProgress).completed_at, None);
    }

    #[test]
    fn moving_renumbers_and_the_inbox_clears_the_number() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        ticket(&mut conn, Some(&eng.id), Status::Backlog);
        let t = ticket(&mut conn, None, Status::Backlog);

        let moved = move_ticket(&mut conn, t.id.clone(), Some(eng.id.clone())).unwrap();
        assert_eq!((moved.number, moved.board_key.as_deref()), (Some(2), Some("ENG")));
        assert!(list_tickets(&conn, None).unwrap().is_empty());

        let back = move_ticket(&mut conn, t.id.clone(), None).unwrap();
        assert_eq!((back.number, back.board_key), (None, None));
        assert_eq!(list_tickets(&conn, None).unwrap().len(), 1);
    }

    #[test]
    fn rejects_empty_titles() {
        let mut conn = db();
        let input = NewTicket { board_id: None, title: "   ".into(), status: Status::Backlog, priority: Priority::None };
        assert!(create_ticket(&mut conn, input).is_err());
    }

    #[test]
    fn saves_descriptions_and_due_dates() {
        let mut conn = db();
        let t = ticket(&mut conn, None, Status::Backlog);
        let patch = TicketPatch { title: None, description: Some("# Notes".into()), status: None, priority: None };
        assert_eq!(update_ticket(&mut conn, t.id.clone(), patch).unwrap().description, "# Notes");

        let due = set_due_date(&conn, t.id.clone(), Some("2026-10-14".into())).unwrap();
        assert_eq!(due.due_date.as_deref(), Some("2026-10-14"));
        assert!(set_due_date(&conn, t.id.clone(), Some("14/10/2026".into())).is_err());
        assert_eq!(set_due_date(&conn, t.id.clone(), None).unwrap().due_date, None);
        assert!(set_due_date(&conn, "missing".into(), None).is_err());
    }

    #[test]
    fn checklists_are_ordered_and_counted_on_the_ticket() {
        let mut conn = db();
        let t = ticket(&mut conn, None, Status::Backlog);
        let first = add_checklist_item(&conn, t.id.clone(), "First".into()).unwrap();
        let second = add_checklist_item(&conn, t.id.clone(), " Second ".into()).unwrap();
        assert!(add_checklist_item(&conn, t.id.clone(), "  ".into()).is_err());
        assert_eq!(second.text, "Second");
        assert!(first.position < second.position);

        let patch = ChecklistPatch { text: None, done: Some(true) };
        assert!(update_checklist_item(&conn, first.id.clone(), patch).unwrap().done);
        let counted = &list_tickets(&conn, None).unwrap()[0];
        assert_eq!((counted.checklist_done, counted.checklist_total), (1, 2));

        delete_checklist_item(&conn, first.id).unwrap();
        let items = list_checklist(&conn, t.id).unwrap();
        assert_eq!(items.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(), ["Second"]);
    }
}
