CREATE TABLE IF NOT EXISTS user_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  amount REAL NOT NULL,
  redeemed_at TEXT NOT NULL,
  UNIQUE(user_id, code),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_redemptions_user_id
ON user_redemptions (user_id);
