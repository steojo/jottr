-- Full-text search over ticket titles and descriptions. The index keeps its own
-- copy of the text, keyed by ticket ID, and triggers keep it in step.
CREATE VIRTUAL TABLE tickets_fts USING fts5(
    ticket_id UNINDEXED,
    title,
    description,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO tickets_fts (ticket_id, title, description) SELECT id, title, description FROM tickets;

CREATE TRIGGER tickets_fts_insert AFTER INSERT ON tickets BEGIN
    INSERT INTO tickets_fts (ticket_id, title, description) VALUES (new.id, new.title, new.description);
END;

CREATE TRIGGER tickets_fts_delete AFTER DELETE ON tickets BEGIN
    DELETE FROM tickets_fts WHERE ticket_id = old.id;
END;

CREATE TRIGGER tickets_fts_update AFTER UPDATE OF title, description ON tickets BEGIN
    UPDATE tickets_fts SET title = new.title, description = new.description WHERE ticket_id = old.id;
END;
