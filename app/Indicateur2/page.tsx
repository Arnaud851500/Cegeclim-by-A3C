'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '@/lib/supabaseClient'

type RawAggRow = Record<string, any>
type SourceType = 'facture' | 'activite'
type ActivityType = 'FACTURE' | 'BL mois' | 'BL frigo' | 'PL' | 'CDC' | 'BR'
type ActivityFilterOption = 'NON' | 'ACTIVITE_MOIS' | 'PL_FUTUR' | 'CDC_MOIS' | 'CDC_FUTUR' | 'TOUS'
type TableMode = 'collaborateur' | 'agence'
type DetailMode = 'tiers' | 'documents' | 'agregats'
type ChartMetric = 'ca' | 'margePct'
type ChartVision = 'mensuel' | 'cumul'
type BridgeVision = 'mois' | 'ytd'

type AggRow = {
  source: SourceType
  type_document: ActivityType
  annee: number
  mois: number
  periode: string
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
  updated_at?: string | null
}

type Filters = {
  periodes: string[]
  collaborateurs: string[]
  agencesCollaborateurs: string[]
  tiers: string[]
  famillesMacro: string[]
  activityOption: ActivityFilterOption
  horsStatistique: 'non' | 'oui' | 'tous'
}

type RecapValue = {
  ca: number
  marge: number
  caN1: number
  margeN1: number
  margePct: number
  margePctN1: number
  evoCa: number | null
  evoMargePoints: number | null
  nbLignes: number
}

type DetailContext = {
  year: number
  month?: number
  monthLabel: string
  collaborateur?: string
  agence?: string
  label: string
}

type DetailRow = {
  id: string
  niveau: string
  source: SourceType
  type_piece: string
  periode: string
  numero_tiers: string
  intitule_tiers: string
  collaborateur: string
  agence: string
  famille_macro: string
  quantite: number
  ca_ht: number
  marge_valeur: number
  marge_pct: number
  nb_lignes: number
  ca_ht_n1?: number
  marge_valeur_n1?: number
  marge_pct_n1?: number
  evo_ca_pct_n1?: number | null
  evo_marge_points_n1?: number | null
}

type DetailSortKey =
  | 'niveau'
  | 'type_piece'
  | 'tiers'
  | 'collaborateur'
  | 'agence'
  | 'famille_macro'
  | 'nb_lignes'
  | 'quantite'
  | 'ca_ht'
  | 'marge_valeur'
  | 'marge_pct'
  | 'ca_ht_n1'
  | 'marge_pct_n1'
  | 'evo_ca_pct_n1'
  | 'evo_marge_points_n1'

type DetailSort = { key: DetailSortKey; direction: 'asc' | 'desc' }

type BridgeItem = {
  key: string
  label: string
  previous: number
  current: number
  delta: number
}

type BridgeData = {
  title: string
  startLabel: string
  endLabel: string
  previousTotal: number
  currentTotal: number
  items: BridgeItem[]
}

type WaterfallPoint = {
  name: string
  start: number
  end: number
  labelValue: string
  fill: string
  isTotal?: boolean
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const CURRENT_DATE = new Date()
const CURRENT_YEAR = CURRENT_DATE.getFullYear()
const CURRENT_MONTH = CURRENT_DATE.getMonth() + 1
const CURRENT_MONTH_KEY = CURRENT_YEAR * 100 + CURRENT_MONTH

const AGG_TABLE_NAME = 'indicateur_factures_mensuel'
const ACTIVITY_AGG_TABLE_NAME = 'indicateur_activite_mensuel'

const ACTIVITY_FILTERS: Array<{ value: ActivityFilterOption; label: string; helper: string }> = [
  { value: 'NON', label: 'NON', helper: 'Factures uniquement.' },
  { value: 'ACTIVITE_MOIS', label: 'BL, BR, PL mois en cours', helper: 'Factures + BL mois, BL frigo, BR et PL non futur.' },
  { value: 'PL_FUTUR', label: 'PL Liv futur', helper: 'Factures + PL avec date de livraison supérieure au mois en cours.' },
  { value: 'CDC_MOIS', label: 'CDC mois en cours', helper: 'Factures + CDC positionnées sur le mois en cours.' },
  { value: 'CDC_FUTUR', label: 'CDC futur', helper: 'Factures + CDC avec date supérieure au mois en cours.' },
  { value: 'TOUS', label: 'TOUS', helper: 'Factures + toutes les activités agrégées.' },
]

const COLOR_N = '#16a34a'
const COLOR_N1 = '#64748b'
const COLOR_N2 = '#f59e0b'
const COLOR_POSITIVE = '#92d050'
const COLOR_NEGATIVE = '#ed7330'
const COLOR_TOTAL = '#e5e7eb'
const COLOR_GRID = '#d7dde6'
const COLOR_ACT_BL_MOIS = '#0ea5e9'
const COLOR_ACT_BL_FRIGO = '#0369a1'
const COLOR_ACT_PL = '#38bdf8'
const COLOR_ACT_CDC = '#7dd3fc'
const COLOR_ACT_BR = '#bae6fd'

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

function normalizeActivityType(value: any): ActivityType {
  const normalized = safeText(value, 'FACTURE').toUpperCase().replace(/\s+/g, ' ')
  if (normalized === 'BL FRIGO') return 'BL frigo'
  if (normalized === 'BL MOIS' || normalized === 'BL') return 'BL mois'
  if (normalized === 'PL') return 'PL'
  if (normalized === 'CDC') return 'CDC'
  if (normalized === 'BR') return 'BR'
  return 'FACTURE'
}

function normalizeAggRow(row: RawAggRow, source: SourceType): AggRow {
  const periodeRaw = safeText(row.periode || row.annee_mois || row.mois_annee, '')
  const anneeFromPeriode = periodeRaw ? Number(periodeRaw.slice(0, 4)) : 0
  const moisFromPeriode = periodeRaw ? Number(periodeRaw.slice(5, 7)) : 0
  const annee = safeNumber(row.annee || row.year || row.exercice || anneeFromPeriode)
  const mois = safeNumber(row.mois || row.month || moisFromPeriode)

  return {
    source,
    type_document: source === 'facture' ? 'FACTURE' : normalizeActivityType(row.type_document),
    annee,
    mois,
    periode: periodeRaw || `${annee}-${String(mois).padStart(2, '0')}`,
    collaborateur: safeText(row.collaborateur, 'NON AFFECTE'),
    agence_collaborateur: safeText(row.agence_collaborateur || row.agence, 'NON AFFECTE'),
    numero_tiers: safeText(row.numero_tiers || row.numero_tiers_entete || row.code_tiers, 'NON RENSEIGNE'),
    intitule_tiers: safeText(row.intitule_tiers || row.intitule_tiers_entete || row.tiers, 'NON RENSEIGNE'),
    famille: safeText(row.famille, 'NON RENSEIGNE'),
    famille_macro: safeText(row.famille_macro, 'NON RENSEIGNE'),
    hors_statistique: safeBool(row.hors_statistique),
    nb_lignes: safeNumber(row.nb_lignes || row.nb_ligne || row.nombre_lignes),
    quantite: safeNumber(row.quantite || row.qte),
    ca_ht: safeNumber(row.ca_ht || row.ca || row.montant_ht || row.ca_facture),
    marge_valeur: safeNumber(row.marge_valeur || row.marge || row.marge_stat),
    updated_at: row.updated_at || null,
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0)
}

function formatKEur(value: number) {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round((value || 0) / 1000))} K€`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1).replace('.', ',')} %`
}

function formatPoints(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} pts`
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} %`
}

function calcEvolution(current: number, previous: number) {
  if (!previous || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function getUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
}

function emptyRecap(): RecapValue {
  return { ca: 0, marge: 0, caN1: 0, margeN1: 0, margePct: 0, margePctN1: 0, evoCa: null, evoMargePoints: null, nbLignes: 0 }
}

function sumRows(rows: AggRow[]) {
  const ca = rows.reduce((s, r) => s + r.ca_ht, 0)
  const marge = rows.reduce((s, r) => s + r.marge_valeur, 0)
  const nbLignes = rows.reduce((s, r) => s + r.nb_lignes, 0)
  return { ca, marge, margePct: ca ? (marge / ca) * 100 : 0, nbLignes }
}

function makeRecap(currentRows: AggRow[], previousRows: AggRow[]): RecapValue {
  const current = sumRows(currentRows)
  const previous = sumRows(previousRows)
  return {
    ca: current.ca,
    marge: current.marge,
    caN1: previous.ca,
    margeN1: previous.marge,
    nbLignes: current.nbLignes,
    margePct: current.margePct,
    margePctN1: previous.margePct,
    evoCa: calcEvolution(current.ca, previous.ca),
    evoMargePoints: current.ca && previous.ca ? current.margePct - previous.margePct : null,
  }
}

function sumRecap(values: RecapValue[]): RecapValue {
  const ca = values.reduce((s, v) => s + v.ca, 0)
  const marge = values.reduce((s, v) => s + v.marge, 0)
  const caN1 = values.reduce((s, v) => s + v.caN1, 0)
  const margeN1 = values.reduce((s, v) => s + v.margeN1, 0)
  const nbLignes = values.reduce((s, v) => s + v.nbLignes, 0)
  const margePct = ca ? (marge / ca) * 100 : 0
  const margePctN1 = caN1 ? (margeN1 / caN1) * 100 : 0
  return {
    ca,
    marge,
    caN1,
    margeN1,
    nbLignes,
    margePct,
    margePctN1,
    evoCa: calcEvolution(ca, caN1),
    evoMargePoints: ca && caN1 ? margePct - margePctN1 : null,
  }
}

function shortenLabel(value: string, max = 14) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function dateKey(row: AggRow) {
  return row.annee * 100 + row.mois
}

function activityMatches(option: ActivityFilterOption, row: AggRow) {
  if (row.source !== 'activite') return true
  const key = dateKey(row)

  switch (option) {
    case 'NON':
      return false
    case 'ACTIVITE_MOIS':
      return row.type_document === 'BL mois'
        || row.type_document === 'BL frigo'
        || row.type_document === 'BR'
        || (row.type_document === 'PL' && key <= CURRENT_MONTH_KEY)
    case 'PL_FUTUR':
      return row.type_document === 'PL' && key > CURRENT_MONTH_KEY
    case 'CDC_MOIS':
      return row.type_document === 'CDC' && key === CURRENT_MONTH_KEY
    case 'CDC_FUTUR':
      return row.type_document === 'CDC' && key > CURRENT_MONTH_KEY
    case 'TOUS':
      return true
    default:
      return false
  }
}

function activityLabel(option: ActivityFilterOption) {
  return ACTIVITY_FILTERS.find((a) => a.value === option)?.label || option
}

function activitySummary(option: ActivityFilterOption) {
  if (option === 'NON') return 'Prise en compte des factures uniquement.'
  const helper = ACTIVITY_FILTERS.find((a) => a.value === option)?.helper || ''
  return `Prise en compte des factures mais aussi de l’activité non facturée : ${helper}`
}

function maxUpdatedAt(rows: AggRow[]) {
  const values = rows
    .map((r) => r.updated_at)
    .filter(Boolean)
    .map((v) => new Date(String(v)).getTime())
    .filter((v) => Number.isFinite(v))

  if (!values.length) return 'XX/XX/XXXX'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(Math.max(...values)))
}

function downloadCsv(filename: string, rows: Array<Record<string, any>>) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(';'),
    ...rows.map((row) => headers.map((h) => {
      const raw = row[h] ?? ''
      const text = String(raw).replace(/"/g, '""')
      return `"${text}"`
    }).join(';')),
  ].join('\n')

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}


function normalizeAgenceKey(value: string) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function extractAllowedAgences(value: any): string[] {
  if (value === null || value === undefined) return []

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractAllowedAgences(item))
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap((item) => extractAllowedAgences(item))
  }

  const text = String(value).trim()
  if (!text) return []

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text)
      return extractAllowedAgences(parsed)
    } catch {
      // On retombe sur le split classique ci-dessous.
    }
  }

  return text
    .split(/[;,|\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolveAllowedAgences(allowedAgences: string[], availableAgences: string[]) {
  const availableByKey = new Map<string, string>()
  availableAgences.forEach((agence) => {
    const key = normalizeAgenceKey(agence)
    if (key && !availableByKey.has(key)) availableByKey.set(key, agence)
  })

  return Array.from(new Set(
    allowedAgences
      .map((agence) => availableByKey.get(normalizeAgenceKey(agence)))
      .filter(Boolean) as string[]
  ))
}

async function fetchAllowedAgencesForCurrentUser() {
  const { data: userData } = await supabase.auth.getUser()
  const email = userData?.user?.email
  if (!email) return []

  const attempts: Array<{ table: string; emailColumn: string; agenceColumn: string }> = [
    { table: 'user_access_page', emailColumn: 'email', agenceColumn: 'allowed_agence' },
    { table: 'user_access_page', emailColumn: 'user_email', agenceColumn: 'allowed_agence' },
    { table: 'user_page_access', emailColumn: 'email', agenceColumn: 'allowed_agence' },
    { table: 'user_page_access', emailColumn: 'email', agenceColumn: 'allowed_agences' },
    { table: 'user_page_access', emailColumn: 'user_email', agenceColumn: 'allowed_agence' },
    { table: 'user_page_access', emailColumn: 'user_email', agenceColumn: 'allowed_agences' },
  ]

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from(attempt.table)
      .select(attempt.agenceColumn)
      .eq(attempt.emailColumn, email)
      .limit(20)

    if (error || !data?.length) continue

    const values = data.flatMap((row: any) => extractAllowedAgences(row?.[attempt.agenceColumn]))
    if (values.length) return Array.from(new Set(values))
  }

  return []
}


async function fetchAllFromTable(tableName: string, chunkSize = 1000) {
  const allRows: RawAggRow[] = []
  let from = 0

  while (true) {
    const to = from + chunkSize - 1
    const { data, error } = await supabase.from(tableName).select('*').range(from, to)
    if (error) throw error
    const rows = (data || []) as RawAggRow[]
    allRows.push(...rows)
    if (rows.length < chunkSize) break
    from += chunkSize
  }

  return allRows
}

function useCloseOnOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return ref
}

function MultiSelectFilter({
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
  const ref = useCloseOnOutside(open, () => setOpen(false))

  const filteredValues = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return values
    return values.filter((v) => v.toLowerCase().includes(s))
  }, [values, search])

  function toggleValue(value: string) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-left text-sm font-extrabold text-slate-800 shadow-sm hover:bg-slate-50">
        <span className="truncate">{label} {selected.length ? `(${selected.length})` : ''}</span>
        <span>▼</span>
      </button>

      {open && (
        <div className="absolute left-0 top-14 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-700">{label}</div>
            <button type="button" onClick={() => onChange([])} className="text-xs font-bold text-slate-500 hover:text-slate-900">Tout afficher</button>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrer les résultats" className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" />
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {filteredValues.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(value)} onChange={() => toggleValue(value)} />
                <span className="truncate">{value}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityFilter({ selected, onChange }: { selected: ActivityFilterOption; onChange: (value: ActivityFilterOption) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useCloseOnOutside(open, () => setOpen(false))
  const selectedLabel = activityLabel(selected)

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-left text-sm font-extrabold text-slate-800 shadow-sm hover:bg-slate-50">
        <span className="truncate">Activité non facturée : {selectedLabel}</span>
        <span>▼</span>
      </button>

      {open && (
        <div className="absolute left-0 top-14 z-50 w-[30rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="mb-3 text-sm font-black text-slate-700">Activité non facturée</div>
          <div className="space-y-3">
            {ACTIVITY_FILTERS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                <input type="radio" name="activity-filter" checked={selected === option.value} onChange={() => onChange(option.value)} className="mt-1" />
                <span>
                  <span className="block text-sm font-black text-slate-900">{option.label}</span>
                  <span className="block text-xs font-semibold text-slate-500">{option.helper}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EvolutionBadge({ value, mode = 'percent', large = false }: { value: number | null; mode?: 'percent' | 'points'; large?: boolean }) {
  const positive = value !== null && value >= 0
  const text = mode === 'points' ? formatPoints(value) : formatPercent(value)
  if (value === null) return <span className={`inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 font-black text-slate-500 ${large ? 'text-sm' : 'text-xs'}`}>—</span>
  return (
    <span className={`inline-flex items-center justify-center whitespace-nowrap rounded-full font-black ${large ? 'min-w-16 px-2.5 py-1 text-xs' : 'px-3 py-1 text-xs'} ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
      {text}
    </span>
  )
}

function KpiMini({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <div className="whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 whitespace-nowrap text-base font-black text-slate-900">{value}</div>
      {children}
    </div>
  )
}

function CustomTooltip({ active, payload, label, mode = 'currency' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-xl">
      <div className="mb-2 font-black text-slate-900">{label}</div>
      <div className="space-y-1">
        {payload
          .filter((entry: any) => Number(entry.value || 0) !== 0)
          .map((entry: any) => (
            <div key={`${entry.dataKey}-${entry.name}`} className="flex items-center justify-between gap-6">
              <span>{entry.name}</span>
              <span className="font-bold">{mode === 'percent' ? formatRate(Number(entry.value || 0)) : formatCurrency(Number(entry.value || 0))}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

function detailSortValue(row: DetailRow, key: DetailSortKey) {
  switch (key) {
    case 'tiers': return `${row.numero_tiers} ${row.intitule_tiers}`
    case 'nb_lignes': return row.nb_lignes
    case 'quantite': return row.quantite
    case 'ca_ht': return row.ca_ht
    case 'marge_valeur': return row.marge_valeur
    case 'marge_pct': return row.marge_pct
    case 'ca_ht_n1': return row.ca_ht_n1 || 0
    case 'marge_pct_n1': return row.marge_pct_n1 || 0
    case 'evo_ca_pct_n1': return row.evo_ca_pct_n1 ?? -999999
    case 'evo_marge_points_n1': return row.evo_marge_points_n1 ?? -999999
    default: return String((row as any)[key] ?? '')
  }
}

function SelectHint({ title }: { title: string }) {
  return <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">{title}</div>
}

function PeriodToggle({ value, onChange, monthLabel }: { value: BridgeVision; onChange: (v: BridgeVision) => void; monthLabel: string }) {
  return (
    <div>
      <SelectHint title="Cliquer pour changer la période" />
      <div className="flex gap-2">
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange('mois'); e.currentTarget.blur() }} className={`rounded-lg border px-5 py-2 text-sm font-black ${value === 'mois' ? 'border-[#0b3140] bg-[#1f6f89] text-white' : 'border-[#0b3140] bg-white text-slate-900'}`}>{monthLabel}</button>
        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange('ytd'); e.currentTarget.blur() }} className={`rounded-lg border px-5 py-2 text-sm font-black ${value === 'ytd' ? 'border-[#0b3140] bg-[#1f6f89] text-white' : 'border-[#0b3140] bg-white text-slate-900'}`}>01-{monthLabel}</button>
      </div>
    </div>
  )
}

function WaterfallChart({ data, angledLabels = false }: { data: BridgeData; angledLabels?: boolean }) {
  let cumulative = data.previousTotal

  // On affiche beaucoup plus d'items pour éviter de masquer des agences dans "AUTRES".
  const maxItems = angledLabels ? 24 : 18
  const sorted = [...data.items].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const primary = sorted.slice(0, maxItems)
  const otherDelta = sorted.slice(maxItems).reduce((s, item) => s + item.delta, 0)
  const items = otherDelta ? [...primary, { key: 'AUTRES', label: 'AUTRES', previous: 0, current: 0, delta: otherDelta }] : primary

  const cumulatives: number[] = [data.previousTotal]

  const points: WaterfallPoint[] = [
    {
      name: data.startLabel,
      start: 0,
      end: Math.max(data.previousTotal, 0),
      labelValue: formatKEur(data.previousTotal),
      fill: COLOR_TOTAL,
      isTotal: true,
    },
  ]

  items.forEach((item) => {
    const before = cumulative
    const after = cumulative + item.delta
    cumulatives.push(before, after)

    points.push({
      name: shortenLabel(item.label.toUpperCase(), angledLabels ? 12 : 16),
      start: before,
      end: after,
      labelValue: `${item.delta >= 0 ? '+' : ''}${formatKEur(item.delta)}`,
      fill: item.delta >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE,
    })

    cumulative = after
  })

  cumulatives.push(data.currentTotal)
  points.push({
    name: data.endLabel,
    start: 0,
    end: Math.max(data.currentTotal, 0),
    labelValue: formatKEur(data.currentTotal),
    fill: COLOR_TOTAL,
    isTotal: true,
  })

  const yMin = Math.max(0, data.previousTotal * 0.6)
  const yMax = Math.max(...cumulatives, data.previousTotal, data.currentTotal) * 1.08
  const ticks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) / 4) * index)

  const width = 1000
  const height = 330
  const margin = {
    top: 34,
    right: 24,
    bottom: 82,
    left: 72,
  }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const bottomY = margin.top + plotHeight
  const step = plotWidth / Math.max(points.length, 1)
  const barWidth = Math.max(12, Math.min(72, step * 0.58))

  function y(value: number) {
    const clamped = Math.max(yMin, Math.min(yMax, value))
    return margin.top + ((yMax - clamped) / Math.max(1, yMax - yMin)) * plotHeight
  }

  return (
    <div className="h-[330px] w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
        {ticks.map((tick) => {
          const yy = y(tick)
          return (
            <g key={`tick-${tick}`}>
              <line x1={margin.left} x2={width - margin.right} y1={yy} y2={yy} stroke={COLOR_GRID} strokeDasharray="5 5" />
              <text x={margin.left - 10} y={yy + 4} textAnchor="end" className="fill-slate-500 text-[12px] font-black">
                {formatKEur(tick).replace(' K€', 'k€')}
              </text>
            </g>
          )
        })}

        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={bottomY} stroke="#9ca3af" strokeWidth={1.4} />
        <line x1={margin.left} x2={width - margin.right} y1={bottomY} y2={bottomY} stroke="#9ca3af" strokeWidth={1.4} />

        {points.map((point, index) => {
          const centerX = margin.left + step * index + step / 2
          const x0 = centerX - barWidth / 2
          const rawTop = point.isTotal ? point.end : Math.max(point.start, point.end)
          const rawBottom = point.isTotal ? yMin : Math.min(point.start, point.end)
          const yTop = y(rawTop)
          const yBottom = y(rawBottom)
          const rectHeight = Math.max(3, yBottom - yTop)
          const labelY = Math.max(16, yTop - 8)

          return (
            <g key={`${point.name}-${index}`}>
              <rect
                x={x0}
                y={yTop}
                width={barWidth}
                height={rectHeight}
                rx={4}
                fill={point.fill}
                stroke="#0b3140"
                strokeWidth={2.4}
              >
                <title>{`${point.name} : ${point.labelValue}`}</title>
              </rect>

              <text x={centerX} y={labelY} textAnchor="middle" className="fill-slate-950 text-[13px] font-black">
                {point.labelValue}
              </text>

              {angledLabels ? (
                <text
                  x={centerX}
                  y={bottomY + 24}
                  transform={`rotate(-32 ${centerX} ${bottomY + 24})`}
                  textAnchor="end"
                  className="fill-slate-950 text-[12px] font-black"
                >
                  {point.name}
                </text>
              ) : (
                <text x={centerX} y={bottomY + 26} textAnchor="middle" className="fill-slate-950 text-[12px] font-black">
                  {point.name}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function IndicateursCaMargePage() {
  const [rawFactureRows, setRawFactureRows] = useState<RawAggRow[]>([])
  const [rawActivityRows, setRawActivityRows] = useState<RawAggRow[]>([])
  const [rows, setRows] = useState<AggRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedYears, setSelectedYears] = useState<number[]>([])
  const [filters, setFilters] = useState<Filters>({
    periodes: [],
    collaborateurs: [],
    agencesCollaborateurs: [],
    tiers: [],
    famillesMacro: [],
    activityOption: 'ACTIVITE_MOIS',
    horsStatistique: 'non',
  })

  const [chartMetric, setChartMetric] = useState<ChartMetric>('ca')
  const [chartVision, setChartVision] = useState<ChartVision>('cumul')
  const [bridgeAgencyVision, setBridgeAgencyVision] = useState<BridgeVision>('mois')
  const [bridgeFamilyVision, setBridgeFamilyVision] = useState<BridgeVision>('mois')
  const [tableMode, setTableMode] = useState<TableMode>('collaborateur')
  const [detailMode, setDetailMode] = useState<DetailMode>('tiers')
  const [detailContext, setDetailContext] = useState<DetailContext | null>(null)
  const [detailSort, setDetailSort] = useState<DetailSort>({ key: 'ca_ht', direction: 'desc' })

  const activityEnabled = filters.activityOption !== 'NON'

  async function loadData() {
    setLoading(true)
    setError(null)

    try {
      const [facturesData, activiteData] = await Promise.all([
        fetchAllFromTable(AGG_TABLE_NAME),
        fetchAllFromTable(ACTIVITY_AGG_TABLE_NAME),
      ])

      const normalizedFactures = facturesData.map((row) => normalizeAggRow(row, 'facture')).filter((r) => r.annee && r.mois)
      const normalizedActivite = activiteData.map((row) => normalizeAggRow(row, 'activite')).filter((r) => r.annee && r.mois && r.type_document !== 'FACTURE')

      const normalizedRows = [...normalizedFactures, ...normalizedActivite]

      setRawFactureRows(facturesData)
      setRawActivityRows(activiteData)
      setRows(normalizedRows)

      const allowedAgences = await fetchAllowedAgencesForCurrentUser()
      const availableAgences = getUnique(normalizedRows.map((r) => r.agence_collaborateur))
      const matchedAgences = resolveAllowedAgences(allowedAgences, availableAgences)

      if (matchedAgences.length) {
        setFilters((prev) => ({
          ...prev,
          agencesCollaborateurs: matchedAgences,
        }))
      }

      const factureYears = Array.from(new Set(normalizedFactures.map((r) => r.annee))).sort((a, b) => b - a)
      setSelectedYears((prev) => {
        const stillValid = prev.filter((y) => factureYears.includes(y))
        if (stillValid.length) return stillValid.slice(0, 3)

        const preferred = [2026, 2025].filter((y) => factureYears.includes(y))
        return (preferred.length ? preferred : factureYears.slice(0, 2)).slice(0, 3)
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function toggleYear(year: number) {
    setSelectedYears((prev) => {
      const exists = prev.includes(year)
      const next = exists ? prev.filter((y) => y !== year) : [...prev, year]
      return next.sort((a, b) => b - a).slice(0, 3)
    })
  }

  const availableFilters = useMemo(() => {
    const factureYears = rows.filter((r) => r.source === 'facture').map((r) => r.annee)
    return {
      years: Array.from(new Set<number>(factureYears)).sort((a, b) => b - a),
      periodes: getUnique(rows.map((r) => r.periode)).sort(),
      collaborateurs: getUnique(rows.map((r) => r.collaborateur)),
      agencesCollaborateurs: getUnique(rows.map((r) => r.agence_collaborateur)),
      tiers: getUnique(rows.map((r) => r.intitule_tiers || r.numero_tiers)),
      famillesMacro: getUnique(rows.map((r) => r.famille_macro)),
    }
  }, [rows])

  const rowsAllowedByActivity = useMemo(() => {
    return rows.filter((row) => {
      if (row.source === 'facture') return true
      return activityMatches(filters.activityOption, row)
    })
  }, [rows, filters.activityOption])

  const baseFilteredRows = useMemo(() => {
    return rowsAllowedByActivity.filter((row) => {
      const tiersLabel = row.intitule_tiers || row.numero_tiers || ''
      if (filters.periodes.length && !filters.periodes.includes(row.periode)) return false
      if (filters.collaborateurs.length && !filters.collaborateurs.includes(row.collaborateur || '')) return false
      if (filters.agencesCollaborateurs.length && !filters.agencesCollaborateurs.includes(row.agence_collaborateur || '')) return false
      if (filters.tiers.length && !filters.tiers.includes(tiersLabel)) return false
      if (filters.famillesMacro.length && !filters.famillesMacro.includes(row.famille_macro || '')) return false
      if (filters.horsStatistique === 'non' && row.hors_statistique) return false
      if (filters.horsStatistique === 'oui' && !row.hors_statistique) return false
      return true
    })
  }, [rowsAllowedByActivity, filters])

  const filteredRows = useMemo(() => {
    if (!selectedYears.length) return []
    return baseFilteredRows.filter((row) => selectedYears.includes(row.annee))
  }, [baseFilteredRows, selectedYears])

  const years = useMemo(() => {
    const sorted = [...selectedYears].sort((a, b) => b - a)
    return {
      n: sorted[0] || CURRENT_YEAR,
      n1: sorted[1] || CURRENT_YEAR - 1,
      n2: sorted[2] || CURRENT_YEAR - 2,
      allDesc: sorted,
      allAsc: [...sorted].sort((a, b) => a - b),
    }
  }, [selectedYears])

  const analysisMonth = useMemo(() => {
    const selectedMonths = filters.periodes
      .map((periode) => Number(String(periode).slice(5, 7)))
      .filter(Boolean)

    if (selectedMonths.length) return Math.max(...selectedMonths)
    return CURRENT_MONTH
  }, [filters.periodes])

  const analysisMonthLabel = String(analysisMonth).padStart(2, '0')
  const ytdLabel = `01-${analysisMonthLabel}`

  const kpis = useMemo(() => {
    const { ca, marge, margePct, nbLignes } = sumRows(filteredRows)
    return { ca, marge, margePct, lignes: nbLignes, lignesAgregees: filteredRows.length }
  }, [filteredRows])

  const documentScopeSummaryText = useMemo(() => {
    if (filters.activityOption === 'NON') return 'Prise en compte des documents factures uniquement.'
    if (filters.activityOption === 'TOUS') return 'Prise en compte des documents factures + documents BL, BR, PL et CDC.'
    return `Prise en compte des documents factures + ${activityLabel(filters.activityOption)}.`
  }, [filters.activityOption])

  const activeFilterSummaryText = useMemo(() => {
    const parts: string[] = []
    if (filters.agencesCollaborateurs.length) parts.push(`Agence : ${filters.agencesCollaborateurs.join(', ')}`)
    if (filters.collaborateurs.length) parts.push(`Collaborateur : ${filters.collaborateurs.join(', ')}`)
    if (filters.tiers.length) parts.push(`Tiers : ${filters.tiers.slice(0, 4).join(', ')}${filters.tiers.length > 4 ? '…' : ''}`)
    if (filters.famillesMacro.length) parts.push(`Famille macro : ${filters.famillesMacro.join(', ')}`)
    if (filters.periodes.length) parts.push(`Période : ${filters.periodes.join(', ')}`)
    parts.push(`Article hors statistique : ${filters.horsStatistique === 'non' ? 'Non' : filters.horsStatistique === 'oui' ? 'Oui uniquement' : 'Tous'}`)
    return parts.join(' / ')
  }, [filters])

  const headerDateText = useMemo(() => {
    const factures = rows.filter((r) => r.source === 'facture')
    const activites = rows.filter((r) => r.source === 'activite')
    return `(Doc facture : dern. MAJ le ${maxUpdatedAt(factures)}. Doc BL, BR, PL, CDC : dern. MAJ le ${maxUpdatedAt(activites)})`
  }, [rows])

  function rowsForPeriod(year: number, mode: 'month' | 'ytd' | 'total') {
    return baseFilteredRows.filter((row) => {
      if (row.annee !== year) return false
      if (mode === 'month') return row.mois === analysisMonth
      if (mode === 'ytd') return row.mois >= 1 && row.mois <= analysisMonth
      return true
    })
  }

  const executiveSummary = useMemo(() => {
    const periods: Array<{ key: 'month' | 'ytd' | 'total'; label: string }> = [
      { key: 'month', label: analysisMonthLabel },
      { key: 'ytd', label: ytdLabel },
      { key: 'total', label: 'Total' },
    ]

    return periods.map((period) => {
      const current = sumRows(rowsForPeriod(years.n, period.key))
      const previous = sumRows(rowsForPeriod(years.n1, period.key))
      const deltaCa = current.ca - previous.ca
      const deltaMargePts = current.ca && previous.ca ? current.margePct - previous.margePct : null
      return { period, current, previous, deltaCa, deltaMargePts, evoCaPct: calcEvolution(current.ca, previous.ca) }
    })
  }, [baseFilteredRows, years.n, years.n1, analysisMonth, analysisMonthLabel, ytdLabel])

  const monthlyChartData = useMemo(() => {
    return MONTHS.map((label, index) => {
      const mois = index + 1
      const item: Record<string, any> = { mois, monthLabel: label.slice(0, 3) }

      years.allDesc.forEach((year) => {
        const yearRows = baseFilteredRows.filter((r) => r.annee === year && r.mois === mois)
        const factRows = yearRows.filter((r) => r.source === 'facture')
        const activityRows = yearRows.filter((r) => r.source === 'activite')
        const yearTotal = sumRows(yearRows)
        const factTotal = sumRows(factRows)

        item[`ca_${year}`] = yearTotal.ca
        item[`marge_${year}`] = yearTotal.marge
        item[`margePct_${year}`] = yearTotal.margePct
        item[`caFacture_${year}`] = factTotal.ca
        item[`caBLMois_${year}`] = sumRows(activityRows.filter((r) => r.type_document === 'BL mois')).ca
        item[`caBLFrigo_${year}`] = sumRows(activityRows.filter((r) => r.type_document === 'BL frigo')).ca
        item[`caPL_${year}`] = sumRows(activityRows.filter((r) => r.type_document === 'PL')).ca
        item[`caCDC_${year}`] = sumRows(activityRows.filter((r) => r.type_document === 'CDC')).ca
        item[`caBR_${year}`] = sumRows(activityRows.filter((r) => r.type_document === 'BR')).ca
      })

      return item
    })
  }, [baseFilteredRows, years.allDesc])

  const cumulativeChartData = useMemo(() => {
    const cumulativeByYear: Record<number, { ca: number; marge: number }> = {}
    years.allDesc.forEach((year) => {
      cumulativeByYear[year] = { ca: 0, marge: 0 }
    })

    return monthlyChartData.map((row) => {
      const item: Record<string, any> = { mois: row.mois, monthLabel: row.monthLabel }
      years.allDesc.forEach((year) => {
        cumulativeByYear[year].ca += Number(row[`ca_${year}`] || 0)
        cumulativeByYear[year].marge += Number(row[`marge_${year}`] || 0)
        item[`ca_${year}`] = cumulativeByYear[year].ca
        item[`marge_${year}`] = cumulativeByYear[year].marge
        item[`margePct_${year}`] = cumulativeByYear[year].ca ? (cumulativeByYear[year].marge / cumulativeByYear[year].ca) * 100 : 0
      })
      return item
    })
  }, [monthlyChartData, years.allDesc])

  function getChartColor(year: number) {
    if (year === years.n) return COLOR_N
    if (year === years.n1) return COLOR_N1
    return COLOR_N2
  }

  function buildBridge(groupKey: keyof Pick<AggRow, 'agence_collaborateur' | 'famille_macro'>, vision: BridgeVision): BridgeData {
    const currentRows = baseFilteredRows.filter((r) => r.annee === years.n && (vision === 'mois' ? r.mois === analysisMonth : r.mois <= analysisMonth))
    const previousRows = baseFilteredRows.filter((r) => r.annee === years.n1 && (vision === 'mois' ? r.mois === analysisMonth : r.mois <= analysisMonth))

    const currentByGroup = new Map<string, number>()
    const previousByGroup = new Map<string, number>()

    currentRows.forEach((row) => currentByGroup.set(String(row[groupKey] || 'NON RENSEIGNE'), (currentByGroup.get(String(row[groupKey] || 'NON RENSEIGNE')) || 0) + row.ca_ht))
    previousRows.forEach((row) => previousByGroup.set(String(row[groupKey] || 'NON RENSEIGNE'), (previousByGroup.get(String(row[groupKey] || 'NON RENSEIGNE')) || 0) + row.ca_ht))

    const keys = Array.from(new Set([...currentByGroup.keys(), ...previousByGroup.keys()]))
    const items = keys.map((key) => {
      const previous = previousByGroup.get(key) || 0
      const current = currentByGroup.get(key) || 0
      return { key, label: key, previous, current, delta: current - previous }
    }).filter((item) => Math.abs(item.delta) >= 1)

    const periodLabel = vision === 'mois' ? analysisMonthLabel : ytdLabel
    return {
      title: `${periodLabel} : BRIDGE CA PAR ${groupKey === 'agence_collaborateur' ? 'AGENCE' : 'FAMILLE MACRO'} N-1 => N`,
      startLabel: `CA ${years.n1}`,
      endLabel: `CA ${years.n}`,
      previousTotal: previousRows.reduce((s, r) => s + r.ca_ht, 0),
      currentTotal: currentRows.reduce((s, r) => s + r.ca_ht, 0),
      items,
    }
  }

  const bridgeAgencyData = useMemo(() => buildBridge('agence_collaborateur', bridgeAgencyVision), [baseFilteredRows, years.n, years.n1, analysisMonth, ytdLabel, bridgeAgencyVision])
  const bridgeFamilyData = useMemo(() => buildBridge('famille_macro', bridgeFamilyVision), [baseFilteredRows, years.n, years.n1, analysisMonth, ytdLabel, bridgeFamilyVision])

  const recap = useMemo(() => {
    const selectedCollaborateurs = filters.collaborateurs.length ? filters.collaborateurs : availableFilters.collaborateurs
    const selectedAgences = filters.agencesCollaborateurs.length ? filters.agencesCollaborateurs : availableFilters.agencesCollaborateurs

    const entities = tableMode === 'collaborateur' ? selectedCollaborateurs : selectedAgences

    const rowsByMonth = MONTHS.map((label, index) => {
      const mois = index + 1
      const values: Record<string, RecapValue> = {}

      entities.forEach((entity) => {
        const current = baseFilteredRows.filter((r) => r.annee === years.n && r.mois === mois && (tableMode === 'collaborateur' ? r.collaborateur === entity : r.agence_collaborateur === entity))
        const previous = baseFilteredRows.filter((r) => r.annee === years.n1 && r.mois === mois && (tableMode === 'collaborateur' ? r.collaborateur === entity : r.agence_collaborateur === entity))
        values[entity] = makeRecap(current, previous)
      })

      const totalCurrent = baseFilteredRows.filter((r) => r.annee === years.n && r.mois === mois)
      const totalPrevious = baseFilteredRows.filter((r) => r.annee === years.n1 && r.mois === mois)
      return { mois, monthLabel: label.toUpperCase(), values, total: makeRecap(totalCurrent, totalPrevious) }
    })

    const entityTotals: Record<string, RecapValue> = {}
    entities.forEach((entity) => {
      const current = baseFilteredRows.filter((r) => r.annee === years.n && r.mois <= analysisMonth && (tableMode === 'collaborateur' ? r.collaborateur === entity : r.agence_collaborateur === entity))
      const previous = baseFilteredRows.filter((r) => r.annee === years.n1 && r.mois <= analysisMonth && (tableMode === 'collaborateur' ? r.collaborateur === entity : r.agence_collaborateur === entity))
      entityTotals[entity] = makeRecap(current, previous)
    })

    const grandTotal = makeRecap(
      baseFilteredRows.filter((r) => r.annee === years.n && r.mois <= analysisMonth),
      baseFilteredRows.filter((r) => r.annee === years.n1 && r.mois <= analysisMonth),
    )

    return { entities, rows: rowsByMonth, entityTotals, grandTotal }
  }, [filters.collaborateurs, filters.agencesCollaborateurs, availableFilters.collaborateurs, availableFilters.agencesCollaborateurs, baseFilteredRows, years.n, years.n1, tableMode, analysisMonth])

  function rowsForDetail(context: DetailContext, year: number) {
    return baseFilteredRows.filter((row) => {
      if (row.annee !== year) return false
      if (context.month && row.mois !== context.month) return false
      if (!context.month && row.mois > analysisMonth) return false
      if (context.collaborateur && row.collaborateur !== context.collaborateur) return false
      if (context.agence && row.agence_collaborateur !== context.agence) return false
      return true
    })
  }

  const rawDetailRows = useMemo<DetailRow[]>(() => {
    if (!detailContext) return []
    return rowsForDetail(detailContext, detailContext.year).map((row, index) => ({
      id: `${row.source}-${row.type_document}-${row.annee}-${row.mois}-${row.collaborateur}-${row.numero_tiers}-${row.famille_macro}-${index}`,
      niveau: 'Agrégat',
      source: row.source,
      type_piece: row.source === 'facture' ? 'Factures' : row.type_document,
      periode: row.periode,
      numero_tiers: row.numero_tiers,
      intitule_tiers: row.intitule_tiers,
      collaborateur: row.collaborateur,
      agence: row.agence_collaborateur,
      famille_macro: row.famille_macro,
      quantite: row.quantite,
      ca_ht: row.ca_ht,
      marge_valeur: row.marge_valeur,
      marge_pct: row.ca_ht ? (row.marge_valeur / row.ca_ht) * 100 : 0,
      nb_lignes: row.nb_lignes,
    }))
  }, [detailContext, baseFilteredRows, analysisMonth])

  const rawPreviousDetailRows = useMemo<DetailRow[]>(() => {
    if (!detailContext) return []
    return rowsForDetail(detailContext, detailContext.year - 1).map((row, index) => ({
      id: `prev-${row.source}-${row.type_document}-${row.annee}-${row.mois}-${row.collaborateur}-${row.numero_tiers}-${row.famille_macro}-${index}`,
      niveau: 'Agrégat N-1',
      source: row.source,
      type_piece: row.source === 'facture' ? 'Factures' : row.type_document,
      periode: row.periode,
      numero_tiers: row.numero_tiers,
      intitule_tiers: row.intitule_tiers,
      collaborateur: row.collaborateur,
      agence: row.agence_collaborateur,
      famille_macro: row.famille_macro,
      quantite: row.quantite,
      ca_ht: row.ca_ht,
      marge_valeur: row.marge_valeur,
      marge_pct: row.ca_ht ? (row.marge_valeur / row.ca_ht) * 100 : 0,
      nb_lignes: row.nb_lignes,
    }))
  }, [detailContext, baseFilteredRows, analysisMonth])

  function aggregateDetail(source: DetailRow[]) {
    if (detailMode === 'agregats') return source.slice(0, 1000)
    const map = new Map<string, DetailRow>()

    source.forEach((row) => {
      const key = detailMode === 'tiers'
        ? `${row.numero_tiers}|${row.intitule_tiers}`
        : `${row.source}|${row.type_piece}|${row.periode}|${row.numero_tiers}|${row.collaborateur}|${row.agence}`

      const existing = map.get(key)
      if (existing) {
        existing.ca_ht += row.ca_ht
        existing.marge_valeur += row.marge_valeur
        existing.quantite += row.quantite
        existing.nb_lignes += row.nb_lignes
        existing.marge_pct = existing.ca_ht ? (existing.marge_valeur / existing.ca_ht) * 100 : 0
      } else {
        map.set(key, { ...row, id: key, niveau: detailMode === 'tiers' ? 'Tiers' : 'Document' })
      }
    })

    return Array.from(map.values())
  }

  const detailRows = useMemo(() => {
    const currentRows = aggregateDetail(rawDetailRows)
    const previousRows = aggregateDetail(rawPreviousDetailRows)
    const previousByTiers = new Map(previousRows.map((row) => [`${row.numero_tiers}|${row.intitule_tiers}`, row]))

    const enriched = currentRows.map((row) => {
      if (detailMode !== 'tiers') return row
      const previous = previousByTiers.get(`${row.numero_tiers}|${row.intitule_tiers}`)
      const caN1 = previous?.ca_ht || 0
      const margeN1 = previous?.marge_valeur || 0
      const margePctN1 = caN1 ? (margeN1 / caN1) * 100 : 0
      return {
        ...row,
        ca_ht_n1: caN1,
        marge_valeur_n1: margeN1,
        marge_pct_n1: margePctN1,
        evo_ca_pct_n1: calcEvolution(row.ca_ht, caN1),
        evo_marge_points_n1: row.ca_ht && caN1 ? row.marge_pct - margePctN1 : null,
      }
    })

    return enriched.sort((a, b) => {
      const av = detailSortValue(a, detailSort.key)
      const bv = detailSortValue(b, detailSort.key)
      const direction = detailSort.direction === 'asc' ? 1 : -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction
      return String(av).localeCompare(String(bv), 'fr') * direction
    }).slice(0, 1000)
  }, [rawDetailRows, rawPreviousDetailRows, detailMode, detailSort])

  const detailNbClients = useMemo(() => new Set(rawDetailRows.map((row) => `${row.numero_tiers}|${row.intitule_tiers}`)).size, [rawDetailRows])
  const detailNbDocuments = useMemo(() => new Set(rawDetailRows.map((row) => `${row.source}|${row.type_piece}|${row.periode}|${row.numero_tiers}`)).size, [rawDetailRows])

  function openDetail(context: DetailContext) {
    setDetailContext(context)
  }

  function toggleDetailSort(key: DetailSortKey) {
    setDetailSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }))
  }

  function SortableTh({ label, sortKey, align = 'left' }: { label: string; sortKey: DetailSortKey; align?: 'left' | 'right' }) {
    const active = detailSort.key === sortKey
    return (
      <th onClick={() => toggleDetailSort(sortKey)} className={`cursor-pointer whitespace-nowrap border border-slate-200 px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} hover:bg-slate-100`}>
        <span className="inline-flex items-center gap-1">{label}<span className="text-[10px] text-slate-400">{active ? (detailSort.direction === 'desc' ? '▼' : '▲') : '↕'}</span></span>
      </th>
    )
  }

  function DetailCell({ value, context }: { value: RecapValue | undefined; context: DetailContext }) {
    const v = value || emptyRecap()
    return (
      <button type="button" onClick={() => openDetail(context)} className="block w-full rounded-lg px-2 py-1 text-right hover:bg-blue-50 hover:text-blue-700" title="Afficher le détail">
        <div className="font-black">{formatNumber(v.ca)}</div>
      </button>
    )
  }


  function MonthEvolutionBadge({ month, value }: { month: number; value: number | null }) {
    if (month > CURRENT_MONTH) return <span className="inline-block min-h-7 min-w-16" />
    return <EvolutionBadge value={value} />
  }

  function exportRecap() {
    const rows = recap.rows.flatMap((row) => [
      {
        niveau: 'Total',
        mois: row.monthLabel,
        ca: Math.round(row.total.ca),
        marge: Math.round(row.total.marge),
        marge_pct: row.total.margePct.toFixed(1),
        ca_n1: Math.round(row.total.caN1),
        evolution_ca_pct: row.total.evoCa === null ? '' : row.total.evoCa.toFixed(1),
      },
      ...recap.entities.map((entity) => {
        const v = row.values[entity] || emptyRecap()
        return {
          niveau: tableMode,
          entite: entity,
          mois: row.monthLabel,
          ca: Math.round(v.ca),
          marge: Math.round(v.marge),
          marge_pct: v.margePct.toFixed(1),
          ca_n1: Math.round(v.caN1),
          evolution_ca_pct: v.evoCa === null ? '' : v.evoCa.toFixed(1),
        }
      }),
    ])
    downloadCsv(`indicateur_recap_${tableMode}.csv`, rows)
  }

  function exportDetail() {
    const rows = detailRows.map((row) => ({
      niveau: row.niveau,
      source: row.source,
      type_piece: row.type_piece,
      periode: row.periode,
      numero_tiers: row.numero_tiers,
      intitule_tiers: row.intitule_tiers,
      collaborateur: row.collaborateur,
      agence: row.agence,
      famille_macro: row.famille_macro,
      lignes: row.nb_lignes,
      quantite: row.quantite,
      ca_ht: row.ca_ht,
      marge_valeur: row.marge_valeur,
      marge_pct: row.marge_pct,
      ca_ht_n1: row.ca_ht_n1 ?? '',
      marge_pct_n1: row.marge_pct_n1 ?? '',
      evo_ca_pct_n1: row.evo_ca_pct_n1 ?? '',
      evo_marge_points_n1: row.evo_marge_points_n1 ?? '',
    }))
    downloadCsv('indicateur_detail.csv', rows)
  }

  function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
      <button type="button" onClick={onClick} className={`rounded-lg border px-4 py-2 text-sm font-black ${active ? 'border-[#0b3140] bg-[#1f6f89] text-white' : 'border-[#0b3140] bg-white text-slate-900'}`}>
        {children}
      </button>
    )
  }

  function ExecutiveSummaryCard() {
    const previous = executiveSummary.map((x) => x.previous)
    const current = executiveSummary.map((x) => x.current)

    return (
      <section className="rounded-[2.5rem] border-[3px] border-[#0b3140] bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-center text-xl font-black uppercase tracking-tight text-slate-900">
          Suivi du CA et marge <span className="text-base font-normal normal-case">(facturation + activité si filtre activé)</span>
        </h2>

        <div className="grid grid-cols-[132px_repeat(3,minmax(0,1fr))] gap-4">
          <div />
          {executiveSummary.map((col) => (
            <div key={col.period.key} className="rounded-xl bg-[#1f6f89] px-4 py-3 text-center text-2xl font-black text-white">
              {col.period.label}
            </div>
          ))}

          <div className="flex items-center justify-center rounded-xl bg-[#1f6f89] px-4 py-5 text-3xl font-black text-white">{years.n1}</div>
          {previous.map((item, idx) => (
            <div key={`prev-${idx}`} className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-orange-300 bg-slate-200 px-3 py-4 text-center">
              <div className="whitespace-nowrap text-2xl font-black">{formatKEur(item.ca)}</div>
              <div className="mt-1 whitespace-nowrap text-xl font-black">{formatRate(item.margePct)}</div>
            </div>
          ))}

          <div className="flex items-center justify-center rounded-xl bg-[#1f6f89] px-4 py-5 text-3xl font-black text-white">{years.n}</div>
          {current.map((item, idx) => (
            <div key={`curr-${idx}`} className="flex min-h-24 flex-col items-center justify-center rounded-2xl border border-orange-300 bg-slate-200 px-3 py-4 text-center">
              <div className="whitespace-nowrap text-2xl font-black">{formatKEur(item.ca)}</div>
              <div className="mt-1 whitespace-nowrap text-xl font-black">{formatRate(item.margePct)}</div>
            </div>
          ))}

          <div className="flex items-center justify-center whitespace-nowrap rounded-xl bg-[#1f6f89] px-3 py-2 text-center text-base font-black text-white">CA vs N-1</div>
          {executiveSummary.map((item) => (
            <div key={`delta-ca-${item.period.key}`} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-orange-300 px-2 py-2 text-center text-lg font-black ${item.deltaCa >= 0 ? 'bg-emerald-100' : 'bg-orange-100'}`}>
              <span className="whitespace-nowrap">{formatKEur(item.deltaCa)}</span>
              <EvolutionBadge value={item.evoCaPct} large />
            </div>
          ))}

          <div className="flex items-center justify-center whitespace-nowrap rounded-xl bg-[#1f6f89] px-3 py-2 text-center text-base font-black text-white">Marge vs N-1</div>
          {executiveSummary.map((item) => (
            <div key={`delta-marge-${item.period.key}`} className={`flex min-h-12 items-center justify-center rounded-2xl border border-orange-300 px-2 py-2 text-center ${Number(item.deltaMargePts || 0) >= 0 ? 'bg-emerald-50' : 'bg-orange-50'}`}>
              <EvolutionBadge value={item.deltaMargePts} mode="points" large />
            </div>
          ))}
        </div>
      </section>
    )
  }

  function MainChartCard() {
    const data = chartVision === 'cumul' ? cumulativeChartData : monthlyChartData
    const isPercent = chartMetric === 'margePct'

    return (
      <section className="rounded-[2.5rem] border-[3px] border-[#0b3140] bg-white p-6 shadow-sm">
        <div className="mb-4 grid items-start gap-4 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div>
            <SelectHint title="Cliquer pour choisir l'indicateur" />
            <div className="flex gap-2 whitespace-nowrap">
              <ToggleButton active={chartMetric === 'ca'} onClick={() => setChartMetric('ca')}>CA</ToggleButton>
              <ToggleButton active={chartMetric === 'margePct'} onClick={() => setChartMetric('margePct')}>Marge %</ToggleButton>
            </div>
          </div>

          <div className="min-w-0 pt-8 xl:pt-0">
            <h2 className="text-xl font-black whitespace-nowrap">{chartMetric === 'ca' ? 'CA' : 'Marge %'} {chartVision === 'cumul' ? 'cumulé' : 'mensuel'}</h2>
            <p className="truncate text-sm font-semibold text-slate-500">
              Les années sélectionnées sont affichées. En CA mensuel, l’activité sélectionnée est empilée sur N.
            </p>
          </div>

          <div>
            <SelectHint title="Cliquer pour changer la vision" />
            <div className="flex gap-2 whitespace-nowrap">
              <ToggleButton active={chartVision === 'mensuel'} onClick={() => setChartVision('mensuel')}>Mensuel</ToggleButton>
              <ToggleButton active={chartVision === 'cumul'} onClick={() => setChartVision('cumul')}>Cumul</ToggleButton>
            </div>
          </div>
        </div>

        <div className="h-[430px]">
          <ResponsiveContainer width="100%" height="100%">
            {chartVision === 'mensuel' ? (
              <BarChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke={COLOR_GRID} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 13, fontWeight: 700 }} />
                <YAxis tickFormatter={(v) => isPercent ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k€`} tick={{ fontSize: 12, fontWeight: 700 }} />
                <Tooltip content={<CustomTooltip mode={isPercent ? 'percent' : 'currency'} />} />
                <Legend />
                {isPercent ? years.allDesc.map((year) => (
                  <Bar key={year} dataKey={`margePct_${year}`} name={`${year}`} fill={getChartColor(year)} />
                )) : (
                  <>
                    {years.allDesc.filter((year) => year !== years.n).map((year) => (
                      <Bar key={year} dataKey={`ca_${year}`} name={`${year}`} fill={getChartColor(year)} />
                    ))}
                    {activityEnabled ? (
                      <>
                        <Bar dataKey={`caFacture_${years.n}`} name={`${years.n} facturé`} stackId="n" fill={COLOR_N} />
                        <Bar dataKey={`caBLFrigo_${years.n}`} name="BL frigo" stackId="n" fill={COLOR_ACT_BL_FRIGO} />
                        <Bar dataKey={`caBLMois_${years.n}`} name="BL mois" stackId="n" fill={COLOR_ACT_BL_MOIS} />
                        <Bar dataKey={`caBR_${years.n}`} name="BR" stackId="n" fill={COLOR_ACT_BR} />
                        <Bar dataKey={`caPL_${years.n}`} name="PL" stackId="n" fill={COLOR_ACT_PL} />
                        <Bar dataKey={`caCDC_${years.n}`} name="CDC" stackId="n" fill={COLOR_ACT_CDC} />
                      </>
                    ) : (
                      <Bar dataKey={`ca_${years.n}`} name={`${years.n}`} fill={COLOR_N} />
                    )}
                  </>
                )}
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke={COLOR_GRID} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 13, fontWeight: 700 }} />
                <YAxis tickFormatter={(v) => isPercent ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k€`} tick={{ fontSize: 12, fontWeight: 700 }} />
                <Tooltip content={<CustomTooltip mode={isPercent ? 'percent' : 'currency'} />} />
                <Legend />
                {years.allDesc.map((year) => (
                  <Line key={year} type="monotone" dataKey={`${chartMetric}_${year}`} name={`${year}`} stroke={getChartColor(year)} strokeWidth={4} dot={{ r: 2 }} activeDot={{ r: 6 }} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>
    )
  }

  function BridgeCard({
    title,
    data,
    vision,
    setVision,
    angledLabels = false,
  }: {
    title: string
    data: BridgeData
    vision: BridgeVision
    setVision: (v: BridgeVision) => void
    angledLabels?: boolean
  }) {
    return (
      <section className="rounded-[2.5rem] border-[3px] border-[#0b3140] bg-white p-3 shadow-sm">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
          <PeriodToggle value={vision} onChange={setVision} monthLabel={analysisMonthLabel} />
          <div className="rounded-lg border-2 border-[#0b3140] bg-white px-6 py-2 text-center text-sm font-black uppercase text-slate-900">{title}</div>
        </div>
        <WaterfallChart data={data} angledLabels={angledLabels} />
      </section>
    )
  }

  const detailTotal = useMemo(() => {
    const ca = detailRows.reduce((sum, row) => sum + row.ca_ht, 0)
    const marge = detailRows.reduce((sum, row) => sum + row.marge_valeur, 0)
    const caN1 = detailRows.reduce((sum, row) => sum + (row.ca_ht_n1 || 0), 0)
    const margeN1 = detailRows.reduce((sum, row) => sum + (row.marge_valeur_n1 || 0), 0)
    return {
      ca,
      marge,
      margePct: ca ? (marge / ca) * 100 : 0,
      caN1,
      margePctN1: caN1 ? (margeN1 / caN1) * 100 : 0,
      evoCa: calcEvolution(ca, caN1),
      evoMargePts: ca && caN1 ? (marge / ca) * 100 - (margeN1 / caN1) * 100 : null,
      lignes: detailRows.reduce((sum, row) => sum + row.nb_lignes, 0),
      quantite: detailRows.reduce((sum, row) => sum + row.quantite, 0),
    }
  }, [detailRows])

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[2100px] space-y-5">
        <h1 className="px-1 text-xl tracking-tight text-slate-950">
          <span className="font-black">SUIVI CA et MARGE</span> <span className="font-normal">{headerDateText}</span>
        </h1>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-black">Filtres</h2>
              <p className="text-sm font-semibold text-slate-500">Filtres appliqués sur les tables agrégées mensuelles.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableFilters.years.map((year) => (
                <button key={year} type="button" onClick={() => toggleYear(year)} className={`rounded-xl px-5 py-3 text-sm font-black ${selectedYears.includes(year) ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>{year}</button>
              ))}
              <button type="button" onClick={loadData} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black hover:bg-slate-100">Actualiser</button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <MultiSelectFilter label="Mois / année" values={availableFilters.periodes} selected={filters.periodes} onChange={(v) => updateFilter('periodes', v)} />
            <MultiSelectFilter label="Agence collaborateur" values={availableFilters.agencesCollaborateurs} selected={filters.agencesCollaborateurs} onChange={(v) => updateFilter('agencesCollaborateurs', v)} />
            <MultiSelectFilter label="Collaborateur" values={availableFilters.collaborateurs} selected={filters.collaborateurs} onChange={(v) => updateFilter('collaborateurs', v)} />
            <MultiSelectFilter label="Tiers" values={availableFilters.tiers} selected={filters.tiers} onChange={(v) => updateFilter('tiers', v)} />
            <MultiSelectFilter label="Famille macro" values={availableFilters.famillesMacro} selected={filters.famillesMacro} onChange={(v) => updateFilter('famillesMacro', v)} />
            <ActivityFilter selected={filters.activityOption} onChange={(v) => updateFilter('activityOption', v)} />
            <select value={filters.horsStatistique} onChange={(e) => updateFilter('horsStatistique', e.target.value as Filters['horsStatistique'])} className="h-12 rounded-xl border border-slate-300 bg-white px-3 text-sm font-extrabold">
              <option value="non">Hors statistique : NON</option>
              <option value="oui">Hors statistique : OUI</option>
              <option value="tous">Hors statistique : Tous</option>
            </select>
          </div>

          {loading && <div className="mt-3 rounded-xl bg-slate-50 px-4 py-2 text-sm font-bold text-slate-600">Chargement…</div>}
          {error && <div className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700">{error}</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-sm font-black text-slate-800">{documentScopeSummaryText}</div>
          <div className="mt-1 text-sm font-bold text-slate-700">{activeFilterSummaryText}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            Total filtré : {formatCurrency(kpis.ca)} · Marge {formatRate(kpis.margePct)} · Lignes source : {formatNumber(kpis.lignes)} · Agrégats : {formatNumber(kpis.lignesAgregees)}
          </div>
        </section>

        <section className="grid gap-5 2xl:grid-cols-2">
          <ExecutiveSummaryCard />
          <MainChartCard />
          <BridgeCard title={bridgeAgencyData.title} data={bridgeAgencyData} vision={bridgeAgencyVision} setVision={setBridgeAgencyVision} angledLabels />
          <BridgeCard title={bridgeFamilyData.title} data={bridgeFamilyData} vision={bridgeFamilyVision} setVision={setBridgeFamilyVision} />
        </section>

        <section className="rounded-[2.5rem] border-[3px] border-[#0b3140] bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-xl font-black">Tableau récapitulatif</h2>
              <p className="text-sm font-semibold text-slate-500">Clique sur une cellule pour afficher le détail depuis les tables agrégées.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <button type="button" onClick={exportRecap} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black hover:bg-slate-100">Export Excel</button>
              <div>
                <SelectHint title="Cliquer pour changer la vue" />
                <div className="flex rounded-xl border border-slate-300 bg-white p-1">
                  <button type="button" onClick={() => setTableMode('collaborateur')} className={`rounded-lg px-3 py-1 text-sm font-black ${tableMode === 'collaborateur' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Collaborateurs</button>
                  <button type="button" onClick={() => setTableMode('agence')} className={`rounded-lg px-3 py-1 text-sm font-black ${tableMode === 'agence' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Agences</button>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th rowSpan={2} className="sticky left-0 z-20 border border-slate-200 bg-slate-100 px-3 py-2 text-left">Mois</th>
                  <th colSpan={3} className="border border-slate-200 px-3 py-2 text-center font-black">TOTAL</th>
                  {recap.entities.map((entity) => (
                    <th key={entity} colSpan={3} className="border border-slate-200 px-3 py-2 text-center font-black">{entity}</th>
                  ))}
                </tr>
                <tr className="bg-slate-50">
                  <th className="border border-slate-200 px-3 py-2 text-center">CA</th>
                  <th className="border border-slate-200 px-3 py-2 text-center">Marge €</th>
                  <th className="border border-slate-200 px-3 py-2 text-center">Évol. CA vs N-1</th>
                  {recap.entities.flatMap((entity) => [
                    <th key={`${entity}-ca`} className="border border-slate-200 px-3 py-2 text-center">CA</th>,
                    <th key={`${entity}-marge`} className="border border-slate-200 px-3 py-2 text-center">Marge €</th>,
                    <th key={`${entity}-evo`} className="border border-slate-200 px-3 py-2 text-center">Évol. CA vs N-1</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {recap.rows.map((row) => (
                  <tr key={row.mois} className="hover:bg-slate-50">
                    <td className="sticky left-0 z-10 border border-slate-200 bg-white px-3 py-2 font-black text-slate-700">{row.monthLabel}</td>
                    <td className="border border-slate-200 bg-slate-50 px-3 py-2 text-right"><DetailCell value={row.total} context={{ year: years.n, month: row.mois, monthLabel: row.monthLabel, label: `TOTAL ${row.monthLabel}` }} /></td>
                    <td className="border border-slate-200 bg-slate-50 px-3 py-2 text-right font-bold">{formatNumber(row.total.marge)}</td>
                    <td className="border border-slate-200 bg-slate-50 px-3 py-2 text-right font-bold"><MonthEvolutionBadge month={row.mois} value={row.total.evoCa} /></td>
                    {recap.entities.flatMap((entity) => {
                      const value = row.values[entity] || emptyRecap()
                      return [
                        <td key={`${row.mois}-${entity}-ca`} className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={value} context={{ year: years.n, month: row.mois, monthLabel: row.monthLabel, collaborateur: tableMode === 'collaborateur' ? entity : undefined, agence: tableMode === 'agence' ? entity : undefined, label: `${entity} - ${row.monthLabel}` }} /></td>,
                        <td key={`${row.mois}-${entity}-marge`} className="border border-slate-200 px-3 py-2 text-right text-slate-700">{formatNumber(value.marge)}</td>,
                        <td key={`${row.mois}-${entity}-evo`} className="border border-slate-200 px-3 py-2 text-right text-slate-700"><MonthEvolutionBadge month={row.mois} value={value.evoCa} /></td>,
                      ]
                    })}
                  </tr>
                ))}
                <tr className="bg-slate-100 font-black">
                  <td className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-3 py-3">TOTAL 01-{analysisMonthLabel}</td>
                  <td className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={recap.grandTotal} context={{ year: years.n, monthLabel: `TOTAL 01-${analysisMonthLabel}`, label: `TOTAL 01-${analysisMonthLabel}` }} /></td>
                  <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(recap.grandTotal.marge)}</td>
                  <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={recap.grandTotal.evoCa} /></td>
                  {recap.entities.flatMap((entity) => {
                    const value = recap.entityTotals[entity] || emptyRecap()
                    return [
                      <td key={`total-${entity}-ca`} className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={value} context={{ year: years.n, monthLabel: `TOTAL 01-${analysisMonthLabel}`, collaborateur: tableMode === 'collaborateur' ? entity : undefined, agence: tableMode === 'agence' ? entity : undefined, label: `${entity} - TOTAL 01-${analysisMonthLabel}` }} /></td>,
                      <td key={`total-${entity}-marge`} className="border border-slate-200 px-3 py-2 text-right">{formatNumber(value.marge)}</td>,
                      <td key={`total-${entity}-evo`} className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={value.evoCa} /></td>,
                    ]
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {detailContext && (
          <section className="rounded-[2.5rem] border-[3px] border-[#0b3140] bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-xl font-black">Détail : {detailContext.label}</h2>
                <p className="text-sm font-semibold text-slate-500">
                  {detailMode === 'tiers' ? 'Regroupé par tiers/client' : detailMode === 'documents' ? 'Regroupé par documents/source' : 'Détail des agrégats'} · {formatNumber(rawDetailRows.reduce((s, row) => s + row.nb_lignes, 0))} lignes source lues / Nb de client : {formatNumber(detailNbClients)} / Nb de document : {formatNumber(detailNbDocuments)}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" onClick={exportDetail} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black hover:bg-slate-100">Export Excel</button>
                <div>
                  <SelectHint title="Cliquer pour changer le détail" />
                  <div className="flex rounded-xl border border-slate-300 bg-white p-1">
                    <button type="button" onClick={() => setDetailMode('tiers')} className={`rounded-lg px-3 py-1 text-sm font-black ${detailMode === 'tiers' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Tiers</button>
                    <button type="button" onClick={() => setDetailMode('documents')} className={`rounded-lg px-3 py-1 text-sm font-black ${detailMode === 'documents' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Documents</button>
                    <button type="button" onClick={() => setDetailMode('agregats')} className={`rounded-lg px-3 py-1 text-sm font-black ${detailMode === 'agregats' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Agrégats</button>
                  </div>
                </div>
                <button type="button" onClick={() => setDetailContext(null)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black hover:bg-slate-100">Fermer</button>
              </div>
            </div>

            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <SortableTh label="Niveau" sortKey="niveau" />
                    {detailMode !== 'tiers' && <SortableTh label="Source / type" sortKey="type_piece" />}
                    <SortableTh label="Tiers" sortKey="tiers" />
                    <SortableTh label="Collaborateur" sortKey="collaborateur" />
                    <SortableTh label="Agence" sortKey="agence" />
                    {detailMode !== 'tiers' && <SortableTh label="Famille macro" sortKey="famille_macro" />}
                    <SortableTh label="Lignes" sortKey="nb_lignes" align="right" />
                    <SortableTh label="Quantité" sortKey="quantite" align="right" />
                    <SortableTh label="CA" sortKey="ca_ht" align="right" />
                    <SortableTh label="Marge €" sortKey="marge_valeur" align="right" />
                    <SortableTh label="Marge %" sortKey="marge_pct" align="right" />
                    {detailMode === 'tiers' && <SortableTh label="CA HT N-1" sortKey="ca_ht_n1" align="right" />}
                    {detailMode === 'tiers' && <SortableTh label="Marge % N-1" sortKey="marge_pct_n1" align="right" />}
                    {detailMode === 'tiers' && <SortableTh label="Évol. CA vs N-1" sortKey="evo_ca_pct_n1" align="right" />}
                    {detailMode === 'tiers' && <SortableTh label="Évol. marge pts" sortKey="evo_marge_points_n1" align="right" />}
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="border border-slate-200 px-3 py-2 font-bold">{row.niveau}</td>
                      {detailMode !== 'tiers' && <td className="border border-slate-200 px-3 py-2">{row.type_piece}</td>}
                      <td className="border border-slate-200 px-3 py-2">{row.numero_tiers} · {row.intitule_tiers}</td>
                      <td className="border border-slate-200 px-3 py-2">{row.collaborateur}</td>
                      <td className="border border-slate-200 px-3 py-2">{row.agence}</td>
                      {detailMode !== 'tiers' && <td className="border border-slate-200 px-3 py-2">{row.famille_macro}</td>}
                      <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.nb_lignes)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.quantite)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-black">{formatNumber(row.ca_ht)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.marge_valeur)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-right">{formatRate(row.marge_pct)}</td>
                      {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.ca_ht_n1 || 0)}</td>}
                      {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right">{formatRate(row.marge_pct_n1 || 0)}</td>}
                      {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={row.evo_ca_pct_n1 ?? null} /></td>}
                      {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={row.evo_marge_points_n1 ?? null} mode="points" /></td>}
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-black">
                    <td colSpan={detailMode === 'tiers' ? 5 : 7} className="border border-slate-200 px-3 py-2">TOTAL AFFICHÉ</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailTotal.lignes)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailTotal.quantite)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailTotal.ca)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailTotal.marge)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatRate(detailTotal.margePct)}</td>
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailTotal.caN1)}</td>}
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right">{formatRate(detailTotal.margePctN1)}</td>}
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={detailTotal.evoCa} /></td>}
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={detailTotal.evoMargePts} mode="points" /></td>}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
