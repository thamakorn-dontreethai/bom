function parseKeyList(kc) {
  if (!kc) return []
  const s = String(kc).trim()
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) { const r = []; for (let k = +m[1]; k <= +m[2]; k++) r.push(k); return r }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n)).filter(n => !isNaN(n))
  const n = parseInt(s); return isNaN(n) ? [] : [n]
}

export default function BomExport({ bom }) {
  const items = (bom?.items ?? []).filter(i => i.status !== 'revised_out' && i.tg_part_no)
  const allKeys = [...new Set(items.flatMap(i => parseKeyList(i.key_code)))].sort((a, b) => a - b).map(String)

  function downloadCSV(key) {
    const rows = key === 'all'
      ? items
      : items.filter(i => { const ks = parseKeyList(i.key_code); return ks.length === 0 || ks.map(String).includes(key) })

    const headers = ['Level', 'TG Part No.', 'Customer Part No.', 'Part Name', 'Qty', 'Mass(g)', 'Level Code', 'Note']
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.level, r.tg_part_no, r.customer_part_no ?? '', r.part_name ?? '',
        r.quantity, r.mass_g ?? '', r.level_code ?? '', (r.note ?? '').replace(/,/g, ';'),
      ].join(','))
    ]
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `BOM_${bom?.tg_part_no ?? bom?.id}${key !== 'all' ? `_Key${key}` : ''}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="exp-wrap">
      {/* BOM header preview */}
      <div className="exp-preview-hdr">
        {[
          ['Model No.', bom?.model],
          ['Customer Part No.', bom?.customer_part_no],
          ['TGT Part No.', bom?.tg_part_no],
          ['Date', bom?.date],
          ['Type', bom?.type],
          ['Customer', bom?.customer_name ?? bom?.customer],
          ['ECI No.', bom?.internal_eci_no],
          ['Part Name', bom?.part_name],
        ].map(([k, v]) => (
          <div key={k} className="exp-hdr-cell">
            <div className="exp-hdr-label">{k}</div>
            <div className="exp-hdr-val">{v ?? '–'}</div>
          </div>
        ))}
      </div>

      {/* export buttons */}
      <div className="exp-section-title">Export ข้อมูล</div>
      <div className="exp-btn-grid">
        <div className="exp-btn-card" onClick={() => downloadCSV('all')}>
          <div className="exp-btn-icon">📊</div>
          <div className="exp-btn-label">Export CSV (ทั้งหมด)</div>
          <div className="exp-btn-sub">รวมทุก Key · {items.length} parts</div>
        </div>
        {allKeys.map(k => (
          <div key={k} className="exp-btn-card" onClick={() => downloadCSV(k)}>
            <div className="exp-btn-icon">📋</div>
            <div className="exp-btn-label">Export CSV — Key {k}</div>
            <div className="exp-btn-sub">{items.filter(i => { const ks = parseKeyList(i.key_code); return ks.length === 0 || ks.map(String).includes(k) }).length} parts</div>
          </div>
        ))}
      </div>

      {/* preview table */}
      <div className="exp-section-title" style={{ marginTop: 20 }}>Preview (10 รายการแรก)</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="comp-tbl">
          <thead>
            <tr>
              <th>Lv</th>
              {[1,2,3,4,5].map(n => <th key={n}>Lv{n} Part No.</th>)}
              <th>Part Name</th>
              <th>Q'ty</th>
              <th>Mass (g)</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 10).map(row => (
              <tr key={row.id} className={`comp-row comp-lv${row.level ?? 1}`}>
                <td className="comp-td-c">{row.level}</td>
                {[1,2,3,4,5].map(n => (
                  <td key={n} className="comp-td-pn" style={{ fontSize: 10 }}>
                    {n === row.level ? row.tg_part_no : ''}
                  </td>
                ))}
                <td>{row.part_name}</td>
                <td className="comp-td-c">{row.quantity}</td>
                <td className="comp-td-c">{row.mass_g ? Number(row.mass_g).toLocaleString() : '–'}</td>
                <td style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{row.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 10 && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>... และอีก {items.length - 10} รายการ</div>}
    </div>
  )
}
