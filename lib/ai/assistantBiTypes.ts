export type AiColumnType = 'number' | 'currency' | 'percent' | 'text'

export type AiColumn = {
  key: string
  label: string
  type: AiColumnType
}

export type AiRow = Record<string, string | number | boolean | null | undefined>

export type AiVisualization = {
  kind: 'table' | 'bar' | 'stacked_bar' | 'line' | 'pie' | 'pivot'
  title: string
  xKey?: string
  yKeys?: string[]
  stackBy?: string
  valueKey?: string
  labelKey?: string
  columns?: string[]
  note?: string
}

export type AiResult = {
  answer: string
  sql?: string
  row_count: number
  rows_preview: AiRow[]
  columns: AiColumn[]
  visualization: AiVisualization | null
  sql_repaired?: boolean
  sql_repair_reason?: string
  sql_first_error?: string
  error?: string
}

export function normalizeAiResult(payload: unknown): AiResult {
  const raw = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {}

  const rows = Array.isArray(raw.rows_preview)
    ? raw.rows_preview.filter((row): row is AiRow => Boolean(row && typeof row === 'object'))
    : []

  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((column): column is AiColumn => {
        if (!column || typeof column !== 'object') return false
        const item = column as Record<string, unknown>
        return typeof item.key === 'string' && typeof item.label === 'string'
      }).map((column) => ({
        ...column,
        type: ['number', 'currency', 'percent', 'text'].includes(column.type)
          ? column.type
          : 'text',
      }))
    : []

  const visualization = raw.visualization && typeof raw.visualization === 'object'
    ? raw.visualization as AiVisualization
    : null

  return {
    answer: typeof raw.answer === 'string' ? raw.answer : 'La synthèse IA est vide.',
    sql: typeof raw.sql === 'string' ? raw.sql : undefined,
    row_count: Number.isFinite(Number(raw.row_count)) ? Number(raw.row_count) : rows.length,
    rows_preview: rows,
    columns,
    visualization,
    sql_repaired: raw.sql_repaired === true,
    sql_repair_reason: typeof raw.sql_repair_reason === 'string' ? raw.sql_repair_reason : undefined,
    sql_first_error: typeof raw.sql_first_error === 'string' ? raw.sql_first_error : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}
