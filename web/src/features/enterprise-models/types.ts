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
export interface SupplierAccount {
  id: number
  code: string
  name: string
  vendor_id: number
  account_ref: string
  owner: string
  currency:
    | 'CNY'
    | 'USD'
    | 'EUR'
    | 'JPY'
    | 'GBP'
    | 'HKD'
    | 'SGD'
    | 'AUD'
    | 'CAD'
    | 'KRW'
    | 'TWD'
    | 'INR'
  contract_ref: string
  description: string
  enabled: boolean
  channel_ids: number[]
  created_time: number
  updated_time: number
}

export interface EnterpriseChannel {
  id: number
  name: string
  status: number
  supplier_account_id: number
  account_name: string
  currency: string
  account_enabled: boolean
}

export interface EnterpriseProfile {
  model_id: number
  model_version: string
  capabilities: string
  context_limit: number
  scenarios: string
  owner: string
  deployment_type: 'cloud' | 'local'
  shared: boolean
  project_ids: number[]
  created_time: number
  updated_time: number
}

export interface EnterpriseModel extends EnterpriseProfile {
  model_name: string
  description: string
  tags: string
  vendor_id: number
  vendor_name: string
  status: number
  name_rule: number
  configured: boolean
  channels: EnterpriseChannel[]
}

export interface ProcurementOptions {
  vendors: { id: number; name: string }[]
  channels: EnterpriseChannel[]
}
