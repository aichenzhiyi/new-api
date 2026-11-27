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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { MultiSelect } from '@/components/multi-select'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import {
  enterpriseQueryKey,
  getProcurementOptions,
  saveSupplierAccount,
} from '../api'
import {
  procurementCurrencies,
  supplierAccountSchema,
  type SupplierAccountValues,
} from '../lib/forms'
import type { SupplierAccount } from '../types'

export function SupplierAccountDialog(props: {
  account?: SupplierAccount
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const options = useQuery({
    queryKey: [...enterpriseQueryKey, 'options', userId],
    queryFn: getProcurementOptions,
  })
  const form = useForm<SupplierAccountValues>({
    resolver: zodResolver(supplierAccountSchema),
    defaultValues: props.account ?? {
      code: '',
      name: '',
      vendor_id: 0,
      account_ref: '',
      owner: '',
      currency: 'CNY',
      contract_ref: '',
      description: '',
      enabled: true,
      channel_ids: [],
    },
  })
  const mutation = useMutation({
    mutationFn: (values: SupplierAccountValues) =>
      saveSupplierAccount(props.account?.id, values),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: enterpriseQueryKey })
      toast.success(t('Saved successfully'))
      props.onClose()
    },
    onError: (error) => handleServerError(error),
  })
  const fields = [
    { name: 'code', label: t('Procurement account code'), maxLength: 32 },
    { name: 'name', label: t('Procurement account name'), maxLength: 128 },
    {
      name: 'account_ref',
      label: t('Procurement account reference'),
      maxLength: 128,
    },
    { name: 'owner', label: t('Owner'), maxLength: 64 },
    { name: 'contract_ref', label: t('Contract reference'), maxLength: 128 },
  ] as const
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={
        props.account
          ? t('Edit procurement account')
          : t('Create procurement account')
      }
      description={t(
        'Record purchasing details only. Do not enter passwords or API keys. Account status does not change gateway routing.'
      )}
      showCloseButton={!mutation.isPending}
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
            type='submit'
            form='supplier-account-form'
            disabled={mutation.isPending || !options.data}
          >
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      {options.isError ? (
        <ErrorState onRetry={() => void options.refetch()} />
      ) : null}
      <Form {...form}>
        <form
          id='supplier-account-form'
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <fieldset
            className='space-y-4'
            disabled={mutation.isPending || !options.data}
          >
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
              name='vendor_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Vendor')}</FormLabel>
                  <FormControl>
                    <NativeSelect
                      {...field}
                      className='w-full'
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                    >
                      <NativeSelectOption value='0'>
                        {t('Select vendor')}
                      </NativeSelectOption>
                      {options.data?.vendors.map((vendor) => (
                        <NativeSelectOption key={vendor.id} value={vendor.id}>
                          {vendor.name}
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
              name='currency'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Currency')}</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} className='w-full'>
                      {procurementCurrencies.map((currency) => (
                        <NativeSelectOption key={currency} value={currency}>
                          {currency}
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
              name='channel_ids'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Linked channels')}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      id='procurement-channels'
                      selected={field.value.map(String)}
                      onChange={(values) => field.onChange(values.map(Number))}
                      allowCreate={false}
                      disabled={mutation.isPending || !options.data}
                      options={(options.data?.channels ?? [])
                        .filter(
                          (channel) =>
                            channel.supplier_account_id === 0 ||
                            channel.supplier_account_id === props.account?.id
                        )
                        .map((channel) => ({
                          value: String(channel.id),
                          label: `${channel.name} (#${channel.id})`,
                        }))}
                    />
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
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Enabled')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </fieldset>
        </form>
      </Form>
    </Dialog>
  )
}
