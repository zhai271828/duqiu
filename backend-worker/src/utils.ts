const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()'
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    headers.set(key, value)
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  })
}

export function empty(init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(JSON_HEADERS)) {
    headers.set(key, value)
  }

  return new Response(null, {
    ...init,
    headers
  })
}

export function messageResponse(message: string, status = 200): Response {
  return json({ message }, { status })
}

export function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, { status })
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeUtcIso(value: string | null | undefined): string | null {
  if (!value) return null

  if (value.endsWith('Z')) {
    return value.replace('Z', '+00:00')
  }

  if (value.includes('T') && (value.endsWith('+00:00') || /[+-]\d{2}:\d{2}$/.test(value))) {
    return value
  }

  if (value.includes(' ')) {
    return value.replace(' ', 'T') + '+00:00'
  }

  return value + '+00:00'
}

export function boolFromQuery(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback
  return value.toLowerCase() === 'true'
}

export function shanghaiDateRange(
  kind: 'today' | 'tomorrow'
): { startUtcIso: string; endUtcIso: string } {
  const beijingOffsetMs = 8 * 60 * 60 * 1000
  const now = new Date()
  const beijingNow = new Date(now.getTime() + beijingOffsetMs)
  const beijingStart = new Date(
    Date.UTC(
      beijingNow.getUTCFullYear(),
      beijingNow.getUTCMonth(),
      beijingNow.getUTCDate(),
      0,
      0,
      0,
      0
    ) - beijingOffsetMs
  )

  const start = kind === 'today' ? beijingStart : new Date(beijingStart.getTime() + 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  return {
    startUtcIso: start.toISOString(),
    endUtcIso: end.toISOString()
  }
}

export function buildSideLabels(hasHomeAway: boolean) {
  return {
    home: hasHomeAway ? '主队' : '队伍A',
    away: hasHomeAway ? '客队' : '队伍B'
  }
}

export function buildSelectionTexts(
  homeTeam: string,
  awayTeam: string,
  hasHomeAway: boolean
) {
  if (hasHomeAway) {
    return {
      home: '主胜',
      draw: '平局',
      away: '客胜'
    }
  }

  return {
    home: `${homeTeam} 胜`,
    draw: '平局',
    away: `${awayTeam} 胜`
  }
}

export function buildMatchResponse(
  row: {
    id: number
    external_id: string | null
    sport: string
    league: string
    home_team: string
    away_team: string
    start_time: string
    status: string
    source_type: string
    allow_draw: number | boolean
    has_home_away: number | boolean
    home_score: number | null
    away_score: number | null
    odds_count?: number
    avg_home_odds?: number | null
    avg_draw_odds?: number | null
    avg_away_odds?: number | null
  },
  odds: unknown[] = []
) {
  const avg_odds: Record<string, number> = {}

  if (row.avg_home_odds !== null && row.avg_home_odds !== undefined) {
    avg_odds.home = round2(row.avg_home_odds)
  }
  if (row.avg_draw_odds !== null && row.avg_draw_odds !== undefined) {
    avg_odds.draw = round2(row.avg_draw_odds)
  }
  if (row.avg_away_odds !== null && row.avg_away_odds !== undefined) {
    avg_odds.away = round2(row.avg_away_odds)
  }

  const homeTeam = translateTeam(row.home_team)
  const awayTeam = translateTeam(row.away_team)
  const hasHomeAway = row.has_home_away === true || row.has_home_away === 1

  return {
    id: row.id,
    external_id: row.external_id,
    sport: row.sport,
    league: translateLeague(row.league),
    home_team: homeTeam,
    away_team: awayTeam,
    start_time: normalizeUtcIso(row.start_time),
    status: row.status,
    source_type: row.source_type,
    allow_draw: row.allow_draw === true || row.allow_draw === 1,
    has_home_away: hasHomeAway,
    side_labels: buildSideLabels(hasHomeAway),
    selection_texts: buildSelectionTexts(homeTeam, awayTeam, hasHomeAway),
    home_score: row.home_score,
    away_score: row.away_score,
    odds,
    avg_odds: Object.keys(avg_odds).length > 0 ? avg_odds : null,
    odds_count: row.odds_count ?? odds.length
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
import { translateLeague, translateTeam } from './translations.ts'
