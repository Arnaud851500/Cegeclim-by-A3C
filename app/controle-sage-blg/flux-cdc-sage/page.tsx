'use client';

/**
 * Page « Flux des CDC SAGE » — suppressions et modifications des commandes clients (09/11/2026)
 * -------------------------------------------------------------------------------------------
 * Objectif (Arnaud) : dater les suppressions de CDC dans SAGE — quantité diminuée, ligne supprimée,
 * reliquat soldé, commande entière supprimée — et les modifications (ajout, hausse de quantité, date
 * de livraison), pour repérer celles qui n'ont pas été répercutées dans BLG.
 *
 * Source : à chaque publication d'un lot d'import SAGE (sage.publier_lot_en_attente, ~toutes les 2 h),
 * public.cdc_flux_capturer compare l'état précédent du portefeuille « activité non facturée » au nouvel
 * état, par CDC et article. Une baisse est d'abord expliquée par les PL / BL / factures qui référencent
 * la CDC ; seul le reste est une suppression. La suppression a donc eu lieu dans SAGE entre
 * « periode_debut » (publication précédente) et « detecte_at ».
 *
 * Historique : reconstitué le 09/11/2026 à partir des fichiers d'import archivés (bucket sage-imports/archive,
 * depuis le 20/08/2026 — migrations 20261109c / 20261109d, événements source = 'historique').
 *
 * Objets Supabase (migration 20261109b_cdc_flux_tracabilite.sql) :
 *   - table cdc_flux_evenements (journal), cdc_flux_types (catalogue)
 *   - get_cdc_flux_v2(p_depuis, p_jusqu, p_flux_normaux) → { types, lots, premier_suivi, nb_flux_normaux, evenements[] }
 *     (flux normaux exclus sauf demande) avec statut BLG calculé à la
 *     lecture : quantité commandée BLG comparée à la quantité encore justifiée dans SAGE (reste en CDC +
 *     PL/BL non facturés + facturé). BLG est relu à la synchro de nuit.
 *   - cdc_flux_set_suivi(ids[], statut, commentaire) : a_traiter / corrige_blg / sans_objet
 *
 * Route : app/controle-sage-blg/flux-cdc-sage/page.tsx → /controle-sage-blg/flux-cdc-sage (bloc « Projet BLG »)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import ExcelJS from 'exceljs';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// ---------------------------------------------------------------------
// Design tokens (CEGECLIM by A3C)
// ---------------------------------------------------------------------
const C = {
  marine: '#0B1220',
  creme: '#F5F3EC',
  sauge: '#A6A181',
  alerte: '#C1683C',
  violet: '#7A5EA8',
  ligne: '#E4E0D4',
  blanc: '#FFFFFF',
  vert: '#3E7A4E',
  rouge: '#B0442E',
  bleu: '#2F6690',
  gris: '#8A8474',
  texte2: '#5B5646',
  jaune: '#B58A2A',
};

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type StatutBlg = 'A_CORRIGER_BLG' | 'ALIGNE_BLG' | 'ABSENTE_BLG' | 'ARCHIVEE_BLG' | 'SANS_OBJET';
type Suivi = 'a_traiter' | 'corrige_blg' | 'sans_objet';

type TypeFlux = {
  code: string;
  niveau: 'COMMANDE' | 'LIGNE';
  libelle: string;
  description: string | null;
  flux_normal: boolean;
  sens: 'baisse' | 'hausse' | 'date' | 'neutre';
  ordre: number;
};

type Evenement = {
  id: number;
  lot_id: number;
  detecte_at: string;
  periode_debut: string | null;
  niveau: 'COMMANDE' | 'LIGNE';
  type: string;
  type_origine: string;
  cdc: string;
  numero_tiers: string | null;
  intitule_tiers: string | null;
  representant: string | null;
  date_piece: string | null;
  article: string | null;
  designation: string | null;
  qte_avant: number | null;
  qte_apres: number | null;
  qte_transformee: number | null;
  qte_facturee_periode: number | null;
  qte_non_expliquee: number | null;
  montant_ht_avant: number | null;
  montant_ht_apres: number | null;
  montant_non_explique: number | null;
  nb_lignes_avant: number | null;
  nb_lignes_apres: number | null;
  date_livraison_avant: string | null;
  date_livraison_apres: string | null;
  pieces_aval: string | null;
  pieces_facture: string | null;
  sage_qte_justifiee: number | null;
  sage_date_livraison: string | null;
  blg_lien: string | null;
  blg_qte: number | null;
  blg_qte_a_livrer: number | null;
  blg_date_livraison: string | null;
  blg_synced_at: string | null;
  statut_blg: StatutBlg;
  ecart_blg_qte: number | null;
  statut_suivi: Suivi;
  commentaire: string | null;
  traite_par: string | null;
  traite_at: string | null;
};

type Lot = { lot_id: number; publie_at: string; nb: number };

type Reponse = {
  depuis: string;
  jusqu: string;
  genere_at: string;
  types: TypeFlux[];
  lots: Lot[];
  premier_suivi: string | null;
  nb_flux_normaux: number;
  evenements: Evenement[];
};

// ---------------------------------------------------------------------
// Libellés et couleurs
// ---------------------------------------------------------------------
const STATUT_BLG: Record<StatutBlg, { libelle: string; couleur: string; fond: string; aide: string }> = {
  A_CORRIGER_BLG: { libelle: 'À corriger dans BLG', couleur: C.rouge, fond: 'rgba(176,68,46,0.10)', aide: 'BLG porte encore la quantité / date d’avant la modification SAGE.' },
  ALIGNE_BLG: { libelle: 'Aligné BLG', couleur: C.vert, fond: 'rgba(62,122,78,0.10)', aide: 'BLG reflète déjà la modification (à la dernière synchro de nuit).' },
  ABSENTE_BLG: { libelle: 'Absente de BLG', couleur: C.jaune, fond: 'rgba(181,138,42,0.12)', aide: 'Aucune commande BLG avec ce numéro.' },
  ARCHIVEE_BLG: { libelle: 'Archivée BLG', couleur: C.gris, fond: 'rgba(138,132,116,0.12)', aide: 'La commande est archivée dans BLG.' },
  SANS_OBJET: { libelle: 'Flux normal', couleur: C.gris, fond: 'rgba(138,132,116,0.10)', aide: 'Transformation PL / BL / facture : rien à corriger.' },
};

const SUIVI: Record<Suivi, { libelle: string; couleur: string }> = {
  a_traiter: { libelle: 'À traiter', couleur: C.alerte },
  corrige_blg: { libelle: 'Corrigé dans BLG', couleur: C.vert },
  sans_objet: { libelle: 'Sans objet', couleur: C.gris },
};

const COULEUR_TYPE: Record<string, string> = {
  COMMANDE_SUPPRIMEE: '#8E2C1C',
  SUPPRESSION_LIGNE: C.rouge,
  SOLDE_RELIQUAT: C.alerte,
  DIMINUTION_QTE: C.jaune,
  AUGMENTATION_QTE: C.bleu,
  AJOUT_LIGNE: C.violet,
  DATE_LIVRAISON_MODIFIEE: '#4F7C8A',
  TRANSFORMATION: C.sauge,
  RETOUR_EN_COMMANDE: C.gris,
};

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
function isoJour(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

function decalerJours(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoJour(d);
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDateHeure(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtHeure(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtQte(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? n.toLocaleString('fr-FR') : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function fmtEur(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fenetre(e: Evenement) {
  if (!e.periode_debut) return `détecté le ${fmtDateHeure(e.detecte_at)}`;
  const memeJour = new Date(e.periode_debut).toDateString() === new Date(e.detecte_at).toDateString();
  return memeJour
    ? `le ${fmtDate(e.detecte_at)} entre ${fmtHeure(e.periode_debut)} et ${fmtHeure(e.detecte_at)}`
    : `entre le ${fmtDateHeure(e.periode_debut)} et le ${fmtDateHeure(e.detecte_at)}`;
}

/** Ce qui a changé, en clair. */
function resume(e: Evenement) {
  switch (e.type) {
    case 'COMMANDE_SUPPRIMEE':
      return `${fmtQte(e.nb_lignes_avant)} ligne(s), ${fmtQte(e.qte_avant)} pièce(s) supprimées`;
    case 'SUPPRESSION_LIGNE':
      return `${fmtQte(e.qte_avant)} → 0`;
    case 'SOLDE_RELIQUAT':
      return `${fmtQte(e.qte_avant)} → 0 dont ${fmtQte(e.qte_transformee)} livré(s), ${fmtQte(e.qte_non_expliquee)} soldé(s)`;
    case 'DIMINUTION_QTE':
      return `${fmtQte(e.qte_avant)} → ${fmtQte(e.qte_apres)}${Number(e.qte_transformee) > 0 ? ` (dont ${fmtQte(e.qte_transformee)} livré)` : ''}`;
    case 'AUGMENTATION_QTE':
    case 'AJOUT_LIGNE':
      return `${fmtQte(e.qte_avant)} → ${fmtQte(e.qte_apres)}`;
    case 'DATE_LIVRAISON_MODIFIEE':
      return `${fmtDate(e.date_livraison_avant)} → ${fmtDate(e.date_livraison_apres)}`;
    case 'TRANSFORMATION':
      return `${fmtQte(e.qte_avant)} → ${fmtQte(e.qte_apres)}${e.pieces_aval ? ` · ${e.pieces_aval}` : e.pieces_facture ? ` · facturé ${e.pieces_facture}` : ''}`;
    case 'RETOUR_EN_COMMANDE':
      return `${fmtQte(e.qte_avant)} → ${fmtQte(e.qte_apres)}`;
    default:
      return '';
  }
}

/** Correction attendue dans BLG, en clair. */
function actionBlg(e: Evenement) {
  if (e.statut_blg !== 'A_CORRIGER_BLG') return '';
  if (e.type === 'DATE_LIVRAISON_MODIFIEE') return `Mettre la date au ${fmtDate(e.sage_date_livraison)} (BLG : ${fmtDate(e.blg_date_livraison)})`;
  if (e.type === 'COMMANDE_SUPPRIMEE') return 'Archiver / supprimer la commande dans BLG';
  const ecart = Number(e.ecart_blg_qte || 0);
  if (ecart > 0) return `Retirer ${fmtQte(ecart)} dans BLG (BLG ${fmtQte(e.blg_qte)} / SAGE ${fmtQte(e.sage_qte_justifiee)})`;
  if (ecart < 0) return `Ajouter ${fmtQte(-ecart)} dans BLG (BLG ${fmtQte(e.blg_qte)} / SAGE ${fmtQte(e.sage_qte_justifiee)})`;
  return '';
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
type Periode = 'jour' | '7j' | '30j' | '90j' | 'perso';
type Vue = 'commande' | 'evenement';

export default function FluxCdcSagePage() {
  const [periode, setPeriode] = useState<Periode>('7j');
  const [depuis, setDepuis] = useState(decalerJours(-7));
  const [jusqu, setJusqu] = useState(isoJour(new Date()));

  const [data, setData] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');

  const [vue, setVue] = useState<Vue>('commande');
  const [typesActifs, setTypesActifs] = useState<string[]>([]);
  const [fluxNormaux, setFluxNormaux] = useState(false);
  const [filtreBlg, setFiltreBlg] = useState<StatutBlg | 'TOUS'>('A_CORRIGER_BLG');
  const [filtreSuivi, setFiltreSuivi] = useState<Suivi | 'TOUS'>('a_traiter');
  const [filtreRep, setFiltreRep] = useState('');
  const [recherche, setRecherche] = useState('');

  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [commentaire, setCommentaire] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const [detail, setDetail] = useState<Evenement | null>(null);

  // Période rapide
  useEffect(() => {
    if (periode === 'jour') { setDepuis(isoJour(new Date())); setJusqu(isoJour(new Date())); }
    if (periode === '7j') { setDepuis(decalerJours(-7)); setJusqu(isoJour(new Date())); }
    if (periode === '30j') { setDepuis(decalerJours(-30)); setJusqu(isoJour(new Date())); }
    if (periode === '90j') { setDepuis(decalerJours(-90)); setJusqu(isoJour(new Date())); }
  }, [periode]);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    // les flux normaux (transformations PL / BL / facture) ne sont chargés que sur demande : sur 90 jours
    // ils représentent l'essentiel du volume
    const { data: res, error } = await supabase.rpc('get_cdc_flux_v2', { p_depuis: depuis, p_jusqu: jusqu, p_flux_normaux: fluxNormaux });
    if (error) {
      setErreur(error.message);
      setData(null);
    } else {
      setData(res as Reponse);
      setSelection(new Set());
    }
    setChargement(false);
  }, [depuis, jusqu, fluxNormaux]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const types = useMemo(() => data?.types || [], [data]);
  const typeParCode = useMemo(() => new Map(types.map((t) => [t.code, t])), [types]);
  const evenements = useMemo(() => data?.evenements || [], [data]);

  const representants = useMemo(
    () => Array.from(new Set(evenements.map((e) => e.representant).filter(Boolean) as string[])).sort(),
    [evenements],
  );

  // Filtrage
  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return evenements.filter((e) => {
      const t = typeParCode.get(e.type);
      if (!fluxNormaux && t?.flux_normal) return false;
      if (typesActifs.length && !typesActifs.includes(e.type)) return false;
      if (filtreBlg !== 'TOUS' && e.statut_blg !== filtreBlg) return false;
      if (filtreSuivi !== 'TOUS' && e.statut_suivi !== filtreSuivi) return false;
      if (filtreRep && e.representant !== filtreRep) return false;
      if (q) {
        const texte = [e.cdc, e.numero_tiers, e.intitule_tiers, e.article, e.designation, e.representant, e.pieces_aval]
          .filter(Boolean).join(' ').toLowerCase();
        if (!texte.includes(q)) return false;
      }
      return true;
    });
  }, [evenements, typeParCode, fluxNormaux, typesActifs, filtreBlg, filtreSuivi, filtreRep, recherche]);

  // KPI (sur la période, hors flux normaux, avant filtres d'affichage)
  const kpi = useMemo(() => {
    const anomalies = evenements.filter((e) => !typeParCode.get(e.type)?.flux_normal);
    const aCorriger = anomalies.filter((e) => e.statut_blg === 'A_CORRIGER_BLG' && e.statut_suivi === 'a_traiter');
    const cdcACorriger = new Set(aCorriger.map((e) => e.cdc));
    const parType = (codes: string[]) => anomalies.filter((e) => codes.includes(e.type));
    const montant = (l: Evenement[]) => l.reduce((s, e) => s + Number(e.montant_non_explique || 0), 0);
    return {
      aCorriger: aCorriger.length,
      cdcACorriger: cdcACorriger.size,
      montantACorriger: montant(aCorriger.filter((e) => e.niveau === 'LIGNE')),
      commandes: parType(['COMMANDE_SUPPRIMEE']).length,
      lignes: parType(['SUPPRESSION_LIGNE', 'SOLDE_RELIQUAT']),
      diminutions: parType(['DIMINUTION_QTE']),
      hausses: parType(['AUGMENTATION_QTE', 'AJOUT_LIGNE']).length,
      dates: parType(['DATE_LIVRAISON_MODIFIEE']).length,
      transformations: Number(data?.nb_flux_normaux || 0),
      montant,
    };
  }, [evenements, typeParCode, data]);

  // Graphique : suppressions / modifications par jour (heure de Paris)
  const graphe = useMemo(() => {
    const codes = types.filter((t) => !t.flux_normal).map((t) => t.code);
    const parJour = new Map<string, Record<string, number | string>>();
    // tous les jours de la période, même sans événement
    const d = new Date(`${depuis}T00:00:00`);
    const fin = new Date(`${jusqu}T00:00:00`);
    while (d <= fin) {
      parJour.set(isoJour(d), { jour: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) });
      d.setDate(d.getDate() + 1);
    }
    evenements.forEach((e) => {
      if (!codes.includes(e.type)) return;
      const row = parJour.get(isoJour(new Date(e.detecte_at)));
      if (!row) return;
      row[e.type] = Number(row[e.type] || 0) + 1;
    });
    return { lignes: evenements.length ? Array.from(parJour.values()) : [], codes };
  }, [evenements, types, depuis, jusqu]);

  // Regroupement par commande
  const parCommande = useMemo(() => {
    const m = new Map<string, Evenement[]>();
    filtres.forEach((e) => {
      const l = m.get(e.cdc) || [];
      l.push(e);
      m.set(e.cdc, l);
    });
    return Array.from(m.entries())
      .map(([cdc, evts]) => {
        const premier = evts[0];
        const dernier = evts.reduce((a, b) => (a.detecte_at > b.detecte_at ? a : b));
        return {
          cdc,
          evts: evts.slice().sort((a, b) => (a.detecte_at < b.detecte_at ? 1 : -1) || (a.niveau === 'COMMANDE' ? -1 : 1)),
          tiers: premier.intitule_tiers || premier.numero_tiers || '',
          numeroTiers: premier.numero_tiers || '',
          representant: premier.representant || '',
          lien: evts.find((e) => e.blg_lien)?.blg_lien || null,
          derniere: dernier.detecte_at,
          aCorriger: evts.filter((e) => e.statut_blg === 'A_CORRIGER_BLG' && e.statut_suivi === 'a_traiter').length,
          montant: evts.filter((e) => e.niveau === 'LIGNE').reduce((s, e) => s + Number(e.montant_non_explique || 0), 0),
          supprimee: evts.some((e) => e.type === 'COMMANDE_SUPPRIMEE'),
        };
      })
      .sort((a, b) => (a.derniere < b.derniere ? 1 : -1));
  }, [filtres]);

  // Sélection
  const basculer = (id: number) =>
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const basculerCommande = (ids: number[]) =>
    setSelection((s) => {
      const n = new Set(s);
      const tous = ids.every((id) => n.has(id));
      ids.forEach((id) => (tous ? n.delete(id) : n.add(id)));
      return n;
    });
  const toutSelectionner = () =>
    setSelection((s) => (s.size === filtres.length ? new Set() : new Set(filtres.map((e) => e.id))));

  const enregistrerSuivi = async (statut: Suivi, ids?: number[]) => {
    const cible = ids || Array.from(selection);
    if (!cible.length) return;
    setEnregistrement(true);
    const { error } = await supabase.rpc('cdc_flux_set_suivi', {
      p_ids: cible,
      p_statut: statut,
      p_commentaire: commentaire.trim() || null,
    });
    setEnregistrement(false);
    if (error) {
      setErreur(error.message);
      return;
    }
    setCommentaire('');
    await charger();
  };

  // Export Excel
  const exporter = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Flux CDC SAGE');
    ws.columns = [
      { header: 'Détecté le', key: 'detecte', width: 17 },
      { header: 'Fenêtre (depuis)', key: 'depuis', width: 17 },
      { header: 'CDC', key: 'cdc', width: 13 },
      { header: 'Client', key: 'client', width: 30 },
      { header: 'N° tiers', key: 'tiers', width: 11 },
      { header: 'Commercial', key: 'rep', width: 18 },
      { header: 'Niveau', key: 'niveau', width: 11 },
      { header: 'Événement', key: 'type', width: 26 },
      { header: 'Article', key: 'article', width: 20 },
      { header: 'Désignation', key: 'designation', width: 34 },
      { header: 'Qté avant', key: 'qa', width: 10 },
      { header: 'Qté après', key: 'qn', width: 10 },
      { header: 'Qté transformée', key: 'qt', width: 14 },
      { header: 'Qté supprimée', key: 'qs', width: 13 },
      { header: 'Montant HT supprimé', key: 'mt', width: 16 },
      { header: 'Date liv. avant', key: 'd1', width: 13 },
      { header: 'Date liv. après', key: 'd2', width: 13 },
      { header: 'Pièces aval', key: 'aval', width: 20 },
      { header: 'Qté SAGE justifiée', key: 'sage', width: 15 },
      { header: 'Qté BLG', key: 'blg', width: 10 },
      { header: 'Écart BLG', key: 'ecart', width: 10 },
      { header: 'Statut BLG', key: 'statut', width: 20 },
      { header: 'Action BLG', key: 'action', width: 44 },
      { header: 'Suivi', key: 'suivi', width: 16 },
      { header: 'Commentaire', key: 'com', width: 30 },
      { header: 'Lien BLG', key: 'lien', width: 30 },
    ];
    filtres.forEach((e) => {
      ws.addRow({
        detecte: new Date(e.detecte_at),
        depuis: e.periode_debut ? new Date(e.periode_debut) : null,
        cdc: e.cdc,
        client: e.intitule_tiers,
        tiers: e.numero_tiers,
        rep: e.representant,
        niveau: e.niveau === 'COMMANDE' ? 'Commande' : 'Ligne',
        type: typeParCode.get(e.type)?.libelle || e.type,
        article: e.article,
        designation: e.designation,
        qa: e.qte_avant,
        qn: e.qte_apres,
        qt: e.qte_transformee,
        qs: e.qte_non_expliquee,
        mt: e.montant_non_explique,
        d1: e.date_livraison_avant,
        d2: e.date_livraison_apres,
        aval: e.pieces_aval || e.pieces_facture,
        sage: e.sage_qte_justifiee,
        blg: e.blg_qte,
        ecart: e.ecart_blg_qte,
        statut: STATUT_BLG[e.statut_blg]?.libelle,
        action: actionBlg(e),
        suivi: SUIVI[e.statut_suivi]?.libelle,
        com: e.commentaire,
        lien: e.blg_lien,
      });
    });
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } };
    ws.getColumn('detecte').numFmt = 'dd/mm/yy hh:mm';
    ws.getColumn('depuis').numFmt = 'dd/mm/yy hh:mm';
    ws.getColumn('mt').numFmt = '#,##0.00 €';
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'Z1' };
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `flux-cdc-sage_${depuis}_${jusqu}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dernierLot = data?.lots?.[0];

  // -------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------
  return (
    <main style={{ background: C.creme, minHeight: '100vh', padding: '24px 28px 60px', color: C.marine, fontFamily: 'var(--font-body, "IBM Plex Sans", sans-serif)' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.sauge }}>
            Projet BLG · Commandes clients
          </div>
          <h1 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 30, margin: '6px 0 4px', letterSpacing: '-0.02em' }}>
            Flux des CDC SAGE
          </h1>
          <div style={{ fontSize: 14, color: C.texte2, maxWidth: 820 }}>
            Suppressions et modifications des commandes clients détectées à chaque import SAGE (environ toutes les 2 h),
            et leur répercussion dans BLG.
            {data?.premier_suivi && <> Historique disponible depuis le {fmtDate(data.premier_suivi)} (reconstitué à partir des fichiers d’import archivés, puis capturé à chaque import).</>}
            {!data?.premier_suivi && data && <> Le suivi démarre à la prochaine publication d’un lot SAGE.</>}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {(['jour', '7j', '30j', '90j', 'perso'] as Periode[]).map((p) => (
            <button key={p} onClick={() => setPeriode(p)} style={btnChip(periode === p)}>
              {p === 'jour' ? 'Aujourd’hui' : p === '7j' ? '7 jours' : p === '30j' ? '30 jours' : p === '90j' ? '90 jours' : 'Période'}
            </button>
          ))}
          {periode === 'perso' && (
            <>
              <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} style={inputStyle} />
              <span style={{ color: C.gris }}>→</span>
              <input type="date" value={jusqu} onChange={(e) => setJusqu(e.target.value)} style={inputStyle} />
            </>
          )}
          <button onClick={() => void charger()} disabled={chargement} style={btnSecondaire}>
            {chargement ? 'Chargement…' : '↻ Actualiser'}
          </button>
          <button onClick={() => void exporter()} disabled={!filtres.length} style={btnSecondaire}>
            ⬇ Excel
          </button>
        </div>
      </div>

      {dernierLot && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.gris }}>
          Dernier import SAGE : {fmtDateHeure(dernierLot.publie_at)} ({dernierLot.nb} événement(s)) ·
          BLG relu à la synchro de nuit : une correction faite aujourd’hui dans BLG apparaît « alignée » demain.
        </div>
      )}

      {erreur && <div style={{ ...carte, marginTop: 16, borderColor: C.rouge, color: C.rouge }}>{erreur}</div>}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 18 }}>
        <Kpi
          titre="À corriger dans BLG"
          valeur={kpi.aCorriger}
          detail={`${kpi.cdcACorriger} CDC · ${fmtEur(kpi.montantACorriger)}`}
          couleur={C.rouge}
          actif={filtreBlg === 'A_CORRIGER_BLG' && filtreSuivi === 'a_traiter' && !typesActifs.length}
          onClick={() => { setFiltreBlg('A_CORRIGER_BLG'); setFiltreSuivi('a_traiter'); setTypesActifs([]); }}
        />
        <Kpi titre="Commandes supprimées" valeur={kpi.commandes} couleur={COULEUR_TYPE.COMMANDE_SUPPRIMEE}
          actif={typesActifs.length === 1 && typesActifs[0] === 'COMMANDE_SUPPRIMEE'}
          onClick={() => { setTypesActifs(['COMMANDE_SUPPRIMEE']); setFiltreBlg('TOUS'); setFiltreSuivi('TOUS'); }} />
        <Kpi titre="Lignes supprimées / soldées" valeur={kpi.lignes.length} detail={fmtEur(kpi.montant(kpi.lignes))} couleur={C.rouge}
          actif={typesActifs.join() === 'SUPPRESSION_LIGNE,SOLDE_RELIQUAT'}
          onClick={() => { setTypesActifs(['SUPPRESSION_LIGNE', 'SOLDE_RELIQUAT']); setFiltreBlg('TOUS'); setFiltreSuivi('TOUS'); }} />
        <Kpi titre="Quantités diminuées" valeur={kpi.diminutions.length} detail={fmtEur(kpi.montant(kpi.diminutions))} couleur={C.jaune}
          actif={typesActifs.join() === 'DIMINUTION_QTE'}
          onClick={() => { setTypesActifs(['DIMINUTION_QTE']); setFiltreBlg('TOUS'); setFiltreSuivi('TOUS'); }} />
        <Kpi titre="Ajouts / hausses" valeur={kpi.hausses} couleur={C.bleu}
          actif={typesActifs.join() === 'AUGMENTATION_QTE,AJOUT_LIGNE'}
          onClick={() => { setTypesActifs(['AUGMENTATION_QTE', 'AJOUT_LIGNE']); setFiltreBlg('TOUS'); setFiltreSuivi('TOUS'); }} />
        <Kpi titre="Dates de livraison modifiées" valeur={kpi.dates} couleur={COULEUR_TYPE.DATE_LIVRAISON_MODIFIEE}
          actif={typesActifs.join() === 'DATE_LIVRAISON_MODIFIEE'}
          onClick={() => { setTypesActifs(['DATE_LIVRAISON_MODIFIEE']); setFiltreBlg('TOUS'); setFiltreSuivi('TOUS'); }} />
        <Kpi titre="Transformations PL / BL / FA" valeur={kpi.transformations} detail="flux normal" couleur={C.sauge}
          actif={fluxNormaux && typesActifs.join() === 'TRANSFORMATION'}
          onClick={() => { setFluxNormaux(true); setTypesActifs(['TRANSFORMATION']); setFiltreBlg('TOUS'); setFiltreSuivi('TOUS'); }} />
      </div>

      {/* Graphique par publication */}
      {graphe.lignes.length > 0 && (
        <div style={{ ...carte, marginTop: 14, padding: '14px 16px 6px' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Suppressions et modifications par jour</div>
          <div style={{ width: '100%', height: 190 }}>
            <ResponsiveContainer>
              <BarChart data={graphe.lignes} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.ligne} vertical={false} />
                <XAxis dataKey="jour" tick={{ fontSize: 11, fill: C.gris }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.gris }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {graphe.codes.map((code) => (
                  <Bar key={code} dataKey={code} name={typeParCode.get(code)?.libelle || code} stackId="a" fill={COULEUR_TYPE[code] || C.gris} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filtres */}
      <div style={{ ...carte, marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={etiquette}>Événements</span>
          {types.filter((t) => fluxNormaux || !t.flux_normal).map((t) => {
            const actif = typesActifs.includes(t.code);
            return (
              <button
                key={t.code}
                title={t.description || ''}
                onClick={() => setTypesActifs((l) => (actif ? l.filter((c) => c !== t.code) : [...l, t.code]))}
                style={{ ...btnChip(actif), borderColor: actif ? COULEUR_TYPE[t.code] : C.ligne, background: actif ? COULEUR_TYPE[t.code] : C.blanc }}
              >
                {t.libelle}
              </button>
            );
          })}
          {typesActifs.length > 0 && (
            <button onClick={() => setTypesActifs([])} style={{ ...btnLien }}>tout</button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.texte2, marginLeft: 8 }}>
            <input type="checkbox" checked={fluxNormaux} onChange={(e) => setFluxNormaux(e.target.checked)} />
            Afficher les flux normaux (transformations)
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={etiquette}>BLG</span>
          <select value={filtreBlg} onChange={(e) => setFiltreBlg(e.target.value as StatutBlg | 'TOUS')} style={inputStyle}>
            <option value="TOUS">Tous statuts BLG</option>
            {(Object.keys(STATUT_BLG) as StatutBlg[]).map((s) => (
              <option key={s} value={s}>{STATUT_BLG[s].libelle}</option>
            ))}
          </select>
          <span style={etiquette}>Suivi</span>
          <select value={filtreSuivi} onChange={(e) => setFiltreSuivi(e.target.value as Suivi | 'TOUS')} style={inputStyle}>
            <option value="TOUS">Tous</option>
            {(Object.keys(SUIVI) as Suivi[]).map((s) => (
              <option key={s} value={s}>{SUIVI[s].libelle}</option>
            ))}
          </select>
          <span style={etiquette}>Commercial</span>
          <select value={filtreRep} onChange={(e) => setFiltreRep(e.target.value)} style={inputStyle}>
            <option value="">Tous</option>
            {representants.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            placeholder="CDC, client, article…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            style={{ ...inputStyle, minWidth: 220, flex: '1 1 220px' }}
          />
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button onClick={() => setVue('commande')} style={btnChip(vue === 'commande')}>Par commande</button>
            <button onClick={() => setVue('evenement')} style={btnChip(vue === 'evenement')}>Par événement</button>
          </div>
        </div>
      </div>

      {/* Barre d'actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button onClick={toutSelectionner} style={btnSecondaire} disabled={!filtres.length}>
          {selection.size && selection.size === filtres.length ? 'Tout désélectionner' : `Tout sélectionner (${filtres.length})`}
        </button>
        <span style={{ fontSize: 13, color: C.texte2 }}>{selection.size} sélectionné(s)</span>
        <input
          placeholder="Commentaire (facultatif)"
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          style={{ ...inputStyle, minWidth: 220 }}
        />
        <button onClick={() => void enregistrerSuivi('corrige_blg')} disabled={!selection.size || enregistrement} style={btnPrimaire(C.vert)}>
          ✓ Corrigé dans BLG
        </button>
        <button onClick={() => void enregistrerSuivi('sans_objet')} disabled={!selection.size || enregistrement} style={btnPrimaire(C.gris)}>
          Sans objet
        </button>
        <button onClick={() => void enregistrerSuivi('a_traiter')} disabled={!selection.size || enregistrement} style={btnSecondaire}>
          Remettre à traiter
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: C.texte2 }}>
          {filtres.length} événement(s) · {parCommande.length} commande(s)
        </span>
      </div>

      {/* Liste */}
      <div style={{ ...carte, marginTop: 10, padding: 0, overflowX: 'auto' }}>
        {!chargement && !filtres.length && (
          <div style={{ padding: 28, textAlign: 'center', color: C.gris, fontSize: 14 }}>
            {evenements.length
              ? 'Aucun événement ne correspond aux filtres.'
              : data?.premier_suivi
                ? 'Aucune suppression ni modification sur la période.'
                : 'Aucun événement pour l’instant : le suivi démarre à la prochaine publication d’un lot SAGE.'}
          </div>
        )}

        {vue === 'commande' && parCommande.length > 0 && (
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }} />
                <th style={th}>CDC</th>
                <th style={th}>Client</th>
                <th style={th}>Commercial</th>
                <th style={th}>Dernier événement</th>
                <th style={th}>Événements</th>
                <th style={{ ...th, textAlign: 'right' }}>Montant supprimé</th>
                <th style={th}>BLG</th>
              </tr>
            </thead>
            <tbody>
              {parCommande.map((g) => {
                const ouverte = ouvertes.has(g.cdc);
                const ids = g.evts.map((e) => e.id);
                const toutCoche = ids.every((id) => selection.has(id));
                return (
                  <FragmentCommande
                    key={g.cdc}
                    groupe={g}
                    ouverte={ouverte}
                    toutCoche={toutCoche}
                    selection={selection}
                    typeParCode={typeParCode}
                    onOuvrir={() => setOuvertes((s) => { const n = new Set(s); if (n.has(g.cdc)) n.delete(g.cdc); else n.add(g.cdc); return n; })}
                    onCocherCommande={() => basculerCommande(ids)}
                    onCocher={basculer}
                    onDetail={setDetail}
                  />
                );
              })}
            </tbody>
          </table>
        )}

        {vue === 'evenement' && filtres.length > 0 && (
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }} />
                <th style={th}>Détecté</th>
                <th style={th}>CDC</th>
                <th style={th}>Client</th>
                <th style={th}>Événement</th>
                <th style={th}>Article</th>
                <th style={th}>Changement</th>
                <th style={{ ...th, textAlign: 'right' }}>Montant</th>
                <th style={th}>Statut BLG</th>
                <th style={th}>Suivi</th>
              </tr>
            </thead>
            <tbody>
              {filtres.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${C.ligne}`, cursor: 'pointer' }} onClick={() => setDetail(e)}>
                  <td style={td} onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" checked={selection.has(e.id)} onChange={() => basculer(e.id)} />
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateHeure(e.detecte_at)}</td>
                  <td style={{ ...td, fontFamily: '"IBM Plex Mono", monospace', whiteSpace: 'nowrap' }}>{e.cdc}</td>
                  <td style={td}>{e.intitule_tiers || e.numero_tiers}</td>
                  <td style={td}><PastilleType code={e.type} libelle={typeParCode.get(e.type)?.libelle} /></td>
                  <td style={td}>
                    {e.article ? (
                      <>
                        <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12.5 }}>{e.article}</div>
                        <div style={{ fontSize: 12, color: C.gris }}>{e.designation}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td style={td}>{resume(e)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{Number(e.montant_non_explique) ? fmtEur(e.montant_non_explique) : ''}</td>
                  <td style={td}><PastilleBlg e={e} /></td>
                  <td style={td}><PastilleSuivi s={e.statut_suivi} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fiche détail */}
      {detail && (
        <div
          onClick={() => setDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.45)', zIndex: 80, display: 'flex', justifyContent: 'flex-end' }}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{ width: 'min(520px, 100vw)', height: '100%', background: C.creme, padding: '22px 24px', overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <PastilleType code={detail.type} libelle={typeParCode.get(detail.type)?.libelle} />
                <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', margin: '10px 0 2px', fontSize: 22 }}>{detail.cdc}</h2>
                <div style={{ color: C.texte2, fontSize: 14 }}>{detail.intitule_tiers} · {detail.numero_tiers} · {detail.representant}</div>
              </div>
              <button onClick={() => setDetail(null)} style={btnLien}>✕</button>
            </div>

            <div style={{ ...carte, marginTop: 16 }}>
              <LigneDetail label="Quand (dans SAGE)" valeur={fenetre(detail)} />
              {detail.article && <LigneDetail label="Article" valeur={`${detail.article} — ${detail.designation || ''}`} />}
              <LigneDetail label="Changement" valeur={resume(detail)} />
              {detail.niveau === 'LIGNE' && (
                <>
                  <LigneDetail label="Quantité avant / après" valeur={`${fmtQte(detail.qte_avant)} → ${fmtQte(detail.qte_apres)}`} />
                  <LigneDetail label="Transformée (PL / BL / FA)" valeur={`${fmtQte(detail.qte_transformee)}${detail.pieces_aval ? ` · ${detail.pieces_aval}` : ''}`} />
                  {Number(detail.qte_facturee_periode) > 0 && (
                    <LigneDetail label="Facturée sur la période" valeur={`${fmtQte(detail.qte_facturee_periode)}${detail.pieces_facture ? ` · ${detail.pieces_facture}` : ''}`} />
                  )}
                  <LigneDetail label="Supprimée (non expliquée)" valeur={`${fmtQte(detail.qte_non_expliquee)} · ${fmtEur(detail.montant_non_explique)}`} fort />
                </>
              )}
              {detail.type === 'COMMANDE_SUPPRIMEE' && (
                <LigneDetail label="Contenu supprimé" valeur={`${fmtQte(detail.nb_lignes_avant)} ligne(s) · ${fmtQte(detail.qte_avant)} pièce(s) · ${fmtEur(detail.montant_ht_avant)}`} fort />
              )}
              {detail.type === 'DATE_LIVRAISON_MODIFIEE' && (
                <LigneDetail label="Date de livraison" valeur={`${fmtDate(detail.date_livraison_avant)} → ${fmtDate(detail.date_livraison_apres)}`} fort />
              )}
            </div>

            <div style={{ ...carte, marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Dans BLG</div>
              <div style={{ marginBottom: 8 }}><PastilleBlg e={detail} /></div>
              <div style={{ fontSize: 13, color: C.texte2, marginBottom: 8 }}>{STATUT_BLG[detail.statut_blg]?.aide}</div>
              {detail.type !== 'DATE_LIVRAISON_MODIFIEE' && (
                <LigneDetail label="Qté BLG / qté SAGE justifiée" valeur={`${fmtQte(detail.blg_qte)} / ${fmtQte(detail.sage_qte_justifiee)}`} />
              )}
              {detail.type === 'DATE_LIVRAISON_MODIFIEE' && (
                <LigneDetail label="Date BLG / date SAGE" valeur={`${fmtDate(detail.blg_date_livraison)} / ${fmtDate(detail.sage_date_livraison)}`} />
              )}
              {actionBlg(detail) && <LigneDetail label="À faire" valeur={actionBlg(detail)} fort />}
              {detail.blg_synced_at && <LigneDetail label="BLG relu le" valeur={fmtDateHeure(detail.blg_synced_at)} />}
              {detail.blg_lien && (
                <a href={detail.blg_lien} target="_blank" rel="noreferrer" style={{ ...btnPrimaire(C.violet), display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>
                  Ouvrir la commande dans BLG ↗
                </a>
              )}
            </div>

            <div style={{ ...carte, marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Suivi</div>
              <div style={{ marginBottom: 8 }}><PastilleSuivi s={detail.statut_suivi} /></div>
              {detail.traite_par && <LigneDetail label="Par" valeur={`${detail.traite_par} · ${fmtDateHeure(detail.traite_at)}`} />}
              {detail.commentaire && <LigneDetail label="Commentaire" valeur={detail.commentaire} />}
              <input
                placeholder="Commentaire (facultatif)"
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button disabled={enregistrement} onClick={async () => { await enregistrerSuivi('corrige_blg', [detail.id]); setDetail(null); }} style={btnPrimaire(C.vert)}>
                  ✓ Corrigé dans BLG
                </button>
                <button disabled={enregistrement} onClick={async () => { await enregistrerSuivi('sans_objet', [detail.id]); setDetail(null); }} style={btnPrimaire(C.gris)}>
                  Sans objet
                </button>
                <button disabled={enregistrement} onClick={async () => { await enregistrerSuivi('a_traiter', [detail.id]); setDetail(null); }} style={btnSecondaire}>
                  À traiter
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------
type GroupeCommande = {
  cdc: string;
  evts: Evenement[];
  tiers: string;
  numeroTiers: string;
  representant: string;
  lien: string | null;
  derniere: string;
  aCorriger: number;
  montant: number;
  supprimee: boolean;
};

function FragmentCommande({
  groupe, ouverte, toutCoche, selection, typeParCode, onOuvrir, onCocherCommande, onCocher, onDetail,
}: {
  groupe: GroupeCommande;
  ouverte: boolean;
  toutCoche: boolean;
  selection: Set<number>;
  typeParCode: Map<string, TypeFlux>;
  onOuvrir: () => void;
  onCocherCommande: () => void;
  onCocher: (id: number) => void;
  onDetail: (e: Evenement) => void;
}) {
  const typesDistincts = Array.from(new Set(groupe.evts.map((e) => e.type)));
  return (
    <>
      <tr style={{ borderTop: `1px solid ${C.ligne}`, background: groupe.supprimee ? 'rgba(142,44,28,0.05)' : C.blanc, cursor: 'pointer' }} onClick={onOuvrir}>
        <td style={td} onClick={(ev) => ev.stopPropagation()}>
          <input type="checkbox" checked={toutCoche} onChange={onCocherCommande} />
        </td>
        <td style={{ ...td, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {ouverte ? '▾' : '▸'} {groupe.cdc}
        </td>
        <td style={td}>
          <div>{groupe.tiers}</div>
          <div style={{ fontSize: 12, color: C.gris }}>{groupe.numeroTiers}</div>
        </td>
        <td style={td}>{groupe.representant}</td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateHeure(groupe.derniere)}</td>
        <td style={td}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {typesDistincts.map((t) => (
              <PastilleType key={t} code={t} libelle={`${typeParCode.get(t)?.libelle || t} (${groupe.evts.filter((e) => e.type === t).length})`} petit />
            ))}
          </div>
        </td>
        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{groupe.montant ? fmtEur(groupe.montant) : ''}</td>
        <td style={td} onClick={(ev) => ev.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {groupe.aCorriger > 0
              ? <span style={{ color: C.rouge, fontWeight: 600, fontSize: 13 }}>{groupe.aCorriger} à corriger</span>
              : <span style={{ color: C.gris, fontSize: 13 }}>—</span>}
            {groupe.lien && <a href={groupe.lien} target="_blank" rel="noreferrer" style={{ color: C.violet, fontSize: 13 }}>BLG ↗</a>}
          </div>
        </td>
      </tr>
      {ouverte && groupe.evts.map((e) => (
        <tr key={e.id} style={{ background: C.creme, borderTop: `1px dashed ${C.ligne}`, cursor: 'pointer' }} onClick={() => onDetail(e)}>
          <td style={td} onClick={(ev) => ev.stopPropagation()}>
            <input type="checkbox" checked={selection.has(e.id)} onChange={() => onCocher(e.id)} />
          </td>
          <td style={{ ...td, fontSize: 12.5, color: C.texte2, whiteSpace: 'nowrap' }}>{fmtDateHeure(e.detecte_at)}</td>
          <td style={td} colSpan={2}>
            {e.article ? (
              <>
                <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12.5 }}>{e.article}</span>
                <span style={{ fontSize: 12, color: C.gris }}> · {e.designation}</span>
              </>
            ) : <span style={{ fontSize: 12.5, color: C.texte2 }}>Entête de commande</span>}
          </td>
          <td style={td}><PastilleType code={e.type} libelle={typeParCode.get(e.type)?.libelle} petit /></td>
          <td style={{ ...td, fontSize: 13 }}>
            {resume(e)}
            {actionBlg(e) && <div style={{ fontSize: 12, color: C.rouge, marginTop: 2 }}>→ {actionBlg(e)}</div>}
          </td>
          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontSize: 13 }}>
            {Number(e.montant_non_explique) && e.niveau === 'LIGNE' ? fmtEur(e.montant_non_explique) : ''}
          </td>
          <td style={td}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <PastilleBlg e={e} />
              <PastilleSuivi s={e.statut_suivi} />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function Kpi({ titre, valeur, detail, couleur, actif, onClick }: {
  titre: string; valeur: number; detail?: string; couleur: string; actif?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', cursor: 'pointer', background: C.blanc, borderRadius: 14, padding: '14px 16px',
        border: `1px solid ${actif ? couleur : C.ligne}`, boxShadow: actif ? `0 0 0 2px ${couleur}33` : 'none',
        borderLeft: `5px solid ${couleur}`, fontFamily: 'inherit', color: C.marine,
      }}
    >
      <div style={{ fontSize: 12.5, color: C.texte2 }}>{titre}</div>
      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 26, fontWeight: 600, marginTop: 4 }}>{valeur.toLocaleString('fr-FR')}</div>
      {detail && <div style={{ fontSize: 12, color: C.gris, marginTop: 2 }}>{detail}</div>}
    </button>
  );
}

function PastilleType({ code, libelle, petit }: { code: string; libelle?: string; petit?: boolean }) {
  const couleur = COULEUR_TYPE[code] || C.gris;
  return (
    <span style={{
      display: 'inline-block', padding: petit ? '2px 8px' : '3px 10px', borderRadius: 999,
      fontSize: petit ? 11.5 : 12.5, fontWeight: 600, color: couleur, background: `${couleur}1A`,
      border: `1px solid ${couleur}55`, whiteSpace: 'nowrap',
    }}>
      {libelle || code}
    </span>
  );
}

function PastilleBlg({ e }: { e: Evenement }) {
  const s = STATUT_BLG[e.statut_blg] || STATUT_BLG.SANS_OBJET;
  return (
    <span title={s.aide} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: s.couleur, background: s.fond, whiteSpace: 'nowrap' }}>
      {s.libelle}
      {e.statut_blg === 'A_CORRIGER_BLG' && e.ecart_blg_qte ? ` (${Number(e.ecart_blg_qte) > 0 ? '+' : ''}${fmtQte(e.ecart_blg_qte)})` : ''}
    </span>
  );
}

function PastilleSuivi({ s }: { s: Suivi }) {
  const v = SUIVI[s] || SUIVI.a_traiter;
  return <span style={{ fontSize: 12, color: v.couleur, fontWeight: 600, whiteSpace: 'nowrap' }}>● {v.libelle}</span>;
}

function LigneDetail({ label, valeur, fort }: { label: string; valeur: string; fort?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: `1px solid ${C.ligne}`, fontSize: 13.5 }}>
      <div style={{ width: 170, flexShrink: 0, color: C.gris }}>{label}</div>
      <div style={{ fontWeight: fort ? 600 : 400 }}>{valeur}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------
const carte: React.CSSProperties = {
  background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 14, padding: 14,
};

const etiquette: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.gris,
};

const inputStyle: React.CSSProperties = {
  height: 34, borderRadius: 8, border: `1px solid ${C.ligne}`, padding: '0 10px', fontSize: 13.5,
  fontFamily: 'inherit', background: C.blanc, color: C.marine,
};

const btnSecondaire: React.CSSProperties = {
  height: 34, borderRadius: 8, border: `1px solid ${C.ligne}`, background: C.blanc, color: C.marine,
  padding: '0 12px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
};

const btnLien: React.CSSProperties = {
  border: 'none', background: 'transparent', color: C.violet, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
};

function btnChip(actif: boolean): React.CSSProperties {
  return {
    height: 30, borderRadius: 999, padding: '0 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${actif ? C.marine : C.ligne}`, background: actif ? C.marine : C.blanc, color: actif ? C.blanc : C.marine,
  };
}

function btnPrimaire(couleur: string): React.CSSProperties {
  return {
    height: 34, borderRadius: 8, border: 'none', background: couleur, color: C.blanc,
    padding: '0 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: '34px',
  };
}

const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 10px', fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: C.gris, background: C.creme, position: 'sticky', top: 0, whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '9px 10px', verticalAlign: 'top' };
