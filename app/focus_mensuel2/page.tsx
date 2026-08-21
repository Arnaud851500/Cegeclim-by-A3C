"use client";

/**
 * FOCUS MENSUEL — V3 (gabarit à onglets, pleine largeur, bandeau escamotable)
 * ------------------------------------------------------------------------
 * IMPORTANT — Cette page N'A PAS de logique de calcul propre pour les
 * tableaux comparatifs : elle importe et réutilise TEL QUEL les fonctions
 * et composants de app/focus_mensuel/page.tsx (exports ajoutés à cette fin,
 * changement purement additif qui ne modifie rien à la page existante).
 * Objectif : garantir des chiffres strictement identiques entre l'ancienne
 * et la nouvelle page, sans dupliquer/réinventer le calcul.
 *
 * Onglet "Portefeuille & projection" : NON câblé dans cette V3. Il dépend
 * d'une chaîne de fonctions (buildProjectionCaByAgency, jours ouvrés,
 * activite_lignes...) trop profonde pour être branchée à l'aveugle sans
 * pouvoir exécuter l'app et vérifier les chiffres. Voir le placeholder en
 * bas de fichier — à finaliser ensemble une fois cette base validée.
 *
 * MOBILE — Sur téléphone (largeur < 768px), cette page bascule désormais
 * vers MobileShell (le menu d'accueil mobile), et non plus directement vers
 * MobileStandaloneActivite. Ouvrir cette URL sur mobile ramène donc
 * l'utilisateur au menu ("Mon activité" / "Mes clients" / "Mes rdv" /
 * "Mes alertes"), à charge pour lui de taper "Mon activité" s'il veut cet
 * écran précis — cohérent avec la navigation mobile du reste de l'app,
 * plutôt qu'un court-circuit direct vers un seul écran.
 * ------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";
import { usePageFilterAccess } from "@/lib/pageAccessFilters";
import { useViewport } from "@/lib/useViewport";
import MobileShell from "@/components/mobile/MobileShell";
import LastSyncBadge from "@/components/LastSyncBadge";

// ---- Réutilisation stricte de la page existante (mêmes calculs) ----------
import {
  DOC_TYPES,
  DOC_COLORS,
  type DailyRow,
  type HighlightRow,
  type ComparisonRow,
  type DocType,
  type AnnualCacheRpcRow,
  type AgencyControlRpcRow,
  type AgencyPortfolioRow,
  type AgencyProjectionRow,
  formatMoney,
  aggregateComparisonRows,
  buildComparisonRowsFromAnnualCache,
  HighlightTable,
  ActivityByAgencyComparisonTable,
  ActivityByFamilyComparisonTable,
  Rolling12ComparisonTable,
} from "../focus_mensuel/page";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

const TABS = [
  { key: "vue", label: "Vue d'ensemble" },
  { key: "agence", label: "Comparatif agence" },
  { key: "famille", label: "Comparatif famille" },
  { key: "rolling", label: "Rolling 12 mois" },
  { key: "faits", label: "Faits marquants" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Hauteur commune aux 3 cartes de la vue d'ensemble. Dimensionnée pour
// afficher le portefeuille et la projection sans ascenseur interne dans le
// cas courant (~16 agences + ligne TOTAL).
const OVERVIEW_CARD_MIN_HEIGHT = 660;

// ---------------------------------------------------------------------------
// Utilitaires de dates locales à V3 (uniquement pour construire les plages
// de requête RPC — n'affecte pas la logique de calcul réutilisée)
// ---------------------------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function monthBounds(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  return {
    debut: ymd(new Date(Date.UTC(y, m - 1, 1))),
    fin: ymd(new Date(Date.UTC(y, m, 0))),
  };
}
function shiftMonth(monthStr: string, delta: number) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function last12Months(monthStr: string): string[] {
  return Array.from({ length: 12 }, (_, i) => shiftMonth(monthStr, i - 11));
}

// ---------------------------------------------------------------------------
// Bandeau supérieur escamotable au scroll
// ---------------------------------------------------------------------------

/**
 * Suit le bord bas RÉEL et VISIBLE du bandeau de navigation du site, qui
 * s'escamote lui-même au scroll via translateY. On s'y ancre en `sticky` au
 * lieu de repositionner ce bandeau de page en `fixed` : un élément fixe se
 * superpose au bandeau du site (il devenait inaccessible) et impose une cale
 * de compensation qui, elle, laissait une bande vide. En `sticky`, l'élément
 * reste dans le flux : aucun vide n'est possible, et le bandeau de page
 * remonte naturellement en haut de l'écran quand celui du site disparaît.
 *
 * Même mécanique que la page Projections stock — comportement homogène entre
 * les deux écrans.
 */
function useSiteHeaderOffset() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const el = document.querySelector('[data-cegeclim-header="true"]') as HTMLElement | null;
    if (!el) return;

    let raf = 0;

    function measure() {
      raf = 0;
      const rect = el!.getBoundingClientRect();
      const next = Math.max(0, rect.bottom);
      setOffset((prev) => (prev === next ? prev : next));
    }

    // Une seule mesure par frame au maximum, déclenchée par un vrai événement
    // (scroll/resize/redimensionnement du bandeau) — plus de boucle perpétuelle.
    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    }

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
    };
  }, []);

  return offset;
}

/**
 * Remplace le « Factures N » du mois en cours — encore partiel puisqu'on n'est
 * pas en fin de mois — par la projection de CA déjà calculée pour le widget
 * agences, et répercute le même écart sur la ligne TOTAL.
 *
 * Exportée pour que la route d'impression applique EXACTEMENT la même
 * transformation que l'écran, plutôt que d'en recoder une variante.
 */
export function appliquerCaProjeteAuRolling(
  rollingRows: ComparisonRow[],
  agencyProjectionRows: AgencyProjectionRow[],
): ComparisonRow[] {
  if (rollingRows.length === 0) return rollingRows;

  const totalRow = agencyProjectionRows.find((r) => r.label === "TOTAL");
  const projectedTotal = totalRow
    ? totalRow.projectionCa
    : agencyProjectionRows.reduce((s, r) => s + r.projectionCa, 0);

  const rows = [...rollingRows];
  let lastMonthIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i].label.toUpperCase().startsWith("TOTAL")) {
      lastMonthIdx = i;
      break;
    }
  }
  if (lastMonthIdx === -1) return rollingRows;

  const original = rows[lastMonthIdx];
  const delta = projectedTotal - (original.byType.Factures.amountN || 0);
  rows[lastMonthIdx] = {
    ...original,
    byType: { ...original.byType, Factures: { ...original.byType.Factures, amountN: projectedTotal } },
  };

  // Sans cette répercussion, la ligne TOTAL continuerait d'afficher l'ancien
  // montant réalisé partiel du mois en cours.
  const totalIdx = rows.findIndex((r) => r.label.toUpperCase().startsWith("TOTAL"));
  if (totalIdx !== -1) {
    const totalOriginal = rows[totalIdx];
    rows[totalIdx] = {
      ...totalOriginal,
      byType: {
        ...totalOriginal.byType,
        Factures: { ...totalOriginal.byType.Factures, amountN: (totalOriginal.byType.Factures.amountN || 0) + delta },
      },
    };
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FocusMensuel3Page() {
  const access = usePageFilterAccess();
  const headerOffset = useSiteHeaderOffset();

  // Bascule mobile : voir le bloc `if (isMobile)` juste avant le rendu
  // desktop, tout en bas de ce composant. Placée ici (avant tout hook) pour
  // pouvoir être lue par l'effet de chargement ci-dessous et éviter les
  // appels RPC desktop quand ils ne servent à rien sur mobile.
  const { isMobile } = useViewport();

  const [tab, setTab] = useState<TabKey>("vue");
  const [useProjectedCaInRolling, setUseProjectedCaInRolling] = useState(true);
  const [month, setMonth] = useState(currentMonthStr());
  const [focusDay, setFocusDay] = useState<string>(ymd(new Date()));

  // Change le jour focus ET aligne automatiquement le mois analysé sur le
  // mois du jour choisi, si un autre mois que celui affiché est sélectionné.
  function handleFocusDayChange(newDay: string) {
    if (!newDay) return;
    setFocusDay(newDay);
    const newMonth = newDay.slice(0, 7);
    setMonth((current) => (current !== newMonth ? newMonth : current));
  }
  const [agence, setAgence] = useState("");
  const [familleMacro, setFamilleMacro] = useState("");
  const [collaborateur, setCollaborateur] = useState("");
  const [includeHorsStats, setIncludeHorsStats] = useState(true);

  const [monthRows, setMonthRows] = useState<DailyRow[]>([]);
  const [monthRowsN1, setMonthRowsN1] = useState<DailyRow[]>([]);
  const [annualCacheRows, setAnnualCacheRows] = useState<AnnualCacheRpcRow[]>([]);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [agencyPortfolioRows, setAgencyPortfolioRows] = useState<AgencyPortfolioRow[]>([]);
  const [agencyProjectionRows, setAgencyProjectionRows] = useState<AgencyProjectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (access.loading) return;
    if (access.hasAgenceRestriction && access.allowedAgences.length > 0) setAgence(access.allowedAgences[0]);
    if (access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0) setCollaborateur(access.allowedCollaborateurs[0]);
  }, [access.loading, access.hasAgenceRestriction, access.hasCollaborateurRestriction]);

  useEffect(() => {
    if (access.loading) return;
    // Sur mobile, cette page rend désormais MobileShell (le menu), qui gère
    // son propre chargement — inutile de déclencher ici les 5 RPC desktop
    // (portefeuille, projection, highlights, comparatifs agence/famille,
    // rolling 12) qui ne seront jamais affichées dans ce cas.
    if (isMobile) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { debut, fin } = monthBounds(month);
        const monthN1 = shiftMonth(month, -12);
        const { debut: debutN1, fin: finN1 } = monthBounds(monthN1);

        const commonParams = {
          p_agence: agence || null,
          p_famille_macro: familleMacro || null,
          p_collaborateur: collaborateur || null,
          p_include_hors_statistiques: includeHorsStats,
        };

        // Mois courant / N-1 : plage étroite (1 mois), rapide sur la RPC brute.
        // Rolling 12 mois + comparatifs agence/famille : RPC pré-calculée
        // (cache), pas la RPC brute sur 12 mois — c'est elle qui causait le
        // timeout (activite_lignes scannée sans filtre de date à l'intérieur
        // de get_focus_mensuel_daily_summary_metier). Portefeuille/projection
        // par agence : même principe, RPC pré-calculée dédiée. Highlights :
        // limite remontée à 500 pour couvrir les TOP 20 par type de document
        // (onglet Faits marquants), pas seulement les 10 du bandeau d'alerte.
        const [monthRes, monthN1Res, annualRes, highlightsRes, agencyRes] = await Promise.all([
          supabase.rpc("get_focus_mensuel_daily_summary_metier", { p_date_debut: debut, p_date_fin: fin, ...commonParams }),
          supabase.rpc("get_focus_mensuel_daily_summary_metier", { p_date_debut: debutN1, p_date_fin: finN1, ...commonParams }),
          supabase.rpc("get_focus_mensuel_annual_tables_cached", { p_focus_date: focusDay, p_month: month, ...commonParams }),
          supabase.rpc("get_focus_mensuel_highlights", { p_date_debut: debut, p_date_fin: fin, p_limit: 500, ...commonParams }),
          supabase.rpc("get_focus_mensuel_agency_control_cached", { p_focus_date: focusDay, p_month: month, ...commonParams }),
        ]);

        for (const r of [monthRes, monthN1Res, annualRes, highlightsRes, agencyRes]) {
          if (r.error) throw r.error;
        }

        if (!cancelled) {
          setMonthRows((monthRes.data as DailyRow[]) || []);
          setMonthRowsN1((monthN1Res.data as DailyRow[]) || []);
          setAnnualCacheRows((annualRes.data as AnnualCacheRpcRow[]) || []);
          setHighlights((highlightsRes.data as HighlightRow[]) || []);

          const agencyRpcRows = (agencyRes.data as AgencyControlRpcRow[]) || [];
          setAgencyPortfolioRows(
            agencyRpcRows.map((row) => ({
              label: String(row.label || "Sans agence"),
              cdc: Number(row.cdc || 0),
              cdcLivMx: Number(row.cdc_liv_mx || 0),
              pl: Number(row.pl || 0),
              plLivMPlus: Number(row.pl_liv_mplus || 0),
              blMx: Number(row.blbr_mx || 0),
              brMx: 0,
              blM: Number(row.blbr_m || 0),
              brM: 0,
              total: Number(row.total || 0),
            })),
          );
          setAgencyProjectionRows(
            agencyRpcRows.map((row) => ({
              label: String(row.label || "Sans agence"),
              blBrMx: Number(row.blbr_mx || 0),
              blBrM: Number(row.blbr_m || 0),
              factures: Number(row.factures || 0),
              projectionFluxBl: Number(row.projection_flux_bl || 0),
              valeurBlNf3Pct: Number(row.valeur_bl_nf_4pct || 0),
              projectionCa: Number(row.projection_ca || 0),
              caN1: Number(row.ca_n1 || 0),
              evolPct: row.evol_pct === null || row.evol_pct === undefined ? null : Number(row.evol_pct),
            })),
          );
        }
      } catch (e) {
        console.error("[focus_mensuel3] erreur de chargement :", e);
        const message =
          e instanceof Error
            ? e.message
            : e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : JSON.stringify(e);
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [access.loading, isMobile, month, focusDay, agence, familleMacro, collaborateur, includeHorsStats]);

  const availableAgences = useMemo(() => {
    if (access.hasAgenceRestriction) return access.allowedAgences;
    return Array.from(new Set(monthRows.map((r) => r.agence || "").filter(Boolean))).sort();
  }, [access.hasAgenceRestriction, access.allowedAgences, monthRows]);

  const availableFamilies = useMemo(
    () => Array.from(new Set(monthRows.map((r) => r.famille_macro || "").filter(Boolean))).sort(),
    [monthRows],
  );

  const availableCollaborateurs = useMemo(() => {
    if (access.hasCollaborateurRestriction) return access.allowedCollaborateurs;
    return Array.from(new Set(monthRows.map((r) => r.collaborateur || "").filter(Boolean))).sort();
  }, [access.hasCollaborateurRestriction, access.allowedCollaborateurs, monthRows]);

  // ---- Calculs réutilisés tels quels (aggregateComparisonRows, etc.) ----
  // Agence / famille / rolling proviennent tous de la même RPC cache
  // (get_focus_mensuel_annual_tables_cached), passée à travers
  // buildComparisonRowsFromAnnualCache — exactement le mécanisme de la page
  // actuelle pour ces vues, pas une réécriture.

  const agencyComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, "agency_ytd"),
    [annualCacheRows],
  );

  const familyComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, "family_ytd"),
    [annualCacheRows],
  );

  // Month-to-date : mêmes jours du mois pour N et N-1 (1er au jour focus),
  // pour une comparaison équitable — monthRowsN1 couvre tout le mois N-1,
  // on le tronque au même quantième que le jour focus.
  const focusDayOfMonth = Number(focusDay.slice(8, 10));
  const monthRowsN1Mtd = useMemo(
    () => monthRowsN1.filter((r) => Number(r.jour.slice(8, 10)) <= focusDayOfMonth),
    [monthRowsN1, focusDayOfMonth],
  );

  const agencyComparisonRowsMtd: ComparisonRow[] = useMemo(
    () => aggregateComparisonRows(monthRows, monthRowsN1Mtd, (r) => r.agence || "—", (r) => r.agence || "—"),
    [monthRows, monthRowsN1Mtd],
  );

  const familyComparisonRowsMtd: ComparisonRow[] = useMemo(
    () => aggregateComparisonRows(monthRows, monthRowsN1Mtd, (r) => r.famille_macro || "—", (r) => r.famille_macro || "—"),
    [monthRows, monthRowsN1Mtd],
  );

  const rollingComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, "rolling_12"),
    [annualCacheRows],
  );

  // Bascule optionnelle : remplace le "Factures N" du mois en cours (encore
  // partiel puisqu'on n'est pas en fin de mois) par la projection CA déjà
  // calculée pour le widget 3 — même logique, pas de nouveau calcul.
  const rollingComparisonRowsDisplay: ComparisonRow[] = useMemo(
    () =>
      useProjectedCaInRolling
        ? appliquerCaProjeteAuRolling(rollingComparisonRows, agencyProjectionRows)
        : rollingComparisonRows,
    [rollingComparisonRows, useProjectedCaInRolling, agencyProjectionRows],
  );

  const monthTotals = useMemo(() => {
    const totalRows = aggregateComparisonRows(monthRows, monthRowsN1, () => "TOTAL", () => "TOTAL");
    return totalRows[0] ?? null;
  }, [monthRows, monthRowsN1]);

  const monthLabel = useMemo(
    () => new Date(month + "-01").toLocaleDateString("fr-FR", { month: "long" }),
    [month],
  );

  // TOP 20 par type de document — highlights est déjà trié par montant_ht
  // décroissant côté RPC ; on filtre juste par type et on tranche à 20.
  const top20ByType = useMemo(() => {
    const byType: Record<"Devis" | "CDC" | "BL", HighlightRow[]> = { Devis: [], CDC: [], BL: [] };
    (["Devis", "CDC", "BL"] as const).forEach((t) => {
      byType[t] = highlights
        .filter((h) => h.type_document === t)
        .sort((a, b) => (b.montant_ht || 0) - (a.montant_ht || 0))
        .slice(0, 20);
    });
    return byType;
  }, [highlights]);

  const dayValueByType = useMemo(() => {
    const map: Record<DocType, number> = { Devis: 0, CDC: 0, BL: 0, Factures: 0 };
    monthRows
      .filter((r) => r.jour === focusDay)
      .forEach((r) => {
        if (r.type_document in map) map[r.type_document as DocType] += Number(r.montant_ht || 0);
      });
    return map;
  }, [monthRows, focusDay]);

  // Sparkline annuelle : dérivée du même rolling_12 mis en cache (pas d'appel
  // supplémentaire). On exclut la ligne "TOTAL 12 MOIS G." et on garde
  // l'ordre chronologique déjà trié par buildComparisonRowsFromAnnualCache.
  const annualSeriesByType = useMemo(() => {
    const monthlyRows = rollingComparisonRows.filter((r) => !r.label.startsWith("TOTAL"));
    const series: Record<DocType, number[]> = { Devis: [], CDC: [], BL: [], Factures: [] };
    DOC_TYPES.forEach((type) => {
      series[type] = monthlyRows.map((r) => r.byType[type]?.amountN || 0);
    });
    return series;
  }, [rollingComparisonRows]);

  const months12 = useMemo(() => last12Months(month), [month]);

  /**
   * Ouvre la route d'impression avec l'état exact de l'écran. Les paramètres
   * transitent par l'URL : le document reflète donc toujours ce qui est
   * affiché, et l'adresse reste partageable ou mémorisable en favori.
   */
  function ouvrirExportPdf() {
    const params = new URLSearchParams({
      jour: focusDay,
      mois: month,
      agence,
      famille: familleMacro,
      collaborateur,
      horsStats: includeHorsStats ? '1' : '0',
      caProjete: useProjectedCaInRolling ? '1' : '0',
    });
    window.open(`/focus_mensuel_print/nd?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  const focusDayLabel = useMemo(
    () => new Date(focusDay).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    [focusDay],
  );

  // Rendu mobile : atterrit désormais sur le MENU mobile (MobileShell),
  // et non plus directement sur l'écran "Mon activité". L'utilisateur
  // choisit explicitement où aller depuis le menu, comme pour toute autre
  // entrée du site consultée depuis un mobile. Court-circuite tout le
  // gabarit desktop à onglets ci-dessous.
  if (isMobile) {
    return <MobileShell />;
  }

  return (
    <div
      className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen w-full`}
      style={{ background: "#0B1220", fontFamily: "var(--font-body)" }}
    >
      {/* Les composants réutilisés (AgencyPortfolioTable, ActivityBy...ComparisonTable,
          HighlightTable, Rolling12ComparisonTable) rendent en blanc pur (#fff) via un
          style partagé de la page d'origine (styles.sectionCard) qu'on ne veut pas
          modifier là-bas. Surcharge locale, scopée à cette page uniquement. */}
      <style>{`.focus-pdf-section-card { background: #F5F3EC !important; }`}</style>

      {/* ---- Bandeau de page, ancré sous le bandeau de navigation du site ----
          Il reste dans le flux (sticky) : il ne masque jamais la navigation du
          site et ne peut pas laisser de bande vide au scroll. Quand le bandeau
          du site s'escamote, `headerOffset` tombe à 0 et celui-ci remonte tout
          en haut de l'écran. */}
      <div
        className="sticky z-20 border-b border-white/10 bg-[#0B1220]/95 backdrop-blur"
        style={{ top: headerOffset }}
      >
        <div className="w-full px-6 py-4 md:px-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em] text-[#A6A181]">
                CEGECLIM — Pilotage commercial
              </div>
              <h1 className="font-[var(--font-display)] text-2xl font-bold text-white md:text-3xl">
                Activité Quotidienne
              </h1>
              <div className="mt-1.5">
                <LastSyncBadge />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Jour focus</label>
                <input
                  type="date"
                  value={focusDay}
                  onChange={(e) => handleFocusDayChange(e.target.value)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]"
                />
                <button
                  onClick={() => handleFocusDayChange(ymd(new Date(Date.now() - 86400000)))}
                  className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/60 hover:text-white"
                >
                  Hier
                </button>
                <button
                  onClick={() => handleFocusDayChange(ymd(new Date()))}
                  className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/60 hover:text-white"
                >
                  Aujourd&rsquo;hui
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Mois analysé</label>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]"
                />
              </div>

              <button
                onClick={ouvrirExportPdf}
                title="Ouvre le document d'impression dans un nouvel onglet, avec le jour focus, le mois et les filtres en cours"
                className="rounded-lg bg-[#A6A181] px-3.5 py-1.5 text-sm font-semibold text-[#141A26] transition hover:brightness-110"
              >
                Exporter en PDF
              </button>
            </div>
          </div>

          {/* ---- Filtres globaux (partagés par tous les onglets) ---- */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <FilterSelect label="Agence" value={agence} onChange={setAgence} options={availableAgences} locked={access.hasAgenceRestriction} />
            <FilterSelect label="Famille" value={familleMacro} onChange={setFamilleMacro} options={availableFamilies} />
            <FilterSelect label="Collaborateur" value={collaborateur} onChange={setCollaborateur} options={availableCollaborateurs} locked={access.hasCollaborateurRestriction} />
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-white/60">
              <input type="checkbox" checked={includeHorsStats} onChange={(e) => setIncludeHorsStats(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#A6A181]" />
              Inclure les hors-statistiques
            </label>
          </div>

          {/* ---- Sous-onglets ---- */}
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.key ? "bg-[#F5F3EC] text-[#141A26]" : "text-white/50 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Contenu ---- */}
      <div className="w-full px-6 py-8 md:px-10">
        {error && (
          <div className="mb-6 rounded-lg border border-[#C1683C]/40 bg-[#C1683C]/10 px-4 py-3 text-sm text-[#e0a685]">
            Impossible de charger les données : {error}
          </div>
        )}

        {tab === "vue" && (
          <>
            <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {loading || !monthTotals
                ? DOC_TYPES.map((t) => <KpiSkeleton key={t} />)
                : DOC_TYPES.map((type) => (
                    <KpiCardJMA
                      key={type}
                      type={type}
                      dayValue={dayValueByType[type]}
                      dayLabel={focusDayLabel}
                      monthValue={monthTotals.byType[type].amountN}
                      monthValueN1={monthTotals.byType[type].amountN1}
                      annualSeries={annualSeriesByType[type]}
                      months={months12}
                    />
                  ))}
            </section>

            <section className="mb-8 grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
              <div
                className="flex flex-col rounded-xl border border-white/10 bg-[#F5F3EC] p-4"
                style={{ minHeight: OVERVIEW_CARD_MIN_HEIGHT }}
              >
                <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">
                  Cumul BL / CDC depuis le 1er {monthLabel}
                </h3>
                {loading ? (
                  <div className="min-h-0 flex-1 animate-pulse rounded-lg bg-black/[0.04]" />
                ) : (
                  <CumulativeBlCdcChart monthRows={monthRows} monthRowsN1={monthRowsN1} />
                )}
              </div>

              <TableShell loading={loading} minHeight={OVERVIEW_CARD_MIN_HEIGHT}>
                <PortfolioTableCompact rows={agencyPortfolioRows} />
              </TableShell>

              <TableShell loading={loading} minHeight={OVERVIEW_CARD_MIN_HEIGHT}>
                <ProjectionTableCompact rows={agencyProjectionRows} />
              </TableShell>
            </section>
          </>
        )}

        {tab === "agence" && (
          <div className="flex flex-col gap-6">
            <TableShell loading={loading}>
              <ActivityByAgencyComparisonTable
                title="Comparatif par agence — mois en cours (MTD) vs N-1"
                subtitle={`Du 1er au ${focusDayOfMonth} · Périmètre : ${agence || "toutes agences"} · ${familleMacro || "toutes familles"}`}
                rows={agencyComparisonRowsMtd}
                emptyMessage="Aucune donnée sur ce périmètre pour la période."
              />
            </TableShell>
            <TableShell loading={loading}>
              <ActivityByAgencyComparisonTable
                title="Comparatif par agence — cumul annuel (YTD) vs N-1"
                subtitle={`Périmètre : ${agence || "toutes agences"} · ${familleMacro || "toutes familles"}`}
                rows={agencyComparisonRows}
                emptyMessage="Aucune donnée sur ce périmètre pour la période."
              />
            </TableShell>
          </div>
        )}

        {tab === "famille" && (
          <div className="flex flex-col gap-6">
            <TableShell loading={loading}>
              <ActivityByFamilyComparisonTable
                title="Comparatif par famille — mois en cours (MTD) vs N-1"
                rows={familyComparisonRowsMtd}
                emptyMessage="Aucune donnée sur ce périmètre pour la période."
              />
            </TableShell>
            <TableShell loading={loading}>
              <ActivityByFamilyComparisonTable
                title="Comparatif par famille — cumul annuel (YTD) vs N-1"
                rows={familyComparisonRows}
                emptyMessage="Aucune donnée sur ce périmètre pour la période."
              />
            </TableShell>
          </div>
        )}

        {tab === "rolling" && (
          <TableShell loading={loading}>
            <div className="flex items-center gap-2 border-b border-black/10 bg-[#F5F3EC] px-3 pt-3 pb-1">
              <input
                type="checkbox"
                id="use-projected-ca"
                checked={useProjectedCaInRolling}
                onChange={(e) => setUseProjectedCaInRolling(e.target.checked)}
                className="h-4 w-4 rounded border-black/20 accent-[#A6A181]"
              />
              <label htmlFor="use-projected-ca" className="text-xs text-[#141A26]/70">
                Utiliser le CA projeté (au lieu du réalisé partiel) pour {monthLabel} — mois en cours de consultation
              </label>
            </div>
            <Rolling12ComparisonTable
              title="Rolling 12 mois — glissant vs N-1"
              subtitle={`${months12[0]} → ${months12[months12.length - 1]}`}
              rows={rollingComparisonRowsDisplay}
              emptyMessage="Aucune donnée sur les 12 derniers mois pour ce périmètre."
            />
          </TableShell>
        )}

        {tab === "faits" && (
          <div className="flex flex-col gap-6">
            <TableShell loading={loading}>
              <HighlightTable title="TOP 20 Devis" rows={top20ByType.Devis} />
            </TableShell>
            <TableShell loading={loading}>
              <HighlightTable title="TOP 20 CDC" rows={top20ByType.CDC} />
            </TableShell>
            <TableShell loading={loading}>
              <HighlightTable title="TOP 20 BL" rows={top20ByType.BL} />
            </TableShell>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget 1 — Cumul BL / CDC depuis le début du mois, N vs N-1
// ---------------------------------------------------------------------------

const CUMUL_BL_COLOR = "#4B92AC";
const CUMUL_CDC_COLOR = "#C1683C";

export function CumulativeBlCdcChart({ monthRows, monthRowsN1 }: { monthRows: DailyRow[]; monthRowsN1: DailyRow[] }) {
  const width = 560;
  const height = 300;
  const padding = { top: 12, right: 12, bottom: 26, left: 52 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Aligné par jour du mois (1..N), pas par date réelle, pour comparer N et
  // N-1 sur le même axe malgré le décalage d'un an.
  function cumulByDayOfMonth(rows: DailyRow[], type: "BL" | "CDC") {
    const byDay = new Map<number, number>();
    rows
      .filter((r) => r.type_document === type)
      .forEach((r) => {
        const day = Number(r.jour.slice(8, 10));
        byDay.set(day, (byDay.get(day) || 0) + Number(r.montant_ht || 0));
      });
    const maxDay = Math.max(1, ...Array.from(byDay.keys()));
    let running = 0;
    const series: number[] = [];
    for (let d = 1; d <= maxDay; d++) {
      running += byDay.get(d) || 0;
      series.push(running);
    }
    return series;
  }

  const blN = useMemo(() => cumulByDayOfMonth(monthRows, "BL"), [monthRows]);
  const cdcN = useMemo(() => cumulByDayOfMonth(monthRows, "CDC"), [monthRows]);
  const blN1 = useMemo(() => cumulByDayOfMonth(monthRowsN1, "BL"), [monthRowsN1]);
  const cdcN1 = useMemo(() => cumulByDayOfMonth(monthRowsN1, "CDC"), [monthRowsN1]);

  const maxDays = Math.max(blN.length, cdcN.length, blN1.length, cdcN1.length, 1);
  const maxVal = Math.max(1, ...blN, ...cdcN, ...blN1, ...cdcN1);
  const x = (i: number) => padding.left + (i / Math.max(1, maxDays - 1)) * innerW;
  const y = (v: number) => padding.top + innerH - (v / maxVal) * innerH;

  function path(series: number[]) {
    return series.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  }

  // Moyennes quotidiennes : total N (BL et CDC) rapporté au nombre de jours
  // avec expédition BL réelle (pas l'écart calendaire ni les jours avec
  // CDC), depuis le 1er du mois jusqu'au jour focus — les deux moyennes
  // partagent ce même dénominateur métier.
  const daysWithBL = useMemo(() => {
    const days = new Set<string>();
    monthRows.filter((r) => r.type_document === "BL").forEach((r) => days.add(r.jour));
    return days.size;
  }, [monthRows]);
  const blTotalN = blN.length ? blN[blN.length - 1] : 0;
  const cdcTotalN = cdcN.length ? cdcN[cdcN.length - 1] : 0;
  const blDailyAvgN = daysWithBL > 0 ? blTotalN / daysWithBL : 0;
  const cdcDailyAvgN = daysWithBL > 0 ? cdcTotalN / daysWithBL : 0;

  // Mêmes moyennes sur N-1, pour donner un point de comparaison plutôt qu'un
  // chiffre isolé — dénominateur construit à l'identique (jours avec BL).
  const daysWithBLN1 = useMemo(() => {
    const days = new Set<string>();
    monthRowsN1.filter((r) => r.type_document === "BL").forEach((r) => days.add(r.jour));
    return days.size;
  }, [monthRowsN1]);
  const blDailyAvgN1 = daysWithBLN1 > 0 && blN1.length ? blN1[blN1.length - 1] / daysWithBLN1 : 0;
  const cdcDailyAvgN1 = daysWithBLN1 > 0 && cdcN1.length ? cdcN1[cdcN1.length - 1] / daysWithBLN1 : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <YAxisMoney maxVal={maxVal} height={height} top={padding.top} innerH={innerH} />
        <path d={path(blN1)} fill="none" stroke={CUMUL_BL_COLOR} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.6} />
        <path d={path(cdcN1)} fill="none" stroke={CUMUL_CDC_COLOR} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.6} />
        <path d={path(blN)} fill="none" stroke={CUMUL_BL_COLOR} strokeWidth={2.5} />
        <path d={path(cdcN)} fill="none" stroke={CUMUL_CDC_COLOR} strokeWidth={2.5} />
        <line x1={padding.left} y1={y(0)} x2={width - padding.right} y2={y(0)} stroke="#00000022" />
        {Array.from({ length: maxDays }, (_, i) => i + 1).map((day, i) =>
          i % Math.ceil(maxDays / 10 || 1) === 0 ? (
            <text key={day} x={x(i)} y={height - padding.bottom + 16} fontSize={9} textAnchor="middle" fill="#141A26aa">
              {day}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-[#141A26]/50">
        <span><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: CUMUL_BL_COLOR }} /> BL (N)</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: CUMUL_CDC_COLOR }} /> CDC (N)</span>
        <span className="opacity-60">┄ N-1 (même couleur)</span>
      </div>

      {/* Bloc moyennes — développé pour occuper la hauteur laissée libre par
          le graphique et équilibrer la colonne face aux deux tableaux. */}
      <div className="mt-auto pt-4">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#141A26]/40">
          Moyennes quotidiennes · depuis le 1er du mois
        </div>
        <div className="grid grid-cols-2 gap-3">
          <AverageStat label="BL par jour" value={blDailyAvgN} valueN1={blDailyAvgN1} total={blTotalN} color={CUMUL_BL_COLOR} />
          <AverageStat label="CDC par jour" value={cdcDailyAvgN} valueN1={cdcDailyAvgN1} total={cdcTotalN} color={CUMUL_CDC_COLOR} />
        </div>
        <div className="mt-2 text-[10px] text-[#141A26]/40">
          Base : {daysWithBL} jour{daysWithBL > 1 ? "s" : ""} avec expédition BL (N) · {daysWithBLN1} jour{daysWithBLN1 > 1 ? "s" : ""} sur N-1.
        </div>
      </div>
    </div>
  );
}

function AverageStat({
  label, value, valueN1, total, color,
}: { label: string; value: number; valueN1: number; total: number; color: string }) {
  const evolPct = valueN1 > 0 ? ((value - valueN1) / valueN1) * 100 : null;
  const isUp = (evolPct ?? 0) >= 0;

  return (
    <div className="rounded-lg bg-black/[0.035] px-3 py-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-[10px] uppercase tracking-wide text-[#141A26]/45">{label}</div>
      <div className="mt-1 font-[var(--font-mono)] text-2xl font-semibold leading-none text-[#141A26]">
        {formatMoney(value)}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
        {evolPct !== null && (
          <span className={isUp ? "font-medium text-[#C1683C]" : "font-medium text-[#4B92AC]"}>
            {isUp ? "▲" : "▼"} {Math.abs(evolPct).toFixed(1)}%
          </span>
        )}
        <span className="text-[#141A26]/45">N-1 : {formatMoney(valueN1)}</span>
      </div>
      <div className="mt-1 text-[10px] text-[#141A26]/40">Cumul mois : {formatMoney(total)}</div>
    </div>
  );
}

function YAxisMoney({ maxVal, height, top, innerH }: { maxVal: number; height: number; top: number; innerH: number }) {
  const ticks = [0, maxVal / 2, maxVal];
  return (
    <>
      {ticks.map((t, i) => {
        const yPos = top + innerH - (t / maxVal) * innerH;
        return (
          <g key={i}>
            <line x1={48} y1={yPos} x2="100%" y2={yPos} stroke="#00000010" strokeDasharray={i === ticks.length - 1 ? undefined : "3 3"} />
            <text x={44} y={yPos + 3} fontSize={9} textAnchor="end" fill="#141A26aa">{formatMoney(t)}</text>
          </g>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants V3
// ---------------------------------------------------------------------------

function TableShell({
  loading, children, minHeight,
}: { loading: boolean; children: React.ReactNode; minHeight?: number }) {
  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-[#F5F3EC] p-1" style={minHeight ? { minHeight } : undefined}>
      {loading ? (
        <div className="p-6 text-sm text-[#141A26]/50">Chargement…</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portefeuille / Projection — versions compactes (colonnes fusionnées),
// mêmes données que AgencyPortfolioTable/AgencyProjectionTable, sans le
// détail M / M-x qui obligeait à scroller.
// ---------------------------------------------------------------------------

export function PortfolioTableCompact({ rows }: { rows: AgencyPortfolioRow[] }) {
  const withoutTotal = rows.filter((r) => r.label.toUpperCase() !== "TOTAL");
  const totalRow: AgencyPortfolioRow = {
    label: "TOTAL AGENCE",
    cdc: withoutTotal.reduce((s, r) => s + r.cdc, 0),
    cdcLivMx: withoutTotal.reduce((s, r) => s + r.cdcLivMx, 0),
    pl: withoutTotal.reduce((s, r) => s + r.pl, 0),
    plLivMPlus: withoutTotal.reduce((s, r) => s + r.plLivMPlus, 0),
    blMx: withoutTotal.reduce((s, r) => s + r.blMx, 0),
    brMx: withoutTotal.reduce((s, r) => s + r.brMx, 0),
    blM: withoutTotal.reduce((s, r) => s + r.blM, 0),
    brM: withoutTotal.reduce((s, r) => s + r.brM, 0),
    total: withoutTotal.reduce((s, r) => s + r.total, 0),
  };
  const sorted = [...withoutTotal].sort((a, b) => b.total - a.total);
  const display = withoutTotal.length ? [totalRow, ...sorted] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Portefeuille de commandes par agence</h3>
      {/* La carte impose désormais une hauteur suffisante : l'ascenseur
          interne ne se déclenche plus que si le périmètre dépasse la place
          disponible. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F5F3EC]">
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
              <th className="px-2 py-2">Agence</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-right">CDC</th>
              <th className="px-2 py-2 text-right">PL</th>
              <th className="px-2 py-2 text-right">BL/BR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {display.map((r) => (
              <tr key={r.label} className={r.label === "TOTAL AGENCE" ? "bg-black/[0.03] font-semibold" : ""}>
                <td className="px-2 py-2 text-[#141A26]">{r.label}</td>
                <td className="px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]">{formatMoney(r.total)}</td>
                {/* cdcLivMx et plLivMPlus sont des SOUS-ENSEMBLES de cdc et pl,
                    pas des compléments : les additionner double-comptait la part
                    concernée et faisait passer la colonne CDC au-dessus du total.
                    On affiche donc l'ensemble, et le sous-ensemble en mention. */}
                <td className="px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">
                  <div>{formatMoney(r.cdc)}</div>
                  {r.cdcLivMx > 0 && (
                    <div className="text-[10px] font-normal text-[#C1683C]">
                      dont retard {formatMoney(r.cdcLivMx)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">
                  <div>{formatMoney(r.pl)}</div>
                  {r.plLivMPlus > 0 && (
                    <div className="text-[10px] font-normal text-[#141A26]/45">
                      dont M+ {formatMoney(r.plLivMPlus)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">{formatMoney(r.blMx + r.blM + r.brMx + r.brM)}</td>
              </tr>
            ))}
            {display.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-[#141A26]/40">Aucune donnée sur ce périmètre.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProjectionTableCompact({ rows }: { rows: AgencyProjectionRow[] }) {
  const withoutTotal = rows.filter((r) => r.label.toUpperCase() !== "TOTAL");
  const caN1Total = withoutTotal.reduce((s, r) => s + r.caN1, 0);
  const projectionCaTotal = withoutTotal.reduce((s, r) => s + r.projectionCa, 0);
  const totalRow: AgencyProjectionRow = {
    label: "TOTAL AGENCE",
    blBrMx: withoutTotal.reduce((s, r) => s + r.blBrMx, 0),
    blBrM: withoutTotal.reduce((s, r) => s + r.blBrM, 0),
    factures: withoutTotal.reduce((s, r) => s + r.factures, 0),
    projectionFluxBl: withoutTotal.reduce((s, r) => s + r.projectionFluxBl, 0),
    valeurBlNf3Pct: withoutTotal.reduce((s, r) => s + r.valeurBlNf3Pct, 0),
    projectionCa: projectionCaTotal,
    caN1: caN1Total,
    evolPct: caN1Total > 0 ? ((projectionCaTotal - caN1Total) / caN1Total) * 100 : null,
  };
  const sorted = [...withoutTotal].sort((a, b) => b.projectionCa - a.projectionCa);
  const display = withoutTotal.length ? [totalRow, ...sorted] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Projection du CA par agence</h3>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[#F5F3EC]">
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
              <th className="sticky left-0 z-20 bg-[#F5F3EC] px-2 py-2">Agence</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">CA projeté</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">CA N-1</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">Évol.</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">BL/BR</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">BL à venir</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">BL NF</th>
              <th className="whitespace-nowrap px-2 py-2 text-right">Fact.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {display.map((r) => (
              <tr key={r.label} className={r.label === "TOTAL AGENCE" ? "bg-black/[0.03] font-semibold" : ""}>
                <td className={`sticky left-0 z-10 px-2 py-2 text-[#141A26] ${r.label === "TOTAL AGENCE" ? "bg-[#EDEAE0]" : "bg-[#F5F3EC]"}`}>{r.label}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-[var(--font-mono)] font-semibold text-[#141A26]">{formatMoney(r.projectionCa)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/70">{formatMoney(r.caN1)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  {r.evolPct === null ? <span className="text-[#141A26]/30">—</span> : (
                    <span className={r.evolPct >= 0 ? "text-[#C1683C]" : "text-[#4B92AC]"}>{r.evolPct >= 0 ? "▲" : "▼"} {Math.abs(r.evolPct).toFixed(1)}%</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">{formatMoney(r.blBrMx + r.blBrM)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">{formatMoney(r.projectionFluxBl)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">{formatMoney(r.valeurBlNf3Pct)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">{formatMoney(r.factures)}</td>
              </tr>
            ))}
            {display.length === 0 && (
              <tr><td colSpan={8} className="px-2 py-6 text-center text-[#141A26]/40">Aucune donnée sur ce périmètre.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options, locked,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; locked?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs uppercase tracking-wide text-white/40">{label}</label>
      <select
        value={value}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[#A6A181] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="" className="bg-[#101A2E]">Tous</option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#101A2E]">{o}</option>
        ))}
      </select>
      {locked && <span className="text-[10px] uppercase tracking-wide text-[#A6A181]">périmètre</span>}
    </div>
  );
}

function KpiCardJMA({
  type, dayValue, dayLabel, monthValue, monthValueN1, annualSeries, months,
}: {
  type: DocType;
  dayValue: number;
  dayLabel: string;
  monthValue: number;
  monthValueN1: number;
  annualSeries: number[];
  months: string[];
}) {
  const color = DOC_COLORS[type];
  const evolutionPct = monthValueN1 > 0 ? ((monthValue - monthValueN1) / monthValueN1) * 100 : null;
  const isUp = (evolutionPct ?? 0) >= 0;

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-4">
        <span className="rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: `${color}22`, color }}>
          {type}
        </span>
      </div>

      {/* Jour et mois en cours sur la même ligne de base et à la même taille :
          le jour ancré à gauche, le mois à droite du cadre. */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-white/35">Jour · {dayLabel}</div>
          <div className="whitespace-nowrap font-[var(--font-mono)] text-[2.5rem] font-semibold leading-none tracking-tight text-white/85">
            {formatMoney(dayValue)}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-white/35">Mois en cours</div>
          <div className="whitespace-nowrap font-[var(--font-mono)] text-[2.5rem] font-semibold leading-none tracking-tight text-white">
            {formatMoney(monthValue)}
          </div>
        </div>
      </div>

      {/* Comparaison N-1 alignée sous le montant du mois, même axe droit. */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border-t border-white/10 pt-3">
        {evolutionPct !== null && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              isUp ? "bg-[#C1683C]/15 text-[#e0a685]" : "bg-[#4B92AC]/15 text-[#8fc0d4]"
            }`}
          >
            {isUp ? "▲" : "▼"} {Math.abs(evolutionPct).toFixed(1)}%
            <span className="font-normal text-white/40">vs N-1</span>
          </span>
        )}
        <span className="text-[11px] uppercase tracking-wide text-white/35">
          N-1 · même mois{" "}
          <span className="ml-1 font-[var(--font-mono)] text-sm normal-case tracking-normal text-white/60">
            {formatMoney(monthValueN1)}
          </span>
        </span>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-white/35">Tendance · 12 derniers mois</div>
        <KpiTrendChart values={annualSeries} months={months} color={color} />
      </div>
    </div>
  );
}

export function KpiTrendChart({
  values, months, color, theme = 'dark',
}: {
  values: number[];
  months: string[];
  color: string;
  // Le document imprimé est sur fond blanc : les lignes de repère et les
  // libellés d'axe doivent basculer en encre, sinon ils disparaissent.
  theme?: 'dark' | 'light';
}) {
  const gridColor = theme === 'light' ? '#141A2618' : '#FFFFFF14';
  const axisColor = theme === 'light' ? '#141A2699' : '#FFFFFF55';
  const width = 320;
  const height = 124;
  const padding = { top: 6, right: 6, bottom: 18, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxVal = Math.max(1, ...values);
  const minVal = Math.min(0, ...values);
  const x = (i: number) => padding.left + (values.length <= 1 ? 0 : (i / (values.length - 1)) * innerW);
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH;

  const ticks = [minVal, minVal + (maxVal - minVal) / 2, maxVal];
  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  // Aplat sous la courbe : donne du corps à la sparkline maintenant qu'elle
  // dispose de plus de hauteur.
  const areaPath =
    values.length > 1
      ? `${linePath} L ${x(values.length - 1)} ${y(minVal)} L ${x(0)} ${y(minVal)} Z`
      : "";
  const gradientId = `kpi-trend-${color.replace("#", "")}`;
  const lastIndex = values.length - 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke={gridColor} strokeDasharray={i === ticks.length - 1 ? undefined : "3 3"} />
          <text x={padding.left - 4} y={y(t) + 3} fontSize={9} textAnchor="end" fill={axisColor}>{formatMoney(t)}</text>
        </g>
      ))}
      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i === lastIndex ? 3.5 : 2} fill={color} />
      ))}
      {lastIndex >= 0 && <circle cx={x(lastIndex)} cy={y(values[lastIndex])} r={6} fill={color} opacity={0.22} />}
      {months.map((m, i) =>
        i % 2 === 0 ? (
          <text key={m} x={x(i)} y={height - 3} fontSize={9} textAnchor="middle" fill={axisColor}>
            {new Date(m + "-01").toLocaleDateString("fr-FR", { month: "short" })}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 h-5 w-16 rounded bg-white/10" />
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="h-12 w-32 rounded bg-white/10" />
        <div className="h-12 w-32 rounded bg-white/10" />
      </div>
      <div className="mb-4 flex justify-end border-t border-white/10 pt-3">
        <div className="h-6 w-44 rounded-full bg-white/10" />
      </div>
      <div className="h-24 w-full rounded bg-white/10" />
    </div>
  );
}
