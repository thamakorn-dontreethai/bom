-- migration_001: add evt/concern columns to design_spec + create bom_revision table + bom.status

-- 1. เพิ่ม columns ใน tg.design_spec
ALTER TABLE tg.design_spec
  ADD COLUMN IF NOT EXISTS evt_first_issue    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_cv             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_mq             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_dan            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_hin            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_sop            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS concern_drawing    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS concern_actual_part BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. สร้างตาราง tg.bom_revision
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
);

CREATE INDEX IF NOT EXISTS idx_bom_revision_ds
  ON tg.bom_revision(design_spec_id, sort_order);

-- 3. เพิ่ม status column ใน tg.bom (สำหรับ reconcile logic)
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

UPDATE tg.bom SET status = 'active' WHERE status IS NULL;
