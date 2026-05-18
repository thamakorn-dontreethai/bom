import express from 'express'
import multer from 'multer'
import { createRequire } from 'module'
import { pool } from '../db.js'

const _require = createRequire(import.meta.url)
const { PDFParse } = _require('pdf-parse')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })

// ── Text-based DSI PDF parser ─────────────────────────────────────────────────

function cleanPn(s) {
  return s ? s.replace(/\s+/g, '').trim() || null : null
}

function parseHeader(text) {
  const lines = text.split('\n')
  let model = 'UNKNOWN', customerPartNo = null, tgPartNo = null, productionLevel = null
  let initialStage = null, regCertif = null, date = null
  let customerCode = 'UNKNOWN', customerStandards = null, tgStandards = null, internalEciNo = null

  for (const raw of lines) {
    const tabs = raw.split('\t').map(s => s.trim())
    // Model row: 3-char model code e.g. "3GJ\t78500-3DA-J110-M1\t3:SPECIAL ORDER\tC\tNone\t2026/02/02"
    if ((!model || model === 'UNKNOWN') && /^[0-9][A-Z0-9]{2}\s*\t/.test(raw) && tabs.length >= 3) {
      model = tabs[0].trim()
      customerPartNo = cleanPn(tabs[1])
      productionLevel = tabs[2] || null
      initialStage = tabs[3] || null
      regCertif = tabs[4] || null
      date = tabs[5] || null
    }
    // Customer row: "6991\t78500-DA000-6***\tIN DRAWING\tNO\t26A376"
    if ((!customerCode || customerCode === 'UNKNOWN') && /^\d{4}\s*\t/.test(raw) && tabs.length >= 4) {
      customerCode = tabs[0].trim()
      tgPartNo = cleanPn(tabs[1])
      customerStandards = tabs[2] || null
      tgStandards = tabs[3] || null
      internalEciNo = tabs[4] || null
    }
  }
  return {
    model, customer_part_no: customerPartNo, tg_part_no: tgPartNo,
    production_level: productionLevel, initial_stage: initialStage,
    reg_certif: regCertif, date, customer_code: customerCode,
    customer_standards: customerStandards, tg_standards: tgStandards,
    internal_eci_no: internalEciNo,
  }
}

// BOM row start: optional ">>> ", key (digits/commas/dashes), space, level 1-5, optional tab+customer pn
const ROW_START = /^(>>>\s+)?([0-9][0-9,\-]*)\s+([1-5])(?:\s*\t(.+))?$/

function isSkip(raw) {
  const t = raw.trim()
  return !t
    || /^DESIGN SPECIFICATION/.test(t) || /^INSTRUCTION$/.test(t)
    || t === '（By Part Number）' || /^<<CONFIDENTIAL>>/.test(t)
    || /TOYODA GOSEI/.test(t) || /^R\/C:%=/.test(t) || /^Left margin/.test(t)
    || /^--\s*\d+\s+of/.test(t)
    || /^(Confirmed|Approved|Checked|Prepared|Registed)\s/.test(t)
    || /^\d+-\d+$/.test(t)                   // page numbers like "5-1"
    || /^Key\s+Level/.test(t)
    || /^Model\s*\t/.test(t) || /^[0-9][A-Z0-9]{2}\s*\t/.test(raw)   // repeated model header
    || /^Customer\s*\t/.test(t) || /^\d{4}\s*\t/.test(raw)            // repeated customer header
    || /^(Code|Quantity|Note|SOC|R\/C)$/.test(t)
    || /^(PP-Mold|Mass\s*$|SA\s*$|Use\s*\t|Portion\s*\t)/.test(t)
    || /^Part Name\s*\t/.test(t) || /^Material Standards/.test(t)
    || /^Customer Part No\./.test(t) || /^TG Part No\./.test(t)
}

function parseBomItems(text) {
  const lines = text.split('\n')
  const items = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (isSkip(line) || /^\s*#/.test(line)) { i++; continue }

    const m = line.match(ROW_START)
    if (!m) { i++; continue }

    const key = m[2]
    const level = parseInt(m[3])
    let customerPartNo = m[4] ? cleanPn(m[4]) : null
    i++

    // TG Part No line [tab SOC]
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    let tgPartNo = null, soc = null, rc = false, usePortion = false
    if (i < lines.length) {
      const tgLine = lines[i], tgParts = tgLine.split('\t')
      const cand = tgParts[0].replace(/\s+/g, '').trim()
      if (!/^\d+$/.test(cand)) {
        rc = tgLine.includes('%')
        soc = tgParts.find(p => p.trim() === '*') ? '*' : null
        tgPartNo = cleanPn(tgParts[0]); i++
      }
    }

    // Quantity
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    let quantity = 1
    if (i < lines.length && /^\d+$/.test(lines[i].trim())) {
      quantity = parseInt(lines[i].trim()); i++
    }

    // Level Code + Mass
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    let levelCode = null, massG = null
    if (i < lines.length) {
      const lm = lines[i].match(/^(\d+-\d+)\s*\t\s*([\d.]+)/)
      if (lm) { levelCode = lm[1]; massG = parseFloat(lm[2]); i++ }
    }

    // Part Name + Product Standards + Material Standards
    const nameParts = []
    let productStd = null, materialStd = null

    while (i < lines.length && nameParts.length < 4) {
      const nl = lines[i]
      if (/^\s*#/.test(nl)) {
        usePortion = true; i++
        if (nameParts.length > 0) break  // stop collecting name once # sub-row encountered
        continue
      }
      if (isSkip(nl)) { i++; continue }
      if (ROW_START.test(nl)) break
      const t = nl.trim()
      if (!t) { i++; continue }

      if (nl.includes('\t')) {
        const ti = nl.indexOf('\t')
        const bTab = nl.slice(0, ti).trim(), aTab = nl.slice(ti + 1).trim()
        if (bTab) nameParts.push(bTab)
        const sm = aTab.match(/^(IN DRAWING|NO\b|YES\b|N\/A)/i)
        if (sm) productStd = sm[1]
        i++; break
      }
      if (/^(IN DRAWING|NO|YES|N\/A)$/i.test(t) && nameParts.length > 0) { productStd = t; i++; break }
      const sp = t.match(/^(IN DRAWING|NO|YES|N\/A)(?:\s|$)/i)
      if (sp && nameParts.length > 0) { productStd = sp[1]; i++; break }
      // Part name continuation that ends with a standards keyword
      const ep = t.match(/^(.+?)\s+(IN DRAWING|NO|YES|N\/A)\s*$/)
      if (ep && nameParts.length > 0) { nameParts.push(ep[1]); productStd = ep[2]; i++; break }
      nameParts.push(t); i++
    }
    const partName = nameParts.join('').replace(/\s+/g, ' ').trim() || null

    // Material Standards
    while (i < lines.length && (isSkip(lines[i]) || /^\s*#/.test(lines[i]))) i++
    if (i < lines.length && !ROW_START.test(lines[i])) {
      const mm = lines[i].trim().match(/^(IN DRAWING|NO|YES|N\/A)/i)
      if (mm) { materialStd = mm[1]; i++ }
    }

    // Skip remaining content of this row (notes, material sub-rows)
    while (i < lines.length) {
      if (/^\s*#/.test(lines[i])) { usePortion = true; i++; continue }
      if (isSkip(lines[i])) { i++; continue }
      if (ROW_START.test(lines[i])) break
      i++
    }

    if (tgPartNo || partName) {
      items.push({
        key, level,
        tg_part_no: tgPartNo, customer_part_no: customerPartNo,
        part_name: partName, level_code: levelCode,
        quantity, mass_g: massG,
        soc, rc, use_portion: usePortion,
        product_standards: productStd, material_standards: materialStd,
        note: null, material_no: null, material_trade_name: null,
        color_no: null, color_tone: null, material_type: null, sa: null,
      })
    }
  }
  return items
}

async function extractBomFromPdf(pdfBuffer) {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
  const result = await parser.getText()
  const text = result.text
  const header = parseHeader(text)
  const items = parseBomItems(text)
  if (!header.internal_eci_no && !items.length) {
    throw new Error('ไม่พบข้อมูล BOM ในไฟล์ PDF')
  }
  return { header, items }
}

// ── Suffix-revision helpers ───────────────────────────────────────────────────

/**
 * Returns true when oldPn and newPn differ in exactly one dash-separated segment.
 *   "78500-DA000-0V0A" vs "78500-DA000-0V0B" → true  (last segment)
 *   "GS113-57020-A"    vs "GS113-57020-B"    → true  (last segment)
 *   "GS113-57020-A"    vs "GS114-57020-A"    → true  (first segment — still 1 diff)
 *   "GS113-57020-A"    vs "GS114-58020-B"    → false (2 segments differ)
 */
function isSuffixRevision(oldPn, newPn) {
  if (!oldPn || !newPn || oldPn === newPn) return false
  const a = oldPn.split('-')
  const b = newPn.split('-')
  if (a.length !== b.length) return false
  return a.filter((seg, i) => seg !== b[i]).length === 1
}

/**
 * Finds an existing design_spec that is a "suffix revision" of the new import:
 *   - customer_part_no ตรงกันทุกตัวอักษร
 *   - tg_part_no ต่างกันแค่ 1 segment (เช่น suffix A→B)
 * Returns design_spec_id or null.
 */
async function findExistingBomByPartNo(client, customerPartNo, newTgPartNo) {
  if (!customerPartNo || !newTgPartNo) return null
  const { rows } = await client.query(
    `SELECT design_spec_id, tg_part_no FROM tg.design_spec
     WHERE customer_part_no = $1
     ORDER BY design_spec_id DESC`,
    [customerPartNo]
  )
  for (const row of rows) {
    if (isSuffixRevision(row.tg_part_no, newTgPartNo)) return row.design_spec_id
  }
  return null
}

/**
 * อัปเดต BOM items ของ design_spec ที่มีอยู่แล้ว โดยใช้ revision logic:
 *
 *  - tg_part_no ตรงกันทุกตัว → คง row เดิมไว้ (ไม่แตะ)
 *  - tg_part_no ต่างกัน 1 segment (suffix revision, เช่น A→B)
 *      → mark row เก่า status='revised_out' (แสดงขีดฆ่าบนหน้าจอ)
 *      → INSERT row ใหม่ status='active' ต่อท้าย row เก่าทันที
 *  - part ใหม่ที่ไม่มีในฐานข้อมูลเลย → INSERT status='active'
 *  - part เก่าที่ไม่ปรากฏใน file ใหม่ → mark status='obsolete'
 *
 * ⚠ ต้อง migrate DB ก่อน:
 *   ALTER TABLE tg.bom ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
 *   UPDATE tg.bom SET status='active' WHERE status IS NULL;
 */
async function reconcileBomItems(client, dsId, newItems, partCache) {
  // ดึง active bom rows ทั้งหมดของ design_spec นี้
  const { rows: existing } = await client.query(
    `SELECT b.bom_id, b.child_part_id, b.sort_order, b.variant_id,
            b.parent_part_id, b.bom_level, b.level_code, b.quantity,
            p.tg_part_no
     FROM tg.bom b
     JOIN tg.part p ON p.part_id = b.child_part_id
     WHERE b.design_spec_id = $1 AND (b.status IS NULL OR b.status = 'active')
     ORDER BY b.sort_order`,
    [dsId]
  )

  // index existing rows ด้วย tg_part_no
  const existingByPn = new Map(
    existing.filter(r => r.tg_part_no).map(r => [r.tg_part_no, r])
  )
  const matchedBomIds = new Set()

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i]
    const newPn = item.tg_part_no?.trim() ?? null

    // ── Case 1: tg_part_no ตรงกันทุกตัว → คง row เดิม ──────────
    if (newPn && existingByPn.has(newPn)) {
      matchedBomIds.add(existingByPn.get(newPn).bom_id)
      continue
    }

    // ── Case 2 & 3: หา suffix revision หรือ part ใหม่ ────────────
    let sortOrder = (existing[existing.length - 1]?.sort_order ?? 0) + i + 1
    let variantId = null
    let parentPartId = null
    let bomLevel = Math.max(1, Math.min(5, parseInt(item.level) || 1))
    let levelCode = item.level_code ?? null

    for (const [oldPn, oldRow] of existingByPn.entries()) {
      if (!isSuffixRevision(oldPn, newPn)) continue

      // พบ suffix revision → mark เก่าเป็น revised_out
      await client.query(
        `UPDATE tg.bom SET status = 'revised_out' WHERE bom_id = $1`,
        [oldRow.bom_id]
      )
      matchedBomIds.add(oldRow.bom_id)

      // วาง row ใหม่ต่อจาก row เก่าทันที
      sortOrder    = oldRow.sort_order + 0.5
      variantId    = oldRow.variant_id
      parentPartId = oldRow.parent_part_id
      bomLevel     = oldRow.bom_level
      levelCode    = oldRow.level_code
      existingByPn.delete(oldPn)
      break
    }

    // INSERT part ใหม่ (suffix revision หรือ brand-new)
    const partId = await upsertPart(client, partCache, item, i)
    await client.query(
      `INSERT INTO tg.bom
         (design_spec_id, variant_id, parent_part_id, child_part_id,
          bom_level, level_code, quantity, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
      [dsId, variantId, parentPartId, partId,
       bomLevel, levelCode, item.quantity ?? 1, sortOrder]
    )
  }

  // ── part เก่าที่ไม่ปรากฏใน file ใหม่ → obsolete ───────────────
  for (const [, oldRow] of existingByPn.entries()) {
    if (matchedBomIds.has(oldRow.bom_id)) continue
    await client.query(
      `UPDATE tg.bom SET status = 'obsolete' WHERE bom_id = $1`,
      [oldRow.bom_id]
    )
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

// Parse key string → list of integer keys
// "1" → [1], "2" → [2], "1-2" → [1,2], "1-6" → [1,2,3,4,5,6], "1,3" → [1,3], null → []
function parseKeyInts(keyStr) {
  if (!keyStr) return []
  const s = String(keyStr).trim()
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

async function upsertModel(client, code) {
  const { rows } = await client.query('SELECT model_id FROM tg.model WHERE model_code=$1', [code])
  if (rows.length) return rows[0].model_id
  const r = await client.query(
    'INSERT INTO tg.model (model_code, model_name) VALUES ($1,$1) RETURNING model_id', [code]
  )
  return r.rows[0].model_id
}

async function upsertCustomer(client, code) {
  const { rows } = await client.query('SELECT customer_id FROM tg.customer WHERE customer_code=$1', [code])
  if (rows.length) return rows[0].customer_id
  const r = await client.query(
    'INSERT INTO tg.customer (customer_code, customer_name) VALUES ($1,$1) RETURNING customer_id', [code]
  )
  return r.rows[0].customer_id
}

async function upsertPart(client, cache, item, idx) {
  const tgPn = item.tg_part_no?.trim() || null
  const cacheKey = tgPn ?? `_anon_${idx}`
  if (cache[cacheKey] != null) return cache[cacheKey]

  if (tgPn) {
    const { rows } = await client.query('SELECT part_id FROM tg.part WHERE tg_part_no=$1', [tgPn])
    if (rows.length) { cache[cacheKey] = rows[0].part_id; return rows[0].part_id }
  }

  const insertTgPn = tgPn ?? `ANON-${Date.now()}-${idx}`
  const r = await client.query(
    `INSERT INTO tg.part
       (tg_part_no, customer_part_no, part_name, mass_gram,
        material_no, material_trade_name, jis_standard,
        product_standard, material_standard, notes,
        is_purchased_material, reg_certif_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING part_id`,
    [insertTgPn, item.customer_part_no?.trim() ?? null, item.part_name ?? 'Unknown',
     item.mass_g ?? null, item.material_no ?? null, item.material_trade_name ?? null,
     item.sa ?? null, item.product_standards ?? null, item.material_standards ?? null,
     item.note ?? null, !!item.use_portion, !!item.rc]
  )
  cache[cacheKey] = r.rows[0].part_id
  return r.rows[0].part_id
}

// ── POST /api/import/pdf ──────────────────────────────────────────────────────

router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  try {
    const extracted = await extractBomFromPdf(req.file.buffer)
    const { header, items } = extracted

    if (!header || !items?.length) {
      return res.status(422).json({ error: 'ไม่พบข้อมูล BOM ใน PDF นี้' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const modelId    = await upsertModel(client, header.model ?? 'UNKNOWN')
      const customerId = await upsertCustomer(client, header.customer_code ?? 'UNKNOWN')
      const effDate    = new Date()

      let dsId
      let useRevisionLogic = false

      // ── Step 1: หา design_spec จาก internal_eci_no (exact match) ──
      const { rows: dsExist } = await client.query(
        'SELECT design_spec_id FROM tg.design_spec WHERE internal_eci_no=$1 LIMIT 1',
        [header.internal_eci_no]
      )

      if (dsExist.length) {
        // ECI No. ตรงกัน → full replace (พฤติกรรมเดิม)
        dsId = dsExist[0].design_spec_id
        await client.query(
          `UPDATE tg.design_spec SET
             model_id=$1, customer_id=$2, customer_part_no=$3, tg_part_no=$4,
             production_level=$5, initial_stage=$6, reg_certif=$7,
             effective_date=$8, customer_standard=$9, tg_standard=$10
           WHERE design_spec_id=$11`,
          [modelId, customerId, header.customer_part_no, header.tg_part_no,
           header.production_level, header.initial_stage, header.reg_certif,
           effDate, header.customer_standards, header.tg_standards, dsId]
        )
        await client.query('DELETE FROM tg.bom WHERE design_spec_id=$1', [dsId])
        await client.query('DELETE FROM tg.product_variant WHERE design_spec_id=$1', [dsId])
      } else {
        // ── Step 2: หาจาก customer_part_no + tg_part_no suffix revision ──
        const revisionDsId = await findExistingBomByPartNo(
          client, header.customer_part_no, header.tg_part_no
        )
        if (revisionDsId) {
          dsId = revisionDsId
          useRevisionLogic = true
          await client.query(
            `UPDATE tg.design_spec SET
               tg_part_no=$1, internal_eci_no=$2, effective_date=$3,
               production_level=$4, initial_stage=$5
             WHERE design_spec_id=$6`,
            [header.tg_part_no, header.internal_eci_no, effDate,
             header.production_level, header.initial_stage, dsId]
          )
        }
      }

      if (!dsId) {
        const r = await client.query(
          `INSERT INTO tg.design_spec
             (model_id, customer_id, customer_part_no, tg_part_no, internal_eci_no,
              production_level, initial_stage, reg_certif, effective_date,
              customer_standard, tg_standard)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING design_spec_id`,
          [modelId, customerId, header.customer_part_no, header.tg_part_no,
           header.internal_eci_no, header.production_level, header.initial_stage,
           header.reg_certif, effDate, header.customer_standards, header.tg_standards]
        )
        dsId = r.rows[0].design_spec_id
        await client.query('SAVEPOINT sp_evt')
        try {
          await client.query('UPDATE tg.design_spec SET evt_first_issue=true WHERE design_spec_id=$1', [dsId])
          await client.query('RELEASE SAVEPOINT sp_evt')
        } catch (_) { await client.query('ROLLBACK TO SAVEPOINT sp_evt') }
        await client.query('SAVEPOINT sp_rev')
        try {
          await client.query(
            `INSERT INTO tg.bom_revision
               (design_spec_id, sort_order, mark, revision_record, eci_no, revision_date)
             VALUES ($1,0,'–','First issue',$2,$3)`,
            [dsId, header.internal_eci_no, effDate]
          )
          await client.query('RELEASE SAVEPOINT sp_rev')
        } catch (_) { await client.query('ROLLBACK TO SAVEPOINT sp_rev') }
      }

      const partCache = {}

      // ── suffix revision → ใช้ reconcile logic แทน full insert ──
      if (useRevisionLogic) {
        await reconcileBomItems(client, dsId, items, partCache)
        await client.query('COMMIT')
        res.json({ design_spec_id: dsId, customer_part_no: header.customer_part_no })
        return
      }

      const variantCache = {}       // "k" → variant_id
      const keyLevelStack = {}      // "k" → { level → part_id }

      function getStack(k) {
        if (!keyLevelStack[k]) keyLevelStack[k] = {}
        return keyLevelStack[k]
      }
      function updateStack(k, level, partId) {
        const st = getStack(k)
        st[level] = partId
        for (const lv of Object.keys(st).map(Number)) { if (lv > level) delete st[lv] }
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const level = Math.max(1, Math.min(5, parseInt(item.level) || 1))
        const keyInts = parseKeyInts(item.key)   // e.g. [1], [2], [1,2], [1,2,3,4,5,6]

        const partId = await upsertPart(client, partCache, item, i)

        if (level === 1 && keyInts.length === 1) {
          // Level-1 single-key → create product_variant
          const vKey = keyInts[0]
          const ks = String(vKey)
          const tgPn = item.tg_part_no?.trim() || 'UNKNOWN'
          const vr = await client.query(
            `INSERT INTO tg.product_variant
               (design_spec_id, variant_key, customer_part_no, tg_part_no, part_name, mass_gram)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING variant_id`,
            [dsId, vKey, item.customer_part_no?.trim() ?? null, tgPn,
             item.part_name ?? null, item.mass_g ?? null]
          )
          const variantId = vr.rows[0].variant_id
          variantCache[ks] = variantId

          await client.query(
            `INSERT INTO tg.bom
               (design_spec_id, variant_id, parent_part_id, child_part_id,
                bom_level, level_code, quantity, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [dsId, variantId, null, partId, level, item.level_code ?? null, item.quantity ?? 1, i]
          )
          updateStack(ks, level, partId)

        } else if (keyInts.length > 0) {
          // Level 2-5, or composite key (e.g. "1-2") → insert one bom row per key
          // This mirrors the seed data: shared parts appear as children of each variant
          for (const vKey of keyInts) {
            const ks = String(vKey)
            const variantId = variantCache[ks] ?? null
            const stack = getStack(ks)
            const parentPartId = level > 1 ? (stack[level - 1] ?? null) : null

            await client.query(
              `INSERT INTO tg.bom
                 (design_spec_id, variant_id, parent_part_id, child_part_id,
                  bom_level, level_code, quantity, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [dsId, variantId, parentPartId, partId,
               level, item.level_code ?? null, item.quantity ?? 1, i]
            )
            updateStack(ks, level, partId)
          }

        } else {
          // Null key → single shared row, parent from first available stack
          let parentPartId = null
          if (level > 1) {
            for (const st of Object.values(keyLevelStack)) {
              if (st[level - 1]) { parentPartId = st[level - 1]; break }
            }
          }
          await client.query(
            `INSERT INTO tg.bom
               (design_spec_id, variant_id, parent_part_id, child_part_id,
                bom_level, level_code, quantity, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [dsId, null, parentPartId, partId, level, item.level_code ?? null, item.quantity ?? 1, i]
          )
        }
      }

      await client.query('COMMIT')
      res.json({ design_spec_id: dsId, customer_part_no: header.customer_part_no })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    console.error('Import error:', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
