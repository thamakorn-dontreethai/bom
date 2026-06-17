import { useState, useRef, useMemo } from 'react'

function parseKeyList(kc) {
  if (!kc) return []
  const s = String(kc).trim()
  const m = s.match(/^(\d+)-(\d+)$/)
  if (m) { const r = []; for (let k = +m[1]; k <= +m[2]; k++) r.push(k); return r }
  if (s.includes(',')) return s.split(',').map(n => parseInt(n)).filter(n => !isNaN(n))
  const n = parseInt(s); return isNaN(n) ? [] : [n]
}

const SUPPLIER_OPTS = ['–', 'Local', 'Import', 'M/C', 'T/T']
const EMPTY_FORM = { tg_part_no: '', part_name: '', notes: '', quantity: '1', mass_gram: '', image: null, level: '' }
const EMPTY_ROW = { tg_part_no:'', part_name:'', note:'', quantity:'', mass_g:'', gate:'', price:'', material_cost:'', supplier:'–', receiver:'', internal_code:'', kanban_qty:'', lead_time:'', remark:'' }

export default function BomCompletion({ bom, onRefresh }) {
  const items = (bom?.items ?? []).filter(i => i.status !== 'revised_out' && i.tg_part_no)
  const allKeys = [...new Set(items.flatMap(i => parseKeyList(i.key_code)))].sort((a, b) => a - b).map(String)
  const [activeKey, setActiveKey] = useState(allKeys[0] ?? '0')
  const [rows, setRows] = useState({})
  const [saving, setSaving] = useState(false)

  const dbRows = useMemo(() => {
    const init = {}
    ;(bom?.items ?? []).forEach(item => {
      init[item.id] = {
        tg_part_no:    item.tg_part_no ?? '',
        part_name:     item.part_name ?? '',
        note:          item.note ?? '',
        quantity:      item.quantity != null ? String(item.quantity) : '',
        mass_g:        item.mass_g != null ? String(item.mass_g) : '',
        gate:          item.gate ?? '',
        price:         item.price_per_pc ? String(item.price_per_pc) : '',
        material_cost: item.material_cost ? String(item.material_cost) : '',
        supplier:      item.completion_supplier ?? '–',
        receiver:      item.receiver ?? '',
        internal_code: item.internal_code ?? '',
        kanban_qty:    item.kanban_qty ?? '',
        lead_time:     item.lead_time_day ? String(item.lead_time_day) : '',
        remark:        item.completion_remark ?? '',
      }
    })
    return init
  }, [bom?.items])
  const [msg, setMsg] = useState(null)
  const [search, setSearch] = useState('')

  // Part detail popup
  const [detail, setDetail] = useState(null)

  // Delete item
  const [delConfirm, setDelConfirm] = useState(null)

  async function deleteItem(item) {
    try {
      const r = await fetch(`/api/bom/${bom.id}/items/${item.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      setDelConfirm(null)
      onRefresh?.()
    } catch { setDelConfirm(null) }
  }

  // Add-part dialog
  const [addAfter, setAddAfter] = useState(null) // the item we're inserting after
  const [form, setForm] = useState(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addErr, setAddErr] = useState(null)
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)

  const visible = items.filter(i => {
    const keys = parseKeyList(i.key_code)
    const matchKey = keys.length === 0 || keys.map(String).includes(activeKey)
    if (!matchKey) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return i.tg_part_no?.toLowerCase().includes(q) || i.part_name?.toLowerCase().includes(q)
  })

  function getRow(id) { return rows[id] ?? dbRows[id] ?? EMPTY_ROW }
  function setField(id, field, val) { setRows(prev => ({ ...prev, [id]: { ...getRow(id), [field]: val } })) }

  function displayQty(item) {
    const fromNote = item.note?.match(/Q'ty:\s*([^|]+)/)?.[1]?.trim()
    if (fromNote) return fromNote
    return item.quantity != null ? parseFloat(item.quantity) : '–'
  }
  function displayMass(item) {
    const fromNote = item.note?.match(/Weight:\s*([^|]+)/)?.[1]?.trim()
    if (fromNote) return fromNote
    return item.mass_g != null ? Number(item.mass_g).toLocaleString() : '–'
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      await Promise.all(Object.entries(rows).map(([id, v]) =>
        fetch(`/api/bom/${bom.id}/items/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tg_part_no:    v.tg_part_no?.trim()    || null,
            part_name:     v.part_name?.trim()     || null,
            note:          v.note?.trim()          || null,
            quantity:      v.quantity              || null,
            mass_g:        v.mass_g               || null,
            gate:          v.gate                 || null,
            price:         v.price                || null,
            material_cost: v.material_cost        || null,
            supplier:      v.supplier,
            receiver:      v.receiver             || null,
            internal_code: v.internal_code        || null,
            kanban_qty:    v.kanban_qty            || null,
            lead_time:     v.lead_time             || null,
            remark:        v.remark               || null,
          }),
        })
      ))
      setMsg('ok'); onRefresh?.()
    } catch { setMsg('err') }
    finally { setSaving(false); setTimeout(() => setMsg(null), 3000) }
  }

  function openAdd(item) {
    setAddAfter(item)
    const max = bom?.bom_group === 'BAG' ? 6 : 5
    setForm({ ...EMPTY_FORM, level: String(Math.min((item.level ?? 1) + 1, max)) })
    setAddErr(null)
    setPreview(null)
  }

  function closeAdd() { setAddAfter(null) }

  function onFormField(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function onImageChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setForm(f => ({ ...f, image: file }))
    setPreview(URL.createObjectURL(file))
  }

  async function submitAdd() {
    if (!form.part_name.trim()) { setAddErr('Please enter a Part Name'); return }
    setAddSaving(true); setAddErr(null)
    try {
      const fd = new FormData()
      fd.append('after_bom_id', addAfter.id)
      fd.append('part_name', form.part_name.trim())
      if (form.tg_part_no.trim()) fd.append('tg_part_no', form.tg_part_no.trim())
      if (form.notes.trim())    fd.append('notes', form.notes.trim())
      if (form.level)           fd.append('level', form.level)
      if (form.quantity)        fd.append('quantity', form.quantity)
      if (form.mass_gram)       fd.append('mass_gram', form.mass_gram)
      if (form.image)           fd.append('image', form.image)

      const r = await fetch(`/api/bom/${bom.id}/items/insert-after`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) {
        if (data.stale_bom) { closeAdd(); onRefresh?.(); return }
        throw new Error(data.error)
      }
      closeAdd()
      onRefresh?.()
    } catch (e) { setAddErr(e.message) }
    finally { setAddSaving(false) }
  }

  // Bag BOMs go to Level 6; everything else (HE/steering wheel etc.) to Level 5.
  const maxLevel = bom?.bom_group === 'BAG' ? 6 : 5
  const levelOpts = Array.from({ length: maxLevel }, (_, i) => i + 1)

  return (
    <div className="comp-wrap">
      <div className="comp-hdr">
        <div className="comp-hdr-info">
          <b>{bom?.tg_part_no}</b> · {bom?.model} · {bom?.customer}
        </div>
        <div className="comp-hdr-note">⚠ Fix data the OCR misread, or add missing data · click + to add a new Part</div>
      </div>

      {allKeys.length > 0 && (
        <div className="tree-keys">
          {allKeys.map(k => (
            <button key={k} className={`tree-key-btn${activeKey === k ? ' active' : ''}`} onClick={() => setActiveKey(k)}>
              Key {k}
            </button>
          ))}
        </div>
      )}

      <div className="comp-search-bar">
        <input
          className="comp-search-input"
          placeholder="Search Part No. or Name Part…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <span className="comp-search-count">
            {visible.length} items
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="comp-tbl">
          <thead>
            <tr>
              <th style={{width:28}}></th>
              <th style={{width:28}}>Lv</th>
              <th style={{minWidth:110}}>TG Part No.</th>
              <th className="comp-th-wide">Part Name</th>
              <th className="comp-th-wide">Material Spec</th>
              <th style={{width:50}}>Q'ty</th>
              <th style={{width:65}}>Part</th>
              <th style={{width:75}}>Gate</th>
              <th style={{width:75}}>Price/pcs (THB)</th>
              <th style={{width:75}}>Mat.Cost</th>
              <th style={{width:72}}>Supplier</th>
              <th style={{width:80}}>Receiver</th>
              <th style={{width:85}}>Internal Code</th>
              <th style={{width:75}}>Qty/Kanban</th>
              <th style={{width:60}}>Lead time</th>
              <th style={{width:100}}>Remark</th>
              <th style={{width:28}}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const r = getRow(row.id)
              const inp = (field, placeholder='', cls='') => (
                <input className={`comp-input${cls ? ' '+cls : ''}`}
                  value={r[field]} placeholder={placeholder}
                  onChange={e => setField(row.id, field, e.target.value)} />
              )
              return (
                <tr key={row.id} className={`comp-row comp-lv${row.level ?? 1}`}>
                  <td className="comp-td-c">
                    <button className="comp-add-btn" title="Add Part" onClick={() => openAdd(row)}>+</button>
                  </td>
                  <td className="comp-td-c">{row.level}</td>
                  <td>{inp('tg_part_no', 'Part No.')}</td>
                  <td>{inp('part_name', 'Part Name')}</td>
                  <td>{inp('note', 'Material Spec')}</td>
                  <td><input className="comp-input comp-input-sm"
                    value={r.quantity ? String(parseInt(r.quantity) || '') : ''}
                    placeholder="1"
                    onChange={e => setField(row.id, 'quantity', e.target.value)} /></td>
                  <td>{inp('mass_g', '0', 'comp-input-sm')}</td>
                  <td>{inp('gate', '–', 'comp-input-sm')}</td>
                  <td>{inp('price', 'THB', 'comp-input-sm')}</td>
                  <td>{inp('material_cost', 'THB', 'comp-input-sm')}</td>
                  <td>
                    <select className="comp-select" value={r.supplier} onChange={e => setField(row.id, 'supplier', e.target.value)}>
                      {SUPPLIER_OPTS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td>{inp('receiver', '–', 'comp-input-sm')}</td>
                  <td>{inp('internal_code', '–', 'comp-input-sm')}</td>
                  <td>{inp('kanban_qty', '–', 'comp-input-sm')}</td>
                  <td>{inp('lead_time', 'day', 'comp-input-sm')}</td>
                  <td>{inp('remark', 'remark')}</td>
                  <td className="comp-td-c">
                    <button className="comp-del-btn" title="Delete" onClick={() => setDelConfirm(row)}>🗑</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="comp-footer">
        {msg === 'ok' && <span className="comp-msg comp-msg--ok">✓ Saved</span>}
        {msg === 'err' && <span className="comp-msg comp-msg--err">⚠ Save failed</span>}
        <button className="bdv-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : '💾 Save'}
        </button>
      </div>

      {/* ── Part Detail Popup ── */}
      {detail && (
        <div className="comp-overlay">
          <div className="comp-dialog">
            <div className="comp-dialog-hdr">
              <span>Part Details</span>
              <button className="comp-dialog-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="comp-dialog-body">
              {detail.image_url && (
                <img src={detail.image_url} alt="part" style={{width:'100%',maxHeight:200,objectFit:'contain',borderRadius:6,border:'1px solid #ddd',marginBottom:14}} />
              )}
              <div className="comp-dialog-grid">
                <label>TG Part No.</label><span style={{fontFamily:'monospace',fontWeight:600}}>{detail.tg_part_no ?? '–'}</span>
                <label>Part Name</label><span>{detail.part_name ?? '–'}</span>
                <label>Material Spec</label><span style={{fontSize:12,color:'#555'}}>
                  {(detail.note ?? '').replace(/Q'ty:\s*[^|]+\|?\s*/g,'').replace(/Weight:\s*[^|]+\|?\s*/g,'').trim().replace(/\|\s*$/,'').trim() || '–'}
                </span>
                <label>Q'ty</label><span>{displayQty(detail)}</span>
                <label>Weight (g)</label><span>{displayMass(detail)}</span>
                <label>Level</label><span>Lv.{detail.level}</span>
              </div>
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Part Dialog ── */}
      {addAfter && (
        <div className="comp-overlay">
          <div className="comp-dialog">
            <div className="comp-dialog-hdr">
              <span>+ Add Part after <b>{addAfter.tg_part_no}</b></span>
              <button className="comp-dialog-close" onClick={closeAdd}>✕</button>
            </div>
            <div className="comp-dialog-badge">
              Choose the Level to add (after <b>{addAfter.tg_part_no ?? addAfter.part_name}</b> · Lv.{addAfter.level})
            </div>

            <div className="comp-dialog-body">
              <div className="comp-dialog-grid">
                <label>Level <span style={{color:'#c00',fontSize:11}}>*</span></label>
                <select className="comp-select" value={form.level} onChange={e => onFormField('level', e.target.value)}>
                  {levelOpts.map(lv => (
                    <option key={lv} value={lv}>
                      Level {lv}{lv === (addAfter.level ?? 1) + 1 ? ' (Child)' : lv === addAfter.level ? ' (Same level)' : ''}
                    </option>
                  ))}
                </select>

                <label>TG Part No. <span style={{color:'#aaa',fontSize:11}}>(optional)</span></label>
                <input className="comp-dialog-input" value={form.tg_part_no} onChange={e => onFormField('tg_part_no', e.target.value)} placeholder="XXXXX-XXXXX" />

                <label>Part Name <span style={{color:'#c00',fontSize:11}}>*</span></label>
                <input className="comp-dialog-input" value={form.part_name} onChange={e => onFormField('part_name', e.target.value)} placeholder="Part name" autoFocus />

                <label>Material Spec</label>
                <input className="comp-dialog-input" value={form.notes} onChange={e => onFormField('notes', e.target.value)} placeholder="Material / spec" />

                <label>Q'ty (pcs.)</label>
                <input className="comp-dialog-input" value={form.quantity} onChange={e => onFormField('quantity', e.target.value)} />

                <label>Weight (g./pc.)</label>
                <input className="comp-dialog-input" value={form.mass_gram} onChange={e => onFormField('mass_gram', e.target.value)} placeholder="Weight" />

                <label>Image</label>
                <div>
                  <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={onImageChange} />
                  <button className="comp-img-btn" onClick={() => fileRef.current?.click()}>
                  
                    {form.image ? '🖼 Change image' : '📷 Choose image'}
                  </button>
                  {preview && <img src={preview} alt="preview" className="comp-img-preview" />}
                </div>
              </div>

              {addErr && <div className="comp-dialog-err">⚠ {addErr}</div>}
            </div>

            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={closeAdd} disabled={addSaving}>Cancel</button>
              <button className="bdv-btn" onClick={submitAdd} disabled={addSaving}>
                {addSaving ? 'Saving…' : '+ Add Part'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {delConfirm && (
        <div className="comp-overlay">
          <div className="comp-dialog" style={{maxWidth:340}}>
            <div className="comp-dialog-hdr">
              <span>Confirm Delete Part</span>
              <button className="comp-dialog-close" onClick={() => setDelConfirm(null)}>✕</button>
            </div>
            <div className="comp-dialog-body" style={{padding:'16px 20px'}}>
              <p style={{margin:0}}>Remove <b>{delConfirm.tg_part_no ?? delConfirm.part_name}</b> from the BOM?</p>
              <p style={{margin:'6px 0 0',fontSize:12,color:'#888'}}>Only manually-added Parts can be deleted.</p>
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setDelConfirm(null)}>Cancel</button>
              <button className="bdv-btn bdv-btn--danger" onClick={() => deleteItem(delConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
