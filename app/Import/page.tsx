
'use client'

import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'

type TableKey =
  | 'ref_familles'
  | 'ref_code_naf'
  | 'ref_collaborateurs'
  | 'ref_articles'
  | 'ref_tiers'
  | 'facture_lignes'
  | 'activite_lignes'

type ColumnType = 'text' | 'number' | 'boolean' | 'date'

type ColumnConfig = {
  db: string
  label: string
  type?: ColumnType
  required?: boolean
  readonly?: boolean
  aliases?: string[]
  numberFormat?: 'standard' | 'percent_ratio'
}

type TableConfig = {
  key: TableKey
  label: string
  primaryKey: string
  secondaryKeys?: string[]
  description: string
  columns: ColumnConfig[]
}

type TableStats = {
  count: number
  lastImportAt: string | null
  lastCreatedKey: string | null
  lastCreatedAt: string | null
}

type GenericRow = Record<string, any>

type ImportRejectRow = {
  type: string
  message: string
}

type ImportResult = {
  table: string
  imported: number
  updated: number
  rejected: number
  errors: string[]
}

type ImportStepStatus = 'waiting' | 'running' | 'done' | 'error'

type ImportStep = {
  id: string
  label: string
  status: ImportStepStatus
  detail?: string
}

const LINE_IMPORT_STEP_TEMPLATE: ImportStep[] = [
  { id: 'disable_triggers', label: '1. Désactivation temporaire des triggers', status: 'waiting' },
  { id: 'read_file', label: '2. Lecture et contrôle du fichier Excel', status: 'waiting' },
  { id: 'check_existing', label: '3. Vérification des lignes déjà présentes', status: 'waiting' },
  { id: 'upsert', label: '4. Import des données dans la table principale', status: 'waiting' },
  { id: 'enable_triggers', label: '5. Réactivation des triggers', status: 'waiting' },
  { id: 'refresh_caches', label: '6. Mise à jour des agrégats/cache', status: 'waiting' },
]

const STANDARD_IMPORT_STEP_TEMPLATE: ImportStep[] = [
  { id: 'read_file', label: '1. Lecture et contrôle du fichier Excel', status: 'waiting' },
  { id: 'check_existing', label: '2. Vérification des lignes déjà présentes', status: 'waiting' },
  { id: 'upsert', label: '3. Import des données dans la table principale', status: 'waiting' },
]


const LINE_TABLE_KEYS: TableKey[] = ['facture_lignes', 'activite_lignes']

// Lots volontairement petits pour éviter les timeouts Supabase/PostgreSQL sur les grosses tables.
// Les lignes de factures / activité déclenchent plus de contrôles : clé unique, FK tiers/articles,
// et parfois triggers d'agrégats. 75 est un bon compromis stabilité / vitesse.
const DEFAULT_UPSERT_CHUNK_SIZE = 250
// Passage à 25 pour les grosses tables : évite les requêtes trop longues et facilite le diagnostic.
const LINE_UPSERT_CHUNK_SIZE = 25

function isLineTableKey(key: TableKey) {
  return LINE_TABLE_KEYS.includes(key)
}

function getUpsertChunkSize(key: TableKey) {
  return isLineTableKey(key) ? LINE_UPSERT_CHUNK_SIZE : DEFAULT_UPSERT_CHUNK_SIZE
}

function isMissingFunctionError(error: any) {
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  const all = `${message} ${details} ${hint}`

  return (
    error?.code === '42883' ||
    (all.includes('function') && all.includes('does not exist')) ||
    (all.includes('could not find') && all.includes('function')) ||
    (all.includes('schema cache') && all.includes('function'))
  )
}

function isStatementTimeoutError(error: any) {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === '57014' || message.includes('statement timeout') || message.includes('canceling statement due to statement timeout')
}

function comparableValue(value: any) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  const text = String(value).trim()
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(text)) return text.slice(0, 10)
  return text
}

function hasBusinessDifference(nextRow: GenericRow, existingRow: GenericRow | undefined, config: TableConfig) {
  if (!existingRow) return true

  return config.columns.some((column) => {
    const key = column.db
    return comparableValue(nextRow[key]) !== comparableValue(existingRow[key])
  })
}

const TABLES: TableConfig[] = [
  {
    key: 'ref_familles',
    label: 'Familles',
    primaryKey: 'famille',
    description: 'Référentiel familles articles / tiers.',
    columns: [
      { db: 'famille', label: 'Famille', required: true },
      { db: 'famille_macro', label: 'Famille macro' },
    ],
  },
  {
    key: 'ref_code_naf',
    label: 'Codes NAF',
    primaryKey: 'code_naf',
    description: 'Référentiel codes NAF.',
    columns: [
      { db: 'code_naf', label: 'Code NAF', required: true },
      { db: 'libelle_naf', label: 'Libellé NAF' },
      { db: 'contenu_correspondance', label: 'Contenu correspondance' },
    ],
  },
  {
    key: 'ref_collaborateurs',
    label: 'Collaborateurs',
    primaryKey: 'nom',
    description: 'Référentiel collaborateurs.',
    columns: [
      { db: 'nom', label: 'Nom', required: true },
      { db: 'prenom', label: 'Prénom' },
      { db: 'fonction', label: 'Fonction' },
      { db: 'service', label: 'Service' },
      { db: 'telephone', label: 'Téléphone' },
      { db: 'mise_en_sommeil', label: 'Mise en sommeil', type: 'boolean' },
      { db: 'agence', label: 'Agence' },
    ],
  },
  {
    key: 'ref_articles',
    label: 'Articles',
    primaryKey: 'reference_article',
    description: 'Référentiel articles avec relation famille.',
    columns: [
      { db: 'reference_article', label: 'Référence article', required: true },
      { db: 'type_article', label: 'Type article' },
      { db: 'designation', label: 'Désignation' },
      { db: 'nomenclature', label: 'Nomenclature' },
      { db: 'famille', label: 'Famille' },
      { db: 'unite_vente', label: 'Unité vente' },
      { db: 'suivi_stock', label: 'Suivi stock' },
      { db: 'mise_en_sommeil', label: 'Mise en sommeil', type: 'boolean' },
      { db: 'prix_achat', label: 'Prix achat', type: 'number' },
      { db: 'prix_vente', label: 'Prix vente', type: 'number' },
      { db: 'fournisseur_principal', label: 'Fournisseur principal' },
      { db: 'stock_reel', label: 'Stock réel', type: 'number' },
      { db: 'stock_disponible', label: 'Stock disponible', type: 'number' },
      { db: 'stock_terme', label: 'Stock terme', type: 'number' },
      { db: 'zone_libre', label: 'Zone libre' },
      { db: 'article_substitution', label: 'Article substitution' },
      { db: 'criticite', label: 'Criticité' },
      { db: 'date_creation', label: 'Date création', type: 'date' },
      { db: 'categorie_fluide_hfc', label: 'Catégorie fluide HFC' },
      { db: 'marque', label: 'Marque' },
      { db: 'type_equipement', label: 'Type équipement' },
      { db: 'type_gaz', label: 'Type gaz' },
      { db: 'hors_statistique', label: 'Hors statistique', type: 'boolean' },
    ],
  },
  {
    key: 'ref_tiers',
    label: 'Tiers',
    primaryKey: 'numero',
    description: 'Référentiel clients / prospects / tiers.',
    columns: [
      { db: 'numero', label: 'Numéro', required: true },
      { db: 'prospect', label: 'Prospect', type: 'boolean' },
      { db: 'intitule', label: 'Intitulé' },
      { db: 'abrege', label: 'Abrégé' },
      { db: 'qualite', label: 'Qualité' },
      { db: 'contact', label: 'Contact' },
      { db: 'adresse', label: 'Adresse' },
      { db: 'complement_adresse', label: 'Complément adresse' },
      { db: 'code_postal', label: 'Code postal' },
      { db: 'ville', label: 'Ville' },
      { db: 'region', label: 'Région' },
      { db: 'pays', label: 'Pays' },
      { db: 'telephone', label: 'Téléphone' },
      { db: 'telecopie', label: 'Télécopie' },
      { db: 'linkedin', label: 'LinkedIn' },
      { db: 'facebook', label: 'Facebook' },
      { db: 'email', label: 'E-mail', aliases: ['Email', 'E-mail'] },
      { db: 'site', label: 'Site' },
      { db: 'siret', label: 'N° de siret', aliases: ['SIRET', 'N° de siret', 'N° SIRET'] },
      { db: 'numero_identifiant', label: 'N° identifiant' },
      { db: 'code_naf', label: 'Code NAF' },
      { db: 'payeur', label: 'Payeur' },
      { db: 'representant', label: 'Représentant' },
      { db: 'centrale_achat', label: 'Centrale d achat' },
      { db: 'categorie_tarifaire', label: 'Catégorie tarifaire' },
      { db: 'encours_autorise', label: 'Encours autorisé', type: 'number' },
      { db: 'assurance_credit', label: 'Assurance crédit', type: 'number' },
      { db: 'depot_rattachement', label: 'Dépôt rattachement' },
      { db: 'code_affaire', label: 'Code affaire' },
      { db: 'devise', label: 'Devise' },
      { db: 'langue', label: 'Langue' },
      { db: 'raccourci', label: 'Raccourci' },
      { db: 'code_edi', label: 'Code EDI' },
      { db: 'mise_en_sommeil', label: 'Mise en sommeil', type: 'boolean' },
      { db: 'categorie_comptable', label: 'Catégorie comptable' },
      { db: 'exclure_traitements_marketing', label: 'Exclure des traitements marketing', type: 'boolean' },
      { db: 'date_creation', label: 'Date de création', type: 'date' },
      { db: 'donnees_effacees', label: 'Données effacées', type: 'boolean' },
      { db: 'solde_comptable', label: 'Solde comptable', type: 'number' },
      { db: 'portefeuille_bl_fa', label: 'Portefeuille BL et FA', type: 'number' },
      { db: 'portefeuille_bc_pl', label: 'Portefeuille BC et PL', type: 'number' },
      { db: 'code_risque', label: 'Code risque' },
      { db: 'objectif_ca', label: 'Objectif CA', type: 'number' },
      { db: 'famille', label: 'Famille' },
      { db: 'qualite_relationnelle', label: 'Qualité relationnelle' },
      { db: 'remise_hit', label: 'Remise HIT', type: 'number' },
      { db: 'remise_acc', label: 'Remise ACC', type: 'number' },
      { db: 'rge', label: 'RGE' },
      { db: 'convention_cee', label: 'Convention CEE' },
      { db: 'indicateur_technique', label: 'Indicateur Technique' },
      { db: 'indicateur_etude', label: 'Indicateur Etude' },
      { db: 'client_pv', label: 'Client PV', aliases: ['Client PV'] },
      { db: 'attestation_capacite', label: 'Attestation de capacité' },
      { db: 'capacite_expiration', label: 'Capacité expiration', type: 'date' },
      { db: 'groupement', label: 'Groupement' },
      { db: 'convention_nationaux', label: 'Convention nationaux' },
      { db: 'convention_client_cgclim', label: 'Convention Client CGCLIM' },
      { db: 'station_technique', label: 'Station technique' },
      { db: 'openbee', label: 'OPENBEE' },
      { db: 'logiciels', label: 'Logiciels' },
      { db: 'frais_facturation', label: 'Frais facturation' },
      { db: 'assurance_credit_2', label: 'Assurance Crédit' },
      { db: 'routage_promo', label: 'Routage promo' },
      { db: 'facture_email', label: 'Facture @' },
      { db: 'particularite_logistique', label: 'Particularité Logistique' },
      { db: 'releve_facture', label: 'Relevé de facture' },
      { db: 'type_facture', label: 'Type de facture' },
      { db: 'particularite_facturation', label: 'Particularite Facturation' },
      { db: 'categorie_af_gaf', label: 'Categorie AF GAF' },
      { db: 'email_routage', label: '@ routage' },
      { db: 'client_cfluide', label: 'Client CFluide' },
      { db: 'tarifs_exception', label: 'Tarifs d exception' },
      { db: 'agence_rattachement', label: 'Agence de rattachement' },
      { db: 'gyutaki5', label: 'GYUTAKI5' },
      { db: 'g5pm_g10', label: 'G5PM G10' },
    ],
  },
  {
    key: 'facture_lignes',
    label: 'Lignes de factures',
    primaryKey: 'ligne_hash',
    secondaryKeys: ['numero_piece', 'reference_article', 'designation'],
    description: 'Table centrale : une ligne par ligne de facture.',
    columns: [
      { db: 'ligne_hash', label: 'Clé ligne', readonly: true },
      { db: 'ligne_hash_metier', label: 'Clé métier', readonly: true },
      { db: 'type_document', label: 'Type' },
      { db: 'numero_piece', label: 'N° pièce', required: true },
      { db: 'date_facture', label: 'Date facture', type: 'date' },
      { db: 'date_devis', label: 'Date du devis', type: 'date' },
      { db: 'date_bc', label: 'Date du BC', type: 'date' },
      { db: 'date_pl', label: 'Date de la PL', type: 'date' },
      { db: 'date_bl', label: 'Date du BL', type: 'date' },
      { db: 'numero_tiers_entete', label: 'N° tiers entête' },
      { db: 'intitule_tiers_entete', label: 'Intitulé tiers entête' },
      { db: 'numero_tiers_ligne', label: 'N° tiers ligne' },
      { db: 'intitule_tiers_ligne', label: 'Intitulé tiers ligne' },
      { db: 'numero_piece_devis', label: 'N° devis' },
      { db: 'numero_piece_bc', label: 'N° BC' },
      { db: 'numero_piece_pl', label: 'N° PL' },
      { db: 'numero_piece_bl', label: 'N° BL' },
      { db: 'reference_article', label: 'Référence article' },
      { db: 'reference_client', label: 'Référence client' },
      { db: 'designation', label: 'Désignation' },
      { db: 'complement', label: 'Complément' },
      { db: 'quantite', label: 'Quantité', type: 'number', aliases: ['Qté', 'Quantité facturée', 'Qté facturée'] },
      { db: 'qte_preparee', label: 'Qté préparée', type: 'number', aliases: ['Qté prépar', 'Qté préparée', 'Qte preparee'] },
      { db: 'qte_livree', label: 'Qté livrée', type: 'number', aliases: ['Qté livrée', 'Qte livree'] },
      { db: 'poids_net_glc', label: 'Poids net GLC', type: 'number', aliases: ['Poids net g', 'Poids net', 'Poids net GLC'] },
      { db: 'poids_brut_gl', label: 'Poids brut GL', type: 'number', aliases: ['Poids brut g', 'Poids brut', 'Poids brut GL'] },
      { db: 'date_livraison', label: 'Date livraison', type: 'date', aliases: ['Date livraison', 'Date livrai'] },
      { db: 'pu_ht', label: 'PU HT', type: 'number', aliases: ['P.U. HT', 'PU HT'] },
      { db: 'pu_ttc', label: 'PU TTC', type: 'number', aliases: ['P.U. TTC', 'PU TTC'] },
      { db: 'remise', label: 'Remise', type: 'number', numberFormat: 'percent_ratio', aliases: ['Remise %', '% remise'] },
      { db: 'pu_net', label: 'PU net', type: 'number', aliases: ['P.U. net', 'PU net'] },
      { db: 'pu_net_ttc', label: 'PU net TTC', type: 'number', aliases: ['P.U. net TTC', 'PU net TTC'] },
      { db: 'pu_net_devise', label: 'PU net devise', type: 'number', aliases: ['P.U. net devise', 'PU net devise'] },
      { db: 'prix_revient_unitaire', label: 'Prix revient unitaire', type: 'number', aliases: ['Prix de revient', 'Prix revient', 'Prix revient unitaire'] },
      { db: 'cmup', label: 'CMUP', type: 'number' },
      { db: 'montant_ht', label: 'Montant HT', type: 'number', aliases: ['Montant H.T', 'Montant H.T.', 'Montant HT'] },
      { db: 'montant_ht_devise', label: 'Montant HT devise', type: 'number', aliases: ['Montant HT devise', 'Montant H.T devise', 'Montant H'] },
      { db: 'taxe_1', label: 'Taxe 1', type: 'number', numberFormat: 'percent_ratio', aliases: ['Taxe 1'] },
      { db: 'taxe_2', label: 'Taxe 2', type: 'number', numberFormat: 'percent_ratio', aliases: ['Taxe 2'] },
      { db: 'taxe_3', label: 'Taxe 3', type: 'number', numberFormat: 'percent_ratio', aliases: ['Taxe 3'] },
      { db: 'prix_revient_total', label: 'Prix revient total', type: 'number', aliases: ['Prix revient total', 'Prix de revient total'] },
      { db: 'montant_ttc', label: 'Montant TTC', type: 'number', aliases: ['Montant T.T.C', 'Montant T.T.C.', 'Montant TTC', 'Montant T'] },
      { db: 'base_calcul_marge', label: 'Base calcul marge', type: 'number' },
      { db: 'marge_valeur', label: 'Marge valeur', type: 'number', aliases: ['Marge', 'Marge valeur', 'Marge en valeur', 'Marge €'] },
      { db: 'marge_pourcent', label: 'Marge %', type: 'number', numberFormat: 'percent_ratio', aliases: ['Marge %', '% marge', 'Taux marge', 'Taux de marge'] },
      { db: 'collaborateur', label: 'Collaborateur' },
      { db: 'depot', label: 'Dépôt' },
      { db: 'affaire', label: 'Affaire' },
      { db: 'projet', label: 'Projet' },
    ],
  },
  {
    key: 'activite_lignes',
    label: 'Activités',
    primaryKey: 'ligne_hash',
    secondaryKeys: ['numero_piece', 'reference_article', 'designation'],
    description: 'Activité commerciale issue des documents de vente.',
    columns: [
      { db: 'ligne_hash', label: 'Clé ligne', readonly: true },
      { db: 'type_document', label: 'Type' },
      { db: 'numero_piece', label: 'N° pièce', required: true },
      { db: 'date_piece', label: 'Date pièce', type: 'date' },
      { db: 'date_devis', label: 'Date du devis', type: 'date' },
      { db: 'date_bc', label: 'Date du BC', type: 'date' },
      { db: 'date_pl', label: 'Date de la PL', type: 'date' },
      { db: 'date_bl', label: 'Date du BL', type: 'date' },
      { db: 'numero_tiers_entete', label: 'N° tiers entête' },
      { db: 'intitule_tiers_entete', label: 'Intitulé tiers entête' },
      { db: 'numero_tiers_ligne', label: 'N° tiers ligne' },
      { db: 'intitule_tiers_ligne', label: 'Intitulé tiers ligne' },
      { db: 'reference_article', label: 'Référence article' },
      { db: 'designation', label: 'Désignation' },
      { db: 'quantite', label: 'Quantité', type: 'number', aliases: ['Qté', 'Quantité facturée', 'Qté facturée'] },
      { db: 'qte_preparee', label: 'Qté préparée', type: 'number', aliases: ['Qté prépar', 'Qté préparée', 'Qte preparee'] },
      { db: 'qte_livree', label: 'Qté livrée', type: 'number', aliases: ['Qté livrée', 'Qte livree'] },
      { db: 'poids_net_glc', label: 'Poids net GLC', type: 'number', aliases: ['Poids net g', 'Poids net', 'Poids net GLC'] },
      { db: 'poids_brut_gl', label: 'Poids brut GL', type: 'number', aliases: ['Poids brut g', 'Poids brut', 'Poids brut GL'] },
      { db: 'date_livraison', label: 'Date livraison', type: 'date', aliases: ['Date livraison', 'Date livrai'] },
      { db: 'pu_ht', label: 'PU HT', type: 'number', aliases: ['P.U. HT', 'PU HT'] },
      { db: 'pu_ttc', label: 'PU TTC', type: 'number', aliases: ['P.U. TTC', 'PU TTC'] },
      { db: 'remise', label: 'Remise', type: 'number', numberFormat: 'percent_ratio', aliases: ['Remise %', '% remise'] },
      { db: 'pu_net', label: 'PU net', type: 'number', aliases: ['P.U. net', 'PU net'] },
      { db: 'pu_net_ttc', label: 'PU net TTC', type: 'number', aliases: ['P.U. net TTC', 'PU net TTC'] },
      { db: 'pu_net_devise', label: 'PU net devise', type: 'number', aliases: ['P.U. net devise', 'PU net devise'] },
      { db: 'prix_revient_unitaire', label: 'Prix revient unitaire', type: 'number', aliases: ['Prix de revient', 'Prix revient', 'Prix revient unitaire'] },
      { db: 'cmup', label: 'CMUP', type: 'number' },
      { db: 'montant_ht', label: 'Montant HT', type: 'number', aliases: ['Montant H.T', 'Montant H.T.', 'Montant HT'] },
      { db: 'montant_ht_devise', label: 'Montant HT devise', type: 'number', aliases: ['Montant HT devise', 'Montant H.T devise', 'Montant H'] },
      { db: 'taxe_1', label: 'Taxe 1', type: 'number', numberFormat: 'percent_ratio', aliases: ['Taxe 1'] },
      { db: 'taxe_2', label: 'Taxe 2', type: 'number', numberFormat: 'percent_ratio', aliases: ['Taxe 2'] },
      { db: 'taxe_3', label: 'Taxe 3', type: 'number', numberFormat: 'percent_ratio', aliases: ['Taxe 3'] },
      { db: 'prix_revient_total', label: 'Prix revient total', type: 'number', aliases: ['Prix revient total', 'Prix de revient total'] },
      { db: 'montant_ttc', label: 'Montant TTC', type: 'number', aliases: ['Montant T.T.C', 'Montant T.T.C.', 'Montant TTC', 'Montant T'] },
      { db: 'marge_valeur', label: 'Marge valeur', type: 'number', aliases: ['Marge', 'Marge valeur', 'Marge en valeur', 'Marge €'] },
      { db: 'marge_pourcent', label: 'Marge %', type: 'number', numberFormat: 'percent_ratio', aliases: ['Marge %', '% marge', 'Taux marge', 'Taux de marge'] },
      { db: 'collaborateur', label: 'Collaborateur' },
      { db: 'depot', label: 'Dépôt' },
      { db: 'affaire', label: 'Affaire' },
      { db: 'projet', label: 'Projet' },
    ],
  },
]

const EXTRA_HEADER_ALIASES: Record<TableKey, Record<string, string>> = {
  ref_familles: {},
  ref_code_naf: {},
  ref_collaborateurs: {},
  ref_articles: {},
  ref_tiers: {},
  facture_lignes: {
    date: 'date_facture',
    date_piece: 'date_facture',
    date_de_la_piece: 'date_facture',
    n_piece: 'numero_piece',
    numero_piece: 'numero_piece',
    n_piece_du_devis: 'numero_piece_devis',
    n_devis: 'numero_piece_devis',
    n_piece_du_bc: 'numero_piece_bc',
    n_bc: 'numero_piece_bc',
    n_piece_de_la_pl: 'numero_piece_pl',
    n_pl: 'numero_piece_pl',
    n_piece_du_bl: 'numero_piece_bl',
    n_bl: 'numero_piece_bl',
    reference_arti: 'reference_article',
    reference_article: 'reference_article',
    ref_article: 'reference_article',
    ref_client: 'reference_client',
    qte_prepare: 'qte_preparee',
    qte_preparee: 'qte_preparee',
    qte_livree: 'qte_livree',
    poids_net_g: 'poids_net_glc',
    poids_net_glc: 'poids_net_glc',
    poids_brut_g: 'poids_brut_gl',
    poids_brut_gl: 'poids_brut_gl',
    date_livrai: 'date_livraison',
    date_livraison: 'date_livraison',
    p_u_net: 'pu_net',
    pu_net: 'pu_net',
    p_u_net_ttc: 'pu_net_ttc',
    pu_net_ttc: 'pu_net_ttc',
    p_u_net_devise: 'pu_net_devise',
    pu_net_devise: 'pu_net_devise',
    prix_de_rev: 'prix_revient_unitaire',
    prix_de_revient: 'prix_revient_unitaire',
    prix_revient: 'prix_revient_unitaire',
    cmup: 'cmup',
    montant_h: 'montant_ht_devise',
    montant_ht: 'montant_ht',
    montant_h_t: 'montant_ht',
    montant_ht_devise: 'montant_ht_devise',
    taxe_1: 'taxe_1',
    taxe_2: 'taxe_2',
    taxe_3: 'taxe_3',
    prix_revient_total: 'prix_revient_total',
    montant_t: 'montant_ttc',
    montant_ttc: 'montant_ttc',
    marge: 'marge_valeur',
    marge_valeur: 'marge_valeur',
    marge_en_valeur: 'marge_valeur',
    marge_pourcent: 'marge_pourcent',
    marge_pct: 'marge_pourcent',
    marge_percent: 'marge_pourcent',
    taux_de_marge: 'marge_pourcent',
  },
  activite_lignes: {
    date: 'date_piece',
    date_facture: 'date_piece',
    date_piece: 'date_piece',
    date_de_la_piece: 'date_piece',
    n_piece: 'numero_piece',
    numero_piece: 'numero_piece',
    n_piece_du_devis: 'numero_piece_devis',
    n_piece_du_bc: 'numero_piece_bc',
    n_piece_de_la_pl: 'numero_piece_pl',
    n_piece_du_bl: 'numero_piece_bl',
    reference_arti: 'reference_article',
    ref_article: 'reference_article',
    ref_client: 'reference_client',
    qte_prepare: 'qte_preparee',
    qte_preparee: 'qte_preparee',
    qte_livree: 'qte_livree',
    poids_net_g: 'poids_net_glc',
    poids_net_glc: 'poids_net_glc',
    poids_brut_g: 'poids_brut_gl',
    poids_brut_gl: 'poids_brut_gl',
    date_livrai: 'date_livraison',
    date_livraison: 'date_livraison',
    p_u_net: 'pu_net',
    pu_net: 'pu_net',
    p_u_net_ttc: 'pu_net_ttc',
    pu_net_ttc: 'pu_net_ttc',
    p_u_net_devise: 'pu_net_devise',
    pu_net_devise: 'pu_net_devise',
    prix_de_rev: 'prix_revient_unitaire',
    prix_de_revient: 'prix_revient_unitaire',
    prix_revient: 'prix_revient_unitaire',
    cmup: 'cmup',
    montant_h: 'montant_ht_devise',
    montant_ht: 'montant_ht',
    montant_h_t: 'montant_ht',
    montant_ht_devise: 'montant_ht_devise',
    taxe_1: 'taxe_1',
    taxe_2: 'taxe_2',
    taxe_3: 'taxe_3',
    prix_revient_total: 'prix_revient_total',
    montant_t: 'montant_ttc',
    montant_ttc: 'montant_ttc',
    marge_valeur: 'marge_valeur',
    marge_en_valeur: 'marge_valeur',
    marge_pourcent: 'marge_pourcent',
    marge_pct: 'marge_pourcent',
    marge_percent: 'marge_pourcent',
    taux_de_marge: 'marge_pourcent',
  },
}

function normalizeHeader(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[%€]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeText(value: any) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeNumber(value: any) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  let cleaned = String(value).trim()
  if (!cleaned || cleaned.toUpperCase() === 'NULL') return null

  const isNegativeWithParentheses = /^\(.*\)$/.test(cleaned)

  cleaned = cleaned
    .replace(/ /g, ' ')
    .replace(/\s/g, '')
    .replace(/[€%]/g, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[()]/g, '')

  // Format français : 1.234,56 => 1234.56
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    cleaned = cleaned.replace(',', '.')
  }

  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return isNegativeWithParentheses ? -n : n
}

function normalizePercentRatio(value: any) {
  if (value === undefined || value === null || value === '') return null

  const rawText = typeof value === 'number' ? '' : String(value)
  const n = normalizeNumber(value)
  if (n === null) return null

  // Excel peut fournir 57% sous forme 0.57 ou sous forme texte "57%".
  // En base, on conserve un ratio : 57% = 0.57.
  if (rawText.includes('%')) return n / 100
  if (Math.abs(n) > 1) return n / 100
  return n
}

function normalizeBoolean(value: any) {
  if (value === undefined || value === null || value === '') return false
  if (typeof value === 'boolean') return value

  const text = String(value).trim().toLowerCase()
  return ['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'x'].includes(text)
}

function normalizeDate(value: any) {
  if (value === undefined || value === null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    const yyyy = parsed.y
    const mm = String(parsed.m).padStart(2, '0')
    const dd = String(parsed.d).padStart(2, '0')
    return yyyy + '-' + mm + '-' + dd
  }

  const text = String(value).trim()
  if (!text) return null

  const frOrUs = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)
  if (frOrUs) {
    const part1 = Number(frOrUs[1])
    const part2 = Number(frOrUs[2])
    const yyyy = frOrUs[3].length === 2 ? '20' + frOrUs[3] : frOrUs[3]

    let dd = part1
    let mm = part2

    if (part2 > 12 && part1 <= 12) {
      dd = part2
      mm = part1
    }

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return yyyy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0')
    }

    return null
  }

  const isoLike = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (isoLike) {
    const yyyy = isoLike[1]
    const part2 = Number(isoLike[2])
    const part3 = Number(isoLike[3])

    let mm = part2
    let dd = part3

    if (part2 > 12 && part3 <= 12) {
      dd = part2
      mm = part3
    }

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return yyyy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0')
    }

    return null
  }

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)

  return null
}

function normalizeValue(value: any, type: ColumnType = 'text', column?: ColumnConfig) {
  if (type === 'number') {
    return column?.numberFormat === 'percent_ratio' ? normalizePercentRatio(value) : normalizeNumber(value)
  }
  if (type === 'boolean') return normalizeBoolean(value)
  if (type === 'date') return normalizeDate(value)
  return normalizeText(value)
}

function stableHash(input: string) {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function buildLineHash(row: GenericRow, tableKey: TableKey, index: number) {
  const base = [
    tableKey,
    row.numero_piece || '',
    row.date_facture || row.date_piece || '',
    row.numero_tiers_entete || '',
    row.reference_article || '',
    row.designation || '',
    row.quantite ?? '',
    row.montant_ht ?? '',
    row.prix_revient_total ?? '',
    row.numero_piece_bl || '',
    index,
  ].join('|')

  return stableHash(base)
}

function buildFactureBusinessHashBase(row: GenericRow) {
  const upperTrim = (value: any) => String(value ?? '').trim().toUpperCase()
  const dateText = (value: any) => String(value ?? '').trim().slice(0, 10)
  const numericText = (value: any, decimals: number) => {
    const n = Number(value ?? 0)
    if (!Number.isFinite(n)) return Number(0).toFixed(decimals)
    return n.toFixed(decimals)
  }
  return [upperTrim(row.numero_piece), dateText(row.date_facture), upperTrim(row.numero_tiers_entete), upperTrim(row.reference_article), numericText(row.quantite, 4), numericText(row.montant_ht, 2), numericText(row.marge_valeur, 2)].join('|')
}
function md5Hex(input: string) {
  // Hash court stable côté navigateur. Le contrôle de doublon d'import ne dépend pas de ce hash,
  // il compare aussi la clé métier reconstruite à partir des champs de ligne.
  return stableHash(input)
}
async function addFactureBusinessHashes(rows: GenericRow[]) {
  for (const row of rows) {
    if (!row.ligne_hash_metier) row.ligne_hash_metier = md5Hex(buildFactureBusinessHashBase(row))
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function tableDisplayKey(row: GenericRow, config: TableConfig) {
  const value = row[config.primaryKey]
  if (value) return String(value)
  if (config.secondaryKeys?.length) {
    const secondary = config.secondaryKeys.map((k) => row[k]).filter(Boolean).join(' / ')
    if (secondary) return secondary
  }
  return '—'
}

function tableReactKey(row: GenericRow, config: TableConfig, index: number) {
  const primary = row[config.primaryKey]
  if (primary !== undefined && primary !== null && String(primary).trim() !== '') {
    return `${config.key}-${String(primary)}`
  }

  const secondary = config.secondaryKeys
    ?.map((k) => row[k])
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .join('|')

  if (secondary) return `${config.key}-${secondary}-${index}`

  return `${config.key}-row-${index}`
}

export default function ImportsParametragePage() {
  const [selectedTableKey, setSelectedTableKey] = useState<TableKey>('facture_lignes')
  const [stats, setStats] = useState<Record<TableKey, TableStats>>({} as Record<TableKey, TableStats>)
  const [rows, setRows] = useState<GenericRow[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sortColumn, setSortColumn] = useState<string>('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [editingRow, setEditingRow] = useState<GenericRow | null>(null)
  const [lastRejects, setLastRejects] = useState<ImportRejectRow[]>([])
  const [importProgress, setImportProgress] = useState<string | null>(null)
  const [importSteps, setImportSteps] = useState<ImportStep[]>([])
  const [refreshingCaches, setRefreshingCaches] = useState(false)

  const selectedConfig = useMemo(
    () => TABLES.find((t) => t.key === selectedTableKey) || TABLES[0],
    [selectedTableKey]
  )

  const editableColumns = useMemo(
    () => selectedConfig.columns.filter((c) => !c.readonly),
    [selectedConfig]
  )

  const visibleRows = useMemo(() => {
    let output = [...rows]

    if (filter.trim()) {
      const f = filter.trim().toLowerCase()
      output = output.filter((row) =>
        selectedConfig.columns.some((col) =>
          String(row[col.db] ?? '')
            .toLowerCase()
            .includes(f)
        )
      )
    }

    if (sortColumn) {
      output.sort((a, b) => {
        const av = a[sortColumn]
        const bv = b[sortColumn]
        const result = String(av ?? '').localeCompare(String(bv ?? ''), 'fr', {
          numeric: true,
          sensitivity: 'base',
        })
        return sortDirection === 'asc' ? result : -result
      })
    }

    return output
  }, [rows, filter, selectedConfig.columns, sortColumn, sortDirection])

  async function loadStats() {
    const nextStats = {} as Record<TableKey, TableStats>

    for (const config of TABLES) {
      const { count, error: countError } = await supabase
        .from(config.key)
        .select('*', { count: 'exact', head: true })

      if (countError) {
        nextStats[config.key] = {
          count: 0,
          lastImportAt: null,
          lastCreatedKey: null,
          lastCreatedAt: null,
        }
        continue
      }

      const orderColumn = ['facture_lignes', 'activite_lignes'].includes(config.key)
        ? 'imported_at'
        : 'updated_at'

      const { data: lastRows } = await supabase
        .from(config.key)
        .select('*')
        .order(orderColumn, { ascending: false })
        .limit(1)

      const last = lastRows?.[0]

      nextStats[config.key] = {
        count: count || 0,
        lastImportAt: last?.imported_at || last?.updated_at || null,
        lastCreatedKey: last ? tableDisplayKey(last, config) : null,
        lastCreatedAt: last?.imported_at || last?.updated_at || null,
      }
    }

    setStats(nextStats)
  }

  async function loadRows(config = selectedConfig) {
    setLoading(true)
    setError(null)

    const orderColumn = config.columns.some((c) => c.db === 'updated_at') ? 'updated_at' : config.primaryKey

    const { data, error: loadError } = await supabase
      .from(config.key)
      .select('*')
      .order(orderColumn, { ascending: false })
      .limit(300)

    if (loadError) {
      setError(loadError.message)
      setRows([])
    } else {
      setRows(data || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadStats()
  }, [])

  useEffect(() => {
    loadRows(selectedConfig)
    setFilter('')
    setSortColumn('')
    setEditingRow(null)
  }, [selectedConfig.key])

  function buildHeaderMap(headers: string[], config: TableConfig) {
    const columnByNormalizedLabel = new Map<string, ColumnConfig>()
    const columnByDb = new Map<string, ColumnConfig>()

    for (const col of config.columns) {
      columnByNormalizedLabel.set(normalizeHeader(col.label), col)
      columnByNormalizedLabel.set(normalizeHeader(col.db), col)
      for (const alias of col.aliases || []) {
        columnByNormalizedLabel.set(normalizeHeader(alias), col)
      }
      columnByDb.set(col.db, col)
    }

    const aliases = EXTRA_HEADER_ALIASES[config.key] || {}

    return headers.reduce<Record<string, ColumnConfig>>((acc, header) => {
      const normalized = normalizeHeader(header)
      const aliasDb = aliases[normalized]
      const match = aliasDb ? columnByDb.get(aliasDb) : columnByNormalizedLabel.get(normalized)
      if (match) acc[header] = match
      return acc
    }, {})
  }

  function parseExcelRows(file: File, config: TableConfig): Promise<GenericRow[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = (event) => {
        try {
          const data = event.target?.result
          const workbook = XLSX.read(data, { type: 'array', cellDates: true })
          const sheetName = workbook.SheetNames[0]
          const sheet = workbook.Sheets[sheetName]
          const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
            defval: null,
            raw: true,
          })

          if (!jsonRows.length) {
            resolve([])
            return
          }

          const headers = Object.keys(jsonRows[0])
          const headerMap = buildHeaderMap(headers, config)
          const ignoredHeaders = headers.filter((header) => !headerMap[header])
          const nowIso = new Date().toISOString()

          const normalizedRows = jsonRows.map((sourceRow, index) => {
            const targetRow: GenericRow = {}

            const rowErrors: string[] = []

            for (const [sourceHeader, column] of Object.entries(headerMap)) {
              const rawValue = sourceRow[sourceHeader]
              const normalizedValue = normalizeValue(rawValue, column.type, column)

              if (
                column.type === 'date' &&
                rawValue !== null &&
                rawValue !== undefined &&
                String(rawValue).trim() !== '' &&
                !normalizedValue
              ) {
                rowErrors.push(
                  `Ligne ${index + 2}, champ "${column.label}" (${column.db}) : date impossible à convertir, valeur source = "${String(rawValue)}"`
                )
              }

              targetRow[column.db] = normalizedValue
            }

            if (rowErrors.length) {
              targetRow.__errors = rowErrors
            }

            // Les tables référentielles n'ont pas toutes les colonnes techniques.
            // On n'envoie donc à Supabase que les champs qui existent réellement dans chaque table.
            const isLineTable = isLineTableKey(config.key)

            if (isLineTable) {
              if (!targetRow.ligne_hash) {
                targetRow.ligne_hash = buildLineHash(targetRow, config.key, index)
              }
              targetRow.imported_at = nowIso
              targetRow.source_import = file.name
            }

            targetRow.updated_at = nowIso

            return targetRow
          })

          if (ignoredHeaders.length && normalizedRows[0]) {
            normalizedRows[0].__errors = [
              ...(Array.isArray(normalizedRows[0].__errors) ? normalizedRows[0].__errors : []),
              `Colonnes Excel ignorées car non reconnues : ${ignoredHeaders.join(', ')}`,
            ]
          }

          resolve(normalizedRows)
        } catch (e: any) {
          reject(e)
        }
      }

      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })
  }

  function validateRows(importRows: GenericRow[], config: TableConfig) {
    const valid: GenericRow[] = []
    const errors: string[] = []

    importRows.forEach((row, index) => {
      const missingRequired = config.columns
        .filter((col) => col.required)
        .filter((col) => row[col.db] === null || row[col.db] === undefined || row[col.db] === '')

      if (missingRequired.length) {
        errors.push(
          `Ligne ${index + 2} rejetée : champ obligatoire manquant (${missingRequired
            .map((c) => c.label)
            .join(', ')})`
        )
        return
      }

      if (!row[config.primaryKey]) {
        errors.push(`Ligne ${index + 2} rejetée : clé primaire absente (${config.primaryKey})`)
        return
      }

      valid.push(row)
    })

    return { valid, errors }
  }

  function deduplicateRows(importRows: GenericRow[], config: TableConfig) {
    const byKey = new Map<string, GenericRow>()
    const duplicates: string[] = []

    importRows.forEach((row, index) => {
      const key = String(row[config.primaryKey] ?? '').trim()
      if (!key) return

      if (byKey.has(key)) {
        duplicates.push(`Ligne ${index + 2} : clé ${config.primaryKey} en doublon (${key}) — dernière ligne conservée`)
      }

      byKey.set(key, row)
    })

    return {
      rows: Array.from(byKey.values()),
      duplicates,
    }
  }

  async function callRpcWithOptionalFallback(
    primaryRpcName: string,
    fallbackRpcName?: string,
    options?: { silentMissingFunctions?: boolean }
  ) {
    const primaryResult = await supabase.rpc(primaryRpcName)

    if (!primaryResult.error) {
      return `${primaryRpcName} exécutée.`
    }

    if (fallbackRpcName && isMissingFunctionError(primaryResult.error)) {
      const fallbackResult = await supabase.rpc(fallbackRpcName)

      if (!fallbackResult.error) {
        return `${primaryRpcName} absente, ${fallbackRpcName} exécutée.`
      }

      if (options?.silentMissingFunctions && isMissingFunctionError(fallbackResult.error)) {
        return `${primaryRpcName} / ${fallbackRpcName} ignorées : fonctions absentes.`
      }

      throw new Error(`${fallbackRpcName} : ${fallbackResult.error.message}`)
    }

    if (options?.silentMissingFunctions && isMissingFunctionError(primaryResult.error)) {
      return `${primaryRpcName} ignorée : fonction absente.`
    }

    throw new Error(`${primaryRpcName} : ${primaryResult.error.message}`)
  }

  async function refreshLineCaches(tableKey: TableKey, options?: { silentMissingFunctions?: boolean }) {
    const rpcCalls = tableKey === 'facture_lignes'
      ? [
          { primary: 'refresh_facture_entetes_cache' },
          // Nom réel de la table : indicateur_factures_mensuel, donc fonction principale sans "s".
          // Le fallback garde la compatibilité si l'ancien alias existe encore côté Supabase.
          { primary: 'rebuild_indicateur_factures_mensuel', fallback: 'refresh_indicateur_factures_mensuel' },
        ]
      : [
          { primary: 'rebuild_indicateur_activite_mensuel', fallback: 'refresh_indicateur_activite_mensuel' },
        ]

    const messages: string[] = []

    for (const rpcCall of rpcCalls) {
      const message = await callRpcWithOptionalFallback(rpcCall.primary, rpcCall.fallback, options)
      messages.push(message)
    }

    return messages
  }

  async function handleManualCacheRefresh() {
    if (!isLineTableKey(selectedConfig.key)) return

    setRefreshingCaches(true)
    setMessage(null)
    setError(null)
    setLastRejects([])
    setImportProgress(null)

    try {
      const refreshMessages = await refreshLineCaches(selectedConfig.key, { silentMissingFunctions: true })
      setMessage(`Rafraîchissement terminé. ${refreshMessages.join(' ')}`)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setRefreshingCaches(false)
    }
  }

  function initImportSteps(config: TableConfig) {
    const template = isLineTableKey(config.key) ? LINE_IMPORT_STEP_TEMPLATE : STANDARD_IMPORT_STEP_TEMPLATE
    setImportSteps(template.map((step) => ({ ...step })))
  }

  function updateImportStep(id: string, status: ImportStepStatus, detail?: string) {
    setImportSteps((previous) =>
      previous.map((step) =>
        step.id === id
          ? { ...step, status, detail: detail ?? step.detail }
          : step
      )
    )
  }

  async function setImportUserTriggers(config: TableConfig, enabled: boolean) {
    if (!isLineTableKey(config.key)) return `${config.label} : pas de trigger à piloter.`

    const { data, error: rpcError } = await supabase.rpc('set_import_user_triggers', {
      p_table_name: config.key,
      p_enabled: enabled,
    })

    if (rpcError) {
      throw new Error(
        `${enabled ? 'Réactivation' : 'Désactivation'} des triggers impossible : ${rpcError.message}. ` +
          'Crée d’abord la fonction SQL public.set_import_user_triggers fournie avec ce fichier.'
      )
    }

    return String(data || `${enabled ? 'Triggers réactivés' : 'Triggers désactivés'} sur ${config.key}.`)
  }

  async function deleteAllRowsFromTable(tableName: string) {
    const { error: deleteError } = await supabase.from(tableName).delete().not('id', 'is', null)
    if (deleteError) throw new Error(`Vidage de la table ${tableName} impossible : ${deleteError.message}`)
  }
  async function clearActivityImportTables() {
    await deleteAllRowsFromTable('activite_lignes')
    await deleteAllRowsFromTable('indicateur_activite_mensuel')
  }
  async function ensureReferenceRowsForLineImport(rows: GenericRow[], config: TableConfig) {
    if (!isLineTableKey(config.key) || !rows.length) return { articlesCreated: 0, tiersCreated: 0 }

    const nowIso = new Date().toISOString()
    const queryChunkSize = 500

    const articleByRef = new Map<string, GenericRow>()
    rows.forEach((row) => {
      const reference = String(row.reference_article ?? '').trim()
      if (!reference || articleByRef.has(reference)) return
      articleByRef.set(reference, {
        reference_article: reference,
        designation: row.designation ? String(row.designation).trim() : null,
        updated_at: nowIso,
      })
    })

    let articlesCreated = 0
    const articleRefs = Array.from(articleByRef.keys())

    for (let i = 0; i < articleRefs.length; i += queryChunkSize) {
      const chunk = articleRefs.slice(i, i + queryChunkSize)
      const { data, error } = await supabase
        .from('ref_articles')
        .select('reference_article')
        .in('reference_article', chunk)

      if (error) {
        throw new Error('Contrôle référentiel articles impossible : ' + error.message)
      }

      const existing = new Set((data || []).map((row: GenericRow) => String(row.reference_article ?? '').trim()))
      const missingRows = chunk
        .filter((reference) => !existing.has(reference))
        .map((reference) => articleByRef.get(reference))
        .filter(Boolean) as GenericRow[]

      if (missingRows.length) {
        const { error: upsertError } = await supabase
          .from('ref_articles')
          .upsert(missingRows, { onConflict: 'reference_article' })

        if (upsertError) {
          throw new Error('Création automatique des articles manquants impossible : ' + upsertError.message)
        }

        articlesCreated += missingRows.length
      }
    }

    const tiersByNumero = new Map<string, GenericRow>()
    rows.forEach((row) => {
      const numero = String(row.numero_tiers_entete ?? '').trim()
      if (!numero || tiersByNumero.has(numero)) return
      tiersByNumero.set(numero, {
        numero,
        intitule: row.intitule_tiers_entete ? String(row.intitule_tiers_entete).trim() : null,
        updated_at: nowIso,
      })
    })

    let tiersCreated = 0
    const tiersNumeros = Array.from(tiersByNumero.keys())

    for (let i = 0; i < tiersNumeros.length; i += queryChunkSize) {
      const chunk = tiersNumeros.slice(i, i + queryChunkSize)
      const { data, error } = await supabase
        .from('ref_tiers')
        .select('numero')
        .in('numero', chunk)

      if (error) {
        throw new Error('Contrôle référentiel tiers impossible : ' + error.message)
      }

      const existing = new Set((data || []).map((row: GenericRow) => String(row.numero ?? '').trim()))
      const missingRows = chunk
        .filter((numero) => !existing.has(numero))
        .map((numero) => tiersByNumero.get(numero))
        .filter(Boolean) as GenericRow[]

      if (missingRows.length) {
        const { error: upsertError } = await supabase
          .from('ref_tiers')
          .upsert(missingRows, { onConflict: 'numero' })

        if (upsertError) {
          throw new Error('Création automatique des tiers manquants impossible : ' + upsertError.message)
        }

        tiersCreated += missingRows.length
      }
    }

    return { articlesCreated, tiersCreated }
  }
  async function rejectFactureRowsAlreadyImported(rows: GenericRow[]) {
    if (!rows.length) return { rowsToKeep: rows, rejectedRows: [] as ImportRejectRow[] }

    const pieces = Array.from(new Set(rows.map((row) => String(row.numero_piece ?? '').trim()).filter(Boolean)))
    if (!pieces.length) return { rowsToKeep: rows, rejectedRows: [] as ImportRejectRow[] }

    const existingBusinessKeys = new Set<string>()
    const existingHashes = new Set<string>()
    const queryChunkSize = 500

    for (let i = 0; i < pieces.length; i += queryChunkSize) {
      const chunk = pieces.slice(i, i + queryChunkSize)
      const { data, error: existingError } = await supabase
        .from('facture_lignes')
        .select('ligne_hash_metier,numero_piece,date_facture,numero_tiers_entete,reference_article,quantite,montant_ht,marge_valeur')
        .in('numero_piece', chunk)

      if (existingError) {
        throw new Error('Contrôle doublon métier impossible sur facture_lignes : ' + existingError.message)
      }

      ;(data || []).forEach((existing: GenericRow) => {
        existingBusinessKeys.add(buildFactureBusinessHashBase(existing))
        const hash = String(existing.ligne_hash_metier ?? '').trim()
        if (hash) existingHashes.add(hash)
      })
    }

    const rowsToKeep: GenericRow[] = []
    const rejectedRows: ImportRejectRow[] = []

    rows.forEach((row, index) => {
      const businessKey = buildFactureBusinessHashBase(row)
      const hash = String(row.ligne_hash_metier ?? '').trim()
      const alreadyImported = existingBusinessKeys.has(businessKey) || (hash ? existingHashes.has(hash) : false)

      if (alreadyImported) {
        rejectedRows.push({
          type: 'Doublon import',
          message: 'Ligne ' + (index + 2) + ' rejetée : ligne métier déjà présente en base avant import (numero_piece=' + (row.numero_piece || '—') + ', date_facture=' + (row.date_facture || '—') + ', tiers=' + (row.numero_tiers_entete || '—') + ', article=' + (row.reference_article || '—') + ').',
        })
        return
      }

      rowsToKeep.push(row)
    })

    return { rowsToKeep, rejectedRows }
  }

  async function filterRowsThatReallyNeedUpsert(rows: GenericRow[], config: TableConfig) {
    // Pour les grosses tables lignes, un upsert met à jour même les lignes strictement identiques.
    // Avec des triggers, cela peut provoquer un recalcul inutile et déclencher un statement timeout.
    // On lit donc les lignes déjà présentes dans le lot et on n'envoie à Supabase que les lignes nouvelles ou réellement modifiées.
    if (!isLineTableKey(config.key) || !rows.length) {
      return { rowsToUpsert: rows, skippedUnchanged: 0 }
    }

    const keys = rows
      .map((row) => String(row[config.primaryKey] ?? '').trim())
      .filter(Boolean)

    if (!keys.length) return { rowsToUpsert: rows, skippedUnchanged: 0 }

    const selectColumns = Array.from(
      new Set([config.primaryKey, ...config.columns.map((column) => column.db)])
    ).join(',')

    const { data, error } = await supabase
      .from(config.key)
      .select(selectColumns)
      .in(config.primaryKey, keys)

    // Si la lecture échoue, on ne bloque pas l'import : on revient au comportement classique.
    if (error) return { rowsToUpsert: rows, skippedUnchanged: 0 }

    const existingByKey = new Map<string, GenericRow>()
    ;(data || []).forEach((existing: GenericRow) => {
      existingByKey.set(String(existing[config.primaryKey] ?? '').trim(), existing)
    })

    const rowsToUpsert = rows.filter((row) => {
      const key = String(row[config.primaryKey] ?? '').trim()
      return hasBusinessDifference(row, existingByKey.get(key), config)
    })

    return {
      rowsToUpsert,
      skippedUnchanged: rows.length - rowsToUpsert.length,
    }
  }

  async function upsertChunkWithTimeoutFallback(
    rows: GenericRow[],
    config: TableConfig,
    absoluteFrom: number,
    totalRows: number
  ): Promise<number> {
    if (!rows.length) return 0

    const absoluteTo = absoluteFrom + rows.length - 1
    setImportProgress(
      `Import ${config.label} : écriture lignes ${absoluteFrom} à ${absoluteTo} / ${totalRows}`
    )

    const { error: upsertError } = await supabase
      .from(config.key)
      .upsert(rows, { onConflict: config.primaryKey })

    if (!upsertError) return rows.length

    // En cas de timeout, on découpe automatiquement le lot pour éviter qu'un lot complet bloque.
    // Si même une seule ligne bloque, le problème est quasiment certain côté base : trigger, FK, index ou verrou.
    if (isStatementTimeoutError(upsertError) && rows.length > 1) {
      const mid = Math.ceil(rows.length / 2)
      const left = rows.slice(0, mid)
      const right = rows.slice(mid)

      const leftCount = await upsertChunkWithTimeoutFallback(left, config, absoluteFrom, totalRows)
      const rightCount = await upsertChunkWithTimeoutFallback(right, config, absoluteFrom + left.length, totalRows)
      return leftCount + rightCount
    }

    throw new Error(
      `Erreur import ${config.label}, lot ${absoluteFrom}-${absoluteTo} / ${totalRows} : ${upsertError.message}`
    )
  }

  async function handleFileImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const config = selectedConfig
    const shouldPilotTriggers = isLineTableKey(config.key)
    let triggersDisabled = false
    let importSucceeded = false
    let finalMessage = ''

    setImporting(true)
    setMessage(null)
    setError(null)
    setLastRejects([])
    setImportProgress(null)
    initImportSteps(config)

    try {
      if (shouldPilotTriggers) {
        updateImportStep('disable_triggers', 'running', 'Désactivation en cours…')
        setImportProgress('Étape 1/6 : désactivation temporaire des triggers…')
        const triggerMessage = await setImportUserTriggers(config, false)
        triggersDisabled = true
        updateImportStep('disable_triggers', 'done', triggerMessage)
      }

      updateImportStep('read_file', 'running', 'Lecture du fichier Excel…')
      setImportProgress(`${shouldPilotTriggers ? 'Étape 2/6' : 'Étape 1/3'} : lecture et contrôle du fichier Excel…`)

      const parsedRows = await parseExcelRows(file, config)
      if (config.key === 'facture_lignes') await addFactureBusinessHashes(parsedRows)
      const parseErrors = parsedRows.flatMap((row) => Array.isArray(row.__errors) ? row.__errors : [])
      const cleanedRows = parsedRows.map(({ __errors, ...row }) => row)
      const { valid, errors } = validateRows(cleanedRows, config)
      const { rows: deduplicatedRows, duplicates } = deduplicateRows(valid, config)

      updateImportStep(
        'read_file',
        'done',
        `${parsedRows.length} ligne(s) lue(s), ${errors.length} rejet(s), ${duplicates.length} doublon(s) fichier.`
      )

      if (!deduplicatedRows.length) {
        updateImportStep('check_existing', 'error', 'Aucune ligne valide à importer.')
        setLastRejects([...parseErrors, ...errors].map((message) => ({ type: 'Erreur', message })))
        throw new Error(errors.slice(0, 10).join('\n') || 'Aucune ligne valide à importer.')
      }

      updateImportStep('check_existing', 'running', config.key === 'activite_lignes' ? 'Vidage de activite_lignes et indicateur_activite_mensuel…' : 'Contrôle des clés déjà présentes en base…')
      setImportProgress(config.key === 'activite_lignes' ? 'Étape 3/6 : vidage de activite_lignes et indicateur_activite_mensuel…' : (shouldPilotTriggers ? 'Étape 3/6' : 'Étape 2/3') + ' : vérification des lignes déjà présentes…')

      let candidateRows = deduplicatedRows
      let businessRejectedRows: ImportRejectRow[] = []

      if (config.key === 'activite_lignes') {
        await clearActivityImportTables()
        const refs = await ensureReferenceRowsForLineImport(candidateRows, config)
        updateImportStep('check_existing', 'done', 'activite_lignes et indicateur_activite_mensuel vidées. Aucun contrôle doublon appliqué sur l’activité. Référentiels complétés : ' + refs.articlesCreated + ' article(s), ' + refs.tiersCreated + ' tiers.')
      } else if (config.key === 'facture_lignes') {
        const businessCheck = await rejectFactureRowsAlreadyImported(deduplicatedRows)
        candidateRows = businessCheck.rowsToKeep
        businessRejectedRows = businessCheck.rejectedRows
        const refs = await ensureReferenceRowsForLineImport(candidateRows, config)
        updateImportStep('check_existing', 'done', deduplicatedRows.length + ' ligne(s) contrôlée(s). ' + businessRejectedRows.length + ' ligne(s) rejetée(s) car déjà présentes dans un import précédent. Référentiels complétés : ' + refs.articlesCreated + ' article(s), ' + refs.tiersCreated + ' tiers.')
      } else {
        updateImportStep('check_existing', 'done', 'Contrôle standard terminé.')
      }

      const chunkSize = getUpsertChunkSize(config.key)
      const chunksToWrite: Array<{ rows: GenericRow[], from: number }> = []
      let skippedUnchangedTotal = 0
      let checkedRows = 0

      for (let i = 0; i < candidateRows.length; i += chunkSize) {
        const chunk = candidateRows.slice(i, i + chunkSize)
        const from = i + 1
        const to = Math.min(i + chunk.length, candidateRows.length)
        setImportProgress((shouldPilotTriggers ? 'Étape 3/6' : 'Étape 2/3') + ' : analyse lignes ' + from + ' à ' + to + ' / ' + candidateRows.length)
        const { rowsToUpsert, skippedUnchanged } = config.key === 'activite_lignes' ? { rowsToUpsert: chunk, skippedUnchanged: 0 } : await filterRowsThatReallyNeedUpsert(chunk, config)
        skippedUnchangedTotal += skippedUnchanged
        checkedRows += chunk.length
        if (rowsToUpsert.length) chunksToWrite.push({ rows: rowsToUpsert, from })
      }

      if (config.key !== 'facture_lignes' && config.key !== 'activite_lignes') {
        updateImportStep('check_existing', 'done', checkedRows + ' ligne(s) contrôlée(s). ' + skippedUnchangedTotal + ' ligne(s) déjà identique(s) ignorée(s).')
      }

      updateImportStep('upsert', 'running', 'Écriture dans la table principale…')
      setImportProgress(`${shouldPilotTriggers ? 'Étape 4/6' : 'Étape 3/3'} : import dans ${config.label}…`)

      let imported = 0
      for (const chunk of chunksToWrite) {
        imported += await upsertChunkWithTimeoutFallback(chunk.rows, config, chunk.from, deduplicatedRows.length)
      }

      updateImportStep('upsert', 'done', `${imported} ligne(s) nouvelle(s) ou modifiée(s) écrite(s).`)

      if (shouldPilotTriggers) {
        updateImportStep('refresh_caches', 'running', 'Rafraîchissement des agrégats/cache…')
        setImportProgress('Étape 5/6 : mise à jour des agrégats/cache avec triggers désactivés…')
        const refreshMessages = await refreshLineCaches(config.key, { silentMissingFunctions: true })
        updateImportStep('refresh_caches', 'done', refreshMessages.join(' '))

        updateImportStep('enable_triggers', 'running', 'Réactivation en cours…')
        setImportProgress('Étape 6/6 : réactivation des triggers…')
        const triggerMessage = await setImportUserTriggers(config, true)
        triggersDisabled = false
        updateImportStep('enable_triggers', 'done', triggerMessage)
      }

      const technicalMessages = [...parseErrors, ...errors, ...duplicates]
      const importRejectRows = [
        ...technicalMessages.map((message) => ({ type: 'Information import', message })),
        ...businessRejectedRows,
      ]
      setLastRejects(importRejectRows)

      finalMessage =
        imported + ' ligne(s) nouvelle(s) ou modifiée(s) écrite(s) dans ' + config.label + '. ' +
        skippedUnchangedTotal + ' ligne(s) déjà identique(s) ignorée(s). ' +
        (errors.length + businessRejectedRows.length) + ' rejet(s), dont ' + businessRejectedRows.length +
        ' doublon(s) d\'import métier. ' + duplicates.length + ' doublon(s) dans le fichier.' +
        (shouldPilotTriggers ? ' Agrégats/cache mis à jour et triggers réactivés.' : '')

      setMessage(finalMessage)
      if (importRejectRows.length) setError(importRejectRows.slice(0, 20).map((reject) => reject.message).join('\n'))
      importSucceeded = true

      await loadStats()
      await loadRows(config)
    } catch (e: any) {
      const rawMessage = e?.message || String(e)
      setError(rawMessage)
      setImportSteps((previous) => {
        const running = previous.find((step) => step.status === 'running')
        if (!running) return previous
        return previous.map((step) => step.id === running.id ? { ...step, status: 'error', detail: rawMessage } : step)
      })
    } finally {
      if (shouldPilotTriggers && triggersDisabled) {
        try {
          updateImportStep('enable_triggers', 'running', 'Réactivation de sécurité après erreur…')
          setImportProgress('Réactivation de sécurité des triggers après erreur…')
          const triggerMessage = await setImportUserTriggers(config, true)
          updateImportStep('enable_triggers', 'done', triggerMessage)
        } catch (enableError: any) {
          updateImportStep('enable_triggers', 'error', enableError?.message || String(enableError))
          setError((previous) =>
            `${previous ? previous + '\n\n' : ''}Attention : les triggers n'ont pas pu être réactivés automatiquement. ${enableError?.message || String(enableError)}`
          )
        }
      }

      setImportProgress(null)
      setImporting(false)

      if (importSucceeded && finalMessage) {
        setMessage(finalMessage)
      }
    }
  }

  function exportRejectsExcel() {
    if (!lastRejects.length) return

    const ws = XLSX.utils.json_to_sheet(lastRejects)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rejets import')
    XLSX.writeFile(wb, `rejets_import_${selectedConfig.key}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function startNewRow() {
    const row: GenericRow = {}
    for (const col of selectedConfig.columns) {
      if (col.readonly) continue
      row[col.db] = col.type === 'boolean' ? false : ''
    }
    setEditingRow(row)
  }

  function startEdit(row: GenericRow) {
    setEditingRow({ ...row })
  }

  function updateEditingValue(column: ColumnConfig, value: any) {
    setEditingRow((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [column.db]: column.type === 'boolean' ? Boolean(value) : value,
      }
    })
  }

  async function saveEditingRow() {
    if (!editingRow) return

    setSavingId(String(editingRow[selectedConfig.primaryKey] || 'new'))
    setMessage(null)
    setError(null)
    setLastRejects([])
    setImportProgress(null)

    try {
      const rowToSave: GenericRow = { ...editingRow }

      for (const col of selectedConfig.columns) {
        if (col.readonly && !rowToSave[col.db]) continue
        if (col.type) rowToSave[col.db] = normalizeValue(rowToSave[col.db], col.type, col)
      }

      if (isLineTableKey(selectedConfig.key) && !rowToSave.ligne_hash) {
        rowToSave.ligne_hash = buildLineHash(rowToSave, selectedConfig.key, Date.now())
      }

      rowToSave.updated_at = new Date().toISOString()

      const missingRequired = selectedConfig.columns
        .filter((col) => col.required)
        .filter((col) => !rowToSave[col.db])

      if (missingRequired.length) {
        throw new Error(`Champ obligatoire manquant : ${missingRequired.map((c) => c.label).join(', ')}`)
      }

      const { error: saveError } = await supabase
        .from(selectedConfig.key)
        .upsert(rowToSave, { onConflict: selectedConfig.primaryKey })

      if (saveError) throw saveError

      const cacheMessage = isLineTableKey(selectedConfig.key)
        ? ' Rafraîchissement des agrégats/cache non lancé automatiquement.'
        : ''

      setMessage(`Enregistrement sauvegardé.${cacheMessage}`)
      setEditingRow(null)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSavingId(null)
    }
  }

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const currentStats = stats[selectedConfig.key]

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1800px] space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Imports & paramétrage</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Import Excel intelligent, mise à jour des référentiels, consultation et modification directe des lignes.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
                {importing ? 'Import en cours…' : 'Importer Excel'}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleFileImport}
                  disabled={importing}
                />
              </label>
              <button
                type="button"
                onClick={startNewRow}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100"
              >
                + Créer une ligne
              </button>
              <button
                type="button"
                onClick={() => {
                  loadStats()
                  loadRows(selectedConfig)
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100"
              >
                Actualiser
              </button>
              {isLineTableKey(selectedConfig.key) && (
                <button
                  type="button"
                  onClick={handleManualCacheRefresh}
                  disabled={refreshingCaches || importing}
                  className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                >
                  {refreshingCaches ? 'Rafraîchissement…' : 'Rafraîchir agrégats/cache'}
                </button>
              )}
              {lastRejects.length > 0 && (
                <button
                  type="button"
                  onClick={exportRejectsExcel}
                  className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                >
                  Export rejets
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Table sélectionnée</div>
            <div className="mt-2 text-xl font-bold">{selectedConfig.label}</div>
            <div className="mt-1 text-sm text-slate-500">Clé : {selectedConfig.primaryKey}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nb enregistrements</div>
            <div className="mt-2 text-xl font-bold">{currentStats?.count ?? '—'}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dernier import / MAJ</div>
            <div className="mt-2 text-xl font-bold">{formatDateTime(currentStats?.lastImportAt || null)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dernier enregistrement créé</div>
            <div className="mt-2 truncate text-xl font-bold">{currentStats?.lastCreatedKey || '—'}</div>
            <div className="mt-1 text-sm text-slate-500">{formatDateTime(currentStats?.lastCreatedAt || null)}</div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Tables</h2>
            <div className="space-y-2">
              {TABLES.map((table) => {
                const selected = table.key === selectedTableKey
                const tableStats = stats[table.key]
                return (
                  <button
                    key={table.key}
                    type="button"
                    onClick={() => setSelectedTableKey(table.key)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{table.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/20' : 'bg-slate-100'}`}>
                        {tableStats?.count ?? 0}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs ${selected ? 'text-white/70' : 'text-slate-500'}`}>
                      {table.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold">{selectedConfig.label}</h2>
                <p className="text-sm text-slate-500">{selectedConfig.description}</p>
                {isLineTableKey(selectedConfig.key) && (
                  <p className="mt-1 text-xs text-blue-700">
                    Import automatique sécurisé : désactivation temporaire des triggers, contrôle des lignes existantes, import, réactivation des triggers, puis mise à jour des agrégats/cache.
                  </p>
                )}
              </div>

              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer dans les lignes affichées…"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 lg:w-96"
              />
            </div>

            {message && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
            {importProgress && <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800">{importProgress}</div>}
            {importSteps.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="mb-2 font-bold text-slate-800">Suivi de l’import</div>
                <div className="space-y-2">
                  {importSteps.map((step) => (
                    <div key={step.id} className="flex flex-col gap-1 rounded-lg bg-white px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="font-semibold text-slate-800">{step.label}</div>
                      <div className={`text-xs font-semibold ${
                        step.status === 'done'
                          ? 'text-emerald-700'
                          : step.status === 'running'
                            ? 'text-blue-700'
                            : step.status === 'error'
                              ? 'text-red-700'
                              : 'text-slate-400'
                      }`}>
                        {step.status === 'done' && 'Terminé'}
                        {step.status === 'running' && 'En cours'}
                        {step.status === 'error' && 'Erreur'}
                        {step.status === 'waiting' && 'En attente'}
                      </div>
                      {step.detail && <div className="text-xs text-slate-500 sm:w-full">{step.detail}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</pre>}

            <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Actions</th>
                    {selectedConfig.columns.slice(0, 16).map((col) => (
                      <th
                        key={col.db}
                        className="cursor-pointer whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold hover:bg-slate-200"
                        onClick={() => handleSort(col.db)}
                      >
                        {col.label}
                        {sortColumn === col.db ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={selectedConfig.columns.length + 1}>
                        Chargement…
                      </td>
                    </tr>
                  ) : visibleRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={selectedConfig.columns.length + 1}>
                        Aucun enregistrement affiché.
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row, rowIndex) => (
                      <tr key={tableReactKey(row, selectedConfig, rowIndex)} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-100"
                          >
                            Modifier
                          </button>
                        </td>
                        {selectedConfig.columns.slice(0, 16).map((col) => (
                          <td key={col.db} className="max-w-[280px] truncate border-b border-slate-100 px-3 py-2">
                            {col.type === 'boolean' ? (row[col.db] ? 'Oui' : 'Non') : String(row[col.db] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-500">
              Affichage limité aux 300 dernières lignes pour garder une page rapide. L’import traite le fichier complet.
            </div>
          </section>
        </section>
      </div>

      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-bold">Modifier / créer — {selectedConfig.label}</h3>
                <p className="text-sm text-slate-500">Clé : {selectedConfig.primaryKey}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100"
              >
                Fermer
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {editableColumns.map((col) => (
                  <label key={col.db} className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {col.label} {col.required ? '*' : ''}
                    </span>
                    {col.type === 'boolean' ? (
                      <select
                        value={editingRow[col.db] ? 'true' : 'false'}
                        onChange={(e) => updateEditingValue(col, e.target.value === 'true')}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                      >
                        <option value="false">Non</option>
                        <option value="true">Oui</option>
                      </select>
                    ) : (
                      <input
                        type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                        value={editingRow[col.db] ?? ''}
                        onChange={(e) => updateEditingValue(col, e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100"
              >
                Annuler 
              </button>
              <button
                type="button"
                onClick={saveEditingRow}
                disabled={!!savingId}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {savingId ? 'Sauvegarde…' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
