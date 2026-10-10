-- Whether board cards show when each ticket was created.
ALTER TABLE settings ADD COLUMN show_created INTEGER NOT NULL DEFAULT 1;
