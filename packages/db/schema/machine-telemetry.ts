/**
 * machine-telemetry.ts — Drizzle schema for the TimescaleDB hypertable.
 *
 * The hypertable itself is created by infra/compose/init-scripts/01-init-timescaledb.sql
 * (Docker init path) and not managed by drizzle-kit migrations.
 * This file provides Drizzle column definitions for type-safe queries.
 *
 * Columns:
 *   ts         — event timestamp (partition key)
 *   machine_id — UUID of the machine that produced the reading
 *   metric     — named metric: "status" | "output_count" | "good_count" | custom
 *   value      — numeric reading (status: 1.0=running, 0.0=stopped)
 *   tags       — optional JSONB key-value annotations (shift, operator, line, …)
 *
 * Continuous Aggregate views (oee_1min, oee_1hour, oee_1day) are defined in
 * infra/compose/init-scripts/02-oee-aggregates.sql and queried via raw SQL in
 * apps/api/src/services/oee-query.ts.
 */

import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ─── Table ────────────────────────────────────────────────────────────────────

export const machineTelemetry = pgTable(
  "machine_telemetry",
  {
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    machineId: text("machine_id").notNull(), // human-readable IDs (e.g. machine-mock-001)
    metric: text("metric").notNull(),
    value: doublePrecision("value"),
    tags: jsonb("tags"),
  },
  (table) => [
    // Primary access pattern: all readings for a machine in a time range
    index("idx_telemetry_machine_ts_drizzle").on(table.machineId, table.ts),
    // Secondary: filter by metric across all machines (diagnostics, dashboards)
    index("idx_telemetry_metric_ts").on(table.metric, table.ts),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type MachineTelemetryRow = typeof machineTelemetry.$inferSelect;
export type NewMachineTelemetryRow = typeof machineTelemetry.$inferInsert;

// ─── Metric name constants ────────────────────────────────────────────────────

/** Metric published when a machine changes run/stop state.
 *  1.0 = running, 0.0 = stopped / fault / maintenance */
export const METRIC_STATUS = "status" as const;

/** Count of total units produced (good + scrap) in the reporting interval */
export const METRIC_OUTPUT_COUNT = "output_count" as const;

/** Count of good (non-scrap) units produced in the reporting interval */
export const METRIC_GOOD_COUNT = "good_count" as const;
