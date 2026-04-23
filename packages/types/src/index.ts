// @mes/types — Shared TypeScript interfaces for the MES system.
// All domain entities are defined here and imported by apps/api, apps/web,
// apps/opcua-collector, and packages/domain.

// ─── Work Orders ─────────────────────────────────────────────────────────────

export type WorkOrderStatus =
  | "draft"
  | "released"
  | "in_progress"
  | "paused"
  | "completed"
  | "cancelled";

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  title: string;
  productId: string;
  quantity: number;
  unit: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart?: Date;
  actualEnd?: Date;
  status: WorkOrderStatus;
  machineId?: string;
  operatorId?: string;
  bomId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Machines ────────────────────────────────────────────────────────────────

export type MachineStatus = "running" | "idle" | "fault" | "maintenance" | "disconnected";

export interface Machine {
  id: string;
  name: string;
  opcuaEndpoint?: string;
  opcuaNodeIds?: Record<string, string>; // metric -> NodeId
  status: MachineStatus;
  lineId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Telemetry ───────────────────────────────────────────────────────────────

export interface MachineTelemetry {
  ts: Date;
  machineId: string;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

export interface MqttTelemetryPayload {
  machineId: string;
  metric: string;
  value: number;
  ts: string; // ISO 8601
  tags?: Record<string, string>;
}

// ─── OEE ─────────────────────────────────────────────────────────────────────

export interface OEESnapshot {
  machineId: string;
  from: Date;
  to: Date;
  granularity: "1m" | "1h" | "1d";
  availability: number;  // 0–1
  performance: number;   // 0–1
  quality: number;       // 0–1
  oee: number;           // availability * performance * quality
  plannedProductionTime: number; // seconds
  actualProductionTime: number;  // seconds
  goodCount: number;
  totalCount: number;
}

// ─── ERP ─────────────────────────────────────────────────────────────────────

export interface BOMItem {
  itemNumber: string;
  description: string;
  quantity: number;
  unit: string;
  materialId: string;
}

export interface ProductionResult {
  workOrderId: string;
  machineId: string;
  operatorId?: string;
  actualQuantity: number;
  scrapQuantity: number;
  completedAt: Date;
  notes?: string;
}

export interface ERPHealthStatus {
  connected: boolean;
  latency: number; // ms
}

// ─── Personnel ───────────────────────────────────────────────────────────────

export type UserRole = "operator" | "supervisor" | "engineer" | "admin";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  lineIds?: string[];
  createdAt: Date;
}

// ─── Production Schedules ─────────────────────────────────────────────────────

export type ProductionScheduleStatus =
  | "draft"
  | "confirmed"
  | "active"
  | "completed"
  | "cancelled";

export interface ProductionSchedule {
  id: string;
  workOrderId: string;
  machineId: string;
  lineId?: string;
  sequenceNumber: number;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart?: Date;
  actualEnd?: Date;
  shiftId?: string;
  operatorId?: string;
  status: ProductionScheduleStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Resource Assignments ─────────────────────────────────────────────────────

export type ResourceType = "machine" | "operator" | "tool" | "material";

export interface ResourceAssignment {
  id: string;
  workOrderId: string;
  resourceType: ResourceType;
  resourceId: string;
  quantity: number;
  unit?: string;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── MQTT Topic Helpers ──────────────────────────────────────────────────────

export const MqttTopics = {
  machineTelemetry: (machineId: string) => `mes/${machineId}/telemetry`,
  machineStatus: (machineId: string) => `mes/${machineId}/status`,
  workOrderEvents: (workOrderId: string) => `mes/workorders/${workOrderId}/events`,
} as const;

// ─── API Response Envelopes ──────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
