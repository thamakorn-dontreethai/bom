import pg from 'pg'
const { Pool } = pg

export const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'tg_steering_wheel',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

pool.on('connect', client => client.query('SET search_path TO tg, public'))

export async function initDb() {
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM tg.bom')
  if (parseInt(rows[0].cnt) === 0) {
    console.log('Seeding tg.bom…')
    await seedBom()
    console.log('Seed complete.')
  }
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function pid(tgPartNo) {
  const { rows } = await pool.query(
    'SELECT part_id FROM tg.part WHERE tg_part_no = $1', [tgPartNo]
  )
  if (!rows.length) throw new Error(`Part not found in tg.part: ${tgPartNo}`)
  return rows[0].part_id
}

async function ins(dsId, varId, parentPartId, tgPartNo, level, levelCode, qty, sort) {
  const childId = await pid(tgPartNo)
  const { rows } = await pool.query(
    `INSERT INTO tg.bom
       (design_spec_id, variant_id, parent_part_id, child_part_id,
        bom_level, level_code, quantity, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING bom_id, child_part_id`,
    [dsId, varId, parentPartId, childId, level, levelCode, qty ?? 1, sort ?? 0]
  )
  return { bomId: rows[0].bom_id, partId: rows[0].child_part_id }
}

async function seedBom() {
  const { rows: dsRows } = await pool.query(
    "SELECT design_spec_id FROM tg.design_spec WHERE internal_eci_no = '26A376' LIMIT 1"
  )
  if (!dsRows.length) throw new Error('design_spec not found – run the schema SQL first')
  const dsId = dsRows[0].design_spec_id

  const { rows: v1Rows } = await pool.query(
    'SELECT variant_id FROM tg.product_variant WHERE variant_key = 1 LIMIT 1'
  )
  const { rows: v2Rows } = await pool.query(
    'SELECT variant_id FROM tg.product_variant WHERE variant_key = 2 LIMIT 1'
  )
  if (!v1Rows.length || !v2Rows.length)
    throw new Error('product_variant rows not found – run the schema SQL first')
  const v1 = v1Rows[0].variant_id
  const v2 = v2Rows[0].variant_id

  // ── Variant 1 (NH-900L / Black) ───────────────────────────────────────────
  const { partId: top1 } = await ins(dsId, v1, null, '78500-DA000-6V00', 1,'1-2',1, 1)

  const { partId: gripComp1 } = await ins(dsId, v1, top1,      'GS110-88730-C', 2,'1-2',1, 1)
  await                          ins(dsId, v1, top1,      'GS131-21900-A', 2,'1-1',1, 2)
  await                          ins(dsId, v1, top1,      '35880-MAB30',   2,'2-2',1, 3)
  const { partId: lwrG1 } = await ins(dsId, v1, top1,      'GS119-34330',   2,'1-1',1, 4)
  await                          ins(dsId, v1, top1,      'GE400-01540-B', 2,'1-2',1, 5)
  await                          ins(dsId, v1, top1,      '78560-DAH80',   2,'2-2',1, 6)
  await                          ins(dsId, v1, top1,      'GS250-02000-A', 2,'1-2',1, 7)
  await                          ins(dsId, v1, top1,      'GK110-A0100',   2,'1-2',7, 8)
  await                          ins(dsId, v1, top1,      'GS139-16610',   2,'1-2',1, 9)

  const { partId: grip3_1 } = await ins(dsId, v1, gripComp1, 'GS110-88710-C', 3,'1-2',1, 1)
  await                              ins(dsId, v1, gripComp1, 'GS129-02340-A', 3,'1-1',3, 2)
  await                              ins(dsId, v1, lwrG1,     'GS119-34320',   3,'1-1',1, 1)

  const { partId: grip4_1 } = await ins(dsId, v1, grip3_1,   'GS111-21760-A', 4,'1-1',1, 1)
  const { partId: lswh1 }   = await ins(dsId, v1, grip3_1,   'GS113-57020-B', 4,'1-2',1, 2)
  await                              ins(dsId, v1, grip3_1,   'GS119-33430-C', 4,'1-2',1, 3)

  await ins(dsId, v1, grip4_1, 'GS120-10170-B', 5,'1-1',1, 1)
  await ins(dsId, v1, grip4_1, 'GS129-03810',   5,'1-1',1, 2)
  await ins(dsId, v1, lswh1,   'GS113-56980',   5,'1-2',1, 1)
  await ins(dsId, v1, lswh1,   'GS113-56990',   5,'1-2',1, 2)
  await ins(dsId, v1, lswh1,   'GS113-57000',   5,'1-2',1, 3)
  await ins(dsId, v1, lswh1,   'GS113-57010',   5,'1-2',1, 4)

  // ── Variant 2 (NH-1168L / Gray) ───────────────────────────────────────────
  const { partId: top2 } = await ins(dsId, v2, null, '78500-DA010-6Y00', 1,'1-2',1, 1)

  const { partId: gripComp2 } = await ins(dsId, v2, top2,      'GS110-89370-C', 2,'1-2',1, 1)
  await                          ins(dsId, v2, top2,      'GS131-21900-A', 2,'1-1',1, 2)
  await                          ins(dsId, v2, top2,      '35880-MAB30',   2,'2-2',1, 3)
  const { partId: lwrG2 } = await ins(dsId, v2, top2,      'GS119-34330',   2,'1-1',1, 4)
  await                          ins(dsId, v2, top2,      'GE400-01540-B', 2,'1-2',1, 5)
  await                          ins(dsId, v2, top2,      '78560-DAH80',   2,'2-2',1, 6)
  await                          ins(dsId, v2, top2,      'GS250-02000-A', 2,'1-2',1, 7)
  await                          ins(dsId, v2, top2,      'GK110-A0100',   2,'1-2',7, 8)
  await                          ins(dsId, v2, top2,      'GS139-16610',   2,'1-2',1, 9)

  const { partId: grip3_2 } = await ins(dsId, v2, gripComp2, 'GS110-89360-C', 3,'1-2',1, 1)
  await                              ins(dsId, v2, gripComp2, 'GS129-02340-A', 3,'1-1',3, 2)
  await                              ins(dsId, v2, lwrG2,     'GS119-34320',   3,'1-1',1, 1)

  const { partId: grip4_2 } = await ins(dsId, v2, grip3_2,   'GS111-21760-A', 4,'1-1',1, 1)
  const { partId: lswh2 }   = await ins(dsId, v2, grip3_2,   'GS113-57940-B', 4,'1-2',1, 2)
  await                              ins(dsId, v2, grip3_2,   'GS119-33430-C', 4,'1-2',1, 3)

  await ins(dsId, v2, grip4_2, 'GS120-10170-B', 5,'1-1',1, 1)
  await ins(dsId, v2, grip4_2, 'GS129-03810',   5,'1-1',1, 2)
  await ins(dsId, v2, lswh2,   'GS113-57900-A', 5,'1-2',1, 1)
  await ins(dsId, v2, lswh2,   'GS113-57910-A', 5,'1-2',1, 2)
  await ins(dsId, v2, lswh2,   'GS113-57920-A', 5,'1-2',1, 3)
  await ins(dsId, v2, lswh2,   'GS113-57930-A', 5,'1-2',1, 4)
}
