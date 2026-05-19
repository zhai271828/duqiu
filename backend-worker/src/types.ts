export interface Env {
  DB: D1Database
  FIREBASE_API_KEY?: string
  FIREBASE_PROJECT_ID?: string
  FIREBASE_AUTH_BASE_URL?: string
  FIREBASE_SECURE_TOKEN_BASE_URL?: string
  FIREBASE_PUBLIC_KEYS_URL?: string
  ADMIN_EMAILS?: string
  ODDS_API_KEY?: string
  ODDS_API_BASE_URL?: string
  ODDS_API_MONTHLY_QUOTA?: string
  ODDS_API_DAILY_LIMIT?: string
  FOOTBALL_DATA_API_KEY?: string
  FOOTBALL_DATA_BASE_URL?: string
  THE_SPORTS_DB_BASE_URL?: string
}

export interface DbUser {
  id: number
  username: string
  email: string
  firebase_uid: string | null
  balance: number
  email_verified: number
  is_admin: number
  created_at: string
  updated_at: string
}

export interface DbMatchSummaryRow {
  id: number
  external_id: string | null
  sport: string
  league: string
  home_team: string
  away_team: string
  start_time: string
  status: string
  home_score: number | null
  away_score: number | null
  odds_count: number
  avg_home_odds: number | null
  avg_draw_odds: number | null
  avg_away_odds: number | null
}

export interface DbMatchRow {
  id: number
  external_id: string | null
  sport: string
  league: string
  home_team: string
  away_team: string
  start_time: string
  status: string
  home_score: number | null
  away_score: number | null
  created_at: string
}

export interface DbOddsRow {
  id: number
  match_id: number
  bookmaker: string
  market: string
  home_odds: number | null
  away_odds: number | null
  draw_odds: number | null
  updated_at: string
}

export interface DbBetRow {
  id: number
  user_id: number
  match_id: number
  bet_type: string
  selection: string
  odds: number
  amount: number
  potential_win: number
  status: string
  profit: number | null
  settled_at: string | null
  created_at: string
  home_team?: string
  away_team?: string
  league?: string
  start_time?: string
}

export interface OddsApiEvent {
  id: string
  sport_key?: string
  home_team: string
  away_team: string
  commence_time: string
  sport_title?: string
  bookmakers?: Array<{
    title: string
    markets?: Array<{
      key: string
      outcomes?: Array<{
        name: string
        price: number
      }>
    }>
  }>
}

export interface ScoreApiEvent {
  id: string
  match_id?: number
  sport_key?: string
  sport_title?: string
  commence_time: string
  completed: boolean
  home_team: string
  away_team: string
  status?: string
  scores?: Array<{
    name: string
    score: string | number | null
  }>
  last_update?: string
}

export interface ResultSyncCandidate {
  match_id: number
  external_id: string | null
  sport: string
  league: string
  home_team: string
  away_team: string
  start_time: string
  status: string
}

export interface ScheduleEvent {
  external_id: string
  home_team: string
  away_team: string
  league: string
  league_cn?: string
  start_time: string
  status: string
  home_score?: number | null
  away_score?: number | null
}
