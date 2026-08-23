'use client'

import { useState } from 'react'
import { useAccess } from '@/components/AccessContext'
import { useMobileAlertsCount } from './useMobileAlertsCount'
import MobileHome from './MobileHome'
import MobileActivite from './MobileActivite'
import MobileClients from './MobileClients'
import MobileRdv from './MobileRdv'
import MobileAlertes from './MobileAlertes'
import MobileProspects from './MobileProspects'
import MobileStockArticles from './MobileStockArticles'

export type MobileScreen = 'home' | 'activite' | 'clients' | 'rdv' | 'alertes' | 'prospects' | 'stock'

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
  // Cible de navigation "Mes rdv" -> "Mes clients" : numéro de tiers (et nom,
  // en repli d'affichage) à ouvrir directement en arrivant sur l'écran
  // clients. Réinitialisée une fois consommée par MobileClients, pour ne
  // pas ré-ouvrir la même fiche si l'utilisateur revient plus tard sur cet
  // écran par le menu normal.
  const [cibleClient, setCibleClient] = useState<{ numero: string; nom: string } | null>(null)
  const { rights, email } = useAccess()
  const {
    total, detail, loading, fetchTodoList, fetchCerfaList,
    fetchCdcAvant2026List, fetchFraisPortList, fetchCapaciteGazList,
  } = useMobileAlertsCount()

  function goHome() {
    setScreen('home')
  }

  function ouvrirClientDepuisRdv(numeroTiers: string, nom: string) {
    setCibleClient({ numero: numeroTiers, nom })
    setScreen('clients')
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
      {screen === 'clients' && (
        <MobileClients
          cibleNumero={cibleClient?.numero}
          cibleNom={cibleClient?.nom}
          onCibleConsommee={() => setCibleClient(null)}
        />
      )}
      {screen === 'rdv' && <MobileRdv onOpenClient={ouvrirClientDepuisRdv} />}
      {screen === 'alertes' && (
        <MobileAlertes
          detail={detail}
          loading={loading}
          fetchTodoList={fetchTodoList}
          fetchCerfaList={fetchCerfaList}
          fetchCdcAvant2026List={fetchCdcAvant2026List}
          fetchFraisPortList={fetchFraisPortList}
          fetchCapaciteGazList={fetchCapaciteGazList}
          userEmail={email || ''}
          userName={email ? email.split('@')[0] : ''}
        />
      )}
      {screen === 'prospects' && <MobileProspects />}
      {screen === 'stock' && <MobileStockArticles />}
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
    case 'prospects':
      return 'Carte Prospects & Clients'
    case 'stock':
      return 'Stock articles'
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
