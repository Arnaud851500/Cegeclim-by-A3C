'use client'

/**
 * Écran "Clients SAGE / BLG"
 * ---------------------------------------------------------------------------
 * 3 onglets :
 *  - SAGE : liste pleine largeur des clients (tiers_complet + adresses de
 *    livraison + mode d'expédition résolu) ; colonnes au choix et ordonnables
 *    (mémorisées dans le navigateur), filtres avancés sur n'importe quel champ
 *    (mémorisés eux aussi), fiche client en fenêtre flottante au clic, export
 *    Excel strictement identique à l'écran (colonnes, filtres, tri).
 *  - BLG : même principe côté BLG uniquement (partner_base_partner via BLG),
 *    pour les tiers déjà appariés avec SAGE.
 *  - Comparaison : contrôle de cohérence SAGE ↔ BLG. Tous les tiers sont
 *    chargés une fois puis évalués côté navigateur avec les règles tolérantes
 *    (evaluerPaire) : pastilles par champ SAGE (n° + désignation, nb d'écarts
 *    rouges / oranges) qui filtrent la liste et ajoutent des colonnes SAGE /
 *    BLG, fenêtre flottante par tiers avec la totalité des champs comparés,
 *    panneau de mapping manuel, synchro à la demande et export Excel des
 *    tiers filtrés (même évaluation que l'écran).
 *
 * Les 3 listes de gauche (SAGE / BLG / Comparaison) se naviguent au clavier
 * avec les flèches ↑ / ↓ une fois la liste focus (clic ou tabulation dessus).
 *
 * MàJ (banque + corrections de mapping) :
 *  - Nouveau bloc Banque comparé automatiquement : nom de banque et IBAN/BBAN
 *    (public.ref_tiers.banque_nom / banque_bban ↔ blg.ref_tiers_blg.banque /
 *    iban). Le BIC et la ville de l'agence bancaire restent non comparables
 *    tant que SAGE ne les exporte pas.
 *  - "Attestation de capacité" repassée en comparaison automatique (existait
 *    déjà des deux côtés, simplement pas exposée côté BLG jusqu'ici).
 *  - "Catégorie AF/GAF" traitée comme "Qualité" : c'est un tag BLG affiché
 *    à titre indicatif, pas un champ comparable à l'identique.
 *  - "Agence de rattachement" : la piste "division BLG" a été vérifiée et
 *    invalidée (la division BLG est l'entité juridique de facturation,
 *    quasi toujours "CEGECLIM (siège)", elle ne varie pas par agence
 *    physique). Le champ reste donc en comparaison manuelle ; `blg_division`
 *    est conservé en colonne informative uniquement.
 *  - Le bug qui faisait que "Routage promo" et "Facture électronique"
 *    n'étaient jamais comptés comme écarts (alors que marqués "auto" dans
 *    le mapping) a été corrigé côté vue SQL.
 *
 * MàJ (export Comparaison — règles de comparaison tolérantes) :
 *  - Qualité et Catégorie AF/GAF ↔ Tags BLG : contrôle réel désormais (vert
 *    si la chaîne SAGE se retrouve dans les tags BLG, rouge sinon).
 *  - Adresse / Code postal / Ville regroupés côte à côte. Adresse et Ville
 *    comparées de façon tolérante (abréviations de voie, accents, tirets,
 *    "ST" → "SAINT", "CEDEX xx" ignoré, une lettre d'écart tolérée).
 *  - Téléphone normalisé (+33 / 0033 → 0, ponctuation ignorée).
 *  - SIRET et TVA intra : rouge si le SIREN (9 chiffres) diffère, orange si
 *    SIREN identique mais valeur globale différente, vert sinon.
 *  - Représentant : préfixe agence SAGE absorbé (ARCCASASSUS ⊃ CASASSUS) et
 *    une lettre d'écart tolérée par mot.
 *  - Attestation de capacité : vert si la chaîne SAGE se retrouve dans BLG.
 *  - Interlocuteur ↔ Contact principal : vert dès qu'un nom/prénom est commun.
 *  - Contacts (liste nominative), nombre d'adresses de livraison et adresse de
 *    livraison principale (li_principal SAGE ↔ mainDelivery BLG) ajoutés aux
 *    champs contrôlés ; le rapprochement des contacts est détaillé dans la
 *    fenêtre flottante (absents de BLG, en plus dans BLG, doublons BLG).
 *  La vue SQL (champs_en_ecart) reste en comparaison stricte.
 *
 * MàJ (adresse de livraison principale + champs "BLG maître") :
 *  - Adresse de livraison principale : vert dès que le n° d'adresse concorde
 *    (le libellé n'est plus comparé : BLG porte une adresse géocodée, SAGE un
 *    texte libre). Rouge seulement si mainDelivery pointe une autre adresse.
 *  - Téléphone : indicatif international quel qu'il soit et zéro national
 *    retirés, comparaison sur les 9 derniers chiffres.
 *  - Champs numériques (encours, assurance crédit, nb adresses) : une valeur
 *    absente vaut 0 — "0" d'un côté et "rien" de l'autre = identique.
 *  - Table public.controle_champ_maitre : champs pour lesquels BLG est maître
 *    (réglage via le bouton "⚙ BLG maître" du pavé Champs contrôlés). Ces
 *    champs ne sont plus comparés : pastille verte "BLG maître", exclus des
 *    compteurs, des KPI et des filtres, verts dans l'export Excel.
 *  - Pastilles sans aucun écart : un ✓ vert remplace les deux compteurs à 0.
 *
 * Le panneau "Comparaison détaillée" et le mapping manuel restent pilotés
 * entièrement par la table champ_mapping_sage_blg : les nouveaux champs
 * bancaires / attestation / catégorie AF-GAF y apparaissent automatiquement,
 * sans code supplémentaire ici. Les seuls ajouts dans ce fichier sont : le
 * typage TS des nouvelles colonnes renvoyées par la vue, les libellés pour
 * les pastilles d'écart, et les colonnes d'export Excel.
 *
 * Nécessite le paquet "xlsx" (SheetJS) pour l'export Excel :
 * `npm install xlsx` si ce n'est pas déjà fait dans le projet.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

// ─────────────────────────────────────────────────────────────────────────
// Onglet SAGE
// ─────────────────────────────────────────────────────────────────────────

type ClientAdresseRow = {
  numero_tiers: string
  intitule: string | null
  type_tiers: string | null
  qualite: string | null
  siret: string | null
  ville_siege: string | null
  code_postal_siege: string | null
  famille: string | null
  agence_rattachement: string | null
  en_sommeil: boolean
  n_expedition_defaut: string | null
  expedition_defaut_designation: string | null
  li_no: string | null
  adresse_intitule: string | null
  li_adresse: string | null
  li_complement: string | null
  li_codepostal: string | null
  li_ville: string | null
  li_pays: string | null
  adresse_principale: boolean | null
  n_expedition_adresse: string | null
  expedition_adresse_designation: string | null
  li_telephone: string | null
  li_contact: string | null
  n_expedition_effectif: string | null
  expedition_designation: string | null
  expedition_base_calcul: string | null
  expedition_frais_port_ht: number | null
  /** Tous les champs de la fiche client (public.ref_tiers), préfixés fiche_ par la vue
   * v_sage_clients_adresse_livraison_complet — voir FICHE_CHAMPS pour la liste. */
  [fiche: `fiche_${string}`]: string | number | boolean | null | undefined
}

function safeText(v: unknown) {
  return String(v ?? '').trim()
}

function normaliserAgence(v: string | null): string | null {
  const t = safeText(v).toUpperCase()
  if (!t || t === '.') return null
  if (t.replace(/\s+/g, '') === 'LAROCHELLE') return 'LA ROCHELLE'
  return t
}

/** Colonnes à filtrer, factorisée pour être identique entre l'affichage à
 * l'écran (limité) et l'export Excel (toutes les lignes, paginé). */
function appliquerFiltresSage(
  query: any,
  params: { search: string; onlyPrincipale: boolean; exclureSommeil: boolean; familleFilter: string; agenceFilter: string; expeditionFilters: string[] },
) {
  const term = params.search.trim()
  if (term) query = query.or(`numero_tiers.ilike.%${term}%,intitule.ilike.%${term}%,li_ville.ilike.%${term}%`)
  if (params.onlyPrincipale) query = query.eq('adresse_principale', true)
  if (params.exclureSommeil) query = query.eq('en_sommeil', false)
  if (params.familleFilter) query = query.eq('famille', params.familleFilter)
  if (params.agenceFilter) query = query.ilike('agence_rattachement', `%${params.agenceFilter}%`)
  if (params.expeditionFilters.length > 0) query = query.in('expedition_designation', params.expeditionFilters)
  return query
}


/** Navigation clavier ↑/↓ générique pour les listes "N° tiers" à gauche.
 * `getIndex` retrouve l'index de la ligne actuellement sélectionnée dans
 * `rows` (comparaison propre à chaque onglet, ex. numero_tiers+li_no pour
 * SAGE, numero_tiers seul pour BLG/Comparaison). */
function creerHandlerNavigation<T>(
  rows: T[],
  selected: T | null,
  setSelected: (r: T) => void,
  getIndex: (rows: T[], selected: T | null) => number,
  refs: React.MutableRefObject<Record<number, HTMLTableRowElement | null>>,
) {
  return (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (rows.length === 0) return
    e.preventDefault()
    const currentIndex = getIndex(rows, selected)
    let nextIndex: number
    if (currentIndex === -1) nextIndex = 0
    else nextIndex = e.key === 'ArrowDown' ? Math.min(currentIndex + 1, rows.length - 1) : Math.max(currentIndex - 1, 0)
    setSelected(rows[nextIndex])
    refs.current[nextIndex]?.scrollIntoView({ block: 'nearest' })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet SAGE — liste pleine largeur, colonnes choisies (mémorisées), filtres
// avancés sur n'importe quel champ, fiche client en fenêtre flottante, export
// Excel = colonnes et lignes affichées.
// ─────────────────────────────────────────────────────────────────────────

type ColonneSage = {
  key: keyof ClientAdresseRow
  label: string
  /** Valeur texte (affichage, filtres et export). */
  texte: (r: ClientAdresseRow) => string
  /** Valeur pour le tri (nombre ou texte). */
  tri?: (r: ClientAdresseRow) => number | string
  align?: 'left' | 'right'
  largeur?: number
}

const COLONNES_SAGE: ColonneSage[] = [
  { key: 'numero_tiers', label: 'N° tiers', texte: (r) => safeText(r.numero_tiers), largeur: 110 },
  { key: 'intitule', label: 'Intitulé', texte: (r) => safeText(r.intitule), largeur: 260 },
  { key: 'type_tiers', label: 'Type', texte: (r) => safeText(r.type_tiers), largeur: 70 },
  { key: 'qualite', label: 'Qualité', texte: (r) => safeText(r.qualite), largeur: 120 },
  { key: 'siret', label: 'SIRET', texte: (r) => safeText(r.siret), largeur: 140 },
  { key: 'famille', label: 'Famille', texte: (r) => safeText(r.famille), largeur: 170 },
  { key: 'agence_rattachement', label: 'Agence de rattachement', texte: (r) => normaliserAgence(r.agence_rattachement) || '', largeur: 130 },
  { key: 'en_sommeil', label: 'En sommeil', texte: (r) => (r.en_sommeil ? 'Oui' : 'Non'), largeur: 90 },
  { key: 'code_postal_siege', label: 'Code postal siège', texte: (r) => safeText(r.code_postal_siege), largeur: 100 },
  { key: 'ville_siege', label: 'Ville du siège', texte: (r) => safeText(r.ville_siege), largeur: 150 },
  { key: 'n_expedition_effectif', label: 'Code expédition (effectif)', texte: (r) => safeText(r.n_expedition_effectif), largeur: 90 },
  { key: 'expedition_designation', label: "Mode d'expédition (effectif)", texte: (r) => safeText(r.expedition_designation), largeur: 150 },
  { key: 'expedition_base_calcul', label: 'Base de calcul frais de port', texte: (r) => safeText(r.expedition_base_calcul), largeur: 150 },
  {
    key: 'expedition_frais_port_ht',
    label: 'Frais de port prévu HT',
    texte: (r) => (r.expedition_frais_port_ht !== null && r.expedition_frais_port_ht !== undefined ? `${Number(r.expedition_frais_port_ht).toFixed(2)} €` : ''),
    tri: (r) => (r.expedition_frais_port_ht === null || r.expedition_frais_port_ht === undefined ? -1 : Number(r.expedition_frais_port_ht)),
    align: 'right',
    largeur: 110,
  },
  { key: 'adresse_principale', label: 'Adresse principale', texte: (r) => (r.adresse_principale ? 'Oui' : 'Non'), largeur: 100 },
  { key: 'li_no', label: 'N° adresse', texte: (r) => safeText(r.li_no), largeur: 80 },
  { key: 'adresse_intitule', label: 'Intitulé adresse', texte: (r) => safeText(r.adresse_intitule), largeur: 200 },
  { key: 'li_adresse', label: 'Adresse', texte: (r) => safeText(r.li_adresse), largeur: 220 },
  { key: 'li_complement', label: 'Complément adresse', texte: (r) => safeText(r.li_complement), largeur: 180 },
  { key: 'li_codepostal', label: 'Code postal livraison', texte: (r) => safeText(r.li_codepostal), largeur: 100 },
  { key: 'li_ville', label: 'Ville livraison', texte: (r) => safeText(r.li_ville), largeur: 150 },
  { key: 'li_pays', label: 'Pays', texte: (r) => safeText(r.li_pays), largeur: 90 },
  { key: 'li_contact', label: 'Contact livraison', texte: (r) => safeText(r.li_contact), largeur: 160 },
  { key: 'li_telephone', label: 'Téléphone livraison', texte: (r) => safeText(r.li_telephone), largeur: 130 },
  { key: 'n_expedition_adresse', label: 'Code expédition adresse', texte: (r) => safeText(r.n_expedition_adresse), largeur: 90 },
  { key: 'expedition_adresse_designation', label: "Mode d'expédition (adresse seule)", texte: (r) => safeText(r.expedition_adresse_designation), largeur: 150 },
  { key: 'n_expedition_defaut', label: 'Code expédition défaut client', texte: (r) => safeText(r.n_expedition_defaut), largeur: 90 },
  { key: 'expedition_defaut_designation', label: "Mode d'expédition (défaut client seul)", texte: (r) => safeText(r.expedition_defaut_designation), largeur: 150 },
]

/** Champs de la fiche client SAGE (public.ref_tiers) exposés par la vue « complet » :
 * [colonne sans le préfixe fiche_, libellé, type]. Même liste que le champ « SAGE »
 * des filtres avancés de l'onglet Comparaison, en libellés lisibles. */
const FICHE_CHAMPS: Array<[string, string, 'texte' | 'nombre' | 'booleen' | 'date']> = [
  ['prospect', 'Prospect', 'booleen'],
  ['abrege', 'Abrégé', 'texte'],
  ['contact', 'Contact (fiche)', 'texte'],
  ['adresse', 'Adresse (siège)', 'texte'],
  ['complement_adresse', 'Complément adresse (siège)', 'texte'],
  ['code_postal', 'Code postal (siège)', 'texte'],
  ['ville', 'Ville (siège)', 'texte'],
  ['region', 'Région', 'texte'],
  ['pays', 'Pays (siège)', 'texte'],
  ['telephone', 'Téléphone (fiche)', 'texte'],
  ['telecopie', 'Télécopie', 'texte'],
  ['linkedin', 'LinkedIn', 'texte'],
  ['facebook', 'Facebook', 'texte'],
  ['email', 'E-mail', 'texte'],
  ['site', 'Site web', 'texte'],
  ['numero_identifiant', 'N° identifiant (TVA)', 'texte'],
  ['code_naf', 'Code NAF', 'texte'],
  ['payeur', 'Payeur', 'texte'],
  ['representant', 'Représentant', 'texte'],
  ['centrale_achat', "Centrale d'achat", 'texte'],
  ['categorie_tarifaire', 'Catégorie tarifaire', 'texte'],
  ['encours_autorise', 'Encours autorisé', 'nombre'],
  ['assurance_credit', 'Assurance crédit', 'nombre'],
  ['depot_rattachement', 'Dépôt de rattachement', 'texte'],
  ['code_affaire', 'Code affaire', 'texte'],
  ['devise', 'Devise', 'texte'],
  ['langue', 'Langue', 'texte'],
  ['raccourci', 'Raccourci', 'texte'],
  ['code_edi', 'Code EDI', 'texte'],
  ['categorie_comptable', 'Catégorie comptable', 'texte'],
  ['exclure_traitements_marketing', 'Exclure des traitements marketing', 'booleen'],
  ['date_creation', 'Date de création', 'date'],
  ['donnees_effacees', 'Données effacées', 'booleen'],
  ['solde_comptable', 'Solde comptable', 'nombre'],
  ['portefeuille_bl_fa', 'Portefeuille BL / FA', 'nombre'],
  ['portefeuille_bc_pl', 'Portefeuille BC / PL', 'nombre'],
  ['code_risque', 'Code risque', 'texte'],
  ['objectif_ca', 'Objectif CA', 'nombre'],
  ['qualite_relationnelle', 'Qualité relationnelle', 'texte'],
  ['remise_hit', 'Remise HIT', 'nombre'],
  ['remise_acc', 'Remise ACC', 'nombre'],
  ['rge', 'RGE', 'texte'],
  ['convention_cee', 'Convention CEE', 'texte'],
  ['indicateur_technique', 'Indicateur technique', 'texte'],
  ['indicateur_etude', 'Indicateur étude', 'texte'],
  ['indicateur_commerce', 'Indicateur commerce', 'texte'],
  ['client_pv', 'Client PV', 'texte'],
  ['attestation_capacite', 'Attestation de capacité', 'texte'],
  ['capacite_expiration', 'Expiration capacité', 'date'],
  ['groupement', 'Groupement', 'texte'],
  ['convention_nationaux', 'Convention nationaux', 'texte'],
  ['convention_client_cgclim', 'Convention client CGCLIM', 'texte'],
  ['station_technique', 'Station technique', 'texte'],
  ['openbee', 'Openbee', 'texte'],
  ['logiciels', 'Logiciels', 'texte'],
  ['frais_facturation', 'Frais de facturation', 'texte'],
  ['assurance_credit_2', 'Assurance crédit 2', 'texte'],
  ['routage_promo', 'Routage promo', 'texte'],
  ['facture_email', 'Facture par e-mail', 'texte'],
  ['particularite_logistique', 'Particularité logistique', 'texte'],
  ['releve_facture', 'Relevé de facture', 'texte'],
  ['type_facture', 'Type de facture', 'texte'],
  ['particularite_facturation', 'Particularité facturation', 'texte'],
  ['categorie_af_gaf', 'Catégorie AF / GAF', 'texte'],
  ['email_routage', 'E-mail routage', 'texte'],
  ['client_cfluide', 'Client CFluide', 'texte'],
  ['tarifs_exception', "Tarifs d'exception", 'texte'],
  ['gyutaki5', 'Gyutaki 5', 'texte'],
  ['g5pm_g10', 'G5PM / G10', 'texte'],
  ['ti_ctcommentaire', 'Commentaire tiers (SAGE)', 'texte'],
  ['ti_ctcontrolenc', 'Contrôle encours (SAGE)', 'texte'],
  ['blg_id_tiers', 'Id tiers BLG', 'texte'],
  ['lien_blg_tiers', 'Lien BLG tiers', 'texte'],
  ['banque_nom', 'Banque', 'texte'],
  ['banque_bban', 'IBAN / BBAN', 'texte'],
  ['updated_at', 'Fiche mise à jour le', 'date'],
]

function formatFicheValeur(v: unknown, type: 'texte' | 'nombre' | 'booleen' | 'date'): string {
  if (v === null || v === undefined || v === '') return ''
  if (type === 'booleen') return v === true || v === 'true' || v === 1 ? 'Oui' : 'Non'
  if (type === 'date') {
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
  }
  if (type === 'nombre') {
    const n = Number(v)
    return Number.isFinite(n) ? n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(v)
  }
  return String(v).trim()
}

FICHE_CHAMPS.forEach(([col, label, type]) => {
  const key = `fiche_${col}` as keyof ClientAdresseRow
  COLONNES_SAGE.push({
    key,
    label,
    texte: (r) => formatFicheValeur(r[key], type),
    tri: type === 'nombre' ? (r) => (r[key] === null || r[key] === undefined || r[key] === '' ? -Infinity : Number(r[key])) : undefined,
    align: type === 'nombre' ? 'right' : 'left',
    largeur: type === 'texte' ? 150 : 110,
  })
})

const COLONNES_SAGE_PAR_DEFAUT: Array<keyof ClientAdresseRow> = [
  'numero_tiers', 'intitule', 'agence_rattachement', 'famille', 'li_ville', 'expedition_designation', 'expedition_frais_port_ht', 'en_sommeil',
]

/** Réglages mémorisés dans le navigateur (colonnes affichées, filtres avancés). */
const STOCKAGE_SAGE_CLE = 'clients-sage-blg.onglet-sage.v1'
type ReglagesSage = { colonnes: string[]; conditions: ConditionSage[]; logique: 'et' | 'ou' }

type OperateurSage = 'egal' | 'different' | 'contient' | 'ne_contient_pas' | 'commence_par' | 'est_vide' | 'non_vide' | 'superieur' | 'inferieur'
type ConditionSage = { id: string; champ: string; operateur: OperateurSage; valeur: string }

const OPERATEUR_SAGE_LABELS: Record<OperateurSage, string> = {
  egal: 'est égal à',
  different: 'est différent de',
  contient: 'contient',
  ne_contient_pas: 'ne contient pas',
  commence_par: 'commence par',
  est_vide: 'est vide',
  non_vide: "n'est pas vide",
  superieur: 'est supérieur à',
  inferieur: 'est inférieur à',
}
const OPERATEURS_SANS_VALEUR: OperateurSage[] = ['est_vide', 'non_vide']

function nouvelleConditionSage(): ConditionSage {
  return { id: Math.random().toString(36).slice(2), champ: 'intitule', operateur: 'contient', valeur: '' }
}

function normaliserTexteFiltre(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

function nombreDe(v: string): number | null {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.').replace('€', ''))
  return Number.isFinite(n) ? n : null
}

/** Évalue une condition sur la valeur texte de la colonne (accents et casse ignorés). */
function conditionSatisfaite(c: ConditionSage, r: ClientAdresseRow): boolean {
  const col = COLONNES_SAGE.find((x) => x.key === c.champ)
  if (!col) return true
  const brut = col.texte(r)
  const val = normaliserTexteFiltre(brut)
  const att = normaliserTexteFiltre(c.valeur)
  switch (c.operateur) {
    case 'est_vide': return val === ''
    case 'non_vide': return val !== ''
    case 'egal': return val === att
    case 'different': return val !== att
    case 'contient': return val.includes(att)
    case 'ne_contient_pas': return !val.includes(att)
    case 'commence_par': return val.startsWith(att)
    case 'superieur': {
      const a = col.tri ? Number(col.tri(r)) : nombreDe(brut)
      const b = nombreDe(c.valeur)
      return a !== null && b !== null && a > b
    }
    case 'inferieur': {
      const a = col.tri ? Number(col.tri(r)) : nombreDe(brut)
      const b = nombreDe(c.valeur)
      return a !== null && b !== null && a < b
    }
    default: return true
  }
}

function chargerReglagesSage(): ReglagesSage {
  const defaut: ReglagesSage = { colonnes: COLONNES_SAGE_PAR_DEFAUT, conditions: [], logique: 'et' }
  if (typeof window === 'undefined') return defaut
  try {
    const brut = window.localStorage.getItem(STOCKAGE_SAGE_CLE)
    if (!brut) return defaut
    const parse = JSON.parse(brut) as Partial<ReglagesSage>
    const cles = new Set(COLONNES_SAGE.map((c) => c.key as string))
    const colonnes = Array.isArray(parse.colonnes) ? parse.colonnes.filter((k) => cles.has(k)) : defaut.colonnes
    const conditions = Array.isArray(parse.conditions)
      ? parse.conditions.filter((c) => c && typeof c === 'object' && cles.has(String(c.champ))).map((c) => ({ ...nouvelleConditionSage(), ...c }))
      : []
    return { colonnes: colonnes.length ? colonnes : defaut.colonnes, conditions, logique: parse.logique === 'ou' ? 'ou' : 'et' }
  } catch {
    return defaut
  }
}

function OngletSage() {
  const [rows, setRows] = useState<ClientAdresseRow[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const [search, setSearch] = useState('')
  const [agenceFilter, setAgenceFilter] = useState('')
  const [familleFilter, setFamilleFilter] = useState('')
  const [expeditionFilters, setExpeditionFilters] = useState<string[]>([])
  const [expeditionOuvert, setExpeditionOuvert] = useState(false)
  const [onlyPrincipale, setOnlyPrincipale] = useState(true)
  const [exclureSommeil, setExclureSommeil] = useState(true)

  // Réglages mémorisés : colonnes affichées + filtres avancés
  const [colonnes, setColonnes] = useState<string[]>(COLONNES_SAGE_PAR_DEFAUT)
  const [conditions, setConditions] = useState<ConditionSage[]>([])
  const [logique, setLogique] = useState<'et' | 'ou'>('et')
  const [reglagesCharges, setReglagesCharges] = useState(false)
  const [colonnesOuvert, setColonnesOuvert] = useState(false)
  const [rechercheColonne, setRechercheColonne] = useState('')

  const [tri, setTri] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'numero_tiers', dir: 'asc' })
  const [selected, setSelected] = useState<ClientAdresseRow | null>(null)

  const [agenceOptions, setAgenceOptions] = useState<string[]>([])
  const [familleOptions, setFamilleOptions] = useState<string[]>([])
  const [expeditionOptions, setExpeditionOptions] = useState<string[]>([])

  const expeditionRef = useRef<HTMLDivElement>(null)
  const colonnesRef = useRef<HTMLDivElement>(null)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  // Lecture des réglages mémorisés (une fois, côté navigateur)
  useEffect(() => {
    const r = chargerReglagesSage()
    setColonnes(r.colonnes)
    setConditions(r.conditions)
    setLogique(r.logique)
    setReglagesCharges(true)
  }, [])

  // Enregistrement automatique des réglages
  useEffect(() => {
    if (!reglagesCharges) return
    try {
      window.localStorage.setItem(STOCKAGE_SAGE_CLE, JSON.stringify({ colonnes, conditions, logique } satisfies ReglagesSage))
    } catch {
      /* stockage local indisponible : les réglages ne survivront pas au rechargement */
    }
  }, [colonnes, conditions, logique, reglagesCharges])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (expeditionRef.current && !expeditionRef.current.contains(e.target as Node)) setExpeditionOuvert(false)
      if (colonnesRef.current && !colonnesRef.current.contains(e.target as Node)) setColonnesOuvert(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const { data, error: err } = await supabase
        .from('v_sage_clients_adresse_livraison')
        .select('agence_rattachement,famille,expedition_designation')
        .limit(6000)
      if (cancelled || err || !data) return

      const agences = new Set<string>()
      const familles = new Set<string>()
      const expeditions = new Set<string>()
      ;(data as any[]).forEach((r) => {
        const ag = normaliserAgence(r.agence_rattachement)
        if (ag) agences.add(ag)
        const fam = safeText(r.famille)
        if (fam && fam !== 'Aucune') familles.add(fam)
        const exp = safeText(r.expedition_designation)
        if (exp) expeditions.add(exp)
      })
      setAgenceOptions(Array.from(agences).sort())
      setFamilleOptions(Array.from(familles).sort())
      setExpeditionOptions(Array.from(expeditions).sort())
    }
    void loadOptions()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        let query = supabase
          .from('v_sage_clients_adresse_livraison_complet')
          .select('*', { count: 'exact' })
          .order('numero_tiers', { ascending: true })
          .limit(10000)
        query = appliquerFiltresSage(query, { search, onlyPrincipale, exclureSommeil, familleFilter, agenceFilter, expeditionFilters })

        const { data, count, error: err } = await query
        if (cancelled) return
        if (err) throw err
        setRows((data || []) as ClientAdresseRow[])
        setTotalCount(typeof count === 'number' ? count : null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [search, agenceFilter, familleFilter, expeditionFilters, onlyPrincipale, exclureSommeil])

  // Filtres avancés (côté navigateur, sur les lignes chargées) puis tri
  const conditionsValides = useMemo(
    () => conditions.filter((c) => c.champ && (OPERATEURS_SANS_VALEUR.includes(c.operateur) || c.valeur.trim() !== '')),
    [conditions],
  )

  const rowsFiltrees = useMemo(() => {
    if (conditionsValides.length === 0) return rows
    return rows.filter((r) =>
      logique === 'et' ? conditionsValides.every((c) => conditionSatisfaite(c, r)) : conditionsValides.some((c) => conditionSatisfaite(c, r)),
    )
  }, [rows, conditionsValides, logique])

  const rowsTriees = useMemo(() => {
    const col = COLONNES_SAGE.find((c) => c.key === tri.key)
    if (!col) return rowsFiltrees
    const dir = tri.dir === 'asc' ? 1 : -1
    const val = (r: ClientAdresseRow) => (col.tri ? col.tri(r) : col.texte(r))
    return [...rowsFiltrees].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      const cmp = String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base', numeric: true })
      return (cmp || a.numero_tiers.localeCompare(b.numero_tiers)) * dir
    })
  }, [rowsFiltrees, tri])

  const colonnesAffichees = useMemo(
    () => colonnes.map((k) => COLONNES_SAGE.find((c) => c.key === k)).filter((c): c is ColonneSage => Boolean(c)),
    [colonnes],
  )

  const stats = useMemo(() => {
    const clientsDistincts = new Set(rowsFiltrees.map((r) => r.numero_tiers)).size
    const adressesPrincipales = rowsFiltrees.filter((r) => r.adresse_principale).length
    const enSommeil = rowsFiltrees.filter((r) => r.en_sommeil).length
    return { total: rowsFiltrees.length, clientsDistincts, adressesPrincipales, enSommeil }
  }, [rowsFiltrees])

  const filtresActifs = Boolean(search.trim() || agenceFilter || familleFilter || expeditionFilters.length > 0 || conditionsValides.length > 0)

  function toggleExpedition(e: string) {
    setExpeditionFilters((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]))
  }

  function toggleColonne(k: string) {
    setColonnes((prev) => {
      if (prev.includes(k)) return prev.length > 1 ? prev.filter((x) => x !== k) : prev
      // insérée à sa place dans l'ordre du catalogue
      const ordre = COLONNES_SAGE.map((c) => c.key as string)
      return [...prev, k].sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b))
    })
  }

  function deplacerColonne(k: string, sens: -1 | 1) {
    setColonnes((prev) => {
      const i = prev.indexOf(k)
      const j = i + sens
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function trierPar(k: string) {
    setTri((prev) => (prev.key === k ? { key: k, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }))
  }

  function getIndexSage(list: ClientAdresseRow[], sel: ClientAdresseRow | null) {
    if (!sel) return -1
    return list.findIndex((r) => r.numero_tiers === sel.numero_tiers && r.li_no === sel.li_no)
  }
  const onListKeyDown = creerHandlerNavigation(rowsTriees, selected, setSelected, getIndexSage, listRefs)

  /** Export Excel = ce qui est à l'écran : mêmes colonnes (dans le même ordre),
   * mêmes filtres (serveur + avancés), même tri. Si l'écran est tronqué à
   * 10 000 lignes, les lignes manquantes sont rapatriées par pages de 1 000. */
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      let base: ClientAdresseRow[] = rows
      if (totalCount !== null && totalCount > rows.length) {
        const toutes: ClientAdresseRow[] = []
        let from = 0
        const pageSize = 1000
        while (true) {
          let query = supabase
            .from('v_sage_clients_adresse_livraison_complet')
            .select('*')
            .order('numero_tiers', { ascending: true })
            .range(from, from + pageSize - 1)
          query = appliquerFiltresSage(query, { search, onlyPrincipale, exclureSommeil, familleFilter, agenceFilter, expeditionFilters })
          const { data, error: err } = await query
          if (err) throw err
          const batch = (data || []) as ClientAdresseRow[]
          toutes.push(...batch)
          if (batch.length < pageSize) break
          from += pageSize
        }
        base = toutes
      }

      const filtrees =
        conditionsValides.length === 0
          ? base
          : base.filter((r) => (logique === 'et' ? conditionsValides.every((c) => conditionSatisfaite(c, r)) : conditionsValides.some((c) => conditionSatisfaite(c, r))))

      const col = COLONNES_SAGE.find((c) => c.key === tri.key)
      const dir = tri.dir === 'asc' ? 1 : -1
      const triees = col
        ? [...filtrees].sort((a, b) => {
            const va = col.tri ? col.tri(a) : col.texte(a)
            const vb = col.tri ? col.tri(b) : col.texte(b)
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
            return (String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base', numeric: true }) || a.numero_tiers.localeCompare(b.numero_tiers)) * dir
          })
        : filtrees

      const feuille = triees.map((r) => {
        const ligne: Record<string, string | number> = {}
        colonnesAffichees.forEach((c) => {
          if (c.key === 'expedition_frais_port_ht') {
            ligne[c.label] = r.expedition_frais_port_ht === null || r.expedition_frais_port_ht === undefined ? '' : Number(r.expedition_frais_port_ht)
          } else if (c.align === 'right' && r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== '' && Number.isFinite(Number(r[c.key]))) {
            ligne[c.label] = Number(r[c.key])
          } else {
            ligne[c.label] = c.texte(r)
          }
        })
        return ligne
      })

      const ws = XLSX.utils.json_to_sheet(feuille, { header: colonnesAffichees.map((c) => c.label) })
      ws['!cols'] = colonnesAffichees.map((c) => ({ wch: Math.max(12, Math.round((c.largeur ?? 120) / 7)) }))
      ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, colonnesAffichees.length - 1))}${feuille.length + 1}` }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Clients SAGE')
      XLSX.writeFile(wb, `clients_sage_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportEnCours(false)
    }
  }

  const champStyle = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]'

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Lignes affichées" value={stats.total} loading={loading} />
        <KpiCard label="Clients distincts" value={stats.clientsDistincts} loading={loading} />
        <KpiCard label="Adresses principales" value={stats.adressesPrincipales} loading={loading} tone="ok" />
        <KpiCard label="Dont en sommeil" value={stats.enSommeil} loading={loading} tone="warn" />
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° tiers, raison sociale ou ville…"
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2"
          />
          <select
            value={agenceFilter}
            onChange={(e) => setAgenceFilter(e.target.value)}
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
          >
            <option value="">Agence : Toutes</option>
            {agenceOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={familleFilter}
            onChange={(e) => setFamilleFilter(e.target.value)}
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
          >
            <option value="">Famille : Toutes</option>
            {familleOptions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-4">
          {/* Sélection MULTIPLE des modes d'expédition -- menu à cases à cocher */}
          <div className="relative md:col-span-2" ref={expeditionRef}>
            <button
              type="button"
              onClick={() => setExpeditionOuvert((v) => !v)}
              className="flex h-10 w-full items-center justify-between rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
            >
              <span>{expeditionFilters.length === 0 ? "Mode d'expédition : Tous" : `Mode d'expédition (${expeditionFilters.length} sélectionné${expeditionFilters.length > 1 ? 's' : ''})`}</span>
              <span className="text-[#8A8474]">{expeditionOuvert ? '▲' : '▼'}</span>
            </button>
            {expeditionOuvert && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[#E5E1D8] bg-white p-1.5 shadow-lg">
                {expeditionFilters.length > 0 && (
                  <button type="button" onClick={() => setExpeditionFilters([])} className="mb-1 w-full rounded px-2 py-1 text-left text-[12px] font-bold text-[#B4761A] hover:underline">
                    Tout désélectionner
                  </button>
                )}
                {expeditionOptions.map((e) => (
                  <label key={e} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-[#F4F3F0]">
                    <input type="checkbox" checked={expeditionFilters.includes(e)} onChange={() => toggleExpedition(e)} className="accent-[#B4761A]" />
                    {e}
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={onlyPrincipale} onChange={(e) => setOnlyPrincipale(e.target.checked)} className="accent-[#B4761A]" />
            Adresses principales uniquement
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
            Exclure les tiers en sommeil
          </label>
        </div>

        {/* ---- Filtres avancés sur n'importe quel champ (mémorisés) ---- */}
        <div className="mt-3 border-t border-[#E5E1D8] pt-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
              Filtres avancés <span className="font-normal normal-case tracking-normal">— sur tous les champs, mémorisés pour la prochaine fois</span>
            </div>
            {conditions.length >= 2 && (
              <div className="flex items-center gap-1 text-[12px] font-semibold text-[#3A362E]">
                Combiner avec :
                <button type="button" onClick={() => setLogique('et')} className={`rounded px-2 py-0.5 ${logique === 'et' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>ET</button>
                <button type="button" onClick={() => setLogique('ou')} className={`rounded px-2 py-0.5 ${logique === 'ou' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>OU</button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {conditions.map((c) => (
              <div key={c.id} className="grid grid-cols-[minmax(200px,1fr)_180px_minmax(200px,1fr)_32px] gap-2">
                <select value={c.champ} onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, champ: e.target.value } : x)))} className={champStyle}>
                  <optgroup label="Adresse de livraison et expédition">
                    {COLONNES_SAGE.filter((col) => !String(col.key).startsWith('fiche_')).map((col) => (
                      <option key={col.key} value={col.key}>{col.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Fiche client (tous les champs SAGE)">
                    {COLONNES_SAGE.filter((col) => String(col.key).startsWith('fiche_')).map((col) => (
                      <option key={col.key} value={col.key}>{col.label}</option>
                    ))}
                  </optgroup>
                </select>
                <select value={c.operateur} onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, operateur: e.target.value as OperateurSage } : x)))} className={champStyle}>
                  {(Object.entries(OPERATEUR_SAGE_LABELS) as [OperateurSage, string][]).map(([op, label]) => (
                    <option key={op} value={op}>{label}</option>
                  ))}
                </select>
                <input
                  value={c.valeur}
                  onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, valeur: e.target.value } : x)))}
                  disabled={OPERATEURS_SANS_VALEUR.includes(c.operateur)}
                  placeholder="Valeur…"
                  className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-medium outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]"
                />
                <button
                  type="button"
                  onClick={() => setConditions((prev) => prev.filter((x) => x.id !== c.id))}
                  className="flex h-9 items-center justify-center rounded-lg border border-[#E5E1D8] text-[#8A8474] hover:border-red-300 hover:text-red-600"
                  title="Retirer cette condition"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={() => setConditions((prev) => [...prev, nouvelleConditionSage()])} className="mt-2 text-[12px] font-bold text-[#B4761A] hover:underline">
            + Ajouter une condition
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
          <div className="flex items-center gap-3">
            {filtresActifs ? (
              <button
                type="button"
                onClick={() => { setSearch(''); setAgenceFilter(''); setFamilleFilter(''); setExpeditionFilters([]); setConditions([]) }}
                className="text-[12px] font-bold text-[#B4761A] hover:underline"
              >
                Réinitialiser les filtres
              </button>
            ) : <span />}
            {error && <span className="text-[12px] font-semibold text-red-600">{error}</span>}
          </div>

          <div className="flex items-center gap-2">
            {/* ---- Choix des colonnes (mémorisé) ---- */}
            <div className="relative" ref={colonnesRef}>
              <button
                type="button"
                onClick={() => setColonnesOuvert((v) => !v)}
                className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]"
              >
                ☰ Colonnes ({colonnesAffichees.length}/{COLONNES_SAGE.length})
                <span className="text-[#8A8474]">{colonnesOuvert ? '▲' : '▼'}</span>
              </button>
              {colonnesOuvert && (
                <div className="absolute right-0 z-30 mt-1 max-h-[420px] w-[380px] overflow-auto rounded-lg border border-[#E5E1D8] bg-white p-1.5 shadow-lg">
                  <div className="mb-1 flex items-center justify-between px-2 py-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs affichés (ordre de la liste)</span>
                    <button type="button" onClick={() => setColonnes(COLONNES_SAGE_PAR_DEFAUT)} className="text-[11px] font-bold text-[#B4761A] hover:underline">
                      Par défaut
                    </button>
                  </div>
                  {colonnesAffichees.map((c, i) => (
                    <div key={c.key} className="flex items-center gap-1 rounded px-2 py-1 text-[13px] hover:bg-[#F4F3F0]">
                      <label className="flex flex-1 cursor-pointer items-center gap-2">
                        <input type="checkbox" checked onChange={() => toggleColonne(c.key)} className="accent-[#B4761A]" />
                        {c.label}
                      </label>
                      <button type="button" onClick={() => deplacerColonne(c.key, -1)} disabled={i === 0} className="rounded px-1 text-[11px] text-[#8A8474] hover:bg-white disabled:opacity-30" title="Monter">▲</button>
                      <button type="button" onClick={() => deplacerColonne(c.key, 1)} disabled={i === colonnesAffichees.length - 1} className="rounded px-1 text-[11px] text-[#8A8474] hover:bg-white disabled:opacity-30" title="Descendre">▼</button>
                    </div>
                  ))}
                  <div className="mt-1 border-t border-[#E5E1D8] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs disponibles</div>
                  <input
                    value={rechercheColonne}
                    onChange={(e) => setRechercheColonne(e.target.value)}
                    placeholder="Rechercher un champ…"
                    className="mb-1 h-8 w-full rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] outline-none focus:border-[#B4761A]"
                  />
                  {(['adresse', 'fiche'] as const).map((groupe) => {
                    const dispo = COLONNES_SAGE.filter(
                      (c) => !colonnes.includes(c.key) && (groupe === 'fiche') === String(c.key).startsWith('fiche_') && (!rechercheColonne.trim() || normaliserTexteFiltre(c.label).includes(normaliserTexteFiltre(rechercheColonne))),
                    )
                    if (dispo.length === 0) return null
                    return (
                      <div key={groupe}>
                        <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-[#B4761A]">
                          {groupe === 'adresse' ? 'Adresse de livraison et expédition' : 'Fiche client (tous les champs SAGE)'}
                        </div>
                        {dispo.map((c) => (
                          <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-[#F4F3F0]">
                            <input type="checkbox" checked={false} onChange={() => toggleColonne(c.key)} className="accent-[#B4761A]" />
                            {c.label}
                          </label>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void exporterExcel()}
              disabled={exportEnCours || loading}
              className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60"
              title="Exporte exactement les colonnes et les lignes affichées"
            >
              {exportEnCours ? 'Export en cours…' : '⬇ Exporter en Excel (comme à l’écran)'}
            </button>
          </div>
        </div>
      </section>

      {/* ---- Liste pleine largeur ---- */}
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading
              ? 'Chargement…'
              : totalCount !== null && totalCount > rows.length
                ? `${rowsFiltrees.length} affiché(s) sur ${totalCount} au total — affinez la recherche pour voir le reste`
                : `${rowsFiltrees.length} résultat${rowsFiltrees.length > 1 ? 's' : ''}${conditionsValides.length ? ` (${rows.length} avant filtres avancés)` : ''}`}
          </div>
          <div className="text-[11px] text-[#8A8474]">Cliquez une ligne pour ouvrir la fiche · ↑ ↓ pour passer d’une fiche à l’autre</div>
        </div>
        <div
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className="max-h-[75vh] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50"
        >
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                {colonnesAffichees.map((c) => {
                  const actif = tri.key === c.key
                  return (
                    <th
                      key={c.key}
                      onClick={() => trierPar(c.key)}
                      style={{ minWidth: c.largeur }}
                      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold hover:text-[#111820] ${c.align === 'right' ? 'text-right' : ''} ${actif ? 'text-[#111820]' : ''}`}
                      title="Trier"
                    >
                      {c.label}
                      <span className={`ml-1 text-[9px] ${actif ? 'opacity-100' : 'opacity-0'}`}>{tri.dir === 'asc' ? '▲' : '▼'}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rowsTriees.map((r, i) => {
                const key = `${r.numero_tiers}-${r.li_no ?? i}`
                const isSelected = selected && selected.numero_tiers === r.numero_tiers && selected.li_no === r.li_no
                return (
                  <tr
                    key={key}
                    ref={(el) => { listRefs.current[i] = el }}
                    onClick={() => setSelected(r)}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${isSelected ? 'bg-[#B4761A]/[0.06]' : ''}`}
                  >
                    {colonnesAffichees.map((c) => {
                      if (c.key === 'numero_tiers') {
                        return (
                          <td key={c.key} className="whitespace-nowrap px-3 py-2">
                            <span className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</span>
                            {r.adresse_principale && !colonnes.includes('adresse_principale') && (
                              <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Principale</span>
                            )}
                            {r.en_sommeil && !colonnes.includes('en_sommeil') && (
                              <span className="ml-1.5 rounded-full bg-[#F4F3F0] px-1.5 py-0.5 text-[10px] font-bold text-[#8A8474]">Sommeil</span>
                            )}
                          </td>
                        )
                      }
                      const texte = c.texte(r)
                      const badge =
                        c.key === 'en_sommeil' ? (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${r.en_sommeil ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{texte}</span>
                        ) : c.key === 'adresse_principale' ? (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${r.adresse_principale ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F4F3F0] text-[#8A8474]'}`}>{texte}</span>
                        ) : null
                      return (
                        <td
                          key={c.key}
                          className={`px-3 py-2 text-[12px] text-[#3A362E] ${c.align === 'right' ? 'text-right font-[var(--font-mono,monospace)]' : ''} ${c.key === 'intitule' ? 'font-semibold text-[#111820]' : ''}`}
                          style={{ maxWidth: (c.largeur ?? 160) * 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={texte}
                        >
                          {badge ?? (texte || '—')}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {!loading && rowsTriees.length === 0 && (
                <tr><td colSpan={Math.max(1, colonnesAffichees.length)} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && <ClientSageModal row={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

/** Fiche client SAGE en fenêtre flottante (même contenu que l'ancien panneau de droite). */
function ClientSageModal({ row, onClose }: { row: ClientAdresseRow; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#E5E1D8] px-5 py-4">
          <div>
            <div className="font-mono text-[12px] font-bold text-[#8A8474]">{row.numero_tiers}</div>
            <div className="text-[16px] font-bold text-[#111820]">{row.intitule || '(intitulé non renseigné)'}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {row.adresse_principale && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Adresse principale</span>
              )}
              {row.en_sommeil && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">En sommeil</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#E5E1D8] px-3 py-1.5 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]" title="Fermer (Échap)">
            ✕ Fermer
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          <DetailGroup title="Expédition retenue (adresse si renseignée, sinon défaut client)">
            <DetailRow label="Mode d'expédition" value={row.expedition_designation} />
            <DetailRow label="Code" value={row.n_expedition_effectif} />
            <DetailRow label="Base de calcul frais de port" value={row.expedition_base_calcul} />
            <DetailRow label="Frais de port prévu HT" value={row.expedition_frais_port_ht !== null ? `${Number(row.expedition_frais_port_ht).toFixed(2)} €` : null} />
          </DetailGroup>

          <DetailGroup title="Fiche client (SAGE)">
            <DetailRow label="Type" value={row.type_tiers} />
            <DetailRow label="Qualité" value={row.qualite} />
            <DetailRow label="SIRET" value={row.siret} />
            <DetailRow label="Famille" value={row.famille} />
            <DetailRow label="Agence de rattachement" value={normaliserAgence(row.agence_rattachement)} />
            <DetailRow label="Ville du siège" value={[row.code_postal_siege, row.ville_siege].filter(Boolean).join(' ')} />
            <DetailRow label="Mode d'expédition par défaut (client)" value={row.expedition_defaut_designation ? `${row.expedition_defaut_designation} (code ${row.n_expedition_defaut})` : row.n_expedition_defaut} />
          </DetailGroup>

          <DetailGroup title="Adresse de livraison">
            <DetailRow label="N° adresse" value={row.li_no} />
            <DetailRow label="Intitulé adresse" value={row.adresse_intitule} />
            <DetailRow label="Adresse" value={[row.li_adresse, row.li_complement].filter(Boolean).join(', ')} />
            <DetailRow label="Code postal / Ville" value={[row.li_codepostal, row.li_ville].filter(Boolean).join(' ')} />
            <DetailRow label="Pays" value={row.li_pays} />
            <DetailRow label="Contact" value={row.li_contact} />
            <DetailRow label="Téléphone" value={row.li_telephone} />
            <DetailRow
              label="Mode d'expédition (adresse seule)"
              value={row.expedition_adresse_designation ? `${row.expedition_adresse_designation} (code ${row.n_expedition_adresse})` : row.n_expedition_adresse}
            />
          </DetailGroup>

          <DetailGroup title="Fiche client SAGE — tous les champs (les champs vides sont masqués)">
            {FICHE_CHAMPS.map(([col, label, type]) => {
              const texte = formatFicheValeur(row[`fiche_${col}` as keyof ClientAdresseRow], type)
              return texte ? <DetailRow key={col} label={label} value={texte} /> : null
            })}
          </DetailGroup>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : '#111820'
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      {loading ? (
        <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[#F4F3F0]" />
      ) : (
        <div className="mt-1 text-[28px] font-bold tracking-tight" style={{ color }}>{value.toLocaleString('fr-FR')}</div>
      )}
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

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[1fr_1.4fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
      <span className="font-semibold text-[#3A362E]">{label}</span>
      <span className="text-[#111820]">{value || '—'}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Types partagés SAGE ↔ BLG (onglets BLG + Comparaison)
// ─────────────────────────────────────────────────────────────────────────

type ControleRow = {
  numero_tiers: string
  blg_id_tiers: string | null
  blg_partner_id: number | null
  statut_appariement: 'apparie' | 'manquant_blg'
  sage_intitule: string | null; blg_intitule: string | null
  sage_siret: string | null; blg_siret: string | null
  sage_code_naf: string | null; blg_code_naf: string | null
  sage_code_postal: string | null; blg_code_postal: string | null
  sage_ville: string | null; blg_ville: string | null
  sage_representant: string | null; blg_commercial: string | null
  sage_encours: number | null; blg_encours: number | null
  sage_assurance_credit: number | null; blg_assurance_credit: number | null
  sage_famille: string | null; blg_famille: string | null
  sage_frais_facturation: string | null; blg_frais_facturation: string | null
  sage_routage_promo: string | null; blg_routage_promo: string | null
  sage_facture_email: string | null; blg_facture_electronique: string | null
  sage_releve_facture: string | null; blg_releve_facture: string | null
  sage_type_facture: string | null; blg_type_facture: string | null
  sage_capacite_expiration: string | null; blg_capacite_expiration: string | null
  // Banque (nouveau)
  sage_banque: string | null; blg_banque: string | null
  sage_banque_bban: string | null; blg_iban: string | null
  // Téléphone, TVA, Adresse (nouveau — téléphone et TVA comparés automatiquement,
  // adresse affichée côte à côte seulement, voir notes du mapping)
  sage_telephone: string | null; blg_telephone: string | null
  sage_numero_identifiant: string | null; blg_tva_intra: string | null
  sage_adresse: string | null; blg_adresse: string | null
  // Attestation de capacité (désormais comparée automatiquement) et
  // Catégorie AF/GAF (affichée à titre indicatif, comparée aux tags BLG)
  sage_attestation_capacite: string | null; blg_attestation_capacite: string | null
  sage_categorie_af_gaf: string | null
  // Division BLG : conservée en information seule, ne correspond PAS à
  // l'agence de rattachement SAGE (voir notes du mapping) — pas d'équivalent
  // "blg_agence" côté champs_en_ecart pour l'instant.
  blg_division: string | null
  champs_en_ecart: string[]
  sage_mise_en_sommeil: boolean | null
  blg_est_entite_interne: boolean | null
  blg_est_adresse_livraison: boolean | null
  sage_updated_at: string | null
  blg_last_update: string | null
  sage_qualite: string | null
  blg_tags: string[] | null
  sage_contact: string | null
  blg_contacts_resume: string | null
  blg_contact_principal: string | null
  blg_nb_contacts: number | null
  sage_agence_rattachement: string | null
  sage_abrege: string | null
  blg_nom_court: string | null
  // Identifiant hexadécimal BLG (partner_base_partner.crm_id) — seul identifiant
  // valable dans l'URL de la fiche BLG. blg_id_tiers contient le partner_id numérique.
  blg_crm_id: string | null
  // Contacts (liste nominative des deux côtés) — SAGE "NOM Prénom", BLG "Prénom NOM"
  sage_nb_contacts: number | null
  sage_contacts_liste: string[] | null
  blg_contacts_liste: string[] | null
  // Adresses de livraison : nombre et adresse principale (SAGE li_principal = 1,
  // BLG custom_fields.mainDelivery = oui ; le n° BLG est extrait de la référence "<tiers>-<li_no>-liv")
  sage_nb_adresses_livraison: number | null
  blg_nb_adresses_livraison: number | null
  sage_livraison_principale_no: string | null
  blg_livraison_principale_no: string | null
  sage_adresse_livraison_principale: string | null
  blg_adresse_livraison_principale: string | null
}

type Domaine = 'client' | 'article' | 'devis' | 'facture'
type ChampInventaire = { cote: 'sage' | 'blg'; colonne: string; type: string }
type ChampMapping = {
  id: number
  domaine: string
  champ_sage: string
  champ_blg: string | null
  label: string | null
  type_comparaison: 'auto' | 'manuel' | 'affichage_seul' | 'non_comparable'
  notes: string | null
  // Numéros de pastille du document Excel de reprise et libellés exacts tels
  // qu'affichés à l'écran (distincts des noms techniques champ_sage/champ_blg).
  // numero_blg contient l'écran entre parenthèses car la numérotation BLG se
  // répète d'un écran à l'autre (ex. "24 (Suivi)" vs "24 (Gérer les IBAN)").
  numero_sage: number | null
  numero_blg: string | null
  nom_ecran_sage: string | null
  nom_ecran_blg: string | null
}
type SyncLogEntry = { table_name: string; rows_synced: number; status: string; started_at: string; finished_at: string }
type Operateur = 'egal' | 'contient' | 'ne_contient_pas' | 'commence_par' | 'est_vide' | 'non_vide'
type FiltreCondition = { id: string; cote: 'sage' | 'blg'; champ: string; operateur: Operateur; valeur: string }

const OPERATEUR_LABELS: Record<Operateur, string> = {
  egal: 'est égal à', contient: 'contient', ne_contient_pas: 'ne contient pas',
  commence_par: 'commence par', est_vide: 'est vide', non_vide: "n'est pas vide",
}
function nouvelleCondition(): FiltreCondition {
  return { id: Math.random().toString(36).slice(2), cote: 'sage', champ: '', operateur: 'contient', valeur: '' }
}
function formatCellValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Lien vers la fiche entreprise dans BLG (instance de production "cegeclim").
 * BLG identifie l'entreprise par son identifiant hexadécimal `crm_id`
 * (blg.partner_base_partner.crm_id, remonté dans la vue en `blg_crm_id`), pas
 * par le partner_id numérique — ex.
 * https://app.blgcloud.com/cegeclim/?app/crm/company/e190ba6f5863e48e051ea093# */
function lienBlg(r: Pick<ControleRow, 'blg_crm_id'>): string | null {
  const id = safeText(r.blg_crm_id)
  return id ? `https://app.blgcloud.com/cegeclim/?app/crm/company/${id}#` : null
}

/** Captures d'écran issues du document Excel de reprise SAGE ↔ BLG, à déposer
 * dans /public/mapping-help/ pour que le petit "ⓘ" du panneau de comparaison
 * puisse les afficher. `numeros` indique quelles pastilles de mapping (n°
 * SAGE, ou n° BLG tel qu'utilisé dans nom_ecran_blg / numero_blg) apparaissent
 * sur cette capture, pour pouvoir la retrouver depuis une ligne du tableau. */
type CaptureEcran = { fichier: string; titre: string; numeros: number[] }

const CAPTURES_SAGE: CaptureEcran[] = [
  { fichier: '/mapping-help/sage-01-identification.png', titre: 'Identification', numeros: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { fichier: '/mapping-help/sage-02-tarifs-representant.png', titre: 'Tarifs', numeros: [11] },
  { fichier: '/mapping-help/sage-03-banque-compte.png', titre: 'Banques — Compte bancaire', numeros: [12, 13, 14, 15, 16] },
  { fichier: '/mapping-help/sage-04-banque-agence.png', titre: 'Banques — Agence', numeros: [17] },
  { fichier: '/mapping-help/sage-05-champs-libres.png', titre: 'Champs libres — Informations libres', numeros: [18, 19, 20, 21, 22, 23, 24, 25, 26] },
  { fichier: '/mapping-help/sage-06-bloc-notes.png', titre: 'Champs libres — Bloc-notes', numeros: [27] },
  { fichier: '/mapping-help/sage-07-documents-attaches.png', titre: 'Champs libres — Documents attachés', numeros: [] },
  { fichier: '/mapping-help/sage-08-solvabilite.png', titre: 'Solvabilité', numeros: [28, 29] },
  { fichier: '/mapping-help/sage-09-conditions-paiement.png', titre: 'Paramètres — Conditions de paiement', numeros: [30] },
  { fichier: '/mapping-help/sage-10-options-traitement.png', titre: 'Paramètres — Options de traitement', numeros: [] },
  { fichier: '/mapping-help/sage-11-options-impression.png', titre: "Paramètres — Options d'impression", numeros: [31] },
  { fichier: '/mapping-help/sage-12-adresses-liste.png', titre: 'Adresses — Liste', numeros: [32] },
  { fichier: '/mapping-help/sage-13-adresse-detail.png', titre: 'Adresses — Détail', numeros: [33, 34, 35, 36] },
  { fichier: '/mapping-help/sage-14-contacts.png', titre: 'Contacts', numeros: [37, 38, 39, 40] },
]

const CAPTURES_BLG: CaptureEcran[] = [
  { fichier: '/mapping-help/blg-01-editer-entreprise.png', titre: 'Éditer entreprise', numeros: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { fichier: '/mapping-help/blg-02-editer-gestion.png', titre: 'Éditer la gestion', numeros: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
  { fichier: '/mapping-help/blg-03-gerer-iban.png', titre: 'Gérer les IBAN', numeros: [11, 13, 18, 21, 22, 23, 24, 25] },
  { fichier: '/mapping-help/blg-04-tags-suivi.png', titre: 'Tags & Suivi', numeros: [22, 23, 24] },
  { fichier: '/mapping-help/blg-05-informations-cegeclim.png', titre: 'Informations CEGECLIM', numeros: [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35] },
  { fichier: '/mapping-help/blg-06-liens-contact.png', titre: 'Liens contact', numeros: [] },
]

/** Panneau d'aide déclenché par le petit "ⓘ" : deux onglets, les captures
 * d'écran du document Excel (SAGE puis BLG) et la liste complète du mapping
 * (y compris les champs non comparables), avec les numéros de pastille. */
function MappingInfoModal({ mapping, onClose }: { mapping: ChampMapping[]; onClose: () => void }) {
  const [tab, setTab] = useState<'captures' | 'liste'>('liste')
  const [zoomed, setZoomed] = useState<CaptureEcran | null>(null)

  const lignesTriees = useMemo(() => {
    return [...mapping].sort((a, b) => {
      if (a.numero_sage !== null && b.numero_sage !== null) return a.numero_sage - b.numero_sage
      if (a.numero_sage !== null) return -1
      if (b.numero_sage !== null) return 1
      return (a.label || a.champ_sage).localeCompare(b.label || b.champ_sage)
    })
  }, [mapping])

  const STATUT_STYLE: Record<ChampMapping['type_comparaison'], { label: string; className: string }> = {
    auto: { label: 'Comparé automatiquement', className: 'bg-emerald-50 text-emerald-700' },
    manuel: { label: 'Mapping manuel', className: 'bg-[#B4761A]/[0.12] text-[#96600F]' },
    affichage_seul: { label: 'Affiché, non comparé', className: 'bg-[#F4F3F0] text-[#3A362E]' },
    non_comparable: { label: 'Non comparable', className: 'bg-red-50 text-red-700' },
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E1D8] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-[#111820]">Documentation du mapping SAGE ↔ BLG</div>
            <p className="text-[12px] text-[#8A8474]">Captures d'écran et liste complète, y compris les champs non comparables.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0] hover:text-[#111820]">✕ Fermer</button>
        </div>

        <div className="flex gap-2 border-b border-[#E5E1D8] px-5 pt-3">
          <button type="button" onClick={() => setTab('liste')}
            className={`rounded-t-lg px-4 py-2 text-[13px] font-bold ${tab === 'liste' ? 'border-b-2 border-[#B4761A] text-[#111820]' : 'text-[#8A8474] hover:text-[#111820]'}`}>
            Liste de mapping ({mapping.length})
          </button>
          <button type="button" onClick={() => setTab('captures')}
            className={`rounded-t-lg px-4 py-2 text-[13px] font-bold ${tab === 'captures' ? 'border-b-2 border-[#B4761A] text-[#111820]' : 'text-[#8A8474] hover:text-[#111820]'}`}>
            Captures d'écran ({CAPTURES_SAGE.length + CAPTURES_BLG.length})
          </button>
        </div>

        <div className="overflow-auto p-5">
          {tab === 'liste' ? (
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-white text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
                <tr className="border-b border-[#E5E1D8]">
                  <th className="py-2 pr-2">N° SAGE</th>
                  <th className="py-2 pr-2">Champ SAGE</th>
                  <th className="py-2 pr-2">N° BLG</th>
                  <th className="py-2 pr-2">Champ BLG</th>
                  <th className="py-2 pr-2">Statut</th>
                  <th className="py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {lignesTriees.map((m) => {
                  const statut = STATUT_STYLE[m.type_comparaison]
                  return (
                    <tr key={m.id} className="border-b border-[#F4F3F0] align-top">
                      <td className="py-2 pr-2 font-mono text-[12px] text-[#8A8474]">{m.numero_sage ?? '—'}</td>
                      <td className="py-2 pr-2 font-semibold text-[#3A362E]">{m.nom_ecran_sage || m.label || m.champ_sage}</td>
                      <td className="py-2 pr-2 font-mono text-[12px] text-[#8A8474]">{m.numero_blg ?? '—'}</td>
                      <td className="py-2 pr-2 font-semibold text-[#3A362E]">{m.nom_ecran_blg || m.champ_blg || '—'}</td>
                      <td className="py-2 pr-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statut.className}`}>{statut.label}</span>
                      </td>
                      <td className="py-2 text-[12px] text-[#8A8474]">{m.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : zoomed ? (
            <div>
              <button type="button" onClick={() => setZoomed(null)} className="mb-3 text-[12px] font-bold text-[#B4761A] hover:underline">← Retour à la liste des captures</button>
              <div className="mb-2 text-[13px] font-bold text-[#111820]">{zoomed.titre}</div>
              {zoomed.numeros.length > 0 && (
                <p className="mb-2 text-[12px] text-[#8A8474]">Pastilles visibles sur cette capture : {zoomed.numeros.join(', ')}</p>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={zoomed.fichier} alt={zoomed.titre} className="w-full rounded-lg border border-[#E5E1D8]" />
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Écrans SAGE</div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {CAPTURES_SAGE.map((c) => (
                    <button key={c.fichier} type="button" onClick={() => setZoomed(c)}
                      className="overflow-hidden rounded-lg border border-[#E5E1D8] text-left hover:border-[#B4761A]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.fichier} alt={c.titre} className="h-28 w-full object-cover object-top" />
                      <div className="p-2">
                        <div className="truncate text-[12px] font-bold text-[#3A362E]">{c.titre}</div>
                        <div className="text-[11px] text-[#8A8474]">{c.numeros.length > 0 ? `N° ${c.numeros.join(', ')}` : 'Non numéroté'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Écrans BLG</div>
                <p className="mb-2 text-[12px] text-[#8A8474]">La numérotation BLG se répète d'un écran à l'autre (ex. le n°24 désigne un champ différent selon l'écran) — vérifie toujours le titre de la capture.</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {CAPTURES_BLG.map((c) => (
                    <button key={c.fichier} type="button" onClick={() => setZoomed(c)}
                      className="overflow-hidden rounded-lg border border-[#E5E1D8] text-left hover:border-[#B4761A]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.fichier} alt={c.titre} className="h-28 w-full object-cover object-top" />
                      <div className="p-2">
                        <div className="truncate text-[12px] font-bold text-[#3A362E]">{c.titre}</div>
                        <div className="text-[11px] text-[#8A8474]">{c.numeros.length > 0 ? `N° ${c.numeros.join(', ')}` : 'Non numéroté'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Colonnes autonomes (pas de pendant SAGE/BLG à comparer) pour l'export Comparaison. */
const EXPORT_COLONNES_SIMPLES: Array<{ key: keyof ControleRow; label: string; transform?: (r: ControleRow) => string }> = [
  { key: 'numero_tiers', label: 'N° tiers' },
  { key: 'statut_appariement', label: 'Statut appariement', transform: (r) => (r.statut_appariement === 'apparie' ? 'Apparié' : 'Manquant BLG') },
  { key: 'champs_en_ecart', label: 'Nb champs en écart', transform: (r) => String(r.champs_en_ecart?.length ?? 0) },
  { key: 'champs_en_ecart', label: 'Champs en écart (détail)', transform: (r) => (r.champs_en_ecart || []).join(', ') },
  { key: 'sage_mise_en_sommeil', label: 'Mise en sommeil (SAGE)', transform: (r) => formatCellValue(r.sage_mise_en_sommeil) },
  { key: 'blg_est_entite_interne', label: 'Entité interne (BLG)', transform: (r) => formatCellValue(r.blg_est_entite_interne) },
  { key: 'blg_est_adresse_livraison', label: 'Adresse de livraison uniquement (BLG)', transform: (r) => formatCellValue(r.blg_est_adresse_livraison) },
  { key: 'blg_contacts_resume', label: 'Contacts (BLG)' },
  { key: 'sage_nb_contacts', label: 'Nb contacts (SAGE)', transform: (r) => formatCellValue(r.sage_nb_contacts) },
  { key: 'blg_nb_contacts', label: 'Nb contacts (BLG)', transform: (r) => formatCellValue(r.blg_nb_contacts) },
  { key: 'sage_abrege', label: 'Abrégé (SAGE)' },
  { key: 'blg_nom_court', label: 'Nom court (BLG)' },
  { key: 'blg_id_tiers', label: 'ID tiers (BLG, brut)' },
  { key: 'blg_partner_id', label: 'Partner ID (BLG)', transform: (r) => formatCellValue(r.blg_partner_id) },
  { key: 'sage_updated_at', label: 'Dernière mise à jour (SAGE)' },
  { key: 'blg_last_update', label: 'Dernière mise à jour (BLG)' },
]

/** Normalise une valeur pour comparaison export (même esprit que la vue SQL) : trim + upper, tableaux joints. */
function normaliserPourExport(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'OUI' : 'NON'
  if (Array.isArray(v)) return v.map(String).join(', ').toUpperCase().trim()
  return String(v).toUpperCase().trim()
}

// ─────────────────────────────────────────────────────────────────────────
// Règles de comparaison tolérantes pour l'export Comparaison
// ─────────────────────────────────────────────────────────────────────────

/** Résultat d'une comparaison : 'ok' = vert, 'ecart' = rouge, 'partiel' = orange. */
type ResultatComparaison = 'ok' | 'ecart' | 'partiel'

/** Retire les accents, passe en majuscules, remplace toute ponctuation
 * (tirets, apostrophes, virgules, points…) par des espaces. */
function normaliserTexte(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.map(String).join(' ') : String(v)
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function motsDe(v: unknown): string[] {
  return normaliserTexte(v).split(' ').filter(Boolean)
}

/** Distance de Levenshtein bornée : dès que la distance dépasse `max`, renvoie max+1. */
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

/** Deux mots sont "proches" si identiques, si l'un contient l'autre (mots ≥ 4
 * lettres — absorbe le préfixe agence SAGE : ARCCASASSUS ⊃ CASASSUS), ou à
 * une lettre près (mots ≥ 5 lettres — AYPHASSORHO ≈ AYPHASSORRHO). */
function motsProches(a: string, b: string): boolean {
  if (a === b) return true
  const min = Math.min(a.length, b.length)
  if (min >= 4 && (a.includes(b) || b.includes(a))) return true
  if (min >= 5 && levenshtein(a, b, 1) <= 1) return true
  return false
}

function motTrouveDans(mot: string, liste: string[]): boolean {
  return liste.some((m) => motsProches(mot, m))
}

/** Inclusion de chaîne (espaces ignorés) : la valeur SAGE doit se retrouver
 * dans la valeur BLG (ou inversement). Sert pour Qualité/Catégorie ↔ Tags et
 * pour l'attestation de capacité. */
function comparerInclusion(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserTexte(sage).replace(/ /g, '')
  const b = normaliserTexte(blg).replace(/ /g, '')
  if (!s || !b) return 'partiel'
  return b.includes(s) || s.includes(b) ? 'ok' : 'ecart'
}

/** Téléphone : chiffres seuls, indicatif international retiré (+33 / 0033 /
 * +34…) et zéro national retiré — on compare les 9 derniers chiffres
 * ("06.85.32.09.03" ≡ "+34685320903" ≡ "0033685320903"). */
function normaliserTelephone(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d.length > 9 ? d.slice(-9) : d
}
function comparerTelephone(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserTelephone(sage)
  const b = normaliserTelephone(blg)
  if (!s || !b) return 'partiel'
  if (s === b) return 'ok'
  // Plusieurs numéros côté SAGE ("0662682637/0663292708") : vert si l'un d'eux est celui de BLG.
  const tous = String(sage ?? '').split(/[\/;,]|\s{2,}|\bou\b/i).map(normaliserTelephone).filter((x) => x.length >= 8)
  return tous.includes(b) ? 'ok' : 'ecart'
}

/** SIRET : rouge si le SIREN (9 premiers chiffres) diffère, orange si SIREN
 * identique mais valeur globale différente (ex. BLG ne porte que le SIREN),
 * vert si strictement identique. */
function comparerSiret(sage: unknown, blg: unknown): ResultatComparaison {
  const s = String(sage ?? '').replace(/\D/g, '')
  const b = String(blg ?? '').replace(/\D/g, '')
  if (!s || !b) return 'partiel'
  if (s.slice(0, 9) !== b.slice(0, 9)) return 'ecart'
  return s === b ? 'ok' : 'partiel'
}

/** TVA intracommunautaire : même logique sur la clé "FR + 2 chiffres + SIREN"
 * (13 caractères) — SAGE ajoute parfois le reste du SIRET derrière. */
function comparerTva(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserTexte(sage).replace(/ /g, '')
  const b = normaliserTexte(blg).replace(/ /g, '')
  if (!s || !b) return 'partiel'
  if (s.slice(0, 13) !== b.slice(0, 13)) return 'ecart'
  return s === b ? 'ok' : 'partiel'
}

/** Ville : accents/tirets ignorés, "ST" → "SAINT", "CEDEX xx" supprimé. Vert
 * si identiques, si tous les mots de la plus courte se retrouvent dans l'autre
 * (NANTES ⊂ NANTES CEDEX 01, BOULAZAC ⊂ BOULAZAC ISLE MANOIRE) ou à une
 * lettre près ; rouge sinon (VANNES ≠ NANTES, MIOS ≠ BIGANOS). */
function normaliserVille(v: unknown): string {
  return normaliserTexte(v)
    .replace(/\bCEDEX\b.*$/, '')
    .replace(/\bSTE\b/g, 'SAINTE')
    .replace(/\bST\b/g, 'SAINT')
    .replace(/\bS\b/g, 'SUR') // "VILLENEUVE S/ LOT" → "VILLENEUVE SUR LOT"
    .replace(/\s+/g, ' ')
    .trim()
}
function comparerVille(sage: unknown, blg: unknown): ResultatComparaison {
  const s = normaliserVille(sage)
  const b = normaliserVille(blg)
  if (!s || !b) return 'partiel'
  if (s === b) return 'ok'
  const ms = s.split(' ')
  const mb = b.split(' ')
  const [court, long] = ms.length <= mb.length ? [ms, mb] : [mb, ms]
  if (court.every((m) => motTrouveDans(m, long))) return 'ok'
  if (levenshtein(s.replace(/ /g, ''), b.replace(/ /g, ''), 1) <= 1) return 'ok'
  return 'ecart'
}

/** Adresse : côté BLG l'adresse concatène "voie, CP Ville, Pays" — on ne garde
 * que la partie voie. Abréviations de voie développées, mots vides ignorés.
 * Vert si le numéro de voie concorde (quand présent des deux côtés) et qu'au
 * moins 60 % des mots du libellé le plus court se retrouvent dans l'autre (à
 * une lettre près) ; rouge sinon. */
const ABREVIATIONS_VOIE: Record<string, string> = {
  ALL: 'ALLEE', AV: 'AVENUE', AVE: 'AVENUE', BD: 'BOULEVARD', BLD: 'BOULEVARD', BLVD: 'BOULEVARD',
  CHEM: 'CHEMIN', CH: 'CHEMIN', IMP: 'IMPASSE', RTE: 'ROUTE', PL: 'PLACE', R: 'RUE',
  ST: 'SAINT', STE: 'SAINTE', BAT: 'BATIMENT', RES: 'RESIDENCE', LOT: 'LOTISSEMENT',
  FG: 'FAUBOURG', SQ: 'SQUARE', CRS: 'COURS', QU: 'QUAI', PROM: 'PROMENADE',
}
const MOTS_VIDES_ADRESSE = new Set(['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'L', 'D', 'ET', 'A', 'AU', 'AUX', 'FRANCE'])
function motsAdresse(v: unknown): string[] {
  let s = String(v ?? '')
  // Coupe avant ", 33130 Bègles, France" (CP à 5 chiffres après une virgule).
  s = s.split(/,\s*\d{5}\b/)[0]
  return motsDe(s)
    .map((m) => ABREVIATIONS_VOIE[m] || m)
    .filter((m) => !MOTS_VIDES_ADRESSE.has(m))
}
function comparerAdresse(sage: unknown, blg: unknown): ResultatComparaison {
  const ms = motsAdresse(sage)
  const mb = motsAdresse(blg)
  if (ms.length === 0 || mb.length === 0) return 'partiel'
  const numS = ms.find((m) => /^\d+[A-Z]?$/.test(m))
  const numB = mb.find((m) => /^\d+[A-Z]?$/.test(m))
  if (numS && numB && numS !== numB) return 'ecart'
  const [court, long] = ms.length <= mb.length ? [ms, mb] : [mb, ms]
  const trouves = court.filter((m) => motTrouveDans(m, long)).length
  return trouves / court.length >= 0.6 ? 'ok' : 'ecart'
}

/** Personnes. SAGE = "<code agence><NOM> Prénom" (ex. "ARCCASASSUS Rémy"),
 * BLG = "Prénom NOM". Seuls les mots de ≥ 3 lettres comptent.
 * - tous=true (représentant) : chaque mot BLG doit se retrouver dans SAGE
 *   (préfixe agence absorbé, une lettre d'écart tolérée). "MPEYRE Philippe"
 *   vs "Christophe MICHALUC" → rouge ; "AAMENA Damien" vs "Damien MENA" → vert.
 * - tous=false (contact principal) : un seul mot commun suffit
 *   ("FARDEGUE/ DANQUIGNY" vs "Charles DANQUIGNY" → vert). */
function comparerPersonne(sage: unknown, blg: unknown, tous: boolean): ResultatComparaison {
  const ms = motsDe(sage).filter((m) => m.length >= 3)
  const mb = motsDe(blg).filter((m) => m.length >= 3)
  if (ms.length === 0 || mb.length === 0) return 'partiel'
  const proche = (m: string) => motTrouveDans(m, ms)
  if (tous) return mb.every(proche) ? 'ok' : 'ecart'
  return mb.some(proche) ? 'ok' : 'ecart'
}

/** Deux libellés de personne sont équivalents si tous les mots significatifs de
 * l'un se retrouvent dans l'autre (ordre libre : "NOM Prénom" SAGE ↔ "Prénom NOM"
 * BLG, une lettre d'écart tolérée). "CLOUPEAU" ≈ "SERGE CLOUPEAU", mais
 * "CORNU Valérie" ≠ "CHRISTOPHE BRUGIER". */
function nomsEquivalents(a: string, b: string): boolean {
  const ma = motsDe(a).filter((m) => m.length >= 2)
  const mb = motsDe(b).filter((m) => m.length >= 2)
  if (ma.length === 0 || mb.length === 0) return false
  return ma.every((m) => motTrouveDans(m, mb)) || mb.every((m) => motTrouveDans(m, ma))
}

/** Détail du rapprochement des listes de contacts : contacts SAGE sans
 * équivalent BLG, contacts BLG sans équivalent SAGE, doublons BLG. */
function rapprocherContacts(sage: string[] | null, blg: string[] | null) {
  const ls = sage || []
  const lb = blg || []
  const sageManquants = ls.filter((c) => !lb.some((b) => nomsEquivalents(c, b)))
  const blgEnPlus = lb.filter((b) => !ls.some((c) => nomsEquivalents(c, b)))
  const vus = new Set<string>()
  const blgDoublons: string[] = []
  lb.forEach((b) => {
    const k = normaliserTexte(b)
    if (vus.has(k)) blgDoublons.push(b); else vus.add(k)
  })
  return { sageManquants, blgEnPlus, blgDoublons }
}

/** Contacts : rouge si un contact SAGE n'a pas d'équivalent dans BLG, orange
 * si tous les contacts SAGE sont présents mais que BLG en a en plus (contacts
 * créés dans BLG ou doublons de reprise), vert sinon. */
function comparerContacts(sage: string[] | null, blg: string[] | null): ResultatComparaison {
  const { sageManquants, blgEnPlus, blgDoublons } = rapprocherContacts(sage, blg)
  if (sageManquants.length > 0) return 'ecart'
  if (blgEnPlus.length > 0 || blgDoublons.length > 0) return 'partiel'
  return 'ok'
}

/** Adresse de livraison principale : SAGE et BLG désignent la même adresse
 * dès que le n° d'adresse concorde (li_principal SAGE ↔ mainDelivery BLG,
 * référence BLG "<tiers>-<li_no>-liv"). Le libellé n'est pas comparé : BLG
 * porte une adresse géocodée (voie normalisée, CP/commune recalés) alors que
 * SAGE stocke un texte libre avec téléphone, BP, CEDEX — les différences de
 * libellé à n° identique ne sont pas des écarts.
 *  - n° d'adresse identique → vert ;
 *  - n° différent (mainDelivery pointe une autre adresse) → rouge ;
 *  - n° absent d'un côté → orange. */
function comparerAdresseLivraisonPrincipale(r: ControleRow): ResultatComparaison {
  const noS = safeText(r.sage_livraison_principale_no)
  const noB = safeText(r.blg_livraison_principale_no)
  if (!noS || !noB) return 'partiel'
  return noS === noB ? 'ok' : 'ecart'
}

/** Une paire de colonnes SAGE ↔ BLG comparables, avec le numéro de mapping du
 * document Excel (pour l'en-tête) et le mode de comparaison :
 * - compareStrict=false : toujours orange (affichage seul, non vérifié — ex. Agence/Division)
 * - compareStrict=true sans `comparer` : vert si identique (trim+upper), rouge sinon
 * - compareStrict=true avec `comparer` : règle tolérante spécifique, qui peut
 *   aussi renvoyer 'partiel' (orange, ex. SIREN identique mais SIRET différent)
 * Dans tous les cas, une valeur manquante d'un côté donne orange. */
type PaireExport = {
  numeroSage: number | null
  labelSage: string
  sageKey: keyof ControleRow
  numeroBlg: string | null
  labelBlg: string
  blgKey: keyof ControleRow
  compareStrict: boolean
  comparer?: (r: ControleRow) => ResultatComparaison
  /** Champ numérique : une valeur absente vaut 0 (0 ↔ vide = identique). */
  numerique?: boolean
}

const EXPORT_PAIRES_COMPARAISON: PaireExport[] = [
  { numeroSage: 2, labelSage: 'Intitulé', sageKey: 'sage_intitule', numeroBlg: '2', labelBlg: 'Raison sociale', blgKey: 'blg_intitule', compareStrict: true },
  {
    numeroSage: 3, labelSage: 'Qualité', sageKey: 'sage_qualite', numeroBlg: '22', labelBlg: 'Tags', blgKey: 'blg_tags', compareStrict: true,
    comparer: (r) => comparerInclusion(r.sage_qualite, r.blg_tags),
  },
  // Adresse / Code postal / Ville regroupés côte à côte
  {
    numeroSage: 5, labelSage: 'Adresse', sageKey: 'sage_adresse', numeroBlg: '8', labelBlg: 'Adresse', blgKey: 'blg_adresse', compareStrict: true,
    comparer: (r) => comparerAdresse(r.sage_adresse, r.blg_adresse),
  },
  { numeroSage: null, labelSage: 'Code postal', sageKey: 'sage_code_postal', numeroBlg: null, labelBlg: 'Code postal', blgKey: 'blg_code_postal', compareStrict: true },
  {
    numeroSage: null, labelSage: 'Ville', sageKey: 'sage_ville', numeroBlg: null, labelBlg: 'Ville', blgKey: 'blg_ville', compareStrict: true,
    comparer: (r) => comparerVille(r.sage_ville, r.blg_ville),
  },
  {
    numeroSage: 6, labelSage: 'Téléphone', sageKey: 'sage_telephone', numeroBlg: '9', labelBlg: 'Standard', blgKey: 'blg_telephone', compareStrict: true,
    comparer: (r) => comparerTelephone(r.sage_telephone, r.blg_telephone),
  },
  {
    numeroSage: 8, labelSage: 'Siret', sageKey: 'sage_siret', numeroBlg: '6', labelBlg: 'Numéro entreprise', blgKey: 'blg_siret', compareStrict: true,
    comparer: (r) => comparerSiret(r.sage_siret, r.blg_siret),
  },
  {
    numeroSage: 9, labelSage: 'Identifiant TVA', sageKey: 'sage_numero_identifiant', numeroBlg: '7', labelBlg: 'TVA intracommunautaire', blgKey: 'blg_tva_intra', compareStrict: true,
    comparer: (r) => comparerTva(r.sage_numero_identifiant, r.blg_tva_intra),
  },
  { numeroSage: 10, labelSage: 'Code NAF', sageKey: 'sage_code_naf', numeroBlg: null, labelBlg: 'Code NAF', blgKey: 'blg_code_naf', compareStrict: true },
  {
    numeroSage: 11, labelSage: 'Représentant', sageKey: 'sage_representant', numeroBlg: '24', labelBlg: 'Commercial', blgKey: 'blg_commercial', compareStrict: true,
    comparer: (r) => comparerPersonne(r.sage_representant, r.blg_commercial, true),
  },
  { numeroSage: 12, labelSage: 'Banque (nom)', sageKey: 'sage_banque', numeroBlg: '24', labelBlg: 'Banque (nom)', blgKey: 'blg_banque', compareStrict: true },
  {
    numeroSage: 15, labelSage: 'IBAN / RIB', sageKey: 'sage_banque_bban', numeroBlg: '22', labelBlg: 'IBAN', blgKey: 'blg_iban', compareStrict: true,
    comparer: (r) => {
      const bban = normaliserPourExport(r.sage_banque_bban).replace(/\s+/g, '')
      const iban = normaliserPourExport(r.blg_iban).replace(/\s+/g, '')
      if (!bban || !iban) return 'partiel'
      return bban === iban.slice(-23) ? 'ok' : 'ecart'
    },
  },
  { numeroSage: 18, labelSage: 'Capacité expiration', sageKey: 'sage_capacite_expiration', numeroBlg: '27', labelBlg: 'Capacité expiration', blgKey: 'blg_capacite_expiration', compareStrict: true },
  {
    numeroSage: 22, labelSage: 'Attestation de capacité', sageKey: 'sage_attestation_capacite', numeroBlg: '26', labelBlg: 'Attestation capacité', blgKey: 'blg_attestation_capacite', compareStrict: true,
    comparer: (r) => comparerInclusion(r.sage_attestation_capacite, r.blg_attestation_capacite),
  },
  { numeroSage: 19, labelSage: 'Facture @', sageKey: 'sage_facture_email', numeroBlg: '32', labelBlg: 'Facture électronique', blgKey: 'blg_facture_electronique', compareStrict: true },
  { numeroSage: 20, labelSage: 'Relevé de facture', sageKey: 'sage_releve_facture', numeroBlg: '29', labelBlg: 'Relevé de facture', blgKey: 'blg_releve_facture', compareStrict: true },
  { numeroSage: 21, labelSage: 'Famille', sageKey: 'sage_famille', numeroBlg: '30', labelBlg: 'Famille', blgKey: 'blg_famille', compareStrict: true },
  { numeroSage: 23, labelSage: 'Frais facturation', sageKey: 'sage_frais_facturation', numeroBlg: '28', labelBlg: 'Frais de facturation', blgKey: 'blg_frais_facturation', compareStrict: true },
  { numeroSage: 24, labelSage: 'Routage promo', sageKey: 'sage_routage_promo', numeroBlg: '31', labelBlg: 'Routage promo', blgKey: 'blg_routage_promo', compareStrict: true },
  { numeroSage: 25, labelSage: 'Type de facture', sageKey: 'sage_type_facture', numeroBlg: '33', labelBlg: 'Type de facture', blgKey: 'blg_type_facture', compareStrict: true },
  {
    numeroSage: 26, labelSage: 'Categorie AF GAF', sageKey: 'sage_categorie_af_gaf', numeroBlg: '22', labelBlg: 'Tags', blgKey: 'blg_tags', compareStrict: true,
    comparer: (r) => comparerInclusion(r.sage_categorie_af_gaf, r.blg_tags),
  },
  {
    numeroSage: 28, labelSage: 'Encours autorisé', sageKey: 'sage_encours', numeroBlg: '18', labelBlg: "Limite d'encours", blgKey: 'blg_encours', compareStrict: true, numerique: true,
    comparer: (r) => (Number(r.sage_encours ?? 0) === Number(r.blg_encours ?? 0) ? 'ok' : 'ecart'),
  },
  {
    numeroSage: 29, labelSage: 'Assurance crédit', sageKey: 'sage_assurance_credit', numeroBlg: '19', labelBlg: "Montant d'assurance crédit", blgKey: 'blg_assurance_credit', compareStrict: true, numerique: true,
    comparer: (r) => (Number(r.sage_assurance_credit ?? 0) === Number(r.blg_assurance_credit ?? 0) ? 'ok' : 'ecart'),
  },
  { numeroSage: 30, labelSage: 'Agence de rattachement', sageKey: 'sage_agence_rattachement', numeroBlg: '23', labelBlg: 'Division (informatif, pas d\'équivalence confirmée)', blgKey: 'blg_division', compareStrict: false },
  {
    numeroSage: 32, labelSage: 'Nb adresses de livraison', sageKey: 'sage_nb_adresses_livraison', numeroBlg: null, labelBlg: 'Nb adresses de livraison', blgKey: 'blg_nb_adresses_livraison', compareStrict: true, numerique: true,
    comparer: (r) => (Number(r.sage_nb_adresses_livraison ?? 0) === Number(r.blg_nb_adresses_livraison ?? 0) ? 'ok' : 'ecart'),
  },
  {
    numeroSage: 33, labelSage: 'Adresse de livraison principale', sageKey: 'sage_adresse_livraison_principale', numeroBlg: null, labelBlg: 'Adresse de livraison principale (mainDelivery)', blgKey: 'blg_adresse_livraison_principale', compareStrict: true,
    comparer: comparerAdresseLivraisonPrincipale,
  },
  {
    numeroSage: 37, labelSage: 'Interlocuteur', sageKey: 'sage_contact', numeroBlg: null, labelBlg: 'Contact principal', blgKey: 'blg_contact_principal', compareStrict: true,
    comparer: (r) => comparerPersonne(r.sage_contact, r.blg_contact_principal, false),
  },
  {
    numeroSage: 38, labelSage: 'Contacts (liste)', sageKey: 'sage_contacts_liste', numeroBlg: null, labelBlg: 'Contacts (liste)', blgKey: 'blg_contacts_liste', compareStrict: true,
    comparer: (r) => comparerContacts(r.sage_contacts_liste, r.blg_contacts_liste),
  },
]

/** Couleurs de remplissage ExcelJS (ARGB) pour l'export Comparaison. */
const COULEUR_OK = 'FFDCFCE7'      // vert clair
const COULEUR_ECART = 'FFFECACA'   // rouge clair
const COULEUR_NON_COMPARABLE = 'FFFED7AA' // orange clair
const COULEUR_ENTETE_PAIRE = 'FFE0E7EF'   // bleu-gris clair pour distinguer les paires comparables des colonnes simples

// ─────────────────────────────────────────────────────────────────────────
// Onglet BLG (lecture seule côté BLG, pour les tiers déjà appariés)
// ─────────────────────────────────────────────────────────────────────────

const BLG_DETAIL_FIELDS: Array<{ key: keyof ControleRow; label: string }> = [
  { key: 'blg_intitule', label: 'Intitulé' },
  { key: 'blg_siret', label: 'SIRET' },
  { key: 'blg_code_naf', label: 'Code NAF' },
  { key: 'blg_ville', label: 'Ville' },
  { key: 'blg_code_postal', label: 'Code postal' },
  { key: 'blg_commercial', label: 'Commercial' },
  { key: 'blg_division', label: 'Division / entité juridique' },
  { key: 'blg_famille', label: 'Famille' },
  { key: 'blg_encours', label: 'Encours' },
  { key: 'blg_assurance_credit', label: 'Assurance crédit' },
  { key: 'blg_frais_facturation', label: 'Frais de facturation' },
  { key: 'blg_routage_promo', label: 'Routage promo' },
  { key: 'blg_facture_electronique', label: 'Facture électronique' },
  { key: 'blg_releve_facture', label: 'Relevé de facture' },
  { key: 'blg_type_facture', label: 'Type de facture' },
  { key: 'blg_capacite_expiration', label: 'Capacité expiration' },
  { key: 'blg_attestation_capacite', label: 'Attestation de capacité' },
  { key: 'blg_banque', label: 'Banque' },
  { key: 'blg_iban', label: 'IBAN' },
  { key: 'blg_contact_principal', label: 'Contact principal' },
  { key: 'blg_nb_contacts', label: 'Nb contacts' },
  { key: 'blg_contacts_resume', label: 'Contacts' },
  { key: 'blg_nb_adresses_livraison', label: 'Nb adresses de livraison' },
  { key: 'blg_adresse_livraison_principale', label: 'Adresse de livraison principale' },
  { key: 'blg_nom_court', label: 'Nom court' },
  { key: 'blg_tags', label: 'Tags / qualité' },
  { key: 'blg_last_update', label: 'Dernière mise à jour BLG' },
]

function OngletBlg() {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ControleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ControleRow | null>(null)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase.rpc('get_controle_tiers_sage_blg', {
        p_statut: 'apparie', p_only_ecarts: false, p_champ: null,
        p_search: search.trim() || null, p_limit: 500, p_offset: 0,
        p_exclure_sommeil: true, p_filtres: [], p_combinateur: 'ET',
      })
      if (cancelled) return
      if (err) setError(err.message)
      else { setRows((data || []) as ControleRow[]); setError(null) }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [search])

  function getIndexBlg(list: ControleRow[], sel: ControleRow | null) {
    if (!sel) return -1
    return list.findIndex((r) => r.numero_tiers === sel.numero_tiers)
  }
  const onListKeyDown = creerHandlerNavigation(rows, selected, setSelected, getIndexBlg, listRefs)

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un n° tiers ou une raison sociale (côté BLG)…"
          className="h-10 w-full max-w-md rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A]"
        />
        <p className="mt-2 text-[12px] text-[#8A8474]">Limité aux tiers déjà appariés avec BLG — voir l&rsquo;onglet Comparaison pour les tiers manquants côté BLG.</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{loading ? 'Chargement…' : `${rows.length} résultat${rows.length > 1 ? 's' : ''}`}</div>
            {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
          </div>
          <div
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50"
          >
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                <tr><th className="px-3 py-2 font-bold">N° tiers</th><th className="px-3 py-2 font-bold">Ville</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.numero_tiers} ref={(el) => { listRefs.current[i] = el }} onClick={() => setSelected(r)}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${selected?.numero_tiers === r.numero_tiers ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</div>
                      <div className="truncate text-[12px] text-[#111820]">{r.blg_intitule || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-[#3A362E]">{r.blg_ville || '—'}</td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Fiche BLG</div>
          {!selected ? (
            <div className="flex h-64 items-center justify-center text-center text-[13px] text-[#8A8474]">Sélectionne un tiers dans la liste pour voir sa fiche BLG.</div>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between border-b border-[#E5E1D8] pb-3">
                <div>
                  <div className="font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero_tiers}</div>
                  <div className="text-[15px] font-bold text-[#111820]">{selected.blg_intitule || '—'}</div>
                </div>
                {lienBlg(selected) && (
                  <a href={lienBlg(selected) as string} target="_blank" rel="noopener noreferrer"
                    className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>
                )}
              </div>
              <div className="space-y-0.5">
                {BLG_DETAIL_FIELDS.map((f) => (
                  <div key={String(f.key)} className="grid grid-cols-[1fr_1.4fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
                    <span className="font-semibold text-[#3A362E]">{f.label}</span>
                    <span className="text-[#111820]">{formatCellValue(selected[f.key])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Comparaison — contrôle SAGE ↔ BLG piloté par les règles tolérantes
// ─────────────────────────────────────────────────────────────────────────
//
// Fonctionnement :
//  - l'ensemble des tiers correspondant aux filtres serveur (statut, tiers en
//    sommeil, conditions avancées) est chargé une fois via la RPC paginée, puis
//    TOUT est calculé côté navigateur avec `evaluerPaire` : pastilles par champ
//    (nb d'écarts rouges / oranges), KPI, liste filtrée, fenêtre flottante par
//    client et export Excel partagent exactement la même évaluation ;
//  - le pavé "Champs contrôlés" liste tous les champs SAGE de
//    EXPORT_PAIRES_COMPARAISON (n° + désignation SAGE). Un clic sur une pastille
//    filtre la liste sur les tiers concernés et ajoute une paire de colonnes
//    SAGE / BLG ; plusieurs pastilles = plusieurs paires de colonnes ;
//  - un clic sur un tiers ouvre une fenêtre flottante avec la totalité des
//    champs comparés et leur résultat.

/** Résultat d'évaluation d'une paire pour un tiers donné. Les valeurs hors
 * ResultatComparaison ne sont pas comptées comme écart :
 *  - 'vide'      : aucune valeur ni côté SAGE ni côté BLG
 *  - 'affichage' : paire affichée sans comparaison (compareStrict=false)
 *  - 'manquant'  : tiers sans correspondance BLG
 *  - 'blg_maitre' : BLG est déclaré maître sur ce champ (table
 *                   controle_champ_maitre) — le champ n'est plus comparé */
type Evaluation = ResultatComparaison | 'vide' | 'affichage' | 'manquant' | 'blg_maitre'

/** Ligne de public.controle_champ_maitre : champ (clé = sageKey de la paire)
 * pour lequel un système est maître. Seul 'blg' est exploité à l'écran. */
type ChampMaitre = { domaine: string; champ_cle: string; systeme_maitre: 'blg' | 'sage'; commentaire: string | null; updated_at: string | null; updated_by: string | null }

function estVide(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

function evaluerPaire(p: PaireExport, r: ControleRow, blgMaitre?: Set<string>): Evaluation {
  if (r.statut_appariement !== 'apparie') return 'manquant'
  if (blgMaitre && blgMaitre.has(p.sageKey)) return 'blg_maitre'
  const sv = r[p.sageKey]
  const bv = r[p.blgKey]
  const sVide = estVide(sv)
  const bVide = estVide(bv)
  if (sVide && bVide) return 'vide'
  if (!p.compareStrict) return 'affichage'
  // Champs numériques : "rien" vaut 0 des deux côtés (0 ↔ vide = identique),
  // donc pas d'orange "donnée manquante" — on passe directement à la règle.
  if (p.numerique && p.comparer) return p.comparer(r)
  if (sVide || bVide) return 'partiel'
  if (p.comparer) return p.comparer(r)
  return normaliserPourExport(sv) === normaliserPourExport(bv) ? 'ok' : 'ecart'
}

type EvaluationsTiers = Record<string, Evaluation> // clé = sageKey de la paire

/** Nombre max de lignes rendues dans le tableau (le jeu complet reste chargé pour les compteurs et l'export). */
const LIMITE_AFFICHAGE = 500

const EVAL_STYLE: Record<Evaluation, { cellule: string; libelle: string; argb: string }> = {
  ok: { cellule: 'bg-emerald-50 text-emerald-800', libelle: 'Identique', argb: COULEUR_OK },
  ecart: { cellule: 'bg-red-50 font-semibold text-red-800', libelle: 'Écart', argb: COULEUR_ECART },
  partiel: { cellule: 'bg-orange-50 text-orange-800', libelle: 'Partiel / manquant', argb: COULEUR_NON_COMPARABLE },
  affichage: { cellule: 'bg-orange-50/50 text-[#3A362E]', libelle: 'Affiché, non comparé', argb: COULEUR_NON_COMPARABLE },
  vide: { cellule: 'text-[#B3AD9E]', libelle: 'Vide des deux côtés', argb: COULEUR_NON_COMPARABLE },
  manquant: { cellule: 'text-[#B3AD9E]', libelle: 'Manquant BLG', argb: COULEUR_NON_COMPARABLE },
  blg_maitre: { cellule: 'bg-emerald-50 text-emerald-800', libelle: 'BLG maître (non comparé)', argb: COULEUR_OK },
}

function compterEcarts(ev: EvaluationsTiers | undefined) {
  let rouge = 0
  let orange = 0
  if (ev) Object.values(ev).forEach((e) => { if (e === 'ecart') rouge += 1; else if (e === 'partiel') orange += 1 })
  return { rouge, orange }
}

/** Bloc "Contacts" de la fenêtre flottante : les deux listes côte à côte, avec
 * les contacts SAGE sans équivalent BLG en rouge, les contacts BLG en plus en
 * orange et les doublons BLG signalés. */
function ContactsRapprochement({ sage, blg }: { sage: string[] | null; blg: string[] | null }) {
  const ls = sage || []
  const lb = blg || []
  const { sageManquants, blgEnPlus, blgDoublons } = rapprocherContacts(sage, blg)
  const doublonsNormalises = new Set(blgDoublons.map(normaliserTexte))
  const dejaVus = new Set<string>()
  return (
    <div className="mt-4 border-t border-[#E5E1D8] pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Contacts (n°37–40) — {ls.length} SAGE / {lb.length} BLG</div>
        {sageManquants.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{sageManquants.length} SAGE absent{sageManquants.length > 1 ? 's' : ''} de BLG</span>}
        {blgEnPlus.length > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">{blgEnPlus.length} BLG en plus</span>}
        {blgDoublons.length > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">{blgDoublons.length} doublon{blgDoublons.length > 1 ? 's' : ''} BLG</span>}
        {sageManquants.length === 0 && blgEnPlus.length === 0 && blgDoublons.length === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Identiques</span>}
      </div>
      <div className="grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <div className="mb-1 font-semibold text-[#3A362E]">SAGE</div>
          <ul className="space-y-0.5">
            {ls.map((c, i) => {
              const manquant = sageManquants.includes(c)
              return <li key={i} className={`rounded px-2 py-0.5 ${manquant ? 'bg-red-50 font-semibold text-red-800' : 'text-[#111820]'}`}>{c}{manquant && <span className="ml-1 text-[10px] font-bold text-red-600">absent de BLG</span>}</li>
            })}
            {ls.length === 0 && <li className="text-[#B3AD9E]">—</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-semibold text-[#3A362E]">BLG</div>
          <ul className="space-y-0.5">
            {lb.map((c, i) => {
              const k = normaliserTexte(c)
              const doublon = doublonsNormalises.has(k) && dejaVus.has(k)
              dejaVus.add(k)
              const enPlus = blgEnPlus.includes(c)
              return (
                <li key={i} className={`rounded px-2 py-0.5 ${doublon || enPlus ? 'bg-orange-50 text-orange-800' : 'text-[#111820]'}`}>
                  {c}
                  {doublon && <span className="ml-1 text-[10px] font-bold text-orange-600">doublon</span>}
                  {!doublon && enPlus && <span className="ml-1 text-[10px] font-bold text-orange-600">absent de SAGE</span>}
                </li>
              )
            })}
            {lb.length === 0 && <li className="text-[#B3AD9E]">—</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** Fenêtre flottante : totalité des champs comparés pour un tiers. */
function ClientComparaisonModal({ row, evals, onClose }: { row: ControleRow; evals: EvaluationsTiers; onClose: () => void }) {
  const { rouge, orange } = compterEcarts(evals)
  const lien = lienBlg(row)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#E5E1D8] px-5 py-4">
          <div>
            <div className="font-mono text-[12px] font-bold text-[#8A8474]">{row.numero_tiers}</div>
            <div className="text-[16px] font-bold text-[#111820]">{row.sage_intitule || row.blg_intitule || '—'}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
              {row.statut_appariement === 'manquant_blg' ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">Manquant BLG</span>
              ) : (
                <>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{rouge} écart{rouge > 1 ? 's' : ''}</span>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">{orange} partiel{orange > 1 ? 's' : ''}</span>
                  {rouge === 0 && orange === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">OK</span>}
                </>
              )}
              {row.sage_mise_en_sommeil && <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[#8A8474]">En sommeil (SAGE)</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lien && (
              <a href={lien} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>
            )}
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0] hover:text-[#111820]">✕ Fermer</button>
          </div>
        </div>

        <div className="overflow-auto p-5">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-white text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
              <tr className="border-b border-[#E5E1D8]">
                <th className="py-2 pr-2">N°</th>
                <th className="py-2 pr-2">Champ SAGE</th>
                <th className="py-2 pr-2">Valeur SAGE</th>
                <th className="py-2 pr-2">N°</th>
                <th className="py-2 pr-2">Champ BLG</th>
                <th className="py-2 pr-2">Valeur BLG</th>
                <th className="py-2">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {EXPORT_PAIRES_COMPARAISON.map((p) => {
                const ev = evals[p.sageKey] ?? 'vide'
                const st = EVAL_STYLE[ev]
                return (
                  <tr key={p.sageKey} className={`border-b border-[#F4F3F0] align-top ${ev === 'ecart' ? 'bg-red-50/60' : ev === 'partiel' ? 'bg-orange-50/60' : ''}`}>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-[#B3AD9E]">{p.numeroSage ?? '—'}</td>
                    <td className="py-1.5 pr-2 font-semibold text-[#3A362E]">{p.labelSage}</td>
                    <td className={`py-1.5 pr-2 ${ev === 'ecart' ? 'font-bold text-red-800' : 'text-[#111820]'}`}>{formatCellValue(row[p.sageKey])}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-[#B3AD9E]">{p.numeroBlg ?? '—'}</td>
                    <td className="py-1.5 pr-2 font-semibold text-[#3A362E]">{p.labelBlg}</td>
                    <td className={`py-1.5 pr-2 ${ev === 'ecart' ? 'font-bold text-red-800' : 'text-[#111820]'}`}>{formatCellValue(row[p.blgKey])}</td>
                    <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cellule}`}>{st.libelle}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {row.statut_appariement === 'apparie' && (
            <ContactsRapprochement sage={row.sage_contacts_liste} blg={row.blg_contacts_liste} />
          )}

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[#E5E1D8] pt-3 text-[12px] md:grid-cols-3">
            <div><span className="font-semibold text-[#3A362E]">Adresses de livraison :</span> <span className="text-[#111820]">{formatCellValue(row.sage_nb_adresses_livraison)} SAGE / {formatCellValue(row.blg_nb_adresses_livraison)} BLG</span></div>
            <div><span className="font-semibold text-[#3A362E]">Abrégé / nom court :</span> <span className="text-[#111820]">{formatCellValue(row.sage_abrege)} / {formatCellValue(row.blg_nom_court)}</span></div>
            <div><span className="font-semibold text-[#3A362E]">Dernière MàJ :</span> <span className="text-[#111820]">SAGE {formatCellValue(row.sage_updated_at)} · BLG {formatCellValue(row.blg_last_update)}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OngletComparaison() {
  const [domaine, setDomaine] = useState<Domaine>('client')
  const [toutes, setToutes] = useState<ControleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Filtres serveur (rechargement) et filtres client (instantanés)
  const [statutFilter, setStatutFilter] = useState<'tous' | 'apparie' | 'manquant_blg'>('tous')
  const [exclureSommeil, setExclureSommeil] = useState(true)
  const [conditions, setConditions] = useState<FiltreCondition[]>([])
  const [logiqueConditions, setLogiqueConditions] = useState<'et' | 'ou'>('et')
  const [search, setSearch] = useState('')
  const [onlyEcarts, setOnlyEcarts] = useState(false)

  // Pastilles de champs sélectionnées (clé = sageKey) et combinaison
  const [champsSelectionnes, setChampsSelectionnes] = useState<string[]>([])
  const [combinaisonChamps, setCombinaisonChamps] = useState<'ou' | 'et'>('ou')

  const [ligneActive, setLigneActive] = useState<ControleRow | null>(null)
  const [clientOuvert, setClientOuvert] = useState<ControleRow | null>(null)

  const [showMapping, setShowMapping] = useState(false)
  const [inventaire, setInventaire] = useState<ChampInventaire[]>([])
  const [mapping, setMapping] = useState<ChampMapping[]>([])
  const [loadingMapping, setLoadingMapping] = useState(false)

  const [syncLoading, setSyncLoading] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([])
  const [showSyncLog, setShowSyncLog] = useState(false)

  const [exportEnCours, setExportEnCours] = useState(false)
  const [showInfoModal, setShowInfoModal] = useState(false)

  // Champs pour lesquels BLG est maître (table controle_champ_maitre) : plus
  // comparés, pastille verte "BLG maître". Panneau de réglage repliable.
  const [blgMaitre, setBlgMaitre] = useState<Set<string>>(new Set())
  const [showMaitre, setShowMaitre] = useState(false)
  const [maitreMessage, setMaitreMessage] = useState<string | null>(null)

  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})
  const chargementId = useRef(0)

  const conditionsValides = useMemo(
    () => conditions.filter((c) => c.champ && (c.operateur === 'est_vide' || c.operateur === 'non_vide' || c.valeur.trim() !== '')),
    [conditions]
  )

  useEffect(() => { void loadMappingPanel(); void chargerChampsMaitres() }, [])
  useEffect(() => { void chargerToutes() }, [statutFilter, exclureSommeil, conditionsValides, logiqueConditions]) // eslint-disable-line react-hooks/exhaustive-deps

  async function chargerChampsMaitres() {
    const { data, error: err } = await supabase.from('controle_champ_maitre').select('*').eq('domaine', 'client')
    if (err) { setMaitreMessage(`Champs maîtres non chargés : ${err.message}`); return }
    setBlgMaitre(new Set(((data || []) as ChampMaitre[]).filter((m) => m.systeme_maitre === 'blg').map((m) => m.champ_cle)))
  }

  /** Coche / décoche "BLG maître" sur un champ et l'enregistre en base. */
  async function toggleBlgMaitre(sageKey: string) {
    const actif = blgMaitre.has(sageKey)
    const next = new Set(blgMaitre)
    if (actif) next.delete(sageKey); else next.add(sageKey)
    setBlgMaitre(next)
    setMaitreMessage(null)
    const { data: auth } = await supabase.auth.getUser()
    const { error: err } = actif
      ? await supabase.from('controle_champ_maitre').delete().eq('domaine', 'client').eq('champ_cle', sageKey)
      : await supabase.from('controle_champ_maitre').upsert(
          { domaine: 'client', champ_cle: sageKey, systeme_maitre: 'blg', updated_at: new Date().toISOString(), updated_by: auth?.user?.email ?? null },
          { onConflict: 'domaine,champ_cle' },
        )
    if (err) {
      setMaitreMessage(`Enregistrement impossible : ${err.message}`)
      setBlgMaitre(blgMaitre)
    }
  }

  function filtreParams() {
    return {
      p_exclure_sommeil: exclureSommeil,
      p_filtres: conditionsValides.map((c) => ({ cote: c.cote, champ: c.champ, operateur: c.operateur, valeur: c.valeur })),
      p_combinateur: logiqueConditions.toUpperCase(),
    }
  }

  /** Charge TOUS les tiers correspondant aux filtres serveur (paginé par 500).
   * La recherche texte et les pastilles sont ensuite appliquées côté client. */
  async function chargerToutes() {
    const id = ++chargementId.current
    setLoading(true)
    setLoadProgress(0)
    setError(null)
    try {
      const acc: ControleRow[] = []
      let offset = 0
      const pageSize = 500
      while (true) {
        const { data, error: err } = await supabase.rpc('get_controle_tiers_sage_blg', {
          p_statut: statutFilter === 'tous' ? null : statutFilter,
          p_only_ecarts: false, p_champ: null, p_search: null,
          p_limit: pageSize, p_offset: offset,
          ...filtreParams(),
        })
        if (id !== chargementId.current) return
        if (err) throw err
        const batch = (data || []) as ControleRow[]
        acc.push(...batch)
        setLoadProgress(acc.length)
        if (batch.length < pageSize) break
        offset += pageSize
      }
      setToutes(acc)
      setLigneActive(null)
    } catch (e) {
      if (id === chargementId.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === chargementId.current) setLoading(false)
    }
  }

  async function loadMappingPanel() {
    setLoadingMapping(true)
    const [{ data: inv }, { data: map }] = await Promise.all([
      supabase.rpc('get_champ_inventaire_client'),
      supabase.from('champ_mapping_sage_blg').select('*').eq('domaine', 'client').order('type_comparaison').order('champ_sage'),
    ])
    setInventaire((inv || []) as ChampInventaire[])
    setMapping((map || []) as ChampMapping[])
    setLoadingMapping(false)
  }

  const blgInventaire = useMemo(() => inventaire.filter((c) => c.cote === 'blg'), [inventaire])
  const sageInventaire = useMemo(() => inventaire.filter((c) => c.cote === 'sage'), [inventaire])

  async function lancerSynchro() {
    setSyncLoading(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/blg-sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setSyncMessage(`Erreur : ${data.error || res.statusText}`)
      else setSyncMessage('Synchro lancée sur le VPS — ça prend en général 1 à quelques minutes selon les écarts à rattraper.')
    } catch (e) {
      setSyncMessage(`Impossible de joindre le serveur de synchro : ${(e as Error).message}`)
    }
    setSyncLoading(false)
  }

  async function verifierSynchro() {
    const { data } = await supabase.rpc('get_last_sync_status')
    setSyncLog((data || []) as SyncLogEntry[])
    setShowSyncLog(true)
    void chargerToutes()
  }

  // ── Évaluation de toutes les paires pour tous les tiers (une seule fois par chargement)
  const evaluations = useMemo(() => {
    const m = new Map<string, EvaluationsTiers>()
    toutes.forEach((r) => {
      const ev: EvaluationsTiers = {}
      EXPORT_PAIRES_COMPARAISON.forEach((p) => { ev[p.sageKey] = evaluerPaire(p, r, blgMaitre) })
      m.set(r.numero_tiers, ev)
    })
    return m
  }, [toutes, blgMaitre])

  const statsChamps = useMemo(() => {
    const s: Record<string, { rouge: number; orange: number }> = {}
    EXPORT_PAIRES_COMPARAISON.forEach((p) => { s[p.sageKey] = { rouge: 0, orange: 0 } })
    evaluations.forEach((ev) => {
      Object.entries(ev).forEach(([k, e]) => { if (e === 'ecart') s[k].rouge += 1; else if (e === 'partiel') s[k].orange += 1 })
    })
    return s
  }, [evaluations])

  const kpis = useMemo(() => {
    let apparies = 0, manquants = 0, sansEcart = 0, avecEcart = 0
    toutes.forEach((r) => {
      if (r.statut_appariement !== 'apparie') { manquants += 1; return }
      apparies += 1
      const { rouge } = compterEcarts(evaluations.get(r.numero_tiers))
      if (rouge > 0) avecEcart += 1; else sansEcart += 1
    })
    return { total: toutes.length, apparies, manquants, sansEcart, avecEcart }
  }, [toutes, evaluations])

  const pairesSelectionnees = useMemo(
    () => EXPORT_PAIRES_COMPARAISON.filter((p) => champsSelectionnes.includes(p.sageKey)),
    [champsSelectionnes]
  )

  const rowsFiltrees = useMemo(() => {
    const term = search.trim().toUpperCase()
    return toutes.filter((r) => {
      if (term && !(r.numero_tiers.toUpperCase().includes(term) || (r.sage_intitule || '').toUpperCase().includes(term) || (r.blg_intitule || '').toUpperCase().includes(term))) return false
      const ev = evaluations.get(r.numero_tiers) || {}
      if (onlyEcarts && compterEcarts(ev).rouge === 0) return false
      if (champsSelectionnes.length > 0) {
        const concerne = (k: string) => ev[k] === 'ecart' || ev[k] === 'partiel'
        if (combinaisonChamps === 'ou' ? !champsSelectionnes.some(concerne) : !champsSelectionnes.every(concerne)) return false
      }
      return true
    })
  }, [toutes, evaluations, search, onlyEcarts, champsSelectionnes, combinaisonChamps])

  const rowsAffichees = useMemo(() => rowsFiltrees.slice(0, LIMITE_AFFICHAGE), [rowsFiltrees])

  function toggleChamp(k: string) {
    setChampsSelectionnes((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  function getIndexComparaison(list: ControleRow[], sel: ControleRow | null) {
    if (!sel) return -1
    return list.findIndex((r) => r.numero_tiers === sel.numero_tiers)
  }
  const navigationClavier = creerHandlerNavigation(rowsAffichees, ligneActive, setLigneActive, getIndexComparaison, listRefs)
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && ligneActive) { e.preventDefault(); setClientOuvert(ligneActive); return }
    navigationClavier(e)
  }

  /** Export Excel des tiers actuellement filtrés à l'écran (même évaluation
   * que les pastilles et la fenêtre flottante), via ExcelJS pour les couleurs :
   * vert = identique/équivalent, rouge = écart réel, orange = partiel /
   * manquant / affiché sans comparaison. */
  async function exporterExcelComparaison() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Comparaison SAGE-BLG')

      const enTetes: { texte: string; estPaire: boolean; bordureGauche?: boolean; bordureDroite?: boolean }[] = []
      EXPORT_COLONNES_SIMPLES.forEach((c) => enTetes.push({ texte: c.label, estPaire: false }))
      EXPORT_PAIRES_COMPARAISON.forEach((p) => {
        const suffixeSage = p.numeroSage !== null ? ` (n°${p.numeroSage})` : ''
        const suffixeBlg = p.numeroBlg !== null ? ` (n°${p.numeroBlg})` : ''
        enTetes.push({ texte: `${p.labelSage}${suffixeSage} — SAGE`, estPaire: true, bordureGauche: true })
        enTetes.push({ texte: `${p.labelBlg}${suffixeBlg} — BLG`, estPaire: true, bordureDroite: true })
      })

      ws.addRow(enTetes.map((h) => h.texte))
      const ligneEntete = ws.getRow(1)
      ligneEntete.font = { bold: true }
      ligneEntete.eachCell((cell, colNumber) => {
        const h = enTetes[colNumber - 1]
        cell.alignment = { wrapText: true, vertical: 'middle' }
        if (h.estPaire) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEUR_ENTETE_PAIRE } }
          cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: h.bordureGauche ? { style: 'medium' } : { style: 'thin' },
            right: h.bordureDroite ? { style: 'medium' } : { style: 'thin' },
          }
        }
      })

      rowsFiltrees.forEach((r) => {
        const ev = evaluations.get(r.numero_tiers) || {}
        const valeursSimples = EXPORT_COLONNES_SIMPLES.map((c) => (c.transform ? c.transform(r) : safeText(r[c.key])))
        const valeursPaires: string[] = []
        EXPORT_PAIRES_COMPARAISON.forEach((p) => {
          valeursPaires.push(formatCellValue(r[p.sageKey]))
          valeursPaires.push(formatCellValue(r[p.blgKey]))
        })
        const ligne = ws.addRow([...valeursSimples, ...valeursPaires])

        let colIndex = EXPORT_COLONNES_SIMPLES.length
        EXPORT_PAIRES_COMPARAISON.forEach((p) => {
          colIndex += 1
          const celluleSage = ligne.getCell(colIndex)
          colIndex += 1
          const celluleBlg = ligne.getCell(colIndex)
          const couleur = EVAL_STYLE[ev[p.sageKey] ?? 'vide'].argb
          const bordureCommune = { top: { style: 'thin' as const }, bottom: { style: 'thin' as const } }
          celluleSage.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } }
          celluleSage.border = { ...bordureCommune, left: { style: 'medium' } }
          celluleBlg.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } }
          celluleBlg.border = { ...bordureCommune, right: { style: 'medium' } }
        })
      })

      ws.columns.forEach((col) => { col.width = 22 })
      ws.views = [{ state: 'frozen', ySplit: 1 }]

      const ligneLegendeIndex = rowsFiltrees.length + 3
      ws.getCell(`A${ligneLegendeIndex}`).value = 'Légende :'
      ws.getCell(`A${ligneLegendeIndex}`).font = { bold: true }
      const legendes: [string, string][] = [
        ['Valeurs identiques ou équivalentes (règle tolérante du champ) — ou champ dont BLG est maître (non comparé)', COULEUR_OK],
        ['Écart réel détecté', COULEUR_ECART],
        ['Non comparable / donnée manquante / écart partiel (ex. SIREN identique mais SIRET différent)', COULEUR_NON_COMPARABLE],
      ]
      legendes.forEach(([texte, couleur], i) => {
        const cell = ws.getCell(`A${ligneLegendeIndex + 1 + i}`)
        cell.value = texte
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } }
      })

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `comparaison_sage_blg_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportEnCours(false)
    }
  }

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Migration BLG</p>
            <h2 className="mt-0.5 text-[22px] font-bold tracking-tight text-[#111820]">Contrôle de cohérence SAGE ↔ BLG</h2>
            <p className="mt-1 text-[13px] text-[#8A8474]">Compare les données des deux systèmes, domaine par domaine, pour préparer la bascule.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button type="button" onClick={() => void lancerSynchro()} disabled={syncLoading}
              className="rounded-lg bg-[#111820] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60">
              {syncLoading ? 'Lancement…' : '↻ Lancer la synchro BLG'}
            </button>
            <button type="button" onClick={() => void verifierSynchro()} className="text-[12px] font-semibold text-[#B4761A] hover:underline">
              Vérifier l'état de la dernière synchro
            </button>
          </div>
        </div>

        {syncMessage && <div className="mt-3 rounded-lg border border-[#B4761A]/25 bg-[#B4761A]/[0.06] px-3 py-2.5 text-[13px] font-semibold text-[#5A4321]">{syncMessage}</div>}

        {showSyncLog && (
          <div className="mt-3 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Dernières synchros (10 plus récentes)</div>
              <button type="button" onClick={() => setShowSyncLog(false)} className="text-[12px] font-bold text-[#8A8474] hover:text-[#111820]">Fermer</button>
            </div>
            <div className="space-y-1 text-[12px]">
              {syncLog.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-white px-2 py-1">
                  <span className="font-semibold text-[#3A362E]">{l.table_name}</span>
                  <span className="text-[#8A8474]">{l.rows_synced} lignes</span>
                  <span className={l.status === 'ok' ? 'font-bold text-emerald-700' : 'font-bold text-red-600'}>{l.status}</span>
                  <span className="text-[#8A8474]">{new Date(l.finished_at).toLocaleString('fr-FR')}</span>
                </div>
              ))}
              {syncLog.length === 0 && <p className="text-[#8A8474]">Aucune donnée.</p>}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <DomaineTab active={domaine === 'client'} onClick={() => setDomaine('client')} label="Fiche client" />
            <DomaineTab active={false} disabled label="Fiche article" note="bientôt" />
            <DomaineTab active={false} disabled label="Devis" note="bientôt" />
            <DomaineTab active={false} disabled label="Factures" note="bientôt" />
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]">
            <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
            Exclure les tiers en sommeil (SAGE)
          </label>
        </div>
      </section>

      {domaine !== 'client' ? (
        <section className="rounded-xl border border-dashed border-[#E5E1D8] bg-white p-12 text-center">
          <p className="text-[15px] font-bold text-[#3A362E]">Domaine pas encore disponible</p>
          <p className="mt-1 text-[13px] text-[#8A8474]">Le rapprochement pour ce domaine sera ajouté dans une prochaine étape.</p>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Tiers SAGE" value={kpis.total} loading={loading} />
            <KpiCard label="Appariés avec BLG" value={kpis.apparies} loading={loading} />
            <KpiCard label="Manquants côté BLG" value={kpis.manquants} loading={loading} tone="warn" />
            <KpiCard label="Sans écart" value={kpis.sansEcart} loading={loading} tone="ok" />
            <KpiCard label="Avec au moins un écart" value={kpis.avecEcart} loading={loading} tone="warn" />
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs contrôlés — écarts par champ SAGE</div>
                <button
                  type="button"
                  onClick={() => setShowInfoModal(true)}
                  title="Voir les captures d'écran et la liste complète du mapping"
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[#E5E1D8] text-[12px] font-bold text-[#8A8474] hover:border-[#B4761A] hover:text-[#B4761A]"
                >
                  ⓘ
                </button>
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                {champsSelectionnes.length >= 2 && (
                  <div className="flex items-center gap-1 font-semibold text-[#3A362E]">
                    Tiers concernés par :
                    <button type="button" onClick={() => setCombinaisonChamps('ou')} className={`rounded px-2 py-0.5 ${combinaisonChamps === 'ou' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>au moins un</button>
                    <button type="button" onClick={() => setCombinaisonChamps('et')} className={`rounded px-2 py-0.5 ${combinaisonChamps === 'et' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>tous</button>
                  </div>
                )}
                {champsSelectionnes.length > 0 && (
                  <button type="button" onClick={() => setChampsSelectionnes([])} className="font-bold text-[#B4761A] hover:underline">Tout désélectionner</button>
                )}
                <button
                  type="button"
                  onClick={() => setShowMaitre((v) => !v)}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-bold transition-colors ${showMaitre ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}
                  title="Déclarer les champs pour lesquels BLG est maître (ils ne sont plus comparés)"
                >
                  ⚙ BLG maître ({blgMaitre.size})
                </button>
              </div>
            </div>
            {loading ? (
              <div className="h-24 animate-pulse rounded bg-[#F4F3F0]" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {EXPORT_PAIRES_COMPARAISON.map((p) => {
                  const s = statsChamps[p.sageKey]
                  const actif = champsSelectionnes.includes(p.sageKey)
                  const maitre = blgMaitre.has(p.sageKey)
                  const sansEcart = p.compareStrict && !maitre && s.rouge === 0 && s.orange === 0
                  return (
                    <button
                      key={p.sageKey}
                      type="button"
                      onClick={() => toggleChamp(p.sageKey)}
                      title={maitre ? `BLG maître — champ non comparé (BLG : ${p.labelBlg})` : `BLG : ${p.labelBlg}${p.numeroBlg ? ` (n°${p.numeroBlg})` : ''}`}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                        actif
                          ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#96600F]'
                          : maitre || sansEcart
                            ? 'border-emerald-200 bg-emerald-50/60 text-[#3A362E] hover:bg-emerald-50'
                            : 'border-[#E5E1D8] bg-[#F4F3F0] text-[#3A362E] hover:bg-[#EDEAE1]'
                      }`}
                    >
                      <span className="font-mono text-[11px] text-[#B3AD9E]">{p.numeroSage !== null ? `n°${p.numeroSage}` : '—'}</span>
                      <span>{p.labelSage}</span>
                      {maitre ? (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">BLG maître</span>
                      ) : !p.compareStrict ? (
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#8A8474]">affichage</span>
                      ) : sansEcart ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[12px] font-black text-white" title="Aucun écart">✓</span>
                      ) : (
                        <>
                          {s.rouge > 0 && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700" title="Écarts réels">{s.rouge}</span>}
                          {s.orange > 0 && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-bold text-orange-700" title="Partiels / donnée manquante d'un côté">{s.orange}</span>}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="mt-2 text-[12px] text-[#8A8474]">
              Rouge = écart réel, orange = donnée manquante d'un côté ou écart partiel, ✓ vert = aucun écart, « BLG maître » = champ non comparé. Clique sur un ou plusieurs champs pour ne voir que les tiers concernés, avec les valeurs SAGE / BLG en colonnes.
            </p>

            {showMaitre && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-bold text-[#111820]">Champs pour lesquels BLG est maître</div>
                    <p className="text-[12px] text-[#8A8474]">Coche un champ pour le sortir de la comparaison : il passe en vert « BLG maître » partout (pastilles, KPI, fenêtre client, export Excel). Réglage partagé, enregistré en base.</p>
                  </div>
                  {maitreMessage && <span className="text-[12px] font-semibold text-red-600">{maitreMessage}</span>}
                </div>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {EXPORT_PAIRES_COMPARAISON.filter((p) => p.compareStrict).map((p) => (
                    <label key={p.sageKey} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-white">
                      <input type="checkbox" checked={blgMaitre.has(p.sageKey)} onChange={() => void toggleBlgMaitre(p.sageKey)} className="accent-emerald-600" />
                      <span className="font-mono text-[11px] text-[#B3AD9E]">{p.numeroSage !== null ? `n°${p.numeroSage}` : '—'}</span>
                      <span className="font-semibold text-[#3A362E]">{p.labelSage}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <button type="button" onClick={() => setShowMapping((v) => !v)} className="flex w-full items-center justify-between text-left">
              <div>
                <div className="text-[13px] font-bold text-[#111820]">Mapping des champs (SAGE ↔ BLG)</div>
                <p className="text-[12px] text-[#8A8474]">Choisis un client exemple, clique un champ SAGE puis le champ BLG correspondant pour les associer.</p>
              </div>
              <span className="text-[#8A8474]">{showMapping ? '▲' : '▼'}</span>
            </button>
            {showMapping && (
              <div className="mt-4">
                {loadingMapping ? <div className="h-32 animate-pulse rounded bg-[#F4F3F0]" /> : (
                  <MappingBuilder mapping={mapping} blgInventaire={blgInventaire} onMappingChange={setMapping} />
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="grid gap-2 md:grid-cols-4">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un n° tiers ou une raison sociale…"
                className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
              <select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value as typeof statutFilter)}
                className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                <option value="tous">Statut : Tous</option>
                <option value="apparie">Apparié avec BLG</option>
                <option value="manquant_blg">Manquant côté BLG</option>
              </select>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                <input type="checkbox" checked={onlyEcarts} onChange={(e) => setOnlyEcarts(e.target.checked)} className="accent-[#B4761A]" />
                Avec écart réel uniquement
              </label>
            </div>

            <div className="mt-3 border-t border-[#E5E1D8] pt-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Filtres avancés</div>
                {conditions.length >= 2 && (
                  <div className="flex items-center gap-1 text-[12px] font-semibold text-[#3A362E]">
                    Combiner avec :
                    <button type="button" onClick={() => setLogiqueConditions('et')} className={`rounded px-2 py-0.5 ${logiqueConditions === 'et' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>ET</button>
                    <button type="button" onClick={() => setLogiqueConditions('ou')} className={`rounded px-2 py-0.5 ${logiqueConditions === 'ou' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>OU</button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {conditions.map((c) => (
                  <div key={c.id} className="grid grid-cols-[110px_1fr_160px_1fr_32px] gap-2">
                    <select value={c.cote} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, cote: e.target.value as 'sage' | 'blg', champ: '' } : x))}
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]">
                      <option value="sage">SAGE</option>
                      <option value="blg">BLG</option>
                    </select>
                    <select value={c.champ} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, champ: e.target.value } : x))}
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]">
                      <option value="">Champ…</option>
                      {(c.cote === 'sage' ? sageInventaire : blgInventaire).map((col) => (
                        <option key={col.colonne} value={col.colonne}>{col.colonne}</option>
                      ))}
                    </select>
                    <select value={c.operateur} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, operateur: e.target.value as Operateur } : x))}
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]">
                      {(Object.entries(OPERATEUR_LABELS) as [Operateur, string][]).map(([op, label]) => (
                        <option key={op} value={op}>{label}</option>
                      ))}
                    </select>
                    <input value={c.valeur} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, valeur: e.target.value } : x))}
                      disabled={c.operateur === 'est_vide' || c.operateur === 'non_vide'} placeholder="Valeur…"
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-medium outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]" />
                    <button type="button" onClick={() => setConditions((prev) => prev.filter((x) => x.id !== c.id))}
                      className="flex h-9 items-center justify-center rounded-lg border border-[#E5E1D8] text-[#8A8474] hover:border-red-300 hover:text-red-600">✕</button>
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => setConditions((prev) => [...prev, nouvelleCondition()])}
                className="mt-2 text-[12px] font-bold text-[#B4761A] hover:underline">+ Ajouter une condition</button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
              <span className="text-[12px] text-[#8A8474]">
                {loading ? `Chargement… ${loadProgress} tiers récupéré${loadProgress > 1 ? 's' : ''}` : `${rowsFiltrees.length} tiers correspondent aux filtres (sur ${toutes.length} chargés)`}
              </span>
              <button
                type="button"
                onClick={() => void exporterExcelComparaison()}
                disabled={exportEnCours || loading || rowsFiltrees.length === 0}
                className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportEnCours ? 'Export en cours…' : `⬇ Exporter en Excel (${rowsFiltrees.length} tiers, tous les champs)`}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                {loading
                  ? 'Chargement…'
                  : rowsFiltrees.length > LIMITE_AFFICHAGE
                    ? `${LIMITE_AFFICHAGE} affichés sur ${rowsFiltrees.length} — affine la recherche ou exporte en Excel pour voir le reste`
                    : `${rowsFiltrees.length} résultat${rowsFiltrees.length > 1 ? 's' : ''}`}
              </div>
              <div className="flex items-center gap-3">
                {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
                <span className="text-[11px] text-[#8A8474]">Clic ou Entrée sur un tiers : fenêtre avec tous les champs comparés</span>
              </div>
            </div>
            <div
              tabIndex={0}
              onKeyDown={onListKeyDown}
              className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50"
            >
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                  <tr>
                    <th className="px-3 py-2 font-bold">N° tiers</th>
                    <th className="px-3 py-2 font-bold">Statut</th>
                    {pairesSelectionnees.map((p) => (
                      <React.Fragment key={p.sageKey}>
                        <th className="border-l-2 border-[#E5E1D8] px-3 py-2 font-bold">
                          <span className="font-mono text-[10px] text-[#B3AD9E]">{p.numeroSage !== null ? `n°${p.numeroSage} ` : ''}</span>{p.labelSage} — SAGE
                        </th>
                        <th className="border-r-2 border-[#E5E1D8] px-3 py-2 font-bold">
                          <span className="font-mono text-[10px] text-[#B3AD9E]">{p.numeroBlg !== null ? `n°${p.numeroBlg} ` : ''}</span>{p.labelBlg} — BLG
                        </th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsAffichees.map((r, i) => {
                    const ev = evaluations.get(r.numero_tiers) || {}
                    const { rouge, orange } = compterEcarts(ev)
                    const actif = ligneActive?.numero_tiers === r.numero_tiers
                    return (
                      <tr
                        key={r.numero_tiers}
                        ref={(el) => { listRefs.current[i] = el }}
                        onClick={() => { setLigneActive(r); setClientOuvert(r) }}
                        className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${actif ? 'bg-[#B4761A]/[0.06]' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</div>
                          <div className="truncate text-[12px] text-[#111820]">{r.sage_intitule || r.blg_intitule || '—'}</div>
                        </td>
                        <td className="px-3 py-2">
                          {r.statut_appariement === 'manquant_blg' ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Manquant BLG</span>
                          ) : rouge === 0 && orange === 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">OK</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {rouge > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{rouge} écart{rouge > 1 ? 's' : ''}</span>}
                              {orange > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">{orange} partiel{orange > 1 ? 's' : ''}</span>}
                            </span>
                          )}
                        </td>
                        {pairesSelectionnees.map((p) => {
                          const st = EVAL_STYLE[ev[p.sageKey] ?? 'vide']
                          return (
                            <React.Fragment key={p.sageKey}>
                              <td className={`max-w-[260px] truncate border-l-2 border-[#E5E1D8] px-3 py-2 text-[12px] ${st.cellule}`} title={formatCellValue(r[p.sageKey])}>{formatCellValue(r[p.sageKey])}</td>
                              <td className={`max-w-[260px] truncate border-r-2 border-[#E5E1D8] px-3 py-2 text-[12px] ${st.cellule}`} title={formatCellValue(r[p.blgKey])}>{formatCellValue(r[p.blgKey])}</td>
                            </React.Fragment>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {!loading && rowsAffichees.length === 0 && (
                    <tr><td colSpan={2 + pairesSelectionnees.length * 2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {showInfoModal && <MappingInfoModal mapping={mapping} onClose={() => setShowInfoModal(false)} />}
      {clientOuvert && (
        <ClientComparaisonModal
          row={clientOuvert}
          evals={evaluations.get(clientOuvert.numero_tiers) || {}}
          onClose={() => setClientOuvert(null)}
        />
      )}
    </>
  )
}

function DomaineTab({ active, disabled, onClick, label, note }: { active: boolean; disabled?: boolean; onClick?: () => void; label: string; note?: string }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-bold transition-colors ${
        active ? 'border-[#111820] bg-[#111820] text-white' : disabled ? 'cursor-not-allowed border-[#E5E1D8] bg-[#F4F3F0] text-[#B3AD9E]' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'
      }`}>
      {label}
      {note && <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">{note}</span>}
    </button>
  )
}

function MappingBuilder({
  mapping, blgInventaire, onMappingChange,
}: { mapping: ChampMapping[]; blgInventaire: ChampInventaire[]; onMappingChange: (m: ChampMapping[]) => void }) {
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<{ numero_tiers: string; blg_partner_id: number | null; sage_intitule: string | null }[]>([])
  const [selectedClient, setSelectedClient] = useState<{ numero: string; partnerId: number } | null>(null)
  const [sageValues, setSageValues] = useState<Record<string, unknown>>({})
  const [blgValues, setBlgValues] = useState<Record<string, unknown>>({})
  const [loadingClient, setLoadingClient] = useState(false)
  const [pendingSageField, setPendingSageField] = useState<string | null>(null)

  useEffect(() => {
    const q = clientSearch.trim()
    if (q.length < 2) { setClientResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('get_controle_tiers_sage_blg', {
        p_statut: 'apparie', p_only_ecarts: false, p_champ: null, p_search: q, p_limit: 8, p_offset: 0,
      })
      setClientResults(((data || []) as ControleRow[]).map((r) => ({ numero_tiers: r.numero_tiers, blg_partner_id: r.blg_partner_id, sage_intitule: r.sage_intitule })))
    }, 200)
    return () => clearTimeout(t)
  }, [clientSearch])

  async function pickClient(numero: string, partnerId: number | null) {
    if (!partnerId) return
    setSelectedClient({ numero, partnerId })
    setClientResults([])
    setClientSearch('')
    setPendingSageField(null)
    setLoadingClient(true)
    const [{ data: sage }, { data: blg }] = await Promise.all([
      supabase.rpc('get_tiers_sage_full', { p_numero: numero }),
      supabase.rpc('get_tiers_blg_full', { p_partner_id: partnerId }),
    ])
    setSageValues((sage as Record<string, unknown>) || {})
    setBlgValues((blg as Record<string, unknown>) || {})
    setLoadingClient(false)
  }

  async function setChampBlg(row: ChampMapping, champBlg: string | null) {
    const next = mapping.map((m) => (m.id === row.id ? { ...m, champ_blg: champBlg, type_comparaison: champBlg ? ('manuel' as const) : m.type_comparaison } : m))
    onMappingChange(next)
    await supabase.from('champ_mapping_sage_blg').update({ champ_blg: champBlg }).eq('id', row.id)
  }

  function handleSageClick(m: ChampMapping) {
    if (pendingSageField === m.champ_sage) { setPendingSageField(null); return }
    setPendingSageField(m.champ_sage)
  }
  function handleBlgClick(colonne: string) {
    if (!pendingSageField) return
    const row = mapping.find((m) => m.champ_sage === pendingSageField)
    if (row) void setChampBlg(row, colonne)
    setPendingSageField(null)
  }

  const mappedRows = mapping.filter((m) => m.champ_blg)
  const unmappedRows = mapping.filter((m) => !m.champ_blg)
  const blgUsed = new Set(mapping.map((m) => m.champ_blg).filter(Boolean) as string[])
  const blgAvailable = blgInventaire.filter((c) => !blgUsed.has(c.colonne))

  return (
    <div>
      <div className="relative mb-4">
        <input
          value={selectedClient ? `${selectedClient.numero}` : clientSearch}
          onChange={(e) => { setClientSearch(e.target.value); setSelectedClient(null) }}
          placeholder="Rechercher un client exemple (n° tiers ou raison sociale)…"
          className="h-10 w-full max-w-md rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A]"
        />
        {clientResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-w-md rounded-lg border border-[#E5E1D8] bg-white shadow-lg">
            {clientResults.map((c) => (
              <button key={c.numero_tiers} type="button" onClick={() => void pickClient(c.numero_tiers, c.blg_partner_id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-[#F4F3F0]">
                <span className="font-mono text-[12px] text-[#8A8474]">{c.numero_tiers}</span>
                <span className="text-[#111820]">{c.sage_intitule || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedClient ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[#E5E1D8] text-center text-[13px] text-[#8A8474]">
          Choisis un client ci-dessus pour voir ses valeurs et construire le mapping.
        </div>
      ) : loadingClient ? (
        <div className="h-40 animate-pulse rounded-lg bg-[#F4F3F0]" />
      ) : (
        <>
          {pendingSageField && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-[#B4761A]/30 bg-[#B4761A]/[0.08] px-3 py-2 text-[13px] font-semibold text-[#96600F]">
              <span>Champ SAGE sélectionné : <span className="font-mono">{pendingSageField}</span> — clique un champ BLG à droite pour l'associer.</span>
              <button type="button" onClick={() => setPendingSageField(null)} className="font-bold hover:underline">Annuler</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-b border-[#E5E1D8] pb-2 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
            <span>SAGE</span><span>BLG</span>
          </div>

          <div className="max-h-[420px] overflow-auto">
            {mappedRows.map((m) => {
              const isPending = pendingSageField === m.champ_sage
              return (
                <div key={m.id} className="grid grid-cols-2 gap-3 border-b border-[#F4F3F0] py-1.5">
                  <button type="button" onClick={() => handleSageClick(m)}
                    className={`flex items-center justify-between rounded px-2 py-1 text-left text-[13px] transition-colors ${isPending ? 'bg-[#B4761A]/[0.15]' : 'hover:bg-[#F4F3F0]'}`}>
                    <span className="font-semibold text-[#3A362E]">{m.label || m.champ_sage}</span>
                    <span className="ml-2 truncate text-[#111820]">{formatCellValue(sageValues[m.champ_sage])}</span>
                  </button>
                  <div className="flex items-center justify-between rounded bg-emerald-50/60 px-2 py-1 text-[13px]">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-emerald-700">{m.champ_blg}</span>
                      <span className="truncate text-[#111820]">{formatCellValue(blgValues[m.champ_blg as string])}</span>
                    </span>
                    <button type="button" onClick={() => void setChampBlg(m, null)} title="Dissocier" className="ml-2 shrink-0 text-[11px] font-bold text-[#8A8474] hover:text-red-600">✕</button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Champs SAGE non mappés ({unmappedRows.length})</div>
              <div className="max-h-[320px] space-y-0.5 overflow-auto rounded-lg border border-[#E5E1D8] p-1">
                {unmappedRows.map((m) => {
                  const isPending = pendingSageField === m.champ_sage
                  return (
                    <button key={m.id} type="button" onClick={() => handleSageClick(m)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] transition-colors ${isPending ? 'bg-[#B4761A]/[0.15]' : 'hover:bg-[#F4F3F0]'}`}>
                      <span className="font-semibold text-[#3A362E]">{m.label || m.champ_sage}</span>
                      <span className="ml-2 truncate text-[#8A8474]">{formatCellValue(sageValues[m.champ_sage])}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Champs BLG disponibles ({blgAvailable.length})</div>
              <div className={`max-h-[320px] space-y-0.5 overflow-auto rounded-lg border p-1 ${pendingSageField ? 'border-[#B4761A]' : 'border-[#E5E1D8]'}`}>
                {blgAvailable.map((c) => (
                  <button key={c.colonne} type="button" onClick={() => handleBlgClick(c.colonne)} disabled={!pendingSageField}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] transition-colors ${pendingSageField ? 'hover:bg-[#B4761A]/[0.1]' : 'cursor-default'}`}>
                    <span className="font-mono text-[11px] text-[#3A362E]">{c.colonne}</span>
                    <span className="ml-2 truncate text-[#8A8474]">{formatCellValue(blgValues[c.colonne])}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page principale : bascule entre les 3 onglets
// ─────────────────────────────────────────────────────────────────────────

type OngletPrincipal = 'sage' | 'blg' | 'comparaison'

export default function ClientsSageBlgPage() {
  const [onglet, setOnglet] = useState<OngletPrincipal>('sage')

  return (
    <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Référentiel clients</p>
          <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-[#111820]">Clients SAGE / BLG</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <OngletTab active={onglet === 'sage'} onClick={() => setOnglet('sage')} label="SAGE" />
            <OngletTab active={onglet === 'blg'} onClick={() => setOnglet('blg')} label="BLG" />
            <OngletTab active={onglet === 'comparaison'} onClick={() => setOnglet('comparaison')} label="Comparaison" />
          </div>
        </section>

        {onglet === 'sage' && <OngletSage />}
        {onglet === 'blg' && <OngletBlg />}
        {onglet === 'comparaison' && <OngletComparaison />}
      </div>
    </main>
  )
}

function OngletTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-5 py-2.5 text-[14px] font-bold transition-colors ${
        active ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'
      }`}>
      {label}
    </button>
  )
}
