  'use client'

  import { useEffect, useRef, useState } from 'react'
  import type React from 'react'
  import { usePathname, useRouter } from 'next/navigation'
  import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
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

  const fontDisplay = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' })
  const fontBody = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
  const fontMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' })

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
    activeLabel?: string
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
    compact?: boolean
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

  function StatusLight({
    label,
    status,
    count,
    blink = false,
    clickable = false,
    onClick,
    title,
    compact = false,
  }: StatusLightProps) {
    const isRed = status === 'red'
    const isOrange = status === 'orange'

    const shellStyle = {
      ...styles.statusCard,
      ...(isRed ? styles.statusCardRed : isOrange ? styles.statusCardOrange : styles.statusCardGreen),
      ...(blink ? styles.statusCardBlink : {}),
      ...(compact ? styles.statusCardCompact : {}),
      cursor: clickable ? 'pointer' : 'default',
    } as React.CSSProperties

    const lightStyle = {
      ...styles.statusLightDot,
      ...(isRed ? styles.statusLightDotRed : isOrange ? styles.statusLightDotOrange : styles.statusLightDotGreen),
      ...(blink ? styles.statusLightDotBlink : {}),
    } as React.CSSProperties

    const badgeStyle = {
      ...styles.statusBadge,
      ...(isRed ? styles.statusBadgeRed : isOrange ? styles.statusBadgeOrange : styles.statusBadgeGreen),
    } as React.CSSProperties

    return (
      <button
        type="button"
        className="cgcAlerte"
        onClick={clickable ? onClick : undefined}
        style={shellStyle}
        title={title || (clickable ? `Ouvrir ${label}` : `${label} : rien à traiter`)}
      >
        <span style={lightStyle} />
        <span style={styles.statusCardLabel}>{label}</span>
        {typeof count === 'number' && count > 0 ? (
          <span style={badgeStyle}>{count}</span>
        ) : (
          /* Au vert, pas de compteur mis en avant : seuls les chiffres qui
            appellent une action attirent l'œil sur la réglette. */
          <span style={styles.statusOkText}>OK</span>
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
    const [headerHiddenForScroll, setHeaderHiddenForScroll] = useState(false)
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

    const visibleAlertCount = [
      rights.show_alert_cerfa_ko,
      rights.show_alert_cdc_liv_avant_2026,
      rights.show_alert_controle_frais_port,
      rights.show_alert_capacite_gaz,
      rights.show_alert_todo,
    ].filter(Boolean).length

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

    const isMenuItemActive = (item: MenuItem) =>
      pathname === item.path ||
      (item.path !== '/' && pathname.startsWith(`${item.path}/`))

    const getActiveMenuItem = (group: MenuGroup) =>
      getVisibleItems(group).find(isMenuItemActive)

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
          { label: '1 : Prospects / Clients', path: '/carte', accessKey: 'can_carte' },
          { label: '2 : Région-Dépt.', path: '/territoire', accessKey: 'can_territoire' },
          { label: '3 : Agences', path: '/agences', accessKey: 'can_agences' },
          { label: '4 : Cartographie', path: '/cartographie', accessKey: 'can_cartographie' },
        ],
      },
      {
        label: 'Tableaux de bord',
        items: [
          {label: '1 : OnePage',activeLabel: 'OnePage',path: '/tableaux-de-bord/vision-tci',accessKey: 'can_dashboard',},
          {label: '2 : Activite Quotidienne',activeLabel: 'Activite Quotidienne',path: '/focus_mensuel2',accessKey: 'can_dashboard',},
          { label: '3 : Suivi Multi Clients', path: '/synthese_multi_clients', accessKey: 'can_dashboard' },
          {label: '4 : Vision client 360',activeLabel: 'Vision client',path: '/vision-client',accessKey: 'can_dashboard',},
          { label: '5 : Tableaux de bord', path: '/atelier-analyse', accessKey: 'can_dashboard' },
          { label: '6 : Portefeuille cde', path: '/portefeuille-livraison', accessKey: 'can_dashboard' },
          { label: '7 : Courbes Flux Devis-CDC-BL-Fact', path: '/approvisionnements', accessKey: 'can_dashboard' },
          { label: '8 : Analyse IA', path: '/atelier-analyse/assistant', accessKey: 'can_autorisation' },
          { label: '9 : Projection Stock', path: '/stocks-disponibilites2', accessKey: 'can_stocks' },
          { label: '10 : Analyse Devis', path: '/cycle-documents', accessKey: 'can_dashboard' },
          { label: '11 : Indicateurs', path: '/Indicateurs', accessKey: 'can_autorisation' },
        ],
      },
 {
        label: 'TODO List',
        items: [
          { label: '1 : Todo List', path: '/todo', accessKey: 'can_todo' },
          { label: '2: Documents', path: '/documents', accessKey: 'can_documents' },
        ],
      },
      {
        label: 'Admin',
        items: [
          { label: '1 : Profils et autorisation', path: '/autorisation', accessKey: 'can_autorisation' },
          { label: '2 : MAJ Base clients', path: '/clients', accessKey: 'can_autorisation' },
          { label: '3 : MAJ Données Activité', path: '/Import', accessKey: 'can_autorisation' },
          { label: '4 : Job scheduling', path: '/admin/planification', accessKey: 'can_autorisation' },

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
      // Masque le bandeau au scroll vers le bas, le réaffiche au scroll vers
      // le haut ou en haut de page — indépendant de la détection de couche
      // flottante ci-dessous (les deux mécanismes se combinent en OR au rendu).
      if (typeof window === 'undefined') return
      let lastY = window.scrollY

      function onScroll() {
        const y = window.scrollY
        if (y < 80) setHeaderHiddenForScroll(false)
        else if (y > lastY + 4) setHeaderHiddenForScroll(true)
        else if (y < lastY - 4) setHeaderHiddenForScroll(false)
        lastY = y
      }

      window.addEventListener('scroll', onScroll, { passive: true })
      return () => window.removeEventListener('scroll', onScroll)
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
  function handleOpenCerfaKo() {
    void openCerfaModal();
  }

  window.addEventListener('cegeclim:open-cerfa-ko', handleOpenCerfaKo);

  return () => {
    window.removeEventListener('cegeclim:open-cerfa-ko', handleOpenCerfaKo);
  };
}, [])
const lastAppliedScopeSignatureRef = useRef<string | null>(null)
    useEffect(() => {
      if (!sessionChecked || accessLoading || !hasSession || !email) return
      if (isLoginPage || isUnauthorizedPage || isPdfPrintPage) return
      if (access.loading) return

      const scopeSignature = [
        email,
        access.allowedAgences.join('|'),
        access.allowedCollaborateurs.join('|'),
        statusScopeOverride?.agences && Array.isArray(statusScopeOverride.agences) ? statusScopeOverride.agences.join('|') : String(statusScopeOverride?.agences || ''),
        statusScopeOverride?.collaborateurs && Array.isArray(statusScopeOverride.collaborateurs) ? statusScopeOverride.collaborateurs.join('|') : String(statusScopeOverride?.collaborateurs || ''),
      ].join('::')

      // Le périmètre effectif n'a pas changé depuis le dernier calcul :
      // rien à refaire, même si access.loading a fait un aller-retour
      // (ex. revalidation au retour de focus sur la fenêtre).
      if (lastAppliedScopeSignatureRef.current === scopeSignature) return
      lastAppliedScopeSignatureRef.current = scopeSignature

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
        <div style={{ margin: 0 }}>
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
      // Même en force=true : absorbe les appels quasi simultanés (montage,
      // changement de session/périmètre et changement de page se déclenchent
      // tous à 150-250ms d'écart au premier chargement). Un vrai changement de
      // page ou un retour de focus survient largement au-delà de cette fenêtre.
      if (options?.force && now - lastStatusRefreshRef.current < 800) return
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
        className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
        style={{
          ...styles.app,
          // La photo de maison reste, mais à l'état de texture sous un voile
          // marine quasi opaque : elle porte l'identité sans concurrencer les
          // panneaux de données.
          backgroundImage: `linear-gradient(rgba(11,18,32,0.965), rgba(11,18,32,0.985)), url("${backgroundImageUrl}")`,
        }}
      >
        <AutoLogout />

        {/* Survols : impossibles en style inline, regroupés ici plutôt que
            dispersés dans globals.css. */}
        <style>{`
          .cgcNavBtn:hover { background: rgba(255,255,255,0.05); }
          .cgcNavBtn:hover .cgcNavLabel { color: #fff; }
          .cgcAlerte:hover { border-color: rgba(255,255,255,0.24); filter: brightness(1.12); }
          .cgcMenuItem:hover { background: rgba(255,255,255,0.07); color: #fff; }
          .cgcLogout:hover { color: #fff; border-color: rgba(255,255,255,0.4); background: rgba(255,255,255,0.05); }
        `}</style>

        <div style={styles.overlay}>
          <header
            data-cegeclim-header="true"
            style={{
              ...styles.header,
              ...((pageFloatingLayerOpen || headerHiddenForScroll) ? styles.headerHiddenForFloatingLayer : {}),
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
                  <div style={styles.title}>Hitachi Cooling &amp; Heating</div>
                </div>
              </div>

              <div style={styles.center}>Suivi commercial &amp; prospect</div>

              <div style={styles.right}>
                {email && <div style={styles.userEmail}>{email}</div>}
                <span style={styles.userProfile}>
                  {rights.profile_name || 'Aucun profil'}
                </span>
                <button onClick={handleLogout} className="cgcLogout" style={styles.logout}>
                  Se déconnecter
                </button>
              </div>
            </div>

            {(menuGroups.some(isGroupVisible) || hasVisibleStatusLights) && (
              <div style={styles.nav}>
                <div style={styles.navMenu}>
                  {menuGroups.filter(isGroupVisible).map((group) => {
                    const visibleItems = getVisibleItems(group)
                    const activeItem = getActiveMenuItem(group)

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
                          type="button"
                          className="cgcNavBtn"
                          aria-expanded={openGroup === group.label}
                          style={{
                            ...styles.navBtn,
                            ...(activeItem ? styles.navBtnActive : {}),
                          }}
                        >
                          <span
                            className="cgcNavLabel"
                            style={{
                              ...styles.navBtnGroupLabel,
                              ...(activeItem ? styles.navBtnGroupLabelActive : {}),
                            }}
                          >
                            {group.label}
                          </span>
                          <span style={styles.navBtnCurrentPage}>
                            {activeItem
                              ? (activeItem.activeLabel || activeItem.label)
                              : `${visibleItems.length} écran${visibleItems.length > 1 ? 's' : ''}`}
                          </span>
                        </button>

                        {openGroup === group.label && (
                          <div style={styles.dropdown}>
                            {visibleItems.map((item) => {
                              const itemActive = isMenuItemActive(item)

                              return (
                                <div
                                  key={item.path}
                                  className="cgcMenuItem"
                                  aria-current={itemActive ? 'page' : undefined}
                                  style={{
                                    ...styles.dropdownItem,
                                    ...(itemActive ? styles.dropdownItemActive : {}),
                                  }}
                                  onClick={() => {
                                    setOpenGroup(null)
                                    router.push(item.path)
                                  }}
                                >
                                  {item.label}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {hasVisibleStatusLights && (
                  <div style={styles.alertsPanel}>
                    <div style={styles.alertsPanelHeading}>
                      <span style={styles.alertsPanelTitle}>Mes alertes</span>
                      <span style={styles.alertsPanelSubtitle}>
                        {visibleAlertCount} active{visibleAlertCount > 1 ? 's' : ''}
                      </span>
                    </div>

                    <span aria-hidden="true" style={styles.alertsPanelDivider} />

                    <div style={styles.alertsGrid}>
                      {rights.show_alert_cerfa_ko && (
                        <StatusLight
                          compact
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
                          compact
                          label="CDC < 2026"
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
                          compact
                          label="Frais de port"
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
                          compact
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
                          compact
                          label="À faire"
                          status={todoSignal.status}
                          count={todoSignal.count}
                          blink={todoSignal.status === 'red' && statusBlinkOn}
                          clickable
                          onClick={openTodoList}
                          title={todoSignal.count > 0 ? 'Ouvrir la TODO List dans un nouvel onglet' : 'Aucune tâche à faire — cliquer pour ouvrir la TODO List'}
                        />
                      )}
                    </div>
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
                              color: '#9C4A24',
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
        <body className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
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
      // `backgroundColor` et non le raccourci `background` : le raccourci,
      // declare apres les proprietes de fond, remettait backgroundSize et
      // backgroundRepeat a leur valeur initiale. La photo s'affichait alors a sa
      // taille naturelle et se repetait en mosaique.
      backgroundColor: '#0B1220',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center center',
      backgroundAttachment: 'fixed',
      fontFamily: 'var(--font-body)',
      // Pas de couleur de texte globale ici : elle serait heritee par les ecrans
      // historiques a fond clair. Le blanc est porte par le bandeau, le sombre
      // par la zone de contenu.
    },

    overlay: {
      // Toujours pas de backdrop-filter ici : il créerait un contexte
      // d'empilement et enfermerait les modales des pages sous le bandeau.
      minHeight: '100vh',
    },

    /* ---- Bandeau ---------------------------------------------------------- */

    header: {
      position: 'sticky',
      top: 0,
      zIndex: 30,
      width: '100%',
      color: '#ffffff',
      background: 'rgba(11,18,32,0.94)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      borderBottom: '1px solid rgba(255,255,255,0.10)',
      pointerEvents: 'auto',
    },

    headerHiddenForFloatingLayer: {
      // Masquage réel, et non simple baisse du z-index : certaines pages créent
      // leur propre contexte d'empilement et ne pourraient toujours pas dépasser
      // un header sticky positif. Le bandeau revient à la fermeture.
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
      alignItems: 'center',
      gap: 20,
      padding: '10px 22px',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      pointerEvents: 'auto',
    },

    left: {
      display: 'flex',
      gap: 14,
      alignItems: 'center',
      minWidth: 0,
    },

    logo: {
      width: 112,
      background: '#fff',
      borderRadius: 5,
      padding: '3px 6px',
      flexShrink: 0,
    },

    subtitle: {
      fontSize: 11,
      lineHeight: 1.2,
      color: 'rgba(255,255,255,0.42)',
    },

    title: {
      fontFamily: 'var(--font-display)',
      fontSize: 16,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      lineHeight: 1.2,
      marginTop: 1,
      color: '#ffffff',
    },

    center: {
      marginLeft: 'auto',
      marginRight: 'auto',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: '0.28em',
      textTransform: 'uppercase',
      color: '#A6A181',
      whiteSpace: 'nowrap',
    },

    right: {
      position: 'relative',
      zIndex: 5,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      pointerEvents: 'auto',
    },

    rightUserBlock: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    },

    userEmail: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11.5,
      color: 'rgba(255,255,255,0.55)',
      whiteSpace: 'nowrap',
    },

    userProfile: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: '#A6A181',
      background: 'rgba(166,161,129,0.10)',
      border: '1px solid rgba(166,161,129,0.35)',
      borderRadius: 999,
      padding: '3px 9px',
      whiteSpace: 'nowrap',
    },

    logout: {
      fontFamily: 'var(--font-body)',
      fontSize: 12,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.65)',
      background: 'transparent',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 9,
      padding: '6px 12px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'color 0.16s ease, border-color 0.16s ease, background 0.16s ease',
      pointerEvents: 'auto',
    },

    select: {
      padding: 6,
      borderRadius: 8,
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.14)',
      color: '#fff',
    },

    selectDisabled: {
      cursor: 'not-allowed',
      opacity: 0.5,
    },

    /* ---- Navigation ------------------------------------------------------- */

    nav: {
      position: 'relative',
      zIndex: 2,
      display: 'flex',
      alignItems: 'stretch',
      gap: 24,
      padding: '0 22px',
      overflow: 'visible',
      pointerEvents: 'none',
    },

    // Conservée pour compatibilité : le calage à 420px n'a plus lieu d'être,
    // les alertes étant désormais à droite et le menu à gauche.
    navWithAlerts: {},

    navMenu: {
      display: 'flex',
      alignItems: 'stretch',
      gap: 2,
      pointerEvents: 'auto',
    },

    menuWrapper: {
      position: 'relative',
      zIndex: 4,
      display: 'flex',
      pointerEvents: 'auto',
    },

    navBtn: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      borderBottom: '2px solid transparent',
      borderRadius: 0,
      padding: '10px 14px 9px',
      cursor: 'pointer',
      transition: 'background 0.16s ease, border-color 0.16s ease',
      pointerEvents: 'auto',
    },

    navBtnActive: {
      borderBottom: '2px solid #A6A181',
      background: 'rgba(166,161,129,0.07)',
    },

    navBtnGroupLabel: {
      display: 'block',
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1.1,
      color: 'rgba(255,255,255,0.62)',
      whiteSpace: 'nowrap',
      transition: 'color 0.16s ease',
    },

    navBtnGroupLabelActive: {
      color: '#ffffff',
    },

    navBtnCurrentPage: {
      display: 'block',
      marginTop: 3,
      fontFamily: 'var(--font-mono)',
      fontSize: 9.5,
      lineHeight: 1.1,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.30)',
      whiteSpace: 'nowrap',
    },

    dropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      marginTop: 2,
      zIndex: 10,
      minWidth: 250,
      background: '#101A2E',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12,
      padding: 6,
      boxShadow: '0 18px 40px rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
      pointerEvents: 'auto',
    },

    dropdownItem: {
      padding: '8px 10px',
      borderRadius: 8,
      fontSize: 13,
      color: 'rgba(255,255,255,0.7)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background 0.14s ease, color 0.14s ease',
      pointerEvents: 'auto',
    },

    dropdownItemActive: {
      background: 'rgba(166,161,129,0.14)',
      color: '#ffffff',
      fontWeight: 600,
    },

    /* ---- Réglette d'alertes ----------------------------------------------- */

    alertsPanel: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 0',
      pointerEvents: 'auto',
    },

    alertsPanelHeading: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      justifyContent: 'center',
    },

    alertsPanelTitle: {
      fontFamily: 'var(--font-mono)',
      fontSize: 9.5,
      fontWeight: 500,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.55)',
      whiteSpace: 'nowrap',
    },

    alertsPanelSubtitle: {
      marginTop: 3,
      fontFamily: 'var(--font-mono)',
      fontSize: 9.5,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.30)',
      whiteSpace: 'nowrap',
    },

    alertsPanelDivider: {
      width: 1,
      alignSelf: 'stretch',
      background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.20), transparent)',
    },

    alertsGrid: {
      display: 'flex',
      alignItems: 'stretch',
      gap: 6,
    },

    /* ---- Fiche d'alerte --------------------------------------------------- */

    statusCard: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      padding: '6px 10px 6px 8px',
      borderRadius: 9,
      border: '1px solid rgba(255,255,255,0.09)',
      background: 'rgba(255,255,255,0.045)',
      transition: 'filter 0.16s ease, border-color 0.16s ease, opacity 0.4s ease',
    },

    // Neutres : la réglette est déjà compacte par construction. Conservées pour
    // que les appels existants ne cassent pas.
    statusCardCompact: {},
    statusCardTop: {},
    statusCardTopCompact: {},
    statusCardLabelCompact: {},
    statusBadgeCompact: {},
    statusOkTextCompact: {},
    statusLightDotCompact: {},

    statusCardRed: {
      border: '1px solid rgba(193,104,60,0.30)',
      background: 'rgba(193,104,60,0.09)',
    },

    statusCardOrange: {
      border: '1px solid rgba(214,154,74,0.26)',
      background: 'rgba(214,154,74,0.07)',
    },

    statusCardGreen: {
      border: '1px solid rgba(255,255,255,0.09)',
      background: 'rgba(255,255,255,0.045)',
    },

    // Pulsation : pilotée par statusBlinkOn, qui bascule toutes les 1,2 s.
    statusCardBlink: {
      opacity: 0.55,
    },

    statusCardLabel: {
      fontSize: 10.5,
      fontWeight: 500,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      lineHeight: 1,
      color: 'rgba(255,255,255,0.6)',
      whiteSpace: 'nowrap',
    },

    // Le libellé reste neutre, c'est le compteur qui porte la couleur.
    statusCardLabelRed: { color: 'rgba(255,255,255,0.6)' },
    statusCardLabelOrange: { color: 'rgba(255,255,255,0.6)' },
    statusCardLabelGreen: { color: 'rgba(255,255,255,0.6)' },

    statusLightDot: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      display: 'inline-block',
      flexShrink: 0,
    },

    statusLightDotRed: {
      background: '#C1683C',
      boxShadow: '0 0 0 3px rgba(193,104,60,0.16)',
    },

    statusLightDotOrange: {
      background: '#D69A4A',
      boxShadow: '0 0 0 3px rgba(214,154,74,0.16)',
    },

    statusLightDotGreen: {
      background: '#4B92AC',
      boxShadow: '0 0 0 3px rgba(75,146,172,0.14)',
    },

    statusLightDotBlink: {
      boxShadow: '0 0 0 4px rgba(193,104,60,0.24)',
    },

    statusBadge: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1,
    },

    statusBadgeRed: { color: '#C1683C' },
    statusBadgeOrange: { color: '#D69A4A' },
    statusBadgeGreen: { color: 'rgba(255,255,255,0.5)' },

    statusOkText: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.08em',
      color: 'rgba(255,255,255,0.35)',
    },

    /* ---- Modales : crème, pour la lisibilité des tableaux ----------------- */

    modalBackdrop: {
      position: 'fixed',
      inset: 0,
      // Les fenêtres propres au layout doivent recouvrir le bandeau commun.
      zIndex: 1000,
      background: 'rgba(6,10,18,0.62)',
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
      background: '#F5F3EC',
      color: '#141A26',
      boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
      border: '1px solid rgba(20,26,38,0.12)',
    },

    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 16,
      alignItems: 'center',
      padding: '18px 20px',
      borderBottom: '1px solid rgba(20,26,38,0.10)',
    },

    modalTitle: {
      fontFamily: 'var(--font-display)',
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      color: '#141A26',
    },

    modalSubtitle: {
      marginTop: 4,
      fontSize: 13,
      color: 'rgba(20,26,38,0.55)',
    },

    modalActions: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
    },

    modalSecondaryButton: {
      border: '1px solid rgba(20,26,38,0.18)',
      background: '#fff',
      color: '#141A26',
      borderRadius: 10,
      padding: '8px 12px',
      fontFamily: 'var(--font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    },

    modalCloseButton: {
      border: '1px solid #141A26',
      background: '#141A26',
      color: '#fff',
      borderRadius: 10,
      padding: '8px 12px',
      fontFamily: 'var(--font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    },

    modalInfo: {
      margin: '12px 20px',
      padding: 12,
      borderRadius: 12,
      background: 'rgba(75,146,172,0.12)',
      border: '1px solid rgba(75,146,172,0.28)',
      color: '#2C6F88',
      fontSize: 13,
      fontWeight: 500,
    },

    modalError: {
      margin: '12px 20px',
      padding: 12,
      borderRadius: 12,
      background: 'rgba(193,104,60,0.12)',
      border: '1px solid rgba(193,104,60,0.28)',
      color: '#9C4A24',
      fontSize: 13,
      fontWeight: 500,
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
      background: '#EDEAE0',
      border: '1px solid rgba(20,26,38,0.10)',
      padding: '10px 8px',
      textAlign: 'left',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'rgba(20,26,38,0.6)',
      zIndex: 1,
    },

    cerfaTd: {
      border: '1px solid rgba(20,26,38,0.08)',
      padding: 8,
      verticalAlign: 'middle',
      color: '#141A26',
    },

    cerfaTdStrong: {
      border: '1px solid rgba(20,26,38,0.08)',
      padding: 8,
      verticalAlign: 'middle',
      color: '#141A26',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
    },

    cerfaTdCenter: {
      border: '1px solid rgba(20,26,38,0.08)',
      padding: 8,
      textAlign: 'center',
      verticalAlign: 'middle',
    },

    cerfaLink: {
      color: '#35708A',
      textDecoration: 'underline',
      fontWeight: 600,
    },

    cerfaEmptyCell: {
      border: '1px solid rgba(20,26,38,0.08)',
      padding: 24,
      textAlign: 'center',
      color: 'rgba(20,26,38,0.45)',
    },

    cerfaInput: {
      width: '100%',
      minWidth: 220,
      border: '1px solid rgba(20,26,38,0.18)',
      borderRadius: 8,
      padding: '7px 9px',
      fontFamily: 'var(--font-body)',
      fontSize: 13,
      color: '#141A26',
      background: '#fff',
      outline: 'none',
    },

    cerfaOkButton: {
      border: 'none',
      background: '#A6A181',
      color: '#141A26',
      borderRadius: 8,
      padding: '7px 12px',
      fontFamily: 'var(--font-body)',
      fontSize: 12.5,
      fontWeight: 600,
      cursor: 'pointer',
    },

    /* ---- Contenu ---------------------------------------------------------- */

    content: {
      position: 'relative',
      // Ne pas créer de contexte d'empilement : les modales/fenêtres fixes
      // déclarées dans les pages peuvent ainsi passer au-dessus du header.
      zIndex: 'auto',
      width: '100%',
      minWidth: 0,
      padding: 20,
      // Couleur de texte par defaut de la zone de contenu. Les ecrans
      // historiques (TODO, Clients, Carte...) sont a fond clair et comptaient sur
      // un texte sombre herite ; les ecrans sombres refondus fixent eux-memes
      // leurs couleurs classe par classe.
      color: '#141A26',
    },

    contentFullWidth: {
      padding: '4px 2px 16px',
      maxWidth: 'none',
      overflowX: 'hidden',
    },
  }
