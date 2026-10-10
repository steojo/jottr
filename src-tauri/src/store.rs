//! Data operations. Each takes a connection so it can be tested without Tauri.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{new_id, now};
use crate::models::{
    Attachment, Board, ChecklistItem, ChecklistPatch, Color, Label, LabelPatch, NewBoard, NewTicket, Priority, Project, Settings,
    Status, Ticket, TicketPatch,
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

/// Position that sorts below every ticket currently in the same board and status.
fn bottom_position(conn: &Connection, board_id: Option<&str>, status: Status) -> CmdResult<f64> {
    conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM tickets
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

/// New tickets go to the bottom of their status group.
pub fn create_ticket(conn: &mut Connection, input: NewTicket) -> CmdResult<Ticket> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Ticket title can't be empty".into());
    }

    let tx = conn.transaction().map_err(err)?;
    let board_id = input.board_id.as_deref();
    check_project(&tx, board_id, input.project_id.as_deref())?;
    let number = board_id.map(|id| next_number(&tx, id)).transpose()?;
    let position = bottom_position(&tx, board_id, input.status)?;
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
    let (board_id, status, priority): (Option<String>, Status, Priority) = tx
        .query_row("SELECT board_id, status, priority FROM tickets WHERE id = ?1", [&id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
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

    if let Some(new_priority) = patch.priority {
        tx.execute(
            "UPDATE tickets SET priority = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, new_priority, ts],
        )
        .map_err(err)?;
        // Urgent tickets are pinned above the rest of their group (the UI sorts them first),
        // so pinning or unpinning puts the ticket at the top of its new side.
        if (new_priority == Priority::Urgent) != (priority == Priority::Urgent) {
            let position = top_position(&tx, board_id.as_deref(), status)?;
            tx.execute("UPDATE tickets SET position = ?2 WHERE id = ?1", params![id, position])
                .map_err(err)?;
        }
    }

    // A status change moves the ticket to the top of its new group, and brings it
    // back from the Archive.
    if let Some(new_status) = patch.status.filter(|s| *s != status) {
        let position = top_position(&tx, board_id.as_deref(), new_status)?;
        let completed_at = (new_status == Status::Done).then_some(ts);
        tx.execute(
            "UPDATE tickets SET status = ?2, position = ?3, completed_at = ?4, updated_at = ?5, archived_at = NULL
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
        // Labels belong to a board: keep the ones the new board has under the same name, drop the rest.
        tx.execute(
            "INSERT OR IGNORE INTO ticket_labels (ticket_id, label_id)
             SELECT tl.ticket_id, nl.id FROM ticket_labels tl
             JOIN labels ol ON ol.id = tl.label_id
             JOIN labels nl ON nl.board_id = ?2 AND nl.name = ol.name
             WHERE tl.ticket_id = ?1",
            params![id, board_id],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM ticket_labels
             WHERE ticket_id = ?1 AND label_id NOT IN (SELECT id FROM labels WHERE board_id IS ?2)",
            params![id, board_id],
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

/// Permanently deletes a ticket with its checklist, labels and attachments. The UI confirms first.
pub fn delete_ticket(conn: &Connection, attachments: &Path, id: String) -> CmdResult<()> {
    let deleted = conn.execute("DELETE FROM tickets WHERE id = ?1", [&id]).map_err(err)?;
    if deleted == 0 {
        return Err("Ticket not found".into());
    }
    remove_dir(&attachments.join(&id))
}

/// Places a ticket at an exact status and position, e.g. after a drag and drop.
/// Entering Done stamps `completed_at`; leaving it clears it. Only a status change counts as an update.
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
         SET status = ?2, position = ?3, updated_at = CASE WHEN ?5 THEN ?4 ELSE updated_at END,
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

/// Turns a uniqueness violation into a readable message; names are unique per board, ignoring case.
fn label_error(name: &str) -> impl Fn(rusqlite::Error) -> String + '_ {
    move |e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            format!("This board already has a label named {name}")
        }
        e => err(e),
    }
}

/// Creates a label on a board. Only that board's tickets can use it.
pub fn create_label(conn: &Connection, board_id: String, name: String, color: Color) -> CmdResult<Label> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Label name can't be empty".into());
    }
    let board_exists: bool = conn
        .query_row("SELECT EXISTS (SELECT 1 FROM boards WHERE id = ?1)", [&board_id], |row| row.get(0))
        .map_err(err)?;
    if !board_exists {
        return Err("Board not found".into());
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO labels (id, board_id, name, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, board_id, name, color, now()],
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

/// Marks a ticket as updated, for edits stored outside the tickets table: labels, checklist and attachments.
fn touch(conn: &Connection, ticket_id: &str) -> CmdResult<()> {
    conn.execute("UPDATE tickets SET updated_at = ?2 WHERE id = ?1", params![ticket_id, now()]).map_err(err)?;
    Ok(())
}

/// Adds the label to the ticket, or removes it when `applied` is false.
/// Only labels from the ticket's own board can be added, so Inbox tickets have none.
pub fn set_ticket_label(conn: &Connection, ticket_id: String, label_id: String, applied: bool) -> CmdResult<Ticket> {
    if applied {
        let same_board: bool = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM labels l JOIN tickets t ON t.board_id = l.board_id
                                WHERE l.id = ?1 AND t.id = ?2)",
                params![label_id, ticket_id],
                |row| row.get(0),
            )
            .map_err(err)?;
        if !same_board {
            return Err("Labels can only be added to tickets on their board".into());
        }
    }
    let changed = if applied {
        conn.execute(
            "INSERT OR IGNORE INTO ticket_labels (ticket_id, label_id) VALUES (?1, ?2)",
            params![ticket_id, label_id],
        )
        .map_err(err)?
    } else {
        conn.execute(
            "DELETE FROM ticket_labels WHERE ticket_id = ?1 AND label_id = ?2",
            params![ticket_id, label_id],
        )
        .map_err(err)?
    };
    if changed > 0 {
        touch(conn, &ticket_id)?;
    }
    get_ticket(conn, &ticket_id)
}

/// Each word matches as a prefix, and all words must match: "pass res" finds "Password reset".
fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Splits `ENG-42` into its board key and number.
fn parse_ticket_key(input: &str) -> Option<(String, i32)> {
    let (key, number) = input.trim().split_once('-')?;
    let number = number.parse().ok()?;
    is_valid_key(&key.to_uppercase()).then(|| (key.to_uppercase(), number))
}

/// Tickets on every board, in the Inbox and in the Archive, best matches first. A ticket
/// ID like `ENG-42` puts that ticket at the top; archived tickets come after the rest.
pub fn search_tickets(conn: &Connection, query: String) -> CmdResult<Vec<Ticket>> {
    let mut results: Vec<Ticket> = Vec::new();

    if let Some((key, number)) = parse_ticket_key(&query) {
        let exact = conn
            .query_row(
                &format!(
                    "SELECT {} FROM tickets t JOIN boards b ON b.id = t.board_id
                     WHERE b.key = ?1 AND t.number = ?2",
                    Ticket::COLUMNS
                ),
                params![key, number],
                Ticket::from_row,
            )
            .optional()
            .map_err(err)?;
        results.extend(exact);
    }

    if let Some(fts) = fts_query(&query) {
        // Title matches count ten times more than description matches.
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM tickets_fts f
                 JOIN tickets t ON t.id = f.ticket_id
                 LEFT JOIN boards b ON b.id = t.board_id
                 WHERE tickets_fts MATCH ?1
                 ORDER BY t.archived_at IS NOT NULL, bm25(tickets_fts, 0.0, 10.0, 1.0)
                 LIMIT 50",
                Ticket::COLUMNS
            ))
            .map_err(err)?;
        let matches = stmt.query_map([fts], Ticket::from_row).map_err(err)?;
        for ticket in matches {
            let ticket = ticket.map_err(err)?;
            if !results.iter().any(|t| t.id == ticket.id) {
                results.push(ticket);
            }
        }
    }
    Ok(results)
}

/// My Focus: open tickets anywhere that are in progress, in review, or due on or before `due_by`
/// (`YYYY-MM-DD`). Soonest due first.
pub fn list_focus(conn: &Connection, due_by: String) -> CmdResult<Vec<Ticket>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM tickets t LEFT JOIN boards b ON b.id = t.board_id
             WHERE t.archived_at IS NULL
               AND t.status NOT IN ('done', 'canceled')
               AND (t.status IN ('in_progress', 'in_review') OR t.due_date <= ?1)
             ORDER BY t.due_date IS NULL, t.due_date, t.position",
            Ticket::COLUMNS
        ))
        .map_err(err)?;
    let tickets = stmt.query_map([due_by], Ticket::from_row).map_err(err)?;
    tickets.collect::<Result<_, _>>().map_err(err)
}

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Archived tickets from every board and the Inbox, most recently finished first.
pub fn list_archived(conn: &Connection) -> CmdResult<Vec<Ticket>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM tickets t LEFT JOIN boards b ON b.id = t.board_id
             WHERE t.archived_at IS NOT NULL
             ORDER BY t.completed_at DESC",
            Ticket::COLUMNS
        ))
        .map_err(err)?;
    let tickets = stmt.query_map([], Ticket::from_row).map_err(err)?;
    tickets.collect::<Result<_, _>>().map_err(err)
}

/// If auto-archive is on, archives Done tickets finished at least `archive_after_days` ago.
/// Returns how many it archived.
pub fn auto_archive(conn: &Connection) -> CmdResult<i32> {
    let settings = get_settings(conn)?;
    if !settings.auto_archive {
        return Ok(0);
    }
    let ts = now();
    let archived = conn
        .execute(
            "UPDATE tickets SET archived_at = ?1
             WHERE archived_at IS NULL AND status = 'done' AND completed_at <= ?2",
            params![ts, ts - i64::from(settings.archive_after_days) * DAY_MS],
        )
        .map_err(err)?;
    Ok(archived as i32)
}

/// Brings a ticket back from the Archive to the top of its status group. A Done ticket
/// counts as just finished, so it isn't archived again straight away.
pub fn restore_ticket(conn: &Connection, id: String) -> CmdResult<Ticket> {
    let (board_id, status, archived_at): (Option<String>, Status, Option<i64>) = conn
        .query_row("SELECT board_id, status, archived_at FROM tickets WHERE id = ?1", [&id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .map_err(err)?
        .ok_or_else(|| "Ticket not found".to_string())?;
    if archived_at.is_none() {
        return Err("Ticket isn't archived".into());
    }
    let position = top_position(conn, board_id.as_deref(), status)?;
    conn.execute(
        "UPDATE tickets
         SET archived_at = NULL, position = ?2, updated_at = ?3,
             completed_at = CASE WHEN status = 'done' THEN ?3 ELSE completed_at END
         WHERE id = ?1",
        params![id, position, now()],
    )
    .map_err(err)?;
    get_ticket(conn, &id)
}

pub fn get_settings(conn: &Connection) -> CmdResult<Settings> {
    conn.query_row(&format!("SELECT {} FROM settings WHERE id = 1", Settings::COLUMNS), [], Settings::from_row)
        .map_err(err)
}

/// Saves the settings, then archives anything they now make due.
pub fn update_settings(conn: &Connection, settings: Settings) -> CmdResult<Settings> {
    if !(1..=365).contains(&settings.archive_after_days) {
        return Err("Archive delay must be between 1 and 365 days".into());
    }
    conn.execute(
        "UPDATE settings SET auto_archive = ?1, archive_after_days = ?2, show_canceled = ?3, show_backlog = ?4,
             show_created = ?5
         WHERE id = 1",
        params![settings.auto_archive, settings.archive_after_days, settings.show_canceled, settings.show_backlog, settings.show_created],
    )
    .map_err(err)?;
    auto_archive(conn)?;
    get_settings(conn)
}

fn get_attachment(conn: &Connection, root: &Path, id: &str) -> CmdResult<Attachment> {
    conn.query_row(
        &format!("SELECT {} FROM attachments WHERE id = ?1", Attachment::COLUMNS),
        [id],
        |row| Attachment::from_row(row, root),
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "Attachment not found".to_string())
}

/// Removes a folder and everything in it; a missing folder is fine.
fn remove_dir(dir: &Path) -> CmdResult<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

/// The last part of a path or file name, so a name can never point outside its folder.
fn file_name(name: &str) -> String {
    Path::new(name.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string()
}

/// A ticket's attachments, oldest first. `root` is the attachments folder.
pub fn list_attachments(conn: &Connection, root: &Path, ticket_id: String) -> CmdResult<Vec<Attachment>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM attachments WHERE ticket_id = ?1 ORDER BY created_at, id",
            Attachment::COLUMNS
        ))
        .map_err(err)?;
    let attachments = stmt.query_map([ticket_id], |row| Attachment::from_row(row, root)).map_err(err)?;
    attachments.collect::<Result<_, _>>().map_err(err)
}

/// Writes a new attachment file with `write`, then records it. Nothing is left behind on failure.
fn store_attachment(
    conn: &Connection,
    root: &Path,
    ticket_id: &str,
    name: &str,
    write: impl FnOnce(&Path) -> io::Result<()>,
) -> CmdResult<Attachment> {
    let exists: bool = conn
        .query_row("SELECT EXISTS (SELECT 1 FROM tickets WHERE id = ?1)", [ticket_id], |row| row.get(0))
        .map_err(err)?;
    if !exists {
        return Err("Ticket not found".into());
    }
    let id = new_id();
    let dir = root.join(ticket_id).join(&id);
    let path = dir.join(name);
    let saved = fs::create_dir_all(&dir)
        .and_then(|()| write(&path))
        .and_then(|()| fs::metadata(&path))
        .map_err(err)
        .and_then(|meta| {
            conn.execute(
                "INSERT INTO attachments (id, ticket_id, name, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, ticket_id, name, meta.len() as i64, now()],
            )
            .map_err(err)
        });
    if let Err(e) = saved {
        let _ = fs::remove_dir_all(&dir);
        return Err(e);
    }
    touch(conn, ticket_id)?;
    get_attachment(conn, root, &id)
}

/// Copies files into the attachments folder and attaches them to a ticket. Folders are refused.
pub fn add_attachments(conn: &Connection, root: &Path, ticket_id: String, paths: Vec<String>) -> CmdResult<Vec<Attachment>> {
    let sources: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    for source in &sources {
        let name = file_name(&source.to_string_lossy());
        if source.is_dir() {
            return Err(format!("“{name}” is a folder. Only files can be attached."));
        }
        if !source.is_file() {
            return Err(format!("“{name}” couldn't be found"));
        }
    }
    sources
        .iter()
        .map(|source| {
            let name = file_name(&source.to_string_lossy());
            store_attachment(conn, root, &ticket_id, &name, |dest| fs::copy(source, dest).map(|_| ()))
        })
        .collect()
}

/// Attaches pasted data, e.g. a screenshot from the clipboard. `data` is base64.
pub fn add_attachment_data(
    conn: &Connection,
    root: &Path,
    ticket_id: String,
    name: String,
    data: String,
) -> CmdResult<Attachment> {
    let bytes = BASE64.decode(data).map_err(err)?;
    store_attachment(conn, root, &ticket_id, &file_name(&name), |dest| fs::write(dest, &bytes))
}

/// Deletes an attachment and its file.
pub fn delete_attachment(conn: &Connection, root: &Path, id: String) -> CmdResult<()> {
    let attachment = get_attachment(conn, root, &id)?;
    conn.execute("DELETE FROM attachments WHERE id = ?1", [&id]).map_err(err)?;
    touch(conn, &attachment.ticket_id)?;
    remove_dir(&root.join(&attachment.ticket_id).join(&id))
}

/// Where an attachment's file is stored.
pub fn attachment_path(conn: &Connection, root: &Path, id: String) -> CmdResult<String> {
    Ok(get_attachment(conn, root, &id)?.path)
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
    touch(conn, &ticket_id)?;
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
    let item = get_checklist_item(conn, &id)?;
    touch(conn, &item.ticket_id)?;
    Ok(item)
}

pub fn delete_checklist_item(conn: &Connection, id: String) -> CmdResult<()> {
    conn.execute(
        "UPDATE tickets SET updated_at = ?2 WHERE id = (SELECT ticket_id FROM checklist_items WHERE id = ?1)",
        params![id, now()],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM checklist_items WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        crate::db::open_in_memory().unwrap()
    }

    /// A fresh, empty attachments folder.
    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("jottr-test-{}", new_id()))
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
    fn new_tickets_go_to_the_bottom_of_their_group() {
        let mut conn = db();
        let first = ticket(&mut conn, None, Status::Backlog);
        let second = ticket(&mut conn, None, Status::Backlog);
        assert!(second.position > first.position);
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
    fn pinning_or_unpinning_urgent_moves_to_the_top() {
        let mut conn = db();
        let first = ticket(&mut conn, None, Status::Backlog);
        let t = ticket(&mut conn, None, Status::Backlog);
        let set = |p| TicketPatch { title: None, description: None, status: None, priority: Some(p) };

        let pinned = update_ticket(&mut conn, t.id.clone(), set(Priority::Urgent)).unwrap();
        assert!(pinned.position < first.position);
        let unpinned = update_ticket(&mut conn, t.id.clone(), set(Priority::None)).unwrap();
        assert!(unpinned.position < pinned.position);
        let high = update_ticket(&mut conn, first.id.clone(), set(Priority::High)).unwrap();
        assert_eq!(high.position, first.position, "other priority changes keep their place");
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
    fn labels_are_unique_per_board_and_attach_to_its_tickets() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let life = board(&conn, "LIF");
        let bug = create_label(&conn, eng.id.clone(), " bug ".into(), Color::Red).unwrap();
        let perf = create_label(&conn, eng.id.clone(), "perf".into(), Color::Yellow).unwrap();
        assert_eq!((bug.name.as_str(), bug.board_id.as_str()), ("bug", eng.id.as_str()));
        assert!(create_label(&conn, eng.id.clone(), "BUG".into(), Color::Blue).is_err(), "unique ignoring case");
        assert!(create_label(&conn, eng.id.clone(), " ".into(), Color::Blue).is_err());
        assert!(create_label(&conn, "nope".into(), "x".into(), Color::Blue).is_err(), "unknown board");
        let life_bug = create_label(&conn, life.id.clone(), "bug".into(), Color::Red).unwrap();

        let inbox = ticket(&mut conn, None, Status::Backlog);
        assert!(set_ticket_label(&conn, inbox.id.clone(), bug.id.clone(), true).is_err(), "Inbox tickets have no labels");
        let t = ticket(&mut conn, Some(&eng.id), Status::Backlog);
        assert!(set_ticket_label(&conn, t.id.clone(), life_bug.id, true).is_err(), "another board's label");
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
        assert!(list_tickets(&conn, Some(eng.id)).unwrap()[0].label_ids.is_empty());
        assert_eq!(list_labels(&conn).unwrap().len(), 2);
    }

    #[test]
    fn moving_boards_keeps_labels_with_the_same_name() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let life = board(&conn, "LIF");
        let eng_bug = create_label(&conn, eng.id.clone(), "bug".into(), Color::Red).unwrap();
        let eng_perf = create_label(&conn, eng.id.clone(), "perf".into(), Color::Yellow).unwrap();
        let life_bug = create_label(&conn, life.id.clone(), "Bug".into(), Color::Red).unwrap();
        let t = ticket(&mut conn, Some(&eng.id), Status::Backlog);
        set_ticket_label(&conn, t.id.clone(), eng_bug.id, true).unwrap();
        set_ticket_label(&conn, t.id.clone(), eng_perf.id, true).unwrap();

        let moved = move_ticket(&mut conn, t.id.clone(), Some(life.id.clone()), None).unwrap();
        assert_eq!(moved.label_ids, vec![life_bug.id], "bug matches ignoring case; perf is dropped");
        let in_inbox = move_ticket(&mut conn, t.id, None, None).unwrap();
        assert!(in_inbox.label_ids.is_empty());
    }

    #[test]
    fn deleting_a_ticket_removes_its_checklist_and_labels() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let t = ticket(&mut conn, Some(&eng.id), Status::Backlog);
        add_checklist_item(&conn, t.id.clone(), "Step".into()).unwrap();
        let bug = create_label(&conn, eng.id.clone(), "bug".into(), Color::Red).unwrap();
        set_ticket_label(&conn, t.id.clone(), bug.id.clone(), true).unwrap();

        delete_ticket(&conn, &temp_root(), t.id.clone()).unwrap();
        assert!(list_tickets(&conn, Some(eng.id)).unwrap().is_empty());
        assert!(list_checklist(&conn, t.id.clone()).unwrap().is_empty());
        let links: i64 = conn.query_row("SELECT COUNT(*) FROM ticket_labels", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 0);
        assert_eq!(list_labels(&conn).unwrap().len(), 1, "the label itself stays");
        assert!(delete_ticket(&conn, &temp_root(), t.id).is_err());
    }

    fn titled(conn: &mut Connection, board_id: Option<&str>, title: &str, status: Status) -> Ticket {
        let input = NewTicket {
            board_id: board_id.map(String::from),
            project_id: None,
            title: title.into(),
            status,
            priority: Priority::None,
        };
        create_ticket(conn, input).unwrap()
    }

    fn titles(tickets: Vec<Ticket>) -> Vec<String> {
        tickets.into_iter().map(|t| t.title).collect()
    }

    #[test]
    fn search_matches_prefixes_descriptions_and_ticket_ids() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let reset = titled(&mut conn, Some(&eng.id), "Password reset email", Status::Ready);
        titled(&mut conn, None, "Renew passport", Status::Backlog);
        let notes = titled(&mut conn, Some(&eng.id), "Quick capture", Status::Backlog);
        let patch = TicketPatch { title: None, description: Some("Register the global hotkey".into()), status: None, priority: None };
        update_ticket(&mut conn, notes.id.clone(), patch).unwrap();

        assert_eq!(titles(search_tickets(&conn, "pass res".into()).unwrap()), ["Password reset email"]);
        assert_eq!(titles(search_tickets(&conn, "pass".into()).unwrap()).len(), 2, "across boards and the Inbox");
        assert_eq!(titles(search_tickets(&conn, "hotkey".into()).unwrap()), ["Quick capture"]);
        assert_eq!(titles(search_tickets(&conn, "eng-1".into()).unwrap()), ["Password reset email"]);
        assert!(search_tickets(&conn, "   ".into()).unwrap().is_empty());
        assert!(search_tickets(&conn, "\"quoted".into()).is_ok(), "quotes can't break the query");

        let renamed = TicketPatch { title: Some("Forgot password".into()), description: None, status: None, priority: None };
        update_ticket(&mut conn, reset.id.clone(), renamed).unwrap();
        assert!(search_tickets(&conn, "reset".into()).unwrap().is_empty());
        delete_ticket(&conn, &temp_root(), reset.id).unwrap();
        assert!(search_tickets(&conn, "forgot".into()).unwrap().is_empty());
    }

    #[test]
    fn focus_lists_active_and_due_tickets_from_everywhere() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        titled(&mut conn, Some(&eng.id), "Working on it", Status::InProgress);
        titled(&mut conn, None, "Reviewing", Status::InReview);
        let due = titled(&mut conn, None, "Due soon", Status::Backlog);
        set_due_date(&conn, due.id, Some("2026-10-10".into())).unwrap();
        let later = titled(&mut conn, None, "Due later", Status::Backlog);
        set_due_date(&conn, later.id, Some("2026-12-01".into())).unwrap();
        let finished = titled(&mut conn, Some(&eng.id), "Finished", Status::Done);
        set_due_date(&conn, finished.id, Some("2026-10-01".into())).unwrap();
        titled(&mut conn, None, "Someday", Status::Backlog);

        let focus = titles(list_focus(&conn, "2026-10-16".into()).unwrap());
        assert_eq!(focus[0], "Due soon", "soonest due first");
        assert_eq!(focus.len(), 3);
        assert!(focus.contains(&"Working on it".to_string()) && focus.contains(&"Reviewing".to_string()));
    }

    /// Backdates a ticket's completion by `days`.
    #[test]
    fn updated_at_tracks_edits_but_not_reordering() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let t = titled(&mut conn, Some(&eng.id), "Ticket", Status::Backlog);
        let reset = |conn: &Connection| conn.execute("UPDATE tickets SET updated_at = 0", []).unwrap();
        let updated = |conn: &Connection| get_ticket(conn, &t.id).unwrap().updated_at;

        reset(&conn);
        reposition_ticket(&conn, t.id.clone(), Status::Backlog, 5.0).unwrap();
        assert_eq!(updated(&conn), 0.0, "reordering isn't an edit");
        reposition_ticket(&conn, t.id.clone(), Status::Ready, 5.0).unwrap();
        assert!(updated(&conn) > 0.0, "a status change is");

        let label = create_label(&conn, eng.id.clone(), "Bug".into(), Color::Red).unwrap();
        reset(&conn);
        set_ticket_label(&conn, t.id.clone(), label.id, true).unwrap();
        assert!(updated(&conn) > 0.0, "adding a label");

        reset(&conn);
        let item = add_checklist_item(&conn, t.id.clone(), "Step".into()).unwrap();
        assert!(updated(&conn) > 0.0, "adding a checklist item");
        reset(&conn);
        update_checklist_item(&conn, item.id.clone(), ChecklistPatch { text: None, done: Some(true) }).unwrap();
        assert!(updated(&conn) > 0.0, "ticking it");
        reset(&conn);
        delete_checklist_item(&conn, item.id).unwrap();
        assert!(updated(&conn) > 0.0, "deleting it");
    }

    fn finished_days_ago(conn: &Connection, t: &Ticket, days: i64) {
        conn.execute("UPDATE tickets SET completed_at = ?2 WHERE id = ?1", params![t.id, now() - days * DAY_MS])
            .unwrap();
    }

    #[test]
    fn auto_archive_moves_old_done_tickets_to_the_archive() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let old = titled(&mut conn, Some(&eng.id), "Old", Status::Done);
        let recent = titled(&mut conn, Some(&eng.id), "Recent", Status::Done);
        let open = titled(&mut conn, Some(&eng.id), "Open", Status::Backlog);
        finished_days_ago(&conn, &old, 8);
        finished_days_ago(&conn, &recent, 6);
        finished_days_ago(&conn, &open, 30);

        assert_eq!(auto_archive(&conn).unwrap(), 1);
        let mut left = titles(list_tickets(&conn, Some(eng.id.clone())).unwrap());
        left.sort();
        assert_eq!(left, ["Open", "Recent"]);
        assert_eq!(titles(list_archived(&conn).unwrap()), ["Old"]);
        assert_eq!(titles(search_tickets(&conn, "old".into()).unwrap()), ["Old"], "archived tickets stay searchable");
        assert_eq!(auto_archive(&conn).unwrap(), 0);
    }

    #[test]
    fn settings_control_auto_archive() {
        let mut conn = db();
        let defaults = get_settings(&conn).unwrap();
        assert!(defaults.auto_archive);
        assert_eq!(defaults.archive_after_days, 7);
        assert!(!defaults.show_canceled);
        assert!(defaults.show_backlog);
        assert!(defaults.show_created);

        let t = titled(&mut conn, None, "Done", Status::Done);
        finished_days_ago(&conn, &t, 3);
        update_settings(&conn, Settings { auto_archive: false, archive_after_days: 1, show_canceled: false, show_backlog: true, show_created: true }).unwrap();
        assert_eq!(auto_archive(&conn).unwrap(), 0, "off");
        assert!(list_archived(&conn).unwrap().is_empty());

        let saved = update_settings(
            &conn,
            Settings { auto_archive: true, archive_after_days: 2, show_canceled: true, show_backlog: false, show_created: false },
        )
        .unwrap();
        assert_eq!(
            (saved.auto_archive, saved.archive_after_days, saved.show_canceled, saved.show_backlog, saved.show_created),
            (true, 2, true, false, false)
        );
        assert_eq!(list_archived(&conn).unwrap().len(), 1, "saving archives anything now due");

        assert!(update_settings(&conn, Settings { auto_archive: true, archive_after_days: 0, show_canceled: false, show_backlog: true, show_created: true }).is_err());
    }

    #[test]
    fn restoring_brings_tickets_back_with_a_fresh_delay() {
        let mut conn = db();
        let eng = board(&conn, "ENG");
        let done = titled(&mut conn, Some(&eng.id), "Done", Status::Done);
        let other = titled(&mut conn, Some(&eng.id), "Other", Status::Done);
        finished_days_ago(&conn, &done, 10);
        finished_days_ago(&conn, &other, 10);
        auto_archive(&conn).unwrap();

        let restored = restore_ticket(&conn, done.id.clone()).unwrap();
        assert_eq!(restored.archived_at, None);
        assert!(restored.completed_at.unwrap() > (now() - DAY_MS) as f64, "counts as just finished");
        assert_eq!(auto_archive(&conn).unwrap(), 0, "not archived again straight away");
        assert!(restore_ticket(&conn, done.id).is_err(), "already restored");

        // Changing an archived ticket's status brings it back too.
        let reopened = set_status(&mut conn, &other, Status::InProgress);
        assert_eq!((reopened.archived_at, reopened.completed_at), (None, None));
        assert!(list_archived(&conn).unwrap().is_empty());
        assert_eq!(list_tickets(&conn, Some(eng.id)).unwrap().len(), 2);
    }

    #[test]
    fn attachments_are_copied_listed_and_deleted_with_their_files() {
        let mut conn = db();
        let root = temp_root();
        let t = ticket(&mut conn, None, Status::Backlog);

        let source_dir = temp_root();
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("notes.txt");
        fs::write(&source, "hello").unwrap();
        let paths = vec![source.to_string_lossy().into_owned()];

        let added = add_attachments(&conn, &root, t.id.clone(), paths.clone()).unwrap();
        assert_eq!((added[0].name.as_str(), added[0].size), ("notes.txt", 5.0));
        assert_eq!(fs::read_to_string(&added[0].path).unwrap(), "hello", "a copy is stored");
        assert!(source.exists(), "the original stays put");

        let pasted = add_attachment_data(&conn, &root, t.id.clone(), "../../shot.png".into(), BASE64.encode([1, 2, 3])).unwrap();
        assert_eq!((pasted.name.as_str(), pasted.size), ("shot.png", 3.0), "names can't escape their folder");
        assert_eq!(list_attachments(&conn, &root, t.id.clone()).unwrap().len(), 2);

        delete_attachment(&conn, &root, pasted.id.clone()).unwrap();
        assert!(!Path::new(&pasted.path).exists());
        assert_eq!(list_attachments(&conn, &root, t.id.clone()).unwrap().len(), 1);

        let folder = vec![source_dir.to_string_lossy().into_owned()];
        assert!(add_attachments(&conn, &root, t.id.clone(), folder).is_err(), "folders are refused");
        assert!(add_attachments(&conn, &root, "missing".into(), paths).is_err());
        assert!(!root.join("missing").exists(), "nothing left behind");

        delete_ticket(&conn, &root, t.id.clone()).unwrap();
        assert!(!root.join(&t.id).exists(), "deleting the ticket deletes its files");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        fs::remove_dir_all(&source_dir).unwrap();
    }
}
