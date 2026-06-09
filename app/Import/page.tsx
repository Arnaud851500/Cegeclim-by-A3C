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
  | 'devis_lignes'
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

type FieldDifference = {
  db: string
  label: string
  currentValue: any
  importedValue: any
}

type ReferentialConflict = {
  tableKey: TableKey
  primaryKeyValue: string
  displayLabel: string
  existingRow: GenericRow
  importedRow: GenericRow
  differences: FieldDifference[]
  selected: boolean
}

type PendingReferentialImport = {
  configKey: TableKey
  configLabel: string
  fileName: string
  rowsWithoutConflicts: GenericRow[]
  conflicts: ReferentialConflict[]
  technicalMessages: string[]
  identicalIgnored: number
}

const PREVIEW_LIMIT = 100

// Performance import : le contrôle de doublons travaille par lots de hash.
// 50 clés provoquait près de 300 appels Supabase pour un fichier devis d'environ 15 000 lignes.
// 1000 clés réduit fortement le nombre d'allers-retours tout en restant raisonnable pour PostgREST.
const DUPLICATE_LOOKUP_CHUNK_SIZE = 1000

// Les triggers sont désactivés pendant l'insertion des lignes ; on peut donc insérer par lots plus larges.
const LINE_INSERT_CHUNK_SIZE = 250
const REF_INSERT_CHUNK_SIZE = 250

const IMPORT_STEP_TEMPLATES: ImportStep[] = [
  { key: 'read', label: 'Lecture du fichier Excel', status: 'pending' },
  { key: 'normalize', label: 'Normalisation et mapping des colonnes', status: 'pending' },
  { key: 'validate', label: 'Validation des champs obligatoires', status: 'pending' },
  { key: 'reset', label: 'Nettoyage préalable des tables activité', status: 'pending' },
  { key: 'tiers', label: 'Mise à jour automatique du référentiel tiers', status: 'pending' },
  { key: 'articles', label: 'Mise à jour automatique du référentiel articles', status: 'pending' },
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
      {
        db: 'quantite_pertinente',
        label: 'Quantité pertinente',
        aliases: [
          'Quantite_pertinente',
          'Quantité pertinente',
          'Quantite pertinente',
          'Qté pertinente',
          'Qte pertinente',
        ],
      },
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
    key: 'devis_lignes',
    label: 'Lignes de devis',
    primaryKey: 'ligne_hash',
    secondaryKeys: ['numero_piece', 'reference_article', 'designation'],
    description: 'Table centrale : une ligne par ligne de devis.',
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


const LINE_TABLE_KEYS: TableKey[] = ['facture_lignes', 'devis_lignes', 'activite_lignes']
const REFERENTIAL_REVIEW_TABLE_KEYS: TableKey[] = ['ref_tiers', 'ref_articles', 'ref_collaborateurs']

const FILE_NAME_RULES: Partial<Record<TableKey, { keywords: string[]; expectedLabel: string }>> = {
  activite_lignes: { keywords: ['activite', 'activité'], expectedLabel: 'activite ou activité' },
  facture_lignes: { keywords: ['facture', 'facturation'], expectedLabel: 'facture ou facturation' },
  devis_lignes: { keywords: ['devis'], expectedLabel: 'devis' },
  ref_tiers: { keywords: ['tiers'], expectedLabel: 'tiers' },
  ref_articles: { keywords: ['article'], expectedLabel: 'article' },
  ref_collaborateurs: { keywords: ['collaborateur', 'collaborateurs', 'collab'], expectedLabel: 'collaborateur ou collaborateurs' },
}

function isLineTableKey(key: TableKey) {
  return LINE_TABLE_KEYS.includes(key)
}

function shouldReviewExistingRecords(key: TableKey) {
  return REFERENTIAL_REVIEW_TABLE_KEYS.includes(key)
}

const EXTRA_HEADER_ALIASES: Record<TableKey, Record<string, string>> = {
  ref_familles: {
    quantite_pertinente: 'quantite_pertinente',
    quantite_pertinente_oui_non: 'quantite_pertinente',
    qte_pertinente: 'quantite_pertinente',
    qte_pertinente_oui_non: 'quantite_pertinente',
  },
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
  devis_lignes: {
    date: 'date_devis',
    date_piece: 'date_devis',
    date_de_la_piece: 'date_devis',
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

function normalizeCodeNaf(value: any) {
  const text = normalizeText(value)
  if (!text) return null

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[._\-/]/g, '')

  if (!normalized || ['NC', 'ND', 'NA', 'N/A', 'NULL', 'AUCUN', 'AUCUNE'].includes(normalized)) {
    return null
  }

  return normalized
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

function normalizeOuiNon(value: any) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'

  const text = String(value).trim()
  if (!text) return null

  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  if (['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'x'].includes(normalized)) return 'Oui'
  if (['non', 'n', 'no', 'false', 'faux', '0'].includes(normalized)) return 'Non'

  return text
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
  if (column?.db === 'code_naf') return normalizeCodeNaf(value)
  if (column?.db === 'quantite_pertinente') return normalizeOuiNon(value)
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
  const documentDate = tableKey === 'facture_lignes' ? row.date_facture : tableKey === 'devis_lignes' ? row.date_devis : row.date_piece

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
      ...(['facture_lignes', 'devis_lignes'].includes(config.key) ? { ligne_hash_metier: stableLineHash } : {}),
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

function formatCellValue(value: any, column?: ColumnConfig) {
  if (value === undefined || value === null || value === '') return '—'
  if (column?.type === 'boolean') return normalizeBoolean(value) ? 'Oui' : 'Non'
  if (column?.type === 'date') return normalizeDate(value) || String(value)
  return String(value)
}

function compactTextLength(value: any) {
  const text = normalizeText(value)
  if (!text) return 0

  const digitsOnly = text.replace(/\D/g, '')
  if (digitsOnly) return digitsOnly.length

  return text.replace(/\s+/g, '').length
}

function hasCompleteExistingSiret(value: any) {
  const text = normalizeText(value)
  if (!text) return false

  const digitsOnly = text.replace(/\D/g, '')

  // SIRET français standard = 14 chiffres. Certains exports Sage peuvent contenir un caractère de plus.
  return digitsOnly.length >= 14 || text.replace(/\s+/g, '').length >= 15
}

function hasShortImportedSiret(value: any) {
  return compactTextLength(value) < 10
}

function shouldPreserveExistingRefTiersValue(existingRow: GenericRow, importedRow: GenericRow, column: ColumnConfig) {
  if (column.db === 'code_naf') return true

  if (column.db === 'siret') {
    return hasCompleteExistingSiret(existingRow.siret) && hasShortImportedSiret(importedRow.siret)
  }

  return false
}

function buildImportedRowForExistingRecord(importedRow: GenericRow, existingRow: GenericRow, config: TableConfig) {
  if (config.key !== 'ref_tiers') return importedRow

  const protectedRow = { ...importedRow }

  for (const column of config.columns) {
    if (!Object.prototype.hasOwnProperty.call(protectedRow, column.db)) continue
    if (!shouldPreserveExistingRefTiersValue(existingRow, protectedRow, column)) continue
    protectedRow[column.db] = existingRow[column.db] ?? null
  }

  return protectedRow
}

function shouldIgnoreDifferenceForExistingRecord(
  currentValue: any,
  importedValue: any,
  column: ColumnConfig,
  existingRow: GenericRow,
  importedRow: GenericRow,
  config: TableConfig
) {
  if (config.key !== 'ref_tiers') return false

  if (column.db === 'code_naf') {
    // Pour un tiers déjà existant, le code NAF ne doit ni générer un écart ni écraser la valeur en base.
    return true
  }

  if (column.db === 'siret') {
    // Ne pas écraser un SIRET complet par une valeur courte issue du fichier.
    return hasCompleteExistingSiret(currentValue) && hasShortImportedSiret(importedValue)
  }

  return false
}

function valuesAreEquivalentForImport(currentValue: any, importedValue: any, column: ColumnConfig) {
  if (column.db === 'code_naf') {
    return normalizeCodeNaf(currentValue) === normalizeCodeNaf(importedValue)
  }

  if (column.type === 'number') {
    const current = column.numberFormat === 'percent_ratio' ? normalizePercentRatio(currentValue) : normalizeNumber(currentValue)
    const imported = column.numberFormat === 'percent_ratio' ? normalizePercentRatio(importedValue) : normalizeNumber(importedValue)
    if (current === null && imported === null) return true
    if (current === null || imported === null) return false
    return Math.abs(current - imported) < 0.000001
  }

  if (column.type === 'boolean') {
    return normalizeBoolean(currentValue) === normalizeBoolean(importedValue)
  }

  if (column.type === 'date') {
    return normalizeDate(currentValue) === normalizeDate(importedValue)
  }

  return normalizeText(currentValue) === normalizeText(importedValue)
}

function getImportedDifferences(importedRow: GenericRow, existingRow: GenericRow, config: TableConfig) {
  const differences: FieldDifference[] = []

  for (const column of config.columns) {
    if (column.readonly) continue
    if (column.db === config.primaryKey) continue
    if (!Object.prototype.hasOwnProperty.call(importedRow, column.db)) continue

    const currentValue = existingRow[column.db]
    const importedValue = importedRow[column.db]

    if (shouldIgnoreDifferenceForExistingRecord(currentValue, importedValue, column, existingRow, importedRow, config)) {
      continue
    }

    if (!valuesAreEquivalentForImport(currentValue, importedValue, column)) {
      differences.push({
        db: column.db,
        label: column.label,
        currentValue,
        importedValue,
      })
    }
  }

  return differences
}

function displayLabelForImportedRow(row: GenericRow, config: TableConfig) {
  const candidates = [
    row.intitule,
    row.designation,
    row.nom && row.prenom ? `${row.nom} ${row.prenom}` : null,
    row.nom,
    row.reference_article,
    row.numero,
    row[config.primaryKey],
  ]

  return String(candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '—')
}

function confirmFileNameMatchesImport(file: File, config: TableConfig) {
  const rule = FILE_NAME_RULES[config.key]
  if (!rule) return true

  const normalizedFileName = normalizeHeader(file.name)
  const hasExpectedKeyword = rule.keywords.some((keyword) => normalizedFileName.includes(normalizeHeader(keyword)))
  if (hasExpectedKeyword) return true

  return window.confirm(
    `Attention : le nom du fichier sélectionné ne contient pas « ${rule.expectedLabel} ».\n\n` +
      `Fichier : ${file.name}\n` +
      `Import sélectionné : ${config.label}\n\n` +
      `Annuler pour choisir un autre fichier, ou Continuer pour importer quand même.`
  )
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
  if (config.key === 'facture_lignes' || config.key === 'devis_lignes') return FACTURE_LIGNES_DB_COLUMNS.join(',')

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

type ReconciliationRow = {
  annee: number
  mois: number
  factures_lignes: number | null
  factures_cache: number | null
  factures_indicateur: number | null
  factures_flux: number | null
  ecart_factures_lignes_vs_flux: number | null
  devis_lignes: number | null
  devis_cache: number | null
  devis_indicateur: number | null
  devis_flux: number | null
  ecart_devis_lignes_vs_flux: number | null
  cdc_source_activite_plus_factures: number | null
  cdc_indicateur_activite: number | null
  cdc_flux: number | null
  ecart_cdc_source_vs_flux: number | null
  bl_source_activite_plus_factures: number | null
  bl_indicateur_activite: number | null
  bl_flux: number | null
  ecart_bl_source_vs_flux: number | null
  smc_factures_cache: number | null
  smc_devis_cache: number | null
  ecart_smc_factures_vs_indicateur: number | null
  ecart_smc_devis_vs_indicateur: number | null
}


type ReconciliationRunSummary = {
  run_id: number
  status: string
  checked_months: number
  ok_months: number
  ko_months: number
  factures_ko: number
  devis_ko: number
  cdc_ko: number
  bl_ko: number
  max_abs_ecart: number | null
}

type ReconciliationStoredRow = {
  run_id: number
  annee: number
  mois: number

  factures_lignes: number | null
  factures_cache: number | null
  factures_indicateur: number | null
  factures_flux: number | null
  ecart_factures_lignes_vs_flux: number | null

  devis_lignes: number | null
  devis_cache: number | null
  devis_indicateur: number | null
  devis_flux: number | null
  ecart_devis_lignes_vs_flux: number | null

  cdc_depuis_factures: number | null
  cdc_depuis_activite: number | null
  cdc_flux: number | null
  ecart_cdc: number | null

  bl_depuis_factures: number | null
  bl_depuis_activite: number | null
  bl_flux: number | null
  ecart_bl: number | null

  smc_factures_cache: number | null
  smc_devis_cache: number | null
  ecart_smc_factures_vs_indicateur: number | null
  ecart_smc_devis_vs_indicateur: number | null

  factures_ok?: boolean
  devis_ok?: boolean
  cdc_ok?: boolean
  bl_ok?: boolean
  is_ok?: boolean
}

const TOLERANCE = 0.01


type SmcRpcPeriod = {
  p_date_debut: string
  p_date_fin: string
  label?: string
}

type SmcBatchResult = {
  processed_count?: number | string | null
  last_numero?: string | null
  total_candidates?: number | string | null
  remaining_count?: number | string | null
}

async function runSmcCacheForPeriodBatchesV28(
  period: SmcRpcPeriod,
  onProgress?: (detail: string) => void,
  label = 'Synthèse multi-clients',
  batchSize = 5
) {
  let after: string | null = null
  let processedTotal = 0
  const maxLoops = 500

  for (let loop = 0; loop < maxLoops; loop += 1) {
    onProgress?.(`${label} : ${period.label || `${period.p_date_debut} → ${period.p_date_fin}`} — lot ${loop + 1}${after ? ` après ${after}` : ''}`)

    const { data, error } = await supabase.rpc('rebuild_smc_cache_period_batch_v28', {
      p_date_debut: period.p_date_debut,
      p_date_fin: period.p_date_fin,
      p_after_numero: after,
      p_batch_size: batchSize,
    })

    if (error) throw new Error(`rebuild_smc_cache_period_batch_v28 ${period.label || ''} : ${error.message}`)

    const rows = (Array.isArray(data) ? data : data ? [data] : []) as SmcBatchResult[]
    const batchRow = rows[0]
    const processed = Number(batchRow?.processed_count ?? 0)
    const totalCandidates = Number(batchRow?.total_candidates ?? 0)
    const remaining = Number(batchRow?.remaining_count ?? 0)
    const lastNumero: string | null = batchRow?.last_numero ? String(batchRow.last_numero) : after

    processedTotal += processed
    after = lastNumero

    onProgress?.(
      `${label} : ${period.label || `${period.p_date_debut} → ${period.p_date_fin}`} — ${processedTotal}/${totalCandidates || '?'} client(s) traité(s)${remaining ? ', suite probable…' : ''}`
    )

    // V28 ne lance plus de COUNT global pour éviter les timeouts.
    // On continue tant que le lot est plein ; on s'arrête quand le dernier lot est incomplet ou vide.
    if (!processed || processed < batchSize) {
      return { processedTotal, totalCandidates, lastNumero: after }
    }
  }

  throw new Error(
    `${label} : arrêt de sécurité après ${maxLoops} lots. Dernier client traité : ${after || 'début'}. ` +
      `Relance possible à partir de ce dernier numéro si nécessaire.`
  )
}

async function runSmcCacheForPeriodsBatchesV28(
  periods: SmcRpcPeriod[],
  onProgress?: (detail: string) => void,
  label = 'Synthèse multi-clients'
) {
  for (const period of periods) {
    await runSmcCacheForPeriodBatchesV28(period, onProgress, label, 5)
  }
}

function toNumber(value: any) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function absEcart(value: any) {
  return Math.abs(toNumber(value))
}

function formatMoney(value: any) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value))
}

function formatSigned(value: any) {
  const n = toNumber(value)
  const sign = n > 0 ? '+' : ''
  return `${sign}${formatMoney(n)}`
}

function monthLabel(row: ReconciliationRow) {
  return `${String(row.mois).padStart(2, '0')}/${row.annee}`
}


function mapStoredReconciliationRow(row: ReconciliationStoredRow): ReconciliationRow {
  return {
    annee: row.annee,
    mois: row.mois,

    factures_lignes: row.factures_lignes,
    factures_cache: row.factures_cache,
    factures_indicateur: row.factures_indicateur,
    factures_flux: row.factures_flux,
    ecart_factures_lignes_vs_flux: row.ecart_factures_lignes_vs_flux,

    devis_lignes: row.devis_lignes,
    devis_cache: row.devis_cache,
    devis_indicateur: row.devis_indicateur,
    devis_flux: row.devis_flux,
    ecart_devis_lignes_vs_flux: row.ecart_devis_lignes_vs_flux,

    cdc_source_activite_plus_factures: row.cdc_depuis_factures,
    cdc_indicateur_activite: row.cdc_depuis_activite,
    cdc_flux: row.cdc_flux,
    ecart_cdc_source_vs_flux: row.ecart_cdc,

    bl_source_activite_plus_factures: row.bl_depuis_factures,
    bl_indicateur_activite: row.bl_depuis_activite,
    bl_flux: row.bl_flux,
    ecart_bl_source_vs_flux: row.ecart_bl,

    smc_factures_cache: row.smc_factures_cache,
    smc_devis_cache: row.smc_devis_cache,
    ecart_smc_factures_vs_indicateur: row.ecart_smc_factures_vs_indicateur,
    ecart_smc_devis_vs_indicateur: row.ecart_smc_devis_vs_indicateur,
  }
}

function getEcartClass(value: any) {
  return absEcart(value) > TOLERANCE
    ? 'bg-red-50 text-red-700 font-black'
    : 'bg-emerald-50 text-emerald-700 font-bold'
}

function getValueClass(reference: any, compared: any) {
  const ecart = toNumber(compared) - toNumber(reference)
  return absEcart(ecart) > TOLERANCE ? 'text-red-700 font-black' : 'text-slate-800'
}

function computeRowIssues(row: ReconciliationRow) {
  const issues: string[] = []

  const facturesLignes = toNumber(row.factures_lignes)
  const devisLignes = toNumber(row.devis_lignes)

  // Factures : les 4 montants doivent être alignés.
  if (absEcart(toNumber(row.factures_cache) - facturesLignes) > TOLERANCE) issues.push('Factures cache')
  if (absEcart(toNumber(row.factures_indicateur) - facturesLignes) > TOLERANCE) issues.push('Factures indicateur')
  if (absEcart(toNumber(row.factures_flux) - facturesLignes) > TOLERANCE) issues.push('Factures flux')

  // Devis : les 4 montants doivent être alignés.
  if (absEcart(toNumber(row.devis_cache) - devisLignes) > TOLERANCE) issues.push('Devis cache')
  if (absEcart(toNumber(row.devis_indicateur) - devisLignes) > TOLERANCE) issues.push('Devis indicateur')
  if (absEcart(toNumber(row.devis_flux) - devisLignes) > TOLERANCE) issues.push('Devis flux')

  // Synthèse multi-clients : contrôle du cache écran vs indicateurs mensuels.
  if (row.smc_factures_cache !== null && row.smc_factures_cache !== undefined) {
    if (absEcart(row.ecart_smc_factures_vs_indicateur) > TOLERANCE) issues.push('SMC factures')
  }
  if (row.smc_devis_cache !== null && row.smc_devis_cache !== undefined) {
    if (absEcart(row.ecart_smc_devis_vs_indicateur) > TOLERANCE) issues.push('SMC devis')
  }

  // CDC / BL : on contrôle uniquement l'écart final calculé par la RPC :
  // CDC flux = CDC depuis factures + CDC depuis activité
  // BL flux  = BL depuis factures + BL depuis activité
  if (absEcart(row.ecart_cdc_source_vs_flux) > TOLERANCE) issues.push('CDC flux')
  if (absEcart(row.ecart_bl_source_vs_flux) > TOLERANCE) issues.push('BL flux')

  return issues
}

function exportRows(rows: ReconciliationRow[]) {
  if (!rows.length) return

  const exportData = rows.map((row) => {
    const facturesLignes = toNumber(row.factures_lignes)
    const devisLignes = toNumber(row.devis_lignes)
    const cdcDepuisFact = toNumber(row.cdc_source_activite_plus_factures)
    const cdcAttendu = cdcDepuisFact + toNumber(row.cdc_indicateur_activite)
    const blDepuisFact = toNumber(row.bl_source_activite_plus_factures)
    const blAttendu = blDepuisFact + toNumber(row.bl_indicateur_activite)

    return {
      Année: row.annee,
      Mois: row.mois,
      Statut: computeRowIssues(row).length ? 'KO' : 'OK',
      'Anomalies': computeRowIssues(row).join(', '),

      'Factures lignes': facturesLignes,
      'Factures cache': toNumber(row.factures_cache),
      'Écart factures cache vs lignes': toNumber(row.factures_cache) - facturesLignes,
      'Factures indicateur': toNumber(row.factures_indicateur),
      'Écart factures indicateur vs lignes': toNumber(row.factures_indicateur) - facturesLignes,
      'Factures flux': toNumber(row.factures_flux),
      'Écart factures flux vs lignes': toNumber(row.factures_flux) - facturesLignes,
      'SMC factures': toNumber(row.smc_factures_cache),
      'Écart SMC factures vs indicateur': toNumber(row.ecart_smc_factures_vs_indicateur),

      'Devis lignes': devisLignes,
      'Devis cache': toNumber(row.devis_cache),
      'Écart devis cache vs lignes': toNumber(row.devis_cache) - devisLignes,
      'Devis indicateur': toNumber(row.devis_indicateur),
      'Écart devis indicateur vs lignes': toNumber(row.devis_indicateur) - devisLignes,
      'Devis flux': toNumber(row.devis_flux),
      'Écart devis flux vs lignes': toNumber(row.devis_flux) - devisLignes,
      'SMC devis': toNumber(row.smc_devis_cache),
      'Écart SMC devis vs indicateur': toNumber(row.ecart_smc_devis_vs_indicateur),

      'CDC depuis fact': cdcDepuisFact,
      'CDC depuis activité': toNumber(row.cdc_indicateur_activite),
      'CDC attendu': cdcAttendu,
      'CDC flux': toNumber(row.cdc_flux),
      'Écart CDC attendu vs flux': cdcAttendu - toNumber(row.cdc_flux),

      'BL depuis fact': blDepuisFact,
      'BL depuis activité': toNumber(row.bl_indicateur_activite),
      'BL attendu': blAttendu,
      'BL flux': toNumber(row.bl_flux),
      'Écart BL attendu vs flux': blAttendu - toNumber(row.bl_flux),
    }
  })

  const ws = XLSX.utils.json_to_sheet(exportData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contrôle agrégats')
  XLSX.writeFile(wb, `controle_agregats_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function DataReconciliationPanel() {
  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState('2026-07-01')
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)
  const [runSummary, setRunSummary] = useState<ReconciliationRunSummary | null>(null)

  const summary = useMemo(() => {
    const koRows = rows.filter((row) => computeRowIssues(row).length > 0)
    const facturesKo = rows.filter((row) => {
      const ref = toNumber(row.factures_lignes)
      return (
        absEcart(toNumber(row.factures_cache) - ref) > TOLERANCE ||
        absEcart(toNumber(row.factures_indicateur) - ref) > TOLERANCE ||
        absEcart(toNumber(row.factures_flux) - ref) > TOLERANCE
      )
    }).length

    const devisKo = rows.filter((row) => {
      const ref = toNumber(row.devis_lignes)
      return (
        absEcart(toNumber(row.devis_cache) - ref) > TOLERANCE ||
        absEcart(toNumber(row.devis_indicateur) - ref) > TOLERANCE ||
        absEcart(toNumber(row.devis_flux) - ref) > TOLERANCE
      )
    }).length

    return {
      total: rows.length,
      ko: koRows.length,
      ok: rows.length - koRows.length,
      facturesKo,
      devisKo,
    }
  }, [rows])

  async function loadReconciliation() {
    setLoading(true)
    setError(null)
    setHasRun(true)
    setRunSummary(null)

    try {
      const { data: runData, error: runError } = await supabase.rpc('run_monthly_data_reconciliation', {
        p_date_debut: startDate,
        p_date_fin: endDate,
        p_tolerance: TOLERANCE,
      })

      if (runError) throw runError

      const run = Array.isArray(runData) ? (runData[0] as ReconciliationRunSummary | undefined) : null
      if (!run?.run_id) {
        throw new Error('Contrôle historisé exécuté, mais aucun run_id retourné.')
      }

      // V30 : le contrôle cohérence ne reconstruit plus automatiquement
      // le cache Synthèse multi-clients.
      // Les colonnes SMC affichent donc l'état actuel de synthese_multi_clients_cache,
      // sans déclencher de rebuild potentiellement long / timeout.

      const { error: amountsRefreshError } = await supabase.rpc('refresh_reconciliation_amounts_for_run_v22', {
        p_run_id: run.run_id,
      })
      if (amountsRefreshError) throw amountsRefreshError

      const { data: detailRows, error: detailError } = await supabase
        .from('data_reconciliation_run_rows')
        .select('*')
        .eq('run_id', run.run_id)
        .order('annee', { ascending: true })
        .order('mois', { ascending: true })

      if (detailError) throw detailError

      const mappedRows = ((detailRows || []) as ReconciliationStoredRow[]).map(mapStoredReconciliationRow)
      setRows(mappedRows)

      const koRows = mappedRows.filter((row) => computeRowIssues(row).length > 0)
      const maxAbsEcart = mappedRows.reduce((max, row) => {
        const facturesLignes = toNumber(row.factures_lignes)
        const devisLignes = toNumber(row.devis_lignes)
        const cdcDepuisFact = toNumber(row.cdc_source_activite_plus_factures)
        const cdcAttendu = cdcDepuisFact + toNumber(row.cdc_indicateur_activite)
        const blDepuisFact = toNumber(row.bl_source_activite_plus_factures)
        const blAttendu = blDepuisFact + toNumber(row.bl_indicateur_activite)

        const values = [
          toNumber(row.factures_cache) - facturesLignes,
          toNumber(row.factures_indicateur) - facturesLignes,
          toNumber(row.factures_flux) - facturesLignes,
          toNumber(row.devis_cache) - devisLignes,
          toNumber(row.devis_indicateur) - devisLignes,
          toNumber(row.devis_flux) - devisLignes,
          cdcAttendu - toNumber(row.cdc_flux),
          blAttendu - toNumber(row.bl_flux),
          row.smc_factures_cache !== null && row.smc_factures_cache !== undefined
            ? toNumber(row.ecart_smc_factures_vs_indicateur)
            : 0,
          row.smc_devis_cache !== null && row.smc_devis_cache !== undefined
            ? toNumber(row.ecart_smc_devis_vs_indicateur)
            : 0,
        ]

        return Math.max(max, ...values.map((value) => Math.abs(value)))
      }, 0)

      setRunSummary({
        ...run,
        status: koRows.length ? 'ko' : 'ok',
        checked_months: mappedRows.length,
        ok_months: mappedRows.length - koRows.length,
        ko_months: koRows.length,
        factures_ko: mappedRows.filter((row) => {
          const ref = toNumber(row.factures_lignes)
          return (
            absEcart(toNumber(row.factures_cache) - ref) > TOLERANCE ||
            absEcart(toNumber(row.factures_indicateur) - ref) > TOLERANCE ||
            absEcart(toNumber(row.factures_flux) - ref) > TOLERANCE ||
            absEcart(row.ecart_smc_factures_vs_indicateur) > TOLERANCE
          )
        }).length,
        devis_ko: mappedRows.filter((row) => {
          const ref = toNumber(row.devis_lignes)
          return (
            absEcart(toNumber(row.devis_cache) - ref) > TOLERANCE ||
            absEcart(toNumber(row.devis_indicateur) - ref) > TOLERANCE ||
            absEcart(toNumber(row.devis_flux) - ref) > TOLERANCE ||
            absEcart(row.ecart_smc_devis_vs_indicateur) > TOLERANCE
          )
        }).length,
        max_abs_ecart: maxAbsEcart,
      })
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setRows([])
      setRunSummary(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Contrôle cohérence agrégats</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Compare les lignes sources, les caches, les indicateurs et le flux articles mois par mois.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold uppercase text-slate-500">
            Du
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 block h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
            />
          </label>
          <label className="text-xs font-bold uppercase text-slate-500">
            Au
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 block h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={loadReconciliation}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Contrôle…' : 'Contrôler'}
          </button>
          <button
            type="button"
            onClick={() => exportRows(rows)}
            disabled={!rows.length || loading}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export Excel
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
          Contrôle impossible : {error}
        </div>
      ) : null}

      {runSummary ? (
        <div className={`mt-3 rounded-xl border p-3 text-sm font-bold ${runSummary.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          Contrôle historisé #{runSummary.run_id} — statut {runSummary.status.toUpperCase()} — {runSummary.ok_months} mois OK / {runSummary.ko_months} mois KO — écart max {formatMoney(runSummary.max_abs_ecart)}.
        </div>
      ) : null}

      {hasRun && !error ? (
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase text-slate-500">Périodes contrôlées</div>
            <div className="mt-1 text-xl font-black text-slate-900">{summary.total}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-bold uppercase text-emerald-700">Mois OK</div>
            <div className="mt-1 text-xl font-black text-emerald-800">{summary.ok}</div>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="text-xs font-bold uppercase text-red-700">Mois KO</div>
            <div className="mt-1 text-xl font-black text-red-800">{summary.ko}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-bold uppercase text-amber-700">Factures KO</div>
            <div className="mt-1 text-xl font-black text-amber-800">{summary.facturesKo}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-bold uppercase text-amber-700">Devis KO</div>
            <div className="mt-1 text-xl font-black text-amber-800">{summary.devisKo}</div>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="mt-4 max-h-[560px] overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-[2300px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900 text-white">
              <tr>
                <th className="px-2 py-2 text-left">Période</th>
                <th className="px-2 py-2 text-left">Statut</th>
                <th className="px-2 py-2 text-right">Fact. lignes</th>
                <th className="px-2 py-2 text-right">Fact. cache</th>
                <th className="px-2 py-2 text-right">Fact. indic.</th>
                <th className="px-2 py-2 text-right">Fact. flux</th>
                <th className="px-2 py-2 text-right">Écart flux</th>
                <th className="px-2 py-2 text-right">SMC fact.</th>
                <th className="px-2 py-2 text-right">Écart SMC fact.</th>
                <th className="px-2 py-2 text-right">Devis lignes</th>
                <th className="px-2 py-2 text-right">Devis cache</th>
                <th className="px-2 py-2 text-right">Devis indic.</th>
                <th className="px-2 py-2 text-right">Devis flux</th>
                <th className="px-2 py-2 text-right">Écart flux</th>
                <th className="px-2 py-2 text-right">SMC devis</th>
                <th className="px-2 py-2 text-right">Écart SMC devis</th>
                <th className="px-2 py-2 text-right">CDC depuis fact</th>
                <th className="px-2 py-2 text-right">CDC depuis activité</th>
                <th className="px-2 py-2 text-right">CDC flux</th>
                <th className="px-2 py-2 text-right">Écart CDC</th>
                <th className="px-2 py-2 text-right">BL depuis fact</th>
                <th className="px-2 py-2 text-right">BL depuis activité</th>
                <th className="px-2 py-2 text-right">BL flux</th>
                <th className="px-2 py-2 text-right">Écart BL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const issues = computeRowIssues(row)
                const facturesLignes = toNumber(row.factures_lignes)
                const devisLignes = toNumber(row.devis_lignes)
                const cdcDepuisFact = toNumber(row.cdc_source_activite_plus_factures)
                const cdcAttendu = cdcDepuisFact + toNumber(row.cdc_indicateur_activite)
                const blDepuisFact = toNumber(row.bl_source_activite_plus_factures)
                const blAttendu = blDepuisFact + toNumber(row.bl_indicateur_activite)

                return (
                  <tr key={`${row.annee}-${row.mois}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-2 py-2 font-black">{monthLabel(row)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-black ${
                          issues.length ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                        title={issues.join(', ') || 'Tous les contrôles sont alignés'}
                      >
                        {issues.length ? `KO (${issues.length})` : 'OK'}
                      </span>
                    </td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(facturesLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(facturesLignes, row.factures_cache)}`}>{formatMoney(row.factures_cache)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(facturesLignes, row.factures_indicateur)}`}>{formatMoney(row.factures_indicateur)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(facturesLignes, row.factures_flux)}`}>{formatMoney(row.factures_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(toNumber(row.factures_flux) - facturesLignes)}`}>{formatSigned(toNumber(row.factures_flux) - facturesLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(row.factures_indicateur, row.smc_factures_cache)}`}>
                      {formatMoney(row.smc_factures_cache)}
                    </td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_smc_factures_vs_indicateur)}`}>
                      {formatSigned(row.ecart_smc_factures_vs_indicateur)}
                    </td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(devisLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_cache)}`}>{formatMoney(row.devis_cache)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_indicateur)}`}>{formatMoney(row.devis_indicateur)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_flux)}`}>{formatMoney(row.devis_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(toNumber(row.devis_flux) - devisLignes)}`}>{formatSigned(toNumber(row.devis_flux) - devisLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(row.devis_indicateur, row.smc_devis_cache)}`}>
                      {formatMoney(row.smc_devis_cache)}
                    </td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_smc_devis_vs_indicateur)}`}>
                      {formatSigned(row.ecart_smc_devis_vs_indicateur)}
                    </td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(cdcDepuisFact)}</td>
                    <td className="px-2 py-2 text-right font-bold">{formatMoney(row.cdc_indicateur_activite)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_cdc_source_vs_flux)}`}>{formatMoney(row.cdc_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_cdc_source_vs_flux)}`}>{formatSigned(row.ecart_cdc_source_vs_flux)}</td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(blDepuisFact)}</td>
                    <td className="px-2 py-2 text-right font-bold">{formatMoney(row.bl_indicateur_activite)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_bl_source_vs_flux)}`}>{formatMoney(row.bl_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_bl_source_vs_flux)}`}>{formatSigned(row.ecart_bl_source_vs_flux)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : hasRun && !loading && !error ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
          Aucun résultat retourné pour cette période.
        </div>
      ) : null}
    </div>
  )
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
  const [pendingReferentialImport, setPendingReferentialImport] = useState<PendingReferentialImport | null>(null)

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

      const orderColumn = isLineTableKey(config.key)
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
    setPendingReferentialImport(null)
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

  function formatDateForSql(date: Date) {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  type RpcPeriod = {
    p_date_debut: string
    p_date_fin: string
    label: string
  }

  function getMonthlyPeriodsBetween(startDate: Date, endDate: Date): RpcPeriod[] {
    const periods: RpcPeriod[] = []
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    const limit = new Date(endDate.getFullYear(), endDate.getMonth(), 1)

    while (cursor < limit) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      periods.push({
        p_date_debut: formatDateForSql(cursor),
        p_date_fin: formatDateForSql(next),
        label: `${formatDateForSql(cursor)} → ${formatDateForSql(next)}`,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }

    return periods
  }

  function getMonthlyAggregatePeriods(monthCount: 2 | 3 = 3) {
    const now = new Date()
    // Rebuild volontairement limité à 2 ou 3 périodes mensuelles pour éviter les timeouts.
    // Par défaut : M-2 → M-1, M-1 → M, M → M+1, donc mois courant inclus.
    const safeMonthCount = monthCount === 2 ? 2 : 3
    const start = new Date(now.getFullYear(), now.getMonth() - (safeMonthCount - 1), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return getMonthlyPeriodsBetween(start, end)
  }

  function getFullMonthlyPeriodsFrom2023() {
    const now = new Date()
    const start = new Date(2023, 0, 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return getMonthlyPeriodsBetween(start, end)
  }

  async function runRpcForPeriods(
    functionName: string,
    periods: RpcPeriod[],
    onProgress?: (detail: string) => void,
    label = functionName
  ) {
    for (const period of periods) {
      onProgress?.(`${label} : ${period.label}`)
      const { error } = await supabase.rpc(functionName, {
        p_date_debut: period.p_date_debut,
        p_date_fin: period.p_date_fin,
      })
      if (error) throw new Error(`${functionName} ${period.label} : ${error.message}`)
    }
  }

  async function updateQuantitesPertinentesAgregats(
    range: { p_date_debut: string; p_date_fin: string },
    onProgress?: (detail: string) => void
  ) {
    onProgress?.(`Mise à jour quantités pertinentes du ${range.p_date_debut} au ${range.p_date_fin}`)
    const { error } = await supabase.rpc('update_quantites_pertinentes_agregats', range)
    if (error) throw new Error(`update_quantites_pertinentes_agregats : ${error.message}`)
  }

  async function updateQuantitesPertinentesAgregatsPeriodes(
    periods: RpcPeriod[],
    onProgress?: (detail: string) => void
  ) {
    for (const period of periods) {
      await updateQuantitesPertinentesAgregats(
        { p_date_debut: period.p_date_debut, p_date_fin: period.p_date_fin },
        onProgress
      )
    }
  }

  function getMonthlyPeriodsCoveringDateInputs(startIso: string, endIso: string) {
    if (!startIso || !endIso) throw new Error('Merci de renseigner une date de début et une date de fin.')
    const startParts = startIso.split('-').map(Number)
    const endParts = endIso.split('-').map(Number)
    if (startParts.length !== 3 || endParts.length !== 3) throw new Error('Période invalide.')

    const start = new Date(startParts[0], startParts[1] - 1, 1)
    const endInput = new Date(endParts[0], endParts[1] - 1, endParts[2] || 1)

    if (Number.isNaN(start.getTime()) || Number.isNaN(endInput.getTime())) throw new Error('Période invalide.')
    if (endInput < start) throw new Error('La date de fin doit être supérieure ou égale à la date de début.')

    // Date fin traitée comme mois inclus : 2026-06-15 inclut juin, donc fin technique = 2026-07-01.
    const end = new Date(endInput.getFullYear(), endInput.getMonth() + 1, 1)
    return getMonthlyPeriodsBetween(start, end)
  }

  async function runCompleteRebuildForPeriods(
    periods: RpcPeriod[],
    onProgress?: (detail: string) => void
  ) {
    await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, onProgress, 'Cache factures')
    await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, onProgress, 'Agrégat factures')

    await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, onProgress, 'Cache devis')
    await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, onProgress, 'Agrégat devis')

    await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, onProgress, 'Agrégat activité')
    await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', periods, onProgress, 'Flux articles')
    await runSmcCacheForPeriodsBatchesV28(periods, onProgress, 'Synthèse multi-clients')
  }

  async function runPostImportRefresh(config: TableConfig, onProgress?: (detail: string) => void) {
    // Règle V21 : après import, on réactualise uniquement M-1 et M.
    const monthlyPeriods = getMonthlyAggregatePeriods(2)

    if (config.key === 'facture_lignes') {
      await runRpcForPeriods(
        'refresh_facture_entetes_cache_periode',
        monthlyPeriods,
        onProgress,
        'Rafraîchissement cache factures mois par mois'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_factures_mensuel_periode',
        monthlyPeriods,
        onProgress,
        'Rebuild indicateur factures mois par mois'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_flux_articles_mensuel_periode',
        monthlyPeriods,
        onProgress,
        'Rebuild flux articles mois par mois'
      )

      await runSmcCacheForPeriodsBatchesV28(monthlyPeriods, onProgress, 'Rebuild synthèse multi-clients ciblée')

      return 'Cache factures, indicateur factures, flux articles et synthèse multi-clients recalculés mois par mois'
    }

    if (config.key === 'devis_lignes') {
      await runRpcForPeriods(
        'refresh_devis_entetes_cache_periode',
        monthlyPeriods,
        onProgress,
        'Rafraîchissement cache devis mois par mois'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_devis_mensuel_periode',
        monthlyPeriods,
        onProgress,
        'Rebuild indicateur devis mois par mois'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_flux_articles_mensuel_periode',
        monthlyPeriods,
        onProgress,
        'Rebuild flux articles mois par mois'
      )

      await runSmcCacheForPeriodsBatchesV28(monthlyPeriods, onProgress, 'Rebuild synthèse multi-clients ciblée')

      return 'Cache devis, indicateur devis, flux articles et synthèse multi-clients recalculés mois par mois'
    }

    if (config.key === 'activite_lignes') {
      await runRpcForPeriods(
        'rebuild_indicateur_activite_mensuel_periode',
        monthlyPeriods,
        onProgress,
        'Rebuild indicateur activité mois par mois'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_flux_articles_mensuel_periode',
        monthlyPeriods,
        onProgress,
        'Rebuild flux articles mois par mois'
      )

      await runSmcCacheForPeriodsBatchesV28(monthlyPeriods, onProgress, 'Rebuild synthèse multi-clients ciblée')

      return 'Indicateur activité, flux articles et synthèse multi-clients recalculés mois par mois'
    }

    if (config.key === 'ref_familles') {
      return 'Référentiel familles mis à jour. Utilise le bouton « Recalcul qté pertinentes période » pour appliquer la nouvelle règle sur une période choisie.'
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


  function collectReferencedArticles(rows: GenericRow[]) {
    const articlesByReference = new Map<string, GenericRow>()

    rows.forEach((row) => {
      const referenceArticle = String(row.reference_article ?? '').trim()

      // Important : une chaîne vide n'est pas NULL pour Postgres.
      // On force donc les références vides à NULL pour éviter une violation de FK sur ''.
      row.reference_article = referenceArticle || null

      if (!referenceArticle) return

      const designation = String(row.designation ?? '').trim() || referenceArticle
      const existing = articlesByReference.get(referenceArticle)

      // On conserve la désignation la plus informative si la même référence apparaît plusieurs fois.
      if (!existing || designation.length > String(existing.designation || '').length) {
        articlesByReference.set(referenceArticle, {
          reference_article: referenceArticle,
          designation,
          famille: null,
          hors_statistique: false,
        })
      }
    })

    return Array.from(articlesByReference.values())
  }


  async function ensureReferencedArticles(
    rows: GenericRow[],
    config: TableConfig,
    onProgress?: (detail: string) => void
  ) {
    if (!isLineTableKey(config.key) || !rows.length) {
      return { checked: 0, created: 0, skipped: true }
    }

    const articles = collectReferencedArticles(rows)
    if (!articles.length) {
      onProgress?.('Aucun article à synchroniser')
      return { checked: 0, created: 0, skipped: false }
    }

    const existingRefs = new Set<string>()
    const referenceChunks = chunkArray(
      articles.map((article) => String(article.reference_article || '').trim()).filter(Boolean),
      REF_INSERT_CHUNK_SIZE
    )

    for (let i = 0; i < referenceChunks.length; i += 1) {
      const chunk = referenceChunks[i]
      onProgress?.(`Contrôle articles ${i + 1}/${referenceChunks.length} (${chunk.length} référence(s))`)

      const { data, error } = await supabase
        .from('ref_articles')
        .select('reference_article')
        .in('reference_article', chunk)
        .limit(10000)

      if (error) {
        throw new Error(`Contrôle du référentiel articles impossible : ${error.message}`)
      }

      ;((data || []) as GenericRow[]).forEach((article) => {
        const referenceArticle = String(article.reference_article ?? '').trim()
        if (referenceArticle) existingRefs.add(referenceArticle)
      })
    }

    const missingArticles = articles.filter((article) => {
      const referenceArticle = String(article.reference_article ?? '').trim()
      return referenceArticle && !existingRefs.has(referenceArticle)
    })

    if (!missingArticles.length) {
      return { checked: articles.length, created: 0, skipped: false }
    }

    const chunks = chunkArray(missingArticles, REF_INSERT_CHUNK_SIZE)
    let created = 0

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      onProgress?.(`Création articles manquants ${i + 1}/${chunks.length} (${chunk.length} article(s))`)

      const { error } = await supabase
        .from('ref_articles')
        .upsert(chunk, { onConflict: 'reference_article', ignoreDuplicates: true })

      if (error) {
        throw new Error(
          `Création automatique des articles manquants impossible : ${error.message}. ` +
            `Vérifie que ref_articles contient les colonnes reference_article, designation, famille et hors_statistique, ` +
            `et que reference_article est unique.`
        )
      }

      created += chunk.length
    }

    return { checked: articles.length, created, skipped: false }
  }



  function collectReferencedCodeNaf(rows: GenericRow[]) {
    const codes = new Set<string>()

    rows.forEach((row) => {
      const normalizedCodeNaf = normalizeCodeNaf(row.code_naf)
      row.code_naf = normalizedCodeNaf
      if (normalizedCodeNaf) codes.add(normalizedCodeNaf)
    })

    return Array.from(codes)
  }

  async function ensureReferencedCodeNaf(
    rows: GenericRow[],
    config: TableConfig,
    onProgress?: (detail: string) => void
  ) {
    if (config.key !== 'ref_tiers' || !rows.length) {
      return { upserted: 0, skipped: true, checked: 0 }
    }

    const codesNaf = collectReferencedCodeNaf(rows)
    if (!codesNaf.length) {
      onProgress?.('Aucun code NAF à contrôler')
      return { upserted: 0, skipped: false, checked: 0 }
    }

    const existingCodes = new Set<string>()
    const chunks = chunkArray(codesNaf, REF_INSERT_CHUNK_SIZE)

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      onProgress?.(`Contrôle codes NAF ${i + 1}/${chunks.length} (${chunk.length} code(s))`)

      const { data, error } = await supabase
        .from('ref_code_naf')
        .select('code_naf')
        .in('code_naf', chunk)
        .limit(10000)

      if (error) {
        throw new Error(`Contrôle du référentiel codes NAF impossible : ${error.message}`)
      }

      ;((data || []) as GenericRow[]).forEach((row) => {
        const code = normalizeCodeNaf(row.code_naf)
        if (code) existingCodes.add(code)
      })
    }

    const missingCodes = codesNaf.filter((code) => !existingCodes.has(code))
    if (!missingCodes.length) {
      return { upserted: 0, skipped: false, checked: codesNaf.length }
    }

    const nowIso = new Date().toISOString()
    const rowsToCreate = missingCodes.map((code) => ({
      code_naf: code,
      libelle_naf: `Code NAF ${code}`,
      contenu_correspondance: null,
      updated_at: nowIso,
    }))

    const createChunks = chunkArray(rowsToCreate, REF_INSERT_CHUNK_SIZE)
    let upserted = 0

    for (let i = 0; i < createChunks.length; i += 1) {
      const chunk = createChunks[i]
      onProgress?.(`Création codes NAF manquants ${i + 1}/${createChunks.length} (${chunk.length} code(s))`)

      const { error } = await supabase
        .from('ref_code_naf')
        .upsert(chunk, { onConflict: 'code_naf', ignoreDuplicates: true })

      if (error) {
        throw new Error(
          `Création automatique des codes NAF manquants impossible : ${error.message}. ` +
            `Charge d'abord le référentiel Codes NAF ou vérifie les colonnes code_naf/libelle_naf dans ref_code_naf.`
        )
      }

      upserted += chunk.length
    }

    return { upserted, skipped: false, checked: codesNaf.length }
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
        : config.key === 'devis_lignes'
          ? 'ligne_hash,ligne_hash_metier,numero_piece,date_devis,reference_article,source_import,imported_at'
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

      if (['facture_lignes', 'devis_lignes'].includes(config.key)) {
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
        .map((row) => String(['facture_lignes', 'devis_lignes'].includes(config.key) ? row.ligne_hash_metier || row.ligne_hash : row.ligne_hash || '').trim())
        .filter(Boolean)
    )

    // Fallback sécurisé : si des anciennes lignes n'ont pas encore de ligne_hash_metier,
    // on contrôle seulement les numéros de pièces du fichier, par petits lots, avec les colonnes minimales.
    const missingHashRows = importRows.filter((row) => {
      const hash = String(['facture_lignes', 'devis_lignes'].includes(config.key) ? row.ligne_hash_metier || row.ligne_hash : row.ligne_hash || '').trim()
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

      const metierHash = String(['facture_lignes', 'devis_lignes'].includes(config.key) ? row.ligne_hash_metier || row.ligne_hash : row.ligne_hash || '').trim()
      const alreadyExistsByHash = metierHash ? existingHashes.has(metierHash) : false
      const existingCount = existingCounts.get(signature) || 0

      if (alreadyExistsByHash || currentOccurrence <= existingCount) {
        const existing = existingInfoBySignature.get(signature) || existingHashRows.find((r) => {
          const existingHash = String(['facture_lignes', 'devis_lignes'].includes(config.key) ? r.ligne_hash_metier || r.ligne_hash : r.ligne_hash || '').trim()
          return existingHash && existingHash === metierHash
        })

        duplicateRejects.push(
          `Ligne ${index + 2} rejetée : document déjà présent en base ` +
            `(N° ${row.numero_piece || 'NC'}, date ${row.date_facture || row.date_devis || row.date_piece || 'NC'}, article ${row.reference_article || 'NC'}). ` +
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
      p_enable: enabled,
    })

    if (error) {
      throw new Error(
        `Pilotage des triggers impossible sur ${config.key} : ${error.message}. ` +
          `Crée ou vérifie la fonction SQL public.set_import_user_triggers(boolean, text).`
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
              `(N° ${row.numero_piece || 'NC'}, date ${row.date_facture || row.date_devis || row.date_piece || 'NC'}, article ${row.reference_article || 'NC'})`
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

  async function prepareReferentialImportReview(
    importRows: GenericRow[],
    config: TableConfig,
    onProgress?: (detail: string) => void
  ) {
    if (!shouldReviewExistingRecords(config.key) || !importRows.length) {
      return {
        rowsWithoutConflicts: importRows,
        conflicts: [] as ReferentialConflict[],
        identicalIgnored: 0,
      }
    }

    const keys = uniqueStrings(importRows.map((row) => row[config.primaryKey]))
    const existingByKey = new Map<string, GenericRow>()
    const chunks = chunkArray(keys, REF_INSERT_CHUNK_SIZE)

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      onProgress?.(`Recherche existants ${i + 1}/${chunks.length} (${chunk.length} clé(s))`)

      const { data, error } = await supabase
        .from(config.key)
        .select('*')
        .in(config.primaryKey, chunk)
        .limit(10000)

      if (error) {
        throw new Error(`Contrôle des enregistrements existants impossible sur ${config.label} : ${error.message}`)
      }

      ;((data || []) as GenericRow[]).forEach((row) => {
        const key = String(row[config.primaryKey] ?? '').trim()
        if (key) existingByKey.set(key, row)
      })
    }

    const rowsWithoutConflicts: GenericRow[] = []
    const conflicts: ReferentialConflict[] = []
    let identicalIgnored = 0

    importRows.forEach((row) => {
      const primaryKeyValue = String(row[config.primaryKey] ?? '').trim()
      const existing = existingByKey.get(primaryKeyValue)

      if (!existing) {
        rowsWithoutConflicts.push(row)
        return
      }

      const rowForImport = buildImportedRowForExistingRecord(row, existing, config)
      const differences = getImportedDifferences(rowForImport, existing, config)

      if (!differences.length) {
        identicalIgnored += 1
        return
      }

      conflicts.push({
        tableKey: config.key,
        primaryKeyValue,
        displayLabel: displayLabelForImportedRow(rowForImport, config),
        existingRow: existing,
        importedRow: rowForImport,
        differences,
        selected: false,
      })
    })

    return { rowsWithoutConflicts, conflicts, identicalIgnored }
  }

  async function executeValidatedImportRows(
    config: TableConfig,
    rowsReadyToImport: GenericRow[],
    technicalMessages: string[],
    options?: {
      identicalIgnored?: number
      conflictsIgnored?: number
      conflictsOverwritten?: number
    }
  ) {
    const inputRows = rowsReadyToImport

    if (!inputRows.length) {
      updateImportStep('reset', 'done', 'Aucun nettoyage requis')
      updateImportStep('tiers', 'done', 'Aucun tiers à synchroniser')
      updateImportStep('articles', 'done', 'Aucun article à synchroniser')
      updateImportStep('duplicates', 'done', 'Aucune ligne à contrôler')
      updateImportStep('insert', 'done', 'Aucune ligne à insérer')
      updateImportStep('refresh', 'done', 'Aucun refresh nécessaire')
      updateImportStep('reload', 'running', 'Actualisation des statistiques et de l’aperçu')
      await loadStats()
      await loadRows(config)
      updateImportStep('reload', 'done', 'Écran actualisé')

      setLastRejects(technicalMessages.map((message) => ({ type: 'Information import', message })))
      setMessage(
        `0 ligne importée dans ${config.label}. ` +
          `${options?.identicalIgnored || 0} enregistrement(s) identique(s) ignoré(s). ` +
          `${options?.conflictsIgnored || 0} conflit(s) ignoré(s).`
      )
      if (technicalMessages.length) setError(technicalMessages.slice(0, 30).join('\n'))
      return
    }

    if (config.key === 'activite_lignes') {
      updateImportStep('reset', 'running', 'Vidage activité avant rechargement complet')
      await resetActivityTablesBeforeImport((detail) => updateImportStep('reset', 'running', detail))
      updateImportStep('reset', 'done', 'activite_lignes et indicateur_activite_mensuel vidées')
    } else {
      updateImportStep('reset', 'done', 'Étape non requise pour cette table')
    }

    updateImportStep(
      'tiers',
      'running',
      config.key === 'ref_tiers'
        ? 'Contrôle des codes NAF référencés avant insertion'
        : 'Synchronisation des tiers utilisés par le fichier avant insertion'
    )
    const tiersResult = await ensureReferencedTiers(
      inputRows,
      config,
      (detail) => updateImportStep('tiers', 'running', detail)
    )
    const codeNafResult = await ensureReferencedCodeNaf(
      inputRows,
      config,
      (detail) => updateImportStep('tiers', 'running', detail)
    )

    const referenceMessages = [
      !tiersResult.skipped ? `${tiersResult.upserted} tiers synchronisé(s) dans ref_tiers` : null,
      !codeNafResult.skipped
        ? `${codeNafResult.checked} code(s) NAF contrôlé(s), ${codeNafResult.upserted} créé(s) dans ref_code_naf`
        : null,
    ].filter(Boolean)

    updateImportStep(
      'tiers',
      'done',
      referenceMessages.length ? referenceMessages.join(' / ') : 'Étape non requise pour cette table'
    )

    updateImportStep(
      'articles',
      'running',
      isLineTableKey(config.key)
        ? 'Synchronisation des articles utilisés par le fichier avant insertion'
        : 'Étape non requise pour cette table'
    )
    const articlesResult = await ensureReferencedArticles(
      inputRows,
      config,
      (detail) => updateImportStep('articles', 'running', detail)
    )
    updateImportStep(
      'articles',
      'done',
      !articlesResult.skipped
        ? `${articlesResult.checked} article(s) contrôlé(s), ${articlesResult.created} créé(s) dans ref_articles`
        : 'Étape non requise pour cette table'
    )

    let rowsToInsert = inputRows
    let duplicateRejects: string[] = []

    if (config.key === 'activite_lignes') {
      updateImportStep(
        'duplicates',
        'done',
        'Contrôle des doublons en base ignoré : l’import activité vide activite_lignes et indicateur_activite_mensuel avant chargement'
      )
    } else {
      updateImportStep('duplicates', 'running', 'Recherche des lignes déjà présentes en base')
      const duplicateResult = await findExistingLineDuplicates(
        inputRows,
        config,
        (detail) => updateImportStep('duplicates', 'running', detail)
      )
      rowsToInsert = duplicateResult.rowsToInsert
      duplicateRejects = duplicateResult.duplicateRejects
      updateImportStep('duplicates', 'done', `${duplicateRejects.length} ligne(s) déjà présente(s) rejetée(s), ${rowsToInsert.length} ligne(s) à importer`)
    }

    if (!rowsToInsert.length) {
      const allMessages = [...technicalMessages, ...duplicateRejects]
      setLastRejects(allMessages.map((message) => ({ type: 'Rejet import', message })))
      setMessage(`0 ligne importée dans ${config.label}. Toutes les lignes valides étaient déjà présentes en base ou ont été ignorées.`)
      if (allMessages.length) setError(allMessages.slice(0, 30).join('\n'))
      updateImportStep('insert', 'done', '0 ligne insérée')
      updateImportStep('refresh', 'done', 'Aucun refresh nécessaire')
      updateImportStep('reload', 'running', 'Actualisation des statistiques et de l’aperçu')
      await loadStats()
      await loadRows(config)
      updateImportStep('reload', 'done', 'Écran actualisé')
      return
    }

    const chunkSize = isLineTableKey(config.key) ? LINE_INSERT_CHUNK_SIZE : REF_INSERT_CHUNK_SIZE
    const chunks = chunkArray(rowsToInsert, chunkSize)
    let imported = 0
    let triggersDisabled = false

    updateImportStep('insert', 'running', `Préparation insertion : ${rowsToInsert.length} ligne(s), lots de ${chunkSize}`)

    try {
      if (isLineTableKey(config.key)) {
        updateImportStep('insert', 'running', `Désactivation temporaire des triggers sur ${config.key}`)
        await setImportTriggersEnabled(config, false)
        triggersDisabled = true
      }

      updateImportStep('insert', 'running', `0/${rowsToInsert.length} ligne(s) insérée(s)`)
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]
        imported += await writeRowsWithRetry(chunk, config, (detail) => {
          updateImportStep('insert', 'running', `${imported}/${rowsToInsert.length} — ${detail}`)
        })
        updateImportStep('insert', 'running', `${imported}/${rowsToInsert.length} ligne(s) insérée(s) — lot ${i + 1}/${chunks.length}`)
      }
    } finally {
      if (triggersDisabled) {
        updateImportStep('insert', 'running', `Réactivation des triggers sur ${config.key}`)
        await setImportTriggersEnabled(config, true)
      }
    }

    updateImportStep('insert', 'done', `${imported} ligne(s) insérée(s).${isLineTableKey(config.key) ? ' Triggers réactivés.' : ''}`)

    updateImportStep('refresh', 'running', 'Mise à jour des caches et agrégats')
    const refreshMessage = await runPostImportRefresh(config, (detail) => updateImportStep('refresh', 'running', detail))
    updateImportStep('refresh', 'done', refreshMessage)

    const allMessages = [...technicalMessages, ...duplicateRejects]
    setLastRejects(allMessages.map((message) => ({ type: 'Information import', message })))

    const extraSummary = [
      options?.identicalIgnored ? `${options.identicalIgnored} identique(s) ignoré(s)` : null,
      options?.conflictsOverwritten ? `${options.conflictsOverwritten} conflit(s) écrasé(s)` : null,
      options?.conflictsIgnored ? `${options.conflictsIgnored} conflit(s) ignoré(s)` : null,
    ].filter(Boolean).join('. ')

    setMessage(
      `${imported} ligne(s) importée(s) dans ${config.label}. ` +
        `${duplicateRejects.length} ligne(s) déjà présente(s) en base rejetée(s).` +
        (extraSummary ? ` ${extraSummary}.` : '')
    )
    if (allMessages.length) setError(allMessages.slice(0, 20).join('\n'))

    updateImportStep('reload', 'running', 'Actualisation des statistiques et de l’aperçu')
    await loadStats()
    await loadRows(config)
    updateImportStep('reload', 'done', 'Écran actualisé')
  }

  function togglePendingConflict(primaryKeyValue: string, selected: boolean) {
    setPendingReferentialImport((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        conflicts: prev.conflicts.map((conflict) =>
          conflict.primaryKeyValue === primaryKeyValue ? { ...conflict, selected } : conflict
        ),
      }
    })
  }

  function setAllPendingConflicts(selected: boolean) {
    setPendingReferentialImport((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        conflicts: prev.conflicts.map((conflict) => ({ ...conflict, selected })),
      }
    })
  }

  async function confirmPendingReferentialImport() {
    if (!pendingReferentialImport) return

    const pending = pendingReferentialImport
    const config = TABLES.find((table) => table.key === pending.configKey)
    if (!config) return

    const selectedConflicts = pending.conflicts.filter((conflict) => conflict.selected)
    const ignoredConflicts = pending.conflicts.length - selectedConflicts.length
    const rowsToImport = [
      ...pending.rowsWithoutConflicts,
      ...selectedConflicts.map((conflict) => conflict.importedRow),
    ]

    setPendingReferentialImport(null)
    setImporting(true)
    setMessage(null)
    setError(null)
    setLastRejects([])
    resetImportProgress()

    try {
      updateImportStep('read', 'done', `${pending.fileName} — fichier déjà analysé`)
      updateImportStep('normalize', 'done', 'Mapping déjà effectué')
      updateImportStep('validate', 'done', `${rowsToImport.length} ligne(s) à importer après arbitrage`)

      await executeValidatedImportRows(config, rowsToImport, pending.technicalMessages, {
        identicalIgnored: pending.identicalIgnored,
        conflictsIgnored: ignoredConflicts,
        conflictsOverwritten: selectedConflicts.length,
      })
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

  async function handleFileImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!confirmFileNameMatchesImport(file, selectedConfig)) {
      setMessage(null)
      setPendingReferentialImport(null)
      setError(`Import annulé : le nom du fichier « ${file.name} » ne correspond pas à l’import ${selectedConfig.label}.`)
      return
    }

    setImporting(true)
    setMessage(null)
    setError(null)
    setLastRejects([])
    setPendingReferentialImport(null)
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

      const technicalMessages = [...parseErrors, ...errors, ...duplicates]

      if (!deduplicatedRows.length) {
        await executeValidatedImportRows(selectedConfig, [], technicalMessages)
        setError(errors.slice(0, 10).join('\n') || 'Aucune ligne valide à importer.')
        return
      }

      if (shouldReviewExistingRecords(selectedConfig.key)) {
        updateImportStep('duplicates', 'running', 'Contrôle des enregistrements existants et des différences de champs')
        const review = await prepareReferentialImportReview(
          deduplicatedRows,
          selectedConfig,
          (detail) => updateImportStep('duplicates', 'running', detail)
        )

        if (review.conflicts.length) {
          updateImportStep(
            'duplicates',
            'done',
            `${review.conflicts.length} enregistrement(s) existant(s) avec différences à arbitrer, ${review.identicalIgnored} identique(s) ignoré(s)`
          )
          updateImportStep('insert', 'pending', 'Import en attente de validation utilisateur')

          setPendingReferentialImport({
            configKey: selectedConfig.key,
            configLabel: selectedConfig.label,
            fileName: file.name,
            rowsWithoutConflicts: review.rowsWithoutConflicts,
            conflicts: review.conflicts,
            technicalMessages,
            identicalIgnored: review.identicalIgnored,
          })

          setMessage(
            `${review.rowsWithoutConflicts.length} nouvel(aux) enregistrement(s) prêt(s) à importer. ` +
              `${review.conflicts.length} conflit(s) à arbitrer ci-dessous. ` +
              `${review.identicalIgnored} enregistrement(s) strictement identique(s) ignoré(s).`
          )
          if (technicalMessages.length) setError(technicalMessages.slice(0, 20).join('\n'))
          return
        }

        updateImportStep(
          'duplicates',
          'done',
          `${review.identicalIgnored} enregistrement(s) identique(s) ignoré(s), aucun conflit à arbitrer`
        )

        await executeValidatedImportRows(selectedConfig, review.rowsWithoutConflicts, technicalMessages, {
          identicalIgnored: review.identicalIgnored,
        })
        return
      }

      await executeValidatedImportRows(selectedConfig, deduplicatedRows, technicalMessages)
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
      if (['facture_lignes', 'devis_lignes'].includes(selectedConfig.key) && !rowToSave.ligne_hash_metier) {
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

      const monthlyPeriods = getMonthlyAggregatePeriods()

      if (selectedConfig.key === 'facture_lignes') {
        await runRpcForPeriods('refresh_facture_entetes_cache_periode', monthlyPeriods)
        await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', monthlyPeriods)
        await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', monthlyPeriods)
      }
      if (selectedConfig.key === 'devis_lignes') {
        await runRpcForPeriods('refresh_devis_entetes_cache_periode', monthlyPeriods)
        await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', monthlyPeriods)
        await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', monthlyPeriods)
      }
      if (selectedConfig.key === 'activite_lignes') {
        await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', monthlyPeriods)
        await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', monthlyPeriods)
      }
      if (selectedConfig.key === 'ref_familles') {
        // Les quantités pertinentes se recalculent désormais via le bouton période dédié.
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


  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null)
  const [manualStartDate, setManualStartDate] = useState(() => {
    const now = new Date()
    return formatDateForSql(new Date(now.getFullYear(), now.getMonth() - 2, 1))
  })
  const [manualEndDate, setManualEndDate] = useState(() => {
    const now = new Date()
    return formatDateForSql(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  })

  async function runRecentMonthsRebuild(_monthCount: 2 | 3 = 2, onProgress?: (detail: string) => void) {
    // Règle V21 : les rebuilds standards ne recalculent que M-1 et M.
    // Les périodes plus longues passent par le bloc manuel "Rebuild période".
    const periods = getMonthlyAggregatePeriods(2)

    await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, onProgress, 'Cache factures')
    await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, onProgress, 'Agrégat factures')

    await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, onProgress, 'Cache devis')
    await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, onProgress, 'Agrégat devis / vue')

    await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, onProgress, 'Agrégat activité')
    await runRpcForPeriods('rebuild_indicateur_flux_articles_mensuel_periode', periods, onProgress, 'Flux articles')
    await runSmcCacheForPeriodsBatchesV28(periods, onProgress, 'Synthèse multi-clients')
  }

  async function handleManualRecentMonthsRebuild(monthCount: 2 | 3 = 3, blMxMode?: 'previous_month' | 'current_month') {
    if (maintenanceLoading || importing) return

    const confirmText = blMxMode
      ? `Confirmer le basculement BL M-x en mode ${blMxMode === 'previous_month' ? 'mois précédent' : 'mois courant'} sans rebuild complet ?`
      : `Confirmer le rebuild des agrégats des ${monthCount} derniers mois, mois par mois ?`

    if (!window.confirm(confirmText)) return

    setMaintenanceLoading(true)
    setMaintenanceMessage(`Préparation du rebuild ${monthCount} mois…`)
    setError(null)

    try {
      if (blMxMode) {
        setMaintenanceMessage(`Application BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} sur l’agrégat activité…`)
        const { error: modeError } = await supabase.rpc('set_bl_mx_mode', { p_mode: blMxMode })
        if (modeError) throw new Error(`set_bl_mx_mode : ${modeError.message}`)

        const { error: applyError } = await supabase.rpc('apply_bl_mx_month_mode_activite', {
          p_mode: blMxMode,
          p_months_back: monthCount,
        })
        if (applyError) throw new Error(`apply_bl_mx_month_mode_activite : ${applyError.message}`)

        const periods = getMonthlyAggregatePeriods(2)
        await runRpcForPeriods(
          'rebuild_indicateur_flux_articles_mensuel_periode',
          periods,
          (detail) => setMaintenanceMessage(detail),
          'Flux articles après BL M-x'
        )
        await runSmcCacheForPeriodsBatchesV28(periods, (detail) => setMaintenanceMessage(detail), 'Synthèse multi-clients après BL M-x')

        setMaintenanceMessage(`BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} appliqué. Flux articles et synthèse multi-clients recalculés sur M-1/M.`)
        await loadStats()
        await loadRows(selectedConfig)
        return
      }

      await runRecentMonthsRebuild(monthCount, (detail) => setMaintenanceMessage(detail))
      setMaintenanceMessage('Rebuild M-1/M terminé. Agrégats, flux articles et synthèse multi-clients recalculés.')
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  async function handleManualPeriodRebuild() {
    if (maintenanceLoading || importing) return

    try {
      const periods = getMonthlyPeriodsCoveringDateInputs(manualStartDate, manualEndDate)
      if (!periods.length) throw new Error('Aucune période mensuelle à recalculer.')

      if (!window.confirm(`Confirmer le rebuild complet de ${periods.length} mois, du ${manualStartDate} au ${manualEndDate} ?`)) return

      setMaintenanceLoading(true)
      setMaintenanceMessage(`Préparation du rebuild période ${manualStartDate} → ${manualEndDate}…`)
      setError(null)

      await runCompleteRebuildForPeriods(periods, (detail) => setMaintenanceMessage(detail))
      setMaintenanceMessage(`Rebuild période terminé : ${manualStartDate} → ${manualEndDate}.`)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  async function handleManualPeriodQuantitesPertinentes() {
    if (maintenanceLoading || importing) return

    try {
      const periods = getMonthlyPeriodsCoveringDateInputs(manualStartDate, manualEndDate)
      if (!periods.length) throw new Error('Aucune période mensuelle à recalculer.')

      if (!window.confirm(`Confirmer le recalcul des quantités pertinentes de ${periods.length} mois, du ${manualStartDate} au ${manualEndDate} ?`)) return

      setMaintenanceLoading(true)
      setMaintenanceMessage(`Préparation recalcul qté pertinentes ${manualStartDate} → ${manualEndDate}…`)
      setError(null)

      await updateQuantitesPertinentesAgregatsPeriodes(periods, (detail) => setMaintenanceMessage(detail))
      setMaintenanceMessage(`Recalcul des quantités pertinentes terminé : ${manualStartDate} → ${manualEndDate}.`)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
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
              <button
                type="button"
                onClick={() => handleManualRecentMonthsRebuild(2)}
                disabled={maintenanceLoading || importing}
                className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {maintenanceLoading ? 'Rebuild…' : 'Rebuild M-1 + M'}
              </button>
              <button
                type="button"
                onClick={() => handleManualRecentMonthsRebuild(2, 'previous_month')}
                disabled={maintenanceLoading || importing}
                className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                BL M-x → M-1 (léger)
              </button>
              <button
                type="button"
                onClick={() => handleManualRecentMonthsRebuild(2, 'current_month')}
                disabled={maintenanceLoading || importing}
                className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                BL M-x → M (léger)
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

          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label className="text-xs font-bold uppercase text-slate-500">
              Rebuild période — du
              <input
                type="date"
                value={manualStartDate}
                onChange={(event) => setManualStartDate(event.target.value)}
                className="mt-1 block h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
              />
            </label>
            <label className="text-xs font-bold uppercase text-slate-500">
              au
              <input
                type="date"
                value={manualEndDate}
                onChange={(event) => setManualEndDate(event.target.value)}
                className="mt-1 block h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
              />
            </label>
            <button
              type="button"
              onClick={handleManualPeriodRebuild}
              disabled={maintenanceLoading || importing}
              className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Rebuild période
            </button>
            <button
              type="button"
              onClick={handleManualPeriodQuantitesPertinentes}
              disabled={maintenanceLoading || importing}
              className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Recalcul qté pertinentes période
            </button>
            <div className="text-xs font-semibold text-slate-500">
              La date de fin est traitée comme mois inclus. Le rebuild reste découpé mois par mois.
            </div>
          </div>

          {maintenanceMessage && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{maintenanceMessage}</div>}
        </section>

        <DataReconciliationPanel />

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

            {pendingReferentialImport && (
              <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wide text-amber-900">
                      Arbitrage avant import — {pendingReferentialImport.configLabel}
                    </h3>
                    <p className="mt-1 text-sm text-amber-900">
                      Les lignes ci-dessous existent déjà en base mais contiennent au moins un champ différent.
                      Coche les lignes à importer pour écraser les valeurs en base par celles du fichier.
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      Nouveaux enregistrements prêts à importer : {pendingReferentialImport.rowsWithoutConflicts.length}.
                      Identiques ignorés : {pendingReferentialImport.identicalIgnored}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setAllPendingConflicts(true)}
                      className="rounded-xl border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                    >
                      Tout importer
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllPendingConflicts(false)}
                      className="rounded-xl border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                    >
                      Tout ignorer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingReferentialImport(null)
                        setMessage('Import annulé avant écrasement des enregistrements existants.')
                      }}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={confirmPendingReferentialImport}
                      disabled={importing}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      Importer la sélection
                    </button>
                  </div>
                </div>

                <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-amber-200 bg-white">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-amber-100 text-amber-950">
                      <tr>
                        <th className="border-b border-amber-200 px-3 py-2 text-left">Importer</th>
                        <th className="border-b border-amber-200 px-3 py-2 text-left">Clé</th>
                        <th className="border-b border-amber-200 px-3 py-2 text-left">Client / libellé</th>
                        <th className="border-b border-amber-200 px-3 py-2 text-left">Champs différents — valeur base → valeur fichier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingReferentialImport.conflicts.map((conflict) => (
                        <tr key={conflict.primaryKeyValue} className="align-top hover:bg-amber-50">
                          <td className="border-b border-amber-100 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={conflict.selected}
                              onChange={(e) => togglePendingConflict(conflict.primaryKeyValue, e.target.checked)}
                            />
                          </td>
                          <td className="whitespace-nowrap border-b border-amber-100 px-3 py-2 font-bold">
                            {conflict.primaryKeyValue}
                          </td>
                          <td className="border-b border-amber-100 px-3 py-2 font-semibold">
                            {conflict.displayLabel}
                          </td>
                          <td className="border-b border-amber-100 px-3 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              {conflict.differences.map((diff) => {
                                const column = TABLES
                                  .find((table) => table.key === conflict.tableKey)
                                  ?.columns.find((col) => col.db === diff.db)
                                return (
                                  <span
                                    key={diff.db}
                                    className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950"
                                    title={`${diff.label} : ${formatCellValue(diff.currentValue, column)} → ${formatCellValue(diff.importedValue, column)}`}
                                  >
                                    <strong>{diff.label}</strong> : {formatCellValue(diff.currentValue, column)} → {formatCellValue(diff.importedValue, column)}
                                  </span>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
