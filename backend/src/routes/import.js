import express from 'express'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'
import { pool } from '../db.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const EXTRACT_PROMPT = `This is a Toyota Gosei "Design Specification Instruction (By Part Number)" PDF.

=== PDF COLUMN STRUCTURE ===
Each BOM row occupies multiple sub-rows. The columns are:

1. Key column — variant key number(s): "1", "2", "1,3", "1-6", "3-4", etc. Blank for most sub-parts.
2. Level column — BOM level: an integer 1, 2, 3, 4, or 5. Read this directly. Level 1 = top assembly. Level 5 = deepest.
3. Level Code / PP-Mold — code like "1-2", "1-1", "2-2"
4. Quantity — number per parent
5. Mass(g) — mass in grams
6. R/C — marked with % symbol if present

=== CRITICAL: TWO PART NUMBERS PER ROW ===
The part number cell shows TWO lines:
  Line 1 (top): Customer Part No. — e.g. "78500-3DA-J110-M1" or "78501-3DA-T700"
  Line 2 (bottom): TG Part No.    — e.g. "78500-DA000-0V0B" or "GS110-88730-C"

RULES for extracting part numbers:
- If there are TWO part numbers in the cell: line 1 = customer_part_no, line 2 = tg_part_no
- If there is only ONE part number in the cell: that single number IS the tg_part_no (customer_part_no = null)
- NEVER use the Customer Part No. as the tg_part_no field
- The TG Part No. often starts with "GS", "78500", "78560", "38880", "35880", "GK", "GR", "77902", etc.

Extract ALL data and return ONLY valid JSON (no markdown, no explanation) with this exact structure:

{
  "header": {
    "model": "3GJ",
    "customer_part_no": "78500-3DA-J110-M1",
    "tg_part_no": "78500-DA000-****",
    "production_level": "4:MASS PRODUCTION",
    "initial_stage": "C",
    "reg_certif": "None",
    "date": "2026/01/23",
    "customer_code": "6991",
    "customer_standards": "IN DRAWING",
    "tg_standards": "NO",
    "internal_eci_no": "26A256"
  },
  "items": [
    {
      "key": "1",
      "level": 1,
      "tg_part_no": "78500-DA000-0V0B",
      "customer_part_no": "78500-3DA-J110-M1",
      "part_name": "WHEEL ASSY,STEERING(N)",
      "soc": null,
      "rc": false,
      "use_portion": false,
      "quantity": 1,
      "level_code": "1-2",
      "mass_g": 1727,
      "material_no": null,
      "material_trade_name": null,
      "color_no": null,
      "color_tone": null,
      "material_type": null,
      "sa": null,
      "product_standards": "IN DRAWING",
      "material_standards": "NO",
      "note": null
    },
    {
      "key": "1,3",
      "level": 2,
      "tg_part_no": "GS110-88730-C",
      "customer_part_no": "78501-3DA-T700",
      "part_name": "GRIP COMP (HE)",
      "quantity": 1,
      "level_code": "1-2",
      "mass_g": 1208,
      "rc": false, "use_portion": false, "soc": null,
      "material_no": null, "material_trade_name": null, "color_no": null,
      "color_tone": null, "material_type": null, "sa": null,
      "product_standards": "NO", "material_standards": "NO", "note": null
    },
    {
      "key": null,
      "level": 3,
      "tg_part_no": "GS110-88710-C",
      "customer_part_no": null,
      "part_name": "GRIP (HE)",
      "quantity": 1,
      "level_code": "1-2",
      "mass_g": 1202,
      "rc": false, "use_portion": true, "soc": null,
      "material_no": null, "material_trade_name": null, "color_no": null,
      "color_tone": null, "material_type": null, "sa": null,
      "product_standards": "NO", "material_standards": "NO", "note": null
    },
    {
      "key": null,
      "level": 4,
      "tg_part_no": "GS111-21760-A",
      "customer_part_no": null,
      "part_name": "GRIP (HE) PU FORM",
      "quantity": 1,
      "level_code": "1-1",
      "mass_g": 977,
      "rc": false, "use_portion": false, "soc": null,
      "material_no": null, "material_trade_name": null, "color_no": null,
      "color_tone": null, "material_type": null, "sa": null,
      "product_standards": "IN DRAWING", "material_standards": "IN DRAWING", "note": null
    },
    {
      "key": null,
      "level": 5,
      "tg_part_no": "GS120-10170-B",
      "customer_part_no": null,
      "part_name": "HUB CORE",
      "quantity": 1,
      "level_code": "1-1",
      "mass_g": 677,
      "rc": false, "use_portion": false, "soc": null,
      "material_no": null, "material_trade_name": null, "color_no": null,
      "color_tone": null, "material_type": null, "sa": null,
      "product_standards": "IN DRAWING", "material_standards": "IN DRAWING", "note": null
    }
  ]
}

Field rules:
- "key": exact Key column value ("1","2","1,3","1-6","3-4", etc.). null if blank
- "level": read directly from the Level column (1-5). NEVER guess.
- "level_code": PP-Mold code like "1-2", "2-2". null if blank
- "quantity": numeric value. null if blank
- "mass_g": numeric grams. null if blank
- "rc": true if % marker present, else false
- "use_portion": true if # marker present, else false
- "soc": SOC code text or null
- Strip ALL spaces from part numbers
- Include EVERY item from EVERY page — do NOT skip level 3, 4, or 5 items
- Only include rows that are actual assembly parts (have a TG Part No. OR a Part Name that identifies a part)
- Do NOT include raw material detail sub-rows (lines showing only material/color/thread specs without a part identity)
- List items in document order (top to bottom, page by page)
`

async function extractBomFromPdf(pdfBuffer) {
  const base64 = pdfBuffer.toString('base64')

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    }],
  })

  const text = response.content[0].text.trim()
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\})/)
    if (m) return JSON.parse(m[1] || m[0])
    throw new Error('Claude returned non-JSON: ' + text.slice(0, 300))
  }
}

// Single key (e.g. "1", "2") → use as-is; composite/range ("1,3", "1-6") → null (shared)
function keyToVariantKey(keyStr) {
  if (!keyStr) return null
  const str = String(keyStr).trim()
  const single = str.match(/^(\d+)$/)
  if (single) return parseInt(single[1])
  return null
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

// POST /api/import/pdf
router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  try {
    // AI extraction
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
      const effDate    = new Date()  // use today's date

      // Upsert design_spec
      let dsId
      const { rows: dsExist } = await client.query(
        'SELECT design_spec_id FROM tg.design_spec WHERE internal_eci_no=$1 LIMIT 1',
        [header.internal_eci_no]
      )
      if (dsExist.length) {
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
          await client.query(
            'UPDATE tg.design_spec SET evt_first_issue=true WHERE design_spec_id=$1', [dsId]
          )
          await client.query('RELEASE SAVEPOINT sp_evt')
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_evt')
        }
        await client.query('SAVEPOINT sp_rev')
        try {
          await client.query(
            `INSERT INTO tg.bom_revision
               (design_spec_id, sort_order, mark, revision_record, eci_no, revision_date)
             VALUES ($1,0,'–','First issue',$2,$3)`,
            [dsId, header.internal_eci_no, effDate]
          )
          await client.query('RELEASE SAVEPOINT sp_rev')
        } catch (_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_rev')
        }
      }

      // Insert BOM items
      // Level 1 items → product_variant (one per key) + part + bom
      // Level 2-5 items → part + bom referencing the correct variant_id
      const partCache = {}
      const variantCache = {}  // vKey → variant_id
      const levelStack = {}    // level → part_id of current item at that level

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const level = Math.max(1, Math.min(5, parseInt(item.level) || 1))
        const vKey = keyToVariantKey(item.key)

        let variantId = null

        if (level === 1 && vKey != null) {
          // Level 1 with an explicit single-integer key → create product_variant
          const tgPn = item.tg_part_no?.trim() || 'UNKNOWN'
          const vr = await client.query(
            `INSERT INTO tg.product_variant
               (design_spec_id, variant_key, customer_part_no, tg_part_no, part_name, mass_gram)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING variant_id`,
            [dsId, vKey, item.customer_part_no?.trim() ?? null, tgPn,
             item.part_name ?? null, item.mass_g ?? null]
          )
          variantId = vr.rows[0].variant_id
          variantCache[vKey] = variantId
        } else {
          // Level 2-5, or level 1 with composite/blank key (shared) → look up variant from cache
          variantId = vKey != null ? (variantCache[vKey] ?? null) : null
        }

        const partId = await upsertPart(client, partCache, item, i)
        const parentPartId = level > 1 ? (levelStack[level - 1] ?? null) : null

        await client.query(
          `INSERT INTO tg.bom
             (design_spec_id, variant_id, parent_part_id, child_part_id,
              bom_level, level_code, quantity, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [dsId, variantId, parentPartId, partId,
           level, item.level_code ?? null, item.quantity ?? 1, i]
        )

        levelStack[level] = partId
        for (const lv of Object.keys(levelStack).map(Number)) {
          if (lv > level) delete levelStack[lv]
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
