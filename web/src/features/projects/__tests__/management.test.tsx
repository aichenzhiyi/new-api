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

import type { Department } from '@/features/departments/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { Projects } from '..'
import { ProjectFormDialog } from '../components/project-form-dialog'
import { projectFormSchema } from '../lib/project-form'
import type { Project } from '../types'

const department: Department = {
  id: 1,
  code: 'SALES',
  name: 'Sales',
  parent_id: 0,
  owner: '',
  description: '',
  enabled: true,
  created_time: 10,
  updated_time: 10,
}
const disabledDepartment: Department = {
  ...department,
  id: 2,
  code: 'OLD',
  name: 'Old department',
  enabled: false,
}
const project: Project = {
  id: 1,
  code: 'ASSISTANT',
  name: 'Assistant',
  department_id: 1,
  owner: 'Owner',
  description: '',
  enabled: true,
  created_time: new Date(2026, 10, 24, 9, 5, 7).getTime() / 1000,
  updated_time: new Date(2026, 10, 25, 16, 8, 3).getTime() / 1000,
}
const clients: QueryClient[] = []

function renderProjectPage(element = <Projects />, role = 100) {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'project-manager', role })
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
  useAuthStore.getState().auth.reset()
})

describe('project management', () => {
  it('project managers see their scoped list and cannot create projects or change departments', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/projects' ? [project] : [department],
      },
    }))
    renderProjectPage(<Projects />, 1)
    const user = userEvent.setup()
    expect(await screen.findByText('Assistant', { exact: true })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Create project' })
    ).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/projects/departments')
    expect(get).not.toHaveBeenCalledWith('/api/departments')
    await user.click(screen.getByRole('button', { name: 'Edit project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
    expect(
      within(dialog).getByLabelText('Cost-bearing department')
    ).toBeDisabled()
    expect(within(dialog).getByLabelText('Project name')).toBeEnabled()
  })
  it('requires an enabled department before creating projects', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    renderProjectPage()
    expect(
      await screen.findByText(
        'Create an enabled department before creating a project.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Create project' })
    ).toBeDisabled()
  })

  it('shows cost-bearing departments and timestamps and filters by project name', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/projects'
            ? [project, { ...project, id: 2, code: 'SEARCH', name: 'Search' }]
            : [department],
      },
    }))
    renderProjectPage()
    const user = userEvent.setup()
    expect(
      await screen.findByRole('columnheader', {
        name: 'Cost-bearing department',
      })
    ).toBeVisible()
    expect(
      (await screen.findAllByText('Sales (SALES)')).length
    ).toBeGreaterThan(0)
    expect(
      (await screen.findAllByText('2026-11-24 09:05:07')).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('2026-11-25 16:08:03').length).toBeGreaterThan(0)
    await user.type(
      screen.getByPlaceholderText('Search projects'),
      'Assistant{Enter}'
    )
    await waitFor(() =>
      expect(
        screen.queryByText('Search', { exact: true })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByText('Assistant', { exact: true })).toBeVisible()
  })

  it('requires a department, excludes disabled choices and creates a normalized project', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/projects' ? [] : [department, disabledDepartment],
      },
    }))
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: project } })
    renderProjectPage()
    const user = userEvent.setup()
    await screen.findByText('No projects found')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create project' })
    await user.type(within(dialog).getByLabelText('Project code'), 'assistant')
    await user.type(
      within(dialog).getByLabelText('Project name'),
      ' Assistant '
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(post).not.toHaveBeenCalled()
    const select = within(dialog).getByLabelText('Cost-bearing department')
    expect(
      within(select).queryByRole('option', { name: 'Old department (OLD)' })
    ).not.toBeInTheDocument()
    await user.selectOptions(select, '1')
    await user.type(within(dialog).getByLabelText('Project owner'), ' Contact ')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/projects', {
        code: 'ASSISTANT',
        name: 'Assistant',
        department_id: 1,
        owner: 'Contact',
        description: '',
        enabled: true,
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('retains edits and the current disabled department when the server rejects a save', async () => {
    const close = vi.fn()
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'Project code already exists' },
    })
    renderProjectPage(
      <ProjectFormDialog
        project={{ ...project, enabled: false, department_id: 2 }}
        departments={[department, disabledDepartment]}
        onClose={close}
      />
    )
    const user = userEvent.setup()
    expect(screen.getByLabelText('Cost-bearing department')).toHaveValue('2')
    await user.clear(screen.getByLabelText('Project owner'))
    await user.selectOptions(
      screen.getByLabelText('Cost-bearing department'),
      '1'
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/projects/1',
        expect.objectContaining({ department_id: 1, owner: '', enabled: false })
      )
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    )
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Project owner')).toHaveValue('')
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeVisible()
  })

  it('locks editable fields and cancellation while saving and closes only on success', async () => {
    let finish: (value: unknown) => void = () => {}
    vi.spyOn(api, 'put').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const close = vi.fn()
    renderProjectPage(
      <ProjectFormDialog
        project={project}
        departments={[department]}
        onClose={close}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByRole('button', { name: 'Saving...' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Project name')).toBeDisabled()
    expect(close).not.toHaveBeenCalled()
    finish({ data: { success: true, data: project } })
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('confirms status changes and refreshes the project while retaining its department', async () => {
    let stored = project
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/projects' ? [stored] : [department],
      },
    }))
    const put = vi.spyOn(api, 'put').mockImplementation(async () => {
      stored = { ...project, enabled: false }
      return { data: { success: true, data: stored } }
    })
    renderProjectPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Disable' }))
    expect(put).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/The project record will be retained/)
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/projects/1',
        expect.objectContaining({ enabled: false, department_id: 1 })
      )
    )
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeEnabled()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })

  it('retains the confirmation after a failed enable rather than reporting success', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/projects'
            ? [{ ...project, enabled: false }]
            : [department],
      },
    }))
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: false,
        message: 'Enable the cost-bearing department and its ancestors first',
      },
    })
    renderProjectPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Enable' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(put).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Enable' })
      ).toBeEnabled()
    )
    expect(dialog).toBeVisible()
  })

  it('makes a failed department load retryable and blocks editing incomplete project data', async () => {
    let departmentFailed = true
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/departments' && departmentFailed) {
        throw new Error('network unavailable')
      }
      return {
        data: {
          success: true,
          data: url === '/api/projects' ? [project] : [department],
        },
      }
    })
    renderProjectPage()
    const user = userEvent.setup()
    expect(await screen.findByText('Failed to load departments')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Create project' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Edit project' })
    ).not.toBeInTheDocument()
    departmentFailed = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Assistant', { exact: true })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  })

  it('deletes a project only after confirmation, locks pending actions and refreshes the list', async () => {
    let projects = [project]
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/projects' ? projects : [department],
      },
    }))
    let finish: (response: unknown) => void = () => {}
    const remove = vi.spyOn(api, 'delete').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    renderProjectPage()
    const user = userEvent.setup()
    const row = await screen.findByRole('row', {
      name: /^ASSISTANT Assistant /,
    })
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete project' })
    )
    let confirmation = await screen.findByRole('alertdialog')
    expect(
      within(confirmation).getByText(/This action cannot be undone/)
    ).toBeVisible()
    expect(remove).not.toHaveBeenCalled()
    await user.click(
      within(confirmation).getByRole('button', { name: 'Cancel' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(remove).not.toHaveBeenCalled()
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete project' })
    )
    confirmation = await screen.findByRole('alertdialog')
    await user.click(
      within(confirmation).getByRole('button', { name: 'Delete' })
    )
    await waitFor(() => expect(remove).toHaveBeenCalledWith('/api/projects/1'))
    expect(
      within(confirmation).getByRole('button', { name: 'Delete' })
    ).toBeDisabled()
    expect(
      within(confirmation).getByRole('button', { name: 'Cancel' })
    ).toBeDisabled()
    projects = []
    finish({ data: { success: true } })
    expect(await screen.findByText('No projects found')).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })

  it('retains the project after a rejected deletion and lets the user retry', async () => {
    let projects = [project]
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/projects' ? projects : [department],
      },
    }))
    const remove = vi
      .spyOn(api, 'delete')
      .mockResolvedValueOnce({
        data: { success: false, message: 'Project does not exist' },
      })
      .mockImplementationOnce(async () => {
        projects = []
        return { data: { success: true } }
      })
    renderProjectPage()
    const user = userEvent.setup()
    const row = await screen.findByRole('row', {
      name: /^ASSISTANT Assistant /,
    })
    await user.click(within(row).getByRole('button', { name: 'Actions' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete project' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    await user.click(
      within(confirmation).getByRole('button', { name: 'Delete' })
    )
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        within(confirmation).getByRole('button', { name: 'Delete' })
      ).toBeEnabled()
    )
    expect(confirmation).toBeVisible()
    expect(
      within(row).getByText('Assistant', { exact: true })
    ).toBeInTheDocument()
    await user.click(
      within(confirmation).getByRole('button', { name: 'Delete' })
    )
    expect(await screen.findByText('No projects found')).toBeVisible()
  })

  it('validates bounded Unicode fields and requires a positive department identity', () => {
    const payload = {
      code: 'P_1',
      name: '项'.repeat(64),
      owner: '人'.repeat(64),
      description: '说'.repeat(255),
      department_id: 1,
    }
    expect(projectFormSchema.safeParse(payload).success).toBe(true)
    for (const invalid of [
      { code: 'BAD/CODE' },
      { name: ' ' },
      { name: '项'.repeat(65) },
      { owner: '人'.repeat(65) },
      { description: '说'.repeat(256) },
      { department_id: 0 },
      { department_id: -1 },
    ]) {
      expect(
        projectFormSchema.safeParse({ ...payload, ...invalid }).success
      ).toBe(false)
    }
  })
})
