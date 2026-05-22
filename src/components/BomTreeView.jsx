import { useState } from 'react'

function parseKeyList(kc) {
  if (!kc) return []
  const s = String(kc).trim()
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) { const r = []; for (let k = +m[1]; k <= +m[2]; k++) r.push(k); return r }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n)).filter(n => !isNaN(n))
  const n = parseInt(s); return isNaN(n) ? [] : [n]
}

function buildFlat(items) {
  const map = {}; items.forEach(i => { map[i.id] = { ...i, children: [] } })
  const roots = []; const root1 = items.find(i => i.level === 1)
  items.forEach(i => {
    if (i.status === 'revised_out') return
    if (i.parent_id && map[i.parent_id] && map[i.parent_id].status !== 'revised_out') {
      map[i.parent_id].children.push(map[i.id])
    } else if (root1 && i.id !== root1.id) {
      map[root1.id]?.children.push(map[i.id])
    } else { roots.push(map[i.id]) }
  })
  const flat = []
  function dfs(node) { flat.push(node); node.children.forEach(dfs) }
  roots.forEach(dfs)
  return flat
}

const KEY_LABELS = {
  '1': 'Key 1 – NH-900L (N)', '2': 'Key 2 – NH-1168L (C)',
  '3': 'Key 3 – NH-900L (L)', '4': 'Key 4 – NH-1168L (R)',
}

export default function BomTreeView({ bom }) {
  const [selectedKey, setSelectedKey] = useState(null)
  const [selectedPart, setSelectedPart] = useState(null)

  const items = bom?.items ?? []
  const allKeys = [...new Set(items.flatMap(i => parseKeyList(i.key_code)))]
    .sort((a, b) => a - b).map(String)

  const activeKey = selectedKey ?? allKeys[0] ?? '0'

  const pageItems = items.filter(i => {
    const keys = parseKeyList(i.key_code)
    return keys.length === 0 || keys.map(String).includes(activeKey)
  })
  const flat = buildFlat(pageItems)

  return (
    <div className="tree-wrap">
      {/* header info */}
      <div className="tree-hdr-grid">
        <div className="tree-hdr-cell"><div className="tree-hdr-label">Model</div><div className="tree-hdr-val">{bom?.model}</div></div>
        <div className="tree-hdr-cell"><div className="tree-hdr-label">Customer Part No.</div><div className="tree-hdr-val">{bom?.customer_part_no}</div></div>
        <div className="tree-hdr-cell"><div className="tree-hdr-label">TGT Part No.</div><div className="tree-hdr-val">{bom?.tg_part_no}</div></div>
        <div className="tree-hdr-cell"><div className="tree-hdr-label">ECI No.</div><div className="tree-hdr-val">{bom?.internal_eci_no}</div></div>
      </div>

      {/* key tabs */}
      {allKeys.length > 0 && (
        <div className="tree-keys">
          {allKeys.map(k => (
            <button key={k} className={`tree-key-btn${activeKey === k ? ' active' : ''}`} onClick={() => { setSelectedKey(k); setSelectedPart(null) }}>
              {KEY_LABELS[k] ?? `Key ${k}`}
            </button>
          ))}
        </div>
      )}

      {/* tree list */}
      <div className="tree-list">
        {flat.map(row => {
          const lv = row.level ?? 1
          const isSel = selectedPart?.id === row.id
          return (
            <div
              key={row.id}
              className={`tree-item tree-item-lv${lv}${isSel ? ' selected' : ''}`}
              onClick={() => setSelectedPart(row)}
              style={{ paddingLeft: 8 + (lv - 1) * 18 }}
            >
              <div className="tree-item-pn">{row.tg_part_no}</div>
              <div className="tree-item-name">{row.part_name}</div>
              <div className="tree-item-meta">Lv.{lv} · {row.quantity ?? 1} pc{row.quantity > 1 ? 's' : ''}{row.mass_g ? ` · ${Number(row.mass_g).toLocaleString()} g` : ''}</div>
            </div>
          )
        })}
      </div>

      {/* detail panel */}
      {selectedPart && (
        <div className="tree-detail">
          <div className="tree-detail-title">รายละเอียด Part ที่เลือก</div>
          {[
            ['TG Part No.', selectedPart.tg_part_no],
            ['Customer Part No.', selectedPart.customer_part_no],
            ['Part Name', selectedPart.part_name],
            ['Level', selectedPart.level],
            ['Quantity', selectedPart.quantity],
            ['Mass', selectedPart.mass_g ? `${Number(selectedPart.mass_g).toLocaleString()} g` : '–'],
            ['Level Code', selectedPart.level_code],
            ['Product Std.', selectedPart.product_standards || '–'],
            ['Material Std.', selectedPart.material_standards || '–'],
            ['Note', selectedPart.note || '–'],
          ].map(([k, v]) => (
            <div key={k} className="tree-detail-row">
              <span className="tree-detail-key">{k}</span>
              <span className="tree-detail-val">{v ?? '–'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
