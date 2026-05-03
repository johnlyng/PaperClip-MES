-- Migration: 0001_machines
-- Replaces the stub machines table (from 01-init-timescaledb.sql) with the full schema.
--
-- The stub used id UUID; we switch to TEXT to match machine_telemetry.machine_id
-- so OEE queries can JOIN directly without a separate lookup column.
-- work_orders.machine_id stays UUID because it references the logical work-order
-- assignment (which may differ from telemetry identity), but the FK is app-enforced
-- (not DB-level) so DROP CASCADE is safe for local dev.
--
-- For fresh Docker environments, 01-init-timescaledb.sql is updated to match this
-- schema directly — this file is for upgrading existing running dev instances.

-- 1. Drop the stub (CASCADE removes the FK reference from work_orders)
DROP TABLE IF EXISTS machines CASCADE;

-- 2. Create the machine_status enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'machine_status') THEN
    CREATE TYPE machine_status AS ENUM (
      'running',
      'idle',
      'fault',
      'maintenance',
      'disconnected'
    );
  END IF;
END$$;

-- 3. Create the full machines table
CREATE TABLE machines (
  id                TEXT         PRIMARY KEY,
  name              TEXT         NOT NULL,
  description       TEXT,
  type              TEXT,
  line_id           TEXT,
  ideal_rate_per_min DOUBLE PRECISION,
  status            machine_status NOT NULL DEFAULT 'disconnected',
  metadata          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_machines_status  ON machines (status);
CREATE INDEX idx_machines_line_id ON machines (line_id);

-- 4. updated_at trigger (mirrors work_orders trigger pattern)
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

-- 5. Seed rows matching the test-fixtures MACHINES constant
--    (IDs match machine_telemetry.machine_id for OEE correlation)
INSERT INTO machines (id, name, description, type, line_id, ideal_rate_per_min, status) VALUES
  ('machine-mock-001',    'CNC Lathe Alpha',       'CNC turning centre, 3-axis',      'cnc',     'line-001',         10,  'running'),
  ('machine-mock-002',    'Milling Station Beta',  '5-axis milling centre',            'cnc',     'line-001',          8,  'idle'),
  ('machine-mock-003',    'Assembly Robot Gamma',  '6-DOF collaborative robot',        'robot',   'line-002',         15,  'fault'),
  ('machine-reactor-001', 'Batch Reactor R-101',   '500 L glass-lined batch reactor',  'reactor', 'line-process-001',  2,  'running'),
  ('machine-reactor-002', 'Continuous Mixer CM-201','Inline high-shear mixer',          'mixer',   'line-process-001',  5,  'idle'),
  ('machine-dryer-001',   'Spray Dryer SD-301',    'Co-current spray dryer, 50 kg/h',  'dryer',   'line-process-002',  3,  'running')
ON CONFLICT (id) DO NOTHING;
