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
//   - croix de positionnement, pour chaque trimestre clos q (règle revue par
//     Arnaud le 11/10/2026) :
//       X = évolution du CA cumulé à fin q vs N-1 (« ça va » / « ça va pas ») ;
//       Y = évolution du trimestre q vs le même trimestre N-1
//           (« ça va mieux » / « ça se dégrade ») ;
//       couleur = dynamique : évolution du trimestre q comparée à la moyenne
//           des évolutions des trimestres précédents de l'année (T1 : comparé
//           au T4 de N-1 vs N-2) ; écart ≥ +5 pt = accélération,
//           ≤ −5 pt = ralentissement (ex. +30 %, +28 % puis +2 % : toujours
//           positif vs N-1 mais en ralentissement), sinon stable ;
//   - CA : lignes d'articles « hors statistique » exclues (côté SQL).
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
  /** 'collaborateur' (15/10/2026) : objectif d'un collaborateur sans compte dans l'outil, perimetre_ref = code SAGE. */
  perimetre_type: 'entreprise' | 'agence' | 'commercial' | 'collaborateur'
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

export type Dynamique = 'acceleration' | 'stable' | 'ralentissement'

export type Position = {
  q: number
  /** Évolution du CA cumulé à fin de trimestre vs N-1 (%). */
  x: number
  /** Évolution du trimestre vs le même trimestre N-1 (%). */
  y: number
  /** Évolution du trimestre − moyenne des trimestres précédents de l'année (T1 : T4 N-1) (pt). */
  ecartTendance: number | null
  dynamique: Dynamique | null
}

/** Écart (en points) au-delà duquel on parle d'accélération / ralentissement. */
export const SEUIL_DYNAMIQUE = 5

export const DYNAMIQUE_LIBELLES: Record<Dynamique, { label: string; court: string; fill: string; stroke: string; tone: string; bg: string }> = {
  acceleration: { label: 'En accélération', court: '↗ accélère', fill: '#4FA36B', stroke: '#1F6B3A', tone: '#1F6B3A', bg: '#E5F2E8' },
  stable: { label: 'Rythme stable', court: '→ stable', fill: '#6F94D6', stroke: '#2F5DA8', tone: '#2C5C8A', bg: '#E4EEF7' },
  ralentissement: { label: 'En ralentissement', court: '↘ ralentit', fill: '#E39A3B', stroke: '#A8640F', tone: '#8A5A11', bg: '#FBF1DC' },
}

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
  const evolTrim = (yearIdx: number, q: number) =>
    evolPct(sumMonths(serie.ca[yearIdx], q * 3 - 2, q * 3), sumMonths(serie.ca[yearIdx - 1], q * 3 - 2, q * 3))
  // Référence de T1 = T4 de N-1 (vs N-2) ; ensuite, trimestres de N déjà passés.
  const t4N1 = evolTrim(1, 4)
  const historique: Array<number | null> = []

  const positions: Position[] = []
  const nbTrim = Math.floor(Math.max(0, moisClos) / 3)
  for (let q = 1; q <= Math.min(4, nbTrim); q += 1) {
    const cumul = evolPct(sumMonths(serie.ca[2], 1, q * 3), sumMonths(serie.ca[1], 1, q * 3))
    const trim = evolTrim(2, q)
    const precedents = (q === 1 ? [t4N1] : historique).filter((v): v is number => v !== null)
    historique.push(trim)
    if (cumul === null || trim === null) continue
    const moyenne = precedents.length ? precedents.reduce((a, b) => a + b, 0) / precedents.length : null
    const ecart = moyenne === null ? null : trim - moyenne
    const dynamique: Dynamique | null =
      ecart === null ? null : ecart >= SEUIL_DYNAMIQUE ? 'acceleration' : ecart <= -SEUIL_DYNAMIQUE ? 'ralentissement' : 'stable'
    positions.push({ q, x: cumul, y: trim, ecartTendance: ecart, dynamique })
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
  /** Objectif « Zéro impayé > 45 j » applicable (propre, sinon agence, sinon entreprise). */
  zeroImpaye: { objectif: Objectif; source: 'propre' | 'agence' | 'entreprise' } | null
  /** Agence à un seul commercial : objectifs repris de l'autre périmètre (inclus dans propres). */
  herites: Objectif[]
  /** Libellé de l'origine des objectifs repris (ex. « agence BRIVE »). */
  heritesDe: string | null
}

const objKey = (o: Objectif) => `${o.type_objectif}|${o.famille_macro || ''}`

/** Complète `base` avec les objectifs de `autre` absents de `base` (même type et famille). */
function completer(base: Objectif[], autre: Objectif[]) {
  const keys = new Set(base.map(objKey))
  return autre.filter((o) => !keys.has(objKey(o)))
}

export function objectifsPourEntite(
  entity: Entity,
  objectifs: Objectif[],
  commerciaux: Commercial[],
  /** Agence (fiche collaborateur) d'un code SAGE : sert à compter les collaborateurs
   * sans compte qui ont un objectif propre dans une agence (règle « un seul commercial »). */
  agenceDeCode?: (code: string) => string | undefined
): ObjectifsEntite {
  const entreprise = objectifs.filter((o) => o.perimetre_type === 'entreprise')
  const agenceKey = normAgence(entity.agence)
  const agence = objectifs.filter((o) => o.perimetre_type === 'agence' && normAgence(o.perimetre_ref) === agenceKey)

  // Objectifs fixés au code SAGE (collaborateurs sans compte, Bilan commercial 2026).
  const objectifsCode = (code: string) =>
    objectifs.filter((o) => o.perimetre_type === 'collaborateur' && String(o.perimetre_ref || '').toUpperCase() === code.toUpperCase())
  const codesObjectifDansAgence = (key: string) => {
    if (!agenceDeCode) return 0
    const codesComptes = new Set(commerciaux.map((c) => (c.code || '').toUpperCase()).filter(Boolean))
    const codes = new Set(
      objectifs
        .filter((o) => o.perimetre_type === 'collaborateur' && o.perimetre_ref)
        .map((o) => String(o.perimetre_ref).toUpperCase())
        .filter((code) => !codesComptes.has(code) && normAgence(agenceDeCode(code)) === key)
    )
    return codes.size
  }

  // Règle du 12/10/2026 : agence à un seul commercial soumis à objectif → les
  // objectifs de l'agence valent pour le commercial (et inversement), un objectif
  // fixé en propre restant prioritaire.
  const objectifsCommercial = (email: string) =>
    objectifs.filter((o) => o.perimetre_type === 'commercial' && String(o.perimetre_ref || '').toLowerCase() === email.toLowerCase())

  let propres: Objectif[] = []
  let herites: Objectif[] = []
  let heritesDe: string | null = null
  if (entity.kind === 'entreprise') propres = entreprise
  else if (entity.kind === 'agence') {
    propres = agence
    const seuls = commerciaux.filter((c) => normAgence(c.agence_objectif) === agenceKey)
    if (seuls.length === 1 && codesObjectifDansAgence(agenceKey) === 0) {
      herites = completer(propres, objectifsCommercial(seuls[0].email))
      if (herites.length) heritesDe = `commercial ${seuls[0].display_name || seuls[0].email}`
      propres = [...propres, ...herites]
    }
  } else {
    const fiches = commerciaux.filter((c) => (c.code || '').toUpperCase() === entity.id.toUpperCase())
    propres = fiches.flatMap((c) => objectifsCommercial(c.email))
    // Objectifs au code SAGE : complètent ceux du compte (le compte reste prioritaire).
    propres = [...propres, ...completer(propres, objectifsCode(entity.id))]
    const agenceCommerciale = fiches.find((c) => c.agence_objectif)?.agence_objectif || entity.agence
    const keyCo = normAgence(agenceCommerciale)
    const nbCommerciaux = commerciaux.filter((c) => normAgence(c.agence_objectif) === keyCo).length + codesObjectifDansAgence(keyCo)
    if (fiches.length > 0 && nbCommerciaux === 1) {
      const objAgence = objectifs.filter((o) => o.perimetre_type === 'agence' && normAgence(o.perimetre_ref) === keyCo)
      herites = completer(propres, objAgence)
      if (herites.length) heritesDe = `agence ${agenceCommerciale}`
      propres = [...propres, ...herites]
    }
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

  let zeroImpaye: ObjectifsEntite['zeroImpaye'] = null
  for (const { source, list } of sources) {
    const found = list.find((o) => o.type_objectif === 'zero_impaye_45j')
    if (found) {
      zeroImpaye = { objectif: found, source }
      break
    }
  }

  return { propres, familles, zeroImpaye, herites, heritesDe }
}

// ----------------------------------------------------------------------------
// Objectif « Zéro impayé > 45 jours » (ajout du 11/10/2026)
// Les primes de l'année N sont payées en avril N+1 : l'objectif est atteint si,
// à l'instantané d'avril N+1 de l'export « Qui vous doit quoi », aucune facture
// n'est échue depuis plus de 45 jours. Avant cette date : situation à date
// (provisoire). RPC get_suivi_impayes (20261011_objectif_zero_impaye.sql).
// ----------------------------------------------------------------------------
export type ImpayeClient = { numero: string; nom: string; m45: number; m30_45: number; litige: boolean; relance: string | null }

export type ImpayeRow = {
  code: string
  m45_courant: number
  n45_courant: number
  m30_45_courant: number
  m45_verdict: number | null
  n45_verdict: number
  clients_courant: ImpayeClient[]
}

export type ImpayesData = {
  annee: number
  date_courante: string | null
  date_verdict: string | null
  date_evaluation: string
  definitif: boolean
  rows: ImpayeRow[]
}

export type ImpayesEntite = {
  dateCourante: string | null
  dateVerdict: string | null
  dateEvaluation: string
  definitif: boolean
  m45Courant: number
  n45Courant: number
  m3045Courant: number
  m45Verdict: number | null
  n45Verdict: number
  clients: ImpayeClient[]
}

export function parseImpayes(raw: unknown): ImpayesData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  return {
    annee: Number(r.annee),
    date_courante: r.date_courante ? String(r.date_courante) : null,
    date_verdict: r.date_verdict ? String(r.date_verdict) : null,
    date_evaluation: String(r.date_evaluation || ''),
    definitif: !!r.definitif,
    rows: ((r.rows || []) as any[]).map((x) => ({
      code: String(x.code || '').toUpperCase(),
      m45_courant: Number(x.m45_courant) || 0,
      n45_courant: Number(x.n45_courant) || 0,
      m30_45_courant: Number(x.m30_45_courant) || 0,
      m45_verdict: x.m45_verdict === null || x.m45_verdict === undefined ? null : Number(x.m45_verdict),
      n45_verdict: Number(x.n45_verdict) || 0,
      clients_courant: ((x.clients_courant || []) as any[]).map((c) => ({
        numero: String(c.numero || ''),
        nom: String(c.nom || c.numero || ''),
        m45: Number(c.m45) || 0,
        m30_45: Number(c.m30_45) || 0,
        litige: !!c.litige,
        relance: c.relance ? String(c.relance) : null,
      })),
    })),
  }
}

/** Impayés d'une entité ; codes = null pour l'entreprise (tous collaborateurs). */
export function impayesPourCodes(data: ImpayesData | null, codes: string[] | null): ImpayesEntite | null {
  if (!data) return null
  const set = codes ? new Set(codes.map((c) => c.toUpperCase())) : null
  const rows = data.rows.filter((r) => !set || set.has(r.code))
  const verdictRows = rows.filter((r) => r.m45_verdict !== null)
  return {
    dateCourante: data.date_courante,
    dateVerdict: data.date_verdict,
    dateEvaluation: data.date_evaluation,
    definitif: data.definitif,
    m45Courant: rows.reduce((s, r) => s + r.m45_courant, 0),
    n45Courant: rows.reduce((s, r) => s + r.n45_courant, 0),
    m3045Courant: rows.reduce((s, r) => s + r.m30_45_courant, 0),
    m45Verdict: data.definitif ? verdictRows.reduce((s, r) => s + (r.m45_verdict || 0), 0) : null,
    n45Verdict: rows.reduce((s, r) => s + r.n45_verdict, 0),
    clients: rows.flatMap((r) => r.clients_courant).sort((a, b) => b.m45 - a.m45),
  }
}

export function fmtDateCourte(iso: string | null | undefined) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// ----------------------------------------------------------------------------
// Objectif à date (15/10/2026, Bilan commercial 2026)
// L'objectif annuel est réparti par mois selon la saisonnalité du bilan
// (ligne « % » de la feuille BUDGET, issue de l'année passée) :
// objectif à date = objectif annuel × cumul des % des mois clos.
// À défaut de répartition saisie pour l'année : prorata 1/12 par mois.
// ----------------------------------------------------------------------------
/** Pourcentages mensuels, index 1..12 (0 inutilisé) ; null = pas de répartition. */
export type Repartition = number[] | null

export function parseRepartition(raw: unknown): Repartition {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = new Array(13).fill(0)
  raw.forEach((r: any) => {
    const m = Number(r?.mois)
    if (m >= 1 && m <= 12) out[m] = Number(r?.pct) || 0
  })
  return out.slice(1).some((v) => v > 0) ? out : null
}

/** Part (0..1) de l'objectif annuel attendue à fin du mois `moisClos`. */
export function partObjectifADate(rep: Repartition, moisClos: number): number {
  if (moisClos <= 0) return 0
  if (!rep) return Math.min(12, moisClos) / 12
  const total = rep.slice(1).reduce((a, b) => a + b, 0)
  if (total <= 0) return Math.min(12, moisClos) / 12
  return rep.slice(1, Math.min(12, moisClos) + 1).reduce((a, b) => a + b, 0) / total
}

/** Part (0..1) de l'objectif annuel du mois m. */
export function partObjectifMois(rep: Repartition, m: number): number {
  if (!rep) return 1 / 12
  const total = rep.slice(1).reduce((a, b) => a + b, 0)
  return total > 0 ? (rep[m] || 0) / total : 1 / 12
}

// ----------------------------------------------------------------------------
// Créations de comptes clients (15/10/2026, Bilan commercial 2026)
// RPC get_suivi_creations_comptes : chiffres du bilan (cumuls annuels jusqu'à
// N-1, détail mensuel en N), complétés au-delà du dernier mois du bilan par les
// fiches clients SAGE (ref_tiers.date_creation × représentant).
// mois 0 = cumul annuel sans détail mensuel.
// ----------------------------------------------------------------------------
export type CreationRow = { code: string; agence: string; annee: number; mois: number; nb: number; source: 'bilan' | 'sage' }
export type CreationsData = { rows: CreationRow[]; moisBilan: Record<number, number | null> }

export function parseCreations(raw: unknown): CreationsData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  const rows: CreationRow[] = ((r.rows || []) as any[]).map((x) => ({
    code: String(x[0] || '').toUpperCase(),
    agence: String(x[1] || 'NON AFFECTE'),
    annee: Number(x[2]),
    mois: Number(x[3]),
    nb: Number(x[4]) || 0,
    source: x[5] === 'sage' ? 'sage' : 'bilan',
  }))
  const moisBilan: Record<number, number | null> = {}
  ;((r.couverture || []) as any[]).forEach((c) => {
    moisBilan[Number(c.annee)] = c.mois_bilan === null || c.mois_bilan === undefined ? null : Number(c.mois_bilan)
  })
  return { rows, moisBilan }
}

export type CreationsEntite = {
  /** Comptes créés en N, à date (tous les mois disponibles). */
  n: number
  /** Détail mensuel N (index 1..12). */
  parMois: number[]
  /** Comptes créés sur l'année N-1 complète. */
  n1: number
  /** N-1 ramené à la même part de l'année (prorata calendaire) : base de comparaison. */
  n1Prorata: number
  /** Une partie de N vient des fiches SAGE (au-delà du dernier mois du bilan). */
  avecSage: boolean
}

export function creationsPour(
  data: CreationsData | null,
  filtre: (row: CreationRow) => boolean,
  annee: number,
  partAnnee: number
): CreationsEntite | null {
  if (!data) return null
  const parMois = new Array(13).fill(0)
  let n = 0
  let n1 = 0
  let avecSage = false
  data.rows.forEach((r) => {
    if (!filtre(r)) return
    if (r.annee === annee) {
      n += r.nb
      if (r.mois >= 1) parMois[r.mois] += r.nb
      if (r.source === 'sage') avecSage = true
    } else if (r.annee === annee - 1) n1 += r.nb
  })
  return { n, parMois, n1, n1Prorata: n1 * partAnnee, avecSage }
}

/** Part calendaire écoulée de l'année (1 pour une année passée). */
export function partAnneeEcoulee(annee: number, now: Date = new Date()): number {
  const y = now.getFullYear()
  if (annee < y) return 1
  if (annee > y) return 0
  const debut = new Date(y, 0, 1).getTime()
  const fin = new Date(y + 1, 0, 1).getTime()
  return Math.min(1, Math.max(0, (now.getTime() - debut) / (fin - debut)))
}
