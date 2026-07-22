ALTER TABLE games ADD COLUMN rematch_of_game_id TEXT REFERENCES games(id);
ALTER TABLE games ADD COLUMN black_joined INTEGER NOT NULL DEFAULT 1 CHECK (black_joined IN (0, 1));
ALTER TABLE games ADD COLUMN black_invite_token_digest TEXT;
ALTER TABLE games ADD COLUMN black_invite_created_at TEXT;
ALTER TABLE games ADD COLUMN black_invite_claimed_at TEXT;

CREATE INDEX IF NOT EXISTS games_rematch_of_game_id_idx
  ON games (rematch_of_game_id);
