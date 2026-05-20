import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Plus, Trash2 } from 'lucide-react'
import { getRules, updateRule, deleteRule, RuleType } from '../lib/api/rules'
import { StatusBadge } from '../components/ui/StatusBadge'
import { EmptyState } from '../components/ui/EmptyState'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import clsx from 'clsx'

const ruleTypeBadge: Record<RuleType, string> = {
  pii_block: 'bg-red-100 text-red-700',
  rate_limit: 'bg-orange-100 text-orange-700',
  time_fence: 'bg-blue-100 text-blue-700',
  kill_switch: 'bg-purple-100 text-purple-700',
  action_whitelist: 'bg-gray-100 text-gray-700',
}

const ruleTypeLabel: Record<RuleType, string> = {
  pii_block: 'PII Block',
  rate_limit: 'Rate Limit',
  time_fence: 'Time Fence',
  kill_switch: 'Kill Switch',
  action_whitelist: 'Whitelist',
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded" />
        </td>
      ))}
    </tr>
  )
}

export default function RulesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; ruleId: string; ruleName: string }>({
    open: false,
    ruleId: '',
    ruleName: '',
  })

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rules', projectId],
    queryFn: () => getRules(projectId!),
    enabled: !!projectId,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      updateRule(projectId!, ruleId, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules', projectId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => deleteRule(projectId!, ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules', projectId] }),
  })

  const handleDeleteConfirm = () => {
    deleteMutation.mutate(confirmDelete.ruleId)
    setConfirmDelete({ open: false, ruleId: '', ruleName: '' })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rules</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage security and rate-limiting rules for this project
          </p>
        </div>
        <button
          onClick={() => navigate(`/projects/${projectId}/rules/new`)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Type', 'Action', 'Priority', 'Enabled', 'Triggers', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : rules.length === 0 ? (
          <div className="px-6">
            <EmptyState
              icon={Shield}
              title="No rules yet"
              description="Add rules to start blocking PII, rate limiting, or setting time fences on your AI traffic."
              action={{
                label: '+ Add Rule',
                onClick: () => navigate(`/projects/${projectId}/rules/new`),
              }}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Name', 'Type', 'Action', 'Priority', 'Enabled', 'Triggers', ''].map((h) => (
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
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{rule.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          ruleTypeBadge[rule.rule_type]
                        )}
                      >
                        {ruleTypeLabel[rule.rule_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={rule.action as any} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{rule.priority}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          toggleMutation.mutate({ ruleId: rule.id, enabled: !rule.enabled })
                        }
                        className={clsx(
                          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                          rule.enabled ? 'bg-purple-600' : 'bg-gray-300'
                        )}
                        role="switch"
                        aria-checked={rule.enabled}
                      >
                        <span
                          className={clsx(
                            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                            rule.enabled ? 'translate-x-4' : 'translate-x-0'
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {rule.trigger_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          setConfirmDelete({ open: true, ruleId: rule.id, ruleName: rule.name })
                        }
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDelete.open}
        title="Delete rule?"
        message={`Are you sure you want to delete "${confirmDelete.ruleName}"? This action cannot be undone.`}
        confirmLabel="Delete rule"
        dangerous
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete({ open: false, ruleId: '', ruleName: '' })}
      />
    </div>
  )
}
