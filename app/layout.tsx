'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
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

function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { societeFilter, setSocieteFilter } = useSocieteFilter()
  const { loading: accessLoading, rights, email } = useAccess()

  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [hoverTimeout, setHoverTimeout] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [hasSession, setHasSession] = useState(false)

  const isLoginPage = pathname === '/login'
  const isUnauthorizedPage = pathname === '/unauthorized'

  const isGroupActive = (group: MenuGroup) =>
    group.items.some((item) => pathname === item.path)

  const backgroundImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/Image%20site%20CEGECLIM%20maison.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9JbWFnZSBzaXRlIENFR0VDTElNIG1haXNvbi5qcGciLCJpYXQiOjE3NzU1MDYyNTEsImV4cCI6NDg5NzU3MDI1MX0.d1YT7_-xD44QOm2LFbZIfpkjh9kiIGjpJiEuJxV0rMM'

  const menuGroups: MenuGroup[] = [
    {
      label: 'Accueil',
      items: [{ label: 'Accueil', path: '/accueil' }],
    },
    {
      label: 'Base clients',
      items: [
        { label: 'MAJ Base', path: '/clients', accessKey: 'can_clients' },
        { label: 'Liste clients', path: '/carte', accessKey: 'can_carte' },
        { label: 'Clients Cegeclim', path: '/clients_cegeclim', accessKey: 'can_clients_cegeclim' },
        { label: 'Suivi Prospects', path: '/suivi prospects', accessKey: 'can_suivi_prospects' },
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
      label: 'Documents',
      items: [{ label: 'Documents', path: '/documents', accessKey: 'can_documents' }],
    },
    {
      label: 'Todo List',
      items: [{ label: 'Todo List', path: '/todo', accessKey: 'can_todo' }],
    },
    {
      label: 'Activité',
      items: [{ label: 'Activités - CA (WIP)', path: '/activite', accessKey: 'can_activites' }],
    },
    {
      label: 'Indicateurs',
      items: [{ label: 'Indicateurs', path: '/indicateurs', accessKey: 'can_dashboard' }],
    },
    {
      label: 'Autorisations',
      items: [{ label: 'Autorisations', path: '/autorisation', accessKey: 'can_autorisation' }],
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
              PROSPECTION NOUVEAUX CLIENTS
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

          <div style={styles.nav}>
            {menuGroups.map((group) => (
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
                    {group.items
                      .filter((item) => !item.accessKey || rights[item.accessKey])
                      .map((item) => (
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
            ))}
          </div>
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
    background: 'rgba(255,255,255,0.7)',
    backdropFilter: 'blur(14px)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
  },

  top: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 20px',
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

  nav: {
    display: 'flex',
    justifyContent: 'center',
    gap: 20,
    padding: '6px 0',
  },

  navBtn: {
    background: 'transparent',
    border: 'none',
    fontWeight: 700,
    cursor: 'pointer',
  },

  menuWrapper: {
    position: 'relative',
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
    zIndex: 20,
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