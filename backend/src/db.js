const sql = require('mssql')

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME || 'bom',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
}

let pool = null

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config)
  }
  return pool
}

async function initDb() {
  const p = await getPool()

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='bom_headers' AND xtype='U')
    CREATE TABLE bom_headers (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      model      NVARCHAR(50)  NOT NULL,
      customer_part_no   NVARCHAR(100) NOT NULL,
      production_level   NVARCHAR(100),
      control_rank       NVARCHAR(20),
      reg_certif         NVARCHAR(50),
      date               NVARCHAR(20),
      customer           NVARCHAR(50),
      tg_part_no         NVARCHAR(100),
      customer_standards NVARCHAR(100),
      tg_standards       NVARCHAR(100),
      internal_eci_no    NVARCHAR(50),
      type               NVARCHAR(20),
      part_name          NVARCHAR(200),
      created_at         DATETIME DEFAULT GETDATE(),
      updated_at         DATETIME DEFAULT GETDATE()
    )
  `)

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='bom_items' AND xtype='U')
    CREATE TABLE bom_items (
      id                   INT IDENTITY(1,1) PRIMARY KEY,
      bom_id               INT NOT NULL REFERENCES bom_headers(id),
      parent_id            INT REFERENCES bom_items(id),
      sort_order           INT DEFAULT 0,
      key_code             NVARCHAR(10),
      level                INT,
      level_code           NVARCHAR(10),
      rc                   NVARCHAR(10),
      customer_part_no     NVARCHAR(100),
      tg_part_no           NVARCHAR(100),
      soc                  NVARCHAR(10),
      quantity             INT DEFAULT 1,
      pp_mold              NVARCHAR(20),
      mass_g               FLOAT,
      part_name            NVARCHAR(200) NOT NULL,
      product_standards    NVARCHAR(100),
      material_standards   NVARCHAR(100),
      use_portion          NVARCHAR(10),
      material_no          NVARCHAR(100),
      instruction_no       NVARCHAR(100),
      material_trade_name  NVARCHAR(200),
      material_type        NVARCHAR(100),
      color_no             NVARCHAR(50),
      color_tone           NVARCHAR(100),
      material_mass        FLOAT,
      sa                   NVARCHAR(100),
      note                 NVARCHAR(500),
      created_at           DATETIME DEFAULT GETDATE(),
      updated_at           DATETIME DEFAULT GETDATE()
    )
  `)

  const { recordset } = await p.request().query('SELECT COUNT(*) AS cnt FROM bom_headers')
  if (recordset[0].cnt === 0) {
    await seedData(p)
  }
}

async function seedData(p) {
  const headerResult = await p.request()
    .input('model', sql.NVarChar, '3GJ')
    .input('customer_part_no', sql.NVarChar, '78500-3DA-J110-M1')
    .input('production_level', sql.NVarChar, '3:SPECIAL ORDER')
    .input('control_rank', sql.NVarChar, 'C')
    .input('reg_certif', sql.NVarChar, 'None')
    .input('date', sql.NVarChar, '2026/02/02')
    .input('customer', sql.NVarChar, '6991')
    .input('tg_part_no', sql.NVarChar, '78500-DA000-6***')
    .input('customer_standards', sql.NVarChar, 'IN DRAWING')
    .input('tg_standards', sql.NVarChar, 'NO')
    .input('internal_eci_no', sql.NVarChar, '26A376')
    .input('type', sql.NVarChar, 'HE')
    .input('part_name', sql.NVarChar, 'WHEEL ASSY, STEERING')
    .query(`
      INSERT INTO bom_headers
        (model, customer_part_no, production_level, control_rank, reg_certif, date, customer, tg_part_no, customer_standards, tg_standards, internal_eci_no, type, part_name)
      OUTPUT INSERTED.id
      VALUES
        (@model, @customer_part_no, @production_level, @control_rank, @reg_certif, @date, @customer, @tg_part_no, @customer_standards, @tg_standards, @internal_eci_no, @type, @part_name)
    `)
  const bomId = headerResult.recordset[0].id

  async function ins(item) {
    const r = await p.request()
      .input('bom_id', sql.Int, bomId)
      .input('parent_id', sql.Int, item.parent_id ?? null)
      .input('sort_order', sql.Int, item.sort_order ?? 0)
      .input('key_code', sql.NVarChar, item.key_code ?? null)
      .input('level', sql.Int, item.level ?? null)
      .input('level_code', sql.NVarChar, item.level_code ?? null)
      .input('rc', sql.NVarChar, item.rc ?? null)
      .input('customer_part_no', sql.NVarChar, item.customer_part_no ?? null)
      .input('tg_part_no', sql.NVarChar, item.tg_part_no ?? null)
      .input('soc', sql.NVarChar, item.soc ?? null)
      .input('quantity', sql.Int, item.quantity ?? 1)
      .input('pp_mold', sql.NVarChar, item.pp_mold ?? null)
      .input('mass_g', sql.Float, item.mass_g ?? null)
      .input('part_name', sql.NVarChar, item.part_name)
      .input('product_standards', sql.NVarChar, item.product_standards ?? null)
      .input('material_standards', sql.NVarChar, item.material_standards ?? null)
      .input('use_portion', sql.NVarChar, item.use_portion ?? null)
      .input('material_no', sql.NVarChar, item.material_no ?? null)
      .input('instruction_no', sql.NVarChar, item.instruction_no ?? null)
      .input('material_trade_name', sql.NVarChar, item.material_trade_name ?? null)
      .input('material_type', sql.NVarChar, item.material_type ?? null)
      .input('color_no', sql.NVarChar, item.color_no ?? null)
      .input('color_tone', sql.NVarChar, item.color_tone ?? null)
      .input('material_mass', sql.Float, item.material_mass ?? null)
      .input('sa', sql.NVarChar, item.sa ?? null)
      .input('note', sql.NVarChar, item.note ?? null)
      .query(`
        INSERT INTO bom_items
          (bom_id, parent_id, sort_order, key_code, level, level_code, rc, customer_part_no, tg_part_no, soc, quantity, pp_mold, mass_g, part_name, product_standards, material_standards, use_portion, material_no, instruction_no, material_trade_name, material_type, color_no, color_tone, material_mass, sa, note)
        OUTPUT INSERTED.id
        VALUES
          (@bom_id, @parent_id, @sort_order, @key_code, @level, @level_code, @rc, @customer_part_no, @tg_part_no, @soc, @quantity, @pp_mold, @mass_g, @part_name, @product_standards, @material_standards, @use_portion, @material_no, @instruction_no, @material_trade_name, @material_type, @color_no, @color_tone, @material_mass, @sa, @note)
      `)
    return r.recordset[0].id
  }

  // === Key 1: NH-900L Black variant ===
  const id1 = await ins({
    key_code: '1', level: 1, level_code: '1-2', sort_order: 1,
    customer_part_no: '78500-3DA-J110-M1', tg_part_no: '78500-DA000-6V00',
    quantity: 1, mass_g: 1727, part_name: 'WHEEL ASSY, STEERING (N)',
    product_standards: 'IN DRAWING', material_standards: 'NO',
    note: '(N)HEATER AUDIO CRUISE LEATHER:NH-900L THREAD:EURO STITCH(NH-906L) TGT',
  })

  const id_gripComp1 = await ins({
    parent_id: id1, key_code: '1', level: 2, level_code: '1-2', sort_order: 1,
    customer_part_no: '78501-3DA-T700', tg_part_no: 'GS110-88730-C',
    quantity: 1, pp_mold: '1-2', mass_g: 1208, part_name: 'GRIP COMP (HE)',
    product_standards: 'NO', material_standards: 'NO',
    note: 'GRIP(HE) + LEATHER(NH-900L) + SPRING THREAD:NH-906L TGT',
  })

  const id_grip3 = await ins({
    parent_id: id_gripComp1, key_code: '1', level: 3, level_code: '1-2', sort_order: 1,
    tg_part_no: 'GS110-88710-C', quantity: 1, pp_mold: '1-2', mass_g: 1202,
    part_name: 'GRIP (HE)', product_standards: 'NO', material_standards: 'NO',
    use_portion: '#', material_trade_name: 'POLYESTER', material_type: 'POLYESTER',
    color_no: 'NH-906L', color_tone: 'THREAD CHARCOAL', material_mass: 0.3,
    note: 'GRIP(LH) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD:EURO(NH-906L) TGZH  #5 ACE CROWN(T262)',
  })

  const id_grip4 = await ins({
    parent_id: id_grip3, key_code: '1', level: 4, level_code: '1-1', sort_order: 1,
    tg_part_no: 'GS111-21760-A', quantity: 1, pp_mold: '1-1', mass_g: 977,
    part_name: 'GRIP (HE)', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    instruction_no: 'LEPU-SWPU-F32', material_type: 'PU', material_mass: 210,
    note: 'PU FORM FOR GRIP(HE) HA78 BEFORE LEATHER WRAPPED TGT',
  })

  await ins({
    parent_id: id_grip4, key_code: '1', level: 5, level_code: '1-1', sort_order: 1,
    tg_part_no: 'GS120-10170-B', quantity: 1, pp_mold: '1-1', mass_g: 677,
    part_name: 'HUB CORE', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    material_no: '5-10030-83000', material_type: 'Ingod', material_mass: 677, sa: 'JISH5303',
    note: '3FS Mg/AM60B MASS PRODUCTION(TGT)',
  })

  await ins({
    parent_id: id_grip4, key_code: '1', level: 5, level_code: '1-1', sort_order: 2,
    tg_part_no: 'GS129-03810', quantity: 1, pp_mold: '1-1', mass_g: 90,
    part_name: 'WEIGHT', use_portion: '#', material_trade_name: 'Fe', material_mass: 90, sa: 'SWRM10',
    note: 'MATERIAL:Fe 6H SIDE TGT',
  })

  const id_leather1 = await ins({
    parent_id: id_grip3, key_code: '1', level: 4, level_code: '1-2', sort_order: 2,
    tg_part_no: 'GS113-57020-B', quantity: 1, pp_mold: '1-2', mass_g: 116,
    part_name: 'LEATHER, STEERING WHEEL', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    use_portion: '#', color_tone: 'BLACK', material_mass: 0.1,
    note: '(HE)SYNTHETIC LEATHER LOOP(NH-900L) MIDORI THREAD(EURO):NH-906L TGT  #20',
  })

  for (const [n, tg, mass] of [['NO.1','GS113-56980',46],['NO.2','GS113-56990',21],['NO.3','GS113-57000',21],['NO.4','GS113-57010',27]]) {
    await ins({
      parent_id: id_leather1, key_code: '1', level: 5, level_code: '1-2',
      tg_part_no: tg, quantity: 1, pp_mold: '1-2', mass_g: mass,
      part_name: `LEATHER ${n}`, product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
      material_no: '9-78301-C1001', material_trade_name: 'Synth. leather',
      color_no: 'NH-900L', color_tone: 'NEUTRAL BLACK', material_mass: mass,
      note: '(HE)SYNTHETIC LEATHER (NH-900L) MIDORI TGT',
    })
  }

  await ins({
    parent_id: id_grip3, key_code: '1', level: 4, level_code: '1-2', sort_order: 3,
    tg_part_no: 'GS119-33430-C', quantity: 1, pp_mold: '1-2', mass_g: 86,
    part_name: 'HEATER PAD ASSY', product_standards: 'NO', material_standards: 'NO',
    note: 'KURABE HEATER PAD 3FS/3FR',
  })

  await ins({
    parent_id: id_gripComp1, key_code: '1', level: 3, level_code: '1-1', sort_order: 2,
    tg_part_no: 'GS129-02340-A', quantity: 3, pp_mold: '1-1', mass_g: 2.1,
    part_name: 'SNAP SPRING', product_standards: 'NO', material_standards: 'NO',
    use_portion: '#', material_mass: 2.1, sa: 'JISG3522',
    note: 'GS129-01530 IS AVAILABLE,TOO. 11MY_SNAP_SPRING_φ2.0 Thai',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '1-1', sort_order: 2,
    tg_part_no: 'GS131-21900-A', quantity: 1, pp_mold: '1-1', mass_g: 86,
    part_name: 'BODY COVER (WITH PDL)', product_standards: 'NO', material_standards: 'NO',
    material_no: '3-S1078-01001', material_trade_name: 'TBJ4H-MF', material_type: 'PP',
    color_no: 'NH-900L', color_tone: 'Black', material_mass: 86,
    note: '3GJ BODY COVER TGT',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '2-2', sort_order: 3,
    customer_part_no: '35880-3MA-B310-M1', tg_part_no: '35880-MAB30',
    quantity: 1, pp_mold: '2-2', mass_g: 263, part_name: 'SW ASSY, STRG',
    product_standards: 'NO', material_standards: 'NO', note: 'HM SUPPLY PARTS',
  })

  const id_lwrGarnish = await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '1-1', sort_order: 4,
    tg_part_no: 'GS119-34330', quantity: 1, pp_mold: '1-1', mass_g: 11.1,
    part_name: 'LWR GARNISH', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    material_no: '3GJ-S/W-001', color_no: 'NH-892L', color_tone: 'MIRROR BLACK', material_mass: 0.1,
    note: 'PAINT NH-892L TGT',
  })

  await ins({
    parent_id: id_lwrGarnish, key_code: '1-2', level: 3, level_code: '1-1', sort_order: 1,
    tg_part_no: 'GS119-34320', quantity: 1, pp_mold: '1-1', mass_g: 11,
    part_name: 'LWR GARNISH', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    material_no: '3-84042-01001', material_trade_name: 'TOYOLAC PX10-X07', material_type: 'PC+ABS',
    color_no: 'BLACK', color_tone: 'Black', material_mass: 11,
    note: 'LWR GNSH PC+ABS BEFORE PAINTING (Black)TGT',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '1-2', sort_order: 5,
    customer_part_no: '78550-3MA-A113-M1', tg_part_no: 'GE400-01540-B',
    quantity: 1, pp_mold: '1-2', mass_g: 36, part_name: 'ASSY, HSW ECU',
    product_standards: 'NO', material_standards: 'NO', note: '3FS ECU',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '2-2', sort_order: 6,
    customer_part_no: '78560-3DA-H810-M1', tg_part_no: '78560-DAH80',
    quantity: 1, pp_mold: '2-2', mass_g: 100, part_name: 'SW ASSY, PADDLE SHIFT',
    product_standards: 'NO', material_standards: 'NO', note: 'PDL ASSY/HM SUPPLY PARTS',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '1-2', sort_order: 7,
    customer_part_no: '77902-3MA-A111-M1', tg_part_no: 'GS250-02000-A',
    quantity: 1, pp_mold: '1-2', mass_g: 9, part_name: 'CORD HSW SUB',
    product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    note: 'HE POWER HARNESS, FUJIKURA (TGT)',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '1-2', sort_order: 8,
    customer_part_no: '93893-04012-17', tg_part_no: 'GK110-A0100', soc: '*',
    quantity: 7, pp_mold: '1-2', mass_g: 2, part_name: 'SCREW-WASH, 4X12',
    product_standards: 'NO', material_standards: 'NO', note: 'SCREW-WASH, 4X12',
  })

  await ins({
    parent_id: id1, key_code: '1-2', level: 2, level_code: '1-2', sort_order: 9,
    tg_part_no: 'GS139-16610', quantity: 1, pp_mold: '1-2', mass_g: 0.1,
    part_name: 'SEAL', use_portion: '#', material_trade_name: 'ADHESION SHEET', material_type: 'PAPER', material_mass: 0.1,
  })

  // === Key 2: NH-1168L Light Soft Gray variant ===
  const id2 = await ins({
    key_code: '2', level: 1, level_code: '1-2', sort_order: 2,
    customer_part_no: '78500-3DA-J310-M1', tg_part_no: '78500-DA010-6Y00',
    quantity: 1, mass_g: 1727, part_name: 'WHEEL ASSY, STEERING (C)',
    product_standards: 'IN DRAWING', material_standards: 'NO',
    note: '(C)HEATER AUDIO CRUISE LEATHER:NH-1168L THREAD:EURO STITCH(NH-802L) TG',
  })

  const id_gripComp2 = await ins({
    parent_id: id2, key_code: '2', level: 2, level_code: '1-2', sort_order: 1,
    customer_part_no: '78501-3DA-T900', tg_part_no: 'GS110-89370-C',
    quantity: 1, pp_mold: '1-2', mass_g: 1208, part_name: 'GRIP COMP (HE)',
    product_standards: 'NO', material_standards: 'NO',
    note: 'GRIP(HE) + LEATHER(NH-1168L) + SPRING THREAD:NH-802L TGT',
  })

  const id_grip3_2 = await ins({
    parent_id: id_gripComp2, key_code: '2', level: 3, level_code: '1-2', sort_order: 1,
    tg_part_no: 'GS110-89360-C', quantity: 1, pp_mold: '1-2', mass_g: 1202,
    part_name: 'GRIP (HE)', product_standards: 'NO', material_standards: 'NO',
    use_portion: '#', material_trade_name: 'POLYESTER', material_type: 'POLYESTER',
    color_no: 'NH-802L', color_tone: 'LIGHT JEWEL GRAY', material_mass: 0.3,
    note: 'GRIP(HE) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD:EURO(NH-802L) TGT  #5 ACE CROWN(H802)',
  })

  const id_grip4_2 = await ins({
    parent_id: id_grip3_2, key_code: '2', level: 4, level_code: '1-1', sort_order: 1,
    tg_part_no: 'GS111-21760-A', quantity: 1, pp_mold: '1-1', mass_g: 977,
    part_name: 'GRIP (HE)', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    material_no: 'LEPU-SWPU-F32', material_type: 'PU', material_mass: 210,
    note: 'PU FORM FOR GRIP(HE) HA78 BEFORE LEATHER WRAPPED TGT',
  })

  await ins({
    parent_id: id_grip4_2, key_code: '2', level: 5, level_code: '1-1', sort_order: 1,
    tg_part_no: 'GS120-10170-B', quantity: 1, pp_mold: '1-1', mass_g: 677,
    part_name: 'HUB CORE', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    material_no: '5-10030-83000', material_type: 'Ingod', material_mass: 677, sa: 'JISH5303',
    note: '3FS Mg/AM60B MASS PRODUCTION(TGT)',
  })

  await ins({
    parent_id: id_grip4_2, key_code: '2', level: 5, level_code: '1-1', sort_order: 2,
    tg_part_no: 'GS129-03810', quantity: 1, pp_mold: '1-1', mass_g: 90,
    part_name: 'WEIGHT', use_portion: '#', material_trade_name: 'Fe', material_mass: 90, sa: 'SWRM10',
    note: 'MATERIAL:Fe 6H SIDE TGT',
  })

  const id_leather2 = await ins({
    parent_id: id_grip3_2, key_code: '2', level: 4, level_code: '1-2', sort_order: 2,
    tg_part_no: 'GS113-57940-B', quantity: 1, pp_mold: '1-2', mass_g: 116,
    part_name: 'LEATHER, STEERING WHEEL', product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
    use_portion: '#', color_tone: 'GRAY', material_mass: 0.1,
    note: '(HE)SYNTHETIC LEATHER LOOP(NH-1168L) MIDORI THREAD(EURO):NH-802L TGT  #20',
  })

  for (const [n, tg, mass] of [['NO.1','GS113-57900-A',46],['NO.2','GS113-57910-A',21],['NO.3','GS113-57920-A',21],['NO.4','GS113-57930-A',27]]) {
    await ins({
      parent_id: id_leather2, key_code: '2', level: 5, level_code: '1-2',
      tg_part_no: tg, quantity: 1, pp_mold: '1-2', mass_g: mass,
      part_name: `LEATHER ${n}`, product_standards: 'IN DRAWING', material_standards: 'IN DRAWING',
      material_no: '9-78301-C1002', material_trade_name: 'Synth. leather',
      color_no: 'NH-1168L', color_tone: 'LIGHT SOFT GRAY', material_mass: mass,
      note: '(HE)SYNTHETIC LEATHER (NH-1168L) MIDORI TGT',
    })
  }

  await ins({
    parent_id: id_grip3_2, key_code: '2', level: 4, level_code: '1-2', sort_order: 3,
    tg_part_no: 'GS119-33430-C', quantity: 1, pp_mold: '1-2', mass_g: 86,
    part_name: 'HEATER PAD ASSY', product_standards: 'NO', material_standards: 'NO',
    note: 'KURABE HEATER PAD 3FS/3FR',
  })

  await ins({
    parent_id: id_gripComp2, key_code: '2', level: 3, level_code: '1-1', sort_order: 2,
    tg_part_no: 'GS129-02340-A', quantity: 3, pp_mold: '1-1', mass_g: 2.1,
    part_name: 'SNAP SPRING', product_standards: 'NO', material_standards: 'NO',
    use_portion: '#', material_mass: 2.1, sa: 'JISG3522',
    note: 'GS129-01530 IS AVAILABLE,TOO. 11MY_SNAP_SPRING_φ2.0 Thai',
  })
}

module.exports = { getPool, initDb, sql }
