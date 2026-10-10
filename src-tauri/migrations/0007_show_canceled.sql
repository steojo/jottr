-- Whether boards show a Canceled column. Off by default: most tickets end up done or deleted, not canceled.
ALTER TABLE settings ADD COLUMN show_canceled INTEGER NOT NULL DEFAULT 0;
