import { apiGet } from './client'

export interface LogEntry {
  id: string
  trace_id: string
  model: string
  request_method: string
  request_path: string
  request_body_preview?: string
  response_status: number
  response_latency_ms: number
  action_taken: 'blocked' | 'allowed' | 'redacted'
  created_at: string
}

export interface LogsParams {
  time_range?: '1h' | '24h' | '7d'
  action?: 'blocked' | 'allowed' | 'redacted' | 'all'
  limit?: number
  offset?: number
}

export function getLogs(projectId: string, params: LogsParams = {}): Promise<LogEntry[]> {
  const query = new URLSearchParams()
  if (params.time_range) query.set('time_range', params.time_range)
  if (params.action && params.action !== 'all') query.set('action', params.action)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))
  const qs = query.toString()
  return apiGet<LogEntry[]>(`/projects/${projectId}/logs${qs ? `?${qs}` : ''}`)
}

export function createLogStream(projectId: string): EventSource {
  return new EventSource(`/api/projects/${projectId}/logs/stream`)
}
