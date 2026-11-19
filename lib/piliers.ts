// ============================================================================
// lib/piliers.ts — Réunion Piliers / Feuille de route (19/11/2026)
// ----------------------------------------------------------------------------
// Types, référentiels de caractérisation et petites fonctions partagées par
// app/piliers/page.tsx. Tables : piliers_membres, piliers_reunions,
// piliers_meteo, piliers_sujets, piliers_sujet_porteurs, piliers_suivis,
// piliers_reunion_sujets (supabase/migrations/20261119a_reunion_piliers.sql).
// Accès : membres actifs uniquement (RLS piliers_est_membre()).
// ============================================================================

export type Membre = {
  id: string
  email: string | null
  prenom: string
  role: string
  domaine: string
  couleur: string
  ordre: number
  actif: boolean
  est_animateur: boolean
}

export type Reunion = {
  id: string
  date_reunion: string
  titre: string
  lieu: string
  statut: 'preparation' | 'en_cours' | 'cloturee'
  synthese: string
  cloturee_le: string | null
  /** (19/11/2026) Rédacteur : rédige et clôture la réunion. */
  redacteur_id: string | null
  created_at: string
}

export type Meteo = {
  reunion_id: string
  membre_id: string
  humeur: number | null
  mot: string
}

export type Nature = 'info' | 'expose' | 'question' | 'decision' | 'action' | 'projet'
export type Statut = 'a_aborder' | 'a_planifier' | 'en_cours' | 'en_attente' | 'fait' | 'abandonne'
export type Ressenti = 'irritant' | 'attendu' | 'changement' | 'neutre'
export type ComStatut = 'a_preparer' | 'pret' | 'diffuse'
export type Origine = 'remonte' | 'seance' | 'meteo' | 'action_liee'
export type PropositionPorteur = 'suivre' | 'abandonner' | 'rediscuter'

export type Sujet = {
  id: string
  numero: number
  titre: string
  contexte: string
  nature: Nature
  statut: Statut
  domaine: string
  ressenti: Ressenti
  enjeux: string[]
  impacte_ca: boolean
  impact_ca_note: string
  priorite: number | null
  prochain_point: string | null
  echeance: string | null
  a_l_ordre_du_jour: boolean
  a_communiquer: boolean
  communication_statut: ComStatut
  communication_cible: string
  communication_message: string
  communication_diffusee_le: string | null
  reunion_origine: string | null
  /** Action tirée d'un autre sujet (série d'actions saisie en réunion). */
  parent_id: string | null
  origine: Origine
  /** (19/11/2026) Sujet confidentiel : pastille 🔒, exclu de la communication. */
  confidentiel: boolean
  /** (19/11/2026) Membre qui a mis le sujet à l'ordre du jour. */
  propose_par: string | null
  /** (19/11/2026) Proposition du porteur pour la revue (remise à vide une fois revu). */
  proposition_porteur: PropositionPorteur | null
  proposition_commentaire: string
  proposition_le: string | null
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
  clos_le: string | null
}

export type Porteur = { sujet_id: string; membre_id: string; role: 'pilote' | 'contributeur' }

export type SuiviType = 'update' | 'question' | 'decision' | 'statut' | 'note'

export type Suivi = {
  id: string
  sujet_id: string
  reunion_id: string | null
  type: SuiviType
  texte: string
  auteur_email: string | null
  created_at: string
}

export type Issue = 'fait' | 'on_continue' | 'en_attente' | 'abandonne' | 'qualifie' | 'pour_info'

export type ReunionSujet = {
  reunion_id: string
  sujet_id: string
  issue: Issue
  commentaire: string
  revu_le: string
}

// ----------------------------------------------------------------------------
// Référentiels (libellé, aide, couleur)
// ----------------------------------------------------------------------------
type Ref<K extends string> = { key: K; label: string; icon: string; help: string; color: string }

export const NATURES: Ref<Nature>[] = [
  { key: 'info', label: 'Pour info', icon: 'ℹ️', help: 'On partage, rien à décider.', color: '#5E8FB3' },
  { key: 'expose', label: 'Sujet à exposer', icon: '🗣️', help: 'On présente un sujet au groupe.', color: '#2D6F86' },
  { key: 'question', label: 'Question', icon: '❓', help: 'On a besoin de l’avis du groupe.', color: '#C9A227' },
  { key: 'decision', label: 'Décision à prendre', icon: '⚖️', help: 'Une décision est attendue.', color: '#C1683C' },
  { key: 'action', label: 'Action', icon: '🎯', help: 'Quelque chose à faire, avec un porteur.', color: '#4E7A2A' },
  { key: 'projet', label: 'Projet', icon: '🧱', help: 'Plusieurs étapes, dans la durée.', color: '#7A5EA8' },
]

export const STATUTS: Ref<Statut>[] = [
  { key: 'a_aborder', label: 'À aborder', icon: '📥', help: 'Remonté, pas encore vu en réunion.', color: '#C9A227' },
  { key: 'a_planifier', label: 'À planifier', icon: '🗓️', help: 'Validé, pas encore démarré.', color: '#5E8FB3' },
  { key: 'en_cours', label: 'En cours', icon: '▶️', help: 'Le porteur avance.', color: '#4E7A2A' },
  { key: 'en_attente', label: 'En attente', icon: '⏸️', help: 'Bloqué ou dépend d’autre chose.', color: '#C1683C' },
  { key: 'fait', label: 'Fait / classé', icon: '✅', help: 'Terminé ou information prise en compte.', color: '#2E7D5B' },
  { key: 'abandonne', label: 'Abandonné', icon: '✖️', help: 'On ne le fera pas.', color: '#7C8597' },
]

export const RESSENTIS: Ref<Ressenti>[] = [
  { key: 'irritant', label: 'Irritant', icon: '🔥', help: 'Les équipes en souffrent aujourd’hui.', color: '#C1683C' },
  { key: 'attendu', label: 'Attendu', icon: '🙌', help: 'Les équipes le demandent.', color: '#2E7D5B' },
  { key: 'changement', label: 'Changement', icon: '🧭', help: 'Va changer leurs habitudes : à accompagner.', color: '#7A5EA8' },
  { key: 'neutre', label: 'Sans effet direct', icon: '·', help: 'Peu visible pour les équipes.', color: '#7C8597' },
]

export const ENJEUX: Ref<string>[] = [
  { key: 'humain', label: 'Humain', icon: '👥', help: 'Équipes, recrutement, climat, compétences.', color: '#A5482A' },
  { key: 'financier', label: 'Financier', icon: '💶', help: 'Coûts, marge, trésorerie.', color: '#245A9E' },
  { key: 'client', label: 'Client', icon: '🤝', help: 'Service, satisfaction, image.', color: '#2D6F86' },
  { key: 'organisation', label: 'Organisation', icon: '⚙️', help: 'Process, outils, routines.', color: '#54459F' },
  { key: 'risque', label: 'Risque', icon: '🛡️', help: 'Conformité, sécurité, dépendance.', color: '#8C5A1C' },
]

export const PRIORITES: { key: number; label: string; help: string; color: string }[] = [
  { key: 1, label: 'P1', help: 'Maintenant', color: '#C1683C' },
  { key: 2, label: 'P2', help: 'Ce trimestre', color: '#C9A227' },
  { key: 3, label: 'P3', help: 'Plus tard', color: '#5E8FB3' },
]

export const COM_STATUTS: Ref<ComStatut>[] = [
  { key: 'a_preparer', label: 'À préparer', icon: '✏️', help: 'Message à rédiger.', color: '#C9A227' },
  { key: 'pret', label: 'Prêt à diffuser', icon: '📨', help: 'Validé, à envoyer.', color: '#2D6F86' },
  { key: 'diffuse', label: 'Diffusé', icon: '📣', help: 'Communiqué aux équipes.', color: '#2E7D5B' },
]

export const COM_CIBLES = ['Tous les collaborateurs', 'Agences', 'Commerciaux', 'Logistique / ADV', 'SAV / Technique', 'Encadrement']

export const SUIVI_TYPES: Ref<SuiviType>[] = [
  { key: 'update', label: 'Nouvelle', icon: '🔄', help: 'Où on en est.', color: '#2D6F86' },
  { key: 'question', label: 'Question', icon: '❓', help: 'À poser à la prochaine réunion.', color: '#C9A227' },
  { key: 'decision', label: 'Décision', icon: '⚖️', help: 'Ce qui a été décidé.', color: '#C1683C' },
  { key: 'note', label: 'Note', icon: '📝', help: 'Contexte, lien, chiffre.', color: '#7C8597' },
  { key: 'statut', label: 'Statut', icon: '↪️', help: 'Changement de statut.', color: '#7C8597' },
]

export const MOODS = [
  { key: 5, icon: '☀️', label: 'Grand beau' },
  { key: 4, icon: '🌤️', label: 'Beau' },
  { key: 3, icon: '⛅', label: 'Variable' },
  { key: 2, icon: '🌧️', label: 'Pluie' },
  { key: 1, icon: '⛈️', label: 'Orage' },
]

export const ISSUES: Record<Issue, { label: string; icon: string; color: string }> = {
  fait: { label: 'Fait', icon: '✅', color: '#2E7D5B' },
  on_continue: { label: 'On continue', icon: '➡️', color: '#2D6F86' },
  en_attente: { label: 'En attente', icon: '⏸️', color: '#C1683C' },
  abandonne: { label: 'Abandonné', icon: '✖️', color: '#7C8597' },
  qualifie: { label: 'Pris en charge', icon: '🚀', color: '#4E7A2A' },
  pour_info: { label: 'Pris pour info', icon: 'ℹ️', color: '#5E8FB3' },
}

export const PROPOSITIONS: { key: PropositionPorteur; label: string; icon: string; color: string; help: string }[] = [
  { key: 'suivre', label: 'À suivre', icon: '➡️', color: '#2D6F86', help: 'On continue, rien à décider.' },
  { key: 'abandonner', label: 'À abandonner', icon: '✖️', color: '#7C8597', help: 'Le porteur propose d’arrêter.' },
  { key: 'rediscuter', label: 'À rediscuter', icon: '💬', color: '#C1683C', help: 'Le porteur veut en parler en réunion.' },
]

export const OPEN_STATUTS: Statut[] = ['a_planifier', 'en_cours', 'en_attente']

export function refOf<K extends string>(list: Ref<K>[], key: K | string | null | undefined) {
  return list.find((item) => item.key === key) || null
}

// ----------------------------------------------------------------------------
// Dates (format AAAA-MM-JJ, heure locale)
// ----------------------------------------------------------------------------
export function todayIso() {
  return isoOf(new Date())
}

export function isoOf(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return isoOf(date)
}

export function daysBetween(fromIso: string, toIso: string) {
  const [y1, m1, d1] = fromIso.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = toIso.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', opts)
}

export function fmtDateLong(iso: string | null | undefined) {
  return fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function fmtDateTime(ts: string | null | undefined) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Pour info / sujet à exposer : ni porteur ni priorité exigés. */
export function estInfo(n: Nature) {
  return n === 'info' || n === 'expose'
}

/** Priorité attendue : sujet ouvert qui n'est pas une simple info. */
export function prioriteAttendue(s: Sujet) {
  return isOpen(s) && !estInfo(s.nature)
}

export function isOpen(s: Sujet) {
  return s.statut !== 'fait' && s.statut !== 'abandonne'
}

export function isOverdue(s: Sujet, today = todayIso()) {
  return isOpen(s) && !!s.prochain_point && s.prochain_point < today
}

/** Ordre d'importance pour les listes : retard, priorité, impact CA, irritant, numéro. */
export function scoreSujet(s: Sujet, today = todayIso()) {
  let score = 0
  if (isOverdue(s, today)) score += 1000
  if (s.a_l_ordre_du_jour) score += 400
  score += s.priorite ? (4 - s.priorite) * 100 : 50
  if (s.impacte_ca) score += 60
  if (s.ressenti === 'irritant') score += 40
  return score
}
