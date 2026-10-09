-- Labels are shared by every board.
CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE ticket_labels (
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (ticket_id, label_id)
);

CREATE INDEX ticket_labels_by_label ON ticket_labels(label_id);
