import { useState, useEffect } from 'react'
import { useTelemetryWS } from '@/hooks/useTelemetryWS'
import { WorkOrderTable } from '@/components/WorkOrderTable'
import { CreateWorkOrderDialog } from '@/components/CreateWorkOrderDialog'
import { MachineStatusPanel } from '@/components/OEEPanel'
import { TelemetryFeed } from '@/components/TelemetryFeed'
import { MachineManagement } from '@/components/MachineManagement'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store'

// WS URL from env — falls back to mock simulator when undefined
const WS_URL = import.meta.env.VITE_WS_URL as string | undefined

// ─── Inline login panel ────────────────────────────────────────────────────

function LoginPanel() {
  const { login } = useAppStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleLogin} className="flex items-center gap-2">
      <Input
        className="h-7 w-28 text-xs bg-slate-800 border-slate-700"
        placeholder="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        autoComplete="username"
      />
      <Input
        className="h-7 w-24 text-xs bg-slate-800 border-slate-700"
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <Button size="sm" type="submit" disabled={loading} className="h-7 text-xs px-3">
        {loading ? '…' : 'Sign in'}
      </Button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  )
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header() {
  const wsConnected = useAppStore(s => s.wsConnected)
  const { authToken, currentUserRole, logout } = useAppStore()

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">G</div>
        <div>
          <h1 className="text-base font-semibold text-white leading-none">GStack Shop Floor</h1>
          <p className="text-xs text-slate-500 mt-0.5">Work Order Dashboard</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-green-400 shadow-[0_0_6px_#4ade80]' : 'bg-slate-600'}`}
          title={wsConnected ? 'Connected' : 'Disconnected'}
        />
        {authToken ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 capitalize">{currentUserRole ?? 'user'}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={logout}>
              Sign out
            </Button>
          </div>
        ) : (
          <LoginPanel />
        )}
        <span className="text-xs text-slate-500 hidden sm:inline">
          {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>
    </header>
  )
}

export default function App() {
  useTelemetryWS(WS_URL)
  const { authToken, fetchApiMachines } = useAppStore()

  // Fetch machines whenever auth token becomes available
  useEffect(() => {
    if (authToken) {
      void fetchApiMachines()
    }
  }, [authToken, fetchApiMachines])

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 px-4 sm:px-6 py-6 space-y-8 max-w-screen-2xl mx-auto w-full">

        {/* Machine Status & OEE */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Machine Status &amp; OEE
          </h2>
          <MachineStatusPanel />
        </section>

        {/* Machine Registry (DB-backed) */}
        <section>
          <MachineManagement />
        </section>

        {/* Work Orders + Telemetry */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Work Orders</h2>
              <CreateWorkOrderDialog />
            </div>
            <WorkOrderTable />
          </section>

          <section className="min-h-0">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Live Feed</h2>
            <div className="h-[600px]">
              <TelemetryFeed />
            </div>
          </section>

        </div>
      </main>
    </div>
  )
}
