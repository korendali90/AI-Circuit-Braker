import { apiPost } from './client'

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>('/auth/login', { email, password })
  localStorage.setItem('cb_token', res.access_token)
  return res
}

export async function signup(data: {
  email: string
  password: string
  name: string
  org_name: string
}): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>('/auth/signup', data)
  localStorage.setItem('cb_token', res.access_token)
  return res
}

export function logout() {
  localStorage.removeItem('cb_token')
  window.location.href = '/login'
}
