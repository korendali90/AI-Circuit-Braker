import clsx from 'clsx'

type Status = 'active' | 'paused' | 'killed' | 'blocked' | 'allowed' | 'redacted'

const styles: Record<Status, string> = {
  active:   'bg-green-100 text-green-800',
  paused:   'bg-yellow-100 text-yellow-800',
  killed:   'bg-red-100 text-red-800',
  blocked:  'bg-red-100 text-red-800',
  allowed:  'bg-green-100 text-green-800',
  redacted: 'bg-orange-100 text-orange-800',
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize', styles[status])}>
      {status}
    </span>
  )
}
