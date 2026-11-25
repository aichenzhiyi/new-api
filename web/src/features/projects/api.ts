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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { Project, ProjectPayload } from './types'

interface ProjectResponse<T> {
  success: boolean
  message: string
  data: T
}

export const projectsQueryKey = ['projects'] as const

export async function deleteProject(id: number): Promise<void> {
  const result = await api.delete<ProjectResponse<null>>(`/api/projects/${id}`)
  requireServerSuccess(result.data)
}

export async function getProjects(): Promise<Project[]> {
  const result = await api.get<ProjectResponse<Project[]>>('/api/projects')
  return requireServerSuccess(result.data).data
}

export async function saveProject(
  id: number | undefined,
  data: ProjectPayload
): Promise<Project> {
  const url = id ? `/api/projects/${id}` : '/api/projects'
  const result = id
    ? await api.put<ProjectResponse<Project>>(url, data)
    : await api.post<ProjectResponse<Project>>(url, data)
  return requireServerSuccess(result.data).data
}
