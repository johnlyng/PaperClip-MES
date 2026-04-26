import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-slate-700 text-slate-200',
        draft: 'bg-slate-800 text-slate-400 border border-slate-600',
        released: 'bg-amber-900/60 text-amber-300 border border-amber-700',
        pending: 'bg-slate-600 text-slate-300',
        in_progress: 'bg-blue-900/60 text-blue-300 border border-blue-700',
        completed: 'bg-green-900/60 text-green-300 border border-green-700',
        cancelled: 'bg-red-900/40 text-red-400 border border-red-800',
        running: 'bg-green-900/60 text-green-300 border border-green-700',
        idle: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
        fault: 'bg-red-900/60 text-red-300 border border-red-700',
        offline: 'bg-slate-800 text-slate-500 border border-slate-700',
        info: 'bg-blue-900/40 text-blue-300',
        warning: 'bg-yellow-900/40 text-yellow-300',
        error: 'bg-red-900/40 text-red-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
