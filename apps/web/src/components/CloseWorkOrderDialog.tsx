import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import type { WorkOrder } from '@/types'

interface Props {
  workOrder: WorkOrder | null
  onClose: () => void
}

export function CloseWorkOrderDialog({ workOrder, onClose }: Props) {
  const closeWorkOrder = useAppStore(s => s.closeWorkOrder)
  const [actualQty, setActualQty] = useState('')
  const [error, setError] = useState('')

  const open = workOrder !== null

  function handleOpenChange(next: boolean) {
    if (!next) {
      setActualQty('')
      setError('')
      onClose()
    }
  }

  function handleSubmit() {
    const qty = parseInt(actualQty, 10)
    if (!actualQty || isNaN(qty) || qty < 0) {
      setError('Enter a valid quantity (0 or more)')
      return
    }
    closeWorkOrder(workOrder!.id, qty)
    setActualQty('')
    setError('')
    onClose()
  }

  if (!workOrder) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="close-work-order-dialog">
        <DialogHeader>
          <DialogTitle>Complete Work Order</DialogTitle>
          <DialogDescription>
            {workOrder.orderNumber} — {workOrder.partName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="actualQty" className="text-sm font-medium">
              Actual Quantity Produced <span className="text-red-400">*</span>
            </Label>
            <Input
              id="actualQty"
              data-testid="actual-qty-input"
              type="number"
              min={0}
              placeholder={`Target: ${workOrder.targetQty}`}
              value={actualQty}
              onChange={e => {
                setActualQty(e.target.value)
                setError('')
              }}
              // Large input for easy thumb typing on mobile
              className="text-lg h-12"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <p className="text-xs text-slate-500">
              Target was {workOrder.targetQty} pcs. Enter the actual count you produced.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="confirm-close-work-order-btn"
            variant="success"
            onClick={handleSubmit}
            className="min-h-[44px]"
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Complete Work Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
