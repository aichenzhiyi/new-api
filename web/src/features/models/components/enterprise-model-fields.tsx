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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteEnterpriseModel,
  enterpriseQueryKey,
} from '@/features/enterprise-models/api'
import { emptyEnterpriseProfile } from '@/features/enterprise-models/lib/forms'
import type { Project } from '@/features/projects/types'
import { handleServerError } from '@/lib/handle-server-error'

import type { ModelFormValues } from '../lib/model-form'

export function EnterpriseModelFields(props: {
  modelId?: number
  configured: boolean
  projects: Project[]
  disabled: boolean
  onDeletingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation()
  const form = useFormContext<ModelFormValues>()
  const shared = form.watch('enterprise.shared') ?? false
  const client = useQueryClient()
  const [removing, setRemoving] = useState(false)
  const deletion = useMutation({
    onMutate: () => props.onDeletingChange(true),
    onSettled: () => props.onDeletingChange(false),
    mutationFn: () => {
      if (!props.modelId) throw new Error(t('Model ID is required'))
      return deleteEnterpriseModel(props.modelId)
    },
    onSuccess: async () => {
      for (const key of [
        'model_version',
        'capabilities',
        'context_limit',
        'scenarios',
        'owner',
        'deployment_type',
        'shared',
        'project_ids',
      ] as const) {
        form.resetField(`enterprise.${key}`, {
          defaultValue: emptyEnterpriseProfile[key],
        })
      }
      await client.invalidateQueries({ queryKey: enterpriseQueryKey })
      setRemoving(false)
    },
    onError: (error) => handleServerError(error),
  })
  const fields = [
    { name: 'model_version', label: t('Model version'), maxLength: 128 },
    { name: 'capabilities', label: t('Capabilities'), maxLength: 255 },
    { name: 'owner', label: t('Owner'), maxLength: 64 },
  ] as const
  return (
    <fieldset
      disabled={props.disabled || deletion.isPending}
      className='space-y-4'
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        {fields.map((item) => (
          <FormField
            key={item.name}
            control={form.control}
            name={`enterprise.${item.name}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{item.label}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    maxLength={item.maxLength}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <FormField
          control={form.control}
          name='enterprise.context_limit'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Context limit (tokens; 0 = unknown)')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? 0}
                  type='number'
                  min={0}
                  max={1000000000}
                  step={1}
                  onChange={(event) =>
                    field.onChange(Number(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='enterprise.deployment_type'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Deployment type')}</FormLabel>
              <FormControl>
                <NativeSelect
                  {...field}
                  value={field.value ?? 'cloud'}
                  className='w-full'
                >
                  <NativeSelectOption value='cloud'>
                    {t('Cloud model')}
                  </NativeSelectOption>
                  <NativeSelectOption value='local'>
                    {t('Local models')}
                  </NativeSelectOption>
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name='enterprise.scenarios'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Usage scenarios')}</FormLabel>
            <FormControl>
              <Textarea {...field} value={field.value ?? ''} maxLength={1024} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name='enterprise.shared'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Visible to all projects')}</FormLabel>
            <FormControl>
              <Switch
                checked={field.value ?? false}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  if (checked) {
                    form.setValue('enterprise.project_ids', [], {
                      shouldDirty: true,
                    })
                  }
                }}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name='enterprise.project_ids'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Visible projects')}</FormLabel>
            <FormControl>
              <MultiSelect
                selected={(field.value ?? []).map(String)}
                onChange={(values) => field.onChange(values.map(Number))}
                allowCreate={false}
                disabled={shared || props.disabled || deletion.isPending}
                options={props.projects.map((project) => ({
                  label: `${project.name} (${project.code})`,
                  value: String(project.id),
                }))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Visibility controls the project catalog. It does not grant API access.'
        )}
      </p>
      {props.configured && props.modelId && (
        <Button
          type='button'
          variant='outline'
          onClick={() => setRemoving(true)}
        >
          {t('Remove enterprise profile')}
        </Button>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => {
          if (!deletion.isPending) setRemoving(open)
        }}
        title={t('Remove enterprise profile')}
        desc={t(
          'Remove enterprise details and project visibility? Model metadata and gateway routes are retained.'
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={deletion.isPending}
        handleConfirm={() => deletion.mutate()}
      />
    </fieldset>
  )
}
