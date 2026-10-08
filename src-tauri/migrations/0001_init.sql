CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    position REAL NOT NULL,
    next_ticket_number INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- A ticket with no board is in the Inbox. `number` is per board and is
-- reassigned when a ticket moves to another board.
CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    board_id TEXT REFERENCES boards(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    number INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    due_date TEXT,
    position REAL NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    archived_at INTEGER
);

CREATE INDEX tickets_by_board ON tickets(board_id, status, position);
CREATE INDEX tickets_by_project ON tickets(project_id);
CREATE UNIQUE INDEX tickets_board_number ON tickets(board_id, number) WHERE board_id IS NOT NULL;
