// Lightweight auth helpers + global fetch patch so every /api request carries the JWT.

const TOKEN_KEY = 'bom_token'
const USER_KEY  = 'bom_user'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function getUser()  { try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null } }

export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// Patch window.fetch once: attach Bearer token to same-origin /api & /approve calls,
// and auto-logout (reload) on 401 so the login screen reappears.
let patched = false
export function installFetchAuth(onUnauthorized) {
  if (patched) return
  patched = true
  const orig = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? ''
    const isApi = url.startsWith('/api') || url.startsWith('/approve')
    const token = getToken()
    if (isApi && token) {
      init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } }
    }
    const res = await orig(input, init)
    if (isApi && res.status === 401 && !url.includes('/api/auth/login')) {
      clearAuth()
      onUnauthorized?.()
    }
    return res
  }
}

export async function login(username, password) {
  let r
  try {
    r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new Error('Cannot reach the server. Please try again.')
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const MESSAGES = {
      invalid_credentials: 'Incorrect username or password',
      missing_fields: 'Please enter your username and password',
    }
    throw new Error(MESSAGES[data.error] || data.error || 'Sign in failed. Please try again.')
  }
  setAuth(data.token, data.user)
  return data.user
}
