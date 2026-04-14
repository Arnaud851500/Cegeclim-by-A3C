'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx-js-style'
import jsPDF from 'jspdf'
import autoTable, { Row } from 'jspdf-autotable'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'
import dynamic from 'next/dynamic'
import { logRecordDiff } from '@/lib/audit'
import { usePathname } from 'next/navigation'

const MapContainer: any = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer as any),
  { ssr: false }
)

const TileLayer: any = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer as any),
  { ssr: false }
)

const CircleMarker: any = dynamic(
  () => import('react-leaflet').then((mod) => mod.CircleMarker as any),
  { ssr: false }
)

const Tooltip: any = dynamic(
  () => import('react-leaflet').then((mod) => mod.Tooltip as any),
  { ssr: false }
)

const Popup: any = dynamic(
  () => import('react-leaflet').then((mod) => mod.Popup as any),
  { ssr: false }
)
type ClientMapRow = {
  id: string
  siret: string | null
  raison_sociale_affichee: string | null
  naf_libelle_traduit: string | null
  dateCreationEtablissement: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  coordonneeLambertAbscisseEtablissement: number | null
  coordonneeLambertOrdonneeEtablissement: number | null
  latitude: number | null
  longitude: number | null

  is_client_cegeclim: boolean
  statut_carte: 'CLIENT_CEGECLIM' | 'PROSPECT'

  numero_client_sage: string | null
  designation_commerciale: string | null
  representant: string | null
  date_creation: string | null
  agence: string | null
  cp_sage: string | null
  ville_sage: string | null
  remarque: string | null
  ca_2023: number | null
  ca_2024: number | null
  ca_2025: number | null
  statut: string | null
}

type ClientRow = {
  id: string
  siret: string | null
  raison_sociale_affichee: string | null
  activitePrincipaleEtablissement: string | null
  naf_libelle_traduit: string | null
  dateCreationEtablissement: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  departement: string | null
  etatAdministratifUniteLegale: string | null
  coordonneeLambertAbscisseEtablissement: number | null
  coordonneeLambertOrdonneeEtablissement: number | null
  latitude: number | null
  longitude: number | null
  telephone: string | null
  email: string | null
  site_web: string | null
  nom_dirigeant: string | null
  effectif_estime: number | null
  ca_estime: number | null
  pappers_ca: number | null
  pappers_resultat: number | null
  rge: boolean | null
  potentiel_score: number | null
  enrichment_status: string | null
  last_enrichment_at: string | null
  enrichment_source: string | null
  enrichment_error: string | null
  google_maps_url: string | null
  google_rating: number | null
  google_user_ratings_total: number | null
  present_dans_cegeclim: string | boolean | null
  contactable: boolean | null
  adresse_complete: string | null
  trancheEffectifsEtablissement: string | null
  date_import: string | null
  prospect_status: string | null
  assigned_to: string | null
  last_contact_at: string | null
  next_action_at: string | null
  next_action_label: string | null
  prospect_comment: string | null
  client_a_suivre: boolean | null
}

type ProspectStatusValue =
  | ''
  | '1 : A contacter'
  | '2 : A relancer'
  | '3 : Rdv pris'
  | '4 : Proposition faite'
  | '5 : Client non intéressé'
  | '6 : Ne pas poursuivre'
  | '7 : Abandon'

type CegeclimAbsentRow = {
  id: string
  siret: string | null
  date_creation_client: string | null
  agence_rattachement: string | null
  code_postal: string | null
  contact: string | null
  telephone: string | null
  email: string | null
  ca_2026: number | null
}

type ClientCegeclimRow = {
  siret: string | null
  numero_client_sage: string | null
  designation_commerciale: string | null
  representant: string | null
  date_creation: string | null
  agence: string | null
  cp_sage: string | null
  ville_sage: string | null
  remarque: string | null
  ca_2023: number | null
  ca_2024: number | null
  ca_2025: number | null
  statut: string | null
}

type ImportRow = {
  id: string
  nom_fichier: string
  type_import: string
  nb_lignes_source: number
  nb_importees: number
  nb_mises_a_jour: number
  nb_rejets: number
  date_import: string
  commentaire: string | null
}

type RejectRow = {
  id: string
  import_id: string
  ligne_numero: number
  siret: string | null
  motif_rejet: string
  donnees_source_json: Record<string, unknown> | null
  created_at: string
}

type AgenceRow = {
  id: string
  agence: string | null
  societe: string | null
  coord_x_lambert: number | null
  coord_y_lambert: number | null
}

type TerritoryRow = {
  code_dep: string | null
  societe: string | null
}

type SireneImportParamRow = {
  id: string
  codes_ape: string[] | null
  departements: string[] | null
  date_creation_min: string | null
  date_creation_max: string | null
  date_modification_min: string | null
  date_modification_max: string | null
  last_import_at: string | null
  created_at: string | null
  updated_at: string | null
}

type UserDepartmentAccessRow = {
  email: string
  allowed_departements: string[] | null
}

type ImportStats = {
  total: number
  inserted: number
  updated: number
  rejected: number
}

type ScreenMode = 'clients' | 'cegeclim_absents'
type SortDirection = 'asc' | 'desc'

type SortKey =
  | 'designation'
  | 'siret'
  | 'departement'
  | 'ville'
  | 'codePostal'
  | 'naf'
  | 'secteur'
  | 'creation'
  | 'anciennete'
  | 'telephone'
  | 'email'
  | 'distance'
  | 'completeness'
  | 'enrichment'

type SireneParamsForm = {
  codesApe: string
  departements: string
  dateCreationMin: string
  dateCreationMax: string
  dateMajMin: string
  dateMajMax: string
}

const MAX_AGE_DAYS = 365 * 50
const CLIENTS_PAGE_SIZE = 200
const SUPABASE_FETCH_BATCH = 50000
const INITIAL_CLIENTS_BATCH = 50000
const MAX_BATCH_ENRICH = 1000

const PROSPECT_STATUS_OPTIONS: ProspectStatusValue[] = [
  '1 : A contacter',
  '2 : A relancer',
  '3 : Rdv pris',
  '4 : Proposition faite',
  '5 : Client non intéressé',
  '6 : Ne pas poursuivre',
  '7 : Abandon',
]

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function parseMaybeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function buildRaisonSociale(row: Record<string, unknown>) {
  const denomination =
    String(row.denominationUniteLegale ?? '').trim() ||
    String(row.denominationUsuelleEtablissement ?? '').trim()

  if (denomination) return denomination

  const nom = String(row.nomUniteLegale ?? '').trim()
  const prenom = String(row.prenom1UniteLegale ?? '').trim()
  return `${nom} ${prenom}`.trim() || null
}

function buildAdresseComplete(row: Record<string, unknown>) {
  const parts = [
    String(row.numeroVoieEtablissement ?? '').trim(),
    String(row.typeVoieEtablissement ?? '').trim(),
    String(row.libelleVoieEtablissement ?? '').trim(),
    String(row.complementAdresseEtablissement ?? '').trim(),
    String(row.codePostalEtablissement ?? '').trim(),
    String(row.libelleCommuneEtablissement ?? '').trim(),
  ].filter(Boolean)

  return parts.join(' ') || null
}

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function getDepartmentFromPostalCode(cp: string | null | undefined): string | null {
  const value = String(cp || '').trim()
  if (!value) return null
  if (/^\d{5}$/.test(value)) {
    if (value.startsWith('97') || value.startsWith('98')) return value.slice(0, 3)
    return value.slice(0, 2)
  }
  return null
}

function diffDaysFromToday(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const ref = new Date(d)
  ref.setHours(0, 0, 0, 0)

  return Math.floor((today.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24))
}

function isFutureDate(dateStr: string | null): boolean {
  const days = diffDaysFromToday(dateStr)
  return days !== null && days < 0
}

function formatAgePrecise(days: number | null): string {
  if (days === null) return 'NC'
  if (days < 0) return 'Future'
  if (days < 14) return `${days} jour${days > 1 ? 's' : ''}`
  if (days < 90) {
    const weeks = Math.round(days / 7)
    return `${weeks} semaine${weeks > 1 ? 's' : ''}`
  }
  if (days < 730) {
    const months = Math.round(days / 30.4)
    return `${months} mois`
  }
  const years = Math.floor(days / 365.25)
  const months = Math.floor((days % 365.25) / 30.4)
  if (months === 0) return `${years} an${years > 1 ? 's' : ''}`
  return `${years} ans ${months} mois`
}

function sliderToDays(sliderValue: number): number {
  if (sliderValue <= 40) return Math.round((sliderValue / 40) * 365)
  if (sliderValue <= 70) return Math.round(365 + ((sliderValue - 40) / 30) * (1825 - 365))
  return Math.round(1825 + ((sliderValue - 70) / 30) * (MAX_AGE_DAYS - 1825))
}

function daysToSlider(days: number): number {
  if (days <= 365) return Math.round((days / 365) * 40)
  if (days <= 1825) return Math.round(40 + ((days - 365) / (1825 - 365)) * 30)
  return Math.round(70 + ((days - 1825) / (MAX_AGE_DAYS - 1825)) * 30)
}

function distanceKmLambert(
  x1: number | null | undefined,
  y1: number | null | undefined,
  x2: number | null | undefined,
  y2: number | null | undefined
): number | null {
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null
  const dx = Number(x1) - Number(x2)
  const dy = Number(y1) - Number(y2)
  const meters = Math.sqrt(dx * dx + dy * dy)
  return Math.round((meters / 1000) * 10) / 10
}

function lambert93ToWgs84(
  x: number | null | undefined,
  y: number | null | undefined
): { latitude: number; longitude: number } | null {
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
    latRad =
      2 *
        Math.atan(
          Math.pow((1 + e * Math.sin(latRad)) / (1 - e * Math.sin(latRad)), e / 2) *
            Math.exp(latIso)
        ) -
      Math.PI / 2
  }

  return {
    latitude: (latRad * 180) / Math.PI,
    longitude: (lonRad * 180) / Math.PI,
  }
}

function ensureClientCoordinates<T extends ClientRow>(row: T): T {
  const hasLatLon =
    typeof row.latitude === 'number' &&
    Number.isFinite(row.latitude) &&
    typeof row.longitude === 'number' &&
    Number.isFinite(row.longitude)

  if (hasLatLon) return row

  const converted = lambert93ToWgs84(
    row.coordonneeLambertAbscisseEtablissement,
    row.coordonneeLambertOrdonneeEtablissement
  )

  if (!converted) return row

  return {
    ...row,
    latitude: converted.latitude,
    longitude: converted.longitude,
  }
}

function formatDateFr(dateStr: string | null | undefined): string {
  if (!dateStr) return 'ND'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 'ND'
  return d.toLocaleDateString('fr-FR')
}

function formatDateTimeFr(dateStr: string | null | undefined): string {
  if (!dateStr) return 'NC'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 'NC'
  return d.toLocaleString('fr-FR')
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return 'NC'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Number(value))
}
function truncateText(value: string | null | undefined, max = 25): string {
  const text = String(value || '').trim()
  if (!text) return 'ND'
  return text.length > max ? text.slice(0, max) + '…' : text
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function translateNaf(activitePrincipaleEtablissement: string | null): string {
  const code = (activitePrincipaleEtablissement || '').replace(/\s/g, '').toUpperCase()
  if (!code) return 'AUTRES'
  if (code.startsWith('43.22B') || code.startsWith('4322B')) return 'Installateur CVC'
  if (code.startsWith('43.22A') || code.startsWith('4322A')) return 'Plomberie'
  if (code.startsWith('43.21') || code.startsWith('4321')) return 'Electricité ENR'
  if (code.startsWith('41.20') || code.startsWith('4120')) return 'CMI'
  if (code.startsWith('43.99') || code.startsWith('4399')) return 'Bâtiment'
  return 'AUTRES'
}

function getSectorColor(sector: string | null | undefined) {
  const s = (sector || '').toLowerCase()
  if (s.includes('installateur') || s.includes('cvc')) return '#8ba9be'
  if (s.includes('enr')) return '#a2cc88'
  if (s.includes('plomberie')) return '#c3b691'
  if (s.includes('cmi')) return '#e0a961'
  if (s.includes('bâtiment')) return '#8e9db3'
  return '#d9d9d9'
}

function getPresencePercentColor(percent: number): string {
  if (percent >= 15) return '#15803d'
  if (percent >= 12) return '#65a30d'
  if (percent >= 8) return '#eab308'
  if (percent >= 4) return '#f97316'
  return '#dc2626'
}

function getPresenceBarHeight(percent: number): number {
  return Math.max(15, Math.round((Math.max(0, Math.min(100, percent)) / 100) * 200))
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function compactSelectionLabel(values: string[], fallback = 'TOUS') {
  if (values.length === 0) return fallback
  if (values.length <= 2) return values.join(', ')
  return `${values.length} sélectionnés`
}

function normalizeScopeValue(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function getClientDepartment(row: ClientRow): string {
  return getDepartmentFromPostalCode(row.codePostalEtablissement) || String(row.departement || '').trim()
}

function getAbsentDepartment(row: CegeclimAbsentRow): string {
  return getDepartmentFromPostalCode(row.code_postal) || ''
}


function getClientSectorLabel(
  row: Pick<ClientRow, 'naf_libelle_traduit' | 'activitePrincipaleEtablissement'>
): string {
  return row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement)
}

function getCegeclimPresenceValue(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'NON'

  const normalized = raw.toUpperCase()
  if (normalized === 'NON') return 'NON'
  if (normalized === 'FALSE') return 'NON'
  if (normalized === '0') return 'NON'
  if (normalized === 'NULL') return 'NON'
  if (normalized === 'UNDEFINED') return 'NON'

  return raw
}

function isClientPresentInCegeclimValue(value: unknown): boolean {
  return getCegeclimPresenceValue(value) !== 'NON'
}

function getClientCegeclimCode(
  row: Pick<ClientRow, 'siret' | 'present_dans_cegeclim'>,
  activeCegeclimBySiret: Map<string, string>
): string {
  const normalizedSiret = normalizeSiret(row.siret)
  if (normalizedSiret && activeCegeclimBySiret.has(normalizedSiret)) {
    return activeCegeclimBySiret.get(normalizedSiret) || 'NON'
  }
  return 'NON'
}

function isClientPresentInCegeclim(
  row: Pick<ClientRow, 'siret' | 'present_dans_cegeclim'>,
  activeCegeclimBySiret: Map<string, string>
): boolean {
  return getClientCegeclimCode(row, activeCegeclimBySiret) !== 'NON'
}


function getClientCegeclimRow(
  row: Pick<ClientRow, 'siret'> | null | undefined,
  cegeclimDetailsBySiret: Map<string, ClientCegeclimRow>
): ClientCegeclimRow | null {
  const normalizedSiret = normalizeSiret(row?.siret)
  if (!normalizedSiret) return null
  return cegeclimDetailsBySiret.get(normalizedSiret) || null
}

function isClientClosedAdministratively(row: Pick<ClientRow, 'etatAdministratifUniteLegale'>): boolean {
  return String(row.etatAdministratifUniteLegale || '').trim().toUpperCase() === 'C'
}

function isCegeclimSommeilStatus(status: string | null | undefined): boolean {
  return String(status || '').trim().toLowerCase() === 'sommeil'
}

function isCegeclimActiveRow(row: ClientCegeclimRow | null | undefined): boolean {
  return Boolean(row) && !isCegeclimSommeilStatus(row?.statut)
}

function getCompletenessPercent(row: ClientRow): number {
  const checks = [
    Boolean(row.telephone),
    Boolean(row.site_web),
    Boolean(row.google_maps_url),
    row.google_rating != null,
    row.google_user_ratings_total != null,
  ]
  const filled = checks.filter(Boolean).length
  return Math.round((filled / checks.length) * 100)
}


function getCompletenessColor(percent: number): string {
  if (percent >= 80) return '#15803d'
  if (percent >= 60) return '#65a30d'
  if (percent >= 40) return '#d97706'
  return '#b91c1c'
}

function getEnrichmentBadge(status: string | null | undefined) {
  const normalized = String(status || '').toLowerCase().trim()
  if (normalized === 'ok') return { label: 'OK', bg: '#166534', color: '#fff' }
  if (normalized === 'en_cours') return { label: 'En cours', bg: '#92400e', color: '#fff' }
  if (normalized === 'erreur') return { label: 'Erreur', bg: '#991b1b', color: '#fff' }
  return { label: 'À faire', bg: '#475569', color: '#fff' }
}

function normalizeProspectStatus(value: unknown): ProspectStatusValue {
  const raw = String(value ?? '').trim() as ProspectStatusValue
  if (PROSPECT_STATUS_OPTIONS.includes(raw)) return raw
  return ''
}

function getProspectStatusColors(value: ProspectStatusValue) {
  if (value === '1 : A contacter' || value === '2 : A relancer') {
    return { background: '#fed7aa', color: '#9a3412', borderColor: '#fdba74' }
  }

  if (value === '3 : Rdv pris' || value === '4 : Proposition faite') {
    return { background: '#bbf7d0', color: '#166534', borderColor: '#86efac' }
  }

  if (value === '5 : Client non intéressé' || value === '6 : Ne pas poursuivre' || value === '7 : Abandon') {
    return { background: '#e5e7eb', color: '#374151', borderColor: '#cbd5e1' }
  }

  return { background: '#ffffff', color: '#475569', borderColor: '#cbd5e1' }
}

function formatDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return ''
  }
  return d.toISOString().slice(0, 10)
}

function buildDefaultSireneParams(lastImport: ImportRow | null): SireneParamsForm {
  const defaultMin = lastImport?.date_import ? formatDateInput(lastImport.date_import) : ''
  return {
    codesApe: '',
    departements: '',
    dateCreationMin: '',
    dateCreationMax: '',
    dateMajMin: '',
    dateMajMax: '',
  }
}

async function fetchAllClients(): Promise<{ rows: ClientRow[]; totalCount: number }> {
  const allRows: ClientRow[] = []
  let from = 0
  let totalCount = 0

  while (true) {
    const { data, error, count } = await supabase
      .from('clients')
      .select(
        `
        id,
        siret,
        raison_sociale_affichee,
        activitePrincipaleEtablissement,
        naf_libelle_traduit,
        dateCreationEtablissement,
        codePostalEtablissement,
        libelleCommuneEtablissement,
        departement,
        etatAdministratifUniteLegale,
        coordonneeLambertAbscisseEtablissement,
        coordonneeLambertOrdonneeEtablissement,
        latitude,
        longitude,
        telephone,
        email,
        site_web,
        nom_dirigeant,
        effectif_estime,
        ca_estime,
        pappers_ca,
        pappers_resultat,
        rge,
        potentiel_score,
        enrichment_status,
        last_enrichment_at,
        enrichment_source,
        enrichment_error,
        google_maps_url,
        google_rating,
        google_user_ratings_total,
        present_dans_cegeclim,
        contactable,
        adresse_complete,
        trancheEffectifsEtablissement,
        date_import,
        prospect_status,
        assigned_to,
        last_contact_at,
        next_action_at,
        next_action_label,
        prospect_comment,
        client_a_suivre
      `,
        { count: 'exact' }
      )
      .range(from, from + SUPABASE_FETCH_BATCH - 1)

    if (error) throw error

    if (from === 0) totalCount = count || 0

    const batch = (data || []) as ClientRow[]
    allRows.push(...batch)

    if (batch.length < SUPABASE_FETCH_BATCH) break
    from += SUPABASE_FETCH_BATCH
  }

  return { rows: allRows, totalCount }
}

async function fetchClientsInitialBatch(): Promise<{ rows: ClientRow[]; totalCount: number }> {
  const { data, error, count } = await supabase
    .from('clients')
    .select(
      `
      id,
      siret,
      raison_sociale_affichee,
      activitePrincipaleEtablissement,
      naf_libelle_traduit,
      dateCreationEtablissement,
      codePostalEtablissement,
      libelleCommuneEtablissement,
      etatAdministratifUniteLegale,
      etatAdministratifEtablissement,
      departement,
      coordonneeLambertAbscisseEtablissement,
      coordonneeLambertOrdonneeEtablissement,
      latitude,
      longitude,
      telephone,
      email,
      site_web,
      nom_dirigeant,
      effectif_estime,
      ca_estime,
      pappers_ca,
      pappers_resultat,
      rge,
      potentiel_score,
      enrichment_status,
      last_enrichment_at,
      enrichment_source,
      enrichment_error,
      google_maps_url,
      google_rating,
      google_user_ratings_total,
      present_dans_cegeclim,
      contactable,
      adresse_complete,
      trancheEffectifsEtablissement,
      date_import,
      prospect_status,
      assigned_to,
      last_contact_at,
      next_action_at,
      next_action_label,
      prospect_comment,
      client_a_suivre
    `,
      { count: 'exact' }
    )
    .range(0, INITIAL_CLIENTS_BATCH - 1)

  if (error) throw error

  return {
    rows: (data || []) as ClientRow[],
    totalCount: count || 0,
  }
}

async function fetchCegeclimAbsentsRows(): Promise<CegeclimAbsentRow[]> {
  const { data, error } = await supabase
    .from('vw_clients_cegeclim_absents_clients')
    .select('id, siret, date_creation_client, agence_rattachement, code_postal, contact, telephone, email, ca_2026')

  if (error) throw error
  return (data || []) as CegeclimAbsentRow[]
}

async function fetchClientsCegeclimRows(): Promise<ClientCegeclimRow[]> {
  try {
    const { data, error } = await supabase
      .from('clients_cegeclim')
      .select(
        'siret, numero_client_sage, designation_commerciale, representant, date_creation, agence, cp_sage, ville_sage, statut, remarque, ca_2023, ca_2024, ca_2025'
      )

    if (error) {
      console.error('Erreur chargement clients_cegeclim:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      })
      return []
    }

    return ((data || []) as ClientCegeclimRow[]).filter(
      (row) => Boolean(normalizeSiret(row.siret))
    )
  } catch (error: any) {
    console.error('Erreur inattendue clients_cegeclim:', {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      raw: error,
    })
    return []
  }
}

async function fetchRejectRows(importId: string): Promise<RejectRow[]> {
  const { data, error } = await supabase
    .from('imports_clients_rejets')
    .select('id, import_id, ligne_numero, siret, motif_rejet, donnees_source_json, created_at')
    .eq('import_id', importId)
    .order('ligne_numero', { ascending: true })

  if (error) throw error
  return (data || []) as RejectRow[]
}

async function fetchClientBySiret(siret: string): Promise<ClientRow | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(
      `
      id,
      siret,
      raison_sociale_affichee,
      activitePrincipaleEtablissement,
      naf_libelle_traduit,
      dateCreationEtablissement,
      codePostalEtablissement,
      libelleCommuneEtablissement,
      departement,
      coordonneeLambertAbscisseEtablissement,
      coordonneeLambertOrdonneeEtablissement,
      latitude,
      longitude,
      telephone,
      email,
      site_web,
      nom_dirigeant,
      effectif_estime,
      ca_estime,
      pappers_ca,
      pappers_resultat,
      rge,
      potentiel_score,
      enrichment_status,
      last_enrichment_at,
      enrichment_source,
      enrichment_error,
      google_maps_url,
      google_rating,
      google_user_ratings_total,
      present_dans_cegeclim,
      contactable,
      adresse_complete,
      trancheEffectifsEtablissement,
      date_import,
      prospect_status,
      assigned_to,
      last_contact_at,
      next_action_at,
      next_action_label,
      prospect_comment,
      client_a_suivre
    `
    )
    .eq('siret', siret)
    .single()

  if (error || !data) return null
  return data as ClientRow
}

function SortIndicator({
  active,
  direction,
}: {
  active: boolean
  direction: SortDirection
}) {
  return (
    <span style={{ marginLeft: 6, color: active ? '#111' : '#888' }}>
      {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  )
}

function MultiSelectHorizontal({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleValue(value: string) {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div style={filterLabelStyle}>{label}</div>
      <button type="button" onClick={() => setOpen((v) => !v)} style={selectLikeStyle}>
        <span>{compactSelectionLabel(selected)}</span>
        <span>▼</span>
      </button>

      {open && (
        <div style={multiPanelStyle}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => onChange([])} style={miniButtonStyle}>
              Tout effacer
            </button>
            <button type="button" onClick={() => onChange(options)} style={miniButtonStyle}>
              Tout sélectionner
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
            {options.map((option) => (
              <label
                key={option}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleValue(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClientsPage() {
  const { societeFilter } = useSocieteFilter()
  const pathname = usePathname()

  const [mode, setMode] = useState<ScreenMode>('clients')

  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientsTotalCount, setClientsTotalCount] = useState<number>(0)
  const [cegeclimAbsents, setCegeclimAbsents] = useState<CegeclimAbsentRow[]>([])
  const [clientsCegeclim, setClientsCegeclim] = useState<ClientCegeclimRow[]>([])
  const [agences, setAgences] = useState<AgenceRow[]>([])
  const [territories, setTerritories] = useState<TerritoryRow[]>([])
  const [lastImport, setLastImport] = useState<ImportRow | null>(null)
  const [rejects, setRejects] = useState<RejectRow[]>([])
  const [sireneConfigId, setSireneConfigId] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [allowedDepartements, setAllowedDepartements] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapClients, setMapClients] = useState<ClientRow[]>([])
  const leafletMapRef = useRef<any>(null)
  const [mapTitle, setMapTitle] = useState('')
  const [mapInstanceKey, setMapInstanceKey] = useState(0)
  const [showMapCegeclim, setShowMapCegeclim] = useState(true)
  const [showMapProspects, setShowMapProspects] = useState(true)
  const [mapSectorVisibility, setMapSectorVisibility] = useState<Record<string, boolean>>({})
  const [mapAgeSliderMin, setMapAgeSliderMin] = useState(daysToSlider(0))
  const [mapAgeSliderMax, setMapAgeSliderMax] = useState(daysToSlider(MAX_AGE_DAYS))
  const [showCegeclimPresenceModal, setShowCegeclimPresenceModal] = useState(false)
  
  function openPreviousClient() {
  if (!previousClient) return
  setSelectedClient(previousClient)
}

function openNextClient() {
  if (!nextClient) return
  setSelectedClient(nextClient)
}

async function saveSelectedClientField(field: 'prospect_comment' | 'prospect_status', value: string) {
  if (!selectedClient?.id) return

  const currentId = selectedClient.id
  const beforeRow = { ...selectedClient }

  const normalizedValue = field === 'prospect_status' ? normalizeProspectStatus(value) || null : value

  const afterRow = {
    ...selectedClient,
    [field]: normalizedValue,
  } as ClientRow

  setSelectedClient(afterRow)
  setClients((prev) => prev.map((row) => (row.id === currentId ? ({ ...row, [field]: normalizedValue } as ClientRow) : row)))
  setMapClients((prev) => prev.map((row) => (row.id === currentId ? ({ ...row, [field]: normalizedValue } as ClientRow) : row)))

  const { error } = await supabase
    .from('clients')
    .update({ [field]: normalizedValue })
    .eq('id', currentId)

  if (error) {
    console.error(error)
    alert("Erreur lors de l'enregistrement de la fiche client.")
    await loadAll()
    return
  }

  await logRecordDiff({
    user_email: currentUserEmail,
    pathname,
    event_type: 'client_update',
    entity_type: 'clients',
    entity_id: String(selectedClient.siret || selectedClient.id),
    entity_label: String(selectedClient.raison_sociale_affichee || ''),
    before: beforeRow as Record<string, unknown>,
    after: afterRow as Record<string, unknown>,
    trackedFields: [field],
  })
}

  async function launchImportSirene() {
    setImporting(true)

    try {
      const res = await fetch('/api/import-sirene', {
        method: 'POST',
      })

      const text = await res.text()

      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(text)
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erreur import SIRENE')
      }

      
    alert(
  `Import terminé : ${data.total || 0} lignes\n` +
  `Pages lues : ${data.pages || 0}\n` +
  `Enregistrements parcourus : ${data.fetched || 0}\n` +
  `Total API : ${data.api_total || 0}`

  

)


      await loadAll()
    } catch (error: any) {
      console.error(error)
      alert('Erreur import : ' + (error?.message || String(error)))
    } finally {
      setImporting(false)
    }
  }


  const [importStats, setImportStats] = useState<ImportStats | null>(null)
  const [savingSireneParams, setSavingSireneParams] = useState(false)

  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null)
  const [showRejects, setShowRejects] = useState(false)

  const [showClientsSection, setShowClientsSection] = useState(true)
  const [showImportsSection, setShowImportsSection] = useState(true)

  const [sireneParams, setSireneParams] = useState<SireneParamsForm>(buildDefaultSireneParams(null))
  
  const [search, setSearch] = useState('')
  const [designationSearch, setDesignationSearch] = useState('')
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([])
  const [selectedSectors, setSelectedSectors] = useState<string[]>([])
  const [selectedNafCodes, setSelectedNafCodes] = useState<string[]>([])
  const [selectedAgence, setSelectedAgence] = useState('TOUS')
  const [selectedClientScope, setSelectedClientScope] = useState<'Tous' | 'Cegeclim' | 'Prospects'>('Tous')
  const [selectedProspectStatuses, setSelectedProspectStatuses] = useState<ProspectStatusValue[]>([])

  const [includeNoDistance, setIncludeNoDistance] = useState(true)
  const [onlyContactable, setOnlyContactable] = useState(false)
  const [onlyNotInCegeclim, setOnlyNotInCegeclim] = useState(false)
  const [onlyPresentInCegeclim, setOnlyPresentInCegeclim] = useState(false)
  const [excludeDesignationND, setExcludeDesignationND] = useState(true)
  const [excludeFutureCreation, setExcludeFutureCreation] = useState(true)
  const [onlyToEnrich, setOnlyToEnrich] = useState(false)

  const [distanceMax, setDistanceMax] = useState(200)

  const [ageSliderMin, setAgeSliderMin] = useState(0)
  const [ageSliderMax, setAgeSliderMax] = useState(daysToSlider(7))

  const [sortKey, setSortKey] = useState<SortKey>('designation')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const [currentPage, setCurrentPage] = useState(1)
  const [enrichingSirets, setEnrichingSirets] = useState<string[]>([])
  const [batchEnriching, setBatchEnriching] = useState(false)
  const [backgroundHydratingClients, setBackgroundHydratingClients] = useState(false)
  const [cegeclimAbsentsLoaded, setCegeclimAbsentsLoaded] = useState(false)
  const [rejectsLoaded, setRejectsLoaded] = useState(false)


  const latestLoadTokenRef = useRef(0)

  useEffect(() => {
    void loadAll()
  }, [])

  useEffect(() => {
    if (mapOpen) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [mapOpen])

  useEffect(() => {
    if (selectedClient) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [selectedClient])

  useEffect(() => {
    setCurrentPage(1)
  }, [
    societeFilter,
    search,
    designationSearch,
    selectedDepartments,
    selectedSectors,
    selectedNafCodes,
    selectedAgence,
    selectedClientScope,
    selectedProspectStatuses,
    includeNoDistance,
    onlyContactable,
    onlyNotInCegeclim,
    onlyPresentInCegeclim,
    excludeDesignationND,
    excludeFutureCreation,
    onlyToEnrich,
    distanceMax,
    ageSliderMin,
    ageSliderMax,
    sortKey,
    sortDirection,
  ])


  useEffect(() => {
    if (mode !== 'cegeclim_absents' || cegeclimAbsentsLoaded) return

    void (async () => {
      try {
        const rows = await fetchCegeclimAbsentsRows()
        setCegeclimAbsents(rows)
        setCegeclimAbsentsLoaded(true)
      } catch (error) {
        console.error(error)
      }
    })()
  }, [mode, cegeclimAbsentsLoaded])

  useEffect(() => {
    if (!showRejects || !lastImport?.id || rejectsLoaded) return

    void (async () => {
      try {
        const rows = await fetchRejectRows(lastImport.id)
        setRejects(rows)
        setRejectsLoaded(true)
      } catch (error) {
        console.error(error)
      }
    })()
  }, [showRejects, lastImport?.id, rejectsLoaded])

  async function hydrateAllClientsInBackground(loadToken: number) {
  if (latestLoadTokenRef.current === loadToken) {
    setBackgroundHydratingClients(false)
  }
}


  async function loadAll() {
    setLoading(true)
    const loadToken = Date.now()
    latestLoadTokenRef.current = loadToken

    try {
      const authPromise = supabase.auth.getSession()
      const clientsPromise = fetchClientsInitialBatch()
      const clientsCegeclimPromise = fetchClientsCegeclimRows()
      const agencesPromise = supabase
        .from('agences')
        .select('id, agence, societe, coord_x_lambert, coord_y_lambert')
      const territoriesPromise = supabase.from('territories').select('code_dep, societe')
      const importPromise = supabase
        .from('imports_clients')
        .select('*')
        .in('type_import', ['entreprise_france', 'api_sirene'])
        .order('date_import', { ascending: false })
        .limit(1)
      const sireneParamsPromise = supabase
        .from('import_sirene_params')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)

      const [authRes, clientsRes, clientsCegeclimRes, agencesRes, territoriesRes, importRes, sireneParamsRes] =
        await Promise.all([
          authPromise,
          clientsPromise,
          clientsCegeclimPromise,
          agencesPromise,
          territoriesPromise,
          importPromise,
          sireneParamsPromise,
        ])

      if (agencesRes.error) throw agencesRes.error
      if (territoriesRes.error) throw territoriesRes.error
      if (importRes.error) throw importRes.error
      if (sireneParamsRes.error) throw sireneParamsRes.error

      const {
      data: { session },
      } = await supabase.auth.getSession()

      const userEmail = session?.user?.email?.toLowerCase().trim() || null
      setCurrentUserEmail(userEmail)

      if (userEmail) {
        const { data: userAccessData, error: userAccessError } = await supabase
          .from('user_page_access')
          .select('email, allowed_departements')
          .eq('email', userEmail)
          .maybeSingle()

        if (userAccessError) throw userAccessError

        const userAccess = userAccessData as UserDepartmentAccessRow | null
        setAllowedDepartements(
          Array.isArray(userAccess?.allowed_departements)
            ? userAccess!.allowed_departements.map((d) => String(d || '').trim()).filter(Boolean)
            : []
        )
      } else {
        setAllowedDepartements([])
      }

      const latestImport = (importRes.data?.[0] || null) as ImportRow | null
      const sireneConfig = (sireneParamsRes.data?.[0] || null) as SireneImportParamRow | null

      setClients(clientsRes.rows)
      setClientsCegeclim(clientsCegeclimRes)
      setClientsTotalCount(clientsRes.totalCount)
      setAgences((agencesRes.data || []) as AgenceRow[])
      setTerritories((territoriesRes.data || []) as TerritoryRow[])
      setLastImport(latestImport)
      setRejects([])
      setRejectsLoaded(false)
      setCegeclimAbsents([])
      setCegeclimAbsentsLoaded(false)

      if (sireneConfig) {
        setSireneConfigId(sireneConfig.id)
        setSireneParams({
          codesApe: (sireneConfig.codes_ape || []).join(', '),
          departements: (sireneConfig.departements || []).join(', '),
          dateCreationMin: formatDateInput(sireneConfig.date_creation_min),
          dateCreationMax: formatDateInput(sireneConfig.date_creation_max),
          dateMajMin: formatDateInput(sireneConfig.date_modification_min),
          dateMajMax: formatDateInput(sireneConfig.date_modification_max),
        })
      } else {
        setSireneConfigId(null)
        setSireneParams(buildDefaultSireneParams(latestImport))
      }

      if (clientsRes.totalCount > clientsRes.rows.length) {
        
      } else {
        setBackgroundHydratingClients(false)
      }
    } catch (error: any) {
      console.error('Erreur loadAll détaillée:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        raw: error,
      })
      alert(
        "Erreur lors du chargement de l'écran Clients : " +
          (error?.message || JSON.stringify(error))
      )
    } finally {
      setLoading(false)
    }
  }
async function openMapFromCell(secteur: string, departement: string | null) {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  setMapOpen(true)
  setMapLoading(true)
  setMapClients([])
  setShowMapCegeclim(false)
  setShowMapProspects(true)
  setMapAgeSliderMin(ageSliderMin)
  setMapAgeSliderMax(ageSliderMax)
  setMapInstanceKey((prev) => prev + 1)

  setMapTitle(
    departement
      ? `Carte - ${secteur} - Département ${departement}`
      : secteur === 'TOUS'
        ? 'Carte - Tous secteurs'
        : `Carte - ${secteur} - Global`
  )

  try {
    let rows = scopedClientsBase.map(ensureClientCoordinates)

    if (departement) {
      rows = rows.filter((row) => getClientDepartment(row) === departement)
    }

    if (secteur !== 'TOUS') {
      rows = rows.filter((row) => {
        const sector = getClientSectorLabel(row)
        return sector === secteur
      })
    }

    const nextSectorVisibility = Object.fromEntries(
      Array.from(new Set(rows.map((row) => getClientSectorLabel(row)).filter(Boolean))).map((sector) => [sector, true])
    ) as Record<string, boolean>

    setMapSectorVisibility(nextSectorVisibility)
    setMapClients(rows)
  } catch (err) {
    console.error(err)
    alert('Erreur chargement carte')
  } finally {
    setMapLoading(false)
  }
}
  async function saveSireneParams() {
    setSavingSireneParams(true)
    try {
      const payload = {
        codes_ape: sireneParams.codesApe
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        date_creation_min: sireneParams.dateCreationMin || null,
        date_creation_max: sireneParams.dateCreationMax || null,
        date_modification_min: sireneParams.dateMajMin || null,
        date_modification_max: sireneParams.dateMajMax || null,
        last_import_at: lastImport?.date_import || null,
        updated_at: new Date().toISOString(),
      }

      if (sireneConfigId) {
        const { error } = await supabase.from('import_sirene_params').update(payload).eq('id', sireneConfigId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('import_sirene_params')
          .insert(payload)
          .select('id')
          .single()
        if (error) throw error
        setSireneConfigId(data.id as string)
      }

      alert('Paramètres API Sirene enregistrés.')
    } catch (error) {
      console.error(error)
      alert('Erreur lors de la sauvegarde des paramètres API Sirene.')
    } finally {
      setSavingSireneParams(false)
    }
  }

  async function enrichClientBySiret(siret: string) {
    if (!siret) return
    setEnrichingSirets((prev) => [...prev, siret])

    try {
      const res = await fetch('/api/enrich-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siret }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Erreur enrichissement')
      }

      await loadAll()

      const refreshed = await fetchClientBySiret(siret)
      if (refreshed) setSelectedClient(refreshed)
    } catch (err) {
      console.error(err)
      alert(`Erreur enrichissement pour ${siret}`)
    } finally {
      setEnrichingSirets((prev) => prev.filter((x) => x !== siret))
    }
  }

  async function openClientFromMap(client: ClientRow) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const siret = normalizeSiret(client.siret)
    if (!siret) return

    const refreshed = await fetchClientBySiret(siret)
    if (refreshed) {
      setSelectedClient(refreshed)
      return
    }

    setSelectedClient(client)
  }

  async function enrichBatch(rows: ClientRow[]) {
    const targets = rows.filter((row) => row.siret).slice(0, MAX_BATCH_ENRICH)

    if (targets.length === 0) {
      alert('Aucune fiche à enrichir.')
      return
    }

    setBatchEnriching(true)

    let okCount = 0
    let partialCount = 0
    let errorCount = 0

    try {
      for (const row of targets) {
        const siret = row.siret as string
        setEnrichingSirets((prev) => [...prev, siret])

        try {
          const res = await fetch('/api/enrich-client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siret }),
          })

          const data = await res.json()

          if (res.ok && data?.success) {
            if (data?.warning) partialCount += 1
            else okCount += 1
          } else {
            errorCount += 1
          }
        } catch {
          errorCount += 1
        } finally {
          setEnrichingSirets((prev) => prev.filter((x) => x !== siret))
        }
      }

      await loadAll()

      alert(
        `Enrichissement Google terminé.\n` +
          `OK : ${okCount}\n` +
          `Partiel : ${partialCount}\n` +
          `Erreur : ${errorCount}`
      )
    } finally {
      setBatchEnriching(false)
    }
  }

  const normalizedSocieteFilter = useMemo(
    () => normalizeScopeValue(societeFilter),
    [societeFilter]
  )

  const allowedDepartments = useMemo(() => {
    if (normalizedSocieteFilter === 'global') return []
    return Array.from(
      new Set(
        territories
          .filter((row) => normalizeScopeValue(row.societe) === normalizedSocieteFilter)
          .map((row) => String(row.code_dep || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [territories, normalizedSocieteFilter])

  const allowedDepartmentSet = useMemo(() => new Set(allowedDepartments), [allowedDepartments])

  const scopedClients = useMemo(() => {
    let result = clients

    if (normalizedSocieteFilter !== 'global') {
      result = result.filter((row) => {
        const dep = getClientDepartment(row)
        return dep && allowedDepartmentSet.has(dep)
      })
    }

    if (allowedDepartements.length > 0) {
      const allowedDepartementsSet = new Set(allowedDepartements)
      result = result.filter((row) => {
        const dep = getClientDepartment(row)
        return dep && allowedDepartementsSet.has(dep)
      })
    }

    return result
  }, [clients, normalizedSocieteFilter, allowedDepartmentSet, allowedDepartements])

  const scopedCegeclimAbsents = useMemo(() => {
    let result = cegeclimAbsents

    if (normalizedSocieteFilter !== 'global') {
      result = result.filter((row) => {
        const dep = getAbsentDepartment(row)
        return dep && allowedDepartmentSet.has(dep)
      })
    }

    if (allowedDepartements.length > 0) {
      const allowedDepartementsSet = new Set(allowedDepartements)
      result = result.filter((row) => {
        const dep = getAbsentDepartment(row)
        return dep && allowedDepartementsSet.has(dep)
      })
    }

    return result
  }, [cegeclimAbsents, normalizedSocieteFilter, allowedDepartmentSet, allowedDepartements])

  const scopedClientsBase = useMemo(() => {
    return scopedClients.filter((row) => !isClientClosedAdministratively(row))
  }, [scopedClients])

  const scopedClientsCegeclim = useMemo(() => {
    const scopedSirets = new Set(scopedClientsBase.map((row) => normalizeSiret(row.siret)).filter(Boolean))
    return clientsCegeclim.filter((row) => {
      const siret = normalizeSiret(row.siret)
      return siret ? scopedSirets.has(siret) : false
    })
  }, [clientsCegeclim, scopedClientsBase])

  const activeCegeclimBySiret = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of clientsCegeclim) {
      const siret = normalizeSiret(row.siret)
      if (!siret || !isCegeclimActiveRow(row)) continue
      const numeroClientSage = String(row.numero_client_sage || '').trim()
      map.set(siret, numeroClientSage || 'OUI')
    }
    return map
  }, [clientsCegeclim])

  const sommeilCegeclimBySiret = useMemo(() => {
    const map = new Map<string, ClientCegeclimRow>()
    for (const row of clientsCegeclim) {
      const siret = normalizeSiret(row.siret)
      if (!siret || !isCegeclimSommeilStatus(row.statut)) continue
      map.set(siret, row)
    }
    return map
  }, [clientsCegeclim])


const mapClientsWithCoords = useMemo(() => {
  return mapClients.filter(
    (client) =>
      typeof client.latitude === 'number' &&
      typeof client.longitude === 'number' &&
      Number.isFinite(client.latitude) &&
      Number.isFinite(client.longitude)
  )
}, [mapClients])

function matchesMapCommonFilters(row: ClientRow) {
  const agenceCoords =
    selectedAgence === 'TOUS'
      ? null
      : agences.find((a) => a.agence === selectedAgence) || null

  const distance = agenceCoords
    ? distanceKmLambert(
        row.coordonneeLambertAbscisseEtablissement,
        row.coordonneeLambertOrdonneeEtablissement,
        agenceCoords.coord_x_lambert,
        agenceCoords.coord_y_lambert
      )
    : null

  if (search.trim()) {
    const q = search.trim().toLowerCase()
    const haystack = [
      row.siret,
      row.raison_sociale_affichee,
      row.naf_libelle_traduit,
      row.libelleCommuneEtablissement,
      row.codePostalEtablissement,
      row.telephone,
      row.email,
    ]
      .join(' ')
      .toLowerCase()

    if (!haystack.includes(q)) return false
  }

  if (designationSearch.trim()) {
    const q = designationSearch.trim().toLowerCase()
    if (!String(row.raison_sociale_affichee || '').toLowerCase().includes(q)) return false
  }

  if (selectedDepartments.length > 0) {
    const dep = getClientDepartment(row)
    if (!selectedDepartments.includes(dep)) return false
  }

  if (selectedSectors.length > 0) {
    const sector = translateNaf(row.activitePrincipaleEtablissement)
    if (!selectedSectors.includes(sector)) return false
  }

  if (selectedNafCodes.length > 0) {
    const naf = String(row.activitePrincipaleEtablissement || '').trim()
    if (!selectedNafCodes.includes(naf)) return false
  }

  if (onlyContactable && !row.contactable) return false

  if (selectedProspectStatuses.length > 0) {
    const prospectStatus = normalizeProspectStatus(row.prospect_status)
    if (!selectedProspectStatuses.includes(prospectStatus)) return false
  }

  if (excludeDesignationND) {
    const designation = String(row.raison_sociale_affichee || '').trim().toLowerCase()
    if (!designation || designation === 'nd') return false
  }

  if (excludeFutureCreation && isFutureDate(row.dateCreationEtablissement)) return false

  if (onlyToEnrich) {
    const badge = getEnrichmentBadge(row.enrichment_status)
    if (badge.label === 'OK') return false
  }

  if (selectedAgence !== 'TOUS') {
    if (distance == null) {
      if (!includeNoDistance) return false
    } else if (distance > distanceMax) {
      return false
    }
  }

  return true
}

function matchesMapProspectFilters(row: ClientRow) {
  if (!matchesMapCommonFilters(row)) return false
  return true
}

const mapCegeclimPoints = useMemo(() => {
  return mapClientsWithCoords.filter(
    (client) =>
      isClientPresentInCegeclim(client, activeCegeclimBySiret) &&
      matchesMapCommonFilters(client)
  )
}, [
  mapClientsWithCoords,
  activeCegeclimBySiret,
  search,
  designationSearch,
  selectedDepartments,
  selectedSectors,
  selectedNafCodes,
  selectedAgence,
  includeNoDistance,
  onlyContactable,
  selectedProspectStatuses,
  excludeDesignationND,
  excludeFutureCreation,
  onlyToEnrich,
  distanceMax,
  agences,
])

const mapProspectPoints = useMemo(() => {
  return mapClientsWithCoords.filter(
    (client) =>
      !isClientPresentInCegeclim(client, activeCegeclimBySiret) &&
      matchesMapProspectFilters(client)
  )
}, [
  mapClientsWithCoords,
  activeCegeclimBySiret,
  search,
  designationSearch,
  selectedDepartments,
  selectedSectors,
  selectedNafCodes,
  selectedAgence,
  includeNoDistance,
  onlyContactable,
  excludeDesignationND,
  excludeFutureCreation,
  onlyToEnrich,
  distanceMax,
  ageSliderMin,
  ageSliderMax,
  agences,
])

const mapLegendSectors = useMemo(() => {
  return Array.from(
    new Set(
      [...mapCegeclimPoints, ...mapProspectPoints]
        .map((client) => getClientSectorLabel(client))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'))
}, [mapCegeclimPoints, mapProspectPoints])



  const mapAgeDaysMin = useMemo(
    () => Math.min(sliderToDays(mapAgeSliderMin), sliderToDays(mapAgeSliderMax)),
    [mapAgeSliderMin, mapAgeSliderMax]
  )

  const mapAgeDaysMax = useMemo(
    () => Math.max(sliderToDays(mapAgeSliderMin), sliderToDays(mapAgeSliderMax)),
    [mapAgeSliderMin, mapAgeSliderMax]
  )

  const mapAgeRangeLabel = useMemo(
    () => `${formatAgePrecise(mapAgeDaysMin)} → ${formatAgePrecise(mapAgeDaysMax)}`,
    [mapAgeDaysMin, mapAgeDaysMax]
  )

const visibleMapPoints = useMemo(() => {
  return [
    ...(showMapCegeclim ? mapCegeclimPoints : []),
    ...(showMapProspects ? mapProspectPoints : []),
  ].filter((client) => {
    const sector = getClientSectorLabel(client)
    const isCegeclim = isClientPresentInCegeclim(client, activeCegeclimBySiret)

    if (mapSectorVisibility[sector] === false) return false

    if (!isCegeclim) {
      const ageDays = diffDaysFromToday(client.dateCreationEtablissement)
      if (ageDays === null) return false
      if (ageDays < mapAgeDaysMin || ageDays > mapAgeDaysMax) return false
    }

    return true
  })
}, [
  showMapCegeclim,
  showMapProspects,
  mapCegeclimPoints,
  mapProspectPoints,
  mapSectorVisibility,
  mapAgeDaysMin,
  mapAgeDaysMax,
  activeCegeclimBySiret,
])

const visibleMapRows = useMemo(() => {
  return [...visibleMapPoints].sort((a, b) =>
    String(a.raison_sociale_affichee || '').localeCompare(String(b.raison_sociale_affichee || ''), 'fr')
  )
}, [visibleMapPoints])

useEffect(() => {
  setMapSectorVisibility((prev) => {
    const next = { ...prev }
    let changed = false

    for (const sector of mapLegendSectors) {
      if (!(sector in next)) {
        next[sector] = true
        changed = true
      }
    }

    for (const key of Object.keys(next)) {
      if (!mapLegendSectors.includes(key)) {
        delete next[key]
        changed = true
      }
    }

    return changed ? next : prev
  })
}, [mapLegendSectors])

useEffect(() => {
  if (!mapOpen) return
  if (!visibleMapPoints.length) return

  let cancelled = false
  let attempts = 0

  const runFit = () => {
    if (cancelled) return

    const map = leafletMapRef.current
    if (!map || typeof map.invalidateSize !== 'function') {
      if (attempts < 10) {
        attempts += 1
        window.setTimeout(runFit, 120)
      }
      return
    }

    try {
      map.invalidateSize()

      const container =
        typeof map.getContainer === 'function' ? map.getContainer() : null

      const width = container?.clientWidth || 0
      const height = container?.clientHeight || 0

      if (width < 100 || height < 100) {
        if (attempts < 10) {
          attempts += 1
          window.setTimeout(runFit, 120)
        }
        return
      }

      if (visibleMapPoints.length === 1) {
        map.setView(
          [
            visibleMapPoints[0].latitude as number,
            visibleMapPoints[0].longitude as number,
          ],
          12
        )
        return
      }

      const bounds = visibleMapPoints.map((client) => [
        client.latitude as number,
        client.longitude as number,
      ])

      map.fitBounds(bounds, { padding: [30, 30] })
    } catch (e) {
      if (attempts < 10) {
        attempts += 1
        window.setTimeout(runFit, 120)
      }
    }
  }

  const timeout = window.setTimeout(runFit, 180)

  return () => {
    cancelled = true
    window.clearTimeout(timeout)
  }
}, [mapOpen, visibleMapPoints])

useEffect(() => {
  if (mapOpen) return

  if (leafletMapRef.current && typeof leafletMapRef.current.remove === 'function') {
    try {
      leafletMapRef.current.remove()
    } catch {}
  }

  leafletMapRef.current = null
}, [mapOpen, mapInstanceKey])

  const cegeclimDetailsBySiret = useMemo(() => {
    const map = new Map<string, ClientCegeclimRow>()
    for (const row of clientsCegeclim) {
      const siret = normalizeSiret(row.siret)
      if (!siret || !isCegeclimActiveRow(row)) continue
      map.set(siret, row)
    }
    return map
  }, [clientsCegeclim])

  const selectedClientCegeclim = useMemo(() => {
    return getClientCegeclimRow(selectedClient, cegeclimDetailsBySiret)
  }, [selectedClient, cegeclimDetailsBySiret])

  const selectedClientCegeclimSommeil = useMemo(() => {
    if (!selectedClient) return null
    const normalizedSiret = normalizeSiret(selectedClient.siret)
    if (!normalizedSiret) return null
    return sommeilCegeclimBySiret.get(normalizedSiret) || null
  }, [selectedClient, sommeilCegeclimBySiret])

  const scopedClientSiretSet = useMemo(
    () => new Set(scopedClientsBase.map((row) => normalizeSiret(row.siret)).filter(Boolean)),
    [scopedClientsBase]
  )

  const scopedCegeclimMissingInClients = useMemo(
    () =>
      scopedClientsCegeclim.filter((row) => {
        const siret = normalizeSiret(row.siret)
        return siret ? !scopedClientSiretSet.has(siret) : false
      }),
    [scopedClientsCegeclim, scopedClientSiretSet]
  )

  const scopedAgences = useMemo(() => {
    if (normalizedSocieteFilter === 'global') return agences
    return agences.filter((a) => normalizeScopeValue(a.societe) === normalizedSocieteFilter)
  }, [agences, normalizedSocieteFilter])

const ageDaysMin = useMemo(
  () => Math.min(sliderToDays(ageSliderMin), sliderToDays(ageSliderMax)),
  [ageSliderMin, ageSliderMax]
)

const ageDaysMax = useMemo(
  () => Math.max(sliderToDays(ageSliderMin), sliderToDays(ageSliderMax)),
  [ageSliderMin, ageSliderMax]
)


  const departmentOptions = useMemo(() => {
    return Array.from(
      new Set(scopedClients.map((r) => getClientDepartment(r)).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [scopedClients])

  useEffect(() => {
    setSelectedDepartments((prev) => prev.filter((dep) => departmentOptions.includes(dep)))
  }, [departmentOptions])

  const sectorOptions = useMemo(() => {
    return Array.from(
      new Set(
        scopedClients
          .map((r) => r.naf_libelle_traduit || translateNaf(r.activitePrincipaleEtablissement))
          .filter(Boolean) as string[]
      )
    ).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [scopedClients])

  const nafOptions = useMemo(() => {
    return Array.from(
      new Set(scopedClients.map((r) => r.activitePrincipaleEtablissement).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [scopedClients])

  const prospectStatusOptions = useMemo(() => {
    return PROSPECT_STATUS_OPTIONS.filter((status) =>
      scopedClients.some((row) => normalizeProspectStatus(row.prospect_status) === status)
    )
  }, [scopedClients])

  useEffect(() => {
    setSelectedProspectStatuses((prev) =>
      prev.filter((status) => prospectStatusOptions.includes(status))
    )
  }, [prospectStatusOptions])

  const agenceOptions = useMemo(() => {
    return Array.from(new Set(scopedAgences.map((a) => a.agence).filter(Boolean) as string[])).sort(
      (a, b) => a.localeCompare(b, 'fr')
    )
  }, [scopedAgences])

  useEffect(() => {
    if (selectedAgence === 'TOUS') return
    if (!agenceOptions.includes(selectedAgence)) setSelectedAgence('TOUS')
  }, [agenceOptions, selectedAgence])

  const selectedAgenceRow = useMemo(() => {
    if (selectedAgence === 'TOUS') return null
    return scopedAgences.find((a) => a.agence === selectedAgence) || null
  }, [scopedAgences, selectedAgence])

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    const designationQ = designationSearch.trim().toLowerCase()

    return scopedClientsBase.filter((row) => {
      const sector = row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement)
      const department = getClientDepartment(row)
      const ageDays = diffDaysFromToday(row.dateCreationEtablissement)
      const completeness = getCompletenessPercent(row)
    const isCegeclim = isClientPresentInCegeclim(row, activeCegeclimBySiret)

    if (selectedClientScope === 'Cegeclim' && !isCegeclim) return false
    if (selectedClientScope === 'Prospects' && isCegeclim) return false

      const designationRaw = String(row.raison_sociale_affichee ?? '').trim()
      const designationNormalized = designationRaw.toLowerCase()
      const isDesignationND =
        !designationRaw || designationNormalized === 'nd' || designationNormalized === '[nd]'

      let distanceToAgence: number | null = null
      if (selectedAgenceRow) {
        distanceToAgence = distanceKmLambert(
          row.coordonneeLambertAbscisseEtablissement,
          row.coordonneeLambertOrdonneeEtablissement,
          selectedAgenceRow.coord_x_lambert,
          selectedAgenceRow.coord_y_lambert
        )
      }

      if (selectedDepartments.length > 0 && !selectedDepartments.includes(department)) return false
      if (selectedSectors.length > 0 && !selectedSectors.includes(sector)) return false
      if (
        selectedNafCodes.length > 0 &&
        !selectedNafCodes.includes(row.activitePrincipaleEtablissement || '')
      ) {
        return false
      }
      if (excludeDesignationND && isDesignationND) return false
      if (selectedProspectStatuses.length > 0) {
        const prospectStatus = normalizeProspectStatus(row.prospect_status)
        if (!selectedProspectStatuses.includes(prospectStatus)) return false
      }
      if (excludeFutureCreation && isFutureDate(row.dateCreationEtablissement)) return false
      if (onlyContactable && !(row.telephone || row.email || row.contactable)) return false
      if (onlyNotInCegeclim && isCegeclim) return false
      if (onlyPresentInCegeclim && !isCegeclim) return false
      if (onlyToEnrich && completeness >= 100 && row.enrichment_status === 'ok') return false

      if (ageDays === null || ageDays < 0) {
        if (!(ageDays !== null && ageDays < 0 && !excludeFutureCreation)) return false
      }

      if (ageDays !== null && ageDays >= 0) {
        if (ageDays < ageDaysMin || ageDays > ageDaysMax) return false
      }

      if (selectedAgenceRow) {
        if (distanceToAgence !== null) {
          if (distanceToAgence > distanceMax) return false
        } else if (!includeNoDistance) {
          return false
        }
      }

      if (designationQ && !designationNormalized.includes(designationQ)) return false

      if (q) {
        const haystack = [
          designationRaw,
          row.siret,
          department,
          row.libelleCommuneEtablissement,
          row.codePostalEtablissement,
          row.activitePrincipaleEtablissement,
          sector,
          row.telephone,
          row.email,
          row.nom_dirigeant,
          row.site_web,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        if (!haystack.includes(q)) return false
      }

      return true
    })
  }, [
    scopedClientsBase,
    search,
    designationSearch,
    selectedDepartments,
    selectedClientScope,
    selectedSectors,
    selectedNafCodes,
    selectedAgenceRow,
    includeNoDistance,
    onlyContactable,
    onlyNotInCegeclim,
    onlyPresentInCegeclim,
    excludeDesignationND,
    excludeFutureCreation,
    onlyToEnrich,
    ageDaysMin,
    ageDaysMax,
    distanceMax,
    activeCegeclimBySiret,
    selectedProspectStatuses,
  ])

  const sortedFilteredClients = useMemo(() => {
    const rows = [...filteredClients]

    rows.sort((a, b) => {
      const sectorA = a.naf_libelle_traduit || translateNaf(a.activitePrincipaleEtablissement)
      const sectorB = b.naf_libelle_traduit || translateNaf(b.activitePrincipaleEtablissement)

      const distanceA = selectedAgenceRow
        ? distanceKmLambert(
            a.coordonneeLambertAbscisseEtablissement,
            a.coordonneeLambertOrdonneeEtablissement,
            selectedAgenceRow.coord_x_lambert,
            selectedAgenceRow.coord_y_lambert
          )
        : null

      const distanceB = selectedAgenceRow
        ? distanceKmLambert(
            b.coordonneeLambertAbscisseEtablissement,
            b.coordonneeLambertOrdonneeEtablissement,
            selectedAgenceRow.coord_x_lambert,
            selectedAgenceRow.coord_y_lambert
          )
        : null

      let av: string | number = ''
      let bv: string | number = ''

      switch (sortKey) {
        case 'designation':
          av = a.raison_sociale_affichee || ''
          bv = b.raison_sociale_affichee || ''
          break
        case 'siret':
          av = a.siret || ''
          bv = b.siret || ''
          break
        case 'departement':
          av = getClientDepartment(a) || ''
          bv = getClientDepartment(b) || ''
          break
        case 'ville':
          av = a.libelleCommuneEtablissement || ''
          bv = b.libelleCommuneEtablissement || ''
          break
        case 'codePostal':
          av = a.codePostalEtablissement || ''
          bv = b.codePostalEtablissement || ''
          break
        case 'naf':
          av = a.activitePrincipaleEtablissement || ''
          bv = b.activitePrincipaleEtablissement || ''
          break
        case 'secteur':
          av = sectorA
          bv = sectorB
          break
        case 'creation':
          av = a.dateCreationEtablissement || ''
          bv = b.dateCreationEtablissement || ''
          break
        case 'anciennete':
          av = diffDaysFromToday(a.dateCreationEtablissement) ?? -999999
          bv = diffDaysFromToday(b.dateCreationEtablissement) ?? -999999
          break
        case 'telephone':
          av = a.telephone || ''
          bv = b.telephone || ''
          break
        case 'email':
          av = a.email || ''
          bv = b.email || ''
          break
        case 'distance':
          av = distanceA ?? 999999
          bv = distanceB ?? 999999
          break
        case 'completeness':
          av = getCompletenessPercent(a)
          bv = getCompletenessPercent(b)
          break
        case 'enrichment':
          av = a.enrichment_status || ''
          bv = b.enrichment_status || ''
          break
      }

      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'fr')

      return sortDirection === 'asc' ? cmp : -cmp
    })

    return rows
  }, [filteredClients, sortKey, sortDirection, selectedAgenceRow])

  const summaryDepartments = useMemo(() => {
    return Array.from(
      new Set(sortedFilteredClients.map((r) => getClientDepartment(r)).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [sortedFilteredClients])

  const summarySectorRows = useMemo(() => {
    const sectors = Array.from(
      new Set(
        sortedFilteredClients.map(
          (r) => r.naf_libelle_traduit || translateNaf(r.activitePrincipaleEtablissement)
        )
      )
    )

    return sectors
      .map((sector) => {
        const byDept: Record<string, number> = {}
        const byDeptCegeclim: Record<string, number> = {}
        let total = 0
        let totalCegeclim = 0

        summaryDepartments.forEach((dep) => {
          const matchingRows = sortedFilteredClients.filter((r) => {
            const d = getClientDepartment(r)
            const s = r.naf_libelle_traduit || translateNaf(r.activitePrincipaleEtablissement)
            return d === dep && s === sector
          })
          const count = matchingRows.length
          const cegeclimCount = matchingRows.filter((r) => isClientPresentInCegeclim(r, activeCegeclimBySiret)).length
          byDept[dep] = count
          byDeptCegeclim[dep] = cegeclimCount
          total += count
          totalCegeclim += cegeclimCount
        })

        return { sector, total, totalCegeclim, byDept, byDeptCegeclim }
      })
      .sort((a, b) => b.total - a.total)
  }, [sortedFilteredClients, summaryDepartments, activeCegeclimBySiret])

  const summaryDeptTotals = useMemo(() => {
    const out: Record<string, number> = {}
    summaryDepartments.forEach((dep) => {
      out[dep] = sortedFilteredClients.filter((r) => getClientDepartment(r) === dep).length
    })
    return out
  }, [sortedFilteredClients, summaryDepartments])

  const [prospectCommentDraft, setProspectCommentDraft] = useState('')

  useEffect(() => {
  setProspectCommentDraft(selectedClient?.prospect_comment || '')
}, [selectedClient?.id, selectedClient?.prospect_comment])

  const summaryDeptCegeclimTotals = useMemo(() => {
    const out: Record<string, number> = {}
    summaryDepartments.forEach((dep) => {
      out[dep] = sortedFilteredClients.filter(
        (r) => getClientDepartment(r) === dep && isClientPresentInCegeclim(r, activeCegeclimBySiret)
      ).length
    })
    return out
  }, [sortedFilteredClients, summaryDepartments, activeCegeclimBySiret])

  const summaryTotalCegeclim = useMemo(
    () => sortedFilteredClients.filter((r) => isClientPresentInCegeclim(r, activeCegeclimBySiret)).length,
    [sortedFilteredClients, activeCegeclimBySiret]
  )

  const cegeclimPresenceRows = useMemo(() => {
    const topSectors = ['Electricité ENR', 'Plomberie', 'Installateur CVC', 'CMI']
    return topSectors
      .map((sector) => {
        const baseRow = summarySectorRows.find((row) => row.sector === sector)
        return {
          sector,
          total: baseRow?.total || 0,
          totalCegeclim: baseRow?.totalCegeclim || 0,
          byDept: baseRow?.byDept || {},
          byDeptCegeclim: baseRow?.byDeptCegeclim || {},
        }
      })
      .filter((row) => row.total > 0)
  }, [summarySectorRows])

  const totalPages = Math.max(1, Math.ceil(sortedFilteredClients.length / CLIENTS_PAGE_SIZE))

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * CLIENTS_PAGE_SIZE
    return sortedFilteredClients.slice(start, start + CLIENTS_PAGE_SIZE)
  }, [sortedFilteredClients, currentPage])

  const selectedClientIndex = useMemo(() => {
  if (!selectedClient) return -1
  return sortedFilteredClients.findIndex((client) => client.id === selectedClient.id)
}, [selectedClient, sortedFilteredClients])

const previousClient = useMemo(() => {
  if (selectedClientIndex <= 0) return null
  return sortedFilteredClients[selectedClientIndex - 1] || null
}, [selectedClientIndex, sortedFilteredClients])

const nextClient = useMemo(() => {
  if (selectedClientIndex < 0 || selectedClientIndex >= sortedFilteredClients.length - 1) return null
  return sortedFilteredClients[selectedClientIndex + 1] || null
}, [selectedClientIndex, sortedFilteredClients])

const selectedClientVisibleOnMap = useMemo(() => {
  if (!selectedClient) return false
  return (
    typeof selectedClient.latitude === 'number' &&
    typeof selectedClient.longitude === 'number' &&
    Number.isFinite(selectedClient.latitude) &&
    Number.isFinite(selectedClient.longitude)
  )
}, [selectedClient])

const selectedClientMapReason = useMemo(() => {
  if (!selectedClient) return ''
  if (selectedClientVisibleOnMap) {
    return 'Présent sur la carte'
  }

  const hasAddress = Boolean(
    String(selectedClient.adresse_complete || '').trim() ||
      String(selectedClient.codePostalEtablissement || '').trim() ||
      String(selectedClient.libelleCommuneEtablissement || '').trim()
  )

  if (hasAddress) {
    return 'Adresse présente mais coordonnées absentes'
  }

  return 'Adresse insuffisante pour la carte'
}, [selectedClient, selectedClientVisibleOnMap])


  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDirection((v) => (v === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  async function handleImportCsv(file: File) {
    setImporting(true)
    setImportStats(null)

    try {
      const existingMap = new Map<string, ClientRow>(
        clients.filter((r) => r.siret).map((r) => [String(r.siret), r])
      )

      const parsed = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data as Record<string, unknown>[]),
          error: reject,
        })
      })

      const seenInFile = new Set<string>()
      const rejectsPayload: Array<{
        ligne_numero: number
        siret: string | null
        motif_rejet: string
        donnees_source_json: Record<string, unknown>
      }> = []

      const payloads: Record<string, unknown>[] = []
      let inserted = 0
      let updated = 0

      parsed.forEach((row, index) => {
        const siret = normalizeSiret(row.siret)

        if (!siret || siret.length !== 14) {
          rejectsPayload.push({
            ligne_numero: index + 2,
            siret: siret || null,
            motif_rejet: 'SIRET vide ou invalide',
            donnees_source_json: row,
          })
          return
        }

        if (seenInFile.has(siret)) {
          rejectsPayload.push({
            ligne_numero: index + 2,
            siret,
            motif_rejet: 'Doublon dans le fichier importé',
            donnees_source_json: row,
          })
          return
        }

        seenInFile.add(siret)

        const nafCodeValue =
          String(row.activitePrincipaleEtablissement ?? '').trim() ||
          String(row.activitePrincipaleUniteLegale ?? '').trim() ||
          null

        const dateCreation = parseMaybeDate(row.dateCreationEtablissement)
        const ageDays = diffDaysFromToday(dateCreation)
        const ancienneteAnnees =
          ageDays === null || ageDays < 0 ? null : Math.floor(ageDays / 365.25)

        const telephone = String(row.telephone ?? '').trim() || null
        const email = String(row.email ?? '').trim() || null

        const payload = {
          siren: String(row.siren ?? '').trim() || null,
          nic: String(row.nic ?? '').trim() || null,
          siret,
          dateCreationEtablissement: dateCreation,
          trancheEffectifsEtablissement:
            String(row.trancheEffectifsEtablissement ?? '').trim() || null,
          denominationUniteLegale: String(row.denominationUniteLegale ?? '').trim() || null,
          nomUniteLegale: String(row.nomUniteLegale ?? '').trim() || null,
          prenom1UniteLegale: String(row.prenom1UniteLegale ?? '').trim() || null,
          denominationUsuelleEtablissement:
            String(row.denominationUsuelleEtablissement ?? '').trim() || null,
          complementAdresseEtablissement:
            String(row.complementAdresseEtablissement ?? '').trim() || null,
          numeroVoieEtablissement: String(row.numeroVoieEtablissement ?? '').trim() || null,
          typeVoieEtablissement: String(row.typeVoieEtablissement ?? '').trim() || null,
          libelleVoieEtablissement: String(row.libelleVoieEtablissement ?? '').trim() || null,
          codePostalEtablissement: String(row.codePostalEtablissement ?? '').trim() || null,
          libelleCommuneEtablissement:
            String(row.libelleCommuneEtablissement ?? '').trim() || null,
          activitePrincipaleUniteLegale:
            String(row.activitePrincipaleUniteLegale ?? '').trim() || null,
          activitePrincipaleEtablissement:
            String(row.activitePrincipaleEtablissement ?? '').trim() || null,
          activitePrincipaleNAF25Etablissement:
            String(row.activitePrincipaleNAF25Etablissement ?? '').trim() || null,
          raison_sociale_affichee: buildRaisonSociale(row),
          adresse_complete: buildAdresseComplete(row),
          departement: getDepartmentFromPostalCode(String(row.codePostalEtablissement ?? '').trim()),
          naf_code: nafCodeValue,
          naf_libelle_traduit: translateNaf(nafCodeValue),
          anciennete_annees: ancienneteAnnees,
          coordonneeLambertAbscisseEtablissement: parseNumeric(
            row.coordonneeLambertAbscisseEtablissement
          ),
          coordonneeLambertOrdonneeEtablissement: parseNumeric(
            row.coordonneeLambertOrdonneeEtablissement
          ),
          telephone,
          email,
          contactable: Boolean(telephone || email),
          source_import: 'entreprise_france',
          nom_fichier_import: file.name,
          date_import: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          enrichment_status: 'a_faire',
        }

        payloads.push(payload)
        if (existingMap.has(siret)) updated += 1
        else inserted += 1
      })

      const { data: importHeader, error: importHeaderError } = await supabase
        .from('imports_clients')
        .insert({
          nom_fichier: file.name,
          type_import: 'entreprise_france',
          nb_lignes_source: parsed.length,
          nb_importees: inserted,
          nb_mises_a_jour: updated,
          nb_rejets: rejectsPayload.length,
          commentaire: 'Import réalisé depuis l’écran Clients',
        })
        .select()
        .single()

      if (importHeaderError) throw importHeaderError

      const importId = importHeader?.id as string
      const payloadsWithImport = payloads.map((row) => ({ ...row, import_id: importId }))

      for (const batch of chunkArray(payloadsWithImport, 500)) {
        const { error } = await supabase.from('clients').upsert(batch, { onConflict: 'siret' })
        if (error) throw error
      }

      if (rejectsPayload.length > 0) {
        const rejectRows = rejectsPayload.map((r) => ({ ...r, import_id: importId }))
        for (const batch of chunkArray(rejectRows, 500)) {
          const { error } = await supabase.from('imports_clients_rejets').insert(batch)
          if (error) throw error
        }
      }

      setImportStats({
        total: parsed.length,
        inserted,
        updated,
        rejected: rejectsPayload.length,
      })

      await loadAll()
      alert('Import terminé avec succès.')
    } catch (error) {
      console.error(error)
      alert("Erreur pendant l'import CSV.")
    } finally {
      setImporting(false)
    }
  }

  function buildExportRows() {
    return [...sortedFilteredClients]
      .sort((a, b) => {
        const depA = getClientDepartment(a) || 'ZZ'
        const depB = getClientDepartment(b) || 'ZZ'
        if (depA !== depB) return depA.localeCompare(depB, 'fr', { numeric: true })
        return (a.raison_sociale_affichee || '').localeCompare(b.raison_sociale_affichee || '', 'fr')
      })
      .map((row) => {
        const distance = selectedAgenceRow
          ? distanceKmLambert(
              row.coordonneeLambertAbscisseEtablissement,
              row.coordonneeLambertOrdonneeEtablissement,
              selectedAgenceRow.coord_x_lambert,
              selectedAgenceRow.coord_y_lambert
            )
          : null

        const cege = getClientCegeclimRow(row, cegeclimDetailsBySiret)

        return {
          designation: row.raison_sociale_affichee || 'ND',
          siret: row.siret || 'ND',
          presentCegeclim: getClientCegeclimCode(row, activeCegeclimBySiret),
          apeNaf: row.activitePrincipaleEtablissement || 'ND',
          secteur: row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement),
          creation: formatDateFr(row.dateCreationEtablissement),
          departement: getClientDepartment(row) || 'ND',
          ville: row.libelleCommuneEtablissement || 'ND',
          codePostal: row.codePostalEtablissement || 'ND',
          adresse: row.adresse_complete || 'ND',
          distance: distance != null ? `${distance} km` : '',
          googleMapsLabel: row.google_maps_url ? 'ouvrir' : '',
          googleMapsUrl: row.google_maps_url || '',
          telephone: row.telephone || '',
          email: row.email || '',
          site: row.site_web || '',
          dirigeant: row.nom_dirigeant || '',
          noteGoogle: row.google_rating != null ? String(row.google_rating) : '',
          nbNotes: row.google_user_ratings_total != null ? String(row.google_user_ratings_total) : '',
          suiviProspect: normalizeProspectStatus(row.prospect_status),
          prospectRemarque: row.prospect_comment || '',
          ca2023: cege?.ca_2023 != null ? String(cege.ca_2023) : '',
          ca2024: cege?.ca_2024 != null ? String(cege.ca_2024) : '',
          ca2025: cege?.ca_2025 != null ? String(cege.ca_2025) : '',
          statut: cege?.statut != null ? String(cege.statut) : '',
        }
      })
  }

  function exportExcel() {
  const exportRows = buildExportRows()

  const aoa: (string | number)[][] = [
    ['Identité', '', '', '', '', '', 'Localisation', '', '', '', '', '', 'Contact', '', '', '', '', '', 'Remarque', '', '', '', ''],
    [
      'Raison sociale',
      'Siret',
      'Présent base',
      'APE/NAF',
      "Secteur d'activité",
      'Création',
      'Dépt',
      'Ville',
      'Code postal',
      'Adresse',
      'Distance',
      'Google maps',
      'Tel',
      'Mail',
      'Site',
      'Dirigeant',
      'Note Google',
      'Nb Note',
      'Suivi prospect',
      'Prospect / Remarque',
      'CA 2023',
      'CA 2024',
      'CA 2025',
      'Statut',
    ],
    ...exportRows.map((row) => [
      row.designation,
      row.siret,
      row.presentCegeclim,
      row.apeNaf,
      row.secteur,
      row.creation,
      row.departement,
      row.ville,
      row.codePostal,
      row.adresse,
      row.distance,
      row.googleMapsLabel,
      row.telephone,
      row.email,
      row.site,
      row.dirigeant,
      row.noteGoogle,
      row.nbNotes,
      row.suiviProspect,
      row.prospectRemarque,
      row.ca2023,
      row.ca2024,
      row.ca2025,
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws['!merges'] = [
    XLSX.utils.decode_range('A1:F1'),
    XLSX.utils.decode_range('G1:L1'),
    XLSX.utils.decode_range('M1:R1'),
    XLSX.utils.decode_range('S1:W1'),
  ]

  ws['!cols'] = [
    { wch: 23 },
    { wch: 16 },
    { wch: 12 },
    { wch: 10 },
    { wch: 18 },
    { wch: 11 },
    { wch: 6 },
    { wch: 20 },
    { wch: 11 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 24 },
    { wch: 26 },
    { wch: 18 },
    { wch: 10 },
    { wch: 9 },
    { wch: 12 },
    { wch: 34 },
    { wch: 11 },
    { wch: 11 },
    { wch: 11 },
  ]

  ws['!autofilter'] = { ref: 'A2:W2' }

  ws['!freeze'] = {
    xSplit: 2,
    ySplit: 2,
    topLeftCell: 'C3',
    activePane: 'bottomRight',
    state: 'frozen',
  }

  ws['!rows'] = aoa.map((_, index) => ({ hpt: index < 2 ? 22 : 18 }))

  ws['!pageMargins'] = {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 0.75,
    header: 0.3,
    footer: 0.3,
  }

  ws['!pageSetup'] = {
    orientation: 'landscape',
    paperSize: 9,
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 53,
  }

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:W2')

  const GREY = 'D9D9D9'
  const GREEN = 'C4D79B'
  const BLUE = 'B8CCE4'
  const BEIGE = 'DDD9C3'
  const BORDER = '000000'

  function getGroupFill(colIndex: number) {
    if (colIndex <= 5) return GREY
    if (colIndex <= 11) return GREEN
    if (colIndex <= 17) return BLUE
    return BEIGE
  }

  function ensureCell(ref: string) {
    if (!ws[ref]) ws[ref] = { t: 's', v: '' }
    if (!(ws[ref] as any).s) (ws[ref] as any).s = {}
    return ws[ref] as any
  }

  function setBorder(cell: any) {
    cell.s = cell.s || {}
    cell.s.border = {
      top: { style: 'thin', color: { rgb: BORDER } },
      bottom: { style: 'thin', color: { rgb: BORDER } },
      left: { style: 'thin', color: { rgb: BORDER } },
      right: { style: 'thin', color: { rgb: BORDER } },
    }
  }

  for (let r = 0; r <= range.e.r; r += 1) {
    for (let c = 0; c <= 22; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c })
      const cell = ensureCell(ref)

      setBorder(cell)

      if (r === 0 || r === 1) {
        cell.s.font = { bold: true, color: { rgb: '000000' } }
        cell.s.fill = {
          patternType: 'solid',
          fgColor: { rgb: getGroupFill(c) },
        }
        cell.s.alignment = {
          vertical: 'center',
          horizontal: r === 0 ? 'center' : 'left',
          wrapText: true,
        }
      } else {
        cell.s.alignment = {
          vertical: 'center',
          horizontal: c === 10 || c === 16 || c === 17 || c >= 20 ? 'center' : 'left',
          wrapText: true,
        }
      }
    }
  }

  for (let c = 0; c <= 22; c += 1) {
    const ref = XLSX.utils.encode_cell({ r: 0, c })
    const cell = ensureCell(ref)
    cell.s.alignment = {
      vertical: 'center',
      horizontal: 'center',
      wrapText: true,
    }
  }

  for (let rowIndex = 2; rowIndex <= range.e.r; rowIndex += 1) {
    const excelRow = rowIndex + 1
    const linkCellRef = `L${excelRow}`
    const siteCellRef = `O${excelRow}`
    const googleUrl = exportRows[rowIndex - 2]?.googleMapsUrl
    const siteUrl = exportRows[rowIndex - 2]?.site

    if (googleUrl) {
      ws[linkCellRef] = {
        t: 's',
        v: 'ouvrir',
        l: { Target: googleUrl, Tooltip: 'Ouvrir dans Google Maps' },
        s: {
          font: { color: { rgb: '0563C1' }, underline: true },
          border: {
            top: { style: 'thin', color: { rgb: BORDER } },
            bottom: { style: 'thin', color: { rgb: BORDER } },
            left: { style: 'thin', color: { rgb: BORDER } },
            right: { style: 'thin', color: { rgb: BORDER } },
          },
          alignment: { horizontal: 'center', vertical: 'center' },
        },
      }
    }

    if (siteUrl) {
      ws[siteCellRef] = {
        t: 's',
        v: siteUrl,
        l: { Target: siteUrl, Tooltip: 'Ouvrir le site web' },
        s: {
          font: { color: { rgb: '0563C1' }, underline: true },
          border: {
            top: { style: 'thin', color: { rgb: BORDER } },
            bottom: { style: 'thin', color: { rgb: BORDER } },
            left: { style: 'thin', color: { rgb: BORDER } },
            right: { style: 'thin', color: { rgb: BORDER } },
          },
        },
      }
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Liste entreprises')

  if (!wb.Workbook) wb.Workbook = { Names: [] }
  if (!wb.Workbook.Names) wb.Workbook.Names = []

  wb.Workbook.Names.push({
    Sheet: 0,
    Name: '_xlnm.Print_Titles',
    Ref: "'Liste entreprises'!$1:$2",
  })

  wb.Workbook.Names.push({
    Sheet: 0,
    Name: '_xlnm.Print_Area',
    Ref: `'Liste entreprises'!$A$1:$W$${exportRows.length + 2}`,
  })

  XLSX.writeFile(wb, `clients_selection_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

  function exportPdf() {
    const doc = new jsPDF('landscape', 'mm', 'a4')
    const exportRows = buildExportRows()
    const groupedRows = exportRows.reduce<Record<string, typeof exportRows>>((acc, row) => {
      const key = row.departement || 'ND'
      if (!acc[key]) acc[key] = []
      acc[key].push(row)
      return acc
    }, {})

    const COLOR_IDENTITY: [number, number, number] = [217, 217, 217]
    const COLOR_LOCATION: [number, number, number] = [191, 222, 185]
    const COLOR_CONTACT: [number, number, number] = [180, 198, 231]
    const COLOR_HEAD_DEFAULT: [number, number, number] = [242, 242, 242]
    const COLOR_GRID: [number, number, number] = [160, 160, 160]
    const COLOR_HEAD_GRID: [number, number, number] = [120, 120, 120]
    const COLOR_LINK: [number, number, number] = [5, 99, 193]
    const COLOR_TEXT: [number, number, number] = [20, 20, 20]

    const departments = Object.keys(groupedRows).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    const head: string[][] = [
  [
    'Identité',
    '',
    '',
    '',
    '',
    '',
    'Localisation',
    '',
    '',
    '',
    '',
    '',
    'Contact',
    '',
    '',
    '',
    '',
    '',
    'Remarque',
    '',
    ''
  ],
  [
    'Raison sociale',
    'Siret',
    'Présent base Cegeclim',
    'APE/NAF',
    "Secteur d'activité",
    'Création',
    'Dépt',
    'Ville',
    'Code postal',
    'Adresse',
    'Distance',
    'Google maps',
    'Tel',
    'Mail',
    'Site',
    'Dirigeant',
    'Note Google',
    'Nb Note',
    'Suivi prospect',
    'Prospect / Remarque',
  ],
]

    const columnStyles = {
      0: { cellWidth: 26 },
      1: { cellWidth: 18 },
      2: { cellWidth: 11, halign: 'center' as const },
      3: { cellWidth: 10, halign: 'center' as const },
      4: { cellWidth: 16 },
      5: { cellWidth: 16, halign: 'center' as const, overflow: 'hidden' as const },
      6: { cellWidth: 7, halign: 'center' as const },
      7: { cellWidth: 17 },
      8: { cellWidth: 10, halign: 'center' as const },
      9: { cellWidth: 25 },
      10: { cellWidth: 9, halign: 'center' as const },
      11: { cellWidth: 10, halign: 'center' as const },
      12: { cellWidth: 18, overflow: 'hidden' as const },
      13: { cellWidth: 18 },
      14: { cellWidth: 14, halign: 'center' as const },
      15: { cellWidth: 14 },
      16: { cellWidth: 9, halign: 'center' as const },
      17: { cellWidth: 7, halign: 'center' as const },
      18: { cellWidth: 10, halign: 'center' as const },
      19: { cellWidth: 22 },
    }

    departments.forEach((department, departmentIndex) => {
      if (departmentIndex > 0) doc.addPage('a4', 'landscape')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(`Département ${department}`, 8, 10)

      autoTable(doc, {
        startY: 14,
        head,
        body: groupedRows[department].map((row) => [
          row.designation,
          row.siret,
          row.presentCegeclim,
          row.apeNaf,
          row.secteur,
          row.creation,
          row.departement,
          row.ville,
          row.codePostal,
          row.adresse,
          row.distance,
          '',
          row.telephone,
          row.email,
          '',
          row.dirigeant,
          row.noteGoogle,
          row.nbNotes,
          row.suiviProspect,
          row.prospectRemarque,
        ]),
        theme: 'grid',
        margin: { top: 14, right: 6, bottom: 8, left: 6 },
        styles: {
          fontSize: 5.6,
          cellPadding: 1.15,
          lineColor: COLOR_GRID,
          lineWidth: 0.1,
          overflow: 'linebreak',
          valign: 'middle',
          textColor: 20,
        },
        headStyles: {
          fillColor: COLOR_HEAD_DEFAULT,
          textColor: 20,
          fontStyle: 'bold',
          halign: 'center',
          valign: 'middle',
          lineColor: COLOR_HEAD_GRID,
          lineWidth: 0.15,
        },
        bodyStyles: { valign: 'middle' },
        columnStyles,
        rowPageBreak: 'avoid',
        didParseCell: (data) => {
  if (data.section === 'head') {
    if (data.row.index === 0) {
      if (data.column.index <= 5) data.cell.styles.fillColor = [217, 217, 217]
      else if (data.column.index <= 11) data.cell.styles.fillColor = [191, 222, 185]
      else if (data.column.index <= 17) data.cell.styles.fillColor = [180, 198, 231]
      else data.cell.styles.fillColor = [242, 229, 188]

      data.cell.styles.textColor = 0
      data.cell.styles.halign = 'center'
      data.cell.styles.fontStyle = 'bold'

      if (data.column.index === 0) data.cell.colSpan = 6
      if (data.column.index === 6) data.cell.colSpan = 6
      if (data.column.index === 12) data.cell.colSpan = 6
      if (data.column.index === 18) data.cell.colSpan = 5

      if (![0, 6, 12, 18].includes(data.column.index)) {
        data.cell.text = ['']
      }
    }

    if (data.row.index === 1) {
      if (data.column.index <= 5) data.cell.styles.fillColor = [217, 217, 217]
      else if (data.column.index <= 11) data.cell.styles.fillColor = [191, 222, 185]
      else if (data.column.index <= 17) data.cell.styles.fillColor = [180, 198, 231]
      else data.cell.styles.fillColor = [242, 229, 188]

      data.cell.styles.textColor = 0
      data.cell.styles.halign = 'center'
      data.cell.styles.fontStyle = 'bold'
    }
  }

  if (data.section === 'body') {
    if (data.column.index === 5 || data.column.index === 12) {
      data.cell.styles.overflow = 'visible'
    }
    if (data.column.index === 11 || data.column.index === 14) {
      data.cell.styles.textColor = [5, 99, 193]
    }
  }
},
        didDrawCell: (data) => {
          if (data.section !== 'body') return
          const row = groupedRows[department][data.row.index]
          if (!row) return

          if (data.column.index === 11 && row.googleMapsUrl) {
            doc.setFontSize(5.6)
            doc.setTextColor(...COLOR_LINK)
            doc.textWithLink('ouvrir', data.cell.x + 1.1, data.cell.y + data.cell.height / 2 + 1.3, {
              url: row.googleMapsUrl,
            })
            doc.setTextColor(...COLOR_TEXT)
          }

          if (data.column.index === 14 && row.site) {
            doc.setFontSize(5.6)
            doc.setTextColor(...COLOR_LINK)
            doc.textWithLink('ouvrir', data.cell.x + 1.1, data.cell.y + data.cell.height / 2 + 1.3, {
              url: row.site,
            })
            doc.setTextColor(...COLOR_TEXT)
          }
        },
        didDrawPage: () => {
          doc.setFontSize(8)
          doc.setTextColor(90)
          doc.text(
            `Extraction Clients - ${new Date().toLocaleDateString('fr-FR')} - Page ${doc.getNumberOfPages()}`,
            doc.internal.pageSize.getWidth() - 8,
            doc.internal.pageSize.getHeight() - 4,
            { align: 'right' }
          )
          doc.setTextColor(...COLOR_TEXT)
        },
      })
    })

    doc.save(`clients_selection_${new Date().toISOString().slice(0, 10)}.pdf`)
  }


  function exportClientSheetsPdf() {
    if (!sortedFilteredClients.length) {
      alert('Aucune entreprise à imprimer.')
      return
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()

    const COLOR_BG: [number, number, number] = [245, 247, 251]
    const COLOR_PANEL: [number, number, number] = [255, 255, 255]
    const COLOR_BORDER: [number, number, number] = [203, 213, 225]
    const COLOR_TITLE_BG: [number, number, number] = [241, 245, 249]
    const COLOR_TEXT: [number, number, number] = [15, 23, 42]
    const COLOR_MUTED: [number, number, number] = [71, 85, 105]
    const COLOR_SUCCESS: [number, number, number] = [22, 101, 52]
    const COLOR_DANGER: [number, number, number] = [153, 27, 27]

    function pdfText(value: unknown, fallback = 'NC') {
      const v = String(value ?? '').trim()
      return v || fallback
    }

    function getClientMapReasonForPdf(client: ClientRow) {
      const visible =
        typeof client.latitude === 'number' &&
        typeof client.longitude === 'number' &&
        Number.isFinite(client.latitude) &&
        Number.isFinite(client.longitude)

      if (visible) return 'Présent sur la carte'

      const hasAddress = Boolean(
        String(client.adresse_complete || '').trim() ||
          String(client.codePostalEtablissement || '').trim() ||
          String(client.libelleCommuneEtablissement || '').trim()
      )

      if (hasAddress) return 'Adresse présente mais coordonnées absentes'
      return 'Adresse insuffisante pour la carte'
    }

    function drawWrappedText(lines: string[], x: number, y: number, maxWidth: number, lineHeight = 5.1) {
      let cursorY = y
      lines.forEach((line) => {
        const split = doc.splitTextToSize(line, maxWidth) as string[]
        split.forEach((part) => {
          doc.text(part, x, cursorY)
          cursorY += lineHeight
        })
      })
      return cursorY
    }

    function drawPanel(title: string, x: number, y: number, w: number, h: number, lines: string[], options?: { badgeText?: string; badgeColor?: [number, number, number] }) {
      doc.setDrawColor(...COLOR_BORDER)
      doc.setFillColor(...COLOR_PANEL)
      doc.roundedRect(x, y, w, h, 4, 4, 'FD')

      doc.setFillColor(...COLOR_TITLE_BG)
      doc.roundedRect(x, y, w, 12, 4, 4, 'F')
      doc.rect(x, y + 8, w, 4, 'F')

      doc.setTextColor(...COLOR_TEXT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(title, x + 4, y + 7.6)

      if (options?.badgeText) {
        const badgeW = Math.max(26, doc.getTextWidth(options.badgeText) + 8)
        doc.setFillColor(...(options.badgeColor || COLOR_DANGER))
        doc.roundedRect(x + w - badgeW - 4, y + 2.2, badgeW, 7, 3, 3, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(8.5)
        doc.text(options.badgeText, x + w - badgeW / 2 - 4, y + 6.9, { align: 'center' })
      }

      doc.setTextColor(...COLOR_TEXT)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.4)
      drawWrappedText(lines, x + 4, y + 18, w - 8)
    }

    sortedFilteredClients.forEach((client, index) => {
      if (index > 0) doc.addPage('a4', 'landscape')

      const cegeclimDetails = getClientCegeclimRow(client, cegeclimDetailsBySiret)
      const clientOnMap =
        typeof client.latitude === 'number' &&
        typeof client.longitude === 'number' &&
        Number.isFinite(client.latitude) &&
        Number.isFinite(client.longitude)

      doc.setFillColor(...COLOR_BG)
      doc.rect(0, 0, pageWidth, pageHeight, 'F')

      doc.setTextColor(...COLOR_TEXT)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.text(pdfText(client.raison_sociale_affichee, 'Entreprise'), 14, 16)

      doc.setFontSize(11)
      doc.text(`SIRET : ${pdfText(client.siret)}`, 14, 24)

      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...COLOR_MUTED)
      doc.setFontSize(9)
      doc.text(
        `Feuille client • ${index + 1}/${sortedFilteredClients.length} • édité le ${new Date().toLocaleDateString('fr-FR')}`,
        pageWidth - 14,
        16,
        { align: 'right' }
      )

      const panelYTop = 30
      const panelH = 62
      const gap = 8
      const left = 14
      const usableW = pageWidth - 28
      const colW = (usableW - gap * 2) / 3

      drawPanel('Identité', left, panelYTop, colW, panelH, [
        `Téléphone : ${pdfText(client.telephone)}`,
        `SIRET : ${pdfText(client.siret)}`,
        `Code NAF : ${pdfText(client.activitePrincipaleEtablissement)}`,
        `Secteur : ${pdfText(client.naf_libelle_traduit || translateNaf(client.activitePrincipaleEtablissement), 'NC')}`,
        `Date création : ${formatDateFr(client.dateCreationEtablissement)}`,
        `Ancienneté : ${formatAgePrecise(diffDaysFromToday(client.dateCreationEtablissement))}`,
        `Effectifs SIRENE : ${pdfText(client.trancheEffectifsEtablissement)}`,
        `Effectif estimé : ${client.effectif_estime ?? 'NC'}`,
        `Présent base CEGECLIM : ${isClientPresentInCegeclim(client, activeCegeclimBySiret) ? getClientCegeclimCode(client, activeCegeclimBySiret) : 'NON'}`,
      ])

      drawPanel('Localisation', left + colW + gap, panelYTop, colW, panelH, [
        `Adresse : ${pdfText(client.adresse_complete)}`,
        `Ville : ${pdfText(client.libelleCommuneEtablissement)}`,
        `Code postal : ${pdfText(client.codePostalEtablissement)}`,
        `Département : ${pdfText(getClientDepartment(client), 'NC')}`,
        `Coordonnée X : ${client.coordonneeLambertAbscisseEtablissement ?? 'NC'}`,
        `Coordonnée Y : ${client.coordonneeLambertOrdonneeEtablissement ?? 'NC'}`,
        `Raison : ${getClientMapReasonForPdf(client)}`,
       
      ], {
        badgeText: clientOnMap ? 'Présent sur la carte' : 'Absent de la carte',
        badgeColor: clientOnMap ? COLOR_SUCCESS : COLOR_DANGER,
      })

      drawPanel('Prospect / Remarque', left + (colW + gap) * 2, panelYTop, colW, panelH, [
        `Action prospect : ${normalizeProspectStatus(client.prospect_status) || 'Vide'}`,
        '',
        pdfText(client.prospect_comment, 'Aucun commentaire'),
      ])

      drawPanel('Contact', left, panelYTop + panelH + gap, colW, panelH, [
        `Téléphone : ${pdfText(client.telephone)}`,
        `Email : ${pdfText(client.email)}`,
        `Site web : ${pdfText(client.site_web)}`,
        `Dirigeant : ${pdfText(client.nom_dirigeant)}`,
        `Contactable : ${client.telephone || client.email || client.contactable ? 'Oui' : 'Non'}`,
      ])

      drawPanel('Enrichissement Google', left + colW + gap, panelYTop + panelH + gap, colW, panelH, [
        `Statut : ${getEnrichmentBadge(client.enrichment_status).label}`,
        `Dernier enrichissement : ${formatDateTimeFr(client.last_enrichment_at)}`,
        `Source Google : ${pdfText(client.enrichment_source)}`,
        `Erreur : ${pdfText(client.enrichment_error, 'Aucune')}`,
        `Note Google : ${client.google_rating ?? 'NC'}`,
        `Nb avis Google : ${client.google_user_ratings_total ?? 'NC'}`,
      ])

      drawPanel('Client CEGECLIM', left + (colW + gap) * 2, panelYTop + panelH + gap, colW, panelH, [
        `Numero de client SAGE : ${pdfText(cegeclimDetails?.numero_client_sage)}`,
        `Désignation commerciale : ${pdfText(cegeclimDetails?.designation_commerciale)}`,
        `Représentant : ${pdfText(cegeclimDetails?.representant)}`,
        `Date de création : ${formatDateFr(cegeclimDetails?.date_creation || null)}`,
        `CA 2023 : ${formatCurrency(cegeclimDetails?.ca_2023)}`,
        `CA 2024 : ${formatCurrency(cegeclimDetails?.ca_2024)}`,
        `CA 2025 : ${formatCurrency(cegeclimDetails?.ca_2025)}`,
        `Statut : ${pdfText(cegeclimDetails?.statut)}`,
      ])

      doc.setDrawColor(...COLOR_BORDER)
      doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12)
      doc.setTextColor(...COLOR_MUTED)
      doc.setFontSize(8.5)
      doc.text(`Extraction feuille client - ${new Date().toLocaleDateString('fr-FR')}`, 14, pageHeight - 7)
      doc.text(`Page ${index + 1}/${sortedFilteredClients.length}`, pageWidth - 14, pageHeight - 7, { align: 'right' })
    })

    doc.save(`feuilles_clients_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  function handlePrint() {
    window.print()
  }
  
  const totalClientsBaseForScope = scopedClientsBase.length

  const totalCegeclimBase = scopedClientsCegeclim.filter((row) => isCegeclimActiveRow(row)).length

  const totalSelection = sortedFilteredClients.length
  const totalSelectedDepartments = summaryDepartments.length
  const totalSelectedNaf = Array.from(
    new Set(sortedFilteredClients.map((r) => r.activitePrincipaleEtablissement).filter(Boolean))
  ).length

  const enrichableSelection = sortedFilteredClients.filter((row) => {
    const completeness = getCompletenessPercent(row)
    return completeness < 100 || row.enrichment_status !== 'ok'
  })

  if (loading) {
    return <div style={{ padding: 24, fontSize: 14 }}>Chargement de l’écran Clients...</div>
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <section style={sectionTitleStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
  <h1 style={sectionTitleTextStyle}>Clients :</h1>

  <span style={{ fontSize: 18, fontWeight: 500, color: '#475569' }}>
    dernière mise à jour le :{' '}
    {lastImport?.date_import
      ? `${new Date(lastImport.date_import).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })} à ${new Date(lastImport.date_import).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}`
      : 'NC'}
  </span>
</div>
        </section>

        {allowedDepartements.length > 0 && (
          <div style={{ fontSize: 13, color: '#334155', marginTop: -6 }}>
            Départements visibles selon votre profil : {allowedDepartements.join(', ')}
            {currentUserEmail ? ` • ${currentUserEmail}` : ''}
          </div>
        )}



        {showClientsSection && (
          <div>
            {backgroundHydratingClients && (
              <div style={{ marginBottom: 12, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', borderRadius: 12, fontSize: 14 }}>
                Chargement rapide effectué. La liste complète continue à se charger en arrière-plan…
              </div>
            )}
            <section style={sectionTitleStyle}>
              <div style={sectionHeaderRowStyle}>

              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={kpiGridStyle}>
                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Entreprises actives base Clients</div>
                    <div style={kpiValueStyle}>{totalClientsBaseForScope}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>dont CEGECLIM actifs</div>
                    <div style={kpiValueStyle}>{totalCegeclimBase}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Nb de départements</div>
                    <div style={kpiValueStyle}>{allowedDepartements.length > 0 ? allowedDepartements.length : Array.from(new Set(scopedClientsBase.map((r) => getClientDepartment(r)).filter(Boolean))).length}</div>
                  </div>
                </div>
              </div>


              <section>
                <h2 style={sectionTitleTextStyle}>.</h2>
                <h2 style={sectionTitleTextStyle}>Synthèse par département</h2>
                  <div className="border-t border-slate-200 px-5 py-4 text-sm text-slate-700">
                 <span className="font-semibold text-slate-900">Valeur en gras : </span>  nombre total
                  d’entreprises dans la cellule.&nbsp;&nbsp;
                <span className="font-semibold text-slate-900">Valeur entre parenthèses : </span>
                  nombre de clients CEGECLIM.&nbsp;&nbsp;
                <span className="font-semibold text-slate-900">Accès carte :</span> cliquer sur une case pour pour faire apparaitre les entreprises sur une carte géo.
               </div>
              </section>

              {mode === 'clients' && (
                <>
                  <section style={{ width: '100%', overflowX: 'auto' }}>
                    <table
                      style={{
                        width: 'max-content',
                        minWidth: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 15,
                      }}
                    >
                      <thead>
                        <tr>
                          <th style={{ ...summaryHeaderCellStyle, textAlign: 'left', minWidth: 260 }}>
                            NAF DESIGNATION
                          </th>
                          <th style={summaryHeaderCellStyle}>TOTAL</th>
                          {summaryDepartments.map((dep) => (
                            <th key={dep} style={summaryHeaderCellStyle}>
                              {dep}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summarySectorRows.map((row) => (
                          <tr key={row.sector} style={{ background: getSectorColor(row.sector) }}>
                            <td style={{ ...summaryBodyCellStyle, textAlign: 'left' }}>{row.sector}</td>
                            <td style={summaryBodyCellStyleBold}>
  <button
    onClick={() => openMapFromCell(row.sector, null)}
    style={{
      width: '100%',
      height: '100%',
      fontWeight: 700,
      cursor: 'pointer',
      background: 'transparent',
      border: 'none',
    }}
  >
    {row.total} <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75 }}>({row.totalCegeclim})</span>
  </button>
</td>
                            {summaryDepartments.map((dep) => (
                              <td key={dep} style={summaryBodyCellStyleBold}>
  <button
    onClick={() => openMapFromCell(row.sector, dep)}
    style={{
      width: '100%',
      height: '100%',
      fontWeight: 700,
      cursor: 'pointer',
      background: 'transparent',
      border: 'none',
    }}
  >
    {row.byDept[dep] || 0} <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75 }}>({row.byDeptCegeclim[dep] || 0})</span>
  </button>
</td>
                            ))}
                          </tr>
                        ))}
                        <tr>
                          <td style={{ ...summaryTotalStyle, textAlign: 'left' }}>TOTAL</td>
                          <td style={summaryTotalStyle}>
  <button
    onClick={() => openMapFromCell('TOUS', null)}
    style={{
      width: '100%',
      height: '100%',
      fontWeight: 700,
      cursor: 'pointer',
      background: 'transparent',
      border: 'none',
    }}
  >
    {sortedFilteredClients.length} <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75 }}>({summaryTotalCegeclim})</span>
  </button>
</td>
                          {summaryDepartments.map((dep) => (
                            <td key={dep} style={summaryTotalStyle}>
                              <button
                                onClick={() => openMapFromCell('TOUS', dep)}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  background: 'transparent',
                                  border: 'none',
                                }}
                              >
                                {summaryDeptTotals[dep] || 0} <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>({summaryDeptCegeclimTotals[dep] || 0})</span>
                              </button>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </section>


                  <section style={{ ...sectionTitleStyle, marginTop: 18 }}>
                    <h2 style={sectionTitleTextStyle}>Filtres :</h2>
                  </section>

                  <section
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 200 }}>
                      <div style={filterLabelStyle}>Recherche libre</div>
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Raison sociale, SIRET, dirigeant..."
                        style={{ ...inputStyle, maxWidth: '100%' }}
                      />
                    </div>
                    <div style={{ minWidth: 150 }}>
                    <div style={filterLabelStyle}>Clients :</div>
                    <select
                        value={selectedClientScope}
                        onChange={(e) =>
                        setSelectedClientScope(e.target.value as 'Tous' | 'Cegeclim' | 'Prospects')
                        }
                        style={selectLikeStyle}
                    >
                        <option value="Tous">Tous</option>
                        <option value="Cegeclim">Cegeclim actif</option>
                        <option value="Prospects">Prospects</option>
                    </select>
                    </div>
                    <div style={{ width: 230 }}>
                      <MultiSelectHorizontal
                        label="Suivi Prospect :"
                        options={prospectStatusOptions}
                        selected={selectedProspectStatuses}
                        onChange={(next) => setSelectedProspectStatuses(next as ProspectStatusValue[])}
                      />
                    </div>

                    <div style={{ width: 220 }}>
                      <MultiSelectHorizontal
                        label="Activité :"
                        options={sectorOptions}
                        selected={selectedSectors}
                        onChange={setSelectedSectors}
                      />
                    </div>

                    <div style={{ width: 160 }}>
                      <MultiSelectHorizontal
                        label="Dept :"
                        options={departmentOptions}
                        selected={selectedDepartments}
                        onChange={setSelectedDepartments}
                      />
                    </div>

                    <div style={{ width: 170 }}>
                      <MultiSelectHorizontal
                        label="Code NAF :"
                        options={nafOptions}
                        selected={selectedNafCodes}
                        onChange={setSelectedNafCodes}
                      />
                    </div>

                    <div style={{ width: 380, marginLeft: 24 }}>
                      <div style={filterLabelStyle}>Ancienneté de l'entreprise</div>
                      <div style={{ position: 'relative', height: 34, marginTop: 8 }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: 13,
                            height: 6,
                            borderRadius: 999,
                            background: '#d1d5db',
                          }}
                        />
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={ageSliderMin}
                          onChange={(e) => setAgeSliderMin(Math.min(Number(e.target.value), ageSliderMax))}
                          style={dualRangeStyle}
                        />
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={ageSliderMax}
                          onChange={(e) => setAgeSliderMax(Math.max(Number(e.target.value), ageSliderMin))}
                          style={dualRangeStyle}
                        />
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, color: '#334155', fontWeight: 600 }}>
                        {formatAgePrecise(ageDaysMin)} → {formatAgePrecise(ageDaysMax)}
                      </div>
                    </div>
                  </section>

                  <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
                    <button onClick={exportExcel} style={toolbarButtonStyle}>Export Excel</button>
                    <button onClick={exportPdf} style={toolbarButtonStyle}>Créer PDF</button>
                    <button onClick={exportClientSheetsPdf} style={toolbarButtonStyle}>Imprimer feuille client PDF</button>
                    <button
                      onClick={() => void enrichBatch(enrichableSelection)}
                      style={primaryButtonStyle}
                      disabled={batchEnriching || enrichableSelection.length === 0}
                    >
                      {batchEnriching
                        ? 'Enrichissement Google en cours...'
                        : `Enrichir via Google (${Math.min(enrichableSelection.length, MAX_BATCH_ENRICH)})`}
                    </button>
                    <button
                      onClick={() => setShowCegeclimPresenceModal(true)}
                      style={{
                        ...toolbarButtonStyle,
                        fontWeight: 700,
                        borderColor: '#94a3b8',
                        background: '#fff',
                      }}
                    >
                      Présence Cegeclim (%)
                    </button>
                  </section>

                  <section style={{ ...sectionTitleStyle, marginTop: 28 }}>
  <div>
    <h2
      style={{
        ...sectionTitleTextStyle,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: 0,
      }}
    >
      <span>Liste des entreprises :</span>
      <span
        style={{
          color: '#facc15',
          fontSize: 14,
          lineHeight: 1,
          textShadow: '0 0 1px #a16207',
        }}
      >
        ★
      </span>
      <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>
        Clients CEGECLIM actifs
      </span>
      <span
        style={{
          color: '#dc2626',
          fontSize: 14,
          lineHeight: 1,
          textShadow: '0 0 1px #7f1d1d',
          marginLeft: 8,
        }}
      >
        ★
      </span>
      <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>
        Clients CEGECLIM sommeil
      </span>  
    </h2>

    <div style={{ marginTop: 6, fontSize: 15 }}>
      {sortedFilteredClients.length} entreprise(s) affichées
    </div>
  </div>
</section>
                  <section style={{ width: '100%', overflowX: 'auto' }}>
                    <table
                      style={{
                        width: 'max-content',
                        minWidth: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 12,
                        lineHeight: 1.15,
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '2px solid #111' }}>
                          <th onClick={() => toggleSort('designation')} style={{ ...listHeaderStyle, width: 145 }}>
                            Désignation<SortIndicator active={sortKey === 'designation'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('siret')} style={{ ...listHeaderStyle, width: 125 }}>
                            Siret<SortIndicator active={sortKey === 'siret'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('departement')} style={{ ...listHeaderStyle, width: 55 }}>
                            Dépt.<SortIndicator active={sortKey === 'departement'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('ville')} style={{ ...listHeaderStyle, width: 145 }}>
                            Ville<SortIndicator active={sortKey === 'ville'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('codePostal')} style={{ ...listHeaderStyle, width: 90 }}>
                            Code postal<SortIndicator active={sortKey === 'codePostal'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('naf')} style={{ ...listHeaderStyle, width: 80 }}>
                            APE/NAF<SortIndicator active={sortKey === 'naf'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('secteur')} style={{ ...listHeaderStyle, width: 145 }}>
                            Secteur d'activité<SortIndicator active={sortKey === 'secteur'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('creation')} style={{ ...listHeaderStyle, width: 90 }}>
                            Création<SortIndicator active={sortKey === 'creation'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('anciennete')} style={{ ...listHeaderStyle, width: 105 }}>
                            Ancienneté<SortIndicator active={sortKey === 'anciennete'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('telephone')} style={{ ...listHeaderStyle, width: 70 }}>
                            Tel<SortIndicator active={sortKey === 'telephone'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('email')} style={{ ...listHeaderStyle, width: 70 }}>
                            Mail<SortIndicator active={sortKey === 'email'} direction={sortDirection} />
                          </th>
                          <th style={{ ...listHeaderStyle, width: 250 }}>
                            Actions / Suivi prospect
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedClients.map((row) => {
                          const sector = row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement)
                          const distance = selectedAgenceRow
                            ? distanceKmLambert(
                                row.coordonneeLambertAbscisseEtablissement,
                                row.coordonneeLambertOrdonneeEtablissement,
                                selectedAgenceRow.coord_x_lambert,
                                selectedAgenceRow.coord_y_lambert
                              )
                            : null
      const isPresentInCegeclim = isClientPresentInCegeclim(row, activeCegeclimBySiret)
                          const cegeclimSommeilRow = getClientCegeclimRow(row, sommeilCegeclimBySiret)
                          const isCegeclimSommeil = Boolean(cegeclimSommeilRow)
                          const prospectStatus = normalizeProspectStatus(row.prospect_status)
                          const prospectStatusColors = getProspectStatusColors(prospectStatus)
                          const siret = row.siret || ''
                          const isEnriching = enrichingSirets.includes(siret)

                          return (
                            <tr
                              key={`${row.siret}-${row.id}` }
                              onClick={() => {
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                                setSelectedClient(row)
                              }}
                              style={{
                                background: getSectorColor(sector),
                                borderBottom: '1px solid #b3a4a4',
                                cursor: 'pointer',
                              }}
                            >
                              <td style={listCellStyle}>
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {isPresentInCegeclim ? (
      <span
        title="Client CEGECLIM actif"
        style={{
          color: '#facc15',
          fontSize: 14,
          lineHeight: 1,
          textShadow: '0 0 1px #a16207',
        }}
      >
        ★
      </span>
    ) : isCegeclimSommeil ? (
      <span
        title="Client CEGECLIM sommeil"
        style={{
          color: '#dc2626',
          fontSize: 14,
          lineHeight: 1,
          textShadow: '0 0 1px #7f1d1d',
        }}
      >
        ★
      </span>
    ) : null}

    <span title={row.raison_sociale_affichee || ''}>
      {truncateText(row.raison_sociale_affichee, 25)}
    </span>
  </span>
</td>
                              <td style={listCellStyle}>{row.siret || 'ND'}</td>
                              <td style={listCellStyle}>{getClientDepartment(row) || 'ND'}</td>
                              <td style={listCellStyle}>{row.libelleCommuneEtablissement || 'ND'}</td>
                              <td style={listCellStyle}>{row.codePostalEtablissement || 'ND'}</td>
                              <td style={listCellStyle}>{row.activitePrincipaleEtablissement || 'ND'}</td>
                              <td style={listCellStyle}>{sector}</td>
                              <td style={listCellStyle}>{formatDateFr(row.dateCreationEtablissement)}</td>
                              <td style={listCellStyle}>{formatAgePrecise(diffDaysFromToday(row.dateCreationEtablissement))}</td>
                              <td style={listCellStyle}>{row.telephone || '—'}</td>
                              <td style={listCellStyle}>{row.email || '—'}</td>
                              <td style={listCellStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <button onClick={(e) => { e.stopPropagation(); window.scrollTo({ top: 0, behavior: 'smooth' }); setSelectedClient(row) }} style={linkButtonStyle}>
                                    Voir
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void enrichClientBySiret(siret) }}
                                    style={tinyPrimaryButtonStyle}
                                    disabled={!siret || isEnriching}
                                  >
                                    {isEnriching ? '...' : 'Enrichir'}
                                  </button>
                                  <span
                                    style={{
                                      ...pillStyle,
                                      background: prospectStatusColors.background,
                                      color: prospectStatusColors.color,
                                      border: `1px solid ${prospectStatusColors.borderColor}`,
                                    }}
                                  >
                                    {prospectStatus || '—'}
                                  </span>
                                </div>
                                {row.prospect_comment ? (
                                  <div style={{ marginTop: 6, color: '#334155', maxWidth: 220 }}>
                                    {truncateText(row.prospect_comment, 60)}
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    <div style={paginationWrapStyle}>
                      <button
                        style={paginationButtonStyle}
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      >
                        Précédent
                      </button>
                      <span style={{ fontSize: 14 }}>
                        Page {currentPage} / {totalPages}
                      </span>
                      <button
                        style={paginationButtonStyle}
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Suivant
                      </button>
                    </div>
                  </section>
                </>
              )}

              {mode === 'cegeclim_absents' && (
                <section style={{ overflowX: 'auto', background: '#fff', border: '1px solid #ccc' }}>
                  <table style={{ minWidth: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#eee' }}>
                      <tr>
                        <th style={simpleHeadStyle}>SIRET</th>
                        <th style={simpleHeadStyle}>Date création client</th>
                        <th style={simpleHeadStyle}>Agence</th>
                        <th style={simpleHeadStyle}>Code postal</th>
                        <th style={simpleHeadStyle}>Contact</th>
                        <th style={simpleHeadStyle}>Téléphone</th>
                        <th style={simpleHeadStyle}>Email</th>
                        <th style={simpleHeadStyle}>CA 2026</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedCegeclimAbsents.map((row) => (
                        <tr key={row.id}>
                          <td style={simpleCellStyle}>{row.siret || 'NC'}</td>
                          <td style={simpleCellStyle}>{formatDateFr(row.date_creation_client)}</td>
                          <td style={simpleCellStyle}>{row.agence_rattachement || 'NC'}</td>
                          <td style={simpleCellStyle}>{row.code_postal || 'NC'}</td>
                          <td style={simpleCellStyle}>{row.contact || '—'}</td>
                          <td style={simpleCellStyle}>{row.telephone || '—'}</td>
                          <td style={simpleCellStyle}>{row.email || '—'}</td>
                          <td style={simpleCellStyle}>{row.ca_2026 ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}


            </section>
            {mapOpen && (
              <div style={mapOverlayStyle}>
                <div style={mapModalStyle}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 20,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 520, flex: 1 }}>
                      <h2 style={{ margin: 0 }}>{mapTitle}</h2>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          flexWrap: 'wrap',
                          fontSize: 14,
                          color: '#334155',
                        }}
                      >
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={showMapProspects}
                            onChange={(e) => setShowMapProspects(e.target.checked)}
                          />
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              background: '#94a3b8',
                              border: '1px solid #334155',
                              display: 'inline-block',
                            }}
                          />
                          Prospects géolocalisés ({mapProspectPoints.length})
                        </label>

                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={showMapCegeclim}
                            onChange={(e) => setShowMapCegeclim(e.target.checked)}
                          />
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              background: '#94a3b8',
                              border: '3px solid #facc15',
                              display: 'inline-block',
                              boxSizing: 'border-box',
                            }}
                          />
                          Clients CEGECLIM géolocalisés ({mapCegeclimPoints.length})
                        </label>

                        {mapLegendSectors.map((sector) => (
                          <label
                            key={sector}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={mapSectorVisibility[sector] !== false}
                              onChange={(e) =>
                                setMapSectorVisibility((prev) => ({
                                  ...prev,
                                  [sector]: e.target.checked,
                                }))
                              }
                            />
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                background: getSectorColor(sector),
                                border: '1px solid #475569',
                                display: 'inline-block',
                              }}
                            />
                            {sector}
                          </label>
                        ))}
                      </div>

                      <div style={{ fontSize: 15, fontWeight: 700 }}>
                        {visibleMapRows.length} entreprises visibles
                      </div>
                    </div>

                    <div style={{ width: 320, minWidth: 320 }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>Ancienneté min / max</div>

                      <div style={{ position: 'relative', height: 42 }}>
                        <div
                          style={{
                            position: 'absolute',
                            top: 16,
                            left: 0,
                            right: 0,
                            height: 6,
                            borderRadius: 999,
                            background: '#d1d5db',
                          }}
                        />

                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={mapAgeSliderMin}
                          onChange={(e) =>
                            setMapAgeSliderMin(Math.min(Number(e.target.value), mapAgeSliderMax))
                          }
                          style={dualRangeStyle}
                        />

                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={mapAgeSliderMax}
                          onChange={(e) =>
                            setMapAgeSliderMax(Math.max(Number(e.target.value), mapAgeSliderMin))
                          }
                          style={dualRangeStyle}
                        />
                      </div>

                      <div style={{ marginTop: 6, fontSize: 13, color: '#475569', fontWeight: 700 }}>
                        {mapAgeRangeLabel}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      flex: 1,
                      padding: 12,
                      overflow: 'hidden',
                      background: '#f8fafc',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      minHeight: 0,
                    }}
                  >
                    {mapLoading ? (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#475569',
                          fontSize: 18,
                          fontWeight: 600,
                        }}
                      >
                        Chargement...
                      </div>
                    ) : visibleMapRows.length === 0 ? (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#475569',
                          fontSize: 18,
                          fontWeight: 600,
                        }}
                      >
                        Aucun point géolocalisé à afficher
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) 360px',
                          gap: 14,
                          alignItems: 'stretch',
                          minHeight: 620,
                          flex: 1,
                        }}
                      >
                        <div
                          style={{
                            borderRadius: 16,
                            overflow: 'hidden',
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            minHeight: 620,
                          }}
                        >
                          <MapContainer
                            key={`map-${mapInstanceKey}-${mapTitle}`}
                            center={[46.603354, 1.888334] as any}
                            zoom={6}
                            style={{ height: '100%', width: '100%', minHeight: 620 }}
                            ref={(mapInstance: any) => {
                              if (mapInstance) leafletMapRef.current = mapInstance
                            }}
                          >
                            <TileLayer
                              attribution='&copy; OpenStreetMap contributors'
                              url="https://api.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=3750cd83dca34199969e6b9e2dcdca40"
                            />

                            {visibleMapPoints.map((client) => {
                              const isCegeclim = isClientPresentInCegeclim(client, activeCegeclimBySiret)
                              const sectorLabel = getClientSectorLabel(client)
                              const markerColor = getSectorColor(sectorLabel)

                              return (
                                <CircleMarker
                                  key={client.id}
                                  center={[client.latitude as number, client.longitude as number]}
                                  radius={6}
                                  pathOptions={{
                                    color: isCegeclim ? '#facc15' : '#334155',
                                    fillColor: markerColor,
                                    fillOpacity: 0.95,
                                    weight: isCegeclim ? 3 : 1.5,
                                  }}
                                  eventHandlers={{
                                    click: () => {
                                      void openClientFromMap(client)
                                    },
                                  }}
                                >
                                  <Tooltip direction="top" offset={[0, -8]} opacity={1} sticky>
                                    <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                                      <div style={{ fontWeight: 700 }}>
                                        {client.raison_sociale_affichee || 'Sans nom'}
                                      </div>
                                      <div>{getClientSectorLabel(client)}</div>
                                      <div>
                                        {client.libelleCommuneEtablissement || '—'} {client.dateCreationEtablissement || ''}
                                      </div>
                                    </div>
                                  </Tooltip>
                                </CircleMarker>
                              )
                            })}
                          </MapContainer>
                        </div>

                        <div
                          style={{
                            borderRadius: 16,
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            overflow: 'hidden',
                            minHeight: 620,
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 14px',
                              borderBottom: '1px solid #e2e8f0',
                              fontWeight: 800,
                              fontSize: 15,
                            }}
                          >
                            Entreprises visibles ({visibleMapRows.length})
                          </div>

                          <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 110px 80px',
                                gap: 10,
                                fontWeight: 800,
                                fontSize: 12,
                                color: '#334155',
                              }}
                            >
                              <div>Désignation</div>
                              <div>Ville</div>
                              <div>Créée le</div>
                            </div>
                          </div>

                          <div style={{ overflowY: 'auto', flex: 1 }}>
                            {visibleMapRows.map((client) => {
                              const isCegeclim = isClientPresentInCegeclim(client, activeCegeclimBySiret)
                              const sectorLabel = getClientSectorLabel(client)

                              return (
                                <button
                                  key={client.id}
                                  type="button"
                                  onClick={() => void openClientFromMap(client)}
                                  style={{
                                    width: '100%',
                                    border: 'none',
                                    borderBottom: '1px solid #e2e8f0',
                                    background: getSectorColor(sectorLabel),
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    padding: '10px 10px',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '1fr 110px 80px',
                                      gap: 10,
                                      alignItems: 'center',
                                      fontSize: 13,
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                      <span
                                        style={{
                                          width: 10,
                                          height: 10,
                                          borderRadius: '50%',
                                          background: getSectorColor(sectorLabel),
                                          border: isCegeclim ? '2px solid #facc15' : '2px solid #64748b',
                                          flexShrink: 0,
                                        }}
                                      />
                                      <span
                                        style={{
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          fontWeight: 700,
                                        }}
                                      >
                                        {client.raison_sociale_affichee || 'Sans nom'}
                                      </span>
                                    </div>

                                    <div
                                      style={{
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {client.libelleCommuneEtablissement || '—'}
                                    </div>

                                    <div>{client.dateCreationEtablissement || '—'}</div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <button onClick={() => setMapOpen(false)}>Fermer</button>
                </div>
              </div>
            )}

        {selectedClient && (
          <div style={modalOverlayStyle}>
            <div style={clientModalStyle}>
              <div style={clientModalHeaderStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Flèche gauche */}
                  <button
                    onClick={openPreviousClient}
                    disabled={!previousClient}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      background: previousClient ? '#fff' : '#f1f5f9',
                      cursor: previousClient ? 'pointer' : 'not-allowed',
                      fontSize: 18,
                      fontWeight: 700,
                    }}
                    title="Client précédent"
                  >
                    ←
                  </button>

                  {/* Flèche droite */}
                  <button
                    onClick={openNextClient}
                    disabled={!nextClient}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      background: nextClient ? '#fff' : '#f1f5f9',
                      cursor: nextClient ? 'pointer' : 'not-allowed',
                      fontSize: 18,
                      fontWeight: 700,
                    }}
                    title="Client suivant"
                  >
                    →
                  </button>

                  {/* Titre */}
                  <div>
                    <h3 style={clientModalTitleStyle}>
                      {selectedClient.raison_sociale_affichee || 'Entreprise'}
                    </h3>
                    <div style={clientModalSubtitleStyle}>
                      SIRET : {selectedClient.siret || 'NC'}
                    </div>
                  </div>
                </div>

                <div style={clientHeaderBadgesWrapStyle}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    <span>Action prospect :</span>
                    <select
                      value={normalizeProspectStatus(selectedClient.prospect_status)}
                      onChange={(e) => void saveSelectedClientField('prospect_status', e.target.value)}
                      style={{
                        ...selectLikeStyle,
                        minWidth: 220,
                        background: getProspectStatusColors(normalizeProspectStatus(selectedClient.prospect_status)).background,
                        color: getProspectStatusColors(normalizeProspectStatus(selectedClient.prospect_status)).color,
                        borderColor: getProspectStatusColors(normalizeProspectStatus(selectedClient.prospect_status)).borderColor,
                        fontWeight: 700,
                      }}
                    >
                      <option value="">Vide</option>
                      {PROSPECT_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    onClick={() => {
                      if (selectedClient.siret) void enrichClientBySiret(selectedClient.siret)
                    }}
                    style={primaryButtonStyle}
                    disabled={
                      !selectedClient.siret ||
                      enrichingSirets.includes(selectedClient.siret)
                    }
                  >
                    {selectedClient.siret && enrichingSirets.includes(selectedClient.siret)
                      ? 'Enrichissement...'
                      : 'Enrichir la fiche'}
                  </button>

                  <button onClick={() => setSelectedClient(null)} style={toolbarButtonStyle}>
                    Fermer
                  </button>
                </div>
              </div>

              <div style={clientModalBodyStyle}>
                <div style={clientBlocksGridStyle}>
                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Identité</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Téléphone :</b> {selectedClient.telephone || 'NC'}</div>             
                      <div><b>SIRET :</b> {selectedClient.siret || 'NC'}</div>
                      <div><b>Code NAF :</b> {selectedClient.activitePrincipaleEtablissement || 'NC'}</div>
                      <div>
                          <b>Secteur :</b>{' '}
                          {selectedClient.naf_libelle_traduit ||
                            translateNaf(selectedClient.activitePrincipaleEtablissement)}
                      </div>
                      <div><b>Date création :</b> {formatDateFr(selectedClient.dateCreationEtablissement)}</div>
                      <div>
                          <b>Ancienneté :</b>{' '}
                          {formatAgePrecise(diffDaysFromToday(selectedClient.dateCreationEtablissement))}
                      </div>
                      <div><b>Effectifs SIRENE :</b> {selectedClient.trancheEffectifsEtablissement || 'NC'}</div>
                      <div><b>Effectif estimé :</b> {selectedClient.effectif_estime ?? 'NC'}</div>
                      <div><b>Présent base CEGECLIM :</b> {isClientPresentInCegeclim(selectedClient, activeCegeclimBySiret) ? getClientCegeclimCode(selectedClient, activeCegeclimBySiret) : selectedClientCegeclimSommeil ? 'SOMMEIL' : 'NON'}</div>
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div
                      style={{
                        ...clientBlockTitleStyle,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 14,
                      }}
                    >
                      <span>Localisation</span>

                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '5px 8px',
                          borderRadius: 999,
                          fontSize: 13,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: selectedClientVisibleOnMap ? '#166534' : '#991b1b',
                          color: '#fff',
                        }}
                        title={selectedClientMapReason}
                      >
                        {selectedClientVisibleOnMap ? 'Présent sur la carte' : 'Absent de la carte'}
                      </span>
                    </div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Adresse :</b> {selectedClient.adresse_complete || 'NC'}</div>
                      <div><b>Ville :</b> {selectedClient.libelleCommuneEtablissement || 'NC'}</div>
                      <div><b>Code postal :</b> {selectedClient.codePostalEtablissement || 'NC'}</div>
                      <div><b>Département :</b> {getClientDepartment(selectedClient) || 'NC'}</div>
                      <div><b>Coordonnée X :</b> {selectedClient.coordonneeLambertAbscisseEtablissement ?? 'NC'}</div>
                      <div><b>Coordonnée Y :</b> {selectedClient.coordonneeLambertOrdonneeEtablissement ?? 'NC'}</div>
                      <div style={{ marginTop: 10 }}>
                        <strong>Raison :</strong> {selectedClientMapReason}
                      </div>
                      {selectedClient.google_maps_url ? (
                        <div>
                          <b>Google Maps :</b>{' '}
                          <a href={selectedClient.google_maps_url} target="_blank" rel="noreferrer">
                            Ouvrir
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Prospect / Remarque</div>
                    <div style={clientBlockContentStyle}>
                      <div style={{ marginBottom: 12 }}>
                        <b>Action prospect :</b>{' '}
                        <span
                          style={{
                            ...inlineBadgeStyle,
                            background: getProspectStatusColors(normalizeProspectStatus(selectedClient.prospect_status)).background,
                            color: getProspectStatusColors(normalizeProspectStatus(selectedClient.prospect_status)).color,
                            border: `1px solid ${getProspectStatusColors(normalizeProspectStatus(selectedClient.prospect_status)).borderColor}`,
                          }}
                        >
                          {normalizeProspectStatus(selectedClient.prospect_status) || 'Vide'}
                        </span>
                      </div>
                      <textarea
                          value={prospectCommentDraft}
                          onChange={(e) => setProspectCommentDraft(e.target.value)}
                          onBlur={() => {
                            if (prospectCommentDraft !== (selectedClient?.prospect_comment || '')) {
                              void saveSelectedClientField('prospect_comment', prospectCommentDraft)
                            }
                          }}
                          placeholder="Vous pouvez saisir du texte"
                          style={{
                            width: '100%',
                            minHeight: 260,
                            resize: 'vertical',
                            border: '1px solid #cbd5e1',
                            borderRadius: 12,
                            padding: 12,
                            fontFamily: 'inherit',
                            fontSize: 14,
                            background: '#fff',
                          }}
                        />
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Contact</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Téléphone :</b> {selectedClient.telephone || 'NC'}</div>
                      <div><b>Email :</b> {selectedClient.email || 'NC'}</div>
                      <div><b>Site web :</b> {selectedClient.site_web || 'NC'}</div>
                      <div><b>Dirigeant :</b> {selectedClient.nom_dirigeant || 'NC'}</div>
                      <div>
                        <b>Contactable :</b>{' '}
                        {selectedClient.telephone || selectedClient.email || selectedClient.contactable
                          ? 'Oui'
                          : 'Non'}
                      </div>
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Enrichissement Google</div>
                    <div style={clientBlockContentStyle}>
                      <div>
                        <b>Statut :</b>{' '}
                        <span
                          style={{
                            ...inlineBadgeStyle,
                            background: getEnrichmentBadge(selectedClient.enrichment_status).bg,
                            color: '#fff',
                          }}
                        >
                          {getEnrichmentBadge(selectedClient.enrichment_status).label}
                        </span>
                      </div>
                      <div><b>Dernier enrichissement :</b> {formatDateTimeFr(selectedClient.last_enrichment_at)}</div>
                      <div><b>Source Google :</b> {selectedClient.enrichment_source || 'NC'}</div>
                      <div><b>Erreur :</b> {selectedClient.enrichment_error || 'Aucune'}</div>
                      <div><b>Note Google :</b> {selectedClient.google_rating ?? 'NC'}</div>
                      <div><b>Nb avis Google :</b> {selectedClient.google_user_ratings_total ?? 'NC'}</div>
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Client CEGECLIM</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Numero de client SAGE :</b> {selectedClientCegeclim?.numero_client_sage || 'NC'}</div>
                      <div><b>Désignation commerciale :</b> {selectedClientCegeclim?.designation_commerciale || 'NC'}</div>
                      <div><b>Représentant :</b> {selectedClientCegeclim?.representant || 'NC'}</div>
                      <div><b>Date de création :</b> {formatDateFr(selectedClientCegeclim?.date_creation || null)}</div>
                      <div><b>CA 2023 :</b> {formatCurrency(selectedClientCegeclim?.ca_2023)}</div>
                      <div><b>CA 2024 :</b> {formatCurrency(selectedClientCegeclim?.ca_2024)}</div>
                      <div><b>CA 2025 :</b> {formatCurrency(selectedClientCegeclim?.ca_2025)}</div>
                      <div><b>Statut :</b> {selectedClientCegeclim?.statut || selectedClientCegeclimSommeil?.statut || 'NC'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
          </div>
        )}

        {showCegeclimPresenceModal && (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalStyle, maxWidth: 'calc(100vw - 32px)', width: 'calc(100vw - 32px)' }}>
              <div style={modalHeaderStyle}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 24 }}>Présence Cegeclim (%)</h3>
                  <p style={{ margin: '6px 0 0 0', fontSize: 14, color: '#475569' }}>
                    4 activités principales • nombre de clients CEGECLIM + taux de pénétration par département
                  </p>
                </div>
                <button onClick={() => setShowCegeclimPresenceModal(false)} style={toolbarButtonStyle}>
                  Fermer
                </button>
              </div>

              <div style={{ padding: 24 }}>
                <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, color: '#334155' }}>
                  <span><b>Lecture :</b> nombre CEGECLIM en gras</span>
                  <span><b>Barre :</b> taux CEGECLIM / total</span>
                  <span><b>Couleurs :</b> rouge faible • vert fort</span>
                </div>

                <div style={{ width: '100%', overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 16 }}>
                  <table
                    style={{
                      width: 'max-content',
                      minWidth: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 15,
                      background: '#fff',
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ ...summaryHeaderCellStyle, textAlign: 'left', minWidth: 240 }}>NAF DESIGNATION</th>
                        <th style={summaryHeaderCellStyle}>TOTAL</th>
                        {summaryDepartments.map((dep) => (
                          <th key={`presence-head-${dep}`} style={summaryHeaderCellStyle}>
                            {dep}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cegeclimPresenceRows.map((row) => {
                        const totalPercent = row.total > 0 ? (row.totalCegeclim / row.total) * 100 : 0
                        return (
                          <tr key={`presence-row-${row.sector}`} style={{ background: getSectorColor(row.sector) }}>
                            <td style={{ ...summaryBodyCellStyle, textAlign: 'left', fontWeight: 700 }}>{row.sector}</td>
                            <td style={{ ...summaryBodyCellStyleBold, minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10, minHeight: 54 }}>
                                <span style={{ fontWeight: 800, fontSize: 20 }}>{row.totalCegeclim}</span>
                                <div title={formatPercent(totalPercent)} style={{ display: 'flex', alignItems: 'flex-end', height: 42 }}>
                                  <div
                                    style={{
                                      width: 14,
                                      height: getPresenceBarHeight(totalPercent),
                                      borderRadius: 6,
                                      background: getPresencePercentColor(totalPercent),
                                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
                                    }}
                                  />
                                </div>
                              </div>
                              <div style={{ marginTop: 4, fontSize: 15, opacity: 0.85 }}>{formatPercent(totalPercent)}</div>
                            </td>
                            {summaryDepartments.map((dep) => {
                              const cegeclimCount = row.byDeptCegeclim[dep] || 0
                              const totalCount = row.byDept[dep] || 0
                              const percent = totalCount > 0 ? (cegeclimCount / totalCount) * 100 : 0
                              return (
                                <td key={`presence-${row.sector}-${dep}`} style={{ ...summaryBodyCellStyleBold, minWidth: 92 }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10, minHeight: 54 }}>
                                    <span style={{ fontWeight: 800, fontSize: 20 }}>{cegeclimCount}</span>
                                    <div title={`${cegeclimCount} / ${totalCount} • ${formatPercent(percent)}`} style={{ display: 'flex', alignItems: 'flex-end', height: 42 }}>
                                      <div
                                        style={{
                                          width: 14,
                                          height: getPresenceBarHeight(percent),
                                          borderRadius: 6,
                                          background: getPresencePercentColor(percent),
                                          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div style={{ marginTop: 4, fontSize: 15, opacity: 0.85 }}>{formatPercent(percent)}</div>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                      <tr>
                        <td style={{ ...summaryTotalStyle, textAlign: 'left' }}>TOTAL</td>
                        <td style={{ ...summaryTotalStyle, minWidth: 120 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10, minHeight: 54 }}>
                            <span style={{ fontWeight: 800, fontSize: 20 }}>{summaryTotalCegeclim}</span>
                            <div
                              title={formatPercent(sortedFilteredClients.length > 0 ? (summaryTotalCegeclim / sortedFilteredClients.length) * 100 : 0)}
                              style={{ display: 'flex', alignItems: 'flex-end', height: 42 }}
                            >
                              <div
                                style={{
                                  width: 14,
                                  height: getPresenceBarHeight(sortedFilteredClients.length > 0 ? (summaryTotalCegeclim / sortedFilteredClients.length) * 100 : 0),
                                  borderRadius: 6,
                                  background: getPresencePercentColor(sortedFilteredClients.length > 0 ? (summaryTotalCegeclim / sortedFilteredClients.length) * 100 : 0),
                                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
                                }}
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 4, fontSize: 15, opacity: 0.85 }}>
                            {formatPercent(sortedFilteredClients.length > 0 ? (summaryTotalCegeclim / sortedFilteredClients.length) * 100 : 0)}
                          </div>
                        </td>
                        {summaryDepartments.map((dep) => {
                          const cegeclimCount = summaryDeptCegeclimTotals[dep] || 0
                          const totalCount = summaryDeptTotals[dep] || 0
                          const percent = totalCount > 0 ? (cegeclimCount / totalCount) * 100 : 0
                          return (
                            <td key={`presence-total-${dep}`} style={{ ...summaryTotalStyle, minWidth: 92 }}>
                              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 10, minHeight: 54 }}>
                                <span style={{ fontWeight: 800, fontSize: 20 }}>{cegeclimCount}</span>
                                <div title={`${cegeclimCount} / ${totalCount} • ${formatPercent(percent)}`} style={{ display: 'flex', alignItems: 'flex-end', height: 42 }}>
                                  <div
                                    style={{
                                      width: 14,
                                      height: getPresenceBarHeight(percent),
                                      borderRadius: 6,
                                      background: getPresencePercentColor(percent),
                                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
                                    }}
                                  />
                                </div>
                              </div>
                              <div style={{ marginTop: 4, fontSize: 15, opacity: 0.85 }}>{formatPercent(percent)}</div>
                            </td>
                          )
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {showRejects && (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalStyle, maxWidth: 1600 }}>
              <div style={modalHeaderStyle}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 22 }}>Rejets du dernier import</h3>
                  <p style={{ margin: '6px 0 0 0', fontSize: 14 }}>{rejects.length} rejet(s)</p>
                </div>
                <button onClick={() => setShowRejects(false)} style={toolbarButtonStyle}>
                  Fermer
                </button>
              </div>

              <div style={{ overflowX: 'auto', padding: 24 }}>
                <table style={{ minWidth: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#eee' }}>
                    <tr>
                      <th style={simpleHeadStyle}>Ligne</th>
                      <th style={simpleHeadStyle}>SIRET</th>
                      <th style={simpleHeadStyle}>Motif</th>
                      <th style={simpleHeadStyle}>Données source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejects.map((row) => (
                      <tr key={row.id}>
                        <td style={simpleCellStyle}>{row.ligne_numero}</td>
                        <td style={simpleCellStyle}>{row.siret || 'NC'}</td>
                        <td style={simpleCellStyle}>{row.motif_rejet}</td>
                        <td style={simpleCellStyle}>
                          <pre style={preStyle}>{JSON.stringify(row.donnees_source_json, null, 2)}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
    </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  background: '#f3f3f3',
  padding: '8px',
  boxSizing: 'border-box',
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 'none',
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
}

const sectionTitleStyle: React.CSSProperties = {
  borderBottom: '2px solid #111',
  paddingBottom: '4px',
}

const pageTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 800,
  lineHeight: 1,
}

const sectionTitleTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 800,
}

const topToggleGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '16px',
}

const sectionToggleStyle: React.CSSProperties = {
  border: '1px solid #bfc3c9',
  background: '#fff',
  borderRadius: '14px',
  padding: '14px 16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '16px',
  fontWeight: 800,
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
}

const sectionToggleActiveStyle: React.CSSProperties = {
  ...sectionToggleStyle,
  background: '#e9eaec',
}

const sectionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '18px',
  border: '1px solid #d6d9de',
  boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
  padding: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
}

const sectionHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
}

const sectionBlockTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 800,
}

const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '16px',
}

const kpiCardStyle: React.CSSProperties = {
  background: '#e9eaec',
  border: '1px solid #bfc3c9',
  borderRadius: '14px',
  minHeight: '48px',
  padding: '14px 18px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
}

const kpiTitleStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  lineHeight: 1.15,
  color: '#111',
}

const kpiValueStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 800,
  color: '#000',
  lineHeight: 1,
}

const captionRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '16px',
}

const groupCaptionStyle: React.CSSProperties = {
  marginLeft: '4px',
  fontSize: '13px',
  fontWeight: 700,
  color: '#333',
}

const uploadWrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  background: '#eeeeee',
  padding: '8px 12px',
  fontSize: '16px',
  flexWrap: 'wrap',
}

const filtersGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '24px',
  alignItems: 'start',
  width: '100%',
}

const filterRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  gap: '12px',
  alignItems: 'center',
}

const filterLabelCellStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
}

const filterLabelStyle: React.CSSProperties = {
  marginBottom: '4px',
  fontSize: '13px',
  fontWeight: 700,
}

const inputStyle: React.CSSProperties = {
  height: '38px',
  width: '100%',
  maxWidth: '320px',
  borderRadius: '9px',
  border: '1px solid #6aa0ff',
  background: '#fff',
  padding: '0 14px',
  fontSize: '14px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
}

const inputStyleFull: React.CSSProperties = {
  height: '42px',
  width: '100%',
  borderRadius: '9px',
  border: '1px solid #6aa0ff',
  background: '#fff',
  padding: '0 14px',
  fontSize: '14px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
}

const selectLikeStyle: React.CSSProperties = {
  height: '38px',
  width: '100%',
  maxWidth: '320px',
  borderRadius: '9px',
  border: '1px solid #6aa0ff',
  background: '#fff',
  padding: '0 14px',
  fontSize: '14px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const multiPanelStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 30,
  marginTop: '8px',
  width: '420px',
  maxWidth: '44vw',
  borderRadius: '10px',
  border: '1px solid #c7c7c7',
  background: '#fff',
  padding: '12px',
  boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
}

const miniButtonStyle: React.CSSProperties = {
  border: '1px solid #999',
  background: '#fff',
  borderRadius: '4px',
  padding: '4px 10px',
  fontSize: '12px',
  cursor: 'pointer',
}

const distanceRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 130px',
  gap: '12px',
  alignItems: 'center',
  width: '100%',
  maxWidth: '420px',
}

const distanceBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '40px',
  borderRadius: '10px',
  border: '1px solid #6aa0ff',
  background: '#fff',
  fontSize: '15px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
  width: '130px',
}

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  fontSize: '14px',
  fontWeight: 700,
}

const checkboxStyle: React.CSSProperties = {
  width: '20px',
  height: '20px',
}

const ageRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: '12px',
  alignItems: 'center',
}

const ageLabelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
}

const dualRangeStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '34px',
  background: 'transparent',
  pointerEvents: 'auto',
}

const summaryHeaderCellStyle: React.CSSProperties = {
  borderBottom: '1px solid #666',
  borderLeft: '1px solid #c8c8c8',
  padding: '6px 12px',
  textAlign: 'center',
  fontSize: '18px',
  fontWeight: 800,
}

const summaryBodyCellStyle: React.CSSProperties = {
  borderLeft: '1px solid #c8c8c8',
  padding: '8px 12px',
  textAlign: 'center',
  fontSize: '14px',
}

const summaryBodyCellStyleBold: React.CSSProperties = {
  ...summaryBodyCellStyle,
  fontWeight: 700,
}

const summaryTotalStyle: React.CSSProperties = {
  borderLeft: '1px solid #c8c8c8',
  padding: '12px 12px',
  textAlign: 'center',
  fontSize: '15px',
  fontWeight: 800,
}

const toolbarButtonStyle: React.CSSProperties = {
  border: '1px solid #999',
  background: '#fff',
  borderRadius: '4px',
  padding: '7px 12px',
  fontSize: '15px',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid #1d4ed8',
  background: '#828386',
  color: '#fff',
  borderRadius: '4px',
  padding: '7px 12px',
  fontSize: '15px',
  cursor: 'pointer',
}

const tinyPrimaryButtonStyle: React.CSSProperties = {
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#fff',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '11px',
  cursor: 'pointer',
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '44px',
  padding: '4px 8px',
  borderRadius: '999px',
  color: '#fff',
  fontWeight: 700,
  fontSize: '11px',
}

const listHeaderStyle: React.CSSProperties = {
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: 800,
  padding: '8px 8px',
  whiteSpace: 'nowrap',
}

const listCellStyle: React.CSSProperties = {
  padding: '8px 8px',
  fontSize: '12px',
  whiteSpace: 'nowrap',
  verticalAlign: 'top',
}

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontWeight: 700,
  cursor: 'pointer',
}

const paginationWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '12px',
  marginTop: '14px',
}

const paginationButtonStyle: React.CSSProperties = {
  border: '1px solid #999',
  background: '#fff',
  borderRadius: '6px',
  padding: '6px 12px',
  fontSize: '14px',
  cursor: 'pointer',
}

const simpleHeadStyle: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  borderBottom: '1px solid #ccc',
}

const simpleCellStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #eee',
  verticalAlign: 'top',
}

const tabStyle: React.CSSProperties = {
  border: '1px solid #999',
  background: '#fff',
  borderRadius: '10px',
  padding: '8px 16px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: '#1f2937',
  color: '#fff',
}

const mapOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.5)',
  zIndex: 19000,
  padding: '2vh 2vw',
  boxSizing: 'border-box',
  overflow: 'auto',
}

const mapModalStyle: React.CSSProperties = {
  background: '#fff',
  margin: '0 auto',
  padding: 16,
  width: '96vw',
  maxWidth: '1700px',
  height: '92vh',
  borderRadius: 18,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.45)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '2vh 12px',
  overflowY: 'auto',
  boxSizing: 'border-box',
  zIndex: 20000,
}

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '1100px',
  maxHeight: '90vh',
  overflow: 'auto',
  background: '#fff',
  borderRadius: '18px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
}

const modalHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  background: '#fff',
  borderBottom: '1px solid #ddd',
  padding: '18px 24px',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
}

const preStyle: React.CSSProperties = {
  background: '#f7f7f7',
  padding: '10px',
  borderRadius: '8px',
  overflow: 'auto',
  fontSize: '12px',
  maxWidth: '700px',
}

const clientModalStyle: React.CSSProperties = {
  width: '96vw',
  maxWidth: '1680px',
  maxHeight: '94vh',
  overflow: 'auto',
  background: '#ffffff',
  borderRadius: '22px',
  boxShadow: '0 18px 50px rgba(0,0,0,0.28)',
}

const clientModalHeaderStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 5,
  background: '#fff',
  borderBottom: '1px solid #d9d9d9',
  padding: '18px 24px',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '16px',
}

const clientModalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '20px',
  fontWeight: 800,
  lineHeight: 1.2,
}

const clientModalSubtitleStyle: React.CSSProperties = {
  marginTop: '8px',
  fontSize: '14px',
  color: '#374151',
  fontWeight: 600,
}

const clientHeaderBadgesWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: '10px',
}

const headerBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '38px',
  padding: '0 14px',
  borderRadius: '999px',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 800,
}

const clientModalBodyStyle: React.CSSProperties = {
  padding: '24px',
}

const clientBlocksGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '18px',
  alignItems: 'start',
}

const clientBlockStyle: React.CSSProperties = {
  background: '#f3f4f6',
  borderRadius: '18px',
  overflow: 'hidden',
  minHeight: '250px',
  border: '1px solid #e5e7eb',
}

const clientBlockTitleStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '14px',
  fontWeight: 800,
  color: '#111827',
  background: '#e5e7eb',
  borderBottom: '1px solid #d1d5db',
}

const clientBlockContentStyle: React.CSSProperties = {
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  fontSize: '14px',
  lineHeight: 1.45,
  color: '#111827',
}

const inlineBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '44px',
  padding: '4px 10px',
  borderRadius: '999px',
  color: '#fff',
  fontWeight: 700,
  fontSize: '12px',
}

const importBlocksGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '20px',
  alignItems: 'start',
}

const importCardStyle: React.CSSProperties = {
  background: '#f8f9fb',
  border: '1px solid #d6d9de',
  borderRadius: '16px',
  padding: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  minHeight: '100%',
}

const importCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const importCardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 800,
}

const importCardSubtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#4b5563',
}

const importFormGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '14px 16px',
}

const formFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: '#111827',
}

const fieldHintStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
}

const importActionsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
}

const fileInputStyle: React.CSSProperties = {
  fontSize: '14px',
  padding: '6px',
  cursor: 'pointer',
}
