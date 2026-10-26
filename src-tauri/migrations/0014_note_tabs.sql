-- Boards and projects can have several named notes, shown as tabs. Existing notes become a
-- note called "Notes"; empty ones are left out, since every scope gets one when first opened.
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    position REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX notes_scope ON notes (board_id, project_id, position);

INSERT INTO notes (id, board_id, project_id, title, body, position, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), id, NULL, 'Notes', notes, 0,
           CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
    FROM boards WHERE notes <> '';
INSERT INTO notes (id, board_id, project_id, title, body, position, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), board_id, id, 'Notes', notes, 0,
           CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
    FROM projects WHERE notes <> '';

ALTER TABLE boards DROP COLUMN notes;
ALTER TABLE projects DROP COLUMN notes;
