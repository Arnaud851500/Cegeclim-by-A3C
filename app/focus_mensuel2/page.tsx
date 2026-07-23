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
 * ------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";
import { usePageFilterAccess } from "@/lib/pageAccessFilters";

// ---- Réutilisation stricte de la page existante (mêmes calculs) ----------
import {
  DOC_TYPES,
  DOC_COLORS,
  type DailyRow,
  type HighlightRow,
  type ComparisonRow,
  type DocType,
  type AnnualCacheRpcRow,
  formatMoney,
  aggregateComparisonRows,
  buildComparisonRowsFromAnnualCache,
  SparkLine,
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
  { key: "portefeuille", label: "Portefeuille & projection" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

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

function useAutoHideHeader() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      const goingDown = y > lastY.current + 4;
      const goingUp = y < lastY.current - 4;
      if (y < 80) setHidden(false);
      else if (goingDown) setHidden(true);
      else if (goingUp) setHidden(false);
      lastY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return hidden;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FocusMensuel3Page() {
  const access = usePageFilterAccess();
  const headerHidden = useAutoHideHeader();

  const [tab, setTab] = useState<TabKey>("vue");
  const [month, setMonth] = useState(currentMonthStr());
  const [focusDay, setFocusDay] = useState<string>(ymd(new Date()));
  const [agence, setAgence] = useState("");
  const [familleMacro, setFamilleMacro] = useState("");
  const [collaborateur, setCollaborateur] = useState("");
  const [includeHorsStats, setIncludeHorsStats] = useState(false);

  const [monthRows, setMonthRows] = useState<DailyRow[]>([]);
  const [monthRowsN1, setMonthRowsN1] = useState<DailyRow[]>([]);
  const [annualCacheRows, setAnnualCacheRows] = useState<AnnualCacheRpcRow[]>([]);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (access.loading) return;
    if (access.hasAgenceRestriction && access.allowedAgences.length > 0) setAgence(access.allowedAgences[0]);
    if (access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0) setCollaborateur(access.allowedCollaborateurs[0]);
  }, [access.loading, access.hasAgenceRestriction, access.hasCollaborateurRestriction]);

  useEffect(() => {
    if (access.loading) return;
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
        // de get_focus_mensuel_daily_summary_metier).
        const [monthRes, monthN1Res, annualRes, highlightsRes] = await Promise.all([
          supabase.rpc("get_focus_mensuel_daily_summary_metier", { p_date_debut: debut, p_date_fin: fin, ...commonParams }),
          supabase.rpc("get_focus_mensuel_daily_summary_metier", { p_date_debut: debutN1, p_date_fin: finN1, ...commonParams }),
          supabase.rpc("get_focus_mensuel_annual_tables_cached", { p_focus_date: focusDay, p_month: month, ...commonParams }),
          supabase.rpc("get_focus_mensuel_highlights", { p_date_debut: debut, p_date_fin: fin, p_limit: 10, ...commonParams }),
        ]);

        for (const r of [monthRes, monthN1Res, annualRes, highlightsRes]) {
          if (r.error) throw r.error;
        }

        if (!cancelled) {
          setMonthRows((monthRes.data as DailyRow[]) || []);
          setMonthRowsN1((monthN1Res.data as DailyRow[]) || []);
          setAnnualCacheRows((annualRes.data as AnnualCacheRpcRow[]) || []);
          setHighlights((highlightsRes.data as HighlightRow[]) || []);
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
  }, [access.loading, month, focusDay, agence, familleMacro, collaborateur, includeHorsStats]);

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

  const rollingComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, "rolling_12"),
    [annualCacheRows],
  );

  const monthTotals = useMemo(() => {
    const totalRows = aggregateComparisonRows(monthRows, monthRowsN1, () => "TOTAL", () => "TOTAL");
    return totalRows[0] ?? null;
  }, [monthRows, monthRowsN1]);

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

  return (
    <div
      className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen w-full`}
      style={{ background: "#0B1220", fontFamily: "var(--font-body)" }}
    >
      {/* ---- Bandeau supérieur escamotable ---- */}
      <div
        className="sticky top-0 z-30 border-b border-white/10 bg-[#0B1220]/95 backdrop-blur transition-transform duration-300"
        style={{ transform: headerHidden ? "translateY(-100%)" : "translateY(0)" }}
      >
        <div className="w-full px-6 py-4 md:px-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em] text-[#A6A181]">
                CEGECLIM — Pilotage commercial
              </div>
              <h1 className="font-[var(--font-display)] text-2xl font-bold text-white md:text-3xl">
                Focus mensuel
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Jour focus</label>
                <input
                  type="date"
                  value={focusDay}
                  onChange={(e) => setFocusDay(e.target.value)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]"
                />
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
            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {loading || !monthTotals
                ? DOC_TYPES.map((t) => <KpiSkeleton key={t} />)
                : DOC_TYPES.map((type) => (
                    <KpiCardJMA
                      key={type}
                      type={type}
                      dayValue={dayValueByType[type]}
                      monthValue={monthTotals.byType[type].amountN}
                      monthValueN1={monthTotals.byType[type].amountN1}
                      annualSeries={annualSeriesByType[type]}
                    />
                  ))}
            </section>

            <section className="rounded-xl border border-white/10 bg-[#F5F3EC]">
              <HighlightTable title="Points d'attention du mois" rows={highlights} />
            </section>
          </>
        )}

        {tab === "agence" && (
          <TableShell loading={loading}>
            <ActivityByAgencyComparisonTable
              title="Comparatif par agence — mois vs N-1"
              subtitle={`Périmètre : ${agence || "toutes agences"} · ${familleMacro || "toutes familles"}`}
              rows={agencyComparisonRows}
              emptyMessage="Aucune donnée sur ce périmètre pour le mois sélectionné."
            />
          </TableShell>
        )}

        {tab === "famille" && (
          <TableShell loading={loading}>
            <ActivityByFamilyComparisonTable
              title="Comparatif par famille — mois vs N-1"
              rows={familyComparisonRows}
              emptyMessage="Aucune donnée sur ce périmètre pour le mois sélectionné."
            />
          </TableShell>
        )}

        {tab === "rolling" && (
          <TableShell loading={loading}>
            <Rolling12ComparisonTable
              title="Rolling 12 mois — glissant vs N-1"
              subtitle={`${months12[0]} → ${months12[months12.length - 1]}`}
              rows={rollingComparisonRows}
              emptyMessage="Aucune donnée sur les 12 derniers mois pour ce périmètre."
            />
          </TableShell>
        )}

        {tab === "portefeuille" && (
          <div className="rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-8 text-center text-white/50">
            <p className="mb-2 font-[var(--font-display)] text-lg text-white/80">Portefeuille &amp; projection — à câbler</p>
            <p className="mx-auto max-w-xl text-sm">
              Cet onglet reprend AgencyPortfolioTable et AgencyProjectionTable dans la page actuelle, alimentés par
              buildProjectionCaByAgency et une chaîne de calculs sur les jours ouvrés et l&rsquo;activité non facturée.
              Je préfère le câbler avec vous en vérifiant les chiffres en conditions réelles plutôt que de deviner —
              une fois cette base validée, on le branche.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants V3
// ---------------------------------------------------------------------------

function TableShell({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#F5F3EC] p-1">
      {loading ? <div className="p-6 text-sm text-[#141A26]/50">Chargement…</div> : children}
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
  type, dayValue, monthValue, monthValueN1, annualSeries,
}: { type: DocType; dayValue: number; monthValue: number; monthValueN1: number; annualSeries: number[] }) {
  const color = DOC_COLORS[type];
  const evolutionPct = monthValueN1 > 0 ? ((monthValue - monthValueN1) / monthValueN1) * 100 : null;
  const isUp = (evolutionPct ?? 0) >= 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wide" style={{ background: `${color}22`, color }}>
          {type}
        </span>
        <span className="font-[var(--font-mono)] text-[11px] text-white/35">12 derniers mois</span>
      </div>

      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide text-white/35">Jour ({dayValue ? "focus" : "—"})</div>
        <div className="font-[var(--font-mono)] text-lg font-medium text-white/80">{formatMoney(dayValue)}</div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide text-white/35">Mois en cours</div>
        <div className="font-[var(--font-mono)] text-2xl font-semibold text-white">{formatMoney(monthValue)}</div>
        {evolutionPct !== null && (
          <div className={`mt-1 text-xs font-medium ${isUp ? "text-[#C1683C]" : "text-[#4B92AC]"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(evolutionPct).toFixed(1)}% vs N-1 ({formatMoney(monthValueN1)})
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">Tendance annuelle</div>
        <SparkLine values={annualSeries} color={color} />
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 h-3 w-24 rounded bg-white/10" />
      <div className="mb-3 h-4 w-20 rounded bg-white/10" />
      <div className="mb-3 h-7 w-32 rounded bg-white/10" />
      <div className="h-8 w-full rounded bg-white/10" />
    </div>
  );
}
