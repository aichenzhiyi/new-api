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
import type { Row } from '@tanstack/react-table'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { User } from '../../types'
import { DataTableRowActions } from '../data-table-row-actions'
import { UserOrganizationDialog } from '../user-organization-dialog'
import { UsersMutateDrawer } from '../users-mutate-drawer'
import { UsersProvider, useUsers } from '../users-provider'

const target: User = {
  id: 2,
  username: 'manager',
  display_name: 'Manager',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}
const department = { id: 1, code: 'SALES', name: 'Sales', enabled: true }
const projects = [
  { id: 1, code: 'P1', name: 'First project', enabled: true },
  { id: 2, code: 'P2', name: 'Second project', enabled: true },
  { id: 3, code: 'OLD', name: 'Disabled project', enabled: false },
]
const clients: QueryClient[] = []

function mockData() {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = []
    if (url === '/api/user/2/organization') {
      data = { department_id: 0, project_ids: [] }
    }
    if (url === '/api/departments') data = [department]
    if (url === '/api/projects') data = projects
    if (url === '/api/group/') data = ['default']
    if (url === '/api/authz/catalog') data = { resources: [], roles: [] }
    if (url === '/api/verify/methods') {
      data = {
        scope: 'admin.user.update',
        methods: [{ method: '2fa', available: true }],
        oauth_providers: [],
        password_encryption_enabled: false,
      }
    }
    return { data: { success: true, data } }
  })
}

function renderUserAccess(element: React.ReactNode, role = 100) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'operator', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <UsersProvider>{element}</UsersProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  clients.length = 0
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

it('requires a department, supports multiple projects and sends grants only after target-bound verification', async () => {
  mockData()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        scope: 'admin.user.update',
        proof_token: 'organization-proof',
        method: '2fa',
        expires_at: Math.floor(Date.now() / 1000) + 60,
      },
    },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const close = vi.fn()
  renderUserAccess(<UserOrganizationDialog user={target} onClose={close} />)
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('checkbox', { name: 'First project (P1)' })
  )
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Select an account department before assigning projects'
  )
  expect(
    screen.getByRole('checkbox', { name: 'Disabled project (OLD)' })
  ).toHaveAttribute('aria-disabled', 'true')
  await user.selectOptions(screen.getByLabelText('Account department'), '1')
  await user.click(
    screen.getByRole('checkbox', { name: 'Second project (P2)' })
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(put).not.toHaveBeenCalled()
  await user.type(
    await screen.findByLabelText('Authenticator code or backup code'),
    '123456'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/user/2/organization',
      { department_id: 1, project_ids: [1, 2] },
      expect.objectContaining({
        headers: { 'X-Security-Proof': 'organization-proof' },
        singleUseAuthorization: true,
      })
    )
  )
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
})

it('failed saves unlock the form and keep department and project selections', async () => {
  mockData()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        scope: 'admin.user.update',
        proof_token: 'organization-proof',
        method: '2fa',
        expires_at: Math.floor(Date.now() / 1000) + 60,
      },
    },
  })
  let finish: (value: unknown) => void = () => {}
  const put = vi.spyOn(api, 'put').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const close = vi.fn()
  renderUserAccess(<UserOrganizationDialog user={target} onClose={close} />)
  const user = userEvent.setup()
  await user.selectOptions(
    await screen.findByLabelText('Account department'),
    '1'
  )
  await user.click(screen.getByRole('checkbox', { name: 'First project (P1)' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await user.type(
    await screen.findByLabelText('Authenticator code or backup code'),
    '123456'
  )
  await user.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
  expect(
    screen.getByRole('checkbox', { name: 'First project (P1)' })
  ).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  finish({
    data: { success: false, message: 'Assigned project does not exist' },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(screen.getByLabelText('Account department')).toHaveValue('1')
  expect(
    screen.getByRole('checkbox', { name: 'First project (P1)' })
  ).toBeChecked()
  expect(close).not.toHaveBeenCalled()
})

it('cancelling verification keeps the selected assignment without writing it', async () => {
  mockData()
  const put = vi.spyOn(api, 'put')
  renderUserAccess(
    <UserOrganizationDialog user={target} onClose={() => undefined} />
  )
  const user = userEvent.setup()
  await user.selectOptions(
    await screen.findByLabelText('Account department'),
    '1'
  )
  await user.click(screen.getByRole('checkbox', { name: 'First project (P1)' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByLabelText('Authenticator code or backup code')
  await user.keyboard('{Escape}')
  expect(await screen.findByLabelText('Account department')).toHaveValue('1')
  expect(
    screen.getByRole('checkbox', { name: 'First project (P1)' })
  ).toBeChecked()
  expect(put).not.toHaveBeenCalled()
})

it('failed assignment loads offer retry and no editable grant controls', async () => {
  const get = mockData()
  get.mockRejectedValueOnce(new Error('network unavailable'))
  renderUserAccess(
    <UserOrganizationDialog user={target} onClose={() => undefined} />
  )
  const user = userEvent.setup()
  expect(
    await screen.findByText('Failed to load project assignments')
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByLabelText('Account department')).toBeEnabled()
})

it.each([1, 10, 100])(
  'only root sees the assignment action in user row menus (role=%s)',
  async (role) => {
    mockData()
    renderUserAccess(
      <DataTableRowActions row={{ original: target } as Row<User>} />,
      role
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    if (role === 100) {
      expect(
        await screen.findByRole('menuitem', { name: 'Manage project access' })
      ).toBeVisible()
    } else {
      expect(
        screen.queryByRole('menuitem', { name: 'Manage project access' })
      ).not.toBeInTheDocument()
    }
  }
)

function CreateAccountWorkflow() {
  const users = useUsers()
  if (users.open === 'organization' && users.currentRow) {
    return (
      <UserOrganizationDialog
        user={users.currentRow}
        onClose={() => users.setOpen(null)}
      />
    )
  }
  return <UsersMutateDrawer open onOpenChange={() => undefined} />
}

it('creating an ordinary account opens the department and project assignment step', async () => {
  mockData()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { id: 2 } } })
  renderUserAccess(<CreateAccountWorkflow />)
  const user = userEvent.setup()
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Username'), 'manager')
  await user.type(
    within(dialog).getByLabelText('Password'),
    'sufficiently long password'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  expect(await screen.findByLabelText('Account department')).toBeVisible()
})
