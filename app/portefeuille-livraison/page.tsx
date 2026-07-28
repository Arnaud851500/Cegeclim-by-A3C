'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'
import {
  accessLockedSelectClassName,
  isAllowedByList,
  lockedFilterLabel,
  restrictOptions,
  usePageFilterAccess,
} from '@/lib/pageAccessFilters'

type LignePortefeuille = {
  id: number | string | null
  type_document: string | null
  numero_document: string | null
  numero_tiers: string | null
  nom_tiers: string | null
  date_creation_document: string | null
  date_livraison: string | null
  mois_livraison: string | null
  reference_article: string | null
  designation_article: string | null
  reference: string | null
  famille: string | null
  famille_macro: string | null
  quantite: number | null
  montant_ht: number | null
  client_en_sommeil: boolean | null
  code_representant: string | null
  representant: string | null
  agence: string | null
}

type ControleFraisPort = {
  type_document: string | null
  numero_document: string | null
  numero_tiers: string | null
  nom_tiers: string | null
  date_creation_document: string | null
  date_livraison: string | null
  mois_livraison: string | null
  representant: string | null
  agence: string | null
  client_en_sommeil: boolean | null
  nb_lignes: number | null
  montant_lignes_ht: number | null
  numero_piece_entete: string | null
  reference_entete: string | null
  date_piece_entete: string | null
  date_controle: string | null
  expedition: string | null
  expedition_normalisee: string | null
  depot_entete: string | null
  lieu_livraison: string | null
  lieu_livraison_normalise: string | null
  montant_entete_ht: number | null
  mode_expedition_reference: string | null
  base_calcul_frais_port: string | null
  frais_port_unitaire_attendu_ht: number | null
  frais_port_attendu_ht: number | null
  frais_port_constate_ht: number | null
  ecart_entete_lignes_ht: number | null
  ecart_vs_attendu_ht: number | null
  cle_groupe_frais_port: string | null
  nb_bl_groupe: number | null
  nb_bl_avec_port: number | null
  nb_depots: number | null
  depots: string | null
  agences: string | null
  representants: string | null
  numeros_bl: string | null
  bl_conseille_ajout: string | null
  bl_conseille_conservation: string | null
  frais_port_attendu_groupe_ht: number | null
  frais_port_constate_groupe_ht: number | null
  ecart_groupe_ht: number | null
  nb_bl_a_supprimer: number | null
  montant_a_supprimer_ht: number | null
  montant_a_ajouter_ht: number | null
  nb_actions: number | null
  statut_groupe: string | null
  niveau_alerte: string | null
  action_recommandee: string | null
  montant_action_ht: number | null
  controle_applicable: boolean | null
  frais_port_manquant: boolean | null
  frais_port_a_supprimer: boolean | null
  statut_controle: string | null
}

type GroupeFraisPort = {
  cle_groupe_frais_port: string
  date_controle: string | null
  numero_tiers: string
  nom_tiers: string
  expedition: string
  lieu_livraison: string
  lieu_livraison_normalise: string
  depots: string
  agences: string
  representants: string
  numeros_bl: string
  bl_conseille_ajout: string
  bl_conseille_conservation: string
  date_livraison_min: string | null
  date_livraison_max: string | null
  client_en_sommeil: boolean
  nb_bl: number
  nb_bl_avec_port: number
  nb_depots: number
  frais_port_attendu_groupe_ht: number | null
  frais_port_constate_groupe_ht: number
  ecart_groupe_ht: number
  montant_lignes_groupe_ht: number
  montant_entete_groupe_ht: number
  base_calcul_frais_port: string
  mois_controle: string
  statut_groupe: string
  anomalie_controle: boolean
  frais_port_manquant: boolean
  nb_bl_a_supprimer: number
  montant_a_supprimer_ht: number
  montant_a_ajouter_ht: number
  nb_actions: number
  niveau_alerte: string
}

type DocumentPortefeuille = {
  key: string
  representant: string
  agence: string
  numero_tiers: string
  nom_tiers: string
  type_document: string
  numero_document: string
  nb_lignes: number
  montant_ht: number
  date_creation_document: string | null
  date_livraison: string | null
  mois_livraison: string
  client_en_sommeil: boolean
  familles_macro: string
  references_articles: string
  references: string
  reference_entete: string
  date_controle: string | null
  expedition: string
  depot_entete: string
  lieu_livraison: string
  montant_lignes_controle_ht: number | null
  montant_entete_ht: number | null
  frais_port_constate_ht: number | null
  frais_port_attendu_ht: number | null
  frais_port_attendu_groupe_ht: number | null
  frais_port_constate_groupe_ht: number | null
  ecart_groupe_ht: number | null
  base_calcul_frais_port: string
  cle_groupe_frais_port: string
  nb_bl_groupe: number
  nb_bl_avec_port: number
  nb_bl_a_supprimer: number
  frais_port_manquant: boolean
  frais_port_a_supprimer: boolean
  action_recommandee: string
  montant_action_ht: number
  statut_controle: string
}

type SyntheseControlCell = {
  nb_documents: number
  montant_ht: number
  nb_anomalies: number
  nb_frais_port_manquant: number
  nb_bl_a_supprimer: number
  montant_actions_ht: number
}

type SyntheseRow = {
  key: string
  representant: string
  agence: string
  type_document: string
  byMonth: Record<string, SyntheseControlCell>
  total_nb_documents: number
  total_montant_ht: number
  total_nb_anomalies: number
  total_nb_frais_port_manquant: number
  total_nb_bl_a_supprimer: number
  total_montant_actions_ht: number
}

type DetailSelection = {
  representant?: string
  agence?: string
  type_document?: string
  mois_livraison?: string
  totalType?: 'ligne' | 'colonne' | 'general'
}

type SortConfig<T> = {
  key: keyof T
  direction: 'asc' | 'desc'
} | null

type ControlFilterMode =
  | 'ANOMALIES'
  | 'FRAIS_PORT_MANQUANT'
  | 'FRAIS_PORT_A_SUPPRIMER'
  | 'AUTRES_ANOMALIES'

const DEFAULT_TYPES = ['CDC', 'PL']
const ALL_TYPES = ['CDC', 'PL', 'BL', 'BR']
const ACCESS_LOCKED_AGENCE_VALUE = '__ACCESS_LOCKED_AGENCE__'
const ACCESS_LOCKED_REPRESENTANT_VALUE = '__ACCESS_LOCKED_REPRESENTANT__'

const CONTROL_QUERY_MAX_ATTEMPTS = 3
const CONTROL_QUERY_RETRY_DELAYS_MS = [0, 1200, 3000]
const STALE_LOAD_ERROR = '__STALE_PORTFOLIO_LOAD__'

// Actions SQL considérées comme anomalies frais de port.
// Utilisées pour le filtrage SQL direct sur les vues de contrôle — évite le
// scan complet de l'historique sans avoir besoin d'une borne de date.
const ANOMALY_ACTIONS = ['AJOUTER', 'SUPPRIMER', 'VERIFIER'] as const

const CONTROL_ACTION_SELECT = [
  'type_document',
  'numero_document',
  'numero_tiers',
  'nom_tiers',
  'date_creation_document',
  'date_livraison',
  'mois_livraison',
  'representant',
  'agence',
  'client_en_sommeil',
  'nb_lignes',
  'montant_lignes_ht',
  'reference_entete',
  'date_controle',
  'expedition',
  'depot_entete',
  'lieu_livraison',
  'montant_entete_ht',
  'base_calcul_frais_port',
  'frais_port_attendu_ht',
  'frais_port_constate_ht',
  'cle_groupe_frais_port',
  'nb_bl_groupe',
  'nb_bl_avec_port',
  'frais_port_attendu_groupe_ht',
  'frais_port_constate_groupe_ht',
  'ecart_groupe_ht',
  'nb_bl_a_supprimer',
  'action_recommandee',
  'montant_action_ht',
  'controle_applicable',
  'frais_port_manquant',
  'frais_port_a_supprimer',
  'statut_controle',
].join(',')

function getYesterdayIsoDate() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCurrentMonthKey() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}


function isMonthBeforeCurrent(month: string, currentMonthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return false
  return month < currentMonthKey
}

function getSummaryHeaderClassName(month: string, currentMonthKey: string) {
  const base =
    'whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-2 py-2 text-right'
  if (month === 'AVANT_2026') return `${base} bg-red-100 text-red-950 hover:bg-red-200`
  if (isMonthBeforeCurrent(month, currentMonthKey)) return `${base} bg-orange-100 text-orange-950 hover:bg-orange-200`
  return `${base} hover:bg-slate-200`
}

function getSummaryCellClassName(month: string, hasValue: boolean, currentMonthKey: string) {
  const base = 'border-b border-r border-slate-200 px-2 py-2 text-right'
  if (month === 'AVANT_2026') return [base, 'bg-red-50', hasValue ? 'cursor-pointer text-red-950 hover:bg-red-100' : 'text-red-200'].join(' ')
  if (isMonthBeforeCurrent(month, currentMonthKey)) return [base, 'bg-orange-50', hasValue ? 'cursor-pointer text-orange-950 hover:bg-orange-100' : 'text-orange-200'].join(' ')
  return [base, hasValue ? 'cursor-pointer hover:bg-blue-50' : 'text-slate-300'].join(' ')
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value || 0))
}

function formatMoneyCompact(value: number | null | undefined) {
  const amount = Number(value || 0)
  if (Math.abs(amount) >= 1000000) return `${(amount / 1000000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k€`
  return formatMoney(amount)
}

function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR')
}

function safeText(value: string | null | undefined, fallback = 'Non renseigné') {
  const clean = String(value || '').trim()
  return clean || fallback
}

function docKey(row: LignePortefeuille) {
  return [safeText(row.type_document, ''), safeText(row.numero_document, ''), safeText(row.numero_tiers, '')].join('::')
}

function controlDocKey(row: ControleFraisPort) {
  return [safeText(row.type_document, ''), safeText(row.numero_document, ''), safeText(row.numero_tiers, '')].join('::')
}

function formatMoneyCents(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
}

const MULTI_DEPOT_VALIDATED_STATUS = 'MULTI_DEPOT_A_VALIDER'

function normalizedControlStatus(status: string | null | undefined) {
  const cleanStatus = String(status || '').trim()
  return cleanStatus === MULTI_DEPOT_VALIDATED_STATUS ? 'OK' : cleanStatus
}

function normalizeControlRow(row: ControleFraisPort): ControleFraisPort {
  if (String(row.statut_controle || '').trim() !== MULTI_DEPOT_VALIDATED_STATUS) return row
  return { ...row, statut_controle: 'OK', action_recommandee: 'AUCUNE_ACTION', montant_action_ht: 0, controle_applicable: true, frais_port_manquant: false, frais_port_a_supprimer: false, niveau_alerte: 'OK' }
}

function normalizeControlGroup(row: GroupeFraisPort): GroupeFraisPort {
  if (String(row.statut_groupe || '').trim() !== MULTI_DEPOT_VALIDATED_STATUS) return row
  return { ...row, statut_groupe: 'OK', anomalie_controle: false, nb_actions: 0, montant_a_supprimer_ht: 0, montant_a_ajouter_ht: 0, niveau_alerte: 'OK' }
}

function controlStatusLabel(status: string) {
  const normalizedStatus = normalizedControlStatus(status)
  const labels: Record<string, string> = {
    OK: 'OK', FRAIS_PORT_MANQUANT: 'Port manquant', FRAIS_PORT_EN_DOUBLE: 'Port en double',
    FRAIS_COMPTOIR_A_SUPPRIMER: 'Port comptoir à supprimer', FRAIS_PORT_REPARTI_A_REGROUPER: 'Port réparti à regrouper',
    MONTANT_FRAIS_PORT_A_VERIFIER: 'Montant à vérifier', LIEU_LIVRAISON_A_COMPLETER: 'Lieu à compléter',
    DATE_BL_ABSENTE: 'Date BL absente', TIERS_ABSENT: 'Tiers absent', ENTETE_ABSENTE: 'Entête absente',
    MODE_EXPEDITION_ABSENT: 'Mode absent', MODE_EXPEDITION_INCONNU: 'Mode inconnu',
    PL_A_CONFIRMER: 'PL à confirmer', NON_APPLICABLE: 'Non applicable', NON_CONTROLE: 'Non contrôlé',
  }
  return labels[normalizedStatus] || normalizedStatus || 'Non contrôlé'
}

function actionLabel(action: string) {
  const labels: Record<string, string> = { AJOUTER: 'Ajouter le port', SUPPRIMER: 'Supprimer le port', CONSERVER: 'Conserver le port', VERIFIER: 'Vérifier le groupe', AUCUNE_ACTION: 'Aucune action' }
  return labels[action] || action || 'Aucune action'
}

function isControlAnomaly(status: string) {
  const normalizedStatus = normalizedControlStatus(status)
  return Boolean(normalizedStatus) && !['OK', 'PL_A_CONFIRMER', 'NON_APPLICABLE', 'NON_CONTROLE'].includes(normalizedStatus)
}

function isDirectControlAction(action: string) {
  return ['AJOUTER', 'SUPPRIMER', 'VERIFIER'].includes(action)
}

function controlStatusClassName(status: string) {
  const normalizedStatus = normalizedControlStatus(status)
  if (normalizedStatus === 'OK') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (normalizedStatus === 'FRAIS_PORT_MANQUANT') return 'border-red-300 bg-red-100 text-red-900'
  if (['FRAIS_PORT_EN_DOUBLE', 'FRAIS_COMPTOIR_A_SUPPRIMER'].includes(normalizedStatus)) return 'border-rose-300 bg-rose-100 text-rose-900'
  if (['ENTETE_ABSENTE', 'MODE_EXPEDITION_ABSENT', 'MODE_EXPEDITION_INCONNU', 'DATE_BL_ABSENTE', 'TIERS_ABSENT', 'LIEU_LIVRAISON_A_COMPLETER'].includes(normalizedStatus)) return 'border-orange-300 bg-orange-100 text-orange-900'
  if (normalizedStatus === 'PL_A_CONFIRMER' || normalizedStatus === 'NON_APPLICABLE' || normalizedStatus === 'NON_CONTROLE') return 'border-slate-200 bg-slate-100 text-slate-700'
  return 'border-amber-300 bg-amber-100 text-amber-900'
}

function actionClassName(action: string) {
  if (action === 'AJOUTER') return 'border-red-300 bg-red-100 text-red-900'
  if (action === 'SUPPRIMER') return 'border-rose-300 bg-rose-100 text-rose-900'
  if (action === 'CONSERVER') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (action === 'VERIFIER') return 'border-amber-300 bg-amber-100 text-amber-900'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function scopeTextMatchesAllowed(value: string | null | undefined, allowed: string[]) {
  if (!allowed.length) return true
  const normalizedValue = String(value || '').toLowerCase()
  return allowed.some((item) => normalizedValue.includes(String(item || '').trim().toLowerCase()))
}

function sortValues(a: unknown, b: unknown) {
  const va = a === null || a === undefined ? '' : a
  const vb = b === null || b === undefined ? '' : b
  if (typeof va === 'number' && typeof vb === 'number') return va - vb
  return String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' })
}

function sortArray<T>(rows: T[], config: SortConfig<T>) {
  if (!config) return rows
  return [...rows].sort((a, b) => {
    const result = sortValues(a[config.key], b[config.key])
    return config.direction === 'asc' ? result : -result
  })
}

function monthLabel(month: string) {
  if (month === 'AVANT_2026') return 'Avant 2026'
  if (month === 'SANS_DATE_LIVRAISON') return 'Sans date livraison'
  return month
}

function formatLoadError(error: unknown) {
  if (!error) return 'Erreur inconnue lors du chargement du portefeuille.'
  if (error instanceof Error) return error.message
  if (typeof error === 'object') {
    const err = error as Record<string, unknown>
    const parts = [err.message, err.details, err.hint, err.code].map((v) => String(v || '').trim()).filter(Boolean)
    if (parts.length > 0) return parts.join(' · ')
  }
  return String(error) || 'Erreur inconnue lors du chargement du portefeuille.'
}

function isStatementTimeoutError(error: unknown) {
  if (!error) return false
  const err = error as Record<string, unknown>
  const code = String(err?.code || '').trim()
  const message = formatLoadError(error).toLowerCase()
  return code === '57014' || message.includes('statement timeout') || message.includes('canceling statement') || message.includes('cancelling statement') || message.includes('query timeout')
}

function isStaleLoadError(error: unknown) {
  return error instanceof Error && error.message === STALE_LOAD_ERROR
}

function waitForRetry(delayMs: number) {
  return new Promise<void>((resolve) => { window.setTimeout(resolve, delayMs) })
}

async function runControlQueryWithRetry<T>(label: string, operation: () => Promise<T>, isCurrentLoad: () => boolean) {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= CONTROL_QUERY_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrentLoad()) throw new Error(STALE_LOAD_ERROR)
    const delayMs = CONTROL_QUERY_RETRY_DELAYS_MS[attempt - 1] || 0
    if (delayMs > 0) { await waitForRetry(delayMs); if (!isCurrentLoad()) throw new Error(STALE_LOAD_ERROR) }
    try { return await operation() } catch (error) {
      lastError = error
      if (!isStatementTimeoutError(error) || attempt >= CONTROL_QUERY_MAX_ATTEMPTS) throw error
      console.warn(`Portefeuille livraison - ${label} en timeout, nouvelle tentative ${attempt + 1}/${CONTROL_QUERY_MAX_ATTEMPTS}`, error)
    }
  }
  throw lastError
}

export default function PortefeuilleLivraisonPage() {
  const currentMonthKey = useMemo(() => getCurrentMonthKey(), [])
  const access = usePageFilterAccess()
  const loadRequestIdRef = useRef(0)

  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [controlErrorMessage, setControlErrorMessage] = useState<string | null>(null)

  const [lignes, setLignes] = useState<LignePortefeuille[]>([])
  const [controlesFraisPort, setControlesFraisPort] = useState<ControleFraisPort[]>([])
  const [groupesFraisPort, setGroupesFraisPort] = useState<GroupeFraisPort[]>([])

  const [selectedTypes, setSelectedTypes] = useState<string[]>(DEFAULT_TYPES)

  const [dateCreationDebut, setDateCreationDebut] = useState('')
  const [dateCreationFin, setDateCreationFin] = useState('')
  const [dateLivraisonDebut, setDateLivraisonDebut] = useState('')
  const [dateLivraisonFin, setDateLivraisonFin] = useState(() => getYesterdayIsoDate())
  const [dateLivraisonFinModifiee, setDateLivraisonFinModifiee] = useState(false)

  const [selectedRepresentant, setSelectedRepresentant] = useState('')
  const [selectedAgence, setSelectedAgence] = useState('')
  const [selectedFamilleMacro, setSelectedFamilleMacro] = useState('')
  const [selectedSommeil, setSelectedSommeil] = useState<'TOUS' | 'OUI' | 'NON'>('TOUS')
  const [selectedControle, setSelectedControle] = useState('TOUS')
  const [selectedExpedition, setSelectedExpedition] = useState('')
  const [selectedDepotEntete, setSelectedDepotEntete] = useState('')
  const [referenceEnteteSearch, setReferenceEnteteSearch] = useState('')
  const [lieuLivraisonSearch, setLieuLivraisonSearch] = useState('')
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)

  const isBlSelected = selectedTypes.includes('BL')
  const dateLivraisonFinControle = dateLivraisonFinModifiee ? dateLivraisonFin : ''

  const [selection, setSelection] = useState<DetailSelection | null>(null)
  const [selectedDocumentKeyForLines, setSelectedDocumentKeyForLines] = useState<string | null>(null)

  const [documentSort, setDocumentSort] = useState<SortConfig<DocumentPortefeuille>>({ key: 'agence', direction: 'asc' })
  const [groupSort, setGroupSort] = useState<SortConfig<GroupeFraisPort>>({ key: 'date_controle', direction: 'desc' })
  const [ligneSort, setLigneSort] = useState<SortConfig<LignePortefeuille>>({ key: 'agence', direction: 'asc' })

  function applyDetailSelection(nextSelection: DetailSelection | null) {
    setSelection(nextSelection)
    setSelectedDocumentKeyForLines(null)
  }

  function openBlControl(mode: ControlFilterMode) {
    setSelectedTypes(['BL'])
    setDateLivraisonFin('')
    setDateLivraisonFinModifiee(false)
    setSelectedControle(mode)
    setSelectedGroupKey(null)
    setSelection(null)
    setSelectedDocumentKeyForLines(null)
  }

  useEffect(() => {
    function applyControlFilter(mode: ControlFilterMode) {
      setSelectedTypes(['BL'])
      setDateLivraisonFin('')
      setDateLivraisonFinModifiee(false)
      setSelectedControle(mode)
      setSelectedGroupKey(null)
      setSelection(null)
      setSelectedDocumentKeyForLines(null)
    }

    function applyControlFromUrl() {
      const params = new URLSearchParams(window.location.search)
      const requestedControl = String(params.get('controle') || '').trim().toLowerCase().replace(/_/g, '-')
      if (requestedControl === 'frais-port-manquant') applyControlFilter('FRAIS_PORT_MANQUANT')
      if (requestedControl === 'frais-port-a-supprimer') applyControlFilter('FRAIS_PORT_A_SUPPRIMER')
      if (requestedControl === 'controle-frais-port' || requestedControl === 'anomalies-frais-port') applyControlFilter('ANOMALIES')
    }

    function handleOpenControl() { applyControlFilter('ANOMALIES') }
    function handleOpenMissingPort() { applyControlFilter('FRAIS_PORT_MANQUANT') }

    applyControlFromUrl()
    window.addEventListener('popstate', applyControlFromUrl)
    window.addEventListener('cegeclim:open-controle-frais-port', handleOpenControl)
    window.addEventListener('cegeclim:open-frais-port-manquant', handleOpenMissingPort)
    return () => {
      window.removeEventListener('popstate', applyControlFromUrl)
      window.removeEventListener('cegeclim:open-controle-frais-port', handleOpenControl)
      window.removeEventListener('cegeclim:open-frais-port-manquant', handleOpenMissingPort)
    }
  }, [])

  async function loadData() {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const isCurrentLoad = () => loadRequestIdRef.current === requestId

    setLoading(true)
    setErrorMessage(null)
    setControlErrorMessage(null)

    try {
      let query = supabase
        .from('v_portefeuille_livraison_lignes')
        .select('*')
        .in('type_document', selectedTypes.length ? selectedTypes : DEFAULT_TYPES)
        .order('agence', { ascending: true, nullsFirst: true })
        .order('representant', { ascending: true, nullsFirst: true })
        .order('date_livraison', { ascending: true, nullsFirst: true })

      if (dateCreationDebut) query = query.gte('date_creation_document', dateCreationDebut)
      if (dateCreationFin) query = query.lte('date_creation_document', dateCreationFin)
      if (dateLivraisonDebut) query = query.gte('date_livraison', dateLivraisonDebut)
      if (dateLivraisonFin) query = query.lte('date_livraison', dateLivraisonFin)

      if (access.allowedCollaborateurs.length > 0) query = query.in('representant', access.allowedCollaborateurs)
      else if (selectedRepresentant) query = query.eq('representant', selectedRepresentant)

      if (access.allowedAgences.length > 0) query = query.in('agence', access.allowedAgences)
      else if (selectedAgence) query = query.eq('agence', selectedAgence)

      if (selectedFamilleMacro) query = query.eq('famille_macro', selectedFamilleMacro)
      if (selectedSommeil === 'OUI') query = query.eq('client_en_sommeil', true)
      if (selectedSommeil === 'NON') query = query.or('client_en_sommeil.is.false,client_en_sommeil.is.null')

      const { data, error } = await query.limit(50000)
      if (error) throw error
      if (!isCurrentLoad()) return

      const rows = ((data || []) as LignePortefeuille[]).filter((row) =>
        isAllowedByList(row.representant, access.allowedCollaborateurs) &&
        isAllowedByList(row.agence, access.allowedAgences)
      )
      setLignes(rows)
      setSelection(null)
      setSelectedDocumentKeyForLines(null)

      if (!isBlSelected) {
        setControlesFraisPort([])
        setGroupesFraisPort([])
        setControlErrorMessage(null)
        return
      }

      // ── Stratégie de filtrage des vues de contrôle ─────────────────────────
      // Les vues de contrôle (actions + groupes) couvrent tout l'historique.
      // Sans filtre sur le statut, elles scannent des dizaines de milliers de
      // lignes OK pour n'en retourner que quelques centaines — d'où les timeouts.
      //
      // Solution : pousser le filtre d'anomalie directement dans la requête SQL.
      // • En mode "Toutes anomalies" → .in('action_recommandee', ANOMALY_ACTIONS)
      // • En mode ciblé (manquant / à supprimer / autres) → filtre plus précis
      // • En mode "Tous les statuts" → on garde le fallback de date pour ne pas
      //   tout charger ; dans ce cas l'utilisateur doit saisir des dates lui-même.
      //
      // Résultat : les requêtes ne ramènent que les BL utiles, quelle que soit
      // la profondeur historique, sans borne de date artificielle.
      // ───────────────────────────────────────────────────────────────────────
      const isAnomalyMode = ['ANOMALIES', 'FRAIS_PORT_MANQUANT', 'FRAIS_PORT_A_SUPPRIMER', 'AUTRES_ANOMALIES'].includes(selectedControle)

      let controlRowsLoaded = false
      let groupRowsLoaded = false

      try {
        const controlData = await runControlQueryWithRetry<ControleFraisPort[]>(
          'actions frais de port',
          async () => {
            let controlQuery = supabase
              .from('v_controle_frais_port_actions')
              .select(CONTROL_ACTION_SELECT)
              .eq('type_document', 'BL')

            // Filtre SQL sur le statut d'anomalie — remplace la borne de date artificielle.
            // En mode anomalie, seules les lignes actionnables sont chargées.
            if (selectedControle === 'FRAIS_PORT_MANQUANT') {
              controlQuery = controlQuery.eq('action_recommandee', 'AJOUTER')
            } else if (selectedControle === 'FRAIS_PORT_A_SUPPRIMER') {
              controlQuery = controlQuery.eq('action_recommandee', 'SUPPRIMER')
            } else if (selectedControle === 'AUTRES_ANOMALIES') {
              controlQuery = controlQuery.eq('action_recommandee', 'VERIFIER')
            } else if (selectedControle === 'ANOMALIES') {
              controlQuery = controlQuery.in('action_recommandee', [...ANOMALY_ACTIONS])
            }
            // En mode "Tous les statuts" ou statut spécifique : on applique les dates
            // saisies par l'utilisateur comme bornes — sans fallback artificiel.
            if (!isAnomalyMode) {
              if (dateCreationDebut) controlQuery = controlQuery.gte('date_controle', dateCreationDebut)
              if (dateCreationFin) controlQuery = controlQuery.lte('date_controle', dateCreationFin)
              if (dateLivraisonDebut) controlQuery = controlQuery.gte('date_livraison', dateLivraisonDebut)
              if (dateLivraisonFinControle) controlQuery = controlQuery.lte('date_livraison', dateLivraisonFinControle)
            } else {
              // En mode anomalie, on applique quand même les dates si l'utilisateur en a saisi.
              if (dateCreationDebut) controlQuery = controlQuery.gte('date_controle', dateCreationDebut)
              if (dateCreationFin) controlQuery = controlQuery.lte('date_controle', dateCreationFin)
              if (dateLivraisonDebut) controlQuery = controlQuery.gte('date_livraison', dateLivraisonDebut)
              if (dateLivraisonFinControle) controlQuery = controlQuery.lte('date_livraison', dateLivraisonFinControle)
            }

            if (access.allowedCollaborateurs.length > 0) controlQuery = controlQuery.in('representant', access.allowedCollaborateurs)
            else if (selectedRepresentant) controlQuery = controlQuery.eq('representant', selectedRepresentant)

            if (access.allowedAgences.length > 0) controlQuery = controlQuery.in('agence', access.allowedAgences)
            else if (selectedAgence) controlQuery = controlQuery.eq('agence', selectedAgence)

            if (selectedSommeil === 'OUI') controlQuery = controlQuery.eq('client_en_sommeil', true)
            if (selectedSommeil === 'NON') controlQuery = controlQuery.or('client_en_sommeil.is.false,client_en_sommeil.is.null')

            const response = await controlQuery.limit(50000)
            if (response.error) throw response.error
            return (response.data ?? []) as unknown as ControleFraisPort[]
          },
          isCurrentLoad,
        )

        if (!isCurrentLoad()) return

        const controlRows = controlData
          .map(normalizeControlRow)
          .filter((row) =>
            isAllowedByList(row.representant, access.allowedCollaborateurs) &&
            isAllowedByList(row.agence, access.allowedAgences)
          )
        setControlesFraisPort(controlRows)
        controlRowsLoaded = true

        const groupData = await runControlQueryWithRetry<GroupeFraisPort[]>(
          'groupes frais de port',
          async () => {
            let groupQuery = supabase
              .from('v_controle_frais_port_groupes')
              .select('*')

            // Même logique côté groupes : filtre SQL sur l'anomalie en priorité.
            if (selectedControle === 'FRAIS_PORT_MANQUANT') {
              groupQuery = groupQuery.eq('statut_groupe', 'FRAIS_PORT_MANQUANT')
            } else if (selectedControle === 'FRAIS_PORT_A_SUPPRIMER') {
              groupQuery = groupQuery.gt('nb_bl_a_supprimer', 0)
            } else if (selectedControle === 'ANOMALIES' || selectedControle === 'AUTRES_ANOMALIES') {
              groupQuery = groupQuery.eq('anomalie_controle', true)
            }

            if (dateCreationDebut) groupQuery = groupQuery.gte('date_controle', dateCreationDebut)
            if (dateCreationFin) groupQuery = groupQuery.lte('date_controle', dateCreationFin)
            if (dateLivraisonDebut) groupQuery = groupQuery.gte('date_livraison_max', dateLivraisonDebut)
            if (dateLivraisonFinControle) groupQuery = groupQuery.lte('date_livraison_min', dateLivraisonFinControle)

            if (selectedSommeil === 'OUI') groupQuery = groupQuery.eq('client_en_sommeil', true)
            if (selectedSommeil === 'NON') groupQuery = groupQuery.eq('client_en_sommeil', false)

            if (!access.allowedAgences.length && selectedAgence) groupQuery = groupQuery.ilike('agences', `%${selectedAgence}%`)
            if (!access.allowedCollaborateurs.length && selectedRepresentant) groupQuery = groupQuery.ilike('representants', `%${selectedRepresentant}%`)

            const response = await groupQuery.limit(20000)
            if (response.error) throw response.error
            return (response.data ?? []) as unknown as GroupeFraisPort[]
          },
          isCurrentLoad,
        )

        if (!isCurrentLoad()) return

        const groupRows = groupData
          .map(normalizeControlGroup)
          .filter((row) => {
            const accessAgenceOk = scopeTextMatchesAllowed(row.agences, access.allowedAgences)
            const accessRepresentantOk = scopeTextMatchesAllowed(row.representants, access.allowedCollaborateurs)
            const selectedAgenceOk = !selectedAgence || scopeTextMatchesAllowed(row.agences, [selectedAgence])
            const selectedRepresentantOk = !selectedRepresentant || scopeTextMatchesAllowed(row.representants, [selectedRepresentant])
            return accessAgenceOk && accessRepresentantOk && selectedAgenceOk && selectedRepresentantOk
          })

        setGroupesFraisPort(groupRows)
        groupRowsLoaded = true
        setControlErrorMessage(null)
      } catch (controlError) {
        if (!isCurrentLoad() || isStaleLoadError(controlError)) return
        console.error('Portefeuille livraison - contrôle frais de port', controlError)

        if (!controlRowsLoaded) setControlesFraisPort([])
        if (!groupRowsLoaded) setGroupesFraisPort([])

        const retrySuffix = isStatementTimeoutError(controlError)
          ? ` après ${CONTROL_QUERY_MAX_ATTEMPTS} tentatives automatiques`
          : ''

        setControlErrorMessage(
          `Le portefeuille est chargé, mais le contrôle frais de port reste indisponible${retrySuffix} : ${formatLoadError(controlError)}`
        )
      }
    } catch (error) {
      if (!isCurrentLoad() || isStaleLoadError(error)) return
      console.error('Portefeuille livraison - erreur chargement', error)
      setLignes([])
      setControlesFraisPort([])
      setGroupesFraisPort([])
      setSelection(null)
      setSelectedDocumentKeyForLines(null)
      setErrorMessage(formatLoadError(error))
    } finally {
      if (isCurrentLoad()) setLoading(false)
    }
  }

  useEffect(() => {
    if (access.hasCollaborateurRestriction) setSelectedRepresentant('')
    if (access.hasAgenceRestriction) setSelectedAgence('')
  }, [access.hasCollaborateurRestriction, access.hasAgenceRestriction])

  useEffect(() => {
    if (access.loading) return
    const timer = window.setTimeout(() => { void loadData() }, 150)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    access.allowedCollaborateurs.join('|'),
    access.allowedAgences.join('|'),
    selectedTypes.join('|'),
    dateCreationDebut,
    dateCreationFin,
    dateLivraisonDebut,
    dateLivraisonFin,
    dateLivraisonFinModifiee,
    selectedRepresentant,
    selectedAgence,
    selectedFamilleMacro,
    selectedSommeil,
  ])

  const documents = useMemo<DocumentPortefeuille[]>(() => {
    const controlByKey = new Map<string, ControleFraisPort>(controlesFraisPort.map((row) => [controlDocKey(row), row]))
    const map = new Map<string, DocumentPortefeuille & { famillesSet: Set<string>; referencesArticlesSet: Set<string>; referencesSet: Set<string> }>()

    for (const ligne of lignes) {
      const key = docKey(ligne)
      const existing = map.get(key)
      const familleMacro = safeText(ligne.famille_macro, 'Sans famille macro')
      const referenceArticle = safeText(ligne.reference_article, '')
      const reference = safeText(ligne.reference, '')

      if (!existing) {
        map.set(key, {
          key, representant: safeText(ligne.representant, 'Sans représentant'), agence: safeText(ligne.agence, 'Sans agence'),
          numero_tiers: safeText(ligne.numero_tiers, ''), nom_tiers: safeText(ligne.nom_tiers, ''),
          type_document: safeText(ligne.type_document, ''), numero_document: safeText(ligne.numero_document, ''),
          nb_lignes: 1, montant_ht: Number(ligne.montant_ht || 0),
          date_creation_document: ligne.date_creation_document, date_livraison: ligne.date_livraison,
          mois_livraison: ligne.mois_livraison || 'SANS_DATE_LIVRAISON', client_en_sommeil: Boolean(ligne.client_en_sommeil),
          familles_macro: familleMacro, references_articles: referenceArticle, references: reference,
          reference_entete: safeText(controlByKey.get(key)?.reference_entete, ''),
          date_controle: controlByKey.get(key)?.date_controle ?? ligne.date_creation_document,
          expedition: safeText(controlByKey.get(key)?.expedition, ''),
          depot_entete: safeText(controlByKey.get(key)?.depot_entete, ''),
          lieu_livraison: safeText(controlByKey.get(key)?.lieu_livraison, ''),
          montant_lignes_controle_ht: controlByKey.get(key)?.montant_lignes_ht ?? null,
          montant_entete_ht: controlByKey.get(key)?.montant_entete_ht ?? null,
          frais_port_constate_ht: controlByKey.get(key)?.frais_port_constate_ht ?? null,
          frais_port_attendu_ht: controlByKey.get(key)?.frais_port_attendu_ht ?? null,
          frais_port_attendu_groupe_ht: controlByKey.get(key)?.frais_port_attendu_groupe_ht ?? null,
          frais_port_constate_groupe_ht: controlByKey.get(key)?.frais_port_constate_groupe_ht ?? null,
          ecart_groupe_ht: controlByKey.get(key)?.ecart_groupe_ht ?? null,
          base_calcul_frais_port: safeText(controlByKey.get(key)?.base_calcul_frais_port, ''),
          cle_groupe_frais_port: safeText(controlByKey.get(key)?.cle_groupe_frais_port, ''),
          nb_bl_groupe: Number(controlByKey.get(key)?.nb_bl_groupe || 0),
          nb_bl_avec_port: Number(controlByKey.get(key)?.nb_bl_avec_port || 0),
          nb_bl_a_supprimer: Number(controlByKey.get(key)?.nb_bl_a_supprimer || 0),
          frais_port_manquant: Boolean(controlByKey.get(key)?.frais_port_manquant),
          frais_port_a_supprimer: Boolean(controlByKey.get(key)?.frais_port_a_supprimer),
          action_recommandee: safeText(controlByKey.get(key)?.action_recommandee, 'AUCUNE_ACTION'),
          montant_action_ht: Number(controlByKey.get(key)?.montant_action_ht || 0),
          statut_controle: safeText(controlByKey.get(key)?.statut_controle, 'NON_CONTROLE'),
          famillesSet: new Set(familleMacro ? [familleMacro] : []),
          referencesArticlesSet: new Set(referenceArticle ? [referenceArticle] : []),
          referencesSet: new Set(reference ? [reference] : []),
        })
      } else {
        existing.nb_lignes += 1
        existing.montant_ht += Number(ligne.montant_ht || 0)
        if (familleMacro) existing.famillesSet.add(familleMacro)
        if (referenceArticle) existing.referencesArticlesSet.add(referenceArticle)
        if (reference) existing.referencesSet.add(reference)
        existing.familles_macro = Array.from(existing.famillesSet).sort().join(', ')
        existing.references_articles = Array.from(existing.referencesArticlesSet).sort().join(', ')
        existing.references = Array.from(existing.referencesSet).sort().join(', ')
      }
    }
    return Array.from(map.values()).map(({ famillesSet, referencesArticlesSet, referencesSet, ...doc }) => doc)
  }, [lignes, controlesFraisPort])

  const expeditions = useMemo<string[]>(() =>
    Array.from(new Set<string>([...documents.map((doc) => doc.expedition), ...groupesFraisPort.map((group) => group.expedition)].filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b, 'fr')),
  [documents, groupesFraisPort])

  const depotsEntete = useMemo<string[]>(() =>
    Array.from(new Set<string>([...documents.map((doc) => doc.depot_entete), ...groupesFraisPort.flatMap((group) => String(group.depots || '').split(',').map((v) => v.trim()))].filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b, 'fr')),
  [documents, groupesFraisPort])

  const groupesFiltresControle = useMemo(() => {
    const lieuSearch = lieuLivraisonSearch.trim().toLowerCase()
    return groupesFraisPort.filter((group) => {
      if (selectedControle === 'FRAIS_PORT_MANQUANT' && group.statut_groupe !== 'FRAIS_PORT_MANQUANT') return false
      if (selectedControle === 'FRAIS_PORT_A_SUPPRIMER' && group.nb_bl_a_supprimer <= 0) return false
      if (selectedControle === 'AUTRES_ANOMALIES' && (!isControlAnomaly(group.statut_groupe) || group.statut_groupe === 'FRAIS_PORT_MANQUANT' || group.nb_bl_a_supprimer > 0)) return false
      if (selectedControle === 'ANOMALIES' && !isControlAnomaly(group.statut_groupe)) return false
      if (!['TOUS', 'ANOMALIES', 'FRAIS_PORT_MANQUANT', 'FRAIS_PORT_A_SUPPRIMER', 'AUTRES_ANOMALIES'].includes(selectedControle) && group.statut_groupe !== selectedControle) return false
      if (selectedExpedition && group.expedition !== selectedExpedition) return false
      if (selectedDepotEntete && !scopeTextMatchesAllowed(group.depots, [selectedDepotEntete])) return false
      if (lieuSearch && !group.lieu_livraison.toLowerCase().includes(lieuSearch)) return false
      return true
    })
  }, [groupesFraisPort, selectedControle, selectedExpedition, selectedDepotEntete, lieuLivraisonSearch])

  const sortedGroupesFraisPort = useMemo(() => sortArray(groupesFiltresControle, groupSort), [groupesFiltresControle, groupSort])

  const documentsFiltresControle = useMemo(() => {
    const referenceSearch = referenceEnteteSearch.trim().toLowerCase()
    const lieuSearch = lieuLivraisonSearch.trim().toLowerCase()
    return documents.filter((doc) => {
      if (selectedGroupKey && doc.cle_groupe_frais_port !== selectedGroupKey) return false
      if (selectedControle === 'FRAIS_PORT_MANQUANT' && doc.action_recommandee !== 'AJOUTER') return false
      if (selectedControle === 'FRAIS_PORT_A_SUPPRIMER' && doc.action_recommandee !== 'SUPPRIMER') return false
      if (selectedControle === 'AUTRES_ANOMALIES' && doc.action_recommandee !== 'VERIFIER') return false
      if (selectedControle === 'ANOMALIES' && !isDirectControlAction(doc.action_recommandee)) return false
      if (!['TOUS', 'ANOMALIES', 'FRAIS_PORT_MANQUANT', 'FRAIS_PORT_A_SUPPRIMER', 'AUTRES_ANOMALIES'].includes(selectedControle) && doc.statut_controle !== selectedControle) return false
      if (selectedExpedition && doc.expedition !== selectedExpedition) return false
      if (selectedDepotEntete && doc.depot_entete !== selectedDepotEntete) return false
      if (referenceSearch && !doc.reference_entete.toLowerCase().includes(referenceSearch)) return false
      if (lieuSearch && !doc.lieu_livraison.toLowerCase().includes(lieuSearch)) return false
      return true
    })
  }, [documents, selectedGroupKey, selectedControle, selectedExpedition, selectedDepotEntete, referenceEnteteSearch, lieuLivraisonSearch])

  const moisLivraison = useMemo(() => {
    const set = new Set<string>()
    for (const doc of documentsFiltresControle) set.add(doc.mois_livraison || 'SANS_DATE_LIVRAISON')
    return Array.from(set).sort((a, b) => {
      if (a === 'AVANT_2026') return -1; if (b === 'AVANT_2026') return 1
      if (a === 'SANS_DATE_LIVRAISON') return -1; if (b === 'SANS_DATE_LIVRAISON') return 1
      return a.localeCompare(b)
    })
  }, [documentsFiltresControle])

  const synthese = useMemo<SyntheseRow[]>(() => {
    const map = new Map<string, SyntheseRow>()
    for (const doc of documentsFiltresControle) {
      const key = [doc.representant, doc.agence, doc.type_document].join('::')
      const mois = doc.mois_livraison || 'SANS_DATE_LIVRAISON'
      if (!map.has(key)) map.set(key, { key, representant: doc.representant, agence: doc.agence, type_document: doc.type_document, byMonth: {}, total_nb_documents: 0, total_montant_ht: 0, total_nb_anomalies: 0, total_nb_frais_port_manquant: 0, total_nb_bl_a_supprimer: 0, total_montant_actions_ht: 0 })
      const row = map.get(key)!
      if (!row.byMonth[mois]) row.byMonth[mois] = { nb_documents: 0, montant_ht: 0, nb_anomalies: 0, nb_frais_port_manquant: 0, nb_bl_a_supprimer: 0, montant_actions_ht: 0 }
      const isAnomaly = isDirectControlAction(doc.action_recommandee)
      const isMissingPort = doc.action_recommandee === 'AJOUTER'
      const isPortToRemove = doc.action_recommandee === 'SUPPRIMER'
      const actionAmount = Number(doc.montant_action_ht || 0)
      row.byMonth[mois].nb_documents += 1; row.byMonth[mois].montant_ht += doc.montant_ht
      row.byMonth[mois].nb_anomalies += isAnomaly ? 1 : 0; row.byMonth[mois].nb_frais_port_manquant += isMissingPort ? 1 : 0
      row.byMonth[mois].nb_bl_a_supprimer += isPortToRemove ? 1 : 0; row.byMonth[mois].montant_actions_ht += actionAmount
      row.total_nb_documents += 1; row.total_montant_ht += doc.montant_ht
      row.total_nb_anomalies += isAnomaly ? 1 : 0; row.total_nb_frais_port_manquant += isMissingPort ? 1 : 0
      row.total_nb_bl_a_supprimer += isPortToRemove ? 1 : 0; row.total_montant_actions_ht += actionAmount
    }
    return Array.from(map.values()).sort((a, b) => a.agence.localeCompare(b.agence, 'fr') || a.representant.localeCompare(b.representant, 'fr') || a.type_document.localeCompare(b.type_document, 'fr'))
  }, [documentsFiltresControle])

  const representants = useMemo(() => {
    const values = Array.from(new Set(lignes.map((l) => safeText(l.representant, 'Sans représentant')))).sort()
    const restricted = restrictOptions(values, access.allowedCollaborateurs)
    return Array.from(new Set([...access.allowedCollaborateurs, ...restricted])).filter(Boolean).sort()
  }, [lignes, access.allowedCollaborateurs])

  const agences = useMemo(() => {
    const values = Array.from(new Set(lignes.map((l) => safeText(l.agence, 'Sans agence')))).sort()
    const restricted = restrictOptions(values, access.allowedAgences)
    return Array.from(new Set([...access.allowedAgences, ...restricted])).filter(Boolean).sort()
  }, [lignes, access.allowedAgences])

  const isRepresentantLocked = access.hasCollaborateurRestriction
  const isAgenceLocked = access.hasAgenceRestriction

  const representantSelectValue = isRepresentantLocked
    ? access.allowedCollaborateurs.length === 1 ? access.allowedCollaborateurs[0] : ACCESS_LOCKED_REPRESENTANT_VALUE
    : selectedRepresentant

  const agenceSelectValue = isAgenceLocked
    ? access.allowedAgences.length === 1 ? access.allowedAgences[0] : ACCESS_LOCKED_AGENCE_VALUE
    : selectedAgence

  const selectBaseClassName = 'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm'

  useEffect(() => {
    const effectiveAgences = access.allowedAgences.length > 0 ? access.allowedAgences : selectedAgence ? [selectedAgence] : []
    const effectiveCollaborateurs = access.allowedCollaborateurs.length > 0 ? access.allowedCollaborateurs : selectedRepresentant ? [selectedRepresentant] : []
    window.dispatchEvent(new CustomEvent('cegeclim:status-scope-change', { detail: { active: true, agences: effectiveAgences, collaborateurs: effectiveCollaborateurs } }))
    return () => { window.dispatchEvent(new CustomEvent('cegeclim:status-scope-change', { detail: { active: false, agences: [], collaborateurs: [] } })) }
  }, [access.allowedAgences.join('|'), access.allowedCollaborateurs.join('|'), selectedAgence, selectedRepresentant])

  const famillesMacro = useMemo(() => Array.from(new Set(lignes.map((l) => safeText(l.famille_macro, 'Sans famille macro')))).sort(), [lignes])

  const selectedDocuments = useMemo(() => {
    if (!selection) return documentsFiltresControle
    return documentsFiltresControle.filter((doc) => {
      if (selection.totalType === 'general') return true
      if (selection.totalType === 'colonne') return doc.mois_livraison === selection.mois_livraison
      if (selection.totalType === 'ligne') return doc.representant === selection.representant && doc.agence === selection.agence && doc.type_document === selection.type_document
      return doc.representant === selection.representant && doc.agence === selection.agence && doc.type_document === selection.type_document && doc.mois_livraison === selection.mois_livraison
    })
  }, [documentsFiltresControle, selection])

  const selectedDocumentKeys = useMemo(() => new Set(selectedDocuments.map((doc) => doc.key)), [selectedDocuments])

  const selectedDocumentForLines = useMemo(() => {
    if (!selectedDocumentKeyForLines) return null
    return selectedDocuments.find((doc) => doc.key === selectedDocumentKeyForLines) || null
  }, [selectedDocumentKeyForLines, selectedDocuments])

  const selectedLignes = useMemo(() => {
    const keys = selectedDocumentKeyForLines ? new Set([selectedDocumentKeyForLines]) : selectedDocumentKeys
    return lignes.filter((ligne) => keys.has(docKey(ligne)))
  }, [lignes, selectedDocumentKeyForLines, selectedDocumentKeys])

  const sortedDocuments = useMemo(() => sortArray(selectedDocuments, documentSort), [selectedDocuments, documentSort])

  const documentColumns = useMemo<Array<[keyof DocumentPortefeuille, string]>>(() => {
    const generalColumns: Array<[keyof DocumentPortefeuille, string]> = [
      ['agence', 'Agence'], ['representant', 'Représentant'], ['numero_tiers', 'N° tiers'], ['nom_tiers', 'Client'],
      ['numero_document', 'N° document'], ['references', 'Réf. lignes'], ['date_livraison', 'Date livraison'],
      ['familles_macro', 'Familles macro'], ['client_en_sommeil', 'Sommeil'],
    ]
    if (!isBlSelected) return generalColumns
    return [
      ['agence', 'Agence'], ['representant', 'Représentant'], ['date_controle', 'Date BL'], ['numero_tiers', 'N° tiers'],
      ['nom_tiers', 'Client'], ['numero_document', selectedTypes.length === 1 ? 'N° BL' : 'N° document'],
      ['reference_entete', 'Référence entête'], ['references', 'Réf. lignes'], ['expedition', 'Expédition'],
      ['depot_entete', 'Dépôt'], ['lieu_livraison', 'Lieu de liv.'], ['nb_bl_groupe', 'Nb BL groupe'],
      ['nb_bl_avec_port', 'BL avec port'], ['frais_port_constate_ht', 'Port constaté BL'],
      ['frais_port_constate_groupe_ht', 'Port constaté groupe'], ['frais_port_attendu_groupe_ht', 'Port attendu groupe'],
      ['action_recommandee', 'Action recommandée'], ['montant_action_ht', 'Montant action'],
      ['statut_controle', 'Statut groupe'], ['date_livraison', 'Date livraison'], ['familles_macro', 'Familles macro'], ['client_en_sommeil', 'Sommeil'],
    ]
  }, [isBlSelected, selectedTypes.length])

  const sortedLignes = useMemo(() => sortArray(selectedLignes, ligneSort), [selectedLignes, ligneSort])

  const totalGeneral = useMemo(() => documentsFiltresControle.reduce((acc, doc) => { acc.nb_documents += 1; acc.montant_ht += doc.montant_ht; return acc }, { nb_documents: 0, montant_ht: 0 }), [documentsFiltresControle])

  const controleKpis = useMemo(() => groupesFraisPort.reduce((acc, group) => {
    if (group.statut_groupe === 'FRAIS_PORT_MANQUANT') acc.portManquant += 1
    acc.blASupprimer += Number(group.nb_bl_a_supprimer || 0)
    if (isControlAnomaly(group.statut_groupe) && group.statut_groupe !== 'FRAIS_PORT_MANQUANT' && group.nb_bl_a_supprimer <= 0) acc.autresAnomalies += 1
    acc.totalActions += Number(group.nb_actions || 0)
    return acc
  }, { portManquant: 0, blASupprimer: 0, autresAnomalies: 0, totalActions: 0 }), [groupesFraisPort])

  function toggleType(type: string) {
    setSelectedTypes((current) => {
      if (current.includes(type)) { const next = current.filter((item) => item !== type); return next.length ? next : current }
      if (type === 'BL' && !dateLivraisonFinModifiee) { setDateLivraisonFin(''); setDateLivraisonFinModifiee(false) }
      return [...current, type]
    })
  }

  useEffect(() => {
    if (isBlSelected) return
    if (!dateLivraisonFinModifiee && !dateLivraisonFin) setDateLivraisonFin(getYesterdayIsoDate())
    setSelectedControle('TOUS'); setSelectedGroupKey(null); setSelectedExpedition(''); setSelectedDepotEntete('')
    setReferenceEnteteSearch(''); setLieuLivraisonSearch(''); setSelection(null); setSelectedDocumentKeyForLines(null)
  }, [isBlSelected, dateLivraisonFin, dateLivraisonFinModifiee])

  function toggleDocumentSort(key: keyof DocumentPortefeuille) {
    setDocumentSort((current) => !current || current.key !== key ? { key, direction: 'asc' } : { key, direction: current.direction === 'asc' ? 'desc' : 'asc' })
  }
  function toggleGroupSort(key: keyof GroupeFraisPort) {
    setGroupSort((current) => !current || current.key !== key ? { key, direction: 'asc' } : { key, direction: current.direction === 'asc' ? 'desc' : 'asc' })
  }
  function toggleLigneSort(key: keyof LignePortefeuille) {
    setLigneSort((current) => !current || current.key !== key ? { key, direction: 'asc' } : { key, direction: current.direction === 'asc' ? 'desc' : 'asc' })
  }

  function exportExcel() {
    const syntheseExport: Record<string, string | number>[] = synthese.map((row) => {
      const base: Record<string, string | number> = { Representant: row.representant, Agence: row.agence, Type_document: row.type_document }
      for (const mois of moisLivraison) {
        const cell = row.byMonth[mois]
        base[`${monthLabel(mois)} - Nb docs`] = cell?.nb_documents || 0
        base[`${monthLabel(mois)} - Montant HT`] = Number((cell?.montant_ht || 0).toFixed(2))
        base[`${monthLabel(mois)} - Anomalies port`] = cell?.nb_anomalies || 0
        base[`${monthLabel(mois)} - Frais port manquant`] = cell?.nb_frais_port_manquant || 0
        base[`${monthLabel(mois)} - BL à supprimer`] = cell?.nb_bl_a_supprimer || 0
        base[`${monthLabel(mois)} - Montant actions HT`] = Number((cell?.montant_actions_ht || 0).toFixed(2))
      }
      base['Total - Nb docs'] = row.total_nb_documents; base['Total - Montant HT'] = Number(row.total_montant_ht.toFixed(2))
      base['Total - Anomalies port'] = row.total_nb_anomalies; base['Total - Frais port manquant'] = row.total_nb_frais_port_manquant
      base['Total - BL à supprimer'] = row.total_nb_bl_a_supprimer; base['Total - Montant actions HT'] = Number(row.total_montant_actions_ht.toFixed(2))
      return base
    })

    const groupesExport = sortedGroupesFraisPort.map((group) => ({ 'Date BL': formatDate(group.date_controle), 'N° tiers': group.numero_tiers, Client: group.nom_tiers, 'Expédition': group.expedition, 'Lieu de livraison': group.lieu_livraison, Dépôts: group.depots, Agences: group.agences, 'Représentants': group.representants, 'N° BL': group.numeros_bl, 'Nb BL': group.nb_bl, 'BL avec port': group.nb_bl_avec_port, 'Port constaté groupe': group.frais_port_constate_groupe_ht, 'Port attendu groupe': group.frais_port_attendu_groupe_ht, 'Écart groupe': group.ecart_groupe_ht, 'BL à supprimer': group.nb_bl_a_supprimer, 'Montant à supprimer': group.montant_a_supprimer_ht, 'Montant à ajouter': group.montant_a_ajouter_ht, 'BL conseillé ajout': group.bl_conseille_ajout, 'BL conseillé conservation': group.bl_conseille_conservation, Statut: controlStatusLabel(group.statut_groupe) }))

    const documentsExport = sortedDocuments.map((doc) => ({ Agence: doc.agence, Representant: doc.representant, 'N° tiers': doc.numero_tiers, Client: doc.nom_tiers, 'Type doc': doc.type_document, 'N° document': doc.numero_document, 'Date BL': formatDate(doc.date_controle), 'Référence entête': doc.reference_entete, 'Expédition': doc.expedition, 'Dépôt entête': doc.depot_entete, 'Lieu de livraison': doc.lieu_livraison, 'Nb BL groupe': doc.nb_bl_groupe, 'BL avec port groupe': doc.nb_bl_avec_port, 'Nb lignes': doc.nb_lignes, 'Montant HT portefeuille': Number(doc.montant_ht.toFixed(2)), 'Montant HT lignes contrôle': doc.montant_lignes_controle_ht, 'Montant HT entête': doc.montant_entete_ht, 'Port constaté BL': doc.frais_port_constate_ht, 'Port attendu groupe': doc.frais_port_attendu_groupe_ht, 'Port constaté groupe': doc.frais_port_constate_groupe_ht, 'Écart groupe': doc.ecart_groupe_ht, Action: actionLabel(doc.action_recommandee), 'Montant action': doc.montant_action_ht, 'Base calcul port': doc.base_calcul_frais_port, 'Statut contrôle': controlStatusLabel(doc.statut_controle), 'Date création document': formatDate(doc.date_creation_document), 'Date livraison': formatDate(doc.date_livraison), 'Mois livraison': monthLabel(doc.mois_livraison), Référence: doc.references, 'Client en sommeil': doc.client_en_sommeil ? 'Oui' : 'Non', 'Familles macro': doc.familles_macro }))

    const exportDocumentKeys = new Set(sortedDocuments.map((doc) => doc.key))
    const lignesExport = lignes.filter((ligne) => exportDocumentKeys.has(docKey(ligne))).map((ligne) => ({ Agence: safeText(ligne.agence, 'Sans agence'), Representant: safeText(ligne.representant, 'Sans représentant'), 'N° tiers': safeText(ligne.numero_tiers, ''), Client: safeText(ligne.nom_tiers, ''), 'Type doc': safeText(ligne.type_document, ''), 'N° document': safeText(ligne.numero_document, ''), 'Référence article': safeText(ligne.reference_article, ''), 'Désignation article': safeText(ligne.designation_article, ''), Référence: safeText(ligne.reference, ''), Famille: safeText(ligne.famille, ''), 'Famille macro': safeText(ligne.famille_macro, 'Sans famille macro'), 'Quantité': Number(ligne.quantite || 0), 'Montant HT': Number(ligne.montant_ht || 0), 'Date création document': formatDate(ligne.date_creation_document), 'Date livraison': formatDate(ligne.date_livraison), 'Mois livraison': monthLabel(ligne.mois_livraison || 'SANS_DATE_LIVRAISON'), 'Client en sommeil': ligne.client_en_sommeil ? 'Oui' : 'Non' }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(syntheseExport), 'Synthese')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(groupesExport), 'Controle groupes')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(documentsExport), 'Documents')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lignesExport), 'Detail lignes')
    XLSX.writeFile(workbook, `portefeuille_livraison_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <main className="min-h-screen w-full max-w-none bg-slate-50 px-2 pb-4 pt-2 text-slate-900">
      <div className="w-full max-w-none space-y-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Portefeuille CDC / PL / BL / BR par livraison</h1>
              <p className="mt-1 text-sm text-slate-500">
                Contrôle groupé des BL : un seul forfait par Date BL / N° tiers / Mode d'expédition / Lieu de livraison. Les BL à corriger sont identifiés avec une action Ajouter, Supprimer ou Vérifier.
              </p>
              <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                Version contrôle frais de port groupé 2026-07-13 v3.3 — BL conditionnel · multi-dépôt validé
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadData} disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">
                {loading ? 'Chargement...' : 'Actualiser'}
              </button>
              <button type="button" onClick={exportExcel} disabled={loading || lignes.length === 0} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">
                Export Excel
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 p-3 xl:col-span-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Types documents</div>
              <div className="flex flex-wrap gap-4">
                {ALL_TYPES.map((type) => (
                  <label key={type} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} className="h-4 w-4 rounded border-slate-300 accent-slate-900" />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Création début</span>
              <input type="date" value={dateCreationDebut} onChange={(e) => setDateCreationDebut(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Création fin</span>
              <input type="date" value={dateCreationFin} onChange={(e) => setDateCreationFin(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Livraison début</span>
              <input type="date" value={dateLivraisonDebut} onChange={(e) => setDateLivraisonDebut(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Livraison fin</span>
              <input type="date" value={dateLivraisonFin} onChange={(e) => { setDateLivraisonFin(e.target.value); setDateLivraisonFinModifiee(true) }} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Représentant</span>
              <select value={representantSelectValue} disabled={isRepresentantLocked} onChange={(e) => { if (!isRepresentantLocked) setSelectedRepresentant(e.target.value) }} className={accessLockedSelectClassName(selectBaseClassName, isRepresentantLocked)}>
                {isRepresentantLocked && access.allowedCollaborateurs.length > 1 ? <option value={ACCESS_LOCKED_REPRESENTANT_VALUE}>{lockedFilterLabel(access.allowedCollaborateurs, 'Tous')}</option> : <option value="">Tous</option>}
                {representants.map((v) => <option key={v} value={v}>{isRepresentantLocked && access.allowedCollaborateurs.length === 1 ? `${v} 🔒` : v}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agence</span>
              <select value={agenceSelectValue} disabled={isAgenceLocked} onChange={(e) => { if (!isAgenceLocked) setSelectedAgence(e.target.value) }} className={accessLockedSelectClassName(selectBaseClassName, isAgenceLocked)}>
                {isAgenceLocked && access.allowedAgences.length > 1 ? <option value={ACCESS_LOCKED_AGENCE_VALUE}>{lockedFilterLabel(access.allowedAgences, 'Toutes')}</option> : <option value="">Toutes</option>}
                {agences.map((v) => <option key={v} value={v}>{isAgenceLocked && access.allowedAgences.length === 1 ? `${v} 🔒` : v}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Famille macro</span>
              <select value={selectedFamilleMacro} onChange={(e) => setSelectedFamilleMacro(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="">Toutes</option>
                {famillesMacro.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client en sommeil</span>
              <select value={selectedSommeil} onChange={(e) => setSelectedSommeil(e.target.value as 'TOUS' | 'OUI' | 'NON')} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="TOUS">Tous</option><option value="OUI">Oui</option><option value="NON">Non</option>
              </select>
            </label>
          </div>

          {isBlSelected && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-blue-950">Filtres et contrôle frais de port</div>
                  <div className="text-xs text-blue-800">
                    Le contrôle est réalisé par Date BL / client / mode d'expédition / lieu de livraison.
                    Le nombre de dépôts n'a pas d'incidence sur l'application de la règle.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([['ANOMALIES', 'Toutes les anomalies'], ['FRAIS_PORT_MANQUANT', 'Port manquant'], ['FRAIS_PORT_A_SUPPRIMER', 'BL à supprimer'], ['AUTRES_ANOMALIES', 'Autres contrôles']] as [ControlFilterMode, string][]).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => openBlControl(value)} className={['rounded-lg border px-3 py-1.5 text-xs font-semibold', selectedControle === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-blue-300 bg-white text-blue-800 hover:bg-blue-100'].join(' ')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contrôle frais de port</span>
                  <select value={selectedControle} onChange={(e) => { setSelectedControle(e.target.value); setSelectedGroupKey(null); setSelection(null); setSelectedDocumentKeyForLines(null) }} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="TOUS">Tous les statuts</option>
                    <option value="ANOMALIES">Toutes les anomalies</option>
                    <option value="FRAIS_PORT_MANQUANT">Port manquant</option>
                    <option value="FRAIS_PORT_A_SUPPRIMER">BL à supprimer</option>
                    <option value="AUTRES_ANOMALIES">Autres anomalies</option>
                    <option value="OK">OK</option>
                    <option value="FRAIS_PORT_EN_DOUBLE">Port en double</option>
                    <option value="FRAIS_COMPTOIR_A_SUPPRIMER">Port comptoir à supprimer</option>
                    <option value="FRAIS_PORT_REPARTI_A_REGROUPER">Port réparti à regrouper</option>
                    <option value="MONTANT_FRAIS_PORT_A_VERIFIER">Montant à vérifier</option>
                    <option value="LIEU_LIVRAISON_A_COMPLETER">Lieu à compléter</option>
                    <option value="ENTETE_ABSENTE">Entête absente</option>
                    <option value="MODE_EXPEDITION_ABSENT">Mode absent</option>
                    <option value="MODE_EXPEDITION_INCONNU">Mode inconnu</option>
                    <option value="DATE_BL_ABSENTE">Date BL absente</option>
                    <option value="TIERS_ABSENT">Tiers absent</option>
                    <option value="PL_A_CONFIRMER">PL à confirmer</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expédition</span>
                  <select value={selectedExpedition} onChange={(e) => setSelectedExpedition(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Toutes</option>
                    {expeditions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dépôt entête</span>
                  <select value={selectedDepotEntete} onChange={(e) => setSelectedDepotEntete(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Tous</option>
                    {depotsEntete.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Référence entête</span>
                  <input value={referenceEnteteSearch} onChange={(e) => setReferenceEnteteSearch(e.target.value)} placeholder="Contient…" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lieu de livraison</span>
                  <input value={lieuLivraisonSearch} onChange={(e) => setLieuLivraisonSearch(e.target.value)} placeholder="Contient…" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>
            </div>
          )}

          {!access.loading && (access.accessBadge || access.error) && (
            <div className={['mt-4 rounded-xl border px-3 py-2 text-sm', access.error ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'].join(' ')}>
              {access.error ? `Droits utilisateur non chargés : ${access.error}` : `Périmètre utilisateur appliqué : ${access.accessBadge}`}
            </div>
          )}
          {errorMessage && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>}
          {isBlSelected && controlErrorMessage && (
            <div className="mt-4 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
              <div className="font-semibold">Contrôle frais de port non chargé</div>
              <div className="mt-1">{controlErrorMessage}</div>
            </div>
          )}
        </section>

        <section className={['grid grid-cols-1 gap-4 md:grid-cols-2', isBlSelected ? 'xl:grid-cols-6' : 'xl:grid-cols-2'].join(' ')}>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents affichés</div>
            <div className="mt-1 text-2xl font-semibold">{totalGeneral.nb_documents.toLocaleString('fr-FR')}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Montant HT</div>
            <div className="mt-1 text-2xl font-semibold">{formatMoney(totalGeneral.montant_ht)}</div>
          </div>
          {isBlSelected && (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Groupes BL contrôlés</div>
                <div className="mt-1 text-2xl font-semibold">{groupesFraisPort.length.toLocaleString('fr-FR')}</div>
              </div>
              <button type="button" onClick={() => openBlControl('FRAIS_PORT_MANQUANT')} className={['rounded-2xl border p-4 text-left shadow-sm', controleKpis.portManquant > 0 ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-white'].join(' ')}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Groupes sans port</div>
                <div className={['mt-1 text-2xl font-semibold', controleKpis.portManquant > 0 ? 'text-red-700' : 'text-emerald-700'].join(' ')}>{controleKpis.portManquant.toLocaleString('fr-FR')}</div>
              </button>
              <button type="button" onClick={() => openBlControl('FRAIS_PORT_A_SUPPRIMER')} className={['rounded-2xl border p-4 text-left shadow-sm', controleKpis.blASupprimer > 0 ? 'border-rose-300 bg-rose-50' : 'border-emerald-200 bg-white'].join(' ')}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">BL avec port à supprimer</div>
                <div className={['mt-1 text-2xl font-semibold', controleKpis.blASupprimer > 0 ? 'text-rose-700' : 'text-emerald-700'].join(' ')}>{controleKpis.blASupprimer.toLocaleString('fr-FR')}</div>
              </button>
              <button type="button" onClick={() => openBlControl('AUTRES_ANOMALIES')} className={['rounded-2xl border p-4 text-left shadow-sm', controleKpis.autresAnomalies > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-white'].join(' ')}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Autres groupes à vérifier</div>
                <div className={['mt-1 text-2xl font-semibold', controleKpis.autresAnomalies > 0 ? 'text-amber-700' : 'text-emerald-700'].join(' ')}>{controleKpis.autresAnomalies.toLocaleString('fr-FR')}</div>
              </button>
            </>
          )}
        </section>

        {isBlSelected && (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Contrôle des frais de port par livraison</h2>
                <p className="text-sm text-slate-500">Une ligne correspond à une combinaison Date BL / N° tiers / Mode / Lieu. Clique sur un groupe pour afficher les BL et les actions recommandées.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{sortedGroupesFraisPort.length.toLocaleString('fr-FR')} groupe(s)</span>
                {selectedGroupKey && <button type="button" onClick={() => setSelectedGroupKey(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Réafficher tous les groupes</button>}
              </div>
            </div>
            <div className="max-h-[460px] overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    {([['date_controle', 'Date BL'], ['numero_tiers', 'N° tiers'], ['nom_tiers', 'Client'], ['expedition', 'Expédition'], ['lieu_livraison', 'Lieu de livraison'], ['depots', 'Dépôt(s)'], ['nb_bl', 'Nb BL'], ['nb_bl_avec_port', 'BL avec port'], ['frais_port_constate_groupe_ht', 'Port constaté'], ['frais_port_attendu_groupe_ht', 'Port attendu'], ['ecart_groupe_ht', 'Écart'], ['nb_bl_a_supprimer', 'BL à supprimer'], ['statut_groupe', 'Statut']] as [keyof GroupeFraisPort, string][]).map(([key, label]) => (
                      <th key={key} onClick={() => toggleGroupSort(key)} className="whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-2 py-2 text-left hover:bg-slate-200">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedGroupesFraisPort.map((group) => {
                    const isSelected = selectedGroupKey === group.cle_groupe_frais_port
                    return (
                      <tr key={group.cle_groupe_frais_port} onClick={() => { setSelectedTypes(['BL']); setSelectedGroupKey(group.cle_groupe_frais_port); setSelection(null); setSelectedDocumentKeyForLines(null) }}
                        className={['cursor-pointer hover:bg-blue-50', isSelected ? 'bg-blue-100 ring-1 ring-inset ring-blue-300' : '', group.statut_groupe === 'FRAIS_PORT_MANQUANT' ? 'bg-red-50' : '', group.nb_bl_a_supprimer > 0 ? 'bg-rose-50' : ''].join(' ')}>
                        <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 font-semibold">{formatDate(group.date_controle)}</td>
                        <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 font-semibold">{group.numero_tiers}</td>
                        <td className="max-w-[260px] border-b border-r border-slate-200 px-2 py-2">{group.nom_tiers}</td>
                        <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2">{group.expedition || '—'}</td>
                        <td className="max-w-[320px] border-b border-r border-slate-200 px-2 py-2" title={group.lieu_livraison}>{group.lieu_livraison || '—'}</td>
                        <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2">{group.depots || '—'}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right font-semibold">{group.nb_bl}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{group.nb_bl_avec_port}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right font-semibold">{formatMoneyCents(group.frais_port_constate_groupe_ht)}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{formatMoneyCents(group.frais_port_attendu_groupe_ht)}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{formatMoneyCents(group.ecart_groupe_ht)}</td>
                        <td className={['border-b border-r border-slate-200 px-2 py-2 text-right font-semibold', group.nb_bl_a_supprimer > 0 ? 'text-rose-700' : 'text-slate-400'].join(' ')}>{group.nb_bl_a_supprimer}</td>
                        <td className="border-b border-slate-200 px-2 py-2">
                          <div className="space-y-1">
                            <span className={['inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold', controlStatusClassName(group.statut_groupe)].join(' ')}>{controlStatusLabel(group.statut_groupe)}</span>
                            {group.statut_groupe === 'FRAIS_PORT_MANQUANT' && group.bl_conseille_ajout && <div className="text-[11px] font-semibold text-red-700">Ajouter sur {group.bl_conseille_ajout}</div>}
                            {group.nb_bl_a_supprimer > 0 && group.bl_conseille_conservation && <div className="text-[11px] font-semibold text-rose-700">Conserver sur {group.bl_conseille_conservation}</div>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {sortedGroupesFraisPort.length === 0 && <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-500">Aucun groupe de BL avec les filtres sélectionnés.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold">Tableau de synthèse</h2>
              <p className="text-sm text-slate-500">Clique sur une cellule, une ligne, une colonne ou le total général pour afficher le détail en dessous.</p>
            </div>
            <button type="button" onClick={() => applyDetailSelection(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Réinitialiser détail</button>
          </div>
          <div className="max-h-[580px] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <th className="sticky left-0 z-20 whitespace-nowrap border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left">Agence</th>
                  <th className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 text-left">Représentant</th>
                  <th className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 text-left">Type doc</th>
                  {isBlSelected && (
                    <>
                      <th className="whitespace-nowrap border-b border-r border-slate-200 bg-orange-50 px-3 py-2 text-right text-orange-900">Anomalies port</th>
                      <th className="whitespace-nowrap border-b border-r border-slate-200 bg-red-50 px-3 py-2 text-right text-red-900">Port manquant</th>
                      <th className="whitespace-nowrap border-b border-r border-slate-200 bg-rose-50 px-3 py-2 text-right text-rose-900">BL à supprimer</th>
                    </>
                  )}
                  {moisLivraison.map((mois) => (
                    <th key={mois} className={getSummaryHeaderClassName(mois, currentMonthKey)} onClick={() => applyDetailSelection({ mois_livraison: mois, totalType: 'colonne' })}>{monthLabel(mois)}</th>
                  ))}
                  <th className="whitespace-nowrap cursor-pointer border-b border-slate-200 px-2 py-2 text-right hover:bg-slate-200" onClick={() => applyDetailSelection({ totalType: 'general' })}>Total</th>
                </tr>
              </thead>
              <tbody>
                {synthese.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="sticky left-0 border-b border-r border-slate-200 bg-white px-3 py-2 font-medium">{row.agence}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{row.representant}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{row.type_document}</td>
                    {isBlSelected && (
                      <>
                        <td className={['border-b border-r border-slate-200 px-2 py-2 text-right font-semibold', row.total_nb_anomalies > 0 ? 'bg-orange-50 text-orange-800' : 'text-slate-400'].join(' ')}>{row.total_nb_anomalies.toLocaleString('fr-FR')}</td>
                        <td className={['border-b border-r border-slate-200 px-2 py-2 text-right font-semibold', row.total_nb_frais_port_manquant > 0 ? 'bg-red-50 text-red-800' : 'text-slate-400'].join(' ')}>{row.total_nb_frais_port_manquant.toLocaleString('fr-FR')}</td>
                        <td className={['border-b border-r border-slate-200 px-2 py-2 text-right font-semibold', row.total_nb_bl_a_supprimer > 0 ? 'bg-rose-50 text-rose-800' : 'text-slate-400'].join(' ')}>
                          <div>{row.total_nb_bl_a_supprimer.toLocaleString('fr-FR')}</div>
                          {row.total_montant_actions_ht > 0 && <div className="text-[11px] font-medium">{formatMoneyCents(row.total_montant_actions_ht)}</div>}
                        </td>
                      </>
                    )}
                    {moisLivraison.map((mois) => {
                      const cell = row.byMonth[mois]
                      const hasValue = Boolean(cell && cell.nb_documents > 0)
                      return (
                        <td key={`${row.key}-${mois}`} onClick={() => { if (!hasValue) return; applyDetailSelection({ representant: row.representant, agence: row.agence, type_document: row.type_document, mois_livraison: mois }) }} className={getSummaryCellClassName(mois, hasValue, currentMonthKey)}>
                          {hasValue ? (
                            <div className="leading-tight">
                              <div className="whitespace-nowrap font-semibold">{cell.nb_documents.toLocaleString('fr-FR')} docs</div>
                              <div className="whitespace-nowrap text-xs text-slate-500">{formatMoneyCompact(cell.montant_ht)}</div>
                              {cell.nb_anomalies > 0 && <div className="mt-1 whitespace-nowrap text-[11px] font-semibold text-orange-700">{cell.nb_anomalies} anomalie(s)</div>}
                              {cell.nb_frais_port_manquant > 0 && <div className="whitespace-nowrap text-[11px] font-semibold text-red-700">{cell.nb_frais_port_manquant} port manquant</div>}
                              {cell.nb_bl_a_supprimer > 0 && <div className="whitespace-nowrap text-[11px] font-semibold text-rose-700">{cell.nb_bl_a_supprimer} BL à supprimer</div>}
                            </div>
                          ) : '-'}
                        </td>
                      )
                    })}
                    <td onClick={() => applyDetailSelection({ representant: row.representant, agence: row.agence, type_document: row.type_document, totalType: 'ligne' })} className="cursor-pointer border-b border-slate-200 bg-slate-50 px-3 py-2 text-right hover:bg-blue-50">
                      <div className="leading-tight">
                        <div className="whitespace-nowrap font-semibold">{row.total_nb_documents.toLocaleString('fr-FR')} docs</div>
                        <div className="whitespace-nowrap text-xs text-slate-500">{formatMoneyCompact(row.total_montant_ht)}</div>
                        {row.total_nb_anomalies > 0 && <div className="mt-1 whitespace-nowrap text-[11px] font-semibold text-orange-700">{row.total_nb_anomalies} anomalie(s)</div>}
                        {row.total_nb_frais_port_manquant > 0 && <div className="whitespace-nowrap text-[11px] font-semibold text-red-700">{row.total_nb_frais_port_manquant} port manquant</div>}
                        {row.total_nb_bl_a_supprimer > 0 && <div className="whitespace-nowrap text-[11px] font-semibold text-rose-700">{row.total_nb_bl_a_supprimer} BL à supprimer</div>}
                      </div>
                    </td>
                  </tr>
                ))}
                {synthese.length === 0 && <tr><td colSpan={(isBlSelected ? 7 : 4) + moisLivraison.length} className="px-4 py-8 text-center text-slate-500">Aucune donnée trouvée avec les filtres sélectionnés.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-lg font-semibold">Liste des documents</h2>
            <p className="text-sm text-slate-500">{sortedDocuments.length.toLocaleString('fr-FR')} document(s) affiché(s). Clique sur un numéro de document pour filtrer le détail à la ligne.</p>
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {documentColumns.map(([key, label]) => (
                    <th key={key} onClick={() => toggleDocumentSort(key)} className="whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-2 py-2 text-left hover:bg-slate-200">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDocuments.map((doc) => (
                  <tr key={doc.key} className={['hover:bg-slate-50', doc.action_recommandee === 'AJOUTER' ? 'bg-red-50' : '', doc.action_recommandee === 'SUPPRIMER' ? 'bg-rose-50' : '', doc.action_recommandee === 'VERIFIER' ? 'bg-amber-50' : '', selectedDocumentKeyForLines === doc.key ? 'ring-1 ring-inset ring-blue-300' : ''].join(' ')}>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{doc.agence}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{doc.representant}</td>
                    {isBlSelected && <td className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-2 font-semibold">{formatDate(doc.date_controle)}</td>}
                    <td className="border-b border-r border-slate-200 px-2 py-2">{doc.numero_tiers}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{doc.nom_tiers}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2 font-medium">
                      <button type="button" onClick={() => setSelectedDocumentKeyForLines(doc.key)} className="font-semibold text-blue-700 underline-offset-2 hover:underline">{doc.numero_document}</button>
                    </td>
                    {isBlSelected && <td className="border-b border-r border-slate-200 px-2 py-2 font-medium">{doc.reference_entete || '—'}</td>}
                    <td className="border-b border-r border-slate-200 px-2 py-2">{doc.references || '—'}</td>
                    {isBlSelected && (
                      <>
                        <td className="border-b border-r border-slate-200 px-2 py-2">{doc.expedition || '—'}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2">{doc.depot_entete || '—'}</td>
                        <td className="max-w-[280px] border-b border-r border-slate-200 px-2 py-2" title={doc.lieu_livraison}>{doc.lieu_livraison || '—'}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right font-semibold">{doc.nb_bl_groupe || '—'}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{doc.nb_bl_avec_port || '—'}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right font-semibold">{formatMoneyCents(doc.frais_port_constate_ht)}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{formatMoneyCents(doc.frais_port_constate_groupe_ht)}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{formatMoneyCents(doc.frais_port_attendu_groupe_ht)}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2"><span className={['inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold', actionClassName(doc.action_recommandee)].join(' ')}>{actionLabel(doc.action_recommandee)}</span></td>
                        <td className="border-b border-r border-slate-200 px-2 py-2 text-right font-semibold">{formatMoneyCents(doc.montant_action_ht)}</td>
                        <td className="border-b border-r border-slate-200 px-2 py-2"><span className={['inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold', controlStatusClassName(doc.statut_controle)].join(' ')} title={doc.base_calcul_frais_port || undefined}>{controlStatusLabel(doc.statut_controle)}</span></td>
                      </>
                    )}
                    <td className="border-b border-r border-slate-200 px-2 py-2">{formatDate(doc.date_livraison)}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{doc.familles_macro}</td>
                    <td className="border-b border-slate-200 px-2 py-2">{doc.client_en_sommeil ? 'Oui' : 'Non'}</td>
                  </tr>
                ))}
                {sortedDocuments.length === 0 && <tr><td colSpan={documentColumns.length} className="px-4 py-8 text-center text-slate-500">Aucun document à afficher.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold">Détail à la ligne</h2>
              <p className="text-sm text-slate-500">
                {sortedLignes.length.toLocaleString('fr-FR')} ligne(s) affichée(s).
                {selectedDocumentForLines ? ` Filtré sur le document ${selectedDocumentForLines.numero_document}.` : ' Détail correspondant à la liste des documents ci-dessus.'}
              </p>
            </div>
            {selectedDocumentKeyForLines && <button type="button" onClick={() => setSelectedDocumentKeyForLines(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Réafficher toutes les lignes</button>}
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {([['agence', 'Agence'], ['representant', 'Représentant'], ['numero_tiers', 'N° tiers'], ['nom_tiers', 'Client'], ['type_document', 'Type doc'], ['numero_document', 'N° document'], ['reference_article', 'Référence article'], ['designation_article', 'Désignation article'], ['reference', 'Référence'], ['famille', 'Famille'], ['famille_macro', 'Famille macro'], ['quantite', 'Quantité'], ['montant_ht', 'Montant HT'], ['date_creation_document', 'Date création'], ['date_livraison', 'Date livraison'], ['client_en_sommeil', 'Sommeil']] as [keyof LignePortefeuille, string][]).map(([key, label]) => (
                    <th key={key} onClick={() => toggleLigneSort(key)} className="whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-2 py-2 text-left hover:bg-slate-200">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLignes.map((ligne, index) => (
                  <tr key={`${ligne.id || index}-${ligne.numero_document}`} className="hover:bg-slate-50">
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.agence, 'Sans agence')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.representant, 'Sans représentant')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.numero_tiers, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.nom_tiers, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.type_document, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2 font-medium">{safeText(ligne.numero_document, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2 font-medium">{safeText(ligne.reference_article, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.designation_article, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.reference, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.famille, '')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{safeText(ligne.famille_macro, 'Sans famille macro')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{Number(ligne.quantite || 0).toLocaleString('fr-FR')}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2 text-right">{formatMoney(ligne.montant_ht)}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{formatDate(ligne.date_creation_document)}</td>
                    <td className="border-b border-r border-slate-200 px-2 py-2">{formatDate(ligne.date_livraison)}</td>
                    <td className="border-b border-slate-200 px-2 py-2">{ligne.client_en_sommeil ? 'Oui' : 'Non'}</td>
                  </tr>
                ))}
                {sortedLignes.length === 0 && <tr><td colSpan={16} className="px-4 py-8 text-center text-slate-500">Aucune ligne à afficher.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
