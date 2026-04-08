'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'
import dynamic from 'next/dynamic'

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
}

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
  cegeclimBySiret: Map<string, string>
): string {
  const normalizedSiret = normalizeSiret(row.siret)
  if (normalizedSiret && cegeclimBySiret.has(normalizedSiret)) {
    return cegeclimBySiret.get(normalizedSiret) || 'NON'
  }
  return getCegeclimPresenceValue(row.present_dans_cegeclim)
}

function isClientPresentInCegeclim(
  row: Pick<ClientRow, 'siret' | 'present_dans_cegeclim'>,
  cegeclimBySiret: Map<string, string>
): boolean {
  return getClientCegeclimCode(row, cegeclimBySiret) !== 'NON'
}


function getClientCegeclimRow(
  row: Pick<ClientRow, 'siret'> | null | undefined,
  cegeclimDetailsBySiret: Map<string, ClientCegeclimRow>
): ClientCegeclimRow | null {
  const normalizedSiret = normalizeSiret(row?.siret)
  if (!normalizedSiret) return null
  return cegeclimDetailsBySiret.get(normalizedSiret) || null
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
      .from('vw_clients_map')
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
        prospect_comment
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
      prospect_comment
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
        'siret, numero_client_sage, designation_commerciale, representant, date_creation, agence, cp_sage, ville_sage, remarque'
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
      prospect_comment
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
  
  function openPreviousClient() {
  if (!previousClient) return
  setSelectedClient(previousClient)
}

function openNextClient() {
  if (!nextClient) return
  setSelectedClient(nextClient)
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

  const [includeNoDistance, setIncludeNoDistance] = useState(true)
  const [onlyContactable, setOnlyContactable] = useState(false)
  const [onlyNotInCegeclim, setOnlyNotInCegeclim] = useState(false)
  const [onlyPresentInCegeclim, setOnlyPresentInCegeclim] = useState(false)
  const [excludeDesignationND, setExcludeDesignationND] = useState(true)
  const [excludeFutureCreation, setExcludeFutureCreation] = useState(true)
  const [onlyToEnrich, setOnlyToEnrich] = useState(false)

  const [distanceMax, setDistanceMax] = useState(200)

  const [ageSliderMin, setAgeSliderMin] = useState(0)
  const [ageSliderMax, setAgeSliderMax] = useState(daysToSlider(365 * 50))

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
  setShowMapCegeclim(true)
  setShowMapProspects(true)
  setMapInstanceKey((prev) => prev + 1)

  setMapTitle(
    departement
      ? `Carte - ${secteur} - Département ${departement}`
      : secteur === 'TOUS'
        ? 'Carte - Tous secteurs'
        : `Carte - ${secteur} - Global`
  )

  try {
    let rows = scopedClients.map(ensureClientCoordinates)

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

  const scopedClientsCegeclim = useMemo(() => {
    return clientsCegeclim
  }, [clientsCegeclim])

  const cegeclimBySiret = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of clientsCegeclim) {
      const siret = normalizeSiret(row.siret)
      if (!siret) continue
      const numeroClientSage = String(row.numero_client_sage || '').trim()
      map.set(siret, numeroClientSage || 'OUI')
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
  const days = diffDaysFromToday(row.dateCreationEtablissement)
  const minDays = Math.min(sliderToDays(ageSliderMin), sliderToDays(ageSliderMax))
  const maxDays = Math.max(sliderToDays(ageSliderMin), sliderToDays(ageSliderMax))

  if (!matchesMapCommonFilters(row)) return false

  if (days !== null) {
    if (days < minDays || days > maxDays) return false
  }

  return true
}

const mapCegeclimPoints = useMemo(() => {
  return mapClientsWithCoords.filter(
    (client) =>
      isClientPresentInCegeclim(client, cegeclimBySiret) &&
      matchesMapCommonFilters(client)
  )
}, [
  mapClientsWithCoords,
  cegeclimBySiret,
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
  agences,
])

const mapProspectPoints = useMemo(() => {
  return mapClientsWithCoords.filter(
    (client) =>
      !isClientPresentInCegeclim(client, cegeclimBySiret) &&
      matchesMapProspectFilters(client)
  )
}, [
  mapClientsWithCoords,
  cegeclimBySiret,
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

const visibleMapPoints = useMemo(() => {
  return [
    ...(showMapCegeclim ? mapCegeclimPoints : []),
    ...(showMapProspects ? mapProspectPoints : []),
  ].filter((client) => mapSectorVisibility[getClientSectorLabel(client)] !== false)
}, [showMapCegeclim, showMapProspects, mapCegeclimPoints, mapProspectPoints, mapSectorVisibility])

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
      if (!siret) continue
      map.set(siret, row)
    }
    return map
  }, [clientsCegeclim])

  const selectedClientCegeclim = useMemo(() => {
    return getClientCegeclimRow(selectedClient, cegeclimDetailsBySiret)
  }, [selectedClient, cegeclimDetailsBySiret])

  const scopedClientSiretSet = useMemo(
    () => new Set(scopedClients.map((row) => normalizeSiret(row.siret)).filter(Boolean)),
    [scopedClients]
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

    return scopedClients.filter((row) => {
      const sector = row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement)
      const department = getClientDepartment(row)
      const ageDays = diffDaysFromToday(row.dateCreationEtablissement)
      const completeness = getCompletenessPercent(row)
      const isPresentInCegeclim = isClientPresentInCegeclim(row, cegeclimBySiret)

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
      if (excludeFutureCreation && isFutureDate(row.dateCreationEtablissement)) return false
      if (onlyContactable && !(row.telephone || row.email || row.contactable)) return false
      if (onlyNotInCegeclim && isPresentInCegeclim) return false
      if (onlyPresentInCegeclim && !isPresentInCegeclim) return false
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
    scopedClients,
    search,
    designationSearch,
    selectedDepartments,
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
    cegeclimBySiret,
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
        let total = 0

        summaryDepartments.forEach((dep) => {
          const count = sortedFilteredClients.filter((r) => {
            const d = getClientDepartment(r)
            const s = r.naf_libelle_traduit || translateNaf(r.activitePrincipaleEtablissement)
            return d === dep && s === sector
          }).length
          byDept[dep] = count
          total += count
        })

        return { sector, total, byDept }
      })
      .sort((a, b) => b.total - a.total)
  }, [sortedFilteredClients, summaryDepartments])

  const summaryDeptTotals = useMemo(() => {
    const out: Record<string, number> = {}
    summaryDepartments.forEach((dep) => {
      out[dep] = sortedFilteredClients.filter((r) => getClientDepartment(r) === dep).length
    })
    return out
  }, [sortedFilteredClients, summaryDepartments])

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

        return {
          designation: row.raison_sociale_affichee || 'ND',
          siret: row.siret || 'ND',
          presentCegeclim: getClientCegeclimCode(row, cegeclimBySiret),
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
        }
      })
  }

  function exportExcel() {
    const exportRows = buildExportRows()
    const aoa: (string | number)[][] = [
      ['Identité', '', '', '', '', '', 'Localisation', '', '', '', '', '', 'Contact', '', '', '', '', ''],
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
      ]),
    ]

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!merges'] = [
      XLSX.utils.decode_range('A1:F1'),
      XLSX.utils.decode_range('G1:L1'),
      XLSX.utils.decode_range('M1:R1'),
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
    ]
    ws['!autofilter'] = { ref: 'A2:R2' }
    ws['!freeze'] = { xSplit: 0, ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' }
    ws['!rows'] = aoa.map((_, index) => ({ hpt: index < 2 ? 22 : 18 }))
    ws['!pageMargins'] = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
    ws['!pageSetup'] = {
      orientation: 'landscape',
      paperSize: 9,
      fitToWidth: 1,
      fitToHeight: 0,
      scale: 53,
    }

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:R2')
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
          s: { font: { color: { rgb: '0563C1' }, underline: true } },
        }
      }

      if (siteUrl) {
        ws[siteCellRef] = {
          t: 's',
          v: siteUrl,
          l: { Target: siteUrl, Tooltip: 'Ouvrir le site web' },
          s: { font: { color: { rgb: '0563C1' }, underline: true } },
        }
      }
    }

    const departmentBreaks: number[] = []
    let previousDepartment = ''
    exportRows.forEach((row, index) => {
      const currentRowNumber = index + 3
      if (index > 0 && row.departement !== previousDepartment) departmentBreaks.push(currentRowNumber - 1)
      previousDepartment = row.departement
    })
    if (departmentBreaks.length > 0) {
      ;(ws as any)['!rowBreaks'] = departmentBreaks.map((id) => ({ id, man: 1 }))
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Liste entreprises')
    if (!wb.Workbook) wb.Workbook = { Names: [] }
    if (!wb.Workbook.Names) wb.Workbook.Names = []
    wb.Workbook.Names.push({ Sheet: 0, Name: '_xlnm.Print_Titles', Ref: "'Liste entreprises'!$1:$2" })
    wb.Workbook.Names.push({ Sheet: 0, Name: '_xlnm.Print_Area', Ref: `'Liste entreprises'!$A$1:$R$${exportRows.length + 2}` })

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
      else data.cell.styles.fillColor = [180, 198, 231]

      data.cell.styles.textColor = 0
      data.cell.styles.halign = 'center'
      data.cell.styles.fontStyle = 'bold'

      if (data.column.index === 0) data.cell.colSpan = 6
      if (data.column.index === 6) data.cell.colSpan = 6
      if (data.column.index === 12) data.cell.colSpan = 6

      if (![0, 6, 12].includes(data.column.index)) {
        data.cell.text = ['']
      }
    }

    if (data.row.index === 1) {
      if (data.column.index <= 5) data.cell.styles.fillColor = [217, 217, 217]
      else if (data.column.index <= 11) data.cell.styles.fillColor = [191, 222, 185]
      else data.cell.styles.fillColor = [180, 198, 231]

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

  function handlePrint() {
    window.print()
  }

  const totalClientsBaseForScope =
    normalizedSocieteFilter === 'global' ? clientsTotalCount : scopedClients.length

  const totalCegeclimBase = scopedClientsCegeclim.length

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
          <h1 style={pageTitleStyle}>Clients</h1>
        </section>

        {allowedDepartements.length > 0 && (
          <div style={{ fontSize: 13, color: '#334155', marginTop: -6 }}>
            Départements visibles selon votre profil : {allowedDepartements.join(', ')}
            {currentUserEmail ? ` • ${currentUserEmail}` : ''}
          </div>
        )}

        <section style={topToggleGridStyle}>
          <button
            type="button"
            onClick={() => setShowClientsSection((v) => !v)}
            style={showClientsSection ? sectionToggleActiveStyle : sectionToggleStyle}
          >
            <span>Clients</span>
            <span>{showClientsSection ? 'Réduire' : 'Développer'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowImportsSection((v) => !v)}
            style={showImportsSection ? sectionToggleActiveStyle : sectionToggleStyle}
          >
            <span>Imports</span>
            <span>{showImportsSection ? 'Réduire' : 'Développer'}</span>
          </button>
        </section>

        {showClientsSection && (
          <>
            {backgroundHydratingClients && (
              <div style={{ marginBottom: 12, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', borderRadius: 12, fontSize: 14 }}>
                Chargement rapide effectué. La liste complète continue à se charger en arrière-plan…
              </div>
            )}
            <section style={sectionCardStyle}>
              <div style={sectionHeaderRowStyle}>
                <h2 style={sectionBlockTitleStyle}>Section Clients</h2>
                <button
                  type="button"
                  onClick={() => setShowClientsSection(false)}
                  style={toolbarButtonStyle}
                >
                  Réduire
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={kpiGridStyle}>
                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Entreprises base Clients</div>
                    <div style={kpiValueStyle}>{totalClientsBaseForScope}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Entreprise base CEGECLIM</div>
                    <div style={kpiValueStyle}>{totalCegeclimBase}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Clients CEGECLIM absent base Clients</div>
                    <div style={kpiValueStyle}>{scopedCegeclimMissingInClients.length}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={captionRowStyle}>
                  <div style={groupCaptionStyle}>
                    Données relatives à la sélection
                    {normalizedSocieteFilter !== 'global' ? ` • périmètre ${societeFilter}` : ''}
                  </div>
                </div>
                <div style={kpiGridStyle}>
                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Nombre entreprise sélectionnées</div>
                    <div style={kpiValueStyle}>{totalSelection}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Nb départements sélectionnés</div>
                    <div style={kpiValueStyle}>{totalSelectedDepartments}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Nb de code APE différent</div>
                    <div style={kpiValueStyle}>{totalSelectedNaf}</div>
                  </div>
                </div>
              </div>


              <section style={sectionTitleStyle}>
                <h2 style={sectionTitleTextStyle}>Filtres</h2>
              </section>

              <section style={filtersGridStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={filterRowStyle}>
                    <div style={filterLabelCellStyle}>Recherche</div>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Raison sociale, SIRET, dirigeant..."
                      style={inputStyle}
                    />
                  </div>

                  <div style={filterRowStyle}>
                    <div style={filterLabelCellStyle}>Désignation</div>
                    <input
                      value={designationSearch}
                      onChange={(e) => setDesignationSearch(e.target.value)}
                      placeholder="Filtrer la désignation"
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ marginLeft: 192, maxWidth: '320px' }}>
                    <MultiSelectHorizontal
                      label="Departement(s)"
                      options={departmentOptions}
                      selected={selectedDepartments}
                      onChange={setSelectedDepartments}
                    />
                  </div>

                  <div style={{ marginLeft: 192, maxWidth: '320px' }}>
                    <MultiSelectHorizontal
                      label="Secteur d'activité(s)"
                      options={sectorOptions}
                      selected={selectedSectors}
                      onChange={setSelectedSectors}
                    />
                  </div>

                  <div style={{ marginLeft: 192, maxWidth: '320px' }}>
                    <MultiSelectHorizontal
                      label="Code NAF(s)"
                      options={nafOptions}
                      selected={selectedNafCodes}
                      onChange={setSelectedNafCodes}
                    />
                  </div>

                  <div style={filterRowStyle}>
                    <div style={filterLabelCellStyle}>Agence (choix unique)</div>
                    <select
                      value={selectedAgence}
                      onChange={(e) => setSelectedAgence(e.target.value)}
                      style={selectLikeStyle}
                    >
                      <option value="TOUS">TOUS</option>
                      {agenceOptions.map((agence) => (
                        <option key={agence} value={agence}>
                          {agence}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={filterRowStyle}>
                    <div style={filterLabelCellStyle}>Distance max (actif si agence)</div>
                    <div style={distanceRowStyle}>
                      <input
                        type="range"
                        min={1}
                        max={200}
                        step={1}
                        value={distanceMax}
                        onChange={(e) => setDistanceMax(Number(e.target.value))}
                      />
                      <div style={distanceBoxStyle}>{distanceMax} Km</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={includeNoDistance}
                      onChange={(e) => setIncludeNoDistance(e.target.checked)}
                      style={checkboxStyle}
                    />
                    Inclure les lignes sans distance calculée
                  </label>

                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={onlyContactable}
                      onChange={(e) => setOnlyContactable(e.target.checked)}
                      style={checkboxStyle}
                    />
                    Seulement entreprises contactables
                  </label>

                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={onlyNotInCegeclim}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setOnlyNotInCegeclim(checked)
                        if (checked) setOnlyPresentInCegeclim(false)
                      }}
                      style={checkboxStyle}
                    />
                    Seulement non présents dans base clients Cegeclim
                  </label>

                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={onlyPresentInCegeclim}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setOnlyPresentInCegeclim(checked)
                        if (checked) setOnlyNotInCegeclim(false)
                      }}
                      style={checkboxStyle}
                    />
                    Uniquement les clients présents dans la base Cegeclim
                  </label>

                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={onlyToEnrich}
                      onChange={(e) => setOnlyToEnrich(e.target.checked)}
                      style={checkboxStyle}
                    />
                    Seulement fiches à enrichir
                  </label>

                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={excludeDesignationND}
                      onChange={(e) => setExcludeDesignationND(e.target.checked)}
                      style={checkboxStyle}
                    />
                    Exclure désignation commerciale "ND"
                  </label>

                  <label style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={excludeFutureCreation}
                      onChange={(e) => setExcludeFutureCreation(e.target.checked)}
                      style={checkboxStyle}
                    />
                    Exclure date de création dans le futur
                  </label>

                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 14 }}>Jauge non linéaire (très précise proche d'aujourd'hui)</div>

                    <div style={ageRowStyle}>
                      <div style={ageLabelStyle}>Ancienneté min</div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={ageSliderMin}
                        onChange={(e) => setAgeSliderMin(Number(e.target.value))}
                      />
                    </div>
                    <div style={{ fontSize: 14 }}>{formatAgePrecise(ageDaysMin)}</div>

                    <div style={ageRowStyle}>
                      <div style={ageLabelStyle}>Ancienneté max</div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={ageSliderMax}
                        onChange={(e) => setAgeSliderMax(Number(e.target.value))}
                      />
                    </div>
                    <div style={{ fontSize: 14 }}>{formatAgePrecise(ageDaysMax)}</div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[
                        { label: '≤ 2 semaines', days: 14 },
                        { label: '≤ 4 semaines', days: 28 },
                        { label: '≤ 3 mois', days: 90 },
                        { label: '≤ 12 mois', days: 365 },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setAgeSliderMin(daysToSlider(0))
                            setAgeSliderMax(daysToSlider(item.days))
                          }}
                          style={miniButtonStyle}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section style={sectionTitleStyle}>
                <h2 style={sectionTitleTextStyle}>Synthèse de la sélection (cliquer sur une case pour ouvrir la carte)</h2>
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
                                {row.total}
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
                              {row.byDept[dep] || 0}
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
                            {sortedFilteredClients.length}
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
                                {summaryDeptTotals[dep] || 0}
                              </button>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </section>


                  <section style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <button onClick={exportExcel} style={toolbarButtonStyle}>Export Excel</button>
                    <button onClick={exportPdf} style={toolbarButtonStyle}>Créer PDF</button>
                    <button onClick={handlePrint} style={toolbarButtonStyle}>Imprimer</button>
                    <button
                      onClick={() => void enrichBatch(enrichableSelection)}
                      style={primaryButtonStyle}
                      disabled={batchEnriching || enrichableSelection.length === 0}
                    >
                      {batchEnriching
                        ? 'Enrichissement Google en cours...'
                        : `Enrichir via Google (${Math.min(enrichableSelection.length, MAX_BATCH_ENRICH)})`}
                    </button>
                    <button onClick={() => setShowRejects(true)} style={toolbarButtonStyle}>
                      Voir les rejets ({rejects.length})
                    </button>
                  </section>

                  <section style={sectionTitleStyle}>
                    <div>
                      <h2 style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, fontWeight: 600 }}>
                  <span>Liste des entreprises</span>

                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555' }}>
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
                      <span>Clients CEGECLIM</span>
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
                          <th onClick={() => toggleSort('completeness')} style={{ ...listHeaderStyle, width: 95 }}>
                            Complétude<SortIndicator active={sortKey === 'completeness'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('enrichment')} style={{ ...listHeaderStyle, width: 105 }}>
                            Enrichissement<SortIndicator active={sortKey === 'enrichment'} direction={sortDirection} />
                          </th>
                          <th onClick={() => toggleSort('distance')} style={{ ...listHeaderStyle, width: 95 }}>
                            Distance<SortIndicator active={sortKey === 'distance'} direction={sortDirection} />
                          </th>
                          <th style={{ ...listHeaderStyle, width: 120 }}>Action</th>
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
                          const completeness = getCompletenessPercent(row)
      const isPresentInCegeclim = isClientPresentInCegeclim(row, cegeclimBySiret)
                          const completenessColor = getCompletenessColor(completeness)
                          const enrichBadge = getEnrichmentBadge(row.enrichment_status)
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
        title="Client présent dans CEGECLIM"
        style={{
          color: '#facc15',
          fontSize: 14,
          lineHeight: 1,
          textShadow: '0 0 1px #a16207',
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
                                <span style={{ ...pillStyle, background: completenessColor }}>
                                  {completeness}%
                                </span>
                              </td>
                              <td style={listCellStyle}>
                                <span style={{ ...pillStyle, background: enrichBadge.bg, color: enrichBadge.color }}>
                                  {enrichBadge.label}
                                </span>
                              </td>
                              <td style={listCellStyle}>
                                {selectedAgenceRow ? (distance != null ? `${distance} km` : '—') : 'Choisir agence'}
                              </td>
                              <td style={listCellStyle}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                                </div>
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

              <section style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setMode('clients')}
                  style={mode === 'clients' ? activeTabStyle : tabStyle}
                >
                  Clients
                </button>
                <button
                  onClick={() => setMode('cegeclim_absents')}
                  style={mode === 'cegeclim_absents' ? activeTabStyle : tabStyle}
                >
                  Ecart CEGECLIM
                </button>
              </section>
            </section>
            {mapOpen && (
  <div style={mapOverlayStyle}>
    <div style={mapModalStyle}>
      <h2 style={{ margin: 0 }}>{mapTitle}</h2>

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
  ) : visibleMapPoints.length === 0 ? (
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
    <>
      <div
        style={{
          display: 'flex',
          gap: 18,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '0 2px',
          fontSize: 14,
          color: '#334155',
        }}
      >
  <div>
    <strong>{visibleMapPoints.length}</strong> entreprises visibles
  </div>

  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
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

  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
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

  {mapLegendSectors.map((sector) => (
    <label
      key={sector}
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
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

      <div
        style={{
          flex: 1,
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
  const isCegeclim = isClientPresentInCegeclim(client, cegeclimBySiret)
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
          <div>Création : {formatDateFr(client.dateCreationEtablissement)}</div>
          <div>Tél : {client.telephone || '—'}</div>
        </div>
      </Tooltip>
    </CircleMarker>
  )
})}
        </MapContainer>
      </div>
    </>
  )}
</div>

      <button onClick={() => setMapOpen(false)}>Fermer</button>
    </div>
  </div>
)}
          </>
        )}

        {showImportsSection && (
          <section style={sectionCardStyle}>
            <div style={sectionHeaderRowStyle}>
              <h2 style={sectionBlockTitleStyle}>Section Imports</h2>
              <button
                type="button"
                onClick={() => setShowImportsSection(false)}
                style={toolbarButtonStyle}
              >
                Réduire
              </button>
            </div>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={captionRowStyle}>
                <div style={groupCaptionStyle}>Données relatives à la dernière importation du fichier</div>
              </div>
              <div style={kpiGridStyle}>
                <div style={kpiCardStyle}>
                  <div style={kpiTitleStyle}>Date dernier import</div>
                  <div style={kpiValueStyle}>
                    {lastImport?.date_import
                      ? new Date(lastImport.date_import).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                        })
                      : 'NC'}
                  </div>
                </div>

                <div style={kpiCardStyle}>
                  <div style={kpiTitleStyle}>Nb enreg. insérées dernier import</div>
                  <div style={kpiValueStyle}>{lastImport?.nb_importees || 0}</div>
                </div>

                <div style={kpiCardStyle}>
                  <div style={kpiTitleStyle}>Nb enreg. rejetées dernier import</div>
                  <div style={kpiValueStyle}>{lastImport?.nb_rejets || 0}</div>
                </div>
              </div>
            </section>

            <section style={importBlocksGridStyle}>
              <div style={importCardStyle}>
                <div style={importCardHeaderStyle}>
                  <h3 style={importCardTitleStyle}>Import automatique via API Sirene</h3>
                  <div style={importCardSubtitleStyle}>
                    Prépare les paramètres à stocker en base avant de brancher l’API.
                  </div>
                </div>

                <div style={importFormGridStyle}>
                  


                  <div style={formFieldStyle}>
                    <label style={fieldLabelStyle}>Date création min</label>
                    <input
                      type="date"
                      value={sireneParams.dateCreationMin}
                      onChange={(e) =>
                        setSireneParams((prev) => ({ ...prev, dateCreationMin: e.target.value }))
                      }
                      style={inputStyleFull}
                    />
                  </div>

                  <div style={formFieldStyle}>
                    <label style={fieldLabelStyle}>Date création max</label>
                    <input
                      type="date"
                      value={sireneParams.dateCreationMax}
                      onChange={(e) =>
                        setSireneParams((prev) => ({ ...prev, dateCreationMax: e.target.value }))
                      }
                      style={inputStyleFull}
                    />
                  </div>

                  <div style={formFieldStyle}>
                    <label style={fieldLabelStyle}>Date modification min</label>
                    <input
                      type="date"
                      value={sireneParams.dateMajMin}
                      onChange={(e) =>
                        setSireneParams((prev) => ({ ...prev, dateMajMin: e.target.value }))
                      }
                      style={inputStyleFull}
                    />
                  </div>

                  <div style={formFieldStyle}>
                    <label style={fieldLabelStyle}>Date modification max</label>
                    <input
                      type="date"
                      value={sireneParams.dateMajMax}
                      onChange={(e) =>
                        setSireneParams((prev) => ({ ...prev, dateMajMax: e.target.value }))
                      }
                      style={inputStyleFull}
                    />
                  </div>

                  <div style={formFieldStyle}>
                    <label style={fieldLabelStyle}>Codes APE</label>
                    <input
                      value={sireneParams.codesApe}
                      onChange={(e) =>
                        setSireneParams((prev) => ({ ...prev, codesApe: e.target.value }))
                      }
                      placeholder="4322A, 4321A, 4120A"
                      style={inputStyleFull}
                    />
                    <div style={fieldHintStyle}>Valeurs séparées par des virgules.</div>
                  </div>

                </div>

                <div style={importActionsRowStyle}>
                  <button
                    type="button"
                    onClick={() => void saveSireneParams()}
                    style={primaryButtonStyle}
                    disabled={savingSireneParams}
                  >
                    {savingSireneParams ? 'Enregistrement...' : 'Enregistrer les paramètres'}
                  </button>

                  <button
                    type="button"
                    style={toolbarButtonStyle}
                    onClick={launchImportSirene}
                  >
                    Lancer import API
                  </button>
                </div>
              </div>

              <div style={importCardStyle}>
                <div style={importCardHeaderStyle}>
                  <h3 style={importCardTitleStyle}>Import manuel via CSV</h3>
                  <div style={importCardSubtitleStyle}>
                    Conserve le fonctionnement actuel pour alimenter la table clients.
                  </div>
                </div>

                <label style={uploadWrapStyle}>
                  <span>Importer un CSV Entreprise France</span>

                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={importing}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleImportCsv(file)
                      e.currentTarget.value = ''
                    }}
                    style={{ display: 'none' }}
                    id="file-upload"
                  />

                  <label htmlFor="file-upload" style={primaryButtonStyle}>
                    {importing ? 'Import...' : 'Choisir un fichier'}
                  </label>
                </label>

                <p style={{ margin: 0 }}>
                  <a
                    href="https://annuaire-entreprises.data.gouv.fr/export-sirene"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://annuaire-entreprises.data.gouv.fr/export-sirene
                  </a>
                </p>

                {importStats && (
                  <div style={{ marginTop: 8, fontSize: 11 }}>
                    Import terminé • {importStats.total} lignes lues • {importStats.inserted} insertions •{' '}
                    {importStats.updated} mises à jour • {importStats.rejected} rejets
                  </div>
                )}
              </div>
            </section>
          </section>
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

                  <span
                    style={{
                      ...headerBadgeStyle,
                      background: getCompletenessColor(getCompletenessPercent(selectedClient)),
                    }}
                  >
                    Complétude : {getCompletenessPercent(selectedClient)}%
                  </span>

                  <span
                    style={{
                      ...headerBadgeStyle,
                      background: getEnrichmentBadge(selectedClient.enrichment_status).bg,
                      color: '#fff',
                    }}
                  >
                    {getEnrichmentBadge(selectedClient.enrichment_status).label}
                  </span>

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
                      <div><b>Raison sociale :</b> {selectedClient.raison_sociale_affichee || 'NC'}</div>
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
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
          
                    <div
  style={{
    ...clientBlockTitleStyle,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  }}
>
  <span>Localisation</span>

  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '6px 12px',
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
                    <div style={clientBlockTitleStyle}>Données SIRENE</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Effectifs SIRENE :</b> {selectedClient.trancheEffectifsEtablissement || 'NC'}</div>
                      <div><b>Effectif estimé :</b> {selectedClient.effectif_estime ?? 'NC'}</div>
                      <div><b>Présent base CEGECLIM :</b> {isClientPresentInCegeclim(selectedClient, cegeclimBySiret) ? getClientCegeclimCode(selectedClient, cegeclimBySiret) : 'NON'}</div>
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
                      <div><b>AGENCE :</b> {selectedClientCegeclim?.agence || 'NC'}</div>
                      <div><b>CP SAGE :</b> {selectedClientCegeclim?.cp_sage || 'NC'}</div>
                      <div><b>VILLE SAGE :</b> {selectedClientCegeclim?.ville_sage || 'NC'}</div>
                      <div><b>Remarque :</b> {selectedClientCegeclim?.remarque || 'NC'}</div>
                    </div>
                  </div>
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
