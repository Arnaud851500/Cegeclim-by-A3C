// Parcours d'un dossier d'aides CEE (16/10/2026) — éléments partagés entre la
// fiche dossier, la création de dossier et le relecteur de pièces.
//
// Référentiels en base (migration 20261016_cee_parcours_drapo.sql) :
//   * cee_etapes   : 6 étapes DRAPO (drapo_1 … drapo_6), les anciennes étapes
//                    sont inactives ;
//   * cee_statuts  : 16 statuts CEGECLIM (s00 … s15) + sorties devis_ko /
//                    prime_rejetee ;
//   * cee_champs   : caractéristiques du dossier, origine (saisie / pièce /
//                    SAGE / statut / calcul) et pièces qui les portent ;
//   * cee_dossier_valeurs : valeur de chaque caractéristique par source.
// RPC : cee_maj_champs, cee_get_coherence, cee_accepter_ecart,
//       cee_activer_statut, cee_sync_sage.

import { supabase } from '@/lib/supabaseClient'

export type EtapeDrapo = {
  code: string
  ordre: number
  libelle: string
  description: string
  acteur: string
  delai_cible_jours: number | null
  actif: boolean
}

export type StatutCee = {
  code: string
  numero: number | null
  libelle: string
  etape_code: string | null
  nature: 'normal' | 'boucle' | 'exception' | 'sortie'
  ordre: number
  champ_date: string | null
  documents: string | null
  infos_crm: string | null
  actions: string | null
  outils: string | null
  suivi_admin: string | null
  suivants: string[]
  controles_requis: string[]
  actif: boolean
}

export type ChampType = 'text' | 'number' | 'integer' | 'date' | 'bool' | 'enum'
export type ChampOrigine = 'saisie' | 'piece' | 'sage' | 'statut' | 'calcul'

export type ChampCee = {
  code: string
  libelle: string
  groupe: string
  type: ChampType
  options: string[]
  origine: ChampOrigine
  ouverture: boolean
  obligatoire_ouverture: boolean
  sources: string[]
  aide: string | null
  ordre: number
}

export type ValeurSource = {
  dossier_id: string
  champ_code: string
  source: string
  valeur: string | null
  controle_id: string | null
  releve_le: string
  releve_par: string | null
}

export type EcartCoherence = {
  champ: string
  libelle: string
  groupe: string
  sources: Array<{ source: string; valeur: string | null; releve_le: string; controle_id: string | null }>
  signature: string
  accepte: boolean
  accepte_commentaire: string | null
  accepte_par: string | null
  accepte_le: string | null
  avant_travaux: boolean
  apres_travaux: boolean
}

export type RegleCoherence = {
  code: string
  libelle: string
  bloque_vers: string | null
  statut: 'ok' | 'ko' | 'na'
  detail: string
}

export type DernierControle = { id: string; passage: number; verdict: string; controle_le: string; controle_par: string | null }

export type Coherence = {
  ecarts: EcartCoherence[]
  regles: RegleCoherence[]
  controles: Record<string, DernierControle>
  premium: boolean
}

export type TypePieceControle = 'avis_imposition' | 'note_dimensionnement' | 'devis' | 'facture' | 'cadre_contribution'

export const TYPES_PIECE_CONTROLE: Array<{ id: TypePieceControle; label: string; code: string }> = [
  { id: 'cadre_contribution', label: 'Cadre de contribution', code: 'CC' },
  { id: 'avis_imposition', label: "Avis d'imposition", code: 'AVIS' },
  { id: 'note_dimensionnement', label: 'Note de dimensionnement', code: 'NOTE' },
  { id: 'devis', label: 'Devis', code: 'DEVIS' },
  { id: 'facture', label: 'Facture', code: 'FACT' },
]

export const SOURCE_LABEL: Record<string, string> = {
  saisie: 'Saisie',
  avis_imposition: "Avis d'imposition",
  note_dimensionnement: 'Note de dim.',
  devis: 'Devis',
  facture: 'Facture',
  cadre_contribution: 'Cadre de contribution',
  sage: 'SAGE',
}

export const ORIGINE_LABEL: Record<ChampOrigine, string> = {
  saisie: 'Saisie à l’ouverture',
  piece: 'Lu sur les pièces',
  sage: 'SAGE',
  statut: 'Date d’effet du statut',
  calcul: 'Calculé',
}

export const ORIGINE_STYLE: Record<ChampOrigine, { bg: string; fg: string }> = {
  saisie: { bg: '#F1ECF8', fg: '#5E4390' },
  piece: { bg: '#EEF5FA', fg: '#2E5E80' },
  sage: { bg: '#EAF3E8', fg: '#2E6B3E' },
  statut: { bg: '#FDF1DE', fg: '#93600F' },
  calcul: { bg: '#EFEDE8', fg: '#44494E' },
}

export const GROUPES_ORDRE = [
  'Acteurs et contacts',
  'Logement et ménage',
  'Installation et aides',
  'Dates des pièces',
  'Suivi DRAPO',
  'Suivi admin CEGECLIM',
]

export const VERDICT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  conforme: { bg: '#EAF3E8', fg: '#2E6B3E', label: 'Conforme' },
  non_conforme: { bg: '#FBE9E9', fg: '#A32C2C', label: 'Non conforme' },
  incomplet: { bg: '#FDF1DE', fg: '#93600F', label: 'Incomplet' },
}

export const NATURE_STYLE: Record<StatutCee['nature'], { bg: string; fg: string; border: string }> = {
  normal: { bg: '#FFFFFF', fg: '#1E2833', border: '#D8D3C8' },
  boucle: { bg: '#FDF1DE', fg: '#7A4F0C', border: '#EFC98A' },
  exception: { bg: '#FBE9E9', fg: '#8E2A2A', border: '#E7B7A6' },
  sortie: { bg: '#EFEDE8', fg: '#44494E', border: '#D8D3C8' },
}

export function libelleStatut(s: StatutCee | undefined | null): string {
  if (!s) return '—'
  return s.numero !== null && s.numero !== undefined ? `${s.numero} · ${s.libelle}` : s.libelle
}

export async function chargerReferentiels(): Promise<{ etapes: EtapeDrapo[]; statuts: StatutCee[]; champs: ChampCee[] }> {
  const [{ data: e }, { data: s }, { data: c }] = await Promise.all([
    supabase.from('cee_etapes').select('*').eq('actif', true).order('ordre', { ascending: true }),
    supabase.from('cee_statuts').select('*').eq('actif', true).order('ordre', { ascending: true }),
    supabase.from('cee_champs').select('*').order('ordre', { ascending: true }),
  ])
  return {
    etapes: (e || []) as EtapeDrapo[],
    statuts: ((s || []) as StatutCee[]).map((x) => ({ ...x, suivants: x.suivants || [], controles_requis: x.controles_requis || [] })),
    champs: ((c || []) as ChampCee[]).map((x) => ({ ...x, options: x.options || [], sources: x.sources || [] })),
  }
}

// --- Valeurs ---------------------------------------------------------------

export function valeurEnTexte(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

export function formatDateFr(v: string | null | undefined): string {
  if (!v) return '—'
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return v
}

export function formatDateHeure(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function afficherValeur(champ: Pick<ChampCee, 'type'>, v: unknown): string {
  const s = valeurEnTexte(v).trim()
  if (!s) return '—'
  if (champ.type === 'bool') {
    const b = versBool(s)
    return b === null ? s : b ? 'Oui' : 'Non'
  }
  if (champ.type === 'date') return formatDateFr(versDateIso(s) || s)
  if (champ.type === 'number' || champ.type === 'integer') {
    const n = versNombre(s)
    return n === null ? s : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  }
  return s
}

export function versNombre(s: string): number | null {
  const t = s.replace(/[\s  ]/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  if (!t || t === '.' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function versDateIso(s: string): string | null {
  const t = s.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const fr = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(t)
  if (fr) {
    const y = fr[3].length === 2 ? `20${fr[3]}` : fr[3]
    return `${y}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  }
  return null
}

export function versBool(s: string): boolean | null {
  const t = s.trim().toLowerCase()
  if (['true', 'oui', 'o', 'yes', 'y', '1', 'vrai', 'x'].includes(t)) return true
  if (['false', 'non', 'n', 'no', '0', 'faux'].includes(t)) return false
  return null
}

const MOTS_IGNORES = new Set(['mme', 'monsieur', 'madame', 'mlle', 'les', 'des', 'rue', 'avenue', 'allee', 'chemin', 'route', 'bis', 'lieu', 'dit'])

function jetons(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && (/^\d+$/.test(t) || t.length > 2) && !MOTS_IGNORES.has(t))
  )
}

// Même règle que la fonction SQL cee_valeurs_egales : sert à signaler un écart
// dans l'écran avant l'enregistrement (la décision finale reste côté base).
export function valeursEgales(type: ChampType, a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return true
  if (type === 'number' || type === 'integer') {
    const na = versNombre(a)
    const nb = versNombre(b)
    if (na === null || nb === null) return a.trim().toLowerCase() === b.trim().toLowerCase()
    return Math.abs(na - nb) < 0.01
  }
  if (type === 'date') {
    const da = versDateIso(a)
    const db = versDateIso(b)
    if (!da || !db) return a.trim().toLowerCase() === b.trim().toLowerCase()
    return da === db
  }
  if (type === 'bool') return versBool(a) === versBool(b)
  const ja = jetons(a)
  const jb = jetons(b)
  if (!ja.size || !jb.size) return a.trim().toLowerCase() === b.trim().toLowerCase()
  const inclus = (x: Set<string>, y: Set<string>) => Array.from(x).every((t) => y.has(t))
  return inclus(ja, jb) || inclus(jb, ja)
}

export function aujourdhuiIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
