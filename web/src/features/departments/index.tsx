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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteDepartment,
  departmentsQueryKey,
  getDepartments,
  saveDepartment,
} from './api'
import { DepartmentFormDialog } from './components/department-form-dialog'
import { DepartmentsTable } from './components/departments-table'
import type { Department } from './types'

const emptyDepartments: Department[] = []

export function Departments() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: departmentsQueryKey,
    queryFn: getDepartments,
  })
  const [editor, setEditor] = useState<Department | 'new' | null>(null)
  const [toggle, setToggle] = useState<Department | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)
  const closeEditor = useCallback(() => setEditor(null), [])
  const openEditor = useCallback(
    (department: Department) => setEditor(department),
    []
  )
  const openToggle = useCallback(
    (department: Department) => setToggle(department),
    []
  )
  const openDelete = useCallback(
    (department: Department) => setDeleting(department),
    []
  )
  const deletion = useMutation({
    mutationFn: (department: Department) => deleteDepartment(department.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey })
      toast.success(t('Department deleted'))
      setDeleting(null)
    },
    onError: (error) => handleServerError(error),
  })
  const hasToggleChildren =
    toggle !== null &&
    (query.data ?? []).some((department) => department.parent_id === toggle.id)
  const hasDeleteChildren =
    deleting !== null &&
    (query.data ?? []).some(
      (department) => department.parent_id === deleting.id
    )
  let toggleDescription = ''
  if (toggle) {
    toggleDescription = t(
      'Change the status of department “{{name}}”? Historical records will be retained.',
      { name: toggle.name }
    )
  }
  if (toggle?.enabled && hasToggleChildren) {
    toggleDescription = t('Cannot disable a department with child departments')
  }
  const mutation = useMutation({
    mutationFn: (department: Department) =>
      saveDepartment(department.id, {
        ...department,
        enabled: !department.enabled,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey })
      toast.success(t('Department saved'))
      setToggle(null)
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Department Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            onClick={() => setEditor('new')}
            disabled={query.isPending || query.isError}
          >
            {t('Create department')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          {query.isError ? (
            <ErrorState
              title={t('Failed to load departments')}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <DepartmentsTable
              departments={query.data ?? emptyDepartments}
              isLoading={query.isPending}
              isFetching={query.isFetching}
              onEdit={openEditor}
              onToggle={openToggle}
              onDelete={openDelete}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {editor !== null && (
        <DepartmentFormDialog
          department={editor === 'new' ? undefined : editor}
          departments={query.data ?? emptyDepartments}
          onClose={closeEditor}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) setDeleting(null)
        }}
        title={t('Delete department')}
        desc={
          hasDeleteChildren
            ? t('Cannot delete a department with child departments')
            : t('Delete department “{{name}}”? This action cannot be undone.', {
                name: deleting?.name ?? '',
              })
        }
        confirmText={t('Delete')}
        destructive
        disabled={hasDeleteChildren}
        isLoading={deletion.isPending}
        handleConfirm={() => {
          if (deleting && !hasDeleteChildren) deletion.mutate(deleting)
        }}
      />
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setToggle(null)
        }}
        title={
          toggle?.enabled ? t('Disable department') : t('Enable department')
        }
        desc={toggleDescription}
        confirmText={toggle?.enabled ? t('Disable') : t('Enable')}
        disabled={Boolean(toggle?.enabled && hasToggleChildren)}
        isLoading={mutation.isPending}
        handleConfirm={() => {
          if (toggle && !(toggle.enabled && hasToggleChildren)) {
            mutation.mutate(toggle)
          }
        }}
      />
    </>
  )
}
