import express from 'express'
import { pool } from '../db.js'

const router = express.Router()

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
    c.customer_name,
    ds.tg_part_no,
    ds.customer_standard                          AS customer_standards,
    ds.tg_standard                                AS tg_standards,
    ds.internal_eci_no,
    COALESCE(bd.type, 'HE')                       AS type,
    ds.prepared_by,
    ds.checked_by,
    ds.approved_by,
    ds.confirmed_by,
    'WHEEL ASSY, STEERING (N)'                    AS part_name
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
           b.update_level, b.status
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
    p.mass_gram                                                AS mass_g,
    p.part_name,
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
    it.status
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
    // prepared_by / approved_by always exist
    await pool.query(
      `UPDATE tg.design_spec
       SET prepared_by = $1, approved_by = $2
       WHERE design_spec_id = $3`,
      [b.revisioner ?? null, b.approved_by ?? null, dsId]
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
// Record a BOM update: save old part nos to history, update to new, add bom_revision row
router.post('/:id/revision', async (req, res) => {
  const dsId = parseInt(req.params.id)
  const { eci_no, revision_date, revisioner, approved_by, items = [], new_tg_part_no } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Determine next update level from existing bom_revision marks
    const { rows: lvRows } = await client.query(
      `SELECT COALESCE(
         MAX(CASE WHEN mark ~ '^[0-9]+$' THEN mark::smallint ELSE 0 END), 0
       ) AS max_level
       FROM tg.bom_revision WHERE design_spec_id = $1`,
      [dsId]
    )
    const newLevel = (lvRows[0].max_level ?? 0) + 1

    // Process each changed item
    for (const { bom_id, new_part_no } of items) {
      if (!new_part_no?.trim()) continue

      // ดึงข้อมูล bom row เดิม + part เดิม
      const { rows: cur } = await client.query(
        `SELECT b.update_level, b.sort_order, b.variant_id, b.parent_part_id,
                b.bom_level, b.level_code, b.quantity,
                p.tg_part_no, p.customer_part_no, p.part_id,
                p.part_name, p.mass_gram, p.product_standard, p.material_standard,
                p.is_purchased_material, p.reg_certif_required, p.notes
         FROM tg.bom b JOIN tg.part p ON p.part_id = b.child_part_id
         WHERE b.bom_id = $1 AND b.design_spec_id = $2`,
        [bom_id, dsId]
      )
      if (!cur.length) continue
      const c = cur[0]

      // บันทึก history
      await client.query(
        `INSERT INTO tg.bom_item_history
           (bom_id, introduced_at, superseded_at, old_tg_part_no, old_customer_part_no)
         VALUES ($1, $2, $3, $4, $5)`,
        [bom_id, c.update_level, newLevel, c.tg_part_no, c.customer_part_no]
      )

      // นับ update_level เฉพาะ part นี้ (ไม่ใช่ global)
      const partUpdateLevel = (parseInt(c.update_level) || 0) + 1

      // mark row เดิมเป็น revised_out (แสดงขีดฆ่า ไม่ลบ)
      await client.query(
        `UPDATE tg.bom SET status='revised_out', update_level=$1 WHERE bom_id=$2`,
        [partUpdateLevel, bom_id]
      )

      // หา part ใหม่หรือสร้างใหม่
      const newPn = new_part_no.trim()
      let newPartId
      const { rows: existPart } = await client.query(
        'SELECT part_id FROM tg.part WHERE tg_part_no=$1', [newPn]
      )
      if (existPart.length) {
        newPartId = existPart[0].part_id
      } else {
        const r = await client.query(
          `INSERT INTO tg.part
             (tg_part_no, customer_part_no, part_name, mass_gram,
              product_standard, material_standard, notes,
              is_purchased_material, reg_certif_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING part_id`,
          [newPn, c.customer_part_no, c.part_name, c.mass_gram,
           c.product_standard, c.material_standard, c.notes,
           c.is_purchased_material, c.reg_certif_required]
        )
        newPartId = r.rows[0].part_id
      }

      // เลื่อน sort_order ของแถวที่อยู่ถัดจาก row เดิมออกก่อน (+1)
      await client.query(
        `UPDATE tg.bom SET sort_order = sort_order + 1
         WHERE design_spec_id = $1 AND sort_order > $2`,
        [dsId, c.sort_order]
      )

      // INSERT row ใหม่ต่อจาก row เดิมทันที
      await client.query(
        `INSERT INTO tg.bom
           (design_spec_id, variant_id, parent_part_id, child_part_id,
            bom_level, level_code, quantity, sort_order, status, update_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,
        [dsId, c.variant_id, c.parent_part_id, newPartId,
         c.bom_level, c.level_code, c.quantity,
         parseInt(c.sort_order) + 1,
         partUpdateLevel]
      )
    }

    // Handle TGT Part No. change
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
          [dsId, dsRows[0].tgt_update_level ?? 0, newLevel, dsRows[0].tg_part_no]
        )
        await client.query(
          'UPDATE tg.design_spec SET tg_part_no = $1, tgt_update_level = $2 WHERE design_spec_id = $3',
          [new_tg_part_no.trim(), newLevel, dsId]
        )
      }
    }

    // Add bom_revision entry
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

// PUT /api/bom/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const b = req.body
  try {
    const { rows: bom } = await pool.query(
      'SELECT bom_id, child_part_id FROM tg.bom WHERE bom_id=$1 AND design_spec_id=$2',
      [req.params.itemId, req.params.id]
    )
    if (!bom.length) return res.status(404).json({ error: 'Item not found' })

    await pool.query(
      'UPDATE tg.bom SET quantity=$1, level_code=$2, sort_order=$3, notes=$4 WHERE bom_id=$5',
      [b.quantity ?? 1, b.level_code ?? null, b.sort_order ?? 0, b.note ?? null, req.params.itemId]
    )
    if (b.part_name) {
      await pool.query(
        'UPDATE tg.part SET part_name=$1, mass_gram=$2, notes=$3, updated_at=NOW() WHERE part_id=$4',
        [b.part_name, b.mass_g ?? null, b.note ?? null, bom[0].child_part_id]
      )
    }
    res.json({ updated: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bom/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM tg.bom WHERE bom_id=$1 AND design_spec_id=$2 RETURNING bom_id',
      [req.params.itemId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Item not found' })
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
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
