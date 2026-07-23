import { useRef, useState, useEffect } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { exportBomToExcel } from '../utils/exportBomExcel'

// Follow the sort_order chain from a revised_out through any intermediate revised_out rows
// to the final active replacement. Handles A(revised)→B(revised)→C(active) chains.
function findActiveReplacement(revisedOut, items) {
  let current = revisedOut
  while (current && current.status === 'revised_out') {
    current = items
      .filter(r => r.sort_order > current.sort_order && r.parent_id === current.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
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

// For each revised_out item, follow the chain to find the final active successor,
// then place ALL revised_out predecessors (sorted oldest-first) before that active item.
// For Level 1 active items with customer_part_no, inject a synthetic _custPnOnly header
// row BEFORE the struck rows so customer_pn always appears first, never struck through.
function insertRevisedOut(flatRows, allItems) {
  const insertBefore = {}

  allItems.forEach(it => {
    if (it.status !== 'revised_out' || it.sort_order == null) return
    // Follow chain to find the final active successor
    let finalActive = allItems
      .filter(r => r.sort_order > it.sort_order && r.parent_id === it.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
    while (finalActive && finalActive.status === 'revised_out') {
      finalActive = allItems
        .filter(r => r.sort_order > finalActive.sort_order && r.parent_id === finalActive.parent_id)
        .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null
    }
    if (finalActive) {
      if (!insertBefore[finalActive.id]) insertBefore[finalActive.id] = []
      insertBefore[finalActive.id].push(it)
    }
  })
  // Sort each group oldest-first by sort_order
  Object.values(insertBefore).forEach(arr => arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))

  const result = []
  const placed = new Set()
  for (const row of flatRows) {
    if (row?.id != null && insertBefore[row.id]) {
      const lv = row.level ?? row.bom_level ?? 1
      const hasCust = lv === 1 && !!row.customer_part_no && row.status !== 'revised_out'
      if (hasCust) {
        // Inject customer_pn header BEFORE struck rows — never struck, always first
        result.push({ ...row, _custPnOnly: true })
      }
      for (const ro of insertBefore[row.id]) {
        result.push(ro)
        placed.add(ro.id)
      }
      // Active item skips re-rendering its customer_pn (already injected above)
      result.push(hasCust ? { ...row, _skipCustPn: true } : row)
    } else {
      result.push(row)
    }
  }
  // Revised_out items with no active successor: append at end
  allItems.forEach(it => {
    if (it.status !== 'revised_out' || placed.has(it.id)) return
    result.push(it)
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

export default function BomDocumentView({ bom, onRefresh }) {
  const pageRefs = useRef([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [blinking, setBlinking] = useState(false)
  const [showExcelMenu, setShowExcelMenu] = useState(false)
  const [showRevDialog, setShowRevDialog] = useState(false)
  const [showApprovalDialog, setShowApprovalDialog] = useState(false)
  const [approvalEmail, setApprovalEmail] = useState('')
  const [approvalStatus, setApprovalStatus] = useState(null) // null | 'sending' | 'ok' | 'err:...'

  // Subscribe to SSE stream after email sent — instant notification when approved
  useEffect(() => {
    if (approvalStatus !== 'ok') return
    const es = new EventSource(`/api/approval/events/${bom.id}`)
    es.addEventListener('approved', () => {
      onRefresh?.()
      es.close()
    })
    return () => es.close()
  }, [approvalStatus])

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
    customer_name: bom.customer_name ?? bom.customer ?? '',
  })

  // editable revisioner/approved_by for every non-first revision row
  const [revNames, setRevNames] = useState(() => {
    const m = {}
    ;(bom.revisions ?? []).forEach(r => {
      if (r.mark && r.mark !== '–' && r.mark !== '-') {
        m[r.mark] = { revisioner: r.revisioner ?? '', approved_by: r.approved_by ?? '' }
      }
    })
    return m
  })

  useEffect(() => {
    setHeader({
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
      customer_name: bom.customer_name ?? bom.customer ?? '',
    })
    const m = {}
    ;(bom.revisions ?? []).forEach(r => {
      if (r.mark && r.mark !== '–' && r.mark !== '-') {
        m[r.mark] = { revisioner: r.revisioner ?? '', approved_by: r.approved_by ?? '' }
      }
    })
    setRevNames(m)
  }, [bom])

  function setRevName(mark, field, val) {
    setRevNames(prev => ({ ...prev, [mark]: { ...(prev[mark] ?? {}), [field]: val } }))
  }

  function onToggle(key) { setHeader(h => ({ ...h, [key]: !h[key] })) }
  function onField(key, val) { setHeader(h => ({ ...h, [key]: val })) }

  async function saveHeader() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const r = await fetch(`/api/bom/${bom.id}/header`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...header,
          rev_names: Object.entries(revNames).map(([mark, v]) => ({ mark, ...v })),
        }),
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

  function showAllPages() {
    pageRefs.current.filter(Boolean).forEach(el => { el.style.display = 'block' })
  }
  function restorePages() {
    pageRefs.current.filter(Boolean).forEach((el, i) => {
      el.style.display = pages[i]?.key === effectiveKey ? 'block' : 'none'
    })
  }

  async function download() {
    const refs = pageRefs.current.filter(Boolean)
    if (!refs.length) return
    setBusy(true)
    showAllPages()
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const margin = 5
      const availW = pw - margin * 2
      const availH = ph - margin * 2
      const targetPx = Math.round((availW / 25.4) * 96)
      const targetPxH = Math.round((availH / 25.4) * 96)

      for (let i = 0; i < refs.length; i++) {
        const el = refs[i]
        if (i > 0) pdf.addPage()
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#fff',
          windowWidth: targetPx,
          windowHeight: targetPxH,
          onclone: (_doc, clonedEl) => {
            clonedEl.style.width = targetPx + 'px'
            clonedEl.style.minWidth = targetPx + 'px'
            clonedEl.style.maxWidth = targetPx + 'px'
            clonedEl.style.boxSizing = 'border-box'
            // Expand empty rows so grid fills full A3 height and footer sits at bottom
            const hdrTbl = clonedEl.querySelector('table.bp-hdr-tbl')
            const bomTbl = clonedEl.querySelector('table.bp-bom-tbl')
            const botTbl = clonedEl.querySelector('table.bp-bot-tbl')
            if (hdrTbl && bomTbl && botTbl) {
              const hdrH = hdrTbl.getBoundingClientRect().height
              const botH = botTbl.getBoundingClientRect().height
              const bomAvailH = targetPxH - hdrH - botH - 10.5
              const theadH = Array.from(bomTbl.querySelectorAll('thead tr'))
                .reduce((s, tr) => s + tr.getBoundingClientRect().height, 0)
              const tfootH = Array.from(bomTbl.querySelectorAll('tfoot tr'))
                .reduce((s, tr) => s + tr.getBoundingClientRect().height, 0)
              const tbodyRows = Array.from(bomTbl.querySelectorAll('tbody tr'))
              const rowH = (bomAvailH - theadH - tfootH) / tbodyRows.length
              if (rowH > 0) tbodyRows.forEach(tr => { tr.style.height = rowH + 'px' })
            }
            _doc.querySelectorAll('input.bp-rev-input').forEach(inp => {
              const span = _doc.createElement('span')
              span.textContent = inp.value
              span.style.cssText = 'font-family:Arial,sans-serif;font-size:7.5px;color:#000;display:inline-block;width:100%'
              inp.parentNode.replaceChild(span, inp)
            })
            _doc.querySelectorAll('.bp-row-revised-out td').forEach(td => {
              td.style.textDecoration = 'line-through'
              td.style.color = '#cc0000'
              td.querySelectorAll('div, span').forEach(el => {
                el.style.textDecoration = 'line-through'
                el.style.color = '#cc0000'
              })
            })
          },
        })
        const ratio = canvas.height / canvas.width
        const iw = availW
        const ih = iw * ratio
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, iw, ih)
      }
      pdf.save(`BOM-${bom.tg_part_no ?? bom.model ?? bom.id}.pdf`)
    } catch (e) {
      console.error('PDF error', e)
    } finally {
      restorePages()
      setBusy(false)
    }
  }

  async function generatePdfBase64() {
    showAllPages()
    const refs = pageRefs.current.filter(Boolean)
    if (!refs.length) return null
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const margin = 5
    const availW = pw - margin * 2
    const availH = ph - margin * 2
    const targetPx = Math.round((availW / 25.4) * 96)
    const targetPxH = Math.round((availH / 25.4) * 96)
    for (let i = 0; i < refs.length; i++) {
      if (i > 0) pdf.addPage()
      const canvas = await html2canvas(refs[i], {
        scale: 2, useCORS: true, backgroundColor: '#fff', windowWidth: targetPx, windowHeight: targetPxH,
        onclone: (_doc, clonedEl) => {
          clonedEl.style.width = targetPx + 'px'
          clonedEl.style.minWidth = targetPx + 'px'
          clonedEl.style.maxWidth = targetPx + 'px'
          clonedEl.style.boxSizing = 'border-box'
          const hdrTbl2 = clonedEl.querySelector('table.bp-hdr-tbl')
          const bomTbl2 = clonedEl.querySelector('table.bp-bom-tbl')
          const botTbl2 = clonedEl.querySelector('table.bp-bot-tbl')
          if (hdrTbl2 && bomTbl2 && botTbl2) {
            const hdrH = hdrTbl2.getBoundingClientRect().height
            const botH = botTbl2.getBoundingClientRect().height
            const bomAvailH = targetPxH - hdrH - botH - 10.5
            const theadH2 = Array.from(bomTbl2.querySelectorAll('thead tr'))
              .reduce((s, tr) => s + tr.getBoundingClientRect().height, 0)
            const tfootH2 = Array.from(bomTbl2.querySelectorAll('tfoot tr'))
              .reduce((s, tr) => s + tr.getBoundingClientRect().height, 0)
            const tbodyRows2 = Array.from(bomTbl2.querySelectorAll('tbody tr'))
            const rowH2 = (bomAvailH - theadH2 - tfootH2) / tbodyRows2.length
            if (rowH2 > 0) tbodyRows2.forEach(tr => { tr.style.height = rowH2 + 'px' })
          }
          _doc.querySelectorAll('input.bp-rev-input').forEach(inp => {
            const span = _doc.createElement('span')
            span.textContent = inp.value
            span.style.cssText = 'font-family:Arial,sans-serif;font-size:7.5px;color:#000;display:inline-block;width:100%'
            inp.parentNode.replaceChild(span, inp)
          })
          _doc.querySelectorAll('.bp-row-revised-out td').forEach(td => {
            td.style.textDecoration = 'line-through'
            td.style.color = '#cc0000'
          })
        },
      })
      const ratio2 = canvas.height / canvas.width
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, availW, availW * ratio2)
    }
    const result = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.replace(/^data:application\/pdf;base64,/, ''))
      reader.onerror = reject
      reader.readAsDataURL(pdf.output('blob'))
    })
    restorePages()
    return result
  }

  async function sendApproval() {
    if (!approvalEmail) return
    setApprovalStatus('sending')
    try {
      const pdfBase64 = await generatePdfBase64()
      const r = await fetch('/api/approval/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bomId: bom.id, recipientEmail: approvalEmail, pdfBase64 }),
      })
      const data = await r.json()
      if (r.ok) { setApprovalStatus('ok') }
      else { setApprovalStatus('err:' + (data.detail ?? data.error ?? 'unknown')) }
    } catch (e) { setApprovalStatus('err:' + e.message) }
  }

  const groups = groupByKey(bom.items ?? [])
  const pages = groups.length > 0 ? groups : [{ key: '0', label: '', rows: [] }]
  const total = pages.length
  const [activeKey, setActiveKey] = useState(null)
  const effectiveKey = activeKey ?? pages[0]?.key ?? '0'

  return (
    <div className="bdv-wrap">
      <div className="bdv-toolbar">
        {/* group 1 — save */}
        <button className="bdv-btn bdv-btn--secondary" onClick={saveHeader} disabled={saving || busy}>
          {saving ? 'กำลังบันทึก…' : '💾 บันทึก'}
        </button>
        <button className="bdv-btn bdv-btn--rev" onClick={() => setShowRevDialog(true)} disabled={busy || saving}>
          บันทึก Update
        </button>
        <div className="bdv-toolbar-sep" />
        <button
          className="bdv-btn bdv-btn--danger"
          disabled={busy || saving}
          onClick={async () => {
            if (!window.confirm('ลบข้อมูล revision ทั้งหมดและ reset กลับสู่สภาพเริ่มต้น?')) return
            await fetch(`/api/bom/${bom.id}/revisions/reset`, { method: 'DELETE' })
            onRefresh?.()
          }}
        >
          ↺ Reset
        </button>
        <div className="bdv-toolbar-sep" />

        {/* group 2 — export */}
        <button className="bdv-btn" onClick={download} disabled={busy || saving}>
          {busy ? 'กำลัง Generate…' : '⬇ PDF'}
        </button>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button
            className="bdv-btn bdv-btn--excel"
            disabled={busy || saving}
            onClick={() => {
              if (pages.length <= 1) { exportBomToExcel(bom, 'all'); return }
              setShowExcelMenu(v => !v)
            }}
          >
            📊 Excel{pages.length > 1 ? ' ▾' : ''}
          </button>
          {showExcelMenu && pages.length > 1 && (
            <div
              style={{ position:'absolute', top:'100%', left:0, background:'#fff', border:'1px solid #ccc', borderRadius:4, boxShadow:'0 2px 8px rgba(0,0,0,.15)', zIndex:100, minWidth:120 }}
              onMouseLeave={() => setShowExcelMenu(false)}
            >
              {pages.map(p => (
                <div
                  key={p.key}
                  style={{ padding:'6px 14px', cursor:'pointer', fontSize:12, whiteSpace:'nowrap' }}
                  onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
                  onMouseLeave={e => e.currentTarget.style.background=''}
                  onClick={() => { exportBomToExcel(bom, p.key); setShowExcelMenu(false) }}
                >
                  Key {p.key}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bdv-toolbar-sep" />

        {/* group 4 — utility */}
        <button
          className="bdv-btn bdv-btn--secondary"
          disabled={busy || saving || refreshing}
          onClick={async () => { setRefreshing(true); setBlinking(true); await onRefresh?.(); setRefreshing(false) }}
        >
          {refreshing ? 'โหลด…' : '↻ Refresh'}
        </button>
        <button className="bdv-btn bdv-btn--approval" onClick={() => { setShowApprovalDialog(true); setApprovalStatus(null); setApprovalEmail('') }} disabled={busy || saving}>
          ✉ ส่งขออนุมัติ
        </button>

        {/* save message — right aligned */}
        <div className="bdv-toolbar-spacer" />
        {saveMsg === 'ok' && <span className="bdv-save-msg bdv-save-msg--ok">✓ บันทึกแล้ว</span>}
        {saveMsg === 'err' && <span className="bdv-save-msg bdv-save-msg--err">⚠ บันทึกไม่สำเร็จ</span>}
      </div>

      {/* ── Approval dialog ── */}
      {showApprovalDialog && (
        <div className="bdv-overlay">
          <div className="apv-dialog">

            {/* Header */}
            <div className="apv-header">
              <div className="apv-header-icon">✉</div>
              <div>
                <div className="apv-header-title">ส่งขออนุมัติ BOM</div>
                <div className="apv-header-sub">ระบบจะส่ง link ให้ผู้รับกรอกลายเซ็นใน Approved by</div>
              </div>
              {approvalStatus !== 'sending' && (
                <button className="apv-close" onClick={() => setShowApprovalDialog(false)}>✕</button>
              )}
            </div>

            {/* BOM context chip */}
            <div className="apv-context">
              <span className="apv-context-label">เอกสาร</span>
              <span className="apv-context-val">{bom.tg_part_no ?? bom.customer_part_no}</span>
              <span className="apv-context-dot">·</span>
              <span className="apv-context-val">{bom.model}</span>
              <span className="apv-context-dot">·</span>
              <span className="apv-context-val">{bom.customer_name ?? bom.customer}</span>
            </div>

            {/* Body */}
            {approvalStatus === 'ok' ? (
              <div className="apv-success">
                <div className="apv-success-icon">✓</div>
                <div className="apv-success-title">ส่ง Email เรียบร้อยแล้ว</div>
                <div className="apv-success-sub">ส่งไปที่ <b>{approvalEmail}</b></div>
                <button className="apv-btn apv-btn--primary" style={{marginTop:20}} onClick={() => setShowApprovalDialog(false)}>
                  ปิด
                </button>
              </div>
            ) : approvalStatus?.startsWith('err') ? (
              <div className="apv-error-body">
                <div className="apv-error-icon">⚠</div>
                <div className="apv-error-title">ส่งไม่สำเร็จ</div>
                <div className="apv-error-msg">{approvalStatus.slice(4)}</div>
                <div className="apv-actions">
                  <button className="apv-btn apv-btn--secondary" onClick={() => setShowApprovalDialog(false)}>ปิด</button>
                  <button className="apv-btn apv-btn--primary" onClick={() => setApprovalStatus(null)}>ลองใหม่</button>
                </div>
              </div>
            ) : (
              <div className="apv-form">
                <label className="apv-label">
                  Email ผู้อนุมัติ
                  <span className="apv-required">*</span>
                </label>
                <div className={`apv-input-wrap${approvalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail) ? ' apv-input-wrap--err' : ''}`}>
                  <span className="apv-input-icon">@</span>
                  <input
                    className="apv-input"
                    type="email"
                    placeholder="approver@company.com"
                    value={approvalEmail}
                    onChange={e => setApprovalEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail) && sendApproval()}
                    autoFocus
                    disabled={approvalStatus === 'sending'}
                  />
                </div>
                {approvalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail) && (
                  <div className="apv-input-hint">รูปแบบ email ไม่ถูกต้อง</div>
                )}

                <div className="apv-actions">
                  <button className="apv-btn apv-btn--secondary" onClick={() => setShowApprovalDialog(false)} disabled={approvalStatus === 'sending'}>
                    ยกเลิก
                  </button>
                  <button
                    className="apv-btn apv-btn--primary"
                    disabled={approvalStatus === 'sending' || !approvalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail)}
                    onClick={sendApproval}
                  >
                    {approvalStatus === 'sending'
                      ? <><span className="apv-spinner" /> กำลังส่ง…</>
                      : <>✉ ส่ง Email</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {pages.length > 1 && (
        <div className="tree-keys" style={{ padding: '8px 16px 0' }}>
          {pages.map(p => (
            <button
              key={p.key}
              className={`tree-key-btn${effectiveKey === p.key ? ' active' : ''}`}
              onClick={() => setActiveKey(p.key)}
            >
              {p.label || `Key ${p.key}`}
            </button>
          ))}
        </div>
      )}

      <div className={`bdv-scroll${blinking ? ' bdv-scroll--refreshing' : ''}`} onAnimationEnd={() => setBlinking(false)}>
        {pages.map((g, idx) => {
          const rows = [...g.rows]
          const need = Math.max(0, MIN_ROWS - rows.length)
          for (let j = 0; j < need; j++) rows.push(null)
          return (
            <div
              key={g.key}
              ref={el => { pageRefs.current[idx] = el }}
              className="bdv-paper"
              style={{ display: g.key === effectiveKey ? 'block' : 'none' }}
            >
              <BomPage
                bom={bom}
                header={header}
                onToggle={onToggle}
                onField={onField}
                revNames={revNames}
                setRevName={setRevName}
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
function BomPage({ bom, header, onToggle, onField, revNames, setRevName, rows, pageNum, totalPages }) {
  const pageLv1 = rows.find(r => r && r.level === 1 && r.status !== 'revised_out')
  const pageTgPartNo = pageLv1?.tg_part_no ?? bom.tg_part_no
  const rawRevs = bom.revisions ?? []
  const hasFirstIssue = rawRevs.some(r => !r.mark || r.mark === '–' || r.mark === '-')
  const revisions = hasFirstIssue
    ? rawRevs
    : [{ mark: '–', revision_record: 'First issue', eci_no: bom.internal_eci_no, revision_date: bom.date }, ...rawRevs]

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
                    {h.introduced_at > 0 && <TriangleMark num={h.introduced_at} size="sm" />}
                    <span className="bp-pn-struck">{h.old_tg_part_no}</span>{' '}
                  </span>
                ))}
                {(bom.tgt_update_level ?? 0) > 0 && <TriangleMark num={bom.tgt_update_level} size="sm" />}
                {pageTgPartNo}
              </b>
            </td>
            <td className="bp-lbl" colSpan={1} rowSpan={2} style={{textAlign: 'center'}}>
              Customer Name :
            </td>
            <td className="bp-val" colSpan={3} rowSpan={2} style={{textAlign: 'center'}}>
              <input
                className="bp-rev-input"
                value={header.customer_name}
                onChange={e => onField('customer_name', e.target.value)}
                placeholder="Customer Name"
                style={{width:'100%', textAlign:'center', fontWeight:700}}
              />
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
          {(()=>{
            const emptyCount = Math.max(0, 6 - revisions.length)
            const totalRows = 1 + revisions.length + emptyCount
            return <>
              {/* Note cell + spacer use rowSpan to sit flush next to revision header */}
              <tr style={{height:'12px'}}>
                <td className="bp-note-cell" colSpan={3} rowSpan={totalRows} style={{verticalAlign:'top'}}>
                  <div style={{fontWeight:700,marginBottom:2}}>Note :</div>
                  <div className="bp-note-line">'A' = Record by Engineering section&nbsp;&nbsp;Update ECI No.</div>
                  <div className="bp-note-line">'B' = Record by Part Control section</div>
                  <div className="bp-note-line">'C' = Record by Purchase section</div>
                </td>
                <td colSpan={3} className="bp-bot-spacer" rowSpan={totalRows}/>
                <td className="bp-rev-th" colSpan={1}>Mark</td>
                <td className="bp-rev-th" colSpan={10}>Revision record</td>
                <td className="bp-rev-th" colSpan={2}>ECI No.</td>
                <td className="bp-rev-th" colSpan={2}>Date</td>
                <td className="bp-rev-th" colSpan={2}>Revisioner</td>
                <td className="bp-rev-th" colSpan={2}>Approved</td>
              </tr>
              {revisions.map((rev,i)=>{
                const isFirst = !rev.mark || rev.mark === '–' || rev.mark === '-'
                return (
                  <tr key={i} style={{height:'14px'}}>
                    <td className="bp-rev-td" colSpan={1} style={{textAlign:'center'}}>
                      {isFirst ? '' : <TriangleMark num={rev.mark} size="sm" />}
                    </td>
                    <td className="bp-rev-td" colSpan={10}>{rev.revision_record ?? ''}</td>
                    <td className="bp-rev-td" colSpan={2} style={{textAlign:'center'}}>
                      {rev.eci_no && bom.pdf_url
                        ? <a href={bom.pdf_url} target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'none',cursor:'pointer'}}>{rev.eci_no}</a>
                        : (rev.eci_no ?? '')}
                    </td>
                    <td className="bp-rev-td" colSpan={2} style={{textAlign:'center'}}>{rev.revision_date ?? ''}</td>
                    <td className="bp-rev-td" colSpan={2}>
                      {isFirst
                        ? <input className="bp-rev-input" value={header.revisioner} onChange={e=>onField('revisioner',e.target.value)} placeholder="ผู้แก้ไข"/>
                        : <input className="bp-rev-input" value={revNames?.[rev.mark]?.revisioner ?? ''} onChange={e=>setRevName(rev.mark,'revisioner',e.target.value)} placeholder="ผู้แก้ไข"/>
                      }
                    </td>
                    <td className="bp-rev-td" colSpan={2}>
                      {isFirst
                        ? <input className="bp-rev-input" value={header.approved_by} onChange={e=>onField('approved_by',e.target.value)} placeholder="ผู้อนุมัติ"/>
                        : <input className="bp-rev-input" value={revNames?.[rev.mark]?.approved_by ?? ''} onChange={e=>setRevName(rev.mark,'approved_by',e.target.value)} placeholder="ผู้อนุมัติ"/>
                      }
                    </td>
                  </tr>
                )
              })}
              {Array(emptyCount).fill(null).map((_,i)=>(
                <tr key={`e${i}`} style={{height:'14px'}}>
                  <td className="bp-rev-td" colSpan={1}/>
                  <td className="bp-rev-td" colSpan={10}/>
                  <td className="bp-rev-td" colSpan={2}/>
                  <td className="bp-rev-td" colSpan={2}/>
                  <td className="bp-rev-td" colSpan={2}/>
                  <td className="bp-rev-td" colSpan={2}/>
                </tr>
              ))}
            </>
          })()}
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

/* ── revision mark triangle (△2, △3 …) ── */
/* size='lg' = revision table (22px fixed)  |  size='sm' = inline with part no. (1em, won't expand row) */
function TriangleMark({ num, size = 'lg' }) {
  if (size === 'sm') {
    return (
      <svg height="1em" viewBox="0 0 22 20"
           style={{display:'inline-block', verticalAlign:'middle', width:'1.1em', flexShrink:0, marginRight:2}}>
        <polygon points="11,1.5 21,18.5 1,18.5" fill="white" stroke="#cc0000" strokeWidth="2.5"/>
        <text x="11" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#cc0000" fontFamily="Arial,sans-serif">{num}</text>
      </svg>
    )
  }
  return (
    <svg width="22" height="20" viewBox="0 0 22 20" style={{display:'inline-block',verticalAlign:'middle',flexShrink:0}}>
      <polygon points="11,1.5 21,18.5 1,18.5" fill="white" stroke="#cc0000" strokeWidth="2"/>
      <text x="11" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#cc0000" fontFamily="Arial,sans-serif">{num}</text>
    </svg>
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

  const rawNote = row.note ?? ''
  const noteQty  = rawNote.match(/Q'ty:\s*([^|]+)/)?.[1]?.trim() ?? null
  const noteMass = rawNote.match(/Weight:\s*([^|]+)/)?.[1]?.trim() ?? null
  const cleanNote = rawNote
    .replace(/Q'ty:\s*[^|]+\|?\s*/g, '')
    .replace(/Weight:\s*[^|]+\|?\s*/g, '')
    .trim().replace(/\|\s*$/, '').trim()

  const displayQty  = noteQty  ?? (row.quantity != null ? Math.round(row.quantity) : '')
  const displayMass = noteMass ?? (row.mass_g   != null ? Number(row.mass_g).toLocaleString() : '')

  const spec = [
    cleanNote || null,
    row.product_standards && row.product_standards !== 'NO' ? row.product_standards : null,
    row.material_standards && row.material_standards !== 'NO' ? row.material_standards : null,
  ].filter(Boolean).join('  ')

  // Synthetic customer_pn-only header row (injected by insertRevisedOut)
  // Renders the customer_part_no line without struck-through styling, always first.
  if (row._custPnOnly) {
    return (
      <tr className={`bp-row bp-row-lv${lv}`}>
        {[1,2,3,4,5].map(n => (
          <td key={n} className={`bp-td bp-td-pn bp-td-pn${n}`}>
            {n === 1 ? <div className="bp-pn-cell"><span>{row.customer_part_no}</span></div> : ''}
          </td>
        ))}
        <td className="bp-td bp-td-name">{row.part_name}</td>
        <td className="bp-td bp-td-spec">{spec}</td>
        <td className="bp-td bp-td-c">{displayQty}</td>
        <td className="bp-td bp-td-c">{displayMass}</td>
        <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
        {[0,1,2,3,4].map(i => <td key={i} className="bp-td bp-td-c" />)}
        {[0,1,2,3].map(i => <td key={i} className="bp-td bp-td-c" />)}
        <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-remark" />
      </tr>
    )
  }

  // _skipCustPn: customer_pn was already injected as a header row above the struck rows
  const hasCustPn = lv === 1 && !!row.customer_part_no && !isRevisedOut && !row._skipCustPn
  const trClass = `bp-row bp-row-lv${lv}${isRevisedOut ? ' bp-row-revised-out' : ''}`

  return (
    <>
      <tr className={trClass}>
        {[1, 2, 3, 4, 5].map(n => (
          <td key={n} className={`bp-td bp-td-pn bp-td-pn${n}`}>
            {n === lv ? (
              hasCustPn
                ? <div className="bp-pn-cell"><span>{row.customer_part_no}</span></div>
                : <div className="bp-pn-cell">
                    <div className="bp-pn-line">
                      {displayLevel > 0 && <TriangleMark num={displayLevel} size="sm" />}
                      <span>{row.tg_part_no ?? ''}</span>
                    </div>
                  </div>
            ) : ''}
          </td>
        ))}
        <td className="bp-td bp-td-name">{row.part_name}</td>
        <td className="bp-td bp-td-spec">{spec}</td>
        <td className="bp-td bp-td-c">{displayQty}</td>
        <td className="bp-td bp-td-c">{displayMass}</td>
        <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
        {[0,1,2,3,4].map(i => <td key={i} className="bp-td bp-td-c" />)}
        {[0,1,2,3].map(i => <td key={i} className="bp-td bp-td-c" />)}
        <td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-remark" />
      </tr>
      {hasCustPn && (
        <tr className={trClass}>
          {[1, 2, 3, 4, 5].map(n => (
            <td key={n} className={`bp-td bp-td-pn bp-td-pn${n}`}>
              {n === 1
                ? <div className="bp-pn-cell">
                    <div className="bp-pn-line">
                      {displayLevel > 0 && <TriangleMark num={displayLevel} size="sm" />}
                      <span>{row.tg_part_no ?? ''}</span>
                    </div>
                  </div>
                : ''}
            </td>
          ))}
          <td className="bp-td bp-td-name">{row.part_name}</td>
          <td className="bp-td bp-td-spec">{spec}</td>
          <td className="bp-td bp-td-c">{row.quantity != null ? Math.round(row.quantity) : ''}</td>
          <td className="bp-td bp-td-c">{row.mass_g != null ? Number(row.mass_g).toLocaleString() : ''}</td>
          <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
          {[0,1,2,3,4].map(i => <td key={i} className="bp-td bp-td-c" />)}
          {[0,1,2,3].map(i => <td key={i} className="bp-td bp-td-c" />)}
          <td className="bp-td bp-td-c" />
          <td className="bp-td bp-td-c" />
          <td className="bp-td bp-td-c" />
          <td className="bp-td bp-td-c" />
          <td className="bp-td bp-td-remark" />
        </tr>
      )}
    </>
  )
}

/* ── Revision / Update dialog ── */
function RevisionDialog({ bom, onClose, onDone }) {
  const [mode, setMode] = useState('choose') // 'choose' | 'pdf' | 'manual'
  const [eciNo, setEciNo] = useState('')
  const [revDate, setRevDate] = useState(new Date().toISOString().split('T')[0])
  const [revisioner, setRevisioner] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const [newTgt, setNewTgt] = useState('')
  const [itemUpdates, setItemUpdates] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // PDF preview state
  const [pdfParsing, setPdfParsing] = useState(false)
  const [preview, setPreview] = useState(null) // { tgt_change, item_changes, new_items, header }
  const [pdfError, setPdfError] = useState(null)
  const fileRef = useRef(null)

  const allItems = (bom.items ?? []).filter(it => it.tg_part_no && it.status !== 'revised_out')
  const allKeys = [...new Set(allItems.flatMap(it => parseKeyList(it.key_code)))].sort((a, b) => a - b).map(String)
  const [activeRevKey, setActiveRevKey] = useState(allKeys[0] ?? null)
  const visibleItems = activeRevKey
    ? allItems.filter(it => {
        const ks = parseKeyList(it.key_code)
        return ks.length === 0 || ks.map(String).includes(activeRevKey)
      })
    : allItems

  async function onPdfFile(file) {
    if (!file?.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('กรุณาเลือกไฟล์ PDF เท่านั้น'); return
    }
    setPdfParsing(true); setPdfError(null); setPreview(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/import/revision-preview/${bom.id}`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setPreview(data)
      if (data.header?.internal_eci_no) setEciNo(data.header.internal_eci_no)
      if (data.tgt_change) setNewTgt(data.tgt_change.new)
      // Pre-fill item_changes into itemUpdates — skip Lv1 (TGT Part No. changes handled separately)
      const updates = {}
      for (const ch of data.item_changes ?? []) {
        if (ch.level === 1) continue
        updates[ch.bom_id] = { pn: ch.new_pn, name: '', note: '', qty: '', mass: '' }
      }
      setItemUpdates(updates)
    } catch (e) { setPdfError(e.message) }
    finally { setPdfParsing(false) }
  }

  function onItemChange(id, field, val) {
    setItemUpdates(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [field]: val },
    }))
  }

  async function submit() {
    const items = Object.entries(itemUpdates)
      .filter(([, v]) => v.pn?.trim() || v.name?.trim() || v.note?.trim() || v.qty?.trim() || v.mass?.trim())
      .map(([bom_id, v]) => ({
        bom_id: parseInt(bom_id),
        new_part_no: v.pn?.trim() || null,
        new_part_name: v.name?.trim() || null,
        new_note: v.note?.trim() || null,
        new_quantity: v.qty?.trim() || null,
        new_mass: v.mass?.trim() || null,
      }))

    if (!items.length && !newTgt.trim()) {
      setError('ไม่มีการเปลี่ยนแปลงใดๆ'); return
    }

    setSaving(true); setError(null)
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
    <div className="rev-dlg-overlay">
      <div className="rev-dlg">
        <div className="rev-dlg__hdr">
          <span>△ บันทึก Update / Revision</span>
          <button className="rev-dlg__close" onClick={onClose}>✕</button>
        </div>
        <div className="rev-dlg__body">

          {/* ── Mode chooser ── */}
          {mode === 'choose' && (
            <div className="rev-dlg__choose">
              <button className="rev-dlg__choose-btn" onClick={() => setMode('pdf')}>
                <span className="rev-dlg__choose-icon">📄</span>
                <span className="rev-dlg__choose-title">อัพโหลด PDF ใหม่</span>
                <span className="rev-dlg__choose-sub">ระบบเปรียบเทียบ Part No. ให้อัตโนมัติ</span>
              </button>
              <button className="rev-dlg__choose-btn" onClick={() => setMode('manual')}>
                <span className="rev-dlg__choose-icon">✏️</span>
                <span className="rev-dlg__choose-title">กรอกเอง</span>
                <span className="rev-dlg__choose-sub">ระบุ Part No. ที่เปลี่ยนด้วยตนเอง</span>
              </button>
            </div>
          )}

          {/* ── PDF mode ── */}
          {mode === 'pdf' && (
            <>
              <button className="rev-dlg__back" onClick={() => { setMode('choose'); setPreview(null); setPdfError(null) }}>← กลับ</button>

              {!preview && (
                <div
                  className={`rev-dlg__dropzone${pdfParsing ? ' rev-dlg__dropzone--loading' : ''}`}
                  onClick={() => !pdfParsing && fileRef.current?.click()}
                  onDrop={e => { e.preventDefault(); onPdfFile(e.dataTransfer.files[0]) }}
                  onDragOver={e => e.preventDefault()}
                >
                  <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}} onChange={e => onPdfFile(e.target.files[0])} />
                  {pdfParsing
                    ? <><div className="upload-spinner" style={{margin:'0 auto 8px'}}/><div>กำลังวิเคราะห์ PDF… (30–60 วินาที)</div></>
                    : <><div style={{fontSize:28}}>📄</div><div style={{marginTop:6,fontWeight:500}}>เลือกหรือลาก PDF ไฟล์ใหม่มาวางที่นี่</div></>
                  }
                </div>
              )}
              {pdfError && <div className="rev-dlg__error">⚠ {pdfError}</div>}

              {/* Preview results */}
              {preview && (
                <>
                  <div className="rev-dlg__preview-title">ผลการเปรียบเทียบ</div>

                  {!preview.tgt_change && !preview.item_changes?.length && !preview.new_items?.length && (
                    <div className="rev-dlg__preview-none">ไม่พบการเปลี่ยนแปลง Part No. ใดๆ</div>
                  )}

                  {preview.tgt_change && (
                    <div className="rev-dlg__preview-section">
                      <div className="rev-dlg__preview-label">TGT Part No.</div>
                      <div className="rev-dlg__diff-row">
                        <span className="rev-dlg__diff-old">{preview.tgt_change.old}</span>
                        <span className="rev-dlg__diff-arrow">→</span>
                        <span className="rev-dlg__diff-new">{preview.tgt_change.new}</span>
                      </div>
                    </div>
                  )}

                  {preview.item_changes?.length > 0 && (
                    <div className="rev-dlg__preview-section">
                      <div className="rev-dlg__preview-label">Part No. ที่เปลี่ยน ({preview.item_changes.length} รายการ)</div>
                      {preview.item_changes.map((ch, i) => (
                        <div key={i} className="rev-dlg__diff-row">
                          <span className="rev-dlg__diff-lv">Lv{ch.level}</span>
                          <span className="rev-dlg__diff-old">{ch.old_pn}</span>
                          <span className="rev-dlg__diff-arrow">→</span>
                          <span className="rev-dlg__diff-new">{ch.new_pn}</span>
                          <span className="rev-dlg__diff-name">{ch.part_name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {preview.new_items?.length > 0 && (
                    <div className="rev-dlg__preview-section">
                      <div className="rev-dlg__preview-label">Part ใหม่ที่จะเพิ่ม ({preview.new_items.length} รายการ)</div>
                      {preview.new_items.map((it, i) => (
                        <div key={i} className="rev-dlg__diff-row">
                          <span className="rev-dlg__diff-lv">Lv{it.level}</span>
                          <span className="rev-dlg__diff-new">{it.tg_part_no}</span>
                          <span className="rev-dlg__diff-name">{it.part_name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Meta fields */}
                  <div className="rev-dlg__preview-label" style={{marginTop:14}}>ข้อมูล Revision</div>
                  <div className="rev-dlg__grid">
                    <label>ECI No.</label>
                    <input value={eciNo} onChange={e => setEciNo(e.target.value)} placeholder="26A376" />
                    <label>Date</label>
                    <input type="date" value={revDate} onChange={e => setRevDate(e.target.value)} />
                    <label>Revisioner</label>
                    <input value={revisioner} onChange={e => setRevisioner(e.target.value)} />
                    <label>Approved</label>
                    <input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} />
                  </div>

                  {error && <div className="rev-dlg__error">⚠ {error}</div>}
                  <div className="rev-dlg__footer">
                    <button className="bdv-btn bdv-btn--secondary" onClick={() => { setPreview(null); setPdfError(null) }} disabled={saving}>อัพโหลดใหม่</button>
                    <button className="bdv-btn" onClick={submit} disabled={saving || (!preview.tgt_change && !preview.item_changes?.length)}>
                      {saving ? 'กำลังบันทึก…' : '✓ ยืนยัน Update'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Manual mode ── */}
          {mode === 'manual' && (
            <>
              <button className="rev-dlg__back" onClick={() => setMode('choose')}>← กลับ</button>
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
                แก้ไขข้อมูล Part — ระบุค่าใหม่เฉพาะรายการที่ต้องการเปลี่ยน (เว้นว่างถ้าไม่เปลี่ยน)
              </div>

              {allKeys.length > 1 && (
                <div className="tree-keys" style={{ marginBottom: 8 }}>
                  {allKeys.map(k => (
                    <button key={k} className={`tree-key-btn${activeRevKey === k ? ' active' : ''}`}
                      onClick={() => setActiveRevKey(k)}>
                      Key {k}
                    </button>
                  ))}
                </div>
              )}

              <div className="rev-dlg__items">
                {visibleItems.map(item => {
                  const v = itemUpdates[item.id] ?? {}
                  const hasAny = v.pn?.trim() || v.name?.trim() || v.note?.trim() || v.qty?.trim() || v.mass?.trim()
                  return (
                    <div key={item.id} className={`rev-dlg__item-card${hasAny ? ' rev-dlg__item-card--active' : ''}`}>
                      <div className="rev-dlg__item-current">
                        <span className="rev-dlg__lv">Lv{item.level}</span>
                        <span className="rev-dlg__cur-pn">{item.tg_part_no}</span>
                        <span className="rev-dlg__name">{item.part_name}</span>
                      </div>
                      <div className="rev-dlg__item-inputs">
                        <div className="rev-dlg__input-row">
                          <div className="rev-dlg__input-field rev-dlg__input-field--pn">
                            <label>Part No. ใหม่</label>
                            <input className="rev-dlg__inp rev-dlg__inp--mono"
                              placeholder="เว้นว่างถ้าไม่เปลี่ยน"
                              value={v.pn ?? ''}
                              onChange={e => onItemChange(item.id, 'pn', e.target.value)}
                            />
                          </div>
                          <div className="rev-dlg__input-field">
                            <label>Part Name ใหม่</label>
                            <input className="rev-dlg__inp"
                              placeholder="เว้นว่างถ้าไม่เปลี่ยน"
                              value={v.name ?? ''}
                              onChange={e => onItemChange(item.id, 'name', e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="rev-dlg__input-row">
                          <div className="rev-dlg__input-field rev-dlg__input-field--spec">
                            <label>Material Spec ใหม่</label>
                            <input className="rev-dlg__inp"
                              placeholder="เว้นว่างถ้าไม่เปลี่ยน"
                              value={v.note ?? ''}
                              onChange={e => onItemChange(item.id, 'note', e.target.value)}
                            />
                          </div>
                          <div className="rev-dlg__input-field rev-dlg__input-field--sm">
                            <label>Q'ty</label>
                            <input className="rev-dlg__inp"
                              placeholder="—"
                              value={v.qty ?? ''}
                              onChange={e => onItemChange(item.id, 'qty', e.target.value)}
                            />
                          </div>
                          <div className="rev-dlg__input-field rev-dlg__input-field--sm">
                            <label>Weight (g)</label>
                            <input className="rev-dlg__inp"
                              placeholder="—"
                              value={v.mass ?? ''}
                              onChange={e => onItemChange(item.id, 'mass', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {error && <div className="rev-dlg__error">⚠ {error}</div>}
              <div className="rev-dlg__footer">
                <button className="bdv-btn bdv-btn--secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
                <button className="bdv-btn" onClick={submit} disabled={saving}>
                  {saving ? 'กำลังบันทึก…' : 'บันทึก Update'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
