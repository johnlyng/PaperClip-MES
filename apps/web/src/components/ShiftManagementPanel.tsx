/**
 * ShiftManagementPanel — create, edit, and deactivate shift definitions.
 *
 * Visible to all authenticated users (read) but edit/create/delete actions
 * are visible only to supervisors and admins.
 *
 * Data is fetched from GET /api/v1/shifts?activeOnly=false so admins can
 * see and restore deactivated shifts.
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Power, Clock } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/api'
import { useAuthStore } from '@/auth'
import type { Shift, CreateShiftPayload } from '@/types'

// ─── Day-of-week helpers ─────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function DayPicker({
  value,
  onChange,
}: {
  value: number[]
  onChange: (days: number[]) => void
}) {
  function toggle(d: number) {
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())
  }
  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((label, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => toggle(idx)}
          className={`w-9 h-9 rounded text-xs font-medium transition-colors ${
            value.includes(idx)
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── Form state ──────────────────────────────────────────────────────────────

interface FormState {
  name: string
  startTime: string
  endTime: string
  daysOfWeek: number[]
}

const emptyForm: FormState = {
  name: '',
  startTime: '06:00',
  endTime: '14:00',
  daysOfWeek: [1, 2, 3, 4, 5],
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function ShiftManagementPanel() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formErrors, setFormErrors] = useState<Partial<FormState & { general: string }>>({})
  const [saving, setSaving] = useState(false)

  const currentUser = useAuthStore((s) => s.currentUser)
  const canEdit = currentUser?.role === 'supervisor' || currentUser?.role === 'admin'

  const fetchShifts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/v1/shifts?activeOnly=false')
      if (!res.ok) throw new Error(`Failed to load shifts (${res.status})`)
      const data: Shift[] = await res.json()
      setShifts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchShifts() }, [fetchShifts])

  function openCreate() {
    setEditingShift(null)
    setForm(emptyForm)
    setFormErrors({})
    setDialogOpen(true)
  }

  function openEdit(shift: Shift) {
    setEditingShift(shift)
    setForm({
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      daysOfWeek: [...shift.daysOfWeek],
    })
    setFormErrors({})
    setDialogOpen(true)
  }

  function validate(): boolean {
    const errs: Partial<FormState & { general: string }> = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.startTime)) errs.startTime = 'Use HH:MM format'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.endTime)) errs.endTime = 'Use HH:MM format'
    if (form.daysOfWeek.length === 0) errs.daysOfWeek = [] // signal for DayPicker
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const payload: CreateShiftPayload = {
        name: form.name.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        daysOfWeek: form.daysOfWeek,
      }

      let res: Response
      if (editingShift) {
        res = await apiFetch(`/api/v1/shifts/${editingShift.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      } else {
        res = await apiFetch('/api/v1/shifts', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Unknown error' }))
        setFormErrors({ ...formErrors, general: body.message ?? 'Save failed' })
        return
      }

      setDialogOpen(false)
      await fetchShifts()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(shift: Shift) {
    try {
      if (shift.isActive) {
        await apiFetch(`/api/v1/shifts/${shift.id}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/v1/shifts/${shift.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: true }),
        })
      }
      await fetchShifts()
    } catch {
      // silent — the list will re-fetch and show accurate state
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Shift Definitions
        </h2>
        {canEdit && (
          <Button size="sm" onClick={openCreate} className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Shift
          </Button>
        )}
      </div>

      {loading && (
        <p className="text-sm text-slate-500 animate-pulse">Loading shifts…</p>
      )}
      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {!loading && !error && shifts.length === 0 && (
        <p className="text-sm text-slate-500">No shifts defined yet.</p>
      )}

      {!loading && !error && shifts.length > 0 && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Hours</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Days</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Status</th>
                {canEdit && (
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-400">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift, i) => (
                <tr
                  key={shift.id}
                  className={`border-b border-slate-800 last:border-0 ${
                    shift.isActive ? '' : 'opacity-50'
                  } ${i % 2 === 0 ? 'bg-slate-900/20' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-200">{shift.name}</td>
                  <td className="px-4 py-3 text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {shift.startTime}–{shift.endTime}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <span className="text-xs">{shift.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={shift.isActive ? 'default' : 'offline'}
                      className={shift.isActive ? 'bg-green-900/40 text-green-400 border border-green-800' : ''}
                    >
                      {shift.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-slate-400 hover:text-slate-200"
                          onClick={() => openEdit(shift)}
                          title="Edit shift"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-7 w-7 p-0 ${
                            shift.isActive
                              ? 'text-slate-400 hover:text-red-400'
                              : 'text-slate-600 hover:text-green-400'
                          }`}
                          onClick={() => handleToggleActive(shift)}
                          title={shift.isActive ? 'Deactivate shift' : 'Reactivate shift'}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>{editingShift ? 'Edit Shift' : 'Create Shift'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {editingShift
                ? 'Update the shift name, hours, or days.'
                : 'Define a new recurring shift for production scheduling.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {formErrors.general && (
              <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                {formErrors.general}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="shift-name">Name</Label>
              <Input
                id="shift-name"
                placeholder="e.g. Morning, Afternoon, Night"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-slate-800 border-slate-700"
              />
              {formErrors.name && (
                <p className="text-xs text-red-400">{formErrors.name}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="shift-start">Start Time</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="bg-slate-800 border-slate-700"
                />
                {formErrors.startTime && (
                  <p className="text-xs text-red-400">{formErrors.startTime}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-end">End Time</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="bg-slate-800 border-slate-700"
                />
                {formErrors.endTime && (
                  <p className="text-xs text-red-400">{formErrors.endTime}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Days of Week</Label>
              <DayPicker
                value={form.daysOfWeek}
                onChange={(days) => setForm({ ...form, daysOfWeek: days })}
              />
              {form.daysOfWeek.length === 0 && (
                <p className="text-xs text-red-400">Select at least one day</p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="text-slate-400"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingShift ? 'Save Changes' : 'Create Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
