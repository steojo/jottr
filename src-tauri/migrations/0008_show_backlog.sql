-- Whether boards show a Backlog column. Off keeps the board to work that's ready or under way.
ALTER TABLE settings ADD COLUMN show_backlog INTEGER NOT NULL DEFAULT 1;
