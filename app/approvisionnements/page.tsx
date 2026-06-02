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
type Metric = 'ca_ht' | 'quantite'

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
}

type DetailRpcRow = {
  famille_macro: string
  famille: string
  reference_article: string
  designation: string
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
  total: number
}

type SelectedCell = {
  famille_macro: string
  flux: Flux
  mois: number
} | null

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const MIN_YEAR_OPTION = 2023
const FLUX_ORDER: Flux[] = ['DEVIS', 'CDC', 'BL', 'FACTURE']
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

function monthLabel(month: number) {
  return MONTHS[Math.max(0, Math.min(11, month - 1))] || String(month)
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => safeText(value, '')).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  )
}

function referenceCode(referenceOption: string) {
  return String(referenceOption || '').split(' — ')[0].trim()
}

function getMetricValue(row: Pick<SummaryRpcRow | DetailRpcRow, 'ca_ht' | 'quantite' | 'quantite_pertinente'>, metric: Metric) {
  if (metric === 'quantite') return safeNumber(row.quantite_pertinente ?? row.quantite)
  return safeNumber(row.ca_ht)
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
  const [metric, setMetric] = useState<Metric>('ca_ht')
  const [includeHorsStat, setIncludeHorsStat] = useState(false)
  const [visibleFlux, setVisibleFlux] = useState<Record<Flux, boolean>>({ DEVIS: true, CDC: true, BL: true, FACTURE: true })

  const [depots, setDepots] = useState<string[]>([])
  const [collaborateursTiers, setCollaborateursTiers] = useState<string[]>([])
  const [famillesMacro, setFamillesMacro] = useState<string[]>([])
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
  const [detailRows, setDetailRows] = useState<DetailRpcRow[]>([])
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null)

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

      setAvailable({
        depots: uniqueSorted(rows.filter((row) => row.optionType === 'depot').map((row) => row.value)),
        collaborateursTiers: uniqueSorted(rows.filter((row) => row.optionType === 'collaborateur_tiers').map((row) => row.value)),
        famillesMacro: uniqueSorted(rows.filter((row) => row.optionType === 'famille_macro').map((row) => row.value)),
        familles: uniqueSorted(rows.filter((row) => row.optionType === 'famille').map((row) => row.value)),
        // Les références ne sont volontairement plus chargées en masse : il peut y en avoir des dizaines de milliers.
        // Elles sont maintenant saisies librement dans le filtre Références.
        references: [],
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
    setSelectedCell(null)
    setDetailRows([])
    try {
      const { data, error: rpcError } = await supabase.rpc('get_appro_flux_summary', rpcFilterPayload)
      if (rpcError) throw rpcError
      setSummaryRows((data || []).map((row: any) => ({
        annee: safeNumber(row.annee),
        mois: safeNumber(row.mois),
        flux: normalizeFlux(row.flux),
        type_document: safeText(row.type_document, normalizeFlux(row.flux)),
        famille_macro: safeText(row.famille_macro),
        nb_lignes: safeNumber(row.nb_lignes),
        quantite: safeNumber(row.quantite),
        quantite_pertinente: safeNumber(row.quantite_pertinente ?? row.quantite),
        ca_ht: safeNumber(row.ca_ht),
        marge_valeur: safeNumber(row.marge_valeur),
      })))
    } catch (exception: any) {
      setError(`Chargement de la synthèse impossible : ${exception?.message || exception}`)
      setSummaryRows([])
    } finally {
      setLoadingSummary(false)
    }
  }

  async function loadDetail(cell: Exclude<SelectedCell, null>) {
    setLoadingDetail(true)
    setDetailRows([])
    try {
      const { data, error: rpcError } = await supabase.rpc('get_appro_flux_cell_detail', {
        p_year: selectedYear,
        p_mois: cell.mois,
        p_flux: cell.flux,
        p_famille_macro: cell.famille_macro,
        p_include_hors_stat: includeHorsStat,
        p_depots: depots,
        p_collaborateurs_tiers: collaborateursTiers,
        p_familles: familles,
        p_references: selectedReferenceCodes,
      })
      if (rpcError) throw rpcError
      setDetailRows((data || []).map((row: any) => ({
        famille_macro: safeText(row.famille_macro),
        famille: safeText(row.famille),
        reference_article: safeText(row.reference_article),
        designation: safeText(row.designation),
        mois: safeNumber(row.mois),
        type_document: normalizeFlux(row.type_document),
        nb_lignes: safeNumber(row.nb_lignes),
        quantite: safeNumber(row.quantite),
        quantite_pertinente: safeNumber(row.quantite_pertinente ?? row.quantite),
        ca_ht: safeNumber(row.ca_ht),
        marge_valeur: safeNumber(row.marge_valeur),
      })))
    } catch (exception: any) {
      setError(`Chargement du détail impossible : ${exception?.message || exception}`)
    } finally {
      setLoadingDetail(false)
    }
  }


  function formatDateForSql(date: Date) {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function getSixMonthPeriods() {
    const periods: Array<{ p_date_debut: string; p_date_fin: string; label: string }> = []
    const now = new Date()
    const cursor = new Date(now.getFullYear(), now.getMonth() - 5, 1)
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

  async function runRpcForPeriods(functionName: string, periods: ReturnType<typeof getSixMonthPeriods>, label: string) {
    for (const period of periods) {
      setMaintenanceMessage(`${label} : ${period.label}`)
      const { error: rpcError } = await supabase.rpc(functionName, {
        p_date_debut: period.p_date_debut,
        p_date_fin: period.p_date_fin,
      })
      if (rpcError) throw new Error(`${functionName} ${period.label} : ${rpcError.message}`)
    }
  }

  async function updateQuantitesPertinentesForPeriods(periods: ReturnType<typeof getSixMonthPeriods>) {
    for (const period of periods) {
      setMaintenanceMessage(`Quantités pertinentes : ${period.label}`)
      const { error: rpcError } = await supabase.rpc('update_quantites_pertinentes_agregats', {
        p_date_debut: period.p_date_debut,
        p_date_fin: period.p_date_fin,
      })
      if (rpcError) throw new Error(`update_quantites_pertinentes_agregats ${period.label} : ${rpcError.message}`)
    }
  }

  async function handleRebuildSixMonths(blMxMode?: 'previous_month' | 'current_month') {
    if (maintenanceLoading) return
    const message = blMxMode
      ? `Confirmer BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} puis rebuild des 6 derniers mois ?`
      : 'Confirmer le rebuild des agrégats des 6 derniers mois ?'
    if (!window.confirm(message)) return

    setMaintenanceLoading(true)
    setMaintenanceMessage('Préparation du rebuild 6 mois…')
    setError(null)

    try {
      if (blMxMode) {
        const { error: modeError } = await supabase.rpc('set_bl_mx_mode', { p_mode: blMxMode })
        if (modeError) throw new Error(`set_bl_mx_mode : ${modeError.message}`)
      }

      const periods = getSixMonthPeriods()
      await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, 'Cache factures')
      await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, 'Agrégat factures')
      await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, 'Cache devis')
      await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, 'Agrégat devis')
      await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, 'Agrégat activité')
      await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', periods, 'Flux articles')
      await updateQuantitesPertinentesForPeriods(periods)

      setMaintenanceMessage('Rebuild terminé. Rechargement de la page…')
      await loadOptions(selectedYear)
      await loadSummary()
      setMaintenanceMessage('Rebuild 6 mois terminé.')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, includeHorsStat])

  useEffect(() => {
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depots, collaborateursTiers, famillesMacro, familles, references, metric])

  useEffect(() => {
    if (selectedCell) loadDetail(selectedCell)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell])

  const chartData = useMemo<ChartDatum[]>(() => {
    const output: ChartDatum[] = Array.from({ length: 12 }, (_, index) => ({ mois: index + 1, label: monthLabel(index + 1) }))

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

  const matrixRows = useMemo<MatrixRow[]>(() => {
    const map = new Map<string, MatrixRow>()

    summaryRows.forEach((row) => {
      if (row.annee !== selectedYear) return
      if (!visibleFlux[row.flux]) return
      const key = `${row.famille_macro}|${row.flux}`
      if (!map.has(key)) {
        map.set(key, { famille_macro: row.famille_macro, flux: row.flux, mois: {}, total: 0 })
      }
      const target = map.get(key)!
      const value = getMetricValue(row, metric)
      target.mois[row.mois] = safeNumber(target.mois[row.mois]) + value
      target.total += value
    })

    return Array.from(map.values()).sort((a, b) => {
      const macro = a.famille_macro.localeCompare(b.famille_macro, 'fr', { numeric: true })
      if (macro !== 0) return macro
      return FLUX_ORDER.indexOf(a.flux) - FLUX_ORDER.indexOf(b.flux)
    })
  }, [summaryRows, selectedYear, metric, visibleFlux])

  const totalAggregatedRows = useMemo(
    () => summaryRows.reduce((sum, row) => sum + safeNumber(row.nb_lignes), 0),
    [summaryRows]
  )

  function makeSummaryExportRows() {
    return matrixRows.map((row) => {
      const exported: Record<string, any> = {
        'Famille macro': row.famille_macro,
        'Type document': FLUX_LABELS[row.flux],
      }
      for (let month = 1; month <= 12; month += 1) exported[monthLabel(month)] = safeNumber(row.mois[month])
      exported.Total = row.total
      return exported
    })
  }

  function makeDetailExportRows(rows: DetailRpcRow[]) {
    return rows.map((row) => ({
      'Famille macro': row.famille_macro,
      Famille: row.famille,
      Référence: row.reference_article,
      Désignation: row.designation,
      Mois: monthLabel(row.mois),
      'Type document': FLUX_LABELS[row.type_document],
      'Nb lignes': row.nb_lignes,
      'Quantité brute': row.quantite,
      'Quantité pertinente': row.quantite_pertinente,
      'CA HT': row.ca_ht,
      Marge: row.marge_valeur,
    }))
  }

  function exportWorkbook(includeDetail: boolean) {
    const sheets = [{ name: `Synthèse ${selectedYear}`, rows: makeSummaryExportRows() }]
    if (includeDetail) sheets.push({ name: 'Détail cellule', rows: makeDetailExportRows(detailRows) })
    downloadWorkbook(`approvisionnements_${selectedYear}_${includeDetail ? 'avec_detail' : 'synthese'}.xlsx`, sheets)
  }

  const loading = loadingOptions || loadingSummary

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">Approvisionnements & flux commerciaux</h1>
          <p className="text-sm font-bold text-slate-500">Lecture des tendances Devis → CDC → BL → Factures par famille macro, famille et référence article.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => handleRebuildSixMonths()}
            disabled={maintenanceLoading}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {maintenanceLoading ? 'Rebuild…' : 'Rebuild 6 mois'}
          </button>
          <button
            type="button"
            onClick={() => handleRebuildSixMonths('previous_month')}
            disabled={maintenanceLoading}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            BL M-x → M-1
          </button>
          <button
            type="button"
            onClick={() => handleRebuildSixMonths('current_month')}
            disabled={maintenanceLoading}
            className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-black text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            BL M-x → M
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
              setSelectedCell(null)
            }}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
          >
            {defaultYearOptions().map((year) => <option key={year} value={year}>Année : {year}</option>)}
          </select>
          <MultiSelect label="Dépôts" values={available.depots} selected={depots} onChange={(values) => { setDepots(values); setSelectedCell(null) }} />
          <MultiSelect label="Collaborateur client" values={available.collaborateursTiers} selected={collaborateursTiers} onChange={(values) => { setCollaborateursTiers(values); setSelectedCell(null) }} />
          <MultiSelect label="Familles macro" values={available.famillesMacro} selected={famillesMacro} onChange={(values) => { setFamillesMacro(values); setSelectedCell(null) }} />
          <MultiSelect label="Familles" values={available.familles} selected={familles} onChange={(values) => { setFamilles(values); setSelectedCell(null) }} />
          <ReferencesFreeInput selected={references} onChange={(values) => { setReferences(values); setSelectedCell(null) }} />
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
          >
            <option value="ca_ht">CA HT</option>
            <option value="quantite">Quantité pertinente</option>
          </select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-600">
          <input type="checkbox" checked={includeHorsStat} onChange={(event) => { setIncludeHorsStat(event.target.checked); setSelectedCell(null) }} />
          Inclure les articles hors statistique
        </label>
      </section>

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Courbes Devis → CDC → BL → Factures</h2>
            <p className="text-xs font-bold uppercase text-slate-500">{selectedYear} en trait plein · {selectedYear - 1} en pointillé</p>
          </div>
          <div className="text-right text-xs font-black uppercase text-slate-500">
            {formatNumber(totalAggregatedRows)} lignes sources agrégées
            {!includeHorsStat && <div className="text-amber-700">Articles hors statistique exclus</div>}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-3">
          {FLUX_ORDER.map((flux) => (
            <label key={flux} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black">
              <input
                type="checkbox"
                checked={visibleFlux[flux]}
                onChange={() => setVisibleFlux((current) => ({ ...current, [flux]: !current[flux] }))}
              />
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: FLUX_COLORS[flux] }} />
              {FLUX_LABELS[flux]}
            </label>
          ))}
        </div>

        <div className="h-[430px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 20 }}>
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
            <h2 className="text-xl font-black">Synthèse par famille macro / type de document</h2>
            <p className="text-xs font-bold uppercase text-slate-500">Lecture en {metric === 'ca_ht' ? 'CA HT' : 'quantité pertinente'} · clic sur une cellule mensuelle pour afficher le détail</p>
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
                {MONTHS.map((month) => <th key={month} className="px-3 py-2 text-right">{month}</th>)}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={`${row.famille_macro}-${row.flux}`} className="border-b border-slate-100 odd:bg-slate-50">
                  <td className="px-3 py-2 font-bold">{row.famille_macro}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: FLUX_COLORS[row.flux] }}>{FLUX_LABELS[row.flux]}</td>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                    const value = safeNumber(row.mois[month])
                    const selected = selectedCell?.famille_macro === row.famille_macro && selectedCell?.flux === row.flux && selectedCell?.mois === month
                    return (
                      <td key={month} className="px-2 py-1 text-right">
                        <button
                          type="button"
                          disabled={!value}
                          onClick={() => setSelectedCell({ famille_macro: row.famille_macro, flux: row.flux, mois: month })}
                          className={`w-full rounded-lg px-2 py-1 text-right font-black ${selected ? 'bg-blue-600 text-white' : value ? 'hover:bg-blue-50' : 'text-slate-300'}`}
                        >
                          {value ? formatMetric(value, metric) : '—'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.total, metric)}</td>
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

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Détail de la cellule sélectionnée</h2>
            <p className="text-xs font-bold uppercase text-slate-500">
              {selectedCell
                ? `${selectedCell.famille_macro} · ${FLUX_LABELS[selectedCell.flux]} · ${monthLabel(selectedCell.mois)} ${selectedYear}`
                : 'Clique sur une cellule mensuelle du tableau de synthèse.'}
            </p>
          </div>
          {selectedCell && (
            <button
              type="button"
              onClick={() => downloadWorkbook(`approvisionnements_detail_${selectedYear}.xlsx`, [{ name: 'Détail cellule', rows: makeDetailExportRows(detailRows) }])}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black hover:bg-slate-50"
            >
              Exporter détail
            </button>
          )}
        </div>

        {loadingDetail && <div className="rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Chargement du détail…</div>}

        {selectedCell && !loadingDetail && (
          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Famille macro</th>
                  <th className="px-3 py-2 text-left">Famille</th>
                  <th className="px-3 py-2 text-left">Référence</th>
                  <th className="px-3 py-2 text-left">Désignation</th>
                  <th className="px-3 py-2 text-left">Mois</th>
                  <th className="px-3 py-2 text-left">Type document</th>
                  <th className="px-3 py-2 text-right">Nb lignes</th>
                  <th className="px-3 py-2 text-right">Qté pertinente</th>
                  <th className="px-3 py-2 text-right">CA HT</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr key={`${row.famille}-${row.reference_article}-${row.type_document}-${row.mois}`} className="border-b border-slate-100 odd:bg-slate-50">
                    <td className="px-3 py-2 font-bold">{row.famille_macro}</td>
                    <td className="px-3 py-2">{row.famille}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.reference_article}</td>
                    <td className="px-3 py-2">{row.designation}</td>
                    <td className="px-3 py-2">{monthLabel(row.mois)}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: FLUX_COLORS[row.type_document] }}>{FLUX_LABELS[row.type_document]}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatNumber(row.nb_lignes)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatNumber(row.quantite_pertinente)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatMetric(row.ca_ht, 'ca_ht')}</td>
                  </tr>
                ))}
                {!detailRows.length && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-sm font-bold text-slate-500">Aucun détail pour cette cellule.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
