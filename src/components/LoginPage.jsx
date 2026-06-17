import { useState, useEffect } from 'react'
import { login } from '../auth'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Auto-dismiss the error popup after a few seconds.
  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(null), 4500)
    return () => clearTimeout(t)
  }, [err])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const user = await login(username.trim(), password)
      onLogin(user)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="login-shell">
      {err && (
        <div className="login-toast" role="alert" key={err}>
          <span className="login-toast-icon">⚠</span>
          <span className="login-toast-msg">{err}</span>
          <button type="button" className="login-toast-close" onClick={() => setErr(null)} aria-label="Close">✕</button>
        </div>
      )}
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">BOM</div>
        <div className="login-title">BILL OF MATERIAL</div>
        <div className="login-sub">Toyoda Gosei · Sign in</div>

        <label className="login-label">Username</label>
        <input className="login-input" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="username" autoFocus autoComplete="username" />

        <label className="login-label">Password</label>
        <input className="login-input" type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="password" autoComplete="current-password" />

        <button className="login-btn" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
