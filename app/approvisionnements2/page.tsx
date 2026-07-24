"use client";

/**
 * APPROVISIONNEMENTS & FLUX COMMERCIAUX — V2
 * ------------------------------------------------------------------------
 * Même charte graphique et même esprit de navigation que focus_mensuel3
 * (fond navy #0B1220, cartes crème #F5F3EC, onglets, bandeau collant).
 * Réutilise telles quelles les RPC déjà en place et éprouvées :
 *   - get_appro_filter_options_light   → options de filtres
 *   - get_appro_flux_summary           → agrégats mensuels par famille macro
 *   - get_appro_flux_reference_pivot_source_v19 → détail par référence
 * Ces fonctions ont un délai étendu à 25s (corrigé récemment), donc plus
 * de timeout attendu même sur l'année complète.
 *
 * Version 1 : couvre le cœur d'usage (vue d'ensemble + comparatif famille
 * macro + top références) avec le nouvel habillage. Les fonctionnalités
 * plus fines de la page actuelle (bascule BL M-x, export Excel détaillé,
 * clic sur une cellule pour ouvrir le détail ligne à ligne) ne sont pas
 * reprises dans cette première passe — à affiner avec vous ensuite,
 * comme pour les autres écrans.
 * ------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

type Flux = "DEVIS" | "CDC" | "BL" | "FACTURE";
const FLUX_TYPES: Flux[] = ["DEVIS", "CDC", "BL", "FACTURE"];
const FLUX_COLOR: Record<Flux, string> = {
  DEVIS: "#C1683C",
  CDC: "#4B92AC",
  BL: "#2f6fa6",
  FACTURE: "#3F9142",
};

type SummaryRow = {
  annee: number;
  mois: number;
  flux: Flux;
  famille_macro: string;
  quantite: number;
  quantite_pertinente: number;
  ca_ht: number;
};

type ReferencePivotRow = {
  reference_article: string;
  designation: string;
  famille_macro: string;
  famille: string;
  type_document: Flux;
  mois: number;
  quantite: number;
  quantite_pertinente: number;
  ca_ht: number;
};

const TABS = [
  { key: "vue", label: "Vue d'ensemble" },
  { key: "famille", label: "Comparatif famille macro" },
  { key: "reference", label: "Top références" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function formatMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  if (abs >= 1_000) return `${(v / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} K€`;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}
function formatNumber(v: number): string {
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

const MONTH_LABELS = ["Janv.", "Fév.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

export default function ApprovisionnementsV2Page() {
  const [tab, setTab] = useState<TabKey>("vue");
  const [headerHidden, setHeaderHidden] = useState(false);

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [famillesMacroOptions, setFamillesMacroOptions] = useState<string[]>([]);
  const [familleMacroFilter, setFamilleMacroFilter] = useState<string>("");
  const [includeHorsStat, setIncludeHorsStat] = useState(false);
  const [visibleFlux, setVisibleFlux] = useState<Record<Flux, boolean>>({ DEVIS: true, CDC: false, BL: true, FACTURE: true });

  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [referenceRows, setReferenceRows] = useState<ReferencePivotRow[]>([]);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Bandeau escamotable au scroll (même mécanisme que focus_mensuel3) ----
  useEffect(() => {
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      if (y < 80) setHeaderHidden(false);
      else if (y > lastY + 4) setHeaderHidden(true);
      else if (y < lastY - 4) setHeaderHidden(false);
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ---- Options de filtres ----
  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const { data } = await supabase.rpc("get_appro_filter_options_light", { p_annee: year, p_include_hors_statistique: includeHorsStat });
      if (cancelled || !data) return;
      const macros = Array.from(
        new Set((data as Array<{ option_type?: string; type_filtre?: string; value?: string; valeur?: string }>).filter((r) => (r.option_type || r.type_filtre) === "famille_macro").map((r) => r.value || r.valeur || "")),
      ).filter(Boolean).sort();
      setFamillesMacroOptions(macros);
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [year, includeHorsStat]);

  // ---- Données principales ----
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const famillesMacroParam = familleMacroFilter ? [familleMacroFilter] : [];
        const { data, error: rpcError } = await supabase.rpc("get_appro_flux_summary", {
          p_year: year,
          p_include_hors_stat: includeHorsStat,
          p_depots: [],
          p_collaborateurs_tiers: [],
          p_familles_macro: famillesMacroParam,
          p_familles: [],
          p_references: [],
        });
        if (rpcError) throw rpcError;
        if (!cancelled) setSummaryRows((data as SummaryRow[]) || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [year, familleMacroFilter, includeHorsStat]);

  // ---- Top références (onglet dédié, chargé à la demande) ----
  useEffect(() => {
    if (tab !== "reference") return;
    let cancelled = false;
    async function loadReferences() {
      const famillesMacroParam = familleMacroFilter ? [familleMacroFilter] : [];
      const { data } = await supabase.rpc("get_appro_flux_reference_pivot_source_v19", {
        p_year: year,
        p_mois: null,
        p_flux: null,
        p_famille_macro: familleMacroFilter || null,
        p_famille: null,
        p_include_hors_stat: includeHorsStat,
        p_depots: [],
        p_collaborateurs_tiers: [],
        p_familles_macro: famillesMacroParam,
        p_familles: [],
        p_references: [],
        p_limit: 2000,
      });
      if (!cancelled) setReferenceRows((data as ReferencePivotRow[]) || []);
    }
    loadReferences();
    return () => {
      cancelled = true;
    };
  }, [tab, year, familleMacroFilter, includeHorsStat]);

  // ---- KPI par flux (année N vs N-1) ----
  const kpiByFlux = useMemo(() => {
    const result: Record<Flux, { n: number; n1: number }> = {
      DEVIS: { n: 0, n1: 0 },
      CDC: { n: 0, n1: 0 },
      BL: { n: 0, n1: 0 },
      FACTURE: { n: 0, n1: 0 },
    };
    summaryRows.forEach((r) => {
      const bucket = r.annee === year ? "n" : "n1";
      result[r.flux][bucket] += r.ca_ht;
    });
    return result;
  }, [summaryRows, year]);

  // ---- Série mensuelle pour le graphique ----
  const monthlySeries = useMemo(() => {
    const byMonth = new Map<number, Record<Flux, { n: number; n1: number }>>();
    for (let m = 1; m <= 12; m++) {
      byMonth.set(m, { DEVIS: { n: 0, n1: 0 }, CDC: { n: 0, n1: 0 }, BL: { n: 0, n1: 0 }, FACTURE: { n: 0, n1: 0 } });
    }
    summaryRows.forEach((r) => {
      const entry = byMonth.get(r.mois);
      if (!entry) return;
      const bucket = r.annee === year ? "n" : "n1";
      entry[r.flux][bucket] += r.ca_ht;
    });
    return Array.from(byMonth.entries()).map(([mois, v]) => ({ mois, ...v }));
  }, [summaryRows, year]);

  // ---- Comparatif famille macro (tableau) ----
  const familleMacroRows = useMemo(() => {
    const byFamille = new Map<string, Record<Flux, { n: number; n1: number }>>();
    summaryRows.forEach((r) => {
      const key = r.famille_macro || "NON RENSEIGNÉ";
      const entry = byFamille.get(key) || { DEVIS: { n: 0, n1: 0 }, CDC: { n: 0, n1: 0 }, BL: { n: 0, n1: 0 }, FACTURE: { n: 0, n1: 0 } };
      const bucket = r.annee === year ? "n" : "n1";
      entry[r.flux][bucket] += r.ca_ht;
      byFamille.set(key, entry);
    });
    return Array.from(byFamille.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.FACTURE.n - a.FACTURE.n);
  }, [summaryRows, year]);

  // ---- Top 30 références (agrégées, filtrées par recherche) ----
  const topReferences = useMemo(() => {
    const byRef = new Map<string, { designation: string; famille: string; ca: number; qte: number }>();
    referenceRows.forEach((r) => {
      const key = r.reference_article || "—";
      const entry = byRef.get(key) || { designation: r.designation, famille: r.famille, ca: 0, qte: 0 };
      entry.ca += r.ca_ht;
      entry.qte += r.quantite_pertinente;
      byRef.set(key, entry);
    });
    const s = referenceSearch.trim().toLowerCase();
    return Array.from(byRef.entries())
      .map(([reference_article, v]) => ({ reference_article, ...v }))
      .filter((r) => !s || r.reference_article.toLowerCase().includes(s) || r.designation.toLowerCase().includes(s))
      .sort((a, b) => Math.abs(b.ca) - Math.abs(a.ca))
      .slice(0, 30);
  }, [referenceRows, referenceSearch]);

  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen w-full`} style={{ background: "#0B1220", fontFamily: "var(--font-body)" }}>
      <div
        className="sticky top-0 z-10 border-b border-white/10 bg-[#0B1220]/95 backdrop-blur transition-transform duration-300"
        style={{ transform: headerHidden ? "translateY(-100%)" : "translateY(0)" }}
      >
        <div className="w-full px-6 py-4 md:px-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em] text-[#A6A181]">CEGECLIM — PILOTAGE COMMERCIAL</div>
              <h1 className="font-[var(--font-display)] text-2xl font-bold text-white md:text-3xl">Approvisionnements &amp; flux</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Année</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]">
                  {[year + 1, year, year - 1, year - 2].map((y) => (
                    <option key={y} value={y} className="bg-[#101A2E]">{y}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Famille macro</label>
                <select value={familleMacroFilter} onChange={(e) => setFamilleMacroFilter(e.target.value)} className="min-w-[160px] rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]">
                  <option value="" className="bg-[#101A2E]">Toutes</option>
                  {famillesMacroOptions.map((f) => (
                    <option key={f} value={f} className="bg-[#101A2E]">{f}</option>
                  ))}
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/60">
                <input type="checkbox" checked={includeHorsStat} onChange={(e) => setIncludeHorsStat(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#A6A181]" />
                Inclure les hors-statistiques
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-full px-3 py-1 transition ${tab === t.key ? "bg-[#A6A181] text-[#141A26] font-medium" : "text-white/50 hover:text-white/80"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full px-6 py-8 md:px-10">
        {error && <div className="mb-6 rounded-lg border border-[#C1683C]/40 bg-[#C1683C]/10 px-4 py-3 text-sm text-[#e0a685]">{error}</div>}

        {tab === "vue" && (
          <>
            <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {loading
                ? FLUX_TYPES.map((f) => <div key={f} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />)
                : FLUX_TYPES.map((f) => {
                    const kpi = kpiByFlux[f];
                    const evolPct = kpi.n1 > 0 ? ((kpi.n - kpi.n1) / kpi.n1) * 100 : null;
                    return (
                      <div key={f} className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                        <span className="mb-3 inline-block rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wide" style={{ background: `${FLUX_COLOR[f]}22`, color: FLUX_COLOR[f] }}>
                          {f}
                        </span>
                        <div className="mb-1 font-[var(--font-mono)] text-2xl font-semibold text-white">{formatMoney(kpi.n)}</div>
                        <div className="text-xs text-white/40">
                          N-1 : {formatMoney(kpi.n1)}{" "}
                          {evolPct !== null && (
                            <span className={evolPct >= 0 ? "text-[#C1683C]" : "text-[#4B92AC]"}>
                              {evolPct >= 0 ? "▲" : "▼"} {Math.abs(evolPct).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </section>

            <section className="rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-[var(--font-display)] text-base font-semibold text-[#141A26]">Courbes Devis → CDC → BL → Factures</h3>
                <div className="flex flex-wrap gap-2">
                  {FLUX_TYPES.map((f) => (
                    <button
                      key={f}
                      onClick={() => setVisibleFlux((prev) => ({ ...prev, [f]: !prev[f] }))}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${visibleFlux[f] ? "border-transparent text-white" : "border-black/10 text-[#141A26]/40"}`}
                      style={visibleFlux[f] ? { background: FLUX_COLOR[f] } : {}}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              {loading ? <div className="h-72 animate-pulse rounded-lg bg-black/[0.04]" /> : <ApproChart rows={monthlySeries} visibleFlux={visibleFlux} />}
            </section>
          </>
        )}

        {tab === "famille" && (
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#F5F3EC]">
            <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Comparatif par famille macro — {year} vs N-1</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                  <th className="whitespace-nowrap px-4 py-3">Famille macro</th>
                  {FLUX_TYPES.map((f) => (
                    <th key={f} className="whitespace-nowrap px-4 py-3 text-right">{f}</th>
                  ))}
                  <th className="whitespace-nowrap px-4 py-3 text-right">Évol. Factures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#141A26]/40">Chargement…</td></tr>
                ) : familleMacroRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#141A26]/40">Aucune donnée sur ce périmètre.</td></tr>
                ) : (
                  familleMacroRows.map((r) => {
                    const evolPct = r.FACTURE.n1 > 0 ? ((r.FACTURE.n - r.FACTURE.n1) / r.FACTURE.n1) * 100 : null;
                    return (
                      <tr key={r.label}>
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-[#141A26]">{r.label}</td>
                        {FLUX_TYPES.map((f) => (
                          <td key={f} className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#141A26]/80">{formatMoney(r[f].n)}</td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          {evolPct === null ? <span className="text-[#141A26]/30">—</span> : (
                            <span className={evolPct >= 0 ? "text-[#C1683C]" : "text-[#4B92AC]"}>{evolPct >= 0 ? "▲" : "▼"} {Math.abs(evolPct).toFixed(1)}%</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "reference" && (
          <div>
            <input
              value={referenceSearch}
              onChange={(e) => setReferenceSearch(e.target.value)}
              placeholder="Rechercher référence ou désignation…"
              className="mb-4 w-full max-w-md rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#A6A181]"
            />
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#F5F3EC]">
              <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Top 30 références — {year}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                    <th className="whitespace-nowrap px-4 py-3">Référence</th>
                    <th className="whitespace-nowrap px-4 py-3">Désignation</th>
                    <th className="whitespace-nowrap px-4 py-3">Famille</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Qté pertinente</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">CA HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {topReferences.map((r) => (
                    <tr key={r.reference_article}>
                      <td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] font-medium text-[#141A26]">{r.reference_article}</td>
                      <td className="max-w-[260px] truncate px-4 py-2 text-[#141A26]/80">{r.designation}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-[#141A26]/60">{r.famille}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(r.qte)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] font-semibold">{formatMoney(r.ca)}</td>
                    </tr>
                  ))}
                  {topReferences.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-[#141A26]/40">Aucune référence sur ce périmètre.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graphique — Devis / CDC / BL / Factures, N trait plein, N-1 pointillé
// ---------------------------------------------------------------------------

type TooltipState = { x: number; y: number; lines: Array<{ label: string; value: string; color?: string }> } | null;

function ApproChart({
  rows, visibleFlux,
}: {
  rows: Array<{ mois: number } & Record<Flux, { n: number; n1: number }>>;
  visibleFlux: Record<Flux, boolean>;
}) {
  const width = 1040;
  const height = 320;
  const padding = { top: 16, right: 16, bottom: 28, left: 64 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const activeFlux = FLUX_TYPES.filter((f) => visibleFlux[f]);
  const maxVal = Math.max(1, ...rows.flatMap((r) => activeFlux.flatMap((f) => [r[f].n, r[f].n1])));
  const x = (i: number) => padding.left + (i / 11) * innerW;
  const y = (v: number) => padding.top + innerH - (v / maxVal) * innerH;

  function path(values: number[]) {
    return values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  }

  function handleMove(e: React.MouseEvent, i: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const r = rows[i];
    setTooltip({
      x: (x(i) / width) * rect.width,
      y: (y(Math.max(...activeFlux.map((f) => r[f].n))) / height) * rect.height,
      lines: [
        { label: MONTH_LABELS[i], value: "" },
        ...activeFlux.map((f) => ({ label: f, value: formatMoney(r[f].n), color: FLUX_COLOR[f] })),
      ],
    });
  }

  const ticks = [0, maxVal / 2, maxVal];

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setTooltip(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="#00000010" strokeDasharray={i === ticks.length - 1 ? undefined : "3 3"} />
            <text x={padding.left - 8} y={y(t) + 3} fontSize={10} textAnchor="end" fill="#141A26aa">{formatMoney(t)}</text>
          </g>
        ))}

        {activeFlux.map((f) => (
          <path key={`${f}-n1`} d={path(rows.map((r) => r[f].n1))} fill="none" stroke={FLUX_COLOR[f]} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.5} />
        ))}
        {activeFlux.map((f) => (
          <path key={`${f}-n`} d={path(rows.map((r) => r[f].n))} fill="none" stroke={FLUX_COLOR[f]} strokeWidth={2.5} />
        ))}
        {activeFlux.map((f) =>
          rows.map((r, i) => <circle key={`${f}-pt-${i}`} cx={x(i)} cy={y(r[f].n)} r={3} fill={FLUX_COLOR[f]} />),
        )}

        {rows.map((r, i) => (
          <rect key={`hit-${i}`} x={x(i) - innerW / 22} y={0} width={innerW / 11} height={height} fill="transparent" onMouseMove={(e) => handleMove(e, i)} className="cursor-pointer" />
        ))}

        {MONTH_LABELS.map((m, i) => (
          <text key={m} x={x(i)} y={height - 8} fontSize={10} textAnchor="middle" fill="#141A26aa">{m}</text>
        ))}
      </svg>
      {tooltip && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          {tooltip.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 whitespace-nowrap">
              {l.color && <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />}
              <span className="text-[#141A26]/50">{l.label}</span>
              <span className="font-[var(--font-mono)] font-medium text-[#141A26]">{l.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-[#141A26]/50">
        <span>— Année {new Date().getFullYear()} (N)</span>
        <span className="opacity-60">┄ N-1</span>
      </div>
    </div>
  );
}
