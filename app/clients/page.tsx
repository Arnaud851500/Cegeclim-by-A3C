'use client'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'

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

type RejectInsertRow = {
  import_id: string
  ligne_numero: number
  siret: string | null
  motif_rejet: string
  donnees_source_json: Record<string, unknown> | null
  created_at: string
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
  updated_at: string | null
}

type UserDepartmentAccessRow = {
  email: string
  allowed_departements: string[] | null
}

type TerritoryRow = {
  code_dep: string | null
  societe: string | null
}

type ClientCountRow = {
  siret: string | null
  codePostalEtablissement: string | null
  departement: string | null
}

type ClientCegeclimCountRow = {
  siret: string | null
  cp_sage: string | null
}

type SireneParamsForm = {
  codesApe: string
  departements: string
  dateCreationMin: string
  dateCreationMax: string
  dateMajMin: string
  dateMajMax: string
}

type ClientMaintenanceRunRow = {
  id: string
  source: string | null
  status: 'queued' | 'running' | 'done' | 'error' | 'partial' | 'cancelled'
  started_at: string | null
  finished_at: string | null
  current_step: string | null
  message: string | null
  error_message: string | null
  config_json: Record<string, any> | null
  result_json: Record<string, any> | null
  created_at: string | null
  updated_at: string | null
}

type ClientMaintenanceStepRow = {
  id: string
  run_id: string
  step_key: string
  step_label: string
  status: 'queued' | 'running' | 'done' | 'error' | 'skipped'
  started_at: string | null
  finished_at: string | null
  processed_count: number | null
  inserted_count: number | null
  updated_count: number | null
  rejected_count: number | null
  error_count: number | null
  result_json: Record<string, any> | null
  error_message: string | null
  sort_order: number | null
}

type ClientMaintenanceLogRow = {
  id: string
  run_id: string
  step_id: string | null
  level: 'info' | 'warning' | 'error'
  message: string
  payload_json: Record<string, any> | null
  created_at: string
}

type ClientMaintenanceStatusPayload = {
  success: boolean
  runs: ClientMaintenanceRunRow[]
  steps: ClientMaintenanceStepRow[]
  logs: ClientMaintenanceLogRow[]
}

type CsvRawRow = Record<string, unknown>

type ClientUpsertRow = {
  siret: string | null
  raison_sociale_affichee: string | null
  activitePrincipaleEtablissement: string | null
  naf_libelle_traduit: string | null
  dateCreationEtablissement: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  departement: string | null
  adresse_complete: string | null
  coordonneeLambertAbscisseEtablissement: number | null
  coordonneeLambertOrdonneeEtablissement: number | null
  trancheEffectifsEtablissement: string | null
  nom_dirigeant: string | null
  contactable: boolean | null
  enrichment_status: string | null
  date_import: string
  source_import: string
  telephone: string | null
  email: string | null
  site_web: string | null
  effectif_estime: number | null
  ca_estime: number | null
  pappers_ca: number | null
  pappers_resultat: number | null
  rge: boolean | null
  potentiel_score: number | null
  enrichment_source: string | null
  enrichment_error: string | null
  google_maps_url: string | null
  google_rating: number | null
  google_user_ratings_total: number | null
  present_dans_cegeclim: string | null
  prospect_status: string | null
  assigned_to: string | null
  last_contact_at: string | null
  next_action_at: string | null
  next_action_label: string | null
  prospect_comment: string | null
}

/** Compte rendu d'exécution : remplace les alert() à rallonge par un panneau lisible. */
type ReportLine = { label: string; value: string | number; emphasis?: boolean }
type RunReport = { title: string; subtitle?: string; tone: 'success' | 'error'; lines: ReportLine[] } | null
type ToastState = { tone: 'success' | 'error'; text: string } | null

const UPSERT_CHUNK_SIZE = 500
const IMPORT_TYPES = ['entreprise_france', 'api_sirene', 'api_sirene_cessation']
const SIRENE_EXPORT_URL = 'https://annuaire-entreprises.data.gouv.fr/export-sirene'

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

function normalizeScopeValue(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeArray(value: string | null | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMaybeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('/')
    return `${y}-${m}-${d}`
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return null
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

function buildAdresseComplete(row: CsvRawRow) {
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

function buildRaisonSociale(row: CsvRawRow) {
  return (
    firstNonEmpty(
      row.denominationUniteLegale,
      row.denominationUsuelleEtablissement,
      [row.nomUniteLegale, row.prenom1UniteLegale].filter(Boolean).join(' ')
    ) || null
  )
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
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

function formatDateFr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

function formatDateTimeFr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR')
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('fr-FR').format(Number(value))
}

function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '—'
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : new Date()
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '—'
  const seconds = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function getMaintenanceStatusLabel(
  status: ClientMaintenanceRunRow['status'] | ClientMaintenanceStepRow['status'] | null | undefined
): string {
  if (status === 'queued') return 'En attente'
  if (status === 'running') return 'En cours'
  if (status === 'done') return 'Terminé'
  if (status === 'partial') return 'Partiel'
  if (status === 'error') return 'Erreur'
  if (status === 'skipped') return 'Ignoré'
  if (status === 'cancelled') return 'Annulé'
  return '—'
}

/** Un statut = une couleur, la même partout : pastille, rail et tableau. */
function getStatusClasses(status: string | null | undefined): string {
  if (status === 'done') return 'bg-[#E7F1EA] text-[#1F5B44] ring-1 ring-[#BFDCCE]'
  if (status === 'running') return 'bg-[#FDF2DE] text-[#8A5A11] ring-1 ring-[#EBD8AE]'
  if (status === 'queued') return 'bg-[#F1EFEA] text-[#6B6355] ring-1 ring-[#DFDACF]'
  if (status === 'partial') return 'bg-[#FBEEE2] text-[#964E10] ring-1 ring-[#EFCFAF]'
  if (status === 'error') return 'bg-[#FBE9E9] text-[#A32C2C] ring-1 ring-[#F0C7C7]'
  if (status === 'skipped') return 'bg-[#F1EFEA] text-[#8A8375] ring-1 ring-[#DFDACF]'
  if (status === 'cancelled') return 'bg-[#F1EFEA] text-[#6B6355] ring-1 ring-[#DFDACF]'
  return 'bg-[#F1EFEA] text-[#6B6355] ring-1 ring-[#DFDACF]'
}

function getStatusDotClass(status: string | null | undefined): string {
  if (status === 'done') return 'bg-[#2F6B4F]'
  if (status === 'running') return 'bg-[#B4761A]'
  if (status === 'partial') return 'bg-[#C2701C]'
  if (status === 'error') return 'bg-[#A32C2C]'
  if (status === 'queued') return 'bg-[#CBC5B8]'
  return 'bg-[#CBC5B8]'
}

function buildDefaultSireneParams(lastImport: ImportRow | null): SireneParamsForm {
  const defaultMin = lastImport?.date_import ? formatDateInput(lastImport.date_import) : ''
  return {
    codesApe: '',
    departements: '',
    dateCreationMin: defaultMin,
    dateCreationMax: new Date().toISOString().slice(0, 10),
    dateMajMin: '',
    dateMajMax: '',
  }
}

export default function ClientsPage() {
  const { societeFilter } = useSocieteFilter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [importingApi, setImportingApi] = useState(false)
  const [importingCessationsApi, setImportingCessationsApi] = useState(false)
  const [savingSireneParams, setSavingSireneParams] = useState(false)
  const [uploadingCsv, setUploadingCsv] = useState(false)
  const [refreshingRge, setRefreshingRge] = useState(false)
  const [refreshingCapacite, setRefreshingCapacite] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [startingMaintenance, setStartingMaintenance] = useState(false)
  const [maintenanceRuns, setMaintenanceRuns] = useState<ClientMaintenanceRunRow[]>([])
  const [maintenanceSteps, setMaintenanceSteps] = useState<ClientMaintenanceStepRow[]>([])
  const [maintenanceLogs, setMaintenanceLogs] = useState<ClientMaintenanceLogRow[]>([])
  const [showMaintenanceLogs, setShowMaintenanceLogs] = useState(false)
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'warning' | 'error'>('all')
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [lastMonitorAt, setLastMonitorAt] = useState<Date | null>(null)

  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [allowedDepartements, setAllowedDepartements] = useState<string[]>([])

  const [clientRows, setClientRows] = useState<ClientCountRow[]>([])
  const [clientCegeclimRows, setClientCegeclimRows] = useState<ClientCegeclimCountRow[]>([])
  const [territories, setTerritories] = useState<TerritoryRow[]>([])

  const [lastImport, setLastImport] = useState<ImportRow | null>(null)
  const [lastApiImportAt, setLastApiImportAt] = useState<string | null>(null)
  const [sireneConfigId, setSireneConfigId] = useState<string | null>(null)

  const [sireneParams, setSireneParams] = useState<SireneParamsForm>(buildDefaultSireneParams(null))
  const [savedSireneSignature, setSavedSireneSignature] = useState<string>('')

  const [report, setReport] = useState<RunReport>(null)
  const [toast, setToast] = useState<ToastState>(null)

  const normalizedSocieteFilter = useMemo(() => normalizeScopeValue(societeFilter), [societeFilter])

  const busy =
    importingApi || importingCessationsApi || uploadingCsv || refreshingRge || refreshingCapacite || startingMaintenance

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    void loadPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadMaintenanceMonitor()
    const timer = window.setInterval(() => {
      void loadMaintenanceMonitor(false)
    }, 15000)

    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPage() {
    setLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const userEmail = session?.user?.email?.toLowerCase().trim() || null
      setCurrentUserEmail(userEmail)

      const [
        clientsRes,
        clientsCegeclimRes,
        territoriesRes,
        importRes,
        sireneParamsRes,
        userAccessRes,
      ] = await Promise.all([
        supabase.from('clients').select('siret, codePostalEtablissement, departement'),
        supabase.from('clients_cegeclim').select('siret, cp_sage'),
        supabase.from('territories').select('code_dep, societe'),
        supabase
          .from('imports_clients')
          .select('*')
          .in('type_import', IMPORT_TYPES)
          .order('date_import', { ascending: false })
          .limit(1),
        supabase.from('import_sirene_params').select('*').order('updated_at', { ascending: false }).limit(1),
        userEmail
          ? supabase
              .from('user_page_access')
              .select('email, allowed_departements')
              .eq('email', userEmail)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (clientsRes.error) throw clientsRes.error
      if (clientsCegeclimRes.error) throw clientsCegeclimRes.error
      if (territoriesRes.error) throw territoriesRes.error
      if (importRes.error) throw importRes.error
      if (sireneParamsRes.error) throw sireneParamsRes.error
      if ((userAccessRes as any).error) throw (userAccessRes as any).error

      setClientRows((clientsRes.data || []) as ClientCountRow[])
      setClientCegeclimRows((clientsCegeclimRes.data || []) as ClientCegeclimCountRow[])
      setTerritories((territoriesRes.data || []) as TerritoryRow[])

      const latestImport = (importRes.data?.[0] || null) as ImportRow | null
      setLastImport(latestImport)

      const sireneConfig = (sireneParamsRes.data?.[0] || null) as SireneImportParamRow | null
      const latestApiImport =
        formatDateInput(sireneConfig?.last_import_at) ||
        (latestImport?.type_import === 'api_sirene' ? formatDateInput(latestImport.date_import) : '')
      setLastApiImportAt(latestApiImport || null)

      if (sireneConfig) {
        setSireneConfigId(sireneConfig.id)
        const nextParams: SireneParamsForm = {
          codesApe: (sireneConfig.codes_ape || []).join(', '),
          departements: (sireneConfig.departements || []).join(', '),
          dateCreationMin: latestApiImport || formatDateInput(sireneConfig.date_creation_min),
          dateCreationMax: formatDateInput(sireneConfig.date_creation_max),
          dateMajMin: formatDateInput(sireneConfig.date_modification_min),
          dateMajMax: formatDateInput(sireneConfig.date_modification_max),
        }
        setSireneParams(nextParams)
        setSavedSireneSignature(JSON.stringify(nextParams))
      } else {
        setSireneConfigId(null)
        const nextParams = buildDefaultSireneParams(latestImport)
        setSireneParams(nextParams)
        setSavedSireneSignature(JSON.stringify(nextParams))
      }

      const userAccess = (userAccessRes as any).data as UserDepartmentAccessRow | null
      setAllowedDepartements(
        Array.isArray(userAccess?.allowed_departements)
          ? userAccess!.allowed_departements.map((d) => String(d || '').trim()).filter(Boolean)
          : []
      )
    } catch (error: any) {
      console.error(error)
      setToast({ tone: 'error', text: `Chargement impossible : ${error?.message || String(error)}` })
    } finally {
      setLoading(false)
    }
  }

  async function loadMaintenanceMonitor(showLoader = true) {
    if (showLoader) setMaintenanceLoading(true)
    try {
      const res = await fetch('/api/client-maintenance/status?limit=10', { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as ClientMaintenanceStatusPayload | null

      if (!res.ok || !data?.success) {
        throw new Error((data as any)?.error || 'Erreur chargement monitoring maintenance clients')
      }

      setMaintenanceRuns(data.runs || [])
      setMaintenanceSteps(data.steps || [])
      setMaintenanceLogs(data.logs || [])
      setLastMonitorAt(new Date())
    } catch (error) {
      console.error('Erreur monitoring maintenance clients:', error)
      if (showLoader) setToast({ tone: 'error', text: 'Le suivi de maintenance n’a pas pu être actualisé.' })
    } finally {
      if (showLoader) setMaintenanceLoading(false)
    }
  }

  async function startClientMaintenance() {
    const confirmed = window.confirm(
      'Lancer la maintenance complète clients ?\n\n' +
        'Le traitement sera suivi dans le bloc de monitoring : SIRENE, cessations, RGE, capacité gaz et enrichissement.'
    )

    if (!confirmed) return

    setStartingMaintenance(true)
    try {
      await persistSireneParams(sireneParams)
      setSavedSireneSignature(JSON.stringify(sireneParams))

      const res = await fetch('/api/client-maintenance/start-ui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'manual',
          config: {
            sirene: true,
            cessations: true,
            rge: true,
            capacite: true,
            enrichment: true,
            enrichmentLimit: 1000,
            enrichmentBatchSize: 25,
          },
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erreur lancement maintenance clients')
      }

      await loadMaintenanceMonitor()
      setToast({ tone: 'success', text: 'Maintenance planifiée. Le rail ci-dessus se met à jour toutes les 15 secondes.' })
    } catch (error: any) {
      console.error(error)
      setToast({ tone: 'error', text: `La maintenance n’a pas démarré : ${error?.message || String(error)}` })
    } finally {
      setStartingMaintenance(false)
    }
  }

  async function persistSireneParams(params: SireneParamsForm, forcedLastImportAt?: string | null) {
    const payload = {
      codes_ape: normalizeArray(params.codesApe),
      departements: normalizeArray(params.departements),
      date_creation_min: params.dateCreationMin || null,
      date_creation_max: params.dateCreationMax || null,
      date_modification_min: params.dateMajMin || null,
      date_modification_max: params.dateMajMax || null,
      last_import_at: forcedLastImportAt ?? lastApiImportAt ?? null,
      updated_at: new Date().toISOString(),
    }

    if (sireneConfigId) {
      const { error } = await supabase.from('import_sirene_params').update(payload).eq('id', sireneConfigId)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('import_sirene_params').insert(payload).select('id').single()
      if (error) throw error
      setSireneConfigId(data.id as string)
    }
  }

  async function saveSireneParams() {
    setSavingSireneParams(true)
    try {
      await persistSireneParams(sireneParams)
      setSavedSireneSignature(JSON.stringify(sireneParams))
      setToast({ tone: 'success', text: 'Paramètres SIRENE enregistrés.' })
    } catch (error: any) {
      console.error(error)
      setToast({ tone: 'error', text: `Les paramètres n’ont pas été enregistrés : ${error?.message || String(error)}` })
    } finally {
      setSavingSireneParams(false)
    }
  }

  async function finalizeSireneParamsAfterApiImport(importDate: string, sourceParams: SireneParamsForm) {
    const nextParams: SireneParamsForm = {
      ...sourceParams,
      dateCreationMin: importDate,
      dateCreationMax: '',
    }

    await persistSireneParams(nextParams, importDate)
    setLastApiImportAt(importDate)
    setSireneParams(nextParams)
    setSavedSireneSignature(JSON.stringify(nextParams))
  }

  async function launchImportSirene() {
    setImportingApi(true)
    setSavingSireneParams(true)

    try {
      const paramsBeforeImport: SireneParamsForm = { ...sireneParams }

      setSireneParams(paramsBeforeImport)
      await persistSireneParams(paramsBeforeImport)

      const res = await fetch('/api/import-sirene', { method: 'POST' })
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

      setReport({
        title: 'Import SIRENE terminé',
        subtitle: 'Créations d’établissements récupérées depuis l’API Sirene.',
        tone: 'success',
        lines: [
          { label: 'Importés', value: formatNumber(data.imported ?? 0), emphasis: true },
          { label: 'Déjà présents', value: formatNumber(data.already_present ?? 0) },
          { label: 'Rejets filtres', value: formatNumber(data.rejected_by_filter ?? 0) },
          { label: 'Rejets totaux', value: formatNumber(data.rejected_total ?? 0) },
          { label: 'Pages lues', value: formatNumber(data.pages ?? 0) },
          { label: 'Parcourus API', value: formatNumber(data.fetched ?? 0) },
          { label: 'Total API annoncé', value: data.api_total != null ? formatNumber(data.api_total) : 'n/a' },
          { label: 'Après filtre départements', value: formatNumber(data.total_api_after_department_filter ?? 0) },
        ],
      })

      await finalizeSireneParamsAfterApiImport(new Date().toISOString().slice(0, 10), paramsBeforeImport)
      await loadPage()
    } catch (error: any) {
      console.error(error)
      setReport({
        title: 'L’import SIRENE a échoué',
        tone: 'error',
        lines: [{ label: 'Détail', value: error?.message || String(error) }],
      })
    } finally {
      setSavingSireneParams(false)
      setImportingApi(false)
    }
  }

  async function launchImportSireneCessations() {
    const confirmed = window.confirm(
      "Lancer l'import des cessations SIRENE ?\n\n" +
        "Les SIRET fermés seront supprimés de la table clients, sauf s'ils sont clients CEGECLIM.\n" +
        "Pour les clients CEGECLIM, l'établissement sera conservé et marqué comme fermé avec la date de cessation."
    )

    if (!confirmed) return

    setImportingCessationsApi(true)
    setSavingSireneParams(true)

    try {
      const paramsBeforeImport: SireneParamsForm = { ...sireneParams }

      await persistSireneParams(paramsBeforeImport)

      const res = await fetch('/api/import-sirene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'cessation' }),
      })

      const text = await res.text()

      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(text)
      }

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erreur import cessations SIRENE')
      }

      const importDate = new Date().toISOString().slice(0, 10)
      await persistSireneParams(paramsBeforeImport, importDate)
      setLastApiImportAt(importDate)

      setReport({
        title: 'Import des cessations terminé',
        subtitle: 'Les établissements fermés ont été retirés, sauf les clients CEGECLIM qui restent marqués fermés.',
        tone: 'success',
        lines: [
          { label: 'Fermetures valides', value: formatNumber(data.closed_candidates ?? 0), emphasis: true },
          { label: 'SIRET supprimés de clients', value: formatNumber(data.deleted_from_clients ?? 0), emphasis: true },
          { label: 'Clients CEGECLIM marqués fermés', value: formatNumber(data.cegeclim_alerts_updated ?? 0) },
          { label: 'Déjà absents de clients', value: formatNumber(data.already_absent ?? 0) },
          { label: 'Rejets filtres', value: formatNumber(data.rejected_by_filter ?? 0) },
          { label: 'Rejets totaux', value: formatNumber(data.rejected_total ?? 0) },
          { label: 'Batchs journaliers', value: formatNumber(data.daily_batch_count ?? 0) },
          { label: 'Unités de requête', value: formatNumber(data.query_unit_count ?? 0) },
          { label: 'Découpage par code APE', value: data.split_by_ape ? 'oui' : 'non' },
          { label: 'Pages lues', value: formatNumber(data.pages ?? 0) },
          { label: 'Parcourus API', value: formatNumber(data.fetched ?? 0) },
          { label: 'Total API annoncé', value: data.api_total != null ? formatNumber(data.api_total) : 'n/a' },
        ],
      })

      await loadPage()
    } catch (error: any) {
      console.error(error)
      setReport({
        title: 'L’import des cessations a échoué',
        tone: 'error',
        lines: [{ label: 'Détail', value: error?.message || String(error) }],
      })
    } finally {
      setSavingSireneParams(false)
      setImportingCessationsApi(false)
    }
  }

  async function launchRgeRefresh() {
    setRefreshingRge(true)
    try {
      const res = await fetch('/api/rge-refresh', { method: 'POST' })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erreur lors de la mise à jour RGE')
      }

      setReport({
        title: 'Référentiel RGE à jour',
        subtitle: 'Source : ADEME. Le cache RGE puis la table clients ont été rafraîchis.',
        tone: 'success',
        lines: [
          { label: 'Clients mis à jour', value: formatNumber(data.stats?.clientsUpdated ?? 0), emphasis: true },
          { label: 'Lignes source', value: formatNumber(data.stats?.sourceRows ?? 0) },
          { label: 'SIRET RGE agrégés', value: formatNumber(data.stats?.cacheRows ?? 0) },
          { label: 'Nouveaux en cache', value: formatNumber(data.stats?.cacheInserted ?? 0) },
          { label: 'Cache déjà existant', value: formatNumber(data.stats?.cacheUpdated ?? 0) },
          { label: 'Cache supprimé', value: formatNumber(data.stats?.cacheDeleted ?? 0) },
        ],
      })

      await loadPage()
    } catch (error: any) {
      console.error(error)
      setReport({
        title: 'La mise à jour RGE a échoué',
        tone: 'error',
        lines: [{ label: 'Détail', value: error?.message || String(error) }],
      })
    } finally {
      setRefreshingRge(false)
    }
  }

  async function launchCapaciteRefresh() {
    setRefreshingCapacite(true)
    try {
      const res = await fetch('/api/capacite', { method: 'POST' })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erreur lors de la mise à jour capacité ADEME')
      }

      setReport({
        title: 'Capacité froid/clim à jour',
        subtitle: 'Source : ADEME, opérateurs attestés gaz fluorés, secteur froid et climatisation.',
        tone: 'success',
        lines: [
          { label: 'Clients mis à jour', value: formatNumber(data.nb_rows_updated ?? 0), emphasis: true },
          { label: 'Lignes source', value: formatNumber(data.nb_rows_source ?? 0) },
          { label: 'Lignes cible froid/clim', value: formatNumber(data.nb_rows_target ?? 0) },
          { label: 'Lignes cache agrégées', value: formatNumber(data.nb_rows_imported ?? 0) },
          { label: 'Avec date de délivrance', value: formatNumber(data.nb_target_rows_with_date_delivrance ?? 0) },
          { label: 'Avec date de fin de validité', value: formatNumber(data.nb_target_rows_with_date_fin_validite ?? 0) },
        ],
      })

      await loadPage()
    } catch (error: any) {
      console.error(error)
      setReport({
        title: 'La mise à jour capacité a échoué',
        tone: 'error',
        lines: [{ label: 'Détail', value: error?.message || String(error) }],
      })
    } finally {
      setRefreshingCapacite(false)
    }
  }

  function mapCsvRowToClient(row: CsvRawRow): ClientUpsertRow | null {
    const siret = normalizeSiret(row.siret)
    if (!siret) return null

    const raisonSociale = buildRaisonSociale(row)
    const codePostal = firstNonEmpty(row.codePostalEtablissement)
    const departement = getDepartmentFromPostalCode(codePostal)
    const apeFinal = firstNonEmpty(row.activitePrincipaleEtablissement, row.activitePrincipaleUniteLegale) || null
    const nomDirigeant = firstNonEmpty([row.prenom1UniteLegale, row.nomUniteLegale].filter(Boolean).join(' ')) || null

    return {
      siret,
      raison_sociale_affichee: raisonSociale,
      activitePrincipaleEtablissement: apeFinal,
      naf_libelle_traduit: apeFinal ? translateNaf(apeFinal) : null,
      dateCreationEtablissement: parseMaybeDate(row.dateCreationEtablissement),
      codePostalEtablissement: codePostal,
      libelleCommuneEtablissement: firstNonEmpty(row.libelleCommuneEtablissement),
      departement,
      adresse_complete: buildAdresseComplete(row),
      coordonneeLambertAbscisseEtablissement: parseNumeric(row.coordonneeLambertAbscisseEtablissement),
      coordonneeLambertOrdonneeEtablissement: parseNumeric(row.coordonneeLambertOrdonneeEtablissement),
      trancheEffectifsEtablissement: firstNonEmpty(row.trancheEffectifsEtablissement),
      nom_dirigeant: nomDirigeant,
      contactable: false,
      enrichment_status: 'a_faire',
      date_import: new Date().toISOString(),
      source_import: 'entreprise_france',
      telephone: null,
      email: null,
      site_web: null,
      effectif_estime: null,
      ca_estime: null,
      pappers_ca: null,
      pappers_resultat: null,
      rge: null,
      potentiel_score: null,
      enrichment_source: 'entreprise_france',
      enrichment_error: null,
      google_maps_url: null,
      google_rating: null,
      google_user_ratings_total: null,
      present_dans_cegeclim: null,
      prospect_status: null,
      assigned_to: null,
      last_contact_at: null,
      next_action_at: null,
      next_action_label: null,
      prospect_comment: null,
    }
  }

  async function handleCsvSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingCsv(true)

    try {
      const parsed = await new Promise<Papa.ParseResult<CsvRawRow>>((resolve, reject) => {
        Papa.parse<CsvRawRow>(file, {
          header: true,
          skipEmptyLines: true,
          complete: resolve,
          error: reject,
        })
      })

      const rows = parsed.data || []
      const rejects: RejectInsertRow[] = []
      const mappedRows: ClientUpsertRow[] = []

      rows.forEach((rawRow, index) => {
        const mapped = mapCsvRowToClient(rawRow)
        if (!mapped) {
          rejects.push({
            import_id: '',
            ligne_numero: index + 1,
            siret: normalizeSiret(rawRow.siret) || null,
            motif_rejet: 'SIRET absent ou invalide',
            donnees_source_json: rawRow,
            created_at: new Date().toISOString(),
          })
          return
        }
        mappedRows.push(mapped)
      })

      const uniqueMap = new Map<string, ClientUpsertRow>()
      for (const row of mappedRows) {
        if (row.siret) uniqueMap.set(row.siret, row)
      }
      const finalRows = Array.from(uniqueMap.values())

      const existingSirets = new Set<string>()
      for (const chunk of chunkArray(finalRows.map((row) => row.siret as string), UPSERT_CHUNK_SIZE)) {
        const { data, error } = await supabase.from('clients').select('siret').in('siret', chunk)
        if (error) throw error
        for (const item of data || []) {
          if (item?.siret) existingSirets.add(String(item.siret))
        }
      }

      const { data: importHeader, error: importHeaderError } = await supabase
        .from('imports_clients')
        .insert({
          nom_fichier: file.name,
          type_import: 'entreprise_france',
          nb_lignes_source: rows.length,
          nb_importees: 0,
          nb_mises_a_jour: 0,
          nb_rejets: rejects.length,
          date_import: new Date().toISOString(),
          commentaire: 'Import manuel CSV Entreprise France',
        })
        .select('id')
        .single()

      if (importHeaderError) throw importHeaderError
      const importId = String(importHeader.id)

      for (const reject of rejects) {
        reject.import_id = importId
      }

      for (const chunk of chunkArray(finalRows, UPSERT_CHUNK_SIZE)) {
        const { error } = await supabase.from('clients').upsert(chunk, { onConflict: 'siret' })
        if (error) throw error
      }

      if (rejects.length > 0) {
        for (const chunk of chunkArray(rejects, UPSERT_CHUNK_SIZE)) {
          const { error } = await supabase.from('imports_clients_rejets').insert(chunk)
          if (error) throw error
        }
      }

      const updatedCount = finalRows.filter((row) => row.siret && existingSirets.has(row.siret)).length
      const insertedCount = finalRows.length - updatedCount

      const { error: updateHeaderError } = await supabase
        .from('imports_clients')
        .update({
          nb_importees: insertedCount,
          nb_mises_a_jour: updatedCount,
          nb_rejets: rejects.length,
          commentaire: `Import manuel CSV - insérés=${insertedCount} - maj=${updatedCount} - rejets=${rejects.length}`,
        })
        .eq('id', importId)

      if (updateHeaderError) throw updateHeaderError

      setReport({
        title: 'Import du fichier terminé',
        subtitle: file.name,
        tone: 'success',
        lines: [
          { label: 'Insérés', value: formatNumber(insertedCount), emphasis: true },
          { label: 'Mis à jour', value: formatNumber(updatedCount), emphasis: true },
          { label: 'Rejets', value: formatNumber(rejects.length) },
          { label: 'Lignes du fichier', value: formatNumber(rows.length) },
        ],
      })

      await loadPage()
    } catch (error: any) {
      console.error(error)
      setReport({
        title: 'L’import du fichier a échoué',
        subtitle: file.name,
        tone: 'error',
        lines: [{ label: 'Détail', value: error?.message || String(error) }],
      })
    } finally {
      setUploadingCsv(false)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Données dérivées                                                    */
  /* ------------------------------------------------------------------ */

  const activeMaintenanceRun = maintenanceRuns.find((run) => ['queued', 'running'].includes(run.status)) || null

  const displayedRun = useMemo(() => {
    if (selectedRunId) {
      const found = maintenanceRuns.find((run) => run.id === selectedRunId)
      if (found) return found
    }
    return maintenanceRuns[0] || null
  }, [maintenanceRuns, selectedRunId])

  const displayedSteps = useMemo(() => {
    if (!displayedRun) return []
    return maintenanceSteps
      .filter((step) => step.run_id === displayedRun.id)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  }, [maintenanceSteps, displayedRun])

  const displayedLogs = useMemo(() => {
    if (!displayedRun) return []
    return maintenanceLogs
      .filter((log) => log.run_id === displayedRun.id)
      .filter((log) => (logLevelFilter === 'all' ? true : logLevelFilter === 'warning' ? log.level !== 'info' : log.level === 'error'))
  }, [maintenanceLogs, displayedRun, logLevelFilter])

  const stepProgress = useMemo(() => {
    if (displayedSteps.length === 0) return 0
    const finished = displayedSteps.filter((step) => ['done', 'skipped', 'error'].includes(step.status)).length
    return Math.round((finished / displayedSteps.length) * 100)
  }, [displayedSteps])

  const runErrorCount = useMemo(
    () => displayedSteps.reduce((total, step) => total + Number(step.error_count || 0), 0),
    [displayedSteps]
  )

  const scopedDepartmentSet = useMemo(() => {
    if (normalizedSocieteFilter === 'global') return null

    return new Set(
      territories
        .filter((row) => normalizeScopeValue(row.societe) === normalizedSocieteFilter)
        .map((row) => String(row.code_dep || '').trim())
        .filter(Boolean)
    )
  }, [territories, normalizedSocieteFilter])

  const profileDepartmentSet = useMemo(() => {
    if (allowedDepartements.length === 0) return null
    return new Set(allowedDepartements)
  }, [allowedDepartements])

  function isAllowedDepartment(dep: string | null | undefined) {
    const department = String(dep || '').trim()
    if (!department) return false
    if (scopedDepartmentSet && !scopedDepartmentSet.has(department)) return false
    if (profileDepartmentSet && !profileDepartmentSet.has(department)) return false
    return true
  }

  const scopedClientRows = useMemo(() => {
    return clientRows.filter((row) => {
      const dep = getDepartmentFromPostalCode(row.codePostalEtablissement) || String(row.departement || '').trim()
      return isAllowedDepartment(dep)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientRows, scopedDepartmentSet, profileDepartmentSet])

  const scopedCegeclimRows = useMemo(() => {
    return clientCegeclimRows.filter((row) => {
      const dep = getDepartmentFromPostalCode(row.cp_sage)
      return isAllowedDepartment(dep)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientCegeclimRows, scopedDepartmentSet, profileDepartmentSet])

  const clientKpis = useMemo(() => {
    const clientSiretSet = new Set(scopedClientRows.map((row) => normalizeSiret(row.siret)).filter(Boolean))

    const cegeclimMissing = scopedCegeclimRows.filter((row) => {
      const siret = normalizeSiret(row.siret)
      return siret ? !clientSiretSet.has(siret) : false
    })

    return {
      clientsCount: scopedClientRows.length,
      cegeclimCount: scopedCegeclimRows.length,
      cegeclimMissingCount: cegeclimMissing.length,
    }
  }, [scopedClientRows, scopedCegeclimRows])

  const sireneDirty = savedSireneSignature !== '' && savedSireneSignature !== JSON.stringify(sireneParams)
  const apeCodes = normalizeArray(sireneParams.codesApe)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F3F0] p-6">
        <div className="mx-auto max-w-[1600px] rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">
          Chargement de la base clients…
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Données</div>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-white md:text-[32px]">Base clients</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
              Alimentation et entretien du référentiel : SIRENE, cessations, RGE et capacité froid/clim.
              Le pipeline tourne chaque nuit ; les mises à jour ponctuelles se lancent ci-dessous.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Départements visibles selon votre profil : {allowedDepartements.join(', ') || 'tous'}
              {currentUserEmail ? ` · ${currentUserEmail}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <HeaderStat label="Base clients" value={clientKpis.clientsCount} />
            <HeaderStat label="Base CEGECLIM" value={clientKpis.cegeclimCount} />
            <HeaderStat
              label="CEGECLIM absents"
              value={clientKpis.cegeclimMissingCount}
              tone={clientKpis.cegeclimMissingCount > 0 ? 'warn' : 'default'}
            />
            <button
              type="button"
              onClick={() => void loadPage()}
              className="h-[52px] rounded-xl border border-[#2C3946] px-4 text-sm font-semibold text-slate-200 transition hover:border-[#B4761A] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]"
            >
              Recharger
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 md:px-8">
        {/* ============================================================ Pipeline */}
        <section className="overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white">
          <div className="flex flex-col gap-3 border-b border-[#EFEDE8] px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Eyebrow>Chaîne de traitement</Eyebrow>
              <h2 className="mt-1 text-lg font-bold text-slate-900">Maintenance automatique</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Cinq étapes enchaînées : création et mise à jour SIRENE, cessations, RGE, capacité froid/clim, puis enrichissement.
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <div className="flex gap-2">
                <GhostButton onClick={() => void loadMaintenanceMonitor()} disabled={maintenanceLoading}>
                  {maintenanceLoading ? 'Actualisation…' : 'Actualiser'}
                </GhostButton>
                <PrimaryButton
                  onClick={() => void startClientMaintenance()}
                  disabled={startingMaintenance || Boolean(activeMaintenanceRun)}
                >
                  {startingMaintenance
                    ? 'Planification…'
                    : activeMaintenanceRun
                      ? 'Traitement en cours'
                      : 'Lancer maintenant'}
                </PrimaryButton>
              </div>
              <LiveIndicator lastAt={lastMonitorAt} running={Boolean(activeMaintenanceRun)} />
            </div>
          </div>

          {!displayedRun ? (
            <div className="px-5 py-14 text-center">
              <p className="text-sm font-semibold text-slate-900">Aucune exécution enregistrée</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
                Lancez la maintenance pour créer la première exécution. Chaque étape sera suivie ici, avec ses compteurs et ses logs.
              </p>
            </div>
          ) : (
            <>
              {maintenanceRuns.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-[#EFEDE8] bg-[#FAF9F7] px-5 py-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Exécutions</span>
                  {maintenanceRuns.map((run) => {
                    const active = run.id === displayedRun.id
                    return (
                      <button
                        type="button"
                        key={run.id}
                        onClick={() => setSelectedRunId(run.id)}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] ${
                          active
                            ? 'border-[#111820] bg-[#111820] text-white'
                            : 'border-[#E2DFD8] bg-white text-slate-600 hover:border-[#B4761A]'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${getStatusDotClass(run.status)}`} />
                        {formatDateTimeFr(run.started_at || run.created_at)}
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="grid grid-cols-2 gap-px border-b border-[#EFEDE8] bg-[#EFEDE8] lg:grid-cols-5">
                <RunFact label="Statut">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClasses(displayedRun.status)}`}>
                    {getMaintenanceStatusLabel(displayedRun.status)}
                  </span>
                </RunFact>
                <RunFact label="Début">
                  <span className="text-sm font-semibold text-slate-900">
                    {formatDateTimeFr(displayedRun.started_at || displayedRun.created_at)}
                  </span>
                </RunFact>
                <RunFact label="Durée">
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatDuration(displayedRun.started_at || displayedRun.created_at, displayedRun.finished_at)}
                  </span>
                </RunFact>
                <RunFact label="Étape en cours">
                  <span className="text-sm font-semibold text-slate-900">{displayedRun.current_step || '—'}</span>
                </RunFact>
                <RunFact label="Erreurs">
                  <span className={`text-sm font-semibold tabular-nums ${runErrorCount > 0 ? 'text-[#A32C2C]' : 'text-slate-900'}`}>
                    {formatNumber(runErrorCount)}
                  </span>
                </RunFact>
              </div>

              {/* --- Rail des étapes : l'élément central de l'écran --- */}
              <div className="px-5 pt-5">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EFEDE8]">
                    <div
                      className="h-full rounded-full bg-[#B4761A] transition-all duration-500"
                      style={{ width: `${stepProgress}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{stepProgress}%</span>
                </div>

                {displayedSteps.length === 0 ? (
                  <p className="pb-5 text-sm text-slate-500">Les étapes apparaîtront dès le démarrage du traitement.</p>
                ) : (
                  <ol className="flex flex-wrap gap-2">
                    {displayedSteps.map((step, index) => (
                      <li
                        key={step.id}
                        className={`min-w-[190px] flex-1 rounded-xl border bg-white p-3 ${
                          step.status === 'running' ? 'border-[#B4761A] shadow-sm' : 'border-[#E7E4DD]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotClass(step.status)}`} />
                          <span className="truncate text-sm font-semibold text-slate-900">{step.step_label}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${getStatusClasses(step.status)}`}>
                            {getMaintenanceStatusLabel(step.status)}
                          </span>
                          <span className="text-[11px] tabular-nums text-slate-500">
                            {formatDuration(step.started_at, step.finished_at)}
                          </span>
                        </div>
                        <div className="mt-2 text-[11px] tabular-nums text-slate-500">
                          {formatNumber(step.processed_count ?? 0)} traité{Number(step.processed_count || 0) > 1 ? 's' : ''}
                          {Number(step.error_count || 0) > 0 && (
                            <span className="ml-1.5 font-bold text-[#A32C2C]">
                              · {formatNumber(step.error_count)} erreur{Number(step.error_count) > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Étape {index + 1}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {displayedRun.message && (
                <div className="mx-5 mt-4 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] px-4 py-3 text-sm text-slate-700">
                  {displayedRun.message}
                </div>
              )}
              {displayedRun.error_message && (
                <div className="mx-5 mt-3 rounded-xl border border-[#F0C7C7] bg-[#FBE9E9] px-4 py-3 text-sm font-semibold text-[#A32C2C]">
                  {displayedRun.error_message}
                </div>
              )}

              {displayedSteps.length > 0 && (
                <div className="mt-5 px-5">
                  <div className="overflow-x-auto rounded-xl border border-[#E7E4DD]">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#FAF9F7]">
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Étape</th>
                          <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Statut</th>
                          <NumHead>Traité</NumHead>
                          <NumHead>Créés</NumHead>
                          <NumHead>Mis à jour</NumHead>
                          <NumHead>Rejets</NumHead>
                          <NumHead>Erreurs</NumHead>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedSteps.map((step) => (
                          <tr key={step.id} className="border-t border-[#EFEDE8] hover:bg-[#FAF9F7]">
                            <td className="px-3 py-2.5 font-medium text-slate-900">{step.step_label}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClasses(step.status)}`}>
                                {getMaintenanceStatusLabel(step.status)}
                              </span>
                            </td>
                            <NumCell value={step.processed_count} />
                            <NumCell value={step.inserted_count} />
                            <NumCell value={step.updated_count} />
                            <NumCell value={step.rejected_count} />
                            <NumCell value={step.error_count} danger />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-5 pb-5">
                <div className="flex flex-wrap items-center gap-2">
                  <GhostButton onClick={() => setShowMaintenanceLogs((prev) => !prev)}>
                    {showMaintenanceLogs ? 'Masquer les logs' : 'Afficher les logs'}
                  </GhostButton>
                  {showMaintenanceLogs && (
                    <div className="inline-flex rounded-lg border border-[#D8D3C8] bg-white p-1">
                      {(['all', 'warning', 'error'] as const).map((level) => (
                        <button
                          type="button"
                          key={level}
                          onClick={() => setLogLevelFilter(level)}
                          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                            logLevelFilter === level ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {level === 'all' ? 'Tout' : level === 'warning' ? 'Alertes' : 'Erreurs'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-xs text-slate-500">{displayedLogs.length} ligne(s) de log</span>
              </div>

              {showMaintenanceLogs && (
                <div className="mx-5 mb-5 max-h-[320px] overflow-auto rounded-xl bg-[#111820] p-3 font-mono text-xs leading-relaxed text-slate-300">
                  {displayedLogs.length === 0 ? (
                    <p className="p-3 text-slate-400">Aucun log pour ce filtre.</p>
                  ) : (
                    displayedLogs.slice(0, 200).map((log) => (
                      <div key={log.id} className="border-b border-white/5 py-1.5 last:border-0">
                        <span className="text-slate-500">{formatDateTimeFr(log.created_at)}</span>
                        <span
                          className={`mx-2 font-bold uppercase ${
                            log.level === 'error' ? 'text-[#F09A9A]' : log.level === 'warning' ? 'text-[#E0A961]' : 'text-slate-500'
                          }`}
                        >
                          {log.level}
                        </span>
                        <span className="text-slate-200">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* ============================================================ Sources */}
        <section className="rounded-2xl border border-[#E2DFD8] bg-white">
          <div className="border-b border-[#EFEDE8] px-5 py-4">
            <Eyebrow>Mises à jour ponctuelles</Eyebrow>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Sources de données</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Chaque source peut être relancée seule, en dehors du pipeline nocturne.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-2">
            {/* --- API Sirene --- */}
            <SourceCard
              source="API Sirene"
              title="Créations et cessations d’établissements"
              description="L’import classique s’appuie sur les dates de création. L’import des cessations utilise les dates de modification si elles sont renseignées, sinon les dates de création."
              meta={lastApiImportAt ? `Dernier appel : ${formatDateFr(lastApiImportAt)}` : 'Jamais appelée'}
              className="xl:col-span-2"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DateRangeField
                  legend="Établissements créés entre"
                  from={sireneParams.dateCreationMin}
                  to={sireneParams.dateCreationMax}
                  onFrom={(value) => setSireneParams((prev) => ({ ...prev, dateCreationMin: value }))}
                  onTo={(value) => setSireneParams((prev) => ({ ...prev, dateCreationMax: value }))}
                />
                <DateRangeField
                  legend="Modifiés entre"
                  hint="Utilisé en priorité pour les cessations."
                  from={sireneParams.dateMajMin}
                  to={sireneParams.dateMajMax}
                  onFrom={(value) => setSireneParams((prev) => ({ ...prev, dateMajMin: value }))}
                  onTo={(value) => setSireneParams((prev) => ({ ...prev, dateMajMax: value }))}
                />
              </div>

              <div className="mt-4">
                <span className="mb-1.5 block text-sm font-semibold text-slate-800">Codes APE retenus</span>
                <ChipsField
                  values={apeCodes}
                  onChange={(values) => setSireneParams((prev) => ({ ...prev, codesApe: values.join(', ') }))}
                  placeholder="4322B, 4321A…"
                />
                <span className="mt-1.5 block text-xs text-slate-500">
                  Vide = tous les codes. Entrée ou virgule pour ajouter.
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PrimaryButton onClick={() => void saveSireneParams()} disabled={savingSireneParams || busy}>
                  {savingSireneParams && !importingApi && !importingCessationsApi ? 'Enregistrement…' : 'Enregistrer les paramètres'}
                </PrimaryButton>
                <SecondaryButton onClick={() => void launchImportSirene()} disabled={savingSireneParams || busy}>
                  {importingApi ? 'Import en cours…' : 'Importer les créations'}
                </SecondaryButton>
                <DangerButton onClick={() => void launchImportSireneCessations()} disabled={savingSireneParams || busy}>
                  {importingCessationsApi ? 'Import cessations…' : 'Importer les cessations'}
                </DangerButton>

                {sireneDirty && (
                  <span className="flex items-center gap-2 text-xs font-semibold text-[#8A5A11]">
                    <span className="h-2 w-2 rounded-full bg-[#B4761A]" />
                    Paramètres modifiés, pensez à les enregistrer
                  </span>
                )}
              </div>

              <p className="mt-3 text-xs text-slate-500">
                L’import des cessations supprime les SIRET fermés de la table clients. Les clients CEGECLIM sont conservés et marqués fermés.
              </p>
            </SourceCard>

            {/* --- CSV --- */}
            <SourceCard
              source="Fichier"
              title="Export Entreprise France (CSV)"
              description="Alimente la table clients à partir d’un export téléchargé manuellement. Les SIRET déjà connus sont mis à jour, les autres créés."
              meta={
                lastImport
                  ? `Dernier fichier : ${lastImport.nom_fichier} · ${formatDateFr(lastImport.date_import)}`
                  : 'Aucun fichier importé'
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton onClick={() => fileInputRef.current?.click()} disabled={uploadingCsv || busy}>
                  {uploadingCsv ? 'Import en cours…' : 'Choisir un fichier CSV'}
                </PrimaryButton>
                <a
                  href={SIRENE_EXPORT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-[#8A5A11] underline decoration-[#EBD8AE] underline-offset-4 transition hover:decoration-[#B4761A]"
                >
                  Télécharger un export sur annuaire-entreprises.data.gouv.fr
                </a>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvSelected}
                  className="hidden"
                />
              </div>

              {lastImport && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MiniStat label="Insérés" value={lastImport.nb_importees ?? 0} />
                  <MiniStat label="Mis à jour" value={lastImport.nb_mises_a_jour ?? 0} />
                  <MiniStat label="Rejets" value={lastImport.nb_rejets ?? 0} danger={Number(lastImport.nb_rejets || 0) > 0} />
                </div>
              )}
            </SourceCard>

            {/* --- RGE + capacité --- */}
            <div className="grid grid-cols-1 gap-4">
              <SourceCard
                source="ADEME"
                title="Qualification RGE"
                description="Recharge le référentiel RGE, reconstruit le cache puis met à jour les champs RGE des clients."
              >
                <PrimaryButton onClick={() => void launchRgeRefresh()} disabled={refreshingRge || busy}>
                  {refreshingRge ? 'Mise à jour…' : 'Mettre à jour le RGE'}
                </PrimaryButton>
              </SourceCard>

              <SourceCard
                source="ADEME"
                title="Capacité froid/clim"
                description="Récupère les opérateurs attestés gaz fluorés, filtre le secteur froid et climatisation, puis met à jour les attestations des clients."
              >
                <PrimaryButton onClick={() => void launchCapaciteRefresh()} disabled={refreshingCapacite || busy}>
                  {refreshingCapacite ? 'Mise à jour…' : 'Mettre à jour la capacité'}
                </PrimaryButton>
              </SourceCard>
            </div>
          </div>
        </section>
      </main>

      {/* ============================================================ Compte rendu */}
      {report && (
        <div
          className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto bg-[#111820]/55 p-4 py-10"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReport(null)
          }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-[#E2DFD8] bg-white shadow-2xl">
            <div
              className={`flex items-start justify-between gap-4 rounded-t-2xl px-5 py-4 ${
                report.tone === 'success' ? 'bg-[#FDF7EA]' : 'bg-[#FBE9E9]'
              }`}
            >
              <div>
                <h3 className={`text-lg font-bold ${report.tone === 'success' ? 'text-slate-900' : 'text-[#A32C2C]'}`}>
                  {report.title}
                </h3>
                {report.subtitle && <p className="mt-1 text-sm text-slate-600">{report.subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={() => setReport(null)}
                className="shrink-0 rounded px-1 text-slate-500 transition hover:text-slate-900"
                aria-label="Fermer le compte rendu"
              >
                ✕
              </button>
            </div>

            <dl className="divide-y divide-[#EFEDE8] px-5">
              {report.lines.map((line) => (
                <div key={line.label} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className={`text-sm ${line.emphasis ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                    {line.label}
                  </dt>
                  <dd
                    className={`text-right tabular-nums ${
                      line.emphasis ? 'text-lg font-bold text-slate-900' : 'text-sm font-semibold text-slate-700'
                    }`}
                  >
                    {line.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex justify-end px-5 py-4">
              <PrimaryButton onClick={() => setReport(null)}>Fermer</PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[10000] flex justify-center px-4">
          <div
            role="status"
            className={`pointer-events-auto flex max-w-2xl items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ${
              toast.tone === 'success' ? 'bg-[#111820] text-white' : 'bg-[#7F1D1D] text-white'
            }`}
          >
            <span className="flex-1 leading-relaxed">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="shrink-0 rounded px-1 text-white/70 transition hover:text-white"
              aria-label="Fermer le message"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Briques d'interface                                                  */
/* ------------------------------------------------------------------ */

function HeaderStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' }) {
  const alert = tone === 'warn' && value > 0
  return (
    <div className={`min-w-[124px] rounded-xl border px-4 py-2.5 ${alert ? 'border-[#B4761A] bg-[#1B1710]' : 'border-[#2C3946] bg-[#161F29]'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${alert ? 'text-[#E0A961]' : 'text-white'}`}>
        {formatNumber(value)}
      </div>
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A5A11]">{children}</div>
}

/** Horloge discrète : on sait toujours de quand datent les chiffres affichés. */
function LiveIndicator({ lastAt, running }: { lastAt: Date | null; running: boolean }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!lastAt) return <span className="text-xs text-slate-400">Suivi non chargé</span>

  const seconds = Math.max(0, Math.round((Date.now() - lastAt.getTime()) / 1000))

  return (
    <span className="flex items-center gap-2 text-xs text-slate-500">
      <span className={`h-2 w-2 rounded-full ${running ? 'animate-pulse bg-[#B4761A]' : 'bg-[#CBC5B8]'}`} />
      {running ? 'Traitement en cours · ' : ''}
      actualisé il y a {seconds}s
    </span>
  )
}

function RunFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function NumHead({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {children}
    </th>
  )
}

function NumCell({ value, danger = false }: { value: number | null | undefined; danger?: boolean }) {
  const numeric = Number(value || 0)
  return (
    <td
      className={`px-3 py-2.5 text-right tabular-nums ${
        danger && numeric > 0 ? 'font-bold text-[#A32C2C]' : numeric === 0 ? 'text-slate-400' : 'text-slate-800'
      }`}
    >
      {formatNumber(numeric)}
    </td>
  )
}

function MiniStat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-[#E7E4DD] bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${danger ? 'text-[#A32C2C]' : 'text-slate-900'}`}>
        {formatNumber(value)}
      </div>
    </div>
  )
}

/**
 * Une carte par source réelle (API Sirene, fichier, ADEME) plutôt qu'une
 * numérotation « Option 1 / 2 / 3 » : ces traitements ne s'enchaînent pas.
 */
function SourceCard({
  source,
  title,
  description,
  meta,
  className = '',
  children,
}: {
  source: string
  title: string
  description: string
  meta?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <article className={`flex flex-col rounded-2xl border border-[#E7E4DD] bg-[#FAF9F7] p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="rounded-md bg-[#EDEAE3] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
          {source}
        </span>
        {meta && <span className="text-xs text-slate-500">{meta}</span>}
      </div>
      <h3 className="mt-3 text-base font-bold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</p>
      <div className="mt-4">{children}</div>
    </article>
  )
}

function DateRangeField({
  legend,
  hint,
  from,
  to,
  onFrom,
  onTo,
}: {
  legend: string
  hint?: string
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-semibold text-slate-800">{legend}</legend>
      <div className="flex items-center gap-2">
        <DateInput value={from} onChange={onFrom} label={`${legend} — début`} />
        <span className="shrink-0 text-sm text-slate-400">→</span>
        <DateInput value={to} onChange={onTo} label={`${legend} — fin`} />
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </fieldset>
  )
}

function DateInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <input
      type="date"
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="h-[42px] w-full min-w-0 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#B4761A] focus:ring-2 focus:ring-[#B4761A]/25"
    />
  )
}

/** Saisie en étiquettes : on voit ce qui est réellement enregistré. */
function ChipsField({
  values,
  onChange,
  placeholder = '',
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const additions = normalizeArray(raw.replace(/[;|\n]/g, ','))
    if (!additions.length) return
    onChange(Array.from(new Set([...values, ...additions])))
    setDraft('')
  }

  function removeAt(index: number) {
    onChange(values.filter((_, position) => position !== index))
  }

  return (
    <div className="rounded-xl border border-[#D8D3C8] bg-white p-2 transition focus-within:border-[#B4761A] focus-within:ring-2 focus-within:ring-[#B4761A]/25">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#EDEAE3] py-1 pl-2.5 pr-1.5 font-mono text-xs font-semibold text-slate-700"
          >
            {value}
            <button
              type="button"
              onClick={() => removeAt(index)}
              className="rounded text-slate-500 transition hover:text-[#A32C2C]"
              aria-label={`Retirer ${value}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => {
            const raw = event.target.value
            if (/[;,|]/.test(raw)) commit(raw)
            else setDraft(raw)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(draft)
            }
            if (event.key === 'Backspace' && !draft && values.length) removeAt(values.length - 1)
          }}
          onBlur={() => commit(draft)}
          placeholder={values.length ? '' : placeholder}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1.5 py-1 font-mono text-sm outline-none placeholder:font-sans placeholder:text-slate-400"
        />
      </div>
    </div>
  )
}

function PrimaryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-[#111820] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#25313D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function SecondaryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-[#D8D3C8] bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-[#B4761A] hover:text-[#8A5A11] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function DangerButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-[#E2B4B4] bg-white px-4 py-2.5 text-sm font-semibold text-[#A32C2C] transition hover:border-[#A32C2C] hover:bg-[#FBE9E9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A32C2C] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function GhostButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[#D8D3C8] bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#B4761A] hover:text-[#8A5A11] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
