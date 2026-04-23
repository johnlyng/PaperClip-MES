-- 02-oee-aggregates.sql
-- OEE Continuous Aggregates for TimescaleDB
-- GST-18: OEE & Machine Monitoring Engine
--
-- Creates three layers of OEE rollups as TimescaleDB Continuous Aggregates:
--   1. oee_1min  — 1-minute buckets (near-real-time)
--   2. oee_1hour — 1-hour buckets (shift visibility)
--   3. oee_1day  — 1-day buckets (daily reporting)
--
-- Metrics published by machines (via MQTT → machine_telemetry):
--   status         : 1.0 = running, 0.0 = stopped/fault/maintenance
--   output_count   : number of units produced this interval
--   good_count     : number of good (non-scrap) units this interval
--
-- OEE components computed in application layer from these rollups:
--   Availability = avg_status (fraction of interval the machine was running)
--   Performance  = output_count / (interval_minutes * ideal_rate_per_min)
--                  (ideal_rate_per_min is per-machine config, not stored here)
--   Quality      = good_count / output_count
--   OEE          = Availability × Performance × Quality

-- ─── 1-minute rollup ──────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS oee_1min
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 minute', ts)                             AS bucket,
  machine_id,
  AVG(CASE WHEN metric = 'status'       THEN value END)  AS avg_status,
  SUM(CASE WHEN metric = 'output_count' THEN value END)  AS output_count,
  SUM(CASE WHEN metric = 'good_count'   THEN value END)  AS good_count,
  COUNT(*) FILTER (WHERE metric = 'status')               AS status_samples
FROM machine_telemetry
GROUP BY time_bucket('1 minute', ts), machine_id
WITH NO DATA;

-- Retain real-time data: refresh every minute, keep 30 days of 1-min data
SELECT add_continuous_aggregate_policy(
  'oee_1min',
  start_offset  => INTERVAL '10 minutes',
  end_offset    => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);

-- ─── 1-hour rollup (built on oee_1min) ───────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS oee_1hour
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 hour', bucket)       AS bucket,
  machine_id,
  AVG(avg_status)                      AS avg_status,
  SUM(output_count)                    AS output_count,
  SUM(good_count)                      AS good_count,
  SUM(status_samples)                  AS status_samples
FROM oee_1min
GROUP BY time_bucket('1 hour', bucket), machine_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'oee_1hour',
  start_offset  => INTERVAL '3 hours',
  end_offset    => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- ─── 1-day rollup (built on oee_1hour) ───────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS oee_1day
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 day', bucket)        AS bucket,
  machine_id,
  AVG(avg_status)                      AS avg_status,
  SUM(output_count)                    AS output_count,
  SUM(good_count)                      AS good_count,
  SUM(status_samples)                  AS status_samples
FROM oee_1hour
GROUP BY time_bucket('1 day', bucket), machine_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'oee_1day',
  start_offset  => INTERVAL '3 days',
  end_offset    => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- ─── Data retention policies ──────────────────────────────────────────────

-- Keep raw telemetry for 7 days (high-frequency data)
SELECT add_retention_policy(
  'machine_telemetry',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Keep 1-min OEE rollup for 30 days
SELECT add_retention_policy(
  'oee_1min',
  INTERVAL '30 days',
  if_not_exists => TRUE
);

-- Keep 1-hour rollup for 1 year
SELECT add_retention_policy(
  'oee_1hour',
  INTERVAL '365 days',
  if_not_exists => TRUE
);
-- oee_1day is kept indefinitely (historical reporting)
