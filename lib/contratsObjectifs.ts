// ============================================================================
// lib/contratsObjectifs.ts — Contrats d'objectifs individuels des commerciaux
// ----------------------------------------------------------------------------
// Créé le 03/11/2026 (demandé par Arnaud). Utilisé par app/objectifs/contrats.
//   - types des RPC get_obj_contrat / get_obj_contrats_liste ;
//   - calculs : trimestres, commission sur marge, avances, solde, primes à
//     paliers (réalisé et projection selon la répartition mensuelle du bilan) ;
//   - lecture du classeur Excel « un onglet par commercial » (ExcelJS, dans le
//     navigateur) : repérage par libellés, pas par cellules fixes, car la mise
//     en page varie d'un onglet à l'autre.
// Règles : marge PV ignorée pour l'instant ; réalisé = indicateur_factures_mensuel
// (hors statistique exclus) ; commission calculée sur les mois clos.
// ============================================================================

export type Section = 'ca_perso' | 'ca_agence' | 'qualitatif' | 'familles' | 'avenant' | 'avril_n1'
export type Indicateur = 'ca_perso' | 'ca_agence' | 'zero_impaye_45j' | 'cerfa_complet' | 'manuel' | 'evol_familles'
export type Resultat = 'a_evaluer' | 'atteint' | 'partiel' | 'non_atteint'
export type Echeance = '31/12' | 'avril_n1'

export type Palier = { seuil: number; montant: number }

export type Prime = {
  id?: string
  ordre?: number
  section: Section
  libelle: string
  description?: string | null
  mode: 'paliers' | 'forfait'
  indicateur: Indicateur
  paliers: Palier[]
  montant: number
  echeance: Echeance
  /** Primes « évolution du CA de familles » : macro-familles et/ou familles, base perso/agence, cible (0,20 = +20 %) */
  familles_macro?: string[]
  familles?: string[]
  base_ca?: 'perso' | 'agence'
  cible_evol?: number | null
  resultat?: Resultat
  montant_retenu?: number | null
  evalue_par?: string | null
  evalue_le?: string | null
  commentaire_evaluation?: string | null
}

export type Contrat = {
  id: string
  objectif_caht: number | null
  marge_n1: number | null
  taux_base: number
  taux_commission: number
  avance_mensuelle_saisie: number | null
  avance_mensuelle: number
  perimetre_objectif: 'perso' | 'agence'
  date_fin: string | null
  statut: 'brouillon' | 'valide' | 'signe'
  commentaire: string | null
  source_fichier: string | null
  source_onglet: string | null
  updated_at: string
  updated_by: string | null
}

export type Versement = {
  id: string
  mois: number
  nature: 'avance' | 'regularisation' | 'prime' | 'autre'
  montant: number
  date_versement: string | null
  commentaire: string | null
}

export type MoisRealise = { mois: number; ca: number; marge: number; ca_n1: number; marge_n1: number }

export type FicheContrat = {
  annee: number
  code: string
  nom: string
  agence: string | null
  mois_clos: number
  modifier: boolean
  contrat: Contrat | null
  primes: Prime[]
  versements: Versement[]
  mois: MoisRealise[]
  ca_agence: number | null
  ca_agence_n1: number | null
  impayes: { date: string | null; m45: number; n45: number }
  repartition: Array<{ mois: number; pct: number }>
  familles_resultats?: Record<string, { ca: number; ca_n1: number; mois: number }>
}

export type FamilleRef = { macro: string; familles: string[] }

export type LigneListe = {
  id: string
  code: string
  nom: string
  agence: string | null
  statut: string
  objectif_caht: number | null
  marge_n1: number | null
  taux_base: number
  taux_commission: number
  avance_mensuelle: number
  ca: number
  marge: number
  ca_n1_a_date: number
  perimetre_objectif: 'perso' | 'agence'
  ca_objectif: number
  ca_objectif_n1_a_date: number
  date_fin: string | null
  mois_fin: number
  mois_calc: number
  nb_primes: number
  nb_a_evaluer: number
  updated_at: string
}

export const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
export const TRIMESTRES = ['1er trimestre', '2ème trimestre', '3ème trimestre', '4ème trimestre']

export const SECTION_LIBELLES: Record<Section, string> = {
  ca_perso: 'Prime annuelle liée au CA HT perso',
  ca_agence: 'Prime annuelle agence',
  qualitatif: 'Prime annuelle qualitative',
  familles: 'Prime sur le développement de familles produits',
  avenant: 'Prime liée à la vente de produits (avenant)',
  avril_n1: 'Prime individuelle versée en avril N+1',
}

export const INDICATEUR_LIBELLES: Record<Indicateur, string> = {
  ca_perso: 'CA HT perso (automatique)',
  ca_agence: 'CA HT agence (automatique)',
  zero_impaye_45j: 'Zéro impayé > 45 j (automatique)',
  cerfa_complet: 'Cerfa complet (évalué par la direction)',
  manuel: 'Évaluée par la direction',
  evol_familles: 'Évolution du CA de familles vs N-1 (automatique)',
}

export function fmtEvol(v: number | null | undefined, d = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`
}

export function libelleFamilles(p: Prime) {
  const l = [...(p.familles_macro || []), ...(p.familles || [])]
  return l.length ? l.join(', ') : 'aucune famille choisie'
}

export const RESULTAT_LIBELLES: Record<Resultat, string> = {
  a_evaluer: 'À évaluer',
  atteint: 'Atteint',
  partiel: 'Partiel',
  non_atteint: 'Non atteint',
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmt0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : nf0.format(v))
export const fmt2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : nf2.format(v))
export const fmtE = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${nf0.format(v)} €`)
export const fmtK = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${nf0.format(v / 1000)} k€`)
export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`

// ---------------------------------------------------------------------------
// Calculs
// ---------------------------------------------------------------------------
/** CA servant à mesurer l'objectif CA HT : CA perso (mois clos) ou CA de l'agence (mois clos). */
export function caObjectif(f: FicheContrat, calc: CalculContrat) {
  const agence = f.contrat?.perimetre_objectif === 'agence'
  const realise = agence ? f.ca_agence ?? 0 : calc.caTotal
  const projection = calc.part > 0 ? realise / calc.part : null
  return { agence, realise, projection, libelle: agence ? `CA HT agence ${f.agence || ''}`.trim() : 'CA HT perso' }
}

export function avanceTheorique(margeN1: number | null | undefined, tauxBase: number, tauxCommission: number) {
  return Math.round((margeN1 || 0) * tauxBase * tauxCommission)
}

/** Dernier mois de calcul du contrat pour l'année : 12 sans date de fin, mois de la date de fin (inclus), 0 si antérieure. */
export function moisFinContrat(dateFin: string | null | undefined, annee: number) {
  if (!dateFin) return 12
  const d = new Date(dateFin)
  if (Number.isNaN(d.getTime())) return 12
  if (d.getFullYear() > annee) return 12
  if (d.getFullYear() < annee) return 0
  return d.getMonth() + 1
}

/** Part écoulée (0..1) de la période du contrat (janvier → mois de fin), d'après la répartition mensuelle du bilan ; à défaut linéaire. */
export function partAnnee(repartition: Array<{ mois: number; pct: number }>, moisClos: number, moisFin = 12) {
  const fin = Math.max(0, Math.min(12, moisFin))
  const clos = Math.min(moisClos, fin)
  if (clos <= 0 || fin <= 0) return 0
  if (clos >= fin) return 1
  const somme = (n: number) => repartition.filter((r) => r.mois <= n).reduce((s, r) => s + Number(r.pct || 0), 0)
  if (repartition.length >= 12 && somme(fin) > 0) return somme(clos) / somme(fin)
  return clos / fin
}

export type LigneMois = {
  mois: number
  ca: number | null
  marge: number | null
  clos: boolean
  enCours: boolean
  horsContrat: boolean
  avance: number
  avanceVersee: boolean // true = versement saisi ou mois passé ; false = prévu
}

export type LigneTrimestre = {
  t: number
  ca: number
  marge: number
  commission: number
  avances: number
  complet: boolean
  mois: LigneMois[]
}

export type CalculContrat = {
  trimestres: LigneTrimestre[]
  caTotal: number
  margeTotal: number
  tauxMarge: number | null
  commissionAcquise: number
  avancesADate: number
  avancesAnnee: number
  autresVersements: number
  soldeADate: number
  part: number
  caProjete: number | null
  commissionProjetee: number | null
  soldeProjete: number | null
  avance: number
  moisFin: number
  moisCalc: number
}

export function calculerContrat(f: FicheContrat): CalculContrat {
  const c = f.contrat
  const tauxCom = c?.taux_commission ?? 0.01
  const avance = c ? c.avance_mensuelle : 0
  const moisFin = moisFinContrat(c?.date_fin, f.annee)
  const moisCalc = Math.min(f.mois_clos, moisFin)
  const versParMois = new Map<number, number>()
  let autres = 0
  for (const v of f.versements || []) {
    if (v.nature === 'avance') versParMois.set(v.mois, (versParMois.get(v.mois) || 0) + Number(v.montant || 0))
    else autres += Number(v.montant || 0)
  }
  const moisMap = new Map(f.mois.map((m) => [m.mois, m]))
  const trimestres: LigneTrimestre[] = []
  let caTotal = 0
  let margeTotal = 0
  let avancesADate = 0
  let avancesAnnee = 0
  for (let t = 0; t < 4; t++) {
    const lignes: LigneMois[] = []
    let ca = 0
    let marge = 0
    let avances = 0
    for (let k = 1; k <= 3; k++) {
      const m = t * 3 + k
      const r = moisMap.get(m)
      const horsContrat = m > moisFin
      const clos = m <= moisCalc
      const enCours = !horsContrat && m === f.mois_clos + 1 && f.annee === new Date().getFullYear()
      const a = versParMois.has(m) ? versParMois.get(m)! : horsContrat ? 0 : avance
      lignes.push({
        mois: m,
        ca: clos ? r?.ca ?? 0 : enCours ? r?.ca ?? null : null,
        marge: clos ? r?.marge ?? 0 : enCours ? r?.marge ?? null : null,
        clos,
        enCours,
        horsContrat,
        avance: a,
        avanceVersee: versParMois.has(m) || clos,
      })
      if (clos) {
        ca += r?.ca || 0
        marge += r?.marge || 0
        avancesADate += a
      }
      avances += a
      avancesAnnee += a
    }
    caTotal += ca
    margeTotal += marge
    trimestres.push({ t: t + 1, ca, marge, commission: round2(marge * tauxCom), avances, complet: (t + 1) * 3 <= moisCalc || t * 3 + 1 > moisFin, mois: lignes })
  }
  const commissionAcquise = round2(margeTotal * tauxCom)
  const part = partAnnee(f.repartition, f.mois_clos, moisFin)
  const caProjete = part > 0 ? caTotal / part : null
  const commissionProjetee = part > 0 ? commissionAcquise / part : null
  return {
    trimestres,
    caTotal,
    margeTotal,
    tauxMarge: caTotal ? margeTotal / caTotal : null,
    commissionAcquise,
    avancesADate,
    avancesAnnee,
    autresVersements: autres,
    soldeADate: commissionAcquise - avancesADate,
    part,
    caProjete,
    commissionProjetee,
    soldeProjete: commissionProjetee == null ? null : commissionProjetee - avancesAnnee,
    avance,
    moisFin,
    moisCalc,
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100
}

export type EtatPrime = {
  valeur: number | null // indicateur mesuré (CA à date, impayés…)
  projection: number | null
  montantADate: number // prime acquise à date selon l'indicateur
  montantProjete: number // prime probable en fin d'année
  montantMax: number
  statut: 'vert' | 'orange' | 'rouge' | 'gris'
  texte: string
  evaluee: boolean
}

export function montantMax(p: Prime) {
  if (p.mode === 'paliers') return Math.max(0, ...(p.paliers || []).map((x) => Number(x.montant || 0)))
  return Number(p.montant || 0)
}

function palierAtteint(paliers: Palier[], v: number | null) {
  if (v == null) return 0
  let best = 0
  for (const x of paliers || []) if (v >= Number(x.seuil || 0)) best = Math.max(best, Number(x.montant || 0))
  return best
}

export function etatPrime(p: Prime, f: FicheContrat, calc: CalculContrat): EtatPrime {
  const max = montantMax(p)
  const evaluee = !!p.resultat && p.resultat !== 'a_evaluer'
  const retenu = evaluee ? Number(p.montant_retenu ?? (p.resultat === 'atteint' ? max : 0)) : null

  let valeur: number | null = null
  let projection: number | null = null
  let aDate = 0
  let projete = 0
  let statut: EtatPrime['statut'] = 'gris'
  let texte = ''

  if (p.indicateur === 'ca_perso' || p.indicateur === 'ca_agence') {
    valeur = p.indicateur === 'ca_perso' ? calc.caTotal : f.ca_agence
    projection = valeur != null && calc.part > 0 ? valeur / calc.part : null
    if (p.mode === 'paliers') {
      aDate = palierAtteint(p.paliers, valeur)
      projete = palierAtteint(p.paliers, projection)
      const seuilMin = Math.min(...(p.paliers || []).map((x) => Number(x.seuil || 0)))
      statut = aDate >= max && max > 0 ? 'vert' : projete > 0 ? 'orange' : 'rouge'
      texte = `${fmtK(valeur)} à date · projection ${fmtK(projection)}${
        Number.isFinite(seuilMin) && valeur != null && valeur < seuilMin ? ` · reste ${fmtK(seuilMin - valeur)} pour le 1er palier` : ''
      }`
    } else {
      aDate = projete = max
      statut = 'vert'
    }
  } else if (p.indicateur === 'evol_familles') {
    const r = p.id ? f.familles_resultats?.[p.id] : undefined
    const evol = r && r.ca_n1 > 0 ? r.ca / r.ca_n1 - 1 : null
    valeur = evol
    projection = evol
    const base = p.base_ca === 'agence' ? `CA agence ${f.agence || ''}`.trim() : 'CA perso'
    if (!r) {
      statut = 'gris'
      texte = 'Choisir les familles concernées (modifier le contrat)'
    } else if (p.mode === 'paliers') {
      aDate = projete = evol == null ? 0 : palierAtteint(p.paliers, evol)
      statut = aDate >= max && max > 0 ? 'vert' : aDate > 0 ? 'orange' : 'rouge'
    } else {
      const cible = Number(p.cible_evol ?? 0)
      const ok = evol != null && evol >= cible
      aDate = projete = ok ? max : 0
      statut = ok ? 'vert' : 'rouge'
    }
    if (r) {
      texte = `${base} ${libelleFamilles(p)} : ${fmtK(r.ca)} vs ${fmtK(r.ca_n1)} en N-1 (janv. → ${MOIS[r.mois]?.toLowerCase() || '—'}) · ${
        evol == null ? 'pas de CA N-1' : fmtEvol(evol)
      }${p.mode === 'forfait' ? ` · cible ${fmtEvol(Number(p.cible_evol ?? 0), 0)}` : ''}`
    }
  } else if (p.indicateur === 'zero_impaye_45j') {
    valeur = f.impayes?.m45 ?? null
    const ok = (valeur || 0) <= 0
    aDate = projete = ok ? max : 0
    statut = ok ? 'vert' : 'rouge'
    texte = f.impayes?.date
      ? ok
        ? `Aucun impayé > 45 j au ${new Date(f.impayes.date).toLocaleDateString('fr-FR')}`
        : `${fmtE(valeur)} > 45 j sur ${f.impayes.n45} client(s) au ${new Date(f.impayes.date).toLocaleDateString('fr-FR')}`
      : 'Pas d’instantané des retards de paiement'
  } else {
    statut = 'gris'
    texte = 'Évaluée par la direction'
    projete = max
  }

  if (evaluee) {
    aDate = projete = retenu || 0
    statut = p.resultat === 'atteint' ? 'vert' : p.resultat === 'partiel' ? 'orange' : 'rouge'
  }
  return { valeur, projection, montantADate: aDate, montantProjete: projete, montantMax: max, statut, texte, evaluee }
}

// ---------------------------------------------------------------------------
// Lecture du classeur Excel
// ---------------------------------------------------------------------------
export type OngletLu = {
  onglet: string
  objectif_caht: number | null
  perimetre_objectif: 'perso' | 'agence'
  marge_n1: number | null
  annee_marge_n1: number | null
  taux_base: number | null
  taux_commission: number | null
  avance_excel: number | null
  mois: Array<{ mois: number; ca: number | null; marge: number | null }>
  primes: Prime[]
  avertissements: string[]
  collaborateur_code?: string | null
  appariement?: string | null
}

type Cellule = { r: number; c: number; t: string; n: number | null }

const MOIS_NORM = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

export function norm(s: string) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Nombre au format français : « 2.600.000€ », « 3 000 000 € », « 1 500 € », « 806 068 », « 0,2949 ». */
export function parseNombreFr(s: string): number | null {
  if (!s) return null
  let x = String(s).replace(/[  ]/g, ' ').replace(/€/g, '').trim()
  if (!/\d/.test(x) || /[a-zA-Z]{2,}/.test(x.replace(/k€?|m€?/gi, ''))) return null
  const neg = /^-/.test(x)
  x = x.replace(/[^\d.,]/g, '')
  if (!x) return null
  if (/,\d{1,2}$/.test(x) || /,\d+$/.test(x)) {
    x = x.replace(/[.\s]/g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(x)) {
    x = x.replace(/\./g, '')
  } else {
    x = x.replace(/,/g, '')
  }
  const v = Number(x)
  return Number.isFinite(v) ? (neg ? -v : v) : null
}

/** Seuil d'un palier : « CA 2.000k€ », « CA 2 900 k€ », « CA 8 000 k€ », « CA 2,5 M€ ». */
export function parseSeuil(label: string): number | null {
  const t = label.replace(/[  ]/g, ' ')
  const m = t.match(/(\d[\d\s.,]*)\s*(k|m)?\s*€?/i)
  if (!m) return null
  const raw = m[1].trim()
  let v: number
  if (/,\d+$/.test(raw)) v = Number(raw.replace(/[\s.]/g, '').replace(',', '.'))
  else v = Number(raw.replace(/[\s.,]/g, ''))
  if (!Number.isFinite(v)) return null
  const unit = (m[2] || '').toLowerCase()
  if (unit === 'k') v *= 1000
  else if (unit === 'm') v *= 1_000_000
  return v
}

function valeurCellule(v: unknown): { t: string; n: number | null } {
  if (v == null) return { t: '', n: null }
  if (typeof v === 'number') return { t: String(v), n: v }
  if (typeof v === 'string') return { t: v, n: parseNombreFr(v) }
  if (v instanceof Date) return { t: v.toISOString(), n: null }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return valeurCellule(o.result)
    if ('richText' in o && Array.isArray(o.richText)) {
      const t = (o.richText as Array<{ text: string }>).map((x) => x.text).join('')
      return { t, n: parseNombreFr(t) }
    }
    if ('text' in o) return valeurCellule(o.text)
    if ('error' in o) return { t: '', n: null }
  }
  return { t: String(v), n: null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lireOnglet(ws: any): OngletLu {
  const cells: Cellule[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow({ includeEmpty: false }, (row: any, r: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell({ includeEmpty: false }, (cell: any, c: number) => {
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return
      const { t, n } = valeurCellule(cell.value)
      if (t.trim() === '' && n == null) return
      cells.push({ r, c, t: t.trim(), n })
    })
  })
  const parRang = new Map<number, Cellule[]>()
  for (const x of cells) {
    if (!parRang.has(x.r)) parRang.set(x.r, [])
    parRang.get(x.r)!.push(x)
  }
  for (const l of parRang.values()) l.sort((a, b) => a.c - b.c)
  const rangs = [...parRang.keys()].sort((a, b) => a - b)

  const trouver = (re: RegExp, apres = 0) => cells.find((x) => x.r > apres && re.test(norm(x.t)))
  const nombreADroite = (x: Cellule | undefined, maxCols = 8) => {
    if (!x) return null
    const own = x.t.split(':').slice(1).join(':')
    const ownN = own ? parseNombreFr(own) : null
    if (ownN != null && ownN > 0) return ownN
    const l = parRang.get(x.r) || []
    const y = l.find((z) => z.c > x.c && z.c <= x.c + maxCols && z.n != null && !/%/.test(z.t))
    return y?.n ?? null
  }
  const nombreDessous = (x: Cellule | undefined) => {
    if (!x) return null
    for (const r of rangs.filter((k) => k > x.r).slice(0, 2)) {
      const y = (parRang.get(r) || []).find((z) => Math.abs(z.c - x.c) <= 0 && z.n != null)
      if (y) return y.n
    }
    return null
  }
  const avert: string[] = []

  // Paramètres
  const cObj = trouver(/^objectif\s*ca\s*ht?\b|^objectif\s*caht/)
  const objectif = nombreADroite(cObj)
  if (objectif == null) avert.push('Objectif CA HT introuvable')

  const cMarge = trouver(/^marge\s*20\d\d/)
  const marge = nombreADroite(cMarge)
  const anneeMarge = cMarge ? Number((norm(cMarge.t).match(/20\d\d/) || [])[0]) || null : null
  if (marge == null) avert.push('Marge N-1 introuvable')

  const cBase = trouver(/avance mensuelle\s*\d+([.,]\d+)?\s*%/)
  const tauxBase = cBase ? Number(norm(cBase.t).match(/avance mensuelle\s*(\d+(?:[.,]\d+)?)/)![1].replace(',', '.')) / 100 : null

  const cAv = cells.find((x) => /^avance\s*\d+([.,]\d+)?\s*%$/.test(norm(x.t)))
  const tauxCom = cAv ? Number(norm(cAv.t).match(/(\d+(?:[.,]\d+)?)/)![1].replace(',', '.')) / 100 : null
  const avanceExcel = nombreDessous(cAv)

  // Mois
  const mois: OngletLu['mois'] = []
  MOIS_NORM.forEach((mn, i) => {
    const cm = cells.find((x) => norm(x.t) === mn)
    if (!cm) {
      mois.push({ mois: i + 1, ca: null, marge: null })
      return
    }
    const l = (parRang.get(cm.r) || []).filter((z) => z.c > cm.c)
    const nums: Array<number | null> = []
    for (const z of l) {
      if (nums.length >= 2) break
      if (z.n != null) nums.push(z.n)
      else if (/^-+$/.test(z.t)) nums.push(null)
    }
    mois.push({ mois: i + 1, ca: nums[0] ?? null, marge: nums[1] ?? null })
  })

  // Primes : sous la ligne « TOTAL GENERAL », colonnes de gauche
  const cTot = trouver(/^total general/)
  const debut = cTot ? cTot.r : 0
  const primes: Prime[] = []
  let titreSection = ''
  let sousTitre = ''
  let avril = false
  let avenant = false
  let paliersCourants: Prime | null = null
  const colMaxLabel = cTot ? cTot.c + 1 : 3

  const fermerPaliers = () => {
    paliersCourants = null
  }

  for (const r of rangs.filter((k) => k > debut)) {
    const l = parRang.get(r) || []
    const lab = l.find((z) => z.c <= colMaxLabel && z.t && z.n == null)
    if (!lab) continue
    const n = norm(lab.t)
    const montantCell = l.find((z) => z.c > lab.c && z.c <= lab.c + 2 && z.n != null)
    const montant = montantCell?.n ?? null

    if (/^\d+\s*prime/.test(n)) {
      fermerPaliers()
      titreSection = lab.t.replace(/^\d+\s*/, '').trim()
      sousTitre = ''
      avenant = /produit/.test(n)
      avril = /avril/.test(n)
      continue
    }
    if (/^prime individuelle versee en avril/.test(n) || /versee en avril/.test(n)) {
      fermerPaliers()
      titreSection = lab.t.trim()
      sousTitre = ''
      avril = true
      avenant = false
      continue
    }
    if (/^-\s*/.test(lab.t)) {
      fermerPaliers()
      sousTitre = lab.t.replace(/^-\s*/, '').trim()
      avril = false
      continue
    }
    if (/^prime annuelle$/.test(n)) continue
    if (/^objectif\s*[\d.]/.test(n)) {
      if (!sousTitre) sousTitre = lab.t.trim()
      else sousTitre = `${sousTitre} (${lab.t.trim()})`
      continue
    }
    if (/^ca\s*\d/.test(n) && montant != null) {
      const seuil = parseSeuil(lab.t.replace(/^ca\s*/i, ''))
      const agence = /agence/.test(norm(sousTitre))
      if (!paliersCourants) {
        paliersCourants = {
          section: agence ? 'ca_agence' : 'ca_perso',
          libelle: sousTitre || (agence ? 'Prime annuelle agence' : 'Prime annuelle liée au CA HT'),
          description: null,
          mode: 'paliers',
          indicateur: agence ? 'ca_agence' : 'ca_perso',
          paliers: [],
          montant: 0,
          echeance: 'avril_n1',
        }
        primes.push(paliersCourants)
      }
      ;(paliersCourants as Prime).paliers.push({ seuil: seuil ?? 0, montant })
      if (seuil == null) avert.push(`Seuil illisible : « ${lab.t} »`)
      continue
    }
    if (/impaye/.test(n)) {
      fermerPaliers()
      primes.push({ section: 'avril_n1', libelle: lab.t.replace(/\s*:\s*$/, '').trim(), mode: 'forfait', indicateur: 'zero_impaye_45j', paliers: [], montant: montant ?? 0, echeance: 'avril_n1' })
      continue
    }
    if (/cerfa/.test(n)) {
      fermerPaliers()
      primes.push({ section: 'avril_n1', libelle: lab.t.replace(/\s*:\s*$/, '').trim(), mode: 'forfait', indicateur: 'cerfa_complet', paliers: [], montant: montant ?? 0, echeance: 'avril_n1' })
      continue
    }
    if (avenant || /avenant/.test(n)) {
      fermerPaliers()
      primes.push({
        section: 'avenant',
        libelle: titreSection || 'Prime liée à la vente de produits',
        description: lab.t.trim(),
        mode: 'forfait',
        indicateur: 'manuel',
        paliers: [],
        montant: montant ?? 0,
        echeance: 'avril_n1',
      })
      continue
    }
    if (montant != null) {
      fermerPaliers()
      primes.push({
        section: avril ? 'avril_n1' : 'qualitatif',
        libelle: sousTitre || titreSection || 'Prime qualitative',
        description: lab.t.trim(),
        mode: 'forfait',
        indicateur: 'manuel',
        paliers: [],
        montant,
        echeance: 'avril_n1',
      })
      continue
    }
    // Libellé sans montant : description d'une ligne voisine, on l'ignore
  }

  primes.forEach((p, i) => {
    p.ordre = i + 1
    p.paliers.sort((a, b) => a.seuil - b.seuil)
  })
  if (primes.length === 0) avert.push('Aucune prime annuelle repérée')

  return {
    onglet: ws.name,
    objectif_caht: objectif,
    perimetre_objectif: cObj && /agence/.test(norm(cObj.t)) ? 'agence' : 'perso',
    marge_n1: marge,
    annee_marge_n1: anneeMarge,
    taux_base: tauxBase,
    taux_commission: tauxCom,
    avance_excel: avanceExcel,
    mois,
    primes,
    avertissements: avert,
  }
}

export async function lireClasseur(file: File): Promise<OngletLu[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const res: OngletLu[] = []
  wb.eachSheet((ws) => {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') return
    const lu = lireOnglet(ws)
    // Onglet sans objectif ni mois renseignés = onglet technique, ignoré
    if (lu.objectif_caht == null && lu.mois.every((m) => m.ca == null)) return
    res.push(lu)
  })
  return res
}

export type CollabRef = {
  code: string
  nom: string
  agence: string | null
  sommeil: boolean
  ca: Record<string, number>
  marge: Record<string, number>
}

/** Rapproche un onglet d'un collaborateur : CA mensuels identiques (au centime près) puis nom de l'onglet. */
export function apparier(o: OngletLu, refs: CollabRef[]): { code: string | null; methode: string | null } {
  let best: { code: string; score: number } | null = null
  for (const r of refs) {
    let score = 0
    for (const m of o.mois) {
      if (m.ca == null || !m.ca) continue
      const v = r.ca[String(m.mois)]
      if (v != null && Math.abs(v - m.ca) < 1) score++
    }
    if (score > 0 && (!best || score > best.score)) best = { code: r.code, score }
  }
  if (best && best.score >= 2) return { code: best.code, methode: `CA identique sur ${best.score} mois` }
  const on = norm(o.onglet).replace(/[^a-z0-9 ]/g, ' ')
  const mots = on.split(' ').filter((w) => w.length >= 3)
  const cand = refs.filter((r) => {
    const rn = norm(r.nom)
    const rc = norm(r.code)
    return on.includes(rc) || mots.some((w) => rn.split(' ').includes(w) || rc.includes(w))
  })
  if (cand.length === 1) return { code: cand[0].code, methode: 'Nom de l’onglet' }
  if (cand.length > 1) {
    const actifs = cand.filter((c) => !c.sommeil)
    if (actifs.length === 1) return { code: actifs[0].code, methode: 'Nom de l’onglet' }
  }
  return { code: null, methode: null }
}
