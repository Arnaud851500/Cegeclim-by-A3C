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

type StatusLightProps = {
  label: string
  status: 'red' | 'green'
  count?: number
  blink?: boolean
  clickable?: boolean
  onClick?: () => void
}

function StatusLight({ label, status, count, blink = false, clickable = false, onClick }: StatusLightProps) {
  const isRed = status === 'red'
  const shellStyle = {
    ...styles.statusCard,
    ...(isRed ? styles.statusCardRed : styles.statusCardGreen),
    ...(blink ? styles.statusCardBlink : {}),
    cursor: clickable ? 'pointer' : 'default',
  } as React.CSSProperties

  const lightStyle = {
    ...styles.statusLightDot,
    ...(isRed ? styles.statusLightDotRed : styles.statusLightDotGreen),
    ...(blink ? styles.statusLightDotBlink : {}),
  } as React.CSSProperties

  return (
    <button
      type="button"
      onClick={onClick}
      style={shellStyle}
      title={clickable ? `Ouvrir la liste d'anomalies ${label} (à brancher)` : `${label} OK`}
    >
      <div style={styles.statusCardTop}>
        <span style={lightStyle} />
        <span style={{ ...styles.statusCardLabel, ...(isRed ? styles.statusCardLabelRed : styles.statusCardLabelGreen) }}>
          {label}
        </span>
      </div>
      {typeof count === 'number' && count > 0 ? (
        <span style={{ ...styles.statusBadge, ...(isRed ? styles.statusBadgeRed : styles.statusBadgeGreen) }}>
          {count}
        </span>
      ) : (
        <span style={{ ...styles.statusOkText, ...(isRed ? styles.statusCardLabelRed : styles.statusCardLabelGreen) }}>OK</span>
      )}
    </button>
  )
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

  const lastLoggedPathRef = useRef<string | null>(null)

  const isLoginPage = pathname === '/login'
  const isUnauthorizedPage = pathname === '/unauthorized'

  const cerfaKoCount = 2
  const overdueTodoCount = 0

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
      label: 'Prospects / Carte',
      items: [
        { label: 'Prospects / Carte', path: '/carte', accessKey: 'can_carte' },
        { label: 'Clients Cegeclim', path: '/clients_cegeclim', accessKey: 'can_agences' },
        { label: 'Suivi Prospects', path: '/suivi prospects', accessKey: 'can_agences' },
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
      label: 'Activité',
      items: [{ label: 'Activités - CA (WIP)', path: '/activite', accessKey: 'can_activites' }],
    },
    {
      label: 'Tableaux de bord',
      items: [
        { label: 'Tableaux de bord', path: '/atelier-analyse', accessKey: 'can_autorisation' },
        { label: 'Indicateurs', path: '/Indicateurs', accessKey: 'can_dashboard' }
        ],
    },
    {
      label: 'Analyse Devis',
      items: [
        { label: 'Analyse Devis', path: '/approvisionnements', accessKey: 'can_autorisation' }
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

      if (!exists && !isLoginPage) {
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

      if (!exists && !isLoginPage) {
        router.replace('/login')
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [router, isLoginPage])

  useEffect(() => {
    if (!sessionChecked) return
    if (accessLoading) return
    if (!hasSession) return
    if (isLoginPage || isUnauthorizedPage) return

    const currentPage = menuGroups
      .flatMap((g) => g.items)
      .find((item) => item.path === pathname)

    if (currentPage?.accessKey && !rights[currentPage.accessKey]) {
      router.replace('/unauthorized')
    }
  }, [sessionChecked, hasSession, accessLoading, pathname, rights, router, isLoginPage, isUnauthorizedPage])

  useEffect(() => {
    if (!sessionChecked || !hasSession) return
    if (!email) return
    if (!pathname) return
    if (pathname === '/login' || pathname === '/unauthorized') return
    if (lastLoggedPathRef.current === pathname) return

    lastLoggedPathRef.current = pathname

    void logUserEvent({
      user_email: email,
      event_type: 'page_view',
      pathname,
    })
  }, [sessionChecked, hasSession, email, pathname])

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusBlinkOn((prev) => !prev)
    }, 1200)

    return () => clearInterval(interval)
  }, [])

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
                  status="red"
                  count={cerfaKoCount}
                  blink={statusBlinkOn}
                  clickable
                  onClick={() => {
                    // Navigation à brancher dans un second temps
                  }}
                />
                <StatusLight
                  label="A faire"
                  status="green"
                  count={overdueTodoCount}
                />
              </div>
            </div>
          )}
        </header>

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

  content: {
    padding: 20,
  },
}