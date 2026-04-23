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
  machine_id UUID             NOT NULL,
  metric     TEXT             NOT NULL,
  value      DOUBLE PRECISION,
  tags       JSONB
);

SELECT create_hypertable(
  'machine_telemetry',
  'ts',
  if_not_exists => TRUE
);

-- Index for fast per-machine queries
CREATE INDEX IF NOT EXISTS idx_telemetry_machine_ts
  ON machine_telemetry (machine_id, ts DESC);

-- ─── Core MES tables (stub schema) ────────────────────────────────────────
-- Full Drizzle-managed migrations ship in GST Phase 2 (GST-8).
-- These stubs let Docker healthchecks pass and basic queries succeed on day 1.

CREATE TABLE IF NOT EXISTS machines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'disconnected',
  line_id     UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_number  TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  product_id         TEXT NOT NULL,
  quantity           NUMERIC(12, 4) NOT NULL,
  unit               TEXT NOT NULL,
  scheduled_start    TIMESTAMPTZ NOT NULL,
  scheduled_end      TIMESTAMPTZ NOT NULL,
  actual_start       TIMESTAMPTZ,
  actual_end         TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'draft',
  machine_id         UUID REFERENCES machines(id),
  bom_id             TEXT,
  notes              TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Seed data for local dev ───────────────────────────────────────────────

INSERT INTO machines (id, name, status, line_id) VALUES
  ('00000000-0000-0000-0000-000000000001', 'CNC Lathe Alpha',       'running',      '00000000-0000-0000-0001-000000000001'),
  ('00000000-0000-0000-0000-000000000002', 'Milling Station Beta',  'idle',         '00000000-0000-0000-0001-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'Assembly Robot Gamma',  'fault',        '00000000-0000-0000-0001-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (id, work_order_number, title, product_id, quantity, unit, scheduled_start, scheduled_end, status, machine_id) VALUES
  ('00000000-0000-0000-0001-000000000001', 'WO-2026-001', 'Produce Widget Alpha — Batch 1', 'prod-widget-alpha', 500, 'pcs',
    NOW(), NOW() + INTERVAL '8 hours', 'in_progress', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0001-000000000002', 'WO-2026-002', 'Produce Widget Beta — Rework', 'prod-widget-beta', 120, 'pcs',
    NOW(), NOW() + INTERVAL '8 hours', 'released', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (work_order_number) DO NOTHING;
