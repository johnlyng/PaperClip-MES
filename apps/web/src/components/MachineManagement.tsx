/**
 * MachineManagement — admin-only CRUD UI for the machine registry.
 *
 * Fetches machines from /api/v1/machines and allows admins to create,
 * edit, and delete entries. Uses the auth token stored in the Zustand store.
 *
 * Read operations (list) are visible to all authenticated users.
 * Write operations (create/edit/delete) are gated on role === 'admin'.
 * The API enforces this server-side regardless of what the UI shows.
 */

import { useState } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store'
import type { ApiMachine, MachineStatusValue } from '@/types'

// ─── Machine status badge ──────────────────────────────────────────────────

const STATUS_LABELS: Record<MachineStatusValue, string> = {
  running: 'Running',
  idle: 'Idle',
  fault: 'Fault',
  maintenance: 'Maintenance',
  disconnected: 'Disconnected',
}

// ─── Machine form ──────────────────────────────────────────────────────────

interface MachineFormState {
  id: string
  name: string
  description: string
  type: string
  lineId: string
  idealRatePerMin: string
  status: MachineStatusValue
}

const EMPTY_FORM: MachineFormState = {
  id: '',
  name: '',
  description: '',
  type: '',
  lineId: '',
  idealRatePerMin: '',
  status: 'disconnected',
}

function machineToForm(m: ApiMachine): MachineFormState {
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? '',
    type: m.type ?? '',
    lineId: m.lineId ?? '',
    idealRatePerMin: m.idealRatePerMin != null ? String(m.idealRatePerMin) : '',
    status: m.status,
  }
}

// ─── Create / Edit dialog ──────────────────────────────────────────────────

interface MachineDialogProps {
  open: boolean
  editing: ApiMachine | null
  onClose: () => void
  onSave: (form: MachineFormState) => Promise<void>
}

function MachineDialog({ open, editing, onClose, onSave }: MachineDialogProps) {
  const [form, setForm] = useState<MachineFormState>(
    editing ? machineToForm(editing) : EMPTY_FORM
  )
  const [errors, setErrors] = useState<Partial<MachineFormState>>({})
  const [saving, setSaving] = useState(false)

  function field<K extends keyof MachineFormState>(key: K) {
    return (value: MachineFormState[K]) =>
      setForm(f => ({ ...f, [key]: value }))
  }

  function validate(): boolean {
    const e: Partial<MachineFormState> = {}
    if (!editing && !form.id.trim()) e.id = 'Required'
    if (!form.name.trim()) e.name = 'Required'
    if (form.idealRatePerMin !== '') {
      const v = parseFloat(form.idealRatePerMin)
      if (isNaN(v) || v <= 0) e.idealRatePerMin = 'Must be a positive number'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Machine' : 'Create Machine'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update machine details.' : 'Add a new machine to the registry.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {/* ID — only editable when creating */}
          {!editing && (
            <div className="space-y-1">
              <Label htmlFor="mc-id">Machine ID <span className="text-red-400">*</span></Label>
              <Input
                id="mc-id"
                placeholder="e.g. machine-lathe-001"
                value={form.id}
                onChange={e => field('id')(e.target.value)}
              />
              {errors.id && <p className="text-xs text-red-400">{errors.id}</p>}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="mc-name">Name <span className="text-red-400">*</span></Label>
            <Input
              id="mc-name"
              placeholder="e.g. CNC Lathe Alpha"
              value={form.name}
              onChange={e => field('name')(e.target.value)}
            />
            {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="mc-desc">Description</Label>
            <Input
              id="mc-desc"
              placeholder="Optional description"
              value={form.description}
              onChange={e => field('description')(e.target.value)}
            />
          </div>

          {/* Type + Line side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mc-type">Type</Label>
              <Input
                id="mc-type"
                placeholder="cnc, robot, reactor…"
                value={form.type}
                onChange={e => field('type')(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mc-line">Line ID</Label>
              <Input
                id="mc-line"
                placeholder="line-001"
                value={form.lineId}
                onChange={e => field('lineId')(e.target.value)}
              />
            </div>
          </div>

          {/* Ideal rate + Status side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mc-rate">Ideal Rate (units/min)</Label>
              <Input
                id="mc-rate"
                type="number"
                min={0}
                step="0.1"
                placeholder="e.g. 10"
                value={form.idealRatePerMin}
                onChange={e => field('idealRatePerMin')(e.target.value)}
              />
              {errors.idealRatePerMin && (
                <p className="text-xs text-red-400">{errors.idealRatePerMin}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={v => field('status')(v as MachineStatusValue)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as MachineStatusValue[]).map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Machine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete confirmation dialog ────────────────────────────────────────────

interface DeleteDialogProps {
  machine: ApiMachine | null
  onClose: () => void
  onConfirm: () => Promise<void>
}

function DeleteDialog({ machine, onClose, onConfirm }: DeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={!!machine} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Delete Machine</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{machine?.name}</strong>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Machine Management panel ──────────────────────────────────────────────

export function MachineManagement() {
  const {
    apiMachines,
    apiMachinesLoading,
    apiMachinesError,
    currentUserRole,
    createApiMachine,
    updateApiMachine,
    deleteApiMachine,
  } = useAppStore()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ApiMachine | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiMachine | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const isAdmin = currentUserRole === 'admin'

  async function handleCreate(form: MachineFormState) {
    setActionError(null)
    try {
      await createApiMachine({
        id: form.id.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type.trim() || undefined,
        lineId: form.lineId.trim() || undefined,
        idealRatePerMin: form.idealRatePerMin !== '' ? parseFloat(form.idealRatePerMin) : undefined,
        status: form.status,
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Create failed')
      throw err
    }
  }

  async function handleUpdate(form: MachineFormState) {
    if (!editTarget) return
    setActionError(null)
    try {
      await updateApiMachine(editTarget.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type.trim() || undefined,
        lineId: form.lineId.trim() || undefined,
        idealRatePerMin: form.idealRatePerMin !== '' ? parseFloat(form.idealRatePerMin) : null,
        status: form.status,
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Update failed')
      throw err
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setActionError(null)
    try {
      await deleteApiMachine(deleteTarget.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed')
      throw err
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Machine Registry
          </h2>
          {!isAdmin && (
            <p className="text-xs text-slate-500 mt-0.5">Read-only — admin access required to edit</p>
          )}
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Machine
          </Button>
        )}
      </div>

      {/* Error banner */}
      {(apiMachinesError || actionError) && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-2 text-sm text-red-300 flex items-center justify-between">
          <span>{apiMachinesError ?? actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-2 text-red-400 hover:text-red-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {apiMachinesLoading && (
        <p className="text-sm text-slate-500">Loading machines…</p>
      )}

      {/* Table */}
      {!apiMachinesLoading && apiMachines.length === 0 && (
        <p className="text-sm text-slate-500">No machines in registry.</p>
      )}

      {apiMachines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">ID</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Line</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Rate/min</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                {isAdmin && (
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {apiMachines.map(m => (
                <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{m.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-200">
                    {m.name}
                    {m.description && (
                      <p className="text-xs text-slate-500 font-normal mt-0.5">{m.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 hidden md:table-cell capitalize">{m.type ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 hidden lg:table-cell font-mono text-xs">{m.lineId ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-300 hidden md:table-cell">
                    {m.idealRatePerMin != null ? m.idealRatePerMin : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={m.status as Parameters<typeof Badge>[0]['variant']}>
                      {STATUS_LABELS[m.status] ?? m.status}
                    </Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditTarget(m)}
                          className="text-slate-400 hover:text-slate-200 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(m)}
                          className="text-slate-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      {createOpen && (
        <MachineDialog
          open={createOpen}
          editing={null}
          onClose={() => setCreateOpen(false)}
          onSave={handleCreate}
        />
      )}

      {editTarget && (
        <MachineDialog
          open={!!editTarget}
          editing={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleUpdate}
        />
      )}

      <DeleteDialog
        machine={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
