use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::Row;
use serde::{Deserialize, Serialize};
use specta::Type;

/// An enum stored in SQLite as its snake_case name, matching its serde form.
macro_rules! text_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($text => Ok(Self::$variant),)+
                    _ => Err(FromSqlError::InvalidType),
                }
            }
        }
    };
}

text_enum!(Status {
    Backlog => "backlog",
    Ready => "ready",
    InProgress => "in_progress",
    InReview => "in_review",
    Done => "done",
    Canceled => "canceled",
});

text_enum!(Priority {
    None => "none",
    Low => "low",
    Medium => "medium",
    High => "high",
    Urgent => "urgent",
});

// The swatch set for boards and labels.
text_enum!(Color {
    Gray => "gray",
    Red => "red",
    Orange => "orange",
    Yellow => "yellow",
    Green => "green",
    Blue => "blue",
    Purple => "purple",
    Pink => "pink",
});

// Numbers crossing to TypeScript are f64 or i32: specta refuses i64 because JS
// numbers can't represent it exactly. f64 exports as `number | null` (serde
// turns NaN into null). Timestamps are milliseconds since the epoch.

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub key: String,
    pub color: Color,
}

impl Board {
    pub const COLUMNS: &'static str = "id, name, key, color";

    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            key: row.get(2)?,
            color: row.get(3)?,
        })
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub board_id: String,
    pub name: String,
}

impl Project {
    pub const COLUMNS: &'static str = "id, board_id, name";

    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self { id: row.get(0)?, board_id: row.get(1)?, name: row.get(2)? })
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: String,
    pub board_id: Option<String>,
    pub board_key: Option<String>,
    pub project_id: Option<String>,
    pub number: Option<i32>,
    pub title: String,
    pub description: String,
    pub status: Status,
    pub priority: Priority,
    pub due_date: Option<String>,
    pub position: f64,
    pub completed_at: Option<f64>,
    pub checklist_done: i32,
    pub checklist_total: i32,
    pub label_ids: Vec<String>,
    /// Set while the ticket is in the Archive.
    pub archived_at: Option<f64>,
}

impl Ticket {
    /// Select list for `FROM tickets t LEFT JOIN boards b ON b.id = t.board_id`.
    pub const COLUMNS: &'static str = "t.id, t.board_id, b.key, t.project_id, t.number, t.title, \
         t.description, t.status, t.priority, t.due_date, t.position, t.completed_at, \
         (SELECT COUNT(*) FROM checklist_items c WHERE c.ticket_id = t.id AND c.done = 1), \
         (SELECT COUNT(*) FROM checklist_items c WHERE c.ticket_id = t.id), \
         (SELECT GROUP_CONCAT(label_id) FROM ticket_labels l WHERE l.ticket_id = t.id), t.archived_at";

    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            board_id: row.get(1)?,
            board_key: row.get(2)?,
            project_id: row.get(3)?,
            number: row.get(4)?,
            title: row.get(5)?,
            description: row.get(6)?,
            status: row.get(7)?,
            priority: row.get(8)?,
            due_date: row.get(9)?,
            position: row.get(10)?,
            completed_at: row.get::<_, Option<i64>>(11)?.map(|ms| ms as f64),
            checklist_done: row.get(12)?,
            checklist_total: row.get(13)?,
            // IDs are UUIDs, so commas can't appear inside one.
            label_ids: row
                .get::<_, Option<String>>(14)?
                .map(|ids| ids.split(',').map(String::from).collect())
                .unwrap_or_default(),
            archived_at: row.get::<_, Option<i64>>(15)?.map(|ms| ms as f64),
        })
    }
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewBoard {
    pub name: String,
    pub key: String,
    pub color: Color,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewTicket {
    /// `None` creates the ticket in the Inbox.
    pub board_id: Option<String>,
    /// Must belong to `board_id`.
    pub project_id: Option<String>,
    pub title: String,
    pub status: Status,
    pub priority: Priority,
}

/// Fields left as `None` are unchanged.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TicketPatch {
    pub title: Option<String>,
    /// Markdown.
    pub description: Option<String>,
    pub status: Option<Status>,
    pub priority: Option<Priority>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: Color,
}

impl Label {
    pub const COLUMNS: &'static str = "id, name, color";

    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self { id: row.get(0)?, name: row.get(1)?, color: row.get(2)? })
    }
}

/// Fields left as `None` are unchanged.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LabelPatch {
    pub name: Option<String>,
    pub color: Option<Color>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub ticket_id: String,
    pub text: String,
    pub done: bool,
    pub position: f64,
}

impl ChecklistItem {
    pub const COLUMNS: &'static str = "id, ticket_id, text, done, position";

    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            ticket_id: row.get(1)?,
            text: row.get(2)?,
            done: row.get(3)?,
            position: row.get(4)?,
        })
    }
}

/// Fields left as `None` are unchanged.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistPatch {
    pub text: Option<String>,
    pub done: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Moves Done tickets to the Archive once they've been done for `archive_after_days`.
    pub auto_archive: bool,
    pub archive_after_days: i32,
}

impl Settings {
    pub const COLUMNS: &'static str = "auto_archive, archive_after_days";

    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self { auto_archive: row.get(0)?, archive_after_days: row.get(1)? })
    }
}
