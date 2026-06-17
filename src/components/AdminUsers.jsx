import { useState, useEffect } from 'react'
import { ActionLabel, ACTION_CLASS, IconPlus, IconTrash, IconSignInOut, IconUsers } from './activityMeta'

const ROLES = ['admin', 'engineering', 'purchase']
const EMPTY = { username: '', password: '', full_name: '', role: 'purchase' }

const ACT_FILTERS = [
  { id: 'all', label: 'All', actions: null },
  { id: 'inout', label: <><IconSignInOut /> Sign in / out</>, actions: ['login', 'logout'] },
  { id: 'add', label: <><IconPlus /> Added</>, actions: ['import', 'revise'] },
  { id: 'remove', label: <><IconTrash /> Deleted</>, actions: ['delete'] },
  { id: 'user', label: <><IconUsers /> Users</>, actions: ['add_user', 'remove_user'] },
]

const ICON = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const EditIcon = () => <svg {...ICON}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
const KeyIcon = () => <svg {...ICON}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></svg>
const TrashIcon = () => <svg {...ICON}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>

export default function AdminUsers({ currentUser, onClose }) {
  const [tab, setTab] = useState('users')
  const [actFilter, setActFilter] = useState('all')
  const [users, setUsers] = useState([])
  const [activity, setActivity] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  async function load() {
    const r = await fetch('/api/auth/users')
    if (r.ok) setUsers(await r.json())
  }
  async function loadActivity() {
    const r = await fetch('/api/auth/activity?limit=200')
    if (r.ok) setActivity(await r.json())
  }
  // Refresh the list every 5s so online/offline dots stay live
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv) }, [])
  useEffect(() => { if (tab === 'activity') loadActivity() }, [tab])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function addUser(e) {
    e.preventDefault()
    setBusy(true); setErr(null); setMsg(null) 
    try {
      const r = await fetch('/api/auth/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error === 'username_taken' ? 'This username already exists' : data.error)
      setForm(EMPTY); setMsg(`Added ${data.username}`); load()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function delUser(u) {
    if (!window.confirm(`Delete user ${u.username}?`)) return
    const r = await fetch(`/api/auth/users/${u.id}`, { method: 'DELETE' })
    if (r.ok) load()
  }

  async function resetPw(u) {
    const pw = window.prompt(`Set a new password for ${u.username}:`)
    if (!pw) return
    const r = await fetch(`/api/auth/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
    })
    if (r.ok) setMsg(`Password changed for ${u.username}`)
  }

  async function editname(u) {
    const name = window.prompt(`Edit full name for ${u.username}:`, u.full_name ?? '')
    if (name === null) return   // cancelled
    setErr(null); setMsg(null)
    const r = await fetch(`/api/auth/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: name }),
    })
    if (r.ok) { setMsg(`Name updated for ${u.username}`); load() }
    else setErr('Failed to update name')
  }

  return (
    <div className="admin-page">
      <div className="admin-card">
        <div className="admin-page-hdr">
          <span>🛠 Admin Panel</span>
          <button className="bdv-btn bdv-btn--secondary" onClick={onClose}>← Back to Home</button>
        </div>

        <div className="admin-tabs">
          <button className={`admin-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}><IconUsers /> Users</button>
          
        </div>

        {tab === 'activity' && (
          <div className="comp-dialog-body" style={{ padding: 20 }}>
            <div className="admin-add-title" style={{ marginBottom: 12 }}>
              Activity history
            </div>
            <div className="act-filters">
              {ACT_FILTERS.map(f => (
                <button key={f.id} className={`act-filter${actFilter === f.id ? ' active' : ''}`}
                  onClick={() => setActFilter(f.id)}>{f.label}</button>
              ))}
            </div>
            {(() => {
              const cat = ACT_FILTERS.find(f => f.id === actFilter)
              const shown = cat?.actions ? activity.filter(a => cat.actions.includes(a.action)) : activity
              return (
            <div className="act-timeline">
              {shown.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, padding: 20, textAlign: 'center' }}>No records</div>}
              {shown.map(a => (
                <div key={a.id} className="act-row">
                  <span className={`act-dot ${ACTION_CLASS[a.action] || ''}`} />
                  <span className="act-when">{a.at}</span>
                  <span className="act-user">{a.user_name}</span>
                  <ActionLabel action={a.action} />
                  {a.target && <span className="act-target">{a.target}</span>}
                  {a.detail && <span className="act-detail">{a.detail}</span>}
                </div>
              ))}
            </div>
              )
            })()}
          </div>
        )}

        {tab === 'users' && (
        <div className="comp-dialog-body" style={{ padding: 20 }}>
          {/* Add user form */}
          <form className="admin-add" onSubmit={addUser}>
            <div className="admin-add-title">Add new user</div>
            <div className="admin-add-grid">
              <input className="comp-dialog-input" placeholder="Username" value={form.username} onChange={e => set('username', e.target.value)} />
              <input className="comp-dialog-input" placeholder="Password" type="text" value={form.password} onChange={e => set('password', e.target.value)} />
              <input className="comp-dialog-input" placeholder="Full name" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
              <select className="comp-select" value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="bdv-btn bdv-btn--rev" type="submit" disabled={busy || !form.username || !form.password}>
                {busy ? '…' : '+ Add'}
              </button>
            </div>
            {err && <div className="login-err" style={{ marginTop: 8 }}>⚠ {err}</div>}
            {msg && <div style={{ marginTop: 8, color: '#16a34a', fontSize: 13 }}>✓ {msg}</div>}
          </form>

          {/* User list */}
          <table className="comp-tbl" style={{ marginTop: 18 }}>
            <thead>
              <tr>
                <th>Username</th><th>Full name</th><th>Role</th><th>Created</th><th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    <span className={`u-status ${u.online ? 'u-on' : 'u-off'}`} title={u.online ? 'Online' : 'Offline'} />
                    {u.username}
                  </td>
                  <td>{u.full_name || '–'}</td>
                  <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                  <td style={{ fontSize: 12, color: '#888' }}>{u.created}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="admin-mini admin-mini--edit" onClick={() => editname(u)} title="Edit full name"><EditIcon /></button>
                    <button className="admin-mini admin-mini--key" onClick={() => resetPw(u)} title="Reset password"><KeyIcon /></button>
                    {u.id !== currentUser.id && (
                      <button className="admin-mini admin-mini--del" onClick={() => delUser(u)} title="Delete"><TrashIcon /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  )
}
