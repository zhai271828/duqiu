type JwtPayload = {
  sub: string
  iat: number
  exp: number
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function signHmac(content: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(content))
  return toBase64Url(new Uint8Array(signature))
}

export async function createJwt(sub: string, secret: string, ttlSeconds = 24 * 60 * 60): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const payload: JwtPayload = {
    sub,
    iat: now,
    exp: now + ttlSeconds
  }
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await signHmac(`${header}.${body}`, secret)
  return `${header}.${body}.${signature}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const [header, body, signature] = token.split('.')
  if (!header || !body || !signature) return null

  const expectedSignature = await signHmac(`${header}.${body}`, secret)
  if (expectedSignature !== signature) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as JwtPayload
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

async function derivePasswordBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations
    },
    keyMaterial,
    256
  )

  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePasswordBits(password, salt, iterations)
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = storedHash.split('$')
  if (algorithm !== 'pbkdf2_sha256' || !iterationsText || !saltText || !hashText) {
    return false
  }

  const iterations = Number(iterationsText)
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false
  }

  const salt = fromBase64Url(saltText)
  const expectedHash = fromBase64Url(hashText)
  const actualHash = await derivePasswordBits(password, salt, iterations)

  if (actualHash.length !== expectedHash.length) {
    return false
  }

  let diff = 0
  for (let index = 0; index < actualHash.length; index += 1) {
    diff |= actualHash[index] ^ expectedHash[index]
  }
  return diff === 0
}

export function createVerificationCode(): string {
  return String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = encoder.encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function bearerTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null

  const [scheme, token] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}
