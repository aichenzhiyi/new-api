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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getDepartments } from '@/features/departments/api'
import type { Department } from '@/features/departments/types'
import { getProjects, projectsQueryKey } from '@/features/projects/api'
import type { Project } from '@/features/projects/types'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { saveUserOrganization } from '../api'
import type { User } from '../types'
import { useUsers } from './users-provider'

interface Assignment {
  department_id: number
  project_ids: number[]
}
interface OrganizationData {
  assignment: Assignment
  departments: Department[]
  projects: Project[]
}

export function UserOrganizationDialog(props: {
  user: User
  onClose: () => void
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user-organization', props.user.id],
    queryFn: async (): Promise<OrganizationData> => {
      const [response, departments, projects] = await Promise.all([
        api.get<{ success: boolean; data: Assignment }>(
          `/api/user/${props.user.id}/organization`
        ),
        getDepartments(),
        getProjects(),
      ])
      return {
        assignment: requireServerSuccess(response.data).data,
        departments,
        projects,
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  })
  if (query.isError) {
    return (
      <Dialog
        open
        title={t('Manage project access')}
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
      >
        <ErrorState
          title={t('Failed to load project assignments')}
          onRetry={() => void query.refetch()}
        />
      </Dialog>
    )
  }
  if (!query.data || query.isPending) {
    return (
      <Dialog
        open
        title={t('Manage project access')}
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
      >
        {t('Loading...')}
      </Dialog>
    )
  }
  return (
    <OrganizationEditor
      key={props.user.id}
      user={props.user}
      data={query.data}
      onClose={props.onClose}
    />
  )
}

function OrganizationEditor(props: {
  user: User
  data: OrganizationData
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { requestVerification, verificationActive, triggerRefresh } = useUsers()
  const [assignment, setAssignment] = useState(props.data.assignment)
  const mutation = useMutation({
    mutationFn: async () => {
      const proof = await requestVerification({
        scope: 'admin.user.update',
        context: { user_id: props.user.id },
        title: t('Manage project access'),
        description: t(
          'Confirm your identity before changing the account {{username}}.',
          { username: props.user.username }
        ),
      })
      if (!proof) return false
      requireServerSuccess(
        await saveUserOrganization(props.user.id, assignment, proof.proof_token)
      )
      return true
    },
    onSuccess: async (saved) => {
      if (!saved) return
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['user-organization', props.user.id],
        }),
        queryClient.invalidateQueries({ queryKey: projectsQueryKey }),
      ])
      toast.success(
        t('Project assignments saved. The account must sign in again.')
      )
      triggerRefresh()
      props.onClose()
    },
    onError: (error) => handleServerError(error),
  })
  const invalid =
    assignment.project_ids.length > 0 && assignment.department_id === 0
  return (
    <Dialog
      open={!verificationActive}
      title={t('Manage project access')}
      description={t(
        'Assign a department and projects to {{username}}. All linked accounts have equal project permissions; changes require the account to sign in again.',
        { username: props.user.username }
      )}
      showCloseButton={!mutation.isPending}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      footer={
        <>
          <Button
            variant='outline'
            onClick={props.onClose}
            disabled={mutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || invalid}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      <fieldset disabled={mutation.isPending} className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='account-department'>{t('Account department')}</Label>
          <NativeSelect
            id='account-department'
            value={String(assignment.department_id)}
            className='w-full'
            onChange={(event) =>
              setAssignment((current) => ({
                ...current,
                department_id: Number(event.target.value),
              }))
            }
          >
            <NativeSelectOption value='0'>{t('Unassigned')}</NativeSelectOption>
            {props.data.departments
              .filter(
                (item) =>
                  item.enabled ||
                  item.id === props.data.assignment.department_id
              )
              .map((item) => (
                <NativeSelectOption key={item.id} value={String(item.id)}>
                  {item.name} ({item.code})
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </div>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Managed projects')}</p>
          {props.data.projects.map((project) => (
            <Label key={project.id} className='flex items-center gap-2'>
              <Checkbox
                checked={assignment.project_ids.includes(project.id)}
                disabled={
                  mutation.isPending ||
                  (!project.enabled &&
                    !props.data.assignment.project_ids.includes(project.id))
                }
                onCheckedChange={(checked) =>
                  setAssignment((current) => ({
                    ...current,
                    project_ids: checked
                      ? [...current.project_ids, project.id]
                      : current.project_ids.filter((id) => id !== project.id),
                  }))
                }
              />
              {project.name} ({project.code})
            </Label>
          ))}
          {props.data.projects.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t('No projects found')}
            </p>
          )}
          {invalid && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Select an account department before assigning projects')}
            </p>
          )}
        </div>
      </fieldset>
    </Dialog>
  )
}
