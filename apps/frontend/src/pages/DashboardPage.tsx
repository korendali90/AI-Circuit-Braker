import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { MetricCard } from '../components/ui/MetricCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { getProjects, killProject, resumeProject } from '../lib/api/projects'
import { Shield, Activity, Clock, FolderOpen, Zap } from 'lucide-react'

const chartData = [
  { day: 'Mon', requests: 240, blocked: 12 },
  { day: 'Tue', requests: 380, blocked: 8 },
  { day: 'Wed', requests: 290, blocked: 23 },
  { day: 'Thu', requests: 430, blocked: 5 },
  { day: 'Fri', requests: 520, blocked: 31 },
  { day: 'Sat', requests: 180, blocked: 4 },
  { day: 'Sun', requests: 150, blocked: 2 },
]

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  const [confirmState, setConfirmState] = useState<{
    open: boolean
    projectId: string
    action: 'kill' | 'resume'
  }>({ open: false, projectId: '', action: 'kill' })

  const killMutation = useMutation({
    mutationFn: (id: string) => killProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })

  const totalRequests = chartData.reduce((s, d) => s + d.requests, 0)
  const totalBlocked = chartData.reduce((s, d) => s + d.blocked, 0)
  const activeProjects = projects.filter((p) => p.status === 'active').length
  const avgLatency = 142

  const handleConfirm = () => {
    if (confirmState.action === 'kill') {
      killMutation.mutate(confirmState.projectId)
    } else {
      resumeMutation.mutate(confirmState.projectId)
    }
    setConfirmState({ open: false, projectId: '', action: 'kill' })
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your AI gateway activity</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Total Requests (7d)"
          value={totalRequests.toLocaleString()}
          delta={12}
        />
        <MetricCard
          label="Requests Blocked"
          value={totalBlocked.toLocaleString()}
          delta={-5}
        />
        <MetricCard
          label="Active Projects"
          value={isLoading ? '—' : activeProjects}
        />
        <MetricCard
          label="Avg Latency"
          value={`${avgLatency}ms`}
          delta={-8}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Request Traffic (7 days)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            />
            <Area
              type="monotone"
              dataKey="requests"
              stroke="#7c3aed"
              strokeWidth={2}
              fill="url(#colorRequests)"
              name="Requests"
            />
            <Area
              type="monotone"
              dataKey="blocked"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#colorBlocked)"
              name="Blocked"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Kill Switch Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Kill Switches</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Instantly block all requests to a project
          </p>
        </div>
        {isLoading ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            No projects yet. Create one to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{project.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{project.environment}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <StatusBadge status={project.status} />
                  {project.status === 'killed' ? (
                    <button
                      onClick={() =>
                        setConfirmState({ open: true, projectId: project.id, action: 'resume' })
                      }
                      className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200 transition-colors"
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setConfirmState({ open: true, projectId: project.id, action: 'kill' })
                      }
                      className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-colors"
                    >
                      Kill
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmState.open}
        title={confirmState.action === 'kill' ? 'Kill project?' : 'Resume project?'}
        message={
          confirmState.action === 'kill'
            ? 'This will immediately block ALL requests to this project. You can resume it at any time.'
            : 'This will resume accepting requests to this project.'
        }
        confirmLabel={confirmState.action === 'kill' ? 'Kill project' : 'Resume project'}
        dangerous={confirmState.action === 'kill'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState({ open: false, projectId: '', action: 'kill' })}
      />
    </div>
  )
}
