import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { TelemetryEvent, OEEData } from '@/types'

interface WSMessage {
  type: 'telemetry' | 'oee_update' | 'machine_status'
  payload: TelemetryEvent | OEEData | { machineId: string; status: string }
}

/**
 * Connects to the telemetry WebSocket endpoint.
 * Reconnects automatically with exponential back-off.
 * Falls back to a mock simulator when no WS URL is configured (dev mode).
 */
export function useTelemetryWS(wsUrl?: string) {
  const { ingestTelemetry, updateOEE, updateMachineStatus, setWsConnected } = useAppStore()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelay = useRef(1000)

  useEffect(() => {
    if (!wsUrl) {
      // No WS URL — run mock simulator in dev
      startMockSimulator(ingestTelemetry, updateOEE, setWsConnected)
      return () => {}
    }

    function connect() {
      const ws = new WebSocket(wsUrl!)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        reconnectDelay.current = 1000
      }

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data as string)
          if (msg.type === 'telemetry') ingestTelemetry(msg.payload as TelemetryEvent)
          else if (msg.type === 'oee_update') updateOEE(msg.payload as OEEData)
          else if (msg.type === 'machine_status') {
            const p = msg.payload as { machineId: string; status: string }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            updateMachineStatus(p.machineId, { status: p.status as any })
          }
        } catch {
          // malformed message — ignore
        }
      }

      ws.onerror = () => ws.close()

      ws.onclose = () => {
        setWsConnected(false)
        wsRef.current = null
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000)
          connect()
        }, reconnectDelay.current)
      }
    }

    connect()

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl])
}

// ---------------------------------------------------------------------------
// Mock simulator — fires events every few seconds when no real WS is present

const MOCK_MACHINES = [
  { id: 'mc-1', name: 'CNC-A' },
  { id: 'mc-2', name: 'CNC-B' },
  { id: 'mc-3', name: 'Press-1' },
  { id: 'mc-4', name: 'Lathe-2' },
]

const EVENT_TYPES = ['cycle_complete', 'production', 'scrap'] as const
const SEVERITIES = ['info', 'info', 'info', 'warning', 'error'] as const

let _mockSeq = 100

function randomMachine() {
  return MOCK_MACHINES[Math.floor(Math.random() * MOCK_MACHINES.length)]
}

function startMockSimulator(
  ingestTelemetry: (e: TelemetryEvent) => void,
  updateOEE: (d: OEEData) => void,
  setWsConnected: (c: boolean) => void,
) {
  setWsConnected(true)  // mark as "connected" to mock

  const telemetryInterval = setInterval(() => {
    const machine = randomMachine()
    const eventType = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)]
    const severity = SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)]
    const cycleTime = Math.floor(Math.random() * 30) + 20

    const messages: Record<string, string> = {
      cycle_complete: `Cycle complete — ${cycleTime}s`,
      production: 'Part produced',
      scrap: 'Scrap part detected — dimension out of tolerance',
    }

    ingestTelemetry({
      id: `mock-${_mockSeq++}`,
      machineId: machine.id,
      machineName: machine.name,
      eventType,
      value: eventType === 'cycle_complete' ? cycleTime : 1,
      unit: eventType === 'cycle_complete' ? 's' : 'pcs',
      message: messages[eventType],
      severity,
      timestamp: new Date().toISOString(),
    })
  }, 3_000)

  // OEE drift every 8 s
  const oeeInterval = setInterval(() => {
    const machine = randomMachine()
    const availability = 0.7 + Math.random() * 0.28
    const performance = 0.65 + Math.random() * 0.33
    const quality = 0.92 + Math.random() * 0.07
    updateOEE({
      machineId: machine.id,
      availability,
      performance,
      quality,
      oee: availability * performance * quality,
      timestamp: new Date().toISOString(),
    })
  }, 8_000)

  // Return cleanup — but since we're inside useEffect and this path
  // never re-runs, the caller handles cleanup via the useEffect return.
  return () => {
    clearInterval(telemetryInterval)
    clearInterval(oeeInterval)
  }
}
