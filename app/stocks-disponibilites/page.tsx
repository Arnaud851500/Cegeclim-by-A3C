"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AlertLevel = "ROUGE" | "ORANGE" | "JAUNE" | "VERT" | string;
type AbcClass = "A" | "B" | "C";

type DiagnosticStep = {
  event_id?: string | null;
  trace_id: string;
  module: string;
  action: string;
  layer: string;
  step: string;
  object_name?: string | null;
  run_id?: string | null;
  batch_offset?: number | null;
  batch_limit?: number | null;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  status: "STARTED" | "SUCCESS" | "WARNING" | "ERROR";
  http_status?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  error_details?: string | null;
  error_hint?: string | null;
  error_context?: string | null;
  row_count?: number | null;
  context?: Record<string, unknown> | null;
};

type DiagnosticReport = {
  trace_id: string;
  module: string;
  action: string;
  status: "SUCCESS" | "WARNING" | "ERROR";
  category?: string | null;
  user_message?: string | null;
  technical_message?: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  steps: DiagnosticStep[];
};

type ApiPayload = {
  success?: boolean;
  error?: string;
  trace_id?: string;
  diagnostic?: DiagnosticReport;
  [key: string]: unknown;
};

type StockKpi = {
  run_id: string | null;
  run_date_debut: string | null;
  run_nb_semaines: number | null;
  scenario_prevision_pct: number | null;
  run_status: string | null;
  run_commentaire: string | null;
  run_created_at: string | null;
  run_completed_at: string | null;
  articles_suivis: number | null;
  articles_rouge: number | null;
  articles_orange: number | null;
  articles_jaune: number | null;
  articles_vert: number | null;
  articles_rupture_30j: number | null;
  articles_sous_stock_securite: number | null;
  ca_client_risque: number | null;
  commandes_fournisseurs_attendues: number | null;
  besoins_clients_fermes: number | null;
  prevision_base_n1?: number | null;
  prevision_ventes: number | null;
  prevision_forcee?: number | null;
  sorties_ytd_n?: number | null;
  sorties_ytd_n1?: number | null;
  sorties_ytd_evol_pct?: number | null;
  sorties_mois_passe_n?: number | null;
  sorties_mois_passe_n1?: number | null;
  sorties_mois_passe_evol_pct?: number | null;
  nb_commandes_clients_risque: number | null;
  prochaine_date_rupture: string | null;
};

type StockAlertRow = {
  run_id: string;
  run_date_debut?: string | null;
  run_nb_semaines?: number | null;
  scenario_prevision_pct?: number | null;
  run_created_at?: string | null;
  run_completed_at?: string | null;
  reference_article: string;
  designation: string | null;
  famille: string | null;
  macro_famille: string | null;
  fournisseur_principal: string | null;
  depot: string | null;
  stock_initial: number | null;
  stock_projete_min: number | null;
  stock_projete_ferme_min?: number | null;
  stock_disponible_ferme_min?: number | null;
  date_rupture_ferme?: string | null;
  date_retour_dispo_ferme?: string | null;
  qte_manquante_max: number | null;
  date_rupture: string | null;
  date_retour_dispo: string | null;
  commandes_fournisseurs_attendues: number | null;
  besoins_clients_fermes: number | null;
  prevision_base_n1?: number | null;
  prevision_ventes: number | null;
  prevision_forcee?: number | null;
  sorties_ytd_n?: number | null;
  sorties_ytd_n1?: number | null;
  sorties_ytd_evol_pct?: number | null;
  sorties_mois_passe_n?: number | null;
  sorties_mois_passe_n1?: number | null;
  sorties_mois_passe_evol_pct?: number | null;
  stock_securite: number | null;
  ca_client_risque: number | null;
  nb_commandes_clients_risque: number | null;
  abc_annee?: number | null;
  abc_ca_bl_ytd?: number | null;
  abc_nb_lignes_bl_ytd?: number | null;
  abc_part_ca_pct?: number | null;
  abc_cumul_ca_pct?: number | null;
  classe_abc_ca?: AbcClass | null;
  abc_part_lignes_pct?: number | null;
  abc_cumul_lignes_pct?: number | null;
  classe_abc_lignes?: AbcClass | null;
  niveau_alerte: AlertLevel;
};

type ProjectionRow = {
  run_id: string;
  reference_article: string;
  designation: string | null;
  famille: string | null;
  macro_famille: string | null;
  fournisseur_principal: string | null;
  depot: string | null;
  periode_debut: string;
  periode_fin: string;
  stock_initial: number | null;
  commandes_fournisseurs_attendues: number | null;
  besoins_clients_fermes: number | null;
  prevision_base_n1: number | null;
  coefficient_prevision_applique: number | null;
  prevision_ventes: number | null;
  prevision_forcee?: number | null;
  stock_projete: number | null;
  stock_projete_ferme?: number | null;
  stock_disponible_ferme?: number | null;
  date_rupture_ferme?: string | null;
  date_retour_dispo_ferme?: string | null;
  stock_securite: number | null;
  stock_disponible_projete: number | null;
  quantite_manquante: number | null;
  niveau_alerte: AlertLevel;
  date_rupture: string | null;
  date_retour_dispo: string | null;
  ca_client_risque: number | null;
  nb_commandes_clients_risque: number | null;
};

type FournisseurRow = {
  numero_piece: string | null;
  fournisseur_code: string | null;
  fournisseur_nom: string | null;
  date_livraison: string | null;
  date_livraison_calculee: string | null;
  reference_article: string;
  designation: string | null;
  depot: string | null;
  quantite_attendue: number | null;
  montant_ht: number | null;
};

type BesoinClientRow = {
  reference_article: string;
  designation: string | null;
  depot: string | null;
  date_besoin: string | null;
  quantite_besoin: number | null;
  montant_ht: number | null;
  nb_commandes: number | null;
  numeros_pieces: string | null;
};

type RuptureHorizonFilter = "TOUS" | "CURRENT" | "8" | "12" | "16";

type Filters = {
  search: string;
  niveau: "TOUS" | "ROUGE" | "ORANGE" | "JAUNE" | "VERT";
  ruptureHorizon: RuptureHorizonFilter;
  macroFamille: string;
  famille: string;
  fournisseur: string;
  abcCa: "TOUS" | AbcClass;
  abcLignes: "TOUS" | AbcClass;
  onlyWithRupture: boolean;
};

type SortKey =
  | "niveau_alerte"
  | "reference_article"
  | "macro_famille"
  | "stock_initial"
  | "sorties_ytd_n"
  | "sorties_mois_passe_n"
  | "stock_securite"
  | "stock_projete_min"
  | "qte_manquante_max"
  | "date_rupture";

type SortState = {
  key: SortKey;
  direction: "asc" | "desc";
};

const ALERT_ORDER: Record<string, number> = {
  ROUGE: 1,
  ORANGE: 2,
  JAUNE: 3,
  VERT: 4,
};

const EXCLUDED_MACRO_FAMILIES = new Set(["DIV", "TECH", "SAV"]);

function normalizedMacroFamily(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isDisplayedMacroFamily(value: string | null | undefined) {
  return !EXCLUDED_MACRO_FAMILIES.has(normalizedMacroFamily(value));
}

function articleDepotKey(
  referenceArticle: string | null | undefined,
  depot: string | null | undefined,
) {
  return `${String(referenceArticle || "").trim()}||${String(
    depot || "GLOBAL",
  )
    .trim()
    .toUpperCase()}`;
}

function familyKey(
  macroFamille: string | null | undefined,
  famille: string | null | undefined,
) {
  return `${String(macroFamille || "Sans macro-famille").trim()}||${String(
    famille || "Sans famille",
  ).trim()}`;
}

function excelColumnName(index: number) {
  let value = Math.max(1, Math.trunc(index));
  let result = "";
  while (value > 0) {
    const modulo = (value - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function mostFrequentNumber(values: number[], fallback: number) {
  if (!values.length) return fallback;
  const counts = new Map<string, { value: number; count: number }>();
  values.forEach((raw) => {
    const value = Math.round(raw * 10_000) / 10_000;
    const key = String(value);
    const current = counts.get(key);
    counts.set(key, { value, count: (current?.count || 0) + 1 });
  });
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.value - b.value,
  )[0]?.value ?? fallback;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  niveau: "TOUS",
  ruptureHorizon: "TOUS",
  macroFamille: "TOUS",
  famille: "TOUS",
  fournisseur: "TOUS",
  abcCa: "TOUS",
  abcLignes: "TOUS",
  onlyWithRupture: false,
};

function toNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value: number | string | null | undefined, digits = 0) {
  return toNumber(value).toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | string | null | undefined) {
  return `${(toNumber(value) * 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
  })} %`;
}

function formatEvolution(
  current: number | string | null | undefined,
  previous: number | string | null | undefined,
) {
  const n = toNumber(current);
  const n1 = toNumber(previous);
  if (n1 === 0 && n === 0) return "—";
  if (n1 === 0 && n > 0) return "Nouveau";
  const pct = ((n - n1) / Math.abs(n1)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`;
}

function evolutionClass(
  current: number | string | null | undefined,
  previous: number | string | null | undefined,
) {
  const n = toNumber(current);
  const n1 = toNumber(previous);
  if (n1 === 0 && n > 0) return "border-blue-200 bg-blue-50 text-blue-800";
  if (n > n1) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (n < n1) return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function QuantityWithEvolution({
  current,
  previous,
}: {
  current: number | string | null | undefined;
  previous: number | string | null | undefined;
}) {
  return (
    <div className="flex flex-col items-end gap-1 leading-tight tabular-nums">
      <span className="text-[15px] font-black text-slate-950">
        {formatNumber(current)}
      </span>
      <span className="text-[11px] font-medium text-slate-500">
        N-1 : {formatNumber(previous)}
      </span>
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${evolutionClass(
          current,
          previous,
        )}`}
      >
        {formatEvolution(current, previous)}
      </span>
    </div>
  );
}

function formatCurrencyK(value: number | string | null | undefined) {
  const n = toNumber(value);
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("fr-FR", {
      maximumFractionDigits: 2,
    })} M€`;
  }
  return `${(n / 1_000).toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
  })} K€`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR").format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function localTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isCurrentRupture(row: StockAlertRow) {
  return (
    toNumber(row.stock_projete_min) < 0 ||
    String(row.niveau_alerte || "").toUpperCase() === "ROUGE"
  );
}

function isRuptureWithinWeeks(row: StockAlertRow, weeks: number) {
  const ruptureMs = dateMs(row.date_rupture);
  if (ruptureMs === null) return false;
  const todayMs = new Date(localTodayIso()).getTime();
  return ruptureMs <= todayMs + weeks * 7 * 86_400_000;
}

function ruptureHorizonDetail(rows: StockAlertRow[], weeks: number) {
  const horizonMs =
    new Date(localTodayIso()).getTime() + weeks * 7 * 86_400_000;
  const dates = rows
    .map((row) => dateMs(row.date_rupture))
    .filter((value): value is number => value !== null)
    .filter((value) => value <= horizonMs)
    .sort((a, b) => a - b);

  return dates.length
    ? `Prochaine : ${formatDate(new Date(dates[0]).toISOString().slice(0, 10))}`
    : "Aucune date dans cet horizon";
}

function normalizeSearch(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function friendlyError(error: unknown, fallback: string) {
  const source = error as ErrorLike | null | undefined;
  const candidates = [
    typeof error === "string" ? error : "",
    typeof source?.message === "string" ? source.message : "",
    typeof source?.details === "string" ? source.details : "",
    typeof source?.hint === "string" ? source.hint : "",
    typeof source?.code === "string" ? source.code : "",
  ].filter(Boolean);

  const raw = candidates.join(" · ").trim();
  if (!raw) return fallback;

  const lower = raw.toLowerCase();

  if (
    lower.includes("ssl handshake failed") ||
    lower.includes("error code 525") ||
    lower.includes("cloudflare ray id") ||
    lower.includes("cf-error-details")
  ) {
    return "Connexion temporairement indisponible entre Supabase et son infrastructure réseau (erreur SSL 525). Réessaie dans quelques instants.";
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed")
  ) {
    return "Connexion à Supabase impossible pour le moment. Les données déjà affichées sont conservées ; réessaie dans quelques instants.";
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "La requête a dépassé le délai autorisé. Réessaie dans quelques instants.";
  }

  if (
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("<body")
  ) {
    return fallback;
  }

  const cleaned = stripHtml(raw);
  if (!cleaned) return fallback;
  return cleaned.length > 360 ? `${cleaned.slice(0, 357)}…` : cleaned;
}

function createClientTraceId(prefix: string) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function localDiagnosticReport(
  traceId: string,
  action: string,
  objectName: string,
  error: unknown,
): DiagnosticReport {
  const message = friendlyError(error, "Erreur de communication avec le serveur.");
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const now = new Date().toISOString();
  return {
    trace_id: traceId,
    module: "stocks-disponibilites",
    action,
    status: "ERROR",
    category: "browser_to_vercel",
    user_message: message,
    technical_message: rawMessage,
    started_at: now,
    finished_at: now,
    duration_ms: 0,
    steps: [
      {
        trace_id: traceId,
        module: "stocks-disponibilites",
        action,
        layer: "browser_to_vercel",
        step: "fetch_route",
        object_name: objectName,
        started_at: now,
        finished_at: now,
        duration_ms: 0,
        status: "ERROR",
        error_message: rawMessage,
      },
    ],
  };
}

async function authenticatedFetch(
  url: string,
  traceId: string,
  init?: RequestInit,
): Promise<{ response: Response; payload: ApiPayload }> {
  const sessionResponse = await supabase.auth.getSession();
  const token = sessionResponse.data.session?.access_token;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-trace-id": traceId,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiPayload;
  return { response, payload };
}

function diagnosticCopyText(report: DiagnosticReport) {
  return JSON.stringify(report, null, 2);
}

function DiagnosticPanel({
  report,
  tone = "error",
  onRetry,
  retrying = false,
  onTest,
  testing = false,
}: {
  report: DiagnosticReport;
  tone?: "error" | "warning" | "success";
  onRetry?: () => void;
  retrying?: boolean;
  onTest?: () => void;
  testing?: boolean;
}) {
  const classes =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-red-200 bg-red-50 text-red-900";
  const title =
    report.status === "SUCCESS"
      ? "Diagnostic terminé"
      : report.status === "WARNING"
        ? "Diagnostic avec avertissement"
        : "Incident technique identifié";

  async function copyReport() {
    await navigator.clipboard.writeText(diagnosticCopyText(report));
  }

  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border p-4 ${classes}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="font-black">{title}</div>
          <div className="mt-1 break-words text-sm font-medium leading-5">
            {report.user_message || report.technical_message || "Consulte le diagnostic technique."}
          </div>
          <div className="mt-2 break-all font-mono text-[11px]">
            Trace : {report.trace_id} · Catégorie : {report.category || "non classée"} · Durée : {formatNumber(report.duration_ms)} ms
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-xl border border-current bg-white px-3 py-2 text-xs font-black disabled:opacity-60"
            >
              {retrying ? "Nouvelle tentative…" : "Réessayer"}
            </button>
          ) : null}
          {onTest ? (
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="rounded-xl border border-current bg-white px-3 py-2 text-xs font-black disabled:opacity-60"
            >
              {testing ? "Test en cours…" : "Tester la connexion"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={copyReport}
            className="rounded-xl border border-current bg-white px-3 py-2 text-xs font-black"
          >
            Copier le rapport
          </button>
          <a
            href="/admin/diagnostics"
            className="rounded-xl border border-current bg-white px-3 py-2 text-xs font-black"
          >
            Ouvrir l’historique
          </a>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-current/20 bg-white/70 p-3">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-wide">Afficher le diagnostic technique</summary>
        <div className="mt-3 overflow-auto">
          <table className="min-w-[1100px] w-full text-[11px]">
            <thead className="text-left uppercase tracking-wide opacity-70">
              <tr>
                <th className="px-2 py-2">Statut</th>
                <th className="px-2 py-2">Couche</th>
                <th className="px-2 py-2">Étape</th>
                <th className="px-2 py-2">Objet</th>
                <th className="px-2 py-2 text-right">Durée</th>
                <th className="px-2 py-2">Lot</th>
                <th className="px-2 py-2">Code</th>
                <th className="px-2 py-2">Message technique</th>
              </tr>
            </thead>
            <tbody>
              {report.steps.map((step, index) => (
                <tr key={`${step.step}-${index}`} className="border-t border-current/10 align-top">
                  <td className="px-2 py-2 font-black">{step.status}</td>
                  <td className="px-2 py-2">{step.layer}</td>
                  <td className="px-2 py-2 font-bold">{step.step}</td>
                  <td className="max-w-[260px] break-words px-2 py-2">{step.object_name || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{step.duration_ms == null ? "—" : `${formatNumber(step.duration_ms)} ms`}</td>
                  <td className="whitespace-nowrap px-2 py-2">{step.batch_offset == null ? "—" : `${step.batch_offset} / ${step.batch_limit ?? "—"}`}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono">{step.error_code || step.http_status || "—"}</td>
                  <td className="max-w-[460px] break-words px-2 py-2">
                    <div>{step.error_message || "—"}</div>
                    {step.error_details ? <div className="mt-1 opacity-75">{step.error_details}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function alertLabel(level: AlertLevel) {
  const normalized = String(level || "VERT").toUpperCase();
  if (normalized === "ROUGE") return "Rupture";
  if (normalized === "ORANGE") return "Sous sécurité";
  if (normalized === "JAUNE") return "Proche sécurité";
  return "OK";
}

function alertCompactLabel(level: AlertLevel) {
  const normalized = String(level || "VERT").toUpperCase();
  if (normalized === "ROUGE") return "R";
  if (normalized === "ORANGE" || normalized === "JAUNE") return "A";
  return "OK";
}

function normalizeAbcClass(value: string | null | undefined): AbcClass {
  const normalized = String(value || "C").toUpperCase();
  return normalized === "A" || normalized === "B" ? normalized : "C";
}

function abcBadgeClass(value: AbcClass) {
  if (value === "A") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (value === "B") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function AbcBadge({
  label,
  value,
  title,
  compact = false,
}: {
  label: string;
  value: string | null | undefined;
  title?: string;
  compact?: boolean;
}) {
  const abc = normalizeAbcClass(value);
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center rounded-full border font-black ${abcBadgeClass(abc)} ${
        compact ? "min-w-[34px] px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
      }`}
    >
      {label} {abc}
    </span>
  );
}

function alertClass(level: AlertLevel) {
  const normalized = String(level || "VERT").toUpperCase();
  if (normalized === "ROUGE") return "border-red-200 bg-red-50 text-red-800";
  if (normalized === "ORANGE")
    return "border-orange-200 bg-orange-50 text-orange-800";
  if (normalized === "JAUNE")
    return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function rowToneClass(level: AlertLevel) {
  const normalized = String(level || "VERT").toUpperCase();
  if (normalized === "ROUGE") return "bg-red-50/80 hover:bg-red-100";
  if (normalized === "ORANGE") return "bg-orange-50/80 hover:bg-orange-100";
  if (normalized === "JAUNE") return "bg-amber-50/80 hover:bg-amber-100";
  return "bg-white hover:bg-blue-50";
}

function dotClass(level: AlertLevel) {
  const normalized = String(level || "VERT").toUpperCase();
  if (normalized === "ROUGE") return "bg-red-500";
  if (normalized === "ORANGE") return "bg-orange-500";
  if (normalized === "JAUNE") return "bg-amber-400";
  return "bg-emerald-500";
}

function levelFromValues(
  stockProjete: number,
  stockSecurite: number,
): AlertLevel {
  if (stockProjete < 0) return "ROUGE";
  if (stockProjete < stockSecurite) return "ORANGE";
  if (stockSecurite > 0 && stockProjete < stockSecurite * 1.2) return "JAUNE";
  return "VERT";
}

function sortAlerts(a: StockAlertRow, b: StockAlertRow) {
  const levelDiff =
    (ALERT_ORDER[String(a.niveau_alerte || "VERT").toUpperCase()] || 9) -
    (ALERT_ORDER[String(b.niveau_alerte || "VERT").toUpperCase()] || 9);
  if (levelDiff !== 0) return levelDiff;

  const dateA = a.date_rupture
    ? new Date(a.date_rupture).getTime()
    : Number.POSITIVE_INFINITY;
  const dateB = b.date_rupture
    ? new Date(b.date_rupture).getTime()
    : Number.POSITIVE_INFINITY;
  if (dateA !== dateB) return dateA - dateB;

  return toNumber(b.qte_manquante_max) - toNumber(a.qte_manquante_max);
}

function compareText(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  return String(a || "").localeCompare(String(b || ""), "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareDateValue(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  const dateA = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
  const dateB = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
  return dateA - dateB;
}

function compareAlertRows(
  a: StockAlertRow,
  b: StockAlertRow,
  sortState: SortState,
) {
  let result = 0;

  switch (sortState.key) {
    case "niveau_alerte":
      result =
        (ALERT_ORDER[String(a.niveau_alerte || "VERT").toUpperCase()] || 9) -
        (ALERT_ORDER[String(b.niveau_alerte || "VERT").toUpperCase()] || 9);
      break;
    case "reference_article":
      result =
        compareText(a.reference_article, b.reference_article) ||
        compareText(a.designation, b.designation);
      break;
    case "macro_famille":
      result =
        compareText(a.macro_famille, b.macro_famille) ||
        compareText(a.famille, b.famille) ||
        compareText(a.reference_article, b.reference_article);
      break;
    case "stock_initial":
      result = toNumber(a.stock_initial) - toNumber(b.stock_initial);
      break;
    case "sorties_ytd_n":
      result = toNumber(a.sorties_ytd_n) - toNumber(b.sorties_ytd_n);
      break;
    case "sorties_mois_passe_n":
      result =
        toNumber(a.sorties_mois_passe_n) - toNumber(b.sorties_mois_passe_n);
      break;
    case "stock_securite":
      result = toNumber(a.stock_securite) - toNumber(b.stock_securite);
      break;
    case "stock_projete_min":
      result = toNumber(a.stock_projete_min) - toNumber(b.stock_projete_min);
      break;
    case "qte_manquante_max":
      result = toNumber(a.qte_manquante_max) - toNumber(b.qte_manquante_max);
      break;
    case "date_rupture":
      result = compareDateValue(a.date_rupture, b.date_rupture);
      break;
    default:
      result = sortAlerts(a, b);
  }

  if (result === 0) result = sortAlerts(a, b);
  return sortState.direction === "asc" ? result : -result;
}

function horizonCardClass(active: boolean) {
  return active
    ? "border-blue-300 bg-blue-50 ring-2 ring-blue-500"
    : "hover:border-blue-200 hover:bg-blue-50/40";
}

function SortableTh({
  label,
  sortKey,
  sortState,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sortState: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortState.key === sortKey;
  const arrow = active ? (sortState.direction === "asc" ? "▲" : "▼") : "↕";

  return (
    <th
      className={`border-b border-slate-200 px-2.5 py-3 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex w-full items-center gap-1 text-xs font-black uppercase tracking-wide ${
          align === "right" ? "justify-end" : "justify-start"
        } ${active ? "text-blue-700" : "text-slate-600 hover:text-slate-950"}`}
        title={`Trier par ${label}`}
      >
        <span>{label}</span>
        <span className="text-[10px]">{arrow}</span>
      </button>
    </th>
  );
}

function KpiCard({
  label,
  value,
  detail,
  tone,
  onClick,
  active = false,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <div className="flex min-h-[116px] min-w-0 flex-col">
      <div className="min-h-[34px] break-words text-[11px] font-bold uppercase leading-4 tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1.5 break-words text-[clamp(1.35rem,1.7vw,1.9rem)] font-black leading-none tabular-nums ${
          tone || "text-slate-950"
        }`}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-auto break-words pt-2 text-[11px] font-medium leading-4 text-slate-500">
          {detail}
        </div>
      ) : (
        <div className="mt-auto" />
      )}
      {onClick ? (
        <div className="mt-1 text-[10px] font-black uppercase leading-4 tracking-wide text-blue-700">
          Cliquer pour filtrer
        </div>
      ) : null}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`h-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition ${horizonCardClass(
          active,
        )}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      {content}
    </div>
  );
}

function KpiMini({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="flex min-h-[62px] min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <div className="min-h-[18px] break-words text-[9px] font-bold uppercase leading-3 tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 break-words text-lg font-black leading-tight tabular-nums ${
          tone || "text-slate-950"
        }`}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-auto pt-0.5 text-[10px] font-bold leading-3 text-slate-500">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <div className="text-lg font-black text-slate-900">{title}</div>
      <div className="mt-2 text-sm text-slate-600">{message}</div>
    </div>
  );
}

function ProjectionChart({
  rows,
  compact = false,
}: {
  rows: ProjectionRow[];
  compact?: boolean;
}) {
  const width = compact ? 760 : 920;
  const height = compact ? 240 : 280;
  const padding = { top: 24, right: 24, bottom: 44, left: 58 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  if (!rows.length) {
    return (
      <EmptyState
        title="Aucune projection hebdomadaire"
        message="Relance le calcul de projection ou sélectionne un autre article."
      />
    );
  }

  const values = rows.flatMap((row) => [
    toNumber(row.stock_projete),
    toNumber(row.stock_securite),
    toNumber(row.stock_initial),
    toNumber(row.commandes_fournisseurs_attendues),
    -toNumber(row.besoins_clients_fermes) - toNumber(row.prevision_ventes),
  ]);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(1, ...values);
  const range = maxValue - minValue || 1;

  const x = (index: number) =>
    rows.length <= 1
      ? padding.left + innerWidth / 2
      : padding.left + (index * innerWidth) / (rows.length - 1);
  const y = (value: number) =>
    padding.top + ((maxValue - value) * innerHeight) / range;

  const stockPath = rows
    .map(
      (row, index) =>
        `${index === 0 ? "M" : "L"} ${x(index)} ${y(toNumber(row.stock_projete))}`,
    )
    .join(" ");
  const securityPath = rows
    .map(
      (row, index) =>
        `${index === 0 ? "M" : "L"} ${x(index)} ${y(toNumber(row.stock_securite))}`,
    )
    .join(" ");
  const zeroY = y(0);

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 text-[11px] font-semibold text-slate-500">
        Les besoins fermes sont compris dans la prévision totale. La barre rouge clair représente uniquement le complément restant à prévoir.
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-6 rounded-full bg-slate-900" /> Stock projeté
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-6 rounded-full border border-dashed border-slate-400" />{" "}
          Stock sécurité
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-200" />{" "}
          Entrées BDCF
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-red-800 ring-1 ring-red-900" />{" "}
          Besoins fermes
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-red-100 ring-1 ring-red-200" />{" "}
          Prévision complémentaire
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={
          compact
            ? "h-[260px] min-w-[760px] w-full"
            : "h-[300px] min-w-[920px] w-full"
        }
      >
        <rect x="0" y="0" width={width} height={height} rx="18" fill="white" />

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = minValue + range * tick;
          const tickY = y(value);
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={tickY}
                y2={tickY}
                stroke="#e2e8f0"
                strokeDasharray="4 6"
              />
              <text
                x={padding.left - 10}
                y={tickY + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748b"
              >
                {formatNumber(value)}
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={zeroY}
          y2={zeroY}
          stroke="#94a3b8"
        />

        {rows.map((row, index) => {
          const slotWidth = innerWidth / Math.max(rows.length, 1);
          const barWidth = Math.max(10, slotWidth * 0.22);
          const center = x(index);
          const cf = toNumber(row.commandes_fournisseurs_attendues);
          const firm = toNumber(row.besoins_clients_fermes);
          const projected = toNumber(row.prevision_ventes);
          const cfTop = y(cf);
          const firmBottom = y(-firm);
          const projectedBottom = y(-(firm + projected));
          const weekLevel = levelFromValues(
            toNumber(row.stock_projete),
            toNumber(row.stock_securite),
          );
          const bandFill =
            weekLevel === "ROUGE"
              ? "#fee2e2"
              : weekLevel === "ORANGE"
                ? "#ffedd5"
                : weekLevel === "JAUNE"
                  ? "#fef3c7"
                  : "#ecfdf5";

          return (
            <g key={`${row.reference_article}-${row.periode_debut}`}>
              <rect
                x={center - slotWidth / 2}
                y={padding.top}
                width={slotWidth}
                height={innerHeight}
                fill={bandFill}
                opacity="0.35"
              />

              {cf > 0 ? (
                <rect
                  x={center - barWidth - 1}
                  y={cfTop}
                  width={barWidth}
                  height={Math.max(1, zeroY - cfTop)}
                  rx="4"
                  fill="#d1fae5"
                  stroke="#a7f3d0"
                />
              ) : null}

              {firm > 0 ? (
                <rect
                  x={center + 1}
                  y={zeroY}
                  width={barWidth}
                  height={Math.max(1, firmBottom - zeroY)}
                  rx="4"
                  fill="#991b1b"
                  stroke="#7f1d1d"
                />
              ) : null}

              {projected > 0 ? (
                <rect
                  x={center + 1}
                  y={firm > 0 ? firmBottom : zeroY}
                  width={barWidth}
                  height={Math.max(
                    1,
                    projectedBottom - (firm > 0 ? firmBottom : zeroY),
                  )}
                  rx="4"
                  fill="#fecaca"
                  stroke="#fca5a5"
                />
              ) : null}

              <text
                x={center}
                y={height - 18}
                textAnchor="middle"
                fontSize="10"
                fill="#64748b"
              >
                {formatDate(row.periode_debut).slice(0, 5)}
              </text>
            </g>
          );
        })}

        <path
          d={securityPath}
          fill="none"
          stroke="#64748b"
          strokeWidth="2"
          strokeDasharray="6 6"
        />
        <path
          d={stockPath}
          fill="none"
          stroke="#0f172a"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {rows.map((row, index) => {
          const level = levelFromValues(
            toNumber(row.stock_projete),
            toNumber(row.stock_securite),
          );
          const fill =
            level === "ROUGE"
              ? "#ef4444"
              : level === "ORANGE"
                ? "#f97316"
                : level === "JAUNE"
                  ? "#f59e0b"
                  : "#10b981";
          return (
            <circle
              key={`point-${row.periode_debut}`}
              cx={x(index)}
              cy={y(toNumber(row.stock_projete))}
              r="5"
              fill={fill}
              stroke="white"
              strokeWidth="2"
            />
          );
        })}
      </svg>
    </div>
  );
}

function aggregateProjectionRows(
  rows: ProjectionRow[],
  options: {
    referenceLabel: string;
    famille?: string | null;
    macroFamille?: string | null;
  },
): ProjectionRow[] {
  const byWeek = new Map<string, ProjectionRow>();

  rows.forEach((row) => {
    const weekKey = String(row.periode_debut || "");
    if (!weekKey) return;

    const current =
      byWeek.get(weekKey) ||
      ({
        run_id: row.run_id,
        reference_article: options.referenceLabel,
        designation: options.referenceLabel,
        famille: options.famille ?? row.famille ?? null,
        macro_famille: options.macroFamille ?? row.macro_famille ?? null,
        fournisseur_principal: null,
        depot: "GLOBAL",
        periode_debut: row.periode_debut,
        periode_fin: row.periode_fin,
        stock_initial: 0,
        commandes_fournisseurs_attendues: 0,
        besoins_clients_fermes: 0,
        prevision_base_n1: 0,
        coefficient_prevision_applique: 1,
        prevision_ventes: 0,
        prevision_forcee: 0,
        stock_projete: 0,
        stock_projete_ferme: 0,
        stock_disponible_ferme: 0,
        date_rupture_ferme: null,
        date_retour_dispo_ferme: null,
        stock_securite: 0,
        stock_disponible_projete: 0,
        quantite_manquante: 0,
        niveau_alerte: "VERT",
        date_rupture: null,
        date_retour_dispo: null,
        ca_client_risque: 0,
        nb_commandes_clients_risque: 0,
      } satisfies ProjectionRow);

    current.stock_initial =
      toNumber(current.stock_initial) + toNumber(row.stock_initial);
    current.commandes_fournisseurs_attendues =
      toNumber(current.commandes_fournisseurs_attendues) +
      toNumber(row.commandes_fournisseurs_attendues);
    current.besoins_clients_fermes =
      toNumber(current.besoins_clients_fermes) +
      toNumber(row.besoins_clients_fermes);
    current.prevision_base_n1 =
      toNumber(current.prevision_base_n1) + toNumber(row.prevision_base_n1);
    current.prevision_ventes =
      toNumber(current.prevision_ventes) + toNumber(row.prevision_ventes);
    current.prevision_forcee =
      toNumber(current.prevision_forcee) + toNumber(row.prevision_forcee);
    current.stock_projete =
      toNumber(current.stock_projete) + toNumber(row.stock_projete);
    current.stock_projete_ferme =
      toNumber(current.stock_projete_ferme) +
      toNumber(row.stock_projete_ferme);
    current.stock_disponible_ferme =
      toNumber(current.stock_disponible_ferme) +
      toNumber(row.stock_disponible_ferme);
    current.stock_securite =
      toNumber(current.stock_securite) + toNumber(row.stock_securite);
    current.stock_disponible_projete =
      toNumber(current.stock_disponible_projete) +
      toNumber(row.stock_disponible_projete);
    current.quantite_manquante =
      toNumber(current.quantite_manquante) +
      toNumber(row.quantite_manquante);
    current.ca_client_risque =
      toNumber(current.ca_client_risque) + toNumber(row.ca_client_risque);
    current.nb_commandes_clients_risque =
      toNumber(current.nb_commandes_clients_risque) +
      toNumber(row.nb_commandes_clients_risque);

    byWeek.set(weekKey, current);
  });

  return Array.from(byWeek.values())
    .sort((a, b) =>
      String(a.periode_debut).localeCompare(String(b.periode_debut)),
    )
    .map((row) => ({
      ...row,
      niveau_alerte: levelFromValues(
        toNumber(row.stock_projete),
        toNumber(row.stock_securite),
      ),
    }));
}

function DetailTable({
  title,
  subtitle,
  headers,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-black text-slate-950">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {rows.length ? (
        <div className="max-h-[320px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    className="border-b border-slate-200 px-3 py-2 text-left"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={`${title}-${rowIndex}`}
                  className="border-b border-slate-100"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${title}-${rowIndex}-${cellIndex}`}
                      className="px-3 py-2 text-slate-700"
                    >
                      <span
                        className={
                          cellIndex === row.length - 1
                            ? "font-bold text-slate-950"
                            : undefined
                        }
                      >
                        {cell}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 text-sm text-slate-500">{empty}</div>
      )}
    </div>
  );
}

function WeeklyProjectionTable({
  rows,
  weeklyPct,
  weeklyManualQty,
  onChangePct,
  onChangeManualQty,
}: {
  rows: ProjectionRow[];
  weeklyPct: Record<string, number>;
  weeklyManualQty: Record<string, string>;
  onChangePct: (periodeDebut: string, value: number) => void;
  onChangeManualQty: (periodeDebut: string, value: string) => void;
}) {
  if (!rows.length) return null;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-black text-slate-950">
          Hypothèses hebdomadaires de sortie
        </h3>
        <p className="text-xs text-slate-500">
          BL N-1 par semaine, coefficient ou prévision totale forcée. Les besoins fermes sont inclus dans la prévision : seule la part complémentaire est ajoutée au stock projeté.
        </p>
      </div>
      <div className="overflow-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="border-b border-slate-200 px-3 py-2 text-left">
                Semaine
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Sorties BL N-1
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Projection %
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Prévision totale forcée
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Prévision compl.
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Besoins fermes
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Total sorties
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Entrées BDCF
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Stock ferme
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Stock projeté
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-right">
                Stock sécurité
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">
                Alerte
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pct =
                weeklyPct[row.periode_debut] ??
                toNumber(row.coefficient_prevision_applique) * 100;
              const base = toNumber(row.prevision_base_n1);
              const manualText =
                weeklyManualQty[row.periode_debut] ??
                (row.prevision_forcee === null ||
                row.prevision_forcee === undefined
                  ? ""
                  : String(toNumber(row.prevision_forcee)));
              const manualValue =
                manualText === "" ? null : Math.max(0, toNumber(manualText));
              const projectedTarget =
                manualValue === null ? (base * pct) / 100 : manualValue;
              const firm = Math.max(0, toNumber(row.besoins_clients_fermes));
              const projected = Math.max(0, projectedTarget - firm);
              const totalSorties = firm + projected;
              const stock = toNumber(row.stock_projete);
              const stockFirm = toNumber(row.stock_projete_ferme);
              const security = toNumber(row.stock_securite);
              const level = levelFromValues(stock, security);

              return (
                <tr
                  key={row.periode_debut}
                  className={`border-b border-slate-100 ${rowToneClass(level)}`}
                >
                  <td className="px-3 py-2 font-semibold text-slate-800">
                    {formatDate(row.periode_debut)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNumber(base)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={Number.isFinite(pct) ? pct : 0}
                      onChange={(event) =>
                        onChangePct(
                          row.periode_debut,
                          Number(event.target.value),
                        )
                      }
                      className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right font-semibold"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="auto"
                      value={manualText}
                      onChange={(event) =>
                        onChangeManualQty(row.periode_debut, event.target.value)
                      }
                      className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right font-semibold"
                    />
                  </td>
                  <td
                    className="px-3 py-2 text-right font-semibold text-red-400 tabular-nums"
                    title={`Prévision totale ${formatNumber(projectedTarget)} moins besoins fermes ${formatNumber(firm)}`}
                  >
                    {formatNumber(projected)}
                  </td>
                  <td className="px-3 py-2 text-right font-black text-red-900 tabular-nums">
                    {formatNumber(firm)}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-black tabular-nums"
                    title={`Prévision totale ${formatNumber(projectedTarget)} dont ${formatNumber(firm)} ferme(s) et ${formatNumber(projected)} complémentaire(s)`}
                  >
                    {formatNumber(totalSorties)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums">
                    {formatNumber(row.commandes_fournisseurs_attendues)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-black tabular-nums ${
                      stockFirm < 0 ? "text-red-700" : "text-slate-700"
                    }`}
                  >
                    {formatNumber(stockFirm)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-black tabular-nums ${
                      stock < 0
                        ? "text-red-700"
                        : stock < security
                          ? "text-orange-700"
                          : "text-slate-950"
                    }`}
                  >
                    {formatNumber(stock)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatNumber(security)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-black ${alertClass(
                        level,
                      )}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${dotClass(level)}`}
                      />
                      {alertLabel(level)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StocksDisponibilitesPage() {
  const [kpi, setKpi] = useState<StockKpi | null>(null);
  const [alertes, setAlertes] = useState<StockAlertRow[]>([]);
  const [projection, setProjection] = useState<ProjectionRow[]>([]);
  const [selectionProjection, setSelectionProjection] = useState<ProjectionRow[]>([]);
  const [aggregateProjectionLoading, setAggregateProjectionLoading] =
    useState(false);
  const [aggregateProjectionError, setAggregateProjectionError] = useState<
    string | null
  >(null);
  const aggregateProjectionRequestRef = useRef(0);
  const [fournisseurs, setFournisseurs] = useState<FournisseurRow[]>([]);
  const [besoinsClients, setBesoinsClients] = useState<BesoinClientRow[]>([]);
  const [selected, setSelected] = useState<StockAlertRow | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortState, setSortState] = useState<SortState>({
    key: "niveau_alerte",
    direction: "asc",
  });
  const [horizonWeeks, setHorizonWeeks] = useState(26);
  const [defaultProjectionPct, setDefaultProjectionPct] = useState(120);
  const [stockSecurityInput, setStockSecurityInput] = useState("0");
  const [weeklyPct, setWeeklyPct] = useState<Record<string, number>>({});
  const [weeklyManualQty, setWeeklyManualQty] = useState<
    Record<string, string>
  >({});
  const [articleEvolutionPct, setArticleEvolutionPct] = useState("");
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<{
    percent: number;
    message: string;
    phase: string;
  } | null>(null);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [savingWeekly, setSavingWeekly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [detailWarning, setDetailWarning] = useState<string | null>(null);
  const [detailDiagnostic, setDetailDiagnostic] = useState<DiagnosticReport | null>(null);
  const [connectionDiagnostic, setConnectionDiagnostic] = useState<DiagnosticReport | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const macroFamilles = useMemo(() => {
    return Array.from(
      new Set(
        alertes.map((row) => row.macro_famille).filter(Boolean) as string[],
      ),
    ).sort((a, b) => a.localeCompare(b, "fr"));
  }, [alertes]);

  const familles = useMemo(() => {
    return Array.from(
      new Set(alertes.map((row) => row.famille).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b, "fr"));
  }, [alertes]);

  const fournisseursList = useMemo(() => {
    return Array.from(
      new Set(
        alertes
          .map((row) => row.fournisseur_principal)
          .filter(Boolean) as string[],
      ),
    ).sort((a, b) => a.localeCompare(b, "fr"));
  }, [alertes]);

  const baseFilteredAlertes = useMemo(() => {
    const search = normalizeSearch(filters.search);

    return alertes.filter((row) => {
      if (
        filters.niveau !== "TOUS" &&
        String(row.niveau_alerte || "").toUpperCase() !== filters.niveau
      ) {
        return false;
      }
      if (
        filters.macroFamille !== "TOUS" &&
        row.macro_famille !== filters.macroFamille
      ) {
        return false;
      }
      if (filters.famille !== "TOUS" && row.famille !== filters.famille) {
        return false;
      }
      if (
        filters.fournisseur !== "TOUS" &&
        row.fournisseur_principal !== filters.fournisseur
      ) {
        return false;
      }
      if (
        filters.abcCa !== "TOUS" &&
        normalizeAbcClass(row.classe_abc_ca) !== filters.abcCa
      ) {
        return false;
      }
      if (
        filters.abcLignes !== "TOUS" &&
        normalizeAbcClass(row.classe_abc_lignes) !== filters.abcLignes
      ) {
        return false;
      }
      if (filters.onlyWithRupture && !row.date_rupture) return false;

      if (!search) return true;
      const haystack = normalizeSearch(
        [
          row.reference_article,
          row.designation,
          row.famille,
          row.macro_famille,
          row.fournisseur_principal,
          row.classe_abc_ca,
          row.classe_abc_lignes,
          row.depot,
        ].join(" "),
      );
      return haystack.includes(search);
    });
  }, [
    alertes,
    filters.search,
    filters.niveau,
    filters.macroFamille,
    filters.famille,
    filters.fournisseur,
    filters.abcCa,
    filters.abcLignes,
    filters.onlyWithRupture,
  ]);

  const filteredAlertes = useMemo(() => {
    return baseFilteredAlertes
      .filter((row) => {
        if (filters.ruptureHorizon === "TOUS") return true;
        if (filters.ruptureHorizon === "CURRENT") return isCurrentRupture(row);
        return isRuptureWithinWeeks(row, Number(filters.ruptureHorizon));
      })
      .sort((a, b) => compareAlertRows(a, b, sortState));
  }, [baseFilteredAlertes, filters.ruptureHorizon, sortState]);

  const aggregateSelectionSignature = useMemo(
    () =>
      filteredAlertes
        .map((row) => articleDepotKey(row.reference_article, row.depot))
        .sort((a, b) => a.localeCompare(b, "fr"))
        .join("|"),
    [filteredAlertes],
  );

  const filteredKpi = useMemo(() => {
    const sum = (selector: (row: StockAlertRow) => number | null | undefined) =>
      filteredAlertes.reduce(
        (total, row) => total + toNumber(selector(row)),
        0,
      );

    return {
      articles_suivis: filteredAlertes.length,
      articles_rouge: filteredAlertes.filter(
        (row) => String(row.niveau_alerte || "").toUpperCase() === "ROUGE",
      ).length,
      articles_orange: filteredAlertes.filter(
        (row) => String(row.niveau_alerte || "").toUpperCase() === "ORANGE",
      ).length,
      articles_jaune: filteredAlertes.filter(
        (row) => String(row.niveau_alerte || "").toUpperCase() === "JAUNE",
      ).length,
      besoins_clients_fermes: sum((row) => row.besoins_clients_fermes),
      prevision_base_n1: sum((row) => row.prevision_base_n1),
      prevision_ventes: sum((row) => row.prevision_ventes),
      commandes_fournisseurs_attendues: sum(
        (row) => row.commandes_fournisseurs_attendues,
      ),
      ca_client_risque: sum((row) => row.ca_client_risque),
      nb_commandes_clients_risque: sum(
        (row) => row.nb_commandes_clients_risque,
      ),
    };
  }, [filteredAlertes]);

  const ruptureHorizonKpi = useMemo(() => {
    return {
      current: baseFilteredAlertes.filter(isCurrentRupture).length,
      weeks8: baseFilteredAlertes.filter((row) => isRuptureWithinWeeks(row, 8))
        .length,
      weeks12: baseFilteredAlertes.filter((row) =>
        isRuptureWithinWeeks(row, 12),
      ).length,
      weeks16: baseFilteredAlertes.filter((row) =>
        isRuptureWithinWeeks(row, 16),
      ).length,
      detail8: ruptureHorizonDetail(baseFilteredAlertes, 8),
      detail12: ruptureHorizonDetail(baseFilteredAlertes, 12),
      detail16: ruptureHorizonDetail(baseFilteredAlertes, 16),
    };
  }, [baseFilteredAlertes]);

  function setRuptureHorizonFilter(next: RuptureHorizonFilter) {
    setFilters((prev) => ({
      ...prev,
      ruptureHorizon: prev.ruptureHorizon === next ? "TOUS" : next,
    }));
  }

  function toggleSort(key: SortKey) {
    setSortState((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }

  async function loadData(options?: {
    keepSelected?: boolean;
    keepProjectionSettings?: boolean;
  }) {
    setLoading(true);
    setError(null);
    setDiagnostic(null);

    const traceId = createClientTraceId("STOCK-DATA");
    try {
      const { response, payload } = await authenticatedFetch(
        `/api/stocks-disponibilites/data?trace_id=${encodeURIComponent(traceId)}`,
        traceId,
      );

      if (!response.ok || !payload.success) {
        if (payload.diagnostic) setDiagnostic(payload.diagnostic);
        throw new Error(payload.error || `Erreur HTTP ${response.status} pendant le chargement.`);
      }

      const nextKpi = (payload.kpi || null) as StockKpi | null;
      const nextAlertes = ((payload.alertes || []) as StockAlertRow[])
        .filter((row) => isDisplayedMacroFamily(row.macro_famille))
        .sort(sortAlerts);

      setKpi(nextKpi);
      setAlertes(nextAlertes);

      if (nextKpi && !options?.keepProjectionSettings) {
        setHorizonWeeks(Number(nextKpi.run_nb_semaines || 26));
        setDefaultProjectionPct(
          Math.round(toNumber(nextKpi.scenario_prevision_pct || 1.2) * 100),
        );
      }

      if (options?.keepSelected && selected) {
        const stillExists = nextAlertes.find(
          (row) =>
            row.reference_article === selected.reference_article &&
            (row.depot || "GLOBAL") === (selected.depot || "GLOBAL"),
        );
        setSelected(stillExists || nextAlertes[0] || null);
      } else {
        setSelected(nextAlertes[0] || null);
      }
    } catch (err: any) {
      setError(friendlyError(err, "Erreur pendant le chargement des projections stock."));
      setDiagnostic((current) =>
        current ||
        localDiagnosticReport(
          traceId,
          "load_main_data",
          "/api/stocks-disponibilites/data",
          err,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(row: StockAlertRow | null) {
    setProjection([]);
    setFournisseurs([]);
    setBesoinsClients([]);
    setWeeklyPct({});
    setWeeklyManualQty({});
    setArticleEvolutionPct("");
    setDetailWarning(null);
    setDetailDiagnostic(null);

    if (!row?.reference_article) return;

    setStockSecurityInput(String(toNumber(row.stock_securite)));
    setDetailLoading(true);
    const traceId = createClientTraceId("STOCK-DETAIL");

    try {
      const params = new URLSearchParams({
        reference_article: row.reference_article,
        depot: row.depot || "GLOBAL",
        trace_id: traceId,
      });
      const { response, payload } = await authenticatedFetch(
        `/api/stocks-disponibilites/detail?${params.toString()}`,
        traceId,
      );

      if ((!response.ok && response.status !== 207) || !payload.success) {
        if (payload.diagnostic) setDetailDiagnostic(payload.diagnostic);
        throw new Error(payload.error || `Erreur HTTP ${response.status} pendant le chargement du détail.`);
      }

      const nextProjection = (payload.projection || []) as ProjectionRow[];
      setProjection(nextProjection);
      setFournisseurs((payload.fournisseurs || []) as FournisseurRow[]);
      setBesoinsClients((payload.besoins_clients || []) as BesoinClientRow[]);

      const nextPct: Record<string, number> = {};
      const nextManualQty: Record<string, string> = {};
      nextProjection.forEach((projectionRow) => {
        nextPct[projectionRow.periode_debut] = Math.round(
          toNumber(projectionRow.coefficient_prevision_applique || 1.2) * 100,
        );
        if (
          projectionRow.prevision_forcee !== null &&
          projectionRow.prevision_forcee !== undefined
        ) {
          nextManualQty[projectionRow.periode_debut] = String(
            toNumber(projectionRow.prevision_forcee),
          );
        }
      });
      setWeeklyPct(nextPct);
      setWeeklyManualQty(nextManualQty);

      const horizonCoefficients = Object.values(nextPct).filter((value) =>
        Number.isFinite(value),
      );
      const roundedCoefficients = Array.from(
        new Set(horizonCoefficients.map((value) => Math.round(value * 100) / 100)),
      );
      setArticleEvolutionPct(
        roundedCoefficients.length === 1
          ? String(Math.round((roundedCoefficients[0] - 100) * 100) / 100)
          : "",
      );

      if (payload.partial || payload.diagnostic?.status === "WARNING") {
        setDetailWarning(
          payload.diagnostic?.user_message ||
            "Certaines sources secondaires du détail ne sont pas disponibles.",
        );
        if (payload.diagnostic) setDetailDiagnostic(payload.diagnostic);
      }
    } catch (err: any) {
      setDetailWarning(friendlyError(err, "Erreur pendant le chargement du détail article."));
      setDetailDiagnostic((current) =>
        current ||
        localDiagnosticReport(
          traceId,
          "load_article_detail",
          "/api/stocks-disponibilites/detail",
          err,
        ),
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadSelectionProjection(selectionRows: StockAlertRow[]) {
    const requestId = aggregateProjectionRequestRef.current + 1;
    aggregateProjectionRequestRef.current = requestId;

    setSelectionProjection([]);
    setAggregateProjectionError(null);

    const runId = kpi?.run_id || selectionRows[0]?.run_id || null;
    if (!runId || !selectionRows.length) {
      setAggregateProjectionLoading(false);
      return;
    }

    /*
     * Le graphe agrégé suit exactement la liste filtrée à l'écran :
     * recherche libre (référence ou désignation), niveau d'alerte,
     * horizon de rupture, famille, macro-famille, fournisseur et classes ABC.
     */
    const selectedKeys = new Set(
      selectionRows.map((row) =>
        articleDepotKey(row.reference_article, row.depot),
      ),
    );
    const selectedReferences = Array.from(
      new Set(
        selectionRows
          .map((row) => String(row.reference_article || "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "fr"));

    if (!selectedReferences.length) {
      setAggregateProjectionLoading(false);
      return;
    }

    setAggregateProjectionLoading(true);

    try {
      const selectedProjectionRows: ProjectionRow[] = [];
      const referenceChunkSize = 50;
      const pageSize = 1000;

      for (
        let referenceOffset = 0;
        referenceOffset < selectedReferences.length;
        referenceOffset += referenceChunkSize
      ) {
        const referenceChunk = selectedReferences.slice(
          referenceOffset,
          referenceOffset + referenceChunkSize,
        );
        let from = 0;

        while (true) {
          const { data, error: projectionError } = await supabase
            .from("v_stock_projection_hebdo_latest")
            .select(
              "run_id,reference_article,designation,famille,macro_famille,fournisseur_principal,depot,periode_debut,periode_fin,stock_initial,commandes_fournisseurs_attendues,besoins_clients_fermes,prevision_base_n1,coefficient_prevision_applique,prevision_ventes,prevision_forcee,stock_projete,stock_projete_ferme,stock_disponible_ferme,date_rupture_ferme,date_retour_dispo_ferme,stock_securite,stock_disponible_projete,quantite_manquante,niveau_alerte,date_rupture,date_retour_dispo,ca_client_risque,nb_commandes_clients_risque",
            )
            .eq("run_id", runId)
            .in("reference_article", referenceChunk)
            .order("reference_article", { ascending: true })
            .order("periode_debut", { ascending: true })
            .range(from, from + pageSize - 1);

          if (projectionError) throw projectionError;

          const rawRows = (data || []) as ProjectionRow[];
          selectedProjectionRows.push(
            ...rawRows.filter((row) =>
              selectedKeys.has(
                articleDepotKey(row.reference_article, row.depot),
              ),
            ),
          );

          if (rawRows.length < pageSize) break;
          from += pageSize;
        }
      }

      if (aggregateProjectionRequestRef.current !== requestId) return;

      setSelectionProjection(
        aggregateProjectionRows(selectedProjectionRows, {
          referenceLabel: "Sélection filtrée",
        }),
      );
    } catch (err: any) {
      if (aggregateProjectionRequestRef.current !== requestId) return;
      console.error("Erreur chargement projection de la sélection", err);
      setAggregateProjectionError(
        friendlyError(
          err,
          "Erreur pendant le chargement de la projection de la sélection.",
        ),
      );
    } finally {
      if (aggregateProjectionRequestRef.current === requestId) {
        setAggregateProjectionLoading(false);
      }
    }
  }

  async function rebuildProjection(commentaire: string) {
    const currentSelected = selected;
    setRecalculating(true);
    setRebuildProgress({
      percent: 0,
      phase: "start",
      message: "Initialisation de la projection",
    });
    setError(null);
    setDiagnostic(null);
    const traceId = createClientTraceId("STOCK-REBUILD");

    try {
      const weeks = Math.max(1, Math.min(104, Number(horizonWeeks || 26)));
      const pct = Math.max(0, Number(defaultProjectionPct || 120)) / 100;

      let continuation: Record<string, unknown> | null = null;
      let completed = false;
      let calls = 0;

      while (!completed) {
        calls += 1;
        if (calls > 200) {
          throw new Error(
            "Le recalcul a dépassé le nombre maximal d’étapes de continuation.",
          );
        }

        const requestBody: Record<string, unknown> = continuation
          ? {
              ...continuation,
              trace_id: traceId,
            }
          : {
              date_debut: new Date().toISOString().slice(0, 10),
              nb_semaines: weeks,
              scenario_prevision_pct: pct,
              depot_mode: "GLOBAL",
              commentaire,
              trace_id: traceId,
              projection_batch_size: 100,
              projection_batches_per_request: 3,
              netting_batch_size: 50,
              netting_batches_per_request: 8,
              netting_concurrency: 4,
            };

        const { response, payload } = await authenticatedFetch(
          "/api/stocks-disponibilites/rebuild",
          traceId,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          },
        );

        if ((!response.ok && response.status !== 207) || !payload.success) {
          if (payload.diagnostic) setDiagnostic(payload.diagnostic);
          throw new Error(
            payload.error ||
              `Erreur HTTP ${response.status} pendant le recalcul.`,
          );
        }

        const progress = payload.progress as
          | { percent?: number; message?: string; phase?: string }
          | undefined;

        if (progress) {
          setRebuildProgress({
            percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
            message: String(progress.message || "Recalcul en cours"),
            phase: String(progress.phase || "processing"),
          });
        }

        if (payload.diagnostic?.status === "WARNING") {
          setDiagnostic(payload.diagnostic);
        }

        completed = Boolean(payload.done);
        if (!completed) {
          const nextContinuation = payload.continuation;
          if (!nextContinuation || typeof nextContinuation !== "object") {
            throw new Error(
              "La route de recalcul n’a pas retourné l’état de continuation attendu.",
            );
          }
          continuation = nextContinuation as Record<string, unknown>;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
      }

      setRebuildProgress({
        percent: 100,
        phase: "done",
        message: "Projection terminée, actualisation de l’écran",
      });

      await loadData({
        keepSelected: Boolean(currentSelected),
        keepProjectionSettings: true,
      });
    } catch (err: unknown) {
      setError(friendlyError(err, "Erreur pendant le recalcul de projection."));
      setDiagnostic((current) =>
        current ||
        localDiagnosticReport(
          traceId,
          "rebuild_projection",
          "/api/stocks-disponibilites/rebuild",
          err,
        ),
      );
    } finally {
      setRecalculating(false);
      setRebuildProgress(null);
    }
  }

  async function saveStockSecurity() {
    const currentSelected = selected;
    if (!currentSelected) return;

    setSavingSecurity(true);
    setError(null);
    setDiagnostic(null);
    const traceId = createClientTraceId("STOCK-SECURITY");

    try {
      const { response, payload } = await authenticatedFetch(
        "/api/stocks-disponibilites/settings",
        traceId,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "stock_security",
            reference_article: currentSelected.reference_article,
            designation: currentSelected.designation,
            famille: currentSelected.famille,
            macro_famille: currentSelected.macro_famille,
            fournisseur_principal: currentSelected.fournisseur_principal,
            stock_securite: toNumber(stockSecurityInput),
          }),
        },
      );
      if (!response.ok || !payload.success) {
        if (payload.diagnostic) setDiagnostic(payload.diagnostic);
        throw new Error(payload.error || `Erreur HTTP ${response.status} pendant l’enregistrement.`);
      }

      const nextSecurity = toNumber(stockSecurityInput);
      const sameArticle = (row: StockAlertRow) =>
        row.reference_article === currentSelected.reference_article &&
        (row.depot || "GLOBAL") === (currentSelected.depot || "GLOBAL");

      const updateAlertRow = (row: StockAlertRow): StockAlertRow => {
        if (!sameArticle(row)) return row;
        const mini = toNumber(row.stock_projete_min);
        const nextLevel = levelFromValues(mini, nextSecurity);
        return {
          ...row,
          stock_securite: nextSecurity,
          qte_manquante_max: Math.max(0, nextSecurity - mini),
          niveau_alerte: nextLevel,
        };
      };

      setAlertes((prev) => prev.map(updateAlertRow));
      setSelected((prev) => (prev ? updateAlertRow(prev) : prev));
      setProjection((prev) =>
        prev.map((row) => {
          const stock = toNumber(row.stock_projete);
          const nextLevel = levelFromValues(stock, nextSecurity);
          return {
            ...row,
            stock_securite: nextSecurity,
            stock_disponible_projete: stock - nextSecurity,
            quantite_manquante: Math.max(0, nextSecurity - stock),
            niveau_alerte: nextLevel,
          };
        }),
      );
    } catch (err: any) {
      setError(friendlyError(err, "Erreur pendant l’enregistrement du stock de sécurité."));
      setDiagnostic((current) =>
        current ||
        localDiagnosticReport(
          traceId,
          "save_stock_security",
          "/api/stocks-disponibilites/settings",
          err,
        ),
      );
    } finally {
      setSavingSecurity(false);
    }
  }

  async function saveWeeklyAssumptions() {
    const currentSelected = selected;
    if (!currentSelected || !projection.length) return;

    setSavingWeekly(true);
    setError(null);
    setDiagnostic(null);
    const traceId = createClientTraceId("STOCK-WEEKLY");

    try {
      const assumptions = projection.map((row) => {
        const manualText = weeklyManualQty[row.periode_debut];
        return {
          periode_debut: row.periode_debut,
          coefficient_prevision:
            Math.max(
              0,
              toNumber(weeklyPct[row.periode_debut] ?? defaultProjectionPct),
            ) / 100,
          quantite_prevision_forcee:
            manualText === undefined || manualText === ""
              ? null
              : Math.max(0, toNumber(manualText)),
        };
      });

      const currentRunId = projection[0]?.run_id || currentSelected.run_id;
      const { response, payload } = await authenticatedFetch(
        "/api/stocks-disponibilites/settings",
        traceId,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "weekly_assumptions",
            run_id: currentRunId,
            reference_article: currentSelected.reference_article,
            depot: currentSelected.depot || "GLOBAL",
            assumptions,
          }),
        },
      );

      if (!response.ok || !payload.success) {
        if (payload.diagnostic) setDiagnostic(payload.diagnostic);
        throw new Error(payload.error || `Erreur HTTP ${response.status} pendant l’enregistrement.`);
      }

      const result = (payload.result || {}) as {
        projection?: ProjectionRow[];
        article?: Partial<StockAlertRow>;
      };
      const nextProjection = (
        (Array.isArray(payload.projection)
          ? payload.projection
          : result.projection || []) as ProjectionRow[]
      ).sort((a, b) => a.periode_debut.localeCompare(b.periode_debut));
      const articlePatch = (payload.article || result.article || null) as
        | Partial<StockAlertRow>
        | null;

      if (nextProjection.length) {
        setProjection(nextProjection);

        const nextPct: Record<string, number> = {};
        const nextManualQty: Record<string, string> = {};
        nextProjection.forEach((projectionRow) => {
          nextPct[projectionRow.periode_debut] = Math.round(
            toNumber(projectionRow.coefficient_prevision_applique || 1.2) * 100,
          );
          if (
            projectionRow.prevision_forcee !== null &&
            projectionRow.prevision_forcee !== undefined
          ) {
            nextManualQty[projectionRow.periode_debut] = String(
              toNumber(projectionRow.prevision_forcee),
            );
          }
        });
        setWeeklyPct(nextPct);
        setWeeklyManualQty(nextManualQty);

        const savedCoefficients = Object.values(nextPct).filter((value) =>
          Number.isFinite(value),
        );
        const savedRoundedCoefficients = Array.from(
          new Set(
            savedCoefficients.map((value) => Math.round(value * 100) / 100),
          ),
        );
        setArticleEvolutionPct(
          savedRoundedCoefficients.length === 1
            ? String(
                Math.round((savedRoundedCoefficients[0] - 100) * 100) / 100,
              )
            : "",
        );
      } else {
        await loadDetail(currentSelected);
      }

      if (articlePatch) {
        const sameArticle = (row: StockAlertRow) =>
          row.reference_article === currentSelected.reference_article &&
          (row.depot || "GLOBAL") === (currentSelected.depot || "GLOBAL");

        const patchAlertRow = (row: StockAlertRow): StockAlertRow =>
          sameArticle(row)
            ? {
                ...row,
                ...articlePatch,
                reference_article: row.reference_article,
                depot: row.depot,
              }
            : row;

        setAlertes((prev) => prev.map(patchAlertRow).sort(sortAlerts));
        setSelected((prev) => (prev ? patchAlertRow(prev) : prev));
      }

      if (payload.diagnostic?.status === "WARNING") {
        setDiagnostic(payload.diagnostic);
      }
    } catch (err: any) {
      setError(friendlyError(err, "Erreur pendant l’enregistrement des hypothèses hebdomadaires."));
      setDiagnostic((current) =>
        current ||
        localDiagnosticReport(
          traceId,
          "save_weekly_assumptions",
          "/api/stocks-disponibilites/settings",
          err,
        ),
      );
    } finally {
      setSavingWeekly(false);
    }
  }

  function applyArticleEvolutionToHorizon() {
    if (!projection.length) return;
    const evolution = Number(articleEvolutionPct);
    if (!Number.isFinite(evolution)) {
      setError("Saisis un pourcentage d’évolution valide pour l’article.");
      return;
    }

    const coefficientPct = Math.max(0, 100 + evolution);
    const nextPct: Record<string, number> = {};
    projection.forEach((row) => {
      nextPct[row.periode_debut] = coefficientPct;
    });

    setWeeklyPct(nextPct);
    setWeeklyManualQty({});
    setError(null);
  }

  async function exportFilteredArticlesToExcel() {
    if (!kpi?.run_id || !filteredAlertes.length) return;

    setExportingExcel(true);
    setExportProgress("Lecture des projections hebdomadaires…");
    setError(null);

    try {
      const exportedArticles = filteredAlertes
        .filter((row) => isDisplayedMacroFamily(row.macro_famille))
        .slice()
        .sort((a, b) => {
          const macro = String(a.macro_famille || "").localeCompare(
            String(b.macro_famille || ""),
            "fr",
          );
          if (macro !== 0) return macro;
          const famille = String(a.famille || "").localeCompare(
            String(b.famille || ""),
            "fr",
          );
          if (famille !== 0) return famille;
          return String(a.reference_article || "").localeCompare(
            String(b.reference_article || ""),
            "fr",
          );
        });

      const selectedKeys = new Set(
        exportedArticles.map((row) =>
          articleDepotKey(row.reference_article, row.depot),
        ),
      );

      const allProjectionRows: ProjectionRow[] = [];
      const pageSize = 1000;
      let from = 0;

      while (true) {
        setExportProgress(
          `Lecture des projections : ${formatNumber(allProjectionRows.length)} ligne(s)…`,
        );

        const { data, error: projectionError } = await supabase
          .from("v_stock_projection_hebdo_latest")
          .select(
            "run_id,reference_article,designation,famille,macro_famille,fournisseur_principal,depot,periode_debut,periode_fin,stock_initial,commandes_fournisseurs_attendues,besoins_clients_fermes,prevision_base_n1,coefficient_prevision_applique,prevision_ventes,prevision_forcee,stock_projete,stock_projete_ferme,stock_disponible_ferme,date_rupture_ferme,date_retour_dispo_ferme,stock_securite,stock_disponible_projete,quantite_manquante,niveau_alerte,date_rupture,date_retour_dispo,ca_client_risque,nb_commandes_clients_risque",
          )
          .eq("run_id", kpi.run_id)
          .order("reference_article", { ascending: true })
          .order("periode_debut", { ascending: true })
          .range(from, from + pageSize - 1);

        if (projectionError) throw projectionError;
        const pageRows = (data || []) as ProjectionRow[];
        allProjectionRows.push(...pageRows);
        if (pageRows.length < pageSize) break;
        from += pageSize;
      }

      const projectionRows = allProjectionRows.filter((row) =>
        selectedKeys.has(articleDepotKey(row.reference_article, row.depot)),
      );

      const weeks = Array.from(
        new Set(projectionRows.map((row) => row.periode_debut).filter(Boolean)),
      )
        .sort((a, b) => a.localeCompare(b))
        .slice(0, Math.max(1, Number(kpi.run_nb_semaines || horizonWeeks || 26)));

      if (!weeks.length) {
        throw new Error(
          "Aucune semaine de projection n’est disponible pour les articles affichés.",
        );
      }

      setExportProgress("Création du classeur Excel…");
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Cegeclim by A3C";
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.calcProperties.fullCalcOnLoad = true;
  

      const projectionSheet = workbook.addWorksheet("Projection articles", {
        views: [{ state: "frozen", xSplit: 16, ySplit: 4 }],
        properties: { defaultRowHeight: 18 },
      });
      const hypothesisSheet = workbook.addWorksheet("Hypothèses familles", {
        views: [{ state: "frozen", xSplit: 3, ySplit: 4 }],
        properties: { defaultRowHeight: 20 },
      });

      const blue = "FF1D4ED8";
      const darkBlue = "FF1E3A8A";
      const lightBlue = "FFDBEAFE";
      const slate = "FF334155";
      const lightSlate = "FFF1F5F9";
      const borderColor = "FFCBD5E1";
      const greenFill = "FFDCFCE7";
      const greenFont = "FF166534";
      const yellowFill = "FFFEF3C7";
      const yellowFont = "FF92400E";
      const orangeFill = "FFFFEDD5";
      const orangeFont = "FF9A3412";
      const redFill = "FFFEE2E2";
      const redFont = "FFB91C1C";

      const thinBorder = {
        top: { style: "thin" as const, color: { argb: borderColor } },
        left: { style: "thin" as const, color: { argb: borderColor } },
        bottom: { style: "thin" as const, color: { argb: borderColor } },
        right: { style: "thin" as const, color: { argb: borderColor } },
      };

      const familyPairs = Array.from(
        new Map(
          exportedArticles.map((row) => [
            familyKey(row.macro_famille, row.famille),
            {
              macro: row.macro_famille || "Sans macro-famille",
              famille: row.famille || "Sans famille",
            },
          ]),
        ).entries(),
      ).sort((a, b) => {
        const macro = a[1].macro.localeCompare(b[1].macro, "fr");
        return macro !== 0
          ? macro
          : a[1].famille.localeCompare(b[1].famille, "fr");
      });

      const familyWeekValues = new Map<string, number[]>();
      projectionRows.forEach((row) => {
        const key = `${familyKey(row.macro_famille, row.famille)}||${row.periode_debut}`;
        const coefficient =
          row.coefficient_prevision_applique === null ||
          row.coefficient_prevision_applique === undefined
            ? 1
            : toNumber(row.coefficient_prevision_applique);
        const evolution = coefficient - 1;
        const values = familyWeekValues.get(key) || [];
        values.push(evolution);
        familyWeekValues.set(key, values);
      });

      const hypothesisWeekStartColumn = 4;
      const hypothesisHeaderRow = 4;
      const hypothesisFamilyStartRow = 5;
      const fallbackEvolution = Math.max(0, defaultProjectionPct) / 100 - 1;
      const hypothesisRowByFamily = new Map<string, number>();

      hypothesisSheet.mergeCells(
        1,
        1,
        1,
        hypothesisWeekStartColumn + weeks.length - 1,
      );
      const hypothesisTitle = hypothesisSheet.getCell(1, 1);
      hypothesisTitle.value = "Hypothèses d’évolution par famille et par semaine";
      hypothesisTitle.font = {
        bold: true,
        size: 16,
        color: { argb: "FFFFFFFF" },
      };
      hypothesisTitle.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: darkBlue },
      };
      hypothesisTitle.alignment = { vertical: "middle", horizontal: "left" };
      hypothesisSheet.getRow(1).height = 28;

      hypothesisSheet.mergeCells(
        2,
        1,
        2,
        hypothesisWeekStartColumn + weeks.length - 1,
      );
      const hypothesisNote = hypothesisSheet.getCell(2, 1);
      hypothesisNote.value =
        "Les cellules bleues sont modifiables. La prévision supplémentaire de la feuille Projection articles est recalculée automatiquement pour toutes les références de la famille.";
      hypothesisNote.font = { italic: true, color: { argb: slate } };
      hypothesisNote.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: lightBlue },
      };
      hypothesisNote.alignment = { wrapText: true, vertical: "middle" };
      hypothesisSheet.getRow(2).height = 34;

      ["Famille macro", "Famille", "Clé famille"].forEach((label, index) => {
        const cell = hypothesisSheet.getCell(hypothesisHeaderRow, index + 1);
        cell.value = label;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: blue },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = thinBorder;
      });

      weeks.forEach((week, index) => {
        const cell = hypothesisSheet.getCell(
          hypothesisHeaderRow,
          hypothesisWeekStartColumn + index,
        );
        cell.value = new Date(`${week}T00:00:00`);
        cell.numFmt = "dd/mm/yyyy";
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: blue },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = thinBorder;
      });

      familyPairs.forEach(([key, pair], familyIndex) => {
        const rowNumber = hypothesisFamilyStartRow + familyIndex;
        hypothesisRowByFamily.set(key, rowNumber);
        const row = hypothesisSheet.getRow(rowNumber);
        row.getCell(1).value = pair.macro;
        row.getCell(2).value = pair.famille;
        row.getCell(3).value = key;
        row.getCell(3).font = { color: { argb: "FF94A3B8" } };

        weeks.forEach((week, weekIndex) => {
          const values = familyWeekValues.get(`${key}||${week}`) || [];
          const cell = row.getCell(hypothesisWeekStartColumn + weekIndex);
          cell.value = mostFrequentNumber(values, fallbackEvolution);
          cell.numFmt = "0%;[Red]-0%";
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: lightBlue },
          };
          cell.font = { bold: true, color: { argb: darkBlue } };
          cell.alignment = { horizontal: "center" };
          cell.dataValidation = {
            type: "decimal",
            operator: "between",
            allowBlank: false,
            formulae: [-1, 10],
            showErrorMessage: true,
            errorTitle: "Pourcentage invalide",
            error: "Saisis une évolution comprise entre -100 % et 1 000 %.",
          };
        });

        for (
          let column = 1;
          column <= hypothesisWeekStartColumn + weeks.length - 1;
          column += 1
        ) {
          row.getCell(column).border = thinBorder;
          row.getCell(column).alignment = {
            ...row.getCell(column).alignment,
            vertical: "middle",
            wrapText: true,
          };
        }
      });

      hypothesisSheet.getColumn(1).width = 18;
      hypothesisSheet.getColumn(2).width = 24;
      hypothesisSheet.getColumn(3).width = 28;
      hypothesisSheet.getColumn(3).hidden = true;
      weeks.forEach((_, index) => {
        hypothesisSheet.getColumn(hypothesisWeekStartColumn + index).width = 13;
      });
      hypothesisSheet.autoFilter = {
        from: { row: hypothesisHeaderRow, column: 1 },
        to: {
          row: hypothesisHeaderRow,
          column: hypothesisWeekStartColumn + weeks.length - 1,
        },
      };

      const metaHeaders = [
        "Famille macro",
        "Famille",
        "Article",
        "Désignation",
        "Fournisseur",
        "Classe ABC CA",
        "Classe ABC lignes",
        "BL YTD N",
        "BL YTD N-1",
        "Évol. BL YTD",
        "BL mois dernier N",
        "BL mois dernier N-1",
        "Évol. BL mois dernier",
        "Stock initial",
        "Stock sécurité",
        "Type de ligne",
      ];
      const weekStartColumn = metaHeaders.length + 1;
      const headerRowNumber = 4;

      projectionSheet.mergeCells(
        1,
        1,
        1,
        weekStartColumn + weeks.length - 1,
      );
      const titleCell = projectionSheet.getCell(1, 1);
      titleCell.value = "Projection de stock par article";
      titleCell.font = {
        bold: true,
        size: 18,
        color: { argb: "FFFFFFFF" },
      };
      titleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: darkBlue },
      };
      titleCell.alignment = { vertical: "middle", horizontal: "left" };
      projectionSheet.getRow(1).height = 30;

      projectionSheet.mergeCells(
        2,
        1,
        2,
        weekStartColumn + weeks.length - 1,
      );
      const subtitleCell = projectionSheet.getCell(2, 1);
      subtitleCell.value = `Export du ${new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date())} · ${formatNumber(exportedArticles.length)} article(s) · Les familles macro DIV, TECH et SAV sont exclues.`;
      subtitleCell.font = { italic: true, color: { argb: slate } };
      subtitleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: lightSlate },
      };

      metaHeaders.forEach((label, index) => {
        const cell = projectionSheet.getCell(headerRowNumber, index + 1);
        cell.value = label;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: blue },
        };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        cell.border = thinBorder;
      });

      weeks.forEach((week, index) => {
        const cell = projectionSheet.getCell(
          headerRowNumber,
          weekStartColumn + index,
        );
        cell.value = new Date(`${week}T00:00:00`);
        cell.numFmt = "dd/mm/yyyy";
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: blue },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = thinBorder;
      });
      projectionSheet.getRow(headerRowNumber).height = 34;

      const projectionByArticle = new Map<string, Map<string, ProjectionRow>>();
      projectionRows.forEach((row) => {
        const key = articleDepotKey(row.reference_article, row.depot);
        const byWeek =
          projectionByArticle.get(key) || new Map<string, ProjectionRow>();
        byWeek.set(row.periode_debut, row);
        projectionByArticle.set(key, byWeek);
      });

      const lineLabels = [
        "Stock projeté",
        "Sorties fermes",
        "Sorties BL N-1",
        "Prévision supplémentaire",
        "Entrées prévisionnelles",
      ];
      const lineFills = [
        "FFE2E8F0",
        "FFFEE2E2",
        "FFF8FAFC",
        "FFFFEDD5",
        "FFDCFCE7",
      ];

      exportedArticles.forEach((article, articleIndex) => {
        const startRow = 5 + articleIndex * 5;
        const stockRow = startRow;
        const firmRow = startRow + 1;
        const n1Row = startRow + 2;
        const additionalRow = startRow + 3;
        const incomingRow = startRow + 4;
        const byWeek =
          projectionByArticle.get(
            articleDepotKey(article.reference_article, article.depot),
          ) || new Map<string, ProjectionRow>();

        const metaValues: Array<string | number | null> = [
          article.macro_famille || "Sans macro-famille",
          article.famille || "Sans famille",
          article.reference_article,
          article.designation || "",
          article.fournisseur_principal || "",
          normalizeAbcClass(article.classe_abc_ca),
          normalizeAbcClass(article.classe_abc_lignes),
          toNumber(article.sorties_ytd_n),
          toNumber(article.sorties_ytd_n1),
          toNumber(article.sorties_ytd_evol_pct) / 100,
          toNumber(article.sorties_mois_passe_n),
          toNumber(article.sorties_mois_passe_n1),
          toNumber(article.sorties_mois_passe_evol_pct) / 100,
        ];

        metaValues.forEach((value, index) => {
          const column = index + 1;
          projectionSheet.mergeCells(startRow, column, startRow + 4, column);
          const cell = projectionSheet.getCell(startRow, column);
          cell.value = value;
          cell.alignment = {
            vertical: "middle",
            horizontal: column >= 6 ? "center" : "left",
            wrapText: true,
          };
          cell.border = thinBorder;
          if (column === 10) {
            const current = toNumber(article.sorties_ytd_n);
            const previous = toNumber(article.sorties_ytd_n1);
            const result =
              previous === 0
                ? current === 0
                  ? 0
                  : 1
                : (current - previous) / Math.abs(previous);
            cell.value = {
              formula: `IF(I${startRow}=0,IF(H${startRow}=0,0,1),(H${startRow}-I${startRow})/ABS(I${startRow}))`,
              result,
            };
            cell.numFmt = "0%;[Red]-0%";
          }
          if (column === 13) {
            const current = toNumber(article.sorties_mois_passe_n);
            const previous = toNumber(article.sorties_mois_passe_n1);
            const result =
              previous === 0
                ? current === 0
                  ? 0
                  : 1
                : (current - previous) / Math.abs(previous);
            cell.value = {
              formula: `IF(L${startRow}=0,IF(K${startRow}=0,0,1),(K${startRow}-L${startRow})/ABS(L${startRow}))`,
              result,
            };
            cell.numFmt = "0%;[Red]-0%";
          }
          if ([8, 9, 11, 12].includes(column)) cell.numFmt = "#,##0";
          if (column === 3) {
            cell.font = { bold: true, color: { argb: darkBlue } };
          }
          if (column === 6 || column === 7) {
            cell.font = { bold: true, color: { argb: darkBlue } };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: lightBlue },
            };
          }
        });

        const firstProjection = weeks
          .map((week) => byWeek.get(week))
          .find(Boolean);
        projectionSheet.getCell(stockRow, 14).value = toNumber(
          firstProjection?.stock_initial ?? article.stock_initial,
        );
        projectionSheet.getCell(stockRow, 15).value = toNumber(
          firstProjection?.stock_securite ?? article.stock_securite,
        );
        projectionSheet.getCell(stockRow, 14).numFmt = "#,##0";
        projectionSheet.getCell(stockRow, 15).numFmt = "#,##0";

        lineLabels.forEach((label, lineIndex) => {
          const rowNumber = startRow + lineIndex;
          const labelCell = projectionSheet.getCell(rowNumber, 26);
          labelCell.value = label;
          labelCell.font = { bold: true, color: { argb: slate } };
          labelCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: lineFills[lineIndex] },
          };
          labelCell.border = thinBorder;
          labelCell.alignment = { vertical: "middle", wrapText: true };
          projectionSheet.getRow(rowNumber).height = 21;
        });

        const articleFamilyKey = familyKey(
          article.macro_famille,
          article.famille,
        );
        const hypothesisRow = hypothesisRowByFamily.get(articleFamilyKey);

        weeks.forEach((week, weekIndex) => {
          const column = weekStartColumn + weekIndex;
          const columnLetter = excelColumnName(column);
          const previousColumnLetter = excelColumnName(column - 1);
          const projectionRow = byWeek.get(week);
          const firm = Math.max(
            0,
            toNumber(projectionRow?.besoins_clients_fermes),
          );
          const n1 = Math.max(0, toNumber(projectionRow?.prevision_base_n1));
          const additional = Math.max(
            0,
            toNumber(projectionRow?.prevision_ventes),
          );
          const incoming = Math.max(
            0,
            toNumber(projectionRow?.commandes_fournisseurs_attendues),
          );
          const currentStock = toNumber(projectionRow?.stock_projete);

          const firmCell = projectionSheet.getCell(firmRow, column);
          firmCell.value = firm === 0 ? null : firm;
          const n1Cell = projectionSheet.getCell(n1Row, column);
          n1Cell.value = n1;
          const incomingCell = projectionSheet.getCell(incomingRow, column);
          incomingCell.value = incoming === 0 ? null : incoming;

          const hypothesisColumnLetter = excelColumnName(
            hypothesisWeekStartColumn + weekIndex,
          );
          const hypothesisReference = hypothesisRow
            ? `'Hypothèses familles'!$${hypothesisColumnLetter}$${hypothesisRow}`
            : String(fallbackEvolution);
          const additionalCell = projectionSheet.getCell(additionalRow, column);
          additionalCell.value = {
            formula: `MAX(0,${columnLetter}${n1Row}*(1+${hypothesisReference})-N(${columnLetter}${firmRow}))`,
            result: additional,
          };

          const stockCell = projectionSheet.getCell(stockRow, column);
          const stockFormula =
            weekIndex === 0
              ? `$N${stockRow}+N(${columnLetter}${incomingRow})-N(${columnLetter}${firmRow})-N(${columnLetter}${additionalRow})`
              : `${previousColumnLetter}${stockRow}+N(${columnLetter}${incomingRow})-N(${columnLetter}${firmRow})-N(${columnLetter}${additionalRow})`;
          stockCell.value = { formula: stockFormula, result: currentStock };

          [stockCell, firmCell, n1Cell, additionalCell, incomingCell].forEach(
            (cell) => {
              cell.numFmt = "#,##0";
              cell.border = thinBorder;
              cell.alignment = { horizontal: "right", vertical: "middle" };
            },
          );

          firmCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: redFill },
          };
          n1Cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFC" },
          };
          additionalCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: orangeFill },
          };
          incomingCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: greenFill },
          };

        });

        for (
          let rowNumber = startRow;
          rowNumber <= startRow + 4;
          rowNumber += 1
        ) {
          for (
            let column = 1;
            column <= weekStartColumn + weeks.length - 1;
            column += 1
          ) {
            const cell = projectionSheet.getCell(rowNumber, column);
            if (!cell.border) cell.border = thinBorder;
          }
        }
      });

      const firstWeekLetter = excelColumnName(weekStartColumn);
      const lastWeekLetter = excelColumnName(
        weekStartColumn + weeks.length - 1,
      );
      const lastExportRow = 4 + exportedArticles.length * 5;
      const stockRowPredicate = `MOD(ROW()-5,5)=0`;
      const securityForCurrentBlock = `INDEX($O:$O,ROW()-MOD(ROW()-5,5))`;

      projectionSheet.addConditionalFormatting({
        ref: `${firstWeekLetter}5:${lastWeekLetter}${lastExportRow}`,
        rules: [
          {
            type: "expression",
            priority: 1,
            formulae: [
              `AND(${stockRowPredicate},${firstWeekLetter}5<0)`,
            ],
            style: {
              fill: {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: redFill },
              },
              font: { bold: true, color: { argb: redFont } },
            },
          },
          {
            type: "expression",
            priority: 2,
            formulae: [
              `AND(${stockRowPredicate},${firstWeekLetter}5>=0,${firstWeekLetter}5<${securityForCurrentBlock})`,
            ],
            style: {
              fill: {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: orangeFill },
              },
              font: { bold: true, color: { argb: orangeFont } },
            },
          },
          {
            type: "expression",
            priority: 3,
            formulae: [
              `AND(${stockRowPredicate},${firstWeekLetter}5>=${securityForCurrentBlock},${firstWeekLetter}5<${securityForCurrentBlock}*1.2)`,
            ],
            style: {
              fill: {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: yellowFill },
              },
              font: { bold: true, color: { argb: yellowFont } },
            },
          },
          {
            type: "expression",
            priority: 4,
            formulae: [
              `AND(${stockRowPredicate},${firstWeekLetter}5>=${securityForCurrentBlock}*1.2)`,
            ],
            style: {
              fill: {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: greenFill },
              },
              font: { bold: true, color: { argb: greenFont } },
            },
          },
        ],
      });

      const widths = [
        18,
        22,
        18,
        34,
        24,
        13,
        15,
        12,
        12,
        13,
        15,
        15,
        17,
        12,
        12,
        24,
      ];
      widths.forEach((width, index) => {
        projectionSheet.getColumn(index + 1).width = width;
      });
      projectionSheet.getColumn(14).hidden = true;
      projectionSheet.getColumn(15).hidden = true;
      weeks.forEach((_, index) => {
        projectionSheet.getColumn(weekStartColumn + index).width = 13;
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Projection_stocks_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportProgress(null);
    } catch (err: any) {
      setExportProgress(null);
      setError(
        friendlyError(
          err,
          "Erreur pendant la création de l’export Excel des projections.",
        ),
      );
    } finally {
      setExportingExcel(false);
    }
  }

  async function testConnection() {
    setTestingConnection(true);
    setConnectionDiagnostic(null);
    const traceId = createClientTraceId("STOCK-CHECK");
    try {
      const { response, payload } = await authenticatedFetch(
        `/api/stocks-disponibilites/diagnostics?trace_id=${encodeURIComponent(traceId)}`,
        traceId,
      );
      if (payload.diagnostic) setConnectionDiagnostic(payload.diagnostic);
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || `Diagnostic HTTP ${response.status}`);
      }
    } catch (err) {
      setConnectionDiagnostic((current) =>
        current ||
        localDiagnosticReport(
          traceId,
          "connection_diagnostic",
          "/api/stocks-disponibilites/diagnostics",
          err,
        ),
      );
    } finally {
      setTestingConnection(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!filteredAlertes.length) {
      if (selected) setSelected(null);
      return;
    }

    const selectedStillVisible = selected
      ? filteredAlertes.some(
          (row) =>
            row.reference_article === selected.reference_article &&
            (row.depot || "GLOBAL") === (selected.depot || "GLOBAL"),
        )
      : false;

    if (!selectedStillVisible) setSelected(filteredAlertes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAlertes]);

  useEffect(() => {
    loadDetail(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.reference_article, selected?.depot]);

  useEffect(() => {
    loadSelectionProjection(filteredAlertes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregateSelectionSignature, kpi?.run_id]);

  const selectedLevel = String(selected?.niveau_alerte || "VERT").toUpperCase();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 md:px-6 lg:px-8">
      <div className="mx-auto max-w-none space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-blue-700">
                Stocks & disponibilités
              </p>
              <h1 className="mt-1 text-3xl font-black text-slate-950">
                Projection de stock par article
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                Vision consolidée du stock disponible, des commandes
                fournisseurs ouvertes, des besoins clients fermes et des sorties
                projetées sur la base BL N-1.
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Dernier calcul :{" "}
                {formatDateTime(kpi?.run_completed_at || kpi?.run_created_at)} ·
                Horizon : {kpi?.run_nb_semaines || "—"} semaines · Coefficient
                défaut : {formatPercent(kpi?.scenario_prevision_pct || 1.2)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <label className="text-xs font-bold text-slate-600">
                  Horizon semaines
                  <input
                    type="number"
                    min="1"
                    max="104"
                    value={horizonWeeks}
                    onChange={(event) =>
                      setHorizonWeeks(Number(event.target.value))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  Projection défaut %
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={defaultProjectionPct}
                    onChange={(event) =>
                      setDefaultProjectionPct(Number(event.target.value))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950"
                  />
                </label>
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={testingConnection}
                  className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {testingConnection ? "Test en cours…" : "Tester la connexion"}
                </button>
                <button
                  type="button"
                  onClick={exportFilteredArticlesToExcel}
                  disabled={exportingExcel || loading || !filteredAlertes.length}
                  className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportingExcel ? "Export en cours…" : "Exporter Excel"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rebuildProjection(
                      "Recalcul depuis écran Stocks & disponibilités",
                    )
                  }
                  disabled={recalculating}
                  className="col-span-2 mt-5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recalculating
                    ? `Recalcul ${Math.round(rebuildProgress?.percent || 0)} %`
                    : "Recalculer toute la projection"}
                </button>
              </div>
              {recalculating && rebuildProgress ? (
                <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900">
                  {rebuildProgress.message}
                </div>
              ) : exportProgress ? (
                <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
                  {exportProgress}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {diagnostic ? (
          <DiagnosticPanel
            report={diagnostic}
            tone={diagnostic.status === "WARNING" ? "warning" : "error"}
            onRetry={() =>
              loadData({ keepSelected: true, keepProjectionSettings: true })
            }
            retrying={loading}
            onTest={testConnection}
            testing={testingConnection}
          />
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            {error}
          </div>
        ) : null}

        {connectionDiagnostic ? (
          <DiagnosticPanel
            report={connectionDiagnostic}
            tone={
              connectionDiagnostic.status === "SUCCESS"
                ? "success"
                : connectionDiagnostic.status === "WARNING"
                  ? "warning"
                  : "error"
            }
            onTest={testConnection}
            testing={testingConnection}
          />
        ) : null}

        {loading ? (
          <EmptyState
            title="Chargement des projections…"
            message="Lecture des KPI et des alertes articles."
          />
        ) : !kpi?.run_id ? (
          <EmptyState
            title="Aucune projection disponible"
            message="Lance un calcul de projection depuis l’écran Import ou le bouton Recalculer toute la projection."
          />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
              <KpiCard
                label="Articles suivis"
                value={formatNumber(filteredKpi.articles_suivis)}
                detail="Sélection filtrée"
              />
              <KpiCard
                label="Rupture actuelle"
                value={formatNumber(ruptureHorizonKpi.current)}
                detail="Stock projeté < 0"
                tone="text-red-700"
                active={filters.ruptureHorizon === "CURRENT"}
                onClick={() => setRuptureHorizonFilter("CURRENT")}
              />
              <KpiCard
                label="Rupture ≤ 8 sem."
                value={formatNumber(ruptureHorizonKpi.weeks8)}
                detail={ruptureHorizonKpi.detail8}
                tone="text-red-700"
                active={filters.ruptureHorizon === "8"}
                onClick={() => setRuptureHorizonFilter("8")}
              />
              <KpiCard
                label="Rupture ≤ 12 sem."
                value={formatNumber(ruptureHorizonKpi.weeks12)}
                detail={ruptureHorizonKpi.detail12}
                tone="text-red-700"
                active={filters.ruptureHorizon === "12"}
                onClick={() => setRuptureHorizonFilter("12")}
              />
              <KpiCard
                label="Rupture ≤ 16 sem."
                value={formatNumber(ruptureHorizonKpi.weeks16)}
                detail={ruptureHorizonKpi.detail16}
                tone="text-red-700"
                active={filters.ruptureHorizon === "16"}
                onClick={() => setRuptureHorizonFilter("16")}
              />
              <KpiCard
                label="Sous sécurité"
                value={formatNumber(
                  (filteredKpi.articles_orange || 0) +
                    (filteredKpi.articles_jaune || 0),
                )}
                detail="Stock projeté < seuil"
                tone="text-orange-700"
              />
              <KpiCard
                label="Besoins fermes"
                value={formatNumber(filteredKpi.besoins_clients_fermes)}
                detail="CDC / PL ouverts"
              />
              <KpiCard
                label="Prévisions compl."
                value={formatNumber(filteredKpi.prevision_ventes)}
                detail={`Après déduction des besoins fermes · Base N-1 : ${formatNumber(filteredKpi.prevision_base_n1)}`}
              />
              <KpiCard
                label="Entrées BDCF"
                value={formatNumber(
                  filteredKpi.commandes_fournisseurs_attendues,
                )}
                detail="Commandes ouvertes"
                tone="text-emerald-700"
              />
              <KpiCard
                label="CA à risque"
                value={formatCurrencyK(filteredKpi.ca_client_risque)}
                detail={`${formatNumber(
                  filteredKpi.nb_commandes_clients_risque,
                )} commandes`}
                tone="text-red-700"
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-9">
                <input
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      search: event.target.value,
                    }))
                  }
                  placeholder="Rechercher référence, désignation, famille, fournisseur…"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm xl:col-span-2"
                />
                <select
                  value={filters.niveau}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      niveau: event.target.value as Filters["niveau"],
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="TOUS">Toutes alertes</option>
                  <option value="ROUGE">Rupture</option>
                  <option value="ORANGE">Sous sécurité</option>
                  <option value="JAUNE">Proche sécurité</option>
                  <option value="VERT">OK</option>
                </select>
                <select
                  value={filters.macroFamille}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      macroFamille: event.target.value,
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="TOUS">Toutes macro-familles</option>
                  {macroFamilles.map((macro) => (
                    <option key={macro} value={macro}>
                      {macro}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.famille}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      famille: event.target.value,
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="TOUS">Toutes familles</option>
                  {familles.map((famille) => (
                    <option key={famille} value={famille}>
                      {famille}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.fournisseur}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      fournisseur: event.target.value,
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="TOUS">Tous fournisseurs</option>
                  {fournisseursList.map((fournisseur) => (
                    <option key={fournisseur} value={fournisseur}>
                      {fournisseur}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.abcCa}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      abcCa: event.target.value as Filters["abcCa"],
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  title="Classification ABC selon le montant HT cumulé des BL depuis le début de l'année"
                >
                  <option value="TOUS">ABC CA : tous</option>
                  <option value="A">ABC CA : A</option>
                  <option value="B">ABC CA : B</option>
                  <option value="C">ABC CA : C</option>
                </select>
                <select
                  value={filters.abcLignes}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      abcLignes: event.target.value as Filters["abcLignes"],
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  title="Classification ABC selon le nombre cumulé de lignes de BL depuis le début de l'année"
                >
                  <option value="TOUS">ABC lignes : tous</option>
                  <option value="A">ABC lignes : A</option>
                  <option value="B">ABC lignes : B</option>
                  <option value="C">ABC lignes : C</option>
                </select>
                <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={filters.onlyWithRupture}
                    onChange={(event) =>
                      setFilters((prev) => ({
                        ...prev,
                        onlyWithRupture: event.target.checked,
                      }))
                    }
                  />
                  Avec rupture
                </label>
              </div>

              {filters.ruptureHorizon !== "TOUS" ? (
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <span className="font-bold">
                    Filtre KPI actif :{" "}
                    {filters.ruptureHorizon === "CURRENT"
                      ? "rupture actuelle"
                      : `rupture dans les ${filters.ruptureHorizon} prochaines semaines`}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        ruptureHorizon: "TOUS",
                      }))
                    }
                    className="rounded-lg bg-white px-3 py-1 text-xs font-black text-blue-700 shadow-sm"
                  >
                    Retirer
                  </button>
                </div>
              ) : null}
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-4">
                  <h2 className="text-xl font-black text-slate-950">
                    Articles à risque
                  </h2>
                  <p className="text-sm text-slate-500">
                    {formatNumber(filteredAlertes.length)} article(s) affiché(s) · ABC BL YTD : CA HT / lignes.
                  </p>
                </div>

                {filteredAlertes.length ? (
                  <div className="border-b border-slate-200 bg-slate-50/50 p-4">
                    {aggregateProjectionError ? (
                      <div
                        role="alert"
                        className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"
                      >
                        {aggregateProjectionError}
                      </div>
                    ) : null}

                    <div className="mb-2">
                      <div className="text-sm font-black text-slate-950">
                        Projection de la sélection filtrée
                      </div>
                      <div className="text-xs text-slate-500">
                        Somme hebdomadaire des stocks, entrées et besoins des {formatNumber(
                          filteredAlertes.length,
                        )} article(s) visibles. Le graphe suit tous les filtres, y compris la recherche libre par référence ou désignation.
                      </div>
                    </div>

                    {aggregateProjectionLoading ? (
                      <EmptyState
                        title="Chargement de la sélection…"
                        message="Lecture et agrégation des projections hebdomadaires filtrées."
                      />
                    ) : (
                      <ProjectionChart rows={selectionProjection} compact />
                    )}
                  </div>
                ) : null}

                <div className="max-h-[820px] overflow-y-auto overflow-x-hidden">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-[5%]" />
                      <col className="w-[20%]" />
                      <col className="w-[13%]" />
                      <col className="w-[8%]" />
                      <col className="w-[6%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[6%]" />
                      <col className="w-[7%]" />
                      <col className="w-[7%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <SortableTh
                          label="Al."
                          sortKey="niveau_alerte"
                          sortState={sortState}
                          onSort={toggleSort}
                        />
                        <SortableTh
                          label="Article"
                          sortKey="reference_article"
                          sortState={sortState}
                          onSort={toggleSort}
                        />
                        <SortableTh
                          label="Macro / fam."
                          sortKey="macro_famille"
                          sortState={sortState}
                          onSort={toggleSort}
                        />
                        <th className="border-b border-slate-200 px-1 py-3 text-center text-[10px] font-black uppercase tracking-wide text-slate-600">
                          ABC
                        </th>
                        <SortableTh
                          label="Stock"
                          sortKey="stock_initial"
                          sortState={sortState}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label="BL YTD"
                          sortKey="sorties_ytd_n"
                          sortState={sortState}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label="BL M-1"
                          sortKey="sorties_mois_passe_n"
                          sortState={sortState}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label="Sécu"
                          sortKey="stock_securite"
                          sortState={sortState}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label="Mini"
                          sortKey="stock_projete_min"
                          sortState={sortState}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label="Manque"
                          sortKey="qte_manquante_max"
                          sortState={sortState}
                          onSort={toggleSort}
                          align="right"
                        />
                        <SortableTh
                          label="Rupture"
                          sortKey="date_rupture"
                          sortState={sortState}
                          onSort={toggleSort}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAlertes.map((row) => {
                        const isSelected =
                          selected?.reference_article ===
                            row.reference_article &&
                          (selected?.depot || "GLOBAL") ===
                            (row.depot || "GLOBAL");

                        return (
                          <tr
                            key={`${row.reference_article}-${row.depot || "GLOBAL"}`}
                            onClick={() => setSelected(row)}
                            className={`cursor-pointer border-b border-slate-100 transition ${
                              isSelected
                                ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                                : rowToneClass(row.niveau_alerte)
                            }`}
                          >
                            <td className="px-2 py-3 align-middle">
                              <span
                                title={alertLabel(row.niveau_alerte)}
                                className={`inline-flex min-w-[34px] items-center justify-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-black ${alertClass(
                                  row.niveau_alerte,
                                )}`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${dotClass(
                                    row.niveau_alerte,
                                  )}`}
                                />
                                {alertCompactLabel(row.niveau_alerte)}
                              </span>
                            </td>
                            <td className="px-2.5 py-3 align-middle">
                              <div
                                className="truncate text-[15px] font-black leading-5 text-slate-950"
                                title={row.reference_article}
                              >
                                {row.reference_article}
                              </div>
                              <div
                                className="truncate text-xs leading-5 text-slate-500"
                                title={row.designation || ""}
                              >
                                {row.designation || "—"}
                              </div>
                              <div
                                className="truncate text-[11px] leading-4 text-slate-400"
                                title={row.fournisseur_principal || ""}
                              >
                                {row.fournisseur_principal || "—"}
                              </div>
                            </td>
                            <td className="px-2.5 py-3 align-middle">
                              <div
                                className="truncate text-sm font-bold leading-5 text-slate-700"
                                title={row.macro_famille || ""}
                              >
                                {row.macro_famille || "—"}
                              </div>
                              <div
                                className="truncate text-xs leading-5 text-slate-500"
                                title={row.famille || ""}
                              >
                                {row.famille || "—"}
                              </div>
                            </td>
                            <td className="px-1 py-3 align-middle">
                              <div className="flex flex-col items-center gap-1">
                                <AbcBadge
                                  label="CA"
                                  value={row.classe_abc_ca}
                                  compact
                                  title={`ABC CA BL ${row.abc_annee || new Date().getFullYear()} · ${formatNumber(row.abc_ca_bl_ytd)} € · part ${formatNumber(row.abc_part_ca_pct, 1)} % · cumul ${formatNumber(row.abc_cumul_ca_pct, 1)} %`}
                                />
                                <AbcBadge
                                  label="L"
                                  value={row.classe_abc_lignes}
                                  compact
                                  title={`ABC lignes BL ${row.abc_annee || new Date().getFullYear()} · ${formatNumber(row.abc_nb_lignes_bl_ytd)} lignes · part ${formatNumber(row.abc_part_lignes_pct, 1)} % · cumul ${formatNumber(row.abc_cumul_lignes_pct, 1)} %`}
                                />
                              </div>
                            </td>
                            <td className="px-2.5 py-3 text-right align-middle text-[15px] font-bold tabular-nums whitespace-nowrap">
                              {formatNumber(row.stock_initial)}
                            </td>
                            <td className="px-2.5 py-3 text-right align-middle">
                              <QuantityWithEvolution
                                current={row.sorties_ytd_n}
                                previous={row.sorties_ytd_n1}
                              />
                            </td>
                            <td className="px-2.5 py-3 text-right align-middle">
                              <QuantityWithEvolution
                                current={row.sorties_mois_passe_n}
                                previous={row.sorties_mois_passe_n1}
                              />
                            </td>
                            <td className="px-2.5 py-3 text-right align-middle text-[15px] font-bold tabular-nums whitespace-nowrap">
                              {formatNumber(row.stock_securite)}
                            </td>
                            <td
                              className={`px-2.5 py-3 text-right align-middle text-[15px] font-black tabular-nums whitespace-nowrap ${
                                toNumber(row.stock_projete_min) < 0
                                  ? "text-red-700"
                                  : toNumber(row.stock_projete_min) <
                                      toNumber(row.stock_securite)
                                    ? "text-orange-700"
                                    : "text-slate-700"
                              }`}
                            >
                              {formatNumber(row.stock_projete_min)}
                            </td>
                            <td className="px-2.5 py-3 text-right align-middle text-[15px] font-black tabular-nums whitespace-nowrap text-red-700">
                              {formatNumber(row.qte_manquante_max)}
                            </td>
                            <td className="px-2 py-3 text-right align-middle text-[11px] font-semibold tabular-nums whitespace-nowrap text-slate-600">
                              {formatDate(row.date_rupture)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {!filteredAlertes.length ? (
                    <div className="p-6">
                      <EmptyState
                        title="Aucun article dans cette sélection"
                        message="Modifie les filtres pour élargir la recherche."
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="min-w-0 space-y-4">
                {selected ? (
                  <>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-black ${alertClass(
                              selectedLevel,
                            )}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${dotClass(
                                selectedLevel,
                              )}`}
                            />
                            {alertCompactLabel(selectedLevel)}
                          </span>
                          <h2 className="mt-2 break-words text-xl font-black leading-tight text-slate-950">
                            {selected.reference_article}
                          </h2>
                          <p className="mt-0.5 text-sm leading-4 text-slate-600">
                            {selected.designation || "Sans désignation"}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {selected.macro_famille || "Sans macro-famille"} ·{" "}
                            {selected.famille || "Sans famille"}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <AbcBadge
                              label="ABC CA"
                              value={selected.classe_abc_ca}
                              title={`Montant BL ${selected.abc_annee || new Date().getFullYear()} : ${formatNumber(selected.abc_ca_bl_ytd)} € · part ${formatNumber(selected.abc_part_ca_pct, 1)} % · cumul ${formatNumber(selected.abc_cumul_ca_pct, 1)} %`}
                            />
                            <AbcBadge
                              label="ABC lignes"
                              value={selected.classe_abc_lignes}
                              title={`Lignes BL ${selected.abc_annee || new Date().getFullYear()} : ${formatNumber(selected.abc_nb_lignes_bl_ytd)} · part ${formatNumber(selected.abc_part_lignes_pct, 1)} % · cumul ${formatNumber(selected.abc_cumul_lignes_pct, 1)} %`}
                            />
                          </div>
                        </div>
                        <div className="text-right text-[11px] leading-4 text-slate-500">
                          <div>
                            Dépôt :{" "}
                            <span className="font-bold text-slate-700">
                              {selected.depot || "GLOBAL"}
                            </span>
                          </div>
                          <div>
                            Fournisseur :{" "}
                            <span className="font-bold text-slate-700">
                              {selected.fournisseur_principal || "—"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-5 gap-2">
                        <KpiMini
                          label="Stock initial"
                          value={formatNumber(selected.stock_initial)}
                        />
                        <KpiMini
                          label="BL YTD"
                          value={formatNumber(selected.sorties_ytd_n)}
                          detail={`Évol. ${formatEvolution(
                            selected.sorties_ytd_n,
                            selected.sorties_ytd_n1,
                          )}`}
                        />
                        <KpiMini
                          label="BL mois passé"
                          value={formatNumber(selected.sorties_mois_passe_n)}
                          detail={`Évol. ${formatEvolution(
                            selected.sorties_mois_passe_n,
                            selected.sorties_mois_passe_n1,
                          )}`}
                        />
                        <KpiMini
                          label="Stock sécurité"
                          value={formatNumber(selected.stock_securite)}
                        />
                        <KpiMini
                          label="Stock mini projeté"
                          value={formatNumber(selected.stock_projete_min)}
                          tone={
                            toNumber(selected.stock_projete_min) < 0
                              ? "text-red-700"
                              : toNumber(selected.stock_projete_min) <
                                  toNumber(selected.stock_securite)
                                ? "text-orange-700"
                                : undefined
                          }
                        />
                        <KpiMini
                          label="Stock ferme mini"
                          value={formatNumber(selected.stock_projete_ferme_min)}
                          tone={
                            toNumber(selected.stock_projete_ferme_min) < 0
                              ? "text-red-700"
                              : undefined
                          }
                        />
                        <KpiMini
                          label="Dispo ferme"
                          value={formatDate(selected.date_retour_dispo_ferme)}
                        />
                        <KpiMini
                          label="Manque max"
                          value={formatNumber(selected.qte_manquante_max)}
                          tone="text-red-700"
                        />
                        <KpiMini
                          label="Retour dispo"
                          value={formatDate(selected.date_retour_dispo)}
                        />
                      </div>

                      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                        <div className="mb-1.5 text-xs font-black text-slate-900">
                          Stock de sécurité article
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="min-w-[150px] text-[11px] font-bold text-slate-600">
                            Quantité seuil
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={stockSecurityInput}
                              onChange={(event) =>
                                setStockSecurityInput(event.target.value)
                              }
                              className="mt-1 w-32 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-right text-sm font-bold text-slate-950"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={saveStockSecurity}
                            disabled={savingSecurity || recalculating}
                            className="rounded-xl bg-blue-700 px-3 py-1.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingSecurity
                              ? "Enregistrement…"
                              : "Enregistrer le seuil"}
                          </button>
                          <p className="min-w-[180px] flex-1 text-[11px] leading-4 text-slate-500">
                            Si l’article n’existe pas encore dans les
                            paramètres, il est créé automatiquement. Le seuil
                            est appliqué au dernier calcul sans recalcul global.
                          </p>
                        </div>

                        <div className="mt-2 border-t border-slate-200 pt-2">
                          <div className="mb-1.5 text-xs font-black text-slate-900">
                            Évolution de l’article sur tout l’horizon
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="min-w-[150px] text-[11px] font-bold text-slate-600">
                              Évolution vs BL N-1
                              <div className="relative mt-1 w-32">
                                <input
                                  type="number"
                                  min="-100"
                                  step="1"
                                  placeholder="Mixte"
                                  value={articleEvolutionPct}
                                  onChange={(event) =>
                                    setArticleEvolutionPct(event.target.value)
                                  }
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 pr-7 text-right text-sm font-bold text-slate-950"
                                />
                                <span className="pointer-events-none absolute right-2 top-1.5 text-sm font-bold text-slate-500">
                                  %
                                </span>
                              </div>
                            </label>
                            <button
                              type="button"
                              onClick={applyArticleEvolutionToHorizon}
                              disabled={!projection.length || savingWeekly}
                              className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-black text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Appliquer aux {projection.length || horizonWeeks} semaines
                            </button>
                            <p className="min-w-[180px] flex-1 text-[11px] leading-4 text-slate-500">
                              Exemple : +20 % applique un coefficient de 120 %. Les
                              quantités forcées semaine par semaine sont effacées, puis
                              l’enregistrement recalcule uniquement cet article.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {detailDiagnostic ? (
                      <DiagnosticPanel
                        report={detailDiagnostic}
                        tone="warning"
                        onRetry={() => loadDetail(selected)}
                        retrying={detailLoading}
                        onTest={testConnection}
                        testing={testingConnection}
                      />
                    ) : detailWarning ? (
                      <div
                        role="status"
                        className="break-words rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium leading-5 text-amber-800"
                      >
                        {detailWarning}
                      </div>
                    ) : null}

                    {detailLoading ? (
                      <EmptyState
                        title="Chargement du détail article…"
                        message="Lecture de la projection hebdomadaire et des mouvements associés."
                      />
                    ) : (
                      <>
                        <ProjectionChart rows={projection} />

                        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-black text-slate-950">
                                Hypothèses de projection
                              </div>
                              <div className="text-xs text-slate-500">
                                Modifie les coefficients ou force une quantité
                                semaine par semaine, puis enregistre pour
                                recalculer toute la projection.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={saveWeeklyAssumptions}
                              disabled={
                                savingWeekly ||
                                recalculating ||
                                !projection.length
                              }
                              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {savingWeekly
                                ? "Enregistrement…"
                                : "Enregistrer hypothèses et recalculer"}
                            </button>
                          </div>
                        </div>

                        <WeeklyProjectionTable
                          rows={projection}
                          weeklyPct={weeklyPct}
                          weeklyManualQty={weeklyManualQty}
                          onChangePct={(periodeDebut, value) =>
                            setWeeklyPct((prev) => ({
                              ...prev,
                              [periodeDebut]: value,
                            }))
                          }
                          onChangeManualQty={(periodeDebut, value) =>
                            setWeeklyManualQty((prev) => ({
                              ...prev,
                              [periodeDebut]: value,
                            }))
                          }
                        />

                        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                          <DetailTable
                            title="Commandes fournisseurs ouvertes"
                            subtitle="Réceptions futures issues du BDCF"
                            empty="Aucune commande fournisseur ouverte trouvée pour cet article."
                            headers={["Date", "Fournisseur", "N° CF", "Qté"]}
                            rows={fournisseurs.map((row) => [
                              formatDate(
                                row.date_livraison_calculee ||
                                  row.date_livraison,
                              ),
                              row.fournisseur_nom ||
                                row.fournisseur_code ||
                                "—",
                              row.numero_piece || "—",
                              formatNumber(row.quantite_attendue),
                            ])}
                          />
                          <DetailTable
                            title="Besoins clients fermes"
                            subtitle="CDC / PL ouverts par date de besoin"
                            empty="Aucun besoin client ferme trouvé pour cet article."
                            headers={["Date", "Pièces", "Nb", "Qté"]}
                            rows={besoinsClients.map((row) => [
                              formatDate(row.date_besoin),
                              row.numeros_pieces || "—",
                              formatNumber(row.nb_commandes),
                              formatNumber(row.quantite_besoin),
                            ])}
                          />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <EmptyState
                    title="Aucun article sélectionné"
                    message="Clique sur un article pour afficher sa projection détaillée."
                  />
                )}
              </aside>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
