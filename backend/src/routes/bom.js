const express = require('express')
const router = express.Router()
const { getPool, sql } = require('../db')

// GET /api/bom
router.get('/', async (req, res) => {
  try {
    const pool = await getPool()
    const { recordset } = await pool.request().query('SELECT * FROM bom_headers ORDER BY id')
    res.json(recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/bom/:id
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool()
    const hResult = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM bom_headers WHERE id = @id')
    if (!hResult.recordset.length) return res.status(404).json({ error: 'BOM not found' })

    const iResult = await pool.request()
      .input('bom_id', sql.Int, req.params.id)
      .query('SELECT * FROM bom_items WHERE bom_id = @bom_id ORDER BY sort_order, id')

    res.json({ ...hResult.recordset[0], items: iResult.recordset })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/bom
router.post('/', async (req, res) => {
  const { model, customer_part_no, production_level, control_rank, reg_certif, date, customer, tg_part_no, customer_standards, tg_standards, internal_eci_no, type, part_name } = req.body
  if (!model || !customer_part_no) return res.status(400).json({ error: 'model and customer_part_no required' })
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('model', sql.NVarChar, model)
      .input('customer_part_no', sql.NVarChar, customer_part_no)
      .input('production_level', sql.NVarChar, production_level ?? null)
      .input('control_rank', sql.NVarChar, control_rank ?? null)
      .input('reg_certif', sql.NVarChar, reg_certif ?? null)
      .input('date', sql.NVarChar, date ?? null)
      .input('customer', sql.NVarChar, customer ?? null)
      .input('tg_part_no', sql.NVarChar, tg_part_no ?? null)
      .input('customer_standards', sql.NVarChar, customer_standards ?? null)
      .input('tg_standards', sql.NVarChar, tg_standards ?? null)
      .input('internal_eci_no', sql.NVarChar, internal_eci_no ?? null)
      .input('type', sql.NVarChar, type ?? null)
      .input('part_name', sql.NVarChar, part_name ?? null)
      .query(`
        INSERT INTO bom_headers (model, customer_part_no, production_level, control_rank, reg_certif, date, customer, tg_part_no, customer_standards, tg_standards, internal_eci_no, type, part_name)
        OUTPUT INSERTED.*
        VALUES (@model, @customer_part_no, @production_level, @control_rank, @reg_certif, @date, @customer, @tg_part_no, @customer_standards, @tg_standards, @internal_eci_no, @type, @part_name)
      `)
    res.status(201).json(result.recordset[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/bom/:id
router.put('/:id', async (req, res) => {
  const { model, customer_part_no, production_level, control_rank, reg_certif, date, customer, tg_part_no, customer_standards, tg_standards, internal_eci_no, type, part_name } = req.body
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('model', sql.NVarChar, model)
      .input('customer_part_no', sql.NVarChar, customer_part_no)
      .input('production_level', sql.NVarChar, production_level ?? null)
      .input('control_rank', sql.NVarChar, control_rank ?? null)
      .input('reg_certif', sql.NVarChar, reg_certif ?? null)
      .input('date', sql.NVarChar, date ?? null)
      .input('customer', sql.NVarChar, customer ?? null)
      .input('tg_part_no', sql.NVarChar, tg_part_no ?? null)
      .input('customer_standards', sql.NVarChar, customer_standards ?? null)
      .input('tg_standards', sql.NVarChar, tg_standards ?? null)
      .input('internal_eci_no', sql.NVarChar, internal_eci_no ?? null)
      .input('type', sql.NVarChar, type ?? null)
      .input('part_name', sql.NVarChar, part_name ?? null)
      .query(`
        UPDATE bom_headers SET
          model=@model, customer_part_no=@customer_part_no, production_level=@production_level,
          control_rank=@control_rank, reg_certif=@reg_certif, date=@date, customer=@customer,
          tg_part_no=@tg_part_no, customer_standards=@customer_standards, tg_standards=@tg_standards,
          internal_eci_no=@internal_eci_no, type=@type, part_name=@part_name, updated_at=GETDATE()
        OUTPUT INSERTED.*
        WHERE id=@id
      `)
    if (!result.recordset.length) return res.status(404).json({ error: 'BOM not found' })
    res.json(result.recordset[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bom/:id
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool()
    // delete items first (no cascade in SQL Server without explicit ON DELETE CASCADE)
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM bom_items WHERE bom_id = @id')
    const result = await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM bom_headers OUTPUT DELETED.id WHERE id = @id')
    if (!result.recordset.length) return res.status(404).json({ error: 'BOM not found' })
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/bom/:id/items
router.post('/:id/items', async (req, res) => {
  const bomId = parseInt(req.params.id)
  const b = req.body
  if (!b.part_name) return res.status(400).json({ error: 'part_name required' })
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('bom_id', sql.Int, bomId)
      .input('parent_id', sql.Int, b.parent_id ?? null)
      .input('sort_order', sql.Int, b.sort_order ?? 0)
      .input('key_code', sql.NVarChar, b.key_code ?? null)
      .input('level', sql.Int, b.level ?? null)
      .input('level_code', sql.NVarChar, b.level_code ?? null)
      .input('rc', sql.NVarChar, b.rc ?? null)
      .input('customer_part_no', sql.NVarChar, b.customer_part_no ?? null)
      .input('tg_part_no', sql.NVarChar, b.tg_part_no ?? null)
      .input('soc', sql.NVarChar, b.soc ?? null)
      .input('quantity', sql.Int, b.quantity ?? 1)
      .input('pp_mold', sql.NVarChar, b.pp_mold ?? null)
      .input('mass_g', sql.Float, b.mass_g ?? null)
      .input('part_name', sql.NVarChar, b.part_name)
      .input('product_standards', sql.NVarChar, b.product_standards ?? null)
      .input('material_standards', sql.NVarChar, b.material_standards ?? null)
      .input('use_portion', sql.NVarChar, b.use_portion ?? null)
      .input('material_no', sql.NVarChar, b.material_no ?? null)
      .input('instruction_no', sql.NVarChar, b.instruction_no ?? null)
      .input('material_trade_name', sql.NVarChar, b.material_trade_name ?? null)
      .input('material_type', sql.NVarChar, b.material_type ?? null)
      .input('color_no', sql.NVarChar, b.color_no ?? null)
      .input('color_tone', sql.NVarChar, b.color_tone ?? null)
      .input('material_mass', sql.Float, b.material_mass ?? null)
      .input('sa', sql.NVarChar, b.sa ?? null)
      .input('note', sql.NVarChar, b.note ?? null)
      .query(`
        INSERT INTO bom_items
          (bom_id, parent_id, sort_order, key_code, level, level_code, rc, customer_part_no, tg_part_no, soc, quantity, pp_mold, mass_g, part_name, product_standards, material_standards, use_portion, material_no, instruction_no, material_trade_name, material_type, color_no, color_tone, material_mass, sa, note)
        OUTPUT INSERTED.*
        VALUES
          (@bom_id, @parent_id, @sort_order, @key_code, @level, @level_code, @rc, @customer_part_no, @tg_part_no, @soc, @quantity, @pp_mold, @mass_g, @part_name, @product_standards, @material_standards, @use_portion, @material_no, @instruction_no, @material_trade_name, @material_type, @color_no, @color_tone, @material_mass, @sa, @note)
      `)
    res.status(201).json(result.recordset[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/bom/:id/items/:itemId
router.put('/:id/items/:itemId', async (req, res) => {
  const b = req.body
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.Int, req.params.itemId)
      .input('bom_id', sql.Int, req.params.id)
      .input('parent_id', sql.Int, b.parent_id ?? null)
      .input('sort_order', sql.Int, b.sort_order ?? 0)
      .input('key_code', sql.NVarChar, b.key_code ?? null)
      .input('level', sql.Int, b.level ?? null)
      .input('level_code', sql.NVarChar, b.level_code ?? null)
      .input('rc', sql.NVarChar, b.rc ?? null)
      .input('customer_part_no', sql.NVarChar, b.customer_part_no ?? null)
      .input('tg_part_no', sql.NVarChar, b.tg_part_no ?? null)
      .input('soc', sql.NVarChar, b.soc ?? null)
      .input('quantity', sql.Int, b.quantity ?? 1)
      .input('pp_mold', sql.NVarChar, b.pp_mold ?? null)
      .input('mass_g', sql.Float, b.mass_g ?? null)
      .input('part_name', sql.NVarChar, b.part_name)
      .input('product_standards', sql.NVarChar, b.product_standards ?? null)
      .input('material_standards', sql.NVarChar, b.material_standards ?? null)
      .input('use_portion', sql.NVarChar, b.use_portion ?? null)
      .input('material_no', sql.NVarChar, b.material_no ?? null)
      .input('instruction_no', sql.NVarChar, b.instruction_no ?? null)
      .input('material_trade_name', sql.NVarChar, b.material_trade_name ?? null)
      .input('material_type', sql.NVarChar, b.material_type ?? null)
      .input('color_no', sql.NVarChar, b.color_no ?? null)
      .input('color_tone', sql.NVarChar, b.color_tone ?? null)
      .input('material_mass', sql.Float, b.material_mass ?? null)
      .input('sa', sql.NVarChar, b.sa ?? null)
      .input('note', sql.NVarChar, b.note ?? null)
      .query(`
        UPDATE bom_items SET
          parent_id=@parent_id, sort_order=@sort_order, key_code=@key_code, level=@level,
          level_code=@level_code, rc=@rc, customer_part_no=@customer_part_no, tg_part_no=@tg_part_no,
          soc=@soc, quantity=@quantity, pp_mold=@pp_mold, mass_g=@mass_g, part_name=@part_name,
          product_standards=@product_standards, material_standards=@material_standards,
          use_portion=@use_portion, material_no=@material_no, instruction_no=@instruction_no,
          material_trade_name=@material_trade_name, material_type=@material_type,
          color_no=@color_no, color_tone=@color_tone, material_mass=@material_mass, sa=@sa,
          note=@note, updated_at=GETDATE()
        OUTPUT INSERTED.*
        WHERE id=@id AND bom_id=@bom_id
      `)
    if (!result.recordset.length) return res.status(404).json({ error: 'Item not found' })
    res.json(result.recordset[0])
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/bom/:id/items/:itemId
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.Int, req.params.itemId)
      .input('bom_id', sql.Int, req.params.id)
      .query('DELETE FROM bom_items OUTPUT DELETED.id WHERE id=@id AND bom_id=@bom_id')
    if (!result.recordset.length) return res.status(404).json({ error: 'Item not found' })
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
