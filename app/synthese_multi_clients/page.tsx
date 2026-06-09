'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabaseClient'

const MapContainer: any = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer as any), { ssr: false })
const TileLayer: any = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer as any), { ssr: false })
const CircleMarker: any = dynamic(() => import('react-leaflet').then((mod) => mod.CircleMarker as any), { ssr: false })
const Tooltip: any = dynamic(() => import('react-leaflet').then((mod) => mod.Tooltip as any), { ssr: false })

type ModeSelection = 'collaborateur' | 'agence'
type SortDirection = 'asc' | 'desc'
type ObjectiveType = 'texte' | 'nombre' | 'montant' | 'date' | 'action'
type ObjectiveDomain = 'Remarque' | 'Objectif' | 'QRC' | 'Initiative' | 'Visite'
type RowKind = 'total' | 'client' | 'month'

type TiersRow = {
  numero: string
  intitule: string
  codePostal: string
  codeNaf: string
  libelleNaf: string
  dateCreation: string
  prospect: boolean | null
  collaborateur: string
  agence: string
  raw: Record<string, any>
}

type CollaborateurRow = {
  nom: string
  agence: string
}

type SelectionOptions = {
  collaborateurs: string[]
  agences: string[]
  cacheCollaborateurs: string[]
  cacheAgences: string[]
}

type AggRow = {
  annee: number
  mois: number
  numero_tiers: string
  intitule_tiers: string
  collaborateur: string
  agence_collaborateur: string
  famille_macro: string
  ca_ht: number
  marge_valeur: number
  nb_lignes: number
}

type ObjectiveRow = {
  id?: number
  numero_tiers: string
  annee: number
  domaine: ObjectiveDomain | string
  rubrique: string
  valeur_type: ObjectiveType | string
  valeur_text: string | null
  valeur_number: number | null
  valeur_date: string | null
}

type CacheDbRow = {
  annee: number
  row_kind: RowKind
  mois: number | null
  numero_tiers: string
  intitule_tiers: string | null
  collaborateur: string | null
  agence_collaborateur: string | null
  code_postal: string | null
  libelle_naf: string | null
  date_creation: string | null
  prospect_label: string | null
  ca_n3: number | null
  ca_n2: number | null
  devis_n1: number | null
  devis_n1_by_macro: Record<string, number> | null
  ca_n1: number | null
  ca_n1_by_macro: Record<string, number> | null
  marge_pct_n1: number | null
  marge_n1_value: number | null
  marge_n1_by_macro: Record<string, number | null> | null
  marge_n1_value_by_macro: Record<string, number> | null
  objectif_ca: number | null
  potentiel: number | null
  devis_ytd_n: number | null
  devis_ytd_n1?: number | null
  devis_ytd_n_by_macro: Record<string, number> | null
  devis_ytd_n1_by_macro?: Record<string, number> | null
  ca_ytd_n: number | null
  ca_ytd_n1: number | null
  ca_ytd_n_by_macro: Record<string, number> | null
  marge_pct_ytd_n: number | null
  marge_ytd_n_value: number | null
  marge_ytd_n1_value: number | null
  marge_ytd_n_by_macro: Record<string, number | null> | null
  marge_ytd_n_value_by_macro: Record<string, number> | null
  marge_ytd_n1_value_by_macro: Record<string, number> | null
  contrat_bfa: number | null
  ca_vs_n1: number | null
  marge_vs_n1: number | null
  realise_objectif: number | null
  qrc_n1: number | null
  frequence_commande: number | null
  niveau_exclusivite: number | null
  com_notre_faveur: number | null
  garantie: number | null
  qrc_n: number | null
  visite_theorique: number | null
  visite_realise: number | null
  updated_at?: string | null
}

type SummaryRow = {
  id: string
  kind: RowKind
  level: number
  collaborateur: string
  numero: string
  intitule: string
  totalMois: string
  codePostal: string
  libelleNaf: string
  dateCreation: string
  prospectLabel: string
  caN3: number
  caN2: number
  devisN1: number
  devisN1ByMacro: Record<string, number>
  caN1: number
  caN1ByMacro: Record<string, number>
  margePctN1: number | null
  margeN1Value: number
  margeN1ByMacro: Record<string, number | null>
  margeN1ValueByMacro: Record<string, number>
  objectifCa: number
  potentiel: number
  devisYtdN: number
  devisYtdN1: number
  devisYtdNByMacro: Record<string, number>
  devisYtdN1ByMacro: Record<string, number>
  ca12m: number
  caBandN: string
  caBandN1: string
  caBandN2: string
  caYtdN: number
  caYtdN1: number
  caYtdNByMacro: Record<string, number>
  margePctYtdN: number | null
  margeYtdNValue: number
  margeYtdN1Value: number
  margeYtdNByMacro: Record<string, number | null>
  margeYtdNValueByMacro: Record<string, number>
  margeYtdN1ValueByMacro: Record<string, number>
  contratBfa: number
  caVsN1: number | null
  margeVsN1: number | null
  realiseObjectif: number | null
  qrcN1: number
  frequenceCommande: number
  niveauExclusivite: number
  comNotreFaveur: number
  garantie: number
  qrcN: number
  visiteTheorique: number
  visiteRealise: number
}

type ColumnDef = {
  key: string
  label: string
  group: string
  width: number
  sticky?: 'collaborateur' | 'code' | 'label' | 'month'
  className?: string
  rotate?: boolean
  editable?: {
    domaine: ObjectiveDomain
    rubrique: string
    type: ObjectiveType
  }
  value: (row: SummaryRow) => any
  format?: 'text' | 'keur' | 'keurBlank' | 'keurCompare' | 'pct' | 'pctBlank' | 'pctCompare' | 'points' | 'number' | 'date' | 'action'
  compareValue?: (row: SummaryRow) => any
}

type SortState = { key: string; direction: SortDirection }

type SyntheseMapClientRow = {
  id: string
  numero: string
  intitule: string
  siret: string | null
  latitude: number | null
  longitude: number | null
  raison_sociale_affichee: string | null
  activitePrincipaleEtablissement: string | null
  naf_libelle_traduit: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  dateCreationEtablissement: string | null
  rge: boolean | string | null
  rge_domaines_travaux: string | null
  capacite_gaz: boolean | null
  capacite_gaz_numero: string | null
  capital_social: string | null
  ca12m: number
  caN1: number
  caN2: number
  caBandN: string
  caBandN1: string
  caBandN2: string
  collaborateur: string
  agence: string
}

type RefTiersMapRow = {
  numero: string | null
  intitule: string | null
  siret: string | null
  representant: string | null
  agence_rattachement: string | null
  depot_rattachement: string | null
  code_naf: string | null
  code_postal: string | null
  ville: string | null
  rge: string | boolean | null
  attestation_capacite: string | boolean | null
  capital_social?: string | null
}

type ClientMapDbRow = {
  id: string
  siret: string | null
  raison_sociale_affichee: string | null
  activitePrincipaleEtablissement: string | null
  naf_libelle_traduit: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  dateCreationEtablissement: string | null
  latitude: number | null
  longitude: number | null
  coordonneeLambertAbscisseEtablissement?: number | null
  coordonneeLambertOrdonneeEtablissement?: number | null
  rge: boolean | string | null
  rge_domaines_travaux: string | null
  capacite_gaz: boolean | null
  capacite_gaz_numero: string | null
  capital_social: string | null
}

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']
const FAMILY_MACROS = ['R/R', 'R/O', 'ECS', 'DRV', 'R_zone', 'Accessoire', 'PV', 'Autres']
const N = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_DAY = new Date().getDate()
const CLOSED_MONTH = CURRENT_DAY <= 6 ? (CURRENT_MONTH === 1 ? 12 : CURRENT_MONTH - 1) : CURRENT_MONTH
const CLOSED_MONTH_YEAR = CURRENT_MONTH === 1 && CURRENT_DAY <= 6 ? N - 1 : N
const ANALYSIS_YEAR = CLOSED_MONTH_YEAR
const ALL_COLLABORATEURS_VALUE = '__ALL_COLLABORATEURS__'


const ACTIONS = [
  'Pack Sérénité PAC\n5 ans pièces',
  'Pack Sérénité PAC\n10 ans pièces',
  'Pack Sérénité PAC\n5 ans MO / 5 ans pièces',
  'Garantie 5 ans YUTAKI\n(formation3j Merignac)',
  'G5',
  'Promo PAC RO installateurs',
  'REC PROTRUST2',
  'MES offerte',
  'PRESTA TECH facturée',
  'PRESTA MPR',
  'C2E - Drapo',
  'Synerciel',
  'Rappel Vanne',
  'Animation AGENCE\n(barbecue, dej technique…)',
  'Animation Cegeclim\n(Barcelone, Rugby, ODP…)',
]

const VISITES = Array.from({ length: 24 }, (_, i) => `Visite n°${i + 1}`)

function normalize(value: any) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function loose(value: any) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function safeText(value: any, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value).replace(/\s/g, '').replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

function safeBool(value: any): boolean | null {
  if (value === null || value === undefined || value === '') return null
  if (value === true || value === false) return value
  const text = loose(value)
  if (['oui', 'true', 'vrai', '1', 'yes'].includes(text)) return true
  if (['non', 'false', 'faux', '0', 'no'].includes(text)) return false
  return null
}

function raw(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== null && value !== undefined && String(value).trim() !== '') return value
  }
  return null
}

function normalizeDateForInput(value: any) {
  if (!value) return ''
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return ''
}

function formatDateFr(value: any) {
  const iso = normalizeDateForInput(value)
  if (!iso) return safeText(value)
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function isNullAmount(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) || Math.abs(Number(value)) < 0.000001
}

function formatKEur(value: number | null | undefined) {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((value || 0) / 1000)} K€`
}

function formatKEurBlank(value: number | null | undefined) {
  if (isNullAmount(value)) return ''
  return formatKEur(value)
}

function formatPct(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`
}

function formatPctBlank(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`
}

function formatPoints(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const sign = value > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} pts`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}


function normalizeSiret(value: any) {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function caBand(value: number | null | undefined) {
  const n = safeNumber(value)
  if (n >= 400000) return '>400K€'
  if (n >= 150000) return '>150K€'
  if (n >= 80000) return '>80K€'
  if (n >= 20000) return '>20K€'
  if (n > 0) return '<20K€'
  return '0€'
}

function formatCaProfile(row: SummaryRow) {
  if (row.kind === 'month') return ''
  return `12M ${row.caBandN} · N-1 ${row.caBandN1} · N-2 ${row.caBandN2}`
}

function formatCompareKEur(current: number | null | undefined, previous: number | null | undefined) {
  const currentText = formatKEurBlank(current)
  const previousText = formatKEurBlank(previous)
  if (!currentText && !previousText) return ''
  if (!previousText) return currentText
  return `${currentText || '0,0 K€'} (${previousText})`
}

function formatComparePct(current: number | null | undefined, previous: number | null | undefined) {
  const currentText = formatPctBlank(current == null ? null : Number(current))
  const previousText = formatPctBlank(previous == null ? null : Number(previous))
  if (!currentText && !previousText) return ''
  if (!previousText) return currentText
  return `${currentText || '0,0 %'} (${previousText})`
}

function translateNafForMap(value: string | null | undefined): string {
  const code = String(value || '').replace(/\s/g, '').toUpperCase()
  if (!code) return 'AUTRES'
  if (code.startsWith('43.22B') || code.startsWith('4322B')) return 'Installateur CVC (43.22B)'
  if (code.startsWith('43.22A') || code.startsWith('4322A')) return 'Plomberie (43.22A)'
  if (code.startsWith('43.21') || code.startsWith('4321')) return 'Electricité ENR (43.21A)'
  if (code.startsWith('41.20') || code.startsWith('4120')) return 'CMI (41.20A)'
  if (code.startsWith('43.99') || code.startsWith('4399')) return 'Bâtiment'
  return 'AUTRES'
}

function getMapSectorLabel(row: SyntheseMapClientRow) {
  return row.naf_libelle_traduit || translateNafForMap(row.activitePrincipaleEtablissement)
}

function getMapSectorColor(sector: string | null | undefined) {
  const s = String(sector || '').toLowerCase()
  if (s.includes('installateur') || s.includes('cvc')) return '#8ba9be'
  if (s.includes('enr')) return '#a2cc88'
  if (s.includes('plomberie')) return '#c3b691'
  if (s.includes('cmi')) return '#e0a961'
  if (s.includes('bâtiment')) return '#8e9db3'
  return '#d9d9d9'
}

function lambert93ToWgs84(x: number | null | undefined, y: number | null | undefined): { latitude: number; longitude: number } | null {
  if (x == null || y == null) return null
  const X = Number(x)
  const Y = Number(y)
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return null

  const n = 0.725607765053267
  const C = 11754255.426096
  const xs = 700000
  const ys = 12655612.049876
  const lon0 = (3 * Math.PI) / 180
  const e = 0.0818191910428158
  const dx = X - xs
  const dy = Y - ys
  const R = Math.sqrt(dx * dx + dy * dy)
  if (!Number.isFinite(R) || R === 0) return null

  const gamma = Math.atan(dx / (ys - Y))
  const lonRad = lon0 + gamma / n
  const latIso = -Math.log(Math.abs(R / C)) / n
  let latRad = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2
  for (let i = 0; i < 6; i += 1) {
    latRad = 2 * Math.atan(Math.pow((1 + e * Math.sin(latRad)) / (1 - e * Math.sin(latRad)), e / 2) * Math.exp(latIso)) - Math.PI / 2
  }

  return { latitude: (latRad * 180) / Math.PI, longitude: (lonRad * 180) / Math.PI }
}

function ensureSyntheseMapCoordinates(row: ClientMapDbRow) {
  if (typeof row.latitude === 'number' && Number.isFinite(row.latitude) && typeof row.longitude === 'number' && Number.isFinite(row.longitude)) {
    return { latitude: row.latitude, longitude: row.longitude }
  }
  return lambert93ToWgs84(row.coordonneeLambertAbscisseEtablissement, row.coordonneeLambertOrdonneeEtablissement)
}

function hasPositiveValue(value: unknown) {
  if (value === true) return true
  const normalized = loose(value)
  if (!normalized) return false
  return !['non', 'no', 'false', '0', 'nc', 'nd', 'null', 'undefined'].includes(normalized)
}

function objectiveKey(numero: string, annee: number, domaine: string, rubrique: string) {
  return `${normalize(numero)}§${annee}§${normalize(domaine)}§${normalize(rubrique)}`
}

function macroBucket(value: any) {
  const t = loose(value).replace(/[^a-z0-9]/g, '')
  if (t === 'rr' || t.includes('refrigeration')) return 'R/R'
  if (t === 'ro' || t.includes('renouvellement')) return 'R/O'
  if (t.includes('ecs')) return 'ECS'
  if (t.includes('drv')) return 'DRV'
  if (t === 'rzone' || t.includes('airzone')) return 'R_zone'
  if (t.includes('acc') || t.includes('accessoire')) return 'Accessoire'
  if (t === 'pv' || t.includes('photovolt')) return 'PV'
  return 'Autres'
}

function emptyByMacro() {
  return Object.fromEntries(FAMILY_MACROS.map((m) => [m, 0])) as Record<string, number>
}

function emptyNullableByMacro() {
  return Object.fromEntries(FAMILY_MACROS.map((m) => [m, null])) as Record<string, number | null>
}

function ratio(num: number, den: number) {
  if (!den) return null
  return (num / den) * 100
}

async function fetchAll(table: string, select = '*', apply?: (query: any) => any) {
  const output: Record<string, any>[] = []
  const chunkSize = 1000
  let from = 0
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + chunkSize - 1)
    if (apply) query = apply(query)
    const { data, error } = await query
    if (error) throw new Error(`${table} : ${error.message}`)
    const rows = (data || []) as Record<string, any>[]
    output.push(...rows)
    if (rows.length < chunkSize) break
    from += chunkSize
  }
  return output
}

function chunk<T>(values: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

async function fetchAggForTiers(table: string, codes: string[], y0: number, y1: number) {
  const rows: Record<string, any>[] = []
  for (const group of chunk(codes, 200)) {
    const part = await fetchAll(table, '*', (q) => q.gte('annee', y0).lte('annee', y1).in('numero_tiers', group))
    rows.push(...part)
  }
  return rows.map(normalizeAgg)
}

async function fetchObjectivesForTiers(codes: string[], annee: number) {
  const rows: ObjectiveRow[] = []
  for (const group of chunk(codes, 200)) {
    const part = await fetchAll('objectif_tiers', '*', (q) => q.eq('annee', annee).in('numero_tiers', group))
    rows.push(...(part as ObjectiveRow[]))
  }
  return rows
}

function normalizeAgg(row: Record<string, any>): AggRow {
  return {
    annee: safeNumber(row.annee),
    mois: safeNumber(row.mois),
    numero_tiers: safeText(row.numero_tiers || row.numero || row.code_tiers, 'NON RENSEIGNE'),
    intitule_tiers: safeText(row.intitule_tiers || row.intitule || row.tiers, 'NON RENSEIGNE'),
    collaborateur: safeText(row.collaborateur, 'NON AFFECTE'),
    agence_collaborateur: safeText(row.agence_collaborateur || row.agence, 'NON AFFECTE'),
    famille_macro: macroBucket(row.famille_macro),
    ca_ht: safeNumber(row.ca_ht || row.montant_ht || row.ca),
    marge_valeur: safeNumber(row.marge_valeur || row.marge),
    nb_lignes: safeNumber(row.nb_lignes || row.nombre_lignes),
  }
}

function normalizeTiers(row: Record<string, any>, nafByCode: Map<string, string>): TiersRow {
  const codeNaf = safeText(raw(row, ['code_naf', 'naf']))
  return {
    numero: safeText(raw(row, ['numero', 'numero_tiers', 'code_tiers']), 'SANS CODE'),
    intitule: safeText(raw(row, ['intitule', 'intitule_tiers', 'raison_sociale', 'tiers']), 'SANS INTITULE'),
    codePostal: safeText(raw(row, ['code_postal', 'cp'])),
    codeNaf,
    libelleNaf: nafByCode.get(normalize(codeNaf)) || safeText(raw(row, ['libelle_naf', 'designation_naf', 'famille']), 'NA'),
    dateCreation: formatDateFr(raw(row, ['date_creation', 'creation_date', 'created_at'])),
    prospect: safeBool(raw(row, ['prospect', 'is_prospect'])),
    collaborateur: safeText(raw(row, ['collaborateur', 'representant', 'commercial', 'vendeur']), 'NON AFFECTE'),
    agence: safeText(raw(row, ['agence_rattachement', 'agence', 'depot_rattachement', 'depot']), 'NON AFFECTE'),
    raw: row,
  }
}

function objectiveNumber(map: Map<string, ObjectiveRow>, numero: string, domaine: string, rubrique: string) {
  const row = map.get(objectiveKey(numero, N, domaine, rubrique))
  return safeNumber(row?.valeur_number ?? row?.valeur_text)
}

function objectiveText(map: Map<string, ObjectiveRow>, numero: string, domaine: string, rubrique: string) {
  const row = map.get(objectiveKey(numero, N, domaine, rubrique))
  return safeText(row?.valeur_text ?? row?.valeur_number ?? row?.valeur_date)
}

function objectiveDate(map: Map<string, ObjectiveRow>, numero: string, domaine: string, rubrique: string) {
  const row = map.get(objectiveKey(numero, N, domaine, rubrique))
  return normalizeDateForInput(row?.valeur_date ?? row?.valeur_text)
}

function sumAmount(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number; macro?: string }) {
  return rows.reduce((sum, row) => {
    if (numero && normalize(row.numero_tiers) !== normalize(numero)) return sum
    if (row.annee !== year) return sum
    if (opts?.month && row.mois !== opts.month) return sum
    if (opts?.monthMax && row.mois > opts.monthMax) return sum
    if (opts?.macro && row.famille_macro !== opts.macro) return sum
    return sum + row.ca_ht
  }, 0)
}

function sumMarge(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number; macro?: string }) {
  return rows.reduce((sum, row) => {
    if (numero && normalize(row.numero_tiers) !== normalize(numero)) return sum
    if (row.annee !== year) return sum
    if (opts?.month && row.mois !== opts.month) return sum
    if (opts?.monthMax && row.mois > opts.monthMax) return sum
    if (opts?.macro && row.famille_macro !== opts.macro) return sum
    return sum + row.marge_valeur
  }, 0)
}

function byMacro(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number; metric?: 'ca' | 'marge' }) {
  const out = emptyByMacro()
  for (const macro of FAMILY_MACROS) {
    out[macro] = opts?.metric === 'marge'
      ? sumMarge(rows, numero, year, { month: opts?.month, monthMax: opts?.monthMax, macro })
      : sumAmount(rows, numero, year, { month: opts?.month, monthMax: opts?.monthMax, macro })
  }
  return out
}

function byMacroMarginPct(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number }) {
  const out = Object.fromEntries(FAMILY_MACROS.map((m) => [m, null])) as Record<string, number | null>
  for (const macro of FAMILY_MACROS) {
    const ca = sumAmount(rows, numero, year, { month: opts?.month, monthMax: opts?.monthMax, macro })
    const marge = sumMarge(rows, numero, year, { month: opts?.month, monthMax: opts?.monthMax, macro })
    out[macro] = ca ? (marge / ca) * 100 : null
  }
  return out
}

function deltaPoints(currentPct: number | null, previousPct: number | null) {
  if (currentPct === null || previousPct === null) return null
  if (!Number.isFinite(currentPct) || !Number.isFinite(previousPct)) return null
  return currentPct - previousPct
}


function macroFromColumnKey(key: string, prefix: string) {
  const marker = `${prefix}_`
  return key.startsWith(marker) ? key.slice(marker.length) : null
}

function shouldBlankEmptyMonthMetric(col: ColumnDef, row: SummaryRow) {
  if (row.kind !== 'month') return false

  const key = col.key

  if (key === 'devisN1') return isNullAmount(row.devisN1)
  const devisN1Macro = macroFromColumnKey(key, 'devisN1')
  if (devisN1Macro) return isNullAmount(row.devisN1ByMacro[devisN1Macro])

  if (key === 'devisYtdN') return isNullAmount(row.devisYtdN)
  const devisYtdNMacro = macroFromColumnKey(key, 'devisYtdN')
  if (devisYtdNMacro) return isNullAmount(row.devisYtdNByMacro[devisYtdNMacro])

  if (key === 'caN3') return isNullAmount(row.caN3)
  if (key === 'caN2') return isNullAmount(row.caN2)
  if (key === 'caN1') return isNullAmount(row.caN1)
  const caN1Macro = macroFromColumnKey(key, 'caN1')
  if (caN1Macro) return isNullAmount(row.caN1ByMacro[caN1Macro])

  if (key === 'caYtdN') return isNullAmount(row.caYtdN)
  const caYtdNMacro = macroFromColumnKey(key, 'caYtdN')
  if (caYtdNMacro) return isNullAmount(row.caYtdNByMacro[caYtdNMacro])

  if (key === 'margePctN1') return isNullAmount(row.caN1)
  const margeN1Macro = macroFromColumnKey(key, 'margeN1')
  if (margeN1Macro) return isNullAmount(row.caN1ByMacro[margeN1Macro])

  if (key === 'margePctYtdN') return isNullAmount(row.caYtdN)
  const margeYtdNMacro = macroFromColumnKey(key, 'margeYtdN')
  if (margeYtdNMacro) return isNullAmount(row.caYtdNByMacro[margeYtdNMacro])

  return false
}

function buildSummaryForNumero(tier: TiersRow | null, factures: AggRow[], devis: AggRow[], objectives: Map<string, ObjectiveRow>, month?: number): SummaryRow {
  const numero = tier?.numero || ''
  const monthFilter = month ? { month } : undefined
  const caN1 = sumAmount(factures, numero || null, N - 1, monthFilter)
  const margeN1 = sumMarge(factures, numero || null, N - 1, monthFilter)
  const margePctN1 = caN1 ? (margeN1 / caN1) * 100 : null
  const caYtdN = sumAmount(factures, numero || null, N, month ? { month } : { monthMax: CLOSED_MONTH })
  const margeYtdN = sumMarge(factures, numero || null, N, month ? { month } : { monthMax: CLOSED_MONTH })
  const margePctYtdN = caYtdN ? (margeYtdN / caYtdN) * 100 : null
  const caYtdN1 = sumAmount(factures, numero || null, N - 1, month ? { month } : { monthMax: CLOSED_MONTH })
  const margeYtdN1 = sumMarge(factures, numero || null, N - 1, month ? { month } : { monthMax: CLOSED_MONTH })
  const margePctYtdN1 = caYtdN1 ? (margeYtdN1 / caYtdN1) * 100 : null
  const objectifCa = objectiveNumber(objectives, numero, 'Objectif', 'CA')
  const objectifProrata = month ? objectifCa / 12 : (objectifCa / 12) * CLOSED_MONTH
  const frequenceCommande = objectiveNumber(objectives, numero, 'QRC', 'Fréquence commande')
  const niveauExclusivite = objectiveNumber(objectives, numero, 'QRC', 'Niveau exclusivité')
  const comNotreFaveur = objectiveNumber(objectives, numero, 'QRC', 'Com en notre faveur')
  const garantie = objectiveNumber(objectives, numero, 'QRC', 'Garantie')
  const visiteRealise = VISITES.reduce((count, rubrique) => count + (objectiveDate(objectives, numero, 'Visite', rubrique) ? 1 : 0), 0)

  return {
    id: month ? `${numero}-m${month}` : numero || 'TOTAL',
    kind: month ? 'month' : tier ? 'client' : 'total',
    level: month ? 1 : 0,
    collaborateur: tier?.collaborateur || '',
    numero: tier?.numero || 'TOTAL',
    intitule: tier?.intitule || '',
    totalMois: month ? MONTHS[month - 1] : 'TOTAL',
    codePostal: tier?.codePostal || '',
    libelleNaf: tier?.libelleNaf || '',
    dateCreation: tier?.dateCreation || '',
    prospectLabel: tier?.prospect === true ? 'OUI' : tier?.prospect === false ? 'NON' : 'NA',
    caN3: sumAmount(factures, numero || null, N - 3, monthFilter),
    caN2: sumAmount(factures, numero || null, N - 2, monthFilter),
    devisN1: sumAmount(devis, numero || null, N - 1, monthFilter),
    devisN1ByMacro: byMacro(devis, numero || null, N - 1, { month, metric: 'ca' }),
    caN1,
    caN1ByMacro: byMacro(factures, numero || null, N - 1, { month, metric: 'ca' }),
    margePctN1,
    margeN1Value: margeN1,
    margeN1ByMacro: byMacroMarginPct(factures, numero || null, N - 1, { month }),
    margeN1ValueByMacro: byMacro(factures, numero || null, N - 1, { month, metric: 'marge' }),
    // L'objectif CA est saisi en annuel sur la ligne TOTAL du client.
    // Lorsqu'on développe le client, chaque mois affiche 1/12 de cet objectif.
    objectifCa: month ? objectifCa / 12 : objectifCa,
    potentiel: objectiveNumber(objectives, numero, 'Objectif', 'POTENTIEL'),
    devisYtdN: sumAmount(devis, numero || null, N, month ? { month } : { monthMax: CLOSED_MONTH }),
    devisYtdN1: sumAmount(devis, numero || null, N - 1, month ? { month } : { monthMax: CLOSED_MONTH }),
    devisYtdNByMacro: byMacro(devis, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'ca' }),
    devisYtdN1ByMacro: byMacro(devis, numero || null, N - 1, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'ca' }),
    caYtdN,
    caYtdN1,
    caYtdNByMacro: byMacro(factures, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'ca' }),
    margePctYtdN,
    margeYtdNValue: margeYtdN,
    margeYtdN1Value: margeYtdN1,
    margeYtdNByMacro: byMacroMarginPct(factures, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH }),
    margeYtdNValueByMacro: byMacro(factures, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'marge' }),
    margeYtdN1ValueByMacro: byMacro(factures, numero || null, N - 1, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'marge' }),
    ca12m: caYtdN + Math.max(0, caN1 - caYtdN1),
    caBandN: caBand(caYtdN + Math.max(0, caN1 - caYtdN1)),
    caBandN1: caBand(caN1),
    caBandN2: caBand(sumAmount(factures, numero || null, N - 2, monthFilter)),
    contratBfa: objectiveNumber(objectives, numero, 'Objectif', 'Contrat\nBFA'),
    caVsN1: ratio(caYtdN, caYtdN1),
    margeVsN1: deltaPoints(margePctYtdN, margePctYtdN1),
    realiseObjectif: ratio(caYtdN, objectifProrata),
    qrcN1: objectiveNumber(objectives, numero, 'QRC', `QRC ${N - 1}`) || objectiveNumber(objectives, numero, 'QRC', 'QRC N-1'),
    frequenceCommande,
    niveauExclusivite,
    comNotreFaveur,
    garantie,
    qrcN: frequenceCommande + niveauExclusivite + comNotreFaveur + garantie,
    visiteTheorique: objectiveNumber(objectives, numero, 'Visite', 'Théorique'),
    visiteRealise,
  }
}

function buildColumns(showFamilies: boolean, showCollaborateurColumn = false): ColumnDef[] {
  const cols: ColumnDef[] = []

  if (showCollaborateurColumn) {
    cols.push({ key: 'collaborateur', label: 'Collaborateur', group: 'Client', width: 130, sticky: 'collaborateur', value: (r) => r.collaborateur, format: 'text' })
  }

  cols.push(
    { key: 'numero', label: 'Code Client', group: 'Client', width: 86, sticky: 'code', value: (r) => r.numero, format: 'text' },
    { key: 'intitule', label: 'Intitulé Client', group: 'Client', width: 210, sticky: 'label', value: (r) => r.intitule, format: 'text' },
    { key: 'totalMois', label: 'Total / Mois', group: 'Client', width: 105, sticky: 'month', value: (r) => r.totalMois, format: 'text' },
    { key: 'codePostal', label: 'Code postal', group: 'Client', width: 82, value: (r) => r.codePostal, format: 'text' },
    { key: 'libelleNaf', label: 'Désignation Naf', group: 'Client', width: 130, value: (r) => r.libelleNaf, format: 'text' },
    { key: 'dateCreation', label: 'Date Création', group: 'Client', width: 95, value: (r) => r.dateCreation, format: 'date' },
    { key: 'prospectLabel', label: 'Prospect OUI/NON', group: 'Client', width: 86, value: (r) => r.prospectLabel, format: 'text' },
    { key: 'caProfile', label: 'Profil CA', group: 'Client', width: 185, className: 'caProfileCell', value: (r) => formatCaProfile(r), format: 'text' },
    { key: 'remarque', label: 'Remarque', group: 'Client', width: 310, value: (r) => r.numero, editable: { domaine: 'Remarque', rubrique: 'Remarque', type: 'texte' }, format: 'text' },
    { key: 'caN3', label: `CA ${N - 3}`, group: 'CA / Objectifs', width: 92, className: 'metric previous', value: (r) => r.caN3, format: 'keurBlank' },
    { key: 'caN2', label: `CA ${N - 2}`, group: 'CA / Objectifs', width: 92, className: 'metric previous', value: (r) => r.caN2, format: 'keurBlank' },
    { key: 'devisN1', label: `DEVIS ${N - 1}`, group: 'CA / Objectifs', width: 98, className: 'metric devis', value: (r) => r.devisN1, format: 'keurBlank' },
  )

  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `devisN1_${macro}`, label: `Dont ${macro}`, group: `Devis ${N - 1}`, width: 78, rotate: true, value: (r) => r.devisN1ByMacro[macro], format: 'keurBlank' }))
  }

  cols.push({ key: 'caN1', label: `CA ${N - 1}`, group: 'CA / Objectifs', width: 98, className: 'metric ca', value: (r) => r.caN1, format: 'keurBlank' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `caN1_${macro}`, label: `Dont ${macro}`, group: `CA ${N - 1}`, width: 78, rotate: true, value: (r) => r.caN1ByMacro[macro], format: 'keurBlank' }))
  }
  cols.push({ key: 'margePctN1', label: `MARGE ${N - 1}`, group: 'CA / Objectifs', width: 92, className: 'metric margin', value: (r) => r.margePctN1, format: 'pctBlank' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `margeN1_${macro}`, label: `Dont ${macro}`, group: `Marge ${N - 1}`, width: 78, rotate: true, value: (r) => r.margeN1ByMacro[macro], format: 'pctBlank' }))
  }

  cols.push(
    { key: 'devisYtdN', label: `DEVIS ${String(CLOSED_MONTH).padStart(2, '0')}-${N}`, group: 'CA / Objectifs', width: 124, className: 'metric devis redLabel compareCell', value: (r) => r.devisYtdN, compareValue: (r) => r.devisYtdN1, format: 'keurCompare' },
  )
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `devisYtdN_${macro}`, label: `Dont ${macro}`, group: `Devis ${N}`, width: 78, rotate: true, value: (r) => r.devisYtdNByMacro[macro], format: 'keurBlank' }))
  }
  cols.push({ key: 'caYtdN', label: `CA RÉEL ${N}`, group: 'CA / Objectifs', width: 124, className: 'metric ca redLabel compareCell', value: (r) => r.caYtdN, compareValue: (r) => r.caYtdN1, format: 'keurCompare' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `caYtdN_${macro}`, label: `Dont ${macro}`, group: `CA ${N}`, width: 78, rotate: true, value: (r) => r.caYtdNByMacro[macro], format: 'keurBlank' }))
  }
  cols.push({ key: 'margePctYtdN', label: `MARGE RÉEL ${N}`, group: 'CA / Objectifs', width: 124, className: 'metric margin redLabel compareCell', value: (r) => r.margePctYtdN, compareValue: (r) => ratio(r.margeYtdN1Value, r.caYtdN1), format: 'pctCompare' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `margeYtdN_${macro}`, label: `Dont ${macro}`, group: `Marge ${N}`, width: 78, rotate: true, value: (r) => r.margeYtdNByMacro[macro], format: 'pctBlank' }))
  }

  cols.push(
    { key: 'objectifCa', label: `OBJECTIF ${N}`, group: 'Objectif', width: 104, className: 'editableNumber', value: (r) => r.objectifCa, editable: { domaine: 'Objectif', rubrique: 'CA', type: 'montant' }, format: 'keur' },
    { key: 'potentiel', label: 'POTENTIEL', group: 'Objectif', width: 98, className: 'editableNumber', value: (r) => r.potentiel, editable: { domaine: 'Objectif', rubrique: 'POTENTIEL', type: 'montant' }, format: 'keur' },
    { key: 'contratBfa', label: 'Contrat BFA', group: 'Objectif', width: 96, className: 'editableNumber', value: (r) => r.contratBfa, editable: { domaine: 'Objectif', rubrique: 'Contrat\nBFA', type: 'montant' }, format: 'keur' },
    { key: 'caVsN1', label: `CA Réalisé / ${N - 1}`, group: 'Comparatif', width: 86, rotate: true, value: (r) => r.caVsN1, format: 'pct' },
    { key: 'margeVsN1', label: `Écart marge / ${N - 1}`, group: 'Comparatif', width: 86, rotate: true, value: (r) => r.margeVsN1, format: 'points' },
    { key: 'realiseObjectif', label: 'Réalisé / Objectif', group: 'Comparatif', width: 86, rotate: true, value: (r) => r.realiseObjectif, format: 'pct' },
    { key: 'qrcN1', label: `QRC ${N - 1}`, group: 'QRC', width: 70, rotate: true, value: (r) => r.qrcN1, editable: { domaine: 'QRC', rubrique: `QRC ${N - 1}`, type: 'nombre' }, format: 'number' },
    { key: 'frequenceCommande', label: 'Fréquence commande', group: 'QRC', width: 76, rotate: true, value: (r) => r.frequenceCommande, editable: { domaine: 'QRC', rubrique: 'Fréquence commande', type: 'nombre' }, format: 'number' },
    { key: 'niveauExclusivite', label: 'Niveau exclusivité', group: 'QRC', width: 76, rotate: true, value: (r) => r.niveauExclusivite, editable: { domaine: 'QRC', rubrique: 'Niveau exclusivité', type: 'nombre' }, format: 'number' },
    { key: 'comNotreFaveur', label: 'Com en notre faveur', group: 'QRC', width: 76, rotate: true, value: (r) => r.comNotreFaveur, editable: { domaine: 'QRC', rubrique: 'Com en notre faveur', type: 'nombre' }, format: 'number' },
    { key: 'garantie', label: 'Garantie', group: 'QRC', width: 76, rotate: true, value: (r) => r.garantie, editable: { domaine: 'QRC', rubrique: 'Garantie', type: 'nombre' }, format: 'number' },
    { key: 'qrcN', label: `QRC ${N}`, group: 'QRC', width: 70, rotate: true, className: 'redLabel', value: (r) => r.qrcN, format: 'number' },
  )

  ACTIONS.forEach((rubrique) => cols.push({
    key: `action_${rubrique}`,
    label: rubrique,
    group: 'Dynamisme Client',
    width: 76,
    rotate: true,
    editable: { domaine: 'Initiative', rubrique, type: 'action' },
    value: (r) => r.numero,
    format: 'action',
  }))

  cols.push(
    { key: 'visiteTheorique', label: 'Théorique', group: 'Fréquence visite', width: 76, rotate: true, value: (r) => r.visiteTheorique, editable: { domaine: 'Visite', rubrique: 'Théorique', type: 'nombre' }, format: 'number' },
    { key: 'visiteRealise', label: 'Réalisé', group: 'Fréquence visite', width: 76, rotate: true, className: 'redLabel', value: (r) => r.visiteRealise, format: 'number' },
  )

  VISITES.forEach((rubrique) => cols.push({
    key: `visite_${rubrique}`,
    label: rubrique,
    group: 'Visite',
    width: 82,
    rotate: true,
    editable: { domaine: 'Visite', rubrique, type: 'date' },
    value: (r) => r.numero,
    format: 'date',
  }))

  return cols
}

function displayValue(col: ColumnDef, row: SummaryRow, objectiveMap: Map<string, ObjectiveRow>) {
  if (col.editable && row.kind === 'client') {
    const { domaine, rubrique, type } = col.editable
    if (type === 'date') return formatDateFr(objectiveDate(objectiveMap, row.numero, domaine, rubrique))
    if (type === 'texte') return objectiveText(objectiveMap, row.numero, domaine, rubrique)
    const n = objectiveNumber(objectiveMap, row.numero, domaine, rubrique)
    if (type === 'montant') return formatKEur(n)
    return n ? formatNumber(n) : ''
  }

  if (shouldBlankEmptyMonthMetric(col, row)) return ''

  const value = col.value(row)
  if (col.format === 'keur') return formatKEur(safeNumber(value))
  if (col.format === 'keurBlank') return formatKEurBlank(safeNumber(value))
  if (col.format === 'keurCompare') return formatCompareKEur(safeNumber(value), safeNumber(col.compareValue?.(row)))
  if (col.format === 'pct') return formatPct(value as number | null)
  if (col.format === 'pctBlank') return formatPctBlank(value as number | null)
  if (col.format === 'pctCompare') return formatComparePct(value as number | null, col.compareValue?.(row) as number | null)
  if (col.format === 'points') return formatPoints(value as number | null)
  if (col.format === 'number') return formatNumber(safeNumber(value))
  return safeText(value)
}

function rawSortableValue(col: ColumnDef, row: SummaryRow, objectiveMap: Map<string, ObjectiveRow>) {
  if (col.editable && row.kind === 'client') {
    if (col.editable.type === 'texte' || col.editable.type === 'date') return displayValue(col, row, objectiveMap)
    return objectiveNumber(objectiveMap, row.numero, col.editable.domaine, col.editable.rubrique)
  }
  return col.value(row)
}

function editableRawValue(row: SummaryRow, col: ColumnDef, objectiveMap: Map<string, ObjectiveRow>) {
  if (!col.editable) return ''
  const { domaine, rubrique, type } = col.editable
  if (type === 'date') return objectiveDate(objectiveMap, row.numero, domaine, rubrique)
  if (type === 'texte') return objectiveText(objectiveMap, row.numero, domaine, rubrique)
  const value = objectiveNumber(objectiveMap, row.numero, domaine, rubrique)
  return value ? String(value) : ''
}


function macroNumberPayload(value: any) {
  const out = emptyByMacro()
  if (!value || typeof value !== 'object') return out
  for (const macro of FAMILY_MACROS) out[macro] = safeNumber(value[macro])
  return out
}

function macroNullablePayload(value: any) {
  const out = emptyNullableByMacro()
  if (!value || typeof value !== 'object') return out
  for (const macro of FAMILY_MACROS) {
    const rawValue = value[macro]
    if (rawValue === null || rawValue === undefined || rawValue === '') out[macro] = null
    else {
      const n = Number(rawValue)
      out[macro] = Number.isFinite(n) ? n : null
    }
  }
  return out
}

function cacheRowToSummary(row: CacheDbRow): SummaryRow {
  const month = row.mois ? safeNumber(row.mois) : null
  return {
    id: month ? `${row.numero_tiers}-m${month}` : row.numero_tiers,
    kind: row.row_kind,
    level: row.row_kind === 'month' ? 1 : 0,
    collaborateur: safeText(row.collaborateur),
    numero: safeText(row.numero_tiers, 'SANS CODE'),
    intitule: safeText(row.intitule_tiers),
    totalMois: month ? MONTHS[month - 1] : 'TOTAL',
    codePostal: safeText(row.code_postal),
    libelleNaf: safeText(row.libelle_naf, 'NA'),
    dateCreation: formatDateFr(row.date_creation),
    prospectLabel: safeText(row.prospect_label, 'NA'),
    caN3: safeNumber(row.ca_n3),
    caN2: safeNumber(row.ca_n2),
    devisN1: safeNumber(row.devis_n1),
    devisN1ByMacro: macroNumberPayload(row.devis_n1_by_macro),
    caN1: safeNumber(row.ca_n1),
    caN1ByMacro: macroNumberPayload(row.ca_n1_by_macro),
    margePctN1: row.marge_pct_n1 === null || row.marge_pct_n1 === undefined ? null : safeNumber(row.marge_pct_n1),
    margeN1Value: safeNumber(row.marge_n1_value),
    margeN1ByMacro: macroNullablePayload(row.marge_n1_by_macro),
    margeN1ValueByMacro: macroNumberPayload(row.marge_n1_value_by_macro),
    objectifCa: safeNumber(row.objectif_ca),
    potentiel: safeNumber(row.potentiel),
    devisYtdN: safeNumber(row.devis_ytd_n),
    devisYtdN1: row.row_kind === 'month' ? safeNumber(row.devis_n1) : safeNumber(row.devis_ytd_n1),
    devisYtdNByMacro: macroNumberPayload(row.devis_ytd_n_by_macro),
    devisYtdN1ByMacro: row.row_kind === 'month' ? macroNumberPayload(row.devis_n1_by_macro) : macroNumberPayload(row.devis_ytd_n1_by_macro),
    caYtdN: safeNumber(row.ca_ytd_n),
    caYtdN1: safeNumber(row.ca_ytd_n1),
    caYtdNByMacro: macroNumberPayload(row.ca_ytd_n_by_macro),
    margePctYtdN: row.marge_pct_ytd_n === null || row.marge_pct_ytd_n === undefined ? null : safeNumber(row.marge_pct_ytd_n),
    margeYtdNValue: safeNumber(row.marge_ytd_n_value),
    margeYtdN1Value: safeNumber(row.marge_ytd_n1_value),
    margeYtdNByMacro: macroNullablePayload(row.marge_ytd_n_by_macro),
    margeYtdNValueByMacro: macroNumberPayload(row.marge_ytd_n_value_by_macro),
    margeYtdN1ValueByMacro: macroNumberPayload(row.marge_ytd_n1_value_by_macro),
    ca12m: safeNumber(row.ca_ytd_n) + Math.max(0, safeNumber(row.ca_n1) - safeNumber(row.ca_ytd_n1)),
    caBandN: caBand(safeNumber(row.ca_ytd_n) + Math.max(0, safeNumber(row.ca_n1) - safeNumber(row.ca_ytd_n1))),
    caBandN1: caBand(row.ca_n1),
    caBandN2: caBand(row.ca_n2),
    contratBfa: safeNumber(row.contrat_bfa),
    caVsN1: row.ca_vs_n1 === null || row.ca_vs_n1 === undefined ? null : safeNumber(row.ca_vs_n1),
    margeVsN1: row.marge_vs_n1 === null || row.marge_vs_n1 === undefined ? null : safeNumber(row.marge_vs_n1),
    realiseObjectif: row.realise_objectif === null || row.realise_objectif === undefined ? null : safeNumber(row.realise_objectif),
    qrcN1: safeNumber(row.qrc_n1),
    frequenceCommande: safeNumber(row.frequence_commande),
    niveauExclusivite: safeNumber(row.niveau_exclusivite),
    comNotreFaveur: safeNumber(row.com_notre_faveur),
    garantie: safeNumber(row.garantie),
    qrcN: safeNumber(row.qrc_n),
    visiteTheorique: safeNumber(row.visite_theorique),
    visiteRealise: safeNumber(row.visite_realise),
  }
}

function applyObjectiveOverrides(row: SummaryRow, objectiveMap: Map<string, ObjectiveRow>) {
  if (row.kind === 'total' || !row.numero || row.numero === 'TOTAL') return row

  const objectifCa = objectiveNumber(objectiveMap, row.numero, 'Objectif', 'CA')
  const objectifProrata = row.kind === 'month' ? objectifCa / 12 : (objectifCa / 12) * CLOSED_MONTH
  const frequenceCommande = objectiveNumber(objectiveMap, row.numero, 'QRC', 'Fréquence commande')
  const niveauExclusivite = objectiveNumber(objectiveMap, row.numero, 'QRC', 'Niveau exclusivité')
  const comNotreFaveur = objectiveNumber(objectiveMap, row.numero, 'QRC', 'Com en notre faveur')
  const garantie = objectiveNumber(objectiveMap, row.numero, 'QRC', 'Garantie')
  const visiteRealise = VISITES.reduce((count, rubrique) => count + (objectiveDate(objectiveMap, row.numero, 'Visite', rubrique) ? 1 : 0), 0)

  return {
    ...row,
    objectifCa: row.kind === 'month' ? objectifCa / 12 : objectifCa,
    potentiel: objectiveNumber(objectiveMap, row.numero, 'Objectif', 'POTENTIEL'),
    contratBfa: objectiveNumber(objectiveMap, row.numero, 'Objectif', 'Contrat\nBFA'),
    realiseObjectif: ratio(row.caYtdN, objectifProrata),
    qrcN1: objectiveNumber(objectiveMap, row.numero, 'QRC', `QRC ${N - 1}`) || objectiveNumber(objectiveMap, row.numero, 'QRC', 'QRC N-1'),
    frequenceCommande,
    niveauExclusivite,
    comNotreFaveur,
    garantie,
    qrcN: frequenceCommande + niveauExclusivite + comNotreFaveur + garantie,
    visiteTheorique: objectiveNumber(objectiveMap, row.numero, 'Visite', 'Théorique'),
    visiteRealise,
  }
}

function sumMacro(rows: SummaryRow[], getter: (row: SummaryRow) => Record<string, number>) {
  const out = emptyByMacro()
  for (const row of rows) {
    const values = getter(row)
    for (const macro of FAMILY_MACROS) out[macro] += safeNumber(values[macro])
  }
  return out
}

function ratioMacro(caByMacro: Record<string, number>, margeByMacro: Record<string, number>) {
  const out = emptyNullableByMacro()
  for (const macro of FAMILY_MACROS) out[macro] = caByMacro[macro] ? (margeByMacro[macro] / caByMacro[macro]) * 100 : null
  return out
}

function buildTotalFromRows(rows: SummaryRow[], showCollaborateurColumn: boolean): SummaryRow {
  const caN1ByMacro = sumMacro(rows, (row) => row.caN1ByMacro)
  const margeN1ValueByMacro = sumMacro(rows, (row) => row.margeN1ValueByMacro)
  const caYtdNByMacro = sumMacro(rows, (row) => row.caYtdNByMacro)
  const margeYtdNValueByMacro = sumMacro(rows, (row) => row.margeYtdNValueByMacro)

  const total: SummaryRow = {
    id: 'TOTAL',
    kind: 'total',
    level: 0,
    collaborateur: showCollaborateurColumn ? 'TOTAL' : '',
    numero: 'TOTAL',
    intitule: '',
    totalMois: 'TOTAL',
    codePostal: '',
    libelleNaf: '',
    dateCreation: '',
    prospectLabel: '',
    caN3: rows.reduce((s, r) => s + r.caN3, 0),
    caN2: rows.reduce((s, r) => s + r.caN2, 0),
    devisN1: rows.reduce((s, r) => s + r.devisN1, 0),
    devisN1ByMacro: sumMacro(rows, (row) => row.devisN1ByMacro),
    caN1: rows.reduce((s, r) => s + r.caN1, 0),
    caN1ByMacro,
    margePctN1: null,
    margeN1Value: rows.reduce((s, r) => s + r.margeN1Value, 0),
    margeN1ByMacro: emptyNullableByMacro(),
    margeN1ValueByMacro,
    objectifCa: rows.reduce((s, r) => s + r.objectifCa, 0),
    potentiel: rows.reduce((s, r) => s + r.potentiel, 0),
    devisYtdN: rows.reduce((s, r) => s + r.devisYtdN, 0),
    devisYtdN1: rows.reduce((s, r) => s + r.devisYtdN1, 0),
    devisYtdNByMacro: sumMacro(rows, (row) => row.devisYtdNByMacro),
    devisYtdN1ByMacro: sumMacro(rows, (row) => row.devisYtdN1ByMacro),
    caYtdN: rows.reduce((s, r) => s + r.caYtdN, 0),
    caYtdN1: rows.reduce((s, r) => s + r.caYtdN1, 0),
    caYtdNByMacro,
    margePctYtdN: null,
    margeYtdNValue: rows.reduce((s, r) => s + r.margeYtdNValue, 0),
    margeYtdN1Value: rows.reduce((s, r) => s + r.margeYtdN1Value, 0),
    margeYtdNByMacro: emptyNullableByMacro(),
    margeYtdNValueByMacro,
    margeYtdN1ValueByMacro: sumMacro(rows, (row) => row.margeYtdN1ValueByMacro),
    contratBfa: rows.reduce((s, r) => s + r.contratBfa, 0),
    caVsN1: null,
    margeVsN1: null,
    realiseObjectif: null,
    qrcN1: rows.reduce((s, r) => s + r.qrcN1, 0),
    frequenceCommande: rows.reduce((s, r) => s + r.frequenceCommande, 0),
    niveauExclusivite: rows.reduce((s, r) => s + r.niveauExclusivite, 0),
    comNotreFaveur: rows.reduce((s, r) => s + r.comNotreFaveur, 0),
    garantie: rows.reduce((s, r) => s + r.garantie, 0),
    qrcN: 0,
    visiteTheorique: rows.reduce((s, r) => s + r.visiteTheorique, 0),
    visiteRealise: rows.reduce((s, r) => s + r.visiteRealise, 0),
  }

  total.margePctN1 = total.caN1 ? (total.margeN1Value / total.caN1) * 100 : null
  total.margeN1ByMacro = ratioMacro(total.caN1ByMacro, total.margeN1ValueByMacro)
  total.margePctYtdN = total.caYtdN ? (total.margeYtdNValue / total.caYtdN) * 100 : null
  total.margeYtdNByMacro = ratioMacro(total.caYtdNByMacro, total.margeYtdNValueByMacro)
  const margePctYtdN1 = total.caYtdN1 ? (total.margeYtdN1Value / total.caYtdN1) * 100 : null
  total.caVsN1 = ratio(total.caYtdN, total.caYtdN1)
  total.margeVsN1 = deltaPoints(total.margePctYtdN, margePctYtdN1)
  total.realiseObjectif = ratio(total.caYtdN, (total.objectifCa / 12) * CLOSED_MONTH)
  total.qrcN = total.frequenceCommande + total.niveauExclusivite + total.comNotreFaveur + total.garantie

  return total
}

function mergeSortedOptions(...lists: string[][]) {
  return Array.from(new Set(lists.flat().map((value) => safeText(value)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
}

function emptySelectionOptions(): SelectionOptions {
  return { collaborateurs: [], agences: [], cacheCollaborateurs: [], cacheAgences: [] }
}

async function fetchCacheSelectionOptions() {
  const rows = await fetchAll('synthese_multi_clients_cache', 'collaborateur,agence_collaborateur', (q) => q.eq('annee', N).eq('row_kind', 'client'))
  const collaborateurs = mergeSortedOptions(rows.map((row) => safeText(row.collaborateur)))
  const agences = mergeSortedOptions(rows.map((row) => safeText(row.agence_collaborateur)))
  return { collaborateurs, agences }
}

async function fetchReferentialSelectionOptions() {
  const [rawCollaborateurs, rawTiers] = await Promise.all([
    fetchAll('ref_collaborateurs', '*'),
    // Sélection '*' volontaire : cela évite une erreur Supabase si un des noms de colonne optionnels
    // n'existe pas dans ref_tiers selon la version de la base.
    fetchAll('ref_tiers', '*'),
  ])

  const collaborateurs = mergeSortedOptions(
    rawCollaborateurs.map((row) => safeText(raw(row, ['nom', 'collaborateur', 'representant']))),
    rawTiers.map((row) => safeText(raw(row, ['collaborateur', 'representant', 'commercial', 'vendeur'])))
  )

  const agences = mergeSortedOptions(
    rawCollaborateurs.map((row) => safeText(raw(row, ['agence', 'agence_collaborateur', 'depot']))),
    rawTiers.map((row) => safeText(raw(row, ['agence_rattachement', 'agence', 'depot_rattachement', 'depot'])))
  )

  return { collaborateurs, agences }
}

async function fetchSelectionOptions(): Promise<SelectionOptions> {
  const [cacheResult, refResult] = await Promise.allSettled([
    fetchCacheSelectionOptions(),
    fetchReferentialSelectionOptions(),
  ])

  const cacheOptions = cacheResult.status === 'fulfilled' ? cacheResult.value : { collaborateurs: [], agences: [] }
  const refOptions = refResult.status === 'fulfilled' ? refResult.value : { collaborateurs: [], agences: [] }

  return {
    collaborateurs: mergeSortedOptions(cacheOptions.collaborateurs, refOptions.collaborateurs),
    agences: mergeSortedOptions(cacheOptions.agences, refOptions.agences),
    cacheCollaborateurs: cacheOptions.collaborateurs,
    cacheAgences: cacheOptions.agences,
  }
}

async function fetchCacheClientRows(mode: ModeSelection, selected: string) {
  return fetchAll('synthese_multi_clients_cache', '*', (query) => {
    let q = query.eq('annee', N).eq('row_kind', 'client')
    if (mode === 'collaborateur' && selected !== ALL_COLLABORATEURS_VALUE) q = q.eq('collaborateur', selected)
    if (mode === 'agence') q = q.eq('agence_collaborateur', selected)
    return q.order('collaborateur', { ascending: true }).order('numero_tiers', { ascending: true })
  }) as Promise<CacheDbRow[]>
}

async function fetchCacheMonthRows(numero: string) {
  return fetchAll('synthese_multi_clients_cache', '*', (query) => query
    .eq('annee', N)
    .eq('row_kind', 'month')
    .eq('numero_tiers', numero)
    .order('mois', { ascending: true })
  ) as Promise<CacheDbRow[]>
}

export default function SyntheseMultiClientsPage() {
  const [mode, setMode] = useState<ModeSelection>('collaborateur')
  const [selected, setSelected] = useState('')
  const [selectionOptions, setSelectionOptions] = useState<SelectionOptions>(emptySelectionOptions())
  const [cacheRows, setCacheRows] = useState<SummaryRow[]>([])
  const [monthRowsByNumero, setMonthRowsByNumero] = useState<Record<string, SummaryRow[]>>({})
  const [objectiveRows, setObjectiveRows] = useState<ObjectiveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFamilies, setShowFamilies] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>({ key: 'caN1', direction: 'desc' })
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [loadingMonths, setLoadingMonths] = useState<Set<string>>(new Set())
  const [cacheStatus, setCacheStatus] = useState('')

  const hasSelection = Boolean(selected)
  const showCollaborateurColumn = mode === 'collaborateur' && selected === ALL_COLLABORATEURS_VALUE

  const objectiveMap = useMemo(() => {
    const map = new Map<string, ObjectiveRow>()
    objectiveRows.forEach((row) => map.set(objectiveKey(row.numero_tiers, row.annee, row.domaine, row.rubrique), row))
    return map
  }, [objectiveRows])

  const columns = useMemo(() => buildColumns(showFamilies, showCollaborateurColumn), [showFamilies, showCollaborateurColumn])
  const currentSelectionOptions = mode === 'collaborateur' ? selectionOptions.collaborateurs : selectionOptions.agences

  useEffect(() => {
    let alive = true
    async function init() {
      setLoading(true)
      setError(null)
      try {
        const options = await fetchSelectionOptions()
        if (!alive) return
        setSelectionOptions(options)
        const cacheCount = options.cacheCollaborateurs.length + options.cacheAgences.length
        const refCount = options.collaborateurs.length + options.agences.length
        if (cacheCount) {
          setCacheStatus('Cache prêt')
        } else if (refCount) {
          setCacheStatus('Référentiels chargés · cache vide : lancez la reconstruction après les imports.')
        } else {
          setCacheStatus('Aucun collaborateur/agence trouvé dans les référentiels et le cache.')
        }
      } catch (err: any) {
        if (alive) {
          setSelectionOptions(emptySelectionOptions())
          setError(err?.message || 'Erreur de chargement des listes collaborateur/agence')
          setCacheStatus('Listes indisponibles')
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void init()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!selected) return

    if (mode === 'collaborateur') {
      if (selected === ALL_COLLABORATEURS_VALUE) return
      if (!selectionOptions.collaborateurs.includes(selected)) setSelected('')
      return
    }

    if (!selectionOptions.agences.includes(selected)) setSelected('')
  }, [mode, selectionOptions, selected])

  useEffect(() => {
    let alive = true
    async function loadCachedBusinessData() {
      if (!selected) {
        setCacheRows([])
        setMonthRowsByNumero({})
        setObjectiveRows([])
        return
      }

      setLoading(true)
      setError(null)
      try {
        const rows = (await fetchCacheClientRows(mode, selected)).map(cacheRowToSummary)
        const codes = rows.map((row) => row.numero).filter(Boolean)
        const objectives = codes.length ? await fetchObjectivesForTiers(codes, N) : []
        if (!alive) return
        setCacheRows(rows)
        setObjectiveRows(objectives)
        setMonthRowsByNumero({})
        setExpanded(new Set())
        setCacheStatus(rows.length ? `Cache chargé · ${rows.length} clients` : 'Aucun client dans le cache pour cette sélection')
      } catch (err: any) {
        if (alive) {
          setCacheRows([])
          setObjectiveRows([])
          setMonthRowsByNumero({})
          setError(err?.message || 'Erreur de chargement de la synthèse cache')
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void loadCachedBusinessData()
    return () => { alive = false }
  }, [mode, selected])

  const baseClientRows = useMemo(() => cacheRows.map((row) => applyObjectiveOverrides(row, objectiveMap)), [cacheRows, objectiveMap])
  const totalRow = useMemo(() => buildTotalFromRows(baseClientRows, showCollaborateurColumn), [baseClientRows, showCollaborateurColumn])

  const visibleRows = useMemo(() => {
    const sortCol = columns.find((c) => c.key === sort.key) || columns.find((c) => c.key === 'caN1')!
    let rows = baseClientRows.filter((row) => {
      return Object.entries(filters).every(([key, value]) => {
        if (!String(value).trim()) return true
        const col = columns.find((c) => c.key === key)
        if (!col) return true
        return loose(displayValue(col, row, objectiveMap)).includes(loose(String(value)))
      })
    })

    rows = [...rows].sort((a, b) => {
      const av = rawSortableValue(sortCol, a, objectiveMap)
      const bv = rawSortableValue(sortCol, b, objectiveMap)
      const an = typeof av === 'number' ? av : Number(av)
      const bn = typeof bv === 'number' ? bv : Number(bv)
      let cmp = 0
      if (Number.isFinite(an) && Number.isFinite(bn)) cmp = an - bn
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'fr')
      return sort.direction === 'asc' ? cmp : -cmp
    })

    const out: SummaryRow[] = [totalRow]
    rows.forEach((row) => {
      out.push(row)
      if (expanded.has(row.numero)) {
        const monthRows = monthRowsByNumero[row.numero] || []
        monthRows.forEach((monthRow) => out.push(applyObjectiveOverrides(monthRow, objectiveMap)))
      }
    })
    return out
  }, [baseClientRows, filters, sort, columns, objectiveMap, totalRow, expanded, monthRowsByNumero])


  const clientRowsForCurrentSelection = useMemo(() => {
    return visibleRows.filter((row) => row.kind === 'client')
  }, [visibleRows])

  const [mapOpen, setMapOpen] = useState(false)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapRows, setMapRows] = useState<SyntheseMapClientRow[]>([])
  const [mapInstanceKey, setMapInstanceKey] = useState(0)
  const leafletMapRef = useRef<any>(null)

  const mapRowsWithCoords = useMemo(() => {
    return mapRows.filter((row) => typeof row.latitude === 'number' && typeof row.longitude === 'number' && Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
  }, [mapRows])

  const mapLegendSectors = useMemo(() => {
    return Array.from(new Set(mapRowsWithCoords.map((row) => getMapSectorLabel(row)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [mapRowsWithCoords])

  useEffect(() => {
    if (!mapOpen || !leafletMapRef.current) return
    const timer = window.setTimeout(() => {
      const map = leafletMapRef.current
      if (!map || typeof map.invalidateSize !== 'function') return
      map.invalidateSize()
      if (!mapRowsWithCoords.length) return
      const points = mapRowsWithCoords.map((row) => [row.latitude as number, row.longitude as number])
      if (points.length === 1 && typeof map.setView === 'function') map.setView(points[0], 10)
      else if (typeof map.fitBounds === 'function') map.fitBounds(points, { padding: [30, 30] })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [mapOpen, mapRowsWithCoords])

  async function fetchRefTiersForMap(codes: string[]) {
    const rows: RefTiersMapRow[] = []
    for (const group of chunk(codes, 400)) {
      const { data, error } = await supabase
        .from('ref_tiers')
        .select('numero,intitule,siret,representant,agence_rattachement,depot_rattachement,code_naf,code_postal,ville,rge,attestation_capacite')
        .in('numero', group)
      if (error) throw new Error(`ref_tiers carte : ${error.message}`)
      rows.push(...((data || []) as RefTiersMapRow[]))
    }
    return rows
  }

  async function fetchClientsForMap(sirets: string[]) {
    const rows: ClientMapDbRow[] = []
    for (const group of chunk(sirets, 300)) {
      const { data, error } = await supabase
        .from('clients')
        .select('id,siret,raison_sociale_affichee,activitePrincipaleEtablissement,naf_libelle_traduit,codePostalEtablissement,libelleCommuneEtablissement,dateCreationEtablissement,latitude,longitude,coordonneeLambertAbscisseEtablissement,coordonneeLambertOrdonneeEtablissement,rge,rge_domaines_travaux,capacite_gaz,capacite_gaz_numero,capital_social')
        .in('siret', group)
      if (error) throw new Error(`clients carte : ${error.message}`)
      rows.push(...((data || []) as ClientMapDbRow[]))
    }
    return rows
  }

  async function openMapForVisibleClients() {
    if (!clientRowsForCurrentSelection.length) return
    setMapOpen(true)
    setMapLoading(true)
    setMapError(null)
    setMapRows([])
    setMapInstanceKey((v) => v + 1)

    try {
      const codes = Array.from(new Set(clientRowsForCurrentSelection.map((row) => row.numero).filter(Boolean)))
      const tiersRows = await fetchRefTiersForMap(codes)
      const tiersByNumero = new Map(tiersRows.map((row) => [normalize(row.numero), row]))
      const sirets = Array.from(new Set(tiersRows.map((row) => normalizeSiret(row.siret)).filter(Boolean)))
      const clientsRows = sirets.length ? await fetchClientsForMap(sirets) : []
      const clientsBySiret = new Map(clientsRows.map((row) => [normalizeSiret(row.siret), row]))

      const merged = clientRowsForCurrentSelection.map((row) => {
        const tiers = tiersByNumero.get(normalize(row.numero)) || null
        const siret = normalizeSiret(tiers?.siret)
        const client = siret ? clientsBySiret.get(siret) || null : null
        const coords = client ? ensureSyntheseMapCoordinates(client) : null
        const sectorCode = client?.activitePrincipaleEtablissement || tiers?.code_naf || null

        return {
          id: client?.id || row.numero,
          numero: row.numero,
          intitule: row.intitule,
          siret: siret || null,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          raison_sociale_affichee: client?.raison_sociale_affichee || row.intitule || tiers?.intitule || null,
          activitePrincipaleEtablissement: sectorCode,
          naf_libelle_traduit: client?.naf_libelle_traduit || row.libelleNaf || null,
          codePostalEtablissement: client?.codePostalEtablissement || tiers?.code_postal || row.codePostal || null,
          libelleCommuneEtablissement: client?.libelleCommuneEtablissement || tiers?.ville || null,
          dateCreationEtablissement: client?.dateCreationEtablissement || null,
          rge: client?.rge ?? tiers?.rge ?? null,
          rge_domaines_travaux: client?.rge_domaines_travaux || null,
          capacite_gaz: client?.capacite_gaz ?? hasPositiveValue(tiers?.attestation_capacite),
          capacite_gaz_numero: client?.capacite_gaz_numero || null,
          capital_social: client?.capital_social || null,
          ca12m: row.ca12m,
          caN1: row.caN1,
          caN2: row.caN2,
          caBandN: row.caBandN,
          caBandN1: row.caBandN1,
          caBandN2: row.caBandN2,
          collaborateur: row.collaborateur,
          agence: mode === 'agence' ? selected : safeText(tiers?.agence_rattachement || tiers?.depot_rattachement),
        } as SyntheseMapClientRow
      })

      setMapRows(merged)
      setMapError(merged.some((row) => !row.siret) ? 'Certains clients n’ont pas de SIRET dans ref_tiers et ne peuvent pas être rapprochés de la base carte.' : null)
    } catch (err: any) {
      setMapError(err?.message || 'Erreur de préparation de la carte')
    } finally {
      setMapLoading(false)
    }
  }

  function getFilterValue(key: string) {
    return filters[key] || ''
  }

  function updateFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function toggleSort(key: string) {
    setSort((prev) => prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' })
  }

  async function ensureMonthRows(numero: string) {
    if (monthRowsByNumero[numero] || loadingMonths.has(numero)) return
    setLoadingMonths((prev) => new Set(prev).add(numero))
    try {
      const rows = (await fetchCacheMonthRows(numero)).map(cacheRowToSummary)
      setMonthRowsByNumero((prev) => ({ ...prev, [numero]: rows }))
    } catch (err: any) {
      setError(err?.message || 'Erreur de chargement du détail mensuel cache')
    } finally {
      setLoadingMonths((prev) => {
        const next = new Set(prev)
        next.delete(numero)
        return next
      })
    }
  }

  function toggleExpanded(numero: string) {
    const willOpen = !expanded.has(numero)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(numero)) next.delete(numero)
      else next.add(numero)
      return next
    })
    if (willOpen) void ensureMonthRows(numero)
  }

  async function saveObjective(numero: string, editable: NonNullable<ColumnDef['editable']>, rawValue: string) {
    if (!numero || numero === 'TOTAL') return
    const key = objectiveKey(numero, N, editable.domaine, editable.rubrique)
    setSavingKey(key)
    const value = rawValue.trim()
    const payload: Record<string, any> = {
      numero_tiers: numero,
      annee: N,
      domaine: editable.domaine,
      rubrique: editable.rubrique,
      valeur_type: editable.type,
      valeur_text: null,
      valeur_number: null,
      valeur_date: null,
    }

    if (editable.type === 'date') payload.valeur_date = value || null
    else if (editable.type === 'texte') payload.valeur_text = value || null
    else payload.valeur_number = value === '' ? null : safeNumber(value)

    const { data, error } = await supabase
      .from('objectif_tiers')
      .upsert(payload, { onConflict: 'numero_tiers,annee,domaine,rubrique' })
      .select('*')
      .single()

    setSavingKey(null)
    if (error) {
      setError(`Sauvegarde impossible : ${error.message}`)
      return
    }
    setObjectiveRows((prev) => {
      const next = prev.filter((r) => objectiveKey(r.numero_tiers, r.annee, r.domaine, r.rubrique) !== key)
      next.push(data as ObjectiveRow)
      return next
    })
  }

  async function exportExcel() {
    if (!hasSelection) {
      setError("Veuillez choisir un collaborateur, une agence ou Tous les collaborateurs avant de lancer l'export.")
      return
    }

    // @ts-ignore - xlsx-js-style est déjà présent dans le projet mais n'a pas toujours les types TS.
    const XLSX = await import('xlsx-js-style')
    // L'export Excel contient systématiquement le détail Famille macro, même si l'écran l'a masqué.
    // Les colonnes de détail sont ensuite groupées et réduites par défaut dans le fichier.
    const exportColumns = buildColumns(true, showCollaborateurColumn)

    const sortCol = exportColumns.find((c) => c.key === sort.key) || exportColumns.find((c) => c.key === 'caN1')!
    let exportClientRows = baseClientRows.filter((row) => {
      return Object.entries(filters).every(([key, value]) => {
        if (!String(value).trim()) return true
        const col = exportColumns.find((c) => c.key === key)
        if (!col) return true
        return loose(displayValue(col, row, objectiveMap)).includes(loose(String(value)))
      })
    })

    exportClientRows = [...exportClientRows].sort((a, b) => {
      const av = rawSortableValue(sortCol, a, objectiveMap)
      const bv = rawSortableValue(sortCol, b, objectiveMap)
      const an = typeof av === 'number' ? av : Number(av)
      const bn = typeof bv === 'number' ? bv : Number(bv)
      let cmp = 0
      if (Number.isFinite(an) && Number.isFinite(bn)) cmp = an - bn
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'fr')
      return sort.direction === 'asc' ? cmp : -cmp
    })

    // Export volontairement limité aux lignes TOTAL + clients.
    // Le détail mois par mois n'est pas généré ici car il alourdit fortement
    // la création du fichier pour les portefeuilles/agences volumineux.
    const exportRows: SummaryRow[] = [totalRow, ...exportClientRows]

    const KEUR_FORMAT = '#,##0.0 "K€"'
    const PCT_FORMAT = '0.0%'
    const POINTS_FORMAT = '+0.0 "pts";-0.0 "pts";0.0 "pts"'
    const NUMBER_FORMAT = '0'

    const chapterColor = (group: string) => {
      const g = normalize(group)
      if (g.includes('CLIENT')) return 'E2F0D9'
      if (g.includes('COMPARATIF')) return 'F3E8FF'
      if (g.includes('QRC')) return 'E2F0D9'
      if (g.includes('DYNAMISME')) return 'DDEBF7'
      if (g.includes('FREQUENCE') || g.includes('VISITE')) return 'FCE4D6'
      return 'FFF2CC'
    }

    const bodyColor = (group: string, row?: SummaryRow) => {
      if (row?.kind === 'total') return 'FFF2CC'
      const g = normalize(group)
      if (g.includes('CLIENT')) return row?.kind === 'month' ? 'EDF7E7' : 'E2F0D9'
      if (g.includes('COMPARATIF')) return 'F8EEFF'
      if (g.includes('QRC')) return 'EFF9EC'
      if (g.includes('DYNAMISME')) return 'EFF6FF'
      if (g.includes('FREQUENCE') || g.includes('VISITE')) return 'FFF4EA'
      return 'FFF8E6'
    }

    const isFamilySubtotal = (key: string) => /^(devisN1|caN1|margeN1|devisYtdN|caYtdN|margeYtdN)_/.test(key)
    const isMainMetric = (key: string) => [
      'caN3', 'caN2', 'devisN1', 'caN1', 'margePctN1',
      'objectifCa', 'potentiel', 'devisYtdN', 'caYtdN', 'margePctYtdN',
      'contratBfa', 'caVsN1', 'margeVsN1', 'realiseObjectif',
    ].includes(key)
    const isGroupedFamilyColumn = (key: string) => isFamilySubtotal(key)

    const excelPayload = (col: ColumnDef, row: SummaryRow) => {
      if (col.editable && row.kind === 'client') {
        const { domaine, rubrique, type } = col.editable
        if (type === 'date') return { value: objectiveDate(objectiveMap, row.numero, domaine, rubrique), type: 's' as const }
        if (type === 'texte') return { value: objectiveText(objectiveMap, row.numero, domaine, rubrique), type: 's' as const }
        const n = objectiveNumber(objectiveMap, row.numero, domaine, rubrique)
        if (type === 'montant') return { value: n / 1000, type: 'n' as const, z: KEUR_FORMAT }
        return { value: n, type: 'n' as const, z: NUMBER_FORMAT }
      }

      if (shouldBlankEmptyMonthMetric(col, row)) return { value: '', type: 's' as const }
      const value = col.value(row)

      if (col.format === 'keurCompare' || col.format === 'pctCompare') return { value: displayValue(col, row, objectiveMap), type: 's' as const }

      if (col.format === 'keur' || col.format === 'keurBlank') {
        const n = safeNumber(value)
        if (col.format === 'keurBlank' && isNullAmount(n)) return { value: '', type: 's' as const }
        return { value: n / 1000, type: 'n' as const, z: KEUR_FORMAT }
      }

      if (col.format === 'pct' || col.format === 'pctBlank') {
        const n = Number(value)
        if (!Number.isFinite(n)) return { value: '', type: 's' as const }
        return { value: n / 100, type: 'n' as const, z: PCT_FORMAT }
      }

      if (col.format === 'points') {
        const n = Number(value)
        if (!Number.isFinite(n)) return { value: '', type: 's' as const }
        return { value: n, type: 'n' as const, z: POINTS_FORMAT }
      }

      if (col.format === 'number') {
        const n = safeNumber(value)
        return { value: n, type: 'n' as const, z: NUMBER_FORMAT }
      }

      return { value: safeText(value), type: 's' as const }
    }

    const aoa = [
      exportColumns.map((c) => c.group),
      exportColumns.map((c) => c.label.replace(/\n/g, ' ')),
      ...exportRows.map((row) => exportColumns.map((col) => excelPayload(col, row).value)),
    ]

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')

    const merges: any[] = []
    let mergeStart = 0
    for (let c = 1; c <= exportColumns.length; c += 1) {
      const prev = exportColumns[c - 1]?.group
      const current = exportColumns[c]?.group
      if (current !== prev) {
        if (c - mergeStart > 1) merges.push({ s: { r: 0, c: mergeStart }, e: { r: 0, c: c - 1 } })
        mergeStart = c
      }
    }
    ws['!merges'] = merges

    const borderThin = {
      top: { style: 'thin', color: { rgb: '111111' } },
      bottom: { style: 'thin', color: { rgb: '111111' } },
      left: { style: 'thin', color: { rgb: '111111' } },
      right: { style: 'thin', color: { rgb: '111111' } },
    }

    const numericFormats = new Set(['keur', 'keurBlank', 'pct', 'pctBlank', 'points', 'number'])

    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const dataRow = r >= 2 ? exportRows[r - 2] : undefined
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const col = exportColumns[c]
        if (!ws[addr]) ws[addr] = { t: 's', v: '' }

        if (r >= 2 && col && dataRow) {
          const payload = excelPayload(col, dataRow)
          ws[addr].v = payload.value
          ws[addr].t = payload.type
          if (payload.z) ws[addr].z = payload.z
        }

        const isHeader = r <= 1
        const isNumeric = Boolean(col && (numericFormats.has(col.format || '') || ws[addr].t === 'n'))
        const familySubtotal = Boolean(col && isFamilySubtotal(col.key))
        const mainMetric = Boolean(col && isMainMetric(col.key))

        ws[addr].s = {
          font: {
            bold: isHeader || dataRow?.kind === 'total' || mainMetric,
            sz: isHeader ? 10 : familySubtotal ? 8 : mainMetric ? 10.5 : 9,
            color: col?.className?.includes('redLabel') ? { rgb: 'E60000' } : undefined,
          },
          alignment: {
            horizontal: isHeader ? 'center' : isNumeric ? 'right' : 'left',
            vertical: 'center',
            wrapText: r >= 3 ? false : true,
            textRotation: r === 1 && col?.rotate ? 90 : 0,
          },
          border: borderThin,
          fill: { fgColor: { rgb: isHeader ? chapterColor(col?.group || '') : bodyColor(col?.group || '', dataRow) } },
        }
      }
    }

    const autoWidth = (col: ColumnDef, index: number) => {
      const header = col.label.replace(/\n/g, ' ')
      const sample = exportRows.slice(0, 300).map((row) => displayValue(col, row, objectiveMap))
      const maxLen = Math.max(header.length, col.group.length, ...sample.map((value) => String(value ?? '').length))
      const min = col.rotate ? 8 : 10
      const max = col.key === 'intitule' ? 34 : col.key === 'remarque' ? 42 : col.key === 'caProfile' ? 28 : col.key === 'libelleNaf' ? 32 : col.rotate ? 13 : 18
      const wch = Math.min(Math.max(maxLen + 2, min), max)
      const grouped = isGroupedFamilyColumn(col.key)
      return {
        wch,
        hidden: grouped,
        level: grouped ? 1 : 0,
        collapsed: grouped && !isGroupedFamilyColumn(exportColumns[index + 1]?.key || ''),
      }
    }

    ws['!cols'] = exportColumns.map(autoWidth)
    ws['!rows'] = [
      { hpt: 22 },
      { hpt: 82 },
      ...exportRows.map((row) => ({
        hpt: row.kind === 'total' ? 20 : 18,
      })),
    ]
    ws['!outline'] = { above: false, left: false }
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: Math.max(1, range.e.r), c: range.e.c } }) }

    // Fige les lignes 1 à 3 et les colonnes d'identification client.
    // En vue tous collaborateurs, la colonne Collaborateur est ajoutée et figée en première colonne.
    const frozenColumnCount = showCollaborateurColumn ? 4 : 3
    const frozenPane = { xSplit: frozenColumnCount, ySplit: 3, topLeftCell: showCollaborateurColumn ? 'E4' : 'D4', activePane: 'bottomRight', state: 'frozen' }
    ws['!freeze'] = frozenPane
    ws['!pane'] = frozenPane

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Synthèse multi-clients')
    XLSX.writeFile(wb, `synthese_multi_clients_${mode}_${selected === ALL_COLLABORATEURS_VALUE ? 'tous_collaborateurs' : selected || 'selection'}_${N}.xlsx`)
  }

  return (
    <main className="page">
      <section className="toolbar">
        <div>
          <h1>Synthèse multi-clients</h1>
          <p>Vue dense par collaborateur ou agence · N = {N} · période réalisée arrêtée à {String(CLOSED_MONTH).padStart(2, '0')}/{N} · {cacheStatus}</p>
        </div>
        <div className="toolbarActions">
          <label>
            Sélection
            <select value={mode} onChange={(e) => { setMode(e.target.value as ModeSelection); setSelected(''); setExpanded(new Set()) }}>
              <option value="collaborateur">Collaborateur</option>
              <option value="agence">Agence</option>
            </select>
          </label>
          <label>
            {mode === 'collaborateur' ? 'Collaborateur' : 'Agence'}
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setExpanded(new Set()) }}>
              {mode === 'collaborateur' ? (
                <>
                  <option value="">Choisir un collaborateur…</option>
                  <option value={ALL_COLLABORATEURS_VALUE}>Tous les collaborateurs</option>
                </>
              ) : (
                <option value="">Choisir une agence…</option>
              )}
              {currentSelectionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setShowFamilies((v) => !v)}>
            {showFamilies ? 'Masquer familles macro' : 'Afficher familles macro'}
          </button>
          <button type="button" onClick={openMapForVisibleClients} disabled={!hasSelection || !clientRowsForCurrentSelection.length || mapLoading}>
            {mapLoading ? 'Préparation carte…' : 'Afficher sur la carte'}
          </button>
          <button type="button" onClick={exportExcel} disabled={!hasSelection}>Exporter Excel</button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Chargement…</div>}

      {!hasSelection ? (
        <section className="emptyState">
          Choisissez un collaborateur, une agence ou “Tous les collaborateurs” pour charger la synthèse clients.
        </section>
      ) : (
        <>
          <section className="kpis">
            <div><span>Tiers</span><strong>{baseClientRows.length}</strong></div>
            <div><span>CA {N - 1}</span><strong>{formatKEur(totalRow.caN1)}</strong></div>
            <div><span>CA réel {N}</span><strong>{formatKEur(totalRow.caYtdN)}</strong></div>
            <div><span>Marge réel {N}</span><strong>{formatPct(totalRow.margePctYtdN)}</strong></div>
            <div><span>Réalisé / objectif</span><strong>{formatPct(totalRow.realiseObjectif)}</strong></div>
          </section>

          <div className="tableShell">
        <table className={`synthTable ${showCollaborateurColumn ? 'withCollaborateur' : ''}`}>
          <thead>
            <tr className="groupRow">
              {columns.map((col) => <th key={`${col.key}-g`} className={`group ${groupClass(col.group)} ${stickyClass(col.sticky)}`} style={{ width: col.width, minWidth: col.width }}>{col.group}</th>)}
            </tr>
            <tr className="headerRow">
              {columns.map((col) => (
                <th key={col.key} className={`${col.className || ''} ${stickyClass(col.sticky)} ${col.rotate ? 'rotate' : ''}`} style={{ width: col.width, minWidth: col.width }} onClick={() => toggleSort(col.key)} title="Cliquer pour trier">
                  <span>{col.label}</span>
                  {sort.key === col.key ? <b>{sort.direction === 'asc' ? '▲' : '▼'}</b> : null}
                </th>
              ))}
            </tr>
            <tr className="filterRow">
              {columns.map((col) => (
                <th key={`${col.key}-f`} className={stickyClass(col.sticky)} style={{ width: col.width, minWidth: col.width }}>
                  {['collaborateur', 'numero', 'intitule', 'totalMois', 'codePostal', 'libelleNaf', 'prospectLabel', 'caProfile'].includes(col.key) ? (
                    <input value={getFilterValue(col.key)} onChange={(e) => updateFilter(col.key, e.target.value)} placeholder="filtre" />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className={`${row.kind} ${row.level ? 'child' : ''}`}>
                {columns.map((col) => {
                  const canEdit = row.kind === 'client' && Boolean(col.editable)
                  const saveKey = col.editable ? objectiveKey(row.numero, N, col.editable.domaine, col.editable.rubrique) : ''
                  return (
                    <td key={`${row.id}-${col.key}`} className={`${col.className || ''} ${stickyClass(col.sticky)} ${['keur', 'keurBlank', 'keurCompare', 'pct', 'pctBlank', 'pctCompare', 'points', 'number'].includes(col.format || '') ? 'num' : ''}`} style={{ width: col.width, minWidth: col.width }}>
                      {col.key === 'numero' && row.kind === 'client' ? (
                        <button type="button" className="expandBtn" onClick={() => toggleExpanded(row.numero)}>{expanded.has(row.numero) ? '−' : '+'}</button>
                      ) : null}
                      {canEdit ? (
                        <EditableCell
                          type={col.editable!.type}
                          value={editableRawValue(row, col, objectiveMap)}
                          saving={savingKey === saveKey}
                          onSave={(value) => saveObjective(row.numero, col.editable!, value)}
                        />
                      ) : (
                        <span>{displayValue(col, row, objectiveMap)}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </>
      )}


      {mapOpen && (
        <div className="mapOverlay">
          <div className="mapModal">
            <div className="mapHeader">
              <div>
                <h2>Clients de la sélection sur la carte</h2>
                <p>{mapRows.length} clients sélectionnés · {mapRowsWithCoords.length} géolocalisés · {mapRows.length - mapRowsWithCoords.length} sans coordonnées</p>
                {mapError && <div className="mapWarning">{mapError}</div>}
              </div>
              <button type="button" onClick={() => setMapOpen(false)}>Fermer</button>
            </div>

            <div className="mapLegend">
              {mapLegendSectors.map((sector) => (
                <span key={sector} className="legendItem"><i style={{ background: getMapSectorColor(sector) }} />{sector}</span>
              ))}
              <span className="legendItem"><i className="clientBorder" />Client sélection Synthèse</span>
            </div>

            {mapLoading ? (
              <div className="mapEmpty">Chargement des SIRET, coordonnées et données carte…</div>
            ) : mapRowsWithCoords.length === 0 ? (
              <div className="mapEmpty">Aucun client géolocalisé à afficher. Vérifie les SIRET dans ref_tiers et les coordonnées dans clients.</div>
            ) : (
              <div className="mapGrid">
                <div className="leafletShell">
                  <MapContainer
                    key={`synthese-map-${mapInstanceKey}`}
                    center={[46.603354, 1.888334] as any}
                    zoom={6}
                    style={{ height: '100%', width: '100%', minHeight: 620 }}
                    ref={(mapInstance: any) => { if (mapInstance) leafletMapRef.current = mapInstance }}
                  >
                    <TileLayer
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://api.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=3750cd83dca34199969e6b9e2dcdca40"
                    />
                    {mapRowsWithCoords.map((client) => {
                      const sector = getMapSectorLabel(client)
                      return (
                        <CircleMarker
                          key={`${client.numero}-${client.siret || client.id}`}
                          center={[client.latitude as number, client.longitude as number]}
                          radius={7}
                          pathOptions={{
                            color: '#facc15',
                            fillColor: getMapSectorColor(sector),
                            fillOpacity: 0.95,
                            weight: 3,
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -8]} opacity={1} sticky>
                            <div style={{ fontSize: 13, lineHeight: 1.45, minWidth: 260 }}>
                              <div style={{ fontWeight: 800 }}>{client.numero} — {client.raison_sociale_affichee || client.intitule}</div>
                              <div>{sector}</div>
                              <div>{client.codePostalEtablissement || '—'} {client.libelleCommuneEtablissement || ''}</div>
                              <div><b>SIRET :</b> {client.siret || 'NC'}</div>
                              <div><b>CA 12M :</b> {formatKEurBlank(client.ca12m)} · {client.caBandN}</div>
                              <div><b>CA N-1 :</b> {formatKEurBlank(client.caN1)} · {client.caBandN1}</div>
                              <div><b>CA N-2 :</b> {formatKEurBlank(client.caN2)} · {client.caBandN2}</div>
                              <div><b>RGE :</b> {hasPositiveValue(client.rge) || hasPositiveValue(client.rge_domaines_travaux) ? 'OUI' : 'NON'}</div>
                              <div><b>Capacité :</b> {client.capacite_gaz ? 'OUI' : 'NON'}</div>
                              <div><b>Capital social :</b> {client.capital_social || 'NC'}</div>
                            </div>
                          </Tooltip>
                        </CircleMarker>
                      )
                    })}
                  </MapContainer>
                </div>
                <div className="mapSideList">
                  <div className="mapSideTitle">Entreprises visibles ({mapRowsWithCoords.length})</div>
                  {mapRowsWithCoords.map((client) => {
                    const sector = getMapSectorLabel(client)
                    return (
                      <div key={`side-${client.numero}-${client.siret || client.id}`} className="mapSideRow" style={{ borderLeftColor: getMapSectorColor(sector) }}>
                        <strong>{client.numero} — {client.raison_sociale_affichee || client.intitule}</strong>
                        <span>{client.libelleCommuneEtablissement || 'Ville NC'} · {sector}</span>
                        <em>12M {client.caBandN} · N-1 {client.caBandN1} · N-2 {client.caBandN2}</em>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .page { padding: 18px; background: #f6f8fb; min-height: 100vh; color: #0f172a; }
        .toolbar { display: flex; gap: 18px; justify-content: space-between; align-items: end; margin-bottom: 12px; }
        h1 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.02em; }
        p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
        .toolbarActions { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; justify-content: flex-end; }
        label { font-size: 11px; font-weight: 800; color: #475569; display: flex; flex-direction: column; gap: 3px; text-transform: uppercase; }
        select, button, input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; background: white; font-size: 12px; }
        button { cursor: pointer; font-weight: 800; background: #0f172a; color: white; border-color: #0f172a; }
        button:disabled { opacity: .45; cursor: not-allowed; }
        .emptyState { background: white; border: 1px dashed #94a3b8; border-radius: 14px; padding: 26px; color: #475569; font-weight: 900; text-align: center; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
        .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 10px; margin-bottom: 10px; font-weight: 700; }
        .loading { position: fixed; right: 18px; bottom: 18px; background: #0f172a; color: white; padding: 8px 12px; border-radius: 999px; z-index: 20; font-weight: 900; }
        .kpis { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }
        .kpis div { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
        .kpis span { display: block; color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
        .kpis strong { display: block; margin-top: 2px; font-size: 18px; font-weight: 950; }
        .tableShell { overflow: auto; height: calc(100vh - 210px); border: 2px solid #0f172a; background: white; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
        .synthTable { border-collapse: separate; border-spacing: 0; font-size: 11px; table-layout: fixed; }
        th, td { border-right: 1px solid #111827; border-bottom: 1px solid #111827; padding: 2px 4px; height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #fffdf3; }
        thead th { position: sticky; top: 0; z-index: 5; background: #f8fafc; text-align: center; font-weight: 950; }
        .groupRow th { top: 0; height: 24px; font-size: 11px; background: #fff7df; border-top: 2px solid #111827; }
        .headerRow th { top: 25px; height: 108px; vertical-align: bottom; background: #f8fafc; }
        .filterRow th { top: 134px; height: 25px; background: #f8fafc; padding: 1px; }
        .filterRow input { width: 95%; height: 19px; padding: 1px 3px; font-size: 10px; border-radius: 3px; }
        .rotate span { writing-mode: vertical-rl; transform: rotate(180deg); display: inline-block; max-height: 96px; }
        .client, .stickyCollaborateur, .stickyCode, .stickyLabel, .stickyMonth { background: #e2f0d9; }
        .stickyCollaborateur { position: sticky; left: 0; z-index: 4; }
        .stickyCode { position: sticky; left: 0; z-index: 4; }
        .stickyLabel { position: sticky; left: 86px; z-index: 4; }
        .stickyMonth { position: sticky; left: 296px; z-index: 4; border-right: 3px solid #111827; }
        .withCollaborateur .stickyCode { left: 130px; }
        .withCollaborateur .stickyLabel { left: 216px; }
        .withCollaborateur .stickyMonth { left: 426px; }
        thead .stickyCollaborateur, thead .stickyCode, thead .stickyLabel, thead .stickyMonth { z-index: 8; }
        tbody tr.total td { background: #fff2cc; font-weight: 950; }
        tbody tr.client td { background: #e2f0d9; }
        tbody tr.month td { background: #edf7e7; font-style: italic; }
        td.num { text-align: right; }
        .metric { background: #fff7e6; }
        .devis { border-left: 3px solid #ffbf00; }
        .ca { border-left: 3px solid #111827; }
        .margin { border-left: 3px solid #111827; }
        .redLabel, .redLabel span { color: #e60000; font-weight: 950; }
        .groupComparatif, .groupComparatif { background: #f3e8ff !important; }
        .groupQRC { background: #e9f7e6 !important; }
        .groupDynamismeClient { background: #eff6ff !important; }
        .groupFréquencevisite, .groupVisite { background: #fff7ed !important; }
        .expandBtn { padding: 0; margin-right: 3px; width: 17px; height: 17px; border-radius: 4px; font-size: 11px; line-height: 12px; display: inline-flex; align-items: center; justify-content: center; }
        .editInput, .editSelect { width: 100%; height: 20px; padding: 1px 3px; border-radius: 3px; font-size: 11px; background: #ffffff; }
        .saving { opacity: .55; }

        .compareCell span { display: inline-block; white-space: normal; line-height: 1.15; }
        .caProfileCell span { white-space: normal; line-height: 1.15; font-size: 10px; font-weight: 800; color: #14532d; }
        .mapOverlay { position: fixed; inset: 0; background: rgba(15,23,42,.45); z-index: 80; padding: 24px; display: flex; align-items: stretch; justify-content: center; }
        .mapModal { width: min(1680px, 100%); background: white; border-radius: 18px; box-shadow: 0 24px 70px rgba(15,23,42,.35); display: flex; flex-direction: column; overflow: hidden; }
        .mapHeader { padding: 16px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e2e8f0; }
        .mapHeader h2 { margin: 0; font-size: 22px; font-weight: 950; }
        .mapWarning { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: #fff7ed; color: #9a3412; font-weight: 800; }
        .mapLegend { padding: 10px 18px; display: flex; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
        .legendItem { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 800; color: #334155; }
        .legendItem i { width: 12px; height: 12px; border-radius: 50%; border: 1px solid #475569; display: inline-block; }
        .legendItem .clientBorder { background: #94a3b8; border: 3px solid #facc15; box-sizing: border-box; }
        .mapEmpty { flex: 1; min-height: 520px; display: flex; align-items: center; justify-content: center; color: #475569; font-weight: 900; font-size: 16px; }
        .mapGrid { flex: 1; padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 14px; min-height: 650px; background: #f8fafc; }
        .leafletShell { border-radius: 16px; overflow: hidden; border: 1px solid #cbd5e1; background: white; min-height: 620px; }
        .mapSideList { border-radius: 16px; border: 1px solid #cbd5e1; background: white; overflow: hidden; display: flex; flex-direction: column; min-height: 620px; }
        .mapSideTitle { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; font-weight: 950; background: #fff; }
        .mapSideRow { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; border-left: 6px solid #cbd5e1; display: flex; flex-direction: column; gap: 3px; }
        .mapSideRow strong { font-size: 13px; }
        .mapSideRow span { font-size: 12px; color: #475569; }
        .mapSideRow em { font-style: normal; font-size: 11px; color: #14532d; font-weight: 900; }
      `}</style>
    </main>
  )
}

function getSelectionOptions(mode: ModeSelection, tiers: TiersRow[], collaborateurs: CollaborateurRow[]) {
  if (mode === 'collaborateur') {
    return Array.from(new Set(tiers.map((t) => t.collaborateur).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
  }
  return Array.from(new Set([
    ...tiers.map((t) => t.agence),
    ...collaborateurs.map((c) => c.agence),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
}

function stickyClass(sticky?: ColumnDef['sticky']) {
  if (sticky === 'collaborateur') return 'stickyCollaborateur'
  if (sticky === 'code') return 'stickyCode'
  if (sticky === 'label') return 'stickyLabel'
  if (sticky === 'month') return 'stickyMonth'
  return ''
}

function groupClass(group: string) {
  return `group${group.replace(/[^A-Za-zÀ-ÿ0-9]/g, '')}`
}

function EditableCell({ type, value, saving, onSave }: { type: ObjectiveType; value: string; saving: boolean; onSave: (value: string) => void }) {
  const [local, setLocal] = useState(value)

  useEffect(() => { setLocal(value) }, [value])

  if (type === 'action') {
    return (
      <select className={`editSelect ${saving ? 'saving' : ''}`} value={local} onChange={(e) => { setLocal(e.target.value); onSave(e.target.value) }}>
        <option value=""></option>
        <option value="0">0</option>
        <option value="1">1</option>
        <option value="2">2</option>
      </select>
    )
  }

  return (
    <input
      className={`editInput ${saving ? 'saving' : ''}`}
      type={type === 'date' ? 'date' : type === 'texte' ? 'text' : 'number'}
      step={type === 'montant' ? '100' : '1'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onSave(local)}
    />
  )
}
