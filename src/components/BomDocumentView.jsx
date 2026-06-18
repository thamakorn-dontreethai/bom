import { useRef, useState, useEffect } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { exportBomToExcel, exportBomMatrix } from '../utils/exportBomExcel'
import { getUser } from '../auth'

// Logged-in user's display name — used to pre-fill Revisioner fields
const currentUserName = () => getUser()?.full_name || getUser()?.username || ''

// Order active rows by stored sort_order (the real document order). Indentation comes from
// each row's `level`, so a manually-added row stays exactly where it was inserted (right after
// the clicked row) regardless of which level the user picked.
function orderRows(items) {
  return items
    .filter(it => it.status !== 'revised_out')
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

// For each revised_out item, follow the chain to find the final active successor,
// then place ALL revised_out predecessors (sorted oldest-first) before that active item.
// For Level 1 active items with customer_part_no, inject a synthetic _custPnOnly header
// row BEFORE the struck rows so customer_pn always appears first, never struck through.
function insertRevisedOut(flatRows, allItems) {
  const insertBefore = {}

  allItems.forEach(it => {
    if (it.status !== 'revised_out' || it.sort_order == null) return
    // Follow chain to find the final active successor (same parent AND same key_code to avoid
    // Level 1 items from different variant keys bleeding into each other — all have parent_id=null)
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
    return [{ key: '0', label: '', rows: insertRevisedOut(orderRows(pageItems), pageItems) }]
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
    const lv1 = keyed[k].find(it => it.level === 1 && it.status !== 'revised_out')
    const label = lv1?.part_name ? `Key ${k} — ${lv1.part_name}` : `Key ${k}`
    return {
      key: k,
      label,
      rows: insertRevisedOut(orderRows(pageItems), pageItems),
    }
  })
}

function Cols({ maxLevel = 5 }) { 
  const pnCols = Array(maxLevel).fill(85)
  return (
    <colgroup>
      {pnCols.map((w,i)=><col key={`pn${i}`} style={{width:w}}/>)}
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
  const [showRevDialog, setShowRevDialog] = useState(false)
  const [showApprovalDialog, setShowApprovalDialog] = useState(false)
  const [approvalEmail, setApprovalEmail] = useState('')
  const [approvalStatus, setApprovalStatus] = useState(null) // null | 'sending' | 'ok' | 'err:...'

  async function doRefresh() {
    if (busy || saving || refreshing) return
    setRefreshing(true); setBlinking(true)
    await onRefresh?.()
    setRefreshing(false)
  }

  // Keyboard shortcut: press "R" to reload the BOM data (ignored while typing in a field).
  useEffect(() => {
    function onKey(e) {
      if ((e.key !== 'r' && e.key !== 'R') || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      doRefresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, saving, refreshing, onRefresh])

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
    model_name: bom.model_name ?? '',
  })

  // editable revisioner/approved_by for every non-first revision row
  const [revNames, setRevNames] = useState(() => {
    const m = {}
    ;(bom.revisions ?? []).forEach(r => {
      if (r.mark && r.mark !== '–' && r.mark !== '-') {
        m[r.mark] = { revisioner: r.revisioner ?? '', approved_by: r.approved_by ?? '', revision_record: r.revision_record ?? '' }
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
      model_name: bom.model_name ?? '',
    })
    const m = {}
    ;(bom.revisions ?? []).forEach(r => {
      if (r.mark && r.mark !== '–' && r.mark !== '-') {
        m[r.mark] = { revisioner: r.revisioner ?? '', approved_by: r.approved_by ?? '', revision_record: r.revision_record ?? '' }
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
      onRefresh?.()   // reload BOM so the "edited by · time" updates immediately
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

  async function download(selIdx) {
    const all = pageRefs.current
    const idxs = selIdx ?? all.map((_, i) => i).filter(i => all[i])
    const refs = idxs.map(i => all[i]).filter(Boolean)
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

  async function generatePdfBase64(selIdx) {
    showAllPages()
    const all = pageRefs.current
    const idxs = selIdx ?? all.map((_, i) => i).filter(i => all[i])
    const refs = idxs.map(i => all[i]).filter(Boolean)
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

  async function printDoc(selIdx) {
    setBusy(true)
    try {
      const b64 = await generatePdfBase64(selIdx)
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) {
      console.error('Print error', e)
    } finally {
      setBusy(false)
    }
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

  // Saved Part No. views (filtered subsets) — grouped per key
  const allViews = bom.views ?? []
  const [activeViewId, setActiveViewId] = useState(null)
  const activeView = allViews.find(v => Number(v.id) === activeViewId) ?? null
  function switchKey(k) { setActiveKey(k); setActiveViewId(null) }

  // Export / Print — choose which key (page) to include
  const [exportMode, setExportMode] = useState(null)   // null | 'pdf' | 'print'
  const [exportSel, setExportSel] = useState([])        // selected page indices
  function openExport(mode) {
    if (busy || saving) return
    if (pages.length <= 1) {
      if (mode === 'excel') exportBomToExcel(bom, 'all', activeView)
      else if (mode === 'pdf') download()
      else printDoc()
      return
    }
    setExportSel(pages.map((_, i) => i))               // default: all pages
    setExportMode(mode)
  }
  function toggleExportPage(i) {
    setExportSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])
  }
  function confirmExport() {
    const sel = [...exportSel].sort((a, b) => a - b)
    const mode = exportMode
    setExportMode(null)
    if (!sel.length) return
    if (mode === 'excel') exportBomToExcel(bom, sel.map(i => pages[i].key), activeView)
    else if (mode === 'pdf') download(sel)
    else printDoc(sel)
  }

  // While the export dialog is open: Enter = export, Esc = close it.
  // Capture phase + stopImmediatePropagation so Esc closes the dialog instead
  // of bubbling up to the app-level "Esc → Home" shortcut.
  useEffect(() => {
    if (!exportMode) return
    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation()
        if (exportSel.length) confirmExport()
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation()
        setExportMode(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [exportMode, exportSel])

  // Keyboard shortcuts (Document view):
  //   Ctrl+S = Save · Ctrl+Shift+E = Export Excel · Ctrl+Shift+P = Export PDF
  useEffect(() => {
    function onKey(e) {
      if ((!e.ctrlKey && !e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 's' && !e.shiftKey)      { e.preventDefault(); saveHeader() }
      else if (k === 'e' && e.shiftKey)  { e.preventDefault(); openExport('excel') }
      else if (k === 'p' && e.shiftKey)  { e.preventDefault(); openExport('pdf') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveHeader, openExport])

  // View-create dialog
  const [showViewDlg, setShowViewDlg] = useState(false)
  const [viewName, setViewName] = useState('')
  const [viewParts, setViewParts] = useState('')
  const [viewSaving, setViewSaving] = useState(false)

  async function createView() {
    const part_nos = viewParts.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (!viewName.trim() || !part_nos.length) return
    setViewSaving(true)
    try {
      await fetch(`/api/bom/${bom.id}/views`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_code: effectiveKey, name: viewName.trim(), part_nos }),
      })
      setShowViewDlg(false); setViewName(''); setViewParts('')
      onRefresh?.()
    } catch (_) {} finally { setViewSaving(false) }
  }
  async function deleteView(id) {
    await fetch(`/api/bom/${bom.id}/views/${id}`, { method: 'DELETE' }).catch(() => {})
    if (activeViewId === Number(id)) setActiveViewId(null)
    onRefresh?.()
  }
{/*When only 1 page, show it. When multiple pages, show the active one (default first)*/}
  return (
    <div className="bdv-wrap">
      <div className="bdv-toolbar">
        {/* left — save + reset + approval */}
        <button className="bdv-btn bdv-btn--secondary" onClick={saveHeader} disabled={saving || busy}>
          {saving ? 'Saving…' : '💾 Save'}
        </button>
        <button className="bdv-btn bdv-btn--rev" onClick={() => setShowRevDialog(true)} disabled={busy || saving}>
          △ Save Update
        </button>
        <div className="bdv-toolbar-sep" />
        <button
          className="bdv-btn bdv-btn--secondary"
          disabled={busy || saving || refreshing}
          onClick={doRefresh}
          title="Reload BOM data (shortcut: R)"
        >
          {refreshing ? 'Loading...' : '↻ Refresh'}
        </button>
        <button className="bdv-btn bdv-btn--approval" onClick={() => { setShowApprovalDialog(true); setApprovalStatus(null); setApprovalEmail('') }} disabled={busy || saving}>
          ✉ Request Approval
        </button>

        {/* spacer */}
        <div className="bdv-toolbar-spacer" />
        <div className="bdv-audit">
          {bom.created_by && <span title="Added this BOM">➕ {bom.created_by}</span>}
          {bom.updated_by && <span title="Last updated">✏️ {bom.updated_by}{bom.updated_at ? ` · ${bom.updated_at}` : ''}</span>}
        </div>
        {saveMsg === 'ok' && <span className="bdv-save-msg bdv-save-msg--ok">✓ Saved</span>}
        {saveMsg === 'err' && <span className="bdv-save-msg bdv-save-msg--err">⚠ Save failed</span>}

        {/* right — export group */}
        <div className="bdv-toolbar-sep" />
        <button className="bdv-btn bdv-btn--pdf" onClick={() => openExport('pdf')} disabled={busy || saving} title="Download PDF (shortcut: Ctrl+Shift+P)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          {busy ? 'Generating…' : 'PDF'}
        </button>
        <button className="bdv-btn bdv-btn--excel" onClick={() => openExport('excel')} disabled={busy || saving} title="Export Excel (shortcut: Ctrl+Shift+E)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
          Excel
        </button>
        <button className="bdv-btn bdv-btn--matrix" onClick={() => exportBomMatrix(bom)} disabled={busy || saving} title="Export Matrix Component Part Detail">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          Matrix
        </button>
        <button className="bdv-btn bdv-btn--print" onClick={() => openExport('print')} disabled={busy || saving} title="Print">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print
        </button>
      </div>

      {/* ── Approval dialog ── */}
      {showApprovalDialog && (
        <div className="bdv-overlay">
          <div className="apv-dialog">

            {/* Header */}
            <div className="apv-header">
              <div className="apv-header-icon">✉</div>
              <div>
                <div className="apv-header-title">Send Approval Request</div>
                <div className="apv-header-sub">System will send a link for the approver to sign in the Approved by field</div>
              </div>
              {approvalStatus !== 'sending' && (
                <button className="apv-close" onClick={() => setShowApprovalDialog(false)}>✕</button>
              )}
            </div>

            {/* BOM context chip */}
            <div className="apv-context">
              <span className="apv-context-label">Document</span>
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
                <div className="apv-success-title">Email sent successfully</div>
                <div className="apv-success-sub">Sent to <b>{approvalEmail}</b></div>
                <button className="apv-btn apv-btn--primary" style={{marginTop:20}} onClick={() => setShowApprovalDialog(false)}>
                  Close
                </button>
              </div>
            ) : approvalStatus?.startsWith('err') ? (
              <div className="apv-error-body">
                <div className="apv-error-icon">⚠</div>
                <div className="apv-error-title">Send failed</div>
                <div className="apv-error-msg">{approvalStatus.slice(4)}</div>
                <div className="apv-actions">                                                                                                                             
                  <button className="apv-btn apv-btn--secondary" onClick={() => setShowApprovalDialog(false)}>Close</button>
                  <button className="apv-btn apv-btn--primary" onClick={() => setApprovalStatus(null)}>Retry</button>
                </div>
              </div>
            ) : (
              <div className="apv-form">
                <label className="apv-label">
                  Approver Email
                  <span className="apv-required">*</span>
                </label>
                <div className={`apv-input-wrap${approvalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail) ? ' apv-input-wrap--err' : ''}`}>
                  <span className="apv-input-icon">@</span>
                  <input
                    className="apv-input"
                    type="email"
                    placeholder="enter approver's email"
                    value={approvalEmail}
                    onChange={e => setApprovalEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail) && sendApproval()}
                    autoFocus
                    disabled={approvalStatus === 'sending'}
                  />  
                </div>
                {approvalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail) && (
                  <div className="apv-input-hint">Invalid email format</div>
                )}

                <div className="apv-actions">
                  <button className="apv-btn apv-btn--secondary" onClick={() => setShowApprovalDialog(false)} disabled={approvalStatus === 'sending'}>
                    Cancel
                  </button>
                  <button
                    className="apv-btn apv-btn--primary"
                    disabled={approvalStatus === 'sending' || !approvalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalEmail)}
                    onClick={sendApproval}
                  >
                    {approvalStatus === 'sending'
                      ? <><span className="apv-spinner" /> Sending…</>
                      : <>✉ Send Email</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="tree-keys" style={{ padding: '10px 20px', background: 'transparent', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
        <div className="tree-keys-scroll">
        {pages.map(p => {
          // Only the ACTIVE key shows its Part No. view dropdown — others stay compact tabs,
          // so the bar stays one row even with many keys.
          const pViews = allViews.filter(v => String(v.key_code ?? '') === String(p.key))
          const isActive = effectiveKey === p.key
          const label = p.label || `Key ${p.key}`
          return (
            <div key={p.key} className={`key-group${isActive ? ' key-group--active' : ''}`}>
              {pages.length > 1 && (
                <button
                  className={`tree-key-btn${isActive ? ' active' : ''}`}
                  title={label}
                  onClick={() => switchKey(p.key)}
                >
                  {label}
                </button>
              )}
              {isActive && (
                <div className="view-bar">
                  <select
                    className="comp-select"
                    value={activeViewId ?? ''}
                    onChange={e => setActiveViewId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">All Part No.</option>
                    {pViews.map(v => (
                      <option key={v.id} value={v.id}>🔍 {v.name} ({v.part_nos.length})</option>
                    ))}
                  </select>
                  {activeView && (
                    <button className="view-del" title="Delete this view" onClick={() => deleteView(activeView.id)}>🗑</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </div>{/* /tree-keys-scroll */}

        <button className="bdv-btn bdv-btn--secondary" onClick={() => setShowViewDlg(true)}>
          🔍 Select Part No.
        </button>
      </div>

      <div className={`bdv-scroll${blinking ? ' bdv-scroll--refreshing' : ''}`} onAnimationEnd={() => setBlinking(false)}>
        {pages.map((g, idx) => {
          // When a view is active for this page's key, keep rows whose Part No. CONTAINS any
          // of the view's patterns (e.g. "GS" → all GS parts, "GS110-88710-C" → that part).
          // A matched part also pulls in ALL of its descendants (children, grandchildren …),
          // even if their Part No. doesn't contain the pattern. Level-1 header rows are NOT shown.
          const useView = activeView && String(activeView.key_code ?? '') === String(g.key)
          const pats = useView ? activeView.part_nos.map(p => p.toLowerCase()) : null
          let baseRows = g.rows
          if (useView) {
            const matches = r =>
              r && pats.some(p =>
                (r.tg_part_no ?? '').toLowerCase().includes(p) ||
                (r.customer_part_no ?? '').toLowerCase().includes(p))
            const byId = new Map(g.rows.filter(Boolean).map(r => [r.id, r]))
            const keep = new Set()
            // Seed with directly-matched rows
            g.rows.forEach(r => { if (matches(r)) keep.add(r.id) })
            // Include a row if any ancestor (parent chain) is already kept
            g.rows.forEach(r => {
              if (!r || keep.has(r.id)) return
              let p = r.parent_id
              while (p != null) {
                if (keep.has(p)) { keep.add(r.id); break }
                p = byId.get(p)?.parent_id ?? null
              }
            })
            baseRows = g.rows.filter(r => r && keep.has(r.id))
          }
          const rows = [...baseRows]
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
                headerRows={g.rows}
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

      {/* ── Export / Print: choose which key (page) to include ── */}
      {exportMode && (
        <div className="comp-overlay" onClick={() => setExportMode(null)}>
          <div className="comp-dialog" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="comp-dialog-hdr">
              <span>{exportMode === 'excel' ? '📊 Export Excel' : exportMode === 'pdf' ? '🖨 Export PDF' : '🖨 Print'} — select pages</span>
              <button className="comp-dialog-close" onClick={() => setExportMode(null)}>✕</button>
            </div>
            <div className="comp-dialog-badge">
              Choose the keys (pages) to include — selected pages are exported in order.
            </div>
            <div className="comp-dialog-body">
              <label className="exp-row exp-row--all">
                <input type="checkbox"
                  checked={exportSel.length === pages.length}
                  ref={el => { if (el) el.indeterminate = exportSel.length > 0 && exportSel.length < pages.length }}
                  onChange={e => setExportSel(e.target.checked ? pages.map((_, i) => i) : [])} />
                <b>Select all</b> <span style={{ color: '#94a3b8', fontWeight: 400 }}>({exportSel.length}/{pages.length})</span>
              </label>
              {pages.map((p, i) => (
                <label key={p.key} className="exp-row">
                  <input type="checkbox" checked={exportSel.includes(i)} onChange={() => toggleExportPage(i)} />
                  <span className="exp-row-label">{p.label || `Key ${p.key}`}</span>
                </label>
              ))}
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setExportMode(null)}>Cancel</button>
              <button className="bdv-btn bdv-btn--rev" onClick={confirmExport} disabled={!exportSel.length}>
                {exportMode === 'print' ? '🖨 Print' : '⬇ Export'} ({exportSel.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Part No. view dialog ── */}
      {showViewDlg && (
        <div className="comp-overlay" onClick={() => setShowViewDlg(false)}>
          <div className="comp-dialog" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="comp-dialog-hdr">
              <span>🔍 Create view — Select Part No.</span>
              <button className="comp-dialog-close" onClick={() => setShowViewDlg(false)}>✕</button>
            </div>
            <div className="comp-dialog-badge">
              This view belongs to <b>{pages.find(p => p.key === effectiveKey)?.label || `Key ${effectiveKey}`}</b> · shows Part No. that <b>contain the entered text</b> (e.g. GS = all that contain GS)
            </div>
            <div className="comp-dialog-body">
              <div className="comp-dialog-grid" style={{ gridTemplateColumns: '1fr' }}>
                <label>View name <span style={{ color: '#c00' }}>*</span></label>
                <input className="comp-dialog-input" value={viewName} onChange={e => setViewName(e.target.value)}
                  placeholder="e.g. Sewn parts only" autoFocus />
                <label style={{ marginTop: 10 }}>Part No. or partial <span style={{ color: '#c00' }}>*</span>
                  <span style={{ color: '#aaa', fontSize: 11, fontWeight: 400 }}> (one per line or comma-separated — partial OK, e.g. GS, GS110)</span>
                </label>
                <textarea className="comp-dialog-input" rows={6} value={viewParts} onChange={e => setViewParts(e.target.value)}
                  placeholder={'GS110\nGU224\n4-68403\n...'} style={{ resize: 'vertical', fontFamily: 'monospace' }} />
              </div>
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setShowViewDlg(false)} disabled={viewSaving}>Cancel</button>
              <button className="bdv-btn bdv-btn--rev" onClick={createView}
                disabled={viewSaving || !viewName.trim() || !viewParts.trim()}>
                {viewSaving ? 'Saving…' : '✓ Create view'}
              </button>
            </div>
          </div>
        </div>
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
function BomPage({ bom, header, onToggle, onField, revNames, setRevName, rows, headerRows, pageNum, totalPages }) {
  const isBag = bom.bom_group === 'BAG'
  // Header Part No. (FG/TGT) always reflects the page's TRUE Level-1 row, even when a view
  // filters those rows out of the body. Fall back to the body rows if no override is given.
  const hRows = headerRows ?? rows
  // Bag BOMs always show 6 Part No. levels; HE shows 5 (or more if data is deeper)
  const maxLevel = Math.max(isBag ? 6 : 5, ...rows.filter(r => r?.level).map(r => r.level))
  const levelCols = Array.from({ length: maxLevel }, (_, i) => i + 1)
  const pageLv1 = hRows.find(r => r && r.level === 1 && r.status !== 'revised_out')
  const pageTgPartNo = pageLv1?.tg_part_no ?? bom.tg_part_no
  // Per-key TGT history: use the revised_out Level 1 rows on THIS page only
  // (avoids cross-key contamination from the shared design_spec_tgt_history)
  const pageTgtHistory = hRows
    .filter(r => r && r.level === 1 && r.status === 'revised_out' && !r._custPnOnly)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
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
        <Cols maxLevel={maxLevel} />
        <tbody>

          {/* ── Row 1: [Event Issue | Concern With] [BILL OF MATERIAL] [Page] [Signature] */}
          <tr>
            {/* LEFT BLOCK — Event Issue + Concern With (cols 1-5) */}
            <td className="bp-event" colSpan={maxLevel}>
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
                    <td><Chk checked={header.evt_dan}         onChange={()=>onToggle('evt_dan')}/>{isBag ? 'HVPT' : 'DAN'}</td>
                    <td><Chk checked={header.concern_drawing} onChange={()=>onToggle('concern_drawing')}/>Drawing : Rev. –</td>
                  </tr>
                  <tr>
                    <td><Chk checked={header.evt_cv}  onChange={()=>onToggle('evt_cv')}/>{isBag ? '1A' : 'CV'}</td>
                    <td><Chk checked={header.evt_hin} onChange={()=>onToggle('evt_hin')}/>{isBag ? 'SVP' : 'HIN'}</td>
                    <td><Chk checked={header.concern_actual_part} onChange={()=>onToggle('concern_actual_part')}/>Actual Part : stage</td>
                  </tr>
                  <tr>
                    <td><Chk checked={header.evt_mq}  onChange={()=>onToggle('evt_mq')}/>{isBag ? '2A' : 'MQ'}</td>
                    <td><Chk checked={header.evt_sop} onChange={()=>onToggle('evt_sop')}/>{isBag ? 'MPT' : 'SOP'}</td>
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
                    <td colSpan={3} style={{height: '15px'}}>{isBag ? 'PE' : 'Pro. Eng.'}</td>
                    <td style={{height: '15px'}}>Purchase</td>
                    <td style={{height: '15px'}}>Part control</td>
                  </tr>
                  <tr>
                    <td style={{height: '15px'}}>CO-OR</td>
                    <td style={{height: '15px'}}>{isBag ? 'GM' : 'AGM'}</td>
                    <td style={{height: '15px'}}>{isBag ? 'AGM' : 'Mgr.'}</td>
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

          {isBag ? (<>
            {/* ── Bag Row 2: Model No. | FG Part No. | Customer Name | Date */}
            <tr>
              <td className="bp-lbl" colSpan={3}>
                <span style={{display:'inline-block', minWidth:58}}>Model No.</span>: <b>{bom.model}</b>
              </td>
              <td className="bp-lbl" colSpan={3}>
                <span style={{display:'inline-block', minWidth:80}}>FG Part No.</span>:{' '}
                <b>
                  {(pageLv1?.update_level ?? 0) > 0 && <TriangleMark num={(pageLv1?.update_level ?? 0) + 1} size="sm" />}
                  {pageTgPartNo}
                </b>
              </td>
              <td className="bp-lbl" colSpan={1} rowSpan={3} style={{textAlign: 'center'}}>
                Customer Name :
              </td>
              <td className="bp-val" colSpan={3} rowSpan={3} style={{textAlign: 'center'}}>
                <input
                  className="bp-rev-input"
                  value={header.customer_name}
                  onChange={e => onField('customer_name', e.target.value)}
                  placeholder="Customer Name"
                  style={{width:'100%', textAlign:'center', fontWeight:700}}
                />
              </td>
              <td className="bp-lbl" colSpan={1} rowSpan={3} style={{textAlign: 'center'}}>
                Date :
              </td>
              <td className="bp-val" colSpan={maxLevel - 1} rowSpan={3} style={{textAlign: 'center'}}>
                <b>{bom.date}</b>
              </td>
            </tr>

            {/* ── Bag Row 3: Model Name | Part name (from Level 1 item) */}
            <tr>
              <td className="bp-lbl" colSpan={3}>
                <span style={{display:'inline-block', minWidth:58}}>Model Name</span>:{' '}
                <input
                  className="bp-rev-input"
                  value={header.model_name}
                  onChange={e => onField('model_name', e.target.value)}
                  placeholder="Model Name"
                  style={{ width: 'calc(100% - 70px)', fontWeight: 700 }}
                />
              </td>
              <td className="bp-lbl" colSpan={3}>
                <span style={{display:'inline-block', minWidth:80}}>Part name</span>: <b>{pageLv1?.part_name ?? bom.part_name}</b>
              </td>
            </tr>

            {/* ── Bag Row 4: spacer to keep 4-row header height */}
            <tr>
              <td className="bp-lbl" colSpan={6} style={{height:'14px'}}/>
            </tr>
          </>) : (<>
          {/* ── Row 2: Type | Customer Part No. */}
          <tr>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:58}}>Type</span>: <b>{bom.type ?? 'HE'}</b>
            </td>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:80}}>Customer Part No.</span>: <b>{bom.customer_part_no}</b>
            </td>
            <td colSpan={maxLevel + 4} style={{border:'none'}}/>
          </tr>

          {/* ── Row 3: Model No. | TGT Part No. | Customer Name | Date */}
          <tr>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:58}}>Model No.</span>: <b>{bom.model}</b>
            </td>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:80}}>TGT Part No.</span>:{' '}
              <b>
                {pageTgtHistory.map((r,i)=>(
                  <span key={i} style={{marginRight:2}}>
                    <span className="bp-pn-struck">{r.tg_part_no}</span>{' '}
                  </span>
                ))}
                {(pageLv1?.update_level ?? 0) > 0 && <TriangleMark num={pageTgtHistory.length + 1} size="sm" />}
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
            <td className="bp-val" colSpan={maxLevel - 1} rowSpan={2} style={{textAlign: 'center'}}>
              <b>{bom.date}</b>
            </td>
            {/* 10 columns taken by signature box rowSpan */}
          </tr>

          {/* ── Row 4: Model Name | Part name (per-key from Level 1 item) */}
          <tr>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:58}}>Model Name</span>:{' '}
              <input
                className="bp-rev-input"
                value={header.model_name}
                onChange={e => onField('model_name', e.target.value)}
                placeholder="Model Name"
                style={{ width: 'calc(100% - 70px)', fontWeight: 700 }}
              />
            </td>
            <td className="bp-lbl" colSpan={3}>
              <span style={{display:'inline-block', minWidth:80}}>Part name</span>: <b>{pageLv1?.part_name ?? bom.part_name}</b>
            </td>
          </tr>
          </>)}

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
        <Cols maxLevel={maxLevel} />
        <thead>
          <tr>
            <th colSpan={maxLevel}  className="bp-th bp-th-group">Part No.</th>
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
            {levelCols.map(n=><th key={n} className="bp-th bp-th-pn">{n}</th>)}
            <th className="bp-th bp-th-xs">Part</th>
            <th className="bp-th bp-th-xs">Gate</th>
            {[1,2,3,4,5].map(n=><th key={n} className="bp-th bp-th-xs">{n}</th>)}
            {['M/C','T/T','Local','Import'].map(s=><th key={s} className="bp-th bp-th-xs">{s}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row,i)=><BomRow key={i} row={row} maxLevel={maxLevel} isBag={isBag}/>)}
        </tbody>
        <tfoot>
          <tr>
            {/* A = Engineering, B = Part Control, C = Purchase */}
            <td colSpan={maxLevel}  className="bp-mark">A</td>
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
        <Cols maxLevel={maxLevel} />
        <tbody>
          {(()=>{
            const emptyCount = Math.max(0, 6 - revisions.length)
            const totalRows = 1 + revisions.length + emptyCount
            return <>
              {/* Note cell + spacer use rowSpan to sit flush next to revision header */}
              <tr style={{height:'12px'}}>
                <td className="bp-note-cell" colSpan={3} rowSpan={totalRows}>
                  <div className="bp-note-cell-inner">
                    <div style={{fontWeight:700,marginBottom:2}}>Note :</div>
                    <div className="bp-note-line">'A' = Record by Engineering section&nbsp;&nbsp;Update ECI No.</div>
                    <div className="bp-note-line">'B' = Record by Part Control section</div>
                    <div className="bp-note-line">'C' = Record by Purchase section</div>
                  </div>
                </td>
                <td colSpan={maxLevel - 2} className="bp-bot-spacer" rowSpan={totalRows}/>
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
                    <td className="bp-rev-td" colSpan={10}>
                      {isFirst
                        ? (rev.revision_record ?? 'First issue')
                        : <input className="bp-rev-input" value={revNames?.[rev.mark]?.revision_record ?? ''} onChange={e=>setRevName(rev.mark,'revision_record',e.target.value)} placeholder="Revision note"/>
                      }
                    </td>
                    <td className="bp-rev-td" colSpan={2} style={{textAlign:'center'}}>
                      {rev.eci_no && (rev.pdf_url || (isFirst && bom.pdf_url))
                        ? <a href={rev.pdf_url ?? bom.pdf_url} target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'none',cursor:'pointer'}}>{rev.eci_no}</a>
                        : (rev.eci_no ?? '')}
                    </td>
                    <td className="bp-rev-td" colSpan={2} style={{textAlign:'center'}}>{rev.revision_date ?? ''}</td>
                    <td className="bp-rev-td" colSpan={2}>
                      {isFirst
                        ? <input className="bp-rev-input" value={header.revisioner} onChange={e=>onField('revisioner',e.target.value)} placeholder="Revised by"/>
                        : <input className="bp-rev-input" value={revNames?.[rev.mark]?.revisioner ?? ''} onChange={e=>setRevName(rev.mark,'revisioner',e.target.value)} placeholder="Revised by"/>
                      }
                    </td>
                    <td className="bp-rev-td" colSpan={2}>
                      {isFirst
                        ? <input className="bp-rev-input" value={header.approved_by} onChange={e=>onField('approved_by',e.target.value)} placeholder="Approved by"/>
                        : <input className="bp-rev-input" value={revNames?.[rev.mark]?.approved_by ?? ''} onChange={e=>setRevName(rev.mark,'approved_by',e.target.value)} placeholder="Approved by"/>
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
            <td colSpan={maxLevel + 1} className="bp-bot-spacer"/>
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
function BomRow({ row, maxLevel = 5, isBag = false }) {
  const levelCols = Array.from({ length: maxLevel }, (_, i) => i + 1)
  if (!row) return (
    <tr className="bp-row-empty">
      {Array(20 + maxLevel).fill(null).map((_, i) => <td key={i} className="bp-td-empty" />)}
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
    // strip Japanese (Hiragana/Katakana/Kanji) and full-width/CJK punctuation from Material Spec
    .replace(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu, '')
    .replace(new RegExp('[\\u3000-\\u303F\\uFF00-\\uFFEF]', 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim().replace(/\|\s*$/, '').trim()

  const displayQty  = noteQty  ?? (row.quantity != null ? parseFloat(row.quantity) : '')
  const displayMass = noteMass ?? (row.mass_g   != null ? Number(row.mass_g).toLocaleString() : '')
  const displayPrice   = row.price_per_pc != null ? Number(row.price_per_pc).toLocaleString() : ''
  const displayMatCost = row.material_cost != null ? Number(row.material_cost).toLocaleString() : ''

  // Material Spec = the editable note only, so Document and Completion always match.
  // (Product/Material Standards like "IN DRAWING" are folded into the note on import/backfill,
  //  so they can be edited or removed in the Completion view.)
  const spec = cleanNote || ''

  // Synthetic customer_pn-only header row (injected by insertRevisedOut)
  // Renders the customer_part_no line without struck-through styling, always first.
  if (row._custPnOnly) {
    return (
      <tr className={`bp-row bp-row-lv${lv}`}>
        {levelCols.map(n => (
          <td key={n} className={`bp-td bp-td-pn bp-td-pn${n}`}>
            {n === 1 ? <div className="bp-pn-cell"><span>{row.customer_part_no}</span></div> : ''}
          </td>
        ))}
        <td className="bp-td bp-td-name">{row.part_name}</td>
        <td className="bp-td bp-td-spec">{spec}</td>
        <td className="bp-td bp-td-c">{displayQty}</td>
        <td className="bp-td bp-td-c">{displayMass}</td>
        <td className="bp-td bp-td-c">{row.gate ?? ''}</td><td className="bp-td bp-td-c" />
        {[0,1,2,3,4].map(i => <td key={i} className="bp-td bp-td-c" />)}
        {[0,1,2,3].map(i => <td key={i} className="bp-td bp-td-c" />)}
        <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-c" /><td className="bp-td bp-td-c" />
        <td className="bp-td bp-td-remark" />
      </tr>
    )
  }

  // _skipCustPn: customer_pn was already injected as a header row above the struck rows.
  // BAG BOMs show ONLY the FG (TG) Part No. on Level 1 — no separate customer_pn line.
  const hasCustPn = lv === 1 && !!row.customer_part_no && !isRevisedOut && !row._skipCustPn && !isBag
  const trClass = `bp-row bp-row-lv${lv}${isRevisedOut ? ' bp-row-revised-out' : ''}`

  return (
    <>
      <tr className={trClass}>
        {levelCols.map(n => (
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
        <td className="bp-td bp-td-c">{row.gate ?? ''}</td>
        <td className="bp-td bp-td-c">{displayPrice}</td>
        <td className="bp-td bp-td-c">{displayMatCost}</td>
        {[0,1,2,3].map(i => <td key={i} className="bp-td bp-td-c" />)}
        {['M/C','T/T','Local','Import'].map(s => <td key={s} className="bp-td bp-td-c">{row.completion_supplier === s ? '✓' : ''}</td>)}
        <td className="bp-td bp-td-c">{row.receiver ?? ''}</td>
        <td className="bp-td bp-td-c">{row.internal_code ?? ''}</td>
        <td className="bp-td bp-td-c">{row.kanban_qty ?? ''}</td>
        <td className="bp-td bp-td-c">{row.lead_time_day ?? ''}</td>
        <td className="bp-td bp-td-remark">{row.completion_remark ?? ''}</td>
      </tr>
      {hasCustPn && (
        <tr className={trClass}>
          {levelCols.map(n => (
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
          <td className="bp-td bp-td-c">{row.gate ?? ''}</td><td className="bp-td bp-td-c" />
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
  const [revisioner, setRevisioner] = useState(() => currentUserName())
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
      setPdfError('Please select a PDF file only'); return
    }
    setPdfParsing(true); setPdfError(null); setPreview(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/import/revision-preview/${bom.id}`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.message || data.error)
      setPreview(data)
      if (data.pdf_url) setPreview(p => ({ ...p, pdf_url: data.pdf_url }))
      if (data.header?.internal_eci_no) setEciNo(data.header.internal_eci_no)
      // Pick tgt_change for the currently active key (per-key, from Level 1 table rows)
      const keyChange = data.tgt_changes?.[activeRevKey] ?? Object.values(data.tgt_changes ?? {})[0]
      if (keyChange) setNewTgt(keyChange.new)
      // Pre-fill item_changes into itemUpdates
      const updates = {}
      for (const ch of data.item_changes ?? []) {
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
      setError('No changes detected'); return
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
          active_key: activeRevKey || null,
          pdf_url: preview?.pdf_url ?? null,
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
          <span>△ Save Update / Revision</span>
          <button className="rev-dlg__close" onClick={onClose}>✕</button>
        </div>
        <div className="rev-dlg__body">

          {/* ── Mode chooser ── */}
          {mode === 'choose' && (
            <div className="rev-dlg__choose">
              <button className="rev-dlg__choose-btn" onClick={() => setMode('pdf')}>
                <span className="rev-dlg__choose-icon">📄</span>
                <span className="rev-dlg__choose-title">Upload New PDF</span>
                <span className="rev-dlg__choose-sub">System compares Part No. automatically</span>
              </button>
              <button className="rev-dlg__choose-btn" onClick={() => setMode('manual')}>
                <span className="rev-dlg__choose-icon">✏️</span>
                <span className="rev-dlg__choose-title">Enter Manually</span>
                <span className="rev-dlg__choose-sub">Specify changed Part No. manually</span>
              </button>
            </div>
          )}

          {/* ── PDF mode ── */}
          {mode === 'pdf' && (
            <>
              <button className="rev-dlg__back" onClick={() => { setMode('choose'); setPreview(null); setPdfError(null) }}>← Back</button>

              {!preview && (
                <div
                  className={`rev-dlg__dropzone${pdfParsing ? ' rev-dlg__dropzone--loading' : ''}`}
                  onClick={() => !pdfParsing && fileRef.current?.click()}
                  onDrop={e => { e.preventDefault(); onPdfFile(e.dataTransfer.files[0]) }}
                  onDragOver={e => e.preventDefault()}
                >
                  <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}} onChange={e => onPdfFile(e.target.files[0])} />
                  {pdfParsing
                    ? <><div className="upload-spinner" style={{margin:'0 auto 8px'}}/><div>Analyzing PDF… (30–60 sec)</div></>
                    : <><div style={{fontSize:28}}>📄</div><div style={{marginTop:6,fontWeight:500}}>Select or drag a new PDF file here</div></>
                  }
                </div>
              )}
              {pdfError && <div className="rev-dlg__error">⚠ {pdfError}</div>}

              {/* Preview results */}
              {preview && (
                <>
                  <div className="rev-dlg__preview-title">Comparison Result</div>

                  {!preview.tgt_change && !preview.item_changes?.length && !preview.new_items?.length && (
                    <div className="rev-dlg__preview-none">No Part No. changes found</div>
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
                      <div className="rev-dlg__preview-label">Changed Part No. ({preview.item_changes.length} items)</div>
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
                      <div className="rev-dlg__preview-label">New Parts to Add ({preview.new_items.length} items)</div>
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
                  <div className="rev-dlg__preview-label" style={{marginTop:14}}>Revision Info</div>
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
                    <button className="bdv-btn bdv-btn--secondary" onClick={() => { setPreview(null); setPdfError(null) }} disabled={saving}>Re-upload</button>
                    <button className="bdv-btn" onClick={submit} disabled={saving || (!preview.tgt_change && !preview.item_changes?.length)}>
                      {saving ? 'Saving…' : '✓ Confirm Update'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Manual mode ── */}
          {mode === 'manual' && (
            <>
              <button className="rev-dlg__back" onClick={() => setMode('choose')}>← Back</button>
              <div className="rev-dlg__grid">
                <label>ECI No.</label>
                <input value={eciNo} onChange={e => setEciNo(e.target.value)} placeholder="26A376" />
                <label>Date</label>
                <input type="date" value={revDate} onChange={e => setRevDate(e.target.value)} />
                <label>Revisioner</label>
                <input value={revisioner} onChange={e => setRevisioner(e.target.value)} />
                <label>Approved</label>
                <input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} />
                <label>New TGT Part No.</label>
                <input value={newTgt} onChange={e => setNewTgt(e.target.value)} placeholder={bom.tg_part_no ?? ''} />
              </div>

              <div className="rev-dlg__section-title">
                Edit Part Data — enter new values only for items you want to change (leave blank to keep unchanged)
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
                            <label>New Part No.</label>
                            <input className="rev-dlg__inp rev-dlg__inp--mono"
                              placeholder="Leave blank to keep"
                              value={v.pn ?? ''}
                              onChange={e => onItemChange(item.id, 'pn', e.target.value)}
                            />
                          </div>
                          <div className="rev-dlg__input-field">
                            <label>New Part Name</label>
                            <input className="rev-dlg__inp"
                              placeholder="Leave blank to keep"
                              value={v.name ?? ''}
                              onChange={e => onItemChange(item.id, 'name', e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="rev-dlg__input-row">
                          <div className="rev-dlg__input-field rev-dlg__input-field--spec">
                            <label>New Material Spec</label>
                            <input className="rev-dlg__inp"
                              placeholder="Leave blank to keep"
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
                <button className="bdv-btn bdv-btn--secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button className="bdv-btn" onClick={submit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Update'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
