-- Quick capture: a global shortcut that opens a small box for adding tickets to the Inbox.
-- The shortcut is in the global shortcut plugin's format, e.g. `Alt+Space`.
ALTER TABLE settings ADD COLUMN quick_capture INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN capture_shortcut TEXT NOT NULL DEFAULT 'Alt+Space';
