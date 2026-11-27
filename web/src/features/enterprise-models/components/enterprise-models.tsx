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
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { enterpriseQueryKey, getEnterpriseModels } from '../api'
import type { EnterpriseModel } from '../types'

const emptyModels: EnterpriseModel[] = []

export function EnterpriseModels(props: { projectId: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const models = useQuery({
    queryKey: [...enterpriseQueryKey, 'models', user?.id, props.projectId ?? 0],
    queryFn: () => getEnterpriseModels(props.projectId),
  })
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const columns = useMemo<ColumnDef<EnterpriseModel>[]>(() => {
    const result: ColumnDef<EnterpriseModel>[] = [
      {
        accessorKey: 'model_name',
        header: t('Model'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <TruncatedCell>{row.original.model_name}</TruncatedCell>
        ),
      },
      { accessorKey: 'vendor_name', header: t('Vendor') },
      {
        accessorKey: 'description',
        header: t('Description'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.description || '—'}</TruncatedCell>
        ),
      },
      { accessorKey: 'model_version', header: t('Model version') },
      { accessorKey: 'capabilities', header: t('Capabilities') },
      {
        accessorKey: 'context_limit',
        header: t('Context limit (tokens; 0 = unknown)'),
        cell: ({ row }) =>
          row.original.context_limit > 0
            ? formatNumber(row.original.context_limit, locale)
            : '—',
      },
      {
        accessorKey: 'deployment_type',
        header: t('Deployment type'),
        cell: ({ row }) =>
          row.original.deployment_type === 'local'
            ? t('Local models')
            : t('Cloud model'),
      },
      { accessorKey: 'owner', header: t('Owner') },
      {
        accessorKey: 'scenarios',
        header: t('Usage scenarios'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.scenarios || '—'}</TruncatedCell>
        ),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) =>
          row.original.status === 1 ? t('Enabled') : t('Disabled'),
      },
      {
        id: 'channels',
        header: t('Configured channels and accounts'),
        cell: ({ row }) => (
          <div className='max-w-72 space-y-1'>
            {row.original.channels.length === 0
              ? '—'
              : row.original.channels.map((channel) => (
                  <div key={channel.id} className='break-words'>
                    {channel.name} (#{channel.id}) ·{' '}
                    {channel.status === 1 ? t('Enabled') : t('Disabled')} ·{' '}
                    {channel.account_name ||
                      t('Unassigned procurement account')}{' '}
                    {channel.currency}
                    {channel.account_name && !channel.account_enabled
                      ? ` · ${t('Disabled')}`
                      : ''}
                  </div>
                ))}
          </div>
        ),
      },
      {
        accessorKey: 'updated_time',
        header: t('Updated At'),
        cell: ({ row }) =>
          row.original.updated_time
            ? formatTimestampToDate(row.original.updated_time)
            : '—',
      },
    ]
    return result
  }, [locale, t])
  const { table } = useDataTable({
    data: models.data ?? emptyModels,
    columns,
    getRowId: (row) => String(row.model_id),
    columnFilters,
    onColumnFiltersChange: setColumnFilters,
  })
  if (models.isError) {
    return <ErrorState onRetry={() => void models.refetch()} />
  }
  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Configured routes may differ from the route used for an individual request.'
        )}
      </p>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={models.isPending}
        isFetching={models.isFetching}
        toolbarProps={{
          searchKey: 'model_name',
          searchPlaceholder: t('Search'),
        }}
        emptyTitle={t('No enterprise models')}
        emptyDescription={t(
          'Ask a global administrator to configure model visibility for this project.'
        )}
        skeletonKeyPrefix='enterprise-models'
      />
    </div>
  )
}
