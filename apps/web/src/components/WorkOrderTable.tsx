import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, Play, CheckCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CloseWorkOrderDialog } from '@/components/CloseWorkOrderDialog'
import { useAppStore } from '@/store'
import type { WorkOrder, WorkOrderStatus } from '@/types'

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const labels: Record<WorkOrderStatus, string> = {
    draft: 'Draft',
    released: 'Released',
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return <Badge variant={status}>{labels[status]}</Badge>
}

function ProgressBar({ actual, target }: { actual: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  const color = pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-14 text-right shrink-0">
        {actual}/{target}
      </span>
    </div>
  )
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface ActionsProps {
  row: WorkOrder
  onStart: (id: string) => void
  onRequestClose: (workOrder: WorkOrder) => void
  onCancel: (id: string) => void
}

function RowActions({ row, onStart, onRequestClose, onCancel }: ActionsProps) {
  if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'draft') {
    return <span className="text-xs text-slate-600">—</span>
  }
  return (
    <div className="flex gap-2">
      {(row.status === 'released' || row.status === 'pending') && (
        <Button data-testid="start-work-order-btn" size="sm" variant="success" onClick={() => onStart(row.id)} title="Start">
          <Play className="h-3.5 w-3.5" />
          Start
        </Button>
      )}
      {row.status === 'in_progress' && (
        <Button data-testid="close-work-order-btn" size="sm" variant="success" onClick={() => onRequestClose(row)} title="Close">
          <CheckCircle className="h-3.5 w-3.5" />
          Close
        </Button>
      )}
      {(row.status === 'released' || row.status === 'pending' || row.status === 'in_progress') && (
        <Button data-testid="cancel-work-order-btn" size="sm" variant="destructive" onClick={() => onCancel(row.id)} title="Cancel">
          <XCircle className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

// Card layout for small viewports (< md breakpoint)
function WorkOrderCard({
  order,
  onStart,
  onRequestClose,
  onCancel,
}: {
  order: WorkOrder
  onStart: (id: string) => void
  onRequestClose: (workOrder: WorkOrder) => void
  onCancel: (id: string) => void
}) {
  const pct = order.targetQty > 0 ? Math.min(100, Math.round((order.actualQty / order.targetQty) * 100)) : 0
  const barColor = pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'

  return (
    <div data-testid="work-order-card" className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
      {/* Header: order number + status */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold text-slate-200">{order.orderNumber}</span>
        <StatusBadge status={order.status} />
      </div>

      {/* Part */}
      <div>
        <div className="font-medium text-slate-100">{order.partName}</div>
        <div className="text-xs text-slate-500 font-mono">{order.partNumber}</div>
      </div>

      {/* Machine / Operator row */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Machine</div>
          <div className="text-slate-300">{order.machineName}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-0.5">Operator</div>
          <div className="text-slate-300">{order.operatorName}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Progress</span>
          <span>{order.actualQty}/{order.targetQty}</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Started */}
      {order.startedAt && (
        <div className="text-xs text-slate-500">
          Started {formatRelativeTime(order.startedAt)}
        </div>
      )}

      {/* Action buttons — full-width for thumb targets */}
      {order.status !== 'completed' && order.status !== 'cancelled' && order.status !== 'draft' && (
        <div className="flex flex-col gap-2 pt-1">
          {(order.status === 'released' || order.status === 'pending') && (
            <Button
              data-testid="start-work-order-btn"
              variant="success"
              className="w-full min-h-[44px]"
              onClick={() => onStart(order.id)}
            >
              <Play className="h-4 w-4 mr-1" />
              Start Work Order
            </Button>
          )}
          {order.status === 'in_progress' && (
            <Button
              data-testid="close-work-order-btn"
              variant="success"
              className="w-full min-h-[44px]"
              onClick={() => onRequestClose(order)}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Close Work Order
            </Button>
          )}
          {(order.status === 'released' || order.status === 'pending' || order.status === 'in_progress') && (
            <Button
              data-testid="cancel-work-order-btn"
              variant="destructive"
              className="w-full min-h-[44px]"
              onClick={() => onCancel(order.id)}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function WorkOrderTable() {
  const { workOrders, startWorkOrder, cancelWorkOrder } = useAppStore()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [closingWorkOrder, setClosingWorkOrder] = useState<WorkOrder | null>(null)

  const columns: ColumnDef<WorkOrder>[] = [
    {
      accessorKey: 'orderNumber',
      header: 'Order #',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm font-medium text-slate-200">{String(getValue())}</span>
      ),
    },
    {
      accessorKey: 'partName',
      header: 'Part',
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-slate-200">{row.original.partName}</div>
          <div className="text-xs text-slate-500 font-mono">{row.original.partNumber}</div>
        </div>
      ),
    },
    {
      accessorKey: 'machineName',
      header: 'Machine',
      cell: ({ getValue }) => (
        <span className="text-sm text-slate-300">{String(getValue())}</span>
      ),
    },
    {
      accessorKey: 'operatorName',
      header: 'Operator',
      cell: ({ getValue }) => (
        <span className="text-sm text-slate-300">{String(getValue())}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <StatusBadge status={getValue() as WorkOrderStatus} />,
    },
    {
      id: 'progress',
      header: 'Progress',
      cell: ({ row }) => (
        <ProgressBar actual={row.original.actualQty} target={row.original.targetQty} />
      ),
    },
    {
      accessorKey: 'startedAt',
      header: 'Started',
      cell: ({ getValue }) => (
        <span className="text-sm text-slate-400">{formatRelativeTime(getValue() as string | null)}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <RowActions
          row={row.original}
          onStart={startWorkOrder}
          onRequestClose={setClosingWorkOrder}
          onCancel={cancelWorkOrder}
        />
      ),
    },
  ]

  const table = useReactTable({
    data: workOrders,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const filtered = table.getFilteredRowModel().rows

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search orders, parts, operators…"
        value={globalFilter}
        onChange={e => setGlobalFilter(e.target.value)}
        className="max-w-xs"
      />

      {/* Mobile card layout (< md) */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <p className="text-center text-slate-500 py-12">No work orders found.</p>
        ) : (
          filtered.map(row => (
            <WorkOrderCard
              key={row.id}
              order={row.original}
              onStart={startWorkOrder}
              onRequestClose={setClosingWorkOrder}
              onCancel={cancelWorkOrder}
            />
          ))
        )}
      </div>

      {/* Desktop table layout (≥ md) */}
      <div className="hidden md:block rounded-lg border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="border-b border-slate-700 bg-slate-800/50">
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap"
                    onClick={header.column.getToggleSortingHandler()}
                    style={{ cursor: header.column.getCanSort() ? 'pointer' : 'default' }}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        header.column.getIsSorted() === 'asc' ? <ChevronUp className="h-3 w-3" /> :
                        header.column.getIsSorted() === 'desc' ? <ChevronDown className="h-3 w-3" /> :
                        <ChevronsUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500">
                  No work orders found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  data-testid="work-order-row"
                  className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors"
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">{filtered.length} orders</p>

      <CloseWorkOrderDialog
        workOrder={closingWorkOrder}
        onClose={() => setClosingWorkOrder(null)}
      />
    </div>
  )
}
