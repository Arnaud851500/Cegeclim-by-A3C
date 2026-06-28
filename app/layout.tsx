'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logUserEvent } from '@/lib/audit'
import { AccessProvider, useAccess, type AccessRights } from '@/components/AccessContext'
import { Analytics } from '@vercel/analytics/next'
import AutoLogout from '@/components/autologout'
import './globals.css'

import {
  SocieteFilterProvider,
  useSocieteFilter,
  type SocieteFilter,
} from '@/components/SocieteFilterContext'

type MenuAccessKey = Exclude<keyof AccessRights, 'allowed_scopes' | 'can_change_scope'>

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
  allowed_agence?: string | string[] | null
  can_todo?: boolean | null
}

type TodoSignal = {
  status: StatusLevel
  count: number
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

type CertificationAlertKind = 'rge' | 'capacite'

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

function agenceMatchesAllowed(agence: string, allowedAgences: string[]) {
  if (!allowedAgences.length) return true
  const normalizedAgence = normalizeLoose(agence)
  if (!normalizedAgence) return false
  return allowedAgences.some((allowed) => {
    const normalizedAllowed = normalizeLoose(allowed)
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
  const [todoSignal, setTodoSignal] = useState<TodoSignal>({ status: 'green', count: 0 })
  const [cerfaKoCount, setCerfaKoCount] = useState(0)
  const [cerfaRows, setCerfaRows] = useState<CerfaKoRow[]>([])
  const [cerfaModalOpen, setCerfaModalOpen] = useState(false)
  const [cerfaLoading, setCerfaLoading] = useState(false)
  const [cerfaError, setCerfaError] = useState<string | null>(null)
  const [certificationSignals, setCertificationSignals] = useState<Record<CertificationAlertKind, CertificationSignal>>({
    rge: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
    capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
  })
  const [certificationModalOpen, setCertificationModalOpen] = useState(false)
  const [certificationModalKind, setCertificationModalKind] = useState<CertificationAlertKind>('rge')
  const [certificationRows, setCertificationRows] = useState<CertificationAlertRow[]>([])
  const [certificationLoading, setCertificationLoading] = useState(false)
  const [certificationError, setCertificationError] = useState<string | null>(null)

  const lastLoggedPathRef = useRef<string | null>(null)
  const lastStatusRefreshRef = useRef(0)

  const isLoginPage = pathname === '/login'
  const isUnauthorizedPage = pathname === '/unauthorized'
  const isPdfPrintPage = pathname === '/focus_mensuel_print' || pathname.startsWith('/focus_mensuel_print/')
  const isPublicShellPage = isLoginPage || isPdfPrintPage

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
        { label: 'Flux Devis-CDC-BC-Fact', path: '/approvisionnements', accessKey: 'can_autorisation' },
        { label: 'Analyse Devis', path: '/cycle-documents', accessKey: 'can_autorisation' },
        { label: 'Suivi Multi Clients', path: '/synthese_multi_clients', accessKey: 'can_autorisation' },        
        { label: 'Tableaux de bord', path: '/atelier-analyse', accessKey: 'can_autorisation' },
        { label: 'Focus Mois', path: '/focus_mensuel', accessKey: 'can_autorisation' },
        { label: 'Indicateurs', path: '/Indicateurs', accessKey: 'can_documents' }
        ],
    },
    {
      label: 'Admin',
      items: [{ label: 'Autorisations', path: '/autorisation', accessKey: 'can_autorisation' },
                { label: 'MAJ Base clients', path: '/clients', accessKey: 'can_clients' },
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
    if (isPublicShellPage || isUnauthorizedPage) return

    const currentPage = menuGroups
      .flatMap((g) => g.items)
      .find((item) => item.path === pathname)

    if (currentPage?.accessKey && !rights[currentPage.accessKey]) {
      router.replace('/unauthorized')
    }
  }, [sessionChecked, hasSession, accessLoading, pathname, rights, router, isPublicShellPage, isUnauthorizedPage])

  useEffect(() => {
    if (!sessionChecked || !hasSession) return
    if (!email) return
    if (!pathname) return
    if (isPublicShellPage || pathname === '/unauthorized') return
    if (lastLoggedPathRef.current === pathname) return

    lastLoggedPathRef.current = pathname

    void logUserEvent({
      user_email: email,
      event_type: 'page_view',
      pathname,
    })
  }, [sessionChecked, hasSession, email, pathname, isPublicShellPage])

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusBlinkOn((prev) => !prev)
    }, 1200)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!sessionChecked || accessLoading || !hasSession || !email) return
    if (isPublicShellPage || isUnauthorizedPage) return

    // Refresh à la connexion : forcé pour ne pas attendre le throttle.
    const initialTimer = setTimeout(() => {
      void refreshStatusIndicators({ force: true })
    }, 250)

    // Rafraîchissement raisonnable : les requêtes du header ne doivent jamais saturer l'appli.
    const interval = setInterval(() => {
      void refreshStatusIndicators()
    }, 15 * 60 * 1000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked, accessLoading, hasSession, email, isPublicShellPage, isUnauthorizedPage])

  useEffect(() => {
    if (!sessionChecked || accessLoading || !hasSession || !email) return
    if (!pathname || isPublicShellPage || isUnauthorizedPage) return

    // Refresh à chaque changement d'écran : forcé pour refléter TODO / CERFA après navigation.
    const routeTimer = setTimeout(() => {
      void refreshStatusIndicators({ force: true })
    }, 250)

    return () => clearTimeout(routeTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sessionChecked, accessLoading, hasSession, email, isPublicShellPage, isUnauthorizedPage])

  if (isLoginPage) {
    return (
      <div style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f5f7fa' }}>
        {children}
        <Analytics />
      </div>
    )
  }

  if (isPdfPrintPage) {
    return (
      <>
        {children}
        <Analytics />
      </>
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
      .eq('email', email)
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
      // Version rapide via RPC Supabase : évite de charger facture_lignes dans le header global.
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

      // Fallback limité : utilisé uniquement si les RPC n'ont pas encore été installées.
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

  async function refreshCertificationSignals() {
    try {
      const { data, error } = await supabase.rpc('get_client_certification_alert_summary')
      if (error) throw error

      const next: Record<CertificationAlertKind, CertificationSignal> = {
        rge: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
        capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
      }

      ;((data || []) as any[]).forEach((row) => {
        const kind = String(row.kind || '').toLowerCase() as CertificationAlertKind
        if (kind !== 'rge' && kind !== 'capacite') return

        next[kind] = {
          status: (row.status || 'green') as StatusLevel,
          count: Number(row.total_count || 0),
          expiredCount: Number(row.expired_count || 0),
          soonCount: Number(row.soon_count || 0),
        }
      })

      setCertificationSignals(next)
    } catch (error) {
      console.error('Alertes certifications clients', error)
      setCertificationSignals({
        rge: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
        capacite: { status: 'green', count: 0, expiredCount: 0, soonCount: 0 },
      })
    }
  }

  async function openCertificationModal(kind: CertificationAlertKind) {
    setCertificationModalKind(kind)
    setCertificationModalOpen(true)
    setCertificationLoading(true)
    setCertificationError(null)

    try {
      const { data, error } = await supabase.rpc('get_client_certification_alert_rows', {
        p_kind: kind,
        p_limit: 1000,
      })

      if (error) throw error
      setCertificationRows((data || []) as CertificationAlertRow[])
    } catch (error: any) {
      console.error('Détail alertes certifications clients', error)
      setCertificationRows([])
      setCertificationError(error?.message || String(error))
    } finally {
      setCertificationLoading(false)
    }
  }

  async function refreshStatusIndicators(options?: { force?: boolean }) {
    if (!email || isPublicShellPage || isUnauthorizedPage) return

    const now = Date.now()
    if (!options?.force && now - lastStatusRefreshRef.current < 60_000) return
    lastStatusRefreshRef.current = now

    const profile = await getUserAccessProfile()
    await Promise.all([
      refreshTodoSignal(profile),
      refreshCerfaKo(profile, { detail: false }),
      refreshCertificationSignals(),
    ])
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
        <header style={styles.header}>
          <div style={styles.top}>
            <div style={styles.left}>
              <img
                src="https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0"
                style={styles.logo}
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
                  style={styles.select}
                >
                  {(rights.allowed_scopes || ['Global']).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <button onClick={handleLogout} style={styles.logout}>
                  Déconnexion
                </button>

                {email && <div style={styles.userEmail}>{email}</div>}

              </div>
            </div>
          </div>

          {menuGroups.some(isGroupVisible) && (
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

              <div style={styles.statusLightsRow}>
                <StatusLight
                  label="CERFA"
                  status={cerfaKoCount > 0 ? 'red' : 'green'}
                  count={cerfaKoCount}
                  blink={cerfaKoCount > 0 && statusBlinkOn}
                  clickable={cerfaKoCount > 0}
                  onClick={openCerfaModal}
                  title={cerfaKoCount > 0 ? 'Ouvrir la liste des CERFA KO en attente de régularisation' : 'Aucun CERFA KO'}
                />
                <StatusLight
                  label="RGE"
                  status={certificationSignals.rge.status}
                  count={certificationSignals.rge.count}
                  blink={certificationSignals.rge.status === 'red' && statusBlinkOn}
                  clickable={certificationSignals.rge.count > 0}
                  onClick={() => openCertificationModal('rge')}
                  title={
                    certificationSignals.rge.count > 0
                      ? `RGE : ${certificationSignals.rge.expiredCount} dépassé(s), ${certificationSignals.rge.soonCount} proche(s)`
                      : 'Aucune alerte RGE'
                  }
                />
                <StatusLight
                  label="Capacité gaz"
                  status={certificationSignals.capacite.status}
                  count={certificationSignals.capacite.count}
                  blink={certificationSignals.capacite.status === 'red' && statusBlinkOn}
                  clickable={certificationSignals.capacite.count > 0}
                  onClick={() => openCertificationModal('capacite')}
                  title={
                    certificationSignals.capacite.count > 0
                      ? `Capacité gaz : ${certificationSignals.capacite.expiredCount} dépassée(s), ${certificationSignals.capacite.soonCount} proche(s)`
                      : 'Aucune alerte capacité gaz'
                  }
                />
                <StatusLight
                  label="A faire"
                  status={todoSignal.status}
                  count={todoSignal.count}
                  blink={todoSignal.status === 'red' && statusBlinkOn}
                  clickable
                  onClick={openTodoList}
                  title={todoSignal.count > 0 ? 'Ouvrir la TODO List dans un nouvel onglet' : 'Aucune tâche à faire — cliquer pour ouvrir la TODO List'}
                />
              </div>
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
                    {certificationModalKind === 'rge'
                      ? 'Clients CEGECLIM RGE à surveiller'
                      : 'Clients CEGECLIM capacité gaz à surveiller'}
                  </div>
                  <div style={styles.modalSubtitle}>
                    {certificationRows.length} client(s) avec date dépassée ou proche
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
                <table style={{ ...styles.cerfaTable, minWidth: 1580 }}>
                  <thead>
                    <tr>
                      <th style={styles.cerfaTh}>Date validité clients</th>
                      <th style={styles.cerfaTh}>Date validité ref_tiers</th>
                      <th style={styles.cerfaTh}>Statut</th>
                      <th style={styles.cerfaTh}>N° tiers</th>
                      <th style={styles.cerfaTh}>Désignation</th>
                      <th style={styles.cerfaTh}>Département</th>
                      <th style={styles.cerfaTh}>Représentant</th>
                      <th style={styles.cerfaTh}>SIRET</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificationRows.length === 0 && !certificationLoading ? (
                      <tr>
                        <td colSpan={8} style={styles.cerfaEmptyCell}>
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
                            color: row.alert_status === 'expired' ? '#b91c1c' : '#c2410c',
                          }}
                        >
                          {row.alert_status === 'expired'
                            ? `Dépassé depuis ${Math.abs(Number(row.jours_ecart || 0))} j`
                            : `Expire dans ${Number(row.jours_ecart || 0)} j`}
                        </td>
                        <td style={styles.cerfaTdStrong}>{row.numero_tiers || '—'}</td>
                        <td style={styles.cerfaTd}>{row.designation || '—'}</td>
                        <td style={styles.cerfaTd}>{row.departement || '—'}</td>
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

        <main style={styles.content}>{children}</main>
      </div>

      <Analytics />
    </div>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
    backdropFilter: 'blur(3px)',
    minHeight: '100vh',
  },

  header: {
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    width: '100%',
    background: 'rgba(255,255,255,0.86)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
  },

  top: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 20px',
    alignItems: 'center',
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
    display: 'flex',
    gap: 10,
  },

  rightUserBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },


  userEmail: {
    fontSize: 13,
    color: '#17344d',
  },

  select: {
    padding: 6,
    borderRadius: 8,
  },

  navBtnActive: {
    color: '#5ea7c3',
    background: 'rgba(238,247,251,0.95)',
    borderRadius: 12,
    padding: '6px 12px',
  },

  logout: {
    background: '#fff',
    borderRadius: 8,
    padding: '6px 10px',
    cursor: 'pointer',
    border: '1px solid #d0d7de',
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
    zIndex: 1001,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 20px 8px',
    overflow: 'visible',
    minHeight: 42,
  },

  navMenu: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },

  statusLightsRow: {
    position: 'absolute',
    right: 20,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },

  navBtn: {
    background: 'transparent',
    border: 'none',
    fontWeight: 700,
    cursor: 'pointer',
  },

  menuWrapper: {
    position: 'relative',
    zIndex: 1002,
    paddingBottom: 10,
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
    zIndex: 1100,
  },

  dropdownItem: {
    padding: 10,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },


  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
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
    padding: 20,
  },
}