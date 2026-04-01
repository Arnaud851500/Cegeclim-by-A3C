'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'

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
  present_dans_cegeclim: boolean | null
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
  | 'score'
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

function getCompletenessPercent(row: ClientRow): number {
  const checks = [
    Boolean(row.telephone),
    Boolean(row.email),
    Boolean(row.site_web),
    Boolean(row.nom_dirigeant),
    row.effectif_estime != null || Boolean(row.trancheEffectifsEtablissement),
    row.ca_estime != null || row.pappers_ca != null,
    row.rge != null,
    row.potentiel_score != null,
  ]
  const filled = checks.filter(Boolean).length
  return Math.round((filled / checks.length) * 100)
}

function getScoreColor(score: number | null | undefined): string {
  if (score == null) return '#9ca3af'
  if (score >= 80) return '#15803d'
  if (score >= 60) return '#65a30d'
  if (score >= 40) return '#d97706'
  return '#b91c1c'
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
  const [agences, setAgences] = useState<AgenceRow[]>([])
  const [territories, setTerritories] = useState<TerritoryRow[]>([])
  const [lastImport, setLastImport] = useState<ImportRow | null>(null)
  const [rejects, setRejects] = useState<RejectRow[]>([])
  const [sireneConfigId, setSireneConfigId] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [allowedDepartements, setAllowedDepartements] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

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
  const [excludeDesignationND, setExcludeDesignationND] = useState(true)
  const [excludeFutureCreation, setExcludeFutureCreation] = useState(true)
  const [onlyToEnrich, setOnlyToEnrich] = useState(false)

  const [distanceMax, setDistanceMax] = useState(200)

  const [ageSliderMin, setAgeSliderMin] = useState(0)
  const [ageSliderMax, setAgeSliderMax] = useState(daysToSlider(365 * 13))

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
      const authPromise = supabase.auth.getUser()
      const clientsPromise = fetchClientsInitialBatch()
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

      const [authRes, clientsRes, agencesRes, territoriesRes, importRes, sireneParamsRes] =
        await Promise.all([
          authPromise,
          clientsPromise,
          agencesPromise,
          territoriesPromise,
          importPromise,
          sireneParamsPromise,
        ])

      if (agencesRes.error) throw agencesRes.error
      if (territoriesRes.error) throw territoriesRes.error
      if (importRes.error) throw importRes.error
      if (sireneParamsRes.error) throw sireneParamsRes.error

      const userEmail = authRes.data.user?.email?.toLowerCase().trim() || null
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
    } catch (error) {
      console.error(error)
      alert("Erreur lors du chargement de l'écran Clients.")
    } finally {
      setLoading(false)
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
        `Enrichissement terminé.\n` +
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
      if (onlyNotInCegeclim && row.present_dans_cegeclim) return false
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
    excludeDesignationND,
    excludeFutureCreation,
    onlyToEnrich,
    ageDaysMin,
    ageDaysMax,
    distanceMax,
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
        case 'score':
          av = a.potentiel_score ?? -1
          bv = b.potentiel_score ?? -1
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

  function exportExcel() {
    const exportRows = sortedFilteredClients.map((row) => {
      const distance = selectedAgenceRow
        ? distanceKmLambert(
            row.coordonneeLambertAbscisseEtablissement,
            row.coordonneeLambertOrdonneeEtablissement,
            selectedAgenceRow.coord_x_lambert,
            selectedAgenceRow.coord_y_lambert
          )
        : null

      return {
        Désignation: row.raison_sociale_affichee || 'ND',
        Siret: row.siret || 'ND',
        Dépt: getClientDepartment(row) || 'ND',
        Ville: row.libelleCommuneEtablissement || 'ND',
        'Code postal': row.codePostalEtablissement || 'ND',
        'APE/NAF': row.activitePrincipaleEtablissement || 'ND',
        "Secteur d'activité":
          row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement),
        Création: formatDateFr(row.dateCreationEtablissement),
        Ancienneté: formatAgePrecise(diffDaysFromToday(row.dateCreationEtablissement)),
        Tel: row.telephone || '',
        Mail: row.email || '',
        Site: row.site_web || '',
        Dirigeant: row.nom_dirigeant || '',
        Score: row.potentiel_score ?? '',
        Complétude: `${getCompletenessPercent(row)} %`,
        Statut: row.enrichment_status || 'a_faire',
        Distance: distance != null ? `${distance} km` : '',
      }
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), 'Liste entreprises')
    XLSX.writeFile(wb, `clients_selection_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function exportPdf() {
    const doc = new jsPDF('l', 'mm', 'a4')

    autoTable(doc, {
      head: [[
        'Désignation',
        'Siret',
        'Dépt.',
        'Ville',
        'Code postal',
        'APE/NAF',
        "Secteur d'activité",
        'Création',
        'Ancienneté',
        'Score',
        'Complétude',
        'Distance',
      ]],
      body: sortedFilteredClients.map((row) => {
        const distance = selectedAgenceRow
          ? distanceKmLambert(
              row.coordonneeLambertAbscisseEtablissement,
              row.coordonneeLambertOrdonneeEtablissement,
              selectedAgenceRow.coord_x_lambert,
              selectedAgenceRow.coord_y_lambert
            )
          : null

        return [
          row.raison_sociale_affichee || 'ND',
          row.siret || 'ND',
          getClientDepartment(row) || 'ND',
          row.libelleCommuneEtablissement || 'ND',
          row.codePostalEtablissement || 'ND',
          row.activitePrincipaleEtablissement || 'ND',
          row.naf_libelle_traduit || translateNaf(row.activitePrincipaleEtablissement),
          formatDateFr(row.dateCreationEtablissement),
          formatAgePrecise(diffDaysFromToday(row.dateCreationEtablissement)),
          row.potentiel_score ?? 'NC',
          `${getCompletenessPercent(row)} %`,
          distance != null ? `${distance} km` : '',
        ]
      }),
      styles: { fontSize: 7 },
      theme: 'grid',
    })

    doc.save(`clients_selection_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  function handlePrint() {
    window.print()
  }

  const totalClientsBaseForScope =
    normalizedSocieteFilter === 'global' ? clientsTotalCount : scopedClients.length

  const totalCegeclimBase =
    scopedCegeclimAbsents.length + scopedClients.filter((x) => x.present_dans_cegeclim).length

  const totalSelection = sortedFilteredClients.length
  const totalSelectedDepartments = summaryDepartments.length
  const totalSelectedNaf = Array.from(
    new Set(sortedFilteredClients.map((r) => r.activitePrincipaleEtablissement).filter(Boolean))
  ).length

  const avgCompleteness =
    sortedFilteredClients.length === 0
      ? 0
      : Math.round(
          sortedFilteredClients.reduce((sum, row) => sum + getCompletenessPercent(row), 0) /
            sortedFilteredClients.length
        )

  const avgScore =
    sortedFilteredClients.length === 0
      ? 0
      : Math.round(
          sortedFilteredClients.reduce((sum, row) => sum + (row.potentiel_score || 0), 0) /
            sortedFilteredClients.length
        )

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
                    <div style={kpiValueStyle}>{scopedCegeclimAbsents.length}</div>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={captionRowStyle}>
                  <div style={groupCaptionStyle}>Prospection / enrichissement</div>
                </div>
                <div style={kpiGridStyle}>
                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Complétude moyenne</div>
                    <div style={kpiValueStyle}>{avgCompleteness}%</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Score potentiel moyen</div>
                    <div style={kpiValueStyle}>{avgScore}</div>
                  </div>

                  <div style={kpiCardStyle}>
                    <div style={kpiTitleStyle}>Fiches à enrichir</div>
                    <div style={kpiValueStyle}>{enrichableSelection.length}</div>
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
                      onChange={(e) => setOnlyNotInCegeclim(e.target.checked)}
                      style={checkboxStyle}
                    />
                    Seulement non présents dans base clients Cegeclim
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
                <h2 style={sectionTitleTextStyle}>Synthèse de la sélection</h2>
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
                            <td style={summaryBodyCellStyleBold}>{row.total}</td>
                            {summaryDepartments.map((dep) => (
                              <td key={dep} style={summaryBodyCellStyleBold}>
                                {row.byDept[dep] || 0}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr>
                          <td style={{ ...summaryTotalStyle, textAlign: 'left' }}>TOTAL</td>
                          <td style={summaryTotalStyle}>{sortedFilteredClients.length}</td>
                          {summaryDepartments.map((dep) => (
                            <td key={dep} style={summaryTotalStyle}>
                              {summaryDeptTotals[dep] || 0}
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
                        ? 'Enrichissement en cours...'
                        : `Enrichir la sélection (${Math.min(enrichableSelection.length, MAX_BATCH_ENRICH)})`}
                    </button>
                    <button onClick={() => setShowRejects(true)} style={toolbarButtonStyle}>
                      Voir les rejets ({rejects.length})
                    </button>
                  </section>

                  <section style={sectionTitleStyle}>
                    <div>
                      <h2 style={sectionTitleTextStyle}>Liste des entreprises</h2>
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
                          <th onClick={() => toggleSort('score')} style={{ ...listHeaderStyle, width: 75 }}>
                            Score<SortIndicator active={sortKey === 'score'} direction={sortDirection} />
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
                          const scoreBadgeColor = getScoreColor(row.potentiel_score)
                          const completenessColor = getCompletenessColor(completeness)
                          const enrichBadge = getEnrichmentBadge(row.enrichment_status)
                          const siret = row.siret || ''
                          const isEnriching = enrichingSirets.includes(siret)

                          return (
                            <tr
                              key={`${row.siret}-${row.id}` }
                              style={{ background: getSectorColor(sector), borderBottom: '1px solid #b3a4a4' }}
                            >
                              <td style={listCellStyle}>{row.raison_sociale_affichee || 'ND'}</td>
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
                                <span style={{ ...pillStyle, background: scoreBadgeColor }}>
                                  {row.potentiel_score ?? 'NC'}
                                </span>
                              </td>
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
                                  <button onClick={() => setSelectedClient(row)} style={linkButtonStyle}>
                                    Voir
                                  </button>
                                  <button
                                    onClick={() => void enrichClientBySiret(siret)}
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
                <div>
                  <h3 style={clientModalTitleStyle}>
                    {selectedClient.raison_sociale_affichee || 'Entreprise'}
                  </h3>
                  <div style={clientModalSubtitleStyle}>
                    SIRET : {selectedClient.siret || 'NC'}
                  </div>
                </div>

                <div style={clientHeaderBadgesWrapStyle}>
                  <span
                    style={{
                      ...headerBadgeStyle,
                      background: getScoreColor(selectedClient.potentiel_score),
                    }}
                  >
                    Score : {selectedClient.potentiel_score ?? 'NC'}
                  </span>

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
                    <div style={clientBlockTitleStyle}>Localisation</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Adresse :</b> {selectedClient.adresse_complete || 'NC'}</div>
                      <div><b>Ville :</b> {selectedClient.libelleCommuneEtablissement || 'NC'}</div>
                      <div><b>Code postal :</b> {selectedClient.codePostalEtablissement || 'NC'}</div>
                      <div><b>Département :</b> {getClientDepartment(selectedClient) || 'NC'}</div>
                      <div><b>Coordonnée X :</b> {selectedClient.coordonneeLambertAbscisseEtablissement ?? 'NC'}</div>
                      <div><b>Coordonnée Y :</b> {selectedClient.coordonneeLambertOrdonneeEtablissement ?? 'NC'}</div>
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
                    <div style={clientBlockTitleStyle}>Business / qualification</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Effectifs SIRENE :</b> {selectedClient.trancheEffectifsEtablissement || 'NC'}</div>
                      <div><b>Effectif estimé :</b> {selectedClient.effectif_estime ?? 'NC'}</div>
                      <div><b>CA estimé :</b> {formatCurrency(selectedClient.ca_estime ?? selectedClient.pappers_ca ?? null)}</div>
                      <div>
                        <b>RGE :</b>{' '}
                        {selectedClient.rge == null ? 'NC' : selectedClient.rge ? 'Oui' : 'Non'}
                      </div>
                      <div><b>Présent base CEGECLIM :</b> {selectedClient.present_dans_cegeclim ? 'Oui' : 'Non'}</div>
                      <div>
                        <b>Score potentiel :</b>{' '}
                        <span
                          style={{
                            ...inlineBadgeStyle,
                            background: getScoreColor(selectedClient.potentiel_score),
                          }}
                        >
                          {selectedClient.potentiel_score ?? 'NC'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Enrichissement API</div>
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
                      <div><b>Source :</b> {selectedClient.enrichment_source || 'NC'}</div>
                      <div><b>Erreur :</b> {selectedClient.enrichment_error || 'Aucune'}</div>
                      <div><b>Note Google :</b> {selectedClient.google_rating ?? 'NC'}</div>
                      <div><b>Nb avis Google :</b> {selectedClient.google_user_ratings_total ?? 'NC'}</div>
                    </div>
                  </div>

                  <div style={clientBlockStyle}>
                    <div style={clientBlockTitleStyle}>Suivi commercial</div>
                    <div style={clientBlockContentStyle}>
                      <div><b>Statut prospect :</b> {selectedClient.prospect_status || 'NC'}</div>
                      <div><b>Assigné à :</b> {selectedClient.assigned_to || 'NC'}</div>
                      <div><b>Dernier contact :</b> {formatDateTimeFr(selectedClient.last_contact_at)}</div>
                      <div><b>Prochaine action :</b> {selectedClient.next_action_label || 'NC'}</div>
                      <div><b>Date prochaine action :</b> {formatDateTimeFr(selectedClient.next_action_at)}</div>
                      <div><b>Commentaire :</b> {selectedClient.prospect_comment || 'NC'}</div>
                      <div><b>Dernier import :</b> {formatDateFr(selectedClient.date_import)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showRejects && (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalStyle, maxWidth: 1400 }}>
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
  background: '#f3f3f3',
  padding: '12px',
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '1480px',
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
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

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
  zIndex: 50,
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
  width: '100%',
  maxWidth: '1220px',
  maxHeight: '92vh',
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
