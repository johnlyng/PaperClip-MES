import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAppStore } from '@/store'

interface FormState {
  partName: string
  partNumber: string
  targetQty: string
  machineId: string
  operatorId: string
  notes: string
}

const emptyForm: FormState = {
  partName: '',
  partNumber: '',
  targetQty: '',
  machineId: '',
  operatorId: '',
  notes: '',
}

export function CreateWorkOrderDialog() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<FormState>>({})
  const { createWorkOrder, machines, operators } = useAppStore()

  const availableMachines = machines.filter(m => m.status !== 'fault' && m.status !== 'offline')

  function validate(): boolean {
    const errs: Partial<FormState> = {}
    if (!form.partName.trim()) errs.partName = 'Required'
    if (!form.partNumber.trim()) errs.partNumber = 'Required'
    const qty = parseInt(form.targetQty, 10)
    if (!form.targetQty || isNaN(qty) || qty <= 0) errs.targetQty = 'Must be a positive number'
    if (!form.machineId) errs.machineId = 'Required'
    if (!form.operatorId) errs.operatorId = 'Required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    createWorkOrder({
      partName: form.partName.trim(),
      partNumber: form.partNumber.trim(),
      targetQty: parseInt(form.targetQty, 10),
      machineId: form.machineId,
      operatorId: form.operatorId,
      notes: form.notes.trim() || undefined,
    })
    setForm(emptyForm)
    setErrors({})
    setOpen(false)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setForm(emptyForm)
      setErrors({})
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button data-testid="new-work-order-btn" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New Work Order
      </Button>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Work Order</DialogTitle>
          <DialogDescription>Fill in the details to create a new work order.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Part Name */}
          <div className="space-y-1.5">
            <Label htmlFor="partName">Part Name <span className="text-red-400">*</span></Label>
            <Input
              id="partName"
              placeholder="e.g. Bracket Assembly"
              value={form.partName}
              onChange={e => setForm(f => ({ ...f, partName: e.target.value }))}
            />
            {errors.partName && <p className="text-xs text-red-400">{errors.partName}</p>}
          </div>

          {/* Part Number */}
          <div className="space-y-1.5">
            <Label htmlFor="partNumber">Part Number <span className="text-red-400">*</span></Label>
            <Input
              id="partNumber"
              placeholder="e.g. PN-10042"
              value={form.partNumber}
              onChange={e => setForm(f => ({ ...f, partNumber: e.target.value }))}
            />
            {errors.partNumber && <p className="text-xs text-red-400">{errors.partNumber}</p>}
          </div>

          {/* Target Qty */}
          <div className="space-y-1.5">
            <Label htmlFor="targetQty">Target Quantity <span className="text-red-400">*</span></Label>
            <Input
              id="targetQty"
              type="number"
              min={1}
              placeholder="e.g. 500"
              value={form.targetQty}
              onChange={e => setForm(f => ({ ...f, targetQty: e.target.value }))}
            />
            {errors.targetQty && <p className="text-xs text-red-400">{errors.targetQty}</p>}
          </div>

          {/* Machine */}
          <div className="space-y-1.5">
            <Label>Machine <span className="text-red-400">*</span></Label>
            <Select value={form.machineId} onValueChange={v => setForm(f => ({ ...f, machineId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select machine" />
              </SelectTrigger>
              <SelectContent>
                {availableMachines.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} — <span className="capitalize text-slate-400">{m.status}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.machineId && <p className="text-xs text-red-400">{errors.machineId}</p>}
          </div>

          {/* Operator */}
          <div className="space-y-1.5">
            <Label>Operator <span className="text-red-400">*</span></Label>
            <Select value={form.operatorId} onValueChange={v => setForm(f => ({ ...f, operatorId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select operator" />
              </SelectTrigger>
              <SelectContent>
                {operators.map(op => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.name} ({op.badge})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.operatorId && <p className="text-xs text-red-400">{errors.operatorId}</p>}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes or instructions…"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button data-testid="submit-work-order-btn" onClick={handleSubmit}>Create Work Order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
