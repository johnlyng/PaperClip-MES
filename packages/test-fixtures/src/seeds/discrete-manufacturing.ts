/**
 * discrete-manufacturing.ts — Seed data for discrete manufacturing scenarios.
 *
 * Board-confirmed scope: 100-unit CNC machined-parts production run (GST-29).
 * Tracks individual units (pcs) — not batch volumes — with per-unit quality
 * checks and a simulated 48-min unplanned downtime event.
 *
 * Covers:
 * - CNC work order: 100 × aluminium shaft coupling (ALU-COUPLING-M12)
 * - BOM: rod, O-ring, bolt per unit
 * - Production result: 95 good + 5 scrap (tool-change fault)
 * - Expected OEE: A=0.9000, P=0.8796, Q=0.9500, OEE≈0.7520
 *
 * See GST-29 plan document for full scenario definition.
 */

import type { WorkOrder, WorkOrderStatus } from "@mes/types";

// ─── Seed Reference Timestamps ────────────────────────────────────────────────

/** Start of the 8-hour morning shift for the discrete manufacturing run */
export const DISCRETE_SHIFT_START = new Date("2026-05-01T06:00:00.000Z");

/** End of the 8-hour morning shift */
export const DISCRETE_SHIFT_END = new Date("2026-05-01T14:00:00.000Z");

/** When the tool-change fault begins (T+90 min into shift) */
export const DISCRETE_FAULT_START = new Date("2026-05-01T07:30:00.000Z");

/** When the machine recovers after 48-min downtime (T+138 min) */
export const DISCRETE_FAULT_END = new Date("2026-05-01T08:18:00.000Z");

// ─── Discrete Machine ─────────────────────────────────────────────────────────

export const DISCRETE_MACHINE_ID = "machine-cnc-001";

export const DISCRETE_MACHINES = [
  {
    id: DISCRETE_MACHINE_ID,
    name: "CNC Lathe Alpha (Line A)",
    status: "running" as const,
    lineId: "line-cnc-001",
    createdAt: DISCRETE_SHIFT_START,
    updatedAt: DISCRETE_SHIFT_START,
  },
];

// ─── ERP Reference Constants ──────────────────────────────────────────────────

export const DISCRETE_ERP_ORDER_ID = "SAP-PROD-ORDER-100001";
export const DISCRETE_WORK_ORDER_NUMBER = "WO-DISCRETE-001";
export const DISCRETE_BOM_ID = "BOM-ALU-COUPLING-M12-v1";
export const DISCRETE_PRODUCT_ID = "ALU-COUPLING-M12";

// ─── Work Orders ──────────────────────────────────────────────────────────────

/**
 * Discrete work order as created by ERP sync.
 * Status "draft" represents SAP CRTD (Created) — not yet released to the floor.
 */
export const DISCRETE_WO_DRAFT: WorkOrder = {
  id: "wo-discrete-001",
  workOrderNumber: DISCRETE_WORK_ORDER_NUMBER,
  title: "100-unit aluminium coupling run",
  productId: DISCRETE_PRODUCT_ID,
  quantity: 100,
  unit: "pcs",
  scheduledStart: DISCRETE_SHIFT_START,
  scheduledEnd: DISCRETE_SHIFT_END,
  status: "draft" as WorkOrderStatus,
  priority: 1,
  machineId: DISCRETE_MACHINE_ID,
  bomId: DISCRETE_BOM_ID,
  erpReference: DISCRETE_ERP_ORDER_ID,
  operatorId: "user-op-001",
  supervisorId: "user-sup-001",
  createdAt: DISCRETE_SHIFT_START,
  updatedAt: DISCRETE_SHIFT_START,
};

/** Work order after the supervisor releases it to the floor. */
export const DISCRETE_WO_RELEASED: WorkOrder = {
  ...DISCRETE_WO_DRAFT,
  status: "released" as WorkOrderStatus,
  updatedAt: DISCRETE_SHIFT_START,
};

/** Work order after the operator starts the run. */
export const DISCRETE_WO_IN_PROGRESS: WorkOrder = {
  ...DISCRETE_WO_DRAFT,
  status: "in_progress" as WorkOrderStatus,
  actualStart: DISCRETE_SHIFT_START,
  updatedAt: DISCRETE_SHIFT_START,
};

/** Work order after the run is closed out. */
export const DISCRETE_WO_COMPLETED: WorkOrder = {
  ...DISCRETE_WO_DRAFT,
  status: "completed" as WorkOrderStatus,
  actualStart: DISCRETE_SHIFT_START,
  actualEnd: DISCRETE_SHIFT_END,
  updatedAt: DISCRETE_SHIFT_END,
};

/** Convenience array: all discrete work orders in lifecycle order */
export const DISCRETE_WORK_ORDERS: WorkOrder[] = [DISCRETE_WO_DRAFT];

// ─── Production Result ────────────────────────────────────────────────────────

/**
 * Production result for the completed discrete work order.
 *
 * OEE scenario (GST-29 plan §1.4):
 *   Planned production time : 480 min  (8-hour shift)
 *   Unplanned downtime       :  48 min  (tool-change fault at T+90 min)
 *   Run time                 : 432 min
 *   Ideal cycle time         :   4.0 min/unit
 *   Total produced           : 100 units (95 good + 5 scrap)
 *
 *   Availability = 432 / 480          = 0.9000
 *   Performance  = (95 × 4.0) / 432   = 0.8796
 *   Quality      = 95 / 100           = 0.9500
 *   OEE          = 0.9000 × 0.8796 × 0.9500 ≈ 0.7520
 */
export const DISCRETE_PRODUCTION_RESULT = {
  // MES work order ID — NOT the SAP erpReference. Use this as the :workOrderId
  // path param on POST /api/v1/erp/confirm/:workOrderId.
  workOrderId: DISCRETE_WO_DRAFT.id,
  machineId: DISCRETE_MACHINE_ID,
  actualQuantity: 95,
  scrapQuantity: 5,
  completedAt: DISCRETE_SHIFT_END,
  notes: "48 min downtime at T+90 min for tool-change fault on spindle #2. 5 units scrapped during recovery.",
};

// ─── Expected OEE Values ──────────────────────────────────────────────────────

/** Floating-point tolerance for OEE comparisons in automated tests */
export const DISCRETE_OEE_TOLERANCE = 0.001;

/**
 * Pre-computed expected OEE values for the scenario.
 * All values derived from raw inputs — do not hard-code rounded numbers.
 */
export const DISCRETE_OEE_EXPECTED = {
  /** Availability = run_time / planned_time = 432 / 480 */
  availability: 432 / 480,
  /** Performance = (actual_units × ideal_cycle_time) / run_time = (95 × 4.0) / 432 */
  performance: (95 * 4.0) / 432,
  /** Quality = good_units / total_units = 95 / 100 */
  quality: 95 / 100,
  /** OEE = Availability × Performance × Quality */
  oee: (432 / 480) * ((95 * 4.0) / 432) * (95 / 100),
  /** Ideal output rate used by OEE query service: 1 unit / 4.0 min = 0.25 units/min */
  idealRatePerMin: 1 / 4.0,
};

// ─── BOM Components ───────────────────────────────────────────────────────────

/**
 * BOM for ALU-COUPLING-M12 — per-unit component quantities.
 * Three components per coupling: aluminium rod stock, O-ring seal, hex bolt set.
 */
export const DISCRETE_BOMS: Record<
  string,
  Array<{
    itemNumber: string;
    description: string;
    quantity: number;
    unit: string;
    materialId: string;
  }>
> = {
  [DISCRETE_BOM_ID]: [
    {
      itemNumber: "DC-RM-001",
      description: "Aluminium Rod 25mm diameter",
      quantity: 0.12,
      unit: "m",
      materialId: "mat-alu-rod-25mm",
    },
    {
      itemNumber: "DC-RM-002",
      description: "O-Ring Seal 12mm",
      quantity: 2,
      unit: "pcs",
      materialId: "mat-seal-o-ring-12",
    },
    {
      itemNumber: "DC-RM-003",
      description: "Hex Bolt M6×20mm",
      quantity: 4,
      unit: "pcs",
      materialId: "mat-bolt-m6-20mm",
    },
  ],
};
