/**
 * Production Schedules schema — packages/db/schema/production-schedules.ts
 *
 * A production_schedule record maps one work order to one machine for a
 * specific time window. Multiple schedules per work order are allowed
 * (split batches, multi-machine runs). Each schedule has its own lifecycle.
 *
 * Design decisions:
 *  - CASCADE DELETE: deleting a work order removes all its schedule slots.
 *    This is safe because schedule records are subordinate to work orders.
 *  - sequence_number: ordering of schedule slots on the same machine.
 *    The application enforces contiguous, non-overlapping windows. There is
 *    no DB-level EXCLUSION constraint here because Drizzle-kit does not yet
 *    emit EXCLUDE clauses. The service layer MUST check for machine schedule
 *    overlap before inserting/updating (query: tstzrange overlap on machine_id).
 *    See: apps/api/src/services/ScheduleService.ts (to be implemented).
 *  - shift_id: opaque string key ('morning', 'afternoon', 'night', or a
 *    UUID from a shifts table). Not foreign-key-constrained at MVP.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamptz,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workOrders } from "./work-orders.js";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const productionScheduleStatusEnum = pgEnum(
  "production_schedule_status",
  ["draft", "confirmed", "active", "completed", "cancelled"]
);

// ─── Table ────────────────────────────────────────────────────────────────────

export const productionSchedules = pgTable(
  "production_schedules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),

    // Machine to run this schedule slot on.
    // Application-enforced FK until machines table is created.
    machineId: uuid("machine_id").notNull(),

    // Production line grouping (e.g., 'line-001'). Informational.
    lineId: text("line_id"),

    // Position within a multi-slot work order on the same machine.
    // Application must assign and maintain these values.
    sequenceNumber: integer("sequence_number").notNull().default(0),

    // Planned window. CHECK prevents invalid ranges.
    scheduledStart: timestamptz("scheduled_start").notNull(),
    scheduledEnd: timestamptz("scheduled_end").notNull(),

    // Populated when operator starts / completes this slot.
    actualStart: timestamptz("actual_start"),
    actualEnd: timestamptz("actual_end"),

    // Shift this slot belongs to. Optional; not FK-constrained at MVP.
    shiftId: text("shift_id"),

    // Operator assigned to this specific slot (may differ from WO default operator).
    operatorId: uuid("operator_id"),

    status: productionScheduleStatusEnum("status").notNull().default("draft"),

    notes: text("notes"),

    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
  },
  (table) => [
    // FK scan on work order.
    index("idx_prod_schedules_work_order_id").on(table.workOrderId),

    // Critical: overlap-check query scans this index.
    // When checking for machine schedule conflicts, filter on machine_id
    // then range-overlap on (scheduled_start, scheduled_end).
    index("idx_prod_schedules_machine_time").on(
      table.machineId,
      table.scheduledStart,
      table.scheduledEnd
    ),

    index("idx_prod_schedules_status").on(table.status),

    check(
      "chk_prod_schedules_window",
      sql`${table.scheduledStart} < ${table.scheduledEnd}`
    ),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProductionScheduleRow = typeof productionSchedules.$inferSelect;
export type NewProductionScheduleRow = typeof productionSchedules.$inferInsert;
