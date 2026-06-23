'use client'

import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'

type AxisType = 'agence' | 'collaborateur' | 'famille_macro' | 'famille' | 'client'
type TransformationStatus = 'Tous' | 'Non transformé' | 'CDC créée' | 'BL créé' | 'Facturé'

type FilterOptions = {
  agences: string[]
  collaborateurs: string[]
  familles_macro: string[]
  familles: string[]
  statuts: string[]
}

type KpiRow = {
  nb_lignes_devis: number
  ca_devis: number
  nb_lignes_avec_cdc: number
  nb_lignes_avec_bl: number
  nb_lignes_avec_facture: number
  ca_devis_avec_cdc: number
  ca_devis_avec_bl: number
  ca_devis_avec_facture: number
  taux_cdc_valeur: number | null
  taux_bl_valeur: number | null
  taux_facture_valeur: number | null
  taux_facture_nombre: number | null
  delai_moyen_facture: number | null
  delai_median_facture: number | null
  delai_pondere_facture: number | null
  nb_devis_a_risque: number
  ca_devis_a_risque: number
}

type FunnelRow = {
  ordre: number
  etape: string
  nb_lignes: number
  ca_devis_reference: number
  taux_nombre: number | null
  taux_valeur: number | null
  delai_moyen: number | null
  delai_median: number | null
  delai_pondere: number | null
}

type AxisRow = {
  axe_type: string
  axe: string
  nb_lignes_devis: number
  ca_devis: number
  ca_devis_avec_cdc: number
  ca_devis_avec_bl: number
  ca_devis_avec_facture: number
  taux_cdc_valeur: number | null
  taux_bl_valeur: number | null
  taux_facture_valeur: number | null
  delai_facture_moyen: number | null
  delai_facture_median: number | null
  panier_moyen_devis: number
  nb_devis_a_risque: number
}

type TopDevisRow = {
  rang: number
  date_devis: string | null
  numero_devis: string
  numero_tiers: string
  intitule_tiers: string
  agence_collaborateur: string
  collaborateur_tiers: string
  famille_macro_principale: string
  nb_lignes: number
  ca_devis: number
  quantite_devis: number
  statut_transformation: string
  date_premiere_cdc: string | null
  date_premier_bl: string | null
  date_premiere_facture: string | null
  delai_devis_facture: number | null
}

type RiskRow = {
  priorite: string
  age_jours: number
  date_devis: string | null
  numero_devis: string
  numero_tiers: string
  intitule_tiers: string
  agence_collaborateur: string
  collaborateur_tiers: string
  famille_macro_principale: string
  nb_lignes: number
  ca_devis: number
  quantite_devis: number
  derniere_designation: string
}

type AlertRow = {
  type_alerte: string
  numero_tiers: string
  intitule_tiers: string
  agence_collaborateur: string
  collaborateur_tiers: string
  famille_macro_principale: string
  ca_devis_periode: number
  ca_devis_n1: number
  ecart_ca: number
  evolution_pct: number | null
  nb_devis_periode: number
  nb_devis_n1: number
  dernier_devis: string | null
}

const EMPTY_OPTIONS: FilterOptions = {
  agences: [],
  collaborateurs: [],
  familles_macro: [],
  familles: [],
  statuts: ['Non transformé', 'CDC créée', 'BL créé', 'Facturé'],
}

const AXIS_LABELS: Record<AxisType, string> = {
  agence: 'Agence',
  collaborateur: 'Collaborateur',
  famille_macro: 'Famille macro',
  famille: 'Famille',
  client: 'Client',
}

const STATUS_COLORS: Record<string, string> = {
  'Non transformé': 'bg-slate-100 text-slate-700 border-slate-200',
  'CDC créée': 'bg-cyan-50 text-cyan-800 border-cyan-200',
  'BL créé': 'bg-blue-50 text-blue-800 border-blue-200',
  Facturé: 'bg-emerald-50 text-emerald-800 border-emerald-200',
}

const ALERT_COLORS: Record<string, string> = {
  'Décrochage total': 'bg-red-50 text-red-800 border-red-200',
  'Baisse forte': 'bg-orange-50 text-orange-800 border-orange-200',
  'Nouveau signal': 'bg-blue-50 text-blue-800 border-blue-200',
  'Hausse forte': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Stable: 'bg-slate-50 text-slate-700 border-slate-200',
}

const PRIORITY_COLORS: Record<string, string> = {
  Haute: 'bg-red-50 text-red-800 border-red-200',
  Moyenne: 'bg-amber-50 text-amber-800 border-amber-200',
  Basse: 'bg-slate-50 text-slate-700 border-slate-200',
}

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function safeNullableNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = safeNumber(value)
  return Number.isFinite(n) ? n : null
}

function safeText(value: any, fallback = 'NON RENSEIGNE') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function uniqueSorted(values: any[]) {
  return Array.from(new Set(values.map((value) => safeText(value, '')).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  )
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateForInput(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
}

function firstDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1)
}

function addMonths(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1 + months, day || 1)
  return formatDateForInput(date)
}

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

function formatDate(value: string | null | undefined) {
  const iso = normalizeBusinessDate(value)
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function formatDateShort(value: string | null | undefined) {
  const iso = normalizeBusinessDate(value)
  if (!iso) return '—'
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

function formatNumber(value: number | null | undefined, fractionDigits = 0) {
  const number = safeNumber(value)
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(number)
}

function formatCurrency(value: number | null | undefined, compact = false) {
  const number = safeNumber(value)
  if (compact && Math.abs(number) >= 1000000) return `${formatNumber(number / 1000000, 1)} M€`
  if (compact && Math.abs(number) >= 1000) return `${formatNumber(number / 1000, 1)} K€`
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(number)
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${formatNumber(Number(value), 1)} %`
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${formatNumber(Number(value), 1)} j`
}

function defaultPeriod() {
  const now = new Date()
  const start = firstDayOfMonth(now.getFullYear(), 0)
  const end = firstDayOfMonth(now.getFullYear(), now.getMonth() + 1)
  return {
    start: formatDateForInput(start),
    end: formatDateForInput(end),
  }
}

function defaultYearOptions() {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let year = current; year >= 2023; year -= 1) years.push(year)
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

function asArray<T>(data: any): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data === null || data === undefined) return []
  return [data as T]
}

function firstRow<T>(data: any): T | null {
  const rows = asArray<T>(data)
  return rows.length ? rows[0] : null
}

function mapKpi(row: any): KpiRow {
  return {
    nb_lignes_devis: safeNumber(row?.nb_lignes_devis),
    ca_devis: safeNumber(row?.ca_devis),
    nb_lignes_avec_cdc: safeNumber(row?.nb_lignes_avec_cdc),
    nb_lignes_avec_bl: safeNumber(row?.nb_lignes_avec_bl),
    nb_lignes_avec_facture: safeNumber(row?.nb_lignes_avec_facture),
    ca_devis_avec_cdc: safeNumber(row?.ca_devis_avec_cdc),
    ca_devis_avec_bl: safeNumber(row?.ca_devis_avec_bl),
    ca_devis_avec_facture: safeNumber(row?.ca_devis_avec_facture),
    taux_cdc_valeur: safeNullableNumber(row?.taux_cdc_valeur),
    taux_bl_valeur: safeNullableNumber(row?.taux_bl_valeur),
    taux_facture_valeur: safeNullableNumber(row?.taux_facture_valeur),
    taux_facture_nombre: safeNullableNumber(row?.taux_facture_nombre),
    delai_moyen_facture: safeNullableNumber(row?.delai_moyen_facture),
    delai_median_facture: safeNullableNumber(row?.delai_median_facture),
    delai_pondere_facture: safeNullableNumber(row?.delai_pondere_facture),
    nb_devis_a_risque: safeNumber(row?.nb_devis_a_risque),
    ca_devis_a_risque: safeNumber(row?.ca_devis_a_risque),
  }
}

function mapFunnel(row: any): FunnelRow {
  return {
    ordre: safeNumber(row.ordre),
    etape: safeText(row.etape),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis_reference: safeNumber(row.ca_devis_reference),
    taux_nombre: safeNullableNumber(row.taux_nombre),
    taux_valeur: safeNullableNumber(row.taux_valeur),
    delai_moyen: safeNullableNumber(row.delai_moyen),
    delai_median: safeNullableNumber(row.delai_median),
    delai_pondere: safeNullableNumber(row.delai_pondere),
  }
}

function mapAxis(row: any): AxisRow {
  return {
    axe_type: safeText(row.axe_type, ''),
    axe: safeText(row.axe),
    nb_lignes_devis: safeNumber(row.nb_lignes_devis),
    ca_devis: safeNumber(row.ca_devis),
    ca_devis_avec_cdc: safeNumber(row.ca_devis_avec_cdc),
    ca_devis_avec_bl: safeNumber(row.ca_devis_avec_bl),
    ca_devis_avec_facture: safeNumber(row.ca_devis_avec_facture),
    taux_cdc_valeur: safeNullableNumber(row.taux_cdc_valeur),
    taux_bl_valeur: safeNullableNumber(row.taux_bl_valeur),
    taux_facture_valeur: safeNullableNumber(row.taux_facture_valeur),
    delai_facture_moyen: safeNullableNumber(row.delai_facture_moyen),
    delai_facture_median: safeNullableNumber(row.delai_facture_median),
    panier_moyen_devis: safeNumber(row.panier_moyen_devis),
    nb_devis_a_risque: safeNumber(row.nb_devis_a_risque),
  }
}

function mapTop(row: any): TopDevisRow {
  return {
    rang: safeNumber(row.rang),
    date_devis: normalizeBusinessDate(row.date_devis),
    numero_devis: safeText(row.numero_devis, ''),
    numero_tiers: safeText(row.numero_tiers, ''),
    intitule_tiers: safeText(row.intitule_tiers),
    agence_collaborateur: safeText(row.agence_collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    famille_macro_principale: safeText(row.famille_macro_principale),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis: safeNumber(row.ca_devis),
    quantite_devis: safeNumber(row.quantite_devis),
    statut_transformation: safeText(row.statut_transformation, 'Non transformé'),
    date_premiere_cdc: normalizeBusinessDate(row.date_premiere_cdc),
    date_premier_bl: normalizeBusinessDate(row.date_premier_bl),
    date_premiere_facture: normalizeBusinessDate(row.date_premiere_facture),
    delai_devis_facture: safeNullableNumber(row.delai_devis_facture),
  }
}

function mapRisk(row: any): RiskRow {
  return {
    priorite: safeText(row.priorite, 'Moyenne'),
    age_jours: safeNumber(row.age_jours),
    date_devis: normalizeBusinessDate(row.date_devis),
    numero_devis: safeText(row.numero_devis, ''),
    numero_tiers: safeText(row.numero_tiers, ''),
    intitule_tiers: safeText(row.intitule_tiers),
    agence_collaborateur: safeText(row.agence_collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    famille_macro_principale: safeText(row.famille_macro_principale),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis: safeNumber(row.ca_devis),
    quantite_devis: safeNumber(row.quantite_devis),
    derniere_designation: safeText(row.derniere_designation, ''),
  }
}

function mapAlert(row: any): AlertRow {
  return {
    type_alerte: safeText(row.type_alerte, 'Stable'),
    numero_tiers: safeText(row.numero_tiers, ''),
    intitule_tiers: safeText(row.intitule_tiers),
    agence_collaborateur: safeText(row.agence_collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    famille_macro_principale: safeText(row.famille_macro_principale),
    ca_devis_periode: safeNumber(row.ca_devis_periode),
    ca_devis_n1: safeNumber(row.ca_devis_n1),
    ecart_ca: safeNumber(row.ecart_ca),
    evolution_pct: safeNullableNumber(row.evolution_pct),
    nb_devis_periode: safeNumber(row.nb_devis_periode),
    nb_devis_n1: safeNumber(row.nb_devis_n1),
    dernier_devis: normalizeBusinessDate(row.dernier_devis),
  }
}

function statusBadgeClass(status: string) {
  return STATUS_COLORS[status] || 'bg-slate-100 text-slate-700 border-slate-200'
}

function alertBadgeClass(status: string) {
  return ALERT_COLORS[status] || 'bg-slate-100 text-slate-700 border-slate-200'
}

function priorityBadgeClass(priority: string) {
  return PRIORITY_COLORS[priority] || 'bg-slate-100 text-slate-700 border-slate-200'
}

function KpiCard({ title, value, subtitle, intent = 'neutral' }: { title: string; value: string; subtitle?: string; intent?: 'neutral' | 'good' | 'warning' | 'danger' }) {
  const classes = {
    neutral: 'border-slate-200 bg-white text-slate-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    warning: 'border-amber-200 bg-amber-50 text-amber-950',
    danger: 'border-red-200 bg-red-50 text-red-950',
  }

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${classes[intent]}`}>
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
      {subtitle && <div className="mt-1 text-xs font-bold text-slate-500">{subtitle}</div>}
    </div>
  )
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
      >
        <option value="">Tous</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function ProgressBar({ value }: { value: number | null | undefined }) {
  const width = Math.max(0, Math.min(100, safeNumber(value)))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-slate-900" style={{ width: `${width}%` }} />
    </div>
  )
}

export default function CycleDocumentsPage() {
  const period = useMemo(defaultPeriod, [])
  const [dateDebut, setDateDebut] = useState(period.start)
  const [dateFin, setDateFin] = useState(period.end)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  const [agence, setAgence] = useState('')
  const [collaborateur, setCollaborateur] = useState('')
  const [familleMacro, setFamilleMacro] = useState('')
  const [famille, setFamille] = useState('')
  const [client, setClient] = useState('')
  const [statut, setStatut] = useState<TransformationStatus>('Tous')
  const [includeHorsStat, setIncludeHorsStat] = useState(false)
  const [axis, setAxis] = useState<AxisType>('famille_macro')
  const [ageRisque, setAgeRisque] = useState(30)
  const [montantRisque, setMontantRisque] = useState(15000)
  const [seuilAlerte, setSeuilAlerte] = useState(50)
  const [topMonths, setTopMonths] = useState(3)

  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS)
  const [kpis, setKpis] = useState<KpiRow | null>(null)
  const [funnelRows, setFunnelRows] = useState<FunnelRow[]>([])
  const [axisRows, setAxisRows] = useState<AxisRow[]>([])
  const [topRows, setTopRows] = useState<TopDevisRow[]>([])
  const [riskRows, setRiskRows] = useState<RiskRow[]>([])
  const [alertRows, setAlertRows] = useState<AlertRow[]>([])

  const [loading, setLoading] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [rebuildLoading, setRebuildLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const topDateDebut = useMemo(() => addMonths(dateFin, -Math.max(1, topMonths)), [dateFin, topMonths])

  const commonParams = useMemo(() => ({
    p_date_debut: dateDebut,
    p_date_fin: dateFin,
    p_agence: agence || null,
    p_collaborateur: collaborateur || null,
    p_famille_macro: familleMacro || null,
    p_famille: famille || null,
    p_client: client || null,
    p_include_hors_stat: includeHorsStat,
  }), [dateDebut, dateFin, agence, collaborateur, familleMacro, famille, client, includeHorsStat])

  function updateYear(year: number) {
    setSelectedYear(year)
    setDateDebut(`${year}-01-01`)
    const now = new Date()
    const endMonth = year === now.getFullYear() ? now.getMonth() + 2 : 13
    const endDate = firstDayOfMonth(year, Math.min(12, endMonth - 1))
    const finalEnd = year === now.getFullYear() ? firstDayOfMonth(year, now.getMonth() + 1) : firstDayOfMonth(year + 1, 0)
    setDateFin(formatDateForInput(endMonth > 12 ? firstDayOfMonth(year + 1, 0) : finalEnd || endDate))
  }

  async function loadOptions() {
    setLoadingOptions(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('get_cycle_documents_filter_options', {
        p_date_debut: dateDebut,
        p_date_fin: dateFin,
        p_include_hors_stat: includeHorsStat,
      })
      if (rpcError) throw rpcError

      const payload = Array.isArray(data)
        ? ((data[0]?.get_cycle_documents_filter_options || data[0] || {}) as any)
        : ((data || {}) as any)

      setOptions({
        agences: uniqueSorted(payload.agences || []),
        collaborateurs: uniqueSorted(payload.collaborateurs || []),
        familles_macro: uniqueSorted(payload.familles_macro || []),
        familles: uniqueSorted(payload.familles || []),
        statuts: uniqueSorted(payload.statuts || EMPTY_OPTIONS.statuts),
      })
    } catch (exception: any) {
      setError(`Chargement des filtres impossible : ${exception?.message || exception}`)
      setOptions(EMPTY_OPTIONS)
    } finally {
      setLoadingOptions(false)
    }
  }

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [kpiResult, funnelResult, axisResult, topResult, riskResult, alertsResult] = await Promise.all([
        supabase.rpc('get_cycle_documents_kpis', {
          ...commonParams,
          p_age_risque_jours: ageRisque,
          p_montant_risque: montantRisque,
        }),
        supabase.rpc('get_cycle_documents_funnel', commonParams),
        supabase.rpc('get_cycle_documents_axes', {
          ...commonParams,
          p_axe: axis,
          p_age_risque_jours: ageRisque,
          p_montant_risque: montantRisque,
        }),
        supabase.rpc('get_cycle_documents_top_devis', {
          p_date_debut: topDateDebut,
          p_date_fin: dateFin,
          p_agence: agence || null,
          p_collaborateur: collaborateur || null,
          p_famille_macro: familleMacro || null,
          p_famille: famille || null,
          p_client: client || null,
          p_statut: statut === 'Tous' ? null : statut,
          p_include_hors_stat: includeHorsStat,
          p_montant_min: 0,
          p_limit: 30,
        }),
        supabase.rpc('get_cycle_documents_devis_a_risque', {
          ...commonParams,
          p_age_min_jours: ageRisque,
          p_montant_min: montantRisque,
          p_limit: 100,
        }),
        supabase.rpc('get_cycle_documents_alertes_clients', {
          p_date_debut: dateDebut,
          p_date_fin: dateFin,
          p_agence: agence || null,
          p_collaborateur: collaborateur || null,
          p_famille_macro: familleMacro || null,
          p_famille: famille || null,
          p_include_hors_stat: includeHorsStat,
          p_seuil_pct: seuilAlerte,
          p_montant_min: montantRisque,
          p_limit: 100,
        }),
      ])

      const rpcErrors = [kpiResult, funnelResult, axisResult, topResult, riskResult, alertsResult].map((result) => result.error).filter(Boolean)
      if (rpcErrors.length) throw rpcErrors[0]

      setKpis(mapKpi(firstRow<any>(kpiResult.data) || {}))
      setFunnelRows(asArray<any>(funnelResult.data).map(mapFunnel))
      setAxisRows(asArray<any>(axisResult.data).map(mapAxis))
      setTopRows(asArray<any>(topResult.data).map(mapTop))
      setRiskRows(asArray<any>(riskResult.data).map(mapRisk))
      setAlertRows(asArray<any>(alertsResult.data).map(mapAlert))
    } catch (exception: any) {
      setError(`Chargement de l'analyse impossible : ${exception?.message || exception}`)
      setKpis(null)
      setFunnelRows([])
      setAxisRows([])
      setTopRows([])
      setRiskRows([])
      setAlertRows([])
    } finally {
      setLoading(false)
    }
  }

  async function rebuildCycle() {
    if (rebuildLoading) return
    if (!window.confirm(`Rebuilder le cycle documents du ${formatDate(dateDebut)} au ${formatDate(dateFin)} avec un horizon de 180 jours ?`)) return

    setRebuildLoading(true)
    setMessage('Rebuild du cycle documents en cours…')
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('rebuild_indicateur_cycle_documents_periode', {
        p_date_debut: dateDebut,
        p_date_fin: dateFin,
        p_horizon_jours: 180,
      })
      if (rpcError) throw rpcError
      setMessage('Rebuild cycle documents terminé. Rechargement des données…')
      await loadOptions()
      await loadData()
      setMessage('Cycle documents à jour.')
    } catch (exception: any) {
      setError(`Rebuild impossible : ${exception?.message || exception}`)
      setMessage(null)
    } finally {
      setRebuildLoading(false)
    }
  }

  function resetFilters() {
    setAgence('')
    setCollaborateur('')
    setFamilleMacro('')
    setFamille('')
    setClient('')
    setStatut('Tous')
  }

  function exportExcel() {
    downloadWorkbook(`cycle_documents_${dateDebut}_${dateFin}.xlsx`, [
      {
        name: 'KPIs',
        rows: kpis ? [{
          'Nb lignes devis': kpis.nb_lignes_devis,
          'CA devis': kpis.ca_devis,
          'CA devis avec CDC': kpis.ca_devis_avec_cdc,
          'CA devis avec BL': kpis.ca_devis_avec_bl,
          'CA devis avec facture': kpis.ca_devis_avec_facture,
          'Taux CDC valeur': kpis.taux_cdc_valeur,
          'Taux BL valeur': kpis.taux_bl_valeur,
          'Taux facture valeur': kpis.taux_facture_valeur,
          'Taux facture nombre': kpis.taux_facture_nombre,
          'Délai moyen facture': kpis.delai_moyen_facture,
          'Délai médian facture': kpis.delai_median_facture,
          'Délai pondéré facture': kpis.delai_pondere_facture,
          'Nb devis à risque': kpis.nb_devis_a_risque,
          'CA devis à risque': kpis.ca_devis_a_risque,
        }] : [],
      },
      { name: 'Funnel', rows: funnelRows },
      { name: `Analyse ${axis}`, rows: axisRows },
      { name: 'Top devis', rows: topRows },
      { name: 'Devis à risque', rows: riskRows },
      { name: 'Alertes clients', rows: alertRows },
    ])
  }

  useEffect(() => {
    loadOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateDebut, dateFin, includeHorsStat])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateDebut, dateFin, agence, collaborateur, familleMacro, famille, client, statut, includeHorsStat, axis, ageRisque, montantRisque, seuilAlerte, topMonths])

  const maxAxisCa = useMemo(() => Math.max(...axisRows.map((row) => row.ca_devis), 1), [axisRows])
  const maxFunnelValue = useMemo(() => Math.max(...funnelRows.map((row) => row.ca_devis_reference), 1), [funnelRows])

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-2xl font-black">Cycle Devis → Facture</h1>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-500 shadow-sm">
              Analyse transformation · {formatDate(dateDebut)} → {formatDate(dateFin)}
            </span>
          </div>
          <p className="text-sm font-bold text-slate-500">
            Pilotage des transformations, délais, devis à risque, top devis et alertes clients par agence, collaborateur et famille.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={rebuildCycle}
            disabled={rebuildLoading}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {rebuildLoading ? 'Rebuild…' : 'Rebuild cycle'}
          </button>
          <button
            type="button"
            onClick={() => { loadOptions(); loadData() }}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-700"
          >
            Actualiser
          </button>
          <button
            type="button"
            onClick={exportExcel}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50"
          >
            Exporter Excel
          </button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{message}</div>}
      {(loading || loadingOptions) && <div className="mb-4 rounded-xl bg-white p-4 text-sm font-bold text-slate-600 shadow-sm">Chargement de l'analyse cycle documents…</div>}

      <section className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12">
          <label className="flex flex-col gap-1 md:col-span-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Année</span>
            <select
              value={selectedYear}
              onChange={(event) => updateYear(Number(event.target.value))}
              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black"
            >
              {defaultYearOptions().map((year) => <option key={year} value={year}>Année : {year}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Début</span>
            <input type="date" value={dateDebut} onChange={(event) => setDateDebut(event.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Fin exclue</span>
            <input type="date" value={dateFin} onChange={(event) => setDateFin(event.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black" />
          </label>
          <SelectFilter label="Agence" value={agence} options={options.agences} onChange={setAgence} />
          <SelectFilter label="Collaborateur" value={collaborateur} options={options.collaborateurs} onChange={setCollaborateur} />
          <SelectFilter label="Famille macro" value={familleMacro} options={options.familles_macro} onChange={setFamilleMacro} />
          <SelectFilter label="Famille" value={famille} options={options.familles} onChange={setFamille} />
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Client</span>
            <input value={client} onChange={(event) => setClient(event.target.value)} placeholder="Code ou nom client" className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Statut top devis</span>
            <select value={statut} onChange={(event) => setStatut(event.target.value as TransformationStatus)} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black">
              <option value="Tous">Tous</option>
              {options.statuts.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Axe</span>
            <select value={axis} onChange={(event) => setAxis(event.target.value as AxisType)} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black">
              {Object.entries(AXIS_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={includeHorsStat} onChange={(event) => setIncludeHorsStat(event.target.checked)} />
            Inclure les articles hors statistique
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            Âge risque
            <input type="number" min={1} value={ageRisque} onChange={(event) => setAgeRisque(Number(event.target.value || 30))} className="h-9 w-20 rounded-lg border border-slate-300 px-2 font-black" />
            jours
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            Montant risque
            <input type="number" min={0} step={1000} value={montantRisque} onChange={(event) => setMontantRisque(Number(event.target.value || 0))} className="h-9 w-28 rounded-lg border border-slate-300 px-2 font-black" />
            €
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            Seuil alerte
            <input type="number" min={0} step={5} value={seuilAlerte} onChange={(event) => setSeuilAlerte(Number(event.target.value || 50))} className="h-9 w-20 rounded-lg border border-slate-300 px-2 font-black" />
            %
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            Top devis
            <select value={topMonths} onChange={(event) => setTopMonths(Number(event.target.value))} className="h-9 rounded-lg border border-slate-300 px-2 font-black">
              <option value={1}>1 mois</option>
              <option value={2}>2 mois</option>
              <option value={3}>3 mois</option>
            </select>
          </label>
          <button type="button" onClick={resetFilters} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black hover:bg-slate-50">
            Réinitialiser les filtres
          </button>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="CA devis" value={formatCurrency(kpis?.ca_devis, true)} subtitle={`${formatNumber(kpis?.nb_lignes_devis)} lignes devis`} />
        <KpiCard title="Taux devis → CDC" value={formatPercent(kpis?.taux_cdc_valeur)} subtitle={formatCurrency(kpis?.ca_devis_avec_cdc, true)} />
        <KpiCard title="Taux devis → BL" value={formatPercent(kpis?.taux_bl_valeur)} subtitle={formatCurrency(kpis?.ca_devis_avec_bl, true)} />
        <KpiCard title="Taux devis → facture" value={formatPercent(kpis?.taux_facture_valeur)} subtitle={`${formatPercent(kpis?.taux_facture_nombre)} en nombre`} intent="good" />
        <KpiCard title="Délai facture" value={formatDays(kpis?.delai_pondere_facture)} subtitle={`Moy. ${formatDays(kpis?.delai_moyen_facture)} · méd. ${formatDays(kpis?.delai_median_facture)}`} />
        <KpiCard title="Devis à risque" value={formatNumber(kpis?.nb_devis_a_risque)} subtitle={formatCurrency(kpis?.ca_devis_a_risque, true)} intent={safeNumber(kpis?.nb_devis_a_risque) ? 'warning' : 'neutral'} />
      </section>

      <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 xl:col-span-2">
          <h2 className="text-xl font-black">Funnel Devis → CDC → BL → Facture</h2>
          <p className="mb-4 text-xs font-bold uppercase text-slate-500">Taux calculés sur le CA des devis de la période.</p>
          <div className="space-y-3">
            {funnelRows.map((row) => (
              <div key={row.etape} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black">{row.ordre}. {row.etape}</div>
                    <div className="text-xs font-bold text-slate-500">{formatNumber(row.nb_lignes)} lignes · {formatCurrency(row.ca_devis_reference, true)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black">{formatPercent(row.taux_valeur)}</div>
                    <div className="text-xs font-bold text-slate-500">{formatPercent(row.taux_nombre)} en nombre</div>
                  </div>
                </div>
                <ProgressBar value={row.taux_valeur} />
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-bold text-slate-500">
                  <div>Moy. {formatDays(row.delai_moyen)}</div>
                  <div>Méd. {formatDays(row.delai_median)}</div>
                  <div>Pond. {formatDays(row.delai_pondere)}</div>
                </div>
              </div>
            ))}
            {!funnelRows.length && <div className="rounded-xl bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">Aucune donnée funnel.</div>}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 xl:col-span-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Analyse par {AXIS_LABELS[axis].toLowerCase()}</h2>
              <p className="text-xs font-bold uppercase text-slate-500">Tri par CA devis décroissant. Les taux sont en valeur.</p>
            </div>
          </div>
          <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">{AXIS_LABELS[axis]}</th>
                  <th className="px-3 py-2 text-right">CA devis</th>
                  <th className="px-3 py-2 text-right">Tx CDC</th>
                  <th className="px-3 py-2 text-right">Tx BL</th>
                  <th className="px-3 py-2 text-right">Tx facture</th>
                  <th className="px-3 py-2 text-right">Délai facture</th>
                  <th className="px-3 py-2 text-right">Risque</th>
                </tr>
              </thead>
              <tbody>
                {axisRows.map((row) => (
                  <tr key={row.axe} className="border-b border-slate-100 odd:bg-slate-50">
                    <td className="px-3 py-2 font-black">
                      <div className="max-w-[260px] truncate">{row.axe}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.max(3, Math.min(100, (row.ca_devis / maxAxisCa) * 100))}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-black">{formatCurrency(row.ca_devis, true)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatPercent(row.taux_cdc_valeur)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatPercent(row.taux_bl_valeur)}</td>
                    <td className="px-3 py-2 text-right font-black text-emerald-700">{formatPercent(row.taux_facture_valeur)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatDays(row.delai_facture_moyen)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatNumber(row.nb_devis_a_risque)}</td>
                  </tr>
                ))}
                {!axisRows.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucune donnée par axe.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-black">Top 30 devis récents</h2>
          <p className="mb-3 text-xs font-bold uppercase text-slate-500">Période top : {formatDate(topDateDebut)} → {formatDate(dateFin)}.</p>
          <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  <th className="px-3 py-2 text-right">#</th>
                  <th className="px-3 py-2 text-left">Devis</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Agence</th>
                  <th className="px-3 py-2 text-right">CA devis</th>
                  <th className="px-3 py-2 text-center">Statut</th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((row) => (
                  <tr key={`${row.rang}-${row.numero_devis}-${row.numero_tiers}`} className="border-b border-slate-100 odd:bg-slate-50">
                    <td className="px-3 py-2 text-right font-black">{row.rang}</td>
                    <td className="px-3 py-2 font-bold">
                      <div>{row.numero_devis || '—'}</div>
                      <div className="text-xs text-slate-500">{formatDate(row.date_devis)}</div>
                    </td>
                    <td className="px-3 py-2 font-bold">
                      <div className="max-w-[260px] truncate">{row.intitule_tiers}</div>
                      <div className="text-xs text-slate-500">{row.numero_tiers} · {row.famille_macro_principale}</div>
                    </td>
                    <td className="px-3 py-2 font-bold">{row.agence_collaborateur}</td>
                    <td className="px-3 py-2 text-right font-black">{formatCurrency(row.ca_devis, true)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${statusBadgeClass(row.statut_transformation)}`}>{row.statut_transformation}</span>
                    </td>
                  </tr>
                ))}
                {!topRows.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucun devis récent.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-black">Devis à risque</h2>
          <p className="mb-3 text-xs font-bold uppercase text-slate-500">Devis sans CDC, sans BL et sans facture · âge ≥ {ageRisque} jours · montant ≥ {formatCurrency(montantRisque)}.</p>
          <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Priorité</th>
                  <th className="px-3 py-2 text-left">Devis</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-right">Âge</th>
                  <th className="px-3 py-2 text-right">CA devis</th>
                </tr>
              </thead>
              <tbody>
                {riskRows.map((row) => (
                  <tr key={`${row.numero_devis}-${row.numero_tiers}`} className="border-b border-slate-100 odd:bg-slate-50">
                    <td className="px-3 py-2"><span className={`rounded-full border px-2 py-1 text-[11px] font-black ${priorityBadgeClass(row.priorite)}`}>{row.priorite}</span></td>
                    <td className="px-3 py-2 font-bold">
                      <div>{row.numero_devis || '—'}</div>
                      <div className="text-xs text-slate-500">{formatDate(row.date_devis)}</div>
                    </td>
                    <td className="px-3 py-2 font-bold">
                      <div className="max-w-[320px] truncate">{row.intitule_tiers}</div>
                      <div className="text-xs text-slate-500">{row.agence_collaborateur} · {row.famille_macro_principale}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-black">{formatNumber(row.age_jours)} j</td>
                    <td className="px-3 py-2 text-right font-black">{formatCurrency(row.ca_devis, true)}</td>
                  </tr>
                ))}
                {!riskRows.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucun devis à risque avec ces paramètres.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-xl font-black">Alertes comportement clients</h2>
        <p className="mb-3 text-xs font-bold uppercase text-slate-500">Comparaison période sélectionnée vs même période N-1 · seuil {seuilAlerte}% · montant minimum {formatCurrency(montantRisque)}.</p>
        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="px-3 py-2 text-left">Alerte</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Agence</th>
                <th className="px-3 py-2 text-right">CA période</th>
                <th className="px-3 py-2 text-right">CA N-1</th>
                <th className="px-3 py-2 text-right">Écart</th>
                <th className="px-3 py-2 text-right">Évol.</th>
                <th className="px-3 py-2 text-right">Dernier devis</th>
              </tr>
            </thead>
            <tbody>
              {alertRows.map((row) => (
                <tr key={`${row.type_alerte}-${row.numero_tiers}`} className="border-b border-slate-100 odd:bg-slate-50">
                  <td className="px-3 py-2"><span className={`rounded-full border px-2 py-1 text-[11px] font-black ${alertBadgeClass(row.type_alerte)}`}>{row.type_alerte}</span></td>
                  <td className="px-3 py-2 font-bold">
                    <div className="max-w-[320px] truncate">{row.intitule_tiers}</div>
                    <div className="text-xs text-slate-500">{row.numero_tiers} · {row.famille_macro_principale}</div>
                  </td>
                  <td className="px-3 py-2 font-bold">{row.agence_collaborateur}</td>
                  <td className="px-3 py-2 text-right font-black">{formatCurrency(row.ca_devis_periode, true)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-600">{formatCurrency(row.ca_devis_n1, true)}</td>
                  <td className={`px-3 py-2 text-right font-black ${row.ecart_ca < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatCurrency(row.ecart_ca, true)}</td>
                  <td className={`px-3 py-2 text-right font-black ${safeNumber(row.evolution_pct) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{row.evolution_pct === null ? 'Nouveau' : formatPercent(row.evolution_pct)}</td>
                  <td className="px-3 py-2 text-right font-bold">{formatDateShort(row.dernier_devis)}</td>
                </tr>
              ))}
              {!alertRows.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-sm font-bold text-slate-500">Aucune alerte client avec ces paramètres.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
