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
import { z } from 'zod'

export const procurementCurrencies = [
  'CNY',
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'HKD',
  'SGD',
  'AUD',
  'CAD',
  'KRW',
  'TWD',
  'INR',
] as const

export const supplierAccountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, 'Invalid parameters'),
  name: z
    .string()
    .trim()
    .min(1, 'Invalid parameters')
    .max(128, 'Procurement account fields exceed their length limits'),
  vendor_id: z.number().int().positive('Vendor does not exist'),
  account_ref: z
    .string()
    .trim()
    .max(128, 'Procurement account fields exceed their length limits'),
  owner: z
    .string()
    .trim()
    .max(64, 'Procurement account fields exceed their length limits'),
  currency: z.enum(procurementCurrencies),
  contract_ref: z
    .string()
    .trim()
    .max(128, 'Procurement account fields exceed their length limits'),
  description: z
    .string()
    .trim()
    .max(255, 'Procurement account fields exceed their length limits'),
  enabled: z.boolean(),
  channel_ids: z.array(z.number().int().positive()).max(1000),
})
export type SupplierAccountValues = z.infer<typeof supplierAccountSchema>

export const enterpriseProfileSchema = z.object({
  model_version: z
    .string()
    .trim()
    .max(128, 'Enterprise model fields exceed their length limits'),
  capabilities: z
    .string()
    .trim()
    .max(255, 'Enterprise model fields exceed their length limits'),
  context_limit: z
    .number()
    .int()
    .min(0, 'Invalid parameters')
    .max(1000000000, 'Invalid parameters'),
  scenarios: z
    .string()
    .trim()
    .max(1024, 'Enterprise model fields exceed their length limits'),
  owner: z
    .string()
    .trim()
    .max(64, 'Enterprise model fields exceed their length limits'),
  deployment_type: z.enum(['cloud', 'local']),
  shared: z.boolean(),
  project_ids: z.array(z.number().int().positive()).max(1000),
})
export type EnterpriseProfileValues = z.infer<typeof enterpriseProfileSchema>

export const emptyEnterpriseProfile: EnterpriseProfileValues = {
  model_version: '',
  capabilities: '',
  context_limit: 0,
  scenarios: '',
  owner: '',
  deployment_type: 'cloud',
  shared: false,
  project_ids: [],
}
