'use client'

import { useState } from 'react'
import { useAccess } from '@/components/AccessContext'
import { useMobileAlertsCount } from './useMobileAlertsCount'
import MobileHome from './MobileHome'
import MobileActivite from './MobileActivite'
import MobileClients from './MobileClients'
import MobileRdv from './MobileRdv'
import MobileAlertes from './MobileAlertes'

export type MobileScreen = 'home' | 'activite' | 'clients' | 'rdv' | 'alertes'

/**
 * Point d'entrée de l'expérience mobile, une fois l'utilisateur authentifié.
 * Navigation interne par état (pas de changement de route) : simple, avec
 * un vrai bouton "Retour au menu" toujours visible sur les écrans enfants.
 *
 * Intégration proposée : dans la page d'accueil (ou dans AppShell), afficher
 * <MobileShell /> à la place du contenu desktop quand useViewport().isMobile
 * est vrai et que la session est active. Voir MOBILE_INTEGRATION.md.
 */
export default function MobileShell() {
  const [screen, setScreen] = useState<MobileScreen>('home')
  const { rights, email } = useAccess()
  const { total, detail, loading } = useMobileAlertsCount()

  function goHome() {
    setScreen('home')
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#0B1220',
        color: '#fff',
      }}
    >
      {screen !== 'home' && <MobileTopBar onBack={goHome} title={screenTitle(screen)} />}

      {screen === 'home' && (
        <MobileHome email={email} rights={rights} alertsCount={total} onNavigate={setScreen} />
      )}
      {screen === 'activite' && <MobileActivite />}
      {screen === 'clients' && <MobileClients />}
      {screen === 'rdv' && <MobileRdv />}
      {screen === 'alertes' && <MobileAlertes detail={detail} loading={loading} />}
    </div>
  )
}

function screenTitle(screen: MobileScreen) {
  switch (screen) {
    case 'activite':
      return 'Mon activité'
    case 'clients':
      return 'Mes clients'
    case 'rdv':
      return 'Mes rdv'
    case 'alertes':
      return 'Mes alertes'
    default:
      return ''
  }
}

function MobileTopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 16px',
        background: 'rgba(11,18,32,0.96)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      <button
        onClick={onBack}
        aria-label="Retour au menu"
        style={{
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'transparent',
          color: '#fff',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 14,
          fontFamily: 'var(--font-body)',
        }}
      >
        ← Menu
      </button>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{title}</div>
    </div>
  )
}
