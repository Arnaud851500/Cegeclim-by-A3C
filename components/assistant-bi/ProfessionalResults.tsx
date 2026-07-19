'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
// @ts-ignore - xlsx-js-style est déjà utilisé dans le projet.
import * as XLSX from 'xlsx-js-style'
import type { SemanticVisualizationKey } from '@/lib/ai/cegeclimSemanticCatalog'
import type { AiColumn, AiColumnType, AiResult, AiRow } from '@/lib/ai/assistantBiTypes'

const CEGECLIM_LOGO_URL =
  'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

const PROFESSIONAL_PALETTE = [
  '#2563EB', '#10B981', '#F59E0B', '#7C3AED', '#EF4444', '#0891B2',
  '#DB2777', '#65A30D', '#EA580C', '#4F46E5', '#0F766E', '#A16207',
]

const BUSINESS_COLORS: Record<string, string> = {
  'R/R': '#2563EB',
  'R/O': '#10B981',
  PV: '#F59E0B',
  DRV: '#7C3AED',
  ACC: '#0891B2',
  ECS: '#EF4444',
  TECH: '#475569',
  DIV: '#94A3B8',
  SAV: '#CA8A04',
  'R_ZONE': '#0EA5E9',
  'NON RENSEIGNE': '#CBD5E1',
  BL: '#2563EB',
  BR: '#EF4444',
  CDC: '#7C3AED',
  PL: '#10B981',
  FACTURE: '#0891B2',
  DEVIS: '#F59E0B',
  Autres: '#64748B',
}

const FOLLOW_UPS = [
  'Comparer le résultat avec N-1 et calculer les évolutions en valeur et en pourcentage.',
  'Ajouter la marge en valeur et la marge pondérée en pourcentage.',
  'Limiter l’analyse aux 20 principaux contributeurs et regrouper le solde dans Autres.',
  'Identifier les ruptures de tendance, les valeurs atypiques et les pistes à vérifier.',
]

type TabKey = 'graphique' | 'croise' | 'donnees'
type SortState = { key: string; direction: 'asc' | 'desc' } | null

type Props = {
  result: AiResult
  visualization: SemanticVisualizationKey
  dimensions: string[]
  measures: string[]
  title: string
  dateStart: string
  dateEnd: string
  generatedQuestion: string
  onFollowUp: (instruction: string) => void
}

type PivotModel = {
  rowKey: string
  columnKey: string
  valueKey: string
  rows: Array<Record<string, string | number>>
  columns: string[]
  totalsByColumn: Record<string, number>
  grandTotal: number
}

function asNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function colorFor(label: string, index = 0) {
  const normalized = String(label || 'Non renseigné').trim()
  if (BUSINESS_COLORS[normalized]) return BUSINESS_COLORS[normalized]
  let hash = 0
  for (let i = 0; i < normalized.length; i += 1) hash = ((hash << 5) - hash) + normalized.charCodeAt(i)
  return PROFESSIONAL_PALETTE[Math.abs(hash + index) % PROFESSIONAL_PALETTE.length]
}

function formatCompact(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 1_000_000)} M`
  if (absolute >= 1_000) return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value / 1_000)} k`
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

function formatValue(value: unknown, type: AiColumnType = 'text') {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'currency') {
    const number = asNumber(value)
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(number)
  }
  if (type === 'percent') return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(asNumber(value))} %`
  if (type === 'number') return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(asNumber(value))
  return String(value)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function imageAsDataUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Logo inaccessible')
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function smartCompare(left: unknown, right: unknown) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  return String(left ?? '').localeCompare(String(right ?? ''), 'fr', { numeric: true, sensitivity: 'base' })
}

function buildPivot(
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

  const ranked = [...columnTotals.entries()].sort((a, b) => b[1] - a[1])
  const retained = new Set(ranked.slice(0, maxColumns).map(([key]) => key))
  const hasOthers = ranked.length > maxColumns
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
  if (hasOthers) columns.push('Autres')

  const pivotRows = [...matrix.values()].sort((a, b) => smartCompare(a[rowKey], b[rowKey]))
  const totalsByColumn: Record<string, number> = {}
  columns.forEach((column) => {
    totalsByColumn[column] = pivotRows.reduce((sum, row) => sum + asNumber(row[column]), 0)
  })
  const grandTotal = Object.values(totalsByColumn).reduce((sum, value) => sum + value, 0)

  return { rowKey, columnKey, valueKey, rows: pivotRows, columns, totalsByColumn, grandTotal }
}

function getColumn(result: AiResult, key: string | undefined) {
  return result.columns.find((column) => column.key === key)
}

function CustomTooltip({ active, payload, label, valueType }: { active?: boolean; payload?: Array<{ name?: string; value?: unknown; color?: string }>; label?: unknown; valueType: AiColumnType }) {
  if (!active || !payload?.length) return null
  return (
    <div style={styles.tooltip}>
      <strong>{String(label ?? '')}</strong>
      {payload.filter((item) => asNumber(item.value) !== 0).map((item) => (
        <div key={String(item.name)} style={styles.tooltipLine}>
          <span style={{ ...styles.legendDot, background: item.color || '#64748B' }} />
          <span>{item.name}</span>
          <b>{formatValue(item.value, valueType)}</b>
        </div>
      ))}
    </div>
  )
}

export function ProfessionalResults({
  result,
  visualization,
  dimensions,
  measures,
  title,
  dateStart,
  dateEnd,
  generatedQuestion,
  onFollowUp,
}: Props) {
  const [tab, setTab] = useState<TabKey>('graphique')
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>(null)
  const [showSql, setShowSql] = useState(false)

  const dimensionKeys = useMemo(() => {
    const available = new Set(result.columns.map((column) => column.key))
    const selected = dimensions.filter((key) => available.has(key))
    if (selected.length) return selected
    return result.columns.filter((column) => column.type === 'text').map((column) => column.key)
  }, [dimensions, result.columns])

  const measureKeys = useMemo(() => {
    const available = new Set(result.columns.map((column) => column.key))
    const selected = measures.filter((key) => available.has(key))
    if (selected.length) return selected
    return result.columns.filter((column) => column.type !== 'text').map((column) => column.key)
  }, [measures, result.columns])

  const xKey = dimensionKeys[0] || result.columns[0]?.key || ''
  const stackKey = dimensionKeys[1] || ''
  const valueKey = measureKeys[0] || ''
  const valueColumn = getColumn(result, valueKey)
  const pivot = useMemo(
    () => buildPivot(result.rows_preview, xKey, stackKey, valueKey),
    [result.rows_preview, xKey, stackKey, valueKey],
  )

  const sortedRows = useMemo(() => {
    if (!sort) return result.rows_preview
    return [...result.rows_preview].sort((a, b) => {
      const compared = smartCompare(a[sort.key], b[sort.key])
      return sort.direction === 'asc' ? compared : -compared
    })
  }, [result.rows_preview, sort])

  const numericMaxima = useMemo(() => {
    const maxima: Record<string, number> = {}
    result.columns.filter((column) => column.type !== 'text').forEach((column) => {
      maxima[column.key] = Math.max(...result.rows_preview.map((row) => Math.abs(asNumber(row[column.key]))), 0)
    })
    return maxima
  }, [result.columns, result.rows_preview])

  const kpis = useMemo(() => measureKeys.slice(0, 4).map((key) => {
    const column = getColumn(result, key)
    const values = result.rows_preview.map((row) => asNumber(row[key]))
    const value = column?.type === 'percent'
      ? (values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0)
      : values.reduce((sum, item) => sum + item, 0)
    return { key, label: column?.label || key, type: column?.type || 'number' as AiColumnType, value }
  }), [measureKeys, result])

  const toggleSeries = (series: string) => {
    setHiddenSeries((current) => {
      const next = new Set(current)
      if (next.has(series)) next.delete(series)
      else next.add(series)
      return next
    })
  }

  const renderLegend = (series: string[]) => (
    <div style={styles.legendBar}>
      {series.map((item, index) => {
        const hidden = hiddenSeries.has(item)
        return (
          <button
            type="button"
            key={item}
            onClick={() => toggleSeries(item)}
            style={{ ...styles.legendButton, opacity: hidden ? 0.4 : 1 }}
            title={hidden ? 'Afficher la série' : 'Masquer la série'}
          >
            <span style={{ ...styles.legendDot, background: colorFor(item, index) }} />
            {item}
          </button>
        )
      })}
    </div>
  )

  const renderChart = () => {
    if (!result.rows_preview.length || !xKey || !valueKey) return <EmptyChart />

    if (visualization === 'histogramme_empile' && pivot && pivot.columns.length) {
      return (
        <>
          <div style={styles.chartMeta}>
            <span>Axe : <b>{getColumn(result, xKey)?.label || xKey}</b></span>
            <span>Empilement : <b>{getColumn(result, stackKey)?.label || stackKey}</b></span>
            <span>Valeur : <b>{valueColumn?.label || valueKey}</b></span>
          </div>
          {renderLegend(pivot.columns)}
          <ResponsiveContainer width="100%" height={430}>
            <BarChart data={pivot.rows} margin={{ top: 28, right: 24, left: 24, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} axisLine={{ stroke: '#CBD5E1' }} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip content={<CustomTooltip valueType={valueColumn?.type || 'number'} />} />
              {pivot.columns.filter((series) => !hiddenSeries.has(series)).map((series, index, visible) => (
                <Bar
                  key={series}
                  dataKey={series}
                  stackId="cegeclim-stack"
                  fill={colorFor(series, index)}
                  radius={index === visible.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={92}
                >
                  {index === visible.length - 1 && pivot.rows.length <= 12 ? (
                    <LabelList
                      position="top"
                      formatter={(_value: unknown, entry: { payload?: Record<string, unknown> }) => {
                        const total = pivot.columns.reduce((sum, key) => sum + asNumber(entry?.payload?.[key]), 0)
                        return formatCompact(total)
                      }}
                      style={{ fontSize: 10, fill: '#475569', fontWeight: 700 }}
                    />
                  ) : null}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      )
    }

    const chartRows = result.rows_preview.map((row) => {
      const converted: Record<string, string | number> = {}
      result.columns.forEach((column) => {
        converted[column.key] = column.type === 'text' ? String(row[column.key] ?? '') : asNumber(row[column.key])
      })
      return converted
    })

    if (visualization === 'courbe') {
      return (
        <>
          {renderLegend(measureKeys)}
          <ResponsiveContainer width="100%" height={430}>
            <LineChart data={chartRows} margin={{ top: 20, right: 28, left: 24, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip content={<CustomTooltip valueType={valueColumn?.type || 'number'} />} />
              {measureKeys.filter((key) => !hiddenSeries.has(key)).map((key, index) => (
                <Line key={key} dataKey={key} name={getColumn(result, key)?.label || key} stroke={colorFor(key, index)} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} type="monotone" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )
    }

    if (visualization === 'camembert') {
      const pieData = chartRows.slice(0, 12)
      return (
        <div style={styles.pieLayout}>
          <ResponsiveContainer width="65%" height={410}>
            <PieChart>
              <Tooltip formatter={(value) => formatValue(value, valueColumn?.type || 'number')} />
              <Pie data={pieData} dataKey={valueKey} nameKey={xKey} innerRadius={85} outerRadius={150} paddingAngle={2}>
                {pieData.map((row, index) => <Cell key={`${row[xKey]}-${index}`} fill={colorFor(String(row[xKey]), index)} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={styles.pieLegend}>
            {pieData.map((row, index) => (
              <div key={`${row[xKey]}-${index}`} style={styles.pieLegendLine}>
                <span style={{ ...styles.legendDot, background: colorFor(String(row[xKey]), index) }} />
                <span>{String(row[xKey])}</span>
                <b>{formatValue(row[valueKey], valueColumn?.type || 'number')}</b>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <>
        {renderLegend(measureKeys)}
        <ResponsiveContainer width="100%" height={430}>
          <BarChart data={chartRows} margin={{ top: 20, right: 28, left: 24, bottom: 36 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
            <Tooltip content={<CustomTooltip valueType={valueColumn?.type || 'number'} />} />
            {measureKeys.filter((key) => !hiddenSeries.has(key)).map((key, index) => (
              <Bar key={key} dataKey={key} name={getColumn(result, key)?.label || key} fill={colorFor(key, index)} radius={[4, 4, 0, 0]} maxBarSize={76} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </>
    )
  }

  const exportExcel = () => {
    const workbook = XLSX.utils.book_new()
    const summary = XLSX.utils.aoa_to_sheet([
      ['ASSISTANT BI CEGECLIM — RAPPORT PROFESSIONNEL'],
      [title],
      [`Période : ${dateStart} au ${dateEnd}`],
      [],
      ['Synthèse IA'],
      [result.answer],
      [],
      ['Indicateur', 'Valeur'],
      ...kpis.map((kpi) => [kpi.label, kpi.value]),
    ])
    summary['!cols'] = [{ wch: 34 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(workbook, summary, 'Synthèse')

    const data = XLSX.utils.aoa_to_sheet([
      result.columns.map((column) => column.label),
      ...result.rows_preview.map((row) => result.columns.map((column) => row[column.key] ?? '')),
    ])
    data['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, result.rows_preview.length), c: Math.max(0, result.columns.length - 1) } }) }
    data['!freeze'] = { xSplit: 1, ySplit: 1 }
    data['!cols'] = result.columns.map((column) => ({ wch: Math.max(13, Math.min(38, column.label.length + 8)) }))
    result.columns.forEach((_column, index) => {
      const cell = data[XLSX.utils.encode_cell({ r: 0, c: index })]
      if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '17365D' } }, alignment: { horizontal: 'center' } }
    })
    XLSX.utils.book_append_sheet(workbook, data, 'Données')

    if (pivot) {
      const pivotSheet = XLSX.utils.aoa_to_sheet([
        [getColumn(result, pivot.rowKey)?.label || pivot.rowKey, ...pivot.columns, 'Total'],
        ...pivot.rows.map((row) => [row[pivot.rowKey], ...pivot.columns.map((column) => asNumber(row[column])), pivot.columns.reduce((sum, column) => sum + asNumber(row[column]), 0)]),
        ['TOTAL', ...pivot.columns.map((column) => pivot.totalsByColumn[column]), pivot.grandTotal],
      ])
      pivotSheet['!freeze'] = { xSplit: 1, ySplit: 1 }
      pivotSheet['!cols'] = [{ wch: 24 }, ...pivot.columns.map(() => ({ wch: 16 })), { wch: 18 }]
      XLSX.utils.book_append_sheet(workbook, pivotSheet, 'Tableau croisé')
    }

    const context = XLSX.utils.aoa_to_sheet([
      ['Demande', generatedQuestion],
      ['Période', `${dateStart} au ${dateEnd}`],
      ['Dimensions', dimensions.join(', ')],
      ['Mesures', measures.join(', ')],
      ['Visualisation', visualization],
      ['SQL', result.sql || ''],
    ])
    context['!cols'] = [{ wch: 22 }, { wch: 100 }]
    XLSX.utils.book_append_sheet(workbook, context, 'Paramètres')
    XLSX.writeFile(workbook, `rapport-bi-cegeclim-${isoDate(new Date())}.xlsx`)
  }

  const exportPdf = async () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    try {
      const logo = await imageAsDataUrl(CEGECLIM_LOGO_URL)
      doc.addImage(logo, 'JPEG', 12, 8, 40, 17)
    } catch {
      doc.setFont('helvetica', 'bold')
      doc.text('CEGECLIM', 12, 16)
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text(title, 60, 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Période : ${dateStart} au ${dateEnd} — généré le ${new Date().toLocaleString('fr-FR')}`, 60, 21)
    const summaryLines = doc.splitTextToSize(result.answer, 272) as string[]
    doc.setFontSize(10)
    doc.text(summaryLines, 12, 33)
    const startY = 38 + summaryLines.length * 4

    const tableHead = pivot
      ? [[getColumn(result, pivot.rowKey)?.label || pivot.rowKey, ...pivot.columns, 'Total']]
      : [result.columns.map((column) => column.label)]
    const tableBody = pivot
      ? pivot.rows.map((row) => [String(row[pivot.rowKey]), ...pivot.columns.map((column) => formatValue(row[column], valueColumn?.type || 'number')), formatValue(pivot.columns.reduce((sum, column) => sum + asNumber(row[column]), 0), valueColumn?.type || 'number')])
      : result.rows_preview.slice(0, 100).map((row) => result.columns.map((column) => formatValue(row[column.key], column.type)))

    autoTable(doc, {
      startY,
      head: tableHead,
      body: tableBody,
      foot: pivot ? [['TOTAL', ...pivot.columns.map((column) => formatValue(pivot.totalsByColumn[column], valueColumn?.type || 'number')), formatValue(pivot.grandTotal, valueColumn?.type || 'number')]] : undefined,
      styles: { fontSize: 7, cellPadding: 1.7 },
      headStyles: { fillColor: [23, 54, 93], textColor: [255, 255, 255] },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: () => {
        doc.setFontSize(8)
        doc.text(`CEGECLIM — page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.height - 6)
      },
    })
    doc.save(`rapport-bi-cegeclim-${isoDate(new Date())}.pdf`)
  }

  const exportWord = async () => {
    let logo = CEGECLIM_LOGO_URL
    try { logo = await imageAsDataUrl(CEGECLIM_LOGO_URL) } catch { /* logo distant conservé */ }
    const tableHeaders = result.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')
    const tableRows = result.rows_preview.slice(0, 200).map((row) => `<tr>${result.columns.map((column) => `<td>${escapeHtml(formatValue(row[column.key], column.type))}</td>`).join('')}</tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;color:#172033;margin:26px}img{width:170px}h1{color:#17365d;margin-bottom:4px}.meta{color:#64748b}.summary{background:#eff6ff;border-left:5px solid #2563eb;padding:14px;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:9pt}th{background:#17365d;color:white;padding:7px;border:1px solid #cbd5e1}td{padding:6px;border:1px solid #dbe3ed}tr:nth-child(even){background:#f8fafc}</style></head><body>
      <img src="${logo}" alt="CEGECLIM"><h1>${escapeHtml(title)}</h1><p class="meta">Période ${escapeHtml(dateStart)} au ${escapeHtml(dateEnd)} — généré le ${escapeHtml(new Date().toLocaleString('fr-FR'))}</p>
      <div class="summary">${escapeHtml(result.answer)}</div><table><thead><tr>${tableHeaders}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`
    downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), `rapport-bi-cegeclim-${isoDate(new Date())}.doc`)
  }

  return (
    <section style={styles.resultsRoot}>
      <header style={styles.resultHeader}>
        <div>
          <div style={styles.eyebrow}>RÉSULTAT · {result.row_count} LIGNE(S)</div>
          <h2 style={styles.resultTitle}>{title}</h2>
          <div style={styles.resultMeta}>Période du {dateStart} au {dateEnd}</div>
        </div>
        <div style={styles.exportRow}>
          <button type="button" style={styles.exportButton} onClick={exportExcel}>Excel professionnel</button>
          <button type="button" style={styles.exportButton} onClick={() => void exportWord()}>Word</button>
          <button type="button" style={styles.exportPrimary} onClick={() => void exportPdf()}>PDF CEGECLIM</button>
        </div>
      </header>

      {kpis.length ? (
        <div style={styles.kpiGrid}>
          {kpis.map((kpi) => (
            <div key={kpi.key} style={styles.kpiCard}>
              <span style={styles.kpiLabel}>{kpi.label}</span>
              <strong style={styles.kpiValue}>{formatValue(kpi.value, kpi.type)}</strong>
              <span style={styles.kpiHint}>{kpi.type === 'percent' ? 'Moyenne des lignes affichées' : 'Total des lignes affichées'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={styles.answerCard}>
        <div style={styles.answerTitle}>Synthèse métier générée par l’IA</div>
        <div>{result.answer}</div>
      </div>

      <div style={styles.tabs}>
        {([
          ['graphique', 'Graphique'],
          ['croise', 'Tableau croisé'],
          ['donnees', 'Données détaillées'],
        ] as Array<[TabKey, string]>).map(([key, label]) => (
          <button type="button" key={key} onClick={() => setTab(key)} style={{ ...styles.tab, ...(tab === key ? styles.tabActive : {}) }}>{label}</button>
        ))}
      </div>

      <div style={styles.contentCard}>
        {tab === 'graphique' ? renderChart() : null}
        {tab === 'croise' ? (
          pivot ? (
            <div style={styles.tableScroll}>
              <table style={styles.pivotTable}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, ...styles.stickyFirst }}>{getColumn(result, pivot.rowKey)?.label || pivot.rowKey}</th>
                    {pivot.columns.map((column, index) => <th key={column} style={{ ...styles.th, borderTop: `4px solid ${colorFor(column, index)}` }}>{column}</th>)}
                    <th style={{ ...styles.th, background: '#0F172A' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pivot.rows.map((row, rowIndex) => {
                    const rowTotal = pivot.columns.reduce((sum, column) => sum + asNumber(row[column]), 0)
                    return (
                      <tr key={`${row[pivot.rowKey]}-${rowIndex}`}>
                        <td style={{ ...styles.td, ...styles.stickyFirstCell }}><b>{String(row[pivot.rowKey])}</b></td>
                        {pivot.columns.map((column) => <td key={column} style={{ ...styles.td, textAlign: 'right' }}>{asNumber(row[column]) ? formatValue(row[column], valueColumn?.type || 'number') : '—'}</td>)}
                        <td style={{ ...styles.td, ...styles.totalCell }}>{formatValue(rowTotal, valueColumn?.type || 'number')}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...styles.td, ...styles.stickyFirstCell, ...styles.totalCell }}>TOTAL</td>
                    {pivot.columns.map((column) => <td key={column} style={{ ...styles.td, ...styles.totalCell }}>{formatValue(pivot.totalsByColumn[column], valueColumn?.type || 'number')}</td>)}
                    <td style={{ ...styles.td, ...styles.grandTotal }}>{formatValue(pivot.grandTotal, valueColumn?.type || 'number')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : <EmptyPivot />
        ) : null}
        {tab === 'donnees' ? (
          <div style={styles.tableScroll}>
            <table style={styles.dataTable}>
              <thead>
                <tr>{result.columns.map((column, index) => (
                  <th key={column.key} style={{ ...styles.th, ...(index === 0 ? styles.stickyFirst : {}) }}>
                    <button
                      type="button"
                      style={styles.sortButton}
                      onClick={() => setSort((current) => current?.key === column.key ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key: column.key, direction: 'asc' })}
                    >
                      {column.label}{sort?.key === column.key ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {sortedRows.map((row, rowIndex) => (
                  <tr key={rowIndex} style={rowIndex % 2 ? styles.zebraRow : undefined}>
                    {result.columns.map((column, index) => {
                      const numeric = column.type !== 'text'
                      const ratio = numeric && numericMaxima[column.key] ? Math.min(100, Math.abs(asNumber(row[column.key])) / numericMaxima[column.key] * 100) : 0
                      return (
                        <td
                          key={column.key}
                          style={{
                            ...styles.td,
                            ...(index === 0 ? styles.stickyFirstCell : {}),
                            textAlign: numeric ? 'right' : 'left',
                            backgroundImage: numeric && ratio ? `linear-gradient(90deg, rgba(37,99,235,.10) ${ratio}%, transparent ${ratio}%)` : undefined,
                          }}
                        >
                          {formatValue(row[column.key], column.type)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div style={styles.followUpCard}>
        <strong>Approfondir cette analyse</strong>
        <div style={styles.followUpGrid}>
          {FOLLOW_UPS.map((instruction) => <button type="button" key={instruction} style={styles.followUpButton} onClick={() => onFollowUp(instruction)}>{instruction}</button>)}
        </div>
      </div>

      {result.sql ? (
        <details open={showSql} onToggle={(event) => setShowSql(event.currentTarget.open)} style={styles.sqlBox}>
          <summary>Traçabilité SQL {result.sql_repaired ? '· requête corrigée automatiquement' : ''}</summary>
          {result.sql_repair_reason ? <div style={styles.sqlReason}>{result.sql_repair_reason}</div> : null}
          <pre style={styles.sqlText}>{result.sql}</pre>
        </details>
      ) : null}
    </section>
  )
}

function EmptyChart() {
  return <div style={styles.empty}><strong>Graphique indisponible</strong><span>Le résultat ne contient pas encore une dimension et une mesure exploitables.</span></div>
}

function EmptyPivot() {
  return <div style={styles.empty}><strong>Tableau croisé indisponible</strong><span>Sélectionne au moins deux niveaux de détail et une mesure.</span></div>
}

const styles: Record<string, CSSProperties> = {
  resultsRoot: { minWidth: 0, display: 'grid', gap: 14 },
  resultHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, background: 'white', border: '1px solid #DCE5F0', borderRadius: 16, padding: '16px 18px', boxShadow: '0 8px 24px rgba(15,23,42,.05)' },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: 800, color: '#2563EB' },
  resultTitle: { margin: '4px 0', fontSize: 23, color: '#172033' },
  resultMeta: { color: '#64748B', fontSize: 12 },
  exportRow: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  exportButton: { border: '1px solid #BFDBFE', borderRadius: 9, padding: '9px 12px', background: '#EFF6FF', color: '#1D4ED8', fontWeight: 800, cursor: 'pointer' },
  exportPrimary: { border: 0, borderRadius: 9, padding: '9px 13px', background: '#17365D', color: 'white', fontWeight: 800, cursor: 'pointer' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 },
  kpiCard: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 14, padding: '14px 16px', display: 'grid', gap: 5, boxShadow: '0 6px 16px rgba(15,23,42,.04)' },
  kpiLabel: { color: '#64748B', fontSize: 12, fontWeight: 700 },
  kpiValue: { color: '#0F2744', fontSize: 24, lineHeight: 1.1 },
  kpiHint: { color: '#94A3B8', fontSize: 10 },
  answerCard: { background: 'linear-gradient(135deg,#EFF6FF,#F8FAFC)', border: '1px solid #BFDBFE', borderLeft: '5px solid #2563EB', borderRadius: 14, padding: 16, color: '#1E293B', lineHeight: 1.55, whiteSpace: 'pre-line' },
  answerTitle: { color: '#1D4ED8', fontSize: 12, fontWeight: 900, marginBottom: 7, textTransform: 'uppercase', letterSpacing: .6 },
  tabs: { display: 'flex', gap: 6, background: '#E8EEF6', borderRadius: 11, padding: 4, width: 'fit-content' },
  tab: { border: 0, borderRadius: 8, padding: '9px 14px', background: 'transparent', color: '#475569', fontWeight: 800, cursor: 'pointer' },
  tabActive: { background: 'white', color: '#17365D', boxShadow: '0 2px 8px rgba(15,23,42,.10)' },
  contentCard: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 16, padding: 14, minHeight: 460, boxShadow: '0 8px 24px rgba(15,23,42,.05)', minWidth: 0 },
  chartMeta: { display: 'flex', gap: 18, flexWrap: 'wrap', padding: '4px 8px 10px', color: '#64748B', fontSize: 12 },
  legendBar: { display: 'flex', gap: 7, flexWrap: 'wrap', padding: '4px 8px 12px' },
  legendButton: { border: '1px solid #E2E8F0', borderRadius: 999, padding: '5px 9px', background: 'white', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#334155', fontSize: 11, fontWeight: 700 },
  legendDot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  tooltip: { minWidth: 180, maxWidth: 320, background: 'rgba(15,23,42,.96)', color: 'white', padding: 11, borderRadius: 9, boxShadow: '0 10px 30px rgba(0,0,0,.22)', fontSize: 12 },
  tooltipLine: { display: 'grid', gridTemplateColumns: '10px 1fr auto', alignItems: 'center', gap: 7, marginTop: 6 },
  pieLayout: { display: 'flex', alignItems: 'center', minHeight: 420 },
  pieLegend: { flex: 1, display: 'grid', gap: 8, paddingRight: 20 },
  pieLegendLine: { display: 'grid', gridTemplateColumns: '10px 1fr auto', alignItems: 'center', gap: 8, fontSize: 12 },
  tableScroll: { overflow: 'auto', maxHeight: 580, border: '1px solid #E2E8F0', borderRadius: 10 },
  dataTable: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 },
  pivotTable: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 },
  th: { position: 'sticky', top: 0, zIndex: 3, background: '#17365D', color: 'white', padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,.12)' },
  td: { padding: '8px 10px', borderBottom: '1px solid #EDF2F7', whiteSpace: 'nowrap', backgroundColor: 'white' },
  stickyFirst: { left: 0, zIndex: 5 },
  stickyFirstCell: { position: 'sticky', left: 0, zIndex: 2, boxShadow: '2px 0 4px rgba(15,23,42,.05)' },
  zebraRow: { background: '#F8FAFC' },
  sortButton: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', fontWeight: 800, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' },
  totalCell: { background: '#E8EEF6', fontWeight: 800, textAlign: 'right' },
  grandTotal: { background: '#17365D', color: 'white', fontWeight: 900, textAlign: 'right' },
  followUpCard: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 15, padding: 15 },
  followUpGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginTop: 10 },
  followUpButton: { textAlign: 'left', border: '1px solid #DCE5F0', background: '#F8FAFC', borderRadius: 9, padding: 10, cursor: 'pointer', color: '#334155' },
  sqlBox: { background: '#0F172A', color: '#DBEAFE', borderRadius: 12, padding: 12 },
  sqlReason: { color: '#93C5FD', fontSize: 11, marginTop: 8 },
  sqlText: { overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.5 },
  empty: { minHeight: 410, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, color: '#64748B', textAlign: 'center' },
}
