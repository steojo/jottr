-- Free-form markdown notes for brain dumps: one on each board and one on each project.
ALTER TABLE boards ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';
