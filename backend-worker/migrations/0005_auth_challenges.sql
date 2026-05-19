CREATE TABLE IF NOT EXISTS auth_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  firebase_uid TEXT,
  code_hash TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  resend_available_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_email_purpose
ON auth_challenges (email, purpose);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_active
ON auth_challenges (purpose, email, consumed_at, expires_at);
