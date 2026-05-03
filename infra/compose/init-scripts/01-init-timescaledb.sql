-- MES PostgreSQL init script
-- Runs once when the postgres container is first created.
-- Creates the TimescaleDB extension and the machine_telemetry hypertable
-- per ADR-001 Decision 4.

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ─── machine_telemetry hypertable ─────────────────────────────────────────
-- ADR-001: Hypertables with automatic time-partitioning on (ts, machine_id).
-- Continuous Aggregates (1-min, 1-hour, 1-day OEE rollups) are created in
-- Drizzle migrations during GST Phase 2.

CREATE TABLE IF NOT EXISTS machine_telemetry (
  ts         TIMESTAMPTZ      NOT NULL,
  machine_id TEXT             NOT NULL,  -- human-readable IDs (e.g. machine-mock-001)
  metric     TEXT             NOT NULL,
  value      DOUBLE PRECISION,
  tags       JSONB
);

SELECT create_hypertable(
  'machine_telemetry',
  'ts',
  if_not_exists => TRUE
);

-- Deduplication constraint: QoS-1 MQTT guarantees at-least-once delivery;
-- the unique constraint prevents duplicate rows from broker reconnect redelivery.
-- TimescaleDB requires the partition key (ts) in all unique constraints.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_event
  ON machine_telemetry (machine_id, ts, metric);

-- Index for fast per-machine queries
CREATE INDEX IF NOT EXISTS idx_telemetry_machine_ts
  ON machine_telemetry (machine_id, ts DESC);

-- ─── Core MES tables ──────────────────────────────────────────────────────
-- Full schema as of GST-115. Drizzle-kit migrations are in packages/db/migrations/.

-- machine_status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'machine_status') THEN
    CREATE TYPE machine_status AS ENUM (
      'running', 'idle', 'fault', 'maintenance', 'disconnected'
    );
  END IF;
END$$;

-- Machines registry
-- id is TEXT to match machine_telemetry.machine_id for direct OEE JOINs.
CREATE TABLE IF NOT EXISTS machines (
  id                   TEXT          PRIMARY KEY,
  name                 TEXT          NOT NULL,
  description          TEXT,
  type                 TEXT,
  line_id              TEXT,
  ideal_rate_per_min   DOUBLE PRECISION,
  status               machine_status NOT NULL DEFAULT 'disconnected',
  metadata             JSONB          NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_machines_status  ON machines (status);
CREATE INDEX IF NOT EXISTS idx_machines_line_id ON machines (line_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_machines_updated_at ON machines;
CREATE TRIGGER trg_machines_updated_at
  BEFORE UPDATE ON machines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- work_order_status enum (matches Drizzle schema)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_order_status') THEN
    CREATE TYPE work_order_status AS ENUM (
      'draft', 'released', 'in_progress', 'paused', 'completed', 'cancelled'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS work_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_number  TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  product_id         TEXT NOT NULL,
  quantity           NUMERIC(12, 4) NOT NULL,
  unit               TEXT NOT NULL DEFAULT 'pcs',
  scheduled_start    TIMESTAMPTZ NOT NULL,
  scheduled_end      TIMESTAMPTZ NOT NULL,
  actual_start       TIMESTAMPTZ,
  actual_end         TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'draft',
  machine_id         TEXT REFERENCES machines(id),
  bom_id             TEXT,
  erp_reference      TEXT,
  notes              TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_status     ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_work_orders_machine_id ON work_orders (machine_id);

-- ─── Seed data for local dev ───────────────────────────────────────────────

INSERT INTO machines (id, name, description, type, line_id, ideal_rate_per_min, status) VALUES
  ('machine-mock-001',    'CNC Lathe Alpha',        'CNC turning centre, 3-axis',       'cnc',     'line-001',         10, 'running'),
  ('machine-mock-002',    'Milling Station Beta',   '5-axis milling centre',             'cnc',     'line-001',          8, 'idle'),
  ('machine-mock-003',    'Assembly Robot Gamma',   '6-DOF collaborative robot',         'robot',   'line-002',         15, 'fault'),
  ('machine-reactor-001', 'Batch Reactor R-101',    '500 L glass-lined batch reactor',   'reactor', 'line-process-001',  2, 'running'),
  ('machine-reactor-002', 'Continuous Mixer CM-201','Inline high-shear mixer',            'mixer',   'line-process-001',  5, 'idle'),
  ('machine-dryer-001',   'Spray Dryer SD-301',     'Co-current spray dryer, 50 kg/h',   'dryer',   'line-process-002',  3, 'running')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (work_order_number, title, product_id, quantity, unit, scheduled_start, scheduled_end, status, machine_id) VALUES
  ('WO-2026-001', 'Produce Widget Alpha — Batch 1', 'prod-widget-alpha', 500, 'pcs',
    NOW(), NOW() + INTERVAL '8 hours', 'in_progress', 'machine-mock-001'),
  ('WO-2026-002', 'Produce Widget Beta — Rework', 'prod-widget-beta', 120, 'pcs',
    NOW(), NOW() + INTERVAL '8 hours', 'released', 'machine-mock-002')
ON CONFLICT (work_order_number) DO NOTHING;
