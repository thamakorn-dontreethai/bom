-- ════════════════════════════════════════════════════════════════════════════
-- Migration 001 — Add BOM document columns to existing tables
-- Run against an existing tg_steering_wheel database that already has data.
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks).
-- ════════════════════════════════════════════════════════════════════════════

SET search_path TO tg, public;
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.  tg.design_spec — event-issue & concern checkboxes
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tg.design_spec
  ADD COLUMN IF NOT EXISTS evt_first_issue     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_cv              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_mq              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_dan             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_hin             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS evt_sop             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS concern_drawing     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS concern_actual_part BOOLEAN NOT NULL DEFAULT FALSE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2.  tg.bom — price, material cost, supplier, logistics, remark
-- ─────────────────────────────────────────────────────────────────────────────

-- Price / pcs, kgs (baht)
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS price_part      NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS price_gate      NUMERIC(14,4);

-- Material cost / unit (baht) — columns 1-5
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS mat_cost_1      NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS mat_cost_2      NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS mat_cost_3      NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS mat_cost_4      NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS mat_cost_5      NUMERIC(14,4);

-- Supplier (M/C, T/T, Local, Import)
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS supplier_mc     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supplier_tt     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supplier_local  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supplier_import VARCHAR(100);

-- Logistics
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS receiver        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS internal_code   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS qty_kanban      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS lead_time_days  SMALLINT;

-- Remark
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS remark          TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3.  tg.bom_revision — NEW table for footer revision record
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tg.bom_revision (
  revision_id      SERIAL      PRIMARY KEY,
  design_spec_id   INT         NOT NULL REFERENCES tg.design_spec ON DELETE CASCADE,
  sort_order       SMALLINT    NOT NULL DEFAULT 0,

  mark             VARCHAR(5),        -- '–', 'A', 'B' …
  revision_record  VARCHAR(200),      -- 'First issue', 'Added ECU bracket' …
  eci_no           VARCHAR(20),       -- '26A376'
  revision_date    DATE,
  revisioner       VARCHAR(100),
  approved_by      VARCHAR(100),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'tg'
      AND tablename  = 'bom_revision'
      AND indexname  = 'bom_revision_design_spec_id_sort_order_idx'
  ) THEN
    CREATE INDEX bom_revision_design_spec_id_sort_order_idx
      ON tg.bom_revision (design_spec_id, sort_order);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.  Seed first-issue revision rows for every existing design_spec
--     that doesn't already have a revision record.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO tg.bom_revision (design_spec_id, sort_order, mark, revision_record,
                              eci_no, revision_date, revisioner, approved_by)
SELECT
  ds.design_spec_id,
  0,
  '–',
  'First issue',
  ds.internal_eci_no,
  ds.effective_date,
  ds.prepared_by,
  ds.approved_by
FROM tg.design_spec ds
WHERE NOT EXISTS (
  SELECT 1 FROM tg.bom_revision br
  WHERE br.design_spec_id = ds.design_spec_id
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5.  Helper view (replace if already exists)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW tg.v_bom_header AS
SELECT
  ds.design_spec_id                              AS id,
  m.model_code                                   AS model,
  m.model_name,
  ds.customer_part_no,
  ds.tg_part_no,
  ds.internal_eci_no,
  ds.type,
  ds.production_level,
  ds.initial_stage                               AS control_rank,
  ds.reg_certif,
  to_char(ds.effective_date, 'DD-Mon-YY')        AS date,
  c.customer_code                                AS customer,
  c.customer_name,
  ds.customer_standard,
  ds.tg_standard,
  ds.prepared_by,
  ds.checked_by,
  ds.approved_by,
  ds.confirmed_by,
  ds.evt_first_issue,
  ds.evt_cv,
  ds.evt_mq,
  ds.evt_sop,
  ds.concern_drawing,
  ds.concern_actual_part,
  ds.concern_purchase_part
FROM tg.design_spec ds
JOIN tg.model    m ON m.model_id    = ds.model_id
JOIN tg.customer c ON c.customer_id = ds.customer_id;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Summary of changes
-- ════════════════════════════════════════════════════════════════════════════
-- tg.design_spec  +7 columns  (evt_*, concern_*)
-- tg.bom         +15 columns  (price_*, mat_cost_1-5, supplier_*, receiver,
--                               internal_code, qty_kanban, lead_time_days, remark)
-- tg.bom_revision  NEW table   (revision record footer)
-- tg.v_bom_header  NEW view    (flat header for API use)
-- ════════════════════════════════════════════════════════════════════════════
