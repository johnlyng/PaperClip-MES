/**
 * Shifts schema — packages/db/schema/shifts.ts
 *
 * A shift defines a named recurring time window on specific days of the week
 * (e.g. "Morning" Mon–Fri 06:00–14:00).  Shift records replace the free-text
 * shiftId strings in production_schedules.shift_id.
 *
 * Design decisions:
 *  - startTime / endTime stored as TEXT in "HH:MM" 24-hour format.  PostgreSQL
 *    TIME type would be ideal, but Drizzle-ORM's `time()` mapping requires
 *    careful client-side parsing.  Plain text keeps the API simple and avoids
 *    timezone ambiguity (shifts are local-time concepts, not UTC instants).
 *  - daysOfWeek stored as integer ARRAY (0=Sun … 6=Sat), matching the JS
 *    Date.getDay() convention and the ISO-8601 weekday numbering used by most
 *    scheduling libraries.
 *  - isActive flag: soft-disable obsolete shifts without breaking FK history.
 *    production_schedules.shift_id continues to reference the UUID even after
 *    a shift is deactivated.
 *  - No FK from production_schedules.shift_id to this table: the column is TEXT
 *    at the DB level until a follow-up migration adds the FK constraint.  The
 *    migration path is documented in the issue description.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Table ────────────────────────────────────────────────────────────────────

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** Human-readable name, e.g. "Morning", "Afternoon", "Night". */
    name: text("name").notNull(),

    /** Start of shift in 24-hour "HH:MM" local time. */
    startTime: text("start_time").notNull(),

    /** End of shift in 24-hour "HH:MM" local time. */
    endTime: text("end_time").notNull(),

    /**
     * Days this shift runs, as integer array: 0=Sun, 1=Mon, …, 6=Sat.
     * Stored as a space-separated text column for portability; the service
     * layer parses/serialises the array.
     *
     * Example: "1 2 3 4 5" = Mon–Fri.
     */
    daysOfWeek: text("days_of_week").notNull().default("1 2 3 4 5"),

    /** When false, this shift is hidden from selectors but kept for historical FK integrity. */
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_shifts_is_active").on(table.isActive),
    index("idx_shifts_name").on(table.name),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShiftRow = typeof shifts.$inferSelect;
export type NewShiftRow = typeof shifts.$inferInsert;
