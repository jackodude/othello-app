CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_color TEXT NOT NULL CHECK (player_color IN ('black', 'white')),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE (game_id, player_color, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_game_player_idx
  ON push_subscriptions (game_id, player_color);

CREATE TABLE IF NOT EXISTS push_notification_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  game_version INTEGER NOT NULL CHECK (game_version >= 1),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('white_joined', 'your_turn', 'game_finished')
  ),
  recipient_player_color TEXT NOT NULL CHECK (recipient_player_color IN ('black', 'white')),
  delivery_state TEXT NOT NULL CHECK (
    delivery_state IN ('pending', 'sent', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE (game_id, game_version, event_type, recipient_player_color)
);

CREATE INDEX IF NOT EXISTS push_notification_events_pending_idx
  ON push_notification_events (delivery_state, attempts);
