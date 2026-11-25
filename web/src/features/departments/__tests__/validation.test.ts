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
import { describe, expect, it } from 'vitest'

import {
  departmentFormSchema,
  getDepartmentParentOptions,
} from '../lib/department-form'
import type { Department } from '../types'

const payload = {
  code: 'SALES',
  name: 'Sales',
  parent_id: 0,
  owner: '',
  description: '',
}

describe('department validation', () => {
  it('accepts bounded Unicode text and rejects empty, oversized or invalid fields', () => {
    expect(
      departmentFormSchema.safeParse({
        ...payload,
        name: '部'.repeat(64),
        description: '说'.repeat(255),
      }).success
    ).toBe(true)
    for (const invalid of [
      { name: ' ' },
      { name: '部'.repeat(65) },
      { code: 'BAD/CODE' },
      { code: 'A'.repeat(33) },
      { parent_id: -1 },
      { owner: '人'.repeat(65) },
      { description: '说'.repeat(256) },
    ]) {
      expect(
        departmentFormSchema.safeParse({ ...payload, ...invalid }).success
      ).toBe(false)
    }
  })

  it('offers other enabled branches as parents and excludes the edited department and its descendants', () => {
    const root: Department = {
      ...payload,
      id: 1,
      enabled: true,
      created_time: 1,
      updated_time: 1,
    }
    const child = { ...root, id: 2, parent_id: 1 }
    const grandchild = { ...root, id: 3, parent_id: 2 }
    const sibling = { ...root, id: 4 }
    const disabled = { ...root, id: 5, enabled: false }
    const tree = [root, child, grandchild, sibling, disabled]
    expect(
      getDepartmentParentOptions(tree, root).map((item) => item.id)
    ).toEqual([4])
    expect(getDepartmentParentOptions(tree).map((item) => item.id)).toEqual([
      1, 2, 3, 4,
    ])
    expect(getDepartmentParentOptions([], root)).toEqual([])
  })
})
