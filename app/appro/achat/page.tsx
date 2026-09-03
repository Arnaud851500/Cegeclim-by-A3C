'use client';

/**
 * Page "Appro / Achats"
 * ---------------------------------------------------------------------
 * Écran de pilotage des commandes fournisseurs (BLG) : filtres
 * multi-dimension, KPIs agrégés (dont répartition par statut livraison/
 * facturation), fiche détail par commande (lignes + BL + factures) et
 * export Excel multi-onglets.
 *
 * Dépend des objets Supabase créés dans le projet gchwihltydsplarhveyv :
 *   - vues : v_appro_cdf_entete, v_appro_cdf_lignes, v_appro_bl,
 *            v_appro_faf_lignes, v_appro_fournisseurs,
 *            v_appro_incoherences_livraison
 *   - RPC  : get_appro_filtres_disponibles
 *            get_appro_achats_kpis(...)
 *            get_appro_achats_synthese_fournisseurs(...)
 *
 * ADAPTER avant intégration :
 *   - le chemin d'import du client Supabase ci-dessous (`@/lib/supabase`)
 *   - la route/emplacement du fichier (ex: app/appro/achats/page.tsx)
 *
 * Limites de données connues (documentées ici pour ne pas les redécouvrir) :
 *   - sale_quote.created_at est réécrit par BLG à chaque resynchro du
 *     document -> tous les filtres/délais "date de création" utilisent
 *     order_date (date métier stable), jamais created_at.
 *   - sale_quote.delivery_date_required / sale_quote_line.delivery_date_required
 *     ("date de livraison demandée") ne sont renseignées quasiment jamais
 *     côté BLG (4 CDF / 31286, 5 lignes / 216108) -> colonne affichée mais
 *     attendez-vous à "—" presque partout ; la "fenêtre de livraison"
 *     (date_livraison_min/max côté entête) utilise à la place les dates
 *     réelles des lignes (delivery_date_actual), bien plus renseignées.
 *   - il n'existe AUCUN champ "AR fournisseur" mirroré depuis BLG (ni sur
 *     la commande, ni sur la ligne) : l'AR est un évènement de l'historique
 *     BLG, pas une colonne de la base. Le délai "création -> AR" est donc
 *     approximé par "création -> 1ère réception (BL)" ; à la ligne, aucune
 *     date d'AR n'est disponible, c'est explicitement indiqué dans l'UI.
 *   - le statut d'entête BLG (delivery_status) et le badge de workflow
 *     manuel (status_fk = 14, affiché "Livrée" côté BLG) peuvent tous les
 *     deux se désynchroniser du vrai état des lignes (reste à livrer) :
 *     BLG ne recalcule pas toujours ces deux champs au dernier mouvement
 *     de stock. Voir l'onglet "Incohérences" et v_appro_incoherences_livraison,
 *     qui recalcule le statut réel à partir des lignes (hors lignes de
 *     type "comment", qui ne portent ni quantité ni livraison) et le
 *     compare aux deux champs BLG.
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
};

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type FournisseurOption = { id: number; code: string; nom: string };
type LieuOption = { delivery_fk: number; nom: string };

type Kpis = {
  nb_commandes: number;
  nb_lignes: number;
  valeur_achat_ht: number;
  valeur_achat_ttc: number;
  valeur_ht_livree: number;
  valeur_ht_livree_partielle: number;
  valeur_ht_non_livree: number;
  valeur_ht_facturee: number;
  valeur_ht_facturee_partielle: number;
  valeur_ht_non_facturee: number;
  delai_moyen_creation_bl_jours: number | null;
  delai_moyen_creation_facture_jours: number | null;
};

type SyntheseFournisseur = {
  supplier_id: number;
  code_fournisseur: string;
  nom_fournisseur: string;
  nb_commandes: number;
  nb_lignes: number;
  valeur_achat_ht: number;
  valeur_achat_ttc: number;
  valeur_ht_livree: number;
  valeur_ht_livree_partielle: number;
  valeur_ht_non_livree: number;
  valeur_ht_facturee: number;
  valeur_ht_facturee_partielle: number;
  valeur_ht_non_facturee: number;
  delai_moyen_creation_bl_jours: number | null;
  delai_moyen_creation_facture_jours: number | null;
};

type CdfEntete = {
  id: number;
  reference: string;
  lien_blg: string | null;
  order_date: string | null;
  date_livraison_min: string | null;
  date_livraison_max: string | null;
  code_fournisseur: string | null;
  nom_fournisseur: string | null;
  supplier_fk: number | null;
  delivery_fk: number | null;
  lieu_livraison_nom: string | null;
  lieu_livraison_ville: string | null;
  delivery_status: string;
  invoice_status: string;
  tag_livraison: string;
  tag_facturation: string;
  montant_ht: number;
  montant_ttc: number;
  dans_bdcf: boolean;
};

type CdfLigne = {
  id: number;
  cdf_id: number;
  cdf_reference: string;
  cdf_lien_blg: string | null;
  cdf_order_date: string | null;
  dans_bdcf: boolean;
  supplier_fk: number | null;
  code_fournisseur: string | null;
  nom_fournisseur: string | null;
  delivery_fk: number | null;
  article_reference: string | null;
  article_label: string | null;
  commentaire: string | null;
  ligne_created_at: string | null;
  date_livraison_demandee: string | null;
  date_livraison: string | null;
  delai_creation_livraison_jours: number | null;
  quantite: number | null;
  quantite_commandee: number | null;
  quantite_ral: number | null;
  quantite_livree: number | null;
  quantite_facturee: number | null;
  quantite_a_facturer: number | null;
  prix_unitaire: number | null;
  total_ttc: number | null;
  statut_livraison_code: string;
  tag_livraison_ligne: string;
  statut_facturation_code: string;
  tag_facturation_ligne: string;
};

type BlLigne = {
  bl_id: number;
  bl_reference: string;
  lien_blg: string | null;
  bl_ligne_id: number;
  date_reception: string | null;
  article_reference: string | null;
  quantite_recue: number | null;
};

type FafLigne = {
  faf_id: number;
  faf_reference: string;
  lien_blg: string | null;
  faf_invoice_date: string | null;
  faf_montant_ttc: number | null;
  article_reference: string | null;
  quantite: number | null;
  total_ttc: number | null;
};

type FreqTemporelleRow = {
  periode: string;
  supplier_id: number | null;
  code_fournisseur: string;
  nom_fournisseur: string;
  nb_commandes: number;
  valeur_ht: number;
};

// Une ligne de public.v_appro_incoherences_livraison : commandes d'achat
// où le statut d'entête BLG (delivery_status) et/ou le badge de workflow
// manuel (status_fk = 14, "Livrée") ne correspondent pas au statut
// recalculé à partir des lignes réelles (hors lignes "comment").
type IncoherenceLivraison = {
  id: number;
  reference: string;
  lien_blg: string | null;
  order_date: string | null;
  fournisseur: string | null;
  statut_entete: string;
  statut_calcule_lignes: string;
  status_fk: number | null;
  badge_workflow_livree: boolean;
  total_qte: number | null;
  total_qte_livree: number | null;
  total_ral: number | null;
  derniere_livraison_ligne: string | null;
  entete_last_update: string | null;
  lignes_last_update: string | null;
  type_incoherence: 'entete_desynchronisee' | 'badge_workflow_incoherent' | null;
};

type Granularite = 'day' | 'week' | 'month';

type Vue = 'entete' | 'lignes' | 'incoherences';

const STATUTS_LIVRAISON: { value: string; label: string }[] = [
  { value: 'delivered', label: 'Livrée' },
  { value: 'partiallyDelivered', label: 'Livrée partielle' },
  { value: 'notDelivered', label: 'Non livrée' },
  { value: 'notConcerned', label: 'Non concernée' },
];

const STATUTS_FACTURATION: { value: string; label: string }[] = [
  { value: 'invoiced', label: 'Facturée' },
  { value: 'partiallyInvoiced', label: 'Facturée partielle' },
  { value: 'notInvoiced', label: 'Non facturée' },
];

// Libellés FR des statuts BLG bruts (delivery_status et statut_calcule_lignes
// partagent le même vocabulaire), utilisés dans l'onglet Incohérences.
const LABEL_STATUT_LIVRAISON: Record<string, string> = {
  delivered: 'Livrée',
  partiallyDelivered: 'Livrée partielle',
  notDelivered: 'Non livrée',
  notConcerned: 'Non concernée',
};

const TYPES_INCOHERENCE: { value: 'entete_desynchronisee' | 'badge_workflow_incoherent'; label: string }[] = [
  { value: 'entete_desynchronisee', label: 'Entête désynchronisée' },
  { value: 'badge_workflow_incoherent', label: 'Badge "Livrée" incohérent' },
];

const PAGE_SIZE = 50;
const EXPORT_MAX_ROWS = 8000; // garde-fou pour ne pas geler le navigateur
const DATE_CREATION_MIN_DEFAUT = '2026-01-01'; // date de création minimale appliquée par défaut à l'ouverture

const fmtEUR = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const fmtNum = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('fr-FR'));

const fmtJours = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} j`);

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

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const fmtPeriodeExport = (p: string, granularite: Granularite) => {
  const d = new Date(p + 'T00:00:00');
  if (granularite === 'day') return d.toLocaleDateString('fr-FR');
  if (granularite === 'week') return `Sem. du ${d.toLocaleDateString('fr-FR')}`;
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
};

// Nombre de jours entre la dernière livraison de ligne et la dernière
// mise à jour de l'entête -- l'indicateur visuel de "depuis combien de
// temps" l'entête a manqué le vrai état des lignes.
const joursEcart = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round(Math.abs(da - db) / 86400000);
};

// ---------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------
export default function ApproAchatsPage() {
  // --- filtres ---
  const [fournisseurOptions, setFournisseurOptions] = useState<FournisseurOption[]>([]);
  const [lieuOptions, setLieuOptions] = useState<LieuOption[]>([]);
  const [fournisseurSearch, setFournisseurSearch] = useState('');
  const [lieuSearch, setLieuSearch] = useState('');
  const [supplierIds, setSupplierIds] = useState<number[]>([]);
  const [lieuIds, setLieuIds] = useState<number[]>([]);
  const [cdfReference, setCdfReference] = useState('');
  const [dateCreationFrom, setDateCreationFrom] = useState(DATE_CREATION_MIN_DEFAUT);
  const [dateCreationTo, setDateCreationTo] = useState('');
  const [dateLivraisonFrom, setDateLivraisonFrom] = useState('');
  const [dateLivraisonTo, setDateLivraisonTo] = useState('');
  const [statutsLivraison, setStatutsLivraison] = useState<string[]>([]);
  const [statutsFacturation, setStatutsFacturation] = useState<string[]>([]);
  const [articleReference, setArticleReference] = useState('');
  const [dansBdcf, setDansBdcf] = useState<'all' | 'yes' | 'no'>('all');

  // --- vue / résultats ---
  const [vue, setVue] = useState<Vue>('entete');
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [syntheseFournisseurs, setSyntheseFournisseurs] = useState<SyntheseFournisseur[]>([]);
  const [freqTemporelle, setFreqTemporelle] = useState<FreqTemporelleRow[]>([]);
  const [rowsEntete, setRowsEntete] = useState<CdfEntete[]>([]);
  const [rowsLignes, setRowsLignes] = useState<CdfLigne[]>([]);
  const [page, setPage] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- onglet Incohérences (indépendant des filtres/KPIs ci-dessus : liste
  // de diagnostic, pas un périmètre d'analyse financière) ---
  const [rowsIncoherences, setRowsIncoherences] = useState<IncoherenceLivraison[]>([]);
  const [nbIncoherencesTotal, setNbIncoherencesTotal] = useState(0);
  const [pageIncoherences, setPageIncoherences] = useState(0);
  const [totalIncoherences, setTotalIncoherences] = useState(0);
  const [loadingIncoherences, setLoadingIncoherences] = useState(false);
  const [errorIncoherences, setErrorIncoherences] = useState<string | null>(null);
  const [filtreTypeIncoherence, setFiltreTypeIncoherence] = useState<'all' | 'entete_desynchronisee' | 'badge_workflow_incoherent'>('all');

  // --- fiche détail (modal) ---
  const [detailCdfId, setDetailCdfId] = useState<number | null>(null);

  // --- graphe fréquence des commandes par fournisseur ---
  const [chartSupplierSearch, setChartSupplierSearch] = useState('');
  const [chartSupplierIds, setChartSupplierIds] = useState<number[]>([]);
  const [frequenceGranularite, setFrequenceGranularite] = useState<Granularite>('month');

  // -------------------------------------------------------------
  // Chargement des options de filtre (une fois)
  // -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.rpc('get_appro_filtres_disponibles');
      if (err) {
        setError(`Impossible de charger les filtres : ${err.message}`);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setFournisseurOptions(row?.fournisseurs ?? []);
      setLieuOptions(row?.lieux_livraison ?? []);
    })();
  }, []);

  // Nombre total d'incohérences (badge sur l'onglet), chargé une fois au
  // montage indépendamment de l'onglet actif.
  useEffect(() => {
    (async () => {
      const { count, error: err } = await supabase
        .from('v_appro_incoherences_livraison')
        .select('*', { count: 'exact', head: true });
      if (!err) setNbIncoherencesTotal(count ?? 0);
    })();
  }, []);

  const fournisseurOptionsFiltres = useMemo(() => {
    if (!fournisseurSearch.trim()) return fournisseurOptions;
    const q = norm(fournisseurSearch);
    return fournisseurOptions.filter((f) => norm(`${f.code} ${f.nom}`).includes(q));
  }, [fournisseurOptions, fournisseurSearch]);

  const lieuOptionsFiltres = useMemo(() => {
    if (!lieuSearch.trim()) return lieuOptions;
    const q = norm(lieuSearch);
    return lieuOptions.filter((l) => norm(l.nom).includes(q));
  }, [lieuOptions, lieuSearch]);

  const chartSupplierOptionsFiltres = useMemo(() => {
    if (!chartSupplierSearch.trim()) return fournisseurOptions;
    const q = norm(chartSupplierSearch);
    return fournisseurOptions.filter((f) => norm(`${f.code} ${f.nom}`).includes(q));
  }, [fournisseurOptions, chartSupplierSearch]);

  // Données du graphe : fournisseurs cochés dans le filtre dédié, sinon
  // top 15 par nombre de commandes — toujours dans le périmètre des
  // filtres globaux (dates, statuts, article…) puisque syntheseFournisseurs
  // en découle déjà.
  const donneesFrequence = useMemo(() => {
    const base =
      chartSupplierIds.length > 0
        ? syntheseFournisseurs.filter((f) => chartSupplierIds.includes(f.supplier_id))
        : syntheseFournisseurs;
    return [...base].sort((a, b) => b.nb_commandes - a.nb_commandes).slice(0, chartSupplierIds.length > 0 ? undefined : 15);
  }, [syntheseFournisseurs, chartSupplierIds]);

  const maxNbCommandesFrequence = useMemo(
    () => Math.max(1, ...donneesFrequence.map((f) => f.nb_commandes)),
    [donneesFrequence]
  );

  // Reshape freqTemporelle (lignes période x fournisseur) en séries
  // empilées pour l'histogramme : une entrée par période (jour/semaine/
  // mois selon frequenceGranularite), avec la répartition par fournisseur
  // et les totaux (nb commandes + valeur HT) pour le tooltip.
  const PALETTE = ['#7A5EA8', '#A6A181', '#C1683C', '#3E7A4E', '#2F6690', '#B0442E', '#8A6BB0', '#5B5646', '#C9A227', '#4C6E5D'];

  const frequenceMensuelle = useMemo(() => {
    const periodeSet = new Set(freqTemporelle.map((r) => r.periode));
    const periodesTriees = [...periodeSet].sort();

    const codesOrdreParTotal = new Map<string, number>();
    freqTemporelle.forEach((r) => {
      codesOrdreParTotal.set(r.code_fournisseur, (codesOrdreParTotal.get(r.code_fournisseur) ?? 0) + r.nb_commandes);
    });
    const codes = [...codesOrdreParTotal.entries()]
      .sort((a, b) => (a[0] === 'AUTRES' ? 1 : b[0] === 'AUTRES' ? -1 : b[1] - a[1]))
      .map(([code]) => code);
    const couleurParCode = new Map<string, string>();
    codes.forEach((code, i) => couleurParCode.set(code, code === 'AUTRES' ? '#B8B2A0' : PALETTE[i % PALETTE.length]));

    const parPeriode = periodesTriees.map((p) => {
      const lignesDeLaPeriode = freqTemporelle.filter((r) => r.periode === p);
      const totalNb = lignesDeLaPeriode.reduce((s, r) => s + r.nb_commandes, 0);
      const totalHt = lignesDeLaPeriode.reduce((s, r) => s + r.valeur_ht, 0);
      const segments = codes
        .map((code) => lignesDeLaPeriode.find((r) => r.code_fournisseur === code))
        .filter((r): r is FreqTemporelleRow => !!r)
        .map((r) => ({
          code: r.code_fournisseur,
          nom: r.nom_fournisseur,
          nb: r.nb_commandes,
          valeurHt: r.valeur_ht,
          couleur: couleurParCode.get(r.code_fournisseur)!,
        }));
      return { periode: p, totalNb, totalHt, segments };
    });

    return { periodes: parPeriode, codes, couleurParCode };
  }, [freqTemporelle]);

  // -------------------------------------------------------------
  // Paramètres RPC partagés (KPI / synthèse fournisseurs)
  // -------------------------------------------------------------
  const rpcParams = useMemo(
    () => ({
      p_supplier_ids: supplierIds.length ? supplierIds : null,
      p_created_from: dateCreationFrom || null,
      p_created_to: dateCreationTo || null,
      p_delivery_from: dateLivraisonFrom || null,
      p_delivery_to: dateLivraisonTo || null,
      p_delivery_status: statutsLivraison.length ? statutsLivraison : null,
      p_invoice_status: statutsFacturation.length ? statutsFacturation : null,
      p_delivery_fk_ids: lieuIds.length ? lieuIds : null,
      p_article_reference: articleReference.trim() || null,
      p_cdf_reference: cdfReference.trim() || null,
      p_dans_bdcf: dansBdcf === 'all' ? null : dansBdcf === 'yes',
    }),
    [
      supplierIds,
      dateCreationFrom,
      dateCreationTo,
      dateLivraisonFrom,
      dateLivraisonTo,
      statutsLivraison,
      statutsFacturation,
      lieuIds,
      articleReference,
      cdfReference,
      dansBdcf,
    ]
  );

  // -------------------------------------------------------------
  // Applique un filtre commun sur une query supabase-js pointant vers
  // une des deux vues (entête ou lignes) — colonnes alignées entre les
  // deux vues (supplier_fk, delivery_fk, order_date/cdf_order_date,
  // statuts en code brut) donc le même filtre s'applique aux deux.
  // -------------------------------------------------------------
  const applyCommonFilters = useCallback(
    (query: any, kind: 'entete' | 'lignes') => {
      let q = query;
      if (supplierIds.length) q = q.in('supplier_fk', supplierIds);
      if (lieuIds.length) q = q.in('delivery_fk', lieuIds);
      const dateCol = kind === 'entete' ? 'order_date' : 'cdf_order_date';
      if (dateCreationFrom) q = q.gte(dateCol, dateCreationFrom);
      if (dateCreationTo) q = q.lte(dateCol, dateCreationTo);
      if (statutsLivraison.length) {
        q = q.in(kind === 'entete' ? 'delivery_status' : 'statut_livraison_code', statutsLivraison);
      }
      if (statutsFacturation.length) {
        q = q.in(kind === 'entete' ? 'invoice_status' : 'statut_facturation_code', statutsFacturation);
      }
      if (kind === 'lignes') {
        if (dateLivraisonFrom) q = q.gte('date_livraison', dateLivraisonFrom);
        if (dateLivraisonTo) q = q.lte('date_livraison', dateLivraisonTo);
        if (articleReference.trim()) q = q.ilike('article_reference', `%${articleReference.trim()}%`);
      }
      if (cdfReference.trim()) {
        q = q.ilike(kind === 'entete' ? 'reference' : 'cdf_reference', `%${cdfReference.trim()}%`);
      }
      if (dansBdcf !== 'all') {
        q = q.eq('dans_bdcf', dansBdcf === 'yes');
      }
      return q;
    },
    [
      supplierIds,
      lieuIds,
      dateCreationFrom,
      dateCreationTo,
      statutsLivraison,
      statutsFacturation,
      dateLivraisonFrom,
      dateLivraisonTo,
      articleReference,
      cdfReference,
      dansBdcf,
    ]
  );

  // -------------------------------------------------------------
  // Lance la recherche : KPIs + synthèse fournisseurs + page courante
  // -------------------------------------------------------------
  const lancerRecherche = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: kpiData, error: kpiErr }, { data: syntheseData, error: syntheseErr }, { data: freqData, error: freqErr }] = await Promise.all([
        supabase.rpc('get_appro_achats_kpis', rpcParams),
        supabase.rpc('get_appro_achats_synthese_fournisseurs', {
          p_supplier_ids: rpcParams.p_supplier_ids,
          p_created_from: rpcParams.p_created_from,
          p_created_to: rpcParams.p_created_to,
          p_delivery_status: rpcParams.p_delivery_status,
          p_invoice_status: rpcParams.p_invoice_status,
          p_delivery_fk_ids: rpcParams.p_delivery_fk_ids,
          p_article_reference: rpcParams.p_article_reference,
          p_cdf_reference: rpcParams.p_cdf_reference,
        }),
        supabase.rpc('get_appro_frequence_temporelle', {
          p_supplier_ids: rpcParams.p_supplier_ids,
          p_created_from: rpcParams.p_created_from,
          p_created_to: rpcParams.p_created_to,
          p_delivery_status: rpcParams.p_delivery_status,
          p_invoice_status: rpcParams.p_invoice_status,
          p_delivery_fk_ids: rpcParams.p_delivery_fk_ids,
          p_article_reference: rpcParams.p_article_reference,
          p_cdf_reference: rpcParams.p_cdf_reference,
          p_chart_supplier_ids: chartSupplierIds.length ? chartSupplierIds : null,
          p_granularite: frequenceGranularite,
        }),
      ]);
      if (kpiErr) throw kpiErr;
      if (syntheseErr) throw syntheseErr;
      if (freqErr) throw freqErr;
      setKpis(Array.isArray(kpiData) ? kpiData[0] : kpiData);
      setSyntheseFournisseurs(syntheseData ?? []);
      setFreqTemporelle(freqData ?? []);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      if (vue === 'entete') {
        let q = supabase.from('v_appro_cdf_entete').select('*', { count: 'exact' });
        q = applyCommonFilters(q, 'entete');
        const { data, error: err, count } = await q.order('order_date', { ascending: false }).range(from, to);
        if (err) throw err;
        setRowsEntete(data ?? []);
        setTotalRows(count ?? 0);
      } else if (vue === 'lignes') {
        let q = supabase.from('v_appro_cdf_lignes').select('*', { count: 'exact' });
        q = applyCommonFilters(q, 'lignes');
        const { data, error: err, count } = await q.order('cdf_id', { ascending: false }).range(from, to);
        if (err) throw err;
        setRowsLignes(data ?? []);
        setTotalRows(count ?? 0);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Erreur lors de la recherche.');
    } finally {
      setLoading(false);
    }
  }, [rpcParams, applyCommonFilters, vue, page, chartSupplierIds, frequenceGranularite]);

  useEffect(() => {
    if (vue === 'entete' || vue === 'lignes') lancerRecherche();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue, page]);

  // -------------------------------------------------------------
  // Charge l'onglet Incohérences : indépendant des filtres/KPIs ci-dessus
  // (liste de diagnostic sur l'ensemble des commandes d'achat), avec sa
  // propre pagination et son propre filtre par type d'incohérence.
  // -------------------------------------------------------------
  const chargerIncoherences = useCallback(async () => {
    setLoadingIncoherences(true);
    setErrorIncoherences(null);
    try {
      let q = supabase.from('v_appro_incoherences_livraison').select('*', { count: 'exact' });
      if (filtreTypeIncoherence !== 'all') q = q.eq('type_incoherence', filtreTypeIncoherence);
      const from = pageIncoherences * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error: err, count } = await q.order('order_date', { ascending: false }).range(from, to);
      if (err) throw err;
      setRowsIncoherences(data ?? []);
      setTotalIncoherences(count ?? 0);
    } catch (e: any) {
      setErrorIncoherences(e?.message ?? 'Erreur lors du chargement des incohérences.');
    } finally {
      setLoadingIncoherences(false);
    }
  }, [filtreTypeIncoherence, pageIncoherences]);

  useEffect(() => {
    if (vue === 'incoherences') chargerIncoherences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue, pageIncoherences, filtreTypeIncoherence]);

  // Rafraîchit uniquement le graphe de fréquence quand sa sélection de
  // fournisseurs dédiée ou sa granularité changent, sans attendre un clic
  // sur "Rechercher".
  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.rpc('get_appro_frequence_temporelle', {
        p_supplier_ids: rpcParams.p_supplier_ids,
        p_created_from: rpcParams.p_created_from,
        p_created_to: rpcParams.p_created_to,
        p_delivery_status: rpcParams.p_delivery_status,
        p_invoice_status: rpcParams.p_invoice_status,
        p_delivery_fk_ids: rpcParams.p_delivery_fk_ids,
        p_article_reference: rpcParams.p_article_reference,
        p_cdf_reference: rpcParams.p_cdf_reference,
        p_chart_supplier_ids: chartSupplierIds.length ? chartSupplierIds : null,
        p_granularite: frequenceGranularite,
      });
      if (!err) setFreqTemporelle(data ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSupplierIds, frequenceGranularite]);

  const handleRechercherClick = () => {
    setPage(0);
    lancerRecherche();
  };

  const toggleInArray = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  // -------------------------------------------------------------
  // Export Excel : synthèse multi-fournisseurs / synthèse par
  // fournisseur (groupée) / détail / incohérences
  // -------------------------------------------------------------
  const exporterExcel = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      let detailQuery =
        vue === 'entete'
          ? applyCommonFilters(supabase.from('v_appro_cdf_entete').select('*'), 'entete')
          : applyCommonFilters(supabase.from('v_appro_cdf_lignes').select('*'), 'lignes');
      const { data: detailData, error: detailErr } = await detailQuery
        .order(vue === 'entete' ? 'order_date' : 'cdf_id', { ascending: false })
        .range(0, EXPORT_MAX_ROWS - 1);
      if (detailErr) throw detailErr;

      const wb = new ExcelJS.Workbook();
      wb.creator = 'CEGECLIM by A3C';
      wb.created = new Date();

      const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } };
      const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFF5F3EC' }, bold: true };
      const SUBTOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E0D4' } };

      const styleHeaderRow = (row: ExcelJS.Row) => {
        row.eachCell((cell) => {
          cell.fill = HEADER_FILL;
          cell.font = HEADER_FONT;
          cell.alignment = { vertical: 'middle' };
        });
        row.height = 20;
      };

      // ---- Onglet 1 : Synthèse multi-fournisseurs ----
      const ws1 = wb.addWorksheet('Synthèse multi-fournisseurs');
      ws1.columns = [
        { header: 'Code', key: 'code', width: 12 },
        { header: 'Fournisseur', key: 'nom', width: 30 },
        { header: 'Nb commandes', key: 'nb_cdf', width: 13 },
        { header: 'Nb lignes', key: 'nb_lignes', width: 11 },
        { header: 'Valeur achat HT', key: 'ht', width: 15, style: { numFmt: '#,##0 €' } },
        { header: 'Valeur achat TTC', key: 'ttc', width: 15, style: { numFmt: '#,##0 €' } },
        { header: 'dont HT Livrée', key: 'ht_livree', width: 14, style: { numFmt: '#,##0 €' } },
        { header: 'dont HT Livrée part.', key: 'ht_livree_part', width: 16, style: { numFmt: '#,##0 €' } },
        { header: 'dont HT Non livrée', key: 'ht_non_livree', width: 16, style: { numFmt: '#,##0 €' } },
        { header: 'dont HT Facturée', key: 'ht_facturee', width: 14, style: { numFmt: '#,##0 €' } },
        { header: 'dont HT Facturée part.', key: 'ht_facturee_part', width: 17, style: { numFmt: '#,##0 €' } },
        { header: 'dont HT Non facturée', key: 'ht_non_facturee', width: 17, style: { numFmt: '#,##0 €' } },
        { header: 'Délai moy. création→BL (j)', key: 'delai_bl', width: 18 },
        { header: 'Délai moy. création→facture (j)', key: 'delai_fact', width: 20 },
      ];
      styleHeaderRow(ws1.getRow(1));
      syntheseFournisseurs.forEach((f) => {
        ws1.addRow({
          code: f.code_fournisseur,
          nom: f.nom_fournisseur,
          nb_cdf: f.nb_commandes,
          nb_lignes: f.nb_lignes,
          ht: f.valeur_achat_ht,
          ttc: f.valeur_achat_ttc,
          ht_livree: f.valeur_ht_livree,
          ht_livree_part: f.valeur_ht_livree_partielle,
          ht_non_livree: f.valeur_ht_non_livree,
          ht_facturee: f.valeur_ht_facturee,
          ht_facturee_part: f.valeur_ht_facturee_partielle,
          ht_non_facturee: f.valeur_ht_non_facturee,
          delai_bl: f.delai_moyen_creation_bl_jours,
          delai_fact: f.delai_moyen_creation_facture_jours,
        });
      });
      const sum = (fn: (f: SyntheseFournisseur) => number) => syntheseFournisseurs.reduce((s, f) => s + fn(f), 0);
      const totalRow1 = ws1.addRow({
        nom: 'TOTAL',
        nb_cdf: sum((f) => f.nb_commandes),
        nb_lignes: sum((f) => f.nb_lignes),
        ht: sum((f) => f.valeur_achat_ht),
        ttc: sum((f) => f.valeur_achat_ttc),
        ht_livree: sum((f) => f.valeur_ht_livree),
        ht_livree_part: sum((f) => f.valeur_ht_livree_partielle),
        ht_non_livree: sum((f) => f.valeur_ht_non_livree),
        ht_facturee: sum((f) => f.valeur_ht_facturee),
        ht_facturee_part: sum((f) => f.valeur_ht_facturee_partielle),
        ht_non_facturee: sum((f) => f.valeur_ht_non_facturee),
      });
      totalRow1.font = { bold: true };
      totalRow1.eachCell((c) => (c.fill = SUBTOTAL_FILL));
      ws1.autoFilter = { from: 'A1', to: 'N1' };
      ws1.views = [{ state: 'frozen', ySplit: 1 }];

      // ---- Onglet 2 : Synthèse par fournisseur (groupée, avec sous-totaux) ----
      const ws2 = wb.addWorksheet('Synthèse par fournisseur');
      ws2.columns = [
        { header: 'Référence CDF', key: 'ref', width: 16 },
        { header: 'Date création', key: 'date', width: 14 },
        { header: 'Lieu de livraison', key: 'lieu', width: 24 },
        { header: 'Statut livraison', key: 'tag_liv', width: 16 },
        { header: 'Statut facturation', key: 'tag_fact', width: 18 },
        { header: 'Montant HT', key: 'ht', width: 14, style: { numFmt: '#,##0 €' } },
        { header: 'Montant TTC', key: 'ttc', width: 14, style: { numFmt: '#,##0 €' } },
      ];
      styleHeaderRow(ws2.getRow(1));
      ws2.views = [{ state: 'frozen', ySplit: 1 }];

      if (vue === 'entete') {
        const groupes = new Map<string, CdfEntete[]>();
        (detailData as CdfEntete[]).forEach((r) => {
          const key = r.nom_fournisseur ?? 'Fournisseur inconnu';
          if (!groupes.has(key)) groupes.set(key, []);
          groupes.get(key)!.push(r);
        });
        [...groupes.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([nomFournisseur, cdfs]) => {
            const titre = ws2.addRow({ ref: nomFournisseur.toUpperCase() });
            titre.font = { bold: true, color: { argb: 'FF7A5EA8' } };
            cdfs.forEach((c) => {
              ws2.addRow({
                ref: c.reference,
                date: fmtDate(c.order_date),
                lieu: c.lieu_livraison_nom,
                tag_liv: c.tag_livraison,
                tag_fact: c.tag_facturation,
                ht: c.montant_ht,
                ttc: c.montant_ttc,
              });
            });
            const sousTotal = ws2.addRow({
              ref: `Sous-total ${nomFournisseur}`,
              ht: cdfs.reduce((s, c) => s + (c.montant_ht ?? 0), 0),
              ttc: cdfs.reduce((s, c) => s + (c.montant_ttc ?? 0), 0),
            });
            sousTotal.font = { italic: true, bold: true };
            sousTotal.eachCell((c) => (c.fill = SUBTOTAL_FILL));
          });
      } else {
        ws2.addRow({ ref: 'Vue « Lignes » active : basculez sur « Entête » avant export pour la synthèse groupée par fournisseur.' });
      }

      // ---- Onglet 3 : Détail ----
      const ws3 = wb.addWorksheet('Détail');
      if (vue === 'entete') {
        ws3.columns = [
          { header: 'Référence CDF', key: 'reference', width: 16 },
          { header: 'Lien BLG', key: 'lien', width: 12 },
          { header: '★ SAGE', key: 'dans_bdcf_label', width: 9 },
          { header: 'Fournisseur', key: 'nom_fournisseur', width: 28 },
          { header: 'Date création', key: 'order_date', width: 14 },
          { header: 'Livraison (min → max)', key: 'periode_livraison', width: 24 },
          { header: 'Lieu de livraison', key: 'lieu_livraison_nom', width: 22 },
          { header: 'Ville livraison', key: 'lieu_livraison_ville', width: 20 },
          { header: 'Statut livraison', key: 'tag_livraison', width: 16 },
          { header: 'Statut facturation', key: 'tag_facturation', width: 18 },
          { header: 'Montant HT', key: 'montant_ht', width: 14, style: { numFmt: '#,##0 €' } },
          { header: 'Montant TTC', key: 'montant_ttc', width: 14, style: { numFmt: '#,##0 €' } },
        ];
        styleHeaderRow(ws3.getRow(1));
        (detailData as CdfEntete[]).forEach((r) =>
          ws3.addRow({
            ...r,
            lien: r.lien_blg ? { text: 'Ouvrir ↗', hyperlink: r.lien_blg } : '',
            dans_bdcf_label: r.dans_bdcf ? '★' : '',
            order_date: fmtDate(r.order_date),
            periode_livraison: r.date_livraison_min ? `${fmtDate(r.date_livraison_min)} → ${fmtDate(r.date_livraison_max)}` : '—',
          })
        );
      } else {
        ws3.columns = [
          { header: 'Référence CDF', key: 'cdf_reference', width: 16 },
          { header: 'Lien BLG', key: 'lien', width: 12 },
          { header: '★ SAGE', key: 'dans_bdcf_label', width: 9 },
          { header: 'Article', key: 'article_reference', width: 18 },
          { header: 'Désignation', key: 'article_label', width: 30 },
          { header: 'Commentaire', key: 'commentaire', width: 26 },
          { header: 'Créée le (ligne)', key: 'ligne_created_at', width: 14 },
          { header: 'Livraison demandée', key: 'date_livraison_demandee', width: 16 },
          { header: 'Livraison réelle', key: 'date_livraison', width: 14 },
          { header: 'Délai création→livraison (j)', key: 'delai_creation_livraison_jours', width: 18 },
          { header: 'Qté commandée', key: 'quantite_commandee', width: 13 },
          { header: 'Qté RAL', key: 'quantite_ral', width: 10 },
          { header: 'Qté livrée', key: 'quantite_livree', width: 10 },
          { header: 'Qté facturée', key: 'quantite_facturee', width: 11 },
          { header: 'PU', key: 'prix_unitaire', width: 11, style: { numFmt: '#,##0.00 €' } },
          { header: 'Total TTC', key: 'total_ttc', width: 13, style: { numFmt: '#,##0 €' } },
          { header: 'Statut livraison', key: 'tag_livraison_ligne', width: 15 },
          { header: 'Statut facturation', key: 'tag_facturation_ligne', width: 16 },
        ];
        styleHeaderRow(ws3.getRow(1));
        (detailData as CdfLigne[]).forEach((r) =>
          ws3.addRow({
            ...r,
            lien: r.cdf_lien_blg ? { text: 'Ouvrir ↗', hyperlink: r.cdf_lien_blg } : '',
            dans_bdcf_label: r.dans_bdcf ? '★' : '',
            ligne_created_at: fmtDate(r.ligne_created_at),
            date_livraison_demandee: fmtDate(r.date_livraison_demandee),
            date_livraison: fmtDate(r.date_livraison),
          })
        );
      }
      ws3.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + ws3.columns.length)}1` };
      ws3.views = [{ state: 'frozen', ySplit: 1 }];

      // ---- Onglet 4 : Fréquence commandes par fournisseur (histogramme en barres de données) ----
      // ExcelJS ne sait pas créer de graphique natif Excel ; la mise en
      // forme conditionnelle "data bar" donne un rendu histogramme
      // directement dans les cellules, lisible sans dépendance externe.
      const ws4 = wb.addWorksheet('Fréquence commandes');
      ws4.columns = [
        { header: 'Code', key: 'code', width: 12 },
        { header: 'Fournisseur', key: 'nom', width: 32 },
        { header: 'Nb commandes', key: 'nb_cdf', width: 16 },
      ];
      styleHeaderRow(ws4.getRow(1));
      const donneesFreqExport = (chartSupplierIds.length > 0
        ? syntheseFournisseurs.filter((f) => chartSupplierIds.includes(f.supplier_id))
        : syntheseFournisseurs
      ).slice().sort((a, b) => b.nb_commandes - a.nb_commandes);
      donneesFreqExport.forEach((f) => {
        ws4.addRow({ code: f.code_fournisseur, nom: f.nom_fournisseur, nb_cdf: f.nb_commandes });
      });
      if (donneesFreqExport.length > 0) {
        ws4.addConditionalFormatting({
          ref: `C2:C${donneesFreqExport.length + 1}`,
          rules: [
            {
              type: 'dataBar',
              cfvo: [
                { type: 'min' },
                { type: 'max' },
              ],
              color: { argb: 'FF7A5EA8' },
              priority: 1,
            } as any,
          ],
        });
      }
      ws4.autoFilter = { from: 'A1', to: 'C1' };
      ws4.views = [{ state: 'frozen', ySplit: 1 }];

      // ---- Onglet 5 : Fréquence par période (histogramme empilé -> table pivot + data bars) ----
      // ExcelJS ne sait pas produire de graphique empilé natif : cette
      // table pivot (période en ligne, fournisseur en colonne) porte les
      // mêmes données que l'histogramme du front (granularité jour/
      // semaine/mois choisie côté front), avec une barre de données sur
      // la colonne Total pour un repère visuel immédiat. Sélectionnez la
      // plage et Insertion > Graphique > Histogramme empilé dans Excel
      // pour recréer le visuel exact du front.
      const ws5 = wb.addWorksheet('Fréquence par période');
      const codesFreq = frequenceMensuelle.codes;
      const libellePeriode = frequenceGranularite === 'day' ? 'Jour' : frequenceGranularite === 'week' ? 'Semaine' : 'Mois';
      ws5.columns = [
        { header: libellePeriode, key: 'periode', width: 14 },
        ...codesFreq.map((code) => ({
          header: code === 'AUTRES' ? 'Autres' : code,
          key: `c_${code}`,
          width: 12,
        })),
        { header: 'Total', key: 'total', width: 10 },
      ];
      styleHeaderRow(ws5.getRow(1));
      codesFreq.forEach((code, i) => {
        const cell = ws5.getRow(1).getCell(2 + i);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (frequenceMensuelle.couleurParCode.get(code) ?? '#888888').replace('#', '') } };
      });
      frequenceMensuelle.periodes.forEach((p) => {
        const row: Record<string, any> = { periode: fmtPeriodeExport(p.periode, frequenceGranularite), total: p.totalNb };
        codesFreq.forEach((code) => {
          row[`c_${code}`] = p.segments.find((s) => s.code === code)?.nb ?? 0;
        });
        ws5.addRow(row);
      });
      if (frequenceMensuelle.periodes.length > 0) {
        const totalColLetter = String.fromCharCode(65 + codesFreq.length + 1);
        ws5.addConditionalFormatting({
          ref: `${totalColLetter}2:${totalColLetter}${frequenceMensuelle.periodes.length + 1}`,
          rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF7A5EA8' }, priority: 1 } as any],
        });
      }
      ws5.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];

      // ---- Onglet 6 : Incohérences livraison ----
      const { data: incoherencesData, error: incErr } = await supabase
        .from('v_appro_incoherences_livraison')
        .select('*')
        .order('order_date', { ascending: false })
        .range(0, EXPORT_MAX_ROWS - 1);
      if (!incErr && incoherencesData && incoherencesData.length > 0) {
        const ws6 = wb.addWorksheet('Incohérences livraison');
        ws6.columns = [
          { header: 'Référence CDF', key: 'reference', width: 16 },
          { header: 'Lien BLG', key: 'lien', width: 12 },
          { header: 'Fournisseur', key: 'fournisseur', width: 26 },
          { header: 'Date création', key: 'order_date', width: 14 },
          { header: 'Type incohérence', key: 'type_incoherence', width: 22 },
          { header: 'Statut entête (BLG)', key: 'statut_entete', width: 18 },
          { header: 'Statut calculé (lignes)', key: 'statut_calcule_lignes', width: 20 },
          { header: 'Badge "Livrée" (status_fk=14)', key: 'badge_workflow_livree', width: 22 },
          { header: 'Qté totale', key: 'total_qte', width: 11 },
          { header: 'Qté livrée', key: 'total_qte_livree', width: 11 },
          { header: 'Reste à livrer', key: 'total_ral', width: 12 },
          { header: 'Dernière livraison (ligne)', key: 'derniere_livraison_ligne', width: 18 },
          { header: 'Dernière MAJ entête', key: 'entete_last_update', width: 18 },
        ];
        styleHeaderRow(ws6.getRow(1));
        (incoherencesData as IncoherenceLivraison[]).forEach((r) =>
          ws6.addRow({
            ...r,
            lien: r.lien_blg ? { text: 'Ouvrir ↗', hyperlink: r.lien_blg } : '',
            order_date: fmtDate(r.order_date),
            type_incoherence: r.type_incoherence === 'entete_desynchronisee' ? 'Entête désynchronisée' : 'Badge "Livrée" incohérent',
            statut_entete: LABEL_STATUT_LIVRAISON[r.statut_entete] ?? r.statut_entete,
            statut_calcule_lignes: LABEL_STATUT_LIVRAISON[r.statut_calcule_lignes] ?? r.statut_calcule_lignes,
            badge_workflow_livree: r.badge_workflow_livree ? 'Oui' : 'Non',
            derniere_livraison_ligne: fmtDateHeure(r.derniere_livraison_ligne),
            entete_last_update: fmtDateHeure(r.entete_last_update),
          })
        );
        ws6.autoFilter = { from: 'A1', to: 'M1' };
        ws6.views = [{ state: 'frozen', ySplit: 1 }];
      }

      if ((detailData?.length ?? 0) >= EXPORT_MAX_ROWS) {
        const warn = wb.addWorksheet('⚠ Avertissement');
        warn.addRow([
          `Export limité aux ${EXPORT_MAX_ROWS} premières lignes (le résultat filtré en contient davantage). Affinez les filtres pour un export complet.`,
        ]);
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const horodatage = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `appro-achats-${horodatage}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'export Excel.");
    } finally {
      setExporting(false);
    }
  }, [vue, applyCommonFilters, syntheseFournisseurs, chartSupplierIds, frequenceMensuelle, frequenceGranularite]);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const totalPagesIncoherences = Math.max(1, Math.ceil(totalIncoherences / PAGE_SIZE));

  // ===============================================================
  // Rendu
  // ===============================================================
  return (
    <div style={{ background: COLORS.creme, minHeight: '100vh', width: '100%', fontFamily: '"IBM Plex Sans", sans-serif', color: COLORS.marine }}>
      <div style={{ width: '100%', margin: '0 auto', padding: '28px 32px 64px', boxSizing: 'border-box' }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 30, fontWeight: 600, margin: 0 }}>
            Appro &amp; Achats
          </h1>
          <p style={{ color: '#5B5646', marginTop: 6, fontSize: 14 }}>
            Commandes fournisseurs, réceptions et facturation — croisées sur toutes les dimensions.
          </p>
        </header>

        {/* ---------------- FILTRES (masqués sur l'onglet Incohérences, qui a son propre filtre) ---------------- */}
        {vue !== 'incoherences' && (
          <section
            style={{
              background: COLORS.blanc,
              border: `1px solid ${COLORS.ligne}`,
              borderRadius: 10,
              padding: 20,
              marginBottom: 24,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <Field label="Référence commande">
                <input
                  type="text"
                  value={cdfReference}
                  onChange={(e) => setCdfReference(e.target.value)}
                  placeholder="ex. CDF031930"
                  style={inputStyle}
                />
              </Field>

              <Field label="Fournisseur">
                <input
                  type="text"
                  value={fournisseurSearch}
                  onChange={(e) => setFournisseurSearch(e.target.value)}
                  placeholder="Rechercher un fournisseur…"
                  style={{ ...inputStyle, marginBottom: 6 }}
                />
                <select
                  multiple
                  size={5}
                  value={supplierIds.map(String)}
                  onChange={(e) => setSupplierIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                  style={selectStyle}
                >
                  {fournisseurOptionsFiltres.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} — {f.nom}
                    </option>
                  ))}
                </select>
                {supplierIds.length > 0 && <small style={{ color: '#8A8474' }}>{supplierIds.length} sélectionné(s)</small>}
              </Field>

              <Field label="Lieu de livraison">
                <input
                  type="text"
                  value={lieuSearch}
                  onChange={(e) => setLieuSearch(e.target.value)}
                  placeholder="Rechercher un lieu…"
                  style={{ ...inputStyle, marginBottom: 6 }}
                />
                <select
                  multiple
                  size={5}
                  value={lieuIds.map(String)}
                  onChange={(e) => setLieuIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                  style={selectStyle}
                >
                  {lieuOptionsFiltres.map((l) => (
                    <option key={l.delivery_fk} value={l.delivery_fk}>
                      {l.nom}
                    </option>
                  ))}
                </select>
                {lieuIds.length > 0 && <small style={{ color: '#8A8474' }}>{lieuIds.length} sélectionné(s)</small>}
              </Field>

              <Field label="Date de création (commande)">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="date" value={dateCreationFrom} onChange={(e) => setDateCreationFrom(e.target.value)} style={inputStyle} />
                  <input type="date" value={dateCreationTo} onChange={(e) => setDateCreationTo(e.target.value)} style={inputStyle} />
                </div>
              </Field>

              <Field label="Date de livraison (ligne)">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="date" value={dateLivraisonFrom} onChange={(e) => setDateLivraisonFrom(e.target.value)} style={inputStyle} />
                  <input type="date" value={dateLivraisonTo} onChange={(e) => setDateLivraisonTo(e.target.value)} style={inputStyle} />
                </div>
                <small style={{ color: '#8A8474' }}>Filtre appliqué uniquement en vue « Lignes ».</small>
              </Field>

              <Field label="Statut livraison">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {STATUTS_LIVRAISON.map((s) => (
                    <Chip
                      key={s.value}
                      active={statutsLivraison.includes(s.value)}
                      onClick={() => setStatutsLivraison((prev) => toggleInArray(prev, s.value))}
                    >
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Statut facturation">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {STATUTS_FACTURATION.map((s) => (
                    <Chip
                      key={s.value}
                      active={statutsFacturation.includes(s.value)}
                      onClick={() => setStatutsFacturation((prev) => toggleInArray(prev, s.value))}
                    >
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Article (référence)">
                <input
                  type="text"
                  value={articleReference}
                  onChange={(e) => setArticleReference(e.target.value)}
                  placeholder="ex. RAC-VJ60NHAE"
                  style={inputStyle}
                />
              </Field>

              <Field label="Retrouvée dans SAGE (BDCF)">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <Chip active={dansBdcf === 'all'} onClick={() => setDansBdcf('all')}>
                    Toutes
                  </Chip>
                  <Chip active={dansBdcf === 'yes'} onClick={() => setDansBdcf('yes')}>
                    ★ Avec étoile
                  </Chip>
                  <Chip active={dansBdcf === 'no'} onClick={() => setDansBdcf('no')}>
                    Sans étoile
                  </Chip>
                </div>
                <small style={{ color: '#8A8474' }}>★ = commande retrouvée dans SAGE (table BDCF).</small>
              </Field>
            </div>

            <div style={{ marginTop: 18, display: 'flex', gap: 12 }}>
              <button onClick={handleRechercherClick} disabled={loading} style={primaryButtonStyle}>
                {loading ? 'Recherche…' : 'Rechercher'}
              </button>
              <button
                onClick={() => {
                  setCdfReference('');
                  setDansBdcf('all');
                  setFournisseurSearch('');
                  setLieuSearch('');
                  setSupplierIds([]);
                  setLieuIds([]);
                  setDateCreationFrom(DATE_CREATION_MIN_DEFAUT);
                  setDateCreationTo('');
                  setDateLivraisonFrom('');
                  setDateLivraisonTo('');
                  setStatutsLivraison([]);
                  setStatutsFacturation([]);
                  setArticleReference('');
                  setPage(0);
                }}
                style={secondaryButtonStyle}
              >
                Réinitialiser
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={exporterExcel} disabled={exporting || loading} style={exportButtonStyle}>
                {exporting ? 'Export en cours…' : '↓ Exporter Excel'}
              </button>
            </div>
          </section>
        )}

        {error && (
          <div style={{ background: '#FBEAE2', border: `1px solid ${COLORS.alerte}`, color: '#8A3F1E', padding: 12, borderRadius: 8, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {vue !== 'incoherences' && (
          <>
            {/* ---------------- KPIs globaux ---------------- */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
              <Kpi label="Commandes" value={fmtNum(kpis?.nb_commandes)} />
              <Kpi label="Lignes" value={fmtNum(kpis?.nb_lignes)} />
              <Kpi label="Valeur achat HT" value={fmtEUR(kpis?.valeur_achat_ht)} accent={COLORS.violet} />
              <Kpi label="Valeur achat TTC" value={fmtEUR(kpis?.valeur_achat_ttc)} accent={COLORS.violet} />
              <Kpi label="Délai moyen création → BL" value={fmtJours(kpis?.delai_moyen_creation_bl_jours)} accent={COLORS.sauge} />
              <Kpi label="Délai moyen création → facture" value={fmtJours(kpis?.delai_moyen_creation_facture_jours)} accent={COLORS.sauge} />
            </section>

            {/* ---------------- KPIs répartition livraison / facturation ---------------- */}
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 12, color: '#8A8474', marginBottom: 6, fontWeight: 500 }}>Valeur HT — répartition livraison</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <Kpi label="Livrée" value={fmtEUR(kpis?.valeur_ht_livree)} accent="#3E7A4E" compact />
                  <Kpi label="Livrée partielle" value={fmtEUR(kpis?.valeur_ht_livree_partielle)} accent={COLORS.alerte} compact />
                  <Kpi label="Non livrée" value={fmtEUR(kpis?.valeur_ht_non_livree)} accent="#B0442E" compact />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#8A8474', marginBottom: 6, fontWeight: 500 }}>Valeur HT — répartition facturation</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <Kpi label="Facturée" value={fmtEUR(kpis?.valeur_ht_facturee)} accent="#3E7A4E" compact />
                  <Kpi label="Facturée partielle" value={fmtEUR(kpis?.valeur_ht_facturee_partielle)} accent={COLORS.alerte} compact />
                  <Kpi label="Non facturée" value={fmtEUR(kpis?.valeur_ht_non_facturee)} accent="#B0442E" compact />
                </div>
              </div>
            </section>

            {/* ---------------- FRÉQUENCE DES COMMANDES PAR FOURNISSEUR ---------------- */}
            <section
              style={{
                background: COLORS.blanc,
                border: `1px solid ${COLORS.ligne}`,
                borderRadius: 10,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 18, margin: 0 }}>
                    Fréquence des commandes par fournisseur
                  </h2>
                  <p style={{ fontSize: 12.5, color: '#8A8474', margin: '4px 0 0' }}>
                    Nombre de commandes passées, sur le périmètre des filtres ci-dessus.{' '}
                    {chartSupplierIds.length === 0 && 'Aucun fournisseur sélectionné → top 15 affiché.'}
                  </p>
                </div>
                <div style={{ minWidth: 260 }}>
                  <input
                    type="text"
                    value={chartSupplierSearch}
                    onChange={(e) => setChartSupplierSearch(e.target.value)}
                    placeholder="Filtrer les fournisseurs du graphe…"
                    style={{ ...inputStyle, marginBottom: 6 }}
                  />
                  <select
                    multiple
                    size={4}
                    value={chartSupplierIds.map(String)}
                    onChange={(e) => setChartSupplierIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                    style={selectStyle}
                  >
                    {chartSupplierOptionsFiltres.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} — {f.nom}
                      </option>
                    ))}
                  </select>
                  {chartSupplierIds.length > 0 && (
                    <button
                      onClick={() => setChartSupplierIds([])}
                      style={{ ...secondaryButtonStyle, marginTop: 6, padding: '4px 10px', fontSize: 12 }}
                    >
                      Effacer la sélection ({chartSupplierIds.length})
                    </button>
                  )}
                </div>
              </div>

              {donneesFrequence.length === 0 ? (
                <p style={{ color: '#8A8474', fontSize: 13 }}>Aucune donnée pour ces filtres.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {donneesFrequence.map((f) => (
                    <div key={f.supplier_id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 60px', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={`${f.code_fournisseur} — ${f.nom_fournisseur}`}
                      >
                        {f.nom_fournisseur}
                      </div>
                      <div style={{ background: COLORS.creme, borderRadius: 4, overflow: 'hidden', height: 18 }}>
                        <div
                          style={{
                            width: `${(f.nb_commandes / maxNbCommandesFrequence) * 100}%`,
                            background: COLORS.violet,
                            height: '100%',
                            borderRadius: 4,
                            minWidth: 2,
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{fmtNum(f.nb_commandes)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ---------------- HISTOGRAMME EMPILÉ : FRÉQUENCE MENSUELLE PAR FOURNISSEUR ---------------- */}
            <section
              style={{
                background: COLORS.blanc,
                border: `1px solid ${COLORS.ligne}`,
                borderRadius: 10,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 18, margin: '0 0 4px' }}>
                Fréquence des commandes par fournisseur
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 16px' }}>
                <p style={{ fontSize: 12.5, color: '#8A8474', margin: 0 }}>
                  Utilise le filtre fournisseur du graphe ci-dessus (recherche + sélection) pour choisir quels fournisseurs ont leur propre
                  couleur — les autres sont regroupés en « Autres ». Survolez une barre pour le détail.
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(
                    [
                      { value: 'day', label: 'Jour' },
                      { value: 'week', label: 'Semaine' },
                      { value: 'month', label: 'Mois' },
                    ] as { value: Granularite; label: string }[]
                  ).map((g) => (
                    <Chip key={g.value} active={frequenceGranularite === g.value} onClick={() => setFrequenceGranularite(g.value)}>
                      {g.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <StackedFrequencyChart data={frequenceMensuelle} granularite={frequenceGranularite} />
            </section>
          </>
        )}

        {/* ---------------- TOGGLE VUE ---------------- */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['entete', 'lignes', 'incoherences'] as Vue[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setVue(v);
                if (v === 'entete' || v === 'lignes') setPage(0);
              }}
              style={{
                ...secondaryButtonStyle,
                background: vue === v ? COLORS.marine : COLORS.blanc,
                color: vue === v ? COLORS.creme : COLORS.marine,
                borderColor: v === 'incoherences' && nbIncoherencesTotal > 0 && vue !== v ? COLORS.alerte : COLORS.ligne,
              }}
            >
              {v === 'entete' ? 'Vue Entête' : v === 'lignes' ? 'Vue Détail lignes' : `⚠ Incohérences${nbIncoherencesTotal > 0 ? ` (${nbIncoherencesTotal})` : ''}`}
            </button>
          ))}
        </div>

        {vue === 'lignes' && (
          <p style={{ fontSize: 12.5, color: '#8A8474', marginTop: -6, marginBottom: 10 }}>
            Aucune date d&apos;AR fournisseur n&apos;est disponible dans BLG (ni au niveau commande, ni au niveau ligne) — seule la date de
            livraison réelle est mirrorée.
          </p>
        )}

        {vue === 'incoherences' && (
          <p style={{ fontSize: 12.5, color: '#8A8474', marginTop: -6, marginBottom: 10 }}>
            Commandes d&apos;achat où le statut affiché côté BLG (entête et/ou badge de workflow « Livrée ») ne correspond pas au statut
            recalculé à partir des lignes réelles (hors lignes de commentaire). BLG ne recalcule pas toujours ces champs au dernier
            mouvement de stock — cette liste sert à repérer les commandes à vérifier/relancer côté BLG.
          </p>
        )}

        {/* ---------------- TABLEAU ---------------- */}
        {vue !== 'incoherences' ? (
          <section style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              {vue === 'entete' ? (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['Référence', 'Fournisseur', 'Créée le', 'Livraison (fenêtre)', 'Lieu de livraison', 'Livraison', 'Facturation', 'Montant HT', 'Montant TTC'].map(
                        (h) => (
                          <th key={h} style={thStyle}>
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsEntete.map((r) => (
                      <tr key={r.id} onClick={() => setDetailCdfId(r.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...tdStyle, color: COLORS.violet, fontWeight: 600 }}>
                          <LienBlg href={r.lien_blg}>{r.reference}</LienBlg>
                          {r.dans_bdcf && <BdcfStar />}
                        </td>
                        <td style={tdStyle}>{r.nom_fournisseur}</td>
                        <td style={tdStyle}>{fmtDate(r.order_date)}</td>
                        <td style={tdStyle}>
                          {r.date_livraison_min ? (
                            r.date_livraison_min === r.date_livraison_max ? (
                              fmtDate(r.date_livraison_min)
                            ) : (
                              <>
                                {fmtDate(r.date_livraison_min)} → {fmtDate(r.date_livraison_max)}
                              </>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={tdStyle}>{r.lieu_livraison_nom}</td>
                        <td style={tdStyle}>
                          <Tag label={r.tag_livraison} />
                        </td>
                        <td style={tdStyle}>
                          <Tag label={r.tag_facturation} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(r.montant_ht)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(r.montant_ttc)}</td>
                      </tr>
                    ))}
                    {!loading && rowsEntete.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: '#8A8474' }}>
                          Aucune commande ne correspond à ces filtres.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {[
                        'CDF',
                        'Article',
                        'Désignation',
                        'Créée le',
                        'Livr. demandée',
                        'Livr. réelle',
                        'Délai (j)',
                        'Qté cmdée',
                        'Qté RAL',
                        'Qté livrée',
                        'Qté facturée',
                        'PU',
                        'Total TTC',
                        'Livraison',
                        'Facturation',
                      ].map((h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsLignes.map((r) => (
                      <tr key={r.id} onClick={() => setDetailCdfId(r.cdf_id)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...tdStyle, color: COLORS.violet, fontWeight: 600 }}>
                          <LienBlg href={r.cdf_lien_blg}>{r.cdf_reference}</LienBlg>
                          {r.dans_bdcf && <BdcfStar />}
                        </td>
                        <td style={tdStyle}>{r.article_reference}</td>
                        <td style={tdStyle}>{r.article_label ?? r.commentaire}</td>
                        <td style={tdStyle}>{fmtDate(r.ligne_created_at)}</td>
                        <td style={tdStyle}>{fmtDate(r.date_livraison_demandee)}</td>
                        <td style={tdStyle}>{fmtDate(r.date_livraison)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.delai_creation_livraison_jours ?? '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.quantite_commandee)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.quantite_ral)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.quantite_livree)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.quantite_facturee)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(r.prix_unitaire)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(r.total_ttc)}</td>
                        <td style={tdStyle}>
                          <Tag label={r.tag_livraison_ligne} />
                        </td>
                        <td style={tdStyle}>
                          <Tag label={r.tag_facturation_ligne} />
                        </td>
                      </tr>
                    ))}
                    {!loading && rowsLignes.length === 0 && (
                      <tr>
                        <td colSpan={15} style={{ ...tdStyle, textAlign: 'center', color: '#8A8474' }}>
                          Aucune ligne ne correspond à ces filtres.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: `1px solid ${COLORS.ligne}` }}>
              <span style={{ fontSize: 13, color: '#5B5646' }}>
                {fmtNum(totalRows)} résultat{totalRows > 1 ? 's' : ''} — page {page + 1} / {totalPages}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={secondaryButtonStyle}>
                  ← Précédent
                </button>
                <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} style={secondaryButtonStyle}>
                  Suivant →
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* ---------------- FILTRE TYPE D'INCOHÉRENCE ---------------- */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <Chip
                active={filtreTypeIncoherence === 'all'}
                onClick={() => {
                  setFiltreTypeIncoherence('all');
                  setPageIncoherences(0);
                }}
              >
                Toutes
              </Chip>
              {TYPES_INCOHERENCE.map((t) => (
                <Chip
                  key={t.value}
                  active={filtreTypeIncoherence === t.value}
                  onClick={() => {
                    setFiltreTypeIncoherence(t.value);
                    setPageIncoherences(0);
                  }}
                >
                  {t.label}
                </Chip>
              ))}
            </div>

            {errorIncoherences && (
              <div style={{ background: '#FBEAE2', border: `1px solid ${COLORS.alerte}`, color: '#8A3F1E', padding: 12, borderRadius: 8, marginBottom: 20 }}>
                {errorIncoherences}
              </div>
            )}

            {/* ---------------- TABLEAU INCOHÉRENCES ---------------- */}
            <section style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {[
                        'Référence',
                        'Fournisseur',
                        'Créée le',
                        'Type',
                        'Statut entête (BLG)',
                        'Statut calculé (lignes)',
                        'Qté totale',
                        'Livrée',
                        'RAL',
                        'Dernière livraison ligne',
                        'Dernière MAJ entête',
                        'Écart (j)',
                      ].map((h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsIncoherences.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...tdStyle, color: COLORS.violet, fontWeight: 600 }}>
                          <LienBlg href={r.lien_blg}>{r.reference}</LienBlg>
                        </td>
                        <td style={tdStyle}>{r.fournisseur ?? '—'}</td>
                        <td style={tdStyle}>{fmtDate(r.order_date)}</td>
                        <td style={tdStyle}>
                          <IncoherenceBadge type={r.type_incoherence} />
                        </td>
                        <td style={tdStyle}>
                          <Tag label={LABEL_STATUT_LIVRAISON[r.statut_entete] ?? r.statut_entete} />
                        </td>
                        <td style={tdStyle}>
                          <Tag label={LABEL_STATUT_LIVRAISON[r.statut_calcule_lignes] ?? r.statut_calcule_lignes} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.total_qte)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.total_qte_livree)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: r.total_ral ? 600 : 400, color: r.total_ral ? COLORS.alerte : 'inherit' }}>
                          {fmtNum(r.total_ral)}
                        </td>
                        <td style={tdStyle}>{fmtDateHeure(r.derniere_livraison_ligne)}</td>
                        <td style={tdStyle}>{fmtDateHeure(r.entete_last_update)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {joursEcart(r.derniere_livraison_ligne, r.entete_last_update) ?? '—'}
                        </td>
                      </tr>
                    ))}
                    {!loadingIncoherences && rowsIncoherences.length === 0 && (
                      <tr>
                        <td colSpan={12} style={{ ...tdStyle, textAlign: 'center', color: '#8A8474' }}>
                          Aucune incohérence pour ce filtre.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* pagination */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: `1px solid ${COLORS.ligne}` }}>
                <span style={{ fontSize: 13, color: '#5B5646' }}>
                  {fmtNum(totalIncoherences)} résultat{totalIncoherences > 1 ? 's' : ''} — page {pageIncoherences + 1} / {totalPagesIncoherences}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={pageIncoherences === 0} onClick={() => setPageIncoherences((p) => Math.max(0, p - 1))} style={secondaryButtonStyle}>
                    ← Précédent
                  </button>
                  <button
                    disabled={pageIncoherences + 1 >= totalPagesIncoherences}
                    onClick={() => setPageIncoherences((p) => p + 1)}
                    style={secondaryButtonStyle}
                  >
                    Suivant →
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ---------------- SYNTHÈSE FOURNISSEURS ---------------- */}
        {vue !== 'incoherences' && syntheseFournisseurs.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 20, marginBottom: 12 }}>
              Synthèse par fournisseur ({syntheseFournisseurs.length})
            </h2>
            <div style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Fournisseur', 'Commandes', 'Lignes', 'Valeur HT', 'HT Livrée', 'HT Non livrée', 'HT Facturée', 'HT Non facturée', 'Délai → BL', 'Délai → facture'].map(
                      (h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {syntheseFournisseurs.slice(0, 25).map((f) => (
                    <tr key={f.supplier_id}>
                      <td style={tdStyle}>
                        {f.code_fournisseur} — {f.nom_fournisseur}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(f.nb_commandes)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(f.nb_lignes)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(f.valeur_achat_ht)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(f.valeur_ht_livree)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(f.valeur_ht_non_livree)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(f.valeur_ht_facturee)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(f.valeur_ht_non_facturee)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtJours(f.delai_moyen_creation_bl_jours)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtJours(f.delai_moyen_creation_facture_jours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {syntheseFournisseurs.length > 25 && (
                <div style={{ padding: 10, fontSize: 13, color: '#8A8474', textAlign: 'center' }}>
                  … {syntheseFournisseurs.length - 25} fournisseur(s) supplémentaire(s) — voir l&apos;export Excel pour la liste complète.
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {detailCdfId != null && <CdfDetailModal cdfId={detailCdfId} onClose={() => setDetailCdfId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fiche détail d'une commande (modal) : entête + lignes + BL + factures
// ---------------------------------------------------------------------
function CdfDetailModal({ cdfId, onClose }: { cdfId: number; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entete, setEntete] = useState<CdfEntete | null>(null);
  const [lignes, setLignes] = useState<CdfLigne[]>([]);
  const [bls, setBls] = useState<BlLigne[]>([]);
  const [factures, setFactures] = useState<FafLigne[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ data: e, error: eErr }, { data: l, error: lErr }, { data: b, error: bErr }, { data: f, error: fErr }] = await Promise.all([
          supabase.from('v_appro_cdf_entete').select('*').eq('id', cdfId).single(),
          supabase.from('v_appro_cdf_lignes').select('*').eq('cdf_id', cdfId).order('id'),
          supabase.from('v_appro_bl').select('*').eq('cdf_id', cdfId).order('date_reception'),
          supabase.from('v_appro_faf_lignes').select('*').eq('cdf_id', cdfId).order('faf_invoice_date'),
        ]);
        if (cancelled) return;
        if (eErr) throw eErr;
        if (lErr) throw lErr;
        if (bErr) throw bErr;
        if (fErr) throw fErr;
        setEntete(e as CdfEntete);
        setLignes(l ?? []);
        setBls(b ?? []);
        setFactures(f ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Erreur de chargement.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cdfId]);

  // regroupe les factures par n° de facture pour l'affichage
  const facturesGroupees = useMemo(() => {
    const map = new Map<string, FafLigne[]>();
    factures.forEach((f) => {
      if (!map.has(f.faf_reference)) map.set(f.faf_reference, []);
      map.get(f.faf_reference)!.push(f);
    });
    return [...map.entries()];
  }, [factures]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,18,32,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '5vh 24px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.creme,
          borderRadius: 12,
          width: '100%',
          maxWidth: 1300,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
            position: 'sticky',
            top: 0,
            background: COLORS.marine,
            color: COLORS.creme,
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: '12px 12px 0 0',
          }}
        >
          <div>
            <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 20, fontWeight: 600 }}>
              {entete ? <LienBlg href={entete.lien_blg}>{entete.reference}</LienBlg> : `Commande #${cdfId}`}
              {entete?.dans_bdcf && <BdcfStar />}
            </div>
            {entete && (
              <div style={{ fontSize: 13, opacity: 0.75 }}>
                {entete.nom_fournisseur} · créée le {fmtDate(entete.order_date)} · {entete.lieu_livraison_nom}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: COLORS.creme, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {loading && <p style={{ color: '#8A8474' }}>Chargement…</p>}
          {error && (
            <div style={{ background: '#FBEAE2', border: `1px solid ${COLORS.alerte}`, color: '#8A3F1E', padding: 12, borderRadius: 8, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {!loading && entete && (
            <>
              {/* KPIs entête */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
                <Kpi label="Montant HT" value={fmtEUR(entete.montant_ht)} />
                <Kpi label="Montant TTC" value={fmtEUR(entete.montant_ttc)} />
                <Kpi label="Livraison" value={entete.tag_livraison} accent={COLORS.sauge} />
                <Kpi label="Facturation" value={entete.tag_facturation} accent={COLORS.sauge} />
              </div>

              {/* Lignes de commande */}
              <h3 style={sectionTitleStyle}>Lignes de commande ({lignes.length})</h3>
              <p style={{ fontSize: 12, color: '#8A8474', marginTop: -4, marginBottom: 8 }}>
                Pas de date d&apos;AR fournisseur disponible côté BLG — seule la livraison réelle est tracée.
              </p>
              <div style={{ overflowX: 'auto', marginBottom: 28 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {[
                        'Article',
                        'Désignation',
                        'Commentaire',
                        'Créée le',
                        'Livr. demandée',
                        'Livr. réelle',
                        'Délai (j)',
                        'Qté cmdée',
                        'Qté RAL',
                        'Qté livrée',
                        'Qté facturée',
                        'PU',
                        'Total TTC',
                        'Livraison',
                        'Facturation',
                      ].map((h) => (
                        <th key={h} style={thStyleSm}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => (
                      <tr key={l.id}>
                        <td style={tdStyleSm}>{l.article_reference}</td>
                        <td style={tdStyleSm}>{l.article_label}</td>
                        <td style={tdStyleSm}>{l.commentaire}</td>
                        <td style={tdStyleSm}>{fmtDate(l.ligne_created_at)}</td>
                        <td style={tdStyleSm}>{fmtDate(l.date_livraison_demandee)}</td>
                        <td style={tdStyleSm}>{fmtDate(l.date_livraison)}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{l.delai_creation_livraison_jours ?? '—'}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite_commandee)}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite_ral)}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite_livree)}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(l.quantite_facturee)}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR(l.prix_unitaire)}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR(l.total_ttc)}</td>
                        <td style={tdStyleSm}>
                          <Tag label={l.tag_livraison_ligne} />
                        </td>
                        <td style={tdStyleSm}>
                          <Tag label={l.tag_facturation_ligne} />
                        </td>
                      </tr>
                    ))}
                    {lignes.length === 0 && (
                      <tr>
                        <td colSpan={15} style={{ ...tdStyleSm, textAlign: 'center', color: '#8A8474' }}>
                          Aucune ligne.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Bons de livraison */}
              <h3 style={sectionTitleStyle}>Bons de livraison ({new Set(bls.map((b) => b.bl_id)).size})</h3>
              <div style={{ overflowX: 'auto', marginBottom: 28 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['BL', 'Date réception', 'Article', 'Qté reçue'].map((h) => (
                        <th key={h} style={thStyleSm}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bls.map((b) => (
                      <tr key={b.bl_ligne_id ?? `${b.bl_id}-${b.article_reference}`}>
                        <td style={{ ...tdStyleSm, color: COLORS.violet, fontWeight: 600 }}>
                          <LienBlg href={b.lien_blg}>{b.bl_reference}</LienBlg>
                        </td>
                        <td style={tdStyleSm}>{fmtDate(b.date_reception)}</td>
                        <td style={tdStyleSm}>{b.article_reference}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(b.quantite_recue)}</td>
                      </tr>
                    ))}
                    {bls.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ ...tdStyleSm, textAlign: 'center', color: '#8A8474' }}>
                          Aucun bon de livraison.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Factures */}
              <h3 style={sectionTitleStyle}>Factures fournisseur ({facturesGroupees.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['Facture', 'Date', 'Article', 'Qté', 'Total TTC ligne', 'Total facture'].map((h) => (
                        <th key={h} style={thStyleSm}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {facturesGroupees.map(([ref, ligs]) =>
                      ligs.map((f, idx) => (
                        <tr key={f.faf_id + '-' + idx}>
                          <td style={{ ...tdStyleSm, color: COLORS.violet, fontWeight: 600 }}>
                            {idx === 0 ? <LienBlg href={f.lien_blg}>{ref}</LienBlg> : ''}
                          </td>
                          <td style={tdStyleSm}>{idx === 0 ? fmtDate(f.faf_invoice_date) : ''}</td>
                          <td style={tdStyleSm}>{f.article_reference}</td>
                          <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtNum(f.quantite)}</td>
                          <td style={{ ...tdStyleSm, textAlign: 'right' }}>{fmtEUR(f.total_ttc)}</td>
                          <td style={{ ...tdStyleSm, textAlign: 'right' }}>{idx === 0 ? fmtEUR(f.faf_montant_ttc) : ''}</td>
                        </tr>
                      ))
                    )}
                    {facturesGroupees.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ ...tdStyleSm, textAlign: 'center', color: '#8A8474' }}>
                          Aucune facture.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Histogramme empilé : nb de commandes par mois, une couleur par
// fournisseur (+ "Autres"), tooltip au survol (total + détail).
// Implémenté sans dépendance graphique externe (divs + flex).
// ---------------------------------------------------------------------
function StackedFrequencyChart({
  data,
  granularite,
}: {
  data: {
    periodes: { periode: string; totalNb: number; totalHt: number; segments: { code: string; nom: string; nb: number; valeurHt: number; couleur: string }[] }[];
    codes: string[];
    couleurParCode: Map<string, string>;
  };
  granularite: Granularite;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.periodes.length === 0) {
    return <p style={{ color: '#8A8474', fontSize: 13 }}>Aucune donnée pour ces filtres.</p>;
  }

  const maxTotal = Math.max(1, ...data.periodes.map((p) => p.totalNb));
  const CHART_HEIGHT = 220;

  const fmtPeriode = (p: string) => {
    const d = new Date(p + 'T00:00:00');
    if (granularite === 'day') return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    if (granularite === 'week') return `Sem. ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
    return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  };

  return (
    <div>
      {/* légende */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {data.codes.map((code) => (
          <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: data.couleurParCode.get(code), display: 'inline-block' }} />
            {code === 'AUTRES' ? 'Autres' : code}
          </div>
        ))}
      </div>

      {/* barres */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: CHART_HEIGHT, borderBottom: `1px solid ${COLORS.ligne}` }}>
          {data.periodes.map((p, idx) => (
            <div
              key={p.periode}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx((cur) => (cur === idx ? null : cur))}
              style={{
                flex: 1,
                minWidth: 4,
                height: Math.max(2, (p.totalNb / maxTotal) * CHART_HEIGHT),
                display: 'flex',
                flexDirection: 'column-reverse',
                cursor: 'pointer',
                outline: hoverIdx === idx ? `2px solid ${COLORS.marine}` : 'none',
                outlineOffset: 1,
              }}
            >
              {p.segments.map((s) => (
                <div
                  key={s.code}
                  style={{
                    height: `${(s.nb / (p.totalNb || 1)) * 100}%`,
                    background: s.couleur,
                    width: '100%',
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* axe temporel */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {data.periodes.map((p, idx) => {
            // Sur beaucoup de points (jour/semaine), n'affiche qu'un label sur N pour rester lisible.
            const step = data.periodes.length > 40 ? Math.ceil(data.periodes.length / 20) : 1;
            const visible = idx % step === 0;
            return (
              <div key={p.periode} style={{ flex: 1, minWidth: 4, fontSize: 10.5, color: '#8A8474', textAlign: 'center', whiteSpace: 'nowrap' }}>
                {visible ? fmtPeriode(p.periode) : ''}
              </div>
            );
          })}
        </div>

        {/* tooltip */}
        {hoverIdx != null && (
          <div
            style={{
              position: 'absolute',
              left: `${(hoverIdx / data.periodes.length) * 100}%`,
              bottom: CHART_HEIGHT + 14,
              transform: hoverIdx > data.periodes.length / 2 ? 'translateX(-100%)' : 'none',
              background: COLORS.marine,
              color: COLORS.creme,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12.5,
              minWidth: 220,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{fmtPeriode(data.periodes[hoverIdx].periode)}</div>
            <div style={{ opacity: 0.85, marginBottom: 6 }}>
              {fmtNum(data.periodes[hoverIdx].totalNb)} commande{data.periodes[hoverIdx].totalNb > 1 ? 's' : ''} ·{' '}
              {fmtEUR(data.periodes[hoverIdx].totalHt)} HT
            </div>
            {data.periodes[hoverIdx].segments.map((s) => (
              <div key={s.code} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.couleur, display: 'inline-block' }} />
                  {s.nom}
                </span>
                <span>
                  {fmtNum(s.nb)} · {fmtEUR(s.valeurHt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
    <div
      style={{
        background: COLORS.blanc,
        border: `1px solid ${COLORS.ligne}`,
        borderRadius: 10,
        padding: compact ? '10px 12px' : '14px 16px',
        borderLeft: `4px solid ${accent ?? COLORS.marine}`,
      }}
    >
      <div style={{ fontSize: compact ? 11 : 12, color: '#8A8474', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: compact ? 16 : 20, fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function BdcfStar() {
  return (
    <span title="Commande retrouvée dans SAGE (BDCF)" style={{ color: '#C9A227', marginLeft: 5, fontSize: '0.9em' }}>
      ★
    </span>
  );
}

// Badge coloré pour le type d'incohérence détecté (onglet Incohérences).
function IncoherenceBadge({ type }: { type: IncoherenceLivraison['type_incoherence'] }) {
  if (!type) return <>—</>;
  const label = type === 'entete_desynchronisee' ? 'Entête désynchronisée' : 'Badge "Livrée" incohérent';
  const color = type === 'entete_desynchronisee' ? COLORS.alerte : '#B0442E';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 12,
        color: '#fff',
        background: color,
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ {label}
    </span>
  );
}

// Lien direct vers le document BLG (construit à partir du document_id
// Mongo). Coupe la propagation du clic pour que cliquer la référence
// ouvre BLG dans un nouvel onglet sans déclencher l'ouverture de la
// fiche détail (qui écoute le clic sur la ligne entière).
function LienBlg({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'inherit', textDecoration: 'none' }}
      title="Ouvrir dans BLG"
    >
      {children} <span style={{ fontSize: '0.75em', opacity: 0.55 }}>↗</span>
    </a>
  );
}

function Tag({ label }: { label: string }) {
  const color =
    label === 'Livrée' || label === 'Facturée'
      ? '#3E7A4E'
      : label.includes('partiel')
      ? COLORS.alerte
      : label.includes('Non')
      ? '#B0442E'
      : '#5B5646';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 12,
        color: '#fff',
        background: color,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------
// Styles inline partagés
// ---------------------------------------------------------------------
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

const primaryButtonStyle: React.CSSProperties = {
  background: COLORS.marine,
  color: COLORS.creme,
  border: 'none',
  borderRadius: 8,
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
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
  padding: '10px 14px',
  background: COLORS.marine,
  color: COLORS.creme,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
};

const tdStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderBottom: `1px solid ${COLORS.ligne}`,
  whiteSpace: 'nowrap',
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
