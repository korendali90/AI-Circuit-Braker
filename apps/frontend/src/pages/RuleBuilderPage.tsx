import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createRule } from '../lib/api/rules'
import { ArrowLeft, AlertTriangle } from 'lucide-react'

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  rule_type: z.enum(['pii_block', 'rate_limit', 'time_fence', 'kill_switch', 'action_whitelist']),
  action: z.enum(['block', 'allow', 'redact', 'alert']),
  priority: z.coerce.number().min(1, 'Priority must be at least 1').max(1000, 'Priority must be at most 1000').default(100),
  config: z.record(z.any()).default({}),
})

type FormData = z.infer<typeof schema>

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function RuleBuilderPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
    setError,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      rule_type: 'pii_block',
      action: 'block',
      priority: 100,
      config: {},
    },
  })

  const ruleType = watch('rule_type')

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      createRule(projectId!, {
        name: data.name,
        rule_type: data.rule_type,
        action: data.action,
        priority: data.priority,
        config: data.config,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules', projectId] })
      navigate(`/projects/${projectId}/rules`)
    },
    onError: (err: any) => {
      setError('root', { message: err.message || 'Failed to create rule' })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/projects/${projectId}/rules`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Rules
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Rule</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure a security or rate-limiting rule for this project.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
        {errors.root && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errors.root.message}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Rule Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Rule Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              aria-label="Rule Name"
              type="text"
              {...register('name')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="e.g. Block SSN numbers"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          {/* Rule Type */}
          <div>
            <label htmlFor="rule_type" className="block text-sm font-medium text-gray-700 mb-1.5">
              Rule Type <span className="text-red-500">*</span>
            </label>
            <select
              id="rule_type"
              aria-label="Rule Type"
              {...register('rule_type')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition bg-white"
            >
              <option value="pii_block">PII Block</option>
              <option value="rate_limit">Rate Limit</option>
              <option value="time_fence">Time Fence</option>
              <option value="kill_switch">Kill Switch</option>
              <option value="action_whitelist">Action Whitelist</option>
            </select>
            {errors.rule_type && (
              <p className="mt-1 text-xs text-red-600">{errors.rule_type.message}</p>
            )}
          </div>

          {/* Action */}
          <div>
            <label htmlFor="action" className="block text-sm font-medium text-gray-700 mb-1.5">
              Action <span className="text-red-500">*</span>
            </label>
            <select
              id="action"
              aria-label="Action"
              {...register('action')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition bg-white"
            >
              <option value="block">Block</option>
              <option value="allow">Allow</option>
              <option value="redact">Redact</option>
              <option value="alert">Alert</option>
            </select>
            {errors.action && (
              <p className="mt-1 text-xs text-red-600">{errors.action.message}</p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1.5">
              Priority
            </label>
            <input
              id="priority"
              type="number"
              min={1}
              max={1000}
              {...register('priority')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="100"
            />
            <p className="mt-1 text-xs text-gray-500">
              Lower number = higher priority. Range: 1–1000.
            </p>
            {errors.priority && (
              <p className="mt-1 text-xs text-red-600">{errors.priority.message}</p>
            )}
          </div>

          {/* Dynamic Config Section */}
          {ruleType === 'pii_block' && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">PII Block Configuration</h3>
              <div>
                <label
                  htmlFor="pii_patterns"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Custom Patterns
                </label>
                <textarea
                  id="pii_patterns"
                  aria-label="Custom patterns"
                  rows={4}
                  onChange={(e) => {
                    const lines = e.target.value
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                    setValue('config', { ...getValues('config'), patterns: lines })
                  }}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition resize-none"
                  placeholder="One regex per line — leave blank for defaults (SSN, credit cards, emails, etc.)"
                />
              </div>
            </div>
          )}

          {ruleType === 'rate_limit' && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Rate Limit Configuration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="rate_max_calls"
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    Max Calls
                  </label>
                  <input
                    id="rate_max_calls"
                    aria-label="Max calls"
                    type="number"
                    min={1}
                    onChange={(e) =>
                      setValue('config', {
                        ...getValues('config'),
                        max_calls: parseInt(e.target.value, 10) || undefined,
                      })
                    }
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                    placeholder="100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="rate_window"
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    Window (seconds)
                  </label>
                  <input
                    id="rate_window"
                    aria-label="Window (seconds)"
                    type="number"
                    min={1}
                    onChange={(e) =>
                      setValue('config', {
                        ...getValues('config'),
                        window_seconds: parseInt(e.target.value, 10) || undefined,
                      })
                    }
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                    placeholder="60"
                  />
                </div>
              </div>
            </div>
          )}

          {ruleType === 'time_fence' && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Time Fence Configuration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="time_start"
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    Start Hour UTC
                  </label>
                  <input
                    id="time_start"
                    aria-label="Start hour UTC"
                    type="number"
                    min={0}
                    max={23}
                    onChange={(e) =>
                      setValue('config', {
                        ...getValues('config'),
                        start_hour: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                    placeholder="9"
                  />
                </div>
                <div>
                  <label
                    htmlFor="time_end"
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    End Hour UTC
                  </label>
                  <input
                    id="time_end"
                    aria-label="End hour UTC"
                    type="number"
                    min={0}
                    max={23}
                    onChange={(e) =>
                      setValue('config', {
                        ...getValues('config'),
                        end_hour: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                    placeholder="17"
                  />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Allowed Days</p>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <label key={day} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        defaultChecked
                        onChange={(e) => {
                          const current: string[] = (getValues('config').days as string[]) || DAYS
                          const updated = e.target.checked
                            ? [...current, day]
                            : current.filter((d) => d !== day)
                          setValue('config', { ...getValues('config'), days: updated })
                        }}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm text-gray-700">{day}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {ruleType === 'kill_switch' && (
            <div className="border border-red-200 rounded-lg p-4 bg-red-50 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">Kill Switch Warning</p>
                <p className="text-sm text-red-700 mt-1">
                  Enabling this rule immediately blocks ALL requests to this project. Use with
                  caution. You can disable the rule to resume traffic at any time.
                </p>
              </div>
            </div>
          )}

          {ruleType === 'action_whitelist' && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Action Whitelist Configuration</h3>
              <div>
                <label
                  htmlFor="whitelist_tools"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Allowed Tools / Actions
                </label>
                <textarea
                  id="whitelist_tools"
                  aria-label="Allowed tools"
                  rows={4}
                  onChange={(e) => {
                    const lines = e.target.value
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                    setValue('config', { ...getValues('config'), allowed_tools: lines })
                  }}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition resize-none"
                  placeholder="One tool name per line, e.g.:&#10;web_search&#10;code_interpreter"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? 'Saving...' : 'Save Rule'}
            </button>
            <Link
              to={`/projects/${projectId}/rules`}
              className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
