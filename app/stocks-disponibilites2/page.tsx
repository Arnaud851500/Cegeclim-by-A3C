"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";
import PanneauRemplacements from "@/components/PanneauRemplacements";
import {
  type ProjectionRow,
  type StockAlertRow,
  formatNumber,
  formatCurrencyK,
  formatDate,
  isCurrentRupture,
  isRuptureWithinWeeks,
  toNumber,
} from "../stocks-disponibilites/page";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

type AlertRow = StockAlertRow & {
  statut_substitution?: string;
  prevision_base_n1_origine?: number;
  prevision_transferee_entrante?: number;
};
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
const VIOLET = "#7A5EA8";

function alertWeight(level: string): number {
  return level === "ROUGE" ? 3 : level === "ORANGE" ? 2 : level === "JAUNE" ? 1 : 0;
}

function useSiteHeaderOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = document.querySelector('[data-cegeclim-header="true"]') as HTMLElement | null;
    if (!el) return;
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

function PastilleSubstitution({ statut }: { statut: string }) {
  if (!statut || statut === "ACTIVE") return null;
  const config: Record<string, { libelle: string; titre: string; fond: string; texte: string; icone: string }> = {
    REMPLACEE: { libelle: "Remplacée", titre: "Référence remplacée : ses besoins sont transférés, sa prévision est nulle", fond: "rgba(20,26,38,0.08)", texte: "#141A2699", icone: "\u2192" },
    PARTIELLE: { libelle: "Partielle", titre: "Une partie seulement des besoins est transférée vers une remplaçante", fond: "rgba(193,104,60,0.14)", texte: "#9C4A24", icone: "\u2192" },
    REMPLACANTE: { libelle: "Remplaçante", titre: "Référence remplaçante : elle reprend l'historique d'une ou plusieurs références", fond: "rgba(63,145,66,0.14)", texte: "#2F6B31", icone: "\u2605" },
  };
  const c = config[statut];
  if (!c) return null;
  return (
    <span title={c.titre} className="ml-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: c.fond, color: c.texte }}>
      <span aria-hidden="true">{c.icone}</span>
      {c.libelle}
    </span>
  );
}

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
  const [includeRetard, setIncludeRetard] = useState(false);
  const [masquerRemplacees, setMasquerRemplacees] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [exportGranularite, setExportGranularite] = useState<"mensuel" | "hebdo">("mensuel");

  const [scopeOverrideAsk, setScopeOverrideAsk] = useState<
    { cle: string; articlesTotal: number; articlesSpecifiques: number; coefficients: number[]; references: string[]; referencesTronquees: boolean } | null
  >(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [remplacementPour, setRemplacementPour] = useState<{ reference: string; designation: string } | null>(null);

  async function handleExport() {
    if (!runId) return;
    setExportEnCours(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const params = new URLSearchParams({ granularite: exportGranularite });
      if (selectedFamille) params.set("famille", selectedFamille as string);
      else if (selectedMacro) params.set("macro", selectedMacro as string);
      const res = await fetch(`/api/stocks-disponibilites/export-excel?${params}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const scope = selectedFamille || selectedMacro || "tous";
      a.download = `projection_stock_${scope}_${exportGranularite}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erreur export : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExportEnCours(false);
    }
  }

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

  useEffect(() => { loadMainData(); }, []);

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
    alertes.filter((a) => (a.macro_famille || "NON RENSEIGNÉ") === selectedMacro).forEach((a) => {
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
    return new Set(familleArticlesAll.filter((a) => a.reference_article.toLowerCase().includes(s) || (a.designation || "").toLowerCase().includes(s)).map((a) => a.reference_article));
  }, [familleArticlesAll, search]);

  const familleArticles = useMemo(() => {
    if (!searchMatches) return familleArticlesAll;
    return familleArticlesAll.filter((a) => searchMatches.has(a.reference_article));
  }, [familleArticlesAll, searchMatches]);

  const articleRows = useMemo(() =>
    familleArticles
      .filter((a) => !onlyRupture || a.niveau_alerte === "ROUGE" || a.niveau_alerte === "ORANGE")
      .filter((a) => !masquerRemplacees || (a.statut_substitution || "ACTIVE") !== "REMPLACEE")
      .sort((a, b) => alertWeight(b.niveau_alerte) - alertWeight(a.niveau_alerte)),
    [familleArticles, onlyRupture, masquerRemplacees]);

  const ruptureHorizonCounts = useMemo(() => {
    const horizons = [8, 12, 16, 20, 24];
    const enRupture = familleArticles.filter((a) => isCurrentRupture(a));
    const prochaineRupture = familleArticles.map((a) => a.date_rupture).filter((d): d is string => !!d).sort()[0];
    const prochaineLevee = enRupture.map((a) => a.date_retour_dispo).filter((d): d is string => !!d).sort()[0];
    return { actuel: enRupture.length, parHorizon: horizons.map((sem) => ({ semaines: sem, count: familleArticles.filter((a) => isRuptureWithinWeeks(a, sem)).length })), prochaineRupture, prochaineLevee };
  }, [familleArticles]);

  const blYtdKpi = useMemo(() => {
    const n = familleArticles.reduce((s, a) => s + toNumber(a.sorties_ytd_n), 0);
    const n1 = familleArticles.reduce((s, a) => s + toNumber(a.sorties_ytd_n1), 0);
    return { n, n1, evolPct: n1 > 0 ? ((n - n1) / n1) * 100 : null };
  }, [familleArticles]);

  const [familleWeeklyRaw, setFamilleWeeklyRaw] = useState<Array<{ reference_article: string; periode_debut: string; stock_projete: number; prevision_ventes: number; prevision_base_n1: number; besoins_clients_fermes: number; commandes_fournisseurs_attendues: number; niveau_alerte: string }>>([]);
  const [familleWeeklyLoading, setFamilleWeeklyLoading] = useState(false);

  useEffect(() => {
    if (!selectedFamille) { setFamilleWeeklyRaw([]); return; }
    let cancelled = false;
    async function loadFamilleWeekly() {
      setFamilleWeeklyLoading(true);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const params = new URLSearchParams({ famille: selectedFamille as string, depot: "GLOBAL" });
        const res = await fetch(`/api/stocks-disponibilites/famille-detail?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = (await res.json()) as { success: boolean; message?: string; rows?: Array<{ reference_article: string; periode_debut: string; stock_projete: number | null; prevision_ventes: number | null; prevision_base_n1: number | null; besoins_clients_fermes: number | null; commandes_fournisseurs_attendues: number | null; niveau_alerte: string }> };
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Erreur inconnue");
        if (!cancelled) setFamilleWeeklyRaw((payload.rows || []).map((r) => ({ reference_article: r.reference_article, periode_debut: r.periode_debut, stock_projete: Number(r.stock_projete || 0), prevision_ventes: Number(r.prevision_ventes || 0), prevision_base_n1: Number(r.prevision_base_n1 || 0), besoins_clients_fermes: Number(r.besoins_clients_fermes || 0), commandes_fournisseurs_attendues: Number(r.commandes_fournisseurs_attendues || 0), niveau_alerte: r.niveau_alerte })));
      } catch { if (!cancelled) setFamilleWeeklyRaw([]); }
      finally { if (!cancelled) setFamilleWeeklyLoading(false); }
    }
    loadFamilleWeekly();
    return () => { cancelled = true; };
  }, [selectedFamille, refreshKey]);

  const [retardsRaw, setRetardsRaw] = useState<Array<{ reference_article: string; quantite: number; coefficient: number; statutSubstitution: string; baseOrigine: number; transfereeEntrante: number }>>([]);
  const [retardError, setRetardError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFamille) { setRetardsRaw([]); return; }
    let cancelled = false;
    async function loadRetards() {
      const { data, error: err } = await supabase.from("v_stock_projection_hebdo_latest").select("reference_article, besoins_clients_retard, coefficient_prevision_applique, statut_substitution, prevision_base_n1_origine, prevision_transferee_entrante").eq("famille", selectedFamille as string);
      if (cancelled) return;
      if (err) { console.warn("[CDC en retard] lecture impossible :", err.message); setRetardError(err.message); setRetardsRaw([]); return; }
      setRetardError(null);
      setRetardsRaw((data || []).map((r) => ({ reference_article: r.reference_article as string, quantite: Number(r.besoins_clients_retard || 0), coefficient: Number(r.coefficient_prevision_applique || 0), statutSubstitution: String(r.statut_substitution || "ACTIVE"), baseOrigine: Number(r.prevision_base_n1_origine || 0), transfereeEntrante: Number(r.prevision_transferee_entrante || 0) })));
    }
    loadRetards();
    return () => { cancelled = true; };
  }, [selectedFamille, refreshKey]);

  const retardByRef = useMemo(() => { const map = new Map<string, number>(); retardsRaw.forEach((r) => map.set(r.reference_article, (map.get(r.reference_article) || 0) + r.quantite)); return map; }, [retardsRaw]);
  const substitutionByRef = useMemo(() => { const map = new Map<string, { statut: string; entrante: number; origineBase: number }>(); retardsRaw.forEach((r) => { if (!r.statutSubstitution || r.statutSubstitution === "ACTIVE") return; map.set(r.reference_article, { statut: r.statutSubstitution, entrante: r.transfereeEntrante, origineBase: r.baseOrigine }); }); return map; }, [retardsRaw]);
  const coefficientByRef = useMemo(() => { const map = new Map<string, number>(); retardsRaw.forEach((r) => { if (!r.coefficient) return; map.set(r.reference_article, Math.max(map.get(r.reference_article) || 0, r.coefficient)); }); return map; }, [retardsRaw]);

  const articleAggregates = useMemo(() => {
    const map = new Map<string, { entrees: number; previsionComplementaire: number; stockTerme: number; derniereSemaine: string }>();
    familleWeeklyRaw.forEach((r) => {
      const entry = map.get(r.reference_article) || { entrees: 0, previsionComplementaire: 0, stockTerme: 0, derniereSemaine: "" };
      entry.entrees += r.commandes_fournisseurs_attendues;
      entry.previsionComplementaire += r.prevision_ventes;
      if (r.periode_debut >= entry.derniereSemaine) { entry.derniereSemaine = r.periode_debut; entry.stockTerme = r.stock_projete; }
      map.set(r.reference_article, entry);
    });
    return map;
  }, [familleWeeklyRaw]);

  const familleWeekly = useMemo(() => {
    const filtered = searchMatches ? familleWeeklyRaw.filter((r) => searchMatches.has(r.reference_article)) : familleWeeklyRaw;
    const byWeek = new Map<string, { stock_projete: number; sorties_fermes: number; sorties_prevision: number; sorties_n1: number; entrees: number; worst: number }>();
    filtered.forEach((r) => {
      const entry = byWeek.get(r.periode_debut) || { stock_projete: 0, sorties_fermes: 0, sorties_prevision: 0, sorties_n1: 0, entrees: 0, worst: 0 };
      entry.stock_projete += r.stock_projete; entry.sorties_fermes += r.besoins_clients_fermes; entry.sorties_prevision += r.prevision_ventes; entry.sorties_n1 += r.prevision_base_n1; entry.entrees += r.commandes_fournisseurs_attendues; entry.worst = Math.max(entry.worst, alertWeight(r.niveau_alerte));
      byWeek.set(r.periode_debut, entry);
    });
    const refsAffichees = new Set(filtered.map((r) => r.reference_article));
    let retardTotal = 0;
    retardByRef.forEach((qte, ref) => { if (refsAffichees.has(ref)) retardTotal += qte; });
    return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([periode_debut, v], index) => ({ periode_debut, stock_projete: v.stock_projete, sorties_fermes: v.sorties_fermes, sorties_prevision: v.sorties_prevision, sorties_retard: index === 0 ? retardTotal : 0, sorties_n: v.sorties_fermes + v.sorties_prevision, sorties_n1: v.sorties_n1, entrees: v.entrees, niveau_alerte_max: v.worst >= 3 ? "ROUGE" : v.worst >= 2 ? "ORANGE" : v.worst >= 1 ? "JAUNE" : "VERT" }));
  }, [familleWeeklyRaw, searchMatches, retardByRef]);

  const sortiesHorizonKpi = useMemo(() => {
    const n = familleWeekly.reduce((s, r) => s + r.sorties_n + (includeRetard ? r.sorties_retard : 0), 0);
    const n1 = familleWeekly.reduce((s, r) => s + r.sorties_n1, 0);
    const entrees = familleWeekly.reduce((s, r) => s + r.entrees, 0);
    return { n, n1, evolPct: n1 > 0 ? ((n - n1) / n1) * 100 : null, approFerme: entrees, manque: Math.max(0, n - entrees) };
  }, [familleWeekly, includeRetard]);

  const stockEvolutionKpi = useMemo(() => {
    if (familleWeekly.length < 2) return null;
    const first = familleWeekly[0].stock_projete; const last = familleWeekly[familleWeekly.length - 1].stock_projete;
    return { first, last, deltaPct: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null };
  }, [familleWeekly]);

  const [monthlyReelRaw, setMonthlyReelRaw] = useState<Array<{ annee: number; mois: number; reference_article: string; quantite: number }>>([]);

  useEffect(() => {
    if (!selectedFamille) { setMonthlyReelRaw([]); return; }
    let cancelled = false;
    async function loadMensuelReel() {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const params = new URLSearchParams({ famille: selectedFamille as string, annee: String(new Date().getFullYear()) });
        const res = await fetch(`/api/stocks-disponibilites/famille-mensuel-reel?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = (await res.json()) as { success: boolean; rows?: Array<{ annee: number; mois: number; reference_article: string; quantite: number }> };
        if (res.ok && payload.success && !cancelled) setMonthlyReelRaw(payload.rows || []);
      } catch { if (!cancelled) setMonthlyReelRaw([]); }
    }
    loadMensuelReel();
    return () => { cancelled = true; };
  }, [selectedFamille, refreshKey]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const monthlyChartData = useMemo(() => {
    const filteredReel = searchMatches ? monthlyReelRaw.filter((r) => searchMatches.has(r.reference_article)) : monthlyReelRaw;
    const reelByMonth = new Map<string, { n: number; n1: number }>();
    filteredReel.forEach((r) => { const key = String(r.mois).padStart(2, "0"); const bucket = r.annee === currentYear ? "n" : "n1"; const entry = reelByMonth.get(key) || { n: 0, n1: 0 }; entry[bucket] += r.quantite; reelByMonth.set(key, entry); });
    const forecastByMonth = new Map<string, number>();
    familleWeekly.forEach((r) => { const month = r.periode_debut.slice(5, 7); forecastByMonth.set(month, (forecastByMonth.get(month) || 0) + r.sorties_n); });
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
    const currentMonth = todayIso.slice(5, 7);
    return months.map((m) => { const reel = reelByMonth.get(m); const forecast = forecastByMonth.get(m); const isFuture = m > currentMonth; const n = isFuture ? forecast ?? 0 : reel?.n ?? 0; return { month: m, n, n1: reel?.n1 ?? 0, isFuture }; });
  }, [monthlyReelRaw, familleWeekly, searchMatches, todayIso, currentYear]);

  const ytdEvolution = useMemo(() => { const currentMonth = todayIso.slice(5, 7); const past = monthlyChartData.filter((m) => m.month <= currentMonth); const n = past.reduce((s, m) => s + m.n, 0); const n1 = past.reduce((s, m) => s + m.n1, 0); return n1 > 0 ? ((n - n1) / n1) * 100 : null; }, [monthlyChartData, todayIso]);
  const forecastEvolution = useMemo(() => { const currentMonth = todayIso.slice(5, 7); const future = monthlyChartData.filter((m) => m.month > currentMonth); const n = future.reduce((s, m) => s + m.n, 0); const n1 = future.reduce((s, m) => s + m.n1, 0); return n1 > 0 ? ((n - n1) / n1) * 100 : null; }, [monthlyChartData, todayIso]);

  type RebuildContinuation = Record<string, unknown> | null;
  type RebuildPayload = { success: boolean; message?: string; done: boolean; continuation: RebuildContinuation; progress: { percent: number; message: string } };

  async function handleRecalculerGlobal() {
    setRebuildProgress({ percent: 0, message: "Démarrage…" });
    const warnBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      let continuation: RebuildContinuation = { nb_semaines: horizonWeeks, scenario_prevision_pct: scenarioPct / 100, date_debut: todayIso };
      let done = false;
      while (!done) {
        const res: Response = await fetch("/api/stocks-disponibilites/rebuild", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(continuation) });
        const payload = (await res.json()) as RebuildPayload;
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Échec du recalcul");
        setRebuildProgress({ percent: payload.progress.percent, message: payload.progress.message });
        done = payload.done; continuation = payload.continuation;
      }
      setRebuildProgress({ percent: 100, message: "Terminé — actualisation…" });
      await loadMainData(); setRefreshKey((k) => k + 1);
      setTimeout(() => setRebuildProgress(null), 2000);
    } catch (e) { setRebuildProgress(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { window.removeEventListener("beforeunload", warnBeforeUnload); }
  }

  async function handleRecalculerScope() {
    if (!runId) { setError("Aucun run actif — lancez d'abord un recalcul complet."); return; }
    const cle = recalcScope === "famille" ? selectedFamille : selectedMacro;
    if (!cle) return;
    setScopeNotice(null);
    try {
      const { data, error: diagError } = await supabase.rpc("count_stock_scope_article_overrides", { p_run_id: runId, p_scope: recalcScope, p_cle: cle, p_depot: "GLOBAL" });
      if (diagError) throw new Error(diagError.message);
      const diagnostic = data as { articles_total?: number; articles_specifiques?: number; coefficients?: number[]; references?: string[]; references_tronquees?: boolean } | null;
      if ((diagnostic?.articles_specifiques ?? 0) > 0) {
        setScopeOverrideAsk({ cle, articlesTotal: Number(diagnostic?.articles_total || 0), articlesSpecifiques: Number(diagnostic?.articles_specifiques || 0), coefficients: (diagnostic?.coefficients || []).map(Number), references: diagnostic?.references || [], referencesTronquees: Boolean(diagnostic?.references_tronquees) });
        return;
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    await executeRecalculerScope(false);
  }

  async function executeRecalculerScope(ecraserSpecifiques: boolean) {
    if (!runId) return;
    const cle = recalcScope === "famille" ? selectedFamille : selectedMacro;
    if (!cle) return;
    setScopeOverrideAsk(null);
    setRebuildProgress({ percent: 0, message: `Recalcul de ${cle}…` });
    const warnBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    try {
      const { data: payload, error: rpcError } = await supabase.rpc("apply_stock_scenario_scope", { p_run_id: runId, p_scope: recalcScope, p_cle: cle, p_depot: "GLOBAL", p_scenario_pct: scenarioPct / 100, p_ecraser_specifiques: ecraserSpecifiques });
      if (rpcError) throw new Error(rpcError.message);
      const result = payload as { success?: boolean; message?: string; articles_traites?: number; articles_total?: number } | null;
      if (!result?.success) throw new Error(result?.message || "Échec du recalcul");
      setRebuildProgress({ percent: 100, message: result.message || `${result.articles_traites}/${result.articles_total} article(s) recalculé(s)` });
      await loadMainData(); setRefreshKey((k) => k + 1);
      setTimeout(() => setRebuildProgress(null), 2000);
    } catch (e) { setRebuildProgress(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { window.removeEventListener("beforeunload", warnBeforeUnload); }
  }

  const horizonLabel = `${familleWeekly.length || horizonWeeks} sem.`;
  const canRecalcScope = recalcScope !== "all" && ((recalcScope === "famille" && selectedFamille) || (recalcScope === "famille_macro" && selectedMacro));

  // Libellé du périmètre pour le title du bouton Excel
  const exportScopeLabel = selectedFamille ? `famille ${selectedFamille}` : selectedMacro ? `famille macro ${selectedMacro}` : "toutes les références";

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
                  <span className="text-[11px] text-[#D69A4A]" title="Les données affichées viennent du dernier recalcul terminé">(données : {familleWeekly.length} sem.)</span>
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
              <button
                onClick={recalcScope === "all" ? handleRecalculerGlobal : handleRecalculerScope}
                disabled={(!!rebuildProgress && rebuildProgress.percent < 100) || (recalcScope !== "all" && !canRecalcScope)}
                className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] transition hover:brightness-110 disabled:opacity-50"
              >
                {recalcScope === "all" ? "Recalculer tout" : `Recalculer ${recalcScope === "famille" ? "cette famille" : "cette famille macro"}`}
              </button>

              {/* ── Export Excel — visible sur tous les niveaux de navigation ── */}
              <div className="flex items-center gap-2 border-l border-white/15 pl-3">
                <select
                  value={exportGranularite}
                  onChange={(e) => setExportGranularite(e.target.value as "mensuel" | "hebdo")}
                  className="rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]"
                >
                  <option value="mensuel" className="bg-[#101A2E]">Mensuel</option>
                  <option value="hebdo" className="bg-[#101A2E]">Hebdomadaire</option>
                </select>
                <button
                  onClick={() => void handleExport()}
                  disabled={exportEnCours || !runId}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#141A26] transition hover:brightness-110 disabled:opacity-40"
                  style={{ background: "#A6A181" }}
                  title={!runId ? "Lancez d'abord un recalcul de projection" : `Export Excel — ${exportScopeLabel}`}
                >
                  {exportEnCours ? "⏳ Export…" : "⬇ Excel"}
                </button>
              </div>
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
                <p className="mt-1.5 text-[11px] text-[#D69A4A]">Le calcul complet peut prendre plusieurs minutes — gardez cet onglet ouvert et actif jusqu&rsquo;à la fin.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Breadcrumb label="Toutes les familles" active={level === "macro"} onClick={() => { setLevel("macro"); setSelectedMacro(null); setSelectedFamille(null); }} />
            {selectedMacro && (<><span className="text-white/20">/</span><Breadcrumb label={selectedMacro} active={level === "famille"} onClick={() => { setLevel("famille"); setSelectedFamille(null); }} /></>)}
            {selectedFamille && (<><span className="text-white/20">/</span><Breadcrumb label={selectedFamille} active={level === "article"} onClick={() => setLevel("article")} /></>)}
          </div>
        </div>
      </div>

      <div className="w-full px-6 py-8 md:px-10">
        {error && <div className="mb-6 rounded-lg border border-[#C1683C]/40 bg-[#C1683C]/10 px-4 py-3 text-sm text-[#e0a685]">{error}</div>}

        {scopeNotice && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-[#4B92AC]/40 bg-[#4B92AC]/10 px-4 py-3 text-sm text-[#9ecadb]">
            <span>{scopeNotice}</span>
            <button onClick={() => setScopeNotice(null)} className="shrink-0 text-xs font-medium text-white/50 transition hover:text-white">Fermer</button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (<div key={i} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />))}
          </div>
        ) : level === "macro" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {macroCards.map((c) => (<FamilyCard key={c.key} title={c.key} nbArticles={c.nbArticles} nbRupture={c.nbRupture} caRisque={c.caRisque} worstAlert={c.worstAlert} onClick={() => { setSelectedMacro(c.key); setLevel("famille"); }} />))}
          </div>
        ) : level === "famille" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {familleCards.map((c) => (<FamilyCard key={c.key} title={c.key} nbArticles={c.nbArticles} nbRupture={c.nbRupture} caRisque={c.caRisque} worstAlert={c.worstAlert} onClick={() => { setSelectedFamille(c.key); setLevel("article"); }} />))}
          </div>
        ) : (
          <div>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher référence ou désignation… (filtre les KPI et les graphiques)" className="min-w-[280px] flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#A6A181]" />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/60">
                <input type="checkbox" checked={onlyRupture} onChange={(e) => setOnlyRupture(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#A6A181]" />
                Avec rupture uniquement
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/60">
                <input type="checkbox" checked={masquerRemplacees} onChange={(e) => setMasquerRemplacees(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#A6A181]" />
                Masquer les remplacées
              </label>
              <span className="text-xs text-white/40">
                {search.trim() ? `${familleArticles.length} / ${familleArticlesAll.length} référence(s) filtrée(s)` : `${familleArticlesAll.length} référence(s)`}
              </span>
            </div>

            <FamilleKpiPanel
              nbArticles={familleArticles.length} ruptureActuel={ruptureHorizonCounts.actuel} parHorizon={ruptureHorizonCounts.parHorizon}
              prochaineRupture={ruptureHorizonCounts.prochaineRupture} prochaineLevee={ruptureHorizonCounts.prochaineLevee}
              blYtd={blYtdKpi} sortiesHorizon={sortiesHorizonKpi} stockEvolution={stockEvolutionKpi}
              horizonWeeks={familleWeekly.length} retardTotal={familleWeekly[0]?.sorties_retard ?? 0}
              includeRetard={includeRetard} onToggleRetard={setIncludeRetard}
            />

            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
                <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Sorties mensuelles — depuis le 1er janvier</h3>
                {familleWeeklyLoading ? <div className="h-64 animate-pulse rounded-lg bg-black/[0.04]" /> : <MonthlySortiesChart rows={monthlyChartData} todayIso={todayIso} ytdEvolution={ytdEvolution} forecastEvolution={forecastEvolution} />}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
                <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Stock projeté hebdomadaire</h3>
                {retardError && <p className="mb-2 rounded border border-[#C1683C]/30 bg-[#C1683C]/10 px-2 py-1 text-[11px] text-[#8a3e21]">CDC en retard indisponibles : {retardError}</p>}
                {familleWeeklyLoading ? <div className="h-64 animate-pulse rounded-lg bg-black/[0.04]" /> : familleWeekly.length === 0 ? <p className="py-8 text-center text-sm text-[#141A26]/40">Aucune donnée hebdomadaire.</p> : <WeeklyStockChart rows={familleWeekly} includeRetard={includeRetard} onIncludeRetardChange={setIncludeRetard} />}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#F5F3EC]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50">
                    <th className="w-7 px-1 py-3" />
                    <th className="whitespace-nowrap px-4 py-3">Référence</th>
                    <th className="whitespace-nowrap px-4 py-3">Désignation</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Stock dispo</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">CDC en cmd</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right" style={{ color: VIOLET }}>CDC en retard</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Hypothèse</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Prév. complém.</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">À récept. {horizonLabel}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Stock à terme</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Qté YTD (évol. N-1)</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Manque max</th>
                    <th className="whitespace-nowrap px-4 py-3">Date rupture</th>
                    <th className="whitespace-nowrap px-4 py-3">Levée rupture</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {articleRows.map((a) => (
                    <tr key={a.reference_article} onClick={() => setSelectedArticle(a)} className="cursor-pointer hover:bg-black/[0.03]" style={substitutionByRef.get(a.reference_article)?.statut === "REMPLACEE" ? { opacity: 0.55 } : undefined}>
                      <td className="w-7 px-1 py-2 text-center">
                        <button title="Gérer le remplacement de cette référence" onClick={(e) => { e.stopPropagation(); setRemplacementPour({ reference: a.reference_article, designation: a.designation || "" }); }} className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-black/15 text-[#141A26]/45 transition hover:border-[#A6A181] hover:text-[#141A26]">
                          <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8.5 1.5C9.5.5 11.5.5 12.5 1.5S13.5 4.5 12.5 5.5L5 13H1V9Z" /></svg>
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-[var(--font-mono)] font-medium text-[#141A26]">{a.reference_article}<PastilleSubstitution statut={substitutionByRef.get(a.reference_article)?.statut || "ACTIVE"} /></td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-[#141A26]/80">{a.designation}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">{formatNumber(a.stock_initial)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">{formatNumber(a.besoins_clients_fermes)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]" style={{ color: (retardByRef.get(a.reference_article) || 0) > 0 ? VIOLET : "#141A2640", fontWeight: (retardByRef.get(a.reference_article) || 0) > 0 && includeRetard ? 600 : 400 }}>{formatNumber(retardByRef.get(a.reference_article) || 0)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)] text-[#141A26]/70">{coefficientByRef.has(a.reference_article) ? `×${(coefficientByRef.get(a.reference_article) as number).toFixed(2)}` : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)] text-[#C1683C]">{formatNumber(articleAggregates.get(a.reference_article)?.previsionComplementaire ?? 0)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)] text-[#3F9142]">{formatNumber(articleAggregates.get(a.reference_article)?.entrees ?? 0)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)] font-medium ${(articleAggregates.get(a.reference_article)?.stockTerme ?? 0) < 0 ? "text-[#C1683C]" : "text-[#141A26]"}`}>{articleAggregates.has(a.reference_article) ? formatNumber(articleAggregates.get(a.reference_article)?.stockTerme ?? 0) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)]">{formatNumber(a.sorties_ytd_n)}{" "}{a.sorties_ytd_evol_pct !== null && a.sorties_ytd_evol_pct !== undefined && (<span className={toNumber(a.sorties_ytd_evol_pct) >= 0 ? "text-[#C1683C]" : "text-[#4B92AC]"}>({toNumber(a.sorties_ytd_evol_pct) >= 0 ? "▲" : "▼"}{Math.abs(toNumber(a.sorties_ytd_evol_pct)).toFixed(0)}%)</span>)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-[var(--font-mono)] text-[#C1683C]">{formatNumber(a.qte_manquante_max)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#141A26]/60"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: ALERT_COLOR[a.niveau_alerte] || "#8A93A6" }} />{formatDate(a.date_rupture)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#141A26]/60">{formatDate(a.date_retour_dispo)}</td>
                    </tr>
                  ))}
                  {articleRows.length === 0 && (<tr><td colSpan={14} className="px-4 py-8 text-center text-[#141A26]/40">Aucun article sur ce périmètre.</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {scopeOverrideAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#060A12]/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#101A2E] p-6 shadow-2xl">
            <h3 className="font-[var(--font-display)] text-lg font-semibold text-white">Des % d&rsquo;évolutions sont spécifiques dans cette famille</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/70">Voulez-vous écraser les hypothèses actuelles par celle-ci&nbsp;?</p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-xs text-white/60">
              <div className="flex justify-between gap-4"><span>Périmètre</span><span className="font-[var(--font-mono)] text-white/85">{scopeOverrideAsk.cle}</span></div>
              <div className="mt-2 flex justify-between gap-4"><span>Références avec hypothèse propre</span><span className="font-[var(--font-mono)] text-white/85">{scopeOverrideAsk.articlesSpecifiques} / {scopeOverrideAsk.articlesTotal}</span></div>
              {scopeOverrideAsk.coefficients.length > 0 && (<div className="mt-2 flex justify-between gap-4"><span>Coefficients en place</span><span className="font-[var(--font-mono)] text-white/85">{scopeOverrideAsk.coefficients.map((c) => `×${c.toFixed(2)}`).join(" · ")}</span></div>)}
              <div className="mt-2 flex justify-between gap-4"><span>Nouvelle hypothèse</span><span className="font-[var(--font-mono)] text-[#A6A181]">×{(scenarioPct / 100).toFixed(2)}</span></div>
              {scopeOverrideAsk.references.length > 0 && (<div className="mt-3 border-t border-white/10 pt-3 font-[var(--font-mono)] text-[11px] leading-relaxed text-white/45">{scopeOverrideAsk.references.join(", ")}{scopeOverrideAsk.referencesTronquees ? "…" : ""}</div>)}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => { setScopeOverrideAsk(null); setScopeNotice("Modifier dans ce cas chaque article selon vos souhaits."); }} className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white">Non</button>
              <button onClick={() => void executeRecalculerScope(true)} className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] transition hover:brightness-110">Oui, écraser et appliquer</button>
            </div>
          </div>
        </div>
      )}

      {remplacementPour && (<PanneauRemplacements referenceSource={remplacementPour.reference} designationSource={remplacementPour.designation} runId={runId} onClose={() => setRemplacementPour(null)} onApplied={() => { setRefreshKey((k) => k + 1); }} />)}

      {selectedArticle && (<ArticleDrawer article={selectedArticle} runId={runId} includeRetard={includeRetard} onIncludeRetardChange={setIncludeRetard} onClose={() => setSelectedArticle(null)} substitutionByRef={substitutionByRef} />)}
    </div>
  );
}

function Breadcrumb({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (<button onClick={onClick} className={`rounded-full px-3 py-1 transition ${active ? "bg-[#A6A181] text-[#141A26] font-medium" : "text-white/50 hover:text-white/80"}`}>{label}</button>);
}

function FamilyCard({ title, nbArticles, nbRupture, caRisque, worstAlert, onClick }: { title: string; nbArticles: number; nbRupture: number; caRisque: number; worstAlert: number; onClick: () => void }) {
  const color = worstAlert >= 3 ? "#C1683C" : worstAlert >= 2 ? "#D69A4A" : worstAlert >= 1 ? "#B8A63A" : "#4B92AC";
  return (
    <button onClick={onClick} className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.06]">
      <div className="mb-3 flex items-center justify-between"><span className="font-[var(--font-display)] text-base font-semibold text-white">{title}</span><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /></div>
      <div className="mb-2 flex items-baseline gap-2"><span className="font-[var(--font-mono)] text-xl font-semibold text-white">{nbRupture}</span><span className="text-xs text-white/40">en rupture / {nbArticles} articles</span></div>
      <div className="text-sm text-white/50">CA à risque : {formatCurrencyK(caRisque)}</div>
    </button>
  );
}

function EvolBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-white/30">—</span>;
  const up = pct >= 0;
  return <span className={up ? "text-[#C1683C]" : "text-[#4B92AC]"}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>;
}

function FamilleKpiPanel({ nbArticles, ruptureActuel, parHorizon, prochaineRupture, prochaineLevee, blYtd, sortiesHorizon, stockEvolution, horizonWeeks, retardTotal, includeRetard, onToggleRetard }: {
  nbArticles: number; ruptureActuel: number; parHorizon: Array<{ semaines: number; count: number }>; prochaineRupture?: string; prochaineLevee?: string;
  blYtd: { n: number; n1: number; evolPct: number | null }; sortiesHorizon: { n: number; n1: number; evolPct: number | null; approFerme: number; manque: number };
  stockEvolution: { first: number; last: number; deltaPct: number | null } | null; horizonWeeks: number; retardTotal: number; includeRetard: boolean; onToggleRetard: (value: boolean) => void;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">Ruptures — {nbArticles} article(s)</div>
        <div className="mb-2 flex items-baseline gap-2"><span className="font-[var(--font-mono)] text-[2.25rem] font-semibold leading-none text-[#C1683C]">{ruptureActuel}</span><span className="text-xs text-white/40">actuellement</span></div>
        {prochaineRupture && <div className="mb-1 text-xs text-white/50">Prochaine : {formatDate(prochaineRupture)}</div>}
        {prochaineLevee && <div className="mb-3 text-xs text-[#4B92AC]">Prochaine levée : {formatDate(prochaineLevee)}</div>}
        <div className="grid grid-cols-5 gap-1.5">
          {parHorizon.map((h) => (<div key={h.semaines} className="rounded-lg bg-white/5 p-1.5 text-center"><div className="font-[var(--font-mono)] text-base font-semibold text-white">{h.count}</div><div className="text-[9px] text-white/35">≤{h.semaines}s</div></div>))}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">BL depuis le 1er janvier</div>
        <div className="font-[var(--font-mono)] text-[2.25rem] font-semibold leading-none text-white">{formatNumber(blYtd.n)}</div>
        <div className="mt-2 text-xs text-white/40">N-1 : {formatNumber(blYtd.n1)} · <EvolBadge pct={blYtd.evolPct} /></div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">Sorties + fermes — {horizonWeeks} sem.</div>
        <div className="font-[var(--font-mono)] text-[2.25rem] font-semibold leading-none text-white">{formatNumber(sortiesHorizon.n)}</div>
        <div className="mt-2 text-xs text-white/40">N-1 même période : {formatNumber(sortiesHorizon.n1)} · <EvolBadge pct={sortiesHorizon.evolPct} /></div>
        <div className="mt-4 rounded-lg border border-[#7A5EA8]/30 bg-[#7A5EA8]/[0.10] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/45"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: VIOLET }} />CDC en retard · livraison passée</div>
          <div className="flex items-end justify-between gap-3">
            <span className="font-[var(--font-mono)] text-[1.75rem] font-semibold leading-none" style={{ color: "#B79BE0" }}>{formatNumber(retardTotal)}</span>
            <button type="button" disabled={retardTotal === 0} onClick={() => onToggleRetard(!includeRetard)} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${includeRetard && retardTotal > 0 ? "bg-[#7A5EA8]/35 text-[#D8C9F2] hover:bg-[#7A5EA8]/50" : "bg-white/10 text-white/50 hover:bg-white/20"}`}>
              {retardTotal === 0 ? "Aucun retard" : includeRetard ? "Pris en compte" : "Non pris en compte"}
            </button>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">Évolution du stock sur la période</div>
        {stockEvolution ? (<><div className="font-[var(--font-mono)] text-[2.25rem] font-semibold leading-none text-white">{formatNumber(stockEvolution.last)}</div><div className="mt-2 text-xs text-white/40">Départ : {formatNumber(stockEvolution.first)} · <EvolBadge pct={stockEvolution.deltaPct} /></div></>) : <span className="text-white/30">—</span>}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3">
          <div><div className="mb-1 text-[10px] uppercase tracking-wide text-white/40">Entrées à venir</div><div className="font-[var(--font-mono)] text-[1.75rem] font-semibold leading-none text-[#3F9142]">{formatNumber(sortiesHorizon.approFerme)}</div><div className="mt-1 text-[10px] text-white/30">Cmd fournisseurs</div></div>
          <div className="text-right"><div className="mb-1 text-[10px] uppercase tracking-wide text-white/40">Manque estimé</div><div className={`font-[var(--font-mono)] text-[1.75rem] font-semibold leading-none ${sortiesHorizon.manque > 0 ? "text-[#C1683C]" : "text-white/35"}`}>{formatNumber(sortiesHorizon.manque)}</div><div className="mt-1 text-[10px] text-white/30">Sorties − entrées</div></div>
        </div>
      </div>
    </div>
  );
}

const MONTH_LABELS = ["janv.", "fév.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function MonthlySortiesChart({ rows, todayIso, ytdEvolution, forecastEvolution }: { rows: Array<{ month: string; n: number; n1: number; isFuture: boolean }>; todayIso: string; ytdEvolution: number | null; forecastEvolution: number | null }) {
  const width = 640; const height = 300; const padding = { top: 40, right: 16, bottom: 44, left: 48 }; const innerW = width - padding.left - padding.right; const innerH = height - padding.top - padding.bottom;
  const [tooltip, setTooltip] = useState<TooltipState>(null); const svgRef = useRef<SVGSVGElement>(null);
  const currentMonthIdx = Number(todayIso.slice(5, 7)) - 1; const maxVal = Math.max(1, ...rows.flatMap((r) => [r.n, r.n1]));
  const x = (i: number) => padding.left + (i / 11) * innerW; const y = (v: number) => padding.top + innerH - (v / maxVal) * innerH; const todayX = x(currentMonthIdx);
  function handleMove(e: React.MouseEvent, i: number) { const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return; const r = rows[i]; setTooltip({ x: (x(i) / width) * rect.width, y: (y(Math.max(r.n, r.n1)) / height) * rect.height, lines: [{ label: MONTH_LABELS[i], value: "" }, { label: r.isFuture ? "Prévisionnel N" : "Réel N", value: formatNumber(r.n), color: r.isFuture ? "#C1683C" : "#141A26" }, { label: "N-1", value: formatNumber(r.n1), color: "#8A93A6" }] }); }
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number; future: boolean }> = []; for (let i = 1; i < rows.length; i++) segments.push({ x1: x(i - 1), y1: y(rows[i - 1].n), x2: x(i), y2: y(rows[i].n), future: rows[i].isFuture });
  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setTooltip(null)}>
        <YAxis maxVal={maxVal} minVal={0} height={height} top={padding.top} innerH={innerH} />
        <line x1={todayX} y1={padding.top} x2={todayX} y2={padding.top + innerH} stroke="#141A26" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.5} />
        <path d={rows.map((r, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(r.n1)}`).join(" ")} fill="none" stroke="#8A93A6" strokeWidth={1.75} strokeDasharray="5 4" />
        {segments.map((s, i) => <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.future ? "#C1683C" : "#141A26"} strokeWidth={2.75} strokeDasharray={s.future ? "9 5" : undefined} />)}
        {rows.map((r, i) => <circle key={r.month} cx={x(i)} cy={y(r.n)} r={4} fill={r.isFuture ? "#C1683C" : "#141A26"} />)}
        {rows.map((r, i) => <rect key={`hit-${r.month}`} x={x(i) - (innerW / 22)} y={0} width={innerW / 11} height={height} fill="transparent" onMouseMove={(e) => handleMove(e, i)} className="cursor-pointer" />)}
        {rows.map((r, i) => { const pct = r.n1 > 0 ? ((r.n - r.n1) / r.n1) * 100 : null; if (pct === null) return null; return <text key={`pct-${r.month}`} x={x(i)} y={padding.top - 10} fontSize={10} textAnchor="middle" fill="#141A26aa">{pct >= 0 ? "+" : ""}{pct.toFixed(0)}%</text>; })}
        <line x1={padding.left} y1={y(0)} x2={width - padding.right} y2={y(0)} stroke="#00000022" />
        {rows.map((r, i) => <text key={`lbl-${r.month}`} x={x(i)} y={height - padding.bottom + 30} fontSize={9} textAnchor="middle" fill="#141A26aa">{MONTH_LABELS[i]}</text>)}
      </svg>
      <ChartTooltip tooltip={tooltip} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <div className="rounded-md bg-black/5 px-2 py-1 text-[#141A26]/70">Réalisé YTD vs N-1 : <EvolBadge pct={ytdEvolution} /></div>
        <div className="rounded-md bg-black/5 px-2 py-1 text-[#141A26]/70">Hypothèse fin d&rsquo;année vs N-1 : <EvolBadge pct={forecastEvolution} /></div>
      </div>
      <div className="mt-2 flex gap-4 text-[10px] text-[#141A26]/50">
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#141A26] align-middle" /> Réel N</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#C1683C] align-middle" /> Prévisionnel N</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-[#8A93A6] align-middle" /> N-1</span>
      </div>
      <p className="mt-1.5 text-[10px] italic text-[#141A26]/40">Le prévisionnel inclut les CDC fermes, qui ne sont pas affectées par le % d&rsquo;évolution — c&rsquo;est pourquoi il peut dépasser N-1 même à 100%. Détail visible dans le graphique de droite.</p>
    </div>
  );
}

function WeeklyStockChart({ rows, includeRetard = false, onIncludeRetardChange }: { rows: Array<{ periode_debut: string; stock_projete: number; sorties_n: number; sorties_fermes?: number; sorties_prevision?: number; sorties_retard?: number; sorties_n1: number; entrees: number; niveau_alerte_max: string }>; includeRetard?: boolean; onIncludeRetardChange?: (value: boolean) => void }) {
  const [simQty, setSimQty] = useState(0); const [simWeek, setSimWeek] = useState(rows[0]?.periode_debut || ""); const [tooltip, setTooltip] = useState<TooltipState>(null); const svgRef = useRef<SVGSVGElement>(null);
  const width = 640; const height = 300; const padding = { top: 16, right: 16, bottom: 40, left: 48 }; const innerW = width - padding.left - padding.right; const innerH = height - padding.top - padding.bottom;
  const totalRetard = useMemo(() => rows.reduce((s, r) => s + (r.sorties_retard || 0), 0), [rows]);
  const effectiveRows = useMemo(() => { let cumulRetard = 0; return rows.map((r) => { const retard = includeRetard ? r.sorties_retard || 0 : 0; cumulRetard += retard; const stock = r.stock_projete - cumulRetard; return { ...r, retardAffiche: retard, sorties_n: r.sorties_n + retard, stock_projete: stock, niveau_alerte_max: cumulRetard > 0 && stock < 0 ? "ROUGE" : r.niveau_alerte_max }; }); }, [rows, includeRetard]);
  const simulated = useMemo(() => { if (!simQty || !simWeek) return effectiveRows.map((r) => ({ ...r, simMarker: 0 })); return effectiveRows.map((r) => ({ ...r, simMarker: r.periode_debut === simWeek ? simQty : 0, stock_projete: r.periode_debut >= simWeek ? r.stock_projete + simQty : r.stock_projete })); }, [effectiveRows, simQty, simWeek]);
  const allVals = simulated.flatMap((r) => [r.stock_projete, r.entrees, -r.sorties_n]); const maxVal = Math.max(1, ...allVals); const minVal = Math.min(0, ...allVals);
  const x = (i: number) => padding.left + (i / Math.max(1, simulated.length - 1)) * innerW; const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH; const barWidth = Math.max(2, innerW / simulated.length - 3);
  function handleMove(e: React.MouseEvent, i: number) { const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return; const r = simulated[i]; setTooltip({ x: (x(i) / width) * rect.width, y: (y(r.stock_projete) / height) * rect.height, lines: [{ label: formatDate(r.periode_debut), value: "" }, { label: "Stock projeté", value: formatNumber(r.stock_projete), color: ALERT_COLOR[r.niveau_alerte_max] }, { label: "Entrées à venir", value: formatNumber(r.entrees), color: GREEN }, ...(r.retardAffiche ? [{ label: "  dont CDC en retard", value: formatNumber(r.retardAffiche), color: VIOLET }] : []), ...(r.sorties_fermes !== undefined ? [{ label: "  dont CDC fermes", value: formatNumber(r.sorties_fermes), color: DARK_RED }] : []), ...(r.sorties_prevision !== undefined ? [{ label: "  dont prévisionnel pur", value: formatNumber(r.sorties_prevision), color: LIGHT_RED }] : []), { label: "Sorties prévisionnelles (total)", value: formatNumber(r.sorties_n) }, ...(r.simMarker ? [{ label: "Simulation ajoutée ici", value: `+${formatNumber(r.simMarker)}`, color: "#3F9142" }] : [])] }); }
  return (
    <div>
      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full" onMouseLeave={() => setTooltip(null)}>
          <defs><pattern id="hatch-green" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)"><line x1={0} y1={0} x2={0} y2={6} stroke="#3F9142" strokeWidth={3} /></pattern></defs>
          <YAxis maxVal={maxVal} minVal={minVal} height={height} top={padding.top} innerH={innerH} />
          {simulated.map((r, i) => <rect key={`in-${r.periode_debut}`} x={x(i) - barWidth / 2} y={y(Math.max(0, r.entrees))} width={barWidth} height={Math.max(0, y(0) - y(Math.max(0, r.entrees)))} fill={GREEN} opacity={0.3} />)}
          {simulated.map((r, i) => { const retard = r.retardAffiche ?? 0; const fermes = r.sorties_fermes ?? 0; const prevision = r.sorties_prevision ?? Math.max(0, r.sorties_n - fermes - retard); return <g key={`out-${r.periode_debut}`}>{retard > 0 && <rect x={x(i) - barWidth / 2} y={y(0)} width={barWidth} height={Math.max(0, y(-retard) - y(0))} fill={VIOLET} opacity={0.75} />}<rect x={x(i) - barWidth / 2} y={y(-retard)} width={barWidth} height={Math.max(0, y(-retard - fermes) - y(-retard))} fill={DARK_RED} opacity={0.55} /><rect x={x(i) - barWidth / 2} y={y(-retard - fermes)} width={barWidth} height={Math.max(0, y(-retard - fermes - prevision) - y(-retard - fermes))} fill={LIGHT_RED} opacity={0.35} /></g>; })}
          {simulated.map((r, i) => r.simMarker ? <rect key={`sim-${r.periode_debut}`} x={x(i) - barWidth / 2} y={y(r.stock_projete) - 7} width={barWidth} height={14} fill="url(#hatch-green)" stroke="#3F9142" strokeWidth={1} /> : null)}
          {simulated.slice(1).map((r, i) => <line key={`stock-${r.periode_debut}`} x1={x(i)} y1={y(simulated[i].stock_projete)} x2={x(i + 1)} y2={y(r.stock_projete)} stroke={ALERT_COLOR[r.niveau_alerte_max] || "#4B92AC"} strokeWidth={2.5} />)}
          {simulated.map((r, i) => <rect key={`hit-${r.periode_debut}`} x={x(i) - barWidth / 2} y={0} width={barWidth} height={height} fill="transparent" onMouseMove={(e) => handleMove(e, i)} className="cursor-pointer" />)}
          <line x1={padding.left} y1={y(0)} x2={width - padding.right} y2={y(0)} stroke="#00000033" />
          {simulated.map((r, i) => i % Math.ceil(simulated.length / 8 || 1) === 0 ? <text key={`lbl-${r.periode_debut}`} x={x(i)} y={height - 8} fontSize={9} textAnchor="middle" fill="#141A26aa">{formatDate(r.periode_debut).slice(0, 5)}</text> : null)}
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
      {onIncludeRetardChange && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs text-[#141A26]" style={{ borderColor: `${VIOLET}55`, background: `${VIOLET}12` }}>
          <input type="checkbox" checked={includeRetard} disabled={totalRetard === 0} onChange={(e) => onIncludeRetardChange(e.target.checked)} className="h-3.5 w-3.5 disabled:opacity-40" style={{ accentColor: VIOLET }} />
          <span className="font-medium">Intégrer les CDC en retard comme besoins fermes (1<sup>re</sup>&nbsp;semaine)</span>
          <span className="ml-auto whitespace-nowrap font-[var(--font-mono)] font-medium" style={{ color: totalRetard > 0 ? VIOLET : "#141A2666" }}>{totalRetard > 0 ? `${formatNumber(totalRetard)} u. en retard` : "Aucun retard"}</span>
        </label>
      )}
      <div className="mb-2 flex flex-wrap gap-4 text-[10px] text-[#141A26]/50">
        <span>— Stock projeté (couleur = alerte)</span>
        <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: GREEN, opacity: 0.4 }} /> Entrées à venir</span>
        {totalRetard > 0 && <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: VIOLET, opacity: 0.75 }} /> CDC en retard (livraison passée)</span>}
        <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: DARK_RED, opacity: 0.55 }} /> Sorties CDC fermes</span>
        <span><span className="mr-1 inline-block h-2 w-2 align-middle" style={{ background: LIGHT_RED, opacity: 0.45 }} /> Sorties prévisionnelles pures</span>
        <span><span className="mr-1 inline-block h-2 w-2 border border-[#3F9142] align-middle" style={{ background: "repeating-linear-gradient(45deg, #3F9142 0 2px, transparent 2px 5px)" }} /> Simulation (semaine d&rsquo;injection)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/60 p-2 text-xs">
        <span className="text-[#141A26]/50">Simuler un appro :</span>
        <select value={simWeek} onChange={(e) => setSimWeek(e.target.value)} className="rounded border border-black/10 bg-white px-2 py-1">{rows.map((r) => <option key={r.periode_debut} value={r.periode_debut}>{formatDate(r.periode_debut)}</option>)}</select>
        <input type="number" value={simQty} onChange={(e) => setSimQty(Number(e.target.value))} className="w-24 rounded border border-black/10 bg-white px-2 py-1" />
        {simQty !== 0 && <button onClick={() => setSimQty(0)} className="text-[#141A26]/40 underline">Réinitialiser</button>}
      </div>
    </div>
  );
}

type FournisseurRow = { numero_piece: string; fournisseur_code: string | null; fournisseur_nom: string | null; date_livraison: string | null; date_livraison_calculee: string | null; quantite_attendue: number; montant_ht: number | null };
type BesoinClientRow = { date_besoin: string; quantite_besoin: number; montant_ht: number | null; nb_commandes: number; numeros_pieces: string | null };

function ArticleDrawer({ article, runId, includeRetard, onIncludeRetardChange, onClose, substitutionByRef }: { article: AlertRow; runId: string | null; includeRetard: boolean; onIncludeRetardChange: (value: boolean) => void; onClose: () => void; substitutionByRef: Map<string, { statut: string; entrante: number; origineBase: number }> }) {
  const [rows, setRows] = useState<ProjectionRow[]>([]); const [fournisseurs, setFournisseurs] = useState<FournisseurRow[]>([]); const [besoinsClients, setBesoinsClients] = useState<BesoinClientRow[]>([]); const [retardArticle, setRetardArticle] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        const session = await supabase.auth.getSession(); const token = session.data.session?.access_token;
        const params = new URLSearchParams({ reference_article: article.reference_article, depot: article.depot || "GLOBAL" });
        const res = await fetch(`/api/stocks-disponibilites/detail?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = (await res.json()) as { success: boolean; message?: string; projection?: ProjectionRow[]; fournisseurs?: FournisseurRow[]; besoins_clients?: BesoinClientRow[] };
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Erreur inconnue");
        const { data: retardData, error: retardErr } = await supabase.from("v_stock_projection_hebdo_latest").select("besoins_clients_retard").eq("reference_article", article.reference_article).eq("depot", article.depot || "GLOBAL").gt("besoins_clients_retard", 0);
        if (retardErr) console.warn("[CDC en retard] lecture impossible :", retardErr.message);
        if (!cancelled) { setRows(payload.projection || []); setFournisseurs(payload.fournisseurs || []); setBesoinsClients(payload.besoins_clients || []); setRetardArticle((retardData || []).reduce((sum, r) => sum + Number(r.besoins_clients_retard || 0), 0)); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setLoading(false); }
    }
    load(); return () => { cancelled = true; };
  }, [article.reference_article, article.depot]);

  const weeklyForChart = useMemo(() => rows.map((r, index) => ({ periode_debut: r.periode_debut, stock_projete: r.stock_projete || 0, sorties_fermes: r.besoins_clients_fermes || 0, sorties_prevision: r.prevision_ventes || 0, sorties_retard: index === 0 ? retardArticle : 0, sorties_n: (r.prevision_ventes || 0) + (r.besoins_clients_fermes || 0), sorties_n1: r.prevision_base_n1 || 0, entrees: r.commandes_fournisseurs_attendues || 0, niveau_alerte_max: r.niveau_alerte || "VERT" })), [rows, retardArticle]);
  const rowsAffichees = useMemo(() => { let cumulRetard = 0; return rows.map((r, index) => { const retard = index === 0 ? retardArticle : 0; if (includeRetard) cumulRetard += retard; return { ...r, retard, stock_affiche: (r.stock_projete || 0) - cumulRetard }; }); }, [rows, retardArticle, includeRetard]);
  const horizonEvolution = useMemo(() => { const n = rows.reduce((s, r) => s + (r.prevision_ventes || 0) + (r.besoins_clients_fermes || 0), 0) + (includeRetard ? retardArticle : 0); const n1 = rows.reduce((s, r) => s + (r.prevision_base_n1 || 0), 0); return { n, n1, pct: n1 > 0 ? ((n - n1) / n1) * 100 : null }; }, [rows, includeRetard, retardArticle]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-5xl overflow-y-auto bg-[#0B1220] p-6 md:p-10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-[#A6A181]">{article.macro_famille} · {article.famille}</div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-[var(--font-display)] text-xl font-bold text-white">{article.reference_article}</h2><PastilleSubstitution statut={substitutionByRef.get(article.reference_article)?.statut || "ACTIVE"} /></div>
            <div className="text-sm text-white/50">{article.designation}</div>
            {substitutionByRef.get(article.reference_article)?.statut === "REMPLACEE" && (<div className="mt-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/65">Cette référence est <strong className="text-white/85">remplacée</strong> : ses besoins futurs ont été transférés vers une ou plusieurs remplaçantes. Sa prévision est ramenée à zéro.</div>)}
            {substitutionByRef.get(article.reference_article)?.statut === "PARTIELLE" && (<div className="mt-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/65">Remplacement <strong className="text-white/85">partiel</strong> : une partie de ses besoins futurs reste sur cette référence.</div>)}
            {substitutionByRef.get(article.reference_article)?.statut === "REMPLACANTE" && (substitutionByRef.get(article.reference_article)?.entrante || 0) > 0 && (<div className="mt-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/65">Référence <strong className="text-white/85">remplaçante</strong> : la prévision intègre l&rsquo;historique consolidé (propre + transféré). Base N-1 propre : <strong className="text-white/85">{Math.round((substitutionByRef.get(article.reference_article)?.origineBase || 0) - (substitutionByRef.get(article.reference_article)?.entrante || 0))}</strong> · Reçu : <strong style={{ color: "#3F9142" }}>{Math.round(substitutionByRef.get(article.reference_article)?.entrante || 0)}</strong></div>)}
          </div>
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:text-white">Fermer</button>
        </div>
        {error && <div className="mb-4 rounded-lg border border-[#C1683C]/40 bg-[#C1683C]/10 px-4 py-3 text-sm text-[#e0a685]">{error}</div>}
        {loading ? <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" /> : (
          <>
            <div className="mb-6 rounded-xl border border-white/10 bg-[#F5F3EC] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-[var(--font-display)] text-base font-semibold text-[#141A26]">Stock projeté hebdomadaire</h3><span className="rounded-md bg-black/5 px-2 py-1 text-xs text-[#141A26]/70">Prévision + CDC sur l&rsquo;horizon vs N-1 : <EvolBadge pct={horizonEvolution.pct} /></span></div>
              {weeklyForChart.length === 0 ? <p className="py-8 text-center text-sm text-[#141A26]/40">Aucune projection hebdomadaire.</p> : <WeeklyStockChart rows={weeklyForChart} includeRetard={includeRetard} onIncludeRetardChange={onIncludeRetardChange} />}
            </div>
            <div className="mb-6 overflow-x-auto rounded-xl border border-white/10 bg-[#F5F3EC]">
              <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Détail par semaine</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50"><th className="whitespace-nowrap px-4 py-3">Semaine</th><th className="whitespace-nowrap px-4 py-3 text-right">BL N-1</th><th className="whitespace-nowrap px-4 py-3 text-right" style={{ color: VIOLET }}>CDC en retard</th><th className="whitespace-nowrap px-4 py-3 text-right">CDC fermes</th><th className="whitespace-nowrap px-4 py-3 text-right">Prévision complémentaire</th><th className="whitespace-nowrap px-4 py-3 text-right">Coefficient appliqué</th><th className="whitespace-nowrap px-4 py-3 text-right">Stock projeté</th></tr></thead>
                <tbody className="divide-y divide-black/[0.06]">
                  {rowsAffichees.map((r) => (<tr key={r.periode_debut}><td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-[#141A26]">{formatDate(r.periode_debut)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#8A93A6]">{formatNumber(r.prevision_base_n1)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]" style={{ color: r.retard > 0 ? VIOLET : "#141A2666", fontWeight: r.retard > 0 && includeRetard ? 600 : 400 }}>{formatNumber(r.retard)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(r.besoins_clients_fermes)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#C1683C]">{formatNumber(r.prevision_ventes)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] text-[#141A26]/60">×{toNumber(r.coefficient_prevision_applique).toFixed(2)}</td><td className={`whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)] font-medium ${r.stock_affiche < 0 ? "text-[#C1683C]" : "text-[#141A26]"}`}>{formatNumber(r.stock_affiche)}</td></tr>))}
                </tbody>
              </table>
            </div>
            <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#F5F3EC]">
                <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">CDC en cours</h3>
                <table className="w-full text-sm"><thead><tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50"><th className="whitespace-nowrap px-4 py-3">Date besoin</th><th className="whitespace-nowrap px-4 py-3 text-right">Quantité</th><th className="whitespace-nowrap px-4 py-3 text-right">Nb cmd</th><th className="whitespace-nowrap px-4 py-3">Pièces</th></tr></thead>
                  <tbody className="divide-y divide-black/[0.06]">{besoinsClients.map((b, i) => (<tr key={i}><td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-[#141A26]">{formatDate(b.date_besoin)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(b.quantite_besoin)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{b.nb_commandes}</td><td className="max-w-[160px] truncate px-4 py-2 text-xs text-[#141A26]/60">{b.numeros_pieces}</td></tr>))}{besoinsClients.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-[#141A26]/40">Aucune CDC ouverte.</td></tr>}</tbody>
                </table>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#F5F3EC]">
                <h3 className="px-4 pt-4 font-[var(--font-display)] text-base font-semibold text-[#141A26]">Commandes fournisseurs</h3>
                <table className="w-full text-sm"><thead><tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-[#141A26]/50"><th className="whitespace-nowrap px-4 py-3">Fournisseur</th><th className="whitespace-nowrap px-4 py-3">Pièce</th><th className="whitespace-nowrap px-4 py-3">Livraison</th><th className="whitespace-nowrap px-4 py-3 text-right">Quantité</th></tr></thead>
                  <tbody className="divide-y divide-black/[0.06]">{fournisseurs.map((f, i) => (<tr key={i}><td className="max-w-[140px] truncate px-4 py-2 text-[#141A26]">{f.fournisseur_nom || f.fournisseur_code}</td><td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-xs text-[#141A26]/60">{f.numero_piece}</td><td className="whitespace-nowrap px-4 py-2 font-[var(--font-mono)] text-[#141A26]">{formatDate(f.date_livraison_calculee || f.date_livraison)}</td><td className="whitespace-nowrap px-4 py-2 text-right font-[var(--font-mono)]">{formatNumber(f.quantite_attendue)}</td></tr>))}{fournisseurs.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-[#141A26]/40">Aucune commande fournisseur ouverte.</td></tr>}</tbody>
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
  const [pct, setPct] = useState(100); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState<string | null>(null);
  async function handleSave() {
    if (level === "reference" && !runId) { setSaved("Erreur : aucun run actif — relancez un recalcul complet."); return; }
    if (!periods.length) { setSaved("Erreur : aucune semaine d'horizon disponible — rechargez la fiche article."); return; }
    setSaving(true); setSaved(null);
    try {
      const session = await supabase.auth.getSession(); const token = session.data.session?.access_token;
      const action = level === "reference" ? "weekly_assumptions" : level === "famille" ? "weekly_assumptions_famille" : "weekly_assumptions_famille_macro";
      const bodyReq: Record<string, unknown> = { action, assumptions: periods.map((periode_debut) => ({ periode_debut, coefficient_prevision: pct / 100, quantite_prevision_forcee: null })) };
      if (level === "reference") { bodyReq.run_id = runId; bodyReq.reference_article = article.reference_article; bodyReq.depot = article.depot || "GLOBAL"; }
      else { bodyReq.cle = level === "famille" ? article.famille : article.macro_famille; bodyReq.depot = "GLOBAL"; }
      const res = await fetch("/api/stocks-disponibilites/settings", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(bodyReq) });
      const payload = (await res.json()) as { success: boolean; message?: string; requires_full_rebuild?: boolean; updated_weeks?: number };
      if (!res.ok || !payload.success) throw new Error(payload?.message || "Échec de l'enregistrement");
      const weeksMsg = `${periods.length} semaine(s) mises à jour.`;
      setSaved(payload.requires_full_rebuild ? `${weeksMsg} Utilisez « Recalculer cette famille/famille macro » (en haut de page) pour l'appliquer.` : `${weeksMsg} Recalculé.`);
    } catch (e) { setSaved(`Erreur : ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="mb-3 font-[var(--font-display)] text-base font-semibold text-white">Ajuster la prévision</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["reference", "famille", "famille_macro"] as const).map((l) => (<button key={l} onClick={() => setLevel(l)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${level === l ? "bg-[#A6A181] text-[#141A26]" : "bg-white/5 text-white/50 hover:text-white/80"}`}>{l === "reference" ? "Cette référence" : l === "famille" ? `Famille ${article.famille}` : `Famille macro ${article.macro_famille}`}</button>))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2"><label className="text-xs uppercase tracking-wide text-white/40">Évolution vs N-1</label><input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-24 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white" /><span className="text-sm text-white/40">%</span></div>
        <button onClick={handleSave} disabled={saving} className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] hover:brightness-110 disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </div>
      {level !== "reference" && <p className="mt-2 text-xs text-[#D69A4A]">Utilisez ensuite le sélecteur « Périmètre » en haut de page et le bouton « Recalculer cette famille/famille macro » pour l&rsquo;appliquer.</p>}
      {saved && <p className="mt-2 text-xs text-white/60">{saved}</p>}
    </div>
  );
}
