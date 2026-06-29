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

  const isValidDateParts = (year: number, month: number, day: number) => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
    if (year < 1900 || year > 2100) return false
    if (month < 1 || month > 12) return false
    if (day < 1 || day > 31) return false

    // Validation calendaire locale : pas de conversion UTC.
    const check = new Date(year, month - 1, day)
    return (
      check.getFullYear() === year &&
      check.getMonth() === month - 1 &&
      check.getDate() === day
    )
  }

  const toIsoDate = (year: number, month: number, day: number) => {
    if (!isValidDateParts(year, month, day)) return null
    return `${year}-${pad2(month)}-${pad2(day)}`
  }

  // IMPORTANT : ne jamais utiliser toISOString() pour une date métier Excel.
  // Excel fournit des dates sans notion de fuseau horaire. toISOString() convertit en UTC
  // et peut donc retirer 1 jour en France selon l'heure/fuseau du navigateur.
  // On lit donc toujours l'année / mois / jour en local.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  // Cas Excel serial number, ex : 46142.
  // XLSX.SSF.parse_date_code renvoie directement y/m/d sans conversion timezone.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return toIsoDate(Number(parsed.y), Number(parsed.m), Number(parsed.d))
  }

  const text = String(value).trim()
  if (!text) return null

  // Format ISO ou pseudo ISO : YYYY-MM-DD, éventuellement suivi d'une heure.
  // On extrait uniquement la partie date, sans passer par new Date().
  const isoLike = text.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/)
  if (isoLike) {
    return toIsoDate(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]))
  }

  // Format français ou ambigu : DD/MM/YYYY ou DD-MM-YYYY.
  const frOrUs = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (frOrUs) {
    const part1 = Number(frOrUs[1])
    const part2 = Number(frOrUs[2])
    const year = Number(frOrUs[3].length === 2 ? `20${frOrUs[3]}` : frOrUs[3])

    let day = part1
    let month = part2

    // Si le 2e morceau > 12, c'est nécessairement MM/DD/YYYY.
    if (part2 > 12 && part1 <= 12) {
      day = part2
      month = part1
    }

    return toIsoDate(year, month, day)
  }

  // Dernier recours : parsing JS, mais lecture en local, jamais toISOString().
  // Ce cas sert uniquement aux libellés texte atypiques renvoyés par Excel.
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
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



function detectAutoImportFileKind(fileName: string): AutoImportFileKind {
  const baseName = String(fileName || '').replace(/\.[^.]+$/, '')
  const normalized = normalizeHeader(baseName)

  // Les fichiers archivés / processing sont préfixés par timestamp_runX_.
  // On détecte donc le type même si Activite / Facture / Devis n'est plus au tout début du nom.
  if (normalized.startsWith('activite') || normalized.includes('activite')) return 'Activite'
  if (normalized.startsWith('facture') || normalized.includes('facture')) return 'Facture'
  if (normalized.startsWith('devis') || normalized.includes('devis')) return 'Devis'

  return 'Invalide'
}

function isAutoImportXlsx(fileName: string) {
  return String(fileName || '').toLowerCase().endsWith('.xlsx')
}

function isAutoImportCsv(fileName: string) {
  return String(fileName || '').toLowerCase().endsWith('.csv')
}

function isValidAutoImportFileName(fileName: string) {
  const kind = detectAutoImportFileKind(fileName)
  if (kind === 'Activite' || kind === 'Facture' || kind === 'Devis') return isAutoImportXlsx(fileName) || isAutoImportCsv(fileName)
  return false
}

// Pipeline automatique : on accepte des fichiers Excel en entrée, mais on les convertit
// en morceaux CSV au chargement pour éviter les limites CPU/mémoire des Edge Functions
// lors du parsing XLSX côté serveur. L'import manuel existant reste inchangé.
const AUTO_IMPORT_MAX_CSV_CHUNK_BYTES = 500 * 1024
const AUTO_IMPORT_TARGET_CSV_CHUNK_BYTES = Math.floor(AUTO_IMPORT_MAX_CSV_CHUNK_BYTES * 0.92)

function autoImportKindBaseName(kind: AutoImportFileKind) {
  if (kind === 'Activite') return 'Activite'
  if (kind === 'Facture') return 'Facture'
  if (kind === 'Devis') return 'Devis'
  return 'Import'
}


type AutoImportNamedFileForValidation = {
  name: string
  kind: AutoImportFileKind
}

function getAutoImportSplitPartNumber(fileName: string, kind: AutoImportFileKind) {
  if (kind === 'Invalide') return null
  const baseName = String(fileName || '').replace(/\.[^.]+$/, '')
  const normalizedBase = normalizeHeader(baseName)
  const normalizedKind = normalizeHeader(autoImportKindBaseName(kind))
  const match = normalizedBase.match(new RegExp(`(?:^|_)${normalizedKind}_part(\\d+)$`))
  if (!match) return null
  const partNumber = Number(match[1])
  return Number.isFinite(partNumber) && partNumber > 0 ? partNumber : null
}

function validateAutoImportPendingFileSet(files: AutoImportNamedFileForValidation[]) {
  const byKind = new Map<AutoImportFileKind, AutoImportNamedFileForValidation[]>()

  files.forEach((file) => {
    if (file.kind === 'Invalide') return
    const current = byKind.get(file.kind) || []
    current.push(file)
    byKind.set(file.kind, current)
  })

  const errors: string[] = []

  Array.from(byKind.entries()).forEach(([kind, kindFiles]) => {
    if (kindFiles.length <= 1) return

    const partNumbers = kindFiles.map((file) => getAutoImportSplitPartNumber(file.name, kind))
    const allFilesAreSplitParts = partNumbers.every((part) => part !== null)

    if (!allFilesAreSplitParts) {
      errors.push(
        `${kind} : plusieurs fichiers détectés (${kindFiles.map((file) => file.name).join(', ')}). ` +
        `C'est autorisé uniquement si tous les fichiers sont nommés ${autoImportKindBaseName(kind)}_part001.csv, ` +
        `${autoImportKindBaseName(kind)}_part002.csv, etc.`
      )
      return
    }

    const sortedParts = (partNumbers as number[]).sort((a, b) => a - b)
    const duplicatedParts = sortedParts.filter((part, index) => sortedParts.indexOf(part) !== index)
    if (duplicatedParts.length) {
      errors.push(`${kind} : doublon de morceau détecté (${Array.from(new Set(duplicatedParts)).map((part) => `part${String(part).padStart(3, '0')}`).join(', ')}).`)
      return
    }

    const expectedParts = Array.from({ length: sortedParts.length }, (_, index) => index + 1)
    const hasGap = expectedParts.some((expected, index) => sortedParts[index] !== expected)
    if (hasGap) {
      errors.push(
        `${kind} : les morceaux doivent être consécutifs à partir de part001. ` +
        `Morceaux présents : ${sortedParts.map((part) => `part${String(part).padStart(3, '0')}`).join(', ')}.`
      )
    }
  })

  return errors
}

function getTableConfigForAutoImportKind(kind: AutoImportFileKind) {
  const tableKeyByKind: Partial<Record<AutoImportFileKind, TableKey>> = {
    Activite: 'activite_lignes',
    Facture: 'facture_lignes',
    Devis: 'devis_lignes',
  }

  const tableKey = tableKeyByKind[kind]
  const config = TABLES.find((table) => table.key === tableKey)
  if (!tableKey || !config) {
    throw new Error(`Type de fichier non importable automatiquement : ${kind}`)
  }
  return config
}

function getAutoImportDocumentColumnIndex(headers: any[], kind: AutoImportFileKind) {
  const config = getTableConfigForAutoImportKind(kind)
  const aliases = EXTRA_HEADER_ALIASES[config.key] || {}
  const numeroPieceCandidates = new Set([
    normalizeHeader('numero_piece'),
    normalizeHeader('N° pièce'),
    normalizeHeader('N piece'),
    normalizeHeader('N° de pièce'),
    normalizeHeader('No piece'),
    normalizeHeader('Pièce'),
  ])

  return headers.findIndex((header) => {
    const normalized = normalizeHeader(String(header || ''))
    if (!normalized) return false
    if (numeroPieceCandidates.has(normalized)) return true
    if (aliases[normalized] === 'numero_piece') return true
    const mappedColumn = config.columns.find((column) => {
      if (normalizeHeader(column.db) === normalized && column.db === 'numero_piece') return true
      if (normalizeHeader(column.label) === normalized && column.db === 'numero_piece') return true
      return (column.aliases || []).some((alias) => normalizeHeader(alias) === normalized) && column.db === 'numero_piece'
    })
    return Boolean(mappedColumn)
  })
}

function rowHasValue(row: any[]) {
  return Array.isArray(row) && row.some((value) => value !== null && value !== undefined && String(value).trim() !== '')
}

function csvEscapeValue(value: any) {
  if (value === undefined || value === null) return ''
  const text = String(value)
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function writeAutoImportCsvFile(headerRow: any[], dataRows: any[][], fileName: string) {
  const allRows = [headerRow, ...dataRows]
  const csv = `\ufeff${allRows.map((row) => row.map(csvEscapeValue).join(';')).join('\r\n')}\r\n`
  return new File([csv], fileName, { type: 'text/csv;charset=utf-8' })
}

async function splitXlsxForAutoImportUpload(file: File, kind: AutoImportFileKind) {
  if (isAutoImportCsv(file.name) && file.size <= AUTO_IMPORT_MAX_CSV_CHUNK_BYTES) {
    return [{ file, rows: null as number | null, part: 1, parts: 1 }]
  }

  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: false,
    cellNF: true,
    cellText: false,
  })

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error(`Le fichier ${file.name} ne contient aucune feuille.`)

  const sheet = workbook.Sheets[sheetName]

  // IMPORTANT : on garde les valeurs brutes Excel.
  // Pour les dates, cela permet de conserver les serials Excel au lieu de générer
  // des dates texte ambiguës du type 6/1/26, qui peuvent être relues comme
  // 6 janvier au lieu du 1er juin.
  // L'Edge Function sait convertir les serials Excel, y compris lorsqu'ils arrivent
  // sous forme texte depuis un CSV.
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  }) as any[][]

  if (!aoa.length) throw new Error(`Le fichier ${file.name} ne contient aucune ligne.`)

  const headerRow = aoa[0] || []
  const dataRows = aoa.slice(1).filter(rowHasValue)
  if (!dataRows.length) throw new Error(`Le fichier ${file.name} ne contient aucune donnée après l'entête.`)

  const documentColumnIndex = getAutoImportDocumentColumnIndex(headerRow, kind)
  if (documentColumnIndex < 0) {
    throw new Error(
      `Impossible de découper ${file.name} : colonne N° pièce / numero_piece introuvable. ` +
      `Le découpage automatique doit préserver les documents entiers.`
    )
  }

  const groups: { key: string; rows: any[][] }[] = []
  const groupByDocument = new Map<string, { key: string; rows: any[][] }>()

  dataRows.forEach((row, index) => {
    const rawDocument = normalizeText(row[documentColumnIndex])
    const key = rawDocument ? String(rawDocument) : `__ligne_sans_numero_${index + 2}`
    let group = groupByDocument.get(key)
    if (!group) {
      group = { key, rows: [] }
      groupByDocument.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
  })

  const baseName = autoImportKindBaseName(kind)
  const buildFile = (partIndex: number, rows: any[][]) =>
    writeAutoImportCsvFile(headerRow, rows, `${baseName}_part${String(partIndex).padStart(3, '0')}.csv`)

  const estimatedRowsPerChunk = Math.max(200, Math.floor(dataRows.length * AUTO_IMPORT_TARGET_CSV_CHUNK_BYTES / Math.max(file.size, AUTO_IMPORT_MAX_CSV_CHUNK_BYTES)))
  const chunks: { rows: any[][]; part: number }[] = []
  let cursor = 0

  while (cursor < groups.length) {
    let end = cursor
    let rowCount = 0
    while (end < groups.length && (rowCount < estimatedRowsPerChunk || end === cursor)) {
      rowCount += groups[end].rows.length
      end += 1
    }

    let candidateRows = groups.slice(cursor, end).flatMap((group) => group.rows)
    let candidateFile = buildFile(chunks.length + 1, candidateRows)

    if (candidateFile.size > AUTO_IMPORT_MAX_CSV_CHUNK_BYTES) {
      let low = cursor + 1
      let high = end
      let bestEnd = -1
      let bestRows: any[][] | null = null
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const rows = groups.slice(cursor, mid).flatMap((group) => group.rows)
        const testFile = buildFile(chunks.length + 1, rows)
        if (testFile.size <= AUTO_IMPORT_MAX_CSV_CHUNK_BYTES) {
          bestEnd = mid
          bestRows = rows
          low = mid + 1
        } else {
          high = mid - 1
        }
      }

      if (bestEnd < 0 || !bestRows) {
        const firstGroupRows = groups[cursor].rows
        const tooLargeFile = buildFile(chunks.length + 1, firstGroupRows)
        throw new Error(
          `Impossible de découper ${file.name} sans couper un document : ` +
          `le document « ${groups[cursor].key} » génère à lui seul un CSV de ${formatFileSize(tooLargeFile.size)}, supérieur à ${formatFileSize(AUTO_IMPORT_MAX_CSV_CHUNK_BYTES)}.`
        )
      }

      candidateRows = bestRows
      end = bestEnd
    }

    chunks.push({ rows: candidateRows, part: chunks.length + 1 })
    cursor = end
  }

  return chunks.map((chunk, index) => {
    const uploadedFile = buildFile(index + 1, chunk.rows)
    if (uploadedFile.size > AUTO_IMPORT_MAX_CSV_CHUNK_BYTES) {
      throw new Error(`${uploadedFile.name} dépasse encore ${formatFileSize(AUTO_IMPORT_MAX_CSV_CHUNK_BYTES)} (${formatFileSize(uploadedFile.size)}).`)
    }
    return { file: uploadedFile, rows: chunk.rows.length, part: index + 1, parts: chunks.length }
  })
}

function cleanStorageFileName(fileName: string) {
  return String(fileName || '')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatFileSize(value: number | null | undefined) {
  const n = Number(value || 0)
  if (!n) return '—'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
  if (n >= 1024) return `${(n / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko`
  return `${n.toLocaleString('fr-FR')} o`
}

function isAutoImportRunRunning(status: any) {
  const s = String(status || '').toLowerCase()
  return ['running', 'processing', 'started', 'smc_running', 'pre_smc_done', 'queued'].includes(s)
}

function isAutoImportRunSuccess(status: any) {
  const s = String(status || '').toLowerCase()
  return ['done', 'success', 'finished', 'completed', 'ok'].includes(s)
}

function isAutoImportRunError(status: any) {
  const s = String(status || '').toLowerCase()
  return ['error', 'failed', 'ko', 'cancelled', 'canceled'].includes(s)
}

function statusBadgeClass(status: any) {
  if (isAutoImportRunSuccess(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (isAutoImportRunRunning(status)) return 'border-blue-200 bg-blue-50 text-blue-800'
  if (isAutoImportRunError(status)) return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function folderBadgeClass(folder: AutoImportFolder) {
  if (folder === 'pending') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (folder === 'processing') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (folder === 'rejected') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

function fileKindBadgeClass(kind: AutoImportFileKind) {
  if (kind === 'Activite') return 'border-indigo-200 bg-indigo-50 text-indigo-800'
  if (kind === 'Facture') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (kind === 'Devis') return 'border-orange-200 bg-orange-50 text-orange-800'
  return 'border-red-200 bg-red-50 text-red-800'
}

function getPipelineRunReport(run: ImportPipelineRun | null, tab: AutoImportReportTab) {
  if (!run) return 'Aucun run disponible.'

  if (tab === 'pre_smc') {
    return (
      run.pre_smc_report ||
      run.report_pre_smc ||
      run.pre_smc_message ||
      'Aucun rapport avant SMC disponible pour ce run.'
    )
  }

  if (tab === 'final') {
    return (
      run.final_report ||
      run.report_final ||
      run.message ||
      'Aucun rapport final disponible pour ce run.'
    )
  }

  return (
    run.error_message ||
    run.last_error ||
    run.error ||
    'Aucune erreur remontée sur le dernier run.'
  )
}

function rpcSignatureMismatch(error: any) {
  const message = String(error?.message || error || '').toLowerCase()
  const code = String(error?.code || '').toUpperCase()
  return (
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    message.includes('could not find the function') ||
    message.includes('function') && message.includes('does not exist') ||
    message.includes('schema cache')
  )
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

type SmcReconciliationAnnualRow = {
  type_controle: string
  periode: string
  annee: number
  date_debut: string
  date_fin_exclue: string
  nb_lignes_smc: number | null
  nb_clients_smc: number | null
  valeur_indicateur: number | null
  valeur_smc: number | null
  ecart: number | null
  ratio: number | null
  statut: string
}

const TOLERANCE = 0.01
const FLUX_ARTICLES_FRONT_REBUILD_RPC = 'rebuild_indicateur_flux_articles_mensuel_periode_front'


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

type SmcBackgroundJobState = {
  job_name: string
  date_debut: string | null
  date_fin: string | null
  batch_size: number | null
  status: string | null
  total_clients: number | null
  processed_clients: number | null
  last_rn: number | null
  started_at: string | null
  finished_at: string | null
  last_error: string | null
  updated_at: string | null
}

const SMC_BACKGROUND_JOB_NAME = 'smc_period_catchup'
const SMC_BACKGROUND_CRON_JOB_NAME = 'smc_period_catchup_auto'
const SMC_BACKGROUND_DEFAULT_BATCH_SIZE = 25
const SMC_BACKGROUND_MIN_BATCH_SIZE = 1
const SMC_BACKGROUND_MAX_BATCH_SIZE = 200
const SMC_BACKGROUND_POLL_MS = 5000


type AutoImportFolder = 'pending' | 'processing' | 'rejected' | 'archive'
type AutoImportFileKind = 'Activite' | 'Facture' | 'Devis' | 'Invalide'
type AutoImportReportTab = 'pre_smc' | 'final' | 'errors'

type AutoImportStorageFile = {
  folder: AutoImportFolder
  name: string
  path: string
  kind: AutoImportFileKind
  size: number | null
  created_at: string | null
  updated_at: string | null
}

type ImportPipelineRun = {
  id?: number
  started_at?: string | null
  finished_at?: string | null
  status?: string | null
  current_step?: string | null
  pre_smc_report_at?: string | null
  smc_started_at?: string | null
  smc_finished_at?: string | null
  pre_smc_report?: string | null
  final_report?: string | null
  error_message?: string | null
  message?: string | null
  [key: string]: any
}

type ImportPipelineFile = {
  id?: number
  run_id?: number | null
  original_filename?: string | null
  file_type?: string | null
  storage_path_initial?: string | null
  storage_path_processing?: string | null
  storage_path_final?: string | null
  status?: string | null
  imported_at?: string | null
  error_message?: string | null
  [key: string]: any
}

const AUTO_IMPORT_BUCKET = 'commercial-imports'
const AUTO_IMPORT_FOLDERS: AutoImportFolder[] = ['pending', 'processing', 'rejected', 'archive']
const AUTO_IMPORT_PIPELINE_RPC_CANDIDATES = [
  'run_pipeline_commercial_auto',
  'run_import_pipeline_global',
  'start_import_pipeline_global',
]
const AUTO_IMPORT_POLL_MS = 10000
const AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK = 10
const AUTO_IMPORT_EDGE_FUNCTION_NAME = 'import-pipeline-global'

const SMC_BATCH_SIZE = 1
const SMC_MAX_LOOPS = 10000
const SMC_RETRY_LIMIT = 3
const SMC_PAUSE_BETWEEN_BATCHES_MS = 150

function waitForSmcBatch(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function isSmcTimeoutError(error: any) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('statement timeout') || message.includes('canceling statement')
}

function getSmcCheckpointKey(period: SmcRpcPeriod) {
  return `smc-rebuild-v28:${period.p_date_debut}:${period.p_date_fin}`
}

async function runSmcCacheForPeriodBatchesV28(
  period: SmcRpcPeriod,
  onProgress?: (detail: string) => void,
  label = 'Synthèse multi-clients',
  batchSize = SMC_BATCH_SIZE
) {
  const periodLabel = period.label || `${period.p_date_debut} → ${period.p_date_fin}`
  const checkpointKey = getSmcCheckpointKey(period)

  let after: string | null =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(checkpointKey)
      : null

  let processedTotal = 0

  if (after) {
    onProgress?.(`${label} : reprise de ${periodLabel} après le client ${after}`)
  }

  for (let loop = 0; loop < SMC_MAX_LOOPS; loop += 1) {
    const previousAfter = after

    onProgress?.(
      `${label} : ${periodLabel} — client ${loop + 1}` +
      `${after ? ` après ${after}` : ''}`
    )

    let rpcData: any = null
    let lastError: any = null

    for (let attempt = 0; attempt <= SMC_RETRY_LIMIT; attempt += 1) {
      const { data, error } = await supabase.rpc('rebuild_smc_cache_period_batch_v28', {
        p_date_debut: period.p_date_debut,
        p_date_fin: period.p_date_fin,
        p_after_numero: after,
        p_batch_size: batchSize,
      })

      if (!error) {
        rpcData = data
        lastError = null
        break
      }

      lastError = error

      if (!isSmcTimeoutError(error) || attempt >= SMC_RETRY_LIMIT) {
        break
      }

      const retryDelay = 1000 * (attempt + 1)
      onProgress?.(
        `${label} : ${periodLabel} — timeout sur le client en cours, ` +
        `nouvelle tentative ${attempt + 1}/${SMC_RETRY_LIMIT} dans ${retryDelay / 1000}s`
      )
      await waitForSmcBatch(retryDelay)
    }

    if (lastError) {
      throw new Error(
        `rebuild_smc_cache_period_batch_v28 ${periodLabel}` +
        `${after ? ` après ${after}` : ''} : ${lastError.message}`
      )
    }

    const rows = (
      Array.isArray(rpcData)
        ? rpcData
        : rpcData
          ? [rpcData]
          : []
    ) as SmcBatchResult[]

    const batchRow = rows[0]
    const processed = Number(batchRow?.processed_count ?? 0)
    const totalCandidates = Number(batchRow?.total_candidates ?? 0)
    const remaining = Number(batchRow?.remaining_count ?? 0)
    const lastNumero: string | null =
      batchRow?.last_numero
        ? String(batchRow.last_numero)
        : after

    processedTotal += processed
    after = lastNumero

    if (processed > 0 && after === previousAfter) {
      throw new Error(
        `${label} : la RPC indique un client traité mais le curseur n'a pas progressé ` +
        `(dernier client : ${after || 'inconnu'}).`
      )
    }

    if (typeof window !== 'undefined' && after) {
      window.localStorage.setItem(checkpointKey, after)
    }

    onProgress?.(
      `${label} : ${periodLabel} — ${processedTotal}` +
      `${totalCandidates ? `/${totalCandidates}` : ''} client(s) traité(s)` +
      `${remaining ? ', suite…' : ''}`
    )

    // Avec un micro-lot d'un client, un résultat vide marque la fin de toute la période.
    if (!processed || processed < batchSize) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(checkpointKey)
      }

      return {
        processedTotal,
        totalCandidates,
        lastNumero: after,
      }
    }

    // Petite pause entre les clients pour ne pas saturer PostgREST et PostgreSQL.
    await waitForSmcBatch(SMC_PAUSE_BETWEEN_BATCHES_MS)
  }

  throw new Error(
    `${label} : arrêt de sécurité après ${SMC_MAX_LOOPS} clients. ` +
    `Dernier client traité : ${after || 'début'}. ` +
    `Le prochain clic reprendra automatiquement à ce client.`
  )
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

  // Synthèse multi-clients : NE PLUS contrôler mois par mois.
  // La SMC est désormais une vision année / YTD ; la comparer à chaque mois crée des faux KO.
  // Le contrôle SMC doit être porté par un contrôle annuel / YTD séparé côté SQL.

  // CDC / BL : on contrôle uniquement l'écart final calculé par la RPC :
  // CDC flux = CDC depuis factures + CDC depuis activité
  // BL flux  = BL depuis factures + BL depuis activité
  if (absEcart(row.ecart_cdc_source_vs_flux) > TOLERANCE) issues.push('CDC flux')
  if (absEcart(row.ecart_bl_source_vs_flux) > TOLERANCE) issues.push('BL flux')

  return issues
}

function exportRows(rows: ReconciliationRow[], smcRows: SmcReconciliationAnnualRow[] = []) {
  if (!rows.length && !smcRows.length) return

  const wb = XLSX.utils.book_new()

  if (rows.length) {
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
        Anomalies: computeRowIssues(row).join(', '),

        'Factures lignes': facturesLignes,
        'Factures cache': toNumber(row.factures_cache),
        'Écart factures cache vs lignes': toNumber(row.factures_cache) - facturesLignes,
        'Factures indicateur': toNumber(row.factures_indicateur),
        'Écart factures indicateur vs lignes': toNumber(row.factures_indicateur) - facturesLignes,
        'Factures flux': toNumber(row.factures_flux),
        'Écart factures flux vs lignes': toNumber(row.factures_flux) - facturesLignes,
        'Devis lignes': devisLignes,
        'Devis cache': toNumber(row.devis_cache),
        'Écart devis cache vs lignes': toNumber(row.devis_cache) - devisLignes,
        'Devis indicateur': toNumber(row.devis_indicateur),
        'Écart devis indicateur vs lignes': toNumber(row.devis_indicateur) - devisLignes,
        'Devis flux': toNumber(row.devis_flux),
        'Écart devis flux vs lignes': toNumber(row.devis_flux) - devisLignes,
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
    XLSX.utils.book_append_sheet(wb, ws, 'Contrôle mensuel')
  }

  if (smcRows.length) {
    const smcExportData = smcRows.map((row) => ({
      Type: row.type_controle,
      Période: row.periode,
      Année: row.annee,
      'Date début': row.date_debut,
      'Date fin exclue': row.date_fin_exclue,
      'Lignes SMC': toNumber(row.nb_lignes_smc),
      'Clients SMC': toNumber(row.nb_clients_smc),
      'Valeur indicateur': toNumber(row.valeur_indicateur),
      'Valeur SMC': toNumber(row.valeur_smc),
      Écart: toNumber(row.ecart),
      Ratio: toNumber(row.ratio),
      Statut: row.statut,
    }))

    const smcWs = XLSX.utils.json_to_sheet(smcExportData)
    XLSX.utils.book_append_sheet(wb, smcWs, 'Contrôle SMC annuel')
  }

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
  const [smcRows, setSmcRows] = useState<SmcReconciliationAnnualRow[]>([])

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

  const smcSummary = useMemo(() => {
    const koRows = smcRows.filter((row) => String(row.statut || '').toUpperCase() !== 'OK')
    return {
      total: smcRows.length,
      ko: koRows.length,
      ok: smcRows.length - koRows.length,
      status: koRows.length ? 'ko' : 'ok',
      maxAbsEcart: smcRows.reduce((max, row) => Math.max(max, absEcart(row.ecart)), 0),
    }
  }, [smcRows])

  async function loadReconciliation() {
    setLoading(true)
    setError(null)
    setHasRun(true)
    setRunSummary(null)
    setSmcRows([])

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
            absEcart(toNumber(row.factures_flux) - ref) > TOLERANCE
          )
        }).length,
        devis_ko: mappedRows.filter((row) => {
          const ref = toNumber(row.devis_lignes)
          return (
            absEcart(toNumber(row.devis_cache) - ref) > TOLERANCE ||
            absEcart(toNumber(row.devis_indicateur) - ref) > TOLERANCE ||
            absEcart(toNumber(row.devis_flux) - ref) > TOLERANCE
          )
        }).length,
        max_abs_ecart: maxAbsEcart,
      })

      const smcYear = new Date().getFullYear()
      const { data: smcData, error: smcRpcError } = await supabase.rpc('get_smc_reconciliation_annuel_ytd_front', {
        p_date_debut: startDate,
        p_date_fin: endDate,
        p_annee_n: smcYear,
      })
      if (smcRpcError) throw new Error(`Contrôle SMC annuel / YTD impossible : ${smcRpcError.message}`)
      setSmcRows(((smcData || []) as SmcReconciliationAnnualRow[]))
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setRows([])
      setRunSummary(null)
      setSmcRows([])
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
            Compare les lignes sources, les caches, les indicateurs et le flux articles mois par mois. La SMC est exclue du contrôle mensuel et contrôlée à part via un wrapper avec timeout long.
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
            onClick={() => exportRows(rows, smcRows)}
            disabled={(!rows.length && !smcRows.length) || loading}
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

      {hasRun && !error ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-semibold text-sky-800">
          SMC exclue du contrôle mensuel : la synthèse multi-clients est considérée comme une vue année / YTD. Les contrôles KO ci-dessous portent uniquement sur Factures, Devis, CDC, BL et Flux articles mois par mois.
        </div>
      ) : null}

      {rows.length ? (
        <div className="mt-4 max-h-[560px] overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-[1900px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900 text-white">
              <tr>
                <th className="px-2 py-2 text-left">Période</th>
                <th className="px-2 py-2 text-left">Statut</th>
                <th className="px-2 py-2 text-right">Fact. lignes</th>
                <th className="px-2 py-2 text-right">Fact. cache</th>
                <th className="px-2 py-2 text-right">Fact. indic.</th>
                <th className="px-2 py-2 text-right">Fact. flux</th>
                <th className="px-2 py-2 text-right">Écart flux</th>
                <th className="px-2 py-2 text-right">Devis lignes</th>
                <th className="px-2 py-2 text-right">Devis cache</th>
                <th className="px-2 py-2 text-right">Devis indic.</th>
                <th className="px-2 py-2 text-right">Devis flux</th>
                <th className="px-2 py-2 text-right">Écart flux</th>
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
                    <td className="px-2 py-2 text-right font-bold">{formatMoney(devisLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_cache)}`}>{formatMoney(row.devis_cache)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_indicateur)}`}>{formatMoney(row.devis_indicateur)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_flux)}`}>{formatMoney(row.devis_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(toNumber(row.devis_flux) - devisLignes)}`}>{formatSigned(toNumber(row.devis_flux) - devisLignes)}</td>
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

      {hasRun && !error ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Contrôle cohérence SMC annuel / YTD</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Compare la ligne annuelle client de synthèse_multi_clients_cache avec les indicateurs mensuels cumulés.
                Seules les lignes SMC mois NULL et row_kind client sont contrôlées côté SQL.
              </p>
            </div>
            <div className={`rounded-xl border px-3 py-2 text-xs font-black ${smcSummary.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {smcSummary.total ? `${smcSummary.ok} OK / ${smcSummary.ko} KO — écart max ${formatMoney(smcSummary.maxAbsEcart)}` : 'Non contrôlé'}
            </div>
          </div>

          {smcRows.length ? (
            <div className="mt-3 overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-[1250px] border-collapse text-xs">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-left">Période</th>
                    <th className="px-2 py-2 text-right">Année</th>
                    <th className="px-2 py-2 text-left">Début</th>
                    <th className="px-2 py-2 text-left">Fin exclue</th>
                    <th className="px-2 py-2 text-right">Lignes SMC</th>
                    <th className="px-2 py-2 text-right">Clients SMC</th>
                    <th className="px-2 py-2 text-right">Indicateur</th>
                    <th className="px-2 py-2 text-right">SMC</th>
                    <th className="px-2 py-2 text-right">Écart</th>
                    <th className="px-2 py-2 text-right">Ratio</th>
                    <th className="px-2 py-2 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {smcRows.map((row) => {
                    const isOk = String(row.statut || '').toUpperCase() === 'OK'
                    return (
                      <tr key={`${row.type_controle}-${row.annee}-${row.periode}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2 font-black">{row.type_controle}</td>
                        <td className="px-2 py-2 font-bold">{row.periode}</td>
                        <td className="px-2 py-2 text-right font-bold">{row.annee}</td>
                        <td className="px-2 py-2">{row.date_debut}</td>
                        <td className="px-2 py-2">{row.date_fin_exclue}</td>
                        <td className="px-2 py-2 text-right">{toNumber(row.nb_lignes_smc).toLocaleString('fr-FR')}</td>
                        <td className="px-2 py-2 text-right">{toNumber(row.nb_clients_smc).toLocaleString('fr-FR')}</td>
                        <td className="px-2 py-2 text-right font-bold">{formatMoney(row.valeur_indicateur)}</td>
                        <td className="px-2 py-2 text-right font-bold">{formatMoney(row.valeur_smc)}</td>
                        <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart)}`}>{formatSigned(row.ecart)}</td>
                        <td className="px-2 py-2 text-right font-bold">{toNumber(row.ratio).toFixed(6)}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded-full px-2 py-1 text-[11px] font-black ${isOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {isOk ? 'OK' : 'KO'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : loading ? (
            <div className="mt-3 rounded-xl bg-white p-4 text-sm font-bold text-slate-500">Contrôle SMC en cours…</div>
          ) : (
            <div className="mt-3 rounded-xl bg-white p-4 text-sm font-bold text-slate-500">Aucun résultat SMC retourné pour cette période.</div>
          )}
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

  const [autoImportStorageFiles, setAutoImportStorageFiles] = useState<AutoImportStorageFile[]>([])
  const [autoImportPipelineRuns, setAutoImportPipelineRuns] = useState<ImportPipelineRun[]>([])
  const [autoImportPipelineFiles, setAutoImportPipelineFiles] = useState<ImportPipelineFile[]>([])
  const [autoImportLoading, setAutoImportLoading] = useState(false)
  const [autoImportUploading, setAutoImportUploading] = useState(false)
  const [autoImportRunning, setAutoImportRunning] = useState(false)
  const [autoImportMessage, setAutoImportMessage] = useState<string | null>(null)
  const [autoImportError, setAutoImportError] = useState<string | null>(null)
  const [autoImportReportTab, setAutoImportReportTab] = useState<AutoImportReportTab>('pre_smc')
  const [autoImportReportEmailTo, setAutoImportReportEmailTo] = useState('')
  const [autoImportSendReportEmail, setAutoImportSendReportEmail] = useState(false)

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
    void loadAutomaticImportDashboard(false)
  }, [])

  useEffect(() => {
    const latestRun = autoImportPipelineRuns[0]
    if (!latestRun || !isAutoImportRunRunning(latestRun.status)) return

    const timer = window.setInterval(() => {
      void loadAutomaticImportDashboard(false)
      void loadStats()
    }, AUTO_IMPORT_POLL_MS)

    return () => window.clearInterval(timer)
  }, [autoImportPipelineRuns[0]?.id, autoImportPipelineRuns[0]?.status])

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
          const workbook = XLSX.read(data, {
            type: 'array',
            // IMPORTANT V2 dates métier : on ne laisse plus SheetJS convertir les cellules Excel en Date JS.
            // Avec cellDates:true, certaines dates Excel arrivent déjà décalées d'un jour avant normalizeDate().
            // On lit donc les dates au format brut : les vraies dates Excel restent des numéros de série,
            // puis normalizeDate() les convertit via XLSX.SSF.parse_date_code(), sans fuseau horaire.
            cellDates: false,
            cellNF: true,
            cellText: false,
          })
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

  async function runFluxArticlesForPeriods(
    periods: RpcPeriod[],
    onProgress?: (detail: string) => void,
    label = 'Flux articles'
  ) {
    try {
      await runRpcForPeriods(FLUX_ARTICLES_FRONT_REBUILD_RPC, periods, onProgress, label)
    } catch (error: any) {
      const message = error?.message || String(error)
      const missingRpc =
        message.includes('Could not find the function') ||
        message.includes('function') && message.includes(FLUX_ARTICLES_FRONT_REBUILD_RPC) && message.includes('does not exist')

      if (missingRpc) {
        throw new Error(
          `${FLUX_ARTICLES_FRONT_REBUILD_RPC} introuvable. Crée d'abord le wrapper SQL SECURITY DEFINER avec statement_timeout long, puis relance le rebuild flux articles.`
        )
      }

      if (message.toLowerCase().includes('statement timeout')) {
        throw new Error(
          `${label} interrompu par timeout applicatif. Relance sur une période plus courte, ou augmente le statement_timeout du wrapper ${FLUX_ARTICLES_FRONT_REBUILD_RPC}. Détail : ${message}`
        )
      }

      throw error
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

  function getSmcPeriodCoveringDateInputs(startIso: string, endIso: string): SmcRpcPeriod {
    if (!startIso || !endIso) throw new Error('Merci de renseigner une date de début et une date de fin.')

    const startParts = startIso.split('-').map(Number)
    const endParts = endIso.split('-').map(Number)

    if (startParts.length !== 3 || endParts.length !== 3) {
      throw new Error('Période SMC invalide.')
    }

    const start = new Date(startParts[0], startParts[1] - 1, 1)
    const endInput = new Date(endParts[0], endParts[1] - 1, endParts[2] || 1)

    if (Number.isNaN(start.getTime()) || Number.isNaN(endInput.getTime())) {
      throw new Error('Période SMC invalide.')
    }

    if (endInput < start) {
      throw new Error('La date de fin doit être supérieure ou égale à la date de début.')
    }

    // La plage SMC reste unique. La date de fin saisie est traitée comme mois inclus.
    const endExclusive = new Date(endInput.getFullYear(), endInput.getMonth() + 1, 1)
    const pDateDebut = formatDateForSql(start)
    const pDateFin = formatDateForSql(endExclusive)

    return {
      p_date_debut: pDateDebut,
      p_date_fin: pDateFin,
      label: `${pDateDebut} → ${pDateFin}`,
    }
  }


  function getAutoImportFluxArticlesPeriod(): SmcRpcPeriod {
    const now = new Date()
    // Pipeline automatique : après les imports, les agrégats rapides sont déjà gérés
    // par les fonctions d'import existantes. On ne relance donc que flux_articles,
    // en découpant côté SQL / job mois par mois sur les 10 derniers mois pour éviter les timeouts.
    const start = new Date(now.getFullYear(), now.getMonth() - (AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK - 1), 1)
    const endExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const pDateDebut = formatDateForSql(start)
    const pDateFin = formatDateForSql(endExclusive)

    return {
      p_date_debut: pDateDebut,
      p_date_fin: pDateFin,
      label: `${pDateDebut} → ${pDateFin}`,
    }
  }

  function getMonthlyPeriodsFromRows(rows: GenericRow[], dateColumns: string[], includeGaps = false): RpcPeriod[] {
    const monthKeys = new Set<string>()

    rows.forEach((row) => {
      dateColumns.forEach((column) => {
        const normalized = normalizeDate(row[column])
        if (!normalized) return

        const [year, month] = normalized.split('-').map(Number)
        if (!year || !month || month < 1 || month > 12) return
        monthKeys.add(`${year}-${String(month).padStart(2, '0')}`)
      })
    })

    const sortedKeys = Array.from(monthKeys).sort()
    if (!sortedKeys.length) return []

    const first = sortedKeys[0].split('-').map(Number)
    const last = sortedKeys[sortedKeys.length - 1].split('-').map(Number)

    if (includeGaps) {
      const start = new Date(first[0], first[1] - 1, 1)
      const end = new Date(last[0], last[1], 1)
      return getMonthlyPeriodsBetween(start, end)
    }

    return sortedKeys.map((key) => {
      const [year, month] = key.split('-').map(Number)
      const start = new Date(year, month - 1, 1)
      const end = new Date(year, month, 1)
      return {
        p_date_debut: formatDateForSql(start),
        p_date_fin: formatDateForSql(end),
        label: `${formatDateForSql(start)} → ${formatDateForSql(end)}`,
      }
    })
  }

  function fallbackRecentPeriodsIfEmpty(periods: RpcPeriod[]) {
    return periods.length ? periods : getMonthlyAggregatePeriods(2)
  }

  function summarizePeriodList(periods: RpcPeriod[]) {
    if (!periods.length) return '0 mois'
    const first = periods[0]?.p_date_debut
    const last = periods[periods.length - 1]?.p_date_fin
    return `${periods.length} mois (${first} → ${last})`
  }

  async function runCompleteRebuildForPeriods(
    periods: RpcPeriod[],
    onProgress?: (detail: string) => void
  ) {
    // V33 : le flux articles est volontairement exclu du rebuild agrégats standard.
    // Il dispose d'un bouton dédié, car la RPC est plus lourde et peut dépasser le timeout PostgREST.
    await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, onProgress, 'Cache factures')
    await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, onProgress, 'Agrégat factures')

    await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, onProgress, 'Cache devis')
    await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, onProgress, 'Agrégat devis')

    await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, onProgress, 'Agrégat activité')
  }

  async function runPostImportRefresh(config: TableConfig, changedRows: GenericRow[], onProgress?: (detail: string) => void) {
    const recentPeriods = getMonthlyAggregatePeriods(2)

    if (config.key === 'facture_lignes') {
      const facturePeriods = fallbackRecentPeriodsIfEmpty(getMonthlyPeriodsFromRows(changedRows, ['date_facture']))
      const fluxPeriods = fallbackRecentPeriodsIfEmpty(
        getMonthlyPeriodsFromRows(changedRows, ['date_facture', 'date_devis', 'date_bc', 'date_pl', 'date_bl'])
      )

      await runRpcForPeriods(
        'refresh_facture_entetes_cache_periode',
        facturePeriods,
        onProgress,
        'Rafraîchissement cache factures mois facture'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_factures_mensuel_periode',
        facturePeriods,
        onProgress,
        'Rebuild indicateur factures mois facture'
      )

      return (
        `Cache et indicateur factures recalculés sur ${summarizePeriodList(facturePeriods)}. ` +
        `Flux articles non recalculé automatiquement ; période métier conseillée : ${summarizePeriodList(fluxPeriods)}. ` +
        'SMC non reconstruite automatiquement.'
      )
    }

    if (config.key === 'devis_lignes') {
      const devisPeriods = fallbackRecentPeriodsIfEmpty(getMonthlyPeriodsFromRows(changedRows, ['date_devis']))
      const fluxPeriods = fallbackRecentPeriodsIfEmpty(
        getMonthlyPeriodsFromRows(changedRows, ['date_devis', 'date_bc', 'date_pl', 'date_bl'])
      )

      await runRpcForPeriods(
        'refresh_devis_entetes_cache_periode',
        devisPeriods,
        onProgress,
        'Rafraîchissement cache devis mois devis'
      )

      await runRpcForPeriods(
        'rebuild_indicateur_devis_mensuel_periode',
        devisPeriods,
        onProgress,
        'Rebuild indicateur devis mois devis'
      )

      return (
        `Cache et indicateur devis recalculés sur ${summarizePeriodList(devisPeriods)}. ` +
        `Flux articles non recalculé automatiquement ; période métier conseillée : ${summarizePeriodList(fluxPeriods)}. ` +
        'SMC non reconstruite automatiquement.'
      )
    }

    if (config.key === 'activite_lignes') {
      const activitePeriods = fallbackRecentPeriodsIfEmpty(getMonthlyPeriodsFromRows(changedRows, ['date_piece'], true))
      const fluxPeriods = fallbackRecentPeriodsIfEmpty(
        getMonthlyPeriodsFromRows(changedRows, ['date_piece', 'date_devis', 'date_bc', 'date_pl', 'date_bl'], true)
      )

      await runRpcForPeriods(
        'rebuild_indicateur_activite_mensuel_periode',
        activitePeriods,
        onProgress,
        'Rebuild indicateur activité période complète du fichier'
      )

      return (
        `Indicateur activité recalculé sur ${summarizePeriodList(activitePeriods)}. ` +
        `Flux articles non recalculé automatiquement ; période métier conseillée : ${summarizePeriodList(fluxPeriods)}. ` +
        'SMC non reconstruite automatiquement.'
      )
    }

    if (config.key === 'ref_familles') {
      return 'Référentiel familles mis à jour. Utilise le bouton « Recalcul qté pertinentes période » pour appliquer la nouvelle règle sur une période choisie.'
    }

    return `Aucun refresh automatique requis pour cette table. Référence de sécurité M-1/M disponible : ${summarizePeriodList(recentPeriods)}.`
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
    const refreshMessage = await runPostImportRefresh(config, rowsToInsert, (detail) => updateImportStep('refresh', 'running', detail))
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
      }
      if (selectedConfig.key === 'devis_lignes') {
        await runRpcForPeriods('refresh_devis_entetes_cache_periode', monthlyPeriods)
        await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', monthlyPeriods)
      }
      if (selectedConfig.key === 'activite_lignes') {
        await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', monthlyPeriods)
      }
      if (selectedConfig.key === 'ref_familles') {
        // Les quantités pertinentes se recalculent désormais via le bouton période dédié.
      }

      setMessage('Enregistrement sauvegardé. Agrégats rapides recalculés si nécessaire ; flux articles et SMC non reconstruits automatiquement.')
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
  const [smcBackgroundState, setSmcBackgroundState] = useState<SmcBackgroundJobState | null>(null)
  const [smcBackgroundBusy, setSmcBackgroundBusy] = useState(false)
  const [smcBackgroundBatchSize, setSmcBackgroundBatchSize] = useState(SMC_BACKGROUND_DEFAULT_BATCH_SIZE)
  const [manualStartDate, setManualStartDate] = useState(() => {
    const now = new Date()
    return formatDateForSql(new Date(now.getFullYear(), now.getMonth() - 2, 1))
  })
  const [manualEndDate, setManualEndDate] = useState(() => {
    const now = new Date()
    return formatDateForSql(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  })

  async function loadSmcBackgroundJobState(showMessage = false) {
    const { data, error: stateError } = await supabase
      .from('smc_batch_job_state')
      .select('*')
      .eq('job_name', SMC_BACKGROUND_JOB_NAME)
      .maybeSingle()

    if (stateError) {
      if (showMessage) setError(`Lecture statut SMC arrière-plan impossible : ${stateError.message}`)
      return null
    }

    const state = (data || null) as SmcBackgroundJobState | null
    setSmcBackgroundState(state)

    if (showMessage) {
      if (!state) {
        setMaintenanceMessage('Aucun job SMC arrière-plan trouvé.')
      } else {
        const total = Number(state.total_clients || 0)
        const done = Number(state.processed_clients || 0)
        setMaintenanceMessage(
          `SMC arrière-plan : ${state.status || '—'} — ${done}/${total} client(s) traité(s).`
        )
      }
    }

    if (state?.status === 'done') {
      // Sécurité UI : le wrapper SQL se désactive aussi normalement tout seul.
      await supabase.rpc('smc_disable_period_batch_cron', {
        p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
      })
    }

    return state
  }

  useEffect(() => {
    loadSmcBackgroundJobState(false)
  }, [])

  useEffect(() => {
    if (smcBackgroundState?.status !== 'running') return

    const timer = window.setInterval(() => {
      loadSmcBackgroundJobState(false)
    }, SMC_BACKGROUND_POLL_MS)

    return () => window.clearInterval(timer)
  }, [smcBackgroundState?.status])

  function getSmcBackgroundProgressPercent() {
    const total = Number(smcBackgroundState?.total_clients || 0)
    const processed = Number(smcBackgroundState?.processed_clients || 0)
    if (!total) return 0
    return Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
  }

  function getSafeSmcBackgroundBatchSize() {
    const raw = Number(smcBackgroundBatchSize || SMC_BACKGROUND_DEFAULT_BATCH_SIZE)
    if (!Number.isFinite(raw)) return SMC_BACKGROUND_DEFAULT_BATCH_SIZE
    return Math.max(
      SMC_BACKGROUND_MIN_BATCH_SIZE,
      Math.min(SMC_BACKGROUND_MAX_BATCH_SIZE, Math.round(raw))
    )
  }

  async function disableSmcBackgroundCron(showMessage = true) {
    const { error: disableError } = await supabase.rpc('smc_disable_period_batch_cron', {
      p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
    })

    if (disableError) {
      throw new Error(`Désactivation cron SMC : ${disableError.message}`)
    }

    if (showMessage) {
      setMaintenanceMessage('Cron SMC arrière-plan désactivé.')
    }
  }

  async function startSmcBackgroundJob(
    period: SmcRpcPeriod,
    label: string,
    mode: 'restart' | 'resume' = 'restart'
  ) {
    if (maintenanceLoading || importing || smcBackgroundBusy) return

    const batchSize = getSafeSmcBackgroundBatchSize()
    const isResume = mode === 'resume'

    if (!window.confirm(
      `${isResume ? 'Reprendre' : 'Relancer depuis le début'} le job SMC en arrière-plan ?\n\n` +
      `${period.label}\n\n` +
      `Lot : ${batchSize} client(s).\n` +
      `${isResume ? 'La reprise conserve les clients déjà traités et repart du premier client non traité.' : 'La file de clients sera recréée et le traitement repartira de zéro.'}\n\n` +
      `Le cron sera activé automatiquement puis désactivé à la fin.`
    )) return

    setSmcBackgroundBusy(true)
    setMaintenanceLoading(true)
    setError(null)
    setMaintenanceMessage(
      isResume
        ? `${label} : arrêt propre du traitement bloqué puis reprise au point d'arrêt…`
        : `${label} : arrêt propre puis recréation de la file de clients SMC…`
    )

    try {
      const rpcName = isResume ? 'smc_resume_period_batch_job' : 'smc_restart_period_batch_job'
      const rpcPayload = isResume
        ? {
            p_job_name: SMC_BACKGROUND_JOB_NAME,
            p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
            p_batch_size: batchSize,
            p_enable_cron: true,
          }
        : {
            p_date_debut: period.p_date_debut,
            p_date_fin: period.p_date_fin,
            p_batch_size: batchSize,
            p_job_name: SMC_BACKGROUND_JOB_NAME,
            p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
            p_enable_cron: true,
          }

      const { data, error: rpcError } = await supabase.rpc(rpcName, rpcPayload)
      if (rpcError) throw new Error(`${rpcName} : ${rpcError.message}`)

      const row = Array.isArray(data) ? data[0] : data
      const totalClients = Number(row?.total_clients || row?.total_queue || 0)
      const processedClients = Number(row?.processed_clients || 0)

      await loadSmcBackgroundJobState(false)

      setMaintenanceMessage(
        `${label} ${isResume ? 'repris' : 'relancé'} en arrière-plan : ` +
        `${processedClients}/${totalClients} client(s), lots de ${batchSize}. ` +
        `La page suit l'avancement automatiquement.`
      )
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setSmcBackgroundBusy(false)
      setMaintenanceLoading(false)
    }
  }

  async function resumeSmcBackgroundJob(label = 'SMC') {
    if (maintenanceLoading || importing || smcBackgroundBusy) return

    const state = await loadSmcBackgroundJobState(false)
    if (!state) {
      setError('Aucun job SMC existant à reprendre. Lance d’abord un job depuis le début.')
      return
    }

    await startSmcBackgroundJob(
      {
        p_date_debut: state.date_debut || manualStartDate,
        p_date_fin: state.date_fin || manualEndDate,
        label: `${state.date_debut || manualStartDate} → ${state.date_fin || manualEndDate}`,
      },
      label,
      'resume'
    )
  }

  async function handleRunSmcBackgroundBatchNow() {
    if (smcBackgroundBusy || importing) return

    setSmcBackgroundBusy(true)
    setError(null)
    setMaintenanceMessage('Exécution immédiate du prochain lot SMC…')

    try {
      const { data, error: runError } = await supabase.rpc('smc_run_next_period_batch_and_stop_cron', {
        p_job_name: SMC_BACKGROUND_JOB_NAME,
        p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
      })

      if (runError) throw new Error(`smc_run_next_period_batch_and_stop_cron : ${runError.message}`)

      const row = Array.isArray(data) ? data[0] : data
      setMaintenanceMessage(
        `Lot SMC exécuté : ${Number(row?.processed_after || 0)}/${Number(row?.total_clients || 0)} client(s). ` +
        `${row?.done ? 'Job terminé, cron désactivé.' : 'Suite en arrière-plan.'}`
      )

      await loadSmcBackgroundJobState(false)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setSmcBackgroundBusy(false)
    }
  }

  async function handleStopSmcBackgroundCron() {
    if (smcBackgroundBusy) return

    if (!window.confirm(
      'Stopper proprement le job SMC ?\n\n' +
      'Le cron sera désactivé, le job sera marqué annulé et les éventuelles requêtes SMC en cours seront annulées.\n' +
      'Les clients déjà traités resteront marqués comme traités, ce qui permettra une reprise au point d’arrêt.'
    )) return

    setSmcBackgroundBusy(true)
    setError(null)
    setMaintenanceMessage('Arrêt propre du job SMC en cours…')

    try {
      const { error: stopError } = await supabase.rpc('smc_stop_period_batch_job', {
        p_job_name: SMC_BACKGROUND_JOB_NAME,
        p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
        p_cancel_running: true,
      })

      if (stopError) throw new Error(`smc_stop_period_batch_job : ${stopError.message}`)

      setMaintenanceMessage('Job SMC arrêté proprement. Tu peux reprendre au point d’arrêt ou relancer depuis le début.')
      await loadSmcBackgroundJobState(false)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setSmcBackgroundBusy(false)
    }
  }

  async function runRecentMonthsRebuild(_monthCount: 2 | 3 = 2, onProgress?: (detail: string) => void) {
    // Règle V21 : les rebuilds standards ne recalculent que M-1 et M.
    // Les périodes plus longues passent par le bloc manuel "Rebuild agrégats période".
    const periods = getMonthlyAggregatePeriods(2)

    await runRpcForPeriods('refresh_facture_entetes_cache_periode', periods, onProgress, 'Cache factures')
    await runRpcForPeriods('rebuild_indicateur_factures_mensuel_periode', periods, onProgress, 'Agrégat factures')

    await runRpcForPeriods('refresh_devis_entetes_cache_periode', periods, onProgress, 'Cache devis')
    await runRpcForPeriods('rebuild_indicateur_devis_mensuel_periode', periods, onProgress, 'Agrégat devis / vue')

    await runRpcForPeriods('rebuild_indicateur_activite_mensuel_periode', periods, onProgress, 'Agrégat activité')
  }

  async function handleManualRecentMonthsRebuild(monthCount: 2 | 3 = 3, blMxMode?: 'previous_month' | 'current_month') {
    if (maintenanceLoading || importing) return

    const confirmText = blMxMode
      ? `Confirmer le basculement BL M-x en mode ${blMxMode === 'previous_month' ? 'mois précédent' : 'mois courant'} sans rebuild complet ?`
      : `Confirmer le rebuild des agrégats rapides des ${monthCount} derniers mois, mois par mois, hors flux articles et hors SMC ?`

    if (!window.confirm(confirmText)) return

    setMaintenanceLoading(true)
    setMaintenanceMessage(`Préparation du rebuild agrégats rapides ${monthCount} mois…`)
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
        await runFluxArticlesForPeriods(
          periods,
          (detail) => setMaintenanceMessage(detail),
          'Flux articles après BL M-x'
        )
        setMaintenanceMessage(`BL M-x → ${blMxMode === 'previous_month' ? 'M-1' : 'M'} appliqué. Flux articles recalculé sur M-1/M. SMC non reconstruite automatiquement.`)
        await loadStats()
        await loadRows(selectedConfig)
        return
      }

      await runRecentMonthsRebuild(monthCount, (detail) => setMaintenanceMessage(detail))
      setMaintenanceMessage('Rebuild agrégats M-1/M terminé hors flux articles. Lance le rebuild flux articles dédié si les dates CDC/BL doivent être rafraîchies. SMC non reconstruite automatiquement.')
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

      if (!window.confirm(`Confirmer le rebuild des agrégats rapides de ${periods.length} mois, du ${manualStartDate} au ${manualEndDate}, hors flux articles et hors SMC ?`)) return

      setMaintenanceLoading(true)
      setMaintenanceMessage(`Préparation du rebuild agrégats rapides période ${manualStartDate} → ${manualEndDate}…`)
      setError(null)

      await runCompleteRebuildForPeriods(periods, (detail) => setMaintenanceMessage(detail))
      setMaintenanceMessage(`Rebuild agrégats période terminé hors flux articles : ${manualStartDate} → ${manualEndDate}. Lance le rebuild flux articles dédié si nécessaire.`)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  async function handleManualPeriodFluxRebuild() {
    if (maintenanceLoading || importing) return

    try {
      const periods = getMonthlyPeriodsCoveringDateInputs(manualStartDate, manualEndDate)
      if (!periods.length) throw new Error('Aucune période mensuelle à recalculer.')

      if (!window.confirm(
        `Confirmer le rebuild Flux articles de ${periods.length} mois, du ${manualStartDate} au ${manualEndDate} ?\n\n` +
          `Traitement potentiellement long : la RPC appelée est ${FLUX_ARTICLES_FRONT_REBUILD_RPC}.`
      )) return

      setMaintenanceLoading(true)
      setMaintenanceMessage(`Préparation rebuild flux articles période ${manualStartDate} → ${manualEndDate}…`)
      setError(null)

      await runFluxArticlesForPeriods(periods, (detail) => setMaintenanceMessage(detail), 'Flux articles période')
      setMaintenanceMessage(`Rebuild flux articles période terminé : ${manualStartDate} → ${manualEndDate}.`)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  async function handleManualRecentSmcRebuild() {
    const periods = getMonthlyAggregatePeriods(2)
    const firstPeriod = periods[0]
    const lastPeriod = periods[periods.length - 1]

    if (!firstPeriod || !lastPeriod) {
      setError('Impossible de déterminer la période SMC M-1/M.')
      return
    }

    await startSmcBackgroundJob(
      {
        p_date_debut: firstPeriod.p_date_debut,
        p_date_fin: lastPeriod.p_date_fin,
        label: `${firstPeriod.p_date_debut} → ${lastPeriod.p_date_fin}`,
      },
      'SMC M-1/M'
    )
  }

  async function handleManualPeriodSmcRebuild() {
    try {
      const period = getSmcPeriodCoveringDateInputs(manualStartDate, manualEndDate)
      await startSmcBackgroundJob(period, 'SMC période')
    } catch (e: any) {
      setError(e?.message || String(e))
      setMaintenanceMessage(null)
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


  async function fetchAutoImportStorageFiles() {
    const allFiles: AutoImportStorageFile[] = []

    for (const folder of AUTO_IMPORT_FOLDERS) {
      const { data, error: listError } = await supabase.storage
        .from(AUTO_IMPORT_BUCKET)
        .list(folder, {
          limit: 200,
          sortBy: { column: 'updated_at', order: 'desc' },
        })

      if (listError) {
        throw new Error(`Lecture bucket ${AUTO_IMPORT_BUCKET}/${folder} impossible : ${listError.message}`)
      }

      ;((data || []) as any[]).forEach((item) => {
        const name = String(item?.name || '').trim()
        if (!name || name === '.emptyFolderPlaceholder') return

        const path = `${folder}/${name}`
        allFiles.push({
          folder,
          name,
          path,
          kind: detectAutoImportFileKind(name),
          size: Number(item?.metadata?.size || item?.metadata?.contentLength || 0) || null,
          created_at: item?.created_at || item?.createdAt || null,
          updated_at: item?.updated_at || item?.updatedAt || null,
        })
      })
    }

    return allFiles.sort((a, b) => {
      const folderScore = (folder: AutoImportFolder) => AUTO_IMPORT_FOLDERS.indexOf(folder)
      const folderDelta = folderScore(a.folder) - folderScore(b.folder)
      if (folderDelta !== 0) return folderDelta
      return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
    })
  }

  async function loadAutomaticImportDashboard(showMessage = false) {
    setAutoImportLoading(true)
    setAutoImportError(null)

    try {
      const storageFiles = await fetchAutoImportStorageFiles()
      setAutoImportStorageFiles(storageFiles)

      const { data: runs, error: runsError } = await supabase
        .from('import_pipeline_runs')
        .select('*')
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(5)

      if (runsError) {
        throw new Error(`Lecture import_pipeline_runs impossible : ${runsError.message}`)
      }

      const runRows = (runs || []) as ImportPipelineRun[]
      if (runRows[0]) {
        const syncedRun = await syncLatestAutoImportRunWithSmcIfFinished(runRows[0])
        if (syncedRun) runRows[0] = syncedRun
      }
      setAutoImportPipelineRuns(runRows)

      const latestRunId = runRows[0]?.id
      let filesQuery = supabase
        .from('import_pipeline_files')
        .select('*')

      if (latestRunId !== undefined && latestRunId !== null) {
        filesQuery = filesQuery.eq('run_id', latestRunId)
      }

      const { data: pipelineFiles, error: pipelineFilesError } = await filesQuery
        .order('id', { ascending: false, nullsFirst: false })
        .limit(50)

      if (pipelineFilesError) {
        throw new Error(`Lecture import_pipeline_files impossible : ${pipelineFilesError.message}`)
      }

      setAutoImportPipelineFiles((pipelineFiles || []) as ImportPipelineFile[])

      if (showMessage) {
        setAutoImportMessage('Statut fichiers et dernier job global actualisés.')
      }
    } catch (e: any) {
      setAutoImportError(e?.message || String(e))
      if (showMessage) setAutoImportMessage(null)
    } finally {
      setAutoImportLoading(false)
    }
  }

  async function handleAutoImportFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''

    if (!files.length) return

    setAutoImportUploading(true)
    setAutoImportError(null)
    setAutoImportMessage(null)

    try {
      const invalidFiles = files.filter((file) => !isValidAutoImportFileName(file.name))
      if (invalidFiles.length) {
        throw new Error(
          'Fichier(s) refusé(s) : ' +
          invalidFiles.map((file) => file.name).join(', ') +
          '. Les fichiers attendus sont : Activite.xlsx, Facture.xlsx, Devis.xlsx. Le dépôt automatique les convertit ensuite en CSV découpés.'
        )
      }

      const selectedFileSetErrors = validateAutoImportPendingFileSet(
        files.map((file) => ({ name: file.name, kind: detectAutoImportFileKind(file.name) }))
      )

      if (selectedFileSetErrors.length) {
        throw new Error(
          'Sélection de fichiers incompatible avec le job global :\n' +
          selectedFileSetErrors.map((message) => `- ${message}`).join('\n')
        )
      }

      let uploadedCount = 0
      const splitSummaries: string[] = []

      for (const file of files) {
        const kind = detectAutoImportFileKind(file.name)
        const chunks = await splitXlsxForAutoImportUpload(file, kind)
        if (chunks.length > 1) {
          splitSummaries.push(`${file.name} → ${chunks.length} fichier(s) CSV de moins de ${formatFileSize(AUTO_IMPORT_MAX_CSV_CHUNK_BYTES)}`)
        }

        for (const chunk of chunks) {
          const cleanName = cleanStorageFileName(chunk.file.name)
          const storagePath = `pending/${cleanName}`

          const { error: uploadError } = await supabase.storage
            .from(AUTO_IMPORT_BUCKET)
            .upload(storagePath, chunk.file, {
              cacheControl: '3600',
              contentType: chunk.file.type || (isAutoImportCsv(chunk.file.name) ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
              upsert: false,
            })

          if (uploadError) {
            throw new Error(`Upload ${storagePath} impossible : ${uploadError.message}`)
          }
          uploadedCount += 1
        }
      }

      setAutoImportMessage(
        `${uploadedCount} fichier(s) chargé(s) dans ${AUTO_IMPORT_BUCKET}/pending. ` +
        (splitSummaries.length ? `${splitSummaries.join(' · ')}. ` : '') +
        'Tu peux lancer le job global.'
      )
      await loadAutomaticImportDashboard(false)
    } catch (e: any) {
      setAutoImportError(e?.message || String(e))
      setAutoImportMessage(null)
    } finally {
      setAutoImportUploading(false)
    }
  }


  function sortAutoImportFilesForPipeline(files: AutoImportStorageFile[]) {
    const order: Record<AutoImportFileKind, number> = {
      Activite: 1,
      Facture: 2,
      Devis: 3,
      Invalide: 99,
    }

    return [...files].sort((a, b) => {
      const orderDelta = (order[a.kind] || 99) - (order[b.kind] || 99)
      if (orderDelta !== 0) return orderDelta
      return a.name.localeCompare(b.name)
    })
  }

  function getAutoImportFluxArticlesMonthlyPeriods() {
    const fluxPeriod = getAutoImportFluxArticlesPeriod()
    const startParts = fluxPeriod.p_date_debut.split('-').map(Number)
    const endParts = fluxPeriod.p_date_fin.split('-').map(Number)
    return getMonthlyPeriodsBetween(
      new Date(startParts[0], startParts[1] - 1, 1),
      new Date(endParts[0], endParts[1] - 1, 1)
    )
  }

  function buildStorageTargetPath(folder: AutoImportFolder, originalName: string, runId: number | null) {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    const prefix = runId ? `${timestamp}_run${runId}` : timestamp
    return `${folder}/${prefix}_${cleanStorageFileName(originalName)}`
  }

  async function moveAutoImportFile(fromPath: string, folder: AutoImportFolder, originalName: string, runId: number | null) {
    const toPath = buildStorageTargetPath(folder, originalName, runId)
    const { error: moveError } = await supabase.storage
      .from(AUTO_IMPORT_BUCKET)
      .move(fromPath, toPath)

    if (moveError) {
      throw new Error(`Déplacement Storage ${fromPath} → ${toPath} impossible : ${moveError.message}`)
    }

    return toPath
  }

  async function downloadAutoImportFileAsFile(storagePath: string, fileName: string) {
    const { data, error: downloadError } = await supabase.storage
      .from(AUTO_IMPORT_BUCKET)
      .download(storagePath)

    if (downloadError || !data) {
      throw new Error(`Téléchargement ${storagePath} impossible : ${downloadError?.message || 'fichier introuvable'}`)
    }

    return new File([data], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }

  async function createAutoImportRun(pendingFiles: AutoImportStorageFile[], fluxPeriod: SmcRpcPeriod, smcPeriod: SmcRpcPeriod) {
    const { data, error: insertError } = await supabase
      .from('import_pipeline_runs')
      .insert({
        status: 'running',
        current_step: 'Initialisation du pipeline',
        started_at: new Date().toISOString(),
        date_debut: smcPeriod.p_date_debut,
        date_fin: smcPeriod.p_date_fin,
        message:
          `Fichiers pending : ${pendingFiles.map((file) => file.name).join(', ')}. ` +
          `Flux articles : ${fluxPeriod.label}. SMC : ${smcPeriod.label}.`,
      })
      .select('*')
      .single()

    if (insertError) {
      throw new Error(`Création import_pipeline_runs impossible : ${insertError.message}`)
    }

    return data as ImportPipelineRun
  }

  async function updateAutoImportRun(runId: number, patch: GenericRow) {
    const { error: updateError } = await supabase
      .from('import_pipeline_runs')
      .update(patch)
      .eq('id', runId)

    if (updateError) {
      throw new Error(`Mise à jour import_pipeline_runs #${runId} impossible : ${updateError.message}`)
    }
  }

  async function createAutoImportPipelineFile(runId: number, file: AutoImportStorageFile) {
    const { data, error: insertError } = await supabase
      .from('import_pipeline_files')
      .insert({
        run_id: runId,
        original_filename: file.name,
        file_type: file.kind,
        storage_path_initial: file.path,
        status: 'pending',
      })
      .select('*')
      .single()

    if (insertError) {
      throw new Error(`Création import_pipeline_files pour ${file.name} impossible : ${insertError.message}`)
    }

    return data as ImportPipelineFile
  }

  async function updateAutoImportPipelineFile(fileRowId: number | undefined, patch: GenericRow) {
    if (!fileRowId) return

    const { error: updateError } = await supabase
      .from('import_pipeline_files')
      .update(patch)
      .eq('id', fileRowId)

    if (updateError) {
      throw new Error(`Mise à jour import_pipeline_files #${fileRowId} impossible : ${updateError.message}`)
    }
  }

  async function importAutoStorageExcelWithExistingLogic(storagePath: string, storageFile: AutoImportStorageFile) {
    const config = getTableConfigForAutoImportKind(storageFile.kind)
    const file = await downloadAutoImportFileAsFile(storagePath, storageFile.name)

    resetImportProgress()
    updateImportStep('read', 'running', `${file.name} — lecture depuis Storage`)
    const parsedRows = await parseExcelRows(file, config)
    updateImportStep('read', 'done', `${parsedRows.length} ligne(s) lue(s)`)

    updateImportStep('normalize', 'running', 'Analyse des colonnes et conversion des dates/nombres')
    const parseErrors = parsedRows.flatMap((row) => Array.isArray(row.__errors) ? row.__errors : [])
    const cleanedRows = parsedRows.map(({ __errors, ...row }) => row)
    updateImportStep('normalize', 'done', `${parseErrors.length} avertissement(s) de mapping/conversion`)

    updateImportStep('validate', 'running', 'Contrôle des champs obligatoires')
    const { valid, errors } = validateRows(cleanedRows, config)
    const { rows: deduplicatedRows, duplicates } = deduplicateRows(valid, config)
    updateImportStep(
      'validate',
      'done',
      `${valid.length} ligne(s) valide(s), ${errors.length} rejet(s), ${duplicates.length} doublon(s) dans le fichier`
    )

    const technicalMessages = [...parseErrors, ...errors, ...duplicates]

    if (!deduplicatedRows.length) {
      await executeValidatedImportRows(config, [], technicalMessages)
      throw new Error(`Aucune ligne valide à importer dans ${file.name}.`)
    }

    // Les trois fichiers du pipeline sont des tables de lignes. On garde strictement
    // la logique d'import existante : validation, contrôles d'existence, insert/upsert,
    // refresh/cache déjà présents dans executeValidatedImportRows().
    await executeValidatedImportRows(config, deduplicatedRows, technicalMessages)

    return {
      table: config.label,
      rowsRead: parsedRows.length,
      rowsValid: valid.length,
      rowsReady: deduplicatedRows.length,
      warnings: technicalMessages.length,
    }
  }

  function formatAutoImportPreSmcReport(args: {
    runId: number
    startedAt: string
    importedFiles: GenericRow[]
    fluxPeriods: RpcPeriod[]
    smcPeriod: SmcRpcPeriod
  }) {
    return [
      `Pipeline automatique #${args.runId} — rapport avant SMC`,
      `Début : ${formatDateTime(args.startedAt)}`,
      '',
      'Fichiers importés :',
      ...args.importedFiles.map((file) => (
        `- ${file.type} : ${file.name} — OK — ${file.rowsReady} ligne(s) prêtes/importées sur ${file.rowsRead} lue(s)` +
        `${file.warnings ? ` — ${file.warnings} avertissement(s)` : ''}`
      )),
      '',
      `Flux articles : OK — ${args.fluxPeriods.length} mois recalculé(s), de ${args.fluxPeriods[0]?.p_date_debut || '—'} à ${args.fluxPeriods[args.fluxPeriods.length - 1]?.p_date_fin || '—'}.`,
      '',
      `SMC : non terminé à ce stade — lancement prévu sur ${args.smcPeriod.label}.`,
    ].join('\n')
  }

  async function startSmcBackgroundJobFromPipeline(period: SmcRpcPeriod, runId: number) {
    const batchSize = getSafeSmcBackgroundBatchSize()

    const { data, error: rpcError } = await supabase.rpc('smc_restart_period_batch_job', {
      p_date_debut: period.p_date_debut,
      p_date_fin: period.p_date_fin,
      p_batch_size: batchSize,
      p_job_name: SMC_BACKGROUND_JOB_NAME,
      p_cron_job_name: SMC_BACKGROUND_CRON_JOB_NAME,
      p_enable_cron: true,
    })

    if (rpcError) {
      throw new Error(`smc_restart_period_batch_job : ${rpcError.message}`)
    }

    const row = Array.isArray(data) ? data[0] : data
    await loadSmcBackgroundJobState(false)

    return {
      totalClients: Number(row?.total_clients || row?.total_queue || 0),
      processedClients: Number(row?.processed_clients || 0),
      batchSize,
      runId,
    }
  }

  async function syncLatestAutoImportRunWithSmcIfFinished(run: ImportPipelineRun | null) {
    if (!run?.id || String(run.status || '').toLowerCase() !== 'smc_running') return run

    const { data: stateData, error: stateError } = await supabase
      .from('smc_batch_job_state')
      .select('*')
      .eq('job_name', SMC_BACKGROUND_JOB_NAME)
      .maybeSingle()

    if (stateError || !stateData) return run

    const state = stateData as SmcBackgroundJobState
    const total = Number(state.total_clients || 0)
    const processed = Number(state.processed_clients || 0)
    const nowIso = new Date().toISOString()

    if (state.status === 'done') {
      const finalReport = [
        `Pipeline automatique #${run.id} — rapport final`,
        `SMC : OK — ${processed}/${total} client(s) traité(s).`,
        `Fin détectée : ${formatDateTime(nowIso)}.`,
        '',
        run.pre_smc_report ? 'Rappel rapport avant SMC :' : '',
        run.pre_smc_report || '',
      ].filter(Boolean).join('\n')

      const patch = {
        status: 'done',
        current_step: 'Terminé',
        finished_at: nowIso,
        smc_finished_at: nowIso,
        final_report: finalReport,
        message: `Pipeline terminé avec succès. SMC ${processed}/${total} client(s).`,
      }

      const { error: updateError } = await supabase
        .from('import_pipeline_runs')
        .update(patch)
        .eq('id', run.id)

      if (!updateError) return { ...run, ...patch }
    }

    if (['error', 'failed', 'ko', 'cancelled', 'canceled'].includes(String(state.status || '').toLowerCase())) {
      const patch = {
        status: 'error',
        current_step: 'Erreur SMC',
        finished_at: nowIso,
        smc_finished_at: nowIso,
        error_message: `SMC terminé en statut ${state.status}. ${processed}/${total} client(s) traité(s).`,
        final_report: `Pipeline automatique #${run.id} — erreur SMC\nStatut SMC : ${state.status}\nClients traités : ${processed}/${total}`,
      }

      const { error: updateError } = await supabase
        .from('import_pipeline_runs')
        .update(patch)
        .eq('id', run.id)

      if (!updateError) return { ...run, ...patch }
    }

    return run
  }

  async function runAutoImportPipelineFromBucket(pendingFiles: AutoImportStorageFile[]) {
    const sortedPendingFiles = sortAutoImportFilesForPipeline(pendingFiles)
    const fluxPeriod = getAutoImportFluxArticlesPeriod()
    const fluxPeriods = getAutoImportFluxArticlesMonthlyPeriods()
    const smcPeriod = getSmcPeriodCoveringDateInputs(manualStartDate, manualEndDate)

    const run = await createAutoImportRun(sortedPendingFiles, fluxPeriod, smcPeriod)
    const runId = Number(run.id)
    const startedAt = run.started_at || new Date().toISOString()
    const importedFiles: GenericRow[] = []

    setImporting(true)

    try {
      for (const storageFile of sortedPendingFiles) {
        await updateAutoImportRun(runId, {
          current_step: `Import ${storageFile.kind} — ${storageFile.name}`,
          status: 'running',
        })

        const pipelineFile = await createAutoImportPipelineFile(runId, storageFile)
        let processingPath = ''

        try {
          processingPath = await moveAutoImportFile(storageFile.path, 'processing', storageFile.name, runId)
          await updateAutoImportPipelineFile(pipelineFile.id, {
            status: 'processing',
            storage_path_processing: processingPath,
          })

          setAutoImportMessage(`Import ${storageFile.kind} en cours : ${storageFile.name}`)
          const result = await importAutoStorageExcelWithExistingLogic(processingPath, storageFile)

          const archivePath = await moveAutoImportFile(processingPath, 'archive', storageFile.name, runId)
          await updateAutoImportPipelineFile(pipelineFile.id, {
            status: 'imported',
            imported_at: new Date().toISOString(),
            storage_path_final: archivePath,
          })

          importedFiles.push({
            type: storageFile.kind,
            name: storageFile.name,
            archivePath,
            ...result,
          })
        } catch (fileError: any) {
          const rejectedPath = processingPath
            ? await moveAutoImportFile(processingPath, 'rejected', storageFile.name, runId).catch(() => processingPath)
            : storageFile.path

          await updateAutoImportPipelineFile(pipelineFile.id, {
            status: 'error',
            storage_path_final: rejectedPath,
            error_message: fileError?.message || String(fileError),
          })

          throw fileError
        }
      }

      await updateAutoImportRun(runId, {
        current_step: `Rebuild flux_articles ${AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK} mois`,
        status: 'running',
      })

      setAutoImportMessage(`Rebuild flux_articles sur ${AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK} mois, mois par mois…`)
      await runFluxArticlesForPeriods(
        fluxPeriods,
        (detail) => setAutoImportMessage(detail),
        'Pipeline flux_articles'
      )

      const preSmcReport = formatAutoImportPreSmcReport({
        runId,
        startedAt,
        importedFiles,
        fluxPeriods,
        smcPeriod,
      })

      await updateAutoImportRun(runId, {
        status: 'pre_smc_done',
        current_step: 'Rapport avant SMC généré',
        pre_smc_report_at: new Date().toISOString(),
        pre_smc_report: preSmcReport,
      })

      await updateAutoImportRun(runId, {
        status: 'smc_running',
        current_step: 'SMC en arrière-plan',
        smc_started_at: new Date().toISOString(),
        final_report:
          `Pipeline automatique #${runId}\n` +
          `Imports et flux_articles terminés.\n` +
          `SMC lancé en arrière-plan sur ${smcPeriod.label}.\n` +
          `Clique sur Actualiser statut pour produire le rapport final dès que SMC est terminé.`,
      })

      const smcLaunch = await startSmcBackgroundJobFromPipeline(smcPeriod, runId)

      return {
        runId,
        message:
          `Job global #${runId} lancé. Imports + flux_articles OK. ` +
          `SMC lancé en arrière-plan : ${smcLaunch.processedClients}/${smcLaunch.totalClients} client(s), lots de ${smcLaunch.batchSize}.`,
      }
    } catch (pipelineError: any) {
      const msg = pipelineError?.message || String(pipelineError)
      await updateAutoImportRun(runId, {
        status: 'error',
        current_step: 'Erreur pipeline',
        finished_at: new Date().toISOString(),
        error_message: msg,
        final_report: `Pipeline automatique #${runId} — ERREUR\n${msg}`,
      }).catch(() => undefined)
      throw pipelineError
    } finally {
      setImporting(false)
    }
  }

  async function handleStartAutoImportPipeline(launchSmc: boolean) {
    if (autoImportRunning || autoImportUploading || importing || maintenanceLoading) return

    setAutoImportRunning(true)
    setAutoImportError(null)
    setAutoImportMessage(null)

    try {
      const storageFiles = await fetchAutoImportStorageFiles()
      setAutoImportStorageFiles(storageFiles)

      const pendingFiles = storageFiles.filter((file) => file.folder === 'pending')
      if (!pendingFiles.length) {
        throw new Error('Aucun fichier à traiter dans commercial-imports/pending.')
      }

      const invalidPending = pendingFiles.filter((file) => !isValidAutoImportFileName(file.name))
      if (invalidPending.length) {
        throw new Error(
          'Le dossier pending contient des fichiers non conformes : ' +
          invalidPending.map((file) => file.name).join(', ') +
          '. Déplace-les en rejected ou renomme-les avant de lancer le job.'
        )
      }

      const pendingFileSetErrors = validateAutoImportPendingFileSet(
        pendingFiles.map((file) => ({ name: file.name, kind: file.kind }))
      )

      if (pendingFileSetErrors.length) {
        throw new Error(
          'Le dossier pending contient des fichiers incompatibles avec le lancement du job global :\n' +
          pendingFileSetErrors.map((message) => `- ${message}`).join('\n')
        )
      }

      const fluxPeriod = getAutoImportFluxArticlesPeriod()
      const smcPeriod = getSmcPeriodCoveringDateInputs(manualStartDate, manualEndDate)

      const confirmed = window.confirm(
        `${launchSmc ? 'Lancer le job global serveur AVEC SMC ?' : 'Lancer le job global serveur SANS SMC ?'}\n\n` +
        `Fichiers pending : ${pendingFiles.map((file) => file.name).join(', ')}\n\n` +
        `Flux articles : ${fluxPeriod.label} (${AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK} mois), mois par mois.\n` +
        `PDF : commercial-imports/reports/focus-mensuel/Rapport d'activité quotidien.pdf sera écrasé.\n` +
        `SMC : ${launchSmc ? `${smcPeriod.label} — lancement automatique après rapport avant SMC` : 'non lancé — arrêt après rapport avant SMC'}.\n` +
        `Email rapport avant SMC : ${autoImportSendReportEmail && autoImportReportEmailTo.trim() ? autoImportReportEmailTo.trim() : 'non demandé'}.\n\n` +
        `Le traitement sera déclenché côté Supabase Edge Function (${AUTO_IMPORT_EDGE_FUNCTION_NAME}). ` +
        `Tu pourras fermer le front après confirmation de création du run : l'écran ne servira plus qu'au suivi des rapports.`
      )

      if (!confirmed) return

      setAutoImportMessage(
        `Création du job serveur via ${AUTO_IMPORT_EDGE_FUNCTION_NAME}… ` +
        'Après confirmation, tu peux fermer cet onglet et revenir plus tard pour suivre les rapports.'
      )

      const { data, error: invokeError } = await supabase.functions.invoke(AUTO_IMPORT_EDGE_FUNCTION_NAME, {
        body: {
          action: 'start',
          bucket: AUTO_IMPORT_BUCKET,
          flux_months_back: AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK,
          smc_date_debut: smcPeriod.p_date_debut,
          smc_date_fin: smcPeriod.p_date_fin,
          smc_batch_size: getSafeSmcBackgroundBatchSize(),
          report_email_to: autoImportSendReportEmail ? autoImportReportEmailTo.trim() : '',
          send_report_email: autoImportSendReportEmail,
          launch_smc: launchSmc,
          expected_files: pendingFiles.map((file) => ({
            name: file.name,
            path: file.path,
            kind: file.kind,
          })),
        },
      })

      if (invokeError) {
        throw new Error(
          `${AUTO_IMPORT_EDGE_FUNCTION_NAME} : ${invokeError.message}. ` +
          `Déploie d'abord la Supabase Edge Function fournie, puis relance le job.`
        )
      }

      const runId = Number((data as any)?.run_id || (data as any)?.runId || 0)
      setAutoImportMessage(
        `Job serveur${runId ? ` #${runId}` : ''} créé. ` +
        `Le serveur va importer les fichiers, reconstruire flux_articles, reconstruire Focus Mensuel et produire le rapport avant SMC. ` +
        `${launchSmc ? 'SMC sera lancé automatiquement ensuite. ' : 'SMC ne sera pas lancé : le job s’arrêtera après le rapport avant SMC. '}` +
        `Tu peux fermer le front ; utilise Actualiser statut pour suivre l'avancement.`
      )

      await loadAutomaticImportDashboard(false)
      await loadStats()
      await loadRows(selectedConfig)
    } catch (e: any) {
      setAutoImportError(e?.message || String(e))
      setAutoImportMessage(null)
    } finally {
      setAutoImportRunning(false)
    }
  }

  function getAutoImportRunDuration(run: ImportPipelineRun | null) {
    if (!run?.started_at) return '—'
    const end = run.finished_at || run.updated_at || null
    if (!end) return '—'
    const startMs = new Date(run.started_at).getTime()
    const endMs = new Date(end).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '—'
    const seconds = Math.round((endMs - startMs) / 1000)
    if (seconds < 60) return `${seconds} s`
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
  }

  function getAutoImportFileDisplayPath(file: ImportPipelineFile) {
    return (
      file.storage_path_final ||
      file.storage_path_processing ||
      file.storage_path_initial ||
      file.original_filename ||
      '—'
    )
  }



  const latestAutoImportRun = autoImportPipelineRuns[0] || null
  const latestSuccessfulAutoImportRun = autoImportPipelineRuns.find((run) => isAutoImportRunSuccess(run.status)) || null
  const autoImportPendingFiles = autoImportStorageFiles.filter((file) => file.folder === 'pending')
  const autoImportProcessingFiles = autoImportStorageFiles.filter((file) => file.folder === 'processing')
  const autoImportRejectedFiles = autoImportStorageFiles.filter((file) => file.folder === 'rejected')
  const autoImportArchivedFiles = autoImportStorageFiles.filter((file) => file.folder === 'archive')
  const autoImportBusy = autoImportLoading || autoImportUploading || autoImportRunning
  const latestAutoImportReport = getPipelineRunReport(latestAutoImportRun, autoImportReportTab)

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
                {maintenanceLoading ? 'Rebuild…' : 'Rebuild agrégats rapides M-1 + M'}
              </button>
              <button
                type="button"
                onClick={handleManualRecentSmcRebuild}
                disabled={maintenanceLoading || importing || smcBackgroundBusy}
                className="rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                SMC M-1 + M arrière-plan
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
              Rebuilds période — du
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
            <label className="text-xs font-bold uppercase text-slate-500">
              Lot SMC
              <input
                type="number"
                min={SMC_BACKGROUND_MIN_BATCH_SIZE}
                max={SMC_BACKGROUND_MAX_BATCH_SIZE}
                value={smcBackgroundBatchSize}
                onChange={(event) => setSmcBackgroundBatchSize(Number(event.target.value || SMC_BACKGROUND_DEFAULT_BATCH_SIZE))}
                className="mt-1 block h-10 w-24 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-900"
              />
            </label>
            <button
              type="button"
              onClick={handleManualPeriodRebuild}
              disabled={maintenanceLoading || importing}
              className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Rebuild agrégats rapides période
            </button>
            <button
              type="button"
              onClick={handleManualPeriodFluxRebuild}
              disabled={maintenanceLoading || importing}
              className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Rebuild flux articles période
            </button>
            <button
              type="button"
              onClick={handleManualPeriodSmcRebuild}
              disabled={maintenanceLoading || importing || smcBackgroundBusy}
              className="rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              SMC période depuis début
            </button>
            <button
              type="button"
              onClick={() => resumeSmcBackgroundJob('SMC période')}
              disabled={maintenanceLoading || importing || smcBackgroundBusy || !smcBackgroundState}
              className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reprendre SMC au point d'arrêt
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
              La date de fin est traitée comme mois inclus. Les agrégats rapides et le flux articles restent découpés par mois. SMC est lancé en arrière-plan via pg_cron, par lots de clients paramétrables. La reprise conserve les clients déjà traités.
            </div>
          </div>

          {maintenanceMessage && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{maintenanceMessage}</div>}

          {smcBackgroundState && (
            <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black uppercase tracking-wide text-cyan-900">
                    Job SMC arrière-plan
                  </div>
                  <div className="mt-1 text-sm font-bold text-cyan-950">
                    Statut : {smcBackgroundState.status || '—'} — {Number(smcBackgroundState.processed_clients || 0)} / {Number(smcBackgroundState.total_clients || 0)} client(s)
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-cyan-700 transition-all"
                      style={{ width: `${getSmcBackgroundProgressPercent()}%` }}
                    />
                  </div>
                  <div className="mt-2 grid gap-1 text-xs font-semibold text-cyan-900 sm:grid-cols-2 lg:grid-cols-4">
                    <div>Dernier rang : {smcBackgroundState.last_rn || 0}</div>
                    <div>Lot en base : {smcBackgroundState.batch_size || '—'} clients</div>
                    <div>Lot demandé : {getSafeSmcBackgroundBatchSize()} clients</div>
                    <div>Début : {formatDateTime(smcBackgroundState.started_at || null)}</div>
                    <div>Fin : {formatDateTime(smcBackgroundState.finished_at || null)}</div>
                  </div>
                  {smcBackgroundState.last_error && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-red-50 p-2 text-xs font-semibold text-red-700">
                      {smcBackgroundState.last_error}
                    </pre>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => loadSmcBackgroundJobState(true)}
                    disabled={smcBackgroundBusy}
                    className="rounded-xl border border-cyan-300 bg-white px-3 py-2 text-xs font-bold text-cyan-900 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Actualiser statut
                  </button>
                  {smcBackgroundState.status !== 'done' && (
                    <button
                      type="button"
                      onClick={handleRunSmcBackgroundBatchNow}
                      disabled={smcBackgroundBusy || importing}
                      className="rounded-xl border border-cyan-300 bg-white px-3 py-2 text-xs font-bold text-cyan-900 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Lancer le prochain lot
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => resumeSmcBackgroundJob('SMC')}
                    disabled={smcBackgroundBusy || importing}
                    className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reprendre au point d'arrêt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const start = smcBackgroundState.date_debut || manualStartDate
                      const end = smcBackgroundState.date_fin || manualEndDate
                      void startSmcBackgroundJob(
                        { p_date_debut: start, p_date_fin: end, label: `${start} → ${end}` },
                        'SMC',
                        'restart'
                      )
                    }}
                    disabled={smcBackgroundBusy || importing}
                    className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Relancer depuis début
                  </button>
                  {smcBackgroundState.status === 'running' && (
                    <button
                      type="button"
                      onClick={handleStopSmcBackgroundCron}
                      disabled={smcBackgroundBusy}
                      className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Stopper proprement
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>


        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight">Pipeline automatique serveur — fichiers & job global</h2>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                Dépôt dans le bucket <b>{AUTO_IMPORT_BUCKET}</b>, dossier <b>pending</b>. Les fichiers attendus sont <b>Activite.xlsx</b>, <b>Facture.xlsx</b> et <b>Devis.xlsx</b>.
                Les fichiers Excel sont automatiquement convertis et découpés en plusieurs <b>.csv</b> de moins de <b>500 Ko</b>, en conservant la ligne d’entête et sans couper un même numéro de document entre deux fichiers. Les imports manuels existants ne sont pas modifiés :
                ce bloc ne fait que charger les fichiers découpés, lancer le job global et afficher les rapports.
                Le pipeline serveur traite ensuite <b>un seul morceau par invocation</b>, pour éviter les limites CPU/mémoire, puis relance <b>flux_articles</b> sur les <b>{AUTO_IMPORT_FLUX_ARTICLES_MONTHS_BACK} derniers mois</b>, reconstruit le <b>cache Focus Mensuel du mois courant</b>, génère le PDF <b>reports/focus-mensuel/Rapport d'activité quotidien.pdf</b> en écrasant l'ancien fichier, génère le rapport avant SMC, puis lance ou non SMC selon le bouton choisi.
              </p>
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoImportSendReportEmail}
                    onChange={(event) => setAutoImportSendReportEmail(event.target.checked)}
                    disabled={autoImportBusy || importing || maintenanceLoading}
                  />
                  Envoyer le rapport avant SMC + PDF Focus Mensuel par email
                </label>
                <input
                  type="text"
                  value={autoImportReportEmailTo}
                  onChange={(event) => setAutoImportReportEmailTo(event.target.value)}
                  placeholder="adresse1@domaine.fr; adresse2@domaine.fr"
                  disabled={!autoImportSendReportEmail || autoImportBusy || importing || maintenanceLoading}
                  className="min-w-[320px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 disabled:bg-slate-100"
                />
                <span className="text-[11px] font-semibold text-slate-500">Plusieurs adresses possibles, séparées par ; ou ,</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
                {autoImportUploading ? 'Chargement…' : 'Charger fichier(s) pending'}
                <input
                  type="file"
                  accept=".xlsx"
                  multiple
                  className="hidden"
                  onChange={handleAutoImportFileUpload}
                  disabled={autoImportBusy || importing || maintenanceLoading}
                />
              </label>
              <button
                type="button"
                onClick={() => handleStartAutoImportPipeline(false)}
                disabled={autoImportBusy || importing || maintenanceLoading || autoImportPendingFiles.length === 0}
                className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {autoImportRunning ? 'Job global…' : 'Job global sans SMC'}
              </button>
              <button
                type="button"
                onClick={() => handleStartAutoImportPipeline(true)}
                disabled={autoImportBusy || importing || maintenanceLoading || autoImportPendingFiles.length === 0}
                className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {autoImportRunning ? 'Job global…' : 'Job global avec SMC'}
              </button>
              <button
                type="button"
                onClick={() => loadAutomaticImportDashboard(true)}
                disabled={autoImportBusy}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Actualiser statut
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Dernier job global</div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusBadgeClass(latestAutoImportRun?.status)}`}>
                  {latestAutoImportRun?.status || 'Aucun'}
                </span>
                {latestAutoImportRun?.current_step && (
                  <span className="truncate text-xs font-bold text-slate-600">{latestAutoImportRun.current_step}</span>
                )}
              </div>
              <div className="mt-2 text-sm font-bold text-slate-900">
                Début : {formatDateTime(latestAutoImportRun?.started_at || null)}
              </div>
              <div className="text-xs font-semibold text-slate-500">
                Fin : {formatDateTime(latestAutoImportRun?.finished_at || null)} · Durée : {getAutoImportRunDuration(latestAutoImportRun)}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-emerald-800">Dernière bonne exécution</div>
              <div className="mt-2 text-lg font-black text-emerald-950">
                {latestSuccessfulAutoImportRun
                  ? formatDateTime(latestSuccessfulAutoImportRun.finished_at || latestSuccessfulAutoImportRun.smc_finished_at || latestSuccessfulAutoImportRun.started_at || null)
                  : '—'}
              </div>
              <div className="mt-1 text-xs font-semibold text-emerald-700">
                {latestSuccessfulAutoImportRun
                  ? `Run n°${latestSuccessfulAutoImportRun.id || '—'} · ${latestSuccessfulAutoImportRun.status || 'OK'}`
                  : 'Aucun run terminé avec succès dans les derniers runs.'}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-amber-800">Fichiers pending</div>
              <div className="mt-2 text-lg font-black text-amber-950">{autoImportPendingFiles.length}</div>
              <div className="mt-1 text-xs font-semibold text-amber-700">
                {autoImportPendingFiles.length
                  ? autoImportPendingFiles.map((file) => `${file.kind}: ${file.name}`).join(' · ')
                  : 'Aucun fichier en attente.'}
              </div>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-blue-800">Processing / rejetés / archive</div>
              <div className="mt-2 text-lg font-black text-blue-950">
                {autoImportProcessingFiles.length} / {autoImportRejectedFiles.length} / {autoImportArchivedFiles.length}
              </div>
              <div className="mt-1 text-xs font-semibold text-blue-700">
                Suivi direct du bucket {AUTO_IMPORT_BUCKET}.
              </div>
            </div>
          </div>

          {(autoImportMessage || autoImportError) && (
            <div className="mt-4 space-y-2">
              {autoImportMessage && (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                  {autoImportMessage}
                </div>
              )}
              {autoImportError && (
                <pre className="whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
                  {autoImportError}
                </pre>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Fichiers du bucket</h3>
                  <p className="text-xs text-slate-500">Le job ne consomme que le dossier pending. Les autres dossiers sont affichés pour contrôle.</p>
                </div>
                {autoImportLoading && <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">Lecture…</span>}
              </div>

              <div className="max-h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2 text-left">Dossier</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left">Type</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left">Fichier</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Taille</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left">MAJ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoImportStorageFiles.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center font-semibold text-slate-500">
                          Aucun fichier détecté dans pending / processing / rejected / archive.
                        </td>
                      </tr>
                    ) : (
                      autoImportStorageFiles.map((file) => (
                        <tr key={file.path} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${folderBadgeClass(file.folder)}`}>
                              {file.folder}
                            </span>
                          </td>
                          <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${fileKindBadgeClass(file.kind)}`}>
                              {file.kind}
                            </span>
                          </td>
                          <td className="max-w-[360px] truncate border-b border-slate-100 px-3 py-2 font-semibold" title={file.path}>
                            {file.name}
                          </td>
                          <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-right font-semibold">
                            {formatFileSize(file.size)}
                          </td>
                          <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-slate-500">
                            {formatDateTime(file.updated_at || file.created_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Rapports du dernier job</h3>
                  <p className="text-xs text-slate-500">
                    Rapport intermédiaire avant SMC, rapport final et erreurs remontées par le run.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['pre_smc', 'final', 'errors'] as AutoImportReportTab[]).map((tab) => {
                    const label = tab === 'pre_smc' ? 'Avant SMC' : tab === 'final' ? 'Final' : 'Erreurs'
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setAutoImportReportTab(tab)}
                        className={`rounded-xl border px-3 py-2 text-xs font-black ${
                          autoImportReportTab === tab
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                  <span>Run n°{latestAutoImportRun?.id || '—'}</span>
                  <span>·</span>
                  <span>Rapport avant SMC : {formatDateTime(latestAutoImportRun?.pre_smc_report_at || null)}</span>
                  <span>·</span>
                  <span>SMC fin : {formatDateTime(latestAutoImportRun?.smc_finished_at || null)}</span>
                  {latestAutoImportRun?.focus_pdf_path && (
                    <>
                      <span>·</span>
                      <span>PDF Focus : {latestAutoImportRun.focus_pdf_path}</span>
                    </>
                  )}
                  {latestAutoImportRun?.report_email_status && (
                    <>
                      <span>·</span>
                      <span>Email : {latestAutoImportRun.report_email_status}</span>
                    </>
                  )}
                </div>
                <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs font-semibold text-slate-50">
                  {latestAutoImportReport}
                </pre>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-600">
                  Fichiers rattachés au dernier run
                </div>
                <div className="max-h-[190px] overflow-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100">
                      <tr>
                        <th className="border-b border-slate-200 px-3 py-2 text-left">Type</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left">Statut</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left">Fichier</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left">Erreur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoImportPipelineFiles.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center font-semibold text-slate-500">
                            Aucun fichier rattaché au dernier run.
                          </td>
                        </tr>
                      ) : (
                        autoImportPipelineFiles.map((file) => (
                          <tr key={file.id || `${file.run_id}-${file.original_filename}`} className="align-top hover:bg-slate-50">
                            <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 font-bold">
                              {file.file_type || '—'}
                            </td>
                            <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${statusBadgeClass(file.status)}`}>
                                {file.status || '—'}
                              </span>
                            </td>
                            <td className="max-w-[260px] truncate border-b border-slate-100 px-3 py-2 font-semibold" title={getAutoImportFileDisplayPath(file)}>
                              {getAutoImportFileDisplayPath(file)}
                            </td>
                            <td className="max-w-[360px] border-b border-slate-100 px-3 py-2 text-red-700">
                              {file.error_message || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
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
