'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'

type Flux = 'DEVIS' | 'CDC' | 'BL' | 'FACTURE'
type Metric = 'ca_ht' | 'quantite' | 'quantite_pertinente'

type SummaryRpcRow = {
  annee: number
  mois: number
  flux: Flux
  type_document: string
  famille_macro: string
  nb_lignes: number
  quantite: number
  quantite_pertinente: number
  ca_ht: number
  marge_valeur: number
  updated_at?: string | null
}

type DetailRpcRow = {
  annee: number
  famille_macro: string
  famille: string
  reference_article: string
  designation: string
  numero_document: string
  mois: number
  type_document: Flux
  nb_lignes: number
  quantite: number
  quantite_pertinente: number
  ca_ht: number
  marge_valeur: number
}

type OptionRpcRow = {
  option_type?: string
  value?: string
  type_filtre?: string
  valeur?: string
}

type ChartDatum = {
  mois: number
  label: string
  [key: string]: string | number
}

type MatrixRow = {
  famille_macro: string
  flux: Flux
  mois: Record<number, number>
  moisN1: Record<number, number>
  total: number
  totalN1: number
}

type FamilyMatrixRow = {
  famille_macro: string
  famille: string
  flux: Flux
  mois: Record<number, number>
  moisN1: Record<number, number>
  total: number
  totalN1: number
}

type ReferencePivotSourceRow = DetailRpcRow & {
  annee: number
}

type ReferencePivotRow = {
  famille_macro: string
  famille: string
  reference_article: string
  designation: string
  type_document: Flux
  mois: Record<number, number>
  moisN1: Record<number, number>
  total: number
  totalN1: number
}

type AnalysisScope = {
  famille_macro?: string
  flux?: Flux
  mois?: number
  label: string
} | null

type ReferenceScope = {
  famille_macro: string
  famille?: string
  flux?: Flux
  mois?: number
  label: string
} | null

type LastBusinessDates = {
  devis: string | null
  factures: string | null
  bl: string | null
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const MIN_YEAR_OPTION = 2023
const FLUX_ORDER: Flux[] = ['DEVIS', 'CDC', 'BL', 'FACTURE']
const DEFAULT_SELECTED_MACROS = ['ACC', 'DRV', 'ECS', 'PV', 'R_ZONE', 'R/O', 'R/R']
const DEFAULT_SELECTED_MACRO_NORMALIZED = new Set(DEFAULT_SELECTED_MACROS.map((macro) => normalizeMacro(macro)))
const PRIORITY_MACRO_ORDER = ['R/R', 'R/O', 'R_ZONE', 'ECS', 'DRV', 'PV']
const PRIORITY_FLUX_ORDER: Flux[] = ['DEVIS', 'FACTURE']

const FLUX_LABELS: Record<Flux, string> = {
  DEVIS: 'Devis',
  CDC: 'CDC',
  BL: 'BL',
  FACTURE: 'Factures',
}

const FLUX_COLORS: Record<Flux, string> = {
  DEVIS: '#C49A00',
  CDC: '#005F73',
  BL: '#60A5FA',
  FACTURE: '#16A34A',
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

function normalizeFlux(value: any): Flux {
  const text = safeText(value, 'DEVIS').toUpperCase()
  if (text === 'CDC' || text === 'BL' || text === 'FACTURE') return text
  return 'DEVIS'
}

function normalizeMacro(value: any) {
  return safeText(value, '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '_')
    .toUpperCase()
}

function monthLabel(month: number) {
  return MONTHS[Math.max(0, Math.min(11, month - 1))] || String(month)
}

function comparisonPeriodLabel(month: number) {
  if (month <= 0) return 'aucun mois réalisé'
  return `Janv. à ${monthLabel(month)}`
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => safeText(value, '')).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  )
}

function defaultSelectedMacrosFromAvailable(values: string[]) {
  const normalizedValueByMacro = new Map(values.map((value) => [normalizeMacro(value), value]))
  return DEFAULT_SELECTED_MACROS
    .map((macro) => normalizedValueByMacro.get(normalizeMacro(macro)) ?? macro)
    .filter((macro, index, list) => list.findIndex((item) => normalizeMacro(item) === normalizeMacro(macro)) === index)
}

function currentComparisonMonthForYear(year: number) {
  const now = new Date()
  const currentYear = now.getFullYear()
  if (year < currentYear) return 12
  if (year > currentYear) return 0
  return now.getMonth() + 1
}

const EMPTY_LAST_BUSINESS_DATES: LastBusinessDates = { devis: null, factures: null, bl: null }

function normalizeBusinessDate(value: any): string | null {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`

  const timestamp = new Date(text).getTime()
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString().slice(0, 10)
}

function formatBusinessDate(value: string | null | undefined) {
  const iso = normalizeBusinessDate(value)
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function formatLastBusinessDatesLabel(dates: LastBusinessDates) {
  return `Devis : ${formatBusinessDate(dates.devis)} · Factures : ${formatBusinessDate(dates.factures)} · BL : ${formatBusinessDate(dates.bl)}`
}

function latestBusinessDate(values: Array<string | null>) {
  const sortedValues = values
    .map((value) => normalizeBusinessDate(value))
    .filter((value): value is string => Boolean(value))
    .sort()
  return sortedValues.length ? sortedValues[sortedValues.length - 1] : null
}

async function fetchLatestBusinessDate(table: string, dateColumns: string[], year: number) {
  const start = `${year}-01-01`
  const end = `${year + 1}-01-01`

  for (const dateColumn of dateColumns) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select(dateColumn)
        .not(dateColumn, 'is', null)
        .gte(dateColumn, start)
        .lt(dateColumn, end)
        .order(dateColumn, { ascending: false })
        .limit(1)

      if (error) continue

      const rawDate = ((data || []) as Record<string, any>[])[0]?.[dateColumn]
      const normalized = normalizeBusinessDate(rawDate)
      if (normalized) return normalized
    } catch {
      // On passe à la colonne candidate suivante pour rester compatible avec les variantes de schéma.
    }
  }

  return null
}

async function fetchLatestBusinessDates(year: number): Promise<LastBusinessDates> {
  const [devis, factures, blActivite, blFacture] = await Promise.all([
    fetchLatestBusinessDate('devis_lignes', ['date_devis', 'date_piece', 'date_document'], year),
    fetchLatestBusinessDate('facture_lignes', ['date_piece', 'date_facture', 'date_document'], year),
    fetchLatestBusinessDate('activite_lignes', ['date_bl', 'date_piece_bl', 'date_livraison_bl', 'date_livraison'], year),
    fetchLatestBusinessDate('facture_lignes', ['date_bl', 'date_piece_bl', 'date_livraison_bl', 'date_livraison'], year),
  ])

  return { devis, factures, bl: latestBusinessDate([blActivite, blFacture]) }
}

function hasMetricValue(value: number | null | undefined) {
  return Math.abs(safeNumber(value)) > 0.000001
}

function hasAnyMonthMetricValue(values: Record<number, number>) {
  return Object.values(values).some((value) => hasMetricValue(value))
}

function matrixRowHasValue(row: Pick<MatrixRow | ReferencePivotRow, 'mois' | 'moisN1' | 'total' | 'totalN1'>) {
  return hasMetricValue(row.total) || hasMetricValue(row.totalN1) || hasAnyMonthMetricValue(row.mois) || hasAnyMonthMetricValue(row.moisN1)
}

function referenceCode(referenceOption: string) {
  return String(referenceOption || '').split(' — ')[0].trim()
}

function getMetricValue(row: Pick<SummaryRpcRow | DetailRpcRow, 'ca_ht' | 'quantite' | 'quantite_pertinente'>, metric: Metric) {
  if (metric === 'quantite') return safeNumber(row.quantite)
  if (metric === 'quantite_pertinente') return safeNumber(row.quantite_pertinente ?? row.quantite)
  return safeNumber(row.ca_ht)
}

function metricLabel(metric: Metric) {
  if (metric === 'ca_ht') return 'CA HT'
  if (metric === 'quantite') return 'quantité brute'
  return 'quantité pertinente'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}

function formatMetric(value: number, metric: Metric) {
  if (metric === 'ca_ht') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value || 0)
  }
  return formatNumber(value)
}

function yAxisFormatter(value: number, metric: Metric) {
  if (metric === 'ca_ht') return `${Math.round(Number(value || 0) / 1000)}k€`
  return formatNumber(Number(value || 0))
}

function defaultYearOptions() {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let year = current; year >= MIN_YEAR_OPTION; year -= 1) years.push(year)
  return years
}

function downloadWorkbook(filename: string, sheets: Array<{ name: string; rows: Array<Record<string, any>> }>) {
  const workbook = XLSX.utils.book_new()
  sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
  })
  XLSX.writeFile(workbook, filename)
}

function mapSummaryRow(row: any): SummaryRpcRow {
  return {
    annee: safeNumber(row.annee),
    mois: safeNumber(row.mois),
    flux: normalizeFlux(row.flux ?? row.type_document),
    type_document: safeText(row.type_document, normalizeFlux(row.flux ?? row.type_document)),
    famille_macro: safeText(row.famille_macro),
    nb_lignes: safeNumber(row.nb_lignes),
    quantite: safeNumber(row.quantite),
    quantite_pertinente: safeNumber(row.quantite_pertinente ?? row.qte_pertinente ?? row.quantite_pert ?? row.qte_pert ?? row.quantite),
    ca_ht: safeNumber(row.ca_ht),
    marge_valeur: safeNumber(row.marge_valeur),
    updated_at: safeText(
      row.updated_at ?? row.updatedAt ?? row.date_maj ?? row.date_mise_a_jour ?? row.derniere_maj ?? row.last_update ?? row.last_updated_at ?? row.max_updated_at,
      ''
    ),
  }
}

function mapDetailRow(row: any, forcedYear?: number): DetailRpcRow {
  return {
    annee: safeNumber(forcedYear ?? row.annee),
    famille_macro: safeText(row.famille_macro),
    famille: safeText(row.famille),
    reference_article: safeText(row.reference_article ?? row.reference ?? row.ref_article),
    designation: safeText(row.designation ?? row.libelle_article ?? row.libelle, ''),
    numero_document: safeText(row.numero_document ?? row.numero_piece ?? row.numero_devis ?? row.numero_facture ?? row.document ?? row.piece, ''),
    mois: safeNumber(row.mois),
    type_document: normalizeFlux(row.type_document ?? row.flux),
    nb_lignes: safeNumber(row.nb_lignes),
    quantite: safeNumber(row.quantite),
    quantite_pertinente: safeNumber(row.quantite_pertinente ?? row.qte_pertinente ?? row.quantite_pert ?? row.qte_pert ?? row.quantite),
    ca_ht: safeNumber(row.ca_ht),
    marge_valeur: safeNumber(row.marge_valeur),
  }
}

function mapReferencePivotSourceRow(row: any): ReferencePivotSourceRow {
  return {
    annee: safeNumber(row.annee),
    famille_macro: safeText(row.famille_macro),
    famille: safeText(row.famille),
    reference_article: safeText(row.reference_article ?? row.reference ?? row.ref_article),
    designation: safeText(row.designation ?? row.libelle_article ?? row.libelle, ''),
    numero_document: '',
    mois: safeNumber(row.mois),
    type_document: normalizeFlux(row.type_document ?? row.flux),
    nb_lignes: safeNumber(row.nb_lignes),
    quantite: safeNumber(row.quantite),
    quantite_pertinente: safeNumber(row.quantite_pertinente ?? row.qte_pertinente ?? row.quantite_pert ?? row.qte_pert ?? row.quantite),
    ca_ht: safeNumber(row.ca_ht),
    marge_valeur: safeNumber(row.marge_valeur),
  }
}

function monthNumbers() {
  return Array.from({ length: 12 }, (_, index) => index + 1)
}

function emptyMonths() {
  return Object.fromEntries(monthNumbers().map((month) => [month, 0])) as Record<number, number>
}

function referencePivotKey(row: Pick<ReferencePivotSourceRow, 'famille_macro' | 'famille' | 'reference_article' | 'type_document'>) {
  return [row.famille_macro, row.famille, row.reference_article, row.type_document].join('§')
}

function fluxSortIndex(value: Flux) {
  const index = FLUX_ORDER.indexOf(value)
  return index >= 0 ? index : 999
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
  const filtered = useMemo(
    () => values.filter((value) => value.toLowerCase().includes(search.toLowerCase())).slice(0, 300),
    [values, search]
  )

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-black"
      >
        {label}{selected.length ? ` (${selected.length})` : ''}
      </button>
      {open && (
        <div className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher…"
            className="mb-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
          />
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-2 w-full rounded-lg bg-slate-100 px-2 py-1 text-left text-xs font-bold hover:bg-slate-200"
          >
            Tout désélectionner
          </button>
          {filtered.map((value) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
              <span className="truncate">{value}</span>
            </label>
          ))}
          {!filtered.length && <div className="px-2 py-3 text-xs font-bold text-slate-400">Aucune valeur</div>}
          {values.length > 300 && <div className="px-2 py-2 text-[11px] font-bold text-slate-400">300 premières valeurs affichées. Utilise la recherche pour filtrer.</div>}
        </div>
      )}
    </div>
  )
}

function ReferencesFreeInput({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [text, setText] = useState(selected.join(', '))

  useEffect(() => {
    setText(selected.join(', '))
  }, [selected])

  function parseReferences(value: string) {
    return uniqueSorted(
      value
        .split(/[;,\n]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  }

  return (
    <input
      value={text}
      onChange={(event) => {
        const nextText = event.target.value
        setText(nextText)
        onChange(parseReferences(nextText))
      }}
      placeholder="Références (séparées par virgule)"
      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
    />
  )
}

export default function ApprovisionnementsPage() {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [metric, setMetric] = useState<Metric>('quantite_pertinente')
  const [includeHorsStat, setIncludeHorsStat] = useState(false)
  const [visibleFlux, setVisibleFlux] = useState<Record<Flux, boolean>>({ DEVIS: true, CDC: false, BL: true, FACTURE: true })

  const [depots, setDepots] = useState<string[]>([])
  const [collaborateursTiers, setCollaborateursTiers] = useState<string[]>([])
  const [famillesMacro, setFamillesMacro] = useState<string[]>(DEFAULT_SELECTED_MACROS)
  const [familles, setFamilles] = useState<string[]>([])
  const [references, setReferences] = useState<string[]>([])

  const [available, setAvailable] = useState({
    depots: [] as string[],
    collaborateursTiers: [] as string[],
    famillesMacro: [] as string[],
    familles: [] as string[],
    references: [] as string[],
  })

  const [summaryRows, setSummaryRows] = useState<SummaryRpcRow[]>([])
  const [scopeDetailRows, setScopeDetailRows] = useState<DetailRpcRow[]>([])
  const [referencePivotRows, setReferencePivotRows] = useState<ReferencePivotSourceRow[]>([])
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>(null)
  const [referenceScope, setReferenceScope] = useState<ReferenceScope>(null)
  const [chartMonth, setChartMonth] = useState<number | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingFamily, setLoadingFamily] = useState(false)
  const [loadingReferencePivot, setLoadingReferencePivot] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null)
  const [lastBusinessDates, setLastBusinessDates] = useState<LastBusinessDates>(EMPTY_LAST_BUSINESS_DATES)

  const n1ComparisonMonth = useMemo(() => currentComparisonMonthForYear(selectedYear), [selectedYear])
  const lastUpdateLabel = useMemo(() => formatLastBusinessDatesLabel(lastBusinessDates), [lastBusinessDates])

  const selectedReferenceCodes = useMemo(
    () => references.map(referenceCode).filter(Boolean),
    [references]
  )

  const rpcFilterPayload = useMemo(() => ({
    p_year: selectedYear,
    p_include_hors_stat: includeHorsStat,
    p_depots: depots,
    p_collaborateurs_tiers: collaborateursTiers,
    p_familles_macro: famillesMacro,
    p_familles: familles,
    p_references: selectedReferenceCodes,
  }), [selectedYear, includeHorsStat, depots, collaborateursTiers, famillesMacro, familles, selectedReferenceCodes])

  function resetDownstream(keepChartMonth = false) {
    setAnalysisScope(null)
    setReferenceScope(null)
    setScopeDetailRows([])
    setReferencePivotRows([])
    if (!keepChartMonth) setChartMonth(null)
  }

  async function loadOptions(yearToLoad = selectedYear) {
    setLoadingOptions(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('get_appro_filter_options_light', {
        p_annee: yearToLoad,
        p_include_hors_statistique: includeHorsStat,
      })
      if (rpcError) throw rpcError

      const rows = ((data || []) as OptionRpcRow[]).map((row) => ({
        optionType: safeText(row.option_type ?? row.type_filtre, ''),
        value: safeText(row.value ?? row.valeur, ''),
      }))

      const nextDepots = uniqueSorted(rows.filter((row) => row.optionType === 'depot').map((row) => row.value))
      const nextCollaborateursTiers = uniqueSorted(rows.filter((row) => row.optionType === 'collaborateur_tiers').map((row) => row.value))
      const nextFamillesMacro = uniqueSorted(rows.filter((row) => row.optionType === 'famille_macro').map((row) => row.value))
      const nextFamilles = uniqueSorted(rows.filter((row) => row.optionType === 'famille').map((row) => row.value))

      setAvailable({
        depots: nextDepots,
        collaborateursTiers: nextCollaborateursTiers,
        famillesMacro: nextFamillesMacro,
        familles: nextFamilles,
        // Les références ne sont volontairement plus chargées en masse : il peut y en avoir des dizaines de milliers.
        // Elles sont maintenant saisies librement dans le filtre Références.
        references: [],
      })

      // Au chargement, on sélectionne par défaut les familles macro vues sur l'écran de référence
      // sans écraser ensuite un choix utilisateur volontairement différent.
      setFamillesMacro((current) => {
        const currentIsDefault = !current.length || current.every((macro) => DEFAULT_SELECTED_MACRO_NORMALIZED.has(normalizeMacro(macro)))
        return currentIsDefault ? defaultSelectedMacrosFromAvailable(nextFamillesMacro) : current
      })
    } catch (exception: any) {
      setError(`Chargement des filtres impossible : ${exception?.message || exception}`)
    } finally {
      setLoadingOptions(false)
    }
  }

  async function loadSummary() {
    setLoadingSummary(true)
    setError(null)
    resetDownstream()
    try {
      const { data, error: rpcError } = await supabase.rpc('get_appro_flux_summary', rpcFilterPayload)
      if (rpcError) throw rpcError
      const mappedRows = ((data || []) as Record<string, any>[]).map(mapSummaryRow)
      setSummaryRows(mappedRows)
    } catch (exception: any) {
      setError(`Chargement de la synthèse impossible : ${exception?.message || exception}`)
      setSummaryRows([])
    } finally {
      setLoadingSummary(false)
    }
  }


  async function loadLastBusinessDates(yearToLoad = selectedYear) {
    try {
      setLastBusinessDates(await fetchLatestBusinessDates(yearToLoad))
    } catch {
      setLastBusinessDates(EMPTY_LAST_BUSINESS_DATES)
    }
  }

  function detailCombinationsForScope(scope: Exclude<AnalysisScope, null>) {
    const map = new Map<string, { mois: number; flux: Flux; famille_macro: string }>()

    summaryRows.forEach((row) => {
      if (row.annee !== selectedYear && row.annee !== selectedYear - 1) return
      if (scope.mois && row.mois !== scope.mois) return
      if (scope.flux && row.flux !== scope.flux) return
      if (!scope.flux && !visibleFlux[row.flux]) return
      if (scope.famille_macro && row.famille_macro !== scope.famille_macro) return
      if (!safeNumber(row.nb_lignes) && !safeNumber(row.ca_ht) && !safeNumber(row.quantite) && !safeNumber(row.quantite_pertinente)) return

      const key = `${row.mois}|${row.flux}|${row.famille_macro}`
      map.set(key, { mois: row.mois, flux: row.flux, famille_macro: row.famille_macro })
    })

    return Array.from(map.values()).sort((a, b) => {
      if (a.mois !== b.mois) return a.mois - b.mois
      const macro = a.famille_macro.localeCompare(b.famille_macro, 'fr', { numeric: true })
      if (macro !== 0) return macro
      return FLUX_ORDER.indexOf(a.flux) - FLUX_ORDER.indexOf(b.flux)
    })
  }

  async function loadDetailForScope(scope: Exclude<AnalysisScope, null>) {
    setLoadingFamily(true)
    setError(null)
    setReferenceScope(null)
    setScopeDetailRows([])

    try {
      const combinations = detailCombinationsForScope(scope)

      if (!combinations.length) {
        setScopeDetailRows([])
        return
      }

      const allRows: DetailRpcRow[] = []

      for (const combo of combinations) {
        for (const yearToLoad of [selectedYear, selectedYear - 1]) {
          const { data, error: rpcError } = await supabase.rpc('get_appro_flux_cell_detail', {
            p_year: yearToLoad,
            p_mois: combo.mois,
            p_flux: combo.flux,
            p_famille_macro: combo.famille_macro,
            p_include_hors_stat: includeHorsStat,
            p_depots: depots,
            p_collaborateurs_tiers: collaborateursTiers,
            p_familles: familles,
            p_references: selectedReferenceCodes,
          })

          if (rpcError) throw rpcError
          allRows.push(...(((data || []) as Record<string, any>[]).map((detailRow) => mapDetailRow(detailRow, yearToLoad))))
        }
      }

      setScopeDetailRows(allRows)
    } catch (exception: any) {
      setError(`Chargement du détail familles impossible : ${exception?.message || exception}`)
      setScopeDetailRows([])
    } finally {
      setLoadingFamily(false)
    }
  }

  function handleAnalysisScope(scope: Exclude<AnalysisScope, null>) {
    setAnalysisScope(scope)
    setReferenceScope(null)
    loadDetailForScope(scope)
  }

  function handleMacroScope(familleMacro: string, mois: number | undefined, label: string) {
    const scope: Exclude<AnalysisScope, null> = {
      famille_macro: familleMacro,
      mois,
      label,
    }
    handleAnalysisScope(scope)
    setReferenceScope({
      famille_macro: familleMacro,
      mois,
      label: `${label} · toutes familles / articles`,
    })
  }

  async function loadReferencePivotForScope(scope: Exclude<ReferenceScope, null>) {
    setLoadingReferencePivot(true)
    setError(null)
    setReferencePivotRows([])

    try {
      const { data, error: rpcError } = await supabase.rpc('get_appro_flux_reference_pivot_source_v19', {
        p_year: selectedYear,
        p_mois: scope.mois ?? null,
        p_flux: scope.flux ?? null,
        p_famille_macro: scope.famille_macro,
        p_famille: scope.famille ?? null,
        p_include_hors_stat: includeHorsStat,
        p_depots: depots,
        p_collaborateurs_tiers: collaborateursTiers,
        p_familles_macro: famillesMacro,
        p_familles: familles,
        p_references: selectedReferenceCodes,
        p_limit: 50000,
      })

      if (rpcError) throw rpcError
      setReferencePivotRows(((data || []) as Record<string, any>[]).map(mapReferencePivotSourceRow))
    } catch (exception: any) {
      setError(`Chargement du détail articles impossible : ${exception?.message || exception}`)
      setReferencePivotRows([])
    } finally {
      setLoadingReferencePivot(false)
    }
  }

  function handleChartClick(state: any) {
    const month = safeNumber(state?.activePayload?.[0]?.payload?.mois)
    if (!month) return
    setChartMonth(month)
    handleAnalysisScope({ mois: month, label: `${monthLabel(month)} ${selectedYear} · toutes familles macro / documents sélectionnés` })
  }

  function clearChartMonth() {
    setChartMonth(null)
    resetDownstream(true)
  }

  function formatDateForSql(date: Date) {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function getRecentMonthPeriods(monthCount: 2 | 3 = 3) {
    const periods: Array<{ p_date_debut: string; p_date_fin: string; label: string }> = []
    const now = new Date()
    const safeMonthCount = monthCount === 2 ? 2 : 3
    const cursor = new Date(now.getFullYear(), now.getMonth() - (safeMonthCount - 1), 1)
    const limit = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    while (cursor < limit) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      periods.push({
        p_date_debut: formatDateForSql(cursor),
        p_date_fin: formatDateForSql(next),
        label: `${formatDateForSql(cursor)} → ${formatDateForSql(next)}`,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }

    return periods
  }

  async function runRpcForPeriods(functionName: string, periods: ReturnType<typeof getRecentMonthPeriods>, label: string) {
    for (const period of periods) {
      setMaintenanceMessage(`${label} : ${period.label}`)
      const { error: rpcError } = await supabase.rpc(functionName, {
        p_date_debut: period.p_date_debut,
        p_date_fin: period.p_date_fin,
      })
      if (rpcError) throw new Error(`${functionName} ${period.label} : ${rpcError.message}`)
    }
  }

  async function handleRebuildRecentMonths(monthCount: 2 | 3 = 3, blMxMode?: 'previous_month' | 'current_month') {
    if (maintenanceLoading) return
    const message = blMxMode
      ? `Confirmer BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} puis rebuild des ${monthCount} derniers mois ?`
      : `Confirmer le rebuild des agrégats des ${monthCount} derniers mois ?`
    if (!window.confirm(message)) return

    setMaintenanceLoading(true)
    setMaintenanceMessage(`Préparation du rebuild ${monthCount} mois…`)
    setError(null)

    try {
      if (blMxMode) {
        const { error: modeError } = await supabase.rpc('set_bl_mx_mode', { p_mode: blMxMode })
        if (modeError) throw new Error(`set_bl_mx_mode : ${modeError.message}`)
      }

      const periods = getRecentMonthPeriods(monthCount)
      await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, 'Cache factures')
      await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, 'Agrégat factures')
      await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, 'Cache devis')
      await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, 'Agrégat devis')
      await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, 'Agrégat activité')
      await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', periods, 'Flux articles')
      setMaintenanceMessage('Rebuild terminé. Rechargement de la page…')
      await loadOptions(selectedYear)
      await loadSummary()
      setMaintenanceMessage(`Rebuild ${monthCount} mois terminé.`)
    } catch (exception: any) {
      setError(`Rebuild impossible : ${exception?.message || exception}`)
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  useEffect(() => {
    loadOptions(selectedYear)
    loadSummary()
    loadLastBusinessDates(selectedYear)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, includeHorsStat])

  useEffect(() => {
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depots, collaborateursTiers, famillesMacro, familles, references])

  useEffect(() => {
    if (!referenceScope) {
      setReferencePivotRows([])
      return
    }
    loadReferencePivotForScope(referenceScope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceScope, selectedYear, includeHorsStat, depots, collaborateursTiers, famillesMacro, familles, references])

  const chartData = useMemo<ChartDatum[]>(() => {
    const output: ChartDatum[] = Array.from({ length: 12 }, (_, index) => {
      const base: ChartDatum = { mois: index + 1, label: monthLabel(index + 1) }
      FLUX_ORDER.forEach((flux) => {
        base[`${flux}_N`] = 0
        base[`${flux}_N1`] = 0
      })
      return base
    })

    summaryRows.forEach((row) => {
      if (!visibleFlux[row.flux]) return
      const monthIndex = row.mois - 1
      if (monthIndex < 0 || monthIndex > 11) return
      const suffix = row.annee === selectedYear ? 'N' : row.annee === selectedYear - 1 ? 'N1' : null
      if (!suffix) return
      const key = `${row.flux}_${suffix}`
      output[monthIndex][key] = safeNumber(output[monthIndex][key]) + getMetricValue(row, metric)
    })

    return output
  }, [summaryRows, selectedYear, metric, visibleFlux])

  function buildMatrixRows(sourceRows: SummaryRpcRow[], sourceMetric: Metric, options?: { priorityOnly?: boolean; respectVisibleFlux?: boolean; selectedMonth?: number | null }) {
    const map = new Map<string, MatrixRow>()
    const priorityOnly = Boolean(options?.priorityOnly)
    const respectVisibleFlux = options?.respectVisibleFlux !== false
    const selectedMonth = options?.selectedMonth ?? null

    sourceRows.forEach((row) => {
      if (row.annee !== selectedYear && row.annee !== selectedYear - 1) return
      if (selectedMonth && row.mois !== selectedMonth) return
      if (respectVisibleFlux && !visibleFlux[row.flux]) return

      if (priorityOnly) {
        if (!PRIORITY_FLUX_ORDER.includes(row.flux)) return
        if (!PRIORITY_MACRO_ORDER.includes(normalizeMacro(row.famille_macro))) return
      }

      const value = getMetricValue(row, sourceMetric)
      if (!hasMetricValue(value)) return

      const key = `${row.famille_macro}|${row.flux}`
      if (!map.has(key)) {
        map.set(key, {
          famille_macro: row.famille_macro,
          flux: row.flux,
          mois: {},
          moisN1: {},
          total: 0,
          totalN1: 0,
        })
      }

      const target = map.get(key)!

      if (row.annee === selectedYear) {
        target.mois[row.mois] = safeNumber(target.mois[row.mois]) + value
        target.total += value
      } else {
        target.moisN1[row.mois] = safeNumber(target.moisN1[row.mois]) + value
        if (row.mois <= n1ComparisonMonth) target.totalN1 += value
      }
    })

    return Array.from(map.values()).filter(matrixRowHasValue).sort((a, b) => {
      if (priorityOnly) {
        const macro = PRIORITY_MACRO_ORDER.indexOf(normalizeMacro(a.famille_macro)) - PRIORITY_MACRO_ORDER.indexOf(normalizeMacro(b.famille_macro))
        if (macro !== 0) return macro
        return PRIORITY_FLUX_ORDER.indexOf(a.flux) - PRIORITY_FLUX_ORDER.indexOf(b.flux)
      }
      const macro = a.famille_macro.localeCompare(b.famille_macro, 'fr', { numeric: true })
      if (macro !== 0) return macro
      return FLUX_ORDER.indexOf(a.flux) - FLUX_ORDER.indexOf(b.flux)
    })
  }

  const priorityRows = useMemo<MatrixRow[]>(
    () => buildMatrixRows(summaryRows, 'quantite_pertinente', { priorityOnly: true, respectVisibleFlux: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryRows, selectedYear, n1ComparisonMonth]
  )

  const matrixRows = useMemo<MatrixRow[]>(
    () => buildMatrixRows(summaryRows, metric, { selectedMonth: chartMonth }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaryRows, selectedYear, metric, visibleFlux, chartMonth, n1ComparisonMonth]
  )

  const familyMatrixRows = useMemo<FamilyMatrixRow[]>(() => {
    const map = new Map<string, FamilyMatrixRow>()

    scopeDetailRows.forEach((row) => {
      if (row.annee !== selectedYear && row.annee !== selectedYear - 1) return
      if (analysisScope?.mois && row.mois !== analysisScope.mois) return
      if (analysisScope?.flux && row.type_document !== analysisScope.flux) return
      if (!analysisScope?.flux && !visibleFlux[row.type_document]) return
      if (analysisScope?.famille_macro && row.famille_macro !== analysisScope.famille_macro) return

      const value = getMetricValue(row, metric)
      if (!hasMetricValue(value)) return

      const key = `${row.famille_macro}|${row.famille}|${row.type_document}`
      if (!map.has(key)) {
        map.set(key, {
          famille_macro: row.famille_macro,
          famille: row.famille,
          flux: row.type_document,
          mois: {},
          moisN1: {},
          total: 0,
          totalN1: 0,
        })
      }

      const target = map.get(key)!

      if (row.annee === selectedYear) {
        target.mois[row.mois] = safeNumber(target.mois[row.mois]) + value
        target.total += value
      } else {
        target.moisN1[row.mois] = safeNumber(target.moisN1[row.mois]) + value
        if (analysisScope?.mois || row.mois <= n1ComparisonMonth) target.totalN1 += value
      }
    })

    return Array.from(map.values()).filter((row) => matrixRowHasValue(row)).sort((a, b) => {
      const macro = a.famille_macro.localeCompare(b.famille_macro, 'fr', { numeric: true })
      if (macro !== 0) return macro
      const family = a.famille.localeCompare(b.famille, 'fr', { numeric: true })
      if (family !== 0) return family
      return FLUX_ORDER.indexOf(a.flux) - FLUX_ORDER.indexOf(b.flux)
    })
  }, [scopeDetailRows, selectedYear, metric, analysisScope, visibleFlux, n1ComparisonMonth])

  const referenceRows = useMemo(() => {
    if (!referenceScope) return []
    return scopeDetailRows.filter((row) => {
      if (row.famille_macro !== referenceScope.famille_macro) return false
      if (referenceScope.famille && row.famille !== referenceScope.famille) return false
      if (referenceScope.flux && row.type_document !== referenceScope.flux) return false
      if (!referenceScope.flux && !visibleFlux[row.type_document]) return false
      if (referenceScope.mois && row.mois !== referenceScope.mois) return false
      return true
    })
  }, [scopeDetailRows, referenceScope, visibleFlux])

  const referencePivotMatrixRows = useMemo<ReferencePivotRow[]>(() => {
    const map = new Map<string, ReferencePivotRow>()

    referencePivotRows.forEach((row) => {
      if (!referenceScope?.flux && !visibleFlux[row.type_document]) return

      const value = getMetricValue(row, metric)
      if (!hasMetricValue(value)) return

      const key = referencePivotKey(row)
      if (!map.has(key)) {
        map.set(key, {
          famille_macro: row.famille_macro,
          famille: row.famille,
          reference_article: row.reference_article,
          designation: row.designation,
          type_document: row.type_document,
          mois: emptyMonths(),
          moisN1: emptyMonths(),
          total: 0,
          totalN1: 0,
        })
      }

      const target = map.get(key)!
      if (row.annee === selectedYear) {
        target.mois[row.mois] = safeNumber(target.mois[row.mois]) + value
        target.total += value
      } else if (row.annee === selectedYear - 1) {
        target.moisN1[row.mois] = safeNumber(target.moisN1[row.mois]) + value
        if (row.mois <= n1ComparisonMonth) target.totalN1 += value
      }
    })

    return Array.from(map.values()).filter(matrixRowHasValue).sort((a, b) => {
      const macro = a.famille_macro.localeCompare(b.famille_macro, 'fr', { numeric: true })
      if (macro !== 0) return macro
      const family = a.famille.localeCompare(b.famille, 'fr', { numeric: true })
      if (family !== 0) return family
      const reference = a.reference_article.localeCompare(b.reference_article, 'fr', { numeric: true })
      if (reference !== 0) return reference
      return fluxSortIndex(a.type_document) - fluxSortIndex(b.type_document)
    })
  }, [referencePivotRows, metric, selectedYear, referenceScope, visibleFlux, n1ComparisonMonth])

  const totalAggregatedRows = useMemo(
    () => summaryRows.reduce((sum: number, row: SummaryRpcRow) => sum + safeNumber(row.nb_lignes), 0),
    [summaryRows]
  )

  function valueWithN1(value: number, valueN1: number, valueMetric: Metric, selected = false, flux?: Flux) {
    const main = safeNumber(value)
    const previous = safeNumber(valueN1)
    const colorStyle = flux && !selected ? { color: FLUX_COLORS[flux] } : undefined

    if (!main && !previous) return '—'

    return (
      <span className={`flex flex-col items-end leading-tight ${!main ? 'text-slate-400' : ''}`} style={colorStyle}>
        <span>{main ? formatMetric(main, valueMetric) : '—'}</span>
        {previous ? (
          <span className={`text-[11px] font-bold ${selected ? 'text-blue-100' : 'text-slate-500'}`} style={colorStyle}>
            ({formatMetric(previous, valueMetric)})
          </span>
        ) : null}
      </span>
    )
  }

  function fluxValueStyle(flux: Flux, selected = false) {
    return selected ? undefined : { color: FLUX_COLORS[flux] }
  }

  function valueWithParenthesis(value: number, valueN1: number, valueMetric: Metric = metric) {
    const main = safeNumber(value)
    const previous = safeNumber(valueN1)
    if (!main && !previous) return '—'
    if (!previous) return main ? formatMetric(main, valueMetric) : '—'
    return `${main ? formatMetric(main, valueMetric) : '—'} (${formatMetric(previous, valueMetric)})`
  }

  function clickableCellClass(selected: boolean, hasValue: boolean) {
    if (selected) return 'bg-blue-600 text-white'
    if (hasValue) return 'hover:bg-blue-50'
    return 'text-slate-300 hover:bg-slate-50'
  }

  function makeScopeFromMatrix(row: MatrixRow, patch: Partial<Exclude<AnalysisScope, null>>, label: string): Exclude<AnalysisScope, null> {
    return {
      mois: chartMonth ?? undefined,
      famille_macro: row.famille_macro,
      flux: row.flux,
      ...patch,
      label,
    }
  }

  function makeReferenceScopeFromFamily(row: FamilyMatrixRow, patch: Partial<Exclude<ReferenceScope, null>>, label: string): Exclude<ReferenceScope, null> {
    return {
      famille_macro: row.famille_macro,
      famille: row.famille,
      flux: row.flux,
      ...patch,
      label,
    }
  }

  function makePriorityExportRows() {
    return priorityRows.map((row) => {
      const exported: Record<string, any> = {
        'Famille macro': row.famille_macro,
        'Type document': FLUX_LABELS[row.flux],
      }
      for (let month = 1; month <= 12; month += 1) {
        exported[`${monthLabel(month)} ${selectedYear}`] = safeNumber(row.mois[month])
        exported[`${monthLabel(month)} ${selectedYear - 1}`] = safeNumber(row.moisN1[month])
      }
      exported[`Total ${selectedYear}`] = row.total
      exported[`Total ${selectedYear - 1}`] = row.totalN1
      return exported
    })
  }

  function makeSummaryExportRows() {
    return matrixRows.map((row) => {
      const exported: Record<string, any> = {
        'Famille macro': row.famille_macro,
        'Type document': FLUX_LABELS[row.flux],
      }
      for (let month = 1; month <= 12; month += 1) {
        exported[`${monthLabel(month)} ${selectedYear}`] = safeNumber(row.mois[month])
        exported[`${monthLabel(month)} ${selectedYear - 1}`] = safeNumber(row.moisN1[month])
      }
      exported[`Total ${selectedYear}`] = row.total
      exported[`Total ${selectedYear - 1}`] = row.totalN1
      return exported
    })
  }

  function makeFamilyExportRows() {
    return familyMatrixRows.map((row) => {
      const exported: Record<string, any> = {
        'Famille macro': row.famille_macro,
        Famille: row.famille,
        'Type document': FLUX_LABELS[row.flux],
      }
      for (let month = 1; month <= 12; month += 1) exported[monthLabel(month)] = valueWithParenthesis(row.mois[month], row.moisN1[month])
      exported.Total = valueWithParenthesis(row.total, row.totalN1)
      return exported
    })
  }

  function makeDetailExportRows(rows: DetailRpcRow[]) {
    return rows.map((row) => ({
      'Famille macro': row.famille_macro,
      Famille: row.famille,
      Référence: row.reference_article,
      Désignation: row.designation,
      'N° document': row.numero_document,
      Mois: monthLabel(row.mois),
      'Type document': FLUX_LABELS[row.type_document],
      'Nb lignes': row.nb_lignes,
      'Quantité brute': row.quantite,
      'Quantité pertinente': row.quantite_pertinente,
      'CA HT': row.ca_ht,
      Marge: row.marge_valeur,
    }))
  }

  function makeReferencePivotExportRows(rows = referencePivotMatrixRows) {
    return rows.map((row) => {
      const output: Record<string, any> = {
        'Famille macro': row.famille_macro,
        Famille: row.famille,
        Référence: row.reference_article,
        'Type document': FLUX_LABELS[row.type_document],
      }
      monthNumbers().forEach((month, index) => {
        output[MONTHS[index]] = valueWithParenthesis(row.mois[month], row.moisN1[month])
      })
      output['Total général'] = valueWithParenthesis(row.total, row.totalN1)
      return output
    })
  }

  function exportWorkbook(includeDetail: boolean) {
    const sheets = [
      { name: `Prioritaires ${selectedYear}`, rows: makePriorityExportRows() },
      { name: `Macro ${selectedYear}`, rows: makeSummaryExportRows() },
    ]
    if (familyMatrixRows.length) sheets.push({ name: 'Familles', rows: makeFamilyExportRows() })
    if (includeDetail) {
      sheets.push(referencePivotMatrixRows.length
        ? { name: 'Détail pivot', rows: makeReferencePivotExportRows() }
        : { name: 'Références', rows: makeDetailExportRows(referenceRows.length ? referenceRows : scopeDetailRows) }
      )
    }
    downloadWorkbook(`approvisionnements_${selectedYear}_${includeDetail ? 'avec_detail' : 'synthese'}.xlsx`, sheets)
  }

  const loading = loadingOptions || loadingSummary

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-2xl font-black">Approvisionnements & flux commerciaux</h1>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 shadow-sm">
              Dernières pièces : {lastUpdateLabel}
            </span>
          </div>
          <p className="text-sm font-bold text-slate-500">Lecture des tendances Devis → CDC → BL → Factures par famille macro, famille et référence article.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => handleRebuildRecentMonths(2)}
            disabled={maintenanceLoading}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {maintenanceLoading ? 'Rebuild…' : 'Rebuild 2 mois'}
          </button>
          <button
            type="button"
            onClick={() => handleRebuildRecentMonths(3)}
            disabled={maintenanceLoading}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {maintenanceLoading ? 'Rebuild…' : 'Rebuild 3 mois'}
          </button>
          <button
            type="button"
            onClick={() => handleRebuildRecentMonths(3, 'previous_month')}
            disabled={maintenanceLoading}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            BL M-x → M-1 (3 mois)
          </button>
          <button
            type="button"
            onClick={() => handleRebuildRecentMonths(3, 'current_month')}
            disabled={maintenanceLoading}
            className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-black text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            BL M-x → M (3 mois)
          </button>
          <button
            type="button"
            onClick={() => { loadOptions(selectedYear); loadSummary() }}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-700"
          >
            Actualiser
          </button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {maintenanceMessage && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{maintenanceMessage}</div>}
      {loading && <div className="mb-4 rounded-xl bg-white p-4 text-sm font-bold text-slate-600 shadow-sm">Chargement de la synthèse agrégée…</div>}

      <section className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          <select
            value={selectedYear}
            onChange={(event) => {
              setSelectedYear(Number(event.target.value))
              resetDownstream()
            }}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
          >
            {defaultYearOptions().map((year) => <option key={year} value={year}>Année : {year}</option>)}
          </select>
          <MultiSelect label="Dépôts" values={available.depots} selected={depots} onChange={(values) => { setDepots(values); resetDownstream() }} />
          <MultiSelect label="Collaborateur client" values={available.collaborateursTiers} selected={collaborateursTiers} onChange={(values) => { setCollaborateursTiers(values); resetDownstream() }} />
          <MultiSelect label="Familles macro" values={available.famillesMacro} selected={famillesMacro} onChange={(values) => { setFamillesMacro(values); resetDownstream() }} />
          <MultiSelect label="Familles" values={available.familles} selected={familles} onChange={(values) => { setFamilles(values); resetDownstream() }} />
          <ReferencesFreeInput selected={references} onChange={(values) => { setReferences(values); resetDownstream() }} />
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
          >
            <option value="quantite_pertinente">Quantité pertinente</option>
            <option value="ca_ht">CA HT</option>
            <option value="quantite">Quantité brute</option>
          </select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-600">
          <input type="checkbox" checked={includeHorsStat} onChange={(event) => { setIncludeHorsStat(event.target.checked); resetDownstream() }} />
          Inclure les articles hors statistique
        </label>
      </section>

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Courbes Devis → CDC → BL → Factures</h2>
            <p className="text-xs font-bold uppercase text-slate-500">
              {selectedYear} en trait plein · {selectedYear - 1} en pointillé · métrique par défaut : quantité pertinente · clique sur un mois du graphe pour filtrer l’analyse.
            </p>
          </div>
          <div className="text-right text-xs font-black uppercase text-slate-500">
            {formatNumber(totalAggregatedRows)} lignes sources agrégées
            {!includeHorsStat && <div className="text-amber-700">Articles hors statistique exclus</div>}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          {FLUX_ORDER.map((flux) => (
            <label key={flux} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black">
              <input
                type="checkbox"
                checked={visibleFlux[flux]}
                onChange={() => {
                  setVisibleFlux((current) => ({ ...current, [flux]: !current[flux] }))
                  resetDownstream(true)
                }}
              />
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: FLUX_COLORS[flux] }} />
              {FLUX_LABELS[flux]}
            </label>
          ))}
          {chartMonth && (
            <button
              type="button"
              onClick={clearChartMonth}
              className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-black text-blue-700 hover:bg-blue-100"
            >
              Mois sélectionné : {monthLabel(chartMonth)} · réinitialiser
            </button>
          )}
        </div>

        <div className="h-[430px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 20 }} onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => yAxisFormatter(Number(value), metric)} />
              <Tooltip formatter={(value: any) => formatMetric(safeNumber(value), metric)} />
              <Legend />
              {FLUX_ORDER.map((flux) => visibleFlux[flux] && (
                <Line
                  key={`${flux}_N`}
                  type="monotone"
                  dataKey={`${flux}_N`}
                  name={`${FLUX_LABELS[flux]} ${selectedYear}`}
                  stroke={FLUX_COLORS[flux]}
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
              {FLUX_ORDER.map((flux) => visibleFlux[flux] && (
                <Line
                  key={`${flux}_N1`}
                  type="monotone"
                  dataKey={`${flux}_N1`}
                  name={`${FLUX_LABELS[flux]} ${selectedYear - 1}`}
                  stroke={FLUX_COLORS[flux]}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  dot={{ r: 2 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Familles prioritaires · Devis puis Factures</h2>
            <p className="text-xs font-bold uppercase text-slate-500">
              R/R, R/O, R_ZONE, ECS, DRV, PV · uniquement les quantités pertinentes · valeur {selectedYear} avec {selectedYear - 1} entre parenthèses · total N-1 arrêté sur {comparisonPeriodLabel(n1ComparisonMonth)}.
            </p>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="px-3 py-2 text-left">Famille macro</th>
                <th className="px-3 py-2 text-left">Type document</th>
                {MONTHS.map((month, index) => (
                  <th key={month} className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setChartMonth(index + 1)
                        handleAnalysisScope({ mois: index + 1, label: `${month} ${selectedYear} · toutes familles macro / documents sélectionnés` })
                      }}
                      className="rounded-md px-2 py-1 text-right font-black hover:bg-slate-700"
                    >
                      {month}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {priorityRows.map((row) => (
                <tr key={`priority-${row.famille_macro}-${row.flux}`} className="border-b border-slate-100 odd:bg-slate-50">
                  <td className="px-3 py-2 font-bold">
                    <button
                      type="button"
                      onClick={() => handleMacroScope(row.famille_macro, undefined, `${row.famille_macro} · tous documents / tous mois`)}
                      className="rounded-lg px-2 py-1 text-left font-black hover:bg-blue-50"
                    >
                      {row.famille_macro}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-bold">
                    <button
                      type="button"
                      onClick={() => handleAnalysisScope(makeScopeFromMatrix(row, { mois: undefined }, `${row.famille_macro} · ${FLUX_LABELS[row.flux]} · tous mois`))}
                      className="rounded-lg px-2 py-1 text-left font-black hover:bg-blue-50"
                      style={{ color: FLUX_COLORS[row.flux] }}
                    >
                      {FLUX_LABELS[row.flux]}
                    </button>
                  </td>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                    const value = safeNumber(row.mois[month])
                    const valueN1 = safeNumber(row.moisN1[month])
                    const hasValue = Boolean(value || valueN1)
                    const selected = analysisScope?.famille_macro === row.famille_macro && analysisScope?.flux === row.flux && analysisScope?.mois === month
                    return (
                      <td key={month} className="px-2 py-1 text-right">
                        <button
                          type="button"
                          disabled={!hasValue}
                          onClick={() => handleAnalysisScope(makeScopeFromMatrix(row, { mois: month }, `${row.famille_macro} · ${FLUX_LABELS[row.flux]} · ${monthLabel(month)}`))}
                          className={`w-full rounded-lg px-2 py-1 text-right font-black ${clickableCellClass(selected, hasValue)}`}
                          style={fluxValueStyle(row.flux, selected)}
                        >
                          {valueWithN1(value, valueN1, 'quantite_pertinente', selected, row.flux)}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-black">
                    <button
                      type="button"
                      disabled={!row.total && !row.totalN1}
                      onClick={() => handleAnalysisScope(makeScopeFromMatrix(row, { mois: undefined }, `${row.famille_macro} · ${FLUX_LABELS[row.flux]} · total annuel`))}
                      className="w-full rounded-lg px-2 py-1 text-right font-black hover:bg-blue-50"
                      style={fluxValueStyle(row.flux)}
                    >
                      {valueWithN1(row.total, row.totalN1, 'quantite_pertinente', false, row.flux)}
                    </button>
                  </td>
                </tr>
              ))}
              {!priorityRows.length && (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucune donnée prioritaire avec les filtres sélectionnés.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Analyse macro familles / documents sélectionnés</h2>
            <p className="text-xs font-bold uppercase text-slate-500">
              Lecture en {metricLabel(metric)} · documents cochés dans la légende · {chartMonth ? `filtré sur ${monthLabel(chartMonth)}` : 'tous les mois'} · valeur {selectedYear} avec {selectedYear - 1} entre parenthèses · total N-1 arrêté sur {comparisonPeriodLabel(n1ComparisonMonth)}.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => exportWorkbook(false)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black hover:bg-slate-50">Exporter synthèse</button>
            <button type="button" onClick={() => exportWorkbook(true)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black hover:bg-slate-50">Exporter avec détail</button>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="px-3 py-2 text-left">Famille macro</th>
                <th className="px-3 py-2 text-left">Type document</th>
                {MONTHS.map((month, index) => (
                  <th key={month} className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setChartMonth(index + 1)
                        handleAnalysisScope({ mois: index + 1, label: `${month} ${selectedYear} · toutes familles macro / documents sélectionnés` })
                      }}
                      className="rounded-md px-2 py-1 text-right font-black hover:bg-slate-700"
                    >
                      {month}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={`${row.famille_macro}-${row.flux}`} className="border-b border-slate-100 odd:bg-slate-50">
                  <td className="px-3 py-2 font-bold">
                    <button
                      type="button"
                      onClick={() => handleMacroScope(row.famille_macro, chartMonth ?? undefined, `${row.famille_macro} · tous documents${chartMonth ? ` · ${monthLabel(chartMonth)}` : ''}`)}
                      className="rounded-lg px-2 py-1 text-left font-black hover:bg-blue-50"
                    >
                      {row.famille_macro}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-bold">
                    <button
                      type="button"
                      onClick={() => handleAnalysisScope(makeScopeFromMatrix(row, {}, `${row.famille_macro} · ${FLUX_LABELS[row.flux]}${chartMonth ? ` · ${monthLabel(chartMonth)}` : ' · tous mois'}`))}
                      className="rounded-lg px-2 py-1 text-left font-black hover:bg-blue-50"
                      style={{ color: FLUX_COLORS[row.flux] }}
                    >
                      {FLUX_LABELS[row.flux]}
                    </button>
                  </td>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                    const value = safeNumber(row.mois[month])
                    const valueN1 = safeNumber(row.moisN1[month])
                    const hasValue = Boolean(value || valueN1)
                    const selected = analysisScope?.famille_macro === row.famille_macro && analysisScope?.flux === row.flux && analysisScope?.mois === month
                    return (
                      <td key={month} className="px-2 py-1 text-right">
                        <button
                          type="button"
                          disabled={!hasValue}
                          onClick={() => handleAnalysisScope(makeScopeFromMatrix(row, { mois: month }, `${row.famille_macro} · ${FLUX_LABELS[row.flux]} · ${monthLabel(month)}`))}
                          className={`w-full rounded-lg px-2 py-1 text-right font-black ${clickableCellClass(selected, hasValue)}`}
                          style={fluxValueStyle(row.flux, selected)}
                        >
                          {valueWithN1(value, valueN1, metric, selected, row.flux)}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-black">
                    <button
                      type="button"
                      disabled={!row.total && !row.totalN1}
                      onClick={() => handleAnalysisScope(makeScopeFromMatrix(row, {}, `${row.famille_macro} · ${FLUX_LABELS[row.flux]} · ${chartMonth ? monthLabel(chartMonth) : 'total annuel'}`))}
                      className="w-full rounded-lg px-2 py-1 text-right font-black hover:bg-blue-50"
                      style={fluxValueStyle(row.flux)}
                    >
                      {valueWithN1(row.total, row.totalN1, metric, false, row.flux)}
                    </button>
                  </td>
                </tr>
              ))}
              {!matrixRows.length && (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucune donnée avec les filtres sélectionnés.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {analysisScope && (
        <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Détail familles de la sélection</h2>
              <p className="text-xs font-bold uppercase text-slate-500">
                {analysisScope.label} · lecture en {metricLabel(metric)} · {selectedYear - 1} entre parenthèses · total N-1 arrêté sur {comparisonPeriodLabel(n1ComparisonMonth)} · clique sur une famille, un type document, un mois ou un total pour afficher les références.
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadWorkbook(`approvisionnements_familles_${selectedYear}.xlsx`, [{ name: 'Familles', rows: makeFamilyExportRows() }])}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black hover:bg-slate-50"
            >
              Exporter familles
            </button>
          </div>

          {loadingFamily && <div className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Chargement des familles…</div>}

          {!loadingFamily && (
            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3 py-2 text-left">Famille macro</th>
                    <th className="px-3 py-2 text-left">Famille</th>
                    <th className="px-3 py-2 text-left">Type document</th>
                    {MONTHS.map((month, index) => (
                      <th key={month} className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setReferenceScope(null)}
                          className={`rounded-md px-2 py-1 text-right font-black ${analysisScope?.mois === index + 1 ? 'bg-blue-700 text-white' : 'hover:bg-slate-700'}`}
                        >
                          {month}
                        </button>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {familyMatrixRows.map((row) => (
                    <tr key={`${row.famille_macro}-${row.famille}-${row.flux}`} className="border-b border-slate-100 odd:bg-slate-50">
                      <td className="px-3 py-2 font-bold">{row.famille_macro}</td>
                      <td className="px-3 py-2 font-bold">
                        <button
                          type="button"
                          onClick={() => setReferenceScope(makeReferenceScopeFromFamily(row, { flux: undefined, mois: analysisScope?.mois }, `${row.famille_macro} · ${row.famille} · tous documents`))}
                          className="rounded-lg px-2 py-1 text-left font-black hover:bg-blue-50"
                        >
                          {row.famille}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-bold">
                        <button
                          type="button"
                          onClick={() => setReferenceScope(makeReferenceScopeFromFamily(row, { mois: analysisScope?.mois }, `${row.famille_macro} · ${row.famille} · ${FLUX_LABELS[row.flux]}`))}
                          className="rounded-lg px-2 py-1 text-left font-black hover:bg-blue-50"
                          style={{ color: FLUX_COLORS[row.flux] }}
                        >
                          {FLUX_LABELS[row.flux]}
                        </button>
                      </td>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                        const value = safeNumber(row.mois[month])
                        const valueN1 = safeNumber(row.moisN1[month])
                        const hasValue = hasMetricValue(value) || hasMetricValue(valueN1)
                        const selected = referenceScope?.famille_macro === row.famille_macro && referenceScope?.famille === row.famille && referenceScope?.flux === row.flux && referenceScope?.mois === month
                        return (
                          <td key={month} className="px-2 py-1 text-right">
                            <button
                              type="button"
                              disabled={!hasValue}
                              onClick={() => setReferenceScope(makeReferenceScopeFromFamily(row, { mois: month }, `${row.famille_macro} · ${row.famille} · ${FLUX_LABELS[row.flux]} · ${monthLabel(month)}`))}
                              className={`w-full rounded-lg px-2 py-1 text-right font-black ${clickableCellClass(selected, hasValue)}`}
                              style={fluxValueStyle(row.flux, selected)}
                            >
                              {valueWithN1(value, valueN1, metric, selected, row.flux)}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right font-black">
                        <button
                          type="button"
                          disabled={!hasMetricValue(row.total) && !hasMetricValue(row.totalN1)}
                          onClick={() => setReferenceScope(makeReferenceScopeFromFamily(row, { mois: analysisScope?.mois }, `${row.famille_macro} · ${row.famille} · ${FLUX_LABELS[row.flux]} · total`))}
                          className="w-full rounded-lg px-2 py-1 text-right font-black hover:bg-blue-50"
                          style={fluxValueStyle(row.flux)}
                        >
                          {valueWithN1(row.total, row.totalN1, metric, false, row.flux)}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!familyMatrixRows.length && (
                    <tr>
                      <td colSpan={16} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucune famille pour cette sélection.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {referenceScope && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Détail articles par référence / type document</h2>
              <p className="text-xs font-bold uppercase text-slate-500">
                {referenceScope.label} · année {selectedYear} avec {selectedYear - 1} entre parenthèses · total N-1 arrêté sur {comparisonPeriodLabel(n1ComparisonMonth)} · lecture en {metricLabel(metric)}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadWorkbook(`approvisionnements_detail_pivot_${selectedYear}.xlsx`, [{ name: 'Détail pivot', rows: makeReferencePivotExportRows() }])}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black hover:bg-slate-50"
            >
              Exporter détail pivot
            </button>
          </div>

          {loadingReferencePivot && <div className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Chargement du détail articles N / N-1…</div>}

          {!loadingReferencePivot && (
            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-[#55752c] text-white">
                    <th colSpan={4} className="sticky left-0 z-30 px-3 py-2 text-left font-black">
                      Somme de {metricLabel(metric)}
                    </th>
                    <th colSpan={13} className="px-3 py-2 text-center font-black">Mois</th>
                  </tr>
                  <tr className="bg-[#55752c] text-white">
                    <th className="sticky left-0 z-30 min-w-[160px] px-3 py-2 text-left">Famille macro</th>
                    <th className="sticky left-[160px] z-30 min-w-[220px] px-3 py-2 text-left">Famille</th>
                    <th className="sticky left-[380px] z-30 min-w-[180px] px-3 py-2 text-left">Référence</th>
                    <th className="sticky left-[560px] z-30 min-w-[140px] px-3 py-2 text-left">Type document</th>
                    {MONTHS.map((month) => <th key={month} className="min-w-[92px] px-3 py-2 text-right">{month}</th>)}
                    <th className="min-w-[125px] px-3 py-2 text-right">Total général</th>
                  </tr>
                </thead>
                <tbody>
                  {referencePivotMatrixRows.map((row) => (
                    <tr key={`${row.famille_macro}-${row.famille}-${row.reference_article}-${row.type_document}`} className="border-b border-slate-200 odd:bg-[#d9decf] even:bg-[#c9cfc2]">
                      <td className="sticky left-0 z-20 bg-inherit px-3 py-1 font-black text-slate-700">{row.famille_macro}</td>
                      <td className="sticky left-[160px] z-20 bg-inherit px-3 py-1 font-bold text-slate-800">{row.famille}</td>
                      <td className="sticky left-[380px] z-20 bg-inherit px-3 py-1 font-mono text-xs font-black text-slate-900" title={row.designation || row.reference_article}>{row.reference_article}</td>
                      <td className="sticky left-[560px] z-20 bg-inherit px-3 py-1 font-black" style={{ color: FLUX_COLORS[row.type_document] }}>{FLUX_LABELS[row.type_document]}</td>
                      {monthNumbers().map((month) => (
                        <td key={month} className="px-3 py-1 text-right font-bold" style={{ color: FLUX_COLORS[row.type_document] }}>
                          {valueWithParenthesis(row.mois[month], row.moisN1[month])}
                        </td>
                      ))}
                      <td className="px-3 py-1 text-right font-black" style={{ color: FLUX_COLORS[row.type_document] }}>
                        {valueWithParenthesis(row.total, row.totalN1)}
                      </td>
                    </tr>
                  ))}
                  {!referencePivotMatrixRows.length && (
                    <tr>
                      <td colSpan={17} className="px-3 py-10 text-center text-sm font-bold text-slate-500">
                        Aucun article avec cette sélection.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
