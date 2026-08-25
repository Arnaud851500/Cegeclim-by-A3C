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
import MobileAdminPanel from './MobileAdminPanel'


export type MobileScreen = 'home' | 'activite' | 'clients' | 'rdv' | 'alertes' | 'prospects' | 'stock' | 'Admin'

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
  // Retour "un niveau" : quand on saute directement d'un écran A vers un
  // écran B via une cible (ex. clic sur un client depuis un RDV, ou sur
  // une référence depuis un devis), on retient A ici. Le bouton "← Menu"
  // revient alors sur A plutôt que systématiquement sur l'accueil, PUIS
  // oublie ce retour -- un seul niveau de mémoire, pas une vraie pile de
  // navigation. Concrètement : Accueil -> Rdv -> (clic client) -> Clients
  // -> "← Menu" -> Rdv -> "← Menu" -> Accueil. Mais Rdv -> Clients (clic
  // client) -> Stock (clic référence) -> "← Menu" ne revient QUE sur
  // Clients (le saut précédent, Rdv -> Clients, est oublié) -- limite
  // acceptée du mécanisme à un seul niveau plutôt qu'une pile complète.
  const [screenPrecedent, setScreenPrecedent] = useState<MobileScreen | null>(null)
  // Cible de navigation "Mes rdv" -> "Mes clients" : numéro de tiers (et nom,
  // en repli d'affichage) à ouvrir directement en arrivant sur l'écran
  // clients. Réinitialisée une fois consommée par MobileClients, pour ne
  // pas ré-ouvrir la même fiche si l'utilisateur revient plus tard sur cet
  // écran par le menu normal.
  const [cibleClient, setCibleClient] = useState<{ numero: string; nom: string } | null>(null)
  // Même principe pour "Documents (devis/BL/CDC...)" -> "Stock" : référence
  // article (et désignation, pour affichage immédiat sans requête
  // supplémentaire) à ouvrir directement en arrivant sur l'écran stock.
  const [cibleStock, setCibleStock] = useState<{ reference: string; designation: string } | null>(null)
  const { rights, email } = useAccess()
  const {
    total, detail, loading, fetchTodoList, fetchCerfaList,
    fetchCdcAvant2026List, fetchFraisPortList, fetchCapaciteGazList,
  } = useMobileAlertsCount()

  function goHome() {
    setScreen('home')
    setScreenPrecedent(null)
  }

  function goBack() {
    if (screenPrecedent) {
      setScreen(screenPrecedent)
      setScreenPrecedent(null)
    } else {
      goHome()
    }
  }

  function ouvrirClientDepuisRdv(numeroTiers: string, nom: string) {
    setCibleClient({ numero: numeroTiers, nom })
    setScreenPrecedent(screen)
    setScreen('clients')
  }

  /** Ouvre le détail stock d'une référence depuis N'IMPORTE QUEL écran
   * (câblé pour l'instant depuis Mes clients -- lignes d'articles des
   * devis/CDC/PL/BL/BR ; à câbler de la même façon depuis Mon activité et
   * Mes rdv si leurs fiches document exposent aussi des lignes d'articles). */
  function ouvrirStockDepuisAilleurs(reference: string, designation: string) {
    setCibleStock({ reference, designation })
    setScreenPrecedent(screen)
    setScreen('stock')
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
      {screen !== 'home' && <MobileTopBar onBack={goBack} title={screenTitle(screen)} />}

      {screen === 'home' && (
        <MobileHome email={email} rights={rights} alertsCount={total} onNavigate={setScreen} />
      )}
      {screen === 'activite' && <MobileActivite />}
      {screen === 'clients' && (
        <MobileClients
          cibleNumero={cibleClient?.numero}
          cibleNom={cibleClient?.nom}
          onCibleConsommee={() => setCibleClient(null)}
          onOpenStock={ouvrirStockDepuisAilleurs}
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
      {screen === 'stock' && (
        <MobileStockArticles
          cibleReference={cibleStock?.reference}
          cibleDesignation={cibleStock?.designation}
          onCibleConsommee={() => setCibleStock(null)}
        />
      )}
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
    case 'Admin':
      return 'Admin'  
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
        padding: '10px 16px',
        background: 'rgba(11,18,32,0.96)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {/* Agrandi (padding + taille de police) pour que le doigt ne rate pas
         la cible sur mobile -- zone tactile ~44px de hauteur minimum,
         recommandation standard iOS/Android. */}
      <button
        onClick={onBack}
        aria-label="Retour"
        style={{
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'transparent',
          color: '#fff',
          borderRadius: 12,
          padding: '12px 18px',
          fontSize: 16,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
          minHeight: 44,
        }}
      >
        ← Menu
      </button>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{title}</div>
    </div>
  )
}
