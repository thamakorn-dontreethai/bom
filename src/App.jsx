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
  { id: 'export',   icon: '📤', label: 'Export' },
]

export default function App() {
  const [bomList, setBomList]   = useState([])
  const [bom, setBom]           = useState(null)
  const [view, setView]         = useState('home')
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState(null)
  const [saveMsg, setSaveMsg]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
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
    <div className="shell">
      <div className="shell-topbar">
        <span className="shell-logo">BOM</span>
        <span className="shell-title">BILL OF MATERIAL · Toyoda Gosei</span>
      </div>

      <div className="home-wrap">
        {/* stats */}
        <div className="home-stats">
          <div className="hstat"><div className="hstat-n">{bomList.length}</div><div className="hstat-l">BOM ทั้งหมด</div></div>
          <div className="hstat"><div className="hstat-n">{bomList.filter(b => b.model === '3GJ').length}</div><div className="hstat-l">Model 3GJ</div></div>
          <div className="hstat"><div className="hstat-n">{new Set(bomList.map(b => b.customer)).size}</div><div className="hstat-l">ลูกค้า</div></div>
          <div className="hstat"><div className="hstat-n">{bomList.filter(b => b.type === 'HE').length}</div><div className="hstat-l">Type HE</div></div>
        </div>

        {/* upload / skeleton */}
        {uploading ? <SkeletonBomDoc /> : (
          <div
            className="home-upload"
            onClick={() => fileRef.current?.click()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
            onDragOver={e => e.preventDefault()}
          >
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            <div className="home-upload-icon">☁</div>
            <div className="home-upload-text">อัปโหลด Design Specification PDF</div>
            <div className="home-upload-sub">คลิกหรือลากไฟล์มาวางที่นี่</div>
          </div>
        )}
        {error && <div className="home-error">⚠ {error}</div>}
        {saveMsg && <div className="home-savemsg">✓ บันทึกแล้ว</div>}

        {/* list */}
        {!uploading && <div className="home-section-title">รายการ BOM ล่าสุด</div>}
        {uploading ? null : bomList.length === 0
          ? <div className="home-empty">ยังไม่มี BOM — อัปโหลด PDF เพื่อเริ่มต้น</div>
          : bomList.map(b => (
            <div key={b.id} className="home-card" onClick={() => selectBom(b.id)}>
              <div className="home-card-icon">📄</div>
              <div className="home-card-body">
                <div className="home-card-title">{b.tg_part_no ?? b.customer_part_no}</div>
                <div className="home-card-sub">Model: {b.model} · {b.customer} · {b.date ?? '–'}</div>
              </div>
              <button
                className="home-card-del"
                title="ลบ BOM นี้"
                onClick={e => { e.stopPropagation(); setDeleteConfirm(b) }}
              >🗑</button>
              <div className="home-card-arrow">›</div>
            </div>
          ))
        }
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

  /* ── BOM screens ──────────────────────────────────────────── */
  return (
    <div className="shell">
      <div className="shell-topbar">
        <span className="shell-logo">BOM</span>
        <span className="shell-title">BOM Management · Toyoda Gosei</span>
        <span className="shell-bom-id">{bom?.tg_part_no ?? ''}</span>
        <button className="shell-back" onClick={() => setView('home')}>← Home</button>
      </div>

      <div className="shell-nav">
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
