/**
 * In-memory shift store — shared between shifts routes.
 * Replace with Drizzle + PostgreSQL (shifts table) when DB integration lands.
 *
 * Seeded with the three legacy free-text shiftId values so that any existing
 * production_schedules rows that reference "morning", "afternoon", or "night"
 * can be migrated by matching on the name field.
 */

import type { Shift } from "@mes/types";

const now = new Date();

export const shiftStore: Shift[] = [
  {
    id: "shift-morning",
    name: "Morning",
    startTime: "06:00",
    endTime: "14:00",
    daysOfWeek: [1, 2, 3, 4, 5], // Mon–Fri
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "shift-afternoon",
    name: "Afternoon",
    startTime: "14:00",
    endTime: "22:00",
    daysOfWeek: [1, 2, 3, 4, 5],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "shift-night",
    name: "Night",
    startTime: "22:00",
    endTime: "06:00",
    daysOfWeek: [1, 2, 3, 4, 5],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
];
