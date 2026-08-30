'use client';

/**
 * Page "Appro / Achats"
 * ---------------------------------------------------------------------
 * Écran de pilotage des commandes fournisseurs (BLG), avec filtres
 * multi-dimension, KPIs agrégés côté serveur (RPC Postgres) et export
 * Excel multi-onglets (synthèse multi-fournisseurs / synthèse par
 * fournisseur / détail).
 *
 * Dépend des objets Supabase créés dans le projet gchwihltydsplarhveyv :
 *   - vues   : v_appro_cdf_entete, v_appro_cdf_lignes, v_appro_fournisseurs
 *   - RPC    : get_appro_filtres_disponibles
 *              get_appro_achats_kpis(...)
 *              get_appro_achats_synthese_fournisseurs(...)
 *
 * ADAPTER avant intégration :
 *   - le chemin d'import du client Supabase ci-dessous (`@/lib/supabase`)
 *     pour qu'il corresponde à l'emplacement réel dans a3c-app.
 *   - la route/emplacement du fichier (ex: app/appro/achats/page.tsx).
 *
 * Limite connue : la notion d'"AR fournisseur" vue dans l'historique BLG
 * n'est pas un champ mirroré (c'est un événement d'historique BLG, pas
 * une colonne). Le délai "création -> AR" demandé est donc approximé
 * par "création -> 1ère réception (BL)", qui est le proxy disponible le
 * plus proche aujourd'hui.
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
  delai_moyen_creation_bl_jours: number | null;
  delai_moyen_creation_facture_jours: number | null;
};

type CdfEntete = {
  id: number;
  reference: string;
  order_date: string | null;
  code_fournisseur: string | null;
  nom_fournisseur: string | null;
  lieu_livraison_nom: string | null;
  lieu_livraison_ville: string | null;
  tag_livraison: string;
  tag_facturation: string;
  montant_ht: number;
  montant_ttc: number;
};

type CdfLigne = {
  id: number;
  cdf_id: number;
  cdf_reference: string;
  article_reference: string | null;
  article_label: string | null;
  commentaire: string | null;
  quantite: number | null;
  prix_unitaire: number | null;
  total_ttc: number | null;
  date_livraison_demandee: string | null;
  date_livraison_reelle: string | null;
  tag_livraison_ligne: string;
  tag_facturation_ligne: string;
};

type Vue = 'entete' | 'lignes';

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

const PAGE_SIZE = 50;
const EXPORT_MAX_ROWS = 8000; // garde-fou pour ne pas geler le navigateur

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

// ---------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------
export default function ApproAchatsPage() {
  // --- filtres ---
  const [fournisseurOptions, setFournisseurOptions] = useState<FournisseurOption[]>([]);
  const [lieuOptions, setLieuOptions] = useState<LieuOption[]>([]);
  const [supplierIds, setSupplierIds] = useState<number[]>([]);
  const [lieuIds, setLieuIds] = useState<number[]>([]);
  const [dateCreationFrom, setDateCreationFrom] = useState('');
  const [dateCreationTo, setDateCreationTo] = useState('');
  const [dateLivraisonFrom, setDateLivraisonFrom] = useState('');
  const [dateLivraisonTo, setDateLivraisonTo] = useState('');
  const [statutsLivraison, setStatutsLivraison] = useState<string[]>([]);
  const [statutsFacturation, setStatutsFacturation] = useState<string[]>([]);
  const [articleReference, setArticleReference] = useState('');

  // --- vue / résultats ---
  const [vue, setVue] = useState<Vue>('entete');
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [syntheseFournisseurs, setSyntheseFournisseurs] = useState<SyntheseFournisseur[]>([]);
  const [rowsEntete, setRowsEntete] = useState<CdfEntete[]>([]);
  const [rowsLignes, setRowsLignes] = useState<CdfLigne[]>([]);
  const [page, setPage] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // -------------------------------------------------------------
  // Construction des paramètres de filtre (partagés KPI / synthèse / listing)
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
    ]
  );

  // -------------------------------------------------------------
  // Applique un filtre commun (fournisseurs / dates / statuts / lieu /
  // article) sur une query supabase-js pointant vers une des vues.
  // -------------------------------------------------------------
  const applyCommonFilters = useCallback(
    (query: any, kind: 'entete' | 'lignes') => {
      let q = query;
      if (supplierIds.length) q = q.in('supplier_fk', supplierIds);
      if (lieuIds.length) q = q.in('delivery_fk', lieuIds);
      if (dateCreationFrom) q = q.gte('order_date', dateCreationFrom);
      if (dateCreationTo) q = q.lte('order_date', dateCreationTo);
      if (statutsLivraison.length) {
        q = q.in(kind === 'entete' ? 'delivery_status' : 'tag_livraison_ligne', statutsLivraison);
      }
      if (statutsFacturation.length) {
        q = q.in(kind === 'entete' ? 'invoice_status' : 'tag_facturation_ligne', statutsFacturation);
      }
      if (kind === 'lignes') {
        if (dateLivraisonFrom) q = q.gte('date_livraison_demandee', dateLivraisonFrom);
        if (dateLivraisonTo) q = q.lte('date_livraison_demandee', dateLivraisonTo);
        if (articleReference.trim()) q = q.ilike('article_reference', `%${articleReference.trim()}%`);
      }
      return q;
    },
    [supplierIds, lieuIds, dateCreationFrom, dateCreationTo, statutsLivraison, statutsFacturation, dateLivraisonFrom, dateLivraisonTo, articleReference]
  );

  // -------------------------------------------------------------
  // Lance la recherche : KPIs + synthèse fournisseurs + page courante
  // -------------------------------------------------------------
  const lancerRecherche = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: kpiData, error: kpiErr }, { data: syntheseData, error: syntheseErr }] = await Promise.all([
        supabase.rpc('get_appro_achats_kpis', rpcParams),
        supabase.rpc('get_appro_achats_synthese_fournisseurs', {
          p_supplier_ids: rpcParams.p_supplier_ids,
          p_created_from: rpcParams.p_created_from,
          p_created_to: rpcParams.p_created_to,
          p_delivery_status: rpcParams.p_delivery_status,
          p_invoice_status: rpcParams.p_invoice_status,
          p_delivery_fk_ids: rpcParams.p_delivery_fk_ids,
          p_article_reference: rpcParams.p_article_reference,
        }),
      ]);
      if (kpiErr) throw kpiErr;
      if (syntheseErr) throw syntheseErr;
      setKpis(Array.isArray(kpiData) ? kpiData[0] : kpiData);
      setSyntheseFournisseurs(syntheseData ?? []);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      if (vue === 'entete') {
        let q = supabase.from('v_appro_cdf_entete').select('*', { count: 'exact' });
        q = applyCommonFilters(q, 'entete');
        const { data, error: err, count } = await q.order('order_date', { ascending: false }).range(from, to);
        if (err) throw err;
        setRowsEntete(data ?? []);
        setTotalRows(count ?? 0);
      } else {
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
  }, [rpcParams, applyCommonFilters, vue, page]);

  useEffect(() => {
    lancerRecherche();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue, page]);

  const handleRechercherClick = () => {
    setPage(0);
    lancerRecherche();
  };

  const toggleInArray = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  // -------------------------------------------------------------
  // Export Excel : synthèse multi-fournisseurs / synthèse par
  // fournisseur (groupée) / détail
  // -------------------------------------------------------------
  const exporterExcel = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      // Détail complet (bridé à EXPORT_MAX_ROWS pour rester réactif)
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
        { header: 'Fournisseur', key: 'nom', width: 32 },
        { header: 'Nb commandes', key: 'nb_cdf', width: 14 },
        { header: 'Nb lignes', key: 'nb_lignes', width: 12 },
        { header: 'Valeur achat HT', key: 'ht', width: 16, style: { numFmt: '#,##0 €' } },
        { header: 'Valeur achat TTC', key: 'ttc', width: 16, style: { numFmt: '#,##0 €' } },
        { header: 'Délai moyen création → BL (j)', key: 'delai_bl', width: 20 },
        { header: 'Délai moyen création → facture (j)', key: 'delai_fact', width: 22 },
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
          delai_bl: f.delai_moyen_creation_bl_jours,
          delai_fact: f.delai_moyen_creation_facture_jours,
        });
      });
      const totalRow1 = ws1.addRow({
        nom: 'TOTAL',
        nb_cdf: syntheseFournisseurs.reduce((s, f) => s + f.nb_commandes, 0),
        nb_lignes: syntheseFournisseurs.reduce((s, f) => s + f.nb_lignes, 0),
        ht: syntheseFournisseurs.reduce((s, f) => s + f.valeur_achat_ht, 0),
        ttc: syntheseFournisseurs.reduce((s, f) => s + f.valeur_achat_ttc, 0),
      });
      totalRow1.font = { bold: true };
      totalRow1.eachCell((c) => (c.fill = SUBTOTAL_FILL));
      ws1.autoFilter = { from: 'A1', to: 'H1' };
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
            const titre = ws2.addRow({ ref: nomFournisseur });
            titre.font = { bold: true, color: { argb: 'FF7A5EA8' } };
            titre.getCell('ref').value = nomFournisseur.toUpperCase();
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
        ws2.getRow(1).getCell(1).value = 'Référence CDF';
        ws2.addRow({ ref: 'Vue « lignes » active : basculez sur « Entête » avant export pour la synthèse groupée par fournisseur.' });
      }

      // ---- Onglet 3 : Détail ----
      const ws3 = wb.addWorksheet('Détail');
      if (vue === 'entete') {
        ws3.columns = [
          { header: 'Référence CDF', key: 'reference', width: 16 },
          { header: 'Fournisseur', key: 'nom_fournisseur', width: 28 },
          { header: 'Date création', key: 'order_date', width: 14 },
          { header: 'Lieu de livraison', key: 'lieu_livraison_nom', width: 22 },
          { header: 'Ville livraison', key: 'lieu_livraison_ville', width: 20 },
          { header: 'Statut livraison', key: 'tag_livraison', width: 16 },
          { header: 'Statut facturation', key: 'tag_facturation', width: 18 },
          { header: 'Montant HT', key: 'montant_ht', width: 14, style: { numFmt: '#,##0 €' } },
          { header: 'Montant TTC', key: 'montant_ttc', width: 14, style: { numFmt: '#,##0 €' } },
        ];
        styleHeaderRow(ws3.getRow(1));
        (detailData as CdfEntete[]).forEach((r) =>
          ws3.addRow({ ...r, order_date: fmtDate(r.order_date) })
        );
      } else {
        ws3.columns = [
          { header: 'Référence CDF', key: 'cdf_reference', width: 16 },
          { header: 'Article', key: 'article_reference', width: 18 },
          { header: 'Désignation', key: 'article_label', width: 32 },
          { header: 'Commentaire', key: 'commentaire', width: 28 },
          { header: 'Quantité', key: 'quantite', width: 10 },
          { header: 'PU', key: 'prix_unitaire', width: 12, style: { numFmt: '#,##0.00 €' } },
          { header: 'Total TTC', key: 'total_ttc', width: 14, style: { numFmt: '#,##0 €' } },
          { header: 'Livraison demandée', key: 'date_livraison_demandee', width: 16 },
          { header: 'Livraison réelle', key: 'date_livraison_reelle', width: 16 },
          { header: 'Statut livraison', key: 'tag_livraison_ligne', width: 16 },
          { header: 'Statut facturation', key: 'tag_facturation_ligne', width: 18 },
        ];
        styleHeaderRow(ws3.getRow(1));
        (detailData as CdfLigne[]).forEach((r) =>
          ws3.addRow({
            ...r,
            date_livraison_demandee: fmtDate(r.date_livraison_demandee),
            date_livraison_reelle: fmtDate(r.date_livraison_reelle),
          })
        );
      }
      ws3.autoFilter = {
        from: 'A1',
        to: `${String.fromCharCode(64 + ws3.columns.length)}1`,
      };
      ws3.views = [{ state: 'frozen', ySplit: 1 }];

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
  }, [vue, applyCommonFilters, syntheseFournisseurs]);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  // ===============================================================
  // Rendu
  // ===============================================================
  return (
    <div style={{ background: COLORS.creme, minHeight: '100vh', fontFamily: '"IBM Plex Sans", sans-serif', color: COLORS.marine }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px 64px' }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 30, fontWeight: 600, margin: 0 }}>
            Appro &amp; Achats
          </h1>
          <p style={{ color: '#5B5646', marginTop: 6, fontSize: 14 }}>
            Commandes fournisseurs, réceptions et facturation — croisées sur toutes les dimensions.
          </p>
        </header>

        {/* ---------------- FILTRES ---------------- */}
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
            <Field label="Fournisseur">
              <select
                multiple
                size={5}
                value={supplierIds.map(String)}
                onChange={(e) => setSupplierIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                style={selectStyle}
              >
                {fournisseurOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.nom}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Lieu de livraison">
              <select
                multiple
                size={5}
                value={lieuIds.map(String)}
                onChange={(e) => setLieuIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
                style={selectStyle}
              >
                {lieuOptions.map((l) => (
                  <option key={l.delivery_fk} value={l.delivery_fk}>
                    {l.nom}
                  </option>
                ))}
              </select>
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
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 12 }}>
            <button onClick={handleRechercherClick} disabled={loading} style={primaryButtonStyle}>
              {loading ? 'Recherche…' : 'Rechercher'}
            </button>
            <button
              onClick={() => {
                setSupplierIds([]);
                setLieuIds([]);
                setDateCreationFrom('');
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

        {error && (
          <div style={{ background: '#FBEAE2', border: `1px solid ${COLORS.alerte}`, color: '#8A3F1E', padding: 12, borderRadius: 8, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {/* ---------------- KPIs ---------------- */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
          <Kpi label="Commandes" value={fmtNum(kpis?.nb_commandes)} />
          <Kpi label="Lignes" value={fmtNum(kpis?.nb_lignes)} />
          <Kpi label="Valeur achat HT" value={fmtEUR(kpis?.valeur_achat_ht)} accent={COLORS.violet} />
          <Kpi label="Valeur achat TTC" value={fmtEUR(kpis?.valeur_achat_ttc)} accent={COLORS.violet} />
          <Kpi label="Délai moyen création → BL" value={fmtJours(kpis?.delai_moyen_creation_bl_jours)} accent={COLORS.sauge} />
          <Kpi label="Délai moyen création → facture" value={fmtJours(kpis?.delai_moyen_creation_facture_jours)} accent={COLORS.sauge} />
        </section>

        {/* ---------------- TOGGLE VUE ---------------- */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['entete', 'lignes'] as Vue[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setVue(v);
                setPage(0);
              }}
              style={{
                ...secondaryButtonStyle,
                background: vue === v ? COLORS.marine : COLORS.blanc,
                color: vue === v ? COLORS.creme : COLORS.marine,
              }}
            >
              {v === 'entete' ? 'Vue Entête' : 'Vue Détail lignes'}
            </button>
          ))}
        </div>

        {/* ---------------- TABLEAU ---------------- */}
        <section style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            {vue === 'entete' ? (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Référence', 'Fournisseur', 'Créée le', 'Lieu de livraison', 'Livraison', 'Facturation', 'Montant HT', 'Montant TTC'].map(
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
                    <tr key={r.id}>
                      <td style={tdStyle}>{r.reference}</td>
                      <td style={tdStyle}>{r.nom_fournisseur}</td>
                      <td style={tdStyle}>{fmtDate(r.order_date)}</td>
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
                      <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#8A8474' }}>
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
                    {['CDF', 'Article', 'Désignation', 'Commentaire', 'Qté', 'PU', 'Total TTC', 'Livr. demandée', 'Livr. réelle', 'Livraison', 'Facturation'].map(
                      (h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rowsLignes.map((r) => (
                    <tr key={r.id}>
                      <td style={tdStyle}>{r.cdf_reference}</td>
                      <td style={tdStyle}>{r.article_reference}</td>
                      <td style={tdStyle}>{r.article_label ?? r.commentaire}</td>
                      <td style={tdStyle}>{r.commentaire}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtNum(r.quantite)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(r.prix_unitaire)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(r.total_ttc)}</td>
                      <td style={tdStyle}>{fmtDate(r.date_livraison_demandee)}</td>
                      <td style={tdStyle}>{fmtDate(r.date_livraison_reelle)}</td>
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
                      <td colSpan={11} style={{ ...tdStyle, textAlign: 'center', color: '#8A8474' }}>
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

        {/* ---------------- SYNTHÈSE FOURNISSEURS ---------------- */}
        {syntheseFournisseurs.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 20, marginBottom: 12 }}>
              Synthèse par fournisseur ({syntheseFournisseurs.length})
            </h2>
            <div style={{ background: COLORS.blanc, border: `1px solid ${COLORS.ligne}`, borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Fournisseur', 'Commandes', 'Lignes', 'Valeur HT', 'Valeur TTC', 'Délai → BL', 'Délai → facture'].map((h) => (
                      <th key={h} style={thStyle}>
                        {h}
                      </th>
                    ))}
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
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtEUR(f.valeur_achat_ttc)}</td>
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

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: COLORS.blanc,
        border: `1px solid ${COLORS.ligne}`,
        borderRadius: 10,
        padding: '14px 16px',
        borderLeft: `4px solid ${accent ?? COLORS.marine}`,
      }}
    >
      <div style={{ fontSize: 12, color: '#8A8474', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: '"Space Grotesk", sans-serif', fontWeight: 600 }}>{value}</div>
    </div>
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
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${COLORS.ligne}`,
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
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
