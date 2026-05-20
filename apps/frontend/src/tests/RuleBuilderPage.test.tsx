import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RuleBuilderPage from '../pages/RuleBuilderPage'

vi.mock('../lib/api/rules', () => ({
  createRule: vi.fn().mockResolvedValue({ id: 'rule-123', name: 'Test' }),
}))

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/proj-1/rules/new']}>
        <Routes>
          <Route path="/projects/:id/rules/new" element={ui} />
          <Route path="/projects/:id/rules" element={<div>Rules</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RuleBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders required form fields', () => {
    wrap(<RuleBuilderPage />)
    expect(screen.getByLabelText(/rule name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/rule type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/action/i)).toBeInTheDocument()
  })

  it('shows pii config fields when pii_block selected', async () => {
    wrap(<RuleBuilderPage />)
    await userEvent.selectOptions(screen.getByLabelText(/rule type/i), 'pii_block')
    expect(screen.getByLabelText(/custom patterns/i)).toBeInTheDocument()
  })

  it('shows rate limit fields when rate_limit selected', async () => {
    wrap(<RuleBuilderPage />)
    await userEvent.selectOptions(screen.getByLabelText(/rule type/i), 'rate_limit')
    expect(screen.getByLabelText(/max calls/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/window/i)).toBeInTheDocument()
  })

  it('shows validation error when name empty', async () => {
    wrap(<RuleBuilderPage />)
    fireEvent.click(screen.getByRole('button', { name: /save rule/i }))
    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument())
  })

  it('submits form with valid data', async () => {
    const { createRule } = await import('../lib/api/rules')
    wrap(<RuleBuilderPage />)
    await userEvent.type(screen.getByLabelText(/rule name/i), 'Block SSN')
    await userEvent.selectOptions(screen.getByLabelText(/rule type/i), 'pii_block')
    await userEvent.selectOptions(screen.getByLabelText(/action/i), 'block')
    fireEvent.click(screen.getByRole('button', { name: /save rule/i }))
    await waitFor(() =>
      expect(createRule).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ name: 'Block SSN' })
      )
    )
  })
})
