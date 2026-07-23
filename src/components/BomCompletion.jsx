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
const EMPTY_FORM = { tg_part_no: '', part_name: '', notes: '', quantity: '1', mass_gram: '', image: null }

export default function BomCompletion({ bom, onRefresh }) {
  const items = (bom?.items ?? []).filter(i => i.status !== 'revised_out' && i.tg_part_no)
  const allKeys = [...new Set(items.flatMap(i => parseKeyList(i.key_code)))].sort((a, b) => a - b).map(String)
  const [activeKey, setActiveKey] = useState(allKeys[0] ?? '0')
  const [rows, setRows] = useState({})
  const [saving, setSaving] = useState(false)

  const dbRows = useMemo(() => {
    const init = {}
    ;(bom?.items ?? []).forEach(item => {
      if (item.price_per_pc || item.completion_supplier || item.lead_time_day || item.completion_remark) {
        init[item.id] = {
          price: item.price_per_pc ? String(item.price_per_pc) : '',
          supplier: item.completion_supplier ?? '–',
          lead_time: item.lead_time_day ? String(item.lead_time_day) : '',
          remark: item.completion_remark ?? '',
        }
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

  function getRow(id) { return rows[id] ?? dbRows[id] ?? { price: '', supplier: '–', lead_time: '', remark: '' } }
  function setField(id, field, val) { setRows(prev => ({ ...prev, [id]: { ...getRow(id), [field]: val } })) }

  function displayQty(item) {
    const fromNote = item.note?.match(/Q'ty:\s*([^|]+)/)?.[1]?.trim()
    if (fromNote) return fromNote
    return item.quantity != null ? item.quantity : '–'
  }
  function displayMass(item) {
    const fromNote = item.note?.match(/Weight:\s*([^|]+)/)?.[1]?.trim()
    if (fromNote) return fromNote
    return item.mass_g != null ? Number(item.mass_g).toLocaleString() : '–'
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const updates = Object.entries(rows).filter(([, v]) => v.price || v.lead_time || v.remark || (v.supplier && v.supplier !== '–'))
      await Promise.all(updates.map(([id, v]) =>
        fetch(`/api/bom/${bom.id}/items/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: v.price || null, supplier: v.supplier, lead_time: v.lead_time || null, remark: v.remark || null }),
        })
      ))
      setMsg('ok'); onRefresh?.()
    } catch { setMsg('err') }
    finally { setSaving(false); setTimeout(() => setMsg(null), 3000) }
  }

  function openAdd(item) {
    setAddAfter(item)
    setForm(EMPTY_FORM)
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
    if (!form.part_name.trim()) { setAddErr('กรุณากรอก Part Name'); return }
    setAddSaving(true); setAddErr(null)
    try {
      const fd = new FormData()
      fd.append('after_bom_id', addAfter.id)
      fd.append('part_name', form.part_name.trim())
      if (form.tg_part_no.trim()) fd.append('tg_part_no', form.tg_part_no.trim())
      if (form.notes.trim())    fd.append('notes', form.notes.trim())
      if (form.quantity)        fd.append('quantity', form.quantity)
      if (form.mass_gram)       fd.append('mass_gram', form.mass_gram)
      if (form.image)           fd.append('image', form.image)

      const r = await fetch(`/api/bom/${bom.id}/items/insert-after`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      closeAdd()
      onRefresh?.()
    } catch (e) { setAddErr(e.message) }
    finally { setAddSaving(false) }
  }

  const newLevel = addAfter ? Math.min((addAfter.level ?? 1) + 1, 5) : null

  return (
    <div className="comp-wrap">
      <div className="comp-hdr">
        <div className="comp-hdr-info">
          <b>{bom?.tg_part_no}</b> · {bom?.model} · {bom?.customer}
        </div>
        <div className="comp-hdr-note">⚠ กรอก Price / Supplier / Lead time ที่ยังขาดหาย · กด + เพื่อเพิ่ม Part ใหม่</div>
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
            {visible.length} รายการ
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="comp-tbl">
          <thead>
            <tr>
              <th style={{width:32}}></th>
              <th>Lv</th>
              <th>TG Part No.</th>
              <th>Part Name</th>
              <th>Q'ty</th>
              <th>Mass (g)</th>
              <th>Price/pcs (฿)</th>
              <th>Supplier</th>
              <th>Lead time (day)</th>
              <th>Remark</th>
              <th style={{width:32}}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const r = getRow(row.id)
              return (
                <tr key={row.id} className={`comp-row comp-lv${row.level ?? 1}`}>
                  <td className="comp-td-c">
                    <button className="comp-add-btn" title="เพิ่ม Part ต่อจากรายการนี้" onClick={() => openAdd(row)}>+</button>
                  </td>
                  <td className="comp-td-c">{row.level}</td>
                  <td className="comp-td-pn">
                    <span className="comp-pn-link" onClick={() => setDetail(row)}>{row.tg_part_no}</span>
                  </td>
                  <td>{row.part_name}</td>
                  <td className="comp-td-c">{displayQty(row)}</td>
                  <td className="comp-td-c">{displayMass(row)}</td>
                  <td><input className="comp-input" value={r.price} onChange={e => setField(row.id, 'price', e.target.value)} placeholder="ใส่ราคา" /></td>
                  <td>
                    <select className="comp-select" value={r.supplier} onChange={e => setField(row.id, 'supplier', e.target.value)}>
                      {SUPPLIER_OPTS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td><input className="comp-input" value={r.lead_time} onChange={e => setField(row.id, 'lead_time', e.target.value)} placeholder="วัน" /></td>
                  <td><input className="comp-input" style={{ width: 120 }} value={r.remark} onChange={e => setField(row.id, 'remark', e.target.value)} placeholder="หมายเหตุ" /></td>
                  <td className="comp-td-c">
                    <button className="comp-del-btn" title="ลบ Part นี้" onClick={() => setDelConfirm(row)}>🗑</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="comp-footer">
        {msg === 'ok' && <span className="comp-msg comp-msg--ok">✓ บันทึกแล้ว</span>}
        {msg === 'err' && <span className="comp-msg comp-msg--err">⚠ บันทึกไม่สำเร็จ</span>}
        <button className="bdv-btn" onClick={save} disabled={saving}>
          {saving ? 'กำลังบันทึก…' : '💾 บันทึก'}
        </button>
      </div>

      {/* ── Part Detail Popup ── */}
      {detail && (
        <div className="comp-overlay">
          <div className="comp-dialog">
            <div className="comp-dialog-hdr">
              <span>รายละเอียด Part</span>
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
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setDetail(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Part Dialog ── */}
      {addAfter && (
        <div className="comp-overlay">
          <div className="comp-dialog">
            <div className="comp-dialog-hdr">
              <span>+ เพิ่ม Part ต่อจาก <b>{addAfter.tg_part_no}</b></span>
              <button className="comp-dialog-close" onClick={closeAdd}>✕</button>
            </div>
            <div className="comp-dialog-badge">
              Part ใหม่จะอยู่ที่ Level <b>{newLevel}</b>
              {newLevel === addAfter.level ? ' (ระดับเดิม — ไม่ลึกกว่า Lv.5 แล้ว)' : ` (Child ของ Lv.${addAfter.level})`}
            </div>

            <div className="comp-dialog-body">
              <div className="comp-dialog-grid">
                <label>TG Part No. <span style={{color:'#aaa',fontSize:11}}>(ไม่บังคับ)</span></label>
                <input className="comp-dialog-input" value={form.tg_part_no} onChange={e => onFormField('tg_part_no', e.target.value)} placeholder="XXXXX-XXXXX" />

                <label>Part Name <span style={{color:'#c00',fontSize:11}}>*</span></label>
                <input className="comp-dialog-input" value={form.part_name} onChange={e => onFormField('part_name', e.target.value)} placeholder="ชื่อ Part" autoFocus />

                <label>Material Spec</label>
                <input className="comp-dialog-input" value={form.notes} onChange={e => onFormField('notes', e.target.value)} placeholder="วัสดุ / สเปค" />

                <label>Q'ty (pcs.)</label>
                <input className="comp-dialog-input" value={form.quantity} onChange={e => onFormField('quantity', e.target.value)} />

                <label>Weight (g./pc.)</label>
                <input className="comp-dialog-input" value={form.mass_gram} onChange={e => onFormField('mass_gram', e.target.value)} placeholder="น้ำหนัก" />

                <label>รูปภาพ</label>
                <div>
                  <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={onImageChange} />
                  <button className="comp-img-btn" onClick={() => fileRef.current?.click()}>
                  
                    {form.image ? '🖼 เปลี่ยนรูป' : '📷 เลือกรูป'}
                  </button>
                  {preview && <img src={preview} alt="preview" className="comp-img-preview" />}
                </div>
              </div>

              {addErr && <div className="comp-dialog-err">⚠ {addErr}</div>}
            </div>

            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={closeAdd} disabled={addSaving}>ยกเลิก</button>
              <button className="bdv-btn" onClick={submitAdd} disabled={addSaving}>
                {addSaving ? 'กำลังบันทึก…' : '+ เพิ่ม Part'}
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
              <span>ยืนยันลบ Part</span>
              <button className="comp-dialog-close" onClick={() => setDelConfirm(null)}>✕</button>
            </div>
            <div className="comp-dialog-body" style={{padding:'16px 20px'}}>
              <p style={{margin:0}}>ลบ <b>{delConfirm.tg_part_no ?? delConfirm.part_name}</b> ออกจาก BOM?</p>
              <p style={{margin:'6px 0 0',fontSize:12,color:'#888'}}>ลบได้เฉพาะ Part ที่เพิ่มเองเท่านั้น</p>
            </div>
            <div className="comp-dialog-footer">
              <button className="bdv-btn bdv-btn--secondary" onClick={() => setDelConfirm(null)}>ยกเลิก</button>
              <button className="bdv-btn bdv-btn--danger" onClick={() => deleteItem(delConfirm)}>ลบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
