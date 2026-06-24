import { useState, useEffect } from 'react'
import BomDocumentView from './BomDocumentView'

// History tab — old BOM versions. Each version is a full snapshot saved BEFORE an
// update/revision, so clicking a card shows the OLD BOM document (read-only, clean).
export default function BomExport({ bom }) {
  const [versions, setVersions] = useState([])
  const [viewing, setViewing] = useState(null)   // snapshot bom object being viewed
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!bom?.id) return
    fetch(`/api/bom/${bom.id}/versions`)
      .then(r => (r.ok ? r.json() : []))
      .then(setVersions)
      .catch(() => {})
  }, [bom?.id])

  async function openVersion(v) {
    setLoading(true)
    try {
      const r = await fetch(`/api/bom/${bom.id}/versions/${v.id}`)
      if (r.ok) {
        const snap = await r.json()
        setViewing({ ...snap, _label: v.version_label, _at: v.created_at, _by: v.created_by })
      }
    } catch (_) { /* ignore */ }
    finally { setLoading(false) }
  }

  return (
    <div className="ph-wrap">
      {/* Header */}
      <div className="ph-bom-hdr">
        {[
          ['Model', bom?.model],
          ['Customer Part No.', bom?.customer_part_no],
          ['TGT Part No.', bom?.tg_part_no],
          ['ECI No.', bom?.internal_eci_no],
        ].map(([k, v]) => (
          <div key={k} className="ph-bom-cell">
            <div className="ph-bom-label">{k}</div>
            <div className="ph-bom-val">{v ?? '–'}</div>
          </div>
        ))}
      </div>

      <div className="ph-section-title">
        Version History
        {versions.length > 0 && <span className="ph-count">{versions.length} versions</span>}
      </div>

      {versions.length === 0 ? (
        <div className="ph-empty">No old versions yet — a snapshot is saved here every time the BOM is updated/revised.</div>
      ) : (
        <div className="ver-list">
          {versions.map((v, i) => (
            <div key={v.id} className="ver-card ver-card--clickable" onClick={() => openVersion(v)}
              title="View this old BOM (read-only)">
              <div className="ver-badge"><span className="ver-badge-doc">📄</span></div>
              <div className="ver-body">
                <div className="ver-title-row">
                  <span className="ver-record">{v.version_label || `Version ${versions.length - i}`}</span>
                </div>
                <div className="ver-meta">
                  {v.eci_no && <span>ECI: <b>{v.eci_no}</b></span>}
                  {v.created_at && <span>📅 {v.created_at}</span>}
                  {v.created_by && <span>✏️ {v.created_by}</span>}
                </div>
              </div>
              <div className="ver-action"><span className="ver-open">👁 View old BOM →</span></div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="ph-empty">Loading version…</div>}

      {/* Read-only old-version viewer */}
      {viewing && (
        <div className="ver-overlay" onClick={() => setViewing(null)}>
          <div className="ver-overlay-card" onClick={e => e.stopPropagation()}>
            <div className="ver-overlay-bar">
              <span className="ver-overlay-title">
                🕐 Old version: <b>{viewing._label || 'Snapshot'}</b>
                {viewing._at && <span className="ver-overlay-sub"> · {viewing._at}{viewing._by ? ` · ${viewing._by}` : ''}</span>}
                <span className="ver-overlay-ro">READ-ONLY</span>
              </span>
              <button className="ver-overlay-close" onClick={() => setViewing(null)}>✕ Close</button>
            </div>
            <div className="ver-overlay-body">
              <BomDocumentView bom={viewing} readOnly />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
