ALTER TABLE settings ADD COLUMN due_reminders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN reminder_time TEXT NOT NULL DEFAULT '09:00';

-- Retain elapsed schedules even after dismissal, so reopening or changing the reminder
-- time cannot notify the same ticket/due date twice. Future schedules may be replaced.
CREATE TABLE due_reminders (
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    due_date TEXT NOT NULL,
    scheduled_for INTEGER NOT NULL,
    PRIMARY KEY (ticket_id, due_date)
);
