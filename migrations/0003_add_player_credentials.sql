ALTER TABLE games ADD COLUMN black_player_token_digest TEXT;
ALTER TABLE games ADD COLUMN white_player_token_digest TEXT;
ALTER TABLE games ADD COLUMN white_invite_token_digest TEXT;
ALTER TABLE games ADD COLUMN white_joined INTEGER NOT NULL DEFAULT 0 CHECK (white_joined IN (0, 1));
ALTER TABLE games ADD COLUMN black_player_created_at TEXT;
ALTER TABLE games ADD COLUMN white_invite_created_at TEXT;
ALTER TABLE games ADD COLUMN white_invite_claimed_at TEXT;
ALTER TABLE games ADD COLUMN white_player_created_at TEXT;

UPDATE games
SET black_player_token_digest = COALESCE(
    black_player_token_digest,
    '0000000000000000000000000000000000000000000000000000000000000000'
  ),
  white_invite_token_digest = COALESCE(
    white_invite_token_digest,
    '0000000000000000000000000000000000000000000000000000000000000000'
  ),
  black_player_created_at = COALESCE(black_player_created_at, created_at),
  white_invite_created_at = COALESCE(white_invite_created_at, created_at);

CREATE INDEX IF NOT EXISTS games_black_player_token_digest_idx
  ON games (black_player_token_digest);
CREATE INDEX IF NOT EXISTS games_white_player_token_digest_idx
  ON games (white_player_token_digest);
