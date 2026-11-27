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
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTablePage,
  StaticRowActions,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  deleteSupplierAccount,
  enterpriseQueryKey,
  getProcurementOptions,
  getSupplierAccounts,
} from '../api'
import type { SupplierAccount } from '../types'
import { SupplierAccountDialog } from './supplier-account-dialog'

const emptyAccounts: SupplierAccount[] = []

export function SupplierAccounts() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isRoot = user?.role === ROLE.SUPER_ADMIN
  const client = useQueryClient()
  const accounts = useQuery({
    queryKey: [...enterpriseQueryKey, 'accounts', user?.id],
    queryFn: getSupplierAccounts,
    enabled: isRoot,
  })
  const options = useQuery({
    queryKey: [...enterpriseQueryKey, 'options', user?.id],
    queryFn: getProcurementOptions,
    enabled: isRoot,
  })
  const [editor, setEditor] = useState<SupplierAccount | 'new' | null>(null)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [deleting, setDeleting] = useState<SupplierAccount | null>(null)
  const deletion = useMutation({
    mutationFn: (account: SupplierAccount) => deleteSupplierAccount(account.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: enterpriseQueryKey })
      setDeleting(null)
      toast.success(t('Deleted successfully'))
    },
    onError: (error) => handleServerError(error),
  })
  const columns = useMemo<ColumnDef<SupplierAccount>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('Procurement account code'),
        meta: { mobileTitle: true },
      },
      {
        accessorKey: 'name',
        header: t('Procurement account name'),
        cell: ({ row }) => <TruncatedCell>{row.original.name}</TruncatedCell>,
      },
      {
        id: 'vendor',
        header: t('Vendor'),
        accessorFn: (row) =>
          options.data?.vendors.find((vendor) => vendor.id === row.vendor_id)
            ?.name ?? '—',
      },
      {
        accessorKey: 'account_ref',
        header: t('Procurement account reference'),
      },
      { accessorKey: 'owner', header: t('Owner') },
      { accessorKey: 'currency', header: t('Currency') },
      {
        id: 'channels',
        header: t('Linked channels'),
        accessorFn: (row) =>
          row.channel_ids
            .map(
              (id) =>
                options.data?.channels.find((channel) => channel.id === id)
                  ?.name ?? `#${id}`
            )
            .join(', ') || '—',
      },
      {
        accessorKey: 'enabled',
        header: t('Status'),
        cell: ({ row }) =>
          row.original.enabled ? t('Enabled') : t('Disabled'),
      },
      {
        accessorKey: 'updated_time',
        header: t('Updated At'),
        cell: ({ row }) => formatTimestampToDate(row.original.updated_time),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <StaticRowActions
            editLabel={t('Edit procurement account')}
            deleteLabel={t('Delete procurement account')}
            menuLabel={t('Actions')}
            onEdit={() => setEditor(row.original)}
            onDelete={() => setDeleting(row.original)}
          />
        ),
      },
    ],
    [options.data, t]
  )
  const { table } = useDataTable({
    data: accounts.data ?? emptyAccounts,
    columns,
    getRowId: (row) => String(row.id),
    columnFilters,
    onColumnFiltersChange: setColumnFilters,
  })
  if (!isRoot) {
    return (
      <ErrorState
        title={t(
          'Only global administrators can manage shared model configuration'
        )}
      />
    )
  }
  if (accounts.isError || options.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void accounts.refetch()
          void options.refetch()
        }}
      />
    )
  }
  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t('Manage purchasing accounts and their channel associations.')}
        </p>
        <Button
          onClick={() => setEditor('new')}
          disabled={!options.data || options.data.vendors.length === 0}
        >
          {t('Create procurement account')}
        </Button>
      </div>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={accounts.isPending || options.isPending}
        isFetching={accounts.isFetching || options.isFetching}
        toolbarProps={{ searchKey: 'name', searchPlaceholder: t('Search') }}
        emptyTitle={t('No procurement accounts')}
        emptyDescription={t(
          'Create a vendor, then register its procurement accounts.'
        )}
        skeletonKeyPrefix='procurement'
      />
      {editor !== null && (
        <SupplierAccountDialog
          account={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) setDeleting(null)
        }}
        title={t('Delete procurement account')}
        desc={t(
          'Unlink all channels before deleting this procurement account.'
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={deletion.isPending}
        handleConfirm={() => {
          if (deleting) deletion.mutate(deleting)
        }}
      />
    </div>
  )
}
