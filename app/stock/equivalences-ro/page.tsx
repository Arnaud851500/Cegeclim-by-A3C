'use client'

/**
 * Écran « Équivalences R/O AirH2O 600 / 800 » (menu Stocks & logistique, /stock/equivalences-ro).
 * ---------------------------------------------------------------------------
 * Créé le 21/10/2026 — v2 le même jour, validée par Arnaud sur l'exemple de la taille 3,5.
 *
 * Pénurie R/O hiver 2026-2027 : les groupes extérieurs AirH2O 600 (split) et 800 (monobloc)
 * des tailles 3,5 à 6 manquent jusqu'à fin mars (ventilateurs) ; les tailles < 3,5 ne sont pas
 * concernées. Un groupe ne se vend pas seul : selon l'usage, il entre dans une solution
 * (groupe + module intérieur + ballon / accessoire). Pour chaque taille, chaque groupe et chaque
 * usage, l'écran montre :
 *  - la solution catalogue 2026 (AirH2O) ;
 *  - en face, des solutions backup d'anciennes générations (Yutaki S / S Combi, S80, Yutaki M / H,
 *    AirH2O 400…) — règle d'Arnaud : puissance équivalente ou supérieure, gestion commerciale
 *    et marge, sans passer par le technique.
 * Pour chaque solution : prix public de chaque composant, quantités dispo, composant limitant,
 * nombre de solutions réalisables, prix total et écart avec la solution catalogue 2026.
 *
 * Usages : Chauffage seul / réversible (S), Chauffage + ECS (S + ballon séparé), Combi (220 L intégrés),
 *          Monobloc H, Monobloc H Combi — filtrables.
 *
 * Dispo (21/10/2026) :
 *  - dispo immédiate = point bas du stock projeté (stock dispo + CDF − CDC, toutes dates) à partir d'aujourd'hui ;
 *  - dispo fin décembre = même calcul à partir du 31/12 (arrivages et CDC jusqu'à fin décembre compris) ;
 *  - bloc = min(dispo du composant ÷ quantité) sur les composants de la solution.
 *
 * ÉVOLUTION (23/10/2026) :
 *  - solutions backup : une seule pastille de dispo quand dispo immédiate = dispo fin décembre ;
 *  - en-tête des colonnes (taille + usage / catalogue 2026 / anciennes générations) toujours
 *    visible au défilement, en plus gros ;
 *  - pastilles d'aides en surimpression sur les solutions backup, d'après la note envoyée aux
 *    commerciaux (« ACTION 2 : utilisation de notre stock M / S / Scombi / S80 / AirH2O 400 ») :
 *      Yutaki S / S Combi et AirH2O 400 : remise classique + jusqu'à 10 % + chèque énergie Hitachi 500 € ;
 *      Yutaki M et S80 : remise classique + chèque énergie 500 € ;
 *      Yutaki H : tarif promo + chèque énergie 500 € ;
 *  - primes CEE (barèmes DRAPO S2 2026 « Maisons », zones H1 / H2) : prime de chaque solution selon
 *    l'éligibilité de sa gamme au Coup de pouce chauffage et à l'ETAS ≥ 140 % à 55 °C, écart avec la
 *    solution catalogue 2026, et bilan client = écart de prix net + perte de prime − chèque − remise
 *    complémentaire. Synthèse par gamme en tête d'écran. Hypothèse (zone, ménage, surface, Coup de
 *    pouce, remise classique moyenne) réglable, cas le plus fréquent par défaut (H2, classique,
 *    ≥ 90 m², remplacement d'une chaudière fossile).
 *
 * ÉVOLUTION (23/10/2026 soir) — demande d'Arnaud :
 *  - dans chaque taille, les groupes sont regroupés par alimentation (grosse pastille MONOPHASÉ 230 V /
 *    TRIPHASÉ 400 V) et, dans chaque alimentation, Split (AirH2O 600) et Monobloc (AirH2O 800) sont
 *    superposés : pour une taille recherchée, on voit d'un coup les dispos et solutions des deux types
 *    d'installation ;
 *  - en-tête de colonne « Solutions anciennes générations envisageables — NON EXHAUSTIF » en gros.
 *
 * Glisser-déposer (administrateurs, colonne « Articles à glisser ») :
 *  - un article du panneau de droite (ou de la recherche SAGE) sur une solution = l'ajouter
 *    comme composant (module, ballon, kit…) ; sur la zone vide d'un usage = nouvelle solution ;
 *  - une solution vers un autre usage / un autre groupe = la déplacer (Ctrl ou Alt = copier) ;
 *    sur une autre solution du même usage = changer l'ordre de proposition ;
 *  - un composant d'une solution vers une autre = le déplacer (Ctrl ou Alt = copier) ;
 *  - × retire un composant ou une solution ; le nom et la quantité se modifient directement.
 * Tout est partagé (tables stock_solutions / stock_solution_composants).
 *
 * Sources : RPC get_solutions_ro, rechercher_article_equivalence
 * (SQL supabase/migrations/20261021c_solutions_ro.sql, 20261021d_solutions_ro_dispo_fin_decembre.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Usage = 'S' | 'S_ECS' | 'COMBI' | 'MONO_H' | 'MONO_H_COMBI'
type Role = 'actuelle' | 'backup'
type MoisData = { mois: string; arrivages: number; cdc: number; non_tenable: number }

type Cible = {
  ref: string
  designation: string | null
  gamme: '600' | '800'
  taille: string
  alim: string
  prix: number | null
  stock_disponible: number | null
  qte_dispo_aujourdhui: number | null
  besoin_cdc_total: number | null
  nb_cdc: number | null
  date_prochaine_dispo: string | null
  mois: MoisData[]
  dispo_immediate?: number | null
  dispo_fin_dec?: number | null
}

type Article = {
  designation: string | null
  famille: string | null
  prix: number | null
  stock_disponible: number | null
  libre: number | null
  dispo_immediate?: number | null
  dispo_fin_dec?: number | null
  cdc?: number | null
  cdf?: number | null
  prochaine_reception_date?: string | null
  date_prochaine_dispo?: string | null
  pool?: boolean
  sommeil?: boolean | null
}

type Composant = { id: string; ref: string; quantite: number; rang: number }

type Solution = {
  id: string
  ref_cible: string
  usage: Usage
  role: Role
  libelle: string | null
  rang: number
  origine: 'auto' | 'manuel'
  commentaire: string | null
  modifie_par?: string | null
  composants: Composant[]
}

type Donnees = { calcule_le: string; fin_dec?: string; cibles: Cible[]; solutions: Solution[]; articles: Record<string, Article> }

type Glisse =
  | { type: 'article'; ref: string }
  | { type: 'solution'; id: string; ref_cible: string; usage: Usage; role: Role }
  | { type: 'composant'; id: string; ref: string; solutionId: string }

type Calcul = { total: number; realisable: number; realisableDec: number; limitants: Set<string>; limitantsDec: Set<string>; manquePrix: boolean }

type RawSolution = {
  id: string; ref_cible: string; usage: Usage; role: Role; libelle: string | null; rang: number
  origine: 'auto' | 'manuel'; commentaire: string | null; created_by_email: string | null; updated_by_email: string | null
  stock_solution_composants: { id: string; ref_article: string; quantite: number; rang: number }[] | null
}

// Gammes, aides commerciales et primes CEE
type GammeCode =
  | 'AIRH2O_600_S' | 'AIRH2O_600_COMBI' | 'AIRH2O_800_H' | 'AIRH2O_800_H_COMBI'
  | 'YUTAKI_S' | 'YUTAKI_S_COMBI' | 'S80' | 'YUTAKI_M' | 'YUTAKI_H' | 'YUTAKI_H_COMBI'
  | 'AIRH2O_400' | 'AIRH2O_400_COMBI' | 'AUTRE'
type Aides = { cheque: number; remiseSup: number; promo?: boolean }
type Zone = 'H1' | 'H2'
type Menage = 'classique' | 'precaire'
type Surface = 0 | 1 | 2
type HypCee = { zone: Zone; menage: Menage; surface: Surface; cdp: boolean; remiseClassique: number }
type Evaluation = {
  gamme: GammeCode
  taille: number | null
  cee: number | null
  cdpOk: boolean
  etasOk: boolean
  total: number
}
type Bilan = { ecartNet: number; deltaCee: number; aides: number; remiseSup: number; bilan: number }

// ─────────────────────────────────────────────────────────────────────────
// Constantes et helpers
// ─────────────────────────────────────────────────────────────────────────

const USAGES: Record<Usage, { label: string; sub: string; gamme: '600' | '800' }> = {
  S: { label: 'Chauffage seul / réversible', sub: 'module hydraulique S', gamme: '600' },
  S_ECS: { label: 'Chauffage + ECS', sub: 'S + ballon séparé', gamme: '600' },
  COMBI: { label: 'Combi', sub: 'ECS 220 L intégrée', gamme: '600' },
  MONO_H: { label: 'Monobloc H', sub: 'module hydraulique', gamme: '800' },
  MONO_H_COMBI: { label: 'Monobloc H Combi', sub: 'ECS 220 L intégrée', gamme: '800' },
}
const USAGES_600: Usage[] = ['S', 'S_ECS', 'COMBI']
const USAGES_800: Usage[] = ['MONO_H', 'MONO_H_COMBI']
/** (22/10/2026) Tailles retirées de l'écran à la demande d'Arnaud (1,5 / 2 / 2,5 / 3) : pas touchées par la pénurie. */
const TAILLES_MASQUEES = new Set([1.5, 2, 2.5, 3])
const tailleMasquee = (t: string) => TAILLES_MASQUEES.has(Number(String(t).replace(',', '.')))

const TAILLE_KW_600: Record<string, string> = { '1.5': '3,5 kW', '2': '4 kW', '2.5': '6 kW', '3': '8 kW', '3.5': '8,5 kW', '4': '10 kW', '5': '12 kW', '6': '14 kW' }
const TAILLE_KW_800: Record<string, string> = { '2': '4 kW', '3': '6 kW', '3.5': '8 kW', '4': '10 kW', '5': '12 kW', '6': '14 kW' }
const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/**
 * Gammes : éligibilité CEE (tableau « Critères d'éligibilité par gamme de matériel », DRAPO S2 2026)
 * et aides commerciales (note « ACTION 2 » aux commerciaux, octobre 2026).
 * etas(t) : ETAS ≥ 140 % à 55 °C selon la taille (code Hitachi) ou la puissance (kW, AirH2O 400).
 */
const GAMMES: Record<GammeCode, { label: string; cdp: boolean | null; etas: (t: number | null) => boolean; aides: Aides | null; etasNote: string }> = {
  AIRH2O_600_S: { label: 'AirH2O 600 S', cdp: true, etas: (t) => t !== null && t >= 3.5, aides: null, etasNote: 'à partir de la T3,5' },
  AIRH2O_600_COMBI: { label: 'AirH2O 600 S Combi', cdp: true, etas: (t) => t !== null && t >= 3.5, aides: null, etasNote: 'à partir de la T3,5' },
  AIRH2O_800_H: { label: 'AirH2O 800 H', cdp: true, etas: (t) => t === 4, aides: null, etasNote: 'T4 (10 kW) seulement' },
  AIRH2O_800_H_COMBI: { label: 'AirH2O 800 H Combi', cdp: true, etas: (t) => t === 4, aides: null, etasNote: 'T4 (10 kW) seulement' },
  YUTAKI_S: { label: 'Yutaki S', cdp: true, etas: () => false, aides: { cheque: 500, remiseSup: 10 }, etasNote: 'non' },
  YUTAKI_S_COMBI: { label: 'Yutaki S Combi', cdp: true, etas: () => false, aides: { cheque: 500, remiseSup: 10 }, etasNote: 'non' },
  S80: { label: 'Yutaki S80', cdp: true, etas: (t) => t === 4, aides: { cheque: 500, remiseSup: 0 }, etasNote: 'T4 (11 kW) seulement' },
  YUTAKI_M: { label: 'Yutaki M', cdp: true, etas: () => false, aides: { cheque: 500, remiseSup: 0 }, etasNote: 'non' },
  YUTAKI_H: { label: 'Yutaki H', cdp: false, etas: () => false, aides: { cheque: 500, remiseSup: 0, promo: true }, etasNote: 'non' },
  YUTAKI_H_COMBI: { label: 'Yutaki H Combi', cdp: false, etas: () => false, aides: { cheque: 500, remiseSup: 0, promo: true }, etasNote: 'non' },
  AIRH2O_400: { label: 'AirH2O 400', cdp: false, etas: (t) => t === 10, aides: { cheque: 500, remiseSup: 10 }, etasNote: '10 kW seulement' },
  AIRH2O_400_COMBI: { label: 'AirH2O 400 Combi', cdp: false, etas: (t) => t === 10, aides: { cheque: 500, remiseSup: 10 }, etasNote: '10 kW seulement' },
  AUTRE: { label: 'Gamme non reconnue', cdp: null, etas: () => false, aides: null, etasNote: '—' },
}

/** Barèmes CEE DRAPO S2 2026 — Maisons. [zone][ménage][coup de pouce][ETAS ≥ 140 ? 1 : 0][surface : <70 | 70-90 | ≥90]. */
const BAREME_CEE: Record<Zone, Record<Menage, { non: number[][]; oui: number[][] }>> = {
  H2: {
    precaire: { non: [[614, 859, 1227], [737, 1032, 1474]], oui: [[3068, 4295, 6136], [3686, 5160, 7371]] },
    classique: { non: [[359, 503, 718], [431, 604, 863]], oui: [[1795, 2513, 3591], [2157, 3019, 4313]] },
  },
  H1: {
    precaire: { non: [[736, 1031, 1473], [885, 1238, 1769]], oui: [[3681, 5154, 7363], [4423, 6192, 8845]] },
    classique: { non: [[431, 603, 862], [518, 725, 1035]], oui: [[2154, 3016, 4309], [2588, 3623, 5176]] },
  },
}
const HYP_DEFAUT: HypCee = { zone: 'H2', menage: 'classique', surface: 2, cdp: true, remiseClassique: 0 }
const SURFACES = ['< 70 m²', '70 à 90 m²', '≥ 90 m²']
const CLE_HYP = 'equivalences-ro:hyp-cee'

const n0 = (v: number | null | undefined) => Number(v ?? 0)

/** Alimentation : monophasé (230 V) avant triphasé (400 V). */
const estMono = (alim: string) => /230|mono/i.test(alim)
const rangAlim = (alim: string) => (estMono(alim) ? 0 : 1)
const LIB_ALIM = (alim: string) => (estMono(alim) ? 'Monophasé 230 V' : 'Triphasé 400 V')
const LIB_TYPE: Record<'600' | '800', string> = { '600': 'Split', '800': 'Monobloc' }
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPrix(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return `${Math.round(Number(v)).toLocaleString('fr-FR')} €`
}
/** Montant signé : « +1 234 € » / « −1 234 € ». */
function fmtSigne(v: number): string {
  const r = Math.round(v)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('fr-FR')} €`
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}
function libMois(m: string): string {
  return NOMS_MOIS[Number(m.split('-')[1]) - 1] || m
}
function nonConfirme(m: string): boolean {
  return Number(m.slice(0, 4)) > new Date().getFullYear()
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
function normaliser(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}
const estNouvelleGen = (ref: string) => /^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E|RWM-[0-9.]+R3E|RWD-[0-9.]+RW3E-220S|HWM-W2E|HWD-W2E-220S)$/.test(ref)

/** Catégorie du panneau de droite. */
function categorie(ref: string, a: Article | undefined): string {
  const f = a?.famille || ''
  if (f === '00RORASUE' || f === '00ROH2OUE') return '1. Groupes extérieurs split'
  if (f === '00RORASM') return '2. Groupes monobloc'
  if (['00RORWMUI', '00RORWDUI', '00RORWHUI', '00ROHUI', '00ROH2OUI'].includes(f)) return '3. Modules intérieurs'
  if (f === '00ROECS') return '4. Ballons ECS'
  if (f === '00ACC') return '5. Accessoires'
  return ref.startsWith('RAS') ? '1. Groupes extérieurs split' : '6. Autres'
}
/** Libellé par défaut d'une nouvelle solution créée à partir d'un article. */
function libelleDefaut(ref: string): string {
  if (/^RAS-(8|10)WH/.test(ref)) return 'IVX'
  if (/^RAS-[0-9.]+WHV?NPE$/.test(ref)) return 'Premium'
  if (/^RAS-[0-9.]+WHVRP1$/.test(ref)) return 'Premium R32'
  if (/^RAS-[0-9.]+WHVN$/.test(ref)) return 'S-Combi Lite'
  if (/^HZKF/.test(ref)) return 'AirH2O 400'
  if (/^RASM-.*RW1E$/.test(ref)) return 'Yutaki H'
  if (/^RASM-/.test(ref)) return 'Yutaki M'
  return 'Solution'
}

/** Gamme d'une solution, déduite de ses composants. */
function gammeSolution(sol: Solution): GammeCode {
  const refs = sol.composants.map((c) => c.ref)
  const a = (re: RegExp) => refs.some((r) => re.test(r))
  if (a(/^RAS-[0-9.]+WHV?RP2E$/)) return a(/^RWD-/) ? 'AIRH2O_600_COMBI' : 'AIRH2O_600_S'
  if (a(/^RASM-[0-9.]+V?TW2E$/)) return a(/^HWD-/) ? 'AIRH2O_800_H_COMBI' : 'AIRH2O_800_H'
  if (a(/^HZKF/)) return a(/^HZKF\d+KW/) ? 'AIRH2O_400_COMBI' : 'AIRH2O_400'
  if (a(/^RWH-/)) return 'S80'
  if (a(/^RASM-.*RW1E$/) || a(/^HW[MD]-WE/)) return a(/^HWD-WE/) ? 'YUTAKI_H_COMBI' : 'YUTAKI_H'
  if (a(/^RASM-/)) return 'YUTAKI_M'
  if (a(/^RWD-/)) return 'YUTAKI_S_COMBI'
  if (a(/^RAS-/) || a(/^RWM-/)) return 'YUTAKI_S'
  return 'AUTRE'
}
/** Taille (code Hitachi) du groupe de la solution, ou puissance en kW pour l'AirH2O 400. */
function tailleSolution(sol: Solution, gamme: GammeCode): number | null {
  for (const c of sol.composants) {
    if (gamme === 'AIRH2O_400' || gamme === 'AIRH2O_400_COMBI') {
      const m = /^HZKF(\d+)/.exec(c.ref)
      if (m) return Number(m[1])
    } else if (gamme === 'S80') {
      const m = /^RWH-([0-9.]+)/.exec(c.ref)
      if (m) return Number(m[1])
    } else {
      const m = /^RASM?-([0-9.]+)/.exec(c.ref)
      if (m) return Number(m[1])
    }
  }
  return null
}

/** Dispo immédiate / fin décembre d'un article (repli : libre). */
const dispoImm = (a: Article | undefined) => Math.max(0, n0(a?.dispo_immediate ?? a?.libre))
const dispoDec = (a: Article | undefined) => Math.max(0, n0(a?.dispo_fin_dec ?? a?.dispo_immediate ?? a?.libre))

function calculer(sol: Solution | undefined, articles: Record<string, Article>): Calcul {
  if (!sol || sol.composants.length === 0) return { total: 0, realisable: 0, realisableDec: 0, limitants: new Set(), limitantsDec: new Set(), manquePrix: false }
  let total = 0
  let manquePrix = false
  let realisable = Infinity
  let realisableDec = Infinity
  const parRef = sol.composants.map((c) => {
    const a = articles[c.ref]
    if (a?.prix === null || a?.prix === undefined) manquePrix = true
    const q = Math.max(n0(c.quantite), 1)
    total += n0(a?.prix) * n0(c.quantite)
    const r = Math.floor(dispoImm(a) / q)
    const rd = Math.floor(dispoDec(a) / q)
    realisable = Math.min(realisable, r)
    realisableDec = Math.min(realisableDec, rd)
    return { ref: c.ref, r, rd }
  })
  const plusieurs = sol.composants.length > 1
  const limitants = new Set(plusieurs ? parRef.filter((x) => x.r === realisable).map((x) => x.ref) : [])
  const limitantsDec = new Set(plusieurs ? parRef.filter((x) => x.rd === realisableDec).map((x) => x.ref) : [])
  return {
    total, manquePrix, limitants, limitantsDec,
    realisable: Number.isFinite(realisable) ? realisable : 0,
    realisableDec: Number.isFinite(realisableDec) ? realisableDec : 0,
  }
}

/** Gamme, prime CEE et prix total d'une solution selon l'hypothèse. */
function evaluer(sol: Solution, articles: Record<string, Article>, hyp: HypCee): Evaluation {
  const gamme = gammeSolution(sol)
  const g = GAMMES[gamme]
  const taille = tailleSolution(sol, gamme)
  const total = calculer(sol, articles).total
  if (g.cdp === null) return { gamme, taille, cee: null, cdpOk: false, etasOk: false, total }
  const cdpOk = hyp.cdp && g.cdp
  const etasOk = g.etas(taille)
  const cee = BAREME_CEE[hyp.zone][hyp.menage][cdpOk ? 'oui' : 'non'][etasOk ? 1 : 0][hyp.surface]
  return { gamme, taille, cee, cdpOk, etasOk, total }
}

/**
 * Bilan client d'une solution backup par rapport à la solution catalogue 2026 (en €, > 0 = plus cher pour le client) :
 * écart de prix net (prix public × (1 − remise classique)) + perte de prime CEE − chèque énergie − remise complémentaire.
 */
function bilanClient(bk: Evaluation, ref: Evaluation, hyp: HypCee): Bilan | null {
  if (bk.cee === null || ref.cee === null) return null
  const net = 1 - Math.min(Math.max(hyp.remiseClassique, 0), 90) / 100
  const aides = GAMMES[bk.gamme].aides
  const ecartNet = (bk.total - ref.total) * net
  const remiseSup = aides ? (aides.remiseSup / 100) * bk.total * net : 0
  const cheque = aides?.cheque ?? 0
  const deltaCee = bk.cee - ref.cee
  return { ecartNet, deltaCee, remiseSup, aides: cheque + remiseSup, bilan: ecartNet - deltaCee - cheque - remiseSup }
}

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>
}

const clsDispo = (v: number) => (v <= 0 ? 'bg-red-50 text-red-700' : v < 3 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700')

/** Quantités dispo d'une unité : immédiatement | d'ici fin décembre (une seule pastille si identiques et `fusion`). */
function DispoTag({ a, limitant, limitantDec, fusion }: { a: Article | undefined; limitant?: boolean; limitantDec?: boolean; fusion?: boolean }) {
  const imm = dispoImm(a)
  const dec = dispoDec(a)
  const titre = `Dispo immédiate ${fmtNum(imm)} · dispo d’ici fin décembre ${fmtNum(dec)} · stock ${fmtNum(a?.stock_disponible)}`
    + `${n0(a?.cdc) ? ` · CDC ${fmtNum(a?.cdc)}` : ''}${n0(a?.cdf) ? ` · CDF ${fmtNum(a?.cdf)}` : ''}`
    + `${a?.prochaine_reception_date ? ` · prochaine réception ${fmtDate(a.prochaine_reception_date)}` : ''}${limitant || limitantDec ? ' — composant limitant' : ''}`
  if (fusion && imm === dec) {
    return (
      <span className="inline-flex shrink-0 items-center" title={`${titre} (identique aujourd’hui et fin décembre)`}>
        <span className={`w-[62px] rounded-md px-1 py-0.5 text-center text-[10.5px] font-bold ${clsDispo(imm)} ${limitant || limitantDec ? 'ring-[1.5px] ring-[#B4761A]' : ''}`}>{fmtNum(imm)}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5" title={titre}>
      <span className={`w-[30px] rounded-md px-1 py-0.5 text-center text-[10.5px] font-bold ${clsDispo(imm)} ${limitant ? 'ring-[1.5px] ring-[#B4761A]' : ''}`}>{fmtNum(imm)}</span>
      <span className={`w-[30px] rounded-md px-1 py-0.5 text-center text-[10.5px] font-semibold opacity-80 ${clsDispo(dec)} ${limitantDec ? 'ring-[1.5px] ring-[#B4761A]' : ''}`}>{fmtNum(dec)}</span>
    </span>
  )
}

/** Quantités réalisables d'un bloc (solution complète) ; une seule pastille si identiques et `fusion`. */
function BlocTag({ imm, dec, fusion }: { imm: number; dec: number; fusion?: boolean }) {
  if (fusion && imm === dec) {
    return (
      <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${imm > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}
        title="Solutions complètes réalisables, aujourd’hui comme d’ici fin décembre">
        dispo {fmtNum(imm)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold">
      <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 ${imm > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`} title="Solutions complètes réalisables immédiatement">
        auj. {fmtNum(imm)}
      </span>
      <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 ${dec > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`} title="Solutions complètes réalisables d’ici fin décembre (arrivages compris)">
        fin déc. {fmtNum(dec)}
      </span>
    </span>
  )
}

/** Pastilles d'aides commerciales, posées en surimpression sur le bord haut de la carte. */
function PastillesAides({ gamme }: { gamme: GammeCode }) {
  const aides = GAMMES[gamme].aides
  if (!aides) return null
  return (
    <div className="pointer-events-none absolute -top-2.5 right-7 flex gap-1">
      {aides.remiseSup > 0 && (
        <span className="pointer-events-auto whitespace-nowrap rounded-full border border-sky-300 bg-sky-50 px-1.5 py-[1px] text-[10px] font-bold text-sky-800 shadow-sm"
          title={`${GAMMES[gamme].label} : remise classique + jusqu’à ${aides.remiseSup} % de remise complémentaire (si besoin)`}>
          +{aides.remiseSup} % remise
        </span>
      )}
      {aides.promo && (
        <span className="pointer-events-auto whitespace-nowrap rounded-full border border-violet-300 bg-violet-50 px-1.5 py-[1px] text-[10px] font-bold text-violet-800 shadow-sm"
          title={`${GAMMES[gamme].label} : partir sur le tarif promo`}>
          tarif promo
        </span>
      )}
      {aides.cheque > 0 && (
        <span className="pointer-events-auto whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-[1px] text-[10px] font-bold text-emerald-800 shadow-sm"
          title={`Chèque énergie Hitachi de ${aides.cheque} € pour le client (compensation Hitachi)`}>
          chèque énergie {aides.cheque} €
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function EquivalencesRO() {
  const [donnees, setDonnees] = useState<Donnees | null>(null)
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [articlesExtra, setArticlesExtra] = useState<Record<string, Article>>({})
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const [gammeF, setGammeF] = useState<'' | '600' | '800'>('')
  const [alimF, setAlimF] = useState('')
  const [tailleF, setTailleF] = useState('')
  const [usageF, setUsageF] = useState<'' | Usage>('')
  const [search, setSearch] = useState('')
  const [poolSearch, setPoolSearch] = useState('')
  const [poolAvecStock, setPoolAvecStock] = useState(true)
  const [rechercheArt, setRechercheArt] = useState('')
  const [resultatsArt, setResultatsArt] = useState<(Article & { ref: string })[]>([])
  const [survolZone, setSurvolZone] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)
  const glisse = useRef<Glisse | null>(null)
  // (22/10/2026) Panneau des articles à glisser masqué par défaut, ouvrable
  // uniquement par les administrateurs (can_autorisation) : sans lui, l'écran
  // est en lecture seule (pas de glisser-déposer).
  const { rights } = useAccess()
  const peutEditer = rights.can_autorisation
  const [panneauOuvert, setPanneauOuvert] = useState(false)
  const edition = peutEditer && panneauOuvert

  // Hypothèse CEE (mémorisée dans le navigateur, simple confort)
  const [hyp, setHyp] = useState<HypCee>(HYP_DEFAUT)
  const [syntheseOuverte, setSyntheseOuverte] = useState(true)
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CLE_HYP)
      if (v) setHyp({ ...HYP_DEFAUT, ...(JSON.parse(v) as Partial<HypCee>) })
    } catch { /* stockage indisponible */ }
  }, [])
  function changerHyp(p: Partial<HypCee>) {
    setHyp((h) => {
      const n = { ...h, ...p }
      try { window.localStorage.setItem(CLE_HYP, JSON.stringify(n)) } catch { /* stockage indisponible */ }
      return n
    })
  }

  // En-tête des colonnes collé sous le bandeau de l'appli (qui se masque au défilement)
  const [hautBandeau, setHautBandeau] = useState(0)
  useEffect(() => {
    let raf = 0
    const mesurer = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = document.querySelector('[data-cegeclim-header="true"]')
        const h = el ? Math.max(0, Math.round(el.getBoundingClientRect().bottom)) : 0
        setHautBandeau((v) => (v === h ? v : h))
      })
    }
    mesurer()
    window.addEventListener('scroll', mesurer, { passive: true })
    window.addEventListener('resize', mesurer)
    const t = window.setInterval(mesurer, 500)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', mesurer)
      window.removeEventListener('resize', mesurer)
      window.clearInterval(t)
    }
  }, [])

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_solutions_ro')
    if (error) { setErreur(messageErreur(error)); setDonnees(null) }
    else {
      const d = data as Donnees
      setDonnees(d)
      setSolutions((d.solutions || []).map((s) => ({ ...s, composants: s.composants || [] })))
      setArticlesExtra({})
    }
    setLoading(false)
  }, [])
  useEffect(() => { void charger() }, [charger])

  /** Rechargement rapide des seules solutions après une modification. */
  const rechargerSolutions = useCallback(async () => {
    const { data, error } = await supabase.from('stock_solutions')
      .select('id,ref_cible,usage,role,libelle,rang,origine,commentaire,created_by_email,updated_by_email,stock_solution_composants(id,ref_article,quantite,rang)')
      .eq('groupe', 'RO_AIRH2O')
    if (error) { setErreur(messageErreur(error)); return }
    setSolutions(((data || []) as unknown as RawSolution[]).map((s) => ({
      id: s.id, ref_cible: s.ref_cible, usage: s.usage, role: s.role, libelle: s.libelle, rang: Number(s.rang),
      origine: s.origine, commentaire: s.commentaire, modifie_par: s.updated_by_email || s.created_by_email,
      composants: (s.stock_solution_composants || []).map((c) => ({ id: c.id, ref: c.ref_article, quantite: Number(c.quantite), rang: Number(c.rang) }))
        .sort((a, b) => a.rang - b.rang),
    })))
  }, [])

  // Recherche dans toute la base SAGE
  useEffect(() => {
    const q = rechercheArt.trim()
    if (q.length < 2) { setResultatsArt([]); return }
    let annule = false
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('rechercher_article_equivalence', { p_q: q })
      if (annule) return
      if (error) { setErreur(messageErreur(error)); return }
      setResultatsArt(((data || []) as { ref: string; designation: string | null; famille: string | null; prix: number | null; stock_disponible: number | null }[])
        .map((r) => ({ ref: r.ref, designation: r.designation, famille: r.famille, prix: r.prix, stock_disponible: r.stock_disponible, libre: Math.max(0, n0(r.stock_disponible)), dispo_immediate: Math.max(0, n0(r.stock_disponible)), dispo_fin_dec: Math.max(0, n0(r.stock_disponible)) })))
    }, 300)
    return () => { annule = true; clearTimeout(t) }
  }, [rechercheArt])

  const articles = useMemo(() => ({ ...articlesExtra, ...(donnees?.articles ?? {}) }), [donnees, articlesExtra])
  const cibles = useMemo(() => (donnees?.cibles ?? []).filter((c) => !tailleMasquee(c.taille)), [donnees])

  const parUsage = useMemo(() => {
    const m = new Map<string, { actuelle?: Solution; backups: Solution[] }>()
    solutions.forEach((s) => {
      const k = `${s.ref_cible}|${s.usage}`
      const e = m.get(k) || { backups: [] }
      if (s.role === 'actuelle') e.actuelle = s
      else e.backups.push(s)
      m.set(k, e)
    })
    m.forEach((e) => e.backups.sort((a, b) => a.rang - b.rang || a.id.localeCompare(b.id)))
    return m
  }, [solutions])

  /** Nombre de solutions qui utilisent chaque référence (stock partagé). */
  const partages = useMemo(() => {
    const m = new Map<string, number>()
    solutions.forEach((s) => s.composants.forEach((c) => m.set(c.ref, (m.get(c.ref) || 0) + 1)))
    return m
  }, [solutions])

  const tailles = useMemo(() => {
    const s = normaliser(search.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = cibles.filter((c) => {
      if (gammeF && c.gamme !== gammeF) return false
      if (alimF && c.alim !== alimF) return false
      if (tailleF && c.taille !== tailleF) return false
      if (usageF && USAGES[usageF].gamme !== c.gamme) return false
      if (termes.length) {
        const comps = solutions.filter((x) => x.ref_cible === c.ref).flatMap((x) => [x.libelle || '', ...x.composants.map((k) => k.ref)]).join(' ')
        if (!termes.every((t) => normaliser(`${c.ref} ${c.designation} ${comps}`).includes(t))) return false
      }
      return true
    })
    const m = new Map<string, Cible[]>()
    list.forEach((c) => { const a = m.get(c.taille) || []; a.push(c); m.set(c.taille, a) })
    return Array.from(m.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([taille, rows]) => ({ taille, rows: rows.sort((a, b) => rangAlim(a.alim) - rangAlim(b.alim) || a.alim.localeCompare(b.alim) || a.gamme.localeCompare(b.gamme)) }))
  }, [cibles, gammeF, alimF, tailleF, usageF, search, solutions])

  const listeTailles = useMemo(() => Array.from(new Set(cibles.map((c) => c.taille))).sort((a, b) => Number(a) - Number(b)), [cibles])
  const alims = useMemo(() => Array.from(new Set(cibles.map((c) => c.alim))).sort(), [cibles])

  /** Couples (backup, catalogue 2026) affichés, pour la synthèse CEE / aides. */
  const comparaisons = useMemo(() => {
    const out: { cible: Cible; usage: Usage; bk: Evaluation; ref: Evaluation; bilan: Bilan; sol: Solution }[] = []
    tailles.forEach(({ rows }) => rows.forEach((c) => {
      (c.gamme === '600' ? USAGES_600 : USAGES_800).filter((u) => !usageF || u === usageF).forEach((u) => {
        const z = parUsage.get(`${c.ref}|${u}`)
        if (!z?.actuelle || !z.actuelle.composants.length) return
        const ref = evaluer(z.actuelle, articles, hyp)
        z.backups.forEach((s) => {
          if (!s.composants.length) return
          const bk = evaluer(s, articles, hyp)
          const bilan = bilanClient(bk, ref, hyp)
          if (bilan) out.push({ cible: c, usage: u, bk, ref, bilan, sol: s })
        })
      })
    }))
    return out
  }, [tailles, usageF, parUsage, articles, hyp])

  const synthese = useMemo(() => {
    const moy = (l: typeof comparaisons) => {
      const n = l.length || 1
      return {
        nb: l.length,
        ecartNet: l.reduce((s, x) => s + x.bilan.ecartNet, 0) / n,
        deltaCee: l.reduce((s, x) => s + x.bilan.deltaCee, 0) / n,
        cheque: l.reduce((s, x) => s + (GAMMES[x.bk.gamme].aides?.cheque ?? 0), 0) / n,
        remiseSup: l.reduce((s, x) => s + x.bilan.remiseSup, 0) / n,
        bilan: l.reduce((s, x) => s + x.bilan.bilan, 0) / n,
        couverts: l.filter((x) => x.bilan.bilan <= 0).length,
      }
    }
    const parGamme = new Map<GammeCode, typeof comparaisons>()
    comparaisons.forEach((x) => { const a = parGamme.get(x.bk.gamme) || []; a.push(x); parGamme.set(x.bk.gamme, a) })
    return {
      total: moy(comparaisons),
      gammes: Array.from(parGamme.entries()).sort((a, b) => b[1].length - a[1].length).map(([g, l]) => ({ g, ...moy(l) })),
    }
  }, [comparaisons])

  const poolListe = useMemo(() => {
    const s = normaliser(poolSearch.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = Object.entries(donnees?.articles ?? {}).filter(([ref, a]) => {
      if (!a.pool || a.sommeil) return false
      if (poolAvecStock && dispoImm(a) <= 0 && dispoDec(a) <= 0 && n0(a.stock_disponible) <= 0) return false
      if (termes.length && !termes.every((t) => normaliser(`${ref} ${a.designation}`).includes(t))) return false
      return true
    })
    const m = new Map<string, [string, Article][]>()
    list.forEach(([ref, a]) => { const k = categorie(ref, a); const x = m.get(k) || []; x.push([ref, a]); m.set(k, x) })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, rows]) => ({ k: k.replace(/^\d\.\s/, ''), rows: rows.sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true })) }))
  }, [donnees, poolSearch, poolAvecStock])

  // ── Écritures ──────────────────────────────────────────────────────────
  async function executer(fn: () => Promise<void>) {
    setEnCours(true); setErreur(null)
    try { await fn() } catch (e) { setErreur(messageErreur(e)) }
    await rechargerSolutions()
    setEnCours(false)
  }
  function verifier(error: unknown) { if (error) throw error }

  async function creerSolution(ref_cible: string, usage: Usage, role: Role, refs: { ref: string; quantite: number }[], libelle: string | null, commentaire: string | null = null) {
    const existantes = parUsage.get(`${ref_cible}|${usage}`)
    const rang = role === 'actuelle' ? 0 : (existantes?.backups.length ? Math.max(...existantes.backups.map((b) => b.rang)) + 1 : 1)
    const { data, error } = await supabase.from('stock_solutions')
      .insert({ groupe: 'RO_AIRH2O', ref_cible, usage, role, libelle, rang, origine: 'manuel', commentaire }).select('id').single()
    verifier(error)
    if (refs.length && data) {
      const { error: e2 } = await supabase.from('stock_solution_composants')
        .insert(refs.map((r, i) => ({ solution_id: data.id as string, ref_article: r.ref, quantite: r.quantite, rang: i + 1 })))
      verifier(e2)
    }
  }

  function memoriserArticle(ref: string) {
    if (articles[ref]) return
    const r = resultatsArt.find((x) => x.ref === ref)
    if (r) setArticlesExtra((p) => ({ ...p, [ref]: { designation: r.designation, famille: r.famille, prix: r.prix, stock_disponible: r.stock_disponible, libre: r.libre, dispo_immediate: r.dispo_immediate, dispo_fin_dec: r.dispo_fin_dec } }))
  }

  async function ajouterComposant(sol: Solution, ref: string) {
    if (sol.composants.some((c) => c.ref === ref)) { setInfo(`${ref} est déjà dans cette solution — modifier la quantité si besoin.`); return }
    memoriserArticle(ref)
    await executer(async () => {
      const rang = sol.composants.length ? Math.max(...sol.composants.map((c) => c.rang)) + 1 : 1
      const { error } = await supabase.from('stock_solution_composants').insert({ solution_id: sol.id, ref_article: ref, quantite: 1, rang })
      verifier(error)
      if (sol.origine === 'auto') await supabase.from('stock_solutions').update({ origine: 'manuel' }).eq('id', sol.id)
    })
  }

  async function deplacerComposant(compId: string, ref: string, depuis: string, vers: Solution, copier: boolean) {
    if (depuis === vers.id) return
    await executer(async () => {
      const deja = vers.composants.some((c) => c.ref === ref)
      const rang = vers.composants.length ? Math.max(...vers.composants.map((c) => c.rang)) + 1 : 1
      if (copier) {
        if (!deja) verifier((await supabase.from('stock_solution_composants').insert({ solution_id: vers.id, ref_article: ref, quantite: 1, rang })).error)
      } else if (deja) {
        verifier((await supabase.from('stock_solution_composants').delete().eq('id', compId)).error)
      } else {
        verifier((await supabase.from('stock_solution_composants').update({ solution_id: vers.id, rang }).eq('id', compId)).error)
      }
    })
  }

  async function deplacerSolution(solId: string, ref_cible: string, usage: Usage, copier: boolean, avantId?: string) {
    const sol = solutions.find((s) => s.id === solId)
    if (!sol) return
    const zone = parUsage.get(`${ref_cible}|${usage}`)
    const memeZone = sol.ref_cible === ref_cible && sol.usage === usage
    await executer(async () => {
      if (memeZone && sol.role === 'backup') {
        if (!avantId || avantId === solId) return
        const ordre = (zone?.backups || []).map((b) => b.id).filter((x) => x !== solId)
        const pos = ordre.indexOf(avantId)
        ordre.splice(pos >= 0 ? pos : ordre.length, 0, solId)
        for (let i = 0; i < ordre.length; i += 1) verifier((await supabase.from('stock_solutions').update({ rang: i + 1 }).eq('id', ordre[i])).error)
        return
      }
      if (copier || sol.role === 'actuelle') {
        await creerSolution(ref_cible, usage, 'backup', sol.composants.map((c) => ({ ref: c.ref, quantite: c.quantite })), sol.libelle, sol.commentaire)
        return
      }
      const rang = zone?.backups.length ? Math.max(...zone.backups.map((b) => b.rang)) + 1 : 1
      verifier((await supabase.from('stock_solutions').update({ ref_cible, usage, rang, origine: 'manuel' }).eq('id', solId)).error)
    })
  }

  async function supprimerSolution(sol: Solution) {
    if (sol.role === 'actuelle' && !window.confirm('Supprimer la solution AirH2O de cet usage ?')) return
    await executer(async () => { verifier((await supabase.from('stock_solutions').delete().eq('id', sol.id)).error) })
  }
  async function retirerComposant(compId: string) {
    await executer(async () => { verifier((await supabase.from('stock_solution_composants').delete().eq('id', compId)).error) })
  }
  async function changerQuantite(compId: string, q: number) {
    if (!Number.isFinite(q) || q <= 0) return
    await executer(async () => { verifier((await supabase.from('stock_solution_composants').update({ quantite: q }).eq('id', compId)).error) })
  }
  async function renommer(sol: Solution, libelle: string) {
    if ((sol.libelle || '') === libelle.trim()) return
    await executer(async () => { verifier((await supabase.from('stock_solutions').update({ libelle: libelle.trim() || null, origine: 'manuel' }).eq('id', sol.id)).error) })
  }

  // ── Glisser-déposer ────────────────────────────────────────────────────
  function debut(e: React.DragEvent, g: Glisse) {
    glisse.current = g
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', g.type === 'solution' ? g.id : g.ref)
    e.stopPropagation()
  }
  function fin() { glisse.current = null; setSurvolZone(null) }
  function survol(e: React.DragEvent, zone: string) {
    if (!glisse.current) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = glisse.current.type === 'article' || e.ctrlKey || e.altKey ? 'copy' : 'move'
    if (survolZone !== zone) setSurvolZone(zone)
  }
  /** Dépôt sur une carte solution. */
  function deposerSurSolution(e: React.DragEvent, sol: Solution) {
    e.preventDefault(); e.stopPropagation()
    const g = glisse.current; fin()
    if (!g || enCours) return
    const copier = e.ctrlKey || e.altKey
    if (g.type === 'article') void ajouterComposant(sol, g.ref)
    else if (g.type === 'composant') void deplacerComposant(g.id, g.ref, g.solutionId, sol, copier)
    else if (sol.role === 'backup') void deplacerSolution(g.id, sol.ref_cible, sol.usage, copier, sol.id)
  }
  /** Dépôt sur la zone d'un usage (hors carte). */
  function deposerSurZone(e: React.DragEvent, ref_cible: string, usage: Usage, role: Role) {
    e.preventDefault(); e.stopPropagation()
    const g = glisse.current; fin()
    if (!g || enCours) return
    const copier = e.ctrlKey || e.altKey
    if (g.type === 'article') {
      memoriserArticle(g.ref)
      void executer(() => creerSolution(ref_cible, usage, role, [{ ref: g.ref, quantite: 1 }], role === 'actuelle' ? `AirH2O ${USAGES[usage].label}` : libelleDefaut(g.ref)))
    } else if (g.type === 'solution') void deplacerSolution(g.id, ref_cible, usage, copier)
    else setInfo('Déposer un composant sur une solution existante, ou un article du panneau sur la zone vide pour créer une solution.')
  }

  // ── Export Excel ───────────────────────────────────────────────────────
  const libHyp = `CEE ${hyp.zone}, ménage ${hyp.menage === 'classique' ? 'classique' : 'précaire'}, ${SURFACES[hyp.surface]}, Coup de pouce ${hyp.cdp ? 'oui (remplacement chaudière fossile)' : 'non'}, remise classique moyenne ${fmtNum(hyp.remiseClassique)} %`
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Solutions R-O')
      ws.addRow([`Équivalences R/O AirH2O 600 / 800 — solutions par usage — calculé le ${new Date().toLocaleString('fr-FR')} — dispo = promettable (stock + CDF − CDC), immédiatement / d’ici fin décembre — ${libHyp}`]).font = { bold: true }
      ws.addRow(['Taille', 'Gamme', 'Alim.', 'Groupe AirH2O', 'Usage', 'Rôle', 'Solution', 'Gamme (CEE)', 'Composants (réf. × qté · prix · dispo auj. / fin déc.)', 'Prix public total', 'Réalisables auj.', 'Réalisables fin déc.', 'Composant(s) limitant(s)',
        'Écart prix public vs catalogue (€)', 'Écart (%)', 'Prime CEE (€)', 'Écart CEE vs catalogue (€)', 'Chèque énergie (€)', 'Remise complémentaire max (%)', 'Remise complémentaire (€)', 'Bilan client vs catalogue (€)', 'Commentaire']).font = { bold: true }
      tailles.forEach(({ taille, rows }) => rows.forEach((c) => {
        (c.gamme === '600' ? USAGES_600 : USAGES_800).filter((u) => !usageF || u === usageF).forEach((u) => {
          const z = parUsage.get(`${c.ref}|${u}`)
          const refK = calculer(z?.actuelle, articles)
          const refE = z?.actuelle ? evaluer(z.actuelle, articles, hyp) : null
          const lignes = [...(z?.actuelle ? [z.actuelle] : []), ...(z?.backups || [])]
          lignes.forEach((s) => {
            const k = calculer(s, articles)
            const e = evaluer(s, articles, hyp)
            const ecart = s.role === 'backup' && z?.actuelle ? k.total - refK.total : null
            const b = s.role === 'backup' && refE ? bilanClient(e, refE, hyp) : null
            const aides = GAMMES[e.gamme].aides
            ws.addRow([taille, c.gamme, c.alim, c.ref, USAGES[u].label, s.role === 'actuelle' ? 'Catalogue 2026' : 'Backup', s.libelle || '', GAMMES[e.gamme].label,
              s.composants.map((x) => `${x.ref}${x.quantite !== 1 ? ` ×${x.quantite}` : ''} · ${fmtPrix(articles[x.ref]?.prix)} · ${fmtNum(dispoImm(articles[x.ref]))} / ${fmtNum(dispoDec(articles[x.ref]))}`).join('\n'),
              Math.round(k.total), k.realisable, k.realisableDec, Array.from(new Set([...k.limitants, ...k.limitantsDec])).join(', '),
              ecart === null ? '' : Math.round(ecart), ecart === null || !refK.total ? '' : Math.round((ecart / refK.total) * 100),
              e.cee ?? '', b ? Math.round(b.deltaCee) : '', s.role === 'backup' && aides ? aides.cheque : '', s.role === 'backup' && aides ? aides.remiseSup : '',
              b ? Math.round(b.remiseSup) : '', b ? Math.round(b.bilan) : '', s.commentaire || ''])
          })
        })
      }))
      ws.getColumn(4).width = 18; ws.getColumn(5).width = 20; ws.getColumn(7).width = 16; ws.getColumn(8).width = 18; ws.getColumn(9).width = 60
      ws.getColumn(9).alignment = { wrapText: true, vertical: 'top' }
      ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 2 }]
      const ws2 = wb.addWorksheet('Synthèse CEE et aides')
      ws2.addRow([`Écart moyen backup vs catalogue 2026 — ${libHyp}`]).font = { bold: true }
      ws2.addRow(['Gamme backup', 'Nb solutions', 'Écart prix net moyen (€)', 'Écart CEE moyen (€)', 'Chèque énergie (€)', 'Remise complémentaire moyenne (€)', 'Bilan client moyen (€)', 'Solutions couvertes (bilan ≤ 0)']).font = { bold: true }
      ;[...synthese.gammes.map((x) => ({ lib: GAMMES[x.g].label, ...x })), { lib: 'Toutes', ...synthese.total }].forEach((x) => {
        ws2.addRow([x.lib, x.nb, Math.round(x.ecartNet), Math.round(x.deltaCee), Math.round(x.cheque), Math.round(x.remiseSup), Math.round(x.bilan), x.couverts])
      })
      ws2.getColumn(1).width = 22
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url
      a.download = `solutions_RO_airh2o_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  // ── Rendu d'une solution ───────────────────────────────────────────────
  function CarteSolution({ sol, refSol }: { sol: Solution; refSol: Solution | null }) {
    const k = calculer(sol, articles)
    const backup = sol.role === 'backup'
    const ev = evaluer(sol, articles, hyp)
    const refEv = refSol && refSol.composants.length ? evaluer(refSol, articles, hyp) : null
    const ecart = backup && refEv ? k.total - refEv.total : null
    const b = backup && refEv && sol.composants.length ? bilanClient(ev, refEv, hyp) : null
    const zone = `sol:${sol.id}`
    const actif = survolZone === zone
    const g = GAMMES[ev.gamme]
    return (
      <div draggable={edition} onDragStart={(e) => debut(e, { type: 'solution', id: sol.id, ref_cible: sol.ref_cible, usage: sol.usage, role: sol.role })} onDragEnd={fin}
        onDragOver={(e) => survol(e, zone)} onDrop={(e) => deposerSurSolution(e, sol)}
        className={`relative w-[340px] shrink-0 rounded-lg border px-2 py-1.5 ${edition ? 'cursor-grab active:cursor-grabbing' : ''} ${actif ? 'ring-2 ring-[#B4761A]' : ''} ${!backup ? 'border-[#E2CFA6] bg-[#F7EEDB]' : k.realisableDec > 0 ? 'border-[#CFE3C7] bg-white' : 'border-red-200 bg-red-50/40'}`}>
        {backup && <PastillesAides gamme={ev.gamme} />}
        <div className="flex items-center justify-between gap-1">
          <input defaultValue={sol.libelle || ''} key={`${sol.id}-${sol.libelle}`} placeholder="Nom de la solution" readOnly={!edition}
            onBlur={(e) => { if (edition) void renommer(sol, e.target.value) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-0.5 text-[11.5px] font-bold text-[#5E5A50] ${edition ? 'hover:border-[#E5E1D8] focus:border-[#B4761A]' : 'cursor-default'} focus:outline-none`} />
          {sol.origine === 'auto' && <Badge cls="bg-[#EDEAE1] text-[#8A8474]" title="Pré-rempli automatiquement — à valider">auto</Badge>}
          {edition && (
            <button type="button" onClick={() => void supprimerSolution(sol)} disabled={enCours} aria-label="Supprimer la solution"
              className="h-5 w-5 shrink-0 rounded text-[12px] font-bold text-[#8A8474] hover:bg-red-50 hover:text-red-700">×</button>
          )}
        </div>
        {sol.commentaire && <div className="text-[10.5px] font-semibold text-[#8A5A08]">{sol.commentaire}</div>}
        <div className="mt-0.5 space-y-0.5">
          {sol.composants.map((c) => {
            const a = articles[c.ref]
            const nb = partages.get(c.ref) || 0
            return (
              <div key={c.id} draggable={edition} onDragStart={(e) => debut(e, { type: 'composant', id: c.id, ref: c.ref, solutionId: sol.id })} onDragEnd={fin}
                className="group flex items-center justify-between gap-1 rounded px-0.5 hover:bg-[#FAF8F3]" title={a?.designation || ''}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[11.5px]">
                    <span className="truncate font-bold">{c.ref}</span>
                    {nb > 1 && <Badge cls="bg-violet-50 text-violet-800" title={`Référence utilisée dans ${nb} solutions : stock partagé`}>×{nb}</Badge>}
                  </div>
                  <div className="truncate text-[10px] text-[#8A8474]">{a?.designation || '—'}</div>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-[#3A362E]">{fmtPrix(a?.prix)}</span>
                {edition ? (
                  <input type="number" min={1} step={1} defaultValue={c.quantite} key={`${c.id}-${c.quantite}`} title="Quantité"
                    onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => { const q = Number(e.target.value); if (q !== c.quantite) void changerQuantite(c.id, q) }}
                    className={`h-5 w-8 shrink-0 rounded border border-[#E5E1D8] px-0.5 text-right text-[10.5px] ${c.quantite === 1 ? 'text-[#C9C4B8]' : 'font-bold'}`} />
                ) : c.quantite !== 1 ? <span className="shrink-0 text-[10.5px] font-bold">×{fmtNum(c.quantite)}</span> : null}
                <DispoTag a={a} limitant={k.limitants.has(c.ref)} limitantDec={k.limitantsDec.has(c.ref)} fusion={backup} />
                {edition && (
                  <button type="button" onClick={() => void retirerComposant(c.id)} disabled={enCours} aria-label={`Retirer ${c.ref}`}
                    className="h-5 w-4 shrink-0 text-[12px] font-bold text-[#C9C4B8] hover:text-red-700">×</button>
                )}
              </div>
            )
          })}
          {sol.composants.length === 0 && <div className="py-1 text-[11px] italic text-[#C9C4B8]">Déposer des articles ici</div>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-1 border-t border-dashed border-[#E5E1D8] pt-1 text-[11.5px]">
          <span>
            <b>{fmtPrix(k.total)}</b>{k.manquePrix && <span className="text-[#8A5A08]" title="Un composant n’a pas de prix public dans SAGE"> *</span>}
            {ecart !== null && refEv && (
              <b className={`ml-1.5 ${ecart <= 0 ? 'text-[#3F9142]' : 'text-[#B4761A]'}`}>
                {fmtSigne(ecart)}{refEv.total ? ` (${ecart <= 0 ? '−' : '+'}${Math.round((Math.abs(ecart) / refEv.total) * 100)} %)` : ''}
              </b>
            )}
          </span>
          <BlocTag imm={k.realisable} dec={k.realisableDec} fusion={backup} />
        </div>
        {sol.composants.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
            <span className="text-[#5E5A50]"
              title={ev.cee === null ? 'Gamme non reconnue : prime CEE non calculée'
                : `${g.label} — Coup de pouce chauffage : ${g.cdp ? 'éligible' : 'non éligible'}${hyp.cdp ? '' : ' (non retenu dans l’hypothèse)'} · ETAS ≥ 140 % à 55 °C : ${g.etasNote} → ${ev.etasOk ? 'oui' : 'non'}`}>
              CEE <b className="text-[#111820]">{ev.cee === null ? '—' : fmtPrix(ev.cee)}</b>
              <span className="text-[#8A8474]"> · {g.label}{ev.cee !== null && <>{ev.cdpOk ? ' · CdP' : ''}{ev.etasOk ? ' · ETAS ≥ 140' : ''}</>}</span>
              {b && <b className={`ml-1 ${b.deltaCee < 0 ? 'text-[#B42318]' : 'text-[#3F9142]'}`}>{fmtSigne(b.deltaCee)}</b>}
            </span>
            {b && (
              <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${b.bilan <= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}
                title={`Bilan client vs catalogue 2026 = écart de prix net ${fmtSigne(b.ecartNet)} + perte de prime CEE ${fmtSigne(-b.deltaCee)} − chèque énergie ${fmtPrix(GAMMES[ev.gamme].aides?.cheque ?? 0)} − remise complémentaire ${fmtPrix(b.remiseSup)}${GAMMES[ev.gamme].aides?.promo ? ' (tarif promo non chiffré)' : ''} · remise classique moyenne ${fmtNum(hyp.remiseClassique)} %`}>
                bilan client {fmtSigne(b.bilan)}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const segBtn = (actif: boolean) => `rounded-md px-3 py-1.5 ${actif ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474] hover:text-[#3A362E]'}`
  const T = synthese.total

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* Bandeau */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-[20px] font-bold leading-tight tracking-tight">Équivalences R/O — AirH2O 600 / 800</h1>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12.5px] font-bold text-emerald-800">
                Tailles &lt; 3,5 non concernées par la pénurie de ventilateurs : dispo normale
              </span>
            </div>
            <p className="text-[11.5px] text-[#8A8474]">
              Tailles 3,5 à 6 : en face de chaque solution catalogue 2026, les solutions d’anciennes générations en stock, leurs aides client et leur prime CEE
              {donnees?.calcule_le && <> · calculé à {new Date(donnees.calcule_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enCours && <span className="text-[12px] font-semibold text-[#8A8474]">Enregistrement…</span>}
            {peutEditer && (
              <button type="button" onClick={() => setPanneauOuvert((v) => !v)} aria-pressed={panneauOuvert}
                title="Afficher la colonne des articles R/O à glisser dans les solutions (administrateurs)"
                className={`h-10 rounded-lg border px-3 text-[13px] font-bold ${panneauOuvert ? 'border-[#B4761A] bg-[#FBF5EA] text-[#8A5A08]' : 'border-[#E5E1D8] bg-white text-[#3A362E]'}`}>
                {panneauOuvert ? '✕ Masquer les articles' : '✎ Articles à glisser'}
              </button>
            )}
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || cibles.length === 0}
              className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">{exportEnCours ? 'Export…' : '⬇ Excel'}</button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recalculer les stocks" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            <span>{erreur}{/get_solutions_ro|stock_solution/.test(erreur) ? ' — la migration 20261021c_solutions_ro.sql est-elle appliquée ?' : ''}</span>
            <button type="button" onClick={() => setErreur(null)} className="font-bold">✕</button>
          </div>
        )}
        {info && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 py-2 text-[12.5px] text-[#3A362E]">
            <span>{info}</span><button type="button" onClick={() => setInfo(null)} className="font-bold text-[#8A8474]">✕</button>
          </div>
        )}

        {/* Filtres */}
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
            <button type="button" onClick={() => setGammeF('')} className={segBtn(gammeF === '')}>600 + 800</button>
            <button type="button" onClick={() => setGammeF('600')} className={segBtn(gammeF === '600')}>AirH2O 600 (split)</button>
            <button type="button" onClick={() => setGammeF('800')} className={segBtn(gammeF === '800')}>AirH2O 800 (monobloc)</button>
          </div>
          <select value={tailleF} onChange={(e) => setTailleF(e.target.value)} className={`${ctl} ${tailleF ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
            <option value="">Taille : toutes</option>
            {listeTailles.map((t) => <option key={t} value={t}>Taille {t.replace('.', ',')}</option>)}
          </select>
          <select value={usageF} onChange={(e) => setUsageF(e.target.value as '' | Usage)} className={`${ctl} ${usageF ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
            <option value="">Usage : tous</option>
            {(Object.keys(USAGES) as Usage[]).map((u) => <option key={u} value={u}>{USAGES[u].label} ({USAGES[u].gamme})</option>)}
          </select>
          <select value={alimF} onChange={(e) => setAlimF(e.target.value)} className={ctl}>
            <option value="">Alimentation : toutes</option>
            {alims.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, composant, solution…" className={`${ctl} w-[260px] font-medium`} />
          <span className="ml-auto text-[11px] text-[#8A8474]">
            Dispo : <b className="text-emerald-700">auj.</b> | <b className="text-emerald-700 opacity-80">fin déc.</b> (une seule pastille si identique) · encadré ocre = composant limitant{edition && <> · <b>Ctrl</b> / <b>Alt</b> en glissant = copier</>}
          </span>
        </section>

        {/* Synthèse primes CEE et aides */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={() => setSyntheseOuverte((v) => !v)} className="text-[13px] font-bold text-[#111820]">
              {syntheseOuverte ? '▾' : '▸'} Primes CEE et aides : écart moyen backup vs catalogue 2026
            </button>
            {!loading && T.nb > 0 && (
              <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <span className="rounded-md bg-red-50 px-2 py-0.5 font-bold text-red-700" title="Écart moyen de prime CEE (backup − catalogue 2026)">CEE {fmtSigne(T.deltaCee)}</span>
                <span className="text-[#8A8474]">compensé par</span>
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800" title="Chèque énergie Hitachi moyen">chèque {fmtPrix(T.cheque)}</span>
                <span className="text-[#8A8474]">+</span>
                <span className="rounded-md bg-sky-50 px-2 py-0.5 font-bold text-sky-800" title="Remise complémentaire moyenne (jusqu’à 10 % selon la gamme)">remise {fmtPrix(T.remiseSup)}</span>
                <span className="text-[#8A8474]">et l’écart de prix net</span>
                <span className="rounded-md bg-[#F4F3F0] px-2 py-0.5 font-bold">{fmtSigne(T.ecartNet)}</span>
                <span className="text-[#8A8474]">→ bilan client moyen</span>
                <span className={`rounded-md px-2 py-0.5 font-bold ${T.bilan <= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{fmtSigne(T.bilan)}</span>
                <span className="text-[#8A8474]">({fmtNum(T.couverts)} / {fmtNum(T.nb)} solutions couvertes)</span>
              </span>
            )}
          </div>
          {syntheseOuverte && (
            <div className="mt-2 grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-[11px] uppercase tracking-wide text-[#8A8474]">
                    <tr className="border-b border-[#E5E1D8]">
                      <th className="px-2 py-1 text-left font-bold">Gamme backup</th>
                      <th className="px-2 py-1 text-right font-bold">Solutions</th>
                      <th className="px-2 py-1 text-left font-bold">Aides client</th>
                      <th className="px-2 py-1 text-right font-bold" title="Écart moyen de prix net (prix public × (1 − remise classique))">Écart prix net</th>
                      <th className="px-2 py-1 text-right font-bold">Écart CEE</th>
                      <th className="px-2 py-1 text-right font-bold">Chèque</th>
                      <th className="px-2 py-1 text-right font-bold">Remise compl.</th>
                      <th className="px-2 py-1 text-right font-bold" title="Écart de prix net + perte de prime CEE − chèque − remise complémentaire : ≤ 0 = le client n’y perd pas">Bilan client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {synthese.gammes.map((x) => {
                      const a = GAMMES[x.g].aides
                      return (
                        <tr key={x.g} className="border-b border-[#F0EDE6]">
                          <td className="px-2 py-1 font-bold">{GAMMES[x.g].label}</td>
                          <td className="px-2 py-1 text-right">{fmtNum(x.nb)}</td>
                          <td className="px-2 py-1 text-[11px] text-[#5E5A50]">
                            {a ? [a.remiseSup ? `+${a.remiseSup} % remise` : 'remise classique', a.promo ? 'tarif promo' : null, `chèque ${a.cheque} €`].filter(Boolean).join(' · ') : '—'}
                          </td>
                          <td className="px-2 py-1 text-right">{fmtSigne(x.ecartNet)}</td>
                          <td className={`px-2 py-1 text-right font-bold ${x.deltaCee < 0 ? 'text-[#B42318]' : 'text-[#3F9142]'}`}>{fmtSigne(x.deltaCee)}</td>
                          <td className="px-2 py-1 text-right text-emerald-800">{fmtPrix(x.cheque)}</td>
                          <td className="px-2 py-1 text-right text-sky-800">{fmtPrix(x.remiseSup)}</td>
                          <td className="px-2 py-1 text-right">
                            <span className={`rounded-md px-1.5 py-0.5 font-bold ${x.bilan <= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{fmtSigne(x.bilan)}</span>
                          </td>
                        </tr>
                      )
                    })}
                    {T.nb > 0 && (
                      <tr className="border-t-2 border-[#E5E1D8] font-bold">
                        <td className="px-2 py-1">Toutes les solutions affichées</td>
                        <td className="px-2 py-1 text-right">{fmtNum(T.nb)}</td>
                        <td />
                        <td className="px-2 py-1 text-right">{fmtSigne(T.ecartNet)}</td>
                        <td className={`px-2 py-1 text-right ${T.deltaCee < 0 ? 'text-[#B42318]' : 'text-[#3F9142]'}`}>{fmtSigne(T.deltaCee)}</td>
                        <td className="px-2 py-1 text-right text-emerald-800">{fmtPrix(T.cheque)}</td>
                        <td className="px-2 py-1 text-right text-sky-800">{fmtPrix(T.remiseSup)}</td>
                        <td className="px-2 py-1 text-right">
                          <span className={`rounded-md px-1.5 py-0.5 ${T.bilan <= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{fmtSigne(T.bilan)}</span>
                        </td>
                      </tr>
                    )}
                    {!loading && T.nb === 0 && (
                      <tr><td colSpan={8} className="px-2 py-3 text-center text-[#8A8474]">Aucune solution backup comparable avec ces filtres.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border border-[#E5E1D8] bg-[#FAF8F3] px-3 py-2 text-[12px]">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Hypothèse CEE (barèmes DRAPO S2 2026 — maisons)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] text-[#8A8474]">Zone</span>
                    <select value={hyp.zone} onChange={(e) => changerHyp({ zone: e.target.value as Zone })} className={ctl}>
                      <option value="H2">H2 (Nouvelle-Aquitaine sauf 19, 23, 87)</option>
                      <option value="H1">H1</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] text-[#8A8474]">Ménage</span>
                    <select value={hyp.menage} onChange={(e) => changerHyp({ menage: e.target.value as Menage })} className={ctl}>
                      <option value="classique">Classique (modestes, intermédiaires…)</option>
                      <option value="precaire">Précaire (très modestes MPR)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] text-[#8A8474]">Surface du logement</span>
                    <select value={hyp.surface} onChange={(e) => changerHyp({ surface: Number(e.target.value) as Surface })} className={ctl}>
                      {SURFACES.map((s, i) => <option key={s} value={i}>{s}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] text-[#8A8474]">Coup de pouce chauffage</span>
                    <select value={hyp.cdp ? 'oui' : 'non'} onChange={(e) => changerHyp({ cdp: e.target.value === 'oui' })} className={ctl}>
                      <option value="oui">Oui : remplacement chaudière gaz / fioul / charbon</option>
                      <option value="non">Non</option>
                    </select>
                  </label>
                  <label className="col-span-2 flex items-center gap-2">
                    <span className="text-[10.5px] text-[#8A8474]">Remise classique moyenne (pour chiffrer prix nets et +10 %)</span>
                    <input type="number" min={0} max={90} step={1} value={hyp.remiseClassique}
                      onChange={(e) => changerHyp({ remiseClassique: Math.min(90, Math.max(0, Number(e.target.value) || 0)) })}
                      className={`${ctl} w-16 text-right`} />
                    <span className="text-[11px] text-[#8A8474]">%</span>
                    <button type="button" onClick={() => changerHyp(HYP_DEFAUT)} className="ml-auto text-[11px] font-bold text-[#B4761A] hover:underline">cas le plus fréquent</button>
                  </label>
                </div>
                <p className="mt-1.5 text-[10.5px] leading-snug text-[#8A8474]">
                  Prime selon l’éligibilité de la gamme au Coup de pouce chauffage et à l’ETAS ≥ 140 % à 55 °C (AirH2O 600 dès la T3,5 ; AirH2O 800 et S80 en T4 ;
                  Yutaki S, S Combi et M : Coup de pouce seul ; Yutaki H et AirH2O 400 : ni l’un ni l’autre, sauf AirH2O 400 10 kW pour l’ETAS).
                  Remise complémentaire comptée au maximum ; tarif promo Yutaki H non chiffré.
                </p>
              </div>
            </div>
          )}
        </section>

        <div className={`grid items-start gap-2.5 ${edition ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
          <div className="min-w-0 space-y-2.5">
            {loading && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Calcul en cours…</div>}
            {!loading && tailles.length === 0 && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Aucun groupe avec ces filtres.</div>}
            {!loading && tailles.map(({ taille, rows }) => (
              <section key={taille} className="rounded-xl border border-[#E5E1D8] bg-white">
                {/* En-tête collant : taille + colonnes */}
                <div className="sticky z-20 rounded-t-xl border-b border-[#D9D3C5] bg-[#FAF8F3] shadow-[0_2px_4px_rgba(17,24,32,0.06)]" style={{ top: hautBandeau }}>
                  <div className="flex items-baseline gap-2 px-3 pt-2">
                    <h2 className="text-[16px] font-bold">Taille {taille.replace('.', ',')}</h2>
                    <span className="text-[12px] text-[#8A8474]">
                      {[TAILLE_KW_600[taille] && `600 : ${TAILLE_KW_600[taille]}`, TAILLE_KW_800[taille] && `800 : ${TAILLE_KW_800[taille]}`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="grid grid-cols-[150px_350px_minmax(0,1fr)] items-center gap-2 px-3 pb-2 pt-1 text-[12.5px] font-bold uppercase tracking-wide text-[#3A362E]">
                    <span>Usage</span>
                    <span className="rounded bg-[#F2E3C4] px-2 py-0.5 text-[#7A4E06]">Solution catalogue 2026 · AirH2O</span>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-extrabold tracking-wide text-[#111820]">Solutions anciennes générations envisageables</span>
                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-[12.5px] font-extrabold tracking-wider text-white">NON EXHAUSTIF</span>
                      <span className="text-[11.5px] font-semibold normal-case tracking-normal text-[#8A8474]">· prix · dispo auj. | fin déc. · aides · prime CEE</span>
                    </span>
                  </div>
                </div>
                {rows.map((c, idx) => {
                  const nt = c.mois.reduce((s, m) => s + n0(m.non_tenable), 0)
                  const nouvelleAlim = idx === 0 || rangAlim(rows[idx - 1].alim) !== rangAlim(c.alim)
                  const typesAlim = rows.filter((x) => rangAlim(x.alim) === rangAlim(c.alim)).map((x) => LIB_TYPE[x.gamme])
                  return (
                    <React.Fragment key={c.ref}>
                    {nouvelleAlim && (
                      <div className={`flex items-center gap-3 border-b border-[#E5E1D8] px-3 py-2 ${estMono(c.alim) ? 'bg-[#EEF4F8]' : 'bg-[#F4EFF8]'}`}>
                        <span className={`rounded-full px-4 py-1.5 text-[15px] font-extrabold uppercase tracking-wide text-white shadow-sm ${estMono(c.alim) ? 'bg-[#1D5C86]' : 'bg-[#7A5EA8]'}`}>
                          {LIB_ALIM(c.alim)}
                        </span>
                        <span className="text-[12px] font-semibold text-[#5E5A50]">
                          Taille {taille.replace('.', ',')} · {Array.from(new Set(typesAlim)).join(' et ')} {new Set(typesAlim).size > 1 ? 'superposés : comparez les deux types d’installation' : ''}
                        </span>
                      </div>
                    )}
                    <div className="border-b border-[#E5E1D8] last:rounded-b-xl last:border-b-0">
                      {/* Groupe AirH2O */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-[#FCFBF8] px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <a href={`/stock/penurie?ref=${encodeURIComponent(c.ref)}&mystock=tous`} className="text-[13.5px] font-bold hover:text-[#B4761A] hover:underline" title="Fiche pénurie">{c.ref}</a>
                          <span className={`rounded-md px-2 py-0.5 text-[12px] font-extrabold uppercase ${c.gamme === '800' ? 'bg-sky-100 text-sky-900' : 'bg-[#EDEAE1] text-[#3A362E]'}`}>
                            {LIB_TYPE[c.gamme]} · AirH2O {c.gamme}
                          </span>
                          <span className="text-[12px] font-bold text-[#3A362E]">{fmtPrix(c.prix)}</span>
                        </div>
                        <span className="flex items-center gap-1 text-[11.5px]">
                          stock <b>{fmtNum(c.stock_disponible)}</b> · dispo
                          <span className={`rounded-md px-1.5 py-0.5 font-bold ${clsDispo(n0(c.dispo_immediate))}`} title="Dispo immédiate (promettable)">auj. {fmtNum(c.dispo_immediate)}</span>
                          <span className={`rounded-md px-1.5 py-0.5 font-semibold ${clsDispo(n0(c.dispo_fin_dec))}`} title="Dispo d’ici fin décembre (arrivages compris)">fin déc. {fmtNum(c.dispo_fin_dec)}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="text-[#8A8474]">arrivages</span>
                          {c.mois.map((m, i) => (
                            <span key={m.mois} className={`rounded px-1 ${nonConfirme(m.mois) ? 'bg-[#FBF1E1] text-[#8A5A08]' : 'bg-[#F4F3F0]'}`} title={nonConfirme(m.mois) ? 'non confirmé' : i === 0 ? 'reste du mois, retards compris' : ''}>
                              {libMois(m.mois)} <b>{n0(m.arrivages) ? fmtNum(m.arrivages) : '·'}</b>
                            </span>
                          ))}
                        </span>
                        <span className="text-[11.5px]">CDC <b>{fmtNum(c.besoin_cdc_total)}</b> <span className="text-[#8A8474]">({fmtNum(c.nb_cdc)})</span>
                          {nt > 0 && <> <Badge cls="bg-red-50 text-red-700" title="Quantité en CDC non tenables">NT {fmtNum(nt)}</Badge></>}
                        </span>
                        <span className="truncate text-[11px] text-[#8A8474]">{c.designation}</span>
                      </div>
                      {/* Usages */}
                      {(c.gamme === '600' ? USAGES_600 : USAGES_800).filter((u) => !usageF || u === usageF).map((u) => {
                        const z = parUsage.get(`${c.ref}|${u}`)
                        const zA = `act:${c.ref}|${u}`
                        const zB = `bk:${c.ref}|${u}`
                        return (
                          <div key={u} className="grid grid-cols-[150px_350px_minmax(0,1fr)] gap-2 border-t border-[#F0EDE6] px-3 py-1.5">
                            <div className="pt-1">
                              <div className="text-[12.5px] font-bold">{USAGES[u].label}</div>
                              <div className="text-[10.5px] text-[#8A8474]">{USAGES[u].sub}</div>
                            </div>
                            <div onDragOver={(e) => survol(e, zA)} onDrop={(e) => deposerSurZone(e, c.ref, u, 'actuelle')}
                              className={`self-start rounded-lg bg-[#FBF5EA] p-1 ${survolZone === zA ? 'ring-2 ring-[#B4761A]' : ''}`}>
                              {z?.actuelle ? <CarteSolution sol={z.actuelle} refSol={null} />
                                : <div className="flex h-full min-h-[48px] items-center justify-center rounded-lg border border-dashed border-[#E5E1D8] text-[11px] italic text-[#B4AE9F]">{edition ? 'Solution catalogue 2026 : déposer les articles' : 'Pas de solution catalogue 2026 renseignée'}</div>}
                            </div>
                            <div onDragOver={(e) => survol(e, zB)} onDrop={(e) => deposerSurZone(e, c.ref, u, 'backup')}
                              className={`flex min-h-[52px] flex-wrap items-start gap-x-1.5 gap-y-3.5 rounded-lg px-0.5 pb-0.5 pt-3 ${survolZone === zB ? 'bg-[#B4761A]/[0.08] outline outline-2 -outline-offset-2 outline-[#B4761A]' : ''}`}>
                              {(z?.backups || []).map((s) => <CarteSolution key={s.id} sol={s} refSol={z?.actuelle ?? null} />)}
                              {edition && (
                                <div className="flex min-h-[48px] w-[150px] items-center justify-center rounded-lg border border-dashed border-[#D9D3C5] px-2 text-center text-[10.5px] italic text-[#B4AE9F]">
                                  + glisser un groupe pour une nouvelle solution
                                </div>
                              )}
                              {!edition && !(z?.backups || []).length && (
                                <div className="flex min-h-[48px] items-center px-2 text-[10.5px] italic text-[#B4AE9F]">Aucune solution d’ancienne génération.</div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    </React.Fragment>
                  )
                })}
              </section>
            ))}
            {!loading && (
              <p className="px-1 text-[10.5px] text-[#8A8474]">
                Dispo auj. = quantité promettable immédiatement (point bas du stock projeté : stock SAGE réel − préparé + CDF − CDC, toutes dates connues) ; dispo fin déc. = même calcul à partir du 31/12, arrivages de novembre-décembre compris.
                Bloc = min(dispo du composant ÷ quantité) sur les composants de la solution.
                Un composant ×2, ×3… est utilisé dans plusieurs solutions : son stock est partagé. Prix = prix public SAGE. Arrivages = CDF SAGE en cours, à leur date de réception retenue.
                Aides = note « ACTION 2 » aux commerciaux (chèque énergie Hitachi 500 €, remise complémentaire jusqu’à 10 % selon la gamme, tarif promo Yutaki H).
                Bilan client = écart de prix net + perte de prime CEE − chèque énergie − remise complémentaire ; ≤ 0 : le client n’y perd pas.
              </p>
            )}
          </div>

          {/* Panneau des articles (administrateurs, sur demande) */}
          {edition && (
          <aside className="space-y-2 xl:sticky" style={{ top: hautBandeau + 12 }}>
            <section className="rounded-xl border border-[#E5E1D8] bg-white">
              <div className="border-b border-[#E5E1D8] px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Articles R/O — à glisser</div>
                <div className="mt-1.5 flex gap-1.5">
                  <input value={poolSearch} onChange={(e) => setPoolSearch(e.target.value)} placeholder="Filtrer…" className={`${ctl} w-full font-medium`} />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#5E5A50]">
                    <input type="checkbox" checked={poolAvecStock} onChange={(e) => setPoolAvecStock(e.target.checked)} />en stock
                  </label>
                </div>
              </div>
              <div className="max-h-[calc(100vh-330px)] overflow-y-auto px-2 py-2">
                {poolListe.map(({ k, rows }) => (
                  <div key={k} className="mb-2">
                    <div className="px-1 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-[#B4761A]">{k}</div>
                    <div className="space-y-1">
                      {rows.map(([ref, a]) => (
                        <div key={ref} draggable onDragStart={(e) => debut(e, { type: 'article', ref })} onDragEnd={fin} title={a.designation || ''}
                          className="cursor-grab rounded-lg border border-[#E5E1D8] bg-white px-2 py-1 hover:border-[#B4761A] active:cursor-grabbing">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[11.5px] font-bold">{ref}</span>
                            <span className="text-[11px] font-bold text-[#3A362E]">{fmtPrix(a.prix)}</span>
                          </div>
                          <div className="truncate text-[10.5px] text-[#5E5A50]">{a.designation || '—'}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <DispoTag a={a} fusion />
                            {estNouvelleGen(ref) && <Badge cls="bg-sky-50 text-sky-800">AirH2O</Badge>}
                            {(partages.get(ref) || 0) > 0 && <Badge cls="bg-violet-50 text-violet-800" title="Nombre de solutions qui l’utilisent">dans {partages.get(ref)} sol.</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!loading && poolListe.length === 0 && <div className="px-2 py-6 text-center text-[11.5px] text-[#8A8474]">Aucun article.</div>}
              </div>
            </section>
            <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Autre article (toute la base SAGE)</div>
              <input value={rechercheArt} onChange={(e) => setRechercheArt(e.target.value)} placeholder="Réf. ou désignation (2 caractères min.)" className={`${ctl} mt-1.5 w-full font-medium`} />
              <div className="mt-1.5 max-h-[260px] space-y-1 overflow-y-auto">
                {resultatsArt.map((r) => (
                  <div key={r.ref} draggable onDragStart={(e) => debut(e, { type: 'article', ref: r.ref })} onDragEnd={fin}
                    className="cursor-grab rounded-lg border border-[#E5E1D8] px-2 py-1 hover:border-[#B4761A] active:cursor-grabbing">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[11.5px] font-bold">{r.ref}</span>
                      <span className="text-[11px] font-bold">{fmtPrix(r.prix)}</span>
                    </div>
                    <div className="truncate text-[10.5px] text-[#5E5A50]">{r.designation}</div>
                    <span className="text-[10.5px] text-[#5E5A50]">stock {fmtNum(r.stock_disponible)}</span>
                  </div>
                ))}
                {rechercheArt.trim().length >= 2 && resultatsArt.length === 0 && <div className="py-2 text-center text-[11px] text-[#8A8474]">Aucun article.</div>}
              </div>
            </section>
          </aside>
          )}
        </div>
      </div>
    </main>
  )
}

export default function EquivalencesROPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <EquivalencesRO />
    </Suspense>
  )
}
