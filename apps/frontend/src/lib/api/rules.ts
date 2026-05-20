import { apiGet, apiPost, apiPatch, apiDelete } from './client'

export type RuleType = 'pii_block' | 'rate_limit' | 'time_fence' | 'kill_switch' | 'action_whitelist'
export type RuleAction = 'block' | 'allow' | 'redact' | 'alert'

export interface Rule {
  id: string
  name: string
  rule_type: RuleType
  action: RuleAction
  priority: number
  enabled: boolean
  trigger_count: number
  config: Record<string, unknown>
  created_at: string
}

export interface RuleCreate {
  name: string
  rule_type: RuleType
  action: RuleAction
  priority?: number
  config?: Record<string, unknown>
}

export interface RuleUpdate {
  name?: string
  rule_type?: RuleType
  action?: RuleAction
  priority?: number
  enabled?: boolean
  config?: Record<string, unknown>
}

export function getRules(projectId: string): Promise<Rule[]> {
  return apiGet<Rule[]>(`/projects/${projectId}/rules`)
}

export function getRule(projectId: string, ruleId: string): Promise<Rule> {
  return apiGet<Rule>(`/projects/${projectId}/rules/${ruleId}`)
}

export function createRule(projectId: string, data: RuleCreate): Promise<Rule> {
  return apiPost<Rule>(`/projects/${projectId}/rules`, data)
}

export function updateRule(projectId: string, ruleId: string, data: RuleUpdate): Promise<Rule> {
  return apiPatch<Rule>(`/projects/${projectId}/rules/${ruleId}`, data)
}

export function deleteRule(projectId: string, ruleId: string): Promise<void> {
  return apiDelete(`/projects/${projectId}/rules/${ruleId}`)
}
