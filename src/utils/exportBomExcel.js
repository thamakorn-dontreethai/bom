import ExcelJS from 'exceljs'

/* ── row ordering — IDENTICAL to BomDocumentView so the export matches the
     system exactly (the old buildTree/flatten approach dropped items). ── */

// Active rows in stored document order; indentation comes from each row's `level`.
function orderRows(items) {
  return items
    .filter(it => it.status !== 'revised_out')
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

// Place each revised_out item before its final active successor; inject a
// synthetic _custPnOnly header for Level-1 items that carry a customer_part_no.
function insertRevisedOut(flatRows, allItems) {
  const insertBefore = {}
  allItems.forEach(it => {
    if (it.status !== 'revised_out' || it.sort_order == null) return
    let finalActive = allItems
      .filter(r => r.sort_order > it.sort_order && r.parent_id === it.parent_id && r.key_code === it.key_code)
      .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
    while (finalActive && finalActive.status === 'revised_out') {
      finalActive = allItems
        .filter(r => r.sort_order > finalActive.sort_order && r.parent_id === finalActive.parent_id && r.key_code === finalActive.key_code)
        .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
    }
    if (finalActive) {
      if (!insertBefore[finalActive.id]) insertBefore[finalActive.id] = []
      insertBefore[finalActive.id].push(it)
    }
  })
  Object.values(insertBefore).forEach(arr => arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))

  const result = []
  const placed = new Set()
  for (const row of flatRows) {
    if (row?.id != null && insertBefore[row.id]) {
      const lv = row.level ?? row.bom_level ?? 1
      const hasCust = lv === 1 && !!row.customer_part_no && row.status !== 'revised_out'
      if (hasCust) result.push({ ...row, _custPnOnly: true })
      for (const ro of insertBefore[row.id]) { result.push(ro); placed.add(ro.id) }
      result.push(hasCust ? { ...row, _skipCustPn: true } : row)
    } else {
      result.push(row)
    }
  }
  allItems.forEach(it => {
    if (it.status !== 'revised_out' || placed.has(it.id)) return
    result.push(it)
  })
  return result
}

/* ── key list parser ── */
function parseKeyList(keyCode) {
  if (!keyCode) return []
  const s = String(keyCode).trim()
  const range = s.match(/^(\d+)-(\d+)$/)
  if (range) {
    const start = parseInt(range[1]), end = parseInt(range[2])
    const out = []
    for (let k = start; k <= end; k++) out.push(k)
    return out
  }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n))
  const n = parseInt(s)
  return isNaN(n) ? [] : [n]
}

// Page rows by variant key (same BFS as the document view): each key's page =
// its own items + the null-key sub-parts reachable from them.
function groupByKey(items) {
  const keyed = {}
  const shared = []
  const allKeys = new Set()
  items.forEach(it => {
    const keys = parseKeyList(it.key_code)
    if (keys.length === 0) shared.push(it)
    else keys.forEach(k => { const ks = String(k); allKeys.add(ks); if (!keyed[ks]) keyed[ks] = []; keyed[ks].push(it) })
  })
  const sortedKeys = [...allKeys].sort((a, b) => Number(a) - Number(b))
  if (!sortedKeys.length) {
    const pageItems = [...shared]
    return [{ key: '0', rows: insertRevisedOut(orderRows(pageItems), pageItems) }]
  }
  return sortedKeys.map(k => {
    const seed = new Set(keyed[k].map(it => it.id))
    let changed = true
    while (changed) {
      changed = false
      for (const it of shared) {
        if (!seed.has(it.id) && it.parent_id != null && seed.has(it.parent_id)) { seed.add(it.id); changed = true }
      }
    }
    const pageItems = [...keyed[k], ...shared.filter(it => seed.has(it.id))]
    return { key: k, rows: insertRevisedOut(orderRows(pageItems), pageItems) }
  })
}

/* ── spec builder (same logic as BomDocumentView) ── */
function buildSpec(row) {
  const ok = v => v && String(v).trim() && String(v).trim().toUpperCase() !== 'NO'
  return [
    ok(row.note)               ? String(row.note).trim()               : null,
    ok(row.product_standards)  ? String(row.product_standards).trim()  : null,
    ok(row.material_standards) ? String(row.material_standards).trim() : null,
  ].filter(Boolean).join('  ')
}

/* ════════════════════════════════════════════════════════════════════════
   Template-based export — load the real BOM .xlsx and inject data into it.
   Layout of each template (column numbers, meta cells, data area, revision
   block) was captured directly from the production files in /public/templates.
   ════════════════════════════════════════════════════════════════════════ */
const setV = (ws, addr, val) => { ws.getCell(addr).value = val ?? null }

const HE_CFG = {
  file: 'templates/bom-he.xlsx',
  font: { name: 'Tahoma', size: 11 },
  levelCol: { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 },   // B, C(:D), E, F, G
  maxLv: 5,
  partNoAlign: 'left',
  rowMerges: [[3, 4], [8, 11]],                   // C:D (Lv2), H:K (Part name)
  partName: 8,                                    // H (:K)
  spec: 12, qty: 13, wPart: 14, wGate: 15, price: 16,
  mcost: 17,                                      // Q..U
  sup: 22,                                        // V..Y
  recv: 26, icode: 27, kanban: 28, lead: 29, remark: 30,
  fieldCols: [2, 3, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  dataStart: 11, dataEnd: 72,
  writeMeta(ws, bom) {
    setV(ws, 'D6', bom.type ?? 'HE')
    setV(ws, 'G6', `: ${bom.customer_part_no ?? ''}`)
    setV(ws, 'D7', bom.model ?? '')
    setV(ws, 'G7', `: ${bom.tg_part_no ?? ''}`)
    setV(ws, 'M7', bom.customer_name ?? bom.customer ?? '')
    setV(ws, 'Q7', bom.date ?? '')
    setV(ws, 'D8', bom.model_name ?? '')
    setV(ws, 'G8', `: ${bom.part_name ?? ''}`)
  },
  rev: { start: 76, max: 7, mark: 12, rec: 13, eci: 23, date: 25, rsnr: 27, appr: 29 },
}

const BAG_CFG = {
  file: 'templates/bom-bag.xlsx',
  font: { name: 'Tahoma', size: 8 },
  levelCol: { 1: 1, 2: 2, 3: 4, 4: 5, 5: 6, 6: 8 },   // A, B(:C), D, E, F(:G), H
  maxLv: 6,
  partNoAlign: 'center',
  rowMerges: [[2, 3], [6, 7], [9, 10]],                // B:C (Lv2), F:G (Lv5), I:J (Part name)
  partName: 9,                                          // I (:J)
  spec: 11, qty: 12, wPart: 13, wGate: 14, price: 15,
  mcost: 16,                                            // P..T
  sup: 21,                                              // U..X
  recv: 25, icode: 26, kanban: 27, lead: 28, remark: 29,
  fieldCols: [1, 2, 4, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
  dataStart: 11, dataEnd: 119,
  writeMeta(ws, bom) {
    setV(ws, 'C7', bom.model ?? '')
    setV(ws, 'G7', bom.tg_part_no ?? '')
    setV(ws, 'L7', bom.customer_name ?? bom.customer ?? '')
    setV(ws, 'P7', bom.date ?? '')
    setV(ws, 'C8', bom.model_name ?? '')
    setV(ws, 'G8', bom.part_name ?? '')
  },
  rev: { start: 165, max: 7, mark: 11, rec: 12, eci: 22, date: 24, rsnr: 26, appr: 28 },
}

/* ── fill ONE worksheet (one variant key) from the loaded template ── */
function fillSheet(ws, cfg, bom, page, usedNames) {
  const rows = (page?.rows ?? []).filter(Boolean)

  // Header TGT/FG Part No + Part name are PER-KEY (the page's Level-1 item).
  const pageLv1 = rows.find(r => r && (r.level ?? r.bom_level) === 1 && r.status !== 'revised_out' && !r._custPnOnly)
  const meta = {
    ...bom,
    tg_part_no: pageLv1?.tg_part_no ?? bom.tg_part_no,
    part_name:  pageLv1?.part_name  ?? bom.part_name,
  }

  // Unique sheet name from the key's part number.
  const base = String(meta.tg_part_no ?? 'BOM').replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'BOM'
  let name = base, k = 2
  while (usedNames.has(name)) name = `${base} (${k++})`.slice(0, 31)
  usedNames.add(name)
  try { ws.name = name } catch { /* ignore */ }

  // Drop the template's "Page 1" watermark + sample △ images.
  ws.views = (ws.views?.length ? ws.views : [{}]).map(v => ({ ...v, state: 'normal', style: undefined }))
  if (Array.isArray(ws._media)) ws._media.length = 0

  // Header meta (per-key values)
  cfg.writeMeta(ws, meta)

  // Clear the template's sample data rows (preserve borders/format).
  // NOTE: assign cell.style (not cell.font) — loaded templates share a single
  // style object across a column, so `cell.font = …` leaks into sibling cells.
  const normalFont = { ...cfg.font }
  const redFont = { ...cfg.font, color: { argb: 'FFFF0000' }, strike: true }
  const noFill = { type: 'pattern', pattern: 'none' }
  const setFont = (cell, font) => { cell.style = { ...cell.style, font: { ...font } } }
  for (let r = cfg.dataStart; r <= cfg.dataEnd; r++) {
    for (let c = 1; c <= cfg.remark; c++) {
      const cell = ws.getCell(r, c)
      cell.style = { ...cell.style, fill: noFill }
    }
    for (const c of cfg.fieldCols) {
      const cell = ws.getCell(r, c)
      cell.value = null
      setFont(cell, normalFont)
    }
    for (const [c1, c2] of cfg.rowMerges) {
      try { ws.unMergeCells(r, c1, r, c2) } catch { /* wasn't merged */ }
      try { ws.mergeCells(r, c1, r, c2) } catch { /* overlap — leave as is */ }
    }
  }

  // Inject BOM rows
  rows.forEach((row, i) => {
    const R = cfg.dataStart + i
    if (R > cfg.dataEnd) return   // overflow guard
    const isOut = row.status === 'revised_out'
    const font = isOut ? redFont : normalFont
    const updateLevel = row.update_level ?? 0
    const displayLevel = isOut ? updateLevel - 1 : updateLevel
    const tri = (!row._custPnOnly && displayLevel > 0) ? `△${displayLevel} ` : ''
    const partNo = row._custPnOnly ? (row.customer_part_no ?? '') : (row.tg_part_no ?? '')
    const lv = Math.min(row.level ?? row.bom_level ?? 1, cfg.maxLv)
    const lvCol = cfg.levelCol[lv]

    const put = (c, v, numFmt) => {
      const cell = ws.getCell(R, c)
      cell.value = v
      setFont(cell, font)
      if (numFmt) cell.numFmt = numFmt
    }
    put(lvCol, tri + partNo)
    const pnCell = ws.getCell(R, lvCol)
    pnCell.style = { ...pnCell.style, alignment: { ...pnCell.style?.alignment, horizontal: cfg.partNoAlign, vertical: 'middle' } }
    put(cfg.partName, row.part_name ?? '')
    put(cfg.spec, buildSpec(row))
    put(cfg.qty, row.quantity != null && row.quantity !== '' ? parseFloat(row.quantity) : '')
    put(cfg.wPart, row.mass_g != null ? Number(row.mass_g) : '', '#,##0.###')
    put(cfg.wGate, row.gate ?? '')
    put(cfg.price, row.price_per_pc != null ? Number(row.price_per_pc) : '')
    put(cfg.mcost, row.material_cost != null ? Number(row.material_cost) : '')
    ;['M/C', 'T/T', 'Local', 'Import'].forEach((s, j) => put(cfg.sup + j, row.completion_supplier === s ? '✓' : ''))
    put(cfg.recv, row.receiver ?? '')
    put(cfg.icode, row.internal_code ?? '')
    put(cfg.kanban, row.kanban_qty ?? '')
    put(cfg.lead, row.lead_time_day ?? '')
    put(cfg.remark, row.completion_remark ?? '')
  })

  // Revision record — prepend a synthetic "First issue" unless data has one.
  if (cfg.rev) {
    const rawRevs = bom.revisions ?? []
    const hasFirstIssue = rawRevs.some(r => !r.mark || r.mark === '–' || r.mark === '-')
    const revs = hasFirstIssue
      ? rawRevs
      : [{ mark: '–', revision_record: 'First issue', eci_no: bom.internal_eci_no, revision_date: bom.date }, ...rawRevs]
    for (let i = 0; i < cfg.rev.max; i++) {
      const R = cfg.rev.start + i
      const rev = revs[i]
      const set = (c, v) => { const cell = ws.getCell(R, c); cell.value = v ?? null; setFont(cell, cfg.font) }
      const isFirst = rev && (!rev.mark || rev.mark === '–' || rev.mark === '-')
      set(cfg.rev.mark, rev ? (isFirst ? '-' : rev.mark) : null)
      set(cfg.rev.rec, rev?.revision_record ?? null)
      set(cfg.rev.eci, rev?.eci_no ?? null)
      set(cfg.rev.date, rev?.revision_date ?? null)
      set(cfg.rev.rsnr, rev?.revisioner ?? null)
      set(cfg.rev.appr, rev?.approved_by ?? null)
    }
  }
}

/* ── fetch image URL → base64 string (null if unavailable) ── */
async function fetchImgBase64(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload  = () => { const r = reader.result; resolve(r.includes(',') ? r.split(',')[1] : r) }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

/* ── Matrix export: Component Part Detail ──────────────────────────────────
   Matches the "581D COMPONENT PART DETAIL" document format exactly:

   Rows 1-2 : Title (left) + Approval block 7 cols (right)
   Rows 3-6 : Component header block
     · A-D : merged vertically (rows 3-6) — column stub labels
     · E-G : merged horizontally per row  — type label (CUSTOMER PART NO. etc.)
     · H+  : one col per component, values per label type per row
   Rows 7+  : Assembly data rows
     A=NO.  B=MODEL  C=INT.CODE  D=Type  E=PICTURES  F=INTERNAL PART NO.  G=PART NAME  H+=qty
   Bottom   : Revision record
   ─────────────────────────────────────────────────────────────────────── */
export async function exportBomMatrix(bom) {
  const items = (bom.items ?? []).filter(it => it.status !== 'revised_out')

  // Collect unique keys
  const allKeySet = new Set()
  items.forEach(it => parseKeyList(it.key_code).forEach(k => allKeySet.add(String(k))))
  const allKeys = [...allKeySet].sort((a, b) => Number(a) - Number(b))

  // Build assembly rows (one per key)
  const assemblyRows = (allKeys.length ? allKeys : ['0']).map(key => {
    const keyItems = items.filter(it => {
      const ks = parseKeyList(it.key_code)
      return ks.length === 0 || ks.map(String).includes(key)
    })
    return {
      key,
      assembly:   keyItems.find(it => (it.level ?? 1) === 1) ?? null,
      // Level 2 only = direct sub-components of the assembly (same as 581D template)
      components: keyItems.filter(it => (it.level ?? 1) === 2),
    }
  })

  // Unique component columns (dedup by tg_part_no, preserve first-seen order)
  const compMap = new Map()
  assemblyRows.forEach(a => a.components.forEach(c => {
    const pn = c.tg_part_no ?? c.customer_part_no
    if (pn && !compMap.has(pn)) compMap.set(pn, c)
  }))
  const compCols = [...compMap.values()]

  // Quantity lookup: `${key}__${partNo}` → qty
  const qtyMap = {}
  assemblyRows.forEach(a => a.components.forEach(c => {
    const pn = c.tg_part_no ?? c.customer_part_no
    if (pn) qtyMap[`${a.key}__${pn}`] = c.quantity ?? 1
  }))

  // ── workbook setup ──
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Component Part Detail', { pageSetup: { orientation: 'landscape', paperSize: 8 } })

  // LEFT = 7 fixed cols (A–G); component cols start at H (col 8)
  const LEFT  = 7
  // Ensure at least 7 component-width cols so approval block doesn't crowd title
  const COMP_COLS_COUNT = Math.max(compCols.length, 7)
  const TOTAL = LEFT + COMP_COLS_COUNT

  // Column widths
  ws.getColumn(1).width = 5   // A  NO.
  ws.getColumn(2).width = 8   // B  MODEL
  ws.getColumn(3).width = 10  // C  INT.CODE
  ws.getColumn(4).width = 6   // D  Type
  ws.getColumn(5).width = 14  // E  PICTURES
  ws.getColumn(6).width = 22  // F  INTERNAL PART NO.
  ws.getColumn(7).width = 24  // G  PART NAME
  for (let i = 0; i < COMP_COLS_COUNT; i++) ws.getColumn(LEFT + 1 + i).width = 15

  // ── cell helper ──
  const BD    = { style: 'thin', color: { argb: 'FF000000' } }
  const ALLBD = { top: BD, left: BD, bottom: BD, right: BD }
  function cell(r, col, value, { bold = false, sz = 9, align = 'center', wrap = true, italic = false, bg } = {}) {
    const ce = ws.getCell(r, col)
    ce.value     = value
    ce.font      = { name: 'Tahoma', size: sz, bold, italic }
    ce.alignment = { horizontal: align, vertical: 'middle', wrapText: wrap }
    ce.border    = ALLBD
    if (bg) ce.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    return ce
  }
  function merge(r1, c1, r2, c2) { try { ws.mergeCells(r1, c1, r2, c2) } catch { /* overlap ok */ } }

  // ────────────────────────────────────────────────────────────────────────
  // ROWS 1–2 : Title + Approval block
  // ────────────────────────────────────────────────────────────────────────
  const APPR_START = TOTAL - 6   // rightmost 7 cols = approval block
  const TITLE_END  = APPR_START - 1

  // Title (A1 : TITLE_END row 1-2 merged vertically)
  merge(1, 1, 2, TITLE_END)
  cell(1, 1, `${bom.model ?? ''} COMPONENT PART DETAIL`, { bold: true, sz: 13 })
  ws.getRow(1).height = 18
  ws.getRow(2).height = 18

  // Approval block top row (role labels)
  const apprTop    = ['PEB',   'PD',    'QA',    'QE',    '',        'PE',    ''     ]
  const apprBottom = ['CHECK', 'CHECK', 'CHECK', 'CHECK', 'APPROVE', 'CHECK', 'ISSUE']
  apprTop.forEach((v, i)    => cell(1, APPR_START + i, v,    { bold: true, sz: 8 }))
  apprBottom.forEach((v, i) => cell(2, APPR_START + i, v,    { bold: true, sz: 8 }))


  // Merged vertical column stubs A-D
  const COL_STUBS = ['NO.', 'MODEL', 'INT.\nCODE', 'Type']
  COL_STUBS.forEach((label, i) => {
    merge(3, i + 1, 6, i + 1)
    cell(3, i + 1, label, { bold: true, sz: 8 })
  })
  ws.getRow(3).height = 14
  ws.getRow(4).height = 14
  ws.getRow(5).height = 14
  ws.getRow(6).height = 65  // tall for pictures

  // Type-label column (E:G merged horizontally per row)
  const TYPE_LABELS = ['CUSTOMER PART NO.', 'INTERNAL PART NO.', 'PART NAME', 'PICTURES']
  TYPE_LABELS.forEach((label, hi) => {
    merge(3 + hi, 5, 3 + hi, 7)
    cell(3 + hi, 5, label, { bold: true, sz: 8, align: 'right' })
  })

  // Component data cells in rows 3-6
  compCols.forEach((comp, ci) => {
    const col = LEFT + 1 + ci
    const vals = [
      comp.customer_part_no ?? comp.tg_part_no ?? '',
      comp.tg_part_no ?? '',
      comp.part_name ?? '',
      '',  // images handled below
    ]
    vals.forEach((v, hi) => cell(3 + hi, col, v, { sz: 8 }))
  })

  // Empty cells for padding columns (if compCols.length < COMP_COLS_COUNT)
  for (let ci = compCols.length; ci < COMP_COLS_COUNT; ci++) {
    const col = LEFT + 1 + ci
    for (let hi = 0; hi < 4; hi++) cell(3 + hi, col, '')
  }

  // Component images in row 6 (0-indexed row 5)
  for (let ci = 0; ci < compCols.length; ci++) {
    const b64 = await fetchImgBase64(compCols[ci].image_url)
    if (!b64) continue
    const ext = (compCols[ci].image_url ?? '').toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
    ws.addImage(wb.addImage({ base64: b64, extension: ext }),
      { tl: { col: LEFT + ci, row: 5 }, br: { col: LEFT + ci + 1, row: 6 } })
  }

  // ────────────────────────────────────────────────────────────────────────
  // ROWS 7+ : Assembly data rows
  // ────────────────────────────────────────────────────────────────────────
  const DATA_START = 7

  for (let ai = 0; ai < assemblyRows.length; ai++) {
    const { key, assembly } = assemblyRows[ai]
    const R = DATA_START + ai
    ws.getRow(R).height = 55

    cell(R, 1, ai + 1,                          { sz: 9 })
    cell(R, 2, bom.model ?? '',                  { sz: 9 })
    cell(R, 3, key,                              { sz: 9 })
    cell(R, 4, '-',                              { sz: 9 })
    cell(R, 5, '',                               { sz: 9 })   // PICTURES placeholder
    cell(R, 6, assembly?.tg_part_no ?? '',       { sz: 9, align: 'left' })
    cell(R, 7, assembly?.part_name  ?? '',       { sz: 9, align: 'left' })

    // Assembly image in col E (col 5 = 1-indexed → 0-indexed col 4)
    const ab64 = await fetchImgBase64(assembly?.image_url)
    if (ab64) {
      const ext = (assembly.image_url ?? '').toLowerCase().endsWith('.png') ? 'png' : 'jpeg'
      ws.addImage(wb.addImage({ base64: ab64, extension: ext }),
        { tl: { col: 4, row: R - 1 }, br: { col: 5, row: R } })
    }

    // Quantities (or '-') for each component column
    for (let ci = 0; ci < COMP_COLS_COUNT; ci++) {
      const comp = compCols[ci]
      const col  = LEFT + 1 + ci
      if (!comp) { cell(R, col, ''); continue }
      const pn  = comp.tg_part_no ?? comp.customer_part_no
      const qty = qtyMap[`${key}__${pn}`]
      const qtyDisplay = qty != null ? (Number(qty) % 1 === 0 ? Number(qty) : qty) : '-'
      cell(R, col, qtyDisplay, { sz: 9 })
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Revision record (bottom)
  // ────────────────────────────────────────────────────────────────────────
  const REVSTART = DATA_START + assemblyRows.length + 1
  const rawRevs  = bom.revisions ?? []
  const hasFirst = rawRevs.some(r => !r.mark || r.mark === '–' || r.mark === '-')
  const revs     = hasFirst
    ? rawRevs
    : [{ mark: '-', revision_record: 'First Issue', eci_no: bom.internal_eci_no, revision_date: bom.date }, ...rawRevs]

  // Header: No. | DATE | ECI | DETAIL (D:G merged) | Issue | PE CHECK (SUP) | QA | PEB
  const REV_DETAIL_END = 7
  merge(REVSTART, 4, REVSTART, REV_DETAIL_END)
  ;[[1,'No.'],[2,'DATE'],[3,'ECI'],[4,'DETAIL'],[8,'Issue'],[9,'PE CHECK (SUP)'],[10,'QA'],[11,'PEB']]
    .forEach(([col, h]) => cell(REVSTART, col, h, { bold: true, sz: 8 }))
  ws.getRow(REVSTART).height = 14

  revs.forEach((rev, i) => {
    const R = REVSTART + 1 + i
    const isFirst = !rev.mark || rev.mark === '–' || rev.mark === '-'
    ws.getRow(R).height = 14
    cell(R, 1, isFirst ? '-' : rev.mark,   { sz: 9 })
    cell(R, 2, rev.revision_date ?? '',    { sz: 9 })
    cell(R, 3, rev.eci_no ?? '',           { sz: 9 })
    merge(R, 4, R, REV_DETAIL_END)
    cell(R, 4, rev.revision_record ?? '',  { sz: 9, align: 'left' })
    cell(R, 8, '',                         { sz: 9 })   // Issue (blank placeholder)
    cell(R, 9, rev.revisioner ?? '',       { sz: 9 })
    cell(R, 10, '',                        { sz: 9 })   // QA
    cell(R, 11, rev.approved_by ?? '',     { sz: 9 })   // PEB
  })

  // ── download ──
  const buf  = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: `Matrix_${bom.model ?? bom.id}.xlsx` }).click()
  URL.revokeObjectURL(url)
}

/* ── main export.  `keys` = 'all' | a single key | an array of keys.
   Multiple keys → ONE workbook with one sheet per key (combined, like PDF). ── */
export async function exportBomToExcel(bom, keys = 'all', view = null) {
  const isBag = bom.bom_group === 'BAG'
  const cfg = isBag ? BAG_CFG : HE_CFG
  const allPages = groupByKey(bom.items ?? [])

  // Resolve which key-pages to export.
  let pages
  if (keys === 'all') {
    pages = allPages.length ? [allPages[0]] : []
  } else {
    const keyArr = Array.isArray(keys) ? keys.map(String) : [String(keys)]
    pages = keyArr.map(k => allPages.find(p => p.key === k)).filter(Boolean)
  }
  if (!pages.length) pages = allPages.length ? [allPages[0]] : [{ key: '0', rows: [] }]

  // Apply the active Part No. view filter (same rule as the document view): keep rows whose
  // Part No. CONTAINS any pattern, plus all their descendants. Only affects the view's own key.
  if (view?.part_nos?.length) {
    const pats = view.part_nos.map(p => p.toLowerCase())
    pages = pages.map(pg => {
      if (String(view.key_code ?? '') !== String(pg.key)) return pg
      const rows = (pg.rows ?? []).filter(Boolean)
      const matches = r => pats.some(p =>
        (r.tg_part_no ?? '').toLowerCase().includes(p) ||
        (r.customer_part_no ?? '').toLowerCase().includes(p))
      const byId = new Map(rows.map(r => [r.id, r]))
      const keep = new Set()
      rows.forEach(r => { if (matches(r)) keep.add(r.id) })
      rows.forEach(r => {
        if (keep.has(r.id)) return
        let p = r.parent_id
        while (p != null) { if (keep.has(p)) { keep.add(r.id); break } p = byId.get(p)?.parent_id ?? null }
      })
      return { ...pg, rows: rows.filter(r => keep.has(r.id)) }
    })
  }

  // Load the template workbook once — use this BOM's uploaded custom template if set,
  // otherwise the default HE/Bag form.
  const url = bom.custom_template_url
    ? bom.custom_template_url
    : `${import.meta.env?.BASE_URL ?? '/'}${cfg.file}`
  const buf = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`template not found: ${url}`)
    return r.arrayBuffer()
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)

  // Fill one (blank) template sheet per key, then drop the leftover sheets.
  const usedNames = new Set()
  const n = Math.min(pages.length, wb.worksheets.length)
  for (let i = 0; i < n; i++) fillSheet(wb.worksheets[i], cfg, bom, pages[i], usedNames)
  wb.worksheets.slice(n).map(s => s.id).forEach(id => { try { wb.removeWorksheet(id) } catch { /* ignore */ } })

  // Download
  const out = await wb.xlsx.writeBuffer()
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const link = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = link
  a.download = `BOM_${bom.tg_part_no ?? bom.id}.xlsx`
  a.click()
  URL.revokeObjectURL(link)
}
