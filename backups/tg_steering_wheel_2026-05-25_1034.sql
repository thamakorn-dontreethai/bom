--
-- PostgreSQL database dump
--

\restrict aBnlySRxCYRodNXlq1lwyZh7Yjzqa6oO4eDqOPvMkvADqe2Exga0y4M0WCceRvy

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: tg; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA tg;


ALTER SCHEMA tg OWNER TO postgres;

--
-- Name: fn_get_bom_tree(character varying); Type: FUNCTION; Schema: tg; Owner: postgres
--

CREATE FUNCTION tg.fn_get_bom_tree(p_tg_part_no character varying) RETURNS TABLE(bom_level integer, level_code character varying, quantity numeric, path text, tg_part_no character varying, customer_part_no character varying, part_name character varying, mass_gram numeric, notes text)
    LANGUAGE sql STABLE
    AS $$
    WITH RECURSIVE bom_tree AS (
        -- Anchor: direct children of the given parent part
        SELECT
            b.bom_id,
            b.bom_level,
            b.level_code,
            b.quantity,
            b.parent_part_id,
            b.child_part_id,
            cp.tg_part_no::TEXT AS path
        FROM tg.bom b
        JOIN tg.part cp ON b.child_part_id  = cp.part_id
        JOIN tg.part pp ON b.parent_part_id = pp.part_id
        WHERE pp.tg_part_no = p_tg_part_no

        UNION ALL

        -- Recursive: walk down the tree
        SELECT
            b2.bom_id,
            b2.bom_level,
            b2.level_code,
            b2.quantity,
            b2.parent_part_id,
            b2.child_part_id,
            (bt.path || ' > ' || cp2.tg_part_no)::TEXT
        FROM tg.bom b2
        JOIN bom_tree bt ON b2.parent_part_id = bt.child_part_id
        JOIN tg.part cp2 ON b2.child_part_id  = cp2.part_id
    )
    SELECT
        bt.bom_level,
        bt.level_code,
        bt.quantity,
        bt.path,
        p.tg_part_no,
        p.customer_part_no,
        p.part_name,
        p.mass_gram,
        p.notes
    FROM bom_tree bt
    JOIN tg.part p ON bt.child_part_id = p.part_id
    ORDER BY bt.path;
$$;


ALTER FUNCTION tg.fn_get_bom_tree(p_tg_part_no character varying) OWNER TO postgres;

--
-- Name: FUNCTION fn_get_bom_tree(p_tg_part_no character varying); Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON FUNCTION tg.fn_get_bom_tree(p_tg_part_no character varying) IS 'Recursive BOM tree – usage: SELECT * FROM tg.fn_get_bom_tree(''78500-DA000-6V00'')';


--
-- Name: fn_get_variant_bom(integer, integer); Type: FUNCTION; Schema: tg; Owner: postgres
--

CREATE FUNCTION tg.fn_get_variant_bom(p_design_spec_id integer, p_variant_key integer) RETURNS TABLE(bom_level integer, level_code character varying, quantity numeric, tg_part_no character varying, customer_part_no character varying, part_name character varying, mass_gram numeric, material_type character varying, color_code character varying, color_tone character varying, notes text)
    LANGUAGE sql STABLE
    AS $$
    SELECT
        b.bom_level,
        b.level_code,
        b.quantity,
        cp.tg_part_no,
        cp.customer_part_no,
        cp.part_name,
        cp.mass_gram,
        mt.type_code  AS material_type,
        co.color_code,
        co.color_tone,
        cp.notes
    FROM tg.bom b
    JOIN tg.part cp ON b.child_part_id = cp.part_id
    LEFT JOIN tg.material_type mt   ON cp.material_type_id = mt.material_type_id
    LEFT JOIN tg.color co           ON cp.color_id = co.color_id
    LEFT JOIN tg.product_variant pv ON b.variant_id = pv.variant_id
    WHERE b.design_spec_id = p_design_spec_id
      AND (b.variant_id IS NULL OR pv.variant_key = p_variant_key)
    ORDER BY b.bom_level, b.sort_order;
$$;


ALTER FUNCTION tg.fn_get_variant_bom(p_design_spec_id integer, p_variant_key integer) OWNER TO postgres;

--
-- Name: FUNCTION fn_get_variant_bom(p_design_spec_id integer, p_variant_key integer); Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON FUNCTION tg.fn_get_variant_bom(p_design_spec_id integer, p_variant_key integer) IS 'BOM for a specific variant – usage: SELECT * FROM tg.fn_get_variant_bom(1, 1)';


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: tg; Owner: postgres
--

CREATE FUNCTION tg.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION tg.fn_set_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: approval_tokens; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.approval_tokens (
    id bigint NOT NULL,
    token character varying(64) NOT NULL,
    bom_id bigint NOT NULL,
    sent_to character varying(255) NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    approved_by character varying(255),
    approved_at timestamp with time zone,
    status character varying(20) DEFAULT 'pending'::character varying
);


ALTER TABLE tg.approval_tokens OWNER TO postgres;

--
-- Name: approval_tokens_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.approval_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.approval_tokens_id_seq OWNER TO postgres;

--
-- Name: approval_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.approval_tokens_id_seq OWNED BY tg.approval_tokens.id;


--
-- Name: bom; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.bom (
    bom_id integer NOT NULL,
    design_spec_id integer NOT NULL,
    variant_id integer,
    parent_part_id integer,
    child_part_id integer NOT NULL,
    bom_level integer NOT NULL,
    level_code character varying(10),
    quantity numeric(10,4) DEFAULT 1 NOT NULL,
    sort_order integer,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    status character varying(20) DEFAULT 'active'::character varying,
    update_level smallint DEFAULT 0 NOT NULL
);


ALTER TABLE tg.bom OWNER TO postgres;

--
-- Name: TABLE bom; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.bom IS 'Multi-level BOM – supports recursive CTE traversal';


--
-- Name: bom_bom_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.bom_bom_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.bom_bom_id_seq OWNER TO postgres;

--
-- Name: bom_bom_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.bom_bom_id_seq OWNED BY tg.bom.bom_id;


--
-- Name: bom_document; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.bom_document (
    bom_doc_id integer NOT NULL,
    design_spec_id integer NOT NULL,
    document_date date,
    type character varying(10),
    customer_part_no character varying(50),
    tg_part_no_main character varying(50),
    tg_part_no_alt character varying(50),
    eci_no character varying(50),
    prepared_by character varying(100),
    approved_by character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.bom_document OWNER TO postgres;

--
-- Name: bom_document_bom_doc_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.bom_document_bom_doc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.bom_document_bom_doc_id_seq OWNER TO postgres;

--
-- Name: bom_document_bom_doc_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.bom_document_bom_doc_id_seq OWNED BY tg.bom_document.bom_doc_id;


--
-- Name: bom_item_history; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.bom_item_history (
    id bigint NOT NULL,
    bom_id bigint NOT NULL,
    introduced_at smallint DEFAULT 0 NOT NULL,
    superseded_at smallint DEFAULT 0 NOT NULL,
    old_tg_part_no character varying(100),
    old_customer_part_no character varying(100)
);


ALTER TABLE tg.bom_item_history OWNER TO postgres;

--
-- Name: bom_item_history_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.bom_item_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.bom_item_history_id_seq OWNER TO postgres;

--
-- Name: bom_item_history_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.bom_item_history_id_seq OWNED BY tg.bom_item_history.id;


--
-- Name: bom_line; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.bom_line (
    bom_line_id integer NOT NULL,
    bom_doc_id integer NOT NULL,
    col1_part_no character varying(50),
    col2_part_no character varying(50),
    col3_part_no character varying(50),
    col4_part_no character varying(50),
    col5_part_no character varying(50),
    part_id integer,
    part_name character varying(200),
    spec text,
    quantity numeric(10,4),
    weight_gram numeric(10,2),
    price_per_pcs numeric(12,4),
    material_cost numeric(12,4),
    supplier_id integer,
    is_local boolean,
    is_import boolean,
    recipe_code character varying(20),
    qty_per_kanban numeric(10,2),
    kanban_unit character varying(20),
    lead_time_days integer,
    remark text,
    sort_order integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.bom_line OWNER TO postgres;

--
-- Name: bom_line_bom_line_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.bom_line_bom_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.bom_line_bom_line_id_seq OWNER TO postgres;

--
-- Name: bom_line_bom_line_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.bom_line_bom_line_id_seq OWNED BY tg.bom_line.bom_line_id;


--
-- Name: bom_revision; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.bom_revision (
    revision_id bigint NOT NULL,
    design_spec_id bigint NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    mark character varying(20),
    revision_record text,
    eci_no character varying(50),
    revision_date date,
    revisioner character varying(100),
    approved_by character varying(100)
);


ALTER TABLE tg.bom_revision OWNER TO postgres;

--
-- Name: bom_revision_revision_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.bom_revision_revision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.bom_revision_revision_id_seq OWNER TO postgres;

--
-- Name: bom_revision_revision_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.bom_revision_revision_id_seq OWNED BY tg.bom_revision.revision_id;


--
-- Name: color; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.color (
    color_id integer NOT NULL,
    color_code character varying(30) NOT NULL,
    color_tone character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.color OWNER TO postgres;

--
-- Name: TABLE color; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.color IS 'Color codes used in leather, thread, and painted parts';


--
-- Name: color_color_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.color_color_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.color_color_id_seq OWNER TO postgres;

--
-- Name: color_color_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.color_color_id_seq OWNED BY tg.color.color_id;


--
-- Name: customer; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.customer (
    customer_id integer NOT NULL,
    customer_code character varying(20) NOT NULL,
    customer_name character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.customer OWNER TO postgres;

--
-- Name: TABLE customer; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.customer IS 'Customer master (e.g. HATC = Honda)';


--
-- Name: customer_customer_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.customer_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.customer_customer_id_seq OWNER TO postgres;

--
-- Name: customer_customer_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.customer_customer_id_seq OWNED BY tg.customer.customer_id;


--
-- Name: design_spec; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.design_spec (
    design_spec_id integer NOT NULL,
    model_id integer NOT NULL,
    customer_id integer NOT NULL,
    customer_part_no character varying(50) NOT NULL,
    tg_part_no character varying(50) NOT NULL,
    production_level character varying(50),
    initial_stage character varying(10),
    control_rank character varying(10),
    reg_certif character varying(50),
    customer_standard character varying(100),
    tg_standard character varying(50),
    internal_eci_no character varying(50),
    effective_date date,
    prepared_by character varying(100),
    checked_by character varying(100),
    approved_by character varying(100),
    confirmed_by character varying(100),
    page_total integer,
    is_confidential boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    evt_first_issue boolean DEFAULT false NOT NULL,
    evt_cv boolean DEFAULT false NOT NULL,
    evt_mq boolean DEFAULT false NOT NULL,
    evt_dan boolean DEFAULT false NOT NULL,
    evt_hin boolean DEFAULT false NOT NULL,
    evt_sop boolean DEFAULT false NOT NULL,
    concern_drawing boolean DEFAULT false NOT NULL,
    concern_actual_part boolean DEFAULT false NOT NULL,
    tgt_update_level smallint DEFAULT 0 NOT NULL,
    pdf_url text,
    customer_name_override text
);


ALTER TABLE tg.design_spec OWNER TO postgres;

--
-- Name: TABLE design_spec; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.design_spec IS 'Design Specification Instruction header (5-1 to 5-5)';


--
-- Name: design_spec_design_spec_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.design_spec_design_spec_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.design_spec_design_spec_id_seq OWNER TO postgres;

--
-- Name: design_spec_design_spec_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.design_spec_design_spec_id_seq OWNED BY tg.design_spec.design_spec_id;


--
-- Name: design_spec_tgt_history; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.design_spec_tgt_history (
    id bigint NOT NULL,
    design_spec_id bigint NOT NULL,
    introduced_at smallint DEFAULT 0 NOT NULL,
    superseded_at smallint DEFAULT 0 NOT NULL,
    old_tg_part_no character varying(100)
);


ALTER TABLE tg.design_spec_tgt_history OWNER TO postgres;

--
-- Name: design_spec_tgt_history_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.design_spec_tgt_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.design_spec_tgt_history_id_seq OWNER TO postgres;

--
-- Name: design_spec_tgt_history_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.design_spec_tgt_history_id_seq OWNED BY tg.design_spec_tgt_history.id;


--
-- Name: eci_history; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.eci_history (
    eci_history_id integer NOT NULL,
    design_spec_id integer NOT NULL,
    eci_no character varying(50) NOT NULL,
    change_date date,
    revised_by character varying(100),
    approved_by character varying(100),
    change_note text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.eci_history OWNER TO postgres;

--
-- Name: eci_history_eci_history_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.eci_history_eci_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.eci_history_eci_history_id_seq OWNER TO postgres;

--
-- Name: eci_history_eci_history_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.eci_history_eci_history_id_seq OWNED BY tg.eci_history.eci_history_id;


--
-- Name: heater_pad; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.heater_pad (
    heater_pad_id integer NOT NULL,
    part_id integer NOT NULL,
    supplier_name character varying(100),
    model_reference character varying(50),
    mass_gram numeric(10,2),
    notes text
);


ALTER TABLE tg.heater_pad OWNER TO postgres;

--
-- Name: heater_pad_heater_pad_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.heater_pad_heater_pad_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.heater_pad_heater_pad_id_seq OWNER TO postgres;

--
-- Name: heater_pad_heater_pad_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.heater_pad_heater_pad_id_seq OWNED BY tg.heater_pad.heater_pad_id;


--
-- Name: leather_detail; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.leather_detail (
    leather_detail_id integer NOT NULL,
    part_id integer NOT NULL,
    leather_no character varying(20),
    synthetic_code character varying(50),
    color_id integer,
    mass_gram numeric(10,2),
    notes text
);


ALTER TABLE tg.leather_detail OWNER TO postgres;

--
-- Name: leather_detail_leather_detail_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.leather_detail_leather_detail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.leather_detail_leather_detail_id_seq OWNER TO postgres;

--
-- Name: leather_detail_leather_detail_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.leather_detail_leather_detail_id_seq OWNED BY tg.leather_detail.leather_detail_id;


--
-- Name: material_type; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.material_type (
    material_type_id integer NOT NULL,
    type_code character varying(50) NOT NULL,
    type_description character varying(200)
);


ALTER TABLE tg.material_type OWNER TO postgres;

--
-- Name: TABLE material_type; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.material_type IS 'Raw material classification';


--
-- Name: material_type_material_type_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.material_type_material_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.material_type_material_type_id_seq OWNER TO postgres;

--
-- Name: material_type_material_type_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.material_type_material_type_id_seq OWNED BY tg.material_type.material_type_id;


--
-- Name: model; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.model (
    model_id integer NOT NULL,
    model_code character varying(20) NOT NULL,
    model_name character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.model OWNER TO postgres;

--
-- Name: TABLE model; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.model IS 'Vehicle model master (e.g. 3GJ/AVANCIER)';


--
-- Name: model_model_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.model_model_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.model_model_id_seq OWNER TO postgres;

--
-- Name: model_model_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.model_model_id_seq OWNED BY tg.model.model_id;


--
-- Name: part; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.part (
    part_id integer NOT NULL,
    tg_part_no character varying(50),
    customer_part_no character varying(50),
    part_name character varying(200) NOT NULL,
    material_type_id integer,
    material_no character varying(100),
    material_trade_name character varying(200),
    mass_gram numeric(10,2),
    color_id integer,
    product_standard character varying(100),
    material_standard character varying(100),
    jis_standard character varying(50),
    soc_flag character(1),
    reg_certif_required boolean DEFAULT false,
    is_purchased_material boolean DEFAULT false,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    image_url text
);


ALTER TABLE tg.part OWNER TO postgres;

--
-- Name: TABLE part; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.part IS 'All parts and sub-components across both variants';


--
-- Name: part_part_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.part_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.part_part_id_seq OWNER TO postgres;

--
-- Name: part_part_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.part_part_id_seq OWNED BY tg.part.part_id;


--
-- Name: part_revision; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.part_revision (
    part_rev_id integer NOT NULL,
    part_id integer NOT NULL,
    revision_suffix character varying(5),
    effective_date date,
    eci_no character varying(50),
    change_reason text,
    created_by character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.part_revision OWNER TO postgres;

--
-- Name: part_revision_part_rev_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.part_revision_part_rev_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.part_revision_part_rev_id_seq OWNER TO postgres;

--
-- Name: part_revision_part_rev_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.part_revision_part_rev_id_seq OWNED BY tg.part_revision.part_rev_id;


--
-- Name: product_variant; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.product_variant (
    variant_id integer NOT NULL,
    design_spec_id integer NOT NULL,
    variant_key integer NOT NULL,
    customer_part_no character varying(50),
    tg_part_no character varying(50) NOT NULL,
    part_name character varying(200),
    leather_color_id integer,
    thread_color_id integer,
    stitch_style character varying(100),
    mass_gram numeric(10,2),
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.product_variant OWNER TO postgres;

--
-- Name: TABLE product_variant; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.product_variant IS 'Two variants: Variant 1 = NH-900L black, Variant 2 = NH-1168L gray';


--
-- Name: product_variant_variant_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.product_variant_variant_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.product_variant_variant_id_seq OWNER TO postgres;

--
-- Name: product_variant_variant_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.product_variant_variant_id_seq OWNED BY tg.product_variant.variant_id;


--
-- Name: regulation_record; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.regulation_record (
    reg_record_id integer NOT NULL,
    part_id integer NOT NULL,
    reg_type character varying(50),
    certification_no character varying(100),
    valid_from date,
    valid_to date,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.regulation_record OWNER TO postgres;

--
-- Name: regulation_record_reg_record_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.regulation_record_reg_record_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.regulation_record_reg_record_id_seq OWNER TO postgres;

--
-- Name: regulation_record_reg_record_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.regulation_record_reg_record_id_seq OWNED BY tg.regulation_record.reg_record_id;


--
-- Name: supplier; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.supplier (
    supplier_id integer NOT NULL,
    supplier_code character varying(50),
    supplier_name character varying(200) NOT NULL,
    is_local boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE tg.supplier OWNER TO postgres;

--
-- Name: TABLE supplier; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON TABLE tg.supplier IS 'Supplier / vendor master';


--
-- Name: supplier_supplier_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.supplier_supplier_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.supplier_supplier_id_seq OWNER TO postgres;

--
-- Name: supplier_supplier_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.supplier_supplier_id_seq OWNED BY tg.supplier.supplier_id;


--
-- Name: thread_spec; Type: TABLE; Schema: tg; Owner: postgres
--

CREATE TABLE tg.thread_spec (
    thread_spec_id integer NOT NULL,
    part_id integer NOT NULL,
    thread_color_id integer,
    thread_material character varying(100),
    ace_crown_grade character varying(20),
    ace_crown_code character varying(30),
    stitch_style character varying(50),
    mass_gram numeric(10,3),
    notes text
);


ALTER TABLE tg.thread_spec OWNER TO postgres;

--
-- Name: thread_spec_thread_spec_id_seq; Type: SEQUENCE; Schema: tg; Owner: postgres
--

CREATE SEQUENCE tg.thread_spec_thread_spec_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE tg.thread_spec_thread_spec_id_seq OWNER TO postgres;

--
-- Name: thread_spec_thread_spec_id_seq; Type: SEQUENCE OWNED BY; Schema: tg; Owner: postgres
--

ALTER SEQUENCE tg.thread_spec_thread_spec_id_seq OWNED BY tg.thread_spec.thread_spec_id;


--
-- Name: vw_bom_full; Type: VIEW; Schema: tg; Owner: postgres
--

CREATE VIEW tg.vw_bom_full AS
 SELECT b.design_spec_id,
    b.bom_level,
    b.level_code,
    b.quantity,
    cp.tg_part_no AS child_tg_part_no,
    cp.customer_part_no AS child_cust_part_no,
    cp.part_name,
    cp.mass_gram,
    mt.type_code AS material_type,
    co.color_code,
    co.color_tone,
    cp.material_trade_name,
    cp.jis_standard,
    cp.notes,
    pp.tg_part_no AS parent_tg_part_no
   FROM ((((tg.bom b
     JOIN tg.part cp ON ((b.child_part_id = cp.part_id)))
     LEFT JOIN tg.part pp ON ((b.parent_part_id = pp.part_id)))
     LEFT JOIN tg.material_type mt ON ((cp.material_type_id = mt.material_type_id)))
     LEFT JOIN tg.color co ON ((cp.color_id = co.color_id)));


ALTER VIEW tg.vw_bom_full OWNER TO postgres;

--
-- Name: VIEW vw_bom_full; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON VIEW tg.vw_bom_full IS 'Full BOM with part and material details';


--
-- Name: vw_leather_summary; Type: VIEW; Schema: tg; Owner: postgres
--

CREATE VIEW tg.vw_leather_summary AS
 SELECT p.tg_part_no,
    p.part_name,
    ld.leather_no,
    ld.synthetic_code,
    c.color_code,
    c.color_tone,
    ld.mass_gram
   FROM ((tg.leather_detail ld
     JOIN tg.part p ON ((ld.part_id = p.part_id)))
     LEFT JOIN tg.color c ON ((ld.color_id = c.color_id)));


ALTER VIEW tg.vw_leather_summary OWNER TO postgres;

--
-- Name: VIEW vw_leather_summary; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON VIEW tg.vw_leather_summary IS 'Leather NO.1-4 for both variants';


--
-- Name: vw_variant_mass; Type: VIEW; Schema: tg; Owner: postgres
--

CREATE VIEW tg.vw_variant_mass AS
 SELECT variant_key,
    tg_part_no AS assembly_part_no,
    part_name,
    mass_gram AS total_mass_gram,
    stitch_style,
    notes
   FROM tg.product_variant pv;


ALTER VIEW tg.vw_variant_mass OWNER TO postgres;

--
-- Name: VIEW vw_variant_mass; Type: COMMENT; Schema: tg; Owner: postgres
--

COMMENT ON VIEW tg.vw_variant_mass IS 'Top-level assembly mass per variant';


--
-- Name: approval_tokens id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.approval_tokens ALTER COLUMN id SET DEFAULT nextval('tg.approval_tokens_id_seq'::regclass);


--
-- Name: bom bom_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom ALTER COLUMN bom_id SET DEFAULT nextval('tg.bom_bom_id_seq'::regclass);


--
-- Name: bom_document bom_doc_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_document ALTER COLUMN bom_doc_id SET DEFAULT nextval('tg.bom_document_bom_doc_id_seq'::regclass);


--
-- Name: bom_item_history id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_item_history ALTER COLUMN id SET DEFAULT nextval('tg.bom_item_history_id_seq'::regclass);


--
-- Name: bom_line bom_line_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_line ALTER COLUMN bom_line_id SET DEFAULT nextval('tg.bom_line_bom_line_id_seq'::regclass);


--
-- Name: bom_revision revision_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_revision ALTER COLUMN revision_id SET DEFAULT nextval('tg.bom_revision_revision_id_seq'::regclass);


--
-- Name: color color_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.color ALTER COLUMN color_id SET DEFAULT nextval('tg.color_color_id_seq'::regclass);


--
-- Name: customer customer_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.customer ALTER COLUMN customer_id SET DEFAULT nextval('tg.customer_customer_id_seq'::regclass);


--
-- Name: design_spec design_spec_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec ALTER COLUMN design_spec_id SET DEFAULT nextval('tg.design_spec_design_spec_id_seq'::regclass);


--
-- Name: design_spec_tgt_history id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec_tgt_history ALTER COLUMN id SET DEFAULT nextval('tg.design_spec_tgt_history_id_seq'::regclass);


--
-- Name: eci_history eci_history_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.eci_history ALTER COLUMN eci_history_id SET DEFAULT nextval('tg.eci_history_eci_history_id_seq'::regclass);


--
-- Name: heater_pad heater_pad_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.heater_pad ALTER COLUMN heater_pad_id SET DEFAULT nextval('tg.heater_pad_heater_pad_id_seq'::regclass);


--
-- Name: leather_detail leather_detail_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.leather_detail ALTER COLUMN leather_detail_id SET DEFAULT nextval('tg.leather_detail_leather_detail_id_seq'::regclass);


--
-- Name: material_type material_type_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.material_type ALTER COLUMN material_type_id SET DEFAULT nextval('tg.material_type_material_type_id_seq'::regclass);


--
-- Name: model model_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.model ALTER COLUMN model_id SET DEFAULT nextval('tg.model_model_id_seq'::regclass);


--
-- Name: part part_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part ALTER COLUMN part_id SET DEFAULT nextval('tg.part_part_id_seq'::regclass);


--
-- Name: part_revision part_rev_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part_revision ALTER COLUMN part_rev_id SET DEFAULT nextval('tg.part_revision_part_rev_id_seq'::regclass);


--
-- Name: product_variant variant_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.product_variant ALTER COLUMN variant_id SET DEFAULT nextval('tg.product_variant_variant_id_seq'::regclass);


--
-- Name: regulation_record reg_record_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.regulation_record ALTER COLUMN reg_record_id SET DEFAULT nextval('tg.regulation_record_reg_record_id_seq'::regclass);


--
-- Name: supplier supplier_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.supplier ALTER COLUMN supplier_id SET DEFAULT nextval('tg.supplier_supplier_id_seq'::regclass);


--
-- Name: thread_spec thread_spec_id; Type: DEFAULT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.thread_spec ALTER COLUMN thread_spec_id SET DEFAULT nextval('tg.thread_spec_thread_spec_id_seq'::regclass);


--
-- Data for Name: approval_tokens; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.approval_tokens (id, token, bom_id, sent_to, sent_at, approved_by, approved_at, status) FROM stdin;
1	db56e62d00ee871e656a645891964f2f81a897fa6864b3609fc06a66a057675b	1	thamakhorn@gmail.com	2026-05-19 16:33:49.514665+07	\N	\N	pending
2	e938f9232837c2f8f9a12941db53c842c9162f18ee1fe5d2933652babd46fc21	1	thamakorn.do@ku.th	2026-05-19 16:34:26.947532+07	thamakorn	2026-05-19 16:34:58.817891+07	approved
3	feafcf86faf14cc15e9beb266e460754498f23a66f241a1719f644fc940ae0bc	1	thamakorn.do@ku.th	2026-05-19 16:38:54.583296+07	\N	\N	pending
4	b28e92aa5a97049a3d35530a0a054604098762f58f022f74a8afec76ad20f1c2	1	thamakorn.do@ku.th	2026-05-19 16:40:28.695738+07	\N	\N	pending
5	08115e491b06876d0f9530ff1dc6bc5ae6c7219437abe3a8fc82eb500ff4b26f	1	thamakorn.do@ku.th	2026-05-19 16:41:45.39415+07	thamakorn	2026-05-19 16:43:02.987102+07	approved
6	d6890ccd462b727f6f5bd6c559749b439a29cb36ae2736e493703be668d96eb4	1	thamakhorn@gmail.com	2026-05-20 08:07:14.994168+07	testter	2026-05-20 08:08:03.819663+07	approved
7	089757ce749a88695a29ed89f590850c202f6814b361d25988fb436b5bec9427	1	thamakhorn@gmail.com	2026-05-20 08:28:33.621069+07	testter T.	2026-05-20 08:29:35.854549+07	approved
8	0a3a81544aeb4e8c0d4b6db8d0727a87452c50f2c49fdd2da521c91d799fb5bb	1	thamakhorn@gmail.com	2026-05-20 08:32:11.058279+07	thamakorn D.	2026-05-20 08:32:29.680119+07	approved
9	f55acba3a53383e90e21f4e3cca4446fbc2182fb5309902b6dbae9c6be6aae30	1	thamakhorn@gmail.com	2026-05-20 08:32:56.319615+07	i'm testter	2026-05-20 08:33:41.292065+07	approved
10	dfa10879187b9ebd33162ee82effe18e67d47ebf0efc835ff862e37d5ed74d50	1	thamakhorn@gmail.com	2026-05-20 08:36:07.322349+07	say my name	2026-05-20 08:36:26.955265+07	approved
11	f329671bdce26e8405ab8d698449c7be254b5da587c847ebc6c454714d15b3de	3	thamakhorn@gmail.com	2026-05-20 08:38:14.110881+07	thamakorn D.	2026-05-20 08:38:23.550771+07	approved
12	24a20aace4087126390570dc63c7d812155d2ab95ef81de60191da0518d1cde5	3	thamakhorn@gmail.com	2026-05-20 08:41:07.317638+07	gojo satoru	2026-05-20 08:41:41.36245+07	approved
13	aa0061d608a6624f285745e8b5383be6ab8baff23a0d8c7fbc68f8e5d3877581	3	thamakhorn@gmail.com	2026-05-20 08:44:41.722189+07	Steven	2026-05-20 08:44:56.772426+07	approved
14	45c52f8eb9c60372e1377ae8e278300bd49564b0ac2230a7dbfa86e9b2148597	3	thamakhorn@gmail.com	2026-05-20 08:50:35.062206+07	\N	\N	pending
15	36f8e4c5626589483a3b8d7f0c822a29fc1091d3bf63b325b3acd8b3139398bb	1	thamakhorn@gmail.com	2026-05-20 08:51:28.136597+07	\N	\N	pending
16	8750a732e8112c8b15c856987b08cbb4a282346f7f4579b9b239aae39e053dbb	1	thamakhorn@gmail.com	2026-05-20 08:54:58.70655+07	\N	\N	pending
17	2781901dbfa96066d19b48e013c12577ac9e7bfac451deb7845d484c847b262b	1	thamakhorn@gmail.com	2026-05-20 08:56:01.190191+07	\N	\N	pending
18	0feb9f3c1942561940c80afb5145b64e23fd6fd5e6e314668db9ee5e99a3c473	1	thamakhorn@gmail.com	2026-05-20 08:58:11.057518+07	thamakorn	2026-05-20 08:59:24.733434+07	approved
19	4e2d1f863817a48f2cfa0bb7e6f9e8c3e7b3f8ba051d52f7d36d3bb11759c15b	1	thamakhorn@gmail.com	2026-05-20 09:00:49.732196+07	\N	\N	pending
20	77978200521833bf10c5216ac0ed10943b280d115cde14f7297fd58b7b14e25d	1	thamakhorn@gmail.com	2026-05-20 09:03:47.555516+07	\N	\N	pending
21	198ba37ca358f886b7588d8bf36d62e88f4a69789cfb6707ada4d723f5982d96	1	thamakhorn@gmail.com	2026-05-20 09:07:15.576526+07	\N	\N	pending
22	8779c1c663e07f688831b6c4bef68c3891f8071252c44c3cc4e632681ccac16a	1	thamakhorn@gmail.com	2026-05-20 09:10:18.093957+07	thamakorn D.	2026-05-20 09:11:00.267706+07	approved
23	f65463ea0864773b51207436cb17d9b227f30dbb0ba6ccaf721a45397bf96845	1	thamakhorn@gmail.com	2026-05-20 09:15:37.023056+07	\N	\N	pending
24	35b516f9a68ec0078cbbac282e8f95e3a48ad51e6c8b512f2adb03f13b02e834	1	thamakorn.do@ku.th	2026-05-20 09:18:01.218896+07	Mr.Test	2026-05-20 09:19:11.76995+07	approved
25	72a041ae1ee6398b241658b814f3901ff082311757f52881228ac06ace250c36	1	thamakhorn@gmail.com	2026-05-20 09:35:58.724749+07	thamakorn D.	2026-05-20 09:36:40.759209+07	approved
26	d8548a7014cd193e974697e7f43ad906186edd911645a75c2ad9eb8ab28de1a4	1	thamakhorn@gmail.com	2026-05-20 10:14:41.100361+07	testter T.	2026-05-20 10:16:02.382022+07	approved
27	1a0469b532348c83519a5943d94f1d0ad2f6f3c54e2647e59c93e243a9bdda0a	1	thamakhorn@gmail.com	2026-05-20 10:45:16.003547+07	\N	\N	pending
28	a2c4060ede66ce301fcddf0f451a70305006c683e710b58acd89d12a7143d7ff	1	thamakhorn@gmail.com	2026-05-20 10:45:43.525757+07	i'm testter	2026-05-20 10:46:44.677908+07	approved
29	8a160af218aff33f1b2b251d99e8408826457360a62a3f60ee5d23f1c270904a	1	thamakhorn@gmail.com	2026-05-20 11:09:33.377133+07	thamakorn D.	2026-05-20 11:10:10.816912+07	approved
30	6d68ebeb4d60f9bb9f26806c3c8506efeadb5c70d538f81d28968e9e570afe49	1	thamakhorn@gmail.com	2026-05-20 13:15:02.916715+07	\N	\N	pending
31	6c662a7a0f4102fff036faa5642d9b40f8e551653350b1ecde549b352f64575c	1	thamakhorn@gmail.com	2026-05-20 13:19:28.653914+07	\N	\N	pending
32	3fefbe7bc428cfb224a3c45e9dd5f463f058c7391849fffaca6942a68cd1255d	1	thamakhorn@gmail.com	2026-05-20 13:41:33.54524+07	\N	\N	pending
33	f480007a2080599fb10828278c0739da0d443315eadb0798c396dd1de3c54dfe	1	thamakhorn@gmail.com	2026-05-20 13:49:38.272066+07	\N	\N	pending
34	42708fd9432f571f6b705899def94f993883ebcf246912f033b145edd83a39c5	1	thamakhorn@gmail.com	2026-05-20 13:50:02.584584+07	\N	\N	pending
35	e4f8c0cdf7a7dd9ec25dc0105f415c9e1969adef60d3f86396fcd009091919c4	1	thamakhorn@gmail.com	2026-05-20 13:51:21.691235+07	Test T.	2026-05-20 13:53:57.362513+07	approved
36	fad66cc7ab6ecc6b30aee97347579986c39d7ef0f94863c6712c829bde661067	1	thamakhorn@gmail.com	2026-05-20 14:09:14.942353+07	testter T.	2026-05-20 14:10:23.604477+07	approved
37	a73ebc0b7f14d2056c35d05d49fe90c834034c120df3683314cc6fe08d618ddd	1	thamakhorn@gmail.co	2026-05-20 14:40:39.127746+07	\N	\N	pending
38	f19ffbf8a509c63fdf8204099422fe9237c2a0f96750f01f77161a49ae4d52a3	1	thamakhorn@gmail.com	2026-05-20 14:41:07.030971+07	thamakorn D.	2026-05-20 14:42:03.334645+07	approved
39	aeb8d7866adb4b03ef37650cf19fd206224cb4b5867ddd129f28c7c20b512cc2	1	thamakhorn@gmail.com	2026-05-21 09:01:13.067474+07	testter T.	2026-05-21 09:01:47.344517+07	approved
40	e93deebd12723131d190d7528c7b8fe29cf990e06691868374db732472acaf4a	1	jhgjgjg	2026-05-21 09:12:07.721515+07	\N	\N	pending
41	4e9d12d75fb15b2d07e963589869151fb39bf5cf97420210a51974d1e6d8840d	1	jhgjgjg	2026-05-21 09:12:13.397109+07	\N	\N	pending
42	b82b5215fba37363b57830a07745da3362bfc2d2e4f5f051c9032ede9ae14bf1	1	thamakorn099@hotmail.com	2026-05-21 09:12:23.181726+07	\N	\N	pending
43	2fe27acd18b0a9c10bfc055eff237f8323c79f746206bdbb6d9f6ee3d5634aed	1	thamakorn.do@live.ku.th	2026-05-21 09:13:01.929738+07	i'm testter	2026-05-21 09:13:57.190373+07	approved
44	abe5913c94e880f39355a742e2b0dc51b771481cd06a8b49f5e4204ba29b0b0d	3	thamakorn.do@live.ku.th	2026-05-21 09:26:37.664851+07	testter T.	2026-05-21 09:29:09.191276+07	approved
45	39e1f7a5321550ccfcd676b41c150097f31789ae10300dcf741dbf4acd335590	3	thamakorn.do@live.ku.th	2026-05-21 10:30:18.224561+07	testter T.	2026-05-21 10:31:31.143625+07	approved
46	da6122ce4a02d6109a347e612c85c80cc3ed74ecb726490b60f1409edc599375	3	thamakorn.do@live.ku.th	2026-05-21 12:29:18.219014+07	testter T.	2026-05-21 12:29:50.103079+07	approved
47	d9e1ad8d462ec8766420d76bd8ba2097f8518e4f5e0b62a11632a6e05a293072	14	thamakorn.do@live.ku.th	2026-05-21 13:30:43.639436+07	testter T.	2026-05-21 13:31:39.020435+07	approved
48	df992e6b2fb40a62edb5273a9a76f6ddbe11d3d869c878cbc47f8dc307325ab1	17	thamakorn.do@live.ku.th	2026-05-22 08:20:31.559851+07	testter T.	2026-05-22 08:21:55.912209+07	approved
49	9dc90582ca8f334809273ddf3f227bb4b1f1dd4b07d580daae2ef2592389d9f2	17	thamakorn.do@live.ku.th	2026-05-22 10:26:43.896778+07	i'm testter	2026-05-22 10:27:11.92164+07	approved
50	130297d784129e4295d9a46daa9f60b73e7b177fe6d872d198224804b0723c60	17	d@a	2026-05-22 14:20:07.913736+07	\N	\N	pending
\.


--
-- Data for Name: bom; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.bom (bom_id, design_spec_id, variant_id, parent_part_id, child_part_id, bom_level, level_code, quantity, sort_order, notes, created_at, status, update_level) FROM stdin;
7168	21	354	\N	1	1	1-2	1.0000	0	\N	2026-05-25 08:37:17.963138+07	active	0
7169	21	355	\N	2	1	1-2	1.0000	1	\N	2026-05-25 08:37:17.963138+07	active	0
7170	21	354	1	3	2	1-2	1.0000	2	\N	2026-05-25 08:37:17.963138+07	active	0
7171	21	354	3	130	3	1-2	1.0000	3	\N	2026-05-25 08:37:17.963138+07	active	0
7172	21	354	130	126	4	1-1	1.0000	4	\N	2026-05-25 08:37:17.963138+07	active	0
7173	21	354	126	128	5	1-1	1.0000	5	\N	2026-05-25 08:37:17.963138+07	active	0
7174	21	354	126	7	5	1-1	1.0000	6	\N	2026-05-25 08:37:17.963138+07	active	0
7175	21	354	130	8	4	1-2	1.0000	7	\N	2026-05-25 08:37:17.963138+07	active	0
7176	21	354	8	9	5	1-2	1.0000	8	\N	2026-05-25 08:37:17.963138+07	active	0
7177	21	354	8	10	5	1-2	1.0000	9	\N	2026-05-25 08:37:17.963138+07	active	0
7178	21	354	8	11	5	1-2	1.0000	10	\N	2026-05-25 08:37:17.963138+07	active	0
7179	21	354	8	12	5	1-2	1.0000	11	\N	2026-05-25 08:37:17.963138+07	active	0
7180	21	354	130	13	4	1-2	1.0000	12	\N	2026-05-25 08:37:17.963138+07	active	0
7181	21	354	3	14	3	1-1	3.0000	13	\N	2026-05-25 08:37:17.963138+07	active	0
7182	21	354	1	15	2	1-1	1.0000	14	\N	2026-05-25 08:37:17.963138+07	active	0
7183	21	355	2	15	2	1-1	1.0000	14	\N	2026-05-25 08:37:17.963138+07	active	0
7184	21	354	1	16	2	2-2	1.0000	15	\N	2026-05-25 08:37:17.963138+07	active	0
7185	21	355	2	16	2	2-2	1.0000	15	\N	2026-05-25 08:37:17.963138+07	active	0
7186	21	354	1	17	2	1-1	1.0000	16	\N	2026-05-25 08:37:17.963138+07	active	0
7187	21	355	2	17	2	1-1	1.0000	16	\N	2026-05-25 08:37:17.963138+07	active	0
7188	21	354	17	18	3	1-1	1.0000	17	\N	2026-05-25 08:37:17.963138+07	active	0
7189	21	355	17	18	3	1-1	1.0000	17	\N	2026-05-25 08:37:17.963138+07	active	0
7190	21	354	1	19	2	1-2	1.0000	18	\N	2026-05-25 08:37:17.963138+07	active	0
7191	21	355	2	19	2	1-2	1.0000	18	\N	2026-05-25 08:37:17.963138+07	active	0
7192	21	354	1	20	2	2-2	1.0000	19	\N	2026-05-25 08:37:17.963138+07	active	0
7193	21	355	2	20	2	2-2	1.0000	19	\N	2026-05-25 08:37:17.963138+07	active	0
7194	21	354	1	21	2	1-2	1.0000	20	\N	2026-05-25 08:37:17.963138+07	active	0
7195	21	355	2	21	2	1-2	1.0000	20	\N	2026-05-25 08:37:17.963138+07	active	0
7196	21	354	1	22	2	1-2	7.0000	21	\N	2026-05-25 08:37:17.963138+07	active	0
7197	21	355	2	22	2	1-2	7.0000	21	\N	2026-05-25 08:37:17.963138+07	active	0
7198	21	354	1	23	2	1-2	1.0000	22	\N	2026-05-25 08:37:17.963138+07	active	0
7199	21	355	2	23	2	1-2	1.0000	22	\N	2026-05-25 08:37:17.963138+07	active	0
7200	21	355	2	24	2	1-2	1.0000	23	\N	2026-05-25 08:37:17.963138+07	active	0
7201	21	355	24	25	3	1-2	1.0000	24	\N	2026-05-25 08:37:17.963138+07	active	0
7202	21	355	25	126	4	1-1	1.0000	25	\N	2026-05-25 08:37:17.963138+07	active	0
7203	21	355	126	128	5	1-1	1.0000	26	\N	2026-05-25 08:37:17.963138+07	active	0
7204	21	355	126	7	5	1-1	1.0000	27	\N	2026-05-25 08:37:17.963138+07	active	0
7205	21	355	25	26	4	1-2	1.0000	28	\N	2026-05-25 08:37:17.963138+07	active	0
7206	21	355	26	27	5	1-2	1.0000	29	\N	2026-05-25 08:37:17.963138+07	active	0
7207	21	355	26	28	5	1-2	1.0000	30	\N	2026-05-25 08:37:17.963138+07	active	0
7208	21	355	26	29	5	1-2	1.0000	31	\N	2026-05-25 08:37:17.963138+07	active	0
7209	21	355	26	30	5	1-2	1.0000	32	\N	2026-05-25 08:37:17.963138+07	active	0
7210	21	355	25	13	4	1-2	1.0000	33	\N	2026-05-25 08:37:17.963138+07	active	0
7211	21	355	24	14	3	1-1	3.0000	34	\N	2026-05-25 08:37:17.963138+07	active	0
\.


--
-- Data for Name: bom_document; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.bom_document (bom_doc_id, design_spec_id, document_date, type, customer_part_no, tg_part_no_main, tg_part_no_alt, eci_no, prepared_by, approved_by, created_at) FROM stdin;
\.


--
-- Data for Name: bom_item_history; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.bom_item_history (id, bom_id, introduced_at, superseded_at, old_tg_part_no, old_customer_part_no) FROM stdin;
\.


--
-- Data for Name: bom_line; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.bom_line (bom_line_id, bom_doc_id, col1_part_no, col2_part_no, col3_part_no, col4_part_no, col5_part_no, part_id, part_name, spec, quantity, weight_gram, price_per_pcs, material_cost, supplier_id, is_local, is_import, recipe_code, qty_per_kanban, kanban_unit, lead_time_days, remark, sort_order, created_at) FROM stdin;
\.


--
-- Data for Name: bom_revision; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.bom_revision (revision_id, design_spec_id, sort_order, mark, revision_record, eci_no, revision_date, revisioner, approved_by) FROM stdin;
82	21	0	–	First issue	26A376	2026-05-25	\N	\N
\.


--
-- Data for Name: color; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.color (color_id, color_code, color_tone, created_at) FROM stdin;
1	NH-900L	NEUTRAL BLACK	2026-05-13 13:21:40.495988+07
2	NH-1168L	LIGHT SOFT GRAY	2026-05-13 13:21:40.495988+07
3	NH-906L	THREAD CHARCOAL	2026-05-13 13:21:40.495988+07
4	NH-802L	LIGHT JEWEL GRAY	2026-05-13 13:21:40.495988+07
5	NH-892L	MIRROR BLACK	2026-05-13 13:21:40.495988+07
6	BLACK	Black	2026-05-13 13:21:40.495988+07
\.


--
-- Data for Name: customer; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.customer (customer_id, customer_code, customer_name, created_at) FROM stdin;
1	6991	HATC	2026-05-13 13:21:40.495988+07
\.


--
-- Data for Name: design_spec; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.design_spec (design_spec_id, model_id, customer_id, customer_part_no, tg_part_no, production_level, initial_stage, control_rank, reg_certif, customer_standard, tg_standard, internal_eci_no, effective_date, prepared_by, checked_by, approved_by, confirmed_by, page_total, is_confidential, created_at, evt_first_issue, evt_cv, evt_mq, evt_dan, evt_hin, evt_sop, concern_drawing, concern_actual_part, tgt_update_level, pdf_url, customer_name_override) FROM stdin;
21	1	1	78500-3DA-J110-M1	78500-DA000-6***	3:SPECIAL ORDER	C	\N	None	IN DRAWING	NO	26A376	2026-05-25	\N	\N	\N	\N	\N	t	2026-05-25 08:37:17.963138+07	t	f	f	f	f	f	f	f	0	/uploads/pdfs/bom-21-1779673038075.pdf	\N
\.


--
-- Data for Name: design_spec_tgt_history; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.design_spec_tgt_history (id, design_spec_id, introduced_at, superseded_at, old_tg_part_no) FROM stdin;
\.


--
-- Data for Name: eci_history; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.eci_history (eci_history_id, design_spec_id, eci_no, change_date, revised_by, approved_by, change_note, created_at) FROM stdin;
\.


--
-- Data for Name: heater_pad; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.heater_pad (heater_pad_id, part_id, supplier_name, model_reference, mass_gram, notes) FROM stdin;
\.


--
-- Data for Name: leather_detail; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.leather_detail (leather_detail_id, part_id, leather_no, synthetic_code, color_id, mass_gram, notes) FROM stdin;
\.


--
-- Data for Name: material_type; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.material_type (material_type_id, type_code, type_description) FROM stdin;
1	PU	Polyurethane Foam
2	PP	Polypropylene
3	PC+ABS	Polycarbonate + ABS Blend
4	Synth. leather	Synthetic Leather
5	POLYESTER	Polyester Thread
6	Mg/AM60B	Magnesium Alloy AM60B
7	Fe	Iron / Steel
8	SWP-B	Steel Wire for Spring
9	PAPER	Paper / Adhesion Sheet
\.


--
-- Data for Name: model; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.model (model_id, model_code, model_name, created_at) FROM stdin;
1	3GJ	AVANCIER	2026-05-13 13:21:40.495988+07
\.


--
-- Data for Name: part; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.part (part_id, tg_part_no, customer_part_no, part_name, material_type_id, material_no, material_trade_name, mass_gram, color_id, product_standard, material_standard, jis_standard, soc_flag, reg_certif_required, is_purchased_material, notes, is_active, created_at, updated_at, image_url) FROM stdin;
7	GS129-03810	\N	WEIGHT	\N	\N	\N	90.00	\N	\N	\N	\N	\N	f	f	MATERIAL:Fe 6H SIDE TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
31	78500-DA000-OVOB	78500-3DA-J110-M1	WHEEL ASSY, STEERING (N)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	t	f	(N) HEATER AUDIO CRUISE LEATER: NH-900L THREAD: EURO STITCH (NH-906L) TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
32	78500-DA010-OYOB	78500-3DA-J310-M1	WHEEL ASSY, STEERING (C)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	t	f	(C) HEATER AUDIO CRUISE LEATER:NH-1168L THREAD: EURO STITCH (NH-802L) TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
33	78500-DA020-OVOB	78500-3DA-Q110-M1	WHEEL ASSY, STEERING (L)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	t	f	(L) HEATER AUDIO CRUISE LEATER: NH-900L THREAD: EURO STITCH (NH-906L) TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
34	78500-DA030-OYOB	78500-3DAA-Q311-M1	WHEEL ASSY, STEERING (R)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	t	f	(R) HEATER AUDIO CRUISE LEATER:NH-1168L THREAD: EURO STITCH (NH-802L) TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
35	78500-DA000-OYOB	78500-3DA-J110-M1	WHEEL ASSY, STEERING (N)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	t	f	(N) HEATER AUDIO CRUISE LEATER: NH-900L THREAD: EURO STITCH (NH-802L) TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
36	78500-DA010-OVOB	\N	WHEEL ASSY, STEERING (C)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	t	f	(C) HEATER AUDIO CRUISE LEATER:NH-1168L THREAD: EURO STITCH (NH-906L) TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
37	93893-04012-17	\N	SCREW-WASH, 4X12	\N	\N	\N	9.00	\N	NO	NO	\N	\N	f	f	SCREW-WASH, 4X12	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
38	35880-MAA10	35880-3MA-A110-M1	SW ASSY, STRG	\N	\N	\N	263.00	\N	NO	NO	\N	\N	f	f	HM SUPPLY PARTS	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
39	GS110-91120-A	78501-3DA-T700	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	t	f	GRIP (HE) + LEATHER (NH-900L) + SPRING THREAD: NH-802L TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
40	GS110-91130-A	\N	GRIP (HE)	\N	\N	POLYESTER	1202.00	\N	NO	NO	0.3	\N	f	t	GRIP (LH) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD: EURO (NH-802L) TGZH\n#5 ACE CROWN (H802)	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
41	GS113-59970	\N	LEATHER, STEERING WHEEL	\N	\N	\N	116.00	\N	IN DRAWING	IN DRAWING	0.1	\N	f	f	(HE) SYNTHETIC LEATHER LOOP (NH-900L) MIDORI THREAD (EURO): NH-802L TGT\n#20	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
42	GS113-59990	\N	LEATHER NO.1	\N	9-78301-01001	NH-900L	46.00	\N	IN DRAWING	IN DRAWING	46	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
43	GS113-60000	\N	LEATHER NO.2	\N	9-78301-01001	NH-900L	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
44	GS113-60010	\N	LEATHER NO. 3	\N	9-78301-01001	NH-900L	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
45	GS113-60020	\N	LEATHER NO.4	\N	9-78301-C1001	NH-900L	27.00	\N	IN DRAWING	IN DRAWING	27	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
46	GS110-91140-A	78501-3DA-T900	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	t	f	GRIP (HE) + LEATHER (NH-1168L) + SPRING THREAD: NH-906L TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
47	GS110-91150-A	\N	GRIP (HE)	\N	\N	POLYESTER	1202.00	\N	NO	NO	0.3	\N	f	t	GRIP (HE) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD: EURO (NH-802L) TGT\n#5 ACE CROWN (H802)	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
48	GS113-59980	\N	LEATHER, STEERING WHEEL	\N	\N	\N	116.00	\N	IN DRAWING	IN DRAWING	0.1	\N	f	f	(HE) SYNTHETIC LEATHER LOOP (NH-1168L) MIDORI THREAD (EURO): NH-906L TGT\n#20 #8 ACE CROWN (H802)	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
49	GS113-60030	\N	LEATHER NO. 1	\N	9-78301-01002	NH-1168L	46.00	\N	IN DRAWING	IN DRAWING	46	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
50	GS113-60040	\N	LEATHER NO. 2	\N	9-78301-C1002	NH-1168L	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
5	GS111-21760-B	\N	GRIP (HE) PU FORM	\N	\N	\N	977.00	\N	\N	\N	\N	\N	f	f	PU FORM FOR GRIP(HE) HA78 BEFORE LEATHER WRAPPED	t	2026-05-13 13:21:40.495988+07	2026-05-18 15:09:24.865414+07	\N
141	GS110-88710-E	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	\N	t	2026-05-18 16:13:06.359634+07	2026-05-18 16:13:06.359634+07	\N
6	GS120-10170-C	\N	HUB CORE	\N	\N	\N	677.00	\N	\N	\N	\N	\N	f	f	3FS Mg/AM60B MASS PRODUCTION	t	2026-05-13 13:21:40.495988+07	2026-05-18 15:10:12.589114+07	\N
143	GS129-03810-D	\N	WEIGHT	\N	\N	\N	90.00	\N	\N	\N	\N	\N	f	f	MATERIAL:Fe 6H SIDE	t	2026-05-18 16:28:15.328899+07	2026-05-18 16:28:15.328899+07	\N
51	GS113-60050	\N	LEATHER NO. 3	\N	9-78301-01002	NH-1168L	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
52	GS113-60060	\N	LEATHER NO. 4	\N	9-78301-C1002	NH-1168L	27.00	\N	IN DRAWING	IN DRAWING	27	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 09:40:31.73331+07	2026-05-15 09:40:31.73331+07	\N
67	78500-DA000-0V0B	78500-3DA-J110-M1	WHEEL ASSY, STEERING(N)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(N) HEATER AUDIO CRUISE LEATER: NH-900L THREAD: EURO STITCH (NH-906L) TGT	t	2026-05-15 10:26:52.899022+07	2026-05-15 10:26:52.899022+07	\N
68	78500-DA010-0Y0B	78500-3DA-J310-M1	WHEEL ASSY, STEERING(C)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(C) HEATER AUDIO CRUISE LEATER:NH-1168L THREAD: EURO STITCH (NH-802L) TGT	t	2026-05-15 10:26:52.899022+07	2026-05-15 10:26:52.899022+07	\N
69	78500-DA020-0V0B	78500-3DA-Q110-M1	WHEEL ASSY, STEERING(L)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(L) HEATER AUDIO CRUISE LEATER: NH-900L THREAD: EURO STITCH (NH-906L) TGT	t	2026-05-15 10:26:52.899022+07	2026-05-15 10:26:52.899022+07	\N
70	78500-DA030-0Y0B	78500-3DAA-Q311-M1	WHEEL ASSY, STEERING(R)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(R) HEATER AUDIO CRUISE LEATER:NH-1168L THREAD: EURO STITCH (NH-802L) TGT	t	2026-05-15 10:26:52.899022+07	2026-05-15 10:26:52.899022+07	\N
71	78500-DA000-0Y0B	78500-3DA-J110-M1	WHEEL ASSY, STEERING(N)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(N) HEATER AUDIO CRUISE LEATER: NH-900L THREAD: EURO STITCH (NH-802L) TGT	t	2026-05-15 10:26:52.899022+07	2026-05-15 10:26:52.899022+07	\N
72	78500-DA010-0V0B	78500-3DA-J310-M1	WHEEL ASSY, STEERING(C)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(C) HEATER AUDIO CRUISE LEATER:NH-1168L THREAD: EURO STITCH (NH-906L) TGT	t	2026-05-15 10:26:52.899022+07	2026-05-15 10:26:52.899022+07	\N
73	78501-3DA-T700	GS110-88730-C	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	f	f	GRIP (HE) + LEATHER (NH-900L) + SPRING THREAD: NH-906L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
74	ANON-1778816368522-7	GS110-88710-C	GRIP (HE)	\N	\N	POLYESTER	1202.00	\N	NO	NO	0.3	\N	f	t	GRIP (LH) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD: EURO (NH-906L) TGZH	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
75	ANON-1778816368523-8	GS111-21760-A	GRIP (HE)	\N	LEPU-SWPU-F32	PU	977.00	\N	IN DRAWING	IN DRAWING	210	\N	f	f	PU FORM FOR GRIP (HE) HA78 BEFORE LEATHER WRAPPED TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
76	ANON-1778816368524-9	GS120-10170-B	HUB CORE	\N	5-10030-83000	Ingod	677.00	\N	IN DRAWING	JISH5303	\N	\N	f	f	3FS Mg/AM60B MASS PRODUCTION (TGT)	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
77	ANON-1778816368524-10	GS129-03810	WEIGHT	\N	\N	Fe	90.00	\N	\N	\N	90	\N	f	t	MATERIAL: Fe 6H SIDE TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
78	ANON-1778816368525-11	GS113-57020-B	LEATHER, STEERING WHEEL	\N	\N	POLYESTER	116.00	\N	IN DRAWING	IN DRAWING	0.6	\N	f	t	(HE) SYNTHETIC LEATHER LOOP (NH-900L) MIDORI THREAD (EURO): NH-906L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
79	ANON-1778816368525-12	GS113-56980	LEATHER NO. 1	\N	9-78301-C1001	\N	46.00	\N	IN DRAWING	IN DRAWING	46	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
80	ANON-1778816368526-13	GS113-56990	LEATHER NO.2	\N	9-78301-01001	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
81	ANON-1778816368527-14	GS113-57000	LEATHER NO. 3	\N	9-78301-C1001	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
82	ANON-1778816368527-15	GS113-57010	LEATHER NO. 4	\N	9-78301-01001	\N	27.00	\N	IN DRAWING	IN DRAWING	27	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
83	ANON-1778816368528-16	GS119-33430-C	HEATER PAD ASSY	\N	\N	\N	86.00	\N	NO	NO	\N	\N	f	f	KURABE HEATER PAD 3FS/3FR	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
84	ANON-1778816368529-17	GS129-02340-A	SNAP SPRING	\N	\N	\N	2.10	\N	NO	JISG3522	2.1	\N	f	t	GS129-01530 IS AVAILABLE, TOO. 11MY_SNAP_SPRING 2.0 Thai	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
85	ANON-1778816368530-19	77902-3MA-A111-M1	CORD HSW SUB	\N	\N	\N	93.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	HE POWER HARNESS, FUJIKURA (TGT)	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
86	ANON-1778816368530-20	93893-04012-17	SCREW-WASH, 4X12	\N	\N	\N	\N	\N	NO	NO	\N	\N	f	t	SCREW-WASH, 4X12	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
87	ANON-1778816368531-21	GS139-16610	SEAL	\N	\N	ADHESION SHEET	0.10	\N	\N	\N	0.1	\N	f	t	\N	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
88	ANON-1778816368532-22	GS131-21900-A	BODY COVER (WITH PDL)	\N	3-S1078-01001	TBJ4H-MF	86.00	\N	NO	NO	86	\N	f	f	3GJ BODY COVER TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
89	ANON-1778816368534-24	GS119-34330	LWR GARNISH	\N	3GJ-S/W-001	\N	11.10	\N	IN DRAWING	IN DRAWING	0.1	\N	f	f	PAINT NH-892L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
90	ANON-1778816368534-25	GS119-34320	LWR GARNISH	\N	3-84042-01001	TOYOLAC PX10-X07	11.00	\N	IN DRAWING	IN DRAWING	11	\N	f	f	LWR GNSH PC+ABS BEFOR PAINTING (Black) TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
91	ANON-1778816368535-26	78550-3MA-A113-M1	ASSY, HSW ECU	\N	\N	\N	36.00	\N	NO	NO	\N	\N	f	f	3FS ECU	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
92	ANON-1778816368536-27	GS129-03810	WEIGHT	\N	\N	Fe	90.00	\N	\N	\N	90	\N	f	t	MATERIAL: Fe 6H SIDE TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
142	GS129-03810-C	\N	WEIGHT	\N	\N	\N	90.00	\N	\N	\N	\N	\N	f	f	MATERIAL:Fe 6H SIDE	t	2026-05-18 16:24:28.667548+07	2026-05-18 16:24:28.667548+07	\N
93	ANON-1778816368536-28	GS113-57940-B	LEATHER, STEERING WHEEL	\N	\N	POLYESTER	116.00	\N	IN DRAWING	IN DRAWING	0.6	\N	f	t	(HE) SYNTHETIC LEATHER LOOP (NH-1168L) MIDORI THREAD (EURO): NH-802L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
94	ANON-1778816368537-29	GS113-57900-A	LEATHER NO. 1	\N	9-78301-01002	\N	46.00	\N	IN DRAWING	IN DRAWING	46	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
95	ANON-1778816368538-30	GS113-57910-A	LEATHER NO.2	\N	9-78301-C1002	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
96	ANON-1778816368538-31	GS113-57920-A	LEATHER NO. 3	\N	9-78301-C1002	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
97	ANON-1778816368539-32	GS113-57930-A	LEATHER NO. 4	\N	9-78301-01002	\N	27.00	\N	IN DRAWING	IN DRAWING	27	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
98	ANON-1778816368539-33	GS119-33430-C	HEATER PAD ASSY	\N	\N	\N	86.00	\N	NO	NO	\N	\N	f	f	KURABE HEATER PAD 3FS/3FR	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
99	ANON-1778816368540-34	GS129-02340-A	SNAP SPRING	\N	\N	\N	2.10	\N	NO	JISG3522	2.1	\N	f	t	GS129-01530 IS AVAILABLE, TOO. 11MY_SNAP_SPRING 2.0 Thai	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
100	78501-3DA-T900	GS110-89370-C	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	f	f	GRIP (HE) + LEATHER (NH-1168L) + SPRING THREAD: NH-802L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
101	ANON-1778816368541-36	GS110-89360-C	GRIP (HE)	\N	\N	POLYESTER	1202.00	\N	NO	NO	0.3	\N	f	t	GRIP (HE) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD: EURO (NH-802L) TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
102	ANON-1778816368542-37	GS111-21760-A	GRIP (HE)	\N	LEPU-SWPU-F32	PU	977.00	\N	IN DRAWING	IN DRAWING	210	\N	f	f	PU FORM FOR GRIP (HE) HA78 BEFORE LEATHER WRAPPED TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
103	ANON-1778816368542-38	GS120-10170-B	HUB CORE	\N	5-10030-83000	Ingod	677.00	\N	IN DRAWING	JISH5303	\N	\N	f	f	3FS Mg/AM60B MASS PRODUCTION (TGT)	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
104	ANON-1778816368543-39	GS129-03810	WEIGHT	\N	\N	Fe	90.00	\N	\N	\N	90	\N	f	t	MATERIAL: Fe 6H SIDE TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
105	ANON-1778816368543-40	GS113-59970	LEATHER, STEERING WHEEL	\N	\N	POLYESTER	116.00	\N	IN DRAWING	IN DRAWING	0.6	\N	f	t	(HE) SYNTHETIC LEATHER LOOP (NH-900L) MIDORI THREAD (EURO): NH-802L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
106	ANON-1778816368544-41	GS113-59990	LEATHER NO.1	\N	9-78301-01001	\N	46.00	\N	IN DRAWING	IN DRAWING	46	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
107	ANON-1778816368544-42	GS113-60000	LEATHER NO.2	\N	9-78301-01001	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
108	ANON-1778816368545-43	GS113-60010	LEATHER NO. 3	\N	9-78301-01001	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
109	ANON-1778816368545-44	GS113-60020	LEATHER NO.4	\N	9-78301-C1001	\N	27.00	\N	IN DRAWING	IN DRAWING	27	\N	f	f	(HE) SYNTHETIC LEATHER (NH-900L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
110	ANON-1778816368546-45	GS119-33430-C	HEATER PAD ASSY	\N	\N	\N	86.00	\N	NO	NO	\N	\N	f	f	KURABE HEATER PAD 3FS/3FR	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
111	ANON-1778816368547-46	GS129-02340-A	SNAP SPRING	\N	\N	\N	2.10	\N	NO	JISG3522	2.1	\N	f	t	GS129-01530 IS AVAILABLE, TOO. 11MY_SNAP_SPRING 2.0 Thai	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
112	ANON-1778816368548-48	GS110-91150-A	GRIP (HE)	\N	\N	POLYESTER	1202.00	\N	NO	NO	0.3	\N	f	t	GRIP (HE) + LEATHER HA80 AFTER LEATHER WRAPPED THREAD: EURO (NH-802L) TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
113	ANON-1778816368548-49	GS111-21760-A	GRIP (HE)	\N	LEPU-SWPU-F32	PU	977.00	\N	IN DRAWING	IN DRAWING	210	\N	f	f	PU FORM FOR GRIP (HE) HA78 BEFORE LEATHER WRAPPED TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
114	ANON-1778816368549-50	GS120-10170-B	HUB CORE	\N	5-10030-83000	Ingod	677.00	\N	IN DRAWING	JISH5303	\N	\N	f	f	3FS Mg/AM60B MASS PRODUCTION (TGT)	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
115	ANON-1778816368549-51	GS129-03810	WEIGHT	\N	\N	Fe	90.00	\N	\N	\N	90	\N	f	t	MATERIAL: Fe 6H SIDE TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
116	ANON-1778816368550-52	GS113-59980	LEATHER, STEERING WHEEL	\N	\N	POLYESTER	116.00	\N	IN DRAWING	IN DRAWING	0.6	\N	f	t	(HE) SYNTHETIC LEATHER LOOP (NH-1168L) MIDORI THREAD (EURO): NH-906L TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
117	ANON-1778816368550-53	GS113-60030	LEATHER NO. 1	\N	9-78301-01002	\N	46.00	\N	IN DRAWING	IN DRAWING	46	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
118	ANON-1778816368552-54	GS113-60040	LEATHER NO. 2	\N	9-78301-C1002	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
119	ANON-1778816368552-55	GS113-60050	LEATHER NO. 3	\N	9-78301-01002	\N	21.00	\N	IN DRAWING	IN DRAWING	21	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
120	ANON-1778816368553-56	GS113-60060	LEATHER NO. 4	\N	9-78301-C1002	\N	27.00	\N	IN DRAWING	IN DRAWING	27	\N	f	f	(HE) SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
121	ANON-1778816368553-57	GS119-33430-C	HEATER PAD ASSY	\N	\N	\N	86.00	\N	NO	NO	\N	\N	f	f	KURABE HEATER PAD 3FS/3FR	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
122	ANON-1778816368554-58	GS129-02340-A	SNAP SPRING	\N	\N	\N	2.10	\N	NO	JISG3522	2.1	\N	f	t	GS129-01530 IS AVAILABLE, TOO. 11MY_SNAP_SPRING 2.0 Thai	t	2026-05-15 10:39:28.484803+07	2026-05-15 10:39:28.484803+07	\N
123	ANON-1778817017075-18	GS131-21900-A	BODY COVER (WITH PDL)	\N	3-S1078-01001	TBJ4H-MF	86.00	\N	NO	NO	\N	\N	f	f	3GJ BODY COVER TGT	t	2026-05-15 10:50:17.031758+07	2026-05-15 10:50:17.031758+07	\N
124	78500-DA000-6000	78500-3DA-J110-M1	WHEEL ASSY, STEERING (N)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(N) HEATER AUDIO CRUISE LEATER:NH-900L TH READ: EURO STITCH (NH-906L) TGT	t	2026-05-15 12:05:44.944009+07	2026-05-15 12:05:44.944009+07	\N
125	GS110-9140-A	78501-3DA-T900	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	f	f	GRIP (HE) + LEATHER (NH-1168L) + SPRING TH READ: NH-906L TGT	t	2026-05-15 12:10:48.797514+07	2026-05-15 12:10:48.797514+07	\N
4	GS110-88710-D	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	\N	\N	\N	\N	f	f	GRIP(LH)+LEATHER HA80 AFTER LEATHER WRAPPED THREAD:EURO(NH-906L)	t	2026-05-13 13:21:40.495988+07	2026-05-18 15:10:34.701124+07	\N
127	GS110-88710-ก	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	\N	t	2026-05-18 15:11:51.291599+07	2026-05-18 15:13:16.398608+07	\N
129	GS111-21760-C	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	\N	t	2026-05-18 15:15:01.731469+07	2026-05-18 15:15:42.852015+07	\N
132	GS113-57020-C	\N	LEATHER, STEERING WHEEL	\N	\N	\N	116.00	\N	\N	\N	\N	\N	f	f	(HE)SYNTHETIC LEATHER LOOP(NH-900L) MIDORI THREAD(EURO):NH-906L	t	2026-05-18 15:20:00.004477+07	2026-05-18 15:20:00.004477+07	\N
133	GS129-03810-A	\N	WEIGHT	\N	\N	\N	90.00	\N	\N	\N	\N	\N	f	f	MATERIAL:Fe 6H SIDE	t	2026-05-18 15:22:12.709933+07	2026-05-18 15:22:12.709933+07	\N
134	GS119-34330-A	\N	BODY COVER (WITH PDL)	\N	\N	\N	86.00	\N	\N	\N	\N	\N	f	f	3GJ BODY COVER	t	2026-05-18 15:22:49.969852+07	2026-05-18 15:22:49.969852+07	\N
135	GS129-03810-B	\N	WEIGHT	\N	\N	\N	90.00	\N	\N	\N	\N	\N	f	f	MATERIAL:Fe 6H SIDE	t	2026-05-18 15:42:24.025305+07	2026-05-18 15:42:24.025305+07	\N
136	GS110-88730-D	\N	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	\N	\N	\N	\N	f	f	GRIP(HE) + LEATHER(NH-900L) + SPRING THREAD:NH-906L	t	2026-05-18 15:43:28.748676+07	2026-05-18 15:43:28.748676+07	\N
137	GS110-88730-E	\N	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	\N	\N	\N	\N	f	f	GRIP(HE) + LEATHER(NH-900L) + SPRING THREAD:NH-906L	t	2026-05-18 15:43:49.014332+07	2026-05-18 15:43:49.014332+07	\N
138	GS110-88730-F	\N	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	\N	\N	\N	\N	f	f	GRIP(HE) + LEATHER(NH-900L) + SPRING THREAD:NH-906L	t	2026-05-18 15:47:45.346908+07	2026-05-18 15:47:45.346908+07	\N
139	GG	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	\N	t	2026-05-18 16:10:17.714291+07	2026-05-18 16:10:17.714291+07	\N
140	GGEZ	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	\N	t	2026-05-18 16:11:53.709768+07	2026-05-18 16:11:53.709768+07	\N
164	xxxx-xxxx	\N	testt	\N	\N	\N	43.00	\N	\N	\N	\N	\N	f	f	estt	t	2026-05-20 13:57:09.321969+07	2026-05-22 16:20:56.957301+07	/uploads/parts/1779441656898-image.png
153	\N	\N	test	\N	\N	\N	10.00	\N	\N	\N	\N	\N	f	f	test	t	2026-05-20 10:00:40.046865+07	2026-05-20 10:00:40.046865+07	/uploads/parts/1779246039997-1.jpg
155	(xxxx-xxx)	\N	test	\N	\N	\N	20.00	\N	\N	\N	\N	\N	f	f	testt	t	2026-05-20 10:27:21.03613+07	2026-05-20 10:27:21.03613+07	/uploads/parts/1779247640985-image.png
156	\N	\N	t	\N	\N	\N	3.00	\N	\N	\N	\N	\N	f	f	t	t	2026-05-20 10:30:16.469445+07	2026-05-20 10:30:16.469445+07	/uploads/parts/1779247816419-image.png
1	78500-DA000-6V00	78500-3DA-J110-M1	WHEEL ASSY, STEERING (N)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(N)HEATER AUDIO CRUISE LEATER:NH-900L TH READ:EURO STITCH(NH-906L) TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
2	78500-DA010-6Y00	78500-3DA-J310-M1	WHEEL ASSY, STEERING (C)	\N	\N	\N	1727.00	\N	IN DRAWING	NO	\N	\N	f	f	(C)HEATER AUDIO CRUISE LEATER:NH-1168L T HREAD:EURO STITCH(NH-802L) TG	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
3	GS110-88730-C	\N	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	f	f	GRIP(HE) + LEATHER(NH-900L) + SPRING THR EAD:NH-906L TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
130	GS110-88710-C	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	GRIP(LH) + LEATHER HA80 AFTER LEATHER WR APPED THREAD:EURO(NH-906L) TGZH	t	2026-05-18 15:15:51.165179+07	2026-05-25 08:37:17.963138+07	\N
154	(xxx-xxx)	\N	test	\N	\N	\N	20.00	\N	\N	\N	\N	\N	f	f	test	t	2026-05-20 10:01:27.76139+07	2026-05-20 11:08:03.789163+07	/uploads/parts/1779250083740-image.png
157	xxx-xxx	\N	test	\N	\N	\N	45.00	\N	\N	\N	\N	\N	f	f	tsetst	t	2026-05-20 12:32:37.176314+07	2026-05-20 12:32:37.176314+07	/uploads/parts/1779255157128-CyberMaze_flowchart.drawio.png
158	GS120-10170-D	\N	HUB CORE	\N	\N	\N	677.00	\N	\N	\N	\N	\N	f	f	3FS Mg/AM60B MASS PRODUCTION	t	2026-05-20 12:58:19.636553+07	2026-05-20 12:58:19.636553+07	\N
159	GS131-21900-B	\N	BODY COVER (WITH PDL)	\N	\N	\N	86.00	\N	\N	\N	\N	\N	f	f	3GJ BODY COVER	t	2026-05-20 12:58:31.700391+07	2026-05-20 12:58:31.700391+07	\N
160	GS119-33430-D	\N	HEATER PAD ASSY	\N	\N	\N	86.00	\N	\N	\N	\N	\N	f	f	KURABE HEATER PAD 3FS/3FR	t	2026-05-20 12:58:39.437381+07	2026-05-20 12:58:39.437381+07	\N
161	GS139-16610-A	\N	SEAL	\N	\N	\N	0.10	\N	\N	\N	\N	\N	f	f	ADHESION SHEET PAPER	t	2026-05-20 12:59:00.101379+07	2026-05-20 12:59:00.101379+07	\N
162	GS113-57020-D	\N	LEATHER, STEERING WHEEL	\N	\N	\N	116.00	\N	\N	\N	\N	\N	f	f	(HE)SYNTHETIC LEATHER LOOP(NH-900L) MIDORI THREAD(EURO):NH-906L	t	2026-05-20 13:27:42.422602+07	2026-05-20 13:27:42.422602+07	\N
163	GS111-21760-D	\N	GRIP (HE)	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	t	\N	t	2026-05-20 13:36:06.111921+07	2026-05-20 13:36:06.111921+07	\N
165	GS113-56980-A	\N	LEATHER NO.1	\N	\N	\N	46.00	\N	\N	\N	\N	\N	f	f	(HE)SYNTHETIC LEATHER (NH-900L) MIDORI	t	2026-05-20 14:08:21.461201+07	2026-05-20 14:08:21.461201+07	\N
166	xxxx-xxxxx	\N	test	\N	\N	\N	23.00	\N	\N	\N	\N	\N	f	f	setst	t	2026-05-20 14:55:15.609687+07	2026-05-20 14:55:15.609687+07	/uploads/parts/1779263715518-image.png
167	GS110-88730-A	\N	GRIP COMP (HE)	\N	\N	\N	1208.00	\N	\N	\N	\N	\N	f	f	GRIP(HE) + LEATHER(NH-900L) + SPRING THREAD:NH-906L	t	2026-05-21 08:18:58.846754+07	2026-05-21 08:18:58.846754+07	\N
168	xxxxx-xxxxxx	\N	mmm	\N	\N	\N	20.00	\N	\N	\N	\N	\N	f	f	mmmm	t	2026-05-21 09:09:11.172146+07	2026-05-21 09:09:11.172146+07	/uploads/parts/1779329351121-cybermaze_modules_infographic_v2.png
169	(xxxx-xxxx)	\N	test	\N	\N	\N	250.00	\N	\N	\N	\N	\N	f	f	test	t	2026-05-21 12:21:07.690633+07	2026-05-21 12:24:54.925393+07	/uploads/parts/1779341094875-image.png
170	XXXX-XXXX	\N	testt	\N	\N	\N	23.00	\N	\N	\N	\N	\N	f	f	setsetst	t	2026-05-21 12:26:07.068174+07	2026-05-21 12:26:07.068174+07	/uploads/parts/1779341167018-8.6.jpg
126	GS111-21760-A	\N	GRIP (HE)	\N	\N	\N	977.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	PU FORM FOR GRIP(HE) HA78 BEFORE LEATHER WRAPPED TGT	t	2026-05-18 15:09:45.932479+07	2026-05-25 08:37:17.963138+07	\N
128	GS120-10170-B	\N	HUB CORE	\N	\N	\N	677.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	\N	t	2026-05-18 15:11:51.291599+07	2026-05-25 08:37:17.963138+07	\N
8	GS113-57020-B	\N	LEATHER, STEERING WHEEL	\N	\N	\N	116.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	(HE)SYNTHETIC LEATHER LOOP(NH-900L) MIDO RI THREAD(EURO):NH-906L TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
9	GS113-56980	\N	LEATHER NO.1	\N	\N	\N	46.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	(HE)SYNTHETIC LEATHER (NH-900L) MIDORI T GT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
10	GS113-56990	\N	LEATHER NO.2	\N	\N	\N	21.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	GT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
25	GS110-89360-C	\N	GRIP (HE) Gray	\N	\N	\N	1202.00	\N	NO	NO	\N	\N	f	f	APPED THREAD:EURO(NH-802L) TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
26	GS113-57940-B	\N	LEATHER, STEERING WHEEL Gray	\N	\N	\N	116.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	ORI THREAD(EURO):NH-802L TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
27	GS113-57900-A	\N	LEATHER NO.1 Gray	\N	\N	\N	46.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
28	GS113-57910-A	\N	LEATHER NO.2 Gray	\N	\N	\N	21.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
29	GS113-57920-A	\N	LEATHER NO.3 Gray	\N	\N	\N	21.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	(HE)SYNTHETIC LEATHER (NH-1168L) MIDORI TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
30	GS113-57930-A	\N	LEATHER NO.4 Gray	\N	\N	\N	27.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
11	GS113-57000	\N	LEATHER NO.3	\N	\N	\N	21.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	GT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
12	GS113-57010	\N	LEATHER NO.4	\N	\N	\N	27.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	(HE)SYNTHETIC LEATHER (NH-900L) MIDORI T GT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
13	GS119-33430-C	\N	HEATER PAD ASSY	\N	\N	\N	86.00	\N	NO	NO	\N	\N	f	f	KURABE HEATER PAD 3FS/3FR	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
14	GS129-02340-A	\N	SNAP SPRING	\N	\N	\N	2.10	\N	NO	NO	\N	\N	f	f	GS129-01530 IS AVAILABLE,TOO. 11MY_SNAP_ SPRING_φ2.0 Thai	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
15	GS131-21900-A	\N	BODY COVER (WITH PDL)	\N	\N	\N	86.00	\N	NO	NO	\N	\N	f	f	3GJ BODY COVER TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
16	35880-MAB30	35880-3MA-B310-M1	SW ASSY, STRG	\N	\N	\N	263.00	\N	NO	NO	\N	\N	f	f	HM SUPPLY PARTS	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
17	GS119-34330	\N	LWR GARNISH	\N	\N	\N	11.10	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	3GJ-S/W-001	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
18	GS119-34320	\N	LWR GARNISH (PC+ABS)	\N	\N	\N	11.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	T	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
19	GE400-01540-B	78550-3MA-A113-M1	ASSY, HSW ECU	\N	\N	\N	36.00	\N	NO	NO	\N	\N	f	f	3FS ECU	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
20	78560-DAH80	78560-3DA-H810-M1	SW ASSY, PADDLE SHIFT	\N	\N	\N	100.00	\N	NO	NO	\N	\N	f	f	\N	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
21	GS250-02000-A	77902-3MA-A111-M1	CORD HSW SUB	\N	\N	\N	9.00	\N	IN DRAWING	IN DRAWING	\N	\N	f	f	HE POWER HARNESS, FUJIKURA (TGT)	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
22	GK110-A0100	93893-04012-17	SCREW-WASH 4X12	\N	\N	\N	2.00	\N	NO	NO	\N	\N	f	f	\N	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
23	GS139-16610	\N	SEAL	\N	\N	\N	0.10	\N	\N	\N	\N	\N	f	f	\N	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
24	GS110-89370-C	78501-3DA-T900	GRIP COMP (HE) Gray	\N	\N	\N	1208.00	\N	NO	NO	\N	\N	f	f	GRIP(HE) + LEATHER(NH-1168L) + SPRING TH READ:NH-802L TGT	t	2026-05-13 13:21:40.495988+07	2026-05-25 08:37:17.963138+07	\N
\.


--
-- Data for Name: part_revision; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.part_revision (part_rev_id, part_id, revision_suffix, effective_date, eci_no, change_reason, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: product_variant; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.product_variant (variant_id, design_spec_id, variant_key, customer_part_no, tg_part_no, part_name, leather_color_id, thread_color_id, stitch_style, mass_gram, notes, created_at) FROM stdin;
354	21	1	78500-3DA-J110-M1	78500-DA000-6V00	WHEEL ASSY,STEERING(N)	\N	\N	\N	1727.00	\N	2026-05-25 08:37:17.963138+07
355	21	2	78500-3DA-J310-M1	78500-DA010-6Y00	WHEEL ASSY,STEERING(C)	\N	\N	\N	1727.00	\N	2026-05-25 08:37:17.963138+07
\.


--
-- Data for Name: regulation_record; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.regulation_record (reg_record_id, part_id, reg_type, certification_no, valid_from, valid_to, notes, created_at) FROM stdin;
\.


--
-- Data for Name: supplier; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.supplier (supplier_id, supplier_code, supplier_name, is_local, created_at) FROM stdin;
\.


--
-- Data for Name: thread_spec; Type: TABLE DATA; Schema: tg; Owner: postgres
--

COPY tg.thread_spec (thread_spec_id, part_id, thread_color_id, thread_material, ace_crown_grade, ace_crown_code, stitch_style, mass_gram, notes) FROM stdin;
\.


--
-- Name: approval_tokens_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.approval_tokens_id_seq', 50, true);


--
-- Name: bom_bom_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.bom_bom_id_seq', 7211, true);


--
-- Name: bom_document_bom_doc_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.bom_document_bom_doc_id_seq', 1, true);


--
-- Name: bom_item_history_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.bom_item_history_id_seq', 79, true);


--
-- Name: bom_line_bom_line_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.bom_line_bom_line_id_seq', 1, false);


--
-- Name: bom_revision_revision_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.bom_revision_revision_id_seq', 82, true);


--
-- Name: color_color_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.color_color_id_seq', 6, true);


--
-- Name: customer_customer_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.customer_customer_id_seq', 9, true);


--
-- Name: design_spec_design_spec_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.design_spec_design_spec_id_seq', 21, true);


--
-- Name: design_spec_tgt_history_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.design_spec_tgt_history_id_seq', 2, true);


--
-- Name: eci_history_eci_history_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.eci_history_eci_history_id_seq', 1, false);


--
-- Name: heater_pad_heater_pad_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.heater_pad_heater_pad_id_seq', 1, false);


--
-- Name: leather_detail_leather_detail_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.leather_detail_leather_detail_id_seq', 1, false);


--
-- Name: material_type_material_type_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.material_type_material_type_id_seq', 9, true);


--
-- Name: model_model_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.model_model_id_seq', 9, true);


--
-- Name: part_part_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.part_part_id_seq', 170, true);


--
-- Name: part_revision_part_rev_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.part_revision_part_rev_id_seq', 1, false);


--
-- Name: product_variant_variant_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.product_variant_variant_id_seq', 355, true);


--
-- Name: regulation_record_reg_record_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.regulation_record_reg_record_id_seq', 1, false);


--
-- Name: supplier_supplier_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.supplier_supplier_id_seq', 1, false);


--
-- Name: thread_spec_thread_spec_id_seq; Type: SEQUENCE SET; Schema: tg; Owner: postgres
--

SELECT pg_catalog.setval('tg.thread_spec_thread_spec_id_seq', 1, false);


--
-- Name: approval_tokens approval_tokens_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.approval_tokens
    ADD CONSTRAINT approval_tokens_pkey PRIMARY KEY (id);


--
-- Name: approval_tokens approval_tokens_token_key; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.approval_tokens
    ADD CONSTRAINT approval_tokens_token_key UNIQUE (token);


--
-- Name: bom_document bom_document_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_document
    ADD CONSTRAINT bom_document_pkey PRIMARY KEY (bom_doc_id);


--
-- Name: bom_item_history bom_item_history_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_item_history
    ADD CONSTRAINT bom_item_history_pkey PRIMARY KEY (id);


--
-- Name: bom_line bom_line_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_line
    ADD CONSTRAINT bom_line_pkey PRIMARY KEY (bom_line_id);


--
-- Name: bom bom_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom
    ADD CONSTRAINT bom_pkey PRIMARY KEY (bom_id);


--
-- Name: bom_revision bom_revision_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_revision
    ADD CONSTRAINT bom_revision_pkey PRIMARY KEY (revision_id);


--
-- Name: color color_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.color
    ADD CONSTRAINT color_pkey PRIMARY KEY (color_id);


--
-- Name: customer customer_customer_code_key; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.customer
    ADD CONSTRAINT customer_customer_code_key UNIQUE (customer_code);


--
-- Name: customer customer_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (customer_id);


--
-- Name: design_spec design_spec_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec
    ADD CONSTRAINT design_spec_pkey PRIMARY KEY (design_spec_id);


--
-- Name: design_spec_tgt_history design_spec_tgt_history_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec_tgt_history
    ADD CONSTRAINT design_spec_tgt_history_pkey PRIMARY KEY (id);


--
-- Name: eci_history eci_history_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.eci_history
    ADD CONSTRAINT eci_history_pkey PRIMARY KEY (eci_history_id);


--
-- Name: heater_pad heater_pad_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.heater_pad
    ADD CONSTRAINT heater_pad_pkey PRIMARY KEY (heater_pad_id);


--
-- Name: leather_detail leather_detail_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.leather_detail
    ADD CONSTRAINT leather_detail_pkey PRIMARY KEY (leather_detail_id);


--
-- Name: material_type material_type_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.material_type
    ADD CONSTRAINT material_type_pkey PRIMARY KEY (material_type_id);


--
-- Name: model model_model_code_key; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.model
    ADD CONSTRAINT model_model_code_key UNIQUE (model_code);


--
-- Name: model model_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.model
    ADD CONSTRAINT model_pkey PRIMARY KEY (model_id);


--
-- Name: part part_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part
    ADD CONSTRAINT part_pkey PRIMARY KEY (part_id);


--
-- Name: part_revision part_revision_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part_revision
    ADD CONSTRAINT part_revision_pkey PRIMARY KEY (part_rev_id);


--
-- Name: product_variant product_variant_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.product_variant
    ADD CONSTRAINT product_variant_pkey PRIMARY KEY (variant_id);


--
-- Name: regulation_record regulation_record_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.regulation_record
    ADD CONSTRAINT regulation_record_pkey PRIMARY KEY (reg_record_id);


--
-- Name: supplier supplier_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.supplier
    ADD CONSTRAINT supplier_pkey PRIMARY KEY (supplier_id);


--
-- Name: thread_spec thread_spec_pkey; Type: CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.thread_spec
    ADD CONSTRAINT thread_spec_pkey PRIMARY KEY (thread_spec_id);


--
-- Name: idx_bom_child; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_bom_child ON tg.bom USING btree (child_part_id);


--
-- Name: idx_bom_design_spec; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_bom_design_spec ON tg.bom USING btree (design_spec_id);


--
-- Name: idx_bom_line_doc; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_bom_line_doc ON tg.bom_line USING btree (bom_doc_id);


--
-- Name: idx_bom_parent; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_bom_parent ON tg.bom USING btree (parent_part_id);


--
-- Name: idx_bom_revision_ds; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_bom_revision_ds ON tg.bom_revision USING btree (design_spec_id, sort_order);


--
-- Name: idx_bom_variant; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_bom_variant ON tg.bom USING btree (variant_id);


--
-- Name: idx_eci_design_spec; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_eci_design_spec ON tg.eci_history USING btree (design_spec_id);


--
-- Name: idx_leather_part; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_leather_part ON tg.leather_detail USING btree (part_id);


--
-- Name: idx_part_name; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_part_name ON tg.part USING btree (part_name);


--
-- Name: idx_part_rev_part; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_part_rev_part ON tg.part_revision USING btree (part_id);


--
-- Name: idx_reg_record_part; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_reg_record_part ON tg.regulation_record USING btree (part_id);


--
-- Name: idx_thread_part; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE INDEX idx_thread_part ON tg.thread_spec USING btree (part_id);


--
-- Name: ux_part_tg_part_no; Type: INDEX; Schema: tg; Owner: postgres
--

CREATE UNIQUE INDEX ux_part_tg_part_no ON tg.part USING btree (tg_part_no);


--
-- Name: part trg_part_updated_at; Type: TRIGGER; Schema: tg; Owner: postgres
--

CREATE TRIGGER trg_part_updated_at BEFORE UPDATE ON tg.part FOR EACH ROW EXECUTE FUNCTION tg.fn_set_updated_at();


--
-- Name: bom bom_child_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom
    ADD CONSTRAINT bom_child_part_id_fkey FOREIGN KEY (child_part_id) REFERENCES tg.part(part_id);


--
-- Name: bom bom_design_spec_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom
    ADD CONSTRAINT bom_design_spec_id_fkey FOREIGN KEY (design_spec_id) REFERENCES tg.design_spec(design_spec_id);


--
-- Name: bom_document bom_document_design_spec_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_document
    ADD CONSTRAINT bom_document_design_spec_id_fkey FOREIGN KEY (design_spec_id) REFERENCES tg.design_spec(design_spec_id);


--
-- Name: bom_item_history bom_item_history_bom_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_item_history
    ADD CONSTRAINT bom_item_history_bom_id_fkey FOREIGN KEY (bom_id) REFERENCES tg.bom(bom_id) ON DELETE CASCADE;


--
-- Name: bom_line bom_line_bom_doc_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_line
    ADD CONSTRAINT bom_line_bom_doc_id_fkey FOREIGN KEY (bom_doc_id) REFERENCES tg.bom_document(bom_doc_id);


--
-- Name: bom_line bom_line_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_line
    ADD CONSTRAINT bom_line_part_id_fkey FOREIGN KEY (part_id) REFERENCES tg.part(part_id);


--
-- Name: bom_line bom_line_supplier_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_line
    ADD CONSTRAINT bom_line_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES tg.supplier(supplier_id);


--
-- Name: bom bom_parent_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom
    ADD CONSTRAINT bom_parent_part_id_fkey FOREIGN KEY (parent_part_id) REFERENCES tg.part(part_id);


--
-- Name: bom_revision bom_revision_design_spec_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom_revision
    ADD CONSTRAINT bom_revision_design_spec_id_fkey FOREIGN KEY (design_spec_id) REFERENCES tg.design_spec(design_spec_id) ON DELETE CASCADE;


--
-- Name: bom bom_variant_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.bom
    ADD CONSTRAINT bom_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES tg.product_variant(variant_id);


--
-- Name: design_spec design_spec_customer_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec
    ADD CONSTRAINT design_spec_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES tg.customer(customer_id);


--
-- Name: design_spec design_spec_model_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec
    ADD CONSTRAINT design_spec_model_id_fkey FOREIGN KEY (model_id) REFERENCES tg.model(model_id);


--
-- Name: design_spec_tgt_history design_spec_tgt_history_design_spec_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.design_spec_tgt_history
    ADD CONSTRAINT design_spec_tgt_history_design_spec_id_fkey FOREIGN KEY (design_spec_id) REFERENCES tg.design_spec(design_spec_id) ON DELETE CASCADE;


--
-- Name: eci_history eci_history_design_spec_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.eci_history
    ADD CONSTRAINT eci_history_design_spec_id_fkey FOREIGN KEY (design_spec_id) REFERENCES tg.design_spec(design_spec_id);


--
-- Name: heater_pad heater_pad_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.heater_pad
    ADD CONSTRAINT heater_pad_part_id_fkey FOREIGN KEY (part_id) REFERENCES tg.part(part_id);


--
-- Name: leather_detail leather_detail_color_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.leather_detail
    ADD CONSTRAINT leather_detail_color_id_fkey FOREIGN KEY (color_id) REFERENCES tg.color(color_id);


--
-- Name: leather_detail leather_detail_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.leather_detail
    ADD CONSTRAINT leather_detail_part_id_fkey FOREIGN KEY (part_id) REFERENCES tg.part(part_id);


--
-- Name: part part_color_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part
    ADD CONSTRAINT part_color_id_fkey FOREIGN KEY (color_id) REFERENCES tg.color(color_id);


--
-- Name: part part_material_type_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part
    ADD CONSTRAINT part_material_type_id_fkey FOREIGN KEY (material_type_id) REFERENCES tg.material_type(material_type_id);


--
-- Name: part_revision part_revision_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.part_revision
    ADD CONSTRAINT part_revision_part_id_fkey FOREIGN KEY (part_id) REFERENCES tg.part(part_id);


--
-- Name: product_variant product_variant_design_spec_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.product_variant
    ADD CONSTRAINT product_variant_design_spec_id_fkey FOREIGN KEY (design_spec_id) REFERENCES tg.design_spec(design_spec_id);


--
-- Name: product_variant product_variant_leather_color_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.product_variant
    ADD CONSTRAINT product_variant_leather_color_id_fkey FOREIGN KEY (leather_color_id) REFERENCES tg.color(color_id);


--
-- Name: product_variant product_variant_thread_color_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.product_variant
    ADD CONSTRAINT product_variant_thread_color_id_fkey FOREIGN KEY (thread_color_id) REFERENCES tg.color(color_id);


--
-- Name: regulation_record regulation_record_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.regulation_record
    ADD CONSTRAINT regulation_record_part_id_fkey FOREIGN KEY (part_id) REFERENCES tg.part(part_id);


--
-- Name: thread_spec thread_spec_part_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.thread_spec
    ADD CONSTRAINT thread_spec_part_id_fkey FOREIGN KEY (part_id) REFERENCES tg.part(part_id);


--
-- Name: thread_spec thread_spec_thread_color_id_fkey; Type: FK CONSTRAINT; Schema: tg; Owner: postgres
--

ALTER TABLE ONLY tg.thread_spec
    ADD CONSTRAINT thread_spec_thread_color_id_fkey FOREIGN KEY (thread_color_id) REFERENCES tg.color(color_id);


--
-- PostgreSQL database dump complete
--

\unrestrict aBnlySRxCYRodNXlq1lwyZh7Yjzqa6oO4eDqOPvMkvADqe2Exga0y4M0WCceRvy

