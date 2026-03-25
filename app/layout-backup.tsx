'use client'

import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  const menu = [
    { label: 'Dashboard (WIP)', path: '/dashboard' },
    { label: 'Territoire', path: '/territoire' },
    { label: 'Agences', path: '/agences' },
    { label: 'Cartographie', path: '/cartographie' },
    { label: 'Clients (WIP)', path: '/clients' },
    { label: 'Produits - Offre (WIP)', path: '/produits' },  
    { label: 'Activités - CA (WIP)', path: '/activites' },
    { label: 'Stocks et Flux log (WIP)', path: '/stocks' },
    { label: 'Paramétrage (WIP)', path: '/parametrage' },
  ]

  const getPageTitle = () => {
    const found = menu.find((item) => item.path === pathname)
    if (found) return found.label
    if (pathname === '/login') return 'Connexion'
    return 'Intranet'
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const isLoginPage = pathname === '/login'

  if (isLoginPage) {
    return (
      <html lang="fr">
        <body style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f5f7fa' }}>
          {children}
        </body>
      </html>
    )
  }

  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: 'Arial, sans-serif' }}>
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
              <select style={selectStyle} defaultValue="Globale">
                <option>Globale</option>
              </select>
            </div>

            <div style={{ marginTop: 18, flex: 1, overflowY: 'auto' }}>
              <div style={sectionTitleStyle}>NAVIGATION</div>

              {menu.map((item) => {
                const isActive = pathname === item.path

                return (
                  <button
                    key={item.path}
                    onClick={() => router.push(item.path)}
                    style={{
                      ...menuButtonStyle,
                      background: isActive ? '#4a5878' : '#5f6c89',
                      border: isActive ? '1px solid #aab6cf' : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {item.label}
                  </button>
                )
              })}
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
      </body>
    </html>
  )
}

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
  flexShrink: 0,
}

const brandTitleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1.1,
}

const brandSubStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.85,
  lineHeight: 1.3,
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  opacity: 0.75,
  marginBottom: 8,
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.15)',
  background: '#3b4a6a',
  color: '#ffffff',
  outline: 'none',
  boxSizing: 'border-box',
}

const menuButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  marginBottom: 8,
  borderRadius: 10,
  color: '#ffffff',
  cursor: 'pointer',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: 13,
  boxSizing: 'border-box',
}

const contentWrapperStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: '#f5f7fa',
}

const topBarStyle: React.CSSProperties = {
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 24px',
  background: '#ffffff',
  borderBottom: '1px solid #d0d7de',
  boxSizing: 'border-box',
}

const topBarTitleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: '#101828',
}

const logoutButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #d0d7de',
  background: '#ffffff',
  color: '#101828',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 14,
}

const contentStyle: React.CSSProperties = {
  flex: 1,
  padding: 24,
  overflow: 'auto',
  boxSizing: 'border-box',
}