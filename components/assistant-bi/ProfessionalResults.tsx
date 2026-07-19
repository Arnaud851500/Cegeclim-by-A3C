'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
// @ts-ignore - paquet déjà utilisé dans le projet.
import * as XLSX from 'xlsx-js-style'
import type { SemanticVisualizationKey } from '@/lib/ai/cegeclimSemanticCatalog'
import type { AiColumn, AiColumnType, AiResult, AiRow } from '@/lib/ai/assistantBiTypes'
import {
  asNumber,
  buildPivot,
  colorFor,
  escapeHtml,
  formatCompact,
  formatValue,
  isoDate,
  smartCompare,
} from '@/lib/ai/assistantBiPresentation'

const CEGECLIM_LOGO_URL =
  'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

const FOLLOW_UPS = [
  'Comparer le résultat avec N-1 et calculer les évolutions en valeur et en pourcentage.',
  'Ajouter la marge en valeur et la marge pondérée en pourcentage.',
  'Limiter l’analyse aux 20 principaux contributeurs et regrouper le solde dans Autres.',
  'Identifier les ruptures de tendance, les valeurs atypiques et les pistes à vérifier.',
]

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

type TabKey = 'graphique' | 'croise' | 'donnees'
type SortState = { key: string; direction: 'asc' | 'desc' } | null

function getColumn(result: AiResult, key?: string) {
  return result.columns.find((column) => column.key === key)
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
  if (!response.ok) throw new Error('Logo CEGECLIM inaccessible.')
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function chartRows(result: AiResult) {
  return result.rows_preview.map((row) => {
    const converted: Record<string, string | number> = {}
    result.columns.forEach((column) => {
      converted[column.key] = column.type === 'text'
        ? String(row[column.key] ?? '')
        : asNumber(row[column.key])
    })
    return converted
  })
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
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([])
  const [sort, setSort] = useState<SortState>(null)
  const [showSql, setShowSql] = useState(false)

  const available = useMemo(() => new Set(result.columns.map((column) => column.key)), [result.columns])
  const dimensionKeys = useMemo(() => {
    const selected = dimensions.filter((key) => available.has(key))
    return selected.length ? selected : result.columns.filter((column) => column.type === 'text').map((column) => column.key)
  }, [available, dimensions, result.columns])
  const measureKeys = useMemo(() => {
    const selected = measures.filter((key) => available.has(key))
    return selected.length ? selected : result.columns.filter((column) => column.type !== 'text').map((column) => column.key)
  }, [available, measures, result.columns])

  const xKey = dimensionKeys[0] || result.columns[0]?.key || ''
  const stackKey = dimensionKeys[1] || ''
  const valueKey = measureKeys[0] || ''
  const valueColumn = getColumn(result, valueKey)
  const pivot = useMemo(
    () => buildPivot(result.rows_preview, xKey, stackKey, valueKey, 10),
    [result.rows_preview, xKey, stackKey, valueKey],
  )
  const normalizedRows = useMemo(() => chartRows(result), [result])

  const sortedRows = useMemo(() => {
    if (!sort) return result.rows_preview
    return [...result.rows_preview].sort((left, right) => {
      const compared = smartCompare(left[sort.key], right[sort.key])
      return sort.direction === 'asc' ? compared : -compared
    })
  }, [result.rows_preview, sort])

  const maxima = useMemo(() => {
    const values: Record<string, number> = {}
    result.columns.filter((column) => column.type !== 'text').forEach((column) => {
      values[column.key] = Math.max(0, ...result.rows_preview.map((row) => Math.abs(asNumber(row[column.key]))))
    })
    return values
  }, [result.columns, result.rows_preview])

  const kpis = useMemo(() => measureKeys.slice(0, 4).map((key) => {
    const column = getColumn(result, key)
    const values = result.rows_preview.map((row) => asNumber(row[key]))
    const aggregate = column?.type === 'percent'
      ? (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
      : values.reduce((sum, value) => sum + value, 0)
    return {
      key,
      label: column?.label || key,
      value: aggregate,
      type: (column?.type || 'number') as AiColumnType,
    }
  }), [measureKeys, result])

  function toggleSeries(series: string) {
    setHiddenSeries((current) => current.includes(series)
      ? current.filter((item) => item !== series)
      : [...current, series])
  }

  function renderLegend(series: string[]) {
    return (
      <div style={styles.legendBar}>
        {series.map((item, index) => (
          <button
            type="button"
            key={item}
            onClick={() => toggleSeries(item)}
            style={{ ...styles.legendButton, opacity: hiddenSeries.includes(item) ? 0.38 : 1 }}
          >
            <span style={{ ...styles.legendDot, background: colorFor(item, index) }} />
            {getColumn(result, item)?.label || item}
          </button>
        ))}
      </div>
    )
  }

  function renderChart() {
    if (!result.rows_preview.length || !xKey || !valueKey) return <EmptyState text="Le résultat ne contient pas une dimension et une mesure exploitables." />

    if (visualization === 'camembert') {
      const pieRows = normalizedRows.slice(0, 12)
      return (
        <div style={styles.pieLayout}>
          <ResponsiveContainer width="62%" height={410}>
            <PieChart>
              <Tooltip formatter={(value) => formatValue(value, valueColumn?.type || 'number')} />
              <Pie data={pieRows} dataKey={valueKey} nameKey={xKey} innerRadius={82} outerRadius={148} paddingAngle={2}>
                {pieRows.map((row, index) => <Cell key={`${row[xKey]}-${index}`} fill={colorFor(String(row[xKey]), index)} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={styles.pieLegend}>
            {pieRows.map((row, index) => (
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

    if (pivot && visualization === 'courbe') {
      const visible = pivot.columns.filter((series) => !hiddenSeries.includes(series))
      return (
        <>
          <div style={styles.chartMeta}>
            <span>Axe : <b>{getColumn(result, xKey)?.label || xKey}</b></span>
            <span>Séries : <b>{getColumn(result, stackKey)?.label || stackKey}</b></span>
            <span>Valeur : <b>{valueColumn?.label || valueKey}</b></span>
          </div>
          {renderLegend(pivot.columns)}
          <ResponsiveContainer width="100%" height={430}>
            <LineChart data={pivot.rows} margin={{ top: 20, right: 28, left: 18, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={(value) => formatValue(value, valueColumn?.type || 'number')} />
              {visible.map((series) => {
                const colorIndex = pivot.columns.indexOf(series)
                return (
                  <Line
                    key={series}
                    dataKey={series}
                    name={series}
                    stroke={colorFor(series, colorIndex)}
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    type="monotone"
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </>
      )
    }

    if (pivot) {
      const visible = pivot.columns.filter((series) => !hiddenSeries.includes(series))
      const stacked = visualization === 'histogramme_empile'
      return (
        <>
          <div style={styles.chartMeta}>
            <span>Axe : <b>{getColumn(result, xKey)?.label || xKey}</b></span>
            <span>{stacked ? 'Empilement' : 'Séries'} : <b>{getColumn(result, stackKey)?.label || stackKey}</b></span>
            <span>Valeur : <b>{valueColumn?.label || valueKey}</b></span>
          </div>
          {renderLegend(pivot.columns)}
          <ResponsiveContainer width="100%" height={430}>
            <BarChart data={pivot.rows} margin={{ top: 20, right: 28, left: 18, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={(value) => formatValue(value, valueColumn?.type || 'number')} />
              {visible.map((series, visibleIndex) => {
                const colorIndex = pivot.columns.indexOf(series)
                return (
                  <Bar
                    key={series}
                    dataKey={series}
                    name={series}
                    stackId={stacked ? 'cegeclim' : undefined}
                    fill={colorFor(series, colorIndex)}
                    radius={stacked
                      ? (visibleIndex === visible.length - 1 ? [4, 4, 0, 0] : 0)
                      : [4, 4, 0, 0]}
                    maxBarSize={stacked ? 90 : 72}
                  />
                )
              })}
            </BarChart>
          </ResponsiveContainer>
        </>
      )
    }

    if (visualization === 'courbe') {
      return (
        <>
          {renderLegend(measureKeys)}
          <ResponsiveContainer width="100%" height={430}>
            <LineChart data={normalizedRows} margin={{ top: 20, right: 28, left: 18, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={(value) => formatValue(value, valueColumn?.type || 'number')} />
              {measureKeys.filter((key) => !hiddenSeries.includes(key)).map((key, index) => (
                <Line key={key} dataKey={key} name={getColumn(result, key)?.label || key} stroke={colorFor(key, index)} strokeWidth={3} dot={{ r: 3 }} type="monotone" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )
    }

    return (
      <>
        {renderLegend(measureKeys)}
        <ResponsiveContainer width="100%" height={430}>
          <BarChart data={normalizedRows} margin={{ top: 20, right: 28, left: 18, bottom: 32 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatCompact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
            <Tooltip formatter={(value) => formatValue(value, valueColumn?.type || 'number')} />
            {measureKeys.filter((key) => !hiddenSeries.includes(key)).map((key, index) => (
              <Bar key={key} dataKey={key} name={getColumn(result, key)?.label || key} fill={colorFor(key, index)} radius={[4, 4, 0, 0]} maxBarSize={72} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </>
    )
  }

  function exportExcel() {
    const workbook = XLSX.utils.book_new()
    const summarySheet = XLSX.utils.aoa_to_sheet([
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
    summarySheet['!cols'] = [{ wch: 34 }, { wch: 24 }]
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Synthèse')

    const dataSheet = XLSX.utils.aoa_to_sheet([
      result.columns.map((column) => column.label),
      ...result.rows_preview.map((row) => result.columns.map((column) => row[column.key] ?? '')),
    ])
    dataSheet['!cols'] = result.columns.map((column) => ({ wch: Math.max(13, Math.min(38, column.label.length + 8)) }))
    result.columns.forEach((_column, index) => {
      const cell = dataSheet[XLSX.utils.encode_cell({ r: 0, c: index })]
      if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '17365D' } } }
    })
    XLSX.utils.book_append_sheet(workbook, dataSheet, 'Données')

    if (pivot) {
      const pivotSheet = XLSX.utils.aoa_to_sheet([
        [getColumn(result, pivot.rowKey)?.label || pivot.rowKey, ...pivot.columns, 'Total'],
        ...pivot.rows.map((row) => [
          row[pivot.rowKey],
          ...pivot.columns.map((column) => asNumber(row[column])),
          pivot.columns.reduce((sum, column) => sum + asNumber(row[column]), 0),
        ]),
        ['TOTAL', ...pivot.columns.map((column) => pivot.totalsByColumn[column]), pivot.grandTotal],
      ])
      pivotSheet['!cols'] = [{ wch: 24 }, ...pivot.columns.map(() => ({ wch: 16 })), { wch: 18 }]
      XLSX.utils.book_append_sheet(workbook, pivotSheet, 'Tableau croisé')
    }

    const contextSheet = XLSX.utils.aoa_to_sheet([
      ['Demande', generatedQuestion],
      ['Période', `${dateStart} au ${dateEnd}`],
      ['Dimensions', dimensions.join(', ')],
      ['Mesures', measures.join(', ')],
      ['Visualisation', visualization],
      ['SQL', result.sql || ''],
    ])
    contextSheet['!cols'] = [{ wch: 22 }, { wch: 100 }]
    XLSX.utils.book_append_sheet(workbook, contextSheet, 'Paramètres')
    XLSX.writeFile(workbook, `rapport-bi-cegeclim-${isoDate(new Date())}.xlsx`)
  }

  async function exportPdf() {
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
    const summary = doc.splitTextToSize(result.answer, 272) as string[]
    doc.setFontSize(10)
    doc.text(summary, 12, 33)

    const head = pivot
      ? [[getColumn(result, pivot.rowKey)?.label || pivot.rowKey, ...pivot.columns, 'Total']]
      : [result.columns.map((column) => column.label)]
    const body = pivot
      ? pivot.rows.map((row) => [
          String(row[pivot.rowKey]),
          ...pivot.columns.map((column) => formatValue(row[column], valueColumn?.type || 'number')),
          formatValue(pivot.columns.reduce((sum, column) => sum + asNumber(row[column]), 0), valueColumn?.type || 'number'),
        ])
      : result.rows_preview.slice(0, 100).map((row) => result.columns.map((column) => formatValue(row[column.key], column.type)))

    autoTable(doc, {
      startY: 38 + summary.length * 4,
      head,
      body,
      styles: { fontSize: 7, cellPadding: 1.7 },
      headStyles: { fillColor: [23, 54, 93], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: () => {
        doc.setFontSize(8)
        doc.text(`CEGECLIM — page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.height - 6)
      },
    })
    doc.save(`rapport-bi-cegeclim-${isoDate(new Date())}.pdf`)
  }

  async function exportWord() {
    let logo = CEGECLIM_LOGO_URL
    try { logo = await imageAsDataUrl(CEGECLIM_LOGO_URL) } catch { logo = CEGECLIM_LOGO_URL }
    const headers = result.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')
    const rows = result.rows_preview.slice(0, 200).map((row) => `<tr>${result.columns.map((column) => `<td>${escapeHtml(formatValue(row[column.key], column.type))}</td>`).join('')}</tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial;color:#172033;margin:26px}img{width:170px}h1{color:#17365d}.meta{color:#64748b}.summary{background:#eff6ff;border-left:5px solid #2563eb;padding:14px;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:9pt}th{background:#17365d;color:white;padding:7px;border:1px solid #cbd5e1}td{padding:6px;border:1px solid #dbe3ed}tr:nth-child(even){background:#f8fafc}</style></head><body><img src="${logo}" alt="CEGECLIM"><h1>${escapeHtml(title)}</h1><p class="meta">Période ${escapeHtml(dateStart)} au ${escapeHtml(dateEnd)}</p><div class="summary">${escapeHtml(result.answer)}</div><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></body></html>`
    downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), `rapport-bi-cegeclim-${isoDate(new Date())}.doc`)
  }

  return (
    <section style={styles.root}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>RÉSULTAT · {result.row_count} LIGNE(S)</div>
          <h2 style={styles.title}>{title}</h2>
          <div style={styles.meta}>Période du {dateStart} au {dateEnd}</div>
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
              <table style={styles.table}>
                <thead><tr>
                  <th style={{ ...styles.th, ...styles.stickyHead }}>{getColumn(result, pivot.rowKey)?.label || pivot.rowKey}</th>
                  {pivot.columns.map((column, index) => <th key={column} style={{ ...styles.th, borderTop: `4px solid ${colorFor(column, index)}` }}>{column}</th>)}
                  <th style={{ ...styles.th, background: '#0F172A' }}>Total</th>
                </tr></thead>
                <tbody>
                  {pivot.rows.map((row, rowIndex) => {
                    const total = pivot.columns.reduce((sum, column) => sum + asNumber(row[column]), 0)
                    return <tr key={`${row[pivot.rowKey]}-${rowIndex}`}>
                      <td style={{ ...styles.td, ...styles.stickyCell }}><b>{String(row[pivot.rowKey])}</b></td>
                      {pivot.columns.map((column) => <td key={column} style={{ ...styles.td, textAlign: 'right' }}>{asNumber(row[column]) ? formatValue(row[column], valueColumn?.type || 'number') : '—'}</td>)}
                      <td style={{ ...styles.td, ...styles.totalCell }}>{formatValue(total, valueColumn?.type || 'number')}</td>
                    </tr>
                  })}
                </tbody>
                <tfoot><tr>
                  <td style={{ ...styles.td, ...styles.stickyCell, ...styles.totalCell }}>TOTAL</td>
                  {pivot.columns.map((column) => <td key={column} style={{ ...styles.td, ...styles.totalCell }}>{formatValue(pivot.totalsByColumn[column], valueColumn?.type || 'number')}</td>)}
                  <td style={{ ...styles.td, ...styles.grandTotal }}>{formatValue(pivot.grandTotal, valueColumn?.type || 'number')}</td>
                </tr></tfoot>
              </table>
            </div>
          ) : <EmptyState text="Sélectionne au moins deux dimensions et une mesure pour construire un tableau croisé." />
        ) : null}
        {tab === 'donnees' ? (
          <div style={styles.tableScroll}>
            <table style={styles.table}>
              <thead><tr>{result.columns.map((column, index) => <th key={column.key} style={{ ...styles.th, ...(index === 0 ? styles.stickyHead : {}) }}><button type="button" style={styles.sortButton} onClick={() => setSort((current) => current?.key === column.key ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key: column.key, direction: 'asc' })}>{column.label}{sort?.key === column.key ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>)}</tr></thead>
              <tbody>{sortedRows.map((row, rowIndex) => <tr key={rowIndex}>{result.columns.map((column, index) => {
                const numeric = column.type !== 'text'
                const ratio = numeric && maxima[column.key] ? Math.min(100, Math.abs(asNumber(row[column.key])) / maxima[column.key] * 100) : 0
                return <td key={column.key} style={{ ...styles.td, ...(index === 0 ? styles.stickyCell : {}), textAlign: numeric ? 'right' : 'left', backgroundImage: ratio ? `linear-gradient(90deg, rgba(37,99,235,.10) ${ratio}%, transparent ${ratio}%)` : undefined }}>{formatValue(row[column.key], column.type)}</td>
              })}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div style={styles.followUpCard}>
        <strong>Approfondir cette analyse</strong>
        <div style={styles.followUpGrid}>{FOLLOW_UPS.map((instruction) => <button type="button" key={instruction} style={styles.followUpButton} onClick={() => onFollowUp(instruction)}>{instruction}</button>)}</div>
      </div>

      {result.sql ? <details open={showSql} onToggle={(event) => setShowSql(event.currentTarget.open)} style={styles.sqlBox}><summary>Traçabilité SQL {result.sql_repaired ? '· requête corrigée automatiquement' : ''}</summary>{result.sql_repair_reason ? <div style={styles.sqlReason}>{result.sql_repair_reason}</div> : null}<pre style={styles.sqlText}>{result.sql}</pre></details> : null}
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={styles.empty}><strong>Restitution indisponible</strong><span>{text}</span></div>
}

const styles: Record<string, CSSProperties> = {
  root: { minWidth: 0, display: 'grid', gap: 14 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, background: 'white', border: '1px solid #DCE5F0', borderRadius: 16, padding: '16px 18px', boxShadow: '0 8px 24px rgba(15,23,42,.05)' },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: 800, color: '#2563EB' },
  title: { margin: '4px 0', fontSize: 23, color: '#172033' },
  meta: { color: '#64748B', fontSize: 12 },
  exportRow: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  exportButton: { border: '1px solid #BFDBFE', borderRadius: 9, padding: '9px 12px', background: '#EFF6FF', color: '#1D4ED8', fontWeight: 800, cursor: 'pointer' },
  exportPrimary: { border: 0, borderRadius: 9, padding: '9px 13px', background: '#17365D', color: 'white', fontWeight: 800, cursor: 'pointer' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 },
  kpiCard: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 14, padding: '14px 16px', display: 'grid', gap: 5 },
  kpiLabel: { color: '#64748B', fontSize: 12, fontWeight: 700 },
  kpiValue: { color: '#0F2744', fontSize: 24, lineHeight: 1.1 },
  kpiHint: { color: '#94A3B8', fontSize: 10 },
  answerCard: { background: 'linear-gradient(135deg,#EFF6FF,#F8FAFC)', border: '1px solid #BFDBFE', borderLeft: '5px solid #2563EB', borderRadius: 14, padding: 16, color: '#1E293B', lineHeight: 1.55, whiteSpace: 'pre-line' },
  answerTitle: { color: '#1D4ED8', fontSize: 12, fontWeight: 900, marginBottom: 7, textTransform: 'uppercase', letterSpacing: .6 },
  tabs: { display: 'flex', gap: 6, background: '#E8EEF6', borderRadius: 11, padding: 4, width: 'fit-content' },
  tab: { border: 0, borderRadius: 8, padding: '9px 14px', background: 'transparent', color: '#475569', fontWeight: 800, cursor: 'pointer' },
  tabActive: { background: 'white', color: '#17365D', boxShadow: '0 2px 8px rgba(15,23,42,.10)' },
  contentCard: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 16, padding: 14, minHeight: 460, minWidth: 0 },
  chartMeta: { display: 'flex', gap: 18, flexWrap: 'wrap', padding: '4px 8px 10px', color: '#64748B', fontSize: 12 },
  legendBar: { display: 'flex', gap: 7, flexWrap: 'wrap', padding: '4px 8px 12px' },
  legendButton: { border: '1px solid #E2E8F0', borderRadius: 999, padding: '5px 9px', background: 'white', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#334155', fontSize: 11, fontWeight: 700 },
  legendDot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  pieLayout: { display: 'flex', alignItems: 'center', minHeight: 420 },
  pieLegend: { flex: 1, display: 'grid', gap: 8, paddingRight: 20 },
  pieLegendLine: { display: 'grid', gridTemplateColumns: '10px 1fr auto', alignItems: 'center', gap: 8, fontSize: 12 },
  tableScroll: { overflow: 'auto', maxHeight: 580, border: '1px solid #E2E8F0', borderRadius: 10 },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 },
  th: { position: 'sticky', top: 0, zIndex: 3, background: '#17365D', color: 'white', padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid #EDF2F7', whiteSpace: 'nowrap', backgroundColor: 'white' },
  stickyHead: { left: 0, zIndex: 5 },
  stickyCell: { position: 'sticky', left: 0, zIndex: 2, boxShadow: '2px 0 4px rgba(15,23,42,.05)' },
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
