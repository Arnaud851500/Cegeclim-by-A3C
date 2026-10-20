// ============================================================================
// lib/cdcPromesses.ts — Commandes clients à date de livraison interdite
// ----------------------------------------------------------------------------
// (2026-10-20) Partagé entre le Portefeuille livraison (PC), le Centre
// d'alertes / accueil (ClientRootShell) et les alertes mobiles.
//
// Source : table cdc_promesses_controle, recalculée chaque heure à h+35 par
// refresh_cdc_promesses_controle() (même règle que l'écran « Reconstruction
// du stock projeté »), lue via la vue v_cdc_promesses_interdites (RLS =
// périmètre commercial). Une ligne = une CDC × une référence.
//
// Actions des commerciaux : table cdc_promesses_actions (une par CDC) :
//   • decaler     : nouvelle date de livraison à saisir dans SAGE / BLG ;
//   • deprioriser : une autre CDC (liste d'aide) doit prendre une date de
//                   livraison acceptable pour laisser passer celle-ci ;
//   • autre       : commentaire libre.
// Statut de traitement :
//   a_traiter     : aucune action saisie ;
//   en_attente    : action saisie, pas encore de synchro SAGE depuis ;
//   non_confirmee : une synchro est passée mais la date est toujours
//                   interdite (ou la CDC dépriorisée n'est pas couverte) ;
//   resolue       : vérifié après synchro (la ligne sort de la liste).
// L'alerte compte les CDC « à traiter » + « non confirmées ».
// ============================================================================

import { supabase } from '@/lib/supabaseClient'

export const PROMESSES_ALERT_LABEL = 'Date de livraison interdite'
/** Fenêtre de contrôle : CDC créées depuis N jours (20/10/2026 : 7 jours,
 * choix d'Arnaud). Doit correspondre au paramètre passé à
 * refresh_cdc_promesses_controle() par la tâche pg_cron
 * « cdc-promesses-controle-hourly ». Sert uniquement aux libellés. */
export const PROMESSES_FENETRE_JOURS = 7
export const PROMESSES_ALERT_DESCRIPTION =
  `CDC ouvertes créées depuis ${PROMESSES_FENETRE_JOURS} jours dont la date de livraison promise ne tient pas compte du stock disponible : intenable, ou prend le stock d’une commande plus ancienne.`
export const PROMESSES_OPEN_EVENT = 'cegeclim:open-promesses-interdites'
export const PROMESSES_URL = '/portefeuille-livraison?promesse=interdite'

/** Lien vers la fiche de la référence dans l'écran Stock articles. */
export function lienStockArticle(reference: string) {
  return `/stock?ref=${encodeURIComponent(reference)}`
}

export type PromesseVerdict = 'OK' | 'INTENABLE' | 'CREE_RETARD'
export type PromesseAction = 'decaler' | 'deprioriser' | 'autre'
export type PromesseStatut = 'a_traiter' | 'en_attente' | 'non_confirmee' | 'resolue'

export type PromesseLigne = {
  numero_document: string
  reference_article: string
  numero_tiers: string | null
  nom_tiers: string | null
  collaborateur: string | null
  representant: string | null
  agence: string | null
  date_creation: string
  date_livraison: string | null
  echeance: string
  date_bl: string | null
  ouverte: boolean
  quantite: number
  quantite_ouverte: number
  stock_phys: number
  promesses_ouvertes: number
  stock_projete_creation: number
  solde_echeance: number
  atp_echeance: number
  verdict: PromesseVerdict
  q_manque: number
  date_exacte: string | null
  date_rupture: string | null
  /** Aujourd'hui + délai d'appro + 7 j (null si arrêt / blocage appro). */
  date_appro: string | null
  arret_appro: boolean
  /** Date proposée : date exacte si plus proche, sinon date_appro ; null = aucune. */
  date_proposee: string | null
  nb_victimes: number
  q_victimes: number
  victimes: string | null
  premiere_detection: string | null
  calcule_le: string | null
  action: PromesseAction | null
  nouvelle_date: string | null
  cdc_depriorisee: string | null
  commentaire: string | null
  verification: string | null
  verifie_le: string | null
  saisi_par_nom: string | null
  saisi_par_email: string | null
  saisi_le: string | null
  statut_traitement: PromesseStatut
}

/** Une CDC (toutes ses références à problème regroupées). */
export type PromesseCommande = {
  numero_document: string
  numero_tiers: string | null
  nom_tiers: string | null
  representant: string | null
  agence: string | null
  date_creation: string
  echeance: string
  verdict: PromesseVerdict
  date_exacte: string | null
  /** Date au plus court pour toute la commande (la plus tardive de ses lignes) ; null = aucune. */
  date_proposee: string | null
  /** Vrai si la date proposée vient d'un appro à lancer (et non du stock / arrivages connus). */
  via_appro: boolean
  arret_appro: boolean
  statut_traitement: PromesseStatut
  action: PromesseAction | null
  nouvelle_date: string | null
  cdc_depriorisee: string | null
  commentaire: string | null
  verification: string | null
  saisi_par_nom: string | null
  saisi_le: string | null
  lignes: PromesseLigne[]
}

export type PromesseCandidat = {
  numero_document: string
  numero_tiers: string | null
  nom_tiers: string | null
  representant: string | null
  meme_representant: boolean
  date_creation: string | null
  date_livraison: string | null
  references_communes: string | null
  quantite: number
}

export type PromesseAlerte = { aTraiter: number; enAttente: number; nonConfirmee: number; calculeLe: string | null; indisponible: boolean }

export const VERDICT_INFO: Record<PromesseVerdict, { label: string; court: string; aide: string }> = {
  OK: { label: 'Tenable', court: 'Tenable', aide: 'La date promise est tenable sans léser personne.' },
  INTENABLE: { label: 'Intenable', court: 'Intenable', aide: 'À la date promise, le stock n’y est pas, même en comptant les arrivages.' },
  CREE_RETARD: { label: 'Crée un retard', court: 'Retard', aide: 'Livrable à sa date, mais sur le stock d’une commande plus ancienne qu’aucun arrivage ne recouvre à temps.' },
}

export const ACTION_INFO: Record<PromesseAction, { label: string; aide: string }> = {
  decaler: { label: 'Décaler la date de livraison', aide: 'Nouvelle date à saisir dans SAGE / BLG — au plus tôt la date proposée (stock et arrivages connus, ou appro lancé aujourd’hui).' },
  deprioriser: { label: 'Déprioriser une autre commande', aide: 'Une autre CDC de votre portefeuille prend une date plus tardive (à saisir dans SAGE / BLG) pour laisser passer celle-ci.' },
  autre: { label: 'Autre (commentaire)', aide: 'Substitution, livraison partielle, accord client… à préciser dans le commentaire.' },
}

export const STATUT_INFO: Record<PromesseStatut, { label: string; aide: string }> = {
  a_traiter: { label: 'À traiter', aide: 'Aucune action saisie.' },
  en_attente: { label: 'En attente synchro', aide: 'Action saisie : vérification à la prochaine synchronisation SAGE.' },
  non_confirmee: { label: 'Non confirmée', aide: 'Une synchro est passée : la date est toujours interdite (ou la CDC dépriorisée n’est pas couverte à sa date).' },
  resolue: { label: 'Résolue', aide: 'Vérifiée après synchro.' },
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function txt(v: unknown): string | null { const s = v === null || v === undefined ? '' : String(v).trim(); return s ? s : null }
function dateIso(v: unknown): string | null { const s = txt(v); return s ? s.slice(0, 10) : null }

function normaliserLigne(r: Record<string, any>): PromesseLigne {
  return {
    numero_document: String(r.numero_document || '').trim(),
    reference_article: String(r.reference_article || '').trim(),
    numero_tiers: txt(r.numero_tiers),
    nom_tiers: txt(r.nom_tiers),
    collaborateur: txt(r.collaborateur),
    representant: txt(r.representant),
    agence: txt(r.agence),
    date_creation: dateIso(r.date_creation) || '',
    date_livraison: dateIso(r.date_livraison),
    echeance: dateIso(r.echeance) || '',
    date_bl: dateIso(r.date_bl),
    ouverte: Boolean(r.ouverte),
    quantite: num(r.quantite),
    quantite_ouverte: num(r.quantite_ouverte),
    stock_phys: num(r.stock_phys),
    promesses_ouvertes: num(r.promesses_ouvertes),
    stock_projete_creation: num(r.stock_projete_creation),
    solde_echeance: num(r.solde_echeance),
    atp_echeance: num(r.atp_echeance),
    verdict: (['OK', 'INTENABLE', 'CREE_RETARD'].includes(r.verdict) ? r.verdict : 'OK') as PromesseVerdict,
    q_manque: num(r.q_manque),
    date_exacte: dateIso(r.date_exacte),
    date_rupture: dateIso(r.date_rupture),
    date_appro: dateIso(r.date_appro),
    arret_appro: Boolean(r.arret_appro),
    date_proposee: dateIso(r.date_proposee) ?? (r.date_proposee === undefined ? dateIso(r.date_exacte) : null),
    nb_victimes: num(r.nb_victimes),
    q_victimes: num(r.q_victimes),
    victimes: txt(r.victimes),
    premiere_detection: txt(r.premiere_detection),
    calcule_le: txt(r.calcule_le),
    action: (['decaler', 'deprioriser', 'autre'].includes(r.action) ? r.action : null) as PromesseAction | null,
    nouvelle_date: dateIso(r.nouvelle_date),
    cdc_depriorisee: txt(r.cdc_depriorisee),
    commentaire: txt(r.commentaire),
    verification: txt(r.verification),
    verifie_le: txt(r.verifie_le),
    saisi_par_nom: txt(r.saisi_par_nom),
    saisi_par_email: txt(r.saisi_par_email),
    saisi_le: txt(r.saisi_le),
    statut_traitement: (['a_traiter', 'en_attente', 'non_confirmee', 'resolue'].includes(r.statut_traitement) ? r.statut_traitement : 'a_traiter') as PromesseStatut,
  }
}

const GRAVITE: Record<PromesseVerdict, number> = { OK: 0, CREE_RETARD: 1, INTENABLE: 2 }

/** Regroupe les lignes (CDC × référence) par CDC. Les lignes tenables d'une
 * CDC à problème sont écartées du détail. */
export function grouperParCommande(lignes: PromesseLigne[]): PromesseCommande[] {
  const map = new Map<string, PromesseCommande>()
  for (const l of lignes) {
    let c = map.get(l.numero_document)
    if (!c) {
      c = {
        numero_document: l.numero_document, numero_tiers: l.numero_tiers, nom_tiers: l.nom_tiers, representant: l.representant,
        agence: l.agence, date_creation: l.date_creation, echeance: l.echeance, verdict: l.verdict, date_exacte: l.date_exacte,
        date_proposee: l.date_proposee, via_appro: false, arret_appro: false,
        statut_traitement: l.statut_traitement, action: l.action, nouvelle_date: l.nouvelle_date, cdc_depriorisee: l.cdc_depriorisee,
        commentaire: l.commentaire, verification: l.verification, saisi_par_nom: l.saisi_par_nom, saisi_le: l.saisi_le, lignes: [],
      }
      map.set(l.numero_document, c)
    }
    if (l.verdict !== 'OK') c.lignes.push(l)
  }
  // Verdict, échéance et date exacte de la CDC = ceux de ses lignes à
  // problème (verdict le plus grave, échéance la plus proche, date exacte la
  // plus tardive — « aucune » si une ligne n'en a pas).
  for (const c of map.values()) {
    if (c.lignes.length === 0) { c.verdict = 'OK'; continue }
    c.verdict = c.lignes.reduce<PromesseVerdict>((v, l) => (GRAVITE[l.verdict] > GRAVITE[v] ? l.verdict : v), 'OK')
    c.echeance = c.lignes.reduce((e, l) => (l.echeance < e ? l.echeance : e), c.lignes[0].echeance)
    c.date_exacte = c.lignes.some((l) => l.date_exacte === null)
      ? null
      : c.lignes.reduce((d, l) => (l.date_exacte! > d ? l.date_exacte! : d), c.lignes[0].date_exacte!)
    c.date_proposee = c.lignes.some((l) => l.date_proposee === null)
      ? null
      : c.lignes.reduce((d, l) => (l.date_proposee! > d ? l.date_proposee! : d), c.lignes[0].date_proposee!)
    c.via_appro = c.lignes.some((l) => l.date_proposee !== null && l.date_proposee !== l.date_exacte)
    c.arret_appro = c.lignes.some((l) => l.arret_appro)
  }
  return Array.from(map.values())
    .sort((a, b) => b.date_creation.localeCompare(a.date_creation) || a.numero_document.localeCompare(b.numero_document))
}

/** Liste (périmètre de l'utilisateur via RLS). Erreur remontée telle quelle. */
export async function fetchPromessesInterdites(): Promise<PromesseLigne[]> {
  const out: PromesseLigne[] = []
  const page = 1000
  for (let from = 0; from < 50000; from += page) {
    const { data, error } = await supabase
      .from('v_cdc_promesses_interdites')
      .select('*')
      .order('date_creation', { ascending: false })
      .order('numero_document', { ascending: true })
      .order('reference_article', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw error
    const rows = (data || []) as Record<string, any>[]
    out.push(...rows.map(normaliserLigne))
    if (rows.length < page) break
  }
  return out
}

/** Compteur de l'alerte. Ne lève jamais : indisponible = true si la base
 * n'a pas encore les objets (script non exécuté) ou en cas d'erreur. */
export async function fetchPromessesAlerte(): Promise<PromesseAlerte> {
  try {
    const { data, error } = await supabase.rpc('get_cdc_promesses_alerte')
    if (error) throw error
    const d = (data || {}) as Record<string, any>
    return { aTraiter: num(d.a_traiter), enAttente: num(d.en_attente), nonConfirmee: num(d.non_confirmee), calculeLe: txt(d.calcule_le), indisponible: false }
  } catch (e) {
    console.warn('[cdcPromesses] alerte indisponible', e)
    return { aTraiter: 0, enAttente: 0, nonConfirmee: 0, calculeLe: null, indisponible: true }
  }
}

export async function fetchPromesseCandidats(numeroDocument: string): Promise<PromesseCandidat[]> {
  const { data, error } = await supabase.rpc('get_cdc_promesses_candidats', { p_numero_document: numeroDocument })
  if (error) throw error
  return ((data || []) as Record<string, any>[]).map((r) => ({
    numero_document: String(r.numero_document || '').trim(),
    numero_tiers: txt(r.numero_tiers),
    nom_tiers: txt(r.nom_tiers),
    representant: txt(r.representant),
    meme_representant: Boolean(r.meme_representant),
    date_creation: dateIso(r.date_creation),
    date_livraison: dateIso(r.date_livraison),
    references_communes: txt(r.references_communes),
    quantite: num(r.quantite),
  }))
}

export type PromesseSaisie = {
  action: PromesseAction
  nouvelleDate: string | null
  cdcDepriorisee: string | null
  commentaire: string
}

/** Contrôle de saisie, partagé PC / mobile. Renvoie le message d'erreur ou null. */
export function verifierSaisie(s: PromesseSaisie, cmd?: Pick<PromesseCommande, 'numero_document' | 'date_exacte' | 'date_creation'>): string | null {
  if (!s.commentaire.trim()) return 'Le commentaire est obligatoire.'
  if (s.action === 'decaler') {
    if (!s.nouvelleDate) return 'Indiquez la nouvelle date de livraison.'
    if (cmd && s.nouvelleDate < cmd.date_creation) return 'La nouvelle date ne peut pas précéder la création de la commande.'
  }
  if (s.action === 'deprioriser') {
    const cdc = (s.cdcDepriorisee || '').trim().toUpperCase()
    if (!cdc) return 'Choisissez la commande à déprioriser.'
    if (cmd && cdc === cmd.numero_document.toUpperCase()) return 'La commande à déprioriser doit être différente.'
  }
  return null
}

/** Enregistre (ou remplace) l'action d'une CDC. Le trigger base remet le
 * statut « en attente » de la prochaine synchro. */
export async function enregistrerAction(numeroDocument: string, s: PromesseSaisie, auteur: { email?: string | null; nom?: string | null }) {
  const { error } = await supabase.from('cdc_promesses_actions').upsert({
    numero_document: numeroDocument,
    action: s.action,
    nouvelle_date: s.action === 'decaler' ? s.nouvelleDate : null,
    cdc_depriorisee: s.action === 'deprioriser' ? (s.cdcDepriorisee || '').trim().toUpperCase() : null,
    commentaire: s.commentaire.trim(),
    saisi_par_email: auteur.email || null,
    saisi_par_nom: auteur.nom || auteur.email || null,
  }, { onConflict: 'numero_document' })
  if (error) throw error
}

export async function supprimerAction(numeroDocument: string) {
  const { error } = await supabase.from('cdc_promesses_actions').delete().eq('numero_document', numeroDocument)
  if (error) throw error
}

export function formatDateCourte(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}

export function formatSigne(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return `${r > 0 ? '+' : ''}${r.toLocaleString('fr-FR')}`
}

export function joursEntre(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null
  return Math.round((new Date(`${b.slice(0, 10)}T00:00:00`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00`).getTime()) / 86400000)
}
