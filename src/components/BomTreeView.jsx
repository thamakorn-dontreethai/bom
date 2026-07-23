import { useState, useMemo } from 'react'

function parseKeyList(kc) {
  if (!kc) return []
  const s = String(kc).trim()
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) { const r = []; for (let k = +m[1]; k <= +m[2]; k++) r.push(k); return r }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n)).filter(n => !isNaN(n))
  const n = parseInt(s); return isNaN(n) ? [] : [n]
}

function buildTree(items) {
  const map = {}
  items.forEach(i => { map[i.id] = { ...i, children: [] } })
  const roots = []
  const root1 = items.find(i => i.level === 1)
  items.forEach(i => {
    if (i.status === 'revised_out') return
    if (i.parent_id && map[i.parent_id] && map[i.parent_id].status !== 'revised_out') {
      map[i.parent_id].children.push(map[i.id])
    } else if (root1 && i.id !== root1.id) {
      map[root1.id]?.children.push(map[i.id])
    } else { roots.push(map[i.id]) }
  })
  return roots
}

function collectParentIds(roots) {
  const ids = new Set()
  function walk(nodes) {
    nodes.forEach(n => { if (n.children.length > 0) { ids.add(n.id); walk(n.children) } })
  }
  walk(roots)
  return ids
}

const KEY_LABELS = {
  '1': 'Key 1 – NH-900L (N)', '2': 'Key 2 – NH-1168L (C)',
  '3': 'Key 3 – NH-900L (L)', '4': 'Key 4 – NH-1168L (R)',
}
const LV_COLORS = ['', '#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626']

function TreeNode({ node, depth, collapsed, onToggle, selected, onSelect }) {
  const lv = node.level ?? 1
  const hasKids = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const isSel = selected?.id === node.id
  return (
    <>
      <div
        className={`tree-item tree-item-lv${lv}${isSel ? ' selected' : ''}`}
        style={{ paddingLeft: 10 + depth * 22 }}
        onClick={() => onSelect(node)}
      >
        <span
          className={`tree-toggle${hasKids ? '' : ' tree-toggle--leaf'}`}
          onClick={hasKids ? e => { e.stopPropagation(); onToggle(node.id) } : undefined}
        >
          {hasKids ? (isCollapsed ? '▶' : '▼') : ''}
        </span>
        <span className="tree-lv-dot" style={{ background: LV_COLORS[lv] }} />
        <div className="tree-item-pn">{node.tg_part_no ?? '–'}</div>
        <div className="tree-item-name">{node.part_name}</div>
        <div className="tree-item-meta">
          Lv.{lv} · {node.quantity ?? 1} pc{node.quantity > 1 ? 's' : ''}
          {node.mass_g ? ` · ${Number(node.mass_g).toLocaleString()} g` : ''}
        </div>
      </div>
      {!isCollapsed && node.children.map(child => (
        <TreeNode key={child.id} node={child} depth={depth + 1}
          collapsed={collapsed} onToggle={onToggle}
          selected={selected} onSelect={onSelect} />
      ))}
    </>
  )
}

export default function BomTreeView({ bom }) {
  const [selectedKey, setSelectedKey] = useState(null)
  const [selectedPart, setSelectedPart] = useState(null)
  const [collapsed, setCollapsed] = useState(new Set())

  const items = bom?.items ?? []
  const allKeys = [...new Set(items.flatMap(i => parseKeyList(i.key_code)))]
    .sort((a, b) => a - b).map(String)
  const activeKey = selectedKey ?? allKeys[0] ?? '0'

  const pageItems = useMemo(() => items.filter(i => {
    const keys = parseKeyList(i.key_code)
    return keys.length === 0 || keys.map(String).includes(activeKey)
  }), [items, activeKey])

  const roots = useMemo(() => buildTree(pageItems), [pageItems])
  const totalParts = pageItems.filter(i => i.status !== 'revised_out').length
  const maxLevel = pageItems.length ? Math.max(...pageItems.map(i => i.level ?? 1)) : 1

  function toggleCollapse(id) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="tree-wrap">
      <div className="tree-hdr-grid">
        <div className="tree-hdr-cell"><div className="tree-hdr-label">Model</div><div className="tree-hdr-val">{bom?.model}</div></div>
        <div className="tree-hdr-cell"><div className="tree-hdr-label">Customer Part No.</div><div className="tree-hdr-val">{bom?.customer_part_no}</div></div>
        <div className="tree-hdr-cell"><div className="tree-hdr-label">TGT Part No.</div><div className="tree-hdr-val">{bom?.tg_part_no}</div></div>
        <div className="tree-hdr-cell"><div className="tree-hdr-label">ECI No.</div><div className="tree-hdr-val">{bom?.internal_eci_no}</div></div>
      </div>

      <div className="tree-stats-bar">
        <span className="tree-stat-item"><b>{totalParts}</b> Parts</span>
        <span className="tree-stat-item"><b>{maxLevel}</b> Levels</span>
        <div style={{ flex: 1 }} />
        <button className="tree-ctrl-btn" onClick={() => setCollapsed(new Set())}>ขยายทั้งหมด</button>
        <button className="tree-ctrl-btn" onClick={() => setCollapsed(collectParentIds(roots))}>ย่อทั้งหมด</button>
      </div>

      {allKeys.length > 0 && (
        <div className="tree-keys">
          {allKeys.map(k => (
            <button key={k} className={`tree-key-btn${activeKey === k ? ' active' : ''}`}
              onClick={() => { setSelectedKey(k); setSelectedPart(null) }}>
              {KEY_LABELS[k] ?? `Key ${k}`}
            </button>
          ))}
        </div>
      )}

      <div className="tree-list">
        {roots.map(root => (
          <TreeNode key={root.id} node={root} depth={0}
            collapsed={collapsed} onToggle={toggleCollapse}
            selected={selectedPart} onSelect={setSelectedPart} />
        ))}
      </div>

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
