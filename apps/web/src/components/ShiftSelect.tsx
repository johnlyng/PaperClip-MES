/**
 * ShiftSelect — a controlled dropdown populated from GET /api/v1/shifts.
 *
 * Usage in the production scheduling form:
 *
 *   <ShiftSelect
 *     value={form.shiftId}
 *     onChange={(id) => setForm({ ...form, shiftId: id })}
 *   />
 */

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useShifts } from '@/hooks/useShifts'

interface ShiftSelectProps {
  value: string
  onChange: (shiftId: string) => void
  placeholder?: string
  disabled?: boolean
}

export function ShiftSelect({
  value,
  onChange,
  placeholder = 'Select shift…',
  disabled = false,
}: ShiftSelectProps) {
  const { shifts, loading, error } = useShifts()

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger className="bg-slate-800 border-slate-700">
          <SelectValue placeholder="Loading shifts…" />
        </SelectTrigger>
      </Select>
    )
  }

  if (error) {
    return (
      <Select disabled>
        <SelectTrigger className="bg-slate-800 border-slate-700 border-red-700">
          <SelectValue placeholder="Failed to load shifts" />
        </SelectTrigger>
      </Select>
    )
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="bg-slate-800 border-slate-700">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-slate-800 border-slate-700">
        {shifts.map((shift) => (
          <SelectItem key={shift.id} value={shift.id} className="text-slate-200">
            <span className="font-medium">{shift.name}</span>
            <span className="ml-2 text-slate-400 text-xs">
              {shift.startTime}–{shift.endTime}
            </span>
          </SelectItem>
        ))}
        {shifts.length === 0 && (
          <div className="px-3 py-2 text-sm text-slate-500">No active shifts defined</div>
        )}
      </SelectContent>
    </Select>
  )
}
