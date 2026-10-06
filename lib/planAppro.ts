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
 *   demande     = max(prévision, ferme) — colonne « Demande » : les besoins fermes sont compris dans la prévision
 *   entrées     = encours fournisseurs à leur date (retards ramenés à aujourd'hui, « douteux » exclus)
 *                 + livraison du plan d'appro du mois, reçue le jour de livraison paramétré (1er, 15 ou dernier jour)
 *   stock fin   = stock fin du mois précédent + entrées − demande (départ : stock disponible SAGE du calcul de besoin)
 *
 * Convention de couverture (06/10/2026) — mesurée en FIN de mois :
 *   couverture(M) = nombre de mois que le stock du dernier jour de M (après toutes les sorties et toutes les
 *   entrées de M) permet de servir, en consommant mois par mois la demande retenue des mois suivants
 *   (M+1, M+2, … ; un mois partiellement couvert compte pour sa fraction ; au-delà de l'horizon, demande
 *   moyenne des 3 derniers mois de l'horizon). Ex. 3,0 fin mars = le stock au 31/03 couvre avril, mai et juin
 *   tels que prévus, saisonnalité comprise.
 *   point bas(M) = stock le plus bas atteint pendant M, la demande du mois étant répartie uniformément sur ses
 *   jours et chaque entrée arrivant à sa date : révèle une rupture en cours de mois que le stock de fin de mois masque
 *   (livraison en fin de mois, par exemple).
 *   consigne(M) = couverture visée en fin de mois (référence > groupe/scénario > valeur par défaut) ;
 *   stock cible(M) = demande retenue cumulée des mois suivants sur consigne(M) mois.
 *
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
  prix: number | null            // prix d'achat unitaire
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
  couvertureCible: number        // consigne par défaut, en mois (fin de mois)
  inclureReserve: boolean
  jourLivraison: number          // jour de réception de la livraison mensuelle du plan : 1, 15… ; 31 = dernier jour du mois
}

export type ContexteProjection = {
  aujourdhui: string             // AAAA-MM-JJ
  retardMaxJours: number         // encours dont la date est dépassée de plus de N j : exclu (douteux)
  /** conso mensuelle historique (écrêtage appliqué) : REF (majuscules) → mois → qté */
  conso: Map<string, Map<string, number>>
  chainages: Chainage[]
  /** hypothèses : clé `${REF|*}|${mois}` → coef (1 = 100 %) */
  hypotheses: Record<string, number>
  /** consignes de couverture fin de mois : clé `${REF|*}|${mois}` → mois */
  consignes: Record<string, number>
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
  pointBas: number               // stock le plus bas pendant le mois (demande répartie sur les jours, entrées datées)
  jourPointBas: number           // jour du mois où il est atteint
  couverture: number | null      // mois, fin de mois (null : aucune demande à venir)
  consigne: number               // couverture visée fin de mois
  stockCible: number             // stock fin de mois correspondant à la consigne
  valeurStock: number | null
  valeurPlan: number | null
}

export type ProjectionArticle = {
  article: PlanArticle
  mois: MoisProjete[]
  stockMin: number
  moisStockMin: string | null
  premiereRupture: string | null      // premier mois dont le point bas est négatif
  moisSousConsigne: string[]          // mois de la fenêtre d'appro dont la couverture fin de mois est sous la consigne
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
export function nbJoursMois(mois: string): number {
  const [y, m] = mois.split('-').map(Number)
  return new Date(y, m, 0).getDate()
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
/** Jour effectif de livraison du plan dans un mois (31 = dernier jour). */
export function jourLivraisonMois(mois: string, jour: number): number {
  return Math.max(1, Math.min(nbJoursMois(mois), Math.round(jour || 1)))
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

function valeurParPortee(table: Record<string, number>, ref: string, mois: string): number | undefined {
  const r = table[cleHypo(ref, mois)]
  if (r !== undefined && Number.isFinite(r)) return r
  const t = table[cleHypo('*', mois)]
  if (t !== undefined && Number.isFinite(t)) return t
  return undefined
}
function coefMois(ref: string, mois: string, ctx: ContexteProjection): number {
  return valeurParPortee(ctx.hypotheses, ref, mois) ?? ctx.params.coefDefaut
}
/** Consigne de couverture fin de mois : référence > groupe (scénario) > valeur par défaut. */
export function consigneMois(ref: string, mois: string, ctx: Pick<ContexteProjection, 'consignes' | 'params'>): number {
  return valeurParPortee(ctx.consignes, ref, mois) ?? ctx.params.couvertureCible
}

const arr1 = (v: number) => Math.round(v * 10) / 10
const PLAFOND_COUVERTURE = 99

/** Demande mensuelle retenue au-delà de l'horizon : moyenne des 3 derniers mois de l'horizon. */
function demandeExtrapolee(demandes: number[]): number {
  const der = demandes.slice(-3)
  return der.length ? der.reduce((s, d) => s + d, 0) / der.length : 0
}

/**
 * Couverture en mois d'un stock de fin de mois i : consommation mois par mois de la demande des mois suivants.
 * null si aucune demande à venir (stock ≥ 0) ; 0 si le stock est nul ou négatif.
 */
export function couvertureFinMois(stock: number, demandes: number[], i: number): number | null {
  if (stock <= 0) return 0
  const ext = demandeExtrapolee(demandes)
  let reste = stock, cov = 0
  for (let j = i + 1; j < demandes.length; j += 1) {
    const d = demandes[j]
    if (d <= 0) { cov += 1; continue }
    if (reste >= d) { reste -= d; cov += 1 } else { return Math.round((cov + reste / d) * 10) / 10 }
  }
  if (ext <= 0) return demandes.slice(i + 1).some((d) => d > 0) ? PLAFOND_COUVERTURE : null
  return Math.min(PLAFOND_COUVERTURE, Math.round((cov + reste / ext) * 10) / 10)
}

/** Stock de fin de mois i nécessaire pour couvrir `consigne` mois de demande des mois suivants (inverse de couvertureFinMois). */
export function stockPourCouverture(consigne: number, demandes: number[], i: number): number {
  if (consigne <= 0) return 0
  const ext = demandeExtrapolee(demandes)
  let reste = consigne, s = 0, j = i + 1
  while (reste > 1e-9) {
    const d = j < demandes.length ? demandes[j] : ext
    const part = Math.min(1, reste)
    s += d * part
    reste -= part
    j += 1
    if (j > i + 120) break
  }
  return Math.round(s * 10) / 10
}

type Arrivee = { jour: number; q: number }

/** Point bas d'un mois : demande uniforme du jour de départ au dernier jour, entrées reçues le matin de leur jour. */
function pointBasMois(stockDebut: number, demande: number, arrivees: Arrivee[], jourDepart: number, nbJours: number): { pointBas: number; jour: number } {
  const jours = Math.max(1, nbJours - jourDepart + 1)
  const parJour = demande / jours
  const tri = [...arrivees].filter((a) => a.q > 0).sort((x, y) => x.jour - y.jour)
  let min = stockDebut, jourMin = jourDepart, recu = 0
  tri.forEach((a) => {
    const j = Math.max(jourDepart, Math.min(nbJours, a.jour))
    const avant = stockDebut + recu - parJour * (j - jourDepart)   // juste avant la réception
    if (avant < min) { min = avant; jourMin = j }
    recu += a.q
  })
  const fin = stockDebut + recu - demande
  if (fin < min) { min = fin; jourMin = nbJours }
  return { pointBas: arr1(min), jour: jourMin }
}

/** Projection mensuelle d'une référence. `planOverride` remplace le plan du contexte pour cette référence. */
export function projeterArticle(a: PlanArticle, ctx: ContexteProjection, planOverride?: Record<string, number>): ProjectionArticle {
  const moisCourant = moisDe(ctx.aujourdhui)
  const jourCourant = Number(ctx.aujourdhui.slice(8, 10)) || 1
  const horizon = listeMois(moisCourant, ctx.params.moisFinHorizon)
  const prorata = partRestanteMois(ctx.aujourdhui)
  const dansPerimetre = (e: Echeance) => a.perimetreGlobal || e.fms
  const dateDouteux = ajouterJours(ctx.aujourdhui, -ctx.retardMaxJours)
  const fenetre = new Set(listeMois(ctx.params.moisDebutAppro, ctx.params.moisFinAppro))

  const ferme = new Map<string, number>()
  if (ctx.params.inclureReserve) {
    ;(a.reserve || []).filter(dansPerimetre).forEach((e) => {
      const m = e.d < moisCourant ? moisCourant : moisDe(e.d)
      ferme.set(m, (ferme.get(m) || 0) + Number(e.q || 0))
    })
  }
  // encours datés au jour (retard → disponible aujourd'hui)
  const encours = new Map<string, Arrivee[]>()
  ;(a.encours || []).filter(dansPerimetre).forEach((e) => {
    if (e.d < dateDouteux) return
    const enRetard = e.d < ctx.aujourdhui
    const m = enRetard ? moisCourant : moisDe(e.d)
    const jour = enRetard ? jourCourant : Number(e.d.slice(8, 10)) || 1
    const l = encours.get(m) || []
    l.push({ jour, q: Number(e.q || 0) })
    encours.set(m, l)
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
    const demande = arr1(Math.max(prevision, f))
    const arrEnc = encours.get(mois) || []
    const enc = arrEnc.reduce((s, x) => s + x.q, 0)
    const p = plan(mois)
    const stockDebut = stock
    stock = arr1(stock + enc + p - demande)
    const nbJ = nbJoursMois(mois)
    const jourDepart = i === 0 ? Math.min(jourCourant, nbJ) : 1
    const pb = pointBasMois(stockDebut, demande, [...arrEnc, { jour: Math.max(jourDepart, jourLivraisonMois(mois, ctx.params.jourLivraison)), q: p }], jourDepart, nbJ)
    return {
      mois, histo, propre, pctCede, apports, base: arr1(base), coef, prevision, ferme: f, demande, encours: enc, plan: p, entrees: enc + p,
      stockDebut, stockFin: stock, pointBas: pb.pointBas, jourPointBas: pb.jour,
      couverture: null, consigne: consigneMois(a.ref, mois, ctx), stockCible: 0,
      valeurStock: a.prix === null ? null : Math.round(Math.max(0, stock) * a.prix),
      valeurPlan: a.prix === null ? null : Math.round(p * a.prix),
    }
  })
  const demandes = lignes.map((l) => l.demande)
  lignes.forEach((l, i) => {
    l.couverture = couvertureFinMois(l.stockFin, demandes, i)
    l.stockCible = stockPourCouverture(l.consigne, demandes, i)
  })

  let stockMin = a.stockBase, moisStockMin: string | null = null, premiereRupture: string | null = null
  const moisSousConsigne: string[] = []
  lignes.forEach((l) => {
    if (l.pointBas < stockMin) { stockMin = l.pointBas; moisStockMin = l.mois }
    if (premiereRupture === null && l.pointBas < 0) premiereRupture = l.mois
    if (fenetre.has(l.mois) && l.stockFin < l.stockCible - 0.05) moisSousConsigne.push(l.mois)
  })
  const totalPlan = lignes.reduce((s, l) => s + l.plan, 0)
  return {
    article: a, mois: lignes, stockMin, moisStockMin, premiereRupture, moisSousConsigne, totalPlan,
    valeurPlan: a.prix === null ? null : Math.round(totalPlan * a.prix), repriseChainage: arr1(repriseTotale),
  }
}

function arrondirColisage(q: number, colisage: number): number {
  const c = colisage > 1 ? colisage : 1
  return Math.max(0, Math.ceil(q / c - 1e-9) * c)
}

/**
 * Proposition de plan pour une référence. Pour chaque mois M de la fenêtre d'appro (dans l'ordre) :
 *   stock visé fin M = max( stock cible de la consigne de M,
 *                           demande de M+1 jusqu'au jour de livraison de M+1, si M+1 est un mois de livraison
 *                           tardive : sinon le point bas de M+1 passerait sous zéro avant la livraison )
 *   quantité M = stock visé − stock fin M sans livraison du plan en M, arrondie au colisage (0 si négatif).
 * La demande ne dépend pas du plan : la proposition est exacte en un passage. Le plan hors fenêtre est conservé.
 */
export function proposerPlanArticle(a: PlanArticle, ctx: ContexteProjection): Record<string, number> {
  const moisCourant = moisDe(ctx.aujourdhui)
  const fenetreListe = listeMois(ctx.params.moisDebutAppro, ctx.params.moisFinAppro).filter((m) => m >= moisCourant)
  const fenetre = new Set(fenetreListe)
  const plan: Record<string, number> = {}
  Object.entries(ctx.plan).forEach(([k, v]) => { if (k.startsWith(`${cleRef(a.ref)}|`) && !fenetre.has(k.split('|')[1])) plan[k] = v })
  fenetreListe.forEach((m) => {
    const proj = projeterArticle(a, ctx, plan)
    const i = proj.mois.findIndex((x) => x.mois === m)
    if (i < 0) return
    const l = proj.mois[i]
    let vise = l.stockCible
    const suiv = proj.mois[i + 1]
    if (suiv && fenetre.has(suiv.mois)) {
      const jl = jourLivraisonMois(suiv.mois, ctx.params.jourLivraison)
      if (jl > 1) {
        const nbJ = nbJoursMois(suiv.mois)
        const avantLivraison = suiv.demande * (jl - 1) / nbJ
        vise = Math.max(vise, avantLivraison)
      }
    }
    const besoin = vise - l.stockFin       // stockFin calculé sans livraison du plan en M (plan[M] non posé)
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
  stockCible: number             // Σ stocks cibles des consignes
  couverture: number | null      // couverture fin de mois du stock positif de la sélection
  consigne: number | null        // couverture équivalente au Σ des stocks cibles
  valeurStock: number; valeurPlan: number
  nbRupture: number              // références dont le point bas du mois est négatif
  nbSousConsigne: number         // références dont le stock fin est sous la consigne
}

/** Agrégat mensuel d'une sélection (couvertures calculées comme pour une référence, sur les sommes). */
export function agreger(projections: ProjectionArticle[]): AgregatMois[] {
  if (!projections.length) return []
  const lignes = projections[0].mois.map((m0, i) => {
    let demande = 0, prevision = 0, ferme = 0, encours = 0, plan = 0, stockFin = 0, manque = 0, stockNet = 0, stockCible = 0, valeurStock = 0, valeurPlan = 0, nbRupture = 0, nbSousConsigne = 0
    projections.forEach((p) => {
      const l = p.mois[i]
      if (!l) return
      demande += l.demande; prevision += l.prevision; ferme += l.ferme; encours += l.encours; plan += l.plan
      stockNet += l.stockFin; stockCible += l.stockCible
      if (l.stockFin >= 0) stockFin += l.stockFin; else manque -= l.stockFin
      valeurStock += l.valeurStock || 0; valeurPlan += l.valeurPlan || 0
      if (l.pointBas < 0) nbRupture += 1
      if (l.stockFin < l.stockCible - 0.05) nbSousConsigne += 1
    })
    return {
      mois: m0.mois, demande: arr1(demande), prevision: arr1(prevision), ferme, encours, plan,
      stockFin: arr1(stockFin), manque: arr1(manque), stockNet: arr1(stockNet), stockCible: arr1(stockCible),
      couverture: null as number | null, consigne: null as number | null,
      valeurStock, valeurPlan, nbRupture, nbSousConsigne,
    }
  })
  const demandes = lignes.map((l) => l.demande)
  lignes.forEach((l, i) => {
    l.couverture = couvertureFinMois(l.stockFin, demandes, i)
    l.consigne = l.stockCible > 0 ? couvertureFinMois(l.stockCible, demandes, i) : 0
  })
  return lignes
}
