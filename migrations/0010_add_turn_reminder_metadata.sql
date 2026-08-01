ALTER TABLE games ADD COLUMN current_turn_started_at TEXT;
ALTER TABLE games ADD COLUMN last_turn_reminder_sent_at TEXT;

UPDATE games
SET current_turn_started_at = updated_at
WHERE status = 'playing' AND current_turn_started_at IS NULL;

CREATE INDEX IF NOT EXISTS games_turn_reminders_idx
  ON games (status, current_player, current_turn_started_at, last_turn_reminder_sent_at);
