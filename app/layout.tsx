'use client'

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logUserEvent } from '@/lib/audit'
import { AccessProvider, useAccess, type AccessRights } from '@/components/AccessContext'
import { Analytics } from '@vercel/analytics/next'
import AutoLogout from '@/components/autologout'
import { usePageFilterAccess } from '@/lib/pageAccessFilters'
import './globals.css'
import { SpeedInsights } from "@vercel/speed-insights/next"

import {
  SocieteFilterProvider,
  useSocieteFilter,
  type SocieteFilter,
} from '@/components/SocieteFilterContext'

type MenuAccessKey = Exclude<
  keyof AccessRights,
  | 'allowed_scopes'
  | 'allowed_agences'
  | 'allowed_collaborateurs'
  | 'allowed_departements'
  | 'allowed_codes_postaux'
  | 'display_name'
  | 'default_landing_page'
  | 'profile_id'
  | 'profile_code'
  | 'profile_name'
  | 'show_alert_cerfa_ko'
  | 'show_alert_cdc_liv_avant_2026'
  | 'show_alert_controle_frais_port'
  | 'show_alert_capacite_gaz'
  | 'show_alert_todo'
  | 'can_change_scope'
>

type MenuItem = {
  label: string
  path: string
  accessKey?: MenuAccessKey
}

type MenuGroup = {
  label: string
  items: MenuItem[]
}

type StatusLevel = 'red' | 'orange' | 'green'

type StatusLightProps = {
  label: string
  status: StatusLevel
  count?: number
  blink?: boolean
  clickable?: boolean
  onClick?: () => void
  title?: string
}

type UserAccessProfile = {
  email?: string | null
  display_name?: string | null
  access_profile_id?: string | null
  allowed_agence?: string | string[] | null
  allowed_agences?: string | string[] | null
  allowed_collaborateurs?: string | string[] | null
  allowed_departements?: string | string[] | null
  allowed_codes_postaux?: string | string[] | null
  can_todo?: boolean | null
}

type StatusScopeOverride = {
  active: boolean
  agences?: string[] | string | null
  collaborateurs?: string[] | string | null
}

type TodoSignal = {
  status: StatusLevel
  count: number
}

type CdcLivAvant2026Signal = {
  status: StatusLevel
  count: number
}

type ControleFraisPortSignal = {
  status: StatusLevel
  count: number
  missingGroups: number
  blToRemove: number
  otherGroups: number
}

type CerfaKoRow = {
  key: string
  raw: Record<string, any>
  idValue: string | number | null
  dateFacture: string
  numeroFacture: string
  lienFacture: string
  lienTiers: string
  numeroTiers: string
  intituleTiers: string
  reference: string
  projet: string
  collaborateur: string
  agence: string
  affaireDraft: string
  checked: boolean
  saving: boolean
}

type CertificationAlertKind = 'capacite'

type CertificationSignal = {
  status: StatusLevel
  count: number
  expiredCount: number
  soonCount: number
}

type CertificationAlertRow = {
  kind: CertificationAlertKind
  alert_status: 'expired' | 'soon'
  numero_tiers: string
  designation: string
  departement: string
  representant: string
  agence?: string | null
  agence_rattachement?: string | null
  agence_collaborateur?: string | null
  date_validite_client: string | null
  date_validite_ref_tiers: string | null
  date_validite: string | null
  jours_ecart: number
  siret: string
}

function StatusLight({ label, status, count, blink = false, clickable = false, onClick, title }: StatusLightProps) {
  const isRed = status === 'red'
  const isOrange = status === 'orange'
  const shellStyle = {
    ...styles.statusCard,
    ...(isRed ? styles.statusCardRed : isOrange ? styles.statusCardOrange : styles.statusCardGreen),
    ...(blink ? styles.statusCardBlink : {}),
    cursor: clickable ? 'pointer' : 'default',
  } as React.CSSProperties

  const lightStyle = {
    ...styles.statusLightDot,
    ...(isRed ? styles.statusLightDotRed : isOrange ? styles.statusLightDotOrange : styles.statusLightDotGreen),
    ...(blink ? styles.statusLightDotBlink : {}),
  } as React.CSSProperties

  const labelStyle = {
    ...styles.statusCardLabel,
    ...(isRed ? styles.statusCardLabelRed : isOrange ? styles.statusCardLabelOrange : styles.statusCardLabelGreen),
  } as React.CSSProperties

  const badgeStyle = {
    ...styles.statusBadge,
    ...(isRed ? styles.statusBadgeRed : isOrange ? styles.statusBadgeOrange : styles.statusBadgeGreen),
  } as React.CSSProperties

  const okStyle = {
    ...styles.statusOkText,
    ...(isRed ? styles.statusCardLabelRed : isOrange ? styles.statusCardLabelOrange : styles.statusCardLabelGreen),
  } as React.CSSProperties

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      style={shellStyle}
      title={title || (clickable ? `Ouvrir ${label}` : `${label} OK`)}
    >
      <div style={styles.statusCardTop}>
        <span style={lightStyle} />
        <span style={labelStyle}>{label}</span>
      </div>
      {typeof count === 'number' && count > 0 ? (
        <span style={badgeStyle}>{count}</span>
      ) : (
        <span style={okStyle}>OK</span>
      )}
    </button>
  )
}

function normalizeLoose(value: any) {
  return String(value ?? '').trim().toLowerCase()
}

function cleanText(value: any) {
  return String(value ?? '').trim()
}

function rawValue(row: Record<string, any> | null | undefined, keys: string[]) {
  if (!row) return null
  for (const key of keys) {
    if (row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '') return row[key]
  }
  return null
}

function extractLeadingCode(value: any) {
  const text = cleanText(value)
  if (!text) return ''
  return text.split(/\s[-–—·|:]\s|\s+-\s+|\s+—\s+|\s+–\s+/)[0]?.trim() || text
}

function parseAllowedAgences(value: any) {
  const isNoRestriction = (item: string) => {
    const normalized = item.trim().toLowerCase()
    return !normalized || ['global', 'tous', 'tout', 'all', '*', '[]', '{}', 'null', 'none', 'aucune'].includes(normalized)
  }

  const values = Array.isArray(value)
    ? value.map(cleanText)
    : cleanText(value).split(/[;,|\n]+/).map((item) => item.trim())

  return values.filter((item) => !isNoRestriction(item))
}
function parseAllowedCollaborateurs(value: any) {
  const isNoRestriction = (item: string) => {
    const normalized = item.trim().toLowerCase()
    return !normalized || ['global', 'tous', 'tout', 'all', '*', '[]', '{}', 'null', 'none', 'aucune'].includes(normalized)
  }

  const values = Array.isArray(value)
    ? value.map(cleanText)
    : cleanText(value).split(/[;,|\n]+/).map((item) => item.trim())

  return values.filter((item) => !isNoRestriction(item))
}

function normalizeComparable(value: any) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function uniqueCleanTexts(values: any[]) {
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)))
}

function chunkArray<T>(values: T[], size = 400) {
  const output: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size))
  }
  return output
}

function agenceMatchesAllowed(agence: string, allowedAgences: string[]) {
  if (!allowedAgences.length) return true
  const normalizedAgence = normalizeComparable(agence)
  if (!normalizedAgence) return false
  return allowedAgences.some((allowed) => {
    const normalizedAllowed = normalizeComparable(allowed)
    return normalizedAgence === normalizedAllowed || normalizedAgence.includes(normalizedAllowed) || normalizedAllowed.includes(normalizedAgence)
  })
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function formatDateFr(value: any) {
  const text = cleanText(value)
  if (!text) return ''
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[3].padStart(2, '0')}/${iso[2].padStart(2, '0')}/${iso[1]}`
  return text
}

function buildCerfaKey(row: Record<string, any>, index: number) {
  const idValue = rawValue(row, ['id', 'ligne_id', 'uuid'])
  if (idValue !== null && idValue !== undefined) return String(idValue)
  return [
    rawValue(row, ['numero_piece', 'num_piece', 'numero_facture', 'facture', 'piece', 'document']),
    rawValue(row, ['date_facture', 'date_piece', 'date_document', 'date']),
    rawValue(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers', 'client_code']),
    rawValue(row, ['reference_article', 'reference', 'code_article', 'article']),
    index,
  ].map((v) => cleanText(v)).join('__')
}

function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { societeFilter, setSocieteFilter } = useSocieteFilter()
  const { loading: accessLoading, rights, email } = useAccess()

  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [hoverTimeout, setHoverTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [statusBlinkOn, setStatusBlinkOn] = useState(true)
  const [pageFloatingLayerOpen, setPageFloatingLayerOpen] = useState(false)
  const [todoSignal, setTodoSignal] = useState<TodoSignal>({ status: 'green', count: 0 })
  const [cdcLivAvant2026Signal, setCdcLivAvant2026Signal] = useState<CdcLivAvant2026Signal>({
    status: 'green',
    count: 0,
  })
  const [controleFraisPortSignal, setControleFraisPortSignal] = useState<ControleFraisPortSignal>({
    status: 'green',
    count: 0,
    missingGroups: 0,
    blToRemove: 0,
    otherGroups: 0,
  })
  const [cerfaKoCount, setCerfaKoCount] = useState(0)
  const [cerfaRows, setCerfaRows] = useState<CerfaKoRow[]>([])
  const [cerfaModalOpen, setCerfaModalOpen] = useState(false)
  const [cerfaLoading, setCerfaLoading] = useState(false)
  const [cerfaError, setCerfaError] = useState<string | null>(null)
  const [certificationSignals, setCertificationSignals] = useState<Record<CertificationAlertKind, CertificationSignal>>({
    capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
  })
  const [certificationModalOpen, setCertificationModalOpen] = useState(false)
  const [certificationModalKind, setCertificationModalKind] = useState<CertificationAlertKind>('capacite')
  const [certificationRows, setCertificationRows] = useState<CertificationAlertRow[]>([])
  const [certificationLoading, setCertificationLoading] = useState(false)
  const [certificationError, setCertificationError] = useState<string | null>(null)

  const lastLoggedPathRef = useRef<string | null>(null)
  const lastStatusRefreshRef = useRef(0)
  const access = usePageFilterAccess()
  const [statusScopeOverride, setStatusScopeOverride] = useState<StatusScopeOverride | null>(null)
  const isLoginPage = pathname === '/login'
  const isUnauthorizedPage = pathname === '/unauthorized'
  const isPortefeuilleLivraisonPage = pathname === '/portefeuille-livraison' || pathname.startsWith('/portefeuille-livraison/')
  const isPdfPrintPage =
    pathname === '/focus_mensuel_print' ||
    pathname.startsWith('/focus_mensuel_print/')

  const isPublicShellPage = isLoginPage || isPdfPrintPage

  const hasVisibleStatusLights =
    rights.show_alert_cerfa_ko ||
    rights.show_alert_cdc_liv_avant_2026 ||
    rights.show_alert_controle_frais_port ||
    rights.show_alert_capacite_gaz ||
    rights.show_alert_todo

  const hasAnyMenuAccess =
    rights.can_dashboard ||
    rights.can_territoire ||
    rights.can_cartographie ||
    rights.can_clients ||
    rights.can_carte ||
    rights.can_todo ||
    rights.can_clients_cegeclim ||
    rights.can_suivi_prospects ||
    rights.can_agences ||
    rights.can_autorisation ||
    rights.can_documents ||
    rights.can_stocks ||
    rights.can_activites

  const getVisibleItems = (group: MenuGroup) =>
    group.items.filter((item) => {
      if (item.path === '/accueil') return hasAnyMenuAccess
      return !item.accessKey || rights[item.accessKey]
    })

  const isGroupVisible = (group: MenuGroup) => getVisibleItems(group).length > 0

  const isGroupActive = (group: MenuGroup) =>
    getVisibleItems(group).some((item) => pathname === item.path)

  const backgroundImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/Image%20site%20CEGECLIM%20maison.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9JbWFnZSBzaXRlIENFR0VDTElNIG1haXNvbi5qcGciLCJpYXQiOjE3NzU1MDYyNTEsImV4cCI6NDg5NzU3MDI1MX0.d1YT7_-xD44QOm2LFbZIfpkjh9kiIGjpJiEuJxV0rMM'

  function getAllowedAgencesForStatus(accessProfile?: UserAccessProfile | null) {
    // 1) La restriction user_page_access est prioritaire : elle borne toujours le périmètre.
    const fromHook = parseAllowedAgences(access.allowedAgences)
    if (fromHook.length) return fromHook

    // 2) Sinon, on suit le filtre actif de l'écran courant (portefeuille, synthèse, etc.).
    const fromPageFilter = statusScopeOverride?.active
      ? parseAllowedAgences(statusScopeOverride.agences)
      : []
    if (fromPageFilter.length) return fromPageFilter

    // 3) Fallback direct en relisant le profil si le hook n'est pas encore synchronisé.
    return parseAllowedAgences((accessProfile as any)?.allowed_agences ?? (accessProfile as any)?.allowed_agence)
  }

  function getAllowedCollaborateursForStatus(accessProfile?: UserAccessProfile | null) {
    // 1) La restriction user_page_access est prioritaire : elle borne toujours le périmètre.
    const fromHook = parseAllowedCollaborateurs(access.allowedCollaborateurs)
    if (fromHook.length) return fromHook

    // 2) Sinon, on suit le filtre actif de l'écran courant.
    const fromPageFilter = statusScopeOverride?.active
      ? parseAllowedCollaborateurs(statusScopeOverride.collaborateurs)
      : []
    if (fromPageFilter.length) return fromPageFilter

    // 3) Fallback direct en relisant le profil si le hook n'est pas encore synchronisé.
    return parseAllowedCollaborateurs((accessProfile as any)?.allowed_collaborateurs)
  }

  function certificationRowAgence(row: Record<string, any>) {
    return cleanText(rawValue(row, ['agence', 'agence_rattachement', 'agence_collaborateur', 'agence_document']))
  }

  function certificationRowRepresentant(row: Record<string, any>) {
    return cleanText(rawValue(row, ['representant', 'collaborateur', 'collaborateur_tiers', 'collaborateur_facture', 'commercial']))
  }

  async function fetchCertificationRefTiersByNumero(numeroTiersValues: string[]) {
    const rows: Record<string, any>[] = []
    const cleanedValues = uniqueCleanTexts(numeroTiersValues)

    for (const group of chunkArray(cleanedValues, 400)) {
      const { data, error } = await supabase
        .from('ref_tiers')
        .select('numero,representant,agence_rattachement,depot_rattachement')
        .in('numero', group)

      if (error) throw error
      rows.push(...((data || []) as Record<string, any>[]))
    }

    return rows
  }

  async function fetchCertificationCollaborateurAgences() {
    const { data, error } = await supabase
      .from('ref_collaborateurs')
      .select('*')
      .range(0, 9999)

    if (error) throw error

    const agenceByCollaborateur = new Map<string, string>()

    ;((data || []) as Record<string, any>[]).forEach((row) => {
      const nom = cleanText(rawValue(row, ['nom', 'collaborateur', 'representant', 'code']))
      const agence = cleanText(rawValue(row, ['agence', 'agence_rattachement', 'agence_collaborateur']))
      if (nom && agence) agenceByCollaborateur.set(normalizeComparable(nom), agence)
    })

    return agenceByCollaborateur
  }

  async function enrichCertificationRowsWithAgence(rows: Record<string, any>[]) {
    if (!rows.length) return rows

    const numeroTiersValues = uniqueCleanTexts(
      rows.map((row) => extractLeadingCode(rawValue(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers', 'client_code'])))
    )

    const [refTiersRows, agenceByCollaborateur] = await Promise.all([
      fetchCertificationRefTiersByNumero(numeroTiersValues),
      fetchCertificationCollaborateurAgences(),
    ])

    const refTiersByNumero = new Map<string, Record<string, any>>()
    refTiersRows.forEach((row) => {
      const numero = cleanText(rawValue(row, ['numero', 'numero_tiers', 'code_tiers']))
      if (numero) refTiersByNumero.set(normalizeComparable(numero), row)
    })

    return rows.map((row) => {
      const numeroTiers = extractLeadingCode(rawValue(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers', 'client_code']))
      const refTier = numeroTiers ? refTiersByNumero.get(normalizeComparable(numeroTiers)) : null
      const representant = certificationRowRepresentant(row) || cleanText(rawValue(refTier, ['representant', 'collaborateur', 'commercial']))
      const agenceDepuisCollaborateur = representant ? agenceByCollaborateur.get(normalizeComparable(representant)) : ''
      const agence = certificationRowAgence(row)
        || agenceDepuisCollaborateur
        || cleanText(rawValue(refTier, ['agence_rattachement', 'agence', 'depot_rattachement']))

      return {
        ...row,
        numero_tiers: numeroTiers || row.numero_tiers,
        representant: representant || row.representant,
        agence: agence || row.agence,
        agence_rattachement: agence || row.agence_rattachement,
        agence_collaborateur: agence || row.agence_collaborateur,
      }
    })
  }
  function collaborateurMatchesAllowed(collaborateur: string, allowedCollaborateurs: string[]) {
  if (!allowedCollaborateurs.length) return true
  const normalizedCollaborateur = normalizeComparable(collaborateur)
  if (!normalizedCollaborateur) return false

  return allowedCollaborateurs.some((allowed) => {
    const normalizedAllowed = normalizeComparable(allowed)
    return (
      normalizedCollaborateur === normalizedAllowed ||
      normalizedCollaborateur.includes(normalizedAllowed) ||
      normalizedAllowed.includes(normalizedCollaborateur)
    )
  })
}
  function filterCertificationRowsForAccess(
    rows: Record<string, any>[],
    allowedAgences: string[],
    allowedCollaborateurs: string[]
  ) {
    return rows.filter((row) => {
      const representant = certificationRowRepresentant(row)
      const agence = certificationRowAgence(row)

      if (allowedCollaborateurs.length > 0) {
        return collaborateurMatchesAllowed(representant, allowedCollaborateurs)
      }

      if (allowedAgences.length > 0) {
        return agenceMatchesAllowed(agence, allowedAgences)
      }

      return true
    })
  }

  const menuGroups: MenuGroup[] = [
    {
      label: 'Prospects / Clients',
      items: [
        { label: 'Prospects / Clients', path: '/carte', accessKey: 'can_carte' },
      ],
    },
    {
      label: 'Territoire',
      items: [
        { label: 'Région-Dépt.', path: '/territoire', accessKey: 'can_territoire' },
        { label: 'Agences', path: '/agences', accessKey: 'can_agences' },
        { label: 'Cartographie', path: '/cartographie', accessKey: 'can_cartographie' },
      ],
    },
    {
      label: 'Tableaux de bord',
      items: [
        { label: 'Flux Devis-CDC-BC-Fact', path: '/approvisionnements', accessKey: 'can_dashboard' },
        { label: 'Analyse Devis', path: '/cycle-documents', accessKey: 'can_autorisation' },
        { label: 'Portefeuille cde', path: '/portefeuille-livraison', accessKey: 'can_dashboard' },
        { label: 'Suivi Multi Clients', path: '/synthese_multi_clients', accessKey: 'can_dashboard' },
        { label: 'Tableaux de bord', path: '/atelier-analyse', accessKey: 'can_autorisation' },
        { label: 'Focus Mois', path: '/focus_mensuel', accessKey: 'can_dashboard' },
        { label: 'Projection Stock', path: '/stocks-disponibilites', accessKey: 'can_stocks' },
        { label: 'Indicateurs', path: '/Indicateurs', accessKey: 'can_autorisation' },
      ],
    },
    {
      label: 'Admin',
      items: [
        { label: 'Autorisations', path: '/autorisation', accessKey: 'can_autorisation' },
        { label: 'Job scheduling', path: '/admin/planification', accessKey: 'can_autorisation' },
        { label: 'MAJ Base clients', path: '/clients', accessKey: 'can_autorisation' },
        { label: 'MAJ Données Activité', path: '/Import', accessKey: 'can_autorisation' },
        { label: 'Todo List', path: '/todo', accessKey: 'can_todo' },
        { label: 'Documents', path: '/documents', accessKey: 'can_documents' },
      ],
    },
  ]

  useEffect(() => {
    let isMounted = true

    async function initSession() {
      const { data } = await supabase.auth.getSession()
      if (!isMounted) return

      const exists = Boolean(data.session)
      setHasSession(exists)
      setSessionChecked(true)

      if (!exists && !isPublicShellPage) {
        router.replace('/login')
      }
    }

    void initSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const exists = Boolean(session)
      setHasSession(exists)
      setSessionChecked(true)

      if (!exists && !isPublicShellPage) {
        router.replace('/login')
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [router, isPublicShellPage])

  useEffect(() => {
    if (!sessionChecked) return
    if (accessLoading) return
    if (!hasSession) return
    if (isLoginPage || isUnauthorizedPage || isPdfPrintPage) return

    const currentPage = menuGroups
      .flatMap((g) => g.items)
      .find((item) => item.path === pathname)

    if (currentPage?.accessKey && !rights[currentPage.accessKey]) {
      router.replace('/unauthorized')
    }
  }, [sessionChecked, hasSession, accessLoading, pathname, rights, router, isLoginPage, isUnauthorizedPage, isPdfPrintPage, menuGroups])

  useEffect(() => {
    if (!sessionChecked || !hasSession) return
    if (!email) return
    if (!pathname) return
    if (pathname === '/login' || pathname === '/unauthorized' || isPdfPrintPage) return
    if (lastLoggedPathRef.current === pathname) return

    lastLoggedPathRef.current = pathname

    void logUserEvent({
      user_email: email,
      event_type: 'page_view',
      pathname,
    })
  }, [sessionChecked, hasSession, email, pathname, isPdfPrintPage])

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusBlinkOn((prev) => !prev)
    }, 1200)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Les cartes et l'éditeur de widgets sont rendus par les pages elles-mêmes.
    // Ils peuvent donc se retrouver dans un contexte d'empilement inférieur au
    // bandeau sticky. On détecte toute grande couche fixe visible et on efface
    // temporairement le bandeau pour laisser apparaître l'en-tête et les boutons
    // de la fenêtre flottante. La détection est générique et couvre aussi les
    // futures modales plein écran sans modifier chaque page.
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    let animationFrame = 0

    const candidateSelector = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class~="fixed"]',
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="overlay"]',
      '[class*="Overlay"]',
      '[style*="position: fixed"]',
      '[style*="position:fixed"]',
    ].join(',')

    function isLargeVisibleFixedLayer(element: Element) {
      if (!(element instanceof HTMLElement)) return false
      if (element.closest('[data-cegeclim-header="true"]')) return false

      const computed = window.getComputedStyle(element)
      if (computed.position !== 'fixed') return false
      if (computed.display === 'none' || computed.visibility === 'hidden') return false
      if (Number.parseFloat(computed.opacity || '1') <= 0.01) return false

      const rect = element.getBoundingClientRect()
      const viewportWidth = Math.max(window.innerWidth, 1)
      const viewportHeight = Math.max(window.innerHeight, 1)
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0))
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0))
      const coverage = (visibleWidth * visibleHeight) / (viewportWidth * viewportHeight)

      return (
        coverage >= 0.35 &&
        visibleWidth >= viewportWidth * 0.55 &&
        visibleHeight >= viewportHeight * 0.45
      )
    }

    function refreshFloatingLayerState() {
      animationFrame = 0
      const candidates = Array.from(document.body.querySelectorAll(candidateSelector))
      const nextOpen = candidates.some(isLargeVisibleFixedLayer)
      setPageFloatingLayerOpen((current) => (current === nextOpen ? current : nextOpen))
      document.documentElement.toggleAttribute('data-cegeclim-floating-layer-open', nextOpen)
    }

    function scheduleRefresh() {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(refreshFloatingLayerState)
    }

    const observer = new MutationObserver(scheduleRefresh)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal'],
    })

    window.addEventListener('resize', scheduleRefresh)
    window.addEventListener('cegeclim:floating-layer-change', scheduleRefresh as EventListener)
    scheduleRefresh()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('cegeclim:floating-layer-change', scheduleRefresh as EventListener)
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      document.documentElement.removeAttribute('data-cegeclim-floating-layer-open')
    }
  }, [pathname])


  useEffect(() => {
    function handleStatusScopeChange(event: Event) {
      const detail = (event as CustomEvent<Partial<StatusScopeOverride>>).detail || {}

      if (!detail.active) {
        setStatusScopeOverride(null)
        return
      }

      setStatusScopeOverride({
        active: true,
        agences: parseAllowedAgences(detail.agences),
        collaborateurs: parseAllowedCollaborateurs(detail.collaborateurs),
      })
    }

    window.addEventListener('cegeclim:status-scope-change', handleStatusScopeChange)

    return () => {
      window.removeEventListener('cegeclim:status-scope-change', handleStatusScopeChange)
    }
  }, [])

  useEffect(() => {
    if (!sessionChecked || accessLoading || !hasSession || !email) return
    if (isLoginPage || isUnauthorizedPage || isPdfPrintPage) return
    if (access.loading) return

    const timer = setTimeout(() => {
      void refreshStatusIndicators({ force: true })
    }, 150)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionChecked,
    accessLoading,
    hasSession,
    email,
    isLoginPage,
    isUnauthorizedPage,
    isPdfPrintPage,
    access.loading,
    access.allowedAgences.join('|'),
    access.allowedCollaborateurs.join('|'),
    statusScopeOverride?.agences && Array.isArray(statusScopeOverride.agences) ? statusScopeOverride.agences.join('|') : String(statusScopeOverride?.agences || ''),
    statusScopeOverride?.collaborateurs && Array.isArray(statusScopeOverride.collaborateurs) ? statusScopeOverride.collaborateurs.join('|') : String(statusScopeOverride?.collaborateurs || ''),
  ])

  useEffect(() => {
    function handleWindowFocus() {
      void refreshStatusIndicators({ force: true })
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, sessionChecked, hasSession])

  useEffect(() => {
    if (!sessionChecked || accessLoading || !hasSession || !email) return
    if (isLoginPage || isUnauthorizedPage || isPdfPrintPage) return

    const initialTimer = setTimeout(() => {
      void refreshStatusIndicators({ force: true })
    }, 250)

    const interval = setInterval(() => {
      void refreshStatusIndicators()
    }, 5 * 60 * 1000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked, accessLoading, hasSession, email, isLoginPage, isUnauthorizedPage])

  useEffect(() => {
    if (!sessionChecked || accessLoading || !hasSession || !email) return
    if (!pathname || isLoginPage || isUnauthorizedPage) return

    const routeTimer = setTimeout(() => {
      void refreshStatusIndicators({ force: true })
    }, 250)

    return () => clearTimeout(routeTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sessionChecked, accessLoading, hasSession, email, isLoginPage, isUnauthorizedPage])

  if (isPdfPrintPage) {
    return (
      <>
        {children}
        <Analytics />
      </>
    )
  }

  if (isLoginPage) {
    return (
      <div style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f5f7fa' }}>
        {children}
        <Analytics />
      </div>
    )
  }

  const handleLogout = async () => {
    localStorage.removeItem('cegeclim_last_activity_at')
    await supabase.auth.signOut()
    router.replace('/login')
  }

  async function getUserAccessProfile(): Promise<UserAccessProfile | null> {
    if (!email) return null

    const { data, error } = await supabase
      .from('user_page_access')
      .select('*')
      .ilike('email', email.trim())
      .maybeSingle()

    if (error) {
      console.error('user_page_access status indicators', error)
      return null
    }

    return (data || { email }) as UserAccessProfile
  }

  async function refreshTodoSignal(accessProfile?: UserAccessProfile | null) {
    if (!email) return

    const profile = accessProfile || await getUserAccessProfile()
    const assigneeEmail = (cleanText(profile?.email) || email).toLowerCase()
    const legacyDisplayName = cleanText(profile?.display_name) || email.split('@')[0]
    const assigneeValues = Array.from(new Set([assigneeEmail, legacyDisplayName].map(cleanText).filter(Boolean)))

    if (!assigneeValues.length) {
      setTodoSignal({ status: 'green', count: 0 })
      return
    }

    try {
      const today = todayIso()
      const assignedFilter = assigneeValues
        .map((value) => `assigned_to.eq.${String(value).replace(/,/g, '\\,')}`)
        .join(',')

      const openBase = () => supabase
        .from('todo_actions')
        .select('id', { count: 'exact', head: true })
        .or(assignedFilter)
        .not('status', 'in', '("Terminé","Annulé")')

      const { count: openCount, error: openError } = await openBase()
      if (openError) throw openError

      if (!(openCount || 0)) {
        setTodoSignal({ status: 'green', count: 0 })
        return
      }

      const { count: overdueCount, error: overdueError } = await openBase()
        .not('due_date', 'is', null)
        .lt('due_date', today)

      if (overdueError) throw overdueError

      setTodoSignal({
        status: (overdueCount || 0) > 0 ? 'red' : 'orange',
        count: openCount || 0,
      })
    } catch (error) {
      console.error('todo_actions status indicator', error)
      setTodoSignal({ status: 'green', count: 0 })
    }
  }

  function openTodoList() {
    window.open('/todo', '_blank', 'noopener,noreferrer')
  }

  function mapCerfaRows(rows: Record<string, any>[], tierAgencyByCode: Map<string, string>, allowedAgences: string[]) {
    return rows
      .filter((row) => cleanText(rawValue(row, ['projet', 'Projet'])))
      .filter((row) => {
        if (!allowedAgences.length) return true
        const tierCode = extractLeadingCode(rawValue(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers', 'client_code']))
        const agence = tierAgencyByCode.get(normalizeLoose(tierCode)) || ''
        return agenceMatchesAllowed(agence, allowedAgences)
      })
      .map((row, index) => {
        const numeroTiers = extractLeadingCode(rawValue(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers', 'client_code']))
        return {
          key: buildCerfaKey(row, index),
          raw: row,
          idValue: rawValue(row, ['id', 'ligne_id', 'uuid']) as string | number | null,
          dateFacture: formatDateFr(rawValue(row, ['date_facture', 'date_piece', 'date_document', 'date'])),
          numeroFacture: cleanText(rawValue(row, ['numero_piece', 'num_piece', 'numero_facture', 'facture', 'piece', 'document', 'document_no', 'no_document'])),
          lienFacture: cleanText(rawValue(row, ['lien_blg_doc', 'Lien_BLG_doc', 'url', 'lien', 'lien_doc'])),
          lienTiers: cleanText(rawValue(row, ['lien_blg_tiers', 'Lien_BLG_Tiers', 'url_tiers', 'lien_tiers'])),
          numeroTiers,
          intituleTiers: cleanText(rawValue(row, ['intitule_tiers', 'intitule_tiers_entete', 'nom_tiers', 'libelle_tiers', 'tiers_libelle', 'client', 'raison_sociale'])),
          reference: cleanText(rawValue(row, ['reference_article', 'reference', 'code_article', 'article', 'ref_article'])),
          projet: cleanText(rawValue(row, ['projet', 'Projet'])),
          collaborateur: cleanText(rawValue(row, ['collaborateur', 'collaborateur_tiers', 'collaborateur_facture', 'representant', 'commercial'])),
          agence: cleanText(rawValue(row, ['agence_collaborateur', 'agence', 'depot', 'agence_document'])),
          affaireDraft: cleanText(rawValue(row, ['affaire', 'Affaire'])),
          checked: false,
          saving: false,
        }
      })
  }

  async function refreshCerfaKo(accessProfile?: UserAccessProfile | null, options?: { detail?: boolean }) {
    const profile = accessProfile || await getUserAccessProfile()
    const allowedAgences = parseAllowedAgences((profile as any)?.allowed_agence ?? (profile as any)?.allowed_agences)
    const detail = Boolean(options?.detail)

    if (detail) {
      setCerfaLoading(true)
      setCerfaError(null)
    }

    try {
      const rpcName = detail ? 'get_cerfa_ko_rows_for_user' : 'get_cerfa_ko_count_for_user'
      const rpcAllowedAgences = allowedAgences.length ? allowedAgences : null
      const rpcArgs = detail
        ? { p_email: email, p_allowed_agences: rpcAllowedAgences, p_limit: 1000 }
        : { p_email: email, p_allowed_agences: rpcAllowedAgences }
      const { data: rpcData, error: rpcError } = await supabase.rpc(rpcName, rpcArgs)

      if (!rpcError) {
        if (!detail) {
          const countValue = Array.isArray(rpcData)
            ? Number((rpcData[0] as any)?.count ?? (rpcData[0] as any)?.nb_lignes ?? 0)
            : Number(rpcData ?? 0)
          setCerfaKoCount(Number.isFinite(countValue) ? countValue : 0)
          return
        }

        const rows = ((rpcData || []) as Record<string, any>[]).map((row, index) => ({
          key: buildCerfaKey(row, index),
          raw: row,
          idValue: rawValue(row, ['id', 'ligne_id', 'uuid']) as string | number | null,
          dateFacture: formatDateFr(rawValue(row, ['date_facture', 'date_piece', 'date_document', 'date'])),
          numeroFacture: cleanText(rawValue(row, ['numero_piece', 'num_piece', 'numero_facture', 'facture', 'piece', 'document', 'document_no', 'no_document'])),
          lienFacture: cleanText(rawValue(row, ['lien_blg_doc', 'Lien_BLG_doc', 'url', 'lien', 'lien_doc'])),
          lienTiers: cleanText(rawValue(row, ['lien_blg_tiers', 'Lien_BLG_Tiers', 'url_tiers', 'lien_tiers'])),
          numeroTiers: extractLeadingCode(rawValue(row, ['numero_tiers', 'numero_tiers_entete', 'code_tiers', 'tiers', 'client_code'])),
          intituleTiers: cleanText(rawValue(row, ['intitule_tiers', 'intitule_tiers_entete', 'nom_tiers', 'libelle_tiers', 'tiers_libelle', 'client', 'raison_sociale'])),
          reference: cleanText(rawValue(row, ['reference_article', 'reference', 'code_article', 'article', 'ref_article'])),
          projet: cleanText(rawValue(row, ['projet', 'Projet'])),
          collaborateur: cleanText(rawValue(row, ['collaborateur', 'collaborateur_tiers', 'collaborateur_facture', 'representant', 'commercial'])),
          agence: cleanText(rawValue(row, ['agence_collaborateur', 'agence', 'depot', 'agence_document'])),
          affaireDraft: cleanText(rawValue(row, ['affaire', 'Affaire'])),
          checked: false,
          saving: false,
        }))

        setCerfaRows(rows)
        setCerfaKoCount(rows.length)
        return
      }

      console.warn(`${rpcName} indisponible, fallback limité côté client`, rpcError)

      const selectColumns = [
        'id',
        'date_facture',
        'numero_piece',
        'numero_tiers_entete',
        'intitule_tiers_entete',
        'reference_article',
        'projet',
        'affaire',
      ].join(',')

      const { data: factureRows, error: factureError, count } = await supabase
        .from('facture_lignes')
        .select(detail ? selectColumns : 'id', { count: 'exact', head: !detail })
        .not('projet', 'is', null)
        .neq('projet', '')
        .limit(detail ? 1000 : 1)

      if (factureError) throw factureError

      if (!detail) {
        setCerfaKoCount(count || 0)
        return
      }

      const projetRows = ((factureRows || []) as Record<string, any>[]).filter((row) => cleanText(rawValue(row, ['projet', 'Projet'])))
      const mapped = mapCerfaRows(projetRows, new Map<string, string>(), allowedAgences)
      setCerfaRows(mapped)
      setCerfaKoCount(mapped.length)
    } catch (exception: any) {
      console.error('CERFA KO status indicator', exception)
      if (detail) setCerfaError(exception?.message || String(exception))
      if (detail) setCerfaRows([])
      setCerfaKoCount(0)
    } finally {
      if (detail) setCerfaLoading(false)
    }
  }

  async function refreshCertificationSignals(accessProfile?: UserAccessProfile | null) {
    const allowedAgences = getAllowedAgencesForStatus(accessProfile)
    const allowedCollaborateurs = getAllowedCollaborateursForStatus(accessProfile)

    try {
      const { data, error } = await supabase.rpc('get_client_certification_alert_rows', {
        p_kind: 'capacite',
        p_limit: 10000,
      })

      if (error) throw error

      const enrichedRows = await enrichCertificationRowsWithAgence((data || []) as Record<string, any>[])
      const rows = filterCertificationRowsForAccess(
        enrichedRows,
        allowedAgences,
        allowedCollaborateurs
      )

      const expiredCount = rows.filter((row) => String(row.alert_status || '').toLowerCase() === 'expired').length
      const soonCount = rows.filter((row) => String(row.alert_status || '').toLowerCase() !== 'expired').length
      const count = rows.length

      setCertificationSignals({
        capacite: {
          status: expiredCount > 0 ? 'red' : count > 0 ? 'orange' : 'green',
          count,
          expiredCount,
          soonCount,
        },
      })
    } catch (error) {
      console.error('Alertes certifications clients', error)

      // Sécurité : si l'utilisateur a une restriction et que le détail filtrable échoue,
      // on n'affiche pas le total global afin d'éviter une pastille hors périmètre.
      if (allowedAgences.length > 0 || allowedCollaborateurs.length > 0) {
        setCertificationSignals({
          capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
        })
        return
      }

      try {
        const { data, error: summaryError } = await supabase.rpc('get_client_certification_alert_summary')
        if (summaryError) throw summaryError

        const next: Record<CertificationAlertKind, CertificationSignal> = {
          capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
        }

        ;((data || []) as any[]).forEach((row) => {
          const kind = String(row.kind || '').toLowerCase() as CertificationAlertKind
          if (kind !== 'capacite') return

          next[kind] = {
            status: (row.status || 'green') as StatusLevel,
            count: Number(row.total_count || 0),
            expiredCount: Number(row.expired_count || 0),
            soonCount: Number(row.soon_count || 0),
          }
        })

        setCertificationSignals(next)
      } catch (summaryException) {
        console.error('Résumé alertes certifications clients', summaryException)
        setCertificationSignals({
          capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
        })
      }
    }
  }


  async function refreshControleFraisPortSignal(accessProfile?: UserAccessProfile | null) {
    const allowedAgences = getAllowedAgencesForStatus(accessProfile)
    const allowedCollaborateurs = getAllowedCollaborateursForStatus(accessProfile)

    try {
      const { data, error } = await supabase
        .from('v_controle_frais_port_groupes')
        .select('agences,representants,statut_groupe,nb_bl_a_supprimer,nb_actions')
        .neq('statut_groupe', 'OK')
        .limit(20000)

      if (error) throw error

      const rows = ((data || []) as Record<string, any>[]).filter((row) => {
        const agenceOk = allowedAgences.length === 0 || agenceMatchesAllowed(cleanText(row.agences), allowedAgences)
        const collaborateurOk = allowedCollaborateurs.length === 0 || collaborateurMatchesAllowed(cleanText(row.representants), allowedCollaborateurs)
        return agenceOk && collaborateurOk
      })

      const missingGroups = rows.filter((row) => cleanText(row.statut_groupe) === 'FRAIS_PORT_MANQUANT').length
      const blToRemove = rows.reduce((sum, row) => sum + Number(row.nb_bl_a_supprimer || 0), 0)
      const otherGroups = rows.filter((row) => {
        const status = cleanText(row.statut_groupe)
        return status !== 'FRAIS_PORT_MANQUANT' && Number(row.nb_bl_a_supprimer || 0) <= 0
      }).length
      const count = missingGroups + blToRemove + otherGroups

      setControleFraisPortSignal({
        status: missingGroups > 0 || blToRemove > 0 ? 'red' : otherGroups > 0 ? 'orange' : 'green',
        count,
        missingGroups,
        blToRemove,
        otherGroups,
      })
    } catch (error) {
      console.error('Contrôle frais de port status indicator', error)
      setControleFraisPortSignal({
        status: 'green',
        count: 0,
        missingGroups: 0,
        blToRemove: 0,
        otherGroups: 0,
      })
    }
  }

  function openControleFraisPort() {
    const target = `/portefeuille-livraison?controle=controle-frais-port&open=${Date.now()}`
    router.push(target)
    window.dispatchEvent(new CustomEvent('cegeclim:open-controle-frais-port'))
  }

  async function refreshCdcLivAvant2026Signal(accessProfile?: UserAccessProfile | null) {
    const allowedAgences = getAllowedAgencesForStatus(accessProfile)
    const allowedCollaborateurs = getAllowedCollaborateursForStatus(accessProfile)

    try {
      let query = supabase
        .from('v_portefeuille_livraison_lignes')
        .select('type_document,numero_document,numero_tiers,agence,representant,mois_livraison,date_livraison')
        .eq('type_document', 'CDC')
        .or('mois_livraison.eq.AVANT_2026,date_livraison.lt.2026-01-01')

      if (allowedAgences.length > 0) {
        query = query.in('agence', allowedAgences)
      }

      if (allowedCollaborateurs.length > 0) {
        query = query.in('representant', allowedCollaborateurs)
      }

      const { data, error } = await query.limit(50000)
      if (error) throw error

      const distinctDocuments = new Set(
        ((data || []) as Record<string, any>[]).map((row) => [
          cleanText(row.type_document),
          cleanText(row.numero_document),
          cleanText(row.numero_tiers),
        ].join('::'))
      )

      const countValue = distinctDocuments.size

      setCdcLivAvant2026Signal({
        status: countValue > 0 ? 'red' : 'green',
        count: countValue,
      })
    } catch (error) {
      console.error('CDC livraison avant 2026 status indicator', error)
      setCdcLivAvant2026Signal({ status: 'green', count: 0 })
    }
  }

  function openCdcLivAvant2026() {
    router.push('/portefeuille-livraison')
  }

  async function openCertificationModal(kind: CertificationAlertKind) {
    setCertificationModalKind(kind)
    setCertificationModalOpen(true)
    setCertificationLoading(true)
    setCertificationError(null)

    try {
      const profile = await getUserAccessProfile()
      const allowedAgences = getAllowedAgencesForStatus(profile)
      const allowedCollaborateurs = getAllowedCollaborateursForStatus(profile)

      const { data, error } = await supabase.rpc('get_client_certification_alert_rows', {
        p_kind: kind,
        p_limit: 10000,
      })

      if (error) throw error

      const enrichedRows = await enrichCertificationRowsWithAgence((data || []) as Record<string, any>[])
      const rows = filterCertificationRowsForAccess(
        enrichedRows,
        allowedAgences,
        allowedCollaborateurs
      ) as CertificationAlertRow[]

      setCertificationRows(rows)

      const expiredCount = rows.filter((row) => String(row.alert_status || '').toLowerCase() === 'expired').length
      const soonCount = rows.length - expiredCount
      setCertificationSignals((current) => ({
        ...current,
        [kind]: {
          status: expiredCount > 0 ? 'red' : rows.length > 0 ? 'orange' : 'green',
          count: rows.length,
          expiredCount,
          soonCount,
        },
      }))
    } catch (error: any) {
      console.error('Détail alertes certifications clients', error)
      setCertificationRows([])
      setCertificationError(error?.message || String(error))
    } finally {
      setCertificationLoading(false)
    }
  }

  async function refreshStatusIndicators(options?: { force?: boolean }) {
    if (!email || isLoginPage || isUnauthorizedPage) return
    if (!hasVisibleStatusLights) return

    const now = Date.now()
    if (!options?.force && now - lastStatusRefreshRef.current < 60_000) return
    lastStatusRefreshRef.current = now

    const profile = await getUserAccessProfile()
    const tasks: Promise<unknown>[] = []

    if (rights.show_alert_todo) {
      tasks.push(refreshTodoSignal(profile))
    } else {
      setTodoSignal({ status: 'green', count: 0 })
    }

    if (rights.show_alert_cerfa_ko) {
      tasks.push(refreshCerfaKo(profile, { detail: false }))
    } else {
      setCerfaKoCount(0)
      setCerfaRows([])
      setCerfaModalOpen(false)
    }

    if (rights.show_alert_capacite_gaz) {
      tasks.push(refreshCertificationSignals(profile))
    } else {
      setCertificationSignals({
        capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
      })
      setCertificationModalOpen(false)
    }

    if (rights.show_alert_cdc_liv_avant_2026) {
      tasks.push(refreshCdcLivAvant2026Signal(profile))
    } else {
      setCdcLivAvant2026Signal({ status: 'green', count: 0 })
    }

    if (rights.show_alert_controle_frais_port) {
      tasks.push(refreshControleFraisPortSignal(profile))
    } else {
      setControleFraisPortSignal({
        status: 'green',
        count: 0,
        missingGroups: 0,
        blToRemove: 0,
        otherGroups: 0,
      })
    }

    await Promise.all(tasks)
  }

  async function openCerfaModal() {
    setCerfaModalOpen(true)
    await refreshCerfaKo(undefined, { detail: true })
  }

  function updateCerfaRow(key: string, patch: Partial<CerfaKoRow>) {
    setCerfaRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  }

  async function validateCerfaRow(row: CerfaKoRow) {
    const affaire = cleanText(row.affaireDraft)
    if (!row.checked) {
      alert('Coche la ligne à régulariser avant de valider.')
      return
    }
    if (!affaire) {
      alert('Renseigne le champ Affaire avant de valider.')
      return
    }

    updateCerfaRow(row.key, { saving: true })

    try {
      const { data, error } = await supabase.rpc('validate_cerfa_ko_line', {
        p_row_locator: cleanText(row.idValue),
        p_numero_piece: row.numeroFacture || null,
        p_numero_tiers: row.numeroTiers || null,
        p_reference_article: row.reference || null,
        p_projet: row.projet || null,
        p_affaire: affaire,
      })

      if (error) throw error
      if (!Number(data || 0)) throw new Error('Aucune ligne CERFA n’a été mise à jour. Actualise la liste puis réessaie.')

      setCerfaRows((current) => current.filter((item) => item.key !== row.key))
      setCerfaKoCount((count) => Math.max(0, count - 1))
      void refreshStatusIndicators({ force: true })
    } catch (exception: any) {
      console.error('Validation CERFA KO', exception)
      alert(`Impossible d'enregistrer la régularisation CERFA : ${exception?.message || exception}`)
      updateCerfaRow(row.key, { saving: false })
    }
  }

  return (
    <div
      style={{
        ...styles.app,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.75), rgba(255,255,255,0.92)), url("${backgroundImageUrl}")`,
      }}
    >
      <AutoLogout />

      <div style={styles.overlay}>
        <header
          data-cegeclim-header="true"
          style={{
            ...styles.header,
            ...(pageFloatingLayerOpen ? styles.headerHiddenForFloatingLayer : {}),
          }}
        >
          <div style={styles.top}>
            <div style={styles.left}>
              <img
                src="https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0"
                style={styles.logo}
                alt="CEGECLIM"
              />
              <div>
                <div style={styles.subtitle}>
                  Concessionnaire agréé de Bosch Home Comfort Group
                </div>
                <div style={styles.title}>Hitachi Cooling & Heating</div>
              </div>
            </div>

            <div style={styles.center}>
              SUIVI COMMERCIAL & PROSPECT
            </div>

            <div style={styles.right}>
              <div style={styles.rightUserBlock}>
                <select
                  value={societeFilter}
                  onChange={(e) => setSocieteFilter(e.target.value as SocieteFilter)}
                  disabled={!rights.can_change_scope || (rights.allowed_scopes || []).length <= 1}
                  title={rights.can_change_scope ? 'Changer de société' : 'Changement de société non autorisé par le profil'}
                  style={{
                    ...styles.select,
                    ...(!rights.can_change_scope || (rights.allowed_scopes || []).length <= 1
                      ? styles.selectDisabled
                      : {}),
                  }}
                >
                  {(rights.allowed_scopes || ['Global']).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <button onClick={handleLogout} style={styles.logout}>
                  Déconnexion
                </button>

                {email && <div style={styles.userEmail}>{email}</div>}
                <div style={styles.userProfile}>
                  Profil : {rights.profile_name || 'Aucun profil'}
                </div>
              </div>
            </div>
          </div>

          {(menuGroups.some(isGroupVisible) || hasVisibleStatusLights) && (
            <div style={styles.nav}>
              <div style={styles.navMenu}>
                {menuGroups.filter(isGroupVisible).map((group) => {
                  const visibleItems = getVisibleItems(group)

                  return (
                    <div
                      key={group.label}
                      style={styles.menuWrapper}
                      onMouseEnter={() => {
                        if (hoverTimeout) clearTimeout(hoverTimeout)
                        setOpenGroup(group.label)
                      }}
                      onMouseLeave={() => {
                        const t = setTimeout(() => setOpenGroup(null), 150)
                        setHoverTimeout(t)
                      }}
                    >
                      <button
                        style={{
                          ...styles.navBtn,
                          ...(isGroupActive(group) ? styles.navBtnActive : {}),
                        }}
                      >
                        {group.label} ▼
                      </button>

                      {openGroup === group.label && (
                        <div style={styles.dropdown}>
                          {visibleItems.map((item) => (
                            <div
                              key={item.path}
                              style={styles.dropdownItem}
                              onClick={() => router.push(item.path)}
                            >
                              {item.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {hasVisibleStatusLights && (
                <div style={styles.statusLightsRow}>
                  {rights.show_alert_cerfa_ko && (
                    <StatusLight
                      label="CERFA"
                      status={cerfaKoCount > 0 ? 'red' : 'green'}
                      count={cerfaKoCount}
                      blink={cerfaKoCount > 0 && statusBlinkOn}
                      clickable={cerfaKoCount > 0}
                      onClick={openCerfaModal}
                      title={cerfaKoCount > 0 ? 'Ouvrir la liste des CERFA KO en attente de régularisation' : 'Aucun CERFA KO'}
                    />
                  )}

                  {rights.show_alert_cdc_liv_avant_2026 && (
                    <StatusLight
                      label="CDC liv avant 2026"
                      status={cdcLivAvant2026Signal.status}
                      count={cdcLivAvant2026Signal.count}
                      blink={cdcLivAvant2026Signal.status === 'red' && statusBlinkOn}
                      clickable={cdcLivAvant2026Signal.count > 0}
                      onClick={openCdcLivAvant2026}
                      title={
                        cdcLivAvant2026Signal.count > 0
                          ? `${cdcLivAvant2026Signal.count} CDC avec livraison avant 2026`
                          : 'Aucun CDC avec livraison avant 2026'
                      }
                    />
                  )}

                  {rights.show_alert_controle_frais_port && (
                    <StatusLight
                      label="Contrôle frais de port"
                      status={controleFraisPortSignal.status}
                      count={controleFraisPortSignal.count}
                      blink={controleFraisPortSignal.status !== 'green' && statusBlinkOn}
                      clickable
                      onClick={openControleFraisPort}
                      title={
                        controleFraisPortSignal.count > 0
                          ? `${controleFraisPortSignal.count} action(s) : ${controleFraisPortSignal.missingGroups} groupe(s) sans port, ${controleFraisPortSignal.blToRemove} BL à supprimer, ${controleFraisPortSignal.otherGroups} autre(s) groupe(s) à vérifier — cliquer pour afficher`
                          : 'Ouvrir le contrôle groupé des frais de port dans le portefeuille livraison'
                      }
                    />
                  )}

                  {rights.show_alert_capacite_gaz && (
                    <StatusLight
                      label="Capacité gaz"
                      status={certificationSignals.capacite.status}
                      count={certificationSignals.capacite.count}
                      blink={certificationSignals.capacite.status === 'orange' && statusBlinkOn}
                      clickable={certificationSignals.capacite.count > 0}
                      onClick={() => openCertificationModal('capacite')}
                      title={
                        certificationSignals.capacite.count > 0
                          ? `Capacité gaz : ${certificationSignals.capacite.count} validité(s) à moins d’un mois sur le périmètre actif`
                          : 'Aucune capacité gaz à échéance dans moins d’un mois'
                      }
                    />
                  )}

                  {rights.show_alert_todo && (
                    <StatusLight
                      label="A faire"
                      status={todoSignal.status}
                      count={todoSignal.count}
                      blink={todoSignal.status === 'red' && statusBlinkOn}
                      clickable
                      onClick={openTodoList}
                      title={todoSignal.count > 0 ? 'Ouvrir la TODO List dans un nouvel onglet' : 'Aucune tâche à faire — cliquer pour ouvrir la TODO List'}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </header>

        {cerfaModalOpen && (
          <div style={styles.modalBackdrop}>
            <div style={styles.cerfaModal}>
              <div style={styles.modalHeader}>
                <div>
                  <div style={styles.modalTitle}>Liste des CERFA KO en attente de régularisation</div>
                  <div style={styles.modalSubtitle}>{cerfaRows.length} ligne(s) à traiter</div>
                </div>
                <div style={styles.modalActions}>
                  <button type="button" onClick={() => refreshCerfaKo(undefined, { detail: true })} style={styles.modalSecondaryButton}>Actualiser</button>
                  <button type="button" onClick={() => setCerfaModalOpen(false)} style={styles.modalCloseButton}>Fermer</button>
                </div>
              </div>

              {cerfaLoading && <div style={styles.modalInfo}>Chargement des lignes CERFA…</div>}
              {cerfaError && <div style={styles.modalError}>Erreur CERFA : {cerfaError}</div>}

              <div style={styles.modalTableWrapper}>
                <table style={styles.cerfaTable}>
                  <thead>
                    <tr>
                      <th style={styles.cerfaTh}>Date facture</th>
                      <th style={styles.cerfaTh}>N° facture</th>
                      <th style={styles.cerfaTh}>N° Tiers</th>
                      <th style={styles.cerfaTh}>Désignation du Tiers</th>
                      <th style={styles.cerfaTh}>Référence</th>
                      <th style={styles.cerfaTh}>Agence</th>
                      <th style={styles.cerfaTh}>Collaborateur</th>
                      <th style={styles.cerfaTh}>Projet</th>
                      <th style={styles.cerfaTh}>Affaire</th>
                      <th style={styles.cerfaTh}>OK</th>
                      <th style={styles.cerfaTh}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cerfaRows.length === 0 && !cerfaLoading ? (
                      <tr>
                        <td colSpan={11} style={styles.cerfaEmptyCell}>Aucune ligne CERFA KO à régulariser.</td>
                      </tr>
                    ) : cerfaRows.map((row) => (
                      <tr key={row.key}>
                        <td style={styles.cerfaTd}>{row.dateFacture}</td>
                        <td style={styles.cerfaTdStrong}>
                          {row.lienFacture ? (
                            <a href={row.lienFacture} target="_blank" rel="noopener noreferrer" style={styles.cerfaLink}>
                              {row.numeroFacture || '—'}
                            </a>
                          ) : (
                            row.numeroFacture || '—'
                          )}
                        </td>
                        <td style={styles.cerfaTdStrong}>
                          {row.lienTiers ? (
                            <a href={row.lienTiers} target="_blank" rel="noopener noreferrer" style={styles.cerfaLink}>
                              {row.numeroTiers || '—'}
                            </a>
                          ) : (
                            row.numeroTiers || '—'
                          )}
                        </td>
                        <td style={styles.cerfaTd}>{row.intituleTiers || '—'}</td>
                        <td style={styles.cerfaTd}>{row.reference || '—'}</td>
                        <td style={styles.cerfaTd}>{row.agence || '—'}</td>
                        <td style={styles.cerfaTd}>{row.collaborateur || '—'}</td>
                        <td style={styles.cerfaTd}>{row.projet}</td>
                        <td style={styles.cerfaTd}>
                          <input
                            value={row.affaireDraft}
                            onChange={(event) => updateCerfaRow(row.key, { affaireDraft: event.target.value })}
                            placeholder="Commentaire / affaire"
                            style={styles.cerfaInput}
                          />
                        </td>
                        <td style={styles.cerfaTdCenter}>
                          <input
                            type="checkbox"
                            checked={row.checked}
                            onChange={(event) => updateCerfaRow(row.key, { checked: event.target.checked })}
                          />
                        </td>
                        <td style={styles.cerfaTdCenter}>
                          <button
                            type="button"
                            onClick={() => validateCerfaRow(row)}
                            disabled={row.saving}
                            style={styles.cerfaOkButton}
                          >
                            {row.saving ? '...' : 'OK'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {certificationModalOpen && (
          <div style={styles.modalBackdrop}>
            <div style={styles.cerfaModal}>
              <div style={styles.modalHeader}>
                <div>
                  <div style={styles.modalTitle}>
                    Clients CEGECLIM capacité gaz à surveiller
                  </div>
                  <div style={styles.modalSubtitle}>
                    {certificationRows.length} client(s) actif(s) avec une fin de validité dans moins d’un mois
                  </div>
                </div>
                <div style={styles.modalActions}>
                  <button
                    type="button"
                    onClick={() => openCertificationModal(certificationModalKind)}
                    style={styles.modalSecondaryButton}
                  >
                    Actualiser
                  </button>
                  <button
                    type="button"
                    onClick={() => setCertificationModalOpen(false)}
                    style={styles.modalCloseButton}
                  >
                    Fermer
                  </button>
                </div>
              </div>

              {certificationLoading && <div style={styles.modalInfo}>Chargement des alertes…</div>}
              {certificationError && <div style={styles.modalError}>Erreur : {certificationError}</div>}

              <div style={styles.modalTableWrapper}>
                <table style={{ ...styles.cerfaTable, minWidth: 1680 }}>
                  <thead>
                    <tr>
                      <th style={styles.cerfaTh}>Date validité clients</th>
                      <th style={styles.cerfaTh}>Date validité ref_tiers</th>
                      <th style={styles.cerfaTh}>Statut</th>
                      <th style={styles.cerfaTh}>N° tiers</th>
                      <th style={styles.cerfaTh}>Désignation</th>
                      <th style={styles.cerfaTh}>Département</th>
                      <th style={styles.cerfaTh}>Agence</th>
                      <th style={styles.cerfaTh}>Représentant</th>
                      <th style={styles.cerfaTh}>SIRET</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificationRows.length === 0 && !certificationLoading ? (
                      <tr>
                        <td colSpan={9} style={styles.cerfaEmptyCell}>
                          Aucune alerte.
                        </td>
                      </tr>
                    ) : certificationRows.map((row) => (
                      <tr key={`${row.kind}-${row.siret}-${row.date_validite_client || row.date_validite || 'na'}`}>
                        <td style={styles.cerfaTdStrong}>{formatDateFr(row.date_validite_client || row.date_validite)}</td>
                        <td style={styles.cerfaTdStrong}>{formatDateFr(row.date_validite_ref_tiers) || '—'}</td>
                        <td
                          style={{
                            ...styles.cerfaTdStrong,
                            color: '#c2410c',
                          }}
                        >
                          {`Expire dans ${Number(row.jours_ecart || 0)} j`}
                        </td>
                        <td style={styles.cerfaTdStrong}>{row.numero_tiers || '—'}</td>
                        <td style={styles.cerfaTd}>{row.designation || '—'}</td>
                        <td style={styles.cerfaTd}>{row.departement || '—'}</td>
                        <td style={styles.cerfaTdStrong}>{row.agence || row.agence_rattachement || row.agence_collaborateur || '—'}</td>
                        <td style={styles.cerfaTd}>{row.representant || '—'}</td>
                        <td style={styles.cerfaTd}>{row.siret || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <main
          style={{
            ...styles.content,
            ...(isPortefeuilleLivraisonPage ? styles.contentFullWidth : {}),
          }}
        >
          {children}
        </main>
      </div>

      <Analytics />
    </div>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPdfPrintPage =
    pathname === '/focus_mensuel_print' ||
    pathname.startsWith('/focus_mensuel_print/')

  if (isPdfPrintPage) {
    return (
      <html>
        <body>
          {children}
          <Analytics />
        </body>
      </html>
    )
  }

  return (
    <html>
      <body>
        <AccessProvider>
          <SocieteFilterProvider>
            <AppShell>{children}</AppShell>
          </SocieteFilterProvider>
        </AccessProvider>
      </body>
    </html>
  )
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    backgroundSize: 'cover',
  },

  overlay: {
    // Ne pas utiliser backdrop-filter sur le conteneur global : il crée un
    // contexte d'empilement et un contenant pour position: fixed, ce qui peut
    // enfermer les modales des pages sous le bandeau sticky.
    minHeight: '100vh',
  },

  header: {
    position: 'sticky',
    top: 0,
    zIndex: 30,
    width: '100%',
    background: 'rgba(255,255,255,0.86)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
    pointerEvents: 'auto',
  },

  headerHiddenForFloatingLayer: {
    // Masquage réel, et non simple baisse du z-index : certaines pages créent
    // leur propre contexte d'empilement et ne pourraient toujours pas dépasser
    // un header sticky positif. Le bandeau revient automatiquement à la fermeture.
    opacity: 0,
    visibility: 'hidden',
    pointerEvents: 'none',
    transform: 'translateY(-100%)',
    transition: 'none',
  },

  top: {
    position: 'relative',
    zIndex: 3,
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 20px',
    alignItems: 'center',
    pointerEvents: 'auto',
  },

  left: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },

  logo: {
    width: 130,
  },

  subtitle: {
    fontSize: 16,
  },

  title: {
    fontSize: 22,
    fontWeight: 800,
  },

  center: {
    fontWeight: 800,
    fontSize: 20,
    color: '#17344d',
  },

  right: {
    position: 'relative',
    zIndex: 5,
    display: 'flex',
    gap: 10,
    pointerEvents: 'auto',
  },

  rightUserBlock: {
    position: 'relative',
    zIndex: 6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
    pointerEvents: 'auto',
  },

  userEmail: {
    fontSize: 13,
    color: '#17344d',
  },

  userProfile: {
    fontSize: 12,
    fontWeight: 700,
    color: '#5b7285',
    background: 'rgba(238, 247, 251, 0.95)',
    border: '1px solid rgba(94, 167, 195, 0.28)',
    borderRadius: 999,
    padding: '3px 8px',
  },

  select: {
    position: 'relative',
    zIndex: 7,
    padding: 6,
    borderRadius: 8,
    pointerEvents: 'auto',
  },

  selectDisabled: {
    cursor: 'not-allowed',
    opacity: 0.65,
    background: '#eef2f6',
  },

  navBtnActive: {
    color: '#5ea7c3',
    background: 'rgba(238,247,251,0.95)',
    borderRadius: 12,
    padding: '6px 12px',
  },

  logout: {
    position: 'relative',
    zIndex: 7,
    background: '#fff',
    borderRadius: 8,
    padding: '6px 10px',
    cursor: 'pointer',
    border: '1px solid #d0d7de',
    pointerEvents: 'auto',
  },

  statusCard: {
    minWidth: 96,
    minHeight: 30,
    borderRadius: 11,
    border: '1px solid rgba(15, 23, 42, 0.08)',
    padding: '5px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    background: 'rgba(255,255,255,0.92)',
    boxShadow: '0 6px 16px rgba(15, 23, 42, 0.07)',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease',
  },

  statusCardRed: {
    border: '1px solid rgba(239, 68, 68, 0.28)',
    boxShadow: '0 0 0 1px rgba(239,68,68,0.08), 0 0 16px rgba(239,68,68,0.22)',
  },

  statusCardGreen: {
    border: '1px solid rgba(34, 197, 94, 0.24)',
    boxShadow: '0 0 0 1px rgba(34,197,94,0.08), 0 0 14px rgba(34,197,94,0.16)',
  },

  statusCardOrange: {
    border: '1px solid rgba(245, 158, 11, 0.32)',
    boxShadow: '0 0 0 1px rgba(245,158,11,0.09), 0 0 15px rgba(245,158,11,0.24)',
  },

  statusCardBlink: {
    opacity: 0.9,
    transform: 'translateY(-1px)',
  },

  statusCardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  statusCardLabel: {
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    lineHeight: 1,
  },

  statusCardLabelRed: {
    color: '#b91c1c',
  },

  statusCardLabelGreen: {
    color: '#166534',
  },

  statusCardLabelOrange: {
    color: '#b45309',
  },

  statusLightDot: {
    width: 11,
    height: 11,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  },

  statusLightDotRed: {
    background: '#ef4444',
    boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.12), 0 0 14px rgba(239, 68, 68, 0.95)',
  },

  statusLightDotGreen: {
    background: '#22c55e',
    boxShadow: '0 0 0 2px rgba(34, 197, 94, 0.12), 0 0 12px rgba(34, 197, 94, 0.85)',
  },

  statusLightDotOrange: {
    background: '#f59e0b',
    boxShadow: '0 0 0 2px rgba(245, 158, 11, 0.14), 0 0 12px rgba(245, 158, 11, 0.9)',
  },

  statusLightDotBlink: {
    boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.18), 0 0 20px rgba(239, 68, 68, 1)',
  },

  statusBadge: {
    minWidth: 23,
    height: 23,
    borderRadius: 999,
    padding: '0 7px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 900,
  },

  statusBadgeRed: {
    background: '#fee2e2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
  },

  statusBadgeGreen: {
    background: '#dcfce7',
    color: '#166534',
    border: '1px solid #bbf7d0',
  },

  statusBadgeOrange: {
    background: '#fef3c7',
    color: '#b45309',
    border: '1px solid #fde68a',
  },

  statusOkText: {
    fontSize: 11,
    fontWeight: 800,
    opacity: 0.85,
  },

  nav: {
    position: 'relative',
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 20px 8px',
    overflow: 'visible',
    minHeight: 42,
    pointerEvents: 'none',
  },

  navMenu: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    pointerEvents: 'auto',
  },

  statusLightsRow: {
    position: 'absolute',
    right: 20,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    pointerEvents: 'auto',
  },

  navBtn: {
    background: 'transparent',
    border: 'none',
    fontWeight: 700,
    cursor: 'pointer',
    pointerEvents: 'auto',
  },

  menuWrapper: {
    position: 'relative',
    zIndex: 4,
    paddingBottom: 10,
    pointerEvents: 'auto',
  },

  dropdown: {
    position: 'absolute',
    top: 36,
    left: 0,
    background: '#d8dadf',
    borderRadius: 12,
    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
    whiteSpace: 'nowrap',
    minWidth: 'max-content',
    zIndex: 10,
    pointerEvents: 'auto',
  },

  dropdownItem: {
    padding: 10,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
  },

  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    // Les fenêtres propres au layout doivent recouvrir le bandeau commun.
    zIndex: 1000,
    background: 'rgba(15, 23, 42, 0.35)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '96px 12px 18px',
  },

  cerfaModal: {
    width: 'min(1960px, 99vw)',
    maxHeight: '86vh',
    overflow: 'hidden',
    borderRadius: 18,
    background: '#fff',
    boxShadow: '0 25px 70px rgba(15, 23, 42, 0.35)',
    border: '1px solid rgba(226, 232, 240, 1)',
  },

  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    padding: '18px 20px',
    borderBottom: '1px solid #e2e8f0',
  },

  modalTitle: {
    fontSize: 20,
    fontWeight: 900,
    color: '#0f172a',
  },

  modalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: 700,
    color: '#64748b',
  },

  modalActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },

  modalSecondaryButton: {
    border: '1px solid #cbd5e1',
    background: '#fff',
    borderRadius: 10,
    padding: '8px 12px',
    fontWeight: 800,
    cursor: 'pointer',
  },

  modalCloseButton: {
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#fff',
    borderRadius: 10,
    padding: '8px 12px',
    fontWeight: 900,
    cursor: 'pointer',
  },

  modalInfo: {
    margin: '12px 20px',
    padding: 12,
    borderRadius: 12,
    background: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: 800,
  },

  modalError: {
    margin: '12px 20px',
    padding: 12,
    borderRadius: 12,
    background: '#fef2f2',
    color: '#b91c1c',
    fontWeight: 800,
  },

  modalTableWrapper: {
    maxHeight: 'calc(86vh - 88px)',
    overflow: 'auto',
    padding: '0 20px 20px',
  },

  cerfaTable: {
    width: '100%',
    minWidth: 1800,
    borderCollapse: 'collapse',
    fontSize: 13,
  },

  cerfaTh: {
    position: 'sticky',
    top: 0,
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    padding: '10px 8px',
    textAlign: 'left',
    fontWeight: 900,
    color: '#0f172a',
    zIndex: 1,
  },

  cerfaTd: {
    border: '1px solid #e2e8f0',
    padding: '8px',
    verticalAlign: 'middle',
    color: '#0f172a',
  },

  cerfaLink: {
    color: '#2563eb',
    textDecoration: 'underline',
    fontWeight: 900,
  },

  cerfaTdStrong: {
    border: '1px solid #e2e8f0',
    padding: '8px',
    verticalAlign: 'middle',
    color: '#0f172a',
    fontWeight: 900,
  },

  cerfaTdCenter: {
    border: '1px solid #e2e8f0',
    padding: '8px',
    textAlign: 'center',
    verticalAlign: 'middle',
  },

  cerfaEmptyCell: {
    border: '1px solid #e2e8f0',
    padding: 24,
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 800,
  },

  cerfaInput: {
    width: '100%',
    minWidth: 220,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '7px 9px',
    outline: 'none',
  },

  cerfaOkButton: {
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    borderRadius: 8,
    padding: '7px 11px',
    fontWeight: 900,
    cursor: 'pointer',
  },

  content: {
    position: 'relative',
    // Ne pas créer de contexte d'empilement : les modales/fenêtres fixes
    // déclarées dans les pages peuvent ainsi passer au-dessus du header.
    zIndex: 'auto',
    width: '100%',
    minWidth: 0,
    padding: 20,
  },

  contentFullWidth: {
    padding: '4px 2px 16px',
    maxWidth: 'none',
    overflowX: 'hidden',
  },
}