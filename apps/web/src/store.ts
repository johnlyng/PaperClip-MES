import { create } from 'zustand'
import type {
  WorkOrder,
  CreateWorkOrderPayload,
  Machine,
  OEEData,
  TelemetryEvent,
  Operator,
  ApiMachine,
  CreateApiMachinePayload,
  UpdateApiMachinePayload,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// --- Seed data ----------------------------------------------------------

const SEED_OPERATORS: Operator[] = [
  { id: 'op-1', name: 'Alice Kim', badge: 'AK-001' },
  { id: 'op-2', name: 'Bob Chen', badge: 'BC-002' },
  { id: 'op-3', name: 'Carlos Diaz', badge: 'CD-003' },
]

const SEED_MACHINES: Machine[] = [
  { id: 'mc-1', name: 'CNC-A', status: 'running', currentOrderId: 'wo-1', cycleTime: 42, lastUpdated: new Date().toISOString() },
  { id: 'mc-2', name: 'CNC-B', status: 'idle', currentOrderId: null, cycleTime: null, lastUpdated: new Date().toISOString() },
  { id: 'mc-3', name: 'Press-1', status: 'fault', currentOrderId: null, cycleTime: null, lastUpdated: new Date().toISOString() },
  { id: 'mc-4', name: 'Lathe-2', status: 'running', currentOrderId: 'wo-2', cycleTime: 28, lastUpdated: new Date().toISOString() },
]

const SEED_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-1', orderNumber: 'WO-2024-001', partName: 'Bracket Assembly', partNumber: 'PN-10042',
    targetQty: 250, actualQty: 87, machineId: 'mc-1', machineName: 'CNC-A',
    operatorId: 'op-1', operatorName: 'Alice Kim', status: 'in_progress',
    startedAt: new Date(Date.now() - 3_600_000).toISOString(), completedAt: null,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: 'wo-2', orderNumber: 'WO-2024-002', partName: 'Shaft Pin', partNumber: 'PN-10087',
    targetQty: 500, actualQty: 312, machineId: 'mc-4', machineName: 'Lathe-2',
    operatorId: 'op-2', operatorName: 'Bob Chen', status: 'in_progress',
    startedAt: new Date(Date.now() - 5_400_000).toISOString(), completedAt: null,
    createdAt: new Date(Date.now() - 9_000_000).toISOString(),
  },
  {
    id: 'wo-3', orderNumber: 'WO-2024-003', partName: 'Cover Plate', partNumber: 'PN-10099',
    targetQty: 100, actualQty: 100, machineId: 'mc-2', machineName: 'CNC-B',
    operatorId: 'op-3', operatorName: 'Carlos Diaz', status: 'completed',
    startedAt: new Date(Date.now() - 18_000_000).toISOString(),
    completedAt: new Date(Date.now() - 3_600_000).toISOString(),
    createdAt: new Date(Date.now() - 21_600_000).toISOString(),
  },
  {
    id: 'wo-4', orderNumber: 'WO-2024-004', partName: 'Valve Housing', partNumber: 'PN-10120',
    targetQty: 75, actualQty: 0, machineId: 'mc-3', machineName: 'Press-1',
    operatorId: 'op-1', operatorName: 'Alice Kim', status: 'pending',
    startedAt: null, completedAt: null,
    createdAt: new Date(Date.now() - 1_800_000).toISOString(),
  },
  {
    id: 'wo-5', orderNumber: 'WO-2024-005', partName: 'Gear Carrier', partNumber: 'PN-10155',
    targetQty: 50, actualQty: 0, machineId: 'mc-2', machineName: 'CNC-B',
    operatorId: 'op-3', operatorName: 'Carlos Diaz', status: 'released',
    startedAt: null, completedAt: null,
    createdAt: new Date(Date.now() - 900_000).toISOString(),
  },
]

const SEED_OEE: Record<string, OEEData> = {
  'mc-1': { machineId: 'mc-1', availability: 0.92, performance: 0.88, quality: 0.97, oee: 0.785, timestamp: new Date().toISOString() },
  'mc-2': { machineId: 'mc-2', availability: 0.60, performance: 0.00, quality: 1.00, oee: 0.00, timestamp: new Date().toISOString() },
  'mc-3': { machineId: 'mc-3', availability: 0.00, performance: 0.00, quality: 0.00, oee: 0.00, timestamp: new Date().toISOString() },
  'mc-4': { machineId: 'mc-4', availability: 0.95, performance: 0.91, quality: 0.99, oee: 0.856, timestamp: new Date().toISOString() },
}

const SEED_TELEMETRY: TelemetryEvent[] = [
  { id: 't-1', machineId: 'mc-1', machineName: 'CNC-A', eventType: 'cycle_complete', value: 42, unit: 's', message: 'Cycle complete — 42 s', severity: 'info', timestamp: new Date(Date.now() - 60_000).toISOString() },
  { id: 't-2', machineId: 'mc-3', machineName: 'Press-1', eventType: 'fault', message: 'Hydraulic pressure low (28 PSI)', severity: 'error', timestamp: new Date(Date.now() - 180_000).toISOString() },
  { id: 't-3', machineId: 'mc-4', machineName: 'Lathe-2', eventType: 'production', value: 1, unit: 'pcs', message: 'Part produced', severity: 'info', timestamp: new Date(Date.now() - 240_000).toISOString() },
]

// --- Store types --------------------------------------------------------

interface AppState {
  workOrders: WorkOrder[]
  machines: Machine[]
  oeeData: Record<string, OEEData>
  telemetry: TelemetryEvent[]
  operators: Operator[]
  wsConnected: boolean

  // Auth
  authToken: string | null
  currentUserRole: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void

  // DB-backed machine registry
  apiMachines: ApiMachine[]
  apiMachinesLoading: boolean
  apiMachinesError: string | null
  fetchApiMachines: () => Promise<void>
  createApiMachine: (payload: CreateApiMachinePayload) => Promise<void>
  updateApiMachine: (id: string, payload: UpdateApiMachinePayload) => Promise<void>
  deleteApiMachine: (id: string) => Promise<void>

  // Work order actions
  createWorkOrder: (payload: CreateWorkOrderPayload) => WorkOrder
  startWorkOrder: (id: string) => void
  closeWorkOrder: (id: string) => void
  cancelWorkOrder: (id: string) => void

  // Realtime ingestion (called by WS hook)
  ingestTelemetry: (event: TelemetryEvent) => void
  updateMachineStatus: (machineId: string, updates: Partial<Machine>) => void
  updateOEE: (data: OEEData) => void
  setWsConnected: (connected: boolean) => void
}

let _nextOrderSeq = 5

function generateOrderNumber(): string {
  const seq = String(_nextOrderSeq++).padStart(3, '0')
  return `WO-2024-0${seq}`
}

export const useAppStore = create<AppState>((set, get) => ({
  workOrders: SEED_WORK_ORDERS,
  machines: SEED_MACHINES,
  oeeData: SEED_OEE,
  telemetry: SEED_TELEMETRY,
  operators: SEED_OPERATORS,
  wsConnected: false,

  // ── Auth ──────────────────────────────────────────────────────────────────
  authToken: localStorage.getItem('authToken'),
  currentUserRole: localStorage.getItem('currentUserRole'),

  login: async (username, password) => {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(body.message ?? 'Login failed')
    }
    const { token } = await res.json() as { token: string }

    // Decode role from JWT payload (base64url, no verification needed client-side)
    let role: string | null = null
    try {
      const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }
      role = payload.role ?? null
    } catch { /* ignore */ }

    localStorage.setItem('authToken', token)
    if (role) localStorage.setItem('currentUserRole', role)
    set({ authToken: token, currentUserRole: role })

    // Eagerly fetch machines now that we have a token
    await get().fetchApiMachines()
  },

  logout: () => {
    localStorage.removeItem('authToken')
    localStorage.removeItem('currentUserRole')
    set({ authToken: null, currentUserRole: null, apiMachines: [] })
  },

  // ── DB-backed machine registry ────────────────────────────────────────────
  apiMachines: [],
  apiMachinesLoading: false,
  apiMachinesError: null,

  fetchApiMachines: async () => {
    const token = get().authToken
    if (!token) return
    set({ apiMachinesLoading: true, apiMachinesError: null })
    try {
      const res = await fetch(`${API_BASE}/api/v1/machines`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as ApiMachine[]
      set({ apiMachines: data })
    } catch (err) {
      set({ apiMachinesError: err instanceof Error ? err.message : 'Failed to load machines' })
    } finally {
      set({ apiMachinesLoading: false })
    }
  },

  createApiMachine: async (payload) => {
    const token = get().authToken
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${API_BASE}/api/v1/machines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(body.message ?? `HTTP ${res.status}`)
    }
    const created = await res.json() as ApiMachine
    set(state => ({ apiMachines: [...state.apiMachines, created] }))
  },

  updateApiMachine: async (id, payload) => {
    const token = get().authToken
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${API_BASE}/api/v1/machines/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(body.message ?? `HTTP ${res.status}`)
    }
    const updated = await res.json() as ApiMachine
    set(state => ({
      apiMachines: state.apiMachines.map(m => m.id === id ? updated : m),
    }))
  },

  deleteApiMachine: async (id) => {
    const token = get().authToken
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${API_BASE}/api/v1/machines/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(body.message ?? `HTTP ${res.status}`)
    }
    set(state => ({ apiMachines: state.apiMachines.filter(m => m.id !== id) }))
  },

  createWorkOrder: (payload) => {
    const machine = get().machines.find(m => m.id === payload.machineId)
    const operator = get().operators.find(o => o.id === payload.operatorId)
    const wo: WorkOrder = {
      id: `wo-${Date.now()}`,
      orderNumber: generateOrderNumber(),
      partName: payload.partName,
      partNumber: payload.partNumber,
      targetQty: payload.targetQty,
      actualQty: 0,
      machineId: payload.machineId,
      machineName: machine?.name ?? 'Unknown',
      operatorId: payload.operatorId,
      operatorName: operator?.name ?? 'Unknown',
      status: 'draft',
      startedAt: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      notes: payload.notes,
    }
    set(state => ({ workOrders: [wo, ...state.workOrders] }))
    return wo
  },

  startWorkOrder: (id) => {
    set(state => ({
      workOrders: state.workOrders.map(wo =>
        wo.id === id ? { ...wo, status: 'in_progress', startedAt: new Date().toISOString() } : wo,
      ),
      machines: state.machines.map(m =>
        m.id === state.workOrders.find(w => w.id === id)?.machineId
          ? { ...m, status: 'running', currentOrderId: id }
          : m,
      ),
    }))
  },

  closeWorkOrder: (id) => {
    set(state => ({
      workOrders: state.workOrders.map(wo =>
        wo.id === id ? { ...wo, status: 'completed', completedAt: new Date().toISOString() } : wo,
      ),
      machines: state.machines.map(m =>
        m.id === state.workOrders.find(w => w.id === id)?.machineId
          ? { ...m, status: 'idle', currentOrderId: null }
          : m,
      ),
    }))
  },

  cancelWorkOrder: (id) => {
    set(state => ({
      workOrders: state.workOrders.map(wo =>
        wo.id === id ? { ...wo, status: 'cancelled' } : wo,
      ),
    }))
  },

  ingestTelemetry: (event) => {
    set(state => ({
      telemetry: [event, ...state.telemetry].slice(0, 100),
    }))
  },

  updateMachineStatus: (machineId, updates) => {
    set(state => ({
      machines: state.machines.map(m =>
        m.id === machineId ? { ...m, ...updates, lastUpdated: new Date().toISOString() } : m,
      ),
    }))
  },

  updateOEE: (data) => {
    set(state => ({ oeeData: { ...state.oeeData, [data.machineId]: data } }))
  },

  setWsConnected: (connected) => {
    set({ wsConnected: connected })
  },
}))
