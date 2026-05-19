import type { Env, OddsApiEvent, ResultSyncCandidate, ScheduleEvent, ScoreApiEvent } from './types.ts'
import { translateLeague, translateTeam } from './translations.ts'

export const POPULAR_ODDS_SPORTS = [
  { key: 'soccer_uefa_champs_league', sport: 'soccer', displayLeague: '欧冠' },
  { key: 'soccer_epl', sport: 'soccer', displayLeague: '英超' },
  { key: 'soccer_china_superleague', sport: 'soccer', displayLeague: '中超' },
  { key: 'soccer_spain_la_liga', sport: 'soccer', displayLeague: '西甲' },
  { key: 'soccer_germany_bundesliga', sport: 'soccer', displayLeague: '德甲' },
  { key: 'soccer_italy_serie_a', sport: 'soccer', displayLeague: '意甲' },
  { key: 'soccer_france_ligue_one', sport: 'soccer', displayLeague: '法甲' },
  { key: 'basketball_nba', sport: 'basketball', displayLeague: 'NBA' }
] as const

export const POPULAR_DISPLAY_LEAGUES = POPULAR_ODDS_SPORTS.map((item) => item.displayLeague)

const POPULAR_COMPETITIONS: Record<string, string> = {
  PL: '英超',
  PD: '西甲',
  BL1: '德甲',
  SA: '意甲',
  FL1: '法甲',
  CL: '欧冠'
}

function footballHeaders(env: Env): HeadersInit {
  const headers: HeadersInit = {
    'user-agent': 'BettingSimulatorWorker/1.0'
  }

  if (env.FOOTBALL_DATA_API_KEY) {
    headers['x-auth-token'] = env.FOOTBALL_DATA_API_KEY
  }

  return headers
}

type FootballDataMatchPayload = {
  id: number
  utcDate: string
  status: string
  homeTeam?: { name?: string }
  awayTeam?: { name?: string }
  competition?: { name?: string }
  score?: {
    fullTime?: {
      home?: number | null
      away?: number | null
    }
  }
}

type OpenLigaMatchPayload = {
  matchID?: number
  matchDateTime?: string
  matchIsFinished?: boolean
  team1?: { teamName?: string }
  team2?: { teamName?: string }
  matchResults?: Array<{
    pointsTeam1?: number | null
    pointsTeam2?: number | null
    resultName?: string
  }>
}

type SportsDbEventPayload = {
  idEvent?: string
  strTimestamp?: string | null
  dateEvent?: string | null
  strTime?: string | null
  strHomeTeam?: string | null
  strAwayTeam?: string | null
  strEvent?: string | null
  strLeague?: string | null
  strStatus?: string | null
  intHomeScore?: string | number | null
  intAwayScore?: string | number | null
}

function parseNullableScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function scoreItems(homeTeam: string, awayTeam: string, homeScore: number | null, awayScore: number | null) {
  return [
    { name: homeTeam, score: homeScore },
    { name: awayTeam, score: awayScore }
  ]
}

function normalizeMatchName(value: string | null | undefined): string {
  return translateTeam(value || '')
    .toLowerCase()
    .replace(/fc\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function teamsMatch(
  candidate: ResultSyncCandidate,
  homeTeam: string | null | undefined,
  awayTeam: string | null | undefined
): boolean {
  const candidateHome = normalizeMatchName(candidate.home_team)
  const candidateAway = normalizeMatchName(candidate.away_team)
  const eventHome = normalizeMatchName(homeTeam)
  const eventAway = normalizeMatchName(awayTeam)

  return Boolean(candidateHome && candidateAway && candidateHome === eventHome && candidateAway === eventAway)
}

function withinHours(leftIso: string, rightIso: string, maxHours: number): boolean {
  const left = new Date(leftIso).getTime()
  const right = new Date(rightIso).getTime()
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  return Math.abs(left - right) <= maxHours * 60 * 60 * 1000
}

function dateKeyFromIso(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function dateKeyWithOffset(value: string, offsetDays: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function matchStartIso(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString()
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function findCandidateForTeamsAndTime(
  candidates: ResultSyncCandidate[],
  homeTeam: string | null | undefined,
  awayTeam: string | null | undefined,
  startTimeIso: string,
  maxHours = 36
): ResultSyncCandidate | null {
  return (
    candidates.find(
      (candidate) =>
        teamsMatch(candidate, homeTeam, awayTeam) && withinHours(candidate.start_time, startTimeIso, maxHours)
    ) || null
  )
}

function footballDataToScoreEvent(
  match: FootballDataMatchPayload,
  candidate?: ResultSyncCandidate
): ScoreApiEvent | null {
  if (!match.utcDate) return null

  const homeTeam = translateTeam(match.homeTeam?.name || 'Unknown')
  const awayTeam = translateTeam(match.awayTeam?.name || 'Unknown')
  const homeScore = match.score?.fullTime?.home ?? null
  const awayScore = match.score?.fullTime?.away ?? null
  const status = convertFootballStatus(match.status || '')

  return {
    id: candidate?.external_id || `fd_${match.id}`,
    match_id: candidate?.match_id,
    sport_key: 'football-data',
    sport_title: translateLeague(match.competition?.name || ''),
    commence_time: new Date(match.utcDate).toISOString(),
    completed: status === 'finished',
    home_team: candidate?.home_team || homeTeam,
    away_team: candidate?.away_team || awayTeam,
    status,
    scores: scoreItems(candidate?.home_team || homeTeam, candidate?.away_team || awayTeam, homeScore, awayScore)
  }
}

function sportsDbTeams(event: SportsDbEventPayload): { homeTeam: string; awayTeam: string } {
  if (event.strHomeTeam && event.strAwayTeam) {
    return {
      homeTeam: event.strHomeTeam,
      awayTeam: event.strAwayTeam
    }
  }

  const parts = (event.strEvent || '').split(/\s+vs\s+|_vs_/i)
  return {
    homeTeam: parts[0] || '',
    awayTeam: parts[1] || ''
  }
}

function sportsDbStartIso(event: SportsDbEventPayload): string {
  if (event.strTimestamp) {
    return matchStartIso(event.strTimestamp)
  }

  if (event.dateEvent) {
    const time = event.strTime || '00:00:00'
    return matchStartIso(`${event.dateEvent}T${time.replace(/Z$/i, '')}Z`)
  }

  return new Date(0).toISOString()
}

export async function fetchOddsSnapshot(
  env: Env
): Promise<{ data?: OddsApiEvent[]; remaining?: string; error?: string }> {
  if (!env.ODDS_API_KEY) {
    return { error: '未配置 ODDS_API_KEY，请在 Cloudflare secrets 中设置后再同步赔率。' }
  }

  const baseUrl = env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4'
  const aggregated: OddsApiEvent[] = []
  let remaining = 'unknown'

  for (const sportConfig of POPULAR_ODDS_SPORTS) {
    const url = new URL(`${baseUrl}/sports/${sportConfig.key}/odds`)
    url.searchParams.set('apiKey', env.ODDS_API_KEY)
    url.searchParams.set('regions', 'eu')
    url.searchParams.set('markets', 'h2h')
    url.searchParams.set('oddsFormat', 'decimal')

    const response = await fetch(url.toString())
    if (!response.ok) {
      return { error: `The Odds API 请求失败：HTTP ${response.status}` }
    }

    remaining = response.headers.get('x-requests-remaining') ?? remaining
    const events = (await response.json()) as OddsApiEvent[]
    for (const event of events) {
      aggregated.push({
        ...event,
        sport_key: sportConfig.key,
        sport_title: sportConfig.displayLeague
      })
    }
  }

  return {
    data: aggregated,
    remaining
  }
}

export async function fetchScoresSnapshot(
  env: Env,
  eventIdsBySport: Record<string, string[]>
): Promise<{ data?: ScoreApiEvent[]; remaining?: string; requests: number; error?: string }> {
  const hasEventIds = Object.values(eventIdsBySport).some((eventIds) => eventIds.length > 0)
  if (!hasEventIds) {
    return { data: [], remaining: 'unknown', requests: 0 }
  }

  if (!env.ODDS_API_KEY) {
    return { requests: 0, error: '未配置 ODDS_API_KEY，请在 Cloudflare secrets 中设置后再同步赛果。' }
  }

  const baseUrl = env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4'
  const aggregated: ScoreApiEvent[] = []
  let remaining = 'unknown'
  let requests = 0

  for (const sportConfig of POPULAR_ODDS_SPORTS) {
    const eventIds = eventIdsBySport[sportConfig.key] || []
    if (eventIds.length === 0) {
      continue
    }

    const url = new URL(`${baseUrl}/sports/${sportConfig.key}/scores`)
    url.searchParams.set('apiKey', env.ODDS_API_KEY)
    url.searchParams.set('daysFrom', '1')
    url.searchParams.set('dateFormat', 'iso')
    url.searchParams.set('eventIds', eventIds.join(','))

    const response = await fetch(url.toString())
    requests += 1
    if (!response.ok) {
      return { requests, error: `The Odds API 赛果请求失败：HTTP ${response.status}` }
    }

    remaining = response.headers.get('x-requests-remaining') ?? remaining
    const events = (await response.json()) as ScoreApiEvent[]
    for (const event of events) {
      aggregated.push({
        ...event,
        sport_key: sportConfig.key,
        sport_title: sportConfig.displayLeague
      })
    }
  }

  return {
    data: aggregated,
    remaining,
    requests
  }
}

function convertFootballStatus(status: string): string {
  const statusMap: Record<string, string> = {
    SCHEDULED: 'upcoming',
    TIMED: 'upcoming',
    IN_PLAY: 'live',
    PAUSED: 'live',
    FINISHED: 'finished',
    POSTPONED: 'postponed',
    CANCELLED: 'cancelled',
    AWARDED: 'finished'
  }
  return statusMap[status] || 'upcoming'
}

export async function fetchScheduleSnapshot(
  env: Env,
  days = 7
): Promise<{ data?: ScheduleEvent[]; error?: string }> {
  if (!env.FOOTBALL_DATA_API_KEY) {
    return {
      error: '未配置 FOOTBALL_DATA_API_KEY，football-data.org 当前接口需要有效的 API Token。'
    }
  }

  const baseUrl = env.FOOTBALL_DATA_BASE_URL || 'https://api.football-data.org/v4'
  const startDate = new Date()
  const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000)

  const allMatches: ScheduleEvent[] = []
  const params = new URLSearchParams({
    dateFrom: startDate.toISOString().slice(0, 10),
    dateTo: endDate.toISOString().slice(0, 10),
    status: 'SCHEDULED,TIMED'
  })

  for (const [competitionCode, leagueCn] of Object.entries(POPULAR_COMPETITIONS)) {
    const response = await fetch(`${baseUrl}/competitions/${competitionCode}/matches?${params.toString()}`, {
      headers: footballHeaders(env)
    })

    if (response.status === 403) {
      return {
        error: 'football-data.org 返回 403，请检查 FOOTBALL_DATA_API_KEY 是否有效。'
      }
    }

    if (!response.ok) {
      continue
    }

    const payload = (await response.json()) as {
      matches?: Array<{
        id: number
        utcDate: string
        status: string
        homeTeam?: { name?: string }
        awayTeam?: { name?: string }
        competition?: { name?: string }
        score?: {
          fullTime?: {
            home?: number | null
            away?: number | null
          }
        }
      }>
    }

    for (const match of payload.matches ?? []) {
      if (!match.utcDate) continue

      allMatches.push({
        external_id: `fd_${match.id}`,
        home_team: translateTeam(match.homeTeam?.name || 'Unknown'),
        away_team: translateTeam(match.awayTeam?.name || 'Unknown'),
        league: translateLeague(match.competition?.name || leagueCn),
        league_cn: leagueCn,
        start_time: new Date(match.utcDate).toISOString(),
        status: convertFootballStatus(match.status || ''),
        home_score: match.score?.fullTime?.home ?? null,
        away_score: match.score?.fullTime?.away ?? null
      })
    }
  }

  return { data: allMatches }
}

export async function fetchFootballDataResults(
  env: Env,
  candidates: ResultSyncCandidate[]
): Promise<{ data?: ScoreApiEvent[]; error?: string }> {
  if (!env.FOOTBALL_DATA_API_KEY) {
    return { data: [] }
  }

  const soccerCandidates = candidates.filter((candidate) => candidate.sport === 'soccer')
  if (soccerCandidates.length === 0) {
    return { data: [] }
  }

  const baseUrl = env.FOOTBALL_DATA_BASE_URL || 'https://api.football-data.org/v4'
  const events: ScoreApiEvent[] = []
  const errors: string[] = []

  const fdCandidates = soccerCandidates.filter((candidate) => candidate.external_id?.startsWith('fd_'))
  for (const candidate of fdCandidates) {
    const matchId = candidate.external_id?.replace(/^fd_/, '')
    if (!matchId) continue

    const response = await fetch(`${baseUrl}/matches/${matchId}`, {
      headers: footballHeaders(env)
    })
    if (response.status === 403) {
      return {
        data: events,
        error: 'football-data.org 返回 403，请检查 FOOTBALL_DATA_API_KEY 是否有效。'
      }
    }
    if (!response.ok) {
      errors.push(`football-data match ${matchId}: HTTP ${response.status}`)
      continue
    }

    const payload = (await response.json()) as { match?: FootballDataMatchPayload }
    const event = payload.match ? footballDataToScoreEvent(payload.match, candidate) : null
    if (event) {
      events.push(event)
    }
  }

  const codeByLeague: Record<string, string> = {}
  for (const [code, leagueName] of Object.entries(POPULAR_COMPETITIONS)) {
    codeByLeague[leagueName] = code
  }

  const groupedCandidates = new Map<string, ResultSyncCandidate[]>()
  for (const candidate of soccerCandidates) {
    if (candidate.external_id?.startsWith('fd_')) continue

    const competitionCode = codeByLeague[candidate.league]
    if (!competitionCode) continue

    const key = `${competitionCode}:${dateKeyFromIso(candidate.start_time)}`
    const group = groupedCandidates.get(key) || []
    group.push(candidate)
    groupedCandidates.set(key, group)
  }

  for (const [key, group] of groupedCandidates.entries()) {
    const [competitionCode] = key.split(':')
    const dateFrom = dateKeyWithOffset(group[0].start_time, -1)
    const dateTo = dateKeyWithOffset(group[0].start_time, 1)
    const params = new URLSearchParams({ dateFrom, dateTo })

    const response = await fetch(`${baseUrl}/competitions/${competitionCode}/matches?${params.toString()}`, {
      headers: footballHeaders(env)
    })
    if (response.status === 403) {
      return {
        data: events,
        error: 'football-data.org 返回 403，请检查 FOOTBALL_DATA_API_KEY 是否有效。'
      }
    }
    if (!response.ok) {
      errors.push(`football-data ${competitionCode}: HTTP ${response.status}`)
      continue
    }

    const payload = (await response.json()) as { matches?: FootballDataMatchPayload[] }
    for (const match of payload.matches ?? []) {
      const startTimeIso = matchStartIso(match.utcDate)
      const candidate = findCandidateForTeamsAndTime(
        group,
        match.homeTeam?.name,
        match.awayTeam?.name,
        startTimeIso
      )
      if (!candidate) continue

      const event = footballDataToScoreEvent(match, candidate)
      if (event) {
        events.push(event)
      }
    }
  }

  return {
    data: events,
    error: errors[0]
  }
}

export async function fetchOpenLigaDbResults(
  env: Env,
  candidates: ResultSyncCandidate[]
): Promise<{ data?: ScoreApiEvent[]; error?: string }> {
  const bundesligaLeague = POPULAR_ODDS_SPORTS.find((item) => item.key === 'soccer_germany_bundesliga')?.displayLeague
  const bundesligaCandidates = candidates.filter(
    (candidate) => candidate.sport === 'soccer' && candidate.league === bundesligaLeague
  )
  if (bundesligaCandidates.length === 0) {
    return { data: [] }
  }

  const baseUrl = 'https://api.openligadb.de'
  const response = await fetch(`${baseUrl}/getmatchdata/bl1`)
  if (!response.ok) {
    return { data: [], error: `OpenLigaDB 请求失败：HTTP ${response.status}` }
  }

  const payload = (await response.json()) as OpenLigaMatchPayload[]
  const events: ScoreApiEvent[] = []

  for (const match of payload) {
    const homeName = match.team1?.teamName || ''
    const awayName = match.team2?.teamName || ''
    const startTimeIso = matchStartIso(match.matchDateTime)
    const candidate = findCandidateForTeamsAndTime(bundesligaCandidates, homeName, awayName, startTimeIso)
    if (!candidate) continue

    const finalResult = (match.matchResults || []).at(-1)
    const homeScore = parseNullableScore(finalResult?.pointsTeam1)
    const awayScore = parseNullableScore(finalResult?.pointsTeam2)
    const completed = Boolean(match.matchIsFinished) || (homeScore !== null && awayScore !== null)

    events.push({
      id: candidate.external_id || `openliga_${match.matchID}`,
      match_id: candidate.match_id,
      sport_key: 'openligadb',
      sport_title: bundesligaLeague,
      commence_time: startTimeIso,
      completed,
      home_team: candidate.home_team,
      away_team: candidate.away_team,
      status: completed ? 'finished' : 'live',
      scores: scoreItems(candidate.home_team, candidate.away_team, homeScore, awayScore)
    })
  }

  return { data: events }
}

export async function fetchTheSportsDbResults(
  env: Env,
  candidates: ResultSyncCandidate[]
): Promise<{ data?: ScoreApiEvent[]; error?: string }> {
  const supportedCandidates = candidates.filter(
    (candidate) => candidate.sport === 'soccer' || candidate.sport === 'basketball'
  )
  if (supportedCandidates.length === 0) {
    return { data: [] }
  }

  const baseUrl = env.THE_SPORTS_DB_BASE_URL || 'https://www.thesportsdb.com/api/v1/json/3'
  const groups = new Map<string, ResultSyncCandidate[]>()
  for (const candidate of supportedCandidates) {
    const sportName = candidate.sport === 'basketball' ? 'Basketball' : 'Soccer'
    const key = `${sportName}:${dateKeyFromIso(candidate.start_time)}`
    const group = groups.get(key) || []
    group.push(candidate)
    groups.set(key, group)
  }

  const events: ScoreApiEvent[] = []
  const errors: string[] = []

  for (const [key, group] of groups.entries()) {
    const [sportName, dateKey] = key.split(':')
    const url = new URL(`${baseUrl}/eventsday.php`)
    url.searchParams.set('d', dateKey)
    url.searchParams.set('s', sportName)

    const response = await fetch(url.toString())
    if (!response.ok) {
      errors.push(`TheSportsDB ${dateKey}: HTTP ${response.status}`)
      continue
    }

    const payload = (await response.json()) as { events?: SportsDbEventPayload[] | null }
    for (const event of payload.events ?? []) {
      const { homeTeam, awayTeam } = sportsDbTeams(event)
      const startTimeIso = sportsDbStartIso(event)
      const candidate = findCandidateForTeamsAndTime(group, homeTeam, awayTeam, startTimeIso)
      if (!candidate) continue

      const homeScore = parseNullableScore(event.intHomeScore)
      const awayScore = parseNullableScore(event.intAwayScore)
      const completed =
        homeScore !== null &&
        awayScore !== null &&
        /match finished|finished|ft|full time|ended/i.test(event.strStatus || 'finished')

      if (homeScore === null || awayScore === null) {
        continue
      }

      events.push({
        id: candidate.external_id || `tsdb_${event.idEvent}`,
        match_id: candidate.match_id,
        sport_key: 'thesportsdb',
        sport_title: translateLeague(event.strLeague || candidate.league),
        commence_time: startTimeIso,
        completed,
        home_team: candidate.home_team,
        away_team: candidate.away_team,
        status: completed ? 'finished' : 'live',
        scores: scoreItems(candidate.home_team, candidate.away_team, homeScore, awayScore)
      })
    }
  }

  return {
    data: events,
    error: errors[0]
  }
}
