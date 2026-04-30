import { useAuthStore } from '@/auth'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token

  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (res.status === 401) {
    useAuthStore.getState().logout()
  }

  return res
}
