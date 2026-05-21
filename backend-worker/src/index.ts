import {
  FirebaseApiError,
  firebaseCompleteEmailVerification,
  firebaseLookupByIdToken,
  firebaseRefreshToken,
  firebaseSendPasswordResetEmail,
  firebaseSendVerificationEmail,
  firebaseSignIn,
  firebaseSignUp,
  verifyFirebaseIdToken,
  type FirebaseSession,
  type FirebaseVerifiedToken
} from './firebase.ts'
import {
  POPULAR_DISPLAY_LEAGUES,
  POPULAR_ODDS_SPORTS,
  fetchFootballDataResults,
  fetchOpenLigaDbResults,
  fetchOddsSnapshot,
  fetchScheduleSnapshot,
  fetchScoresSnapshot,
  fetchTheSportsDbResults
} from './providers.ts'
import { SCHEMA_STATEMENTS } from './schema.ts'
import { bearerTokenFromRequest } from './security.ts'
import { translateLeague, translateTeam } from './translations.ts'
import type {
  DbBetRow,
  DbMatchRow,
  DbMatchSummaryRow,
  DbOddsRow,
  DbUser,
  Env,
  OddsApiEvent,
  ResultSyncCandidate,
  ScheduleEvent,
  ScoreApiEvent
} from './types.ts'
import {
  buildSelectionTexts,
  buildSideLabels,
  boolFromQuery,
  buildMatchResponse,
  empty,
  errorResponse,
  json,
  normalizeUtcIso,
  nowIso,
  readJson,
  round2,
  shanghaiDateRange
} from './utils.ts'

const REDEEM_CODES: Record<string, number> = {
  can666: 10000,
  test888: 5000,
  vip2024: 20000
}

const DEFAULT_ADMIN_EMAIL = 'admin@example.com'

type CustomMatchPayload = {
  sport?: string
  league?: string
  home_team?: string
  away_team?: string
  start_time?: string
  allow_draw?: boolean
  has_home_away?: boolean
  odds?: {
    home?: number
    draw?: number | null
    away?: number
  }
}

type CustomMatchSettlementPayload = {
  home_score?: number
  away_score?: number
}

type ValidatedCustomMatchInput = {
  sport: 'soccer' | 'basketball' | 'other'
  league: string
  homeTeam: string
  awayTeam: string
  startTimeIso: string
  allowDraw: boolean
  hasHomeAway: boolean
  homeOdds: number
  drawOdds: number | null
  awayOdds: number
}

let schemaReady: Promise<void> | null = null
let seedReady: Promise<void> | null = null

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return empty({ status: 204 })
    }

    try {
      await ensureSchema(env)
      await ensureSeedData(env)
      return await handleRequest(request, env)
    } catch (error) {
      console.error('Unhandled worker error', error)
      return errorResponse('服务器内部错误', 500)
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledResultSyncAndSettlement(env, new Date(controller.scheduledTime)))
  }
}

async function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await env.DB.prepare(statement).run()
      }
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }

  await schemaReady
}

async function ensureSeedData(env: Env): Promise<void> {
  if (!seedReady) {
    seedReady = (async () => {
      const adminRow = await env.DB.prepare(
        `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
         FROM users WHERE username = 'admin'
         ORDER BY id
         LIMIT 1`
      ).first<DbUser>()

      const targetEmail = getPrimaryAdminEmail(env)
      const now = nowIso()

      if (!adminRow) {
        await env.DB.prepare(
          `INSERT INTO users (username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at)
           VALUES ('admin', ?, NULL, 10000, 1, 1, ?, ?)`
        ).bind(targetEmail, now, now).run()
        return
      }

      const nextIsAdmin = 1
      const nextEmailVerified = 1
      const nextFirebaseUid = adminRow.email === targetEmail ? adminRow.firebase_uid : null
      if (
        adminRow.is_admin !== nextIsAdmin ||
        adminRow.email_verified !== nextEmailVerified ||
        adminRow.email !== targetEmail ||
        adminRow.firebase_uid !== nextFirebaseUid
      ) {
        await env.DB.prepare(
          `UPDATE users
           SET email = ?, firebase_uid = ?, email_verified = ?, is_admin = ?, updated_at = ?
           WHERE id = ?`
        ).bind(targetEmail, nextFirebaseUid, nextEmailVerified, nextIsAdmin, now, adminRow.id).run()
      }
    })().catch((error) => {
      seedReady = null
      throw error
    })
  }

  await seedReady
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const pathname = normalizePath(url.pathname)

  if (pathname === '/' || pathname === '/api/health') {
    return json({
      status: 'ok',
      runtime: 'cloudflare-workers',
      database: 'd1'
    })
  }

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    return handleRegister(request, env)
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env)
  }

  if (pathname === '/api/auth/forgot-password' && request.method === 'POST') {
    return handleForgotPassword(request, env)
  }

  if (pathname === '/api/auth/refresh' && request.method === 'POST') {
    return handleRefresh(request, env)
  }

  if (pathname === '/api/auth/resend-verification' && request.method === 'POST') {
    return handleResendVerification(request, env)
  }

  if (pathname === '/api/auth/complete-email-verification' && request.method === 'POST') {
    return handleCompleteEmailVerification(request, env)
  }

  if (pathname === '/api/auth/profile' && request.method === 'GET') {
    return handleProfile(request, env)
  }

  if (pathname === '/api/auth/redeem' && request.method === 'POST') {
    return handleRedeem(request, env)
  }

  if (pathname === '/api/matches' && request.method === 'GET') {
    return handleGetMatches(url, env)
  }

  if (pathname === '/api/matches/leagues' && request.method === 'GET') {
    return handleGetLeagues(url, env)
  }

  if (pathname === '/api/matches/sync' && request.method === 'POST') {
    return handleSyncOdds(request, url, env)
  }

  if (pathname === '/api/matches/sync-schedule' && request.method === 'POST') {
    return handleSyncSchedule(request, url, env)
  }

  if (pathname === '/api/matches/sync-all' && request.method === 'POST') {
    return handleSyncAll(request, url, env)
  }

  if (pathname === '/api/matches/validate-odds' && request.method === 'GET') {
    return handleValidateOdds(env)
  }

  const matchDetail = pathname.match(/^\/api\/matches\/(\d+)$/)
  if (matchDetail && request.method === 'GET') {
    return handleGetMatch(env, Number(matchDetail[1]))
  }

  if (pathname === '/api/bets' && request.method === 'POST') {
    return handlePlaceBet(request, env)
  }

  if (pathname === '/api/bets' && request.method === 'GET') {
    return handleGetUserBets(request, url, env)
  }

  const betDetail = pathname.match(/^\/api\/bets\/(\d+)$/)
  if (betDetail && request.method === 'GET') {
    return handleGetBet(request, env, Number(betDetail[1]))
  }

  if (pathname === '/api/stats/me' && request.method === 'GET') {
    return handleMyStats(request, env)
  }

  if (pathname === '/api/stats/leaderboard' && request.method === 'GET') {
    return handleLeaderboard(url, env)
  }

  if (pathname === '/api/stats/homepage' && request.method === 'GET') {
    return handleHomepageStats(env)
  }

  if (pathname === '/api/admin/bets' && request.method === 'GET') {
    return handleAdminBets(request, url, env)
  }

  if (pathname === '/api/admin/matches' && request.method === 'GET') {
    return handleAdminMatches(request, url, env)
  }

  if (pathname === '/api/admin/matches' && request.method === 'POST') {
    return handleCreateAdminMatch(request, env)
  }

  const adminMatchDetail = pathname.match(/^\/api\/admin\/matches\/(\d+)$/)
  if (adminMatchDetail && request.method === 'GET') {
    return handleGetAdminMatch(request, env, Number(adminMatchDetail[1]))
  }

  if (adminMatchDetail && request.method === 'PUT') {
    return handleUpdateAdminMatch(request, env, Number(adminMatchDetail[1]))
  }

  const adminMatchSettle = pathname.match(/^\/api\/admin\/matches\/(\d+)\/settle$/)
  if (adminMatchSettle && request.method === 'POST') {
    return handleSettleAdminMatch(request, env, Number(adminMatchSettle[1]))
  }

  if (pathname === '/api/admin/users' && request.method === 'GET') {
    return handleAdminUsers(request, url, env)
  }

  if (pathname === '/api/admin/system' && request.method === 'GET') {
    return handleAdminSystem(request, env)
  }

  return errorResponse('接口不存在', 404)
}

function normalizePath(pathname: string): string {
  if (pathname === '/') return pathname
  return pathname.replace(/\/+$/g, '')
}

function popularLeaguePlaceholders(): string {
  return POPULAR_DISPLAY_LEAGUES.map(() => '?').join(', ')
}

function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function publicMatchVisibilityClause(alias: string): string {
  return `(${alias}.league IN (${popularLeaguePlaceholders()}) OR ${alias}.source_type = 'custom')`
}

function defaultAllowDrawForSport(sport: string): number {
  return sport === 'basketball' ? 0 : 1
}

function readPositiveInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function readPagination(url: URL, defaultPageSize = 20, maxPageSize = 100) {
  const page = readPositiveInteger(url.searchParams.get('page'), 1, 1, 100000)
  const pageSize = readPositiveInteger(url.searchParams.get('page_size'), defaultPageSize, 1, maxPageSize)

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  }
}

function isSoccerLeague(league: string): boolean {
  return league !== 'NBA'
}

function isBasketballLeague(league: string): boolean {
  return league === 'NBA'
}

function oddsColumnForSelection(selection: string): 'home_odds' | 'draw_odds' | 'away_odds' | null {
  if (selection === 'home') return 'home_odds'
  if (selection === 'draw') return 'draw_odds'
  if (selection === 'away') return 'away_odds'
  return null
}

function normalizeCustomMatchSport(value: string | null | undefined): 'soccer' | 'basketball' | 'other' | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'soccer' || normalized === 'basketball' || normalized === 'other') {
    return normalized
  }
  return null
}

function isPositiveOddsValue(value: unknown): value is number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 1
}

function parseScoreValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

function getShanghaiDateKey(date = new Date()): string {
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return beijingTime.toISOString().slice(0, 10)
}

function getShanghaiHour(date = new Date()): number {
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return beijingTime.getUTCHours()
}

function isAutoSettlementWindow(date = new Date()): boolean {
  const hour = getShanghaiHour(date)
  return hour >= 8 && hour <= 23
}

function readOddsApiDailyLimit(env: Env): number {
  const parsed = Number(env.ODDS_API_DAILY_LIMIT || '16')
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 16
}

function allowedResultStatus(status: string | undefined): string {
  if (status === 'finished' || status === 'live' || status === 'postponed' || status === 'cancelled') {
    return status
  }
  return 'upcoming'
}

function deriveMatchStatusFromScoreEvent(
  event: { completed: boolean; commence_time: string; status?: string },
  date = new Date()
): string {
  const explicitStatus = allowedResultStatus(event.status)
  if (explicitStatus !== 'upcoming') return explicitStatus
  if (event.completed) return 'finished'

  const commenceTime = new Date(event.commence_time)
  if (!Number.isNaN(commenceTime.getTime()) && commenceTime.getTime() <= date.getTime()) {
    return 'live'
  }

  return 'upcoming'
}

function toUserResponse(
  user: Pick<DbUser, 'id' | 'username' | 'email' | 'balance' | 'email_verified' | 'created_at' | 'is_admin'>
) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    balance: Number(user.balance),
    email_verified: user.email_verified === 1,
    is_admin: user.is_admin === 1,
    created_at: normalizeUtcIso(user.created_at)
  }
}

function toOddsResponse(odds: DbOddsRow) {
  return {
    id: odds.id,
    bookmaker: odds.bookmaker,
    market: odds.market,
    home_odds: odds.home_odds === null ? null : Number(odds.home_odds),
    away_odds: odds.away_odds === null ? null : Number(odds.away_odds),
    draw_odds: odds.draw_odds === null ? null : Number(odds.draw_odds),
    updated_at: normalizeUtcIso(odds.updated_at)
  }
}

function toBetResponse(bet: DbBetRow) {
  const homeTeam = bet.home_team ? translateTeam(bet.home_team) : ''
  const awayTeam = bet.away_team ? translateTeam(bet.away_team) : ''
  const hasHomeAway = bet.has_home_away === 1
  return {
    id: bet.id,
    user_id: bet.user_id,
    match_id: bet.match_id,
    bet_type: bet.bet_type,
    selection: bet.selection,
    odds: Number(bet.odds),
    amount: Number(bet.amount),
    potential_win: Number(bet.potential_win),
    status: bet.status,
    profit: bet.profit === null ? null : Number(bet.profit),
    settled_at: normalizeUtcIso(bet.settled_at),
    created_at: normalizeUtcIso(bet.created_at),
        match: bet.home_team
      ? {
          home_team: homeTeam,
          away_team: awayTeam,
          league: translateLeague(bet.league),
          start_time: normalizeUtcIso(bet.start_time),
          allow_draw: bet.allow_draw === 1,
          has_home_away: hasHomeAway,
          side_labels: buildSideLabels(hasHomeAway),
          selection_texts: buildSelectionTexts(homeTeam, awayTeam, hasHomeAway)
        }
      : null
  }
}

function toAdminMatchResponse(row: {
  id: number
  external_id: string | null
  sport: string
  league: string
  home_team: string
  away_team: string
  start_time: string
  status: string
  source_type: string
  allow_draw: number
  has_home_away: number
  home_score: number | null
  away_score: number | null
  created_at: string
  total_bets?: number | null
  pending_bets?: number | null
  avg_home_odds?: number | null
  avg_draw_odds?: number | null
  avg_away_odds?: number | null
}) {
  const hasHomeAway = row.has_home_away === 1
  return {
    id: row.id,
    external_id: row.external_id,
    sport: row.sport,
    league: row.league,
    home_team: row.home_team,
    away_team: row.away_team,
    start_time: normalizeUtcIso(row.start_time),
    status: row.status,
    source_type: row.source_type,
    allow_draw: row.allow_draw === 1,
    has_home_away: hasHomeAway,
    side_labels: buildSideLabels(hasHomeAway),
    selection_texts: buildSelectionTexts(row.home_team, row.away_team, hasHomeAway),
    home_score: row.home_score,
    away_score: row.away_score,
    created_at: normalizeUtcIso(row.created_at),
    total_bets: Number(row.total_bets || 0),
    pending_bets: Number(row.pending_bets || 0),
    locked: Number(row.total_bets || 0) > 0,
    odds: {
      home: row.avg_home_odds === null || row.avg_home_odds === undefined ? null : round2(Number(row.avg_home_odds)),
      draw: row.avg_draw_odds === null || row.avg_draw_odds === undefined ? null : round2(Number(row.avg_draw_odds)),
      away: row.avg_away_odds === null || row.avg_away_odds === undefined ? null : round2(Number(row.avg_away_odds))
    }
  }
}

function legacyValidateCustomMatchInput(body: CustomMatchPayload | null): any {
  const sport = normalizeCustomMatchSport(body?.sport)
  if (!sport) {
    return errorResponse('仅支持 soccer 或 basketball', 400)
  }

  const league = String(body?.league || '').trim()
  const homeTeam = String(body?.home_team || '').trim()
  const awayTeam = String(body?.away_team || '').trim()
  const startTimeRaw = String(body?.start_time || '').trim()
  const allowDraw = typeof body?.allow_draw === 'boolean' ? body.allow_draw : null
  const hasHomeAway = typeof body?.has_home_away === 'boolean' ? body.has_home_away : null
  const startTimeMs = Date.parse(startTimeRaw)

  if (!league || !homeTeam || !awayTeam || !startTimeRaw) {
    return errorResponse('请填写完整的比赛信息', 400)
  }

  if (homeTeam.toLowerCase() === awayTeam.toLowerCase()) {
    return errorResponse('主队和客队不能相同', 400)
  }

  if (allowDraw === null) {
    return errorResponse('请明确设置是否允许平局', 400)
  }

  if (!Number.isFinite(startTimeMs)) {
    return errorResponse('开赛时间格式无效', 400)
  }

  if (startTimeMs <= Date.now()) {
    return errorResponse('开赛时间必须晚于当前时间', 400)
  }

  const homeOdds = Number(body?.odds?.home)
  const drawOddsValue = body?.odds?.draw
  const awayOdds = Number(body?.odds?.away)

  if (!isPositiveOddsValue(homeOdds) || !isPositiveOddsValue(awayOdds)) {
    return errorResponse('主胜和客胜赔率必须大于 1', 400)
  }

  if (allowDraw) {
    if (!isPositiveOddsValue(drawOddsValue)) {
      return errorResponse('允许平局时，平局赔率必须大于 1', 400)
    }
  } else if (drawOddsValue !== null && drawOddsValue !== undefined) {
    return errorResponse('不允许平局的比赛不能设置平局赔率', 400)
  }

  return {
    sport,
    league,
    homeTeam,
    awayTeam,
    startTimeIso: new Date(startTimeMs).toISOString(),
    allowDraw,
    homeOdds: round2(homeOdds),
    drawOdds: allowDraw ? round2(Number(drawOddsValue)) : null,
    awayOdds: round2(awayOdds)
  }
}

function validateCustomMatchInput(body: CustomMatchPayload | null): ValidatedCustomMatchInput | Response {
  const sport = normalizeCustomMatchSport(body?.sport)
  if (!sport) {
    return errorResponse('仅支持 soccer、basketball 或 other', 400)
  }

  const league = String(body?.league || '').trim()
  const homeTeam = String(body?.home_team || '').trim()
  const awayTeam = String(body?.away_team || '').trim()
  const startTimeRaw = String(body?.start_time || '').trim()
  const allowDraw = typeof body?.allow_draw === 'boolean' ? body.allow_draw : null
  const hasHomeAway = typeof body?.has_home_away === 'boolean' ? body.has_home_away : null
  const startTimeMs = Date.parse(startTimeRaw)

  if (!league || !homeTeam || !awayTeam || !startTimeRaw) {
    return errorResponse('请填写完整的比赛信息', 400)
  }

  if (homeTeam.toLowerCase() === awayTeam.toLowerCase()) {
    return errorResponse('两边名称不能相同', 400)
  }

  if (allowDraw === null) {
    return errorResponse('请明确设置是否允许平局', 400)
  }

  if (hasHomeAway === null) {
    return errorResponse('请明确设置是否有主客场', 400)
  }

  if (!Number.isFinite(startTimeMs)) {
    return errorResponse('开赛时间格式无效', 400)
  }

  if (startTimeMs <= Date.now()) {
    return errorResponse('开赛时间必须晚于当前时间', 400)
  }

  const homeOdds = Number(body?.odds?.home)
  const drawOddsValue = body?.odds?.draw
  const awayOdds = Number(body?.odds?.away)

  if (!isPositiveOddsValue(homeOdds) || !isPositiveOddsValue(awayOdds)) {
    return errorResponse('两边胜出赔率必须大于 1', 400)
  }

  if (allowDraw) {
    if (!isPositiveOddsValue(drawOddsValue)) {
      return errorResponse('允许平局时，平局赔率必须大于 1', 400)
    }
  } else if (drawOddsValue !== null && drawOddsValue !== undefined) {
    return errorResponse('不允许平局的比赛不能设置平局赔率', 400)
  }

  return {
    sport,
    league,
    homeTeam,
    awayTeam,
    startTimeIso: new Date(startTimeMs).toISOString(),
    allowDraw,
    hasHomeAway,
    homeOdds: round2(homeOdds),
    drawOdds: allowDraw ? round2(Number(drawOddsValue)) : null,
    awayOdds: round2(awayOdds)
  }
}

async function resolveServerBetOdds(
  env: Env,
  matchId: number,
  selection: string,
  bookmaker?: string
): Promise<{ odds: number; source: 'average' | 'bookmaker'; bookmaker?: string; oddsCount: number } | null> {
  const oddsColumn = oddsColumnForSelection(selection)
  if (!oddsColumn) return null

  const normalizedBookmaker = bookmaker?.trim()
  if (normalizedBookmaker) {
    const row = await env.DB.prepare(
      `SELECT bookmaker, ${oddsColumn} AS odds
       FROM odds
       WHERE match_id = ?
         AND market = 'h2h'
         AND lower(bookmaker) = lower(?)
         AND ${oddsColumn} IS NOT NULL
         AND ${oddsColumn} > 0
       LIMIT 1`
    ).bind(matchId, normalizedBookmaker).first<{ bookmaker: string; odds: number | null }>()

    const odds = Number(row?.odds)
    if (!row || !Number.isFinite(odds) || odds <= 0) return null

    return {
      odds: round2(odds),
      source: 'bookmaker',
      bookmaker: row.bookmaker,
      oddsCount: 1
    }
  }

  const row = await env.DB.prepare(
    `SELECT AVG(${oddsColumn}) AS odds, COUNT(${oddsColumn}) AS odds_count
     FROM odds
     WHERE match_id = ?
       AND market = 'h2h'
       AND ${oddsColumn} IS NOT NULL
       AND ${oddsColumn} > 0`
  ).bind(matchId).first<{ odds: number | null; odds_count: number }>()

  const odds = Number(row?.odds)
  const oddsCount = Number(row?.odds_count || 0)
  if (!Number.isFinite(odds) || odds <= 0 || oddsCount <= 0) return null

  return {
    odds: round2(odds),
    source: 'average',
    oddsCount
  }
}

async function requireUserId(request: Request, env: Env): Promise<number | Response> {
  const token = bearerTokenFromRequest(request)
  if (!token) {
    return json({ msg: 'Missing Authorization Header' }, { status: 401 })
  }

  try {
    const verifiedToken = await verifyFirebaseIdToken(env, token)
    const user = await resolveUserFromToken(env, token, verifiedToken)
    return user.id
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '登录状态已失效，请重新登录',
      defaultStatus: 401
    })
  }
}

async function requireAdminUserId(request: Request, env: Env): Promise<number | Response> {
  const userId = await requireUserId(request, env)
  if (userId instanceof Response) return userId

  const user = await getUserById(env, userId)
  if (!user) {
    return errorResponse('用户不存在', 404)
  }

  if (user.is_admin !== 1) {
    return errorResponse('无权访问管理功能', 403)
  }

  return userId
}

async function getUserById(env: Env, userId: number): Promise<DbUser | null> {
  return (await env.DB.prepare(
    `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
     FROM users WHERE id = ?`
  ).bind(userId).first<DbUser>()) ?? null
}

async function getUserByUsername(env: Env, username: string): Promise<DbUser | null> {
  return (await env.DB.prepare(
    `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
     FROM users WHERE username = ?`
   ).bind(username).first<DbUser>()) ?? null
}

async function getUserByEmail(env: Env, email: string): Promise<DbUser | null> {
  return (await env.DB.prepare(
    `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
     FROM users WHERE email = ?`
   ).bind(email).first<DbUser>()) ?? null
}

async function getUserByFirebaseUid(env: Env, firebaseUid: string): Promise<DbUser | null> {
  return (await env.DB.prepare(
    `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
     FROM users WHERE firebase_uid = ?`
  ).bind(firebaseUid).first<DbUser>()) ?? null
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT value FROM app_settings WHERE key = ?`
  ).bind(key).first<{ value: string }>()

  return row?.value ?? null
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, nowIso()).run()
}

async function countPendingBets(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM bets b
     JOIN matches m ON m.id = b.match_id
     WHERE b.status = 'pending'
       AND m.source_type = 'synced'
       AND m.league IN (${popularLeaguePlaceholders()})`
  ).bind(...POPULAR_DISPLAY_LEAGUES).first<{ count: number }>()

  return Number(row?.count || 0)
}

async function getPendingResultCandidates(env: Env, date = new Date()): Promise<ResultSyncCandidate[]> {
  const candidateCutoffIso = date.toISOString()
  const result = await env.DB.prepare(
    `SELECT DISTINCT
       m.id AS match_id,
       m.external_id,
       m.sport,
       m.league,
       m.home_team,
       m.away_team,
       m.start_time,
       m.status,
       m.source_type,
       m.allow_draw
     FROM bets b
     JOIN matches m ON m.id = b.match_id
     WHERE b.status = 'pending'
       AND m.source_type = 'synced'
       AND m.league IN (${popularLeaguePlaceholders()})
       AND m.status IN ('upcoming', 'live', 'finished', 'postponed', 'cancelled')
       AND datetime(m.start_time) <= datetime(?)
       AND NOT (m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)
     ORDER BY datetime(m.start_time) ASC
     LIMIT 100`
  ).bind(...POPULAR_DISPLAY_LEAGUES, candidateCutoffIso).all<ResultSyncCandidate>()

  return result.results ?? []
}

function getTrackedScoreEventIds(candidates: ResultSyncCandidate[]): Record<string, string[]> {
  const sportKeyByLeague: Record<string, string> = {}
  for (const config of POPULAR_ODDS_SPORTS) {
    sportKeyByLeague[config.displayLeague] = config.key
  }

  const grouped: Record<string, string[]> = {}
  for (const row of candidates) {
    if (!row.external_id || row.external_id.startsWith('fd_') || row.external_id.startsWith('openliga_')) {
      continue
    }

    const sportKey = sportKeyByLeague[row.league]
    if (!sportKey) continue
    grouped[sportKey] ||= []
    if (!grouped[sportKey].includes(row.external_id)) {
      grouped[sportKey].push(row.external_id)
    }
  }

  return grouped
}

function limitEventIdsByRequestBudget(
  eventIdsBySport: Record<string, string[]>,
  requestBudget: number
): Record<string, string[]> {
  if (requestBudget <= 0) return {}

  const limited: Record<string, string[]> = {}
  let used = 0
  for (const sportConfig of POPULAR_ODDS_SPORTS) {
    const eventIds = eventIdsBySport[sportConfig.key] || []
    if (eventIds.length === 0) continue
    if (used >= requestBudget) break
    limited[sportConfig.key] = eventIds
    used += 1
  }

  return limited
}

function countScoreRequests(eventIdsBySport: Record<string, string[]>): number {
  return Object.values(eventIdsBySport).filter((eventIds) => eventIds.length > 0).length
}

function hasFallbackOnlyCandidate(candidates: ResultSyncCandidate[]): boolean {
  return candidates.some(
    (candidate) =>
      !candidate.external_id ||
      candidate.external_id.startsWith('fd_') ||
      candidate.external_id.startsWith('openliga_') ||
      candidate.external_id.startsWith('tsdb_')
  )
}

function matchIdByExternalId(candidates: ResultSyncCandidate[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.external_id) {
      map.set(candidate.external_id, candidate.match_id)
    }
  }
  return map
}

async function getOddsApiDailyUsage(env: Env, dateKey: string): Promise<number> {
  const storedDate = await getSetting(env, 'settlement_odds_api_daily_date')
  if (storedDate !== dateKey) return 0

  const used = Number((await getSetting(env, 'settlement_odds_api_daily_used')) || '0')
  return Number.isFinite(used) && used > 0 ? used : 0
}

async function setOddsApiDailyUsage(env: Env, dateKey: string, used: number, limit: number): Promise<void> {
  await setSetting(env, 'settlement_odds_api_daily_date', dateKey)
  await setSetting(env, 'settlement_odds_api_daily_used', String(Math.max(0, used)))
  await setSetting(env, 'settlement_odds_api_daily_limit', String(limit))
}

async function recordResultSyncSkip(env: Env, reason: string): Promise<void> {
  await setSetting(env, 'settlement_last_skip_reason', reason)
}

async function recordResultProvider(env: Env, provider: string): Promise<void> {
  await setSetting(env, 'settlement_last_result_provider', provider)
}

async function applyScoreEvents(
  env: Env,
  events: Array<{
    id: string
    match_id?: number
    commence_time: string
    completed: boolean
    status?: string
    home_team: string
    away_team: string
    scores?: Array<{ name: string; score: string | number | null }>
  }>,
  candidateMatchIds: Map<string, number>,
  date = new Date()
): Promise<{ updatedMatches: number; finishedMatches: number; updatedMatchIds: Set<number> }> {
  let updatedMatches = 0
  let finishedMatches = 0
  const updatedMatchIds = new Set<number>()
  const statements: D1PreparedStatement[] = []

  for (const event of events) {
    const matchId = event.match_id ?? candidateMatchIds.get(event.id)
    if (!matchId) continue

    const homeScore = parseScoreValue(event.scores?.find((item) => item.name === event.home_team)?.score)
    const awayScore = parseScoreValue(event.scores?.find((item) => item.name === event.away_team)?.score)
    const nextStatus = deriveMatchStatusFromScoreEvent(event, date)

    statements.push(
      env.DB.prepare(
        `UPDATE matches
         SET status = ?, home_score = ?, away_score = ?
         WHERE id = ?`
      ).bind(nextStatus, homeScore, awayScore, matchId)
    )

    updatedMatches += 1
    updatedMatchIds.add(matchId)
    if (nextStatus === 'finished') {
      finishedMatches += 1
    }
  }

  if (statements.length > 0) {
    await runBatch(env, statements)
  }

  return {
    updatedMatches,
    finishedMatches,
    updatedMatchIds
  }
}

async function updateOddsApiQuotaSettings(env: Env, remaining: string | undefined): Promise<void> {
  const parsedRemaining = Number(remaining || '0')
  const monthlyQuota = Number(env.ODDS_API_MONTHLY_QUOTA || '500')
  if (Number.isFinite(parsedRemaining)) {
    await setSetting(env, 'odds_api_remaining', String(parsedRemaining))
    await setSetting(env, 'odds_api_used', String(Math.max(monthlyQuota - parsedRemaining, 0)))
  }

  await setSetting(env, 'odds_api_last_checked_at', nowIso())
}

async function makeSkippedResult(
  env: Env,
  reason: string,
  dailyUsed: number,
  dailyLimit: number
): Promise<{
  result: {
    synced: number
    updatedMatches: number
    finishedMatches: number
    skipped: boolean
    skip_reason: string
    odds_api_daily_used: number
    odds_api_daily_limit: number
  }
  status: number
}> {
  await recordResultSyncSkip(env, reason)
  await recordResultProvider(env, 'none')
  await setSetting(env, 'settlement_last_result_sync_at', nowIso())
  await setSetting(env, 'settlement_last_result_error', '')

  return {
    result: {
      synced: 0,
      updatedMatches: 0,
      finishedMatches: 0,
      skipped: true,
      skip_reason: reason,
      odds_api_daily_used: dailyUsed,
      odds_api_daily_limit: dailyLimit
    },
    status: 200
  }
}

function deriveResultStatusFromScores(
  allowDraw: boolean,
  homeScore: number | null,
  awayScore: number | null
): 'home' | 'draw' | 'away' | null {
  if (homeScore === null || awayScore === null) return null

  if (homeScore > awayScore) return 'home'
  if (homeScore < awayScore) return 'away'
  if (allowDraw) return 'draw'
  return null
}

async function syncResultsData(env: Env, options: { automatic?: boolean; now?: Date } = {}): Promise<{
  result: {
    synced: number
    updatedMatches: number
    finishedMatches: number
    api_remaining?: string
    provider?: string
    skip_reason?: string
    odds_api_daily_used?: number
    odds_api_daily_limit?: number
    error?: string
  }
  status: number
}> {
  const currentDate = options.now ?? new Date()
  const dateKey = getShanghaiDateKey(currentDate)
  const dailyLimit = readOddsApiDailyLimit(env)
  let dailyUsed = await getOddsApiDailyUsage(env, dateKey)
  await setOddsApiDailyUsage(env, dateKey, dailyUsed, dailyLimit)

  if (options.automatic) {
    await setSetting(env, 'settlement_auto_last_attempt_at', nowIso())
    if (!isAutoSettlementWindow(currentDate)) {
      return makeSkippedResult(env, 'night_window', dailyUsed, dailyLimit)
    }
  }

  const pendingCount = await countPendingBets(env)
  if (pendingCount === 0) {
    return makeSkippedResult(env, 'no_pending_bets', dailyUsed, dailyLimit)
  }

  const candidates = await getPendingResultCandidates(env, currentDate)
  if (candidates.length === 0) {
    return makeSkippedResult(env, 'no_started_pending_bets', dailyUsed, dailyLimit)
  }

  const candidateMatchIds = matchIdByExternalId(candidates)
  const remainingMatchIds = new Set(candidates.map((candidate) => candidate.match_id))
  const providersUpdated: string[] = []
  const providerErrors: string[] = []
  let updatedMatches = 0
  let finishedMatches = 0
  let synced = 0
  let apiRemaining = 'unknown'
  let skipReason = ''

  const applyProviderEvents = async (provider: string, events: ScoreApiEvent[] | undefined) => {
    const providerEvents = events ?? []
    if (providerEvents.length === 0) return 0

    const applied = await applyScoreEvents(env, providerEvents, candidateMatchIds, currentDate)
    if (applied.updatedMatches === 0) return 0

    updatedMatches += applied.updatedMatches
    finishedMatches += applied.finishedMatches
    synced += providerEvents.length
    providersUpdated.push(provider)
    for (const matchId of applied.updatedMatchIds) {
      remainingMatchIds.delete(matchId)
    }
    return applied.updatedMatches
  }

  const eventIdsBySport = getTrackedScoreEventIds(candidates)
  const requestedSports = countScoreRequests(eventIdsBySport)
  if (requestedSports > 0) {
    const requestBudget = Math.max(dailyLimit - dailyUsed, 0)
    const limitedEventIdsBySport = limitEventIdsByRequestBudget(eventIdsBySport, requestBudget)
    if (countScoreRequests(limitedEventIdsBySport) === 0) {
      skipReason = 'daily_limit_reached'
    } else {
      if (countScoreRequests(limitedEventIdsBySport) < requestedSports) {
        skipReason = 'daily_limit_reached'
      }

      const snapshot = await fetchScoresSnapshot(env, limitedEventIdsBySport)
      if (snapshot.requests > 0) {
        dailyUsed += snapshot.requests
        await setOddsApiDailyUsage(env, dateKey, dailyUsed, dailyLimit)
      }

      if (snapshot.remaining) {
        apiRemaining = snapshot.remaining
        await updateOddsApiQuotaSettings(env, snapshot.remaining)
      }

      if (snapshot.error) {
        providerErrors.push(snapshot.error)
      } else {
        await applyProviderEvents('odds-api', snapshot.data)
      }
    }
  }

  const shouldTryFallbacks =
    remainingMatchIds.size > 0 &&
    (skipReason === 'daily_limit_reached' || providersUpdated.length === 0 || hasFallbackOnlyCandidate(candidates))

  if (shouldTryFallbacks) {
    const footballData = await fetchFootballDataResults(
      env,
      candidates.filter((candidate) => remainingMatchIds.has(candidate.match_id))
    )
    if (footballData.error) providerErrors.push(footballData.error)
    await applyProviderEvents('football-data', footballData.data)
  }

  if (remainingMatchIds.size > 0 && shouldTryFallbacks) {
    const openLiga = await fetchOpenLigaDbResults(
      env,
      candidates.filter((candidate) => remainingMatchIds.has(candidate.match_id))
    )
    if (openLiga.error) providerErrors.push(openLiga.error)
    await applyProviderEvents('OpenLigaDB', openLiga.data)
  }

  if (remainingMatchIds.size > 0 && shouldTryFallbacks) {
    const sportsDb = await fetchTheSportsDbResults(
      env,
      candidates.filter((candidate) => remainingMatchIds.has(candidate.match_id))
    )
    if (sportsDb.error) providerErrors.push(sportsDb.error)
    await applyProviderEvents('TheSportsDB', sportsDb.data)
  }

  if (updatedMatches === 0 && !skipReason) {
    skipReason = 'no_matching_results'
  }

  const provider = providersUpdated.length > 0 ? Array.from(new Set(providersUpdated)).join(',') : 'none'

  await recordResultProvider(env, provider)
  await recordResultSyncSkip(env, skipReason)
  await setSetting(env, 'settlement_last_result_error', providerErrors.join('; '))
  await setSetting(env, 'settlement_last_result_sync_at', nowIso())

  return {
    result: {
      synced,
      updatedMatches,
      finishedMatches,
      api_remaining: apiRemaining,
      provider,
      skip_reason: skipReason || undefined,
      odds_api_daily_used: dailyUsed,
      odds_api_daily_limit: dailyLimit,
      error: providerErrors[0]
    },
    status: 200
  }
}

async function settlePendingBets(
  env: Env,
  options: { matchId?: number; sourceType?: 'synced' | 'custom' } = {}
): Promise<{
  settled: number
  won: number
  lost: number
  cancelled: number
  skipped: number
  error?: string
}> {
  const sourceType = options.sourceType || 'synced'
  const whereParts = [`b.status = 'pending'`]
  const params: Array<string | number> = []

  if (sourceType === 'synced') {
    whereParts.push(`m.source_type = 'synced'`)
    whereParts.push(`m.league IN (${popularLeaguePlaceholders()})`)
    params.push(...POPULAR_DISPLAY_LEAGUES)
  } else {
    whereParts.push(`m.source_type = 'custom'`)
  }

  if (options.matchId !== undefined) {
    whereParts.push(`m.id = ?`)
    params.push(options.matchId)
  }

  const pendingResult = await env.DB.prepare(
    `SELECT
       b.id,
       b.user_id,
       b.match_id,
       b.bet_type,
       b.selection,
       b.odds,
       b.amount,
       b.potential_win,
       b.status,
       b.profit,
       b.settled_at,
       b.created_at,
       m.league,
       m.allow_draw,
       m.source_type,
       m.status AS match_status,
       m.home_score,
       m.away_score
     FROM bets b
     JOIN matches m ON m.id = b.match_id
     WHERE ${whereParts.join(' AND ')}`
  ).bind(...params).all<
    DbBetRow & {
      league: string
      allow_draw: number
      source_type: string
      match_status: string
      home_score: number | null
      away_score: number | null
    }
  >()

  const statements: D1PreparedStatement[] = []
  const balanceDeltas = new Map<number, number>()
  let won = 0
  let lost = 0
  let cancelled = 0
  let skipped = 0

  for (const bet of pendingResult.results ?? []) {
    if (bet.match_status === 'cancelled' || bet.match_status === 'postponed') {
      statements.push(
        env.DB.prepare(
          `UPDATE bets
           SET status = 'cancelled', profit = 0, settled_at = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(nowIso(), bet.id)
      )
      balanceDeltas.set(bet.user_id, (balanceDeltas.get(bet.user_id) || 0) + Number(bet.amount))
      cancelled += 1
      continue
    }

    if (bet.match_status !== 'finished') {
      skipped += 1
      continue
    }

    const outcome = deriveResultStatusFromScores(bet.allow_draw === 1, bet.home_score, bet.away_score)
    if (!outcome) {
      skipped += 1
      continue
    }

    if (bet.selection === outcome) {
      const profit = round2(Number(bet.potential_win) - Number(bet.amount))
      statements.push(
        env.DB.prepare(
          `UPDATE bets
           SET status = 'won', profit = ?, settled_at = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(profit, nowIso(), bet.id)
      )
      balanceDeltas.set(bet.user_id, (balanceDeltas.get(bet.user_id) || 0) + Number(bet.potential_win))
      won += 1
    } else {
      const profit = round2(-Number(bet.amount))
      statements.push(
        env.DB.prepare(
          `UPDATE bets
           SET status = 'lost', profit = ?, settled_at = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(profit, nowIso(), bet.id)
      )
      lost += 1
    }
  }

  if (statements.length > 0) {
    await runBatch(env, statements)
  }

  const balanceStatements = Array.from(balanceDeltas.entries()).map(([userId, delta]) =>
    env.DB.prepare(`UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?`).bind(
      round2(delta),
      nowIso(),
      userId
    )
  )

  if (balanceStatements.length > 0) {
    await runBatch(env, balanceStatements)
  }

  const settled = won + lost + cancelled
  await setSetting(env, 'settlement_last_run_at', nowIso())
  await setSetting(
    env,
    'settlement_last_counts',
    JSON.stringify({ settled, won, lost, cancelled, skipped })
  )
  await setSetting(env, 'settlement_last_error', '')

  return {
    settled,
    won,
    lost,
    cancelled,
    skipped
  }
}

async function runBatch(
  env: Env,
  statements: D1PreparedStatement[],
  chunkSize = 100
): Promise<void> {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await env.DB.batch(statements.slice(index, index + chunkSize))
  }
}

type FirebaseUserSnapshot = {
  localId: string
  email: string
  emailVerified: boolean
}

function configuredAdminEmails(env: Env): string[] {
  const rawEmails = env.ADMIN_EMAILS?.trim() ? env.ADMIN_EMAILS : DEFAULT_ADMIN_EMAIL
  const emails = rawEmails
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(emails))
}

function getPrimaryAdminEmail(env: Env): string {
  return configuredAdminEmails(env)[0] || DEFAULT_ADMIN_EMAIL
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeUsername(username: string): string {
  return username.trim()
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

async function getUserByIdentifier(env: Env, identifier: string): Promise<DbUser | null> {
  return isEmailLike(identifier)
    ? getUserByEmail(env, normalizeEmail(identifier))
    : getUserByUsername(env, normalizeUsername(identifier))
}

function isAdminEmail(env: Env, email: string): boolean {
  const normalized = normalizeEmail(email)
  return configuredAdminEmails(env).includes(normalized)
}

function buildGeneratedUsername(seed: string): string {
  const sanitized = seed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

  const base = sanitized || 'player'
  if (base.length >= 3) {
    return base.slice(0, 20)
  }

  return `${base}${'123'.slice(0, 3 - base.length)}`.slice(0, 20)
}

async function generateUniqueUsername(env: Env, base: string): Promise<string> {
  const normalizedBase = buildGeneratedUsername(base)
  let candidate = normalizedBase
  let suffix = 1

  while (await getUserByUsername(env, candidate)) {
    const suffixText = String(suffix)
    const prefixLength = Math.max(3, 20 - suffixText.length - 1)
    candidate = `${normalizedBase.slice(0, prefixLength)}_${suffixText}`
    suffix += 1
  }

  return candidate
}

function isValidRegistrationUsername(username: string): boolean {
  return username.length >= 3 && username.length <= 20
}

function isValidPassword(password: string): boolean {
  return password.length >= 6
}

function firebaseErrorToMessage(code: string): string {
  if (code === 'FIREBASE_NOT_CONFIGURED') {
      return '服务端尚未配置 Firebase 认证'
  }
  if (code === 'EMAIL_EXISTS') {
      return '邮箱已注册'
  }
  if (code === 'INVALID_EMAIL') {
      return '请输入有效的邮箱地址'
  }
  if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(code)) {
    return '邮箱、用户名或密码错误'
  }
  if (code.startsWith('WEAK_PASSWORD')) {
      return '密码至少需要 6 位'
  }
  if (code === 'USER_DISABLED') {
      return '该账号已被禁用'
  }
  if (['INVALID_ID_TOKEN', 'TOKEN_EXPIRED'].includes(code)) {
      return '登录状态已失效，请重新登录'
  }
  if (code === 'INVALID_REFRESH_TOKEN') {
      return '登录已过期，请重新登录'
  }
  if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
      return '请求过于频繁，请稍后再试'
  }
  if (code === 'EXPIRED_OOB_CODE' || code === 'INVALID_OOB_CODE') {
      return '验证链接已失效，请重新发送；如果你刚完成验证，请回到应用刷新状态'
  }
  if (code === 'OPERATION_NOT_ALLOWED') {
      return '当前项目尚未开启邮箱密码登录'
  }
  if (code === 'FIREBASE_PUBLIC_KEYS_UNAVAILABLE') {
      return '认证服务暂时不可用'
  }
  if (code === 'FIREBASE_ADMIN_NOT_CONFIGURED') {
      return '服务端尚未配置 Firebase 管理员能力'
  }
  if (code === 'FIREBASE_ADMIN_QUERY_FAILED') {
      return '服务端查询账号信息失败'
  }
  if (code === 'FIREBASE_ADMIN_PASSWORD_UPDATE_FAILED') {
      return '服务端更新密码失败'
  }

  return '认证服务暂时不可用'
}

function firebaseErrorResponse(
  error: unknown,
  options: {
    defaultMessage?: string
    defaultStatus?: number
  } = {}
): Response {
  if (error instanceof FirebaseApiError) {
    const preferredStatusCodes = [
      'INVALID_LOGIN_CREDENTIALS',
      'EMAIL_NOT_FOUND',
      'INVALID_PASSWORD',
      'INVALID_ID_TOKEN',
      'TOKEN_EXPIRED',
      'INVALID_REFRESH_TOKEN'
    ]
    const status =
      options.defaultStatus && preferredStatusCodes.includes(error.code)
        ? options.defaultStatus
        : error.status || options.defaultStatus || 400
    return errorResponse(firebaseErrorToMessage(error.code) || options.defaultMessage || '请求失败', status)
  }

  console.error('Unexpected auth error', error)
  return errorResponse(options.defaultMessage || '请求失败', options.defaultStatus || 500)
}

async function insertLocalUser(
  env: Env,
  firebaseUser: FirebaseUserSnapshot,
  username: string
): Promise<DbUser> {
  const timestamp = nowIso()
  const email = normalizeEmail(firebaseUser.email)
  const isAdmin = isAdminEmail(env, email) ? 1 : 0
  const emailVerified = isAdmin ? 1 : firebaseUser.emailVerified ? 1 : 0
  const insert = await env.DB.prepare(
    `INSERT INTO users (
       username,
       email,
       firebase_uid,
       balance,
       email_verified,
       is_admin,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, 10000, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    username,
    email,
    firebaseUser.localId,
    emailVerified,
    isAdmin,
    timestamp,
    timestamp
  ).first<{ id: number }>()

  if (!insert?.id) {
    throw new Error('Failed to create local user')
  }

  const user = await getUserById(env, insert.id)
  if (!user) {
    throw new Error('Failed to read local user')
  }

  return user
}

async function syncUserFromFirebase(
  env: Env,
  user: DbUser,
  firebaseUser: FirebaseUserSnapshot
): Promise<DbUser> {
  const email = normalizeEmail(firebaseUser.email)
  const isAdmin = isAdminEmail(env, email) ? 1 : 0
  const emailVerified = isAdmin ? 1 : firebaseUser.emailVerified ? 1 : 0

  if (
    user.email === email &&
    user.email_verified === emailVerified &&
    user.is_admin === isAdmin &&
    user.firebase_uid === firebaseUser.localId
  ) {
    return user
  }

  await env.DB.prepare(
    `UPDATE users
     SET email = ?, firebase_uid = ?, email_verified = ?, is_admin = ?, updated_at = ?
     WHERE id = ?`
  ).bind(email, firebaseUser.localId, emailVerified, isAdmin, nowIso(), user.id).run()

  return (await getUserById(env, user.id)) || user
}

async function provisionUserFromFirebase(
  env: Env,
  firebaseUser: FirebaseUserSnapshot,
  preferredUsername?: string
): Promise<DbUser> {
  const existing = await getUserByFirebaseUid(env, firebaseUser.localId)
  if (existing) {
    return syncUserFromFirebase(env, existing, firebaseUser)
  }

  const normalizedEmail = normalizeEmail(firebaseUser.email)
  const unboundByEmail = await env.DB.prepare(
    `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
     FROM users
     WHERE email = ? AND firebase_uid IS NULL
     ORDER BY id
     LIMIT 1`
  ).bind(normalizedEmail).first<DbUser>()
  if (unboundByEmail) {
    return syncUserFromFirebase(env, unboundByEmail, firebaseUser)
  }

  const adminPreferred = isAdminEmail(env, firebaseUser.email) ? 'admin' : undefined
  const normalizedPreferredUsername = preferredUsername ? normalizeUsername(preferredUsername) : ''
  if (normalizedPreferredUsername) {
    const unboundByUsername = await env.DB.prepare(
      `SELECT id, username, email, firebase_uid, balance, email_verified, is_admin, created_at, updated_at
       FROM users
       WHERE username = ? AND firebase_uid IS NULL
       ORDER BY id
       LIMIT 1`
    ).bind(normalizedPreferredUsername).first<DbUser>()
    if (unboundByUsername) {
      return syncUserFromFirebase(env, unboundByUsername, firebaseUser)
    }
  }

  const username =
    normalizedPreferredUsername && isValidRegistrationUsername(normalizedPreferredUsername)
      ? normalizedPreferredUsername
      : await generateUniqueUsername(env, adminPreferred || firebaseUser.email.split('@')[0])

  const uniqueUsername =
    normalizedPreferredUsername && !(await getUserByUsername(env, username))
      ? username
      : await generateUniqueUsername(env, username)

  return insertLocalUser(env, firebaseUser, uniqueUsername)
}

async function syncUserFromVerifiedToken(
  env: Env,
  user: DbUser,
  verifiedToken: FirebaseVerifiedToken
): Promise<DbUser> {
  if (!verifiedToken.email) {
    return user
  }

  return syncUserFromFirebase(env, user, {
    localId: verifiedToken.uid,
    email: verifiedToken.email,
    // ID token claims may lag behind Firebase's latest email verification state.
    emailVerified: user.email_verified === 1 || verifiedToken.emailVerified
  })
}

async function provisionUserFromVerifiedToken(
  env: Env,
  verifiedToken: FirebaseVerifiedToken,
  idToken?: string
): Promise<DbUser> {
  if (!verifiedToken.email) {
    if (!idToken) {
      throw new FirebaseApiError('INVALID_ID_TOKEN', 401)
    }
    const lookedUp = await firebaseLookupByIdToken(env, idToken)
    if (!lookedUp) {
      throw new FirebaseApiError('INVALID_ID_TOKEN', 401)
    }
    return provisionUserFromFirebase(env, lookedUp)
  }

  return provisionUserFromFirebase(env, {
    localId: verifiedToken.uid,
    email: verifiedToken.email,
    emailVerified: verifiedToken.emailVerified
  })
}

async function resolveUserFromToken(
  env: Env,
  idToken: string,
  verifiedToken: FirebaseVerifiedToken
): Promise<DbUser> {
  const existing = await getUserByFirebaseUid(env, verifiedToken.uid)
  if (existing) {
    return syncUserFromVerifiedToken(env, existing, verifiedToken)
  }

  return provisionUserFromVerifiedToken(env, verifiedToken, idToken)
}

async function ensureFreshVerificationState(
  env: Env,
  token: string,
  user: DbUser
): Promise<DbUser> {
  if (user.email_verified === 1) {
    return user
  }

  const lookedUp = await firebaseLookupByIdToken(env, token)
  if (!lookedUp) {
    return user
  }

  return syncUserFromFirebase(env, user, lookedUp)
}

function buildAuthResponse(
  message: string,
  user: DbUser,
  session: FirebaseSession,
  init: ResponseInit = {},
  extra: Record<string, unknown> = {}
): Response {
  return json(
    {
      message,
      user: toUserResponse(user),
      id_token: session.idToken,
      refresh_token: session.refreshToken,
      expires_in: Number(session.expiresIn),
      ...extra
    },
    init
  )
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  type RegisterBody = {
    username?: string
    email?: string
    password?: string
  }

  const body = await readJson<RegisterBody>(request)
  if (!body?.username || !body.email || !body.password) {
    return errorResponse('请填写所有必填字段', 400)
  }

  const username = normalizeUsername(body.username)
  const email = normalizeEmail(body.email)
  const password = body.password

  if (!isValidRegistrationUsername(username)) {
    return errorResponse('用户名长度需在 3 到 20 个字符之间', 400)
  }

  if (!isEmailLike(email)) {
    return errorResponse('请输入有效的邮箱地址', 400)
  }

  if (!isValidPassword(password)) {
    return errorResponse('密码至少需要 6 位', 400)
  }

  if (await getUserByUsername(env, username)) {
    return errorResponse('用户名已存在', 400)
  }

  if (await getUserByEmail(env, email)) {
    return errorResponse('邮箱已注册', 400)
  }

  try {
    const session = await firebaseSignUp(env, email, password)
    const user = await insertLocalUser(
      env,
      {
        localId: session.localId,
        email: session.email,
        emailVerified: false
      },
      username
    )

    let verificationEmailSent = true
    try {
      await firebaseSendVerificationEmail(env, session.idToken)
    } catch (error) {
      verificationEmailSent = false
      console.warn('Failed to send verification email after signup', error)
    }

    return buildAuthResponse(
      verificationEmailSent ? '注册成功，验证邮件已发送' : '注册成功，但验证邮件发送失败，请稍后在个人中心重试',
      user,
      session,
      { status: 201 },
      { verification_email_sent: verificationEmailSent }
    )
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '注册失败，请稍后重试'
    })
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  type LoginBody = { identifier?: string; password?: string }

  const body = await readJson<LoginBody>(request)
  if (!body?.identifier || !body.password) {
    return errorResponse('请输入用户名或邮箱以及密码', 400)
  }

  const identifier = body.identifier.trim()
  const activeUser = await getUserByIdentifier(env, identifier)

  if (!isEmailLike(identifier) && !activeUser) {
    return errorResponse('邮箱、用户名或密码错误', 401)
  }

  const email = activeUser ? normalizeEmail(activeUser.email) : normalizeEmail(identifier)
  if (identifier === 'admin' && !getPrimaryAdminEmail(env) && (!activeUser || activeUser.email === 'admin@betting-simulator.local')) {
    return errorResponse('管理员邮箱尚未配置，暂时无法使用 admin 用户名登录', 500)
  }

  try {
    const session = await firebaseSignIn(env, email, body.password)
    const lookedUp = await firebaseLookupByIdToken(env, session.idToken)
    if (!lookedUp) {
      return errorResponse('登录失败，请稍后重试', 500)
    }

    const user = await provisionUserFromFirebase(env, lookedUp, activeUser?.username)
    return buildAuthResponse('登录成功', user, session)
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '邮箱、用户名或密码错误',
      defaultStatus: 401
    })
  }
}

async function handleForgotPassword(request: Request, env: Env): Promise<Response> {
  type ForgotPasswordBody = { identifier?: string }

  const body = await readJson<ForgotPasswordBody>(request)
  if (!body?.identifier) {
    return errorResponse('请输入用户名或邮箱', 400)
  }

  const identifier = body.identifier.trim()

  try {
    if (isEmailLike(identifier)) {
      await firebaseSendPasswordResetEmail(env, normalizeEmail(identifier))
    } else {
      const user = await getUserByUsername(env, identifier)
      if (user) {
        await firebaseSendPasswordResetEmail(env, user.email)
      }
    }
  } catch (error) {
    if (error instanceof FirebaseApiError && ['EMAIL_NOT_FOUND', 'INVALID_EMAIL'].includes(error.code)) {
      return json({
        message: '如果账号存在，系统会发送重置密码邮件'
      })
    }

    return firebaseErrorResponse(error, {
      defaultMessage: '发送重置密码邮件失败'
    })
  }

  return json({
    message: '如果账号存在，系统会发送重置密码邮件'
  })
}

async function handleRefresh(request: Request, env: Env): Promise<Response> {
  type RefreshBody = { refreshToken?: string }

  const body = await readJson<RefreshBody>(request)
  if (!body?.refreshToken) {
    return errorResponse('缺少 refresh token', 400)
  }

  try {
    const session = await firebaseRefreshToken(env, body.refreshToken)
    const lookedUp = await firebaseLookupByIdToken(env, session.idToken)
    if (!lookedUp) {
      return errorResponse('刷新登录状态失败', 401)
    }

    const user = await provisionUserFromFirebase(env, lookedUp)
    return buildAuthResponse('刷新成功', user, {
      ...session,
      email: lookedUp.email
    })
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '登录已过期，请重新登录',
      defaultStatus: 401
    })
  }
}

async function handleResendVerification(request: Request, env: Env): Promise<Response> {
  const token = bearerTokenFromRequest(request)
  if (!token) {
    return json({ msg: 'Missing Authorization Header' }, { status: 401 })
  }

  try {
    const verifiedToken = await verifyFirebaseIdToken(env, token)
    let user = await resolveUserFromToken(env, token, verifiedToken)

    user = await ensureFreshVerificationState(env, token, user)
    if (isAdminEmail(env, user.email)) {
      return json({
        message: '管理员邮箱已自动验证',
        user: toUserResponse(user)
      })
    }

    if (user.email_verified === 1) {
      return json({
        message: '邮箱已完成验证',
        user: toUserResponse(user)
      })
    }

    await firebaseSendVerificationEmail(env, token)
    return json({ message: '验证邮件已重新发送' })
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '发送验证邮件失败'
    })
  }
}

async function handleCompleteEmailVerification(request: Request, env: Env): Promise<Response> {
  type CompleteEmailVerificationBody = {
    oobCode?: string
  }

  const body = await readJson<CompleteEmailVerificationBody>(request)
  const oobCode = body?.oobCode?.trim()
  if (!oobCode) {
    return errorResponse('缺少验证参数 oobCode', 400)
  }

  try {
    const firebaseUser = await firebaseCompleteEmailVerification(env, oobCode)
    const user = await provisionUserFromFirebase(env, firebaseUser)

    return json({
      message: '邮箱验证成功',
      user: toUserResponse(user)
    })
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '验证链接处理失败'
    })
  }
}

async function handleProfile(request: Request, env: Env): Promise<Response> {
  const token = bearerTokenFromRequest(request)
  if (!token) {
    return json({ msg: 'Missing Authorization Header' }, { status: 401 })
  }

  try {
    const verifiedToken = await verifyFirebaseIdToken(env, token)
    let user = await resolveUserFromToken(env, token, verifiedToken)

    user = await ensureFreshVerificationState(env, token, user)
    return json({ user: toUserResponse(user) })
  } catch (error) {
    return firebaseErrorResponse(error, {
      defaultMessage: '登录状态已失效，请重新登录',
      defaultStatus: 401
    })
  }
}

async function handleRedeem(request: Request, env: Env): Promise<Response> {
  type RedeemBody = { code?: string }

  const userId = await requireUserId(request, env)
  if (userId instanceof Response) return userId

  const body = await readJson<RedeemBody>(request)
  if (!body?.code) {
    return errorResponse('请输入兑换码', 400)
  }

  const code = body.code.trim()
  const amount = REDEEM_CODES[code]
  if (!amount) {
    return errorResponse('无效的兑换码', 400)
  }

  const token = bearerTokenFromRequest(request)
  if (!token) {
    return json({ msg: 'Missing Authorization Header' }, { status: 401 })
  }

  let user = await getUserById(env, userId)
  if (!user) {
    return errorResponse('用户不存在', 404)
  }

  user = await ensureFreshVerificationState(env, token, user)
  if (user.email_verified !== 1) {
    return errorResponse('请先完成邮箱验证，再进行兑换', 403)
  }

  const redeemedAt = nowIso()
  const redeemResult = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_redemptions (user_id, code, amount, redeemed_at)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, code, amount, redeemedAt),
    env.DB.prepare(
      `UPDATE users
       SET balance = round(balance + ?, 2), updated_at = ?
       WHERE id = ? AND changes() = 1`
    ).bind(amount, redeemedAt, userId)
  ])

  if ((redeemResult[0]?.meta?.changes ?? 0) !== 1) {
    return errorResponse('该兑换码已使用', 400)
  }
  if ((redeemResult[1]?.meta?.changes ?? 0) !== 1) {
    return errorResponse('兑换失败，请稍后重试', 500)
  }

  const refreshed = await getUserById(env, userId)

  return json({
    message: `兑换成功！获得 ${amount} 虚拟金币`,
    new_balance: refreshed ? Number(refreshed.balance) : Number(user.balance) + amount
  })
}

async function handleGetMatches(url: URL, env: Env): Promise<Response> {
  const sport = url.searchParams.get('sport')
  const league = url.searchParams.get('league')
  const dateFilter = (url.searchParams.get('date') || 'today') as 'today' | 'tomorrow' | 'all'
  const showFinished = boolFromQuery(url.searchParams.get('show_finished'), true)

  const params: Array<string | number> = [...POPULAR_DISPLAY_LEAGUES]
  let sql = `
    SELECT
      m.id,
      m.external_id,
      m.sport,
      m.league,
      m.home_team,
      m.away_team,
      m.start_time,
      m.status,
      m.source_type,
      m.allow_draw,
      m.has_home_away,
      m.home_score,
      m.away_score,
      COUNT(o.id) AS odds_count,
      AVG(o.home_odds) AS avg_home_odds,
      AVG(o.draw_odds) AS avg_draw_odds,
      AVG(o.away_odds) AS avg_away_odds
    FROM matches m
    LEFT JOIN odds o ON o.match_id = m.id AND o.market = 'h2h'
    WHERE ${publicMatchVisibilityClause('m')}
  `

  if (sport) {
    sql += ` AND m.sport = ?`
    params.push(sport)
  }

  if (!showFinished) {
    sql += ` AND m.status IN ('upcoming', 'live')`
  }

  if (dateFilter === 'today' || dateFilter === 'tomorrow') {
    const range = shanghaiDateRange(dateFilter)
    sql += ` AND m.start_time >= ? AND m.start_time < ?`
    params.push(range.startUtcIso, range.endUtcIso)
  }

  if (league) {
    sql += ` AND m.league = ?`
    params.push(league)
  }

  sql += ` GROUP BY m.id ORDER BY m.start_time`

  const result = await env.DB.prepare(sql).bind(...params).all<DbMatchSummaryRow>()
  const matches = (result.results ?? []).map((row) => buildMatchResponse(row, []))

  return json({
    matches,
    count: matches.length,
    date_filter: dateFilter
  })
}

async function handleGetMatch(env: Env, matchId: number): Promise<Response> {
  const match = await env.DB.prepare(
    `SELECT id, external_id, sport, league, home_team, away_team, start_time, status, source_type, allow_draw, has_home_away, home_score, away_score, created_at
     FROM matches WHERE id = ?`
  ).bind(matchId).first<DbMatchRow>()

  if (!match) {
    return errorResponse('比赛不存在', 404)
  }

  const oddsRowsResult = await env.DB.prepare(
    `SELECT id, match_id, bookmaker, market, home_odds, away_odds, draw_odds, updated_at
     FROM odds WHERE match_id = ? ORDER BY bookmaker, market`
  ).bind(matchId).all<DbOddsRow>()
  const oddsRows = oddsRowsResult.results ?? []

  const aggregate = oddsRows
    .filter((item) => item.market === 'h2h')
    .reduce(
      (accumulator, item) => {
        if (item.home_odds !== null) accumulator.home.push(Number(item.home_odds))
        if (item.draw_odds !== null) accumulator.draw.push(Number(item.draw_odds))
        if (item.away_odds !== null) accumulator.away.push(Number(item.away_odds))
        return accumulator
      },
      { home: [] as number[], draw: [] as number[], away: [] as number[] }
    )

  const responseMatch = buildMatchResponse(
    {
      ...match,
      odds_count: oddsRows.filter((item) => item.market === 'h2h').length,
      avg_home_odds: aggregate.home.length ? aggregate.home.reduce((sum, value) => sum + value, 0) / aggregate.home.length : null,
      avg_draw_odds: aggregate.draw.length ? aggregate.draw.reduce((sum, value) => sum + value, 0) / aggregate.draw.length : null,
      avg_away_odds: aggregate.away.length ? aggregate.away.reduce((sum, value) => sum + value, 0) / aggregate.away.length : null
    },
    oddsRows.map(toOddsResponse)
  )

  return json({ match: responseMatch })
}

async function handleGetLeagues(url: URL, env: Env): Promise<Response> {
  const sport = url.searchParams.get('sport')
  let sql = `SELECT DISTINCT m.league FROM matches m WHERE ${publicMatchVisibilityClause('m')}`
  const params: Array<string> = [...POPULAR_DISPLAY_LEAGUES]

  if (sport) {
    sql += ` AND m.sport = ?`
    params.push(sport)
  }

  sql += ` ORDER BY m.league`

  const result = await env.DB.prepare(sql).bind(...params).all<{ league: string }>()

  return json({
    leagues: (result.results ?? []).map((item) => translateLeague(item.league))
  })
}

async function shouldUpdateMatch(env: Env, matchId: number, startTimeIso: string, force: boolean): Promise<boolean> {
  if (force) return true

  const latest = await env.DB.prepare(
    `SELECT updated_at FROM odds WHERE match_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(matchId).first<{ updated_at: string }>()

  if (!latest?.updated_at) return true

  const latestUpdate = new Date(latest.updated_at).getTime()
  const now = Date.now()
  const startTime = new Date(startTimeIso).getTime()

  if (startTime - now < 60 * 60 * 1000) {
    return now - latestUpdate > 10 * 60 * 1000
  }

  return now - latestUpdate > 2 * 60 * 60 * 1000
}

async function upsertMatchFromOddsEvent(env: Env, event: OddsApiEvent): Promise<number> {
  const normalizedLeague = translateLeague(event.sport_title || 'Soccer')
  const normalizedSport = event.sport_key === 'basketball_nba' ? 'basketball' : 'soccer'
  const allowDraw = defaultAllowDrawForSport(normalizedSport)

  const result = await env.DB.prepare(
    `INSERT INTO matches (external_id, sport, league, home_team, away_team, start_time, status, source_type, allow_draw, has_home_away, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'upcoming', 'synced', ?, 1, ?)
     ON CONFLICT(external_id) DO UPDATE SET
       sport = excluded.sport,
       league = excluded.league,
       home_team = excluded.home_team,
       away_team = excluded.away_team,
       start_time = excluded.start_time,
       status = excluded.status,
       source_type = excluded.source_type,
       allow_draw = excluded.allow_draw,
       has_home_away = excluded.has_home_away
     RETURNING id`
  ).bind(
    event.id,
    normalizedSport,
    normalizedLeague,
    translateTeam(event.home_team),
    translateTeam(event.away_team),
    new Date(event.commence_time).toISOString(),
    allowDraw,
    nowIso()
  ).first<{ id: number }>()

  return result?.id ?? 0
}

async function syncOddsData(env: Env, force: boolean) {
  const snapshot = await fetchOddsSnapshot(env)
  if (snapshot.error) {
    await setSetting(env, 'odds_api_last_error', snapshot.error)
    return {
      result: {
        error: snapshot.error,
        synced: 0
      },
      status: snapshot.error.includes('ODDS_API_KEY') ? 400 : 502
    }
  }

  const monthlyQuota = Number(env.ODDS_API_MONTHLY_QUOTA || '500')
  const remaining = Number(snapshot.remaining || '0')
  if (Number.isFinite(remaining)) {
    await setSetting(env, 'odds_api_remaining', String(remaining))
    await setSetting(env, 'odds_api_used', String(Math.max(monthlyQuota - remaining, 0)))
  }
  await setSetting(env, 'odds_api_last_checked_at', nowIso())
  await setSetting(env, 'odds_api_last_error', '')

  let syncedCount = 0
  let skippedCount = 0

  const events = (snapshot.data ?? []).filter(
    (event) => event.id && event.home_team && event.away_team && event.commence_time
  )

  if (force) {
    const matchStatements = events.map((event) => {
      const normalizedLeague = translateLeague(event.sport_title || 'Soccer')
      const normalizedSport = event.sport_key === 'basketball_nba' ? 'basketball' : 'soccer'
      const allowDraw = defaultAllowDrawForSport(normalizedSport)

      return env.DB.prepare(
        `INSERT INTO matches (external_id, sport, league, home_team, away_team, start_time, status, source_type, allow_draw, has_home_away, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'upcoming', 'synced', ?, 1, ?)
         ON CONFLICT(external_id) DO UPDATE SET
           sport = excluded.sport,
           league = excluded.league,
           home_team = excluded.home_team,
            away_team = excluded.away_team,
            start_time = excluded.start_time,
            status = excluded.status,
            source_type = excluded.source_type,
            allow_draw = excluded.allow_draw,
            has_home_away = excluded.has_home_away`
      ).bind(
        event.id,
        normalizedSport,
        normalizedLeague,
        translateTeam(event.home_team),
        translateTeam(event.away_team),
        new Date(event.commence_time).toISOString(),
        allowDraw,
        nowIso()
      )
    })

    await runBatch(env, matchStatements)

    const matchIdMap = new Map<string, number>()
    for (let index = 0; index < events.length; index += 50) {
      const chunk = events.slice(index, index + 50)
      const externalIds = chunk.map((event) => event.id as string)
      const result = await env.DB.prepare(
        `SELECT id, external_id FROM matches WHERE external_id IN (${sqlPlaceholders(externalIds.length)})`
      ).bind(...externalIds).all<{ id: number; external_id: string }>()

      for (const row of result.results ?? []) {
        matchIdMap.set(row.external_id, row.id)
      }
    }

    const oddsStatements: D1PreparedStatement[] = []
    for (const event of events) {
      const matchId = matchIdMap.get(event.id as string)
      if (!matchId) continue

      for (const bookmaker of event.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          let homeOdds: number | null = null
          let awayOdds: number | null = null
          let drawOdds: number | null = null

          for (const outcome of market.outcomes ?? []) {
            if (outcome.name === event.home_team) {
              homeOdds = outcome.price
            } else if (outcome.name === event.away_team) {
              awayOdds = outcome.price
            } else if (outcome.name === 'Draw') {
              drawOdds = outcome.price
            }
          }

          oddsStatements.push(
            env.DB.prepare(
              `INSERT INTO odds (match_id, bookmaker, market, home_odds, away_odds, draw_odds, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(match_id, bookmaker, market) DO UPDATE SET
                 home_odds = excluded.home_odds,
                 away_odds = excluded.away_odds,
                 draw_odds = excluded.draw_odds,
                 updated_at = excluded.updated_at`
            ).bind(matchId, bookmaker.title, market.key, homeOdds, awayOdds, drawOdds, nowIso())
          )
        }
      }
    }

    await runBatch(env, oddsStatements)
    syncedCount = events.length
  } else {
    for (const event of events) {
      const matchId = await upsertMatchFromOddsEvent(env, event)
      if (!matchId) continue

      const startTimeIso = new Date(event.commence_time as string).toISOString()
      if (!(await shouldUpdateMatch(env, matchId, startTimeIso, force))) {
        skippedCount += 1
        continue
      }

      for (const bookmaker of event.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          let homeOdds: number | null = null
          let awayOdds: number | null = null
          let drawOdds: number | null = null

          for (const outcome of market.outcomes ?? []) {
            if (outcome.name === event.home_team) {
              homeOdds = outcome.price
            } else if (outcome.name === event.away_team) {
              awayOdds = outcome.price
            } else if (outcome.name === 'Draw') {
              drawOdds = outcome.price
            }
          }

          await env.DB.prepare(
            `INSERT INTO odds (match_id, bookmaker, market, home_odds, away_odds, draw_odds, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(match_id, bookmaker, market) DO UPDATE SET
               home_odds = excluded.home_odds,
               away_odds = excluded.away_odds,
               draw_odds = excluded.draw_odds,
               updated_at = excluded.updated_at`
          ).bind(matchId, bookmaker.title, market.key, homeOdds, awayOdds, drawOdds, nowIso()).run()
        }
      }

      syncedCount += 1
    }
  }

  await setSetting(env, 'odds_api_last_sync_at', nowIso())

  return {
    result: {
      message: `同步完成：${syncedCount} 场更新，${skippedCount} 场跳过（缓存中）`,
      synced: syncedCount,
      skipped: skippedCount,
      api_remaining: snapshot.remaining ?? 'unknown',
      monthly_quota: monthlyQuota
    },
    status: 200
  }
}

async function syncScheduleData(env: Env, days: number) {
  const snapshot = await fetchScheduleSnapshot(env, days)
  if (snapshot.error) {
    return {
      result: {
        status: 'failed',
        error: snapshot.error,
        synced: 0,
        skipped: 0,
        total_found: 0,
        leagues: {},
        league_summary: '无'
      },
      status: snapshot.error.includes('FOOTBALL_DATA_API_KEY') ? 400 : 502
    }
  }

  let synced = 0
  let skipped = 0
  const leagues: Record<string, number> = {}

  for (const event of snapshot.data ?? []) {
    const existing = await env.DB.prepare(
      `SELECT id FROM matches WHERE external_id = ?`
    ).bind(event.external_id).first<{ id: number }>()

    if (existing?.id) {
      await env.DB.prepare(
        `UPDATE matches
         SET league = ?, home_team = ?, away_team = ?, start_time = ?, status = ?, source_type = 'synced', allow_draw = 1, has_home_away = 1, home_score = ?, away_score = ?
         WHERE id = ?`
      ).bind(
        translateLeague(event.league_cn || event.league),
        translateTeam(event.home_team),
        translateTeam(event.away_team),
        new Date(event.start_time).toISOString(),
        event.status || 'upcoming',
        event.home_score ?? null,
        event.away_score ?? null,
        existing.id
      ).run()
      skipped += 1
      continue
    }

    await insertScheduleMatch(env, event)
    synced += 1
    const leagueName = event.league_cn || event.league
    leagues[leagueName] = (leagues[leagueName] || 0) + 1
  }

  const leagueSummary = Object.keys(leagues).length
    ? Object.entries(leagues)
        .map(([name, count]) => `${name}(${count}场)`)
        .join('、')
    : '无'

  return {
    result: {
      status: 'success',
      message: `赛程同步完成：新增 ${synced} 场，跳过 ${skipped} 场已存在`,
      synced,
      skipped,
      total_found: snapshot.data?.length ?? 0,
      leagues,
      league_summary: leagueSummary
    },
    status: 200
  }
}

async function insertScheduleMatch(env: Env, event: ScheduleEvent): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO matches (external_id, sport, league, home_team, away_team, start_time, status, source_type, allow_draw, has_home_away, home_score, away_score, created_at)
     VALUES (?, 'soccer', ?, ?, ?, ?, ?, 'synced', 1, 1, ?, ?, ?)`
  ).bind(
    event.external_id,
    translateLeague(event.league_cn || event.league),
    translateTeam(event.home_team),
    translateTeam(event.away_team),
    new Date(event.start_time).toISOString(),
    event.status || 'upcoming',
    event.home_score ?? null,
    event.away_score ?? null,
    nowIso()
  ).run()
}

async function handleSyncOdds(request: Request, url: URL, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const force = boolFromQuery(url.searchParams.get('force'), false)
  const { result, status } = await syncOddsData(env, force)
  return json(result, { status })
}

async function handleSyncSchedule(request: Request, url: URL, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const days = Number(url.searchParams.get('days') || '7')
  const { result, status } = await syncScheduleData(env, Number.isFinite(days) ? days : 7)
  return json(result, { status })
}

async function handleSyncAll(request: Request, url: URL, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const days = Number(url.searchParams.get('days') || '7')
  const schedule = await syncScheduleData(env, Number.isFinite(days) ? days : 7)
  const odds = await syncOddsData(env, true)
  const results = await syncResultsData(env)
  const settlement = await settlePendingBets(env)

  const scheduleMessage =
    (schedule.result as Record<string, unknown>).message ||
    `赛程未同步：${(schedule.result as Record<string, unknown>).error || '未知错误'}`
  const oddsMessage =
    (odds.result as Record<string, unknown>).message ||
    `赔率未同步：${(odds.result as Record<string, unknown>).error || '未知错误'}`
  const resultMessage =
    results.status === 200
      ? `赛果同步 ${results.result.updatedMatches} 场`
      : `赛果未同步：${results.result.error || '未知错误'}`
  const settlementMessage = `结算 ${settlement.settled} 单（赢 ${settlement.won} / 输 ${settlement.lost} / 退款 ${settlement.cancelled}）`

  const status =
    schedule.status !== 200 && odds.status !== 200 && results.status !== 200 ? 502 : 200

  return json(
    {
      message: `一键同步完成：${scheduleMessage}；${oddsMessage}；${resultMessage}；${settlementMessage}`,
      results: {
        schedule: schedule.result,
        odds: odds.result,
        scores: results.result,
        settlement
      }
    },
    { status }
  )
}

async function runScheduledResultSyncAndSettlement(env: Env, date = new Date()): Promise<void> {
  try {
    const results = await syncResultsData(env, { automatic: true, now: date })
    if (results.status !== 200) {
      await setSetting(env, 'settlement_last_error', results.result.error || '赛果同步失败')
      return
    }

    await settlePendingBets(env)
  } catch (error) {
    console.error('Scheduled settlement failed', error)
    await setSetting(
      env,
      'settlement_last_error',
      error instanceof Error ? error.message : '定时结算失败'
    )
  }
}

async function handleValidateOdds(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT
       m.id AS match_id,
       m.home_team,
       m.away_team,
       m.league,
       o.bookmaker,
       o.home_odds,
       o.draw_odds,
       o.away_odds
     FROM matches m
     JOIN odds o ON o.match_id = m.id
     WHERE m.league IN (${popularLeaguePlaceholders()}) AND m.status = 'upcoming' AND o.market = 'h2h'
     ORDER BY m.id, o.bookmaker`
  ).bind(...POPULAR_DISPLAY_LEAGUES).all<{
    match_id: number
    home_team: string
    away_team: string
    league: string
    bookmaker: string
    home_odds: number | null
    draw_odds: number | null
    away_odds: number | null
  }>()

  const grouped = new Map<number, Array<(typeof result.results)[number]>>()
  for (const row of result.results ?? []) {
    const bucket = grouped.get(row.match_id) || []
    bucket.push(row)
    grouped.set(row.match_id, bucket)
  }

  const payload = Array.from(grouped.entries())
    .map(([matchId, rows]) => {
      if (rows.length < 2) return null

      const home = rows.flatMap((row) => (row.home_odds === null ? [] : [Number(row.home_odds)]))
      const draw = rows.flatMap((row) => (row.draw_odds === null ? [] : [Number(row.draw_odds)]))
      const away = rows.flatMap((row) => (row.away_odds === null ? [] : [Number(row.away_odds)]))

      const calculateStats = (values: number[]) => {
        if (values.length === 0) return null
        const average = values.reduce((sum, value) => sum + value, 0) / values.length
        return {
          avg: round2(average),
          min: round2(Math.min(...values)),
          max: round2(Math.max(...values)),
          spread: round2(((Math.max(...values) - Math.min(...values)) / average) * 100),
          count: values.length
        }
      }

      const homeStats = calculateStats(home)
      const drawStats = calculateStats(draw)
      const awayStats = calculateStats(away)

      const spreads = [homeStats, drawStats, awayStats]
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => item.spread)
      const maxSpread = spreads.length > 0 ? round2(Math.max(...spreads)) : 0

      return {
        match_id: matchId,
        home_team: translateTeam(rows[0].home_team),
        away_team: translateTeam(rows[0].away_team),
        league: translateLeague(rows[0].league),
        bookmakers_count: rows.length,
        home: homeStats,
        draw: drawStats,
        away: awayStats,
        max_spread: maxSpread,
        bookmakers: rows.map((row) => ({
          bookmaker: row.bookmaker,
          home_odds: row.home_odds === null ? null : Number(row.home_odds),
          draw_odds: row.draw_odds === null ? null : Number(row.draw_odds),
          away_odds: row.away_odds === null ? null : Number(row.away_odds)
        }))
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.max_spread - left.max_spread)

  return json({
    total: payload.length,
    results: payload
  })
}

async function handlePlaceBet(request: Request, env: Env): Promise<Response> {
  type PlaceBetBody = {
    match_id?: number
    selection?: string
    odds?: number
    amount?: number
    bet_type?: string
    bookmaker?: string
  }

  const userId = await requireUserId(request, env)
  if (userId instanceof Response) return userId

  const token = bearerTokenFromRequest(request)
  if (!token) {
    return json({ msg: 'Missing Authorization Header' }, { status: 401 })
  }

  const body = await readJson<PlaceBetBody>(request)
  if (
    body?.match_id === undefined ||
    !body.selection ||
    body.amount === undefined
  ) {
    return errorResponse('请填写所有必填字段', 400)
  }

  const matchId = Number(body.match_id)
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return errorResponse('比赛参数无效', 400)
  }

  const selection = String(body.selection).trim().toLowerCase()
  const betType = body.bet_type || 'h2h'
  if (betType !== 'h2h') {
    return errorResponse('当前只支持胜平负投注', 400)
  }

  let user = await getUserById(env, userId)
  if (!user) {
    return errorResponse('用户不存在', 404)
  }

  user = await ensureFreshVerificationState(env, token, user)
  if (user.email_verified !== 1) {
    return errorResponse('请先完成邮箱验证，再进行下注', 403)
  }

  const match = await env.DB.prepare(
    `SELECT id, league, home_team, away_team, start_time, status, allow_draw, has_home_away, source_type
     FROM matches WHERE id = ?`
  ).bind(matchId).first<{
    id: number
    league: string
    home_team: string
    away_team: string
    start_time: string
    status: string
    allow_draw: number
    has_home_away: number
    source_type: string
  }>()

  if (!match) {
    return errorResponse('比赛不存在', 404)
  }

  if (match.status !== 'upcoming') {
    return errorResponse('比赛已开始或结束', 400)
  }

  const matchStartMs = Date.parse(normalizeUtcIso(match.start_time) || '')
  if (!Number.isFinite(matchStartMs)) {
    return errorResponse('比赛时间异常，无法下注', 400)
  }

  if (Date.now() >= matchStartMs) {
    return errorResponse('比赛已经开始，无法下注', 400)
  }

  const allowedSelections = match.allow_draw === 1 ? ['home', 'draw', 'away'] : ['home', 'away']
  if (!allowedSelections.includes(selection)) {
    return errorResponse('当前比赛不支持该投注选项', 400)
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return errorResponse('下注金额必须大于0', 400)
  }

  if (amount > Number(user.balance)) {
    return errorResponse('余额不足', 400)
  }

  const resolvedOdds = await resolveServerBetOdds(env, matchId, selection, body.bookmaker)
  if (!resolvedOdds) {
    return errorResponse('暂无可用赔率，请先同步赔率', 400)
  }

  const odds = resolvedOdds.odds
  const potentialWin = round2(amount * odds)
  const createdAt = nowIso()

  const batchResult = await env.DB.batch<{ id: number }>([
    env.DB.prepare(
      `UPDATE users
       SET balance = round(balance - ?, 2), updated_at = ?
       WHERE id = ? AND balance >= ?`
    ).bind(amount, createdAt, userId, amount),
    env.DB.prepare(
      `INSERT INTO bets (user_id, match_id, bet_type, selection, odds, amount, potential_win, status, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?
       WHERE changes() = 1
       RETURNING id`
    ).bind(
      userId,
      matchId,
      betType,
      selection,
      odds,
      amount,
      potentialWin,
      createdAt
    )
  ])

  const insertResult = batchResult[1]?.results?.[0]
  if ((batchResult[0]?.meta?.changes ?? 0) !== 1 || !insertResult?.id) {
    return errorResponse('余额不足', 400)
  }

  const updatedUser = await getUserById(env, userId)
  const betRow = await env.DB.prepare(
    `SELECT
       b.id,
       b.user_id,
       b.match_id,
       b.bet_type,
       b.selection,
       b.odds,
       b.amount,
       b.potential_win,
       b.status,
       b.profit,
       b.settled_at,
       b.created_at,
       m.home_team,
       m.away_team,
       m.league,
       m.start_time,
       m.allow_draw,
       m.has_home_away
     FROM bets b
     JOIN matches m ON m.id = b.match_id
     WHERE b.id = ?`
  ).bind(insertResult?.id ?? 0).first<DbBetRow>()

  if (!betRow) {
    return errorResponse('下注成功，但读取注单失败', 500)
  }

  return json(
    {
      message: '下注成功',
      bet: toBetResponse(betRow),
      new_balance: updatedUser ? Number(updatedUser.balance) : round2(Number(user.balance) - amount),
      odds_source: {
        source: resolvedOdds.source,
        bookmaker: resolvedOdds.bookmaker,
        odds_count: resolvedOdds.oddsCount
      }
    },
    { status: 201 }
  )
}

async function handleGetUserBets(request: Request, url: URL, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env)
  if (userId instanceof Response) return userId

  const status = url.searchParams.get('status')
  const { page, pageSize, offset } = readPagination(url, 20, 100)
  const params: Array<string | number> = [userId]
  let whereSql = `WHERE b.user_id = ?`

  if (status) {
    whereSql += ` AND b.status = ?`
    params.push(status)
  }

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM bets b ${whereSql}`
  ).bind(...params).first<{ count: number }>()

  const sql = `
    SELECT
      b.id,
      b.user_id,
      b.match_id,
      b.bet_type,
      b.selection,
      b.odds,
      b.amount,
      b.potential_win,
      b.status,
      b.profit,
      b.settled_at,
      b.created_at,
      m.home_team,
      m.away_team,
      m.league,
      m.start_time,
      m.allow_draw,
      m.has_home_away
    FROM bets b
    JOIN matches m ON m.id = b.match_id
    ${whereSql}
    ORDER BY b.created_at DESC
    LIMIT ? OFFSET ?
  `

  const result = await env.DB.prepare(sql).bind(...params, pageSize, offset).all<DbBetRow>()

  return json({
    bets: (result.results ?? []).map(toBetResponse),
    total: Number(countRow?.count || 0),
    page,
    page_size: pageSize
  })
}

async function handleGetBet(request: Request, env: Env, betId: number): Promise<Response> {
  const userId = await requireUserId(request, env)
  if (userId instanceof Response) return userId

  const bet = await env.DB.prepare(
    `SELECT
       b.id,
       b.user_id,
       b.match_id,
       b.bet_type,
       b.selection,
       b.odds,
       b.amount,
       b.potential_win,
       b.status,
       b.profit,
       b.settled_at,
       b.created_at,
       m.home_team,
       m.away_team,
       m.league,
       m.start_time,
       m.allow_draw,
       m.has_home_away
     FROM bets b
     JOIN matches m ON m.id = b.match_id
     WHERE b.id = ?`
  ).bind(betId).first<DbBetRow>()

  if (!bet) {
    return errorResponse('注单不存在', 404)
  }

  if (bet.user_id !== userId) {
    return errorResponse('无权访问', 403)
  }

  return json({ bet: toBetResponse(bet) })
}

async function handleMyStats(request: Request, env: Env): Promise<Response> {
  const userId = await requireUserId(request, env)
  if (userId instanceof Response) return userId

  const user = await getUserById(env, userId)
  if (!user) {
    return errorResponse('用户不存在', 404)
  }

  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_bets,
       SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won_bets,
       SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost_bets,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_bets,
       COALESCE(SUM(amount), 0) AS total_wagered,
       COALESCE(SUM(CASE WHEN status IN ('won', 'lost') THEN profit ELSE 0 END), 0) AS total_profit
     FROM bets
     WHERE user_id = ?`
  ).bind(userId).first<{
    total_bets: number
    won_bets: number
    lost_bets: number
    pending_bets: number
    total_wagered: number
    total_profit: number
  }>()

  const totalBets = Number(stats?.total_bets ?? 0)
  const wonBets = Number(stats?.won_bets ?? 0)
  const lostBets = Number(stats?.lost_bets ?? 0)
  const pendingBets = Number(stats?.pending_bets ?? 0)
  const totalWagered = Number(stats?.total_wagered ?? 0)
  const totalProfit = Number(stats?.total_profit ?? 0)

  return json({
    balance: Number(user.balance),
    total_bets: totalBets,
    won_bets: wonBets,
    lost_bets: lostBets,
    pending_bets: pendingBets,
    total_wagered: totalWagered,
    total_profit: totalProfit,
    win_rate: totalBets > 0 ? round2((wonBets / totalBets) * 100) : 0
  })
}

async function handleLeaderboard(url: URL, env: Env): Promise<Response> {
  const { page, pageSize, offset } = readPagination(url, 20, 100)
  const sortBy = url.searchParams.get('sort_by') || 'score'
  const sortOrder = url.searchParams.get('sort_order') === 'ascending' ? 'ascending' : 'descending'
  const allowedSorts = new Set([
    'rank',
    'username',
    'balance',
    'total_profit',
    'profit_rate',
    'total_bets',
    'won_bets',
    'lost_bets',
    'win_rate',
    'score'
  ])
  const requestedSortKey = allowedSorts.has(sortBy) ? sortBy : 'score'
  const sortKey = requestedSortKey === 'rank' ? 'score' : requestedSortKey
  const effectiveSortOrder =
    requestedSortKey === 'rank'
      ? (sortOrder === 'ascending' ? 'descending' : 'ascending')
      : sortOrder

  const result = await env.DB.prepare(
    `SELECT
       u.id,
       u.username,
       u.balance,
       COUNT(b.id) AS total_bets,
       SUM(CASE WHEN b.status = 'won' THEN 1 ELSE 0 END) AS won_bets,
       SUM(CASE WHEN b.status = 'lost' THEN 1 ELSE 0 END) AS lost_bets,
       COALESCE(SUM(CASE WHEN b.status IN ('won', 'lost') THEN b.profit ELSE 0 END), 0) AS total_profit
     FROM users u
     JOIN bets b ON b.user_id = u.id
     WHERE u.firebase_uid IS NOT NULL
     GROUP BY u.id
     ORDER BY u.id`
  ).all<{
    id: number
    username: string
    balance: number
    total_bets: number
    won_bets: number
    lost_bets: number
    total_profit: number
  }>()

  const leaderboard = (result.results ?? []).map((row) => {
      const totalBets = Number(row.total_bets ?? 0)
      const wonBets = Number(row.won_bets ?? 0)
      const lostBets = Number(row.lost_bets ?? 0)
      const balance = Number(row.balance ?? 0)
      const totalProfit = Number(row.total_profit ?? 0)
      const profitRate = ((balance - 10000) / 10000) * 100
      const winRate = totalBets > 0 ? round2((wonBets / totalBets) * 100) : 0
      const betWeight = Math.min(Math.log2(totalBets + 1) * 10, 100)
      const score = round2(profitRate * 0.4 + winRate * 0.3 + betWeight * 0.3)

      return {
        user_id: row.id,
        username: row.username,
        balance,
        total_bets: totalBets,
        won_bets: wonBets,
        lost_bets: lostBets,
        total_profit: totalProfit,
        profit_rate: round2(profitRate),
        win_rate: winRate,
        score
      }
    })

  leaderboard.sort((left, right) => {
    const leftValue = left[sortKey as keyof typeof left]
    const rightValue = right[sortKey as keyof typeof right]

    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      const comparison = String(leftValue).localeCompare(String(rightValue), 'zh-CN')
      return effectiveSortOrder === 'ascending' ? comparison : -comparison
    }

    const comparison = Number(leftValue || 0) - Number(rightValue || 0)
    return effectiveSortOrder === 'ascending' ? comparison : -comparison
  })

  const ranked = leaderboard.map((item, index) => ({
    ...item,
    rank: index + 1
  }))

  return json({
    leaderboard: ranked.slice(offset, offset + pageSize),
    total: ranked.length,
    page,
    page_size: pageSize
  })
}

async function handleHomepageStats(env: Env): Promise<Response> {
  const betCount = await env.DB.prepare(`SELECT COUNT(*) AS count FROM bets`).first<{ count: number }>()
  const matchCount = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM matches m
     WHERE ${publicMatchVisibilityClause('m')} AND m.status = 'upcoming'`
  ).bind(...POPULAR_DISPLAY_LEAGUES).first<{ count: number }>()

  return json({
    totalBets: Number(betCount?.count ?? 0),
    totalMatches: Number(matchCount?.count ?? 0)
  })
}

async function loadAdminCustomMatchResponse(env: Env, matchId: number) {
  const row = await env.DB.prepare(
    `SELECT
       m.id,
       m.external_id,
       m.sport,
       m.league,
       m.home_team,
       m.away_team,
       m.start_time,
       m.status,
       m.source_type,
       m.allow_draw,
       m.has_home_away,
       m.home_score,
       m.away_score,
       m.created_at,
       (SELECT COUNT(*) FROM bets b WHERE b.match_id = m.id) AS total_bets,
       (SELECT COUNT(*) FROM bets b WHERE b.match_id = m.id AND b.status = 'pending') AS pending_bets,
       (SELECT o.home_odds FROM odds o WHERE o.match_id = m.id AND o.market = 'h2h' ORDER BY CASE WHEN o.bookmaker = 'ADMIN' THEN 0 ELSE 1 END, o.id LIMIT 1) AS avg_home_odds,
       (SELECT o.draw_odds FROM odds o WHERE o.match_id = m.id AND o.market = 'h2h' ORDER BY CASE WHEN o.bookmaker = 'ADMIN' THEN 0 ELSE 1 END, o.id LIMIT 1) AS avg_draw_odds,
       (SELECT o.away_odds FROM odds o WHERE o.match_id = m.id AND o.market = 'h2h' ORDER BY CASE WHEN o.bookmaker = 'ADMIN' THEN 0 ELSE 1 END, o.id LIMIT 1) AS avg_away_odds
     FROM matches m
     WHERE m.id = ? AND m.source_type = 'custom'`
  ).bind(matchId).first<{
    id: number
    external_id: string | null
    sport: string
    league: string
    home_team: string
    away_team: string
    start_time: string
    status: string
    source_type: string
    allow_draw: number
    has_home_away: number
    home_score: number | null
    away_score: number | null
    created_at: string
    total_bets: number | null
    pending_bets: number | null
    avg_home_odds: number | null
    avg_draw_odds: number | null
    avg_away_odds: number | null
  }>()

  if (!row) return null

  const oddsResult = await env.DB.prepare(
    `SELECT id, match_id, bookmaker, market, home_odds, away_odds, draw_odds, updated_at
     FROM odds
     WHERE match_id = ? AND market = 'h2h'
     ORDER BY CASE WHEN bookmaker = 'ADMIN' THEN 0 ELSE 1 END, bookmaker, id`
  ).bind(matchId).all<DbOddsRow>()

  return {
    ...toAdminMatchResponse(row),
    odds_rows: (oddsResult.results ?? []).map(toOddsResponse)
  }
}

async function handleAdminMatches(request: Request, url: URL, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const { page, pageSize, offset } = readPagination(url, 20, 100)
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM matches
     WHERE source_type = 'custom'`
  ).first<{ count: number }>()

  const result = await env.DB.prepare(
    `SELECT
       m.id,
       m.external_id,
       m.sport,
       m.league,
       m.home_team,
       m.away_team,
       m.start_time,
       m.status,
       m.source_type,
       m.allow_draw,
       m.has_home_away,
       m.home_score,
       m.away_score,
       m.created_at,
       (SELECT COUNT(*) FROM bets b WHERE b.match_id = m.id) AS total_bets,
       (SELECT COUNT(*) FROM bets b WHERE b.match_id = m.id AND b.status = 'pending') AS pending_bets,
       (SELECT o.home_odds FROM odds o WHERE o.match_id = m.id AND o.market = 'h2h' ORDER BY CASE WHEN o.bookmaker = 'ADMIN' THEN 0 ELSE 1 END, o.id LIMIT 1) AS avg_home_odds,
       (SELECT o.draw_odds FROM odds o WHERE o.match_id = m.id AND o.market = 'h2h' ORDER BY CASE WHEN o.bookmaker = 'ADMIN' THEN 0 ELSE 1 END, o.id LIMIT 1) AS avg_draw_odds,
       (SELECT o.away_odds FROM odds o WHERE o.match_id = m.id AND o.market = 'h2h' ORDER BY CASE WHEN o.bookmaker = 'ADMIN' THEN 0 ELSE 1 END, o.id LIMIT 1) AS avg_away_odds
     FROM matches m
     WHERE m.source_type = 'custom'
     ORDER BY datetime(m.start_time) DESC, m.id DESC
     LIMIT ? OFFSET ?`
  ).bind(pageSize, offset).all<{
    id: number
    external_id: string | null
    sport: string
    league: string
    home_team: string
    away_team: string
    start_time: string
    status: string
    source_type: string
    allow_draw: number
    has_home_away: number
    home_score: number | null
    away_score: number | null
    created_at: string
    total_bets: number | null
    pending_bets: number | null
    avg_home_odds: number | null
    avg_draw_odds: number | null
    avg_away_odds: number | null
  }>()

  return json({
    matches: (result.results ?? []).map(toAdminMatchResponse),
    total: Number(totalRow?.count || 0),
    page,
    page_size: pageSize
  })
}

async function handleGetAdminMatch(request: Request, env: Env, matchId: number): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const match = await loadAdminCustomMatchResponse(env, matchId)
  if (!match) {
    return errorResponse('自定义比赛不存在', 404)
  }

  return json({ match })
}

async function handleCreateAdminMatch(request: Request, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const body = await readJson<CustomMatchPayload>(request)
  const validated = validateCustomMatchInput(body)
  if (validated instanceof Response) return validated

  const createdAt = nowIso()
  const insertResult = await env.DB.prepare(
    `INSERT INTO matches (
       external_id, sport, league, home_team, away_team, start_time, status, source_type, allow_draw, has_home_away, home_score, away_score, created_at
     ) VALUES (
       NULL, ?, ?, ?, ?, ?, 'upcoming', 'custom', ?, ?, NULL, NULL, ?
     )
     RETURNING id`
  ).bind(
    validated.sport,
    validated.league,
    validated.homeTeam,
    validated.awayTeam,
    validated.startTimeIso,
    validated.allowDraw ? 1 : 0,
    validated.hasHomeAway ? 1 : 0,
    createdAt
  ).first<{ id: number }>()

  if (!insertResult?.id) {
    return errorResponse('创建自定义比赛失败', 500)
  }

  await env.DB.prepare(
    `INSERT INTO odds (match_id, bookmaker, market, home_odds, away_odds, draw_odds, updated_at)
     VALUES (?, 'ADMIN', 'h2h', ?, ?, ?, ?)`
  ).bind(
    insertResult.id,
    validated.homeOdds,
    validated.awayOdds,
    validated.drawOdds,
    createdAt
  ).run()

  const match = await loadAdminCustomMatchResponse(env, insertResult.id)
  return json(
    {
      message: '自定义比赛创建成功',
      match
    },
    { status: 201 }
  )
}

async function handleUpdateAdminMatch(request: Request, env: Env, matchId: number): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const existing = await loadAdminCustomMatchResponse(env, matchId)
  if (!existing) {
    return errorResponse('自定义比赛不存在', 404)
  }

  if (existing.locked) {
    return errorResponse('该比赛已有下注，不能再修改核心信息和赔率', 409)
  }

  if (existing.status === 'finished') {
    return errorResponse('已结算比赛不能再编辑', 409)
  }

  const body = await readJson<CustomMatchPayload>(request)
  const validated = validateCustomMatchInput(body)
  if (validated instanceof Response) return validated

  const updatedAt = nowIso()
  await env.DB.prepare(
    `UPDATE matches
     SET sport = ?, league = ?, home_team = ?, away_team = ?, start_time = ?, status = 'upcoming',
         source_type = 'custom', allow_draw = ?, has_home_away = ?, home_score = NULL, away_score = NULL
     WHERE id = ? AND source_type = 'custom'`
  ).bind(
    validated.sport,
    validated.league,
    validated.homeTeam,
    validated.awayTeam,
    validated.startTimeIso,
    validated.allowDraw ? 1 : 0,
    validated.hasHomeAway ? 1 : 0,
    matchId
  ).run()

  await env.DB.prepare(
    `INSERT INTO odds (match_id, bookmaker, market, home_odds, away_odds, draw_odds, updated_at)
     VALUES (?, 'ADMIN', 'h2h', ?, ?, ?, ?)
     ON CONFLICT(match_id, bookmaker, market) DO UPDATE SET
       home_odds = excluded.home_odds,
       away_odds = excluded.away_odds,
       draw_odds = excluded.draw_odds,
       updated_at = excluded.updated_at`
  ).bind(
    matchId,
    validated.homeOdds,
    validated.awayOdds,
    validated.drawOdds,
    updatedAt
  ).run()

  const match = await loadAdminCustomMatchResponse(env, matchId)
  return json({
    message: '自定义比赛已更新',
    match
  })
}

async function handleSettleAdminMatch(request: Request, env: Env, matchId: number): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const existing = await loadAdminCustomMatchResponse(env, matchId)
  if (!existing) {
    return errorResponse('自定义比赛不存在', 404)
  }

  if (existing.status === 'finished') {
    return errorResponse('该比赛已经结算完成', 409)
  }

  const body = await readJson<CustomMatchSettlementPayload>(request)
  const homeScore = parseNonNegativeInteger(body?.home_score)
  const awayScore = parseNonNegativeInteger(body?.away_score)
  if (homeScore === null || awayScore === null) {
    return errorResponse('比分必须是大于等于 0 的整数', 400)
  }

  if (!existing.allow_draw && homeScore === awayScore) {
    return errorResponse('该比赛不允许平局，请录入非平分比分', 400)
  }

  await env.DB.prepare(
    `UPDATE matches
     SET status = 'finished', home_score = ?, away_score = ?
     WHERE id = ? AND source_type = 'custom'`
  ).bind(homeScore, awayScore, matchId).run()

  const settlement = await settlePendingBets(env, {
    matchId,
    sourceType: 'custom'
  })
  const match = await loadAdminCustomMatchResponse(env, matchId)

  return json({
    message: `比赛已结算：${settlement.settled} 单（赢 ${settlement.won} / 输 ${settlement.lost} / 退款 ${settlement.cancelled}）`,
    match,
    settlement
  })
}

async function handleAdminBets(request: Request, url: URL, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const { page, pageSize, offset } = readPagination(url, 20, 100)
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM bets`).first<{ count: number }>()
  const summaryRow = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won,
       SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
     FROM bets`
  ).first<{
    pending: number | null
    won: number | null
    lost: number | null
    cancelled: number | null
  }>()

  const result = await env.DB.prepare(
    `SELECT
       b.id,
       b.user_id,
       b.match_id,
       b.bet_type,
       b.selection,
       b.odds,
       b.amount,
       b.potential_win,
       b.status,
       b.profit,
       b.settled_at,
       b.created_at,
       u.username,
       u.email,
       m.home_team,
       m.away_team,
       m.league,
       m.start_time,
       m.allow_draw,
       m.has_home_away
     FROM bets b
     JOIN users u ON u.id = b.user_id
     JOIN matches m ON m.id = b.match_id
     ORDER BY b.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(pageSize, offset).all<
    DbBetRow & {
      username: string
      email: string
    }
  >()

  const bets = (result.results ?? []).map((bet) => ({
    ...toBetResponse(bet),
    user: {
      username: bet.username,
      email: bet.email
    }
  }))

  return json({
    total: Number(totalRow?.count || 0),
    page,
    page_size: pageSize,
    summary: {
      pending: Number(summaryRow?.pending || 0),
      won: Number(summaryRow?.won || 0),
      lost: Number(summaryRow?.lost || 0),
      cancelled: Number(summaryRow?.cancelled || 0)
    },
    bets
  })
}

async function handleAdminUsers(request: Request, url: URL, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const { page, pageSize, offset } = readPagination(url, 20, 100)
  const search = (url.searchParams.get('search') || '').trim()
  const whereParts = ['(u.firebase_uid IS NOT NULL OR u.is_admin = 1)']
  const params: unknown[] = []

  if (search) {
    whereParts.push('(lower(u.username) LIKE lower(?) OR lower(u.email) LIKE lower(?))')
    params.push(`%${search}%`, `%${search}%`)
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM users u
     ${whereSql}`
  ).bind(...params).first<{ count: number }>()

  const result = await env.DB.prepare(
    `SELECT
       u.id,
       u.username,
       u.email,
       u.balance,
       u.email_verified,
       u.is_admin,
       u.created_at,
       COUNT(b.id) AS total_bets,
       SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending_bets,
       COALESCE(SUM(CASE WHEN b.status IN ('won', 'lost') THEN b.profit ELSE 0 END), 0) AS total_profit
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id
     ${whereSql}
     GROUP BY u.id
     ORDER BY datetime(u.created_at) DESC, u.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, pageSize, offset).all<{
    id: number
    username: string
    email: string
    balance: number
    email_verified: number
    is_admin: number
    created_at: string
    total_bets: number | null
    pending_bets: number | null
    total_profit: number | null
  }>()

  const users = (result.results ?? []).map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    balance: Number(user.balance),
    email_verified: user.email_verified === 1,
    is_admin: user.is_admin === 1,
    created_at: normalizeUtcIso(user.created_at),
    total_bets: Number(user.total_bets || 0),
    pending_bets: Number(user.pending_bets || 0),
    total_profit: Number(user.total_profit || 0)
  }))

  return json({
    users,
    total: Number(totalRow?.count || 0),
    page,
    page_size: pageSize
  })
}

async function handleAdminSystem(request: Request, env: Env): Promise<Response> {
  const adminUserId = await requireAdminUserId(request, env)
  if (adminUserId instanceof Response) return adminUserId

  const monthlyQuota = Number(env.ODDS_API_MONTHLY_QUOTA || '500')
  const remaining = Number((await getSetting(env, 'odds_api_remaining')) || monthlyQuota)
  const used = Number((await getSetting(env, 'odds_api_used')) || Math.max(monthlyQuota - remaining, 0))
  const lastCheckedAt = await getSetting(env, 'odds_api_last_checked_at')
  const lastSyncAt = await getSetting(env, 'odds_api_last_sync_at')
  const lastError = (await getSetting(env, 'odds_api_last_error')) || null
  const lastResultSyncAt = await getSetting(env, 'settlement_last_result_sync_at')
  const lastSettlementRunAt = await getSetting(env, 'settlement_last_run_at')
  const lastSettlementError = (await getSetting(env, 'settlement_last_error')) || null
  const lastSettlementCountsRaw = await getSetting(env, 'settlement_last_counts')
  const oddsApiDailyLimit = readOddsApiDailyLimit(env)
  const oddsApiDailyUsed = await getOddsApiDailyUsage(env, getShanghaiDateKey())
  const lastResultProvider = (await getSetting(env, 'settlement_last_result_provider')) || null
  const lastSkipReason = (await getSetting(env, 'settlement_last_skip_reason')) || null
  let lastSettlementCounts = {
    settled: 0,
    won: 0,
    lost: 0,
    cancelled: 0,
    skipped: 0
  }
  if (lastSettlementCountsRaw) {
    try {
      lastSettlementCounts = {
        ...lastSettlementCounts,
        ...JSON.parse(lastSettlementCountsRaw)
      }
    } catch {
      // ignore malformed stored value
    }
  }

  return json({
    oddsApi: {
      monthlyQuota,
      remaining,
      used,
      lastCheckedAt,
      lastSyncAt,
      lastError
    },
    settlement: {
      lastResultSyncAt,
      lastSettlementRunAt,
      lastSettlementError,
      lastSettlementCounts,
      oddsApiDailyUsed,
      oddsApiDailyLimit,
      lastResultProvider,
      lastSkipReason
    },
    popularLeagues: POPULAR_DISPLAY_LEAGUES,
    notes: [
      '当前只同步热门联赛和 NBA。',
      '江苏联、亚洲杯不在当前 The Odds API 可用赛事列表中，因此未纳入自动同步。'
    ]
  })
}
