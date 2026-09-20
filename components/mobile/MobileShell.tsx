'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
 * Une entrée de la pile de navigation : un écran, plus la "cible" qui l'a
 * ouvert (client à afficher directement, référence article à ouvrir en
 * détail). La cible est portée par l'entrée elle-même -- et non par un état
 * global du shell -- pour que deux écrans du même type empilés (ex. Mes rdv
 * -> client A -> ... ) ne se marchent pas dessus.
 */
type PileEntree = {
  key: number
  screen: MobileScreen
  cibleClient?: { numero: string; nom: string } | null
  cibleStock?: { reference: string; designation: string } | null
}

/**
 * Point d'entrée de l'expérience mobile, une fois l'utilisateur authentifié.
 * Navigation interne par état (pas de changement de route).
 *
 * ÉVOLUTION (2026-09-20) : vraie pile de navigation, écrans conservés
 * montés.
 *
 * Avant : un seul écran était rendu à la fois, et un seul niveau de
 * "retour" était mémorisé. Conséquence : Mes clients -> fiche client ->
 * CDC -> (tap sur une référence) -> Stock, puis "← Menu" revenait bien sur
 * Mes clients... mais l'écran avait été démonté entre temps, donc la fiche
 * client et le document ouverts étaient perdus : l'utilisateur retombait sur
 * la liste des clients. Même chose pour Mes rdv -> client -> retour.
 *
 * Maintenant :
 *   - `pile` contient tous les écrans ouverts depuis l'accueil, dans
 *     l'ordre. Pile vide = accueil.
 *   - TOUS les écrans de la pile restent montés ; seul le dernier est
 *     visible (les autres sont en `display: none`, ce qui masque aussi
 *     leurs bottom-sheets en position fixed). Leur état React (fiche
 *     client ouverte, document ouvert, filtres, résultats de recherche,
 *     scroll interne...) est donc intact quand on revient dessus.
 *   - "← Retour" dépile d'un niveau et retombe exactement où on était.
 *     "☰ Menu" vide la pile et revient à l'accueil.
 *   - Le bouton "retour" du navigateur / du téléphone (Android, geste
 *     iOS) fait la même chose que "← Retour" : chaque écran empilé pousse
 *     une entrée dans l'historique du navigateur, et `popstate` resynchronise
 *     la pile sur la profondeur de l'entrée d'historique atteinte. Ainsi
 *     un "retour" système ne fait plus sortir de l'app d'un coup.
 *
 * Intégration : dans la page d'accueil (ou dans AppShell), afficher
 * <MobileShell /> à la place du contenu desktop quand useViewport().isMobile
 * est vrai et que la session est active. Voir MOBILE_INTEGRATION.md.
 */
export default function MobileShell() {
  const [pile, setPile] = useState<PileEntree[]>([])
  // Miroir synchrone de la pile pour les handlers non-React (popstate).
  const pileRef = useRef<PileEntree[]>([])
  pileRef.current = pile
  const nextKey = useRef(1)

  const { rights, email } = useAccess()
  const {
    total, detail, loading, fetchTodoList, fetchCerfaList,
    fetchCdcAvant2026List, fetchFraisPortList, fetchCapaciteGazList,
  } = useMobileAlertsCount()

  const courant = pile.length > 0 ? pile[pile.length - 1] : null
  const screen: MobileScreen = courant?.screen ?? 'home'

  // ── Historique navigateur ──────────────────────────────────────────
  // Chaque entrée d'historique porte la profondeur de pile qui lui
  // correspond (state.cgcDepth). Au chargement, l'entrée courante vaut
  // profondeur 0 (accueil) ; on la marque explicitement pour que le premier
  // "retour" système depuis un écran enfant retombe dessus proprement.
  useEffect(() => {
    try {
      const st = window.history.state
      if (!st || typeof st.cgcDepth !== 'number') {
        window.history.replaceState({ ...(st || {}), cgcDepth: 0 }, '')
      }
    } catch {
      // Historique indisponible (iframe sandbox...) : navigation interne seule.
    }
  }, [])

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const depth = typeof e.state?.cgcDepth === 'number' ? e.state.cgcDepth : 0
      const actuelle = pileRef.current
      if (depth < actuelle.length) {
        // Retour système : on dépile jusqu'à la profondeur atteinte.
        setPile(actuelle.slice(0, Math.max(0, depth)))
      }
      // depth >= longueur : "avancer" du navigateur -- on ne re-pousse pas
      // d'écran (l'état n'est plus disponible), on laisse la pile telle
      // quelle. Cas marginal sur mobile.
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function pousserHistorique(depth: number) {
    try {
      window.history.pushState({ cgcDepth: depth }, '')
    } catch {
      // Silencieux : la navigation interne fonctionne sans historique.
    }
  }

  /** Recule l'historique navigateur de `n` entrées SI l'entrée courante
   * correspond bien à la profondeur de pile actuelle (sinon, on ne touche
   * pas à l'historique : la pile est déjà pilotée localement). Renvoie
   * true si l'historique a été utilisé (le popstate fera le dépilage). */
  function reculerHistorique(n: number): boolean {
    try {
      const st = window.history.state
      if (st && typeof st.cgcDepth === 'number' && st.cgcDepth === pileRef.current.length && n > 0) {
        window.history.go(-n)
        return true
      }
    } catch {
      // ignore
    }
    return false
  }

  // ── Navigation ─────────────────────────────────────────────────────

  /** Depuis l'accueil : ouvre un écran de premier niveau (pile = [écran]). */
  function naviguer(cible: MobileScreen) {
    if (cible === 'home') { goHome(); return }
    setPile([{ key: nextKey.current++, screen: cible }])
    pousserHistorique(1)
  }

  /** Empile un écran par-dessus l'écran courant (qui reste monté). */
  function empiler(entree: Omit<PileEntree, 'key'>) {
    const suivante = [...pileRef.current, { ...entree, key: nextKey.current++ }]
    setPile(suivante)
    pousserHistorique(suivante.length)
  }

  const goHome = useCallback(() => {
    const n = pileRef.current.length
    if (n === 0) return
    if (!reculerHistorique(n)) setPile([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goBack = useCallback(() => {
    const n = pileRef.current.length
    if (n === 0) return
    if (!reculerHistorique(1)) setPile(pileRef.current.slice(0, n - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function ouvrirClientDepuisRdv(numeroTiers: string, nom: string) {
    empiler({ screen: 'clients', cibleClient: { numero: numeroTiers, nom } })
  }

  /** Ouvre le détail stock d'une référence depuis N'IMPORTE QUEL écran
   * (câblé depuis Mes clients -- lignes d'articles des devis/CDC/PL/BL/BR ;
   * à câbler de la même façon depuis Mon activité et Mes rdv si leurs
   * fiches document exposent aussi des lignes d'articles). L'écran d'origine
   * reste monté avec sa fiche client et son document ouverts. */
  function ouvrirStockDepuisAilleurs(reference: string, designation: string) {
    empiler({ screen: 'stock', cibleStock: { reference, designation } })
  }

  /** Une fois la cible consommée par l'écran (fiche ouverte), on l'efface
   * de son entrée pour ne pas la ré-ouvrir plus tard. */
  function consommerCible(key: number, quoi: 'cibleClient' | 'cibleStock') {
    setPile((prev) => prev.map((e) => (e.key === key ? { ...e, [quoi]: null } : e)))
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
      {screen !== 'home' && (
        <MobileTopBar
          onBack={goBack}
          onHome={goHome}
          peutRevenirUnNiveau={pile.length > 1}
          title={screenTitle(screen)}
        />
      )}

      {screen === 'home' && (
        <MobileHome email={email} rights={rights} alertsCount={total} onNavigate={naviguer} />
      )}

      {/* Tous les écrans empilés restent montés ; seul le dernier est
         affiché. `display: none` sur le conteneur masque aussi les
         bottom-sheets `position: fixed` des écrans en dessous. */}
      {pile.map((entree, i) => {
        const visible = i === pile.length - 1
        return (
          <div
            key={entree.key}
            style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', flex: 1 }}
            aria-hidden={!visible}
          >
            {entree.screen === 'activite' && <MobileActivite />}
            {entree.screen === 'clients' && (
              <MobileClients
                cibleNumero={entree.cibleClient?.numero}
                cibleNom={entree.cibleClient?.nom}
                onCibleConsommee={() => consommerCible(entree.key, 'cibleClient')}
                onOpenStock={ouvrirStockDepuisAilleurs}
              />
            )}
            {entree.screen === 'rdv' && <MobileRdv onOpenClient={ouvrirClientDepuisRdv} />}
            {entree.screen === 'alertes' && (
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
            {entree.screen === 'prospects' && <MobileProspects />}
            {entree.screen === 'stock' && (
              <MobileStockArticles
                cibleReference={entree.cibleStock?.reference}
                cibleDesignation={entree.cibleStock?.designation}
                onCibleConsommee={() => consommerCible(entree.key, 'cibleStock')}
              />
            )}
            {entree.screen === 'Admin' && <MobileAdminPanel />}
          </div>
        )
      })}
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

function MobileTopBar({
  onBack, onHome, peutRevenirUnNiveau, title,
}: {
  onBack: () => void
  onHome: () => void
  /** true quand un écran précédent existe sous l'écran courant : le bouton
   * principal devient "← Retour" (un niveau) et un second bouton "☰"
   * permet de revenir directement à l'accueil. Sinon, le bouton principal
   * reste "← Menu" comme avant. */
  peutRevenirUnNiveau: boolean
  title: string
}) {
  const boutonStyle: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'transparent',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    fontSize: 16,
    fontWeight: 600,
    fontFamily: 'var(--font-body)',
    minHeight: 44,
    flexShrink: 0,
  }
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        background: 'rgba(11,18,32,0.96)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {/* Zone tactile ~44px minimum (recommandation iOS/Android). */}
      <button onClick={onBack} aria-label={peutRevenirUnNiveau ? 'Retour à l’écran précédent' : 'Retour au menu'} style={boutonStyle}>
        {peutRevenirUnNiveau ? '← Retour' : '← Menu'}
      </button>
      {peutRevenirUnNiveau && (
        <button onClick={onHome} aria-label="Retour au menu" style={{ ...boutonStyle, padding: '12px 14px' }}>
          ☰
        </button>
      )}
      <div
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
          minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
    </div>
  )
}
