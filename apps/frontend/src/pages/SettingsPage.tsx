import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Plus, Trash2, Key } from 'lucide-react'
import { getProject, killProject, resumeProject } from '../lib/api/projects'
import { apiGet, apiPost, apiDelete } from '../lib/api/client'
import { StatusBadge } from '../components/ui/StatusBadge'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CopyButton } from '../components/ui/CopyButton'
import clsx from 'clsx'

type Tab = 'general' | 'api-keys' | 'danger'

interface ApiKey {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

interface ApiKeyCreated extends ApiKey {
  key: string
}

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className="ml-2 inline-flex items-center p-1 text-gray-400 hover:text-gray-700 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

export default function SettingsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('general')

  // New API key form state
  const [newKeyName, setNewKeyName] = useState('')
  const [showNewKeyForm, setShowNewKeyForm] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  // Confirm dialog
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    type: 'revoke' | 'kill' | 'resume'
    id?: string
    label?: string
  }>({ open: false, type: 'kill' })

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })

  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<ApiKey[]>({
    queryKey: ['api-keys', projectId],
    queryFn: () => apiGet<ApiKey[]>(`/projects/${projectId}/api-keys`),
    enabled: !!projectId && tab === 'api-keys',
  })

  const killMutation = useMutation({
    mutationFn: () => killProject(projectId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const resumeMutation = useMutation({
    mutationFn: () => resumeProject(projectId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const createKeyMutation = useMutation({
    mutationFn: (name: string) =>
      apiPost<ApiKeyCreated>(`/projects/${projectId}/api-keys`, { name }),
    onSuccess: (res) => {
      setCreatedKey(res.key)
      setNewKeyName('')
      setShowNewKeyForm(false)
      queryClient.invalidateQueries({ queryKey: ['api-keys', projectId] })
    },
  })

  const revokeKeyMutation = useMutation({
    mutationFn: (keyId: string) => apiDelete(`/projects/${projectId}/api-keys/${keyId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', projectId] }),
  })

  const handleConfirm = () => {
    if (confirmState.type === 'kill') killMutation.mutate()
    else if (confirmState.type === 'resume') resumeMutation.mutate()
    else if (confirmState.type === 'revoke' && confirmState.id) revokeKeyMutation.mutate(confirmState.id)
    setConfirmState({ open: false, type: 'kill' })
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'api-keys', label: 'API Keys' },
    { key: 'danger', label: 'Danger Zone' },
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Project configuration and management</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'pb-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                tab === t.key
                  ? 'text-purple-600 border-purple-600'
                  : 'text-gray-500 border-transparent hover:text-gray-900'
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* General Tab */}
      {tab === 'general' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Project Details</h2>
          </div>
          {projectLoading ? (
            <div className="p-6 animate-pulse space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg" />
              ))}
            </div>
          ) : project ? (
            <div className="p-6 space-y-5">
              {[
                { label: 'Project ID', value: project.id, copyable: true },
                { label: 'Name', value: project.name },
                { label: 'Environment', value: project.environment },
                { label: 'Upstream URL', value: project.upstream_base_url },
              ].map(({ label, value, copyable }) => (
                <div key={label}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    {label}
                  </label>
                  <div className="flex items-center px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                    <span className="text-sm text-gray-900 font-mono flex-1 truncate">{value}</span>
                    {copyable && <CopyButton text={value} />}
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <button className="px-4 py-2 text-sm font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">
                  Edit Project
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* API Keys Tab */}
      {tab === 'api-keys' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">API Keys</h2>
              <button
                onClick={() => {
                  setShowNewKeyForm((v) => !v)
                  setCreatedKey(null)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create API Key
              </button>
            </div>

            {/* New key form */}
            {showNewKeyForm && (
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Key name (e.g. Production App)"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => {
                      if (newKeyName.trim()) createKeyMutation.mutate(newKeyName.trim())
                    }}
                    disabled={!newKeyName.trim() || createKeyMutation.isPending}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {createKeyMutation.isPending ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            )}

            {/* Created key reveal */}
            {createdKey && (
              <div className="px-6 py-4 bg-green-50 border-b border-green-200">
                <p className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  API key created — copy it now!
                </p>
                <div className="flex items-center gap-3 bg-white border border-green-300 rounded-lg px-3 py-2.5">
                  <code className="text-sm font-mono text-green-700 flex-1 break-all">{createdKey}</code>
                  <CopyButton text={createdKey} />
                </div>
                <p className="text-xs text-green-700 mt-2">
                  This key will never be shown again. Copy it now and store it securely.
                </p>
              </div>
            )}

            {/* Keys table */}
            {keysLoading ? (
              <div className="p-6 text-center text-sm text-gray-400">Loading keys...</div>
            ) : apiKeys.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                No API keys yet. Create one to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Name', 'Key Prefix', 'Created', 'Last Used', ''].map((h) => (
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
                    {apiKeys.map((key) => (
                      <tr key={key.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{key.name}</td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600">{key.prefix}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {new Date(key.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {key.last_used_at
                            ? new Date(key.last_used_at).toLocaleDateString()
                            : 'Never'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() =>
                              setConfirmState({
                                open: true,
                                type: 'revoke',
                                id: key.id,
                                label: key.name,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Danger Zone Tab */}
      {tab === 'danger' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-red-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-red-100">
              <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
            </div>
            <div className="p-6 space-y-6">
              {/* Project status */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">Current status:</span>
                {project && <StatusBadge status={project.status} />}
              </div>

              {/* Kill project */}
              <div className="flex items-start justify-between gap-4 pb-6 border-b border-gray-100">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Kill Project</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Immediately block ALL requests to this project. You can resume at any time.
                  </p>
                </div>
                <button
                  onClick={() => setConfirmState({ open: true, type: 'kill' })}
                  disabled={project?.status === 'killed' || killMutation.isPending}
                  className="flex-shrink-0 px-4 py-2 text-sm font-medium text-red-700 border-2 border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Kill Project
                </button>
              </div>

              {/* Resume project */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Resume Project</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Re-enable request processing for this project.
                  </p>
                </div>
                <button
                  onClick={() => setConfirmState({ open: true, type: 'resume' })}
                  disabled={project?.status === 'active' || resumeMutation.isPending}
                  className="flex-shrink-0 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-300 rounded-lg hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Resume Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmState.open}
        title={
          confirmState.type === 'kill'
            ? 'Kill project?'
            : confirmState.type === 'resume'
            ? 'Resume project?'
            : `Revoke key "${confirmState.label}"?`
        }
        message={
          confirmState.type === 'kill'
            ? 'This will immediately block ALL requests to this project.'
            : confirmState.type === 'resume'
            ? 'This will re-enable request processing for this project.'
            : 'Any clients using this key will immediately lose access. This cannot be undone.'
        }
        confirmLabel={
          confirmState.type === 'kill'
            ? 'Kill project'
            : confirmState.type === 'resume'
            ? 'Resume project'
            : 'Revoke key'
        }
        dangerous={confirmState.type === 'kill' || confirmState.type === 'revoke'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState({ open: false, type: 'kill' })}
      />
    </div>
  )
}
