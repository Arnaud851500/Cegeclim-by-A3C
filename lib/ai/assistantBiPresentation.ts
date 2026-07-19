import type { AiColumnType, AiRow } from '@/lib/ai/assistantBiTypes'

export const PROFESSIONAL_PALETTE = [
  '#2563EB', '#10B981', '#F59E0B', '#7C3AED', '#EF4444', '#0891B2',
  '#DB2777', '#65A30D', '#EA580C', '#4F46E5', '#0F766E', '#A16207',
]

const BUSINESS_COLORS: Record<string, string> = {
  'R/R': '#2563EB', 'R/O': '#10B981', PV: '#F59E0B', DRV: '#7C3AED',
  ACC: '#0891B2', ECS: '#EF4444', TECH: '#475569', DIV: '#94A3B8',
  SAV: '#CA8A04', R_ZONE: '#0EA5E9', 'NON RENSEIGNE': '#CBD5E1',
  BL: '#2563EB', BR: '#EF4444', CDC: '#7C3AED', PL: '#10B981',
  FACTURE: '#0891B2', DEVIS: '#F59E0B', Autres: '#64748B',
}

export type PivotModel = {
  rowKey: string
  columnKey: string
  valueKey: string
  rows: Array<Record<string, string | number>>
  columns: string[]
  totalsByColumn: Record<string, number>
  grandTotal: number
}

export function asNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

export function colorFor(label: string, index = 0) {
  const normalized = String(label || 'Non renseigné').trim()
  if (BUSINESS_COLORS[normalized]) return BUSINESS_COLORS[normalized]
  let hash = 0
  for (let position = 0; position < normalized.length; position += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(position)
  }
  return PROFESSIONAL_PALETTE[Math.abs(hash + index) % PROFESSIONAL_PALETTE.length]
}

export function formatCompact(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 1_000_000)} M`
  }
  if (absolute >= 1_000) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value / 1_000)} k`
  }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

export function formatValue(value: unknown, type: AiColumnType = 'text') {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'currency') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
    }).format(asNumber(value))
  }
  if (type === 'percent') {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(asNumber(value))} %`
  }
  if (type === 'number') {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(asNumber(value))
  }
  return String(value)
}

export function smartCompare(left: unknown, right: unknown) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return String(left ?? '').localeCompare(String(right ?? ''), 'fr', {
    numeric: true,
    sensitivity: 'base',
  })
}

export function buildPivot(
  rows: AiRow[],
  rowKey: string,
  columnKey: string,
  valueKey: string,
  maxColumns = 10,
): PivotModel | null {
  if (!rowKey || !columnKey || !valueKey) return null

  const columnTotals = new Map<string, number>()
  rows.forEach((row) => {
    const column = String(row[columnKey] ?? 'Non renseigné')
    columnTotals.set(column, (columnTotals.get(column) || 0) + asNumber(row[valueKey]))
  })

  const ranked = [...columnTotals.entries()].sort((left, right) => right[1] - left[1])
  const retained = new Set(ranked.slice(0, maxColumns).map(([key]) => key))
  const matrix = new Map<string, Record<string, string | number>>()

  rows.forEach((row) => {
    const rowLabel = String(row[rowKey] ?? 'Non renseigné')
    const originalColumn = String(row[columnKey] ?? 'Non renseigné')
    const column = retained.has(originalColumn) ? originalColumn : 'Autres'
    const target = matrix.get(rowLabel) || { [rowKey]: rowLabel }
    target[column] = asNumber(target[column]) + asNumber(row[valueKey])
    matrix.set(rowLabel, target)
  })

  const columns = ranked.slice(0, maxColumns).map(([key]) => key)
  if (ranked.length > maxColumns) columns.push('Autres')

  const pivotRows = [...matrix.values()].sort((left, right) => smartCompare(left[rowKey], right[rowKey]))
  const totalsByColumn: Record<string, number> = {}
  columns.forEach((column) => {
    totalsByColumn[column] = pivotRows.reduce((sum, row) => sum + asNumber(row[column]), 0)
  })

  return {
    rowKey,
    columnKey,
    valueKey,
    rows: pivotRows,
    columns,
    totalsByColumn,
    grandTotal: Object.values(totalsByColumn).reduce((sum, value) => sum + value, 0),
  }
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
