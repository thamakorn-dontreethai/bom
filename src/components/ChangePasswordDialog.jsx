import { useState } from 'react'

export default function ChangePasswordDialog({ onClose }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    if (next !== confirm) { setErr('New passwords do not match'); return }
    if (next.length < 4) { setErr('New password must be at least 4 characters'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        const MSG = {
          wrong_current_password: 'Current password is incorrect',
          missing_fields: 'Please fill in all fields',
          password_too_short: 'New password is too short',
        }
        throw new Error(MSG[data.error] || data.error || 'Could not change password')
      }
      setDone(true)
      setTimeout(onClose, 1300)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="comp-overlay" onClick={onClose}>
      <form className="comp-dialog" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="comp-dialog-hdr">
          <span>🔑 Change Password</span>
          <button type="button" className="comp-dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="comp-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
          {done ? (
            <div style={{ color: '#16a34a', fontWeight: 600, textAlign: 'center', padding: '14px 0' }}>✓ Password changed successfully</div>
          ) : (<>
            <div>
              <label className="login-label">Current password</label>
              <input className="comp-dialog-input" type="password" value={current}
                onChange={e => setCurrent(e.target.value)} autoFocus autoComplete="current-password" />
            </div>
            <div>
              <label className="login-label">New password</label>
              <input className="comp-dialog-input" type="password" value={next}
                onChange={e => setNext(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="login-label">Confirm new password</label>
              <input className="comp-dialog-input" type="password" value={confirm}
                onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
            {err && <div className="login-err" style={{ marginTop: 2 }}>⚠ {err}</div>}
          </>)}
        </div>
        {!done && (
          <div className="comp-dialog-footer">
            <button type="button" className="bdv-btn bdv-btn--secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="bdv-btn bdv-btn--rev" disabled={busy || !current || !next || !confirm}>
              {busy ? 'Saving…' : 'Change Password'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
