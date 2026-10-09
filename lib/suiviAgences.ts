// ============================================================================
// lib/suiviAgences.ts — calculs de l'écran « Suivi agences / commerciaux »
// ----------------------------------------------------------------------------
// Créé le 09/10/2026. Les RPC (20261009_suivi_agences_commerciaux.sql) renvoient
// des lignes mensuelles agrégées (collaborateur × agence × famille macro × mois
// sur N-2, N-1, N) ; tout le reste (filtres, périodes, évolutions, croix de
// positionnement) est calculé ici, dans le navigateur, pour que les filtres
// réagissent instantanément.
//
// Conventions :
//   - index d'année 0 = N-2, 1 = N-1, 2 = N ; mois 1..12 ;
//   - « à date » = janvier → dernier mois clos (moisClos) ; toute comparaison
//     N / N-1 se fait sur les mêmes mois ;
//   - croix de positionnement, pour chaque trimestre clos q :
//       X = évolution du CA cumulé à fin q vs N-1 (« ça va » / « ça va pas ») ;
//       Y = tendance = évolution du trimestre q vs N-1 − évolution cumulée à
//           fin q-1 (pour T1 : évolution de l'année N-1 vs N-2)
//           (« ça va mieux » / « ça se dégrade »).
// ============================================================================

export type DataRow = {
  code: string
  agence: string
  famille: string
  annee: number
  mois: number
  ca: number
  marge: number
}

export type RefRow = { famille: string; annee: number; mois: number; ca: number; marge: number }

export type Collaborateur = {
  code: string
  nom: string
  agence: string
  sommeil: boolean
  fonction: string | null
}

export type Objectif = {
  perimetre_type: 'entreprise' | 'agence' | 'commercial'
  perimetre_ref: string | null
  type_objectif: string
  famille_macro: string | null
  valeur_cible: number
}

export type Commercial = { email: string; display_name: string; agence_objectif: string; code: string | null }

/** Série mensuelle : [annéeIdx][mois] (mois 0 inutilisé). */
export type Serie = { ca: number[][]; mg: number[][] }

export type Entity = {
  key: string
  kind: 'agence' | 'collaborateur' | 'entreprise'
  id: string
  label: string
  agence: string
  sommeil?: boolean
  codes: string[]
}

export type Position = { q: number; x: number; y: number }

export const FAMILLES_LIBELLES: Record<string, string> = {
  ACC: 'Accessoires',
  DIV: 'Divers',
  DRV: 'DRV',
  ECS: 'ECS',
  PV: 'PV',
  R_ZONE: 'R zone',
  'R/O': 'R/O',
  'R/R': 'R/R',
  SAV: 'SAV',
  TECH: 'Tech',
}

export const MOIS_COURTS = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
export const MOIS_LONGS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export function emptySerie(): Serie {
  const make = () => [0, 1, 2].map(() => new Array(13).fill(0))
  return { ca: make(), mg: make() }
}

export function addToSerie(serie: Serie, yearIdx: number, mois: number, ca: number, mg: number) {
  if (yearIdx < 0 || yearIdx > 2 || mois < 1 || mois > 12) return
  serie.ca[yearIdx][mois] += ca
  serie.mg[yearIdx][mois] += mg
}

export function sumMonths(values: number[], from: number, to: number) {
  let total = 0
  for (let m = Math.max(1, from); m <= Math.min(12, to); m += 1) total += values[m] || 0
  return total
}

export function evolPct(n: number, n1: number): number | null {
  if (!n1 || !Number.isFinite(n1) || n1 <= 0) return null
  return ((n - n1) / n1) * 100
}

export function tauxMarge(mg: number, ca: number): number | null {
  if (!ca || ca <= 0) return null
  return (mg / ca) * 100
}

export function normAgence(value: string | null | undefined) {
  return String(value || '').toUpperCase().replace(/[\s'’-]+/g, '')
}

// ----------------------------------------------------------------------------
// Périodes
// ----------------------------------------------------------------------------
export type Periode = { key: string; label: string; from: number; to: number }

export function periodesDetail(): Periode[] {
  return [
    { key: 'S1', label: '1er semestre', from: 1, to: 6 },
    { key: 'S2', label: '2nd semestre', from: 7, to: 12 },
    { key: 'T1', label: 'T1', from: 1, to: 3 },
    { key: 'T2', label: 'T2', from: 4, to: 6 },
    { key: 'T3', label: 'T3', from: 7, to: 9 },
    { key: 'T4', label: 'T4', from: 10, to: 12 },
  ]
}

/** Mois comparables d'une période pour l'année N (limités au dernier mois clos). */
export function moisComparables(periode: { from: number; to: number }, moisClos: number) {
  const to = Math.min(periode.to, moisClos)
  return { from: periode.from, to, complet: to === periode.to, vide: to < periode.from }
}

export type PeriodeValeurs = {
  n2: number
  n1: number
  n: number
  evolN1: number | null
  evolN: number | null
  mgN2: number
  mgN1: number
  mgN: number
}

export function valeursPeriode(serie: Serie, from: number, to: number): PeriodeValeurs {
  const n2 = sumMonths(serie.ca[0], from, to)
  const n1 = sumMonths(serie.ca[1], from, to)
  const n = sumMonths(serie.ca[2], from, to)
  return {
    n2,
    n1,
    n,
    evolN1: evolPct(n1, n2),
    evolN: evolPct(n, n1),
    mgN2: sumMonths(serie.mg[0], from, to),
    mgN1: sumMonths(serie.mg[1], from, to),
    mgN: sumMonths(serie.mg[2], from, to),
  }
}

// ----------------------------------------------------------------------------
// Croix de positionnement
// ----------------------------------------------------------------------------
export function positionsTrimestrielles(serie: Serie, moisClos: number): Position[] {
  const positions: Position[] = []
  const nbTrim = Math.floor(Math.max(0, moisClos) / 3)
  let previousCumul = evolPct(sumMonths(serie.ca[1], 1, 12), sumMonths(serie.ca[0], 1, 12))
  for (let q = 1; q <= Math.min(4, nbTrim); q += 1) {
    const cumul = evolPct(sumMonths(serie.ca[2], 1, q * 3), sumMonths(serie.ca[1], 1, q * 3))
    const trim = evolPct(sumMonths(serie.ca[2], q * 3 - 2, q * 3), sumMonths(serie.ca[1], q * 3 - 2, q * 3))
    if (cumul !== null && trim !== null) {
      const y = previousCumul === null ? 0 : trim - previousCumul
      positions.push({ q, x: cumul, y })
    }
    previousCumul = cumul
  }
  return positions
}

export type Quadrant = 'va_mieux' | 'va_degrade' | 'va_pas_mieux' | 'va_pas_degrade'

export function quadrantOf(position: Position | undefined): Quadrant | null {
  if (!position) return null
  if (position.x >= 0) return position.y >= 0 ? 'va_mieux' : 'va_degrade'
  return position.y >= 0 ? 'va_pas_mieux' : 'va_pas_degrade'
}

export const QUADRANT_LIBELLES: Record<Quadrant, { label: string; tone: string; bg: string }> = {
  va_mieux: { label: 'Ça va · mieux', tone: '#1F6B3A', bg: '#E5F2E8' },
  va_degrade: { label: 'Ça va · se dégrade', tone: '#8A5A11', bg: '#FBF1DC' },
  va_pas_mieux: { label: 'Ça va pas · mieux', tone: '#2C5C8A', bg: '#E4EEF7' },
  va_pas_degrade: { label: 'Ça va pas · se dégrade', tone: '#A32C2C', bg: '#FBE6E3' },
}

// ----------------------------------------------------------------------------
// Formatage
// ----------------------------------------------------------------------------
const euroFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const intFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

export function fmtEuro(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return euroFmt.format(value)
}

export function fmtK(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€`
  if (Math.abs(value) >= 1_000) return `${intFmt.format(Math.round(value / 1000))} k€`
  return `${intFmt.format(Math.round(value))} €`
}

export function fmtInt(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return intFmt.format(value)
}

export function fmtPct(value: number | null | undefined, digits = 1, signed = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`
}

export function fmtPts(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} pt`
}

export function toneOf(value: number | null | undefined, neutral = 0.5) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-slate-400'
  if (value > neutral) return 'text-[#1F6B3A]'
  if (value < -neutral) return 'text-[#A32C2C]'
  return 'text-slate-600'
}

// ----------------------------------------------------------------------------
// Parsing RPC
// ----------------------------------------------------------------------------
export function parseDataRows(raw: unknown): DataRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => ({
    code: String(r[0] || ''),
    agence: String(r[1] || 'NON AFFECTE'),
    famille: String(r[2] || '(sans famille)'),
    annee: Number(r[3]),
    mois: Number(r[4]),
    ca: Number(r[5]) || 0,
    marge: Number(r[6]) || 0,
  }))
}

export function parseRefRows(raw: unknown): RefRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => ({
    famille: String(r[0] || '(sans famille)'),
    annee: Number(r[1]),
    mois: Number(r[2]),
    ca: Number(r[3]) || 0,
    marge: Number(r[4]) || 0,
  }))
}

// ----------------------------------------------------------------------------
// Objectifs applicables à une entité
// ----------------------------------------------------------------------------
export type ObjectifsEntite = {
  /** Objectifs du périmètre lui-même. */
  propres: Objectif[]
  /** Familles à afficher et provenance de la cible. */
  familles: Array<{ famille: string; source: 'propre' | 'agence' | 'entreprise'; objectifs: Objectif[] }>
}

export function objectifsPourEntite(
  entity: Entity,
  objectifs: Objectif[],
  commerciaux: Commercial[]
): ObjectifsEntite {
  const entreprise = objectifs.filter((o) => o.perimetre_type === 'entreprise')
  const agenceKey = normAgence(entity.agence)
  const agence = objectifs.filter((o) => o.perimetre_type === 'agence' && normAgence(o.perimetre_ref) === agenceKey)

  let propres: Objectif[] = []
  if (entity.kind === 'entreprise') propres = entreprise
  else if (entity.kind === 'agence') propres = agence
  else {
    const emails = commerciaux
      .filter((c) => (c.code || '').toUpperCase() === entity.id.toUpperCase())
      .map((c) => c.email.toLowerCase())
    propres = objectifs.filter(
      (o) => o.perimetre_type === 'commercial' && emails.includes(String(o.perimetre_ref || '').toLowerCase())
    )
  }

  const sources: Array<{ source: 'propre' | 'agence' | 'entreprise'; list: Objectif[] }> = [
    { source: 'propre', list: propres },
  ]
  if (entity.kind === 'collaborateur') sources.push({ source: 'agence', list: agence })
  if (entity.kind !== 'entreprise') sources.push({ source: 'entreprise', list: entreprise })

  const familles: ObjectifsEntite['familles'] = []
  const seen = new Set<string>()
  sources.forEach(({ source, list }) => {
    list
      .filter((o) => o.famille_macro)
      .forEach((o) => {
        const fam = String(o.famille_macro)
        if (seen.has(fam)) {
          const entry = familles.find((f) => f.famille === fam)
          if (entry && entry.source === source) entry.objectifs.push(o)
          return
        }
        seen.add(fam)
        familles.push({ famille: fam, source, objectifs: [o] })
      })
  })

  return { propres, familles }
}
