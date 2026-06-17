import { useState, useEffect } from 'react'
import { ActionLabel, ACTION_CLASS, IconPlus, IconTrash, IconSignInOut } from './activityMeta'

const ACT_FILTERS = [
  { id: 'all', label: 'All', actions: null },
  { id: 'inout', label: <><IconSignInOut /> Sign in/out</>, actions: ['login', 'logout'] },
  { id: 'add', label: <><IconPlus /> Added</>, actions: ['import', 'revise'] },
  { id: 'remove', label: <><IconTrash /> Deleted</>, actions: ['delete'] },
]

export default function ActivityDrawer({ open, onClose, isAdmin = false }) {
  const [activity, setActivity] = useState([])
  const [filter, setFilter] = useState('all')

  // Non-admins only get add/delete events from the server → hide the sign in/out filter for them
  const filters = isAdmin ? ACT_FILTERS : ACT_FILTERS.filter(f => f.id !== 'inout')

  useEffect(() => {
    if (!open) return
    const load = () => fetch('/api/auth/activity?limit=200').then(r => r.ok ? r.json() : []).then(setActivity).catch(() => {})
    load()
    const iv = setInterval(load, 5000)   // refresh while open
    return () => clearInterval(iv)
  }, [open])

  const cat = ACT_FILTERS.find(f => f.id === filter)
  const shown = cat?.actions ? activity.filter(a => cat.actions.includes(a.action)) : activity

  if (!open) return null

  return (
    <div className="comp-overlay" onClick={onClose}>
      <div className="act-popup" onClick={e => e.stopPropagation()}>
        <div className="act-drawer-hdr">
          <span>Activity Timeline</span>
          <button className="comp-dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="act-filters" style={{ padding: '12px 18px 0' }}>
          {filters.map(f => (
            <button key={f.id} className={`act-filter${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="act-timeline" style={{ maxHeight: 'none', flex: 1, padding: '8px 18px 18px' }}>
          {shown.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, padding: 20, textAlign: 'center' }}>No records</div>}
          {shown.map(a => (
            <div key={a.id} className="act-row">
              <span className={`act-dot ${ACTION_CLASS[a.action] || ''}`} />
              <span className="act-when">{a.at}</span>
              <span className="act-user">{a.user_name}</span>
              <ActionLabel action={a.action} />
              {a.target && <span className="act-target">{a.target}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
