CREATE TABLE checklist_items (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX checklist_by_ticket ON checklist_items(ticket_id, position);
