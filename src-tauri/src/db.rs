use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

/// Applied in order. A database at `user_version` N has run the first N migrations.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_checklists.sql"),
    include_str!("../migrations/0003_labels.sql"),
    include_str!("../migrations/0004_search.sql"),
    include_str!("../migrations/0005_settings.sql"),
    include_str!("../migrations/0006_attachments.sql"),
    include_str!("../migrations/0007_show_canceled.sql"),
    include_str!("../migrations/0008_show_backlog.sql"),
];

pub struct Db(pub Mutex<Connection>);

/// The folder attachment files are copied into.
pub struct AttachmentsDir(pub PathBuf);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    init(Connection::open(path)?)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    init(Connection::open_in_memory()?)
}

fn init(mut conn: Connection) -> rusqlite::Result<Connection> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", index as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

/// Milliseconds since the Unix epoch.
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}
