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
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  StaticRowActions,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import type { Department } from '@/features/departments/types'
import { formatTimestampToDate } from '@/lib/format'

import type { Project } from '../types'

interface ProjectsTableProps {
  projects: Project[]
  departments: Department[]
  isLoading: boolean
  isFetching: boolean
  onEdit: (project: Project) => void
  onToggle: (project: Project) => void
  onDelete: (project: Project) => void
  onModels?: (project: Project) => void
}

export function ProjectsTable(props: ProjectsTableProps) {
  const { t } = useTranslation()
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const columns = useMemo<ColumnDef<Project>[]>(() => {
    const names = new Map(
      props.departments.map((department) => [
        department.id,
        `${department.name} (${department.code})`,
      ])
    )
    return [
      {
        accessorKey: 'code',
        header: t('Project code'),
        size: 150,
        meta: { label: t('Project code'), mobileTitle: true },
      },
      {
        accessorKey: 'name',
        header: t('Project name'),
        size: 180,
        cell: ({ row }) => <TruncatedCell>{row.original.name}</TruncatedCell>,
        meta: { label: t('Project name') },
      },
      {
        id: 'department',
        header: t('Cost-bearing department'),
        size: 200,
        accessorFn: (row) =>
          names.get(row.department_id) ?? t('Unknown department'),
        meta: { label: t('Cost-bearing department') },
      },
      {
        accessorKey: 'owner',
        header: t('Project owner'),
        size: 140,
        meta: { label: t('Project owner') },
      },
      {
        accessorKey: 'enabled',
        header: t('Status'),
        size: 90,
        cell: ({ row }) => (
          <StatusBadge
            copyable={false}
            variant={row.original.enabled ? 'success' : 'neutral'}
            label={row.original.enabled ? t('Enabled') : t('Disabled')}
          />
        ),
        meta: { label: t('Status') },
      },
      {
        accessorKey: 'created_time',
        header: t('Created At'),
        size: 180,
        cell: ({ row }) => (
          <span className='whitespace-nowrap tabular-nums'>
            {formatTimestampToDate(row.original.created_time)}
          </span>
        ),
        meta: { label: t('Created At') },
      },
      {
        accessorKey: 'updated_time',
        header: t('Updated At'),
        size: 180,
        cell: ({ row }) => (
          <span className='whitespace-nowrap tabular-nums'>
            {formatTimestampToDate(row.original.updated_time)}
          </span>
        ),
        meta: { label: t('Updated At') },
      },
      {
        id: 'actions',
        header: t('Actions'),
        size: 170,
        cell: ({ row }) => (
          <div className='flex items-center justify-end gap-1'>
            {props.onModels && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => props.onModels?.(row.original)}
              >
                {t('Models')}
              </Button>
            )}
            <StaticRowActions
              editLabel={t('Edit project')}
              deleteLabel={t('Delete project')}
              menuLabel={t('Actions')}
              onEdit={() => props.onEdit(row.original)}
              onDelete={() => props.onDelete(row.original)}
            />
            <Button
              variant='ghost'
              size='sm'
              onClick={() => props.onToggle(row.original)}
            >
              {row.original.enabled ? t('Disable') : t('Enable')}
            </Button>
          </div>
        ),
        meta: { label: t('Actions') },
      },
    ]
  }, [props, t])
  const { table } = useDataTable({
    data: props.projects,
    columns,
    columnFilters,
    onColumnFiltersChange: setColumnFilters,
    getRowId: (row) => String(row.id),
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isFetching={props.isFetching}
      toolbarProps={{
        searchKey: 'name',
        searchPlaceholder: t('Search projects'),
      }}
      emptyTitle={t('No projects found')}
      emptyDescription={
        props.departments.some((department) => department.enabled)
          ? t('Create a project or change the search.')
          : t('Create an enabled department before creating a project.')
      }
      skeletonKeyPrefix='projects'
    />
  )
}
