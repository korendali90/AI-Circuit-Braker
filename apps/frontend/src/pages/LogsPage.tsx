import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clipboard, Check, Radio, ChevronDown, ChevronRight } from 'lucide-react'
import { getLogs, LogsParams } from '../lib/api/logs'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useLogStream } from '../hooks/useLogStream'
import clsx from 'clsx'

type TimeRange = '1h' | '24h' | '7d'
type ActionFilter = 'all' | 'blocked' | 'allowed' | 'redacted'

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function CopyTraceId({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false)
  const short = traceId.slice(0, 8)

  const copy = async () => {
    await navigator.clipboard.writeText(traceId).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        copy()
      }}
      className="inline-flex items-center gap-1 font-mono text-xs text-gray-500 hover:text-gray-900 transition-colors group"
      title={traceId}
    >
      {short}
      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? (
          <Check className="w-3 h-3 text-green-500" />
        ) : (
          <Clipboard className="w-3 h-3" />
        )}
      </span>
    </button>
  )
}

function statusColor(code?: number): string {
  if (!code) return 'text-gray-400'
  if (code >= 200 && code < 300) return 'text-green-600'
  return 'text-red-600'
}

export default function LogsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [live, setLive] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set())
  const prevLiveEntryCount = useRef(0)

  const { entries: liveEntries, status: streamStatus, connect, disconnect } = useLogStream(projectId!)

  const params: LogsParams = {
    time_range: timeRange,
    action: actionFilter,
    limit: 100,
  }

  const { data: historicLogs = [], isLoading } = useQuery({
    queryKey: ['logs', projectId, timeRange, actionFilter],
    queryFn: () => getLogs(projectId!, params),
    enabled: !!projectId && !live,
  })

  const logs = live ? liveEntries : historicLogs

  useEffect(() => {
    if (live) {
      connect()
    } else {
      disconnect()
    }
  }, [live])

  // Highlight new rows
  useEffect(() => {
    if (!live) return
    const newCount = liveEntries.length - prevLiveEntryCount.current
    if (newCount > 0) {
      const newIds = new Set(liveEntries.slice(0, newCount).map((e) => e.id))
      setNewRowIds(newIds)
      setTimeout(() => setNewRowIds(new Set()), 1500)
    }
    prevLiveEntryCount.current = liveEntries.length
  }, [liveEntries, live])

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const streamStatusColor = {
    disconnected: 'text-gray-400',
    connecting: 'text-yellow-500',
    connected: 'text-green-500',
    paused: 'text-orange-400',
  }[streamStatus]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Logs</h1>
        <p className="text-sm text-gray-500 mt-1">Request and response logs for this project</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Time range pills */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {(['1h', '24h', '7d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                timeRange === r
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              )}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Action filter */}
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="all">All actions</option>
          <option value="blocked">Blocked</option>
          <option value="allowed">Allowed</option>
          <option value="redacted">Redacted</option>
        </select>

        {/* Live toggle */}
        <button
          onClick={() => setLive((v) => !v)}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
            live
              ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          )}
        >
          <Radio className={clsx('w-3.5 h-3.5', live && 'animate-pulse')} />
          {live ? 'Live' : 'Go Live'}
          {live && (
            <span className={clsx('text-xs font-normal', streamStatusColor)}>
              ({streamStatus})
            </span>
          )}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading && !live ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            No log entries found for this time range and filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['', 'Timestamp', 'Trace ID', 'Model', 'Status', 'Latency', 'Action'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((entry) => {
                  const isExpanded = expandedRows.has(entry.id)
                  const isNew = newRowIds.has(entry.id)

                  return (
                    <>
                      <tr
                        key={entry.id}
                        onClick={() => toggleRow(entry.id)}
                        className={clsx(
                          'cursor-pointer transition-colors',
                          isNew ? 'bg-yellow-50' : 'hover:bg-gray-50'
                        )}
                      >
                        <td className="px-3 py-3 w-6">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {formatTime(entry.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <CopyTraceId traceId={entry.trace_id} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {entry.model || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-sm font-mono font-medium', statusColor(entry.response_status))}>
                            {entry.response_status ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {entry.response_latency_ms != null ? `${entry.response_latency_ms}ms` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {entry.action_taken ? (
                            <StatusBadge status={entry.action_taken as any} />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${entry.id}-expanded`} className="bg-gray-50">
                          <td colSpan={7} className="px-8 py-4">
                            <div className="space-y-2">
                              <div>
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                  Path
                                </span>
                                <p className="text-sm font-mono text-gray-700 mt-0.5">
                                  {entry.request_method} {entry.request_path}
                                </p>
                              </div>
                              {entry.request_body_preview && (
                                <div>
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    Request Body Preview
                                  </span>
                                  <pre className="mt-1 text-xs font-mono bg-gray-100 rounded-lg p-3 overflow-x-auto text-gray-700 max-h-40">
                                    {entry.request_body_preview}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
