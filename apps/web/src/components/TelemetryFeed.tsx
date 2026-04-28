import { useEffect, useRef } from 'react'
import { AlertTriangle, Info, XCircle, Wifi, WifiOff } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { TelemetryEvent } from '@/types'

function SeverityIcon({ severity }: { severity: TelemetryEvent['severity'] }) {
  if (severity === 'error') return <XCircle className="h-4 w-4 text-red-400 shrink-0" />
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
  return <Info className="h-4 w-4 text-blue-400 shrink-0" />
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function TelemetryFeed() {
  const telemetry = useAppStore(s => s.telemetry)
  const wsConnected = useAppStore(s => s.wsConnected)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [telemetry.length])

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/50">
        <h2 className="text-sm font-semibold text-slate-200">Live Telemetry</h2>
        <div className="flex items-center gap-1.5">
          {wsConnected ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-green-400" />
              <span className="text-xs text-green-400">Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs text-slate-500">Reconnecting…</span>
            </>
          )}
        </div>
      </div>

      {/* Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {telemetry.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
            No events yet…
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {telemetry.map((event, idx) => (
              <li
                key={event.id}
                className={cn(
                  'flex gap-3 px-4 py-3 text-sm transition-colors',
                  idx === 0 && 'bg-slate-800/30',
                  event.severity === 'error' && 'bg-red-950/10',
                  event.severity === 'warning' && 'bg-yellow-950/10',
                )}
              >
                <SeverityIcon severity={event.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-slate-200 text-xs">{event.machineName}</span>
                    <span className="text-xs text-slate-500 shrink-0">{formatTime(event.timestamp)}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">{event.message}</p>
                </div>
                {event.value !== undefined && (
                  <span className="text-xs text-slate-500 shrink-0 self-start mt-0.5">
                    {event.value}{event.unit}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
