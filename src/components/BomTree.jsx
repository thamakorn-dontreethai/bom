import { useState } from 'react'

function buildTree(items) {
  const map = {}
  items.forEach(item => { map[item.id] = { ...item, children: [] } })
  const roots = []
  items.forEach(item => {
    if (item.parent_id && map[item.parent_id]) {
      map[item.parent_id].children.push(map[item.id])
    } else {
      roots.push(map[item.id])
    }
  })
  return roots
}

function flattenVisible(nodes, collapsed, depth = 0) {
  const rows = []
  for (const node of nodes) {
    rows.push({ ...node, depth })
    if (!collapsed.has(node.id) && node.children.length > 0) {
      rows.push(...flattenVisible(node.children, collapsed, depth + 1))
    }
  }
  return rows
}

const COLS = [
  { key: 'key_code',           label: 'Key',                width: 38 },
  { key: 'level',              label: 'Lv',                 width: 30 },
  { key: 'level_code',         label: 'PP-Mold',            width: 60 },
  { key: 'rc',                 label: 'R/C',                width: 36 },
  { key: 'customer_part_no',   label: 'Customer Part No.',  width: 140 },
  { key: 'tg_part_no',         label: 'TG Part No.',        width: 130 },
  { key: 'soc',                label: 'SOC',                width: 38 },
  { key: 'quantity',           label: 'Qty',                width: 36 },
  { key: 'mass_g',             label: 'Mass (g)',           width: 66 },
  { key: 'part_name',          label: 'Part Name',          width: 220 },
  { key: 'product_standards',  label: 'Prod. Std',          width: 80 },
  { key: 'material_standards', label: 'Mat. Std',           width: 80 },
  { key: 'use_portion',        label: 'Use',                width: 36 },
  { key: 'material_no',        label: 'Material No.',       width: 120 },
  { key: 'instruction_no',     label: 'Instruction No.',    width: 110 },
  { key: 'material_trade_name',label: 'Material/Trade Name',width: 160 },
  { key: 'material_type',      label: 'Mat. Type',          width: 80 },
  { key: 'color_no',           label: 'Color No.',          width: 90 },
  { key: 'color_tone',         label: 'Color Tone',         width: 120 },
  { key: 'material_mass',      label: 'Mat. Mass',          width: 70 },
  { key: 'sa',                 label: 'SA',                 width: 80 },
  { key: 'note',               label: 'Note',               width: 300 },
]

function Cell({ col, row, onToggle, collapsed }) {
  const val = row[col.key]

  if (col.key === 'part_name') {
    const hasChildren = row.children.length > 0
    return (
      <td className="part-name-cell" style={{ minWidth: col.width }}>
        <span
          className="part-name-indent"
          style={{ paddingLeft: row.depth * 16 }}
        >
          {hasChildren ? (
            <button className="toggle-btn" onClick={() => onToggle(row.id)}>
              {collapsed.has(row.id) ? '▶' : '▼'}
            </button>
          ) : (
            <span className="toggle-placeholder" />
          )}
          {val}
        </span>
      </td>
    )
  }

  if (col.key === 'soc' && val) {
    return <td style={{ minWidth: col.width }}><span className="soc-badge">{val}</span></td>
  }

  return (
    <td style={{ minWidth: col.width }}>
      {val !== null && val !== undefined ? String(val) : ''}
    </td>
  )
}

function BomTree({ bom }) {
  const [collapsed, setCollapsed] = useState(new Set())

  const tree = buildTree(bom.items ?? [])
  const rows = flattenVisible(tree, collapsed)

  function toggle(id) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="bom-tree">
      <div className="bom-tree__title">By Part Number — {bom.items?.length ?? 0} items</div>
      <div className="bom-tree__scroll">
        <table className="bom-table">
          <thead>
            <tr>
              {COLS.map(col => (
                <th key={col.key} style={{ minWidth: col.width }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.id}
                className={[
                  row.level === 1 ? 'row--lv1' : '',
                  row.key_code === '2' ? 'row--key2' : 'row--key1',
                ].filter(Boolean).join(' ')}
              >
                {COLS.map(col => (
                  <Cell
                    key={col.key}
                    col={col}
                    row={row}
                    onToggle={toggle}
                    collapsed={collapsed}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default BomTree
