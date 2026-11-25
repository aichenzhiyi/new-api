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

export const projectFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
      'Project code must contain 1–32 letters, digits, hyphens or underscores and start with a letter or digit.'
    ),
  name: z
    .string()
    .trim()
    .min(1, 'Project name must contain 1–64 characters.')
    .refine(
      (value) => [...value].length <= 64,
      'Project name must contain 1–64 characters.'
    ),
  department_id: z.number().int().positive('Select a cost-bearing department'),
  owner: z
    .string()
    .trim()
    .refine(
      (value) => [...value].length <= 64,
      'Project owner must not exceed 64 characters; description must not exceed 255 characters.'
    ),
  description: z
    .string()
    .trim()
    .refine(
      (value) => [...value].length <= 255,
      'Project owner must not exceed 64 characters; description must not exceed 255 characters.'
    ),
})

export type ProjectFormValues = z.infer<typeof projectFormSchema>
