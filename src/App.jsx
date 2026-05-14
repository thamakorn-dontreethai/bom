import { useState, useRef } from 'react'
import BomDocumentView from './components/BomDocumentView'
import './App.css'

export default function App() {
  const [bom, setBom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('กรุณาเลือกไฟล์ PDF เท่านั้น')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)

      const impRes = await fetch('/api/import/pdf', { method: 'POST', body: fd })
      const impData = await impRes.json()
      if (!impRes.ok) throw new Error(impData.error)

      const bomRes = await fetch(`/api/bom/${impData.design_spec_id}`)
      const bomData = await bomRes.json()
      if (!bomRes.ok) throw new Error(bomData.error)

      setBom(bomData)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function onFileChange(e) { handleFile(e.target.files[0]) }
  function onDrop(e) { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }
  function onDragOver(e) { e.preventDefault() }

  async function refreshBom() {
    if (!bom) return
    try {
      const r = await fetch(`/api/bom/${bom.id}`)
      const d = await r.json()
      if (r.ok) setBom(d)
    } catch (_) {}
  }

  if (bom) {
    return (
      <div className="app">
        <header className="app-bar">
          <span className="app-bar__title">BOM Management System</span>
          <span className="app-bar__sub">TOYODA GOSEI CO., LTD.</span>
          <div className="app-bar__spacer" />
          <button className="app-bar__btn" onClick={() => { setBom(null); setError(null) }}>
            ← Import ใหม่
          </button>
        </header>
        <main className="main-full">
          <BomDocumentView bom={bom} onRefresh={refreshBom} />
        </main>
      </div>
    )
  }

  return (
    <div className="app-upload">
      <div className="upload-card">
        <div className="upload-header">
          <div className="upload-logo-mark">BOM</div>
          <div>
            <div className="upload-title">BOM Management System</div>
            <div className="upload-company">TOYODA GOSEI CO., LTD.</div>
          </div>
        </div>

        <div
          className={`upload-dropzone${loading ? ' upload-dropzone--loading' : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={() => !loading && fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
          {loading ? (
            <>
              <div className="upload-spinner" />
              <div className="upload-drop-text">กำลัง parse PDF…</div>
            </>
          ) : (
            <>
              <div className="upload-icon">📄</div>
              <div className="upload-drop-main">คลิกเพื่อเลือกไฟล์ PDF</div>
              <div className="upload-drop-sub">หรือลาก & วางไฟล์ที่นี่</div>
              <div className="upload-drop-hint">รองรับไฟล์ Design Specification Instruction (1542)</div>
            </>
          )}
        </div>

        {error && <div className="upload-error">⚠ {error}</div>}

        <div className="upload-steps">
          <div className="upload-step"><span className="step-no">1</span>Import ไฟล์ PDF</div>
          <div className="upload-arrow">→</div>
          <div className="upload-step"><span className="step-no">2</span>ระบบสร้างตาราง BOM</div>
          <div className="upload-arrow">→</div>
          <div className="upload-step"><span className="step-no">3</span>Download เป็น PDF</div>
        </div>
      </div>
    </div>
  )
}
