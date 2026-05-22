import ExcelJS from 'exceljs'

function parseKeyList(kc) {
  if (!kc) return []
  const s = String(kc).trim()
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) { const r = []; for (let k = +m[1]; k <= +m[2]; k++) r.push(k); return r }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n)).filter(n => !isNaN(n))
  const n = parseInt(s); return isNaN(n) ? [] : [n]
}

// Same logic as BomDocumentView line 974-978, but also strips "NO" from note
function buildSpec(item) {
  const ok = v => v && v.trim() && v.trim().toUpperCase() !== 'NO'
  return [
    ok(item.note)               ? item.note.trim()               : null,
    ok(item.product_standards)  ? item.product_standards.trim()  : null,
    ok(item.material_standards) ? item.material_standards.trim() : null,
  ].filter(Boolean).join('  ')
}

const THIN = { style: 'thin', color: { argb: 'FF000000' } }
const BD   = { top: THIN, bottom: THIN, left: THIN, right: THIN }

function sc(ws, r, c, value, opts = {}) {
  const cl = ws.getCell(r, c)
  cl.value  = value
  if (opts.font)  cl.font  = opts.font
  if (opts.fill)  cl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
  if (opts.align) cl.alignment = { wrapText: true, ...opts.align }
  cl.border = opts.border ?? BD
  return cl
}

function mg(ws, r1, c1, r2, c2) { ws.mergeCells(r1, c1, r2, c2) }

function hc(ws, r, c, value, fill, rEnd, cEnd) {
  sc(ws, r, c, value, {
    font:  { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Arial' },
    fill,
    align: { horizontal: 'center', vertical: 'middle' },
  })
  if (rEnd && cEnd && (rEnd !== r || cEnd !== c)) mg(ws, r, c, rEnd, cEnd)
  else if (rEnd && rEnd !== r) mg(ws, r, c, rEnd, c)
  else if (cEnd && cEnd !== c) mg(ws, r, c, r, cEnd)
}

async function exportExcel(bom, key) {
  const allItems = (bom?.items ?? []).filter(i => i.status !== 'revised_out' && i.tg_part_no)
  const items = key === 'all'
    ? allItems
    : allItems.filter(i => { const ks = parseKeyList(i.key_code); return ks.length === 0 || ks.map(String).includes(key) })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('BOM', { views: [{ state: 'frozen', ySplit: 7 }] })

  // ── Column widths ─────────────────────────────────────────────────
  // Cols 1-5: Part No Lv1-5 | 6: Part name | 7: Mat Spec | 8: Q'ty
  // 9: Weight Part | 10: Weight Gate | 11-12: Price pcs/kgs | 13: Mat cost
  // 14-18: Supplier 1-5 | 19: M/C | 20: T/T | 21: Local | 22: Import
  // 23: Receiver | 24: Internal Code | 25-26: Kanban pcs/kgs | 27: Lead | 28: Remark
  // 29-34: Approval boxes
  ws.columns = [
    ...Array(5).fill({ width: 14 }),  // 1-5  Part No.
    { width: 26 }, // 6  Part name
    { width: 22 }, // 7  Material Spec
    { width: 7  }, // 8  Q'ty
    { width: 9  }, // 9  Weight Part
    { width: 9  }, // 10 Weight Gate
    { width: 9  }, // 11 Price pcs
    { width: 9  }, // 12 Price kgs
    { width: 14 }, // 13 Mat cost/unit
    ...Array(5).fill({ width: 5 }),   // 14-18 Supplier 1-5
    { width: 5  }, // 19 M/C
    { width: 5  }, // 20 T/T
    { width: 7  }, // 21 Local
    { width: 7  }, // 22 Import
    { width: 10 }, // 23 Receiver
    { width: 12 }, // 24 Internal Code
    { width: 7  }, // 25 Kanban pcs
    { width: 7  }, // 26 Kanban kgs
    { width: 8  }, // 27 Lead time
    { width: 22 }, // 28 Remark
    ...Array(6).fill({ width: 9 }),   // 29-34 Approval boxes
  ]

  const TOTAL = 34

  // ─────────────────────────────────────────────────────────────────
  // ROWS 1-4: BOM header
  // ─────────────────────────────────────────────────────────────────
  const META = 'FFFFF2CC'

  ws.getRow(1).height = 20
  sc(ws, 1, 1,  'Event Issue / Concern With',
    { font: { bold: true, size: 9 }, fill: META, align: { horizontal: 'center', vertical: 'middle' } })
  mg(ws, 1, 1, 1, 5)
  sc(ws, 1, 6,  `Customer Part No. : ${bom?.customer_part_no ?? ''}`,
    { font: { size: 9 }, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 1, 6, 1, 8)
  sc(ws, 1, 9,  'BILL OF MATERIAL',
    { font: { bold: true, size: 14, name: 'Arial' }, align: { horizontal: 'center', vertical: 'middle' } })
  mg(ws, 1, 9, 1, 15)
  sc(ws, 1, 16, 'Customer Name :', { font: { size: 9 }, align: { horizontal: 'right', vertical: 'middle' } })
  sc(ws, 1, 17, bom?.customer_name ?? bom?.customer ?? '',
    { font: { bold: true, size: 9 }, align: { horizontal: 'center', vertical: 'middle' } })
  mg(ws, 1, 17, 1, 19)
  sc(ws, 1, 20, 'Date :', { font: { size: 9 }, align: { horizontal: 'right', vertical: 'middle' } })
  sc(ws, 1, 21, bom?.date ?? '',
    { font: { bold: true, size: 9 }, align: { horizontal: 'center', vertical: 'middle' } })
  mg(ws, 1, 21, 1, 23)
  for (let c = 24; c <= 28; c++) ws.getCell(1, c).border = BD
  const apLabels = ['Pro.\nEng.', 'CO-OR', 'AG\nM', 'Mg\nr.', 'Purchase', 'Part\ncontrol']
  apLabels.forEach((lbl, i) => sc(ws, 1, 29 + i, lbl,
    { font: { bold: true, size: 8 }, fill: 'FFD0E4F7', align: { horizontal: 'center', vertical: 'middle' } }))

  ws.getRow(2).height = 18
  sc(ws, 2, 1, `Type : ${bom?.type ?? 'HE'}`,
    { font: { size: 9 }, fill: META, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 2, 1, 2, 5)
  sc(ws, 2, 6, `Customer Part No. : ${bom?.customer_part_no ?? ''}`,
    { font: { size: 9 }, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 2, 6, 2, 8)
  mg(ws, 2, 9, 2, 23); ws.getCell(2, 9).border = BD
  for (let c = 29; c <= TOTAL; c++) ws.getCell(2, c).border = BD

  ws.getRow(3).height = 18
  sc(ws, 3, 1, `Model No. : ${bom?.model ?? ''}`,
    { font: { size: 9 }, fill: META, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 3, 1, 3, 3)
  sc(ws, 3, 4, `TGT Part No. : ${bom?.tg_part_no ?? ''}`,
    { font: { size: 9 }, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 3, 4, 3, 8)
  mg(ws, 3, 9, 3, 23); ws.getCell(3, 9).border = BD
  for (let c = 29; c <= TOTAL; c++) ws.getCell(3, c).border = BD

  ws.getRow(4).height = 18
  sc(ws, 4, 1, `Model Name : ${bom?.model_name ?? bom?.model ?? ''}`,
    { font: { size: 9 }, fill: META, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 4, 1, 4, 3)
  sc(ws, 4, 4, `Part Name : ${bom?.part_name ?? 'WHEEL ASSY, STEERING (N)'}`,
    { font: { size: 9 }, align: { horizontal: 'left', vertical: 'middle' } })
  mg(ws, 4, 4, 4, 8)
  mg(ws, 4, 9, 4, 23); ws.getCell(4, 9).border = BD
  for (let c = 29; c <= TOTAL; c++) ws.getCell(4, c).border = BD

  ws.getRow(5).height = 4

  // ─────────────────────────────────────────────────────────────────
  // ROW 6-7: Column headers (2-row)
  // ─────────────────────────────────────────────────────────────────
  ws.getRow(6).height = 26
  ws.getRow(7).height = 20

  const NAVY  = 'FF243F60'
  const BLUE  = 'FF1F4E79'
  const LBLUE = 'FF2E75B6'
  const GREEN = 'FF375623'
  const TEAL  = 'FF4472C4'

  // Row 6 — main headers
  hc(ws, 6,  1, 'Part No.',                    NAVY,  null, 5  )  // A6:E6
  hc(ws, 6,  6, 'Part name',                   BLUE,  7,    null)  // F6:F7
  hc(ws, 6,  7, 'Material\nSpec',               BLUE,  7,    null)  // G6:G7
  hc(ws, 6,  8, "Q'ty\n(pcs.)",                BLUE,  7,    null)  // H6:H7
  hc(ws, 6,  9, 'Weight\n(g./pc.)',             BLUE,  null, 10 )  // I6:J6
  hc(ws, 6, 11, 'Price/pcs,kgs\n(baht)',        LBLUE, null, 12 )  // K6:L6
  hc(ws, 6, 13, 'Material cost/unit\n(baht)',   LBLUE, 7,    null)  // M6:M7
  hc(ws, 6, 14, 'Supplier',                     GREEN, null, 22 )  // N6:V6
  hc(ws, 6, 23, 'Re-\nceiver',                  TEAL,  7,    null)  // W6:W7
  hc(ws, 6, 24, 'Internal\nCode',               TEAL,  7,    null)  // X6:X7
  hc(ws, 6, 25, "Q'ty/\nkanban",                TEAL,  null, 26 )  // Y6:Z6
  hc(ws, 6, 27, 'Lead\ntime\n(day)',             TEAL,  7,    null)  // AA6:AA7
  hc(ws, 6, 28, 'Remark',                       TEAL,  7,    null)  // AB6:AB7
  for (let c = 29; c <= TOTAL; c++) ws.getCell(6, c).border = BD

  // Row 7 — sub-headers
  for (let i = 1; i <= 5; i++) hc(ws, 7, i, String(i), NAVY)
  hc(ws, 7,  9, 'Part',  BLUE)
  hc(ws, 7, 10, 'Gate',  BLUE)
  hc(ws, 7, 11, 'pcs',   LBLUE)
  hc(ws, 7, 12, 'kgs',   LBLUE)
  const supSubs = ['1', '2', '3', '4', '5', 'M/C', 'T/T', 'Local', 'Imp.']
  supSubs.forEach((lbl, i) => hc(ws, 7, 14 + i, lbl, GREEN))
  hc(ws, 7, 25, 'pcs', TEAL)
  hc(ws, 7, 26, 'kgs', TEAL)
  for (let c = 29; c <= TOTAL; c++) ws.getCell(7, c).border = BD

  // ─────────────────────────────────────────────────────────────────
  // DATA ROWS (starting row 8)
  // ─────────────────────────────────────────────────────────────────
  const LV_FILL = ['FFFFF2CC', 'FFF2F2F2', 'FFDAE3F3', 'FFE2EFDA', 'FFFFFCE5']

  items.forEach(item => {
    const lv  = Math.min(Math.max(item.level ?? 1, 1), 5)
    const rfg = LV_FILL[lv - 1]
    const rfl = { type: 'pattern', pattern: 'solid', fgColor: { argb: rfg } }
    const wfl = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }

    const matSpec = buildSpec(item)

    const vals = Array(TOTAL).fill('')
    vals[lv - 1] = item.tg_part_no ?? ''
    vals[5]  = item.part_name ?? ''
    vals[6]  = matSpec
    vals[7]  = item.quantity != null ? Number(item.quantity) : ''
    vals[8]  = item.mass_g   != null ? Number(item.mass_g)   : ''
    // vals[9] = Gate weight (empty — not in DB)
    // vals[10-27] = empty (Price, Supplier, etc. — to be filled manually)
    // vals[28-33] = empty (Approval boxes)

    const row = ws.addRow(vals)
    row.height = 14

    for (let c = 1; c <= TOTAL; c++) {
      const cl = row.getCell(c)
      cl.border = BD
      cl.font   = { size: 9, name: 'Arial' }

      if (c <= 5) {
        cl.fill      = c === lv ? rfl : wfl
        cl.font      = c === lv
          ? { bold: true, size: 9, name: 'Courier New' }
          : { size: 9, color: { argb: 'FFCCCCCC' } }
        cl.alignment = { horizontal: 'center', vertical: 'middle' }
      } else if (c === 6) {
        cl.fill      = rfl
        cl.alignment = { horizontal: 'left', vertical: 'middle' }
      } else if (c === 7) {
        cl.fill      = rfl
        cl.font      = { size: 8, name: 'Arial' }
        cl.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
      } else if (c === 8) {
        cl.fill      = rfl
        cl.alignment = { horizontal: 'right', vertical: 'middle' }
        if (cl.value !== '') cl.numFmt = '#,##0.####'
      } else if (c === 9) {
        cl.fill      = rfl
        cl.alignment = { horizontal: 'right', vertical: 'middle' }
        if (cl.value !== '') cl.numFmt = '#,##0.##'
      } else if (c <= 28) {
        cl.fill      = rfl
        cl.alignment = { horizontal: 'center', vertical: 'middle' }
      } else {
        cl.fill      = wfl
        cl.alignment = { horizontal: 'center', vertical: 'middle' }
      }
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // FOOTER ROW — revision mark "A"
  // ─────────────────────────────────────────────────────────────────
  const fVals = Array(TOTAL).fill('')
  ;[0, 5, 6, 7, 8, 12].forEach(i => { fVals[i] = 'A' })
  for (let i = 13; i <= 21; i++) fVals[i] = 'A'
  fVals[26] = 'A'; fVals[27] = 'A'

  const frow = ws.addRow(fVals)
  frow.height = 14
  const fFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6DCE4' } }
  for (let c = 1; c <= TOTAL; c++) {
    const cl = frow.getCell(c)
    cl.border = BD
    cl.fill   = fFill
    cl.font   = { bold: true, size: 9 }
    cl.alignment = { horizontal: 'center', vertical: 'middle' }
  }
  mg(ws, frow.number, 1, frow.number, 5)
  frow.getCell(1).value = 'A'

  // ─────────────────────────────────────────────────────────────────
  // DOWNLOAD
  // ─────────────────────────────────────────────────────────────────
  const buf  = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `BOM_${bom?.tg_part_no ?? bom?.id}${key !== 'all' ? `_Key${key}` : ''}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export default function BomExport({ bom }) {
  const items   = (bom?.items ?? []).filter(i => i.status !== 'revised_out' && i.tg_part_no)
  const allKeys = [...new Set(items.flatMap(i => parseKeyList(i.key_code)))].sort((a, b) => a - b).map(String)

  return (
    <div className="exp-wrap">
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

      <div className="exp-section-title">Export Excel (.xlsx)</div>
      <div className="exp-btn-grid">
        <div className="exp-btn-card" onClick={() => exportExcel(bom, 'all')}>
          <div className="exp-btn-icon">📊</div>
          <div className="exp-btn-label">Export Excel (ทั้งหมด)</div>
          <div className="exp-btn-sub">รวมทุก Key · {items.length} parts</div>
        </div>
        {allKeys.map(k => (
          <div key={k} className="exp-btn-card" onClick={() => exportExcel(bom, k)}>
            <div className="exp-btn-icon">📋</div>
            <div className="exp-btn-label">Export Excel — Key {k}</div>
            <div className="exp-btn-sub">
              {items.filter(i => {
                const ks = parseKeyList(i.key_code)
                return ks.length === 0 || ks.map(String).includes(k)
              }).length} parts
            </div>
          </div>
        ))}
      </div>

      <div className="exp-section-title" style={{ marginTop: 20 }}>Preview (10 รายการแรก)</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="comp-tbl">
          <thead>
            <tr>
              <th>Lv</th>
              {[1,2,3,4,5].map(n => <th key={n} style={{fontSize:10}}>Lv{n}</th>)}
              <th>Part Name</th>
              <th>Material Spec</th>
              <th>Q'ty</th>
              <th>Weight (g)</th>
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
                <td style={{ fontSize: 10 }}>{buildSpec(row)}</td>
                <td className="comp-td-c">{row.quantity}</td>
                <td className="comp-td-c">{row.mass_g ? Number(row.mass_g).toLocaleString() : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 10 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
          ... และอีก {items.length - 10} รายการ
        </div>
      )}
    </div>
  )
}
