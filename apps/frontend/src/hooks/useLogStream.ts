import { useState, useEffect, useCallback, useRef } from 'react'

export interface LogEntry {
  id: string
  trace_id: string
  model?: string
  request_method: string
  request_path: string
  request_body_preview?: string
  response_status?: number
  response_latency_ms?: number
  action_taken?: string
  created_at: string
}

type StreamStatus = 'disconnected' | 'connecting' | 'connected' | 'paused'

export function useLogStream(projectId: string) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<StreamStatus>('disconnected')
  const esRef = useRef<EventSource | null>(null)
  const pausedRef = useRef(false)

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close()
    setStatus('connecting')
    const es = new EventSource(`/api/projects/${projectId}/logs/stream`)
    esRef.current = es
    es.onopen = () => setStatus('connected')
    es.onmessage = (e) => {
      if (pausedRef.current) return
      try {
        const entry = JSON.parse(e.data) as LogEntry
        setEntries((prev) => [entry, ...prev].slice(0, 500))
      } catch {
        // ignore malformed messages
      }
    }
    es.onerror = () => setStatus('disconnected')
  }, [projectId])

  const disconnect = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setStatus('disconnected')
  }, [])

  const pause = useCallback(() => {
    pausedRef.current = true
    setStatus('paused')
  }, [])

  const resume = useCallback(() => {
    pausedRef.current = false
    setStatus('connected')
  }, [])

  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  return { entries, status, connect, disconnect, pause, resume }
}
