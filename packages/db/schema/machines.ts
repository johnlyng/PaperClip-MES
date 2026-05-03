/**
 * machines.ts — Drizzle schema for the persistent machine registry.
 *
 * Replaces the stub machines table in infra/compose/init-scripts/01-init-timescaledb.sql.
 * Managed by drizzle-kit; run `pnpm db:generate` to produce migration files.
 *
 * Design decisions:
 *  - id is TEXT (not UUID) to match machine_telemetry.machine_id, enabling direct
 *    JOINs between the registry and telemetry without a separate lookup column.
 *    Human-readable IDs (e.g. "machine-reactor-001") are preferred for operator use.
 *  - idealRatePerMin is nullable; NULL = fall back to availability-only performance calc.
 *  - status uses a PG ENUM for query-planner efficiency on dashboard filters.
 *  - lineId is TEXT (FK to a future lines table; app-enforced until that table exists).
 *  - metadata JSONB: OPC-UA node IDs, ERP references, custom calibration data.
 *    Do not store queryable attributes here — add typed columns instead.
 *  - updated_at is kept current by a DB trigger (same trigger used for work_orders).
 */

import {
  pgTable,
  pgEnum,
  text,
  doublePrecision,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const machineStatusEnum = pgEnum("machine_status", [
  "running",
  "idle",
  "fault",
  "maintenance",
  "disconnected",
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const machines = pgTable(
  "machines",
  {
    // Human-readable identifier — matches machine_telemetry.machine_id for direct JOINs.
    id: text("id").primaryKey(),

    name: text("name").notNull(),

    // Optional human-readable description (e.g. "Batch Reactor, 500L capacity").
    description: text("description"),

    // Free-form machine category (e.g. "cnc", "robot", "reactor", "conveyor").
    type: text("type"),

    // Production line reference. FK to a future lines table; app-enforced until then.
    lineId: text("line_id"),

    // Ideal output rate in units per minute — used for OEE Performance calculation.
    // NULL = no target rate; Performance falls back to Availability (conservative).
    idealRatePerMin: doublePrecision("ideal_rate_per_min"),

    status: machineStatusEnum("status").notNull().default("disconnected"),

    // Flexible JSONB payload: OPC-UA node IDs, ERP codes, calibration params.
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    // updated_at is maintained by the DB trigger defined alongside work_orders.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("idx_machines_status").on(table.status),
    index("idx_machines_line_id").on(table.lineId),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type MachineRow = typeof machines.$inferSelect;
export type NewMachineRow = typeof machines.$inferInsert;
