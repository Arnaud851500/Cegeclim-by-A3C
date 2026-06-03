'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
// @ts-ignore - xlsx-js-style est utilisé pour conserver les styles Excel côté export.
import * as XLSX from 'xlsx-js-style'

type DataSource = 'factures' | 'activite' | 'devis' | 'flux_articles' | 'mixte'
type WidgetType = 'kpi' | 'histogramme' | 'histogramme_empile' | 'courbe' | 'bridge' | 'double_bridge' | 'tableau' | 'camembert' | 'synthese'
type MeasureKey =
  | 'ca_ht'
  | 'marge_valeur'
  | 'marge_pct'
  | 'quantite'
  | 'nb_lignes'
  | 'population_departement'
  | 'superficie_departement'
  | 'ca_par_population'
  | 'ca_par_superficie'
type DimensionKey =
  | 'annee'
  | 'mois'
  | 'type_document'
  | 'agence_collaborateur'
  | 'depot'
  | 'collaborateur'
  | 'collaborateur_facture'
  | 'collaborateur_tiers'
  | 'departement_tiers'
  | 'famille_macro'
  | 'famille'
  | 'reference_article'
  | 'designation'
  | 'intitule_tiers'
  | 'numero_tiers'
  | 'source'

type SizeKey = 'small' | 'medium' | 'large' | 'full'
type SortMode = 'label_asc' | 'value_desc' | 'value_asc'
type EvolutionMode = 'none' | 'value' | 'percent' | 'both'
type CompareMode = 'year' | 'month' | 'dimension'
type PeriodMode = 'mois' | 'cumul'
type ClientFilterMode = 'include' | 'exclude'

type StudioRow = {
  source: Exclude<DataSource, 'mixte'>
  annee: number
  mois: number
  type_document: string
  collaborateur: string // compatibilité vues existantes : correspond au collaborateur facture
  collaborateur_facture: string
  collaborateur_tiers: string
  agence_collaborateur: string
  depot: string
  departement_tiers: string
  population_departement: number
  superficie_departement: number
  numero_tiers: string
  intitule_tiers: string
  famille: string
  famille_macro: string
  reference_article: string
  designation: string
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
  depots: string[]
  collaborateurs: string[] // compatibilité anciennes vues : collaborateur facture
  collaborateursFacture: string[]
  collaborateursTiers: string[]
  departementsTiers: string[]
  famillesMacro: string[]
  typesDocument: string[]
  clientMode: ClientFilterMode
  clients: string[]
  horsStatistique: 'non' | 'oui' | 'tous'
}

type WidgetFilters = Partial<{
  years: number[]
  months: number[]
  agences: string[]
  depots: string[]
  collaborateurs: string[] // compatibilité anciennes vues : collaborateur facture
  collaborateursFacture: string[]
  collaborateursTiers: string[]
  departementsTiers: string[]
  famillesMacro: string[]
  typesDocument: string[]
  clientMode: ClientFilterMode
  clients: string[]
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

type AiWidgetProposal = Partial<WidgetConfig> & {
  rationale?: string
  confidence?: string | number
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
  population_departement: number
  superficie_departement: number
  __territoires: Record<string, { population: number; superficie: number }>
}

type ChartDatum = {
  label: string
  __total: number
  value: number
  [key: string]: string | number | undefined
}

const FACTURES_TABLE = 'indicateur_factures_mensuel'
const ACTIVITE_TABLE = 'indicateur_activite_mensuel'
const DEVIS_TABLE = 'indicateur_devis_mensuel'
const FLUX_ARTICLES_TABLE = 'indicateur_flux_articles_mensuel'
const VIEW_TABLE = 'analyse_widget_views'

const ATELIER_COMMON_SELECT = [
  'id',
  'annee',
  'mois',
  'collaborateur',
  'collaborateur_facture',
  'collaborateur_tiers',
  'agence_collaborateur',
  'depot',
  'departement_tiers',
  'population_departement',
  'superficie_departement',
  'numero_tiers',
  'intitule_tiers',
  'famille',
  'famille_macro',
  'hors_statistique',
  'nb_lignes',
  'quantite',
  'quantite_pertinente',
  'ca_ht',
  'marge_valeur',
  'updated_at',
]

const ATELIER_FLUX_ARTICLES_SELECT = [
  'id',
  'annee',
  'mois',
  'flux',
  'type_document',
  'depot',
  'collaborateur_tiers',
  'famille_macro',
  'famille',
  'reference_article',
  'designation',
  'hors_statistique',
  'nb_lignes',
  'quantite',
  'quantite_pertinente',
  'ca_ht',
  'marge_valeur',
  'updated_at',
]

const ATELIER_SELECT_BY_SOURCE: Record<Exclude<DataSource, 'mixte'>, string> = {
  factures: ATELIER_COMMON_SELECT.join(','),
  activite: [...ATELIER_COMMON_SELECT, 'type_document'].join(','),
  devis: ATELIER_COMMON_SELECT.join(','),
  flux_articles: ATELIER_FLUX_ARTICLES_SELECT.join(','),
}
const ATELIER_FRONT_VERSION = 'V2026-06-03-FLUX-ARTICLES-ATELIER-03-LOAD-CIBLE'
const ATELIER_AI_VERSION = 'STEP-3-WIDGET-BUILDER-02'

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1

const COLOR_N = '#16a34a'
const COLOR_N1 = '#eab308'
const COLOR_N2 = '#f97316'
const COLOR_N3 = '#64748b'
const COLOR_N_LIGHT = '#86efac'
const COLOR_N1_LIGHT = '#fef08a'
const COLOR_N2_LIGHT = '#fed7aa'
const COLOR_N3_LIGHT = '#cbd5e1'
const COLOR_BLUE = '#2563eb'
const COLOR_RED = '#ef4444'
const COLOR_POSITIVE = '#22c55e'
const COLOR_NEGATIVE = '#ef4444'
const COLOR_TOTAL = '#0f172a'

const DOCUMENT_TYPES_BY_SOURCE: Record<DataSource, string[]> = {
  factures: ['FACTURE'],
  activite: ['BL', 'BL M-x', 'BR', 'CDC', 'PL'],
  devis: ['DEVIS'],
  flux_articles: ['DEVIS', 'CDC', 'BL', 'FACTURE'],
  mixte: ['FACTURE', 'BL', 'BL M-x', 'BR', 'CDC', 'PL'],
}
const COLOR_BRIDGE_TOTAL = '#bfdbfe'
const COLOR_BRIDGE_INTERMEDIATE = '#cbd5e1'
const COLOR_MIX = '#f59e0b'
const COLOR_PERF = '#8b5cf6'
const PALETTE = ['#2563eb', '#64748b', '#f59e0b', '#16a34a', '#9333ea', '#ef4444', '#0ea5e9', '#84cc16']

const MEASURES: Array<{ key: MeasureKey; label: string; kind: 'currency' | 'percent' | 'number' }> = [
  { key: 'ca_ht', label: 'CA HT', kind: 'currency' },
  { key: 'marge_valeur', label: 'Marge €', kind: 'currency' },
  { key: 'marge_pct', label: 'Marge %', kind: 'percent' },
  { key: 'quantite', label: 'Quantité', kind: 'number' },
  { key: 'nb_lignes', label: 'Nb lignes', kind: 'number' },
  { key: 'population_departement', label: 'Population dépt.', kind: 'number' },
  { key: 'superficie_departement', label: 'Superficie dépt. km²', kind: 'number' },
  { key: 'ca_par_population', label: 'CA / habitant', kind: 'currency' },
  { key: 'ca_par_superficie', label: 'CA / km²', kind: 'currency' },
]

const DIMENSIONS: Array<{ key: DimensionKey; label: string }> = [
  { key: 'annee', label: 'Année' },
  { key: 'mois', label: 'Mois' },
  { key: 'source', label: 'Source' },
  { key: 'type_document', label: 'Type document' },
  { key: 'agence_collaborateur', label: 'Agence' },
  { key: 'depot', label: 'Dépôt' },
  { key: 'collaborateur_facture', label: 'Collaborateur facture' },
  { key: 'collaborateur_tiers', label: 'Collaborateur tiers' },
  { key: 'collaborateur', label: 'Collaborateur (historique)' },
  { key: 'departement_tiers', label: 'Département tiers' },
  { key: 'famille_macro', label: 'Famille macro' },
  { key: 'famille', label: 'Famille' },
  { key: 'reference_article', label: 'Référence article' },
  { key: 'designation', label: 'Désignation' },
  { key: 'intitule_tiers', label: 'Tiers' },
  { key: 'numero_tiers', label: 'Code tiers' },
]

const DEFAULT_FILTERS: GlobalFilters = {
  sources: ['factures'],
  years: [],
  months: [],
  agences: [],
  depots: [],
  collaborateurs: [],
  collaborateursFacture: [],
  collaborateursTiers: [],
  departementsTiers: [],
  famillesMacro: [],
  typesDocument: [],
  clientMode: 'include',
  clients: [],
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

function formatKCurrency(value: number) {
  return `${formatNumber(Math.round((value || 0) / 1000))} K€`
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

function sourceLabel(source: DataSource) {
  if (source === 'mixte') return 'Mixte'
  if (source === 'factures') return 'Factures'
  if (source === 'activite') return 'Activité'
  if (source === 'devis') return 'Devis'
  if (source === 'flux_articles') return 'Flux articles'
  return String(source)
}

function normalizeAggRow(row: Record<string, any>, source: Exclude<DataSource, 'mixte'>): StudioRow {
  const annee = safeNumber(row.annee || row.year || row.exercice)
  const mois = safeNumber(row.mois || row.month)
  return {
    source,
    annee,
    mois,
    type_document: source === 'factures' ? 'FACTURE' : source === 'devis' ? 'DEVIS' : source === 'flux_articles' ? safeText(row.type_document || row.flux, 'NON RENSEIGNE') : safeText(row.type_document, 'NON RENSEIGNE'),
    collaborateur: safeText(row.collaborateur_facture || row.collaborateur, 'NON AFFECTE'),
    collaborateur_facture: safeText(row.collaborateur_facture || row.collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    agence_collaborateur: safeText(row.agence_collaborateur || row.agence, 'NON AFFECTE'),
    depot: safeText(row.depot, 'NON RENSEIGNE'),
    departement_tiers: safeText(row.departement_tiers, 'NON RENSEIGNE'),
    population_departement: safeNumber(row.population_departement || row.population || row.population_territoire),
    superficie_departement: safeNumber(row.superficie_departement || row.superficie || row.superficie_km2),
    numero_tiers: safeText(row.numero_tiers || row.code_tiers, 'NON RENSEIGNE'),
    intitule_tiers: safeText(row.intitule_tiers || row.tiers, 'NON RENSEIGNE'),
    famille: safeText(row.famille, 'NON RENSEIGNE'),
    famille_macro: safeText(row.famille_macro, 'NON RENSEIGNE'),
    reference_article: safeText(row.reference_article, 'NON RENSEIGNE'),
    designation: safeText(row.designation, 'NON RENSEIGNE'),
    hors_statistique: safeBool(row.hors_statistique),
    nb_lignes: safeNumber(row.nb_lignes),
    quantite: safeNumber(row.quantite_pertinente ?? row.quantite),
    ca_ht: safeNumber(row.ca_ht),
    marge_valeur: safeNumber(row.marge_valeur),
  }
}

function sourcesForAtelierLoad(sources: DataSource[], extraSources: DataSource[] = []) {
  const baseSources = sources.length ? sources : (['factures', 'activite'] as DataSource[])
  const selected = [...baseSources, ...extraSources]
  const output = new Set<Exclude<DataSource, 'mixte'>>()

  selected.forEach((source) => {
    if (source === 'mixte') {
      output.add('factures')
      output.add('activite')
    } else {
      output.add(source)
    }
  })

  return Array.from(output)
}

function yearsForAtelierLoad(years: number[]) {
  if (years.length) return years
  return [CURRENT_YEAR, CURRENT_YEAR - 1]
}

function shouldLoadHorsStat(mode: GlobalFilters['horsStatistique']) {
  if (mode === 'non') return false
  if (mode === 'oui') return true
  return null
}

function normalizeDocumentTypes(values: string[] = []) {
  return uniqueSorted(values.map((value) => safeText(value, '').toUpperCase()).filter(Boolean))
}

function sourceMatchesGlobalSelection(source: Exclude<DataSource, 'mixte'>, selectedSources: DataSource[]) {
  if (!selectedSources.length) return source === 'factures' || source === 'activite'
  if (selectedSources.includes(source)) return true
  if (selectedSources.includes('mixte')) return source === 'factures' || source === 'activite'
  return false
}

function documentTypesForSourceLoad(
  source: Exclude<DataSource, 'mixte'>,
  filters: GlobalFilters,
  widgets: WidgetConfig[]
): string[] | null {
  if (source === 'factures') return null
  if (source === 'devis') return null

  const set = new Set<string>()

  const add = (values?: string[]) => {
    normalizeDocumentTypes(values || []).forEach((value) => set.add(value))
  }

  // Si la source est explicitement dans le filtre global, on respecte le filtre document global s'il existe.
  // S'il n'existe pas, on ne restreint pas la source pour éviter de masquer des données attendues.
  if (sourceMatchesGlobalSelection(source, filters.sources)) {
    if (filters.typesDocument.length) add(filters.typesDocument)
    else return null
  }

  // Les widgets qui demandent flux_articles ou activité ne doivent charger que les documents qu'ils utilisent.
  widgets.forEach((widget) => {
    const widgetUsesSource =
      widget.source === source ||
      (widget.source === 'mixte' && source === 'activite')

    if (!widgetUsesSource) return

    if (widget.localFilters?.typesDocument?.length) add(widget.localFilters.typesDocument)
    else if (widget.useGlobalFilters && filters.typesDocument.length) add(filters.typesDocument)
    else {
      // Aucun filtre document sur ce widget : on ne peut pas restreindre sans changer son résultat.
      DOCUMENT_TYPES_BY_SOURCE[widget.source].forEach((value) => set.add(value))
    }
  })

  return set.size ? Array.from(set) : null
}

async function fetchAllRows(
  tableName: string,
  source: Exclude<DataSource, 'mixte'>,
  chunkSize = 2500,
  yearsToLoad: number[] = [CURRENT_YEAR, CURRENT_YEAR - 1],
  horsStatMode: GlobalFilters['horsStatistique'] = 'non',
  documentTypes: string[] | null = null
) {
  const rows: StudioRow[] = []
  let from = 0
  const horsStatFilter = shouldLoadHorsStat(horsStatMode)
  const normalizedTypes = normalizeDocumentTypes(documentTypes || [])

  while (true) {
    const to = from + chunkSize - 1
    let query = supabase
      .from(tableName)
      .select(ATELIER_SELECT_BY_SOURCE[source])
      .in('annee', yearsToLoad)
      .order('annee', { ascending: false })
      .order('mois', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)

    if (horsStatFilter !== null) {
      query = query.eq('hors_statistique', horsStatFilter)
    }

    if (normalizedTypes.length && (source === 'activite' || source === 'flux_articles')) {
      query = query.in('type_document', normalizedTypes)
    }

    const { data, error } = await query
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
  if (dimension === 'source') return sourceLabel(row.source)
  return safeText((row as any)[dimension], 'NON RENSEIGNE')
}

function getCompositeDimensionValue(row: StudioRow, dim1: DimensionKey, dim2?: DimensionKey | ''): string {
  const first = getDimensionValue(row, dim1)
  if (!dim2) return first
  const second = getDimensionValue(row, dim2)
  return `${first} › ${second}`
}

function clientKey(row: StudioRow) {
  const numero = safeText(row.numero_tiers, 'NC')
  const nom = safeText(row.intitule_tiers, 'NON RENSEIGNE')
  return `${numero} — ${nom}`
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
  return {
    ca_ht: 0,
    marge_valeur: 0,
    quantite: 0,
    nb_lignes: 0,
    population_departement: 0,
    superficie_departement: 0,
    __territoires: {},
  }
}

function recomputeTerritoireTotals(target: AggregatedValue) {
  const territoires = Object.values(target.__territoires || {})
  target.population_departement = territoires.reduce((sum, item) => sum + safeNumber(item.population), 0)
  target.superficie_departement = territoires.reduce((sum, item) => sum + safeNumber(item.superficie), 0)
}

function mergeAgg(target: AggregatedValue, source: AggregatedValue) {
  target.ca_ht += source.ca_ht
  target.marge_valeur += source.marge_valeur
  target.quantite += source.quantite
  target.nb_lignes += source.nb_lignes

  Object.entries(source.__territoires || {}).forEach(([departement, territoire]) => {
    if (!departement || departement === 'NON RENSEIGNE') return
    target.__territoires[departement] = {
      population: safeNumber(territoire.population),
      superficie: safeNumber(territoire.superficie),
    }
  })

  recomputeTerritoireTotals(target)
}

function addToAgg(target: AggregatedValue, row: StudioRow) {
  target.ca_ht += row.ca_ht
  target.marge_valeur += row.marge_valeur
  target.quantite += row.quantite
  target.nb_lignes += row.nb_lignes

  // Les données territoire sont portées par les lignes agrégées mais ne doivent pas être additionnées plusieurs fois
  // quand un même département est présent sur plusieurs familles, clients ou types de document.
  const departement = safeText(row.departement_tiers, '')
  if (departement && departement !== 'NON RENSEIGNE') {
    target.__territoires[departement] = {
      population: safeNumber(row.population_departement),
      superficie: safeNumber(row.superficie_departement),
    }
    recomputeTerritoireTotals(target)
  }
}

function measureValue(agg: AggregatedValue, measure: MeasureKey) {
  if (measure === 'marge_pct') return agg.ca_ht ? (agg.marge_valeur / agg.ca_ht) * 100 : 0
  if (measure === 'ca_par_population') return agg.population_departement ? agg.ca_ht / agg.population_departement : 0
  if (measure === 'ca_par_superficie') return agg.superficie_departement ? agg.ca_ht / agg.superficie_departement : 0
  return agg[measure]
}

function applyGlobalFilters(rows: StudioRow[], filters: GlobalFilters) {
  return rows.filter((row) => {
    if (filters.sources.length) {
      const wantedSources = sourcesForAtelierLoad(filters.sources)
      if (!wantedSources.includes(row.source)) return false
    }
    if (filters.years.length && !filters.years.includes(row.annee)) return false
    if (filters.months.length && !filters.months.includes(row.mois)) return false
    if (filters.agences.length && !filters.agences.includes(row.agence_collaborateur)) return false
    if ((filters.depots || []).length && !filters.depots.includes(row.depot)) return false
    if (filters.collaborateurs.length && !filters.collaborateurs.includes(row.collaborateur_facture || row.collaborateur)) return false
    if ((filters.collaborateursFacture || []).length && !filters.collaborateursFacture.includes(row.collaborateur_facture)) return false
    if ((filters.collaborateursTiers || []).length && !filters.collaborateursTiers.includes(row.collaborateur_tiers)) return false
    if ((filters.departementsTiers || []).length && !filters.departementsTiers.includes(row.departement_tiers)) return false
    if (filters.famillesMacro.length && !filters.famillesMacro.includes(row.famille_macro)) return false
    if (filters.typesDocument.length && !filters.typesDocument.includes(row.type_document)) return false
    if (filters.clients?.length) {
      const selected = filters.clients.includes(clientKey(row))
      if (filters.clientMode === 'exclude' ? selected : !selected) return false
    }
    if (filters.horsStatistique === 'non' && row.hors_statistique) return false
    if (filters.horsStatistique === 'oui' && !row.hors_statistique) return false
    return true
  })
}

function applyWidgetFilters(rows: StudioRow[], widget: WidgetConfig, globalFilters: GlobalFilters) {
  let filtered = rows
  if (widget.useGlobalFilters) filtered = applyGlobalFilters(filtered, globalFilters)

  filtered = filtered.filter((row) => {
    if (widget.source === 'mixte') {
      if (row.source === 'devis' || row.source === 'flux_articles') return false
    } else if (row.source !== widget.source) {
      return false
    }
    const lf = widget.localFilters
    if (lf.years?.length && !lf.years.includes(row.annee)) return false
    if (lf.months?.length && !lf.months.includes(row.mois)) return false
    if (lf.agences?.length && !lf.agences.includes(row.agence_collaborateur)) return false
    if (lf.depots?.length && !lf.depots.includes(row.depot)) return false
    if (lf.collaborateurs?.length && !lf.collaborateurs.includes(row.collaborateur_facture || row.collaborateur)) return false
    if (lf.collaborateursFacture?.length && !lf.collaborateursFacture.includes(row.collaborateur_facture)) return false
    if (lf.collaborateursTiers?.length && !lf.collaborateursTiers.includes(row.collaborateur_tiers)) return false
    if (lf.departementsTiers?.length && !lf.departementsTiers.includes(row.departement_tiers)) return false
    if (lf.famillesMacro?.length && !lf.famillesMacro.includes(row.famille_macro)) return false
    if (lf.typesDocument?.length && !lf.typesDocument.includes(row.type_document)) return false
    if (lf.clients?.length) {
      const selected = lf.clients.includes(clientKey(row))
      if ((lf.clientMode || 'include') === 'exclude' ? selected : !selected) return false
    }
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
    title: type === 'bridge' ? 'Bridge CA N-1 ⇒ N par agence' : type === 'double_bridge' ? 'Double bridge mix / performance' : type === 'synthese' ? 'Suivi du CA et marge' : type === 'tableau' ? 'Tableau croisé' : type === 'kpi' ? 'Indicateur clé' : type === 'histogramme_empile' ? 'Histogramme empilé' : type === 'camembert' ? 'Répartition' : 'Nouveau graphique',
    source: 'factures',
    size: type === 'double_bridge' ? 'full' : type === 'kpi' || type === 'histogramme_empile' ? 'small' : type === 'tableau' || type === 'synthese' ? 'full' : type === 'camembert' ? 'medium' : 'medium',
    useGlobalFilters: true,
    localFilters: {},
    measure: type === 'double_bridge' ? 'marge_pct' : type === 'bridge' ? 'ca_ht' : 'ca_ht',
    secondMeasure: 'ca_ht',
    tableMeasures: ['ca_ht', 'marge_valeur'],
    dimension: type === 'bridge' || type === 'double_bridge' ? 'famille_macro' : 'mois',
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
  if (type === 'courbe') { base.title = 'Flux Devis / CDC / BL / Factures'; base.source = 'mixte'; base.dimension = 'mois'; base.seriesDimension = 'type_document'; base.periodMode = 'mois' }
  if (type === 'histogramme') base.title = 'Histogramme CA par mois'
  if (type === 'histogramme_empile') { base.title = 'CA empilé par année / famille'; base.dimension = 'annee'; base.seriesDimension = 'famille_macro' }
  if (type === 'camembert') { base.title = 'Répartition par famille macro'; base.dimension = 'famille_macro'; base.seriesDimension = '' }
  if (type === 'double_bridge') { base.title = 'Double bridge marge % mix / performance'; base.dimension = 'famille_macro'; base.periodMode = 'cumul'; base.compareMode = 'year'; base.topN = 10; base.showValues = true }
  if (type === 'synthese') { base.title = 'Suivi du CA et marge'; base.measure = 'ca_ht'; base.secondMeasure = 'marge_pct'; base.tableMeasures = ['ca_ht', 'marge_pct']; base.periodMode = 'cumul'; base.size = 'full' }
  return base
}

function relevantDocumentTypes(source: DataSource, allTypes: string[]) {
  const sourceDefaults = DOCUMENT_TYPES_BY_SOURCE[source] || []
  const sorted = uniqueSorted([...sourceDefaults, ...allTypes])
  if (source === 'factures') return sorted.filter((type) => type === 'FACTURE' || type.toUpperCase().includes('FACTURE'))
  if (source === 'devis') return sorted.filter((type) => type === 'DEVIS' || type.toUpperCase().includes('DEVIS'))
  if (source === 'flux_articles') return uniqueSorted([...sourceDefaults, ...sorted.filter((type) => ['DEVIS', 'CDC', 'BL', 'FACTURE'].includes(type.toUpperCase()))])
  if (source === 'activite') return sorted.filter((type) => !['FACTURE', 'DEVIS'].includes(type.toUpperCase()) && !type.toUpperCase().includes('FACTURE') && !type.toUpperCase().includes('DEVIS'))
  return sorted
}

function getChartSeriesLabel(row: StudioRow, widget: WidgetConfig, seriesKey: string) {
  if (!seriesKey) return getMeasureLabel(widget.measure)
  const base = getDimensionValue(row, seriesKey as DimensionKey)

  // Règle métier : quand on suit des années, les types de documents sélectionnés
  // s'additionnent dans l'année. On ne crée donc pas une série par type document.
  // En vision mensuelle mixte, on distingue seulement Factures / Activité pour
  // pouvoir empiler l'activité avec une couleur plus claire dans la barre de l'année.
  const splitMixedSourceForMonthlyBars =
    widget.source === 'mixte' &&
    seriesKey === 'annee' &&
    widget.periodMode === 'mois' &&
    (widget.type === 'histogramme' || widget.type === 'histogramme_empile')

  if (splitMixedSourceForMonthlyBars) {
    return `${base} · ${sourceLabel(row.source)}`
  }

  return base
}

function extractYearFromSeries(series: string) {
  const match = String(series).match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

function sourceRankFromSeries(series: string) {
  if (String(series).includes('Devis')) return 0
  if (String(series).includes('CDC')) return 1
  if (String(series).includes('BL')) return 2
  if (String(series).includes('Factures')) return 3
  if (String(series).includes('Activité')) return 4
  if (String(series).includes('Flux articles')) return 5
  return 0
}

function yearRankColor(year: number, referenceYear: number, lighter = false) {
  const rank = referenceYear - year
  const dark = [COLOR_N, COLOR_N1, COLOR_N2, COLOR_N3]
  const light = [COLOR_N_LIGHT, COLOR_N1_LIGHT, COLOR_N2_LIGHT, COLOR_N3_LIGHT]
  if (rank >= 0 && rank <= 3) return lighter ? light[rank] : dark[rank]
  return lighter ? '#e2e8f0' : '#94a3b8'
}

function chartReferenceYear(seriesNames: string[], widget: WidgetConfig) {
  const years = seriesNames.map(extractYearFromSeries).filter((year): year is number => !!year)
  if (widget.yearN && years.includes(widget.yearN)) return widget.yearN
  return years.length ? Math.max(...years) : (widget.yearN || CURRENT_YEAR)
}

function chartSeriesColor(series: string, index: number, widget: WidgetConfig, referenceYear?: number) {
  const year = extractYearFromSeries(series)
  if (year) return yearRankColor(year, referenceYear || widget.yearN || CURRENT_YEAR, String(series).includes('Activité'))
  if (String(series).includes('Devis')) return '#8b5cf6'
  if (String(series).includes('CDC')) return '#f59e0b'
  if (String(series).includes('BL')) return '#0ea5e9'
  if (String(series).includes('Activité')) return '#93c5fd'
  if (String(series).includes('Factures')) return '#2563eb'
  return PALETTE[index % PALETTE.length]
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
        <div onMouseLeave={() => setOpen(false)} className="absolute left-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string | number; onChange: (v: string) => void; options: Array<{ value: string | number; label: string }> }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none hover:bg-slate-50 focus:border-blue-500"
    >
      {options.map((option) => (
        <option key={String(option.value)} value={option.value}>{label} : {option.label}</option>
      ))}
    </select>
  )
}

function WidgetShell({
  widget,
  selected,
  onConfigure,
  onRemove,
  onDuplicate,
  onMove,
  children,
}: {
  widget: WidgetConfig
  selected: boolean
  onConfigure: (event: any) => void
  onRemove: () => void
  onDuplicate: () => void
  onMove: (direction: -1 | 1) => void
  children: ReactNode
  key?: string
}) {
  const sizeClass = widget.size === 'small' ? 'xl:col-span-1' : widget.size === 'medium' ? 'xl:col-span-2' : widget.size === 'large' ? 'xl:col-span-3' : 'xl:col-span-4'
  return (
    <section
      className={`${sizeClass} rounded-2xl border bg-white p-4 shadow-sm transition ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">{widget.title}</h3>
          <p className="text-xs text-slate-500">{sourceLabel(widget.source)} · {getMeasureLabel(widget.measure)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button title="Configurer le widget" type="button" onClick={onConfigure} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100">⚙</button>
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

function ChartWidget({ rows, widget, onUpdate }: { rows: StudioRow[]; widget: WidgetConfig; onUpdate?: (patch: Partial<WidgetConfig>) => void }) {
  const chartData = useMemo(() => {
    const xMap = new Map<string, Map<string, AggregatedValue>>()
    const seriesKey = widget.seriesDimension || ''
    rows.forEach((row) => {
      const xLabel = getDimensionValue(row, widget.dimension)
      const sLabel = getChartSeriesLabel(row, widget, seriesKey)
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

    let limited = sorted.slice(0, Math.max(1, widget.topN || 12))

    if (widget.dimension === 'mois' && widget.periodMode === 'cumul') {
      const running: Record<string, number> = {}
      limited = limited.map((row) => {
        const next: ChartDatum = { ...row, __total: 0, value: 0 }
        Object.keys(row).forEach((key) => {
          if (key === 'label' || key === '__total' || key === 'value') return
          running[key] = (running[key] || 0) + Number(row[key] || 0)
          next[key] = running[key]
          next.__total += running[key]
          next.value = next.__total
        })
        return next
      })
    }

    if (widget.type === 'histogramme_empile' && widget.stacked100 && widget.periodMode !== 'cumul') {
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
    if (widget.seriesDimension === 'annee') {
      // Tri demandé : N-3, N-2, N-1, puis N en dernier.
      // Si Factures + Activité sont empilés, Factures passe avant Activité dans la même année.
      result.sort((a, b) => {
        const ya = extractYearFromSeries(a) || 0
        const yb = extractYearFromSeries(b) || 0
        if (ya !== yb) return ya - yb
        const sourceDiff = sourceRankFromSeries(a) - sourceRankFromSeries(b)
        if (sourceDiff !== 0) return sourceDiff
        return a.localeCompare(b, 'fr', { numeric: true })
      })
    } else result.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    return result
  }, [chartData, widget.seriesDimension])

  if (!chartData.length) return <div className="rounded-xl bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">Aucune donnée avec les filtres sélectionnés.</div>

  const quickControls = (widget.type === 'courbe' || widget.type === 'histogramme' || widget.type === 'histogramme_empile') && onUpdate
  const chartAsLine = widget.type === 'courbe' || ((widget.type === 'histogramme' || widget.type === 'histogramme_empile') && widget.periodMode === 'cumul')
  const referenceYear = chartReferenceYear(seriesNames, widget)
  const mixedYearStack = widget.source === 'mixte' && widget.seriesDimension === 'annee' && widget.dimension === 'mois' && !chartAsLine

  function stackIdForSeries(series: string) {
    if (mixedYearStack) {
      const year = extractYearFromSeries(series)
      return year ? `year-${year}` : undefined
    }
    return widget.type === 'histogramme_empile' ? 'stack' : undefined
  }


  return (
    <div>
      {quickControls && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Cliquer pour modifier l'affichage</div>
            <div className="mt-1 text-sm font-black text-slate-900">{widget.periodMode === 'cumul' ? `${getMeasureLabel(widget.measure)} cumulé` : `${getMeasureLabel(widget.measure)} mensuel`}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onUpdate({ measure: 'ca_ht' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.measure === 'ca_ht' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>CA</button>
            <button type="button" onClick={() => onUpdate({ measure: 'marge_pct' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.measure === 'marge_pct' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Marge %</button>
            <button type="button" onClick={() => onUpdate({ periodMode: 'mois' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.periodMode === 'mois' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Mensuel</button>
            <button type="button" onClick={() => onUpdate({ periodMode: 'cumul' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.periodMode === 'cumul' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Cumul</button>
          </div>
        </div>
      )}

      {chartAsLine ? (
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => widget.measure === 'marge_pct' ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              {seriesNames.map((series, index) => (
                <Line
                  key={series}
                  type="monotone"
                  dataKey={series}
                  name={series}
                  stroke={chartSeriesColor(series, index, widget, referenceYear)}
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
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
                  stackId={stackIdForSeries(series)}
                  maxBarSize={(widget.type === 'histogramme_empile' || mixedYearStack) ? 42 : undefined}
                  fill={chartSeriesColor(series, index, widget, referenceYear)}
                  isAnimationActive={false}
                >
                  {widget.type === 'histogramme_empile' && widget.showValues && (
                    <LabelList dataKey={series} content={(props: any) => <StackedValueLabel {...props} dataKey={series} measure={widget.measure} stacked100={widget.stacked100} />} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function BridgeWidget({ rows, widget, onUpdate }: { rows: StudioRow[]; widget: WidgetConfig; onUpdate?: (patch: Partial<WidgetConfig>) => void }) {
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1">{widget.periodMode === 'cumul' ? `01-${String(bridgeData.monthLimit).padStart(2, '0')}` : monthLabel(bridgeData.monthLimit)}</span>
          <span>Départ {bridgeData.yearN1} → Arrivée {bridgeData.yearN}</span>
          {widget.measure === 'marge_pct' && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">Marge % : écarts en points par dimension</span>}
        </div>
        {onUpdate && (
          <div className="flex gap-2">
            <button type="button" onClick={() => onUpdate({ bridgeMonth: Math.max(1, (widget.bridgeMonth || CURRENT_MONTH) - 1) })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50">-1 mois</button>
            <button type="button" onClick={() => onUpdate({ bridgeMonth: Math.min(12, (widget.bridgeMonth || CURRENT_MONTH) + 1) })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50">+1 mois</button>
            <button type="button" onClick={() => onUpdate({ periodMode: 'mois' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.periodMode === 'mois' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Mois</button>
            <button type="button" onClick={() => onUpdate({ periodMode: 'cumul' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.periodMode === 'cumul' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>01-M</button>
          </div>
        )}
      </div>
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={waterfallData} margin={{ top: 25, right: 20, left: 10, bottom: 55 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 10 }} height={75} />
            <YAxis tickFormatter={(v) => widget.measure === 'marge_pct' ? `${Number(v).toFixed(0)}%` : `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip content={<BridgeTooltip measure={widget.measure} />} />
            <Bar dataKey="base" stackId="a" fill="#ffffff" fillOpacity={0} isAnimationActive={false} />
            <Bar dataKey="value" stackId="a" isAnimationActive={false}>
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


type DoubleBridgePoint = {
  name: string
  base: number
  value: number
  signedValue: number
  label: string
  fill: string
  phase: 'depart' | 'mix' | 'intermediaire' | 'perf' | 'arrivee'
  detail?: string
}

type DoubleBridgeDetail = {
  label: string
  startValue: number
  endValue: number
  effectMix: number
  effectPerf: number
  value: number
}

function signedLabel(value: number, measure: MeasureKey) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatMeasure(value, measure)}`
}

function formatDoubleBridgeValue(value: number, measure: MeasureKey) {
  return measure === 'marge_pct' ? formatRate(value) : formatMeasure(value, measure)
}

function periodLabelForBridge(periodMode: PeriodMode, month: number) {
  return periodMode === 'cumul' ? `01-${String(month).padStart(2, '0')}` : monthLabel(month)
}

function rowsForPeriod(rows: StudioRow[], year: number, month: number, periodMode: PeriodMode) {
  return rows.filter((row) => row.annee === year && (periodMode === 'cumul' ? row.mois <= month : row.mois === month))
}

function nextMonthPeriod(year: number, month: number) {
  if (month >= 12) return { year: year + 1, month: 1 }
  return { year, month: month + 1 }
}

function measureValueForDoubleBridge(agg: AggregatedValue, measure: MeasureKey) {
  if (measure === 'marge_pct') return agg.ca_ht ? (agg.marge_valeur / agg.ca_ht) * 100 : 0
  return measureValue(agg, measure)
}

function DoubleBridgeTooltip({ active, payload, label, measure }: any) {
  if (!active || !payload?.length) return null
  const valueItem = payload.find((item: any) => item?.dataKey === 'value')
  const row = valueItem?.payload || payload[0]?.payload || {}
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="mb-1 font-black text-slate-900">{row.name || label}</div>
      <div className="font-semibold text-slate-600">{row.detail || row.label}</div>
      {row.phase === 'mix' && <div className="mt-1 text-slate-500">Effet mix : changement de poids de la dimension.</div>}
      {row.phase === 'perf' && <div className="mt-1 text-slate-500">Effet performance : changement du taux / de la contribution propre.</div>}
    </div>
  )
}

function DoubleBridgeWidget({ rows, widget, onUpdate }: { rows: StudioRow[]; widget: WidgetConfig; onUpdate?: (patch: Partial<WidgetConfig>) => void }) {
  const data = useMemo(() => {
    const baseYear = widget.yearN || CURRENT_YEAR
    const baseMonth = Math.max(1, Math.min(12, widget.bridgeMonth || CURRENT_MONTH))
    const compareToNextMonth = widget.compareMode === 'month'
    const startYear = compareToNextMonth ? baseYear : (widget.yearN1 || baseYear - 1)
    const startMonth = baseMonth
    const next = nextMonthPeriod(baseYear, baseMonth)
    const endYear = compareToNextMonth ? next.year : baseYear
    const endMonth = compareToNextMonth ? next.month : baseMonth

    const startRows = rowsForPeriod(rows, startYear, startMonth, widget.periodMode)
    const endRows = rowsForPeriod(rows, endYear, endMonth, widget.periodMode)
    const startAgg = aggregateTotal(startRows)
    const endAgg = aggregateTotal(endRows)
    const startValue = measureValueForDoubleBridge(startAgg, widget.measure)
    const endValue = measureValueForDoubleBridge(endAgg, widget.measure)

    const dimKeys = new Set<string>()
    startRows.forEach((row) => dimKeys.add(getDimensionValue(row, widget.dimension)))
    endRows.forEach((row) => dimKeys.add(getDimensionValue(row, widget.dimension)))

    const rawDetails: DoubleBridgeDetail[] = Array.from(dimKeys).map((dimensionLabel) => {
      const startDimRows = startRows.filter((row) => getDimensionValue(row, widget.dimension) === dimensionLabel)
      const endDimRows = endRows.filter((row) => getDimensionValue(row, widget.dimension) === dimensionLabel)
      const startDimAgg = aggregateTotal(startDimRows)
      const endDimAgg = aggregateTotal(endDimRows)
      const startDimValue = measureValueForDoubleBridge(startDimAgg, widget.measure)
      const endDimValue = measureValueForDoubleBridge(endDimAgg, widget.measure)

      if (widget.measure === 'marge_pct') {
        const mixStart = startAgg.ca_ht ? startDimAgg.ca_ht / startAgg.ca_ht : 0
        const mixEnd = endAgg.ca_ht ? endDimAgg.ca_ht / endAgg.ca_ht : 0
        const perfStart = startDimAgg.ca_ht ? startDimAgg.marge_valeur / startDimAgg.ca_ht : 0
        const perfEnd = endDimAgg.ca_ht ? endDimAgg.marge_valeur / endDimAgg.ca_ht : 0
        const effectMix = 0.5 * (mixEnd - mixStart) * (perfStart + perfEnd) * 100
        const effectPerf = 0.5 * (mixStart + mixEnd) * (perfEnd - perfStart) * 100
        return {
          label: dimensionLabel,
          startValue: mixStart * perfStart * 100,
          endValue: mixEnd * perfEnd * 100,
          effectMix,
          effectPerf,
          value: Math.abs(effectMix) + Math.abs(effectPerf),
        }
      }

      const startShare = startValue ? startDimValue / startValue : 0
      const endShare = endValue ? endDimValue / endValue : 0
      const effectMix = 0.5 * (endShare - startShare) * (startValue + endValue)
      const rawDelta = endDimValue - startDimValue
      const effectPerf = rawDelta - effectMix
      return {
        label: dimensionLabel,
        startValue: startDimValue,
        endValue: endDimValue,
        effectMix,
        effectPerf,
        value: Math.abs(effectMix) + Math.abs(effectPerf),
      }
    })

    const sorted = [...rawDetails].sort((a, b) => b.value - a.value)
    const topN = Math.max(1, widget.topN || 10)
    const displayed = sorted.slice(0, topN)
    const remaining = sorted.slice(topN)
    const details = remaining.length
      ? [
          ...displayed,
          {
            label: 'Autres',
            startValue: remaining.reduce((sum, item) => sum + item.startValue, 0),
            endValue: remaining.reduce((sum, item) => sum + item.endValue, 0),
            effectMix: remaining.reduce((sum, item) => sum + item.effectMix, 0),
            effectPerf: remaining.reduce((sum, item) => sum + item.effectPerf, 0),
            value: remaining.reduce((sum, item) => sum + item.value, 0),
          },
        ]
      : displayed

    const totalMixEffect = details.reduce((sum, item) => sum + item.effectMix, 0)
    const totalPerfEffect = details.reduce((sum, item) => sum + item.effectPerf, 0)
    const intermediateValue = startValue + totalMixEffect

    let cursor = startValue
    const points: DoubleBridgePoint[] = [
      {
        name: `Départ ${periodLabelForBridge(widget.periodMode, startMonth)} ${startYear}`,
        base: 0,
        value: startValue,
        signedValue: startValue,
        label: formatDoubleBridgeValue(startValue, widget.measure),
        fill: COLOR_BRIDGE_TOTAL,
        phase: 'depart',
        detail: `Valeur de départ : ${formatDoubleBridgeValue(startValue, widget.measure)}`,
      },
    ]

    details.forEach((item) => {
      const nextCursor = cursor + item.effectMix
      points.push({
        name: `Mix ${item.label}`,
        base: Math.min(cursor, nextCursor),
        value: Math.abs(item.effectMix),
        signedValue: item.effectMix,
        label: signedLabel(item.effectMix, widget.measure),
        fill: item.effectMix >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE,
        phase: 'mix',
        detail: `${item.label} · effet mix : ${signedLabel(item.effectMix, widget.measure)}`,
      })
      cursor = nextCursor
    })

    points.push({
      name: 'Intermédiaire après mix',
      base: 0,
      value: intermediateValue,
      signedValue: intermediateValue,
      label: formatDoubleBridgeValue(intermediateValue, widget.measure),
      fill: COLOR_BRIDGE_INTERMEDIATE,
      phase: 'intermediaire',
      detail: `Départ + effet mix : ${formatDoubleBridgeValue(intermediateValue, widget.measure)}`,
    })

    cursor = intermediateValue
    details.forEach((item) => {
      const nextCursor = cursor + item.effectPerf
      points.push({
        name: `Perf ${item.label}`,
        base: Math.min(cursor, nextCursor),
        value: Math.abs(item.effectPerf),
        signedValue: item.effectPerf,
        label: signedLabel(item.effectPerf, widget.measure),
        fill: item.effectPerf >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE,
        phase: 'perf',
        detail: `${item.label} · effet performance : ${signedLabel(item.effectPerf, widget.measure)}`,
      })
      cursor = nextCursor
    })

    points.push({
      name: `Arrivée ${periodLabelForBridge(widget.periodMode, endMonth)} ${endYear}`,
      base: 0,
      value: endValue,
      signedValue: endValue,
      label: formatDoubleBridgeValue(endValue, widget.measure),
      fill: COLOR_BRIDGE_TOTAL,
      phase: 'arrivee',
      detail: `Valeur d'arrivée : ${formatDoubleBridgeValue(endValue, widget.measure)}`,
    })

    return {
      startYear,
      startMonth,
      endYear,
      endMonth,
      startValue,
      endValue,
      totalMixEffect,
      totalPerfEffect,
      intermediateValue,
      details,
      points,
    }
  }, [rows, widget])

  if (!rows.length) return <div className="rounded-xl bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">Aucune donnée avec les filtres sélectionnés.</div>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1">{periodLabelForBridge(widget.periodMode, data.startMonth)} {data.startYear} → {periodLabelForBridge(widget.periodMode, data.endMonth)} {data.endYear}</span>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Mix : 0,5 × Δpoids × (perf départ + perf arrivée)</span>
          <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">Perf : 0,5 × (poids départ + poids arrivée) × Δperf</span>
        </div>
        {onUpdate && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onUpdate({ measure: 'ca_ht' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.measure === 'ca_ht' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>CA</button>
            <button type="button" onClick={() => onUpdate({ measure: 'marge_valeur' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.measure === 'marge_valeur' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Marge €</button>
            <button type="button" onClick={() => onUpdate({ measure: 'marge_pct' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.measure === 'marge_pct' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Marge %</button>
            <button type="button" onClick={() => onUpdate({ bridgeMonth: Math.max(1, (widget.bridgeMonth || CURRENT_MONTH) - 1) })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50">-1 mois</button>
            <button type="button" onClick={() => onUpdate({ bridgeMonth: Math.min(12, (widget.bridgeMonth || CURRENT_MONTH) + 1) })} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50">+1 mois</button>
            <button type="button" onClick={() => onUpdate({ periodMode: 'mois' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.periodMode === 'mois' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>Mois</button>
            <button type="button" onClick={() => onUpdate({ periodMode: 'cumul' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.periodMode === 'cumul' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>01-M</button>
            <button type="button" onClick={() => onUpdate({ compareMode: 'month' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.compareMode === 'month' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>M→M+1</button>
            <button type="button" onClick={() => onUpdate({ compareMode: 'year' })} className={`rounded-xl border px-3 py-2 text-xs font-black ${widget.compareMode !== 'month' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800'}`}>N-1→N</button>
          </div>
        )}
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black uppercase text-slate-500">Départ</div><div className="text-lg font-black text-slate-900">{formatDoubleBridgeValue(data.startValue, widget.measure)}</div></div>
        <div className="rounded-xl bg-amber-50 p-3"><div className="text-[10px] font-black uppercase text-amber-700">Effet mix</div><div className="text-lg font-black text-slate-900">{signedLabel(data.totalMixEffect, widget.measure)}</div></div>
        <div className="rounded-xl bg-violet-50 p-3"><div className="text-[10px] font-black uppercase text-violet-700">Effet performance</div><div className="text-lg font-black text-slate-900">{signedLabel(data.totalPerfEffect, widget.measure)}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black uppercase text-slate-500">Arrivée</div><div className="text-lg font-black text-slate-900">{formatDoubleBridgeValue(data.endValue, widget.measure)}</div></div>
      </div>

      <div className="h-[430px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.points} margin={{ top: 30, right: 20, left: 10, bottom: 95 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 10 }} height={105} />
            <YAxis tickFormatter={(v) => widget.measure === 'marge_pct' ? `${Number(v).toFixed(1)}%` : `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip content={<DoubleBridgeTooltip measure={widget.measure} />} />
            <Bar dataKey="base" stackId="a" fill="#ffffff" fillOpacity={0} isAnimationActive={false} />
            <Bar dataKey="value" stackId="a" isAnimationActive={false}>
              <LabelList dataKey="label" position="top" style={{ fontSize: 10, fontWeight: 800, fill: '#0f172a' }} />
              {data.points.map((entry, index) => <Cell key={`double-bridge-cell-${index}`} fill={entry.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-black">Dimension</th>
              <th className="px-3 py-2 text-right font-black">Départ</th>
              <th className="px-3 py-2 text-right font-black">Effet mix</th>
              <th className="px-3 py-2 text-right font-black">Effet perf</th>
              <th className="px-3 py-2 text-right font-black">Arrivée</th>
            </tr>
          </thead>
          <tbody>
            {data.details.map((item) => (
              <tr key={item.label} className="border-t border-slate-100">
                <td className="px-3 py-2 font-bold text-slate-800">{item.label}</td>
                <td className="px-3 py-2 text-right font-semibold">{formatDoubleBridgeValue(item.startValue, widget.measure)}</td>
                <td className={`px-3 py-2 text-right font-bold ${item.effectMix >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{signedLabel(item.effectMix, widget.measure)}</td>
                <td className={`px-3 py-2 text-right font-bold ${item.effectPerf >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{signedLabel(item.effectPerf, widget.measure)}</td>
                <td className="px-3 py-2 text-right font-semibold">{formatDoubleBridgeValue(item.endValue, widget.measure)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function sanitizeExcelSheetName(name: string) {
  const clean = String(name || 'Feuille').replace(/[\\/?*\[\]:]/g, ' ').trim()
  return clean.slice(0, 31) || 'Feuille'
}

function excelSafeFileName(name: string) {
  return String(name || 'export').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'export'
}

function excelCellAddress(row: number, col: number) {
  return XLSX.utils.encode_cell({ r: row, c: col })
}

function excelHeaderStyle(fill = 'DDE5F1') {
  return {
    font: { bold: true, color: { rgb: '0F172A' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    fill: { fgColor: { rgb: fill } },
    border: {
      top: { style: 'thin', color: { rgb: 'CBD5E1' } },
      bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
      left: { style: 'thin', color: { rgb: 'CBD5E1' } },
      right: { style: 'thin', color: { rgb: 'CBD5E1' } },
    },
  }
}

function excelBodyStyle(fill = 'FFFFFF', bold = false) {
  return {
    font: { bold, color: { rgb: '0F172A' } },
    alignment: { vertical: 'center', wrapText: true },
    fill: { fgColor: { rgb: fill } },
    border: {
      top: { style: 'thin', color: { rgb: 'E2E8F0' } },
      bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
      left: { style: 'thin', color: { rgb: 'E2E8F0' } },
      right: { style: 'thin', color: { rgb: 'E2E8F0' } },
    },
  }
}

function PivotTableWidget({ rows, widget }: { rows: StudioRow[]; widget: WidgetConfig }) {
  const [sortCell, setSortCell] = useState<{ column: string; measure: MeasureKey | 'total'; dir: 'asc' | 'desc' } | null>(null)
  const [rowSorts, setRowSorts] = useState<Array<{ partIndex: number; dir: 'asc' | 'desc' }>>([])
  const [rowDetailExpanded, setRowDetailExpanded] = useState(true)
  const [columnDetailExpanded, setColumnDetailExpanded] = useState(true)

  const measures = widget.tableMeasures?.length ? widget.tableMeasures : [widget.measure]
  const yearN = widget.yearN || CURRENT_YEAR
  const yearN1 = widget.yearN1 || yearN - 1
  const monthLimit = widget.bridgeMonth || CURRENT_MONTH
  const inSelectedPeriod = (row: StudioRow) => widget.periodMode === 'cumul' ? row.mois <= monthLimit : row.mois === monthLimit
  const periodRows = rows.filter((row) => inSelectedPeriod(row))
  const currentPeriodRows = rows.filter((row) => row.annee === yearN && inSelectedPeriod(row))
  const previousPeriodRows = rows.filter((row) => row.annee === yearN1 && inSelectedPeriod(row))

  const configuredRowDimensions = [widget.rowDimension, widget.rowDimension2].filter(Boolean) as DimensionKey[]
  const configuredColumnDimensions = [widget.columnDimension, widget.columnDimension2].filter(Boolean) as DimensionKey[]
  const rowDimensions = configuredRowDimensions.length > 1 && !rowDetailExpanded
    ? [configuredRowDimensions[0]]
    : configuredRowDimensions
  const columnDimensions = configuredColumnDimensions.length > 1 && !columnDetailExpanded
    ? [configuredColumnDimensions[0]]
    : configuredColumnDimensions
  const hasRowDrill = configuredRowDimensions.length > 1
  const hasColumnDrill = configuredColumnDimensions.length > 1
  const headerRowCount = columnDimensions.length > 1 ? 3 : 2
  const ROW_JOIN = '§ROW§'
  const COL_JOIN = '§COL§'
  const rowWidths = rowDimensions.length > 1 ? ['120px', '180px'] : ['220px']

  type PivotColumn = { key: string; parts: string[] }
  type PivotRow = {
    key: string
    parts: string[]
    colMap: Map<string, AggregatedValue>
    total: AggregatedValue
    totalPrev: AggregatedValue
    value: number
    isSubtotal?: boolean
    subtotalFor?: string
  }

  function rowKey(parts: string[]) {
    return parts.join(ROW_JOIN)
  }

  function columnKey(parts: string[]) {
    return parts.join(COL_JOIN)
  }

  function rowPartsFor(row: StudioRow, dimensions = rowDimensions) {
    return dimensions.map((dimension) => getDimensionValue(row, dimension))
  }

  function columnPartsFor(row: StudioRow, dimensions = columnDimensions) {
    return dimensions.map((dimension) => getDimensionValue(row, dimension))
  }

  function compareDimensionPart(a: string, b: string, dimension: DimensionKey) {
    if (dimension === 'mois') return MONTHS.indexOf(a) - MONTHS.indexOf(b)
    if (dimension === 'annee') return Number(a) - Number(b)
    return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })
  }

  function compareRowParts(a: string[], b: string[], criteria: Array<{ partIndex: number; dir: 'asc' | 'desc' }>) {
    const normalizedCriteria = [...criteria]

    // Quand deux dimensions de lignes sont affichées, on garde toujours la dimension 1 comme groupe.
    // Exemple : tri Famille macro puis tri Année => 2025 avec familles A→Z, puis 2026 avec familles A→Z.
    if (rowDimensions.length > 1 && !normalizedCriteria.some((criterion) => criterion.partIndex === 0)) {
      normalizedCriteria.unshift({ partIndex: 0, dir: 'asc' })
    }

    // On complète toujours avec les dimensions non encore triées.
    // Ainsi, si l'utilisateur trie seulement Année, les familles restent triées de façon stable à l'intérieur de chaque année.
    rowDimensions.forEach((_dimension, index) => {
      if (!normalizedCriteria.some((criterion) => criterion.partIndex === index)) {
        normalizedCriteria.push({ partIndex: index, dir: 'asc' })
      }
    })

    const fallbackCriteria = normalizedCriteria.length
      ? normalizedCriteria
      : rowDimensions.map((_dimension, index) => ({ partIndex: index, dir: 'asc' as const }))

    for (const criterion of fallbackCriteria) {
      const dimension = rowDimensions[criterion.partIndex]
      if (!dimension) continue
      const result = compareDimensionPart(a[criterion.partIndex] || '', b[criterion.partIndex] || '', dimension)
      if (result !== 0) return criterion.dir === 'asc' ? result : -result
    }

    return rowKey(a).localeCompare(rowKey(b), 'fr', { numeric: true })
  }

  function toggleRowSort(partIndex: number) {
    setSortCell(null)
    setRowSorts((prev) => {
      const existing = prev.find((criterion) => criterion.partIndex === partIndex)
      const remaining = prev.filter((criterion) => criterion.partIndex !== partIndex)
      const nextDir = existing && prev[0]?.partIndex === partIndex
        ? existing.dir === 'asc' ? 'desc' : 'asc'
        : existing?.dir || 'asc'
      return [{ partIndex, dir: nextDir }, ...remaining]
    })
  }

  function toggleSort(column: string, measure: MeasureKey | 'total') {
    setRowSorts([])
    setSortCell((prev) => {
      if (prev?.column === column && prev.measure === measure) return { column, measure, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { column, measure, dir: 'desc' }
    })
  }

  const pivot = useMemo(() => {
    const map = new Map<string, Map<string, AggregatedValue>>()
    const rowMeta = new Map<string, string[]>()
    const columnMeta = new Map<string, string[]>()

    periodRows.forEach((row) => {
      const rParts = rowPartsFor(row)
      const cParts = columnPartsFor(row)
      const rKey = rowKey(rParts)
      const cKey = columnKey(cParts)

      if (!map.has(rKey)) map.set(rKey, new Map())
      if (!rowMeta.has(rKey)) rowMeta.set(rKey, rParts)
      if (!columnMeta.has(cKey)) columnMeta.set(cKey, cParts)

      const colMap = map.get(rKey)!
      if (!colMap.has(cKey)) colMap.set(cKey, emptyAgg())
      addToAgg(colMap.get(cKey)!, row)
    })

    let columns = Array.from(columnMeta.entries()).map(([key, parts]) => ({ key, parts }))
    columns.sort((a, b) => {
      for (let i = 0; i < columnDimensions.length; i += 1) {
        const result = compareDimensionPart(a.parts[i] || '', b.parts[i] || '', columnDimensions[i])
        if (result !== 0) return result
      }
      return a.key.localeCompare(b.key, 'fr', { numeric: true })
    })
    // Ne pas limiter les colonnes du tableau croisé :
    // le TOP N du widget pilote les lignes affichées, mais les colonnes doivent toutes rester visibles
    // avec le scroll horizontal, comme dans l'export Excel.

    const rowItems: PivotRow[] = Array.from(map.entries()).map(([key, colMap]) => {
      const parts = rowMeta.get(key) || [key]
      const total = emptyAgg()
      const totalPrev = emptyAgg()

      periodRows
        .filter((r) => rowKey(rowPartsFor(r)) === key)
        .forEach((r) => addToAgg(total, r))

      previousPeriodRows
        .filter((r) => rowKey(rowPartsFor(r)) === key)
        .forEach((r) => addToAgg(totalPrev, r))

      return { key, parts, colMap, value: measureValue(total, widget.measure), total, totalPrev }
    })

    let sortedRows = [...rowItems]
    if (sortCell) {
      sortedRows.sort((a, b) => {
        const aggA = sortCell.column === '__total__' ? a.total : a.colMap.get(sortCell.column) || emptyAgg()
        const aggB = sortCell.column === '__total__' ? b.total : b.colMap.get(sortCell.column) || emptyAgg()
        const measure = sortCell.measure === 'total' ? widget.measure : sortCell.measure
        const va = measureValue(aggA, measure)
        const vb = measureValue(aggB, measure)
        return sortCell.dir === 'asc' ? va - vb : vb - va
      })
    } else if (rowSorts.length) {
      sortedRows.sort((a, b) => compareRowParts(a.parts, b.parts, rowSorts))
    } else if (rowDimensions.length > 1 && rowDetailExpanded) {
      // Important : avec des sous-totaux, les lignes doivent rester groupées par dimension 1.
      // Sinon, un tri par valeur peut alterner 2024/2025/2026 et générer un total répété à chaque changement de groupe.
      sortedRows.sort((a, b) => compareRowParts(a.parts, b.parts, []))
    } else if (widget.sortMode === 'value_desc' || widget.sortMode === 'value_asc') {
      sortedRows.sort((a, b) => widget.sortMode === 'value_desc' ? b.value - a.value : a.value - b.value)
    } else {
      sortedRows.sort((a, b) => compareRowParts(a.parts, b.parts, []))
    }

    sortedRows = sortedRows.slice(0, Math.max(1, widget.topN || 25))

    const rowsWithSubtotals: PivotRow[] = []
    if (rowDimensions.length > 1 && rowDetailExpanded && !sortCell) {
      let currentGroup = ''
      let subtotal: PivotRow | null = null

      function flushSubtotal() {
        if (subtotal) rowsWithSubtotals.push(subtotal)
        subtotal = null
      }

      sortedRows.forEach((row) => {
        const group = row.parts[0] || '—'
        if (currentGroup && group !== currentGroup) flushSubtotal()
        if (!currentGroup || group !== currentGroup) {
          currentGroup = group
          const subtotalColMap = new Map<string, AggregatedValue>()
          subtotal = {
            key: `__subtotal__${ROW_JOIN}${group}`,
            parts: [group, `TOTAL ${group}`],
            colMap: subtotalColMap,
            total: emptyAgg(),
            totalPrev: emptyAgg(),
            value: 0,
            isSubtotal: true,
            subtotalFor: group,
          }
        }

        rowsWithSubtotals.push(row)

        if (subtotal) {
          mergeAgg(subtotal.total, row.total)
          mergeAgg(subtotal.totalPrev, row.totalPrev)
          row.colMap.forEach((agg, colKey) => {
            if (!subtotal!.colMap.has(colKey)) subtotal!.colMap.set(colKey, emptyAgg())
            const target = subtotal!.colMap.get(colKey)!
            mergeAgg(target, agg)
          })
          subtotal.value = measureValue(subtotal.total, widget.measure)
        }
      })
      flushSubtotal()
    } else {
      rowsWithSubtotals.push(...sortedRows)
    }

    const columnGroups: Array<{ label: string; columns: PivotColumn[] }> = []
    if (columnDimensions.length > 1) {
      columns.forEach((column) => {
        const label = column.parts[0] || '—'
        const current = columnGroups[columnGroups.length - 1]
        if (!current || current.label !== label) columnGroups.push({ label, columns: [column] })
        else current.columns.push(column)
      })
    } else {
      columnGroups.push({ label: '', columns })
    }

    return {
      columns,
      columnGroups,
      rows: rowsWithSubtotals,
    }
  }, [periodRows, rows, widget, sortCell, rowSorts, measures, currentPeriodRows, previousPeriodRows, rowDetailExpanded, columnDetailExpanded, rowDimensions, columnDimensions])

  function comparisonColumnKey(column: PivotColumn) {
    if (columnDimensions.includes('annee')) {
      return columnKey(column.parts.map((part, index) => columnDimensions[index] === 'annee' && part === String(yearN) ? String(yearN1) : part))
    }
    return column.key
  }

  function comparisonValue(rowKeyValue: string, column: PivotColumn, measure: MeasureKey) {
    if (widget.evolutionMode === 'none' || rowKeyValue.startsWith('__subtotal__')) return 0
    const prevAgg = emptyAgg()
    const prevColumnKey = comparisonColumnKey(column)
    previousPeriodRows
      .filter((r) => rowKey(rowPartsFor(r)) === rowKeyValue)
      .filter((r) => columnKey(columnPartsFor(r)) === prevColumnKey)
      .forEach((r) => addToAgg(prevAgg, r))
    return measureValue(prevAgg, measure)
  }

  function totalComparisonValue(row: PivotRow, measure: MeasureKey) {
    if (widget.evolutionMode === 'none') return 0
    if (row.isSubtotal) return measureValue(row.totalPrev, measure)
    return measureValue(row.totalPrev, measure)
  }

  function exportPivotToExcel(includeDetail: boolean) {
    const wb = XLSX.utils.book_new()
    const aoa: any[][] = []
    const merges: any[] = []
    const rowHeaderCount = rowDimensions.length
    const totalHeader = `TOTAL ${widget.periodMode === 'cumul' ? `01-${String(monthLimit).padStart(2, '0')}` : monthLabel(monthLimit)}`

    aoa.push([widget.title || 'Tableau croisé'])
    aoa.push([`${sourceLabel(widget.source)} · ${measures.map(getMeasureLabel).join(' / ')}`])
    aoa.push([])

    const startHeaderRow = aoa.length
    const headerRows: any[][] = []

    if (columnDimensions.length > 1) {
      const h1 = rowDimensions.map(getDimensionLabel)
      const h2 = Array(rowHeaderCount).fill('')
      const h3 = Array(rowHeaderCount).fill('')

      h1.push(totalHeader, ...Array(Math.max(0, measures.length - 1)).fill(''))
      h2.push(...Array(measures.length).fill(''))
      h3.push(...measures.map(getMeasureLabel))
      merges.push({ s: { r: startHeaderRow, c: rowHeaderCount }, e: { r: startHeaderRow + 1, c: rowHeaderCount + measures.length - 1 } })

      let cursor = rowHeaderCount + measures.length
      pivot.columnGroups.forEach((group) => {
        const span = group.columns.length * measures.length
        h1.push(group.label, ...Array(Math.max(0, span - 1)).fill(''))
        merges.push({ s: { r: startHeaderRow, c: cursor }, e: { r: startHeaderRow, c: cursor + span - 1 } })
        group.columns.forEach((column) => {
          h2.push(column.parts[1] || '—', ...Array(Math.max(0, measures.length - 1)).fill(''))
          if (measures.length > 1) merges.push({ s: { r: startHeaderRow + 1, c: cursor }, e: { r: startHeaderRow + 1, c: cursor + measures.length - 1 } })
          h3.push(...measures.map(getMeasureLabel))
          cursor += measures.length
        })
      })
      rowDimensions.forEach((_dimension, index) => merges.push({ s: { r: startHeaderRow, c: index }, e: { r: startHeaderRow + 2, c: index } }))
      headerRows.push(h1, h2, h3)
    } else {
      const h1 = rowDimensions.map(getDimensionLabel)
      const h2 = Array(rowHeaderCount).fill('')
      h1.push(totalHeader, ...Array(Math.max(0, measures.length - 1)).fill(''))
      h2.push(...measures.map(getMeasureLabel))
      if (measures.length > 1) merges.push({ s: { r: startHeaderRow, c: rowHeaderCount }, e: { r: startHeaderRow, c: rowHeaderCount + measures.length - 1 } })
      let cursor = rowHeaderCount + measures.length
      pivot.columns.forEach((column) => {
        h1.push(column.parts[0] || '—', ...Array(Math.max(0, measures.length - 1)).fill(''))
        h2.push(...measures.map(getMeasureLabel))
        if (measures.length > 1) merges.push({ s: { r: startHeaderRow, c: cursor }, e: { r: startHeaderRow, c: cursor + measures.length - 1 } })
        cursor += measures.length
      })
      rowDimensions.forEach((_dimension, index) => merges.push({ s: { r: startHeaderRow, c: index }, e: { r: startHeaderRow + 1, c: index } }))
      headerRows.push(h1, h2)
    }

    aoa.push(...headerRows)

    pivot.rows.forEach((row) => {
      const line: any[] = [...row.parts]
      measures.forEach((measure) => line.push(measureValue(row.total, measure)))
      pivot.columns.forEach((column) => {
        const agg = row.colMap.get(column.key) || emptyAgg()
        measures.forEach((measure) => line.push(measureValue(agg, measure)))
      })
      aoa.push(line)
    })

    const totalLine: any[] = ['TOTAL', ...Array(Math.max(0, rowHeaderCount - 1)).fill('')]
    const currentGrand = aggregateTotal(periodRows)
    measures.forEach((measure) => totalLine.push(measureValue(currentGrand, measure)))
    pivot.columns.forEach((column) => {
      const agg = emptyAgg()
      periodRows.filter((r) => columnKey(columnPartsFor(r)) === column.key).forEach((r) => addToAgg(agg, r))
      measures.forEach((measure) => totalLine.push(measureValue(agg, measure)))
    })
    aoa.push(totalLine)

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = merges
    ws['!freeze'] = { xSplit: rowHeaderCount, ySplit: startHeaderRow + headerRows.length }
    ws['!cols'] = [
      ...rowDimensions.map((_dimension, index) => ({ wch: index === 0 ? 14 : 24 })),
      ...Array(Math.max(0, (aoa[startHeaderRow]?.length || 0) - rowHeaderCount)).fill({ wch: 16 }),
    ]

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    const lastHeaderRow = startHeaderRow + headerRows.length - 1
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = excelCellAddress(r, c)
        const cell = ws[addr]
        if (!cell) continue
        if (r === 0) {
          cell.s = { font: { bold: true, sz: 16, color: { rgb: '0F172A' } } }
        } else if (r === 1) {
          cell.s = { font: { bold: true, color: { rgb: '64748B' } } }
        } else if (r >= startHeaderRow && r <= lastHeaderRow) {
          cell.s = excelHeaderStyle(r === startHeaderRow ? 'DDE5F1' : 'F1F5F9')
        } else if (r === range.e.r || c < rowHeaderCount || String(aoa[r]?.[Math.max(0, rowHeaderCount - 1)] || '').startsWith('TOTAL')) {
          cell.s = excelBodyStyle(r === range.e.r ? 'E2E8F0' : 'EEF4FA', true)
        } else {
          cell.s = excelBodyStyle('FFFFFF', false)
        }
        if (r > lastHeaderRow && c >= rowHeaderCount) {
          const measureIndex = (c - rowHeaderCount) % measures.length
          const measure = measures[measureIndex]
          if (measure === 'marge_pct') {
            cell.z = '0.0%'
            if (typeof cell.v === 'number') cell.v = cell.v / 100
          } else if (measure === 'ca_ht' || measure === 'marge_valeur') cell.z = '#,##0 €'
          else cell.z = '#,##0'
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName('Tableau croisé'))

    if (includeDetail) {
      const detail = rows.map((r) => ({
        Source: sourceLabel(r.source),
        Année: r.annee,
        Mois: r.mois,
        'Type document': r.type_document,
        Agence: r.agence_collaborateur,
        'Dépôt': r.depot,
        'Collaborateur facture': r.collaborateur_facture,
        'Collaborateur tiers': r.collaborateur_tiers,
        'Département tiers': r.departement_tiers,
        Population: r.population_departement,
        'Superficie km²': r.superficie_departement,
        Collaborateur: r.collaborateur,
        'Numéro tiers': r.numero_tiers,
        'Nom tiers': r.intitule_tiers,
        Famille: r.famille,
        'Famille macro': r.famille_macro,
        'Référence article': r.reference_article,
        Désignation: r.designation,
        'Hors statistique': r.hors_statistique ? 'Oui' : 'Non',
        'Nb lignes': r.nb_lignes,
        Quantité: r.quantite,
        'CA HT': r.ca_ht,
        'Marge €': r.marge_valeur,
        'Marge %': r.ca_ht ? r.marge_valeur / r.ca_ht : 0,
      }))
      const wsDetail = XLSX.utils.json_to_sheet(detail)
      wsDetail['!cols'] = [
        { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
        { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 14 },
        { wch: 14 }, { wch: 18 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 16 },
        { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
      ]
      const detailRange = XLSX.utils.decode_range(wsDetail['!ref'] || 'A1:A1')
      for (let c = detailRange.s.c; c <= detailRange.e.c; c += 1) {
        const cell = wsDetail[excelCellAddress(0, c)]
        if (cell) cell.s = excelHeaderStyle('DDE5F1')
      }
      for (let r = 1; r <= detailRange.e.r; r += 1) {
        ;[9, 10, 17, 18].forEach((c) => {
          const cell = wsDetail[excelCellAddress(r, c)]
          if (cell) cell.z = '#,##0'
        })
        ;[19, 20].forEach((c) => {
          const cell = wsDetail[excelCellAddress(r, c)]
          if (cell) cell.z = '#,##0 €'
        })
        const pct = wsDetail[excelCellAddress(r, 21)]
        if (pct) pct.z = '0.0%'
      }
      XLSX.utils.book_append_sheet(wb, wsDetail, sanitizeExcelSheetName('Détail'))
    }

    XLSX.writeFile(wb, `${excelSafeFileName(widget.title || 'tableau_croise')}${includeDetail ? '_avec_detail' : ''}.xlsx`)
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

  const rowHeaderStyle = (index: number) => ({
    left: index === 0 ? 0 : `calc(${rowWidths.slice(0, index).join(' + ')})`,
    minWidth: rowWidths[index] || '160px',
  })

  const rowSortIndicator = (index: number) => {
    const rank = rowSorts.findIndex((criterion) => criterion.partIndex === index)
    if (rank < 0) return ''
    const criterion = rowSorts[rank]
    return `${criterion.dir === 'asc' ? '▲' : '▼'}${rank > 0 ? rank + 1 : ''}`
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-blue-700">Export du tableau croisé</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Les dimensions de lignes et de colonnes sont exportées dans des colonnes / lignes séparées.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasRowDrill && (
            <button type="button" onClick={() => setRowDetailExpanded((v) => !v)} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50">
              {rowDetailExpanded ? `Réduire lignes : ${getDimensionLabel(configuredRowDimensions[1])}` : `Développer lignes : ${getDimensionLabel(configuredRowDimensions[1])}`}
            </button>
          )}
          {hasColumnDrill && (
            <button type="button" onClick={() => setColumnDetailExpanded((v) => !v)} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50">
              {columnDetailExpanded ? `Réduire colonnes : ${getDimensionLabel(configuredColumnDimensions[1])}` : `Développer colonnes : ${getDimensionLabel(configuredColumnDimensions[1])}`}
            </button>
          )}
          <button type="button" onClick={() => exportPivotToExcel(false)} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-700">Exporter Excel</button>
          <button type="button" onClick={() => exportPivotToExcel(true)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-blue-700">Excel + feuille détail</button>
        </div>
      </div>
      <div className="overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100">
              {rowDimensions.map((dimension, index) => (
                <th
                  key={`row-head-${dimension}-${index}`}
                  rowSpan={headerRowCount}
                  onClick={() => toggleRowSort(index)}
                  style={rowHeaderStyle(index)}
                  className="sticky z-30 cursor-pointer border border-slate-200 bg-slate-100 px-3 py-2 text-left font-black hover:bg-blue-100"
                >
                  <span>{getDimensionLabel(dimension)}</span>
                  <span className="ml-1 text-blue-700">{rowSortIndicator(index)}</span>
                </th>
              ))}
              <th rowSpan={columnDimensions.length > 1 ? 2 : 1} colSpan={measures.length} className="border border-slate-200 bg-slate-200 px-3 py-2 text-center font-black">
                TOTAL {widget.periodMode === 'cumul' ? `01-${String(monthLimit).padStart(2, '0')}` : monthLabel(monthLimit)}
              </th>
              {columnDimensions.length > 1
                ? pivot.columnGroups.map((group) => (
                    <th key={`group-${group.label}`} colSpan={group.columns.length * measures.length} className="border border-slate-200 px-3 py-2 text-center font-black">
                      {group.label}
                    </th>
                  ))
                : pivot.columns.map((column) => (
                    <th key={column.key} colSpan={measures.length} className="border border-slate-200 px-3 py-2 text-center font-black">
                      {column.parts[0] || '—'}
                    </th>
                  ))}
            </tr>
            {columnDimensions.length > 1 && (
              <tr className="bg-slate-50">
                {pivot.columns.map((column) => (
                  <th key={`sub-${column.key}`} colSpan={measures.length} className="border border-slate-200 px-3 py-2 text-center font-black">
                    {column.parts[1] || '—'}
                  </th>
                ))}
              </tr>
            )}
            <tr className="bg-slate-50">
              {measures.map((measure) => (
                <th key={`total-${measure}`} onClick={() => toggleSort('__total__', measure)} className="cursor-pointer border border-slate-200 bg-slate-200 px-3 py-2 text-right font-black hover:bg-blue-100">
                  {getMeasureLabel(measure)} {sortCell?.column === '__total__' && sortCell.measure === measure ? (sortCell.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              {pivot.columns.flatMap((column) => measures.map((measure) => (
                <th key={`${column.key}-${measure}`} onClick={() => toggleSort(column.key, measure)} className="cursor-pointer border border-slate-200 px-3 py-2 text-right font-black hover:bg-blue-50">
                  {getMeasureLabel(measure)} {sortCell?.column === column.key && sortCell.measure === measure ? (sortCell.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((row) => (
              <tr key={row.key} className={row.isSubtotal ? 'bg-slate-100 font-black' : 'hover:bg-slate-50'}>
                {rowDimensions.map((_dimension, index) => (
                  <td
                    key={`${row.key}-part-${index}`}
                    style={rowHeaderStyle(index)}
                    className={`sticky z-20 border border-slate-200 px-3 py-2 font-bold ${row.isSubtotal ? 'bg-slate-100' : 'bg-white'}`}
                  >
                    {row.parts[index] || (row.isSubtotal && index > 0 ? 'TOTAL' : '—')}
                  </td>
                ))}
                {measures.map((measure) => {
                  const value = measureValue(row.total, measure)
                  const previous = totalComparisonValue(row, measure)
                  return <td key={`${row.key}-total-${measure}`} className={`border border-slate-200 px-3 py-2 text-right ${row.isSubtotal ? 'bg-slate-100' : 'bg-slate-50'}`}><CellValue value={value} previous={previous} measure={measure} /></td>
                })}
                {pivot.columns.flatMap((column) => {
                  const agg = row.colMap.get(column.key) || emptyAgg()
                  return measures.map((measure) => {
                    const value = measureValue(agg, measure)
                    const previous = row.isSubtotal ? 0 : comparisonValue(row.key, column, measure)
                    return (
                      <td key={`${row.key}-${column.key}-${measure}`} className={`border border-slate-200 px-3 py-2 text-right ${row.isSubtotal ? 'bg-slate-100' : ''}`}>
                        <CellValue value={value} previous={previous} measure={measure} />
                      </td>
                    )
                  })
                })}
              </tr>
            ))}
            <tr className="bg-slate-200 font-black">
              {rowDimensions.map((_dimension, index) => (
                <td key={`grand-row-${index}`} style={rowHeaderStyle(index)} className="sticky z-20 border border-slate-200 bg-slate-200 px-3 py-2">
                  {index === 0 ? 'TOTAL GÉNÉRAL' : ''}
                </td>
              ))}
              {measures.map((measure) => {
                const currentGrand = aggregateTotal(periodRows)
                const previousGrand = aggregateTotal(previousPeriodRows)
                return <td key={`grand-total-${measure}`} className="border border-slate-200 bg-slate-200 px-3 py-2 text-right"><CellValue value={measureValue(currentGrand, measure)} previous={measureValue(previousGrand, measure)} measure={measure} /></td>
              })}
              {pivot.columns.flatMap((column) => {
                const agg = emptyAgg()
                periodRows.filter((r) => columnKey(columnPartsFor(r)) === column.key).forEach((r) => addToAgg(agg, r))
                return measures.map((measure) => <td key={`grand-${column.key}-${measure}`} className="border border-slate-200 bg-slate-200 px-3 py-2 text-right">{formatMeasure(measureValue(agg, measure), measure)}</td>)
              })}
            </tr>
          </tbody>
        </table>
      </div>
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
          <Pie data={data} dataKey="value" nameKey="label" outerRadius={115} label={(entry: any) => `${entry.label}`} isAnimationActive={false}> 
            {data.map((_entry, index) => <Cell key={`pie-${index}`} fill={PALETTE[index % PALETTE.length]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function SummaryMatrixWidget({ rows, widget, onUpdate }: { rows: StudioRow[]; widget: WidgetConfig; onUpdate?: (patch: Partial<WidgetConfig>) => void }) {
  const yearN = widget.yearN || CURRENT_YEAR
  const rawYearN1 = widget.yearN1 || yearN - 1
  const yearN1 = rawYearN1 === yearN ? yearN - 1 : rawYearN1
  const monthLimit = widget.bridgeMonth || CURRENT_MONTH
  const compact = widget.size === 'medium' || widget.size === 'small'

  const columns = [
    { key: 'mois', label: String(monthLimit).padStart(2, '0'), helper: monthLabel(monthLimit), filter: (row: StudioRow) => row.mois === monthLimit },
    { key: 'cumul', label: `01-${String(monthLimit).padStart(2, '0')}`, helper: 'Cumul année', filter: (row: StudioRow) => row.mois <= monthLimit },
    { key: 'total', label: 'Total', helper: 'Année complète chargée', filter: (_row: StudioRow) => true },
  ]

  const yearRows = Array.from(new Set([yearN1, yearN])).filter((year) => Number.isFinite(year))

  function valuesFor(year: number, column: typeof columns[number]) {
    const agg = aggregateTotal(rows.filter((row) => row.annee === year && column.filter(row)))
    return {
      ca: measureValue(agg, 'ca_ht'),
      margePct: measureValue(agg, 'marge_pct'),
    }
  }

  function DeltaBadge({ value, type }: { value: number; type: 'currency' | 'points' | 'percent' }) {
    const positive = value >= 0
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
        {type === 'currency' ? `${positive ? '+' : ''}${formatKCurrency(value)}` : type === 'percent' ? `${positive ? '+' : ''}${value.toFixed(1).replace('.', ',')} %` : `${positive ? '+' : ''}${value.toFixed(1).replace('.', ',')} pts`}
      </span>
    )
  }

  const valueFontSize = compact ? 'clamp(1.05rem, 2vw, 1.75rem)' : 'clamp(1.5rem, 2.4vw, 2.25rem)'
  const rateFontSize = compact ? 'clamp(0.95rem, 1.6vw, 1.35rem)' : 'clamp(1.25rem, 2vw, 1.8rem)'
  const labelFontSize = compact ? 'clamp(1.15rem, 2vw, 1.8rem)' : 'clamp(1.6rem, 2.5vw, 2.5rem)'
  const cellPadding = compact ? 'px-3 py-4' : 'px-5 py-5'
  const gridTemplateColumns = compact
    ? 'minmax(88px, 0.65fr) repeat(3, minmax(112px, 1fr))'
    : 'minmax(140px, 0.7fr) repeat(3, minmax(180px, 1fr))'


  return (
    <div className={`rounded-[2rem] border-4 border-slate-900 bg-white ${compact ? 'p-4' : 'p-6'} shadow-sm overflow-hidden`}>
      <div className={`${compact ? 'mb-4' : 'mb-6'} flex flex-wrap items-start justify-between gap-4`}>
        <div>
          <h3 className={`${compact ? 'text-xl' : 'text-2xl'} font-black uppercase tracking-tight text-slate-900`}>Suivi du CA et marge</h3>
          <p className="mt-1 text-sm font-semibold text-slate-600">Facturation + activité selon les filtres et types de documents sélectionnés.</p>
        </div>
        {onUpdate && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onUpdate({ bridgeMonth: Math.max(1, monthLimit - 1) })} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black hover:bg-slate-50">Mois -</button>
            <button type="button" onClick={() => onUpdate({ bridgeMonth: Math.min(12, monthLimit + 1) })} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-black hover:bg-slate-50">Mois +</button>
          </div>
        )}
      </div>

      <div className={`grid ${compact ? 'gap-3' : 'gap-4'}`} style={{ gridTemplateColumns }}>
        <div />
        {columns.map((column) => (
          <div key={column.key} className={`rounded-2xl bg-cyan-700 ${compact ? 'px-3 py-3' : 'px-5 py-4'} text-center font-black text-white`}>
            <div style={{ fontSize: labelFontSize, lineHeight: 1.05 }}>{column.label}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-cyan-100">{column.helper}</div>
          </div>
        ))}

        {yearRows.map((year) => (
          <div key={`row-${year}`} className="contents">
            <div className={`flex items-center justify-center rounded-2xl bg-cyan-700 ${compact ? 'px-3 py-4' : 'px-5 py-6'} font-black text-white`} style={{ fontSize: labelFontSize, lineHeight: 1 }}>
              {year}
            </div>
            {columns.map((column) => {
              const values = valuesFor(year, column)
              return (
                <div key={`${year}-${column.key}`} className={`min-w-0 rounded-2xl border border-orange-300 bg-slate-100 ${cellPadding} text-center`}>
                  <div className="truncate font-black text-slate-900" style={{ fontSize: valueFontSize, lineHeight: 1.05 }}>{formatKCurrency(values.ca)}</div>
                  <div className="mt-2 truncate font-black text-slate-900" style={{ fontSize: rateFontSize, lineHeight: 1.05 }}>{formatRate(values.margePct)}</div>
                </div>
              )
            })}
          </div>
        ))}

        <div className={`flex items-center justify-center rounded-2xl bg-cyan-700 ${compact ? 'px-3 py-3 text-base' : 'px-5 py-4 text-lg'} font-black text-white`}>CA vs N-1</div>
        {columns.map((column) => {
          const current = valuesFor(yearN, column)
          const previous = valuesFor(yearN1, column)
          const delta = current.ca - previous.ca
          const pct = previous.ca ? (delta / Math.abs(previous.ca)) * 100 : 0
          return (
            <div key={`delta-ca-${column.key}`} className={`min-w-0 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-orange-300 bg-orange-50 ${compact ? 'px-3 py-3 text-base' : 'px-5 py-4 text-xl'} font-black text-slate-900`}>
              <span className="truncate">{formatKCurrency(delta)}</span>
              <DeltaBadge value={pct} type="percent" />
            </div>
          )
        })}

        <div className={`flex items-center justify-center rounded-2xl bg-cyan-700 ${compact ? 'px-3 py-3 text-base' : 'px-5 py-4 text-lg'} font-black text-white`}>Marge vs N-1</div>
        {columns.map((column) => {
          const current = valuesFor(yearN, column)
          const previous = valuesFor(yearN1, column)
          return (
            <div key={`delta-marge-${column.key}`} className={`flex items-center justify-center rounded-2xl border border-orange-300 bg-orange-50 ${compact ? 'px-3 py-3' : 'px-5 py-4'}`}>
              <DeltaBadge value={current.margePct - previous.margePct} type="points" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WidgetRenderer({ rows, widget, onUpdate }: { rows: StudioRow[]; widget: WidgetConfig; onUpdate?: (patch: Partial<WidgetConfig>) => void }) {
  if (widget.type === 'kpi') return <KpiWidget rows={rows} widget={widget} />
  if (widget.type === 'bridge') return <BridgeWidget rows={rows} widget={widget} onUpdate={onUpdate} />
  if (widget.type === 'double_bridge') return <DoubleBridgeWidget rows={rows} widget={widget} onUpdate={onUpdate} />
  if (widget.type === 'tableau') return <PivotTableWidget rows={rows} widget={widget} />
  if (widget.type === 'synthese') return <SummaryMatrixWidget rows={rows} widget={widget} onUpdate={onUpdate} />
  if (widget.type === 'camembert') return <PieWidget rows={rows} widget={widget} />
  return <ChartWidget rows={rows} widget={widget} onUpdate={onUpdate} />
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
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [configPanelTop, setConfigPanelTop] = useState(120)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiWidgetProposals, setAiWidgetProposals] = useState<AiWidgetProposal[]>([])
  const [showClientFilters, setShowClientFilters] = useState(false)
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null)
  const [showMaintenancePanel, setShowMaintenancePanel] = useState(false)
  const [widgetDraft, setWidgetDraft] = useState<WidgetConfig | null>(null)
  const aiTextareaRef = useRef<HTMLTextAreaElement | null>(null)


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
        setMaintenanceMessage(`Application BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} sur l’agrégat activité…`)
        const { error: modeError } = await supabase.rpc('set_bl_mx_mode', { p_mode: blMxMode })
        if (modeError) throw new Error(`set_bl_mx_mode : ${modeError.message}`)

        const { error: applyError } = await supabase.rpc('apply_bl_mx_month_mode_activite', {
          p_mode: blMxMode,
          p_months_back: monthCount,
        })
        if (applyError) throw new Error(`apply_bl_mx_month_mode_activite : ${applyError.message}`)

        setMaintenanceMessage('Mode BL M-x appliqué. Rechargement de l’atelier…')
        await loadData(globalFilters)
        setMaintenanceMessage(`BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} appliqué.`)
        return
      }

      const periods = getRecentMonthPeriods(monthCount)
      await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, 'Cache factures')
      await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, 'Agrégat factures')
      await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, 'Cache devis')
      await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, 'Agrégat devis')
      await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, 'Agrégat activité')
      await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', periods, 'Flux articles')
      setMaintenanceMessage('Rebuild terminé. Rechargement de l’atelier…')
      await loadData(globalFilters)
      setMaintenanceMessage(`Rebuild ${monthCount} mois terminé.`)
    } catch (exception: any) {
      setError(`Rebuild impossible : ${exception?.message || exception}`)
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  async function loadData(filtersOverride?: GlobalFilters) {
    const filtersForLoad = filtersOverride || globalFilters
    const yearsToLoad = yearsForAtelierLoad(filtersForLoad.years)
    const widgetSources = widgets.map((widget) => widget.source)
    const sourcesToLoad = sourcesForAtelierLoad(filtersForLoad.sources, widgetSources)

    setLoading(true)
    setError(null)
    try {
      const promises: Array<Promise<StudioRow[]>> = []
      if (sourcesToLoad.includes('factures')) {
        promises.push(fetchAllRows(FACTURES_TABLE, 'factures', 2500, yearsToLoad, filtersForLoad.horsStatistique))
      }
      if (sourcesToLoad.includes('activite')) {
        promises.push(fetchAllRows(
          ACTIVITE_TABLE,
          'activite',
          2500,
          yearsToLoad,
          filtersForLoad.horsStatistique,
          documentTypesForSourceLoad('activite', filtersForLoad, widgets)
        ))
      }
      if (sourcesToLoad.includes('devis')) {
        promises.push(fetchAllRows(DEVIS_TABLE, 'devis', 2500, yearsToLoad, filtersForLoad.horsStatistique))
      }
      if (sourcesToLoad.includes('flux_articles')) {
        promises.push(fetchAllRows(
          FLUX_ARTICLES_TABLE,
          'flux_articles',
          2500,
          yearsToLoad,
          filtersForLoad.horsStatistique,
          documentTypesForSourceLoad('flux_articles', filtersForLoad, widgets)
        ))
      }

      const loaded = (await Promise.all(promises)).flat()
      setRows(loaded)

      const years = uniqueSorted(loaded.map((r) => r.annee)).sort((a, b) => Number(b) - Number(a))
      setGlobalFilters((prev) => ({
        ...prev,
        years: prev.years.length ? prev.years : years.slice(0, 2).map(Number),
      }))
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
    loadSavedViews()
  }, [])

  const widgetSourcesKey = useMemo(
    () => JSON.stringify(uniqueSorted(widgets.map((widget) => widget.source))),
    [widgets]
  )

  useEffect(() => {
    loadData(globalFilters)
    // Le chargement serveur est recalé seulement quand le périmètre volumétrique change.
    // Les autres filtres restent appliqués instantanément côté navigateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(globalFilters.sources),
    JSON.stringify(globalFilters.years),
    globalFilters.horsStatistique,
    widgetSourcesKey,
  ])

  const available = useMemo(() => {
    return {
      years: uniqueSorted(rows.map((r) => r.annee)).sort((a, b) => Number(b) - Number(a)).map(Number),
      months: Array.from({ length: 12 }, (_v, i) => i + 1),
      agences: uniqueSorted(rows.map((r) => r.agence_collaborateur)),
      depots: uniqueSorted(rows.map((r) => r.depot)),
      collaborateurs: uniqueSorted(rows.map((r) => r.collaborateur_facture || r.collaborateur)),
      collaborateursFacture: uniqueSorted(rows.map((r) => r.collaborateur_facture)),
      collaborateursTiers: uniqueSorted(rows.map((r) => r.collaborateur_tiers)),
      departementsTiers: uniqueSorted(rows.map((r) => r.departement_tiers)),
      famillesMacro: uniqueSorted(rows.map((r) => r.famille_macro)),
      typesDocument: uniqueSorted([
        ...rows.map((r) => r.type_document),
        ...globalFilters.sources.flatMap((source) => DOCUMENT_TYPES_BY_SOURCE[source] || []),
        ...widgets.flatMap((widget) => DOCUMENT_TYPES_BY_SOURCE[widget.source] || []),
        ...(widgetDraft ? (DOCUMENT_TYPES_BY_SOURCE[widgetDraft.source] || []) : []),
      ]),
      clients: uniqueSorted(rows.map((r) => clientKey(r))),
    }
  }, [rows, globalFilters.sources, widgets, widgetDraft])

  const selectedWidget = selectedWidgetId ? widgets.find((w) => w.id === selectedWidgetId) || null : null

  useEffect(() => {
    setWidgetDraft(selectedWidget ? JSON.parse(JSON.stringify(selectedWidget)) : null)
  }, [selectedWidgetId])

  function updateWidget(id: string, patch: Partial<WidgetConfig>) {
    setWidgets((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w))
  }

  function updateWidgetDraft(patch: Partial<WidgetConfig>) {
    setWidgetDraft((current) => current ? { ...current, ...patch } : current)
  }

  function applyWidgetDraft() {
    if (!widgetDraft) return
    updateWidget(widgetDraft.id, widgetDraft)
    setSelectedWidgetId(null)
    setSaveMessage(`Paramétrage appliqué : ${widgetDraft.title}`)
  }

  function addWidget(type: WidgetType) {
    const widget = buildDefaultWidget(type, available.years)
    setWidgets((prev) => [...prev, widget])
    setSelectedWidgetId(widget.id)
    setAddMenuOpen(false)
    setConfigPanelTop(120)
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
    setGlobalFilters({ ...DEFAULT_FILTERS, ...(view.global_filters || {}) })
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

  const widgetCatalog: Array<[WidgetType, string, string]> = [
    ['kpi', 'KPI', 'Indicateur simple'],
    ['histogramme', 'Histogramme', 'Barres verticales'],
    ['histogramme_empile', 'Histogramme empilé', 'Valeur ou base 100'],
    ['courbe', 'Courbe', 'Évolution mensuelle ou cumulée'],
    ['bridge', 'Bridge', 'Écart N-1 ⇒ N'],
    ['double_bridge', 'Double bridge', 'Mix puis performance'],
    ['tableau', 'Tableau croisé', 'Lignes / colonnes / valeurs'],
    ['synthese', 'Tableau synthèse', 'Mois + cumul + total'],
    ['camembert', 'Camembert', 'Répartition'],
  ]

  function openWidgetConfig(widgetId: string, event: any) {
    const section = event?.currentTarget?.closest?.('section') as HTMLElement | null
    const rect = section?.getBoundingClientRect?.()
    const top = rect ? Math.min(Math.max(16, rect.top), Math.max(16, window.innerHeight - 260)) : 120
    setConfigPanelTop(top)
    setSelectedWidgetId(widgetId)
  }

  function isWidgetType(value: any): value is WidgetType {
    return widgetCatalog.some(([type]) => type === value)
  }

  function isMeasureKey(value: any): value is MeasureKey {
    return MEASURES.some((measure) => measure.key === value)
  }

  function isDimensionKey(value: any): value is DimensionKey {
    return DIMENSIONS.some((dimension) => dimension.key === value)
  }

  function isDataSource(value: any): value is DataSource {
    return value === 'factures' || value === 'activite' || value === 'devis' || value === 'flux_articles' || value === 'mixte'
  }

  function isSizeKey(value: any): value is SizeKey {
    return value === 'small' || value === 'medium' || value === 'large' || value === 'full'
  }

  function isPeriodMode(value: any): value is PeriodMode {
    return value === 'mois' || value === 'cumul'
  }

  function isCompareMode(value: any): value is CompareMode {
    return value === 'year' || value === 'month' || value === 'dimension'
  }

  function isEvolutionMode(value: any): value is EvolutionMode {
    return value === 'none' || value === 'value' || value === 'percent' || value === 'both'
  }

  function isSortMode(value: any): value is SortMode {
    return value === 'label_asc' || value === 'value_desc' || value === 'value_asc'
  }

  function sanitizeWidgetFilters(value: any): WidgetFilters {
    const input = value && typeof value === 'object' ? value : {}
    const filters: WidgetFilters = {}

    if (Array.isArray(input.years)) filters.years = input.years.map(Number).filter((v: number) => Number.isFinite(v))
    if (Array.isArray(input.months)) filters.months = input.months.map(Number).filter((v: number) => Number.isFinite(v) && v >= 1 && v <= 12)
    if (Array.isArray(input.depots)) filters.depots = input.depots.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.agences)) filters.agences = input.agences.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.collaborateurs)) filters.collaborateurs = input.collaborateurs.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.collaborateursFacture)) filters.collaborateursFacture = input.collaborateursFacture.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.collaborateursTiers)) filters.collaborateursTiers = input.collaborateursTiers.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.departementsTiers)) filters.departementsTiers = input.departementsTiers.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.famillesMacro)) filters.famillesMacro = input.famillesMacro.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.typesDocument)) filters.typesDocument = input.typesDocument.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (Array.isArray(input.clients)) filters.clients = input.clients.map((v: any) => String(v || '').trim()).filter(Boolean)
    if (input.clientMode === 'include' || input.clientMode === 'exclude') filters.clientMode = input.clientMode
    if (input.horsStatistique === 'non' || input.horsStatistique === 'oui' || input.horsStatistique === 'tous') filters.horsStatistique = input.horsStatistique

    return filters
  }

  function getActiveTemporalContext() {
    const selectedYears = (globalFilters.years || [])
      .map(Number)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
    const selectedMonths = (globalFilters.months || [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= 12)
      .sort((a, b) => a - b)

    const fallbackYearN = selectedWidget?.yearN || available.years[0] || CURRENT_YEAR
    const yearN = selectedYears.length ? selectedYears[selectedYears.length - 1] : fallbackYearN
    const yearN1 = selectedYears.length >= 2 ? selectedYears[selectedYears.length - 2] : (selectedWidget?.yearN1 || yearN - 1)
    const bridgeMonth = selectedMonths.length
      ? Math.max(...selectedMonths)
      : (selectedWidget?.bridgeMonth || Math.max(1, Math.min(12, CURRENT_MONTH)))
    const periodMode: PeriodMode = selectedMonths.length === 1 ? 'mois' : (selectedMonths.length > 1 ? 'cumul' : (selectedWidget?.periodMode || 'cumul'))

    return {
      selectedYears,
      selectedMonths,
      yearN,
      yearN1,
      bridgeMonth,
      periodMode,
      periodLabel: periodMode === 'cumul' ? `01-${String(bridgeMonth).padStart(2, '0')}` : monthLabel(bridgeMonth),
    }
  }

  function applyActiveTemporalContextToAiWidget(widget: WidgetConfig): WidgetConfig {
    const context = getActiveTemporalContext()
    const localFilters = { ...(widget.localFilters || {}) }

    // La période et les années doivent venir des filtres globaux de la vue active.
    // On retire donc d'éventuels filtres temporels locaux proposés par l'IA qui pourraient contredire la sélection écran.
    delete localFilters.years
    delete localFilters.months

    return {
      ...widget,
      localFilters,
      yearN: context.yearN,
      yearN1: context.yearN1,
      bridgeMonth: context.bridgeMonth,
      periodMode: context.periodMode,
    }
  }

  function buildWidgetFromAiProposal(proposal: AiWidgetProposal): WidgetConfig {
    const type = isWidgetType(proposal?.type) ? proposal.type : 'tableau'
    const base = buildDefaultWidget(type, available.years)
    let next: WidgetConfig = {
      ...base,
      id: uid(),
      title: String(proposal?.title || base.title || 'Widget IA').slice(0, 90),
    }

    if (isDataSource(proposal?.source)) next.source = proposal.source
    if (isSizeKey(proposal?.size)) next.size = proposal.size
    if (typeof proposal?.useGlobalFilters === 'boolean') next.useGlobalFilters = proposal.useGlobalFilters
    if (isMeasureKey(proposal?.measure)) next.measure = proposal.measure
    if (isMeasureKey(proposal?.secondMeasure)) next.secondMeasure = proposal.secondMeasure

    if (Array.isArray(proposal?.tableMeasures)) {
      const measures = proposal.tableMeasures.filter(isMeasureKey)
      if (measures.length) next.tableMeasures = measures
    }

    if (isDimensionKey(proposal?.dimension)) next.dimension = proposal.dimension
    if (proposal?.seriesDimension === '' || isDimensionKey(proposal?.seriesDimension)) next.seriesDimension = proposal.seriesDimension
    if (isDimensionKey(proposal?.rowDimension)) next.rowDimension = proposal.rowDimension
    if (proposal?.rowDimension2 === '' || isDimensionKey(proposal?.rowDimension2)) next.rowDimension2 = proposal.rowDimension2
    if (isDimensionKey(proposal?.columnDimension)) next.columnDimension = proposal.columnDimension
    if (proposal?.columnDimension2 === '' || isDimensionKey(proposal?.columnDimension2)) next.columnDimension2 = proposal.columnDimension2
    if (isPeriodMode(proposal?.periodMode)) next.periodMode = proposal.periodMode

    const bridgeMonth = Number(proposal?.bridgeMonth)
    if (Number.isFinite(bridgeMonth)) next.bridgeMonth = Math.max(1, Math.min(12, bridgeMonth))

    const yearN = Number(proposal?.yearN)
    const yearN1 = Number(proposal?.yearN1)
    if (Number.isFinite(yearN)) next.yearN = yearN
    if (Number.isFinite(yearN1)) next.yearN1 = yearN1
    if (isCompareMode(proposal?.compareMode)) next.compareMode = proposal.compareMode
    if (proposal?.compareDimension === '' || isDimensionKey(proposal?.compareDimension)) next.compareDimension = proposal.compareDimension
    if (typeof proposal?.compareValue === 'string') next.compareValue = proposal.compareValue
    if (isEvolutionMode(proposal?.evolutionMode)) next.evolutionMode = proposal.evolutionMode
    if (typeof proposal?.stacked100 === 'boolean') next.stacked100 = proposal.stacked100

    const topN = Number(proposal?.topN)
    if (Number.isFinite(topN)) next.topN = Math.max(1, Math.min(50, Math.round(topN)))
    if (isSortMode(proposal?.sortMode)) next.sortMode = proposal.sortMode
    if (typeof proposal?.showValues === 'boolean') next.showValues = proposal.showValues

    const localFilters = sanitizeWidgetFilters(proposal?.localFilters)
    if (Object.keys(localFilters).length) next.localFilters = localFilters

    // Les widgets proposés par l'IA doivent hériter de la période active de la vue.
    // Exemple : filtres globaux 01-04 + années 2025/2026 => bridge 01-04, N-1=2025, N=2026.
    next = applyActiveTemporalContextToAiWidget(next)

    return next
  }

  function applyAiWidgetProposal(proposal: AiWidgetProposal) {
    const widget = buildWidgetFromAiProposal(proposal)
    setWidgets((prev) => [...prev, widget])
    setSelectedWidgetId(widget.id)
    setSaveMessage(`Widget IA ajouté : ${widget.title}`)
  }

  function applyAllAiWidgetProposals() {
    if (!aiWidgetProposals.length) return
    const nextWidgets = aiWidgetProposals.map((proposal) => buildWidgetFromAiProposal(proposal))
    setWidgets((prev) => [...prev, ...nextWidgets])
    setSelectedWidgetId(nextWidgets[0]?.id || null)
    setSaveMessage(`${nextWidgets.length} widget(s) IA ajouté(s). Pense à enregistrer la vue.`)
  }

  async function askAtelierAi(presetQuestion?: string) {
    const question = String(presetQuestion ?? aiTextareaRef.current?.value ?? aiQuestion ?? '').trim()

    if (!question) {
      setAiError('Saisis une question pour l’assistant IA.')
      return
    }

    setAiLoading(true)
    setAiError(null)
    setAiAnswer(null)
    setAiWidgetProposals([])

    try {
      const payload = {
        question,
        currentViewName: viewName,
        globalFilters,
        selectedWidget,
        widgets: widgets.map((widget) => ({
          id: widget.id,
          title: widget.title,
          type: widget.type,
          source: widget.source,
          measure: widget.measure,
          secondMeasure: widget.secondMeasure,
          tableMeasures: widget.tableMeasures,
          dimension: widget.dimension,
          seriesDimension: widget.seriesDimension,
          rowDimension: widget.rowDimension,
          rowDimension2: widget.rowDimension2,
          columnDimension: widget.columnDimension,
          columnDimension2: widget.columnDimension2,
          periodMode: widget.periodMode,
          bridgeMonth: widget.bridgeMonth,
          yearN: widget.yearN,
          yearN1: widget.yearN1,
          compareMode: widget.compareMode,
          evolutionMode: widget.evolutionMode,
          localFilters: widget.localFilters,
          useGlobalFilters: widget.useGlobalFilters,
        })),
        dataContext: {
          rowCount: rows.length,
          years: available.years,
          months: available.months,
          activeTemporalContext: getActiveTemporalContext(),
          agencesCount: available.agences.length,
          depotsCount: available.depots.length,
          collaborateursCount: available.collaborateurs.length,
          collaborateursFactureCount: available.collaborateursFacture.length,
          collaborateursTiersCount: available.collaborateursTiers.length,
          departementsTiers: available.departementsTiers,
          famillesMacroCount: available.famillesMacro.length,
          typesDocument: available.typesDocument,
          clientsCount: available.clients.length,
        },
        versions: {
          front: ATELIER_FRONT_VERSION,
          ai: ATELIER_AI_VERSION,
        },
      }

      const response = await fetch('/api/atelier-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.error || `Erreur API Atelier IA (${response.status})`)
      }

      setAiQuestion(question)
      setAiAnswer(data?.answer || 'Réponse vide.')
      const proposals = Array.isArray(data?.proposed_widgets) ? data.proposed_widgets : Array.isArray(data?.proposedWidgets) ? data.proposedWidgets : []
      setAiWidgetProposals(proposals)
    } catch (e: any) {
      setAiError(e?.message || String(e))
    } finally {
      setAiLoading(false)
    }
  }



  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[2100px] space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-black tracking-tight">Atelier d’analyse</h1>
                <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">Version front : {ATELIER_FRONT_VERSION}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">Créez vos propres widgets à partir des indicateurs factures et activité.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={viewName} onChange={(e) => setViewName(e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none focus:border-blue-500" />
              <button type="button" onClick={saveView} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700">Enregistrer la vue</button>
              <button type="button" onClick={duplicateCurrentView} disabled={!widgets.length} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Dupliquer la vue</button>
              <button type="button" onClick={() => { setCurrentViewId(null); setViewName('Nouvelle vue'); setWidgets([]); setSelectedWidgetId(null); setSaveMessage(null) }} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50">Nouvelle vue</button>
              <button type="button" onClick={() => setShowMaintenancePanel((value) => !value)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50">Actions techniques {showMaintenancePanel ? '▲' : '▼'}</button>
              <button type="button" onClick={() => loadData(globalFilters)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black hover:bg-slate-50">Actualiser</button>
            </div>
          </div>
          {showMaintenancePanel && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Actions techniques — masquées par défaut</div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => handleRebuildRecentMonths(2)} disabled={maintenanceLoading} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">{maintenanceLoading ? 'Rebuild…' : 'Rebuild 2 mois'}</button>
                <button type="button" onClick={() => handleRebuildRecentMonths(3)} disabled={maintenanceLoading} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">{maintenanceLoading ? 'Rebuild…' : 'Rebuild 3 mois'}</button>
                <button type="button" onClick={() => handleRebuildRecentMonths(3, 'previous_month')} disabled={maintenanceLoading} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60">BL M-x → M-1 (léger)</button>
                <button type="button" onClick={() => handleRebuildRecentMonths(3, 'current_month')} disabled={maintenanceLoading} className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-black text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60">BL M-x → M (léger)</button>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">Les boutons BL M-x ne relancent plus les rebuilds lourds : ils déplacent uniquement les lignes BL/BR concernées dans l’agrégat activité.</p>
            </div>
          )}
          {saveMessage && <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-700">{saveMessage}</div>}
          {maintenanceMessage && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{maintenanceMessage}</div>}
          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        </section>

        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-10">
          <MultiSelect label="Source" values={['factures', 'activite', 'devis', 'flux_articles', 'mixte']} selected={globalFilters.sources} onChange={(v) => setGlobalFilters((p) => ({ ...p, sources: v as DataSource[] }))} />
          <MultiSelect label="Année" values={available.years.map(String)} selected={globalFilters.years.map(String)} onChange={(v) => setGlobalFilters((p) => ({ ...p, years: v.map(Number) }))} />
          <MultiSelect label="Mois" values={available.months.map((m) => `${m} - ${monthLabel(m)}`)} selected={globalFilters.months.map((m) => `${m} - ${monthLabel(m)}`)} onChange={(v) => setGlobalFilters((p) => ({ ...p, months: v.map((x) => Number(x.split(' - ')[0])) }))} />
          <MultiSelect label="Agence" values={available.agences} selected={globalFilters.agences} onChange={(v) => setGlobalFilters((p) => ({ ...p, agences: v }))} />
          <MultiSelect label="Dépôt" values={available.depots} selected={globalFilters.depots || []} onChange={(v) => setGlobalFilters((p) => ({ ...p, depots: v }))} />
          <MultiSelect label="Collab. facture" values={available.collaborateursFacture} selected={globalFilters.collaborateursFacture || []} onChange={(v) => setGlobalFilters((p) => ({ ...p, collaborateursFacture: v, collaborateurs: v }))} />
          <MultiSelect label="Collab. tiers" values={available.collaborateursTiers} selected={globalFilters.collaborateursTiers || []} onChange={(v) => setGlobalFilters((p) => ({ ...p, collaborateursTiers: v }))} />
          <MultiSelect label="Dépt tiers" values={available.departementsTiers} selected={globalFilters.departementsTiers || []} onChange={(v) => setGlobalFilters((p) => ({ ...p, departementsTiers: v }))} />
          <MultiSelect label="Famille macro" values={available.famillesMacro} selected={globalFilters.famillesMacro} onChange={(v) => setGlobalFilters((p) => ({ ...p, famillesMacro: v }))} />
          <MultiSelect label="Type document" values={relevantDocumentTypes(globalFilters.sources.includes('mixte') || globalFilters.sources.length !== 1 ? 'mixte' : globalFilters.sources[0], available.typesDocument)} selected={globalFilters.typesDocument} onChange={(v) => setGlobalFilters((p) => ({ ...p, typesDocument: v }))} />
          <FilterSelect
            label="Hors statistique"
            value={globalFilters.horsStatistique}
            onChange={(v) => setGlobalFilters((p) => ({ ...p, horsStatistique: v as GlobalFilters['horsStatistique'] }))}
            options={[{ value: 'non', label: 'Exclu' }, { value: 'oui', label: 'Uniquement' }, { value: 'tous', label: 'Tous' }]}
          />

          <button
            type="button"
            onClick={() => setShowClientFilters((value) => !value)}
            className={`flex h-11 items-center justify-between rounded-xl border px-3 text-sm font-black shadow-sm ${showClientFilters ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}
          >
            <span>Tiers {globalFilters.clients?.length ? `(${globalFilters.clients.length})` : ''}</span>
            <span>{showClientFilters ? '▲' : '▼'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAiPanel((value) => !value)}
            className={`flex h-11 items-center justify-between rounded-xl border px-3 text-sm font-black shadow-sm ${showAiPanel ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}
          >
            <span>Contexte IA {aiWidgetProposals.length ? `(${aiWidgetProposals.length})` : ''}</span>
            <span>{showAiPanel ? '▲' : '▼'}</span>
          </button>

          {showClientFilters && (
            <div className="md:col-span-2 xl:col-span-10 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Filtre clients / tiers</span>
                  <select value={globalFilters.clientMode} onChange={(e) => setGlobalFilters((p) => ({ ...p, clientMode: e.target.value as ClientFilterMode }))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
                    <option value="include">Sélectionner uniquement</option>
                    <option value="exclude">Exclure les clients</option>
                  </select>
                </label>
                <MultiSelect label="Numéro tiers / nom client" values={available.clients} selected={globalFilters.clients || []} onChange={(v) => setGlobalFilters((p) => ({ ...p, clients: v }))} />
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">Laissez vide pour afficher tous les clients. Utilisez la recherche pour sélectionner ou exclure plusieurs clients.</p>
            </div>
          )}

          {showAiPanel && (
            <div className="md:col-span-2 xl:col-span-10 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
                <div className="xl:w-72">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900">Assistant IA Atelier</h2>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-indigo-700">{ATELIER_AI_VERSION}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Les widgets proposés héritent maintenant de la période active : {getActiveTemporalContext().periodLabel} · {getActiveTemporalContext().yearN1} → {getActiveTemporalContext().yearN}.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => askAtelierAi('Analyse la vue active et dis-moi les points d’attention à regarder en priorité.')} className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100">Analyser la vue</button>
                    <button type="button" onClick={() => askAtelierAi('Explique les filtres actuellement appliqués et leur impact probable sur les widgets.')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50">Expliquer les filtres</button>
                    <button type="button" onClick={() => askAtelierAi('Propose 2 ou 3 widgets complémentaires applicables pour mieux comprendre cette vue.')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50">Proposer des widgets</button>
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  <textarea
                    ref={aiTextareaRef}
                    defaultValue={aiQuestion}
                    placeholder="Ex : Pourquoi le CA baisse-t-il par rapport à N-1 ? Quels widgets ajouter pour expliquer l’écart ?"
                    className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold outline-none focus:border-indigo-500"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => askAtelierAi()} disabled={aiLoading} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                      {aiLoading ? 'Analyse en cours…' : 'Envoyer à l’assistant IA'}
                    </button>
                    <button type="button" onClick={() => { if (aiTextareaRef.current) aiTextareaRef.current.value = ''; setAiQuestion(''); setAiAnswer(null); setAiError(null); setAiWidgetProposals([]) }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">Effacer</button>
                    <span className="text-xs font-semibold text-slate-500">Contexte transmis : vue, filtres, widgets + période active.</span>
                  </div>
                  {aiError && <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{aiError}</div>}
                  {aiAnswer && (
                    <div className="rounded-xl border border-indigo-100 bg-white p-3">
                      <div className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-700">Réponse de l’assistant</div>
                      <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{aiAnswer}</div>
                    </div>
                  )}
                  {aiWidgetProposals.length > 0 && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Widgets proposés par l’IA</div>
                          <p className="mt-1 text-xs font-semibold text-emerald-800">Application avec période active : {getActiveTemporalContext().periodLabel} · {getActiveTemporalContext().yearN1} → {getActiveTemporalContext().yearN}.</p>
                        </div>
                        <button type="button" onClick={applyAllAiWidgetProposals} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700">
                          Appliquer toutes les propositions
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        {aiWidgetProposals.map((proposal, index) => (
                          <div key={`${proposal.title || 'proposal'}-${index}`} className="rounded-xl border border-emerald-200 bg-white p-3 shadow-sm">
                            <div className="text-sm font-black text-slate-900">{proposal.title || `Widget proposé ${index + 1}`}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {proposal.type || 'tableau'} · {proposal.source || 'factures'} · {proposal.measure || 'ca_ht'} · {getActiveTemporalContext().periodLabel}
                            </div>
                            {proposal.rationale && <div className="mt-2 text-xs leading-5 text-slate-600">{proposal.rationale}</div>}
                            <button type="button" onClick={() => applyAiWidgetProposal(proposal)} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800">
                              Ajouter ce widget
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative">
              <button type="button" onClick={() => setAddMenuOpen((v) => !v)} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800">+ Ajouter un widget</button>
              {addMenuOpen && (
                <div className="absolute left-0 top-14 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                  <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Bibliothèque de widgets</div>
                  <div className="space-y-2">
                    {widgetCatalog.map(([type, label, helper]) => (
                      <button key={type} type="button" onClick={() => addWidget(type)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50">
                        <span><span className="block text-sm font-black text-slate-900">+ {label}</span><span className="block text-xs text-slate-500">{helper}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Vues enregistrées</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {savedViews.length === 0 && <div className="whitespace-nowrap rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Aucune vue enregistrée</div>}
                {savedViews.map((view) => (
                  <button key={view.id} type="button" onClick={() => loadView(view)} className={`min-w-[150px] rounded-xl border px-3 py-2 text-left text-xs hover:bg-slate-50 ${currentViewId === view.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                    <span className="block truncate font-black">{view.name}</span>
                    <span className="block truncate text-[10px] text-slate-500">{view.updated_at ? new Date(view.updated_at).toLocaleDateString('fr-FR') : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="max-w-[900px] truncate text-lg font-black">{viewName?.trim() || 'Vue sans nom'}</h2>
              <p className="text-sm text-slate-500">{loading ? 'Chargement des données…' : `${formatNumber(rows.length)} lignes agrégées chargées`}</p>
            </div>
            <div className="text-xs font-bold text-slate-500">Cliquez sur la roue dentée d’un widget pour le configurer.</div>
          </div>
          {widgets.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center">
              <div className="text-xl font-black text-slate-700">Ajoutez votre premier widget</div>
              <p className="mt-2 text-sm text-slate-500">Utilisez le bouton « Ajouter un widget » au-dessus de la page.</p>
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
                    onConfigure={(event) => openWidgetConfig(widget.id, event)}
                    onRemove={() => removeWidget(widget.id)}
                    onDuplicate={() => duplicateWidget(widget)}
                    onMove={(direction) => moveWidget(widget.id, direction)}
                  >
                    <WidgetRenderer rows={widgetRows} widget={widget} onUpdate={(patch) => updateWidget(widget.id, patch)} />
                  </WidgetShell>
                )
              })}
            </div>
          )}
        </section>

        {widgetDraft && widgetDraft && (
          <aside
            className="fixed right-6 z-50 w-[390px] overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            style={{ top: `${configPanelTop}px`, maxHeight: `calc(100vh - ${configPanelTop + 24}px)` }}
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Configurer le widget</h2>
                  <p className="text-xs text-slate-500">{widgetDraft.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={applyWidgetDraft} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-700">OK</button>
                  <button type="button" onClick={() => setWidgetDraft(selectedWidget ? JSON.parse(JSON.stringify(selectedWidget)) : null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black hover:bg-slate-50">Annuler</button>
                  <button type="button" onClick={() => setSelectedWidgetId(null)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-black hover:bg-slate-50">×</button>
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Titre</span>
                <input value={widgetDraft.title} onChange={(e) => updateWidgetDraft({ title: e.target.value })} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Type" value={widgetDraft.type} onChange={(v) => updateWidgetDraft({ type: v as WidgetType })} options={widgetCatalog.map(([value, label]) => ({ value, label }))} />
                <SelectField label="Taille" value={widgetDraft.size} onChange={(v) => updateWidgetDraft({ size: v as SizeKey })} options={[
                  { value: 'small', label: 'Petit' },
                  { value: 'medium', label: 'Moyen' },
                  { value: 'large', label: 'Large' },
                  { value: 'full', label: 'Pleine largeur' },
                ]} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Source" value={widgetDraft.source} onChange={(v) => updateWidgetDraft({ source: v as DataSource, localFilters: { ...widgetDraft.localFilters, typesDocument: [] } })} options={[
                  { value: 'factures', label: 'Factures' },
                  { value: 'activite', label: 'Activité' },
                  { value: 'devis', label: 'Devis' },
                  { value: 'flux_articles', label: 'Flux articles' },
                  { value: 'mixte', label: 'Mixte' },
                ]} />
                <SelectField
                  label="Valeur"
                  value={widgetDraft.measure}
                  onChange={(v) => updateWidgetDraft({ measure: v as MeasureKey })}
                  options={(widgetDraft.type === 'double_bridge' ? MEASURES.filter((m) => ['ca_ht', 'marge_valeur', 'marge_pct'].includes(m.key)) : MEASURES).map((m) => ({ value: m.key, label: m.label }))}
                />
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Types de documents pris en compte</div>
                <MultiSelect
                  label="Documents"
                  values={relevantDocumentTypes(widgetDraft.source, available.typesDocument)}
                  selected={widgetDraft.localFilters.typesDocument || []}
                  onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, typesDocument: v } })}
                />
                <p className="mt-2 text-[11px] font-semibold text-slate-500">Laissez vide pour garder tous les documents pertinents de la source. En mixte, décochez par exemple CDC ou BR pour les exclure de la valeur.</p>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Filtre clients propre au widget</div>
                <div className="grid gap-3">
                  <SelectField label="Mode client" value={widgetDraft.localFilters.clientMode || 'include'} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, clientMode: v as ClientFilterMode } })} options={[{ value: 'include', label: 'Sélectionner uniquement' }, { value: 'exclude', label: 'Exclure les clients' }]} />
                  <MultiSelect label="Numéro tiers / nom client" values={available.clients} selected={widgetDraft.localFilters.clients || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, clients: v } })} />
                </div>
                <p className="mt-2 text-[11px] font-semibold text-slate-500">Ce filtre s’ajoute aux filtres globaux lorsque le widget utilise les filtres globaux.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Mesure comparaison" value={widgetDraft.secondMeasure || widgetDraft.measure} onChange={(v) => updateWidgetDraft({ secondMeasure: v as MeasureKey })} options={MEASURES.map((m) => ({ value: m.key, label: m.label }))} />
                <SelectField label="Évolution" value={widgetDraft.evolutionMode} onChange={(v) => updateWidgetDraft({ evolutionMode: v as EvolutionMode })} options={[{ value: 'none', label: 'Aucune' }, { value: 'percent', label: 'Évolution %' }, { value: 'value', label: 'Évolution valeur' }, { value: 'both', label: 'Valeur + %' }]} />
              </div>

              {widgetDraft.type !== 'kpi' && widgetDraft.type !== 'tableau' && widgetDraft.type !== 'synthese' && (
                <>
                  <SelectField label={widgetDraft.type === 'bridge' || widgetDraft.type === 'double_bridge' ? 'Dimension écart' : 'Axe X'} value={widgetDraft.dimension} onChange={(v) => updateWidgetDraft({ dimension: v as DimensionKey })} options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))} />
                  {widgetDraft.type !== 'bridge' && widgetDraft.type !== 'double_bridge' && widgetDraft.type !== 'camembert' && (
                    <SelectField label="Série" value={widgetDraft.seriesDimension || ''} onChange={(v) => updateWidgetDraft({ seriesDimension: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                  )}
                </>
              )}

              {(['bridge', 'double_bridge', 'kpi', 'tableau', 'synthese', 'courbe', 'histogramme', 'histogramme_empile'] as WidgetType[]).includes(widgetDraft.type) && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="col-span-2 text-xs font-black uppercase tracking-wide text-slate-500">Période de calcul / base de comparaison</div>
                  <SelectField label="Période" value={widgetDraft.periodMode} onChange={(v) => updateWidgetDraft({ periodMode: v as PeriodMode })} options={[{ value: 'mois', label: 'Mois seul' }, { value: 'cumul', label: 'Cumul 01-M' }]} />
                  <SelectField label="Mois" value={widgetDraft.bridgeMonth} onChange={(v) => updateWidgetDraft({ bridgeMonth: Number(v) })} options={available.months.map((m) => ({ value: m, label: `${String(m).padStart(2, '0')} - ${monthLabel(m)}` }))} />
                  <SelectField label="Année N" value={widgetDraft.yearN || available.years[0] || CURRENT_YEAR} onChange={(v) => updateWidgetDraft({ yearN: Number(v) })} options={available.years.map((y) => ({ value: y, label: String(y) }))} />
                  <SelectField label="Année N-1" value={widgetDraft.yearN1 || (widgetDraft.yearN || CURRENT_YEAR) - 1} onChange={(v) => updateWidgetDraft({ yearN1: Number(v) })} options={available.years.map((y) => ({ value: y, label: String(y) }))} />
                </div>
              )}

              {widgetDraft.type === 'tableau' && (
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Lignes 1" value={widgetDraft.rowDimension} onChange={(v) => updateWidgetDraft({ rowDimension: v as DimensionKey })} options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))} />
                  <SelectField label="Lignes 2" value={widgetDraft.rowDimension2 || ''} onChange={(v) => updateWidgetDraft({ rowDimension2: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                  <SelectField label="Colonnes 1" value={widgetDraft.columnDimension} onChange={(v) => updateWidgetDraft({ columnDimension: v as DimensionKey })} options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))} />
                  <SelectField label="Colonnes 2" value={widgetDraft.columnDimension2 || ''} onChange={(v) => updateWidgetDraft({ columnDimension2: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                  <div className="col-span-2 rounded-xl border border-slate-200 p-3">
                    <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Valeurs affichées dans chaque colonne</div>
                    <div className="grid grid-cols-2 gap-2">
                      {MEASURES.map((measure) => {
                        const selected = (widgetDraft.tableMeasures || [widgetDraft.measure]).includes(measure.key)
                        return (
                          <label key={measure.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const current = widgetDraft.tableMeasures || [widgetDraft.measure]
                                const next = e.target.checked ? Array.from(new Set([...current, measure.key])) : current.filter((m) => m !== measure.key)
                                updateWidgetDraft({ tableMeasures: next.length ? next : [widgetDraft.measure] })
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
                <SelectField label="Tri" value={widgetDraft.sortMode} onChange={(v) => updateWidgetDraft({ sortMode: v as SortMode })} options={[
                  { value: 'value_desc', label: 'Valeur décroissante' },
                  { value: 'value_asc', label: 'Valeur croissante' },
                  { value: 'label_asc', label: 'Libellé A-Z' },
                ]} />
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Top N</span>
                  <input type="number" min={1} max={100} value={widgetDraft.topN} onChange={(e) => updateWidgetDraft({ topN: Number(e.target.value || 10) })} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Mode comparaison"
                  value={widgetDraft.compareMode === 'dimension' && widgetDraft.type === 'double_bridge' ? 'year' : widgetDraft.compareMode}
                  onChange={(v) => updateWidgetDraft({ compareMode: v as CompareMode })}
                  options={widgetDraft.type === 'double_bridge'
                    ? [{ value: 'year', label: 'Année précédente → année N' }, { value: 'month', label: 'Mois M → mois M+1' }]
                    : [{ value: 'year', label: 'Année / période' }, { value: 'month', label: 'Mois' }, { value: 'dimension', label: 'Autre dimension' }]}
                />
                {widgetDraft.type !== 'double_bridge' && (
                  <>
                    <SelectField label="Dimension comparaison" value={widgetDraft.compareDimension || ''} onChange={(v) => updateWidgetDraft({ compareDimension: v as DimensionKey | '' })} options={[{ value: '', label: 'Aucune' }, ...DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))]} />
                    <label className="block col-span-2">
                      <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Valeur comparaison dimension</span>
                      <input value={widgetDraft.compareValue || ''} onChange={(e) => updateWidgetDraft({ compareValue: e.target.value })} placeholder="Ex : ANGLET, PV, 2025..." className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-500" />
                    </label>
                  </>
                )}
                {widgetDraft.type === 'histogramme_empile' && (
                  <label className="col-span-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={widgetDraft.stacked100} onChange={(e) => updateWidgetDraft({ stacked100: e.target.checked })} />
                    Afficher en base 100
                  </label>
                )}
              </div>

              <label className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                <input type="checkbox" checked={widgetDraft.useGlobalFilters} onChange={(e) => updateWidgetDraft({ useGlobalFilters: e.target.checked })} />
                Utiliser les filtres globaux
              </label>

              <div className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Filtres propres au widget</div>
                <div className="grid gap-2">
                  <MultiSelect label="Année" values={available.years.map(String)} selected={(widgetDraft.localFilters.years || []).map(String)} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, years: v.map(Number) } })} />
                  <MultiSelect label="Mois" values={available.months.map((m) => `${m} - ${monthLabel(m)}`)} selected={(widgetDraft.localFilters.months || []).map((m) => `${m} - ${monthLabel(m)}`)} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, months: v.map((x) => Number(x.split(' - ')[0])) } })} />
                  <MultiSelect label="Agence" values={available.agences} selected={widgetDraft.localFilters.agences || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, agences: v } })} />
                  <MultiSelect label="Dépôt" values={available.depots} selected={widgetDraft.localFilters.depots || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, depots: v } })} />
                  <MultiSelect label="Collab. facture" values={available.collaborateursFacture} selected={widgetDraft.localFilters.collaborateursFacture || widgetDraft.localFilters.collaborateurs || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, collaborateursFacture: v, collaborateurs: v } })} />
                  <MultiSelect label="Collab. tiers" values={available.collaborateursTiers} selected={widgetDraft.localFilters.collaborateursTiers || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, collaborateursTiers: v } })} />
                  <MultiSelect label="Dépt tiers" values={available.departementsTiers} selected={widgetDraft.localFilters.departementsTiers || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, departementsTiers: v } })} />
                  <MultiSelect label="Famille macro" values={available.famillesMacro} selected={widgetDraft.localFilters.famillesMacro || []} onChange={(v) => updateWidgetDraft({ localFilters: { ...widgetDraft.localFilters, famillesMacro: v } })} />
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}

