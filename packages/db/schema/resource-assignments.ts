/**
 * Resource Assignments schema — packages/db/schema/resource-assignments.ts
 *
 * Tracks which resources (machines, operators, tools, materials) are assigned
 * to a work order for planning and capacity purposes.
 *
 * Design decisions:
 *  - resource_type ENUM + resource_id TEXT: deliberately polymorphic. Resources
 *    live in different tables/systems (machines in our DB, operators in user
 *    management, tools/materials potentially in ERP). A typed join table per
 *    resource type would be cleaner but is premature at MVP.
 *  - Quantity + unit: covers both people (1 operator) and materials (5 kg resin).
 *  - scheduled_start/end: optional — some assignments are for the full WO duration,
 *    others are slot-specific. NULL means "for the life of the work order".
 *  - CASCADE DELETE: removing a work order removes all its resource assignments.
 *  - No overlap constraint on resources here. Capacity planning (detecting that
 *    operator X is double-booked) is a service-layer concern, not enforced by DB.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workOrders } from "./work-orders.js";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const resourceTypeEnum = pgEnum("resource_type", [
  "machine",
  "operator",
  "tool",
  "material",
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const resourceAssignments = pgTable(
  "resource_assignments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),

    resourceType: resourceTypeEnum("resource_type").notNull(),

    // Opaque resource identifier: UUID for internal resources, ERP code for materials.
    resourceId: text("resource_id").notNull(),

    // Planned quantity for this assignment.
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    unit: text("unit"),

    // Optional time window — NULL means full work order duration.
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    // FK lookup for "get all resources for this work order".
    index("idx_resource_assignments_work_order_id").on(table.workOrderId),

    // Lookup for "where is this resource assigned?".
    index("idx_resource_assignments_resource").on(
      table.resourceType,
      table.resourceId
    ),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResourceAssignmentRow = typeof resourceAssignments.$inferSelect;
export type NewResourceAssignmentRow =
  typeof resourceAssignments.$inferInsert;
