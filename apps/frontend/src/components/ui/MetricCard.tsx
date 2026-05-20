import { TrendingUp, TrendingDown } from 'lucide-react'
import clsx from 'clsx'

interface MetricCardProps {
  label: string
  value: string | number
  delta?: number
  deltaLabel?: string
}

export function MetricCard({ label, value, delta, deltaLabel }: MetricCardProps) {
  const isPositive = delta !== undefined && delta >= 0
  const isNegative = delta !== undefined && delta < 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      {delta !== undefined && (
        <div className="mt-2 flex items-center gap-1">
          {isPositive ? (
            <TrendingUp className="h-4 w-4 text-green-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-500" />
          )}
          <span
            className={clsx(
              'text-sm font-medium',
              isPositive && 'text-green-600',
              isNegative && 'text-red-600'
            )}
          >
            {isPositive ? '+' : ''}{delta}{deltaLabel ? ` ${deltaLabel}` : '%'}
          </span>
          <span className="text-sm text-gray-400">vs last period</span>
        </div>
      )}
    </div>
  )
}
