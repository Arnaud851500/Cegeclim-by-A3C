"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AlertLevel = "ROUGE" | "ORANGE" | "JAUNE" | "VERT" | string;
type AbcClass = "A" | "B" | "C";

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

function ProjectionChart({ rows }: { rows: ProjectionRow[] }) {
  const width = 920;
  const height = 280;
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
        className="h-[300px] min-w-[920px] w-full"
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
  const [fournisseurs, setFournisseurs] = useState<FournisseurRow[]>([]);
  const [besoinsClients, setBesoinsClients] = useState<BesoinClientRow[]>([]);
  const [selected, setSelected] = useState<StockAlertRow | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortState, setSortState] = useState<SortState>({
    key: "niveau_alerte",
    direction: "asc",
  });
  const [horizonWeeks, setHorizonWeeks] = useState(16);
  const [defaultProjectionPct, setDefaultProjectionPct] = useState(120);
  const [stockSecurityInput, setStockSecurityInput] = useState("0");
  const [weeklyPct, setWeeklyPct] = useState<Record<string, number>>({});
  const [weeklyManualQty, setWeeklyManualQty] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [savingWeekly, setSavingWeekly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailWarning, setDetailWarning] = useState<string | null>(null);

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

    try {
      const [kpiResponse, alertesResponse] = await Promise.all([
        supabase.from("v_stock_projection_kpis").select("*").maybeSingle(),
        supabase.from("v_stock_projection_alertes_abc").select("*"),
      ]);

      if (kpiResponse.error) throw kpiResponse.error;
      if (alertesResponse.error) throw alertesResponse.error;

      const nextKpi = (kpiResponse.data || null) as StockKpi | null;
      const nextAlertes = (
        (alertesResponse.data || []) as StockAlertRow[]
      ).sort(sortAlerts);

      setKpi(nextKpi);
      setAlertes(nextAlertes);

      if (nextKpi && !options?.keepProjectionSettings) {
        setHorizonWeeks(Number(nextKpi.run_nb_semaines || 16));
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
      setError(
        friendlyError(
          err,
          "Erreur pendant le chargement des projections stock.",
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
    setDetailWarning(null);

    if (!row?.reference_article) return;

    setStockSecurityInput(String(toNumber(row.stock_securite)));
    setDetailLoading(true);

    const warnings: string[] = [];

    try {
      const projectionResponse = await supabase
        .from("v_stock_projection_hebdo_latest")
        .select("*")
        .eq("reference_article", row.reference_article)
        .eq("depot", row.depot || "GLOBAL")
        .order("periode_debut", { ascending: true });

      if (projectionResponse.error) throw projectionResponse.error;
      const nextProjection = (projectionResponse.data || []) as ProjectionRow[];
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

      const cfResponse = await supabase
        .from("v_commandes_fournisseurs_ouvertes_enrichies")
        .select(
          "numero_piece,fournisseur_code,fournisseur_nom,date_livraison,date_livraison_calculee,reference_article,designation,depot,quantite_attendue,montant_ht",
        )
        .eq("reference_article", row.reference_article)
        .order("date_livraison_calculee", { ascending: true })
        .limit(100);

      if (cfResponse.error) {
        warnings.push(
          `Commandes fournisseurs non affichées : ${friendlyError(
            cfResponse.error,
            "Erreur de lecture des commandes fournisseurs.",
          )}`,
        );
      } else {
        setFournisseurs((cfResponse.data || []) as FournisseurRow[]);
      }

      const besoinsResponse = await supabase
        .from("v_stock_besoins_clients_ouverts_source")
        .select(
          "reference_article,designation,depot,date_besoin,quantite_besoin,montant_ht,nb_commandes,numeros_pieces",
        )
        .eq("reference_article", row.reference_article)
        .order("date_besoin", { ascending: true })
        .limit(100);

      if (besoinsResponse.error) {
        warnings.push(
          `Besoins clients non affichés : ${friendlyError(
            besoinsResponse.error,
            "Erreur de lecture des besoins clients.",
          )}`,
        );
      } else {
        setBesoinsClients((besoinsResponse.data || []) as BesoinClientRow[]);
      }

      setDetailWarning(warnings.length ? warnings.join(" | ") : null);
    } catch (err: any) {
      setDetailWarning(
        friendlyError(err, "Erreur pendant le chargement du détail article."),
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function rebuildProjection(commentaire: string) {
    const currentSelected = selected;
    setRecalculating(true);
    setError(null);

    try {
      const weeks = Math.max(1, Math.min(104, Number(horizonWeeks || 16)));
      const pct = Math.max(0, Number(defaultProjectionPct || 120)) / 100;

      const sessionResponse = await supabase.auth.getSession();
      const token = sessionResponse.data.session?.access_token;

      const response = await fetch("/api/stocks-disponibilites/rebuild", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          date_debut: new Date().toISOString().slice(0, 10),
          nb_semaines: weeks,
          scenario_prevision_pct: pct,
          depot_mode: "GLOBAL",
          commentaire,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Erreur HTTP ${response.status} pendant le recalcul de projection.`,
        );
      }

      await loadData({
        keepSelected: Boolean(currentSelected),
        keepProjectionSettings: true,
      });
    } catch (err: unknown) {
      const message = friendlyError(
        err,
        "Erreur pendant le recalcul de projection.",
      );
      setError(
        `${message}${
          message.toLowerCase().includes("délai")
            ? " Le recalcul passe par une route serveur et une fonction SQL optimisée. Si ce message persiste, réduis temporairement l’horizon puis relance."
            : ""
        }`,
      );
    } finally {
      setRecalculating(false);
    }
  }

  async function saveStockSecurity() {
    const currentSelected = selected;
    if (!currentSelected) return;

    setSavingSecurity(true);
    setError(null);

    try {
      const response = await supabase.rpc(
        "upsert_stock_article_stock_securite_fast",
        {
          p_reference_article: currentSelected.reference_article,
          p_designation: currentSelected.designation,
          p_famille: currentSelected.famille,
          p_macro_famille: currentSelected.macro_famille,
          p_fournisseur_principal: currentSelected.fournisseur_principal,
          p_stock_securite: toNumber(stockSecurityInput),
        },
      );

      if (response.error) throw response.error;

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
      setError(
        friendlyError(
          err,
          "Erreur pendant l’enregistrement du stock de sécurité.",
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

    try {
      const calls = projection.map((row) => {
        const manualText = weeklyManualQty[row.periode_debut];
        return supabase.rpc("upsert_stock_prevision_override_v2", {
          p_reference_article: currentSelected.reference_article,
          p_depot: currentSelected.depot || "GLOBAL",
          p_periode_debut: row.periode_debut,
          p_coefficient_prevision:
            Math.max(
              0,
              toNumber(weeklyPct[row.periode_debut] ?? defaultProjectionPct),
            ) / 100,
          p_quantite_prevision_forcee:
            manualText === undefined || manualText === ""
              ? null
              : Math.max(0, toNumber(manualText)),
          p_commentaire:
            "Hypothèse modifiée depuis écran Stocks & disponibilités",
        });
      });

      const results = await Promise.all(calls);
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) throw firstError;

      await rebuildProjection(
        `Hypothèses semaine modifiées ${currentSelected.reference_article}`,
      );
    } catch (err: any) {
      setError(
        friendlyError(
          err,
          "Erreur pendant l’enregistrement des hypothèses hebdomadaires.",
        ),
      );
    } finally {
      setSavingWeekly(false);
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
                  onClick={() =>
                    rebuildProjection(
                      "Recalcul depuis écran Stocks & disponibilités",
                    )
                  }
                  disabled={recalculating}
                  className="col-span-2 mt-5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
                >
                  {recalculating
                    ? "Recalcul en cours…"
                    : "Recalculer projection"}
                </button>
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            aria-live="polite"
            className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="font-black">
                Connexion aux données momentanément indisponible
              </div>
              <div className="mt-1 break-words text-sm font-medium leading-5">
                {error}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                loadData({ keepSelected: true, keepProjectionSettings: true })
              }
              disabled={loading}
              className="shrink-0 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-black text-red-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Nouvelle tentative…" : "Réessayer"}
            </button>
          </div>
        ) : null}

        {loading ? (
          <EmptyState
            title="Chargement des projections…"
            message="Lecture des KPI et des alertes articles."
          />
        ) : !kpi?.run_id ? (
          <EmptyState
            title="Aucune projection disponible"
            message="Lance un calcul de projection depuis l’écran Import ou le bouton Recalculer projection."
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

                      <div className="mt-3 grid grid-cols-3 gap-2">
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
                      </div>
                    </div>

                    {detailWarning ? (
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
