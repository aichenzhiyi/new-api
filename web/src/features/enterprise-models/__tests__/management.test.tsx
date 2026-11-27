/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { EnterpriseModels } from '../components/enterprise-models'
import { SupplierAccountDialog } from '../components/supplier-account-dialog'
import { SupplierAccounts } from '../components/supplier-accounts'
import { enterpriseProfileSchema, supplierAccountSchema } from '../lib/forms'
import type { EnterpriseModel, SupplierAccount } from '../types'

const account: SupplierAccount = {
  id: 1,
  code: 'QWEN',
  name: 'Corporate purchase',
  vendor_id: 1,
  account_ref: 'buyer-123',
  currency: 'CNY',
  owner: 'Buyer',
  contract_ref: '',
  description: '',
  enabled: true,
  channel_ids: [1],
  created_time: 1,
  updated_time: 2,
}
const model: EnterpriseModel = {
  model_id: 1,
  model_name: 'qwen-plus',
  description: 'Text model',
  tags: '',
  vendor_id: 1,
  vendor_name: 'Alibaba',
  status: 1,
  name_rule: 0,
  configured: true,
  model_version: '2026',
  capabilities: 'text',
  context_limit: 131072,
  scenarios: 'Assistant',
  owner: 'Owner',
  deployment_type: 'cloud',
  shared: false,
  project_ids: [1],
  created_time: 1,
  updated_time: 2,
  channels: [
    {
      id: 1,
      name: 'Primary route',
      status: 1,
      supplier_account_id: 1,
      account_name: 'Corporate purchase',
      currency: 'CNY',
      account_enabled: true,
    },
  ],
}
const options = {
  vendors: [{ id: 1, name: 'Alibaba' }],
  channels: [
    {
      id: 1,
      name: 'Primary route',
      status: 1,
      supplier_account_id: 1,
      account_name: 'Corporate purchase',
      currency: 'CNY',
      account_enabled: true,
    },
  ],
}
const clients: QueryClient[] = []

function renderFeature(element: React.ReactElement, role = 100) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'operator', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>
  )
}

afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

describe('enterprise procurement and model information', () => {
  it('global administrators can load the ledger and open account creation', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/enterprise/accounts' ? [account] : options,
      },
    }))
    renderFeature(<SupplierAccounts />)
    expect(await screen.findByText('Corporate purchase')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Create procurement account' })
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Procurement account code')).toHaveValue('')
  })
  it('project catalog reads the scoped endpoint and provides no global edit controls', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [{ ...model, project_ids: [] }] },
    })
    renderFeature(<EnterpriseModels projectId={7} />, 1)
    expect(await screen.findByText('qwen-plus')).toBeInTheDocument()
    expect(screen.getByText(/Primary route/)).toHaveTextContent(
      'Corporate purchase CNY'
    )
    expect(get).toHaveBeenCalledWith('/api/projects/7/models')
    expect(
      screen.queryByRole('button', { name: 'Enterprise model information' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Visible projects' })
    ).not.toBeInTheDocument()
  })

  it('ordinary users do not load procurement account data', () => {
    const get = vi.spyOn(api, 'get')
    renderFeature(<SupplierAccounts />, 1)
    expect(
      screen.getByText(
        'Only global administrators can manage shared model configuration'
      )
    ).toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })

  it('a failed project catalog request offers retry and an empty result explains configuration', async () => {
    vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { success: true, data: [] } })
    renderFeature(<EnterpriseModels projectId={7} />, 1)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No enterprise models')).toBeInTheDocument()
  })

  it('account save failures preserve input and keep the dialog open', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: options },
    })
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: false,
        message: 'Procurement account code already exists',
      },
    })
    const close = vi.fn()
    renderFeature(<SupplierAccountDialog account={account} onClose={close} />)
    const user = userEvent.setup()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    )
    await user.clear(screen.getByLabelText('Procurement account name'))
    await user.type(
      screen.getByLabelText('Procurement account name'),
      'Updated purchase'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    )
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Procurement account name')).toHaveValue(
      'Updated purchase'
    )
  })

  it('validates procurement identity and context limits before submitting', () => {
    expect(
      supplierAccountSchema.safeParse({ ...account, code: 'bad code' }).success
    ).toBe(false)
    expect(
      supplierAccountSchema.safeParse({ ...account, vendor_id: 0 }).success
    ).toBe(false)
    expect(
      enterpriseProfileSchema.safeParse({ ...model, context_limit: -1 }).success
    ).toBe(false)
    expect(
      enterpriseProfileSchema.safeParse({ ...model, context_limit: 0 }).success
    ).toBe(true)
  })
})
