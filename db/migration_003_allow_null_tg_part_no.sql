-- ════════════════════════════════════════════════════════════════════════════
-- Migration 003 — Remove unique constraint on tg.part(tg_part_no)
-- Run after migration_002.  Safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path TO tg, public;
BEGIN;

ALTER TABLE tg.part DROP CONSTRAINT IF EXISTS ux_part_tg_part_no;
DROP INDEX IF EXISTS tg.ux_part_tg_part_no;

COMMIT;
