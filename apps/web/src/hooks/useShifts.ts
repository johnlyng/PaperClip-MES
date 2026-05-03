/**
 * useShifts — fetches active shift definitions from GET /api/v1/shifts.
 *
 * Used by the production scheduling UI to populate the shift selector dropdown.
 */

import { useState, useEffect } from 'react'
import { apiFetch } from '@/api'
import type { Shift } from '@/types'

interface UseShiftsResult {
  shifts: Shift[]
  loading: boolean
  error: string | null
}

export function useShifts(): UseShiftsResult {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch('/api/v1/shifts')
        if (!res.ok) throw new Error(`Failed to load shifts (${res.status})`)
        const data: Shift[] = await res.json()
        if (!cancelled) setShifts(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { shifts, loading, error }
}
