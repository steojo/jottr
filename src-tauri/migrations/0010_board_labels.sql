-- Labels belong to a board, so each board keeps its own set, and names are unique per board.
-- SQLite can't change constraints in place, so both label tables are rebuilt. ticket_labels
-- goes first, so dropping the old labels table can't cascade into it.
CREATE TEMP TABLE old_ticket_labels AS SELECT ticket_id, label_id FROM ticket_labels;
DROP TABLE ticket_labels;
ALTER TABLE labels RENAME TO old_labels;

CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (board_id, name)
);

-- Each label goes to every board it's used on. Unused labels were available everywhere, so
-- they go to every board. A label's first board keeps its ID; the others get copies.
CREATE TEMP TABLE label_boards AS
    SELECT DISTINCT tl.label_id, t.board_id
    FROM old_ticket_labels tl JOIN tickets t ON t.id = tl.ticket_id
    WHERE t.board_id IS NOT NULL;
INSERT INTO label_boards (label_id, board_id)
    SELECT l.id, b.id FROM old_labels l CROSS JOIN boards b
    WHERE l.id NOT IN (SELECT label_id FROM label_boards);
CREATE TEMP TABLE label_map AS
    SELECT label_id AS old_id, board_id,
           CASE WHEN ROW_NUMBER() OVER (PARTITION BY label_id ORDER BY board_id) = 1
                THEN label_id ELSE lower(hex(randomblob(16))) END AS new_id
    FROM label_boards;

INSERT INTO labels (id, board_id, name, color, created_at)
    SELECT m.new_id, m.board_id, l.name, l.color, l.created_at
    FROM label_map m JOIN old_labels l ON l.id = m.old_id;

CREATE TABLE ticket_labels (
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (ticket_id, label_id)
);
CREATE INDEX ticket_labels_by_label ON ticket_labels(label_id);

-- Board tickets keep their labels, using their board's copy. Inbox tickets lose theirs.
INSERT INTO ticket_labels (ticket_id, label_id)
    SELECT tl.ticket_id, m.new_id
    FROM old_ticket_labels tl
    JOIN tickets t ON t.id = tl.ticket_id
    JOIN label_map m ON m.old_id = tl.label_id AND m.board_id = t.board_id;

DROP TABLE old_labels;
DROP TABLE label_map;
DROP TABLE label_boards;
DROP TABLE old_ticket_labels;
