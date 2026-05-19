import { decodeProtectedHeader, importSPKI, importX509, jwtVerify } from 'jose'

import type { Env } from './types.ts'

const DEFAULT_AUTH_BASE_URL = 'https://identitytoolkit.googleapis.com/v1'
const DEFAULT_SECURE_TOKEN_BASE_URL = 'https://securetoken.googleapis.com/v1'
const DEFAULT_PUBLIC_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

type FirebaseErrorPayload = {
  error?: {
    message?: string
  }
}

type FirebaseLookupUser = {
  localId: string
  email: string
  emailVerified: boolean
}

type FirebaseVerifyEmailResponse = {
  localId?: string
  email?: string
  emailVerified?: boolean
}

export type FirebaseSession = {
  localId: string
  email: string
  idToken: string
  refreshToken: string
  expiresIn: string
}

export type FirebaseVerifiedToken = {
  uid: string
  email: string | null
  emailVerified: boolean
}

export class FirebaseApiError extends Error {
  code: string
  status: number

  constructor(code: string, status = 400) {
    super(code)
    this.name = 'FirebaseApiError'
    this.code = code
    this.status = status
  }
}

let cachedPublicKeys: {
  expiresAt: number
  values: Record<string, string>
} | null = null

function getFirebaseAuthBaseUrl(env: Env): string {
  return env.FIREBASE_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL
}

function getFirebaseSecureTokenBaseUrl(env: Env): string {
  return env.FIREBASE_SECURE_TOKEN_BASE_URL || DEFAULT_SECURE_TOKEN_BASE_URL
}

function getFirebasePublicKeysUrl(env: Env): string {
  return env.FIREBASE_PUBLIC_KEYS_URL || DEFAULT_PUBLIC_KEYS_URL
}

function getRequiredFirebaseConfig(env: Env) {
  if (!env.FIREBASE_API_KEY || !env.FIREBASE_PROJECT_ID) {
    throw new FirebaseApiError('FIREBASE_NOT_CONFIGURED', 500)
  }

  return {
    apiKey: env.FIREBASE_API_KEY,
    projectId: env.FIREBASE_PROJECT_ID
  }
}

async function parseFirebaseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as FirebaseErrorPayload | T | null

  if (!response.ok) {
    const code =
      (payload as FirebaseErrorPayload | null)?.error?.message || `HTTP_${response.status}`
    throw new FirebaseApiError(code, response.status)
  }

  return payload as T
}

async function postFirebaseJson<T>(
  env: Env,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const { apiKey } = getRequiredFirebaseConfig(env)
  const url = `${getFirebaseAuthBaseUrl(env)}${path}?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  return parseFirebaseResponse<T>(response)
}

export async function firebaseSignUp(
  env: Env,
  email: string,
  password: string
): Promise<FirebaseSession> {
  return postFirebaseJson<FirebaseSession>(env, '/accounts:signUp', {
    email,
    password,
    returnSecureToken: true
  })
}

export async function firebaseSignIn(
  env: Env,
  email: string,
  password: string
): Promise<FirebaseSession> {
  return postFirebaseJson<FirebaseSession>(env, '/accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true
  })
}

export async function firebaseLookupByIdToken(
  env: Env,
  idToken: string
): Promise<FirebaseLookupUser | null> {
  const response = await postFirebaseJson<{ users?: FirebaseLookupUser[] }>(env, '/accounts:lookup', {
    idToken
  })

  return response.users?.[0] || null
}

export async function firebaseSendVerificationEmail(env: Env, idToken: string): Promise<void> {
  await postFirebaseJson(env, '/accounts:sendOobCode', {
    requestType: 'VERIFY_EMAIL',
    idToken
  })
}

export async function firebaseCompleteEmailVerification(
  env: Env,
  oobCode: string
): Promise<FirebaseLookupUser> {
  const response = await postFirebaseJson<FirebaseVerifyEmailResponse>(env, '/accounts:update', {
    oobCode
  })

  if (!response.localId || !response.email) {
    throw new FirebaseApiError('INVALID_OOB_CODE', 400)
  }

  return {
    localId: response.localId,
    email: response.email,
    emailVerified: response.emailVerified !== false
  }
}

export async function firebaseSendPasswordResetEmail(env: Env, email: string): Promise<void> {
  await postFirebaseJson(env, '/accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email
  })
}

export async function firebaseRefreshToken(
  env: Env,
  refreshToken: string
): Promise<FirebaseSession> {
  const { apiKey } = getRequiredFirebaseConfig(env)
  const url = `${getFirebaseSecureTokenBaseUrl(env)}/token?key=${encodeURIComponent(apiKey)}`
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  const payload = await parseFirebaseResponse<{
    user_id: string
    id_token: string
    refresh_token: string
    expires_in: string
  }>(response)

  return {
    localId: payload.user_id,
    email: '',
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in
  }
}

async function getFirebasePublicKeys(env: Env): Promise<Record<string, string>> {
  if (cachedPublicKeys && cachedPublicKeys.expiresAt > Date.now()) {
    return cachedPublicKeys.values
  }

  const response = await fetch(getFirebasePublicKeysUrl(env))
  if (!response.ok) {
    throw new FirebaseApiError('FIREBASE_PUBLIC_KEYS_UNAVAILABLE', 502)
  }

  const values = (await response.json()) as Record<string, string>
  const cacheHeader = response.headers.get('cache-control') || ''
  const maxAgeMatch = cacheHeader.match(/max-age=(\d+)/)
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600

  cachedPublicKeys = {
    values,
    expiresAt: Date.now() + maxAgeSeconds * 1000
  }

  return values
}

async function importGoogleKey(pemOrCertificate: string) {
  if (pemOrCertificate.includes('BEGIN CERTIFICATE')) {
    return importX509(pemOrCertificate, 'RS256')
  }

  return importSPKI(pemOrCertificate, 'RS256')
}

export async function verifyFirebaseIdToken(
  env: Env,
  idToken: string
): Promise<FirebaseVerifiedToken> {
  const { projectId } = getRequiredFirebaseConfig(env)
  const header = decodeProtectedHeader(idToken)

  if (!header.kid || header.alg !== 'RS256') {
    throw new FirebaseApiError('INVALID_ID_TOKEN', 401)
  }

  const publicKeys = await getFirebasePublicKeys(env)
  const signingKey = publicKeys[header.kid]
  if (!signingKey) {
    throw new FirebaseApiError('INVALID_ID_TOKEN', 401)
  }

  const key = await importGoogleKey(signingKey)
  const { payload } = await jwtVerify(idToken, key, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId
  }).catch(() => {
    throw new FirebaseApiError('INVALID_ID_TOKEN', 401)
  })

  return {
    uid: String(payload.sub || payload.user_id || ''),
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true
  }
}
