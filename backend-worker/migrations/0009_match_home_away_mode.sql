ALTER TABLE matches ADD COLUMN has_home_away INTEGER NOT NULL DEFAULT 1;

UPDATE matches
SET has_home_away = 1;
