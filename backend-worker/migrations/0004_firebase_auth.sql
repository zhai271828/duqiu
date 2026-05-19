PRAGMA foreign_keys=OFF;

ALTER TABLE bets RENAME TO bets_legacy;
ALTER TABLE users RENAME TO users_legacy;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  firebase_uid TEXT,
  balance REAL NOT NULL DEFAULT 10000,
  email_verified INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  bet_type TEXT NOT NULL DEFAULT 'h2h',
  selection TEXT NOT NULL,
  odds REAL NOT NULL,
  amount REAL NOT NULL,
  potential_win REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  profit REAL,
  settled_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

INSERT INTO users (
  id,
  username,
  email,
  firebase_uid,
  balance,
  email_verified,
  is_admin,
  created_at,
  updated_at
)
SELECT
  id,
  username,
  email,
  NULL,
  balance,
  email_verified,
  is_admin,
  created_at,
  created_at
FROM users_legacy;

INSERT INTO bets (
  id,
  user_id,
  match_id,
  bet_type,
  selection,
  odds,
  amount,
  potential_win,
  status,
  profit,
  settled_at,
  created_at
)
SELECT
  id,
  user_id,
  match_id,
  bet_type,
  selection,
  odds,
  amount,
  potential_win,
  status,
  profit,
  settled_at,
  created_at
FROM bets_legacy;

DROP TABLE users_legacy;
DROP TABLE bets_legacy;

DROP TABLE IF EXISTS email_verifications;

CREATE UNIQUE INDEX idx_users_firebase_uid ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE UNIQUE INDEX idx_users_username_active ON users (username) WHERE firebase_uid IS NOT NULL;
CREATE UNIQUE INDEX idx_users_email_active ON users (email) WHERE firebase_uid IS NOT NULL;
CREATE INDEX idx_bets_user_id ON bets (user_id);
CREATE INDEX idx_bets_match_id ON bets (match_id);
CREATE INDEX idx_bets_status ON bets (status);

PRAGMA foreign_keys=ON;
