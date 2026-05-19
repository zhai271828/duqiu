import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api/axios'
import {
  SESSION_CHANGED_EVENT,
  clearStoredSession,
  getStoredSession,
  setStoredSession
} from '../utils/session'

export const useAuthStore = defineStore('auth', () => {
  const initialSession = getStoredSession()
  const user = ref(initialSession.user)
  const idToken = ref(initialSession.idToken)
  const refreshToken = ref(initialSession.refreshToken)
  const tokenExpiresAt = ref(initialSession.tokenExpiresAt)

  const isAuthenticated = computed(() => !!idToken.value)
  const isAdmin = computed(() => !!user.value?.is_admin)
  const isEmailVerified = computed(() => !!user.value?.email_verified)
  const balance = computed(() => user.value?.balance || 0)

  function syncFromStorage() {
    const session = getStoredSession()
    user.value = session.user
    idToken.value = session.idToken
    refreshToken.value = session.refreshToken
    tokenExpiresAt.value = session.tokenExpiresAt
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(SESSION_CHANGED_EVENT, syncFromStorage)
  }

  function setSession(userData, authData) {
    const expiresIn = Number(authData?.expires_in ?? authData?.expiresIn ?? 3600)
    const expiresAt = Date.now() + expiresIn * 1000

    user.value = userData
    idToken.value = authData.id_token
    refreshToken.value = authData.refresh_token
    tokenExpiresAt.value = expiresAt

    setStoredSession({
      user: userData,
      idToken: authData.id_token,
      refreshToken: authData.refresh_token,
      tokenExpiresAt: expiresAt
    })
  }

  function updateUser(userData) {
    user.value = userData
    setStoredSession({
      user: userData,
      idToken: idToken.value,
      refreshToken: refreshToken.value,
      tokenExpiresAt: tokenExpiresAt.value
    })
  }

  async function register(username, email, password) {
    try {
      const response = await api.post('/auth/register', {
        username,
        email,
        password
      })

      const { user: userData } = response.data
      setSession(userData, response.data)

      return { success: true, message: response.data.message }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || '注册失败'
      }
    }
  }

  async function login(identifier, password) {
    try {
      const response = await api.post('/auth/login', {
        identifier,
        password
      })

      const { user: userData } = response.data
      setSession(userData, response.data)

      return { success: true, message: response.data.message }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || '登录失败'
      }
    }
  }

  async function fetchProfile() {
    try {
      const response = await api.get('/auth/profile')
      updateUser(response.data.user)
      return { success: true }
    } catch (error) {
      return { success: false }
    }
  }

  async function resendVerification() {
    try {
      const response = await api.post('/auth/resend-verification')
      if (response.data.user) {
        updateUser(response.data.user)
      }
      return { success: true, message: response.data.message }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || '发送验证邮件失败'
      }
    }
  }

  async function forgotPassword(identifier) {
    try {
      const response = await api.post('/auth/forgot-password', {
        identifier
      })
      return { success: true, message: response.data.message }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || '发送重置密码邮件失败'
      }
    }
  }

  async function initialize() {
    syncFromStorage()
    if (!idToken.value) return
    await fetchProfile()
  }

  function logout() {
    user.value = null
    idToken.value = null
    refreshToken.value = null
    tokenExpiresAt.value = null
    clearStoredSession()
  }

  return {
    user,
    idToken,
    refreshToken,
    tokenExpiresAt,
    isAuthenticated,
    isAdmin,
    isEmailVerified,
    balance,
    setSession,
    updateUser,
    syncFromStorage,
    register,
    login,
    fetchProfile,
    resendVerification,
    forgotPassword,
    initialize,
    logout
  }
})
