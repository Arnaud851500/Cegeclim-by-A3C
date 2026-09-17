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
 *
 *    MàJ 14/09/2026 — périmètre classeur & lecture pyramide :
 *      · bascule "Périmètre classeur (135)" : les fournisseurs négoce
 *        MARCHANDISE + PV repris du classeur de stratégie d'appro
 *        (appro_fournisseur_strategie.perimetre_cbn = true). Le flag PV du
 *        classeur est appliqué quand SAGE ne le porte pas (frs_pv forcé).
 *      · pyramide : N fournisseurs → X références actives, dont Y MYSTOCK=OUI
 *        (stock FMS) et Z en stock agence (MYSTOCK≠OUI avec stock hors FMS),
 *        puis répartition par stratégie principale avec les mêmes volumes,
 *        les commandes fournisseurs passées depuis le 1er janvier (dépôt FMS /
 *        hors FMS, croisement avec la page Appro & Achats), la présence d'un
 *        délai d'appro (OUI/NON) et de stocks MIN/MAX (SAGE / BLG) sur les
 *        stratégies Long terme et Au fil de l'eau.
 *      · lecture "achats" : une commande = Long terme si fournisseur Long
 *        terme + dépôt FMS ; Au fil de l'eau si fournisseur Au fil de l'eau +
 *        dépôt FMS ; A la demande pour tout le reste.
 *      · contrôles d'incohérence entre stratégie déclarée et réalité
 *        (commandes FMS sur un fournisseur "A la demande", fil de l'eau sans
 *        MYSTOCK ni commande, Long terme sans commande, plusieurs croix sans
 *        principale, aucune croix).
 *    MàJ 14/09/2026 (bis) — encours & projection :
 *      · l'onglet Articles ne raisonne plus sur le seul stock physique FMS :
 *        encours fournisseur BLG (reste à livrer, dépôt FMS), ventes réservées
 *        SAGE (sto_res dépôt FMS, agences entre parenthèses — le reste à
 *        livrer BLG n'est qu'informatif), stock projeté à la date de
 *        livraison estimée de l'encours (date saisie > commentaire BLG > délai
 *        théorique), rupture avant réception, signal "à commander" et quantité
 *        suggérée (vues v_appro_cdf_encours, v_appro_cdc_a_livrer,
 *        v_appro_article_encours, fonction appro_extraire_date_livraison).
 *      · la pyramide et la fiche fournisseur reprennent ces signaux, et chaque
 *        contrôle de cohérence porte un statut de traitement (à traiter /
 *        correction en cours / à qualifier / règle validée).
 *    MàJ 15/09/2026 — filtres, caractéristiques manuelles, incohérences articles :
 *      · Comparaison (fournisseurs) : filtres sommeil, qualité, stratégie
 *        principale, délai d'appro, commandes de l'année, refs MYSTOCK / non MYSTOCK.
 *      · Articles : filtres qualité et stratégie du fournisseur principal, mise en
 *        sommeil, arrêt appro ; les KPI portent sur le jeu filtré (base : toutes
 *        les références). Caractéristiques manuelles par référence (✎ → fenêtre) :
 *        stock min retenu, délai d'appro / sécurité propres à la référence (jours
 *        calendaires, priment sur le fournisseur dans le calcul de besoin et la
 *        projection), arrêt appro, arrêt vente, référence remplaçante, date d'effet
 *        (appro_article_stock_min, conservées par refresh_appro_calcul_besoin).
 *      · Incohérences par référence (colonne ⚠ en tête de tableau + pastilles
 *        filtrantes) : stock FMS sans MYSTOCK, MYSTOCK chez un fournisseur "A la
 *        demande" / sans stratégie / hors classeur / en sommeil, arrêt appro avec
 *        encours, remplaçante inconnue, etc.
 *    MàJ 17/09/2026 — dernière activité fournisseur :
 *      · la vue expose derniere_cdf_toutes (dernière commande fournisseur BLG,
 *        toutes années), nb_cdf_24m, derniere_activite = max(dernière commande
 *        BLG, dernière sortie BL de ses références sur l'horizon conso 24 mois)
 *        et sans_activite_24m (migration appro_fournisseur_derniere_activite).
 *      · filtre "Activité" (onglets Fournisseurs et Comparaison) : aucune activité
 *        depuis 24 mois / 12 mois, ou active sur les 12 derniers mois ; colonne
 *        "Dern. activité" dans la liste, ligne dédiée dans la fiche, export Excel.
 *    MàJ 17/09/2026 (bis) — listes triables / filtrables, fiche flottante :
 *      · Fournisseurs : la fiche s'ouvre en fenêtre flottante (clic ou Entrée,
 *        Échap pour fermer) et la liste occupe toute la largeur ; filtre "Refs
 *        MYSTOCK" (au moins une / aucune) + carte KPI dédiée ; pastille qualité
 *        SAGE (MARCHANDISE, PV…) ; colonnes MYSTOCK / non MYSTOCK avec, en
 *        dessous, le nombre de refs en stock FMS / en stock agence ; commandes
 *        FMS et agences séparées ; tri par en-tête et filtre par colonne (n° ou
 *        nom, qualité, statut, stratégie, compteurs "&gt;0"…) ; ligne de totaux.
 *      · Articles : les KPI suivent les filtres (jeu filtré) ; tri par en-tête de
 *        colonne (prime sur le tri prédéfini) et filtre d'en-tête sur chaque
 *        colonne (texte "contient", nombres "&gt;10", "vide"/"!vide") ; l'export
 *        Excel reprend la liste filtrée et triée.
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
 * Sources (vues créées par la migration appro_fournisseurs_articles_sage_blg,
 * enrichies par appro_strategie_classeur_135_pyramide) :
 *  - v_appro_controle_fournisseur_sage_blg (SAGE ⟗ BLG, clé 'F'+n° tiers)
 *    + perimetre_cbn, qualite_classeur, frs_pv_force, sage_nb_refs_stock_agence,
 *      sage_nb_refs_mystock_stock_fms, sage_nb_refs_min_max, blg_nb_refs_min_max,
 *      delai_appro_present, delai_appro_retenu, nb_cdf_ytd(_fms/_hors_fms),
 *      montant_ht_cdf_ytd(_fms), derniere_cdf, derniere_cdf_toutes, nb_cdf_24m,
 *      derniere_activite, sans_activite_24m
 *  - v_appro_controle_article_sage_blg   (SAGE ⟕ BLG, clé référence article)
 *  - appro_fournisseur_strategie (+ frs_pv, perimetre_cbn, qualite_classeur),
 *    appro_parametres, appro_article_stock_min
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
  // ── périmètre classeur / pyramide / croisement achats (migration 14/09/2026)
  perimetre_cbn: boolean | null
  qualite_classeur: string | null
  frs_pv_force: boolean | null
  sage_nb_refs_mystock_stock_fms: number | null
  sage_nb_refs_stock_agence: number | null
  sage_nb_refs_min_max: number | null
  blg_nb_refs_min_max: number | null
  nb_refs_min_retenu: number | null
  delai_appro_present: boolean | null
  delai_appro_retenu: number | null
  nb_cdf_ytd: number | null
  nb_cdf_ytd_fms: number | null
  nb_cdf_ytd_hors_fms: number | null
  montant_ht_cdf_ytd: number | null
  montant_ht_cdf_ytd_fms: number | null
  derniere_cdf: string | null
  // ── dernière activité (migration appro_fournisseur_derniere_activite, 17/09/2026)
  derniere_cdf_toutes: string | null     // dernière commande fournisseur BLG, toutes années
  nb_cdf_24m: number | null              // commandes fournisseurs BLG sur 24 mois glissants
  derniere_activite: string | null       // max(dernière commande BLG, dernière sortie BL de ses références)
  sans_activite_24m: boolean | null      // aucune commande ni sortie depuis 24 mois (ou jamais)
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
  // ── encours & projection (migration appro_encours_cdf_cdc_projection_stock)
  encours_fourn_fms: number | null          // reste à livrer fournisseur, dépôt FMS, date estimée fiable
  encours_fourn_total: number | null        // tous dépôts
  nb_cdf_encours_fms: number | null
  date_livraison_estimee_min: string | null
  date_livraison_estimee_max: string | null
  date_livraison_par_defaut: boolean | null  // au moins une commande sans date saisie ni commentaire → délai théorique
  detail_cdf: string | null
  cdc_a_livrer_fms: number | null           // = reserve_sage_fms (sto_res dépôt FMS)
  cdc_a_livrer_total: number | null         // = réservé SAGE tous dépôts
  nb_cdc_a_livrer: number | null
  horizon_jours: number | null
  conso_jusqua_livraison: number | null
  position_stock_fms: number | null         // stock + encours − ventes à livrer
  stock_avant_reception: number | null
  stock_projete_livraison: number | null    // à la date de livraison estimée, après réception
  couverture_projetee_mois: number | null
  rupture_avant_reception: boolean | null
  a_commander: boolean | null
  qte_a_commander: number | null
  sage_stock_dispo_fms: number | null
  sage_stock_terme_fms: number | null
  encours_fourn_retard: number | null       // date estimée dépassée (toujours compté si < cdf_retard_max_jours)
  encours_fourn_douteux: number | null      // dépassée de plus de cdf_retard_max_jours : exclu de la projection
  nb_jours_retard_max: number | null
  // ventes réservées = SAGE sto_res (source de vérité) ; BLG conservé en information
  reserve_sage_fms: number | null
  reserve_sage_agences: number | null
  stock_dispo_sage_fms: number | null
  stock_dispo_sage_agences: number | null
  cdc_blg_fms: number | null
  cdc_blg_total: number | null
  sage_stock_agences: number | null
  // modèle de projection appliqué côté base (appro_parametres projection_*)
  projection_perimetre: 'fms' | 'global' | null
  projection_demande_mode: number | null      // 1 réservations, 2 conso moyenne, 3 max des deux
  projection_horizon_delai: boolean | null    // horizon étendu au délai d'appro L
  projection_stock_base: number | null
  projection_reserve_base: number | null
  projection_encours_base: number | null
  projection_demande: number | null
  projection_delai_l: number | null
  projection_seuil: number | null             // sécurité + conso du délai restant
  encours_global_fiable: number | null
  conso_moy_3_mois: number | null             // = conso_3_derniers_mois / 3
  projection_mu: number | null                // μ retenu pour la demande (12 mois ou 3 mois)
  projection_mu_source: '12m' | '3m' | null
  // caractéristiques manuelles de la référence (appro_article_stock_min, conservées au recalcul)
  delai_securite_jours: number | null         // délai sécurité effectif (référence > fournisseur > défaut)
  delai_appro_ref_jours: number | null        // saisie référence (jours calendaires), prime sur le fournisseur
  delai_securite_ref_jours: number | null
  arret_appro: boolean | null                 // plus de signal à commander
  arret_vente: boolean | null
  ref_remplacante: string | null
  date_effet: string | null
}

type StrategieRef = { code: string; designation: string; outil_cbn: string | null; mode_appro: string | null; calcul_besoin_blg: boolean; ordre: number | null }
type Parametre = { cle: string; valeur: number; description: string | null }

// ─────────────────────────────────────────────────────────────────────────
// Helpers génériques (repris de l'écran client)
// ─────────────────────────────────────────────────────────────────────────

function safeText(v: unknown) { return String(v ?? '').trim() }

/** Message lisible pour une erreur JS ou une PostgrestError (objet simple, pas une Error). */
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}

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
const n0 = (v: number | null | undefined) => Number(v ?? 0)

// ── Activité fournisseur ─────────────────────────────────────────────────
/** Filtre "Activité" : '' = toutes ; aucune activité depuis 24 / 12 mois ;
 * active sur les 12 derniers mois. L'activité = dernière commande
 * fournisseur BLG (toutes années) ou dernière sortie BL de ses références. */
type ActiviteFilter = '' | 'aucune_24m' | 'aucune_12m' | 'active_12m'
const ACTIVITE_OPTIONS: { value: ActiviteFilter; label: string }[] = [
  { value: '', label: 'Activité : Toutes' },
  { value: 'aucune_24m', label: 'Aucune activité depuis 24 mois' },
  { value: 'aucune_12m', label: 'Aucune activité depuis 12 mois' },
  { value: 'active_12m', label: 'Active sur les 12 derniers mois' },
]

/** Nombre de mois écoulés depuis une date (null = jamais). */
function moisDepuis(v: string | null | undefined): number | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) - (now.getDate() < d.getDate() ? 1 : 0)
}

function activiteCorrespond(r: FournRow, filtre: ActiviteFilter): boolean {
  if (!filtre) return true
  const m = moisDepuis(r.derniere_activite)
  if (filtre === 'aucune_24m') return r.sans_activite_24m === true || m === null || m >= 24
  if (filtre === 'aucune_12m') return m === null || m >= 12
  return m !== null && m < 12
}

function libelleActivite(r: FournRow): string {
  if (!r.derniere_activite) return 'Jamais'
  const m = moisDepuis(r.derniere_activite)
  return `${fmtDate(r.derniere_activite)}${m !== null ? ` (${m} mois)` : ''}`
}

// ── Tri et filtre par colonne (listes Fournisseurs et Articles) ────────────
type DirTri = 'asc' | 'desc'
type EtatTri<K extends string = string> = { key: K; dir: DirTri } | null

/** Comparateur générique : null/vide en dernier, nombres en numérique, textes en fr. */
function comparerValeurs(a: unknown, b: unknown): number {
  const va = a === null || a === undefined || a === '' ? null : a
  const vb = b === null || b === undefined || b === '' ? null : b
  if (va === null && vb === null) return 0
  if (va === null) return 1
  if (vb === null) return -1
  if (typeof va === 'boolean' && typeof vb === 'boolean') return Number(va) - Number(vb)
  if (typeof va === 'number' && typeof vb === 'number') return va - vb
  return String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' })
}

function trierPar<T>(rows: T[], tri: EtatTri, val: (r: T, key: string) => unknown): T[] {
  if (!tri) return rows
  const { key, dir } = tri
  return [...rows].sort((a, b) => {
    const c = comparerValeurs(val(a, key), val(b, key))
    // les vides restent en dernier quel que soit le sens
    if (c !== 0 && (val(a, key) === null || val(a, key) === undefined || val(a, key) === '' || val(b, key) === null || val(b, key) === undefined || val(b, key) === '')) return c
    return dir === 'asc' ? c : -c
  })
}

function basculerTri<K extends string>(tri: EtatTri<K>, key: K): EtatTri<K> {
  if (!tri || tri.key !== key) return { key, dir: 'asc' }
  if (tri.dir === 'asc') return { key, dir: 'desc' }
  return null
}

/** Filtre saisi dans l'en-tête d'une colonne :
 *  - texte : "contient" (insensible à la casse et aux accents)
 *  - nombre : ">10", ">=10", "<5", "<=5", "=0", "!=0", ou "12" (égal)
 *  - "vide" / "!vide" : valeur absente / présente
 *  - booléen : oui / non */
function filtreColonneOk(val: unknown, expr: string): boolean {
  const e = expr.trim()
  if (!e) return true
  const vide = val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)
  const el = e.toLowerCase()
  if (el === 'vide') return vide
  if (el === '!vide' || el === 'non vide') return !vide
  if (typeof val === 'boolean') return el === 'oui' || el === 'o' || el === 'true' ? val : el === 'non' || el === 'n' || el === 'false' ? !val : true
  const m = e.match(/^(>=|<=|!=|<>|>|<|=)?\s*(-?\d+(?:[.,]\d+)?)$/)
  const num = typeof val === 'number' ? val : typeof val === 'string' && /^-?\d+([.,]\d+)?$/.test(val.trim()) ? Number(val.replace(',', '.')) : null
  if (m && num !== null) {
    const seuil = Number(m[2].replace(',', '.'))
    switch (m[1] || '=') {
      case '>': return num > seuil
      case '>=': return num >= seuil
      case '<': return num < seuil
      case '<=': return num <= seuil
      case '!=': case '<>': return num !== seuil
      default: return num === seuil
    }
  }
  if (m && vide) return false
  return normaliserTexte(Array.isArray(val) ? val.join(' ') : val).includes(normaliserTexte(e))
}

function IndicateurTri({ actif, dir }: { actif: boolean; dir?: DirTri }) {
  return <span className={`ml-1 text-[10px] ${actif ? 'text-[#B4761A]' : 'text-[#C9C4B8]'}`}>{actif ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
}

/** En-tête de colonne triable. */
function ThTri<K extends string>({ k, label, tri, onTri, align = 'left', title, className = '' }: {
  k: K; label: React.ReactNode; tri: EtatTri<K>; onTri: (k: K) => void; align?: 'left' | 'right'; title?: string; className?: string
}) {
  const actif = tri?.key === k
  return (
    <th className={`cursor-pointer select-none px-2 py-2 font-bold hover:bg-[#EDEAE1] ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} title={title} onClick={() => onTri(k)}>
      <span className={actif ? 'text-[#111820]' : ''}>{label}</span><IndicateurTri actif={actif} dir={tri?.dir} />
    </th>
  )
}

/** Champ de filtre d'en-tête de colonne. */
function InputFiltre({ value, onChange, placeholder = 'filtre', align = 'left' }: { value: string; onChange: (v: string) => void; placeholder?: string; align?: 'left' | 'right' }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} onClick={(e) => e.stopPropagation()}
      className={`h-7 w-full min-w-[56px] rounded border border-[#E5E1D8] bg-white px-1.5 text-[11px] font-normal normal-case tracking-normal text-[#111820] outline-none focus:border-[#B4761A] ${align === 'right' ? 'text-right' : ''} ${value ? 'border-[#B4761A] bg-[#B4761A]/[0.06]' : ''}`} />
  )
}

/** Pastille de qualité SAGE (MARCHANDISE, PV, FRAIS GENERAUX…). */
function QualiteBadge({ qualite }: { qualite: string | null | undefined }) {
  const q = safeText(qualite)
  if (!q) return null
  const up = q.toUpperCase()
  const cls = up.includes('MARCHANDISE') ? 'bg-sky-50 text-sky-800' : up === 'PV' ? 'bg-amber-50 text-amber-700' : 'bg-[#F4F3F0] text-[#8A8474]'
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`} title={`Qualité SAGE : ${q}`}>{q}</span>
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
  { key: 'min_max', labelSage: 'Nb refs avec stock min/max (SAGE)', sageKey: 'sage_nb_refs_min_max', labelBlg: 'Nb refs avec stock min/max DPFMS (BLG)', blgKey: 'blg_nb_refs_min_max', compareStrict: true, comparer: (r) => comparerNumerique(r.sage_nb_refs_min_max ?? 0, r.blg_nb_refs_min_max ?? 0) },
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
// Pyramide périmètre classeur — agrégats & contrôles d'incohérence
// ─────────────────────────────────────────────────────────────────────────

/** Ordre d'affichage des stratégies dans la pyramide (les 2 premières portent
 * les indicateurs délai / stock min-max). Clé '' = stratégie principale non
 * renseignée. */
const STRATEGIES_PYRAMIDE: { code: string; label: string; accent: string; principale: boolean }[] = [
  { code: 'Long terme', label: 'Long terme', accent: '#7A5EA8', principale: true },
  { code: "Au fil de l'eau", label: "Au fil de l'eau", accent: '#3F9142', principale: true },
  { code: 'A la demande', label: 'A la demande / contremarque', accent: '#2F6690', principale: false },
  { code: 'Contremarque', label: 'Contremarque', accent: '#5B5646', principale: false },
  { code: 'Urgence', label: 'Urgence', accent: '#C1683C', principale: false },
  { code: '', label: 'Non renseignée', accent: '#B4761A', principale: false },
]

type AggPyramide = {
  nbFourn: number; nbPv: number
  refsActives: number; mystock: number; mystockStockFms: number; stockAgence: number
  cdf: number; cdfFms: number; cdfHorsFms: number; montantHt: number
  delaiOui: number; delaiNon: number
  minMaxSage: number; minMaxBlg: number; minRetenu: number
  fournAvecMinMax: number; fournSansCdf: number
}
const aggVide = (): AggPyramide => ({ nbFourn: 0, nbPv: 0, refsActives: 0, mystock: 0, mystockStockFms: 0, stockAgence: 0, cdf: 0, cdfFms: 0, cdfHorsFms: 0, montantHt: 0, delaiOui: 0, delaiNon: 0, minMaxSage: 0, minMaxBlg: 0, minRetenu: 0, fournAvecMinMax: 0, fournSansCdf: 0 })
function ajouterAgg(a: AggPyramide, r: FournRow) {
  a.nbFourn += 1
  if (r.sage_frs_pv) a.nbPv += 1
  a.refsActives += n0(r.sage_nb_refs_actives)
  a.mystock += n0(r.sage_nb_refs_mystock)
  a.mystockStockFms += n0(r.sage_nb_refs_mystock_stock_fms)
  a.stockAgence += n0(r.sage_nb_refs_stock_agence)
  a.cdf += n0(r.nb_cdf_ytd); a.cdfFms += n0(r.nb_cdf_ytd_fms); a.cdfHorsFms += n0(r.nb_cdf_ytd_hors_fms); a.montantHt += n0(r.montant_ht_cdf_ytd)
  if (r.delai_appro_present) a.delaiOui += 1; else a.delaiNon += 1
  a.minMaxSage += n0(r.sage_nb_refs_min_max); a.minMaxBlg += n0(r.blg_nb_refs_min_max); a.minRetenu += n0(r.nb_refs_min_retenu)
  if (n0(r.sage_nb_refs_min_max) > 0 || n0(r.blg_nb_refs_min_max) > 0) a.fournAvecMinMax += 1
  if (n0(r.nb_cdf_ytd) === 0) a.fournSansCdf += 1
}

/** Statut de traitement d'un contrôle :
 *  - a_traiter  : à analyser / corriger
 *  - en_cours   : problème connu, correction en cours (ex. délais d'appro SAGE)
 *  - a_qualifier: décision humaine attendue (ex. fournisseurs sans croix)
 *  - valide     : règle acceptée (ex. plusieurs croix → Long terme par défaut) */
type StatutIncoherence = 'a_traiter' | 'en_cours' | 'a_qualifier' | 'valide'
type Incoherence = { code: string; gravite: 'rouge' | 'orange'; statut: StatutIncoherence; libelle: string; fournisseurs: FournRow[] }

const STATUT_INCOHERENCE_STYLE: Record<StatutIncoherence, { label: string; className: string }> = {
  a_traiter: { label: 'À traiter', className: 'bg-red-50 text-red-700' },
  en_cours: { label: 'Correction en cours', className: 'bg-sky-50 text-sky-700' },
  a_qualifier: { label: 'À qualifier (Arnaud)', className: 'bg-[#B4761A]/[0.12] text-[#96600F]' },
  valide: { label: 'Règle validée', className: 'bg-emerald-50 text-emerald-700' },
}

/** Contrôles de cohérence entre la stratégie déclarée et la réalité SAGE /
 * BLG (références, stocks, commandes fournisseurs depuis le 1er janvier).
 * `rows` = périmètre classeur ; `toutes` = tous les fournisseurs SAGE (pour
 * repérer ceux qui achètent hors périmètre). */
function detecterIncoherences(rows: FournRow[], toutes: FournRow[]): Incoherence[] {
  const out: Incoherence[] = []
  const push = (code: string, gravite: 'rouge' | 'orange', statut: StatutIncoherence, libelle: string, source: FournRow[], f: (r: FournRow) => boolean) => {
    const l = source.filter(f)
    if (l.length) out.push({ code, gravite, statut, libelle, fournisseurs: l })
  }
  const negoce = (q: string | null) => ['MARCHANDISE', 'PV', 'MARCHANDISE PV'].includes(safeText(q).toUpperCase())

  push('demande_cdf_fms', 'rouge', 'a_traiter', '"A la demande" mais des commandes livrées au dépôt FMS cette année (relèvent plutôt du fil de l\'eau)', rows,
    (r) => r.strategie_principale === 'A la demande' && n0(r.nb_cdf_ytd_fms) > 0)
  push('demande_mystock', 'orange', 'a_traiter', '"A la demande" avec des références MYSTOCK actives (à sortir de MYSTOCK ou à repasser au fil de l\'eau)', rows,
    (r) => r.strategie_principale === 'A la demande' && n0(r.nb_cdf_ytd_fms) === 0 && n0(r.sage_nb_refs_mystock) > 0)
  push('fil_sans_mystock', 'rouge', 'a_traiter', '"Au fil de l\'eau" sans aucune référence MYSTOCK active : le CBN BLG n\'a rien à calculer', rows,
    (r) => r.strategie_principale === "Au fil de l'eau" && n0(r.sage_nb_refs_mystock) === 0)
  push('fil_sans_cdf_fms', 'orange', 'a_traiter', '"Au fil de l\'eau" sans commande vers le dépôt FMS cette année', rows,
    (r) => r.strategie_principale === "Au fil de l'eau" && n0(r.sage_nb_refs_mystock) > 0 && n0(r.nb_cdf_ytd_fms) === 0)
  push('lt_sans_cdf', 'orange', 'a_traiter', '"Long terme" sans aucune commande cette année (import PV en sommeil ?)', rows,
    (r) => r.strategie_principale === 'Long terme' && n0(r.nb_cdf_ytd) === 0)
  push('sans_strategie', 'orange', 'a_qualifier', 'Dans le classeur mais aucune stratégie cochée', rows,
    (r) => !r.strategie_principale)
  push('multi_sans_principale', 'orange', 'valide', 'Plusieurs stratégies cochées sans choix de principale → Long terme retenu par défaut', rows,
    (r) => !!r.remarque && r.remarque.includes('plusieurs stratégies cochées'))
  push('pv_force', 'orange', 'a_traiter', 'PV dans le classeur mais champ libre "Frs PV" non renseigné dans SAGE (flag forcé côté appli, à saisir dans SAGE)', rows,
    (r) => !!r.frs_pv_force)
  push('qualite_diff', 'orange', 'a_traiter', 'Qualité SAGE différente de la qualité du classeur (ex. MARCHANDISE dans SAGE, PV au classeur)', rows,
    (r) => !!r.qualite_classeur && safeText(r.sage_qualite).toUpperCase() !== safeText(r.qualite_classeur).toUpperCase())
  push('lt_fil_sans_delai', 'orange', 'en_cours', 'Long terme / fil de l\'eau sans délai d\'appro (SAGE, BLG ou paramètre) : le délai par défaut du calcul s\'applique — saisie SAGE en cours', rows,
    (r) => (r.strategie_principale === 'Long terme' || r.strategie_principale === "Au fil de l'eau") && !r.delai_appro_present)
  push('min_max_non_alignes', 'orange', 'a_traiter', 'Long terme / fil de l\'eau : nombre de références avec stock min/max différent entre SAGE et BLG', rows,
    (r) => (r.strategie_principale === 'Long terme' || r.strategie_principale === "Au fil de l'eau") && n0(r.sage_nb_refs_min_max) !== n0(r.blg_nb_refs_min_max))
  push('hors_classeur_actif', 'orange', 'a_qualifier', 'Fournisseur négoce hors classeur mais avec des commandes cette année (à ajouter au périmètre ?)', toutes,
    (r) => !r.perimetre_cbn && r.statut_appariement !== 'blg_seul' && negoce(r.sage_qualite) && !r.sage_en_sommeil && n0(r.nb_cdf_ytd) > 0)
  push('classeur_sans_activite_24m', 'orange', 'a_qualifier', 'Dans le classeur mais aucune activité (commande fournisseur ni sortie BL) depuis 24 mois — à sortir du périmètre ?', rows,
    (r) => activiteCorrespond(r, 'aucune_24m'))
  return out
}

/** Synthèse "articles" du périmètre : signal à commander, ruptures avant
 * réception, encours fournisseurs en retard (références MYSTOCK actives). */
function syntheseArticles(articles: ArtRow[], fournisseurs: Set<string>) {
  const arts = articles.filter((a) => a.pertinent_calcul_besoin && a.fournisseur_principal && fournisseurs.has(a.fournisseur_principal))
  return {
    refs: arts.length,
    aCommander: arts.filter((a) => a.a_commander).length,
    qteACommander: arts.reduce((s, a) => s + n0(a.qte_a_commander), 0),
    rupture: arts.filter((a) => a.rupture_avant_reception).length,
    avecEncours: arts.filter((a) => n0(a.encours_fourn_fms) > 0).length,
    encoursRetard: arts.filter((a) => n0(a.encours_fourn_retard) > 0).length,
    encoursDouteux: arts.filter((a) => n0(a.encours_fourn_douteux) > 0).length,
    dateParDefaut: arts.filter((a) => a.date_livraison_par_defaut).length,
    avecCdc: arts.filter((a) => n0(a.reserve_sage_fms) > 0).length,
  }
}

/** Classement des commandes fournisseurs depuis le 1er janvier selon la règle
 * "achats" : Long terme = fournisseur Long terme + dépôt FMS ; Au fil de l'eau
 * = fournisseur fil de l'eau + dépôt FMS ; tout le reste = A la demande. */
function classerCommandes(rows: FournRow[]) {
  let lt = 0, fil = 0, demande = 0, ltHt = 0, filHt = 0, demandeHt = 0
  rows.forEach((r) => {
    const fms = n0(r.nb_cdf_ytd_fms), hors = n0(r.nb_cdf_ytd_hors_fms), fmsHt = n0(r.montant_ht_cdf_ytd_fms), horsHt = n0(r.montant_ht_cdf_ytd) - fmsHt
    if (r.strategie_principale === 'Long terme') { lt += fms; ltHt += fmsHt; demande += hors; demandeHt += horsHt }
    else if (r.strategie_principale === "Au fil de l'eau") { fil += fms; filHt += fmsHt; demande += hors; demandeHt += horsHt }
    else { demande += fms + hors; demandeHt += fmsHt + horsHt }
  })
  return { lt, fil, demande, ltHt, filHt, demandeHt, total: lt + fil + demande }
}

function PyramideClasseur({ rows, toutes, articles, loading, strategieActive, onStrategie, onSelectFournisseur }: {
  rows: FournRow[]; toutes: FournRow[]; articles: ArtRow[]; loading: boolean; strategieActive: string | null; onStrategie: (code: string | null) => void; onSelectFournisseur: (r: FournRow) => void
}) {
  const [incOuverte, setIncOuverte] = useState<string | null>(null)

  const total = useMemo(() => { const a = aggVide(); rows.forEach((r) => ajouterAgg(a, r)); return a }, [rows])
  const fournSet = useMemo(() => new Set(rows.map((r) => r.numero)), [rows])
  const artSynthese = useMemo(() => syntheseArticles(articles, fournSet), [articles, fournSet])
  const artParStrategie = useMemo(() => {
    const m = new Map<string, ReturnType<typeof syntheseArticles>>()
    STRATEGIES_PYRAMIDE.forEach((s) => m.set(s.code, syntheseArticles(articles, new Set(rows.filter((r) => (r.strategie_principale || '') === s.code).map((r) => r.numero)))))
    return m
  }, [articles, rows])
  const parStrategie = useMemo(() => {
    const m = new Map<string, AggPyramide>()
    STRATEGIES_PYRAMIDE.forEach((s) => m.set(s.code, aggVide()))
    rows.forEach((r) => {
      const code = r.strategie_principale || ''
      if (!m.has(code)) m.set(code, aggVide())
      ajouterAgg(m.get(code)!, r)
    })
    return m
  }, [rows])
  const commandes = useMemo(() => classerCommandes(rows), [rows])
  const incoherences = useMemo(() => detecterIncoherences(rows, toutes), [rows, toutes])
  const anneeCourante = new Date().getFullYear()

  if (loading) return <section className="h-48 animate-pulse rounded-xl bg-[#F4F3F0]" />

  const strategiesAffichees = STRATEGIES_PYRAMIDE.filter((s) => (parStrategie.get(s.code)?.nbFourn ?? 0) > 0)

  return (
    <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-bold text-[#111820]">Pyramide du périmètre classeur</div>
          <p className="mt-0.5 max-w-3xl text-[12px] text-[#8A8474]">
            Fournisseurs négoce (MARCHANDISE + PV) repris du classeur de stratégie d'appro. Références actives = hors sommeil ; stock FMS = MYSTOCK OUI (dont celles réellement en stock au dépôt) ; stock agence = MYSTOCK ≠ OUI avec du stock hors FMS.
            Commandes = commandes fournisseurs BLG créées depuis le 01/01/{anneeCourante} (page Appro &amp; Achats), dépôt FMS vs agences.
          </p>
        </div>
        {strategieActive !== null && (
          <button type="button" onClick={() => onStrategie(null)} className="text-[12px] font-bold text-[#B4761A] hover:underline">Retirer le filtre stratégie</button>
        )}
      </div>

      {/* Sommet de la pyramide */}
      <div className="mt-4 rounded-xl border border-[#111820] bg-[#111820] p-4 text-white">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div><span className="text-[30px] font-bold tracking-tight">{fmtNum(total.nbFourn)}</span> <span className="text-[13px] opacity-80">fournisseurs</span> <span className="text-[12px] opacity-60">(dont {fmtNum(total.nbPv)} PV)</span></div>
          <div className="text-[13px] opacity-80">→</div>
          <div><span className="text-[24px] font-bold">{fmtNum(total.refsActives)}</span> <span className="text-[13px] opacity-80">références actives</span></div>
          <div className="text-[13px]"><span className="font-bold text-emerald-300">{fmtNum(total.mystock)}</span> <span className="opacity-80">en stock FMS (MYSTOCK OUI)</span> <span className="opacity-60">· {fmtNum(total.mystockStockFms)} avec stock &gt; 0</span></div>
          <div className="text-[13px]"><span className="font-bold text-sky-300">{fmtNum(total.stockAgence)}</span> <span className="opacity-80">en stock agence (MYSTOCK NON)</span></div>
          <div className="text-[13px]"><span className="font-bold text-[#E9C982]">{fmtNum(total.cdf)}</span> <span className="opacity-80">commandes {anneeCourante}</span> <span className="opacity-60">· {fmtNum(total.cdfFms)} FMS / {fmtNum(total.cdfHorsFms)} agences · {fmtEuro(total.montantHt)} HT</span></div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/15 pt-2 text-[12px] opacity-90">
          <span>Lecture achats : <b>{fmtNum(commandes.lt)}</b> cdes Long terme (FMS) · <b>{fmtNum(commandes.fil)}</b> cdes Au fil de l'eau (FMS) · <b>{fmtNum(commandes.demande)}</b> cdes A la demande (agences + reste)</span>
          <span className="opacity-70">{fmtEuro(commandes.ltHt)} / {fmtEuro(commandes.filHt)} / {fmtEuro(commandes.demandeHt)} HT</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/15 pt-2 text-[12px] opacity-90">
          <span>Projection FMS sur {fmtNum(artSynthese.refs)} refs MYSTOCK : <b className={artSynthese.aCommander ? 'text-[#F2B8A2]' : ''}>{fmtNum(artSynthese.aCommander)}</b> à commander ({fmtNum(artSynthese.qteACommander)} pièces)</span>
          <span><b className={artSynthese.rupture ? 'text-[#F2B8A2]' : ''}>{fmtNum(artSynthese.rupture)}</b> rupture avant réception</span>
          <span>{fmtNum(artSynthese.avecEncours)} avec encours fournisseur · <b className={artSynthese.encoursRetard ? 'text-[#E9C982]' : ''}>{fmtNum(artSynthese.encoursRetard)}</b> en retard · {fmtNum(artSynthese.encoursDouteux)} douteux (exclus)</span>
          <span>{fmtNum(artSynthese.dateParDefaut)} sans date de livraison (délai théorique) · {fmtNum(artSynthese.avecCdc)} avec réservé FMS (SAGE)</span>
        </div>
      </div>

      {/* Répartition par stratégie principale */}
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {strategiesAffichees.map((s) => {
          const a = parStrategie.get(s.code)!
          const actif = strategieActive === s.code
          const pct = total.nbFourn ? Math.round((a.nbFourn / total.nbFourn) * 100) : 0
          return (
            <button key={s.code || '__none'} type="button" onClick={() => onStrategie(actif ? null : s.code)}
              className={`rounded-xl border p-4 text-left transition-colors ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.06] ring-2 ring-[#B4761A]/40' : 'border-[#E5E1D8] bg-white hover:bg-[#F4F3F0]'}`}
              style={{ borderLeftWidth: 5, borderLeftColor: s.accent }}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[14px] font-bold text-[#111820]">{s.label}</div>
                <div className="text-[11px] text-[#8A8474]">{pct} %</div>
              </div>
              <div className="mt-1 text-[26px] font-bold tracking-tight" style={{ color: s.accent }}>{fmtNum(a.nbFourn)} <span className="text-[12px] font-semibold text-[#8A8474]">fournisseurs{a.nbPv ? ` · ${a.nbPv} PV` : ''}</span></div>

              <div className="mt-2 grid grid-cols-3 gap-1 text-[12px]">
                <div><div className="text-[10px] uppercase text-[#8A8474]">Refs actives</div><div className="font-bold text-[#111820]">{fmtNum(a.refsActives)}</div></div>
                <div><div className="text-[10px] uppercase text-[#8A8474]">Stock FMS</div><div className="font-bold text-emerald-700">{fmtNum(a.mystock)} <span className="text-[10px] font-normal text-[#8A8474]">({fmtNum(a.mystockStockFms)} &gt; 0)</span></div></div>
                <div><div className="text-[10px] uppercase text-[#8A8474]">Stock agences</div><div className="font-bold text-sky-700">{fmtNum(a.stockAgence)}</div></div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1 border-t border-[#F4F3F0] pt-2 text-[12px]">
                <div><div className="text-[10px] uppercase text-[#8A8474]">Cdes {anneeCourante}</div><div className="font-bold text-[#111820]">{fmtNum(a.cdf)}</div></div>
                <div><div className="text-[10px] uppercase text-[#8A8474]">dont FMS</div><div className="font-bold text-[#111820]">{fmtNum(a.cdfFms)}</div></div>
                <div><div className="text-[10px] uppercase text-[#8A8474]">dont agences</div><div className="font-bold text-[#111820]">{fmtNum(a.cdfHorsFms)}</div></div>
              </div>

              {s.principale && (
                <div className="mt-2 grid grid-cols-2 gap-1 border-t border-[#F4F3F0] pt-2 text-[12px]">
                  <div>
                    <div className="text-[10px] uppercase text-[#8A8474]">Délai d'appro renseigné</div>
                    <div><span className="font-bold text-emerald-700">OUI {fmtNum(a.delaiOui)}</span> <span className="text-[#8A8474]">/</span> <span className={`font-bold ${a.delaiNon ? 'text-red-700' : 'text-[#8A8474]'}`}>NON {fmtNum(a.delaiNon)}</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-[#8A8474]">Stock MIN / MAX présent</div>
                    <div className="text-[#111820]"><b>{fmtNum(a.fournAvecMinMax)}</b> fourn. · SAGE {fmtNum(a.minMaxSage)} refs · BLG {fmtNum(a.minMaxBlg)} refs{a.minRetenu ? ` · retenu ${fmtNum(a.minRetenu)}` : ''}</div>
                  </div>
                </div>
              )}
              {(() => {
                const as = artParStrategie.get(s.code)
                if (!as || as.refs === 0) return null
                return (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-[#F4F3F0] pt-2 text-[11px] text-[#3A362E]">
                    <span><b className={as.aCommander ? 'text-red-700' : ''}>{fmtNum(as.aCommander)}</b> à commander</span>
                    <span><b className={as.rupture ? 'text-red-700' : ''}>{fmtNum(as.rupture)}</b> rupture avant réception</span>
                    <span><b className={as.encoursRetard ? 'text-[#96600F]' : ''}>{fmtNum(as.encoursRetard)}</b> encours en retard</span>
                    <span>{fmtNum(as.dateParDefaut)} sans date</span>
                  </div>
                )
              })()}
              {a.fournSansCdf > 0 && <div className="mt-1 text-[11px] text-[#8A8474]">{a.fournSansCdf} sans commande cette année</div>}
            </button>
          )
        })}
      </div>

      {/* Incohérences */}
      <div className="mt-4 border-t border-[#E5E1D8] pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="text-[12px] font-bold text-[#111820]">Contrôles de cohérence</div>
          {(['a_traiter', 'en_cours', 'a_qualifier', 'valide'] as StatutIncoherence[]).map((st) => {
            const n = incoherences.filter((i) => i.statut === st).reduce((s, i) => s + i.fournisseurs.length, 0)
            if (!n) return null
            return <span key={st} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUT_INCOHERENCE_STYLE[st].className}`}>{STATUT_INCOHERENCE_STYLE[st].label} : {n}</span>
          })}
          {incoherences.length === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Aucune incohérence détectée</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {incoherences.map((inc) => (
            <button key={inc.code} type="button" onClick={() => setIncOuverte((v) => (v === inc.code ? null : inc.code))}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] font-semibold transition-colors ${incOuverte === inc.code ? 'border-[#B4761A] bg-[#B4761A]/[0.1]' : 'border-[#E5E1D8] bg-[#F4F3F0] hover:bg-[#EDEAE1]'} ${inc.statut === 'valide' ? 'opacity-70' : ''}`}>
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${inc.gravite === 'rouge' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{inc.fournisseurs.length}</span>
              <span className="text-[#3A362E]">{inc.libelle}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${STATUT_INCOHERENCE_STYLE[inc.statut].className}`}>{STATUT_INCOHERENCE_STYLE[inc.statut].label}</span>
            </button>
          ))}
        </div>
        {incOuverte && (() => {
          const inc = incoherences.find((i) => i.code === incOuverte)
          if (!inc) return null
          return (
            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-[#E5E1D8]">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-[#F4F3F0] text-[10px] uppercase text-[#8A8474]">
                  <tr><th className="px-2 py-1">Fournisseur</th><th className="px-2 py-1">Stratégie</th><th className="px-2 py-1 text-right">Refs act. / MYSTOCK</th><th className="px-2 py-1 text-right">Cdes FMS / total</th><th className="px-2 py-1 text-right">Délai</th><th className="px-2 py-1 text-right">Dern. activité</th><th className="px-2 py-1">Remarque</th></tr>
                </thead>
                <tbody>
                  {inc.fournisseurs.map((r) => (
                    <tr key={r.numero} onClick={() => onSelectFournisseur(r)} className="cursor-pointer border-t border-[#F4F3F0] hover:bg-[#F4F3F0]">
                      <td className="px-2 py-1"><span className="font-mono font-semibold">{r.numero}</span> <span className="text-[#111820]">{r.sage_intitule}</span>{r.sage_frs_pv && <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">PV</span>}</td>
                      <td className="px-2 py-1">{r.strategie_principale || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtNum(r.sage_nb_refs_actives)} / {fmtNum(r.sage_nb_refs_mystock)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtNum(r.nb_cdf_ytd_fms)} / {fmtNum(r.nb_cdf_ytd)}</td>
                      <td className="px-2 py-1 text-right">{r.delai_appro_present ? `${fmtNum(r.delai_appro_retenu)} j` : 'NON'}</td>
                      <td className={`px-2 py-1 text-right ${r.sans_activite_24m ? 'font-semibold text-red-700' : ''}`}>{libelleActivite(r)}</td>
                      <td className="max-w-[320px] truncate px-2 py-1 text-[#8A8474]" title={r.remarque || ''}>{r.remarque || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Fournisseurs
// ─────────────────────────────────────────────────────────────────────────

type StrategieForm = {
  long_terme: boolean; au_fil_de_leau: boolean; contremarque: boolean
  strategie_principale: string; calcul_besoin_periodique: 'auto' | 'oui' | 'non'
  periodicite: string; delai_appro_jours: string; delai_securite_jours: string; niveau_service_z: string; remarque: string
  frs_pv: boolean; perimetre_cbn: boolean
}

type CleTriFourn = 'numero' | 'nom' | 'qualite' | 'statut' | 'strategie' | 'refs' | 'mystock' | 'non_mystock' | 'cdf_fms' | 'cdf_agences' | 'delai' | 'activite'
type FiltresColFourn = Partial<Record<CleTriFourn, string>>

/** Valeur d'une colonne de la liste fournisseurs (tri et filtre). */
function valeurColFourn(r: FournRow, k: CleTriFourn): unknown {
  switch (k) {
    case 'numero': return r.numero
    case 'nom': return r.sage_intitule || r.blg_intitule || ''
    case 'qualite': return r.sage_qualite
    case 'statut': return r.statut_appro ? STATUT_APPRO_STYLE[r.statut_appro].label : ''
    case 'strategie': return r.strategie_principale || ''
    case 'refs': return n0(r.sage_nb_refs_actives)
    case 'mystock': return n0(r.sage_nb_refs_mystock)
    case 'non_mystock': return Math.max(0, n0(r.sage_nb_refs_actives) - n0(r.sage_nb_refs_mystock))
    case 'cdf_fms': return n0(r.nb_cdf_ytd_fms)
    case 'cdf_agences': return n0(r.nb_cdf_ytd_hors_fms)
    case 'delai': return r.delai_appro_present ? n0(r.delai_appro_retenu) : null
    case 'activite': return r.derniere_activite
  }
}

/** Fiche fournisseur & stratégie d'appro — fenêtre flottante ouverte au clic
 * sur une ligne de la liste (ou depuis la pyramide). */
function FicheFournisseurModal({ selected, strategies, articles, onRowChange, onClose }: {
  selected: FournRow; strategies: StrategieRef[]; articles: ArtRow[]; onRowChange: (r: FournRow) => void; onClose: () => void
}) {
  const [form, setForm] = useState<StrategieForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    setForm({
      long_terme: !!selected.long_terme, au_fil_de_leau: !!selected.au_fil_de_leau, contremarque: !!selected.contremarque,
      strategie_principale: selected.strategie_principale || '',
      calcul_besoin_periodique: 'auto',
      periodicite: selected.periodicite || 'mensuel',
      delai_appro_jours: selected.param_delai_appro !== null && selected.param_delai_appro !== undefined ? String(selected.param_delai_appro) : '',
      delai_securite_jours: '', niveau_service_z: '', remarque: selected.remarque || '',
      frs_pv: !!selected.frs_pv_force, perimetre_cbn: !!selected.perimetre_cbn,
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
        frs_pv: !!data.frs_pv, perimetre_cbn: !!data.perimetre_cbn,
      } : f)
    })
  }, [selected.numero]) // eslint-disable-line react-hooks/exhaustive-deps

  // Échap ferme la fenêtre
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function enregistrer() {
    if (!form) return
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
        frs_pv: form.frs_pv ? true : null,
        perimetre_cbn: form.perimetre_cbn,
        updated_at: new Date().toISOString(),
      }
      const { error: err } = await supabase.from('appro_fournisseur_strategie').upsert(payload, { onConflict: 'fournisseur' })
      if (err) throw err
      const { data, error: err2 } = await supabase.from('v_appro_controle_fournisseur_sage_blg').select('*').eq('numero', selected.numero).maybeSingle()
      if (err2) throw err2
      if (data) onRowChange(data as FournRow)
      setSaveMsg('Stratégie enregistrée. Relance le calcul de besoin (onglet Articles) si tu as changé un délai ou le niveau de service.')
    } catch (e) {
      setSaveMsg('Erreur : ' + messageErreur(e))
    } finally { setSaving(false) }
  }

  const refsFournisseur = useMemo(() =>
    articles.filter((a) => a.fournisseur_principal === selected.numero && a.pertinent_calcul_besoin).sort((a, b) => (b.conso_horizon || 0) - (a.conso_horizon || 0)),
  [articles, selected.numero])
  const encoursFournisseur = useMemo(() => {
    const s = { encours: 0, retard: 0, douteux: 0, cdc: 0, aCommander: 0, qte: 0, rupture: 0, sansDate: 0 }
    refsFournisseur.forEach((a) => {
      s.encours += n0(a.encours_fourn_fms); s.retard += n0(a.encours_fourn_retard); s.douteux += n0(a.encours_fourn_douteux); s.cdc += n0(a.cdc_a_livrer_fms)
      if (a.a_commander) { s.aCommander += 1; s.qte += n0(a.qte_a_commander) }
      if (a.rupture_avant_reception) s.rupture += 1
      if (a.date_livraison_par_defaut) s.sansDate += 1
    })
    return s
  }, [refsFournisseur])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#E5E1D8] px-5 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Fiche fournisseur & stratégie d'appro</div>
            <div className="mt-1 font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero} {selected.blg_code ? <span className="text-[#B3AD9E]">· BLG {selected.blg_code}</span> : null}</div>
            <div className="text-[18px] font-bold text-[#111820]">{selected.sage_intitule || '—'}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5"><StatutApproBadge statut={selected.statut_appro} />
              <QualiteBadge qualite={selected.sage_qualite} />
              {selected.sage_frs_pv && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">PV{selected.frs_pv_force ? ' (forcé, SAGE non renseigné)' : ''}</span>}
              {selected.perimetre_cbn && <span className="rounded-full bg-[#111820] px-2 py-0.5 text-[11px] font-bold text-white">Classeur{selected.qualite_classeur ? ` · ${selected.qualite_classeur}` : ''}</span>}
              {selected.blg_statut_partenaire && selected.blg_statut_partenaire !== 'active' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">BLG partenaire : {selected.blg_statut_partenaire}</span>}
              {activiteCorrespond(selected, 'aucune_24m') && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Sans activité depuis 24 mois</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {selected.lien_blg && <a href={selected.lien_blg} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>}
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0] hover:text-[#111820]">✕ Fermer</button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          {form && (
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
              <div className="grid grid-cols-2 gap-2 px-2 py-1 text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.perimetre_cbn} onChange={(e) => setForm({ ...form, perimetre_cbn: e.target.checked })} className="accent-[#B4761A]" /> Dans le périmètre classeur</label>
                <label className="flex items-center gap-2" title="Force le badge PV quand le champ libre SAGE « Frs PV » n'est pas renseigné"><input type="checkbox" checked={form.frs_pv} onChange={(e) => setForm({ ...form, frs_pv: e.target.checked })} className="accent-[#B4761A]" /> Fournisseur PV (forcer si absent de SAGE)</label>
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
                  <input value={form.delai_appro_jours} onChange={(e) => setForm({ ...form, delai_appro_jours: e.target.value })} placeholder={selected.sage_delai_appro ? `SAGE ${selected.sage_delai_appro}` : selected.blg_delai_appro ? `BLG ${selected.blg_delai_appro}` : 'défaut'} className="h-8 rounded-lg border border-[#E5E1D8] px-2" /></label>
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
          )}

          <div className="grid gap-x-6 md:grid-cols-2">
            <div>
              <DetailGroup title="Délai & stocks min / max">
                <DetailRow label="Délai d'appro renseigné" value={selected.delai_appro_present ? <span className="font-semibold text-emerald-700">OUI — {fmtNum(selected.delai_appro_retenu)} j (paramètre {fmtNum(selected.param_delai_appro)} · SAGE {fmtNum(selected.sage_delai_appro)} · BLG {fmtNum(selected.blg_delai_appro)})</span> : <span className="font-semibold text-red-700">NON — délai par défaut du calcul</span>} />
                <DetailRow label="Refs actives avec stock min/max SAGE (FMS)" value={fmtNum(selected.sage_nb_refs_min_max)} />
                <DetailRow label="Refs actives avec stock min/max BLG (DPFMS)" value={fmtNum(selected.blg_nb_refs_min_max)} />
                <DetailRow label="Refs avec stock min retenu (saisie appli)" value={fmtNum(selected.nb_refs_min_retenu)} />
              </DetailGroup>

              <DetailGroup title={`Commandes fournisseurs ${new Date().getFullYear()} (BLG)`}>
                <DetailRow label="Commandes (dépôt FMS / agences / total)" value={`${fmtNum(selected.nb_cdf_ytd_fms)} / ${fmtNum(selected.nb_cdf_ytd_hors_fms)} / ${fmtNum(selected.nb_cdf_ytd)}`} />
                <DetailRow label="Montant HT (dont FMS)" value={`${fmtEuro(selected.montant_ht_cdf_ytd)} (${fmtEuro(selected.montant_ht_cdf_ytd_fms)})`} />
                <DetailRow label="Dernière commande" value={fmtDate(selected.derniere_cdf)} />
                <DetailRow label="Lecture achats" value={
                  selected.strategie_principale === 'Long terme' || selected.strategie_principale === "Au fil de l'eau"
                    ? `${fmtNum(selected.nb_cdf_ytd_fms)} cdes ${selected.strategie_principale} (FMS) + ${fmtNum(selected.nb_cdf_ytd_hors_fms)} cdes A la demande (agences)`
                    : `${fmtNum(selected.nb_cdf_ytd)} cdes A la demande`
                } />
              </DetailGroup>

              <DetailGroup title="Activité (toutes années)">
                <DetailRow label="Dernière activité" value={activiteCorrespond(selected, 'aucune_24m') ? <span className="font-semibold text-red-700">{libelleActivite(selected)} — aucune activité depuis 24 mois</span> : libelleActivite(selected)} />
                <DetailRow label="Dernière commande fournisseur BLG (toutes années)" value={fmtDate(selected.derniere_cdf_toutes)} />
                <DetailRow label="Commandes fournisseurs sur 24 mois glissants" value={fmtNum(selected.nb_cdf_24m)} />
                <DetailRow label="Dernière sortie BL de ses références (horizon 24 mois)" value={fmtMois(selected.sage_derniere_sortie)} />
              </DetailGroup>
            </div>
            <div>
              <DetailGroup title="Volumes & activité (SAGE)">
                <DetailRow label="Qualité" value={selected.sage_qualite} />
                <DetailRow label="Références (total / actives)" value={`${fmtNum(selected.sage_nb_refs)} / ${fmtNum(selected.sage_nb_refs_actives)}`} />
                <DetailRow label="Refs MYSTOCK actives (dont avec conso / avec stock min calculé / en stock FMS)" value={`${fmtNum(selected.sage_nb_refs_mystock)} (${fmtNum(selected.sage_nb_refs_mystock_conso)} / ${fmtNum(selected.sage_nb_refs_stock_min)} / ${fmtNum(selected.sage_nb_refs_mystock_stock_fms)})`} />
                <DetailRow label="Refs actives en stock agence (MYSTOCK NON, stock hors FMS)" value={fmtNum(selected.sage_nb_refs_stock_agence)} />
                <DetailRow label="Refs en stock FMS (tous MYSTOCK)" value={fmtNum(selected.sage_nb_refs_stock_fms)} />
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

              <DetailGroup title="Encours & projection FMS (références MYSTOCK actives)">
                <DetailRow label="Encours fournisseur FMS (fiable / en retard / douteux exclu)" value={`${fmtNum(encoursFournisseur.encours)} / ${fmtNum(encoursFournisseur.retard)} / ${fmtNum(encoursFournisseur.douteux)} pièces`} />
                <DetailRow label="Ventes réservées FMS (SAGE sto_res)" value={fmtNum(encoursFournisseur.cdc)} />
                <DetailRow label="Références à commander (projeté < stock min)" value={encoursFournisseur.aCommander ? <span className="font-semibold text-red-700">{fmtNum(encoursFournisseur.aCommander)} — {fmtNum(encoursFournisseur.qte)} pièces suggérées</span> : '0'} />
                <DetailRow label="Rupture avant réception" value={encoursFournisseur.rupture ? <span className="font-semibold text-red-700">{fmtNum(encoursFournisseur.rupture)}</span> : '0'} />
                <DetailRow label="Commandes sans date de livraison (délai théorique)" value={fmtNum(encoursFournisseur.sansDate)} />
              </DetailGroup>
            </div>
          </div>

          <DetailGroup title={`Références MYSTOCK actives (${refsFournisseur.length}) — triées par conso`}>
            <div className="max-h-72 overflow-auto rounded-lg border border-[#E5E1D8]">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-[#F4F3F0] text-[10px] uppercase text-[#8A8474]">
                  <tr><th className="px-2 py-1">Référence</th><th className="px-2 py-1 text-right">μ/mois</th><th className="px-2 py-1 text-right">Stock FMS</th><th className="px-2 py-1 text-right">Encours</th><th className="px-2 py-1 text-right">Réservé</th><th className="px-2 py-1 text-right">Projeté</th><th className="px-2 py-1 text-right">Min calc.</th><th className="px-2 py-1 text-right">À cmder</th></tr>
                </thead>
                <tbody>
                  {refsFournisseur.map((a) => (
                    <tr key={a.reference_article} className={`border-t border-[#F4F3F0] ${a.a_commander ? 'bg-red-50/40' : ''}`}>
                      <td className="px-2 py-1"><span className="font-mono font-semibold">{a.reference_article}</span><div className="truncate text-[11px] text-[#8A8474]">{a.sage_designation}</div></td>
                      <td className="px-2 py-1 text-right">{fmtNum(a.conso_moy_mensuelle, 1)}</td>
                      <td className="px-2 py-1 text-right">{fmtNum(a.sage_stock_fms)}</td>
                      <td className="px-2 py-1 text-right">{n0(a.encours_fourn_fms) > 0 ? <span title={a.detail_cdf || ''}>{fmtNum(a.encours_fourn_fms)}{n0(a.encours_fourn_retard) > 0 ? <span className="ml-0.5 text-[#96600F]">⏱</span> : ''}</span> : '—'}</td>
                      <td className="px-2 py-1 text-right">{n0(a.cdc_a_livrer_fms) > 0 ? fmtNum(a.cdc_a_livrer_fms) : '—'}</td>
                      <td className={`px-2 py-1 text-right ${a.rupture_avant_reception ? 'font-bold text-red-700' : ''}`}>{fmtNum(a.stock_projete_livraison)}</td>
                      <td className="px-2 py-1 text-right font-bold">{fmtNum(a.calc_stock_min)}</td>
                      <td className="px-2 py-1 text-right">{a.a_commander ? <span className="font-bold text-red-700">{fmtNum(a.qte_a_commander)}</span> : '—'}</td>
                    </tr>
                  ))}
                  {refsFournisseur.length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-center text-[#8A8474]">Aucune référence MYSTOCK active.</td></tr>}
                </tbody>
              </table>
            </div>
          </DetailGroup>
        </div>
      </div>
    </div>
  )
}

function OngletFournisseurs({ rows, loading, error, strategies, onRowChange, articles }: {
  rows: FournRow[]; loading: boolean; error: string | null; strategies: StrategieRef[]
  onRowChange: (r: FournRow) => void; articles: ArtRow[]
}) {
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState<'' | StatutAppro>('')
  const [qualiteFilter, setQualiteFilter] = useState('')
  const [activiteFilter, setActiviteFilter] = useState<ActiviteFilter>('')
  const [mystockFilter, setMystockFilter] = useState<'tous' | 'avec' | 'sans'>('tous')
  const [masquerSommeil, setMasquerSommeil] = useState(true)
  const [masquerHorsNegoce, setMasquerHorsNegoce] = useState(true)
  // Bascule rapide sur les fournisseurs du classeur (MARCHANDISE + PV) — active par défaut.
  const [perimetreSeul, setPerimetreSeul] = useState(true)
  const [strategieFilter, setStrategieFilter] = useState<string | null>(null)
  // Tri et filtres par colonne de la liste
  const [tri, setTri] = useState<EtatTri<CleTriFourn>>(null)
  const [filtresCol, setFiltresCol] = useState<FiltresColFourn>({})
  // ligne surlignée au clavier (↑/↓), fiche ouverte au clic ou avec Entrée
  const [ligneActive, setLigneActive] = useState<FournRow | null>(null)
  const [selected, setSelected] = useState<FournRow | null>(null)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  const qualites = useMemo(() => Array.from(new Set(rows.map((r) => safeText(r.sage_qualite)).filter(Boolean))).sort(), [rows])
  const nbPerimetre = useMemo(() => rows.filter((r) => r.perimetre_cbn).length, [rows])
  const rowsPerimetre = useMemo(() => rows.filter((r) => r.perimetre_cbn && r.statut_appariement !== 'blg_seul'), [rows])

  // La fiche ouverte suit la ligne mise à jour (après enregistrement de la stratégie)
  useEffect(() => {
    if (!selected) return
    const maj = rows.find((r) => r.numero === selected.numero)
    if (maj && maj !== selected) setSelected(maj)
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtres = useMemo(() => {
    const term = search.trim().toUpperCase()
    const clesFiltre = (Object.keys(filtresCol) as CleTriFourn[]).filter((k) => (filtresCol[k] || '').trim())
    const base = rows.filter((r) => {
      if (r.statut_appariement === 'blg_seul') return false
      if (perimetreSeul && !r.perimetre_cbn) return false
      if (!perimetreSeul && masquerSommeil && r.statut_appro === 'SOMMEIL') return false
      if (!perimetreSeul && masquerHorsNegoce && r.statut_appro === 'HORS_NEGOCE') return false
      if (strategieFilter !== null && (r.strategie_principale || '') !== strategieFilter) return false
      if (statutFilter && r.statut_appro !== statutFilter) return false
      if (qualiteFilter && safeText(r.sage_qualite) !== qualiteFilter) return false
      if (!activiteCorrespond(r, activiteFilter)) return false
      if (mystockFilter !== 'tous' && (n0(r.sage_nb_refs_mystock) > 0) !== (mystockFilter === 'avec')) return false
      if (term && !(r.numero.toUpperCase().includes(term) || (r.sage_intitule || '').toUpperCase().includes(term))) return false
      for (const k of clesFiltre) {
        // la colonne "Fournisseur" filtre sur le n° OU le nom
        if (k === 'numero') { if (!filtreColonneOk(r.numero, filtresCol[k]!) && !filtreColonneOk(valeurColFourn(r, 'nom'), filtresCol[k]!)) return false }
        else if (!filtreColonneOk(valeurColFourn(r, k), filtresCol[k]!)) return false
      }
      return true
    })
    if (tri) return trierPar(base, tri, (r, k) => valeurColFourn(r, k as CleTriFourn))
    return base.sort((a, b) => {
      const oa = STATUT_APPRO_ORDRE.indexOf(a.statut_appro || 'SOMMEIL'), ob = STATUT_APPRO_ORDRE.indexOf(b.statut_appro || 'SOMMEIL')
      if (oa !== ob) return oa - ob
      return (b.sage_nb_refs_mystock || 0) - (a.sage_nb_refs_mystock || 0) || a.numero.localeCompare(b.numero)
    })
  }, [rows, search, statutFilter, qualiteFilter, activiteFilter, mystockFilter, masquerSommeil, masquerHorsNegoce, perimetreSeul, strategieFilter, tri, filtresCol])

  const kpis = useMemo(() => {
    const c: Record<string, number> = {}
    const base = perimetreSeul ? rows.filter((r) => r.perimetre_cbn) : rows
    base.forEach((r) => { if (r.statut_appro) c[r.statut_appro] = (c[r.statut_appro] || 0) + 1 })
    return c
  }, [rows, perimetreSeul])

  // Compteurs "sans activité depuis 24 mois" et "avec refs MYSTOCK" sur le même jeu que les cartes KPI (périmètre ou tous, hors BLG seuls).
  const compteurs = useMemo(() => {
    const base = rows.filter((r) => r.statut_appariement !== 'blg_seul' && (!perimetreSeul || r.perimetre_cbn))
    return { sansActivite24m: base.filter((r) => activiteCorrespond(r, 'aucune_24m')).length, avecMystock: base.filter((r) => n0(r.sage_nb_refs_mystock) > 0).length }
  }, [rows, perimetreSeul])

  const totaux = useMemo(() => filtres.reduce((t, r) => {
    t.refs += n0(r.sage_nb_refs_actives); t.mystock += n0(r.sage_nb_refs_mystock); t.mystockFms += n0(r.sage_nb_refs_mystock_stock_fms)
    t.nonMystock += Math.max(0, n0(r.sage_nb_refs_actives) - n0(r.sage_nb_refs_mystock)); t.stockAgence += n0(r.sage_nb_refs_stock_agence)
    t.cdfFms += n0(r.nb_cdf_ytd_fms); t.cdfAgences += n0(r.nb_cdf_ytd_hors_fms)
    return t
  }, { refs: 0, mystock: 0, mystockFms: 0, nonMystock: 0, stockAgence: 0, cdfFms: 0, cdfAgences: 0 }), [filtres])

  function setFiltreCol(k: CleTriFourn, v: string) { setFiltresCol((f) => ({ ...f, [k]: v })) }
  const nbFiltresCol = (Object.values(filtresCol) as string[]).filter((v) => (v || '').trim()).length

  function getIndex(list: FournRow[], sel: FournRow | null) { return sel ? list.findIndex((r) => r.numero === sel.numero) : -1 }
  const navigation = creerHandlerNavigation(filtres, ligneActive, setLigneActive, getIndex, listRefs)
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && ligneActive) { e.preventDefault(); setSelected(ligneActive); return }
    navigation(e)
  }
  function ouvrir(r: FournRow) { setLigneActive(r); setSelected(r) }

  const [exportEnCours, setExportEnCours] = useState(false)
  /** Export Excel de la liste telle qu'affichée (filtres généraux + filtres de colonnes + tri). */
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const annee = new Date().getFullYear()
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Fournisseurs')
      const cols: { h: string; f: (r: FournRow) => unknown; w?: number }[] = [
        { h: 'N° fournisseur', f: (r) => r.numero, w: 14 }, { h: 'Intitulé', f: (r) => r.sage_intitule, w: 36 },
        { h: 'Qualité', f: (r) => r.sage_qualite, w: 16 }, { h: 'Frs PV', f: (r) => (r.sage_frs_pv ? (r.frs_pv_force ? 'Oui (forcé)' : 'Oui') : 'Non'), w: 10 },
        { h: 'En sommeil', f: (r) => (r.sage_en_sommeil ? 'Oui' : 'Non'), w: 10 },
        { h: 'Périmètre classeur', f: (r) => (r.perimetre_cbn ? 'Oui' : 'Non'), w: 12 }, { h: 'Qualité classeur', f: (r) => r.qualite_classeur, w: 14 },
        { h: 'Statut appro', f: (r) => (r.statut_appro ? STATUT_APPRO_STYLE[r.statut_appro].label : ''), w: 20 },
        { h: 'Stratégie principale', f: (r) => r.strategie_principale, w: 18 }, { h: 'Suggestion', f: (r) => r.strategie_suggeree, w: 18 },
        { h: 'Long terme', f: (r) => (r.long_terme ? 'Oui' : 'Non'), w: 10 }, { h: "Au fil de l'eau", f: (r) => (r.au_fil_de_leau ? 'Oui' : 'Non'), w: 12 }, { h: 'Contremarque', f: (r) => (r.contremarque ? 'Oui' : 'Non'), w: 12 },
        { h: 'Calcul de besoin', f: (r) => (r.calcul_besoin_effectif ? 'Oui' : 'Non'), w: 12 }, { h: 'Périodicité', f: (r) => r.periodicite, w: 12 },
        { h: 'Refs actives', f: (r) => n0(r.sage_nb_refs_actives), w: 11 },
        { h: 'Refs MYSTOCK', f: (r) => n0(r.sage_nb_refs_mystock), w: 12 }, { h: 'MYSTOCK en stock FMS', f: (r) => n0(r.sage_nb_refs_mystock_stock_fms), w: 14 }, { h: 'MYSTOCK avec conso', f: (r) => n0(r.sage_nb_refs_mystock_conso), w: 14 },
        { h: 'Refs non MYSTOCK', f: (r) => Math.max(0, n0(r.sage_nb_refs_actives) - n0(r.sage_nb_refs_mystock)), w: 14 }, { h: 'Non MYSTOCK en stock agence', f: (r) => n0(r.sage_nb_refs_stock_agence), w: 16 },
        { h: 'Refs min/max SAGE', f: (r) => n0(r.sage_nb_refs_min_max), w: 14 }, { h: 'Refs min/max BLG', f: (r) => n0(r.blg_nb_refs_min_max), w: 14 }, { h: 'Refs stock min retenu', f: (r) => n0(r.nb_refs_min_retenu), w: 14 },
        { h: `Cdes ${annee} FMS`, f: (r) => n0(r.nb_cdf_ytd_fms), w: 12 }, { h: `Cdes ${annee} agences`, f: (r) => n0(r.nb_cdf_ytd_hors_fms), w: 12 }, { h: `Cdes ${annee} total`, f: (r) => n0(r.nb_cdf_ytd), w: 12 },
        { h: `Montant HT cdes ${annee}`, f: (r) => n0(r.montant_ht_cdf_ytd), w: 16 }, { h: `Montant HT cdes ${annee} FMS`, f: (r) => n0(r.montant_ht_cdf_ytd_fms), w: 16 },
        { h: 'Délai appro renseigné', f: (r) => (r.delai_appro_present ? 'OUI' : 'NON'), w: 12 }, { h: 'Délai appro retenu (j)', f: (r) => r.delai_appro_retenu, w: 12 },
        { h: 'Délai SAGE (j)', f: (r) => r.sage_delai_appro, w: 10 }, { h: 'Délai BLG (j)', f: (r) => r.blg_delai_appro, w: 10 }, { h: 'Délai paramètre (j)', f: (r) => r.param_delai_appro, w: 12 },
        { h: `Dernière commande ${annee}`, f: (r) => fmtDate(r.derniere_cdf), w: 14 }, { h: 'Dernière commande BLG (toutes années)', f: (r) => fmtDate(r.derniere_cdf_toutes), w: 18 }, { h: 'Cdes 24 mois', f: (r) => n0(r.nb_cdf_24m), w: 10 },
        { h: 'Dernière sortie BL', f: (r) => fmtMois(r.sage_derniere_sortie), w: 14 }, { h: 'Dernière activité', f: (r) => fmtDate(r.derniere_activite), w: 14 },
        { h: 'Mois sans activité', f: (r) => moisDepuis(r.derniere_activite) ?? 'Jamais', w: 12 }, { h: 'Sans activité 24 mois', f: (r) => (activiteCorrespond(r, 'aucune_24m') ? 'Oui' : 'Non'), w: 12 },
        { h: 'Valeur stock FMS (PA)', f: (r) => r.sage_valeur_stock_fms, w: 14 }, { h: 'Sorties BL horizon (qté)', f: (r) => r.sage_conso_horizon_total, w: 14 },
        { h: 'Statut appariement BLG', f: (r) => r.statut_appariement, w: 14 }, { h: 'Code BLG', f: (r) => r.blg_code, w: 10 }, { h: 'Lien BLG', f: (r) => r.lien_blg, w: 40 },
        { h: 'Remarque', f: (r) => r.remarque, w: 40 },
      ]
      ws.addRow(cols.map((c) => c.h)).font = { bold: true }
      const idxActivite = cols.findIndex((c) => c.h === 'Sans activité 24 mois') + 1
      const idxStatut = cols.findIndex((c) => c.h === 'Statut appro') + 1
      filtres.forEach((r) => {
        const row = ws.addRow(cols.map((c) => { const v = c.f(r); return v === null || v === undefined ? '' : v }))
        if (activiteCorrespond(r, 'aucune_24m')) row.getCell(idxActivite).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEUR_ECART } }
        if (r.statut_appro === 'CBN_BLG') row.getCell(idxStatut).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEUR_OK } }
        else if (r.statut_appro === 'A_QUALIFIER' || r.statut_appro === 'INACTIF') row.getCell(idxStatut).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEUR_NON_COMPARABLE } }
      })
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 14 })
      ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }]
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `fournisseurs_${perimetreSeul ? 'classeur' : 'sage'}_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export Excel : ' + messageErreur(e))
    } finally { setExportEnCours(false) }
  }

  const thNum = 'text-right'
  const thBase = 'whitespace-nowrap'

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setPerimetreSeul(true); setStrategieFilter(null) }}
              className={`rounded-lg border px-4 py-2 text-[13px] font-bold ${perimetreSeul ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>
              Périmètre classeur ({fmtNum(nbPerimetre)} fournisseurs MARCHANDISE + PV)
            </button>
            <button type="button" onClick={() => { setPerimetreSeul(false); setStrategieFilter(null) }}
              className={`rounded-lg border px-4 py-2 text-[13px] font-bold ${!perimetreSeul ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>
              Tous les fournisseurs SAGE
            </button>
          </div>
          <p className="text-[12px] text-[#8A8474]">Le périmètre classeur correspond à <span className="font-mono">appro_fournisseur_strategie.perimetre_cbn</span> — coche/décoche un fournisseur depuis sa fiche.</p>
        </div>
      </section>

      {perimetreSeul && (
        <PyramideClasseur rows={rowsPerimetre} toutes={rows} articles={articles} loading={loading} strategieActive={strategieFilter} onStrategie={setStrategieFilter} onSelectFournisseur={ouvrir} />
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 lg:grid-cols-10">
        {STATUT_APPRO_ORDRE.map((s) => (
          <button key={s} type="button" onClick={() => setStatutFilter((v) => (v === s ? '' : s))} className={`text-left ${statutFilter === s ? 'ring-2 ring-[#B4761A]/50 rounded-xl' : ''}`}>
            <KpiCard label={STATUT_APPRO_STYLE[s].label} value={kpis[s] || 0} loading={loading} tone={s === 'CBN_BLG' ? 'ok' : s === 'A_QUALIFIER' || s === 'INACTIF' ? 'warn' : undefined} />
          </button>
        ))}
        <button type="button" onClick={() => setMystockFilter((v) => (v === 'avec' ? 'tous' : 'avec'))} className={`text-left ${mystockFilter === 'avec' ? 'ring-2 ring-[#B4761A]/50 rounded-xl' : ''}`}
          title="Fournisseurs ayant au moins une référence MYSTOCK active">
          <KpiCard label="Avec refs MYSTOCK" value={compteurs.avecMystock} loading={loading} tone="ok" sub="au moins une référence" />
        </button>
        <button type="button" onClick={() => setActiviteFilter((v) => (v === 'aucune_24m' ? '' : 'aucune_24m'))} className={`text-left ${activiteFilter === 'aucune_24m' ? 'ring-2 ring-[#B4761A]/50 rounded-xl' : ''}`}
          title="Aucune commande fournisseur BLG ni sortie BL de ses références depuis 24 mois (ou jamais)">
          <KpiCard label="Sans activité 24 mois" value={compteurs.sansActivite24m} loading={loading} tone="warn" sub="ni commande ni sortie BL" />
        </button>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-7">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="N° fournisseur ou intitulé…"
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
          <select value={qualiteFilter} onChange={(e) => setQualiteFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Qualité : Toutes</option>
            {qualites.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <select value={mystockFilter} onChange={(e) => setMystockFilter(e.target.value as typeof mystockFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="tous">Refs MYSTOCK : Tous</option><option value="avec">Avec au moins une ref MYSTOCK</option><option value="sans">Sans ref MYSTOCK</option>
          </select>
          <select value={activiteFilter} onChange={(e) => setActiviteFilter(e.target.value as ActiviteFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
            title="Activité = dernière commande fournisseur BLG (toutes années) ou dernière sortie BL de ses références">
            {ACTIVITE_OPTIONS.map((o) => <option key={o.value || '__all'} value={o.value}>{o.label}</option>)}
          </select>
          {perimetreSeul ? (
            <select value={strategieFilter ?? '__all'} onChange={(e) => setStrategieFilter(e.target.value === '__all' ? null : e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E] md:col-span-2">
              <option value="__all">Stratégie principale : Toutes</option>
              {STRATEGIES_PYRAMIDE.map((s) => <option key={s.code || '__none'} value={s.code}>{s.label}</option>)}
            </select>
          ) : (
            <>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                <input type="checkbox" checked={masquerSommeil} onChange={(e) => setMasquerSommeil(e.target.checked)} className="accent-[#B4761A]" /> Masquer en sommeil
              </label>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                <input type="checkbox" checked={masquerHorsNegoce} onChange={(e) => setMasquerHorsNegoce(e.target.checked)} className="accent-[#B4761A]" /> Masquer hors négoce
              </label>
            </>
          )}
        </div>
        <p className="mt-2 text-[12px] text-[#8A8474]">
          <b>CBN BLG</b> = stratégie "Au fil de l'eau" avec des références MYSTOCK → calcul de besoin mensuel dans BLG. <b>À qualifier</b> = fournisseur négoce actif sans stratégie renseignée (une suggestion est proposée dans la fiche). Clique une carte pour filtrer.
          {' '}<b>Activité</b> = dernière commande fournisseur BLG (toutes années) ou dernière sortie BL de ses références (horizon conso 24 mois) : "aucune activité depuis 24 mois" = ni l'un ni l'autre.
        </p>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading ? 'Chargement…' : `${filtres.length} fournisseur${filtres.length > 1 ? 's' : ''}`}
            {tri && <span className="ml-2 normal-case tracking-normal text-[#B4761A]">· trié sur une colonne</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#8A8474]">
            {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
            {(tri || nbFiltresCol > 0) && (
              <button type="button" onClick={() => { setTri(null); setFiltresCol({}) }} className="font-bold text-[#B4761A] hover:underline">Réinitialiser tri et filtres de colonnes</button>
            )}
            <span>Clic sur un en-tête : tri · champs d'en-tête : filtre (texte "contient", nombres "&gt;10", "&lt;=5", "=0", "vide") · clic sur une ligne ou Entrée : fiche</span>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
              {exportEnCours ? 'Export en cours…' : `⬇ Exporter en Excel (${filtres.length} fournisseurs)`}
            </button>
          </div>
        </div>
        <div tabIndex={0} onKeyDown={onListKeyDown} className="max-h-[820px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                <th className={`${thBase} cursor-pointer select-none px-2 py-2 font-bold`}>
                  <span onClick={() => setTri((t) => basculerTri(t, 'numero'))} className={`hover:text-[#111820] ${tri?.key === 'numero' ? 'text-[#111820]' : ''}`}>N°<IndicateurTri actif={tri?.key === 'numero'} dir={tri?.dir} /></span>
                  <span className="mx-1 text-[#C9C4B8]">·</span>
                  <span onClick={() => setTri((t) => basculerTri(t, 'nom'))} className={`hover:text-[#111820] ${tri?.key === 'nom' ? 'text-[#111820]' : ''}`}>Fournisseur<IndicateurTri actif={tri?.key === 'nom'} dir={tri?.dir} /></span>
                </th>
                <ThTri k="qualite" label="Qualité" tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} className={thBase} />
                <ThTri k="statut" label="Statut appro" tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} className={thBase} />
                <ThTri k="strategie" label="Stratégie" tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} className={thBase} />
                <ThTri k="refs" label="Refs actives" tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Références actives (hors sommeil)" />
                <ThTri k="mystock" label={<>MYSTOCK<div className="text-[9px] font-normal normal-case tracking-normal">dont en stock FMS</div></>} tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Références MYSTOCK actives — en dessous : celles réellement en stock au dépôt FMS" />
                <ThTri k="non_mystock" label={<>Non MYSTOCK<div className="text-[9px] font-normal normal-case tracking-normal">dont en stock agence</div></>} tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Références actives MYSTOCK ≠ OUI — en dessous : celles avec du stock hors FMS" />
                <ThTri k="cdf_fms" label={<>Cdes FMS<div className="text-[9px] font-normal normal-case tracking-normal">{new Date().getFullYear()}</div></>} tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Commandes fournisseurs BLG livrées au dépôt FMS depuis le 1er janvier" />
                <ThTri k="cdf_agences" label={<>Cdes agences<div className="text-[9px] font-normal normal-case tracking-normal">{new Date().getFullYear()}</div></>} tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Commandes fournisseurs BLG livrées en agence depuis le 1er janvier" />
                <ThTri k="delai" label="Délai" tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Délai d'appro retenu (paramètre > SAGE > BLG)" />
                <ThTri k="activite" label="Dern. activité" tri={tri} onTri={(k) => setTri((t) => basculerTri(t, k))} align="right" className={thBase} title="Dernière activité : max(dernière commande fournisseur BLG, dernière sortie BL de ses références)" />
              </tr>
              <tr className="bg-[#F4F3F0]/80">
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.numero || ''} onChange={(v) => setFiltreCol('numero', v)} placeholder="n° ou nom" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.qualite || ''} onChange={(v) => setFiltreCol('qualite', v)} /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.statut || ''} onChange={(v) => setFiltreCol('statut', v)} /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.strategie || ''} onChange={(v) => setFiltreCol('strategie', v)} /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.refs || ''} onChange={(v) => setFiltreCol('refs', v)} align="right" placeholder=">0" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.mystock || ''} onChange={(v) => setFiltreCol('mystock', v)} align="right" placeholder=">0" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.non_mystock || ''} onChange={(v) => setFiltreCol('non_mystock', v)} align="right" placeholder=">0" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.cdf_fms || ''} onChange={(v) => setFiltreCol('cdf_fms', v)} align="right" placeholder=">0" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.cdf_agences || ''} onChange={(v) => setFiltreCol('cdf_agences', v)} align="right" placeholder=">0" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.delai || ''} onChange={(v) => setFiltreCol('delai', v)} align="right" placeholder="vide" /></td>
                <td className="px-2 pb-2"><InputFiltre value={filtresCol.activite || ''} onChange={(v) => setFiltreCol('activite', v)} align="right" placeholder="2026" /></td>
              </tr>
            </thead>
            <tbody>
              {filtres.map((r, i) => {
                const isActive = ligneActive?.numero === r.numero
                const mAct = moisDepuis(r.derniere_activite)
                const nonMystock = Math.max(0, n0(r.sage_nb_refs_actives) - n0(r.sage_nb_refs_mystock))
                return (
                  <tr key={r.numero} ref={(el) => { listRefs.current[i] = el }} onClick={() => ouvrir(r)}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${isActive ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero}</span>
                        {r.sage_frs_pv && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" title={r.frs_pv_force ? 'PV forcé côté appli (classeur) — champ libre SAGE non renseigné' : 'Frs PV (SAGE)'}>PV{r.frs_pv_force ? '*' : ''}</span>}
                        {r.perimetre_cbn && !perimetreSeul && <span className="rounded-full bg-[#111820] px-1.5 py-0.5 text-[10px] font-bold text-white">Classeur</span>}
                        {r.statut_appariement === 'manquant_blg' && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Manquant BLG</span>}
                        {r.sage_en_sommeil && <span className="rounded-full bg-[#F4F3F0] px-1.5 py-0.5 text-[10px] font-bold text-[#8A8474]">Sommeil</span>}
                      </div>
                      <div className="max-w-[320px] truncate text-[12px] text-[#111820]" title={r.sage_intitule || ''}>{r.sage_intitule || '—'}</div>
                    </td>
                    <td className="px-2 py-2"><QualiteBadge qualite={r.sage_qualite} /></td>
                    <td className="px-2 py-2"><StatutApproBadge statut={r.statut_appro} /></td>
                    <td className="px-2 py-2 text-[12px] text-[#3A362E]">
                      {r.strategie_principale || (r.strategie_suggeree ? <span className="italic text-[#B4761A]">→ {r.strategie_suggeree} ?</span> : '—')}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[12px] text-[#3A362E]">{fmtNum(r.sage_nb_refs_actives)}</td>
                    <td className="px-2 py-2 text-right font-mono text-[12px]">
                      <div className="font-bold text-emerald-700">{fmtNum(r.sage_nb_refs_mystock)}</div>
                      <div className="text-[10px] text-[#8A8474]" title="Refs MYSTOCK avec stock > 0 au dépôt FMS">{n0(r.sage_nb_refs_mystock) > 0 ? `${fmtNum(r.sage_nb_refs_mystock_stock_fms)} en stock FMS` : '—'}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[12px]">
                      <div className="text-[#3A362E]">{fmtNum(nonMystock)}</div>
                      <div className="text-[10px] text-[#8A8474]" title="Refs actives MYSTOCK ≠ OUI avec du stock hors FMS">{nonMystock > 0 ? `${fmtNum(r.sage_nb_refs_stock_agence)} en stock agence` : '—'}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[12px] text-[#3A362E]">{fmtNum(r.nb_cdf_ytd_fms)}</td>
                    <td className="px-2 py-2 text-right font-mono text-[12px] text-[#3A362E]">{fmtNum(r.nb_cdf_ytd_hors_fms)}</td>
                    <td className="px-2 py-2 text-right text-[12px]">{r.delai_appro_present ? <span className="font-semibold text-emerald-700">{fmtNum(r.delai_appro_retenu)} j</span> : <span className="text-[#B3AD9E]">NON</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-[12px]" title={`Dernière commande BLG : ${fmtDate(r.derniere_cdf_toutes)} · dernière sortie BL : ${fmtMois(r.sage_derniere_sortie)} · ${fmtNum(r.nb_cdf_24m)} cde(s) sur 24 mois`}>
                      {r.derniere_activite
                        ? <span className={mAct !== null && mAct >= 24 ? 'font-semibold text-red-700' : mAct !== null && mAct >= 12 ? 'text-[#96600F]' : 'text-[#3A362E]'}>{fmtDate(r.derniere_activite)}{mAct !== null ? <span className="ml-1 text-[10px] text-[#8A8474]">({mAct} m)</span> : null}</span>
                        : <span className="font-semibold text-red-700">Jamais</span>}
                    </td>
                  </tr>
                )
              })}
              {!loading && filtres.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>}
            </tbody>
            {filtres.length > 0 && (
              <tfoot className="sticky bottom-0 bg-[#111820] text-[12px] text-white">
                <tr>
                  <td className="px-2 py-2 font-bold" colSpan={4}>TOTAL · {fmtNum(filtres.length)} fournisseur{filtres.length > 1 ? 's' : ''}</td>
                  <td className={`${thNum} px-2 py-2 font-mono font-bold`}>{fmtNum(totaux.refs)}</td>
                  <td className={`${thNum} px-2 py-2 font-mono`}><div className="font-bold text-emerald-300">{fmtNum(totaux.mystock)}</div><div className="text-[10px] opacity-70">{fmtNum(totaux.mystockFms)} en stock FMS</div></td>
                  <td className={`${thNum} px-2 py-2 font-mono`}><div className="font-bold">{fmtNum(totaux.nonMystock)}</div><div className="text-[10px] opacity-70">{fmtNum(totaux.stockAgence)} en stock agence</div></td>
                  <td className={`${thNum} px-2 py-2 font-mono font-bold`}>{fmtNum(totaux.cdfFms)}</td>
                  <td className={`${thNum} px-2 py-2 font-mono font-bold`}>{fmtNum(totaux.cdfAgences)}</td>
                  <td className="px-2 py-2" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {selected && (
        <FicheFournisseurModal selected={selected} strategies={strategies} articles={articles} onRowChange={onRowChange} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Incohérences par référence (calculées côté navigateur, croisement article
// ↔ fournisseur principal). Affichées en tête de tableau et en pastilles
// filtrantes au-dessus des KPI.
// ─────────────────────────────────────────────────────────────────────────

const INCOHERENCES_ARTICLE: { code: string; label: string; gravite: 'rouge' | 'orange' }[] = [
  { code: 'stock_fms_non_mystock', label: 'Stock FMS mais pas MYSTOCK', gravite: 'orange' },
  { code: 'mystock_fourn_demande', label: 'MYSTOCK mais fournisseur "A la demande"', gravite: 'rouge' },
  { code: 'mystock_fourn_sans_strategie', label: 'MYSTOCK mais fournisseur sans stratégie', gravite: 'orange' },
  { code: 'mystock_fourn_hors_classeur', label: 'MYSTOCK mais fournisseur hors périmètre classeur', gravite: 'orange' },
  { code: 'mystock_fourn_sommeil', label: 'MYSTOCK mais fournisseur en sommeil', gravite: 'rouge' },
  { code: 'mystock_sans_fournisseur', label: 'MYSTOCK sans fournisseur principal', gravite: 'rouge' },
  { code: 'mystock_sans_conso', label: 'MYSTOCK sans aucune sortie sur l\'horizon', gravite: 'orange' },
  { code: 'sommeil_stock_fms', label: 'En sommeil mais stock FMS > 0', gravite: 'orange' },
  { code: 'sommeil_mystock', label: 'En sommeil mais MYSTOCK OUI', gravite: 'orange' },
  { code: 'arret_appro_mystock', label: 'Arrêt appro mais MYSTOCK OUI', gravite: 'orange' },
  { code: 'arret_appro_encours', label: 'Arrêt appro mais encours fournisseur', gravite: 'rouge' },
  { code: 'arret_appro_min_blg', label: 'Arrêt appro mais stock min BLG > 0', gravite: 'orange' },
  { code: 'arret_vente_stock', label: 'Arrêt vente mais stock > 0 (à écouler / déstocker)', gravite: 'orange' },
  { code: 'remplacante_inconnue', label: 'Référence remplaçante inconnue', gravite: 'rouge' },
  { code: 'remplacante_sommeil', label: 'Référence remplaçante elle-même en sommeil ou en arrêt', gravite: 'orange' },
  { code: 'stock_min_blg_diff', label: 'Stock min BLG ≠ calculé', gravite: 'orange' },
  { code: 'sans_delai', label: 'MYSTOCK sans délai d\'appro (référence ni fournisseur)', gravite: 'orange' },
]
const LABEL_INCOHERENCE_ARTICLE = Object.fromEntries(INCOHERENCES_ARTICLE.map((i) => [i.code, i])) as Record<string, { code: string; label: string; gravite: 'rouge' | 'orange' }>

function detecterIncoherencesArticle(a: ArtRow, f: FournRow | undefined, index: Map<string, ArtRow>): string[] {
  const out: string[] = []
  const mystock = safeText(a.mystock).toUpperCase() === 'OUI'
  const sommeil = !!a.sage_en_sommeil
  const pert = !!a.pertinent_calcul_besoin
  if (!sommeil && !mystock && n0(a.sage_stock_fms) > 0) out.push('stock_fms_non_mystock')
  if (pert && f && f.strategie_principale === 'A la demande') out.push('mystock_fourn_demande')
  if (pert && f && !f.strategie_principale) out.push('mystock_fourn_sans_strategie')
  if (pert && f && !f.perimetre_cbn) out.push('mystock_fourn_hors_classeur')
  if (pert && f && f.sage_en_sommeil) out.push('mystock_fourn_sommeil')
  if (pert && !a.fournisseur_principal) out.push('mystock_sans_fournisseur')
  if (pert && !(n0(a.conso_horizon) > 0)) out.push('mystock_sans_conso')
  if (sommeil && n0(a.sage_stock_fms) > 0) out.push('sommeil_stock_fms')
  if (sommeil && mystock) out.push('sommeil_mystock')
  if (a.arret_appro && mystock) out.push('arret_appro_mystock')
  if (a.arret_appro && n0(a.encours_fourn_fms) > 0) out.push('arret_appro_encours')
  if (a.arret_appro && n0(a.blg_stock_min_fms) > 0) out.push('arret_appro_min_blg')
  if (a.arret_vente && n0(a.sage_stock_total) > 0) out.push('arret_vente_stock')
  if (a.ref_remplacante) {
    const r = index.get(a.ref_remplacante.trim().toUpperCase())
    if (!r) out.push('remplacante_inconnue')
    else if (r.sage_en_sommeil || r.arret_appro || r.arret_vente) out.push('remplacante_sommeil')
  }
  if (pert && (a.champs_en_ecart || []).includes('stock_min')) out.push('stock_min_blg_diff')
  if (pert && !a.delai_appro_ref_jours && f && !f.delai_appro_present) out.push('sans_delai')
  return out
}

/** Caractéristiques manuelles éditables d'une référence. */
type ArticleManuel = {
  stock_min_retenu: string; commentaire: string
  arret_appro: boolean; arret_vente: boolean; ref_remplacante: string; date_effet: string
  delai_appro_ref_jours: string; delai_securite_ref_jours: string
}
function manuelDepuis(a: ArtRow): ArticleManuel {
  return {
    stock_min_retenu: a.stock_min_retenu === null || a.stock_min_retenu === undefined ? '' : String(a.stock_min_retenu),
    commentaire: a.commentaire_stock_min || '',
    arret_appro: !!a.arret_appro, arret_vente: !!a.arret_vente,
    ref_remplacante: a.ref_remplacante || '', date_effet: a.date_effet ? String(a.date_effet).slice(0, 10) : '',
    delai_appro_ref_jours: a.delai_appro_ref_jours === null || a.delai_appro_ref_jours === undefined ? '' : String(a.delai_appro_ref_jours),
    delai_securite_ref_jours: a.delai_securite_ref_jours === null || a.delai_securite_ref_jours === undefined ? '' : String(a.delai_securite_ref_jours),
  }
}

function ArticleManuelModal({ article, fournisseur, onClose, onSaved }: { article: ArtRow; fournisseur: FournRow | undefined; onClose: () => void; onSaved: (a: ArtRow) => void }) {
  const [m, setM] = useState<ArticleManuel>(manuelDepuis(article))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  async function enregistrer() {
    setSaving(true); setMsg(null)
    try {
      const payload = {
        reference_article: article.reference_article,
        stock_min_retenu: num(m.stock_min_retenu), commentaire: m.commentaire || null,
        arret_appro: m.arret_appro, arret_vente: m.arret_vente,
        ref_remplacante: m.ref_remplacante.trim().toUpperCase() || null, date_effet: m.date_effet || null,
        delai_appro_ref_jours: num(m.delai_appro_ref_jours), delai_securite_ref_jours: num(m.delai_securite_ref_jours),
      }
      const { error } = await supabase.from('appro_article_stock_min').upsert(payload, { onConflict: 'reference_article' })
      if (error) throw error
      const { data, error: err2 } = await supabase.from('v_appro_controle_article_sage_blg').select('*').eq('reference_article', article.reference_article).maybeSingle()
      if (err2) throw err2
      if (data) onSaved(data as ArtRow)
      onClose()
    } catch (e) { setMsg('Erreur : ' + messageErreur(e)) } finally { setSaving(false) }
  }

  const inp = 'h-9 w-full rounded-lg border border-[#E5E1D8] bg-white px-2 text-[13px]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between border-b border-[#E5E1D8] pb-3">
          <div>
            <div className="font-mono text-[12px] font-bold text-[#8A8474]">{article.reference_article}{fournisseur ? ` · ${fournisseur.numero} ${fournisseur.sage_intitule || ''}` : ''}</div>
            <div className="text-[15px] font-bold text-[#111820]">{article.sage_designation || '—'}</div>
            <div className="mt-1 text-[12px] text-[#8A8474]">Délais fournisseur : appro {fmtNum(article.delai_appro_jours)} j · sécurité {fmtNum(article.delai_securite_jours)} j. Les valeurs saisies ici priment (jours calendaires) et sont conservées au recalcul.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0]">✕</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Délai d'appro de la référence (j)</span><input value={m.delai_appro_ref_jours} onChange={(e) => setM({ ...m, delai_appro_ref_jours: e.target.value })} placeholder={`fournisseur : ${fmtNum(article.delai_appro_jours)}`} className={inp} /></label>
          <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Délai de sécurité de la référence (j)</span><input value={m.delai_securite_ref_jours} onChange={(e) => setM({ ...m, delai_securite_ref_jours: e.target.value })} placeholder={`fournisseur : ${fmtNum(article.delai_securite_jours)}`} className={inp} /></label>
          <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Stock min retenu (vide = calculé)</span><input value={m.stock_min_retenu} onChange={(e) => setM({ ...m, stock_min_retenu: e.target.value })} placeholder={`calculé : ${fmtNum(article.calc_stock_min)}`} className={inp} /></label>
          <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Date d'effet</span><input type="date" value={m.date_effet} onChange={(e) => setM({ ...m, date_effet: e.target.value })} className={inp} /></label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={m.arret_appro} onChange={(e) => setM({ ...m, arret_appro: e.target.checked })} className="accent-[#B4761A]" /> Arrêt approvisionnement (plus de signal à commander)</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={m.arret_vente} onChange={(e) => setM({ ...m, arret_vente: e.target.checked })} className="accent-[#B4761A]" /> Arrêt de vente</label>
          <label className="flex flex-col gap-0.5 text-[12px] md:col-span-2"><span className="font-semibold text-[#3A362E]">Référence remplaçante</span><input value={m.ref_remplacante} onChange={(e) => setM({ ...m, ref_remplacante: e.target.value })} placeholder="référence SAGE" className={`${inp} font-mono uppercase`} /></label>
          <label className="flex flex-col gap-0.5 text-[12px] md:col-span-2"><span className="font-semibold text-[#3A362E]">Commentaire</span><textarea value={m.commentaire} onChange={(e) => setM({ ...m, commentaire: e.target.value })} rows={2} className="w-full rounded-lg border border-[#E5E1D8] px-2 py-1 text-[13px]" /></label>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] text-red-700">{msg}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#E5E1D8] px-4 py-2 text-[13px] font-bold text-[#3A362E]">Annuler</button>
            <button type="button" onClick={() => void enregistrer()} disabled={saving} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Modèle de projection (paramètres appro_parametres projection_*)
// ─────────────────────────────────────────────────────────────────────────

const PROJECTION_PARAM_KEYS = ['projection_perimetre_global', 'projection_demande_mode', 'projection_horizon_delai', 'projection_mu_source']
const DEMANDE_MODES: { value: number; label: string; detail: string }[] = [
  { value: 1, label: 'Réservations fermes', detail: 'réservé SAGE (sto_res) uniquement' },
  { value: 2, label: 'Consommation moyenne', detail: 'μ × horizon / 30 uniquement' },
  { value: 3, label: 'Les deux', detail: 'le plus grand des deux (les réservations font partie de la conso attendue)' },
]

function valParam(parametres: Parametre[], cle: string, def: number) {
  const v = parametres.find((p) => p.cle === cle)?.valeur
  return v === undefined || v === null ? def : Number(v)
}

/** Sélecteur du modèle de projection : enregistre dans appro_parametres puis
 * recharge les articles (la vue recalcule instantanément). */
function ModeleProjection({ parametres, onParametresChange, onRecalcul, loading }: {
  parametres: Parametre[]; onParametresChange: (p: Parametre[]) => void; onRecalcul: () => Promise<void>; loading: boolean
}) {
  const global = valParam(parametres, 'projection_perimetre_global', 0) === 1
  const demande = valParam(parametres, 'projection_demande_mode', 3)
  const horizonDelai = valParam(parametres, 'projection_horizon_delai', 1) === 1
  const mu3m = valParam(parametres, 'projection_mu_source', 0) === 1
  const [saving, setSaving] = useState(false)

  async function changer(cle: string, valeur: number) {
    setSaving(true)
    try {
      const existant = parametres.find((p) => p.cle === cle)
      const { error } = await supabase.from('appro_parametres').upsert({ cle, valeur, description: existant?.description ?? null }, { onConflict: 'cle' })
      if (error) throw error
      onParametresChange(existant ? parametres.map((p) => (p.cle === cle ? { ...p, valeur } : p)) : [...parametres, { cle, valeur, description: null }])
      await onRecalcul()
    } catch (e) {
      alert('Erreur : ' + messageErreur(e))
    } finally { setSaving(false) }
  }

  const sel = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] disabled:opacity-60'
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-3 md:grid-cols-4">
      <label className="flex flex-col gap-0.5 text-[12px]">
        <span className="font-semibold text-[#3A362E]">Périmètre</span>
        <select value={global ? 1 : 0} disabled={saving || loading} onChange={(e) => void changer('projection_perimetre_global', Number(e.target.value))} className={sel}>
          <option value={0}>Dépôt FMS seul</option>
          <option value={1}>Global (tous dépôts)</option>
        </select>
        <span className="text-[11px] text-[#8A8474]">{global ? 'Stock disponible, réservé et encours de tous les dépôts' : 'Stock FMS, réservé FMS, encours livré au dépôt FMS'}</span>
      </label>
      <label className="flex flex-col gap-0.5 text-[12px]">
        <span className="font-semibold text-[#3A362E]">Demande déduite</span>
        <select value={demande} disabled={saving || loading} onChange={(e) => void changer('projection_demande_mode', Number(e.target.value))} className={sel}>
          {DEMANDE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <span className="text-[11px] text-[#8A8474]">{DEMANDE_MODES.find((m) => m.value === demande)?.detail}</span>
      </label>
      <label className="flex flex-col gap-0.5 text-[12px]">
        <span className="font-semibold text-[#3A362E]">Horizon</span>
        <select value={horizonDelai ? 1 : 0} disabled={saving || loading} onChange={(e) => void changer('projection_horizon_delai', Number(e.target.value))} className={sel}>
          <option value={1}>Au moins le délai d'appro L</option>
          <option value={0}>Jusqu'à la livraison de l'encours seulement</option>
        </select>
        <span className="text-[11px] text-[#8A8474]">{horizonDelai ? 'Sans encours, on projette quand même la conso sur L (fournisseur + sécurité)' : 'Sans encours, horizon = 0 : le projeté vaut le stock à terme'}</span>
      </label>
      <label className="flex flex-col gap-0.5 text-[12px]">
        <span className="font-semibold text-[#3A362E]">Conso moyenne μ</span>
        <select value={mu3m ? 1 : 0} disabled={saving || loading} onChange={(e) => void changer('projection_mu_source', Number(e.target.value))} className={sel}>
          <option value={0}>μ 12 mois (horizon complet)</option>
          <option value={1}>μ 3 derniers mois</option>
        </select>
        <span className="text-[11px] text-[#8A8474]">{mu3m ? 'Plus réactif en saison ; le stock min/sécurité reste calculé sur 12 mois' : 'Moyenne lissée sur l\'horizon du calcul de besoin'}</span>
      </label>
      {saving && <div className="text-[11px] text-[#8A8474] md:col-span-4">Enregistrement puis recalcul…</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Articles & stock min
// ─────────────────────────────────────────────────────────────────────────

// ── Colonnes de la liste Articles : clé, en-tête, valeur utilisée pour le tri
// et le filtre d'en-tête. L'ordre est celui du tableau (thead et tbody).
type CleColArt = 'inc' | 'reference' | 'fourn' | 'strategie' | 'arret' | 'delai_l' | 'mu12' | 'sigma' | 'mu3' | 'derniere_sortie' | 'stock_fms' | 'dispo' | 'encours' | 'reserve' | 'projete' | 'couv' | 'min_sage' | 'min_blg' | 'ss' | 'min_calc' | 'max_calc' | 'a_cmder' | 'retenu'
type FiltresColArt = Partial<Record<CleColArt, string>>
type CtxColArt = { fournMap: Map<string, FournRow>; incoherencesParRef: Map<string, string[]> }

const COLONNES_ARTICLES: { key: CleColArt; label: string; title?: string; align: 'left' | 'right'; placeholder?: string; val: (a: ArtRow, ctx: CtxColArt) => unknown }[] = [
  { key: 'inc', label: '⚠', title: 'Nombre d\'incohérences détectées (survole pour le détail). Filtre : ">0", "=0", ou un mot du libellé (ex. "sommeil")', align: 'left', placeholder: '>0', val: (a, c) => c.incoherencesParRef.get(a.reference_article)?.length ?? 0 },
  { key: 'reference', label: 'Référence', title: 'Référence et désignation SAGE', align: 'left', placeholder: 'réf. ou désignation', val: (a) => a.reference_article },
  { key: 'fourn', label: 'Fourn.', title: 'Fournisseur principal (n° SAGE). Filtre sur le n° ou l\'intitulé', align: 'left', placeholder: 'n° ou nom', val: (a) => a.fournisseur_principal },
  { key: 'strategie', label: 'Stratégie', title: 'Stratégie d\'appro principale du fournisseur', align: 'left', val: (a, c) => (a.fournisseur_principal ? c.fournMap.get(a.fournisseur_principal)?.strategie_principale : null) || '' },
  { key: 'arret', label: 'Arrêt', title: 'Arrêt appro / arrêt vente, référence remplaçante et date d\'effet (saisie manuelle, ✎). Filtre : "appro", "vente", une référence', align: 'left', val: (a) => [a.arret_appro ? 'Appro' : '', a.arret_vente ? 'Vente' : '', a.ref_remplacante || ''].filter(Boolean).join(' ') },
  { key: 'delai_l', label: 'Délai L', title: 'Délai d\'appro + délai de sécurité (jours calendaires) — ref = valeurs propres à la référence, sinon fournisseur / défaut', align: 'right', val: (a) => a.projection_delai_l },
  { key: 'mu12', label: 'μ 12 mois', title: 'Conso moyenne mensuelle sur l\'horizon (12 mois)', align: 'right', val: (a) => a.conso_moy_mensuelle },
  { key: 'sigma', label: 'σ', title: 'Écart-type mensuel', align: 'right', val: (a) => a.conso_ecart_type },
  { key: 'mu3', label: 'μ 3 mois', title: 'Consommation mensuelle moyenne des 3 derniers mois complets (sorties BL / 3). Survole pour le total.', align: 'right', val: (a) => a.conso_moy_3_mois },
  { key: 'derniere_sortie', label: 'Dern. sortie', title: 'Dernière sortie BL (mois). Filtre sur l\'année ou le mois au format AAAA-MM', align: 'right', placeholder: '2026-0', val: (a) => a.sage_derniere_sortie ? String(a.sage_derniere_sortie).slice(0, 7) : null },
  { key: 'stock_fms', label: 'Stock FMS', title: 'Stock physique FMS (SAGE sto_qte)', align: 'right', val: (a) => a.sage_stock_fms },
  { key: 'dispo', label: 'Dispo (agences)', title: 'Stock disponible SAGE (sto_dispo) du dépôt FMS — entre parenthèses : somme des agences', align: 'right', val: (a) => a.stock_dispo_sage_fms },
  { key: 'encours', label: 'Encours fourn.', title: 'Reste à livrer des commandes fournisseurs BLG livrées au dépôt FMS, avec date de livraison estimée (⏱ = en retard, ≈ = date par délai théorique). Survole pour le détail par commande.', align: 'right', val: (a) => a.encours_fourn_fms },
  { key: 'reserve', label: 'Réservé (agences)', title: 'Ventes réservées SAGE (sto_res) du dépôt FMS, déduites du projeté — entre parenthèses : somme des réservés des agences. Survole pour le reste à livrer BLG.', align: 'right', val: (a) => a.reserve_sage_fms },
  { key: 'projete', label: 'Projeté', title: 'Stock (périmètre) − demande sur l\'horizon + encours. Survole pour la décomposition et le seuil. Rouge = à commander ; ⚠ = stock épuisé avant réception de l\'encours.', align: 'right', val: (a) => a.stock_projete_livraison },
  { key: 'couv', label: 'Couv. (mois)', title: 'Couverture projetée = position de stock du périmètre choisi (stock + encours − réservé) / μ retenu. En dessous, en gris : couverture du seul stock physique FMS / μ 12 mois (ne dépend pas du modèle).', align: 'right', val: (a) => a.couverture_projetee_mois },
  { key: 'min_sage', label: 'Min SAGE', align: 'right', val: (a) => a.sage_stock_min_fms },
  { key: 'min_blg', label: 'Min BLG', align: 'right', val: (a) => a.blg_stock_min_fms },
  { key: 'ss', label: 'SS calc.', align: 'right', val: (a) => a.calc_stock_securite },
  { key: 'min_calc', label: 'Min calc.', align: 'right', val: (a) => a.calc_stock_min },
  { key: 'max_calc', label: 'Max calc.', align: 'right', val: (a) => a.calc_stock_max },
  { key: 'a_cmder', label: 'À cmder', title: 'Quantité suggérée pour remonter le projeté au stock max (arrondie au colisage). Filtre : ">0" = à commander', align: 'right', placeholder: '>0', val: (a) => (a.a_commander ? n0(a.qte_a_commander) : null) },
  { key: 'retenu', label: 'Retenu', title: 'Stock min retenu (saisie manuelle). Filtre "!vide" = avec saisie', align: 'right', placeholder: '!vide', val: (a) => a.stock_min_retenu },
]

/** Filtre d'en-tête d'une colonne Articles : quelques colonnes cherchent aussi
 * dans un libellé (désignation, intitulé fournisseur, libellés d'incohérences). */
function filtreColArtOk(a: ArtRow, key: CleColArt, expr: string, ctx: CtxColArt): boolean {
  const col = COLONNES_ARTICLES.find((c) => c.key === key)!
  if (filtreColonneOk(col.val(a, ctx), expr)) return true
  if (key === 'reference') return filtreColonneOk(a.sage_designation, expr)
  if (key === 'fourn') return filtreColonneOk(a.fournisseur_principal ? ctx.fournMap.get(a.fournisseur_principal)?.sage_intitule : null, expr)
  if (key === 'inc') return filtreColonneOk((ctx.incoherencesParRef.get(a.reference_article) || []).map((k) => LABEL_INCOHERENCE_ARTICLE[k]?.label || k).join(' ; '), expr)
  return false
}

function OngletArticles({ articles, fournisseurs, loading, loadProgress, error, parametres, onParametresChange, onArticleChange, onRecalcul }: {
  articles: ArtRow[]; fournisseurs: FournRow[]; loading: boolean; loadProgress: number; error: string | null
  parametres: Parametre[]; onParametresChange: (p: Parametre[]) => void; onArticleChange: (a: ArtRow) => void; onRecalcul: () => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [fournFilter, setFournFilter] = useState('')
  const [familleFilter, setFamilleFilter] = useState('')
  // Les filtres partent des ~5 900 références en base : les KPI reflètent le jeu filtré.
  const [pertinentsSeuls, setPertinentsSeuls] = useState(false)
  const [avecConsoSeuls, setAvecConsoSeuls] = useState(false)
  const [ecartMinSeuls, setEcartMinSeuls] = useState(false)
  const [aCommanderSeuls, setACommanderSeuls] = useState(false)
  const [avecEncoursSeuls, setAvecEncoursSeuls] = useState(false)
  const [qualiteFilter, setQualiteFilter] = useState('')          // qualité du fournisseur principal
  const [strategieFilter, setStrategieFilter] = useState('')      // stratégie principale du fournisseur ('' = toutes, '__none' = non renseignée)
  const [sommeilFilter, setSommeilFilter] = useState<'tous' | 'oui' | 'non'>('tous')
  const [arretApproFilter, setArretApproFilter] = useState<'tous' | 'oui' | 'non'>('tous')
  const [incoherenceFilter, setIncoherenceFilter] = useState<string | null>(null)
  // ventes réservées : SAGE sto_res du dépôt FMS (source de vérité), BLG en survol uniquement
  const [tri, setTri] = useState<'conso' | 'ecart' | 'couverture' | 'reference' | 'a_commander' | 'projete' | 'incoherences'>('conso')
  // Tri par en-tête de colonne (prime sur le tri prédéfini ci-dessus) et filtres par colonne
  const [triCol, setTriCol] = useState<EtatTri<CleColArt>>(null)
  const [filtresCol, setFiltresCol] = useState<FiltresColArt>({})
  const [editArticle, setEditArticle] = useState<ArtRow | null>(null)
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
  const fournMap = useMemo(() => new Map(fournisseurs.map((f) => [f.numero, f])), [fournisseurs])
  const qualiteOptions = useMemo(() => Array.from(new Set(fournisseurs.map((f) => safeText(f.sage_qualite)).filter(Boolean))).sort(), [fournisseurs])
  const indexArticles = useMemo(() => new Map(articles.map((a) => [a.reference_article.toUpperCase(), a])), [articles])
  // incohérences par référence (calculées une fois par chargement)
  const incoherencesParRef = useMemo(() => {
    const m = new Map<string, string[]>()
    articles.forEach((a) => m.set(a.reference_article, detecterIncoherencesArticle(a, a.fournisseur_principal ? fournMap.get(a.fournisseur_principal) : undefined, indexArticles)))
    return m
  }, [articles, fournMap, indexArticles])

  const ctxCol = useMemo<CtxColArt>(() => ({ fournMap, incoherencesParRef }), [fournMap, incoherencesParRef])
  const clesFiltreCol = useMemo(() => (Object.keys(filtresCol) as CleColArt[]).filter((k) => (filtresCol[k] || '').trim()), [filtresCol])
  function setFiltreCol(k: CleColArt, v: string) { setFiltresCol((f) => ({ ...f, [k]: v })) }

  /** Jeu filtré (filtres généraux + filtres d'en-tête de colonne, hors pastille
   * d'incohérence) : base des KPI et des compteurs de pastilles. */
  const baseFiltree = useMemo(() => {
    const term = search.trim().toUpperCase()
    return articles.filter((a) => {
      const f = a.fournisseur_principal ? fournMap.get(a.fournisseur_principal) : undefined
      if (pertinentsSeuls && !a.pertinent_calcul_besoin) return false
      if (avecConsoSeuls && !(Number(a.conso_horizon) > 0)) return false
      if (ecartMinSeuls && !(a.champs_en_ecart || []).includes('stock_min')) return false
      if (aCommanderSeuls && !a.a_commander) return false
      if (avecEncoursSeuls && !(n0(a.encours_fourn_fms) > 0 || n0(a.encours_fourn_douteux) > 0)) return false
      if (fournFilter && a.fournisseur_principal !== fournFilter) return false
      if (familleFilter && safeText(a.famille) !== familleFilter) return false
      if (qualiteFilter && safeText(f?.sage_qualite) !== qualiteFilter) return false
      if (strategieFilter === '__none' ? !!f?.strategie_principale : strategieFilter && f?.strategie_principale !== strategieFilter) return false
      if (sommeilFilter !== 'tous' && !!a.sage_en_sommeil !== (sommeilFilter === 'oui')) return false
      if (arretApproFilter !== 'tous' && !!a.arret_appro !== (arretApproFilter === 'oui')) return false
      if (term && !(a.reference_article.toUpperCase().includes(term) || (a.sage_designation || '').toUpperCase().includes(term))) return false
      for (const k of clesFiltreCol) if (!filtreColArtOk(a, k, filtresCol[k]!, ctxCol)) return false
      return true
    })
  }, [articles, fournMap, search, fournFilter, familleFilter, pertinentsSeuls, avecConsoSeuls, ecartMinSeuls, aCommanderSeuls, avecEncoursSeuls, qualiteFilter, strategieFilter, sommeilFilter, arretApproFilter, filtresCol, ctxCol, clesFiltreCol])

  const compteursIncoherences = useMemo(() => {
    const c: Record<string, number> = {}
    INCOHERENCES_ARTICLE.forEach((i) => { c[i.code] = 0 })
    let refsAvec = 0
    baseFiltree.forEach((a) => { const l = incoherencesParRef.get(a.reference_article) || []; if (l.length) refsAvec += 1; l.forEach((k) => { c[k] = (c[k] || 0) + 1 }) })
    return { c, refsAvec }
  }, [baseFiltree, incoherencesParRef])

  const filtres = useMemo(() => {
    const list = incoherenceFilter === '__any'
      ? baseFiltree.filter((a) => (incoherencesParRef.get(a.reference_article) || []).length > 0)
      : incoherenceFilter
        ? baseFiltree.filter((a) => (incoherencesParRef.get(a.reference_article) || []).includes(incoherenceFilter))
        : baseFiltree
    if (triCol) {
      const col = COLONNES_ARTICLES.find((c) => c.key === triCol.key)!
      return trierPar(list, triCol, (a) => col.val(a, ctxCol))
    }
    return [...list].sort((a, b) => {
      if (tri === 'incoherences') return (incoherencesParRef.get(b.reference_article)?.length || 0) - (incoherencesParRef.get(a.reference_article)?.length || 0) || (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'conso') return (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'ecart') return Math.abs((b.calc_stock_min || 0) - (b.blg_stock_min_fms || 0)) - Math.abs((a.calc_stock_min || 0) - (a.blg_stock_min_fms || 0))
      if (tri === 'couverture') return (a.couverture_fms_mois ?? 999) - (b.couverture_fms_mois ?? 999)
      if (tri === 'a_commander') return n0(b.qte_a_commander) - n0(a.qte_a_commander) || (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'projete') return (n0(a.stock_projete_livraison) - n0(a.calc_stock_min)) - (n0(b.stock_projete_livraison) - n0(b.calc_stock_min))
      return a.reference_article.localeCompare(b.reference_article)
    })
  }, [baseFiltree, incoherenceFilter, incoherencesParRef, tri, triCol, ctxCol])

  // KPI sur le jeu filtré (hors pastille d'incohérence)
  const kpis = useMemo(() => {
    const pert = baseFiltree.filter((a) => a.pertinent_calcul_besoin)
    return {
      total: baseFiltree.length,
      mystock: pert.length,
      arretAppro: baseFiltree.filter((a) => a.arret_appro).length,
      avecConso: pert.filter((a) => Number(a.conso_horizon) > 0).length,
      sansConso: pert.filter((a) => !(Number(a.conso_horizon) > 0)).length,
      minBlg: pert.filter((a) => Number(a.blg_stock_min_fms) > 0).length,
      ecarts: pert.filter((a) => (a.champs_en_ecart || []).includes('stock_min')).length,
      aCommander: pert.filter((a) => a.a_commander).length,
      qteACommander: pert.reduce((s, a) => s + n0(a.qte_a_commander), 0),
      rupture: pert.filter((a) => a.rupture_avant_reception).length,
      encoursRetard: pert.filter((a) => n0(a.encours_fourn_retard) > 0).length,
      encoursDouteux: pert.filter((a) => n0(a.encours_fourn_douteux) > 0).length,
      sansDate: pert.filter((a) => a.date_livraison_par_defaut).length,
    }
  }, [baseFiltree])

  const affichees = useMemo(() => filtres.slice(0, 500), [filtres])

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
      setRecalculMsg('Erreur : ' + messageErreur(e))
    } finally { setRecalculEnCours(false) }
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Calcul de besoin')
      const cols: { h: string; f: (a: ArtRow) => unknown }[] = [
        { h: 'Référence', f: (a) => a.reference_article }, { h: 'Désignation', f: (a) => a.sage_designation }, { h: 'Famille', f: (a) => a.famille },
        { h: 'Fournisseur', f: (a) => a.fournisseur_principal }, { h: 'Qualité fournisseur', f: (a) => (a.fournisseur_principal ? fournMap.get(a.fournisseur_principal)?.sage_qualite : null) }, { h: 'Stratégie fournisseur', f: (a) => (a.fournisseur_principal ? fournMap.get(a.fournisseur_principal)?.strategie_principale : null) },
        { h: 'Incohérences', f: (a) => (incoherencesParRef.get(a.reference_article) || []).map((k) => LABEL_INCOHERENCE_ARTICLE[k]?.label || k).join(' ; ') },
        { h: 'Arrêt appro', f: (a) => (a.arret_appro ? 'Oui' : 'Non') }, { h: 'Arrêt vente', f: (a) => (a.arret_vente ? 'Oui' : 'Non') }, { h: 'Réf. remplaçante', f: (a) => a.ref_remplacante }, { h: 'Date d\'effet', f: (a) => fmtDate(a.date_effet) },
        { h: 'Délai appro réf. (j)', f: (a) => a.delai_appro_ref_jours }, { h: 'Délai sécurité réf. (j)', f: (a) => a.delai_securite_ref_jours }, { h: 'Délai sécurité effectif (j)', f: (a) => a.delai_securite_jours },
        { h: 'Réf. fournisseur', f: (a) => a.sage_ref_fournisseur }, { h: 'MYSTOCK', f: (a) => a.mystock },
        { h: 'En sommeil', f: (a) => (a.sage_en_sommeil ? 'Oui' : 'Non') }, { h: 'UO FMS', f: (a) => a.sage_uo_fms },
        { h: 'Conso horizon (qté)', f: (a) => a.conso_horizon }, { h: 'Conso moy./mois (μ)', f: (a) => a.conso_moy_mensuelle }, { h: 'Écart-type (σ)', f: (a) => a.conso_ecart_type },
        { h: 'Conso 3 derniers mois (total)', f: (a) => a.conso_3_derniers_mois }, { h: 'μ 3 mois', f: (a) => a.conso_moy_3_mois }, { h: 'μ retenu (projection)', f: (a) => a.projection_mu }, { h: 'Source μ', f: (a) => a.projection_mu_source }, { h: 'Nb mois avec sortie', f: (a) => a.nb_mois_avec_sortie }, { h: 'Dernière sortie', f: (a) => fmtMois(a.sage_derniere_sortie) },
        { h: 'Délai appro (j)', f: (a) => a.delai_appro_jours }, { h: 'Stock FMS', f: (a) => a.sage_stock_fms }, { h: 'Couverture FMS (mois)', f: (a) => a.couverture_fms_mois },
        { h: 'Encours fourn. FMS (fiable)', f: (a) => a.encours_fourn_fms }, { h: 'Encours en retard', f: (a) => a.encours_fourn_retard }, { h: 'Encours douteux (exclu)', f: (a) => a.encours_fourn_douteux },
        { h: 'Livraison estimée (max)', f: (a) => fmtDate(a.date_livraison_estimee_max) }, { h: 'Date par délai théorique', f: (a) => (a.date_livraison_par_defaut ? 'Oui' : 'Non') }, { h: 'Détail commandes fourn.', f: (a) => a.detail_cdf },
        { h: 'Dispo FMS (SAGE)', f: (a) => a.stock_dispo_sage_fms }, { h: 'Dispo agences (SAGE)', f: (a) => a.stock_dispo_sage_agences },
        { h: 'Réservé FMS (SAGE sto_res)', f: (a) => a.reserve_sage_fms }, { h: 'Réservé agences (SAGE)', f: (a) => a.reserve_sage_agences }, { h: 'Stock à terme FMS (SAGE)', f: (a) => a.sage_stock_terme_fms },
        { h: 'Reste à livrer BLG (FMS)', f: (a) => a.cdc_blg_fms }, { h: 'Reste à livrer BLG (toutes agences)', f: (a) => a.cdc_blg_total },
        { h: 'Périmètre projection', f: (a) => a.projection_perimetre }, { h: 'Stock base', f: (a) => a.projection_stock_base }, { h: 'Réservé base', f: (a) => a.projection_reserve_base }, { h: 'Encours base', f: (a) => a.projection_encours_base },
        { h: 'Délai L (j)', f: (a) => a.projection_delai_l }, { h: 'Horizon (j)', f: (a) => a.horizon_jours }, { h: 'Conso sur horizon', f: (a) => a.conso_jusqua_livraison }, { h: 'Demande retenue', f: (a) => a.projection_demande }, { h: 'Seuil de commande', f: (a) => a.projection_seuil },
        { h: 'Position (stock + encours − réservé FMS)', f: (a) => a.position_stock_fms }, { h: 'Stock avant réception', f: (a) => a.stock_avant_reception }, { h: 'Stock projeté à livraison', f: (a) => a.stock_projete_livraison },
        { h: 'Rupture avant réception', f: (a) => (a.rupture_avant_reception ? 'Oui' : 'Non') }, { h: 'À commander', f: (a) => (a.a_commander ? 'Oui' : 'Non') }, { h: 'Qté suggérée', f: (a) => a.qte_a_commander },
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
        const idxProj = cols.findIndex((c) => c.h === 'Stock projeté à livraison') + 1
        const idxCmd = cols.findIndex((c) => c.h === 'À commander') + 1
        if (a.pertinent_calcul_besoin) {
          const c2 = a.a_commander ? COULEUR_ECART : a.rupture_avant_reception ? COULEUR_NON_COMPARABLE : COULEUR_OK
          ;[idxProj, idxCmd].forEach((i) => { row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c2 } } })
        }
      })
      ws.columns.forEach((c) => { c.width = 18 })
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `calcul_besoin_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export Excel : ' + messageErreur(e))
    } finally { setExportEnCours(false) }
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-7">
        <KpiCard label="Références (filtre)" value={kpis.total} loading={loading} sub={`sur ${fmtNum(articles.length)} en base · ${fmtNum(kpis.arretAppro)} arrêt appro`} />
        <KpiCard label="Refs MYSTOCK actives" value={kpis.mystock} loading={loading} sub="pertinentes pour le CBN" />
        <KpiCard label="Avec conso sur l'horizon" value={kpis.avecConso} loading={loading} tone="ok" />
        <KpiCard label="Sans aucune sortie" value={kpis.sansConso} loading={loading} tone="warn" sub="MYSTOCK à challenger" />
        <KpiCard label="Stock min renseigné dans BLG" value={kpis.minBlg} loading={loading} />
        <KpiCard label="Stock min BLG ≠ calculé" value={kpis.ecarts} loading={loading} tone="warn" />
        <KpiCard label="À commander" value={kpis.aCommander} loading={loading} tone="warn" sub={`projeté < seuil · ${fmtNum(kpis.qteACommander)} pièces`} />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Rupture avant réception" value={kpis.rupture} loading={loading} tone="warn" sub="stock épuisé avant l'arrivée de l'encours" />
        <KpiCard label="Encours fournisseur en retard" value={kpis.encoursRetard} loading={loading} tone="warn" sub="date estimée dépassée" />
        <KpiCard label="Encours douteux (exclu)" value={kpis.encoursDouteux} loading={loading} sub={`retard > ${parametres.find((p) => p.cle === 'cdf_retard_max_jours')?.valeur ?? 60} j`} />
        <KpiCard label="Sans date de livraison" value={kpis.sansDate} loading={loading} sub="délai théorique appliqué" />
      </section>

      {/* Filtres — placés sous les KPI : ils déterminent le jeu sur lequel les KPI et les pastilles d'incohérence sont calculés */}
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
            <option value="incoherences">Tri : nombre d'incohérences</option>
            <option value="a_commander">Tri : quantité à commander</option>
            <option value="projete">Tri : projeté − stock min (le plus critique d'abord)</option>
            <option value="ecart">Tri : écart stock min (calculé vs BLG)</option>
            <option value="couverture">Tri : couverture FMS croissante</option>
            <option value="reference">Tri : référence</option>
          </select>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <select value={qualiteFilter} onChange={(e) => setQualiteFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Qualité fournisseur : Toutes</option>
            {qualiteOptions.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <select value={strategieFilter} onChange={(e) => setStrategieFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Stratégie fournisseur : Toutes</option>
            {STRATEGIES_PYRAMIDE.filter((s) => s.code).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            <option value="__none">Non renseignée</option>
          </select>
          <select value={sommeilFilter} onChange={(e) => setSommeilFilter(e.target.value as typeof sommeilFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="tous">Mise en sommeil : Toutes</option><option value="non">Actives (non en sommeil)</option><option value="oui">En sommeil</option>
          </select>
          <select value={arretApproFilter} onChange={(e) => setArretApproFilter(e.target.value as typeof arretApproFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="tous">Arrêt appro : Tous</option><option value="oui">Arrêt appro : Oui</option><option value="non">Arrêt appro : Non</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={pertinentsSeuls} onChange={(e) => setPertinentsSeuls(e.target.checked)} className="accent-[#B4761A]" /> MYSTOCK actives uniquement</label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={avecConsoSeuls} onChange={(e) => setAvecConsoSeuls(e.target.checked)} className="accent-[#B4761A]" /> Avec conso uniquement</label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={aCommanderSeuls} onChange={(e) => setACommanderSeuls(e.target.checked)} className="accent-[#B4761A]" /> À commander uniquement</label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={avecEncoursSeuls} onChange={(e) => setAvecEncoursSeuls(e.target.checked)} className="accent-[#B4761A]" /> Avec encours fournisseur</label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-semibold text-[#3A362E]"><input type="checkbox" checked={ecartMinSeuls} onChange={(e) => setEcartMinSeuls(e.target.checked)} className="accent-[#B4761A]" /> Stock min BLG ≠ calculé</label>
          </div>
          <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
            {exportEnCours ? 'Export en cours…' : `⬇ Exporter en Excel (${filtres.length} refs)`}
          </button>
        </div>
      </section>

      {/* Incohérences par référence — pastilles filtrantes */}
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Incohérences par référence</div>
            <button type="button" onClick={() => setIncoherenceFilter((v) => (v === '__any' ? null : '__any'))}
              className={`rounded-full border px-3 py-1 text-[12px] font-bold ${incoherenceFilter === '__any' ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#96600F]' : 'border-[#E5E1D8] bg-[#F4F3F0] text-[#3A362E] hover:bg-[#EDEAE1]'}`}>
              {fmtNum(compteursIncoherences.refsAvec)} réf. avec au moins une incohérence
            </button>
          </div>
          {incoherenceFilter && <button type="button" onClick={() => setIncoherenceFilter(null)} className="text-[12px] font-bold text-[#B4761A] hover:underline">Retirer le filtre incohérence</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {INCOHERENCES_ARTICLE.filter((i) => (compteursIncoherences.c[i.code] || 0) > 0).map((i) => {
            const actif = incoherenceFilter === i.code
            return (
              <button key={i.code} type="button" onClick={() => setIncoherenceFilter(actif ? null : i.code)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#96600F]' : 'border-[#E5E1D8] bg-[#F4F3F0] text-[#3A362E] hover:bg-[#EDEAE1]'}`}>
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${i.gravite === 'rouge' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{fmtNum(compteursIncoherences.c[i.code])}</span>
                {i.label}
              </button>
            )
          })}
          {compteursIncoherences.refsAvec === 0 && !loading && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Aucune incohérence sur le jeu filtré</span>}
        </div>
        <p className="mt-2 text-[12px] text-[#8A8474]">Comptées sur le jeu filtré ci-dessous. Clique une pastille pour ne voir que les références concernées ; la colonne ⚠ du tableau détaille chaque référence.</p>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-bold text-[#111820]">Calcul de besoin — stock min (point de commande) par référence MYSTOCK</div>
            <p className="mt-1 max-w-3xl text-[12px] text-[#8A8474]">
              Sur l'historique des sorties BL (flux articles, toutes agences, {parametres.find((p) => p.cle === 'horizon_mois')?.valeur ?? 12} mois complets) :
              μ = conso moyenne mensuelle, σ = écart-type. Délai L = délai d'appro + délai sécurité (jours calendaires), en priorité ceux saisis sur la référence (✎), sinon ceux du fournisseur, sinon les défauts. Une référence en "arrêt appro" ne déclenche plus de signal à commander.
              <b> Stock sécurité = z × σ × √(L/30)</b>, <b>Stock min = μ × L/30 + stock sécurité</b> (arrondi au colisage), <b>Stock max = stock min + μ × période de revue/30</b>.
              Un "stock min retenu" saisi à la main prime sur le calcul et sert de valeur cible pour BLG (quantity_min sur l'entrepôt DPFMS).
            </p>
            <p className="mt-1 max-w-3xl text-[12px] text-[#8A8474]">
              <b>Projection</b> : encours = reste à livrer des commandes fournisseurs BLG livrées au dépôt FMS (créées depuis moins de {parametres.find((p) => p.cle === 'cdf_encours_anciennete_max_jours')?.valeur ?? 365} j) ;
              ventes réservées = réservé SAGE (<span className="font-mono">sto_res</span>) du dépôt FMS, comme l'interrogation "Stock prévisionnel" de SAGE ; le réservé des agences est affiché entre parenthèses (idem pour le stock disponible). Le reste à livrer BLG est conservé en information (survol).
              Date de livraison estimée = date saisie sur la ligne ou l'entête, sinon date lue dans les commentaires BLG ("Expé S40", "Livraison 09.09", "STOCK 12/26"), sinon date de commande + délai d'appro.
              <b> Stock projeté = stock (périmètre) − demande sur l'horizon + encours</b>, où l'horizon est au moins le délai d'appro L si l'option est active.
              <b> À commander</b> quand le projeté passe sous le <b>seuil</b> = stock de sécurité + conso du délai non couvert par l'horizon (quand l'horizon = L, le seuil est le stock de sécurité : la conso du délai est déjà déduite, on ne la compte pas deux fois) ; quantité suggérée = remontée au stock max, arrondie au colisage.
              Un encours dont la date estimée est dépassée de plus de {parametres.find((p) => p.cle === 'cdf_retard_max_jours')?.valeur ?? 60} j est jugé douteux et exclu.
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
        <ModeleProjection parametres={parametres} onParametresChange={onParametresChange} onRecalcul={onRecalcul} loading={loading} />
        {showParams && (
          <div className="mt-3 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-3">
            <div className="grid gap-2 md:grid-cols-3">
              {parametres.filter((p) => !PROJECTION_PARAM_KEYS.includes(p.cle)).map((p) => (
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading ? `Chargement… ${loadProgress} articles` : filtres.length > 500 ? `500 affichées sur ${filtres.length} — affine ou exporte` : `${filtres.length} référence${filtres.length > 1 ? 's' : ''}`}
            {triCol && <span className="ml-2 normal-case tracking-normal text-[#B4761A]">· tri par colonne actif (le tri prédéfini est ignoré)</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#8A8474]">
            {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
            {(triCol || clesFiltreCol.length > 0) && (
              <button type="button" onClick={() => { setTriCol(null); setFiltresCol({}) }} className="font-bold text-[#B4761A] hover:underline">Réinitialiser tri et filtres de colonnes</button>
            )}
            <span>Clic sur un en-tête : tri · champs d'en-tête : filtre (texte "contient", nombres "&gt;10", "&lt;=5", "=0", "vide" / "!vide") — les KPI et pastilles suivent les filtres</span>
          </div>
        </div>
        <div className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8]">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[10px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                {COLONNES_ARTICLES.map((c) => (
                  <ThTri key={c.key} k={c.key} label={c.label} title={c.title} align={c.align} tri={triCol} onTri={(k) => setTriCol((t) => basculerTri(t, k))} className="whitespace-nowrap" />
                ))}
              </tr>
              <tr className="bg-[#F4F3F0]/80">
                {COLONNES_ARTICLES.map((c) => (
                  <td key={c.key} className="px-1 pb-2"><InputFiltre value={filtresCol[c.key] || ''} onChange={(v) => setFiltreCol(c.key, v)} align={c.align} placeholder={c.placeholder || 'filtre'} /></td>
                ))}
              </tr>
            </thead>
            <tbody>
              {affichees.map((a) => {
                const ecart = (a.champs_en_ecart || []).includes('stock_min')
                const sousMin = !!a.a_commander
                const encours = n0(a.encours_fourn_fms), douteux = n0(a.encours_fourn_douteux), retard = n0(a.encours_fourn_retard)
                const f = a.fournisseur_principal ? fournMap.get(a.fournisseur_principal) : undefined
                const incs = incoherencesParRef.get(a.reference_article) || []
                const incRouge = incs.some((k) => LABEL_INCOHERENCE_ARTICLE[k]?.gravite === 'rouge')
                const delaiRef = a.delai_appro_ref_jours !== null && a.delai_appro_ref_jours !== undefined
                const secuRef = a.delai_securite_ref_jours !== null && a.delai_securite_ref_jours !== undefined
                const titreEncours = [
                  a.detail_cdf ? `Commandes : ${a.detail_cdf}` : null,
                  a.date_livraison_estimee_max ? `Livraison estimée (dernière) : ${fmtDate(a.date_livraison_estimee_max)} — horizon ${fmtNum(a.horizon_jours)} j, conso d'ici là ${fmtNum(a.conso_jusqua_livraison, 1)}` : null,
                  retard ? `En retard : ${fmtNum(retard)} (jusqu'à ${fmtNum(a.nb_jours_retard_max)} j)` : null,
                  douteux ? `Douteux (exclu de la projection) : ${fmtNum(douteux)}` : null,
                  n0(a.encours_fourn_total) > encours + douteux ? `Autres dépôts : ${fmtNum(n0(a.encours_fourn_total) - encours - douteux)}` : null,
                ].filter(Boolean).join('\n')
                return (
                  <tr key={a.reference_article} className={`border-t border-[#E5E1D8] hover:bg-[#F4F3F0] ${sousMin ? 'bg-red-50/30' : ''} ${a.arret_appro ? 'opacity-70' : ''}`}>
                    <td className="px-2 py-1.5" title={incs.length ? incs.map((k) => `• ${LABEL_INCOHERENCE_ARTICLE[k]?.label || k}`).join('\n') : 'Aucune incohérence'}>
                      {incs.length ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${incRouge ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>⚠ {incs.length}</span> : <span className="text-[#B3AD9E]">·</span>}
                    </td>
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
                    <td className="px-2 py-1.5 font-mono text-[11px]" title={f ? `${f.sage_intitule || ''} · ${f.sage_qualite || ''}${f.sage_en_sommeil ? ' · EN SOMMEIL' : ''}` : undefined}>{a.fournisseur_principal || '—'}{f?.sage_en_sommeil ? <span className="ml-1 text-[10px] text-red-700">zz</span> : null}</td>
                    <td className="px-2 py-1.5 text-[11px] text-[#3A362E]">{f ? (f.strategie_principale || <span className="text-[#B4761A]">—</span>) : <span className="text-[#B3AD9E]">—</span>}</td>
                    <td className="px-2 py-1.5 text-[11px]">
                      <div className="flex flex-wrap gap-1">
                        {a.arret_appro && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Appro</span>}
                        {a.arret_vente && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">Vente</span>}
                        {a.ref_remplacante && <span className="rounded bg-[#F4F3F0] px-1 py-0.5 font-mono text-[10px] text-[#3A362E]" title="Référence remplaçante">→ {a.ref_remplacante}</span>}
                        {a.date_effet && <span className="text-[10px] text-[#8A8474]" title="Date d'effet">{fmtDate(a.date_effet)}</span>}
                        {!a.arret_appro && !a.arret_vente && !a.ref_remplacante && <span className="text-[#B3AD9E]">—</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right" title={`Délai d'appro ${fmtNum(delaiRef ? a.delai_appro_ref_jours : a.delai_appro_jours)} j${delaiRef ? ' (référence)' : ' (fournisseur / défaut)'} + sécurité ${fmtNum(secuRef ? a.delai_securite_ref_jours : a.delai_securite_jours)} j${secuRef ? ' (référence)' : ' (fournisseur / défaut)'}`}>
                      <span className={delaiRef || secuRef ? 'font-semibold text-[#96600F]' : ''}>{fmtNum(a.projection_delai_l)}{delaiRef || secuRef ? ' ref' : ''}</span>
                    </td>
                    <td className={`px-2 py-1.5 text-right ${a.projection_mu_source !== '3m' ? 'font-semibold text-[#111820]' : ''}`}>{fmtNum(a.conso_moy_mensuelle, 1)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.conso_ecart_type, 1)}</td>
                    <td className={`px-2 py-1.5 text-right ${a.projection_mu_source === '3m' ? 'font-semibold text-[#111820]' : ''}`} title={`Total 3 derniers mois : ${fmtNum(a.conso_3_derniers_mois)}${n0(a.conso_moy_mensuelle) > 0 ? ` · ${Math.round((n0(a.conso_moy_3_mois) / n0(a.conso_moy_mensuelle) - 1) * 100) >= 0 ? '+' : ''}${Math.round((n0(a.conso_moy_3_mois) / n0(a.conso_moy_mensuelle) - 1) * 100)} % vs μ 12 mois` : ''}`}>{fmtNum(a.conso_moy_3_mois, 1)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMois(a.sage_derniere_sortie)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtNum(a.sage_stock_fms)}</td>
                    <td className="px-2 py-1.5 text-right" title={`Disponible FMS : ${fmtNum(a.stock_dispo_sage_fms)} · agences : ${fmtNum(a.stock_dispo_sage_agences)} (stock physique agences ${fmtNum(a.sage_stock_agences)})`}>
                      {fmtNum(a.stock_dispo_sage_fms)}{n0(a.stock_dispo_sage_agences) > 0 ? <span className="ml-1 text-[10px] text-[#8A8474]">({fmtNum(a.stock_dispo_sage_agences)})</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right" title={titreEncours || undefined}>
                      {encours > 0 || douteux > 0 ? (
                        <div className="flex flex-col items-end leading-tight">
                          <span className={retard > 0 ? 'font-semibold text-[#96600F]' : 'font-semibold text-[#111820]'}>
                            {fmtNum(encours)}{retard > 0 ? ' ⏱' : ''}{douteux > 0 ? <span className="ml-1 text-[10px] text-[#B3AD9E]">+{fmtNum(douteux)}?</span> : null}
                          </span>
                          {a.date_livraison_estimee_max && encours > 0 && (
                            <span className="text-[10px] text-[#8A8474]">{a.date_livraison_par_defaut ? '≈ ' : ''}{fmtDate(a.date_livraison_estimee_max)}</span>
                          )}
                        </div>
                      ) : <span className="text-[#B3AD9E]">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right" title={`Réservé SAGE — FMS : ${fmtNum(a.reserve_sage_fms)} · agences : ${fmtNum(a.reserve_sage_agences)}\nReste à livrer BLG — FMS : ${fmtNum(a.cdc_blg_fms)} · toutes agences : ${fmtNum(a.cdc_blg_total)} (${fmtNum(a.nb_cdc_a_livrer)} commandes)`}>
                      {n0(a.reserve_sage_fms) > 0 || n0(a.reserve_sage_agences) > 0
                        ? <>{fmtNum(a.reserve_sage_fms)}{n0(a.reserve_sage_agences) > 0 ? <span className="ml-1 text-[10px] text-[#8A8474]">({fmtNum(a.reserve_sage_agences)})</span> : null}{n0(a.cdc_blg_fms) !== n0(a.reserve_sage_fms) ? <span className="ml-0.5 text-[10px] text-[#B3AD9E]" title="Écart avec le reste à livrer BLG">≠</span> : null}</>
                        : <span className="text-[#B3AD9E]">—</span>}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${a.rupture_avant_reception ? 'bg-red-50 text-red-800' : sousMin ? 'text-red-700' : 'text-[#111820]'}`}
                      title={[
                        `Périmètre ${a.projection_perimetre === 'global' ? 'global' : 'FMS'} · horizon ${fmtNum(a.horizon_jours)} j (délai L ${fmtNum(a.projection_delai_l)} j) · μ ${a.projection_mu_source === '3m' ? '3 mois' : '12 mois'} = ${fmtNum(a.projection_mu, 1)}`,
                        `Stock ${fmtNum(a.projection_stock_base)} − demande ${fmtNum(a.projection_demande, 1)} (réservé ${fmtNum(a.projection_reserve_base)} / conso ${fmtNum(a.conso_jusqua_livraison, 1)}) + encours ${fmtNum(a.projection_encours_base)} = ${fmtNum(a.stock_projete_livraison, 1)}`,
                        `Seuil de commande : ${fmtNum(a.projection_seuil, 1)} (sécurité ${fmtNum(a.calc_stock_securite, 1)})`,
                        a.rupture_avant_reception ? `Stock avant réception ${fmtNum(a.stock_avant_reception, 1)} : rupture avant l'arrivée de l'encours` : null,
                        `Position (stock + encours − réservé) : ${fmtNum(a.position_stock_fms)} · stock à terme SAGE FMS : ${fmtNum(a.sage_stock_terme_fms)}`,
                      ].filter(Boolean).join('\n')}>
                      {fmtNum(a.stock_projete_livraison)}{a.rupture_avant_reception ? ' ⚠' : ''}
                    </td>
                    <td className="px-2 py-1.5 text-right" title={`Projetée (${a.projection_perimetre === 'global' ? 'global' : 'FMS'}) : position ${fmtNum(a.position_stock_fms)} / μ ${fmtNum(a.projection_mu, 1)} = ${fmtNum(a.couverture_projetee_mois, 1)} mois\nStock physique FMS seul / μ 12 mois : ${fmtNum(a.couverture_fms_mois, 1)} mois`}>
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-semibold text-[#111820]">{a.couverture_projetee_mois === null || a.couverture_projetee_mois === undefined ? '—' : fmtNum(a.couverture_projetee_mois, 1)}</span>
                        <span className="text-[10px] text-[#8A8474]">FMS {fmtNum(a.couverture_fms_mois, 1)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.sage_stock_min_fms)}</td>
                    <td className={`px-2 py-1.5 text-right ${ecart ? 'bg-red-50 font-semibold text-red-800' : 'text-[#8A8474]'}`}>{fmtNum(a.blg_stock_min_fms)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.calc_stock_securite)}</td>
                    <td className="px-2 py-1.5 text-right font-bold">{fmtNum(a.calc_stock_min)}</td>
                    <td className="px-2 py-1.5 text-right text-[#8A8474]">{fmtNum(a.calc_stock_max)}</td>
                    <td className="px-2 py-1.5 text-right">{sousMin ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-700">{fmtNum(a.qte_a_commander)}</span> : <span className="text-[#B3AD9E]">—</span>}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" title={a.commentaire_stock_min || 'Stock min retenu, délais de la référence, arrêt appro / vente, remplaçante'} onClick={() => setEditArticle(a)}
                        className={`rounded px-2 py-0.5 font-mono ${a.stock_min_retenu !== null && a.stock_min_retenu !== undefined ? 'bg-[#B4761A]/[0.12] font-bold text-[#96600F]' : 'text-[#B3AD9E] hover:bg-[#F4F3F0]'}`}>
                        {a.stock_min_retenu !== null && a.stock_min_retenu !== undefined ? fmtNum(a.stock_min_retenu) : '✎'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!loading && affichees.length === 0 && <tr><td colSpan={23} className="px-3 py-8 text-center text-[#8A8474]">Aucune référence pour ces filtres.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {editArticle && (
        <ArticleManuelModal article={editArticle} fournisseur={editArticle.fournisseur_principal ? fournMap.get(editArticle.fournisseur_principal) : undefined}
          onClose={() => setEditArticle(null)} onSaved={(a) => { onArticleChange(a); setEditArticle(null) }} />
      )}
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
  const [sommeilFilter, setSommeilFilter] = useState<'tous' | 'oui' | 'non'>('non')
  const exclureSommeil = sommeilFilter === 'non'
  const [mystockSeul, setMystockSeul] = useState(true)
  const [negoceSeul, setNegoceSeul] = useState(true)
  const [perimetreSeul, setPerimetreSeul] = useState(false)
  // filtres fournisseur complémentaires
  const [qualiteFilter, setQualiteFilter] = useState('')
  const [strategieFilter, setStrategieFilter] = useState('')
  const [delaiFilter, setDelaiFilter] = useState<'tous' | 'oui' | 'non'>('tous')
  const [cdfFilter, setCdfFilter] = useState<'tous' | '0' | '1' | '10'>('tous')
  const [activiteFilter, setActiviteFilter] = useState<ActiviteFilter>('')
  const [mystockFilter, setMystockFilter] = useState<'tous' | 'avec' | 'sans'>('tous')
  const [nonMystockFilter, setNonMystockFilter] = useState<'tous' | 'avec' | 'sans'>('tous')
  const qualiteOptions = useMemo(() => Array.from(new Set(fournisseurs.map((f) => safeText(f.sage_qualite)).filter(Boolean))).sort(), [fournisseurs])
  const [champsSelectionnes, setChampsSelectionnes] = useState<string[]>([])
  const [combinaison, setCombinaison] = useState<'ou' | 'et'>('ou')
  const [ligneActive, setLigneActive] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => { setChampsSelectionnes([]); setLigneActive(null); setOuvert(null) }, [domaine])

  // Base de lignes selon le domaine (filtres "serveur" équivalents : sommeil, négoce, MYSTOCK, périmètre classeur)
  const perimetreSet = useMemo(() => new Set(fournisseurs.filter((f) => f.perimetre_cbn).map((f) => f.numero)), [fournisseurs])
  const baseFourn = useMemo(() => fournisseurs.filter((r) => {
    if (sommeilFilter !== 'tous' && !!r.sage_en_sommeil !== (sommeilFilter === 'oui')) return false
    if (perimetreSeul && !r.perimetre_cbn) return false
    if (negoceSeul && r.statut_appariement !== 'blg_seul' && ['HORS_NEGOCE', 'SOMMEIL'].includes(r.statut_appro || '')) return false
    if (qualiteFilter && safeText(r.sage_qualite) !== qualiteFilter) return false
    if (strategieFilter === '__none' ? !!r.strategie_principale : strategieFilter && r.strategie_principale !== strategieFilter) return false
    if (delaiFilter !== 'tous' && !!r.delai_appro_present !== (delaiFilter === 'oui')) return false
    if (cdfFilter === '0' && n0(r.nb_cdf_ytd) !== 0) return false
    if (cdfFilter === '1' && n0(r.nb_cdf_ytd) < 1) return false
    if (cdfFilter === '10' && n0(r.nb_cdf_ytd) < 10) return false
    if (!activiteCorrespond(r, activiteFilter)) return false
    if (mystockFilter !== 'tous' && (n0(r.sage_nb_refs_mystock) > 0) !== (mystockFilter === 'avec')) return false
    const nonMystock = n0(r.sage_nb_refs_actives) - n0(r.sage_nb_refs_mystock)
    if (nonMystockFilter !== 'tous' && (nonMystock > 0) !== (nonMystockFilter === 'avec')) return false
    return true
  }), [fournisseurs, sommeilFilter, negoceSeul, perimetreSeul, qualiteFilter, strategieFilter, delaiFilter, cdfFilter, activiteFilter, mystockFilter, nonMystockFilter])
  const baseArt = useMemo(() => articles.filter((a) => {
    if (exclureSommeil && a.sage_en_sommeil) return false
    if (mystockSeul && !a.pertinent_calcul_besoin) return false
    if (perimetreSeul && !(a.fournisseur_principal && perimetreSet.has(a.fournisseur_principal))) return false
    return true
  }), [articles, exclureSommeil, mystockSeul, perimetreSeul, perimetreSet])

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
          { h: 'Périmètre classeur', f: (r) => ((r as FournRow).perimetre_cbn ? 'Oui' : 'Non') }, { h: 'Qualité classeur', f: (r) => (r as FournRow).qualite_classeur },
          { h: 'Statut appro', f: (r) => (r as FournRow).statut_appro }, { h: "Stratégie d'appro", f: (r) => (r as FournRow).strategie_principale }, { h: 'Suggestion', f: (r) => (r as FournRow).strategie_suggeree },
          { h: 'Calcul de besoin', f: (r) => ((r as FournRow).calcul_besoin_effectif ? 'Oui' : 'Non') }, { h: 'Périodicité', f: (r) => (r as FournRow).periodicite },
          { h: 'Nb champs en écart', f: (r) => compterEcarts(evals.get(cle(r))).rouge }, { h: 'Frs PV', f: (r) => ((r as FournRow).sage_frs_pv ? ((r as FournRow).frs_pv_force ? 'Oui (forcé)' : 'Oui') : 'Non') },
          { h: 'Délai appro renseigné', f: (r) => ((r as FournRow).delai_appro_present ? 'OUI' : 'NON') }, { h: 'Délai appro retenu (j)', f: (r) => (r as FournRow).delai_appro_retenu },
          { h: 'Refs actives', f: (r) => (r as FournRow).sage_nb_refs_actives }, { h: 'Refs MYSTOCK', f: (r) => (r as FournRow).sage_nb_refs_mystock }, { h: 'Refs stock agence', f: (r) => (r as FournRow).sage_nb_refs_stock_agence },
          { h: 'Refs MYSTOCK avec conso', f: (r) => (r as FournRow).sage_nb_refs_mystock_conso }, { h: 'Refs min/max SAGE', f: (r) => (r as FournRow).sage_nb_refs_min_max }, { h: 'Refs min/max BLG', f: (r) => (r as FournRow).blg_nb_refs_min_max },
          { h: 'Cdes YTD', f: (r) => (r as FournRow).nb_cdf_ytd }, { h: 'Cdes YTD FMS', f: (r) => (r as FournRow).nb_cdf_ytd_fms }, { h: 'Cdes YTD agences', f: (r) => (r as FournRow).nb_cdf_ytd_hors_fms }, { h: 'Montant HT cdes YTD', f: (r) => (r as FournRow).montant_ht_cdf_ytd },
          { h: 'Dernière sortie', f: (r) => fmtMois((r as FournRow).sage_derniere_sortie) },
          { h: 'Dernière commande BLG (toutes années)', f: (r) => fmtDate((r as FournRow).derniere_cdf_toutes) }, { h: 'Cdes 24 mois', f: (r) => (r as FournRow).nb_cdf_24m },
          { h: 'Dernière activité', f: (r) => fmtDate((r as FournRow).derniere_activite) }, { h: 'Mois sans activité', f: (r) => moisDepuis((r as FournRow).derniere_activite) ?? 'Jamais' }, { h: 'Sans activité 24 mois', f: (r) => (activiteCorrespond(r as FournRow, 'aucune_24m') ? 'Oui' : 'Non') },
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
      alert('Erreur export Excel : ' + messageErreur(e))
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
          <select value={sommeilFilter} onChange={(e) => setSommeilFilter(e.target.value as typeof sommeilFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 text-[13px] font-bold text-[#3A362E]">
            <option value="non">En sommeil (SAGE) : Non — actifs uniquement</option><option value="oui">En sommeil (SAGE) : Oui</option><option value="tous">En sommeil (SAGE) : Tous</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]"><input type="checkbox" checked={perimetreSeul} onChange={(e) => setPerimetreSeul(e.target.checked)} className="accent-[#B4761A]" /> Périmètre classeur uniquement ({perimetreSet.size} fournisseurs{domaine === 'article' ? ' et leurs références' : ''})</label>
          {domaine === 'fournisseur' ? (
            <>
              <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]"><input type="checkbox" checked={negoceSeul} onChange={(e) => setNegoceSeul(e.target.checked)} className="accent-[#B4761A]" /> Fournisseurs négoce uniquement (hors frais généraux / transport / stations)</label>
              <div className="grid w-full gap-2 md:grid-cols-7">
                <select value={qualiteFilter} onChange={(e) => setQualiteFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                  <option value="">Qualité : Toutes</option>{qualiteOptions.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
                <select value={strategieFilter} onChange={(e) => setStrategieFilter(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                  <option value="">Stratégie principale : Toutes</option>{STRATEGIES_PYRAMIDE.filter((s) => s.code).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}<option value="__none">Non renseignée</option>
                </select>
                <select value={delaiFilter} onChange={(e) => setDelaiFilter(e.target.value as typeof delaiFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                  <option value="tous">Délai d'appro : Tous</option><option value="oui">Délai d'appro : renseigné</option><option value="non">Délai d'appro : absent</option>
                </select>
                <select value={cdfFilter} onChange={(e) => setCdfFilter(e.target.value as typeof cdfFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                  <option value="tous">Commandes {new Date().getFullYear()} : Toutes</option><option value="0">Aucune commande</option><option value="1">Au moins 1 commande</option><option value="10">10 commandes et plus</option>
                </select>
                <select value={activiteFilter} onChange={(e) => setActiviteFilter(e.target.value as ActiviteFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
                  title="Activité = dernière commande fournisseur BLG (toutes années) ou dernière sortie BL de ses références">
                  {ACTIVITE_OPTIONS.map((o) => <option key={o.value || '__all'} value={o.value}>{o.label}</option>)}
                </select>
                <select value={mystockFilter} onChange={(e) => setMystockFilter(e.target.value as typeof mystockFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                  <option value="tous">Refs MYSTOCK : Tous</option><option value="avec">Avec refs MYSTOCK</option><option value="sans">Sans ref MYSTOCK</option>
                </select>
                <select value={nonMystockFilter} onChange={(e) => setNonMystockFilter(e.target.value as typeof nonMystockFilter)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                  <option value="tous">Refs actives non MYSTOCK : Tous</option><option value="avec">Avec refs actives non MYSTOCK</option><option value="sans">Sans ref active non MYSTOCK</option>
                </select>
              </div>
            </>
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
                {domaine === 'fournisseur' && <th className="px-3 py-2 text-right font-bold" title="Dernière activité : max(dernière commande fournisseur BLG, dernière sortie BL de ses références)">Dern. activité</th>}
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
                    {domaine === 'fournisseur' && (
                      <td className={`whitespace-nowrap px-3 py-2 text-right text-[12px] ${activiteCorrespond(r as FournRow, 'aucune_24m') ? 'font-semibold text-red-700' : 'text-[#3A362E]'}`}>{libelleActivite(r as FournRow)}</td>
                    )}
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
              {!loading && rowsAffichees.length === 0 && <tr><td colSpan={2 + (domaine === 'fournisseur' ? 1 : 0) + pairesSelectionnees.length * 2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>}
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
              {'perimetre_cbn' in ligneOuverte && ligneOuverte.perimetre_cbn && <span className="rounded-full bg-[#111820] px-2 py-0.5 text-white">Classeur</span>}
              {'derniere_activite' in ligneOuverte && <span className={`rounded-full px-2 py-0.5 ${activiteCorrespond(ligneOuverte, 'aucune_24m') ? 'bg-red-50 text-red-700' : 'bg-[#F4F3F0] text-[#3A362E]'}`}>Dernière activité : {libelleActivite(ligneOuverte)}</span>}
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
      setError(messageErreur(e))
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
