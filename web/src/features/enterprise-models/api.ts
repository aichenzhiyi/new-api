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

import type {
  EnterpriseModel,
  EnterpriseProfile,
  ProcurementOptions,
  SupplierAccount,
} from './types'

interface Response<T> {
  success: boolean
  message?: string
  data: T
}
export const enterpriseQueryKey = ['enterprise-models'] as const

export async function getSupplierAccounts(): Promise<SupplierAccount[]> {
  const result = await api.get<Response<SupplierAccount[]>>(
    '/api/enterprise/accounts'
  )
  return requireServerSuccess(result.data).data
}

export async function getProcurementOptions(): Promise<ProcurementOptions> {
  const result = await api.get<Response<ProcurementOptions>>(
    '/api/enterprise/options'
  )
  return requireServerSuccess(result.data).data
}

export async function saveSupplierAccount(
  id: number | undefined,
  values: Omit<SupplierAccount, 'id' | 'created_time' | 'updated_time'>
): Promise<void> {
  const result = id
    ? await api.put<Response<null>>(`/api/enterprise/accounts/${id}`, values)
    : await api.post<Response<null>>('/api/enterprise/accounts', values)
  requireServerSuccess(result.data)
}

export async function deleteSupplierAccount(id: number): Promise<void> {
  const result = await api.delete<Response<null>>(
    `/api/enterprise/accounts/${id}`
  )
  requireServerSuccess(result.data)
}

export async function getEnterpriseModels(
  projectId?: number
): Promise<EnterpriseModel[]> {
  const path = projectId
    ? `/api/projects/${projectId}/models`
    : '/api/enterprise/models'
  const result = await api.get<Response<EnterpriseModel[]>>(path)
  return requireServerSuccess(result.data).data
}

export async function saveEnterpriseModel(
  id: number,
  values: Omit<EnterpriseProfile, 'model_id' | 'created_time' | 'updated_time'>
): Promise<void> {
  const result = await api.put<Response<null>>(
    `/api/enterprise/models/${id}`,
    values
  )
  requireServerSuccess(result.data)
}

export async function deleteEnterpriseModel(id: number): Promise<void> {
  const result = await api.delete<Response<null>>(
    `/api/enterprise/models/${id}`
  )
  requireServerSuccess(result.data)
}
