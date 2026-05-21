export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    firebase_uid TEXT,
    balance REAL NOT NULL DEFAULT 10000,
    email_verified INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE,
    sport TEXT NOT NULL,
    league TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    start_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    source_type TEXT NOT NULL DEFAULT 'synced',
    allow_draw INTEGER NOT NULL DEFAULT 1,
    has_home_away INTEGER NOT NULL DEFAULT 1,
    home_score INTEGER,
    away_score INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS odds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    bookmaker TEXT NOT NULL,
    market TEXT NOT NULL,
    home_odds REAL,
    away_odds REAL,
    draw_odds REAL,
    updated_at TEXT NOT NULL,
    UNIQUE(match_id, bookmaker, market),
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS bets (
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
  )`,
  `CREATE TABLE IF NOT EXISTS user_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    amount REAL NOT NULL,
    redeemed_at TEXT NOT NULL,
    UNIQUE(user_id, code),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
   ON users (firebase_uid) WHERE firebase_uid IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active
   ON users (username) WHERE firebase_uid IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
   ON users (email) WHERE firebase_uid IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_matches_sport_start_time ON matches (sport, start_time)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_league ON matches (league)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_source_type ON matches (source_type)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_match_id ON bets (match_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bets_status ON bets (status)`,
  `CREATE INDEX IF NOT EXISTS idx_user_redemptions_user_id ON user_redemptions (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_odds_match_id ON odds (match_id)`
]
