/**
 * Plan d'appro & couverture de stock — moteur de projection mensuelle (pur, sans I/O).
 * ---------------------------------------------------------------------------
 * Utilisé par components/appro/PlanApproModal.tsx (écran Calcul de besoin).
 *
 * Pour chaque référence et chaque mois de l'horizon :
 *   base        = ventes du même mois l'an dernier (N-1 ; N-2 au-delà de 12 mois),
 *                 ou conso moyenne retenue (μ) selon le scénario,
 *                 + X % des ventes des références chaînées vers elle (chaînage total / partiel),
 *                 − la part de ses propres ventes reprise par une autre référence (elle est « source »)
 *   prévision   = base × coefficient du mois (hypothèse référence > hypothèse « toutes » > coef par défaut)
 *                 (mois en cours : au prorata des jours restants)
 *   ferme       = réservé SAGE daté du mois (lignes de BC en reliquat ; les dates passées tombent sur le mois en cours)
 *   demande     = max(prévision, ferme) — les besoins fermes sont compris dans la prévision
 *   entrées     = encours fournisseurs datés du mois (retards ramenés au mois en cours, « douteux » exclus)
 *                 + quantité du plan d'appro livrée ce mois
 *   stock fin   = stock fin du mois précédent + entrées − demande (départ : stock disponible SAGE du calcul de besoin)
 *   couverture  = stock fin (0 si négatif) / moyenne de la demande des 3 mois suivants (en mois)
 *   Un stock négatif est conservé d'un mois sur l'autre : il représente la demande non servie,
 *   que la livraison suivante rattrape (commandes clients en attente).
 *   valeur      = stock fin × prix d'achat unitaire
 */

export type Echeance = { d: string; q: number; fms: boolean; src?: string }

export type PlanArticle = {
  ref: string
  designation: string | null
  famille: string | null
  fournisseur: string | null
  colisage: number
  prix: number | null            // prix d'achat unitaire (tarif qté, sinon prix fournisseur)
  stockBase: number              // stock disponible SAGE (physique − préparations), périmètre du calcul de besoin
  mu: number                     // conso mensuelle retenue par le calcul de besoin
  perimetreGlobal: boolean       // true = tous dépôts ; false = dépôt FMS
  reserve: Echeance[]
  encours: Echeance[]
}

export type Chainage = { cible: string; source: string; pct: number; commentaire?: string | null }

export type ScenarioParams = {
  moisDebutAppro: string         // AAAA-MM-01
  moisFinAppro: string
  moisFinHorizon: string
  baseDemande: 'n1' | 'mu'
  coefDefaut: number             // 1 = 100 %
  couvertureCible: number        // mois
  inclureReserve: boolean
}

export type ContexteProjection = {
  aujourdhui: string             // AAAA-MM-JJ
  retardMaxJours: number         // encours dont la date est dépassée de plus de N j : exclu (douteux)
  /** conso mensuelle historique (écrêtage appliqué) : REF (majuscules) → mois → qté */
  conso: Map<string, Map<string, number>>
  chainages: Chainage[]
  /** hypothèses : clé `${REF|*}|${mois}` → coef (1 = 100 %) */
  hypotheses: Record<string, number>
  /** plan : clé `${REF}|${mois}` → qté */
  plan: Record<string, number>
  params: ScenarioParams
}

/** Détail d'une référence chaînée pour un mois : ventes de la source et part intégrée. */
export type ApportChainage = { source: string; qte: number; pct: number; apport: number }

export type MoisProjete = {
  mois: string
  histo: string                  // mois historique lu (N-1, ou N-2 au-delà de 12 mois) — base « n1 »
  propre: number                 // ventes propres de la référence sur le mois historique (ou μ), avant cession
  pctCede: number                // % de ses ventes reprises par d'autres références (elle est source)
  apports: ApportChainage[]      // références chaînées vers elle
  base: number
  coef: number
  prevision: number
  ferme: number
  demande: number
  encours: number
  plan: number
  entrees: number
  stockDebut: number
  stockFin: number
  demandeSuivante: number        // moyenne de la demande des 3 mois suivants (dénominateur de la couverture)
  couverture: number | null      // mois
  valeurStock: number | null
  valeurPlan: number | null
}

export type ProjectionArticle = {
  article: PlanArticle
  mois: MoisProjete[]
  stockMin: number
  moisStockMin: string | null
  premiereRupture: string | null
  totalPlan: number
  valeurPlan: number | null
  /** base de demande provenant d'autres références (chaînages entrants), sur l'horizon */
  repriseChainage: number
}

// ── Dates (mois = 'AAAA-MM-01') ────────────────────────────────────────────
export function cleMoisDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
export function moisDe(iso: string): string { return `${iso.slice(0, 7)}-01` }
export function ajouterMois(cle: string, n: number): string {
  const [y, m] = cle.split('-').map(Number)
  return cleMoisDate(new Date(y, m - 1 + n, 1))
}
export function listeMois(debut: string, fin: string): string[] {
  const out: string[] = []
  let c = moisDe(debut)
  const f = moisDe(fin)
  let garde = 0
  while (c <= f && garde < 240) { out.push(c); c = ajouterMois(c, 1); garde += 1 }
  return out
}
export function ecartMois(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}
function ajouterJours(iso: string, jours: number): string {
  const [y, m, j] = iso.split('-').map(Number)
  const d = new Date(y, m - 1, j); d.setDate(d.getDate() + jours)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Part restante du mois en cours (jour du jour compris). */
export function partRestanteMois(aujourdhui: string): number {
  const [y, m, j] = aujourdhui.split('-').map(Number)
  const nbJours = new Date(y, m, 0).getDate()
  return Math.max(0, Math.min(1, (nbJours - j + 1) / nbJours))
}

export const cleRef = (r: string) => r.trim().toUpperCase()
export const clePlan = (ref: string, mois: string) => `${cleRef(ref)}|${mois}`
export const cleHypo = (ref: string | '*', mois: string) => `${ref === '*' ? '*' : cleRef(ref)}|${mois}`

/** Mois historique de référence pour un mois futur : même mois N-1, ou N-2… tant que le mois n'est pas clos. */
export function moisHistorique(mois: string, moisCourant: string): string {
  let h = ajouterMois(mois, -12)
  let garde = 0
  while (h >= moisCourant && garde < 10) { h = ajouterMois(h, -12); garde += 1 }
  return h
}

/** Moyenne des 12 derniers mois clos d'une référence. */
export function mu12(conso: Map<string, Map<string, number>>, ref: string, moisCourant: string): number {
  const m = conso.get(cleRef(ref))
  if (!m) return 0
  let s = 0
  for (let i = 1; i <= 12; i += 1) s += m.get(ajouterMois(moisCourant, -i)) || 0
  return s / 12
}

function qteHisto(conso: Map<string, Map<string, number>>, ref: string, mois: string): number {
  return conso.get(cleRef(ref))?.get(mois) || 0
}

/** Base de demande d'une référence pour un mois (avant coefficient), chaînages appliqués. */
function baseMois(a: PlanArticle, mois: string, moisCourant: string, ctx: ContexteProjection): { base: number; reprise: number; histo: string; propre: number; pctCede: number; apports: ApportChainage[] } {
  const ref = cleRef(a.ref)
  const n1 = ctx.params.baseDemande === 'n1'
  const histo = moisHistorique(mois, moisCourant)
  const propre = n1 ? qteHisto(ctx.conso, ref, histo) : a.mu
  // part de ses propres ventes reprise par d'autres références (elle est source)
  const pctCede = Math.min(100, ctx.chainages.filter((c) => cleRef(c.source) === ref).reduce((s, c) => s + c.pct, 0))
  let reprise = 0
  const apports: ApportChainage[] = []
  ctx.chainages.filter((c) => cleRef(c.cible) === ref && c.source.trim()).forEach((c) => {
    const q = n1 ? qteHisto(ctx.conso, c.source, histo) : mu12(ctx.conso, c.source, moisCourant)
    const apport = q * c.pct / 100
    reprise += apport
    apports.push({ source: cleRef(c.source), qte: Math.round(q * 10) / 10, pct: c.pct, apport: Math.round(apport * 10) / 10 })
  })
  return { base: propre * (1 - pctCede / 100) + reprise, reprise, histo, propre: Math.round(propre * 10) / 10, pctCede, apports }
}

function coefMois(ref: string, mois: string, ctx: ContexteProjection): number {
  const r = ctx.hypotheses[cleHypo(ref, mois)]
  if (r !== undefined && Number.isFinite(r)) return r
  const t = ctx.hypotheses[cleHypo('*', mois)]
  if (t !== undefined && Number.isFinite(t)) return t
  return ctx.params.coefDefaut
}

const arr1 = (v: number) => Math.round(v * 10) / 10

/** Projection mensuelle d'une référence. `planOverride` remplace le plan du contexte pour cette référence. */
export function projeterArticle(a: PlanArticle, ctx: ContexteProjection, planOverride?: Record<string, number>): ProjectionArticle {
  const moisCourant = moisDe(ctx.aujourdhui)
  const horizon = listeMois(moisCourant, ctx.params.moisFinHorizon)
  const prorata = partRestanteMois(ctx.aujourdhui)
  const dansPerimetre = (e: Echeance) => a.perimetreGlobal || e.fms
  const dateDouteux = ajouterJours(ctx.aujourdhui, -ctx.retardMaxJours)

  const ferme = new Map<string, number>()
  if (ctx.params.inclureReserve) {
    ;(a.reserve || []).filter(dansPerimetre).forEach((e) => {
      const m = e.d < moisCourant ? moisCourant : moisDe(e.d)
      ferme.set(m, (ferme.get(m) || 0) + Number(e.q || 0))
    })
  }
  const encours = new Map<string, number>()
  ;(a.encours || []).filter(dansPerimetre).forEach((e) => {
    if (e.d < dateDouteux) return
    const m = e.d < moisCourant ? moisCourant : moisDe(e.d)
    encours.set(m, (encours.get(m) || 0) + Number(e.q || 0))
  })

  const plan = (mois: string) => {
    const k = clePlan(a.ref, mois)
    const v = planOverride ? planOverride[k] : ctx.plan[k]
    return v && v > 0 ? v : 0
  }

  let stock = a.stockBase
  let repriseTotale = 0
  const lignes: MoisProjete[] = horizon.map((mois, i) => {
    const { base, reprise, histo, propre, pctCede, apports } = baseMois(a, mois, moisCourant, ctx)
    repriseTotale += reprise
    const coef = coefMois(a.ref, mois, ctx)
    const facteur = i === 0 ? prorata : 1
    const prevision = arr1(base * coef * facteur)
    const f = ferme.get(mois) || 0
    // ferme au-delà de l'horizon : ignoré ; ferme du mois en cours : entièrement compté
    const demande = Math.max(prevision, f)
    const enc = encours.get(mois) || 0
    const p = plan(mois)
    const stockDebut = stock
    stock = arr1(stock + enc + p - demande)
    return {
      mois, histo, propre, pctCede, apports, base: arr1(base), coef, prevision, ferme: f, demande: arr1(demande), encours: enc, plan: p, entrees: enc + p,
      stockDebut, stockFin: stock, demandeSuivante: 0, couverture: null,
      valeurStock: a.prix === null ? null : Math.round(Math.max(0, stock) * a.prix),
      valeurPlan: a.prix === null ? null : Math.round(p * a.prix),
    }
  })
  remplirCouverture(lignes)

  let stockMin = a.stockBase, moisStockMin: string | null = null, premiereRupture: string | null = null
  lignes.forEach((l) => {
    if (l.stockFin < stockMin) { stockMin = l.stockFin; moisStockMin = l.mois }
    if (premiereRupture === null && l.stockFin < 0) premiereRupture = l.mois
  })
  const totalPlan = lignes.reduce((s, l) => s + l.plan, 0)
  return {
    article: a, mois: lignes, stockMin, moisStockMin, premiereRupture, totalPlan,
    valeurPlan: a.prix === null ? null : Math.round(totalPlan * a.prix), repriseChainage: arr1(repriseTotale),
  }
}

/** Couverture = stock fin / moyenne de la demande des 3 mois suivants (bornée à l'horizon ; dernier mois : sa propre demande). */
export function remplirCouverture(lignes: { stockFin: number; demande: number; demandeSuivante: number; couverture: number | null }[]) {
  lignes.forEach((l, i) => {
    const suiv = lignes.slice(i + 1, i + 4)
    const den = suiv.length ? suiv.reduce((s, x) => s + x.demande, 0) / suiv.length : l.demande
    l.demandeSuivante = den
    l.couverture = den > 0 ? Math.round(Math.max(0, l.stockFin) / den * 10) / 10 : null
  })
}

function arrondirColisage(q: number, colisage: number): number {
  const c = colisage > 1 ? colisage : 1
  return Math.max(0, Math.ceil(q / c - 1e-9) * c)
}

/**
 * Proposition de plan pour une référence : pour chaque mois de la fenêtre d'appro (dans l'ordre),
 * quantité à livrer pour que le stock de fin de mois atteigne la couverture cible
 * (cible × demande moyenne des 3 mois suivants), arrondie au colisage.
 * Les mois hors fenêtre ne reçoivent rien ; le plan existant hors fenêtre est conservé.
 */
export function proposerPlanArticle(a: PlanArticle, ctx: ContexteProjection, cible = ctx.params.couvertureCible): Record<string, number> {
  const fenetre = listeMois(ctx.params.moisDebutAppro, ctx.params.moisFinAppro).filter((m) => m >= moisDe(ctx.aujourdhui))
  const plan: Record<string, number> = {}
  Object.entries(ctx.plan).forEach(([k, v]) => { if (k.startsWith(`${cleRef(a.ref)}|`) && !fenetre.includes(k.split('|')[1])) plan[k] = v })
  fenetre.forEach((m) => {
    const proj = projeterArticle(a, ctx, plan)
    const l = proj.mois.find((x) => x.mois === m)
    if (!l) return
    const cibleStock = cible * l.demandeSuivante
    const besoin = cibleStock - l.stockFin
    const q = besoin > 0 ? arrondirColisage(besoin, a.colisage) : 0
    if (q > 0) plan[clePlan(a.ref, m)] = q
  })
  return plan
}

export type AgregatMois = {
  mois: string
  demande: number; prevision: number; ferme: number; encours: number; plan: number
  stockFin: number               // Σ stock fin positif (un manque sur une référence ne se compense pas par le stock d'une autre)
  manque: number                 // Σ stock fin négatif (en valeur absolue) : quantités non servies
  stockNet: number               // Σ stock fin brut
  couverture: number | null; valeurStock: number; valeurPlan: number
  nbRupture: number
}

/** Agrégat mensuel d'une sélection (couverture = Σ stock fin positif / Σ demande moyenne des 3 mois suivants). */
export function agreger(projections: ProjectionArticle[]): AgregatMois[] {
  if (!projections.length) return []
  return projections[0].mois.map((m0, i) => {
    let demande = 0, prevision = 0, ferme = 0, encours = 0, plan = 0, stockFin = 0, manque = 0, stockNet = 0, den = 0, valeurStock = 0, valeurPlan = 0, nbRupture = 0
    projections.forEach((p) => {
      const l = p.mois[i]
      if (!l) return
      demande += l.demande; prevision += l.prevision; ferme += l.ferme; encours += l.encours; plan += l.plan
      stockNet += l.stockFin
      if (l.stockFin >= 0) stockFin += l.stockFin; else manque -= l.stockFin
      den += l.demandeSuivante
      valeurStock += l.valeurStock || 0; valeurPlan += l.valeurPlan || 0
      if (l.stockFin < 0) nbRupture += 1
    })
    return {
      mois: m0.mois, demande: arr1(demande), prevision: arr1(prevision), ferme, encours, plan,
      stockFin: arr1(stockFin), manque: arr1(manque), stockNet: arr1(stockNet), couverture: den > 0 ? Math.round(stockFin / den * 10) / 10 : null,
      valeurStock, valeurPlan, nbRupture,
    }
  })
}
