-- ════════════════════════════════════════════════════════════════════════════
-- Migration 002 — BOM item revision / update-level tracking
-- Run after migration_001.  Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path TO tg, public;
BEGIN;

-- ─── 1. tg.bom — which update level introduced / last changed this row ───────
ALTER TABLE tg.bom
  ADD COLUMN IF NOT EXISTS update_level SMALLINT NOT NULL DEFAULT 0;

-- ─── 2. History of tg.bom part-number changes ────────────────────────────────
--   introduced_at  = the update_level at which this value was first shown
--                    (0 = original / first-issue)
--   superseded_at  = the update_level that replaced it
CREATE TABLE IF NOT EXISTS tg.bom_item_history (
  history_id           SERIAL      PRIMARY KEY,
  bom_id               INT         NOT NULL REFERENCES tg.bom ON DELETE CASCADE,
  introduced_at        SMALLINT    NOT NULL DEFAULT 0,
  superseded_at        SMALLINT    NOT NULL,
  old_tg_part_no       VARCHAR(50),
  old_customer_part_no VARCHAR(50),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'tg' AND tablename = 'bom_item_history'
      AND indexname = 'bih_bom_id_idx'
  ) THEN
    CREATE INDEX bih_bom_id_idx ON tg.bom_item_history (bom_id);
  END IF;
END $$;

-- ─── 3. tg.design_spec — TGT Part No. update level ───────────────────────────
ALTER TABLE tg.design_spec
  ADD COLUMN IF NOT EXISTS tgt_update_level SMALLINT NOT NULL DEFAULT 0;

-- ─── 4. History of tg.design_spec TGT Part No. changes ───────────────────────
CREATE TABLE IF NOT EXISTS tg.design_spec_tgt_history (
  history_id     SERIAL      PRIMARY KEY,
  design_spec_id INT         NOT NULL REFERENCES tg.design_spec ON DELETE CASCADE,
  introduced_at  SMALLINT    NOT NULL DEFAULT 0,
  superseded_at  SMALLINT    NOT NULL,
  old_tg_part_no VARCHAR(50),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'tg' AND tablename = 'design_spec_tgt_history'
      AND indexname = 'dth_ds_id_idx'
  ) THEN
    CREATE INDEX dth_ds_id_idx ON tg.design_spec_tgt_history (design_spec_id);
  END IF;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Summary
-- tg.bom                  +1 col   update_level
-- tg.bom_item_history      NEW     per-item part-no change history
-- tg.design_spec           +1 col  tgt_update_level
-- tg.design_spec_tgt_history NEW   TGT Part No. change history
-- ════════════════════════════════════════════════════════════════════════════
