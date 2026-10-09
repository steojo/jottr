-- Files attached to tickets. The files themselves are copies kept in the app data
-- folder at `attachments/<ticket id>/<attachment id>/<name>`.
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX attachments_by_ticket ON attachments(ticket_id, created_at);
