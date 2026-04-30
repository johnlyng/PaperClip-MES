import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

interface CurrentUser {
  id: string
  username: string
  displayName: string
  role: string
}

interface AuthState {
  token: string | null
  currentUser: CurrentUser | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

function decodeJwtPayload(token: string): CurrentUser {
  const base64 = token.split('.')[1]
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const payload = JSON.parse(json) as {
    sub: string
    username: string
    displayName: string
    role: string
  }
  return {
    id: payload.sub,
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      currentUser: null,

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
        const currentUser = decodeJwtPayload(token)

        // Persist for E2E fixture compatibility
        localStorage.setItem('mes:token', token)

        set({ token, currentUser })
      },

      logout: () => {
        localStorage.removeItem('mes:token')
        set({ token: null, currentUser: null })
      },
    }),
    {
      name: 'mes-auth',
    }
  )
)
