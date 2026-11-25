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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Departments } from '..'
import { DepartmentFormDialog } from '../components/department-form-dialog'
import type { Department } from '../types'

const parent: Department = {
  id: 1,
  code: 'SALES',
  name: 'Sales',
  parent_id: 0,
  owner: 'Owner',
  description: '',
  enabled: true,
  created_time: 10,
  updated_time: 10,
}
const child: Department = {
  ...parent,
  id: 2,
  code: 'SUPPORT',
  name: 'Support',
  parent_id: 1,
}
const clients: QueryClient[] = []

function renderDepartmentPage(element = <Departments />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>
  )
}

afterEach(() => {
  for (const client of clients) client.clear()
  clients.length = 0
  localStorage.clear()
})

describe('department management', () => {
  it('displays creation and update timestamps in YYYY-MM-DD HH:mm:ss format', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            ...parent,
            created_time: new Date(2026, 10, 24, 9, 5, 7).getTime() / 1000,
            updated_time: new Date(2026, 10, 25, 16, 8, 3).getTime() / 1000,
          },
        ],
      },
    })
    renderDepartmentPage()
    expect(
      await screen.findByRole('columnheader', { name: 'Created At' })
    ).toBeVisible()
    expect(
      screen.getByRole('columnheader', { name: 'Updated At' })
    ).toBeVisible()
    expect(await screen.findByText('2026-11-24 09:05:07')).toBeVisible()
    expect(screen.getByText('2026-11-25 16:08:03')).toBeVisible()
  })

  it('filters departments by name and restores the list after clearing the search', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [parent, child] },
    })
    renderDepartmentPage()
    const user = userEvent.setup()
    expect(await screen.findByText('Sales', { exact: true })).toBeVisible()
    const search = screen.getByPlaceholderText('Search departments')
    await user.type(search, 'Support')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(
        screen.queryByText('Sales', { exact: true })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByText('Support', { exact: true })).toBeVisible()
    await user.clear(search)
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Sales', { exact: true })).toBeVisible()
  })

  it('creates a root department from the empty state and normalizes editable values', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: parent } })
    renderDepartmentPage()
    const user = userEvent.setup()
    await screen.findByText('No departments found')
    await user.click(screen.getByRole('button', { name: 'Create department' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Create department',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(
      await within(dialog).findByText(
        'Department name must contain 1–64 characters.'
      )
    ).toBeVisible()
    expect(post).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText('Department code'), 'sales')
    await user.type(within(dialog).getByLabelText('Department name'), ' Sales ')
    expect(
      within(dialog).queryByLabelText('Cost center')
    ).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/departments',
        expect.objectContaining({
          code: 'SALES',
          name: 'Sales',
          parent_id: 0,
          enabled: true,
        })
      )
    )
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('version')
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('cost_center')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('retains edits after a rejected save and excludes descendants from the parent selector', async () => {
    const close = vi.fn()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: false,
        message: 'Department code already exists',
      },
    })
    renderDepartmentPage(
      <DepartmentFormDialog
        department={parent}
        departments={[parent, child]}
        onClose={close}
      />
    )
    const user = userEvent.setup()
    const selector = screen.getByLabelText('Parent department')
    expect(within(selector).getAllByRole('option')).toHaveLength(1)
    await user.clear(screen.getByLabelText('Department owner'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/departments/1',
        expect.objectContaining({ owner: '' })
      )
    )
    expect(put.mock.calls[0]?.[1]).not.toHaveProperty('version')
    expect(put.mock.calls[0]?.[1]).not.toHaveProperty('cost_center')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    )
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Department owner')).toHaveValue('')
    expect(
      screen.getByRole('dialog', { name: 'Edit department' })
    ).toBeVisible()
  })

  it('locks the form while saving and closes only after the request succeeds', async () => {
    let finish: (response: unknown) => void = () => {}
    vi.spyOn(api, 'put').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const close = vi.fn()
    renderDepartmentPage(
      <DepartmentFormDialog
        department={parent}
        departments={[parent]}
        onClose={close}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByRole('button', { name: 'Saving...' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Department name')).toBeDisabled()
    expect(close).not.toHaveBeenCalled()
    finish({ data: { success: true, data: parent } })
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('requires confirmation before disabling and preserves existing department information', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [parent] },
    })
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: true,
        data: { ...parent, enabled: false },
      },
    })
    renderDepartmentPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Disable' }))
    expect(put).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog')
    expect(
      within(confirmation).getByText(/Historical records will be retained/)
    ).toBeVisible()
    await user.click(
      within(confirmation).getByRole('button', { name: 'Disable' })
    )
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/departments/1',
        expect.objectContaining({
          code: parent.code,
          parent_id: 0,
          enabled: false,
        })
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })

  it('deletes a leaf only after confirmation, locks pending actions and refreshes the list', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [parent] },
    })
    let finish: (response: unknown) => void = () => {}
    const remove = vi.spyOn(api, 'delete').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    renderDepartmentPage()
    const user = userEvent.setup()
    const row = await screen.findByRole('row', { name: /^SALES Sales / })
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete department' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    expect(remove).not.toHaveBeenCalled()
    expect(
      within(confirmation).getByText(/This action cannot be undone/)
    ).toBeVisible()
    await user.click(
      within(confirmation).getByRole('button', { name: 'Delete' })
    )
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('/api/departments/1')
    )
    expect(
      within(confirmation).getByRole('button', { name: 'Delete' })
    ).toBeDisabled()
    expect(
      within(confirmation).getByRole('button', { name: 'Cancel' })
    ).toBeDisabled()
    get.mockResolvedValue({ data: { success: true, data: [] } })
    finish({ data: { success: true } })
    expect(await screen.findByText('No departments found')).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })

  it.each([true, false])(
    'blocks deletion and disabling when a child has enabled=%s even when filtered out',
    async (enabled) => {
      vi.spyOn(api, 'get').mockResolvedValue({
        data: { success: true, data: [parent, { ...child, enabled }] },
      })
      const remove = vi.spyOn(api, 'delete')
      const put = vi.spyOn(api, 'put')
      renderDepartmentPage()
      const user = userEvent.setup()
      await screen.findByText('Sales', { exact: true })
      await user.type(
        screen.getByPlaceholderText('Search departments'),
        'Sales{Enter}'
      )
      await waitFor(() =>
        expect(
          screen.queryByText('Support', { exact: true })
        ).not.toBeInTheDocument()
      )
      const row = screen.getByRole('row', { name: /^SALES Sales / })
      await user.click(within(row).getByRole('button', { name: 'Actions' }))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Delete department' })
      )
      let confirmation = await screen.findByRole('alertdialog')
      expect(
        within(confirmation).getByText(
          'Cannot delete a department with child departments'
        )
      ).toBeVisible()
      expect(
        within(confirmation).getByRole('button', { name: 'Delete' })
      ).toBeDisabled()
      await user.click(
        within(confirmation).getByRole('button', { name: 'Cancel' })
      )
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      )
      await user.click(within(row).getByRole('button', { name: 'Disable' }))
      confirmation = await screen.findByRole('alertdialog')
      expect(
        within(confirmation).getByText(
          'Cannot disable a department with child departments'
        )
      ).toBeVisible()
      expect(
        within(confirmation).getByRole('button', { name: 'Disable' })
      ).toBeDisabled()
      expect(remove).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
    }
  )

  it('retains the department and confirmation when the server rejects deletion after a child was added', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [parent] },
    })
    const remove = vi.spyOn(api, 'delete').mockResolvedValue({
      data: {
        success: false,
        message: 'Cannot delete a department with child departments',
      },
    })
    renderDepartmentPage()
    const user = userEvent.setup()
    const row = await screen.findByRole('row', { name: /^SALES Sales / })
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete department' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    await user.click(
      within(confirmation).getByRole('button', { name: 'Cancel' })
    )
    expect(remove).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete department' })
    )
    const retryConfirmation = await screen.findByRole('alertdialog')
    await user.click(
      within(retryConfirmation).getByRole('button', { name: 'Delete' })
    )
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        within(retryConfirmation).getByRole('button', { name: 'Delete' })
      ).toBeEnabled()
    )
    expect(retryConfirmation).toBeVisible()
    expect(within(row).getByText('Sales', { exact: true })).toBeInTheDocument()
  })

  it('shows a retryable load failure rather than an empty department list', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue({ data: { success: true, data: [] } })
    renderDepartmentPage()
    const user = userEvent.setup()
    expect(await screen.findByText('Failed to load departments')).toBeVisible()
    expect(screen.queryByText('No departments found')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create department' })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No departments found')).toBeVisible()
    expect(get).toHaveBeenCalledTimes(2)
  })
})
