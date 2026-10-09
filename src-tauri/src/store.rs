//! Data operations. Each takes a connection so it can be tested without Tauri.

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{new_id, now};
use crate::models::{
    Board, ChecklistItem, ChecklistPatch, Color, Label, LabelPatch, NewBoard, NewTicket, Project, Status, Ticket,
    TicketPatch,
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

/// Errors unless `project_id` is `None` or a project on `board_id`.
fn check_project(conn: &Connection, board_id: Option<&str>, project_id: Option<&str>) -> CmdResult<()> {
    let Some(project_id) = project_id else { return Ok(()) };
    let project_board: Option<String> = conn
        .query_row("SELECT board_id FROM projects WHERE id = ?1", [project_id], |row| row.get(0))
        .optional()
        .map_err(err)?;
    match project_board {
        None => Err("Project not found".into()),
        Some(b) if Some(b.as_str()) != board_id => Err("That project belongs to another board".into()),
        Some(_) => Ok(()),
    }
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
    check_project(&tx, board_id, input.project_id.as_deref())?;
    let number = board_id.map(|id| next_number(&tx, id)).transpose()?;
    let position = top_position(&tx, board_id, input.status)?;
    let ts = now();
    let completed_at = (input.status == Status::Done).then_some(ts);
    let id = new_id();
    tx.execute(
        "INSERT INTO tickets (id, board_id, project_id, number, title, status, priority, position,
                              created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
        params![
            id,
            board_id,
            input.project_id,
            number,
            title,
            input.status,
            input.priority,
            position,
            ts,
            completed_at
        ],
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

/// Moves a ticket to a board (or the Inbox when `board_id` is `None`) and a project on it
/// (or none). Changing boards gives the ticket that board's next number.
pub fn move_ticket(
    conn: &mut Connection,
    id: String,
    board_id: Option<String>,
    project_id: Option<String>,
) -> CmdResult<Ticket> {
    let tx = conn.transaction().map_err(err)?;
    check_project(&tx, board_id.as_deref(), project_id.as_deref())?;
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
            "UPDATE tickets SET board_id = ?2, number = ?3, position = ?4 WHERE id = ?1",
            params![id, board_id, number, position],
        )
        .map_err(err)?;
    }
    tx.execute(
        "UPDATE tickets SET project_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, project_id, now()],
    )
    .map_err(err)?;

    tx.commit().map_err(err)?;
    get_ticket(conn, &id)
}

/// Permanently deletes a ticket with its checklist and labels. The UI confirms first.
pub fn delete_ticket(conn: &Connection, id: String) -> CmdResult<()> {
    let deleted = conn.execute("DELETE FROM tickets WHERE id = ?1", [id]).map_err(err)?;
    if deleted == 0 {
        return Err("Ticket not found".into());
    }
    Ok(())
}

/// Places a ticket at an exact status and position, e.g. after a drag and drop.
/// Entering Done stamps `completed_at`; leaving it clears it.
pub fn reposition_ticket(conn: &Connection, id: String, status: Status, position: f64) -> CmdResult<Ticket> {
    let current: Status = conn
        .query_row("SELECT status FROM tickets WHERE id = ?1", [&id], |row| row.get(0))
        .optional()
        .map_err(err)?
        .ok_or_else(|| "Ticket not found".to_string())?;
    let ts = now();
    let changed = status != current;
    conn.execute(
        "UPDATE tickets
         SET status = ?2, position = ?3, updated_at = ?4,
             completed_at = CASE WHEN ?5 THEN ?6 ELSE completed_at END
         WHERE id = ?1",
        params![id, status, position, ts, changed, (status == Status::Done).then_some(ts)],
    )
    .map_err(err)?;
    get_ticket(conn, &id)
}

pub fn list_projects(conn: &Connection) -> CmdResult<Vec<Project>> {
    let mut stmt = conn
        .prepare(&format!("SELECT {} FROM projects ORDER BY board_id, position", Project::COLUMNS))
        .map_err(err)?;
    let projects = stmt.query_map([], Project::from_row).map_err(err)?;
    projects.collect::<Result<_, _>>().map_err(err)
}

fn get_project(conn: &Connection, id: &str) -> CmdResult<Project> {
    conn.query_row(
        &format!("SELECT {} FROM projects WHERE id = ?1", Project::COLUMNS),
        [id],
        Project::from_row,
    )
    .map_err(err)
}

fn project_name(name: &str) -> CmdResult<&str> {
    let name = name.trim();
    if name.is_empty() {
        Err("Project name can't be empty".into())
    } else {
        Ok(name)
    }
}

/// New projects go to the end of their board's list.
pub fn create_project(conn: &Connection, board_id: String, name: String) -> CmdResult<Project> {
    let name = project_name(&name)?;
    let position: f64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM projects WHERE board_id = ?1",
            [&board_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO projects (id, board_id, name, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, board_id, name, position, now()],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "Board not found".to_string()
        }
        e => err(e),
    })?;
    get_project(conn, &id)
}

pub fn rename_project(conn: &Connection, id: String, name: String) -> CmdResult<Project> {
    let name = project_name(&name)?;
    conn.execute(
        "UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now()],
    )
    .map_err(err)?;
    get_project(conn, &id)
}

/// The project's tickets stay on the board, without a project.
pub fn delete_project(conn: &Connection, id: String) -> CmdResult<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

pub fn list_labels(conn: &Connection) -> CmdResult<Vec<Label>> {
    let mut stmt = conn
        .prepare(&format!("SELECT {} FROM labels ORDER BY name", Label::COLUMNS))
        .map_err(err)?;
    let labels = stmt.query_map([], Label::from_row).map_err(err)?;
    labels.collect::<Result<_, _>>().map_err(err)
}

fn get_label(conn: &Connection, id: &str) -> CmdResult<Label> {
    conn.query_row(&format!("SELECT {} FROM labels WHERE id = ?1", Label::COLUMNS), [id], Label::from_row)
        .map_err(err)
}

/// Turns a uniqueness violation into a readable message; names are unique ignoring case.
fn label_error(name: &str) -> impl Fn(rusqlite::Error) -> String + '_ {
    move |e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            format!("A label named {name} already exists")
        }
        e => err(e),
    }
}

pub fn create_label(conn: &Connection, name: String, color: Color) -> CmdResult<Label> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Label name can't be empty".into());
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO labels (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, color, now()],
    )
    .map_err(label_error(name))?;
    get_label(conn, &id)
}

pub fn update_label(conn: &Connection, id: String, patch: LabelPatch) -> CmdResult<Label> {
    if let Some(name) = patch.name {
        let name = name.trim();
        if name.is_empty() {
            return Err("Label name can't be empty".into());
        }
        conn.execute("UPDATE labels SET name = ?2 WHERE id = ?1", params![id, name])
            .map_err(label_error(name))?;
    }
    if let Some(color) = patch.color {
        conn.execute("UPDATE labels SET color = ?2 WHERE id = ?1", params![id, color])
            .map_err(err)?;
    }
    get_label(conn, &id)
}

/// Also removes it from every ticket.
pub fn delete_label(conn: &Connection, id: String) -> CmdResult<()> {
    conn.execute("DELETE FROM labels WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

/// Adds the label to the ticket, or removes it when `applied` is false.
pub fn set_ticket_label(conn: &Connection, ticket_id: String, label_id: String, applied: bool) -> CmdResult<Ticket> {
    if applied {
        conn.execute(
            "INSERT OR IGNORE INTO ticket_labels (ticket_id, label_id) VALUES (?1, ?2)",
            params![ticket_id, label_id],
        )
        .map_err(err)?;
    } else {
        conn.execute(
            "DELETE FROM ticket_labels WHERE ticket_id = ?1 AND label_id = ?2",
            params![ticket_id, label_id],
        )
        .map_err(err)?;
    }
    get_ticket(conn, &ticket_id)
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
    use crate::models::Priority;

    fn db() -> Connection {
        crate::db::open_in_memory().unwrap()
    }

    fn board(conn: &Connection, key: &str) -> Board {
        create_board(conn, NewBoard { name: key.into(), key: key.into(), color: Color::Blue }).unwrap()
    }

    fn ticket(conn: &mut Connection, board_id: Option<&str>, status: Status) -> Ticket {
        let input = NewTicket {
            board_id: board_id.map(String::from),
            project_id: None,
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
        let new = |name: &str, key: &str| NewBoard { name: name.into(), key: key.into(), color: Color::Red };
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

        let moved = move_ticket(&mut conn, t.id.clone(), Some(eng.id.clone()), None).unwrap();
        assert_eq!((moved.number, moved.board_key.as_deref()), (Some(2), Some("ENG")));
        assert!(list_tickets(&conn, None).unwrap().is_empty());

        let back = move_ticket(&mut conn, t.id.clone(), None, None).unwrap();
        assert_eq!((back.number, back.board_key), (None, None));
        assert_eq!(list_tickets(&conn, None).unwrap().len(), 1);
    }

    #[test]
    fn rejects_empty_titles() {
        let mut conn = db();
        let input = NewTicket {
            board_id: None,
            project_id: None,
            title: "   ".into(),
            status: Status::Backlog,
            priority: Priority::None,
        };
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

    #[test]
    fn repositioning_sets_status_position_and_completion() {
        let mut conn = db();
        let t = ticket(&mut conn, None, Status::Backlog);

        let moved = reposition_ticket(&conn, t.id.clone(), Status::Ready, 2.5).unwrap();
        assert_eq!((moved.status, moved.position, moved.completed_at), (Status::Ready, 2.5, None));

        let done = reposition_ticket(&conn, t.id.clone(), Status::Done, 1.0).unwrap();
        let completed = done.completed_at.expect("entering Done stamps completion");
        // Reordering within Done keeps the original completion time.
        let reordered = reposition_ticket(&conn, t.id.clone(), Status::Done, 0.5).unwrap();
        assert_eq!(reordered.completed_at, Some(completed));

        let reopened = reposition_ticket(&conn, t.id.clone(), Status::InProgress, 0.0).unwrap();
        assert_eq!(reopened.completed_at, None);
        assert!(reposition_ticket(&conn, "missing".into(), Status::Ready, 0.0).is_err());
    }

    #[test]
    fn projects_are_created_renamed_and_deleted() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let auth = create_project(&conn, eng.id.clone(), " Auth rewrite ".into()).unwrap();
        let launch = create_project(&conn, eng.id.clone(), "Launch".into()).unwrap();
        assert_eq!(auth.name, "Auth rewrite");
        assert!(create_project(&conn, eng.id.clone(), "  ".into()).is_err());
        assert!(create_project(&conn, "missing".into(), "Orphan".into()).is_err());
        let names: Vec<_> = list_projects(&conn).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Auth rewrite", "Launch"]);

        assert_eq!(rename_project(&conn, launch.id.clone(), "Q4 launch".into()).unwrap().name, "Q4 launch");

        // Deleting a project keeps its tickets on the board.
        let input = NewTicket {
            board_id: Some(eng.id.clone()),
            project_id: Some(auth.id.clone()),
            title: "Login".into(),
            status: Status::Backlog,
            priority: Priority::None,
        };
        let t = create_ticket(&mut conn, input).unwrap();
        assert_eq!(t.project_id.as_deref(), Some(auth.id.as_str()));
        delete_project(&conn, auth.id).unwrap();
        let kept = &list_tickets(&conn, Some(eng.id)).unwrap()[0];
        assert_eq!((kept.id.as_str(), kept.project_id.as_deref()), (t.id.as_str(), None));
    }

    #[test]
    fn moving_sets_the_project_and_checks_its_board() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let ops = board(&conn, "OPS");
        let auth = create_project(&conn, eng.id.clone(), "Auth".into()).unwrap();
        let t = ticket(&mut conn, Some(&eng.id), Status::Backlog);

        // Same board: only the project changes, so the number stays.
        let in_project = move_ticket(&mut conn, t.id.clone(), Some(eng.id.clone()), Some(auth.id.clone())).unwrap();
        assert_eq!((in_project.number, in_project.project_id.as_deref()), (Some(1), Some(auth.id.as_str())));

        assert!(move_ticket(&mut conn, t.id.clone(), Some(ops.id.clone()), Some(auth.id.clone())).is_err());
        let moved = move_ticket(&mut conn, t.id.clone(), Some(ops.id.clone()), None).unwrap();
        assert_eq!((moved.board_key.as_deref(), moved.project_id), (Some("OPS"), None));
    }

    #[test]
    fn labels_are_unique_and_attach_to_tickets() {
        let mut conn = db();
        let bug = create_label(&conn, " bug ".into(), Color::Red).unwrap();
        let perf = create_label(&conn, "perf".into(), Color::Yellow).unwrap();
        assert_eq!(bug.name, "bug");
        assert!(create_label(&conn, "BUG".into(), Color::Blue).is_err(), "names are unique ignoring case");
        assert!(create_label(&conn, " ".into(), Color::Blue).is_err());

        let t = ticket(&mut conn, None, Status::Backlog);
        set_ticket_label(&conn, t.id.clone(), bug.id.clone(), true).unwrap();
        set_ticket_label(&conn, t.id.clone(), bug.id.clone(), true).unwrap();
        let tagged = set_ticket_label(&conn, t.id.clone(), perf.id.clone(), true).unwrap();
        let mut ids = tagged.label_ids.clone();
        ids.sort();
        let mut expected = vec![bug.id.clone(), perf.id.clone()];
        expected.sort();
        assert_eq!(ids, expected, "adding twice is a no-op");

        let untagged = set_ticket_label(&conn, t.id.clone(), perf.id.clone(), false).unwrap();
        assert_eq!(untagged.label_ids, std::slice::from_ref(&bug.id));

        let patch = LabelPatch { name: Some("defect".into()), color: Some(Color::Orange) };
        let renamed = update_label(&conn, bug.id.clone(), patch).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.color), ("defect", Color::Orange));

        delete_label(&conn, bug.id).unwrap();
        assert!(list_tickets(&conn, None).unwrap()[0].label_ids.is_empty());
        assert_eq!(list_labels(&conn).unwrap().len(), 1);
    }

    #[test]
    fn deleting_a_ticket_removes_its_checklist_and_labels() {
        let mut conn = db();
        let t = ticket(&mut conn, None, Status::Backlog);
        add_checklist_item(&conn, t.id.clone(), "Step".into()).unwrap();
        let bug = create_label(&conn, "bug".into(), Color::Red).unwrap();
        set_ticket_label(&conn, t.id.clone(), bug.id.clone(), true).unwrap();

        delete_ticket(&conn, t.id.clone()).unwrap();
        assert!(list_tickets(&conn, None).unwrap().is_empty());
        assert!(list_checklist(&conn, t.id.clone()).unwrap().is_empty());
        let links: i64 = conn.query_row("SELECT COUNT(*) FROM ticket_labels", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 0);
        assert_eq!(list_labels(&conn).unwrap().len(), 1, "the label itself stays");
        assert!(delete_ticket(&conn, t.id).is_err());
    }
}
