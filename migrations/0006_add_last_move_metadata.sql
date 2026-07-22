ALTER TABLE games ADD COLUMN last_move_version INTEGER;
ALTER TABLE games ADD COLUMN last_move_player TEXT CHECK (
  last_move_player IS NULL OR last_move_player IN ('black', 'white')
);
ALTER TABLE games ADD COLUMN last_move_placed_index INTEGER CHECK (
  last_move_placed_index IS NULL OR (
    last_move_placed_index >= 0 AND last_move_placed_index < 64
  )
);
ALTER TABLE games ADD COLUMN last_move_flipped_indices_json TEXT;
