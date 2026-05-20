import { apiGet, apiPost, apiPatch, apiDelete } from './client'

export interface Project {
  id: string
  name: string
  description: string | null
  status: 'active' | 'paused' | 'killed'
  environment: 'production' | 'staging' | 'development'
  upstream_base_url: string
  created_at: string
}

export interface ProjectCreate {
  name: string
  description?: string
  upstream_base_url: string
  upstream_api_key: string
  environment: 'production' | 'staging' | 'development'
}

export interface ProjectUpdate {
  name?: string
  description?: string
  upstream_base_url?: string
  upstream_api_key?: string
  environment?: 'production' | 'staging' | 'development'
}

export function getProjects(): Promise<Project[]> {
  return apiGet<Project[]>('/projects')
}

export function getProject(id: string): Promise<Project> {
  return apiGet<Project>(`/projects/${id}`)
}

export function createProject(data: ProjectCreate): Promise<Project> {
  return apiPost<Project>('/projects', data)
}

export function updateProject(id: string, data: ProjectUpdate): Promise<Project> {
  return apiPatch<Project>(`/projects/${id}`, data)
}

export function deleteProject(id: string): Promise<void> {
  return apiDelete(`/projects/${id}`)
}

export function killProject(id: string): Promise<Project> {
  return apiPost<Project>(`/projects/${id}/kill`, {})
}

export function resumeProject(id: string): Promise<Project> {
  return apiPost<Project>(`/projects/${id}/resume`, {})
}
