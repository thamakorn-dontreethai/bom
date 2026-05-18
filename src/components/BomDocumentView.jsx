import { useRef, useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

// Follow the sort_order chain from a revised_out through any intermediate revised_out rows
// to the final active replacement. Handles A(revised)→B(revised)→C(active) chains.
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

  // For each revised_out, find its final active replacement (following chains)
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
    if (i.status === 'revised_out') return  // placed by insertRevisedOut after flatten

    // If parent is revised_out, re-parent to its final active replacement
    let parentId = i.parent_id
    if (parentId && map[parentId] && map[parentId].status === 'revised_out') {
      const rep = finalRepOf[parentId]
      parentId = rep ? rep.id : null
    }

    if (parentId && map[parentId]) {
      map[parentId].children.push(map[i.id])
    } else if (rootItem && map[rootItem.id] && i.id !== rootItem.id) {
      map[rootItem.id].children.push(map[i.id])
    } else {
      roots.push(map[i.id])
    }
  })
  return roots
}
function flatten(nodes) {
  const out = []
  for (const n of nodes) { out.push(n); if (n.children.length) out.push(...flatten(n.children)) }
  return out
}

// Place each revised_out chain immediately before the final active replacement.
// Example: A(revised)→B(revised)→C(active) inserts [A, B] right before C.
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
    // Only start at chain roots (skip items that are already covered by an earlier chain member)
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
      for (const ro of insertBefore[row.id]) {
        result.push(ro)
        placed.add(ro.id)
      }
    }
    result.push(row)
  }
  // Any revised_out whose replacement wasn't on this page — append at end
  allItems.forEach(it => {
    if (it.status === 'revised_out' && !placed.has(it.id)) result.push(it)
  })
  return result
}

const MIN_ROWS = 40

const KEY_LABELS = {
  '1': 'Key 1 — NH-900L (N)',
  '2': 'Key 2 — NH-1168L (C)',
  '3': 'Key 3 — NH-900L (L)',
  '4': 'Key 4 — NH-1168L (R)',
  '5': 'Key 5 — NH-802L (N)',
  '6': 'Key 6 — NH-802L (C)',
}

// Parse "1" → [1], "1-2" → [1,2], "1-6" → [1,2,3,4,5,6], "1,3" → [1,3]
function parseKeyList(keyCode) {
  if (!keyCode) return []
  const s = String(keyCode).trim()
  const range = s.match(/^(\d+)-(\d+)$/)
  if (range) {
    const start = parseInt(range[1]), end = parseInt(range[2])
    const result = []
    for (let k = start; k <= end; k++) result.push(k)
    return result
  }
  if (s.includes(',')) {
    return s.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n))
  }
  const n = parseInt(s)
  return isNaN(n) ? [] : [n]
}

function groupByKey(items) {
  // keyed[k] = items that must appear on key k's page (single or multi-key)
  const keyed = {}
  // shared = items with no explicit key (null) — pulled in via BFS from parent
  const shared = []
  const allKeys = new Set()

  items.forEach(it => {
    const keys = parseKeyList(it.key_code)
    if (keys.length === 0) {
      shared.push(it)
    } else {
      // Add to every page this key covers (handles "1-2" → keys 1 and 2)
      keys.forEach(k => {
        const ks = String(k)
        allKeys.add(ks)
        if (!keyed[ks]) keyed[ks] = []
        keyed[ks].push(it)
      })
    }
  })

  const sortedKeys = [...allKeys].sort((a, b) => Number(a) - Number(b))

  if (!sortedKeys.length) {
    const pageItems = [...shared]
    return [{ key: '0', label: '', rows: insertRevisedOut(flatten(buildTree(pageItems)), pageItems) }]
  }

  return sortedKeys.map(k => {
    // BFS: seed starts with this key's own items, then pulls in null-key
    // sub-parts whose parent is already in the seed.
    const seed = new Set(keyed[k].map(it => it.id))
    let changed = true
    while (changed) {
      changed = false
      for (const it of shared) {
        if (!seed.has(it.id) && it.parent_id != null && seed.has(it.parent_id)) {
          seed.add(it.id)
          changed = true
        }
      }
    }
    const pageItems = [...keyed[k], ...shared.filter(it => seed.has(it.id))]
    return {
      key: k,
      label: KEY_LABELS[k] ?? `Key ${k}`,
      rows: insertRevisedOut(flatten(buildTree(pageItems)), pageItems),
    }
  })
}

export default function BomDocumentView({ bom, onRefresh }) {
  const pageRefs = useRef([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [showRevDialog, setShowRevDialog] = useState(false)

  const [header, setHeader] = useState({
    evt_first_issue: bom.evt_first_issue ?? false,
    evt_cv: bom.evt_cv ?? false,
    evt_mq: bom.evt_mq ?? false,
    evt_dan: bom.evt_dan ?? false,
    evt_hin: bom.evt_hin ?? false,
    evt_sop: bom.evt_sop ?? false,
    concern_drawing: bom.concern_drawing ?? false,
    concern_actual_part: bom.concern_actual_part ?? false,
    revisioner: bom.prepared_by ?? '',
    approved_by: bom.approved_by ?? '',
  })

  function onToggle(key) { setHeader(h => ({ ...h, [key]: !h[key] })) }
  function onField(key, val) { setHeader(h => ({ ...h, [key]: val })) }

  async function saveHeader() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`/api/bom/${bom.id}/header`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(header),
      })
      if (!r.ok) throw new Error()
      setSaveMsg('ok')
    } catch {
      setSaveMsg('err')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  async function download() {
    const refs = pageRefs.current.filter(Boolean)
    if (!refs.length) return
    setBusy(true)
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const margin = 5
      const availW = pw - margin * 2
      const availH = ph - margin * 2
      const targetPx = Math.round((availW / 25.4) * 96)

      for (let i = 0; i < refs.length; i++) {
        const el = refs[i]
        if (i > 0) pdf.addPage()
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#fff',
          windowWidth: targetPx,
          onclone: (_doc, clonedEl) => {
            clonedEl.style.width = targetPx + 'px'
            clonedEl.style.minWidth = targetPx + 'px'
            clonedEl.style.maxWidth = targetPx + 'px'
            clonedEl.style.boxSizing = 'border-box'
            _doc.querySelectorAll('input.bp-rev-input').forEach(inp => {
              const span = _doc.createElement('span')
              span.textContent = inp.value
              span.style.cssText = 'font-family:Arial,sans-serif;font-size:7.5px;color:#000;display:inline-block;width:100%'
              inp.parentNode.replaceChild(span, inp)
            })
          },
        })
        const ratio = canvas.height / canvas.width
        const iw = availW
        const ih = iw * ratio
        let y = 0
        while (y < ih) {
          if (y > 0) pdf.addPage()
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin - y, iw, ih)
          y += availH
        }
      }
      pdf.save(`BOM-${bom.tg_part_no ?? bom.model ?? bom.id}.pdf`)
    } catch (e) {
      console.error('PDF error', e)
    } finally {
      setBusy(false)
    }
  }

  const groups = groupByKey(bom.items ?? [])
  const pages = groups.length > 0 ? groups : [{ key: '0', label: '', rows: [] }]
  const total = pages.length

  return (
    <div className="bdv-wrap">
      <div className="bdv-toolbar">
        {saveMsg === 'ok' && <span className="bdv-save-msg bdv-save-msg--ok">✓ บันทึกแล้ว</span>}
        {saveMsg === 'err' && <span className="bdv-save-msg bdv-save-msg--err">⚠ บันทึกไม่สำเร็จ</span>}
        <button className="bdv-btn bdv-btn--secondary" onClick={saveHeader} disabled={saving || busy}>
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        <button
          className="bdv-btn bdv-btn--rev"
          onClick={() => setShowRevDialog(true)}
          disabled={busy || saving}
        >
          △ บันทึก Update
        </button>
        <button
          className="bdv-btn bdv-btn--danger"
          disabled={busy || saving}
          onClick={async () => {
            if (!window.confirm('ลบข้อมูล revision ทั้งหมดและ reset กลับสู่สภาพเริ่มต้น?')) return
            await fetch(`/api/bom/${bom.id}/revisions/reset`, { method: 'DELETE' })
            onRefresh?.()
          }}
        >
          ↺ Reset Revision
        </button>
        <button className="bdv-btn" onClick={download} disabled={busy || saving}>
          {busy ? 'กำลัง Generate…' : '⬇ Download PDF'}
        </button>
      </div>
      <div className="bdv-scroll">
        {pages.map((g, idx) => {
          const rows = [...g.rows]
          const need = Math.max(0, MIN_ROWS - rows.length)
          for (let j = 0; j < need; j++) rows.push(null)
          return (
            <div key={g.key} ref={el => { pageRefs.current[idx] = el }} className="bdv-paper">
              <BomPage
                bom={bom}
                header={header}
                onToggle={onToggle}
                onField={onField}
                rows={rows}
                pageNum={idx + 1}
                totalPages={total}
              />
            </div>
          )
        })}
      </div>

      {showRevDialog && (
        <RevisionDialog
          bom={bom}
          onClose={() => setShowRevDialog(false)}
          onDone={() => { setShowRevDialog(false); onRefresh?.() }}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   BomPage — reconstructed to match BOM 3GJ HE.pdf exactly

   25-column grid (shared by header table + BOM table):
   ┌─ cols 1-5   Part No. levels 1-5        (85 × 5 = 425 px)
   ├─ col  6     label area                 (160 px)
   ├─ col  7     wide value / part-name     (260 px)
   ├─ cols 8-11  qty / weight-P / weight-G / price  (30 26 26 54)
   ├─ cols 12-16 material cost 1-5          (26 × 5)
   ├─ cols 17-20 supplier sub M/C T/T Local Import  (24 × 4)
   └─ cols 21-25 recie / code / kanban / lead / remark (26 30 30 28 36)
───────────────────────────────────────────────────────── */
function BomPage({ bom, header, onToggle, onField, rows, pageNum, totalPages }) {
  const revisions = bom.revisions?.length > 0
    ? bom.revisions
    : [{ mark: '–', revision_record: 'First issue', eci_no: bom.internal_eci_no, revision_date: bom.date }]

  /* shared colgroup — identical in header table and BOM table */
  function Cols() {
    return (
      <colgroup>
        {[85,85,85,85,85].map((w,i)=><col key={`pn${i}`} style={{width:w}}/>)}
        <col style={{width:160}}/><col style={{width:260}}/>
        <col style={{width:30}}/><col style={{width:26}}/>
        <col style={{width:26}}/><col style={{width:54}}/>
        {[26,26,26,26,26].map((w,i)=><col key={`mc${i}`} style={{width:w}}/>)}
        {[24,24,24,24].map((w,i)=><col key={`sp${i}`} style={{width:w}}/>)}
        <col style={{width:26}}/><col style={{width:30}}/>
        <col style={{width:30}}/><col style={{width:28}}/>
        <col style={{width:36}}/>
      </colgroup>
    )
  }

  return (
    <div className="bp">

      {/* ══════════════════════════════════════════════════════
          BLOCK 1 — Document header
          Row sums (all must equal 25):
            Row 1: 5 + 9 + 1 + 10 = 25
            Row 2: 2+1+3 + 19     = 25
            Row 3: 2+1+3 + 19     = 25
            Row 4: 2+1+3+9+10     = 25
         ══════════════════════════════════════════════════════ */}
      <table className="bp-hdr-tbl">
        <Cols />
        <tbody>

          {/* ── Row 1: [Event Issue | Concern With] [BILL OF MATERIAL] [Page] [Signature] */}
          <tr>
            {/* LEFT BLOCK — Event Issue + Concern With (cols 1-5) */}
            <td className="bp-event" colSpan={5}>
              <table className="bp-evt-tbl">
                <thead>
                  <tr>
                    <th className="bp-evt-hd" colSpan={2}>Event issue</th>
                    <th className="bp-evt-hd bp-evt-hd--right">Concern with</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><Chk checked={header.evt_first_issue} onChange={()=>onToggle('evt_first_issue')}/>First issue</td>
                    <td><Chk checked={header.evt_dan}         onChange={()=>onToggle('evt_dan')}/>DAN</td>
                    <td><Chk checked={header.concern_drawing} onChange={()=>onToggle('concern_drawing')}/>Drawing : Rev. –</td>
                  </tr>
                  <tr>
                    <td><Chk checked={header.evt_cv}  onChange={()=>onToggle('evt_cv')}/>CV</td>
                    <td><Chk checked={header.evt_hin} onChange={()=>onToggle('evt_hin')}/>HIN</td>
                    <td><Chk checked={header.concern_actual_part} onChange={()=>onToggle('concern_actual_part')}/>Actual Part : stage</td>
                  </tr>
                  <tr>
                    <td><Chk checked={header.evt_mq}  onChange={()=>onToggle('evt_mq')}/>MQ</td>
                    <td><Chk checked={header.evt_sop} onChange={()=>onToggle('evt_sop')}/>SOP</td>
                    <td/>
                  </tr>
                </tbody>
              </table>
            </td>

            {/* CENTER BLOCK — title (cols 6-15, colSpan=10) */}
            <td className="bp-title" colSpan={10}><b>BILL OF MATERIAL</b></td>

            {/* RIGHT BLOCK — Approval boxes (cols 16-25, colSpan=10, spans 4 rows) */}
            <td className="bp-sign-outer" colSpan={10} rowSpan={4} style={{ height: '1px' }}>
              <table className="bp-sign-tbl" style={{ height: '100%' }}>
                <colgroup>
                  <col style={{width:'18%'}}/><col style={{width:'18%'}}/>
                  <col style={{width:'18%'}}/><col style={{width:'23%'}}/>
                  <col style={{width:'23%'}}/>
                </colgroup>
                <tbody>
                  <tr>
                    <td colSpan={5} style={{height:'13px',textAlign:'right',fontSize:'7px',paddingRight:4,borderBottom:'1px solid #333'}}>
                      Page {pageNum} of {totalPages}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{height: '15px'}}>Pro. Eng.</td>
                    <td style={{height: '15px'}}>Purchase</td>
                    <td style={{height: '15px'}}>Part control</td>
                  </tr>
                  <tr>
                    <td style={{height: '15px'}}>CO-OR</td>
                    <td style={{height: '15px'}}>AGM</td>
                    <td style={{height: '15px'}}>Mgr.</td>
                    <td rowSpan={2} style={{height: '100%'}}></td>
                    <td rowSpan={2} style={{height: '100%'}}></td>
                  </tr>
                  <tr style={{height: '100%'}}>
                    <td style={{height: '100%'}}></td>
                    <td style={{height: '100%'}}></td>
                    <td style={{height: '100%'}}></td>
                  </tr>
                  <tr>
                    <td style={{height: '15px'}}></td>
                    <td style={{height: '15px'}}></td>
                    <td style={{height: '15px'}}></td>
                    <td style={{height: '15px'}}></td>
                    <td style={{height: '15px'}}></td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>

          {/* ── Row 2: Type | Customer Part No. */}
          <tr>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:58}}>Type</span>: <b>{bom.type ?? 'HE'}</b>
            </td>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:80}}>Customer Part No.</span>: <b>{bom.customer_part_no}</b>
            </td>
            <td colSpan={9} style={{border:'none'}}/>
          </tr>

          {/* ── Row 3: Model No. | TGT Part No. | Customer Name | Date */}
          <tr>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:58}}>Model No.</span>: <b>{bom.model}</b>
            </td>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:80}}>TGT Part No.</span>:{' '}
              <b>
                {(bom.tgt_history ?? []).map((h,i)=>(
                  <span key={i} style={{marginRight:2}}>
                    {h.introduced_at > 0 && <span className="bp-tri-hdr">△{h.introduced_at}</span>}
                    <span className="bp-pn-struck">{h.old_tg_part_no}</span>{' '}
                  </span>
                ))}
                {(bom.tgt_update_level ?? 0) > 0 && <span className="bp-tri-hdr">△{bom.tgt_update_level}</span>}
                {bom.tg_part_no}
              </b>
            </td>
            <td className="bp-lbl" colSpan={1} rowSpan={2} style={{textAlign: 'center'}}>
              Customer Name :
            </td>
            <td className="bp-val" colSpan={3} rowSpan={2} style={{textAlign: 'center'}}>
              <b>{bom.customer_name ?? bom.customer}</b>
            </td>
            <td className="bp-lbl" colSpan={1} rowSpan={2} style={{textAlign: 'center'}}>
              Date :
            </td>
            <td className="bp-val" colSpan={4} rowSpan={2} style={{textAlign: 'center'}}>
              <b>{bom.date}</b>
            </td>
            {/* 10 columns taken by signature box rowSpan */}
          </tr>

          {/* ── Row 4: Model Name | Part name */}
          <tr>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:58}}>Model Name</span>: <b>{bom.model_name}</b>
            </td>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:80}}>Part name</span>: <b>{bom.part_name}</b>
            </td>
          </tr>

        </tbody>
      </table>

      {/* ══════════════════════════════════════════════════════
          BLOCK 2 — Main BOM table (15 logical column groups)
          Physical cols: 5 PartNo + 1 Name + 1 Spec + 1 Qty
                       + 2 Weight + 1 Price + 5 MatCost
                       + 4 Supplier + 1 Recie + 1 Code
                       + 1 Kanban + 1 Lead + 1 Remark = 25
         ══════════════════════════════════════════════════════ */}
      <table className="bp-bom-tbl">
        <Cols />
        <thead>
          <tr>
            <th colSpan={5}  className="bp-th bp-th-group">Part No.</th>
            <th rowSpan={2}  className="bp-th bp-th-name">Part name</th>
            <th rowSpan={2}  className="bp-th bp-th-spec">Material<br/>Spec</th>
            <th rowSpan={2}  className="bp-th bp-th-sm">Q'ty<br/>(pcs.)</th>
            <th colSpan={2}  className="bp-th bp-th-group">Weight<br/>(g./pc.)</th>
            <th rowSpan={2}  className="bp-th bp-th-sm">Price/pcs,<br/>kgs (baht)</th>
            <th colSpan={5}  className="bp-th bp-th-group">Material cost/unit (baht)</th>
            <th colSpan={4}  className="bp-th bp-th-group">Supplier</th>
            <th rowSpan={2}  className="bp-th bp-th-xs">Recie-<br/>ver</th>
            <th rowSpan={2}  className="bp-th bp-th-xs">Internal<br/>Code</th>
            <th rowSpan={2}  className="bp-th bp-th-xs">Q'ty/<br/>kanban<br/>(pcs,kgs)</th>
            <th rowSpan={2}  className="bp-th bp-th-xs">Lead<br/>time<br/>(day)</th>
            <th rowSpan={2}  className="bp-th bp-th-remark">Remark</th>
          </tr>
          <tr>
            {[1,2,3,4,5].map(n=><th key={n} className="bp-th bp-th-pn">{n}</th>)}
            <th className="bp-th bp-th-xs">Part</th>
            <th className="bp-th bp-th-xs">Gate</th>
            {[1,2,3,4,5].map(n=><th key={n} className="bp-th bp-th-xs">{n}</th>)}
            {['M/C','T/T','Local','Import'].map(s=><th key={s} className="bp-th bp-th-xs">{s}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row,i)=><BomRow key={i} row={row}/>)}
        </tbody>
        <tfoot>
          <tr>
            {/* A = Engineering, B = Part Control, C = Purchase */}
            <td colSpan={5}  className="bp-mark">A</td>
            <td colSpan={1}  className="bp-mark">A</td>
            <td colSpan={1}  className="bp-mark">A</td>
            <td colSpan={2}  className="bp-mark">A</td>
            <td colSpan={2}  className="bp-mark">C</td>
            <td colSpan={5}  className="bp-mark">C</td>
            <td colSpan={4}  className="bp-mark">C</td>
            <td colSpan={1}  className="bp-mark">B</td>
            <td colSpan={1}  className="bp-mark">B</td>
            <td colSpan={1}  className="bp-mark">B</td>
            <td colSpan={2}  className="bp-mark">C</td>
          </tr>
        </tfoot>
      </table>

      {/* ══════════════════════════════════════════════════════
          BLOCK 3 — Footer: Note | Revision Record | Route
          Uses same <Cols/> colgroup so columns align with BOM table above.
          Note = cols 1-6 (colSpan=6)
          Mark = col 7  (colSpan=1)   ← same as Material Spec
          Rev  = cols 8-17 (colSpan=10) ← Q'ty(pcs.) … M/C
          ECI  = cols 18-19 (colSpan=2) ← T/T … Local
          Date = cols 20-21 (colSpan=2) ← Import … Recie-ver
          Rsnr = cols 22-23 (colSpan=2) ← Internal Code … Q'ty/kanban
          Appr = cols 24-25 (colSpan=2) ← Lead time … Remark
         ══════════════════════════════════════════════════════ */}
      <table className="bp-bot-tbl">
        <Cols />
        <tbody>
          {/* Row 1: Note (no rowSpan — fits content) + revision headers */}
          <tr>
            <td className="bp-note-cell" colSpan={6}>
              <div style={{fontWeight:700,marginBottom:2}}>Note :</div>
              <div className="bp-note-line">- First issue</div>
              <div className="bp-note-line">'A' = Record by Engineering section&nbsp;&nbsp;Update ECI No.</div>
              <div className="bp-note-line">'B' = Record by Part Control section</div>
              <div className="bp-note-line">'C' = Record by Purchase section</div>
            </td>
            <td className="bp-rev-th" colSpan={1}>Mark</td>
            <td className="bp-rev-th" colSpan={10}>Revision record</td>
            <td className="bp-rev-th" colSpan={2}>ECI No.</td>
            <td className="bp-rev-th" colSpan={2}>Date</td>
            <td className="bp-rev-th" colSpan={2}>Revisioner</td>
            <td className="bp-rev-th" colSpan={2}>Approved</td>
          </tr>
          {/* Revision data rows — cols 1-6 are invisible spacers */}
          {revisions.map((rev,i)=>{
            const isFirst = !rev.mark || rev.mark === '–' || rev.mark === '-'
            return (
              <tr key={i}>
                <td colSpan={6} className="bp-bot-spacer"/>
                <td className="bp-rev-td" colSpan={1} style={{textAlign:'center'}}>{isFirst ? '△' : `△${rev.mark}`}</td>
                <td className="bp-rev-td" colSpan={10}>{rev.revision_record ?? ''}</td>
                <td className="bp-rev-td" colSpan={2} style={{textAlign:'center'}}>{rev.eci_no ?? ''}</td>
                <td className="bp-rev-td" colSpan={2} style={{textAlign:'center'}}>{rev.revision_date ?? ''}</td>
                <td className="bp-rev-td" colSpan={2}>
                  {isFirst
                    ? <input className="bp-rev-input" value={header.revisioner} onChange={e=>onField('revisioner',e.target.value)} placeholder="ผู้แก้ไข"/>
                    : rev.revisioner ?? ''}
                </td>
                <td className="bp-rev-td" colSpan={2}>
                  {isFirst
                    ? <input className="bp-rev-input" value={header.approved_by} onChange={e=>onField('approved_by',e.target.value)} placeholder="ผู้อนุมัติ"/>
                    : rev.approved_by ?? ''}
                </td>
              </tr>
            )
          })}
          {Array(Math.max(0,5-revisions.length)).fill(null).map((_,i)=>(
            <tr key={`e${i}`}>
              <td colSpan={6} className="bp-bot-spacer"/>
              <td className="bp-rev-td" colSpan={1}/>
              <td className="bp-rev-td" colSpan={10}/>
              <td className="bp-rev-td" colSpan={2}/>
              <td className="bp-rev-td" colSpan={2}/>
              <td className="bp-rev-td" colSpan={2}/>
              <td className="bp-rev-td" colSpan={2}/>
            </tr>
          ))}
          {/* Route row */}
          <tr>
            <td colSpan={6} className="bp-bot-spacer"/>
            <td className="bp-route-cell" colSpan={19}>
              <div className="bp-route">
                <span className="bp-route-lbl">ROUTE :</span>
                <span className="bp-route-box">Production Eng.</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-note">Before OTS = 2 months or<br/>1 weeks after each event</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-box">Purchase</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-note">1 week</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-box">Plant Admin.</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-note">1 week</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-box">Production Eng. (Keep)</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Document code — bottom left (matches FM-PE30/SSE-007 in reference) */}
      <div className="bp-footer">FM-PE30/SSE-007 Rev.01 (14/OCT/14) Approved SSE</div>

    </div>
  )
}

/* ── interactive checkbox ── */
function Chk({ checked, onChange }) {
  return (
    <span className="bp-chk" onClick={onChange}>
      {checked
        ? <span className="bp-chk-on">✔</span>
        : <span className="bp-chk-off" />
      }
    </span>
  )
}

/* ── single BOM row with revision history support ── */
function BomRow({ row }) {
  if (!row) return (
    <tr className="bp-row-empty">
      {Array(25).fill(null).map((_, i) => <td key={i} className="bp-td-empty" />)}
    </tr>
  )

  const lv = row.level ?? 1
  const updateLevel = row.update_level ?? 0
  const isRevisedOut = row.status === 'revised_out'
  const displayLevel = isRevisedOut ? updateLevel - 1 : updateLevel

  const spec = [
    row.note,
    row.product_standards && row.product_standards !== 'NO' ? row.product_standards : null,
    row.material_standards && row.material_standards !== 'NO' ? row.material_standards : null,
  ].filter(Boolean).join('  ')

  return (
    <tr className={`bp-row bp-row-lv${lv}${isRevisedOut ? ' bp-row-revised-out' : ''}`}>
      {[1, 2, 3, 4, 5].map(n => (
        <td key={n} className={`bp-td bp-td-pn bp-td-pn${n}`}>
          {n === lv ? (
            <div className="bp-pn-cell">
              <div className="bp-pn-line">
                {displayLevel > 0 && <span className="bp-tri-mark">△{displayLevel}</span>}
                <span>{row.tg_part_no ?? ''}</span>
              </div>
            </div>
          ) : ''}
        </td>
      ))}
      <td className="bp-td bp-td-name">{row.part_name}</td>
      <td className="bp-td bp-td-spec">{spec}</td>
      <td className="bp-td bp-td-c">{row.quantity != null ? Math.round(row.quantity) : ''}</td>
      <td className="bp-td bp-td-c">{row.mass_g != null ? Number(row.mass_g).toLocaleString() : ''}</td>
      <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
      {[0, 1, 2, 3, 4].map(i => <td key={i} className="bp-td bp-td-c" />)}
      {[0, 1, 2, 3].map(i => <td key={i} className="bp-td bp-td-c" />)}
      <td className="bp-td bp-td-c" />
      <td className="bp-td bp-td-c" />
      <td className="bp-td bp-td-c" />
      <td className="bp-td bp-td-c" />
      <td className="bp-td bp-td-remark" />
    </tr>
  )
}

/* ── Revision / Update dialog ── */
function RevisionDialog({ bom, onClose, onDone }) {
  const [eciNo, setEciNo] = useState('')
  const [revDate, setRevDate] = useState(new Date().toISOString().split('T')[0])
  const [revisioner, setRevisioner] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const [newTgt, setNewTgt] = useState('')
  const [itemUpdates, setItemUpdates] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const allItems = (bom.items ?? []).filter(it => it.tg_part_no)

  function onItemChange(id, val) {
    setItemUpdates(prev => ({ ...prev, [id]: val }))
  }

  async function submit() {
    const items = Object.entries(itemUpdates)
      .filter(([, v]) => v.trim())
      .map(([bom_id, new_part_no]) => ({ bom_id: parseInt(bom_id), new_part_no: new_part_no.trim() }))

    if (!items.length && !newTgt.trim()) {
      setError('ไม่มีการเปลี่ยนแปลงใดๆ')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/bom/${bom.id}/revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eci_no: eciNo.trim() || null,
          revision_date: revDate || null,
          revisioner: revisioner.trim() || null,
          approved_by: approvedBy.trim() || null,
          items,
          new_tg_part_no: newTgt.trim() || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      onDone()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="rev-dlg-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rev-dlg">
        <div className="rev-dlg__hdr">
          <span>△ บันทึก Update / Revision</span>
          <button className="rev-dlg__close" onClick={onClose}>✕</button>
        </div>
        <div className="rev-dlg__body">
          <div className="rev-dlg__grid">
            <label>ECI No.</label>
            <input value={eciNo} onChange={e => setEciNo(e.target.value)} placeholder="26A376" />
            <label>Date</label>
            <input type="date" value={revDate} onChange={e => setRevDate(e.target.value)} />
            <label>Revisioner</label>
            <input value={revisioner} onChange={e => setRevisioner(e.target.value)} />
            <label>Approved</label>
            <input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} />
            <label>TGT Part No. ใหม่</label>
            <input value={newTgt} onChange={e => setNewTgt(e.target.value)} placeholder={bom.tg_part_no ?? ''} />
          </div>

          <div className="rev-dlg__section-title">
            Part No. ที่เปลี่ยน — ระบุค่าใหม่เฉพาะรายการที่เปลี่ยน (เว้นว่างถ้าไม่เปลี่ยน)
          </div>
          <div className="rev-dlg__items">
            <div className="rev-dlg__items-hdr">
              <span>Lv</span><span>Part No. ปัจจุบัน</span><span>Part Name</span><span>Part No. ใหม่</span>
            </div>
            {allItems.map(item => (
              <div key={item.id} className="rev-dlg__item-row">
                <span className="rev-dlg__lv">{item.level}</span>
                <span className="rev-dlg__cur-pn">{item.tg_part_no}</span>
                <span className="rev-dlg__name">{item.part_name}</span>
                <input
                  className="rev-dlg__new-pn"
                  placeholder="ใส่ค่าใหม่…"
                  value={itemUpdates[item.id] ?? ''}
                  onChange={e => onItemChange(item.id, e.target.value)}
                />
              </div>
            ))}
          </div>

          {error && <div className="rev-dlg__error">⚠ {error}</div>}

          <div className="rev-dlg__footer">
            <button className="bdv-btn bdv-btn--secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
            <button className="bdv-btn" onClick={submit} disabled={saving}>
              {saving ? 'กำลังบันทึก…' : 'บันทึก Update'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
