'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '@/lib/supabaseClient'

type DataSource = 'factures' | 'activite' | 'mixte'
type WidgetType = 'kpi' | 'histogramme' | 'histogramme_empile' | 'courbe' | 'bridge' | 'tableau' | 'camembert'
type MeasureKey = 'ca_ht' | 'marge_valeur' | 'marge_pct' | 'quantite' | 'nb_lignes'
type DimensionKey =
  | 'annee'
  | 'mois'
  | 'type_document'
  | 'agence_collaborateur'
  | 'collaborateur'
  | 'famille_macro'
  | 'famille'
  | 'intitule_tiers'
  | 'numero_tiers'
  | 'source'

type SizeKey = 'small' | 'medium' | 'large' | 'full'
type SortMode = 'label_asc' | 'value_desc' | 'value_asc'
type EvolutionMode = 'none' | 'value' | 'percent' | 'both'
type CompareMode = 'year' | 'month' | 'dimension'
type PeriodMode = 'mois' | 'cumul'

type StudioRow = {
  source: Exclude<DataSource, 'mixte'>
  annee: number
  mois: number
  type_document: string
  collaborateur: string
  agence_collaborateur: string
  numero_tiers: string
  intitule_tiers: string
  famille: string
  famille_macro: string
  hors_statistique: boolean
  nb_lignes: number
  quantite: number
  ca_ht: number
  marge_valeur: number
}

type GlobalFilters = {
  sources: DataSource[]
  years: number[]
  months: number[]
  agences: string[]
  collaborateurs: string[]
  famillesMacro: string[]
  typesDocument: string[]
  horsStatistique: 'non' | 'oui' | 'tous'
}

type WidgetFilters = Partial<{
  years: number[]
  months: number[]
  agences: string[]
  collaborateurs: string[]
  famillesMacro: string[]
  typesDocument: string[]
  horsStatistique: 'non' | 'oui' | 'tous'
}>

type WidgetConfig = {
  id: string
  type: WidgetType
  title: string
  source: DataSource
  size: SizeKey
  useGlobalFilters: boolean
  localFilters: WidgetFilters
  measure: MeasureKey
  secondMeasure?: MeasureKey
  tableMeasures?: MeasureKey[]
  dimension: DimensionKey
  seriesDimension?: DimensionKey | ''
  rowDimension: DimensionKey
  rowDimension2?: DimensionKey | ''
  columnDimension: DimensionKey
  columnDimension2?: DimensionKey | ''
  periodMode: PeriodMode
  bridgeMonth: number
  yearN?: number
  yearN1?: number
  compareMode: CompareMode
  compareDimension?: DimensionKey | ''
  compareValue?: string
  evolutionMode: EvolutionMode
  stacked100: boolean
  topN: number
  sortMode: SortMode
  showValues: boolean
}

type SavedView = {
  id: string
  name: string
  description?: string | null
  global_filters: GlobalFilters
  widgets: WidgetConfig[]
  updated_at?: string | null
}

type AggregatedValue = {
  ca_ht: number
  marge_valeur: number
  quantite: number
  nb_lignes: number
}

type ChartDatum = {
  label: string
  __total: number
  value: number
  [key: string]: string | number | undefined
}

const FACTURES_TABLE = 'indicateur_factures_mensuel'
const ACTIVITE_TABLE = 'indicateur_activite_mensuel'
const VIEW_TABLE = 'analyse_widget_views'

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

const COLOR_N = '#16a34a'
const COLOR_N1 = '#64748b'
const COLOR_N2 = '#f59e0b'
const COLOR_BLUE = '#2563eb'
const COLOR_RED = '#ef4444'
const COLOR_POSITIVE = '#22c55e'
const COLOR_NEGATIVE = '#ef4444'
const COLOR_TOTAL = '#0f172a'
const COLOR_BRIDGE_TOTAL = '#bfdbfe'
const PALETTE = ['#2563eb', '#64748b', '#f59e0b', '#16a34a', '#9333ea', '#ef4444', '#0ea5e9', '#84cc16']

const MEASURES: Array<{ key: MeasureKey; label: string; kind: 'currency' | 'percent' | 'number' }> = [
  { key: 'ca_ht', label: 'CA HT', kind: 'currency' },
  { key: 'marge_valeur', label: 'Marge €', kind: 'currency' },
  { key: 'marge_pct', label: 'Marge %', kind: 'percent' },
  { key: 'quantite', label: 'Quantité', kind: 'number' },
  { key: 'nb_lignes', label: 'Nb lignes', kind: 'number' },
]

const DIMENSIONS: Array<{ key: DimensionKey; label: string }> = [
  { key: 'annee', label: 'Année' },
  { key: 'mois', label: 'Mois' },
  { key: 'source', label: 'Source' },
  { key: 'type_document', label: 'Type document' },
  { key: 'agence_collaborateur', label: 'Agence' },
  { key: 'collaborateur', label: 'Collaborateur' },
  { key: 'famille_macro', label: 'Famille macro' },
  { key: 'famille', label: 'Famille' },
  { key: 'intitule_tiers', label: 'Tiers' },
  { key: 'numero_tiers', label: 'Code tiers' },
]

const DEFAULT_FILTERS: GlobalFilters = {
  sources: ['factures'],
  years: [],
  months: [],
  agences: [],
  collaborateurs: [],
  famillesMacro: [],
  typesDocument: [],
  horsStatistique: 'non',
}

function uid(prefix = 'w') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function safeText(value: any, fallback = 'NON RENSEIGNE') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function safeBool(value: any) {
  return value === true || String(value).toLowerCase() === 'true'
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1).replace('.', ',')} %`
}

function formatMeasure(value: number, measure: MeasureKey) {
  const config = MEASURES.find((m) => m.key === measure)
  if (config?.kind === 'currency') return formatCurrency(value)
  if (config?.kind === 'percent') return formatRate(value)
  return formatNumber(value)
}

function getMeasureLabel(measure: MeasureKey) {
  return MEASURES.find((m) => m.key === measure)?.label || measure
}

function getDimensionLabel(dimension: DimensionKey) {
  return DIMENSIONS.find((d) => d.key === dimension)?.label || dimension
}

function shortLabel(value: string) {
  const clean = String(value || '').trim()
  if (!clean) return ''
  if (clean === 'NON RENSEIGNE') return 'NR'
  return clean.slice(0, 3).toUpperCase()
}

function monthLabel(month: number) {
  return MONTHS[Math.max(0, Math.min(11, month - 1))] || String(month)
}

function normalizeAggRow(row: Record<string, any>, source: Exclude<DataSource, 'mixte'>): StudioRow {
  const annee = safeNumber(row.annee || row.year || row.exercice)
  const mois = safeNumber(row.mois || row.month)
  return {
    source,
    annee,
    mois,
    type_document: source === 'factures' ? 'FACTURE' : safeText(row.type_document, 'NON RENSEIGNE'),
    collaborateur: safeText(row.collaborateur, 'NON AFFECTE'),
    agence_collaborateur: safeText(row.agence_collaborateur || row.agence, 'NON AFFECTE'),
    numero_tiers: safeText(row.numero_tiers || row.code_tiers, 'NON RENSEIGNE'),
    intitule_tiers: safeText(row.intitule_tiers || row.tiers, 'NON RENSEIGNE'),
    famille: safeText(row.famille, 'NON RENSEIGNE'),
    famille_macro: safeText(row.famille_macro, 'NON RENSEIGNE'),
    hors_statistique: safeBool(row.hors_statistique),
    nb_lignes: safeNumber(row.nb_lignes),
    quantite: safeNumber(row.quantite),
    ca_ht: safeNumber(row.ca_ht),
    marge_valeur: safeNumber(row.marge_valeur),
  }
}

async function fetchAllRows(tableName: string, source: Exclude<DataSource, 'mixte'>, chunkSize = 1000) {
  const rows: StudioRow[] = []
  let from = 0
  while (true) {
    const to = from + chunkSize - 1
    const { data, error } = await supabase.from(tableName).select('*').range(from, to)
    if (error) throw error
    const chunk = data || []
    rows.push(...chunk.map((row) => normalizeAggRow(row, source)))
    if (chunk.length < chunkSize) break
    from += chunkSize
  }
  return rows.filter((r) => r.annee && r.mois)
}

function uniqueSorted<T extends string | number>(values: T[]) {
  return Array.from(new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== ''))).sort((a: any, b: any) =>
    String(a).localeCompare(String(b), 'fr', { numeric: true })
  ) as T[]
}

function getDimensionValue(row: StudioRow, dimension: DimensionKey): string {
  if (dimension === 'annee') return String(row.annee)
  if (dimension === 'mois') return monthLabel(row.mois)
  if (dimension === 'source') return row.source === 'factures' ? 'Factures' : 'Activité'
  return safeText((row as any)[dimension], 'NON RENSEIGNE')
}

function getCompositeDimensionValue(row: StudioRow, dim1: DimensionKey, dim2?: DimensionKey | ''): string {
  const first = getDimensionValue(row, dim1)
  if (!dim2) return first
  const second = getDimensionValue(row, dim2)
  return `${first} › ${second}`
}

function evolutionText(current: number, previous: number, mode: EvolutionMode, measure: MeasureKey) {
  if (mode === 'none') return null
  const delta = current - previous
  const pct = previous ? (delta / Math.abs(previous)) * 100 : null
  if (mode === 'value') return formatMeasure(delta, measure)
  if (mode === 'percent') return pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %`
  return `${formatMeasure(delta, measure)} / ${pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %`}`
}

function evolutionClass(current: number, previous: number) {
  const delta = current - previous
  if (!previous && !delta) return 'text-slate-400 bg-slate-100'
  return delta >= 0 ? 'text-emerald-700 bg-emerald-100' : 'text-red-700 bg-red-100'
}

function emptyAgg(): AggregatedValue {
  return { ca_ht: 0, marge_valeur: 0, quantite: 0, nb_lignes: 0 }
}

function addToAgg(target: AggregatedValue, row: StudioRow) {
  target.ca_ht += row.ca_ht
  target.marge_valeur += row.marge_valeur
  target.quantite += row.quantite
  target.nb_lignes += row.nb_lignes
}

function measureValue(agg: AggregatedValue, measure: MeasureKey) {
  if (measure === 'marge_pct') return agg.ca_ht ? (agg.marge_valeur / agg.ca_ht) * 100 : 0
  return agg[measure]
}

function applyGlobalFilters(rows: StudioRow[], filters: GlobalFilters) {
  return rows.filter((row) => {
    if (filters.sources.length) {
      const sourceOk = filters.sources.includes('mixte') || filters.sources.includes(row.source)
      if (!sourceOk) return false
    }
    if (filters.years.length && !filters.years.includes(row.annee)) return false
    if (filters.months.length && !filters.months.includes(row.mois)) return false
    if (filters.agences.length && !filters.agences.includes(row.agence_collaborateur)) return false
    if (filters.collaborateurs.length && !filters.collaborateurs.includes(row.collaborateur)) return false
    if (filters.famillesMacro.length && !filters.famillesMacro.includes(row.famille_macro)) return false
    if (filters.typesDocument.length && !filters.typesDocument.includes(row.type_document)) return false
    if (filters.horsStatistique === 'non' && row.hors_statistique) return false
    if (filters.horsStatistique === 'oui' && !row.hors_statistique) return false
    return true
  })
}

function applyWidgetFilters(rows: StudioRow[], widget: WidgetConfig, globalFilters: GlobalFilters) {
  let filtered = rows
  if (widget.useGlobalFilters) filtered = applyGlobalFilters(filtered, globalFilters)

  filtered = filtered.filter((row) => {
    if (widget.source !== 'mixte' && row.source !== widget.source) return false
    const lf = widget.localFilters
    if (lf.years?.length && !lf.years.includes(row.annee)) return false
    if (lf.months?.length && !lf.months.includes(row.mois)) return false
    if (lf.agences?.length && !lf.agences.includes(row.agence_collaborateur)) return false
    if (lf.collaborateurs?.length && !lf.collaborateurs.includes(row.collaborateur)) return false
    if (lf.famillesMacro?.length && !lf.famillesMacro.includes(row.famille_macro)) return false
    if (lf.typesDocument?.length && !lf.typesDocument.includes(row.type_document)) return false
    if (lf.horsStatistique === 'non' && row.hors_statistique) return false
    if (lf.horsStatistique === 'oui' && !row.hors_statistique) return false
    return true
  })

  return filtered
}

function aggregateTotal(rows: StudioRow[]) {
  const agg = emptyAgg()
  rows.forEach((row) => addToAgg(agg, row))
  return agg
}

function sortItems<T extends { label: string; value: number }>(items: T[], sortMode: SortMode) {
  const copy = [...items]
  if (sortMode === 'value_desc') copy.sort((a, b) => b.value - a.value)
  else if (sortMode === 'value_asc') copy.sort((a, b) => a.value - b.value)
  else copy.sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }))
  return copy
}

function buildDefaultWidget(type: WidgetType, availableYears: number[]): WidgetConfig {
  const yearN = availableYears[0] || CURRENT_YEAR
  const yearN1 = availableYears.find((y) => y < yearN) || yearN - 1
  const base: WidgetConfig = {
    id: uid(),
    type,
    title: type === 'bridge' ? 'Bridge CA N-1 ⇒ N par agence' : type === 'tableau' ? 'Tableau croisé' : type === 'kpi' ? 'Indicateur clé' : type === 'histogramme_empile' ? 'Histogramme empilé' : type === 'camembert' ? 'Répartition' : 'Nouveau graphique',
    source: 'factures',
    size: type === 'kpi' || type === 'histogramme_empile' ? 'small' : type === 'tableau' ? 'full' : type === 'camembert' ? 'medium' : 'medium',
    useGlobalFilters: true,
    localFilters: {},
    measure: type === 'bridge' ? 'ca_ht' : 'ca_ht',
    secondMeasure: 'ca_ht',
    tableMeasures: ['ca_ht', 'marge_valeur'],
    dimension: type === 'bridge' ? 'agence_collaborateur' : 'mois',
    seriesDimension: type === 'histogramme' || type === 'histogramme_empile' || type === 'courbe' ? 'annee' : '',
    rowDimension: 'agence_collaborateur',
    rowDimension2: '',
    columnDimension: 'mois',
    columnDimension2: '',
    periodMode: 'cumul',
    bridgeMonth: Math.max(1, Math.min(12, CURRENT_MONTH)),
    yearN,
    yearN1,
    compareMode: 'year',
    compareDimension: '',
    compareValue: '',
    evolutionMode: 'percent',
    stacked100: type === 'histogramme_empile',
    topN: 12,
    sortMode: 'value_desc',
    showValues: true,
  }
  if (type === 'courbe') base.title = 'Courbe cumulée'
  if (type === 'histogramme') base.title = 'Histogramme CA par mois'
  if (type === 'histogramme_empile') { base.title = 'CA empilé par année / famille'; base.dimension = 'annee'; base.seriesDimension = 'famille_macro' }
  if (type === 'camembert') { base.title = 'Répartition par famille macro'; base.dimension = 'famille_macro'; base.seriesDimension = '' }
  return base
}

function MultiSelect({
  label,
  values,
  selected,
  onChange,
}: {
  label: string
  values: string[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filteredValues = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return values
    return values.filter((value) => value.toLowerCase().includes(s))
  }, [values, search])

  function toggle(value: string) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
      >
        <span className="truncate">{label} {selected.length ? `(${selected.length})` : ''}</span>
        <span className="text-slate-400">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-800">{label}</div>
            <button type="button" onClick={() => onChange([])} className="text-xs font-bold text-blue-600 hover:text-blue-800">Tout afficher</button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher"
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {filteredValues.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
                <span className="truncate">{value}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string | number; onChange: (v: string) => void; options: Array<{ value: string | number; label: string }> }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-blue-500"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function WidgetShell({
  widget,
  selected,
  onSelect,
  onRemove,
  onDuplicate,
  onMove,
  children,
}: {
  widget: WidgetConfig
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  children: ReactNode
  key?: string
}) {
  const sizeClass = widget.size === 'small' ? 'xl:col-span-1' : widget.size === 'medium' ? 'xl:col-span-2' : widget.size === 'large' ? 'xl:col-span-3' : 'xl:col-span-4'
  return (
    <section
      onClick={onSelect}
      className={`${sizeClass} rounded-2xl border bg-white p-4 shadow-sm transition ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">{widget.title}</h3>
          <p className="text-xs text-slate-500">{widget.source === 'mixte' ? 'Factures + activité' : widget.source === 'factures' ? 'Factures' : 'Activité'} · {getMeasureLabel(widget.measure)}</p>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onMove(-1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold hover:bg-slate-50">↑</button>
          <button type="button" onClick={() => onMove(1)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold hover:bg-slate-50">↓</button>
          <button type="button" onClick={onDuplicate} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold hover:bg-slate-50">Dupliquer</button>
          <button type="button" onClick={onRemove} className="rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50">Suppr.</button>
        </div>
      </div>
      {children}
    </section>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="mb-2 font-black text-slate-900">{label}</div>
      <div className="space-y-1">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-5">
            <span>{entry.name}</span>
            <span className="font-black">{typeof entry.value === 'number' && entry.name?.includes('%') ? formatRate(entry.value) : formatNumber(Number(entry.value || 0))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KpiWidget({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  let latestYear = CURRENT_YEAR
  for (const row of rows) if (row.annee > latestYear) latestYear = row.annee
  const selectedYear = widget.yearN || latestYear
  const previousYear = widget.yearN1 || selectedYear - 1
  const monthLimit = widget.bridgeMonth || CURRENT_MONTH
  const inPeriod = (row: StudioRow) => widget.periodMode === 'cumul' ? row.mois <= monthLimit : row.mois === monthLimit

  let currentRows = rows.filter((r) => r.annee === selectedYear && inPeriod(r))
  let previousRows = rows.filter((r) => r.annee === previousYear && inPeriod(r))

  if (widget.compareMode === 'dimension' && widget.compareDimension && widget.compareValue) {
    currentRows = rows.filter((r) => r.annee === selectedYear && inPeriod(r))
    previousRows = rows.filter((r) => getDimensionValue(r, widget.compareDimension as DimensionKey) === widget.compareValue && inPeriod(r))
  }

  const currentAgg = aggregateTotal(currentRows.length ? currentRows : rows.filter((r) => r.annee === selectedYear))
  const previousAgg = aggregateTotal(previousRows)
  const value = measureValue(currentAgg, widget.measure)
  const previousValue = measureValue(previousAgg, widget.secondMeasure || widget.measure)
  const evo = evolutionText(value, previousValue, widget.evolutionMode, widget.measure)
  const periodText = widget.periodMode === 'cumul' ? `01-${String(monthLimit).padStart(2, '0')}` : monthLabel(monthLimit)

  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">{getMeasureLabel(widget.measure)}</div>
        <div className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500">{periodText}</div>
      </div>
      <div className="mt-2 text-3xl font-black text-slate-900">{formatMeasure(value, widget.measure)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>{widget.compareMode === 'dimension' ? `vs ${getDimensionLabel(widget.compareDimension as DimensionKey)} ${widget.compareValue || ''}` : `vs ${previousYear} · même période`}</span>
        {evo && <span className={`rounded-full px-2 py-1 ${evolutionClass(value, previousValue)}`}>{evo}</span>}
      </div>
      <div className="mt-1 text-xs text-slate-500">Base comparaison : {formatMeasure(previousValue, widget.secondMeasure || widget.measure)}</div>
    </div>
  )
}


function StackedValueLabel(props: any) {
  const { x, y, width, height, value, dataKey, measure, stacked100 } = props
  const num = Number(value || 0)
  if (!Number.isFinite(num) || Math.abs(num) < 0.1 || width < 26 || height < 14) return null
  const label = stacked100 ? `${shortLabel(String(dataKey))} ${num.toFixed(0)}%` : `${shortLabel(String(dataKey))} ${Math.round(num / 1000)}k€`
  return (
    <text x={Number(x) + Number(width) / 2} y={Number(y) + Number(height) / 2 + 3} textAnchor="middle" fontSize={9} fontWeight={800} fill="#0f172a">
      {measure === 'marge_pct' && !stacked100 ? `${shortLabel(String(dataKey))} ${num.toFixed(0)}%` : label}
    </text>
  )
}

function ChartWidget({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  const chartData = useMemo(() => {
    const xMap = new Map<string, Map<string, AggregatedValue>>()
    const seriesKey = widget.seriesDimension || ''
    rows.forEach((row) => {
      const xLabel = getDimensionValue(row, widget.dimension)
      const sLabel = seriesKey ? getDimensionValue(row, seriesKey as DimensionKey) : getMeasureLabel(widget.measure)
      if (!xMap.has(xLabel)) xMap.set(xLabel, new Map())
      const sMap = xMap.get(xLabel)!
      if (!sMap.has(sLabel)) sMap.set(sLabel, emptyAgg())
      addToAgg(sMap.get(sLabel)!, row)
    })

    const items: ChartDatum[] = Array.from(xMap.entries()).map(([label, sMap]) => {
      const result: ChartDatum = { label, __total: 0, value: 0 }
      let total = 0
      Array.from(sMap.entries()).forEach(([series, agg]) => {
        const value = measureValue(agg, widget.measure)
        result[series] = value
        total += value
      })
      result.__total = total
      result.value = total
      return result
    })

    let sorted: ChartDatum[]
    if (widget.dimension === 'mois') {
      sorted = [...items].sort((a, b) => MONTHS.indexOf(a.label) - MONTHS.indexOf(b.label))
    } else {
      sorted = sortItems(items, widget.sortMode)
    }
    const limited = sorted.slice(0, Math.max(1, widget.topN || 12))
    if (widget.type === 'histogramme_empile' && widget.stacked100) {
      return limited.map((row) => {
        const total = Object.keys(row).filter((key) => key !== 'label' && key !== '__total' && key !== 'value').reduce((sum, key) => sum + Number(row[key] || 0), 0)
        const next: ChartDatum = { ...row }
        Object.keys(next).forEach((key) => {
          if (key !== 'label' && key !== '__total' && key !== 'value') next[key] = total ? (Number(next[key] || 0) / total) * 100 : 0
        })
        next.value = 100
        return next
      })
    }
    return limited
  }, [rows, widget])

  const seriesNames = useMemo(() => {
    const names = new Set<string>()
    chartData.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (key !== 'label' && key !== '__total' && key !== 'value') names.add(key)
      })
    })
    const result = Array.from(names)
    if (widget.seriesDimension === 'annee') result.sort((a, b) => Number(a) - Number(b))
    else result.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    return result
  }, [chartData, widget.seriesDimension])

  if (!chartData.length) return <div className="rounded-xl bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">Aucune donnée avec les filtres sélectionnés.</div>

  if (widget.type === 'courbe') {
    return (
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => widget.measure === 'marge_pct' ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {seriesNames.map((series, index) => (
              <Line key={series} type="monotone" dataKey={series} name={series} stroke={PALETTE[index % PALETTE.length]} strokeWidth={3} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={chartData.length > 8 ? -25 : 0} textAnchor={chartData.length > 8 ? 'end' : 'middle'} height={chartData.length > 8 ? 65 : 35} />
          <YAxis tickFormatter={(v) => widget.stacked100 || widget.measure === 'marge_pct' ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k`} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {seriesNames.map((series, index) => (
            <Bar
              key={series}
              dataKey={series}
              name={series}
              stackId={widget.type === 'histogramme_empile' ? 'stack' : undefined}
              maxBarSize={widget.type === 'histogramme_empile' ? 42 : undefined}
              fill={series === String(widget.yearN) ? COLOR_N : series === String(widget.yearN1) ? COLOR_N1 : PALETTE[index % PALETTE.length]}
            >
              {widget.type === 'histogramme_empile' && widget.showValues && (
                <LabelList dataKey={series} content={(props: any) => <StackedValueLabel {...props} dataKey={series} measure={widget.measure} stacked100={widget.stacked100} />} />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function BridgeWidget({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  const bridgeData = useMemo(() => {
    const yearN = widget.yearN || CURRENT_YEAR
    const yearN1 = widget.yearN1 || yearN - 1
    const monthLimit = widget.bridgeMonth || CURRENT_MONTH
    const inPeriod = (row: StudioRow) => widget.periodMode === 'cumul' ? row.mois <= monthLimit : row.mois === monthLimit
    const currentRows = rows.filter((row) => row.annee === yearN && inPeriod(row))
    const previousRows = rows.filter((row) => row.annee === yearN1 && inPeriod(row))
    const currentTotal = measureValue(aggregateTotal(currentRows), widget.measure)
    const previousTotal = measureValue(aggregateTotal(previousRows), widget.measure)

    const dimKeys = new Set<string>()
    currentRows.forEach((row) => dimKeys.add(getDimensionValue(row, widget.dimension)))
    previousRows.forEach((row) => dimKeys.add(getDimensionValue(row, widget.dimension)))

    const items = Array.from(dimKeys).map((label) => {
      const cur = aggregateTotal(currentRows.filter((row) => getDimensionValue(row, widget.dimension) === label))
      const prev = aggregateTotal(previousRows.filter((row) => getDimensionValue(row, widget.dimension) === label))
      const current = measureValue(cur, widget.measure)
      const previous = measureValue(prev, widget.measure)
      return { label, current, previous, delta: current - previous, value: Math.abs(current - previous) }
    })

    const sorted = sortItems(items, 'value_desc').slice(0, Math.max(1, widget.topN || 12))
    return { yearN, yearN1, monthLimit, previousTotal, currentTotal, items: sorted }
  }, [rows, widget])

  const waterfallData = useMemo(() => {
    let cursor = bridgeData.previousTotal
    const points: Array<Record<string, any>> = [
      {
        name: `${getMeasureLabel(widget.measure)} ${bridgeData.yearN1}`,
        base: 0,
        value: bridgeData.previousTotal,
        label: formatMeasure(bridgeData.previousTotal, widget.measure),
        fill: COLOR_BRIDGE_TOTAL,
        isTotal: true,
      },
    ]

    bridgeData.items.forEach((item) => {
      const next = cursor + item.delta
      points.push({
        name: item.label,
        base: Math.min(cursor, next),
        value: Math.abs(item.delta),
        label: `${item.delta >= 0 ? '+' : ''}${formatMeasure(item.delta, widget.measure)}`,
        fill: item.delta >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE,
      })
      cursor = next
    })

    points.push({
      name: `${getMeasureLabel(widget.measure)} ${bridgeData.yearN}`,
      base: 0,
      value: bridgeData.currentTotal,
      label: formatMeasure(bridgeData.currentTotal, widget.measure),
      fill: COLOR_BRIDGE_TOTAL,
      isTotal: true,
    })
    return points
  }, [bridgeData, widget.measure])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span className="rounded-full bg-slate-100 px-3 py-1">{widget.periodMode === 'cumul' ? `01-${String(bridgeData.monthLimit).padStart(2, '0')}` : monthLabel(bridgeData.monthLimit)}</span>
        <span>Départ {bridgeData.yearN1} → Arrivée {bridgeData.yearN}</span>
        {widget.measure === 'marge_pct' && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">Marge % : écarts en points par dimension</span>}
      </div>
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={waterfallData} margin={{ top: 25, right: 20, left: 10, bottom: 55 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 10 }} height={75} />
            <YAxis tickFormatter={(v) => widget.measure === 'marge_pct' ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip content={<BridgeTooltip measure={widget.measure} />} />
            <Bar dataKey="base" stackId="a" fill="#ffffff" fillOpacity={0} />
            <Bar dataKey="value" stackId="a">
              <LabelList dataKey="label" position="top" style={{ fontSize: 10, fontWeight: 800, fill: '#0f172a' }} />
              {waterfallData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function BridgeTooltip({ active, payload, label, measure }: any) {
  if (!active || !payload?.length) return null

  const valueItem = payload.find((item: any) => item?.dataKey === 'value')
  const row = valueItem?.payload || payload[0]?.payload || {}
  const rawValue = Number(row.value || 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-xl">
      <div className="mb-1 font-black text-slate-900">{row.name || label}</div>
      <div className="text-slate-600">
        {row.label || formatMeasure(rawValue, measure)}
      </div>
    </div>
  )
}

function PivotTableWidget({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  const [sortCell, setSortCell] = useState<{ column: string; measure: MeasureKey | 'total'; dir: 'asc' | 'desc' } | null>(null)
  const measures = widget.tableMeasures?.length ? widget.tableMeasures : [widget.measure]
  const yearN = widget.yearN || CURRENT_YEAR
  const yearN1 = widget.yearN1 || yearN - 1
  const monthLimit = widget.bridgeMonth || CURRENT_MONTH
  const inSelectedPeriod = (row: StudioRow) => widget.periodMode === 'cumul' ? row.mois <= monthLimit : row.mois === monthLimit
  const currentPeriodRows = rows.filter((row) => row.annee === yearN && inSelectedPeriod(row))
  const previousPeriodRows = rows.filter((row) => row.annee === yearN1 && inSelectedPeriod(row))

  function toggleSort(column: string, measure: MeasureKey | 'total') {
    setSortCell((prev) => {
      if (prev?.column === column && prev.measure === measure) return { column, measure, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { column, measure, dir: 'desc' }
    })
  }

  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, AggregatedValue>>()
    rows.forEach((row) => {
      const rowLabel = getCompositeDimensionValue(row, widget.rowDimension, widget.rowDimension2)
      const colLabel = getCompositeDimensionValue(row, widget.columnDimension, widget.columnDimension2)
      if (!map.has(rowLabel)) map.set(rowLabel, new Map())
      const colMap = map.get(rowLabel)!
      if (!colMap.has(colLabel)) colMap.set(colLabel, emptyAgg())
      addToAgg(colMap.get(colLabel)!, row)
    })

    const allCols = new Set<string>()
    map.forEach((colMap) => colMap.forEach((_value, col) => allCols.add(col)))
    let columns = Array.from(allCols)
    if (widget.columnDimension === 'mois') columns = columns.sort((a, b) => MONTHS.indexOf(a.split(' › ')[0]) - MONTHS.indexOf(b.split(' › ')[0]))
    else columns = columns.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    columns = columns.slice(0, 18)

    const rowItems = Array.from(map.entries()).map(([label, colMap]) => {
      const total = emptyAgg()
      const totalPrev = emptyAgg()

      currentPeriodRows
        .filter((r) => getCompositeDimensionValue(r, widget.rowDimension, widget.rowDimension2) === label)
        .forEach((r) => addToAgg(total, r))

      previousPeriodRows
        .filter((r) => getCompositeDimensionValue(r, widget.rowDimension, widget.rowDimension2) === label)
        .forEach((r) => addToAgg(totalPrev, r))

      return { label, colMap, value: measureValue(total, widget.measure), total, totalPrev }
    })

    const sortedRows = [...rowItems]
    if (sortCell) {
      sortedRows.sort((a, b) => {
        const aggA = sortCell.column === '__total__' ? a.total : a.colMap.get(sortCell.column) || emptyAgg()
        const aggB = sortCell.column === '__total__' ? b.total : b.colMap.get(sortCell.column) || emptyAgg()
        const measure = sortCell.measure === 'total' ? widget.measure : sortCell.measure
        const va = measureValue(aggA, measure)
        const vb = measureValue(aggB, measure)
        return sortCell.dir === 'asc' ? va - vb : vb - va
      })
    } else {
      sortedRows.sort((a, b) => {
        if (widget.sortMode === 'value_desc') return b.value - a.value
        if (widget.sortMode === 'value_asc') return a.value - b.value
        return a.label.localeCompare(b.label, 'fr', { numeric: true })
      })
    }

    return {
      columns,
      rows: sortedRows.slice(0, Math.max(1, widget.topN || 25)),
    }
  }, [rows, widget, sortCell, measures, currentPeriodRows, previousPeriodRows])

  function comparisonColumnLabel(column: string) {
    if (widget.columnDimension === 'annee' || widget.columnDimension2 === 'annee') {
      return column.replace(new RegExp(`\\b${yearN}\\b`, 'g'), String(yearN1))
    }
    return column
  }

  function comparisonValue(rowLabel: string, column: string, measure: MeasureKey) {
    if (widget.evolutionMode === 'none') return 0
    const prevAgg = emptyAgg()
    const prevColumn = comparisonColumnLabel(column)
    previousPeriodRows
      .filter((r) => getCompositeDimensionValue(r, widget.rowDimension, widget.rowDimension2) === rowLabel)
      .filter((r) => getCompositeDimensionValue(r, widget.columnDimension, widget.columnDimension2) === prevColumn)
      .forEach((r) => addToAgg(prevAgg, r))
    return measureValue(prevAgg, measure)
  }

  function totalComparisonValue(rowLabel: string, measure: MeasureKey) {
    if (widget.evolutionMode === 'none') return 0
    const prevAgg = emptyAgg()
    previousPeriodRows
      .filter((r) => getCompositeDimensionValue(r, widget.rowDimension, widget.rowDimension2) === rowLabel)
      .forEach((r) => addToAgg(prevAgg, r))
    return measureValue(prevAgg, measure)
  }

  function CellValue({ value, previous, measure }: { value: number; previous: number; measure: MeasureKey }) {
    return (
      <div className="min-w-[92px]">
        <div className="font-bold text-slate-900">{formatMeasure(value, measure)}</div>
        {widget.evolutionMode !== 'none' && (
          <div className={`mt-1 inline-flex rounded px-2 py-0.5 text-[10px] font-black ${evolutionClass(value, previous)}`}>
            {evolutionText(value, previous, widget.evolutionMode, measure)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-auto rounded-xl border border-slate-200">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100">
            <th rowSpan={2} className="sticky left-0 z-20 border border-slate-200 bg-slate-100 px-3 py-2 text-left font-black">
              {`${getDimensionLabel(widget.rowDimension)}${widget.rowDimension2 ? ' / ' + getDimensionLabel(widget.rowDimension2) : ''}`}
            </th>
            <th colSpan={measures.length} className="border border-slate-200 bg-slate-200 px-3 py-2 text-center font-black">TOTAL {widget.periodMode === 'cumul' ? `01-${String(monthLimit).padStart(2, '0')}` : monthLabel(monthLimit)} {yearN}</th>
            {pivot.columns.map((column) => <th key={column} colSpan={measures.length} className="border border-slate-200 px-3 py-2 text-center font-black">{column}</th>)}
          </tr>
          <tr className="bg-slate-50">
            {measures.map((measure) => (
              <th key={`total-${measure}`} onClick={() => toggleSort('__total__', measure)} className="cursor-pointer border border-slate-200 bg-slate-200 px-3 py-2 text-right font-black hover:bg-blue-100">
                {getMeasureLabel(measure)} {sortCell?.column === '__total__' && sortCell.measure === measure ? (sortCell.dir === 'asc' ? '▲' : '▼') : ''}
              </th>
            ))}
            {pivot.columns.flatMap((column) => measures.map((measure) => (
              <th key={`${column}-${measure}`} onClick={() => toggleSort(column, measure)} className="cursor-pointer border border-slate-200 px-3 py-2 text-right font-black hover:bg-blue-50">
                {getMeasureLabel(measure)} {sortCell?.column === column && sortCell.measure === measure ? (sortCell.dir === 'asc' ? '▲' : '▼') : ''}
              </th>
            )))}
          </tr>
        </thead>
        <tbody>
          {pivot.rows.map((row) => (
            <tr key={row.label} className="hover:bg-slate-50">
              <td className="sticky left-0 z-10 border border-slate-200 bg-white px-3 py-2 font-bold">{row.label}</td>
              {measures.map((measure) => {
                const value = measureValue(row.total, measure)
                const previous = totalComparisonValue(row.label, measure)
                return <td key={`${row.label}-total-${measure}`} className="border border-slate-200 bg-slate-50 px-3 py-2 text-right"><CellValue value={value} previous={previous} measure={measure} /></td>
              })}
              {pivot.columns.flatMap((column) => {
                const agg = row.colMap.get(column) || emptyAgg()
                return measures.map((measure) => {
                  const value = measureValue(agg, measure)
                  const previous = comparisonValue(row.label, column, measure)
                  return (
                    <td key={`${row.label}-${column}-${measure}`} className="border border-slate-200 px-3 py-2 text-right">
                      <CellValue value={value} previous={previous} measure={measure} />
                    </td>
                  )
                })
              })}
            </tr>
          ))}
          <tr className="bg-slate-100 font-black">
            <td className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-3 py-2">TOTAL</td>
            {measures.map((measure) => {
              const currentGrand = aggregateTotal(currentPeriodRows)
              const previousGrand = aggregateTotal(previousPeriodRows)
              return <td key={`grand-total-${measure}`} className="border border-slate-200 bg-slate-200 px-3 py-2 text-right"><CellValue value={measureValue(currentGrand, measure)} previous={measureValue(previousGrand, measure)} measure={measure} /></td>
            })}
            {pivot.columns.flatMap((column) => {
              const agg = emptyAgg()
              rows.filter((r) => getCompositeDimensionValue(r, widget.columnDimension, widget.columnDimension2) === column).forEach((r) => addToAgg(agg, r))
              return measures.map((measure) => <td key={`grand-${column}-${measure}`} className="border border-slate-200 px-3 py-2 text-right">{formatMeasure(measureValue(agg, measure), measure)}</td>)
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}


function PieWidget({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  const data = useMemo(() => {
    const map = new Map<string, AggregatedValue>()
    rows.forEach((row) => {
      const label = getDimensionValue(row, widget.dimension)
      if (!map.has(label)) map.set(label, emptyAgg())
      addToAgg(map.get(label)!, row)
    })
    const items = Array.from(map.entries()).map(([label, agg]) => ({ label, value: measureValue(agg, widget.measure) }))
    return sortItems(items, widget.sortMode).slice(0, Math.max(1, widget.topN || 12))
  }, [rows, widget])

  if (!data.length) return <div className="rounded-xl bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">Aucune donnée.</div>

  return (
    <div className="h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Pie data={data} dataKey="value" nameKey="label" outerRadius={115} label={(entry: any) => `${entry.label}`}> 
            {data.map((_entry, index) => <Cell key={`pie-${index}`} fill={PALETTE[index % PALETTE.length]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function WidgetRenderer({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  if (widget.type === 'kpi') return <KpiWidget rows={rows} widget={widget} />
  if (widget.type === 'bridge') return <BridgeWidget rows={rows} widget={widget} />
  if (widget.type === 'tableau') return <PivotTableWidget rows={rows} widget={widget} />
  if (widget.type === 'camembert') return <PieWidget rows={rows} widget={widget} />
  return <ChartWidget rows={rows} widget={widget} />
}

export default function AtelierAnalysePage() {
  const [rows, setRows] = useState<StudioRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalFilters, setGlobalFilters] = useState<GlobalFilters>(DEFAULT_FILTERS)
  const [widgets, setWidgets] = useState<WidgetConfig[]>([])
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [currentViewId, setCurrentViewId] = useState<string | null>(null)
  const [viewName, setViewName] = useState('Vue Direction')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [factures, activite] = await Promise.all([
        fetchAllRows(FACTURES_TABLE, 'factures'),
        fetchAllRows(ACTIVITE_TABLE, 'activite'),
      ])
      const loaded = [...factures, ...activite]
      setRows(loaded)
      const years = uniqueSorted(loaded.map((r) => r.annee)).sort((a, b) => Number(b) - Number(a))
      setGlobalFilters((prev) => ({ ...prev, years: prev.years.length ? prev.years : years.slice(0, 2).map(Number) }))
      setWidgets((prev) => prev.length ? prev : [buildDefaultWidget('bridge', years.map(Number)), buildDefaultWidget('histogramme', years.map(Number)), buildDefaultWidget('tableau', years.map(Number))])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function loadSavedViews() {
    try {
      const { data, error } = await supabase
        .from(VIEW_TABLE)
        .select('id, name, description, global_filters, widgets, updated_at')
        .order('updated_at', { ascending: false })
      if (error) throw error
      setSavedViews((data || []) as SavedView[])
    } catch (_e) {
      const local = window.localStorage.getItem('atelier_analyse_views')
      if (local) setSavedViews(JSON.parse(local))
    }
  }

  useEffect(() => {
    loadData()
    loadSavedViews()
  }, [])

  const available = useMemo(() => {
    return {
      years: uniqueSorted(rows.map((r) => r.annee)).sort((a, b) => Number(b) - Number(a)).map(Number),
      months: Array.from({ length: 12 }, (_v, i) => i + 1),
      agences: uniqueSorted(rows.map((r) => r.agence_collaborateur)),
      collaborateurs: uniqueSorted(rows.map((r) => r.collaborateur)),
      famillesMacro: uniqueSorted(rows.map((r) => r.famille_macro)),
      typesDocument: uniqueSorted(rows.map((r) => r.type_document)),
    }
  }, [rows])

  const selectedWidget = selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId) || null : null

  function updateWidget(id: string, patch: Partial<WidgetConfig>) {
    setWidgets((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w))
  }

  function addWidget(type: WidgetType) {
    const widget = buildDefaultWidget(type, available.years)
    setWidgets((prev) => [...prev, widget])
    setSelectedWidgetId(widget.id)
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id))
    if (selectedWidgetId === id) setSelectedWidgetId(null)
  }

  function duplicateWidget(widget: WidgetConfig) {
    const copy = { ...widget, id: uid(), title: `${widget.title} - copie` }
    setWidgets((prev) => [...prev, copy])
    setSelectedWidgetId(copy.id)
  }

  function moveWidget(id: string, direction: -1 | 1) {
    setWidgets((prev) => {
      const index = prev.findIndex((w) => w.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(index, 1)
      copy.splice(target, 0, item)
      return copy
    })
  }

  async function saveView() {
    setSaveMessage(null)
    const payload = {
      id: currentViewId || uid('view'),
      name: viewName || 'Vue sans nom',
      description: null,
      global_filters: globalFilters,
      widgets,
      updated_at: new Date().toISOString(),
    }

    try {
      const { error } = await supabase.from(VIEW_TABLE).upsert(payload, { onConflict: 'id' })
      if (error) throw error
      setCurrentViewId(payload.id)
      setSaveMessage('Vue enregistrée dans Supabase.')
      await loadSavedViews()
    } catch (e: any) {
      const next = [payload as SavedView, ...savedViews.filter((v) => v.id !== payload.id)]
      window.localStorage.setItem('atelier_analyse_views', JSON.stringify(next))
      setSavedViews(next)
      setCurrentViewId(payload.id)
      setSaveMessage(`Vue enregistrée localement. Pour sauvegarder dans Supabase, crée la table ${VIEW_TABLE}.`)
    }
  }

  function loadView(view: SavedView) {
    setCurrentViewId(view.id)
    setViewName(view.name)
    setGlobalFilters(view.global_filters || DEFAULT_FILTERS)
    setWidgets(view.widgets || [])
    // À l'ouverture d'une vue enregistrée, on ferme le panneau de configuration
    // pour maximiser l'espace de lecture du dashboard.
    setSelectedWidgetId(null)
  }

  function duplicateCurrentView() {
    const nextWidgets = widgets.map((widget) => ({ ...widget, id: uid() }))
    setCurrentViewId(null)
    setViewName(`${viewName || 'Vue'} - copie`)
    setWidgets(nextWidgets)
    setSelectedWidgetId(null)
    setSaveMessage('Vue dupliquée. Modifiez les filtres ou widgets puis cliquez sur Enregistrer la vue.')
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[2100px] space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight">Atelier d’analyse</h1>
              <p className="mt-2 text-sm text-slate-600">Créez vos propres widgets à partir des indicateurs factures et activité.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={viewName} onChange={(e) => setViewName(e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-500" />
              <button type="button" onClick={saveView} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700">Enregistrer la vue</button>
              <button type="button" onClick={duplicateCurrentView} disabled={!widgets.length} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Dupliquer la vue</button>
              <button type="button" onClick={() => { setCurrentViewId(null); setViewName('Nouvelle vue'); setWidgets([]); setSelectedWidgetId(null); setSaveMessage(null) }} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50">Nouvelle vue</button>
              <button type="button" onClick={loadData} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50">Actualiser</button>
            </div>
          </div>
          {saveMessage && <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-700">{saveMessage}</div>}
          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        </section>

        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-7">
          <MultiSelect label="Source" values={['factures', 'activite', 'mixte']} selected={globalFilters.sources} onChange={(v) => setGlobalFilters((p) => ({ ...p, sources: v as DataSource[] }))} />
          <MultiSelect label="Année" values={available.years.map(String)} selected={globalFilters.years.map(String)} onChange={(v) => setGlobalFilters((p) => ({ ...p, years: v.map(Number) }))} />
          <MultiSelect label="Mois" values={available.months.map((m) => `${m} - ${monthLabel(m)}`)} selected={globalFilters.months.map((m) => `${m} - ${monthLabel(m)}`)} onChange={(v) => setGlobalFilters((p) => ({ ...p, months: v.map((x) => Number(x.split(' - ')[0])) }))} />
          <MultiSelect label="Agence" values={available.agences} selected={globalFilters.agences} onChange={(v) => setGlobalFilters((p) => ({ ...p, agences: v }))} />
          <MultiSelect label="Collaborateur" values={available.collaborateurs} selected={globalFilters.collaborateurs} onChange={(v) => setGlobalFilters((p) => ({ ...p, collaborateurs: v }))} />
          <MultiSelect label="Famille macro" values={available.famillesMacro} selected={globalFilters.famillesMacro} onChange={(v) => setGlobalFilters((p) => ({ ...p, famillesMacro: v }))} />
          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Hors statistique</span>
            <select value={globalFilters.horsStatistique} onChange={(e) => setGlobalFilters((p) => ({ ...p, horsStatistique: e.target.value as GlobalFilters['horsStatistique'] }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
              <option value="non">Exclu</option>
              <option value="oui">Uniquement</option>
              <option value="tous">Tous</option>
            </select>
          </label>
        </section>

        <div className={`grid gap-5 ${selectedWidget ? 'xl:grid-cols-[300px_minmax(0,1fr)_380px]' : 'xl:grid-cols-[300px_minmax(0,1fr)]'}`}>
          <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-lg font-black">Bibliothèque</h2>
              <p className="text-sm text-slate-500">Ajoutez un widget puis configurez-le.</p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-black uppercase text-slate-500">Vues enregistrées</h3>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {savedViews.length === 0 && <div className="whitespace-nowrap rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Aucune vue</div>}
                {savedViews.map((view) => (
                  <button key={view.id} type="button" onClick={() => loadView(view)} className={`min-w-[120px] rounded-xl border px-3 py-2 text-left text-xs hover:bg-slate-50 ${currentViewId === view.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                    <span className="block truncate font-black">{view.name}</span>
                    <span className="block truncate text-[10px] text-slate-500">{view.updated_at ? new Date(view.updated_at).toLocaleDateString('fr-FR') : ''}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {([
                ['kpi', 'KPI', 'Indicateur simple'],
                ['histogramme', 'Histogramme', 'Barres verticales'],
                ['histogramme_empile', 'Histogramme empilé', 'Valeur ou base 100'],
                ['courbe', 'Courbe', 'Évolution mensuelle'],
                ['bridge', 'Bridge', 'Écart N-1 ⇒ N'],
                ['tableau', 'Tableau croisé', 'Lignes / colonnes / valeurs'],
                ['camembert', 'Camembert', 'Répartition'],
              ] as Array<[WidgetType, string, string]>).map(([type, label, helper]) => (
                <button key={type} type="button" onClick={() => addWidget(type)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50">
                  <span><span className="block text-sm font-black text-slate-900">+ {label}</span><span className="block text-xs text-slate-500">{helper}</span></span>
                </button>
              ))}
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">Ma page</h2>
                <p className="text-sm text-slate-500">{loading ? 'Chargement des données…' : `${formatNumber(rows.length)} lignes agrégées chargées`}</p>
              </div>
              <div className="text-xs font-bold text-slate-500">Cliquez sur un widget pour le configurer</div>
            </div>
            {widgets.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center">
                <div className="text-xl font-black text-slate-700">Ajoutez votre premier widget</div>
                <p className="mt-2 text-sm text-slate-500">Utilisez la bibliothèque à gauche pour démarrer.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                {widgets.map((widget) => {
                  const widgetRows = applyWidgetFilters(rows, widget, globalFilters)
                  return (
                    <WidgetShell
                      key={widget.id}
                      widget={widget}
                      selected={selectedWidget?.id === widget.id}
                      onSelect={() => setSelectedWidgetId(widget.id)}
                      onRemove={() => removeWidget(widget.id)}
                      onDuplicate={() => duplicateWidget(widget)}
                      onMove={(direction) => moveWidget(widget.id, direction)}
                    >
                      <WidgetRenderer rows={widgetRows} widget={widget} />
                    </WidgetShell>
                  )
                })}
              </div>
            )}
          </section>

          {selectedWidget && (
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black">Configurer le widget</h2>
                    <p className="text-xs text-slate-500">{selectedWidget.id}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedWidgetId(null)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-black hover:bg-slate-50">×</button>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Titre</span>
                  <input value={selectedWidget.title} onChange={(e) => updateWidget(selectedWidget.id, { title: e.target.value })} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Type" value={selectedWidget.type} onChange={(v) => updateWidget(selectedWidget.id, { type: v as WidgetType })} options={[
                    { value: 'kpi', label: 'KPI' },
                    { value: 'histogramme', label: 'Histogramme' },
                    { value: 'histogramme_empile', label: 'Histogramme empilé' },
                    { value: 'courbe', label: 'Courbe' },
                    { value: 'bridge', label: 'Bridge' },
                    { value: 'tableau', label: 'Tableau' },
                    { value: 'camembert', label: 'Camembert' },
                  ]} />
                  <SelectField label="Taille" value={selectedWidget.size} onChange={(v) => updateWidget(selectedWidget.id, { size: v as SizeKey })} options={[
                    { value: 'small', label: 'Petit' },
                    { value: 'medium', label: 'Moyen' },
                    { value: 'large', label: 'Large' },
                    { value: 'full', label: 'Pleine largeur' },
                  ]} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Source" value={selectedWidget.source} onChange={(v) => updateWidget(selectedWidget.id, { source: v as DataSource })} options={[
                    { value: 'factures', label: 'Factures' },
                    { value: 'activite', label: 'Activité' },
                    { value: 'mixte', label: 'Mixte' },
                  ]} />
                  <SelectField label="Valeur" value={selectedWidget.measure} onChange={(v) => updateWidget(selectedWidget.id, { measure: v as MeasureKey })} options={MEASURES.map((m) => ({ value: m.key, label: m.label }))} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Mesure comparaison" value={selectedWidget.secondMeasure || selectedWidget.measure} onChange={(v) => updateWidget(selectedWidget.id, { secondMeasure: v as MeasureKey })} options={MEASURES.map((m) => ({ value: m.key, label: m.label }))} />
                  <SelectField label="Évolution" value={selectedWidget.evolutionMode} onChange={(v) => updateWidget(selectedWidget.id, { evolutionMode: v as EvolutionMode })} options={[{ value: 'none', label: 'Aucune' }, { value: 'percent', label: 'Évolution %' }, { value: 'value', label: 'Évolution valeur' }, { value: 'both', label: 'Valeur + %' }]} />
                </div>

                {selectedWidget.type !== 'kpi' && selectedWidget.type !== 'tableau' && (
                  <>
                    <SelectField label={selectedWidget.type === 'bridge' ? 'Dimension écart' : 'Axe X'} value={selectedWidget.dimension} onChange={(v) => updateWidget(selectedWidget.id, { dimension: v as DimensionKey })} options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))} />
                    {selectedWidget.type !== 'bridge' && selectedWidget.type !== 'camembert' && (
                      <SelectField label="Série" value={selectedWidget.seriesDimension || ''} onChange={(v) => updateWidget(selectedWidget.id, { seriesDimension: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                    )}
                  </>
                )}

                {(['bridge', 'kpi', 'tableau'] as WidgetType[]).includes(selectedWidget.type) && (
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3">
                    <div className="col-span-2 text-xs font-black uppercase tracking-wide text-slate-500">Période de calcul / base de comparaison</div>
                    <SelectField label="Période" value={selectedWidget.periodMode} onChange={(v) => updateWidget(selectedWidget.id, { periodMode: v as PeriodMode })} options={[{ value: 'mois', label: 'Mois seul' }, { value: 'cumul', label: 'Cumul 01-M' }]} />
                    <SelectField label="Mois" value={selectedWidget.bridgeMonth} onChange={(v) => updateWidget(selectedWidget.id, { bridgeMonth: Number(v) })} options={available.months.map((m) => ({ value: m, label: `${String(m).padStart(2, '0')} - ${monthLabel(m)}` }))} />
                    <SelectField label="Année N" value={selectedWidget.yearN || available.years[0] || CURRENT_YEAR} onChange={(v) => updateWidget(selectedWidget.id, { yearN: Number(v) })} options={available.years.map((y) => ({ value: y, label: String(y) }))} />
                    <SelectField label="Année N-1" value={selectedWidget.yearN1 || (selectedWidget.yearN || CURRENT_YEAR) - 1} onChange={(v) => updateWidget(selectedWidget.id, { yearN1: Number(v) })} options={available.years.map((y) => ({ value: y, label: String(y) }))} />
                  </div>
                )}

                {selectedWidget.type === 'tableau' && (
                  <div className="grid grid-cols-2 gap-3">
                    <SelectField label="Lignes 1" value={selectedWidget.rowDimension} onChange={(v) => updateWidget(selectedWidget.id, { rowDimension: v as DimensionKey })} options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))} />
                    <SelectField label="Lignes 2" value={selectedWidget.rowDimension2 || ''} onChange={(v) => updateWidget(selectedWidget.id, { rowDimension2: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                    <SelectField label="Colonnes 1" value={selectedWidget.columnDimension} onChange={(v) => updateWidget(selectedWidget.id, { columnDimension: v as DimensionKey })} options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))} />
                    <SelectField label="Colonnes 2" value={selectedWidget.columnDimension2 || ''} onChange={(v) => updateWidget(selectedWidget.id, { columnDimension2: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                    <div className="col-span-2 rounded-xl border border-slate-200 p-3">
                      <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Valeurs affichées dans chaque colonne</div>
                      <div className="grid grid-cols-2 gap-2">
                        {MEASURES.map((measure) => {
                          const selected = (selectedWidget.tableMeasures || [selectedWidget.measure]).includes(measure.key)
                          return (
                            <label key={measure.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const current = selectedWidget.tableMeasures || [selectedWidget.measure]
                                  const next = e.target.checked ? Array.from(new Set([...current, measure.key])) : current.filter((m) => m !== measure.key)
                                  updateWidget(selectedWidget.id, { tableMeasures: next.length ? next : [selectedWidget.measure] })
                                }}
                              />
                              {measure.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tri" value={selectedWidget.sortMode} onChange={(v) => updateWidget(selectedWidget.id, { sortMode: v as SortMode })} options={[
                    { value: 'value_desc', label: 'Valeur décroissante' },
                    { value: 'value_asc', label: 'Valeur croissante' },
                    { value: 'label_asc', label: 'Libellé A-Z' },
                  ]} />
                  <label className="block">
                    <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Top N</span>
                    <input type="number" min={1} max={100} value={selectedWidget.topN} onChange={(e) => updateWidget(selectedWidget.id, { topN: Number(e.target.value || 10) })} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Mode comparaison" value={selectedWidget.compareMode} onChange={(v) => updateWidget(selectedWidget.id, { compareMode: v as CompareMode })} options={[{ value: 'year', label: 'Année / période' }, { value: 'month', label: 'Mois' }, { value: 'dimension', label: 'Autre dimension' }]} />
                  <SelectField label="Dimension comparaison" value={selectedWidget.compareDimension || ''} onChange={(v) => updateWidget(selectedWidget.id, { compareDimension: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                  <label className="block col-span-2">
                    <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Valeur comparaison dimension</span>
                    <input value={selectedWidget.compareValue || ''} onChange={(e) => updateWidget(selectedWidget.id, { compareValue: e.target.value })} placeholder="Ex : ANGLET, PV, 2025..." className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
                  </label>
                  {selectedWidget.type === 'histogramme_empile' && (
                    <label className="col-span-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                      <input type="checkbox" checked={selectedWidget.stacked100} onChange={(e) => updateWidget(selectedWidget.id, { stacked100: e.target.checked })} />
                      Afficher en base 100
                    </label>
                  )}
                </div>

                <label className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={selectedWidget.useGlobalFilters} onChange={(e) => updateWidget(selectedWidget.id, { useGlobalFilters: e.target.checked })} />
                  Utiliser les filtres globaux
                </label>

                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Filtres propres au widget</div>
                  <div className="grid gap-2">
                    <MultiSelect label="Année" values={available.years.map(String)} selected={(selectedWidget.localFilters.years || []).map(String)} onChange={(v) => updateWidget(selectedWidget.id, { localFilters: { ...selectedWidget.localFilters, years: v.map(Number) } })} />
                    <MultiSelect label="Mois" values={available.months.map((m) => `${m} - ${monthLabel(m)}`)} selected={(selectedWidget.localFilters.months || []).map((m) => `${m} - ${monthLabel(m)}`)} onChange={(v) => updateWidget(selectedWidget.id, { localFilters: { ...selectedWidget.localFilters, months: v.map((x) => Number(x.split(' - ')[0])) } })} />
                    <MultiSelect label="Agence" values={available.agences} selected={selectedWidget.localFilters.agences || []} onChange={(v) => updateWidget(selectedWidget.id, { localFilters: { ...selectedWidget.localFilters, agences: v } })} />
                    <MultiSelect label="Famille macro" values={available.famillesMacro} selected={selectedWidget.localFilters.famillesMacro || []} onChange={(v) => updateWidget(selectedWidget.id, { localFilters: { ...selectedWidget.localFilters, famillesMacro: v } })} />
                    <MultiSelect label="Type document" values={available.typesDocument} selected={selectedWidget.localFilters.typesDocument || []} onChange={(v) => updateWidget(selectedWidget.id, { localFilters: { ...selectedWidget.localFilters, typesDocument: v } })} />
                  </div>
                </div>
              </div>
          </aside>
          )}
        </div>
      </div>
    </main>
  )
}
