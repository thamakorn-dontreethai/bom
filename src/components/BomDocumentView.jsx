import { useRef, useState } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

function buildTree(items) {
  const map = {}
  items.forEach(i => { map[i.id] = { ...i, children: [] } })
  const roots = []
  items.forEach(i => {
    if (i.parent_id && map[i.parent_id]) map[i.parent_id].children.push(map[i.id])
    else roots.push(map[i.id])
  })
  return roots
}
function flatten(nodes) {
  const out = []
  for (const n of nodes) { out.push(n); if (n.children.length) out.push(...flatten(n.children)) }
  return out
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

function groupByKey(items) {
  const keyed = {}   // key_code → items belonging to that key
  const shared = []  // key_code = null → sub-parts without explicit key

  items.forEach(it => {
    if (it.key_code == null) {
      shared.push(it)
    } else {
      const k = String(it.key_code)
      if (!keyed[k]) keyed[k] = []
      keyed[k].push(it)
    }
  })

  const keys = Object.keys(keyed).sort((a, b) => Number(a) - Number(b))

  if (!keys.length) {
    return [{ key: '0', label: '', rows: flatten(buildTree([...shared])) }]
  }

  return keys.map(k => {
    // BFS: seed = this key's own items; iteratively pull in shared items
    // whose parent is already in the seed — prevents other keys' sub-parts
    // from leaking onto this page as orphan roots.
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
      rows: flatten(buildTree(pageItems)),
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
   Full page — matches BOM 3GJ HE.pdf layout
───────────────────────────────────────────────────────── */
function BomPage({ bom, header, onToggle, onField, rows, pageNum, totalPages }) {
  // Revision record rows — use DB data if available, else synthesise first-issue row
  const revisions = bom.revisions?.length > 0
    ? bom.revisions
    : [{ mark: '–', revision_record: 'First issue', eci_no: bom.internal_eci_no, revision_date: bom.date }]

  return (
    <div className="bp">

      {/* Document header */}
      <table className="bp-hdr-tbl">
        <colgroup>
          {[85, 85, 85, 85, 85].map((w, i) => <col key={`pn${i}`} style={{ width: w }} />)}
          <col style={{ width: 160 }} />
          <col style={{ width: 260 }} />
          <col style={{ width: 30 }} />
          <col style={{ width: 26 }} />
          <col style={{ width: 26 }} />
          <col style={{ width: 54 }} />
          {[26, 26, 26, 26, 26].map((w, i) => <col key={`mc${i}`} style={{ width: w }} />)}
          {[24, 24, 24, 24].map((w, i) => <col key={`sp${i}`} style={{ width: w }} />)}
          <col style={{ width: 26 }} />
          <col style={{ width: 30 }} />
          <col style={{ width: 30 }} />
          <col style={{ width: 28 }} />
          <col style={{ width: 36 }} />
        </colgroup>
        <tbody>
          {/* Row 1 — Event Issue | Title | Page | Signature */}
          <tr>
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
                    <td><Chk checked={header.evt_first_issue} onChange={() => onToggle('evt_first_issue')} />First issue</td>
                    <td><Chk checked={header.evt_dan} onChange={() => onToggle('evt_dan')} />DAN</td>
                    <td><Chk checked={header.concern_drawing} onChange={() => onToggle('concern_drawing')} />Drawing : Rev. –</td>
                  </tr>
                  <tr>
                    <td><Chk checked={header.evt_cv} onChange={() => onToggle('evt_cv')} />CV</td>
                    <td><Chk checked={header.evt_hin} onChange={() => onToggle('evt_hin')} />HIN</td>
                    <td><Chk checked={header.concern_actual_part} onChange={() => onToggle('concern_actual_part')} />Actual Part : stage</td>
                  </tr>
                  <tr>
                    <td><Chk checked={header.evt_mq} onChange={() => onToggle('evt_mq')} />MQ</td>
                    <td><Chk checked={header.evt_sop} onChange={() => onToggle('evt_sop')} />SOP</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </td>
            <td className="bp-title" colSpan={9}><b>BILL OF MATERIAL</b></td>
            <td style={{ textAlign: 'right', verticalAlign: 'top', fontSize: '7px', paddingRight: 4 }}>
              Page {pageNum} of {totalPages}
            </td>
            <td className="bp-sign-outer" colSpan={10} rowSpan={4}>
              <table className="bp-sign-tbl">
                <colgroup>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '23%' }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td colSpan={3}>Pro. Eng.</td>
                    <td>Purchase</td>
                    <td>Part control</td>
                  </tr>
                  <tr>
                    <td>CO-OR</td>
                    <td>AGM</td>
                    <td>Mgr.</td>
                    <td rowSpan={2} />
                    <td rowSpan={2} />
                  </tr>
                  <tr style={{ height: 18 }}>
                    <td /><td /><td />
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          {/* Row 2 — Type | Customer Part No. */}
          <tr>
            <td className="bp-lbl" colSpan={2}>Type :</td>
            <td className="bp-val"><b>{bom.type ?? 'HE'}</b></td>
            <td className="bp-lbl" colSpan={3}>Customer Part No. : <b>{bom.customer_part_no}</b></td>
            <td colSpan={9} style={{ border: 'none' }} />
          </tr>
          {/* Row 3 — Model No. | TGT Part No. | Customer Name | HATC | Date | วันที่ */}
          <tr>
            <td className="bp-lbl" colSpan={2}>Model No. :</td>
            <td className="bp-val"><b>{bom.model}</b></td>
            <td className="bp-lbl" colSpan={3}>
              TGT Part No. :{' '}
              <b>
                {(bom.tgt_history ?? []).map((h, i) => (
                  <span key={i} style={{ marginRight: 2 }}>
                    {h.introduced_at > 0 && <span className="bp-tri-hdr">△{h.introduced_at}</span>}
                    <span className="bp-pn-struck">{h.old_tg_part_no}</span>
                    {' '}
                  </span>
                ))}
                {(bom.tgt_update_level ?? 0) > 0 && (
                  <span className="bp-tri-hdr">△{bom.tgt_update_level}</span>
                )}
                {bom.tg_part_no}
              </b>
            </td>
            <td className="bp-lbl" colSpan={4}>Customer Name : <b>{bom.customer_name ?? bom.customer}</b></td>
            <td className="bp-lbl" colSpan={5}>Date : <b>{bom.date}</b></td>
          </tr>
          {/* Row 4 — Model Name | Part name */}
          <tr>
            <td className="bp-lbl" colSpan={2}>Model Name :</td>
            <td className="bp-val"><b>{bom.model_name}</b></td>
            <td className="bp-lbl" colSpan={3}>Part name : <b>{bom.part_name}</b></td>
            <td colSpan={9} style={{ border: 'none' }} />
          </tr>
        </tbody>
      </table>

      {/* ═══ Main BOM table ════════════════════════════════ */}
      <table className="bp-bom-tbl">
        <colgroup>
          {[85, 85, 85, 85, 85].map((w, i) => <col key={i} style={{ width: w }} />)}
          <col style={{ width: 160 }} />
          <col style={{ width: 260 }} />
          <col style={{ width: 30 }} />
          <col style={{ width: 26 }} />
          <col style={{ width: 26 }} /><col style={{ width: 54 }} />
          {[26, 26, 26, 26, 26].map((w, i) => <col key={i} style={{ width: w }} />)}
          {[24, 24, 24, 24].map((w, i) => <col key={i} style={{ width: w }} />)}
          <col style={{ width: 26 }} />
          <col style={{ width: 30 }} />
          <col style={{ width: 30 }} />
          <col style={{ width: 28 }} />
          <col style={{ width: 36 }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={5} className="bp-th bp-th-group">Part No.</th>
            <th rowSpan={2} className="bp-th bp-th-name">Part name</th>
            <th rowSpan={2} className="bp-th bp-th-spec">Material<br />Spec</th>
            <th rowSpan={2} className="bp-th bp-th-sm">Q'ty<br />(pcs.)</th>
            <th colSpan={2} className="bp-th bp-th-group">Weight<br />(g./pc.)</th>
            <th rowSpan={2} className="bp-th bp-th-sm">Price/pcs,<br />kgs (baht)</th>
            <th colSpan={5} className="bp-th bp-th-group">Material cost/unit (baht)</th>
            <th colSpan={4} className="bp-th bp-th-group">Supplier</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Recie-<br />ver</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Internal<br />Code</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Q'ty/<br />kanban<br />(pcs,kgs)</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Lead<br />time<br />(day)</th>
            <th rowSpan={2} className="bp-th bp-th-remark">Remark</th>
          </tr>
          <tr>
            {[1, 2, 3, 4, 5].map(n => <th key={n} className="bp-th bp-th-pn">{n}</th>)}
            <th className="bp-th bp-th-xs">Part</th>
            <th className="bp-th bp-th-xs">Gate</th>
            {[1, 2, 3, 4, 5].map(n => <th key={n} className="bp-th bp-th-xs">{n}</th>)}
            {['M/C', 'T/T', 'Local', 'Import'].map(s => <th key={s} className="bp-th bp-th-xs">{s}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => <BomRow key={i} row={row} />)}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="bp-mark">A</td>
            <td colSpan={1} className="bp-mark">A</td>
            <td colSpan={1} className="bp-mark">A</td>
            <td colSpan={2} className="bp-mark">A</td>
            <td colSpan={2} className="bp-mark">C</td>
            <td colSpan={5} className="bp-mark">C</td>
            <td colSpan={4} className="bp-mark">C</td>
            <td colSpan={1} className="bp-mark">B</td>
            <td colSpan={1} className="bp-mark">B</td>
            <td colSpan={1} className="bp-mark">B</td>
            <td colSpan={2} className="bp-mark">C</td>
          </tr>
        </tfoot>
      </table>

      {/* ═══ Bottom: Note + Revision + Route ══════════════ */}
      <table className="bp-bot-tbl">
        <tbody>
          <tr>
            <td className="bp-note-cell">
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Note :</div>
              <div className="bp-note-line">- First issue</div>
              <div className="bp-note-line">'A' = Record by Engineering section&nbsp;&nbsp;Update ECI No.</div>
              <div className="bp-note-line">'B' = Record by Part Control section</div>
              <div className="bp-note-line">'C' = Record by Purchase section</div>
            </td>
            <td style={{ padding: 0 }}>
              <table className="bp-rev-tbl">
                <thead>
                  <tr>
                    <th className="bp-rev-th" style={{ width: 28 }}>Mark</th>
                    <th className="bp-rev-th" style={{ width: 80 }}>Revision record</th>
                    <th className="bp-rev-th" style={{ width: 60 }}>ECI No.</th>
                    <th className="bp-rev-th" style={{ width: 70 }}>Date</th>
                    <th className="bp-rev-th" style={{ width: 90 }}>Revisioner</th>
                    <th className="bp-rev-th" style={{ width: 90 }}>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((rev, i) => {
                    const isFirst = !rev.mark || rev.mark === '–' || rev.mark === '-'
                    const markDisplay = isFirst ? '△' : `△${rev.mark}`
                    return (
                      <tr key={i}>
                        <td className="bp-rev-td" style={{ textAlign: 'center' }}>{markDisplay}</td>
                        <td className="bp-rev-td">{rev.revision_record ?? ''}</td>
                        <td className="bp-rev-td" style={{ textAlign: 'center' }}>{rev.eci_no ?? ''}</td>
                        <td className="bp-rev-td" style={{ textAlign: 'center' }}>{rev.revision_date ?? ''}</td>
                        <td className="bp-rev-td">
                          {isFirst
                            ? <input className="bp-rev-input" value={header.revisioner} onChange={e => onField('revisioner', e.target.value)} placeholder="ผู้แก้ไข" />
                            : rev.revisioner ?? ''}
                        </td>
                        <td className="bp-rev-td">
                          {isFirst
                            ? <input className="bp-rev-input" value={header.approved_by} onChange={e => onField('approved_by', e.target.value)} placeholder="ผู้อนุมัติ" />
                            : rev.approved_by ?? ''}
                        </td>
                      </tr>
                    )
                  })}
                  {Array(Math.max(0, 5 - revisions.length)).fill(null).map((_, i) => (
                    <tr key={`e${i}`}>
                      <td className="bp-rev-td" /><td className="bp-rev-td" />
                      <td className="bp-rev-td" /><td className="bp-rev-td" />
                      <td className="bp-rev-td" /><td className="bp-rev-td" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td colSpan={2} style={{ padding: '2px 4px' }}>
              <div className="bp-route">
                <span className="bp-route-lbl">ROUTE :</span>
                <span className="bp-route-box">Production Eng.</span>
                <span className="bp-route-arr">→</span>
                <span className="bp-route-note">Before OTS = 2 months or<br />1 weeks after each event</span>
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
  const history = Array.isArray(row.history) ? row.history : []
  const updateLevel = row.update_level ?? 0

  const spec = [
    row.note,
    row.product_standards && row.product_standards !== 'NO' ? row.product_standards : null,
    row.material_standards && row.material_standards !== 'NO' ? row.material_standards : null,
  ].filter(Boolean).join('  ')

  return (
    <tr className={`bp-row bp-row-lv${lv}`}>
      {[1, 2, 3, 4, 5].map(n => (
        <td key={n} className={`bp-td bp-td-pn bp-td-pn${n}`}>
          {n === lv ? (
            <div className="bp-pn-cell">
              {/* History: old part nos with strikethrough */}
              {history.map(h => (
                h.old_tg_part_no ? (
                  <div key={h.superseded_at} className="bp-pn-line">
                    {h.introduced_at > 0 && <span className="bp-tri-mark">△{h.introduced_at}</span>}
                    <span className="bp-pn-struck">{h.old_tg_part_no}</span>
                  </div>
                ) : null
              ))}
              {/* Current part no */}
              <div className="bp-pn-line">
                {updateLevel > 0 && <span className="bp-tri-mark">△{updateLevel}</span>}
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
