// ============================================================================
// lib/navigation.ts — Source unique de l'arborescence de l'intranet
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-15) : la navigation desktop reprend l'expérience mobile
// (blocs colorés). Tous les écrans sont regroupés ici en « blocs », chaque bloc
// portant 1..n pages. Ce fichier est consommé par :
//   - app/accueil/page.tsx        : grille de blocs + panneau des pages du bloc
//   - components/ClientRootShell  : bouton MENU, volet « Arborescence », titre
//                                   de page, contrôle d'accès (/unauthorized)
// Pour ajouter un écran : une ligne dans le bon bloc, rien d'autre à toucher.
//
// ÉVOLUTION (2026-09-16) : « Mes clients » réduit à Prospects / Clients (carte),
// Suivi multi clients et Vision client 360 (les deux derniers sortis de « Mon
// activité ») ; Liste globale (/clients) reste uniquement sous Admin ; Clients
// CEGECLIM et Suivi prospects retirés de l'arborescence ; bloc « Mes tâches /
// Mes RDV » = Todo List + Agenda (+ Documents).
// Le bloc « Mes alertes » de l'accueil n'est pas ici : il n'a pas de page, il
// ouvre le Centre d'alertes (components/AlertsContext.tsx + ClientRootShell).

// ============================================================================

import type { AccessRights } from '@/components/AccessContext'

export type MenuAccessKey = Exclude<
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
  | 'show_alert_data_coherence'
  | 'can_change_scope'
>

export type NavPage = {
  /** Libellé affiché dans le bloc et le volet (sans numérotation). */
  label: string
  path: string
  /** Droit requis. Absent = visible pour tout utilisateur connecté. */
  accessKey?: MenuAccessKey
  /** Titre affiché dans le bandeau quand la page est active (repli : label). */
  activeLabel?: string
  /** Une phrase, affichée sous le libellé dans le panneau du bloc. */
  description?: string
}

export type NavBloc = {
  id: string
  label: string
  subtitle: string
  /** Emoji, même registre que MobileHome (utilisé seul dans le volet
   * Arborescence et le fil d'Ariane). */
  icon: string
  /** Emojis affichés côte à côte sur le bloc de l'accueil quand le bloc
   * regroupe plusieurs univers (ex. tâches + agenda). Repli : [icon]. */
  icons?: string[]
  /** Dégradé du bloc (haut → bas), charte mobile. */
  gradient: [string, string]
  /** Fond du carré icône. */
  iconBg: string
  pages: NavPage[]
}

export const ACCUEIL_PATH = '/accueil'

// ----------------------------------------------------------------------------
// Arborescence
// ----------------------------------------------------------------------------
export const NAV_BLOCS: NavBloc[] = [
  {
    id: 'activite',
    label: 'Mon activité',
    subtitle: 'Devis · CDC · BL · Factures · Marge',
    icon: '📊',
    gradient: ['#245A9E', '#173B6C'],
    iconBg: 'rgba(255,255,255,0.18)',
    pages: [
      { label: 'Vision ONE PAGE', path: '/tableaux-de-bord/vision-tci', accessKey: 'can_dashboard', description: 'Synthèse TCI en une page : commandes, livraisons, facturation, marge.' },
      { label: 'Activité quotidienne', path: '/focus_mensuel2', accessKey: 'can_dashboard', description: 'Focus mensuel jour par jour, faits marquants et projection de CA.' },
      { label: 'Tableaux de bord', path: '/atelier-analyse', accessKey: 'can_dashboard', description: 'Atelier d’analyse et tableaux de bord personnalisables.' },
      { label: 'Analyse devis', path: '/cycle-documents', accessKey: 'can_dashboard', description: 'Cycle des documents et transformation des devis.' },
      { label: 'Courbes de flux', path: '/approvisionnements', accessKey: 'can_dashboard', description: 'Courbes Devis – CDC – BL – Factures dans le temps.' },
      { label: 'Activités – CA', path: '/activites', accessKey: 'can_autorisation', description: 'Suivre les activités et les indicateurs de chiffre d’affaires.' },
      { label: 'Indicateurs', path: '/indicateurs', accessKey: 'can_dashboard', description: 'Principaux indicateurs de performance (commerce, services, coûts, stocks).' },
      { label: 'Analyse IA', path: '/atelier-analyse/assistant', accessKey: 'can_autorisation', description: 'Assistant d’analyse conversationnel sur les données de l’activité.' },
      { label: 'Indicateurs (pilotage)', path: '/Indicateurs', accessKey: 'can_autorisation', description: 'Vue pilotage des indicateurs, réservée aux administrateurs.' },
    ],
  },
  {
    id: 'clients',
    label: 'Mes clients',
    subtitle: 'Prospects, suivi multi clients, vision 360',
    icon: '👥',
    gradient: ['#4E7A2A', '#2F5219'],
    iconBg: 'rgba(255,255,255,0.18)',
    pages: [
      { label: 'Prospects / Clients', path: '/carte', accessKey: 'can_carte', description: 'Liste et carte des prospects et clients pour les analyses géographiques et le suivi commercial.' },
      { label: 'Suivi multi clients', path: '/synthese_multi_clients', accessKey: 'can_dashboard', description: 'Tableau comparatif client par client sur l’année et en cumul.' },
      { label: 'Vision client 360', path: '/vision-client', activeLabel: 'Vision client', accessKey: 'can_dashboard', description: 'Fiche complète d’un client : historique, documents, retards de paiement.' },
    ],
  },
  {
    id: 'territoire',
    label: 'Territoire',
    subtitle: 'Régions, départements, agences',
    icon: '🗺️',
    gradient: ['#236B54', '#154536'],
    iconBg: 'rgba(255,255,255,0.18)',
    pages: [
      { label: 'Région – Département', path: '/territoire', activeLabel: 'Région-Dépt.', accessKey: 'can_territoire', description: 'Territoires, potentiels PAC et attractivité par département et par région.' },
      { label: 'Agences', path: '/agences', accessKey: 'can_agences', description: 'Agences, effectifs, surfaces, rattachements et caractéristiques principales.' },
      { label: 'Cartographie', path: '/cartographie', accessKey: 'can_cartographie', description: 'Représentation géographique des données sur fond de carte.' },
    ],
  },
  {
    id: 'taches',
    label: 'Mes tâches / Mes RDV',
    subtitle: 'À traiter en priorité, agenda, documents',
    icon: '✅',
    icons: ['✅', '📅'],
    gradient: ['#A5482A', '#6E2E19'],
    iconBg: 'rgba(255,255,255,0.18)',
    pages: [
      { label: 'Todo List', path: '/todo', accessKey: 'can_todo', description: 'Créer, suivre et mettre à jour les tâches.' },
      { label: 'Agenda', path: '/agenda', accessKey: 'can_dashboard', description: 'Planning des rendez-vous, comptes rendus, dictée vocale et recherche de documents.' },
      { label: 'Documents', path: '/documents', accessKey: 'can_documents', description: 'Documents, dossiers et pièces partagées selon les droits attribués.' },
    ],
  },
  {
    id: 'logistique',
    label: 'Stocks & logistique',
    subtitle: 'Portefeuille, projection, dépôts',
    icon: '📦',
    gradient: ['#8B8767', '#5E5A44'],
    iconBg: 'rgba(255,255,255,0.18)',
    pages: [
      { label: 'Portefeuille de commandes', path: '/portefeuille-livraison', activeLabel: 'Portefeuille cde', accessKey: 'can_dashboard', description: 'CDC à livrer, contrôle des frais de port, couverture stock.' },
      { label: 'Projection stock', path: '/stocks-disponibilites2', accessKey: 'can_stocks', description: 'Stock projeté par référence, hypothèses mensuelles et substitutions.' },
      { label: 'Reconstitution Stock', path: '/stock/reconstruction', accessKey: 'can_stocks', description: 'Reconstruction stock projeté et verification des promesses"' },
      { label: 'Vision dispo par groupe d article', path: '/stock/groupes', accessKey: 'can_stocks', description: 'Visibilite dispo à venir et livraisons possibles"' },
      { label: 'Stocks', path: '/stock', accessKey: 'can_stocks', description: 'Consultation des stocks (FMS et Agences), stocks prévisionnels et visu des dates de disponibilité .' },
    ],
  },
  {
    id: 'financement',
    label: 'Financement',
    subtitle: 'Dossiers CEE et aides financières',
    icon: '💶',
    gradient: ['#1F5A46', '#0E2A22'],
    iconBg: 'rgba(217,182,92,0.22)',
    pages: [
      { label: 'Creation Dossier', path: '/financement/dossiers/nouveau', activeLabel: 'Creation d un nouveau dossier', accessKey: 'can_financement', description: 'Création d un dossier' },
      { label: 'Parcours des dossiers CEE', path: '/financement', accessKey: 'can_financement', description: 'Tableau de bord des dossiers par étape : prêt, à corriger, bloqué.' },
      { label: 'Contrôle des pièces (IA)', path: '/financement/controle-pieces', activeLabel: 'Contrôle des pièces CEE', accessKey: 'can_financement', description: 'Vérification assistée des pièces et de la note de dimensionnement.' },
    ],
  },
  {
    id: 'blg',
    label: 'Projet BLG',
    subtitle: 'Cohérence SAGE ↔ BLG, appro',
    icon: '🔁',
    gradient: ['#54459F', '#352B6B'],
    iconBg: 'rgba(255,255,255,0.18)',
    pages: [
      { label: 'Articles SAGE – BLG', path: '/controle-sage-blg/articles', activeLabel: 'Contrôle cohérence Articles SAGE-BLG', accessKey: 'can_autorisation', description: 'Contrôle de cohérence des articles entre SAGE et BLG.' },
      { label: 'Clients SAGE – BLG', path: '/controle-sage-blg/clients', activeLabel: 'Contrôle cohérence Client SAGE-BLG', accessKey: 'can_autorisation', description: 'Contrôle de cohérence des tiers, contacts et adresses de livraison.' },
      { label: 'Fournisseurs SAGE – BLG', path: '/controle-sage-blg/fournisseur-sage-blg', activeLabel: 'Contrôle cohérence Fournisseur SAGE-BLG', accessKey: 'can_autorisation', description: 'Contrôle de cohérence fournisseurs et articles entre SAGE et BLG.' },
      { label: 'Commandes fournissueurs SAGE – BLG', path: '/controle-sage-blg/commandes-fournisseurs-sage-blg', activeLabel: 'Appro Achat SAGE-BLG', accessKey: 'can_autorisation', description: 'Controle de cohérence du portefeuille de commandes fournisseurs.' },
      { label: 'Commandes clientsF SAGE – BLG', path: '/controle-sage-blg/commandes-cients-sage-blg', activeLabel: 'Contrôle cohérence Fournisseur SAGE-BLG', accessKey: 'can_autorisation', description: 'Contrôle de cohérence du portefeuille de commandes clients.' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    subtitle: 'Profils, imports, synchronisation',
    icon: '🛠️',
    gradient: ['#2F4A3C', '#1B2C24'],
    iconBg: 'rgba(255,255,255,0.14)',
    pages: [
      { label: 'Profils et autorisations', path: '/autorisation', accessKey: 'can_autorisation', description: 'Accès utilisateurs, scopes, agences autorisées et départements visibles.' },
      { label: 'MAJ base clients', path: '/clients', activeLabel: 'MAJ Base clients', accessKey: 'can_autorisation', description: 'Mise à jour de la base clients.' },
      { label: 'MAJ données activité', path: '/Import', activeLabel: 'MAJ Données Activité', accessKey: 'can_autorisation', description: 'Imports, contrôles des agrégats et cohérence des données.' },
      { label: 'Planification des jobs', path: '/admin/planification', activeLabel: 'Job scheduling', accessKey: 'can_autorisation', description: 'Planification des synchronisations et recalculs.' },
      { label: 'Cycle de synchronisation', path: '/cycle-synchronisation', activeLabel: 'Cycle Synchronisation data', accessKey: 'can_autorisation', description: 'État et historique des cycles de synchronisation SAGE → Supabase.' },
      { label: 'MAJ retards paiement', path: '/retards-paiement', activeLabel: 'Retards de paiements', accessKey: 'can_autorisation', description: 'Intégration du fichier des retards de paiemnets.' },
    ],
  },
]

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
export function isPageAllowed(page: NavPage, rights: AccessRights) {
  return !page.accessKey || Boolean(rights[page.accessKey])
}

/** Blocs visibles pour un utilisateur : seuls les blocs ayant au moins une
 * page autorisée sont retournés, chacun réduit à ses pages autorisées. */
export function getVisibleBlocs(rights: AccessRights): NavBloc[] {
  return NAV_BLOCS
    .map((bloc) => ({ ...bloc, pages: bloc.pages.filter((page) => isPageAllowed(page, rights)) }))
    .filter((bloc) => bloc.pages.length > 0)
}

export function isPagePathActive(pagePath: string, pathname: string) {
  if (pathname === pagePath) return true
  if (pagePath === '/') return false
  return pathname.startsWith(`${pagePath}/`)
}

/** Page active (la plus spécifique) et son bloc, tous blocs confondus.
 * Ex. /financement/controle-pieces gagne sur /financement. */
export function findActivePage(pathname: string, rights?: AccessRights): { bloc: NavBloc; page: NavPage } | null {
  let best: { bloc: NavBloc; page: NavPage } | null = null
  const blocs = rights ? getVisibleBlocs(rights) : NAV_BLOCS
  for (const bloc of blocs) {
    for (const page of bloc.pages) {
      if (!isPagePathActive(page.path, pathname)) continue
      if (!best || page.path.length > best.page.path.length) best = { bloc, page }
    }
  }
  return best
}

/** Un chemin est autorisé s'il n'est pas dans l'arborescence (page libre :
 * fiches, accueil…) ou si AU MOINS une entrée de ce chemin est ouverte par
 * un droit de l'utilisateur (ex. /clients existe dans « Mes clients » via
 * can_clients et dans « Admin » via can_autorisation). */
export function isPathAllowed(pathname: string, rights: AccessRights) {
  const entries = NAV_BLOCS.flatMap((bloc) => bloc.pages).filter((page) => page.path === pathname)
  if (entries.length === 0) return true
  return entries.some((page) => isPageAllowed(page, rights))
}

/** Droits « historiques » (commercial, pilotage, admin), hors financement. */
export function hasStandardMenuAccess(rights: AccessRights) {
  return NAV_BLOCS
    .filter((bloc) => bloc.id !== 'financement')
    .some((bloc) => bloc.pages.some((page) => isPageAllowed(page, rights)))
}

export function pageTitleFor(page: NavPage) {
  return page.activeLabel || page.label
}
