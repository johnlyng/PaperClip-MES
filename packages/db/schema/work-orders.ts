/**
 * Work Orders schema — packages/db/schema/work-orders.ts
 *
 * Drizzle ORM table definitions for the Work Order module.
 * PostgreSQL 16 target. Managed by drizzle-kit; run `pnpm db:generate` to
 * produce migration files, `pnpm db:push` for local dev against Docker Compose.
 *
 * Design decisions:
 *  - work_order_number is human-readable and indexed UNIQUE. Sequence-formatted
 *    by the application layer (WO-YYYY-NNNN). NOT a UUID so operators can read it.
 *  - status is a native Postgres ENUM — query planner uses it efficiently for
 *    partial indexes. Adding a new state requires a migration; that is intentional.
 *  - machine_id / operator_id / supervisor_id / created_by are UUIDs but NOT
 *    foreign-key-constrained here because machines and users tables are defined
 *    in a future migration. Application layer enforces referential integrity until
 *    those tables exist.
 *  - metadata JSONB: ERP payload envelope and custom fields per work order.
 *    Do not put queryable attributes here — add typed columns instead.
 *  - CHECK(scheduled_start < scheduled_end) enforced at DB level.
 *  - updated_at is managed by a DB trigger defined in the initial migration.
 *    Do NOT rely on application code to keep this field current.
 *
 * State machine: draft → released → in_progress ⇄ paused → completed
 *                any → cancelled
 * See packages/domain/src/work-order/WorkOrderStateMachine.ts for transitions.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  integer,
  timestamptz,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const workOrderStatusEnum = pgEnum("work_order_status", [
  "draft",
  "released",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    // Human-readable order identifier. Application layer generates WO-YYYY-NNNN.
    workOrderNumber: text("work_order_number").notNull().unique(),

    title: text("title").notNull(),

    // ERP product/material code. Stored as text to remain ERP-agnostic.
    productId: text("product_id").notNull(),

    // Planned production quantity. Numeric(12,3) handles fractional units (kg, L).
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: text("unit").notNull().default("pcs"),

    status: workOrderStatusEnum("status").notNull().default("draft"),

    // Priority for scheduling: higher integer = higher urgency. Default 0 = normal.
    priority: integer("priority").notNull().default(0),

    // Planned window. CHECK constraint prevents invalid ranges.
    scheduledStart: timestamptz("scheduled_start").notNull(),
    scheduledEnd: timestamptz("scheduled_end").notNull(),

    // Set by state machine transitions (start / complete events).
    actualStart: timestamptz("actual_start"),
    actualEnd: timestamptz("actual_end"),

    // Resource references — UUID types, application-enforced FK until
    // machines and users tables are created in a later migration.
    machineId: uuid("machine_id"),
    operatorId: uuid("operator_id"),
    supervisorId: uuid("supervisor_id"),

    // BOM reference from ERP system (e.g. SAP BOM header ID).
    bomId: text("bom_id"),

    // ERP work order reference (e.g. SAP Production Order number).
    erpReference: text("erp_reference"),

    notes: text("notes"),

    // Flexible JSONB field for ERP payload envelopes and custom attributes.
    // Avoid placing filterable data here — add typed columns instead.
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),

    createdBy: uuid("created_by"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
    // updated_at is maintained by a DB trigger (see migrations/0001_triggers.sql).
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
  },
  (table) => [
    // Filters applied on every list query.
    index("idx_work_orders_status").on(table.status),
    index("idx_work_orders_machine_id").on(table.machineId),

    // Date-range scan for schedule views.
    index("idx_work_orders_scheduled_range").on(
      table.scheduledStart,
      table.scheduledEnd
    ),

    // Combined index for the most common dashboard query:
    // "show me all active/released WOs scheduled today".
    index("idx_work_orders_status_start").on(table.status, table.scheduledStart),

    // ERP cross-reference lookup.
    index("idx_work_orders_erp_reference").on(table.erpReference),

    // Prevent invalid schedule windows at the DB level.
    check(
      "chk_work_orders_schedule_window",
      sql`${table.scheduledStart} < ${table.scheduledEnd}`
    ),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkOrderRow = typeof workOrders.$inferSelect;
export type NewWorkOrderRow = typeof workOrders.$inferInsert;
