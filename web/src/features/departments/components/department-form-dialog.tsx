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
import { handleServerError } from '@/lib/handle-server-error'

import { departmentsQueryKey, saveDepartment } from '../api'
import {
  departmentFormSchema,
  getDepartmentParentOptions,
  type DepartmentFormValues,
} from '../lib/department-form'
import type { Department } from '../types'

interface DepartmentFormDialogProps {
  department?: Department
  departments: Department[]
  onClose: () => void
}

export function DepartmentFormDialog(props: DepartmentFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentFormSchema),
    defaultValues: {
      code: props.department?.code ?? '',
      name: props.department?.name ?? '',
      parent_id: props.department?.parent_id ?? 0,
      owner: props.department?.owner ?? '',
      description: props.department?.description ?? '',
    },
  })
  const mutation = useMutation({
    mutationFn: (values: DepartmentFormValues) =>
      saveDepartment(props.department?.id, {
        ...values,
        code: values.code.toUpperCase(),
        enabled: props.department?.enabled ?? true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey })
      toast.success(t('Department saved'))
      props.onClose()
    },
    onError: (error) => handleServerError(error),
  })
  const parentOptions = getDepartmentParentOptions(
    props.departments,
    props.department
  )
  const fields = [
    { name: 'code', label: t('Department code'), maxLength: 32 },
    { name: 'name', label: t('Department name'), maxLength: 64 },
    { name: 'owner', label: t('Department owner'), maxLength: 64 },
  ] as const

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={props.department ? t('Edit department') : t('Create department')}
      description={t(
        'Departments are retained when disabled to preserve historical ownership.'
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
            form='department-form'
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id='department-form'
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
              name='parent_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Parent department')}</FormLabel>
                  <FormControl>
                    <NativeSelect
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
                        {t('No parent department')}
                      </NativeSelectOption>
                      {parentOptions.map((department) => (
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
