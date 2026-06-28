'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type DocType = 'Devis' | 'CDC' | 'BL' | 'Factures'
type ViewMode = 'montant_ht' | 'nb_documents' | 'quantite_pertinente'

type DailyRow = {
  jour: string
  type_document: DocType | string
  agence: string | null
  collaborateur: string | null
  depot: string | null
  depot_bucket: 'FMS' | 'AUTRES' | string | null
  famille_macro: string | null
  hors_statistique?: boolean | null
  nb_documents: number
  nb_lignes: number
  montant_ht: number
  quantite_brute: number
  quantite_pertinente: number
}

type HighlightRow = {
  date_document: string
  type_document: DocType | string
  numero_document: string | null
  numero_tiers: string | null
  intitule_tiers: string | null
  agence: string | null
  collaborateur: string | null
  depot: string | null
  depot_bucket: string | null
  famille_macro: string | null
  montant_ht: number
  quantite_brute: number
  quantite_pertinente: number
  nb_lignes: number
  source_table: string | null
  hors_statistique?: boolean | null
}

type KpiCardData = {
  type: DocType
  nb: number
  amount: number
  qtyPert: number
  fmsPct?: number
  topAgence: string
  topFamille: string
  evolutionVsMtdPct: number | null
  evolutionVs7dPct: number | null
}

type BusinessDayBasis = {
  count: number
  blDaysCount: number
  fallbackWeekdaysCount: number
  calendarDaysCount: number
  label: string
}

const DOC_TYPES: DocType[] = ['Devis', 'CDC', 'BL', 'Factures']
const DOC_COLORS: Record<DocType, string> = {
  Devis: '#d59b00',
  CDC: '#006d7f',
  BL: '#4c9dff',
  Factures: '#16a34a',
}

const REPORT_BUCKET = 'commercial-imports'
const REPORT_PATH = 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'
const REPORT_FILENAME = "Rapport d'activité quotidien.pdf"

function isViewMode(value: string | null | undefined): value is ViewMode {
  return value === 'montant_ht' || value === 'nb_documents' || value === 'quantite_pertinente'
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysYmd(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthStart(month: string) {
  return `${month}-01`
}

function nextMonthStart(month: string) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

function isWeekendYmd(ymd: string) {
  const day = new Date(`${ymd}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function countWeekdays(days: string[]) {
  return days.filter((day) => !isWeekendYmd(day)).length
}

function formatDateFr(ymd: string | null | undefined) {
  if (!ymd) return '—'
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(ymd)
  return `${m[3]}/${m[2]}/${m[1]}`
}

function formatMonthFr(month: string | null | undefined) {
  if (!month) return '—'
  const m = String(month).match(/^(\d{4})-(\d{2})$/)
  if (!m) return String(month)
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  const label = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatShortDate(ymd: string) {
  const m = ymd.match(/^\d{4}-(\d{2})-(\d{2})/)
  return m ? `${m[2]}/${m[1]}` : ymd
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value || 0)
  const abs = Math.abs(n)
  if (abs >= 1000000) return `${(n / 1000000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`
  if (abs >= 1000) return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} K€`
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
}

function formatNumber(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((acc, row) => acc + Number(selector(row) || 0), 0)
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T[]>()
  rows.forEach((row) => {
    const key = keyFn(row) || '—'
    const current = map.get(key) || []
    current.push(row)
    map.set(key, current)
  })
  return map
}

function valueOf(row: DailyRow, mode: ViewMode) {
  if (mode === 'nb_documents') return Number(row.nb_documents || 0)
  if (mode === 'quantite_pertinente') return Number(row.quantite_pertinente || 0)
  return Number(row.montant_ht || 0)
}

function labelForMode(mode: ViewMode) {
  if (mode === 'nb_documents') return 'Nombre documents'
  if (mode === 'quantite_pertinente') return 'Quantité pertinente'
  return 'Montant HT'
}

function displayValue(value: number, mode: ViewMode) {
  if (mode === 'montant_ht') return formatMoney(value)
  return formatNumber(value)
}

function kpiValue(card: KpiCardData, mode: ViewMode) {
  if (mode === 'nb_documents') return card.nb
  if (mode === 'quantite_pertinente') return card.qtyPert
  return card.amount
}

function getTopLabel(rows: DailyRow[], dimension: 'agence' | 'famille_macro') {
  const grouped = groupBy(rows, (r) => String((r as any)[dimension] || '—'))
  const ranked = Array.from(grouped.entries())
    .map(([label, items]) => ({ label, amount: Math.abs(sum(items, (r) => r.montant_ht)) }))
    .sort((a, b) => b.amount - a.amount)
  return ranked[0]?.label || '—'
}

function buildEvolution(dayValue: number, baseValue: number) {
  if (!baseValue) return null
  return ((dayValue - baseValue) / Math.abs(baseValue)) * 100
}

function getBusinessDayBasis(rows: DailyRow[], periodDays: string[]): BusinessDayBasis {
  const blActiveDays = new Set(
    rows
      .filter((row) => row.type_document === 'BL' && periodDays.includes(row.jour) && Number(row.nb_documents || 0) > 0)
      .map((row) => row.jour)
  )

  const fallbackWeekdaysCount = countWeekdays(periodDays)
  const count = Math.max(1, blActiveDays.size || fallbackWeekdaysCount || periodDays.length)

  return {
    count,
    blDaysCount: blActiveDays.size,
    fallbackWeekdaysCount,
    calendarDaysCount: periodDays.length,
    label: blActiveDays.size
      ? `${blActiveDays.size} jour(s) avec BL créé(s)`
      : `${fallbackWeekdaysCount || periodDays.length} jour(s) ouvré(s) estimé(s)`,
  }
}

function pickDefaultFocusDate() {
  const yesterday = addDaysYmd(todayYmd(), -1)
  return yesterday
}

function SparkLine({ values, color }: { values: number[]; color: string }) {
  const width = 190
  const height = 34
  const absMax = Math.max(1, ...values.map((v) => Math.abs(v)))
  const points = values.map((v, i) => {
    const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * width
    const y = height - ((v / absMax) * (height - 6) + 3)
    return `${x},${y}`
  })

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="2.4" points={points.join(' ')} />
    </svg>
  )
}

function MultiLineChart({ days, rows, mode, title }: { days: string[]; rows: DailyRow[]; mode: ViewMode; title?: string }) {
  const width = 920
  const height = 260
  const padLeft = 52
  const padRight = 12
  const padTop = 18
  const padBottom = 34
  const [hoverPoint, setHoverPoint] = useState<{
    xPct: number
    yPct: number
    type: DocType
    day: string
    value: number
  } | null>(null)

  const byTypeDay = new Map<string, number>()
  rows.forEach((row) => {
    const key = `${row.type_document}__${row.jour}`
    byTypeDay.set(key, (byTypeDay.get(key) || 0) + valueOf(row, mode))
  })

  const values = DOC_TYPES.flatMap((type) => days.map((day) => byTypeDay.get(`${type}__${day}`) || 0))
  const max = Math.max(1, ...values.map((v) => Math.abs(v)))
  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const xFor = (index: number) => padLeft + (days.length <= 1 ? 0 : (index / (days.length - 1)) * plotW)
  const yFor = (value: number) => padTop + plotH - (Math.max(0, value) / max) * plotH

  return (
    <div style={styles.chartBox} onMouseLeave={() => setHoverPoint(null)}>
      <div style={styles.chartTitle}>{title || `Flux journalier — ${labelForMode(mode)}`}</div>
      <svg viewBox={`0 0 ${width} ${height}`} style={styles.chartSvg} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + plotH * t
          return <line key={t} x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
        })}
        {DOC_TYPES.map((type) => {
          const points = days.map((day, index) => {
            const v = byTypeDay.get(`${type}__${day}`) || 0
            return `${xFor(index)},${yFor(v)}`
          })
          return (
            <polyline
              key={type}
              fill="none"
              stroke={DOC_COLORS[type]}
              strokeWidth="3"
              points={points.join(' ')}
            />
          )
        })}
        {DOC_TYPES.flatMap((type) => days.map((day, index) => {
          const value = byTypeDay.get(`${type}__${day}`) || 0
          const x = xFor(index)
          const y = yFor(value)
          return (
            <circle
              key={`${type}-${day}`}
              cx={x}
              cy={y}
              r="7"
              fill={DOC_COLORS[type]}
              opacity={hoverPoint?.type === type && hoverPoint?.day === day ? 0.9 : 0.04}
              stroke={DOC_COLORS[type]}
              strokeWidth="1"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHoverPoint({
                xPct: (x / width) * 100,
                yPct: (y / height) * 100,
                type,
                day,
                value,
              })}
              onMouseMove={() => setHoverPoint({
                xPct: (x / width) * 100,
                yPct: (y / height) * 100,
                type,
                day,
                value,
              })}
            />
          )
        }))}
        {days.map((day, index) => {
          if (index % Math.ceil(days.length / 8) !== 0 && index !== days.length - 1) return null
          return (
            <text key={day} x={xFor(index)} y={height - 10} textAnchor="middle" fontSize="11" fill="#475569">
              {day.slice(-2)}
            </text>
          )
        })}
        <text x="8" y="22" fontSize="11" fill="#475569">{displayValue(max, mode)}</text>
      </svg>
      {hoverPoint && (
        <div
          style={{
            ...styles.chartTooltip,
            left: `min(calc(${hoverPoint.xPct}% + 10px), calc(100% - 230px))`,
            top: `max(calc(${hoverPoint.yPct}% - 24px), 44px)`,
            borderColor: DOC_COLORS[hoverPoint.type],
          }}
        >
          <div style={{ ...styles.tooltipDoc, color: DOC_COLORS[hoverPoint.type] }}>{hoverPoint.type}</div>
          <div>{formatDateFr(hoverPoint.day)}</div>
          <div style={styles.tooltipValue}>{displayValue(hoverPoint.value, mode)}</div>
        </div>
      )}
      <div style={styles.legendRow}>
        {DOC_TYPES.map((type) => (
          <span key={type} style={styles.legendItem}><span style={{ ...styles.legendDot, background: DOC_COLORS[type] }} />{type}</span>
        ))}
      </div>
    </div>
  )
}

function CumulativeChart({ days, rows, mode }: { days: string[]; rows: DailyRow[]; mode: ViewMode }) {
  const cumulativeRows: DailyRow[] = []
  DOC_TYPES.forEach((type) => {
    let running = 0
    days.forEach((day) => {
      running += sum(rows.filter((r) => r.type_document === type && r.jour === day), (r) => valueOf(r, mode))
      cumulativeRows.push({
        jour: day,
        type_document: type,
        agence: 'Cumul',
        collaborateur: '',
        depot: '',
        depot_bucket: '',
        famille_macro: 'Cumul',
        nb_documents: mode === 'nb_documents' ? running : 0,
        nb_lignes: 0,
        montant_ht: mode === 'montant_ht' ? running : 0,
        quantite_brute: 0,
        quantite_pertinente: mode === 'quantite_pertinente' ? running : 0,
      })
    })
  })

  return <MultiLineChart days={days} rows={cumulativeRows} mode={mode} title={`Cumul mensuel — ${labelForMode(mode)}`} />
}

function KpiCard({ card, mode, basisLabel }: { card: KpiCardData; mode: ViewMode; basisLabel: string }) {
  const color = DOC_COLORS[card.type]
  const mainValue = displayValue(kpiValue(card, mode), mode)
  const isUp = (card.evolutionVsMtdPct || 0) >= 0

  return (
    <div style={styles.kpiCard}>
      <div style={styles.kpiHeader}>
        <span style={{ ...styles.docPill, background: `${color}22`, color }}>{card.type}</span>
        <span style={{ ...styles.evoPill, background: isUp ? '#dcfce7' : '#fee2e2', color: isUp ? '#047857' : '#b91c1c' }}>
          {card.evolutionVsMtdPct === null ? 'vs moy. mensuelle —' : `vs moy. mensuelle ${isUp ? '▲' : '▼'} ${formatPct(card.evolutionVsMtdPct)}`}
        </span>
      </div>
      <div style={styles.kpiMain}>{mainValue}</div>
      <div style={styles.kpiSub}>{formatNumber(card.nb)} document(s) · {formatMoney(card.amount)}</div>
      {card.type === 'BL' && (
        <div style={styles.kpiSub}>Part dépôt FMS : <b>{card.fmsPct === undefined ? '—' : `${card.fmsPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`}</b></div>
      )}
      <div style={styles.kpiMeta}>Agence dominante : <b>{card.topAgence}</b></div>
      <div style={styles.kpiMeta}>Famille dominante : <b>{card.topFamille}</b></div>
      <div style={styles.kpiMeta}>Base moyenne mensuelle : <b>{basisLabel}</b></div>
      <div style={styles.kpiMeta}>vs moyenne 7 jours ouvrés : <b>{formatPct(card.evolutionVs7dPct)}</b></div>
    </div>
  )
}

function Table({ children }: { children: React.ReactNode }) {
  return <div style={styles.tableWrap}><table style={styles.table}>{children}</table></div>
}

function HighlightTable({ title, rows }: { title: string; rows: HighlightRow[] }) {
  return (
    <div style={styles.sectionCard}>
      <div style={styles.sectionTitle}>{title}</div>
      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>N° doc</th>
            <th style={styles.th}>Client</th>
            <th style={styles.th}>Agence</th>
            <th style={styles.th}>Famille</th>
            <th style={styles.thRight}>Montant HT</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} style={styles.emptyCell}>Aucun document sur la période.</td></tr>
          ) : rows.map((row, idx) => (
            <tr key={`${title}-${row.type_document}-${row.numero_document}-${idx}`}>
              <td style={styles.td}>{formatDateFr(row.date_document)}</td>
              <td style={styles.td}><span style={{ ...styles.smallDocPill, color: DOC_COLORS[row.type_document as DocType] || '#0f172a' }}>{row.type_document}</span></td>
              <td style={styles.tdStrong}>{row.numero_document || '—'}</td>
              <td style={styles.td}>{row.intitule_tiers || row.numero_tiers || '—'}</td>
              <td style={styles.td}>{row.agence || '—'}</td>
              <td style={styles.td}>{row.famille_macro || '—'}</td>
              <td style={styles.tdRight}>{formatMoney(row.montant_ht)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

function FocusMensuelPageContent() {
  const searchParams = useSearchParams()
  const isPdfMode = searchParams?.get('pdf') === '1' || searchParams?.get('print') === '1'
  const requestedMonth = searchParams?.get('month')
  const requestedFocusDate = searchParams?.get('focusDate') || searchParams?.get('focus_date')
  const requestedHorsStats = searchParams?.get('horsStatistiques') || searchParams?.get('hors_statistiques')
  const requestedView = searchParams?.get('view')
  const requestedAgence = searchParams?.get('agence') || ''
  const requestedFamilleMacro = searchParams?.get('familleMacro') || searchParams?.get('famille_macro') || ''
  const requestedCollaborateur = searchParams?.get('collaborateur') || ''
  const currentMonth = /^\d{4}-\d{2}$/.test(String(requestedMonth || '')) ? String(requestedMonth) : todayYmd().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [focusDate, setFocusDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(String(requestedFocusDate || '')) ? String(requestedFocusDate) : pickDefaultFocusDate())
  const [viewMode, setViewMode] = useState<ViewMode>(isViewMode(requestedView) ? requestedView : 'montant_ht')
  const [agence, setAgence] = useState(requestedAgence)
  const [familleMacro, setFamilleMacro] = useState(requestedFamilleMacro)
  const [collaborateur, setCollaborateur] = useState(requestedCollaborateur)
  const [includeHorsStats, setIncludeHorsStats] = useState(isPdfMode || ['afficher', 'show', 'true', '1'].includes(String(requestedHorsStats || '').toLowerCase()))
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([])
  const [highlightRows, setHighlightRows] = useState<HighlightRow[]>([])
  const [loading, setLoading] = useState(false)
  const [rebuildingCache, setRebuildingCache] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportEmailTo, setReportEmailTo] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [reportMessage, setReportMessage] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [lastGeneratedPdfPath, setLastGeneratedPdfPath] = useState(REPORT_PATH)

  const days = useMemo(() => daysInMonth(month), [month])
  const monthBegin = useMemo(() => monthStart(month), [month])
  const monthEnd = useMemo(() => nextMonthStart(month), [month])

  const normalizedRows = useMemo(() => dailyRows.map((row) => ({
    ...row,
    nb_documents: Number(row.nb_documents || 0),
    nb_lignes: Number(row.nb_lignes || 0),
    montant_ht: Number(row.montant_ht || 0),
    quantite_brute: Number(row.quantite_brute || 0),
    quantite_pertinente: Number(row.quantite_pertinente || 0),
  })), [dailyRows])

  const filteredFocusRows = useMemo(() => normalizedRows.filter((row) => row.jour === focusDate), [normalizedRows, focusDate])

  const availableAgences = useMemo(() => Array.from(new Set(normalizedRows.map((r) => r.agence || '').filter(Boolean))).sort(), [normalizedRows])
  const availableFamilies = useMemo(() => Array.from(new Set(normalizedRows.map((r) => r.famille_macro || '').filter(Boolean))).sort(), [normalizedRows])
  const availableCollaborateurs = useMemo(() => Array.from(new Set(normalizedRows.map((r) => r.collaborateur || '').filter(Boolean))).sort(), [normalizedRows])

  const elapsedMonthDays = useMemo(() => days.filter((day) => day <= focusDate), [days, focusDate])

  const businessDayBasis = useMemo(() => {
    return getBusinessDayBasis(normalizedRows, elapsedMonthDays)
  }, [normalizedRows, elapsedMonthDays])

  const kpiCards = useMemo<KpiCardData[]>(() => {
    return DOC_TYPES.map((type) => {
      const dayRows = filteredFocusRows.filter((r) => r.type_document === type)
      const monthRowsBeforeFocus = normalizedRows.filter((r) => r.type_document === type && r.jour <= focusDate)
      const last7Start = addDaysYmd(focusDate, -6)
      const last7Rows = normalizedRows.filter((r) => r.type_document === type && r.jour >= last7Start && r.jour <= focusDate)

      const amount = sum(dayRows, (r) => r.montant_ht)
      const qtyPert = sum(dayRows, (r) => r.quantite_pertinente)
      const nb = sum(dayRows, (r) => r.nb_documents)
      const last7PeriodDays = days.filter((d) => d >= last7Start && d <= focusDate)
      const last7Basis = getBusinessDayBasis(normalizedRows, last7PeriodDays)
      const selectedDayValue = modeValueFromComponents({ amount, nb, qtyPert }, viewMode)
      const mtdAvg = modeValueFromRows(monthRowsBeforeFocus, viewMode) / businessDayBasis.count
      const last7Avg = modeValueFromRows(last7Rows, viewMode) / last7Basis.count
      const blFmsAmount = sum(dayRows.filter((r) => r.depot_bucket === 'FMS'), (r) => Math.abs(r.montant_ht))
      const blTotalAmount = sum(dayRows, (r) => Math.abs(r.montant_ht))

      return {
        type,
        nb,
        amount,
        qtyPert,
        fmsPct: type === 'BL' && blTotalAmount ? (blFmsAmount / blTotalAmount) * 100 : undefined,
        topAgence: getTopLabel(dayRows, 'agence'),
        topFamille: getTopLabel(dayRows, 'famille_macro'),
        evolutionVsMtdPct: buildEvolution(selectedDayValue, mtdAvg),
        evolutionVs7dPct: buildEvolution(selectedDayValue, last7Avg),
      }
    })
  }, [filteredFocusRows, normalizedRows, focusDate, days, viewMode, businessDayBasis])

  const byAgencyRows = useMemo(() => aggregateMatrix(filteredFocusRows, (r) => r.agence || 'Sans agence'), [filteredFocusRows])
  const byFamilyRows = useMemo(() => aggregateMatrix(filteredFocusRows, (r) => r.famille_macro || 'AUTRES'), [filteredFocusRows])
  const mtdSourceRows = useMemo(() => normalizedRows.filter((row) => row.jour <= focusDate), [normalizedRows, focusDate])
  const byAgencyMtdRows = useMemo(() => aggregateMatrix(mtdSourceRows, (r) => r.agence || 'Sans agence'), [mtdSourceRows])

  const mtdRows = useMemo(() => {
    return DOC_TYPES.map((type) => {
      const rows = normalizedRows.filter((r) => r.type_document === type && r.jour <= focusDate)
      return {
        type,
        cumulAmount: sum(rows, (r) => r.montant_ht),
        cumulNb: sum(rows, (r) => r.nb_documents),
        cumulQty: sum(rows, (r) => r.quantite_pertinente),
        avgAmount: sum(rows, (r) => r.montant_ht) / businessDayBasis.count,
        avgNb: sum(rows, (r) => r.nb_documents) / businessDayBasis.count,
        avgQty: sum(rows, (r) => r.quantite_pertinente) / businessDayBasis.count,
      }
    })
  }, [normalizedRows, focusDate, businessDayBasis])

  const highlights = useMemo(() => {
    const sorted = [...highlightRows].map((row) => ({ ...row, montant_ht: Number(row.montant_ht || 0) }))
    const topDevis = sorted.filter((r) => r.type_document === 'Devis').sort((a, b) => Math.abs(b.montant_ht) - Math.abs(a.montant_ht)).slice(0, 20)
    const topCdc = sorted.filter((r) => r.type_document === 'CDC').sort((a, b) => Math.abs(b.montant_ht) - Math.abs(a.montant_ht)).slice(0, 20)
    const topDocs = sorted.filter((r) => ['BL', 'CDC', 'Factures'].includes(String(r.type_document))).sort((a, b) => Math.abs(b.montant_ht) - Math.abs(a.montant_ht)).slice(0, 20)
    return { topDevis, topCdc, topDocs }
  }, [highlightRows])

  useEffect(() => {
    if (!focusDate.startsWith(month)) {
      const candidate = month === currentMonth ? pickDefaultFocusDate() : `${month}-${String(Math.min(new Date(`${month}-01T12:00:00`).getDate(), 1)).padStart(2, '0')}`
      setFocusDate(candidate.startsWith(month) ? candidate : `${month}-01`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, agence, familleMacro, collaborateur, includeHorsStats])

  useEffect(() => {
    void loadHighlights()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDate, agence, familleMacro, collaborateur, includeHorsStats])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user?.email || ''
      if (email) setReportEmailTo((current) => current || email)
    })()
  }, [])

  function buildReportPayload() {
    return {
      bucket: REPORT_BUCKET,
      path: REPORT_PATH,
      filename: REPORT_FILENAME,
      month,
      focus_date: focusDate,
      hors_statistiques: includeHorsStats ? 'afficher' : 'masquer',
      view: viewMode,
      agence: agence || null,
      famille_macro: familleMacro || null,
      collaborateur: collaborateur || null,
    }
  }

  async function getSessionAccessToken() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    const token = data.session?.access_token
    if (!token) throw new Error('Session utilisateur absente : reconnecte-toi puis réessaie.')
    return token
  }

  async function generateFocusPdf() {
    setPdfLoading(true)
    setReportError(null)
    setReportMessage(null)

    try {
      const token = await getSessionAccessToken()
      const response = await fetch('/api/reports/focus-mensuel-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildReportPayload()),
      })

      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Génération PDF impossible (${response.status})`)
      }

      setLastGeneratedPdfPath(result.path || REPORT_PATH)
      setReportMessage(
        `PDF généré : ${result.path || REPORT_PATH}${result.bytes ? ` · ${(Number(result.bytes) / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko` : ''}`
      )
      return result
    } catch (exception: any) {
      setReportError(exception?.message || String(exception))
      throw exception
    } finally {
      setPdfLoading(false)
    }
  }

  async function sendFocusReportEmail() {
    const recipients = reportEmailTo.trim()
    if (!recipients) {
      setReportError('Renseigne au moins une adresse email destinataire.')
      return
    }

    setEmailLoading(true)
    setReportError(null)
    setReportMessage(null)

    try {
      const token = await getSessionAccessToken()
      const response = await fetch('/api/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: recipients,
          subject: `Rapport activité quotidienne - ${formatDateFr(focusDate)}`,
          html: `
            <p>Bonjour,</p>
            <p>Tu trouveras en pièce jointe le rapport d'activité quotidien généré depuis l'écran Focus Mensuel.</p>
            <p><strong>Périmètre :</strong> ${formatMonthFr(month)} · focus ${formatDateFr(focusDate)} · ${labelForMode(viewMode)}</p>
            <p>Cordialement,</p>
          `,
          text: `Rapport d'activité quotidien - ${formatDateFr(focusDate)}\nPérimètre : ${formatMonthFr(month)} · ${labelForMode(viewMode)}`,
          attachments: [
            {
              bucket: REPORT_BUCKET,
              path: lastGeneratedPdfPath || REPORT_PATH,
              filename: REPORT_FILENAME,
              contentType: 'application/pdf',
            },
          ],
          tags: [
            { name: 'category', value: 'focus_mensuel' },
            { name: 'document', value: 'rapport_activite_quotidien' },
          ],
        }),
      })

      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.ok) {
        const resendMessage = result?.resend_response?.message || result?.resend_response?.error || ''
        throw new Error(result?.error ? `${result.error}${resendMessage ? ` : ${resendMessage}` : ''}` : `Envoi email impossible (${response.status})`)
      }

      setReportMessage(`Email envoyé à ${Array.isArray(result.to) ? result.to.join(', ') : recipients}`)
    } catch (exception: any) {
      setReportError(exception?.message || String(exception))
    } finally {
      setEmailLoading(false)
    }
  }


  async function rebuildCacheForMonth() {
    const ok = window.confirm(
      `Reconstruire le cache Focus mensuel pour ${month} ?\n\n` +
      `Cette opération peut prendre quelques dizaines de secondes, mais ensuite la page se chargera rapidement.`
    )
    if (!ok) return

    setRebuildingCache(true)
    setCacheInfo(null)
    setError(null)

    try {
      const { data, error } = await supabase.rpc('rebuild_indicateur_focus_journalier_periode', {
        p_date_debut: monthBegin,
        p_date_fin: monthEnd,
      })

      if (error) throw error

      const row = Array.isArray(data) ? data[0] : data
      const message =
        `Cache reconstruit : ${Number(row?.inserted_documents || 0).toLocaleString('fr-FR')} documents, ` +
        `${Number(row?.inserted_summary || 0).toLocaleString('fr-FR')} lignes de synthèse.`

      setCacheInfo(message)
      await loadData()
      await loadHighlights()
    } catch (exception: any) {
      console.error('rebuild focus mensuel cache', exception)
      setError(
        (exception?.message || String(exception)) +
          "\nSi le rebuild timeoute côté front, lance la même fonction depuis Supabase SQL Editor."
      )
    } finally {
      setRebuildingCache(false)
    }
  }

  async function loadData() {
    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.rpc('get_focus_mensuel_daily_summary', {
        p_date_debut: monthBegin,
        p_date_fin: monthEnd,
        p_agence: agence || null,
        p_famille_macro: familleMacro || null,
        p_collaborateur: collaborateur || null,
        p_include_hors_statistiques: includeHorsStats,
      })

      if (error) throw error
      setDailyRows((data || []) as DailyRow[])
    } catch (exception: any) {
      console.error('focus mensuel daily summary', exception)
      setError(exception?.message || String(exception))
      setDailyRows([])
    } finally {
      setLoading(false)
    }
  }

  async function loadHighlights() {
    const start7 = addDaysYmd(focusDate, -6)
    const endExclusive = addDaysYmd(focusDate, 1)

    try {
      const { data, error } = await supabase.rpc('get_focus_mensuel_highlights', {
        p_date_debut: start7,
        p_date_fin: endExclusive,
        p_limit: 500,
        p_agence: agence || null,
        p_famille_macro: familleMacro || null,
        p_collaborateur: collaborateur || null,
        p_include_hors_statistiques: includeHorsStats,
      })

      if (error) throw error
      setHighlightRows((data || []) as HighlightRow[])
    } catch (exception: any) {
      console.error('focus mensuel highlights', exception)
      setHighlightRows([])
    }
  }

  return (
    <section
      style={styles.page}
      data-focus-report-ready={!loading && !rebuildingCache ? '1' : '0'}
      data-focus-report-mode={isPdfMode ? '1' : '0'}
    >
      {isPdfMode && (
        <style>{`
          @page { size: A4 portrait; margin: 6mm 4mm 6mm 4mm; }
          html, body { margin: 0 !important; padding: 0 !important; background: #eef5fb !important; }
          body, * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          [data-focus-report-ready] { width: 100% !important; box-sizing: border-box !important; }
          [data-no-print="true"] { display: none !important; }
        `}</style>
      )}
      <div style={styles.headerCard}>
        <div>
          <h1 style={styles.title}>ACTIVITE CEGECLIM DU : <span style={styles.titleDate}>{formatDateFr(focusDate)}</span></h1>
          <div style={styles.subtitle}>

            <span style={styles.subtitleBasisNote}>
              Moyennes mensuelles sur {businessDayBasis.label} jusqu’au {formatDateFr(focusDate)}
              {businessDayBasis.blDaysCount > 0
                ? ', jours sans BL exclus'
                : ', faute de BL détecté dans le périmètre filtré'}
              
            </span>{' '}
            <span style={styles.focusDayText}>Focus journée du : {formatDateFr(focusDate)}</span>
            {' '}· faits marquants sur 7 jours calendaires.
          </div>
        </div>
        <div style={styles.headerActions} data-no-print="true">
          <button style={styles.secondaryButton} onClick={() => setFocusDate(todayYmd())}>Aujourd’hui</button>
          <button style={styles.secondaryButton} onClick={() => setFocusDate(addDaysYmd(todayYmd(), -1))}>Hier</button>
          <button style={styles.warningButton} onClick={rebuildCacheForMonth} disabled={rebuildingCache}>
            {rebuildingCache ? 'Rebuild cache…' : 'Reconstruire cache mois'}
          </button>
          <button style={styles.primaryButton} onClick={() => { void loadData(); void loadHighlights() }}>Actualiser</button>
        </div>
      </div>

      <div style={styles.filtersCard}>
        <div style={styles.field}><label style={styles.label}>Mois analysé</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={styles.input} /></div>
        <div style={styles.field}><label style={styles.label}>Jour focus</label><input type="date" value={focusDate} onChange={(e) => setFocusDate(e.target.value)} style={styles.input} /></div>
        <div style={styles.field}><label style={styles.label}>Vue</label><select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)} style={styles.input}><option value="montant_ht">Montant HT</option><option value="nb_documents">Nombre documents</option><option value="quantite_pertinente">Quantité pertinente</option></select></div>
        <div style={styles.field}><label style={styles.label}>Agence</label><select value={agence} onChange={(e) => setAgence(e.target.value)} style={styles.input}><option value="">Toutes</option>{availableAgences.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
        <div style={styles.field}><label style={styles.label}>Famille macro</label><select value={familleMacro} onChange={(e) => setFamilleMacro(e.target.value)} style={styles.input}><option value="">Toutes</option>{availableFamilies.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
        <div style={styles.field}><label style={styles.label}>Collaborateur</label><select value={collaborateur} onChange={(e) => setCollaborateur(e.target.value)} style={styles.input}><option value="">Tous</option>{availableCollaborateurs.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div style={styles.field}><label style={styles.label}>Hors statistiques</label><select value={includeHorsStats ? 'show' : 'hide'} onChange={(e) => setIncludeHorsStats(e.target.value === 'show')} style={styles.input}><option value="hide">Masquer</option><option value="show">Afficher</option></select></div>
      </div>

      {!isPdfMode && (
        <div style={styles.reportCard} data-no-print="true">
          <div style={styles.reportHeader}>
            <div>
              <div style={styles.reportTitle}>Rapport PDF & email</div>
              <div style={styles.reportSubtitle}>
                Génère le PDF avec les filtres courants, le stocke dans <b>{REPORT_BUCKET}/{REPORT_PATH}</b>, puis l'envoie via la route email générique.
              </div>
            </div>
            <div style={styles.reportActions}>
              <button
                type="button"
                onClick={generateFocusPdf}
                disabled={pdfLoading || emailLoading}
                style={styles.secondaryButton}
              >
                {pdfLoading ? 'Génération PDF…' : 'Générer PDF'}
              </button>
              <button
                type="button"
                onClick={sendFocusReportEmail}
                disabled={pdfLoading || emailLoading}
                style={styles.primaryButton}
              >
                {emailLoading ? 'Envoi email…' : 'Envoyer PDF par email'}
              </button>
            </div>
          </div>

          <div style={styles.reportFormRow}>
            <div style={styles.reportField}>
              <label style={styles.label}>Destinataires</label>
              <input
                value={reportEmailTo}
                onChange={(event) => setReportEmailTo(event.target.value)}
                placeholder="adresse1@domaine.fr; adresse2@domaine.fr"
                style={styles.reportInput}
              />
            </div>
            <div style={styles.reportPathBox}>
              <span style={styles.reportPathLabel}>PDF stocké</span>
              <span style={styles.reportPathText}>{lastGeneratedPdfPath}</span>
            </div>
          </div>

          {reportMessage && <div style={styles.successBox}>{reportMessage}</div>}
          {reportError && <div style={styles.errorBox}>Erreur rapport : {reportError}</div>}
        </div>
      )}

      {error && <div style={styles.errorBox}>Erreur chargement focus mensuel : {error}</div>}
      {cacheInfo && <div style={styles.successBox}>{cacheInfo}</div>}
      {loading && <div style={styles.infoBox}>Chargement des données journalières depuis le cache…</div>}
      {rebuildingCache && <div style={styles.infoBox}>Reconstruction du cache mensuel en cours…</div>}
      <div style={styles.kpiGrid}>
        {kpiCards.map((card) => <KpiCard key={card.type} card={card} mode={viewMode} basisLabel={businessDayBasis.label} />)}
      </div>

      <div style={styles.chartGrid}>
        <MultiLineChart days={days} rows={normalizedRows} mode={viewMode} />
        <CumulativeChart days={days} rows={normalizedRows} mode={viewMode} />
      </div>

      <div style={styles.sectionGrid}>
        <div style={styles.sectionCard}>
          <div style={styles.sectionTitle}>Perspective MTD au {formatDateFr(focusDate)} — base {businessDayBasis.label}</div>
          <Table>
            <thead>
              <tr>
                <th style={styles.th}>Document</th>
                <th style={styles.thRight}>Cumul €</th>
                <th style={styles.thRight}>Cumul docs</th>
                <th style={styles.thRight}>Cumul qté pert.</th>
                <th style={styles.thRight}>Moy. €/jour ouvré</th>
                <th style={styles.thRight}>Moy. docs/jour ouvré</th>
              </tr>
            </thead>
            <tbody>
              {mtdRows.map((row) => (
                <tr key={row.type}>
                  <td style={styles.tdStrong}><span style={{ ...styles.smallDocPill, color: DOC_COLORS[row.type] }}>{row.type}</span></td>
                  <td style={styles.tdRight}>{formatMoney(row.cumulAmount)}</td>
                  <td style={styles.tdRight}>{formatNumber(row.cumulNb)}</td>
                  <td style={styles.tdRight}>{formatNumber(row.cumulQty)}</td>
                  <td style={styles.tdRight}>{formatMoney(row.avgAmount)}</td>
                  <td style={styles.tdRight}>{row.avgNb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <SummaryMatrix title={`Jour focus par famille macro — ${formatDateFr(focusDate)}`} rows={byFamilyRows} />
      </div>

      <div style={styles.sectionGrid}>
        <SummaryMatrix title={`Jour focus par agence — ${formatDateFr(focusDate)}`} rows={byAgencyRows} />
        <SummaryMatrix title={`Depuis début du mois par agence — au ${formatDateFr(focusDate)}`} rows={byAgencyMtdRows} />
      </div>

      <div style={styles.highlightsGrid}>
        <HighlightTable title="Top 20 devis créés — 7 derniers jours" rows={highlights.topDevis} />
        <HighlightTable title="Top 20 commandes CDC — 7 derniers jours" rows={highlights.topCdc} />
        <HighlightTable title="Top 20 documents BL / CDC / Factures — 7 derniers jours" rows={highlights.topDocs} />
      </div>
    </section>
  )
}

function modeValueFromComponents(values: { amount: number; nb: number; qtyPert: number }, mode: ViewMode) {
  if (mode === 'nb_documents') return values.nb
  if (mode === 'quantite_pertinente') return values.qtyPert
  return values.amount
}

function modeValueFromRows(rows: DailyRow[], mode: ViewMode) {
  return sum(rows, (r) => valueOf(r, mode))
}

function aggregateMatrix(rows: DailyRow[], labelFn: (row: DailyRow) => string) {
  const grouped = groupBy(rows, labelFn)
  return Array.from(grouped.entries()).map(([label, items]) => {
    const byType = Object.fromEntries(DOC_TYPES.map((type) => {
      const typeRows = items.filter((r) => r.type_document === type)
      return [type, {
        amount: sum(typeRows, (r) => r.montant_ht),
        nb: sum(typeRows, (r) => r.nb_documents),
      }]
    })) as Record<DocType, { amount: number; nb: number }>
    return { label, byType, total: sum(items, (r) => r.montant_ht) }
  }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
}

function SummaryMatrix({ title, rows }: { title: string; rows: ReturnType<typeof aggregateMatrix> }) {
  return (
    <div style={styles.sectionCard}>
      <div style={styles.sectionTitle}>{title}</div>
      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Dimension</th>
            {DOC_TYPES.map((type) => <th key={type} style={styles.thRight}>{type} docs</th>)}
            {DOC_TYPES.map((type) => <th key={`${type}-amount`} style={styles.thRight}>{type} €</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={9} style={styles.emptyCell}>Aucune donnée sur le jour focus.</td></tr> : rows.map((row) => (
            <tr key={row.label}>
              <td style={styles.tdStrong}>{row.label}</td>
              {DOC_TYPES.map((type) => <td key={type} style={styles.tdRight}>{formatNumber(row.byType[type].nb)}</td>)}
              {DOC_TYPES.map((type) => <td key={`${type}-amount`} style={{ ...styles.tdRight, color: DOC_COLORS[type], fontWeight: 900 }}>{formatMoney(row.byType[type].amount)}</td>)}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 20, color: '#0f172a' },
  headerCard: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', background: 'rgba(255,255,255,0.92)', border: '1px solid #e2e8f0', borderRadius: 22, padding: 18, boxShadow: '0 10px 28px rgba(15,23,42,0.06)', marginBottom: 14 },
  title: { margin: 0, fontSize: 26, fontWeight: 900 },
  titleDate: { color: '#dc2626', fontWeight: 950 },
  subtitle: { marginTop: 6, color: '#64748b', fontSize: 14, fontWeight: 700, lineHeight: 1.45 },
  subtitleBasisNote: { color: '#64748b', fontSize: 12, fontWeight: 700 },
  focusDayText: { color: '#0f172a', fontSize: 15, fontWeight: 950 },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },
  filtersCard: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(150px, 1fr))', gap: 12, background: 'rgba(248,250,252,0.96)', border: '1px solid #e2e8f0', borderRadius: 18, padding: 14, marginBottom: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 12, fontWeight: 900, color: '#475569', textTransform: 'uppercase' },
  input: { border: '1px solid #cbd5e1', borderRadius: 10, padding: '9px 10px', background: '#fff', fontWeight: 800, minWidth: 0 },
  warningButton: {
    border: '1px solid #d97706',
    background: '#f59e0b',
    color: '#111827',
    borderRadius: 12,
    padding: '10px 14px',
    fontWeight: 900,
    cursor: 'pointer',
  },

  primaryButton: { border: '1px solid #0f172a', background: '#0f172a', color: '#fff', borderRadius: 10, padding: '9px 13px', fontWeight: 900, cursor: 'pointer' },
  secondaryButton: { border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', borderRadius: 10, padding: '9px 13px', fontWeight: 900, cursor: 'pointer' },
  successBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: '#dcfce7',
    border: '1px solid #86efac',
    color: '#166534',
    fontWeight: 800,
  },

  errorBox: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 14, padding: 12, marginBottom: 12, fontWeight: 900 },
  infoBox: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 14, padding: 12, marginBottom: 12, fontWeight: 900 },
  neutralBox: { background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, marginBottom: 12, fontWeight: 800 },
  reportCard: { background: 'rgba(255,255,255,0.96)', border: '1px solid #dbeafe', borderRadius: 18, padding: 14, marginBottom: 14, boxShadow: '0 8px 22px rgba(15,23,42,0.06)' },
  reportHeader: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', marginBottom: 12 },
  reportTitle: { fontSize: 16, fontWeight: 950, color: '#0f172a', marginBottom: 4 },
  reportSubtitle: { fontSize: 12, fontWeight: 750, color: '#64748b', lineHeight: 1.45 },
  reportActions: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  reportFormRow: { display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 12, alignItems: 'end' },
  reportField: { display: 'flex', flexDirection: 'column', gap: 5 },
  reportInput: { border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', background: '#fff', fontWeight: 800, minWidth: 0, width: '100%', boxSizing: 'border-box' },
  reportPathBox: { border: '1px solid #e2e8f0', borderRadius: 12, padding: '9px 11px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  reportPathLabel: { fontSize: 11, fontWeight: 950, color: '#64748b', textTransform: 'uppercase' },
  reportPathText: { fontSize: 12, fontWeight: 850, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 14, marginBottom: 14 },
  kpiCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 14, boxShadow: '0 8px 22px rgba(15,23,42,0.06)' },
  kpiHeader: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 },
  docPill: { borderRadius: 999, padding: '5px 9px', fontWeight: 900, fontSize: 12 },
  smallDocPill: { fontWeight: 900 },
  evoPill: { borderRadius: 999, padding: '5px 8px', fontWeight: 900, fontSize: 12 },
  kpiMain: { fontSize: 26, fontWeight: 950, marginBottom: 4 },
  kpiSub: { fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 4 },
  kpiMeta: { fontSize: 12, color: '#64748b', marginTop: 5 },
  chartGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 },
  chartBox: { position: 'relative', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 14, boxShadow: '0 8px 22px rgba(15,23,42,0.06)', minWidth: 0 },
  chartTitle: { fontSize: 15, fontWeight: 900, marginBottom: 8 },
  chartSvg: { width: '100%', height: 260, display: 'block' },

  chartTooltip: {
    position: 'absolute',
    zIndex: 20,
    minWidth: 190,
    pointerEvents: 'none',
    background: 'rgba(255,255,255,0.98)',
    border: '2px solid #0f172a',
    borderRadius: 12,
    padding: '8px 10px',
    boxShadow: '0 14px 32px rgba(15,23,42,0.18)',
    fontSize: 12,
    fontWeight: 800,
    color: '#0f172a',
  },
  tooltipDoc: {
    fontSize: 12,
    fontWeight: 950,
    marginBottom: 3,
  },
  tooltipValue: {
    fontSize: 15,
    fontWeight: 950,
    marginTop: 3,
  },
  legendRow: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  legendItem: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 900, color: '#475569' },
  legendDot: { width: 10, height: 10, borderRadius: '50%' },
  sectionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 },
  highlightsGrid: { display: 'grid', gridTemplateColumns: '1fr', gap: 14 },
  sectionCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 18, padding: 14, boxShadow: '0 8px 22px rgba(15,23,42,0.06)', minWidth: 0 },
  sectionTitle: { fontSize: 16, fontWeight: 950, marginBottom: 10 },
  tableWrap: { overflow: 'auto', maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 },
  th: { background: '#f1f5f9', color: '#0f172a', borderBottom: '1px solid #e2e8f0', padding: '8px 9px', textAlign: 'left', fontWeight: 950, whiteSpace: 'nowrap' },
  thRight: { background: '#f1f5f9', color: '#0f172a', borderBottom: '1px solid #e2e8f0', padding: '8px 9px', textAlign: 'right', fontWeight: 950, whiteSpace: 'nowrap' },
  td: { borderBottom: '1px solid #f1f5f9', padding: '7px 9px', color: '#0f172a', whiteSpace: 'nowrap' },
  tdStrong: { borderBottom: '1px solid #f1f5f9', padding: '7px 9px', color: '#0f172a', fontWeight: 900, whiteSpace: 'nowrap' },
  tdRight: { borderBottom: '1px solid #f1f5f9', padding: '7px 9px', textAlign: 'right', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap' },
  emptyCell: { padding: 18, textAlign: 'center', color: '#64748b', fontWeight: 900 },
}


export default function FocusMensuelPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Chargement du focus mensuel…</div>}>
      <FocusMensuelPageContent />
    </Suspense>
  )
}
