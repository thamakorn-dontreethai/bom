import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { pool } from '../db.js'

const router = express.Router()

function deleteImageFile(imageUrl) {
  if (!imageUrl) return
  try {
    const filePath = path.join(__dirname, '../../', imageUrl)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch { /* ignore missing files */ }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads/parts'),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
})

const HEADER_SELECT = `
  SELECT
    ds.design_spec_id                             AS id,
    m.model_code                                  AS model,
    m.model_name,
    ds.customer_part_no,
    ds.production_level,
    ds.initial_stage                              AS control_rank,
    ds.reg_certif,
    to_char(ds.effective_date, 'DD-Mon-YY')       AS date,
    c.customer_code                               AS customer,
    COALESCE(ds.customer_name_override, c.customer_name) AS customer_name,
    ds.tg_part_no,
    ds.customer_standard                          AS customer_standards,
    ds.tg_standard                                AS tg_standards,
    ds.internal_eci_no,
    COALESCE(bd.type, 'HE')                       AS type,
    ds.prepared_by,
    ds.checked_by,
    ds.approved_by,
    ds.confirmed_by,
    ds.pdf_url,
    'WHEEL ASSY, STEERING (N)'                    AS part_name,
    COALESCE(ds.evt_first_issue, FALSE)           AS evt_first_issue,
    COALESCE(ds.evt_cv, FALSE)                    AS evt_cv,
    COALESCE(ds.evt_mq, FALSE)                    AS evt_mq,
    COALESCE(ds.evt_dan, FALSE)                   AS evt_dan,
    COALESCE(ds.evt_hin, FALSE)                   AS evt_hin,
    COALESCE(ds.evt_sop, FALSE)                   AS evt_sop,
    COALESCE(ds.concern_drawing, FALSE)           AS concern_drawing,
    COALESCE(ds.concern_actual_part, FALSE)       AS concern_actual_part
  FROM tg.design_spec ds
  JOIN tg.model    m ON m.model_id    = ds.model_id
  JOIN tg.customer c ON c.customer_id = ds.customer_id
  LEFT JOIN LATERAL (
    SELECT type FROM tg.bom_document bd2
    WHERE bd2.design_spec_id = ds.design_spec_id
    ORDER BY bd2.bom_doc_id LIMIT 1
  ) bd ON TRUE
`

const ITEMS_SQL = `
  WITH it AS (
    SELECT b.bom_id, b.variant_id, b.parent_part_id, b.child_part_id,
           b.bom_level, b.level_code, b.quantity, b.sort_order, b.notes AS bom_notes,
           b.update_level, b.status,
           b.price_per_pc, b.supplier, b.lead_time_day, b.completion_remark,
           b.snapshot_part_name, b.snapshot_mass_gram, b.snapshot_image_url
    FROM tg.bom b
    WHERE b.design_spec_id = $1
      AND (b.status IS NULL OR b.status <> 'obsolete')
  )
  SELECT
    it.bom_id                                                  AS id,
    par.bom_id                                                 AS parent_id,
    pv.variant_key::TEXT                                       AS key_code,
    it.bom_level                                               AS level,
    it.level_code,
    it.level_code                                              AS pp_mold,
    it.quantity,
    p.tg_part_no,
    p.customer_part_no,
    p.soc_flag                                                 AS soc,
    COALESCE(it.snapshot_mass_gram, p.mass_gram)               AS mass_g,
    COALESCE(it.snapshot_part_name, p.part_name)               AS part_name,
    p.product_standard                                         AS product_standards,
    p.material_standard                                        AS material_standards,
    CASE WHEN p.is_purchased_material THEN '#' ELSE NULL END   AS use_portion,
    CASE WHEN p.reg_certif_required   THEN '%' ELSE NULL END   AS rc,
    p.material_no,
    NULL::text                                                 AS instruction_no,
    p.material_trade_name,
    mt.type_code                                               AS material_type,
    co.color_code                                              AS color_no,
    co.color_tone,
    p.jis_standard                                             AS sa,
    COALESCE(it.bom_notes, p.notes)                           AS note,
    it.sort_order,
    it.update_level,
    it.status,
    it.snapshot_image_url                                        AS image_url,
    it.price_per_pc,
    it.supplier          AS completion_supplier,
    it.lead_time_day,
    it.completion_remark
  FROM it
  JOIN tg.part p ON it.child_part_id = p.part_id
  LEFT JOIN LATERAL (
    SELECT pi.bom_id
    FROM it pi
    WHERE pi.child_part_id = it.parent_part_id
      AND (pi.variant_id = it.variant_id
           OR pi.variant_id IS NULL
           OR it.variant_id IS NULL)
    ORDER BY pi.bom_id
    LIMIT 1
  ) par ON TRUE
  LEFT JOIN tg.material_type   mt ON mt.material_type_id = p.material_type_id
  LEFT JOIN tg.color           co ON co.color_id         = p.color_id
  LEFT JOIN tg.product_variant pv ON pv.variant_id       = it.variant_id
  ORDER BY it.sort_order NULLS LAST, it.bom_id
`

// PATCH /api/bom/:id/header  — save editable header fields
router.patch('/:id/header', async (req, res) => {
  const b   = req.body
  const dsId = parseInt(req.params.id)
  try {
    await pool.query(
      `UPDATE tg.design_spec
       SET prepared_by = $1, approved_by = $2, customer_name_override = $3
       WHERE design_spec_id = $4`,
      [b.revisioner ?? null, b.approved_by ?? null, b.customer_name ?? null, dsId]
    )
    // evt_* and concern_* columns added by migration_001 — skip if not yet migrated
    try {
      await pool.query(
        `UPDATE tg.design_spec
         SET evt_first_issue   = $1,
             evt_cv            = $2,
             evt_mq            = $3,
             evt_dan           = $4,
             evt_hin           = $5,
             evt_sop           = $6,
             concern_drawing      = $7,
             concern_actual_part  = $8
         WHERE design_spec_id = $9`,
        [!!b.evt_first_issue, !!b.evt_cv, !!b.evt_mq,
         !!b.evt_dan, !!b.evt_hin, !!b.evt_sop,
         !!b.concern_drawing, !!b.concern_actual_part,
         dsId]
      )
    } catch (_) { /* migration_001 not yet applied — silently skip */ }

    // update revisioner/approved_by for non-first revision rows
    if (Array.isArray(b.rev_names) && b.rev_names.length) {
      for (const u of b.rev_names) {
        await pool.query(
          `UPDATE tg.bom_revision SET revisioner=$1, approved_by=$2
           WHERE design_spec_id=$3 AND mark=$4`,
          [u.revisioner ?? null, u.approved_by ?? null, dsId, u.mark]
        )
      }
    }

    res.json({ saved: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bom
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(HEADER_SELECT + ' ORDER BY ds.design_spec_id')
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bom/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: h } = await pool.query(
      HEADER_SELECT + ' WHERE ds.design_spec_id = $1', [req.params.id]
    )
    if (!h.length) return res.status(404).json({ error: 'BOM not found' })

    const { rows: items } = await pool.query(ITEMS_SQL, [req.params.id])

    // bom_revision rows (migration_001+)
    let revisions = []
    try {
      const { rows } = await pool.query(
        `SELECT mark, revision_record, eci_no,
                to_char(revision_date, 'DD-Mon-YY') AS revision_date,
                revisioner, approved_by
         FROM tg.bom_revision
         WHERE design_spec_id = $1
         ORDER BY sort_order, revision_id`,
        [req.params.id]
      )
      revisions = rows
    } catch (_) {}

    // Per-item update history (migration_002 — skip if not yet applied)
    let itemHistory = {}
    let itemUpdateLevels = {}
    try {
      const [histRes, levRes] = await Promise.all([
        pool.query(
          `SELECT bih.bom_id, bih.introduced_at, bih.superseded_at, bih.old_tg_part_no
           FROM tg.bom_item_history bih
           JOIN tg.bom b ON b.bom_id = bih.bom_id
           WHERE b.design_spec_id = $1
           ORDER BY bih.bom_id, bih.superseded_at`,
          [req.params.id]
        ),
        pool.query(
          'SELECT bom_id, update_level FROM tg.bom WHERE design_spec_id = $1',
          [req.params.id]
        ),
      ])
      histRes.rows.forEach(r => {
        if (!itemHistory[r.bom_id]) itemHistory[r.bom_id] = []
        itemHistory[r.bom_id].push(r)
      })
      levRes.rows.forEach(r => { itemUpdateLevels[r.bom_id] = r.update_level })
    } catch (_) {}

      // TGT Part No. history (migration_002)
      let tgtHistory = []
      let tgtUpdateLevel = 0
      try {
        const [tgtHRes, tgtLRes] = await Promise.all([
          pool.query(
            `SELECT introduced_at, superseded_at, old_tg_part_no
             FROM tg.design_spec_tgt_history
             WHERE design_spec_id = $1
             ORDER BY superseded_at`,
            [req.params.id]
          ),
          pool.query(
            'SELECT tgt_update_level FROM tg.design_spec WHERE design_spec_id = $1',
            [req.params.id]
          ),
        ])
        tgtHistory = tgtHRes.rows
        tgtUpdateLevel = tgtLRes.rows[0]?.tgt_update_level ?? 0
      } catch (_) {}

    const enrichedItems = items.map(item => ({
      ...item,
      update_level: itemUpdateLevels[item.id] ?? 0,
      history: itemHistory[item.id] ?? [],
    }))

    res.json({
      ...h[0],
      tgt_history: tgtHistory,
      tgt_update_level: tgtUpdateLevel,
      revisions,
      items: enrichedItems,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/bom/:id/revision
// Record a BOM update: save old part nos to history, update to new, add bom_revision row.
// Items with new_part_no → full revision flow (revised_out + new row).
// Items without new_part_no but with other changed fields → direct UPDATE, no revision mark.
router.post('/:id/revision', async (req, res) => {
  const dsId = parseInt(req.params.id)
  const { eci_no, revision_date, revisioner, approved_by, items = [], new_tg_part_no } = req.body

  let pnChangeItems    = items.filter(i => i.new_part_no?.trim())
  const metaOnlyItems  = items.filter(i => !i.new_part_no?.trim() &&
    (i.new_part_name?.trim() || i.new_note?.trim() || i.new_quantity?.trim() || i.new_mass?.trim()))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── Metadata-only items: direct UPDATE to part + bom, no revision mark ──
    for (const { bom_id, new_part_name, new_note, new_quantity, new_mass } of metaOnlyItems) {
      const { rows: cur } = await client.query(
        `SELECT b.notes AS bom_notes, b.quantity, b.child_part_id
         FROM tg.bom b WHERE b.bom_id=$1 AND b.design_spec_id=$2`,
        [bom_id, dsId]
      )
      if (!cur.length) continue
      const c = cur[0]

      // Extract existing sub-values from bom.notes
      const existBom   = c.bom_notes ?? ''
      const existQtyT  = existBom.match(/Q'ty:\s*([^|]+)/)?.[1]?.trim()   ?? null
      const existMassT = existBom.match(/Weight:\s*([^|]+)/)?.[1]?.trim() ?? null
      const existSpec  = existBom
        .replace(/Q'ty:\s*[^|]+\|?\s*/g, '')
        .replace(/Weight:\s*[^|]+\|?\s*/g, '')
        .trim().replace(/\|\s*$/, '').trim() || null

      // New value if provided, else keep existing
      const finalSpec  = new_note?.trim()     || existSpec
      const finalQtyT  = new_quantity?.trim() || existQtyT
      const finalMassT = new_mass?.trim()     || existMassT

      const qtyNum  = finalQtyT  ? Number(finalQtyT)  : null
      const massNum = finalMassT ? Number(finalMassT) : null
      const qtyVal  = qtyNum  !== null && !isNaN(qtyNum)  ? qtyNum  : null
      const massVal = massNum !== null && !isNaN(massNum) ? massNum : null

      const bomNoteParts = [
        finalSpec || null,
        qtyVal  === null && finalQtyT  ? `Q'ty: ${finalQtyT}`    : null,
        massVal === null && finalMassT ? `Weight: ${finalMassT}` : null,
      ].filter(Boolean)
      const newBomNotes = bomNoteParts.length ? bomNoteParts.join(' | ') : null

      // Update only tg.bom for this specific row — never touch tg.part (shared across rows)
      const finalBomNotes = newBomNotes ?? c.bom_notes ?? null
      const newSnapName = new_part_name?.trim() || null
      const newSnapMass = massVal !== null ? massVal : null
      await client.query(
        `UPDATE tg.bom
           SET quantity           = $1,
               notes              = $2,
               snapshot_part_name = COALESCE($3, snapshot_part_name),
               snapshot_mass_gram = COALESCE($4, snapshot_mass_gram)
         WHERE bom_id = $5`,
        [qtyVal !== null ? qtyVal : c.quantity, finalBomNotes, newSnapName, newSnapMass, bom_id]
      )
    }

    // When TGT Part No. changes, auto-include the active Level 1 BOM item so it gets
    // revised_out and a new row with the new TGT part no. is inserted automatically.
    if (new_tg_part_no?.trim()) {
      const { rows: lv1Rows } = await client.query(
        `SELECT bom_id FROM tg.bom
         WHERE design_spec_id = $1 AND bom_level = 1 AND (status IS NULL OR status = 'active')
         ORDER BY sort_order LIMIT 1`,
        [dsId]
      )
      if (lv1Rows.length && !pnChangeItems.some(i => i.bom_id === lv1Rows[0].bom_id)) {
        pnChangeItems = [
          ...pnChangeItems,
          { bom_id: lv1Rows[0].bom_id, new_part_no: new_tg_part_no.trim(),
            new_part_name: null, new_note: null, new_quantity: null, new_mass: null }
        ]
      }
    }

    // ── Determine revision level (needed only when there are Part No. changes or TGT change) ──
    let newLevel = null
    if (pnChangeItems.length > 0 || new_tg_part_no?.trim()) {
      const { rows: lvRows } = await client.query(
        `SELECT COALESCE(
           MAX(CASE WHEN mark ~ '^[0-9]+$' THEN mark::smallint ELSE 0 END), 0
         ) AS max_level
         FROM tg.bom_revision WHERE design_spec_id = $1`,
        [dsId]
      )
      const maxLevel = lvRows[0].max_level ?? 0
      newLevel = maxLevel === 0 ? 2 : maxLevel + 1
    }

    // ── Part No. change items: full revision flow ──
    for (const { bom_id, new_part_no, new_part_name, new_note, new_quantity, new_mass } of pnChangeItems) {
      if (!new_part_no?.trim()) continue

      const { rows: cur } = await client.query(
        `SELECT b.update_level, b.sort_order, b.variant_id, b.parent_part_id,
                b.bom_level, b.level_code, b.quantity, b.notes AS bom_notes,
                p.tg_part_no, p.customer_part_no, p.part_id,
                COALESCE(b.snapshot_part_name, p.part_name) AS part_name,
                COALESCE(b.snapshot_mass_gram, p.mass_gram) AS mass_gram,
                COALESCE(b.snapshot_image_url, p.image_url) AS display_image_url,
                p.product_standard, p.material_standard,
                p.is_purchased_material, p.reg_certif_required, p.notes
         FROM tg.bom b JOIN tg.part p ON p.part_id = b.child_part_id
         WHERE b.bom_id = $1 AND b.design_spec_id = $2`,
        [bom_id, dsId]
      )
      if (!cur.length) continue
      const c = cur[0]

      await client.query(
        `INSERT INTO tg.bom_item_history
           (bom_id, introduced_at, superseded_at, old_tg_part_no, old_customer_part_no)
         VALUES ($1, $2, $3, $4, $5)`,
        [bom_id, c.update_level, newLevel, c.tg_part_no, c.customer_part_no]
      )

      const partUpdateLevel = (parseInt(c.update_level) || 0) + 1
      await client.query(
        `UPDATE tg.bom SET status='revised_out', update_level=$1,
           snapshot_part_name=$2, snapshot_mass_gram=$3, snapshot_image_url=$4
         WHERE bom_id=$5`,
        [partUpdateLevel, c.part_name, c.mass_gram, c.display_image_url ?? null, bom_id]
      )

      // Extract old Q'ty/Weight/Spec from old bom.notes as fallbacks
      const oldBomNotes = c.bom_notes ?? ''
      const oldQtyT  = oldBomNotes.match(/Q'ty:\s*([^|]+)/)?.[1]?.trim()   ?? null
      const oldMassT = oldBomNotes.match(/Weight:\s*([^|]+)/)?.[1]?.trim() ?? null
      const oldSpec  = oldBomNotes
        .replace(/Q'ty:\s*[^|]+\|?\s*/g, '')
        .replace(/Weight:\s*[^|]+\|?\s*/g, '')
        .trim().replace(/\|\s*$/, '').trim() || null

      // New value if provided, else inherit from old row
      const finalSpec  = new_note?.trim()     || oldSpec
      const finalQtyT  = new_quantity?.trim() || oldQtyT
      const finalMassT = new_mass?.trim()     || oldMassT

      const qtyNum  = finalQtyT  ? Number(finalQtyT)  : null
      const massNum = finalMassT ? Number(finalMassT) : null
      const newQtyVal  = qtyNum  !== null && !isNaN(qtyNum)  ? qtyNum  : null
      const newMassVal = massNum !== null && !isNaN(massNum) ? massNum : null

      // bom.notes for new row (Material Spec + Q'ty/Weight text)
      const newPartNotes = finalSpec || null
      const bomNoteParts = [
        finalSpec || null,
        newQtyVal  === null && finalQtyT  ? `Q'ty: ${finalQtyT}`    : null,
        newMassVal === null && finalMassT ? `Weight: ${finalMassT}` : null,
      ].filter(Boolean)
      const newBomNotes = bomNoteParts.length ? bomNoteParts.join(' | ') : null

      const newPn = new_part_no.trim()
      let newPartId
      const { rows: existPart } = await client.query(
        'SELECT part_id FROM tg.part WHERE tg_part_no=$1', [newPn]
      )
      if (existPart.length) {
        newPartId = existPart[0].part_id
        // Never update tg.part — it is shared. User-supplied values go into snapshot
        // columns on the new BOM row only.
      } else {
        const r = await client.query(
          `INSERT INTO tg.part
             (tg_part_no, customer_part_no, part_name, mass_gram,
              product_standard, material_standard, notes,
              is_purchased_material, reg_certif_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING part_id`,
          [newPn, c.customer_part_no,
           new_part_name?.trim() || c.part_name,
           newMassVal !== null ? newMassVal : c.mass_gram,
           c.product_standard, c.material_standard,
           newPartNotes !== null ? newPartNotes : c.notes,
           c.is_purchased_material, c.reg_certif_required]
        )
        newPartId = r.rows[0].part_id
      }

      await client.query(
        `UPDATE tg.bom SET sort_order = sort_order + 1
         WHERE design_spec_id = $1 AND sort_order > $2`,
        [dsId, c.sort_order]
      )

      // Lock tg.part values as snapshots for the new revision row
      const { rows: newPRow } = await client.query(
        'SELECT part_name, mass_gram, image_url FROM tg.part WHERE part_id = $1', [newPartId]
      )
      const newPCur      = newPRow[0] ?? {}
      const revSnapName  = new_part_name?.trim() || newPCur.part_name  || null
      const revSnapMass  = newMassVal !== null    ? newMassVal          : (newPCur.mass_gram ?? null)
      const revSnapImage = null

      await client.query(
        `INSERT INTO tg.bom
           (design_spec_id, variant_id, parent_part_id, child_part_id,
            bom_level, level_code, quantity, sort_order, status, update_level, notes,
            snapshot_part_name, snapshot_mass_gram, snapshot_image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13)`,
        [dsId, c.variant_id, c.parent_part_id, newPartId,
         c.bom_level, c.level_code,
         newQtyVal !== null ? newQtyVal : c.quantity,
         parseInt(c.sort_order) + 1,
         partUpdateLevel,
         newBomNotes,
         revSnapName, revSnapMass, revSnapImage]
      )
    }

    // ── TGT Part No. change ──
    if (new_tg_part_no?.trim()) {
      const { rows: dsRows } = await client.query(
        'SELECT tg_part_no, tgt_update_level FROM tg.design_spec WHERE design_spec_id = $1',
        [dsId]
      )
      if (dsRows.length && dsRows[0].tg_part_no !== new_tg_part_no.trim()) {
        let oldTgPartNo = dsRows[0].tg_part_no
        await client.query(
          `INSERT INTO tg.design_spec_tgt_history
             (design_spec_id, introduced_at, superseded_at, old_tg_part_no)
           VALUES ($1, $2, $3, $4)`,
          [dsId, dsRows[0].tgt_update_level ?? 0, newLevel, oldTgPartNo]
        )
        await client.query(
          'UPDATE tg.design_spec SET tg_part_no = $1, tgt_update_level = $2 WHERE design_spec_id = $3',
          [new_tg_part_no.trim(), newLevel, dsId]
        )
      }
    }

    // ── Revision record (only when Part No. or TGT changed) ──
    if (newLevel !== null) {
      await client.query(
        `INSERT INTO tg.bom_revision
           (design_spec_id, sort_order, mark, revision_record, eci_no, revision_date, revisioner, approved_by)
         VALUES ($1, $2, $3, 'Update ECI No.', $4, $5, $6, $7)`,
        [dsId, newLevel, String(newLevel),
         eci_no ?? null,
         revision_date ? new Date(revision_date) : null,
         revisioner ?? null,
         approved_by ?? null]
      )
    }

    await client.query('COMMIT')
    res.json({ update_level: newLevel })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// POST /api/bom/:id/items
router.post('/:id/items', async (req, res) => {
  const dsId = parseInt(req.params.id)
  const b = req.body
  if (!b.part_name) return res.status(400).json({ error: 'part_name required' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let partId
    if (b.tg_part_no) {
      const { rows: ex } = await client.query(
        'SELECT part_id FROM tg.part WHERE tg_part_no = $1', [b.tg_part_no]
      )
      if (ex.length) {
        partId = ex[0].part_id
      } else {
        const { rows } = await client.query(
          `INSERT INTO tg.part (tg_part_no, customer_part_no, part_name, mass_gram,
             material_no, instruction_no, material_trade_name, jis_standard, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING part_id`,
          [b.tg_part_no, b.customer_part_no ?? null, b.part_name, b.mass_g ?? null,
           b.material_no ?? null, b.instruction_no ?? null, b.material_trade_name ?? null,
           b.sa ?? null, b.note ?? null]
        )
        partId = rows[0].part_id
      }
    } else {
      const { rows } = await client.query(
        'INSERT INTO tg.part (part_name, mass_gram, notes) VALUES ($1,$2,$3) RETURNING part_id',
        [b.part_name, b.mass_g ?? null, b.note ?? null]
      )
      partId = rows[0].part_id
    }

    const { rows: bomRow } = await client.query(
      `INSERT INTO tg.bom
         (design_spec_id, variant_id, parent_part_id, child_part_id,
          bom_level, level_code, quantity, sort_order, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING bom_id`,
      [dsId, b.variant_id ?? null, b.parent_part_id ?? null, partId,
       b.level ?? 1, b.level_code ?? null, b.quantity ?? 1,
       b.sort_order ?? 0, b.note ?? null]
    )

    await client.query('COMMIT')
    res.status(201).json({ bom_id: bomRow[0].bom_id, part_id: partId })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// POST /api/bom/:id/items/insert-after  (multipart: after_bom_id, part_name, tg_part_no, notes, quantity, mass_gram + optional image)
router.post('/:id/items/insert-after', upload.single('image'), async (req, res) => {
  const dsId = parseInt(req.params.id)
  const { after_bom_id, part_name, tg_part_no, notes, quantity, mass_gram } = req.body
  if (!part_name) return res.status(400).json({ error: 'part_name required' })

  // Accept free-form text; store non-numeric values in notes rather than crashing
  const qtyNum = Number(quantity?.trim())
  const massNum = Number(mass_gram?.trim())
  const qtyVal = quantity?.trim() && !isNaN(qtyNum) ? qtyNum : null
  const massVal = mass_gram?.trim() && !isNaN(massNum) ? massNum : null
  const extraParts = [
    notes || null,
    qtyVal === null && quantity?.trim() ? `Q'ty: ${quantity.trim()}` : null,
    massVal === null && mass_gram?.trim() ? `Weight: ${mass_gram.trim()}` : null,
  ].filter(Boolean)
  const combinedNotes = extraParts.length ? extraParts.join(' | ') : null

  const imageUrl = req.file ? `/uploads/parts/${req.file.filename}` : null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Get the selected item
    const { rows: selRows } = await client.query(
      `SELECT bom_id, bom_level, sort_order, child_part_id, parent_part_id, variant_id
       FROM tg.bom WHERE bom_id = $1 AND design_spec_id = $2`,
      [after_bom_id, dsId]
    )
    if (!selRows.length) throw new Error('Reference item not found')
    const sel = selRows[0]

    // Level: go one deeper, max 5. At level 5 → sibling (same level, same parent)
    const newLevel = Math.min(sel.bom_level + 1, 5)
    const newParentPartId = newLevel === sel.bom_level + 1
      ? sel.child_part_id      // child of selected
      : sel.parent_part_id     // sibling (level 5 case)

    const newSortOrder = parseInt(sel.sort_order) + 1

    // Shift all items that come after to make room
    await client.query(
      `UPDATE tg.bom SET sort_order = sort_order + 1
       WHERE design_spec_id = $1 AND sort_order >= $2`,
      [dsId, newSortOrder]
    )

    // Insert part — store only Material Spec in part.notes (no Q'ty/Weight text)
    // Q'ty/Weight text goes into bom.notes so COALESCE(bom_notes, p.notes) picks it up correctly
    const partNotes = notes?.trim() || null

    let partId
    // When existing Part No. is reused, store user-entered values as row-level
    // overrides (snapshot columns) so this BOM row shows correct values via
    // COALESCE(snapshot, tg.part) without touching the shared tg.part record.
    let rowSnapName  = null
    let rowSnapMass  = null
    let rowSnapImage = imageUrl  // only the explicitly uploaded image; null if none

    if (tg_part_no) {
      const { rows: ex } = await client.query(
        'SELECT part_id FROM tg.part WHERE tg_part_no = $1', [tg_part_no]
      )
      if (ex.length) {
        partId = ex[0].part_id
        rowSnapName  = part_name?.trim() || null
        rowSnapMass  = massVal !== null ? massVal : null
      } else {
        const { rows } = await client.query(
          `INSERT INTO tg.part (tg_part_no, part_name, mass_gram, notes, image_url)
           VALUES ($1,$2,$3,$4,$5) RETURNING part_id`,
          [tg_part_no, part_name, massVal, partNotes, imageUrl]
        )
        partId = rows[0].part_id
      }
    } else {
      const { rows } = await client.query(
        `INSERT INTO tg.part (part_name, mass_gram, notes, image_url)
         VALUES ($1,$2,$3,$4) RETURNING part_id`,
        [part_name, massVal, partNotes, imageUrl]
      )
      partId = rows[0].part_id
    }

    // Insert BOM row — store combinedNotes (Material Spec + Q'ty text + Weight text) in bom.notes.
    // snapshot_part_name / snapshot_mass_gram are only set when reusing an existing part so that
    // COALESCE(snapshot, tg.part) returns the user's values for this row without affecting others.
    const { rows: bomRow } = await client.query(
      `INSERT INTO tg.bom
         (design_spec_id, variant_id, parent_part_id, child_part_id,
          bom_level, quantity, sort_order, status, notes,
          snapshot_part_name, snapshot_mass_gram, snapshot_image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11) RETURNING bom_id`,
      [dsId, sel.variant_id, newParentPartId, partId, newLevel, qtyVal ?? 1, newSortOrder, combinedNotes,
       rowSnapName, rowSnapMass, rowSnapImage]
    )

    // Record history snapshot when a new part is added with an image
    if (rowSnapImage) {
      await client.query(
        `INSERT INTO tg.bom_image_history
           (bom_id, image_url, event_type, tg_part_no, part_name, quantity, mass_gram, spec)
         VALUES ($1,$2,'added',$3,$4,$5,$6,$7)`,
        [bomRow[0].bom_id, rowSnapImage,
         tg_part_no || null, part_name || null,
         qtyVal ?? null, massVal ?? null,
         notes || null]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ bom_id: bomRow[0].bom_id, part_id: partId })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// PUT /api/bom/:id/items/:itemId
router.put('/:id/items/:itemId', upload.single('image'), async (req, res) => {
  const b = req.body
  const imageUrl = req.file ? `/uploads/parts/${req.file.filename}` : null
  try {
    const { rows: bom } = await pool.query(
      'SELECT bom_id FROM tg.bom WHERE bom_id=$1 AND design_spec_id=$2',
      [req.params.itemId, req.params.id]
    )
    if (!bom.length) return res.status(404).json({ error: 'Item not found' })

    const newSnapName = b.part_name?.trim() || null
    const massNum     = b.mass_g != null ? Number(b.mass_g) : null
    const newSnapMass = massNum !== null && !isNaN(massNum) ? massNum : null

    // If a new image is being uploaded, archive the current state first
    if (imageUrl) {
      const { rows: cur } = await pool.query(
        `SELECT b.snapshot_image_url,
                COALESCE(b.snapshot_part_name, p.part_name) AS part_name,
                p.tg_part_no, b.quantity,
                COALESCE(b.snapshot_mass_gram, p.mass_gram) AS mass_gram,
                COALESCE(b.bom_notes, p.notes)              AS spec
         FROM tg.bom b JOIN tg.part p ON p.part_id = b.child_part_id
         WHERE b.bom_id = $1`, [req.params.itemId]
      )
      const oldImg = cur[0]?.snapshot_image_url
      if (oldImg) {
        await pool.query(
          `INSERT INTO tg.bom_image_history
             (bom_id, image_url, event_type, tg_part_no, part_name, quantity, mass_gram, spec)
           VALUES ($1,$2,'image_replaced',$3,$4,$5,$6,$7)`,
          [req.params.itemId, oldImg,
           cur[0].tg_part_no, cur[0].part_name,
           cur[0].quantity, cur[0].mass_gram, cur[0].spec]
        )
      }
    }

    await pool.query(
      `UPDATE tg.bom SET
         quantity           = COALESCE($1,  quantity),
         level_code         = COALESCE($2,  level_code),
         sort_order         = COALESCE($3,  sort_order),
         notes              = COALESCE($4,  notes),
         price_per_pc       = $5,
         supplier           = $6,
         lead_time_day      = $7,
         completion_remark  = $8,
         snapshot_part_name = COALESCE($9,  snapshot_part_name),
         snapshot_mass_gram = COALESCE($10, snapshot_mass_gram),
         snapshot_image_url = COALESCE($11, snapshot_image_url)
       WHERE bom_id = $12`,
      [b.quantity   != null ? b.quantity   : null,
       b.level_code != null ? b.level_code : null,
       b.sort_order != null ? b.sort_order : null,
       b.note       != null ? b.note       : null,
       b.price    ? parseFloat(b.price)  : null,
       (b.supplier && b.supplier !== '–') ? b.supplier : null,
       b.lead_time ? parseInt(b.lead_time) : null,
       b.remark || null,
       newSnapName,
       newSnapMass,
       imageUrl,
       req.params.itemId]
    )
    res.json({ updated: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bom/:id/image-history
router.get('/:id/image-history', async (req, res) => {
  const dsId = parseInt(req.params.id)
  try {
    const { rows } = await pool.query(`
      SELECT
        h.id,
        h.bom_id,
        h.image_url,
        h.event_type,
        COALESCE(h.tg_part_no,  p.tg_part_no)                    AS tg_part_no,
        COALESCE(h.part_name,   b.snapshot_part_name, p.part_name) AS part_name,
        COALESCE(h.quantity,    b.quantity)                        AS quantity,
        COALESCE(h.mass_gram,   b.snapshot_mass_gram, p.mass_gram) AS mass_gram,
        h.spec,
        b.bom_level                                               AS level,
        to_char(h.replaced_at AT TIME ZONE 'Asia/Bangkok', 'DD Mon YYYY HH24:MI') AS recorded_at
      FROM tg.bom_image_history h
      JOIN tg.bom  b ON b.bom_id  = h.bom_id
      JOIN tg.part p ON p.part_id = b.child_part_id
      WHERE b.design_spec_id = $1
      ORDER BY h.replaced_at DESC
    `, [dsId])
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bom/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    // Collect all image files to delete (current snapshot + history)
    const { rows: imgs } = await pool.query(
      `SELECT snapshot_image_url AS url FROM tg.bom WHERE bom_id=$1
       UNION ALL
       SELECT image_url FROM tg.bom_image_history WHERE bom_id=$1`,
      [req.params.itemId]
    )

    const { rows } = await pool.query(
      'DELETE FROM tg.bom WHERE bom_id=$1 AND design_spec_id=$2 RETURNING bom_id',
      [req.params.itemId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Item not found' })

    imgs.forEach(r => deleteImageFile(r.url))
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bom/:id — ลบ BOM ทั้งหมด
router.delete('/:id', async (req, res) => {
  const dsId = parseInt(req.params.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: boms } = await client.query('SELECT bom_id FROM tg.bom WHERE design_spec_id=$1', [dsId])
    const bomIds = boms.map(r => r.bom_id)
    if (bomIds.length) {
      // Collect all image files before deleting records
      const { rows: imgs } = await client.query(
        `SELECT snapshot_image_url AS url FROM tg.bom WHERE bom_id = ANY($1)
         UNION ALL
         SELECT image_url FROM tg.bom_image_history WHERE bom_id = ANY($1)`,
        [bomIds]
      )
      await client.query('DELETE FROM tg.approval_tokens WHERE bom_id = ANY($1)', [bomIds])
      await client.query('DELETE FROM tg.bom_item_history WHERE bom_id = ANY($1)', [bomIds])
      imgs.forEach(r => deleteImageFile(r.url))
    }
    await client.query('DELETE FROM tg.bom_revision WHERE design_spec_id=$1', [dsId])
    await client.query('DELETE FROM tg.design_spec_tgt_history WHERE design_spec_id=$1', [dsId])
    await client.query('DELETE FROM tg.bom_document WHERE design_spec_id=$1', [dsId])
    await client.query('DELETE FROM tg.bom WHERE design_spec_id=$1', [dsId])
    await client.query('DELETE FROM tg.product_variant WHERE design_spec_id=$1', [dsId])
    await client.query('DELETE FROM tg.design_spec WHERE design_spec_id=$1', [dsId])
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally { client.release() }
})

// DELETE /api/bom/:id/revisions/reset — ลบข้อมูล revision ทั้งหมดและ reset กลับสู่สภาพเริ่มต้น
router.delete('/:id/revisions/reset', async (req, res) => {
  const dsId = parseInt(req.params.id)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ลบ bom_revision records ทั้งหมด
    await client.query('DELETE FROM tg.bom_revision WHERE design_spec_id=$1', [dsId])

    // ลบ bom rows ที่เป็น revised_out (ของที่เพิ่มจาก test)
    await client.query(
      `DELETE FROM tg.bom WHERE design_spec_id=$1 AND status='revised_out'`, [dsId]
    )

    // ลบ bom_item_history ทั้งหมดของ BOM นี้
    await client.query(
      `DELETE FROM tg.bom_item_history
       WHERE bom_id IN (SELECT bom_id FROM tg.bom WHERE design_spec_id=$1)`,
      [dsId]
    )

    // reset update_level ของทุก bom row กลับเป็น 0
    await client.query(
      `UPDATE tg.bom SET update_level=0, status='active' WHERE design_spec_id=$1`, [dsId]
    )

    await client.query('COMMIT')
    res.json({ reset: true })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

// POST /api/bom/fix-tgt-history — Fix old_tg_part_no in history that contains * (for legacy data)
router.post('/fix-tgt-history', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Find all history records with * in old_tg_part_no
    const { rows: badRecords } = await client.query(
      `SELECT dsth.*, ds.design_spec_id
       FROM tg.design_spec_tgt_history dsth
       JOIN tg.design_spec ds ON ds.design_spec_id = dsth.design_spec_id
       WHERE dsth.old_tg_part_no LIKE '%*%'`
    )

    let fixed = 0
    for (const record of badRecords) {
      // Get Level 1 BOM part from this design_spec
      const { rows: lv1Items } = await client.query(
        `SELECT DISTINCT p.tg_part_no
         FROM tg.bom b
         JOIN tg.part p ON p.part_id = b.child_part_id
         WHERE b.design_spec_id = $1 AND b.bom_level = 1 AND (b.status IS NULL OR b.status = 'active')
         LIMIT 1`,
        [record.design_spec_id]
      )

      if (lv1Items.length && lv1Items[0].tg_part_no && !lv1Items[0].tg_part_no.includes('*')) {
        await client.query(
          `UPDATE tg.design_spec_tgt_history
           SET old_tg_part_no = $1
           WHERE design_spec_id = $2 AND introduced_at = $3`,
          [lv1Items[0].tg_part_no, record.design_spec_id, record.introduced_at]
        )
        fixed++
      }
    }

    await client.query('COMMIT')
    res.json({ fixed })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally {
    client.release()
  }
})

export default router
