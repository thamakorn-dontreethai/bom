import ExcelJS from 'exceljs'

/* ── helpers (mirrors BomDocumentView logic) ── */
function findActiveReplacement(revisedOut, items) {
  let current = revisedOut
  while (current && current.status === 'revised_out') {
    current = items.find(r =>
      r.sort_order === current.sort_order + 1 &&
      r.parent_id === current.parent_id
    ) ?? null
  }
  return current
}
function buildTree(items) {
  const map = {}
  items.forEach(i => { map[i.id] = { ...i, children: [] } })
  const finalRepOf = {}
  items.forEach(it => {
    if (it.status === 'revised_out' && it.sort_order != null) {
      const rep = findActiveReplacement(it, items)
      if (rep) finalRepOf[it.id] = rep
    }
  })
  const rootItem = items.find(i => (i.level ?? i.bom_level) === 1 && i.status !== 'revised_out')
  const roots = []
  items.forEach(i => {
    if (i.status === 'revised_out') return
    let parentId = i.parent_id
    if (parentId && map[parentId] && map[parentId].status === 'revised_out') {
      const rep = finalRepOf[parentId]
      parentId = rep ? rep.id : null
    }
    if (parentId && map[parentId]) { map[parentId].children.push(map[i.id]) }
    else if (rootItem && map[rootItem.id] && i.id !== rootItem.id) { map[rootItem.id].children.push(map[i.id]) }
    else { roots.push(map[i.id]) }
  })
  return roots
}
function flatten(nodes) {
  const out = []
  for (const n of nodes) { out.push(n); if (n.children?.length) out.push(...flatten(n.children)) }
  return out
}
function insertRevisedOut(flatRows, allItems) {
  function followChain(start) {
    const chain = []
    let current = start
    while (current && current.status === 'revised_out') {
      chain.push(current)
      current = allItems.find(r =>
        r.sort_order === current.sort_order + 1 &&
        r.parent_id === current.parent_id
      ) ?? null
    }
    return { chain, finalRep: current }
  }
  const insertBefore = {}
  const processedIds = new Set()
  allItems.forEach(it => {
    if (it.status !== 'revised_out' || processedIds.has(it.id) || it.sort_order == null) return
    const hasPrev = allItems.some(r =>
      r.status === 'revised_out' &&
      r.sort_order === it.sort_order - 1 &&
      r.parent_id === it.parent_id
    )
    if (hasPrev) return
    const { chain, finalRep } = followChain(it)
    chain.forEach(c => processedIds.add(c.id))
    if (finalRep) {
      if (!insertBefore[finalRep.id]) insertBefore[finalRep.id] = []
      insertBefore[finalRep.id].push(...chain)
    }
  })
  const result = []
  const placed = new Set()
  for (const row of flatRows) {
    if (row?.id != null && insertBefore[row.id]) {
      for (const ro of insertBefore[row.id]) { result.push(ro); placed.add(ro.id) }
    }
    result.push(row)
  }
  allItems.forEach(it => { if (it.status === 'revised_out' && !placed.has(it.id)) result.push(it) })
  return result
}

/* ── border helpers ── */
const T = { style: 'thin', color: { argb: 'FF333333' } }
const BORDER_ALL = { top: T, left: T, bottom: T, right: T }

function cell(ws, r, c) { return ws.getCell(r, c) }

function setCell(ws, r, c, value, opts = {}) {
  const cl = ws.getCell(r, c)
  cl.value = value ?? null
  if (opts.bold)          cl.font = { ...(cl.font ?? {}), bold: true, size: opts.size ?? 8, name: 'Arial' }
  else                    cl.font = { size: opts.size ?? 8, name: 'Arial', ...(opts.font ?? {}) }
  if (opts.strike)        cl.font = { ...cl.font, strike: true, color: { argb: 'FFCC0000' } }
  if (opts.border)        cl.border = opts.border
  if (opts.fill)          cl.fill = opts.fill
  if (opts.align)         cl.alignment = opts.align
  return cl
}

function merge(ws, r1, c1, r2, c2) {
  ws.mergeCells(r1, c1, r2, c2)
}

/* ── column widths
     A3 landscape usable width ≈ 390mm ≈ 1480pt
     Total original px: 85×5+160+260+30+26+26+54+26×5+24×4+26+30+30+28+36 = 1357px
     Scale to fit A3: multiply by ~1.05 then convert px→Excel chars (÷7.5)
── */
const COL_PX = [85,85,85,85,85, 160,260, 30,26,26,54, 26,26,26,26,26, 24,24,24,24, 26,30,30,28,36]
const SCALE   = 1.05
const PX2CH   = 7.5

/* ── main export function ── */
export async function exportBomToExcel(bom) {
  const items = bom.items ?? []
  const tree  = buildTree(items)
  const flat  = flatten(tree)
  const rows  = insertRevisedOut(flat, items)

  const revisions = bom.revisions?.length > 0
    ? bom.revisions
    : [{ mark: '–', revision_record: '', eci_no: bom.internal_eci_no, revision_date: bom.date }]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'BOM System'
  const ws = wb.addWorksheet('BOM', {
    pageSetup: {
      paperSize:   8,          // A3
      orientation: 'landscape',
      fitToPage:   true,
      fitToWidth:  1,
      fitToHeight: 0,
      horizontalCentered: false,
    },
    headerFooter: {},
  })

  // Narrow margins (cm → inches: /2.54)
  ws.pageSetup.margins = {
    left: 0.25, right: 0.25,
    top:  0.5,  bottom: 0.5,
    header: 0,  footer: 0,
  }

  // Set column widths scaled for A3
  ws.columns = COL_PX.map((px, i) => ({
    key:   `c${i+1}`,
    width: Math.max((px * SCALE) / PX2CH, 3),
  }))

  let R = 1 // current row counter

  /* ════════════════════════════════════════════
     BLOCK 1 — Document header (4 rows)
     ════════════════════════════════════════════ */


  // Row 1: BILL OF MATERIAL title
  merge(ws, R, 1, R, 5);  setCell(ws, R, 1, 'Event Issue / Concern With', { bold: true, size: 7, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' } })
  merge(ws, R, 6, R, 15); setCell(ws, R, 6, 'BILL OF MATERIAL',           { bold: true, size: 14, align: { horizontal: 'center', vertical: 'middle' }, border: BORDER_ALL })
  merge(ws, R, 16, R+3, 25)
  setCell(ws, R, 16, 'Approval Signatures', { bold: true, size: 7, align: { horizontal: 'center', vertical: 'middle' }, border: BORDER_ALL })
  ws.getRow(R).height = 22
  R++

  // Row 2: Type | Customer Part No.
  merge(ws, R, 1, R, 3);  setCell(ws, R, 1, `Type : ${bom.type ?? 'HE'}`, { bold: true, size: 8, border: BORDER_ALL })
  merge(ws, R, 4, R, 6);  setCell(ws, R, 4, `Customer Part No. : ${bom.customer_part_no ?? ''}`, { bold: true, size: 8, border: BORDER_ALL })
  merge(ws, R, 7, R, 15); cell(ws, R, 7).border = BORDER_ALL
  R++

  // Row 3: Model No. | TGT Part No. | Customer Name | Date
  merge(ws, R, 1, R, 3);  setCell(ws, R, 1, `Model No. : ${bom.model ?? ''}`, { bold: true, size: 8, border: BORDER_ALL })
  merge(ws, R, 4, R, 6);  setCell(ws, R, 4, `TGT Part No. : ${bom.tg_part_no ?? ''}`, { bold: true, size: 8, border: BORDER_ALL })
  merge(ws, R, 7, R+1, 7);  setCell(ws, R, 7, 'Customer Name :', { size: 7, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' } })
  merge(ws, R, 8, R+1, 10); setCell(ws, R, 8, bom.customer_name ?? bom.customer ?? '', { bold: true, size: 8, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' } })
  merge(ws, R, 11, R+1, 11); setCell(ws, R, 11, 'Date :', { size: 7, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' } })
  merge(ws, R, 12, R+1, 15); setCell(ws, R, 12, bom.date ?? '', { bold: true, size: 8, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' } })
  R++

  // Row 4: Model Name | Part Name
  merge(ws, R, 1, R, 3); setCell(ws, R, 1, `Model Name : ${bom.model_name ?? ''}`, { bold: true, size: 8, border: BORDER_ALL })
  merge(ws, R, 4, R, 6); setCell(ws, R, 4, `Part Name : ${bom.part_name ?? ''}`,   { bold: true, size: 8, border: BORDER_ALL })
  R++

  /* ════════════════════════════════════════════
     BLOCK 2 — BOM table headers (2 rows)
     ════════════════════════════════════════════ */
  const TH_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  const thOpts  = { bold: true, size: 7, border: BORDER_ALL, fill: TH_FILL, align: { horizontal: 'center', vertical: 'middle', wrapText: true } }

  // Header row 1
  merge(ws, R, 1, R, 5);     setCell(ws, R, 1,  'Part No.',                     thOpts)
  merge(ws, R+1, 1, R+1, 1); // level 1 sub-header
  merge(ws, R, 6, R+1, 6);   setCell(ws, R, 6,  'Part name',                    thOpts)
  merge(ws, R, 7, R+1, 7);   setCell(ws, R, 7,  'Material\nSpec',               thOpts)
  merge(ws, R, 8, R+1, 8);   setCell(ws, R, 8,  "Q'ty\n(pcs.)",                 thOpts)
  merge(ws, R, 9, R, 10);    setCell(ws, R, 9,  'Weight\n(g./pc.)',              thOpts)
  merge(ws, R, 11, R+1, 11); setCell(ws, R, 11, 'Price/pcs,\nkgs (baht)',        thOpts)
  merge(ws, R, 12, R, 16);   setCell(ws, R, 12, 'Material cost/unit (baht)',     thOpts)
  merge(ws, R, 17, R, 20);   setCell(ws, R, 17, 'Supplier',                      thOpts)
  merge(ws, R, 21, R+1, 21); setCell(ws, R, 21, 'Recie-\nver',                  thOpts)
  merge(ws, R, 22, R+1, 22); setCell(ws, R, 22, 'Internal\nCode',               thOpts)
  merge(ws, R, 23, R+1, 23); setCell(ws, R, 23, "Q'ty/\nkanban",                thOpts)
  merge(ws, R, 24, R+1, 24); setCell(ws, R, 24, 'Lead\ntime\n(day)',             thOpts)
  merge(ws, R, 25, R+1, 25); setCell(ws, R, 25, 'Remark',                       thOpts)
  ws.getRow(R).height = 22
  R++

  // Header row 2 — sub-headers
  for (let n = 1; n <= 5; n++) setCell(ws, R, n, String(n), thOpts)
  setCell(ws, R, 9,  'Part', thOpts)
  setCell(ws, R, 10, 'Gate', thOpts)
  for (let n = 1; n <= 5; n++) setCell(ws, R, 11+n, String(n), thOpts)
  ;['M/C','T/T','Local','Import'].forEach((s,i) => setCell(ws, R, 17+i, s, thOpts))
  ws.getRow(R).height = 12
  R++

  /* ════════════════════════════════════════════
     BLOCK 2 — BOM item rows
     ════════════════════════════════════════════ */
  const itemBaseFont = { size: 7, name: 'Arial' }

  rows.forEach(row => {
    const lv = row.level ?? 1
    const isOut = row.status === 'revised_out'
    const updateLevel = row.update_level ?? 0
    const displayLevel = isOut ? updateLevel - 1 : updateLevel
    const tri = displayLevel > 0 ? `△${displayLevel} ` : ''

    // Part No. in correct level column
    const pnText = tri + (row.tg_part_no ?? '')
    const rowFont = isOut
      ? { size: 7, name: 'Arial', strike: true, color: { argb: 'FFCC0000' } }
      : itemBaseFont

    const exRow = ws.getRow(R)
    exRow.height = 11

    // Clear all 25 cells first with border
    for (let c = 1; c <= 25; c++) {
      const cl = ws.getCell(R, c)
      cl.border = BORDER_ALL
      cl.font   = rowFont
      cl.alignment = { vertical: 'middle', wrapText: false }
    }

    // Level column for Part No.
    ws.getCell(R, lv).value = pnText
    ws.getCell(R, lv).alignment = { vertical: 'middle', horizontal: 'left' }

    ws.getCell(R, 6).value  = row.part_name ?? ''
    ws.getCell(R, 7).value  = row.material_standards ?? ''
    ws.getCell(R, 8).value  = row.quantity ?? ''
    ws.getCell(R, 9).value  = row.mass_g != null ? Number(row.mass_g) : ''
    ws.getCell(R, 25).value = row.note ?? ''

    ws.getCell(R, 8).alignment  = { vertical: 'middle', horizontal: 'center' }
    ws.getCell(R, 9).alignment  = { vertical: 'middle', horizontal: 'center' }
    ws.getCell(R, 10).alignment = { vertical: 'middle', horizontal: 'center' }

    R++
  })

  /* ── A/B/C marks row ── */
  const markGroups = [
    [1,5,'A'],[6,6,'A'],[7,7,'A'],[8,9,'A'],[10,11,'C'],
    [12,16,'C'],[17,20,'C'],[21,21,'B'],[22,22,'B'],[23,23,'B'],[24,25,'C']
  ]
  const markOpts = { bold: true, size: 7, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' }, fill: TH_FILL }
  markGroups.forEach(([c1,c2,lbl]) => {
    if (c1 !== c2) merge(ws, R, c1, R, c2)
    setCell(ws, R, c1, lbl, markOpts)
  })
  ws.getRow(R).height = 10
  R++

  /* ════════════════════════════════════════════
     BLOCK 3 — Footer: spacer row + revision headers
     ════════════════════════════════════════════ */
  R++ // spacer gap

  // Revision header row
  const revHdrOpts = { bold: true, size: 7, border: BORDER_ALL, fill: TH_FILL, align: { horizontal: 'center', vertical: 'middle' } }
  merge(ws, R, 7, R, 7);   setCell(ws, R, 7,  'Mark',            revHdrOpts)
  merge(ws, R, 8, R, 17);  setCell(ws, R, 8,  'Revision record', revHdrOpts)
  merge(ws, R, 18, R, 19); setCell(ws, R, 18, 'ECI No.',         revHdrOpts)
  merge(ws, R, 20, R, 21); setCell(ws, R, 20, 'Date',            revHdrOpts)
  merge(ws, R, 22, R, 23); setCell(ws, R, 22, 'Revisioner',      revHdrOpts)
  merge(ws, R, 24, R, 25); setCell(ws, R, 24, 'Approved',        revHdrOpts)
  ws.getRow(R).height = 12
  R++

  // Note cell (spans all revision data+empty rows)
  const emptyCount  = Math.max(0, 6 - revisions.length)
  const noteRowSpan = revisions.length + emptyCount
  merge(ws, R, 1, R + noteRowSpan - 1, 6)
  const noteCell = ws.getCell(R, 1)
  noteCell.value = "Note :\n'A' = Record by Engineering section  Update ECI No.\n'B' = Record by Part Control section\n'C' = Record by Purchase section"
  noteCell.font  = { size: 7, name: 'Arial' }
  noteCell.alignment = { vertical: 'top', wrapText: true }
  noteCell.border = BORDER_ALL

  // Revision data rows
  revisions.forEach((rev) => {
    const isFirst = !rev.mark || rev.mark === '–' || rev.mark === '-'
    const markText = isFirst ? '△' : `△${rev.mark}`
    const revOpts = { size: 7, border: BORDER_ALL, align: { horizontal: 'center', vertical: 'middle' } }

    merge(ws, R, 7, R, 7);   setCell(ws, R, 7,  markText,              revOpts)
    merge(ws, R, 8, R, 17);  setCell(ws, R, 8,  rev.revision_record ?? '', { size: 7, border: BORDER_ALL, align: { vertical: 'middle' } })
    merge(ws, R, 18, R, 19); setCell(ws, R, 18, rev.eci_no ?? '',          revOpts)
    merge(ws, R, 20, R, 21); setCell(ws, R, 20, rev.revision_date ?? '',   revOpts)
    merge(ws, R, 22, R, 23); setCell(ws, R, 22, rev.revisioner ?? '',      revOpts)
    merge(ws, R, 24, R, 25); setCell(ws, R, 24, rev.approved_by ?? '',     revOpts)
    ws.getRow(R).height = 12
    R++
  })

  // Empty revision rows
  for (let i = 0; i < emptyCount; i++) {
    merge(ws, R, 7, R, 7);   ws.getCell(R, 7).border  = BORDER_ALL
    merge(ws, R, 8, R, 17);  ws.getCell(R, 8).border  = BORDER_ALL
    merge(ws, R, 18, R, 19); ws.getCell(R, 18).border = BORDER_ALL
    merge(ws, R, 20, R, 21); ws.getCell(R, 20).border = BORDER_ALL
    merge(ws, R, 22, R, 23); ws.getCell(R, 22).border = BORDER_ALL
    merge(ws, R, 24, R, 25); ws.getCell(R, 24).border = BORDER_ALL
    ws.getRow(R).height = 12
    R++
  }

  // Route row
  merge(ws, R, 7, R, 25)
  setCell(ws, R, 7, 'ROUTE : Production Eng. → (Before OTS = 2 months or 1 week after each event) → Purchase → 1 week → Plant Admin. → 1 week → Production Eng. (Keep)', {
    size: 7, border: BORDER_ALL, align: { horizontal: 'left', vertical: 'middle' }
  })
  ws.getRow(R).height = 12

  /* ── download ── */
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `BOM_${bom.tg_part_no ?? bom.id}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
