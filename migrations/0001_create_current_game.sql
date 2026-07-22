CREATE TABLE IF NOT EXISTS current_game (
  singleton_key TEXT PRIMARY KEY CHECK (singleton_key = 'current'),
  id TEXT NOT NULL,
  board_json TEXT NOT NULL,
  current_player TEXT NOT NULL CHECK (current_player IN ('black', 'white')),
  status TEXT NOT NULL CHECK (status IN ('playing', 'finished')),
  winner TEXT CHECK (winner IS NULL OR winner IN ('black', 'white', 'draw')),
  black_score INTEGER NOT NULL CHECK (black_score >= 0),
  white_score INTEGER NOT NULL CHECK (white_score >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  consecutive_passes INTEGER NOT NULL CHECK (consecutive_passes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
