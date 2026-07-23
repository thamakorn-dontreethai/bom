import { createContext, useContext, useState, useCallback } from 'react'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const t = localStorage.getItem('bom_token')
      const u = localStorage.getItem('bom_user')
      if (t && u) return JSON.parse(u)
    } catch {}
    return null
  })

  const login = useCallback(async (username, password) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Login failed')
    localStorage.setItem('bom_token', data.token)
    localStorage.setItem('bom_user', JSON.stringify({ username: data.username, role: data.role }))
    setUser({ username: data.username, role: data.role })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('bom_token')
    localStorage.removeItem('bom_user')
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  return useContext(Ctx)
}

export function authFetch(url, options = {}) {
  const token = localStorage.getItem('bom_token')
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}
