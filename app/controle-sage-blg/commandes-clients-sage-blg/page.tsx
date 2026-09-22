'use client';

/**
 * Page "Commandes clients SAGE ↔ BLG"
 * ---------------------------------------------------------------------
 * Comparaison des portefeuilles de commandes clients (CDC) entre SAGE et
 * BLG : vision SAGE d'une CDC (entête + lignes avec leur état : à livrer,
 * en préparation, expédiée, facturée non comptabilisée, facturée
 * comptabilisée), vision BLG (commande, livraisons, factures), écarts
 * détectés, fiche détail par CDC avec rapprochement article par article,
 * export Excel.
 *
 * Dépend des objets Supabase créés par la migration
 * supabase/migrations/20260922_cdc_sage_blg.sql (projet gchwihltydsplarhveyv) :
 *   - RPC get_cdc_comparaison_liste(p_date_from) → jsonb {refreshed_at, erreur, rows}
 *     (lit le cache mv_cdc_comparaison, rafraîchi toutes les heures par pg_cron)
 *   - RPC refresh_cdc_comparaison()              → rafraîchit ce cache à la demande (≈ 1 min)
 *   - RPC get_cdc_detail(p_reference)            → jsonb (fiche, temps réel)
 *   - vues v_cdc_comparaison, v_cdc_sage_lignes, v_cdc_blg_lignes,
 *          v_cdc_blg_livraisons, v_cdc_blg_factures (utilisées par les RPC)
 *
 * À déclarer dans lib/navigation.ts (bloc « Projet BLG »), route :
 *   app/cdc-sage-blg/page.tsx  →  /cdc-sage-blg
 *
 * Règles de lecture (documentées ici pour ne pas les redécouvrir) :
 *   - Périmètre SAGE = activite_entete type 1 (CDC non soldées) ; les lignes
 *     d'une même CDC peuvent être réparties entre bon de commande (reliquat à
 *     livrer), préparation de livraison, bon de livraison et facture — d'où
 *     les statuts d'entête « Liv. partielle », « Fact. partielle », etc.
 *   - « Facturée comptabilisée » vient de sage.facture_du_jour (VL_DOCTYPE 7),
 *     sur une fenêtre glissante : une facture plus ancienne que cette fenêtre
 *     est considérée comptabilisée.
 *   - Périmètre BLG = commandes de vente (equipment / distribution) encore
 *     ouvertes (non livrées ou non facturées) + toutes celles connues de SAGE.
 *   - Le montant est comparé sur la somme des lignes : l'entête SAGE ajoute
 *     les frais de port (ex. 9 €), absents de l'entête BLG.
 *   - BLG ne porte quasiment jamais de date de livraison demandée : l'écart
 *     de date n'est signalé que lorsqu'elle existe.
 *   - Les quantités peuvent différer légitimement (unités de vente : couronne
 *     de cuivre côté SAGE, mètres côté BLG) — l'écart de montant est le signal
 *     fiable, l'écart de quantité est indicatif.
 *   - Les lignes SAGE « REF » / « FEDEX » (référence client, n° de suivi, montant
 *     nul) sont des lignes d'information, exclues des totaux et du rapprochement.
 * ---------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------
// Design tokens (repris de l'appli CEGECLIM by A3C)
// ---------------------------------------------------------------------
const COLORS = {
  marine: '#0B1220',
  creme: '#F5F3EC',
  sauge: '#A6A181',
  alerte: '#C1683C',
  violet: '#7A5EA8',
  ligne: '#E4E0D4',
  blanc: '#FFFFFF',
  vert: '#3E7A4E',
  rouge: '#B0442E',
  sageBleu: '#2F6690',
  blgViolet: '#7A5EA8',
};

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type Presence = 'LES_DEUX' | 'SAGE_SEUL' | 'BLG_SEUL';

type CdcRow = {
  cdc_reference: string;
  presence: Presence;
  presence_libelle: string;
  date_creation: string | null;
  numero_tiers: string | null;
  intitule_tiers: string | null;
  representant: string | null;
  sage_numero_tiers: string | null;
  sage_representant_fiche: string | null;
  sage_representant_piece: string | null;
  sage_depot: string | null;
  sage_depots_lignes: string | null;
  sage_date_livraison_prevue: string | null;
  sage_montant_ht: number | null;
  sage_montant_ht_lignes: number | null;
  sage_frais_entete: number | null;
  sage_nb_lignes: number | null;
  sage_qte_totale: number | null;
  sage_qte_a_livrer: number | null;
  sage_qte_en_preparation: number | null;
  sage_qte_expediee: number | null;
  sage_qte_facturee: number | null;
  sage_statut_livraison_code: string | null;
  sage_statut_livraison: string | null;
  sage_statut_facturation_code: string | null;
  sage_statut_facturation: string | null;
  sage_derniere_date_bl: string | null;
  sage_derniere_date_facture: string | null;
  blg_cdc_id: number | null;
  blg_lien: string | null;
  blg_date_creation: string | null;
  blg_numero_tiers: string | null;
  blg_representant: string | null;
  blg_agence: string | null;
  blg_depots_livraison: string | null;
  blg_date_livraison_prevue: string | null;
  blg_date_livraison_min: string | null;
  blg_date_livraison_reelle_max: string | null;
  blg_montant_ht: number | null;
  blg_montant_ht_lignes: number | null;
  blg_nb_lignes: number | null;
  blg_qte_totale: number | null;
  blg_qte_a_livrer: number | null;
  blg_qte_en_preparation: number | null;
  blg_qte_livree: number | null;
  blg_qte_facturee: number | null;
  blg_delivery_status: string | null;
  blg_invoice_status: string | null;
  blg_statut_livraison: string | null;
  blg_statut_facturation: string | null;
  blg_derniere_date_bl: string | null;
  blg_derniere_date_facture: string | null;
  ecart_montant: boolean;
  ecart_montant_valeur: number | null;
  ecart_quantite: boolean;
  ecart_tiers: boolean;
  ecart_date_creation: boolean;
  ecart_date_livraison: boolean;
  ecart_statut_livraison: boolean;
  ecart_statut_facturation: boolean;
  ecart_nb_lignes: boolean;
};

type SageEntete = {
  cdc_reference: string;
  date_creation: string | null;
  numero_tiers: string | null;
  intitule_tiers: string | null;
  representant_fiche: string | null;
  representant_piece: string | null;
  reference_client: string | null;
  depot_entete: string | null;
  lieu_livraison: string | null;
  date_livraison_prevue: string | null;
  date_livraison_realisee: string | null;
  expedition: string | null;
  etat_sage: string | null;
  montant_ht: number | null;
  affaire: string | null;
  observations: string | null;
  nb_lignes: number;
  qte_totale: number;
  qte_a_livrer: number;
  qte_en_preparation: number;
  qte_expediee: number;
  qte_facturee: number;
  qte_facturee_comptabilisee: number;
  montant_ht_lignes: number;
  montant_ht_a_livrer: number;
  montant_ht_livre: number;
  montant_ht_facture: number;
  date_livraison_min: string | null;
  date_livraison_max: string | null;
  derniere_date_bl: string | null;
  derniere_date_facture: string | null;
  depots_lignes: string | null;
  pieces_pl: string | null;
  pieces_bl: string | null;
  pieces_factures: string | null;
  statut_livraison: string;
  statut_facturation: string;
};

type SageLigne = {
  ligne_id: string;
  etat_code: string;
  etat_ordre: number;
  etat_libelle: string;
  type_document: string;
  document: string;
  date_document: string | null;
  date_bl: string | null;
  numero_facture: string | null;
  date_facture: string | null;
  facture_comptabilisee: boolean | null;
  reference_article: string | null;
  designation: string | null;
  reference_client: string | null;
  quantite: number | null;
  pu_net: number | null;
  montant_ht: number | null;
  depot: string | null;
  collaborateur: string | null;
  date_livraison: string | null;
  ligne_information: boolean;
};

type BlgEntete = {
  cdc_id: number;
  cdc_reference: string;
  lien_blg: string | null;
  date_creation: string | null;
  created_at: string | null;
  last_update: string | null;
  numero_tiers: string | null;
  intitule_tiers: string | null;
  representant: string | null;
  agence: string | null;
  reference_client: string | null;
  date_livraison_prevue: string | null;
  delivery_condition: string | null;
  delivery_place: string | null;
  delivery_status: string | null;
  invoice_status: string | null;
  statut_livraison: string;
  statut_facturation: string;
  montant_ht: number | null;
  montant_ttc: number | null;
  nb_lignes: number;
  qte_totale: number;
  qte_a_livrer: number;
  qte_en_preparation: number;
  qte_livree: number;
  qte_facturee: number;
  montant_ht_lignes: number;
  date_livraison_min: string | null;
  date_livraison_max: string | null;
  date_livraison_reelle_min: string | null;
  date_livraison_reelle_max: string | null;
  derniere_date_bl: string | null;
  pieces_bl: string | null;
  depots_livraison: string | null;
  derniere_date_facture: string | null;
  pieces_factures: string | null;
};

type BlgLigne = {
  ligne_id: number;
  article_reference: string | null;
  designation: string | null;
  quantite: number | null;
  qte_livree: number;
  qte_en_preparation: number;
  qte_a_livrer: number;
  qte_facturee: number;
  pu_ht: number | null;
  remise: number | null;
  montant_ht: number;
  date_livraison_demandee: string | null;
  date_livraison_reelle: string | null;
  etat_libelle: string;
};

type BlgLivraison = {
  bl_id: number;
  bl_reference: string;
  lien_blg: string | null;
  article_reference: string | null;
  quantite_livree: number | null;
  date_livraison: string | null;
  statut_ligne: string | null;
  depot: string | null;
};

type BlgFacture = {
  facture_id: number;
  facture_reference: string;
  lien_blg: string | null;
  facture_type: string;
  date_facture: string | null;
  etat_reglement: string;
  facture_montant_ht: number | null;
  article_reference: string | null;
  quantite: number | null;
  montant_ht: number | null;
};

type LigneComparaison = {
  cle_article: string;
  reference_article: string | null;
  designation: string | null;
  presence: Presence;
  sage_qte_commandee: number | null;
  sage_qte_a_livrer: number | null;
  sage_qte_en_preparation: number | null;
  sage_qte_livree: number | null;
  sage_qte_facturee: number | null;
  sage_montant_ht: number | null;
  sage_etats: string | null;
  sage_date_livraison: string | null;
  blg_qte_commandee: number | null;
  blg_qte_a_livrer: number | null;
  blg_qte_en_preparation: number | null;
  blg_qte_livree: number | null;
  blg_qte_facturee: number | null;
  blg_montant_ht: number | null;
  blg_etats: string | null;
  blg_date_livraison: string | null;
  ecart_commande: boolean;
  ecart_livraison: boolean;
  ecart_facturation: boolean;
  ecart_montant: boolean;
};

type Detail = {
  sage_entete: SageEntete | null;
  sage_lignes: SageLigne[];
  blg_entete: BlgEntete | null;
  blg_lignes: BlgLigne[];
  blg_livraisons: BlgLivraison[];
  blg_factures: BlgFacture[];
  lignes_comparaison: LigneComparaison[];
};

type EcartKey =
  | 'ecart_montant'
  | 'ecart_quantite'
  | 'ecart_nb_lignes'
  | 'ecart_tiers'
  | 'ecart_statut_livraison'
  | 'ecart_statut_facturation'
  | 'ecart_date_livraison'
  | 'ecart_date_creation';

type SortKey =
  | 'cdc_reference'
  | 'date_creation'
  | 'numero_tiers'
  | 'representant'
  | 'sage_statut_livraison'
  | 'sage_statut_facturation'
  | 'blg_statut_livraison'
  | 'blg_statut_facturation'
  | 'sage_montant_ht_lignes'
  | 'blg_montant_ht_lignes'
  | 'ecart_montant_valeur'
  | 'nb_ecarts';

// ---------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------
const PRESENCES: { value: Presence; label: string }[] = [
  { value: 'LES_DEUX', label: 'SAGE et BLG' },
  { value: 'SAGE_SEUL', label: 'SAGE seulement' },
  { value: 'BLG_SEUL', label: 'BLG seulement' },
];

const STATUTS_LIV_SAGE = ['Non livrée', 'En préparation', 'Liv. partielle', 'Livrée', 'Sans ligne'];
const STATUTS_FACT_SAGE = ['Non facturée', 'Fact. partielle', 'Facturée non comptabilisée', 'Facturée comptabilisée', 'Sans ligne'];
const STATUTS_LIV_BLG = ['Non livrée', 'Liv. partielle', 'Livrée', 'Non concernée'];
const STATUTS_FACT_BLG = ['Non facturée', 'Fact. partielle', 'Facturée'];

const ECARTS: { key: EcartKey; label: string; hint: string }[] = [
  { key: 'ecart_montant', label: 'Montant', hint: 'Somme des lignes HT différente (> 1 €)' },
  { key: 'ecart_statut_livraison', label: 'Statut livraison', hint: 'Livraison SAGE recalculée ≠ statut BLG' },
  { key: 'ecart_statut_facturation', label: 'Statut facturation', hint: 'Facturation SAGE recalculée ≠ statut BLG' },
  { key: 'ecart_tiers', label: 'Client', hint: 'N° de tiers différent' },
  { key: 'ecart_nb_lignes', label: 'Nb lignes', hint: 'Nombre de lignes différent' },
  { key: 'ecart_quantite', label: 'Quantité', hint: 'Quantité totale différente (indicatif : unités de vente)' },
  { key: 'ecart_date_livraison', label: 'Date livraison', hint: 'Date prévue différente (seulement si BLG en porte une)' },
  { key: 'ecart_date_creation', label: 'Date création', hint: 'Date de commande différente' },
];

const PAGE_SIZE = 50;
const DATE_CREATION_MIN_DEFAUT = '2026-01-01';

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const fmtEUR = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const fmtEUR2 = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtNum = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
};

const fmtDateHeure = (d: string | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const norm = (s: string | null | undefined) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const toggleInArray = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

const nbEcarts = (r: CdcRow) =>
  ECARTS.reduce((n, e) => n + (r[e.key] ? 1 : 0), 0);

const num = (v: number | null | undefined) => (v == null ? 0 : Number(v));

// ---------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------
export default function CdcSageBlgPage() {
  // --- données ---
  const [rows, setRows] = useState<CdcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string>(DATE_CREATION_MIN_DEFAUT);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // --- filtres ---
  const [cdcReference, setCdcReference] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(DATE_CREATION_MIN_DEFAUT);
  const [dateTo, setDateTo] = useState('');
  const [presences, setPresences] = useState<Presence[]>([]);
  const [representants, setRepresentants] = useState<string[]>([]);
  const [representantSearch, setRepresentantSearch] = useState('');
  const [agences, setAgences] = useState<string[]>([]);
  const [depots, setDepots] = useState<string[]>([]);
  const [statutsLivSage, setStatutsLivSage] = useState<string[]>([]);
  const [statutsFactSage, setStatutsFactSage] = useState<string[]>([]);
  const [statutsLivBlg, setStatutsLivBlg] = useState<string[]>([]);
  const [statutsFactBlg, setStatutsFactBlg] = useState<string[]>([]);
  const [ecarts, setEcarts] = useState<EcartKey[]>([]);
  const [ecartMode, setEcartMode] = useState<'all' | 'avec' | 'sans' | 'choisis'>('all');

  // --- tri / pagination ---
  const [sortKey, setSortKey] = useState<SortKey>('date_creation');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  // --- fiche ---
  const [detailRef, setDetailRef] = useState<string | null>(null);

  // -------------------------------------------------------------
  // Chargement
  // -------------------------------------------------------------
  const charger = useCallback(async (from: string) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('get_cdc_comparaison_liste', { p_date_from: from || null });
    setLoading(false);
    if (err) {
      setError(`Impossible de charger les commandes : ${err.message}`);
      return;
    }
    const payload = (data ?? {}) as { refreshed_at?: string | null; erreur?: string | null; rows?: CdcRow[] };
    setRows(Array.isArray(payload.rows) ? payload.rows : []);
    setRefreshedAt(payload.refreshed_at ?? null);
    setCacheError(payload.erreur ?? null);
    setLoadedFrom(from);
    setPage(0);
  }, []);

  // Rafraîchit le cache côté base (≈ 1 min : la vue complète relit 1,6 M lignes BLG), puis recharge.
  const actualiserCache = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    const { error: err } = await supabase.rpc('refresh_cdc_comparaison');
    setRefreshing(false);
    if (err) {
      setError(`Le rafraîchissement du cache a échoué : ${err.message}`);
      return;
    }
    await charger(loadedFrom);
  }, [charger, loadedFrom]);

  useEffect(() => {
    void charger(DATE_CREATION_MIN_DEFAUT);
  }, [charger]);

  // Si la date de début demandée est antérieure à celle chargée, on recharge.
  useEffect(() => {
    if (dateFrom && loadedFrom && dateFrom < loadedFrom && !loading) {
      void charger(dateFrom);
    }
    if (!dateFrom && loadedFrom && !loading) {
      void charger('');
    }
  }, [dateFrom, loadedFrom, loading, charger]);

  // -------------------------------------------------------------
  // Options de filtres dérivées des données
  // -------------------------------------------------------------
  const representantOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.sage_representant_fiche) set.add(r.sage_representant_fiche);
      if (r.blg_representant) set.add(r.blg_representant);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [rows]);

  const representantOptionsFiltres = useMemo(() => {
    if (!representantSearch.trim()) return representantOptions;
    const q = norm(representantSearch);
    return representantOptions.filter((r) => norm(r).includes(q));
  }, [representantOptions, representantSearch]);

  const agenceOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.blg_agence && set.add(r.blg_agence));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [rows]);

  const depotOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.sage_depot && set.add(r.sage_depot));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [rows]);

  // -------------------------------------------------------------
  // Filtrage (côté navigateur : la liste complète est en mémoire)
  // -------------------------------------------------------------
  const filtered = useMemo(() => {
    const ref = norm(cdcReference);
    const cli = norm(clientSearch);
    return rows.filter((r) => {
      if (ref && !norm(r.cdc_reference).includes(ref)) return false;
      if (cli) {
        const hay = norm(`${r.numero_tiers ?? ''} ${r.intitule_tiers ?? ''} ${r.sage_numero_tiers ?? ''} ${r.blg_numero_tiers ?? ''}`);
        if (!hay.includes(cli)) return false;
      }
      if (dateFrom && (!r.date_creation || r.date_creation < dateFrom)) return false;
      if (dateTo && (!r.date_creation || r.date_creation > dateTo)) return false;
      if (presences.length && !presences.includes(r.presence)) return false;
      if (representants.length) {
        const ok = representants.includes(r.sage_representant_fiche ?? '') || representants.includes(r.blg_representant ?? '');
        if (!ok) return false;
      }
      if (agences.length && !agences.includes(r.blg_agence ?? '')) return false;
      if (depots.length && !depots.includes(r.sage_depot ?? '')) return false;
      if (statutsLivSage.length && !statutsLivSage.includes(r.sage_statut_livraison ?? '')) return false;
      if (statutsFactSage.length && !statutsFactSage.includes(r.sage_statut_facturation ?? '')) return false;
      if (statutsLivBlg.length && !statutsLivBlg.includes(r.blg_statut_livraison ?? '')) return false;
      if (statutsFactBlg.length && !statutsFactBlg.includes(r.blg_statut_facturation ?? '')) return false;
      if (ecartMode === 'avec' && r.presence === 'LES_DEUX' && nbEcarts(r) === 0) return false;
      if (ecartMode === 'sans' && (r.presence !== 'LES_DEUX' || nbEcarts(r) > 0)) return false;
      if (ecartMode === 'choisis' && ecarts.length && !ecarts.some((k) => r[k])) return false;
      return true;
    });
  }, [rows, cdcReference, clientSearch, dateFrom, dateTo, presences, representants, agences, depots, statutsLivSage, statutsFactSage, statutsLivBlg, statutsFactBlg, ecartMode, ecarts]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (r: CdcRow): string | number => {
      if (sortKey === 'nb_ecarts') return nbEcarts(r);
      const v = r[sortKey];
      if (v == null) return sortKey.includes('montant') ? -Infinity : '';
      return typeof v === 'number' ? v : String(v);
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'fr') * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [filtered.length, sortKey, sortDir]);

  // -------------------------------------------------------------
  // KPIs et matrices de statuts (sur le périmètre filtré)
  // -------------------------------------------------------------
  const kpis = useMemo(() => {
    const both = filtered.filter((r) => r.presence === 'LES_DEUX');
    const sageOnly = filtered.filter((r) => r.presence === 'SAGE_SEUL');
    const blgOnly = filtered.filter((r) => r.presence === 'BLG_SEUL');
    const sum = (list: CdcRow[], f: (r: CdcRow) => number | null) => list.reduce((s, r) => s + num(f(r)), 0);
    return {
      total: filtered.length,
      both: both.length,
      sageOnly: sageOnly.length,
      blgOnly: blgOnly.length,
      sageMontant: sum(filtered, (r) => r.sage_montant_ht_lignes),
      blgMontant: sum(filtered, (r) => r.blg_montant_ht_lignes),
      sageAlivrer: sum(filtered, (r) => (r.sage_statut_livraison_code === 'LIVREE' ? 0 : r.sage_montant_ht_lignes)),
      avecEcart: both.filter((r) => nbEcarts(r) > 0).length,
      sansEcart: both.filter((r) => nbEcarts(r) === 0).length,
      parEcart: ECARTS.map((e) => ({ key: e.key, label: e.label, n: both.filter((r) => r[e.key]).length })),
      ecartMontantTotal: both.reduce((s, r) => s + Math.abs(num(r.ecart_montant_valeur)), 0),
    };
  }, [filtered]);

  const matriceLivraison = useMemo(() => buildMatrix(filtered, 'sage_statut_livraison', 'blg_statut_livraison', STATUTS_LIV_SAGE, STATUTS_LIV_BLG), [filtered]);
  const matriceFacturation = useMemo(
    () => buildMatrix(filtered, 'sage_statut_facturation', 'blg_statut_facturation', STATUTS_FACT_SAGE, STATUTS_FACT_BLG),
    [filtered]
  );

  const filtresActifs =
    Boolean(cdcReference || clientSearch || dateTo) ||
    dateFrom !== DATE_CREATION_MIN_DEFAUT ||
    presences.length > 0 ||
    representants.length > 0 ||
    agences.length > 0 ||
    depots.length > 0 ||
    statutsLivSage.length > 0 ||
    statutsFactSage.length > 0 ||
    statutsLivBlg.length > 0 ||
    statutsFactBlg.length > 0 ||
    ecartMode !== 'all';

  function reinitialiser() {
    setCdcReference('');
    setClientSearch('');
    setDateFrom(DATE_CREATION_MIN_DEFAUT);
    setDateTo('');
    setPresences([]);
    setRepresentants([]);
    setRepresentantSearch('');
    setAgences([]);
    setDepots([]);
    setStatutsLivSage([]);
    setStatutsFactSage([]);
    setStatutsLivBlg([]);
    setStatutsFactBlg([]);
    setEcarts([]);
    setEcartMode('all');
    setPage(0);
  }

  function trier(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'date_creation' || key.includes('montant') || key === 'nb_ecarts' ? 'desc' : 'asc');
    }
  }

  // -------------------------------------------------------------
  // Export Excel
  // -------------------------------------------------------------
  const exporterExcel = useCallback(async () => {
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'CEGECLIM by A3C';
      const horodatage = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

      // ---- Onglet 1 : Synthèse ----
      const wsK = wb.addWorksheet('Synthèse');
      wsK.columns = [
        { header: 'Indicateur', key: 'k', width: 42 },
        { header: 'Valeur', key: 'v', width: 20 },
      ];
      [
        ['Commandes (périmètre filtré)', kpis.total],
        ['Présentes dans SAGE et BLG', kpis.both],
        ['SAGE seulement', kpis.sageOnly],
        ['BLG seulement', kpis.blgOnly],
        ['Sans écart (SAGE et BLG)', kpis.sansEcart],
        ['Avec au moins un écart', kpis.avecEcart],
        ...kpis.parEcart.map((e) => [`  dont écart ${e.label.toLowerCase()}`, e.n]),
        ['Montant HT lignes SAGE', Math.round(kpis.sageMontant)],
        ['Montant HT lignes BLG', Math.round(kpis.blgMontant)],
        ['Somme des écarts de montant (valeur absolue)', Math.round(kpis.ecartMontantTotal)],
        ['Chargé depuis le', loadedFrom || 'origine'],
        ['Données calculées le', refreshedAt ? new Date(refreshedAt).toLocaleString('fr-FR') : '—'],
        ['Export du', new Date().toLocaleString('fr-FR')],
      ].forEach(([k, v]) => wsK.addRow({ k, v }));
      wsK.getRow(1).font = { bold: true };

      // ---- Onglet 2 : Comparaison ----
      const ws = wb.addWorksheet('Comparaison');
      ws.columns = [
        { header: 'CDC', key: 'cdc_reference', width: 12 },
        { header: 'Présence', key: 'presence_libelle', width: 16 },
        { header: 'Date création', key: 'date_creation', width: 12 },
        { header: 'N° tiers', key: 'numero_tiers', width: 10 },
        { header: 'Client', key: 'intitule_tiers', width: 32 },
        { header: 'Représentant', key: 'representant', width: 22 },
        { header: 'Dépôt SAGE', key: 'sage_depot', width: 18 },
        { header: 'Agence BLG', key: 'blg_agence', width: 20 },
        { header: 'Liv. prévue SAGE', key: 'sage_date_livraison_prevue', width: 12 },
        { header: 'Statut liv. SAGE', key: 'sage_statut_livraison', width: 16 },
        { header: 'Statut fact. SAGE', key: 'sage_statut_facturation', width: 24 },
        { header: 'Statut liv. BLG', key: 'blg_statut_livraison', width: 16 },
        { header: 'Statut fact. BLG', key: 'blg_statut_facturation', width: 16 },
        { header: 'Montant HT lignes SAGE', key: 'sage_montant_ht_lignes', width: 16 },
        { header: 'Frais entête SAGE', key: 'sage_frais_entete', width: 14 },
        { header: 'Montant HT lignes BLG', key: 'blg_montant_ht_lignes', width: 16 },
        { header: 'Écart montant', key: 'ecart_montant_valeur', width: 14 },
        { header: 'Nb lignes SAGE', key: 'sage_nb_lignes', width: 12 },
        { header: 'Nb lignes BLG', key: 'blg_nb_lignes', width: 12 },
        { header: 'Qté SAGE', key: 'sage_qte_totale', width: 10 },
        { header: 'Qté BLG', key: 'blg_qte_totale', width: 10 },
        { header: 'Dernier BL SAGE', key: 'sage_derniere_date_bl', width: 12 },
        { header: 'Dernier BL BLG', key: 'blg_derniere_date_bl', width: 12 },
        { header: 'Dernière fact. SAGE', key: 'sage_derniere_date_facture', width: 12 },
        { header: 'Dernière fact. BLG', key: 'blg_derniere_date_facture', width: 12 },
        { header: 'Écarts', key: 'ecarts', width: 40 },
        { header: 'Lien BLG', key: 'blg_lien', width: 14 },
      ];
      sorted.forEach((r) => {
        ws.addRow({
          ...r,
          date_creation: r.date_creation ? new Date(r.date_creation) : null,
          sage_date_livraison_prevue: r.sage_date_livraison_prevue ? new Date(r.sage_date_livraison_prevue) : null,
          sage_derniere_date_bl: r.sage_derniere_date_bl ? new Date(r.sage_derniere_date_bl) : null,
          blg_derniere_date_bl: r.blg_derniere_date_bl ? new Date(r.blg_derniere_date_bl) : null,
          sage_derniere_date_facture: r.sage_derniere_date_facture ? new Date(r.sage_derniere_date_facture) : null,
          blg_derniere_date_facture: r.blg_derniere_date_facture ? new Date(r.blg_derniere_date_facture) : null,
          sage_montant_ht_lignes: r.sage_montant_ht_lignes == null ? null : Number(r.sage_montant_ht_lignes),
          sage_frais_entete: r.sage_frais_entete == null ? null : Number(r.sage_frais_entete),
          blg_montant_ht_lignes: r.blg_montant_ht_lignes == null ? null : Number(r.blg_montant_ht_lignes),
          ecart_montant_valeur: r.ecart_montant_valeur == null ? null : Number(r.ecart_montant_valeur),
          ecarts: ECARTS.filter((e) => r[e.key]).map((e) => e.label).join(', '),
        });
      });
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: 'A1', to: `AA${sorted.length + 1}` };
      ['sage_montant_ht_lignes', 'sage_frais_entete', 'blg_montant_ht_lignes', 'ecart_montant_valeur'].forEach((k) => {
        ws.getColumn(k).numFmt = '#,##0.00 €';
      });
      ['date_creation', 'sage_date_livraison_prevue', 'sage_derniere_date_bl', 'blg_derniere_date_bl', 'sage_derniere_date_facture', 'blg_derniere_date_facture'].forEach((k) => {
        ws.getColumn(k).numFmt = 'dd/mm/yyyy';
      });

      // ---- Onglet 3 & 4 : matrices de statuts ----
      const addMatrix = (name: string, m: ReturnType<typeof buildMatrix>) => {
        const w = wb.addWorksheet(name);
        w.addRow(['SAGE \\ BLG', ...m.cols, 'Total']).font = { bold: true };
        m.rows.forEach((rl, i) => w.addRow([rl, ...m.values[i], m.rowTotals[i]]));
        w.addRow(['Total', ...m.colTotals, m.total]).font = { bold: true };
        w.getColumn(1).width = 28;
      };
      addMatrix('Matrice livraison', matriceLivraison);
      addMatrix('Matrice facturation', matriceFacturation);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cdc-sage-blg-${horodatage}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'export Excel.");
    } finally {
      setExporting(false);
    }
  }, [sorted, kpis, matriceLivraison, matriceFacturation, loadedFrom, refreshedAt]);

  // ===============================================================
  // Rendu
  // ===============================================================
  return (
    <div style={{ background: COLORS.creme, minHeight: '100vh', width: '100%', fontFamily: '"IBM Plex Sans", sans-serif', color: COLORS.marine }}>
      <div style={{ width: '100%', margin: '0 auto', padding: '28px 32px 64px', boxSizing: 'border-box' }}>
        <header style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 30, fontWeight: 600, margin: 0 }}>Commandes clients SAGE ↔ BLG</h1>
            <p style={{ color: '#5B5646', marginTop: 6, fontSize: 14, maxWidth: 900 }}>
              Portefeuille de commandes clients non soldées : vision SAGE (bon de commande, préparation, expédition, facturation) en regard de la
              commande BLG, avec les écarts détectés. Cliquez une ligne pour ouvrir le rapprochement article par article.
            </p>
          </div>
          <div style={{ fontSize: 12, color: '#8A8474', textAlign: 'right' }}>
            {rows.length.toLocaleString('fr-FR')} commandes chargées depuis le {loadedFrom ? fmtDate(loadedFrom) : "l'origine"}
            <br />
            Données calculées le {refreshedAt ? fmtDateHeure(refreshedAt) : '—'} (cache rafraîchi toutes les heures)
            {cacheError && <div style={{ color: COLORS.rouge }}>Dernier rafraîchissement en erreur : {cacheError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={() => void charger(loadedFrom)} disabled={loading || refreshing} style={secondaryButtonStyle}>
                {loading ? 'Chargement…' : '↻ Recharger'}
              </button>
              <button
                onClick={() => void actualiserCache()}
                disabled={loading || refreshing}
                style={secondaryButtonStyle}
                title="Recalcule la comparaison à partir des données SAGE et BLG actuelles (environ une minute)"
              >
                {refreshing ? 'Recalcul en cours (≈ 1 min)…' : '⟳ Actualiser les données'}
              </button>
            </div>
          </div>
        </header>

        {/* ---------------- FILTRES ---------------- */}
        <section style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <Field label="Référence CDC">
              <input type="text" value={cdcReference} onChange={(e) => setCdcReference(e.target.value)} placeholder="ex. CDC187025" style={inputStyle} />
            </Field>

            <Field label="Client (n° tiers ou nom)">
              <input type="text" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="ex. C0075 ou DUPONT" style={inputStyle} />
            </Field>

            <Field label="Date de création (commande)">
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
              </div>
              <small style={{ color: '#8A8474' }}>Une date de début antérieure à celle chargée relance la lecture.</small>
            </Field>

            <Field label="Représentant (fiche SAGE ou BLG)">
              <input
                type="text"
                value={representantSearch}
                onChange={(e) => setRepresentantSearch(e.target.value)}
                placeholder="Rechercher…"
                style={{ ...inputStyle, marginBottom: 6 }}
              />
              <select
                multiple
                size={5}
                value={representants}
                onChange={(e) => setRepresentants(Array.from(e.target.selectedOptions, (o) => o.value))}
                style={selectStyle}
              >
                {representantOptionsFiltres.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {representants.length > 0 && <small style={{ color: '#8A8474' }}>{representants.length} sélectionné(s)</small>}
            </Field>

            <Field label="Agence BLG (émetteur)">
              <select multiple size={5} value={agences} onChange={(e) => setAgences(Array.from(e.target.selectedOptions, (o) => o.value))} style={selectStyle}>
                {agenceOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              {agences.length > 0 && <small style={{ color: '#8A8474' }}>{agences.length} sélectionnée(s)</small>}
            </Field>

            <Field label="Dépôt SAGE (entête)">
              <select multiple size={5} value={depots} onChange={(e) => setDepots(Array.from(e.target.selectedOptions, (o) => o.value))} style={selectStyle}>
                {depotOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {depots.length > 0 && <small style={{ color: '#8A8474' }}>{depots.length} sélectionné(s)</small>}
            </Field>

            <Field label="Présence">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PRESENCES.map((p) => (
                  <Chip key={p.value} active={presences.includes(p.value)} onClick={() => setPresences((prev) => toggleInArray(prev, p.value))}>
                    {p.label}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Statut livraison SAGE (recalculé)">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STATUTS_LIV_SAGE.map((s) => (
                  <Chip key={s} active={statutsLivSage.includes(s)} onClick={() => setStatutsLivSage((prev) => toggleInArray(prev, s))}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Statut facturation SAGE (recalculé)">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STATUTS_FACT_SAGE.map((s) => (
                  <Chip key={s} active={statutsFactSage.includes(s)} onClick={() => setStatutsFactSage((prev) => toggleInArray(prev, s))}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Statut livraison BLG">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STATUTS_LIV_BLG.map((s) => (
                  <Chip key={s} active={statutsLivBlg.includes(s)} onClick={() => setStatutsLivBlg((prev) => toggleInArray(prev, s))}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Statut facturation BLG">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STATUTS_FACT_BLG.map((s) => (
                  <Chip key={s} active={statutsFactBlg.includes(s)} onClick={() => setStatutsFactBlg((prev) => toggleInArray(prev, s))}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Écarts SAGE ↔ BLG">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                <Chip active={ecartMode === 'all'} onClick={() => setEcartMode('all')}>
                  Toutes
                </Chip>
                <Chip active={ecartMode === 'avec'} onClick={() => setEcartMode('avec')}>
                  Avec écart
                </Chip>
                <Chip active={ecartMode === 'sans'} onClick={() => setEcartMode('sans')}>
                  Sans écart
                </Chip>
                <Chip active={ecartMode === 'choisis'} onClick={() => setEcartMode('choisis')}>
                  Écarts choisis…
                </Chip>
              </div>
              {ecartMode === 'choisis' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ECARTS.map((e) => (
                    <span key={e.key} title={e.hint}>
                      <Chip active={ecarts.includes(e.key)} onClick={() => setEcarts((prev) => toggleInArray(prev, e.key))}>
                        {e.label}
                      </Chip>
                    </span>
                  ))}
                </div>
              )}
              <small style={{ color: '#8A8474' }}>« Avec / sans écart » ne concerne que les commandes présentes des deux côtés.</small>
            </Field>
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={reinitialiser} style={secondaryButtonStyle} disabled={!filtresActifs}>
              Réinitialiser
            </button>
            <span style={{ fontSize: 13, color: '#5B5646' }}>
              {sorted.length.toLocaleString('fr-FR')} commande{sorted.length > 1 ? 's' : ''} affichée{sorted.length > 1 ? 's' : ''}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={exporterExcel} disabled={exporting || loading || sorted.length === 0} style={exportButtonStyle}>
              {exporting ? 'Export en cours…' : '↓ Exporter Excel'}
            </button>
          </div>
        </section>

        {error && (
          <div style={{ background: '#FBEAE2', border: `1px solid ${COLORS.alerte}`, color: '#8A3F1E', padding: 12, borderRadius: 8, marginBottom: 20 }}>{error}</div>
        )}

        {/* ---------------- KPIs ---------------- */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 16 }}>
          <Kpi label="Commandes" value={fmtNum(kpis.total)} />
          <Kpi label="SAGE et BLG" value={fmtNum(kpis.both)} accent={COLORS.vert} />
          <Kpi label="SAGE seulement" value={fmtNum(kpis.sageOnly)} accent={COLORS.sageBleu} />
          <Kpi label="BLG seulement" value={fmtNum(kpis.blgOnly)} accent={COLORS.blgViolet} />
          <Kpi label="Sans écart" value={fmtNum(kpis.sansEcart)} accent={COLORS.vert} />
          <Kpi label="Avec écart" value={fmtNum(kpis.avecEcart)} accent={COLORS.alerte} />
          <Kpi label="Montant HT lignes SAGE" value={fmtEUR(kpis.sageMontant)} accent={COLORS.sageBleu} />
          <Kpi label="Montant HT lignes BLG" value={fmtEUR(kpis.blgMontant)} accent={COLORS.blgViolet} />
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 24 }}>
          {kpis.parEcart.map((e) => (
            <Kpi key={e.key} label={`Écart ${e.label.toLowerCase()}`} value={fmtNum(e.n)} accent={e.n > 0 ? COLORS.alerte : COLORS.sauge} compact />
          ))}
          <Kpi label="Σ |écarts montant|" value={fmtEUR(kpis.ecartMontantTotal)} accent={COLORS.alerte} compact />
        </section>

        {/* ---------------- Matrices de statuts ---------------- */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 24 }}>
          <MatrixCard
            title="Statut de livraison — SAGE (lignes) × BLG (entête)"
            hint="Hors diagonale = les deux outils ne racontent pas la même chose. Cliquez une case pour filtrer."
            matrix={matriceLivraison}
            onPick={(s, b) => {
              setStatutsLivSage(s ? [s] : []);
              setStatutsLivBlg(b ? [b] : []);
            }}
          />
          <MatrixCard
            title="Statut de facturation — SAGE (lignes) × BLG (entête)"
            hint="SAGE distingue la facture comptabilisée ; BLG n'a qu'un statut de facturation."
            matrix={matriceFacturation}
            onPick={(s, b) => {
              setStatutsFactSage(s ? [s] : []);
              setStatutsFactBlg(b ? [b] : []);
            }}
          />
        </section>

        {/* ---------------- TABLE ---------------- */}
        <section style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th onClick={() => trier('cdc_reference')} active={sortKey === 'cdc_reference'} dir={sortDir}>
                    CDC
                  </Th>
                  <Th>Présence</Th>
                  <Th onClick={() => trier('date_creation')} active={sortKey === 'date_creation'} dir={sortDir}>
                    Créée le
                  </Th>
                  <Th onClick={() => trier('numero_tiers')} active={sortKey === 'numero_tiers'} dir={sortDir}>
                    Client
                  </Th>
                  <Th onClick={() => trier('representant')} active={sortKey === 'representant'} dir={sortDir}>
                    Représentant
                  </Th>
                  <Th>Dépôt / agence</Th>
                  <Th>Liv. prévue</Th>
                  <Th onClick={() => trier('sage_statut_livraison')} active={sortKey === 'sage_statut_livraison'} dir={sortDir} tone="sage">
                    SAGE livraison
                  </Th>
                  <Th onClick={() => trier('sage_statut_facturation')} active={sortKey === 'sage_statut_facturation'} dir={sortDir} tone="sage">
                    SAGE facturation
                  </Th>
                  <Th onClick={() => trier('blg_statut_livraison')} active={sortKey === 'blg_statut_livraison'} dir={sortDir} tone="blg">
                    BLG livraison
                  </Th>
                  <Th onClick={() => trier('blg_statut_facturation')} active={sortKey === 'blg_statut_facturation'} dir={sortDir} tone="blg">
                    BLG facturation
                  </Th>
                  <Th onClick={() => trier('sage_montant_ht_lignes')} active={sortKey === 'sage_montant_ht_lignes'} dir={sortDir} tone="sage" right>
                    HT SAGE
                  </Th>
                  <Th onClick={() => trier('blg_montant_ht_lignes')} active={sortKey === 'blg_montant_ht_lignes'} dir={sortDir} tone="blg" right>
                    HT BLG
                  </Th>
                  <Th onClick={() => trier('ecart_montant_valeur')} active={sortKey === 'ecart_montant_valeur'} dir={sortDir} right>
                    Δ HT
                  </Th>
                  <Th onClick={() => trier('nb_ecarts')} active={sortKey === 'nb_ecarts'} dir={sortDir}>
                    Écarts
                  </Th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ ...tdStyle, textAlign: 'center', padding: 40, color: '#8A8474' }}>
                      Chargement des commandes…
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ ...tdStyle, textAlign: 'center', padding: 40, color: '#8A8474' }}>
                      Aucune commande ne correspond aux filtres.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => {
                    const n = nbEcarts(r);
                    return (
                      <tr key={r.cdc_reference} onClick={() => setDetailRef(r.cdc_reference)} style={{ cursor: 'pointer' }} className="cdc-row">
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          <LienBlg href={r.blg_lien}>{r.cdc_reference}</LienBlg>
                        </td>
                        <td style={tdStyle}>
                          <PresenceTag presence={r.presence} />
                        </td>
                        <td style={tdStyle}>
                          {fmtDate(r.date_creation)}
                          {r.ecart_date_creation && <span title={`BLG : ${fmtDate(r.blg_date_creation)}`} style={ecartDotStyle} />}
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.intitule_tiers ?? ''}>
                          <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }}>{r.numero_tiers ?? '—'}</span>
                          {r.ecart_tiers && <span title={`SAGE ${r.sage_numero_tiers ?? '—'} ≠ BLG ${r.blg_numero_tiers ?? '—'}`} style={ecartDotStyle} />}{' '}
                          <span style={{ color: '#5B5646' }}>{r.intitule_tiers ?? ''}</span>
                        </td>
                        <td style={tdStyle}>{r.representant ?? '—'}</td>
                        <td style={{ ...tdStyle, fontSize: 12 }}>
                          <div>{r.sage_depot ?? '—'}</div>
                          <div style={{ color: COLORS.blgViolet }}>{r.blg_agence ?? '—'}</div>
                        </td>
                        <td style={tdStyle}>
                          {fmtDate(r.sage_date_livraison_prevue)}
                          {r.ecart_date_livraison && <span title={`BLG : ${fmtDate(r.blg_date_livraison_prevue ?? r.blg_date_livraison_min)}`} style={ecartDotStyle} />}
                        </td>
                        <td style={tdStyle}>{r.sage_statut_livraison ? <Tag label={r.sage_statut_livraison} /> : '—'}</td>
                        <td style={tdStyle}>{r.sage_statut_facturation ? <Tag label={r.sage_statut_facturation} /> : '—'}</td>
                        <td style={tdStyle}>
                          {r.blg_statut_livraison ? <Tag label={r.blg_statut_livraison} /> : '—'}
                          {r.ecart_statut_livraison && <span title="Statut de livraison différent de SAGE" style={ecartDotStyle} />}
                        </td>
                        <td style={tdStyle}>
                          {r.blg_statut_facturation ? <Tag label={r.blg_statut_facturation} /> : '—'}
                          {r.ecart_statut_facturation && <span title="Statut de facturation différent de SAGE" style={ecartDotStyle} />}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }} title={r.sage_frais_entete ? `+ ${fmtEUR2(r.sage_frais_entete)} de frais d'entête` : undefined}>
                          {fmtEUR2(r.sage_montant_ht_lignes)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR2(r.blg_montant_ht_lignes)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: r.ecart_montant ? COLORS.rouge : '#8A8474', fontWeight: r.ecart_montant ? 600 : 400 }}>
                          {r.presence === 'LES_DEUX' ? fmtEUR2(r.ecart_montant_valeur) : '—'}
                        </td>
                        <td style={tdStyle}>
                          {r.presence !== 'LES_DEUX' ? (
                            <span style={{ color: '#8A8474', fontSize: 12 }}>—</span>
                          ) : n === 0 ? (
                            <span style={{ color: COLORS.vert, fontSize: 12, fontWeight: 600 }}>✓ OK</span>
                          ) : (
                            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                              {ECARTS.filter((e) => r[e.key]).map((e) => (
                                <EcartBadge key={e.key} label={e.label} hint={e.hint} />
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: `1px solid ${COLORS.ligne}`, fontSize: 13 }}>
            <span>
              Page {page + 1} / {totalPages} — {sorted.length.toLocaleString('fr-FR')} commande{sorted.length > 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(0)} disabled={page === 0} style={secondaryButtonStyle}>
                «
              </button>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={secondaryButtonStyle}>
                ‹ Précédent
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={secondaryButtonStyle}>
                Suivant ›
              </button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={secondaryButtonStyle}>
                »
              </button>
            </div>
          </div>
        </section>

        <p style={{ fontSize: 12, color: '#8A8474', marginTop: 16, lineHeight: 1.5 }}>
          Lecture : les statuts SAGE sont recalculés à partir des lignes (bon de commande = à livrer, préparation, bon de livraison = expédiée,
          facture — comptabilisée selon l&apos;export Facture du jour). Le montant est comparé sur la somme des lignes HT : l&apos;entête SAGE
          ajoute les frais de port, absents de BLG. L&apos;écart de quantité est indicatif (unités de vente différentes possibles). BLG ne
          porte presque jamais de date de livraison demandée.
        </p>
      </div>

      <style>{`.cdc-row:hover td { background: #FAF8F2; }`}</style>

      {detailRef && <CdcDetailModal reference={detailRef} onClose={() => setDetailRef(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Matrice SAGE × BLG
// ---------------------------------------------------------------------
function buildMatrix(list: CdcRow[], sageKey: 'sage_statut_livraison' | 'sage_statut_facturation', blgKey: 'blg_statut_livraison' | 'blg_statut_facturation', sageOrder: string[], blgOrder: string[]) {
  const rowsSet = new Set<string>();
  const colsSet = new Set<string>();
  list.forEach((r) => {
    rowsSet.add(r[sageKey] ?? '(absent SAGE)');
    colsSet.add(r[blgKey] ?? '(absent BLG)');
  });
  const order = (set: Set<string>, ref: string[]) =>
    [...set].sort((a, b) => {
      const ia = ref.indexOf(a);
      const ib = ref.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'fr');
    });
  const rowsL = order(rowsSet, sageOrder);
  const cols = order(colsSet, blgOrder);
  const values = rowsL.map(() => cols.map(() => 0));
  list.forEach((r) => {
    const i = rowsL.indexOf(r[sageKey] ?? '(absent SAGE)');
    const j = cols.indexOf(r[blgKey] ?? '(absent BLG)');
    values[i][j] += 1;
  });
  const rowTotals = values.map((v) => v.reduce((s, x) => s + x, 0));
  const colTotals = cols.map((_, j) => values.reduce((s, v) => s + v[j], 0));
  const total = rowTotals.reduce((s, x) => s + x, 0);
  return { rows: rowsL, cols, values, rowTotals, colTotals, total };
}

function MatrixCard({
  title,
  hint,
  matrix,
  onPick,
}: {
  title: string;
  hint: string;
  matrix: ReturnType<typeof buildMatrix>;
  onPick: (sage: string | null, blg: string | null) => void;
}) {
  const max = Math.max(1, ...matrix.values.flat());
  const coherent = (s: string, b: string) => {
    const ns = norm(s);
    const nb = norm(b);
    if (ns === nb) return true;
    if (ns.startsWith('facturee') && nb === 'facturee') return true;
    if (ns === 'en preparation' && nb === 'non livree') return true;
    return false;
  };
  return (
    <div style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, padding: 16 }}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <p style={{ fontSize: 12, color: '#8A8474', marginTop: 0, marginBottom: 10 }}>{hint}</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableStyle, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyleSm, background: COLORS.creme, color: COLORS.marine }}>SAGE ↓ · BLG →</th>
              {matrix.cols.map((c) => (
                <th key={c} style={{ ...thStyleSm, background: '#EFE9F7', color: COLORS.marine, textAlign: 'center' }}>
                  {c}
                </th>
              ))}
              <th style={{ ...thStyleSm, background: COLORS.creme, color: COLORS.marine, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((rl, i) => (
              <tr key={rl}>
                <td style={{ ...tdStyleSm, background: '#E8EFF5', fontWeight: 600 }}>{rl}</td>
                {matrix.cols.map((c, j) => {
                  const v = matrix.values[i][j];
                  const ok = coherent(rl, c);
                  const intensity = v === 0 ? 0 : 0.15 + 0.6 * (v / max);
                  const bg = v === 0 ? 'transparent' : ok ? `rgba(62,122,78,${intensity})` : `rgba(193,104,60,${intensity})`;
                  return (
                    <td
                      key={c}
                      onClick={() => v > 0 && onPick(rl.startsWith('(') ? null : rl, c.startsWith('(') ? null : c)}
                      title={v > 0 ? `${v} commande(s) — cliquer pour filtrer` : ''}
                      style={{ ...tdStyleSm, textAlign: 'center', background: bg, cursor: v > 0 ? 'pointer' : 'default', color: intensity > 0.5 ? '#fff' : COLORS.marine, fontWeight: v > 0 ? 600 : 400 }}
                    >
                      {v || '·'}
                    </td>
                  );
                })}
                <td style={{ ...tdStyleSm, textAlign: 'right', fontWeight: 600 }}>{matrix.rowTotals[i]}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...tdStyleSm, fontWeight: 600 }}>Total</td>
              {matrix.colTotals.map((t, j) => (
                <td key={j} style={{ ...tdStyleSm, textAlign: 'center', fontWeight: 600 }}>
                  {t}
                </td>
              ))}
              <td style={{ ...tdStyleSm, textAlign: 'right', fontWeight: 700 }}>{matrix.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fiche détail d'une CDC
// ---------------------------------------------------------------------
type OngletDetail = 'rapprochement' | 'sage' | 'blg' | 'livraisons' | 'factures';

function CdcDetailModal({ reference, onClose }: { reference: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<OngletDetail>('rapprochement');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.rpc('get_cdc_detail', { p_reference: reference });
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      setDetail(data as Detail);
    })();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = detail?.sage_entete ?? null;
  const b = detail?.blg_entete ?? null;
  const cmp = detail?.lignes_comparaison ?? [];
  const nbEcartsLignes = cmp.filter((l) => l.ecart_commande || l.ecart_livraison || l.ecart_facturation || l.ecart_montant).length;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.55)', zIndex: 1000, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.creme, borderRadius: 12, width: '100%', maxWidth: 1500, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        {/* En-tête */}
        <div style={{ background: COLORS.marine, color: COLORS.creme, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: COLORS.sauge }}>Commande client</div>
            <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 24, fontWeight: 600 }}>
              {reference}
              {b?.lien_blg && (
                <a href={b.lien_blg} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 12, fontSize: 13, color: '#C9BFE6', textDecoration: 'none' }}>
                  Ouvrir dans BLG ↗
                </a>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#B8B2A0', marginTop: 2 }}>
              {s?.intitule_tiers ?? b?.intitule_tiers ?? '—'} · {s?.numero_tiers ?? b?.numero_tiers ?? '—'} · créée le {fmtDate(s?.date_creation ?? b?.date_creation)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <PresencePill present={Boolean(s)} label="SAGE" color={COLORS.sageBleu} />
            <PresencePill present={Boolean(b)} label="BLG" color={COLORS.blgViolet} />
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid rgba(245,243,236,0.35)`, color: COLORS.creme, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
            Fermer (Échap)
          </button>
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#8A8474' }}>Chargement de la fiche…</div>
          ) : error ? (
            <div style={{ background: '#FBEAE2', border: `1px solid ${COLORS.alerte}`, color: '#8A3F1E', padding: 12, borderRadius: 8 }}>{error}</div>
          ) : (
            <>
              {/* ---- Entêtes SAGE | BLG ---- */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
                <EnteteCard title="Vision SAGE" color={COLORS.sageBleu} absent={!s} absentText="Cette commande n'est pas (ou plus) dans le portefeuille SAGE non soldé.">
                  {s && (
                    <>
                      <InfoGrid
                        items={[
                          ['Date de création', fmtDate(s.date_creation)],
                          ['N° tiers', s.numero_tiers ?? '—'],
                          ['Client', s.intitule_tiers ?? '—'],
                          ['Représentant (fiche client)', s.representant_fiche ?? '—'],
                          ['Représentant (pièce)', s.representant_piece ?? '—'],
                          ['Référence client', s.reference_client ?? '—'],
                          ['Dépôt (entête)', s.depot_entete ?? '—'],
                          ['Dépôts (lignes)', s.depots_lignes ?? '—'],
                          ['Lieu de livraison', s.lieu_livraison ?? '—'],
                          ['Livraison prévue (entête)', fmtDate(s.date_livraison_prevue)],
                          ['Livraison prévue (lignes)', s.date_livraison_min ? `${fmtDate(s.date_livraison_min)} → ${fmtDate(s.date_livraison_max)}` : '—'],
                          ['Expédition', s.expedition ?? '—'],
                          ['Affaire', s.affaire ?? '—'],
                          ['Montant HT entête', fmtEUR2(s.montant_ht)],
                          ['Montant HT lignes', `${fmtEUR2(s.montant_ht_lignes)}${s.montant_ht != null ? ` (frais d'entête ${fmtEUR2(Number(s.montant_ht) - Number(s.montant_ht_lignes))})` : ''}`],
                        ]}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Tag label={s.statut_livraison} />
                        <Tag label={s.statut_facturation} />
                        <span style={{ fontSize: 12, color: '#5B5646' }}>
                          {s.nb_lignes} ligne{s.nb_lignes > 1 ? 's' : ''} · à livrer {fmtNum(s.qte_a_livrer)} · en préparation {fmtNum(s.qte_en_preparation)} · expédiée {fmtNum(s.qte_expediee)} · facturée{' '}
                          {fmtNum(s.qte_facturee)} (dont comptabilisée {fmtNum(s.qte_facturee_comptabilisee)})
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#5B5646', marginTop: 6 }}>
                        {s.pieces_pl && <div>Préparations : {s.pieces_pl}</div>}
                        {s.pieces_bl && (
                          <div>
                            Bons de livraison : {s.pieces_bl} — dernier BL le {fmtDate(s.derniere_date_bl)}
                          </div>
                        )}
                        {s.pieces_factures && (
                          <div>
                            Factures : {s.pieces_factures} — dernière le {fmtDate(s.derniere_date_facture)}
                          </div>
                        )}
                        {s.observations && <div style={{ marginTop: 4, fontStyle: 'italic' }}>Observations : {s.observations}</div>}
                      </div>
                    </>
                  )}
                </EnteteCard>

                <EnteteCard title="Vision BLG" color={COLORS.blgViolet} absent={!b} absentText="Aucune commande de vente BLG ne porte cette référence.">
                  {b && (
                    <>
                      <InfoGrid
                        items={[
                          ['Date de commande', fmtDate(b.date_creation)],
                          ['N° tiers (via fiche BLG)', b.numero_tiers ?? '—'],
                          ['Client', b.intitule_tiers ?? '—'],
                          ['Représentant', b.representant ?? '—'],
                          ['Agence (émetteur)', b.agence ?? '—'],
                          ['Référence client', b.reference_client ?? '—'],
                          ['Dépôts (livraisons)', b.depots_livraison ?? '—'],
                          ['Lieu / condition de livraison', [b.delivery_place, b.delivery_condition].filter(Boolean).join(' · ') || '—'],
                          ['Livraison demandée (entête)', fmtDate(b.date_livraison_prevue)],
                          ['Livraison demandée (lignes)', b.date_livraison_min ? `${fmtDate(b.date_livraison_min)} → ${fmtDate(b.date_livraison_max)}` : '— (non saisie)'],
                          ['Livraison réelle (lignes)', b.date_livraison_reelle_min ? `${fmtDate(b.date_livraison_reelle_min)} → ${fmtDate(b.date_livraison_reelle_max)}` : '—'],
                          ['Dernière mise à jour', fmtDateHeure(b.last_update)],
                          ['Montant HT entête', fmtEUR2(b.montant_ht)],
                          ['Montant HT lignes', fmtEUR2(b.montant_ht_lignes)],
                          ['Montant TTC', fmtEUR2(b.montant_ttc)],
                        ]}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Tag label={b.statut_livraison} />
                        <Tag label={b.statut_facturation} />
                        <span style={{ fontSize: 12, color: '#5B5646' }}>
                          {b.nb_lignes} ligne{b.nb_lignes > 1 ? 's' : ''} · à livrer {fmtNum(b.qte_a_livrer)} · en préparation {fmtNum(b.qte_en_preparation)} · livrée {fmtNum(b.qte_livree)} · facturée{' '}
                          {fmtNum(b.qte_facturee)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#5B5646', marginTop: 6 }}>
                        {b.pieces_bl && (
                          <div>
                            Bons de livraison : {b.pieces_bl} — dernier le {fmtDate(b.derniere_date_bl)}
                          </div>
                        )}
                        {b.pieces_factures && (
                          <div>
                            Factures : {b.pieces_factures} — dernière le {fmtDate(b.derniere_date_facture)}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </EnteteCard>
              </div>

              {/* ---- Onglets ---- */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                <Chip active={onglet === 'rapprochement'} onClick={() => setOnglet('rapprochement')}>
                  Rapprochement par article ({cmp.length}
                  {nbEcartsLignes > 0 ? ` · ${nbEcartsLignes} écart${nbEcartsLignes > 1 ? 's' : ''}` : ''})
                </Chip>
                <Chip active={onglet === 'sage'} onClick={() => setOnglet('sage')}>
                  Lignes SAGE ({detail?.sage_lignes.length ?? 0})
                </Chip>
                <Chip active={onglet === 'blg'} onClick={() => setOnglet('blg')}>
                  Lignes BLG ({detail?.blg_lignes.length ?? 0})
                </Chip>
                <Chip active={onglet === 'livraisons'} onClick={() => setOnglet('livraisons')}>
                  Livraisons BLG ({detail?.blg_livraisons.length ?? 0})
                </Chip>
                <Chip active={onglet === 'factures'} onClick={() => setOnglet('factures')}>
                  Factures BLG ({detail?.blg_factures.length ?? 0})
                </Chip>
              </div>

              <div style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  {onglet === 'rapprochement' && <TableRapprochement lignes={cmp} />}
                  {onglet === 'sage' && <TableSageLignes lignes={detail?.sage_lignes ?? []} />}
                  {onglet === 'blg' && <TableBlgLignes lignes={detail?.blg_lignes ?? []} />}
                  {onglet === 'livraisons' && <TableBlgLivraisons lignes={detail?.blg_livraisons ?? []} />}
                  {onglet === 'factures' && <TableBlgFactures lignes={detail?.blg_factures ?? []} />}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TableRapprochement({ lignes }: { lignes: LigneComparaison[] }) {
  if (lignes.length === 0) return <Vide texte="Aucune ligne à rapprocher." />;
  const cell = (v: number | null | undefined, ecart: boolean, present: boolean) => (
    <td style={{ ...tdStyleSm, textAlign: 'right', color: !present ? '#B8B2A0' : ecart ? COLORS.rouge : COLORS.marine, fontWeight: ecart && present ? 600 : 400 }}>
      {present ? fmtNum(v) : '—'}
    </td>
  );
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyleSm}>Article</th>
          <th style={thStyleSm}>Désignation</th>
          <th style={thStyleSm}>Présence</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu, textAlign: 'right' }}>SAGE cdée</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet, textAlign: 'right' }}>BLG cdée</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu, textAlign: 'right' }}>SAGE à livrer</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet, textAlign: 'right' }}>BLG à livrer</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu, textAlign: 'right' }}>SAGE prépa.</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet, textAlign: 'right' }}>BLG prépa.</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu, textAlign: 'right' }}>SAGE livrée</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet, textAlign: 'right' }}>BLG livrée</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu, textAlign: 'right' }}>SAGE fact.</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet, textAlign: 'right' }}>BLG fact.</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu, textAlign: 'right' }}>SAGE HT</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet, textAlign: 'right' }}>BLG HT</th>
          <th style={{ ...thStyleSm, background: COLORS.sageBleu }}>États SAGE</th>
          <th style={{ ...thStyleSm, background: COLORS.blgViolet }}>États BLG</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => {
          const inS = l.presence !== 'BLG_SEUL';
          const inB = l.presence !== 'SAGE_SEUL';
          const anyEcart = l.ecart_commande || l.ecart_livraison || l.ecart_facturation || l.ecart_montant;
          return (
            <tr key={l.cle_article} style={{ background: anyEcart ? '#FFF6F1' : 'transparent' }}>
              <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>{l.reference_article ?? '—'}</td>
              <td style={{ ...tdStyleSm, whiteSpace: 'normal', minWidth: 220 }}>{l.designation ?? '—'}</td>
              <td style={tdStyleSm}>
                <PresenceTag presence={l.presence} />
              </td>
              {cell(l.sage_qte_commandee, l.ecart_commande, inS)}
              {cell(l.blg_qte_commandee, l.ecart_commande, inB)}
              {cell(l.sage_qte_a_livrer, false, inS)}
              {cell(l.blg_qte_a_livrer, false, inB)}
              {cell(l.sage_qte_en_preparation, false, inS)}
              {cell(l.blg_qte_en_preparation, false, inB)}
              {cell(l.sage_qte_livree, l.ecart_livraison, inS)}
              {cell(l.blg_qte_livree, l.ecart_livraison, inB)}
              {cell(l.sage_qte_facturee, l.ecart_facturation, inS)}
              {cell(l.blg_qte_facturee, l.ecart_facturation, inB)}
              <td style={{ ...tdStyleSm, textAlign: 'right', color: l.ecart_montant ? COLORS.rouge : COLORS.marine, fontWeight: l.ecart_montant ? 600 : 400 }}>
                {inS ? fmtEUR2(l.sage_montant_ht) : '—'}
              </td>
              <td style={{ ...tdStyleSm, textAlign: 'right', color: l.ecart_montant ? COLORS.rouge : COLORS.marine, fontWeight: l.ecart_montant ? 600 : 400 }}>
                {inB ? fmtEUR2(l.blg_montant_ht) : '—'}
              </td>
              <td style={{ ...tdStyleSm, fontSize: 11.5, whiteSpace: 'normal' }}>{l.sage_etats ?? '—'}</td>
              <td style={{ ...tdStyleSm, fontSize: 11.5, whiteSpace: 'normal' }}>{l.blg_etats ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TableSageLignes({ lignes }: { lignes: SageLigne[] }) {
  if (lignes.length === 0) return <Vide texte="Aucune ligne SAGE rattachée à cette commande." />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyleSm}>État</th>
          <th style={thStyleSm}>Pièce</th>
          <th style={thStyleSm}>Date pièce</th>
          <th style={thStyleSm}>Article</th>
          <th style={thStyleSm}>Désignation</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Qté</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>PU net</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Montant HT</th>
          <th style={thStyleSm}>Dépôt</th>
          <th style={thStyleSm}>Liv. prévue</th>
          <th style={thStyleSm}>Date BL</th>
          <th style={thStyleSm}>Facture</th>
          <th style={thStyleSm}>Collaborateur</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.ligne_id} style={{ opacity: l.ligne_information ? 0.6 : 1 }}>
            <td style={tdStyleSm}>
              <Tag label={l.etat_libelle} />
              {l.ligne_information && (
                <span style={{ marginLeft: 6, fontSize: 11, color: '#8A8474' }} title="Ligne d'information (exclue des totaux)">
                  info
                </span>
              )}
            </td>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace' }}>{l.document}</td>
            <td style={tdStyleSm}>{fmtDate(l.date_document)}</td>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace' }}>{l.reference_article ?? '—'}</td>
            <td style={{ ...tdStyleSm, whiteSpace: 'normal', minWidth: 220 }}>{l.designation ?? '—'}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR2(l.pu_net)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR2(l.montant_ht)}</td>
            <td style={tdStyleSm}>{l.depot ?? '—'}</td>
            <td style={tdStyleSm}>{fmtDate(l.date_livraison)}</td>
            <td style={tdStyleSm}>{fmtDate(l.date_bl)}</td>
            <td style={tdStyleSm}>
              {l.numero_facture ? (
                <>
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{l.numero_facture}</span> · {fmtDate(l.date_facture)}
                  {l.facture_comptabilisee != null && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: l.facture_comptabilisee ? COLORS.vert : COLORS.alerte }}>
                      {l.facture_comptabilisee ? 'comptabilisée' : 'non comptabilisée'}
                    </span>
                  )}
                </>
              ) : (
                '—'
              )}
            </td>
            <td style={tdStyleSm}>{l.collaborateur ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableBlgLignes({ lignes }: { lignes: BlgLigne[] }) {
  if (lignes.length === 0) return <Vide texte="Aucune ligne BLG." />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyleSm}>État</th>
          <th style={thStyleSm}>Article</th>
          <th style={thStyleSm}>Désignation</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Qté</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>À livrer</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>En prépa.</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Livrée</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Facturée</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>PU HT</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Remise</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Montant HT</th>
          <th style={thStyleSm}>Liv. demandée</th>
          <th style={thStyleSm}>Liv. réelle</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.ligne_id}>
            <td style={tdStyleSm}>
              <Tag label={l.etat_libelle} />
            </td>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace' }}>{l.article_reference ?? '—'}</td>
            <td style={{ ...tdStyleSm, whiteSpace: 'normal', minWidth: 220 }}>{l.designation ?? '—'}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.qte_a_livrer)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.qte_en_preparation)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.qte_livree)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.qte_facturee)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR2(l.pu_ht)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{l.remise ? `${Math.round(Number(l.remise) * 100)} %` : '—'}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR2(l.montant_ht)}</td>
            <td style={tdStyleSm}>{fmtDate(l.date_livraison_demandee)}</td>
            <td style={tdStyleSm}>{fmtDate(l.date_livraison_reelle)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableBlgLivraisons({ lignes }: { lignes: BlgLivraison[] }) {
  if (lignes.length === 0) return <Vide texte="Aucun bon de livraison BLG rattaché." />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyleSm}>BL</th>
          <th style={thStyleSm}>Date livraison</th>
          <th style={thStyleSm}>Article</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Qté livrée</th>
          <th style={thStyleSm}>Dépôt</th>
          <th style={thStyleSm}>Statut ligne</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={`${l.bl_id}-${i}`}>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>
              <LienBlg href={l.lien_blg}>{l.bl_reference}</LienBlg>
            </td>
            <td style={tdStyleSm}>{fmtDate(l.date_livraison)}</td>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace' }}>{l.article_reference ?? '—'}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite_livree)}</td>
            <td style={tdStyleSm}>{l.depot ?? '—'}</td>
            <td style={tdStyleSm}>{l.statut_ligne ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableBlgFactures({ lignes }: { lignes: BlgFacture[] }) {
  if (lignes.length === 0) return <Vide texte="Aucune facture BLG rattachée." />;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyleSm}>Facture</th>
          <th style={thStyleSm}>Type</th>
          <th style={thStyleSm}>Date</th>
          <th style={thStyleSm}>Règlement</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Total facture HT</th>
          <th style={thStyleSm}>Article</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Qté</th>
          <th style={{ ...thStyleSm, textAlign: 'right' }}>Montant HT ligne</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={`${l.facture_id}-${i}`}>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>
              <LienBlg href={l.lien_blg}>{l.facture_reference}</LienBlg>
            </td>
            <td style={tdStyleSm}>{l.facture_type === 'customerRefundDocument' ? 'Avoir' : 'Facture'}</td>
            <td style={tdStyleSm}>{fmtDate(l.date_facture)}</td>
            <td style={tdStyleSm}>{l.etat_reglement}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR2(l.facture_montant_ht)}</td>
            <td style={{ ...tdStyleSm, fontFamily: '"IBM Plex Mono", monospace' }}>{l.article_reference ?? '—'}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite)}</td>
            <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR2(l.montant_ht)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------
// Petits composants de présentation
// ---------------------------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 500 }}>
      {label}
      {children}
    </label>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? COLORS.marine : COLORS.ligne}`,
        background: active ? COLORS.marine : COLORS.blanc,
        color: active ? COLORS.creme : COLORS.marine,
        fontSize: 12.5,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Kpi({ label, value, accent, compact }: { label: string; value: string; accent?: string; compact?: boolean }) {
  return (
    <div style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, padding: compact ? '10px 12px' : '14px 16px', borderLeft: `4px solid ${accent ?? COLORS.marine}` }}>
      <div style={{ fontSize: compact ? 11 : 12, color: '#8A8474', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: compact ? 16 : 20, fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  tone,
  right,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
  tone?: 'sage' | 'blg';
  right?: boolean;
}) {
  const bg = tone === 'sage' ? COLORS.sageBleu : tone === 'blg' ? COLORS.blgViolet : COLORS.marine;
  return (
    <th onClick={onClick} style={{ ...thStyle, background: bg, cursor: onClick ? 'pointer' : 'default', textAlign: right ? 'right' : 'left', userSelect: 'none' }}>
      {children}
      {active && <span style={{ marginLeft: 4, fontSize: 10 }}>{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function PresenceTag({ presence }: { presence: Presence }) {
  const color = presence === 'LES_DEUX' ? COLORS.vert : presence === 'SAGE_SEUL' ? COLORS.sageBleu : COLORS.blgViolet;
  const label = presence === 'LES_DEUX' ? 'SAGE + BLG' : presence === 'SAGE_SEUL' ? 'SAGE seul' : 'BLG seul';
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, color: '#fff', background: color, whiteSpace: 'nowrap' }}>{label}</span>;
}

function PresencePill({ present, label, color }: { present: boolean; label: string; color: string }) {
  return (
    <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, background: present ? color : 'rgba(255,255,255,0.08)', color: present ? '#fff' : '#8A8474', border: `1px solid ${present ? color : 'rgba(255,255,255,0.2)'}` }}>
      {present ? '● ' : '○ '}
      {label}
    </span>
  );
}

function EcartBadge({ label, hint }: { label: string; hint: string }) {
  return (
    <span title={hint} style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 6, fontSize: 11, color: '#fff', background: COLORS.alerte, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function EnteteCard({ title, color, absent, absentText, children }: { title: string; color: string; absent: boolean; absentText: string; children: React.ReactNode }) {
  return (
    <div style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderTop: `4px solid ${color}`, borderRadius: 10, padding: 16 }}>
      <h2 style={{ ...sectionTitleStyle, color }}>{title}</h2>
      {absent ? <p style={{ color: '#8A8474', fontSize: 13, margin: 0 }}>{absentText}</p> : children}
    </div>
  );
}

function InfoGrid({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '6px 16px', fontSize: 13 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 11, color: '#8A8474' }}>{k}</span>
          <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Vide({ texte }: { texte: string }) {
  return <div style={{ padding: 28, textAlign: 'center', color: '#8A8474', fontSize: 13 }}>{texte}</div>;
}

// Lien direct vers le document BLG ; coupe la propagation pour ne pas ouvrir la fiche.
function LienBlg({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }} title="Ouvrir dans BLG">
      {children} <span style={{ fontSize: '0.75em', opacity: 0.55 }}>↗</span>
    </a>
  );
}

function Tag({ label }: { label: string }) {
  const l = norm(label);
  const color =
    l === 'livree' || l.startsWith('facturee comptabilisee') || l === 'facturee' || l === 'expediee'
      ? COLORS.vert
      : l.includes('partiel')
      ? COLORS.alerte
      : l.startsWith('non ') || l === 'a livrer'
      ? COLORS.rouge
      : l.includes('preparation') || l.includes('non comptabilisee')
      ? '#B58A2A'
      : '#5B5646';
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 12, color: '#fff', background: color, whiteSpace: 'nowrap' }}>{label}</span>;
}

// ---------------------------------------------------------------------
// Styles inline partagés
// ---------------------------------------------------------------------
const ecartDotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: COLORS.alerte,
  marginLeft: 6,
  verticalAlign: 'middle',
};

const selectStyle: React.CSSProperties = {
  border: `1px solid ${COLORS.ligne}`,
  borderRadius: 8,
  padding: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${COLORS.ligne}`,
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: COLORS.blanc,
  color: COLORS.marine,
  border: `1px solid ${COLORS.ligne}`,
  borderRadius: 8,
  padding: '9px 16px',
  fontSize: 13.5,
  cursor: 'pointer',
};

const exportButtonStyle: React.CSSProperties = {
  background: COLORS.violet,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  background: COLORS.marine,
  color: COLORS.creme,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderBottom: `1px solid ${COLORS.ligne}`,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
};

const thStyleSm: React.CSSProperties = { ...thStyle, padding: '7px 10px', fontSize: 12 };
const tdStyleSm: React.CSSProperties = { ...tdStyle, padding: '6px 10px', fontSize: 12.5 };

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: '"Space Grotesk", sans-serif',
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 8,
  marginTop: 0,
};
