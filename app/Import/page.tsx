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

type ImportStepStatus = 'pending' | 'running' | 'done' | 'error'

type ImportStep = {
  key: string
  label: string
  status: ImportStepStatus
  detail?: string
}

const PREVIEW_LIMIT = 100
const DUPLICATE_LOOKUP_CHUNK_SIZE = 50
const LINE_INSERT_CHUNK_SIZE = 10
const REF_INSERT_CHUNK_SIZE = 250

const IMPORT_STEP_TEMPLATES: ImportStep[] = [
  { key: 'read', label: 'Lecture du fichier Excel', status: 'pending' },
  { key: 'normalize', label: 'Normalisation et mapping des colonnes', status: 'pending' },
  { key: 'validate', label: 'Validation des champs obligatoires', status: 'pending' },
  { key: 'reset', label: 'Nettoyage préalable des tables activité', status: 'pending' },
  { key: 'tiers', label: 'Mise à jour automatique du référentiel tiers', status: 'pending' },
  { key: 'duplicates', label: 'Contrôle des doublons déjà présents en base', status: 'pending' },
  { key: 'insert', label: 'Insertion des lignes nouvelles', status: 'pending' },
  { key: 'refresh', label: 'Mise à jour cache / agrégats', status: 'pending' },
  { key: 'reload', label: 'Actualisation de l’écran', status: 'pending' },
]

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
      { db: 'reference', label: 'Référence' },
      { db: 'gamme_1', label: 'Gamme 1' },
      { db: 'gamme_2', label: 'Gamme 2' },
      { db: 'numero_serie_lot', label: 'N° série / lot' },
      { db: 'complement_serie_lot', label: 'Complément série / lot' },
      { db: 'quantite', label: 'Quantité', type: 'number', aliases: ['Qté', 'Quantité facturée', 'Qté facturée'] },
      { db: 'qte_ressource', label: 'Qté ressource', type: 'number' },
      { db: 'qte_colisee', label: 'Qté colisée', type: 'number' },
      { db: 'conditionnement', label: 'Conditionnement' },
      { db: 'qte_devis', label: 'Qté devis', type: 'number' },
      { db: 'qte_commandee', label: 'Qté commandée', type: 'number' },
      { db: 'qte_preparee', label: 'Qté préparée', type: 'number', aliases: ['Qté prépar', 'Qté préparée', 'Qte preparee'] },
      { db: 'qte_livree', label: 'Qté livrée', type: 'number', aliases: ['Qté livrée', 'Qte livree'] },
      { db: 'poids_net_global', label: 'Poids net global', type: 'number', aliases: ['Poids net g', 'Poids net', 'Poids net GLC', 'Poids net global'] },
      { db: 'poids_brut_global', label: 'Poids brut global', type: 'number', aliases: ['Poids brut g', 'Poids brut', 'Poids brut GL', 'Poids brut global'] },
      { db: 'date_livraison', label: 'Date livraison', type: 'date', aliases: ['Date livraison', 'Date livrai'] },
      { db: 'pu_ht', label: 'PU HT', type: 'number', aliases: ['P.U. HT', 'PU HT'] },
      { db: 'pu_ttc', label: 'PU TTC', type: 'number', aliases: ['P.U. TTC', 'PU TTC'] },
      { db: 'pu_devise', label: 'PU devise', type: 'number' },
      { db: 'pu_bon_commande', label: 'PU bon commande', type: 'number' },
      { db: 'ressource', label: 'Ressource' },
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
      { db: 'date_peremption', label: 'Date péremption', type: 'date' },
      { db: 'date_fabrication', label: 'Date fabrication', type: 'date' },
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
      { db: 'poids_net_global', label: 'Poids net global', type: 'number', aliases: ['Poids net g', 'Poids net', 'Poids net GLC', 'Poids net global'] },
      { db: 'poids_brut_global', label: 'Poids brut global', type: 'number', aliases: ['Poids brut g', 'Poids brut', 'Poids brut GL', 'Poids brut global'] },
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


const LINE_TABLE_KEYS: TableKey[] = ['facture_lignes', 'activite_lignes']

function isLineTableKey(key: TableKey) {
  return LINE_TABLE_KEYS.includes(key)
}

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
    poids_net_g: 'poids_net_global',
    poids_net_glc: 'poids_net_global',
    poids_brut_g: 'poids_brut_global',
    poids_brut_gl: 'poids_brut_global',
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
    poids_net_g: 'poids_net_global',
    poids_net_glc: 'poids_net_global',
    poids_brut_g: 'poids_brut_global',
    poids_brut_gl: 'poids_brut_global',
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

  const pad2 = (n: number) => String(n).padStart(2, '0')

  // IMPORTANT : ne jamais utiliser toISOString() pour une date métier Excel.
  // Excel fournit des dates sans notion de fuseau horaire. toISOString() convertit en UTC
  // et peut donc retirer 1 jour en France selon l'heure/fuseau du navigateur.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
  }

  // Cas Excel serial number, ex : 46142.
  // XLSX.SSF.parse_date_code renvoie directement y/m/d sans conversion timezone.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`
  }

  const text = String(value).trim()
  if (!text) return null

  // Format ISO ou pseudo ISO : YYYY-MM-DD, éventuellement suivi d'une heure.
  // On extrait uniquement la partie date, sans passer par new Date().
  const isoLike = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/)
  if (isoLike) {
    const yyyy = isoLike[1]
    const mm = Number(isoLike[2])
    const dd = Number(isoLike[3])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${pad2(mm)}-${pad2(dd)}`
    }
    return null
  }

  // Format français ou ambigu : DD/MM/YYYY ou DD-MM-YYYY.
  const frOrUs = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)
  if (frOrUs) {
    const part1 = Number(frOrUs[1])
    const part2 = Number(frOrUs[2])
    const yyyy = frOrUs[3].length === 2 ? `20${frOrUs[3]}` : frOrUs[3]

    let dd = part1
    let mm = part2

    // Si le 2e morceau > 12, c'est nécessairement MM/DD/YYYY.
    if (part2 > 12 && part1 <= 12) {
      dd = part2
      mm = part1
    }

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${pad2(mm)}-${pad2(dd)}`
    }

    return null
  }

  // Dernier recours : parsing JS, mais lecture en local, jamais toISOString().
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
  }

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

function hashText(value: any) {
  if (value === null || value === undefined) return ''

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    return Number(value.toFixed(6)).toString()
  }

  const text = String(value).trim()
  if (!text) return ''

  const normalizedNumber = Number(text.replace(',', '.'))
  if (Number.isFinite(normalizedNumber) && /^-?\d+(?:[\s.,]\d+)?$/.test(text.replace(/\s/g, ''))) {
    return Number(normalizedNumber.toFixed(6)).toString()
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)

  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function buildLineBusinessSignature(row: GenericRow, tableKey: TableKey) {
  const documentDate = tableKey === 'facture_lignes' ? row.date_facture : row.date_piece

  // Clé métier volontairement stable : aucune donnée variable d'import ne doit entrer ici.
  // Ne pas inclure : id, source_import, imported_at, updated_at, nom de fichier, index brut de ligne Excel.
  const parts = [
    tableKey,
    row.type_document,
    row.numero_piece,
    documentDate,
    row.numero_tiers_entete,
    row.intitule_tiers_entete,
    row.numero_tiers_ligne,
    row.intitule_tiers_ligne,
    row.numero_piece_devis,
    row.numero_piece_bc,
    row.numero_piece_pl,
    row.numero_piece_bl,
    row.date_devis,
    row.date_bc,
    row.date_pl,
    row.date_bl,
    row.reference_article,
    row.reference_client,
    row.designation,
    row.complement,
    row.reference,
    row.gamme_1,
    row.gamme_2,
    row.numero_serie_lot,
    row.complement_serie_lot,
    row.pu_ht,
    row.pu_ttc,
    row.pu_devise,
    row.pu_bon_commande,
    row.ressource,
    row.qte_ressource,
    row.quantite,
    row.qte_colisee,
    row.conditionnement,
    row.qte_devis,
    row.qte_commandee,
    row.qte_preparee,
    row.qte_livree,
    row.poids_net_global,
    row.poids_brut_global,
    row.date_livraison,
    row.remise,
    row.pu_net,
    row.pu_net_ttc,
    row.pu_net_devise,
    row.prix_revient_unitaire,
    row.cmup,
    row.montant_ht,
    row.montant_ht_devise,
    row.taxe_1,
    row.taxe_2,
    row.taxe_3,
    row.prix_revient_total,
    row.montant_ttc,
    row.collaborateur,
    row.depot,
    row.affaire,
    row.date_peremption,
    row.date_fabrication,
    row.base_calcul_marge,
    row.marge_valeur,
    row.marge_pourcent,
    row.projet,
  ]

  return parts.map(hashText).join('|')
}

function buildLineHashFromBusinessSignature(signature: string, occurrence: number) {
  return stableHash(`${signature}|occurrence:${occurrence}`)
}

function assignStableLineHashes(rows: GenericRow[], config: TableConfig) {
  if (!isLineTableKey(config.key)) return rows

  const occurrenceBySignature = new Map<string, number>()

  return rows.map((row) => {
    const signature = buildLineBusinessSignature(row, config.key)
    const occurrence = (occurrenceBySignature.get(signature) || 0) + 1
    occurrenceBySignature.set(signature, occurrence)

    const stableLineHash = buildLineHashFromBusinessSignature(signature, occurrence)

    return {
      ...row,
      ligne_hash: stableLineHash,
      ...(config.key === 'facture_lignes' ? { ligne_hash_metier: stableLineHash } : {}),
      __business_signature: signature,
      __business_occurrence: occurrence,
    }
  })
}

function buildLineHash(row: GenericRow, tableKey: TableKey, index: number) {
  const signature = buildLineBusinessSignature(row, tableKey)
  return buildLineHashFromBusinessSignature(signature, index || 1)
}

function stripTechnicalImportFields(row: GenericRow) {
  const { __errors, __business_signature, __business_occurrence, ...clean } = row
  return clean
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


function previewOrderColumn(config: TableConfig) {
  if (isLineTableKey(config.key)) return 'imported_at'
  if (config.columns.some((c) => c.db === 'updated_at')) return 'updated_at'
  return config.primaryKey
}

function uniqueStrings(values: any[]) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)))
}

const FACTURE_LIGNES_DB_COLUMNS = [
  'id',
  'ligne_hash',
  'ligne_hash_metier',
  'type_document',
  'numero_piece',
  'numero_tiers_entete',
  'intitule_tiers_entete',
  'numero_tiers_ligne',
  'intitule_tiers_ligne',
  'numero_piece_devis',
  'numero_piece_bc',
  'numero_piece_pl',
  'numero_piece_bl',
  'date_facture',
  'date_devis',
  'date_bc',
  'date_pl',
  'date_bl',
  'reference_article',
  'reference_client',
  'designation',
  'complement',
  'reference',
  'gamme_1',
  'gamme_2',
  'numero_serie_lot',
  'complement_serie_lot',
  'pu_ht',
  'pu_ttc',
  'pu_devise',
  'pu_bon_commande',
  'ressource',
  'qte_ressource',
  'quantite',
  'qte_colisee',
  'conditionnement',
  'qte_devis',
  'qte_commandee',
  'qte_preparee',
  'qte_livree',
  'poids_net_global',
  'poids_brut_global',
  'date_livraison',
  'remise',
  'pu_net',
  'pu_net_ttc',
  'pu_net_devise',
  'prix_revient_unitaire',
  'cmup',
  'montant_ht',
  'montant_ht_devise',
  'taxe_1',
  'taxe_2',
  'taxe_3',
  'prix_revient_total',
  'montant_ttc',
  'collaborateur',
  'depot',
  'affaire',
  'date_peremption',
  'date_fabrication',
  'base_calcul_marge',
  'marge_valeur',
  'marge_pourcent',
  'projet',
  'source_import',
  'imported_at',
  'updated_at',
]

function lookupColumnsForDuplicateSignature(config: TableConfig) {
  if (config.key === 'facture_lignes') return FACTURE_LIGNES_DB_COLUMNS.join(',')

  return Array.from(
    new Set([
      ...config.columns
        .map((col) => col.db)
        .filter((db) => db && !db.startsWith('__')),
      'source_import',
      'imported_at',
    ])
  ).join(',')
}

function chunkArray<T>(values: T[], chunkSize: number) {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += chunkSize) chunks.push(values.slice(i, i + chunkSize))
  return chunks
}

function toErrorMessage(error: any) {
  if (!error) return 'Erreur inconnue'
  if (error?.message) return String(error.message)
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
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
  const [importSteps, setImportSteps] = useState<ImportStep[]>([])

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

    const orderColumn = previewOrderColumn(config)

    try {
      const { data, error: loadError } = await supabase
        .from(config.key)
        .select('*')
        .order(orderColumn, { ascending: false, nullsFirst: false })
        .range(0, PREVIEW_LIMIT - 1)

      if (loadError) throw loadError
      setRows(data || [])
    } catch (e: any) {
      setError(
        `Chargement aperçu impossible : ${toErrorMessage(e)}\n` +
          `La page n'affiche que les ${PREVIEW_LIMIT} dernières lignes. Si l'erreur persiste, vérifier l'index sur ${orderColumn}.`
      )
      setRows([])
    } finally {
      setLoading(false)
    }
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
              targetRow.imported_at = nowIso
              targetRow.source_import = file.name
            }

            targetRow.updated_at = nowIso

            return targetRow
          })

          const rowsWithStableHashes = assignStableLineHashes(normalizedRows, config)

          if (ignoredHeaders.length && rowsWithStableHashes[0]) {
            const firstRow = rowsWithStableHashes[0] as GenericRow
            firstRow.__errors = [
              ...(Array.isArray(firstRow.__errors) ? firstRow.__errors : []),
              `Colonnes Excel ignorées car non reconnues : ${ignoredHeaders.join(', ')}`,
            ]
          }

          resolve(rowsWithStableHashes)
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

  function countByBusinessSignature(rows: GenericRow[]) {
    const counts = new Map<string, number>()

    rows.forEach((row) => {
      const signature = String(row.__business_signature || '').trim()
      if (!signature) return
      counts.set(signature, (counts.get(signature) || 0) + 1)
    })

    return counts
  }


  function collectReferencedTiers(rows: GenericRow[]) {
    const tiersByNumero = new Map<string, GenericRow>()

    function addTier(numeroValue: any, intituleValue: any) {
      const numero = String(numeroValue ?? '').trim()
      if (!numero) return

      const intitule = String(intituleValue ?? '').trim() || numero
      const existing = tiersByNumero.get(numero)

      // On conserve le libellé le plus informatif si la même référence tiers apparaît plusieurs fois.
      if (!existing || (intitule && intitule.length > String(existing.intitule || '').length)) {
        tiersByNumero.set(numero, {
          numero,
          intitule,
        })
      }
    }

    rows.forEach((row) => {
      addTier(row.numero_tiers_entete, row.intitule_tiers_entete)
      addTier(row.numero_tiers_ligne, row.intitule_tiers_ligne)
    })

    return Array.from(tiersByNumero.values())
  }


  async function resetActivityTablesBeforeImport(onProgress?: (detail: string) => void) {
    onProgress?.('Vidage de activite_lignes et indicateur_activite_mensuel avant chargement')

    const { error } = await supabase.rpc('reset_import_activite_tables')

    if (error) {
      throw new Error(
        `Nettoyage préalable activité impossible : ${error.message}. ` +
          `Crée ou vérifie la fonction SQL public.reset_import_activite_tables().`
      )
    }

    return { ok: true }
  }

  async function runPostImportRefresh(config: TableConfig, onProgress?: (detail: string) => void) {
    if (config.key === 'facture_lignes') {
      onProgress?.('Rafraîchissement facture_entetes_cache')
      const { error: cacheError } = await supabase.rpc('refresh_facture_entetes_cache')
      if (cacheError) throw new Error(`refresh_facture_entetes_cache : ${cacheError.message}`)

      onProgress?.('Rebuild indicateur_factures_mensuel')
      const { error: factureAggError } = await supabase.rpc('rebuild_indicateur_factures_mensuel')
      if (factureAggError) throw new Error(`rebuild_indicateur_factures_mensuel : ${factureAggError.message}`)

      return 'Cache factures et indicateur factures recalculés'
    }

    if (config.key === 'activite_lignes') {
      onProgress?.('Rebuild indicateur_activite_mensuel')
      const { error: activiteAggError } = await supabase.rpc('rebuild_indicateur_activite_mensuel')
      if (activiteAggError) throw new Error(`rebuild_indicateur_activite_mensuel : ${activiteAggError.message}`)

      return 'Indicateur activité recalculé'
    }

    return 'Aucun refresh automatique requis pour cette table'
  }

  async function ensureReferencedTiers(
    rows: GenericRow[],
    config: TableConfig,
    onProgress?: (detail: string) => void
  ) {
    if (!isLineTableKey(config.key) || !rows.length) {
      return { upserted: 0, skipped: true }
    }

    const tiers = collectReferencedTiers(rows)
    if (!tiers.length) {
      onProgress?.('Aucun tiers à synchroniser')
      return { upserted: 0, skipped: false }
    }

    const chunks = chunkArray(tiers, REF_INSERT_CHUNK_SIZE)
    let upserted = 0

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      onProgress?.(`Synchronisation tiers ${i + 1}/${chunks.length} (${chunk.length} tiers)`)

      const { error } = await supabase
        .from('ref_tiers')
        .upsert(chunk, { onConflict: 'numero', ignoreDuplicates: true })

      if (error) {
        throw new Error(
          `Mise à jour automatique du référentiel tiers impossible : ${error.message}. ` +
            `Vérifie que ref_tiers contient les colonnes numero et intitule, et que numero est unique.`
        )
      }

      upserted += chunk.length
    }

    return { upserted, skipped: false }
  }

  async function findExistingLineDuplicates(
    importRows: GenericRow[],
    config: TableConfig,
    onProgress?: (detail: string) => void
  ) {
    if (!isLineTableKey(config.key) || !importRows.length) {
      return { rowsToInsert: importRows, duplicateRejects: [] as string[] }
    }

    const importedHashes = uniqueStrings(importRows.flatMap((row) => [row.ligne_hash_metier, row.ligne_hash]))
    const existingHashRows: GenericRow[] = []
    const hashChunks = chunkArray(importedHashes, DUPLICATE_LOOKUP_CHUNK_SIZE)

    for (let i = 0; i < hashChunks.length; i += 1) {
      const hashChunk = hashChunks[i]
      onProgress?.(`Recherche hash ${i + 1}/${hashChunks.length} (${hashChunk.length} clés)`)

      const selectCols = config.key === 'facture_lignes'
        ? 'ligne_hash,ligne_hash_metier,numero_piece,date_facture,reference_article,source_import,imported_at'
        : 'ligne_hash,numero_piece,date_piece,reference_article,source_import,imported_at'

      // Important : les anciennes lignes peuvent avoir seulement ligne_hash renseigné,
      // alors que les nouvelles lignes utilisent aussi ligne_hash_metier.
      // On contrôle donc les deux colonnes pour éviter une erreur unique constraint à l'insertion.
      const { data: existingByTechnicalHash, error: technicalHashError } = await supabase
        .from(config.key)
        .select(selectCols)
        .in('ligne_hash', hashChunk)
        .limit(10000)

      if (technicalHashError) throw new Error(`Contrôle doublons par ligne_hash impossible : ${technicalHashError.message}`)
      if (existingByTechnicalHash?.length) existingHashRows.push(...(existingByTechnicalHash as GenericRow[]))

      if (config.key === 'facture_lignes') {
        const { data: existingByBusinessHash, error: businessHashError } = await supabase
          .from(config.key)
          .select(selectCols)
          .in('ligne_hash_metier', hashChunk)
          .limit(10000)

        if (businessHashError) throw new Error(`Contrôle doublons par ligne_hash_metier impossible : ${businessHashError.message}`)
        if (existingByBusinessHash?.length) existingHashRows.push(...(existingByBusinessHash as GenericRow[]))
      }
    }

    const existingHashes = new Set(
      existingHashRows
        .map((row) => String(config.key === 'facture_lignes' ? row.ligne_hash_metier || row.ligne_hash : row.ligne_hash || '').trim())
        .filter(Boolean)
    )

    // Fallback sécurisé : si des anciennes lignes n'ont pas encore de ligne_hash_metier,
    // on contrôle seulement les numéros de pièces du fichier, par petits lots, avec les colonnes minimales.
    const missingHashRows = importRows.filter((row) => {
      const hash = String(config.key === 'facture_lignes' ? row.ligne_hash_metier || row.ligne_hash : row.ligne_hash || '').trim()
      return !hash || !existingHashes.has(hash)
    })

    const invoiceNumbers = uniqueStrings(missingHashRows.map((row) => row.numero_piece))
    const existingCounts = new Map<string, number>()
    const existingInfoBySignature = new Map<string, GenericRow>()

    const invoiceChunks = chunkArray(invoiceNumbers, DUPLICATE_LOOKUP_CHUNK_SIZE)
    const selectColsForSignature = lookupColumnsForDuplicateSignature(config)

    for (let i = 0; i < invoiceChunks.length; i += 1) {
      const invoiceChunk = invoiceChunks[i]
      if (!invoiceChunk.length) continue
      onProgress?.(`Recherche anciennes lignes sans hash métier ${i + 1}/${invoiceChunks.length} (${invoiceChunk.length} factures)`)

      const { data, error } = await supabase
        .from(config.key)
        .select(selectColsForSignature)
        .in('numero_piece', invoiceChunk)
        .limit(10000)

      if (error) throw new Error(`Contrôle doublons par facture impossible : ${error.message}`)

      ;((data || []) as GenericRow[]).forEach((existing) => {
        const businessSignature = buildLineBusinessSignature(existing, config.key)
        existingCounts.set(businessSignature, (existingCounts.get(businessSignature) || 0) + 1)
        if (!existingInfoBySignature.has(businessSignature)) existingInfoBySignature.set(businessSignature, existing)
      })
    }

    const seenInCurrentImport = new Map<string, number>()
    const rowsToInsert: GenericRow[] = []
    const duplicateRejects: string[] = []

    importRows.forEach((row, index) => {
      const signature = String(row.__business_signature || '').trim()
      const currentOccurrence = (seenInCurrentImport.get(signature) || 0) + 1
      seenInCurrentImport.set(signature, currentOccurrence)

      const metierHash = String(config.key === 'facture_lignes' ? row.ligne_hash_metier || row.ligne_hash : row.ligne_hash || '').trim()
      const alreadyExistsByHash = metierHash ? existingHashes.has(metierHash) : false
      const existingCount = existingCounts.get(signature) || 0

      if (alreadyExistsByHash || currentOccurrence <= existingCount) {
        const existing = existingInfoBySignature.get(signature) || existingHashRows.find((r) => {
          const existingHash = String(config.key === 'facture_lignes' ? r.ligne_hash_metier || r.ligne_hash : r.ligne_hash || '').trim()
          return existingHash && existingHash === metierHash
        })

        duplicateRejects.push(
          `Ligne ${index + 2} rejetée : document déjà présent en base ` +
            `(N° ${row.numero_piece || 'NC'}, date ${row.date_facture || row.date_piece || 'NC'}, article ${row.reference_article || 'NC'}). ` +
            `Import existant : ${existing?.source_import || 'source inconnue'}${existing?.imported_at ? ` le ${existing.imported_at}` : ''}.`
        )
      } else {
        rowsToInsert.push(row)
      }
    })

    return { rowsToInsert, duplicateRejects }
  }


  async function writeChunk(rows: GenericRow[], config: TableConfig) {
    const cleanRows = rows.map(stripTechnicalImportFields)

    if (isLineTableKey(config.key)) {
      const { error: insertError } = await supabase
        .from(config.key)
        .insert(cleanRows)

      if (insertError) throw insertError
      return cleanRows.length
    }

    const { error: upsertError } = await supabase
      .from(config.key)
      .upsert(cleanRows, { onConflict: config.primaryKey })

    if (upsertError) throw upsertError
    return cleanRows.length
  }



  async function setImportTriggersEnabled(config: TableConfig, enabled: boolean) {
    if (!isLineTableKey(config.key)) return { ok: true, message: 'Pas de trigger à piloter pour cette table' }

    const { error } = await supabase.rpc('set_import_user_triggers', {
      p_table_name: config.key,
      p_enabled: enabled,
    })

    if (error) {
      throw new Error(
        `Pilotage des triggers impossible sur ${config.key} : ${error.message}. ` +
          `Crée ou vérifie la fonction SQL public.set_import_user_triggers(text, boolean).`
      )
    }

    return {
      ok: true,
      message: enabled ? `Triggers réactivés sur ${config.key}` : `Triggers désactivés sur ${config.key}`,
    }
  }

  function isTimeoutError(error: any) {
    const message = toErrorMessage(error).toLowerCase()
    return message.includes('statement timeout') || message.includes('failed to fetch') || message.includes('timeout')
  }

  function isUniqueConstraintError(error: any) {
    const message = toErrorMessage(error).toLowerCase()
    return (
      message.includes('duplicate key value') ||
      message.includes('unique constraint') ||
      message.includes('23505') ||
      message.includes('facture_lignes_ligne_hash_key')
    )
  }

  async function writeRowsWithRetry(
    rowsToWrite: GenericRow[],
    config: TableConfig,
    onProgress?: (detail: string) => void
  ): Promise<number> {
    if (!rowsToWrite.length) return 0

    try {
      return await writeChunk(rowsToWrite, config)
    } catch (e: any) {
      const isRecoverableLineError = isLineTableKey(config.key) && (isTimeoutError(e) || isUniqueConstraintError(e))

      if (!isRecoverableLineError) {
        throw e
      }

      if (rowsToWrite.length <= 1) {
        const row = rowsToWrite[0] || {}
        if (isUniqueConstraintError(e)) {
          onProgress?.(
            `Ligne ignorée car déjà présente via contrainte technique ligne_hash ` +
              `(N° ${row.numero_piece || 'NC'}, date ${row.date_facture || row.date_piece || 'NC'}, article ${row.reference_article || 'NC'})`
          )
          return 0
        }
        throw e
      }

      const middle = Math.ceil(rowsToWrite.length / 2)
      const left = rowsToWrite.slice(0, middle)
      const right = rowsToWrite.slice(middle)
      onProgress?.(
        `Lot de ${rowsToWrite.length} ligne(s) refusé ou trop long : découpage automatique en ${left.length} + ${right.length}`
      )

      const insertedLeft = await writeRowsWithRetry(left, config, onProgress)
      const insertedRight = await writeRowsWithRetry(right, config, onProgress)
      return insertedLeft + insertedRight
    }
  }

  function resetImportProgress() {
    setImportSteps(IMPORT_STEP_TEMPLATES.map((step) => ({ ...step })))
  }

  function updateImportStep(key: string, status: ImportStepStatus, detail?: string) {
    setImportSteps((prev) => {
      const base = prev.length ? prev : IMPORT_STEP_TEMPLATES.map((step) => ({ ...step }))
      return base.map((step) =>
        step.key === key
          ? { ...step, status, detail: detail ?? step.detail }
          : step
      )
    })
  }

  async function handleFileImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    setMessage(null)
    setError(null)
    setLastRejects([])
    resetImportProgress()

    try {
      updateImportStep('read', 'running', `${file.name} — lecture en cours`)
      const parsedRows = await parseExcelRows(file, selectedConfig)
      updateImportStep('read', 'done', `${parsedRows.length} ligne(s) lue(s)`)

      updateImportStep('normalize', 'running', 'Analyse des colonnes et conversion des dates/nombres')
      const parseErrors = parsedRows.flatMap((row) => Array.isArray(row.__errors) ? row.__errors : [])
      const cleanedRows = parsedRows.map(({ __errors, ...row }) => row)
      updateImportStep('normalize', 'done', `${parseErrors.length} avertissement(s) de mapping/conversion`)

      updateImportStep('validate', 'running', 'Contrôle des champs obligatoires')
      const { valid, errors } = validateRows(cleanedRows, selectedConfig)
      const { rows: deduplicatedRows, duplicates } = deduplicateRows(valid, selectedConfig)
      updateImportStep('validate', 'done', `${valid.length} ligne(s) valide(s), ${errors.length} rejet(s), ${duplicates.length} doublon(s) dans le fichier`)

      if (!deduplicatedRows.length) {
        updateImportStep('reset', 'done', 'Aucun nettoyage requis')
        updateImportStep('tiers', 'done', 'Aucun tiers à synchroniser')
        updateImportStep('duplicates', 'done', 'Aucune ligne à contrôler')
        updateImportStep('insert', 'done', 'Aucune ligne à insérer')
        setLastRejects([...parseErrors, ...errors].map((message) => ({ type: 'Erreur', message })))
        setError(errors.slice(0, 10).join('\n') || 'Aucune ligne valide à importer.')
        setImporting(false)
        return
      }

      if (selectedConfig.key === 'activite_lignes') {
        updateImportStep('reset', 'running', 'Vidage activité avant rechargement complet')
        await resetActivityTablesBeforeImport((detail) => updateImportStep('reset', 'running', detail))
        updateImportStep('reset', 'done', 'activite_lignes et indicateur_activite_mensuel vidées')
      } else {
        updateImportStep('reset', 'done', 'Étape non requise pour cette table')
      }

      updateImportStep('tiers', 'running', 'Synchronisation des tiers utilisés par le fichier avant insertion')
      const tiersResult = await ensureReferencedTiers(
        deduplicatedRows,
        selectedConfig,
        (detail) => updateImportStep('tiers', 'running', detail)
      )
      updateImportStep(
        'tiers',
        'done',
        tiersResult.skipped
          ? 'Étape non requise pour cette table'
          : `${tiersResult.upserted} tiers synchronisé(s) dans ref_tiers`
      )

      updateImportStep('duplicates', 'running', 'Recherche des lignes déjà présentes en base')
      const { rowsToInsert, duplicateRejects } = await findExistingLineDuplicates(
        deduplicatedRows,
        selectedConfig,
        (detail) => updateImportStep('duplicates', 'running', detail)
      )
      updateImportStep('duplicates', 'done', `${duplicateRejects.length} ligne(s) déjà présente(s) rejetée(s), ${rowsToInsert.length} ligne(s) à importer`)

      if (!rowsToInsert.length) {
        const technicalMessages = [...parseErrors, ...errors, ...duplicates, ...duplicateRejects]
        setLastRejects(technicalMessages.map((message) => ({ type: 'Rejet import', message })))
        setMessage(`0 ligne importée dans ${selectedConfig.label}. Toutes les lignes valides étaient déjà présentes en base.`)
        if (technicalMessages.length) setError(technicalMessages.slice(0, 30).join('\n'))
        updateImportStep('insert', 'done', '0 ligne insérée')
        updateImportStep('refresh', 'done', 'Aucun refresh nécessaire')
        updateImportStep('reload', 'running', 'Actualisation des statistiques et de l’aperçu')
        await loadStats()
        await loadRows(selectedConfig)
        updateImportStep('reload', 'done', 'Écran actualisé')
        setImporting(false)
        return
      }

      const chunkSize = isLineTableKey(selectedConfig.key) ? LINE_INSERT_CHUNK_SIZE : REF_INSERT_CHUNK_SIZE
      const chunks = chunkArray(rowsToInsert, chunkSize)
      let imported = 0
      let triggersDisabled = false

      updateImportStep('insert', 'running', `Préparation insertion : ${rowsToInsert.length} ligne(s), lots de ${chunkSize}`)

      try {
        if (isLineTableKey(selectedConfig.key)) {
          updateImportStep('insert', 'running', `Désactivation temporaire des triggers sur ${selectedConfig.key}`)
          await setImportTriggersEnabled(selectedConfig, false)
          triggersDisabled = true
        }

        updateImportStep('insert', 'running', `0/${rowsToInsert.length} ligne(s) insérée(s)`)
        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i]
          imported += await writeRowsWithRetry(chunk, selectedConfig, (detail) => {
            updateImportStep('insert', 'running', `${imported}/${rowsToInsert.length} — ${detail}`)
          })
          updateImportStep('insert', 'running', `${imported}/${rowsToInsert.length} ligne(s) insérée(s) — lot ${i + 1}/${chunks.length}`)
        }
      } finally {
        if (triggersDisabled) {
          updateImportStep('insert', 'running', `Réactivation des triggers sur ${selectedConfig.key}`)
          await setImportTriggersEnabled(selectedConfig, true)
        }
      }

      updateImportStep('insert', 'done', `${imported} ligne(s) insérée(s). Triggers réactivés.`)

      updateImportStep('refresh', 'running', 'Mise à jour des caches et agrégats')
      const refreshMessage = await runPostImportRefresh(selectedConfig, (detail) => updateImportStep('refresh', 'running', detail))
      updateImportStep('refresh', 'done', refreshMessage)

      const technicalMessages = [...parseErrors, ...errors, ...duplicates, ...duplicateRejects]
      setLastRejects(technicalMessages.map((message) => ({ type: 'Information import', message })))

      setMessage(
        `${imported} ligne(s) importée(s) dans ${selectedConfig.label}. ` +
          `${errors.length + duplicateRejects.length} rejet(s). ${duplicates.length} doublon(s) dans le fichier. ` +
          `${duplicateRejects.length} ligne(s) déjà présente(s) en base rejetée(s).`
      )
      if (technicalMessages.length) setError(technicalMessages.slice(0, 20).join('\n'))

      updateImportStep('reload', 'running', 'Actualisation des statistiques et de l’aperçu')
      await loadStats()
      await loadRows(selectedConfig)
      updateImportStep('reload', 'done', 'Écran actualisé')
    } catch (e: any) {
      const msg = toErrorMessage(e)
      setError(msg)
      setImportSteps((prev) =>
        prev.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: msg } : step)
      )
    } finally {
      setImporting(false)
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

    try {
      const rowToSave: GenericRow = { ...editingRow }

      for (const col of selectedConfig.columns) {
        if (col.readonly && !rowToSave[col.db]) continue
        if (col.type) rowToSave[col.db] = normalizeValue(rowToSave[col.db], col.type, col)
      }

      if (isLineTableKey(selectedConfig.key) && !rowToSave.ligne_hash) {
        rowToSave.ligne_hash = buildLineHash(rowToSave, selectedConfig.key, 1)
      }
      if (selectedConfig.key === 'facture_lignes' && !rowToSave.ligne_hash_metier) {
        rowToSave.ligne_hash_metier = rowToSave.ligne_hash
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
        .upsert(stripTechnicalImportFields(rowToSave), { onConflict: selectedConfig.primaryKey })

      if (saveError) throw saveError

      if (selectedConfig.key === 'facture_lignes') {
        await supabase.rpc('refresh_facture_entetes_cache')
      }

      setMessage('Enregistrement sauvegardé.')
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
              </div>

              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer dans les lignes affichées…"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 lg:w-96"
              />
            </div>

            {message && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
            {error && <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</pre>}

            {importSteps.length > 0 && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Contrôle temps réel du chargement</h3>
                    <p className="text-xs text-slate-500">Suivi des étapes : lecture, contrôle doublons, insertion, refresh et actualisation.</p>
                  </div>
                  {importing && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">Import en cours</span>}
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {importSteps.map((step) => (
                    <div key={step.key} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            step.status === 'done'
                              ? 'bg-emerald-500'
                              : step.status === 'running'
                                ? 'bg-blue-500'
                                : step.status === 'error'
                                  ? 'bg-red-500'
                                  : 'bg-slate-300'
                          }`}
                        />
                        <span className="text-xs font-bold text-slate-800">{step.label}</span>
                      </div>
                      {step.detail && <div className="mt-1 text-xs text-slate-500">{step.detail}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
              Affichage limité aux {PREVIEW_LIMIT} dernières lignes pour garder une page rapide. L’import traite le fichier complet.
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
