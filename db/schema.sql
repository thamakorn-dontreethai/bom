-- ════════════════════════════════════════════════════════════════════════════
-- BOM Management System — Full PostgreSQL Schema
-- Matches "BOM 3GJ HE.pdf" document layout  (A3 landscape)
-- Database: tg_steering_wheel
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS tg;
SET search_path TO tg, public;

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast ILIKE search on part names

-- ════════════════════════════════════════════════════════════════════════════
-- REFERENCE / LOOKUP TABLES
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE tg.customer (
  customer_id   SERIAL       PRIMARY KEY,
  customer_code VARCHAR(20)  NOT NULL UNIQUE,
  customer_name VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE tg.customer IS 'Customer master — e.g. HATC, HONDA';

CREATE TABLE tg.model (
  model_id    SERIAL       PRIMARY KEY,
  model_code  VARCHAR(20)  NOT NULL UNIQUE,   -- e.g. 3GJ
  model_name  VARCHAR(100) NOT NULL,           -- e.g. AVANCIER
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE tg.material_type (
  material_type_id SERIAL      PRIMARY KEY,
  type_code        VARCHAR(20) NOT NULL UNIQUE,
  type_name        VARCHAR(100)
);

CREATE TABLE tg.color (
  color_id   SERIAL      PRIMARY KEY,
  color_code VARCHAR(20) NOT NULL UNIQUE,   -- e.g. NH-900L
  color_name VARCHAR(100),
  color_tone VARCHAR(50)                    -- e.g. Black, Light Soft Gray
);

-- Variant = leather colour key (Key 1 = Black NH-900L, Key 2 = Gray NH-1168L)
CREATE TABLE tg.product_variant (
  variant_id       SERIAL      PRIMARY KEY,
  design_spec_id   INT,
  variant_key      SMALLINT    NOT NULL,
  variant_name     VARCHAR(100),
  customer_part_no VARCHAR(50),
  tg_part_no       VARCHAR(50),
  part_name        VARCHAR(200),
  mass_gram        NUMERIC(10,3)
);


-- ════════════════════════════════════════════════════════════════════════════
-- PARTS MASTER
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE tg.part (
  part_id               SERIAL        PRIMARY KEY,
  tg_part_no            VARCHAR(50),                    -- TG internal part number
  customer_part_no      VARCHAR(50),
  part_name             VARCHAR(200)  NOT NULL,

  -- Physical properties
  mass_gram             NUMERIC(10,3),                  -- Weight (g./pc.)

  -- Material & standards
  material_no           VARCHAR(50),                    -- Internal material number
  material_trade_name   VARCHAR(100),                   -- Brand/trade name
  product_standard      VARCHAR(200),                   -- Product Std (e.g. JASO T003)
  material_standard     VARCHAR(200),                   -- Material Std
  jis_standard          VARCHAR(100),                   -- JIS / SA standard

  -- Classification
  material_type_id      INT           REFERENCES tg.material_type,
  color_id              INT           REFERENCES tg.color,

  -- Flags
  is_purchased_material BOOLEAN       NOT NULL DEFAULT FALSE,  -- '#' mark
  reg_certif_required   BOOLEAN       NOT NULL DEFAULT FALSE,  -- '%' mark
  soc_flag              BOOLEAN       NOT NULL DEFAULT FALSE,   -- SOC badge

  notes                 TEXT,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ON tg.part (tg_part_no);
CREATE INDEX ON tg.part USING gin (part_name gin_trgm_ops);


-- ════════════════════════════════════════════════════════════════════════════
-- DOCUMENT HEADER  (one row = one Design Specification / ECI)
-- Maps to the top header block of the BOM PDF
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE tg.design_spec (
  design_spec_id   SERIAL      PRIMARY KEY,

  -- Foreign keys
  model_id         INT         NOT NULL REFERENCES tg.model,
  customer_id      INT         NOT NULL REFERENCES tg.customer,

  -- Part identification
  customer_part_no VARCHAR(50),                         -- Customer Part No.
  tg_part_no       VARCHAR(50),                         -- TGT Part No. (top assembly)

  -- Document identification
  internal_eci_no  VARCHAR(20),                         -- ECI No. — used for PDF import lookup
  type             VARCHAR(10) NOT NULL DEFAULT 'HE',   -- Type field (e.g. HE, LE)
  production_level VARCHAR(20),
  initial_stage    VARCHAR(20),                         -- Initial Stage / control rank
  reg_certif       VARCHAR(50),

  -- Date — updated to CURRENT_DATE each time the PDF is imported
  effective_date   DATE,

  -- ── Event issue checkboxes (header left panel) ───────────────────────────
  evt_first_issue   BOOLEAN NOT NULL DEFAULT FALSE,
  evt_cv            BOOLEAN NOT NULL DEFAULT FALSE,
  evt_mq            BOOLEAN NOT NULL DEFAULT FALSE,
  evt_sop           BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Concern with checkboxes ───────────────────────────────────────────────
  concern_drawing         BOOLEAN NOT NULL DEFAULT FALSE,   -- Drawing : Rev. –
  concern_actual_part     BOOLEAN NOT NULL DEFAULT FALSE,   -- Actual Part : stage
  concern_purchase_part   BOOLEAN NOT NULL DEFAULT FALSE,   -- Purchase Part control

  -- ── Authorship (sign block) ───────────────────────────────────────────────
  prepared_by    VARCHAR(100),   -- Revisioner on first-issue row
  checked_by     VARCHAR(100),
  approved_by    VARCHAR(100),   -- Approved on first-issue row
  confirmed_by   VARCHAR(100),

  -- Standards
  customer_standard VARCHAR(200),
  tg_standard       VARCHAR(200),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ON tg.design_spec (internal_eci_no) WHERE internal_eci_no IS NOT NULL;
COMMENT ON COLUMN tg.design_spec.effective_date
  IS 'Set to CURRENT_DATE by the import route each time a PDF is imported';


-- ════════════════════════════════════════════════════════════════════════════
-- BOM DOCUMENT  (one per design_spec; separates print-time metadata)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE tg.bom_document (
  bom_doc_id      SERIAL      PRIMARY KEY,
  design_spec_id  INT         NOT NULL REFERENCES tg.design_spec ON DELETE CASCADE,
  type            VARCHAR(10) NOT NULL DEFAULT 'HE',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════════════════════
-- BOM LINES
-- One row = one part at one indentation level in the printed table.
-- Hierarchy: bom_level 1–5 mirrors Part No. columns 1–5 in the PDF.
-- Parent/child links are stored via parent_part_id + child_part_id.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE tg.bom (
  bom_id           SERIAL       PRIMARY KEY,
  design_spec_id   INT          NOT NULL REFERENCES tg.design_spec ON DELETE CASCADE,
  variant_id       INT          REFERENCES tg.product_variant,   -- NULL = all keys
  parent_part_id   INT          REFERENCES tg.part,              -- NULL = root level
  child_part_id    INT          NOT NULL REFERENCES tg.part,

  -- Hierarchy
  bom_level        SMALLINT     NOT NULL CHECK (bom_level BETWEEN 1 AND 6),
  level_code       VARCHAR(20),       -- pp_mold / level code printed in some columns
  sort_order       INT          NOT NULL DEFAULT 0,

  -- Core quantity
  quantity         NUMERIC(12,4) NOT NULL DEFAULT 1,             -- Q'ty (pcs.)

  -- ── Price / pcs, kgs (baht) ──────────────────────────────────────────────
  price_part       NUMERIC(14,4),    -- "Part" price column
  price_gate       NUMERIC(14,4),    -- "Gate" price column

  -- ── Material cost / unit (baht) — 5 stage columns ────────────────────────
  mat_cost_1       NUMERIC(14,4),
  mat_cost_2       NUMERIC(14,4),
  mat_cost_3       NUMERIC(14,4),
  mat_cost_4       NUMERIC(14,4),
  mat_cost_5       NUMERIC(14,4),

  -- ── Supplier (4 columns) ─────────────────────────────────────────────────
  supplier_mc      VARCHAR(100),    -- M/C  (Machine/Company)
  supplier_tt      VARCHAR(100),    -- T/T  (Transit Time?)
  supplier_local   VARCHAR(100),    -- Local
  supplier_import  VARCHAR(100),    -- Import

  -- ── Logistics ────────────────────────────────────────────────────────────
  receiver         VARCHAR(50),     -- Recie-ver column
  internal_code    VARCHAR(50),     -- Internal Code column
  qty_kanban       NUMERIC(12,2),   -- Q'ty/kanban (pcs, kgs)
  lead_time_days   SMALLINT,        -- Lead time (day)

  -- ── Remark ───────────────────────────────────────────────────────────────
  remark           TEXT,

  -- ── Notes (overrides part.notes when set) ────────────────────────────────
  notes            TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON tg.bom (design_spec_id, sort_order);
CREATE INDEX ON tg.bom (child_part_id);
CREATE INDEX ON tg.bom (parent_part_id);
CREATE INDEX ON tg.bom (variant_id);

COMMENT ON COLUMN tg.bom.bom_level
  IS 'Matches Part No. column 1-5 in the printed BOM table';
COMMENT ON COLUMN tg.bom.mat_cost_1
  IS 'Material cost/unit column 1 — corresponds to stage 1 cost breakout';
COMMENT ON COLUMN tg.bom.supplier_mc
  IS 'Supplier — M/C column (Machine/Contractor)';


-- ════════════════════════════════════════════════════════════════════════════
-- REVISION RECORD  (footer table in BOM PDF, below the main BOM table)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE tg.bom_revision (
  revision_id      SERIAL       PRIMARY KEY,
  design_spec_id   INT          NOT NULL REFERENCES tg.design_spec ON DELETE CASCADE,
  sort_order       SMALLINT     NOT NULL DEFAULT 0,   -- row order in revision table

  mark             VARCHAR(5),        -- e.g. '–' (first issue), 'A', 'B'
  revision_record  VARCHAR(200),      -- e.g. 'First issue', 'Added ECU bracket'
  eci_no           VARCHAR(20),       -- e.g. '26A376'
  revision_date    DATE,              -- e.g. 2026-02-18
  revisioner       VARCHAR(100),      -- e.g. 'Weeraphol L.'
  approved_by      VARCHAR(100),      -- e.g. 'Athiwat C.'

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON tg.bom_revision (design_spec_id, sort_order);

COMMENT ON TABLE tg.bom_revision
  IS 'Revision record table printed in the footer of each BOM page';


-- ════════════════════════════════════════════════════════════════════════════
-- HELPER VIEW  (mirrors the SELECT in bom.js for easy ad-hoc queries)
-- ════════════════════════════════════════════════════════════════════════════

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
  -- Event issue flags
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

COMMENT ON VIEW tg.v_bom_header IS 'Flat header view used by /api/bom endpoints';
