import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/auth'

export function LoginPage() {
  const login = useAuthStore(s => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
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
    <div className="min-h-screen bg-[#0f1117] text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo / wordmark */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl">
            G
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white">GStack Shop Floor</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to continue</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              required
              className="h-14 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              required
              className="h-14 text-base"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={loading}
            className="w-full h-14 text-base"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
