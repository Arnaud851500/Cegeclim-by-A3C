'use client'

/**
 * Écran "Articles SAGE / BLG"
 * ---------------------------------------------------------------------------
 * Même principe que l'écran Clients SAGE / BLG, pour la base articles.
 *
 * 3 onglets :
 *  - SAGE : liste pleine largeur (public.mv_sage_articles_complet = sage.article_bis
 *    + fournisseur principal sage.article_fournisseur + composants sage.nomenclature
 *    + stocks sage.stock_depot). Colonnes au choix et ordonnables, filtres avancés
 *    sur n'importe quel champ (mémorisés dans le navigateur), fiche article en
 *    fenêtre flottante, export Excel identique à l'écran.
 *  - BLG : même principe sur public.mv_blg_articles_complet (blg.article_part +
 *    nature, famille / sous-famille, marque / modèle, catégories, tags, références
 *    actives, prix fournisseur, prix public, éco-contribution, champs libres,
 *    stocks, liens article, nomenclature BLG).
 *  - Comparaison : public.v_controle_article_sage_blg (une ligne par article SAGE,
 *    colonnes SAGE / BLG côte à côte). Évaluation côté navigateur avec des règles
 *    tolérantes (evaluerPaire) : pastilles par champ (écarts rouges / oranges) qui
 *    filtrent la liste et ajoutent des colonnes SAGE / BLG, fenêtre flottante avec
 *    tous les champs comparés et le détail de la nomenclature, champs « BLG
 *    maître » (table controle_champ_maitre, domaine 'article'), export Excel coloré.
 *
 * Appariement SAGE ↔ BLG : public.v_appro_article_blg_cles (référence BLG, puis
 * référence interne).
 *
 * Les deux vues matérialisées sont rafraîchies toutes les heures (pg_cron, à hh:15)
 * et à la demande par le bouton « Actualiser » (RPC refresh_controle_articles).
 *
 * Nécessite les paquets "xlsx" et "exceljs" (déjà utilisés par l'écran clients).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

type Row = Record<string, any>

// ─────────────────────────────────────────────────────────────────────────
// Utilitaires communs
// ─────────────────────────────────────────────────────────────────────────

function safeText(v: unknown) {
  return String(v ?? '').trim()
}

function estVide(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '—'
  if (typeof v === 'number') return v.toLocaleString('fr-FR', { maximumFractionDigits: 4 })
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Nettoie la saisie avant de l'injecter dans un filtre PostgREST `or(...)`. */
function termeRecherche(v: string): string {
  return v.trim().replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Lecture paginée (PostgREST limite à 1000 lignes par requête). */
async function chargerPagine(
  build: (from: number, to: number, premier: boolean) => PromiseLike<any>,
  limite: number,
  onProgress?: (n: number) => void,
): Promise<{ rows: Row[]; total: number | null }> {
  const PAGE = 1000
  const rows: Row[] = []
  let total: number | null = null
  for (let from = 0; from < limite; from += PAGE) {
    const to = Math.min(from + PAGE, limite) - 1
    const { data, error, count } = await build(from, to, from === 0)
    if (error) throw new Error(error.message || String(error))
    if (from === 0 && typeof count === 'number') total = count
    const batch = (data || []) as Row[]
    rows.push(...batch)
    onProgress?.(rows.length)
    if (batch.length < to - from + 1) break
  }
  return { rows, total }
}

function normaliserTexte(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.map(String).join(' ') : String(v)
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}
function compact(v: unknown): string {
  return normaliserTexte(v).replace(/ /g, '')
}
function normaliserFiltre(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

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

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function formatDateHeure(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Navigation clavier ↑/↓ (+ Entrée pour ouvrir) dans une liste. */
function useNavigationClavier<T>(rows: T[], selected: T | null, setSelected: (r: T) => void, same: (a: T, b: T) => boolean, onEnter?: (r: T) => void) {
  const refs = useRef<Record<number, HTMLTableRowElement | null>>({})
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && selected && onEnter) { e.preventDefault(); onEnter(selected); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (rows.length === 0) return
    e.preventDefault()
    const i = selected ? rows.findIndex((r) => same(r, selected)) : -1
    const j = i === -1 ? 0 : e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)
    setSelected(rows[j])
    refs.current[j]?.scrollIntoView({ block: 'nearest' })
  }
  return { refs, onKeyDown }
}

// ─────────────────────────────────────────────────────────────────────────
// Catalogues de colonnes (onglets SAGE et BLG)
// ─────────────────────────────────────────────────────────────────────────

type TypeColonne = 'texte' | 'nombre' | 'prix' | 'booleen' | 'date' | 'liste' | 'lien'
type Colonne = { key: string; label: string; groupe: string; type: TypeColonne; largeur?: number }

function texteColonne(c: Colonne, r: Row): string {
  const v = r[c.key]
  if (v === null || v === undefined || v === '') return ''
  switch (c.type) {
    case 'booleen': return v === true || v === 'true' ? 'Oui' : 'Non'
    case 'date': {
      const d = new Date(String(v))
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
    }
    case 'nombre': {
      const n = toNum(v)
      return n === null ? String(v) : n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
    }
    case 'prix': {
      const n = toNum(v)
      return n === null ? String(v) : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    }
    case 'liste': return Array.isArray(v) ? v.map(String).join(' · ') : String(v)
    default: return String(v).trim()
  }
}
function valeurTri(c: Colonne, r: Row): number | string {
  if (c.type === 'nombre' || c.type === 'prix') {
    const n = toNum(r[c.key])
    return n === null ? -Infinity : n
  }
  if (c.type === 'date') {
    const t = r[c.key] ? new Date(String(r[c.key])).getTime() : NaN
    return Number.isNaN(t) ? -Infinity : t
  }
  return texteColonne(c, r)
}
const estNumerique = (c: Colonne) => c.type === 'nombre' || c.type === 'prix'

const COLONNES_SAGE: Colonne[] = [
  { key: 'reference', label: 'Référence', groupe: 'Identification', type: 'texte', largeur: 150 },
  { key: 'designation', label: 'Désignation', groupe: 'Identification', type: 'texte', largeur: 300 },
  { key: 'famille', label: 'Famille (code)', groupe: 'Identification', type: 'texte', largeur: 110 },
  { key: 'famille_libelle', label: 'Famille', groupe: 'Identification', type: 'texte', largeur: 200 },
  { key: 'famille_macro', label: 'Famille macro', groupe: 'Identification', type: 'texte', largeur: 90 },
  { key: 'marque', label: 'Marque', groupe: 'Identification', type: 'texte', largeur: 110 },
  { key: 'stat01', label: 'Statistique 1', groupe: 'Identification', type: 'texte' },
  { key: 'stat02', label: 'Statistique 2', groupe: 'Identification', type: 'texte' },
  { key: 'stat03', label: 'Statistique 3', groupe: 'Identification', type: 'texte' },
  { key: 'raccourci', label: 'Raccourci', groupe: 'Identification', type: 'texte' },
  { key: 'substitut', label: 'Article de substitution', groupe: 'Identification', type: 'texte' },
  { key: 'en_sommeil', label: 'En sommeil', groupe: 'Statut', type: 'booleen', largeur: 90 },
  { key: 'publie', label: 'Publié (site marchand)', groupe: 'Statut', type: 'booleen', largeur: 90 },
  { key: 'interdire_commande', label: 'Interdire en commande', groupe: 'Statut', type: 'booleen', largeur: 90 },
  { key: 'exclure', label: 'Exclure', groupe: 'Statut', type: 'booleen', largeur: 90 },
  { key: 'mystock', label: 'MyStock', groupe: 'Statut', type: 'texte', largeur: 80 },
  { key: 'vie_produit', label: 'Vie produit', groupe: 'Statut', type: 'texte' },
  { key: 'criticite', label: 'Criticité', groupe: 'Statut', type: 'texte', largeur: 80 },
  { key: 'suivi_stock', label: 'Suivi de stock', groupe: 'Statut', type: 'texte', largeur: 100 },
  { key: 'type_nomenclature', label: 'Type de nomenclature', groupe: 'Statut', type: 'texte', largeur: 150 },
  { key: 'type_equipement', label: "Type d'équipement", groupe: 'Informations libres', type: 'texte' },
  { key: 'categorie_fluide_hfc', label: 'Catégorie fluide (HFC)', groupe: 'Informations libres', type: 'texte' },
  { key: 'uo_fms', label: 'UO FMS', groupe: 'Informations libres', type: 'texte' },
  { key: 'dimensions_hxlxp', label: 'Dimensions (HxLxP)', groupe: 'Informations libres', type: 'texte' },
  { key: 'categorie_psi', label: 'Catégorie PSI', groupe: 'Informations libres', type: 'texte' },
  { key: 'type_gaz', label: 'Type de gaz', groupe: 'Informations libres', type: 'texte' },
  { key: 'prix_achat', label: "Prix d'achat (dernier)", groupe: 'Prix', type: 'prix', largeur: 110 },
  { key: 'prix_unitaire_net', label: 'PU net', groupe: 'Prix', type: 'prix', largeur: 110 },
  { key: 'coefficient', label: 'Coefficient', groupe: 'Prix', type: 'nombre', largeur: 90 },
  { key: 'prix_vente', label: 'Prix de vente HT', groupe: 'Prix', type: 'prix', largeur: 110 },
  { key: 'prix_ttc', label: 'Prix TTC', groupe: 'Prix', type: 'prix', largeur: 110 },
  { key: 'fournisseur_principal', label: 'Fournisseur principal', groupe: 'Fournisseur', type: 'texte', largeur: 110 },
  { key: 'fournisseur_nom', label: 'Nom fournisseur', groupe: 'Fournisseur', type: 'texte', largeur: 180 },
  { key: 'ref_fournisseur', label: 'Réf. fournisseur', groupe: 'Fournisseur', type: 'texte', largeur: 150 },
  { key: 'prix_tarif_fournisseur', label: 'Prix tarif fournisseur', groupe: 'Fournisseur', type: 'prix', largeur: 110 },
  { key: 'remise_fournisseur', label: 'Remise fournisseur (%)', groupe: 'Fournisseur', type: 'nombre', largeur: 90 },
  { key: 'prix_net_fournisseur', label: "Prix d'achat net", groupe: 'Fournisseur', type: 'prix', largeur: 110 },
  { key: 'colisage', label: 'Colisage', groupe: 'Fournisseur', type: 'nombre', largeur: 80 },
  { key: 'qte_mini', label: 'Qté mini commande', groupe: 'Fournisseur', type: 'nombre', largeur: 80 },
  { key: 'delai_appro', label: "Délai d'appro", groupe: 'Fournisseur', type: 'texte', largeur: 80 },
  { key: 'code_barre_fournisseur', label: 'Code-barres fournisseur', groupe: 'Fournisseur', type: 'texte' },
  { key: 'nb_fournisseurs', label: 'Nb fournisseurs', groupe: 'Fournisseur', type: 'nombre', largeur: 80 },
  { key: 'fournisseurs', label: 'Fournisseurs (liste)', groupe: 'Fournisseur', type: 'liste', largeur: 260 },
  { key: 'poids_net_kg', label: 'Poids net (kg)', groupe: 'Logistique', type: 'nombre', largeur: 90 },
  { key: 'poids_brut_kg', label: 'Poids brut (kg)', groupe: 'Logistique', type: 'nombre', largeur: 90 },
  { key: 'code_barre', label: 'Code-barres', groupe: 'Logistique', type: 'texte' },
  { key: 'code_fiscal', label: 'Code fiscal / douane', groupe: 'Logistique', type: 'texte' },
  { key: 'pays', label: "Pays d'origine", groupe: 'Logistique', type: 'texte' },
  { key: 'garantie', label: 'Garantie', groupe: 'Logistique', type: 'texte', largeur: 80 },
  { key: 'delai_livraison', label: 'Délai de livraison', groupe: 'Logistique', type: 'texte', largeur: 80 },
  { key: 'composants', label: 'Nomenclature (composants)', groupe: 'Nomenclature', type: 'liste', largeur: 280 },
  { key: 'nb_composants', label: 'Nb composants', groupe: 'Nomenclature', type: 'nombre', largeur: 80 },
  { key: 'utilise_dans', label: 'Utilisé dans', groupe: 'Nomenclature', type: 'liste', largeur: 220 },
  { key: 'stock_total', label: 'Stock réel tous dépôts', groupe: 'Stock', type: 'nombre', largeur: 90 },
  { key: 'stock_dispo_total', label: 'Stock dispo tous dépôts', groupe: 'Stock', type: 'nombre', largeur: 90 },
  { key: 'stock_fms', label: 'Stock FMS', groupe: 'Stock', type: 'nombre', largeur: 80 },
  { key: 'present_blg', label: 'Présent dans BLG', groupe: 'BLG', type: 'booleen', largeur: 80 },
  { key: 'blg_part_id', label: 'Id article BLG', groupe: 'BLG', type: 'texte', largeur: 80 },
  { key: 'blg_appariement_via', label: 'Appariement BLG via', groupe: 'BLG', type: 'texte' },
  { key: 'date_creation', label: 'Créé le', groupe: 'Dates', type: 'date', largeur: 90 },
  { key: 'date_modification', label: 'Modifié le', groupe: 'Dates', type: 'date', largeur: 90 },
]
const COLONNES_SAGE_DEFAUT = ['reference', 'designation', 'famille_libelle', 'marque', 'fournisseur_principal', 'prix_net_fournisseur', 'prix_vente', 'stock_total', 'type_nomenclature', 'present_blg']

const COLONNES_BLG: Colonne[] = [
  { key: 'reference', label: 'Référence', groupe: 'Identification', type: 'texte', largeur: 150 },
  { key: 'internal_reference', label: 'Référence interne', groupe: 'Identification', type: 'texte', largeur: 150 },
  { key: 'designation', label: 'Désignation', groupe: 'Identification', type: 'texte', largeur: 300 },
  { key: 'nature', label: 'Nature', groupe: 'Identification', type: 'texte', largeur: 180 },
  { key: 'famille', label: 'Famille', groupe: 'Identification', type: 'texte', largeur: 200 },
  { key: 'sous_famille', label: 'Sous-famille', groupe: 'Identification', type: 'texte', largeur: 150 },
  { key: 'marque', label: 'Marque', groupe: 'Identification', type: 'texte', largeur: 110 },
  { key: 'modele', label: 'Modèle', groupe: 'Identification', type: 'texte', largeur: 150 },
  { key: 'categorie_principale', label: 'Catégorie e-commerce', groupe: 'Identification', type: 'texte' },
  { key: 'categories', label: 'Catégories', groupe: 'Identification', type: 'liste' },
  { key: 'tags', label: 'Tags', groupe: 'Identification', type: 'liste', largeur: 160 },
  { key: 'statut_fk', label: 'Statut BLG (id)', groupe: 'Identification', type: 'texte', largeur: 70 },
  { key: 'fournisseur_code', label: 'Fournisseur (code BLG)', groupe: 'Fournisseur', type: 'texte', largeur: 110 },
  { key: 'fournisseur_code_sage', label: 'Fournisseur (code SAGE déduit)', groupe: 'Fournisseur', type: 'texte', largeur: 110 },
  { key: 'fournisseur_nom', label: 'Nom fournisseur', groupe: 'Fournisseur', type: 'texte', largeur: 160 },
  { key: 'ref_fournisseur', label: 'Réf. fournisseur', groupe: 'Fournisseur', type: 'texte', largeur: 150 },
  { key: 'references_actives', label: 'Références actives', groupe: 'Fournisseur', type: 'liste', largeur: 280 },
  { key: 'prix_tarif', label: 'Prix tarif', groupe: 'Fournisseur', type: 'prix', largeur: 110 },
  { key: 'prix_tarif_date', label: 'Date du prix tarif', groupe: 'Fournisseur', type: 'date', largeur: 90 },
  { key: 'prix_achat_net', label: "Prix d'achat net", groupe: 'Fournisseur', type: 'prix', largeur: 110 },
  { key: 'remise_calculee', label: 'Remise (%) calculée', groupe: 'Fournisseur', type: 'nombre', largeur: 90 },
  { key: 'colisage', label: 'Colisage achat', groupe: 'Fournisseur', type: 'nombre', largeur: 80 },
  { key: 'qte_mini', label: 'Qté mini achat', groupe: 'Fournisseur', type: 'nombre', largeur: 80 },
  { key: 'prix_public', label: 'Prix public Cegeclim HT', groupe: 'Vente', type: 'prix', largeur: 110 },
  { key: 'politique_vente', label: 'Politique de vente', groupe: 'Vente', type: 'texte', largeur: 120 },
  { key: 'eco_code', label: 'Éco-contribution (code)', groupe: 'Vente', type: 'texte', largeur: 80 },
  { key: 'eco_montant', label: 'Éco-contribution (€)', groupe: 'Vente', type: 'prix', largeur: 90 },
  { key: 'poids_kg', label: 'Poids (kg)', groupe: 'Caractéristiques', type: 'nombre', largeur: 80 },
  { key: 'largeur', label: 'Largeur', groupe: 'Caractéristiques', type: 'nombre', largeur: 70 },
  { key: 'longueur', label: 'Longueur', groupe: 'Caractéristiques', type: 'nombre', largeur: 70 },
  { key: 'hauteur', label: 'Hauteur', groupe: 'Caractéristiques', type: 'nombre', largeur: 70 },
  { key: 'dimensions_libres', label: 'Dimensions (info libre)', groupe: 'Caractéristiques', type: 'texte' },
  { key: 'catalogue', label: 'Catalogue', groupe: 'Caractéristiques', type: 'texte', largeur: 80 },
  { key: 'categorie_fluide', label: 'Catégorie fluide (HFC)', groupe: 'Caractéristiques', type: 'texte' },
  { key: 'type_equipement', label: "Type d'équipement", groupe: 'Caractéristiques', type: 'texte' },
  { key: 'uo_fms', label: 'UO FMS', groupe: 'Caractéristiques', type: 'texte' },
  { key: 'code_douane', label: 'Code douane', groupe: 'Caractéristiques', type: 'texte' },
  { key: 'pays_origine', label: "Pays d'origine", groupe: 'Caractéristiques', type: 'texte' },
  { key: 'codes_barres', label: 'Codes-barres', groupe: 'Caractéristiques', type: 'liste' },
  { key: 'documents', label: 'Documents (site internet)', groupe: 'Caractéristiques', type: 'liste', largeur: 260 },
  { key: 'commentaire', label: 'Commentaire', groupe: 'Caractéristiques', type: 'texte', largeur: 320 },
  { key: 'gestion_stock', label: 'Gestion des stocks', groupe: 'Stock', type: 'texte', largeur: 100 },
  { key: 'materiels_geres', label: 'Matériels gérés', groupe: 'Stock', type: 'texte', largeur: 90 },
  { key: 'quantite_globale', label: 'Quantité globale', groupe: 'Stock', type: 'nombre', largeur: 90 },
  { key: 'stock_total', label: 'Stock tous entrepôts', groupe: 'Stock', type: 'nombre', largeur: 90 },
  { key: 'stock_fms', label: 'Stock FMS (DPFMS)', groupe: 'Stock', type: 'nombre', largeur: 90 },
  { key: 'pmp', label: 'PMP', groupe: 'Stock', type: 'prix', largeur: 100 },
  { key: 'dernier_prix_achat', label: "Dernier prix d'achat", groupe: 'Stock', type: 'prix', largeur: 110 },
  { key: 'derniere_entree', label: 'Dernière entrée', groupe: 'Stock', type: 'date', largeur: 90 },
  { key: 'derniere_sortie', label: 'Dernière sortie', groupe: 'Stock', type: 'date', largeur: 90 },
  { key: 'derniere_vente', label: 'Dernière vente', groupe: 'Stock', type: 'date', largeur: 90 },
  { key: 'nomenclature', label: 'Nomenclature (composants)', groupe: 'Liens et nomenclature', type: 'liste', largeur: 280 },
  { key: 'nb_composants', label: 'Nb composants', groupe: 'Liens et nomenclature', type: 'nombre', largeur: 80 },
  { key: 'articles_conseilles', label: 'Articles conseillés', groupe: 'Liens et nomenclature', type: 'liste', largeur: 200 },
  { key: 'conseille_avec', label: 'Conseillé avec', groupe: 'Liens et nomenclature', type: 'liste', largeur: 200 },
  { key: 'remplace_par', label: 'Remplacé par', groupe: 'Liens et nomenclature', type: 'texte', largeur: 150 },
  { key: 'remplace', label: 'Remplace', groupe: 'Liens et nomenclature', type: 'liste', largeur: 150 },
  { key: 'present_sage', label: 'Présent dans SAGE', groupe: 'SAGE', type: 'booleen', largeur: 80 },
  { key: 'sage_reference', label: 'Référence SAGE', groupe: 'SAGE', type: 'texte', largeur: 150 },
  { key: 'created_at', label: 'Créé le', groupe: 'Dates', type: 'date', largeur: 90 },
  { key: 'last_update', label: 'Modifié le', groupe: 'Dates', type: 'date', largeur: 90 },
  { key: 'lien_blg', label: 'Lien BLG', groupe: 'Dates', type: 'lien', largeur: 120 },
]
const COLONNES_BLG_DEFAUT = ['reference', 'designation', 'nature', 'famille', 'marque', 'fournisseur_nom', 'prix_achat_net', 'prix_public', 'stock_total', 'present_sage']

// ─────────────────────────────────────────────────────────────────────────
// Filtres avancés (génériques) + réglages mémorisés
// ─────────────────────────────────────────────────────────────────────────

type Operateur = 'egal' | 'different' | 'contient' | 'ne_contient_pas' | 'commence_par' | 'est_vide' | 'non_vide' | 'superieur' | 'inferieur'
type Condition = { id: string; champ: string; operateur: Operateur; valeur: string }
const OPERATEUR_LABELS: Record<Operateur, string> = {
  egal: 'est égal à', different: 'est différent de', contient: 'contient', ne_contient_pas: 'ne contient pas',
  commence_par: 'commence par', est_vide: 'est vide', non_vide: "n'est pas vide", superieur: 'est supérieur à', inferieur: 'est inférieur à',
}
const SANS_VALEUR: Operateur[] = ['est_vide', 'non_vide']
const nouvelleCondition = (champ: string): Condition => ({ id: Math.random().toString(36).slice(2), champ, operateur: 'contient', valeur: '' })

function nombreDe(v: string): number | null {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.').replace('€', ''))
  return Number.isFinite(n) ? n : null
}

function conditionSatisfaite(c: Condition, r: Row, colonnes: Colonne[]): boolean {
  const col = colonnes.find((x) => x.key === c.champ)
  if (!col) return true
  const brut = texteColonne(col, r)
  const val = normaliserFiltre(brut)
  const att = normaliserFiltre(c.valeur)
  switch (c.operateur) {
    case 'est_vide': return val === ''
    case 'non_vide': return val !== ''
    case 'egal': return val === att
    case 'different': return val !== att
    case 'contient': return val.includes(att)
    case 'ne_contient_pas': return !val.includes(att)
    case 'commence_par': return val.startsWith(att)
    case 'superieur':
    case 'inferieur': {
      const a = estNumerique(col) ? toNum(r[col.key]) : nombreDe(brut)
      const b = nombreDe(c.valeur)
      if (a === null || b === null) return false
      return c.operateur === 'superieur' ? a > b : a < b
    }
    default: return true
  }
}

type Reglages = { colonnes: string[]; conditions: Condition[]; logique: 'et' | 'ou' }
function chargerReglages(cle: string, colonnes: Colonne[], defaut: string[]): Reglages {
  const d: Reglages = { colonnes: defaut, conditions: [], logique: 'et' }
  if (typeof window === 'undefined') return d
  try {
    const brut = window.localStorage.getItem(cle)
    if (!brut) return d
    const p = JSON.parse(brut) as Partial<Reglages>
    const cles = new Set(colonnes.map((c) => c.key))
    const cols = Array.isArray(p.colonnes) ? p.colonnes.filter((k) => cles.has(k)) : defaut
    const conds = Array.isArray(p.conditions) ? p.conditions.filter((c) => c && cles.has(String(c.champ))).map((c) => ({ ...nouvelleCondition(c.champ), ...c })) : []
    return { colonnes: cols.length ? cols : defaut, conditions: conds, logique: p.logique === 'ou' ? 'ou' : 'et' }
  } catch {
    return d
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Liste générique pleine largeur (onglets SAGE et BLG)
// ─────────────────────────────────────────────────────────────────────────

type ListeProps = {
  source: string
  colonnes: Colonne[]
  colonnesDefaut: string[]
  stockageCle: string
  nomFeuille: string
  nomFichier: string
  /** Filtres serveur (recherche, sélecteurs) appliqués à la requête. */
  appliquerFiltres: (q: any) => any
  /** Clé qui change quand les filtres serveur changent (déclenche le rechargement). */
  cleFiltres: string
  cleLigne: (r: Row) => string
  limiteEcran: number
  filtresServeur: React.ReactNode
  onReinitialiserServeur: () => void
  filtresServeurActifs: boolean
  renderFiche: (r: Row, nav: { onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null }) => React.ReactNode
  version: number
}

function ListeArticles(props: ListeProps) {
  const { source, colonnes, colonnesDefaut, stockageCle, appliquerFiltres, cleFiltres, cleLigne, limiteEcran, version } = props
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const [colonnesChoisies, setColonnesChoisies] = useState<string[]>(colonnesDefaut)
  const [conditions, setConditions] = useState<Condition[]>([])
  const [logique, setLogique] = useState<'et' | 'ou'>('et')
  const [reglagesCharges, setReglagesCharges] = useState(false)
  const [colonnesOuvert, setColonnesOuvert] = useState(false)
  const [rechercheColonne, setRechercheColonne] = useState('')
  const [tri, setTri] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'reference', dir: 'asc' })
  const [selected, setSelected] = useState<Row | null>(null)
  const [ouvert, setOuvert] = useState<Row | null>(null)
  const colonnesRef = useRef<HTMLDivElement>(null)
  const chargementId = useRef(0)

  useEffect(() => {
    const r = chargerReglages(stockageCle, colonnes, colonnesDefaut)
    setColonnesChoisies(r.colonnes)
    setConditions(r.conditions)
    setLogique(r.logique)
    setReglagesCharges(true)
  }, [stockageCle, colonnes, colonnesDefaut])

  useEffect(() => {
    if (!reglagesCharges) return
    try { window.localStorage.setItem(stockageCle, JSON.stringify({ colonnes: colonnesChoisies, conditions, logique } satisfies Reglages)) } catch { /* stockage indisponible */ }
  }, [colonnesChoisies, conditions, logique, reglagesCharges, stockageCle])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (colonnesRef.current && !colonnesRef.current.contains(e.target as Node)) setColonnesOuvert(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    const id = ++chargementId.current
    const t = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      setProgress(0)
      try {
        const { rows: data, total: count } = await chargerPagine(
          (from, to, premier) => appliquerFiltres(supabase.from(source).select('*', premier ? { count: 'exact' } : undefined)).order('reference', { ascending: true }).range(from, to),
          limiteEcran,
          (n) => { if (id === chargementId.current) setProgress(n) },
        )
        if (id !== chargementId.current) return
        setRows(data)
        setTotal(count)
      } catch (e) {
        if (id === chargementId.current) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (id === chargementId.current) setLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleFiltres, source, limiteEcran, version])

  const conditionsValides = useMemo(() => conditions.filter((c) => c.champ && (SANS_VALEUR.includes(c.operateur) || c.valeur.trim() !== '')), [conditions])

  const filtrer = useCallback((liste: Row[]) => {
    if (conditionsValides.length === 0) return liste
    return liste.filter((r) => (logique === 'et' ? conditionsValides.every((c) => conditionSatisfaite(c, r, colonnes)) : conditionsValides.some((c) => conditionSatisfaite(c, r, colonnes))))
  }, [conditionsValides, logique, colonnes])

  const trier = useCallback((liste: Row[]) => {
    const col = colonnes.find((c) => c.key === tri.key)
    if (!col) return liste
    const dir = tri.dir === 'asc' ? 1 : -1
    return [...liste].sort((a, b) => {
      const va = valeurTri(col, a)
      const vb = valeurTri(col, b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return (String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base', numeric: true }) || safeText(a.reference).localeCompare(safeText(b.reference))) * dir
    })
  }, [colonnes, tri])

  const rowsFiltrees = useMemo(() => filtrer(rows), [rows, filtrer])
  const rowsTriees = useMemo(() => trier(rowsFiltrees), [rowsFiltrees, trier])
  const colonnesAffichees = useMemo(() => colonnesChoisies.map((k) => colonnes.find((c) => c.key === k)).filter((c): c is Colonne => Boolean(c)), [colonnesChoisies, colonnes])
  const groupes = useMemo(() => Array.from(new Set(colonnes.map((c) => c.groupe))), [colonnes])

  const memeLigne = (a: Row, b: Row) => cleLigne(a) === cleLigne(b)
  const { refs, onKeyDown } = useNavigationClavier(rowsTriees, selected, setSelected, memeLigne, (r) => setOuvert(r))

  function toggleColonne(k: string) {
    setColonnesChoisies((prev) => {
      if (prev.includes(k)) return prev.length > 1 ? prev.filter((x) => x !== k) : prev
      const ordre = colonnes.map((c) => c.key)
      return [...prev, k].sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b))
    })
  }
  function deplacerColonne(k: string, sens: -1 | 1) {
    setColonnesChoisies((prev) => {
      const i = prev.indexOf(k)
      const j = i + sens
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  /** Export = ce qui est à l'écran (colonnes, filtres, tri). Si l'écran est
   * tronqué, toutes les lignes sont rapatriées par pages de 1 000. */
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      let base = rows
      if (total !== null && total > rows.length) {
        const { rows: toutes } = await chargerPagine(
          (from, to) => appliquerFiltres(supabase.from(source).select('*')).order('reference', { ascending: true }).range(from, to),
          1_000_000,
        )
        base = toutes
      }
      const lignes = trier(filtrer(base)).map((r) => {
        const l: Record<string, string | number> = {}
        colonnesAffichees.forEach((c) => {
          const n = estNumerique(c) ? toNum(r[c.key]) : null
          l[c.label] = n !== null ? n : texteColonne(c, r)
        })
        return l
      })
      const ws = XLSX.utils.json_to_sheet(lignes, { header: colonnesAffichees.map((c) => c.label) })
      ws['!cols'] = colonnesAffichees.map((c) => ({ wch: Math.max(12, Math.round((c.largeur ?? 130) / 7)) }))
      ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, colonnesAffichees.length - 1))}${lignes.length + 1}` }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, props.nomFeuille)
      XLSX.writeFile(wb, `${props.nomFichier}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportEnCours(false)
    }
  }

  const champStyle = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]'
  const filtresActifs = props.filtresServeurActifs || conditionsValides.length > 0
  const indexOuvert = ouvert ? rowsTriees.findIndex((r) => memeLigne(r, ouvert)) : -1

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        {props.filtresServeur}

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
                  {groupes.map((g) => (
                    <optgroup key={g} label={g}>
                      {colonnes.filter((col) => col.groupe === g).map((col) => <option key={col.key} value={col.key}>{col.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                <select value={c.operateur} onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, operateur: e.target.value as Operateur } : x)))} className={champStyle}>
                  {(Object.entries(OPERATEUR_LABELS) as [Operateur, string][]).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
                </select>
                <input
                  value={c.valeur}
                  onChange={(e) => setConditions((prev) => prev.map((x) => (x.id === c.id ? { ...x, valeur: e.target.value } : x)))}
                  disabled={SANS_VALEUR.includes(c.operateur)}
                  placeholder="Valeur…"
                  className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-medium outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]"
                />
                <button type="button" onClick={() => setConditions((prev) => prev.filter((x) => x.id !== c.id))} className="flex h-9 items-center justify-center rounded-lg border border-[#E5E1D8] text-[#8A8474] hover:border-red-300 hover:text-red-600" title="Retirer cette condition">✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setConditions((prev) => [...prev, nouvelleCondition('designation')])} className="mt-2 text-[12px] font-bold text-[#B4761A] hover:underline">
            + Ajouter une condition
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
          <div className="flex items-center gap-3">
            {filtresActifs ? (
              <button type="button" onClick={() => { props.onReinitialiserServeur(); setConditions([]) }} className="text-[12px] font-bold text-[#B4761A] hover:underline">Réinitialiser les filtres</button>
            ) : <span />}
            {error && <span className="text-[12px] font-semibold text-red-600">{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={colonnesRef}>
              <button type="button" onClick={() => setColonnesOuvert((v) => !v)} className="flex h-9 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]">
                ☰ Colonnes ({colonnesAffichees.length}/{colonnes.length})
                <span className="text-[#8A8474]">{colonnesOuvert ? '▲' : '▼'}</span>
              </button>
              {colonnesOuvert && (
                <div className="absolute right-0 z-30 mt-1 max-h-[440px] w-[380px] overflow-auto rounded-lg border border-[#E5E1D8] bg-white p-1.5 shadow-lg">
                  <div className="mb-1 flex items-center justify-between px-2 py-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs affichés (ordre de la liste)</span>
                    <button type="button" onClick={() => setColonnesChoisies(colonnesDefaut)} className="text-[11px] font-bold text-[#B4761A] hover:underline">Par défaut</button>
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
                  <input value={rechercheColonne} onChange={(e) => setRechercheColonne(e.target.value)} placeholder="Rechercher un champ…" className="mb-1 h-8 w-full rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] outline-none focus:border-[#B4761A]" />
                  {groupes.map((g) => {
                    const dispo = colonnes.filter((c) => c.groupe === g && !colonnesChoisies.includes(c.key) && (!rechercheColonne.trim() || normaliserFiltre(c.label).includes(normaliserFiltre(rechercheColonne))))
                    if (dispo.length === 0) return null
                    return (
                      <div key={g}>
                        <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-[#B4761A]">{g}</div>
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
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading} className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60" title="Exporte exactement les colonnes et les lignes affichées">
              {exportEnCours ? 'Export en cours…' : '⬇ Exporter en Excel (comme à l’écran)'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading
              ? `Chargement… ${progress} article${progress > 1 ? 's' : ''}`
              : total !== null && total > rows.length
                ? `${rowsFiltrees.length} affiché(s) sur ${total} au total — affinez la recherche pour voir le reste (l'export Excel les inclut tous)`
                : `${rowsFiltrees.length} article${rowsFiltrees.length > 1 ? 's' : ''}${conditionsValides.length ? ` (${rows.length} avant filtres avancés)` : ''}`}
          </div>
          <div className="text-[11px] text-[#8A8474]">Clic ou Entrée : fiche article · ↑ ↓ pour se déplacer</div>
        </div>
        <div tabIndex={0} onKeyDown={onKeyDown} className="max-h-[75vh] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                {colonnesAffichees.map((c) => {
                  const actif = tri.key === c.key
                  return (
                    <th key={c.key} onClick={() => setTri((p) => (p.key === c.key ? { key: c.key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))} style={{ minWidth: c.largeur ?? 120 }}
                      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold hover:text-[#111820] ${estNumerique(c) ? 'text-right' : ''} ${actif ? 'text-[#111820]' : ''}`} title="Trier">
                      {c.label}<span className={`ml-1 text-[9px] ${actif ? 'opacity-100' : 'opacity-0'}`}>{tri.dir === 'asc' ? '▲' : '▼'}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rowsTriees.map((r, i) => {
                const actif = selected ? memeLigne(selected, r) : false
                return (
                  <tr key={cleLigne(r)} ref={(el) => { refs.current[i] = el }} onClick={() => { setSelected(r); setOuvert(r) }}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${actif ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                    {colonnesAffichees.map((c) => {
                      const texte = texteColonne(c, r)
                      const contenu =
                        c.type === 'booleen' && texte ? (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${texte === 'Oui' ? (c.key === 'en_sommeil' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700') : 'bg-[#F4F3F0] text-[#8A8474]'}`}>{texte}</span>
                        ) : c.type === 'lien' && texte ? (
                          <a href={texte} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-[#B4761A] hover:underline">Ouvrir ↗</a>
                        ) : c.key === 'reference' ? (
                          <span className="font-mono text-[12px] font-semibold text-[#3A362E]">{texte}</span>
                        ) : (texte || '—')
                      return (
                        <td key={c.key} title={texte}
                          className={`px-3 py-2 text-[12px] text-[#3A362E] ${estNumerique(c) ? 'text-right font-[var(--font-mono,monospace)]' : ''} ${c.key === 'designation' ? 'font-semibold text-[#111820]' : ''}`}
                          style={{ maxWidth: (c.largeur ?? 140) * 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {contenu}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {!loading && rowsTriees.length === 0 && (
                <tr><td colSpan={Math.max(1, colonnesAffichees.length)} className="px-3 py-8 text-center text-[#8A8474]">Aucun article pour ces filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {ouvert && props.renderFiche(ouvert, {
        onClose: () => setOuvert(null),
        onPrev: indexOuvert > 0 ? () => { setOuvert(rowsTriees[indexOuvert - 1]); setSelected(rowsTriees[indexOuvert - 1]) } : null,
        onNext: indexOuvert >= 0 && indexOuvert < rowsTriees.length - 1 ? () => { setOuvert(rowsTriees[indexOuvert + 1]); setSelected(rowsTriees[indexOuvert + 1]) } : null,
      })}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre flottante générique
// ─────────────────────────────────────────────────────────────────────────

function Fenetre({ children, onClose, onPrev, onNext, largeur = 'max-w-4xl' }: {
  children: React.ReactNode; onClose: () => void; onPrev?: (() => void) | null; onNext?: (() => void) | null; largeur?: string
}) {
  const h = useRef({ onClose, onPrev, onNext })
  h.current = { onClose, onPrev, onNext }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { h.current.onClose(); return }
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'ArrowLeft' && h.current.onPrev) h.current.onPrev()
      if (e.key === 'ArrowRight' && h.current.onNext) h.current.onNext()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`flex max-h-[92vh] w-full ${largeur} flex-col overflow-hidden rounded-xl bg-white shadow-2xl`}>{children}</div>
    </div>
  )
}

function BarreFenetre({ kicker, titre, badges, lien, onClose, onPrev, onNext }: {
  kicker: string; titre: string; badges?: React.ReactNode; lien?: string | null; onClose: () => void; onPrev?: (() => void) | null; onNext?: (() => void) | null
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#E5E1D8] px-5 py-4">
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-bold text-[#8A8474]">{kicker}</div>
        <div className="text-[16px] font-bold text-[#111820]">{titre || '—'}</div>
        {badges && <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-bold">{badges}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {lien && <a href={lien} target="_blank" rel="noopener noreferrer" className="mr-1 text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>}
        {onPrev !== undefined && <button type="button" onClick={() => onPrev?.()} disabled={!onPrev} className="rounded-lg border border-[#E5E1D8] px-2.5 py-1.5 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-30" title="Précédent (←)">‹</button>}
        {onNext !== undefined && <button type="button" onClick={() => onNext?.()} disabled={!onNext} className="rounded-lg border border-[#E5E1D8] px-2.5 py-1.5 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-30" title="Suivant (→)">›</button>}
        <button type="button" onClick={onClose} className="rounded-lg border border-[#E5E1D8] px-3 py-1.5 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]" title="Fermer (Échap)">✕ Fermer</button>
      </div>
    </div>
  )
}

function FicheArticle({ row, colonnes, systeme, nav }: {
  row: Row; colonnes: Colonne[]; systeme: 'SAGE' | 'BLG'; nav: { onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null }
}) {
  const groupes = Array.from(new Set(colonnes.map((c) => c.groupe)))
  const badges = systeme === 'SAGE' ? (
    <>
      {row.en_sommeil ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">En sommeil</span> : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Actif</span>}
      {row.present_blg ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Présent dans BLG</span> : <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">Absent de BLG</span>}
      {row.type_nomenclature && row.type_nomenclature !== 'Aucune' && <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[#3A362E]">Nomenclature : {row.type_nomenclature}</span>}
    </>
  ) : (
    <>
      {row.nature && <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[#3A362E]">{row.nature}</span>}
      {(row.tags || []).map((t: string) => <span key={t} className="rounded-full bg-[#B4761A]/[0.12] px-2 py-0.5 text-[#96600F]">{t}</span>)}
      {row.present_sage ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Présent dans SAGE</span> : <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">Absent de SAGE</span>}
    </>
  )
  return (
    <Fenetre onClose={nav.onClose} onPrev={nav.onPrev} onNext={nav.onNext}>
      <BarreFenetre kicker={`${systeme} · ${row.reference}`} titre={safeText(row.designation)} badges={badges} lien={systeme === 'BLG' ? row.lien_blg : null} {...nav} />
      <div className="overflow-auto px-5 py-4">
        {groupes.map((g) => {
          const champs = colonnes.filter((c) => c.groupe === g && c.type !== 'lien').map((c) => ({ c, texte: texteColonne(c, row) })).filter((x) => x.texte)
          if (champs.length === 0) return null
          return (
            <DetailGroup key={g} title={g}>
              {champs.map(({ c, texte }) => (
                c.type === 'liste' && Array.isArray(row[c.key]) ? (
                  <div key={c.key} className="grid grid-cols-[1fr_1.6fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
                    <span className="font-semibold text-[#3A362E]">{c.label}</span>
                    <ul className="space-y-0.5 text-[#111820]">{(row[c.key] as unknown[]).map((v, i) => <li key={i}>{String(v)}</li>)}</ul>
                  </div>
                ) : (
                  <DetailRow key={c.key} label={c.label} value={texte} multiline={c.key === 'commentaire'} />
                )
              ))}
            </DetailGroup>
          )
        })}
      </div>
    </Fenetre>
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
function DetailRow({ label, value, multiline }: { label: string; value: string | null | undefined; multiline?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_1.6fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
      <span className="font-semibold text-[#3A362E]">{label}</span>
      <span className={`text-[#111820] ${multiline ? 'whitespace-pre-line' : ''}`}>{value || '—'}</span>
    </div>
  )
}

function KpiCard({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : '#111820'
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      {loading ? <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[#F4F3F0]" /> : <div className="mt-1 text-[28px] font-bold tracking-tight" style={{ color }}>{value.toLocaleString('fr-FR')}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet SAGE
// ─────────────────────────────────────────────────────────────────────────

function OngletSage({ version }: { version: number }) {
  const [search, setSearch] = useState('')
  const [familleMacro, setFamilleMacro] = useState('')
  const [presenceBlg, setPresenceBlg] = useState<'tous' | 'present' | 'absent'>('tous')
  const [exclureSommeil, setExclureSommeil] = useState(true)
  const [nomenclatureSeule, setNomenclatureSeule] = useState(false)
  const [macros, setMacros] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('ref_familles').select('famille_macro').limit(2000)
      setMacros(Array.from(new Set(((data || []) as Row[]).map((r) => safeText(r.famille_macro)).filter(Boolean))).sort())
    })()
  }, [])

  const appliquer = useCallback((q: any) => {
    const t = termeRecherche(search)
    if (t) q = q.or(`reference.ilike.%${t}%,designation.ilike.%${t}%,fournisseur_principal.ilike.%${t}%,ref_fournisseur.ilike.%${t}%`)
    if (familleMacro) q = q.eq('famille_macro', familleMacro)
    if (presenceBlg !== 'tous') q = q.eq('present_blg', presenceBlg === 'present')
    if (exclureSommeil) q = q.eq('en_sommeil', false)
    if (nomenclatureSeule) q = q.gt('nb_composants', 0)
    return q
  }, [search, familleMacro, presenceBlg, exclureSommeil, nomenclatureSeule])

  const cleFiltres = JSON.stringify({ search, familleMacro, presenceBlg, exclureSommeil, nomenclatureSeule })

  return (
    <ListeArticles
      source="mv_sage_articles_complet"
      colonnes={COLONNES_SAGE}
      colonnesDefaut={COLONNES_SAGE_DEFAUT}
      stockageCle="articles-sage-blg.onglet-sage.v1"
      nomFeuille="Articles SAGE"
      nomFichier="articles_sage"
      appliquerFiltres={appliquer}
      cleFiltres={cleFiltres}
      cleLigne={(r) => safeText(r.reference)}
      limiteEcran={20000}
      version={version}
      filtresServeurActifs={Boolean(search.trim() || familleMacro || presenceBlg !== 'tous' || nomenclatureSeule)}
      onReinitialiserServeur={() => { setSearch(''); setFamilleMacro(''); setPresenceBlg('tous'); setNomenclatureSeule(false) }}
      renderFiche={(r, nav) => <FicheArticle row={r} colonnes={COLONNES_SAGE} systeme="SAGE" nav={nav} />}
      filtresServeur={
        <div className="grid gap-2 md:grid-cols-6">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, désignation, fournisseur ou réf. fournisseur…"
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
          <select value={familleMacro} onChange={(e) => setFamilleMacro(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Famille macro : Toutes</option>
            {macros.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={presenceBlg} onChange={(e) => setPresenceBlg(e.target.value as typeof presenceBlg)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="tous">BLG : présents et absents</option>
            <option value="present">Présents dans BLG</option>
            <option value="absent">Absents de BLG</option>
          </select>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
            Exclure les articles en sommeil
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={nomenclatureSeule} onChange={(e) => setNomenclatureSeule(e.target.checked)} className="accent-[#B4761A]" />
            Avec nomenclature
          </label>
        </div>
      }
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet BLG
// ─────────────────────────────────────────────────────────────────────────

function OngletBlg({ version }: { version: number }) {
  const [search, setSearch] = useState('')
  const [famille, setFamille] = useState('')
  const [presenceSage, setPresenceSage] = useState<'tous' | 'present' | 'absent'>('present')
  const [familles, setFamilles] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('article_family').select('title').limit(1000)
      const titres = ((data || []) as Row[]).map((r) => {
        const t = safeText(r.title)
        if (t.startsWith('{')) { try { const j = JSON.parse(t); return safeText(j.fr_FR || j.en_GB) } catch { return t } }
        return t
      }).filter(Boolean)
      setFamilles(Array.from(new Set(titres)).sort((a, b) => a.localeCompare(b, 'fr')))
    })()
  }, [])

  const appliquer = useCallback((q: any) => {
    const t = termeRecherche(search)
    if (t) q = q.or(`reference.ilike.%${t}%,internal_reference.ilike.%${t}%,designation.ilike.%${t}%,fournisseur_nom.ilike.%${t}%`)
    if (famille) q = q.eq('famille', famille)
    if (presenceSage !== 'tous') q = q.eq('present_sage', presenceSage === 'present')
    return q
  }, [search, famille, presenceSage])

  const cleFiltres = JSON.stringify({ search, famille, presenceSage })

  return (
    <ListeArticles
      source="mv_blg_articles_complet"
      colonnes={COLONNES_BLG}
      colonnesDefaut={COLONNES_BLG_DEFAUT}
      stockageCle="articles-sage-blg.onglet-blg.v1"
      nomFeuille="Articles BLG"
      nomFichier="articles_blg"
      appliquerFiltres={appliquer}
      cleFiltres={cleFiltres}
      cleLigne={(r) => String(r.part_id)}
      limiteEcran={8000}
      version={version}
      filtresServeurActifs={Boolean(search.trim() || famille || presenceSage !== 'present')}
      onReinitialiserServeur={() => { setSearch(''); setFamille(''); setPresenceSage('present') }}
      renderFiche={(r, nav) => <FicheArticle row={r} colonnes={COLONNES_BLG} systeme="BLG" nav={nav} />}
      filtresServeur={
        <>
          <div className="grid gap-2 md:grid-cols-4">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, référence interne, désignation ou fournisseur…"
              className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
            <select value={famille} onChange={(e) => setFamille(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
              <option value="">Famille : Toutes</option>
              {familles.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={presenceSage} onChange={(e) => setPresenceSage(e.target.value as typeof presenceSage)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
              <option value="present">Présents dans SAGE</option>
              <option value="absent">Absents de SAGE (créés dans BLG)</option>
              <option value="tous">Tous les articles BLG</option>
            </select>
          </div>
          <p className="mt-2 text-[12px] text-[#8A8474]">BLG contient beaucoup plus d'articles que SAGE (catalogue fournisseurs importé) : l'écran se limite à 8 000 lignes, affine la recherche au besoin — l'export Excel reprend toujours la totalité.</p>
        </>
      }
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Comparaison — règles tolérantes
// ─────────────────────────────────────────────────────────────────────────

type ResultatComparaison = 'ok' | 'ecart' | 'partiel'
type Evaluation = ResultatComparaison | 'vide' | 'affichage' | 'manquant' | 'blg_maitre'

type PaireArticle = {
  labelSage: string
  sageKey: string
  labelBlg: string
  blgKey: string
  /** false = affiché côte à côte sans comparaison (orange « affiché, non comparé »). */
  compare: boolean
  comparer?: (r: Row) => ResultatComparaison
  /** La règle gère elle-même les valeurs absentes (ex. colisage vide = 1). */
  gereVides?: boolean
  groupe: string
}

const tolPrix = (x: number) => Math.max(0.011, Math.abs(x) * 0.0005)

function comparerNombre(a: unknown, b: unknown, opts: { nullVaut?: number | null; tol?: (x: number) => number } = {}): ResultatComparaison {
  const nv = opts.nullVaut === undefined ? null : opts.nullVaut
  const x = toNum(a) ?? nv
  const y = toNum(b) ?? nv
  if (x === null || y === null) return 'partiel'
  const tol = opts.tol ? opts.tol(x) : 0.0001
  return Math.abs(x - y) <= tol ? 'ok' : 'ecart'
}

function comparerDesignation(a: unknown, b: unknown): ResultatComparaison {
  const s = normaliserTexte(a)
  const t = normaliserTexte(b)
  if (s === t) return 'ok'
  return levenshtein(s.replace(/ /g, ''), t.replace(/ /g, ''), 2) <= 2 ? 'partiel' : 'ecart'
}

const MARQUES_VIDES = new Set(['NONDEFINIE', 'NONRENSEIGNE', 'NONRENSEIGNEE', 'AUCUNE'])
function comparerMarque(a: unknown, b: unknown): ResultatComparaison {
  const s = MARQUES_VIDES.has(compact(a)) ? '' : compact(a)
  const t = MARQUES_VIDES.has(compact(b)) ? '' : compact(b)
  if (!s && !t) return 'ok'
  if (!s || !t) return 'partiel'
  return s === t || s.includes(t) || t.includes(s) ? 'ok' : 'ecart'
}

/** Valeurs codées BLG (catFluideHfc410A, typeEquipmentClim, uoClassique) : on
 * retire le préfixe technique et on compare à une lettre près. */
function comparerCode(a: unknown, b: unknown, prefixe: RegExp): ResultatComparaison {
  const s = compact(a).replace(prefixe, '')
  const valeursB = String(b ?? '').split(',').map((x) => compact(x).replace(prefixe, '')).filter(Boolean)
  if (!s || valeursB.length === 0) return 'partiel'
  return valeursB.some((t) => t === s || levenshtein(t, s, 1) <= 1) ? 'ok' : 'ecart'
}

function comparerDimensions(a: unknown, b: unknown): ResultatComparaison {
  const na = (String(a ?? '').match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')))
  const nb = (String(b ?? '').match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')))
  if (na.length === 0 || nb.length === 0) return 'partiel'
  if (na.join('x') === nb.join('x')) return 'ok'
  return [...na].sort((x, y) => x - y).join('x') === [...nb].sort((x, y) => x - y).join('x') ? 'partiel' : 'ecart'
}

/** Prix tarif : BLG ne porte souvent que le prix net (pas de tarif catalogue).
 * Dans ce cas, si SAGE n'a pas de remise, le tarif SAGE doit égaler le net BLG. */
function comparerTarif(r: Row): ResultatComparaison {
  if (toNum(r.blg_prix_tarif) === null) {
    if ((toNum(r.sage_remise) ?? 0) === 0 && toNum(r.blg_prix_net) !== null && toNum(r.sage_prix_tarif) !== null) return comparerNombre(r.sage_prix_tarif, r.blg_prix_net, { tol: tolPrix })
    return 'partiel'
  }
  return comparerNombre(r.sage_prix_tarif, r.blg_prix_tarif, { tol: tolPrix })
}
function comparerRemise(r: Row): ResultatComparaison {
  const s = toNum(r.sage_remise) ?? 0
  const b = toNum(r.blg_remise)
  if (b === null) return s === 0 ? 'ok' : 'partiel'
  return Math.abs(s - b) <= 0.1 ? 'ok' : 'ecart'
}

function comparerGestionStock(r: Row): ResultatComparaison {
  const sGere = Boolean(r.sage_suivi_stock) && r.sage_suivi_stock !== 'Aucun'
  const bGere = !estVide(r.blg_gestion_stock)
  return sGere === bGere ? 'ok' : 'ecart'
}

function comparerCodeBarre(r: Row): ResultatComparaison {
  const s = compact(r.sage_code_barre)
  const liste = ((r.blg_codes_barres || []) as unknown[]).map(compact)
  if (!s || liste.length === 0) return 'partiel'
  return liste.includes(s) ? 'ok' : 'ecart'
}

/** Nomenclature : "REF × Q" des deux côtés, ordre libre. Rouge si la liste des
 * composants diffère, orange si mêmes composants mais quantités différentes. */
function parserComposants(liste: unknown): Map<string, number> {
  const m = new Map<string, number>()
  ;((liste || []) as unknown[]).forEach((x) => {
    const [ref, q] = String(x).split('×').map((s) => s.trim())
    if (!ref) return
    m.set(compact(ref), (m.get(compact(ref)) ?? 0) + (Number(String(q ?? '1').replace(',', '.')) || 0))
  })
  return m
}
function rapprocherNomenclature(sage: unknown, blg: unknown) {
  const s = parserComposants(sage)
  const b = parserComposants(blg)
  const absentsBlg = Array.from(s.keys()).filter((k) => !b.has(k))
  const enPlusBlg = Array.from(b.keys()).filter((k) => !s.has(k))
  const qteDiff = Array.from(s.keys()).filter((k) => b.has(k) && Math.abs((s.get(k) ?? 0) - (b.get(k) ?? 0)) > 0.0001)
  return { absentsBlg, enPlusBlg, qteDiff }
}
function comparerNomenclature(r: Row): ResultatComparaison {
  const { absentsBlg, enPlusBlg, qteDiff } = rapprocherNomenclature(r.sage_composants, r.blg_composants)
  if (absentsBlg.length > 0 || enPlusBlg.length > 0) return 'ecart'
  return qteDiff.length > 0 ? 'partiel' : 'ok'
}

const PAIRES: PaireArticle[] = [
  { groupe: 'Identification', labelSage: 'Désignation', sageKey: 'sage_designation', labelBlg: 'Libellé', blgKey: 'blg_designation', compare: true, comparer: (r) => comparerDesignation(r.sage_designation, r.blg_designation) },
  { groupe: 'Identification', labelSage: 'Famille', sageKey: 'sage_famille', labelBlg: 'Famille / sous-famille', blgKey: 'blg_famille', compare: false },
  { groupe: 'Identification', labelSage: 'Marque', sageKey: 'sage_marque', labelBlg: 'Marque', blgKey: 'blg_marque', compare: true, gereVides: true, comparer: (r) => comparerMarque(r.sage_marque, r.blg_marque) },
  { groupe: 'Identification', labelSage: 'Statut', sageKey: 'sage_statut', labelBlg: 'Statut (id)', blgKey: 'blg_statut', compare: false },
  { groupe: 'Identification', labelSage: 'Substitut', sageKey: 'sage_substitut', labelBlg: 'Remplacé par', blgKey: 'blg_remplace_par', compare: true, comparer: (r) => (compact(r.sage_substitut) === compact(r.blg_remplace_par) ? 'ok' : 'ecart') },
  { groupe: 'Fournisseur', labelSage: 'Fournisseur principal', sageKey: 'sage_fournisseur', labelBlg: 'Fournisseur', blgKey: 'blg_fournisseur', compare: true, comparer: (r) => (compact(r.sage_fournisseur) === compact(r.blg_fournisseur) ? 'ok' : 'ecart') },
  { groupe: 'Fournisseur', labelSage: 'Réf. fournisseur', sageKey: 'sage_ref_fournisseur', labelBlg: 'Réf. fournisseur', blgKey: 'blg_ref_fournisseur', compare: true, comparer: (r) => (compact(r.sage_ref_fournisseur) === compact(r.blg_ref_fournisseur) ? 'ok' : 'ecart') },
  { groupe: 'Prix', labelSage: 'Prix tarif fournisseur', sageKey: 'sage_prix_tarif', labelBlg: 'Prix tarif', blgKey: 'blg_prix_tarif', compare: true, gereVides: true, comparer: comparerTarif },
  { groupe: 'Prix', labelSage: 'Remise fournisseur (%)', sageKey: 'sage_remise', labelBlg: 'Remise calculée (%)', blgKey: 'blg_remise', compare: true, gereVides: true, comparer: comparerRemise },
  { groupe: 'Prix', labelSage: "Prix d'achat net", sageKey: 'sage_prix_net', labelBlg: "Prix d'achat net", blgKey: 'blg_prix_net', compare: true, comparer: (r) => comparerNombre(r.sage_prix_net, r.blg_prix_net, { tol: tolPrix }) },
  { groupe: 'Prix', labelSage: "Dernier prix d'achat", sageKey: 'sage_dernier_prix_achat', labelBlg: "Dernier prix d'achat", blgKey: 'blg_dernier_prix_achat', compare: true, comparer: (r) => comparerNombre(r.sage_dernier_prix_achat, r.blg_dernier_prix_achat, { tol: tolPrix }) },
  { groupe: 'Prix', labelSage: 'Prix de vente HT', sageKey: 'sage_prix_vente', labelBlg: 'Prix public Cegeclim', blgKey: 'blg_prix_vente', compare: true, gereVides: true, comparer: (r) => comparerNombre(r.sage_prix_vente, r.blg_prix_vente, { nullVaut: 0, tol: tolPrix }) },
  { groupe: 'Caractéristiques', labelSage: 'Poids brut (kg)', sageKey: 'sage_poids', labelBlg: 'Poids (kg)', blgKey: 'blg_poids', compare: true, gereVides: true, comparer: (r) => comparerNombre(r.sage_poids, r.blg_poids, { nullVaut: 0, tol: () => 0.011 }) },
  { groupe: 'Caractéristiques', labelSage: 'Dimensions (HxLxP)', sageKey: 'sage_dimensions', labelBlg: 'Dimensions', blgKey: 'blg_dimensions', compare: true, comparer: (r) => comparerDimensions(r.sage_dimensions, r.blg_dimensions) },
  { groupe: 'Caractéristiques', labelSage: 'Catégorie fluide (HFC)', sageKey: 'sage_categorie_fluide', labelBlg: 'Catégorie fluide', blgKey: 'blg_categorie_fluide', compare: true, comparer: (r) => comparerCode(r.sage_categorie_fluide, r.blg_categorie_fluide, /^CATFLUIDE/) },
  { groupe: 'Caractéristiques', labelSage: "Type d'équipement", sageKey: 'sage_type_equipement', labelBlg: "Type d'équipement", blgKey: 'blg_type_equipement', compare: true, comparer: (r) => comparerCode(r.sage_type_equipement, r.blg_type_equipement, /^TYPEEQUIPMENT/) },
  { groupe: 'Caractéristiques', labelSage: 'UO FMS', sageKey: 'sage_uo_fms', labelBlg: 'UO FMS', blgKey: 'blg_uo_fms', compare: true, comparer: (r) => comparerCode(r.sage_uo_fms, r.blg_uo_fms, /^UO/) },
  { groupe: 'Caractéristiques', labelSage: 'Publié (site marchand)', sageKey: 'sage_publie', labelBlg: 'Catalogue', blgKey: 'blg_catalogue', compare: false },
  { groupe: 'Caractéristiques', labelSage: 'Code-barres', sageKey: 'sage_code_barre', labelBlg: 'Codes-barres', blgKey: 'blg_codes_barres', compare: true, comparer: comparerCodeBarre },
  { groupe: 'Caractéristiques', labelSage: 'Code fiscal / douane', sageKey: 'sage_code_fiscal', labelBlg: 'Code douane', blgKey: 'blg_code_douane', compare: true, comparer: (r) => (compact(r.sage_code_fiscal) === compact(r.blg_code_douane) ? 'ok' : 'ecart') },
  { groupe: 'Caractéristiques', labelSage: "Pays d'origine", sageKey: 'sage_pays', labelBlg: "Pays d'origine", blgKey: 'blg_pays', compare: true, comparer: (r) => (compact(r.sage_pays) === compact(r.blg_pays) ? 'ok' : 'ecart') },
  { groupe: 'Achat et stock', labelSage: 'Colisage', sageKey: 'sage_colisage', labelBlg: 'Colisage achat', blgKey: 'blg_colisage', compare: true, gereVides: true, comparer: (r) => comparerNombre(r.sage_colisage, r.blg_colisage, { nullVaut: 1 }) },
  { groupe: 'Achat et stock', labelSage: 'Qté mini commande', sageKey: 'sage_qte_mini', labelBlg: 'Qté mini achat', blgKey: 'blg_qte_mini', compare: true, gereVides: true, comparer: (r) => comparerNombre(r.sage_qte_mini, r.blg_qte_mini, { nullVaut: 1 }) },
  { groupe: 'Achat et stock', labelSage: 'Suivi de stock', sageKey: 'sage_suivi_stock', labelBlg: 'Gestion des stocks', blgKey: 'blg_gestion_stock', compare: true, gereVides: true, comparer: comparerGestionStock },
  { groupe: 'Achat et stock', labelSage: 'Stock FMS', sageKey: 'sage_stock_fms', labelBlg: 'Stock DPFMS', blgKey: 'blg_stock_fms', compare: true, gereVides: true, comparer: (r) => comparerNombre(r.sage_stock_fms, r.blg_stock_fms, { nullVaut: 0 }) },
  { groupe: 'Achat et stock', labelSage: 'Stock tous dépôts', sageKey: 'sage_stock_total', labelBlg: 'Stock tous entrepôts', blgKey: 'blg_stock_total', compare: true, gereVides: true, comparer: (r) => comparerNombre(r.sage_stock_total, r.blg_stock_total, { nullVaut: 0 }) },
  { groupe: 'Nomenclature', labelSage: 'Nomenclature (composants)', sageKey: 'sage_composants', labelBlg: 'Nomenclature (composants)', blgKey: 'blg_composants', compare: true, comparer: comparerNomenclature },
]

function evaluerPaire(p: PaireArticle, r: Row, blgMaitre: Set<string>): Evaluation {
  if (r.statut_appariement !== 'apparie') return 'manquant'
  if (blgMaitre.has(p.sageKey)) return 'blg_maitre'
  const sv = r[p.sageKey]
  const bv = r[p.blgKey]
  const sVide = estVide(sv)
  const bVide = estVide(bv)
  if (sVide && bVide) return 'vide'
  if (!p.compare) return 'affichage'
  if (p.gereVides && p.comparer) return p.comparer(r)
  if (sVide || bVide) return 'partiel'
  if (p.comparer) return p.comparer(r)
  return normaliserTexte(sv) === normaliserTexte(bv) ? 'ok' : 'ecart'
}

type Evaluations = Record<string, Evaluation>

const COULEUR_OK = 'FFDCFCE7'
const COULEUR_ECART = 'FFFECACA'
const COULEUR_PARTIEL = 'FFFED7AA'
const COULEUR_ENTETE_PAIRE = 'FFE0E7EF'

const EVAL_STYLE: Record<Evaluation, { cellule: string; libelle: string; argb: string }> = {
  ok: { cellule: 'bg-emerald-50 text-emerald-800', libelle: 'Identique', argb: COULEUR_OK },
  ecart: { cellule: 'bg-red-50 font-semibold text-red-800', libelle: 'Écart', argb: COULEUR_ECART },
  partiel: { cellule: 'bg-orange-50 text-orange-800', libelle: 'Partiel / manquant', argb: COULEUR_PARTIEL },
  affichage: { cellule: 'bg-orange-50/50 text-[#3A362E]', libelle: 'Affiché, non comparé', argb: COULEUR_PARTIEL },
  vide: { cellule: 'text-[#B3AD9E]', libelle: 'Vide des deux côtés', argb: 'FFFFFFFF' },
  manquant: { cellule: 'text-[#B3AD9E]', libelle: 'Absent de BLG', argb: COULEUR_PARTIEL },
  blg_maitre: { cellule: 'bg-emerald-50 text-emerald-800', libelle: 'BLG maître (non comparé)', argb: COULEUR_OK },
}

function compterEcarts(ev: Evaluations | undefined) {
  let rouge = 0
  let orange = 0
  if (ev) Object.values(ev).forEach((e) => { if (e === 'ecart') rouge += 1; else if (e === 'partiel') orange += 1 })
  return { rouge, orange }
}

const LIMITE_AFFICHAGE = 500

function NomenclatureRapprochement({ sage, blg }: { sage: unknown; blg: unknown }) {
  const ls = ((sage || []) as unknown[]).map(String)
  const lb = ((blg || []) as unknown[]).map(String)
  if (ls.length === 0 && lb.length === 0) return null
  const { absentsBlg, enPlusBlg, qteDiff } = rapprocherNomenclature(sage, blg)
  const ref = (x: string) => compact(x.split('×')[0])
  return (
    <div className="mt-4 border-t border-[#E5E1D8] pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Nomenclature — {ls.length} composant{ls.length > 1 ? 's' : ''} SAGE / {lb.length} BLG</div>
        {absentsBlg.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{absentsBlg.length} absent{absentsBlg.length > 1 ? 's' : ''} de BLG</span>}
        {enPlusBlg.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">{enPlusBlg.length} en plus dans BLG</span>}
        {qteDiff.length > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">{qteDiff.length} quantité{qteDiff.length > 1 ? 's' : ''} différente{qteDiff.length > 1 ? 's' : ''}</span>}
        {absentsBlg.length === 0 && enPlusBlg.length === 0 && qteDiff.length === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Identiques</span>}
      </div>
      <div className="grid grid-cols-2 gap-4 text-[12px]">
        {[{ titre: 'SAGE', liste: ls, rouges: absentsBlg, note: 'absent de BLG' }, { titre: 'BLG', liste: lb, rouges: enPlusBlg, note: 'absent de SAGE' }].map((col) => (
          <div key={col.titre}>
            <div className="mb-1 font-semibold text-[#3A362E]">{col.titre}</div>
            <ul className="space-y-0.5">
              {col.liste.map((c, i) => {
                const k = ref(c)
                const rouge = col.rouges.includes(k)
                const orange = qteDiff.includes(k)
                return (
                  <li key={i} className={`rounded px-2 py-0.5 font-mono ${rouge ? 'bg-red-50 font-semibold text-red-800' : orange ? 'bg-orange-50 text-orange-800' : 'text-[#111820]'}`}>
                    {c}{rouge && <span className="ml-1 font-sans text-[10px] font-bold text-red-600">{col.note}</span>}{orange && <span className="ml-1 font-sans text-[10px] font-bold text-orange-600">quantité différente</span>}
                  </li>
                )
              })}
              {col.liste.length === 0 && <li className="text-[#B3AD9E]">—</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function ArticleComparaisonModal({ row, evals, onClose, onPrev, onNext }: { row: Row; evals: Evaluations; onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null }) {
  const { rouge, orange } = compterEcarts(evals)
  const groupes = Array.from(new Set(PAIRES.map((p) => p.groupe)))
  const badges = row.statut_appariement !== 'apparie' ? (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">Absent de BLG</span>
  ) : (
    <>
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{rouge} écart{rouge > 1 ? 's' : ''}</span>
      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">{orange} partiel{orange > 1 ? 's' : ''}</span>
      {rouge === 0 && orange === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">OK</span>}
      {row.appariement_via === 'internal_reference' && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700">Apparié via la référence interne BLG ({row.blg_reference})</span>}
      {row.sage_en_sommeil && <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[#8A8474]">En sommeil (SAGE)</span>}
    </>
  )
  const infos: Array<[string, unknown]> = [
    ['Nature BLG', row.blg_nature], ['Catégorie e-commerce', row.blg_categorie], ['Tags BLG', row.blg_tags],
    ['Références actives BLG', row.blg_references_actives], ['Fournisseurs SAGE', row.sage_fournisseurs],
    ['Articles conseillés (BLG)', row.blg_articles_conseilles], ['Conseillé avec (BLG)', row.blg_conseille_avec], ['Utilisé dans (SAGE)', row.sage_utilise_dans],
    ['Éco-contribution BLG', row.blg_eco_code ? `${row.blg_eco_code} — ${formatCellValue(row.blg_eco_montant)} €` : null],
    ['Type de nomenclature SAGE', row.sage_type_nomenclature], ['Dernière MàJ', `SAGE ${formatDateHeure(row.sage_updated_at)} · BLG ${formatDateHeure(row.blg_last_update)}`],
  ]
  return (
    <Fenetre onClose={onClose} onPrev={onPrev} onNext={onNext} largeur="max-w-6xl">
      <BarreFenetre kicker={row.reference_article} titre={safeText(row.sage_designation || row.blg_designation)} badges={badges} lien={row.lien_blg} onClose={onClose} onPrev={onPrev} onNext={onNext} />
      <div className="overflow-auto p-5">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-white text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
            <tr className="border-b border-[#E5E1D8]">
              <th className="py-2 pr-2">Champ SAGE</th><th className="py-2 pr-2">Valeur SAGE</th><th className="py-2 pr-2">Champ BLG</th><th className="py-2 pr-2">Valeur BLG</th><th className="py-2">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {groupes.map((g) => (
              <React.Fragment key={g}>
                <tr><td colSpan={5} className="pb-1 pt-3 text-[10px] font-bold uppercase tracking-wide text-[#B4761A]">{g}</td></tr>
                {PAIRES.filter((p) => p.groupe === g).map((p) => {
                  const ev = evals[p.sageKey] ?? 'vide'
                  const st = EVAL_STYLE[ev]
                  return (
                    <tr key={p.sageKey} className={`border-b border-[#F4F3F0] align-top ${ev === 'ecart' ? 'bg-red-50/60' : ev === 'partiel' ? 'bg-orange-50/60' : ''}`}>
                      <td className="py-1.5 pr-2 font-semibold text-[#3A362E]">{p.labelSage}</td>
                      <td className={`max-w-[300px] py-1.5 pr-2 ${ev === 'ecart' ? 'font-bold text-red-800' : 'text-[#111820]'}`}>{formatCellValue(row[p.sageKey])}</td>
                      <td className="py-1.5 pr-2 font-semibold text-[#3A362E]">{p.labelBlg}</td>
                      <td className={`max-w-[300px] py-1.5 pr-2 ${ev === 'ecart' ? 'font-bold text-red-800' : 'text-[#111820]'}`}>{formatCellValue(row[p.blgKey])}</td>
                      <td className="py-1.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cellule}`}>{st.libelle}</span></td>
                    </tr>
                  )
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {row.statut_appariement === 'apparie' && <NomenclatureRapprochement sage={row.sage_composants} blg={row.blg_composants} />}

        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-[#E5E1D8] pt-3 text-[12px] md:grid-cols-2">
          {infos.filter(([, v]) => !estVide(v)).map(([k, v]) => (
            <div key={k}><span className="font-semibold text-[#3A362E]">{k} :</span> <span className="text-[#111820]">{formatCellValue(v)}</span></div>
          ))}
        </div>
      </div>
    </Fenetre>
  )
}

function OngletComparaison({ version }: { version: number }) {
  const [toutes, setToutes] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [nbBlgSeuls, setNbBlgSeuls] = useState(0)

  const [statut, setStatut] = useState<'tous' | 'apparie' | 'manquant_blg'>('tous')
  const [exclureSommeil, setExclureSommeil] = useState(true)
  const [familleMacro, setFamilleMacro] = useState('')
  const [search, setSearch] = useState('')
  const [onlyEcarts, setOnlyEcarts] = useState(false)
  const [champsSelectionnes, setChampsSelectionnes] = useState<string[]>([])
  const [combinaison, setCombinaison] = useState<'ou' | 'et'>('ou')

  const [ligneActive, setLigneActive] = useState<Row | null>(null)
  const [ouvert, setOuvert] = useState<Row | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const [blgMaitre, setBlgMaitre] = useState<Set<string>>(new Set())
  const [showMaitre, setShowMaitre] = useState(false)
  const [maitreMessage, setMaitreMessage] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [{ rows }, blgSeuls] = await Promise.all([
          chargerPagine((from, to) => supabase.from('v_controle_article_sage_blg').select('*').order('reference_article').range(from, to), 100000, (n) => { if (!annule) setProgress(n) }),
          supabase.from('mv_blg_articles_complet').select('part_id', { count: 'exact', head: true }).eq('present_sage', false),
        ])
        if (annule) return
        setToutes(rows)
        setNbBlgSeuls(blgSeuls.count ?? 0)
      } catch (e) {
        if (!annule) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!annule) setLoading(false)
      }
    })()
    return () => { annule = true }
  }, [version])

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase.from('controle_champ_maitre').select('champ_cle,systeme_maitre').eq('domaine', 'article')
      if (err) { setMaitreMessage(`Champs maîtres non chargés : ${err.message}`); return }
      setBlgMaitre(new Set(((data || []) as Row[]).filter((m) => m.systeme_maitre === 'blg').map((m) => String(m.champ_cle))))
    })()
  }, [])

  async function toggleBlgMaitre(cle: string) {
    const actif = blgMaitre.has(cle)
    const avant = blgMaitre
    const next = new Set(blgMaitre)
    if (actif) next.delete(cle); else next.add(cle)
    setBlgMaitre(next)
    setMaitreMessage(null)
    const { data: auth } = await supabase.auth.getUser()
    const { error: err } = actif
      ? await supabase.from('controle_champ_maitre').delete().eq('domaine', 'article').eq('champ_cle', cle)
      : await supabase.from('controle_champ_maitre').upsert(
          { domaine: 'article', champ_cle: cle, systeme_maitre: 'blg', updated_at: new Date().toISOString(), updated_by: auth?.user?.email ?? null },
          { onConflict: 'domaine,champ_cle' },
        )
    if (err) { setMaitreMessage(`Enregistrement impossible : ${err.message}`); setBlgMaitre(avant) }
  }

  const macros = useMemo(() => Array.from(new Set(toutes.map((r) => safeText(r.sage_famille_macro)).filter(Boolean))).sort(), [toutes])

  // Périmètre (filtres de base) puis évaluation
  const perimetre = useMemo(() => toutes.filter((r) => {
    if (statut !== 'tous' && r.statut_appariement !== statut) return false
    if (exclureSommeil && r.sage_en_sommeil) return false
    if (familleMacro && safeText(r.sage_famille_macro) !== familleMacro) return false
    return true
  }), [toutes, statut, exclureSommeil, familleMacro])

  const evaluations = useMemo(() => {
    const m = new Map<string, Evaluations>()
    perimetre.forEach((r) => {
      const ev: Evaluations = {}
      PAIRES.forEach((p) => { ev[p.sageKey] = evaluerPaire(p, r, blgMaitre) })
      m.set(r.reference_article, ev)
    })
    return m
  }, [perimetre, blgMaitre])

  const statsChamps = useMemo(() => {
    const s: Record<string, { rouge: number; orange: number }> = {}
    PAIRES.forEach((p) => { s[p.sageKey] = { rouge: 0, orange: 0 } })
    evaluations.forEach((ev) => Object.entries(ev).forEach(([k, e]) => { if (e === 'ecart') s[k].rouge += 1; else if (e === 'partiel') s[k].orange += 1 }))
    return s
  }, [evaluations])

  const kpis = useMemo(() => {
    let apparies = 0, manquants = 0, sansEcart = 0, avecEcart = 0
    perimetre.forEach((r) => {
      if (r.statut_appariement !== 'apparie') { manquants += 1; return }
      apparies += 1
      if (compterEcarts(evaluations.get(r.reference_article)).rouge > 0) avecEcart += 1; else sansEcart += 1
    })
    return { total: perimetre.length, apparies, manquants, sansEcart, avecEcart }
  }, [perimetre, evaluations])

  const pairesSelectionnees = useMemo(() => PAIRES.filter((p) => champsSelectionnes.includes(p.sageKey)), [champsSelectionnes])

  const rowsFiltrees = useMemo(() => {
    const term = normaliserTexte(search)
    return perimetre.filter((r) => {
      if (term && !(normaliserTexte(r.reference_article).includes(term) || normaliserTexte(r.sage_designation).includes(term) || normaliserTexte(r.blg_designation).includes(term) || normaliserTexte(r.sage_fournisseur).includes(term))) return false
      const ev = evaluations.get(r.reference_article) || {}
      if (onlyEcarts && compterEcarts(ev).rouge === 0) return false
      if (champsSelectionnes.length > 0) {
        const concerne = (k: string) => ev[k] === 'ecart' || ev[k] === 'partiel'
        if (combinaison === 'ou' ? !champsSelectionnes.some(concerne) : !champsSelectionnes.every(concerne)) return false
      }
      return true
    })
  }, [perimetre, evaluations, search, onlyEcarts, champsSelectionnes, combinaison])

  const rowsAffichees = useMemo(() => rowsFiltrees.slice(0, LIMITE_AFFICHAGE), [rowsFiltrees])
  const memeLigne = (a: Row, b: Row) => a.reference_article === b.reference_article
  const { refs, onKeyDown } = useNavigationClavier(rowsAffichees, ligneActive, setLigneActive, memeLigne, (r) => setOuvert(r))
  const indexOuvert = ouvert ? rowsFiltrees.findIndex((r) => memeLigne(r, ouvert)) : -1

  function toggleChamp(k: string) {
    setChampsSelectionnes((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Comparaison articles')
      const simples: Array<[string, (r: Row) => string]> = [
        ['Référence', (r) => safeText(r.reference_article)],
        ['Statut appariement', (r) => (r.statut_appariement === 'apparie' ? 'Apparié' : 'Absent de BLG')],
        ['Appariement via', (r) => safeText(r.appariement_via)],
        ['Famille macro (SAGE)', (r) => safeText(r.sage_famille_macro)],
        ['En sommeil (SAGE)', (r) => (r.sage_en_sommeil ? 'Oui' : 'Non')],
        ['Nb écarts', (r) => String(compterEcarts(evaluations.get(r.reference_article)).rouge)],
        ['Nb partiels', (r) => String(compterEcarts(evaluations.get(r.reference_article)).orange)],
        ['Champs en écart', (r) => { const ev = evaluations.get(r.reference_article) || {}; return PAIRES.filter((p) => ev[p.sageKey] === 'ecart').map((p) => p.labelSage).join(', ') }],
        ['Lien BLG', (r) => safeText(r.lien_blg)],
      ]
      const entetes: Array<{ texte: string; paire: boolean; g?: boolean; d?: boolean }> = simples.map(([t]) => ({ texte: t, paire: false }))
      PAIRES.forEach((p) => {
        entetes.push({ texte: `${p.labelSage} — SAGE`, paire: true, g: true })
        entetes.push({ texte: `${p.labelBlg} — BLG`, paire: true, d: true })
      })
      ws.addRow(entetes.map((h) => h.texte))
      const l1 = ws.getRow(1)
      l1.font = { bold: true }
      l1.eachCell((cell, n) => {
        const h = entetes[n - 1]
        cell.alignment = { wrapText: true, vertical: 'middle' }
        if (h.paire) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEUR_ENTETE_PAIRE } }
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: h.g ? 'medium' : 'thin' }, right: { style: h.d ? 'medium' : 'thin' } }
        }
      })
      rowsFiltrees.forEach((r) => {
        const ev = evaluations.get(r.reference_article) || {}
        const valeurs: Array<string | number> = simples.map(([, f]) => f(r))
        PAIRES.forEach((p) => {
          const sv = r[p.sageKey]
          const bv = r[p.blgKey]
          valeurs.push(typeof sv === 'number' ? sv : estVide(sv) ? '' : formatCellValue(sv))
          valeurs.push(typeof bv === 'number' ? bv : estVide(bv) ? '' : formatCellValue(bv))
        })
        const ligne = ws.addRow(valeurs)
        let col = simples.length
        PAIRES.forEach((p) => {
          const argb = EVAL_STYLE[ev[p.sageKey] ?? 'vide'].argb
          const bord = { top: { style: 'thin' as const }, bottom: { style: 'thin' as const } }
          col += 1
          const cs = ligne.getCell(col)
          cs.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
          cs.border = { ...bord, left: { style: 'medium' } }
          col += 1
          const cb = ligne.getCell(col)
          cb.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
          cb.border = { ...bord, right: { style: 'medium' } }
        })
      })
      ws.columns.forEach((c) => { c.width = 22 })
      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]
      const li = rowsFiltrees.length + 3
      ws.getCell(`A${li}`).value = 'Légende :'
      ws.getCell(`A${li}`).font = { bold: true }
      ;([
        ['Identique ou équivalent (règle tolérante du champ) — ou champ dont BLG est maître', COULEUR_OK],
        ['Écart réel', COULEUR_ECART],
        ['Donnée manquante d’un côté, écart partiel ou champ affiché sans comparaison', COULEUR_PARTIEL],
      ] as Array<[string, string]>).forEach(([t, c], i) => {
        const cell = ws.getCell(`A${li + 1 + i}`)
        cell.value = t
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c } }
      })
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `comparaison_articles_sage_blg_${new Date().toISOString().slice(0, 10)}.xlsx`
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
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KpiCard label="Articles SAGE" value={kpis.total} loading={loading} />
        <KpiCard label="Appariés avec BLG" value={kpis.apparies} loading={loading} />
        <KpiCard label="Absents de BLG" value={kpis.manquants} loading={loading} tone="warn" />
        <KpiCard label="Sans écart" value={kpis.sansEcart} loading={loading} tone="ok" />
        <KpiCard label="Avec au moins un écart" value={kpis.avecEcart} loading={loading} tone="warn" />
        <KpiCard label="Articles BLG absents de SAGE" value={nbBlgSeuls} loading={loading} />
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs contrôlés — écarts par champ</div>
          <div className="flex items-center gap-3 text-[12px]">
            {champsSelectionnes.length >= 2 && (
              <div className="flex items-center gap-1 font-semibold text-[#3A362E]">
                Articles concernés par :
                <button type="button" onClick={() => setCombinaison('ou')} className={`rounded px-2 py-0.5 ${combinaison === 'ou' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>au moins un</button>
                <button type="button" onClick={() => setCombinaison('et')} className={`rounded px-2 py-0.5 ${combinaison === 'et' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>tous</button>
              </div>
            )}
            {champsSelectionnes.length > 0 && <button type="button" onClick={() => setChampsSelectionnes([])} className="font-bold text-[#B4761A] hover:underline">Tout désélectionner</button>}
            <button type="button" onClick={() => setShowMaitre((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-bold transition-colors ${showMaitre ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}
              title="Déclarer les champs pour lesquels BLG est maître (ils ne sont plus comparés)">
              ⚙ BLG maître ({blgMaitre.size})
            </button>
          </div>
        </div>
        {loading ? <div className="h-24 animate-pulse rounded bg-[#F4F3F0]" /> : (
          <div className="flex flex-wrap gap-2">
            {PAIRES.map((p) => {
              const s = statsChamps[p.sageKey]
              const actif = champsSelectionnes.includes(p.sageKey)
              const maitre = blgMaitre.has(p.sageKey)
              const sansEcart = p.compare && !maitre && s.rouge === 0 && s.orange === 0
              return (
                <button key={p.sageKey} type="button" onClick={() => toggleChamp(p.sageKey)} title={maitre ? `BLG maître — non comparé (BLG : ${p.labelBlg})` : `BLG : ${p.labelBlg}`}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                    actif ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#96600F]'
                      : maitre || sansEcart ? 'border-emerald-200 bg-emerald-50/60 text-[#3A362E] hover:bg-emerald-50'
                        : 'border-[#E5E1D8] bg-[#F4F3F0] text-[#3A362E] hover:bg-[#EDEAE1]'}`}>
                  <span>{p.labelSage}</span>
                  {maitre ? (
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">BLG maître</span>
                  ) : !p.compare ? (
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
          Rouge = écart réel, orange = donnée manquante d'un côté ou écart partiel, ✓ vert = aucun écart. Clique sur un ou plusieurs champs pour ne voir que les articles concernés, avec les valeurs SAGE / BLG en colonnes.
        </p>
        <details className="mt-2 text-[12px] text-[#8A8474]">
          <summary className="cursor-pointer font-semibold text-[#3A362E]">Règles de comparaison</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Textes : accents, casse et ponctuation ignorés ; désignation à 2 lettres près = orange.</li>
            <li>Marque : « Non définie » / « non-renseigné » valent vide ; « BOURGEOIS » ≈ « Bourgeois Global ».</li>
            <li>Codes BLG (catFluideHfc410A, typeEquipmentClim, uoClassique) : préfixe retiré, une lettre d'écart tolérée.</li>
            <li>Prix : tolérance d'un centime (0,05 % au-delà de 20 €). Quand BLG n'a pas de prix tarif et que SAGE n'a pas de remise, le tarif SAGE est comparé au net BLG.</li>
            <li>Colisage et quantité mini : vide = 1. Poids, stocks, prix de vente : vide = 0.</li>
            <li>Suivi de stock : « Aucun » SAGE ↔ gestion de stock vide BLG ; tout autre suivi ↔ gestion renseignée.</li>
            <li>Nomenclature : composants SAGE (sage.nomenclature) ↔ marques de la nomenclature BLG de même référence, ordre libre ; quantités différentes = orange.</li>
            <li>Famille, statut et publication : affichés côte à côte, pas d'équivalence de codes entre SAGE et BLG.</li>
          </ul>
        </details>

        {showMaitre && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[12px] font-bold text-[#111820]">Champs pour lesquels BLG est maître</div>
                <p className="text-[12px] text-[#8A8474]">Coche un champ pour le sortir de la comparaison : il passe en vert « BLG maître » partout (pastilles, KPI, fenêtre, export). Réglage partagé, enregistré en base.</p>
              </div>
              {maitreMessage && <span className="text-[12px] font-semibold text-red-600">{maitreMessage}</span>}
            </div>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {PAIRES.filter((p) => p.compare).map((p) => (
                <label key={p.sageKey} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-white">
                  <input type="checkbox" checked={blgMaitre.has(p.sageKey)} onChange={() => void toggleBlgMaitre(p.sageKey)} className="accent-emerald-600" />
                  <span className="font-semibold text-[#3A362E]">{p.labelSage}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="grid gap-2 md:grid-cols-6">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, désignation ou fournisseur…"
            className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
          <select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="tous">Statut : Tous</option>
            <option value="apparie">Apparié avec BLG</option>
            <option value="manquant_blg">Absent de BLG</option>
          </select>
          <select value={familleMacro} onChange={(e) => setFamilleMacro(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <option value="">Famille macro : Toutes</option>
            {macros.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
            Exclure en sommeil
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={onlyEcarts} onChange={(e) => setOnlyEcarts(e.target.checked)} className="accent-[#B4761A]" />
            Avec écart réel uniquement
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
          <span className="text-[12px] text-[#8A8474]">
            {loading ? `Chargement… ${progress} article${progress > 1 ? 's' : ''}` : `${rowsFiltrees.length} article${rowsFiltrees.length > 1 ? 's' : ''} correspondent aux filtres (sur ${perimetre.length} dans le périmètre)`}
          </span>
          <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || rowsFiltrees.length === 0}
            className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60">
            {exportEnCours ? 'Export en cours…' : `⬇ Exporter en Excel (${rowsFiltrees.length} articles, tous les champs)`}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
            {loading ? 'Chargement…' : rowsFiltrees.length > LIMITE_AFFICHAGE ? `${LIMITE_AFFICHAGE} affichés sur ${rowsFiltrees.length} — affine les filtres ou exporte en Excel pour voir le reste` : `${rowsFiltrees.length} résultat${rowsFiltrees.length > 1 ? 's' : ''}`}
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-[12px] font-semibold text-red-600">{error}</span>}
            <span className="text-[11px] text-[#8A8474]">Clic ou Entrée : fenêtre avec tous les champs comparés</span>
          </div>
        </div>
        <div tabIndex={0} onKeyDown={onKeyDown} className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
              <tr>
                <th className="px-3 py-2 font-bold">Article</th>
                <th className="px-3 py-2 font-bold">Fournisseur</th>
                <th className="px-3 py-2 font-bold">Statut</th>
                {pairesSelectionnees.map((p) => (
                  <React.Fragment key={p.sageKey}>
                    <th className="border-l-2 border-[#E5E1D8] px-3 py-2 font-bold">{p.labelSage} — SAGE</th>
                    <th className="border-r-2 border-[#E5E1D8] px-3 py-2 font-bold">{p.labelBlg} — BLG</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsAffichees.map((r, i) => {
                const ev = evaluations.get(r.reference_article) || {}
                const { rouge, orange } = compterEcarts(ev)
                const actif = ligneActive?.reference_article === r.reference_article
                return (
                  <tr key={r.reference_article} ref={(el) => { refs.current[i] = el }} onClick={() => { setLigneActive(r); setOuvert(r) }}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${actif ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                    <td className="max-w-[420px] px-3 py-2">
                      <div className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.reference_article}</div>
                      <div className="truncate text-[12px] text-[#111820]">{r.sage_designation || '—'}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[#3A362E]">{r.sage_fournisseur || '—'}</td>
                    <td className="px-3 py-2">
                      {r.statut_appariement !== 'apparie' ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Absent de BLG</span>
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
                <tr><td colSpan={3 + pairesSelectionnees.length * 2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {ouvert && (
        <ArticleComparaisonModal
          row={ouvert}
          evals={evaluations.get(ouvert.reference_article) || {}}
          onClose={() => setOuvert(null)}
          onPrev={indexOuvert > 0 ? () => { setOuvert(rowsFiltrees[indexOuvert - 1]); setLigneActive(rowsFiltrees[indexOuvert - 1]) } : null}
          onNext={indexOuvert >= 0 && indexOuvert < rowsFiltrees.length - 1 ? () => { setOuvert(rowsFiltrees[indexOuvert + 1]); setLigneActive(rowsFiltrees[indexOuvert + 1]) } : null}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────

type OngletPrincipal = 'sage' | 'blg' | 'comparaison'

export default function ArticlesSageBlgPage() {
  const [onglet, setOnglet] = useState<OngletPrincipal>('comparaison')
  const [version, setVersion] = useState(0)
  const [rafraichiLe, setRafraichiLe] = useState<string | null>(null)
  const [actualisation, setActualisation] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const lireDate = useCallback(async () => {
    const { data } = await supabase.from('controle_articles_refresh').select('refreshed_at').eq('id', 1).maybeSingle()
    setRafraichiLe((data as Row | null)?.refreshed_at ?? null)
  }, [])
  useEffect(() => { void lireDate() }, [lireDate])

  async function actualiser() {
    setActualisation(true)
    setMessage(null)
    const { error } = await supabase.rpc('refresh_controle_articles')
    if (error) setMessage(`Actualisation impossible : ${error.message}`)
    else { await lireDate(); setVersion((v) => v + 1) }
    setActualisation(false)
  }

  return (
    <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Référentiel articles</p>
              <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-[#111820]">Articles SAGE / BLG</h1>
              <p className="mt-1 text-[13px] text-[#8A8474]">Contrôle indépendant des deux bases et comparaison champ par champ pour préparer la bascule.</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <button type="button" onClick={() => void actualiser()} disabled={actualisation}
                className="rounded-lg bg-[#111820] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60">
                {actualisation ? 'Actualisation… (quelques secondes)' : '↻ Actualiser les données'}
              </button>
              <span className="text-[12px] text-[#8A8474]">Données consolidées le {formatDateHeure(rafraichiLe)} · actualisation automatique toutes les heures</span>
              {message && <span className="text-[12px] font-semibold text-red-600">{message}</span>}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <OngletTab active={onglet === 'sage'} onClick={() => setOnglet('sage')} label="SAGE" />
            <OngletTab active={onglet === 'blg'} onClick={() => setOnglet('blg')} label="BLG" />
            <OngletTab active={onglet === 'comparaison'} onClick={() => setOnglet('comparaison')} label="Comparaison" />
          </div>
        </section>

        {onglet === 'sage' && <OngletSage version={version} />}
        {onglet === 'blg' && <OngletBlg version={version} />}
        {onglet === 'comparaison' && <OngletComparaison version={version} />}
      </div>
    </main>
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
