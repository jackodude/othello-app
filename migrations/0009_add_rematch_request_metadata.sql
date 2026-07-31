ALTER TABLE games ADD COLUMN rematch_game_id TEXT REFERENCES games(id);
ALTER TABLE games ADD COLUMN rematch_requested_by TEXT CHECK (
  rematch_requested_by IS NULL OR rematch_requested_by IN ('black', 'white')
);
ALTER TABLE games ADD COLUMN rematch_requested_at TEXT;

CREATE INDEX IF NOT EXISTS games_rematch_game_id_idx
  ON games (rematch_game_id);
