// lib/retardsPaiement.ts
//
// Retards de paiement clients -- accès partagé (mobile, SMC, Vision Client,
// Vision ONE PAGE) au dernier instantané du fichier compta "Qui vous doit
// quoi" importé dans retards_paiement_clients (voir migration
// 20260910_retards_paiement_clients.sql et l'écran /retards-paiement pour
// l'import). Tout passe par les RPC get_retards_paiement_* et la vue
// v_retards_paiement_actuel -- aucun écran ne lit la table brute.

import { supabase } from '@/lib/supabaseClient'

export type TrancheRetardKey = 'retard_plus_45' | 'retard_30_45' | 'retard_15_30' | 'retard_0_15'

/** Tranches d'ancienneté du fichier, de la plus ancienne à la plus récente. */
export const TRANCHES_RETARD: Array<{ key: TrancheRetardKey; label: string; court: string }> = [
  { key: 'retard_plus_45', label: 'En retard de plus de 45 jours', court: '> 45 j' },
  { key: 'retard_30_45', label: 'En retard entre 30 et 45 jours', court: '30–45 j' },
  { key: 'retard_15_30', label: 'En retard entre 15 et 30 jours', court: '15–30 j' },
  { key: 'retard_0_15', label: 'En retard entre 0 et 15 jours', court: '0–15 j' },
]

export type RetardPaiementClient = {
  date_extraction: string
  numero_tiers: string
  nom_tiers: string
  profil: string
  en_litige: boolean
  code_litige: string
  intitule_litige: string
  promesses: string
  commercial_code: string
  delai_moyen_paiement: number | null
  niveau_relance: string
  effectue_le: string
  retard_plus_45: number
  retard_30_45: number
  retard_15_30: number
  retard_0_15: number
  total_en_retard: number
  total_a_venir: number
  total: number
  commentaires: string
  email_vide: boolean
  email_invalide: boolean
  collaborateur: string
  agence: string
}

export type RetardPaiementSynthese = {
  date_extraction: string | null
  nb_clients: number
  nb_litiges: number
  total_en_retard: number
  retard_plus_45: number
  retard_30_45: number
  retard_15_30: number
  retard_0_15: number
  total_a_venir: number
}

/** Périmètre agence / collaborateur -- listes vides ou absentes = pas de
 * restriction (même convention que MobileClients / useMobileAlertsCount). */
export type PerimetreRetards = { agences?: string[] | null; collaborateurs?: string[] | null } | null | undefined

function num(value: any): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
function texte(value: any): string {
  return String(value ?? '').trim()
}
function bool(value: any): boolean {
  if (value === true) return true
  const t = texte(value).toLowerCase()
  return ['oui', 'true', '1', 'yes', 'vrai'].includes(t)
}

export function normaliserRetardClient(row: Record<string, any>): RetardPaiementClient {
  return {
    date_extraction: texte(row.date_extraction),
    numero_tiers: texte(row.numero_tiers),
    nom_tiers: texte(row.nom_tiers),
    profil: texte(row.profil),
    en_litige: bool(row.en_litige),
    code_litige: texte(row.code_litige),
    intitule_litige: texte(row.intitule_litige),
    promesses: texte(row.promesses),
    commercial_code: texte(row.commercial_code),
    delai_moyen_paiement: row.delai_moyen_paiement === null || row.delai_moyen_paiement === undefined ? null : num(row.delai_moyen_paiement),
    niveau_relance: texte(row.niveau_relance),
    effectue_le: texte(row.effectue_le),
    retard_plus_45: num(row.retard_plus_45),
    retard_30_45: num(row.retard_30_45),
    retard_15_30: num(row.retard_15_30),
    retard_0_15: num(row.retard_0_15),
    total_en_retard: num(row.total_en_retard),
    total_a_venir: num(row.total_a_venir),
    total: num(row.total),
    commentaires: texte(row.commentaires),
    email_vide: bool(row.email_vide),
    email_invalide: bool(row.email_invalide),
    collaborateur: texte(row.collaborateur),
    agence: texte(row.agence),
  }
}

export function normaliserRetardSynthese(row: Record<string, any> | null | undefined): RetardPaiementSynthese {
  return {
    date_extraction: row?.date_extraction ? texte(row.date_extraction) : null,
    nb_clients: num(row?.nb_clients),
    nb_litiges: num(row?.nb_litiges),
    total_en_retard: num(row?.total_en_retard),
    retard_plus_45: num(row?.retard_plus_45),
    retard_30_45: num(row?.retard_30_45),
    retard_15_30: num(row?.retard_15_30),
    retard_0_15: num(row?.retard_0_15),
    total_a_venir: num(row?.total_a_venir),
  }
}

function perimetreArgs(perimetre: PerimetreRetards) {
  const agences = (perimetre?.agences || []).map(texte).filter(Boolean)
  const collaborateurs = (perimetre?.collaborateurs || []).map(texte).filter(Boolean)
  return {
    p_agences: agences.length ? agences : null,
    p_collaborateurs: collaborateurs.length ? collaborateurs : null,
  }
}

/** Synthèse (nb clients, totaux par tranche) sur le périmètre. Renvoie
 * date_extraction = null si aucun fichier n'a encore été importé. */
export async function fetchRetardsPaiementSynthese(perimetre?: PerimetreRetards): Promise<RetardPaiementSynthese> {
  const { data, error } = await supabase.rpc('get_retards_paiement_synthese', perimetreArgs(perimetre))
  if (error) throw new Error(`get_retards_paiement_synthese : ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return normaliserRetardSynthese(row)
}

/** Liste des clients en retard (> 0) sur le périmètre, triée par montant
 * en retard décroissant, toutes colonnes du fichier incluses. */
export async function fetchRetardsPaiementListe(perimetre?: PerimetreRetards): Promise<RetardPaiementClient[]> {
  const { data, error } = await supabase.rpc('get_retards_paiement_liste', perimetreArgs(perimetre))
  if (error) throw new Error(`get_retards_paiement_liste : ${error.message}`)
  return ((data || []) as Record<string, any>[]).map(normaliserRetardClient)
}

/** Fiche d'un client -- null si absent du dernier fichier (donc pas en retard). */
export async function fetchRetardsPaiementClient(numeroTiers: string): Promise<RetardPaiementClient | null> {
  const { data, error } = await supabase.rpc('get_retards_paiement_client', { p_numero_tiers: numeroTiers })
  if (error) throw new Error(`get_retards_paiement_client : ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return row ? normaliserRetardClient(row) : null
}

/** Tous les clients en retard du dernier instantané, indexés par numéro de
 * tiers normalisé (majuscules, sans espaces) -- pour le pictogramme et le
 * KPI de la Synthèse multi-clients, en une seule requête. */
export async function fetchRetardsPaiementBatch(): Promise<Map<string, RetardPaiementClient>> {
  const { data, error } = await supabase
    .from('v_retards_paiement_actuel')
    .select('*')
    .gt('total_en_retard', 0)
    .limit(5000)
  if (error) throw new Error(`v_retards_paiement_actuel : ${error.message}`)
  const map = new Map<string, RetardPaiementClient>()
  ;((data || []) as Record<string, any>[]).forEach((row) => {
    const r = normaliserRetardClient(row)
    map.set(cleTiers(r.numero_tiers), r)
  })
  return map
}

export function cleTiers(numero: string): string {
  return texte(numero).toUpperCase().replace(/\s+/g, '')
}

// ── Formats ───────────────────────────────────────────────────────────────

export function formatKEurRetard(value: number | null | undefined): string {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((value || 0) / 1000)} K€`
}

export function formatEurRetard(value: number | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0)
}

export function formatDateFrRetard(iso: string | null | undefined): string {
  const t = texte(iso)
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return t
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Tranche la plus ancienne dans laquelle le client a un montant > 0 --
 * "en retard de plus de 45 jours", etc. null si rien en retard. */
export function trancheLaPlusAncienne(r: Pick<RetardPaiementClient, TrancheRetardKey> | null | undefined) {
  if (!r) return null
  return TRANCHES_RETARD.find((t) => (r[t.key] || 0) > 0) || null
}

/** Champs libellé / valeur pour une fiche détail (modale desktop ou
 * feuille mobile) -- toutes les colonnes du fichier, dans son ordre. */
export function champsDetailRetard(r: RetardPaiementClient): Array<{ label: string; value: string }> {
  return [
    { label: 'Client', value: `${r.nom_tiers || '—'} (${r.numero_tiers})` },
    { label: 'Profil', value: r.profil || '—' },
    { label: 'En litige', value: r.en_litige ? 'Oui' : 'Non' },
    { label: 'Code de litige', value: r.code_litige || '—' },
    { label: 'Intitulé du litige', value: r.intitule_litige || '—' },
    { label: 'Promesses', value: r.promesses || '—' },
    { label: 'Commercial (compta)', value: r.commercial_code || '—' },
    { label: 'Délai moyen de paiement', value: r.delai_moyen_paiement === null ? '—' : `${r.delai_moyen_paiement} j` },
    { label: 'Niveau de relance', value: r.niveau_relance || '—' },
    { label: 'Dernière relance effectuée le', value: r.effectue_le ? formatDateFrRetard(r.effectue_le) : '—' },
    ...TRANCHES_RETARD.map((t) => ({ label: t.label, value: formatEurRetard(r[t.key]) })),
    { label: 'Total en retard', value: formatEurRetard(r.total_en_retard) },
    { label: 'Total à venir', value: formatEurRetard(r.total_a_venir) },
    { label: 'Total', value: formatEurRetard(r.total) },
    { label: 'Commentaires', value: r.commentaires || '—' },
    { label: 'Adresse email vide', value: r.email_vide ? 'Oui' : 'Non' },
    { label: 'Adresse email invalide', value: r.email_invalide ? 'Oui' : 'Non' },
    { label: 'Situation au', value: formatDateFrRetard(r.date_extraction) },
  ]
}
