/**
 * process-manufacturing.ts — Seed data for batch and continuous process scenarios.
 *
 * Board-confirmed priority: process-manufacturing scenarios are validated first
 * before discrete-manufacturing in all test suites.
 *
 * Covers:
 * - Batch reactor work orders (kg output, waste tracking, yield)
 * - Continuous process work orders (L/hr throughput)
 * - Process BOMs with raw materials in kg/L units
 * - Batch production results with yield and downtime
 */

import type { WorkOrder, WorkOrderStatus } from "@mes/types";

// ─── Seed Reference Timestamps ────────────────────────────────────────────────

/** Start of an 8-hour morning shift */
export const PROCESS_SHIFT_START = new Date("2026-04-01T06:00:00.000Z");
/** End of an 8-hour morning shift */
export const PROCESS_SHIFT_END = new Date("2026-04-01T14:00:00.000Z");

// ─── Process Machines ─────────────────────────────────────────────────────────

export const PROCESS_MACHINES = [
  {
    id: "machine-reactor-001",
    name: "Batch Reactor R-101",
    status: "running" as const,
    lineId: "line-process-001",
    createdAt: PROCESS_SHIFT_START,
    updatedAt: PROCESS_SHIFT_START,
  },
  {
    id: "machine-reactor-002",
    name: "Continuous Mixer CM-201",
    status: "idle" as const,
    lineId: "line-process-001",
    createdAt: PROCESS_SHIFT_START,
    updatedAt: PROCESS_SHIFT_START,
  },
  {
    id: "machine-dryer-001",
    name: "Spray Dryer SD-301",
    status: "running" as const,
    lineId: "line-process-002",
    createdAt: PROCESS_SHIFT_START,
    updatedAt: PROCESS_SHIFT_START,
  },
];

// ─── Process Work Orders ──────────────────────────────────────────────────────

/** A scheduled batch work order (not yet started) */
export const PROCESS_WO_SCHEDULED: WorkOrder & {
  type: "process";
  batchSize: number;
  processOrderNumber: string;
} = {
  id: "wo-process-001",
  workOrderNumber: "PO-2026-001",
  processOrderNumber: "PRO-2026-001",
  title: "Batch Polymerisation — Run #42",
  productId: "prod-polymer-grade-a",
  quantity: 500,
  unit: "kg",
  batchSize: 500,
  scheduledStart: PROCESS_SHIFT_START,
  scheduledEnd: new Date("2026-04-01T10:00:00.000Z"),
  status: "released" as WorkOrderStatus,
  priority: 1,
  machineId: "machine-reactor-001",
  bomId: "bom-polymer-grade-a-v3",
  operatorId: "user-op-process-001",
  type: "process",
  createdAt: PROCESS_SHIFT_START,
  updatedAt: PROCESS_SHIFT_START,
};

/** An in-progress batch work order */
export const PROCESS_WO_IN_PROGRESS: WorkOrder & {
  type: "process";
  batchSize: number;
  processOrderNumber: string;
} = {
  id: "wo-process-002",
  workOrderNumber: "PO-2026-002",
  processOrderNumber: "PRO-2026-002",
  title: "Continuous Blending — Shift Lot",
  productId: "prod-blend-standard",
  quantity: 2000,
  unit: "L",
  batchSize: 2000,
  scheduledStart: PROCESS_SHIFT_START,
  scheduledEnd: PROCESS_SHIFT_END,
  status: "in_progress" as WorkOrderStatus,
  priority: 2,
  machineId: "machine-reactor-002",
  bomId: "bom-blend-standard-v1",
  type: "process",
  actualStart: PROCESS_SHIFT_START,
  createdAt: PROCESS_SHIFT_START,
  updatedAt: PROCESS_SHIFT_START,
};

/** A completed batch work order with production results for ERP push testing */
export const PROCESS_WO_COMPLETED: WorkOrder & {
  type: "process";
  batchSize: number;
  processOrderNumber: string;
} = {
  id: "wo-process-003",
  workOrderNumber: "PO-2026-003",
  processOrderNumber: "PRO-2026-003",
  title: "Spray Drying — Product Grade B",
  productId: "prod-powder-grade-b",
  quantity: 300,
  unit: "kg",
  batchSize: 300,
  scheduledStart: new Date("2026-03-31T06:00:00.000Z"),
  scheduledEnd: new Date("2026-03-31T14:00:00.000Z"),
  status: "completed" as WorkOrderStatus,
  priority: 1,
  machineId: "machine-dryer-001",
  bomId: "bom-powder-grade-b-v2",
  type: "process",
  actualStart: new Date("2026-03-31T06:05:00.000Z"),
  actualEnd: new Date("2026-03-31T13:45:00.000Z"),
  createdAt: new Date("2026-03-31T05:00:00.000Z"),
  updatedAt: new Date("2026-03-31T13:45:00.000Z"),
};

/** Convenience array: all process work orders in priority order */
export const PROCESS_WORK_ORDERS = [
  PROCESS_WO_SCHEDULED,
  PROCESS_WO_IN_PROGRESS,
  PROCESS_WO_COMPLETED,
];

// ─── Process Production Results ───────────────────────────────────────────────

/** Production result for PROCESS_WO_COMPLETED — for AC-WO-03 and AC-ERP-01 tests */
export const PROCESS_PRODUCTION_RESULT = {
  workOrderId: "wo-process-003",
  machineId: "machine-dryer-001",
  actualQuantity: 285,          // kg actually produced
  scrapQuantity: 18,            // kg scrap (off-spec / filter loss)
  completedAt: new Date("2026-03-31T13:45:00.000Z"),
  notes: "25min downtime for filter backwash. Yield: 89%",
  // yield = (285 - 18) / 300 = 0.89 (89%)
};

// ─── Process BOMs ─────────────────────────────────────────────────────────────

export const PROCESS_BOMS: Record<string, Array<{
  itemNumber: string;
  description: string;
  quantity: number;
  unit: string;
  materialId: string;
}>> = {
  "bom-polymer-grade-a-v3": [
    { itemNumber: "RM-101", description: "Monomer A (styrene)", quantity: 320, unit: "kg", materialId: "mat-monomer-a" },
    { itemNumber: "RM-102", description: "Monomer B (acrylate)", quantity: 150, unit: "kg", materialId: "mat-monomer-b" },
    { itemNumber: "RM-103", description: "Initiator (AIBN)", quantity: 2.5, unit: "kg", materialId: "mat-initiator" },
    { itemNumber: "RM-104", description: "Solvent (toluene)", quantity: 180, unit: "L", materialId: "mat-solvent" },
  ],
  "bom-blend-standard-v1": [
    { itemNumber: "RM-201", description: "Base Oil ISO 46", quantity: 1600, unit: "L", materialId: "mat-base-oil" },
    { itemNumber: "RM-202", description: "Additive Pack AP-7", quantity: 200, unit: "L", materialId: "mat-additive" },
    { itemNumber: "RM-203", description: "Viscosity Modifier VM-3", quantity: 200, unit: "L", materialId: "mat-vm" },
  ],
  "bom-powder-grade-b-v2": [
    { itemNumber: "RM-301", description: "Feed Slurry (30% solids)", quantity: 1200, unit: "kg", materialId: "mat-slurry" },
    { itemNumber: "RM-302", description: "Inlet Air (heated)", quantity: 0, unit: "Nm3", materialId: "mat-air" },
  ],
};
