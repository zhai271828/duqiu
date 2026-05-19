const STORAGE_KEYS = {
  idToken: 'auth.idToken',
  refreshToken: 'auth.refreshToken',
  expiresAt: 'auth.expiresAt',
  user: 'auth.user'
}

export const SESSION_CHANGED_EVENT = 'auth:session-changed'

function emitSessionChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT))
  }
}

export function getStoredSession() {
  const idToken = localStorage.getItem(STORAGE_KEYS.idToken) || null
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken) || null
  const expiresAtRaw = localStorage.getItem(STORAGE_KEYS.expiresAt)
  const userRaw = localStorage.getItem(STORAGE_KEYS.user)

  let user = null
  if (userRaw) {
    try {
      user = JSON.parse(userRaw)
    } catch {
      user = null
    }
  }

  return {
    idToken,
    refreshToken,
    tokenExpiresAt: expiresAtRaw ? Number(expiresAtRaw) : null,
    user
  }
}

export function setStoredSession({ user, idToken, refreshToken, tokenExpiresAt }) {
  if (idToken) {
    localStorage.setItem(STORAGE_KEYS.idToken, idToken)
    localStorage.removeItem('token')
  } else {
    localStorage.removeItem(STORAGE_KEYS.idToken)
    localStorage.removeItem('token')
  }

  if (refreshToken) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken)
  } else {
    localStorage.removeItem(STORAGE_KEYS.refreshToken)
  }

  if (tokenExpiresAt) {
    localStorage.setItem(STORAGE_KEYS.expiresAt, String(tokenExpiresAt))
  } else {
    localStorage.removeItem(STORAGE_KEYS.expiresAt)
  }

  if (user) {
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user))
  } else {
    localStorage.removeItem(STORAGE_KEYS.user)
  }

  emitSessionChanged()
}

export function clearStoredSession() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key))
  emitSessionChanged()
}
