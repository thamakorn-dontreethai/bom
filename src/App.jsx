import { useState, useEffect, useRef } from 'react'
import BomDocumentView from './components/BomDocumentView'
import BomTreeView from './components/BomTreeView'
import BomCompletion from './components/BomCompletion'
import BomExport from './components/BomExport'
import './App.css'

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
          <span>กำลังวิเคราะห์ PDF…</span>
        </div>
      </div>
    </div>
  )
}

const NAV_TABS = [
  { id: 'document', icon: '📄', label: 'Document' },
  { id: 'tree',     icon: '🌿', label: 'BOM Tree' },
  { id: 'complete', icon: '📋', label: 'Completion' },
  { id: 'export',   icon: '🖼', label: 'Photos' },
]

export default function App() {
  const [bomList, setBomList]   = useState([])
  const [bom, setBom]           = useState(null)
  const [view, setView]         = useState('home')
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState(null)
  const [saveMsg, setSaveMsg]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [homeSearch, setHomeSearch] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { loadList() }, [])

  async function loadList() {
    try {
      const r = await fetch('/api/bom')
      if (r.ok) setBomList(await r.json())
    } catch (_) {}
  }

  async function selectBom(id) {
    try {
      const r = await fetch(`/api/bom/${id}`)
      if (r.ok) { setBom(await r.json()); setView('document') }
    } catch (_) {}
  }

  async function refreshBom() {
    if (!bom) return
    try {
      const r = await fetch(`/api/bom/${bom.id}`)
      if (r.ok) setBom(await r.json())
    } catch (_) {}
  }

  async function handleFile(file) {
    if (!file?.name.toLowerCase().endsWith('.pdf')) {
      setError('กรุณาเลือกไฟล์ PDF เท่านั้น'); return
    }
    setUploading(true); setError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const ir = await fetch('/api/import/pdf', { method: 'POST', body: fd })
      const id = await ir.json()
      if (!ir.ok) throw new Error(id.error)
      await loadList()
      setSaveMsg(true)
      setTimeout(() => setSaveMsg(false), 4000)
      await selectBom(id.design_spec_id)
    } catch (e) { setError(e.message) }
    finally { setUploading(false) }
  }

  async function deleteBom(id) {
    try {
      const r = await fetch(`/api/bom/${id}`, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error) }
      await loadList()
    } catch (e) { setError(e.message) }
    finally { setDeleteConfirm(null) }
  }

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
      </div>

      <div className="home-wrap">
        {/* Stats */}
        {(() => {
          const modelCounts = {}
          bomList.forEach(b => { if (b.model) modelCounts[b.model] = (modelCounts[b.model] || 0) + 1 })
          const topModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]
          const typeCounts = {}
          bomList.forEach(b => { if (b.type) typeCounts[b.type] = (typeCounts[b.type] || 0) + 1 })
          const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]
          return (
            <div className="home-stats">
              <div className="hstat hstat--blue"><div className="hstat-n">{bomList.length}</div><div className="hstat-l">BOM ทั้งหมด</div></div>
              <div className="hstat hstat--indigo"><div className="hstat-n">{topModel?.[1] ?? 0}</div><div className="hstat-l">Model {topModel?.[0] ?? '–'}</div></div>
              <div className="hstat hstat--violet"><div className="hstat-n">{new Set(bomList.map(b => b.customer)).size}</div><div className="hstat-l">ลูกค้า</div></div>
              <div className="hstat hstat--teal"><div className="hstat-n">{topType?.[1] ?? 0}</div><div className="hstat-l">Type {topType?.[0] ?? '–'}</div></div>
            </div>
          )
        })()}

        {uploading && <SkeletonBomDoc />}

        {/* Upload zone — always visible when not uploading */}
        {!uploading && (
          <div className="home-dropzone" onClick={() => fileRef.current?.click()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('home-dropzone--drag') }}
            onDragLeave={e => e.currentTarget.classList.remove('home-dropzone--drag')}
          >
            <svg className="home-dropzone-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M32 44V24M32 24L24 32M32 24L40 32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20 48H14a10 10 0 1 1 2.4-19.7A14 14 0 1 1 44 36h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M24 48h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div className="home-dropzone-title">อัปโหลด Design Specification PDF</div>
            <div className="home-dropzone-sub">ลากไฟล์มาวางที่นี่ หรือ <span className="home-dropzone-link">คลิกเพื่อเลือกไฟล์</span></div>
            <div className="home-dropzone-hint">รองรับไฟล์ .pdf เท่านั้น</div>
          </div>
        )}

        {!uploading && <>
          {error && <div className="home-error">⚠ {error}</div>}
          {saveMsg && <div className="home-savemsg">✓ บันทึกแล้ว</div>}

          {/* Search + count */}
          <div className="home-list-header">
            <span className="home-list-title">รายการ BOM</span>
            <span className="home-list-count">{bomList.length} รายการ</span>
          </div>
          <div className="home-search-wrap">
            <svg className="home-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="home-search"
              placeholder="ค้นหา Part No. หรือชื่อ BOM…"
              value={homeSearch}
              onChange={e => setHomeSearch(e.target.value)}
            />
            {homeSearch && <button className="home-search-clear" onClick={() => setHomeSearch('')}>✕</button>}
          </div>

          {/* BOM list */}
          {bomList.length === 0
            ? (
              <div className="home-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{marginBottom:12}}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <div className="home-empty-title">ยังไม่มี BOM</div>
                <div className="home-empty-sub">คลิก Upload PDF หรือลากไฟล์มาวางที่นี่เพื่อเริ่มต้น</div>
              </div>
            )
            : bomList.filter(b => {
                if (!homeSearch.trim()) return true
                const q = homeSearch.toLowerCase()
                return b.tg_part_no?.toLowerCase().includes(q) ||
                       b.customer_part_no?.toLowerCase().includes(q) ||
                       b.model?.toLowerCase().includes(q)
              }).map(b => (
              <div key={b.id} className="home-card" onClick={() => selectBom(b.id)}>
                <div className="home-card-accent" />
                <div className="home-card-icon">📄</div>
                <div className="home-card-body">
                  <div className="home-card-title">{b.tg_part_no ?? b.customer_part_no}</div>
                  <div className="home-card-meta">
                    <span className="home-card-tag">{b.model ?? '–'}</span>
                    <span className="home-card-tag">{b.type ?? '–'}</span>
                    <span>{b.customer ?? '–'}</span>
                    <span>{b.date ?? '–'}</span>
                  </div>
                </div>
                <button className="home-card-del" title="ลบ BOM นี้"
                  onClick={e => { e.stopPropagation(); setDeleteConfirm(b) }}>🗑️</button>
              </div>
            ))
          }
        </>}
      </div>

      {deleteConfirm && (
        <div className="comp-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="comp-dialog" style={{maxWidth:360}} onClick={e => e.stopPropagation()}>
            <div className="comp-dialog-hdr">
              <span>ยืนยันการลบ</span>
              <button className="comp-dialog-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="comp-dialog-body" style={{padding:'16px 20px'}}>
              <p style={{margin:0}}>ลบ BOM <b>{deleteConfirm.tg_part_no ?? deleteConfirm.customer_part_no}</b> ออกถาวร?</p>
              <p style={{margin:'8px 0 0',fontSize:12,color:'#888'}}>ข้อมูลทั้งหมดจะถูกลบและไม่สามารถกู้คืนได้</p>
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setDeleteConfirm(null)}>ยกเลิก</button>
              <button className="bdv-btn bdv-btn--danger" onClick={() => deleteBom(deleteConfirm.id)}>ลบ</button>
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
      </div>

      <div className="shell-nav">
        <button className="shell-tab shell-tab--home" onClick={() => setView('home')} title="กลับหน้าหลัก">
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
        {view === 'document' && <BomDocumentView bom={bom} onRefresh={refreshBom} />}
        {view === 'tree'     && <BomTreeView bom={bom} />}
        {view === 'complete' && <BomCompletion bom={bom} onRefresh={refreshBom} />}
        {view === 'export'   && <BomExport bom={bom} />}
      </div>
    </div>
  )
}
