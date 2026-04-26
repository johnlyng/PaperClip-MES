// @mes/test-fixtures — Seeded test data and mock adapters for use in tests
// across apps/api, apps/web, and packages/domain.

import type { WorkOrder, Machine, User, OEESnapshot, MachineTelemetry } from "@mes/types";
export { MockERPAdapter } from "@mes/domain";

// Process-manufacturing seeds (board-confirmed priority)
export * from "./seeds/process-manufacturing.js";

// Testcontainers helpers (integration tests only — not imported in unit test builds)
export * from "./containers/index.js";

// ─── Seed Dates ──────────────────────────────────────────────────────────────

export const SEED_DATE = new Date("2026-04-01T08:00:00.000Z");
export const SEED_DATE_END = new Date("2026-04-01T16:00:00.000Z");

// ─── Machines ────────────────────────────────────────────────────────────────

export const MACHINES: Machine[] = [
  {
    id: "machine-mock-001",
    name: "CNC Lathe Alpha",
    status: "running",
    lineId: "line-001",
    opcuaEndpoint: "opc.tcp://localhost:4840",
    opcuaNodeIds: {
      spindleSpeed: "ns=2;i=1001",
      feedRate: "ns=2;i=1002",
      temperature: "ns=2;i=1003",
    },
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: "machine-mock-002",
    name: "Milling Station Beta",
    status: "idle",
    lineId: "line-001",
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: "machine-mock-003",
    name: "Assembly Robot Gamma",
    status: "fault",
    lineId: "line-002",
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  // Process-manufacturing machines (board-confirmed priority, matches telemetry generator)
  {
    id: "machine-reactor-001",
    name: "Batch Reactor R-101",
    status: "running",
    lineId: "line-process-001",
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: "machine-reactor-002",
    name: "Continuous Mixer CM-201",
    status: "idle",
    lineId: "line-process-001",
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: "machine-dryer-001",
    name: "Spray Dryer SD-301",
    status: "running",
    lineId: "line-process-002",
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── Work Orders ─────────────────────────────────────────────────────────────

export const WORK_ORDERS: WorkOrder[] = [
  {
    id: "wo-001",
    workOrderNumber: "WO-2026-001",
    title: "Produce Widget Alpha — Batch 1",
    productId: "prod-widget-alpha",
    quantity: 500,
    unit: "pcs",
    scheduledStart: SEED_DATE,
    scheduledEnd: SEED_DATE_END,
    status: "in_progress",
    priority: 1,
    machineId: "machine-mock-001",
    operatorId: "user-op-001",
    bomId: "bom-widget-alpha-v1",
    actualStart: SEED_DATE,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: "wo-002",
    workOrderNumber: "WO-2026-002",
    title: "Produce Widget Beta — Rework",
    productId: "prod-widget-beta",
    quantity: 120,
    unit: "pcs",
    scheduledStart: SEED_DATE,
    scheduledEnd: SEED_DATE_END,
    status: "released",
    priority: 0,
    machineId: "machine-mock-002",
    bomId: "bom-widget-beta-v2",
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: "wo-003",
    workOrderNumber: "WO-2026-003",
    title: "Calibration Run",
    productId: "prod-calibration",
    quantity: 1,
    unit: "run",
    scheduledStart: SEED_DATE,
    scheduledEnd: SEED_DATE_END,
    status: "completed",
    priority: 0,
    machineId: "machine-mock-003",
    actualStart: SEED_DATE,
    actualEnd: SEED_DATE_END,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE_END,
  },
];

// ─── Users ────────────────────────────────────────────────────────────────────

export const USERS: User[] = [
  { id: "user-op-001", username: "jsmith", displayName: "Jane Smith", role: "operator", lineIds: ["line-001"], createdAt: SEED_DATE },
  { id: "user-sup-001", username: "mjones", displayName: "Mike Jones", role: "supervisor", lineIds: ["line-001", "line-002"], createdAt: SEED_DATE },
  { id: "user-eng-001", username: "alee", displayName: "Alice Lee", role: "engineer", createdAt: SEED_DATE },
  { id: "user-adm-001", username: "admin", displayName: "System Admin", role: "admin", createdAt: SEED_DATE },
];

// ─── OEE Snapshots ───────────────────────────────────────────────────────────

export const OEE_SNAPSHOTS: OEESnapshot[] = [
  {
    machineId: "machine-mock-001",
    from: SEED_DATE,
    to: SEED_DATE_END,
    granularity: "1h",
    availability: 0.92,
    performance: 0.88,
    quality: 0.97,
    oee: 0.92 * 0.88 * 0.97,
    plannedProductionTime: 28800,
    actualProductionTime: 26496,
    goodCount: 485,
    totalCount: 500,
  },
];

// ─── Telemetry Samples ───────────────────────────────────────────────────────

export const TELEMETRY_SAMPLES: MachineTelemetry[] = [
  { ts: SEED_DATE, machineId: "machine-mock-001", metric: "spindleSpeed", value: 1200, tags: { unit: "rpm" } },
  { ts: SEED_DATE, machineId: "machine-mock-001", metric: "feedRate", value: 250, tags: { unit: "mm/min" } },
  { ts: SEED_DATE, machineId: "machine-mock-001", metric: "temperature", value: 68.4, tags: { unit: "celsius" } },
];
