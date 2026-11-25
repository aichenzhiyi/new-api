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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { Department } from '@/features/departments/types'
import { handleServerError } from '@/lib/handle-server-error'

import { projectsQueryKey, saveProject } from '../api'
import { projectFormSchema, type ProjectFormValues } from '../lib/project-form'
import type { Project } from '../types'

interface ProjectFormDialogProps {
  project?: Project
  departments: Department[]
  onClose: () => void
  canChangeDepartment?: boolean
}

export function ProjectFormDialog(props: ProjectFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      code: props.project?.code ?? '',
      name: props.project?.name ?? '',
      department_id: props.project?.department_id ?? 0,
      owner: props.project?.owner ?? '',
      description: props.project?.description ?? '',
    },
  })
  const mutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      saveProject(props.project?.id, {
        ...values,
        code: values.code.toUpperCase(),
        enabled: props.project?.enabled ?? true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      toast.success(t('Project saved'))
      props.onClose()
    },
    onError: (error) => handleServerError(error),
  })
  const departmentOptions = props.departments.filter(
    (department) =>
      department.enabled || department.id === props.project?.department_id
  )
  const fields = [
    { name: 'code', label: t('Project code'), maxLength: 32 },
    { name: 'name', label: t('Project name'), maxLength: 64 },
    { name: 'owner', label: t('Project owner'), maxLength: 64 },
  ] as const

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={props.project ? t('Edit project') : t('Create project')}
      description={t(
        'Choose one cost-bearing department, including for cross-department projects. The business owner is contact information.'
      )}
      showCloseButton={!mutation.isPending}
      footer={
        <>
          <Button
            variant='outline'
            disabled={mutation.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='project-form'
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id='project-form'
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <fieldset disabled={mutation.isPending} className='space-y-4'>
            {fields.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={item.maxLength}
                        autoComplete='off'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name='department_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cost-bearing department')}</FormLabel>
                  <FormControl>
                    <NativeSelect
                      disabled={props.canChangeDepartment === false}
                      ref={field.ref}
                      name={field.name}
                      value={String(field.value)}
                      onBlur={field.onBlur}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                      className='w-full'
                    >
                      <NativeSelectOption value='0'>
                        {t('Select a cost-bearing department')}
                      </NativeSelectOption>
                      {departmentOptions.map((department) => (
                        <NativeSelectOption
                          key={department.id}
                          value={String(department.id)}
                        >
                          {department.name} ({department.code})
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Description')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={255} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>
        </form>
      </Form>
    </Dialog>
  )
}
