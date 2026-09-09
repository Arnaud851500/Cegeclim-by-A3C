'use client'

/**
 * Écran "Fournisseurs & articles SAGE / BLG" — pendant fournisseur de
 * l'écran "Clients SAGE / BLG", orienté préparation du calcul de besoin.
 * ---------------------------------------------------------------------------
 * 3 onglets :
 *  - Fournisseurs : tous les tiers SAGE de type fournisseur (761) avec la
 *    stratégie d'appro (colonnes manuelles du classeur reprises dans la table
 *    appro_fournisseur_strategie, éditables ici), un statut synthétique
 *    (CBN_BLG, CBN_EXTERNALISE, A_QUALIFIER, INACTIF, HORS_NEGOCE, SOMMEIL…),
 *    les volumes de références (actives, MYSTOCK, avec conso, avec stock min)
 *    et une suggestion de stratégie quand rien n'est renseigné.
 *  - Articles & stock min : la base article SAGE avec MYSTOCK, la conso BL
 *    mensuelle (μ, σ sur l'horizon), le stock FMS, le stock min SAGE, le stock
 *    min BLG (entrepôt DPFMS) et le stock min CALCULÉ (point de commande) —
 *    avec saisie d'un "stock min retenu" qui prime sur le calcul, recalcul à
 *    la demande (RPC refresh_appro_calcul_besoin) et réglage des paramètres
 *    (horizon, z, délais).
 *  - Comparaison : contrôle SAGE ↔ BLG, au choix sur les fournisseurs ou sur
 *    les articles, avec les mêmes règles tolérantes que l'écran client
 *    (pastilles par champ, fenêtre flottante par ligne, export Excel coloré).
 *
 * Sources (vues créées par la migration appro_fournisseurs_articles_sage_blg) :
 *  - v_appro_controle_fournisseur_sage_blg (SAGE ⟗ BLG, clé 'F'+n° tiers)
 *  - v_appro_controle_article_sage_blg   (SAGE ⟕ BLG, clé référence article)
 *  - appro_fournisseur_strategie, appro_parametres, appro_article_stock_min
 *
 * Nécessite "exceljs" (déjà utilisé par l'écran client).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExcelJS from 'exceljs'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type StatutAppariementFourn = 'apparie' | 'manquant_blg' | 'blg_seul'
type StatutAppro = 'SOMMEIL' | 'HORS_NEGOCE' | 'CBN_EXTERNALISE' | 'CBN_BLG' | 'SANS_REFERENCE' | 'INACTIF' | 'A_QUALIFIER' | 'MANUEL'

type FournRow = {
  numero: string
  statut_appariement: StatutAppariementFourn
  sage_intitule: string | null; blg_intitule: string | null
  sage_abrege: string | null; blg_nom_court: string | null
  sage_qualite: string | null
  sage_en_sommeil: boolean | null; blg_actif: boolean | null
  blg_statut_partenaire: string | null
  sage_frs_pv: boolean | null
  sage_siret: string | null; blg_siret: string | null
  sage_tva_intra: string | null; blg_tva_intra: string | null
  sage_code_naf: string | null
  sage_adresse: string | null; blg_adresse: string | null
  sage_code_postal: string | null; blg_code_postal: string | null
  sage_ville: string | null; blg_ville: string | null
  sage_telephone: string | null; blg_telephone: string | null
  sage_email: string | null; blg_email: string | null
  sage_site: string | null; blg_site: string | null
  sage_encours: number | null; blg_encours: number | null
  sage_delai_appro: number | null; blg_delai_appro: number | null
  sage_delai_transport: number | null; blg_delai_transport: number | null
  param_delai_appro: number | null; blg_delai_securite: number | null
  strategie_principale: string | null
  long_terme: boolean | null; au_fil_de_leau: boolean | null; contremarque: boolean | null
  calcul_besoin_effectif: boolean | null
  periodicite: string | null
  remarque: string | null
  statut_appro: StatutAppro | null
  strategie_suggeree: string | null
  blg_type_commande_defaut: number | null
  blg_instructions_commande: string | null
  sage_nb_refs: number | null; blg_nb_parts: number | null
  sage_nb_refs_actives: number | null; blg_nb_parts_actifs: number | null
  sage_nb_refs_mystock: number | null; blg_nb_parts_stock_min_fms: number | null
  sage_nb_refs_stock_fms: number | null; blg_nb_parts_stock_fms: number | null
  sage_nb_refs_mystock_conso: number | null
  sage_nb_refs_stock_min: number | null
  sage_conso_horizon_total: number | null
  sage_derniere_sortie: string | null
  sage_valeur_stock_fms: number | null
  blg_nb_prix_fournisseur: number | null
  blg_supplier_id: number | null
  blg_partner_id: number | null
  blg_crm_id: string | null
  blg_code: string | null
  lien_blg: string | null
  sage_datemaj: string | null
  blg_last_update: string | null
  champs_en_ecart: string[] | null
}

type ArtRow = {
  reference_article: string
  statut_appariement: 'apparie' | 'manquant_blg'
  fournisseur_principal: string | null
  famille: string | null
  mystock: string | null
  pertinent_calcul_besoin: boolean | null
  sage_en_sommeil: boolean | null
  sage_designation: string | null; blg_designation: string | null
  sage_fournisseur: string | null; blg_fournisseur: string | null
  sage_ref_fournisseur: string | null
  sage_sommeil: boolean | null; blg_inactif: boolean | null
  sage_uo_fms: string | null; blg_uo_fms: string | null
  sage_prix_achat: number | null; blg_prix_achat: number | null
  sage_prix_achat_fournisseur: number | null; blg_prix_achat_fournisseur: number | null
  sage_colisage: number | null; blg_colisage: number | null
  sage_qte_mini: number | null; blg_qte_mini: number | null
  sage_stock_fms: number | null; blg_stock_fms: number | null
  sage_stock_total: number | null; blg_stock_total: number | null
  sage_stock_min_fms: number | null; blg_stock_min_fms: number | null
  sage_stock_max_fms: number | null; blg_stock_max_fms: number | null
  calc_stock_min: number | null
  calc_stock_max: number | null
  calc_stock_securite: number | null
  conso_moy_mensuelle: number | null
  conso_ecart_type: number | null
  conso_3_derniers_mois: number | null
  conso_horizon: number | null
  nb_mois_avec_sortie: number | null
  sage_derniere_sortie: string | null; blg_derniere_sortie_fms: string | null
  delai_appro_jours: number | null
  couverture_fms_mois: number | null
  stock_min_retenu: number | null
  commentaire_stock_min: string | null
  blg_part_id: number | null
  lien_blg: string | null
  blg_last_update: string | null
  champs_en_ecart: string[] | null
}

type StrategieRef = { code: string; designation: string; outil_cbn: string | null; mode_appro: string | null; calcul_besoin_blg: boolean; ordre: number | null }
type Parametre = { cle: string; valeur: number; description: string | null }

// ─────────────────────────────────────────────────────────────────────────
// Helpers génériques (repris de l'écran client)
// ─────────────────────────────────────────────────────────────────────────

function safeText(v: unknown) { return String(v ?? '').trim() }

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtEuro(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
}
function fmtMois(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

type ResultatComparaison = 'ok' | 'ecart' | 'partiel'
type Evaluation = ResultatComparaison | 'vide' | 'affichage' | 'manquant'

function normaliserPourExport(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'OUI' : 'NON'
  if (Array.isArray(v)) return v.map(String).join(', ').toUpperCase().trim()
  return String(v).toUpperCase().trim()
}
function normaliserTexte(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.map(String).join(' ') : String(v)
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}
function motsDe(v: unknown): string[] { return normaliserTexte(v).split(' ').filter(Boolean) }
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}
function motsProches(a: string, b: string): boolean {
  if (a === b) return true
  const min = Math.min(a.length, b.length)
  if (min >= 4 && (a.includes(b) || b.includes(a))) return true
  if (min >= 5 && levenshtein(a, b, 1) <= 1) return true
  return false
}
function motTrouveDans(mot: string, liste: string[]): boolean { return liste.some((m) => motsProches(mot, m)) }

function comparerInclusion(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserTexte(sage).replace(/ /g, '')
  const b = normaliserTexte(blg).replace(/ /g, '')
  if (!s || !b) return 'partiel'
  return b.includes(s) || s.includes(b) ? 'ok' : 'ecart'
}
function normaliserTelephone(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.startsWith('0033')) d = '0' + d.slice(4)
  else if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2)
  return d
}
function comparerTelephone(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserTelephone(sage), b = normaliserTelephone(blg)
  if (!s || !b) return 'partiel'
  return s === b ? 'ok' : 'ecart'
}
function comparerSiret(sage: unknown, blg: unknown): ResultatComparaison {
  const s = String(sage ?? '').replace(/\D/g, ''), b = String(blg ?? '').replace(/\D/g, '')
  if (!s || !b) return 'partiel'
  if (s.slice(0, 9) !== b.slice(0, 9)) return 'ecart'
  return s === b ? 'ok' : 'partiel'
}
function comparerTva(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserTexte(sage).replace(/ /g, ''), b = normaliserTexte(blg).replace(/ /g, '')
  if (!s || !b) return 'partiel'
  if (s.slice(0, 13) !== b.slice(0, 13)) return 'ecart'
  return s === b ? 'ok' : 'partiel'
}
function normaliserVille(v: unknown): string {
  return normaliserTexte(v).replace(/\bCEDEX\b.*$/, '').replace(/\bSTE\b/g, 'SAINTE').replace(/\bST\b/g, 'SAINT').replace(/\s+/g, ' ').trim()
}
function comparerVille(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserVille(sage), b = normaliserVille(blg)
  if (!s || !b) return 'partiel'
  if (s === b) return 'ok'
  const ms = s.split(' '), mb = b.split(' ')
  const [court, long] = ms.length <= mb.length ? [ms, mb] : [mb, ms]
  if (court.every((m) => motTrouveDans(m, long))) return 'ok'
  if (levenshtein(s.replace(/ /g, ''), b.replace(/ /g, ''), 1) <= 1) return 'ok'
  return 'ecart'
}
const ABREVIATIONS_VOIE: Record<string, string> = {
  ALL: 'ALLEE', AV: 'AVENUE', AVE: 'AVENUE', BD: 'BOULEVARD', BLD: 'BOULEVARD', BLVD: 'BOULEVARD', CHEM: 'CHEMIN', CH: 'CHEMIN',
  IMP: 'IMPASSE', RTE: 'ROUTE', PL: 'PLACE', R: 'RUE', ST: 'SAINT', STE: 'SAINTE', BAT: 'BATIMENT', RES: 'RESIDENCE', LOT: 'LOTISSEMENT',
  FG: 'FAUBOURG', SQ: 'SQUARE', CRS: 'COURS', QU: 'QUAI', PROM: 'PROMENADE', ZI: 'ZONE INDUSTRIELLE', ZA: 'ZONE ARTISANALE',
}
const MOTS_VIDES_ADRESSE = new Set(['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'L', 'D', 'ET', 'A', 'AU', 'AUX', 'FRANCE'])
function motsAdresse(v: unknown): string[] {
  let s = String(v ?? '')
  s = s.split(/,\s*\d{5}\b/)[0]
  return motsDe(s).map((m) => ABREVIATIONS_VOIE[m] || m).filter((m) => !MOTS_VIDES_ADRESSE.has(m))
}
function comparerAdresse(sage: unknown, blg: unknown): ResultatComparaison {
  const ms = motsAdresse(sage), mb = motsAdresse(blg)
  if (ms.length === 0 || mb.length === 0) return 'partiel'
  const numS = ms.find((m) => /^\d+[A-Z]?$/.test(m)), numB = mb.find((m) => /^\d+[A-Z]?$/.test(m))
  if (numS && numB && numS !== numB) return 'ecart'
  const [court, long] = ms.length <= mb.length ? [ms, mb] : [mb, ms]
  const trouves = court.filter((m) => motTrouveDans(m, long)).length
  return trouves / court.length >= 0.6 ? 'ok' : 'ecart'
}
/** Libellés (désignation article, raison sociale) : 60 % des mots du plus court retrouvés dans l'autre. */
function comparerLibelle(sage: unknown, blg: unknown): ResultatComparaison {
  const ms = motsDe(sage).filter((m) => m.length >= 2), mb = motsDe(blg).filter((m) => m.length >= 2)
  if (ms.length === 0 || mb.length === 0) return 'partiel'
  const [court, long] = ms.length <= mb.length ? [ms, mb] : [mb, ms]
  const trouves = court.filter((m) => motTrouveDans(m, long)).length
  return trouves / court.length >= 0.6 ? 'ok' : 'ecart'
}
/** Numérique avec tolérance relative (0 = strict). Valeur manquante d'un côté → partiel. */
function comparerNumerique(sage: unknown, blg: unknown, tolPct = 0): ResultatComparaison {
  if (sage === null || sage === undefined || blg === null || blg === undefined) return 'partiel'
  const s = Number(sage), b = Number(blg)
  if (Number.isNaN(s) || Number.isNaN(b)) return 'partiel'
  if (s === b) return 'ok'
  const ref = Math.max(Math.abs(s), Math.abs(b))
  return ref > 0 && Math.abs(s - b) / ref <= tolPct ? 'ok' : 'ecart'
}

function estVide(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Paire de colonnes SAGE ↔ BLG. compareStrict=false → affichage seul (orange). */
type Paire<T> = {
  key: string
  labelSage: string
  sageKey: keyof T
  labelBlg: string
  blgKey: keyof T
  compareStrict: boolean
  comparer?: (r: T) => ResultatComparaison
  format?: (v: unknown) => string
}

function evaluerPaire<T>(p: Paire<T>, r: T, apparie: boolean): Evaluation {
  if (!apparie) return 'manquant'
  const sv = r[p.sageKey], bv = r[p.blgKey]
  const sVide = estVide(sv), bVide = estVide(bv)
  if (sVide && bVide) return 'vide'
  if (!p.compareStrict) return 'affichage'
  if (sVide || bVide) return 'partiel'
  if (p.comparer) return p.comparer(r)
  return normaliserPourExport(sv) === normaliserPourExport(bv) ? 'ok' : 'ecart'
}

type EvaluationsLigne = Record<string, Evaluation>
function compterEcarts(ev: EvaluationsLigne | undefined) {
  let rouge = 0, orange = 0
  if (ev) Object.values(ev).forEach((e) => { if (e === 'ecart') rouge += 1; else if (e === 'partiel') orange += 1 })
  return { rouge, orange }
}

const COULEUR_OK = 'FFDCFCE7', COULEUR_ECART = 'FFFECACA', COULEUR_NON_COMPARABLE = 'FFFED7AA', COULEUR_ENTETE_PAIRE = 'FFE0E7EF'
const EVAL_STYLE: Record<Evaluation, { cellule: string; libelle: string; argb: string }> = {
  ok: { cellule: 'bg-emerald-50 text-emerald-800', libelle: 'Identique', argb: COULEUR_OK },
  ecart: { cellule: 'bg-red-50 font-semibold text-red-800', libelle: 'Écart', argb: COULEUR_ECART },
  partiel: { cellule: 'bg-orange-50 text-orange-800', libelle: 'Partiel / manquant', argb: COULEUR_NON_COMPARABLE },
  affichage: { cellule: 'bg-orange-50/50 text-[#3A362E]', libelle: 'Affiché, non comparé', argb: COULEUR_NON_COMPARABLE },
  vide: { cellule: 'text-[#B3AD9E]', libelle: 'Vide des deux côtés', argb: COULEUR_NON_COMPARABLE },
  manquant: { cellule: 'text-[#B3AD9E]', libelle: 'Non apparié', argb: COULEUR_NON_COMPARABLE },
}

// ─────────────────────────────────────────────────────────────────────────
// Définition des paires comparées
// ─────────────────────────────────────────────────────────────────────────

const PAIRES_FOURNISSEUR: Paire<FournRow>[] = [
  { key: 'intitule', labelSage: 'Intitulé', sageKey: 'sage_intitule', labelBlg: 'Raison sociale', blgKey: 'blg_intitule', compareStrict: true, comparer: (r) => comparerLibelle(r.sage_intitule, r.blg_intitule) },
  { key: 'actif', labelSage: 'En sommeil', sageKey: 'sage_en_sommeil', labelBlg: 'Actif', blgKey: 'blg_actif', compareStrict: true, comparer: (r) => (!r.sage_en_sommeil === !!r.blg_actif ? 'ok' : 'ecart') },
  { key: 'statut_partenaire', labelSage: 'Qualité', sageKey: 'sage_qualite', labelBlg: 'Statut partenaire (active / cessation / closed)', blgKey: 'blg_statut_partenaire', compareStrict: false },
  { key: 'siret', labelSage: 'SIRET', sageKey: 'sage_siret', labelBlg: 'Numéro entreprise', blgKey: 'blg_siret', compareStrict: true, comparer: (r) => comparerSiret(r.sage_siret, r.blg_siret) },
  { key: 'tva', labelSage: 'Identifiant TVA', sageKey: 'sage_tva_intra', labelBlg: 'TVA intracommunautaire', blgKey: 'blg_tva_intra', compareStrict: true, comparer: (r) => comparerTva(r.sage_tva_intra, r.blg_tva_intra) },
  { key: 'adresse', labelSage: 'Adresse', sageKey: 'sage_adresse', labelBlg: 'Adresse', blgKey: 'blg_adresse', compareStrict: true, comparer: (r) => comparerAdresse(r.sage_adresse, r.blg_adresse) },
  { key: 'code_postal', labelSage: 'Code postal', sageKey: 'sage_code_postal', labelBlg: 'Code postal', blgKey: 'blg_code_postal', compareStrict: true },
  { key: 'ville', labelSage: 'Ville', sageKey: 'sage_ville', labelBlg: 'Ville', blgKey: 'blg_ville', compareStrict: true, comparer: (r) => comparerVille(r.sage_ville, r.blg_ville) },
  { key: 'telephone', labelSage: 'Téléphone', sageKey: 'sage_telephone', labelBlg: 'Téléphone', blgKey: 'blg_telephone', compareStrict: true, comparer: (r) => comparerTelephone(r.sage_telephone, r.blg_telephone) },
  { key: 'email', labelSage: 'E-mail', sageKey: 'sage_email', labelBlg: 'E-mail', blgKey: 'blg_email', compareStrict: true, comparer: (r) => (safeText(r.sage_email).toLowerCase() === safeText(r.blg_email).toLowerCase() ? 'ok' : 'ecart') },
  { key: 'site', labelSage: 'Site web', sageKey: 'sage_site', labelBlg: 'Site web', blgKey: 'blg_site', compareStrict: true, comparer: (r) => comparerInclusion(r.sage_site, r.blg_site) },
  { key: 'encours', labelSage: 'Encours autorisé', sageKey: 'sage_encours', labelBlg: "Limite d'encours", blgKey: 'blg_encours', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_encours, r.blg_encours) },
  { key: 'delai_appro', labelSage: "Délai d'appro (SAGE, jours)", sageKey: 'sage_delai_appro', labelBlg: 'Délai réappro (BLG, jours)', blgKey: 'blg_delai_appro', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_delai_appro, r.blg_delai_appro) },
  { key: 'delai_transport', labelSage: 'Délai transport (SAGE)', sageKey: 'sage_delai_transport', labelBlg: 'Délai transport (BLG)', blgKey: 'blg_delai_transport', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_delai_transport, r.blg_delai_transport) },
  { key: 'delai_param', labelSage: 'Délai appro retenu (paramètre CBN)', sageKey: 'param_delai_appro', labelBlg: 'Délai sécurité (BLG)', blgKey: 'blg_delai_securite', compareStrict: false },
  { key: 'strategie', labelSage: "Stratégie d'appro", sageKey: 'strategie_principale', labelBlg: 'Type de commande par défaut (id BLG)', blgKey: 'blg_type_commande_defaut', compareStrict: false },
  { key: 'nb_refs', labelSage: 'Nb références actives', sageKey: 'sage_nb_refs_actives', labelBlg: 'Nb articles actifs', blgKey: 'blg_nb_parts_actifs', compareStrict: false },
  {
    key: 'mystock', labelSage: 'Nb refs MYSTOCK', sageKey: 'sage_nb_refs_mystock', labelBlg: 'Nb articles avec stock min FMS', blgKey: 'blg_nb_parts_stock_min_fms', compareStrict: true,
    comparer: (r) => {
      const s = Number(r.sage_nb_refs_mystock ?? 0), b = Number(r.blg_nb_parts_stock_min_fms ?? 0)
      if (s === b) return 'ok'
      return b === 0 && s > 0 ? 'ecart' : 'partiel'
    },
  },
  { key: 'stock_fms', labelSage: 'Nb refs en stock FMS', sageKey: 'sage_nb_refs_stock_fms', labelBlg: 'Nb articles en stock FMS', blgKey: 'blg_nb_parts_stock_fms', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_nb_refs_stock_fms, r.blg_nb_parts_stock_fms) },
]

const PAIRES_ARTICLE: Paire<ArtRow>[] = [
  { key: 'designation', labelSage: 'Désignation', sageKey: 'sage_designation', labelBlg: 'Libellé', blgKey: 'blg_designation', compareStrict: true, comparer: (r) => comparerLibelle(r.sage_designation, r.blg_designation) },
  { key: 'fournisseur', labelSage: 'Fournisseur principal', sageKey: 'sage_fournisseur', labelBlg: 'Fournisseur (déduit du code BLG)', blgKey: 'blg_fournisseur', compareStrict: true },
  { key: 'actif', labelSage: 'En sommeil', sageKey: 'sage_sommeil', labelBlg: 'Inactif', blgKey: 'blg_inactif', compareStrict: true, comparer: (r) => (!!r.sage_sommeil === !!r.blg_inactif ? 'ok' : 'ecart') },
  { key: 'uo_fms', labelSage: 'UO FMS', sageKey: 'sage_uo_fms', labelBlg: 'uoFms (champ perso)', blgKey: 'blg_uo_fms', compareStrict: true, comparer: (r) => comparerInclusion(r.sage_uo_fms, r.blg_uo_fms) },
  { key: 'prix_achat', labelSage: "Prix d'achat", sageKey: 'sage_prix_achat', labelBlg: "Dernier prix d'achat", blgKey: 'blg_prix_achat', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_prix_achat, r.blg_prix_achat, 0.01) },
  { key: 'prix_fourn', labelSage: "Prix d'achat fournisseur (FIA)", sageKey: 'sage_prix_achat_fournisseur', labelBlg: 'Prix fournisseur (tarif BLG)', blgKey: 'blg_prix_achat_fournisseur', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_prix_achat_fournisseur, r.blg_prix_achat_fournisseur, 0.01) },
  { key: 'colisage', labelSage: 'Colisage', sageKey: 'sage_colisage', labelBlg: "Conditionnement d'achat", blgKey: 'blg_colisage', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_colisage, r.blg_colisage) },
  { key: 'qte_mini', labelSage: 'Qté mini commande', sageKey: 'sage_qte_mini', labelBlg: "Qté mini d'achat", blgKey: 'blg_qte_mini', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_qte_mini, r.blg_qte_mini) },
  { key: 'stock_fms', labelSage: 'Stock FMS', sageKey: 'sage_stock_fms', labelBlg: 'Stock DPFMS', blgKey: 'blg_stock_fms', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_stock_fms ?? 0, r.blg_stock_fms ?? 0) },
  { key: 'stock_total', labelSage: 'Stock total (tous dépôts)', sageKey: 'sage_stock_total', labelBlg: 'Stock total (tous entrepôts)', blgKey: 'blg_stock_total', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_stock_total ?? 0, r.blg_stock_total ?? 0) },
  { key: 'stock_min_fms', labelSage: 'Stock min FMS (SAGE)', sageKey: 'sage_stock_min_fms', labelBlg: 'Stock min DPFMS (BLG)', blgKey: 'blg_stock_min_fms', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_stock_min_fms, r.blg_stock_min_fms) },
  { key: 'stock_max_fms', labelSage: 'Stock max FMS (SAGE)', sageKey: 'sage_stock_max_fms', labelBlg: 'Stock max DPFMS (BLG)', blgKey: 'blg_stock_max_fms', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_stock_max_fms, r.blg_stock_max_fms) },
  {
    key: 'stock_min_calc', labelSage: 'Stock min CALCULÉ / retenu', sageKey: 'calc_stock_min', labelBlg: 'Stock min DPFMS (BLG)', blgKey: 'blg_stock_min_fms', compareStrict: true,
    comparer: (r) => {
      if (!r.pertinent_calcul_besoin) return 'partiel'
      return comparerNumerique(r.calc_stock_min, r.blg_stock_min_fms)
    },
  },
  { key: 'stock_max_calc', labelSage: 'Stock max CALCULÉ', sageKey: 'calc_stock_max', labelBlg: 'Stock max DPFMS (BLG)', blgKey: 'blg_stock_max_fms', compareStrict: true, comparer: (r) => (r.pertinent_calcul_besoin ? comparerNumerique(r.calc_stock_max, r.blg_stock_max_fms) : 'partiel') },
  { key: 'derniere_sortie', labelSage: 'Dernière sortie BL (mois)', sageKey: 'sage_derniere_sortie', labelBlg: 'Dernière sortie DPFMS', blgKey: 'blg_derniere_sortie_fms', compareStrict: false },
]

// ─────────────────────────────────────────────────────────────────────────
// Petits composants partagés
// ─────────────────────────────────────────────────────────────────────────

function KpiCard({ label, value, loading, tone, sub }: { label: string; value: number | string; loading: boolean; tone?: 'ok' | 'warn'; sub?: string }) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : '#111820'
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      {loading ? <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[#F4F3F0]" /> : (
        <div className="mt-1 text-[26px] font-bold tracking-tight" style={{ color }}>{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</div>
      )}
      {sub && <div className="text-[11px] text-[#8A8474]">{sub}</div>}
    </div>
  )
}
function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_1.4fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
      <span className="font-semibold text-[#3A362E]">{label}</span>
      <span className="text-[#111820]">{value === null || value === undefined || value === '' ? '—' : value}</span>
    </div>
  )
}
function OngletTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-5 py-2.5 text-[14px] font-bold transition-colors ${active ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>
      {label}
    </button>
  )
}

const STATUT_APPRO_STYLE: Record<StatutAppro, { label: string; className: string }> = {
  CBN_BLG: { label: 'CBN BLG', className: 'bg-emerald-50 text-emerald-700' },
  CBN_EXTERNALISE: { label: 'CBN externalisé (IA)', className: 'bg-violet-50 text-violet-700' },
  A_QUALIFIER: { label: 'À qualifier', className: 'bg-[#B4761A]/[0.12] text-[#96600F]' },
  MANUEL: { label: 'Manuel / à la demande', className: 'bg-sky-50 text-sky-700' },
  INACTIF: { label: 'Inactif', className: 'bg-red-50 text-red-700' },
  SANS_REFERENCE: { label: 'Sans référence', className: 'bg-[#F4F3F0] text-[#8A8474]' },
  HORS_NEGOCE: { label: 'Hors négoce', className: 'bg-[#F4F3F0] text-[#8A8474]' },
  SOMMEIL: { label: 'En sommeil', className: 'bg-[#F4F3F0] text-[#8A8474]' },
}
function StatutApproBadge({ statut }: { statut: StatutAppro | null }) {
  if (!statut) return null
  const s = STATUT_APPRO_STYLE[statut]
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.className}`}>{s.label}</span>
}

const STATUT_APPRO_ORDRE: StatutAppro[] = ['CBN_BLG', 'A_QUALIFIER', 'CBN_EXTERNALISE', 'MANUEL', 'INACTIF', 'SANS_REFERENCE', 'HORS_NEGOCE', 'SOMMEIL']

/** Navigation clavier ↑/↓ générique. */
function creerHandlerNavigation<T>(rows: T[], selected: T | null, setSelected: (r: T) => void, getIndex: (rows: T[], selected: T | null) => number, refs: React.MutableRefObject<Record<number, HTMLTableRowElement | null>>) {
  return (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (rows.length === 0) return
    e.preventDefault()
    const currentIndex = getIndex(rows, selected)
    const nextIndex = currentIndex === -1 ? 0 : e.key === 'ArrowDown' ? Math.min(currentIndex + 1, rows.length - 1) : Math.max(currentIndex - 1, 0)
    setSelected(rows[nextIndex])
    refs.current[nextIndex]?.scrollIntoView({ block: 'nearest' })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Chargement des données (partagé par les 3 onglets)
// ─────────────────────────────────────────────────────────────────────────

async function chargerFournisseurs(): Promise<FournRow[]> {
  const { data, error } = await supabase.from('v_appro_controle_fournisseur_sage_blg').select('*').order('numero').limit(3000)
  if (error) throw error
  return (data || []) as FournRow[]
}

async function chargerArticles(onProgress?: (n: number) => void): Promise<ArtRow[]> {
  const acc: ArtRow[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('v_appro_controle_article_sage_blg').select('*').order('reference_article').range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data || []) as ArtRow[]
    acc.push(...batch)
    onProgress?.(acc.length)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return acc
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Fournisseurs
// ─────────────────────────────────────────────────────────────────────────

type StrategieForm = {
  long_terme: boolean; au_fil_de_leau: boolean; contremarque: boolean
  strategie_principale: string; calcul_besoin_periodique: 'auto' | 'oui' | 'non'
  periodicite: string; delai_appro_jours: string; delai_securite_jours: string; niveau_service_z: string; remarque: string
}

function OngletFournisseurs({ rows, loading, error, strategies, onRowChange, articles }: {
  rows: FournRow[]; loading: boolean; error: string | null; strategies: StrategieRef[]
  onRowChange: (r: FournRow) => void; articles: ArtRow[]
}) {
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState<'' | StatutAppro>('')
  const [qualiteFilter, setQualiteFilter] = useState('')
  const [masquerSommeil, setMasquerSommeil] = useState(true)
  const [masquerHorsNegoce, setMasquerHorsNegoce] = useState(true)
  const [selected, setSelected] = useState<FournRow | null>(null)
  const [form, setForm] = useState<StrategieForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  const qualites = useMemo(() => Array.from(new Set(rows.map((r) => safeText(r.sage_qualite)).filter(Boolean))).sort(), [rows])

  const filtres = useMemo(() => {
    const term = search.trim().toUpperCase()
    return rows.filter((r) => {
      if (r.statut_appariement === 'blg_seul') return false
      if (masquerSommeil && r.statut_appro === 'SOMMEIL') return false
      if (masquerHorsNegoce && r.statut_appro === 'HORS_NEGOCE') return false
      if (statutFilter && r.statut_appro !== statutFilter) return false
      if (qualiteFilter && safeText(r.sage_qualite) !== qualiteFilter) return false
      if (term && !(r.numero.toUpperCase().includes(term) || (r.sage_intitule || '').toUpperCase().includes(term))) return false
      return true
    }).sort((a, b) => {
      const oa = STATUT_APPRO_ORDRE.indexOf(a.statut_appro || 'SOMMEIL'), ob = STATUT_APPRO_ORDRE.indexOf(b.statut_appro || 'SOMMEIL')
      if (oa !== ob) return oa - ob
      return (b.sage_nb_refs_mystock || 0) - (a.sage_nb_refs_mystock || 0) || a.numero.localeCompare(b.numero)
    })
  }, [rows, search, statutFilter, qualiteFilter, masquerSommeil, masquerHorsNegoce])

  const kpis = useMemo(() => {
    const c: Record<string, number> = {}
    rows.forEach((r) => { if (r.statut_appro) c[r.statut_appro] = (c[r.statut_appro] || 0) + 1 })
    return c
  }, [rows])

  useEffect(() => {
    if (!selected) { setForm(null); return }
    setForm({
      long_terme: !!selected.long_terme, au_fil_de_leau: !!selected.au_fil_de_leau, contremarque: !!selected.contremarque,
      strategie_principale: selected.strategie_principale || '',
      calcul_besoin_periodique: 'auto',
      periodicite: selected.periodicite || 'mensuel',
      delai_appro_jours: selected.param_delai_appro !== null && selected.param_delai_appro !== undefined ? String(selected.param_delai_appro) : '',
      delai_securite_jours: '', niveau_service_z: '', remarque: selected.remarque || '',
    })
    setSaveMsg(null)
    // On recharge la ligne brute de la stratégie pour récupérer les champs non exposés par la vue (calcul_besoin_periodique explicite, délai sécurité, z)
    void supabase.from('appro_fournisseur_strategie').select('*').eq('fournisseur', selected.numero).maybeSingle().then(({ data }) => {
      if (!data) return
      setForm((f) => f ? {
        ...f,
        calcul_besoin_periodique: data.calcul_besoin_periodique === null ? 'auto' : data.calcul_besoin_periodique ? 'oui' : 'non',
        delai_securite_jours: data.delai_securite_jours ?? '',
        niveau_service_z: data.niveau_service_z ?? '',
        delai_appro_jours: data.delai_appro_jours ?? '',
      } : f)
    })
  }, [selected?.numero]) // eslint-disable-line react-hooks/exhaustive-deps

  async function enregistrer() {
    if (!selected || !form) return
    setSaving(true); setSaveMsg(null)
    try {
      const payload = {
        fournisseur: selected.numero,
        long_terme: form.long_terme, au_fil_de_leau: form.au_fil_de_leau, contremarque: form.contremarque,
        strategie_principale: form.strategie_principale || null,
        calcul_besoin_periodique: form.calcul_besoin_periodique === 'auto' ? null : form.calcul_besoin_periodique === 'oui',
        periodicite: form.periodicite || 'mensuel',
        delai_appro_jours: form.delai_appro_jours === '' ? null : Number(form.delai_appro_jours),
        delai_securite_jours: form.delai_securite_jours === '' ? null : Number(form.delai_securite_jours),
        niveau_service_z: form.niveau_service_z === '' ? null : Number(form.niveau_service_z),
        remarque: form.remarque || null,
        updated_at: new Date().toISOString(),
      }
      const { error: err } = await supabase.from('appro_fournisseur_strategie').upsert(payload, { onConflict: 'fournisseur' })
      if (err) throw err
      const { data, error: err2 } = await supabase.from('v_appro_controle_fournisseur_sage_blg').select('*').eq('numero', selected.numero).maybeSingle()
      if (err2) throw err2
      if (data) { onRowChange(data as FournRow); setSelected(data as FournRow) }
      setSaveMsg('Stratégie enregistrée. Relance le calcul de besoin (onglet Articles) si tu as changé un délai ou le niveau de service.')
    } catch (e) {
      setSaveMsg('Erreur : ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }

  const refsFournisseur = useMemo(() => {
    if (!selected) return []
    return articles.filter((a) => a.fournisseur_principal === selected.numero && a.pertinent_calcul_besoin).sort((a, b) => (b.conso_horizon || 0) - (a.conso_horizon || 0))
  }, [articles, selected])

  function getIndex(list: FournRow[], sel: FournRow | null) { return sel ? list.findIndex((r) => r.numero === sel.numero) : -1 }
  const onListKeyDown = creerHandlerNavigation(filtres, selected, setSelected, getIndex, listRefs)

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {STATUT_APPRO_ORDRE.map((s) => (
          <button key={s} type="button" onClick={() => setStatutFilter((v) => (v === s ? '' : s))} className={`text-left ${statutFilter === s ? 'ring-2 ring-[#B4761A]/50 rounded-xl' : ''}`}>
            <KpiCard label={STATUT_APPRO_STYLE[s].label} value={kpis[s] || 0} loading={loading} tone={s === 'CBN_BLG' ? 'ok' : s === 'A_QUALIFIER' || s === 'INACTIF' ? 'warn' : undefined} />
          </button>
        ))}
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="N° fournisseur ou intitulé…"
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
          <select value={qualiteFilter} onChange={(e) => setQualiteFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Qualité : Toutes</option>
            {qualites.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={masquerSommeil} onChange={(e) => setMasquerSommeil(e.target.checked)} className="accent-[#B4761A]" /> Masquer en sommeil
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={masquerHorsNegoce} onChange={(e) => setMasquerHorsNegoce(e.target.checked)} className="accent-[#B4761A]" /> Masquer hors négoce
          </label>
        </div>
        <p className="mt-2 text-[12px] text-[#8A8474]">
          <b>CBN BLG</b> = stratégie "Au fil de l'eau" avec des références MYSTOCK → calcul de besoin mensuel dans BLG. <b>À qualifier</b> = fournisseur négoce actif sans stratégie renseignée (une suggestion est proposée dans la fiche). Clique une carte pour filtrer.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_1.3fr]">
        <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{loading ? 'Chargement…' : `${filtres.length} fournisseur${filtres.length > 1 ? 's' : ''}`}</div>
            {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
          </div>
          <div tabIndex={0} onKeyDown={onListKeyDown} className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                <tr>
                  <th className="px-3 py-2 font-bold">Fournisseur</th>
                  <th className="px-3 py-2 font-bold">Statut appro</th>
                  <th className="px-3 py-2 font-bold">Stratégie</th>
                  <th className="px-3 py-2 text-right font-bold" title="Références actives / MYSTOCK / MYSTOCK avec conso">Refs act. / MYSTOCK / conso</th>
                  <th className="px-3 py-2 text-right font-bold">Dern. sortie</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((r, i) => {
                  const isSel = selected?.numero === r.numero
                  return (
                    <tr key={r.numero} ref={(el) => { listRefs.current[i] = el }} onClick={() => setSelected(r)}
                      className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${isSel ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero}</span>
                          {r.sage_frs_pv && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">PV</span>}
                          {r.statut_appariement === 'manquant_blg' && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Manquant BLG</span>}
                        </div>
                        <div className="truncate text-[12px] text-[#111820]">{r.sage_intitule || '—'}</div>
                      </td>
                      <td className="px-3 py-2"><StatutApproBadge statut={r.statut_appro} /></td>
                      <td className="px-3 py-2 text-[12px] text-[#3A362E]">
                        {r.strategie_principale || (r.strategie_suggeree ? <span className="italic text-[#B4761A]">→ {r.strategie_suggeree} ?</span> : '—')}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[12px] text-[#3A362E]">{r.sage_nb_refs_actives ?? 0} / <b>{r.sage_nb_refs_mystock ?? 0}</b> / {r.sage_nb_refs_mystock_conso ?? 0}</td>
                      <td className="px-3 py-2 text-right text-[12px] text-[#3A362E]">{fmtMois(r.sage_derniere_sortie)}</td>
                    </tr>
                  )
                })}
                {!loading && filtres.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Fiche fournisseur & stratégie d'appro</div>
          {!selected || !form ? (
            <div className="flex h-64 items-center justify-center text-center text-[13px] text-[#8A8474]">Sélectionne un fournisseur pour voir sa fiche et régler sa stratégie d'appro.</div>
          ) : (
            <div>
              <div className="mb-3 flex items-start justify-between border-b border-[#E5E1D8] pb-3">
                <div>
                  <div className="font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero} {selected.blg_code ? <span className="text-[#B3AD9E]">· BLG {selected.blg_code}</span> : null}</div>
                  <div className="text-[16px] font-bold text-[#111820]">{selected.sage_intitule || '—'}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5"><StatutApproBadge statut={selected.statut_appro} />
                    {selected.blg_statut_partenaire && selected.blg_statut_partenaire !== 'active' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">BLG partenaire : {selected.blg_statut_partenaire}</span>}
                  </div>
                </div>
                {selected.lien_blg && <a href={selected.lien_blg} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>}
              </div>

              <DetailGroup title="Stratégie d'appro (saisie)">
                <div className="grid grid-cols-3 gap-2 px-2 py-1 text-[13px]">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.long_terme} onChange={(e) => setForm({ ...form, long_terme: e.target.checked })} className="accent-[#B4761A]" /> Long terme</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.au_fil_de_leau} onChange={(e) => setForm({ ...form, au_fil_de_leau: e.target.checked })} className="accent-[#B4761A]" /> Au fil de l'eau</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={form.contremarque} onChange={(e) => setForm({ ...form, contremarque: e.target.checked })} className="accent-[#B4761A]" /> Contremarque / à la demande</label>
                </div>
                <div className="grid grid-cols-[1fr_1.4fr] gap-2 px-2 py-1.5 text-[13px]">
                  <span className="font-semibold text-[#3A362E]">Stratégie principale</span>
                  <select value={form.strategie_principale} onChange={(e) => setForm({ ...form, strategie_principale: e.target.value })} className="h-8 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold">
                    <option value="">— non renseignée{selected.strategie_suggeree ? ` (suggestion : ${selected.strategie_suggeree})` : ''} —</option>
                    {strategies.map((s) => <option key={s.code} value={s.code}>{s.designation} — {s.outil_cbn} / {s.mode_appro}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-[1fr_1.4fr] gap-2 px-2 py-1.5 text-[13px]">
                  <span className="font-semibold text-[#3A362E]">Calcul de besoin périodique</span>
                  <div className="flex gap-1 text-[12px]">
                    {(['auto', 'oui', 'non'] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setForm({ ...form, calcul_besoin_periodique: v })}
                        className={`rounded px-2 py-0.5 font-semibold ${form.calcul_besoin_periodique === v ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0] text-[#3A362E]'}`}>
                        {v === 'auto' ? `Selon stratégie (${selected.calcul_besoin_effectif ? 'oui' : 'non'})` : v === 'oui' ? 'Forcer oui' : 'Forcer non'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 px-2 py-1.5 text-[12px]">
                  <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Périodicité</span>
                    <select value={form.periodicite} onChange={(e) => setForm({ ...form, periodicite: e.target.value })} className="h-8 rounded-lg border border-[#E5E1D8] bg-white px-2">
                      <option value="mensuel">Mensuel</option><option value="bimensuel">Bimensuel</option><option value="hebdomadaire">Hebdomadaire</option><option value="trimestriel">Trimestriel</option>
                    </select></label>
                  <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Délai appro (j)</span>
                    <input value={form.delai_appro_jours} onChange={(e) => setForm({ ...form, delai_appro_jours: e.target.value })} placeholder="défaut" className="h-8 rounded-lg border border-[#E5E1D8] px-2" /></label>
                  <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Délai sécurité (j)</span>
                    <input value={form.delai_securite_jours} onChange={(e) => setForm({ ...form, delai_securite_jours: e.target.value })} placeholder="défaut" className="h-8 rounded-lg border border-[#E5E1D8] px-2" /></label>
                  <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Niveau service z</span>
                    <input value={form.niveau_service_z} onChange={(e) => setForm({ ...form, niveau_service_z: e.target.value })} placeholder="défaut" className="h-8 rounded-lg border border-[#E5E1D8] px-2" /></label>
                </div>
                <div className="px-2 py-1.5">
                  <textarea value={form.remarque} onChange={(e) => setForm({ ...form, remarque: e.target.value })} placeholder="Remarque…" rows={2} className="w-full rounded-lg border border-[#E5E1D8] px-2 py-1 text-[12px]" />
                </div>
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[12px] text-[#8A8474]">{saveMsg}</span>
                  <button type="button" onClick={() => void enregistrer()} disabled={saving} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">{saving ? 'Enregistrement…' : 'Enregistrer la stratégie'}</button>
                </div>
              </DetailGroup>

              <DetailGroup title="Volumes & activité (SAGE)">
                <DetailRow label="Qualité" value={selected.sage_qualite} />
                <DetailRow label="Références (total / actives)" value={`${fmtNum(selected.sage_nb_refs)} / ${fmtNum(selected.sage_nb_refs_actives)}`} />
                <DetailRow label="Refs MYSTOCK actives (dont avec conso / avec stock min calculé)" value={`${fmtNum(selected.sage_nb_refs_mystock)} (${fmtNum(selected.sage_nb_refs_mystock_conso)} / ${fmtNum(selected.sage_nb_refs_stock_min)})`} />
                <DetailRow label="Refs en stock FMS" value={fmtNum(selected.sage_nb_refs_stock_fms)} />
                <DetailRow label="Sorties BL sur l'horizon (qté)" value={fmtNum(selected.sage_conso_horizon_total)} />
                <DetailRow label="Dernière sortie" value={fmtMois(selected.sage_derniere_sortie)} />
                <DetailRow label="Valeur stock FMS (PA)" value={fmtEuro(selected.sage_valeur_stock_fms)} />
              </DetailGroup>

              <DetailGroup title="Côté BLG">
                <DetailRow label="Fournisseur BLG" value={selected.blg_code ? `${selected.blg_code} — ${selected.blg_actif ? 'actif' : 'inactif'}` : 'Manquant'} />
                <DetailRow label="Articles BLG (total / actifs)" value={`${fmtNum(selected.blg_nb_parts)} / ${fmtNum(selected.blg_nb_parts_actifs)}`} />
                <DetailRow label="Articles avec stock min DPFMS" value={fmtNum(selected.blg_nb_parts_stock_min_fms)} />
                <DetailRow label="Délais BLG (réappro / transport / sécurité)" value={`${fmtNum(selected.blg_delai_appro)} / ${fmtNum(selected.blg_delai_transport)} / ${fmtNum(selected.blg_delai_securite)} j`} />
                <DetailRow label="Lignes de tarif fournisseur" value={fmtNum(selected.blg_nb_prix_fournisseur)} />
              </DetailGroup>

              <DetailGroup title={`Références MYSTOCK actives (${refsFournisseur.length}) — triées par conso`}>
                <div className="max-h-72 overflow-auto rounded-lg border border-[#E5E1D8]">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-[#F4F3F0] text-[10px] uppercase text-[#8A8474]">
                      <tr><th className="px-2 py-1">Référence</th><th className="px-2 py-1 text-right">μ/mois</th><th className="px-2 py-1 text-right">Stock FMS</th><th className="px-2 py-1 text-right">Min SAGE</th><th className="px-2 py-1 text-right">Min BLG</th><th className="px-2 py-1 text-right">Min calculé</th></tr>
                    </thead>
                    <tbody>
                      {refsFournisseur.map((a) => (
                        <tr key={a.reference_article} className="border-t border-[#F4F3F0]">
                          <td className="px-2 py-1"><span className="font-mono font-semibold">{a.reference_article}</span><div className="truncate text-[11px] text-[#8A8474]">{a.sage_designation}</div></td>
                          <td className="px-2 py-1 text-right">{fmtNum(a.conso_moy_mensuelle, 1)}</td>
                          <td className="px-2 py-1 text-right">{fmtNum(a.sage_stock_fms)}</td>
                          <td className="px-2 py-1 text-right">{fmtNum(a.sage_stock_min_fms)}</td>
                          <td className="px-2 py-1 text-right">{fmtNum(a.blg_stock_min_fms)}</td>
                          <td className="px-2 py-1 text-right font-bold">{fmtNum(a.calc_stock_min)}</td>
                        </tr>
                      ))}
                      {refsFournisseur.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-[#8A8474]">Aucune référence MYSTOCK active.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </DetailGroup>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Articles & stock min
// ─────────────────────────────────────────────────────────────────────────

function OngletArticles({ articles, fournisseurs, loading, loadProgress, error, parametres, onParametresChange, onArticleChange, onRecalcul }: {
  articles: ArtRow[]; fournisseurs: FournRow[]; loading: boolean; loadProgress: number; error: string | null
  parametres: Parametre[]; onParametresChange: (p: Parametre[]) => void; onArticleChange: (a: ArtRow) => void; onRecalcul: () => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [fournFilter, setFournFilter] = useState('')
  const [familleFilter, setFamilleFilter] = useState('')
  const [pertinentsSeuls, setPertinentsSeuls] = useState(true)
  const [avecConsoSeuls, setAvecConsoSeuls] = useState(false)
  const [ecartMinSeuls, setEcartMinSeuls] = useState(false)
  const [tri, setTri] = useState<'conso' | 'ecart' | 'couverture' | 'reference'>('conso')
  const [editRef, setEditRef] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [editCom, setEditCom] = useState('')
  const [recalculEnCours, setRecalculEnCours] = useState(false)
  const [recalculMsg, setRecalculMsg] = useState<string | null>(null)
  const [showParams, setShowParams] = useState(false)
  const [paramsDraft, setParamsDraft] = useState<Record<string, string>>({})
  const [exportEnCours, setExportEnCours] = useState(false)

  useEffect(() => { setParamsDraft(Object.fromEntries(parametres.map((p) => [p.cle, String(p.valeur)]))) }, [parametres])

  const fournOptions = useMemo(() => {
    const m = new Map<string, string>()
    fournisseurs.forEach((f) => { if (f.numero) m.set(f.numero, f.sage_intitule || f.numero) })
    return Array.from(new Set(articles.map((a) => a.fournisseur_principal).filter(Boolean) as string[])).sort().map((n) => ({ numero: n, label: m.get(n) || n }))
  }, [articles, fournisseurs])
  const familleOptions = useMemo(() => Array.from(new Set(articles.map((a) => safeText(a.famille)).filter(Boolean))).sort(), [articles])

  const filtres = useMemo(() => {
    const term = search.trim().toUpperCase()
    const list = articles.filter((a) => {
      if (pertinentsSeuls && !a.pertinent_calcul_besoin) return false
      if (avecConsoSeuls && !(Number(a.conso_horizon) > 0)) return false
      if (ecartMinSeuls && !(a.champs_en_ecart || []).includes('stock_min')) return false
      if (fournFilter && a.fournisseur_principal !== fournFilter) return false
      if (familleFilter && safeText(a.famille) !== familleFilter) return false
      if (term && !(a.reference_article.toUpperCase().includes(term) || (a.sage_designation || '').toUpperCase().includes(term))) return false
      return true
    })
    return list.sort((a, b) => {
      if (tri === 'conso') return (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'ecart') return Math.abs((b.calc_stock_min || 0) - (b.blg_stock_min_fms || 0)) - Math.abs((a.calc_stock_min || 0) - (a.blg_stock_min_fms || 0))
      if (tri === 'couverture') return (a.couverture_fms_mois ?? 999) - (b.couverture_fms_mois ?? 999)
      return a.reference_article.localeCompare(b.reference_article)
    })
  }, [articles, search, fournFilter, familleFilter, pertinentsSeuls, avecConsoSeuls, ecartMinSeuls, tri])

  const kpis = useMemo(() => {
    const pert = articles.filter((a) => a.pertinent_calcul_besoin)
    return {
      mystock: pert.length,
      avecConso: pert.filter((a) => Number(a.conso_horizon) > 0).length,
      sansConso: pert.filter((a) => !(Number(a.conso_horizon) > 0)).length,
      minBlg: pert.filter((a) => Number(a.blg_stock_min_fms) > 0).length,
      ecarts: pert.filter((a) => (a.champs_en_ecart || []).includes('stock_min')).length,
      rupture: pert.filter((a) => Number(a.calc_stock_min) > 0 && Number(a.sage_stock_fms || 0) < Number(a.calc_stock_min)).length,
    }
  }, [articles])

  const affichees = useMemo(() => filtres.slice(0, 500), [filtres])

  async function enregistrerRetenu(a: ArtRow) {
    const val = editVal.trim() === '' ? null : Number(editVal)
    const { error: err } = await supabase.from('appro_article_stock_min').upsert(
      { reference_article: a.reference_article, stock_min_retenu: val, commentaire: editCom || null }, { onConflict: 'reference_article' })
    if (err) { alert('Erreur : ' + err.message); return }
    const { data } = await supabase.from('v_appro_controle_article_sage_blg').select('*').eq('reference_article', a.reference_article).maybeSingle()
    if (data) onArticleChange(data as ArtRow)
    setEditRef(null)
  }

  async function enregistrerParams() {
    const next = parametres.map((p) => ({ ...p, valeur: Number(paramsDraft[p.cle] ?? p.valeur) }))
    const { error: err } = await supabase.from('appro_parametres').upsert(next.map((p) => ({ cle: p.cle, valeur: p.valeur, description: p.description })), { onConflict: 'cle' })
    if (err) { alert('Erreur : ' + err.message); return }
    onParametresChange(next)
    setRecalculMsg('Paramètres enregistrés — relance le calcul pour les appliquer.')
  }

  async function recalculer() {
    setRecalculEnCours(true); setRecalculMsg(null)
    try {
      const { data, error: err } = await supabase.rpc('refresh_appro_calcul_besoin')
      if (err) throw err
      const d = data as { periode?: string; articles_calcules?: number; lignes_conso?: number }
      setRecalculMsg(`Calcul terminé sur ${d?.periode ?? '?'} : ${d?.articles_calcules ?? '?'} articles, ${d?.lignes_conso ?? '?'} lignes de conso mensuelle.`)
      await onRecalcul()
    } catch (e) {
      setRecalculMsg('Erreur : ' + (e instanceof Error ? e.message : String(e)))
    } finally { setRecalculEnCours(false) }
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Calcul de besoin')
      const cols: { h: string; f: (a: ArtRow) => unknown }[] = [
        { h: 'Référence', f: (a) => a.reference_article }, { h: 'Désignation', f: (a) => a.sage_designation }, { h: 'Famille', f: (a) => a.famille },
        { h: 'Fournisseur', f: (a) => a.fournisseur_principal }, { h: 'Réf. fournisseur', f: (a) => a.sage_ref_fournisseur }, { h: 'MYSTOCK', f: (a) => a.mystock },
        { h: 'En sommeil', f: (a) => (a.sage_en_sommeil ? 'Oui' : 'Non') }, { h: 'UO FMS', f: (a) => a.sage_uo_fms },
        { h: 'Conso horizon (qté)', f: (a) => a.conso_horizon }, { h: 'Conso moy./mois (μ)', f: (a) => a.conso_moy_mensuelle }, { h: 'Écart-type (σ)', f: (a) => a.conso_ecart_type },
        { h: 'Conso 3 derniers mois', f: (a) => a.conso_3_derniers_mois }, { h: 'Nb mois avec sortie', f: (a) => a.nb_mois_avec_sortie }, { h: 'Dernière sortie', f: (a) => fmtMois(a.sage_derniere_sortie) },
        { h: 'Délai appro (j)', f: (a) => a.delai_appro_jours }, { h: 'Stock FMS', f: (a) => a.sage_stock_fms }, { h: 'Couverture FMS (mois)', f: (a) => a.couverture_fms_mois },
        { h: 'Stock sécurité calculé', f: (a) => a.calc_stock_securite }, { h: 'Stock min calculé/retenu', f: (a) => a.calc_stock_min }, { h: 'Stock max calculé', f: (a) => a.calc_stock_max },
        { h: 'Stock min retenu (saisie)', f: (a) => a.stock_min_retenu }, { h: 'Commentaire', f: (a) => a.commentaire_stock_min },
        { h: 'Stock min FMS SAGE', f: (a) => a.sage_stock_min_fms }, { h: 'Stock max FMS SAGE', f: (a) => a.sage_stock_max_fms },
        { h: 'Stock min DPFMS BLG', f: (a) => a.blg_stock_min_fms }, { h: 'Stock max DPFMS BLG', f: (a) => a.blg_stock_max_fms },
        { h: 'Colisage', f: (a) => a.sage_colisage }, { h: 'Prix achat', f: (a) => a.sage_prix_achat }, { h: 'Lien BLG', f: (a) => a.lien_blg },
      ]
      ws.addRow(cols.map((c) => c.h)).font = { bold: true }
      filtres.forEach((a) => {
        const row = ws.addRow(cols.map((c) => { const v = c.f(a); return v === null || v === undefined ? '' : v }))
        const idxCalc = cols.findIndex((c) => c.h === 'Stock min calculé/retenu') + 1
        const idxBlg = cols.findIndex((c) => c.h === 'Stock min DPFMS BLG') + 1
        const ecart = a.pertinent_calcul_besoin && Number(a.calc_stock_min || 0) > 0 && Number(a.calc_stock_min) !== Number(a.blg_stock_min_fms || 0)
        const couleur = !a.pertinent_calcul_besoin ? null : ecart ? COULEUR_ECART : COULEUR_OK
        if (couleur) [idxCalc, idxBlg].forEach((i) => { row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } } })
      })
      ws.columns.forEach((c) => { c.width = 18 })
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `calcul_besoin_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally { setExportEnCours(false) }
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KpiCard label="Refs MYSTOCK actives" value={kpis.mystock} loading={loading} sub="pertinentes pour le CBN" />
        <KpiCard label="Avec conso sur l'horizon" value={kpis.avecConso} loading={loading} tone="ok" />
        <KpiCard label="Sans aucune sortie" value={kpis.sansConso} loading={loading} tone="warn" sub="MYSTOCK à challenger" />
        <KpiCard label="Stock min renseigné dans BLG" value={kpis.minBlg} loading={loading} />
        <KpiCard label="Stock min BLG ≠ calculé" value={kpis.ecarts} loading={loading} tone="warn" />
        <KpiCard label="Stock FMS < stock min calculé" value={kpis.rupture} loading={loading} tone="warn" sub="à commander" />
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-bold text-[#111820]">Calcul de besoin — stock min (point de commande) par référence MYSTOCK</div>
            <p className="mt-1 max-w-3xl text-[12px] text-[#8A8474]">
              Sur l'historique des sorties BL (flux articles, toutes agences, {parametres.find((p) => p.cle === 'horizon_mois')?.valeur ?? 12} mois complets) :
              μ = conso moyenne mensuelle, σ = écart-type. Délai L = délai fournisseur + délai sécurité.
              <b> Stock sécurité = z × σ × √(L/30)</b>, <b>Stock min = μ × L/30 + stock sécurité</b> (arrondi au colisage), <b>Stock max = stock min + μ × période de revue/30</b>.
              Un "stock min retenu" saisi à la main prime sur le calcul et sert de valeur cible pour BLG (quantity_min sur l'entrepôt DPFMS).
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button type="button" onClick={() => void recalculer()} disabled={recalculEnCours || loading} className="rounded-lg bg-[#111820] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
              {recalculEnCours ? 'Calcul en cours…' : '↻ Recalculer les stocks min'}
            </button>
            <button type="button" onClick={() => setShowParams((v) => !v)} className="text-[12px] font-semibold text-[#B4761A] hover:underline">{showParams ? 'Masquer les paramètres' : 'Paramètres du calcul'}</button>
          </div>
        </div>
        {recalculMsg && <div className="mt-3 rounded-lg border border-[#B4761A]/25 bg-[#B4761A]/[0.06] px-3 py-2 text-[13px] font-semibold text-[#5A4321]">{recalculMsg}</div>}
        {showParams && (
          <div className="mt-3 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-3">
            <div className="grid gap-2 md:grid-cols-3">
              {parametres.map((p) => (
                <label key={p.cle} className="flex flex-col gap-0.5 text-[12px]">
                  <span className="font-semibold text-[#3A362E]">{p.cle}</span>
                  <input value={paramsDraft[p.cle] ?? ''} onChange={(e) => setParamsDraft({ ...paramsDraft, [p.cle]: e.target.value })} className="h-8 rounded-lg border border-[#E5E1D8] bg-white px-2" />
                  <span className="text-[11px] text-[#8A8474]">{p.description}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 text-right"><button type="button" onClick={() => void enregistrerParams()} className="rounded-lg bg-[#111820] px-3 py-1.5 text-[12px] font-bold text-white">Enregistrer les paramètres</button></div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence ou désignation…" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A]" />
          <select value={fournFilter} onChange={(e) => setFournFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Fournisseur : Tous</option>
            {fournOptions.map((f) => <option key={f.numero} value={f.numero}>{f.numero} — {f.label}</option>)}
          </select>
          <select value={familleFilter} onChange={(e) => setFamilleFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Famille : Toutes</option>
            {familleOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={tri} onChange={(e) => setTri(e.target.value as typeof tri)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="conso">Tri : conso décroissante</option>
            <option value="ecart">Tri : écart stock min (calculé vs BLG)</option>
            <option value="couverture">Tri : couverture FMS croissante</option>
            <option value="reference">Tri : référence</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={pertinentsSeuls} onChange={(e) => setPertinentsSeuls(e.target.checked)} className="accent-[#B4761A]" /> MYSTOCK actives uniquement</label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={avecConsoSeuls} onChange={(e) => setAvecConsoSeuls(e.target.checked)} className="accent-[#B4761A]" /> Avec conso uniquement</label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={ecartMinSeuls} onChange={(e) => setEcartMinSeuls(e.target.checked)} className="accent-[#B4761A]" /> Stock min BLG ≠ calculé</label>
          </div>
          <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
            {exportEnCours ? 'Export en cours…' : `⬇ Exporter en Excel (${filtres.length} refs)`}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading ? `Chargement… ${loadProgress} articles` : filtres.length > 500 ? `500 affichées sur ${filtres.length} — affine ou exporte` : `${filtres.length} référence${filtres.length > 1 ? 's' : ''}`}
          </div>
          {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
        </div>
        <div className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8]">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[10px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                <th className="px-2 py-2 font-bold">Référence</th>
                <th className="px-2 py-2 font-bold">Fourn.</th>
                <th className="px-2 py-2 text-right font-bold" title="Conso moyenne mensuelle sur l'horizon">μ / mois</th>
                <th className="px-2 py-2 text-right font-bold" title="Écart-type mensuel">σ</th>
                <th className="px-2 py-2 text-right font-bold">3 dern. mois</th>
                <th className="px-2 py-2 text-right font-bold">Dern. sortie</th>
                <th className="px-2 py-2 text-right font-bold">Stock FMS</th>
                <th className="px-2 py-2 text-right font-bold" title="Stock FMS / μ">Couv. (mois)</th>
                <th className="px-2 py-2 text-right font-bold">Min SAGE</th>
                <th className="px-2 py-2 text-right font-bold">Min BLG</th>
                <th className="px-2 py-2 text-right font-bold">SS calc.</th>
                <th className="px-2 py-2 text-right font-bold">Min calc.</th>
                <th className="px-2 py-2 text-right font-bold">Max calc.</th>
                <th className="px-2 py-2 text-right font-bold">Retenu</th>
              </tr>
            </thead>
            <tbody>
              {affichees.map((a) => {
                const ecart = (a.champs_en_ecart || []).includes('stock_min')
                const sousMin = Number(a.calc_stock_min) > 0 && Number(a.sage_stock_fms || 0) < Number(a.calc_stock_min)
                const editing = editRef === a.reference_article
                return (
                  <tr key={a.reference_article} className="border-t border-[#E5E1D8] hover:bg-[#F4F3F0]">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-[#3A362E]">{a.reference_article}</span>
                        {a.mystock === 'OUI' && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">MYSTOCK</span>}
                        {a.sage_en_sommeil && <span className="rounded-full bg-[#F4F3F0] px-1.5 py-0.5 text-[10px] font-bold text-[#8A8474]">Sommeil</span>}
                        {a.statut_appariement === 'manquant_blg' && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Manquant BLG</span>}
                        {a.lien_blg && <a href={a.lien_blg} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#B4761A] hover:underline">BLG ↗</a>}
                      </div>
                      <div className="max-w-[320px] truncate text-[11px] text-[#111820]" title={a.sage_designation || ''}>{a.sage_designation || '—'}</div>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px]">{a.fournisseur_principal || '—'}</td>
                    <td className="px-2 py-1.5 text-right">{fmtNum(a.conso_moy_mensuelle, 1)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.conso_ecart_type, 1)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtNum(a.conso_3_derniers_mois)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMois(a.sage_derniere_sortie)}</td>
                    <td className={`px-2 py-1.5 text-right ${sousMin ? 'font-bold text-red-700' : ''}`}>{fmtNum(a.sage_stock_fms)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtNum(a.couverture_fms_mois, 1)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.sage_stock_min_fms)}</td>
                    <td className={`px-2 py-1.5 text-right ${ecart ? 'bg-red-50 font-semibold text-red-800' : 'text-[#8A8474]'}`}>{fmtNum(a.blg_stock_min_fms)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.calc_stock_securite)}</td>
                    <td className="px-2 py-1.5 text-right font-bold">{fmtNum(a.calc_stock_min)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.calc_stock_max)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {editing ? (
                        <div className="flex flex-col items-end gap-1">
                          <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-7 w-20 rounded border border-[#B4761A] px-1 text-right" placeholder="vide = calc." />
                          <input value={editCom} onChange={(e) => setEditCom(e.target.value)} placeholder="commentaire" className="h-7 w-40 rounded border border-[#E5E1D8] px-1 text-[11px]" />
                          <div className="flex gap-1">
                            <button type="button" onClick={() => void enregistrerRetenu(a)} className="rounded bg-[#111820] px-2 py-0.5 text-[11px] font-bold text-white">OK</button>
                            <button type="button" onClick={() => setEditRef(null)} className="rounded bg-[#F4F3F0] px-2 py-0.5 text-[11px] font-bold">✕</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" title={a.commentaire_stock_min || 'Saisir un stock min retenu'} onClick={() => { setEditRef(a.reference_article); setEditVal(a.stock_min_retenu === null ? '' : String(a.stock_min_retenu)); setEditCom(a.commentaire_stock_min || '') }}
                          className={`rounded px-2 py-0.5 font-mono ${a.stock_min_retenu !== null ? 'bg-[#B4761A]/[0.12] font-bold text-[#96600F]' : 'text-[#B3AD9E] hover:bg-[#F4F3F0]'}`}>
                          {a.stock_min_retenu !== null ? fmtNum(a.stock_min_retenu) : '✎'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!loading && affichees.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-[#8A8474]">Aucune référence pour ces filtres.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Comparaison (fournisseurs ou articles)
// ─────────────────────────────────────────────────────────────────────────

type Domaine = 'fournisseur' | 'article'

function LigneComparaisonModal<T>({ titre, sousTitre, badges, lien, paires, row, evals, onClose }: {
  titre: string; sousTitre: string; badges: React.ReactNode; lien: string | null; paires: Paire<T>[]; row: T; evals: EvaluationsLigne; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#E5E1D8] px-5 py-4">
          <div>
            <div className="font-mono text-[12px] font-bold text-[#8A8474]">{titre}</div>
            <div className="text-[16px] font-bold text-[#111820]">{sousTitre}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">{badges}</div>
          </div>
          <div className="flex items-center gap-3">
            {lien && <a href={lien} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>}
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0] hover:text-[#111820]">✕ Fermer</button>
          </div>
        </div>
        <div className="overflow-auto p-5">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-white text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
              <tr className="border-b border-[#E5E1D8]"><th className="py-2 pr-2">Champ SAGE</th><th className="py-2 pr-2">Valeur SAGE</th><th className="py-2 pr-2">Champ BLG</th><th className="py-2 pr-2">Valeur BLG</th><th className="py-2">Résultat</th></tr>
            </thead>
            <tbody>
              {paires.map((p) => {
                const ev = evals[p.key] ?? 'vide'
                const st = EVAL_STYLE[ev]
                return (
                  <tr key={p.key} className={`border-b border-[#F4F3F0] align-top ${ev === 'ecart' ? 'bg-red-50/60' : ev === 'partiel' ? 'bg-orange-50/60' : ''}`}>
                    <td className="py-1.5 pr-2 font-semibold text-[#3A362E]">{p.labelSage}</td>
                    <td className={`py-1.5 pr-2 ${ev === 'ecart' ? 'font-bold text-red-800' : 'text-[#111820]'}`}>{formatCellValue(row[p.sageKey])}</td>
                    <td className="py-1.5 pr-2 font-semibold text-[#3A362E]">{p.labelBlg}</td>
                    <td className={`py-1.5 pr-2 ${ev === 'ecart' ? 'font-bold text-red-800' : 'text-[#111820]'}`}>{formatCellValue(row[p.blgKey])}</td>
                    <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cellule}`}>{st.libelle}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function OngletComparaison({ fournisseurs, articles, loading, error }: { fournisseurs: FournRow[]; articles: ArtRow[]; loading: boolean; error: string | null }) {
  const [domaine, setDomaine] = useState<Domaine>('fournisseur')
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState<'tous' | 'apparie' | 'manquant_blg' | 'blg_seul'>('tous')
  const [onlyEcarts, setOnlyEcarts] = useState(false)
  const [exclureSommeil, setExclureSommeil] = useState(true)
  const [mystockSeul, setMystockSeul] = useState(true)
  const [negoceSeul, setNegoceSeul] = useState(true)
  const [champsSelectionnes, setChampsSelectionnes] = useState<string[]>([])
  const [combinaison, setCombinaison] = useState<'ou' | 'et'>('ou')
  const [ligneActive, setLigneActive] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => { setChampsSelectionnes([]); setLigneActive(null); setOuvert(null) }, [domaine])

  // Base de lignes selon le domaine (filtres "serveur" équivalents : sommeil, négoce, MYSTOCK)
  const baseFourn = useMemo(() => fournisseurs.filter((r) => {
    if (exclureSommeil && r.sage_en_sommeil) return false
    if (negoceSeul && r.statut_appariement !== 'blg_seul' && ['HORS_NEGOCE', 'SOMMEIL'].includes(r.statut_appro || '')) return false
    return true
  }), [fournisseurs, exclureSommeil, negoceSeul])
  const baseArt = useMemo(() => articles.filter((a) => {
    if (exclureSommeil && a.sage_en_sommeil) return false
    if (mystockSeul && !a.pertinent_calcul_besoin) return false
    return true
  }), [articles, exclureSommeil, mystockSeul])

  const evalsFourn = useMemo(() => {
    const m = new Map<string, EvaluationsLigne>()
    baseFourn.forEach((r) => { const ev: EvaluationsLigne = {}; PAIRES_FOURNISSEUR.forEach((p) => { ev[p.key] = evaluerPaire(p, r, r.statut_appariement === 'apparie') }); m.set(r.numero, ev) })
    return m
  }, [baseFourn])
  const evalsArt = useMemo(() => {
    const m = new Map<string, EvaluationsLigne>()
    baseArt.forEach((r) => { const ev: EvaluationsLigne = {}; PAIRES_ARTICLE.forEach((p) => { ev[p.key] = evaluerPaire(p, r, r.statut_appariement === 'apparie') }); m.set(r.reference_article, ev) })
    return m
  }, [baseArt])

  const paires = (domaine === 'fournisseur' ? PAIRES_FOURNISSEUR : PAIRES_ARTICLE) as Paire<any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  const evals = domaine === 'fournisseur' ? evalsFourn : evalsArt
  const base: Array<FournRow | ArtRow> = domaine === 'fournisseur' ? baseFourn : baseArt
  const cle = (r: FournRow | ArtRow) => ('numero' in r ? r.numero : r.reference_article)
  const libelle = (r: FournRow | ArtRow) => ('numero' in r ? r.sage_intitule || r.blg_intitule : r.sage_designation || r.blg_designation) || '—'
  const lien = (r: FournRow | ArtRow) => r.lien_blg

  const statsChamps = useMemo(() => {
    const s: Record<string, { rouge: number; orange: number }> = {}
    paires.forEach((p) => { s[p.key] = { rouge: 0, orange: 0 } })
    evals.forEach((ev) => { Object.entries(ev).forEach(([k, e]) => { if (!s[k]) return; if (e === 'ecart') s[k].rouge += 1; else if (e === 'partiel') s[k].orange += 1 }) })
    return s
  }, [evals, paires])

  const kpis = useMemo(() => {
    let apparies = 0, manquants = 0, blgSeuls = 0, sansEcart = 0, avecEcart = 0
    base.forEach((r) => {
      if (r.statut_appariement === 'manquant_blg') { manquants += 1; return }
      if (r.statut_appariement === 'blg_seul') { blgSeuls += 1; return }
      apparies += 1
      if (compterEcarts(evals.get(cle(r))).rouge > 0) avecEcart += 1; else sansEcart += 1
    })
    return { total: base.length, apparies, manquants, blgSeuls, sansEcart, avecEcart }
  }, [base, evals])

  const rowsFiltrees = useMemo(() => {
    const term = search.trim().toUpperCase()
    return base.filter((r) => {
      if (statutFilter !== 'tous' && r.statut_appariement !== statutFilter) return false
      if (term && !(cle(r).toUpperCase().includes(term) || libelle(r).toUpperCase().includes(term))) return false
      const ev = evals.get(cle(r)) || {}
      if (onlyEcarts && compterEcarts(ev).rouge === 0) return false
      if (champsSelectionnes.length > 0) {
        const concerne = (k: string) => ev[k] === 'ecart' || ev[k] === 'partiel'
        if (combinaison === 'ou' ? !champsSelectionnes.some(concerne) : !champsSelectionnes.every(concerne)) return false
      }
      return true
    })
  }, [base, evals, search, statutFilter, onlyEcarts, champsSelectionnes, combinaison])
  const rowsAffichees = useMemo(() => rowsFiltrees.slice(0, 500), [rowsFiltrees])
  const pairesSelectionnees = useMemo(() => paires.filter((p) => champsSelectionnes.includes(p.key)), [paires, champsSelectionnes])

  function toggleChamp(k: string) { setChampsSelectionnes((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])) }
  const navigation = creerHandlerNavigation(rowsAffichees, rowsAffichees.find((r) => cle(r) === ligneActive) || null, (r) => setLigneActive(cle(r)), (l, s) => (s ? l.findIndex((r) => cle(r) === cle(s)) : -1), listRefs)
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && ligneActive) { e.preventDefault(); setOuvert(ligneActive); return }
    navigation(e)
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(domaine === 'fournisseur' ? 'Fournisseurs SAGE-BLG' : 'Articles SAGE-BLG')
      const simples: { h: string; f: (r: FournRow | ArtRow) => unknown }[] = domaine === 'fournisseur'
        ? [
          { h: 'N° fournisseur', f: (r) => cle(r) }, { h: 'Statut appariement', f: (r) => r.statut_appariement },
          { h: 'Statut appro', f: (r) => (r as FournRow).statut_appro }, { h: "Stratégie d'appro", f: (r) => (r as FournRow).strategie_principale }, { h: 'Suggestion', f: (r) => (r as FournRow).strategie_suggeree },
          { h: 'Calcul de besoin', f: (r) => ((r as FournRow).calcul_besoin_effectif ? 'Oui' : 'Non') }, { h: 'Périodicité', f: (r) => (r as FournRow).periodicite },
          { h: 'Nb champs en écart', f: (r) => compterEcarts(evals.get(cle(r))).rouge }, { h: 'Frs PV', f: (r) => ((r as FournRow).sage_frs_pv ? 'Oui' : 'Non') },
          { h: 'Refs MYSTOCK avec conso', f: (r) => (r as FournRow).sage_nb_refs_mystock_conso }, { h: 'Dernière sortie', f: (r) => fmtMois((r as FournRow).sage_derniere_sortie) },
          { h: 'Code BLG', f: (r) => (r as FournRow).blg_code }, { h: 'Lien BLG', f: (r) => r.lien_blg }, { h: 'Remarque', f: (r) => (r as FournRow).remarque },
        ]
        : [
          { h: 'Référence', f: (r) => cle(r) }, { h: 'Statut appariement', f: (r) => r.statut_appariement }, { h: 'Famille', f: (r) => (r as ArtRow).famille },
          { h: 'MYSTOCK', f: (r) => (r as ArtRow).mystock }, { h: 'Nb champs en écart', f: (r) => compterEcarts(evals.get(cle(r))).rouge },
          { h: 'μ / mois', f: (r) => (r as ArtRow).conso_moy_mensuelle }, { h: 'σ', f: (r) => (r as ArtRow).conso_ecart_type }, { h: 'Couverture FMS (mois)', f: (r) => (r as ArtRow).couverture_fms_mois },
          { h: 'Lien BLG', f: (r) => r.lien_blg },
        ]
      const enTetes: { texte: string; estPaire: boolean; g?: boolean; d?: boolean }[] = simples.map((c) => ({ texte: c.h, estPaire: false }))
      paires.forEach((p) => { enTetes.push({ texte: `${p.labelSage} — SAGE`, estPaire: true, g: true }); enTetes.push({ texte: `${p.labelBlg} — BLG`, estPaire: true, d: true }) })
      ws.addRow(enTetes.map((h) => h.texte))
      const h1 = ws.getRow(1); h1.font = { bold: true }
      h1.eachCell((cell, n) => {
        const h = enTetes[n - 1]; cell.alignment = { wrapText: true, vertical: 'middle' }
        if (h.estPaire) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEUR_ENTETE_PAIRE } }; cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: h.g ? 'medium' : 'thin' }, right: { style: h.d ? 'medium' : 'thin' } } }
      })
      rowsFiltrees.forEach((r) => {
        const ev = evals.get(cle(r)) || {}
        const vals: unknown[] = simples.map((c) => { const v = c.f(r); return v === null || v === undefined ? '' : v })
        paires.forEach((p) => { vals.push(formatCellValue((r as any)[p.sageKey])); vals.push(formatCellValue((r as any)[p.blgKey])) }) // eslint-disable-line @typescript-eslint/no-explicit-any
        const ligne = ws.addRow(vals)
        let col = simples.length
        paires.forEach((p) => {
          const couleur = EVAL_STYLE[ev[p.key] ?? 'vide'].argb
          col += 1; const cs = ligne.getCell(col); col += 1; const cb = ligne.getCell(col)
          cs.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } }; cs.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'medium' } }
          cb.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } }; cb.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'medium' } }
        })
      })
      ws.columns.forEach((c) => { c.width = 22 })
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      const li = rowsFiltrees.length + 3
      ws.getCell(`A${li}`).value = 'Légende :'; ws.getCell(`A${li}`).font = { bold: true }
      ;[['Valeurs identiques ou équivalentes (règle tolérante)', COULEUR_OK], ['Écart réel détecté', COULEUR_ECART], ['Non comparable / donnée manquante / écart partiel', COULEUR_NON_COMPARABLE]].forEach(([t, c], i) => {
        const cell = ws.getCell(`A${li + 1 + i}`); cell.value = t; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c } }
      })
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `comparaison_${domaine}s_sage_blg_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally { setExportEnCours(false) }
  }

  const ligneOuverte = ouvert ? base.find((r) => cle(r) === ouvert) || null : null

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Migration BLG</p>
            <h2 className="mt-0.5 text-[22px] font-bold tracking-tight text-[#111820]">Contrôle de cohérence SAGE ↔ BLG — fournisseurs & articles</h2>
            <p className="mt-1 text-[13px] text-[#8A8474]">Appariement fournisseur sur le code BLG "f + n° tiers SAGE" (761/761), appariement article sur la référence (5 704/5 932).</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDomaine('fournisseur')} className={`rounded-lg border px-4 py-2 text-[13px] font-bold ${domaine === 'fournisseur' ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>Fournisseurs</button>
            <button type="button" onClick={() => setDomaine('article')} className={`rounded-lg border px-4 py-2 text-[13px] font-bold ${domaine === 'article' ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>Articles</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]"><input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" /> Exclure les tiers / articles en sommeil (SAGE)</label>
          {domaine === 'fournisseur' ? (
            <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]"><input type="checkbox" checked={negoceSeul} onChange={(e) => setNegoceSeul(e.target.checked)} className="accent-[#B4761A]" /> Fournisseurs négoce uniquement (hors frais généraux / transport / stations)</label>
          ) : (
            <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]"><input type="checkbox" checked={mystockSeul} onChange={(e) => setMystockSeul(e.target.checked)} className="accent-[#B4761A]" /> Références MYSTOCK actives uniquement</label>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KpiCard label={domaine === 'fournisseur' ? 'Fournisseurs' : 'Articles'} value={kpis.total} loading={loading} />
        <KpiCard label="Appariés avec BLG" value={kpis.apparies} loading={loading} />
        <KpiCard label="Manquants côté BLG" value={kpis.manquants} loading={loading} tone="warn" />
        {domaine === 'fournisseur' ? <KpiCard label="BLG seuls (sans SAGE)" value={kpis.blgSeuls} loading={loading} tone="warn" /> : <KpiCard label="—" value="" loading={false} />}
        <KpiCard label="Sans écart" value={kpis.sansEcart} loading={loading} tone="ok" />
        <KpiCard label="Avec au moins un écart" value={kpis.avecEcart} loading={loading} tone="warn" />
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs contrôlés — écarts par champ</div>
          <div className="flex items-center gap-3 text-[12px]">
            {champsSelectionnes.length >= 2 && (
              <div className="flex items-center gap-1 font-semibold text-[#3A362E]">Concernés par :
                <button type="button" onClick={() => setCombinaison('ou')} className={`rounded px-2 py-0.5 ${combinaison === 'ou' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>au moins un</button>
                <button type="button" onClick={() => setCombinaison('et')} className={`rounded px-2 py-0.5 ${combinaison === 'et' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>tous</button>
              </div>
            )}
            {champsSelectionnes.length > 0 && <button type="button" onClick={() => setChampsSelectionnes([])} className="font-bold text-[#B4761A] hover:underline">Tout désélectionner</button>}
          </div>
        </div>
        {loading ? <div className="h-24 animate-pulse rounded bg-[#F4F3F0]" /> : (
          <div className="flex flex-wrap gap-2">
            {paires.map((p) => {
              const s = statsChamps[p.key]; const actif = champsSelectionnes.includes(p.key)
              return (
                <button key={p.key} type="button" onClick={() => toggleChamp(p.key)} title={`BLG : ${p.labelBlg}`}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#96600F]' : 'border-[#E5E1D8] bg-[#F4F3F0] text-[#3A362E] hover:bg-[#EDEAE1]'}`}>
                  <span>{p.labelSage}</span>
                  {p.compareStrict ? (<>
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700" title="Écarts réels">{s.rouge}</span>
                    <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-bold text-orange-700" title="Partiels / manquants">{s.orange}</span>
                  </>) : <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#8A8474]">affichage</span>}
                </button>
              )
            })}
          </div>
        )}
        <p className="mt-2 text-[12px] text-[#8A8474]">Rouge = écart réel, orange = donnée manquante d'un côté ou écart partiel. Clique un ou plusieurs champs pour filtrer et ajouter les colonnes SAGE / BLG.</p>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={domaine === 'fournisseur' ? 'N° ou raison sociale…' : 'Référence ou désignation…'} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
          <select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value as typeof statutFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="tous">Statut : Tous</option><option value="apparie">Apparié avec BLG</option><option value="manquant_blg">Manquant côté BLG</option>
            {domaine === 'fournisseur' && <option value="blg_seul">BLG seul (sans SAGE)</option>}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"><input type="checkbox" checked={onlyEcarts} onChange={(e) => setOnlyEcarts(e.target.checked)} className="accent-[#B4761A]" /> Avec écart réel uniquement</label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
          <span className="text-[12px] text-[#8A8474]">{rowsFiltrees.length} ligne{rowsFiltrees.length > 1 ? 's' : ''} correspondent aux filtres (sur {base.length})</span>
          <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || rowsFiltrees.length === 0} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
            {exportEnCours ? 'Export en cours…' : `⬇ Exporter en Excel (${rowsFiltrees.length} lignes, tous les champs)`}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{loading ? 'Chargement…' : rowsFiltrees.length > 500 ? `500 affichés sur ${rowsFiltrees.length} — affine ou exporte` : `${rowsFiltrees.length} résultat${rowsFiltrees.length > 1 ? 's' : ''}`}</div>
          <div className="flex items-center gap-3">{error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}<span className="text-[11px] text-[#8A8474]">Clic ou Entrée : fenêtre avec tous les champs comparés</span></div>
        </div>
        <div tabIndex={0} onKeyDown={onListKeyDown} className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                <th className="px-3 py-2 font-bold">{domaine === 'fournisseur' ? 'Fournisseur' : 'Référence'}</th>
                <th className="px-3 py-2 font-bold">Statut</th>
                {pairesSelectionnees.map((p) => (
                  <React.Fragment key={p.key}>
                    <th className="border-l-2 border-[#E5E1D8] px-3 py-2 font-bold">{p.labelSage} — SAGE</th>
                    <th className="border-r-2 border-[#E5E1D8] px-3 py-2 font-bold">{p.labelBlg} — BLG</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsAffichees.map((r, i) => {
                const k = cle(r); const ev = evals.get(k) || {}; const { rouge, orange } = compterEcarts(ev); const actif = ligneActive === k
                return (
                  <tr key={k} ref={(el) => { listRefs.current[i] = el }} onClick={() => { setLigneActive(k); setOuvert(k) }}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${actif ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[12px] font-semibold text-[#3A362E]">{k}</div>
                      <div className="max-w-[360px] truncate text-[12px] text-[#111820]">{libelle(r)}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.statut_appariement === 'manquant_blg' ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Manquant BLG</span>
                        : r.statut_appariement === 'blg_seul' ? <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700">BLG seul</span>
                        : rouge === 0 && orange === 0 ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">OK</span>
                        : <span className="flex flex-wrap gap-1">
                          {rouge > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{rouge} écart{rouge > 1 ? 's' : ''}</span>}
                          {orange > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">{orange} partiel{orange > 1 ? 's' : ''}</span>}
                        </span>}
                    </td>
                    {pairesSelectionnees.map((p) => {
                      const st = EVAL_STYLE[ev[p.key] ?? 'vide']
                      const sv = formatCellValue((r as any)[p.sageKey]), bv = formatCellValue((r as any)[p.blgKey]) // eslint-disable-line @typescript-eslint/no-explicit-any
                      return (
                        <React.Fragment key={p.key}>
                          <td className={`max-w-[260px] truncate border-l-2 border-[#E5E1D8] px-3 py-2 text-[12px] ${st.cellule}`} title={sv}>{sv}</td>
                          <td className={`max-w-[260px] truncate border-r-2 border-[#E5E1D8] px-3 py-2 text-[12px] ${st.cellule}`} title={bv}>{bv}</td>
                        </React.Fragment>
                      )
                    })}
                  </tr>
                )
              })}
              {!loading && rowsAffichees.length === 0 && <tr><td colSpan={2 + pairesSelectionnees.length * 2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {ligneOuverte && (
        <LigneComparaisonModal
          titre={cle(ligneOuverte)} sousTitre={libelle(ligneOuverte)} lien={lien(ligneOuverte)}
          badges={(() => {
            const { rouge, orange } = compterEcarts(evals.get(cle(ligneOuverte)))
            return (<>
              {ligneOuverte.statut_appariement === 'apparie' ? (<>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{rouge} écart{rouge > 1 ? 's' : ''}</span>
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">{orange} partiel{orange > 1 ? 's' : ''}</span>
              </>) : <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">{ligneOuverte.statut_appariement === 'blg_seul' ? 'BLG seul' : 'Manquant BLG'}</span>}
              {'statut_appro' in ligneOuverte && <StatutApproBadge statut={ligneOuverte.statut_appro} />}
              {'mystock' in ligneOuverte && ligneOuverte.mystock === 'OUI' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">MYSTOCK</span>}
            </>)
          })()}
          paires={paires} row={ligneOuverte} evals={evals.get(cle(ligneOuverte)) || {}} onClose={() => setOuvert(null)} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────

type OngletPrincipal = 'fournisseurs' | 'articles' | 'comparaison'

export default function FournisseursSageBlgPage() {
  const [onglet, setOnglet] = useState<OngletPrincipal>('fournisseurs')
  const [fournisseurs, setFournisseurs] = useState<FournRow[]>([])
  const [articles, setArticles] = useState<ArtRow[]>([])
  const [strategies, setStrategies] = useState<StrategieRef[]>([])
  const [parametres, setParametres] = useState<Parametre[]>([])
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function chargerTout() {
    setLoading(true); setError(null); setLoadProgress(0)
    try {
      const [f, s, p] = await Promise.all([
        chargerFournisseurs(),
        supabase.from('appro_strategie_ref').select('*').order('ordre').then(({ data }) => (data || []) as StrategieRef[]),
        supabase.from('appro_parametres').select('*').order('cle').then(({ data }) => (data || []) as Parametre[]),
      ])
      setFournisseurs(f); setStrategies(s); setParametres(p)
      const a = await chargerArticles(setLoadProgress)
      setArticles(a)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => { void chargerTout() }, [])

  return (
    <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Référentiel fournisseurs & approvisionnement</p>
          <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-[#111820]">Fournisseurs & articles SAGE / BLG</h1>
          <p className="mt-1 text-[13px] text-[#8A8474]">Qui est actif, qui passe en calcul de besoin mensuel dans BLG, pour quelles références MYSTOCK, avec quel stock min — et ce qui diverge entre SAGE et BLG.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <OngletTab active={onglet === 'fournisseurs'} onClick={() => setOnglet('fournisseurs')} label="Fournisseurs & stratégie" />
            <OngletTab active={onglet === 'articles'} onClick={() => setOnglet('articles')} label="Articles & stock min" />
            <OngletTab active={onglet === 'comparaison'} onClick={() => setOnglet('comparaison')} label="Comparaison SAGE ↔ BLG" />
          </div>
        </section>

        {onglet === 'fournisseurs' && (
          <OngletFournisseurs rows={fournisseurs} loading={loading} error={error} strategies={strategies} articles={articles}
            onRowChange={(r) => setFournisseurs((prev) => prev.map((x) => (x.numero === r.numero ? r : x)))} />
        )}
        {onglet === 'articles' && (
          <OngletArticles articles={articles} fournisseurs={fournisseurs} loading={loading} loadProgress={loadProgress} error={error}
            parametres={parametres} onParametresChange={setParametres}
            onArticleChange={(a) => setArticles((prev) => prev.map((x) => (x.reference_article === a.reference_article ? a : x)))}
            onRecalcul={chargerTout} />
        )}
        {onglet === 'comparaison' && <OngletComparaison fournisseurs={fournisseurs} articles={articles} loading={loading} error={error} />}
      </div>
    </main>
  )
}
