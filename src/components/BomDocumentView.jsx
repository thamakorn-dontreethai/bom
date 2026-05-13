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
  '1': 'Key 1 — NH-900L (Black)',
  '2': 'Key 2 — NH-1168L (Light Soft Gray)',
}

function groupByKey(items) {
  const buckets = {}
  items.forEach(it => {
    const k = it.key_code ?? '1'
    if (!buckets[k]) buckets[k] = []
    buckets[k].push(it)
  })
  return Object.entries(buckets)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([key, rows]) => ({
      key,
      label: KEY_LABELS[key] ?? `Key ${key}`,
      rows: flatten(buildTree(rows)),
    }))
}

export default function BomDocumentView({ bom }) {
  const pageRefs = useRef([])
  const [busy, setBusy] = useState(false)

  async function download() {
    const refs = pageRefs.current.filter(Boolean)
    if (!refs.length) return
    setBusy(true)
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()

      for (let i = 0; i < refs.length; i++) {
        const el = refs[i]
        if (i > 0) pdf.addPage()
        const canvas = await html2canvas(el, {
          scale: 2, useCORS: true, backgroundColor: '#fff',
          width: el.scrollWidth, height: el.scrollHeight, windowWidth: el.scrollWidth,
        })
        const ratio = canvas.height / canvas.width
        const iw = pw
        const ih = iw * ratio
        // if taller than one page, slice it
        let y = 0
        while (y < ih) {
          if (y > 0) pdf.addPage()
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, -y, iw, ih)
          y += ph
        }
      }
      pdf.save(`BOM-${bom.model ?? bom.id}.pdf`)
    } finally { setBusy(false) }
  }

  const groups = groupByKey(bom.items ?? [])
  console.log('[BOM] groups:', groups.map(g => ({ key: g.key, count: g.rows.length, first: g.rows[0]?.tg_part_no })))
  const pages = groups.length > 0 ? groups : [{ key: '0', label: '', rows: [] }]
  const total = pages.length

  return (
    <div className="bdv-wrap">
      <div className="bdv-toolbar">
        <button className="bdv-btn" onClick={download} disabled={busy}>
          {busy ? 'กำลัง Generate…' : '⬇ Download PDF'}
        </button>
      </div>
      <div className="bdv-scroll">
        {pages.map((g, idx) => {
          const rows = [...g.rows]
          const need = Math.max(0, MIN_ROWS - rows.length)
          for (let j = 0; j < need; j++) rows.push(null)
          return (
            <div
              key={g.key}
              ref={el => { pageRefs.current[idx] = el }}
              className="bdv-paper"
            >
              <BomPage
                bom={bom}
                rows={rows}

                pageNum={idx + 1}
                totalPages={total}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────
   Full page — matches BOM 3GJ HE.pdf layout
───────────────────────────────────────────────────────── */
function BomPage({ bom, rows, pageNum, totalPages }) {
  return (
    <div className="bp">

      {/* ═══ Document header ═══════════════════════════════ */}
      <table className="bp-hdr-tbl">
        <colgroup>
          <col style={{width:'180px'}}/>
          <col style={{width:'120px'}}/>
          <col style={{width:'260px'}}/>
          <col style={{width:'60px'}}/>
          <col style={{width:'220px'}}/>
          <col style={{width:'80px'}}/>
          <col />
        </colgroup>
        <tbody>
          {/* Row 1: event issue | title | page | sign */}
          <tr>
            <td className="bp-event" rowSpan={4}>
              <div className="bpe-row"><b>Event issue</b><span style={{marginLeft:20}}><b>Concern with</b></span></div>
              <div className="bpe-row"><Chk/>First issue<span style={{marginLeft:12}}><Chk/>Drawing : Rev. –</span></div>
              <div className="bpe-row"><Chk/>CV<span style={{marginLeft:24}}><Chk/>Actual Part : stage</span></div>
              <div className="bpe-row"><Chk/>MQ<span style={{marginLeft:24}}><Chk/>Purchase Part control</span></div>
              <div className="bpe-row"><Chk/>SOP</div>
            </td>
            <td className="bp-title" colSpan={4}><b>BILL OF MATERIAL</b></td>
            <td className="bp-page-cell" style={{textAlign:'right',verticalAlign:'top',fontSize:'7px',paddingRight:4}}>
              Page {pageNum} of {totalPages}
            </td>
            <td className="bp-sign-outer" rowSpan={4}>
              <table className="bp-sign-tbl">
                <tbody>
                  <tr>
                    <td>Pro. Eng.</td>
                    <td>CO-OR</td>
                    <td>AGM</td>
                    <td>Mgr.</td>
                  </tr>
                  <tr>
                    <td colSpan={2}>Purchase</td>
                    <td colSpan={2}>Part control</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          {/* Row 2: Type / Customer Part No. / Customer Name */}
          <tr>
            <td className="bp-lbl">Type :</td>
            <td className="bp-val"><b>{bom.type ?? 'HE'}</b></td>
            <td className="bp-lbl" colSpan={2}>Customer Part No. : <b>{bom.customer_part_no}</b></td>
            <td className="bp-lbl">Customer Name :</td>
            <td className="bp-val"><b>{bom.customer_name ?? bom.customer}</b></td>
          </tr>
          {/* Row 3: Model No. / TGT Part No. / Date */}
          <tr>
            <td className="bp-lbl">Model No. :</td>
            <td className="bp-val"><b>{bom.model}</b></td>
            <td className="bp-lbl" colSpan={2}>TGT Part No. : <b>{bom.tg_part_no}</b></td>
            <td className="bp-lbl">Date :</td>
            <td className="bp-val"><b>{bom.date}</b></td>
          </tr>
          {/* Row 4: Model Name / Part name */}
          <tr>
            <td className="bp-lbl">Model Name :</td>
            <td className="bp-val"><b>{bom.model_name}</b></td>
            <td className="bp-lbl" colSpan={2}>Part name : <b>{bom.part_name}</b></td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      {/* ═══ Main BOM table ════════════════════════════════ */}
      <table className="bp-bom-tbl">
        <thead>
          <tr>
            <th colSpan={5} className="bp-th bp-th-group">Part No.</th>
            <th rowSpan={2} className="bp-th bp-th-name">Part name</th>
            <th rowSpan={2} className="bp-th bp-th-spec">Material<br/>Spec</th>
            <th rowSpan={2} className="bp-th bp-th-sm">Q'ty<br/>(pcs.)</th>
            <th rowSpan={2} className="bp-th bp-th-sm">Weight<br/>(g./pc.)</th>
            <th colSpan={2} className="bp-th bp-th-group">Price/pcs,<br/>kgs (baht)</th>
            <th colSpan={5} className="bp-th bp-th-group">Material cost/unit (baht)</th>
            <th colSpan={4} className="bp-th bp-th-group">Supplier</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Recie-<br/>ver</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Internal<br/>Code</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Q'ty/<br/>kanban<br/>(pcs,kgs)</th>
            <th rowSpan={2} className="bp-th bp-th-xs">Lead<br/>time<br/>(day)</th>
            <th rowSpan={2} className="bp-th bp-th-remark">Remark</th>
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
          {rows.map((row, i) => <BomRow key={i} row={row} />)}
        </tbody>
      </table>

      {/* ═══ Mark row ══════════════════════════════════════ */}
      <table className="bp-mark-tbl">
        <tbody>
          <tr>
            <td className="bp-mark"/><td className="bp-mark">A</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">A</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">A</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">A</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">C</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">C</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">C</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">B</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">B</td>
            <td className="bp-mark-w"/>
            <td className="bp-mark">B</td>
          </tr>
        </tbody>
      </table>

      {/* ═══ Bottom: Note + Revision + Route ══════════════ */}
      <table className="bp-bot-tbl">
        <tbody>
          <tr>
            <td className="bp-note-cell" rowSpan={2}>
              <div style={{fontWeight:700,marginBottom:2}}>Note :</div>
              <div className="bp-note-line">- First issue</div>
              <div className="bp-note-line">'A' = Record by Engineering section&nbsp;&nbsp;Update ECI No.</div>
              <div className="bp-note-line">'B' = Record by Part Control section</div>
              <div className="bp-note-line">'C' = Record by Purchase section</div>
            </td>
            <td style={{padding:0}}>
              <table className="bp-rev-tbl">
                <thead>
                  <tr>
                    <th className="bp-rev-th" style={{width:28}}>Mark</th>
                    <th className="bp-rev-th" style={{width:80}}>Revision record</th>
                    <th className="bp-rev-th" style={{width:60}}>ECI No.</th>
                    <th className="bp-rev-th" style={{width:70}}>Date</th>
                    <th className="bp-rev-th" style={{width:90}}>Revisioner</th>
                    <th className="bp-rev-th" style={{width:90}}>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="bp-rev-td">–</td>
                    <td className="bp-rev-td">First issue</td>
                    <td className="bp-rev-td" style={{textAlign:'center'}}>{bom.internal_eci_no}</td>
                    <td className="bp-rev-td" style={{textAlign:'center'}}>{bom.date}</td>
                    <td className="bp-rev-td">{bom.prepared_by ?? ''}</td>
                    <td className="bp-rev-td">{bom.approved_by ?? ''}</td>
                  </tr>
                  {[1,2,3,4].map(n=>(
                    <tr key={n}>
                      <td className="bp-rev-td"/><td className="bp-rev-td"/>
                      <td className="bp-rev-td"/><td className="bp-rev-td"/>
                      <td className="bp-rev-td"/><td className="bp-rev-td"/>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style={{padding:'2px 4px'}}>
              <div className="bp-route">
                <span className="bp-route-lbl">ROUTE :</span>
                <span className="bp-route-box">Production Eng.</span>
                <span className="bp-route-note">Before OTS = 2 months or<br/>1 weeks after each event</span>
                <span className="bp-route-box">Purchase</span>
                <span className="bp-route-note">1 week</span>
                <span className="bp-route-box">Plant Admin.</span>
                <span className="bp-route-note">1 week</span>
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

/* ── checkbox mark ── */
function Chk() {
  return <span style={{display:'inline-block',width:8,height:8,border:'1px solid #555',marginRight:2,verticalAlign:'middle'}}/>
}

/* ── single BOM row ── */
function BomRow({ row }) {
  if (!row) return (
    <tr className="bp-row-empty">
      {Array(22).fill(null).map((_,i)=><td key={i} className="bp-td-empty"/>)}
    </tr>
  )
  const lv = row.level ?? 1
  const cols = [null,null,null,null,null]
  cols[lv - 1] = row.tg_part_no

  const spec = [
    row.note,
    row.product_standards && row.product_standards !== 'NO' ? row.product_standards : null,
    row.material_standards && row.material_standards !== 'NO' ? row.material_standards : null,
  ].filter(Boolean).join('  ')

  return (
    <tr className={['bp-row', lv===1?'bp-row-lv1':''].filter(Boolean).join(' ')}>
      {cols.map((pn,i)=>(
        <td key={i} className={`bp-td bp-td-pn bp-td-pn${i+1}`}>{pn??''}</td>
      ))}
      <td className="bp-td bp-td-name">{row.part_name}</td>
      <td className="bp-td bp-td-spec">{spec}</td>
      <td className="bp-td bp-td-c">{row.quantity}</td>
      <td className="bp-td bp-td-c">{row.mass_g != null ? Number(row.mass_g).toLocaleString() : ''}</td>
      {/* Price Part / Gate */}
      <td className="bp-td bp-td-c"/><td className="bp-td bp-td-c"/>
      {/* Material cost 1-5 */}
      {[0,1,2,3,4].map(i=><td key={i} className="bp-td bp-td-c"/>)}
      {/* Supplier M/C T/T Local Import */}
      {[0,1,2,3].map(i=><td key={i} className="bp-td bp-td-c"/>)}
      {/* Recie-ver Internal Q'ty/kanban Lead time Remark */}
      <td className="bp-td bp-td-c"/>
      <td className="bp-td bp-td-c"/>
      <td className="bp-td bp-td-c"/>
      <td className="bp-td bp-td-c"/>
      <td className="bp-td bp-td-remark"/>
    </tr>
  )
}
