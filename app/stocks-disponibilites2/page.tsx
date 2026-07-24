"use client";

/**
 * PROJECTIONS STOCK — V2.2
 * ------------------------------------------------------------------------
 * Suite de la V2.1. Cette révision :
 *  - la recherche référence passe au-dessus des 2 graphiques et filtre
 *    désormais les KPI ET les deux graphiques (pas seulement la liste),
 *    avec un compteur "X/Y références" affiché à côté
 *  - graphique "Stock projeté hebdomadaire" : entrées à venir en vert,
 *    sorties prévisionnelles en rouge clair (barres), échelle à gauche
 *  - simulateur : le hachuré vert n'apparaît plus que sur LA semaine où
 *    l'appro est ajouté (avant : sur toutes les semaines suivantes)
 *  - graphique "Sorties mensuelles" entièrement refondu : vraies données
 *    BL réelles de janvier à aujourd'hui (nouvelle route dédiée), portion
 *    prévisionnelle jusqu'à fin d'année, ligne N-1 complète, repère
 *    vertical "aujourd'hui", annotations d'évolution par point et par
 *    grande période (réalisé vs N-1, hypothèse fin d'année vs N-1)
 * Le bandeau du site (layout.tsx) a par ailleurs été corrigé séparément
 * pour se masquer au scroll vers le bas.
 * ------------------------------------------------------------------------
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";
import {
  type ProjectionRow,
  type StockAlertRow,
  formatNumber,
  formatCurrencyK,
  formatDate,
  isCurrentRupture,
  isRuptureWithinWeeks,
  toNumber,
  AbcBadge,
} from "../stocks-disponibilites/page";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

type AlertRow = StockAlertRow;
type Level = "macro" | "famille" | "article";

const ALERT_COLOR: Record<string, string> = {
  ROUGE: "#C1683C",
  ORANGE: "#D69A4A",
  JAUNE: "#B8A63A",
  VERT: "#4B92AC",
};
const GREEN = "#3F9142";
const LIGHT_RED = "#E08A6B";
const DARK_RED = "#A8422A";

function alertWeight(level: string): number {
  return level === "ROUGE" ? 3 : level === "ORANGE" ? 2 : level === "JAUNE" ? 1 : 0;
}

function useSiteHeaderOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = document.querySelector('[data-cegeclim-header="true"]') as HTMLElement | null;
    if (!el) return;

    // On suit le bord bas RÉEL et VISIBLE du bandeau (getBoundingClientRect
    // reflète sa position après transform), pas sa hauteur naturelle : le
    // bandeau du site se masque désormais au scroll via translateY, ce qui
    // ne change pas sa hauteur mais change sa position — une hauteur figée
    // laissait un vide fantôme une fois le bandeau masqué.
    let raf = 0;
    function update() {
      const rect = el!.getBoundingClientRect();
      setOffset(Math.max(0, rect.bottom));
      raf = requestAnimationFrame(update);
    }
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, []);
  return offset;
}

type TooltipState = { x: number; y: number; lines: Array<{ label: string; value: string; color?: string }> } | null;

function ChartTooltip({ tooltip }: { tooltip: TooltipState }) {
  if (!tooltip) return null;
  return (
    <div className="pointer-events-none absolute z-10 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-lg" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
      {tooltip.lines.map((l, i) => (
        <div key={i} className="flex items-center gap-2 whitespace-nowrap">
          {l.color && <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />}
          <span className="text-[#141A26]/50">{l.label}</span>
          <span className="font-[var(--font-mono)] font-medium text-[#141A26]">{l.value}</span>
        </div>
      ))}
    </div>
  );
}

function YAxis({ maxVal, minVal, height, top, innerH }: { maxVal: number; minVal: number; height: number; top: number; innerH: number }) {
  const ticks = [minVal, minVal + (maxVal - minVal) / 2, maxVal];
  return (
    <>
      {ticks.map((t, i) => {
        const yPos = top + innerH - ((t - minVal) / (maxVal - minVal || 1)) * innerH;
        return (
          <g key={i}>
            <line x1={44} y1={yPos} x2="100%" y2={yPos} stroke="#00000010" strokeDasharray={i === ticks.length - 1 || (minVal < 0 && t === 0) ? undefined : "3 3"} />
            <text x={40} y={yPos + 3} fontSize={9} textAnchor="end" fill="#141A26aa">{formatNumber(Math.round(t))}</text>
          </g>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StocksDisponibilites2Page() {
  const headerOffset = useSiteHeaderOffset();

  const [alertes, setAlertes] = useState<AlertRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [level, setLevel] = useState<Level>("macro");
  const [selectedMacro, setSelectedMacro] = useState<string | null>(null);
  const [selectedFamille, setSelectedFamille] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<AlertRow | null>(null);

  const [search, setSearch] = useState("");
  const [onlyRupture, setOnlyRupture] = useState(false);

  const [horizonWeeks, setHorizonWeeks] = useState(26);
  const [scenarioPct, setScenarioPct] = useState(120);
  const [recalcScope, setRecalcScope] = useState<"all" | "famille_macro" | "famille">("all");
  const [rebuildProgress, setRebuildProgress] = useState<{ percent: number; message: string } | null>(null);

  useEffect(() => {
    if (level === "article") setRecalcScope("famille");
    else if (level === "famille") setRecalcScope("famille_macro");
    else setRecalcScope("all");
  }, [level]);

  const [refreshKey, setRefreshKey] = useState(0);

  async function loadMainData() {
    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch("/api/stocks-disponibilites/data", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const payload = (await res.json()) as { success: boolean; message?: string; alertes?: AlertRow[]; kpi?: { run_id?: string } };
      if (!res.ok || !payload.success) throw new Error(payload?.message || "Erreur inconnue");
      setAlertes(payload.alertes || []);
      setRunId(payload.kpi?.run_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMainData();
  }, []);

  const macroCards = useMemo(() => {
    const map = new Map<string, { key: string; nbArticles: number; nbRupture: number; caRisque: number; worstAlert: number }>();
    alertes.forEach((a) => {
      const key = a.macro_famille || "NON RENSEIGNÉ";
      const entry = map.get(key) || { key, nbArticles: 0, nbRupture: 0, caRisque: 0, worstAlert: 0 };
      entry.nbArticles += 1;
      if (a.niveau_alerte === "ROUGE" || a.niveau_alerte === "ORANGE") entry.nbRupture += 1;
      entry.caRisque += toNumber(a.ca_client_risque);
      entry.worstAlert = Math.max(entry.worstAlert, alertWeight(a.niveau_alerte));
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.caRisque - a.caRisque);
  }, [alertes]);

  const familleCards = useMemo(() => {
    if (!selectedMacro) return [];
    const map = new Map<string, { key: string; nbArticles: number; nbRupture: number; caRisque: number; worstAlert: number }>();
    alertes
      .filter((a) => (a.macro_famille || "NON RENSEIGNÉ") === selectedMacro)
      .forEach((a) => {
        const key = a.famille || "NON RENSEIGNÉE";
        const entry = map.get(key) || { key, nbArticles: 0, nbRupture: 0, caRisque: 0, worstAlert: 0 };
        entry.nbArticles += 1;
        if (a.niveau_alerte === "ROUGE" || a.niveau_alerte === "ORANGE") entry.nbRupture += 1;
        entry.caRisque += toNumber(a.ca_client_risque);
        entry.worstAlert = Math.max(entry.worstAlert, alertWeight(a.niveau_alerte));
        map.set(key, entry);
      });
    return Array.from(map.values()).sort((a, b) => b.caRisque - a.caRisque);
  }, [alertes, selectedMacro]);

  const familleArticlesAll = useMemo(() => {
    if (!selectedMacro || !selectedFamille) return [];
    return alertes.filter((a) => (a.macro_famille || "NON RENSEIGNÉ") === selectedMacro && (a.famille || "NON RENSEIGNÉE") === selectedFamille);
  }, [alertes, selectedMacro, selectedFamille]);

  const searchMatches = useMemo(() => {
    if (!search.trim()) return null;
    const s = search.trim().toLowerCase();
    return new Set(
      familleArticlesAll.filter((a) => a.reference_article.toLowerCase().includes(s) || (a.designation || "").toLowerCase().includes(s)).map((a) => a.reference_article),
    );
  }, [familleArticlesAll, search]);

  const familleArticles = useMemo(() => {
    if (!searchMatches) return familleArticlesAll;
    return familleArticlesAll.filter((a) => searchMatches.has(a.reference_article));
  }, [familleArticlesAll, searchMatches]);

  const articleRows = useMemo(
    () => familleArticles.filter((a) => !onlyRupture || a.niveau_alerte === "ROUGE" || a.niveau_alerte === "ORANGE").sort((a, b) => alertWeight(b.niveau_alerte) - alertWeight(a.niveau_alerte)),
    [familleArticles, onlyRupture],
  );

  const ruptureHorizonCounts = useMemo(() => {
    const horizons = [8, 12, 16, 20, 24];
    const enRupture = familleArticles.filter((a) => isCurrentRupture(a));
    const prochaineRupture = familleArticles.map((a) => a.date_rupture).filter((d): d is string => !!d).sort()[0];
    const prochaineLevee = enRupture.map((a) => a.date_retour_dispo).filter((d): d is string => !!d).sort()[0];
    return {
      actuel: enRupture.length,
      parHorizon: horizons.map((sem) => ({ semaines: sem, count: familleArticles.filter((a) => isRuptureWithinWeeks(a, sem)).length })),
      prochaineRupture,
      prochaineLevee,
    };
  }, [familleArticles]);

  const blYtdKpi = useMemo(() => {
    const n = familleArticles.reduce((s, a) => s + toNumber(a.sorties_ytd_n), 0);
    const n1 = familleArticles.reduce((s, a) => s + toNumber(a.sorties_ytd_n1), 0);
    return { n, n1, evolPct: n1 > 0 ? ((n - n1) / n1) * 100 : null };
  }, [familleArticles]);

  const [familleWeeklyRaw, setFamilleWeeklyRaw] = useState<
    Array<{ reference_article: string; periode_debut: string; stock_projete: number; prevision_ventes: number; prevision_base_n1: number; besoins_clients_fermes: number; commandes_fournisseurs_attendues: number; niveau_alerte: string }>
  >([]);
  const [familleWeeklyLoading, setFamilleWeeklyLoading] = useState(false);

  useEffect(() => {
    if (!selectedFamille) {
      setFamilleWeeklyRaw([]);
      return;
    }
    let cancelled = false;
    async function loadFamilleWeekly() {
      setFamilleWeeklyLoading(true);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const params = new URLSearchParams({ famille: selectedFamille as string, depot: "GLOBAL" });
        const res = await fetch(`/api/stocks-disponibilites/famille-detail?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = (await res.json()) as {
          success: boolean;
          message?: string;
          rows?: Array<{
            reference_article: string;
            periode_debut: string;
            stock_projete: number | null;
            prevision_ventes: number | null;
            prevision_base_n1: number | null;
            besoins_clients_fermes: number | null;
            commandes_fournisseurs_attendues: number | null;
            niveau_alerte: string;
          }>;
        };
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Erreur inconnue");
        if (!cancelled) {
          setFamilleWeeklyRaw(
            (payload.rows || []).map((r) => ({
              reference_article: r.reference_article,
              periode_debut: r.periode_debut,
              stock_projete: Number(r.stock_projete || 0),
              prevision_ventes: Number(r.prevision_ventes || 0),
              prevision_base_n1: Number(r.prevision_base_n1 || 0),
              besoins_clients_fermes: Number(r.besoins_clients_fermes || 0),
              commandes_fournisseurs_attendues: Number(r.commandes_fournisseurs_attendues || 0),
              niveau_alerte: r.niveau_alerte,
            })),
          );
        }
      } catch {
        if (!cancelled) setFamilleWeeklyRaw([]);
      } finally {
        if (!cancelled) setFamilleWeeklyLoading(false);
      }
    }
    loadFamilleWeekly();
    return () => {
      cancelled = true;
    };
  }, [selectedFamille, refreshKey]);

  const familleWeekly = useMemo(() => {
    const filtered = searchMatches ? familleWeeklyRaw.filter((r) => searchMatches.has(r.reference_article)) : familleWeeklyRaw;
    const byWeek = new Map<string, { stock_projete: number; sorties_fermes: number; sorties_prevision: number; sorties_n1: number; entrees: number; worst: number }>();
    filtered.forEach((r) => {
      const entry = byWeek.get(r.periode_debut) || { stock_projete: 0, sorties_fermes: 0, sorties_prevision: 0, sorties_n1: 0, entrees: 0, worst: 0 };
      entry.stock_projete += r.stock_projete;
      entry.sorties_fermes += r.besoins_clients_fermes;
      entry.sorties_prevision += r.prevision_ventes;
      entry.sorties_n1 += r.prevision_base_n1;
      entry.entrees += r.commandes_fournisseurs_attendues;
      entry.worst = Math.max(entry.worst, alertWeight(r.niveau_alerte));
      byWeek.set(r.periode_debut, entry);
    });
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periode_debut, v]) => ({
        periode_debut,
        stock_projete: v.stock_projete,
        sorties_fermes: v.sorties_fermes,
        sorties_prevision: v.sorties_prevision,
        sorties_n: v.sorties_fermes + v.sorties_prevision,
        sorties_n1: v.sorties_n1,
        entrees: v.entrees,
        niveau_alerte_max: v.worst >= 3 ? "ROUGE" : v.worst >= 2 ? "ORANGE" : v.worst >= 1 ? "JAUNE" : "VERT",
      }));
  }, [familleWeeklyRaw, searchMatches]);


  const sortiesHorizonKpi = useMemo(() => {
    const n = familleWeekly.reduce((s, r) => s + r.sorties_n, 0);
    const n1 = familleWeekly.reduce((s, r) => s + r.sorties_n1, 0);
    const entrees = familleWeekly.reduce((s, r) => s + r.entrees, 0);
    return { n, n1, evolPct: n1 > 0 ? ((n - n1) / n1) * 100 : null, approFerme: entrees, manque: Math.max(0, n - entrees) };
  }, [familleWeekly]);

  const stockEvolutionKpi = useMemo(() => {
    if (familleWeekly.length < 2) return null;
    const first = familleWeekly[0].stock_projete;
    const last = familleWeekly[familleWeekly.length - 1].stock_projete;
    return { first, last, deltaPct: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null };
  }, [familleWeekly]);

  const [monthlyReelRaw, setMonthlyReelRaw] = useState<Array<{ annee: number; mois: number; reference_article: string; quantite: number }>>([]);

  useEffect(() => {
    if (!selectedFamille) {
      setMonthlyReelRaw([]);
      return;
    }
    let cancelled = false;
    async function loadMensuelReel() {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const params = new URLSearchParams({ famille: selectedFamille as string, annee: String(new Date().getFullYear()) });
        const res = await fetch(`/api/stocks-disponibilites/famille-mensuel-reel?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = (await res.json()) as { success: boolean; rows?: Array<{ annee: number; mois: number; reference_article: string; quantite: number }> };
        if (res.ok && payload.success && !cancelled) setMonthlyReelRaw(payload.rows || []);
      } catch {
        if (!cancelled) setMonthlyReelRaw([]);
      }
    }
    loadMensuelReel();
    return () => {
      cancelled = true;
    };
  }, [selectedFamille, refreshKey]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const monthlyChartData = useMemo(() => {
    const filteredReel = searchMatches ? monthlyReelRaw.filter((r) => searchMatches.has(r.reference_article)) : monthlyReelRaw;
    const reelByMonth = new Map<string, { n: number; n1: number }>();
    filteredReel.forEach((r) => {
      const key = String(r.mois).padStart(2, "0");
      const bucket = r.annee === currentYear ? "n" : "n1";
      const entry = reelByMonth.get(key) || { n: 0, n1: 0 };
      entry[bucket] += r.quantite;
      reelByMonth.set(key, entry);
    });

    const forecastByMonth = new Map<string, number>();
    familleWeekly.forEach((r) => {
      const month = r.periode_debut.slice(5, 7);
      forecastByMonth.set(month, (forecastByMonth.get(month) || 0) + r.sorties_n);
    });

    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
    const currentMonth = todayIso.slice(5, 7);
    return months.map((m) => {
      const reel = reelByMonth.get(m);
      const forecast = forecastByMonth.get(m);
      const isFuture = m > currentMonth;
      const n = isFuture ? forecast ?? 0 : reel?.n ?? 0;
      return { month: m, n, n1: reel?.n1 ?? 0, isFuture };
    });
  }, [monthlyReelRaw, familleWeekly, searchMatches, todayIso, currentYear]);

  const ytdEvolution = useMemo(() => {
    const currentMonth = todayIso.slice(5, 7);
    const past = monthlyChartData.filter((m) => m.month <= currentMonth);
    const n = past.reduce((s, m) => s + m.n, 0);
    const n1 = past.reduce((s, m) => s + m.n1, 0);
    return n1 > 0 ? ((n - n1) / n1) * 100 : null;
  }, [monthlyChartData, todayIso]);

  const forecastEvolution = useMemo(() => {
    const currentMonth = todayIso.slice(5, 7);
    const future = monthlyChartData.filter((m) => m.month > currentMonth);
    const n = future.reduce((s, m) => s + m.n, 0);
    const n1 = future.reduce((s, m) => s + m.n1, 0);
    return n1 > 0 ? ((n - n1) / n1) * 100 : null;
  }, [monthlyChartData, todayIso]);

  type RebuildContinuation = Record<string, unknown> | null;
  type RebuildPayload = { success: boolean; message?: string; done: boolean; continuation: RebuildContinuation; progress: { percent: number; message: string } };

  async function handleRecalculerGlobal() {
    setRebuildProgress({ percent: 0, message: "Démarrage…" });
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      let continuation: RebuildContinuation = { nb_semaines: horizonWeeks, scenario_prevision_pct: scenarioPct / 100, date_debut: todayIso };
      let done = false;
      while (!done) {
        const res: Response = await fetch("/api/stocks-disponibilites/rebuild", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(continuation),
        });
        const payload = (await res.json()) as RebuildPayload;
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Échec du recalcul");
        setRebuildProgress({ percent: payload.progress.percent, message: payload.progress.message });
        done = payload.done;
        continuation = payload.continuation;
      }
      setRebuildProgress({ percent: 100, message: "Terminé — actualisation…" });
      await loadMainData();
      setRefreshKey((k) => k + 1);
      setTimeout(() => setRebuildProgress(null), 2000);
    } catch (e) {
      setRebuildProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    }
  }

  async function handleRecalculerScope() {
    if (!runId) {
      setError("Aucun run actif — lancez d'abord un recalcul complet.");
      return;
    }
    const cle = recalcScope === "famille" ? selectedFamille : selectedMacro;
    if (!cle) return;
    setRebuildProgress({ percent: 0, message: `Recalcul de ${cle}…` });
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch("/api/stocks-disponibilites/recalculer-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ run_id: runId, scope: recalcScope, cle, depot: "GLOBAL", scenario_prevision_pct: scenarioPct / 100 }),
      });
      const payload = (await res.json()) as { success: boolean; message?: string; articles_traites?: number; articles_total?: number };
      if (!res.ok || !payload.success) throw new Error(payload?.message || "Échec du recalcul");
      setRebuildProgress({ percent: 100, message: `${payload.articles_traites}/${payload.articles_total} article(s) recalculé(s)` });
      await loadMainData();
      setRefreshKey((k) => k + 1);
      setTimeout(() => setRebuildProgress(null), 2000);
    } catch (e) {
      setRebuildProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    }
  }

  const canRecalcScope = recalcScope !== "all" && ((recalcScope === "famille" && selectedFamille) || (recalcScope === "famille_macro" && selectedMacro));

  return (
    <div className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen w-full`} style={{ background: "#0B1220", fontFamily: "var(--font-body)" }}>
      <div className="sticky z-10 border-b border-white/10 bg-[#0B1220]/97 backdrop-blur" style={{ top: headerOffset }}>
        <div className="w-full px-6 py-4 md:px-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em] text-[#A6A181]">CEGECLIM — Stocks &amp; disponibilités</div>
              <h1 className="font-[var(--font-display)] text-2xl font-bold text-white md:text-3xl">Projections stock</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Horizon (sem.)</label>
                <input type="number" min={1} max={104} value={horizonWeeks} onChange={(e) => setHorizonWeeks(Number(e.target.value))} className="w-20 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]" />
                {selectedFamille && familleWeekly.length > 0 && familleWeekly.length !== horizonWeeks && (
                  <span className="text-[11px] text-[#D69A4A]" title="Les données affichées viennent du dernier recalcul terminé, pas forcément de ce réglage">
                    (données chargées : {familleWeekly.length} sem.)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Scénario %</label>
                <input type="number" min={0} value={scenarioPct} onChange={(e) => setScenarioPct(Number(e.target.value))} className="w-20 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wide text-white/40">Périmètre</label>
                <select value={recalcScope} onChange={(e) => setRecalcScope(e.target.value as typeof recalcScope)} className="rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]">
                  <option value="all" className="bg-[#101A2E]">Tous les articles</option>
                  <option value="famille_macro" className="bg-[#101A2E]" disabled={!selectedMacro}>Famille macro {selectedMacro ? `(${selectedMacro})` : ""}</option>
                  <option value="famille" className="bg-[#101A2E]" disabled={!selectedFamille}>Famille {selectedFamille ? `(${selectedFamille})` : ""}</option>
                </select>
              </div>
              <button onClick={recalcScope === "all" ? handleRecalculerGlobal : handleRecalculerScope} disabled={(!!rebuildProgress && rebuildProgress.percent < 100) || (recalcScope !== "all" && !canRecalcScope)} className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] transition hover:brightness-110 disabled:opacity-50">
                {recalcScope === "all" ? "Recalculer tout" : `Recalculer ${recalcScope === "famille" ? "cette famille" : "cette famille macro"}`}
              </button>
            </div>
          </div>

          {rebuildProgress && (
            <div className="mb-3 rounded-lg border border-white/10 bg-white/5 px-4 py-2">
              <div className="mb-1 flex justify-between text-xs text-white/60">
                <span>{rebuildProgress.message}</span>
                <span>{rebuildProgress.percent}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10">
                <div className="h-1.5 rounded-full bg-[#4B92AC] transition-all" style={{ width: `${rebuildProgress.percent}%` }} />
              </div>
              {rebuildProgress.percent < 100 && (
                <p className="mt-1.5 text-[11px] text-[#D69A4A]">
                  Le calcul complet peut prendre plusieurs minutes — gardez cet onglet ouvert et actif jusqu&rsquo;à la fin, sinon il restera bloqué à mi-parcours.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Breadcrumb label="Toutes les familles" active={level === "macro"} onClick={() => setLevel("macro")} />
            {selectedMacro && (
              <>
                <span className="text-white/20">/</span>
                <Breadcrumb label={selectedMacro} active={level === "famille"} onClick={() => setLevel("famille")} />
              </>
            )}
            {selectedFamille && (
              <>
                <span className="text-white/20">/</span>
                <Breadcrumb label={selectedFamille} active={level === "article"} onClick={() => setLevel("article")} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="w-full px-6 py-8 md:px-10">
        {error && <div className="mb-6 rounded-lg border border-[#C1683C]/40 bg-[#C1683C]/10 px-4 py-3 text-sm text-[#e0a685]">{error}</div>}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
            ))}
          </div>
        ) : level === "macro" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {macroCards.map((c) => (
              <FamilyCard key={c.key} title={c.key} nbArticles={c.nbArticles} nbRupture={c.nbRupture} caRisque={c.caRisque} worstAlert={c.worstAlert} onClick={() => { setSelectedMacro(c.key); setLevel("famille"); }} />
            ))}
          </div>
        ) : level === "famille" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {familleCards.map((c) => (
              <FamilyCard key={c.key} title={c.key} nbArticles={c.nbArticles} nbRupture={c.nbRupture} caRisque={c.caRisque} worstAlert={c.worstAlert} onClick={() => { setSelectedFamille(c.key); setLevel("article"); }} />
            ))}
          </div>
        ) : (
          <div>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher référence ou désignation… (filtre les KPI et les graphiques)" className="min-w-[280px] flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#A6A181]" />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/60">
                <input type="checkbox" checked={onlyRupture} onChange={(e) => setOnlyRupture(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#A6A181]" />
                Avec rupture uniquement
              </label>
              <span className="text-xs text-white/40">
                {search.trim() ? `${familleArticles.length} / ${familleArticlesAll.length} référence(s) filtrée(s)` : `${familleArticlesAll.length} référence(s)`}
              </span>
            </div>

            <FamilleKpiPanel
              nbArticles={familleArticles.length}
              ruptureActuel={ruptureHorizonCounts.actuel}
              parHorizon={ruptureHorizonCounts.parHorizon}
              prochaineRupture={ruptureHorizonCounts.prochaineRupture}
              prochaineLevee={ruptureHorizonCounts.prochaineLevee}
              blYtd={blYtdKpi}
              sortiesHorizon={sortiesHorizonKpi}
              stockEvolution={stockEvolutionKpi}
              horizonWeeks={familleWeekly.length}
            />

            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
                <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Sorties mensuelles — depuis le 1er janvier</h3>
                {familleWeeklyLoading ? (
                  <div className="h-64 animate-pulse rounded-lg bg-black/[0.04]" />
                ) : (
                  <MonthlySortiesChart rows={monthlyChartData} todayIso={todayIso} ytdEvolution={ytdEvolution} forecastEvolution={forecastEvolution} />
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
                <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Stock projeté hebdomadaire</h3>
                {familleWeeklyLoading ? (
                  <div className="h-64 animate-pulse rounded-lg bg-black/[0.04]" />
                ) : familleWeekly.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#141A26]/40">Aucune donnée hebdomadaire.</p>
                ) : (
                  <WeeklyStockChart rows={familleWeekly} />
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#F5F3EC]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                    <th className="whitespace-nowrap px-4 py-3">Référence</th>
                    <th className="whitespace-nowrap px-4 py-3">Désignation</th>
                    <th className="whitespace-nowrap px-4 py-3">ABC</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Stock dispo</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">CDC en cmd</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Qté YTD (évol. N-1)</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Manque max</th>
                    <th className="whitespace-nowrap px-4 py-3">Date rupture</th>
                    <th className="whitespace-nowrap px-4 py-3">Levée rupture</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">CA à risque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {articleRows.map((a) => (
                    <tr key={a.reference_article} onClick={() => setSelectedArticle(a)} className="cursor-pointer hover:bg-black/[0.03]">
                      <td className="whitespace-nowrap px-4 py-3 font-[var(--font-mono)] font-medium text-[#141A26]">{a.reference_article}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-[#141A26]/80">{a.designation}</td>
                      <td className="px-4 py-3"><AbcBadge label="CA" value={a.classe_abc_ca} compact /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">{formatNumber(a.stock_initial)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">{formatNumber(a.besoins_clients_fermes)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">
                        {formatNumber(a.sorties_ytd_n)}{" "}
                        {a.sorties_ytd_evol_pct !== null && a.sorties_ytd_evol_pct !== undefined && (
                          <span className={toNumber(a.sorties_ytd_evol_pct) >= 0 ? "text-[#C1683C]" : "text-[#4B92AC]"}>
                            ({toNumber(a.sorties_ytd_evol_pct) >= 0 ? "▲" : "▼"}{Math.abs(toNumber(a.sorties_ytd_evol_pct)).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)] text-[#C1683C]">{formatNumber(a.qte_manquante_max)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#141A26]/60">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: ALERT_COLOR[a.niveau_alerte] || "#8A93A6" }} />
                        {formatDate(a.date_rupture)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#141A26]/60">{formatDate(a.date_retour_dispo)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">{formatCurrencyK(a.ca_client_risque)}</td>
                    </tr>
                  ))}
                  {articleRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-[#141A26]/40">Aucun article sur ce périmètre.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {selectedArticle && <ArticleDrawer article={selectedArticle} runId={runId} onClose={() => setSelectedArticle(null)} />}
    </div>
  );
}

function Breadcrumb({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-1 transition ${active ? "bg-[#A6A181] text-[#141A26] font-medium" : "text-white/50 hover:text-white/80"}`}>
      {label}
    </button>
  );
}

function FamilyCard({ title, nbArticles, nbRupture, caRisque, worstAlert, onClick }: { title: string; nbArticles: number; nbRupture: number; caRisque: number; worstAlert: number; onClick: () => void }) {
  const color = worstAlert >= 3 ? "#C1683C" : worstAlert >= 2 ? "#D69A4A" : worstAlert >= 1 ? "#B8A63A" : "#4B92AC";
  return (
    <button onClick={onClick} className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.06]">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-[var(--font-display)] text-base font-semibold text-white">{title}</span>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      </div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-[var(--font-mono)] text-xl font-semibold text-white">{nbRupture}</span>
        <span className="text-xs text-white/40">en rupture / {nbArticles} articles</span>
      </div>
      <div className="text-sm text-white/50">CA à risque : {formatCurrencyK(caRisque)}</div>
    </button>
  );
}

function EvolBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-white/30">—</span>;
  const up = pct >= 0;
  return (
    <span className={up ? "text-[#C1683C]" : "text-[#4B92AC]"}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function FamilleKpiPanel({
  nbArticles, ruptureActuel, parHorizon, prochaineRupture, prochaineLevee, blYtd, sortiesHorizon, stockEvolution, horizonWeeks,
}: {
  nbArticles: number;
  ruptureActuel: number;
  parHorizon: Array<{ semaines: number; count: number }>;
  prochaineRupture?: string;
  prochaineLevee?: string;
  blYtd: { n: number; n1: number; evolPct: number | null };
  sortiesHorizon: { n: number; n1: number; evolPct: number | null; approFerme: number; manque: number };
  stockEvolution: { first: number; last: number; deltaPct: number | null } | null;
  horizonWeeks: number;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">Ruptures — {nbArticles} article(s)</div>
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-[var(--font-mono)] text-2xl font-semibold text-[#C1683C]">{ruptureActuel}</span>
          <span className="text-xs text-white/40">actuellement</span>
        </div>
        {prochaineRupture && <div className="mb-2 text-xs text-white/50">Prochaine : {formatDate(prochaineRupture)}</div>}
        {prochaineLevee && <div className="mb-3 text-xs text-[#4B92AC]">Prochaine levée : {formatDate(prochaineLevee)}</div>}
        <div className="grid grid-cols-5 gap-1.5">
          {parHorizon.map((h) => (
            <div key={h.semaines} className="rounded-lg bg-white/5 p-1.5 text-center">
              <div className="font-[var(--font-mono)] text-sm font-semibold text-white">{h.count}</div>
              <div className="text-[9px] text-white/35">≤{h.semaines}s</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">BL depuis le 1er janvier</div>
        <div className="mb-1 font-[var(--font-mono)] text-2xl font-semibold text-white">{formatNumber(blYtd.n)}</div>
        <div className="text-xs text-white/40">N-1 : {formatNumber(blYtd.n1)} · <EvolBadge pct={blYtd.evolPct} /></div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">Sorties + fermes — {horizonWeeks} sem.</div>
        <div className="mb-1 font-[var(--font-mono)] text-2xl font-semibold text-white">{formatNumber(sortiesHorizon.n)}</div>
        <div className="mb-2 text-xs text-white/40">N-1 même période : {formatNumber(sortiesHorizon.n1)} · <EvolBadge pct={sortiesHorizon.evolPct} /></div>
        <div className="flex justify-between border-t border-white/10 pt-2 text-xs">
          <span className="text-white/40">Entrées à venir</span>
          <span className="font-[var(--font-mono)] text-white">{formatNumber(sortiesHorizon.approFerme)}</span>
        </div>
        {sortiesHorizon.manque > 0 && (
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-[#C1683C]">Manque estimé</span>
            <span className="font-[var(--font-mono)] font-semibold text-[#C1683C]">{formatNumber(sortiesHorizon.manque)}</span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">Évolution du stock sur la période</div>
        {stockEvolution ? (
          <>
            <div className="mb-1 font-[var(--font-mono)] text-2xl font-semibold text-white">{formatNumber(stockEvolution.last)}</div>
            <div className="text-xs text-white/40">Départ : {formatNumber(stockEvolution.first)} · <EvolBadge pct={stockEvolution.deltaPct} /></div>
          </>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </div>
    </div>
  );
}

const MONTH_LABELS = ["janv.", "fév.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function MonthlySortiesChart({
  rows, todayIso, ytdEvolution, forecastEvolution,
}: {
  rows: Array<{ month: string; n: number; n1: number; isFuture: boolean }>;
  todayIso: string;
  ytdEvolution: number | null;
  forecastEvolution: number | null;
}) {
  const width = 640;
  const height = 300;
  const padding = { top: 40, right: 16, bottom: 44, left: 48 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const currentMonthIdx = Number(todayIso.slice(5, 7)) - 1;
  const maxVal = Math.max(1, ...rows.flatMap((r) => [r.n, r.n1]));
  const minVal = 0;
  const x = (i: number) => padding.left + (i / 11) * innerW;
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal)) * innerH;
  const todayX = x(currentMonthIdx);

  function handleMove(e: React.MouseEvent, i: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const r = rows[i];
    setTooltip({
      x: (x(i) / width) * rect.width,
      y: (y(Math.max(r.n, r.n1)) / height) * rect.height,
      lines: [
        { label: MONTH_LABELS[i], value: "" },
        { label: r.isFuture ? "Prévisionnel N" : "Réel N", value: formatNumber(r.n), color: r.isFuture ? "#C1683C" : "#141A26" },
        { label: "N-1", value: formatNumber(r.n1), color: "#8A93A6" },
      ],
    });
  }

  const segments: Array<{ x1: number; y1: number; x2: number; y2: number; future: boolean }> = [];
  for (let i = 1; i < rows.length; i++) {
    segments.push({ x1: x(i - 1), y1: y(rows[i - 1].n), x2: x(i), y2: y(rows[i].n), future: rows[i].isFuture });
  }

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setTooltip(null)}>
        <YAxis maxVal={maxVal} minVal={minVal} height={height} top={padding.top} innerH={innerH} />

        <line x1={todayX} y1={padding.top} x2={todayX} y2={padding.top + innerH} stroke="#141A26" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.5} />

        <path d={rows.map((r, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(r.n1)}`).join(" ")} fill="none" stroke="#8A93A6" strokeWidth={1.75} strokeDasharray="5 4" />

        {segments.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.future ? "#C1683C" : "#141A26"} strokeWidth={2.75} strokeDasharray={s.future ? "9 5" : undefined} />
        ))}
        {rows.map((r, i) => (
          <circle key={r.month} cx={x(i)} cy={y(r.n)} r={4} fill={r.isFuture ? "#C1683C" : "#141A26"} />
        ))}
        {rows.map((r, i) => (
          <rect key={`hit-${r.month}`} x={x(i) - (innerW / 22)} y={0} width={innerW / 11} height={height} fill="transparent" onMouseMove={(e) => handleMove(e, i)} className="cursor-pointer" />
        ))}

        {rows.map((r, i) => {
          const pct = r.n1 > 0 ? ((r.n - r.n1) / r.n1) * 100 : null;
          if (pct === null) return null;
          return (
            <text key={`pct-${r.month}`} x={x(i)} y={padding.top - 10} fontSize={10} textAnchor="middle" fill="#141A26aa">
              {pct >= 0 ? "+" : ""}{pct.toFixed(0)}%
            </text>
          );
        })}

        <line x1={padding.left} y1={y(0)} x2={width - padding.right} y2={y(0)} stroke="#00000022" />
        {rows.map((r, i) => (
          <text key={`lbl-${r.month}`} x={x(i)} y={height - padding.bottom + 30} fontSize={9} textAnchor="middle" fill="#141A26aa">
            {MONTH_LABELS[i]}
          </text>
        ))}
      </svg>
      <ChartTooltip tooltip={tooltip} />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <div className="rounded-md bg-black/5 px-2 py-1 text-[#141A26]/70">
          Réalisé YTD vs N-1 : <EvolBadge pct={ytdEvolution} />
        </div>
        <div className="rounded-md bg-black/5 px-2 py-1 text-[#141A26]/70">
          Hypothèse fin d&rsquo;année vs N-1 : <EvolBadge pct={forecastEvolution} />
        </div>
      </div>
      <div className="mt-2 flex gap-4 text-[10px] text-[#141A26]/50">
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#141A26] align-middle" /> Réel N</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#C1683C] align-middle" /> Prévisionnel N</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#8A93A6] align-middle" /> N-1</span>
      </div>
      <p className="mt-1.5 text-[10px] italic text-[#141A26]/40">
        Le prévisionnel inclut les CDC fermes, qui ne sont pas affectées par le % d&rsquo;évolution — c&rsquo;est pourquoi il peut dépasser N-1 même à 100%. Détail visible dans le graphique de droite.
      </p>
    </div>
  );
}

function WeeklyStockChart({
  rows,
}: {
  rows: Array<{ periode_debut: string; stock_projete: number; sorties_n: number; sorties_fermes?: number; sorties_prevision?: number; sorties_n1: number; entrees: number; niveau_alerte_max: string }>;
}) {
  const [simQty, setSimQty] = useState(0);
  const [simWeek, setSimWeek] = useState(rows[0]?.periode_debut || "");
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 640;
  const height = 300;
  const padding = { top: 16, right: 16, bottom: 40, left: 48 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const simulated = useMemo(() => {
    if (!simQty || !simWeek) return rows.map((r) => ({ ...r, simMarker: 0 }));
    return rows.map((r) => ({
      ...r,
      simMarker: r.periode_debut === simWeek ? simQty : 0,
      stock_projete: r.periode_debut >= simWeek ? r.stock_projete + simQty : r.stock_projete,
    }));
  }, [rows, simQty, simWeek]);

  const allVals = simulated.flatMap((r) => [r.stock_projete, r.entrees, -r.sorties_n]);
  const maxVal = Math.max(1, ...allVals);
  const minVal = Math.min(0, ...allVals);
  const x = (i: number) => padding.left + (i / Math.max(1, simulated.length - 1)) * innerW;
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH;
  const barWidth = Math.max(2, innerW / simulated.length - 3);

  function handleMove(e: React.MouseEvent, i: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const r = simulated[i];
    setTooltip({
      x: (x(i) / width) * rect.width,
      y: (y(r.stock_projete) / height) * rect.height,
      lines: [
        { label: formatDate(r.periode_debut), value: "" },
        { label: "Stock projeté", value: formatNumber(r.stock_projete), color: ALERT_COLOR[r.niveau_alerte_max] },
        { label: "Entrées à venir", value: formatNumber(r.entrees), color: GREEN },
        ...(r.sorties_fermes !== undefined ? [{ label: "  dont CDC fermes", value: formatNumber(r.sorties_fermes), color: DARK_RED }] : []),
        ...(r.sorties_prevision !== undefined ? [{ label: "  dont prévisionnel pur", value: formatNumber(r.sorties_prevision), color: LIGHT_RED }] : []),
        { label: "Sorties prévisionnelles (total)", value: formatNumber(r.sorties_n) },
        ...(r.simMarker ? [{ label: "Simulation ajoutée ici", value: `+${formatNumber(r.simMarker)}`, color: "#3F9142" }] : []),
      ],
    });
  }

  return (
    <div>
      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setTooltip(null)}>
          <defs>
            <pattern id="hatch-green" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={6} stroke="#3F9142" strokeWidth={3} />
            </pattern>
          </defs>

          <YAxis maxVal={maxVal} minVal={minVal} height={height} top={padding.top} innerH={innerH} />

          {simulated.map((r, i) => (
            <rect key={`in-${r.periode_debut}`} x={x(i) - barWidth / 2} y={y(Math.max(0, r.entrees))} width={barWidth} height={Math.max(0, y(0) - y(Math.max(0, r.entrees)))} fill={GREEN} opacity={0.3} />
          ))}
          {/* Sorties prévisionnelles empilées : CDC fermes (rouge foncé) au plus
              près de zéro, puis prévisionnel pur (rouge clair) au-dessus —
              rend visible la part garantie vs la part purement hypothétique. */}
          {simulated.map((r, i) => {
            const fermes = r.sorties_fermes ?? 0;
            const prevision = r.sorties_prevision ?? r.sorties_n;
            return (
              <g key={`out-${r.periode_debut}`}>
                <rect x={x(i) - barWidth / 2} y={y(0)} width={barWidth} height={Math.max(0, y(-fermes) - y(0))} fill={DARK_RED} opacity={0.55} />
                <rect x={x(i) - barWidth / 2} y={y(-fermes)} width={barWidth} height={Math.max(0, y(-fermes - prevision) - y(-fermes))} fill={LIGHT_RED} opacity={0.35} />
              </g>
            );
          })}
          {simulated.map((r, i) =>
            r.simMarker ? (
              <rect key={`sim-${r.periode_debut}`} x={x(i) - barWidth / 2} y={y(r.stock_projete) - 7} width={barWidth} height={14} fill="url(#hatch-green)" stroke="#3F9142" strokeWidth={1} />
            ) : null,
          )}

          {simulated.slice(1).map((r, i) => (
            <line key={`stock-${r.periode_debut}`} x1={x(i)} y1={y(simulated[i].stock_projete)} x2={x(i + 1)} y2={y(r.stock_projete)} stroke={ALERT_COLOR[r.niveau_alerte_max] || "#4B92AC"} strokeWidth={2.5} />
          ))}
          {simulated.map((r, i) => (
            <rect key={`hit-${r.periode_debut}`} x={x(i) - barWidth / 2} y={0} width={barWidth} height={height} fill="transparent" onMouseMove={(e) => handleMove(e, i)} className="cursor-pointer" />
          ))}

          <line x1={padding.left} y1={y(0)} x2={width - padding.right} y2={y(0)} stroke="#00000033" />
          {simulated.map((r, i) =>
            i % Math.ceil(simulated.length / 8 || 1) === 0 ? (
              <text key={`lbl-${r.periode_debut}`} x={x(i)} y={height - 8} fontSize={9} textAnchor="middle" fill="#141A26aa">
                {formatDate(r.periode_debut).slice(0, 5)}
              </text>
            ) : null,
          )}
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-[10px] text-[#141A26]/50">
        <span>— Stock projeté (couleur = alerte)</span>
        <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: GREEN, opacity: 0.4 }} /> Entrées à venir</span>
        <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: DARK_RED, opacity: 0.55 }} /> Sorties CDC fermes</span>
        <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: LIGHT_RED, opacity: 0.45 }} /> Sorties prévisionnelles pures</span>
        <span><span className="mr-1 inline-block h-2 w-2 border border-[#3F9142] align-middle" style={{ background: "repeating-linear-gradient(45deg, #3F9142 0 2px, transparent 2px 5px)" }} /> Simulation (semaine d&rsquo;injection)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/60 p-2 text-xs">
        <span className="text-[#141A26]/50">Simuler un appro :</span>
        <select value={simWeek} onChange={(e) => setSimWeek(e.target.value)} className="rounded border border-black/10 bg-white px-2 py-1">
          {rows.map((r) => (
            <option key={r.periode_debut} value={r.periode_debut}>{formatDate(r.periode_debut)}</option>
          ))}
        </select>
        <input type="number" value={simQty} onChange={(e) => setSimQty(Number(e.target.value))} className="w-24 rounded border border-black/10 bg-white px-2 py-1" />
        {simQty !== 0 && (
          <button onClick={() => setSimQty(0)} className="text-[#141A26]/40 underline">Réinitialiser</button>
        )}
      </div>
    </div>
  );
}

type FournisseurRow = {
  numero_piece: string;
  fournisseur_code: string | null;
  fournisseur_nom: string | null;
  date_livraison: string | null;
  date_livraison_calculee: string | null;
  quantite_attendue: number;
  montant_ht: number | null;
};

type BesoinClientRow = {
  date_besoin: string;
  quantite_besoin: number;
  montant_ht: number | null;
  nb_commandes: number;
  numeros_pieces: string | null;
};

function ArticleDrawer({ article, runId, onClose }: { article: AlertRow; runId: string | null; onClose: () => void }) {
  const [rows, setRows] = useState<ProjectionRow[]>([]);
  const [fournisseurs, setFournisseurs] = useState<FournisseurRow[]>([]);
  const [besoinsClients, setBesoinsClients] = useState<BesoinClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const params = new URLSearchParams({ reference_article: article.reference_article, depot: article.depot || "GLOBAL" });
        const res = await fetch(`/api/stocks-disponibilites/detail?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = (await res.json()) as {
          success: boolean;
          message?: string;
          projection?: ProjectionRow[];
          fournisseurs?: FournisseurRow[];
          besoins_clients?: BesoinClientRow[];
        };
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Erreur inconnue");
        if (!cancelled) {
          setRows(payload.projection || []);
          setFournisseurs(payload.fournisseurs || []);
          setBesoinsClients(payload.besoins_clients || []);
        }
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
  }, [article.reference_article, article.depot]);

  const weeklyForChart = useMemo(
    () =>
      rows.map((r) => ({
        periode_debut: r.periode_debut,
        stock_projete: r.stock_projete || 0,
        sorties_fermes: r.besoins_clients_fermes || 0,
        sorties_prevision: r.prevision_ventes || 0,
        sorties_n: (r.prevision_ventes || 0) + (r.besoins_clients_fermes || 0),
        sorties_n1: r.prevision_base_n1 || 0,
        entrees: r.commandes_fournisseurs_attendues || 0,
        niveau_alerte_max: r.niveau_alerte || "VERT",
      })),
    [rows],
  );

  // % d'évolution vs N-1 sur l'ensemble de l'horizon affiché (prévision
  // complémentaire + CDC fermes comparé à la base N-1 des mêmes semaines).
  const horizonEvolution = useMemo(() => {
    const n = rows.reduce((s, r) => s + (r.prevision_ventes || 0) + (r.besoins_clients_fermes || 0), 0);
    const n1 = rows.reduce((s, r) => s + (r.prevision_base_n1 || 0), 0);
    return { n, n1, pct: n1 > 0 ? ((n - n1) / n1) * 100 : null };
  }, [rows]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-5xl overflow-y-auto bg-[#0B1220] p-6 md:p-10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-[#A6A181]">{article.macro_famille} · {article.famille}</div>
            <h2 className="font-[var(--font-display)] text-xl font-bold text-white">{article.reference_article}</h2>
            <div className="text-sm text-white/50">{article.designation}</div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:text-white">Fermer</button>
        </div>

        {error && <div className="mb-4 rounded-lg border border-[#C1683C]/40 bg-[#C1683C]/10 px-4 py-3 text-sm text-[#e0a685]">{error}</div>}

        {loading ? (
          <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
        ) : (
          <>
            <div className="mb-6 rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-[var(--font-display)] text-base font-semibold text-[#141A26]">Stock projeté hebdomadaire</h3>
                <span className="rounded-md bg-black/5 px-2 py-1 text-xs text-[#141A26]/70">
                  Prévision + CDC sur l&rsquo;horizon vs N-1 : <EvolBadge pct={horizonEvolution.pct} />
                </span>
              </div>
              {weeklyForChart.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#141A26]/40">Aucune projection hebdomadaire.</p>
              ) : (
                <WeeklyStockChart rows={weeklyForChart} />
              )}
            </div>

            {/* ---- Détail hebdomadaire : BL N-1, CDC fermes, prévision complémentaire ---- */}
            <div className="mb-6 overflow-x-auto rounded-xl border border-white/10 bg-[#F5F3EC]">
              <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Détail par semaine</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                    <th className="whitespace-nowrap px-4 py-3">Semaine</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">BL N-1</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">CDC fermes</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Prévision complémentaire</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Coefficient appliqué</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Stock projeté</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {rows.map((r) => (
                    <tr key={r.periode_debut}>
                      <td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-[#141A26]">{formatDate(r.periode_debut)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#8A93A6]">{formatNumber(r.prevision_base_n1)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(r.besoins_clients_fermes)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#C1683C]">{formatNumber(r.prevision_ventes)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#141A26]/60">×{toNumber(r.coefficient_prevision_applique).toFixed(2)}</td>
                      <td className={`whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] font-medium ${(r.stock_projete || 0) < 0 ? "text-[#C1683C]" : "text-[#141A26]"}`}>{formatNumber(r.stock_projete)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ---- CDC en cours et commandes fournisseurs ---- */}
            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#F5F3EC]">
                <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">CDC en cours</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                      <th className="whitespace-nowrap px-4 py-3">Date besoin</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Quantité</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Nb cmd</th>
                      <th className="whitespace-nowrap px-4 py-3">Pièces</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {besoinsClients.map((b, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-[#141A26]">{formatDate(b.date_besoin)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(b.quantite_besoin)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{b.nb_commandes}</td>
                        <td className="max-w-[160px] truncate px-4 py-2 text-xs text-[#141A26]/60">{b.numeros_pieces}</td>
                      </tr>
                    ))}
                    {besoinsClients.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-[#141A26]/40">Aucune CDC ouverte.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#F5F3EC]">
                <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Commandes fournisseurs</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                      <th className="whitespace-nowrap px-4 py-3">Fournisseur</th>
                      <th className="whitespace-nowrap px-4 py-3">Pièce</th>
                      <th className="whitespace-nowrap px-4 py-3">Livraison</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Quantité</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06]">
                    {fournisseurs.map((f, i) => (
                      <tr key={i}>
                        <td className="max-w-[140px] truncate px-4 py-2 text-[#141A26]">{f.fournisseur_nom || f.fournisseur_code}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-xs text-[#141A26]/60">{f.numero_piece}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-[#141A26]">{formatDate(f.date_livraison_calculee || f.date_livraison)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(f.quantite_attendue)}</td>
                      </tr>
                    ))}
                    {fournisseurs.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-[#141A26]/40">Aucune commande fournisseur ouverte.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <ForecastOverridePanel article={article} runId={runId} periods={rows.map((r) => r.periode_debut)} />
          </>
        )}
      </div>
    </div>
  );
}

function ForecastOverridePanel({ article, runId, periods }: { article: AlertRow; runId: string | null; periods: string[] }) {
  const [level, setLevel] = useState<"reference" | "famille" | "famille_macro">("reference");
  const [pct, setPct] = useState(100);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function handleSave() {
    if (level === "reference" && !runId) {
      setSaved("Erreur : aucun run actif — relancez un recalcul complet.");
      return;
    }
    if (!periods.length) {
      setSaved("Erreur : aucune semaine d'horizon disponible — rechargez la fiche article.");
      return;
    }
    setSaving(true);
    setSaved(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const action = level === "reference" ? "weekly_assumptions" : level === "famille" ? "weekly_assumptions_famille" : "weekly_assumptions_famille_macro";
      // Applique le coefficient à TOUTES les semaines de l'horizon affiché,
      // pas seulement à la semaine en cours — sinon les autres semaines
      // retombent silencieusement sur le scénario % par défaut au recalcul.
      const bodyReq: Record<string, unknown> = {
        action,
        assumptions: periods.map((periode_debut) => ({ periode_debut, coefficient_prevision: pct / 100, quantite_prevision_forcee: null })),
      };
      if (level === "reference") {
        bodyReq.run_id = runId;
        bodyReq.reference_article = article.reference_article;
        bodyReq.depot = article.depot || "GLOBAL";
      } else {
        bodyReq.cle = level === "famille" ? article.famille : article.macro_famille;
        bodyReq.depot = "GLOBAL";
      }
      const res = await fetch("/api/stocks-disponibilites/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(bodyReq),
      });
      const payload = (await res.json()) as { success: boolean; message?: string; requires_full_rebuild?: boolean; updated_weeks?: number };
      if (!res.ok || !payload.success) throw new Error(payload?.message || "Échec de l'enregistrement");
      const weeksMsg = `${periods.length} semaine(s) mises à jour.`;
      setSaved(
        payload.requires_full_rebuild
          ? `${weeksMsg} Utilisez « Recalculer cette famille/famille macro » (en haut de page) pour l'appliquer.`
          : `${weeksMsg} Recalculé.`,
      );
    } catch (e) {
      setSaved(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-white">Ajuster la prévision</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["reference", "famille", "famille_macro"] as const).map((l) => (
          <button key={l} onClick={() => setLevel(l)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${level === l ? "bg-[#A6A181] text-[#141A26]" : "bg-white/5 text-white/50 hover:text-white/80"}`}>
            {l === "reference" ? "Cette référence" : l === "famille" ? `Famille ${article.famille}` : `Famille macro ${article.macro_famille}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wide text-white/40">Évolution vs N-1</label>
          <input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-24 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white" />
          <span className="text-sm text-white/40">%</span>
        </div>
        <button onClick={handleSave} disabled={saving} className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] hover:brightness-110 disabled:opacity-50">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
      {level !== "reference" && (
        <p className="mt-2 text-xs text-[#D69A4A]">
          Utilisez ensuite le sélecteur « Périmètre » en haut de page et le bouton « Recalculer cette famille/famille macro » pour l&rsquo;appliquer — chaque article garde sa propre hypothèse si elle est plus spécifique.
        </p>
      )}
      {saved && <p className="mt-2 text-xs text-white/60">{saved}</p>}
    </div>
  );
}
