import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { pool } from '../db.js'
import { logActivity } from '../activity.js'

const router = express.Router()

function deleteImageFile(imageUrl) {
  if (!imageUrl) return
  try {
    const filePath = path.join(__dirname, '../../', imageUrl)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch { /* ignore missing files */ }
}

function deletePdfFile(pdfUrl) {
  if (!pdfUrl) return
  try {
    const filePath = path.join(__dirname, '../../', pdfUrl)
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
    COALESCE(ds.model_name_override, m.model_name)  AS model_name,
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
    ds.bom_group,
    ds.created_by,
    ds.updated_by,
    to_char(ds.updated_at AT TIME ZONE 'Asia/Bangkok', 'DD-Mon-YY HH24:MI') AS updated_at,
    COALESCE(lv1.part_name, '')                   AS part_name,
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
  LEFT JOIN LATERAL (
    SELECT COALESCE(b.snapshot_part_name, p.part_name) AS part_name
    FROM tg.bom b JOIN tg.part p ON p.part_id = b.child_part_id
    WHERE b.design_spec_id = ds.design_spec_id AND b.bom_level = 1
      AND (b.status IS NULL OR b.status = 'active')
    ORDER BY b.sort_order LIMIT 1
  ) lv1 ON TRUE
`

const ITEMS_SQL = `
  WITH it AS (
    SELECT b.bom_id, b.variant_id, b.parent_part_id, b.child_part_id,
           b.bom_level, b.level_code, b.quantity, b.sort_order, b.notes AS bom_notes,
           b.update_level, b.status,
           b.price_per_pc, b.supplier, b.lead_time_day, b.completion_remark,
           b.snapshot_part_name, b.snapshot_mass_gram, b.snapshot_image_url,
           b.snapshot_tg_part_no, b.material_cost, b.receiver, b.internal_code, b.kanban_qty,
           b.gate
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
    COALESCE(it.snapshot_tg_part_no, p.tg_part_no)               AS tg_part_no,
    p.customer_part_no,
    p.soc_flag                                                 AS soc,
    COALESCE(it.snapshot_mass_gram, p.mass_gram)               AS mass_g,
    it.gate                                                    AS gate,
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
    it.completion_remark,
    it.material_cost,
    it.receiver,
    it.internal_code,
    it.kanban_qty
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
       SET prepared_by = $1, approved_by = $2, customer_name_override = $3,
           model_name_override = $4, updated_by = $5, updated_at = NOW()
       WHERE design_spec_id = $6`,
      [b.revisioner ?? null, b.approved_by ?? null, b.customer_name ?? null,
       b.model_name?.trim() || null, req.user?.full_name || req.user?.username || null, dsId]
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

    // update revisioner/approved_by/revision_record for non-first revision rows
    if (Array.isArray(b.rev_names) && b.rev_names.length) {
      for (const u of b.rev_names) {
        await pool.query(
          `UPDATE tg.bom_revision
             SET revisioner=$1, approved_by=$2,
                 revision_record=COALESCE($5, revision_record)
           WHERE design_spec_id=$3 AND mark=$4`,
          [u.revisioner ?? null, u.approved_by ?? null, dsId, u.mark, u.revision_record ?? null]
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

// ── Saved Part No. views ──────────────────────────────────────────────────────
// POST /api/bom/:id/views  { key_code, name, part_nos:[...] }
router.post('/:id/views', async (req, res) => {
  const dsId = parseInt(req.params.id)
  const name = (req.body.name ?? '').trim()
  const keyCode = req.body.key_code != null ? String(req.body.key_code) : null
  const partNos = Array.isArray(req.body.part_nos)
    ? req.body.part_nos.map(s => String(s).trim()).filter(Boolean)
    : []
  if (!name) return res.status(400).json({ error: 'name required' })
  if (!partNos.length) return res.status(400).json({ error: 'part_nos required' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO tg.bom_view (design_spec_id, key_code, name, part_nos, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, key_code, name, part_nos, created_by`,
      [dsId, keyCode, name, partNos, req.user?.full_name || req.user?.username || null]
    )
    res.status(201).json(rows[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bom/:id/views/:viewId
router.delete('/:id/views/:viewId', async (req, res) => {
  try {
    await pool.query('DELETE FROM tg.bom_view WHERE id=$1 AND design_spec_id=$2',
      [parseInt(req.params.viewId), parseInt(req.params.id)])
    res.json({ deleted: true })
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
                revisioner, approved_by, pdf_url
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

    // Saved Part No. views (migration_016 — skip if not yet applied)
    let views = []
    try {
      const { rows } = await pool.query(
        `SELECT id, key_code, name, part_nos, created_by,
                to_char(created_at,'DD-Mon-YY') AS created
         FROM tg.bom_view WHERE design_spec_id = $1 ORDER BY id`,
        [req.params.id]
      )
      views = rows
    } catch (_) {}

    res.json({
      ...h[0],
      tgt_history: tgtHistory,
      tgt_update_level: tgtUpdateLevel,
      revisions,
      items: enrichedItems,
      views,
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
  const { eci_no, revision_date, revisioner, approved_by, items = [], new_tg_part_no, active_key, pdf_url } = req.body

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
      // Select the active Level 1 row for the specific key variant (if active_key provided)
      const lv1Query = active_key
        ? `SELECT b.bom_id FROM tg.bom b
           LEFT JOIN tg.product_variant pv ON pv.variant_id = b.variant_id
           WHERE b.design_spec_id = $1 AND b.bom_level = 1
             AND (b.status IS NULL OR b.status = 'active')
             AND pv.variant_key::TEXT = $2
           ORDER BY b.sort_order LIMIT 1`
        : `SELECT bom_id FROM tg.bom
           WHERE design_spec_id = $1 AND bom_level = 1 AND (status IS NULL OR status = 'active')
           ORDER BY sort_order LIMIT 1`
      const lv1Params = active_key ? [dsId, active_key] : [dsId]
      const { rows: lv1Rows } = await client.query(lv1Query, lv1Params)
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
    let lv1OldTgPartNo = null  // track actual Level 1 part no. for tgt_history
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
      if (c.bom_level === 1) lv1OldTgPartNo = c.tg_part_no

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
        .trim().replace(/\|\s*$/, '').trim() || c.notes || null

      // New value if provided, else inherit from old row
      let finalSpec    = new_note?.trim()     || oldSpec
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
        'SELECT part_id, product_standard, material_standard FROM tg.part WHERE tg_part_no=$1', [newPn]
      )
      if (existPart.length) {
        newPartId = existPart[0].part_id
        // Never update tg.part — it is shared. User-supplied values go into snapshot
        // columns on the new BOM row only.
        // But preserve standards from old part that new part lacks (embed in bom_notes)
        const missingStds = [
          c.product_standard  && c.product_standard  !== 'NO' && c.product_standard  !== existPart[0].product_standard  ? c.product_standard  : null,
          c.material_standard && c.material_standard !== 'NO' && c.material_standard !== existPart[0].material_standard ? c.material_standard : null,
        ].filter(s => s && !(finalSpec ?? '').includes(s))
        if (missingStds.length) {
          const combined = [finalSpec, ...missingStds].filter(Boolean).join('  ')
          finalSpec = combined  // eslint-disable-line no-inner-declarations
        }
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

      // Snapshot: prefer user-supplied value, then inherit from old row (c already has COALESCE applied)
      const revSnapName  = new_part_name?.trim() || c.part_name  || null
      const revSnapMass  = newMassVal !== null    ? newMassVal    : (c.mass_gram ?? null)
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
        await client.query(
          `INSERT INTO tg.design_spec_tgt_history
             (design_spec_id, introduced_at, superseded_at, old_tg_part_no)
           VALUES ($1, $2, $3, $4)`,
          [dsId, dsRows[0].tgt_update_level ?? 0, newLevel, lv1OldTgPartNo ?? dsRows[0].tg_part_no]
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
           (design_spec_id, sort_order, mark, revision_record, eci_no, revision_date, revisioner, approved_by, pdf_url)
         VALUES ($1, $2, $3, 'Update ECI No.', $4, $5, $6, $7, $8)`,
        [dsId, newLevel, String(newLevel),
         eci_no ?? null,
         revision_date ? new Date(revision_date) : null,
         revisioner ?? null,
         approved_by ?? null,
         pdf_url ?? null]
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
    if (!selRows.length) {
      const { rows: dsCheck } = await client.query(
        `SELECT 1 FROM tg.design_spec WHERE design_spec_id = $1`, [dsId]
      )
      if (!dsCheck.length) {
        client.release()
        return res.status(409).json({ error: 'BOM was re-imported — please reload', stale_bom: true })
      }
      throw new Error(`Reference item not found (bom_id=${after_bom_id}, design_spec_id=${dsId})`)
    }
    const sel = selRows[0]

    // Level: use the explicitly chosen level (1-6) if valid; otherwise default to one deeper.
    const reqLevel = parseInt(req.body.level)
    const newLevel = (reqLevel >= 1 && reqLevel <= 6) ? reqLevel : Math.min(sel.bom_level + 1, 6)

    // Parent depends on the chosen level relative to the selected row:
    let newParentPartId
    if (newLevel === 1) {
      newParentPartId = null                       // top-level item
    } else if (newLevel === sel.bom_level + 1) {
      newParentPartId = sel.child_part_id          // direct child of selected
    } else if (newLevel === sel.bom_level) {
      newParentPartId = sel.parent_part_id         // sibling of selected
    } else {
      // Walk back to the nearest preceding row at (newLevel - 1) — its part is the parent
      const { rows: par } = await client.query(
        `SELECT child_part_id FROM tg.bom
         WHERE design_spec_id = $1 AND sort_order <= $2 AND bom_level = $3
           AND variant_id IS NOT DISTINCT FROM $4
           AND (status IS NULL OR status <> 'obsolete')
         ORDER BY sort_order DESC LIMIT 1`,
        [dsId, sel.sort_order, newLevel - 1, sel.variant_id]
      )
      newParentPartId = par[0]?.child_part_id ?? sel.parent_part_id
    }

    // Insert right after the clicked row — new item becomes the first child
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
    let rowSnapImage = imageUrl

    // Always create a new part — never reuse by tg_part_no.
    // Reusing causes multiple bom rows to share the same child_part_id, which
    // breaks the document tree (parent_part_id lookups cross into wrong subtrees).
    const { rows: newPart } = await client.query(
      `INSERT INTO tg.part (tg_part_no, part_name, mass_gram, notes, image_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING part_id`,
      [tg_part_no || null, part_name, massVal, partNotes, imageUrl]
    )
    partId = newPart[0].part_id

    // Insert BOM row — store combinedNotes (Material Spec + Q'ty text + Weight text) in bom.notes.
    // snapshot_part_name / snapshot_mass_gram are only set when reusing an existing part so that
    // COALESCE(snapshot, tg.part) returns the user's values for this row without affecting others.
    const { rows: bomRow } = await client.query(
      `INSERT INTO tg.bom
         (design_spec_id, variant_id, parent_part_id, child_part_id,
          bom_level, quantity, sort_order, status, notes,
          snapshot_part_name, snapshot_mass_gram, snapshot_image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11) RETURNING bom_id`,
      [dsId, sel.variant_id, newParentPartId, partId, newLevel, qtyVal ?? 1, newSortOrder,
       combinedNotes,
       null, null, rowSnapImage]
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

    await client.query(
      `UPDATE tg.design_spec SET updated_by=$1, updated_at=NOW() WHERE design_spec_id=$2`,
      [req.user?.full_name || req.user?.username || null, dsId]
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
         quantity              = COALESCE($1,  quantity),
         level_code            = COALESCE($2,  level_code),
         sort_order            = COALESCE($3,  sort_order),
         notes                 = COALESCE($4,  notes),
         price_per_pc          = $5,
         supplier              = $6,
         lead_time_day         = $7,
         completion_remark     = $8,
         snapshot_part_name    = COALESCE($9,  snapshot_part_name),
         snapshot_mass_gram    = COALESCE($10, snapshot_mass_gram),
         snapshot_image_url    = COALESCE($11, snapshot_image_url),
         snapshot_tg_part_no   = COALESCE($13, snapshot_tg_part_no),
         material_cost         = $14,
         receiver              = $15,
         internal_code         = $16,
         kanban_qty            = $17,
         gate                  = $18
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
       req.params.itemId,
       b.tg_part_no?.trim() || null,
       b.material_cost ? parseFloat(b.material_cost) : null,
       b.receiver || null,
       b.internal_code || null,
       b.kanban_qty || null,
       b.gate || null,
      ]
    )
    await pool.query(
      `UPDATE tg.design_spec SET updated_by=$1, updated_at=NOW() WHERE design_spec_id=$2`,
      [req.user?.full_name || req.user?.username || null, req.params.id]
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
    const { rows: dsInfo } = await client.query('SELECT tg_part_no, pdf_url FROM tg.design_spec WHERE design_spec_id=$1', [dsId])
    // Collect all PDF files before deleting records (design_spec + every revision)
    const { rows: pdfRows } = await client.query(
      `SELECT pdf_url FROM tg.design_spec WHERE design_spec_id=$1 AND pdf_url IS NOT NULL
       UNION ALL
       SELECT pdf_url FROM tg.bom_revision WHERE design_spec_id=$1 AND pdf_url IS NOT NULL`,
      [dsId]
    )
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
    pdfRows.forEach(r => deletePdfFile(r.pdf_url))
    logActivity(req.user, 'delete', dsInfo[0]?.tg_part_no ?? String(dsId))
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

export default router
