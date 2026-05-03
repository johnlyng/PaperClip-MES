export type WorkOrderStatus = 'draft' | 'released' | 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface WorkOrder {
  id: string
  orderNumber: string
  partName: string
  partNumber: string
  targetQty: number
  actualQty: number
  machineId: string
  machineName: string
  operatorId: string
  operatorName: string
  status: WorkOrderStatus
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  notes?: string
}

export interface CreateWorkOrderPayload {
  partName: string
  partNumber: string
  targetQty: number
  machineId: string
  operatorId: string
  notes?: string
}

export type MachineStatus = 'running' | 'idle' | 'fault' | 'offline'

export interface Machine {
  id: string
  name: string
  status: MachineStatus
  currentOrderId: string | null
  cycleTime: number | null  // seconds
  lastUpdated: string
}

export interface OEEData {
  machineId: string
  availability: number   // 0–1
  performance: number    // 0–1
  quality: number        // 0–1
  oee: number            // 0–1  (A × P × Q)
  timestamp: string
}

export interface TelemetryEvent {
  id: string
  machineId: string
  machineName: string
  eventType: 'cycle_complete' | 'fault' | 'status_change' | 'scrap' | 'production'
  value?: number
  unit?: string
  message: string
  severity: 'info' | 'warning' | 'error'
  timestamp: string
}

export interface Operator {
  id: string
  name: string
  badge: string
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export interface Shift {
  id: string
  name: string
  /** "HH:MM" 24-hour local time */
  startTime: string
  /** "HH:MM" 24-hour local time */
  endTime: string
  /** 0=Sun, 1=Mon, …, 6=Sat */
  daysOfWeek: number[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateShiftPayload {
  name: string
  startTime: string
  endTime: string
  daysOfWeek: number[]
  isActive?: boolean
}

export type UpdateShiftPayload = Partial<CreateShiftPayload>
