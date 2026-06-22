import { useState, useEffect, useRef } from 'react'
import BomDocumentView from './components/BomDocumentView'
import BomTreeView from './components/BomTreeView'
import BomCompletion from './components/BomCompletion'
import BomExport from './components/BomExport'
import LoginPage from './components/LoginPage'
import AdminUsers from './components/AdminUsers'
import ActivityDrawer from './components/ActivityDrawer'
import ChangePasswordDialog from './components/ChangePasswordDialog'
import { IconPlus, IconPencil, IconTrash } from './components/activityMeta'
import { getUser, clearAuth, installFetchAuth } from './auth'
import './App.css'
import { PDFStream } from 'canvas'

function SkeletonBomDoc() {
  const rows = Array(18).fill(null)
  const revRows = Array(5).fill(null)
  return (
    <div className="sk-doc-wrap">
      <div className="sk-doc-paper">
        {/* header block */}
        <div className="sk-doc-hdr">
          <div className="sk-doc-hdr-left">
            <div className="sk-b sk-b--sm" style={{width:'70%'}} />
            <div className="sk-b sk-b--xs" style={{width:'45%',marginTop:4}} />
            <div className="sk-b sk-b--xs" style={{width:'55%',marginTop:4}} />
            <div className="sk-b sk-b--xs" style={{width:'40%',marginTop:4}} />
            <div style={{marginTop:10}}>
              <div className="sk-b sk-b--xs" style={{width:'80%'}} />
              <div className="sk-b sk-b--xs" style={{width:'60%',marginTop:4}} />
            </div>
          </div>
          <div className="sk-doc-hdr-center">
            <div className="sk-b sk-b--title" />
          </div>
          <div className="sk-doc-hdr-right">
            <div className="sk-doc-sign-grid">
              {Array(5).fill(null).map((_,i)=><div key={i} className="sk-doc-sign-cell"/>)}
              {Array(5).fill(null).map((_,i)=><div key={i} className="sk-doc-sign-cell sk-doc-sign-cell--tall"/>)}
            </div>
          </div>
        </div>
        {/* meta rows */}
        <div className="sk-doc-meta">
          {[['35%','40%'],['35%','40%'],['35%','40%','15%']].map((cols,r)=>(
            <div key={r} className="sk-doc-meta-row">
              {cols.map((w,c)=><div key={c} className="sk-b sk-b--xs" style={{width:w}}/>)}
            </div>
          ))}
        </div>
        {/* thead skeleton */}
        <div className="sk-doc-thead">
          <div className="sk-b sk-b--thead" style={{width:'30%'}}/>
          <div className="sk-b sk-b--thead" style={{width:'15%'}}/>
          <div className="sk-b sk-b--thead" style={{width:'8%'}}/>
          <div className="sk-b sk-b--thead" style={{width:'8%'}}/>
          <div className="sk-b sk-b--thead" style={{width:'7%'}}/>
          <div className="sk-b sk-b--thead" style={{width:'25%'}}/>
        </div>
        {/* tbody rows */}
        <div className="sk-doc-tbody">
          {rows.map((_,i)=>(
            <div key={i} className="sk-doc-row">
              <div className="sk-doc-row-pn">
                {i % 5 === 0 && <div className="sk-b sk-b--pn" style={{width:'85%'}}/>}
                {i % 5 === 1 && <div className="sk-b sk-b--pn" style={{marginLeft:'18%',width:'75%'}}/>}
                {i % 5 === 2 && <div className="sk-b sk-b--pn" style={{marginLeft:'36%',width:'55%'}}/>}
                {i % 5 === 3 && <div className="sk-b sk-b--pn" style={{marginLeft:'54%',width:'40%'}}/>}
                {i % 5 === 4 && <div className="sk-b sk-b--pn" style={{marginLeft:'36%',width:'55%'}}/>}
              </div>
              <div className="sk-b sk-b--pn" style={{flex:'0 0 15%'}}/>
              <div className="sk-b sk-b--pn" style={{flex:'0 0 8%'}}/>
              <div className="sk-b sk-b--pn" style={{flex:'0 0 8%'}}/>
              <div className="sk-b sk-b--pn" style={{flex:'0 0 7%'}}/>
              <div style={{flex:'0 0 25%'}}/>
            </div>
          ))}
        </div>
        {/* footer / revision */}
        <div className="sk-doc-footer">
          <div className="sk-doc-note">
            <div className="sk-b sk-b--xs" style={{width:'90%'}}/>
            <div className="sk-b sk-b--xs" style={{width:'75%',marginTop:5}}/>
            <div className="sk-b sk-b--xs" style={{width:'80%',marginTop:5}}/>
          </div>
          <div className="sk-doc-revtbl">
            <div className="sk-doc-rev-hdr">
              {['8%','35%','12%','12%','14%','14%'].map((w,i)=>(
                <div key={i} className="sk-b" style={{flex:`0 0 ${w}`,height:10}}/>
              ))}
            </div>
            {revRows.map((_,i)=>(
              <div key={i} className="sk-doc-rev-row">
                {['8%','35%','12%','12%','14%','14%'].map((w,j)=>(
                  <div key={j} style={{flex:`0 0 ${w}`,padding:'0 2px'}}>
                    {i===0 && <div className="sk-b sk-b--xs" style={{width:'90%'}}/>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* scanning label */}
        <div className="sk-doc-scanning">
          <div className="sk-scan-dot"/><div className="sk-scan-dot" style={{animationDelay:'.2s'}}/><div className="sk-scan-dot" style={{animationDelay:'.4s'}}/>
          <span>Analyzing PDF…</span>
        </div>
      </div>
    </div>
  )
}

// Import progress popup — backend returns only when done, so we ease a fake % toward 90
// while waiting, then it unmounts on completion (which reads as "finished").
function ImportProgress() {
  const [pct, setPct] = useState(8)
  useEffect(() => {
    const iv = setInterval(() => {
      setPct(p => (p < 92 ? p + Math.max(1, Math.round((92 - p) / 14)) : p))
    }, 280)
    return () => clearInterval(iv)
  }, [])
  const steps = [
    { label: 'Uploading',     at: 0 },
    { label: 'Analyzing PDF', at: 35 },
    { label: 'Building BOM',  at: 70 },
  ]
  return (
    <div className="comp-overlay">
      <div className="imp-card">
        <div className="imp-ring" style={{ background: `conic-gradient(#3b82f6 ${pct * 3.6}deg, #e6edfb 0deg)` }}>
          <div className="imp-ring-inner"><span className="imp-pct">{pct}%</span></div>
        </div>
        <div className="imp-title">Conversion in progress…</div>
        <ul className="imp-steps">
          {steps.map((s, i) => {
            const next = steps[i + 1]
            const state = pct >= (next?.at ?? 100) ? 'done' : pct >= s.at ? 'active' : 'wait'
            return (
              <li key={s.label} className={`imp-step imp-step--${state}`}>
                <span className="imp-step-box">{state === 'done' ? '✓' : ''}</span>
                {s.label}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}


const NAV_TABS = [
  { id: 'document', icon: '', label: 'Document' },
  { id: 'tree',     icon: '', label: 'BOM Tree' },
  { id: 'complete', icon: '', label: 'Completion' },
  { id: 'export',   icon: '', label: 'History' },
]

const BOM_GROUPS = ['PP', 'AL', 'ASSY', 'BAG', 'Steering wheel']

// Install the fetch auth patch once, before any component fetches
installFetchAuth(() => { window.__bomLogout?.() })

export default function App() {
  const [user, setUser]         = useState(() => getUser())
  const [bomList, setBomList]   = useState([])
  const [bom, setBom]           = useState(null)
  const [view, setView]         = useState('home')
  const [uploading, setUploading] = useState(false)
  const [openingBom, setOpeningBom] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [errorInfo, setErrorInfo] = useState(null)   // { title, message, dupId? } → popup
  const [saveMsg, setSaveMsg]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [homeSearch, setHomeSearch] = useState('')
  const [showActivity, setShowActivity] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)
  const [filterGroup, setFilterGroup] = useState('All')
  const [uploadGroup, setUploadGroup] = useState(BOM_GROUPS[0])
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteUploading, setPasteUploading] = useState(false)
  const [pasteError, setPasteError] = useState(null)
  const fileRef = useRef(null)

  // Let the fetch-auth patch force logout on 401
  useEffect(() => { window.__bomLogout = () => setUser(null); return () => { delete window.__bomLogout } }, [])

  // Load the BOM list on mount / after login
  useEffect(() => { if (user) loadList() }, [user])

  // Heartbeat: keep this user marked "online" while logged in (any page). Stops on
  // logout/close → server drops them after the TTL, so online status is real-time.
  // Also ping the moment the tab becomes visible again — browsers throttle interval
  // timers in background tabs, so re-pinging on focus avoids a false "offline".
  useEffect(() => {
    if (!user) return
    const ping = () => fetch('/api/auth/ping', { method: 'POST' }).catch(() => {})
    ping()
    const iv = setInterval(ping, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') ping() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible) }
  }, [user])

  // Presence: send a heartbeat every 3s ONLY while actually on a BOM page
  // (document/tree/complete/export). Not on home, and NOT on the admin panel —
  // otherwise an admin browsing users would still show as "working on" the last BOM.
  useEffect(() => {
    if (!bom?.id || !NAV_TABS.some(t => t.id === view)) return
    const ping = () => fetch(`/api/presence/${bom.id}`, { method: 'POST' }).catch(() => {})
    ping()
    const iv = setInterval(ping, 3000)
    const leave = () => { navigator.sendBeacon?.(`/api/presence/${bom.id}`) || fetch(`/api/presence/${bom.id}`, { method: 'DELETE' }).catch(() => {}) }
    window.addEventListener('beforeunload', leave)
    return () => { clearInterval(iv); window.removeEventListener('beforeunload', leave); fetch(`/api/presence/${bom.id}`, { method: 'DELETE' }).catch(() => {}) }
  }, [bom?.id, view])

  // Esc → back to Home from any sub-view (document/tree/complete/export/admin),
  // unless the user is currently typing in a field.
  useEffect(() => {
    if (view === 'home') return
    function onKey(e) {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      setView('home')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  // 1 / 2 / 3 → switch between Document / BOM Tree / Completion while inside a BOM.
  useEffect(() => {
    if (!bom || !NAV_TABS.some(t => t.id === view)) return
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.key === '1') setView('document')
      else if (e.key === '2') setView('tree')
      else if (e.key === '3') setView('complete')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bom, view])

  // Presence: poll who's currently working, while on the home list
  const [presence, setPresence] = useState({})
  useEffect(() => {
    if (view !== 'home' || !user) return
    const load = () => fetch('/api/presence').then(r => r.ok ? r.json() : {}).then(setPresence).catch(() => {})
    load()
    const iv = setInterval(load, 2000)
    return () => clearInterval(iv)
  }, [view, user])

  function logout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearAuth(); setUser(null); setBom(null); setView('home')
  }

  async function loadList() {
    try {
      const r = await fetch('/api/bom')
      if (r.ok) setBomList(await r.json())
    } catch (_) {}
    finally { setListLoading(false) }
  }

  async function selectBom(id) {
    setOpeningBom(true); setView('document')   // switch immediately + show skeleton
    try {
      const r = await fetch(`/api/bom/${id}`)
      if (r.ok) { setBom(await r.json()) }
      else { setView('home') }
    } catch (_) { setView('home') }
    finally { setOpeningBom(false) }
  }

  async function refreshBom() {
    if (!bom) return
    try {
      const r = await fetch(`/api/bom/${bom.id}`)
      if (r.ok) { setBom(await r.json()); return }
      if (r.status === 404) { setBom(null); setView('home'); loadList() }
    } catch (_) {}
  }

  async function handleFile(file) {
    if (!file?.name.toLowerCase().endsWith('.pdf')) {
      setErrorInfo({ title: 'Invalid file', message: 'Only .pdf files are supported.' }); return
    }
    setUploading(true); setErrorInfo(null)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('bom_group', uploadGroup)
      const ir = await fetch('/api/import/pdf', { method: 'POST', body: fd })
      const id = await ir.json()
      if (!ir.ok) {
        setErrorInfo({
          title: id.error === 'duplicate' ? 'File already exists' : 'Upload failed',
          message: id.message || id.error || 'An error occurred while processing the file.',
          dupId: id.design_spec_id,
        })
        return
      }
      await loadList()
      setSaveMsg(true)
      setTimeout(() => setSaveMsg(false), 4000)
      await selectBom(id.design_spec_id)
    } catch (e) {
      setErrorInfo({ title: 'Error', message: e.message || 'Could not connect to the server.' })
    }
    finally { setUploading(false) }
  }

  async function handlePasteText() {
    if (!pasteText.trim()) { setPasteError('Please paste some DSI text first.'); return }
    setPasteUploading(true); setPasteError(null)
    try {
      const r = await fetch('/api/import/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText, bom_group: uploadGroup }),
      })
      let data
      try { data = await r.json() } catch { data = {} }
      if (!r.ok) { setPasteError(data.error || data.message || `Server error (${r.status})`); return }
      setShowPasteModal(false); setPasteText('')
      await loadList()
      setSaveMsg(true); setTimeout(() => setSaveMsg(false), 4000)
      await selectBom(data.design_spec_id)
    } catch (e) {
      setPasteError(e.message || 'Could not connect to server.')
    } finally {
      setPasteUploading(false)
    }
  }

  async function deleteBom(id) {
    try {
      const r = await fetch(`/api/bom/${id}`, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error) }
      await loadList()
    } catch (e) { setErrorInfo({ title: 'Delete failed', message: e.message }) }
    finally { setDeleteConfirm(null) }
  }

  /* ── Not logged in → login screen ── */
  if (!user) return <LoginPage onLogin={setUser} />

  const userChip = (
    <div className="shell-user">
      {user.role === 'admin' && (
        <button className="shell-user-admin" onClick={() => setView('admin')} title="Admin Panel">🛠 Admin</button>
      )}
      <span className="shell-user-name" onClick={() => setShowChangePw(true)} title="Change my password" style={{ cursor: 'pointer' }}>
        {user.full_name || user.username}
      </span>
      <span className={`role-badge role-${user.role}`}>{user.role}</span>
      <button className="shell-user-logout" onClick={logout} title="Sign out">⏻</button>
      {showChangePw && <ChangePasswordDialog onClose={() => setShowChangePw(false)} />}
    </div>
  )

  /* ── Admin full-page view ── */
  if (view === 'admin' && user.role === 'admin') return (
    <div className="shell">
      <div className="shell-topbar">
        <span className="shell-logo">BOM</span>
        <span className="shell-title">BILL OF MATERIAL · Toyoda Gosei</span>
        {userChip}
      </div>
      <div className="shell-content">
        <AdminUsers currentUser={user} onClose={() => setView('home')} />
      </div>
    </div>
  )

  /* ── Home ─────────────────────────────────────────────────── */
  if (view === 'home') return (
    <div className="shell"
      onDrop={e => { e.preventDefault(); if (!uploading) handleFile(e.dataTransfer.files[0]) }}
      onDragOver={e => e.preventDefault()}
    >
      <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
         {/*tapbar*/}
      <div className="shell-topbar">
        <span className="shell-logo">BOM</span>
        <span className="shell-title">BILL OF MATERIAL · Toyoda Gosei</span>
        <button className="shell-topbar-act" onClick={() => setShowActivity(true)} title="Activity Timeline">
          Activity
        </button>
        {userChip}
      </div>

      <ActivityDrawer open={showActivity} onClose={() => setShowActivity(false)} isAdmin={user.role === 'admin'} />

      <div className="home-wrap">

        {/* ── Hero ── */}
        <div className="home-hero">
          <div className="home-hero-grid">

            {/* left: title + stats + group selector */}
            <div className="home-hero-left">
              <h1 className="home-hero-title">Bill of Material</h1>
              {/* BOM Group selector */}
              <div className="home-group-selector">
                <span className="home-group-label">BOM Group:</span>
                {BOM_GROUPS.map(g => (
                  <button key={g}
                    className={`home-group-btn${uploadGroup === g ? ' active' : ''}`}
                    onClick={() => setUploadGroup(g)}>
                    {g}
                  </button>
                ))}
              </div>
              

              {/* Stats bar — workflow figures: what needs doing + who's working right now */}
              {(() => {
                const approved   = bomList.filter(b => b.approved_by && String(b.approved_by).trim()).length
                const pending    = bomList.length - approved
                const workingNow = Object.values(presence).filter(a => Array.isArray(a) && a.length > 0).length
                return (
                  <div className="home-stats">
                    <div className="hstat-item">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span className="hstat-item-n">{bomList.length}</span>
                      <span className="hstat-item-l">Total BOMs</span>
                    </div>
                    <div className="hstat-sep" />
                    <div className="hstat-item">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <span className="hstat-item-n" style={{color:'#16a34a'}}>{approved}</span>
                      <span className="hstat-item-l">Approved</span>
                    </div>
                    <div className="hstat-sep" />
                    <div className="hstat-item">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span className="hstat-item-n" style={{color: pending ? '#d97706' : undefined}}>{pending}</span>
                      <span className="hstat-item-l">Pending</span>
                    </div>
                    <div className="hstat-sep" />
                    <div className="hstat-item">
                      <span className={`hstat-live-dot${workingNow ? ' on' : ''}`} />
                      <span className="hstat-item-n" style={{color: workingNow ? '#15803d' : undefined}}>{workingNow}</span>
                      <span className="hstat-item-l">Working now</span>
                    </div>
                  </div>
                )
              })()}

              
            </div>

            {/* right: dropzone */}
            <div className="home-hero-right">
          {(
            <div className="home-dropzone"
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('home-dropzone--drag') }}
              onDragLeave={e => e.currentTarget.classList.remove('home-dropzone--drag')}
            >
              <svg className="home-dropzone-icon" viewBox="0 0 64 64" fill="none">
                <path d="M32 44V24M32 24L24 32M32 24L40 32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M20 48H14a10 10 0 1 1 2.4-19.7A14 14 0 1 1 44 36h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M24 48h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <div className="home-dropzone-title">Drop your file here</div>
              <button className="home-dropzone-btn" onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>
                Browse files
              </button>
              <div className="home-dropzone-hint">Supports .pdf files only · Max 100 MB</div>
            </div>
          )}
          <button className="home-paste-btn" onClick={() => { setPasteText(''); setPasteError(null); setShowPasteModal(true) }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            </svg>
            Paste DSI Text
          </button>
            </div>{/* /home-hero-right */}
          </div>{/* /home-hero-grid */}
        </div>

        {/* ── List section ── */}
        <div className="home-list-section">
          {saveMsg && <div className="home-savemsg">✓ Saved</div>}

          {/* Filter tabs */}
          <div className="home-filter-tabs">
            {['All', ...BOM_GROUPS].map(g => (
              <button key={g}
                className={`home-filter-tab${filterGroup === g ? ' active' : ''}`}
                onClick={() => setFilterGroup(g)}>
                {g}
                <span className="home-filter-count">
                  {g === 'All' ? bomList.length : bomList.filter(b => b.bom_group === g).length}
                </span>
              </button>
            ))}
          </div>

          <div className="home-list-header">
            <span className="home-list-title">BOM List</span>
            <span className="home-list-count">{bomList.filter(b => filterGroup === 'All' || b.bom_group === filterGroup).length} items</span>
          </div>
          <div className="home-search-wrap">
            <svg className="home-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="home-search"
              placeholder="Search Part No. or BOM name…"
              value={homeSearch}
              onChange={e => setHomeSearch(e.target.value)}
            />
            {homeSearch && <button className="home-search-clear" onClick={() => setHomeSearch('')}>✕</button>}
          </div>

          {listLoading
            ? (
              <div className="home-card-sk-list">
                {Array(3).fill(null).map((_, i) => (
                  <div key={i} className="home-card home-card--sk">
                    <div className="home-card-accent" />
                    <div className="home-card-body">
                      <div className="sk-b sk-b--sm" style={{ width: '38%' }} />
                      <div className="sk-b sk-b--xs" style={{ width: '55%', marginTop: 10 }} />
                      <div className="sk-b sk-b--xs" style={{ width: '30%', marginTop: 8 }} />
                    </div>
                  </div>
                ))}
              </div>
            )
            : bomList.length === 0
            ? (
              <div className="home-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{marginBottom:12}}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <div className="home-empty-title">No BOMs yet</div>
                <div className="home-empty-sub">Click Browse files or drag a file here to get started</div>
              </div>
            )
            : (
              <>
                {/* aligned column header */}
                <div className="home-list-cols">
                  <span>Part No.</span>
                  <span>Group</span>
                  <span>Model</span>
                  <span>Type</span>
                  <span>Customer</span>
                  <span>Date</span>
                  <span>Added by</span>
                  <span>Updated</span>
                  <span />
                </div>
                {bomList.filter(b => {
                  if (filterGroup !== 'All' && b.bom_group !== filterGroup) return false
                  if (!homeSearch.trim()) return true
                  const q = homeSearch.toLowerCase()
                  return b.tg_part_no?.toLowerCase().includes(q) ||
                         b.customer_part_no?.toLowerCase().includes(q) ||
                         b.model?.toLowerCase().includes(q)
                }).map(b => {
                  const live = presence[b.id]?.length > 0
                  return (
                  <div key={b.id}
                    className={`home-card${live ? ' home-card--live' : ''}`}
                    title={live ? `Working: ${presence[b.id].join(', ')}` : undefined}
                    onClick={() => selectBom(b.id)}>
                    <div className="home-card-accent" />
                    <div className="hc-part">
                      <span className="hc-icon">📄</span>
                      <span className="hc-pn">{b.tg_part_no ?? b.customer_part_no}</span>
                      {live && (
                        <span className="hc-live-avatars" title={`Working: ${presence[b.id].join(', ')}`}>
                          {presence[b.id].slice(0, 2).map((n, i) => (
                            <span key={i} className="hc-avatar" title={n}>{n.charAt(0).toUpperCase()}</span>
                          ))}
                          {presence[b.id].length > 2 && (
                            <span className="hc-avatar-more" title={presence[b.id].slice(2).join(', ')}>+{presence[b.id].length - 2}</span>
                          )}
                        </span>
                      )}
                    </div>
                    <span className="hc-cell">
                      {b.bom_group ? <span className="home-card-group">{b.bom_group}</span> : '–'}
                    </span>
                    <span className="hc-cell">
                      {b.model ? <span className="home-card-tag">{b.model}</span> : '–'}
                    </span>
                    <span className="hc-cell">
                      {b.type ? <span className="home-card-tag">{b.type}</span> : '–'}
                    </span>
                    <span className="hc-cell">{b.customer ?? '–'}</span>
                    <span className="hc-cell">{b.date ?? '–'}</span>
                    <span className="hc-cell hc-added" title={b.created_by ? `Added by ${b.created_by}` : ''}>
                      {b.created_by ? <><IconPlus /> {b.created_by}</> : '–'}
                    </span>
                    <span className="hc-cell hc-updated"
                      title={b.updated_by ? `Last updated ${b.updated_by}${b.updated_at ? ' · ' + b.updated_at : ''}` : ''}>
                      {b.updated_by
                        ? <><IconPencil /> {b.updated_by}{b.updated_at ? ` · ${b.updated_at}` : ''}</>
                        : '–'}
                    </span>
                    <button className="home-card-del" title="Delete this BOM"
                      onClick={e => { e.stopPropagation(); setDeleteConfirm(b) }}><IconTrash /></button>
                  </div>
                  )
                })}
              </>
            )
          }
        </div>
      </div>

      {deleteConfirm && (
        <div className="comp-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="comp-dialog" style={{maxWidth:360}} onClick={e => e.stopPropagation()}>
            <div className="comp-dialog-hdr">
              <span>Confirm Delete</span>
              <button className="comp-dialog-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="comp-dialog-body" style={{padding:'16px 20px'}}>
              <p style={{margin:0}}>Permanently delete BOM <b>{deleteConfirm.tg_part_no ?? deleteConfirm.customer_part_no}</b>?</p>
              <p style={{margin:'8px 0 0',fontSize:12,color:'#888'}}>All data will be deleted and cannot be recovered.</p>
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="bdv-btn bdv-btn--danger" onClick={() => deleteBom(deleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {uploading && <ImportProgress />}

      {showPasteModal && (
        <div className="paste-overlay" onClick={() => setShowPasteModal(false)}>
          <div className="paste-modal" onClick={e => e.stopPropagation()}>
            <div className="paste-modal-header">
              <span>Paste DSI Text</span>
              <button className="comp-dialog-close" onClick={() => setShowPasteModal(false)}>✕</button>
            </div>
            <div className="paste-modal-body">
              <div className="paste-modal-hint">
                Open the DSI document, select all text (Ctrl+A), copy (Ctrl+C), then paste below.
              </div>
              <div className="paste-modal-group-row">
                <span className="paste-modal-group-label">BOM Group:</span>
                {BOM_GROUPS.map(g => (
                  <button key={g}
                    className={`home-group-btn${uploadGroup === g ? ' active' : ''}`}
                    onClick={() => setUploadGroup(g)}>
                    {g}
                  </button>
                ))}
              </div>
              <textarea
                className="paste-modal-textarea"
                placeholder="Paste DSI text here..."
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              {pasteError && <div className="paste-modal-error">{pasteError}</div>}
            </div>
            <div className="paste-modal-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setShowPasteModal(false)}>Cancel</button>
              <button
                className="bdv-btn bdv-btn--primary"
                onClick={handlePasteText}
                disabled={pasteUploading || !pasteText.trim()}>
                {pasteUploading ? 'Importing…' : 'Import BOM'}
              </button>
            </div>
          </div>
        </div>
      )}

      {errorInfo && (
        <div className="comp-overlay" onClick={() => setErrorInfo(null)}>
          <div className="alert-dialog" onClick={e => e.stopPropagation()}>
            <div className={`alert-icon${errorInfo.dupId ? ' alert-icon--warn' : ' alert-icon--err'}`}>
              {errorInfo.dupId ? (
                <svg className="alert-anim" viewBox="0 0 40 40">
                  <path className="aa-mark aa-bang-line" d="M20 9 L20 24" />
                  <circle className="aa-mark-dot" cx="20" cy="31" r="2.1" />
                </svg>
              ) : (
                <svg className="alert-anim" viewBox="0 0 40 40">
                  <path className="aa-mark aa-x1" d="M12 12 L28 28" />
                  <path className="aa-mark aa-x2" d="M28 12 L12 28" />
                </svg>
              )}
            </div>
            <div className="alert-title">{errorInfo.title}</div>
            <div className="alert-msg">{errorInfo.message}</div>
            <div className="alert-actions">
              {errorInfo.dupId && (
                <button className="bdv-btn bdv-btn--rev"
                  onClick={() => { const id = errorInfo.dupId; setErrorInfo(null); selectBom(id) }}>
                  Open existing BOM
                </button>
              )}
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setErrorInfo(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  /* ── BOM screens Document View──────────────────────────────────────────── */
  return (
    <div className="shell">
      <div className="shell-topbar">
        <span className="shell-logo">BOM</span>
        <span className="shell-title">BILL OF MATERIAL · Toyoda Gosei</span>
        <span className="shell-bom-id">{bom?.tg_part_no ?? ''}</span>
        {userChip}
      </div>

      <div className="shell-nav">
        <button className="shell-tab shell-tab--home" onClick={() => setView('home')} title="Back to Home">
          <svg width="13" height="13" viewBox="0 0 576 512" fill="currentColor" style={{verticalAlign:'middle',marginRight:5}}>
            <path d="M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4.1-2.8.1-4.2.1H416 392c-22.1 0-40-17.9-40-40V448 384c0-17.7-14.3-32-32-32H256c-17.7 0-32 14.3-32 32v64 24c0 22.1-17.9 40-40 40H160 128.1c-1.5 0-3-.1-4.5-.2c-1.2.1-2.4.2-3.6.2H104c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9.1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z"/>
          </svg>
          Home
        </button>
        <div className="shell-nav-sep" />
        {NAV_TABS.map(t => (
          <button key={t.id} className={`shell-tab${view === t.id ? ' active' : ''}`} onClick={() => setView(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="shell-content">
        {openingBom || !bom ? <SkeletonBomDoc /> : (<>
          {view === 'document' && <BomDocumentView bom={bom} onRefresh={refreshBom} />}
          {view === 'tree'     && <BomTreeView bom={bom} />}
          {view === 'complete' && <BomCompletion bom={bom} onRefresh={refreshBom} />}
          {view === 'export'   && <BomExport bom={bom} />}
        </>)}
      </div>
    </div>
  )
}