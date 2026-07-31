ALTER TABLE games ADD COLUMN ended_reason TEXT CHECK (
  ended_reason IS NULL OR ended_reason IN ('normal', 'forfeit', 'cancelled')
);
ALTER TABLE games ADD COLUMN forfeited_by TEXT CHECK (
  forfeited_by IS NULL OR forfeited_by IN ('black', 'white')
);
