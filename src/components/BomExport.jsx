import { useState, useEffect } from 'react'

export default function BomExport({ bom }) {
  const [zoom, setZoom] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!bom?.id) return
    fetch(`/api/bom/${bom.id}/image-history`)
      .then(r => r.json())
      .then(setHistory)
      .catch(() => {})
  }, [bom?.id])

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

      {/* Image history */}
      <div className="ph-section-title">
        Update History
        {history.length > 0 && <span className="ph-count">{history.length} items</span>}
      </div>
      {history.length === 0 ? (
        <div className="ph-empty">No update history yet</div>
      ) : (
        <div className="ph-history-list">
          {history.map(h => (
            <div key={h.id} className="ph-history-row" onClick={() => setZoom({ image_url: h.image_url, tg_part_no: h.tg_part_no, part_name: h.part_name, level: h.level })}>
              <img src={h.image_url} alt={h.tg_part_no} className="ph-history-thumb" />
              <div className="ph-history-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span className="ph-pn">{h.tg_part_no ?? '–'}</span>
                  <span className={`ph-event-badge ph-event-badge--${h.event_type ?? 'added'}`}>
                    {h.event_type === 'added'          ? '+ Added'
                    : h.event_type === 'revised'        ? '✎ Updated Document'
                    : h.event_type === 'image_replaced' ? '🖼 Image Replaced'
                    : h.event_type}
                  </span>
                </div>
                <div className="ph-name">{h.part_name}</div>
                <div className="ph-meta">
                  Lv.{h.level}
                  {h.quantity != null ? ` · ${h.quantity} pcs` : ''}
                  {h.mass_gram != null ? ` · ${Number(h.mass_gram).toLocaleString()} g` : ''}
                  {h.spec ? ` · ${h.spec}` : ''}
                </div>
              </div>
              <div className="ph-history-date">{h.recorded_at}</div>
            </div>
          ))}
        </div>
      )}

      {/* Zoom overlay */}
      {zoom && (
        <div className="ph-zoom-overlay" onClick={() => setZoom(null)}>
          <div className="ph-zoom-box" onClick={e => e.stopPropagation()}>
            <button className="ph-zoom-close" onClick={() => setZoom(null)}>✕</button>
            <img src={zoom.image_url} alt={zoom.tg_part_no} className="ph-zoom-img" />
            <div className="ph-zoom-info">
              <span className="ph-pn">{zoom.tg_part_no ?? '–'}</span>
              <span style={{ margin: '0 8px', color: '#ccc' }}>·</span>
              <span>{zoom.part_name}</span>
              <span style={{ margin: '0 8px', color: '#ccc' }}>·</span>
              <span style={{ color: '#aaa', fontSize: 12 }}>Lv.{zoom.level}</span>
            </div>
          </div>
        </div>
      )}
    </div>
    
  )
}
