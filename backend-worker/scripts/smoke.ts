import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { importPKCS8, SignJWT } from 'jose'

import worker from '../src/index.ts'
import type { Env } from '../src/types.ts'

class MockD1PreparedStatement {
  private readonly database: DatabaseSync
  private readonly sql: string
  private readonly params: unknown[]

  constructor(database: DatabaseSync, sql: string, params: unknown[] = []) {
    this.database = database
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]) {
    return new MockD1PreparedStatement(this.database, this.sql, params)
  }

  async first<T>(): Promise<T | null> {
    const statement = this.database.prepare(this.sql)
    const row = statement.get(...this.params) as T | undefined
    return row ?? null
  }

  async all<T>(): Promise<{ results: T[] }> {
    const statement = this.database.prepare(this.sql)
    return {
      results: statement.all(...this.params) as T[]
    }
  }

  async run<T>(): Promise<{ success: true; meta: { changes: number }; results: T[] }> {
    const statement = this.database.prepare(this.sql)
    if (/\breturning\b/i.test(this.sql)) {
      const rows = statement.all(...this.params) as T[]
      return {
        success: true,
        meta: { changes: rows.length },
        results: rows
      }
    }

    const result = statement.run(...this.params)
    return {
      success: true,
      meta: { changes: Number(result.changes || 0) },
      results: []
    }
  }
}

class MockD1Database {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  prepare(sql: string) {
    return new MockD1PreparedStatement(this.database, sql)
  }

  async batch(statements: MockD1PreparedStatement[]) {
    const results = []
    for (const statement of statements) {
      results.push(await statement.run())
    }
    return results
  }
}

function makeJsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers
    }
  })
}

type MockFirebaseUser = {
  uid: string
  email: string
  password: string
  emailVerified: boolean
}

const firebaseUsers = new Map<string, MockFirebaseUser>()
const refreshTokens = new Map<string, string>()
const sentEmails: Array<{ to: string; requestType: string; oobCode: string }> = []
const emailActionCodes = new Map<string, { email: string; used: boolean; expired: boolean }>()
let nextFirebaseUserId = 1
let nextOobCodeId = 1

const mockOddsEventsBySport: Record<string, Array<Record<string, unknown>>> = {
  soccer_epl: [
    {
      id: 'odds_soccer_match_1',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      commence_time: '2099-05-17T12:00:00Z',
      sport_title: 'Premier League',
      bookmakers: [
        {
          title: 'Bet365',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Arsenal', price: 1.9 },
                { name: 'Chelsea', price: 3.6 },
                { name: 'Draw', price: 3.4 }
              ]
            }
          ]
        },
        {
          title: 'William Hill',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Arsenal', price: 1.95 },
                { name: 'Chelsea', price: 3.55 },
                { name: 'Draw', price: 3.3 }
              ]
            }
          ]
        }
      ]
    }
  ],
  basketball_nba: [
    {
      id: 'odds_nba_match_1',
      home_team: 'Detroit Pistons',
      away_team: 'Cleveland Cavaliers',
      commence_time: '2099-05-17T10:10:00Z',
      sport_title: 'NBA',
      bookmakers: [
        {
          title: 'Bet365',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Detroit Pistons', price: 1.6 },
                { name: 'Cleveland Cavaliers', price: 2.4 }
              ]
            }
          ]
        },
        {
          title: 'William Hill',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Detroit Pistons', price: 1.58 },
                { name: 'Cleveland Cavaliers', price: 2.45 }
              ]
            }
          ]
        }
      ]
    }
  ]
}

const mockScoreEventsBySport: Record<string, Array<Record<string, unknown>>> = {
  soccer_epl: [
    {
      id: 'odds_soccer_match_1',
      sport_key: 'soccer_epl',
      sport_title: 'Premier League',
      commence_time: '2099-05-17T12:00:00Z',
      completed: true,
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      scores: [
        { name: 'Arsenal', score: 2 },
        { name: 'Chelsea', score: 1 }
      ],
      last_update: '2099-05-17T14:10:00Z'
    }
  ],
  basketball_nba: [
    {
      id: 'odds_nba_match_1',
      sport_key: 'basketball_nba',
      sport_title: 'NBA',
      commence_time: '2099-05-17T10:10:00Z',
      completed: true,
      home_team: 'Detroit Pistons',
      away_team: 'Cleveland Cavaliers',
      scores: [
        { name: 'Detroit Pistons', score: 110 },
        { name: 'Cleveland Cavaliers', score: 102 }
      ],
      last_update: '2099-05-17T12:30:00Z'
    }
  ]
}

let oddsScoreRequestCount = 0
let footballDataMatchRequestCount = 0
let verificationEmailRequestCount = 0

const remoteFetch = globalThis.fetch.bind(globalThis)

const firebaseProjectId = 'betting-simulator-smoke'
const firebaseApiKey = 'firebase-smoke-api-key'
const firebaseAuthBaseUrl = 'https://mock-firebase.local/v1'
const firebaseSecureTokenBaseUrl = 'https://mock-firebase.local/token'
const firebasePublicKeysUrl = 'https://mock-firebase.local/keys'
const firebaseKid = 'smoke-key-1'
const googleOauthTokenUrl = 'https://mock-google.local/token'

const { privateKey: privateKeyPem, publicKey: publicKeyPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
})

async function createIdToken(user: MockFirebaseUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const privateKey = await importPKCS8(privateKeyPem, 'RS256')

  return new SignJWT({
    email: user.email,
    email_verified: user.emailVerified
  })
    .setProtectedHeader({ alg: 'RS256', kid: firebaseKid, typ: 'JWT' })
    .setIssuer(`https://securetoken.google.com/${firebaseProjectId}`)
    .setAudience(firebaseProjectId)
    .setSubject(user.uid)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== 'string') {
    return {}
  }

  return JSON.parse(init.body) as Record<string, unknown>
}

function parseFormBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
}

function decodeJwtPayload(token: string): { sub?: string } {
  const [, body] = token.split('.')
  if (!body) return {}

  const padded = body.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(body.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { sub?: string }
}

async function issueSession(user: MockFirebaseUser) {
  const idToken = await createIdToken(user)
  const refreshToken = `refresh-${user.uid}-${Date.now()}-${Math.random()}`
  refreshTokens.set(refreshToken, user.uid)

  return {
    localId: user.uid,
    email: user.email,
    idToken,
    refreshToken,
    expiresIn: '3600'
  }
}

async function handleMockFirebase(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  if (url === firebasePublicKeysUrl) {
    return makeJsonResponse(
      {
        [firebaseKid]: publicKeyPem
      },
      200,
      {
        'cache-control': 'public, max-age=3600'
      }
    )
  }

  if (url === `${firebaseAuthBaseUrl}/accounts:signUp?key=${firebaseApiKey}`) {
    const body = parseJsonBody(init)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (firebaseUsers.has(email)) {
      return makeJsonResponse({ error: { message: 'EMAIL_EXISTS' } }, 400)
    }

    const user: MockFirebaseUser = {
      uid: `uid-${nextFirebaseUserId++}`,
      email,
      password,
      emailVerified: false
    }
    firebaseUsers.set(email, user)

    return makeJsonResponse(await issueSession(user))
  }

  if (url === `${firebaseAuthBaseUrl}/accounts:signInWithPassword?key=${firebaseApiKey}`) {
    const body = parseJsonBody(init)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const user = firebaseUsers.get(email)

    if (!user || user.password !== password) {
      return makeJsonResponse({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400)
    }

    return makeJsonResponse(await issueSession(user))
  }

  if (url === `${firebaseAuthBaseUrl}/accounts:lookup?key=${firebaseApiKey}`) {
    const body = parseJsonBody(init)
    const idToken = String(body.idToken || '')
    const payload = decodeJwtPayload(idToken)
    const user = Array.from(firebaseUsers.values()).find((item) => item.uid === payload.sub)

    if (!user) {
      return makeJsonResponse({ users: [] })
    }

    return makeJsonResponse({
      users: [
        {
          localId: user.uid,
          email: user.email,
          emailVerified: user.emailVerified
        }
      ]
    })
  }

  if (url === `${firebaseAuthBaseUrl}/accounts:sendOobCode?key=${firebaseApiKey}`) {
    const body = parseJsonBody(init)
    const requestType = String(body.requestType || '')

    if (requestType === 'VERIFY_EMAIL') {
      verificationEmailRequestCount += 1
      const idToken = String(body.idToken || '')
      const payload = decodeJwtPayload(idToken)
      const user = Array.from(firebaseUsers.values()).find((item) => item.uid === payload.sub)

      if (!user) {
        return makeJsonResponse({ error: { message: 'INVALID_ID_TOKEN' } }, 400)
      }

      const oobCode = `verify-email-${nextOobCodeId++}`
      emailActionCodes.set(oobCode, {
        email: user.email,
        used: false,
        expired: false
      })
      sentEmails.push({
        to: user.email,
        requestType,
        oobCode
      })

      return makeJsonResponse({ email: user.email, oobCode })
    }

    if (requestType === 'PASSWORD_RESET') {
      const email = String(body.email || '').trim().toLowerCase()
      if (!firebaseUsers.has(email)) {
        return makeJsonResponse({ error: { message: 'EMAIL_NOT_FOUND' } }, 400)
      }
      return makeJsonResponse({ email })
    }
  }

  if (url === `${firebaseAuthBaseUrl}/accounts:update?key=${firebaseApiKey}`) {
    const body = parseJsonBody(init)
    const oobCode = String(body.oobCode || '').trim()

    if (oobCode === 'expired-oob-code') {
      return makeJsonResponse({ error: { message: 'EXPIRED_OOB_CODE' } }, 400)
    }

    const action = emailActionCodes.get(oobCode)
    if (!action || action.used) {
      return makeJsonResponse({ error: { message: 'INVALID_OOB_CODE' } }, 400)
    }
    if (action.expired) {
      return makeJsonResponse({ error: { message: 'EXPIRED_OOB_CODE' } }, 400)
    }

    const user = firebaseUsers.get(action.email)
    if (!user) {
      return makeJsonResponse({ error: { message: 'INVALID_OOB_CODE' } }, 400)
    }

    user.emailVerified = true
    action.used = true

    return makeJsonResponse({
      localId: user.uid,
      email: user.email,
      emailVerified: true
    })
  }

  if (url === `${firebaseSecureTokenBaseUrl}/token?key=${firebaseApiKey}`) {
    const form = parseFormBody(init)
    const refreshToken = form.get('refresh_token') || ''
    const uid = refreshTokens.get(refreshToken)

    if (!uid) {
      return makeJsonResponse({ error: { message: 'INVALID_REFRESH_TOKEN' } }, 400)
    }

    const user = Array.from(firebaseUsers.values()).find((item) => item.uid === uid)
    if (!user) {
      return makeJsonResponse({ error: { message: 'INVALID_REFRESH_TOKEN' } }, 400)
    }

    const session = await issueSession(user)
    return makeJsonResponse({
      user_id: user.uid,
      id_token: session.idToken,
      refresh_token: session.refreshToken,
      expires_in: session.expiresIn
    })
  }

  if (url === googleOauthTokenUrl) {
    return makeJsonResponse({
      access_token: 'google-access-token',
      token_type: 'Bearer',
      expires_in: 3600
    })
  }



  return null
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const firebaseResponse = await handleMockFirebase(input, init)
  if (firebaseResponse) {
    return firebaseResponse
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  if (url.includes('api.the-odds-api.com')) {
    const parsedUrl = new URL(url)
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
    const sportKey = pathParts[2]
    const endpoint = pathParts[3]

    if (endpoint === 'odds') {
      return makeJsonResponse(mockOddsEventsBySport[sportKey] || [], 200, {
        'x-requests-remaining': '499'
      })
    }

    if (endpoint === 'scores') {
      oddsScoreRequestCount += 1
      return makeJsonResponse(mockScoreEventsBySport[sportKey] || [], 200, {
        'x-requests-remaining': '497'
      })
    }
  }

  if (url.includes('api.football-data.org')) {
    footballDataMatchRequestCount += 1
    const parsedUrl = new URL(url)
    if (parsedUrl.pathname.endsWith('/matches/202')) {
      return makeJsonResponse({
        match: {
          id: 202,
          utcDate: '2099-05-17T11:00:00Z',
          status: 'FINISHED',
          homeTeam: { name: 'Liverpool FC' },
          awayTeam: { name: 'Manchester City FC' },
          competition: { name: 'Premier League' },
          score: {
            fullTime: {
              home: 3,
              away: 1
            }
          }
        }
      })
    }

    return makeJsonResponse({
      matches: [
        {
          id: 101,
          utcDate: '2099-05-18T15:00:00Z',
          status: 'SCHEDULED',
          homeTeam: { name: 'Liverpool FC' },
          awayTeam: { name: 'Manchester City FC' },
          competition: { name: 'Premier League' },
          score: {
            fullTime: {
              home: null,
              away: null
            }
          }
        }
      ]
    })
  }



  return remoteFetch(input, init)
}) as typeof fetch

async function callApi(path: string, init: RequestInit = {}) {
  const request = new Request(`https://example.com${path}`, init)
  const response = await worker.fetch(request, env)
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, body }
}

async function runScheduled(scheduledTime = Date.parse('2099-05-17T13:00:00Z')) {
  const waits: Promise<unknown>[] = []
  const context = {
    waitUntil: (promise: Promise<unknown>) => {
      waits.push(promise)
      return promise
    }
  } as ExecutionContext

  await worker.scheduled?.({ cron: '0 0-15 * * *', scheduledTime } as ScheduledController, env, context)
  await Promise.all(waits)
}

const sqlite = new DatabaseSync(':memory:')
const migrationDir = resolve('migrations')
for (const fileName of readdirSync(migrationDir).sort()) {
  sqlite.exec(readFileSync(resolve(migrationDir, fileName), 'utf8'))
}

const env: Env = {
  DB: new MockD1Database(sqlite) as unknown as D1Database,
  FIREBASE_API_KEY: firebaseApiKey,
  FIREBASE_PROJECT_ID: firebaseProjectId,
  FIREBASE_AUTH_BASE_URL: firebaseAuthBaseUrl,
  FIREBASE_SECURE_TOKEN_BASE_URL: firebaseSecureTokenBaseUrl,
  FIREBASE_PUBLIC_KEYS_URL: firebasePublicKeysUrl,
  GOOGLE_OAUTH_TOKEN_URL: googleOauthTokenUrl,
  ADMIN_EMAILS: 'admin@example.com',
  ODDS_API_KEY: 'test-odds-key',
  FOOTBALL_DATA_API_KEY: 'test-football-key',
  ODDS_API_BASE_URL: 'https://api.the-odds-api.com/v4',
  FOOTBALL_DATA_BASE_URL: 'https://api.football-data.org/v4',
  ODDS_API_MONTHLY_QUOTA: '500',
  ODDS_API_DAILY_LIMIT: '16',
  THE_SPORTS_DB_BASE_URL: 'https://www.thesportsdb.com/api/v1/json/3'
}

async function main() {
  const register = await callApi('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: 'worker-user',
      email: 'worker@test.com',
      password: 'pass123456'
    }),
    headers: { 'content-type': 'application/json' }
  })
  if (register.response.status !== 201) throw new Error(`register failed: ${JSON.stringify(register.body)}`)
  if (register.body.verification_email_sent !== true) {
    throw new Error(`verification email flag missing: ${JSON.stringify(register.body)}`)
  }

  const initialToken = register.body.id_token as string
  const refreshToken = register.body.refresh_token as string
  const authHeaders = {
    authorization: `Bearer ${initialToken}`,
    'content-type': 'application/json'
  }

  const profile = await callApi('/api/auth/profile', {
    method: 'GET',
    headers: { authorization: `Bearer ${initialToken}` }
  })
  if (profile.response.status !== 200 || profile.body.user.email_verified !== false) {
    throw new Error(`profile failed: ${JSON.stringify(profile.body)}`)
  }

  const resendVerification = await callApi('/api/auth/resend-verification', {
    method: 'POST',
    headers: { authorization: `Bearer ${initialToken}` }
  })
  if (resendVerification.response.status !== 200) {
    throw new Error(`resend verification failed: ${JSON.stringify(resendVerification.body)}`)
  }

  const latestVerificationEmail = sentEmails[sentEmails.length - 1]
  if (!latestVerificationEmail || latestVerificationEmail.to !== 'worker@test.com') {
    throw new Error(`verification email was not recorded: ${JSON.stringify(sentEmails)}`)
  }

  const completeVerification = await callApi('/api/auth/complete-email-verification', {
    method: 'POST',
    body: JSON.stringify({ oobCode: latestVerificationEmail.oobCode }),
    headers: { 'content-type': 'application/json' }
  })
  if (
    completeVerification.response.status !== 200 ||
    completeVerification.body.user?.email_verified !== true
  ) {
    throw new Error(`complete verification failed: ${JSON.stringify(completeVerification.body)}`)
  }

  const verifiedProfile = await callApi('/api/auth/profile', {
    method: 'GET',
    headers: { authorization: `Bearer ${initialToken}` }
  })
  if (verifiedProfile.response.status !== 200 || verifiedProfile.body.user.email_verified !== true) {
    throw new Error(`profile after verify failed: ${JSON.stringify(verifiedProfile.body)}`)
  }

  const adminUsersAfterVerifyBlocked = await callApi('/api/admin/users', {
    method: 'GET',
    headers: { authorization: `Bearer ${initialToken}` }
  })
  if (adminUsersAfterVerifyBlocked.response.status !== 403) {
    throw new Error(`non-admin users list should stay forbidden: ${JSON.stringify(adminUsersAfterVerifyBlocked.body)}`)
  }

  await env.DB.prepare(`UPDATE users SET email_verified = 0 WHERE email = ?`).bind('worker@test.com').run()
  const verificationRequestsBeforeSync = verificationEmailRequestCount
  const syncVerifiedUser = await callApi('/api/auth/resend-verification', {
    method: 'POST',
    headers: { authorization: `Bearer ${initialToken}` }
  })
  if (
    syncVerifiedUser.response.status !== 200 ||
    syncVerifiedUser.body.user?.email_verified !== true
  ) {
    throw new Error(`verified resend sync failed: ${JSON.stringify(syncVerifiedUser.body)}`)
  }
  if (verificationEmailRequestCount !== verificationRequestsBeforeSync) {
    throw new Error('verified resend should sync local state without sending another email')
  }

  const expiredVerification = await callApi('/api/auth/complete-email-verification', {
    method: 'POST',
    body: JSON.stringify({ oobCode: 'expired-oob-code' }),
    headers: { 'content-type': 'application/json' }
  })
  if (
    expiredVerification.response.status !== 400 ||
    typeof expiredVerification.body.error !== 'string' ||
    !expiredVerification.body.error.includes('验证链接已失效')
  ) {
    throw new Error(`expired verification link failed: ${JSON.stringify(expiredVerification.body)}`)
  }

  const forgotPassword = await callApi('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'worker-user' }),
    headers: { 'content-type': 'application/json' }
  })
  if (forgotPassword.response.status !== 200) {
    throw new Error(`forgot password failed: ${JSON.stringify(forgotPassword.body)}`)
  }

  const loginByEmail = await callApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'worker@test.com', password: 'pass123456' }),
    headers: { 'content-type': 'application/json' }
  })
  if (loginByEmail.response.status !== 200) {
    throw new Error(`email login failed: ${JSON.stringify(loginByEmail.body)}`)
  }

  const loginByUsername = await callApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'worker-user', password: 'pass123456' }),
    headers: { 'content-type': 'application/json' }
  })
  if (loginByUsername.response.status !== 200) {
    throw new Error(`username login failed: ${JSON.stringify(loginByUsername.body)}`)
  }

  const forbiddenSync = await callApi('/api/matches/sync?force=true', {
    method: 'POST',
    headers: authHeaders
  })
  if (forbiddenSync.response.status !== 403) {
    throw new Error(`non-admin sync should be forbidden: ${JSON.stringify(forbiddenSync.body)}`)
  }

  const forbiddenScheduleSync = await callApi('/api/matches/sync-schedule', {
    method: 'POST',
    headers: authHeaders
  })
  if (forbiddenScheduleSync.response.status !== 403) {
    throw new Error(`non-admin schedule sync should be forbidden: ${JSON.stringify(forbiddenScheduleSync.body)}`)
  }

  const forbiddenSyncAll = await callApi('/api/matches/sync-all', {
    method: 'POST',
    headers: authHeaders
  })
  if (forbiddenSyncAll.response.status !== 403) {
    throw new Error(`non-admin sync-all should be forbidden: ${JSON.stringify(forbiddenSyncAll.body)}`)
  }

  const adminUser: MockFirebaseUser = {
    uid: 'admin-uid-1',
    email: 'admin@example.com',
    password: 'change-me-admin-password',
    emailVerified: false
  }
  firebaseUsers.set(adminUser.email, adminUser)

  const adminLogin = await callApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'admin', password: 'change-me-admin-password' }),
    headers: { 'content-type': 'application/json' }
  })
  if (
    adminLogin.response.status !== 200 ||
    adminLogin.body.user.is_admin !== true ||
    adminLogin.body.user.email_verified !== true ||
    adminLogin.body.user.email !== 'admin@example.com'
  ) {
    throw new Error(`admin login failed: ${JSON.stringify(adminLogin.body)}`)
  }

  const adminHeaders = {
    authorization: `Bearer ${adminLogin.body.id_token as string}`,
    'content-type': 'application/json'
  }

  const verificationRequestsBeforeAdminResend = verificationEmailRequestCount
  const adminResendVerification = await callApi('/api/auth/resend-verification', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if (
    adminResendVerification.response.status !== 200 ||
    adminResendVerification.body.message !== '管理员邮箱已自动验证' ||
    adminResendVerification.body.user?.email_verified !== true
  ) {
    throw new Error(`fixed admin resend verification failed: ${JSON.stringify(adminResendVerification.body)}`)
  }
  if (verificationEmailRequestCount !== verificationRequestsBeforeAdminResend) {
    throw new Error('fixed admin resend should not call Firebase verification email')
  }

  const forbiddenAdminUsers = await callApi('/api/admin/users', {
    method: 'GET',
    headers: { authorization: `Bearer ${initialToken}` }
  })
  if (forbiddenAdminUsers.response.status !== 403) {
    throw new Error(`non-admin users list should be forbidden: ${JSON.stringify(forbiddenAdminUsers.body)}`)
  }

  const adminUsers = await callApi('/api/admin/users?search=worker', {
    method: 'GET',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if (
    adminUsers.response.status !== 200 ||
    adminUsers.body.total !== 1 ||
    adminUsers.body.users?.[0]?.email !== 'worker@test.com' ||
    adminUsers.body.users?.[0]?.email_verified !== true
  ) {
    throw new Error(`admin users search failed: ${JSON.stringify(adminUsers.body)}`)
  }

  const emptyLeaderboard = await callApi('/api/stats/leaderboard')
  if (emptyLeaderboard.response.status !== 200 || emptyLeaderboard.body.total !== 0) {
    throw new Error(`leaderboard should exclude users without bets: ${JSON.stringify(emptyLeaderboard.body)}`)
  }

  const homepageStats = await callApi('/api/stats/homepage')
  if (homepageStats.response.status !== 200 || Object.prototype.hasOwnProperty.call(homepageStats.body, 'totalUsers')) {
    throw new Error(`homepage should not expose total users: ${JSON.stringify(homepageStats.body)}`)
  }

  const syncSchedule = await callApi('/api/matches/sync-schedule', {
    method: 'POST',
    headers: adminHeaders
  })
  if (syncSchedule.response.status !== 200) throw new Error(`sync schedule failed: ${JSON.stringify(syncSchedule.body)}`)

  const syncOdds = await callApi('/api/matches/sync?force=true', {
    method: 'POST',
    headers: adminHeaders
  })
  if (syncOdds.response.status !== 200) throw new Error(`sync odds failed: ${JSON.stringify(syncOdds.body)}`)

  const matches = await callApi('/api/matches?date=all')
  if (matches.response.status !== 200 || matches.body.count < 1) {
    throw new Error(`get matches failed: ${JSON.stringify(matches.body)}`)
  }

  const allMatches = Array.isArray(matches.body.matches) ? matches.body.matches : []
  const soccerMatch = allMatches.find((item: { sport?: string; avg_odds?: { draw?: number } }) => item?.sport === 'soccer' && item?.avg_odds?.draw)
  const nbaMatch = allMatches.find((item: { sport?: string }) => item?.sport === 'basketball')
  if (!soccerMatch || !nbaMatch) {
    throw new Error(`expected soccer and nba matches: ${JSON.stringify(matches.body)}`)
  }

  const refresh = await callApi('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  })
  if (refresh.response.status !== 200 || refresh.body.user.email_verified !== true) {
    throw new Error(`refresh failed: ${JSON.stringify(refresh.body)}`)
  }

  const verifiedHeaders = {
    authorization: `Bearer ${refresh.body.id_token as string}`,
    'content-type': 'application/json'
  }

  const redeem = await callApi('/api/auth/redeem', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({ code: 'test888' })
  })
  if (redeem.response.status !== 200) {
    throw new Error(`redeem failed: ${JSON.stringify(redeem.body)}`)
  }

  const duplicateRedeem = await callApi('/api/auth/redeem', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({ code: 'test888' })
  })
  if (duplicateRedeem.response.status !== 400) {
    throw new Error(`duplicate redeem should be rejected: ${JSON.stringify(duplicateRedeem.body)}`)
  }

  const customDrawMatch = await callApi('/api/admin/matches', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      sport: 'soccer',
      league: 'Custom Cup',
      home_team: 'Red FC',
      away_team: 'Blue FC',
      start_time: '2099-05-18T12:00:00Z',
      allow_draw: true,
      odds: {
        home: 2.1,
        draw: 3.3,
        away: 2.9
      }
    })
  })
  if (
    customDrawMatch.response.status !== 201 ||
    customDrawMatch.body.match?.source_type !== 'custom' ||
    customDrawMatch.body.match?.allow_draw !== true
  ) {
    throw new Error(`create custom draw match failed: ${JSON.stringify(customDrawMatch.body)}`)
  }

  const customDrawMatchId = Number(customDrawMatch.body.match.id)
  const adminCustomMatches = await callApi('/api/admin/matches?page=1&page_size=10', {
    method: 'GET',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if (
    adminCustomMatches.response.status !== 200 ||
    !(adminCustomMatches.body.matches as Array<{ id: number }>).some((match) => match.id === customDrawMatchId)
  ) {
    throw new Error(`admin custom matches list failed: ${JSON.stringify(adminCustomMatches.body)}`)
  }

  const customDrawDetail = await callApi(`/api/admin/matches/${customDrawMatchId}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if (
    customDrawDetail.response.status !== 200 ||
    customDrawDetail.body.match?.odds_rows?.[0]?.draw_odds !== 3.3
  ) {
    throw new Error(`admin custom match detail failed: ${JSON.stringify(customDrawDetail.body)}`)
  }

  const leagues = await callApi('/api/matches/leagues')
  if (
    leagues.response.status !== 200 ||
    !(leagues.body.leagues as string[]).includes('Custom Cup')
  ) {
    throw new Error(`custom league should appear in leagues endpoint: ${JSON.stringify(leagues.body)}`)
  }

  const matchesWithCustom = await callApi('/api/matches?date=all')
  const customDrawPublicMatch = (matchesWithCustom.body.matches as Array<{
    id: number
    source_type?: string
    allow_draw?: boolean
  }>).find((item) => item.id === customDrawMatchId)
  if (
    matchesWithCustom.response.status !== 200 ||
    !customDrawPublicMatch ||
    customDrawPublicMatch.source_type !== 'custom' ||
    customDrawPublicMatch.allow_draw !== true
  ) {
    throw new Error(`custom match should appear in public matches: ${JSON.stringify(matchesWithCustom.body)}`)
  }

  const customPublicDetail = await callApi(`/api/matches/${customDrawMatchId}`)
  if (
    customPublicDetail.response.status !== 200 ||
    customPublicDetail.body.match?.source_type !== 'custom' ||
    customPublicDetail.body.match?.allow_draw !== true
  ) {
    throw new Error(`custom public detail failed: ${JSON.stringify(customPublicDetail.body)}`)
  }

  const customDrawBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: customDrawMatchId,
      selection: 'draw',
      odds: 9999,
      amount: 120,
      bet_type: 'h2h'
    })
  })
  if (
    customDrawBet.response.status !== 201 ||
    Number(customDrawBet.body.bet?.odds) >= 9999
  ) {
    throw new Error(`custom draw bet failed: ${JSON.stringify(customDrawBet.body)}`)
  }

  const customNoDrawMatch = await callApi('/api/admin/matches', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      sport: 'soccer',
      league: 'Knockout Stage',
      home_team: 'Alpha FC',
      away_team: 'Beta FC',
      start_time: '2099-05-18T13:00:00Z',
      allow_draw: false,
      odds: {
        home: 1.8,
        away: 4.2
      }
    })
  })
  if (
    customNoDrawMatch.response.status !== 201 ||
    customNoDrawMatch.body.match?.allow_draw !== false
  ) {
    throw new Error(`create no-draw custom match failed: ${JSON.stringify(customNoDrawMatch.body)}`)
  }

  const customNoDrawMatchId = Number(customNoDrawMatch.body.match.id)
  const editableCustomMatch = await callApi(`/api/admin/matches/${customNoDrawMatchId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      sport: 'soccer',
      league: 'Knockout Stage',
      home_team: 'Alpha FC',
      away_team: 'Beta United',
      start_time: '2099-05-18T13:30:00Z',
      allow_draw: false,
      odds: {
        home: 1.85,
        away: 4.4
      }
    })
  })
  if (
    editableCustomMatch.response.status !== 200 ||
    editableCustomMatch.body.match?.away_team !== 'Beta United'
  ) {
    throw new Error(`custom match should be editable before bets: ${JSON.stringify(editableCustomMatch.body)}`)
  }

  const rejectedDrawBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: customNoDrawMatchId,
      selection: 'draw',
      odds: 8888,
      amount: 50,
      bet_type: 'h2h'
    })
  })
  if (rejectedDrawBet.response.status !== 400) {
    throw new Error(`draw should be rejected for no-draw custom match: ${JSON.stringify(rejectedDrawBet.body)}`)
  }

  const customNoDrawBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: customNoDrawMatchId,
      selection: 'home',
      odds: 7777,
      amount: 80,
      bet_type: 'h2h'
    })
  })
  if (
    customNoDrawBet.response.status !== 201 ||
    Number(customNoDrawBet.body.bet?.odds) >= 7777
  ) {
    throw new Error(`place no-draw custom bet failed: ${JSON.stringify(customNoDrawBet.body)}`)
  }

  const lockedCustomMatch = await callApi(`/api/admin/matches/${customNoDrawMatchId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      sport: 'soccer',
      league: 'Knockout Stage',
      home_team: 'Alpha FC',
      away_team: 'Beta Locked',
      start_time: '2099-05-18T14:00:00Z',
      allow_draw: false,
      odds: {
        home: 1.9,
        away: 4.5
      }
    })
  })
  if (lockedCustomMatch.response.status !== 409) {
    throw new Error(`custom match should lock after bets: ${JSON.stringify(lockedCustomMatch.body)}`)
  }

  const rejectedDrawSettlement = await callApi(`/api/admin/matches/${customNoDrawMatchId}/settle`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      home_score: 1,
      away_score: 1
    })
  })
  if (rejectedDrawSettlement.response.status !== 400) {
    throw new Error(`draw settlement should fail for no-draw custom match: ${JSON.stringify(rejectedDrawSettlement.body)}`)
  }

  const settledCustomDraw = await callApi(`/api/admin/matches/${customDrawMatchId}/settle`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      home_score: 2,
      away_score: 2
    })
  })
  if (
    settledCustomDraw.response.status !== 200 ||
    settledCustomDraw.body.settlement?.won !== 1
  ) {
    throw new Error(`custom draw settlement failed: ${JSON.stringify(settledCustomDraw.body)}`)
  }

  const settledCustomNoDraw = await callApi(`/api/admin/matches/${customNoDrawMatchId}/settle`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      home_score: 2,
      away_score: 1
    })
  })
  if (
    settledCustomNoDraw.response.status !== 200 ||
    settledCustomNoDraw.body.settlement?.won !== 1
  ) {
    throw new Error(`custom no-draw settlement failed: ${JSON.stringify(settledCustomNoDraw.body)}`)
  }

  const customPendingMatch = await callApi('/api/admin/matches', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      sport: 'soccer',
      league: 'Manual Pending',
      home_team: 'Gamma FC',
      away_team: 'Delta FC',
      start_time: '2099-05-18T15:00:00Z',
      allow_draw: false,
      odds: {
        home: 1.75,
        away: 4.8
      }
    })
  })
  if (customPendingMatch.response.status !== 201) {
    throw new Error(`create pending custom match failed: ${JSON.stringify(customPendingMatch.body)}`)
  }

  const customPendingMatchId = Number(customPendingMatch.body.match.id)
  const pendingCustomBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: customPendingMatchId,
      selection: 'home',
      odds: 6666,
      amount: 60,
      bet_type: 'h2h'
    })
  })
  if (
    pendingCustomBet.response.status !== 201 ||
    Number(pendingCustomBet.body.bet?.odds) >= 6666
  ) {
    throw new Error(`place pending custom bet failed: ${JSON.stringify(pendingCustomBet.body)}`)
  }

  await env.DB.prepare(`UPDATE matches SET start_time = ? WHERE id = ?`)
    .bind('2099-05-17T08:30:00Z', customPendingMatchId)
    .run()

  const syncedSoccerBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: soccerMatch.id,
      selection: 'home',
      odds: 9999,
      amount: 200,
      bet_type: 'h2h'
    })
  })
  if (syncedSoccerBet.response.status !== 201) throw new Error(`place bet failed: ${JSON.stringify(syncedSoccerBet.body)}`)
  if (Number(syncedSoccerBet.body.bet?.odds) >= 9999) {
    throw new Error(`server trusted tampered odds: ${JSON.stringify(syncedSoccerBet.body)}`)
  }

  const syncedNbaBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: nbaMatch.id,
      selection: 'home',
      odds: 8888,
      amount: 300,
      bet_type: 'h2h'
    })
  })
  if (syncedNbaBet.response.status !== 201) throw new Error(`place nba bet failed: ${JSON.stringify(syncedNbaBet.body)}`)
  if (Number(syncedNbaBet.body.bet?.odds) >= 8888) {
    throw new Error(`server trusted nba tampered odds: ${JSON.stringify(syncedNbaBet.body)}`)
  }

  await runScheduled()

  const settledBets = await callApi('/api/bets', {
    method: 'GET',
    headers: { authorization: `Bearer ${refresh.body.id_token as string}` }
  })
  if (settledBets.response.status !== 200) {
    throw new Error(`get settled bets failed: ${JSON.stringify(settledBets.body)}`)
  }
  const betStatusById = new Map(
    (settledBets.body.bets as Array<{ id: number; status: string }>).map((bet) => [bet.id, bet.status])
  )
  if (
    betStatusById.get(customDrawBet.body.bet.id) !== 'won' ||
    betStatusById.get(customNoDrawBet.body.bet.id) !== 'won' ||
    betStatusById.get(syncedSoccerBet.body.bet.id) !== 'won' ||
    betStatusById.get(syncedNbaBet.body.bet.id) !== 'won' ||
    betStatusById.get(pendingCustomBet.body.bet.id) !== 'pending'
  ) {
    throw new Error(`unexpected bet statuses after custom and scheduled settlement: ${JSON.stringify(settledBets.body)}`)
  }

  const refreshedProfile = await callApi('/api/auth/profile', {
    method: 'GET',
    headers: { authorization: `Bearer ${refresh.body.id_token as string}` }
  })
  if (refreshedProfile.response.status !== 200) {
    throw new Error(`profile after settlement failed: ${JSON.stringify(refreshedProfile.body)}`)
  }
  if (Number(refreshedProfile.body.user.balance) <= 0) {
    throw new Error(`balance not updated after settlement: ${JSON.stringify(refreshedProfile.body)}`)
  }

  const populatedLeaderboard = await callApi('/api/stats/leaderboard')
  if (
    populatedLeaderboard.response.status !== 200 ||
    populatedLeaderboard.body.total !== 1 ||
    populatedLeaderboard.body.leaderboard?.[0]?.username !== 'worker-user'
  ) {
    throw new Error(`leaderboard should only include bettors: ${JSON.stringify(populatedLeaderboard.body)}`)
  }

  const adminSystem = await callApi('/api/admin/system', {
    method: 'GET',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if (adminSystem.response.status !== 200) {
    throw new Error(`admin system failed: ${JSON.stringify(adminSystem.body)}`)
  }
  if ((adminSystem.body.settlement?.lastSettlementCounts?.won ?? 0) < 2) {
    throw new Error(`expected settlement stats in admin system: ${JSON.stringify(adminSystem.body)}`)
  }
  if ((adminSystem.body.oddsApi?.used ?? 0) < 3) {
    throw new Error(`expected Odds API usage to be recorded: ${JSON.stringify(adminSystem.body)}`)
  }

  await env.DB.prepare(
    `INSERT INTO matches (external_id, sport, league, home_team, away_team, start_time, status, created_at)
     VALUES (?, 'soccer', ?, ?, ?, ?, 'upcoming', ?)`
  ).bind(
    'fd_202',
    '英超',
    '利物浦',
    '曼城',
    '2099-05-17T11:00:00Z',
    new Date().toISOString()
  ).run()
  const fallbackMatch = await env.DB.prepare(
    `SELECT id FROM matches WHERE external_id = ?`
  ).bind('fd_202').first<{ id: number }>()
  if (!fallbackMatch?.id) {
    throw new Error('fallback match insert failed')
  }
  await env.DB.prepare(
    `INSERT INTO odds (match_id, bookmaker, market, home_odds, draw_odds, away_odds, updated_at)
     VALUES (?, 'Bet365', 'h2h', 1.7, 3.4, 4.2, ?)`
  ).bind(fallbackMatch.id, new Date().toISOString()).run()

  const fallbackBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: fallbackMatch.id,
      selection: 'home',
      odds: 7777,
      amount: 100,
      bet_type: 'h2h'
    })
  })
  if (fallbackBet.response.status !== 201) {
    throw new Error(`fallback bet failed: ${JSON.stringify(fallbackBet.body)}`)
  }

  await env.DB.prepare(
    `INSERT INTO matches (external_id, sport, league, home_team, away_team, start_time, status, created_at)
     VALUES (?, 'soccer', ?, ?, ?, ?, 'upcoming', ?)`
  ).bind(
    'odds_limit_1',
    '英超',
    '阿森纳',
    '切尔西',
    '2099-05-17T12:30:00Z',
    new Date().toISOString()
  ).run()
  const limitMatch = await env.DB.prepare(
    `SELECT id FROM matches WHERE external_id = ?`
  ).bind('odds_limit_1').first<{ id: number }>()
  if (!limitMatch?.id) {
    throw new Error('daily limit match insert failed')
  }
  await env.DB.prepare(
    `INSERT INTO odds (match_id, bookmaker, market, home_odds, draw_odds, away_odds, updated_at)
     VALUES (?, 'Bet365', 'h2h', 1.8, 3.2, 4.5, ?)`
  ).bind(limitMatch.id, new Date().toISOString()).run()

  const limitBet = await callApi('/api/bets', {
    method: 'POST',
    headers: verifiedHeaders,
    body: JSON.stringify({
      match_id: limitMatch.id,
      selection: 'home',
      odds: 6666,
      amount: 50,
      bet_type: 'h2h'
    })
  })
  if (limitBet.response.status !== 201) {
    throw new Error(`daily limit bet failed: ${JSON.stringify(limitBet.body)}`)
  }

  const settingNow = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('settlement_odds_api_daily_date', '2099-05-17', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(settingNow).run()
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('settlement_odds_api_daily_used', '16', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(settingNow).run()

  const scoreRequestsBeforeFallback = oddsScoreRequestCount
  const footballDataRequestsBeforeFallback = footballDataMatchRequestCount
  await runScheduled()
  if (oddsScoreRequestCount !== scoreRequestsBeforeFallback) {
    throw new Error('Odds API scores should not be called after daily result limit')
  }
  if (footballDataMatchRequestCount <= footballDataRequestsBeforeFallback) {
    const debugSystem = await callApi('/api/admin/system', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
    })
    throw new Error(`football-data fallback was not called: ${JSON.stringify(debugSystem.body)}`)
  }

  const fallbackSettled = await callApi('/api/bets', {
    method: 'GET',
    headers: { authorization: `Bearer ${refresh.body.id_token as string}` }
  })
  const settledFallbackBet = (fallbackSettled.body.bets as Array<{ id: number; status: string }>).find(
    (bet) => bet.id === fallbackBet.body.bet.id
  )
  if (settledFallbackBet?.status !== 'won') {
    throw new Error(`expected fallback bet to settle as won: ${JSON.stringify(fallbackSettled.body)}`)
  }

  const fallbackAdminSystem = await callApi('/api/admin/system', {
    method: 'GET',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if ((fallbackAdminSystem.body.oddsApi?.used ?? 0) !== 3) {
    throw new Error(`expected capped Odds API usage to remain unchanged: ${JSON.stringify(fallbackAdminSystem.body)}`)
  }
  if (fallbackAdminSystem.body.settlement?.lastResultProvider !== 'football-data') {
    throw new Error(`expected football-data provider: ${JSON.stringify(fallbackAdminSystem.body)}`)
  }
  if (fallbackAdminSystem.body.settlement?.lastSkipReason !== 'daily_limit_reached') {
    throw new Error(`expected daily limit skip reason: ${JSON.stringify(fallbackAdminSystem.body)}`)
  }

  await env.DB.prepare(`DELETE FROM bets WHERE id = ?`).bind(limitBet.body.bet.id).run()
  await runScheduled()
  const noPendingAdminSystem = await callApi('/api/admin/system', {
    method: 'GET',
    headers: { authorization: `Bearer ${adminLogin.body.id_token as string}` }
  })
  if (noPendingAdminSystem.body.settlement?.lastSkipReason !== 'no_pending_bets') {
    throw new Error(`expected no pending skip reason: ${JSON.stringify(noPendingAdminSystem.body)}`)
  }

  const finalBetCount = await env.DB.prepare(`SELECT COUNT(*) AS count FROM bets`).first<{ count: number }>()
  const finalMatchCount = await env.DB.prepare(`SELECT COUNT(*) AS count FROM matches`).first<{ count: number }>()

  console.log(
    JSON.stringify(
      {
        smoke: 'passed',
        users: 2,
        bets: Number(finalBetCount?.count || 0),
        matches: Number(finalMatchCount?.count || 0),
        synced_schedule: syncSchedule.body.synced,
        synced_odds: syncOdds.body.synced
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
