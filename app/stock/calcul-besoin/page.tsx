'use client'

/**
 * Écran « Calcul de besoin - Appro » (menu Stocks & logistique, /stock/calcul-besoin).
 * ---------------------------------------------------------------------------
 * Créé le 04/10/2026 à partir de l'écran « Fournisseurs & articles SAGE / BLG »
 * (/controle-sage-blg/fournisseur-sage-blg, inchangé, qui garde l'onglet Comparaison).
 *
 * 2 onglets :
 *  - Fournisseurs : liste & paramètres — reprise à l'identique de l'onglet
 *    « Fournisseurs & stratégie » (pyramide classeur, liste triable / filtrable,
 *    fiche fournisseur flottante) ; la fiche porte en plus la conso retenue par
 *    défaut du fournisseur (μ 12 mois, μ 3 mois, 3 prochains mois N−1, × coef).
 *  - Calcul de besoin - Articles :
 *      · bandeau « À commander » collé en haut : nombre de références, fournisseurs,
 *        pièces, montant HT, ruptures à réception, encours en retard, économie paliers —
 *        sur le jeu filtré et recalculé à chaque quantité saisie ;
 *      · indicateurs compacts (hauteur ÷ 3), filtres densifiés, incohérences repliées ;
 *      · pavé calcul de besoin sur une ligne, explications derrière des « i » ;
 *      · paramètres d'appro modifiables sur chaque ligne (stratégie, méthode A/B,
 *        couvertures min / max, conso retenue + coef, délai d'appro, délai de sécurité) :
 *        valeur du fournisseur par défaut, surcharge article en couleur, enregistrée
 *        dans appro_article_stock_min et recalcul immédiat de la ligne (SS / min / max
 *        compris, mêmes formules que refresh_appro_calcul_besoin) ;
 *      · clic sur le fournisseur : fiche fournisseur flottante ;
 *      · clic sur la référence : fenêtre article — sorties mensuelles depuis le 1er janvier
 *        N−1, ventes anormales détectées (écart robuste à la médiane), écrêtage des mois
 *        exceptionnels (appro_article_conso_ecretage), clients d'un mois, μ 12 mois / 3 mois /
 *        3 prochains mois N−1 / N−1 × coef, choix de la conso retenue avec aperçu de la
 *        proposition ; navigation ← / → entre les références du tableau.
 *
 * 06/10/2026 — groupes de références et plan d'appro :
 *      · filtre « Groupe » (stock_groupes_articles) ou groupe à la volée (références collées,
 *        sélection filtrée), enregistrable ; le groupe restreint le tableau ET les indicateurs
 *        (la pastille MYSTOCK actives est ignorée pour un groupe) ;
 *      · bouton « Plan d'appro & couverture » : projection mensuelle de la sélection selon des
 *        hypothèses de conso (N-1 × coef, chaînages de références), saisie / proposition des
 *        commandes mensuelles, couverture en quantité, mois et valeur (components/appro/PlanApproModal.tsx,
 *        moteur lib/planAppro.ts, migration supabase/sql/20261006_plan_appro_operation.sql).
 *
 * Hiérarchie des paramètres : article > fournisseur > paramètre global (appro_parametres) ;
 * la méthode peut en plus être forcée sur l'écran.
 *
 * Sources : v_appro_controle_fournisseur_sage_blg, v_appro_controle_article_sage_blg,
 * v_appro_article_conso_profil, appro_article_conso_mensuelle, appro_article_conso_ecretage,
 * appro_fournisseur_strategie, appro_article_stock_min, appro_parametres,
 * v_appro_tarif_qte_fournisseur ; RPC refresh_appro_calcul_besoin,
 * appro_enregistrer_proposition, appro_importer_blocage_articles, appro_article_sorties_clients.
 * Migration requise : supabase/sql/20261004_calcul_besoin_appro.sql.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabaseClient'
import ExcelJS from 'exceljs'
import PlanApproModal from '@/components/appro/PlanApproModal'
import type { PlanArticle } from '@/lib/planAppro'

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
  // blocage appro (table appro_article_blocage — export SAGE AR_InterdireCommande / AR_Exclure / VieProduit)
  blocage_appro: boolean | null               // AR_InterdireCommande = 1 → pastille "Blocage appro"
  exclure_appro: boolean | null               // AR_Exclure = 1
  vie_produit: string | null                  // FINDEVIE…
  blocage_importe_le: string | null
  // stratégie de réappro & proposition retenue (migration appro_strategie_couverture_echeances)
  ref_methode_calcul: MethodeCalcul | null    // surcharge par référence (sinon fournisseur, sinon défaut)
  ref_couverture_min_mois: number | null
  ref_couverture_cible_mois: number | null
  qte_proposition_manuelle: number | null     // quantité retenue saisie (prime sur la proposition calculée)
  date_livraison_souhaitee: string | null
  proposition_maj_le: string | null
  sage_stock_dispo_total: number | null
  reserve_echeances: Echeance[] | null        // réservé SAGE par date de livraison (lignes BC reliquat)
  encours_echeances: Echeance[] | null        // encours fournisseur par date estimée
}

type MethodeCalcul = 'min_max' | 'couverture'
type Echeance = { d: string; q: number; fms: boolean; src?: string }
/** Paramètres de réappro portés par le fournisseur (appro_fournisseur_strategie). */
type ParamsFourn = {
  fournisseur: string; methode_calcul: MethodeCalcul | null; couverture_min_mois: number | null; couverture_cible_mois: number | null
  delai_appro_jours?: number | null; delai_securite_jours?: number | null; niveau_service_z?: number | null
  strategie_principale?: string | null; conso_source?: ConsoSource | null; conso_coef?: number | null
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
function fmtEuro2(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

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
/** Pastille "Blocage appro" (AR_InterdireCommande = 1 dans SAGE) + fin de vie / exclusion,
 * affichée partout où une référence article apparaît. */
function BlocageApproBadge({ article, compact = false }: { article: Pick<ArtRow, 'blocage_appro' | 'exclure_appro' | 'vie_produit'>; compact?: boolean }) {
  if (!article.blocage_appro && !article.exclure_appro && !article.vie_produit) return null
  const titre = [
    article.blocage_appro ? 'Commande interdite dans SAGE (AR_InterdireCommande = 1) : ne pas réapprovisionner' : null,
    article.exclure_appro ? 'Article exclu (AR_Exclure = 1)' : null,
    article.vie_produit ? `Vie produit : ${article.vie_produit}` : null,
  ].filter(Boolean).join('\n')
  return (
    <span className="inline-flex items-center gap-1" title={titre}>
      {article.blocage_appro && <span className={`rounded-full bg-red-600 font-bold text-white ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}>⛔ Blocage appro</span>}
      {article.exclure_appro && <span className={`rounded-full bg-red-50 font-bold text-red-700 ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}>Exclu</span>}
      {article.vie_produit && <span className={`rounded-full bg-orange-100 font-bold text-orange-700 ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`}>{/^fin ?de ?vie$/i.test(article.vie_produit.trim()) ? 'Fin de vie' : article.vie_produit}</span>}
    </span>
  )
}

function QualiteBadge({ qualite }: { qualite: string | null | undefined }) {
  const q = safeText(qualite)
  if (!q) return null
  const up = q.toUpperCase()
  const cls = up.includes('MARCHANDISE') ? 'bg-sky-50 text-sky-800' : up === 'PV' ? 'bg-amber-50 text-amber-700' : 'bg-[#F4F3F0] text-[#8A8474]'
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`} title={`Qualité SAGE : ${q}`}>{q}</span>
}

/** Texte normalisé (sans accents, majuscules, ponctuation → espaces) pour les filtres « contient ». */
function normaliserTexte(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.map(String).join(' ') : String(v)
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Couleurs de l'export Excel (ARGB). */
const COULEUR_OK = 'FFDCFCE7', COULEUR_ECART = 'FFFECACA', COULEUR_NON_COMPARABLE = 'FFFED7AA'

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
  methode_calcul: '' | MethodeCalcul; couverture_min_mois: string; couverture_cible_mois: string
  conso_source: '' | ConsoSource; conso_coef: string
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
function FicheFournisseurModal({ selected, strategies, articles, onRowChange, onClose, onStrategieSaved }: {
  selected: FournRow; strategies: StrategieRef[]; articles: ArtRow[]; onRowChange: (r: FournRow) => void; onClose: () => void; onStrategieSaved?: () => void
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
      methode_calcul: '', couverture_min_mois: '', couverture_cible_mois: '',
      conso_source: '', conso_coef: '',
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
        methode_calcul: (data.methode_calcul as MethodeCalcul | null) ?? '', couverture_min_mois: data.couverture_min_mois ?? '', couverture_cible_mois: data.couverture_cible_mois ?? '',
        conso_source: estConsoSource(data.conso_source) ? data.conso_source : '', conso_coef: data.conso_coef === null || data.conso_coef === undefined ? '' : String(Math.round(Number(data.conso_coef) * 100)),
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
        methode_calcul: form.methode_calcul || null,
        couverture_min_mois: form.couverture_min_mois === '' ? null : Number(form.couverture_min_mois),
        couverture_cible_mois: form.couverture_cible_mois === '' ? null : Number(form.couverture_cible_mois),
        conso_source: form.conso_source || null,
        conso_coef: form.conso_source === 'fut3_coef' && form.conso_coef.trim() !== '' ? Number(form.conso_coef.replace(',', '.')) / 100 : null,
        updated_at: new Date().toISOString(),
      }
      const { error: err } = await supabase.from('appro_fournisseur_strategie').upsert(payload, { onConflict: 'fournisseur' })
      if (err) throw err
      const { data, error: err2 } = await supabase.from('v_appro_controle_fournisseur_sage_blg').select('*').eq('numero', selected.numero).maybeSingle()
      if (err2) throw err2
      if (data) onRowChange(data as FournRow)
      onStrategieSaved?.()
      setSaveMsg('Stratégie enregistrée. Les propositions sont recalculées ; relance « Recalculer les stocks min » si tu as changé un délai ou le niveau de service.')
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
              <div className="mt-1 grid grid-cols-[1.6fr_1fr_1fr] gap-2 rounded-lg border border-[#B4761A]/25 bg-[#B4761A]/[0.04] px-2 py-2 text-[12px]">
                <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Méthode de réappro</span>
                  <select value={form.methode_calcul} onChange={(e) => setForm({ ...form, methode_calcul: e.target.value as '' | MethodeCalcul })} className="h-8 rounded-lg border border-[#E5E1D8] bg-white px-2 font-semibold">
                    <option value="">— défaut paramètre —</option>
                    <option value="min_max">A · Min/Max — point de commande (stock de sécurité)</option>
                    <option value="couverture">B · Couverture cible à réception</option>
                  </select></label>
                <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">B · couverture min (mois)</span>
                  <input value={form.couverture_min_mois} onChange={(e) => setForm({ ...form, couverture_min_mois: e.target.value })} placeholder="défaut" title="Déclencheur : couverture à réception < min → réappro" className="h-8 rounded-lg border border-[#E5E1D8] px-2" /></label>
                <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">B · couverture cible (mois)</span>
                  <input value={form.couverture_cible_mois} onChange={(e) => setForm({ ...form, couverture_cible_mois: e.target.value })} placeholder="défaut" title="On recomplète jusqu'à cible × μ à réception" className="h-8 rounded-lg border border-[#E5E1D8] px-2" /></label>
                <label className="col-span-2 flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Conso retenue par défaut (calcul de besoin)</span>
                  <select value={form.conso_source} onChange={(e) => setForm({ ...form, conso_source: e.target.value as '' | ConsoSource })} className="h-8 rounded-lg border border-[#E5E1D8] bg-white px-2 font-semibold">
                    <option value="">— défaut paramètre (μ 12 ou 3 mois) —</option>
                    {CONSO_SOURCES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select></label>
                <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Coef N−1 (%)</span>
                  <input value={form.conso_coef} onChange={(e) => setForm({ ...form, conso_coef: e.target.value })} disabled={form.conso_source !== 'fut3_coef'} placeholder="ex. 120" title="Pour « 3 prochains mois N−1 × coef » : 120 = +20 % sur l'an dernier" className="h-8 rounded-lg border border-[#E5E1D8] px-2 disabled:opacity-40" /></label>
                <span className="col-span-3 text-[11px] text-[#8A8474]">A : commande dès que le stock à réception passe sous le stock de sécurité, quantité = remontée au stock max. B : commande dès que la couverture à réception passe sous la couverture min, quantité = cible × μ − stock à réception. Méthode, couvertures et conso se surchargent sur chaque référence de l'écran Calcul de besoin.</span>
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
                      <td className="px-2 py-1"><span className="font-mono font-semibold">{a.reference_article}</span> <BlocageApproBadge article={a} compact /><div className="truncate text-[11px] text-[#8A8474]">{a.sage_designation}</div></td>
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

function OngletFournisseurs({ rows, loading, error, strategies, onRowChange, articles, onStrategieSaved }: {
  rows: FournRow[]; loading: boolean; error: string | null; strategies: StrategieRef[]
  onRowChange: (r: FournRow) => void; articles: ArtRow[]; onStrategieSaved?: () => void
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
        <FicheFournisseurModal selected={selected} strategies={strategies} articles={articles} onRowChange={onRowChange} onClose={() => setSelected(null)} onStrategieSaved={onStrategieSaved} />
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

// ─────────────────────────────────────────────────────────────────────────
// Stratégies de réappro A / B — paramètres effectifs et proposition (côté client)
// ─────────────────────────────────────────────────────────────────────────

const METHODES: { code: MethodeCalcul; lettre: 'A' | 'B'; label: string; detail: string }[] = [
  { code: 'min_max', lettre: 'A', label: 'Min/Max — point de commande', detail: 'Commande quand le stock à réception passe sous le stock de sécurité ; quantité = remontée au stock max (arrondie au colisage).' },
  { code: 'couverture', lettre: 'B', label: 'Couverture cible à réception', detail: 'Commande quand la couverture à réception (stock à réception / μ) passe sous la couverture min ; quantité = couverture cible × μ − stock à réception (arrondie au colisage).' },
]
const METHODE_PAR_CODE = Object.fromEntries(METHODES.map((m) => [m.code, m])) as Record<MethodeCalcul, typeof METHODES[number]>

/** Conso retenue pour le calcul de besoin. */
type ConsoSource = '12m' | '3m' | 'fut3' | 'fut3_coef'
const CONSO_SOURCES: { code: ConsoSource; court: string; label: string }[] = [
  { code: '12m', court: 'μ 12 mois', label: 'Moyenne 12 derniers mois' },
  { code: '3m', court: 'μ 3 mois', label: 'Moyenne 3 derniers mois' },
  { code: 'fut3', court: 'N−1 3 proch.', label: 'Moyenne 3 prochains mois base N−1' },
  { code: 'fut3_coef', court: 'N−1 × coef', label: 'Moyenne 3 prochains mois base N−1 × coef' },
]
const CONSO_PAR_CODE = Object.fromEntries(CONSO_SOURCES.map((c) => [c.code, c])) as Record<ConsoSource, typeof CONSO_SOURCES[number]>
function estConsoSource(v: unknown): v is ConsoSource { return v === '12m' || v === '3m' || v === 'fut3' || v === 'fut3_coef' }

/** Stratégies d'appro proposées ligne à ligne (même vocabulaire que la fiche fournisseur). */
const STRATEGIES_APPRO = ['Long terme', "Au fil de l'eau", 'A la demande'] as const

/** Profil de conso d'une référence (v_appro_article_conso_profil) : moyennes calculées en direct,
 * écrêtage compris, et surcharges conso / stratégie saisies sur l'article. */
type ProfilConso = {
  reference_article: string
  mu12: number | null; sigma12: number | null; mu3: number | null; mu_fut3: number | null
  fut3_debut: string | null; nb_mois_ecretes: number | null
  conso_source: ConsoSource | null; conso_coef: number | null; strategie_appro: string | null
}

/** Origine d'un paramètre effectif : saisi sur l'article, hérité du fournisseur, paramètre global, ou forcé sur l'écran. */
type Origine = 'article' | 'fournisseur' | 'défaut' | 'forcée'
/** Valeur effective, son origine, et la valeur qui s'appliquerait sans la surcharge article. */
type ParamEff<T> = { v: T; o: Origine; base: T; baseO: Origine }
type ParamsEffectifs = {
  strategie: ParamEff<string | null>
  methode: ParamEff<MethodeCalcul>
  couvMin: ParamEff<number>
  couvCible: ParamEff<number>
  conso: ParamEff<ConsoSource>
  coef: ParamEff<number>
  delaiAppro: ParamEff<number>
  delaiSecu: ParamEff<number>
  z: number
}

type ContexteProposition = {
  paramsFourn: Map<string, ParamsFourn>
  profils: Map<string, ProfilConso>
  methodeForcee: '' | MethodeCalcul          // forçage écran ('' = selon référence / fournisseur / défaut)
  methodeDefaut: MethodeCalcul               // appro_parametres.methode_calcul_defaut
  couvMinDefaut: number; couvCibleDefaut: number
  consoSourceDefaut: ConsoSource             // appro_parametres.projection_mu_source (12 ou 3 mois)
  delaiDefaut: number; secuDefaut: number    // delai_appro_defaut_jours / delai_securite_defaut_jours
  zDefaut: number                            // niveau_service_z
  revueJours: number                         // periode_revue_jours (stock max)
  retardMaxJours: number                     // encours dont la date estimée est dépassée de plus de N j : exclu
  aujourdhui: string                         // AAAA-MM-JJ
  frequenceApproJours: number                // méthode A, réf. MYSTOCK : période entre deux commandes
  seuilInclutDelaiAppro: boolean             // méthode A : ajouter la conso du délai d'appro au stock de sécurité
}

const aValeur = (v: unknown) => v !== null && v !== undefined && v !== ''

/** Paramètres d'appro effectifs d'une référence : article > fournisseur > paramètre global (et forçage écran pour la méthode). */
function parametresEffectifs(a: ArtRow, ctx: ContexteProposition): ParamsEffectifs {
  const f = a.fournisseur_principal ? ctx.paramsFourn.get(a.fournisseur_principal) : undefined
  const pr = ctx.profils.get(a.reference_article)

  const stratF = f?.strategie_principale || null
  const strategie: ParamEff<string | null> = aValeur(pr?.strategie_appro)
    ? { v: pr!.strategie_appro!, o: 'article', base: stratF, baseO: stratF ? 'fournisseur' : 'défaut' }
    : { v: stratF, o: stratF ? 'fournisseur' : 'défaut', base: stratF, baseO: stratF ? 'fournisseur' : 'défaut' }

  const methBase: MethodeCalcul = f?.methode_calcul || ctx.methodeDefaut
  const methBaseO: Origine = f?.methode_calcul ? 'fournisseur' : 'défaut'
  const methode: ParamEff<MethodeCalcul> = ctx.methodeForcee
    ? { v: ctx.methodeForcee, o: 'forcée', base: methBase, baseO: methBaseO }
    : a.ref_methode_calcul
      ? { v: a.ref_methode_calcul, o: 'article', base: methBase, baseO: methBaseO }
      : { v: methBase, o: methBaseO, base: methBase, baseO: methBaseO }

  const num = (v: number | null | undefined) => Number(v)
  const couvMinBase = aValeur(f?.couverture_min_mois) ? num(f!.couverture_min_mois) : ctx.couvMinDefaut
  const couvMinBaseO: Origine = aValeur(f?.couverture_min_mois) ? 'fournisseur' : 'défaut'
  const couvMin: ParamEff<number> = aValeur(a.ref_couverture_min_mois)
    ? { v: num(a.ref_couverture_min_mois), o: 'article', base: couvMinBase, baseO: couvMinBaseO }
    : { v: couvMinBase, o: couvMinBaseO, base: couvMinBase, baseO: couvMinBaseO }
  const couvCibleBase = aValeur(f?.couverture_cible_mois) ? num(f!.couverture_cible_mois) : ctx.couvCibleDefaut
  const couvCibleBaseO: Origine = aValeur(f?.couverture_cible_mois) ? 'fournisseur' : 'défaut'
  const couvCible: ParamEff<number> = aValeur(a.ref_couverture_cible_mois)
    ? { v: num(a.ref_couverture_cible_mois), o: 'article', base: couvCibleBase, baseO: couvCibleBaseO }
    : { v: couvCibleBase, o: couvCibleBaseO, base: couvCibleBase, baseO: couvCibleBaseO }

  const consoBase: ConsoSource = estConsoSource(f?.conso_source) ? f!.conso_source! : ctx.consoSourceDefaut
  const consoBaseO: Origine = estConsoSource(f?.conso_source) ? 'fournisseur' : 'défaut'
  const conso: ParamEff<ConsoSource> = estConsoSource(pr?.conso_source)
    ? { v: pr!.conso_source!, o: 'article', base: consoBase, baseO: consoBaseO }
    : { v: consoBase, o: consoBaseO, base: consoBase, baseO: consoBaseO }
  const coefBase = aValeur(f?.conso_coef) && num(f!.conso_coef) > 0 ? num(f!.conso_coef) : 1
  const coefBaseO: Origine = aValeur(f?.conso_coef) ? 'fournisseur' : 'défaut'
  const coef: ParamEff<number> = aValeur(pr?.conso_coef) && num(pr!.conso_coef) > 0
    ? { v: num(pr!.conso_coef), o: 'article', base: coefBase, baseO: coefBaseO }
    : { v: coefBase, o: coefBaseO, base: coefBase, baseO: coefBaseO }

  // Délais : la valeur stockée (delai_appro_jours) est celle du dernier calcul (référence > paramètre article > fournisseur > défaut).
  const delaiFourn = aValeur(f?.delai_appro_jours) ? num(f!.delai_appro_jours) : null
  const delaiBase = !aValeur(a.delai_appro_ref_jours) && aValeur(a.delai_appro_jours) ? n0(a.delai_appro_jours) : delaiFourn ?? ctx.delaiDefaut
  const delaiBaseO: Origine = delaiFourn !== null ? 'fournisseur' : 'défaut'
  const delaiAppro: ParamEff<number> = aValeur(a.delai_appro_ref_jours)
    ? { v: n0(a.delai_appro_ref_jours), o: 'article', base: delaiBase, baseO: delaiBaseO }
    : { v: delaiBase, o: delaiBaseO, base: delaiBase, baseO: delaiBaseO }
  const secuFourn = aValeur(f?.delai_securite_jours) ? num(f!.delai_securite_jours) : null
  const secuBase = !aValeur(a.delai_securite_ref_jours) && aValeur(a.delai_securite_jours) ? n0(a.delai_securite_jours) : secuFourn ?? ctx.secuDefaut
  const secuBaseO: Origine = secuFourn !== null ? 'fournisseur' : 'défaut'
  const delaiSecu: ParamEff<number> = aValeur(a.delai_securite_ref_jours)
    ? { v: n0(a.delai_securite_ref_jours), o: 'article', base: secuBase, baseO: secuBaseO }
    : { v: secuBase, o: secuBaseO, base: secuBase, baseO: secuBaseO }

  const z = aValeur(f?.niveau_service_z) && num(f!.niveau_service_z) > 0 ? num(f!.niveau_service_z) : ctx.zDefaut
  return { strategie, methode, couvMin, couvCible, conso, coef, delaiAppro, delaiSecu, z }
}

/** Conso mensuelle retenue selon la source choisie. Sans profil (migration absente), repli sur les valeurs de la vue articles. */
function muSelon(a: ArtRow, pr: ProfilConso | undefined, source: ConsoSource, coef: number): number {
  const mu12 = pr ? n0(pr.mu12) : n0(a.conso_moy_mensuelle)
  const mu3 = pr ? n0(pr.mu3) : n0(a.conso_moy_3_mois)
  const fut3 = pr ? n0(pr.mu_fut3) : 0
  if (source === '12m') return mu12
  if (source === '3m') return mu3
  if (source === 'fut3') return fut3
  return Math.round(fut3 * coef * 100) / 100
}

type Proposition = {
  methode: MethodeCalcul; lettre: 'A' | 'B'; source: Origine
  couvMin: number; couvCible: number; couvSource: Origine
  perimetreGlobal: boolean; delaiL: number; dateReception: string; mu: number; muSource: ConsoSource
  mu12: number; mu3: number; muFut3: number; sigma: number
  stockBase: number; reservePeriode: number; reserveApres: number; reserveTotal: number
  encoursPeriode: number; encoursApres: number; encoursDouteux: number
  consoDelai: number; demande: number; demandeMode: number
  stockReception: number; couvReception: number | null
  ss: number; minEff: number; maxEff: number; recalcule: boolean
  seuilA: number; stockMaxA: number
  ssBase: number; ajoutFrequence: number; ajoutDelai: number; frequenceJours: number; delaiApproJours: number; cibleA: number
  declenche: boolean; bloque: boolean; strategieExclue: boolean; qteProposee: number; colisage: number
  qteRetenue: number | null; qteFinale: number; dateSouhaitee: string
  eff: ParamsEffectifs
  explication: string[]
}

/** Date ISO locale (AAAA-MM-JJ) sans passer par l'UTC (évite le décalage d'un jour le soir). */
function isoLocal(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function ajouterJours(iso: string, jours: number): string {
  const [y, m, j] = iso.split('-').map(Number)
  const d = new Date(y, m - 1, j); d.setDate(d.getDate() + jours)
  return isoLocal(d)
}
function arrondirColisage(qte: number, colisage: number): number {
  const c = colisage > 1 ? colisage : 1
  return Math.max(0, Math.ceil(qte / c) * c)
}

/** Calcule la proposition de réappro d'une référence selon la méthode A ou B, avec ses paramètres effectifs.
 *  Stock à réception = stock disponible SAGE (physique − préparations, périmètre) − demande sur le délai L + encours fournisseur SAGE livré ≤ L.
 *  L = délai d'appro + délai de sécurité effectifs ; μ = conso retenue (12 mois, 3 mois, 3 prochains mois N−1, × coef).
 *  Stock de sécurité / min / max : valeurs du dernier calcul en base tant que rien ne les change ; recalculés ici
 *  (mêmes formules que refresh_appro_calcul_besoin) dès qu'un délai, la conso retenue ou un écrêtage les modifie. */
function calculerProposition(a: ArtRow, ctx: ContexteProposition): Proposition {
  const eff = parametresEffectifs(a, ctx)
  const pr = ctx.profils.get(a.reference_article)
  const methode = eff.methode.v
  const source = eff.methode.o
  const couvMin = eff.couvMin.v
  const couvCible = eff.couvCible.v
  const couvSource: Origine = eff.couvMin.o === 'article' || eff.couvCible.o === 'article' ? 'article' : eff.couvMin.o === 'fournisseur' || eff.couvCible.o === 'fournisseur' ? 'fournisseur' : 'défaut'

  const global = a.projection_perimetre !== 'fms'
  const delaiAppro = eff.delaiAppro.v
  const delaiSecu = eff.delaiSecu.v
  const delaiL = delaiAppro + delaiSecu > 0 ? delaiAppro + delaiSecu : n0(a.projection_delai_l) > 0 ? n0(a.projection_delai_l) : 37
  const dateReception = ajouterJours(ctx.aujourdhui, delaiL)
  const mu12 = pr ? n0(pr.mu12) : n0(a.conso_moy_mensuelle)
  const mu3 = pr ? n0(pr.mu3) : n0(a.conso_moy_3_mois)
  const muFut3 = pr ? n0(pr.mu_fut3) : 0
  const sigma = pr ? n0(pr.sigma12) : n0(a.conso_ecart_type)
  const muSource = eff.conso.v
  const mu = muSelon(a, pr, muSource, eff.coef.v)
  // Stock de départ = disponible SAGE (physique − préparations de livraison).
  const stockBase = global ? n0(a.sage_stock_dispo_total) : n0(a.stock_dispo_sage_fms)
  const dansPerimetre = (e: Echeance) => global || e.fms

  let reservePeriode = 0, reserveApres = 0, reserveTotal = 0
  ;(a.reserve_echeances || []).filter(dansPerimetre).forEach((e) => { reserveTotal += n0(e.q); if (e.d <= dateReception) reservePeriode += n0(e.q); else reserveApres += n0(e.q) })
  const dateDouteux = ajouterJours(ctx.aujourdhui, -ctx.retardMaxJours)
  let encoursPeriode = 0, encoursApres = 0, encoursDouteux = 0
  ;(a.encours_echeances || []).filter(dansPerimetre).forEach((e) => { if (e.d < dateDouteux) encoursDouteux += n0(e.q); else if (e.d <= dateReception) encoursPeriode += n0(e.q); else encoursApres += n0(e.q) })

  const consoDelai = Math.round(mu * delaiL / 30 * 10) / 10
  const demandeMode = a.projection_demande_mode ?? 3
  const demande = demandeMode === 1 ? reservePeriode : demandeMode === 2 ? consoDelai : Math.max(reservePeriode, consoDelai)
  const stockReception = Math.round((stockBase - demande + encoursPeriode) * 10) / 10
  const couvReception = mu > 0 ? Math.round(stockReception / mu * 10) / 10 : null

  const colisage = n0(a.sage_colisage)
  // Stock de sécurité / min / max : base (dernier calcul) ou recalcul client si un paramètre les change.
  const consoExplicite = eff.conso.o === 'article' || eff.conso.o === 'fournisseur'
  const statsModifiees = !!pr && (Math.abs(n0(pr.mu12) - n0(a.conso_moy_mensuelle)) > 0.005 || Math.abs(n0(pr.sigma12) - n0(a.conso_ecart_type)) > 0.005)
  const delaisModifies = delaiAppro !== n0(a.delai_appro_jours) || delaiSecu !== n0(a.delai_securite_jours)
  const recalcule = consoExplicite || statsModifiees || delaisModifies
  let ss: number, minEff: number, maxEff: number
  if (!recalcule) {
    ss = n0(a.calc_stock_securite); minEff = n0(a.calc_stock_min); maxEff = n0(a.calc_stock_max)
  } else {
    const muMin = consoExplicite ? mu : mu12
    const ssBrut = eff.z * sigma * Math.sqrt(delaiL / 30)
    ss = Math.round(ssBrut * 100) / 100
    const sminBrut = Math.ceil(muMin * delaiL / 30 + ssBrut - 1e-9)
    const minCalc = mu12 * 12 <= 0 && !consoExplicite ? 0 : muMin <= 0 ? 0 : colisage > 1 ? Math.ceil(sminBrut / colisage) * colisage : sminBrut
    maxEff = minCalc <= 0 ? 0 : Math.ceil(minCalc + muMin * ctx.revueJours / 30 - 1e-9)
    minEff = aValeur(a.stock_min_retenu) ? n0(a.stock_min_retenu) : minCalc
  }

  // Méthode A — seuil = SS + conso de la période d'appro (réf. MYSTOCK) [+ conso du délai d'appro] ; cible = max(stock max, seuil).
  const estMystock = safeText(a.mystock).toUpperCase() === 'OUI'
  const frequenceJours = estMystock ? Math.max(0, ctx.frequenceApproJours) : 0
  const ssBase = ss
  const ajoutFrequence = Math.round(mu * frequenceJours / 30 * 10) / 10
  const ajoutDelai = ctx.seuilInclutDelaiAppro ? Math.round(mu * delaiAppro / 30 * 10) / 10 : 0
  const seuilA = Math.round((ssBase + ajoutFrequence + ajoutDelai) * 10) / 10
  const stockMaxA = maxEff > 0 ? maxEff : minEff
  const cibleA = Math.max(stockMaxA, seuilA)
  const bloque = !!a.blocage_appro || !!a.arret_appro
  const strategieExclue = eff.strategie.o === 'article' && eff.strategie.v === 'A la demande'
  const eligible = !!a.pertinent_calcul_besoin && !bloque && !strategieExclue
  let declenche = false, qteProposee = 0
  if (methode === 'min_max') {
    declenche = eligible && minEff > 0 && stockReception < seuilA
    if (declenche) qteProposee = arrondirColisage(cibleA - stockReception, colisage)
  } else {
    declenche = eligible && mu > 0 && couvReception !== null && couvReception < couvMin
    if (declenche) qteProposee = arrondirColisage(couvCible * mu - stockReception, colisage)
  }
  const qteRetenue = a.qte_proposition_manuelle === null || a.qte_proposition_manuelle === undefined ? null : Number(a.qte_proposition_manuelle)
  const qteFinale = qteRetenue ?? qteProposee
  const dateSouhaitee = a.date_livraison_souhaitee ? String(a.date_livraison_souhaitee).slice(0, 10) : ajouterJours(ctx.aujourdhui, delaiAppro)
  const detailSeuil = [
    `SS ${fmtNum(ssBase, 1)}`,
    frequenceJours > 0 ? `+ période d'appro ${frequenceJours} j (μ × ${frequenceJours}/30 = ${fmtNum(ajoutFrequence, 1)})` : null,
    ctx.seuilInclutDelaiAppro ? `+ délai d'appro ${fmtNum(delaiAppro)} j (μ × ${fmtNum(delaiAppro)}/30 = ${fmtNum(ajoutDelai, 1)})` : null,
  ].filter(Boolean).join(' ')
  const libMu = `${CONSO_PAR_CODE[muSource].label}${muSource === 'fut3_coef' ? ` (× ${fmtNum(eff.coef.v * 100)} %)` : ''}`

  const modeLib = demandeMode === 1 ? `réservé ≤ ${fmtDate(dateReception)} : ${fmtNum(reservePeriode)}` : demandeMode === 2 ? `μ ${fmtNum(mu, 1)} × ${delaiL}/30 = ${fmtNum(consoDelai, 1)}` : `max(réservé ≤ ${fmtDate(dateReception)} : ${fmtNum(reservePeriode)} ; μ ${fmtNum(mu, 1)} × ${delaiL}/30 = ${fmtNum(consoDelai, 1)})`
  const explication = [
    `Méthode ${METHODE_PAR_CODE[methode].lettre} · ${METHODE_PAR_CODE[methode].label} (${source})`,
    `Délai L = ${fmtNum(delaiAppro)} j appro (${eff.delaiAppro.o}) + ${fmtNum(delaiSecu)} j sécurité (${eff.delaiSecu.o}) = ${delaiL} j → réception le ${fmtDate(dateReception)} · périmètre ${global ? 'global (tous dépôts)' : 'dépôt FMS'}`,
    `μ retenu = ${fmtNum(mu, 1)}/mois · ${libMu} (${eff.conso.o}) — μ 12 m ${fmtNum(mu12, 1)} · μ 3 m ${fmtNum(mu3, 1)} · 3 prochains mois N−1 ${fmtNum(muFut3, 1)}${pr && n0(pr.nb_mois_ecretes) > 0 ? ` · ${pr.nb_mois_ecretes} mois écrêté(s)` : ''}`,
    `Stock disponible SAGE ${fmtNum(stockBase)} (physique − préparations de livraison) − demande ${fmtNum(demande, 1)} [${modeLib}] + encours livré ≤ L ${fmtNum(encoursPeriode)} = stock à réception ${fmtNum(stockReception, 1)}`,
    `Couverture à réception = ${fmtNum(stockReception, 1)} / ${fmtNum(mu, 1)} = ${couvReception === null ? '— (μ = 0)' : fmtNum(couvReception, 1) + ' mois'}`,
    recalcule
      ? `SS / min / max recalculés (${[consoExplicite ? 'conso retenue' : null, delaisModifies ? 'délais' : null, statsModifiees ? 'écrêtage / mois glissant' : null].filter(Boolean).join(', ')}) : SS = z ${fmtNum(eff.z, 2)} × σ ${fmtNum(sigma, 1)} × √(${delaiL}/30) = ${fmtNum(ss, 1)} · min ${fmtNum(minEff)}${aValeur(a.stock_min_retenu) ? ' (retenu)' : ''} · max ${fmtNum(maxEff)}`
      : `SS ${fmtNum(ss, 1)} · min ${fmtNum(minEff)} · max ${fmtNum(maxEff)} (dernier calcul des stocks min)`,
    methode === 'min_max'
      ? `Déclencheur A : stock à réception ${fmtNum(stockReception, 1)} ${stockReception < seuilA ? '<' : '≥'} seuil ${fmtNum(seuilA, 1)} [${detailSeuil}] → ${declenche ? `commander jusqu'à ${cibleA > stockMaxA ? 'le seuil ' + fmtNum(cibleA, 1) + ' (stock max ' + fmtNum(stockMaxA) + ' inférieur)' : 'au stock max ' + fmtNum(stockMaxA)}` : 'pas de commande'}`
      : `Déclencheur B : couverture ${couvReception === null ? '—' : fmtNum(couvReception, 1)} ${couvReception !== null && couvReception < couvMin ? '<' : '≥'} min ${fmtNum(couvMin, 1)} mois (${couvSource}) → ${declenche ? 'recompléter à cible ' + fmtNum(couvCible, 1) + ' mois = ' + fmtNum(couvCible * mu, 1) : 'pas de commande'}`,
    bloque ? (a.blocage_appro ? '⛔ Blocage appro SAGE : aucune proposition' : 'Arrêt appro (saisie) : aucune proposition') : strategieExclue ? 'Stratégie « A la demande » sur l\'article : aucune proposition' : !a.pertinent_calcul_besoin ? 'Hors MYSTOCK actif : aucune proposition' : null,
    `Proposition : ${fmtNum(qteProposee)}${colisage > 1 ? ` (colisage ${fmtNum(colisage)})` : ''}${qteRetenue !== null ? ` · retenue : ${fmtNum(qteRetenue)}` : ''}`,
    reserveApres > 0 ? `Réservé après le ${fmtDate(dateReception)} : ${fmtNum(reserveApres)} (non déduit)` : null,
    encoursApres > 0 ? `Encours livré après le ${fmtDate(dateReception)} : ${fmtNum(encoursApres)} (non compté)` : null,
    encoursDouteux > 0 ? `Encours douteux (date dépassée de plus de ${ctx.retardMaxJours} j) : ${fmtNum(encoursDouteux)} (exclu)` : null,
  ].filter(Boolean) as string[]

  return { methode, lettre: METHODE_PAR_CODE[methode].lettre, source, couvMin, couvCible, couvSource, perimetreGlobal: global, delaiL, dateReception, mu, muSource,
    mu12, mu3, muFut3, sigma,
    stockBase, reservePeriode, reserveApres, reserveTotal, encoursPeriode, encoursApres, encoursDouteux, consoDelai, demande, demandeMode,
    stockReception, couvReception, ss, minEff, maxEff, recalcule, seuilA, stockMaxA, ssBase, ajoutFrequence, ajoutDelai, frequenceJours, delaiApproJours: delaiAppro, cibleA,
    declenche, bloque, strategieExclue, qteProposee, colisage, qteRetenue, qteFinale, dateSouhaitee, eff, explication }
}

// ── Tarifs d'achat par quantité (sage.tarif_f_qte via v_appro_tarif_qte_fournisseur) ─────────
type PalierTarif = {
  reference_article: string; fournisseur: string; fournisseur_principal_sage: boolean | null
  prix_base: number | null; palier: number; borne_precedente: number; borne_sup: number
  prix_net: number; origine_prix: string | null; remise_vs_base_pct: number | null
}
/** 0 = lecture SAGE (TQ_BorneSup = borne supérieure de la tranche) ; 1 = la borne est un seuil (prix au-delà de la borne) */
type LectureBornes = 0 | 1
type OptionPalier = {
  qteTotale: number; qteAdd: number; prix: number; tranche: string; montant: number
  economie: number; economiePct: number; surcoutNet: number
  couvAddMois: number | null; couvTotaleMois: number | null
}
type AnalyseTarif = {
  fournisseur: string; paliers: PalierTarif[]; lecture: LectureBornes; prixBase: number | null
  qteBase: number; prixActuel: number | null; trancheActuelle: string; montantActuel: number
  suivant: OptionPalier | null; autres: OptionPalier[]
}
const BORNE_INFINIE = 1e12
function libBorne(v: number) { return v >= BORNE_INFINIE ? '∞' : fmtNum(v) }

/** Prix unitaire applicable à une quantité selon les paliers et la lecture des bornes. */
function prixPourQuantite(paliers: PalierTarif[], q: number, lecture: LectureBornes, prixBase: number | null): { prix: number | null; tranche: string } {
  if (!paliers.length) return { prix: prixBase, tranche: 'prix de base' }
  if (lecture === 0) {
    const p = paliers.find((x) => q <= x.borne_sup)
    if (p) return { prix: Number(p.prix_net), tranche: `${fmtNum(n0(p.borne_precedente) + 1)} – ${libBorne(n0(p.borne_sup))}` }
    const der = paliers[paliers.length - 1]
    return { prix: Number(der.prix_net), tranche: `> ${libBorne(n0(der.borne_sup))} (dernière tranche)` }
  }
  const atteints = paliers.filter((x) => q > x.borne_sup)
  if (!atteints.length) return { prix: prixBase, tranche: `≤ ${libBorne(n0(paliers[0].borne_sup))} (prix de base)` }
  const p = atteints[atteints.length - 1]
  const suiv = paliers[atteints.length]
  return { prix: Number(p.prix_net), tranche: `> ${libBorne(n0(p.borne_sup))}${suiv ? ` et ≤ ${libBorne(n0(suiv.borne_sup))}` : ''}` }
}

/** Quantité additionnelle pour atteindre chaque tarif inférieur au prix de la quantité commandée.
 *  Quantité de base = quantité retenue, sinon proposée ; arrondi au colisage ; économie = qté totale × (prix actuel − prix du palier). */
function analyserTarif(a: ArtRow, prop: Proposition, paliers: PalierTarif[] | undefined, lecture: LectureBornes): AnalyseTarif | null {
  if (!paliers || !paliers.length) return null
  const prixBase = paliers[0].prix_base === null || paliers[0].prix_base === undefined ? null : Number(paliers[0].prix_base)
  const qteBase = Math.max(0, n0(prop.qteFinale))
  const colisage = n0(a.sage_colisage)
  const mu = prop.mu
  const qRef = qteBase > 0 ? qteBase : 1
  const actuel = prixPourQuantite(paliers, qRef, lecture, prixBase)
  const prixActuel = actuel.prix
  const montantActuel = prixActuel === null ? 0 : Math.round(qteBase * prixActuel * 100) / 100
  const candidats: OptionPalier[] = []
  if (prixActuel !== null) {
    paliers.forEach((pl) => {
      const qMinBrute = lecture === 0 ? n0(pl.borne_precedente) + 1 : n0(pl.borne_sup) + 1
      if (qMinBrute >= BORNE_INFINIE) return
      const qMin = arrondirColisage(qMinBrute, colisage)
      if (qMin <= qteBase) return
      const px = prixPourQuantite(paliers, qMin, lecture, prixBase)
      if (px.prix === null || px.prix >= prixActuel - 0.0001) return
      const montant = Math.round(qMin * px.prix * 100) / 100
      const economie = Math.round(qMin * (prixActuel - px.prix) * 100) / 100
      candidats.push({
        qteTotale: qMin, qteAdd: qMin - qteBase, prix: px.prix, tranche: px.tranche, montant,
        economie, economiePct: Math.round((1 - px.prix / prixActuel) * 1000) / 10,
        surcoutNet: Math.round((montant - montantActuel) * 100) / 100,
        couvAddMois: mu > 0 ? Math.round((qMin - qteBase) / mu * 10) / 10 : null,
        couvTotaleMois: mu > 0 ? Math.round((prop.stockReception + qMin) / mu * 10) / 10 : null,
      })
    })
  }
  // quantités croissantes, prix strictement décroissants (on écarte les paliers dominés)
  candidats.sort((x, y) => x.qteTotale - y.qteTotale || x.prix - y.prix)
  const options: OptionPalier[] = []
  candidats.forEach((c) => { const der = options[options.length - 1]; if (!der || c.prix < der.prix - 0.0001) options.push(c) })
  return { fournisseur: paliers[0].fournisseur, paliers, lecture, prixBase, qteBase, prixActuel, trancheActuelle: actuel.tranche, montantActuel, suivant: options[0] ?? null, autres: options.slice(1) }
}

function libOption(o: OptionPalier): string {
  return `+${fmtNum(o.qteAdd)} (total ${fmtNum(o.qteTotale)}) → ${fmtEuro2(o.prix)} [tranche ${o.tranche}]${o.couvAddMois !== null ? ` · +${fmtNum(o.couvAddMois, 1)} mois de couverture (${fmtNum(o.couvTotaleMois, 1)} mois à réception)` : ''} · économie ${fmtEuro2(o.economie)} (−${fmtNum(o.economiePct, 1)} %) · montant ${fmtEuro2(o.montant)} (${o.surcoutNet >= 0 ? '+' : ''}${fmtEuro2(o.surcoutNet)} de trésorerie)`
}
function titreTarif(t: AnalyseTarif): string {
  return [
    `Tarif par quantité — fournisseur ${t.fournisseur} (${t.lecture === 0 ? 'lecture SAGE : borne supérieure de tranche' : 'lecture seuil : prix au-delà de la borne'})`,
    ...t.paliers.map((p) => `  • ${t.lecture === 0 ? `${fmtNum(n0(p.borne_precedente) + 1)} – ${libBorne(n0(p.borne_sup))}` : `> ${libBorne(n0(p.borne_sup))}`} : ${fmtEuro2(Number(p.prix_net))}${p.origine_prix === 'remise' ? ' (remise sur prix de base)' : ''}`),
    t.prixBase !== null ? `Prix de base fournisseur (fiche article) : ${fmtEuro2(t.prixBase)}` : null,
    t.qteBase > 0 ? `Quantité commandée ${fmtNum(t.qteBase)} → ${fmtEuro2(t.prixActuel)} / u (tranche ${t.trancheActuelle}) = ${fmtEuro2(t.montantActuel)}` : 'Aucune quantité à commander : prix affiché pour 1 unité',
  ].filter(Boolean).join('\n')
}

/** Cellules « Qté retenue » et « Date liv. souhaitée » : saisie ligne à ligne,
 * enregistrée à la validation (Entrée / perte de focus) via RPC. */
function CelluleProposition({ article, prop, onSaved, avecQte = true, avecDate = true }: { article: ArtRow; prop: Proposition; onSaved: (a: ArtRow) => void; avecQte?: boolean; avecDate?: boolean }) {
  const [qte, setQte] = useState(prop.qteRetenue === null ? '' : String(prop.qteRetenue))
  const [date, setDate] = useState(prop.dateSouhaitee)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setQte(prop.qteRetenue === null ? '' : String(prop.qteRetenue)); setDate(prop.dateSouhaitee) }, [prop.qteRetenue, prop.dateSouhaitee])

  async function enregistrer(q: string, d: string) {
    const qNum = q.trim() === '' ? null : Number(q.replace(',', '.'))
    if (qNum !== null && Number.isNaN(qNum)) return
    // date : on n'enregistre que si elle diffère de la valeur stockée (ou du défaut quand rien n'est stocké)
    const dateStockee = article.date_livraison_souhaitee ? String(article.date_livraison_souhaitee).slice(0, 10) : null
    const dVal = d && d !== (dateStockee ?? prop.dateSouhaitee) ? d : dateStockee
    const qteStockee = article.qte_proposition_manuelle === null || article.qte_proposition_manuelle === undefined ? null : Number(article.qte_proposition_manuelle)
    if (qNum === qteStockee && dVal === dateStockee) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('appro_enregistrer_proposition', { p_reference: article.reference_article, p_qte: qNum, p_date: dVal })
      if (error) throw error
      onSaved({ ...article, qte_proposition_manuelle: qNum, date_livraison_souhaitee: dVal, proposition_maj_le: new Date().toISOString() })
    } catch (e) { alert('Erreur enregistrement proposition : ' + messageErreur(e)) } finally { setSaving(false) }
  }
  const modifiee = prop.qteRetenue !== null && prop.qteRetenue !== prop.qteProposee
  return (
    <>
      {avecQte && <td className="px-1 py-1 text-right">
        <input value={qte} onChange={(e) => setQte(e.target.value)} onBlur={() => void enregistrer(qte, date)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder={prop.qteProposee ? fmtNum(prop.qteProposee) : '0'} disabled={saving}
          title={prop.qteRetenue !== null ? `Quantité retenue (saisie${article.proposition_maj_le ? ' le ' + fmtDate(article.proposition_maj_le) : ''}) — vider pour revenir à la proposition` : 'Saisis une quantité pour remplacer la proposition (vide = proposition)'}
          className={`h-7 w-[64px] rounded border px-1 text-right text-[12px] font-semibold outline-none focus:border-[#B4761A] ${modifiee ? 'border-[#B4761A] bg-[#B4761A]/[0.08] text-[#96600F]' : prop.qteRetenue !== null ? 'border-[#E5E1D8] bg-white text-[#111820]' : 'border-[#E5E1D8] bg-white text-[#8A8474]'}`} />
      </td>}
      {avecDate && <td className="px-1 py-1 text-right">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => void enregistrer(qte, date)} disabled={saving}
          title={article.date_livraison_souhaitee ? 'Date de livraison souhaitée (saisie)' : 'Date par défaut = aujourd\'hui + délai d\'appro (modifiable)'}
          className={`h-7 rounded border px-1 text-[11px] outline-none focus:border-[#B4761A] ${article.date_livraison_souhaitee ? 'border-[#B4761A]/50 bg-white text-[#111820]' : 'border-[#E5E1D8] bg-white text-[#8A8474]'}`} />
      </td>}
    </>
  )
}

type ArticleManuel = {
  stock_min_retenu: string; commentaire: string
  arret_appro: boolean; arret_vente: boolean; ref_remplacante: string; date_effet: string
  delai_appro_ref_jours: string; delai_securite_ref_jours: string
  methode_calcul: '' | MethodeCalcul; couverture_min_mois: string; couverture_cible_mois: string
  qte_proposition_manuelle: string; date_livraison_souhaitee: string
}
function manuelDepuis(a: ArtRow): ArticleManuel {
  return {
    stock_min_retenu: a.stock_min_retenu === null || a.stock_min_retenu === undefined ? '' : String(a.stock_min_retenu),
    commentaire: a.commentaire_stock_min || '',
    arret_appro: !!a.arret_appro, arret_vente: !!a.arret_vente,
    ref_remplacante: a.ref_remplacante || '', date_effet: a.date_effet ? String(a.date_effet).slice(0, 10) : '',
    delai_appro_ref_jours: a.delai_appro_ref_jours === null || a.delai_appro_ref_jours === undefined ? '' : String(a.delai_appro_ref_jours),
    delai_securite_ref_jours: a.delai_securite_ref_jours === null || a.delai_securite_ref_jours === undefined ? '' : String(a.delai_securite_ref_jours),
    methode_calcul: a.ref_methode_calcul ?? '',
    couverture_min_mois: a.ref_couverture_min_mois === null || a.ref_couverture_min_mois === undefined ? '' : String(a.ref_couverture_min_mois),
    couverture_cible_mois: a.ref_couverture_cible_mois === null || a.ref_couverture_cible_mois === undefined ? '' : String(a.ref_couverture_cible_mois),
    qte_proposition_manuelle: a.qte_proposition_manuelle === null || a.qte_proposition_manuelle === undefined ? '' : String(a.qte_proposition_manuelle),
    date_livraison_souhaitee: a.date_livraison_souhaitee ? String(a.date_livraison_souhaitee).slice(0, 10) : '',
  }
}

function ArticleManuelModal({ article, fournisseur, prop, ctxProp, onClose, onSaved }: { article: ArtRow; fournisseur: FournRow | undefined; prop: Proposition; ctxProp: ContexteProposition; onClose: () => void; onSaved: (a: ArtRow) => void }) {
  const [m, setM] = useState<ArticleManuel>(manuelDepuis(article))
  // aperçu de la proposition avec les paramètres en cours de saisie (méthode / couvertures / délais)
  const apercu = useMemo(() => {
    const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
    const simul: ArtRow = { ...article,
      ref_methode_calcul: m.methode_calcul || null,
      ref_couverture_min_mois: num(m.couverture_min_mois), ref_couverture_cible_mois: num(m.couverture_cible_mois),
      qte_proposition_manuelle: num(m.qte_proposition_manuelle), date_livraison_souhaitee: m.date_livraison_souhaitee || null,
    }
    simul.delai_appro_ref_jours = num(m.delai_appro_ref_jours)
    simul.delai_securite_ref_jours = num(m.delai_securite_ref_jours)
    return calculerProposition(simul, ctxProp)
  }, [m, article, ctxProp])
  const fournParams = article.fournisseur_principal ? ctxProp.paramsFourn.get(article.fournisseur_principal) : undefined
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
        methode_calcul: m.methode_calcul || null,
        couverture_min_mois: num(m.couverture_min_mois), couverture_cible_mois: num(m.couverture_cible_mois),
        qte_proposition_manuelle: num(m.qte_proposition_manuelle), date_livraison_souhaitee: m.date_livraison_souhaitee || null,
        proposition_maj_le: new Date().toISOString(),
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
            <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] font-bold text-[#8A8474]"><span>{article.reference_article}{fournisseur ? ` · ${fournisseur.numero} ${fournisseur.sage_intitule || ''}` : ''}</span><BlocageApproBadge article={article} /></div>
            <div className="text-[15px] font-bold text-[#111820]">{article.sage_designation || '—'}</div>
            {article.blocage_appro && <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[12px] font-semibold text-red-700">Commande interdite dans SAGE (AR_InterdireCommande) : cette référence ne doit pas être réapprovisionnée.</div>}
            <div className="mt-1 text-[12px] text-[#8A8474]">Délais fournisseur : appro {fmtNum(article.delai_appro_jours)} j · sécurité {fmtNum(article.delai_securite_jours)} j. Les valeurs saisies ici priment (jours calendaires) et sont conservées au recalcul. Proposition actuelle : <b>{fmtNum(prop.qteProposee)}</b> (méthode {prop.lettre}, {prop.source}).</div>
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
        <div className="mt-3 rounded-lg border border-[#B4761A]/25 bg-[#B4761A]/[0.04] p-3">
          <div className="mb-2 text-[12px] font-bold text-[#111820]">Stratégie de réappro de la référence <span className="font-normal text-[#8A8474]">— vide = fournisseur{fournParams?.methode_calcul ? ` (${METHODE_PAR_CODE[fournParams.methode_calcul].lettre} · ${METHODE_PAR_CODE[fournParams.methode_calcul].label})` : ' (non renseignée → défaut)'}{ctxProp.methodeForcee ? ` · forçage écran actif : ${METHODE_PAR_CODE[ctxProp.methodeForcee].lettre}` : ''}</span></div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Méthode</span>
              <select value={m.methode_calcul} onChange={(e) => setM({ ...m, methode_calcul: e.target.value as '' | MethodeCalcul })} className={inp}>
                <option value="">— selon fournisseur —</option>
                {METHODES.map((x) => <option key={x.code} value={x.code}>{x.lettre} · {x.label}</option>)}
              </select></label>
            <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">B · couverture min (mois)</span><input value={m.couverture_min_mois} onChange={(e) => setM({ ...m, couverture_min_mois: e.target.value })} placeholder={`fournisseur / défaut : ${fmtNum(fournParams?.couverture_min_mois ?? ctxProp.couvMinDefaut, 1)}`} className={inp} /></label>
            <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">B · couverture cible (mois)</span><input value={m.couverture_cible_mois} onChange={(e) => setM({ ...m, couverture_cible_mois: e.target.value })} placeholder={`fournisseur / défaut : ${fmtNum(fournParams?.couverture_cible_mois ?? ctxProp.couvCibleDefaut, 1)}`} className={inp} /></label>
            <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Quantité retenue (vide = proposition)</span><input value={m.qte_proposition_manuelle} onChange={(e) => setM({ ...m, qte_proposition_manuelle: e.target.value })} placeholder={`proposition : ${fmtNum(apercu.qteProposee)}`} className={inp} /></label>
            <label className="flex flex-col gap-0.5 text-[12px]"><span className="font-semibold text-[#3A362E]">Date de livraison souhaitée</span><input type="date" value={m.date_livraison_souhaitee} onChange={(e) => setM({ ...m, date_livraison_souhaitee: e.target.value })} className={inp} /><span className="text-[10px] text-[#8A8474]">vide = aujourd'hui + délai d'appro ({fmtDate(apercu.dateSouhaitee)})</span></label>
          </div>
          <div className="mt-3 rounded-lg bg-white p-2 font-mono text-[11px] leading-relaxed text-[#3A362E]">
            <div className="mb-1 font-sans text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Calcul de la proposition (avec les valeurs saisies ci-dessus)</div>
            {apercu.explication.map((l, i) => <div key={i} className={i === 0 ? 'font-bold text-[#111820]' : ''}>{l}</div>)}
            <div className="mt-1 font-sans text-[12px] font-bold text-[#111820]">→ Proposition {fmtNum(apercu.qteProposee)}{apercu.qteRetenue !== null ? ` · retenue ${fmtNum(apercu.qteRetenue)}` : ''} · livraison souhaitée {fmtDate(apercu.dateSouhaitee)}</div>
          </div>
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
// Petits composants de l'écran Calcul de besoin
// ─────────────────────────────────────────────────────────────────────────

/** Pastille « i » : explication au survol (ou au clic sur écran tactile), affichée en position fixe
 * pour ne jamais être coupée par un conteneur défilant. */
function Info({ children, largeur = 340 }: { children: React.ReactNode; largeur?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; haut: boolean } | null>(null)
  function ouvrir() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const x = Math.min(Math.max(8, r.left + r.width / 2 - largeur / 2), window.innerWidth - largeur - 8)
    const haut = r.bottom + 220 > window.innerHeight
    setPos({ x, y: haut ? r.top - 6 : r.bottom + 6, haut })
  }
  return (
    <span ref={ref} onMouseEnter={ouvrir} onMouseLeave={() => setPos(null)}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (pos) setPos(null); else ouvrir() }}
      className="inline-flex h-[15px] w-[15px] shrink-0 cursor-help select-none items-center justify-center rounded-full border border-[#C9C4B8] bg-white font-serif text-[9.5px] font-bold italic leading-none text-[#8A8474] hover:border-[#B4761A] hover:text-[#B4761A]">
      i
      {pos && (
        <span style={{ position: 'fixed', left: pos.x, top: pos.y, width: largeur, transform: pos.haut ? 'translateY(-100%)' : undefined }}
          className="pointer-events-none z-[200] whitespace-normal rounded-lg bg-[#111820] px-3 py-2 text-left font-sans text-[11.5px] font-normal not-italic normal-case leading-relaxed tracking-normal text-white shadow-xl">
          {children}
        </span>
      )}
    </span>
  )
}

/** Indicateur compact (hauteur divisée par trois par rapport aux cartes KPI). */
function KpiMini({ label, value, loading, tone, sub, title, onClick, actif }: {
  label: string; value: number | string; loading: boolean; tone?: 'ok' | 'warn' | 'alerte'; sub?: string; title?: string; onClick?: () => void; actif?: boolean
}) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : tone === 'alerte' ? '#B42318' : '#111820'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title}
      className={`min-w-0 rounded-lg border px-2.5 py-1 text-left ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.08]' : 'border-[#E5E1D8] bg-white'} ${onClick ? 'hover:border-[#B4761A]' : ''}`}>
      <div className="truncate text-[9.5px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      {loading ? <div className="my-0.5 h-4 w-10 animate-pulse rounded bg-[#F4F3F0]" /> : (
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[15px] font-bold leading-5 tracking-tight" style={{ color }}>{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</span>
          {sub && <span className="truncate text-[10px] text-[#8A8474]">{sub}</span>}
        </div>
      )}
    </Tag>
  )
}

const STYLE_SURCHARGE = 'border-[#D9A441] bg-[#FFF4DC] font-bold text-[#8A5A08]'
const STYLE_NORMAL = 'border-transparent bg-transparent text-[#3A362E] hover:border-[#E5E1D8] hover:bg-white'

/** Libellé court de l'origine d'une valeur héritée. */
function libOrigine(o: Origine) { return o === 'fournisseur' ? 'fournisseur' : o === 'forcée' ? 'forcé écran' : o === 'article' ? 'article' : 'paramètre global' }

/** Cellule numérique éditable d'un paramètre d'appro : affiche la valeur effective ; une surcharge
 * article apparaît en couleur. Vider (ou ressaisir la valeur héritée) revient au fournisseur. */
function SaisieNombre({ valeur, surcharge, base, baseO, onCommit, largeur = 'w-11', decimales = 0, suffixe, disabled, titre, attenue }: {
  valeur: number; surcharge: boolean; base: number; baseO: Origine; onCommit: (v: number | null) => void
  largeur?: string; decimales?: number; suffixe?: string; disabled?: boolean; titre?: string; attenue?: boolean
}) {
  const affiche = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** decimales) / 10 ** decimales).replace('.', ',') : '')
  // saisie en cours (null = affiche la valeur effective)
  const [brouillon, setBrouillon] = useState<string | null>(null)
  const txt = brouillon ?? affiche(valeur)
  function valider() {
    const t = (brouillon ?? '').trim().replace(',', '.')
    const saisi = brouillon
    setBrouillon(null)
    if (saisi === null) return
    if (t === '') { if (surcharge) onCommit(null); return }
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) return
    if (Math.abs(n - base) < 1e-9) { if (surcharge) onCommit(null); return }
    if (surcharge && Math.abs(n - valeur) < 1e-9) return
    if (!surcharge && Math.abs(n - valeur) < 1e-9) return
    onCommit(n)
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <input value={txt} disabled={disabled} inputMode="decimal"
        onFocus={(e) => { setBrouillon(affiche(valeur)); e.target.select() }}
        onChange={(e) => setBrouillon(e.target.value)}
        onBlur={(e) => { if (e.currentTarget.dataset.annule) { delete e.currentTarget.dataset.annule; setBrouillon(null); return } valider() }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.dataset.annule = '1'; e.currentTarget.blur() } }}
        title={`${titre ? titre + '\n' : ''}${surcharge ? `Surcharge article — valeur ${libOrigine(baseO)} : ${affiche(base)}${suffixe ? ' ' + suffixe : ''}. Vider pour y revenir.` : `Valeur ${libOrigine(baseO)}. Saisir pour surcharger sur cet article.`}`}
        className={`h-6 ${largeur} rounded border px-1 text-right text-[11.5px] outline-none focus:border-[#B4761A] focus:bg-white disabled:opacity-40 ${surcharge ? STYLE_SURCHARGE : STYLE_NORMAL} ${attenue && !surcharge ? 'text-[#B3AD9E]' : ''}`} />
      {suffixe && <span className="text-[9.5px] text-[#B3AD9E]">{suffixe}</span>}
    </span>
  )
}

/** Cellule liste déroulante d'un paramètre d'appro ; la première option revient à la valeur héritée. */
function SaisieListe<T extends string>({ valeur, surcharge, base, baseO, options, onCommit, largeur = 'w-[92px]', disabled, titre, libelle }: {
  valeur: T | null; surcharge: boolean; base: T | null; baseO: Origine; options: { v: T; l: string }[]; onCommit: (v: T | null) => void
  largeur?: string; disabled?: boolean; titre?: string; libelle?: (v: T | null) => string
}) {
  const lib = libelle || ((v: T | null) => (v === null ? '—' : options.find((o) => o.v === v)?.l || v))
  return (
    <select value={surcharge && valeur !== null ? valeur : '__base'} disabled={disabled}
      onChange={(e) => { const v = e.target.value; onCommit(v === '__base' ? null : (v as T)) }}
      title={`${titre ? titre + '\n' : ''}${surcharge ? `Surcharge article — valeur ${libOrigine(baseO)} : ${lib(base)}` : `Valeur ${libOrigine(baseO)}`}`}
      className={`h-6 ${largeur} cursor-pointer rounded border px-0.5 text-[11px] outline-none focus:border-[#B4761A] disabled:cursor-default disabled:opacity-40 ${surcharge ? STYLE_SURCHARGE : STYLE_NORMAL}`}>
      <option value="__base">{lib(base)}{surcharge ? ` (${libOrigine(baseO)})` : ''}</option>
      {options.filter((o) => surcharge || o.v !== base).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Modèle de projection et stratégie de réappro — une seule ligne, explications derrière « i »
// ─────────────────────────────────────────────────────────────────────────

const PROJECTION_PARAM_KEYS = ['projection_perimetre_global', 'projection_demande_mode', 'projection_horizon_delai', 'projection_mu_source', 'frequence_appro_mystock_jours', 'seuil_a_inclut_delai_appro', 'tarif_qte_lecture_bornes']
const FREQUENCES_APPRO: { value: number; label: string }[] = [
  { value: 30, label: 'Mens. 30 j' },
  { value: 15, label: 'Bimens. 15 j' },
  { value: 7, label: 'Hebdo 7 j' },
  { value: 0, label: 'Aucune' },
]
const DEMANDE_MODES: { value: number; label: string; detail: string }[] = [
  { value: 1, label: 'Réservé', detail: 'réservé SAGE (sto_res) uniquement' },
  { value: 2, label: 'Conso', detail: 'μ × horizon / 30 uniquement' },
  { value: 3, label: 'Max', detail: 'le plus grand des deux (les réservations font partie de la conso attendue, on ne les additionne pas)' },
]

function valParam(parametres: Parametre[], cle: string, def: number) {
  const v = parametres.find((p) => p.cle === cle)?.valeur
  return v === undefined || v === null ? def : Number(v)
}

/** Pavé « calcul de besoin » sur une ligne : chaque réglage s'enregistre dans appro_parametres
 * puis recharge les articles ; la méthode forcée est un réglage d'écran (mémorisé). */
function ModeleProjectionLigne({ parametres, onParametresChange, onRecharger, loading, methodeForcee, onMethodeForcee, ctxProp, nbMethodeB, nbTotal, recalculEnCours, onRecalculer, showParams, onToggleParams }: {
  parametres: Parametre[]; onParametresChange: (p: Parametre[]) => void; onRecharger: () => Promise<void>; loading: boolean
  methodeForcee: '' | MethodeCalcul; onMethodeForcee: (m: '' | MethodeCalcul) => void; ctxProp: ContexteProposition
  nbMethodeB: number; nbTotal: number; recalculEnCours: boolean; onRecalculer: () => void; showParams: boolean; onToggleParams: () => void
}) {
  const global = valParam(parametres, 'projection_perimetre_global', 0) === 1
  const demande = valParam(parametres, 'projection_demande_mode', 3)
  const horizonDelai = valParam(parametres, 'projection_horizon_delai', 1) === 1
  const mu3m = valParam(parametres, 'projection_mu_source', 0) === 1
  const frequence = valParam(parametres, 'frequence_appro_mystock_jours', 30)
  const avecDelai = valParam(parametres, 'seuil_a_inclut_delai_appro', 0) === 1
  const lectureTarif = valParam(parametres, 'tarif_qte_lecture_bornes', 0) === 1 ? 1 : 0
  const [saving, setSaving] = useState(false)

  async function changer(cle: string, valeur: number) {
    setSaving(true)
    try {
      const existant = parametres.find((p) => p.cle === cle)
      const { error } = await supabase.from('appro_parametres').upsert({ cle, valeur, description: existant?.description ?? null }, { onConflict: 'cle' })
      if (error) throw error
      onParametresChange(existant ? parametres.map((p) => (p.cle === cle ? { ...p, valeur } : p)) : [...parametres, { cle, valeur, description: null }])
      await onRecharger()
    } catch (e) {
      alert('Erreur : ' + messageErreur(e))
    } finally { setSaving(false) }
  }

  const sel = 'h-7 rounded-md border border-[#E5E1D8] bg-white pl-1 pr-0.5 text-[11px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A] disabled:opacity-60'
  const lab = 'flex shrink-0 items-center gap-1'
  const titre = 'text-[10px] font-bold uppercase tracking-wide text-[#8A8474]'
  const off = saving || loading
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-[#E5E1D8] bg-white px-3 py-1.5">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-[#E5E1D8] pr-2.5">
          <span className="text-[12px] font-bold text-[#111820]">Calcul de besoin</span>
          <Info largeur={460}>
            <b>Stock à réception</b> = stock disponible SAGE (physique − préparations de livraison, périmètre choisi) − demande sur le délai L + encours fournisseur livré ≤ L.
            L = délai d’appro + délai de sécurité (article, sinon fournisseur, sinon défaut). μ = conso retenue de l’article (12 mois, 3 mois, 3 prochains mois N−1, ou N−1 × coef).
            <br /><b>Stock de sécurité</b> = z × σ × √(L/30) · <b>Stock min</b> = μ × L/30 + SS (arrondi au colisage) · <b>Stock max</b> = min + μ × période de revue / 30.
            Tant qu’aucun délai, conso ou écrêtage ne change, ce sont les valeurs du dernier « Recalculer les stocks min » ; sinon elles sont recalculées en direct sur la ligne.
            <br />Une référence en blocage appro, en arrêt appro ou en stratégie article « A la demande » ne reçoit aucune proposition. Survoler « Proposition » donne le détail d’une ligne.
          </Info>
        </div>
        <div className={lab}>
          <span className={titre}>Périmètre</span>
          <select value={global ? 1 : 0} disabled={off} onChange={(e) => void changer('projection_perimetre_global', Number(e.target.value))} className={sel}>
            <option value={0}>Dépôt FMS</option>
            <option value={1}>Global</option>
          </select>
          <Info>{global ? 'Global : stock disponible, réservé et encours de tous les dépôts.' : 'Dépôt FMS seul : stock FMS, réservé FMS, encours livré au dépôt FMS.'}</Info>
        </div>
        <div className={lab}>
          <span className={titre}>Demande</span>
          <select value={demande} disabled={off} onChange={(e) => void changer('projection_demande_mode', Number(e.target.value))} className={sel}>
            {DEMANDE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <Info>Demande déduite du stock sur le délai L : {DEMANDE_MODES.find((m) => m.value === demande)?.detail}.</Info>
        </div>
        <div className={lab}>
          <span className={titre}>Horizon</span>
          <select value={horizonDelai ? 1 : 0} disabled={off} onChange={(e) => void changer('projection_horizon_delai', Number(e.target.value))} className={sel}>
            <option value={1}>≥ délai L</option>
            <option value={0}>Encours</option>
          </select>
          <Info>{horizonDelai ? 'Au moins le délai d’appro L : sans encours, on projette quand même la conso sur L (fournisseur + sécurité).' : 'Jusqu’à la livraison de l’encours seulement : sans encours, horizon = 0 (le projeté vaut le stock à terme).'}</Info>
        </div>
        <div className={lab}>
          <span className={titre}>Conso</span>
          <select value={mu3m ? 1 : 0} disabled={off} onChange={(e) => void changer('projection_mu_source', Number(e.target.value))} className={sel}>
            <option value={0}>μ 12 mois</option>
            <option value={1}>μ 3 mois</option>
          </select>
          <Info>Conso retenue quand ni l’article ni son fournisseur n’en précisent une. {mu3m ? 'μ des 3 derniers mois complets : plus réactif en saison ; le stock de sécurité / min reste calculé sur 12 mois.' : 'Moyenne lissée sur les 12 derniers mois complets.'} Chaque article peut choisir sa conso (colonne « Conso retenue » ou fenêtre article).</Info>
        </div>
        <div className={lab}>
          <span className={titre}>Fréq. A</span>
          <select value={frequence} disabled={off} onChange={(e) => void changer('frequence_appro_mystock_jours', Number(e.target.value))} className={sel}>
            {FREQUENCES_APPRO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            {!FREQUENCES_APPRO.some((f) => f.value === frequence) && <option value={frequence}>{frequence} j</option>}
          </select>
          <Info>Fréquence d’appro des références MYSTOCK (méthode A). {frequence > 0 ? `Seuil A = SS + μ × ${frequence}/30 : le stock à réception doit tenir jusqu’à la réception suivante.` : 'Seuil A = stock de sécurité seul.'}</Info>
        </div>
        <div className={lab}>
          <span className={titre}>Délai seuil</span>
          <select value={avecDelai ? 1 : 0} disabled={off} onChange={(e) => void changer('seuil_a_inclut_delai_appro', Number(e.target.value))} className={sel}>
            <option value={0}>Non</option>
            <option value={1}>Oui</option>
          </select>
          <Info>{avecDelai ? 'Ajoute μ × délai d’appro / 30 au stock de sécurité dans le seuil A.' : 'Le délai est déjà couvert par la projection à la date de réception : il n’est pas ajouté au seuil.'}</Info>
        </div>
        <div className={lab}>
          <span className={titre}>Bornes</span>
          <select value={lectureTarif} disabled={off} onChange={(e) => void changer('tarif_qte_lecture_bornes', Number(e.target.value))} className={sel}>
            <option value={0}>Fin tranche</option>
            <option value={1}>Seuil</option>
          </select>
          <Info>{lectureTarif === 0 ? 'Lecture SAGE de TQ_BorneSup : bornes 23 / 47 → 144,13 € de 24 à 47 unités.' : 'La borne est un seuil : bornes 23 / 47 → 144,13 € dès 48 unités ; prix de base sous la 1re borne.'}</Info>
        </div>
        <div className={`${lab} border-l border-[#E5E1D8] pl-2.5`}>
          <span className={titre}>Méthode</span>
          <select value={methodeForcee} onChange={(e) => onMethodeForcee(e.target.value as '' | MethodeCalcul)} className={`${sel} ${methodeForcee ? 'border-[#D9A441] bg-[#FFF4DC] text-[#8A5A08]' : ''}`}>
            <option value="">Auto</option>
            {METHODES.map((x) => <option key={x.code} value={x.code}>Forcer {x.lettre}</option>)}
          </select>
          <Info largeur={420}>
            <b>A · Min/Max — point de commande</b> : stock à réception &lt; seuil (stock de sécurité + période d’appro MYSTOCK{avecDelai ? ' + délai d’appro' : ''}) → quantité = stock max − stock à réception.<br />
            <b>B · Couverture cible</b> : couverture à réception (stock à réception / μ) &lt; couverture min → quantité = couverture cible × μ − stock à réception.
            Défauts : {METHODE_PAR_CODE[ctxProp.methodeDefaut].lettre}, couverture min {fmtNum(ctxProp.couvMinDefaut, 1)} mois, cible {fmtNum(ctxProp.couvCibleDefaut, 1)} mois.<br />
            La méthode se règle sur le fournisseur et se surcharge sur chaque ligne. {methodeForcee ? 'Forçage écran actif (mémorisé sur ce poste).' : ''} Jeu filtré : {fmtNum(nbMethodeB)} réf. en B, {fmtNum(nbTotal - nbMethodeB)} en A.
          </Info>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {saving && <span className="text-[11px] text-[#8A8474]">Enregistrement…</span>}
          <button type="button" onClick={onRecalculer} disabled={recalculEnCours || loading}
            className="h-7 rounded-md bg-[#111820] px-2.5 text-[11.5px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
            {recalculEnCours ? 'Calcul…' : '↻ Stocks min'}
          </button>
          <Info><b>Recalculer les stocks min</b> : reconstitue la conso mensuelle (BL des 24 derniers mois), puis μ, σ, stock de sécurité / min / max de toutes les références en base (mois écrêtés compris). Les saisies de l’écran sont conservées.</Info>
          <button type="button" onClick={onToggleParams} title="Autres paramètres du calcul (horizon, z, délais par défaut…)" className={`h-7 rounded-md border px-2 text-[11.5px] font-bold ${showParams ? 'border-[#B4761A] text-[#96600F]' : 'border-[#E5E1D8] text-[#3A362E] hover:bg-[#F4F3F0]'}`}>⚙</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre article : consommations mensuelles, ventes anormales, écrêtage, conso retenue
// ─────────────────────────────────────────────────────────────────────────

type MoisConso = { mois: string; qte: number; nb_bl: number | null }
type Ecretage = { reference_article: string; mois: string; qte_origine: number | null; qte_retenue: number; motif: string | null; cree_par: string | null; cree_le: string | null }
type ClientMois = { numero_tiers: string | null; intitule_tiers: string | null; nb_bl: number; qte: number; montant: number }

const LIB_CONSO_COURT: Record<ConsoSource, string> = { '12m': 'Moyenne 12 derniers mois', '3m': 'Moyenne 3 derniers mois', fut3: '3 prochains mois (N−1)', fut3_coef: '3 prochains mois (N−1) × coef' }
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function cleMois(y: number, m0: number) { const d = new Date(y, m0, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
function libMoisAn(cle: string) { const [y, m] = cle.split('-').map(Number); return `${MOIS_COURTS[m - 1]} ${String(y).slice(2)}` }
function libMoisCourt(cle: string) { const [y, m] = cle.split('-').map(Number); return m === 1 ? `janv. ${String(y).slice(2)}` : MOIS_COURTS[m - 1] }
function libMoisLong(cle: string) { const [y, m] = cle.split('-').map(Number); return `${MOIS_COURTS[m - 1].replace('.', '')} ${y}` }
function mediane(v: number[]) { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

type PointConso = {
  cle: string; label: string; zone: 'passe' | 'encours' | 'futur'
  brut: number | null            // sortie réelle
  retenu: number | null          // quantité prise dans les moyennes (écrêtée si écrêtage)
  surplus: number | null         // part écrêtée (affichée en hachuré)
  futur: number | null           // projection : même mois de N−1 (× coef si conso N−1 × coef)
  anomalie: boolean; ecrete: boolean
}

/** Détection des pics : écart robuste à la médiane (MAD) sur les mois clos affichés.
 *  Un mois est « anormal » si (x − médiane) × 0,6745 / MAD > 3,5 et x > 1,5 × médiane ; sans dispersion (MAD = 0), si x > 3 × médiane.
 *  Plafond suggéré pour l'écrêtage : médiane + 3 × 1,4826 × MAD (ou 1,5 × médiane). */
function analyserPics(valeurs: { cle: string; qte: number }[]) {
  const q = valeurs.map((v) => v.qte)
  const med = mediane(q)
  const mad = mediane(q.map((x) => Math.abs(x - med)))
  const plafond = mad > 0 ? Math.round(med + 3 * 1.4826 * mad) : Math.round(med * 1.5)
  const anomalies = new Map<string, { ecartPct: number; plafond: number }>()
  if (med > 0) {
    valeurs.forEach((v) => {
      const z = mad > 0 ? (0.6745 * (v.qte - med)) / mad : v.qte > 3 * med ? 99 : 0
      if (z > 3.5 && v.qte > 1.5 * med && plafond < v.qte) anomalies.set(v.cle, { ecartPct: Math.round((v.qte / med - 1) * 100), plafond })
    })
  }
  return { med, mad, plafond, anomalies }
}

function TooltipConso({ active, payload }: { active?: boolean; payload?: { payload: PointConso }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-2 text-[12px] shadow-lg">
      <div className="font-bold text-[#111820]">{libMoisLong(p.cle)}{p.zone === 'encours' ? ' (en cours)' : p.zone === 'futur' ? ' — projection N−1' : ''}</div>
      {p.zone !== 'futur' && <div>Sorties : <b>{fmtNum(p.brut)}</b></div>}
      {p.ecrete && <div className="text-[#8A5A08]">Écrêté à <b>{fmtNum(p.retenu)}</b> (−{fmtNum(p.surplus)})</div>}
      {p.anomalie && !p.ecrete && <div className="font-semibold text-[#B42318]">Vente anormale</div>}
      {p.zone === 'futur' && <div>Même mois N−1 : <b>{fmtNum(p.futur)}</b></div>}
    </div>
  )
}

function ArticleConsoModal({ article, prop, profil, fourn, ctxProp, ecretageDispo, position, onPrev, onNext, onClose, onOpenFourn, onConsoSave, onProfilReload }: {
  article: ArtRow; prop: Proposition; profil: ProfilConso | undefined; fourn: FournRow | undefined; ctxProp: ContexteProposition
  ecretageDispo: boolean; position: string | null; onPrev?: () => void; onNext?: () => void; onClose: () => void
  onOpenFourn: (numero: string) => void
  onConsoSave: (source: ConsoSource | null, coef: number | null) => Promise<void>
  onProfilReload: () => Promise<void>
}) {
  const ref = article.reference_article
  const [serie, setSerie] = useState<MoisConso[] | null>(null)
  const [ecretages, setEcretages] = useState<Ecretage[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [plafonds, setPlafonds] = useState<Record<string, string>>({})
  const [ecretOuvert, setEcretOuvert] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [moisClients, setMoisClients] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientMois[] | null>(null)
  const [clientsErreur, setClientsErreur] = useState<string | null>(null)
  const [voirCalcul, setVoirCalcul] = useState(false)
  // conso retenue en cours de choix (aperçu avant enregistrement)
  const [draftSource, setDraftSource] = useState<ConsoSource>(prop.eff.conso.v)
  const [draftCoef, setDraftCoef] = useState<string>(String(Math.round(prop.eff.coef.v * 100)))
  const [saving, setSaving] = useState(false)

  const now = new Date()
  const annee = now.getFullYear()
  const debut = cleMois(annee - 1, 0)
  const moisCourant = cleMois(annee, now.getMonth())

  useEffect(() => {
    setDraftSource(prop.eff.conso.v); setDraftCoef(String(Math.round(prop.eff.coef.v * 100)))
  }, [ref, prop.eff.conso.v, prop.eff.coef.v])

  async function chargerEcretages() {
    if (!ecretageDispo) return
    const { data, error } = await supabase.from('appro_article_conso_ecretage').select('*').eq('reference_article', ref)
    if (!error) setEcretages(((data || []) as Ecretage[]).map((e) => ({ ...e, mois: String(e.mois).slice(0, 10), qte_retenue: Number(e.qte_retenue) })))
  }

  useEffect(() => {
    let annule = false
    setSerie(null); setErreur(null); setMoisClients(null); setClients(null); setPlafonds({})
    void supabase.from('appro_article_conso_mensuelle').select('mois, qte, nb_bl').eq('reference_article', ref).gte('mois', debut).order('mois').then(({ data, error }) => {
      if (annule) return
      if (error) setErreur(messageErreur(error))
      else setSerie(((data || []) as MoisConso[]).map((r) => ({ mois: String(r.mois).slice(0, 10), qte: Number(r.qte), nb_bl: r.nb_bl })))
    })
    void chargerEcretages()
    return () => { annule = true }
  }, [ref]) // eslint-disable-line react-hooks/exhaustive-deps

  // Échap ferme ; ← / → passent à la référence précédente / suivante (hors saisie)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const saisie = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
      if (e.key === 'Escape') onClose()
      else if (!saisie && e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev() }
      else if (!saisie && e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const parMois = useMemo(() => new Map((serie || []).map((s) => [s.mois, s])), [serie])
  const ecretParMois = useMemo(() => new Map(ecretages.map((e) => [e.mois, e])), [ecretages])

  // Mois affichés : du 1er janvier N−1 au mois en cours, puis les 3 prochains mois (projection N−1)
  const moisPasses = useMemo(() => {
    const out: string[] = []
    for (let i = 0; ; i += 1) { const c = cleMois(annee - 1, i); out.push(c); if (c === moisCourant || i > 40) break }
    return out
  }, [annee, moisCourant])
  const moisClos = moisPasses.filter((c) => c !== moisCourant)
  const pics = useMemo(() => analyserPics(moisClos.map((c) => ({ cle: c, qte: n0(parMois.get(c)?.qte) }))), [moisClos.join(), parMois]) // eslint-disable-line react-hooks/exhaustive-deps

  const coefDraft = Math.max(0.01, Number(draftCoef.replace(',', '.')) / 100 || 1)
  const points: PointConso[] = useMemo(() => {
    const pts: PointConso[] = moisPasses.map((c) => {
      const brut = n0(parMois.get(c)?.qte)
      const e = ecretParMois.get(c)
      const retenu = e ? Math.min(brut, e.qte_retenue) : brut
      return { cle: c, label: libMoisCourt(c), zone: c === moisCourant ? 'encours' : 'passe', brut, retenu, surplus: e && brut > retenu ? brut - retenu : null, futur: null, anomalie: pics.anomalies.has(c), ecrete: !!e }
    })
    for (let i = 1; i <= 3; i += 1) {
      const c = cleMois(annee, now.getMonth() + i)
      const [y, m] = c.split('-').map(Number)
      const n1 = cleMois(y - 1, m - 1)
      const e = ecretParMois.get(n1)
      const base = e ? Math.min(n0(parMois.get(n1)?.qte), e.qte_retenue) : n0(parMois.get(n1)?.qte)
      pts.push({ cle: c, label: libMoisCourt(c), zone: 'futur', brut: null, retenu: null, surplus: null, futur: Math.round(base * (draftSource === 'fut3_coef' ? coefDraft : 1) * 10) / 10, anomalie: false, ecrete: false })
    }
    return pts
  }, [moisPasses, parMois, ecretParMois, pics, moisCourant, annee, draftSource, coefDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aperçu de la proposition avec la conso choisie (avant enregistrement)
  const apercu = useMemo(() => {
    if (!profil) return prop
    const simule: ProfilConso = { ...profil, conso_source: draftSource, conso_coef: draftSource === 'fut3_coef' ? coefDraft : null }
    const profils = new Map(ctxProp.profils); profils.set(ref, simule)
    return calculerProposition(article, { ...ctxProp, profils })
  }, [profil, draftSource, coefDraft, ctxProp, article, ref, prop])
  const modifie = draftSource !== prop.eff.conso.v || (draftSource === 'fut3_coef' && Math.abs(coefDraft - prop.eff.coef.v) > 1e-6)

  async function enregistrerConso(revenir: boolean) {
    setSaving(true)
    try {
      if (revenir) await onConsoSave(null, null)
      else await onConsoSave(draftSource, draftSource === 'fut3_coef' ? coefDraft : null)
    } finally { setSaving(false) }
  }

  async function ecreter(cle: string) {
    const brut = n0(parMois.get(cle)?.qte)
    const v = Number((plafonds[cle] ?? String(pics.anomalies.get(cle)?.plafond ?? pics.plafond)).replace(',', '.'))
    if (!Number.isFinite(v) || v < 0 || v >= brut) { alert(`Saisis une quantité retenue inférieure à la sortie réelle (${fmtNum(brut)}).`); return }
    setEnCours(cle)
    try {
      const { error } = await supabase.from('appro_article_conso_ecretage').upsert({
        reference_article: ref, mois: cle, qte_origine: brut, qte_retenue: v,
        motif: pics.anomalies.has(cle) ? `Pic +${pics.anomalies.get(cle)!.ecartPct} % vs médiane ${fmtNum(pics.med)}` : 'Écrêtage manuel',
      }, { onConflict: 'reference_article,mois' })
      if (error) throw error
      await chargerEcretages(); await onProfilReload()
    } catch (e) { alert('Erreur écrêtage : ' + messageErreur(e)) } finally { setEnCours(null) }
  }
  async function annulerEcretage(cle: string) {
    setEnCours(cle)
    try {
      const { error } = await supabase.from('appro_article_conso_ecretage').delete().eq('reference_article', ref).eq('mois', cle)
      if (error) throw error
      await chargerEcretages(); await onProfilReload()
    } catch (e) { alert('Erreur : ' + messageErreur(e)) } finally { setEnCours(null) }
  }
  async function voirClients(cle: string) {
    if (moisClients === cle) { setMoisClients(null); return }
    setMoisClients(cle); setClients(null); setClientsErreur(null)
    const { data, error } = await supabase.rpc('appro_article_sorties_clients', { p_reference: ref, p_mois: cle })
    if (error) setClientsErreur(messageErreur(error))
    else setClients(((data || []) as ClientMois[]).map((c) => ({ ...c, qte: Number(c.qte), montant: Number(c.montant), nb_bl: Number(c.nb_bl) })))
  }

  const fut3Debut = profil?.fut3_debut ? String(profil.fut3_debut).slice(0, 10) : cleMois(annee - 1, now.getMonth() + 1)
  const fut3Lib = (() => { const [y, m] = fut3Debut.split('-').map(Number); return `${libMoisAn(cleMois(y, m - 1))} → ${libMoisAn(cleMois(y, m + 1))}` })()
  const muDraft = muSelon(article, profil, draftSource, coefDraft)
  const valeursConso: Record<ConsoSource, number> = { '12m': prop.mu12, '3m': prop.mu3, fut3: prop.muFut3, fut3_coef: Math.round(prop.muFut3 * coefDraft * 100) / 100 }
  const derniers12 = moisClos.slice(-12)
  const derniers3 = moisClos.slice(-3)
  const futurs = points.filter((p) => p.zone === 'futur')
  const maxY = Math.max(1, ...points.map((p) => Math.max(n0(p.brut), n0(p.futur))), prop.mu12, prop.mu3, muDraft) * 1.08

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E1D8] px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-bold text-[#111820]">{ref}</span>
              <BlocageApproBadge article={article} compact />
              {article.mystock === 'OUI' && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">MYSTOCK</span>}
              {article.arret_appro && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Arrêt appro</span>}
              {n0(profil?.nb_mois_ecretes) > 0 && <span className="rounded-full bg-[#FFF4DC] px-1.5 py-0.5 text-[10px] font-bold text-[#8A5A08]">{profil!.nb_mois_ecretes} mois écrêté{n0(profil!.nb_mois_ecretes) > 1 ? 's' : ''}</span>}
              {article.lien_blg && <a href={article.lien_blg} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-[#B4761A] hover:underline">BLG ↗</a>}
            </div>
            <div className="truncate text-[16px] font-bold text-[#111820]">{article.sage_designation || '—'}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[#8A8474]">
              {article.fournisseur_principal ? (
                <button type="button" onClick={() => onOpenFourn(article.fournisseur_principal!)} className="font-semibold text-[#B4761A] hover:underline">
                  {article.fournisseur_principal} · {fourn?.sage_intitule || 'fournisseur'} ↗
                </button>
              ) : <span>Sans fournisseur principal</span>}
              <span>· {article.famille || 'famille —'}</span>
              <span>· stratégie {prop.eff.strategie.v || '—'} ({libOrigine(prop.eff.strategie.o)})</span>
              <span>· méthode {prop.lettre} · L {prop.delaiL} j</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position && <span className="mr-1 text-[11px] text-[#8A8474]">{position}</span>}
            <button type="button" onClick={onPrev} disabled={!onPrev} title="Référence précédente (←)" className="h-8 w-8 rounded-lg border border-[#E5E1D8] text-[14px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-30">‹</button>
            <button type="button" onClick={onNext} disabled={!onNext} title="Référence suivante (→)" className="h-8 w-8 rounded-lg border border-[#E5E1D8] text-[14px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-30">›</button>
            <button type="button" onClick={onClose} className="ml-1 rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0] hover:text-[#111820]">✕</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-5 py-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          {/* Colonne gauche : graphique + mois */}
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-5 gap-2">
              <KpiMini label="μ 12 derniers mois" value={fmtNum(prop.mu12, 1)} loading={false} sub={`σ ${fmtNum(prop.sigma, 1)}`} actif={draftSource === '12m'} onClick={() => setDraftSource('12m')} />
              <KpiMini label="μ 3 derniers mois" value={fmtNum(prop.mu3, 1)} loading={false} sub={prop.mu12 > 0 ? `${prop.mu3 >= prop.mu12 ? '+' : ''}${Math.round((prop.mu3 / prop.mu12 - 1) * 100)} % vs 12 m` : undefined} actif={draftSource === '3m'} onClick={() => setDraftSource('3m')} />
              <KpiMini label="3 prochains mois N−1" value={fmtNum(prop.muFut3, 1)} loading={false} sub={fut3Lib} actif={draftSource === 'fut3'} onClick={() => setDraftSource('fut3')} />
              <KpiMini label="N−1 × coef" value={fmtNum(valeursConso.fut3_coef, 1)} loading={false} sub={`× ${fmtNum(coefDraft * 100)} %`} actif={draftSource === 'fut3_coef'} onClick={() => setDraftSource('fut3_coef')} />
              <KpiMini label="Mois en cours" value={fmtNum(parMois.get(moisCourant)?.qte ?? 0)} loading={!serie} sub={`${now.getDate()} j écoulés`} />
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-2">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Sorties mensuelles depuis janvier {annee - 1} · projection des 3 prochains mois sur N−1</div>
                <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-[#8A8474]">
                  <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#3A362E]" /> sorties</span>
                  <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#C1683C]" /> vente anormale</span>
                  <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-[#C1683C] bg-[#C1683C]/20" /> part écrêtée</span>
                  <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-[#B4761A] bg-[#B4761A]/25" /> N−1</span>
                  <span className="inline-flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-[#B4761A]" /> μ retenu</span>
                </div>
              </div>
              <div className="h-[260px]">
                {erreur ? <div className="p-6 text-[12px] text-red-700">Conso mensuelle indisponible : {erreur}</div> : !serie ? <div className="h-full animate-pulse rounded-lg bg-[#F4F3F0]" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={points} margin={{ top: 14, right: 12, bottom: 0, left: 0 }} barCategoryGap="18%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#EDEAE1" vertical={false} />
                      <XAxis dataKey="cle" tickFormatter={(c: string) => libMoisCourt(c)} tick={{ fontSize: 10, fill: '#8A8474' }} tickLine={false} axisLine={{ stroke: '#E5E1D8' }} interval={0} />
                      <YAxis tick={{ fontSize: 10.5, fill: '#8A8474' }} tickLine={false} axisLine={false} width={48} domain={[0, Math.ceil(maxY)]} tickFormatter={(v: number) => fmtNum(v)} />
                      <Tooltip content={<TooltipConso />} cursor={{ fill: '#F4F3F0' }} />
                      <Bar dataKey="retenu" stackId="c" isAnimationActive={false} radius={[0, 0, 0, 0]}>
                        {points.map((p) => <Cell key={p.cle} fill={p.anomalie && !p.ecrete ? '#C1683C' : p.zone === 'encours' ? '#B3AD9E' : '#3A362E'} />)}
                      </Bar>
                      <Bar dataKey="surplus" stackId="c" isAnimationActive={false} fill="#C1683C" fillOpacity={0.18} stroke="#C1683C" strokeDasharray="3 2" />
                      <Bar dataKey="futur" stackId="c" isAnimationActive={false} fill="#B4761A" fillOpacity={0.25} stroke="#B4761A" strokeDasharray="3 2" />
                      {derniers12.length > 0 && <ReferenceLine segment={[{ x: derniers12[0], y: prop.mu12 }, { x: derniers12[derniers12.length - 1], y: prop.mu12 }]} stroke="#8A8474" strokeDasharray="5 3" ifOverflow="extendDomain" label={{ value: `μ 12 m ${fmtNum(prop.mu12)}`, position: 'insideTopLeft', fontSize: 10, fill: '#8A8474' }} />}
                      {derniers3.length > 0 && <ReferenceLine segment={[{ x: derniers3[0], y: prop.mu3 }, { x: derniers3[derniers3.length - 1], y: prop.mu3 }]} stroke="#7A5EA8" strokeWidth={2} ifOverflow="extendDomain" label={{ value: `μ 3 m ${fmtNum(prop.mu3)}`, position: 'top', fontSize: 10, fill: '#7A5EA8' }} />}
                      {futurs.length > 0 && <ReferenceLine segment={[{ x: futurs[0].cle, y: draftSource === 'fut3_coef' ? valeursConso.fut3_coef : prop.muFut3 }, { x: futurs[futurs.length - 1].cle, y: draftSource === 'fut3_coef' ? valeursConso.fut3_coef : prop.muFut3 }]} stroke="#B4761A" strokeDasharray="4 2" ifOverflow="extendDomain" />}
                      <ReferenceLine y={muDraft} stroke="#B4761A" strokeWidth={1.5} ifOverflow="extendDomain" label={{ value: `retenu ${fmtNum(muDraft, 1)}`, position: 'insideTopRight', fontSize: 10.5, fontWeight: 700, fill: '#96600F' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Mois : anomalies, écrêtage, clients */}
            <div className="rounded-xl border border-[#E5E1D8]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E1D8] px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                  Mois par mois · {pics.anomalies.size ? <span className="normal-case tracking-normal text-[#B42318]">{pics.anomalies.size} vente{pics.anomalies.size > 1 ? 's' : ''} anormale{pics.anomalies.size > 1 ? 's' : ''} détectée{pics.anomalies.size > 1 ? 's' : ''}</span> : <span className="normal-case tracking-normal text-emerald-700">aucune vente anormale</span>}
                  <Info largeur={400}>Médiane des mois clos affichés : {fmtNum(pics.med)} · écart robuste (MAD) : {fmtNum(pics.mad)}. Un mois est signalé quand il s’écarte nettement de la médiane (écart robuste &gt; 3,5 et plus de 1,5 × la médiane). <b>Écrêter</b> remplace la sortie du mois par la quantité saisie dans μ 12 mois, σ, μ 3 mois et la projection N−1 (et dans le prochain recalcul des stocks min) ; la sortie réelle reste visible. Le plafond proposé est médiane + 3 écarts robustes ({fmtNum(pics.plafond)}).</Info>
                </div>
                {!ecretageDispo && <span className="text-[11px] font-semibold text-[#B4761A]">Écrêtage indisponible : migration 20261004_calcul_besoin_appro à appliquer</span>}
              </div>
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-[#F4F3F0] text-[10px] uppercase text-[#8A8474]">
                    <tr><th className="px-2 py-1 text-left">Mois</th><th className="px-2 py-1 text-right">Sorties</th><th className="px-2 py-1 text-right">BL</th><th className="px-2 py-1 text-right">vs médiane</th><th className="px-2 py-1 text-left">Écrêtage</th><th className="px-2 py-1 text-right">Clients</th></tr>
                  </thead>
                  <tbody>
                    {[...moisPasses].reverse().map((c) => {
                      const s = parMois.get(c)
                      const brut = n0(s?.qte)
                      const an = pics.anomalies.get(c)
                      const e = ecretParMois.get(c)
                      const ecart = pics.med > 0 ? Math.round((brut / pics.med - 1) * 100) : null
                      return (
                        <React.Fragment key={c}>
                          <tr className={`border-t border-[#F4F3F0] ${an && !e ? 'bg-[#C1683C]/[0.07]' : e ? 'bg-[#FFF4DC]/60' : ''}`}>
                            <td className="px-2 py-1 font-semibold text-[#3A362E]">{libMoisLong(c)}{c === moisCourant ? <span className="ml-1 text-[10px] font-normal text-[#8A8474]">en cours</span> : null}</td>
                            <td className="px-2 py-1 text-right font-semibold">{fmtNum(brut)}{e ? <span className="ml-1 text-[11px] font-bold text-[#8A5A08]">→ {fmtNum(e.qte_retenue)}</span> : null}</td>
                            <td className="px-2 py-1 text-right text-[#8A8474]">{fmtNum(s?.nb_bl ?? 0)}</td>
                            <td className={`px-2 py-1 text-right ${an ? 'font-bold text-[#B42318]' : 'text-[#8A8474]'}`}>{ecart === null || c === moisCourant ? '—' : `${ecart >= 0 ? '+' : ''}${ecart} %`}{an ? ' ⚠' : ''}</td>
                            <td className="px-2 py-1">
                              {c === moisCourant ? <span className="text-[10.5px] text-[#B3AD9E]">mois non clos</span> : e ? (
                                <span className="inline-flex items-center gap-2 text-[11px]">
                                  <span className="text-[#8A5A08]" title={`${e.motif || ''}${e.cree_par ? ` · ${e.cree_par}` : ''}${e.cree_le ? ` · ${fmtDate(e.cree_le)}` : ''}`}>écrêté à {fmtNum(e.qte_retenue)}</span>
                                  <button type="button" disabled={enCours === c || !ecretageDispo} onClick={() => void annulerEcretage(c)} className="font-bold text-[#B4761A] hover:underline disabled:opacity-40">annuler</button>
                                </span>
                              ) : brut > 0 && !an && ecretOuvert !== c ? (
                                <button type="button" disabled={!ecretageDispo} onClick={() => setEcretOuvert(c)} className="text-[11px] font-semibold text-[#8A8474] hover:text-[#B4761A] hover:underline disabled:opacity-40">écrêter…</button>
                              ) : brut > 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <input value={plafonds[c] ?? (an ? String(an.plafond) : '')} onChange={(ev) => setPlafonds({ ...plafonds, [c]: ev.target.value })} placeholder={fmtNum(pics.plafond)} disabled={!ecretageDispo}
                                    className={`h-6 w-16 rounded border px-1 text-right text-[11px] outline-none focus:border-[#B4761A] ${an ? 'border-[#C1683C]/60' : 'border-[#E5E1D8]'}`} />
                                  <button type="button" disabled={enCours === c || !ecretageDispo} onClick={() => void ecreter(c)}
                                    className={`h-6 rounded px-2 text-[11px] font-bold disabled:opacity-40 ${an ? 'bg-[#C1683C] text-white hover:bg-[#A9572F]' : 'border border-[#E5E1D8] text-[#3A362E] hover:bg-[#F4F3F0]'}`}>{enCours === c ? '…' : 'Écrêter'}</button>
                                </span>
                              ) : <span className="text-[#B3AD9E]">—</span>}
                            </td>
                            <td className="px-2 py-1 text-right">
                              {brut !== 0 && <button type="button" onClick={() => void voirClients(c)} className={`text-[11px] font-bold hover:underline ${moisClients === c ? 'text-[#111820]' : 'text-[#B4761A]'}`}>{moisClients === c ? 'masquer' : 'voir'}</button>}
                            </td>
                          </tr>
                          {moisClients === c && (
                            <tr className="bg-[#F4F3F0]/60">
                              <td colSpan={6} className="px-3 py-2">
                                {clientsErreur ? <span className="text-[11px] text-red-700">Détail clients indisponible : {clientsErreur}</span> : !clients ? <span className="text-[11px] text-[#8A8474]">Chargement…</span> : clients.length === 0 ? <span className="text-[11px] text-[#8A8474]">Aucune ligne.</span> : (
                                  <div className="grid gap-x-6 gap-y-0.5 text-[11.5px] md:grid-cols-2">
                                    {clients.map((cl, i) => (
                                      <div key={i} className="flex items-baseline justify-between gap-2 border-b border-[#E5E1D8]/60 py-0.5">
                                        <span className="truncate"><span className="font-mono text-[10.5px] text-[#8A8474]">{cl.numero_tiers}</span> {cl.intitule_tiers}</span>
                                        <span className="shrink-0 whitespace-nowrap"><b>{fmtNum(cl.qte)}</b> <span className="text-[#8A8474]">({brut ? Math.round((cl.qte / brut) * 100) : 0} % · {cl.nb_bl} BL)</span></span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Colonne droite : conso retenue, impact, calcul */}
          <div className="space-y-3">
            <div className="rounded-xl border-2 border-[#B4761A]/40 bg-[#B4761A]/[0.04] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#96600F]">Conso retenue pour l’article</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${prop.eff.conso.o === 'article' ? 'bg-[#FFF4DC] text-[#8A5A08]' : 'bg-[#F4F3F0] text-[#8A8474]'}`}>{libOrigine(prop.eff.conso.o)}</span>
              </div>
              <select value={draftSource} onChange={(e) => setDraftSource(e.target.value as ConsoSource)} disabled={!profil}
                className="h-9 w-full rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12.5px] font-semibold text-[#111820] outline-none focus:border-[#B4761A]">
                {CONSO_SOURCES.map((s) => <option key={s.code} value={s.code}>{LIB_CONSO_COURT[s.code]} — {fmtNum(valeursConso[s.code], 1)}</option>)}
              </select>
              {draftSource === 'fut3_coef' && (
                <label className="mt-2 flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-[#3A362E]">Coefficient</span>
                  <input value={draftCoef} onChange={(e) => setDraftCoef(e.target.value)} inputMode="decimal" className="h-8 w-20 rounded-lg border border-[#E5E1D8] px-2 text-right font-bold outline-none focus:border-[#B4761A]" />
                  <span className="text-[#8A8474]">% de N−1 ({fut3Lib})</span>
                </label>
              )}
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-[12px] text-[#8A8474]">μ retenu</span>
                <span className="text-[24px] font-bold tracking-tight text-[#111820]">{fmtNum(muDraft, 1)}<span className="text-[12px] font-semibold text-[#8A8474]"> / mois</span></span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg bg-white p-2 text-[11.5px]">
                <span className="text-[#8A8474]">Stock à réception</span><span className="text-right font-semibold">{fmtNum(apercu.stockReception)}</span>
                <span className="text-[#8A8474]">Couverture</span><span className="text-right font-semibold">{apercu.couvReception === null ? '—' : `${fmtNum(apercu.couvReception, 1)} mois`}</span>
                <span className="text-[#8A8474]">SS / min / max</span><span className="text-right font-semibold">{fmtNum(apercu.ss)} / {fmtNum(apercu.minEff)} / {fmtNum(apercu.maxEff)}</span>
                <span className="text-[#8A8474]">Proposition</span>
                <span className="text-right"><b className={apercu.declenche ? 'text-red-700' : ''}>{fmtNum(apercu.qteProposee)}</b>{modifie && apercu.qteProposee !== prop.qteProposee ? <span className="ml-1 text-[10.5px] text-[#8A8474]">(actuelle {fmtNum(prop.qteProposee)})</span> : null}</span>
                {prop.qteRetenue !== null && <><span className="text-[#8A8474]">Qté retenue saisie</span><span className="text-right font-semibold text-[#96600F]">{fmtNum(prop.qteRetenue)}</span></>}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                {prop.eff.conso.o === 'article'
                  ? <button type="button" disabled={saving} onClick={() => void enregistrerConso(true)} className="text-[11.5px] font-bold text-[#B4761A] hover:underline disabled:opacity-50">↺ Revenir à : {CONSO_PAR_CODE[prop.eff.conso.base].label.toLowerCase()} ({libOrigine(prop.eff.conso.baseO)})</button>
                  : <span className="text-[11px] text-[#8A8474]">Hérité : {CONSO_PAR_CODE[prop.eff.conso.v].label.toLowerCase()}</span>}
                <button type="button" disabled={saving || !modifie || !profil} onClick={() => void enregistrerConso(false)}
                  className="h-8 shrink-0 rounded-lg bg-[#111820] px-3 text-[12px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-40">{saving ? '…' : 'Appliquer'}</button>
              </div>
              {!profil && <div className="mt-2 text-[11px] font-semibold text-[#B4761A]">Choix de conso indisponible : migration 20261004_calcul_besoin_appro à appliquer.</div>}
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-3 text-[12px]">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Stock & flux</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-[#8A8474]">Dispo global (FMS)</span><span className="text-right font-semibold">{fmtNum(article.sage_stock_dispo_total)} ({fmtNum(article.stock_dispo_sage_fms)})</span>
                <span className="text-[#8A8474]">Encours ≤ L (après)</span><span className="text-right font-semibold">{fmtNum(prop.encoursPeriode)}{prop.encoursApres ? ` (${fmtNum(prop.encoursApres)})` : ''}</span>
                <span className="text-[#8A8474]">Réservé ≤ L (après)</span><span className="text-right font-semibold">{fmtNum(prop.reservePeriode)}{prop.reserveApres ? ` (${fmtNum(prop.reserveApres)})` : ''}</span>
                <span className="text-[#8A8474]">Délais appro / sécu</span><span className="text-right font-semibold">{fmtNum(prop.eff.delaiAppro.v)} / {fmtNum(prop.eff.delaiSecu.v)} j</span>
                <span className="text-[#8A8474]">Colisage</span><span className="text-right font-semibold">{prop.colisage > 1 ? fmtNum(prop.colisage) : '—'}</span>
                <span className="text-[#8A8474]">Dernière sortie</span><span className="text-right font-semibold">{fmtMois(article.sage_derniere_sortie)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-3">
              <button type="button" onClick={() => setVoirCalcul((v) => !v)} className="text-[11.5px] font-bold text-[#B4761A] hover:underline">{voirCalcul ? '▼ Masquer le calcul' : '▶ Détail du calcul de la proposition'}</button>
              {voirCalcul && (
                <div className="mt-2 space-y-1 font-mono text-[10.5px] leading-relaxed text-[#3A362E]">
                  {apercu.explication.map((l, i) => <div key={i} className={i === 0 ? 'font-bold text-[#111820]' : ''}>{l}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet « Calcul de besoin - Articles »
// ─────────────────────────────────────────────────────────────────────────

type CleColArt =
  | 'inc' | 'reference' | 'fourn' | 'blocage'
  | 'strategie' | 'methode' | 'couv_min' | 'couv_cible' | 'conso' | 'delai_appro' | 'delai_secu' | 'delai_l'
  | 'mu12' | 'mu3' | 'fut3' | 'sigma' | 'derniere_sortie'
  | 'dispo' | 'encours' | 'reserve' | 'projete' | 'couv'
  | 'ss' | 'min_calc' | 'max_calc' | 'min_sage' | 'min_blg' | 'retenu'
  | 'proposition' | 'retenue' | 'date_liv' | 'montant' | 'prix_qte' | 'palier_suivant' | 'paliers_plus'
type GroupeCol = 'Article' | 'Paramètres d’appro' | 'Conso' | 'Projection à réception' | 'Stocks min / max' | 'Commande' | 'Tarif'
type FiltresColArt = Partial<Record<CleColArt, string>>
type CtxColArt = { fournMap: Map<string, FournRow>; incoherencesParRef: Map<string, string[]>; propositions: Map<string, Proposition>; tarifs: Map<string, AnalyseTarif> }
const propDe = (c: CtxColArt, a: ArtRow) => c.propositions.get(a.reference_article)

/** Prix unitaire d'achat de la quantité commandée : tarif par quantité, sinon prix fournisseur, sinon prix d'achat. */
function prixUnitaire(a: ArtRow, t: AnalyseTarif | undefined): number | null {
  if (t && t.prixActuel !== null) return t.prixActuel
  const p = a.sage_prix_achat_fournisseur ?? a.sage_prix_achat ?? a.blg_prix_achat_fournisseur ?? a.blg_prix_achat
  return p === null || p === undefined || Number(p) <= 0 ? null : Number(p)
}

const COLONNES_ARTICLES: { key: CleColArt; label: string; groupe: GroupeCol; title?: string; align: 'left' | 'right'; placeholder?: string; val: (a: ArtRow, ctx: CtxColArt) => unknown }[] = [
  { key: 'inc', label: '⚠', groupe: 'Article', title: 'Nombre d\'incohérences détectées (survole pour le détail). Filtre : ">0", "=0", ou un mot du libellé', align: 'left', placeholder: '>0', val: (a, c) => c.incoherencesParRef.get(a.reference_article)?.length ?? 0 },
  { key: 'reference', label: 'Référence', groupe: 'Article', title: 'Référence et désignation SAGE — clic : consommations mensuelles, ventes anormales, écrêtage, conso retenue', align: 'left', placeholder: 'réf. ou désignation', val: (a) => a.reference_article },
  { key: 'fourn', label: 'Fourn.', groupe: 'Article', title: 'Fournisseur principal — clic : fiche fournisseur. Filtre sur le n° ou l\'intitulé', align: 'left', placeholder: 'n° ou nom', val: (a) => a.fournisseur_principal },
  { key: 'blocage', label: 'Blocage', groupe: 'Article', title: 'Blocage appro SAGE, exclusion, vie produit, arrêt appro / vente (✎). Filtre : "blocage", "exclu", "fin", "arrêt", "vide"', align: 'left', placeholder: 'blocage', val: (a) => [a.blocage_appro ? 'Blocage appro' : '', a.exclure_appro ? 'Exclu' : '', a.vie_produit || '', a.arret_appro ? 'Arrêt appro' : '', a.arret_vente ? 'Arrêt vente' : '', a.ref_remplacante ? '→ ' + a.ref_remplacante : ''].filter(Boolean).join(' ') },
  { key: 'strategie', label: 'Stratégie', groupe: 'Paramètres d’appro', title: 'Stratégie d\'appro : celle du fournisseur, surchargeable sur l\'article (en couleur). « A la demande » sur l\'article = aucune proposition.', align: 'left', val: (a, c) => propDe(c, a)?.eff.strategie.v || '' },
  { key: 'methode', label: 'Méth.', groupe: 'Paramètres d’appro', title: 'Méthode A (Min/Max) ou B (couverture cible) — fournisseur, surchargeable sur l\'article. Filtre : "A", "B"', align: 'left', placeholder: 'A / B', val: (a, c) => propDe(c, a)?.lettre ?? '' },
  { key: 'couv_min', label: 'Couv. min', groupe: 'Paramètres d’appro', title: 'Méthode B : couverture à réception (mois) en dessous de laquelle on commande', align: 'right', val: (a, c) => propDe(c, a)?.couvMin ?? null },
  { key: 'couv_cible', label: 'Couv. max', groupe: 'Paramètres d’appro', title: 'Méthode B : couverture cible (mois) à atteindre à réception', align: 'right', val: (a, c) => propDe(c, a)?.couvCible ?? null },
  { key: 'conso', label: 'Conso retenue', groupe: 'Paramètres d’appro', title: 'Conso utilisée pour le calcul : μ 12 mois, μ 3 mois, 3 prochains mois N−1, ou N−1 × coef (%). Valeur retenue en dessous.', align: 'left', val: (a, c) => propDe(c, a)?.mu ?? null },
  { key: 'delai_appro', label: 'Délai appro', groupe: 'Paramètres d’appro', title: 'Délai d\'appro (jours calendaires) — fournisseur, surchargeable sur l\'article', align: 'right', val: (a, c) => propDe(c, a)?.eff.delaiAppro.v ?? null },
  { key: 'delai_secu', label: 'Sécu', groupe: 'Paramètres d’appro', title: 'Délai de sécurité (jours calendaires) — fournisseur, surchargeable sur l\'article', align: 'right', val: (a, c) => propDe(c, a)?.eff.delaiSecu.v ?? null },
  { key: 'delai_l', label: 'L', groupe: 'Paramètres d’appro', title: 'Délai L = délai d\'appro + délai de sécurité', align: 'right', val: (a, c) => propDe(c, a)?.delaiL ?? null },
  { key: 'mu12', label: 'μ 12 m', groupe: 'Conso', title: 'Conso moyenne mensuelle des 12 derniers mois complets (écrêtage compris)', align: 'right', val: (a, c) => propDe(c, a)?.mu12 ?? null },
  { key: 'mu3', label: 'μ 3 m', groupe: 'Conso', title: 'Conso moyenne des 3 derniers mois complets', align: 'right', val: (a, c) => propDe(c, a)?.mu3 ?? null },
  { key: 'fut3', label: 'N−1 +3', groupe: 'Conso', title: 'Conso moyenne des 3 prochains mois, l\'an dernier (base N−1)', align: 'right', val: (a, c) => propDe(c, a)?.muFut3 ?? null },
  { key: 'sigma', label: 'σ', groupe: 'Conso', title: 'Écart-type mensuel sur 12 mois', align: 'right', val: (a, c) => propDe(c, a)?.sigma ?? null },
  { key: 'derniere_sortie', label: 'Dern. sortie', groupe: 'Conso', title: 'Dernière sortie BL (mois). Filtre au format AAAA-MM', align: 'right', placeholder: '2026-0', val: (a) => a.sage_derniere_sortie ? String(a.sage_derniere_sortie).slice(0, 7) : null },
  { key: 'dispo', label: 'Dispo', groupe: 'Projection à réception', title: 'Stock disponible SAGE tous dépôts — entre parenthèses : dépôt FMS', align: 'right', val: (a) => a.sage_stock_dispo_total },
  { key: 'encours', label: 'Encours', groupe: 'Projection à réception', title: 'Encours fournisseur livré dans le délai L (compté) ; entre parenthèses : livré après L. ⏱ = en retard, ? = douteux (exclu)', align: 'right', val: (a, c) => propDe(c, a)?.encoursPeriode ?? null },
  { key: 'reserve', label: 'Réservé', groupe: 'Projection à réception', title: 'Ventes réservées SAGE à livrer d\'ici la réception (déduites) ; entre parenthèses : après L', align: 'right', val: (a, c) => propDe(c, a)?.reservePeriode ?? null },
  { key: 'projete', label: 'Stock récep.', groupe: 'Projection à réception', title: 'Stock juste avant la réception d\'une commande passée aujourd\'hui. Rouge = déclenche une proposition', align: 'right', val: (a, c) => propDe(c, a)?.stockReception ?? null },
  { key: 'couv', label: 'Couv.', groupe: 'Projection à réception', title: 'Couverture à réception = stock à réception / μ retenu (mois)', align: 'right', val: (a, c) => propDe(c, a)?.couvReception ?? null },
  { key: 'ss', label: 'SS', groupe: 'Stocks min / max', title: 'Stock de sécurité = z × σ × √(L/30) — en couleur quand recalculé sur la ligne', align: 'right', val: (a, c) => propDe(c, a)?.ss ?? null },
  { key: 'min_calc', label: 'Min', groupe: 'Stocks min / max', title: 'Stock min = μ × L/30 + SS (colisage), ou stock min retenu', align: 'right', val: (a, c) => propDe(c, a)?.minEff ?? null },
  { key: 'max_calc', label: 'Max', groupe: 'Stocks min / max', title: 'Stock max = min + μ × période de revue / 30', align: 'right', val: (a, c) => propDe(c, a)?.maxEff ?? null },
  { key: 'min_sage', label: 'Min SAGE', groupe: 'Stocks min / max', align: 'right', val: (a) => a.sage_stock_min_fms },
  { key: 'min_blg', label: 'Min BLG', groupe: 'Stocks min / max', title: 'Stock min BLG (DPFMS) — rouge si différent du calculé', align: 'right', val: (a) => a.blg_stock_min_fms },
  { key: 'retenu', label: 'Min retenu', groupe: 'Stocks min / max', title: 'Stock min retenu, délais, arrêt appro / vente, remplaçante (✎). Filtre "!vide" = avec saisie', align: 'right', placeholder: '!vide', val: (a) => a.stock_min_retenu },
  { key: 'proposition', label: 'Proposition', groupe: 'Commande', title: 'Quantité proposée (arrondie au colisage). Survole pour le calcul détaillé. Filtre ">0" = à commander', align: 'right', placeholder: '>0', val: (a, c) => { const p = propDe(c, a); return p && p.declenche ? p.qteProposee : null } },
  { key: 'retenue', label: 'Qté retenue', groupe: 'Commande', title: 'Quantité de la commande : saisis pour remplacer la proposition (vide = proposition). C\'est elle qui part dans les fichiers commande', align: 'right', placeholder: '>0', val: (a, c) => { const p = propDe(c, a); return p ? (p.qteFinale > 0 ? p.qteFinale : null) : null } },
  { key: 'date_liv', label: 'Liv. souhaitée', groupe: 'Commande', title: 'Date de livraison souhaitée (défaut = aujourd\'hui + délai d\'appro). Un fichier commande par fournisseur et par date', align: 'right', placeholder: '2026-', val: (a, c) => propDe(c, a)?.dateSouhaitee ?? null },
  { key: 'montant', label: 'Montant', groupe: 'Commande', title: 'Montant HT de la quantité commandée (tarif par quantité, sinon prix d\'achat fournisseur)', align: 'right', placeholder: '>0', val: (a, c) => { const p = propDe(c, a); const px = prixUnitaire(a, c.tarifs.get(a.reference_article)); return p && p.qteFinale > 0 && px !== null ? Math.round(p.qteFinale * px * 100) / 100 : null } },
  { key: 'prix_qte', label: 'Prix achat', groupe: 'Tarif', title: 'Tarif d\'achat par quantité du fournisseur principal : prix de la quantité commandée. Survole pour les paliers', align: 'right', placeholder: '!vide', val: (a, c) => c.tarifs.get(a.reference_article)?.prixActuel ?? null },
  { key: 'palier_suivant', label: 'Palier suivant', groupe: 'Tarif', title: 'Quantité additionnelle pour le premier tarif inférieur, couverture ajoutée, prix et économie', align: 'right', placeholder: '>0', val: (a, c) => c.tarifs.get(a.reference_article)?.suivant?.qteAdd ?? null },
  { key: 'paliers_plus', label: 'Paliers +', groupe: 'Tarif', title: 'Tarifs encore plus avantageux au-delà du palier suivant', align: 'left', placeholder: '>0', val: (a, c) => c.tarifs.get(a.reference_article)?.autres.length || null },
]
const COLONNES_MASQUEES_DEFAUT = ['min_sage', 'min_blg', 'sigma', 'paliers_plus', 'derniere_sortie']
const COULEUR_GROUPE: Record<GroupeCol, string> = {
  'Article': 'bg-[#EDEAE1] text-[#3A362E]',
  'Paramètres d’appro': 'bg-[#FFF4DC] text-[#8A5A08]',
  'Conso': 'bg-[#EFEAF6] text-[#5B4384]',
  'Projection à réception': 'bg-[#E8F0F6] text-[#2F5D80]',
  'Stocks min / max': 'bg-[#EDEAE1] text-[#5E5A44]',
  'Commande': 'bg-[#FBE9E4] text-[#9A3D22]',
  'Tarif': 'bg-[#E7F3EA] text-[#2F6B3C]',
}

/** Cellules « Prix achat », « Palier suivant » et « Paliers + avantageux » (tarifs d'achat par quantité). */
function CellulesTarifQte({ t, colonnes }: { t: AnalyseTarif | undefined; colonnes: Set<CleColArt> }) {
  const vide = (k: string) => <td key={k} className="px-2 py-1 text-right text-[#B3AD9E]">—</td>
  if (!t) return <>{colonnes.has('prix_qte') && vide('p')}{colonnes.has('palier_suivant') && vide('s')}{colonnes.has('paliers_plus') && vide('a')}</>
  const titre = titreTarif(t)
  const opt = (o: OptionPalier, fort: boolean) => (
    <div className="leading-tight" title={libOption(o)}>
      <span className={fort ? 'font-bold text-[#111820]' : 'font-semibold text-[#3A362E]'}>+{fmtNum(o.qteAdd)}</span>
      <span className="text-[10px] text-[#8A8474]"> → {fmtNum(o.qteTotale)} · {fmtEuro2(o.prix)}</span>
      <div className="text-[10px] text-[#8A8474]">{o.couvAddMois !== null ? `+${fmtNum(o.couvAddMois, 1)} mois` : 'μ = 0'} · <span className="font-semibold text-emerald-700">éco. {fmtEuro(o.economie)}</span></div>
    </div>
  )
  return (
    <>
      {colonnes.has('prix_qte') && (
        <td className="px-2 py-1 text-right" title={titre}>
          <span className={t.qteBase > 0 ? 'font-semibold text-[#111820]' : 'text-[#8A8474]'}>{fmtEuro2(t.prixActuel)}</span>
          <div className="text-[10px] text-[#8A8474]">{t.paliers.length} palier{t.paliers.length > 1 ? 's' : ''}</div>
        </td>
      )}
      {colonnes.has('palier_suivant') && (
        <td className="px-2 py-1 text-right" title={t.suivant ? `${titre}\n\nPalier suivant : ${libOption(t.suivant)}` : titre}>
          {t.qteBase <= 0 ? <span className="text-[10px] text-[#B3AD9E]">pas de commande</span> : t.suivant ? opt(t.suivant, true) : <span className="text-[10px] font-semibold text-emerald-700">meilleur prix ✓</span>}
        </td>
      )}
      {colonnes.has('paliers_plus') && (
        <td className="px-2 py-1" title={t.autres.length ? `${titre}\n\nTarifs plus avantageux :\n${t.autres.map((o) => '• ' + libOption(o)).join('\n')}` : titre}>
          {t.qteBase > 0 && t.autres.length ? <div className="flex flex-col gap-1">{t.autres.map((o, i) => <div key={i}>{opt(o, false)}</div>)}</div> : <span className="text-[#B3AD9E]">—</span>}
        </td>
      )}
    </>
  )
}

/** Filtre d'en-tête d'une colonne : quelques colonnes cherchent aussi dans un libellé. */
function filtreColArtOk(a: ArtRow, key: CleColArt, expr: string, ctx: CtxColArt): boolean {
  const col = COLONNES_ARTICLES.find((c) => c.key === key)!
  if (filtreColonneOk(col.val(a, ctx), expr)) return true
  if (key === 'reference') return filtreColonneOk(a.sage_designation, expr)
  if (key === 'fourn') return filtreColonneOk(a.fournisseur_principal ? ctx.fournMap.get(a.fournisseur_principal)?.sage_intitule : null, expr)
  if (key === 'inc') return filtreColonneOk((ctx.incoherencesParRef.get(a.reference_article) || []).map((k) => LABEL_INCOHERENCE_ARTICLE[k]?.label || k).join(' ; '), expr)
  if (key === 'conso') { const p = propDe(ctx, a); return p ? filtreColonneOk(CONSO_PAR_CODE[p.muSource].label, expr) : false }
  return false
}

/** Surcharges article d'un paramètre d'appro (colonnes de appro_article_stock_min). */
type PatchSurcharge = Partial<{
  strategie_appro: string | null; methode_calcul: MethodeCalcul | null
  couverture_min_mois: number | null; couverture_cible_mois: number | null
  conso_source: ConsoSource | null; conso_coef: number | null
  delai_appro_ref_jours: number | null; delai_securite_ref_jours: number | null
}>

/** Une ligne du tableau — mémorisée : seule la ligne modifiée se redessine. */
const LigneArticle = React.memo(function LigneArticle({ a, p, t, f, incs, colonnes, profilsOk, onOuvrirArticle, onOuvrirFournisseur, onEditer, onSurcharge, onPropositionSaved }: {
  a: ArtRow; p: Proposition; t: AnalyseTarif | undefined; f: FournRow | undefined; incs: string[]; colonnes: Set<CleColArt>; profilsOk: boolean
  onOuvrirArticle: (ref: string) => void; onOuvrirFournisseur: (numero: string) => void; onEditer: (ref: string) => void
  onSurcharge: (a: ArtRow, p: Proposition, patch: PatchSurcharge) => void; onPropositionSaved: (a: ArtRow) => void
}) {
  const ref = a.reference_article
  const e = p.eff
  const ecart = (a.champs_en_ecart || []).includes('stock_min')
  const sousMin = p.qteFinale > 0
  const incRouge = incs.some((k) => LABEL_INCOHERENCE_ARTICLE[k]?.gravite === 'rouge')
  const retard = n0(a.encours_fourn_retard)
  const px = prixUnitaire(a, t)
  const montant = p.qteFinale > 0 && px !== null ? p.qteFinale * px : null
  const c = (k: CleColArt) => colonnes.has(k)
  const titreEncours = [
    a.detail_cdf ? `Commandes : ${a.detail_cdf}` : null,
    retard ? `En retard : ${fmtNum(retard)} (jusqu'à ${fmtNum(a.nb_jours_retard_max)} j)` : null,
    p.encoursDouteux ? `Douteux (exclu) : ${fmtNum(p.encoursDouteux)}` : null,
    p.encoursApres > 0 ? `Livré après le ${fmtDate(p.dateReception)} : ${fmtNum(p.encoursApres)} (non compté)` : null,
  ].filter(Boolean).join('\n')
  const estB = p.methode === 'couverture'
  return (
    <tr className={`group border-t border-[#EFECE4] hover:bg-[#FAF8F3] ${sousMin ? 'bg-red-50/40' : ''} ${a.arret_appro || p.strategieExclue ? 'opacity-70' : ''}`}>
      {c('inc') && (
        <td className="sticky left-0 z-[5] w-10 bg-white px-1.5 py-1 group-hover:bg-[#FAF8F3]" title={incs.length ? incs.map((k) => `• ${LABEL_INCOHERENCE_ARTICLE[k]?.label || k}`).join('\n') : 'Aucune incohérence'}>
          {incs.length ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${incRouge ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{incs.length}</span> : <span className="text-[#D5D0C4]">·</span>}
        </td>
      )}
      {c('reference') && (
        <td className={`sticky ${c('inc') ? 'left-10' : 'left-0'} z-[5] max-w-[300px] bg-white px-2 py-1 group-hover:bg-[#FAF8F3]`}>
          <button type="button" onClick={() => onOuvrirArticle(ref)} className="block w-full text-left" title="Consommations mensuelles, ventes anormales, écrêtage, conso retenue">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[11.5px] font-bold text-[#111820] underline decoration-[#D5D0C4] decoration-dotted underline-offset-2 group-hover:decoration-[#B4761A]">{ref}</span>
              <BlocageApproBadge article={a} compact />
              {a.sage_en_sommeil && <span className="rounded-full bg-[#F4F3F0] px-1.5 text-[9.5px] font-bold text-[#8A8474]">Sommeil</span>}
              {a.statut_appariement === 'manquant_blg' && <span className="rounded-full bg-red-50 px-1.5 text-[9.5px] font-bold text-red-700">Manquant BLG</span>}
            </span>
            <span className="block truncate text-[10.5px] text-[#5E5A50]">{a.sage_designation || '—'}</span>
          </button>
        </td>
      )}
      {c('fourn') && (
        <td className="px-2 py-1">
          {a.fournisseur_principal ? (
            <button type="button" onClick={() => onOuvrirFournisseur(a.fournisseur_principal!)} className="max-w-[130px] text-left" title={f ? `${f.sage_intitule || ''} · ${f.sage_qualite || ''}${f.sage_en_sommeil ? ' · EN SOMMEIL' : ''}\nClic : fiche fournisseur` : 'Fiche fournisseur'}>
              <span className="block font-mono text-[10.5px] font-semibold text-[#B4761A] hover:underline">{a.fournisseur_principal}{f?.sage_en_sommeil ? <span className="ml-1 text-red-700">zz</span> : null}</span>
              <span className="block truncate text-[10px] text-[#8A8474]">{f?.sage_intitule || ''}</span>
            </button>
          ) : <span className="text-[#B3AD9E]">—</span>}
        </td>
      )}
      {c('blocage') && (
        <td className="px-2 py-1 text-[11px]">
          <div className="flex flex-wrap items-center gap-1">
            {a.arret_appro && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9.5px] font-bold text-red-700">Arrêt appro</span>}
            {a.arret_vente && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9.5px] font-bold text-orange-700">Arrêt vente</span>}
            {a.ref_remplacante && <span className="rounded bg-[#F4F3F0] px-1 font-mono text-[9.5px]" title={`Référence remplaçante${a.date_effet ? ' · effet ' + fmtDate(a.date_effet) : ''}`}>→ {a.ref_remplacante}</span>}
            {!a.blocage_appro && !a.exclure_appro && !a.vie_produit && !a.arret_appro && !a.arret_vente && !a.ref_remplacante && <span className="text-[#D5D0C4]">—</span>}
          </div>
        </td>
      )}
      {c('strategie') && (
        <td className="px-1 py-1">
          <SaisieListe<string> valeur={e.strategie.v} surcharge={e.strategie.o === 'article'} base={e.strategie.base} baseO={e.strategie.baseO} disabled={!profilsOk}
            options={STRATEGIES_APPRO.map((s) => ({ v: s, l: s }))} libelle={(v) => v || '— aucune'} largeur="w-[98px]"
            onCommit={(v) => onSurcharge(a, p, { strategie_appro: v })} titre="Stratégie d'appro de l'article" />
        </td>
      )}
      {c('methode') && (
        <td className="px-1 py-1">
          {e.methode.o === 'forcée' ? <span className="rounded bg-[#FFF4DC] px-1.5 py-0.5 text-[10.5px] font-bold text-[#8A5A08]" title="Méthode forcée sur l'écran">{p.lettre} forcé</span> : (
            <SaisieListe<MethodeCalcul> valeur={e.methode.v} surcharge={e.methode.o === 'article'} base={e.methode.base} baseO={e.methode.baseO}
              options={METHODES.map((m) => ({ v: m.code, l: `${m.lettre} · ${m.code === 'min_max' ? 'Min/Max' : 'Couv.'}` }))} largeur="w-[84px]"
              onCommit={(v) => onSurcharge(a, p, { methode_calcul: v })} titre={METHODE_PAR_CODE[e.methode.v].detail} />
          )}
        </td>
      )}
      {c('couv_min') && (
        <td className="px-1 py-1 text-right">
          <SaisieNombre valeur={e.couvMin.v} surcharge={e.couvMin.o === 'article'} base={e.couvMin.base} baseO={e.couvMin.baseO} decimales={1} suffixe="m" attenue={!estB}
            onCommit={(v) => onSurcharge(a, p, { couverture_min_mois: v })} titre="Méthode B : couverture min à réception (mois)" largeur="w-10" />
        </td>
      )}
      {c('couv_cible') && (
        <td className="px-1 py-1 text-right">
          <SaisieNombre valeur={e.couvCible.v} surcharge={e.couvCible.o === 'article'} base={e.couvCible.base} baseO={e.couvCible.baseO} decimales={1} suffixe="m" attenue={!estB}
            onCommit={(v) => onSurcharge(a, p, { couverture_cible_mois: v })} titre="Méthode B : couverture cible à réception (mois)" largeur="w-10" />
        </td>
      )}
      {c('conso') && (
        <td className="px-1 py-1">
          <div className="flex items-center gap-1">
            <SaisieListe<ConsoSource> valeur={e.conso.v} surcharge={e.conso.o === 'article'} base={e.conso.base} baseO={e.conso.baseO} disabled={!profilsOk}
              options={CONSO_SOURCES.map((s) => ({ v: s.code, l: s.court }))} largeur="w-[92px]"
              onCommit={(v) => onSurcharge(a, p, v === 'fut3_coef' ? { conso_source: v, conso_coef: e.coef.o === 'article' ? e.coef.v : 1.1 } : { conso_source: v, conso_coef: null })}
              titre={`${CONSO_PAR_CODE[e.conso.v].label}\nμ 12 m ${fmtNum(p.mu12, 1)} · μ 3 m ${fmtNum(p.mu3, 1)} · N−1 3 prochains mois ${fmtNum(p.muFut3, 1)}`} />
            {e.conso.v === 'fut3_coef' && (
              <SaisieNombre valeur={Math.round(e.coef.v * 100)} surcharge={e.coef.o === 'article'} base={Math.round(e.coef.base * 100)} baseO={e.coef.baseO} suffixe="%" largeur="w-11" disabled={!profilsOk}
                onCommit={(v) => onSurcharge(a, p, { conso_source: 'fut3_coef', conso_coef: v === null ? null : v / 100 })} titre="Coefficient appliqué à la conso N−1 des 3 prochains mois" />
            )}
          </div>
          <div className={`pl-1 text-[10px] ${e.conso.o === 'article' ? 'font-bold text-[#8A5A08]' : 'text-[#8A8474]'}`}>μ {fmtNum(p.mu, 1)}/mois</div>
        </td>
      )}
      {c('delai_appro') && (
        <td className="px-1 py-1 text-right">
          <SaisieNombre valeur={e.delaiAppro.v} surcharge={e.delaiAppro.o === 'article'} base={e.delaiAppro.base} baseO={e.delaiAppro.baseO} suffixe="j" largeur="w-10"
            onCommit={(v) => onSurcharge(a, p, { delai_appro_ref_jours: v })} titre="Délai d'appro (jours calendaires)" />
        </td>
      )}
      {c('delai_secu') && (
        <td className="px-1 py-1 text-right">
          <SaisieNombre valeur={e.delaiSecu.v} surcharge={e.delaiSecu.o === 'article'} base={e.delaiSecu.base} baseO={e.delaiSecu.baseO} suffixe="j" largeur="w-9"
            onCommit={(v) => onSurcharge(a, p, { delai_securite_ref_jours: v })} titre="Délai de sécurité (jours calendaires)" />
        </td>
      )}
      {c('delai_l') && <td className={`px-2 py-1 text-right ${e.delaiAppro.o === 'article' || e.delaiSecu.o === 'article' ? 'font-bold text-[#8A5A08]' : 'text-[#5E5A50]'}`}>{fmtNum(p.delaiL)}</td>}
      {c('mu12') && <td className={`px-2 py-1 text-right ${p.muSource === '12m' ? 'font-bold text-[#111820]' : 'text-[#8A8474]'}`}>{fmtNum(p.mu12, 1)}</td>}
      {c('mu3') && <td className={`px-2 py-1 text-right ${p.muSource === '3m' ? 'font-bold text-[#111820]' : 'text-[#8A8474]'}`} title={p.mu12 > 0 ? `${p.mu3 >= p.mu12 ? '+' : ''}${Math.round((p.mu3 / p.mu12 - 1) * 100)} % vs μ 12 mois` : undefined}>{fmtNum(p.mu3, 1)}</td>}
      {c('fut3') && <td className={`px-2 py-1 text-right ${p.muSource === 'fut3' || p.muSource === 'fut3_coef' ? 'font-bold text-[#111820]' : 'text-[#8A8474]'}`}>{fmtNum(p.muFut3, 1)}</td>}
      {c('sigma') && <td className="px-2 py-1 text-right text-[#8A8474]">{fmtNum(p.sigma, 1)}</td>}
      {c('derniere_sortie') && <td className="px-2 py-1 text-right text-[#5E5A50]">{fmtMois(a.sage_derniere_sortie)}</td>}
      {c('dispo') && (
        <td className="px-2 py-1 text-right" title={`Disponible SAGE — global : ${fmtNum(a.sage_stock_dispo_total)} · FMS : ${fmtNum(a.stock_dispo_sage_fms)} · agences : ${fmtNum(a.stock_dispo_sage_agences)}\nPhysique — global : ${fmtNum(a.sage_stock_total)} · FMS : ${fmtNum(a.sage_stock_fms)}`}>
          <span className="font-semibold text-[#111820]">{fmtNum(a.sage_stock_dispo_total)}</span><span className="ml-1 text-[10px] text-[#8A8474]">({fmtNum(a.stock_dispo_sage_fms)})</span>
        </td>
      )}
      {c('encours') && (
        <td className="px-2 py-1 text-right" title={titreEncours || undefined}>
          {p.encoursPeriode > 0 || p.encoursDouteux > 0 || p.encoursApres > 0 ? (
            <span className={retard > 0 ? 'font-semibold text-[#96600F]' : 'font-semibold text-[#111820]'}>
              {fmtNum(p.encoursPeriode)}{retard > 0 ? ' ⏱' : ''}{p.encoursApres > 0 ? <span className="ml-1 text-[10px] font-normal text-[#8A8474]">({fmtNum(p.encoursApres)})</span> : null}{p.encoursDouteux > 0 ? <span className="ml-1 text-[10px] text-[#B3AD9E]">+{fmtNum(p.encoursDouteux)}?</span> : null}
            </span>
          ) : <span className="text-[#D5D0C4]">—</span>}
        </td>
      )}
      {c('reserve') && (
        <td className="px-2 py-1 text-right" title={`Réservé SAGE daté à livrer d'ici le ${fmtDate(p.dateReception)} : ${fmtNum(p.reservePeriode)} · après : ${fmtNum(p.reserveApres)} · total : ${fmtNum(p.reserveTotal)}`}>
          {p.reservePeriode > 0 || p.reserveApres > 0 ? <><span className="font-semibold text-[#111820]">{fmtNum(p.reservePeriode)}</span>{p.reserveApres > 0 ? <span className="ml-1 text-[10px] text-[#8A8474]">({fmtNum(p.reserveApres)})</span> : null}</> : <span className="text-[#D5D0C4]">—</span>}
        </td>
      )}
      {c('projete') && (
        <td className={`px-2 py-1 text-right font-semibold ${p.stockReception < 0 ? 'bg-red-50 text-red-800' : p.declenche ? 'text-red-700' : 'text-[#111820]'}`} title={p.explication.join('\n')}>
          {fmtNum(p.stockReception)}{p.stockReception < 0 ? ' ⚠' : ''}
          <div className="text-[9.5px] font-normal text-[#8A8474]">{fmtDate(p.dateReception)}</div>
        </td>
      )}
      {c('couv') && <td className={`px-2 py-1 text-right font-semibold ${estB && p.couvReception !== null && p.couvReception < p.couvMin ? 'text-red-700' : 'text-[#111820]'}`}>{p.couvReception === null ? '—' : fmtNum(p.couvReception, 1)}</td>}
      {c('ss') && <td className={`px-2 py-1 text-right ${p.recalcule ? 'font-semibold text-[#8A5A08]' : 'text-[#8A8474]'}`} title={p.recalcule ? `Recalculé sur la ligne (dernier calcul : ${fmtNum(a.calc_stock_securite)})` : undefined}>{fmtNum(p.ss)}</td>}
      {c('min_calc') && <td className={`px-2 py-1 text-right font-bold ${p.recalcule ? 'text-[#8A5A08]' : ''}`} title={p.recalcule ? `Recalculé sur la ligne (dernier calcul : ${fmtNum(a.calc_stock_min)})` : undefined}>{fmtNum(p.minEff)}</td>}
      {c('max_calc') && <td className={`px-2 py-1 text-right ${p.recalcule ? 'font-semibold text-[#8A5A08]' : 'text-[#8A8474]'}`} title={p.recalcule ? `Recalculé sur la ligne (dernier calcul : ${fmtNum(a.calc_stock_max)})` : undefined}>{fmtNum(p.maxEff)}</td>}
      {c('min_sage') && <td className="px-2 py-1 text-right text-[#8A8474]">{fmtNum(a.sage_stock_min_fms)}</td>}
      {c('min_blg') && <td className={`px-2 py-1 text-right ${ecart ? 'bg-red-50 font-semibold text-red-800' : 'text-[#8A8474]'}`}>{fmtNum(a.blg_stock_min_fms)}</td>}
      {c('retenu') && (
        <td className="px-2 py-1 text-right">
          <button type="button" title={a.commentaire_stock_min || 'Stock min retenu, délais, arrêt appro / vente, remplaçante'} onClick={() => onEditer(ref)}
            className={`rounded px-2 py-0.5 font-mono ${aValeur(a.stock_min_retenu) ? 'bg-[#FFF4DC] font-bold text-[#8A5A08]' : 'text-[#B3AD9E] hover:bg-[#F4F3F0]'}`}>
            {aValeur(a.stock_min_retenu) ? fmtNum(a.stock_min_retenu) : '✎'}
          </button>
        </td>
      )}
      {c('proposition') && (
        <td className="px-2 py-1 text-right" title={p.explication.join('\n')}>
          {p.declenche ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-700">{fmtNum(p.qteProposee)}</span> : (p.bloque || p.strategieExclue) && a.pertinent_calcul_besoin ? <span className="text-[10px] font-bold text-red-700">⛔</span> : <span className="text-[#D5D0C4]">—</span>}
        </td>
      )}
      {(c('retenue') || c('date_liv')) && <CelluleProposition article={a} prop={p} onSaved={onPropositionSaved} avecQte={c('retenue')} avecDate={c('date_liv')} />}
      {c('montant') && <td className="px-2 py-1 text-right font-semibold text-[#111820]" title={px !== null ? `${fmtNum(p.qteFinale)} × ${fmtEuro2(px)}` : 'Prix d\'achat inconnu'}>{montant !== null ? fmtEuro(montant) : p.qteFinale > 0 ? <span className="text-[10px] font-bold text-[#B4761A]">sans prix</span> : <span className="text-[#D5D0C4]">—</span>}</td>}
      <CellulesTarifQte t={t} colonnes={colonnes} />
    </tr>
  )
})

/** Caches de calcul (par objet) : une ligne n'est recalculée que si son article, son profil ou le contexte change. */
type GroupeArticles = { id: string; nom: string; description: string | null; references_articles: string[] }
/** Références collées : séparateurs espace, virgule, point-virgule, retour ligne, tabulation. */
function parserReferences(texte: string): string[] {
  return Array.from(new Set(texte.split(/[\s,;]+/).map((r) => r.trim().toUpperCase()).filter(Boolean)))
}

/** Fenêtre « groupe à la volée » : nom, références collées ou reprises de la sélection filtrée, enregistrement facultatif. */
function GroupeEditeurModal({ initial, selectionFiltree, articlesConnus, onAppliquer, onEnregistre, onSupprime, onClose }: {
  initial: { id: string | null; nom: string; description: string; refs: string[] }
  selectionFiltree: string[]
  articlesConnus: Set<string>
  onAppliquer: (nom: string, refs: string[]) => void
  onEnregistre: (g: GroupeArticles) => void
  onSupprime: (id: string) => void
  onClose: () => void
}) {
  const [nom, setNom] = useState(initial.nom)
  const [description, setDescription] = useState(initial.description)
  const [texte, setTexte] = useState(initial.refs.join('\n'))
  const [msg, setMsg] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const refs = useMemo(() => parserReferences(texte), [texte])
  const inconnues = refs.filter((r) => !articlesConnus.has(r))

  async function enregistrer() {
    if (!nom.trim() || refs.length === 0) { setMsg('Un nom et au moins une référence sont nécessaires.'); return }
    setEnCours(true); setMsg(null)
    const payload = { nom: nom.trim(), description: description.trim() || null, references_articles: refs }
    const res = initial.id
      ? await supabase.from('stock_groupes_articles').update(payload).eq('id', initial.id).select('id,nom,description,references_articles').single()
      : await supabase.from('stock_groupes_articles').insert(payload).select('id,nom,description,references_articles').single()
    setEnCours(false)
    if (res.error) { setMsg(messageErreur(res.error)); return }
    onEnregistre(res.data as GroupeArticles)
  }
  async function supprimer() {
    if (!initial.id || !window.confirm(`Supprimer le groupe « ${initial.nom} » ? (les scénarios de plan d'appro sont conservés)`)) return
    const { error } = await supabase.from('stock_groupes_articles').delete().eq('id', initial.id)
    if (error) { setMsg(messageErreur(error)); return }
    onSupprime(initial.id)
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[#0B1220]/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-[620px] rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-[#111820]">{initial.id ? 'Modifier le groupe' : 'Groupe de références à la volée'}</h3>
          <button type="button" onClick={onClose} className="text-[13px] font-bold text-[#8A8474]">✕</button>
        </div>
        <p className="mb-2 text-[12px] text-[#8A8474]">Le groupe restreint le tableau et les indicateurs de l’écran à ces références, et sert de périmètre au plan d’appro. « Appliquer » l’utilise tout de suite sans l’enregistrer ; « Enregistrer » le rend disponible pour tous (écran Disponibilité par groupe compris).</p>
        <div className="grid gap-2">
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom du groupe (ex. Opération Hitachi 2027)" className="h-9 rounded-md border border-[#E5E1D8] px-2 text-[13px] font-semibold outline-none focus:border-[#B4761A]" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (facultatif)" className="h-8 rounded-md border border-[#E5E1D8] px-2 text-[12px] outline-none focus:border-[#B4761A]" />
          <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={10} placeholder="Références : une par ligne, ou séparées par des espaces / virgules / points-virgules" className="rounded-md border border-[#E5E1D8] p-2 font-mono text-[12px] outline-none focus:border-[#B4761A]" />
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="font-bold text-[#3A362E]">{refs.length} référence{refs.length > 1 ? 's' : ''}</span>
            {inconnues.length > 0 && <span className="font-semibold text-orange-700" title={inconnues.join(', ')}>{inconnues.length} absente{inconnues.length > 1 ? 's' : ''} du calcul de besoin : {inconnues.slice(0, 4).join(', ')}{inconnues.length > 4 ? '…' : ''}</span>}
            <button type="button" onClick={() => setTexte(selectionFiltree.join('\n'))} disabled={!selectionFiltree.length} className="ml-auto rounded-md border border-[#E5E1D8] px-2 py-1 font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-50">Reprendre la sélection filtrée ({selectionFiltree.length})</button>
          </div>
          {msg && <div className="rounded-md bg-red-50 px-2 py-1.5 text-[12px] font-semibold text-red-800">{msg}</div>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {initial.id && <button type="button" onClick={() => void supprimer()} className="h-8 rounded-md border border-red-200 px-3 text-[12px] font-bold text-red-700 hover:bg-red-50">Supprimer</button>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => { if (refs.length) onAppliquer(nom.trim() || 'Groupe à la volée', refs) }} disabled={!refs.length} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-3 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-50">Appliquer sans enregistrer</button>
              <button type="button" onClick={() => void enregistrer()} disabled={enCours} className="h-8 rounded-md bg-[#111820] px-3 text-[12px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">{enCours ? 'Enregistrement…' : 'Enregistrer le groupe'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const cacheProposition = new WeakMap<ArtRow, { pr: ProfilConso | undefined; ctx: object; p: Proposition }>()
const cacheTarif = new WeakMap<Proposition, { paliers: PalierTarif[]; lecture: LectureBornes; t: AnalyseTarif | null }>()

function OngletCalculBesoin({ articles, fournisseurs, paramsFourn, profils, profilsOk, strategies, loading, loadProgress, error, parametres, onParametresChange, onArticleChange, onArticlePatch, onProfilPatch, onProfilSet, onFournisseurChange, onStrategieSaved, onRecharger }: {
  articles: ArtRow[]; fournisseurs: FournRow[]; paramsFourn: Map<string, ParamsFourn>; profils: Map<string, ProfilConso>; profilsOk: boolean
  strategies: StrategieRef[]; loading: boolean; loadProgress: number; error: string | null
  parametres: Parametre[]; onParametresChange: (p: Parametre[]) => void
  onArticleChange: (a: ArtRow) => void; onArticlePatch: (ref: string, patch: Partial<ArtRow>) => void; onProfilPatch: (ref: string, patch: Partial<ProfilConso>) => void; onProfilSet: (p: ProfilConso) => void
  onFournisseurChange: (f: FournRow) => void; onStrategieSaved: () => void; onRecharger: () => Promise<void>
}) {
  // Forçage de la méthode de réappro sur l'écran ('' = selon référence / fournisseur / défaut) — mémorisé
  const [methodeForcee, setMethodeForcee] = useState<'' | MethodeCalcul>(() => { try { const v = localStorage.getItem('appro.articles.methode_forcee'); return v === 'min_max' || v === 'couverture' ? v : '' } catch { return '' } })
  useEffect(() => { try { localStorage.setItem('appro.articles.methode_forcee', methodeForcee) } catch { /* ignore */ } }, [methodeForcee])
  const [colonnesMasquees, setColonnesMasquees] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('appro.calcul_besoin.colonnes_masquees'); return new Set(s ? JSON.parse(s) : COLONNES_MASQUEES_DEFAUT) } catch { return new Set(COLONNES_MASQUEES_DEFAUT) }
  })
  useEffect(() => { try { localStorage.setItem('appro.calcul_besoin.colonnes_masquees', JSON.stringify(Array.from(colonnesMasquees))) } catch { /* ignore */ } }, [colonnesMasquees])
  const [menuColonnes, setMenuColonnes] = useState(false)
  const [voirIncoherences, setVoirIncoherences] = useState(false)
  const [exportCommandesEnCours, setExportCommandesEnCours] = useState(false)
  const [exportEnCours, setExportEnCours] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'ko'; texte: string } | null>(null)
  const [search, setSearch] = useState('')
  const [fournFilter, setFournFilter] = useState('')
  const [familleFilter, setFamilleFilter] = useState('')
  const [pertinentsSeuls, setPertinentsSeuls] = useState(true)
  const [avecConsoSeuls, setAvecConsoSeuls] = useState(false)
  const [ecartMinSeuls, setEcartMinSeuls] = useState(false)
  const [aCommanderSeuls, setACommanderSeuls] = useState(false)
  const [avecEncoursSeuls, setAvecEncoursSeuls] = useState(false)
  const [surchargesSeules, setSurchargesSeules] = useState(false)
  const [qualiteFilter, setQualiteFilter] = useState('')
  const [strategieFilter, setStrategieFilter] = useState('')
  const [sommeilFilter, setSommeilFilter] = useState<'tous' | 'oui' | 'non'>('tous')
  const [arretApproFilter, setArretApproFilter] = useState<'tous' | 'oui' | 'non'>('tous')
  const [blocageFilter, setBlocageFilter] = useState<'tous' | 'oui' | 'non' | 'exclu' | 'findevie'>('tous')
  const [importBlocageEnCours, setImportBlocageEnCours] = useState(false)
  const inputCsvBlocage = useRef<HTMLInputElement | null>(null)
  const [incoherenceFilter, setIncoherenceFilter] = useState<string | null>(null)
  const [tri, setTri] = useState<'fournisseur' | 'conso' | 'ecart' | 'couverture' | 'reference' | 'a_commander' | 'montant' | 'projete' | 'incoherences'>('fournisseur')
  const [triCol, setTriCol] = useState<EtatTri<CleColArt>>(null)
  const [filtresCol, setFiltresCol] = useState<FiltresColArt>({})
  const [editRef, setEditRef] = useState<string | null>(null)
  const [articleRef, setArticleRef] = useState<string | null>(null)
  const [fournNumero, setFournNumero] = useState<string | null>(null)
  const [recalculEnCours, setRecalculEnCours] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const [paramsDraft, setParamsDraft] = useState<Record<string, string>>({})
  const [tarifsRows, setTarifsRows] = useState<PalierTarif[]>([])
  const [tarifsErreur, setTarifsErreur] = useState<string | null>(null)
  const [nbAffichees, setNbAffichees] = useState(300)
  // Groupes de références (stock_groupes_articles) et groupe à la volée — restreignent tableau ET indicateurs
  const [groupes, setGroupes] = useState<GroupeArticles[]>([])
  const [groupeId, setGroupeId] = useState<string>(() => { try { return localStorage.getItem('appro.calcul_besoin.groupe') || '' } catch { return '' } })
  const [groupeAdHoc, setGroupeAdHoc] = useState<{ nom: string; refs: string[] } | null>(null)
  const [editeurGroupe, setEditeurGroupe] = useState<{ id: string | null; nom: string; description: string; refs: string[] } | null>(null)
  const [planOuvert, setPlanOuvert] = useState(false)

  useEffect(() => {
    let annule = false
    void supabase.from('v_appro_tarif_qte_fournisseur').select('*').order('reference_article').order('fournisseur').order('borne_sup').limit(10000).then(({ data, error }) => {
      if (annule) return
      if (error) setTarifsErreur(messageErreur(error))
      else setTarifsRows((data || []) as PalierTarif[])
    })
    return () => { annule = true }
  }, [])
  useEffect(() => {
    let annule = false
    void supabase.from('stock_groupes_articles').select('id,nom,description,references_articles').order('nom').then(({ data }) => {
      if (!annule) setGroupes(((data || []) as GroupeArticles[]).map((g) => ({ ...g, references_articles: (g.references_articles || []).map((r) => r.toUpperCase()) })))
    })
    return () => { annule = true }
  }, [])
  useEffect(() => { try { localStorage.setItem('appro.calcul_besoin.groupe', groupeId === '__adhoc' ? '' : groupeId) } catch { /* ignore */ } }, [groupeId])
  useEffect(() => { setParamsDraft(Object.fromEntries(parametres.map((p) => [p.cle, String(p.valeur)]))) }, [parametres])
  useEffect(() => { if (!message || message.type === 'ko') return; const t = setTimeout(() => setMessage(null), 6000); return () => clearTimeout(t) }, [message])

  const fournMap = useMemo(() => new Map(fournisseurs.map((f) => [f.numero, f])), [fournisseurs])
  const fournOptions = useMemo(() => Array.from(new Set(articles.map((a) => a.fournisseur_principal).filter(Boolean) as string[])).sort().map((n) => ({ numero: n, label: fournMap.get(n)?.sage_intitule || n })), [articles, fournMap])
  const familleOptions = useMemo(() => Array.from(new Set(articles.map((a) => safeText(a.famille)).filter(Boolean))).sort(), [articles])
  const qualiteOptions = useMemo(() => Array.from(new Set(fournisseurs.map((f) => safeText(f.sage_qualite)).filter(Boolean))).sort(), [fournisseurs])
  const indexArticles = useMemo(() => new Map(articles.map((a) => [a.reference_article.toUpperCase(), a])), [articles])
  const articleParRef = useMemo(() => new Map(articles.map((a) => [a.reference_article, a])), [articles])
  const incoherencesParRef = useMemo(() => {
    const m = new Map<string, string[]>()
    articles.forEach((a) => m.set(a.reference_article, detecterIncoherencesArticle(a, a.fournisseur_principal ? fournMap.get(a.fournisseur_principal) : undefined, indexArticles)))
    return m
  }, [articles, fournMap, indexArticles])

  const ctxBase = useMemo<Omit<ContexteProposition, 'profils'>>(() => ({
    paramsFourn, methodeForcee,
    methodeDefaut: valParam(parametres, 'methode_calcul_defaut', 1) === 2 ? 'couverture' : 'min_max',
    couvMinDefaut: valParam(parametres, 'couverture_min_defaut_mois', 2), couvCibleDefaut: valParam(parametres, 'couverture_cible_defaut_mois', 3),
    consoSourceDefaut: valParam(parametres, 'projection_mu_source', 0) === 1 ? '3m' : '12m',
    delaiDefaut: valParam(parametres, 'delai_appro_defaut_jours', 30), secuDefaut: valParam(parametres, 'delai_securite_defaut_jours', 7),
    zDefaut: valParam(parametres, 'niveau_service_z', 1.65), revueJours: valParam(parametres, 'periode_revue_jours', 30),
    retardMaxJours: valParam(parametres, 'cdf_retard_max_jours', 60),
    aujourdhui: isoLocal(new Date()),
    frequenceApproJours: valParam(parametres, 'frequence_appro_mystock_jours', 30),
    seuilInclutDelaiAppro: valParam(parametres, 'seuil_a_inclut_delai_appro', 0) === 1,
  }), [paramsFourn, methodeForcee, parametres])
  const ctxProp = useMemo<ContexteProposition>(() => ({ ...ctxBase, profils }), [ctxBase, profils])

  // Propositions : recalcul incrémental — seule la référence modifiée (article ou profil) est recalculée,
  // sauf changement de contexte (paramètres, forçage, fournisseurs) : cache par objet article (cacheProposition).
  const propositions = useMemo(() => {
    const out = new Map<string, Proposition>()
    articles.forEach((a) => {
      const pr = profils.get(a.reference_article)
      const hit = cacheProposition.get(a)
      if (hit && hit.pr === pr && hit.ctx === ctxBase) { out.set(a.reference_article, hit.p); return }
      const p = calculerProposition(a, ctxProp)
      cacheProposition.set(a, { pr, ctx: ctxBase, p })
      out.set(a.reference_article, p)
    })
    return out
  }, [articles, profils, ctxBase, ctxProp])

  const lectureBornes: LectureBornes = valParam(parametres, 'tarif_qte_lecture_bornes', 0) === 1 ? 1 : 0
  const paliersParCle = useMemo(() => {
    const m = new Map<string, PalierTarif[]>()
    tarifsRows.forEach((t) => {
      const cle = `${safeText(t.reference_article).toUpperCase()}|${safeText(t.fournisseur).toUpperCase()}`
      if (!m.has(cle)) m.set(cle, [])
      m.get(cle)!.push({ ...t, borne_precedente: Number(t.borne_precedente), borne_sup: Number(t.borne_sup), prix_net: Number(t.prix_net) })
    })
    m.forEach((l) => l.sort((x, y) => x.borne_sup - y.borne_sup))
    return m
  }, [tarifsRows])
  const tarifs = useMemo(() => {
    const m = new Map<string, AnalyseTarif>()
    if (!paliersParCle.size) return m
    articles.forEach((a) => {
      if (!a.fournisseur_principal) return
      const paliers = paliersParCle.get(`${a.reference_article.toUpperCase()}|${a.fournisseur_principal.toUpperCase()}`)
      const p = propositions.get(a.reference_article)
      if (!paliers || !p) return
      const hit = cacheTarif.get(p)
      let t: AnalyseTarif | null
      if (hit && hit.paliers === paliers && hit.lecture === lectureBornes) t = hit.t
      else { t = analyserTarif(a, p, paliers, lectureBornes); cacheTarif.set(p, { paliers, lecture: lectureBornes, t }) }
      if (t) m.set(a.reference_article, t)
    })
    return m
  }, [articles, propositions, paliersParCle, lectureBornes])
  const ctxCol = useMemo<CtxColArt>(() => ({ fournMap, incoherencesParRef, propositions, tarifs }), [fournMap, incoherencesParRef, propositions, tarifs])
  const groupeActif = useMemo<{ id: string | null; nom: string; refs: string[] } | null>(() => {
    if (groupeId === '__adhoc') return groupeAdHoc ? { id: null, nom: groupeAdHoc.nom, refs: groupeAdHoc.refs } : null
    const g = groupes.find((x) => x.id === groupeId)
    return g ? { id: g.id, nom: g.nom, refs: g.references_articles } : null
  }, [groupeId, groupeAdHoc, groupes])
  const refsGroupe = useMemo(() => (groupeActif ? new Set(groupeActif.refs.map((r) => r.toUpperCase())) : null), [groupeActif])
  const refsGroupeAbsentes = useMemo(() => (groupeActif ? groupeActif.refs.filter((r) => !indexArticles.has(r.toUpperCase())) : []), [groupeActif, indexArticles])
  const clesFiltreCol = useMemo(() => (Object.keys(filtresCol) as CleColArt[]).filter((k) => (filtresCol[k] || '').trim()), [filtresCol])
  function setFiltreCol(k: CleColArt, v: string) { setFiltresCol((f) => ({ ...f, [k]: v })) }
  const aSurcharge = (p: Proposition | undefined) => !!p && (['strategie', 'methode', 'couvMin', 'couvCible', 'conso', 'coef', 'delaiAppro', 'delaiSecu'] as const).some((k) => p.eff[k].o === 'article')

  /** Jeu filtré (filtres généraux + filtres d'en-tête, hors pastille d'incohérence) : base des indicateurs. */
  const baseFiltree = useMemo(() => {
    const term = search.trim().toUpperCase()
    return articles.filter((a) => {
      const f = a.fournisseur_principal ? fournMap.get(a.fournisseur_principal) : undefined
      const p = propositions.get(a.reference_article)
      if (refsGroupe && !refsGroupe.has(a.reference_article.toUpperCase())) return false
      if (!refsGroupe && pertinentsSeuls && !a.pertinent_calcul_besoin) return false
      if (avecConsoSeuls && !(Number(a.conso_horizon) > 0)) return false
      if (ecartMinSeuls && !(a.champs_en_ecart || []).includes('stock_min')) return false
      if (aCommanderSeuls && !(p?.qteFinale ?? 0)) return false
      if (avecEncoursSeuls && !(n0(a.encours_fourn_total) > 0)) return false
      if (surchargesSeules && !aSurcharge(p)) return false
      if (fournFilter && a.fournisseur_principal !== fournFilter) return false
      if (familleFilter && safeText(a.famille) !== familleFilter) return false
      if (qualiteFilter && safeText(f?.sage_qualite) !== qualiteFilter) return false
      const strat = p?.eff.strategie.v || ''
      if (strategieFilter === '__none' ? !!strat : strategieFilter && strat !== strategieFilter) return false
      if (sommeilFilter !== 'tous' && !!a.sage_en_sommeil !== (sommeilFilter === 'oui')) return false
      if (arretApproFilter !== 'tous' && !!a.arret_appro !== (arretApproFilter === 'oui')) return false
      if (blocageFilter === 'oui' && !a.blocage_appro) return false
      if (blocageFilter === 'non' && a.blocage_appro) return false
      if (blocageFilter === 'exclu' && !a.exclure_appro) return false
      if (blocageFilter === 'findevie' && !a.vie_produit) return false
      if (term && !(a.reference_article.toUpperCase().includes(term) || (a.sage_designation || '').toUpperCase().includes(term))) return false
      for (const k of clesFiltreCol) if (!filtreColArtOk(a, k, filtresCol[k]!, ctxCol)) return false
      return true
    })
  }, [articles, fournMap, propositions, search, fournFilter, familleFilter, pertinentsSeuls, avecConsoSeuls, ecartMinSeuls, aCommanderSeuls, avecEncoursSeuls, surchargesSeules, qualiteFilter, strategieFilter, sommeilFilter, arretApproFilter, blocageFilter, filtresCol, ctxCol, clesFiltreCol, refsGroupe])

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
      : incoherenceFilter ? baseFiltree.filter((a) => (incoherencesParRef.get(a.reference_article) || []).includes(incoherenceFilter)) : baseFiltree
    if (triCol) {
      const col = COLONNES_ARTICLES.find((c) => c.key === triCol.key)!
      return trierPar(list, triCol, (a) => col.val(a, ctxCol))
    }
    const pq = (a: ArtRow) => propositions.get(a.reference_article)
    const mt = (a: ArtRow) => { const p = pq(a); const px = prixUnitaire(a, tarifs.get(a.reference_article)); return p && px !== null ? p.qteFinale * px : 0 }
    return [...list].sort((a, b) => {
      if (tri === 'fournisseur') return (a.fournisseur_principal || '~').localeCompare(b.fournisseur_principal || '~') || a.reference_article.localeCompare(b.reference_article)
      if (tri === 'incoherences') return (incoherencesParRef.get(b.reference_article)?.length || 0) - (incoherencesParRef.get(a.reference_article)?.length || 0) || (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'conso') return (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'ecart') return Math.abs((b.calc_stock_min || 0) - (b.blg_stock_min_fms || 0)) - Math.abs((a.calc_stock_min || 0) - (a.blg_stock_min_fms || 0))
      if (tri === 'couverture') return (pq(a)?.couvReception ?? 999) - (pq(b)?.couvReception ?? 999)
      if (tri === 'a_commander') return (pq(b)?.qteFinale ?? 0) - (pq(a)?.qteFinale ?? 0) || (b.conso_horizon || 0) - (a.conso_horizon || 0)
      if (tri === 'montant') return mt(b) - mt(a)
      if (tri === 'projete') return (pq(a)?.stockReception ?? 0) - (pq(b)?.stockReception ?? 0)
      return a.reference_article.localeCompare(b.reference_article)
    })
  }, [baseFiltree, incoherenceFilter, incoherencesParRef, tri, triCol, ctxCol, propositions, tarifs])
  useEffect(() => { setNbAffichees(300) }, [baseFiltree.length, incoherenceFilter, tri, triCol])
  const affichees = useMemo(() => filtres.slice(0, nbAffichees), [filtres, nbAffichees])

  // Indicateurs et synthèse commande sur le jeu filtré — suivent les quantités saisies
  const kpis = useMemo(() => {
    const pert = baseFiltree.filter((a) => a.pertinent_calcul_besoin)
    const fournisseursCde = new Set<string>()
    let aCommander = 0, qte = 0, montant = 0, sansPrix = 0, retenues = 0, methodeB = 0, rupture = 0, ruptureACommander = 0, surcharges = 0, economiePalier = 0, palierAtteignable = 0, qteAddPalier = 0, ecretes = 0
    baseFiltree.forEach((a) => {
      const p = propositions.get(a.reference_article)
      if (!p) return
      const t = tarifs.get(a.reference_article)
      if (p.methode === 'couverture') methodeB += 1
      if (p.qteRetenue !== null) retenues += 1
      if (aSurcharge(p)) surcharges += 1
      if (n0(profils.get(a.reference_article)?.nb_mois_ecretes) > 0) ecretes += 1
      if (a.pertinent_calcul_besoin && p.stockReception < 0) { rupture += 1; if (p.qteFinale > 0) ruptureACommander += 1 }
      if (p.qteFinale > 0) {
        aCommander += 1; qte += p.qteFinale
        fournisseursCde.add(a.fournisseur_principal || '—')
        const px = prixUnitaire(a, t)
        if (px === null) sansPrix += 1; else montant += p.qteFinale * px
        if (t?.suivant) { palierAtteignable += 1; economiePalier += t.suivant.economie; qteAddPalier += t.suivant.qteAdd }
      }
    })
    return {
      total: baseFiltree.length, mystock: pert.length,
      arretAppro: baseFiltree.filter((a) => a.arret_appro).length,
      blocageAppro: baseFiltree.filter((a) => a.blocage_appro).length,
      blocageMystock: baseFiltree.filter((a) => a.blocage_appro && a.pertinent_calcul_besoin).length,
      avecConso: pert.filter((a) => Number(a.conso_horizon) > 0).length,
      sansConso: pert.filter((a) => !(Number(a.conso_horizon) > 0)).length,
      minBlg: pert.filter((a) => Number(a.blg_stock_min_fms) > 0).length,
      ecarts: pert.filter((a) => (a.champs_en_ecart || []).includes('stock_min')).length,
      encoursRetard: pert.filter((a) => n0(a.encours_fourn_retard) > 0).length,
      encoursDouteux: pert.filter((a) => n0(a.encours_fourn_douteux) > 0).length,
      sansDate: pert.filter((a) => a.date_livraison_par_defaut).length,
      avecTarifQte: baseFiltree.filter((a) => tarifs.has(a.reference_article)).length,
      aCommander, qte, montant, sansPrix, retenues, methodeB, rupture, ruptureACommander, surcharges, ecretes,
      fournisseursCde: fournisseursCde.size, economiePalier, palierAtteignable, qteAddPalier,
    }
  }, [baseFiltree, propositions, tarifs, profils])

  // ── Enregistrement d'une surcharge article (optimiste, annulée en cas d'erreur) ─────────
  const onSurcharge = useCallback((a: ArtRow, p: Proposition, patch: PatchSurcharge) => {
    const ref = a.reference_article
    const e = p.eff
    const versArticle: Partial<ArtRow> = {}, avantArticle: Partial<ArtRow> = {}
    const versProfil: Partial<ProfilConso> = {}, avantProfil: Partial<ProfilConso> = {}
    if ('methode_calcul' in patch) { versArticle.ref_methode_calcul = patch.methode_calcul ?? null; avantArticle.ref_methode_calcul = a.ref_methode_calcul }
    if ('couverture_min_mois' in patch) { versArticle.ref_couverture_min_mois = patch.couverture_min_mois ?? null; avantArticle.ref_couverture_min_mois = a.ref_couverture_min_mois }
    if ('couverture_cible_mois' in patch) { versArticle.ref_couverture_cible_mois = patch.couverture_cible_mois ?? null; avantArticle.ref_couverture_cible_mois = a.ref_couverture_cible_mois }
    if ('delai_appro_ref_jours' in patch) { versArticle.delai_appro_ref_jours = patch.delai_appro_ref_jours ?? null; avantArticle.delai_appro_ref_jours = a.delai_appro_ref_jours }
    if ('delai_securite_ref_jours' in patch) { versArticle.delai_securite_ref_jours = patch.delai_securite_ref_jours ?? null; avantArticle.delai_securite_ref_jours = a.delai_securite_ref_jours }
    if ('conso_source' in patch) { versProfil.conso_source = patch.conso_source ?? null; avantProfil.conso_source = e.conso.o === 'article' ? e.conso.v : null }
    if ('conso_coef' in patch) { versProfil.conso_coef = patch.conso_coef ?? null; avantProfil.conso_coef = e.coef.o === 'article' ? e.coef.v : null }
    if ('strategie_appro' in patch) { versProfil.strategie_appro = patch.strategie_appro ?? null; avantProfil.strategie_appro = e.strategie.o === 'article' ? e.strategie.v : null }
    if (Object.keys(versArticle).length) onArticlePatch(ref, versArticle)
    if (Object.keys(versProfil).length) onProfilPatch(ref, versProfil)
    void (async () => {
      const { error: err } = await supabase.from('appro_article_stock_min').upsert({ reference_article: ref, ...patch }, { onConflict: 'reference_article' })
      if (err) {
        if (Object.keys(avantArticle).length) onArticlePatch(ref, avantArticle)
        if (Object.keys(avantProfil).length) onProfilPatch(ref, avantProfil)
        setMessage({ type: 'ko', texte: `${ref} : enregistrement impossible — ${messageErreur(err)}` })
      }
    })()
  }, [onArticlePatch, onProfilPatch])
  const onOuvrirArticle = useCallback((ref: string) => setArticleRef(ref), [])
  const onOuvrirFournisseur = useCallback((numero: string) => setFournNumero(numero), [])
  const onEditer = useCallback((ref: string) => setEditRef(ref), [])

  async function rechargerProfil(ref: string) {
    const { data, error: err } = await supabase.from('v_appro_article_conso_profil').select('*').eq('reference_article', ref).maybeSingle()
    if (err) { setMessage({ type: 'ko', texte: 'Profil de conso : ' + messageErreur(err) }); return }
    if (data) onProfilSet(normaliserProfil(data as ProfilConso))
  }

  /** Fichiers commande fournisseur : un CSV (Référence ; Quantité ; Date de livraison souhaitée) par fournisseur × date,
   * sur les lignes filtrées dont la quantité retenue (ou proposée) est > 0. */
  async function exporterFichiersCommande() {
    setExportCommandesEnCours(true)
    try {
      const groupes = new Map<string, { fournisseur: string; nom: string; date: string; lignes: { ref: string; qte: number }[] }>()
      filtres.forEach((a) => {
        const p = propositions.get(a.reference_article)
        if (!p || p.qteFinale <= 0) return
        const fournisseur = a.fournisseur_principal || 'SANS-FOURNISSEUR'
        const cle = `${fournisseur}|${p.dateSouhaitee}`
        if (!groupes.has(cle)) groupes.set(cle, { fournisseur, nom: fournMap.get(fournisseur)?.sage_intitule || '', date: p.dateSouhaitee, lignes: [] })
        groupes.get(cle)!.lignes.push({ ref: a.reference_article, qte: p.qteFinale })
      })
      if (groupes.size === 0) { setMessage({ type: 'ko', texte: 'Aucune ligne avec une quantité retenue ou proposée > 0 dans le jeu filtré.' }); return }
      const fichiers = Array.from(groupes.values()).sort((x, y) => x.fournisseur.localeCompare(y.fournisseur) || x.date.localeCompare(y.date))
      const echapperCsv = (val: string | number): string => { const s = String(val); return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s }
      for (const g of fichiers) {
        const [yy, mm, dd] = g.date.split('-').map(Number)
        const dateStr = `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yy}`
        const lignes = ['Référence;Quantité;Date de livraison souhaitée', ...g.lignes.sort((x, y) => x.ref.localeCompare(y.ref)).map((l) => `${echapperCsv(l.ref)};${echapperCsv(l.qte)};${echapperCsv(dateStr)}`)]
        const blob = new Blob([lignes.join('\n')], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const nomPropre = `${g.fournisseur} ${g.nom}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
        const link = document.createElement('a'); link.href = url; link.download = `${nomPropre} ${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${yy}.csv`
        document.body.appendChild(link); link.click(); link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        if (fichiers.length > 1) await new Promise((r) => setTimeout(r, 500))
      }
      setMessage({ type: 'ok', texte: `${fichiers.length} fichier${fichiers.length > 1 ? 's' : ''} commande : ${fichiers.map((g) => `${g.fournisseur} ${fmtDate(g.date)} (${g.lignes.length})`).join(' · ')}` })
    } catch (e) {
      setMessage({ type: 'ko', texte: 'Erreur fichiers commande : ' + messageErreur(e) })
    } finally { setExportCommandesEnCours(false) }
  }

  async function enregistrerParams() {
    const next = parametres.map((p) => ({ ...p, valeur: Number(paramsDraft[p.cle] ?? p.valeur) }))
    const { error: err } = await supabase.from('appro_parametres').upsert(next.map((p) => ({ cle: p.cle, valeur: p.valeur, description: p.description })), { onConflict: 'cle' })
    if (err) { setMessage({ type: 'ko', texte: 'Erreur : ' + err.message }); return }
    onParametresChange(next)
    setMessage({ type: 'ok', texte: 'Paramètres enregistrés — relance « Recalculer les stocks min » pour les appliquer aux stocks min en base.' })
  }

  async function recalculer() {
    setRecalculEnCours(true)
    try {
      const { data, error: err } = await supabase.rpc('refresh_appro_calcul_besoin')
      if (err) throw err
      const d = data as { periode?: string; articles_calcules?: number; lignes_conso?: number }
      await onRecharger()
      setMessage({ type: 'ok', texte: `Calcul terminé sur ${d?.periode ?? '?'} : ${fmtNum(d?.articles_calcules)} articles, ${fmtNum(d?.lignes_conso)} lignes de conso mensuelle.` })
    } catch (e) {
      setMessage({ type: 'ko', texte: 'Erreur : ' + messageErreur(e) })
    } finally { setRecalculEnCours(false) }
  }

  /** Import de l'export SAGE "Articles-bis_avec_cde_blocage.csv" → RPC appro_importer_blocage_articles. */
  async function importerCsvBlocage(fichier: File) {
    setImportBlocageEnCours(true)
    try {
      const buf = await fichier.arrayBuffer()
      let texte = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      if (texte.includes('�')) texte = new TextDecoder('iso-8859-1').decode(buf)
      texte = texte.replace(/^﻿/, '')
      const lignes = texte.split(/\r?\n/).filter((l) => l.trim() !== '')
      if (lignes.length < 2) throw new Error('fichier vide')
      const sep = (lignes[0].match(/;/g) || []).length >= (lignes[0].match(/\t/g) || []).length ? ';' : '\t'
      const decouper = (l: string): string[] => {
        const out: string[] = []; let cur = ''; let q = false
        for (let i = 0; i < l.length; i += 1) {
          const ch = l[i]
          if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i += 1 } else q = false } else cur += ch }
          else if (ch === '"') q = true
          else if (ch === sep) { out.push(cur); cur = '' }
          else cur += ch
        }
        out.push(cur); return out
      }
      const entete = decouper(lignes[0]).map((h) => h.trim().toUpperCase())
      const idx = (noms: string[]) => { for (const n of noms) { const i = entete.indexOf(n.toUpperCase()); if (i >= 0) return i } return -1 }
      const iRef = idx(['AR_Ref']), iInt = idx(['AR_InterdireCommande']), iExc = idx(['AR_Exclure']), iVie = idx(['VieProduit', 'VieProduits']), iUo = idx(['UO FMS', 'UO_FMS'])
      if (iRef < 0 || iInt < 0) throw new Error(`colonnes AR_Ref / AR_InterdireCommande introuvables (entête lue : ${entete.slice(0, 6).join(', ')}…)`)
      const nz = (v: string | undefined) => { const t = (v ?? '').trim(); return t === '' || t.toUpperCase() === 'NULL' ? null : t }
      const rows = lignes.slice(1).map(decouper).filter((cl) => nz(cl[iRef])).map((cl) => ({
        reference_article: (cl[iRef] || '').trim(),
        interdire_commande: (cl[iInt] || '').trim() === '1',
        exclure: iExc >= 0 ? (cl[iExc] || '').trim() === '1' : false,
        vie_produit: iVie >= 0 ? nz(cl[iVie]) : null,
        uo_fms: iUo >= 0 ? nz(cl[iUo]) : null,
      }))
      if (rows.length === 0) throw new Error('aucune ligne exploitable')
      const { data, error: err } = await supabase.rpc('appro_importer_blocage_articles', { p_rows: rows, p_source: `${fichier.name} (${new Date().toLocaleDateString('fr-FR')})`, p_remplacer: true })
      if (err) throw err
      const res = (data || {}) as { importes?: number; total?: number; bloques?: number }
      await onRecharger()
      setMessage({ type: 'ok', texte: `Import terminé : ${fmtNum(res.importes)} références importées (${fmtNum(res.total)} en table), ${fmtNum(res.bloques)} en blocage appro.` })
    } catch (e) {
      setMessage({ type: 'ko', texte: 'Erreur import CSV blocage : ' + messageErreur(e) })
    } finally { setImportBlocageEnCours(false) }
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Calcul de besoin')
      const P = (a: ArtRow) => propositions.get(a.reference_article)
      const cols: { h: string; f: (a: ArtRow) => unknown }[] = [
        { h: 'Référence', f: (a) => a.reference_article }, { h: 'Désignation', f: (a) => a.sage_designation }, { h: 'Famille', f: (a) => a.famille },
        { h: 'Fournisseur', f: (a) => a.fournisseur_principal }, { h: 'Intitulé fournisseur', f: (a) => (a.fournisseur_principal ? fournMap.get(a.fournisseur_principal)?.sage_intitule : null) },
        { h: 'Qualité fournisseur', f: (a) => (a.fournisseur_principal ? fournMap.get(a.fournisseur_principal)?.sage_qualite : null) },
        { h: 'Incohérences', f: (a) => (incoherencesParRef.get(a.reference_article) || []).map((k) => LABEL_INCOHERENCE_ARTICLE[k]?.label || k).join(' ; ') },
        { h: 'Blocage appro (SAGE)', f: (a) => (a.blocage_appro ? 'Oui' : 'Non') }, { h: 'Exclu (AR_Exclure)', f: (a) => (a.exclure_appro ? 'Oui' : 'Non') }, { h: 'Vie produit', f: (a) => a.vie_produit },
        { h: 'Arrêt appro', f: (a) => (a.arret_appro ? 'Oui' : 'Non') }, { h: 'Arrêt vente', f: (a) => (a.arret_vente ? 'Oui' : 'Non') }, { h: 'Réf. remplaçante', f: (a) => a.ref_remplacante },
        { h: 'MYSTOCK', f: (a) => a.mystock }, { h: 'En sommeil', f: (a) => (a.sage_en_sommeil ? 'Oui' : 'Non') },
        { h: 'Stratégie', f: (a) => P(a)?.eff.strategie.v }, { h: 'Stratégie (origine)', f: (a) => P(a)?.eff.strategie.o },
        { h: 'Méthode', f: (a) => { const p = P(a); return p ? `${p.lettre} · ${METHODE_PAR_CODE[p.methode].label}` : '' } }, { h: 'Méthode (origine)', f: (a) => P(a)?.source },
        { h: 'Couverture min (mois)', f: (a) => P(a)?.couvMin }, { h: 'Couverture cible (mois)', f: (a) => P(a)?.couvCible }, { h: 'Couvertures (origine)', f: (a) => P(a)?.couvSource },
        { h: 'Conso retenue', f: (a) => { const p = P(a); return p ? CONSO_PAR_CODE[p.muSource].label : '' } }, { h: 'Coef conso', f: (a) => (P(a)?.muSource === 'fut3_coef' ? P(a)?.eff.coef.v : null) }, { h: 'Conso (origine)', f: (a) => P(a)?.eff.conso.o },
        { h: 'μ retenu', f: (a) => P(a)?.mu }, { h: 'μ 12 mois', f: (a) => P(a)?.mu12 }, { h: 'μ 3 mois', f: (a) => P(a)?.mu3 }, { h: 'μ 3 prochains mois N−1', f: (a) => P(a)?.muFut3 }, { h: 'σ', f: (a) => P(a)?.sigma },
        { h: 'Mois écrêtés', f: (a) => profils.get(a.reference_article)?.nb_mois_ecretes ?? null },
        { h: 'Délai appro (j)', f: (a) => P(a)?.eff.delaiAppro.v }, { h: 'Délai appro (origine)', f: (a) => P(a)?.eff.delaiAppro.o },
        { h: 'Délai sécurité (j)', f: (a) => P(a)?.eff.delaiSecu.v }, { h: 'Délai sécurité (origine)', f: (a) => P(a)?.eff.delaiSecu.o }, { h: 'Délai L (j)', f: (a) => P(a)?.delaiL },
        { h: 'Dernière sortie', f: (a) => fmtMois(a.sage_derniere_sortie) },
        { h: 'Dispo global (SAGE)', f: (a) => a.sage_stock_dispo_total }, { h: 'Dispo FMS (SAGE)', f: (a) => a.stock_dispo_sage_fms },
        { h: 'Encours ≤ L', f: (a) => P(a)?.encoursPeriode }, { h: 'Encours après L', f: (a) => P(a)?.encoursApres }, { h: 'Encours douteux (exclu)', f: (a) => P(a)?.encoursDouteux },
        { h: 'Réservé ≤ L', f: (a) => P(a)?.reservePeriode }, { h: 'Réservé après L', f: (a) => P(a)?.reserveApres },
        { h: 'Demande sur L', f: (a) => P(a)?.demande }, { h: 'Date réception', f: (a) => fmtDate(P(a)?.dateReception) },
        { h: 'Stock à réception', f: (a) => P(a)?.stockReception }, { h: 'Couverture à réception (mois)', f: (a) => P(a)?.couvReception },
        { h: 'Stock sécurité', f: (a) => P(a)?.ss }, { h: 'Stock min', f: (a) => P(a)?.minEff }, { h: 'Stock max', f: (a) => P(a)?.maxEff }, { h: 'SS/min/max recalculés sur la ligne', f: (a) => (P(a)?.recalcule ? 'Oui' : 'Non') },
        { h: 'Seuil A', f: (a) => P(a)?.seuilA }, { h: 'Stock min retenu (saisie)', f: (a) => a.stock_min_retenu },
        { h: 'Stock min SAGE', f: (a) => a.sage_stock_min_fms }, { h: 'Stock min BLG (DPFMS)', f: (a) => a.blg_stock_min_fms },
        { h: 'Déclenche', f: (a) => (P(a)?.declenche ? 'Oui' : 'Non') }, { h: 'Proposition', f: (a) => P(a)?.qteProposee }, { h: 'Qté retenue (saisie)', f: (a) => a.qte_proposition_manuelle },
        { h: 'Qté commande', f: (a) => P(a)?.qteFinale }, { h: 'Livraison souhaitée', f: (a) => fmtDate(P(a)?.dateSouhaitee) },
        { h: 'Prix unitaire', f: (a) => prixUnitaire(a, tarifs.get(a.reference_article)) },
        { h: 'Montant commande', f: (a) => { const p = P(a); const px = prixUnitaire(a, tarifs.get(a.reference_article)); return p && p.qteFinale > 0 && px !== null ? Math.round(p.qteFinale * px * 100) / 100 : null } },
        { h: 'Palier suivant : qté additionnelle', f: (a) => tarifs.get(a.reference_article)?.suivant?.qteAdd }, { h: 'Palier suivant : prix', f: (a) => tarifs.get(a.reference_article)?.suivant?.prix },
        { h: 'Palier suivant : économie (€)', f: (a) => tarifs.get(a.reference_article)?.suivant?.economie },
        { h: 'Colisage', f: (a) => a.sage_colisage }, { h: 'Explication', f: (a) => P(a)?.explication.join(' | ') }, { h: 'Lien BLG', f: (a) => a.lien_blg },
      ]
      ws.addRow(cols.map((c) => c.h)).font = { bold: true }
      const iCmd = cols.findIndex((c) => c.h === 'Qté commande') + 1
      const iRec = cols.findIndex((c) => c.h === 'Stock à réception') + 1
      filtres.forEach((a) => {
        const row = ws.addRow(cols.map((c) => { const v = c.f(a); return v === null || v === undefined ? '' : v }))
        const p = P(a)
        if (a.pertinent_calcul_besoin && p) {
          const coul = p.qteFinale > 0 ? COULEUR_ECART : p.stockReception < 0 ? COULEUR_NON_COMPARABLE : COULEUR_OK
          ;[iCmd, iRec].forEach((i) => { row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: coul } } })
        }
      })
      ws.columns.forEach((c) => { c.width = 16 })
      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `calcul_besoin_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); URL.revokeObjectURL(url)
    } catch (e) {
      setMessage({ type: 'ko', texte: 'Erreur export Excel : ' + messageErreur(e) })
    } finally { setExportEnCours(false) }
  }

  /** Références transmises au plan d'appro : le jeu affiché (filtres + groupe), avec stock, μ, prix et échéances du calcul de besoin. */
  const PLAN_MAX_REFS = 400
  const articlesPlan = useMemo<PlanArticle[]>(() => {
    if (!planOuvert) return []
    return filtres.slice(0, PLAN_MAX_REFS).map((a) => {
      const p = propositions.get(a.reference_article)
      return {
        ref: a.reference_article, designation: a.sage_designation || a.blg_designation, famille: a.famille, fournisseur: a.fournisseur_principal,
        colisage: n0(a.sage_colisage), prix: prixUnitaire(a, tarifs.get(a.reference_article)),
        stockBase: p ? p.stockBase : n0(a.sage_stock_dispo_total), mu: p ? p.mu : n0(a.conso_moy_mensuelle),
        perimetreGlobal: p ? p.perimetreGlobal : a.projection_perimetre !== 'fms',
        reserve: a.reserve_echeances || [], encours: a.encours_echeances || [],
      }
    })
  }, [planOuvert, filtres, propositions, tarifs])

  const colonnesVisibles = useMemo(() => COLONNES_ARTICLES.filter((c) => !colonnesMasquees.has(c.key)), [colonnesMasquees])
  const setVisibles = useMemo(() => new Set(colonnesVisibles.map((c) => c.key)), [colonnesVisibles])
  const groupesEnTete = useMemo(() => {
    const g: { groupe: GroupeCol; n: number }[] = []
    colonnesVisibles.forEach((c) => { const der = g[g.length - 1]; if (der && der.groupe === c.groupe) der.n += 1; else g.push({ groupe: c.groupe, n: 1 }) })
    return g
  }, [colonnesVisibles])

  // Navigation dans la fenêtre article : références du tableau, dans l'ordre affiché
  const indexArticle = articleRef ? filtres.findIndex((a) => a.reference_article === articleRef) : -1
  const articleOuvert = articleRef ? articleParRef.get(articleRef) : undefined
  const fournOuvert = fournNumero ? fournMap.get(fournNumero) : undefined
  const articleEdite = editRef ? articleParRef.get(editRef) : undefined

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const puce = (actif: boolean) => `flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#8A5A08]' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`
  const nbFiltresActifs = (groupeActif ? 1 : 0) + [fournFilter, familleFilter, qualiteFilter, strategieFilter, search.trim()].filter(Boolean).length + [sommeilFilter, arretApproFilter, blocageFilter].filter((v) => v !== 'tous').length + (avecConsoSeuls ? 1 : 0) + (ecartMinSeuls ? 1 : 0) + (aCommanderSeuls ? 1 : 0) + (avecEncoursSeuls ? 1 : 0) + (surchargesSeules ? 1 : 0) + clesFiltreCol.length + (incoherenceFilter ? 1 : 0)
  function reinitialiserFiltres() {
    setGroupeId(''); setSearch(''); setFournFilter(''); setFamilleFilter(''); setQualiteFilter(''); setStrategieFilter(''); setSommeilFilter('tous'); setArretApproFilter('tous'); setBlocageFilter('tous')
    setAvecConsoSeuls(false); setEcartMinSeuls(false); setACommanderSeuls(false); setAvecEncoursSeuls(false); setSurchargesSeules(false); setFiltresCol({}); setTriCol(null); setIncoherenceFilter(null)
  }

  return (
    <>
      {/* Synthèse commande (suit les filtres et les quantités saisies) + indicateurs compacts */}
      <section className="sticky top-0 z-30 -mx-1 space-y-1.5 bg-[#F4F3F0] px-1 pb-1.5 pt-1">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-[#111820] px-4 py-2 text-white">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#D9A441]">À commander</span>
            <span className="text-[20px] font-bold leading-none">{loading ? '…' : fmtNum(kpis.aCommander)}</span>
            <span className="text-[12px] text-white/70">réf. · {fmtNum(kpis.fournisseursCde)} fournisseur{kpis.fournisseursCde > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-baseline gap-1.5"><span className="text-[16px] font-bold">{fmtNum(kpis.qte)}</span><span className="text-[12px] text-white/70">pièces</span></div>
          <div className="flex items-baseline gap-1.5"><span className="text-[16px] font-bold">{fmtEuro(kpis.montant)}</span><span className="text-[12px] text-white/70">HT{kpis.sansPrix ? ` · ${kpis.sansPrix} sans prix` : ''}</span></div>
          <div className="flex items-baseline gap-1.5"><span className="text-[13px] font-bold">{fmtNum(kpis.retenues)}</span><span className="text-[12px] text-white/70">qté retenue{kpis.retenues > 1 ? 's' : ''} saisie{kpis.retenues > 1 ? 's' : ''}</span></div>
          <div className="flex flex-wrap items-center gap-1.5">
            {kpis.rupture > 0 && <button type="button" onClick={() => setTriCol({ key: 'projete', dir: 'asc' })} className="rounded-full bg-[#C1683C] px-2 py-0.5 text-[11px] font-bold" title="Stock négatif à réception : rupture avant l'arrivée d'une commande passée aujourd'hui. Clic : trier par stock à réception">⚠ {fmtNum(kpis.rupture)} rupture{kpis.rupture > 1 ? 's' : ''} à réception</button>}
            {kpis.encoursRetard > 0 && <button type="button" onClick={() => setAvecEncoursSeuls(true)} className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold" title="Encours fournisseur dont la date estimée est dépassée">⏱ {fmtNum(kpis.encoursRetard)} encours en retard</button>}
            {kpis.palierAtteignable > 0 && <span className="rounded-full bg-emerald-600/80 px-2 py-0.5 text-[11px] font-bold" title={`${kpis.palierAtteignable} référence(s) à commander pour lesquelles un palier de prix est atteignable (+${fmtNum(kpis.qteAddPalier)} pièces)`}>€ {fmtEuro(kpis.economiePalier)} d’économie paliers</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {groupeActif && <span className="rounded-full bg-[#7A5EA8] px-2.5 py-0.5 text-[11px] font-bold" title={`${groupeActif.refs.length} référence(s) dans le groupe — tableau et indicateurs limités au groupe`}>◆ {groupeActif.nom}</span>}
            <button type="button" onClick={() => setPlanOuvert(true)} disabled={loading || filtres.length === 0}
              title={`Projection mensuelle du stock des références affichées${filtres.length > PLAN_MAX_REFS ? ` (${PLAN_MAX_REFS} premières)` : ''} : hypothèses de conso, chaînages, commandes d'appro mensuelles, couverture en quantité / mois / valeur`}
              className="h-8 rounded-lg bg-[#7A5EA8] px-3 text-[12px] font-bold text-white hover:bg-[#6A4F96] disabled:opacity-50">
              📈 Plan d’appro & couverture ({fmtNum(Math.min(filtres.length, PLAN_MAX_REFS))})
            </button>
            <button type="button" onClick={() => void exporterFichiersCommande()} disabled={exportCommandesEnCours || loading || kpis.aCommander === 0}
              title="Un fichier par fournisseur et par date de livraison souhaitée (Référence ; Quantité ; Date), sur les lignes filtrées à commander"
              className="h-8 rounded-lg bg-[#D9A441] px-3 text-[12px] font-bold text-[#111820] hover:bg-[#E5B556] disabled:opacity-50">
              {exportCommandesEnCours ? 'Génération…' : `⬇ Fichiers commande (${fmtNum(kpis.aCommander)})`}
            </button>
          </div>
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
          <KpiMini label="Réf. filtrées" value={kpis.total} loading={loading} sub={`/ ${fmtNum(articles.length)}`} title={`${fmtNum(kpis.arretAppro)} en arrêt appro`} />
          <KpiMini label="MYSTOCK actives" value={kpis.mystock} loading={loading} />
          <KpiMini label="Blocage appro" value={kpis.blocageAppro} loading={loading} tone={kpis.blocageAppro ? 'warn' : undefined} sub={`${fmtNum(kpis.blocageMystock)} MYSTOCK`} onClick={() => setBlocageFilter((v) => (v === 'oui' ? 'tous' : 'oui'))} actif={blocageFilter === 'oui'} />
          <KpiMini label="Avec conso" value={kpis.avecConso} loading={loading} tone="ok" />
          <KpiMini label="Sans sortie" value={kpis.sansConso} loading={loading} tone="warn" title="MYSTOCK sans aucune sortie sur 12 mois : à challenger" />
          <KpiMini label="Min BLG renseigné" value={kpis.minBlg} loading={loading} />
          <KpiMini label="Min BLG ≠ calculé" value={kpis.ecarts} loading={loading} tone="warn" onClick={() => setEcartMinSeuls((v) => !v)} actif={ecartMinSeuls} />
          <KpiMini label="Rupture récep." value={kpis.rupture} loading={loading} tone={kpis.rupture ? 'alerte' : undefined} sub={`${fmtNum(kpis.ruptureACommander)} à cder`} />
          <KpiMini label="Encours retard" value={kpis.encoursRetard} loading={loading} tone="warn" />
          <KpiMini label="Encours douteux" value={kpis.encoursDouteux} loading={loading} title={`Date dépassée de plus de ${valParam(parametres, 'cdf_retard_max_jours', 60)} j : exclu de la projection`} />
          <KpiMini label="Sans date livr." value={kpis.sansDate} loading={loading} title="Délai théorique appliqué" />
          <KpiMini label="Surcharges" value={kpis.surcharges} loading={loading} tone={kpis.surcharges ? 'warn' : undefined} sub={kpis.ecretes ? `${fmtNum(kpis.ecretes)} écrêtée${kpis.ecretes > 1 ? 's' : ''}` : undefined} onClick={() => setSurchargesSeules((v) => !v)} actif={surchargesSeules} title="Références dont au moins un paramètre d'appro est saisi sur l'article. Clic : ne voir qu'elles" />
          <KpiMini label="Tarif qté" value={kpis.avecTarifQte} loading={loading} sub={tarifsErreur ? 'non chargés' : undefined} title={tarifsErreur || undefined} />
        </div>
      </section>

      {/* Filtres densifiés */}
      <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'minmax(180px, 2fr) repeat(8, minmax(0, 1fr))' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence ou désignation…" className={`${ctl} font-medium`} />
          <select value={fournFilter} onChange={(e) => setFournFilter(e.target.value)} className={ctl}>
            <option value="">Fournisseur : tous</option>
            {fournOptions.map((f) => <option key={f.numero} value={f.numero}>{f.numero} — {f.label}</option>)}
          </select>
          <select value={familleFilter} onChange={(e) => setFamilleFilter(e.target.value)} className={ctl}>
            <option value="">Famille : toutes</option>
            {familleOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={qualiteFilter} onChange={(e) => setQualiteFilter(e.target.value)} className={ctl}>
            <option value="">Qualité : toutes</option>
            {qualiteOptions.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <select value={strategieFilter} onChange={(e) => setStrategieFilter(e.target.value)} className={ctl} title="Stratégie effective (article, sinon fournisseur)">
            <option value="">Stratégie : toutes</option>
            {STRATEGIES_APPRO.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__none">Non renseignée</option>
          </select>
          <select value={sommeilFilter} onChange={(e) => setSommeilFilter(e.target.value as typeof sommeilFilter)} className={ctl}>
            <option value="tous">Sommeil : toutes</option><option value="non">Actives</option><option value="oui">En sommeil</option>
          </select>
          <select value={arretApproFilter} onChange={(e) => setArretApproFilter(e.target.value as typeof arretApproFilter)} className={ctl}>
            <option value="tous">Arrêt appro : tous</option><option value="oui">Arrêt appro : oui</option><option value="non">Arrêt appro : non</option>
          </select>
          <select value={blocageFilter} onChange={(e) => setBlocageFilter(e.target.value as typeof blocageFilter)} className={`${ctl} ${blocageFilter === 'oui' ? 'border-red-300 text-red-700' : ''}`}>
            <option value="tous">Blocage : tous</option><option value="oui">⛔ Bloqués</option><option value="non">Non bloqués</option><option value="exclu">Exclus</option><option value="findevie">Vie produit</option>
          </select>
          <select value={tri} onChange={(e) => { setTri(e.target.value as typeof tri); setTriCol(null) }} className={ctl}>
            <option value="fournisseur">Tri : fournisseur</option>
            <option value="a_commander">Tri : qté à commander</option>
            <option value="montant">Tri : montant</option>
            <option value="projete">Tri : stock à réception</option>
            <option value="couverture">Tri : couverture</option>
            <option value="conso">Tri : conso</option>
            <option value="incoherences">Tri : incohérences</option>
            <option value="ecart">Tri : écart min BLG</option>
            <option value="reference">Tri : référence</option>
          </select>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <select value={groupeId} onChange={(e) => setGroupeId(e.target.value)} title="Groupe de références : limite le tableau et les indicateurs (la pastille MYSTOCK actives est alors ignorée)"
            className={`h-7 max-w-[240px] rounded-full border px-2.5 text-[11.5px] font-semibold outline-none ${groupeActif ? 'border-[#7A5EA8] bg-[#EFE9F7] text-[#5B4387]' : 'border-[#E5E1D8] bg-white text-[#3A362E]'}`}>
            <option value="">Groupe : aucun</option>
            {groupeAdHoc && <option value="__adhoc">◇ {groupeAdHoc.nom} (non enregistré, {groupeAdHoc.refs.length})</option>}
            {groupes.map((g) => <option key={g.id} value={g.id}>◆ {g.nom} ({g.references_articles.length})</option>)}
          </select>
          <button type="button" onClick={() => setEditeurGroupe(groupeActif ? { id: groupeActif.id, nom: groupeActif.nom, description: groupes.find((g) => g.id === groupeActif.id)?.description || '', refs: groupeActif.refs } : { id: null, nom: '', description: '', refs: [] })}
            className="h-7 rounded-full border border-[#E5E1D8] bg-white px-2.5 text-[11.5px] font-bold text-[#5B4387] hover:bg-[#EFE9F7]" title={groupeActif ? 'Modifier le groupe' : 'Créer un groupe à la volée'}>{groupeActif ? '✎ Groupe' : '+ Groupe à la volée'}</button>
          {groupeActif && refsGroupeAbsentes.length > 0 && <span className="text-[11px] font-semibold text-orange-700" title={refsGroupeAbsentes.join(', ')}>{refsGroupeAbsentes.length} réf. du groupe absente{refsGroupeAbsentes.length > 1 ? 's' : ''} du calcul</span>}
          <span className="mx-1 h-5 w-px bg-[#E5E1D8]" />
          <button type="button" className={`${puce(pertinentsSeuls && !groupeActif)} ${groupeActif ? 'opacity-50' : ''}`} onClick={() => setPertinentsSeuls((v) => !v)} title={groupeActif ? 'Ignoré tant qu\'un groupe est sélectionné' : undefined}>MYSTOCK actives</button>
          <button type="button" className={puce(aCommanderSeuls)} onClick={() => setACommanderSeuls((v) => !v)}>À commander</button>
          <button type="button" className={puce(avecConsoSeuls)} onClick={() => setAvecConsoSeuls((v) => !v)}>Avec conso</button>
          <button type="button" className={puce(avecEncoursSeuls)} onClick={() => setAvecEncoursSeuls((v) => !v)}>Avec encours</button>
          <button type="button" className={puce(ecartMinSeuls)} onClick={() => setEcartMinSeuls((v) => !v)}>Min BLG ≠ calculé</button>
          <button type="button" className={puce(surchargesSeules)} onClick={() => setSurchargesSeules((v) => !v)}>Paramètres surchargés</button>
          <span className="mx-1 h-5 w-px bg-[#E5E1D8]" />
          <button type="button" onClick={() => setVoirIncoherences((v) => !v)} className={puce(voirIncoherences || !!incoherenceFilter)}>
            <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${compteursIncoherences.refsAvec ? 'bg-orange-100 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>{fmtNum(compteursIncoherences.refsAvec)}</span>
            incohérences {voirIncoherences ? '▴' : '▾'}
          </button>
          {incoherenceFilter && <button type="button" onClick={() => setIncoherenceFilter(null)} className="text-[11.5px] font-bold text-[#B4761A] hover:underline">✕ filtre incohérence</button>}
          {nbFiltresActifs > 0 && <button type="button" onClick={reinitialiserFiltres} className="text-[11.5px] font-bold text-[#B4761A] hover:underline">↺ Réinitialiser les filtres ({nbFiltresActifs})</button>}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <button type="button" onClick={() => setMenuColonnes((v) => !v)} className="h-7 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[11.5px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]">Colonnes ▾</button>
              {menuColonnes && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuColonnes(false)} />
                  <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-[520px] overflow-auto rounded-xl border border-[#E5E1D8] bg-white p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Colonnes affichées</span>
                      <button type="button" onClick={() => setColonnesMasquees(new Set(COLONNES_MASQUEES_DEFAUT))} className="text-[11px] font-bold text-[#B4761A] hover:underline">Par défaut</button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {(Array.from(new Set(COLONNES_ARTICLES.map((c) => c.groupe))) as GroupeCol[]).map((g) => (
                        <div key={g}>
                          <div className={`mb-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${COULEUR_GROUPE[g]}`}>{g}</div>
                          {COLONNES_ARTICLES.filter((c) => c.groupe === g && c.key !== 'reference').map((c) => (
                            <label key={c.key} className="flex items-center gap-2 py-0.5 text-[12px] text-[#3A362E]">
                              <input type="checkbox" checked={!colonnesMasquees.has(c.key)} className="accent-[#B4761A]"
                                onChange={(e) => setColonnesMasquees((s) => { const n = new Set(s); if (e.target.checked) n.delete(c.key); else n.add(c.key); return n })} />
                              {c.label === '⚠' ? 'Incohérences' : c.label}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <input ref={inputCsvBlocage} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const fi = e.target.files?.[0]; e.target.value = ''; if (fi) void importerCsvBlocage(fi) }} />
            <button type="button" onClick={() => inputCsvBlocage.current?.click()} disabled={importBlocageEnCours || loading} title="Export SAGE « Articles-bis_avec_cde_blocage.csv » (AR_Ref, AR_InterdireCommande, AR_Exclure, VieProduit, UO FMS) — remplace appro_article_blocage" className="h-7 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[11.5px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-60">
              {importBlocageEnCours ? 'Import…' : '⬆ CSV blocage'}
            </button>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="h-7 rounded-md bg-[#111820] px-2.5 text-[11.5px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">
              {exportEnCours ? 'Export…' : `⬇ Excel (${fmtNum(filtres.length)})`}
            </button>
          </div>
        </div>
        {voirIncoherences && (
          <div className="mt-2 border-t border-[#EFECE4] pt-2">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setIncoherenceFilter((v) => (v === '__any' ? null : '__any'))} className={puce(incoherenceFilter === '__any')}>Toutes ({fmtNum(compteursIncoherences.refsAvec)})</button>
              {INCOHERENCES_ARTICLE.filter((i) => (compteursIncoherences.c[i.code] || 0) > 0).map((i) => (
                <button key={i.code} type="button" onClick={() => setIncoherenceFilter((v) => (v === i.code ? null : i.code))} className={puce(incoherenceFilter === i.code)}>
                  <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${i.gravite === 'rouge' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{fmtNum(compteursIncoherences.c[i.code])}</span>
                  {i.label}
                </button>
              ))}
              {compteursIncoherences.refsAvec === 0 && !loading && <span className="text-[11.5px] font-semibold text-emerald-700">Aucune incohérence sur le jeu filtré</span>}
            </div>
          </div>
        )}
      </section>

      {/* Pavé calcul de besoin — une ligne */}
      <ModeleProjectionLigne parametres={parametres} onParametresChange={onParametresChange} onRecharger={onRecharger} loading={loading}
        methodeForcee={methodeForcee} onMethodeForcee={setMethodeForcee} ctxProp={ctxProp} nbMethodeB={kpis.methodeB} nbTotal={kpis.total}
        recalculEnCours={recalculEnCours} onRecalculer={() => void recalculer()} showParams={showParams} onToggleParams={() => setShowParams((v) => !v)} />
      {showParams && (
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
            {parametres.filter((p) => !PROJECTION_PARAM_KEYS.includes(p.cle)).map((p) => (
              <label key={p.cle} className="flex flex-col gap-0.5 text-[11.5px]">
                <span className="flex items-center gap-1 font-semibold text-[#3A362E]">{p.cle}{p.description && <Info>{p.description}</Info>}</span>
                <input value={paramsDraft[p.cle] ?? ''} onChange={(e) => setParamsDraft({ ...paramsDraft, [p.cle]: e.target.value })} className="h-7 rounded-md border border-[#E5E1D8] bg-white px-2" />
              </label>
            ))}
          </div>
          <div className="mt-2 text-right"><button type="button" onClick={() => void enregistrerParams()} className="h-7 rounded-md bg-[#111820] px-3 text-[11.5px] font-bold text-white">Enregistrer les paramètres</button></div>
        </section>
      )}
      {message && (
        <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[12.5px] font-semibold ${message.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <span>{message.texte}</span><button type="button" onClick={() => setMessage(null)} className="shrink-0 font-bold opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      {!profilsOk && !loading && (
        <div className="rounded-lg border border-[#D9A441] bg-[#FFF4DC] px-3 py-2 text-[12px] font-semibold text-[#8A5A08]">
          Conso retenue par article, stratégie article et écrêtage indisponibles : la migration « 20261004_calcul_besoin_appro.sql » n’est pas encore appliquée. Le calcul utilise μ 12 / 3 mois de la vue articles.
        </div>
      )}

      {/* Tableau */}
      <section className="rounded-xl border border-[#E5E1D8] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading ? `Chargement… ${fmtNum(loadProgress)} articles` : `${fmtNum(filtres.length)} référence${filtres.length > 1 ? 's' : ''}${filtres.length > affichees.length ? ` · ${fmtNum(affichees.length)} affichées` : ''}`}
            {triCol && <span className="ml-2 normal-case tracking-normal text-[#B4761A]">· tri par colonne</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#8A8474]">
            {error && <span className="font-semibold text-red-600">{error}</span>}
            {(triCol || clesFiltreCol.length > 0) && <button type="button" onClick={() => { setTriCol(null); setFiltresCol({}) }} className="font-bold text-[#B4761A] hover:underline">Réinitialiser tri et filtres de colonnes</button>}
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-[#D9A441] bg-[#FFF4DC]" /> saisi sur l’article</span>
            <Info largeur={420}>Clic sur la <b>référence</b> : consommations mensuelles, ventes anormales, écrêtage et choix de la conso. Clic sur le <b>fournisseur</b> : sa fiche, sans quitter l’écran. Les <b>paramètres d’appro</b> (bande jaune) affichent la valeur du fournisseur ; une saisie la remplace pour l’article seulement (en couleur) et recalcule la ligne ; vider la cellule y revient. En-têtes : clic = tri ; champs = filtre (texte « contient », nombres « &gt;10 », « &lt;=5 », « =0 », « vide » / « !vide »).</Info>
          </div>
        </div>
        <div className="max-h-[calc(100vh-150px)] w-full overflow-auto border-t border-[#E5E1D8]">
          <table className="w-full border-separate border-spacing-0 text-left text-[12px]">
            <thead className="sticky top-0 z-20 text-[10px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                {groupesEnTete.map((g, i) => (
                  <th key={i} colSpan={g.n} className={`border-b border-white px-2 py-0.5 text-left text-[9.5px] font-bold ${COULEUR_GROUPE[g.groupe]} ${i === 0 ? 'sticky left-0 z-10' : ''}`}>{g.n > 1 || g.groupe !== 'Article' ? g.groupe : ''}</th>
                ))}
              </tr>
              <tr className="bg-[#F4F3F0]">
                {colonnesVisibles.map((c) => (
                  <ThTri key={c.key} k={c.key} label={c.label} title={c.title} align={c.align} tri={triCol} onTri={(k) => setTriCol((t) => basculerTri(t, k))}
                    className={`whitespace-nowrap ${c.groupe === 'Paramètres d’appro' ? 'bg-[#FFF8EA]' : 'bg-[#F4F3F0]'} ${c.key === 'inc' ? 'sticky left-0 z-10 w-10' : c.key === 'reference' ? `sticky ${setVisibles.has('inc') ? 'left-10' : 'left-0'} z-10` : ''}`} />
                ))}
              </tr>
              <tr className="bg-[#F4F3F0]">
                {colonnesVisibles.map((c) => (
                  <td key={c.key} className={`border-b border-[#E5E1D8] bg-[#F4F3F0] px-1 pb-1.5 ${c.key === 'inc' ? 'sticky left-0 z-10' : c.key === 'reference' ? `sticky ${setVisibles.has('inc') ? 'left-10' : 'left-0'} z-10` : ''}`}>
                    <InputFiltre value={filtresCol[c.key] || ''} onChange={(v) => setFiltreCol(c.key, v)} align={c.align} placeholder={c.placeholder || 'filtre'} />
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {affichees.map((a) => (
                <LigneArticle key={a.reference_article} a={a} p={propositions.get(a.reference_article)!} t={tarifs.get(a.reference_article)}
                  f={a.fournisseur_principal ? fournMap.get(a.fournisseur_principal) : undefined} incs={incoherencesParRef.get(a.reference_article) || []}
                  colonnes={setVisibles} profilsOk={profilsOk}
                  onOuvrirArticle={onOuvrirArticle} onOuvrirFournisseur={onOuvrirFournisseur} onEditer={onEditer} onSurcharge={onSurcharge} onPropositionSaved={onArticleChange} />
              ))}
              {!loading && affichees.length === 0 && <tr><td colSpan={colonnesVisibles.length} className="px-3 py-8 text-center text-[#8A8474]">Aucune référence pour ces filtres.</td></tr>}
            </tbody>
          </table>
          {filtres.length > affichees.length && (
            <div className="flex items-center justify-center gap-3 border-t border-[#E5E1D8] bg-[#FAF8F3] py-2 text-[12px]">
              <span className="text-[#8A8474]">{fmtNum(affichees.length)} / {fmtNum(filtres.length)} lignes affichées</span>
              <button type="button" onClick={() => setNbAffichees((n) => n + 300)} className="rounded-md border border-[#E5E1D8] bg-white px-3 py-1 font-bold text-[#3A362E] hover:bg-[#F4F3F0]">Afficher 300 de plus</button>
              <button type="button" onClick={() => setNbAffichees(filtres.length)} className="font-bold text-[#B4761A] hover:underline">Tout afficher</button>
            </div>
          )}
        </div>
      </section>

      {articleOuvert && propositions.get(articleOuvert.reference_article) && (
        <ArticleConsoModal article={articleOuvert} prop={propositions.get(articleOuvert.reference_article)!} profil={profils.get(articleOuvert.reference_article)}
          fourn={articleOuvert.fournisseur_principal ? fournMap.get(articleOuvert.fournisseur_principal) : undefined} ctxProp={ctxProp} ecretageDispo={profilsOk}
          position={indexArticle >= 0 ? `${indexArticle + 1} / ${filtres.length}` : null}
          onPrev={indexArticle > 0 ? () => setArticleRef(filtres[indexArticle - 1].reference_article) : undefined}
          onNext={indexArticle >= 0 && indexArticle < filtres.length - 1 ? () => setArticleRef(filtres[indexArticle + 1].reference_article) : undefined}
          onClose={() => setArticleRef(null)} onOpenFourn={(n) => setFournNumero(n)}
          onConsoSave={async (source, coef) => { onSurcharge(articleOuvert, propositions.get(articleOuvert.reference_article)!, { conso_source: source, conso_coef: coef }) }}
          onProfilReload={() => rechargerProfil(articleOuvert.reference_article)} />
      )}
      {fournOuvert && (
        <FicheFournisseurModal selected={fournOuvert} strategies={strategies} articles={articles}
          onRowChange={onFournisseurChange} onClose={() => setFournNumero(null)} onStrategieSaved={onStrategieSaved} />
      )}
      {editeurGroupe && (
        <GroupeEditeurModal initial={editeurGroupe} selectionFiltree={filtres.map((a) => a.reference_article.toUpperCase())}
          articlesConnus={new Set(indexArticles.keys())}
          onAppliquer={(nom, refs) => { setGroupeAdHoc({ nom, refs }); setGroupeId('__adhoc'); setEditeurGroupe(null) }}
          onEnregistre={(g) => {
            const gn = { ...g, references_articles: (g.references_articles || []).map((r) => r.toUpperCase()) }
            setGroupes((l) => [...l.filter((x) => x.id !== gn.id), gn].sort((x, y) => x.nom.localeCompare(y.nom, 'fr')))
            setGroupeId(gn.id); setEditeurGroupe(null)
            setMessage({ type: 'ok', texte: `Groupe « ${gn.nom} » enregistré (${gn.references_articles.length} références).` })
          }}
          onSupprime={(id) => { setGroupes((l) => l.filter((x) => x.id !== id)); setGroupeId(''); setEditeurGroupe(null) }}
          onClose={() => setEditeurGroupe(null)} />
      )}
      {planOuvert && (
        <PlanApproModal articles={articlesPlan}
          groupe={groupeActif && groupeActif.id ? { id: groupeActif.id, nom: groupeActif.nom } : null}
          aujourdhui={ctxBase.aujourdhui} retardMaxJours={ctxBase.retardMaxJours}
          onClose={() => setPlanOuvert(false)}
          onFiltrerRefs={(refs, nom) => { setPlanOuvert(false); setGroupeAdHoc({ nom, refs: refs.map((r) => r.toUpperCase()) }); setGroupeId('__adhoc') }} />
      )}
      {articleEdite && propositions.get(articleEdite.reference_article) && (
        <ArticleManuelModal article={articleEdite} fournisseur={articleEdite.fournisseur_principal ? fournMap.get(articleEdite.fournisseur_principal) : undefined}
          prop={propositions.get(articleEdite.reference_article)!} ctxProp={ctxProp}
          onClose={() => setEditRef(null)} onSaved={(a) => { onArticleChange(a); setEditRef(null) }} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────

function normaliserProfil(r: ProfilConso): ProfilConso {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    reference_article: r.reference_article,
    mu12: n(r.mu12), sigma12: n(r.sigma12), mu3: n(r.mu3), mu_fut3: n(r.mu_fut3),
    fut3_debut: r.fut3_debut ? String(r.fut3_debut).slice(0, 10) : null, nb_mois_ecretes: n(r.nb_mois_ecretes),
    conso_source: estConsoSource(r.conso_source) ? r.conso_source : null, conso_coef: n(r.conso_coef), strategie_appro: r.strategie_appro || null,
  }
}

/** Profils de conso (v_appro_article_conso_profil) ; null si la vue n'existe pas encore (migration non appliquée). */
async function chargerProfils(): Promise<ProfilConso[] | null> {
  const acc: ProfilConso[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('v_appro_article_conso_profil').select('*').order('reference_article').range(from, from + pageSize - 1)
    if (error) return null
    const batch = (data || []) as ProfilConso[]
    acc.push(...batch.map(normaliserProfil))
    if (batch.length < pageSize) break
    from += pageSize
  }
  return acc
}

type OngletPrincipal = 'fournisseurs' | 'calcul'

export default function CalculBesoinApproPage() {
  const [onglet, setOnglet] = useState<OngletPrincipal>('calcul')
  const [fournisseurs, setFournisseurs] = useState<FournRow[]>([])
  const [articles, setArticles] = useState<ArtRow[]>([])
  const [profils, setProfils] = useState<Map<string, ProfilConso>>(new Map())
  const [profilsOk, setProfilsOk] = useState(true)
  const [strategies, setStrategies] = useState<StrategieRef[]>([])
  const [parametres, setParametres] = useState<Parametre[]>([])
  const [paramsFourn, setParamsFourn] = useState<Map<string, ParamsFourn>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  /** Paramètres d'appro par fournisseur (appro_fournisseur_strategie) — rechargés après enregistrement d'une fiche. */
  const chargerParamsFourn = useCallback(async () => {
    const { data } = await supabase.from('appro_fournisseur_strategie').select('*').limit(5000)
    setParamsFourn(new Map(((data || []) as ParamsFourn[]).map((r) => [r.fournisseur, {
      ...r,
      conso_source: estConsoSource(r.conso_source) ? r.conso_source : null,
      conso_coef: r.conso_coef === null || r.conso_coef === undefined ? null : Number(r.conso_coef),
    }])))
  }, [])

  const chargerTout = useCallback(async () => {
    setLoading(true); setError(null); setLoadProgress(0)
    try {
      const [f, s, p] = await Promise.all([
        chargerFournisseurs(),
        supabase.from('appro_strategie_ref').select('*').order('ordre').then(({ data }) => (data || []) as StrategieRef[]),
        supabase.from('appro_parametres').select('*').order('cle').then(({ data }) => (data || []) as Parametre[]),
        chargerParamsFourn(),
      ])
      setFournisseurs(f); setStrategies(s); setParametres(p)
      const [a, pr] = await Promise.all([chargerArticles(setLoadProgress), chargerProfils()])
      setProfilsOk(pr !== null)
      setProfils(new Map((pr || []).map((x) => [x.reference_article, x])))
      setArticles(a)
    } catch (e) {
      setError(messageErreur(e))
    } finally { setLoading(false) }
  }, [chargerParamsFourn])

  useEffect(() => { void chargerTout() }, [chargerTout])

  const onArticleChange = useCallback((a: ArtRow) => setArticles((prev) => prev.map((x) => (x.reference_article === a.reference_article ? a : x))), [])
  const onArticlePatch = useCallback((ref: string, patch: Partial<ArtRow>) => setArticles((prev) => prev.map((x) => (x.reference_article === ref ? { ...x, ...patch } : x))), [])
  const onProfilPatch = useCallback((ref: string, patch: Partial<ProfilConso>) => setProfils((prev) => {
    const actuel = prev.get(ref)
    if (!actuel) return prev
    const next = new Map(prev); next.set(ref, { ...actuel, ...patch }); return next
  }), [])
  const onProfilSet = useCallback((p: ProfilConso) => setProfils((prev) => { const next = new Map(prev); next.set(p.reference_article, p); return next }), [])
  const onFournisseurChange = useCallback((r: FournRow) => setFournisseurs((prev) => prev.map((x) => (x.numero === r.numero ? r : x))), [])

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight text-[#111820]">Calcul de besoin - Appro</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OngletTab active={onglet === 'fournisseurs'} onClick={() => setOnglet('fournisseurs')} label="Fournisseurs : liste & paramètres" />
            <OngletTab active={onglet === 'calcul'} onClick={() => setOnglet('calcul')} label="Calcul de besoin - Articles" />
            <button type="button" onClick={() => void chargerTout()} disabled={loading} title="Recharger les données" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {onglet === 'fournisseurs' && (
          <OngletFournisseurs rows={fournisseurs} loading={loading} error={error} strategies={strategies} articles={articles}
            onRowChange={onFournisseurChange} onStrategieSaved={() => void chargerParamsFourn()} />
        )}
        {onglet === 'calcul' && (
          <OngletCalculBesoin articles={articles} fournisseurs={fournisseurs} paramsFourn={paramsFourn} profils={profils} profilsOk={profilsOk}
            strategies={strategies} loading={loading} loadProgress={loadProgress} error={error}
            parametres={parametres} onParametresChange={setParametres}
            onArticleChange={onArticleChange} onArticlePatch={onArticlePatch} onProfilPatch={onProfilPatch} onProfilSet={onProfilSet}
            onFournisseurChange={onFournisseurChange} onStrategieSaved={() => void chargerParamsFourn()} onRecharger={chargerTout} />
        )}
      </div>
    </main>
  )
}
