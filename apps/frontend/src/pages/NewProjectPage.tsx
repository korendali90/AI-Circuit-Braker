import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createProject, ProjectCreate } from '../lib/api/projects'

type FormData = {
  name: string
  description: string
  upstream_base_url: string
  upstream_api_key: string
  environment: 'production' | 'staging' | 'development'
}

export default function NewProjectPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({
    defaultValues: {
      environment: 'development',
    },
  })

  const mutation = useMutation({
    mutationFn: (data: ProjectCreate) => createProject(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/projects/${res.id}/rules`)
    },
    onError: (err: any) => {
      setError('root', { message: err.message || 'Failed to create project' })
    },
  })

  const onSubmit = (data: FormData) => {
    const payload: ProjectCreate = {
      name: data.name,
      description: data.description || undefined,
      upstream_base_url: data.upstream_base_url,
      upstream_api_key: data.upstream_api_key,
      environment: data.environment,
    }
    mutation.mutate(payload)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Project</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create a new AI gateway project to proxy and protect your API calls.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
        {errors.root && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errors.root.message}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Project Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              {...register('name', { required: 'Project name is required' })}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="My AI Project"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              id="description"
              rows={3}
              {...register('description')}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition resize-none"
              placeholder="Optional description of this project"
            />
          </div>

          {/* Upstream Base URL */}
          <div>
            <label
              htmlFor="upstream_base_url"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Upstream Base URL <span className="text-red-500">*</span>
            </label>
            <input
              id="upstream_base_url"
              type="url"
              {...register('upstream_base_url', {
                required: 'Upstream base URL is required',
              })}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="https://api.openai.com/v1"
            />
            {errors.upstream_base_url && (
              <p className="mt-1 text-xs text-red-600">{errors.upstream_base_url.message}</p>
            )}
          </div>

          {/* Upstream API Key */}
          <div>
            <label
              htmlFor="upstream_api_key"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Upstream API Key <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="upstream_api_key"
                type={showKey ? 'text' : 'password'}
                {...register('upstream_api_key', { required: 'API key is required' })}
                className="w-full px-3 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.upstream_api_key && (
              <p className="mt-1 text-xs text-red-600">{errors.upstream_api_key.message}</p>
            )}
            <p className="mt-1.5 text-xs text-gray-500">
              Your OpenAI/Anthropic API key — stored encrypted at rest.
            </p>
          </div>

          {/* Environment */}
          <div>
            <label
              htmlFor="environment"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Environment <span className="text-red-500">*</span>
            </label>
            <select
              id="environment"
              {...register('environment', { required: true })}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition bg-white"
            >
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? 'Creating...' : 'Create Project'}
            </button>
            <Link
              to="/projects"
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
