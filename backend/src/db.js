import pg from 'pg'
import bcrypt from 'bcryptjs'
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
  // migration_001 — run every start (all statements are idempotent)
  await pool.query(`
    ALTER TABLE tg.design_spec
      ADD COLUMN IF NOT EXISTS evt_first_issue     BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS evt_cv              BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS evt_mq              BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS evt_dan             BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS evt_hin             BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS evt_sop             BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS concern_drawing     BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS concern_actual_part BOOLEAN NOT NULL DEFAULT FALSE
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.bom_revision (
      revision_id     BIGSERIAL PRIMARY KEY,
      design_spec_id  BIGINT NOT NULL REFERENCES tg.design_spec(design_spec_id) ON DELETE CASCADE,
      sort_order      SMALLINT NOT NULL DEFAULT 0,
      mark            VARCHAR(20),
      revision_record TEXT,
      eci_no          VARCHAR(50),
      revision_date   DATE,
      revisioner      VARCHAR(100),
      approved_by     VARCHAR(100)
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bom_revision_ds
      ON tg.bom_revision(design_spec_id, sort_order)
  `)
  await pool.query(`
    ALTER TABLE tg.bom ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
  `)
  await pool.query(`UPDATE tg.bom SET status='active' WHERE status IS NULL`)

  // migration_002 — bom revision history + tgt part no history
  await pool.query(`
    ALTER TABLE tg.bom
      ADD COLUMN IF NOT EXISTS update_level SMALLINT NOT NULL DEFAULT 0
  `)
  await pool.query(`
    ALTER TABLE tg.design_spec
      ADD COLUMN IF NOT EXISTS tgt_update_level SMALLINT NOT NULL DEFAULT 0
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.bom_item_history (
      id                  BIGSERIAL PRIMARY KEY,
      bom_id              BIGINT NOT NULL REFERENCES tg.bom(bom_id) ON DELETE CASCADE,
      introduced_at       SMALLINT NOT NULL DEFAULT 0,
      superseded_at       SMALLINT NOT NULL DEFAULT 0,
      old_tg_part_no      VARCHAR(100),
      old_customer_part_no VARCHAR(100)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.design_spec_tgt_history (
      id              BIGSERIAL PRIMARY KEY,
      design_spec_id  BIGINT NOT NULL REFERENCES tg.design_spec(design_spec_id) ON DELETE CASCADE,
      introduced_at   SMALLINT NOT NULL DEFAULT 0,
      superseded_at   SMALLINT NOT NULL DEFAULT 0,
      old_tg_part_no  VARCHAR(100)
    )
  `)

  // migration_004 — part image + allow null tg_part_no for manually-added parts
  await pool.query(`ALTER TABLE tg.part ADD COLUMN IF NOT EXISTS image_url TEXT`)
  await pool.query(`ALTER TABLE tg.part ALTER COLUMN tg_part_no DROP NOT NULL`)

  // migration_005 — store original PDF file per design_spec
  await pool.query(`ALTER TABLE tg.design_spec ADD COLUMN IF NOT EXISTS pdf_url TEXT`)

  // migration_005b — customer name override for display
  await pool.query(`ALTER TABLE tg.design_spec ADD COLUMN IF NOT EXISTS customer_name_override TEXT`)

  // migration_005d — BOM group classification
  await pool.query(`ALTER TABLE tg.design_spec ADD COLUMN IF NOT EXISTS bom_group VARCHAR(50)`)

  // migration_005e — allow bom_level up to 6 (for BAG products)
  await pool.query(`
    ALTER TABLE tg.bom DROP CONSTRAINT IF EXISTS bom_bom_level_check
  `)
  await pool.query(`
    ALTER TABLE tg.bom ADD CONSTRAINT bom_bom_level_check CHECK (bom_level BETWEEN 1 AND 6)
  `)

  // migration_005c — per-revision PDF url
  await pool.query(`ALTER TABLE tg.bom_revision ADD COLUMN IF NOT EXISTS pdf_url TEXT`)

  // migration_008 — snapshot columns so revised_out rows keep their original part_name/mass_gram
  // and insert-after rows can store row-level overrides without touching shared tg.part
  await pool.query(`
    ALTER TABLE tg.bom
      ADD COLUMN IF NOT EXISTS snapshot_part_name TEXT,
      ADD COLUMN IF NOT EXISTS snapshot_mass_gram NUMERIC,
      ADD COLUMN IF NOT EXISTS snapshot_image_url TEXT
  `)

  // migration_011 — free-text gate (runner/sprue) weight per BOM row
  await pool.query(`ALTER TABLE tg.bom ADD COLUMN IF NOT EXISTS gate TEXT`)

  // migration_009 — freeze per-row display values for all existing rows.
  // COALESCE fills null slots only; existing snapshots are never overwritten.
  // image_url: restore from tg.part for rows that have no explicit upload yet.
  // Going forward, new uploads write to snapshot only (tg.part is no longer mutated).
  await pool.query(`
    UPDATE tg.bom b
    SET snapshot_part_name = COALESCE(b.snapshot_part_name, p.part_name),
        snapshot_mass_gram = COALESCE(b.snapshot_mass_gram, p.mass_gram),
        snapshot_image_url = COALESCE(b.snapshot_image_url, p.image_url)
    FROM tg.part p
    WHERE b.child_part_id = p.part_id
  `)

  // migration_010 — image upload history per BOM row
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.bom_image_history (
      id          BIGSERIAL PRIMARY KEY,
      bom_id      BIGINT NOT NULL REFERENCES tg.bom(bom_id) ON DELETE CASCADE,
      image_url   TEXT NOT NULL,
      replaced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_bom_img_hist_bom
      ON tg.bom_image_history(bom_id, replaced_at DESC)
  `)

  // migration_011 — extend history with full data snapshot
  await pool.query(`
    ALTER TABLE tg.bom_image_history
      ADD COLUMN IF NOT EXISTS event_type VARCHAR(30),
      ADD COLUMN IF NOT EXISTS tg_part_no VARCHAR(100),
      ADD COLUMN IF NOT EXISTS part_name  TEXT,
      ADD COLUMN IF NOT EXISTS quantity   NUMERIC,
      ADD COLUMN IF NOT EXISTS mass_gram  NUMERIC,
      ADD COLUMN IF NOT EXISTS spec       TEXT
  `)

  // migration_007 — completion fields on tg.bom
  await pool.query(`
    ALTER TABLE tg.bom
      ADD COLUMN IF NOT EXISTS price_per_pc      NUMERIC(12,4),
      ADD COLUMN IF NOT EXISTS supplier          VARCHAR(20),
      ADD COLUMN IF NOT EXISTS lead_time_day     SMALLINT,
      ADD COLUMN IF NOT EXISTS completion_remark TEXT
  `)

  // migration_012 — extended completion + Part No. correction
  await pool.query(`
    ALTER TABLE tg.bom
      ADD COLUMN IF NOT EXISTS snapshot_tg_part_no TEXT,
      ADD COLUMN IF NOT EXISTS material_cost       NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS receiver            TEXT,
      ADD COLUMN IF NOT EXISTS internal_code       TEXT,
      ADD COLUMN IF NOT EXISTS kanban_qty          TEXT
  `)

  // migration_003 — approval tokens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.approval_tokens (
      id          BIGSERIAL PRIMARY KEY,
      token       VARCHAR(64) UNIQUE NOT NULL,
      bom_id      BIGINT NOT NULL,
      sent_to     VARCHAR(255) NOT NULL,
      sent_at     TIMESTAMPTZ DEFAULT NOW(),
      approved_by VARCHAR(255),
      approved_at TIMESTAMPTZ,
      status      VARCHAR(20) DEFAULT 'pending'
    )
  `)

  // migration_006 — users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.users (
      id            BIGSERIAL PRIMARY KEY,
      username      VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          VARCHAR(20) NOT NULL DEFAULT 'purchase',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  // migration_013 — full name for users
  await pool.query(`ALTER TABLE tg.users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)`)

  // migration_014 — editable Model Name override on design_spec
  await pool.query(`ALTER TABLE tg.design_spec ADD COLUMN IF NOT EXISTS model_name_override VARCHAR(150)`)

  // migration_015 — audit: who created / last edited each BOM
  await pool.query(`
    ALTER TABLE tg.design_spec
      ADD COLUMN IF NOT EXISTS created_by VARCHAR(120),
      ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
  `)

  // migration_016 — saved "Part No. views": a filtered subset of a BOM under a given key
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.bom_view (
      id             BIGSERIAL PRIMARY KEY,
      design_spec_id BIGINT NOT NULL REFERENCES tg.design_spec(design_spec_id) ON DELETE CASCADE,
      key_code       VARCHAR(20),
      name           VARCHAR(150) NOT NULL,
      part_nos       TEXT[] NOT NULL DEFAULT '{}',
      created_by     VARCHAR(120),
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bom_view_ds ON tg.bom_view(design_spec_id)`)

  // migration_017 — activity log (admin timeline): login / import / delete etc.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.activity_log (
      id         BIGSERIAL PRIMARY KEY,
      user_name  VARCHAR(120),
      action     VARCHAR(40) NOT NULL,
      target     TEXT,
      detail     TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_created ON tg.activity_log(created_at DESC)`)

  // migration_018 — BOM version snapshots: a full copy of the BOM saved BEFORE each
  // revision, so old versions can be viewed (read-only) in the History tab.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg.bom_version (
      id             BIGSERIAL PRIMARY KEY,
      design_spec_id BIGINT NOT NULL,
      version_label  TEXT,
      eci_no         TEXT,
      snapshot       JSONB NOT NULL,
      created_by     VARCHAR(120),
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bom_version_ds ON tg.bom_version(design_spec_id, id DESC)`)

  // migration_019 — per-BOM custom Excel export template (uploaded blank form)
  await pool.query(`ALTER TABLE tg.design_spec ADD COLUMN IF NOT EXISTS custom_template_url TEXT`)

  // Seed a default admin if no admin exists yet (admin/admin1234)
  const { rows: adminRows } = await pool.query("SELECT COUNT(*) AS cnt FROM tg.users WHERE role='admin'")
  if (parseInt(adminRows[0].cnt) === 0) {
    const adminHash = await bcrypt.hash('admin1234', 10)
    await pool.query(
      `INSERT INTO tg.users (username, password_hash, role, full_name)
       VALUES ('admin', $1, 'admin', 'Administrator')
       ON CONFLICT (username) DO UPDATE SET role='admin'`,
      [adminHash]
    )
    console.log('Default admin created: admin / admin1234')
  }

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
  if (!dsRows.length) { console.log('Seed skipped: no design_spec found (import a PDF to create BOM data)'); return }
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
