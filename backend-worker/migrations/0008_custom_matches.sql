ALTER TABLE matches ADD COLUMN source_type TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE matches ADD COLUMN allow_draw INTEGER NOT NULL DEFAULT 1;

UPDATE matches
SET source_type = 'synced'
WHERE source_type IS NULL OR source_type = '';

UPDATE matches
SET allow_draw = CASE
  WHEN sport = 'basketball' OR upper(league) = 'NBA' THEN 0
  ELSE 1
END;

CREATE INDEX IF NOT EXISTS idx_matches_source_type ON matches (source_type);
