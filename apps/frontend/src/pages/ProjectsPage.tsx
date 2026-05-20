import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { FolderOpen, Plus, ExternalLink } from 'lucide-react'
import { getProjects } from '../lib/api/projects'
import { StatusBadge } from '../components/ui/StatusBadge'
import { EmptyState } from '../components/ui/EmptyState'

const envColors: Record<string, string> = {
  production: 'bg-red-100 text-red-700',
  staging: 'bg-yellow-100 text-yellow-700',
  development: 'bg-blue-100 text-blue-700',
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
      <div className="flex gap-2 mb-6">
        <div className="h-5 bg-gray-100 rounded-full w-16" />
        <div className="h-5 bg-gray-100 rounded-full w-20" />
      </div>
      <div className="h-8 bg-gray-100 rounded w-full" />
    </div>
  )
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your AI gateway projects</p>
        </div>
        <Link
          to="/projects/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create your first project to start proxying and protecting your AI API calls."
          action={{ label: '+ New Project', onClick: () => navigate('/projects/new') }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <div className="flex items-start justify-between mb-1">
                <h2 className="text-base font-semibold text-gray-900 leading-snug">
                  {project.name}
                </h2>
              </div>
              {project.description && (
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">{project.description}</p>
              )}
              <div className="flex items-center gap-2 mb-4 mt-auto">
                <StatusBadge status={project.status} />
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                    envColors[project.environment] || 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {project.environment}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Created {new Date(project.created_at).toLocaleDateString()}
              </p>
              <Link
                to={`/projects/${project.id}/rules`}
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
