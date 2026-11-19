/**
 * Rapprochement des écarts « Stock FMS SAGE ↔ image MyStock » (écran /stock/controle-mystock).
 * ---------------------------------------------------------------------------------------------
 * Créé le 19/11/2026.
 *
 * Écart = stock MyStock à l'heure de l'image − stock SAGE de la dernière photo SAGE avant l'image
 * (jour J, import SAGE de ≈ 23h05). Chaque écart est expliqué par des mouvements :
 *   - BL / retours SAGE à la ligne (tous dépôts, avec le mode d'expédition SAGE) ;
 *   - mouvements MyStock à la ligne importés dans l'écran : expéditions / préparations
 *     (N° commande = BL SAGE ou transfert 28xxx) et réceptions (fournisseurs et retours d'agences) ;
 *   - photos SAGE quotidiennes après J (stock FMS et TRANSIT FMS), pour voir quand SAGE a
 *     enregistré une réception ou un transfert.
 *
 * Trois niveaux, demandés par Arnaud :
 *   « sur »        les explications certaines (décalage de date prouvé par les deux systèmes)
 *                  ramènent l'écart à zéro ;
 *   « avalider »   il faut en plus une ou plusieurs hypothèses (BL jamais expédié par FMS → dépôt
 *                  à vérifier, préparé avant l'image, transfert, réception, unité…) qui, ensemble,
 *                  expliquent exactement l'écart ;
 *   « inexplique » aucune combinaison n'explique l'écart (les pistes sont listées).
 *
 * Convention de signe : chaque explication porte la quantité qu'elle apporte à l'écart
 * (MyStock − SAGE) ; la somme des explications retenues = écart.
 */

export type Niveau = 'sur' | 'avalider'
export type Groupe = 'ok' | 'sur' | 'avalider' | 'inexplique'

export type Explication = {
  niveau: Niveau
  code: string
  libelle: string
  qte: number
  documents?: string[]
}

export type LigneBase = {
  reference: string
  designation: string | null
  famille: string | null
  qte_mystock: number | null
  qte_sage: number
  qte_sage_actuel: number
  transit: number
  ecart: number
  pu: number
  ecart_valeur: number
  statut: string
  bl_non_expedies?: number
  bl_depuis?: string | null
  nb_lignes_fichier: number
  prepa_fin_j: number
  bl_jour: number
  bl_apres: number
  suivi_statut: 'a_analyser' | 'explique' | 'corrige' | null
  suivi_commentaire: string | null
  suivi_par: string | null
  suivi_le: string | null
}

/** [référence, n° BL, date (AAAA-MM-JJ), quantité, dépôt, mode d'expédition, client] */
export type LigneBL = [string, string, string, number, string, string | null, string | null]
/** [référence, type, document, date ISO, quantité, tiers, transporteur, retour] */
export type LigneMvt = [string, 'expedition' | 'reception', string, string, number, string | null, string | null, boolean]
/** [référence, date (AAAA-MM-JJ), stock FMS, stock TRANSIT FMS] */
export type LignePhoto = [string, string, number | null, number | null]

export type Couverture = Partial<Record<'expedition' | 'reception', { date_min: string; date_max: string; lignes: number }>>

export type DonneesRapprochement = {
  controle: { id: number; date_image: string; heure_image: string | null; depot_num: string; fichier_nom: string | null }
  meta: { depot: string; source_sage: 'photo' | 'reconstitue'; photo_loaded_at: string | null; stock_actuel_loaded_at: string | null }
  lignes: LigneBase[]
  couverture: Couverture
  bl: LigneBL[]
  mvt: LigneMvt[]
  photos: LignePhoto[]
}

export type Analyse = {
  groupe: Groupe
  explications: Explication[]
  pistes: Explication[]
  residu: number
}

export type ResumeRapprochement = {
  v2: true
  heure_image: string | null
  mouvements_exp: boolean
  mouvements_rec: boolean
  nb_references: number
  nb_ok: number
  nb_sur: number
  nb_avalider: number
  nb_inexplique: number
  valeur_sur: number
  valeur_avalider: number
  valeur_inexplique: number
}

const JOUR = 86400000
const PARIS = 'Europe/Paris'

export const fmtDateCourt = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' })
export const fmtDateHeureCourt = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const q = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)

/** Jour calendaire de Paris (AAAA-MM-JJ) d'un instant. */
export function jourParis(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Fin de journée de Paris (approximation : 23h59 heure locale via décalage du jour). */
function finJourParis(jour: string): Date {
  // 22h59 UTC couvre 23h59 en hiver ; en été 21h59 UTC. Une heure d'écart n'a pas d'incidence ici.
  return new Date(`${jour}T22:59:59Z`)
}

/** Sous-ensemble de candidats dont la somme vaut exactement `cible` (quantités entières ou au centième). */
function sousEnsemble(cands: Explication[], cible: number): Explication[] | null {
  const k = (x: number) => Math.round(x * 100)
  const objectif = k(cible)
  if (objectif === 0) return []
  const liste = cands.slice(0, 22)
  // Programmation dynamique sur les sommes atteignables (bornée).
  let etats = new Map<number, number[]>([[0, []]])
  for (let i = 0; i < liste.length; i++) {
    const v = k(liste[i].qte)
    if (v === 0) continue
    const suivants = new Map(etats)
    for (const [s, idx] of etats) {
      const ns = s + v
      if (!suivants.has(ns)) suivants.set(ns, [...idx, i])
      if (ns === objectif) return [...idx, i].map((j) => liste[j])
    }
    etats = suivants
    if (etats.size > 60000) break
  }
  const r = etats.get(objectif)
  return r ? r.map((j) => liste[j]) : null
}

export function analyserRapprochement(d: DonneesRapprochement): Map<string, Analyse> {
  const out = new Map<string, Analyse>()
  const d0 = d.controle.date_image
  const T = d.controle.heure_image ? new Date(d.controle.heure_image) : finJourParis(d0)
  const jourT = jourParis(T)
  const debutFenetre = new Date(new Date(`${d0}T12:00:00Z`).getTime() - 21 * JOUR)
  const cExp = d.couverture?.expedition
  const finExp = cExp ? new Date(cExp.date_max) : null
  const debutExpJour = cExp ? jourParis(new Date(cExp.date_min)) : null
  // Les expéditions MyStock couvrent l'image si le fichier commence avant J−1 et se termine après l'heure de l'image.
  const avecExp = !!cExp && new Date(cExp.date_min).getTime() <= new Date(`${d0}T00:00:00Z`).getTime() - JOUR && finExp!.getTime() >= T.getTime()

  const blParRef = new Map<string, LigneBL[]>()
  for (const l of d.bl || []) { const a = blParRef.get(l[0]); if (a) a.push(l); else blParRef.set(l[0], [l]) }
  const mvtParRef = new Map<string, LigneMvt[]>()
  for (const m of d.mvt || []) { const a = mvtParRef.get(m[0]); if (a) a.push(m); else mvtParRef.set(m[0], [m]) }
  const photosParRef = new Map<string, LignePhoto[]>()
  for (const p of d.photos || []) { const a = photosParRef.get(p[0]); if (a) a.push(p); else photosParRef.set(p[0], [p]) }

  for (const ligne of d.lignes) {
    const ref = ligne.reference
    const my = Number(ligne.qte_mystock ?? 0)
    const sage = Number(ligne.qte_sage ?? 0)
    const ecart = my - sage
    if (ecart === 0) { out.set(ref, { groupe: 'ok', explications: [], pistes: [], residu: 0 }); continue }

    const sur: Explication[] = []
    const cands: Explication[] = []
    const bls = blParRef.get(ref) || []
    const mvts = mvtParRef.get(ref) || []
    const photos = (photosParRef.get(ref) || []).slice().sort((a, b) => a[1].localeCompare(b[1]))

    // Mouvements MyStock de la référence
    const exp = new Map<string, { ts: Date; q: number; tiers: string | null }>()
    const rec: Array<{ doc: string; ts: Date; q: number; tiers: string | null; retour: boolean }> = []
    for (const m of mvts) {
      if (m[1] === 'expedition') {
        const cur = exp.get(m[2])
        if (cur) cur.q += Number(m[4]); else exp.set(m[2], { ts: new Date(m[3]), q: Number(m[4]), tiers: m[5] })
      } else rec.push({ doc: m[2], ts: new Date(m[3]), q: Number(m[4]), tiers: m[5], retour: !!m[7] })
    }

    // BL SAGE regroupés par n° (quantité dépôt FMS / autres dépôts)
    type BL = { bl: string; date: string; fms: number; autre: number; depots: Set<string>; mode: string | null; client: string | null }
    const parBl = new Map<string, BL>()
    for (const [, bl, date, qte, depot, mode, client] of bls) {
      if (!bl) continue
      let b = parBl.get(bl)
      if (!b) { b = { bl, date, fms: 0, autre: 0, depots: new Set(), mode, client }; parBl.set(bl, b) }
      const dep = (depot || '').trim().toUpperCase()
      if (dep === d.meta.depot.toUpperCase()) b.fms += Number(qte)
      else if (dep) { b.autre += Number(qte); b.depots.add(depot) }
      if (date < b.date) b.date = date
    }

    // Mouvements SAGE non expliqués par les BL, jour par jour après J (réceptions, transferts).
    const deltasSage: Array<{ jour: string; delta: number }> = []
    for (let i = 1; i < photos.length; i++) {
      const [, jour, fms] = photos[i]
      const fmsVeille = photos[i - 1][2]
      let blJour = 0
      for (const b of parBl.values()) if (b.date === jour) blJour += b.fms
      const delta = Number(fms ?? 0) - Number(fmsVeille ?? 0) + blJour
      if (delta !== 0) deltasSage.push({ jour, delta })
    }
    /** Cherche, après J, un mouvement SAGE inexpliqué de même sens couvrant `qte` (réception ou
     *  transfert enregistré dans SAGE après l'image). `proche` : enregistré au plus 3 jours après
     *  le mouvement physique (ou après J s'il est antérieur à J). `tester` : ne consomme pas. */
    const consommerDelta = (signe: 1 | -1, qte: number, ts: Date, tester = false): { jour: string; proche: boolean } | null => {
      // Priorité au jour où le mouvement SAGE inexpliqué a exactement la quantité cherchée.
      let i = deltasSage.findIndex((x) => Math.abs(x.delta - signe * qte) < 1e-9)
      const exact = i >= 0
      if (!exact) i = deltasSage.findIndex((x) => Math.sign(x.delta) === signe && Math.abs(x.delta) >= qte - 1e-9)
      if (i < 0) return null
      const jour = deltasSage[i].jour
      if (!tester) deltasSage[i].delta -= signe * qte
      const base = Math.max(ts.getTime(), new Date(`${d0}T12:00:00Z`).getTime())
      // « proche » (certain) : même quantité exactement, enregistrée dans SAGE au plus 3 jours après.
      const proche = exact && new Date(`${jour}T12:00:00Z`).getTime() - base <= 3.5 * JOUR
      return { jour, proche }
    }

    const docsBl = new Set<string>()
    if (avecExp) {
      for (const b of parBl.values()) {
        docsBl.add(b.bl)
        const m = exp.get(b.bl)
        const avant = m && m.ts <= T ? m.q : 0
        const apres = m && m.ts > T ? m.q : 0
        const client = b.client ? ` (${b.client})` : ''
        // BL antérieur au début du fichier des préparations et sans expédition connue : supposé expédié avant.
        const horsFichier = !m && debutExpJour !== null && b.date < debutExpJour
        if (horsFichier && b.fms > 0 && b.date <= d0) {
          cands.push({ niveau: 'avalider', code: 'hors_fichier', qte: b.fms, documents: [b.bl],
            libelle: `BL ${b.bl} du ${fmtDateCourt(b.date)}${client}${b.mode ? `, ${b.mode}` : ''} : antérieur au fichier des préparations, expédition FMS non vérifiable` })
        }
        if (b.fms !== 0 && !horsFichier) {
          if (b.date <= d0) {
            const reste = b.fms - avant
            if (reste > 0) {
              const a = Math.min(reste, apres)
              if (a > 0) {
                sur.push({ niveau: 'sur', code: 'expedie_apres', qte: a, documents: [b.bl],
                  libelle: `BL ${b.bl} du ${fmtDateCourt(b.date)}${client} : sorti de SAGE, expédié par FMS le ${fmtDateHeureCourt(m!.ts.toISOString())}, après l'image` })
                if (jourParis(m!.ts) === jourT) {
                  cands.push({ niveau: 'avalider', code: 'prepare_avant', qte: -a, documents: [b.bl],
                    libelle: `BL ${b.bl} : sans doute déjà préparé (sorti de MyStock) avant l'image, expédié le ${fmtDateHeureCourt(m!.ts.toISOString())}` })
                }
              }
              const r2 = reste - a
              if (r2 > 0) {
                const recent = finExp && new Date(`${b.date}T12:00:00Z`).getTime() > finExp.getTime() - 3 * JOUR
                if (recent) {
                  sur.push({ niveau: 'sur', code: 'pas_encore_expedie', qte: r2, documents: [b.bl],
                    libelle: `BL ${b.bl} du ${fmtDateCourt(b.date)}${client} : sorti de SAGE, pas encore expédié par FMS (fin du fichier des préparations)` })
                } else {
                  cands.push({ niveau: 'avalider', code: 'jamais_expedie', qte: r2, documents: [b.bl],
                    libelle: `BL ${b.bl} du ${fmtDateCourt(b.date)}${client}${b.mode ? `, ${b.mode}` : ''} : sorti du dépôt FMS dans SAGE mais jamais expédié par FMS → vérifier le dépôt du BL` })
                }
              }
            } else if (reste < 0) {
              cands.push({ niveau: 'avalider', code: 'qte_differente', qte: reste, documents: [b.bl],
                libelle: `BL ${b.bl} : FMS a expédié ${q(avant)} pour ${q(b.fms)} dans SAGE` })
            }
          } else if (avant > 0) {
            const a = Math.min(avant, b.fms)
            sur.push({ niveau: 'sur', code: 'expedie_avant_bl', qte: -a, documents: [b.bl],
              libelle: `BL ${b.bl} daté du ${fmtDateCourt(b.date)}${client} mais déjà expédié par FMS le ${fmtDateHeureCourt(m!.ts.toISOString())}, avant l'image` })
          }
        }
        if (b.autre > 0 && m && m.ts <= T && m.ts >= debutFenetre) {
          const a = Math.min(b.autre, m.q - Math.max(0, b.fms))
          if (a > 0) {
            cands.push({ niveau: 'avalider', code: 'depot_agence', qte: -a, documents: [b.bl],
              libelle: `BL ${b.bl}${client} sur le dépôt ${[...b.depots].join(', ')} dans SAGE mais expédié par FMS le ${fmtDateHeureCourt(m.ts.toISOString())} → corriger le dépôt` })
          }
        }
      }

      // Expéditions MyStock sans ligne SAGE de la référence : transferts vers les agences (28xxx)
      // ou BL SAGE où la référence n'apparaît pas (substitution, erreur de référence).
      for (const [doc, m] of exp) {
        if (docsBl.has(doc)) continue
        const estTransfert = !/^B[LR]/.test(doc)
        const dest = m.tiers ? ` vers ${m.tiers}` : ''
        const quand = fmtDateHeureCourt(m.ts.toISOString())
        if (m.ts <= T && m.ts >= debutFenetre) {
          if (!estTransfert) {
            cands.push({ niveau: 'avalider', code: 'bl_sans_ligne', qte: -m.q, documents: [doc],
              libelle: `${doc}${dest} : FMS a expédié cette référence le ${quand}, absente de ce BL dans SAGE (substitution ?)` })
            continue
          }
          const jour = consommerDelta(-1, m.q, m.ts)
          if (jour && jour.proche) {
            sur.push({ niveau: 'sur', code: 'transfert_sage_tard', qte: -m.q, documents: [doc],
              libelle: `Transfert ${doc}${dest} expédié par FMS le ${quand}, enregistré dans SAGE le ${fmtDateCourt(jour.jour)}` })
          } else if (jour) {
            cands.push({ niveau: 'avalider', code: 'transfert_sage_tard', qte: -m.q, documents: [doc],
              libelle: `Transfert ${doc}${dest} expédié par FMS le ${quand} ; une sortie SAGE de même quantité apparaît le ${fmtDateCourt(jour.jour)}` })
          } else if (m.ts.getTime() >= new Date(`${d0}T00:00:00Z`).getTime() - 2 * JOUR) {
            cands.push({ niveau: 'avalider', code: 'transfert_avant', qte: -m.q, documents: [doc],
              libelle: `Transfert ${doc}${dest} expédié par FMS le ${quand} : sortie SAGE non retrouvée après J` })
          }
        } else if (estTransfert && m.ts > T && m.ts.getTime() <= T.getTime() + 3 * JOUR && !consommerDelta(-1, m.q, m.ts, true)) {
          cands.push({ niveau: 'avalider', code: 'transfert_apres', qte: m.q, documents: [doc],
            libelle: `Transfert ${doc}${dest} expédié par FMS le ${quand} (après l'image) : déjà sorti de SAGE avant J ?` })
        }
      }
    } else {
      // Sans fichier des préparations couvrant l'image : hypothèse des BL SAGE récents non expédiés.
      if (Number(ligne.bl_non_expedies ?? 0) !== 0) {
        cands.push({ niveau: 'avalider', code: 'bl_recents', qte: Number(ligne.bl_non_expedies),
          libelle: `BL SAGE datés depuis le ${ligne.bl_depuis ? fmtDateCourt(ligne.bl_depuis) : '?'} probablement pas encore expédiés (importer le fichier des préparations pour le confirmer)` })
      }
    }

    // Réceptions MyStock
    const photoJ = photos.find((p) => p[1] === d0)
    let transitRestant = Number(photoJ?.[3] ?? ligne.transit ?? 0)
    for (const r of rec) {
      const de = r.tiers ? ` (${r.tiers})` : ''
      if (r.ts <= T && r.ts >= debutFenetre) {
        if (r.retour && transitRestant > 0) {
          const a = Math.min(r.q, transitRestant)
          transitRestant -= a
          sur.push({ niveau: 'sur', code: 'retour_transit', qte: a, documents: [r.doc],
            libelle: `Retour d'agence n° ${r.doc}${de} reçu par FMS le ${fmtDateHeureCourt(r.ts.toISOString())}, encore en TRANSIT ${d.meta.depot} dans SAGE` })
          if (a < r.q) cands.push({ niveau: 'avalider', code: 'retour', qte: r.q - a, documents: [r.doc],
            libelle: `Retour d'agence n° ${r.doc}${de} reçu le ${fmtDateHeureCourt(r.ts.toISOString())} : entrée SAGE non retrouvée` })
          continue
        }
        const jour = consommerDelta(1, r.q, r.ts)
        if (jour) {
          const e: Explication = { niveau: jour.proche ? 'sur' : 'avalider', code: 'reception_sage_tard', qte: r.q, documents: [r.doc],
            libelle: `Réception n° ${r.doc}${de} validée par FMS le ${fmtDateHeureCourt(r.ts.toISOString())}, ${jour.proche ? 'enregistrée' : 'une entrée SAGE de même quantité apparaît'} dans SAGE le ${fmtDateCourt(jour.jour)}` }
          if (jour.proche) sur.push(e); else cands.push(e)
        } else if (r.ts.getTime() >= new Date(`${d0}T00:00:00Z`).getTime() - 7 * JOUR) {
          cands.push({ niveau: 'avalider', code: 'reception_non_vue', qte: r.q, documents: [r.doc],
            libelle: `Réception n° ${r.doc}${de} validée par FMS le ${fmtDateHeureCourt(r.ts.toISOString())} : entrée en stock SAGE non retrouvée après J` })
        }
      } else if (r.ts > T && r.ts.getTime() <= T.getTime() + 7 * JOUR && !consommerDelta(1, r.q, r.ts, true)) {
        cands.push({ niveau: 'avalider', code: 'reception_sage_avance', qte: -r.q, documents: [r.doc],
          libelle: `Réception n° ${r.doc}${de} validée par FMS le ${fmtDateHeureCourt(r.ts.toISOString())}, après l'image : déjà entrée dans SAGE avant ?` })
      }
    }

    const sommeSur = sur.reduce((s, e) => s + e.qte, 0)
    const residu = Math.round((ecart - sommeSur) * 100) / 100
    if (residu === 0) { out.set(ref, { groupe: 'sur', explications: sur, pistes: cands, residu: 0 }); continue }

    // Les hypothèses les plus probables d'abord (BL jamais expédiés, préparés avant l'image…).
    const ordre = ['jamais_expedie', 'prepare_avant', 'depot_agence', 'bl_sans_ligne', 'retour', 'transfert_sage_tard', 'reception_sage_tard', 'reception_non_vue', 'transfert_avant', 'qte_differente', 'bl_recents', 'transfert_apres', 'reception_sage_avance', 'hors_fichier']
    cands.sort((a, b) => ordre.indexOf(a.code) - ordre.indexOf(b.code))
    // Hypothèses solides combinées librement ; une seule hypothèse faible au plus (BL antérieur au
    // fichier, transfert ou réception après l'image, quantité différente) pour ne pas « forcer » l'écart.
    const faibles = new Set(['hors_fichier', 'transfert_apres', 'reception_sage_avance', 'qte_differente'])
    const solides = cands.filter((c) => !faibles.has(c.code))
    let choix = sousEnsemble(solides, residu)
    if (!choix) {
      for (const f of cands.filter((c) => faibles.has(c.code))) {
        const reste = sousEnsemble(solides, Math.round((residu - f.qte) * 100) / 100)
        if (reste) { choix = [...reste, f]; break }
      }
    }
    // En dernier recours : unité de gestion différente (rapport entier entre les deux stocks).
    if (!choix && my > 0 && sage > 0) {
      const k = sage > my ? sage / my : my / sage
      if (Number.isInteger(k) && k >= 2 && Math.abs(residu) === Math.abs(ecart)) {
        const u: Explication = { niveau: 'avalider', code: 'unite', qte: residu,
          libelle: `Stock SAGE ${sage > my ? `= ${k} × MyStock` : `= MyStock / ${k}`} : unité de gestion différente entre SAGE et MyStock ?` }
        cands.push(u)
        choix = [u]
      }
    }
    if (choix && choix.length) {
      out.set(ref, { groupe: 'avalider', explications: [...sur, ...choix], pistes: cands.filter((c) => !choix.includes(c)), residu: 0 })
    } else {
      out.set(ref, { groupe: 'inexplique', explications: sur, pistes: cands, residu })
    }
  }
  return out
}

export function resumerRapprochement(d: DonneesRapprochement, a: Map<string, Analyse>): ResumeRapprochement {
  const r: ResumeRapprochement = {
    v2: true, heure_image: d.controle.heure_image,
    mouvements_exp: !!d.couverture?.expedition, mouvements_rec: !!d.couverture?.reception,
    nb_references: d.lignes.length, nb_ok: 0, nb_sur: 0, nb_avalider: 0, nb_inexplique: 0,
    valeur_sur: 0, valeur_avalider: 0, valeur_inexplique: 0,
  }
  for (const l of d.lignes) {
    const g = a.get(l.reference)?.groupe ?? 'ok'
    const v = Math.abs(Number(l.ecart_valeur || 0))
    if (g === 'ok') r.nb_ok++
    else if (g === 'sur') { r.nb_sur++; r.valeur_sur += v }
    else if (g === 'avalider') { r.nb_avalider++; r.valeur_avalider += v }
    else { r.nb_inexplique++; r.valeur_inexplique += v }
  }
  r.valeur_sur = Math.round(r.valeur_sur); r.valeur_avalider = Math.round(r.valeur_avalider); r.valeur_inexplique = Math.round(r.valeur_inexplique)
  return r
}
