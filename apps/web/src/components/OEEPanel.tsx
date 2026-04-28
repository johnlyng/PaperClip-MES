import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store'
import type { Machine, MachineStatus } from '@/types'
import { cn } from '@/lib/utils'

// --- Radial gauge for a single metric ----------------------------------

interface GaugeProps {
  value: number   // 0–1
  label: string
  color: string
}

function RadialGauge({ value, label, color }: GaugeProps) {
  const pct = Math.round(value * 100)
  const data = [{ value: pct, fill: color }]

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%" cy="50%"
            innerRadius="70%" outerRadius="100%"
            barSize={8}
            data={data}
            startAngle={225}
            endAngle={-45}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              background={{ fill: '#1e293b' }}
              dataKey="value"
              angleAxisId={0}
              cornerRadius={4}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-white">{pct}%</span>
        </div>
      </div>
      <span className="text-xs text-slate-400 font-medium">{label}</span>
    </div>
  )
}

// --- OEE card per machine -----------------------------------------------

interface OEECardProps {
  machine: Machine
}

function OEECard({ machine }: OEECardProps) {
  const oeeData = useAppStore(s => s.oeeData[machine.id])

  if (!oeeData) return null

  const oeeColor =
    oeeData.oee >= 0.85 ? '#22c55e' :
    oeeData.oee >= 0.65 ? '#3b82f6' :
    oeeData.oee >= 0.40 ? '#f59e0b' :
    '#ef4444'

  return (
    <div data-testid="machine-tile" className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-200">{machine.name}</h3>
        <Badge variant={machine.status}>{machine.status}</Badge>
      </div>

      {/* OEE summary */}
      <div className="flex items-center justify-center py-1">
        <div className="text-center">
          <div data-testid="oee-value" className="text-4xl font-bold" style={{ color: oeeColor }}>
            {Math.round(oeeData.oee * 100)}%
          </div>
          <div className="text-xs text-slate-500 mt-0.5">OEE</div>
        </div>
      </div>

      {/* A / P / Q gauges */}
      <div className="flex justify-around">
        <RadialGauge value={oeeData.availability} label="Avail" color="#3b82f6" />
        <RadialGauge value={oeeData.performance} label="Perf" color="#8b5cf6" />
        <RadialGauge value={oeeData.quality} label="Qual" color="#22c55e" />
      </div>

      {/* Cycle time */}
      {machine.cycleTime !== null && (
        <div className="text-center text-xs text-slate-500">
          Cycle: <span className="text-slate-300 font-medium">{machine.cycleTime}s</span>
        </div>
      )}
    </div>
  )
}

// --- Machine status indicator dot (small) --------------------------------

function StatusDot({ status }: { status: MachineStatus }) {
  const colors: Record<MachineStatus, string> = {
    running: 'bg-green-500 shadow-[0_0_6px_#22c55e]',
    idle: 'bg-yellow-400 shadow-[0_0_6px_#facc15]',
    fault: 'bg-red-500 shadow-[0_0_6px_#ef4444] animate-pulse',
    offline: 'bg-slate-600',
  }
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full shrink-0', colors[status])} />
}

// --- Machine status panel ------------------------------------------------

export function MachineStatusPanel() {
  const machines = useAppStore(s => s.machines)

  const counts: Record<MachineStatus, number> = { running: 0, idle: 0, fault: 0, offline: 0 }
  machines.forEach(m => counts[m.status]++)

  return (
    <section className="space-y-4">
      {/* Summary strip */}
      <div className="flex gap-4 flex-wrap">
        {(Object.entries(counts) as [MachineStatus, number][]).map(([status, count]) => (
          <div key={status} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
            <StatusDot status={status} />
            <span className="text-sm font-medium text-slate-300 capitalize">{status}</span>
            <span className="text-lg font-bold text-white">{count}</span>
          </div>
        ))}
      </div>

      {/* Per-machine OEE cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {machines.map(m => <OEECard key={m.id} machine={m} />)}
      </div>
    </section>
  )
}
