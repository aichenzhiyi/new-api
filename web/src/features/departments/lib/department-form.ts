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

import type { Department } from '../types'

export const departmentFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
      'Department code must contain 1–32 letters, digits, hyphens or underscores and start with a letter or digit.'
    ),
  name: z
    .string()
    .trim()
    .min(1, 'Department name must contain 1–64 characters.')
    .refine(
      (value) => [...value].length <= 64,
      'Department name must contain 1–64 characters.'
    ),
  parent_id: z.number().int().nonnegative(),
  owner: z
    .string()
    .trim()
    .refine(
      (value) => [...value].length <= 64,
      'Department owner must not exceed 64 characters; description must not exceed 255 characters.'
    ),
  description: z
    .string()
    .trim()
    .refine(
      (value) => [...value].length <= 255,
      'Department owner must not exceed 64 characters; description must not exceed 255 characters.'
    ),
})

export type DepartmentFormValues = z.infer<typeof departmentFormSchema>

// Descendants cannot be selected as a parent. Backend validation remains
// authoritative, including when another administrator changes the tree.
export function getDepartmentParentOptions(
  departments: Department[],
  current?: Department
): Department[] {
  const blocked = new Set<number>(current ? [current.id] : [])
  const children = new Map<number, number[]>()
  for (const department of departments) {
    const ids = children.get(department.parent_id) ?? []
    ids.push(department.id)
    children.set(department.parent_id, ids)
  }
  const queue = [...blocked]
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]) ?? []) {
      if (!blocked.has(child)) {
        blocked.add(child)
        queue.push(child)
      }
    }
  }
  return departments.filter(
    (department) =>
      !blocked.has(department.id) &&
      (current?.enabled === false || department.enabled)
  )
}
