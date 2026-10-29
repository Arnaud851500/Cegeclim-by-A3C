'use client';

/**
 * Page « Rapprochement SAGE ↔ BLG » — stocks par dépôt, commandes fournisseurs (CDF), commandes clients (CDC)
 * ---------------------------------------------------------------------------------------------------------
 * Objectif : savoir, ligne par ligne, QUEL type d'écart sépare SAGE de BLG, QUEL système corriger et COMMENT,
 * puis suivre le nettoyage jusqu'à zéro.
 *
 * Objets Supabase (projet gchwihltydsplarhveyv, migrations rappro_sage_blg_*) :
 *   - rappro_build()            moteur : recalcule tout le cache rappro_ecarts (≈ 40 s) — pg_cron « rappro-sage-blg-hourly » à h+57
 *   - rappro_refresh()          même chose, appelable depuis l'écran (utilisateur authentifié)
 *   - get_rappro_synthese()     → { run, en_cours, types[], depots[], historique[] }
 *   - v_rappro_ecarts           écarts + catalogue des types + suivi de traitement
 *   - rappro_set_suivi(domaine, cles[], statut, commentaire)   statuts : a_traiter / en_cours / corrige / accepte
 *   - tables : rappro_ecart_types (catalogue : libellé, système à corriger, action), rappro_depot_map (dépôt SAGE ↔ entrepôt BLG),
 *              rappro_ecart_suivi, rappro_historique (courbe de nettoyage), rappro_runs
 *
 * Règles de lecture :
 *   - SAGE fait foi tant que la bascule n'est pas faite : la plupart des actions sont « à corriger dans BLG ».
 *   - BLG est figé à la synchro de nuit, SAGE est rechargé 7 fois par jour : un écart sur un article / une pièce
 *     ayant bougé dans SAGE depuis la synchro BLG est marqué « décalage probable » et masqué par défaut.
 *   - Stock : comparaison dépôt SAGE ↔ entrepôt BLG (même libellé, LA ROCHELLE = LAROCH). Un écart égal aux réceptions
 *     CDF et livraisons CDC non passées dans BLG est classé « expliqué par les flux ».
 *   - CDF : bons de commande fournisseurs ouverts SAGE (sage.bdcf type 12) ↔ commandes d'achat BLG, rapprochées par
 *     n° de CDF + article ; réceptions SAGE = BLF (type 13) rattachés à la CDF.
 *   - CDC : cache mv_cdc_comparaison (portefeuille SAGE non soldé ↔ commandes BLG ouvertes) puis lignes article par article.
 *
 * Deux niveaux d'analyse (v2, 16/10/2026) :
 *   - ENTETE : le document (commande soldée d'un côté et ouverte de l'autre, absente, statut d'entête…)
 *   - LIGNE  : article par article (reliquat en double dans BLG, reliquat soldé dans SAGE, réception non passée…)
 *   Une entête en écart renvoie vers ses lignes (bouton « Voir les lignes » de la fiche).
 *
 * Route : app/controle-sage-blg/rapprochement-sage-blg/page.tsx → /controle-sage-blg/rapprochement-sage-blg (bloc « Projet BLG »)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import ExcelJS from 'exceljs';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';

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
  sageBleu: '#2F6690',
  gris: '#8A8474',
  texte2: '#5B5646',
  jaune: '#B58A2A',
};

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type Domaine = 'STOCK' | 'CDF' | 'CDC';
type Niveau = 'ENTETE' | 'LIGNE';
type Systeme = 'BLG' | 'SAGE' | 'INTERFACE' | 'A_ANALYSER' | 'AUCUN';
type Suivi = 'a_traiter' | 'en_cours' | 'corrige' | 'accepte';

type TypeSynthese = {
  code: string;
  domaine: Domaine;
  niveau: Niveau;
  libelle: string;
  description: string | null;
  systeme_a_corriger: Systeme;
  action: string;
  gravite: number;
  nettoyage_masse: boolean;
  ordre: number;
  nb: number;
  nb_decalage: number;
  nb_documents: number;
  valeur_ht: number;
  nb_a_traiter: number;
  nb_en_cours: number;
  nb_corrige: number;
  nb_accepte: number;
  nb_plus_1an: number;
};

type Synthese = {
  run: { id: number; debut: string; fin: string; blg_synchro: string | null; sage_synchro: string | null; compteurs: Record<string, unknown> | null; erreur: string | null } | null;
  en_cours: boolean;
  types: TypeSynthese[];
  depots: { domaine: Domaine; niveau: Niveau; depot: string; nb: number; valeur_ht: number }[];
  historique: { jour: string; domaine: Domaine; nb: number; valeur_ht: number | null }[];
};

type Ecart = {
  id: number;
  domaine: Domaine;
  niveau: Niveau;
  type_code: string;
  cle: string;
  document: string | null;
  document_blg_id: number | null;
  reference_article: string | null;
  designation: string | null;
  depot: string | null;
  tiers_code: string | null;
  tiers_nom: string | null;
  date_document: string | null;
  age_jours: number | null;
  qte_sage: number | null;
  qte_blg: number | null;
  ecart_qte: number | null;
  valeur_ht: number | null;
  statut_sage: string | null;
  statut_blg: string | null;
  lien_blg: string | null;
  probable_decalage: boolean;
  detail: Record<string, unknown> | null;
  calcule_le: string;
  type_libelle: string;
  systeme_a_corriger: Systeme;
  action: string;
  gravite: number;
  nettoyage_masse: boolean;
  suivi_statut: Suivi;
  suivi_commentaire: string | null;
  suivi_par: string | null;
  suivi_le: string | null;
  /** Commande BLG archivée (CDC / CDF) ; null = sans pièce BLG ou stock. */
  blg_archive: boolean | null;
  blg_archive_motif: string | null;
};

type ArchiveFiltre = '' | 'oui' | 'non';

type SortKey = 'valeur_ht' | 'age_jours' | 'document' | 'reference_article' | 'depot' | 'tiers_nom' | 'ecart_qte' | 'date_document';

// ---------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------
const DOMAINES: { key: Domaine; label: string; court: string; hint: string }[] = [
  { key: 'STOCK', label: 'Stocks par dépôt', court: 'Stocks', hint: 'Quantité en stock dépôt SAGE ↔ entrepôt BLG, article par article' },
  { key: 'CDF', label: 'Commandes fournisseurs', court: 'CDF', hint: 'Reste à recevoir des bons de commande fournisseurs SAGE ↔ commandes d’achat BLG' },
  { key: 'CDC', label: 'Commandes clients', court: 'CDC', hint: 'Portefeuille clients SAGE ↔ commandes BLG, entête puis lignes' },
];

const SYSTEMES: { key: Systeme; label: string; color: string; bg: string }[] = [
  { key: 'BLG', label: 'À corriger dans BLG', color: C.violet, bg: '#EFE9F7' },
  { key: 'SAGE', label: 'À corriger dans SAGE', color: C.sageBleu, bg: '#E8EFF5' },
  { key: 'INTERFACE', label: 'Interface SAGE → BLG', color: C.alerte, bg: '#FBEAE2' },
  { key: 'A_ANALYSER', label: 'À analyser', color: C.jaune, bg: '#F7F0DD' },
  { key: 'AUCUN', label: 'Information / rien à faire', color: C.gris, bg: '#F1EFE8' },
];
const SYSTEME_PAR_CLE = Object.fromEntries(SYSTEMES.map((s) => [s.key, s])) as Record<Systeme, (typeof SYSTEMES)[number]>;

const SUIVIS: { key: Suivi; label: string; color: string }[] = [
  { key: 'a_traiter', label: 'À traiter', color: C.rouge },
  { key: 'en_cours', label: 'En cours', color: C.jaune },
  { key: 'corrige', label: 'Corrigé (attend la synchro)', color: C.vert },
  { key: 'accepte', label: 'Écart accepté', color: C.gris },
];
const SUIVI_PAR_CLE = Object.fromEntries(SUIVIS.map((s) => [s.key, s])) as Record<Suivi, (typeof SUIVIS)[number]>;

const AGES: { key: string; label: string; min?: number; max?: number }[] = [
  { key: '', label: 'Tous âges' },
  { key: 'j30', label: '< 30 j', max: 29 },
  { key: 'j365', label: '30 j – 1 an', min: 30, max: 365 },
  { key: 'an', label: '> 1 an', min: 366 },
];

const GRAVITE_LIB: Record<number, { label: string; color: string }> = {
  1: { label: 'Bloquant', color: C.rouge },
  2: { label: 'À corriger', color: C.alerte },
  3: { label: 'Info', color: C.gris },
};

// libellés des clés du détail JSON
const DETAIL_LABELS: Record<string, string> = {
  sage_reste: 'SAGE — reste à recevoir',
  sage_depot: 'SAGE — dépôt',
  sage_fournisseur: 'SAGE — fournisseur',
  sage_date_livraison: 'SAGE — date de livraison prévue',
  sage_recu_blf: 'SAGE — reçu (BLF récents)',
  sage_retour: 'SAGE — retour fournisseur',
  sage_pieces_reception: 'SAGE — pièces de réception',
  sage_date_reception: 'SAGE — date de réception',
  blg_qte: 'BLG — quantité commandée',
  blg_reste: 'BLG — reste à recevoir',
  blg_recu: 'BLG — reçu',
  blg_non_livrable: 'BLG — ligne non livrable',
  blg_lieu: 'BLG — lieu de livraison',
  blg_fournisseur: 'BLG — fournisseur',
  blg_date_demandee: 'BLG — date demandée',
  blg_date_reception: 'BLG — date de réception',
  blg_statut_entete: 'BLG — statut entête',
  blg_part_id: 'BLG — id article',
  sage_commandee: 'SAGE — commandé',
  sage_livree: 'SAGE — livré',
  sage_facturee: 'SAGE — facturé',
  sage_montant: 'SAGE — montant HT',
  sage_etats: 'SAGE — états des lignes',
  sage_date_mouvement: 'SAGE — dernier mouvement',
  blg_commandee: 'BLG — commandé',
  blg_livree: 'BLG — livré',
  blg_facturee: 'BLG — facturé',
  blg_montant: 'BLG — montant HT',
  blg_etats: 'BLG — états des lignes',
  representant: 'Représentant',
  blg_agence: 'BLG — agence',
  blg_qte_totale: 'BLG — quantité totale',
  blg_qte_livree: 'BLG — quantité livrée',
  blg_qte_facturee: 'BLG — quantité facturée',
  blg_derniere_livraison: 'BLG — dernière livraison',
  blg_derniere_facture: 'BLG — dernière facture',
  sage_pieces_bl: 'SAGE — BL',
  sage_pieces_factures: 'SAGE — factures',
  sage_reserve: 'SAGE — réservé',
  sage_prepa: 'SAGE — en préparation',
  sage_valeur: 'SAGE — valeur du stock',
  blg_derniere_maj: 'BLG — dernière mise à jour du stock',
  explique_cdf_recues_sage: 'Expliqué : réceptions CDF SAGE non passées dans BLG',
  explique_cdc_livrees: 'Expliqué : livraisons CDC en écart (SAGE − BLG)',
  mouvement_sage_depuis_synchro: 'Mouvement SAGE depuis la synchro BLG',
  type_incoherence: 'Type d’incohérence',
  qte: 'Quantité',
  qte_livree: 'Quantité livrée',
  reste: 'Reste à livrer',
  status_fk: 'Statut workflow BLG',
  ecart_livraison: 'Écart statut livraison',
  ecart_facturation: 'Écart statut facturation',
  sage_lignes_ouvertes: 'SAGE — lignes ouvertes',
  blg_lignes_ouvertes: 'BLG — lignes avec reste',
  lignes_en_ecart: 'Lignes en écart',
  types_lignes: 'Types d’écart des lignes',
  blg_reliquat_double: 'BLG — reliquat compté en double',
  blg_nb_lignes: 'BLG — nombre de lignes pour l’article',
};

const PAGE = 100;

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const fmtNum = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const fmtEUR = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('fr-FR');
};
const fmtDateHeure = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : `${x.toLocaleDateString('fr-FR')} ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (typeof v === 'number') return fmtNum(v, 2);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.length > 10 ? fmtDateHeure(v) : fmtDate(v);
  return String(v);
};
const errMsg = (e: unknown) => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
};
// échappe les caractères spéciaux du filtre PostgREST or=()
const pgrstEsc = (s: string) => s.replace(/[,()*%]/g, ' ').trim();

function lireUrl() {
  if (typeof window === 'undefined') return { domaine: 'CDC' as Domaine, type: '', niveau: 'ENTETE' as Niveau, q: '' };
  const p = new URLSearchParams(window.location.search);
  const d = (p.get('domaine') || 'CDC').toUpperCase();
  const domaine = (['STOCK', 'CDF', 'CDC'].includes(d) ? d : 'CDC') as Domaine;
  const n = (p.get('niveau') || '').toUpperCase();
  const niveau: Niveau = domaine === 'STOCK' ? 'LIGNE' : n === 'LIGNE' ? 'LIGNE' : 'ENTETE';
  return { domaine, type: p.get('type') || '', niveau, q: p.get('q') || '' };
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
export default function RapprochementSageBlgPage() {
  const [synthese, setSynthese] = useState<Synthese | null>(null);
  const [loadingSynthese, setLoadingSynthese] = useState(true);
  const [recalcul, setRecalcul] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [domaine, setDomaine] = useState<Domaine>('CDC');
  const [niveau, setNiveau] = useState<Niveau>('ENTETE');
  const [typeCode, setTypeCode] = useState<string>('');
  const [afficherDecalage, setAfficherDecalage] = useState(false);
  const [afficherInfos, setAfficherInfos] = useState(false);

  // filtres liste
  const [recherche, setRecherche] = useState('');
  const [rechercheDebounced, setRechercheDebounced] = useState('');
  const [depot, setDepot] = useState('');
  const [age, setAge] = useState('');
  const [suiviFiltre, setSuiviFiltre] = useState<'' | Suivi | 'ouverts'>('ouverts');
  // 29/10/2026 : commandes archivées dans BLG (CDC / CDF) — oui / non / tous
  const [archiveFiltre, setArchiveFiltre] = useState<ArchiveFiltre>('');
  const archiveActif: ArchiveFiltre = domaine === 'STOCK' ? '' : archiveFiltre;
  const [sortKey, setSortKey] = useState<SortKey>('valeur_ht');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<Ecart[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Ecart | null>(null);
  const [exporting, setExporting] = useState(false);

  // URL → état initial
  useEffect(() => {
    const u = lireUrl();
    setDomaine(u.domaine);
    setNiveau(u.niveau);
    setTypeCode(u.type);
    if (u.q) {
      setRecherche(u.q);
      setRechercheDebounced(u.q);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    p.set('domaine', domaine);
    p.set('niveau', niveau);
    if (typeCode) p.set('type', typeCode);
    else p.delete('type');
    p.delete('q');
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }, [domaine, niveau, typeCode]);

  useEffect(() => {
    const t = setTimeout(() => setRechercheDebounced(recherche), 300);
    return () => clearTimeout(t);
  }, [recherche]);

  // -------------------------------------------------------------
  // Synthèse
  // -------------------------------------------------------------
  const chargerSynthese = useCallback(async () => {
    setLoadingSynthese(true);
    const { data, error: err } = await supabase.rpc('get_rappro_synthese', { p_archive: archiveActif || null });
    setLoadingSynthese(false);
    if (err) {
      setError(`Synthèse indisponible : ${err.message}`);
      return;
    }
    setSynthese(data as Synthese);
  }, [archiveActif]);

  useEffect(() => {
    void chargerSynthese();
  }, [chargerSynthese]);

  async function relancerCalcul() {
    setRecalcul(true);
    setError(null);
    setInfo('Recalcul en cours (≈ 45 s) : relecture des stocks, CDF et CDC SAGE et BLG…');
    const { error: err } = await supabase.rpc('rappro_refresh');
    setRecalcul(false);
    if (err) {
      setInfo(null);
      setError(`Le recalcul a échoué : ${err.message}`);
      return;
    }
    setInfo('Recalcul terminé.');
    await chargerSynthese();
    await chargerLignes();
  }

  const niveauType = (t: TypeSynthese): Niveau => t.niveau ?? 'LIGNE';
  const typesDomaine = useMemo(
    () => (synthese?.types ?? []).filter((t) => t.domaine === domaine && niveauType(t) === niveau).sort((a, b) => a.ordre - b.ordre),
    [synthese, domaine, niveau]
  );
  const typeActif = useMemo(() => typesDomaine.find((t) => t.code === typeCode) ?? null, [typesDomaine, typeCode]);

  const compteDomaine = useCallback(
    (d: Domaine, n?: Niveau) =>
      (synthese?.types ?? [])
        .filter((t) => t.domaine === d && (!n || niveauType(t) === n) && (afficherInfos || t.systeme_a_corriger !== 'AUCUN'))
        .reduce((s, t) => s + t.nb + (afficherDecalage ? t.nb_decalage : 0), 0),
    [synthese, afficherDecalage, afficherInfos]
  );

  const kpis = useMemo(() => {
    const ts = typesDomaine.filter((t) => afficherInfos || t.systeme_a_corriger !== 'AUCUN');
    const nb = ts.reduce((s, t) => s + t.nb, 0);
    const traites = ts.reduce((s, t) => s + t.nb_corrige + t.nb_accepte, 0);
    return {
      nb,
      valeur: ts.reduce((s, t) => s + Number(t.valeur_ht || 0), 0),
      decalage: typesDomaine.reduce((s, t) => s + t.nb_decalage, 0),
      aTraiter: ts.reduce((s, t) => s + t.nb_a_traiter, 0),
      enCours: ts.reduce((s, t) => s + t.nb_en_cours, 0),
      traites,
      pct: nb ? Math.round((traites / nb) * 100) : 0,
      masse: ts.filter((t) => t.nettoyage_masse).reduce((s, t) => s + t.nb, 0),
      plus1an: ts.reduce((s, t) => s + t.nb_plus_1an, 0),
    };
  }, [typesDomaine, afficherInfos]);

  const depotsDomaine = useMemo(
    () => {
      const m = new Map<string, number>();
      (synthese?.depots ?? [])
        .filter((d) => d.domaine === domaine && (d.niveau ?? 'LIGNE') === niveau)
        .forEach((d) => m.set(d.depot, (m.get(d.depot) ?? 0) + Number(d.nb)));
      return Array.from(m.entries()).map(([depot, nb]) => ({ depot, nb })).sort((a, b) => b.nb - a.nb);
    },
    [synthese, domaine, niveau]
  );

  const historique = useMemo(() => {
    const parJour = new Map<string, Record<string, number | string>>();
    (synthese?.historique ?? []).forEach((h) => {
      const k = h.jour;
      if (!parJour.has(k)) parJour.set(k, { jour: k, label: fmtDate(k).slice(0, 5) });
      parJour.get(k)![h.domaine] = Number(h.nb);
    });
    return Array.from(parJour.values()).sort((a, b) => String(a.jour).localeCompare(String(b.jour)));
  }, [synthese]);

  // -------------------------------------------------------------
  // Liste
  // -------------------------------------------------------------
  const construireRequete = useCallback(
    (selectCols: string, withCount: boolean) => {
      let q = supabase.from('v_rappro_ecarts').select(selectCols, withCount ? { count: 'exact' } : undefined).eq('domaine', domaine).eq('niveau', niveau);
      if (typeCode) q = q.eq('type_code', typeCode);
      else if (!afficherInfos) q = q.neq('systeme_a_corriger', 'AUCUN');
      if (!afficherDecalage) q = q.eq('probable_decalage', false);
      if (depot) q = depot === '(sans dépôt)' ? q.is('depot', null) : q.eq('depot', depot);
      const a = AGES.find((x) => x.key === age);
      if (a?.min != null) q = q.gte('age_jours', a.min);
      if (a?.max != null) q = q.lte('age_jours', a.max);
      if (suiviFiltre === 'ouverts') q = q.in('suivi_statut', ['a_traiter', 'en_cours']);
      else if (suiviFiltre) q = q.eq('suivi_statut', suiviFiltre);
      if (archiveActif === 'oui') q = q.eq('blg_archive', true);
      else if (archiveActif === 'non') q = q.not('blg_archive', 'is', true);
      const s = pgrstEsc(rechercheDebounced);
      if (s) {
        q = q.or(
          ['document', 'reference_article', 'designation', 'tiers_code', 'tiers_nom', 'depot'].map((c) => `${c}.ilike.*${s}*`).join(',')
        );
      }
      return q.order(sortKey, { ascending: sortAsc, nullsFirst: false }).order('id', { ascending: true });
    },
    [domaine, niveau, typeCode, afficherDecalage, afficherInfos, depot, age, suiviFiltre, archiveActif, rechercheDebounced, sortKey, sortAsc]
  );

  const chargerLignes = useCallback(async () => {
    setLoadingRows(true);
    const { data, count, error: err } = await construireRequete('*', true).range(page * PAGE, page * PAGE + PAGE - 1);
    setLoadingRows(false);
    if (err) {
      setError(`Chargement des écarts impossible : ${err.message}`);
      return;
    }
    setRows((data ?? []) as unknown as Ecart[]);
    setTotal(count ?? 0);
  }, [construireRequete, page]);

  useEffect(() => {
    void chargerLignes();
  }, [chargerLignes]);

  useEffect(() => {
    setPage(0);
    setSelection(new Set());
  }, [domaine, niveau, typeCode, afficherDecalage, afficherInfos, depot, age, suiviFiltre, archiveActif, rechercheDebounced, sortKey, sortAsc]);

  function changerDomaine(d: Domaine) {
    setDomaine(d);
    setNiveau(d === 'STOCK' ? 'LIGNE' : 'ENTETE');
    setTypeCode('');
    setDepot('');
    setDetail(null);
  }

  function changerNiveau(n: Niveau) {
    setNiveau(n);
    setTypeCode('');
    setDepot('');
  }

  // depuis une entête : ouvre les lignes de la même pièce
  function voirLignes(document: string) {
    setDetail(null);
    setNiveau('LIGNE');
    setTypeCode('');
    setDepot('');
    setAge('');
    setSuiviFiltre('');
    setRecherche(document);
    setRechercheDebounced(document);
  }

  function trier(k: SortKey) {
    if (sortKey === k) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(['document', 'reference_article', 'depot', 'tiers_nom'].includes(k));
    }
  }

  // -------------------------------------------------------------
  // Suivi de traitement
  // -------------------------------------------------------------
  async function marquer(cles: string[], statut: Suivi, commentaire?: string | null) {
    if (!cles.length) return;
    const { data, error: err } = await supabase.rpc('rappro_set_suivi', {
      p_domaine: domaine,
      p_cles: cles,
      p_statut: statut,
      p_commentaire: commentaire ?? null,
    });
    if (err) {
      setError(`Mise à jour du suivi impossible : ${err.message}`);
      return;
    }
    setInfo(`${data ?? cles.length} écart(s) passé(s) en « ${SUIVI_PAR_CLE[statut].label} ».`);
    setSelection(new Set());
    await Promise.all([chargerLignes(), chargerSynthese()]);
  }

  async function marquerSelection(statut: Suivi) {
    let commentaire: string | null = null;
    if (statut === 'accepte') {
      commentaire = window.prompt('Pourquoi cet écart est-il accepté ? (commentaire conservé)') ?? null;
      if (commentaire === null) return;
    }
    await marquer(Array.from(selection), statut, commentaire);
  }

  async function selectionnerTout() {
    // sélectionne toutes les lignes du filtre courant (jusqu'à 5 000)
    const { data, error: err } = await construireRequete('cle', false).range(0, 4999);
    if (err) {
      setError(errMsg(err));
      return;
    }
    setSelection(new Set(((data ?? []) as unknown as { cle: string }[]).map((r) => r.cle)));
  }

  // -------------------------------------------------------------
  // Export Excel
  // -------------------------------------------------------------
  async function exporter() {
    setExporting(true);
    setError(null);
    try {
      const toutes: Ecart[] = [];
      for (let from = 0; from < 50000; from += 1000) {
        const { data, error: err } = await construireRequete('*', false).range(from, from + 999);
        if (err) throw err;
        const batch = (data ?? []) as unknown as Ecart[];
        toutes.push(...batch);
        if (batch.length < 1000) break;
      }
      const wb = new ExcelJS.Workbook();
      wb.creator = 'CEGECLIM by A3C';

      // Onglet synthèse des types
      const wsT = wb.addWorksheet('Types d’écart');
      wsT.columns = [
        { header: 'Domaine', key: 'domaine', width: 10 },
        { header: 'Type', key: 'libelle', width: 48 },
        { header: 'Système à corriger', key: 'systeme', width: 22 },
        { header: 'Action', key: 'action', width: 70 },
        { header: 'Nettoyage en masse', key: 'masse', width: 12 },
        { header: 'Lignes', key: 'nb', width: 10 },
        { header: 'Documents', key: 'docs', width: 10 },
        { header: 'Valeur HT', key: 'valeur', width: 14 },
        { header: 'Décalage probable', key: 'decal', width: 12 },
        { header: 'À traiter', key: 'at', width: 10 },
        { header: 'En cours', key: 'ec', width: 10 },
        { header: 'Corrigé', key: 'co', width: 10 },
        { header: 'Accepté', key: 'ac', width: 10 },
      ];
      typesDomaine.forEach((t) =>
        wsT.addRow({
          domaine: t.domaine,
          libelle: t.libelle,
          systeme: SYSTEME_PAR_CLE[t.systeme_a_corriger]?.label,
          action: t.action,
          masse: t.nettoyage_masse ? 'Oui' : 'Non',
          nb: t.nb,
          docs: t.nb_documents,
          valeur: Number(t.valeur_ht || 0),
          decal: t.nb_decalage,
          at: t.nb_a_traiter,
          ec: t.nb_en_cours,
          co: t.nb_corrige,
          ac: t.nb_accepte,
        })
      );
      wsT.getRow(1).font = { bold: true };
      wsT.getColumn('valeur').numFmt = '#,##0 €';

      // Onglet lignes
      const ws = wb.addWorksheet('Écarts');
      const detailKeys = Array.from(new Set(toutes.flatMap((r) => Object.keys(r.detail ?? {})))).sort();
      ws.columns = [
        { header: 'Type d’écart', key: 'type_libelle', width: 40 },
        { header: 'Système à corriger', key: 'systeme', width: 20 },
        { header: 'Action', key: 'action', width: 60 },
        { header: 'Document', key: 'document', width: 14 },
        { header: 'Lien BLG', key: 'lien_blg', width: 16 },
        { header: 'Référence article', key: 'reference_article', width: 20 },
        { header: 'Désignation', key: 'designation', width: 40 },
        { header: 'Dépôt', key: 'depot', width: 22 },
        { header: 'Tiers', key: 'tiers_code', width: 10 },
        { header: 'Nom tiers', key: 'tiers_nom', width: 30 },
        { header: 'Date', key: 'date_document', width: 12 },
        { header: 'Âge (j)', key: 'age_jours', width: 8 },
        { header: 'Qté SAGE', key: 'qte_sage', width: 10 },
        { header: 'Qté BLG', key: 'qte_blg', width: 10 },
        { header: 'Écart (SAGE − BLG)', key: 'ecart_qte', width: 12 },
        { header: 'Valeur HT', key: 'valeur_ht', width: 12 },
        { header: 'Situation SAGE', key: 'statut_sage', width: 34 },
        { header: 'Situation BLG', key: 'statut_blg', width: 34 },
        { header: 'Archivée BLG', key: 'archive', width: 12 },
        { header: 'Motif archivage BLG', key: 'blg_archive_motif', width: 24 },
        { header: 'Décalage probable', key: 'decal', width: 10 },
        { header: 'Suivi', key: 'suivi', width: 16 },
        { header: 'Commentaire', key: 'suivi_commentaire', width: 30 },
        { header: 'Clé', key: 'cle', width: 30 },
        ...detailKeys.map((k) => ({ header: DETAIL_LABELS[k] ?? k, key: `d_${k}`, width: 16 })),
      ];
      toutes.forEach((r) => {
        const row: Record<string, unknown> = {
          ...r,
          systeme: SYSTEME_PAR_CLE[r.systeme_a_corriger]?.label,
          lien_blg: r.lien_blg ? { text: 'Ouvrir', hyperlink: r.lien_blg } : null,
          date_document: r.date_document ? new Date(r.date_document) : null,
          qte_sage: r.qte_sage == null ? null : Number(r.qte_sage),
          qte_blg: r.qte_blg == null ? null : Number(r.qte_blg),
          ecart_qte: r.ecart_qte == null ? null : Number(r.ecart_qte),
          valeur_ht: r.valeur_ht == null ? null : Number(r.valeur_ht),
          decal: r.probable_decalage ? 'Oui' : '',
          archive: r.blg_archive == null ? '' : r.blg_archive ? 'Oui' : 'Non',
          suivi: SUIVI_PAR_CLE[r.suivi_statut]?.label,
        };
        detailKeys.forEach((k) => {
          const v = r.detail?.[k];
          row[`d_${k}`] = v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : v;
        });
        ws.addRow(row);
      });
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
      ws.getColumn('valeur_ht').numFmt = '#,##0.00 €';
      ws.getColumn('date_document').numFmt = 'dd/mm/yyyy';

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffixe = typeCode ? typeCode.toLowerCase() : `${domaine.toLowerCase()}-${niveau === 'ENTETE' ? 'entetes' : 'lignes'}`;
      a.download = `rapprochement-sage-blg-${suffixe}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setInfo(`${toutes.length.toLocaleString('fr-FR')} ligne(s) exportée(s).`);
    } catch (e) {
      setError(`Export impossible : ${errMsg(e)}`);
    } finally {
      setExporting(false);
    }
  }

  // -------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------
  const run = synthese?.run;
  const typesParSysteme = useMemo(
    () =>
      SYSTEMES.map((s) => ({
        ...s,
        types: typesDomaine.filter((t) => t.systeme_a_corriger === s.key && (afficherInfos || s.key !== 'AUCUN' || t.code === typeCode)),
      })).filter((g) => g.types.length),
    [typesDomaine, afficherInfos, typeCode]
  );
  const toutCoche = rows.length > 0 && rows.every((r) => selection.has(r.cle));
  const nbPages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div style={{ background: C.creme, minHeight: '100vh', fontFamily: '"IBM Plex Sans", sans-serif', color: C.marine }}>
      <div style={{ padding: '24px 28px 64px', boxSizing: 'border-box' }}>
        {/* ---------------- En-tête ---------------- */}
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.alerte, fontWeight: 700 }}>Projet BLG · Nettoyage avant bascule</div>
            <h1 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 30, fontWeight: 600, margin: '4px 0 0' }}>Rapprochement SAGE ↔ BLG</h1>
            <p style={{ color: C.texte2, fontSize: 14, margin: '6px 0 0', maxWidth: 920 }}>
              Chaque écart est classé par type, avec le système à corriger et l’action attendue. Corrige, marque l’écart « corrigé » : il disparaît à la synchro
              suivante et la courbe de nettoyage descend.
            </p>
          </div>
          <div style={{ fontSize: 12, color: C.gris, textAlign: 'right', lineHeight: 1.6 }}>
            Calculé le <b style={{ color: C.marine }}>{fmtDateHeure(run?.fin)}</b> (recalcul automatique toutes les heures)
            <br />
            Photo SAGE : {fmtDateHeure(run?.sage_synchro)} · Photo BLG : {fmtDateHeure(run?.blg_synchro)}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={() => void Promise.all([chargerSynthese(), chargerLignes()])} disabled={recalcul} style={btnSecondaire}>
                ↻ Recharger
              </button>
              <button onClick={() => void relancerCalcul()} disabled={recalcul || synthese?.en_cours} style={btnPrimaire} title="Relit SAGE et BLG et reclasse tous les écarts (≈ 45 s)">
                {recalcul || synthese?.en_cours ? 'Recalcul en cours…' : '⟳ Recalculer maintenant'}
              </button>
            </div>
          </div>
        </header>

        {error && <Bandeau couleur={C.rouge} fond="#FBEAE2" onClose={() => setError(null)}>{error}</Bandeau>}
        {info && <Bandeau couleur={C.vert} fond="#E7F1E9" onClose={() => setInfo(null)}>{info}</Bandeau>}
        {run?.erreur && <Bandeau couleur={C.rouge} fond="#FBEAE2">Dernier calcul en erreur : {run.erreur}</Bandeau>}

        {/* ---------------- Domaines ---------------- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 14 }}>
          {DOMAINES.map((d) => {
            const actif = d.key === domaine;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => changerDomaine(d.key)}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: `1px solid ${actif ? C.marine : C.ligne}`,
                  background: actif ? C.marine : C.blanc,
                  color: actif ? C.creme : C.marine,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 17, fontWeight: 600 }}>{d.label}</span>
                  <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 24, fontWeight: 600 }}>
                    {loadingSynthese ? '…' : fmtNum(compteDomaine(d.key, 'LIGNE'))}
                  </span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  {d.key === 'STOCK' ? 'couples dépôt × article en écart' : `lignes en écart · ${loadingSynthese ? '…' : fmtNum(compteDomaine(d.key, 'ENTETE'))} entêtes`}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{d.hint}</div>
              </button>
            );
          })}
        </div>

        {/* ---------------- Niveau : entêtes / lignes ---------------- */}
        {domaine !== 'STOCK' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 10, padding: 3 }}>
              {(['ENTETE', 'LIGNE'] as Niveau[]).map((n) => {
                const actif = n === niveau;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => changerNiveau(n)}
                    style={{
                      border: 'none',
                      borderRadius: 8,
                      padding: '7px 16px',
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: actif ? C.marine : 'transparent',
                      color: actif ? C.creme : C.marine,
                    }}
                  >
                    {n === 'ENTETE' ? 'Entêtes' : 'Lignes'} ({fmtNum(compteDomaine(domaine, n))})
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 12.5, color: C.texte2, maxWidth: 760 }}>
              {niveau === 'ENTETE'
                ? 'Une ligne par commande : présente d’un seul côté, soldée d’un côté et ouverte de l’autre, ou statut d’entête différent. Ouvre une commande pour voir ses lignes.'
                : 'Une ligne par article de commande : reliquat en double, reliquat soldé, réception ou livraison non passée, quantité différente…'}
            </span>
          </div>
        )}

        {/* ---------------- KPI + courbe ---------------- */}
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Kpi label="Écarts à nettoyer" value={fmtNum(kpis.nb)} accent={C.marine} />
            <Kpi label="Valeur concernée" value={fmtEUR(kpis.valeur)} accent={C.alerte} />
            <Kpi label="À traiter" value={fmtNum(kpis.aTraiter)} accent={C.rouge} />
            <Kpi label="En cours" value={fmtNum(kpis.enCours)} accent={C.jaune} />
            <Kpi label="Traités (corrigé / accepté)" value={`${fmtNum(kpis.traites)} · ${kpis.pct} %`} accent={C.vert} />
            <Kpi label="Nettoyables en masse" value={fmtNum(kpis.masse)} accent={C.violet} />
            <Kpi label="Plus d’un an" value={fmtNum(kpis.plus1an)} accent={C.sauge} />
            <Kpi
              label="Décalage de synchro (masqués)"
              value={fmtNum(kpis.decalage)}
              accent={C.gris}
              onClick={() => setAfficherDecalage((v) => !v)}
              hint={afficherDecalage ? 'Affichés — cliquer pour masquer' : 'Cliquer pour les afficher'}
            />
          </div>
          <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.texte2, marginBottom: 4 }}>Courbe de nettoyage (écarts hors décalage, 90 jours)</div>
            {historique.length < 2 ? (
              <div style={{ fontSize: 12, color: C.gris, padding: '28px 8px' }}>
                La courbe se construit à chaque calcul horaire : elle sera lisible dès demain.
              </div>
            ) : (
              <div style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historique} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.ligne} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: unknown) => fmtNum(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="STOCK" name="Stocks" stroke={C.sauge} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="CDF" name="CDF" stroke={C.sageBleu} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="CDC" name="CDC" stroke={C.violet} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        {kpis.decalage > 0 && !afficherDecalage && (
          <div style={{ fontSize: 12.5, color: C.texte2, background: '#F1EFE8', border: `1px dashed ${C.sauge}`, borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
            BLG est figé à la synchro de nuit ({fmtDateHeure(run?.blg_synchro)}), SAGE est relu en journée ({fmtDateHeure(run?.sage_synchro)}) :{' '}
            <b>{fmtNum(kpis.decalage)}</b> écart(s) portant sur une pièce ou un article qui a bougé dans SAGE depuis sont masqués.
            Le stock se compare idéalement tôt le matin.{' '}
            <button type="button" onClick={() => setAfficherDecalage(true)} style={lienBtn}>
              Les afficher
            </button>
          </div>
        )}

        {/* ---------------- Corps : types | liste ---------------- */}
        <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          {/* Types d'écart */}
          <aside style={{ position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}>
            <button
              type="button"
              onClick={() => setTypeCode('')}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                marginBottom: 10,
                border: `1px solid ${!typeCode ? C.marine : C.ligne}`,
                background: !typeCode ? C.marine : C.blanc,
                color: !typeCode ? C.creme : C.marine,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13.5,
              }}
            >
              Tous les types ({fmtNum(kpis.nb)})
            </button>
            {typesParSysteme.map((g) => (
              <div key={g.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: g.color, margin: '0 2px 6px' }}>{g.label}</div>
                {g.types.map((t) => (
                  <TypeCarte key={t.code} t={t} actif={t.code === typeCode} couleur={g.color} fond={g.bg} avecDecalage={afficherDecalage} onClick={() => setTypeCode(t.code === typeCode ? '' : t.code)} />
                ))}
              </div>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: C.texte2, padding: '4px 2px' }}>
              <input type="checkbox" checked={afficherInfos} onChange={(e) => setAfficherInfos(e.target.checked)} />
              Afficher les écarts d’information (rien à corriger)
            </label>
          </aside>

          {/* Liste */}
          <section style={{ minWidth: 0 }}>
            {typeActif && (
              <div
                style={{
                  background: C.blanc,
                  border: `1px solid ${C.ligne}`,
                  borderLeft: `5px solid ${SYSTEME_PAR_CLE[typeActif.systeme_a_corriger].color}`,
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 18, fontWeight: 600, margin: 0 }}>{typeActif.libelle}</h2>
                  <Pastille couleur={SYSTEME_PAR_CLE[typeActif.systeme_a_corriger].color}>{SYSTEME_PAR_CLE[typeActif.systeme_a_corriger].label}</Pastille>
                  <Pastille couleur={GRAVITE_LIB[typeActif.gravite]?.color ?? C.gris}>{GRAVITE_LIB[typeActif.gravite]?.label}</Pastille>
                  {typeActif.nettoyage_masse && <Pastille couleur={C.violet}>Nettoyage en masse possible</Pastille>}
                </div>
                {typeActif.description && <p style={{ fontSize: 13, color: C.texte2, margin: '8px 0 6px' }}>{typeActif.description}</p>}
                <div style={{ fontSize: 13.5, background: SYSTEME_PAR_CLE[typeActif.systeme_a_corriger].bg, borderRadius: 8, padding: '8px 10px' }}>
                  <b>Action : </b>
                  {typeActif.action}
                </div>
              </div>
            )}

            {/* Filtres */}
            <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: `minmax(220px, 2fr) repeat(${domaine === 'STOCK' ? 3 : 4}, minmax(150px, 1fr))`, gap: 10 }}>
                <input
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder={domaine === 'STOCK' ? 'Référence, désignation, dépôt…' : 'N° de pièce, référence, client / fournisseur…'}
                  style={inputStyle}
                />
                <select value={depot} onChange={(e) => setDepot(e.target.value)} style={inputStyle}>
                  <option value="">{domaine === 'CDC' ? 'Dépôt / agence : tous' : 'Dépôt : tous'}</option>
                  {depotsDomaine.map((d) => (
                    <option key={d.depot} value={d.depot}>
                      {d.depot} ({fmtNum(d.nb)})
                    </option>
                  ))}
                </select>
                <select value={age} onChange={(e) => setAge(e.target.value)} style={inputStyle}>
                  {AGES.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.key ? `Âge : ${a.label}` : 'Âge : tous'}
                    </option>
                  ))}
                </select>
                <select value={suiviFiltre} onChange={(e) => setSuiviFiltre(e.target.value as typeof suiviFiltre)} style={inputStyle}>
                  <option value="ouverts">Suivi : à traiter + en cours</option>
                  <option value="">Suivi : tous</option>
                  {SUIVIS.map((s) => (
                    <option key={s.key} value={s.key}>
                      Suivi : {s.label}
                    </option>
                  ))}
                </select>
                {domaine !== 'STOCK' && (
                  <select
                    value={archiveFiltre}
                    onChange={(e) => setArchiveFiltre(e.target.value as ArchiveFiltre)}
                    style={inputStyle}
                    title="Commande archivée dans BLG (motif d’archivage renseigné)"
                  >
                    <option value="">Archivée BLG : tous</option>
                    <option value="oui">Archivée BLG : oui</option>
                    <option value="non">Archivée BLG : non</option>
                  </select>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: C.texte2 }}>
                  {loadingRows ? 'Chargement…' : `${fmtNum(total)} écart${total > 1 ? 's' : ''}`}
                  {selection.size > 0 && <b style={{ color: C.marine }}> · {fmtNum(selection.size)} sélectionné(s)</b>}
                </span>
                <button type="button" onClick={() => void selectionnerTout()} style={btnLien} disabled={!total}>
                  Tout sélectionner ({fmtNum(Math.min(total, 5000))})
                </button>
                {selection.size > 0 && (
                  <button type="button" onClick={() => setSelection(new Set())} style={btnLien}>
                    Vider la sélection
                  </button>
                )}
                <div style={{ flex: 1 }} />
                {selection.size > 0 && (
                  <>
                    <button type="button" onClick={() => void marquerSelection('en_cours')} style={{ ...btnSecondaire, borderColor: C.jaune, color: C.jaune }}>
                      En cours
                    </button>
                    <button type="button" onClick={() => void marquerSelection('corrige')} style={{ ...btnSecondaire, borderColor: C.vert, color: C.vert }}>
                      ✓ Corrigé
                    </button>
                    <button type="button" onClick={() => void marquerSelection('accepte')} style={{ ...btnSecondaire, borderColor: C.gris, color: C.gris }}>
                      Accepter l’écart
                    </button>
                    <button type="button" onClick={() => void marquerSelection('a_traiter')} style={btnSecondaire}>
                      Remettre à traiter
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void exporter()} disabled={exporting || !total} style={btnExport}>
                  {exporting ? 'Export…' : `↓ Excel (${fmtNum(total)})`}
                </button>
              </div>
            </div>

            {/* Tableau */}
            <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto', maxHeight: '68vh', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 30 }}>
                        <input
                          type="checkbox"
                          checked={toutCoche}
                          onChange={() => {
                            const n = new Set(selection);
                            if (toutCoche) rows.forEach((r) => n.delete(r.cle));
                            else rows.forEach((r) => n.add(r.cle));
                            setSelection(n);
                          }}
                        />
                      </th>
                      {!typeCode && <th style={th}>Type d’écart</th>}
                      {domaine !== 'STOCK' && (
                        <Th k="document" sortKey={sortKey} asc={sortAsc} onSort={trier}>
                          Pièce
                        </Th>
                      )}
                      {niveau === 'LIGNE' && (
                        <Th k="reference_article" sortKey={sortKey} asc={sortAsc} onSort={trier}>
                          Article
                        </Th>
                      )}
                      <Th k="depot" sortKey={sortKey} asc={sortAsc} onSort={trier}>
                        {domaine === 'CDC' ? 'Dépôt / agence' : 'Dépôt'}
                      </Th>
                      {domaine !== 'STOCK' && (
                        <Th k="tiers_nom" sortKey={sortKey} asc={sortAsc} onSort={trier}>
                          {domaine === 'CDF' ? 'Fournisseur' : 'Client'}
                        </Th>
                      )}
                      {domaine !== 'STOCK' && (
                        <Th k="age_jours" sortKey={sortKey} asc={sortAsc} onSort={trier} right>
                          Âge
                        </Th>
                      )}
                      <th style={{ ...th, background: C.sageBleu }}>Situation SAGE</th>
                      <th style={{ ...th, background: C.violet }}>Situation BLG</th>
                      <Th k="ecart_qte" sortKey={sortKey} asc={sortAsc} onSort={trier} right>
                        Écart qté
                      </Th>
                      <Th k="valeur_ht" sortKey={sortKey} asc={sortAsc} onSort={trier} right>
                        Valeur
                      </Th>
                      <th style={th}>Suivi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const sel = selection.has(r.cle);
                      return (
                        <tr key={r.id} className="rappro-row" style={{ background: sel ? '#FFF6E8' : undefined, cursor: 'pointer' }} onClick={() => setDetail(r)}>
                          <td style={td} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => {
                                const n = new Set(selection);
                                if (sel) n.delete(r.cle);
                                else n.add(r.cle);
                                setSelection(n);
                              }}
                            />
                          </td>
                          {!typeCode && (
                            <td style={{ ...td, maxWidth: 230, whiteSpace: 'normal' }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: SYSTEME_PAR_CLE[r.systeme_a_corriger]?.color, marginRight: 6 }} />
                              <span style={{ fontSize: 12 }}>{r.type_libelle}</span>
                            </td>
                          )}
                          {domaine !== 'STOCK' && (
                            <td style={{ ...td, fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>
                              {r.lien_blg ? (
                                <a href={r.lien_blg} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }} title="Ouvrir dans BLG">
                                  {r.document} <span style={{ fontSize: '0.75em', opacity: 0.55 }}>↗</span>
                                </a>
                              ) : (
                                r.document ?? '—'
                              )}
                              {r.probable_decalage && <DecalageTag />}
                            </td>
                          )}
                          {niveau === 'LIGNE' && (
                          <td style={{ ...td, maxWidth: 300 }}>
                            <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, fontWeight: 600 }}>
                              {domaine === 'STOCK' && r.lien_blg ? (
                                <a href={r.lien_blg} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>
                                  {r.reference_article} <span style={{ fontSize: '0.75em', opacity: 0.55 }}>↗</span>
                                </a>
                              ) : (
                                r.reference_article ?? (domaine === 'STOCK' ? '—' : <span style={{ color: C.gris, fontFamily: 'inherit' }}>pièce entière</span>)
                              )}
                              {domaine === 'STOCK' && r.probable_decalage && <DecalageTag />}
                            </div>
                            {r.designation && (
                              <div style={{ fontSize: 11.5, color: C.texte2, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.designation}>
                                {r.designation}
                              </div>
                            )}
                          </td>
                          )}
                          <td style={{ ...td, fontSize: 12 }}>{r.depot ?? '—'}</td>
                          {domaine !== 'STOCK' && (
                            <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.tiers_nom ?? ''}>
                              <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}>{r.tiers_code ?? ''}</span> <span style={{ color: C.texte2 }}>{r.tiers_nom ?? ''}</span>
                            </td>
                          )}
                          {domaine !== 'STOCK' && (
                            <td style={{ ...td, textAlign: 'right', color: (r.age_jours ?? 0) > 365 ? C.rouge : C.marine }} title={fmtDate(r.date_document)}>
                              {r.age_jours == null ? '—' : r.age_jours > 365 ? `${fmtNum(r.age_jours / 365, 1)} an` : `${r.age_jours} j`}
                            </td>
                          )}
                          <td style={{ ...td, fontSize: 12, color: C.sageBleu, maxWidth: 240, whiteSpace: 'normal' }}>{r.statut_sage ?? '—'}</td>
                          <td style={{ ...td, fontSize: 12, color: C.violet, maxWidth: 240, whiteSpace: 'normal' }}>
                            {r.statut_blg ?? '—'}
                            {r.blg_archive && (
                              <span
                                title={r.blg_archive_motif ? `Motif : ${r.blg_archive_motif}` : undefined}
                                style={{ display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, color: C.gris, background: '#F1EFE8', border: `1px solid ${C.ligne}` }}
                              >
                                Archivée
                              </span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: Number(r.ecart_qte) > 0 ? C.sageBleu : Number(r.ecart_qte) < 0 ? C.violet : C.gris }}>
                            {r.ecart_qte == null ? '—' : `${Number(r.ecart_qte) > 0 ? '+' : ''}${fmtNum(r.ecart_qte, 2)}`}
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>{r.valeur_ht ? fmtEUR(r.valeur_ht) : '—'}</td>
                          <td style={td}>
                            <SuiviTag s={r.suivi_statut} titre={r.suivi_commentaire ?? undefined} />
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingRows && rows.length === 0 && (
                      <tr>
                        <td colSpan={12} style={{ ...td, textAlign: 'center', padding: 40, color: C.gris }}>
                          {typeCode ? 'Aucun écart de ce type avec ces filtres. ' : 'Aucun écart avec ces filtres. '}
                          {!afficherDecalage && kpis.decalage > 0 && 'Les écarts de décalage de synchro sont masqués.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderTop: `1px solid ${C.ligne}`, fontSize: 13 }}>
                <span>
                  Page {page + 1} / {nbPages} · {domaine === 'STOCK' ? 'écart qté = stock SAGE − stock BLG' : 'écart qté = SAGE − BLG sur la quantité comparée'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(0)} disabled={page === 0} style={btnSecondaire}>
                    «
                  </button>
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={btnSecondaire}>
                    ‹
                  </button>
                  <button onClick={() => setPage((p) => Math.min(nbPages - 1, p + 1))} disabled={page >= nbPages - 1} style={btnSecondaire}>
                    ›
                  </button>
                  <button onClick={() => setPage(nbPages - 1)} disabled={page >= nbPages - 1} style={btnSecondaire}>
                    »
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style>{`.rappro-row:hover td { background: #FAF8F2; }`}</style>

      {detail && (
        <FicheEcart
          e={detail}
          onClose={() => setDetail(null)}
          onOpen={(x) => setDetail(x)}
          onVoirLignes={voirLignes}
          onSuivi={async (statut, commentaire) => {
            await marquer([detail.cle], statut, commentaire);
            setDetail({ ...detail, suivi_statut: statut, suivi_commentaire: commentaire ?? detail.suivi_commentaire });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fiche d'un écart (panneau latéral)
// ---------------------------------------------------------------------
function FicheEcart({
  e,
  onClose,
  onOpen,
  onVoirLignes,
  onSuivi,
}: {
  e: Ecart;
  onClose: () => void;
  onOpen: (x: Ecart) => void;
  onVoirLignes: (document: string) => void;
  onSuivi: (statut: Suivi, commentaire: string | null) => Promise<void>;
}) {
  const [lies, setLies] = useState<Ecart[]>([]);
  const [commentaire, setCommentaire] = useState(e.suivi_commentaire ?? '');
  const [saving, setSaving] = useState(false);
  const sys = SYSTEME_PAR_CLE[e.systeme_a_corriger];

  useEffect(() => {
    setCommentaire(e.suivi_commentaire ?? '');
    let annule = false;
    (async () => {
      // écarts liés : même pièce (CDF/CDC) ou mêmes flux pour l'article (stock)
      let q = supabase.from('v_rappro_ecarts').select('*').neq('id', e.id).limit(60);
      if (e.domaine === 'STOCK') {
        if (!e.reference_article) return;
        q = q.eq('reference_article', e.reference_article).in('domaine', ['CDF', 'CDC', 'STOCK']);
      } else {
        if (!e.document) return;
        q = q.eq('document', e.document);
      }
      const { data } = await q;
      if (!annule) setLies((data ?? []) as unknown as Ecart[]);
    })();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      annule = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [e, onClose]);

  const entrees = Object.entries(e.detail ?? {}).filter(([, v]) => v !== null && v !== '' && v !== false);
  const sageEntrees = entrees.filter(([k]) => k.startsWith('sage_') || k.startsWith('explique') || k.startsWith('mouvement'));
  const blgEntrees = entrees.filter(([k]) => k.startsWith('blg_'));
  const autres = entrees.filter(([k]) => !k.startsWith('sage_') && !k.startsWith('blg_') && !k.startsWith('explique') && !k.startsWith('mouvement'));

  async function suivi(statut: Suivi) {
    setSaving(true);
    await onSuivi(statut, commentaire.trim() || null);
    setSaving(false);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{ width: 'min(760px, 100%)', height: '100%', background: C.creme, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(0,0,0,0.25)' }}
      >
        <div style={{ background: C.marine, color: C.creme, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.sauge }}>
                {DOMAINES.find((d) => d.key === e.domaine)?.label} · {e.type_libelle}
              </div>
              <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                {e.document ?? e.reference_article ?? e.cle}
                {e.document && e.reference_article && <span style={{ fontSize: 15, opacity: 0.7 }}> · {e.reference_article}</span>}
              </div>
              <div style={{ fontSize: 13, color: '#B8B2A0', marginTop: 2 }}>
                {[e.tiers_code, e.tiers_nom, e.depot, e.date_document ? `du ${fmtDate(e.date_document)}` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(245,243,236,0.35)', color: C.creme, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
              Fermer (Échap)
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {e.lien_blg && (
              <a href={e.lien_blg} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#C9BFE6', textDecoration: 'none', fontWeight: 600 }}>
                Ouvrir dans BLG ↗
              </a>
            )}
            {e.niveau === 'ENTETE' && e.document && (
              <button
                type="button"
                onClick={() => onVoirLignes(e.document as string)}
                style={{ background: 'transparent', border: '1px solid rgba(245,243,236,0.35)', color: C.creme, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
              >
                Voir les lignes de cette commande →
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Quoi faire */}
          <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderLeft: `5px solid ${sys.color}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <Pastille couleur={sys.color}>{sys.label}</Pastille>
              <Pastille couleur={GRAVITE_LIB[e.gravite]?.color ?? C.gris}>{GRAVITE_LIB[e.gravite]?.label}</Pastille>
              {e.nettoyage_masse && <Pastille couleur={C.violet}>Nettoyage en masse possible</Pastille>}
              {e.probable_decalage && <Pastille couleur={C.gris}>Décalage de synchro probable</Pastille>}
            </div>
            <div style={{ fontSize: 14 }}>
              <b>Action : </b>
              {e.action}
            </div>
          </div>

          {/* Face à face */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Cote titre="SAGE" couleur={C.sageBleu} situation={e.statut_sage} qte={e.qte_sage} lignes={sageEntrees} />
            <Cote titre="BLG" couleur={C.violet} situation={e.statut_blg} qte={e.qte_blg} lignes={blgEntrees} />
          </div>
          <div style={{ display: 'flex', gap: 18, fontSize: 13, marginBottom: 14, flexWrap: 'wrap' }}>
            <span>
              Écart (SAGE − BLG) : <b>{e.ecart_qte == null ? '—' : fmtNum(e.ecart_qte, 2)}</b>
            </span>
            <span>
              Valeur : <b>{fmtEUR(e.valeur_ht)}</b>
            </span>
            {e.age_jours != null && (
              <span>
                Âge : <b>{e.age_jours} j</b>
              </span>
            )}
          </div>
          {autres.length > 0 && (
            <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 12.5 }}>
              {autres.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
                  <span style={{ color: C.gris }}>{DETAIL_LABELS[k] ?? k}</span>
                  <span style={{ fontWeight: 500 }}>{fmtVal(v)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Suivi */}
          <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <b style={{ fontSize: 13.5 }}>Suivi du nettoyage</b>
              <SuiviTag s={e.suivi_statut} />
              {e.suivi_par && (
                <span style={{ fontSize: 11.5, color: C.gris }}>
                  par {e.suivi_par} le {fmtDateHeure(e.suivi_le)}
                </span>
              )}
            </div>
            <textarea
              value={commentaire}
              onChange={(ev) => setCommentaire(ev.target.value)}
              placeholder="Commentaire (ce qui a été fait, pourquoi l'écart est accepté…)"
              rows={2}
              style={{ ...inputStyle, height: 'auto', padding: 8, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {SUIVIS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  disabled={saving}
                  onClick={() => void suivi(s.key)}
                  style={{ ...btnSecondaire, borderColor: s.color, color: e.suivi_statut === s.key ? C.blanc : s.color, background: e.suivi_statut === s.key ? s.color : C.blanc }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: C.gris, marginTop: 6 }}>
              « Corrigé » : l’écart disparaît de lui-même au prochain calcul si la correction est remontée ; s’il réapparaît, il reste visible avec ce statut.
            </div>
          </div>

          {/* Écarts liés */}
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
              {e.domaine === 'STOCK' ? 'Autres écarts sur cet article (stocks, CDF, CDC)' : 'Autres écarts sur la même pièce'} ({lies.length})
            </div>
            {lies.length === 0 ? (
              <div style={{ fontSize: 12.5, color: C.gris }}>Aucun.</div>
            ) : (
              <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderRadius: 10, overflow: 'hidden' }}>
                {lies.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onOpen(l)}
                    style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 10, padding: '8px 12px', border: 'none', borderBottom: `1px solid ${C.ligne}`, background: 'transparent', cursor: 'pointer', fontSize: 12.5 }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, flex: 'none', background: SYSTEME_PAR_CLE[l.systeme_a_corriger]?.color }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{l.type_libelle}</b>
                      <span style={{ color: C.texte2 }}>
                        {' '}
                        · {[l.domaine, l.niveau === 'ENTETE' ? 'entête' : null, l.document, l.reference_article, l.depot].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.ecart_qte == null ? '' : fmtNum(l.ecart_qte, 2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cote({ titre, couleur, situation, qte, lignes }: { titre: string; couleur: string; situation: string | null; qte: number | null; lignes: [string, unknown][] }) {
  return (
    <div style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderTop: `4px solid ${couleur}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b style={{ color: couleur, fontFamily: '"Space Grotesk", sans-serif', fontSize: 15 }}>{titre}</b>
        <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 20, fontWeight: 600 }}>{qte == null ? '—' : fmtNum(qte, 2)}</span>
      </div>
      <div style={{ fontSize: 12.5, margin: '4px 0 8px' }}>{situation ?? '—'}</div>
      {lignes.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '2px 0', borderTop: `1px dashed ${C.ligne}` }}>
          <span style={{ color: C.gris }}>{(DETAIL_LABELS[k] ?? k).replace(/^(SAGE|BLG) — /, '')}</span>
          <span style={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{fmtVal(v)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Petits composants
// ---------------------------------------------------------------------
function TypeCarte({ t, actif, couleur, fond, avecDecalage, onClick }: { t: TypeSynthese; actif: boolean; couleur: string; fond: string; avecDecalage: boolean; onClick: () => void }) {
  const nb = t.nb + (avecDecalage ? t.nb_decalage : 0);
  const traites = t.nb_corrige + t.nb_accepte;
  const pct = t.nb ? Math.round((traites / t.nb) * 100) : 0;
  const vide = nb === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={t.description ?? ''}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 11px',
        marginBottom: 6,
        borderRadius: 10,
        border: `1px solid ${actif ? couleur : C.ligne}`,
        boxShadow: actif ? `0 0 0 2px ${couleur}33` : 'none',
        background: actif ? fond : C.blanc,
        cursor: 'pointer',
        opacity: vide ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.marine, lineHeight: 1.3 }}>{t.libelle}</span>
        <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 17, fontWeight: 600, color: vide ? C.vert : couleur }}>{vide ? '✓' : fmtNum(nb)}</span>
      </div>
      {!vide && (
        <>
          <div style={{ display: 'flex', gap: 10, fontSize: 11.5, color: C.texte2, marginTop: 3, flexWrap: 'wrap' }}>
            {t.domaine !== 'STOCK' && <span>{fmtNum(t.nb_documents)} pièce(s)</span>}
            {Number(t.valeur_ht) > 0 && <span>{fmtEUR(t.valeur_ht)}</span>}
            {t.nb_decalage > 0 && !avecDecalage && <span>+{fmtNum(t.nb_decalage)} décalage</span>}
            {t.nettoyage_masse && <span style={{ color: C.violet, fontWeight: 600 }}>masse</span>}
          </div>
          {t.nb > 0 && (
            <div style={{ height: 4, background: '#EEEAE0', borderRadius: 2, marginTop: 6, overflow: 'hidden' }} title={`${traites} traité(s) sur ${t.nb}`}>
              <div style={{ width: `${pct}%`, height: '100%', background: C.vert }} />
            </div>
          )}
        </>
      )}
    </button>
  );
}

function Th({ k, sortKey, asc, onSort, right, children }: { k: SortKey; sortKey: SortKey; asc: boolean; onSort: (k: SortKey) => void; right?: boolean; children: React.ReactNode }) {
  const actif = k === sortKey;
  return (
    <th onClick={() => onSort(k)} style={{ ...th, cursor: 'pointer', textAlign: right ? 'right' : 'left', userSelect: 'none' }}>
      {children}
      <span style={{ marginLeft: 4, fontSize: 10, opacity: actif ? 1 : 0.35 }}>{actif ? (asc ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}

function Kpi({ label, value, accent, onClick, hint }: { label: string; value: string; accent: string; onClick?: () => void; hint?: string }) {
  return (
    <div
      onClick={onClick}
      title={hint}
      style={{ background: C.blanc, border: `1px solid ${C.ligne}`, borderLeft: `4px solid ${accent}`, borderRadius: 10, padding: '10px 12px', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ fontSize: 11.5, color: C.gris, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: '"Space Grotesk", sans-serif', fontSize: 19, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Pastille({ couleur, children }: { couleur: string; children: React.ReactNode }) {
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: C.blanc, background: couleur, whiteSpace: 'nowrap' }}>{children}</span>;
}

function SuiviTag({ s, titre }: { s: Suivi; titre?: string }) {
  const x = SUIVI_PAR_CLE[s] ?? SUIVI_PAR_CLE.a_traiter;
  return (
    <span title={titre} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, color: x.color, border: `1px solid ${x.color}55`, whiteSpace: 'nowrap' }}>
      {x.label.replace(' (attend la synchro)', '')}
      {titre ? ' ✎' : ''}
    </span>
  );
}

function DecalageTag() {
  return (
    <span title="La pièce ou l'article a bougé dans SAGE depuis la dernière synchro BLG : l'écart disparaîtra probablement demain" style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: C.gris, border: `1px dashed ${C.gris}`, borderRadius: 5, padding: '0 4px' }}>
      synchro
    </span>
  );
}

function Bandeau({ couleur, fond, onClose, children }: { couleur: string; fond: string; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: fond, border: `1px solid ${couleur}`, color: couleur, padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13.5, display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ flex: 1 }}>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: couleur, cursor: 'pointer', fontSize: 15 }}>
          ✕
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------
const inputStyle: React.CSSProperties = {
  border: `1px solid ${C.ligne}`,
  borderRadius: 8,
  padding: '0 10px',
  height: 36,
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
  background: C.blanc,
  color: C.marine,
};
const btnSecondaire: React.CSSProperties = {
  background: C.blanc,
  color: C.marine,
  border: `1px solid ${C.ligne}`,
  borderRadius: 8,
  padding: '7px 13px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
};
const btnPrimaire: React.CSSProperties = { ...btnSecondaire, background: C.marine, color: C.creme, borderColor: C.marine };
const btnExport: React.CSSProperties = { ...btnSecondaire, background: C.violet, color: C.blanc, borderColor: C.violet };
const btnLien: React.CSSProperties = { border: 'none', background: 'transparent', color: C.alerte, fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: 0 };
const lienBtn: React.CSSProperties = { ...btnLien, textDecoration: 'underline' };
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '9px 10px',
  background: C.marine,
  color: C.creme,
  fontWeight: 500,
  fontSize: 12,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};
const td: React.CSSProperties = { padding: '7px 10px', borderBottom: `1px solid ${C.ligne}`, verticalAlign: 'top', whiteSpace: 'nowrap' };
