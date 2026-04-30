'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
type ActivityType = 'NON' | 'BL mois' | 'BL frigo' | 'PL' | 'CDC' | 'BR'
type TableMode = 'collaborateur' | 'agence'
type DetailMode = 'tiers' | 'factures' | 'lignes'

type AggRow = {
  source: SourceType
  type_document: 'FACTURE' | Exclude<ActivityType, 'NON'>
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
}

type Filters = {
  periodes: string[]
  activitesNonFacturees: ActivityType[]
  collaborateurs: string[]
  agencesCollaborateurs: string[]
  tiers: string[]
  famillesMacro: string[]
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

type YearKpi = {
  year: number
  ca: number
  marge: number
  margePct: number
  lignes: number
  aggregates: number
  previousCa: number
  previousMarge: number
  previousMargePct: number
  ecartCa: number
  ecartMarge: number
  evoCaPct: number | null
  evoMargePts: number | null
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
  date_facture: string
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

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const AGG_TABLE_NAME = 'indicateur_factures_mensuel'
const ACTIVITY_AGG_TABLE_NAME = 'indicateur_activite_mensuel'
const ACTIVITY_TYPES: ActivityType[] = ['NON', 'BL mois', 'BL frigo', 'PL', 'CDC', 'BR']

const COLOR_N2 = '#f59e0b'
const COLOR_N1 = '#64748b'
const COLOR_N = '#16a34a'
const COLOR_ACT_BL_MOIS = '#0ea5e9'
const COLOR_ACT_BL_FRIGO = '#0284c7'
const COLOR_ACT_PL = '#38bdf8'
const COLOR_ACT_CDC = '#7dd3fc'
const COLOR_ACT_BR = '#bae6fd'

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function safeText(value: any, fallback = 'NON RENSEIGNE') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function safeBool(value: any) {
  return value === true || String(value).toLowerCase() === 'true'
}

function normalizeActivityType(value: any): AggRow['type_document'] {
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
    numero_tiers: safeText(row.numero_tiers || row.code_tiers, 'NON RENSEIGNE'),
    intitule_tiers: safeText(row.intitule_tiers || row.tiers, 'NON RENSEIGNE'),
    famille: safeText(row.famille, 'NON RENSEIGNE'),
    famille_macro: safeText(row.famille_macro, 'NON RENSEIGNE'),
    hors_statistique: safeBool(row.hors_statistique),
    nb_lignes: safeNumber(row.nb_lignes || row.nb_ligne || row.nombre_lignes),
    quantite: safeNumber(row.quantite || row.qte),
    ca_ht: safeNumber(row.ca_ht || row.ca || row.montant_ht || row.ca_facture),
    marge_valeur: safeNumber(row.marge_valeur || row.marge || row.marge_stat),
  }
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
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50">
        <span className="truncate">{label} {selected.length ? `(${selected.length})` : ''}</span>
        <span>▼</span>
      </button>

      {open && (
        <div className="absolute left-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-slate-700">{label}</div>
            <button type="button" onClick={() => onChange([])} className="text-xs font-semibold text-slate-500 hover:text-slate-900">Tout afficher</button>
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

function ActivityFilter({ selected, onChange }: { selected: ActivityType[]; onChange: (values: ActivityType[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useCloseOnOutside(open, () => setOpen(false))

  function toggle(value: ActivityType) {
    if (value === 'NON') {
      onChange(['NON'])
      return
    }

    const withoutNon = selected.filter((v) => v !== 'NON')
    const next = withoutNon.includes(value) ? withoutNon.filter((v) => v !== value) : [...withoutNon, value]
    onChange(next.length ? next : ['NON'])
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50">
        <span className="truncate">Activité non facturée {selected.length ? `(${selected.length})` : ''}</span>
        <span>▼</span>
      </button>

      {open && (
        <div className="absolute left-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-slate-700">Activité non facturée</div>
            <button type="button" onClick={() => onChange(['BL mois', 'BL frigo', 'PL', 'CDC', 'BR'])} className="text-xs font-semibold text-slate-500 hover:text-slate-900">Tout afficher</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {ACTIVITY_TYPES.map((value) => (
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

function EvolutionBadge({ value, mode = 'percent' }: { value: number | null; mode?: 'percent' | 'points' }) {
  const positive = value !== null && value >= 0
  const neutral = value === null
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold ${neutral ? 'bg-slate-100 text-slate-500' : positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {mode === 'points' ? formatPoints(value) : formatPercent(value)}
    </span>
  )
}

function KpiMini({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
      {children}
    </div>
  )
}

function CustomTooltip({ active, payload, label, mode = 'currency' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-xl">
      <div className="mb-2 font-bold text-slate-900">{label}</div>
      <div className="space-y-1">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-6">
            <span>{entry.name}</span>
            <span className="font-semibold">{mode === 'percent' ? formatRate(Number(entry.value || 0)) : formatCurrency(Number(entry.value || 0))}</span>
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

export default function IndicateursFacturesAgregeesPage() {
  const [rawFactureRows, setRawFactureRows] = useState<RawAggRow[]>([])
  const [rawActivityRows, setRawActivityRows] = useState<RawAggRow[]>([])
  const [rows, setRows] = useState<AggRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [margeMode, setMargeMode] = useState<'valeur' | 'pourcentage'>('pourcentage')
  const [controlOpen, setControlOpen] = useState(false)
  const [tableMode, setTableMode] = useState<TableMode>('collaborateur')
  const [detailMode, setDetailMode] = useState<DetailMode>('tiers')
  const [detailContext, setDetailContext] = useState<DetailContext | null>(null)
  const [detailSort, setDetailSort] = useState<DetailSort>({ key: 'ca_ht', direction: 'desc' })
  const [selectedYears, setSelectedYears] = useState<number[]>([])
  const [filters, setFilters] = useState<Filters>({
    periodes: [],
    activitesNonFacturees: ['NON'],
    collaborateurs: [],
    agencesCollaborateurs: [],
    tiers: [],
    famillesMacro: [],
    horsStatistique: 'non',
  })

  const activityEnabled = useMemo(() => filters.activitesNonFacturees.some((v) => v !== 'NON'), [filters.activitesNonFacturees])
  const selectedActivityTypes = useMemo(() => filters.activitesNonFacturees.filter((v) => v !== 'NON') as Array<Exclude<ActivityType, 'NON'>>, [filters.activitesNonFacturees])

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
      const normalized = [...normalizedFactures, ...normalizedActivite]

      setRawFactureRows(facturesData)
      setRawActivityRows(activiteData)
      setRows(normalized)

      const availableYears = Array.from(new Set(normalized.map((r) => r.annee))).sort((a, b) => b - a)
      setSelectedYears((prev) => {
        const stillValid = prev.filter((y) => availableYears.includes(y))
        if (stillValid.length) return stillValid.slice(0, 3)
        return availableYears.slice(0, 3)
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

  const rowsAllowedByActivity = useMemo(() => {
    return rows.filter((row) => {
      if (row.source === 'facture') return true
      if (!activityEnabled) return false
      return selectedActivityTypes.includes(row.type_document as Exclude<ActivityType, 'NON'>)
    })
  }, [rows, activityEnabled, selectedActivityTypes])

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

  const availableFilters = useMemo(() => {
    return {
      years: Array.from(new Set<number>(rows.map((r) => r.annee))).sort((a, b) => b - a),
      periodes: getUnique(rows.map((r) => r.periode)).sort(),
      collaborateurs: getUnique(rows.map((r) => r.collaborateur)),
      agencesCollaborateurs: getUnique(rows.map((r) => r.agence_collaborateur)),
      tiers: getUnique(rows.map((r) => r.intitule_tiers || r.numero_tiers)),
      famillesMacro: getUnique(rows.map((r) => r.famille_macro)),
    }
  }, [rows])

  const years = useMemo(() => {
    const sorted = [...selectedYears].sort((a, b) => b - a)
    return {
      n: sorted[0] || CURRENT_YEAR,
      n1: sorted[1] || CURRENT_YEAR - 1,
      n2: sorted[2] || CURRENT_YEAR - 2,
    }
  }, [selectedYears])

  const yearsForDisplay = useMemo(() => [...selectedYears].sort((a, b) => a - b), [selectedYears])

  const comparisonMonths = useMemo(() => {
    const selectedMonths = filters.periodes.map((periode) => Number(String(periode).slice(5, 7))).filter(Boolean)
    if (selectedMonths.length) return Array.from(new Set(selectedMonths))
    return Array.from({ length: activityEnabled ? CURRENT_MONTH : CURRENT_MONTH }, (_, i) => i + 1)
  }, [filters.periodes, activityEnabled])

  const kpis = useMemo(() => {
    const { ca, marge, margePct, nbLignes } = sumRows(filteredRows)
    return { ca, marge, margePct, lignes: nbLignes, lignesAgregees: filteredRows.length }
  }, [filteredRows])

  const yearlyKpis = useMemo<YearKpi[]>(() => {
    return yearsForDisplay.map((year) => {
      const yearRows = filteredRows.filter((r) => r.annee === year)
      const currentComparisonRows = baseFilteredRows.filter((r) => r.annee === year && comparisonMonths.includes(r.mois))
      const previousComparisonRows = baseFilteredRows.filter((r) => r.annee === year - 1 && comparisonMonths.includes(r.mois))
      const current = sumRows(yearRows)
      const currentComp = sumRows(currentComparisonRows)
      const previous = sumRows(previousComparisonRows)
      return {
        year,
        ca: current.ca,
        marge: current.marge,
        margePct: current.margePct,
        lignes: current.nbLignes,
        aggregates: yearRows.length,
        previousCa: previous.ca,
        previousMarge: previous.marge,
        previousMargePct: previous.margePct,
        ecartCa: currentComp.ca - previous.ca,
        ecartMarge: currentComp.marge - previous.marge,
        evoCaPct: calcEvolution(currentComp.ca, previous.ca),
        evoMargePts: currentComp.ca && previous.ca ? currentComp.margePct - previous.margePct : null,
      }
    })
  }, [yearsForDisplay, filteredRows, baseFilteredRows, comparisonMonths])

  const monthlyChartData = useMemo(() => {
    return MONTHS.map((label, index) => {
      const mois = index + 1
      const rowsFor = (year: number) => baseFilteredRows.filter((r) => r.annee === year && r.mois === mois)
      const sumFor = (year: number, metric: 'ca' | 'marge', predicate?: (row: AggRow) => boolean) => {
        const source = predicate ? rowsFor(year).filter(predicate) : rowsFor(year)
        return source.reduce((s, r) => s + (metric === 'ca' ? r.ca_ht : r.marge_valeur), 0)
      }
      const caN = sumFor(years.n, 'ca')
      const caN1 = sumFor(years.n1, 'ca')
      const caN2 = sumFor(years.n2, 'ca')
      const margeN = sumFor(years.n, 'marge')
      const margeN1 = sumFor(years.n1, 'marge')
      const margeN2 = sumFor(years.n2, 'marge')
      return {
        mois,
        monthLabel: label.slice(0, 3),
        caN,
        caN1,
        caN2,
        caFactureN: sumFor(years.n, 'ca', (r) => r.source === 'facture'),
        caBLMoisN: sumFor(years.n, 'ca', (r) => r.type_document === 'BL mois'),
        caBLFrigoN: sumFor(years.n, 'ca', (r) => r.type_document === 'BL frigo'),
        caPLN: sumFor(years.n, 'ca', (r) => r.type_document === 'PL'),
        caCDCN: sumFor(years.n, 'ca', (r) => r.type_document === 'CDC'),
        caBRN: sumFor(years.n, 'ca', (r) => r.type_document === 'BR'),
        margeN,
        margeN1,
        margeN2,
        margePctN: caN ? (margeN / caN) * 100 : 0,
        margePctN1: caN1 ? (margeN1 / caN1) * 100 : 0,
        margePctN2: caN2 ? (margeN2 / caN2) * 100 : 0,
      }
    })
  }, [baseFilteredRows, years])

  const cumulativeChartData = useMemo(() => {
    let caN = 0, caN1 = 0, caN2 = 0, margeN = 0, margeN1 = 0, margeN2 = 0
    return monthlyChartData.map((row) => {
      caN += row.caN; caN1 += row.caN1; caN2 += row.caN2
      margeN += row.margeN; margeN1 += row.margeN1; margeN2 += row.margeN2
      return {
        mois: row.mois,
        monthLabel: row.monthLabel,
        caN,
        caN1,
        caN2,
        margeN,
        margeN1,
        margeN2,
        margePctN: caN ? (margeN / caN) * 100 : 0,
        margePctN1: caN1 ? (margeN1 / caN1) * 100 : 0,
        margePctN2: caN2 ? (margeN2 / caN2) * 100 : 0,
      }
    })
  }, [monthlyChartData])

  const recap = useMemo(() => {
    const selectedCollaborateurs = filters.collaborateurs.length ? filters.collaborateurs : availableFilters.collaborateurs
    const grouped = new Map<string, string[]>()
    selectedCollaborateurs.forEach((collab) => {
      const agence = rows.find((r) => r.collaborateur === collab)?.agence_collaborateur || 'NON AFFECTE'
      if (!grouped.has(agence)) grouped.set(agence, [])
      grouped.get(agence)!.push(collab)
    })
    const agences = Array.from(grouped.entries()).map(([agence, collabs]) => ({ agence, collaborateurs: collabs.sort((a, b) => a.localeCompare(b, 'fr')) }))

    const rowsByMonth = MONTHS.map((label, index) => {
      const mois = index + 1
      const values: Record<string, RecapValue> = {}
      const agenceValues: Record<string, RecapValue> = {}
      selectedCollaborateurs.forEach((collab) => {
        const current = baseFilteredRows.filter((r) => r.collaborateur === collab && r.annee === years.n && r.mois === mois)
        const previous = baseFilteredRows.filter((r) => r.collaborateur === collab && r.annee === years.n - 1 && r.mois === mois)
        values[collab] = makeRecap(current, previous)
      })
      agences.forEach((agence) => {
        agenceValues[agence.agence] = sumRecap(agence.collaborateurs.map((collab) => values[collab] || emptyRecap()))
      })
      return { mois, monthLabel: label.toUpperCase(), values, agenceValues }
    })

    const collaboratorTotals: Record<string, RecapValue> = {}
    selectedCollaborateurs.forEach((collab) => {
      const current = baseFilteredRows.filter((r) => r.collaborateur === collab && r.annee === years.n && comparisonMonths.includes(r.mois))
      const previous = baseFilteredRows.filter((r) => r.collaborateur === collab && r.annee === years.n - 1 && comparisonMonths.includes(r.mois))
      collaboratorTotals[collab] = makeRecap(current, previous)
    })
    const agenceTotals: Record<string, RecapValue> = {}
    agences.forEach((agence) => {
      agenceTotals[agence.agence] = sumRecap(agence.collaborateurs.map((collab) => collaboratorTotals[collab] || emptyRecap()))
    })
    const rowTotals = rowsByMonth.map((row) => sumRecap(selectedCollaborateurs.map((collab) => row.values[collab] || emptyRecap())))
    const grandTotal = sumRecap(Object.values(collaboratorTotals))
    return { agences, rows: rowsByMonth, rowTotals, collaboratorTotals, agenceTotals, grandTotal }
  }, [filters.collaborateurs, availableFilters.collaborateurs, rows, baseFilteredRows, years.n, comparisonMonths])

  function rowsForDetail(context: DetailContext, year: number) {
    return baseFilteredRows.filter((row) => {
      if (row.annee !== year) return false
      if (context.month && row.mois !== context.month) return false
      if (context.collaborateur && row.collaborateur !== context.collaborateur) return false
      if (context.agence && row.agence_collaborateur !== context.agence) return false
      return true
    })
  }

  const detailRows = useMemo(() => {
    if (!detailContext) return []
    const rows = rowsForDetail(detailContext, detailContext.year)
    return rows.map((row, index) => ({
      id: `${row.source}-${row.type_document}-${row.annee}-${row.mois}-${row.collaborateur}-${row.numero_tiers}-${index}`,
      niveau: 'Agrégat',
      source: row.source,
      type_piece: row.source === 'facture' ? 'Factures' : row.type_document,
      date_facture: row.periode,
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
  }, [detailContext, baseFilteredRows])

  const detailPreviousRows = useMemo(() => {
    if (!detailContext) return []
    const previous = rowsForDetail(detailContext, detailContext.year - 1)
    return previous.map((row, index) => ({
      id: `previous-${row.source}-${row.type_document}-${row.annee}-${row.mois}-${row.collaborateur}-${row.numero_tiers}-${index}`,
      niveau: 'Agrégat N-1',
      source: row.source,
      type_piece: row.source === 'facture' ? 'Factures' : row.type_document,
      date_facture: row.periode,
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
  }, [detailContext, baseFilteredRows])

  const detailDisplayRows = useMemo(() => {
    if (!detailContext) return []

    function aggregate(source: DetailRow[]) {
      if (detailMode === 'lignes') return source.slice(0, 500)
      const map = new Map<string, DetailRow>()
      source.forEach((row) => {
        const key = detailMode === 'tiers'
          ? `${row.numero_tiers}|${row.intitule_tiers}`
          : `${row.source}|${row.type_piece}|${row.date_facture}|${row.numero_tiers}|${row.collaborateur}|${row.agence}`
        const existing = map.get(key)
        if (existing) {
          existing.ca_ht += row.ca_ht
          existing.marge_valeur += row.marge_valeur
          existing.quantite += row.quantite
          existing.nb_lignes += row.nb_lignes
          existing.marge_pct = existing.ca_ht ? (existing.marge_valeur / existing.ca_ht) * 100 : 0
        } else {
          map.set(key, { ...row, id: key, niveau: detailMode === 'tiers' ? 'Tiers' : 'Source / document' })
        }
      })
      return Array.from(map.values())
    }

    const currentRows = aggregate(detailRows)
    const previousRows = aggregate(detailPreviousRows)
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
    }).slice(0, 500)
  }, [detailContext, detailMode, detailRows, detailPreviousRows, detailSort])

  function openDetail(context: DetailContext) {
    setDetailContext(context)
  }

  function toggleDetailSort(key: DetailSortKey) {
    setDetailSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }))
  }

  function SortableTh({ label, sortKey, align = 'left' }: { label: string; sortKey: DetailSortKey; align?: 'left' | 'right' }) {
    const active = detailSort.key === sortKey
    return (
      <th onClick={() => toggleDetailSort(sortKey)} className={`cursor-pointer border border-slate-200 px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} hover:bg-slate-100`}>
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

  const detailNbClients = useMemo(() => new Set(detailRows.map((row) => `${row.numero_tiers}|${row.intitule_tiers}`)).size, [detailRows])
  const detailNbFactures = useMemo(() => new Set(detailRows.map((row) => `${row.source}|${row.type_piece}|${row.date_facture}|${row.numero_tiers}`)).size, [detailRows])

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1900px] space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Indicateurs CA & Marge</h1>
              <p className="mt-2 text-sm text-slate-600">Données issues de {AGG_TABLE_NAME} et, si activé, de {ACTIVITY_AGG_TABLE_NAME}.</p>
              <p className="mt-1 text-xs font-semibold text-amber-700">Activité non facturée à NON : seules les factures sont utilisées. Dès qu'une activité est sélectionnée, les factures restent intégrées et les montants d'activité sélectionnés sont ajoutés.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableFilters.years.map((year) => (
                <button key={year} type="button" onClick={() => toggleYear(year)} className={`rounded-xl px-4 py-2 text-sm font-bold ${selectedYears.includes(year) ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>{year}</button>
              ))}
              <button type="button" onClick={loadData} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-100">Actualiser</button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Filtres</h2>
              <p className="text-sm text-slate-500">Filtres appliqués sur les tables agrégées mensuelles.</p>
            </div>
            {loading && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">Chargement…</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <MultiSelectFilter label="Mois / année" values={availableFilters.periodes} selected={filters.periodes} onChange={(v) => updateFilter('periodes', v)} />
            <MultiSelectFilter label="Agence collaborateur" values={availableFilters.agencesCollaborateurs} selected={filters.agencesCollaborateurs} onChange={(v) => updateFilter('agencesCollaborateurs', v)} />
            <MultiSelectFilter label="Collaborateur" values={availableFilters.collaborateurs} selected={filters.collaborateurs} onChange={(v) => updateFilter('collaborateurs', v)} />
            <MultiSelectFilter label="Tiers" values={availableFilters.tiers} selected={filters.tiers} onChange={(v) => updateFilter('tiers', v)} />
            <MultiSelectFilter label="Famille macro" values={availableFilters.famillesMacro} selected={filters.famillesMacro} onChange={(v) => updateFilter('famillesMacro', v)} />
            <ActivityFilter selected={filters.activitesNonFacturees} onChange={(v) => updateFilter('activitesNonFacturees', v)} />
            <select value={filters.horsStatistique} onChange={(e) => updateFilter('horsStatistique', e.target.value as Filters['horsStatistique'])} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold">
              <option value="non">Hors statistique : NON</option>
              <option value="oui">Hors statistique : OUI</option>
              <option value="tous">Hors statistique : Tous</option>
            </select>
          </div>
          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Synthèse par année</h2>
              <p className="text-xs text-slate-500">Maximum 3 années sélectionnées. Les années non sélectionnées ne sont pas affichées.</p>
            </div>
            <div className="text-right text-xs font-semibold text-slate-500">Total filtré : {formatCurrency(kpis.ca)} · Marge {formatRate(kpis.margePct)}</div>
          </div>
          <div className="space-y-2">
            {!yearlyKpis.length && <div className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">Sélectionne au moins une année en haut à droite.</div>}
            {yearlyKpis.map((row) => (
              <div key={row.year} className="rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
                <div className="grid gap-2 md:grid-cols-6">
                  <div className="flex items-center rounded-xl bg-slate-900 px-4 py-3 text-xl font-black text-white">{row.year}</div>
                  <KpiMini label="CA" value={formatCurrency(row.ca)} />
                  <KpiMini label="Marge €" value={formatCurrency(row.marge)} />
                  <KpiMini label="Marge %" value={formatRate(row.margePct)} />
                  <KpiMini label="Lignes source" value={formatNumber(row.lignes)} />
                  <KpiMini label="Agrégats chargés" value={formatNumber(row.aggregates)} />
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500">CA correspondant N-1 à date {activityEnabled ? '(fin de mois)' : '(jour)'}</div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-black text-slate-900">CA : {formatCurrency(row.ecartCa)} <EvolutionBadge value={row.evoCaPct} /></div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-black text-slate-900">Marge : {formatCurrency(row.ecartMarge)} <EvolutionBadge value={row.evoMargePts} mode="points" /></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button type="button" onClick={() => setControlOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 p-5 text-left">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <h2 className="text-lg font-bold">Contrôle chargement</h2>
              <span className="text-sm font-bold text-slate-500">Table factures : {AGG_TABLE_NAME}</span>
              <span className="text-sm font-bold text-slate-500">Activité : {formatNumber(rawActivityRows.length)}</span>
              <span className="text-sm font-bold text-slate-500">Brutes : {formatNumber(rawFactureRows.length + rawActivityRows.length)}</span>
              <span className="text-sm font-bold text-slate-500">Normalisées : {formatNumber(rows.length)}</span>
              <span className="text-sm font-bold text-slate-500">Années : {availableFilters.years.join(', ') || 'Aucune'}</span>
            </div>
            <span className="text-2xl text-slate-500">{controlOpen ? '▲' : '▼'}</span>
          </button>
          {controlOpen && (
            <div className="border-t border-slate-200 p-5 text-sm text-slate-600">
              <div>Factures agrégées lues : {formatNumber(rawFactureRows.length)}</div>
              <div>Activité agrégée lue : {formatNumber(rawActivityRows.length)}</div>
              <div>Lignes après filtres : {formatNumber(filteredRows.length)}</div>
              <div>Activité sélectionnée : {filters.activitesNonFacturees.join(', ')}</div>
            </div>
          )}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">CA mensuel</h2>
            <p className="text-sm text-slate-500">Ordre d'affichage : N-2, N-1, N. L'activité sélectionnée est empilée sur N.</p>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" />
                  <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k€`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="caN2" name={`${years.n2}`} fill={COLOR_N2} />
                  <Bar dataKey="caN1" name={`${years.n1}`} fill={COLOR_N1} />
                  {activityEnabled ? (
                    <>
                      <Bar dataKey="caFactureN" name={`${years.n} facturé`} stackId="n" fill={COLOR_N} />
                      {selectedActivityTypes.includes('BL mois') && <Bar dataKey="caBLMoisN" name="BL mois" stackId="n" fill={COLOR_ACT_BL_MOIS} />}
                      {selectedActivityTypes.includes('BL frigo') && <Bar dataKey="caBLFrigoN" name="BL frigo" stackId="n" fill={COLOR_ACT_BL_FRIGO} />}
                      {selectedActivityTypes.includes('PL') && <Bar dataKey="caPLN" name="PL" stackId="n" fill={COLOR_ACT_PL} />}
                      {selectedActivityTypes.includes('CDC') && <Bar dataKey="caCDCN" name="CDC" stackId="n" fill={COLOR_ACT_CDC} />}
                      {selectedActivityTypes.includes('BR') && <Bar dataKey="caBRN" name="BR" stackId="n" fill={COLOR_ACT_BR} />}
                    </>
                  ) : (
                    <Bar dataKey="caN" name={`${years.n}`} fill={COLOR_N} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Marge mensuelle</h2>
                <p className="text-sm text-slate-500">Par défaut en pourcentage.</p>
              </div>
              <div className="flex rounded-xl border border-slate-300 bg-white p-1">
                <button type="button" onClick={() => setMargeMode('pourcentage')} className={`rounded-lg px-3 py-1 text-sm font-bold ${margeMode === 'pourcentage' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>%</button>
                <button type="button" onClick={() => setMargeMode('valeur')} className={`rounded-lg px-3 py-1 text-sm font-bold ${margeMode === 'valeur' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Valeur</button>
              </div>
            </div>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" />
                  <YAxis tickFormatter={(v) => (margeMode === 'valeur' ? `${Math.round(Number(v) / 1000)}k€` : `${Number(v).toFixed(0)}%`)} />
                  <Tooltip content={<CustomTooltip mode={margeMode === 'valeur' ? 'currency' : 'percent'} />} />
                  <Legend />
                  <Line type="monotone" dataKey={margeMode === 'valeur' ? 'margeN2' : 'margePctN2'} name={`${years.n2}`} stroke={COLOR_N2} strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey={margeMode === 'valeur' ? 'margeN1' : 'margePctN1'} name={`${years.n1}`} stroke={COLOR_N1} strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey={margeMode === 'valeur' ? 'margeN' : 'margePctN'} name={`${years.n}`} stroke={COLOR_N} strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">CA cumulé</h2>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" />
                  <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k€`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="caN2" name={`${years.n2}`} stroke={COLOR_N2} strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="caN1" name={`${years.n1}`} stroke={COLOR_N1} strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="caN" name={`${years.n}`} stroke={COLOR_N} strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Marge cumulée</h2>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" />
                  <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                  <Tooltip content={<CustomTooltip mode="percent" />} />
                  <Legend />
                  <Line type="monotone" dataKey="margePctN2" name={`${years.n2}`} stroke={COLOR_N2} strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="margePctN1" name={`${years.n1}`} stroke={COLOR_N1} strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="margePctN" name={`${years.n}`} stroke={COLOR_N} strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-bold">Tableau récapitulatif</h2>
              <p className="text-sm text-slate-500">Clique sur une cellule pour afficher le détail depuis les tables agrégées.</p>
            </div>
            <div className="flex rounded-xl border border-slate-300 bg-white p-1">
              <button type="button" onClick={() => setTableMode('collaborateur')} className={`rounded-lg px-3 py-1 text-sm font-bold ${tableMode === 'collaborateur' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Collaborateurs</button>
              <button type="button" onClick={() => setTableMode('agence')} className={`rounded-lg px-3 py-1 text-sm font-bold ${tableMode === 'agence' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Agences</button>
            </div>
          </div>
          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th rowSpan={2} className="sticky left-0 z-20 border border-slate-200 bg-slate-100 px-3 py-2 text-left">Mois</th>
                  <th colSpan={3} className="border border-slate-200 px-3 py-2 text-center font-black">TOTAL</th>
                  {tableMode === 'collaborateur'
                    ? recap.agences.map((agence) => <th key={agence.agence} colSpan={agence.collaborateurs.length * 3} className="border border-slate-200 px-3 py-2 text-center font-black">{agence.agence}</th>)
                    : recap.agences.map((agence) => <th key={agence.agence} colSpan={3} className="border border-slate-200 px-3 py-2 text-center font-black">{agence.agence}</th>)}
                </tr>
                <tr className="bg-slate-50">
                  <th className="border border-slate-200 px-3 py-2 text-center">CA</th>
                  <th className="border border-slate-200 px-3 py-2 text-center">Marge €</th>
                  <th className="border border-slate-200 px-3 py-2 text-center">Évol. CA vs N-1</th>
                  {tableMode === 'collaborateur'
                    ? recap.agences.flatMap((agence) => agence.collaborateurs.flatMap((collab) => [
                        <th key={`${collab}-ca`} className="border border-slate-200 px-3 py-2 text-center">{collab}<br />CA</th>,
                        <th key={`${collab}-marge`} className="border border-slate-200 px-3 py-2 text-center">Marge €</th>,
                        <th key={`${collab}-pct`} className="border border-slate-200 px-3 py-2 text-center">Évol. CA vs N-1</th>,
                      ]))
                    : recap.agences.flatMap((agence) => [
                        <th key={`${agence.agence}-ca`} className="border border-slate-200 px-3 py-2 text-center">CA</th>,
                        <th key={`${agence.agence}-marge`} className="border border-slate-200 px-3 py-2 text-center">Marge €</th>,
                        <th key={`${agence.agence}-pct`} className="border border-slate-200 px-3 py-2 text-center">Évol. CA vs N-1</th>,
                      ])}
                </tr>
              </thead>
              <tbody>
                {recap.rows.map((row) => {
                  const total = recap.rowTotals[row.mois - 1] || emptyRecap()
                  return (
                    <tr key={row.mois} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 border border-slate-200 bg-white px-3 py-2 font-bold text-slate-700">{row.monthLabel}</td>
                      <td className="border border-slate-200 bg-slate-50 px-3 py-2 text-right font-black"><DetailCell value={total} context={{ year: years.n, month: row.mois, monthLabel: row.monthLabel, label: `TOTAL ${row.monthLabel}` }} /></td>
                      <td className="border border-slate-200 bg-slate-50 px-3 py-2 text-right font-bold">{formatNumber(total.marge)}</td>
                      <td className="border border-slate-200 bg-slate-50 px-3 py-2 text-right font-bold"><EvolutionBadge value={total.ca ? total.evoCa : null} /></td>
                      {tableMode === 'collaborateur'
                        ? recap.agences.flatMap((agence) => agence.collaborateurs.flatMap((collab) => {
                            const value = row.values[collab]
                            return [
                              <td key={`${row.mois}-${collab}-ca`} className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={value} context={{ year: years.n, month: row.mois, monthLabel: row.monthLabel, collaborateur: collab, agence: agence.agence, label: `${collab} - ${row.monthLabel}` }} /></td>,
                              <td key={`${row.mois}-${collab}-marge`} className="border border-slate-200 px-3 py-2 text-right text-slate-700">{formatNumber(value?.marge || 0)}</td>,
                              <td key={`${row.mois}-${collab}-pct`} className="border border-slate-200 px-3 py-2 text-right text-slate-700"><EvolutionBadge value={value?.ca ? value.evoCa : null} /></td>,
                            ]
                          }))
                        : recap.agences.flatMap((agence) => {
                            const value = row.agenceValues[agence.agence]
                            return [
                              <td key={`${row.mois}-${agence.agence}-ca`} className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={value} context={{ year: years.n, month: row.mois, monthLabel: row.monthLabel, agence: agence.agence, label: `${agence.agence} - ${row.monthLabel}` }} /></td>,
                              <td key={`${row.mois}-${agence.agence}-marge`} className="border border-slate-200 px-3 py-2 text-right">{formatNumber(value?.marge || 0)}</td>,
                              <td key={`${row.mois}-${agence.agence}-pct`} className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={value?.ca ? value.evoCa : null} /></td>,
                            ]
                          })}
                    </tr>
                  )
                })}
                <tr className="bg-slate-100 font-black">
                  <td className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-3 py-2">TOTAL</td>
                  <td className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={recap.grandTotal} context={{ year: years.n, monthLabel: 'TOTAL', label: 'TOTAL annuel' }} /></td>
                  <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(recap.grandTotal.marge)}</td>
                  <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={recap.grandTotal.ca ? recap.grandTotal.evoCa : null} /></td>
                  {tableMode === 'collaborateur'
                    ? recap.agences.flatMap((agence) => agence.collaborateurs.flatMap((collab) => {
                        const value = recap.collaboratorTotals[collab]
                        return [
                          <td key={`total-${collab}-ca`} className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={value} context={{ year: years.n, monthLabel: 'TOTAL', collaborateur: collab, agence: agence.agence, label: `${collab} - TOTAL` }} /></td>,
                          <td key={`total-${collab}-marge`} className="border border-slate-200 px-3 py-2 text-right">{formatNumber(value?.marge || 0)}</td>,
                          <td key={`total-${collab}-pct`} className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={value?.ca ? value.evoCa : null} /></td>,
                        ]
                      }))
                    : recap.agences.flatMap((agence) => {
                        const value = recap.agenceTotals[agence.agence]
                        return [
                          <td key={`total-${agence.agence}-ca`} className="border border-slate-200 px-3 py-2 text-right"><DetailCell value={value} context={{ year: years.n, monthLabel: 'TOTAL', agence: agence.agence, label: `${agence.agence} - TOTAL` }} /></td>,
                          <td key={`total-${agence.agence}-marge`} className="border border-slate-200 px-3 py-2 text-right">{formatNumber(value?.marge || 0)}</td>,
                          <td key={`total-${agence.agence}-pct`} className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={value?.ca ? value.evoCa : null} /></td>,
                        ]
                      })}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {detailContext && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-lg font-bold">Détail : {detailContext.label}</h2>
                <p className="text-sm text-slate-500">{detailMode === 'tiers' ? 'Regroupé par tiers/client' : detailMode === 'factures' ? 'Regroupé par source / type document' : 'Détail des agrégats'} · {formatNumber(detailRows.reduce((s, row) => s + row.nb_lignes, 0))} lignes source lues / Nb de client : {formatNumber(detailNbClients)} / Nb de facture : {formatNumber(detailNbFactures)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="flex rounded-xl border border-slate-300 bg-white p-1">
                  <button type="button" onClick={() => setDetailMode('tiers')} className={`rounded-lg px-3 py-1 text-sm font-bold ${detailMode === 'tiers' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Tiers</button>
                  <button type="button" onClick={() => setDetailMode('factures')} className={`rounded-lg px-3 py-1 text-sm font-bold ${detailMode === 'factures' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Documents</button>
                  <button type="button" onClick={() => setDetailMode('lignes')} className={`rounded-lg px-3 py-1 text-sm font-bold ${detailMode === 'lignes' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Agrégats</button>
                </div>
                <button type="button" onClick={() => setDetailContext(null)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-100">Fermer</button>
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
                  {detailDisplayRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="border border-slate-200 px-3 py-2 font-bold">{row.niveau}</td>
                      {detailMode !== 'tiers' && <td className="border border-slate-200 px-3 py-2">{row.type_piece}</td>}
                      <td className="border border-slate-200 px-3 py-2">{row.numero_tiers} · {row.intitule_tiers}</td>
                      <td className="border border-slate-200 px-3 py-2">{row.collaborateur}</td>
                      <td className="border border-slate-200 px-3 py-2">{row.agence}</td>
                      {detailMode !== 'tiers' && <td className="border border-slate-200 px-3 py-2">{row.famille_macro}</td>}
                      <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.nb_lignes)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.quantite)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-bold">{formatNumber(row.ca_ht)}</td>
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
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailDisplayRows.reduce((sum, row) => sum + row.nb_lignes, 0))}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailDisplayRows.reduce((sum, row) => sum + row.quantite, 0))}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailDisplayRows.reduce((sum, row) => sum + row.ca_ht, 0))}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailDisplayRows.reduce((sum, row) => sum + row.marge_valeur, 0))}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatRate((() => { const ca = detailDisplayRows.reduce((sum, row) => sum + row.ca_ht, 0); const marge = detailDisplayRows.reduce((sum, row) => sum + row.marge_valeur, 0); return ca ? (marge / ca) * 100 : 0 })())}</td>
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(detailDisplayRows.reduce((sum, row) => sum + (row.ca_ht_n1 || 0), 0))}</td>}
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right">{formatRate((() => { const ca = detailDisplayRows.reduce((sum, row) => sum + (row.ca_ht_n1 || 0), 0); const marge = detailDisplayRows.reduce((sum, row) => sum + (row.marge_valeur_n1 || 0), 0); return ca ? (marge / ca) * 100 : 0 })())}</td>}
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={calcEvolution(detailDisplayRows.reduce((sum, row) => sum + row.ca_ht, 0), detailDisplayRows.reduce((sum, row) => sum + (row.ca_ht_n1 || 0), 0))} /></td>}
                    {detailMode === 'tiers' && <td className="border border-slate-200 px-3 py-2 text-right"><EvolutionBadge value={(() => { const ca = detailDisplayRows.reduce((sum, row) => sum + row.ca_ht, 0); const marge = detailDisplayRows.reduce((sum, row) => sum + row.marge_valeur, 0); const caN1 = detailDisplayRows.reduce((sum, row) => sum + (row.ca_ht_n1 || 0), 0); const margeN1 = detailDisplayRows.reduce((sum, row) => sum + (row.marge_valeur_n1 || 0), 0); return ca && caN1 ? (marge / ca) * 100 - (margeN1 / caN1) * 100 : null })()} mode="points" /></td>}
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
