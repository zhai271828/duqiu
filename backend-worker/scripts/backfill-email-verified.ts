import { exec, execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { importPKCS8, SignJWT } from 'jose'

type CandidateUser = {
  id: number
  email: string
  firebase_uid: string
}

type FirebaseLookupUser = {
  localId?: string
  email?: string
  emailVerified?: boolean
}

type DecisionReason = 'not_found' | 'uid_mismatch' | 'not_verified'

type CandidateDecision = {
  candidate: CandidateUser
  action: 'update' | 'skip'
  reason?: DecisionReason
  firebaseUser?: FirebaseLookupUser
}

type ServiceAccountJson = {
  client_email?: string
  private_key?: string
  project_id?: string
  token_uri?: string
}

type JsonHttpResponse<T> = {
  ok: boolean
  status: number
  payload: T | null
}

type CliOptions = {
  serviceAccountPath: string
  apply: boolean
  limit?: number
}

type D1JsonResult<T> = {
  results?: T[]
  success: boolean
  meta?: {
    changes?: number
  }
}

const D1_DATABASE_NAME = 'betting-simulator-db'
const LOOKUP_BATCH_SIZE = 100
const UPDATE_BATCH_SIZE = 100
const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit'
const DEFAULT_GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return parsed
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  node --experimental-strip-types scripts/backfill-email-verified.ts --service-account <path-to-json> [--limit <n>] [--apply]',
      '',
      'Examples:',
      '  node --experimental-strip-types scripts/backfill-email-verified.ts --service-account C:\\path\\service-account.json',
      '  node --experimental-strip-types scripts/backfill-email-verified.ts --service-account C:\\path\\service-account.json --limit 1 --apply'
    ].join('\n')
  )
}

function parseArgs(argv: string[]): CliOptions {
  let serviceAccountPath = ''
  let apply = false
  let limit: number | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--apply') {
      apply = true
      continue
    }

    if (arg === '--service-account') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --service-account')
      }
      serviceAccountPath = value
      index += 1
      continue
    }

    if (arg === '--limit') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --limit')
      }
      limit = parsePositiveInteger(value, '--limit')
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!serviceAccountPath) {
    throw new Error('Missing required --service-account argument')
  }

  return {
    serviceAccountPath,
    apply,
    limit
  }
}

function resolveServiceAccountPath(inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath)
}

function loadServiceAccount(serviceAccountPath: string): ServiceAccountJson {
  const resolvedPath = resolveServiceAccountPath(serviceAccountPath)
  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as ServiceAccountJson

  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error('Service account JSON must include client_email, private_key, and project_id')
  }

  return parsed
}

async function getGoogleAccessToken(serviceAccount: ServiceAccountJson): Promise<string> {
  const tokenUri = serviceAccount.token_uri || DEFAULT_GOOGLE_TOKEN_URI
  const privateKey = await importPKCS8(serviceAccount.private_key as string, 'RS256')
  const now = Math.floor(Date.now() / 1000)

  const assertion = await new SignJWT({ scope: GOOGLE_OAUTH_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email as string)
    .setSubject(serviceAccount.client_email as string)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const response = await requestJson<{ access_token?: string; error?: string; error_description?: string }>(
    tokenUri,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    }
  )

  if (!response.ok || !response.payload?.access_token) {
    const payload = response.payload
    const reason = payload?.error_description || payload?.error || `HTTP_${response.status}`
    throw new Error(`Failed to obtain Google access token: ${reason}`)
  }

  return response.payload.access_token
}

function chunk<T>(items: T[], size: number): T[][]
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function getWranglerCommand(): string {
  return process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
}

async function executeD1Json<T>(command: string): Promise<D1JsonResult<T>> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'backfill-d1-query-'))
  const sqlFilePath = resolve(tempDir, 'query.txt')
  const psFilePath = resolve(tempDir, 'execute-d1.ps1')
  writeFileSync(sqlFilePath, command, 'utf8')

  let stdout = ''
  let stderr = ''

  try {
    if (process.platform === 'win32') {
      const psScript = [
        `$sql = Get-Content -Raw -LiteralPath '${sqlFilePath.replace(/'/g, "''")}'`,
        `wrangler d1 execute ${D1_DATABASE_NAME} --remote --command $sql --json`
      ].join('\r\n')
      writeFileSync(psFilePath, psScript, 'utf8')

      const result = await execAsync(
        `powershell.exe -NoProfile -File "${psFilePath}"`,
        {
          cwd: workerDir,
          maxBuffer: 10 * 1024 * 1024
        }
      )
      stdout = result.stdout
      stderr = result.stderr
    } else {
      const result = await execFileAsync(
        getWranglerCommand(),
        [
          'd1',
          'execute',
          D1_DATABASE_NAME,
          '--remote',
          '--file',
          sqlFilePath,
          '--json'
        ],
        {
          cwd: workerDir,
          maxBuffer: 10 * 1024 * 1024
        }
      )
      stdout = result.stdout
      stderr = result.stderr
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  if (stderr?.trim()) {
    console.warn(stderr.trim())
  }

  const jsonStart = stdout.indexOf('[')
  const jsonEnd = stdout.lastIndexOf(']')
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error('Could not locate JSON payload in wrangler d1 output')
  }

  const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as D1JsonResult<T>[]
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Unexpected empty JSON result from wrangler d1 execute')
  }

  if (!parsed[0].success) {
    throw new Error('wrangler d1 execute reported an unsuccessful result')
  }

  return parsed[0]
}

async function fetchCandidateTotal(): Promise<number> {
  const result = await executeD1Json<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE email_verified = 0
       AND firebase_uid IS NOT NULL
       AND is_admin = 0`
  )

  return Number(result.results?.[0]?.count || 0)
}

async function fetchCandidates(limit?: number): Promise<CandidateUser[]> {
  const limitSql = limit ? ` LIMIT ${limit}` : ''
  const result = await executeD1Json<CandidateUser>(
    `SELECT id, email, firebase_uid
     FROM users
     WHERE email_verified = 0
       AND firebase_uid IS NOT NULL
       AND is_admin = 0
     ORDER BY id${limitSql}`
  )

  return (result.results || []).map((user) => ({
    id: Number(user.id),
    email: String(user.email),
    firebase_uid: String(user.firebase_uid)
  }))
}

async function fetchVerificationBreakdown(): Promise<Array<{ email_verified: number; count: number }>> {
  const result = await executeD1Json<{ email_verified: number; count: number }>(
    `SELECT email_verified, COUNT(*) AS count
     FROM users
     GROUP BY email_verified
     ORDER BY email_verified`
  )

  return (result.results || []).map((row) => ({
    email_verified: Number(row.email_verified),
    count: Number(row.count)
  }))
}

async function lookupFirebaseUsers(
  projectId: string,
  accessToken: string,
  emails: string[]
): Promise<FirebaseLookupUser[]> {
  const response = await requestJson<{ users?: FirebaseLookupUser[]; error?: { message?: string } }>(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: emails
      })
    }
  )

  if (!response.ok) {
    const reason = response.payload?.error?.message || `HTTP_${response.status}`
    throw new Error(`Firebase lookup failed: ${reason}`)
  }

  return response.payload?.users || []
}

async function requestJson<T>(
  url: string,
  options: {
    method: 'POST'
    headers: Record<string, string>
    body: string
  }
): Promise<JsonHttpResponse<T>> {
  if (process.platform === 'win32') {
    return requestJsonViaPowerShell<T>(url, options)
  }

  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body
  })

  return {
    ok: response.ok,
    status: response.status,
    payload: (await response.json().catch(() => null)) as T | null
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

async function requestJsonViaPowerShell<T>(
  url: string,
  options: {
    method: 'POST'
    headers: Record<string, string>
    body: string
  }
): Promise<JsonHttpResponse<T>> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'backfill-email-verified-'))
  const bodyFilePath = resolve(tempDir, 'request-body.txt')
  const responseFilePath = resolve(tempDir, 'response-body.txt')
  const scriptFilePath = resolve(tempDir, 'request.ps1')
  writeFileSync(bodyFilePath, options.body, 'utf8')

  const headerLines = Object.entries(options.headers).map(
    ([key, value]) => `$headers['${escapePowerShellSingleQuoted(key)}'] = '${escapePowerShellSingleQuoted(value)}'`
  )

  const scriptContent = [
    "$headers = @{}",
    ...headerLines,
    `$body = Get-Content -Raw -LiteralPath '${escapePowerShellSingleQuoted(bodyFilePath)}'`,
    'try {',
    `  $response = Invoke-WebRequest -Uri '${escapePowerShellSingleQuoted(url)}' -Method ${options.method} -Headers $headers -Body $body -UseBasicParsing`,
    `  [System.IO.File]::WriteAllText('${escapePowerShellSingleQuoted(responseFilePath)}', $response.Content)`,
    '  Write-Output $response.StatusCode',
    '} catch {',
    '  if ($_.Exception.Response) {',
    '    $status = [int]$_.Exception.Response.StatusCode',
    '    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())',
    '    $content = $reader.ReadToEnd()',
    `    [System.IO.File]::WriteAllText('${escapePowerShellSingleQuoted(responseFilePath)}', $content)`,
    '    Write-Output $status',
    '    exit 0',
    '  }',
    '  throw',
    '}'
  ].join('\r\n')
  writeFileSync(scriptFilePath, scriptContent, 'utf8')

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-File', scriptFilePath],
      {
        cwd: workerDir,
        maxBuffer: 10 * 1024 * 1024
      }
    )

    if (stderr?.trim()) {
      console.warn(stderr.trim())
    }

    const status = Number(stdout.trim())
    if (!Number.isInteger(status) || status <= 0) {
      throw new Error('Failed to parse HTTP status from PowerShell output')
    }

    const bodyText = readFileSync(responseFilePath, 'utf8').trim()

    return {
      ok: status >= 200 && status < 300,
      status,
      payload: bodyText ? (JSON.parse(bodyText) as T) : null
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function indexFirebaseUsers(users: FirebaseLookupUser[]): Map<string, FirebaseLookupUser> {
  const indexed = new Map<string, FirebaseLookupUser>()

  for (const user of users) {
    if (!user.email) continue
    indexed.set(normalizeEmail(user.email), user)
  }

  return indexed
}

export function classifyCandidate(
  candidate: CandidateUser,
  firebaseUser?: FirebaseLookupUser
): CandidateDecision {
  if (!firebaseUser?.email || !firebaseUser.localId) {
    return {
      candidate,
      action: 'skip',
      reason: 'not_found'
    }
  }

  if (firebaseUser.localId !== candidate.firebase_uid) {
    return {
      candidate,
      action: 'skip',
      reason: 'uid_mismatch',
      firebaseUser
    }
  }

  if (firebaseUser.emailVerified !== true) {
    return {
      candidate,
      action: 'skip',
      reason: 'not_verified',
      firebaseUser
    }
  }

  return {
    candidate,
    action: 'update',
    firebaseUser
  }
}

async function buildDecisions(
  candidates: CandidateUser[],
  projectId: string,
  accessToken: string
): Promise<CandidateDecision[]> {
  const decisions: CandidateDecision[] = []

  for (const candidateBatch of chunk(candidates, LOOKUP_BATCH_SIZE)) {
    const firebaseUsers = await lookupFirebaseUsers(
      projectId,
      accessToken,
      candidateBatch.map((candidate) => normalizeEmail(candidate.email))
    )
    const indexedUsers = indexFirebaseUsers(firebaseUsers)

    for (const candidate of candidateBatch) {
      decisions.push(classifyCandidate(candidate, indexedUsers.get(normalizeEmail(candidate.email))))
    }
  }

  return decisions
}

function summarizeDecisions(decisions: CandidateDecision[]) {
  const summary = {
    update: 0,
    not_found: 0,
    uid_mismatch: 0,
    not_verified: 0
  }

  for (const decision of decisions) {
    if (decision.action === 'update') {
      summary.update += 1
      continue
    }

    if (decision.reason) {
      summary[decision.reason] += 1
    }
  }

  return summary
}

async function applyUpdates(userIds: number[]): Promise<number> {
  let updated = 0
  const updatedAt = new Date().toISOString()

  for (const userIdBatch of chunk(userIds, UPDATE_BATCH_SIZE)) {
    const result = await executeD1Json<never>(
      `UPDATE users
       SET email_verified = 1,
           updated_at = '${updatedAt}'
       WHERE id IN (${userIdBatch.join(', ')})
         AND email_verified = 0`
    )
    updated += Number(result.meta?.changes || 0)
  }

  return updated
}

function printBreakdown(label: string, rows: Array<{ email_verified: number; count: number }>): void {
  console.log(`\n${label}`)
  console.table(
    rows.map((row) => ({
      email_verified: row.email_verified,
      count: row.count
    }))
  )
}

function printDecisionReport(decisions: CandidateDecision[]): void {
  console.log('\nCandidate decisions')
  console.table(
    decisions.map((decision) => ({
      id: decision.candidate.id,
      email: decision.candidate.email,
      firebase_uid: decision.candidate.firebase_uid,
      action: decision.action,
      reason: decision.reason || '',
      firebase_local_id: decision.firebaseUser?.localId || '',
      firebase_verified:
        decision.firebaseUser?.emailVerified === undefined
          ? ''
          : String(decision.firebaseUser.emailVerified)
    }))
  )
}

async function runCli(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(options.serviceAccountPath)
  const accessToken = await getGoogleAccessToken(serviceAccount)
  const totalCandidates = await fetchCandidateTotal()
  const candidates = await fetchCandidates(options.limit)
  const beforeBreakdown = await fetchVerificationBreakdown()
  const decisions = await buildDecisions(candidates, serviceAccount.project_id as string, accessToken)
  const summary = summarizeDecisions(decisions)
  const updatableUserIds = decisions
    .filter((decision) => decision.action === 'update')
    .map((decision) => decision.candidate.id)

  console.log(`Mode: ${options.apply ? 'apply' : 'dry-run'}`)
  console.log(`Project: ${serviceAccount.project_id}`)
  console.log(`Candidates loaded: ${candidates.length} / ${totalCandidates}`)
  console.log(`Would update: ${summary.update}`)
  console.log(`Skip not found: ${summary.not_found}`)
  console.log(`Skip UID mismatch: ${summary.uid_mismatch}`)
  console.log(`Skip not verified: ${summary.not_verified}`)

  printBreakdown('Before update', beforeBreakdown)
  printDecisionReport(decisions)

  if (!options.apply) {
    console.log('\nDry-run only. Re-run with --apply to update remote D1.')
    return
  }

  if (updatableUserIds.length === 0) {
    console.log('\nNo users qualified for update.')
    return
  }

  const updated = await applyUpdates(updatableUserIds)
  const afterBreakdown = await fetchVerificationBreakdown()

  console.log(`\nApplied updates: ${updated}`)
  printBreakdown('After update', afterBreakdown)
}

const currentFilePath = fileURLToPath(import.meta.url)
const invokedFilePath = process.argv[1] ? resolve(process.argv[1]) : ''

if (invokedFilePath === currentFilePath) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    printUsage()
    process.exitCode = 1
  })
}
