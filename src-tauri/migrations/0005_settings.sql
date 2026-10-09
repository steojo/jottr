-- App settings: always exactly one row, so each setting is a typed column with its default.
CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auto_archive INTEGER NOT NULL DEFAULT 1,
    archive_after_days INTEGER NOT NULL DEFAULT 7
);

INSERT INTO settings (id) VALUES (1);
