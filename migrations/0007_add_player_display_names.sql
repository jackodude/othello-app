ALTER TABLE games ADD COLUMN black_player_name TEXT;
ALTER TABLE games ADD COLUMN white_player_name TEXT;

CREATE INDEX IF NOT EXISTS games_status_updated_at_idx
  ON games (status, updated_at);
