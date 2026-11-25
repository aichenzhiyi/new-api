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
import { departmentsQueryKey, getDepartments } from '@/features/departments/api'
import type { Department } from '@/features/departments/types'
import { handleServerError } from '@/lib/handle-server-error'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteProject,
  getProjects,
  getProjectDepartments,
  projectsQueryKey,
  saveProject,
} from './api'
import { ProjectFormDialog } from './components/project-form-dialog'
import { ProjectsTable } from './components/projects-table'
import type { Project } from './types'

const emptyProjects: Project[] = []
const emptyDepartments: Department[] = []

export function Projects() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const isGlobalAdmin = user?.role === ROLE.SUPER_ADMIN
  const projects = useQuery({
    queryKey: [...projectsQueryKey, user?.id],
    queryFn: getProjects,
  })
  const departments = useQuery({
    queryKey: [...departmentsQueryKey, 'project-access', user?.id],
    queryFn: isGlobalAdmin ? getDepartments : getProjectDepartments,
  })
  const [editor, setEditor] = useState<Project | 'new' | null>(null)
  const [toggle, setToggle] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const closeEditor = useCallback(() => setEditor(null), [])
  const openEditor = useCallback((project: Project) => setEditor(project), [])
  const openToggle = useCallback((project: Project) => setToggle(project), [])
  const openDelete = useCallback((project: Project) => setDeleting(project), [])
  const deletion = useMutation({
    mutationFn: (project: Project) => deleteProject(project.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      toast.success(t('Project deleted'))
      setDeleting(null)
    },
    onError: (error) => handleServerError(error),
  })
  const failed = projects.isError || departments.isError
  const pending = projects.isPending || departments.isPending
  const canCreate = (departments.data ?? emptyDepartments).some(
    (department) => department.enabled
  )
  const mutation = useMutation({
    mutationFn: (project: Project) =>
      saveProject(project.id, { ...project, enabled: !project.enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      toast.success(t('Project saved'))
      setToggle(null)
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Project Management')}
        </SectionPageLayout.Title>
        {isGlobalAdmin && (
          <SectionPageLayout.Actions>
            <Button
              onClick={() => setEditor('new')}
              disabled={pending || failed || !canCreate}
            >
              {t('Create project')}
            </Button>
          </SectionPageLayout.Actions>
        )}
        <SectionPageLayout.Content>
          {failed ? (
            <ErrorState
              title={
                projects.isError
                  ? t('Failed to load projects')
                  : t('Failed to load departments')
              }
              onRetry={() => {
                void projects.refetch()
                void departments.refetch()
              }}
            />
          ) : (
            <ProjectsTable
              projects={projects.data ?? emptyProjects}
              departments={departments.data ?? emptyDepartments}
              isLoading={pending}
              isFetching={projects.isFetching || departments.isFetching}
              onEdit={openEditor}
              onToggle={openToggle}
              onDelete={openDelete}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {editor !== null && (
        <ProjectFormDialog
          project={editor === 'new' ? undefined : editor}
          departments={departments.data ?? emptyDepartments}
          canChangeDepartment={isGlobalAdmin}
          onClose={closeEditor}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) setDeleting(null)
        }}
        title={t('Delete project')}
        desc={t('Delete project “{{name}}”? This action cannot be undone.', {
          name: deleting?.name ?? '',
        })}
        confirmText={t('Delete')}
        destructive
        isLoading={deletion.isPending}
        handleConfirm={() => {
          if (deleting) deletion.mutate(deleting)
        }}
      />
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setToggle(null)
        }}
        title={toggle?.enabled ? t('Disable project') : t('Enable project')}
        desc={t(
          'Change the status of project “{{name}}”? The project record will be retained.',
          { name: toggle?.name ?? '' }
        )}
        confirmText={toggle?.enabled ? t('Disable') : t('Enable')}
        isLoading={mutation.isPending}
        handleConfirm={() => {
          if (toggle) mutation.mutate(toggle)
        }}
      />
    </>
  )
}
