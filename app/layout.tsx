'use client'

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { AccessProvider, useAccess, type AccessRights } from '@/components/AccessContext'
import { Analytics } from "@vercel/analytics/next"
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

function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { societeFilter, setSocieteFilter } = useSocieteFilter()
  const { loading: accessLoading, rights, email } = useAccess()

  const menu: MenuItem[] = [
    { label: 'Dashboard', path: '/dashboard', accessKey: 'can_dashboard' },
    { label: 'Territoire', path: '/territoire', accessKey: 'can_territoire' },
    { label: 'Agences', path: '/agences', accessKey: 'can_agences' },
    { label: 'Cartographie', path: '/cartographie', accessKey: 'can_cartographie' },
    { label: 'Clients', path: '/clients', accessKey: 'can_clients' },
    { label: 'Documents', path: '/documents', accessKey: 'can_documents' },
    { label: 'Autorisation', path: '/autorisation', accessKey: 'can_autorisation' },
    { label: 'Activités - CA (WIP)', path: '/activites', accessKey: 'can_activites' },
    { label: 'Stocks et Flux log (WIP)', path: '/stocks', accessKey: 'can_stocks' },
  
  ]

  const visibleMenu = useMemo(() => {
    if (accessLoading) return []

    return menu.filter((item) => {
      if (!item.accessKey) return false
      return !!rights[item.accessKey]
    })
  }, [accessLoading, rights])

  useEffect(() => {
    if (accessLoading) return

    const publicPaths = ['/login']
    const neutralPaths = ['/unauthorized']

    if (publicPaths.includes(pathname) || neutralPaths.includes(pathname)) {
      return
    }

    if (!email) {
      router.replace('/login')
      return
    }

    const current = menu.find((item) => item.path === pathname)

    if (current?.accessKey && !rights[current.accessKey]) {
      router.replace('/unauthorized')
    }
  }, [accessLoading, pathname, rights, email, router])

  const getPageTitle = () => {
    const found = menu.find((item) => item.path === pathname)
    if (found) return found.label
    if (pathname === '/login') return 'Connexion'
    if (pathname === '/unauthorized') return 'Accès refusé'
    return 'Intranet'
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const isLoginPage = pathname === '/login'

  if (isLoginPage) {
    return (
      <div style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f5f7fa' }}>
        {children}
      </div>
    )
  }

  return (
    <div style={appShellStyle}>
      <aside style={sidebarStyle}>
        <div style={logoBlockStyle}>
          <div style={logoCircleStyle}>A3C</div>
          <div>
            <div style={brandTitleStyle}>Intranet</div>
            <div style={brandSubStyle}>V1.secure</div>
            <div style={brandSubStyle}>CEGECLIM</div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={sectionTitleStyle}>VISION</div>

          <select
            style={selectStyle}
            value={societeFilter}
            disabled={!rights.can_change_scope}
            onChange={(e) => setSocieteFilter(e.target.value as SocieteFilter)}
          >
            {(rights.allowed_scopes || ['Global']).map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 18, flex: 1, overflowY: 'auto' }}>
          <div style={sectionTitleStyle}>NAVIGATION</div>

          {accessLoading ? (
            <div style={loadingNavStyle}>Chargement des accès...</div>
          ) : visibleMenu.length === 0 ? (
            <div style={loadingNavStyle}>Aucune page autorisée</div>
          ) : (
            visibleMenu.map((item) => {
              const isActive = pathname === item.path

              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  style={{
                    ...menuButtonStyle,
                    background: isActive ? '#4a5878' : '#5f6c89',
                    border: isActive
                      ? '1px solid #aab6cf'
                      : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {item.label}
                </button>
              )
            })
          )}
        </div>
      </aside>

      <div style={contentWrapperStyle}>
        <header style={topBarStyle}>
          <div style={topBarTitleStyle}>{getPageTitle()}</div>

          <button onClick={handleLogout} style={logoutButtonStyle}>
            Déconnexion
          </button>
        </header>

        <main style={contentStyle}>{children}</main>
      </div>
    </div>
  )
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: 'Arial, sans-serif' }}>
        <AccessProvider>
          <SocieteFilterProvider>
            <AppShell>{children}</AppShell>
          </SocieteFilterProvider>
        </AccessProvider>
      </body>
    </html>
  )
}

/* ===================== STYLES ===================== */

const appShellStyle: React.CSSProperties = {
  display: 'flex',
  height: '100vh',
  background: '#f5f7fa',
}

const sidebarStyle: React.CSSProperties = {
  width: 240,
  background: '#1f2d4d',
  color: '#ffffff',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  borderRight: '1px solid rgba(255,255,255,0.08)',
}

const logoBlockStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 8,
}

const logoCircleStyle: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 18,
  background: 'linear-gradient(135deg, #39527d 0%, #8da87d 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 800,
  fontSize: 24,
  color: '#ffffff',
}

const brandTitleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
}

const brandSubStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.85,
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  opacity: 0.75,
  marginBottom: 8,
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  borderRadius: 10,
  background: '#3b4a6a',
  color: '#fff',
}

const menuButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  marginBottom: 8,
  borderRadius: 10,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
  textAlign: 'left',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
}

const loadingNavStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.75)',
}

const contentWrapperStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
}

const topBarStyle: React.CSSProperties = {
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 24px',
  background: '#ffffff',
}

const topBarTitleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
}

const logoutButtonStyle: React.CSSProperties = {
  padding: '10px',
  borderRadius: 10,
  cursor: 'pointer',
}

const contentStyle: React.CSSProperties = {
  flex: 1,
  padding: 24,
  overflow: 'auto',
}