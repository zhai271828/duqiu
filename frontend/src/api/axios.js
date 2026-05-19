import axios from 'axios'
import {
  clearStoredSession,
  getStoredSession,
  setStoredSession
} from '../utils/session'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

api.interceptors.request.use(
  (config) => {
    const { idToken } = getStoredSession()
    if (idToken) {
      config.headers.Authorization = `Bearer ${idToken}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

let refreshPromise = null

function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config || {}
    const requestUrl = originalRequest.url || ''
    const isRefreshRequest = requestUrl.includes('/auth/refresh')
    const isPublicAuthRequest =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/register') ||
      requestUrl.includes('/auth/forgot-password')

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshRequest && !isPublicAuthRequest) {
      const session = getStoredSession()
      if (!session.refreshToken) {
        clearStoredSession()
        redirectToLogin()
        return Promise.reject(error)
      }

      originalRequest._retry = true

      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${api.defaults.baseURL}/auth/refresh`, {
            refreshToken: session.refreshToken
          })
          .then((response) => {
            const expiresAt = Date.now() + Number(response.data.expires_in || 3600) * 1000
            setStoredSession({
              user: response.data.user,
              idToken: response.data.id_token,
              refreshToken: response.data.refresh_token,
              tokenExpiresAt: expiresAt
            })
            return response.data
          })
          .finally(() => {
            refreshPromise = null
          })
      }

      try {
        const refreshedSession = await refreshPromise
        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers.Authorization = `Bearer ${refreshedSession.id_token}`
        return api(originalRequest)
      } catch (refreshError) {
        clearStoredSession()
        redirectToLogin()
        return Promise.reject(refreshError)
      }
    }

    if (error.response?.status === 401 && isRefreshRequest) {
      clearStoredSession()
      redirectToLogin()
    }

    return Promise.reject(error)
  }
)

export default api
