"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { usePageFilterAccess } from "@/lib/pageAccessFilters";

export type DocType = "Devis" | "CDC" | "BL" | "Factures";
export type ViewMode = "montant_ht" | "nb_documents" | "quantite_pertinente";

export type DailyRow = {
  jour: string;
  type_document: DocType | string;
  agence: string | null;
  collaborateur: string | null;
  depot: string | null;
  depot_bucket: "FMS" | "AUTRES" | string | null;
  famille_macro: string | null;
  hors_statistique?: boolean | null;
  nb_documents: number;
  nb_lignes: number;
  montant_ht: number;
  quantite_brute: number;
  quantite_pertinente: number;
};

export type HighlightRow = {
  date_document: string;
  type_document: DocType | string;
  numero_document: string | null;
  numero_tiers: string | null;
  intitule_tiers: string | null;
  agence: string | null;
  collaborateur: string | null;
  depot: string | null;
  depot_bucket: string | null;
  famille_macro: string | null;
  montant_ht: number;
  quantite_brute: number;
  quantite_pertinente: number;
  nb_lignes: number;
  source_table: string | null;
  hors_statistique?: boolean | null;
};

export type DistinctDocRow = {
  jour: string;
  dimension_type: "TOTAL" | "AGENCE" | "FAMILLE_MACRO" | string;
  dimension: string | null;
  type_document: DocType | string;
  nb_documents: number;
};

type ComparisonProgress = {
  status: "idle" | "loading" | "ready" | "error";
  label: string;
  current: string | null;
  done: number;
  total: number;
};

type ComparisonBucketKey = "ytdN" | "ytdN1" | "rollingN" | "rollingN1";
type ComparisonBuckets = Record<ComparisonBucketKey, DailyRow[]>;

type PersistentFocusComparisonPayload = {
  version: 4;
  type: "focus_mensuel_persistent_comparison_cache";
  created_at: string;
  month: string;
  filters: {
    agence: string | null;
    familleMacro: string | null;
    collaborateur: string | null;
    includeHorsStats: boolean;
  };
  ytdRowsN: DailyRow[];
  ytdRowsN1: DailyRow[];
  rollingRowsN: DailyRow[];
  rollingRowsN1: DailyRow[];
  status: "partial" | "complete";
  completedRanges: string[];
  totalRanges: number;
  updated_at: string;
};

type FocusComparisonSnapshotPayload = {
  version: 1;
  type: "focus_mensuel_comparison_snapshot";
  created_at: string;
  filters: {
    month: string;
    focusDate: string;
    agence: string | null;
    familleMacro: string | null;
    collaborateur: string | null;
    includeHorsStats: boolean;
    viewMode: ViewMode;
    useProjectedCurrentMonthFactures: boolean;
  };
  ytdRowsN: DailyRow[];
  ytdRowsN1: DailyRow[];
  rollingRowsN: DailyRow[];
  rollingRowsN1: DailyRow[];
};

export type KpiCardData = {
  type: DocType;
  nb: number;
  amount: number;
  qtyPert: number;
  monthAmount: number;
  monthQtyPert: number;
  monthNb: number;
  monthAverageAmount: number;
  monthAmountN1: number;
  monthQtyPertN1: number;
  monthAmountEvolutionPct: number | null;
  monthQtyPertEvolutionPct: number | null;
  fmsPct?: number;
  fmsPctMonth?: number;
  topAgence: string;
  topFamille: string;
  evolutionVsMtdPct: number | null;
  evolutionVs7dPct: number | null;
};

export type MtdComparisonBasis = {
  currentMonth: string;
  previousMonth: string;
  currentBlDays: string[];
  previousBlDays: string[];
  currentDayCount: number;
  previousDayCountUsed: number;
  previousDayCountTotal: number;
  previousEndDate: string | null;
  monthClosed: boolean;
  usedFullPreviousMonth: boolean;
  usedWeekdayFallback: boolean;
  dayDifference: number;
  titleLabel: string;
  detailLabel: string;
};

type BusinessDayBasis = {
  count: number;
  blDaysCount: number;
  fallbackWeekdaysCount: number;
  calendarDaysCount: number;
  label: string;
};

type PdfJobStatus =
  "pending" | "running" | "done" | "error" | "cancelled" | string;

type PdfJobApiRow = {
  id: number;
  status: PdfJobStatus;
  step: string | null;
  bucket: string | null;
  path: string | null;
  filename?: string | null;
  bytes: number | null;
  error_message: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
};

type FocusActivityLineRaw = {
  type_document: string | null;
  date_piece: string | null;
  date_bc: string | null;
  date_pl: string | null;
  date_bl: string | null;
  date_livraison: string | null;
  numero_tiers_entete: string | null;
  reference_article: string | null;
  montant_ht: number | null;
  collaborateur: string | null;
};

type FocusInvoiceLineRaw = {
  numero_piece: string | null;
  date_facture: string | null;
  numero_tiers_entete: string | null;
  reference_article: string | null;
  montant_ht: number | null;
  collaborateur: string | null;
};

export type AgencyPortfolioRow = {
  label: string;
  cdc: number;
  cdcLivMx: number;
  pl: number;
  plLivMPlus: number;
  brMx: number;
  brM: number;
  blMx: number;
  blM: number;
  total: number;
};

export type AgencyProjectionRow = {
  label: string;
  blBrMx: number;
  blBrM: number;
  factures: number;
  projectionFluxBl: number;
  valeurBlNf3Pct: number;
  projectionCa: number;
  caN1: number;
  evolPct: number | null;
};

type EnrichedActivityLine = FocusActivityLineRaw & {
  montant_ht: number;
  effective_date: string | null;
  agence: string;
  famille_macro: string | null;
  hors_statistique: boolean;
  collaborateur: string;
};

type EnrichedInvoiceLine = FocusInvoiceLineRaw & {
  montant_ht: number;
  agence: string;
  famille_macro: string | null;
  hors_statistique: boolean;
  collaborateur: string;
};

type MatrixCell = { amount: number; nb: number; qtyPert: number };
export type MatrixRow = {
  label: string;
  byType: Record<DocType, MatrixCell>;
  total: number;
};

export type ComparisonCell = {
  amountN1: number;
  amountN: number;
  qtyPertN1: number;
  qtyPertN: number;
};

export type ComparisonRow = {
  label: string;
  byType: Record<DocType, ComparisonCell>;
  total: number;
};

export type AnnualCacheRpcRow = {
  table_key: "agency_ytd" | "family_ytd" | "rolling_12" | string;
  label: string | null;
  type_document: DocType | string;
  amount_n1: number | null;
  amount_n: number | null;
  qty_pert_n1: number | null;
  qty_pert_n: number | null;
  sort_order: number | null;
};

type SupabaseRpcResult<TData> = {
  data: TData | null;
  error: unknown | null;
};

type AgencyControlRpcRow = {
  label: string | null;
  cdc: number | null;
  cdc_liv_mx: number | null;
  pl: number | null;
  pl_liv_mplus: number | null;
  blbr_mx: number | null;
  blbr_m: number | null;
  total: number | null;
  factures: number | null;
  projection_flux_bl: number | null;
  valeur_bl_nf_4pct: number | null;
  projection_ca: number | null;
  ca_n1: number | null;
  evol_pct: number | null;
};

export const DOC_TYPES: DocType[] = ["Devis", "CDC", "BL", "Factures"];
export const DOC_COLORS: Record<DocType, string> = {
  Devis: "#d59b00",
  CDC: "#006d7f",
  BL: "#4c9dff",
  Factures: "#16a34a",
};

export function isDocType(value: any): value is DocType {
  return DOC_TYPES.includes(value as DocType);
}

function createEmptyDocRecord(): Record<DocType, number> {
  return { Devis: 0, CDC: 0, BL: 0, Factures: 0 };
}

export function dateOnly(value: any) {
  return String(value || "").slice(0, 10);
}

function sumDistinctDocs(
  rows: DistinctDocRow[],
  type: DocType,
  startDate: string,
  endDate: string,
  dimensionType = "TOTAL",
  dimension?: string | null,
) {
  return rows.reduce((acc, row) => {
    const day = dateOnly(row.jour);
    if (day < startDate || day > endDate) return acc;
    if (String(row.type_document) !== type) return acc;
    if (normalizeKey(row.dimension_type) !== normalizeKey(dimensionType))
      return acc;
    if (
      dimension !== undefined &&
      normalizeKey(row.dimension || "") !== normalizeKey(dimension || "")
    )
      return acc;
    return acc + Number(row.nb_documents || 0);
  }, 0);
}

function buildDistinctDocOverrideMap(
  rows: DistinctDocRow[],
  dimensionType: "AGENCE" | "FAMILLE_MACRO",
  startDate: string,
  endDate: string,
) {
  const map = new Map<string, Record<DocType, number>>();

  rows.forEach((row) => {
    const day = dateOnly(row.jour);
    if (day < startDate || day > endDate) return;
    if (normalizeKey(row.dimension_type) !== normalizeKey(dimensionType))
      return;
    if (!isDocType(row.type_document)) return;

    const label = String(
      row.dimension || (dimensionType === "AGENCE" ? "Sans agence" : "AUTRES"),
    );
    const key = normalizeKey(label);
    const current = map.get(key) || createEmptyDocRecord();
    current[row.type_document] += Number(row.nb_documents || 0);
    map.set(key, current);
  });

  return map;
}

const LOGO_CEGECLIM_URL =
  "https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0";

const REPORT_BUCKET = "commercial-imports";
const REPORT_PATH = "reports/focus-mensuel/Rapport_activite_quotidien.pdf";
const REPORT_FILENAME = "Rapport d'activité quotidien.pdf";
const REPORT_JOB_CREATE_ROUTE = "/api/reports/focus-mensuel-pdf";
const REPORT_JOB_PROCESS_ROUTE = "/api/reports/focus-mensuel-pdf/process";
const REPORT_PDF_CACHE_ROUTE = "/api/reports/focus-mensuel-pdf/cache";
const FOCUS_COMPARISON_CACHE_TABLE = "focus_mensuel_comparison_cache";
const FOCUS_COMPARISON_CACHE_VERSION = 4;
const FOCUS_COMPARISON_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Sécurité PDF : les tableaux comparatifs ne doivent jamais empêcher la capture Puppeteer.
// Si une période reste bloquée, on garde les données déjà chargées et on laisse le PDF partir.
const PDF_COMPARISON_HARD_STOP_MS = 90000;

function isViewMode(value: string | null | undefined): value is ViewMode {
  return (
    value === "montant_ht" ||
    value === "nb_documents" ||
    value === "quantite_pertinente"
  );
}

export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysYmd(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addMonthsYmd(ymd: string, months: number) {
  const d = new Date(`${ymd}T12:00:00`);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addYearsYmd(ymd: string, years: number) {
  return addMonthsYmd(ymd, years * 12);
}

export function monthKey(ymd: string | null | undefined) {
  return String(ymd || "").slice(0, 7);
}

export function addMonthsToMonth(month: string, months: number) {
  return addMonthsYmd(`${month}-01`, months).slice(0, 7);
}

export function monthStart(month: string) {
  return `${month}-01`;
}

export function nextMonthStart(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from(
    { length: last },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

function isWeekendYmd(ymd: string) {
  const day = new Date(`${ymd}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

function countWeekdays(days: string[]) {
  return days.filter((day) => !isWeekendYmd(day)).length;
}

export function formatDateFr(ymd: string | null | undefined) {
  if (!ymd) return "—";
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(ymd);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatMonthFr(month: string | null | undefined) {
  if (!month) return "—";
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(month);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const label = date.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatShortDate(ymd: string) {
  const m = ymd.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : ymd;
}

export function formatShortMonthFr(month: string | null | undefined) {
  if (!month) return "—";
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(month);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return date
    .toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })
    .replace(".", "");
}

export function formatMoney(value: number | null | undefined) {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 1000000)
    return `${(n / 1000000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  if (abs >= 1000)
    return `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} K€`;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

export function formatNumber(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
  });
}

export function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((acc, row) => acc + Number(selector(row) || 0), 0);
}

export function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = keyFn(row) || "—";
    const current = map.get(key) || [];
    current.push(row);
    map.set(key, current);
  });
  return map;
}

export function valueOf(row: DailyRow, mode: ViewMode) {
  if (mode === "nb_documents") return Number(row.nb_documents || 0);
  if (mode === "quantite_pertinente")
    return Number(row.quantite_pertinente || 0);
  return Number(row.montant_ht || 0);
}

function labelForMode(mode: ViewMode) {
  if (mode === "nb_documents") return "Nombre documents";
  if (mode === "quantite_pertinente") return "Quantité pertinente";
  return "Montant HT";
}

export function shortDocLabel(type: DocType | string) {
  return String(type) === "Factures" ? "Fac" : String(type);
}

function displayValue(value: number, mode: ViewMode) {
  if (mode === "montant_ht") return formatMoney(value);
  return formatNumber(value);
}

export function kpiValue(card: KpiCardData, mode: ViewMode) {
  if (mode === "nb_documents") return card.nb;
  if (mode === "quantite_pertinente") return card.qtyPert;
  return card.amount;
}

export function kpiMonthValue(card: KpiCardData, mode: ViewMode) {
  if (mode === "nb_documents") return card.monthNb;
  if (mode === "quantite_pertinente") return card.monthQtyPert;
  return card.monthAmount;
}

function getTopLabel(rows: DailyRow[], dimension: "agence" | "famille_macro") {
  const grouped = groupBy(rows, (r) => String((r as any)[dimension] || "—"));
  const ranked = Array.from(grouped.entries())
    .map(([label, items]) => ({
      label,
      amount: Math.abs(sum(items, (r) => r.montant_ht)),
    }))
    .sort((a, b) => b.amount - a.amount);
  return ranked[0]?.label || "—";
}

export function buildEvolution(dayValue: number, baseValue: number) {
  if (!baseValue) return null;
  return ((dayValue - baseValue) / Math.abs(baseValue)) * 100;
}

function getBusinessDayBasis(
  rows: DailyRow[],
  periodDays: string[],
): BusinessDayBasis {
  const blActiveDays = new Set(
    rows
      .filter(
        (row) =>
          row.type_document === "BL" &&
          periodDays.includes(row.jour) &&
          Number(row.nb_documents || 0) > 0,
      )
      .map((row) => row.jour),
  );

  const fallbackWeekdaysCount = countWeekdays(periodDays);
  const count = Math.max(
    1,
    blActiveDays.size || fallbackWeekdaysCount || periodDays.length,
  );

  return {
    count,
    blDaysCount: blActiveDays.size,
    fallbackWeekdaysCount,
    calendarDaysCount: periodDays.length,
    label: blActiveDays.size
      ? `${blActiveDays.size} jour(s) avec BL créé(s)`
      : `${fallbackWeekdaysCount || periodDays.length} jour(s) ouvré(s) estimé(s)`,
  };
}


function getBlShippingDays(
  rows: DailyRow[],
  startDate: string,
  endDateInclusive: string,
) {
  return Array.from(
    new Set(
      rows
        .filter((row) => {
          const day = dateOnly(row.jour);
          if (day < startDate || day > endDateInclusive) return false;
          if (String(row.type_document) !== "BL") return false;

          return (
            Number(row.nb_documents || 0) > 0 ||
            Number(row.nb_lignes || 0) > 0 ||
            Math.abs(Number(row.montant_ht || 0)) > 0 ||
            Math.abs(Number(row.quantite_pertinente || 0)) > 0
          );
        })
        .map((row) => dateOnly(row.jour))
        .filter(Boolean),
    ),
  ).sort();
}

function hasRemainingWeekdayInMonth(month: string, focusDate: string) {
  return daysInMonth(month).some(
    (day) => day > focusDate && !isWeekendYmd(day),
  );
}

function ordinalDayLabel(value: number) {
  if (!value) return "aucun jour";
  return value === 1 ? "1er jour" : `${value}e jour`;
}

export function buildMtdComparisonBasis(
  currentRows: DailyRow[],
  previousRows: DailyRow[],
  month: string,
  focusDate: string,
): MtdComparisonBasis {
  const currentMonthBegin = monthStart(month);
  const previousMonth = previousYearMonth(month);
  const previousMonthBegin = monthStart(previousMonth);
  const previousMonthLastDay = lastDayOfMonth(previousMonth);

  const currentBlDays = getBlShippingDays(
    currentRows,
    currentMonthBegin,
    focusDate,
  );
  const previousBlDays = getBlShippingDays(
    previousRows,
    previousMonthBegin,
    previousMonthLastDay,
  );

  const elapsedDays = daysInMonth(month).filter((day) => day <= focusDate);
  const fallbackDayCount = Math.max(1, countWeekdays(elapsedDays));
  const usedWeekdayFallback = currentBlDays.length === 0;
  const currentDayCount = usedWeekdayFallback
    ? fallbackDayCount
    : currentBlDays.length;

  const monthClosed = !hasRemainingWeekdayInMonth(month, focusDate);

  let previousEndDate: string | null = null;
  let previousDayCountUsed = 0;
  let usedFullPreviousMonth = false;

  if (monthClosed) {
    previousEndDate = previousMonthLastDay;
    previousDayCountUsed = previousBlDays.length;
    usedFullPreviousMonth = true;
  } else if (previousBlDays.length >= currentDayCount) {
    previousDayCountUsed = currentDayCount;
    previousEndDate = previousBlDays[currentDayCount - 1] || null;
  } else {
    // N-1 ne dispose pas d'assez de journées BL pour atteindre le rang de N :
    // on conserve alors tout le mois N-1 et on l'indique explicitement.
    previousDayCountUsed = previousBlDays.length;
    previousEndDate = previousMonthLastDay;
    usedFullPreviousMonth = true;
  }

  const dayDifference = previousBlDays.length - currentDayCount;

  let titleLabel = `${currentDayCount} j BL N vs ${previousDayCountUsed} j BL N-1`;
  let detailLabel = "";

  if (monthClosed) {
    const differenceLabel =
      dayDifference > 0
        ? `${dayDifference} jour(s) d'expédition BL en plus en N-1`
        : dayDifference < 0
          ? `${Math.abs(dayDifference)} jour(s) d'expédition BL en moins en N-1`
          : "même nombre de jours d'expédition BL";

    detailLabel =
      `Mois clôturé : comparaison avec ${formatMonthFr(previousMonth).toLowerCase()} complet ` +
      `(${previousBlDays.length} jour(s) BL ; ${differenceLabel}).`;
  } else if (previousBlDays.length >= currentDayCount && previousEndDate) {
    detailLabel =
      `N-1 arrêté au ${ordinalDayLabel(currentDayCount)} d'expédition BL ` +
      `(${formatDateFr(previousEndDate)}), et non à la même date calendaire.`;
  } else {
    detailLabel =
      `N-1 ne comptait que ${previousBlDays.length} jour(s) d'expédition BL sur le mois complet ; ` +
      `${ordinalDayLabel(currentDayCount)} impossible à atteindre.`;
  }

  if (usedWeekdayFallback) {
    titleLabel += " · base ouvrée estimée";
    detailLabel +=
      " Aucun jour BL n'étant disponible dans le périmètre courant, la base N est estimée sur les jours ouvrés.";
  }

  return {
    currentMonth: month,
    previousMonth,
    currentBlDays,
    previousBlDays,
    currentDayCount,
    previousDayCountUsed,
    previousDayCountTotal: previousBlDays.length,
    previousEndDate,
    monthClosed,
    usedFullPreviousMonth,
    usedWeekdayFallback,
    dayDifference,
    titleLabel,
    detailLabel,
  };
}

function pickDefaultFocusDate() {
  return todayYmd();
}

export function normalizeKey(value: any) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeComparisonBucketKey(
  value: string | null | undefined,
): ComparisonBucketKey | null {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (["ytdn", "ytdcurrent", "currentytd", "ytd0"].includes(compact))
    return "ytdN";
  if (
    [
      "ytdn1",
      "ytdprevious",
      "ytdpreviousyear",
      "previousytd",
      "ytdprev",
    ].includes(compact)
  )
    return "ytdN1";
  if (
    ["rollingn", "rolling12n", "rollingcurrent", "currentrolling"].includes(
      compact,
    )
  )
    return "rollingN";
  if (
    [
      "rollingn1",
      "rolling12n1",
      "rollingprevious",
      "rollingpreviousyear",
      "previousrolling",
    ].includes(compact)
  )
    return "rollingN1";

  return null;
}

function formatMoneyPlain(
  value: number | null | undefined,
  maximumFractionDigits = 1,
) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

export function formatMoneyCompact(value: number | null | undefined) {
  const n = Number(value || 0);
  const abs = Math.abs(n);

  if (abs >= 1000000) {
    return `${(n / 1000000).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} M€`;
  }

  return `${(n / 1000).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} K€`;
}

function chunkArray<T>(values: T[], size = 500) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function previousYearMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year - 1}-${String(monthNumber).padStart(2, "0")}`;
}

function lastDayOfMonth(month: string) {
  const monthDays = daysInMonth(month);
  return monthDays[monthDays.length - 1];
}

function maxYmd(values: Array<string | null | undefined>) {
  const filtered = values
    .map((value) => String(value || ""))
    .filter(Boolean)
    .sort();
  return filtered[filtered.length - 1] || null;
}

function activityEffectiveDate(row: FocusActivityLineRaw) {
  const type = String(row.type_document || "");
  if (type === "Bon de commande") return row.date_bc || row.date_piece || null;
  if (type === "Préparation de livraison")
    return row.date_pl || row.date_piece || null;
  if (type === "Bon de livraison" || type === "Bon de retour")
    return row.date_bl || row.date_piece || null;
  return row.date_piece || row.date_bc || row.date_pl || row.date_bl || null;
}

function activityDeliveryDate(
  row: Pick<FocusActivityLineRaw, "date_livraison">,
) {
  const deliveryDate = dateOnly(row.date_livraison);
  return deliveryDate || null;
}

function signedInvoiceAmount(row: FocusInvoiceLineRaw) {
  const numeroPiece = String(row.numero_piece || "")
    .trim()
    .toUpperCase();
  const amount = Number(row.montant_ht || 0);

  // Règle commune factures :
  // FA0 = montant tel quel
  // tout le reste = -montant
  // Important : pas de Math.abs(), car certaines lignes FA0 peuvent déjà être négatives.
  if (numeroPiece.startsWith("FA0")) return amount;
  return -amount;
}

function signedActivityAmount(
  typeDocument: string | null | undefined,
  amount: number | null | undefined,
) {
  const numericAmount = Number(amount || 0);

  // Règle commune activité :
  // BL = montant source tel quel
  // BR = -montant source
  // Important : pas de Math.abs(), car certaines lignes BL/BR peuvent déjà être négatives.
  if (String(typeDocument || "") === "Bon de retour") return -numericAmount;
  return numericAmount;
}

export function agencySort(a: string, b: string) {
  const aIsSans = normalizeKey(a) === "SANS AGENCE";
  const bIsSans = normalizeKey(b) === "SANS AGENCE";
  if (aIsSans && !bIsSans) return 1;
  if (!aIsSans && bIsSans) return -1;
  return a.localeCompare(b, "fr-FR");
}

async function fetchAllFromSupabase(
  table: string,
  select: string,
  transform?: (query: any) => any,
) {
  const pageSize = 2000;
  const rows: any[] = [];
  let from = 0;

  while (true) {
    let query: any = (supabase as any).from(table).select(select);
    if (transform) query = transform(query);
    query = query.range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw error;

    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchRowsByIn(
  table: string,
  select: string,
  column: string,
  values: string[],
) {
  const normalizedValues = uniqueStrings(values);
  if (!normalizedValues.length) return [];

  const rows: any[] = [];
  for (const chunk of chunkArray(normalizedValues, 500)) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(select)
      .in(column, chunk);

    if (error) throw error;
    rows.push(...(Array.isArray(data) ? data : []));
  }

  return rows;
}

const PDF_PRINT_STYLES = String.raw`
@page { size: A4 landscape; margin: 3mm 3mm 3mm 3mm; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #eef5fb !important;
  background-color: #eef5fb !important;
  background-image: none !important;
}
body, * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body::before, body::after, main::before, main::after, section::before, section::after {
  content: none !important;
  display: none !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
[data-focus-report-ready] {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  padding: 0 !important;
  background: #eef5fb !important;
  background-color: #eef5fb !important;
  background-image: none !important;
  isolation: isolate !important;
}
[data-focus-report-ready] *,
[data-focus-report-ready] *::before,
[data-focus-report-ready] *::after {
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
[data-no-print="true"], .focus-pdf-header-actions { display: none !important; }
.focus-pdf-brand-header,
.focus-pdf-filters,
.focus-pdf-kpi-card,
.focus-pdf-chart-box,
.focus-pdf-section-card {
  background: #ffffff !important;
  background-color: #ffffff !important;
  background-image: none !important;
  box-shadow: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.focus-pdf-brand-header,
.focus-pdf-filters,
.focus-pdf-kpi-card,
.focus-pdf-chart-box,
.focus-pdf-section-card,
.focus-pdf-table-wrap,
table, thead, tbody, tr, th, td {
  position: relative !important;
  z-index: 1 !important;
}
.focus-pdf-brand-header {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  min-height: 48px !important;
  padding: 4px 8px 7px !important;
  margin-bottom: 5px !important;
  border-bottom: 1px solid #e5e7eb !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.focus-pdf-header-card {
  padding: 0 !important;
  margin: 0 0 5px !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.focus-pdf-title { display: none !important; }
.focus-pdf-subtitle { font-size: 9.5px !important; line-height: 1.25 !important; font-weight: 800 !important; padding: 0 8px !important; }
.focus-pdf-filters {
  grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
  gap: 6px !important;
  padding: 7px !important;
  margin-bottom: 8px !important;
  border-radius: 8px !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.focus-pdf-filter-value {
  min-height: 27px !important;
  display: flex !important;
  align-items: center !important;
  border: 1px solid #cbd5e1 !important;
  border-radius: 6px !important;
  padding: 5px 8px !important;
  background: #ffffff !important;
  background-color: #ffffff !important;
  background-image: none !important;
  font-size: 10px !important;
  font-weight: 900 !important;
  color: #0f172a !important;
}
.focus-pdf-kpi-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  gap: 8px !important;
  margin-bottom: 8px !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.focus-pdf-kpi-card { padding: 6px !important; min-height: 92px !important; border-radius: 10px !important; }
.focus-pdf-kpi-card [style*="font-size: 26"] { font-size: 18px !important; }
.focus-pdf-chart-grid,
.focus-pdf-section-grid {
  grid-template-columns: 1fr 1fr !important;
  gap: 8px !important;
  margin-bottom: 8px !important;
}
.focus-pdf-chart-box,
.focus-pdf-section-card {
  padding: 8px !important;
  border-radius: 10px !important;
  background: #ffffff !important;
  background-color: #ffffff !important;
  background-image: none !important;
  box-shadow: none !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.focus-pdf-chart-box svg { height: 158px !important; }
.focus-pdf-table-wrap { max-height: none !important; overflow: visible !important; background: #ffffff !important; }
.focus-pdf-section-card table { min-width: 0 !important; font-size: 6.6px !important; }
.focus-pdf-section-card th, .focus-pdf-section-card td { padding: 2.5px 3.5px !important; line-height: 1.08 !important; }
.focus-pdf-mtd-comparison-table {
  min-width: 0 !important;
  table-layout: fixed !important;
  font-size: 5.9px !important;
}
.focus-pdf-mtd-comparison-table th,
.focus-pdf-mtd-comparison-table td {
  padding: 2px 2.5px !important;
  line-height: 1.04 !important;
  white-space: normal !important;
}
.focus-pdf-dense-matrix-table {
  min-width: 0 !important;
  table-layout: fixed !important;
  font-size: 5.9px !important;
}
.focus-pdf-dense-matrix-table th,
.focus-pdf-dense-matrix-table td {
  padding: 2px 2.5px !important;
  line-height: 1.04 !important;
  white-space: normal !important;
}
.focus-pdf-highlights-grid {
  grid-template-columns: 1fr 1fr !important;
  gap: 5px !important;
  align-items: start !important;
  margin-top: 4px !important;
}
.focus-pdf-highlights-grid > .focus-pdf-section-card:first-child { grid-column: span 2 !important; }
.focus-pdf-highlights-grid table { min-width: 0 !important; font-size: 6.4px !important; }
.focus-pdf-highlights-grid th, .focus-pdf-highlights-grid td { padding: 2px 3px !important; line-height: 1.05 !important; }
.focus-pdf-comparison-grid {
  grid-template-columns: 1fr !important;
  gap: 8px !important;
  margin-bottom: 8px !important;
}
.focus-pdf-comparison-grid table { min-width: 0 !important; font-size: 5.8px !important; }
.focus-pdf-comparison-grid th, .focus-pdf-comparison-grid td { padding: 2px 3px !important; line-height: 1.04 !important; }
.focus-pdf-agency-section-grid {
  break-before: auto !important;
  page-break-before: auto !important;
  break-inside: auto !important;
  page-break-inside: auto !important;
  margin-top: 6px !important;
}
.focus-pdf-agency-section-grid > .focus-pdf-section-card {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
html, body, main, section,
[data-focus-report-ready], [data-report-ready] {
  min-height: 0 !important;
  height: auto !important;
  overflow: visible !important;
}
`;

export function SparkLine({ values, color }: { values: number[]; color: string }) {
  const width = 190;
  const height = 34;
  const absMax = Math.max(1, ...values.map((v) => Math.abs(v)));
  const points = values.map((v, i) => {
    const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * width;
    const y = height - ((v / absMax) * (height - 6) + 3);
    return `${x},${y}`;
  });

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        points={points.join(" ")}
      />
    </svg>
  );
}

export function MultiLineChart({
  days,
  rows,
  mode,
  title,
}: {
  days: string[];
  rows: DailyRow[];
  mode: ViewMode;
  title?: string;
}) {
  const width = 920;
  const height = 260;
  const padLeft = 52;
  const padRight = 12;
  const padTop = 18;
  const padBottom = 34;
  const [hoverPoint, setHoverPoint] = useState<{
    xPct: number;
    yPct: number;
    type: DocType;
    day: string;
    value: number;
  } | null>(null);

  const byTypeDay = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${row.type_document}__${row.jour}`;
    byTypeDay.set(key, (byTypeDay.get(key) || 0) + valueOf(row, mode));
  });

  const values = DOC_TYPES.flatMap((type) =>
    days.map((day) => byTypeDay.get(`${type}__${day}`) || 0),
  );
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xFor = (index: number) =>
    padLeft + (days.length <= 1 ? 0 : (index / (days.length - 1)) * plotW);
  const yFor = (value: number) =>
    padTop + plotH - (Math.max(0, value) / max) * plotH;

  return (
    <div
      style={styles.chartBox}
      className="focus-pdf-chart-box"
      onMouseLeave={() => setHoverPoint(null)}
    >
      <div style={styles.chartTitle}>
        {title || `Flux journalier — ${labelForMode(mode)}`}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={styles.chartSvg}
        preserveAspectRatio="none"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + plotH * t;
          return (
            <line
              key={t}
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
          );
        })}
        {DOC_TYPES.map((type) => {
          const points = days.map((day, index) => {
            const v = byTypeDay.get(`${type}__${day}`) || 0;
            return `${xFor(index)},${yFor(v)}`;
          });
          return (
            <polyline
              key={type}
              fill="none"
              stroke={DOC_COLORS[type]}
              strokeWidth="3"
              points={points.join(" ")}
            />
          );
        })}
        {DOC_TYPES.flatMap((type) =>
          days.map((day, index) => {
            const value = byTypeDay.get(`${type}__${day}`) || 0;
            const x = xFor(index);
            const y = yFor(value);
            return (
              <circle
                key={`${type}-${day}`}
                cx={x}
                cy={y}
                r="7"
                fill={DOC_COLORS[type]}
                opacity={
                  hoverPoint?.type === type && hoverPoint?.day === day
                    ? 0.9
                    : 0.04
                }
                stroke={DOC_COLORS[type]}
                strokeWidth="1"
                style={{ cursor: "crosshair" }}
                onMouseEnter={() =>
                  setHoverPoint({
                    xPct: (x / width) * 100,
                    yPct: (y / height) * 100,
                    type,
                    day,
                    value,
                  })
                }
                onMouseMove={() =>
                  setHoverPoint({
                    xPct: (x / width) * 100,
                    yPct: (y / height) * 100,
                    type,
                    day,
                    value,
                  })
                }
              />
            );
          }),
        )}
        {days.map((day, index) => {
          if (
            index % Math.ceil(days.length / 8) !== 0 &&
            index !== days.length - 1
          )
            return null;
          return (
            <text
              key={day}
              x={xFor(index)}
              y={height - 10}
              textAnchor="middle"
              fontSize="11"
              fill="#475569"
            >
              {day.slice(-2)}
            </text>
          );
        })}
        <text x="8" y="22" fontSize="11" fill="#475569">
          {displayValue(max, mode)}
        </text>
      </svg>
      {hoverPoint && (
        <div
          style={{
            ...styles.chartTooltip,
            left: `min(calc(${hoverPoint.xPct}% + 10px), calc(100% - 230px))`,
            top: `max(calc(${hoverPoint.yPct}% - 24px), 44px)`,
            borderColor: DOC_COLORS[hoverPoint.type],
          }}
        >
          <div
            style={{ ...styles.tooltipDoc, color: DOC_COLORS[hoverPoint.type] }}
          >
            {hoverPoint.type}
          </div>
          <div>{formatDateFr(hoverPoint.day)}</div>
          <div style={styles.tooltipValue}>
            {displayValue(hoverPoint.value, mode)}
          </div>
        </div>
      )}
      <div style={styles.legendRow}>
        {DOC_TYPES.map((type) => (
          <span key={type} style={styles.legendItem}>
            <span
              style={{ ...styles.legendDot, background: DOC_COLORS[type] }}
            />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CumulativeChart({
  days,
  rows,
  mode,
}: {
  days: string[];
  rows: DailyRow[];
  mode: ViewMode;
}) {
  const cumulativeRows: DailyRow[] = [];
  DOC_TYPES.forEach((type) => {
    let running = 0;
    days.forEach((day) => {
      running += sum(
        rows.filter((r) => r.type_document === type && r.jour === day),
        (r) => valueOf(r, mode),
      );
      cumulativeRows.push({
        jour: day,
        type_document: type,
        agence: "Cumul",
        collaborateur: "",
        depot: "",
        depot_bucket: "",
        famille_macro: "Cumul",
        nb_documents: mode === "nb_documents" ? running : 0,
        nb_lignes: 0,
        montant_ht: mode === "montant_ht" ? running : 0,
        quantite_brute: 0,
        quantite_pertinente: mode === "quantite_pertinente" ? running : 0,
      });
    });
  });

  return (
    <MultiLineChart
      days={days}
      rows={cumulativeRows}
      mode={mode}
      title={`Cumul mensuel — ${labelForMode(mode)}`}
    />
  );
}

export function ComparisonEvolutionBadge({
  value,
}: {
  value: number | null | undefined;
}) {
  const isValid =
    value !== null && value !== undefined && Number.isFinite(value);
  const isPositive = isValid && Number(value) > 0;
  const isNegative = isValid && Number(value) < 0;

  return (
    <span
      style={{
        ...styles.mtdEvolutionBadge,
        background: isPositive
          ? "#dcfce7"
          : isNegative
            ? "#fee2e2"
            : "#e2e8f0",
        color: isPositive
          ? "#047857"
          : isNegative
            ? "#b91c1c"
            : "#64748b",
      }}
    >
      {isValid ? formatPct(value) : "—"}
    </span>
  );
}

export function KpiMtdMetric({
  current,
  previous,
  evolution,
  color,
  comparisonReady,
}: {
  current: number;
  previous: number;
  evolution: number | null;
  color: string;
  comparisonReady: boolean;
}) {
  return (
    <div style={styles.kpiMtdMetric}>
      <div style={styles.kpiMtdMetricLabel}>Month to date</div>
      <div style={{ ...styles.kpiMtdMetricCurrent, color }}>
        {formatMoney(current)}
      </div>
      <div style={styles.kpiMtdMetricBottom}>
        <span style={styles.kpiMtdMetricPrevious}>
          vs n-1 :    {comparisonReady ? formatMoney(previous) : "…"}
        </span>
        </div>
        <div>
        <ComparisonEvolutionBadge
          value={comparisonReady ? evolution : null}
        />
      </div>
    </div>
  );
}

export function KpiCard({
  card,
  mode,
  comparisonBasis,
  comparisonReady,
}: {
  card: KpiCardData;
  mode: ViewMode;
  comparisonBasis: MtdComparisonBasis;
  comparisonReady: boolean;
}) {
  const color = DOC_COLORS[card.type];
  const dayValue = displayValue(kpiValue(card, mode), mode);

  return (
    <div style={styles.kpiCard} className="focus-pdf-kpi-card">
      <div style={styles.kpiHeader}>
        <span style={{ ...styles.docPill, background: `${color}22`, color }}>
          {card.type}
        </span>
        <span
          style={styles.mtdBasisPill}
          title={
            comparisonReady
              ? comparisonBasis.detailLabel
              : "Préparation de la comparaison N-1"
          }
        >
          {comparisonReady
            ? comparisonBasis.titleLabel
            : "N-1 en préparation…"}
        </span>
      </div>

      <div style={styles.kpiValuesGridMtd}>
        <div style={styles.kpiValueBlockLeft}>
          <div style={styles.kpiValueLabel}>Jour</div>
          <div style={styles.kpiMain}>{dayValue}</div>
          <div style={styles.kpiValueSub}>
            {formatNumber(card.nb)} document(s)
          </div>
        </div>

        <div style={styles.kpiMtdBlock}>
          <KpiMtdMetric
            current={card.monthAmount}
            previous={card.monthAmountN1}
            evolution={card.monthAmountEvolutionPct}
            color={color}
            comparisonReady={comparisonReady}
          />
        </div>
      </div>

      {card.type === "BL" && (
        <div style={styles.kpiSub}>
          Part dépôt FMS :{" "}
          <b>
            jour{" "}
            {card.fmsPct === undefined
              ? "—"
              : `${card.fmsPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
          </b>{" "}
          ·{" "}
          <b>
            mois{" "}
            {card.fmsPctMonth === undefined
              ? "—"
              : `${card.fmsPctMonth.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
          </b>
        </div>
      )}
    </div>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div style={styles.tableWrap} className="focus-pdf-table-wrap">
      <table style={styles.table}>{children}</table>
    </div>
  );
}

function ReportBrandHeader({ focusDate }: { focusDate: string }) {
  return (
    <div style={styles.reportBrandHeader} className="focus-pdf-brand-header">
      <div style={styles.reportBrandLeft}>
        <img
          src={LOGO_CEGECLIM_URL}
          alt="CEGECLIM Energies"
          style={styles.reportLogo}
        />
        <div style={styles.reportBrandTextBlock}>
          <div style={styles.reportBrandSubtitle}>
            Concessionnaire agréé de Bosch Home Comfort Group
          </div>
          <div style={styles.reportBrandTitle}>
            Hitachi Cooling &amp; Heating
          </div>
        </div>
      </div>
      <div style={styles.reportMainTitle}>
        ACTIVITE CEGECLIM DU{" "}
        <span style={styles.reportMainTitleDate}>
          {formatDateFr(focusDate)}
        </span>
      </div>
      <div style={styles.reportBrandRightSpacer} />
    </div>
  );
}

function FilterDisplay({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <div style={styles.filterDisplayValue} className="focus-pdf-filter-value">
        {value}
      </div>
    </div>
  );
}

export function HighlightTable({
  title,
  rows,
}: {
  title: string;
  rows: HighlightRow[];
}) {
  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>N° doc</th>
            <th style={styles.th}>Client</th>
            <th style={styles.th}>Agence</th>
            <th style={styles.th}>Famille</th>
            <th style={styles.thRight}>Montant HT</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} style={styles.emptyCell}>
                Aucun document sur la période.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr
                key={`${title}-${row.type_document}-${row.numero_document}-${idx}`}
              >
                <td style={styles.td}>{formatDateFr(row.date_document)}</td>
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.smallDocPill,
                      color:
                        DOC_COLORS[row.type_document as DocType] || "#0f172a",
                    }}
                  >
                    {row.type_document}
                  </span>
                </td>
                <td style={styles.tdStrong}>{row.numero_document || "—"}</td>
                <td style={styles.td}>
                  {row.intitule_tiers || row.numero_tiers || "—"}
                </td>
                <td style={styles.td}>{row.agence || "—"}</td>
                <td style={styles.td}>{row.famille_macro || "—"}</td>
                <td style={styles.tdRight}>{formatMoney(row.montant_ht)}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

function FocusMensuelPageContent() {
  const searchParams = useSearchParams();
  const access = usePageFilterAccess();
  const isPdfMode =
    searchParams?.get("pdf") === "1" || searchParams?.get("print") === "1";
  const requestedMonth = searchParams?.get("month");
  const requestedFocusDate =
    searchParams?.get("focusDate") || searchParams?.get("focus_date");
  const requestedHorsStats =
    searchParams?.get("horsStatistiques") ||
    searchParams?.get("hors_statistiques");
  const requestedView = searchParams?.get("view");
  const requestedAgence = searchParams?.get("agence") || "";
  const requestedFamilleMacro =
    searchParams?.get("familleMacro") ||
    searchParams?.get("famille_macro") ||
    "";
  const requestedCollaborateur = searchParams?.get("collaborateur") || "";
  const requestedCaProjeteFactures =
    searchParams?.get("caProjeteFactures") ||
    searchParams?.get("ca_projete_factures") ||
    "";
  const requestedPdfCacheId =
    searchParams?.get("pdf_cache_id") ||
    searchParams?.get("cache_id") ||
    searchParams?.get("comparison_cache_id") ||
    "";
  const requestedRenderSecret = searchParams?.get("render_secret") || "";

  // Par défaut, Focus Mensuel doit s'ouvrir sur le jour J.
  // Les paramètres d'URL restent prioritaires uniquement lorsqu'ils sont explicitement présents.
  const today = todayYmd();
  const actualCurrentMonth = today.slice(0, 7);
  const requestedMonthIsValid = /^\d{4}-\d{2}$/.test(
    String(requestedMonth || ""),
  );
  const requestedFocusDateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(
    String(requestedFocusDate || ""),
  );
  const defaultFocusDate = pickDefaultFocusDate();
  const initialFocusDate = requestedFocusDateIsValid
    ? String(requestedFocusDate)
    : defaultFocusDate;
  const initialMonth = requestedMonthIsValid
    ? String(requestedMonth)
    : monthKey(initialFocusDate) || actualCurrentMonth;
  const initialFocusDateForMonth = initialFocusDate.startsWith(initialMonth)
    ? initialFocusDate
    : initialMonth === actualCurrentMonth
      ? defaultFocusDate
      : `${initialMonth}-01`;

  const [month, setMonth] = useState(initialMonth);
  const [focusDate, setFocusDate] = useState(initialFocusDateForMonth);
  const [viewMode, setViewMode] = useState<ViewMode>(
    isViewMode(requestedView) ? requestedView : "montant_ht",
  );
  const [agence, setAgence] = useState(requestedAgence);
  const [familleMacro, setFamilleMacro] = useState(requestedFamilleMacro);
  const [collaborateur, setCollaborateur] = useState(requestedCollaborateur);
  const [includeHorsStats, setIncludeHorsStats] = useState(() => {
    const horsStatsParam = String(requestedHorsStats || "").toLowerCase();
    if (["masquer", "hide", "false", "0"].includes(horsStatsParam))
      return false;
    if (["afficher", "show", "true", "1"].includes(horsStatsParam)) return true;
    return true;
  });
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [dailyReady, setDailyReady] = useState(false);
  const [distinctDocRows, setDistinctDocRows] = useState<DistinctDocRow[]>([]);
  const [distinctDocsLoading, setDistinctDocsLoading] = useState(false);
  const [distinctDocsReady, setDistinctDocsReady] = useState(false);
  const [distinctDocsProgress, setDistinctDocsProgress] =
    useState<ComparisonProgress>({
      status: "idle",
      label: "",
      current: null,
      done: 0,
      total: 0,
    });
  const [ytdRowsN, setYtdRowsN] = useState<DailyRow[]>([]);
  const [ytdRowsN1, setYtdRowsN1] = useState<DailyRow[]>([]);
  const [rollingRowsN, setRollingRowsN] = useState<DailyRow[]>([]);
  const [rollingRowsN1, setRollingRowsN1] = useState<DailyRow[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonReady, setComparisonReady] = useState(false);
  const [comparisonProgress, setComparisonProgress] =
    useState<ComparisonProgress>({
      status: "idle",
      label: "",
      current: null,
      done: 0,
      total: 0,
    });
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // Comparaison Month to date N / N-1 : chargement direct du même mois
  // de l'année précédente au niveau journalier, indépendamment du cache annuel.
  const [mtdPreviousRows, setMtdPreviousRows] = useState<DailyRow[]>([]);
  const [mtdComparisonLoading, setMtdComparisonLoading] = useState(false);
  const [mtdComparisonReady, setMtdComparisonReady] = useState(false);
  const [mtdComparisonError, setMtdComparisonError] = useState<string | null>(
    null,
  );

  const [cachedAgencyYtdRows, setCachedAgencyYtdRows] = useState<
    ComparisonRow[] | null
  >(null);
  const [cachedFamilyYtdRows, setCachedFamilyYtdRows] = useState<
    ComparisonRow[] | null
  >(null);
  const [cachedRolling12Rows, setCachedRolling12Rows] = useState<
    ComparisonRow[] | null
  >(null);
  const [globalAgencyYtdRows, setGlobalAgencyYtdRows] = useState<ComparisonRow[]>([]);
  const [globalFamilyYtdRows, setGlobalFamilyYtdRows] = useState<ComparisonRow[]>([]);
  const [globalRolling12Rows, setGlobalRolling12Rows] = useState<ComparisonRow[]>([]);
  const comparisonLoadIdRef = useRef(0);
  const mtdComparisonLoadIdRef = useRef(0);
  const [highlightRows, setHighlightRows] = useState<HighlightRow[]>([]);
  const [agencyPortfolioRows, setAgencyPortfolioRows] = useState<
    AgencyPortfolioRow[]
  >([]);
  const [agencyProjectionRows, setAgencyProjectionRows] = useState<
    AgencyProjectionRow[]
  >([]);
  const [agencyTablesLoading, setAgencyTablesLoading] = useState(false);
  const [agencyTablesReady, setAgencyTablesReady] = useState(false);
  const [agencyTablesError, setAgencyTablesError] = useState<string | null>(
    null,
  );
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [highlightsReady, setHighlightsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rebuildingCache, setRebuildingCache] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportEmailTo, setReportEmailTo] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [lastGeneratedPdfPath, setLastGeneratedPdfPath] = useState(REPORT_PATH);
  const [pdfJobId, setPdfJobId] = useState<number | null>(null);
  const [pdfJobStatus, setPdfJobStatus] = useState<PdfJobStatus | null>(null);
  const [pdfJobStep, setPdfJobStep] = useState<string | null>(null);
  const [reportPanelOpen, setReportPanelOpen] = useState(false);
  const [
    useProjectedCurrentMonthFactures,
    setUseProjectedCurrentMonthFactures,
  ] = useState(() => {
    const value = String(requestedCaProjeteFactures || "").toLowerCase();
    if (["0", "false", "faux", "non", "no", "off"].includes(value))
      return false;
    return true;
  });

  const days = useMemo(() => daysInMonth(month), [month]);
  const monthBegin = useMemo(() => monthStart(month), [month]);
  const monthEnd = useMemo(() => nextMonthStart(month), [month]);

  const isAgenceLocked = access.hasAgenceRestriction;
  const isCollaborateurLocked = access.hasCollaborateurRestriction;
  const effectiveAgence = isAgenceLocked
    ? access.allowedAgences[0] || ""
    : agence;
  const effectiveCollaborateur = isCollaborateurLocked
    ? access.allowedCollaborateurs[0] || ""
    : collaborateur;

  const normalizedRows = useMemo(
    () =>
      dailyRows.map((row) => ({
        ...row,
        nb_documents: Number(row.nb_documents || 0),
        nb_lignes: Number(row.nb_lignes || 0),
        montant_ht: Number(row.montant_ht || 0),
        quantite_brute: Number(row.quantite_brute || 0),
        quantite_pertinente: Number(row.quantite_pertinente || 0),
      })),
    [dailyRows],
  );

  const normalizedDistinctDocRows = useMemo(
    () =>
      distinctDocRows.map((row) => ({
        ...row,
        jour: dateOnly(row.jour),
        dimension_type: String(row.dimension_type || "TOTAL"),
        dimension: row.dimension || null,
        nb_documents: Number(row.nb_documents || 0),
      })),
    [distinctDocRows],
  );

  const normalizedYtdRowsN = useMemo(
    () => normalizeDailyRows(ytdRowsN),
    [ytdRowsN],
  );
  const normalizedYtdRowsN1 = useMemo(
    () => normalizeDailyRows(ytdRowsN1),
    [ytdRowsN1],
  );
  const normalizedMtdPreviousRows = useMemo(
    () => normalizeDailyRows(mtdPreviousRows),
    [mtdPreviousRows],
  );
  const normalizedRollingRowsN = useMemo(
    () => normalizeDailyRows(rollingRowsN),
    [rollingRowsN],
  );
  const normalizedRollingRowsN1 = useMemo(
    () => normalizeDailyRows(rollingRowsN1),
    [rollingRowsN1],
  );

  // Le cache comparatif est chargé une seule fois pour tout le mois.
  // Le changement de jour focus ne déclenche plus de requête : on tronque localement
  // les lignes YTD N et N-1 à la date sélectionnée.
  const normalizedYtdRowsNAtFocus = useMemo(
    () => normalizedYtdRowsN.filter((row) => dateOnly(row.jour) <= focusDate),
    [normalizedYtdRowsN, focusDate],
  );
  const normalizedYtdRowsN1AtFocus = useMemo(() => {
    const previousFocusDate = addYearsYmd(focusDate, -1);
    return normalizedYtdRowsN1.filter(
      (row) => dateOnly(row.jour) <= previousFocusDate,
    );
  }, [normalizedYtdRowsN1, focusDate]);

  const chartRows = useMemo<DailyRow[]>(() => {
    if (viewMode !== "nb_documents" || normalizedDistinctDocRows.length === 0)
      return normalizedRows;

    return normalizedDistinctDocRows
      .filter(
        (row) =>
          normalizeKey(row.dimension_type) === "TOTAL" &&
          isDocType(row.type_document),
      )
      .map((row) => ({
        jour: row.jour,
        type_document: row.type_document as DocType,
        agence: "TOTAL",
        collaborateur: "",
        depot: "",
        depot_bucket: "",
        famille_macro: "TOTAL",
        hors_statistique: null,
        nb_documents: Number(row.nb_documents || 0),
        nb_lignes: 0,
        montant_ht: 0,
        quantite_brute: 0,
        quantite_pertinente: 0,
      }));
  }, [viewMode, normalizedRows, normalizedDistinctDocRows]);

  const filteredFocusRows = useMemo(
    () => normalizedRows.filter((row) => row.jour === focusDate),
    [normalizedRows, focusDate],
  );

  const availableAgences = useMemo(
    () =>
      Array.from(
        new Set([
          ...normalizedRows.map((r) => r.agence || "").filter(Boolean),
          ...normalizedDistinctDocRows
            .filter((r) => normalizeKey(r.dimension_type) === "AGENCE")
            .map((r) => r.dimension || "")
            .filter(Boolean),
        ]),
      ).sort(),
    [normalizedRows, normalizedDistinctDocRows],
  );
  const availableFamilies = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedRows.map((r) => r.famille_macro || "").filter(Boolean),
        ),
      ).sort(),
    [normalizedRows],
  );
  const availableCollaborateurs = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedRows.map((r) => r.collaborateur || "").filter(Boolean),
        ),
      ).sort(),
    [normalizedRows],
  );

  const availableAgencesForSelect = useMemo(() => {
    const values: string[] = isAgenceLocked
      ? (access.allowedAgences as string[])
      : availableAgences;
    return Array.from(
      new Set(values.filter((value): value is string => Boolean(value))),
    ).sort(agencySort);
  }, [isAgenceLocked, access.allowedAgences, availableAgences]);

  const availableCollaborateursForSelect = useMemo(() => {
    const values: string[] = isCollaborateurLocked
      ? (access.allowedCollaborateurs as string[])
      : availableCollaborateurs;
    return Array.from(
      new Set(values.filter((value): value is string => Boolean(value))),
    ).sort((a, b) => a.localeCompare(b, "fr-FR"));
  }, [
    isCollaborateurLocked,
    access.allowedCollaborateurs,
    availableCollaborateurs,
  ]);

  const elapsedMonthDays = useMemo(
    () => days.filter((day) => day <= focusDate),
    [days, focusDate],
  );

  const businessDayBasis = useMemo(() => {
    return getBusinessDayBasis(normalizedRows, elapsedMonthDays);
  }, [normalizedRows, elapsedMonthDays]);

  const mtdComparisonBasis = useMemo(
    () =>
      buildMtdComparisonBasis(
        normalizedRows,
        normalizedMtdPreviousRows,
        month,
        focusDate,
      ),
    [normalizedRows, normalizedMtdPreviousRows, month, focusDate],
  );

  const previousMtdMatchedRows = useMemo(() => {
    if (!mtdComparisonBasis.previousEndDate) return [];

    return normalizedMtdPreviousRows.filter((row) => {
      const day = dateOnly(row.jour);
      return (
        monthKey(day) === mtdComparisonBasis.previousMonth &&
        day <= String(mtdComparisonBasis.previousEndDate)
      );
    });
  }, [normalizedMtdPreviousRows, mtdComparisonBasis]);

  const kpiCards = useMemo<KpiCardData[]>(() => {
    return DOC_TYPES.map((type) => {
      const dayRows = filteredFocusRows.filter((r) => r.type_document === type);
      const monthRowsBeforeFocus = normalizedRows.filter(
        (r) => r.type_document === type && r.jour <= focusDate,
      );
      const previousMonthRowsMatched = previousMtdMatchedRows.filter(
        (r) => r.type_document === type,
      );
      const last7Start = addDaysYmd(focusDate, -6);
      const last7Rows = normalizedRows.filter(
        (r) =>
          r.type_document === type &&
          r.jour >= last7Start &&
          r.jour <= focusDate,
      );

      const amount = sum(dayRows, (r) => r.montant_ht);
      const qtyPert = sum(dayRows, (r) => r.quantite_pertinente);
      const monthAmount = sum(monthRowsBeforeFocus, (r) => r.montant_ht);
      const monthQtyPert = sum(
        monthRowsBeforeFocus,
        (r) => r.quantite_pertinente,
      );
      const monthAmountN1 = sum(
        previousMonthRowsMatched,
        (r) => r.montant_ht,
      );
      const monthQtyPertN1 = sum(
        previousMonthRowsMatched,
        (r) => r.quantite_pertinente,
      );
      const nb = normalizedDistinctDocRows.length
        ? sumDistinctDocs(normalizedDistinctDocRows, type, focusDate, focusDate)
        : sum(dayRows, (r) => r.nb_documents);
      const mtdDocs = normalizedDistinctDocRows.length
        ? sumDistinctDocs(
            normalizedDistinctDocRows,
            type,
            monthBegin,
            focusDate,
          )
        : modeValueFromRows(monthRowsBeforeFocus, "nb_documents");
      const last7Docs = normalizedDistinctDocRows.length
        ? sumDistinctDocs(
            normalizedDistinctDocRows,
            type,
            last7Start,
            focusDate,
          )
        : modeValueFromRows(last7Rows, "nb_documents");
      const last7PeriodDays = days.filter(
        (d) => d >= last7Start && d <= focusDate,
      );
      const last7Basis = getBusinessDayBasis(normalizedRows, last7PeriodDays);
      const selectedDayValue =
        viewMode === "nb_documents"
          ? nb
          : modeValueFromComponents({ amount, nb, qtyPert }, viewMode);
      const mtdValue =
        viewMode === "nb_documents"
          ? mtdDocs
          : modeValueFromRows(monthRowsBeforeFocus, viewMode);
      const last7Value =
        viewMode === "nb_documents"
          ? last7Docs
          : modeValueFromRows(last7Rows, viewMode);
      const mtdAvg = mtdValue / businessDayBasis.count;
      const last7Avg = last7Value / last7Basis.count;
      const monthAverageAmount =
        modeValueFromRows(monthRowsBeforeFocus, "montant_ht") /
        businessDayBasis.count;
      const blFmsAmount = sum(
        dayRows.filter((r) => r.depot_bucket === "FMS"),
        (r) => Math.abs(r.montant_ht),
      );
      const blTotalAmount = sum(dayRows, (r) => Math.abs(r.montant_ht));
      const blFmsAmountMonth = sum(
        monthRowsBeforeFocus.filter((r) => r.depot_bucket === "FMS"),
        (r) => Math.abs(r.montant_ht),
      );
      const blTotalAmountMonth = sum(monthRowsBeforeFocus, (r) =>
        Math.abs(r.montant_ht),
      );

      return {
        type,
        nb,
        amount,
        qtyPert,
        monthAmount,
        monthQtyPert,
        monthNb: mtdDocs,
        monthAverageAmount,
        monthAmountN1,
        monthQtyPertN1,
        monthAmountEvolutionPct: pctEvolution(monthAmount, monthAmountN1),
        monthQtyPertEvolutionPct: pctEvolution(
          monthQtyPert,
          monthQtyPertN1,
        ),
        fmsPct:
          type === "BL" && blTotalAmount
            ? (blFmsAmount / blTotalAmount) * 100
            : undefined,
        fmsPctMonth:
          type === "BL" && blTotalAmountMonth
            ? (blFmsAmountMonth / blTotalAmountMonth) * 100
            : undefined,
        topAgence: getTopLabel(dayRows, "agence"),
        topFamille: getTopLabel(dayRows, "famille_macro"),
        evolutionVsMtdPct: buildEvolution(selectedDayValue, mtdAvg),
        evolutionVs7dPct: buildEvolution(selectedDayValue, last7Avg),
      };
    });
  }, [
    filteredFocusRows,
    normalizedRows,
    normalizedDistinctDocRows,
    focusDate,
    monthBegin,
    days,
    viewMode,
    businessDayBasis,
    previousMtdMatchedRows,
  ]);

  const byAgencyDocOverrides = useMemo(
    () =>
      buildDistinctDocOverrideMap(
        normalizedDistinctDocRows,
        "AGENCE",
        focusDate,
        focusDate,
      ),
    [normalizedDistinctDocRows, focusDate],
  );

  const byAgencyRows = useMemo(
    () =>
      aggregateMatrix(
        filteredFocusRows,
        (r) => r.agence || "Sans agence",
        byAgencyDocOverrides,
      ),
    [filteredFocusRows, byAgencyDocOverrides],
  );
  const byFamilyRows = useMemo(
    () =>
      aggregateMatrix(filteredFocusRows, (r) => r.famille_macro || "AUTRES"),
    [filteredFocusRows],
  );
  const mtdSourceRows = useMemo(
    () => normalizedRows.filter((row) => row.jour <= focusDate),
    [normalizedRows, focusDate],
  );
  const byFamilyMtdComparisonRows = useMemo(
    () =>
      aggregateComparisonRows(
        mtdSourceRows,
        previousMtdMatchedRows,
        (row) => row.famille_macro || "AUTRES",
        (row) => row.famille_macro || "AUTRES",
      ),
    [mtdSourceRows, previousMtdMatchedRows],
  );

  const byAgencyMtdComparisonRows = useMemo(
    () =>
      aggregateComparisonRows(
        mtdSourceRows,
        previousMtdMatchedRows,
        (row) => row.agence || "Sans agence",
        (row) => row.agence || "Sans agence",
      ),
    [mtdSourceRows, previousMtdMatchedRows],
  );

  const ytdAgencyComparisonRowsFallback = useMemo(
    () =>
      aggregateComparisonRows(
        normalizedYtdRowsNAtFocus,
        normalizedYtdRowsN1AtFocus,
        (row) => row.agence || "Sans agence",
        (row) => row.agence || "Sans agence",
      ),
    [normalizedYtdRowsNAtFocus, normalizedYtdRowsN1AtFocus],
  );
  const ytdFamilyComparisonRowsFallback = useMemo(
    () =>
      aggregateComparisonRows(
        normalizedYtdRowsNAtFocus,
        normalizedYtdRowsN1AtFocus,
        (row) => row.famille_macro || "AUTRES",
        (row) => row.famille_macro || "AUTRES",
      ),
    [normalizedYtdRowsNAtFocus, normalizedYtdRowsN1AtFocus],
  );
  const rollingMonths = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        addMonthsToMonth(month, index - 11),
      ),
    [month],
  );
  const rollingComparisonRowsFallback = useMemo(
    () =>
      buildRollingComparisonRows(
        normalizedRollingRowsN,
        normalizedRollingRowsN1,
        rollingMonths,
      ),
    [normalizedRollingRowsN, normalizedRollingRowsN1, rollingMonths],
  );

  const ytdAgencyComparisonRowsBase = globalAgencyYtdRows.length
    ? globalAgencyYtdRows
    : ytdAgencyComparisonRowsFallback;
  const ytdFamilyComparisonRowsBase = globalFamilyYtdRows.length
    ? globalFamilyYtdRows
    : ytdFamilyComparisonRowsFallback;
  const rollingComparisonRowsBase = globalRolling12Rows.length
    ? globalRolling12Rows
    : rollingComparisonRowsFallback;

  const projectionFacturesEnabled =
    useProjectedCurrentMonthFactures &&
    agencyTablesReady &&
    agencyProjectionRows.length > 0;

  const ytdAgencyComparisonRowsDisplay = useMemo(() => {
    if (!projectionFacturesEnabled) return ytdAgencyComparisonRowsBase;
    return applyProjectedCurrentMonthFacturesToAgencyRows(
      ytdAgencyComparisonRowsBase,
      normalizedRows,
      agencyProjectionRows,
      month,
    );
  }, [
    projectionFacturesEnabled,
    ytdAgencyComparisonRowsBase,
    normalizedRows,
    agencyProjectionRows,
    month,
  ]);

  const rollingComparisonRowsDisplay = useMemo(() => {
    if (!projectionFacturesEnabled) return rollingComparisonRowsBase;
    return applyProjectedCurrentMonthFacturesToRollingRows(
      rollingComparisonRowsBase,
      normalizedRows,
      agencyProjectionRows,
      month,
    );
  }, [
    projectionFacturesEnabled,
    rollingComparisonRowsBase,
    normalizedRows,
    agencyProjectionRows,
    month,
  ]);

  const ytdAgencyComparisonRowsForTable =
    cachedAgencyYtdRows || ytdAgencyComparisonRowsDisplay;
  const ytdFamilyComparisonRowsForTable =
    cachedFamilyYtdRows || ytdFamilyComparisonRowsBase;
  const rollingComparisonRowsForTable =
    cachedRolling12Rows || rollingComparisonRowsDisplay;

  const projectedFacturesOptionLabel = useMemo(() => {
    const projectedTotal = sum(agencyProjectionRows, (row) => row.projectionCa);
    return `CA projeté mois en cours sur facturation €${projectedTotal ? ` (${formatMoneyCompact(projectedTotal)})` : ""}`;
  }, [agencyProjectionRows]);

  const comparisonProgressLabel = useMemo(() => {
    if (comparisonProgress.status === "ready")
      return (
        comparisonProgress.label ||
        "Tableaux activité N / N-1 et 12 mois glissants chargés."
      );
    if (comparisonProgress.status === "error")
      return (
        comparisonProgress.label ||
        "Erreur pendant le chargement des tableaux comparatifs."
      );
    if (comparisonProgress.status !== "loading") return "";

    return (
      comparisonProgress.current ||
      comparisonProgress.label ||
      "Chargement des tableaux comparatifs…"
    );
  }, [comparisonProgress]);

  const distinctDocsProgressLabel = useMemo(() => {
    if (distinctDocsProgress.status === "ready")
      return "Documents distincts chargés complètement.";
    if (distinctDocsProgress.status === "error")
      return "Erreur pendant le chargement des documents distincts.";
    if (distinctDocsProgress.status !== "loading") return "";

    const total = distinctDocsProgress.total || 0;
    const done = distinctDocsProgress.done || 0;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const current = distinctDocsProgress.current
      ? ` · ${distinctDocsProgress.current}`
      : "";
    return `Actualisation des documents distincts : ${done}/${total} périodes (${pct} %)${current}`;
  }, [distinctDocsProgress]);

  const comparisonReadyForReport =
    comparisonReady ||
    (isPdfMode && comparisonProgress.status === "ready" && !comparisonError);

  const mtdComparisonReadyForReport =
    mtdComparisonReady && !mtdComparisonError;

  const focusReportReady = Boolean(
    dailyReady &&
    distinctDocsReady &&
    highlightsReady &&
    agencyTablesReady &&
    comparisonReadyForReport &&
    mtdComparisonReadyForReport &&
    !loading &&
    !distinctDocsLoading &&
    !highlightsLoading &&
    !agencyTablesLoading &&
    (!comparisonLoading || isPdfMode) &&
    !mtdComparisonLoading &&
    !rebuildingCache &&
    !error &&
    !comparisonError &&
    !mtdComparisonError &&
    !agencyTablesError,
  );

  const focusReportStatus =
    error || comparisonError || mtdComparisonError || agencyTablesError
      ? "error"
      : focusReportReady
        ? "ready"
        : "loading";

  const focusReportLoadingLabel = [
    loading ? "données journalières" : null,
    distinctDocsLoading
      ? distinctDocsProgressLabel || "documents distincts"
      : null,
    highlightsLoading ? "TOP 20" : null,
    agencyTablesLoading ? "portefeuille / projection" : null,
    comparisonLoading ? "tableaux N / N-1 et 12 mois glissants" : null,
    mtdComparisonLoading ? "Month to date N-1" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const highlights = useMemo(() => {
    const sorted = [...highlightRows].map((row) => ({
      ...row,
      montant_ht: Number(row.montant_ht || 0),
    }));
    const topDevis = sorted
      .filter((r) => r.type_document === "Devis")
      .sort((a, b) => Math.abs(b.montant_ht) - Math.abs(a.montant_ht))
      .slice(0, 20);
    const topCdc = sorted
      .filter((r) => r.type_document === "CDC")
      .sort((a, b) => Math.abs(b.montant_ht) - Math.abs(a.montant_ht))
      .slice(0, 20);
    const topDocs = sorted
      .filter((r) =>
        ["BL", "CDC", "Factures"].includes(String(r.type_document)),
      )
      .sort((a, b) => Math.abs(b.montant_ht) - Math.abs(a.montant_ht))
      .slice(0, 20);
    return { topDevis, topCdc, topDocs };
  }, [highlightRows]);

  function setFocusDateAndSyncMonth(nextFocusDate: string) {
    setFocusDate(nextFocusDate);
    const nextMonth = String(nextFocusDate || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(nextMonth) && nextMonth !== month) {
      setMonth(nextMonth);
    }
  }

  function setMonthAndSyncFocusDate(nextMonth: string) {
    setMonth(nextMonth);
    if (!String(focusDate || "").startsWith(nextMonth)) {
      const candidate =
        nextMonth === actualCurrentMonth
          ? pickDefaultFocusDate()
          : `${nextMonth}-01`;
      setFocusDate(
        candidate.startsWith(nextMonth) ? candidate : `${nextMonth}-01`,
      );
    }
  }

  useEffect(() => {
    if (!focusDate.startsWith(month)) {
      const candidate =
        month === actualCurrentMonth ? pickDefaultFocusDate() : `${month}-01`;
      setFocusDate(candidate.startsWith(month) ? candidate : `${month}-01`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    if (access.loading) return;
    if (isAgenceLocked) {
      setAgence(access.allowedAgences[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.loading, isAgenceLocked, access.allowedAgences.join("|")]);

  useEffect(() => {
    if (access.loading) return;
    if (isCollaborateurLocked) {
      setCollaborateur(access.allowedCollaborateurs[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    isCollaborateurLocked,
    access.allowedCollaborateurs.join("|"),
  ]);

  useEffect(() => {
    if (access.loading) return;
    void loadData();
    void loadDistinctDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    month,
    effectiveAgence,
    familleMacro,
    effectiveCollaborateur,
    includeHorsStats,
  ]);

  useEffect(() => {
    if (access.loading) return;

    if (isPdfMode && requestedPdfCacheId) {
      void loadPdfCacheTables(requestedPdfCacheId);
      return;
    }

    setCachedAgencyYtdRows(null);
    setCachedFamilyYtdRows(null);
    setCachedRolling12Rows(null);
    void loadComparisonTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    month,
    focusDate,
    effectiveAgence,
    familleMacro,
    effectiveCollaborateur,
    includeHorsStats,
    requestedPdfCacheId,
  ]);

  useEffect(() => {
    if (access.loading) return;
    void loadMtdPreviousYearRows();
    // Le mois N-1 complet est réutilisé lorsque seul le jour focus change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    month,
    effectiveAgence,
    familleMacro,
    effectiveCollaborateur,
    includeHorsStats,
  ]);

  useEffect(() => {
    if (!isPdfMode || !comparisonLoading) return;

    const timer = window.setTimeout(() => {
      // Invalide le chargement en cours : s'il revient plus tard, il ne doit plus réécrire l'état.
      comparisonLoadIdRef.current += 1;

      setComparisonError(null);
      setComparisonReady(true);
      setComparisonLoading(false);
      setComparisonProgress((current) => {
        const safeTotal = current.total || current.done || 1;
        return {
          status: "ready",
          label: "Arrêt sécurité PDF : tableaux comparatifs partiels",
          current:
            "Mode PDF : génération autorisée malgré une période comparative bloquée",
          done: safeTotal,
          total: safeTotal,
        };
      });
    }, PDF_COMPARISON_HARD_STOP_MS);

    return () => window.clearTimeout(timer);
  }, [isPdfMode, comparisonLoading]);

  useEffect(() => {
    if (access.loading) return;
    void loadHighlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    focusDate,
    effectiveAgence,
    familleMacro,
    effectiveCollaborateur,
    includeHorsStats,
  ]);

  useEffect(() => {
    if (access.loading) return;
    void loadAgencyControlTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.loading,
    month,
    focusDate,
    effectiveAgence,
    familleMacro,
    effectiveCollaborateur,
    includeHorsStats,
  ]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email || "";
      if (email) setReportEmailTo((current) => current || email);
    })();
  }, []);

  useEffect(() => {
    if (!pdfJobId) return;
    if (!["pending", "running"].includes(String(pdfJobStatus || ""))) return;

    let cancelled = false;
    let timer: number | null = null;

    async function tick() {
      try {
        if (cancelled || !pdfJobId) return;
        await refreshPdfJobStatus(pdfJobId);
      } catch (exception: any) {
        if (!cancelled) {
          console.warn("Polling job PDF impossible:", exception);
        }
      }
    }

    void tick();
    timer = window.setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfJobId, pdfJobStatus]);

  function buildReportPayload(pdfCacheId?: string | null) {
    return {
      bucket: REPORT_BUCKET,
      path: REPORT_PATH,
      filename: REPORT_FILENAME,
      month,
      focus_date: focusDate,
      hors_statistiques: includeHorsStats ? "afficher" : "masquer",
      view: viewMode,
      agence: effectiveAgence || null,
      famille_macro: familleMacro || null,
      collaborateur: effectiveCollaborateur || null,
      ca_projete_factures_mois_en_cours: useProjectedCurrentMonthFactures,
      caProjeteFactures: useProjectedCurrentMonthFactures ? "1" : "0",
      pdf_cache_id: pdfCacheId || null,
      cache_id: pdfCacheId || null,
      comparison_cache_id: pdfCacheId || null,
      wait_for_ready_selector: '[data-focus-report-ready="1"]',
      wait_timeout_ms: 240000,
    };
  }

  function sanitizeComparisonRows(rows: unknown): ComparisonRow[] {
    if (!Array.isArray(rows)) return [];

    return rows.map((row: any) => {
      const byType = createEmptyComparisonRecord();

      DOC_TYPES.forEach((type) => {
        const source = row?.byType?.[type] || {};
        byType[type] = {
          amountN1: Number(source.amountN1 || 0),
          amountN: Number(source.amountN || 0),
          qtyPertN1: Number(source.qtyPertN1 || 0),
          qtyPertN: Number(source.qtyPertN || 0),
        };
      });

      return {
        label: String(row?.label || "—"),
        byType,
        total: Number(row?.total || 0),
      };
    });
  }

  async function createPdfCacheRun(token?: string) {
    const accessToken = token || (await getSessionAccessToken());
    const response = await fetch(REPORT_PDF_CACHE_ROUTE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: "create",
        month,
        focus_date: focusDate,
        view: viewMode,
        agence: effectiveAgence || null,
        famille_macro: familleMacro || null,
        collaborateur: effectiveCollaborateur || null,
        include_hors_statistiques: includeHorsStats,
        ca_projete_factures: useProjectedCurrentMonthFactures,
        expected_tables: [
          "activity_agency_ytd",
          "activity_family_ytd",
          "activity_rolling_12",
        ],
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || !result?.cache_id) {
      throw new Error(
        result?.error || `Création cache PDF impossible (${response.status})`,
      );
    }

    return String(result.cache_id);
  }

  async function savePdfCacheTable(
    cacheId: string,
    tableKey:
      "activity_agency_ytd" | "activity_family_ytd" | "activity_rolling_12",
    rows: ComparisonRow[],
    token?: string,
    meta: Record<string, any> = {},
  ) {
    const accessToken = token || (await getSessionAccessToken());
    const response = await fetch(REPORT_PDF_CACHE_ROUTE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: "table",
        cache_id: cacheId,
        table_key: tableKey,
        rows,
        meta,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(
        result?.error ||
          `Sauvegarde cache PDF ${tableKey} impossible (${response.status})`,
      );
    }

    return result.cache;
  }

  async function preparePdfCacheFromCurrentScreen(token?: string) {
    if (!comparisonReady || comparisonLoading) {
      throw new Error(
        "Les tableaux comparatifs ne sont pas prêts : impossible de créer le cache PDF.",
      );
    }

    const accessToken = token || (await getSessionAccessToken());
    const cacheId = await createPdfCacheRun(accessToken);

    await savePdfCacheTable(
      cacheId,
      "activity_agency_ytd",
      ytdAgencyComparisonRowsForTable,
      accessToken,
      {
        label: "Activité par agence depuis le début de l’année",
        focus_date: focusDate,
        month,
        projected_current_month_factures: useProjectedCurrentMonthFactures,
      },
    );

    await savePdfCacheTable(
      cacheId,
      "activity_family_ytd",
      ytdFamilyComparisonRowsForTable,
      accessToken,
      {
        label: "Activité par famille macro depuis le début de l’année",
        focus_date: focusDate,
        month,
      },
    );

    await savePdfCacheTable(
      cacheId,
      "activity_rolling_12",
      rollingComparisonRowsForTable,
      accessToken,
      {
        label: "Activité 12 mois glissants",
        focus_date: focusDate,
        month,
        projected_current_month_factures: useProjectedCurrentMonthFactures,
      },
    );

    return cacheId;
  }

  async function loadPdfCacheTables(cacheId: string) {
    const loadId = comparisonLoadIdRef.current + 1;
    comparisonLoadIdRef.current = loadId;

    setComparisonLoading(true);
    setComparisonReady(false);
    setComparisonError(null);
    setComparisonProgress({
      status: "loading",
      label: "Chargement cache PDF des tableaux comparatifs",
      current: cacheId,
      done: 0,
      total: 3,
    });

    try {
      const params = new URLSearchParams({ cache_id: cacheId });
      if (requestedRenderSecret)
        params.set("render_secret", requestedRenderSecret);

      const response = await fetch(
        `${REPORT_PDF_CACHE_ROUTE}?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok || !result?.payload) {
        throw new Error(
          result?.error ||
            `Chargement cache PDF impossible (${response.status})`,
        );
      }

      if (loadId !== comparisonLoadIdRef.current) return;

      const tables = result.payload?.tables || {};
      const agencyRows = sanitizeComparisonRows(
        tables.activity_agency_ytd?.rows,
      );
      const familyRows = sanitizeComparisonRows(
        tables.activity_family_ytd?.rows,
      );
      const rollingRows = sanitizeComparisonRows(
        tables.activity_rolling_12?.rows,
      );

      if (!agencyRows.length && !familyRows.length && !rollingRows.length) {
        throw new Error(
          "Cache PDF vide : aucun tableau comparatif disponible.",
        );
      }

      setCachedAgencyYtdRows(agencyRows);
      setCachedFamilyYtdRows(familyRows);
      setCachedRolling12Rows(rollingRows);
      setGlobalAgencyYtdRows([]);
      setGlobalFamilyYtdRows([]);
      setGlobalRolling12Rows([]);

      // On vide les sources DailyRow des comparatifs pour éviter tout recalcul parasite en mode print.
      setYtdRowsN([]);
      setYtdRowsN1([]);
      setRollingRowsN([]);
      setRollingRowsN1([]);

      setComparisonReady(true);
      setComparisonError(null);
      setComparisonProgress({
        status: "ready",
        label: "Tableaux comparatifs chargés depuis le cache PDF",
        current: cacheId,
        done: 3,
        total: 3,
      });
    } catch (exception: any) {
      console.error("Chargement cache PDF tableaux comparatifs", exception);
      setCachedAgencyYtdRows(null);
      setCachedFamilyYtdRows(null);
      setCachedRolling12Rows(null);
      setComparisonReady(false);
      setComparisonError(exception?.message || String(exception));
      setComparisonProgress({
        status: "error",
        label: "Erreur cache PDF tableaux comparatifs",
        current: cacheId,
        done: 0,
        total: 3,
      });
    } finally {
      if (loadId === comparisonLoadIdRef.current) {
        setComparisonLoading(false);
      }
    }
  }

  async function getSessionAccessToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const token = data.session?.access_token;
    if (!token)
      throw new Error(
        "Session utilisateur absente : reconnecte-toi puis réessaie.",
      );
    return token;
  }

  function formatPdfJobLabel(job: PdfJobApiRow) {
    const stepLabel = job.step ? ` · ${job.step}` : "";
    const sizeLabel = job.bytes
      ? ` · ${(Number(job.bytes) / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} Ko`
      : "";
    if (job.status === "done")
      return `PDF généré : ${job.path || REPORT_PATH}${sizeLabel}`;
    if (job.status === "error")
      return `Erreur génération PDF${stepLabel}${job.error_message ? ` : ${job.error_message}` : ""}`;
    if (job.status === "pending")
      return `Génération PDF en attente · job ${job.id}`;
    if (job.status === "running")
      return `Génération PDF en arrière-plan · job ${job.id}${stepLabel}`;
    return `Job PDF ${job.id} · ${job.status}${stepLabel}`;
  }

  async function refreshPdfJobStatus(jobId: number, token?: string) {
    const accessToken = token || (await getSessionAccessToken());
    const response = await fetch(`${REPORT_JOB_CREATE_ROUTE}?job_id=${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || !result?.job) {
      throw new Error(
        result?.error || `Lecture statut PDF impossible (${response.status})`,
      );
    }

    const job = result.job as PdfJobApiRow;
    setPdfJobStatus(job.status);
    setPdfJobStep(job.step || null);
    setLastGeneratedPdfPath(job.path || REPORT_PATH);

    if (job.status === "done") {
      setPdfLoading(false);
      setReportError(null);
      setReportMessage(formatPdfJobLabel(job));
    } else if (job.status === "error" || job.status === "cancelled") {
      setPdfLoading(false);
      setReportError(formatPdfJobLabel(job));
      setReportMessage(null);
    } else {
      setPdfLoading(true);
      setReportMessage(formatPdfJobLabel(job));
    }

    return job;
  }

  function triggerFocusPdfWorker(jobId: number, token: string) {
    void fetch(REPORT_JOB_PROCESS_ROUTE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ job_id: jobId }),
    })
      .then(async () => {
        await refreshPdfJobStatus(jobId, token).catch(() => null);
      })
      .catch((exception) => {
        console.warn(
          "Déclenchement worker PDF non bloquant échoué:",
          exception,
        );
        setReportMessage(
          `Job PDF ${jobId} créé. Le worker n'a pas répondu immédiatement ; il sera repris par le cron ou pourra être relancé.`,
        );
      });
  }

  async function generateFocusPdf() {
    if (!focusReportReady) {
      setReportError(
        `Les données ne sont pas encore complètement chargées${focusReportLoadingLabel ? ` (${focusReportLoadingLabel})` : ""}. ` +
          'Attends que le statut passe à "données complètes" avant de lancer le PDF.',
      );
      return;
    }

    setPdfLoading(true);
    setReportError(null);
    setReportMessage("Création du job PDF…");

    try {
      const token = await getSessionAccessToken();
      setReportMessage(
        "Préparation du cache PDF à partir des tableaux affichés…",
      );
      const pdfCacheId = await preparePdfCacheFromCurrentScreen(token);

      const response = await fetch(REPORT_JOB_CREATE_ROUTE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildReportPayload(pdfCacheId)),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok || !result?.job_id) {
        throw new Error(
          result?.error || `Création job PDF impossible (${response.status})`,
        );
      }

      const jobId = Number(result.job_id);
      setPdfJobId(jobId);
      setPdfJobStatus(result.status || "pending");
      setPdfJobStep(result.step || "created");
      setLastGeneratedPdfPath(result.path || REPORT_PATH);
      setReportMessage(`Génération PDF lancée en arrière-plan · job ${jobId}`);

      triggerFocusPdfWorker(jobId, token);
      return result;
    } catch (exception: any) {
      setPdfLoading(false);
      setReportError(exception?.message || String(exception));
      throw exception;
    }
  }

  async function sendFocusReportEmail() {
    const recipients = reportEmailTo.trim();
    if (!recipients) {
      setReportError("Renseigne au moins une adresse email destinataire.");
      return;
    }

    setEmailLoading(true);
    setReportError(null);
    setReportMessage(null);

    try {
      const token = await getSessionAccessToken();
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: recipients,
          subject: `Rapport activité quotidienne - ${formatDateFr(focusDate)}`,
          html: `
            <p>Bonjour,</p>
            <p>Tu trouveras en pièce jointe le rapport d'activité quotidien généré depuis l'écran Focus Mensuel.</p>
            <p><strong>Périmètre :</strong> ${formatMonthFr(month)} · focus ${formatDateFr(focusDate)} · ${labelForMode(viewMode)}</p>
            <p>Cordialement,</p>
          `,
          text: `Rapport d'activité quotidien - ${formatDateFr(focusDate)}\nPérimètre : ${formatMonthFr(month)} · ${labelForMode(viewMode)}`,
          attachments: [
            {
              bucket: REPORT_BUCKET,
              path: lastGeneratedPdfPath || REPORT_PATH,
              filename: REPORT_FILENAME,
              contentType: "application/pdf",
            },
          ],
          tags: [
            { name: "category", value: "focus_mensuel" },
            { name: "document", value: "rapport_activite_quotidien" },
          ],
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        const resendMessage =
          result?.resend_response?.message ||
          result?.resend_response?.error ||
          "";
        throw new Error(
          result?.error
            ? `${result.error}${resendMessage ? ` : ${resendMessage}` : ""}`
            : `Envoi email impossible (${response.status})`,
        );
      }

      setReportMessage(
        `Email envoyé à ${Array.isArray(result.to) ? result.to.join(", ") : recipients}`,
      );
    } catch (exception: any) {
      setReportError(exception?.message || String(exception));
    } finally {
      setEmailLoading(false);
    }
  }

  function buildPersistentComparisonCacheKey() {
    const normalizePart = (value: string | null | undefined) =>
      encodeURIComponent(
        String(value || "")
          .trim()
          .toUpperCase(),
      );

    return [
      `v${FOCUS_COMPARISON_CACHE_VERSION}`,
      month,
      normalizePart(effectiveAgence),
      normalizePart(familleMacro),
      normalizePart(effectiveCollaborateur),
      includeHorsStats ? "HS1" : "HS0",
    ].join("|");
  }

  async function readPersistentComparisonCache(): Promise<PersistentFocusComparisonPayload | null> {
    const cacheKey = buildPersistentComparisonCacheKey();
    const { data, error } = await (supabase as any)
      .from(FOCUS_COMPARISON_CACHE_TABLE)
      .select("payload, rebuilt_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error) {
      console.warn("Lecture cache comparatif persistant impossible:", error);
      setCacheInfo(
        `Cache comparatif inaccessible : ${error.message || String(error)}`,
      );
      return null;
    }

    const payload = data?.payload as PersistentFocusComparisonPayload | null;
    if (
      !payload ||
      payload.version !== FOCUS_COMPARISON_CACHE_VERSION ||
      payload.type !== "focus_mensuel_persistent_comparison_cache" ||
      payload.month !== month
    )
      return null;

    const cacheDate = new Date(
      payload.updated_at || data?.rebuilt_at || payload.created_at,
    ).getTime();
    if (
      !Number.isFinite(cacheDate) ||
      Date.now() - cacheDate > FOCUS_COMPARISON_CACHE_TTL_MS
    ) {
      setCacheInfo(
        "Cache comparatif expiré après 14 jours : reconstruction en cours.",
      );
      return null;
    }

    const done = Array.isArray(payload.completedRanges)
      ? payload.completedRanges.length
      : 0;
    const total = Number(payload.totalRanges || 0);
    setCacheInfo(
      payload.status === "complete"
        ? `Cache comparatif complet chargé · valable 14 jours${data?.rebuilt_at ? ` · ${new Date(data.rebuilt_at).toLocaleString("fr-FR")}` : ""}`
        : `Reprise du cache comparatif : ${done}/${total || "?"} blocs déjà disponibles`,
    );
    return payload;
  }

  async function savePersistentComparisonCache(
    payload: PersistentFocusComparisonPayload,
  ): Promise<PersistentFocusComparisonPayload> {
    const cacheKey = buildPersistentComparisonCacheKey();
    const nowIso = new Date().toISOString();
    const payloadToSave: PersistentFocusComparisonPayload = {
      ...payload,
      updated_at: nowIso,
    };

    // Sauvegarde atomique côté PostgreSQL :
    // - un cache complet ne peut plus être écrasé par un onglet encore en cours ;
    // - une progression plus ancienne ne peut plus remplacer une progression plus avancée.
    const { data, error } = await (supabase as any).rpc(
      "save_focus_mensuel_comparison_cache_safe",
      {
        p_cache_key: cacheKey,
        p_cache_version: FOCUS_COMPARISON_CACHE_VERSION,
        p_month_key: month,
        p_agence: effectiveAgence || null,
        p_famille_macro: familleMacro || null,
        p_collaborateur: effectiveCollaborateur || null,
        p_include_hors_statistiques: includeHorsStats,
        p_payload: payloadToSave,
      },
    );

    if (error) throw error;

    const savedPayload = (data?.payload || data) as PersistentFocusComparisonPayload | null;
    if (!savedPayload || savedPayload.type !== "focus_mensuel_persistent_comparison_cache") {
      throw new Error("La sauvegarde du cache n'a pas renvoyé de payload valide.");
    }

    return savedPayload;
  }

  async function invalidatePersistentComparisonCacheForMonth() {
    const { error } = await (supabase as any)
      .from(FOCUS_COMPARISON_CACHE_TABLE)
      .delete()
      .eq("month_key", month);

    if (error) {
      // Si la table n'existe pas encore, le rebuild principal ne doit pas échouer.
      console.warn(
        "Invalidation cache comparatif persistant impossible:",
        error,
      );
    }
  }

  async function rebuildCacheForMonth() {
    const ok = window.confirm(
      `Planifier la reconstruction du cache Focus mensuel pour ${month} ?\n\n` +
        `Le calcul sera exécuté en arrière-plan. La page reste utilisable pendant le traitement.`,
    );
    if (!ok) return;

    setRebuildingCache(true);
    setCacheInfo(null);
    setError(null);

    try {
      const { data, error } = await (supabase as any).rpc(
        "request_focus_mensuel_cache_refresh",
        {
          p_month: monthBegin,
          p_force: true,
        },
      );

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setCacheInfo(
        `Reconstruction mise en file pour ${formatMonthFr(month)} · statut ${String(row?.status || "queued")}. ` +
          `Le worker SQL reconstruit le mois sans dépendre du délai HTTP du navigateur.`,
      );

      // Les lectures restent immédiates sur le cache existant. Le prochain clic
      // sur Actualiser récupérera les valeurs reconstruites.
      await Promise.all([
        loadData(),
        loadDistinctDocs(),
        loadComparisonTables(true),
        loadMtdPreviousYearRows(),
        loadHighlights(),
        loadAgencyControlTables(),
      ]);
    } catch (exception: any) {
      console.error("request focus mensuel cache refresh", exception);
      setError(
        `${exception?.message || String(exception)}. Vérifie que le SQL cache global V5 est installé et que Supabase Cron est activé.`,
      );
    } finally {
      setRebuildingCache(false);
    }
  }

  async function loadData() {
    setLoading(true);
    setDailyReady(false);
    setError(null);

    try {
      const { data, error } = await supabase.rpc(
        "get_focus_mensuel_daily_summary_metier",
        {
          p_date_debut: monthBegin,
          p_date_fin: monthEnd,
          p_agence: effectiveAgence || null,
          p_famille_macro: familleMacro || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_include_hors_statistiques: includeHorsStats,
        },
      );

      if (error) throw error;
      setDailyRows((data || []) as DailyRow[]);
      setDailyReady(true);
    } catch (exception: any) {
      console.error("focus mensuel daily summary", exception);
      setError(exception?.message || String(exception));
      setDailyRows([]);
      setDailyReady(false);
    } finally {
      setLoading(false);
    }
  }

  async function loadDistinctDocs() {
    setDistinctDocsLoading(true);
    setDistinctDocsReady(false);
    setDistinctDocRows([]);
    setDistinctDocsProgress({
      status: "loading",
      label: "documents distincts",
      current: null,
      done: 0,
      total: 0,
    });

    const fetchDistinctDocsRange = async (range: {
      start: string;
      end: string;
    }) => {
      const { data, error } = await withClientTimeout<
        SupabaseRpcResult<DistinctDocRow[]>
      >(
        supabase.rpc("get_focus_mensuel_docs_distinct_metier", {
          p_date_debut: range.start,
          p_date_fin: range.end,
          p_agence: effectiveAgence || null,
          p_famille_macro: familleMacro || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_include_hors_statistiques: includeHorsStats,
        }),
        isPdfMode ? 12000 : 30000,
        `Documents distincts ${range.start} au ${addDaysYmd(range.end, -1)}`,
      );

      if (error) throw error;
      return (data || []) as DistinctDocRow[];
    };

    try {
      // Ne jamais appeler la RPC documents distincts sur tout le mois en mode PDF :
      // c'est la cause du timeout qui empêche la génération du PDF.
      // On découpe en semaines, puis en jours si une semaine timeoute.
      const initialRanges = isPdfMode
        ? splitDateRangeByDays(monthBegin, monthEnd, 1)
        : splitDateRangeByDays(monthBegin, monthEnd, 7);

      let totalSteps = initialRanges.length;
      let doneSteps = 0;
      const rows: DistinctDocRow[] = [];

      const setDistinctProgress = (
        label: string,
        range: { start: string; end: string } | null,
      ) => {
        setDistinctDocsProgress({
          status: "loading",
          label,
          current: range
            ? `${formatDateFr(range.start)} au ${formatDateFr(addDaysYmd(range.end, -1))}`
            : null,
          done: doneSteps,
          total: totalSteps,
        });
      };

      for (const range of initialRanges) {
        setDistinctProgress(
          isPdfMode
            ? "Documents distincts · découpage jour"
            : "Documents distincts · découpage semaine",
          range,
        );

        try {
          rows.push(...(await fetchDistinctDocsRange(range)));
          doneSteps += 1;
          setDistinctProgress("Documents distincts", null);
        } catch (exception: any) {
          if (!isStatementTimeout(exception) && !isPdfMode) throw exception;

          if (isPdfMode) {
            console.warn(
              "Période documents distincts ignorée pour ne pas bloquer le PDF:",
              range,
              exception,
            );
            doneSteps += 1;
            setDistinctProgress("Documents distincts", null);
            continue;
          }

          const dailyRanges = splitDateRangeByDays(range.start, range.end, 1);
          totalSteps += Math.max(0, dailyRanges.length - 1);

          for (const dailyRange of dailyRanges) {
            setDistinctProgress(
              "Documents distincts · découpage jour",
              dailyRange,
            );
            try {
              rows.push(...(await fetchDistinctDocsRange(dailyRange)));
            } catch (dailyException: any) {
              console.warn(
                "Journée documents distincts ignorée:",
                dailyRange,
                dailyException,
              );
            } finally {
              doneSteps += 1;
              setDistinctProgress("Documents distincts", null);
            }
          }
        }
      }

      setDistinctDocRows(rows);
      setDistinctDocsReady(true);
      setDistinctDocsProgress({
        status: "ready",
        label: "Documents distincts chargés complètement.",
        current: null,
        done: totalSteps,
        total: totalSteps,
      });
    } catch (exception: any) {
      console.error("focus mensuel distinct docs", exception);

      if (isPdfMode) {
        // En mode PDF, on ne bloque pas le marqueur ready sur les documents distincts.
        // Un blocage ici empêche Puppeteer de démarrer page.pdf().
        setDistinctDocRows([]);
        setDistinctDocsReady(true);
        setDistinctDocsProgress({
          status: "ready",
          label: "Documents distincts ignorés après timeout en mode PDF.",
          current: null,
          done: 1,
          total: 1,
        });
      } else {
        setDistinctDocRows([]);
        setDistinctDocsReady(false);
        setDistinctDocsProgress({
          status: "error",
          label: "Erreur pendant le chargement des documents distincts.",
          current: null,
          done: 0,
          total: 0,
        });
        setError(
          `Erreur chargement documents distincts : ${exception?.message || String(exception)}`,
        );
      }
    } finally {
      setDistinctDocsLoading(false);
    }
  }

  function buildMonthlyRpcRanges(dateDebut: string, dateFin: string) {
    const ranges: Array<{ start: string; end: string }> = [];
    let cursor = dateDebut;

    // Les dates sont au format YYYY-MM-DD : la comparaison alphabétique est fiable.
    while (cursor < dateFin) {
      const endOfCursorMonth = nextMonthStart(monthKey(cursor));
      const end = endOfCursorMonth < dateFin ? endOfCursorMonth : dateFin;
      ranges.push({ start: cursor, end });
      cursor = end;
    }

    return ranges;
  }

  function splitDateRangeByDays(
    dateDebut: string,
    dateFin: string,
    stepDays: number,
  ) {
    const ranges: Array<{ start: string; end: string }> = [];
    let cursor = dateDebut;

    while (cursor < dateFin) {
      const candidateEnd = addDaysYmd(cursor, stepDays);
      const end = candidateEnd < dateFin ? candidateEnd : dateFin;
      ranges.push({ start: cursor, end });
      cursor = end;
    }

    return ranges;
  }

  function isStatementTimeout(exception: any) {
    const message = String(exception?.message || exception || "").toLowerCase();
    return (
      message.includes("statement timeout") ||
      message.includes("timeout") ||
      message.includes("canceling statement")
    );
  }

  function isStaleComparisonLoad(exception: any) {
    return (
      String(exception?.message || exception) === "__STALE_COMPARISON_LOAD__"
    );
  }

  async function withClientTimeout<T>(
    promise: PromiseLike<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} : timeout après ${timeoutMs} ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function comparisonRpcTimeoutMs() {
    // Les tableaux N / N-1 et 12 mois glissants sont maintenant chargés depuis le cache
    // en 4 appels globaux, et non plus par 36 périodes mensuelles.
    // On donne donc un peu plus de temps à chaque appel cache, sans dépasser
    // la fenêtre d'exécution disponible pour le worker PDF.
    return isPdfMode ? 18000 : 45000;
  }

  async function fetchFocusSummaryRange(range: { start: string; end: string }) {
    const { data, error } = await withClientTimeout<
      SupabaseRpcResult<DailyRow[]>
    >(
      supabase.rpc("get_focus_mensuel_daily_summary_metier", {
        p_date_debut: range.start,
        p_date_fin: range.end,
        p_agence: effectiveAgence || null,
        p_famille_macro: familleMacro || null,
        p_collaborateur: effectiveCollaborateur || null,
        p_include_hors_statistiques: includeHorsStats,
      }),
      comparisonRpcTimeoutMs(),
      `Chargement Focus ${range.start} au ${addDaysYmd(range.end, -1)}`,
    );

    if (error) throw error;
    return (data || []) as DailyRow[];
  }

  async function loadMtdPreviousYearRows() {
    const loadId = mtdComparisonLoadIdRef.current + 1;
    mtdComparisonLoadIdRef.current = loadId;

    const previousMonth = previousYearMonth(month);
    const previousStart = monthStart(previousMonth);
    const previousEnd = nextMonthStart(previousMonth);

    setMtdComparisonLoading(true);
    setMtdComparisonReady(false);
    setMtdComparisonError(null);

    try {
      const rows = await fetchFocusSummaryRange({
        start: previousStart,
        end: previousEnd,
      });

      if (loadId !== mtdComparisonLoadIdRef.current) return;

      setMtdPreviousRows(rows);
      setMtdComparisonReady(true);
      setMtdComparisonError(null);
    } catch (exception: any) {
      if (loadId !== mtdComparisonLoadIdRef.current) return;

      console.error("focus mensuel MTD N-1", exception);
      setMtdPreviousRows([]);
      setMtdComparisonReady(false);
      setMtdComparisonError(
        `Chargement MTD N-1 impossible pour ${formatMonthFr(previousMonth)} : ${
          exception?.message || String(exception)
        }`,
      );
    } finally {
      if (loadId === mtdComparisonLoadIdRef.current) {
        setMtdComparisonLoading(false);
      }
    }
  }

  function createEmptyComparisonBuckets(): ComparisonBuckets {
    return {
      ytdN: [],
      ytdN1: [],
      rollingN: [],
      rollingN1: [],
    };
  }

  function deriveYtdRowsFromRolling(
    rows: DailyRow[],
    year: number,
  ): DailyRow[] {
    const yearPrefix = `${year}-`;
    return rows.filter((row) => dateOnly(row.jour).startsWith(yearPrefix));
  }

  function resolveComparisonBuckets(
    source: ComparisonBuckets,
  ): ComparisonBuckets {
    const focusYear = Number(month.slice(0, 4));
    const rollingN = normalizeDailyRows(source.rollingN || []);
    const rollingN1 = normalizeDailyRows(source.rollingN1 || []);
    const ytdNFromRolling = deriveYtdRowsFromRolling(rollingN, focusYear);
    const ytdN1FromRolling = deriveYtdRowsFromRolling(
      rollingN1,
      focusYear - 1,
    );

    // Les blocs YTD et rolling se recouvrent. Le rolling est la source la plus
    // fiable car il est également utilisé par le troisième tableau. On dérive
    // donc systématiquement le YTD depuis le rolling lorsqu'il est disponible.
    // Cela corrige les RPC déployées avec des clés YTD différentes ou des blocs
    // YTD partiels, sans refaire de requête.
    return {
      ytdN:
        ytdNFromRolling.length > 0
          ? ytdNFromRolling
          : normalizeDailyRows(source.ytdN || []),
      ytdN1:
        ytdN1FromRolling.length > 0
          ? ytdN1FromRolling
          : normalizeDailyRows(source.ytdN1 || []),
      rollingN,
      rollingN1,
    };
  }

  function applyComparisonBuckets(result: ComparisonBuckets) {
    setYtdRowsN(result.ytdN);
    setYtdRowsN1(result.ytdN1);
    setRollingRowsN(result.rollingN);
    setRollingRowsN1(result.rollingN1);
  }

  async function fetchComparisonPeriodByMonth(
    dateDebut: string,
    dateFin: string,
    label: string,
    loadId: number,
    progress: { done: number; total: number },
  ) {
    const ranges = buildMonthlyRpcRanges(dateDebut, dateFin);
    const rows: DailyRow[] = [];

    for (const range of ranges) {
      if (loadId !== comparisonLoadIdRef.current)
        throw new Error("__STALE_COMPARISON_LOAD__");

      setComparisonProgress({
        status: "loading",
        label: "Complément automatique des tableaux comparatifs",
        current: `${label} · ${formatMonthFr(monthKey(range.start))}`,
        done: progress.done,
        total: progress.total,
      });

      try {
        rows.push(...(await fetchFocusSummaryRange(range)));
      } catch (exception: any) {
        if (!isStatementTimeout(exception)) throw exception;

        // Un mois isolé peut encore dépasser le statement_timeout selon le
        // volume BL. Dans ce cas on replie en semaines, puis en jours uniquement
        // pour la semaine qui pose problème.
        const weeklyRanges = splitDateRangeByDays(range.start, range.end, 7);
        for (const weeklyRange of weeklyRanges) {
          try {
            rows.push(...(await fetchFocusSummaryRange(weeklyRange)));
          } catch (weeklyException: any) {
            if (!isStatementTimeout(weeklyException)) throw weeklyException;
            const dailyRanges = splitDateRangeByDays(
              weeklyRange.start,
              weeklyRange.end,
              1,
            );
            for (const dailyRange of dailyRanges) {
              rows.push(...(await fetchFocusSummaryRange(dailyRange)));
            }
          }
        }
      }

      progress.done += 1;
      if (loadId !== comparisonLoadIdRef.current)
        throw new Error("__STALE_COMPARISON_LOAD__");

      setComparisonProgress({
        status: "loading",
        label: "Complément automatique des tableaux comparatifs",
        current: `${label} · ${formatMonthFr(monthKey(range.start))} terminé`,
        done: progress.done,
        total: progress.total,
      });
    }

    return normalizeDailyRows(rows);
  }

  async function persistResolvedComparisonBuckets(
    result: ComparisonBuckets,
    completedRanges: string[],
  ) {
    if (isPdfMode) return;

    try {
      await savePersistentComparisonCache({
        version: FOCUS_COMPARISON_CACHE_VERSION,
        type: "focus_mensuel_persistent_comparison_cache",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        month,
        filters: {
          agence: effectiveAgence || null,
          familleMacro: familleMacro || null,
          collaborateur: effectiveCollaborateur || null,
          includeHorsStats,
        },
        ytdRowsN: result.ytdN,
        ytdRowsN1: result.ytdN1,
        rollingRowsN: result.rollingN,
        rollingRowsN1: result.rollingN1,
        status: "complete",
        completedRanges,
        totalRanges: completedRanges.length,
      });
    } catch (cacheException) {
      // Le cache persistant accélère les ouvertures suivantes mais ne doit
      // jamais empêcher l'affichage des données déjà chargées.
      console.warn(
        "Sauvegarde du cache comparatif corrigé impossible:",
        cacheException,
      );
    }
  }

  async function loadComparisonTables(_forceRefresh = false) {
    const loadId = comparisonLoadIdRef.current + 1;
    comparisonLoadIdRef.current = loadId;

    setComparisonLoading(true);
    setComparisonReady(false);
    setComparisonError(null);
    setGlobalAgencyYtdRows([]);
    setGlobalFamilyYtdRows([]);
    setGlobalRolling12Rows([]);
    setYtdRowsN([]);
    setYtdRowsN1([]);
    setRollingRowsN([]);
    setRollingRowsN1([]);
    setCacheInfo(null);
    setComparisonProgress({
      status: "loading",
      label: "Lecture du cache global persistant",
      current: "Agrégation des 3 tableaux annuels…",
      done: 0,
      total: 1,
    });

    try {
      const { data, error } = await withClientTimeout<
        SupabaseRpcResult<AnnualCacheRpcRow[]>
      >(
        (supabase as any).rpc("get_focus_mensuel_annual_tables_cached", {
          p_focus_date: focusDate,
          p_month: month,
          p_agence: effectiveAgence || null,
          p_famille_macro: familleMacro || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_include_hors_statistiques: includeHorsStats,
        }),
        isPdfMode ? 20000 : 30000,
        `Lecture cache annuel Focus ${month}`,
      );

      if (error) throw error;
      if (loadId !== comparisonLoadIdRef.current) return;

      const rpcRows = (Array.isArray(data) ? data : []) as AnnualCacheRpcRow[];
      const agencyRows = buildComparisonRowsFromAnnualCache(
        rpcRows,
        "agency_ytd",
      );
      const familyRows = buildComparisonRowsFromAnnualCache(
        rpcRows,
        "family_ytd",
      );
      const rollingRows = buildComparisonRowsFromAnnualCache(
        rpcRows,
        "rolling_12",
      );

      if (!agencyRows.length && !familyRows.length && !rollingRows.length) {
        throw new Error(
          "Le cache global ne contient encore aucune donnée pour cette période. Consulte le statut des mois mis en file.",
        );
      }

      setGlobalAgencyYtdRows(agencyRows);
      setGlobalFamilyYtdRows(familyRows);
      setGlobalRolling12Rows(rollingRows);
      setComparisonReady(true);
      setComparisonError(null);
      setComparisonProgress({
        status: "ready",
        label: "3 tableaux annuels chargés depuis le cache SQL global.",
        current: null,
        done: 1,
        total: 1,
      });
      // Le fonctionnement normal du cache ne doit pas occuper une ligne permanente
      // dans l'écran. Les erreurs et actions de reconstruction restent affichées.
      setCacheInfo(null);
    } catch (exception: any) {
      if (loadId !== comparisonLoadIdRef.current) return;

      console.error("focus mensuel annual global cache", exception);
      setGlobalAgencyYtdRows([]);
      setGlobalFamilyYtdRows([]);
      setGlobalRolling12Rows([]);

      if (isPdfMode) {
        setComparisonReady(true);
        setComparisonError(null);
        setComparisonProgress({
          status: "ready",
          label: "Cache annuel indisponible en mode PDF : tableaux laissés vides.",
          current: null,
          done: 1,
          total: 1,
        });
      } else {
        setComparisonReady(false);
        setComparisonError(
          `${exception?.message || String(exception)}. Exécute le SQL 20260714_focus_mensuel_cache_global_v5.sql puis laisse le worker traiter la file.`,
        );
        setComparisonProgress({
          status: "error",
          label: "Erreur de lecture du cache SQL global.",
          current: null,
          done: 0,
          total: 1,
        });
      }
    } finally {
      if (loadId === comparisonLoadIdRef.current) {
        setComparisonLoading(false);
      }
    }
  }

  async function loadAgencyControlTables() {
    setAgencyTablesLoading(true);
    setAgencyTablesReady(false);
    setAgencyTablesError(null);

    try {
      const { data, error } = await withClientTimeout<
        SupabaseRpcResult<AgencyControlRpcRow[]>
      >(
        (supabase as any).rpc("get_focus_mensuel_agency_control_cached", {
          p_focus_date: focusDate,
          p_month: month,
          p_agence: effectiveAgence || null,
          p_famille_macro: familleMacro || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_include_hors_statistiques: includeHorsStats,
        }),
        isPdfMode ? 20000 : 30000,
        `Lecture portefeuille / projection Focus ${month}`,
      );

      if (error) throw error;

      const rpcRows = (Array.isArray(data) ? data : []) as AgencyControlRpcRow[];
      const portfolioRows: AgencyPortfolioRow[] = rpcRows.map((row) => ({
        label: String(row.label || "Sans agence"),
        cdc: Number(row.cdc || 0),
        cdcLivMx: Number(row.cdc_liv_mx || 0),
        pl: Number(row.pl || 0),
        plLivMPlus: Number(row.pl_liv_mplus || 0),
        // Le tableau affiche déjà BL et BR cumulés. La RPC renvoie donc
        // directement le montant signé BL/BR dans blMx et blM.
        blMx: Number(row.blbr_mx || 0),
        brMx: 0,
        blM: Number(row.blbr_m || 0),
        brM: 0,
        total: Number(row.total || 0),
      }));

      const projectionRows: AgencyProjectionRow[] = rpcRows.map((row) => ({
        label: String(row.label || "Sans agence"),
        blBrMx: Number(row.blbr_mx || 0),
        blBrM: Number(row.blbr_m || 0),
        factures: Number(row.factures || 0),
        projectionFluxBl: Number(row.projection_flux_bl || 0),
        valeurBlNf3Pct: Number(row.valeur_bl_nf_4pct || 0),
        projectionCa: Number(row.projection_ca || 0),
        caN1: Number(row.ca_n1 || 0),
        evolPct:
          row.evol_pct === null || row.evol_pct === undefined
            ? null
            : Number(row.evol_pct),
      }));

      setAgencyPortfolioRows(portfolioRows);
      setAgencyProjectionRows(projectionRows);
      setAgencyTablesReady(true);
    } catch (exception: any) {
      console.error("focus mensuel agency control cached rpc", exception);
      setAgencyTablesError(exception?.message || String(exception));
      setAgencyPortfolioRows([]);
      setAgencyProjectionRows([]);
      setAgencyTablesReady(false);
    } finally {
      setAgencyTablesLoading(false);
    }
  }

  async function loadHighlights() {
    const startPeriod = monthBegin;
    const endExclusive = addDaysYmd(focusDate, 1);

    setHighlightsLoading(true);
    setHighlightsReady(false);

    try {
      const { data, error } = await supabase.rpc(
        "get_focus_mensuel_highlights",
        {
          p_date_debut: startPeriod,
          p_date_fin: endExclusive,
          p_limit: 500,
          p_agence: effectiveAgence || null,
          p_famille_macro: familleMacro || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_include_hors_statistiques: includeHorsStats,
        },
      );

      if (error) throw error;
      setHighlightRows((data || []) as HighlightRow[]);
      setHighlightsReady(true);
    } catch (exception: any) {
      console.error("focus mensuel highlights", exception);
      setHighlightRows([]);
      // Les TOP 20 ne doivent pas bloquer indéfiniment la génération du PDF.
      // En cas d'erreur isolée, le rapport reste générable avec des tableaux TOP 20 vides.
      setHighlightsReady(true);
    } finally {
      setHighlightsLoading(false);
    }
  }

  return (
    <section
      style={styles.page}
      data-focus-report-ready={focusReportReady ? "1" : "0"}
      data-focus-projected-current-month-factures={
        projectionFacturesEnabled ? "1" : "0"
      }
      data-focus-report-status={focusReportStatus}
      data-focus-report-loading={focusReportLoadingLabel || ""}
      data-focus-comparison-ready={comparisonReady ? "1" : "0"}
      data-focus-comparison-progress={`${comparisonProgress.done}/${comparisonProgress.total}`}
      data-focus-report-mode={isPdfMode ? "1" : "0"}
    >
      {isPdfMode && (
        <style dangerouslySetInnerHTML={{ __html: PDF_PRINT_STYLES }} />
      )}
      {isPdfMode && <ReportBrandHeader focusDate={focusDate} />}
      <div style={styles.headerCard} className="focus-pdf-header-card">
        <div>
          <h1 style={styles.title} className="focus-pdf-title">
            ACTIVITE CEGECLIM DU :{" "}
            <span style={styles.titleDate}>{formatDateFr(focusDate)}</span>
          </h1>
          <div style={styles.subtitle} className="focus-pdf-subtitle">
            <span style={styles.subtitleBasisNote}>
              Moyennes mensuelles sur {businessDayBasis.label} jusqu’au{" "}
              {formatDateFr(focusDate)}
              {businessDayBasis.blDaysCount > 0
                ? ", jours sans BL exclus"
                : ", faute de BL détecté dans le périmètre filtré"}
            </span>{" "}
            <span style={styles.focusDayText}>
              Focus journée du : {formatDateFr(focusDate)}
            </span>{" "}
            · faits marquants sur 7 jours calendaires.
          </div>
        </div>
        <div
          style={styles.headerActions}
          className="focus-pdf-header-actions"
          data-no-print="true"
        >
          <button
            style={styles.secondaryButton}
            onClick={() => setFocusDateAndSyncMonth(todayYmd())}
          >
            Aujourd’hui
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => setFocusDateAndSyncMonth(addDaysYmd(todayYmd(), -1))}
          >
            Hier
          </button>
          <button
            style={styles.warningButton}
            onClick={rebuildCacheForMonth}
            disabled={rebuildingCache}
          >
            {rebuildingCache ? "Mise en file…" : "Recalculer mois en arrière-plan"}
          </button>
          <button
            style={styles.primaryButton}
            onClick={() => {
              setAgencyTablesReady(false);
              void loadData();
              void loadDistinctDocs();
              void loadComparisonTables(true);
              void loadMtdPreviousYearRows();
              void loadHighlights();
            }}
          >
            Actualiser
          </button>
        </div>
      </div>

      <div style={styles.filtersCard} className="focus-pdf-filters">
        {isPdfMode ? (
          <>
            <FilterDisplay label="Mois analysé" value={formatMonthFr(month)} />
            <FilterDisplay label="Jour focus" value={formatDateFr(focusDate)} />
            <FilterDisplay label="Vue" value={labelForMode(viewMode)} />
            <FilterDisplay label="Agence" value={effectiveAgence || "Toutes"} />
            <FilterDisplay
              label="Famille macro"
              value={familleMacro || "Toutes"}
            />
            <FilterDisplay
              label="Collaborateur"
              value={effectiveCollaborateur || "Tous"}
            />
            <FilterDisplay
              label="Hors statistiques"
              value={includeHorsStats ? "Afficher" : "Masquer"}
            />
          </>
        ) : (
          <>
            <div style={styles.field}>
              <label style={styles.label}>Mois analysé</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonthAndSyncFocusDate(e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Jour focus</label>
              <input
                type="date"
                value={focusDate}
                onChange={(e) => setFocusDateAndSyncMonth(e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Vue</label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
                style={styles.input}
              >
                <option value="montant_ht">Montant HT</option>
                <option value="nb_documents">Nombre documents</option>
                <option value="quantite_pertinente">Quantité pertinente</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Agence</label>
              <select
                value={effectiveAgence}
                disabled={isAgenceLocked}
                onChange={(e) => {
                  if (!isAgenceLocked) setAgence(e.target.value);
                }}
                style={{
                  ...styles.input,
                  ...(isAgenceLocked ? styles.lockedInput : {}),
                }}
              >
                <option value="">Toutes</option>
                {availableAgencesForSelect.map((a) => (
                  <option key={a} value={a}>
                    {isAgenceLocked ? `${a} 🔒` : a}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Famille macro</label>
              <select
                value={familleMacro}
                onChange={(e) => setFamilleMacro(e.target.value)}
                style={styles.input}
              >
                <option value="">Toutes</option>
                {availableFamilies.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Collaborateur</label>
              <select
                value={effectiveCollaborateur}
                disabled={isCollaborateurLocked}
                onChange={(e) => {
                  if (!isCollaborateurLocked) setCollaborateur(e.target.value);
                }}
                style={{
                  ...styles.input,
                  ...(isCollaborateurLocked ? styles.lockedInput : {}),
                }}
              >
                <option value="">Tous</option>
                {availableCollaborateursForSelect.map((c) => (
                  <option key={c} value={c}>
                    {isCollaborateurLocked ? `${c} 🔒` : c}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Hors statistiques</label>
              <select
                value={includeHorsStats ? "show" : "hide"}
                onChange={(e) => setIncludeHorsStats(e.target.value === "show")}
                style={styles.input}
              >
                <option value="hide">Masquer</option>
                <option value="show">Afficher</option>
              </select>
            </div>
          </>
        )}
      </div>


      {!isPdfMode && (
        <div
          style={{
            ...styles.reportCard,
            ...(reportPanelOpen ? {} : styles.reportCardCollapsed),
          }}
          data-no-print="true"
        >
          <div
            style={{
              ...styles.reportHeader,
              marginBottom: reportPanelOpen ? 12 : 0,
            }}
          >
            <div style={styles.reportHeadingGroup}>
              <div style={styles.reportTitle}>Rapport PDF & email</div>

              {reportPanelOpen ? (
                <div style={styles.reportSubtitle}>
                  Génère le PDF avec les filtres courants, le stocke dans{" "}
                  <b>
                    {REPORT_BUCKET}/{REPORT_PATH}
                  </b>
                  , puis l'envoie via la route email générique.
                </div>
              ) : (
                <div style={styles.reportCollapsedLine}>
                  <span
                    style={{
                      ...styles.reportStatusPill,
                      background: pdfLoading
                        ? "#fef3c7"
                        : focusReportReady
                          ? "#dcfce7"
                          : "#eff6ff",
                      color: pdfLoading
                        ? "#92400e"
                        : focusReportReady
                          ? "#166534"
                          : "#1d4ed8",
                    }}
                  >
                    {pdfLoading
                      ? "PDF en cours"
                      : focusReportReady
                        ? "Données prêtes"
                        : "Chargement en arrière-plan"}
                  </span>
                  <span>
                    {reportMessage ||
                      reportError ||
                      "Ouvrir pour générer le PDF ou l'envoyer par email."}
                  </span>
                </div>
              )}
            </div>

            <div style={styles.reportActions}>
              {reportPanelOpen && (
                <>
                  <button
                    type="button"
                    onClick={generateFocusPdf}
                    disabled={pdfLoading || emailLoading || !focusReportReady}
                    style={styles.secondaryButton}
                  >
                    {pdfLoading
                      ? pdfJobStep
                        ? `PDF en cours · ${pdfJobStep}`
                        : "PDF en cours…"
                      : !focusReportReady
                        ? "Données en cours…"
                        : "Générer PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={sendFocusReportEmail}
                    disabled={pdfLoading || emailLoading || !focusReportReady}
                    style={styles.primaryButton}
                  >
                    {emailLoading ? "Envoi email…" : "Envoyer PDF par email"}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setReportPanelOpen((current) => !current)}
                style={styles.reportToggleButton}
                aria-expanded={reportPanelOpen}
              >
                {reportPanelOpen ? "Réduire ▲" : "Développer ▼"}
              </button>
            </div>
          </div>

          {reportPanelOpen && (
            <>
              <div style={styles.reportFormRow}>
                <div style={styles.reportField}>
                  <label style={styles.label}>Destinataires</label>
                  <input
                    value={reportEmailTo}
                    onChange={(event) => setReportEmailTo(event.target.value)}
                    placeholder="adresse1@domaine.fr; adresse2@domaine.fr"
                    style={styles.reportInput}
                  />
                </div>
                <div style={styles.reportPathBox}>
                  <span style={styles.reportPathLabel}>PDF stocké</span>
                  <span style={styles.reportPathText}>
                    {lastGeneratedPdfPath}
                  </span>
                </div>
              </div>

              {!focusReportReady && (
                <div style={styles.infoBox}>
                  Préparation du rapport en cours
                  {focusReportLoadingLabel
                    ? ` : ${focusReportLoadingLabel}`
                    : "…"}
                  {comparisonProgressLabel ? (
                    <div style={styles.progressText}>
                      {comparisonProgressLabel}
                    </div>
                  ) : null}
                </div>
              )}
              {focusReportReady && (
                <div style={styles.successBox}>
                  Données complètes : la génération PDF peut démarrer.
                </div>
              )}
              {reportMessage && (
                <div style={styles.successBox}>{reportMessage}</div>
              )}
              {reportError && (
                <div style={styles.errorBox}>
                  Erreur rapport : {reportError}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div style={styles.errorBox}>
          Erreur chargement focus mensuel : {error}
        </div>
      )}
      {cacheInfo && <div style={styles.successBox}>{cacheInfo}</div>}
      {loading && (
        <div style={styles.infoBox}>
          Chargement des données journalières depuis le cache…
        </div>
      )}
      {distinctDocsLoading && (
        <div style={styles.infoBox}>
          {distinctDocsProgressLabel || "Chargement des documents distincts…"}
        </div>
      )}
      {highlightsLoading && (
        <div style={styles.infoBox}>Chargement des TOP 20…</div>
      )}
      {rebuildingCache && (
        <div style={styles.infoBox}>
          Reconstruction du cache mensuel en cours…
        </div>
      )}
      <div style={styles.kpiGrid} className="focus-pdf-kpi-grid">
        {kpiCards.map((card) => (
          <KpiCard
            key={card.type}
            card={card}
            mode={viewMode}
            comparisonBasis={mtdComparisonBasis}
            comparisonReady={mtdComparisonReady}
          />
        ))}
      </div>

      <div style={styles.chartGrid} className="focus-pdf-chart-grid">
        <MultiLineChart days={days} rows={chartRows} mode={viewMode} />
        <CumulativeChart days={days} rows={chartRows} mode={viewMode} />
      </div>

      <div style={styles.sectionGrid} className="focus-pdf-section-grid">
        <SummaryMatrix
          title={`Jour focus par famille macro — ${formatDateFr(focusDate)}`}
          subtitle="Lecture de la journée sélectionnée, sans comparaison N-1."
          rows={byFamilyRows}
          metric="quantite_pertinente"
          emptyMessage="Aucune donnée par famille macro sur le jour focus."
        />
        <MtdComparisonMatrix
          title={`Depuis début du mois par famille macro — au ${formatDateFr(focusDate)}`}
          subtitle={
            mtdComparisonReady
              ? mtdComparisonBasis.detailLabel
              : "Préparation de la comparaison N-1 par rang de jour d'expédition BL…"
          }
          rows={byFamilyMtdComparisonRows}
          comparisonReady={mtdComparisonReady}
          emptyMessage="Aucune donnée par famille macro depuis le début du mois."
        />
      </div>

      <div style={styles.sectionGrid} className="focus-pdf-section-grid">
        <SummaryMatrix
          title={`Jour focus par agence — ${formatDateFr(focusDate)}`}
          subtitle="Lecture de la journée sélectionnée, sans comparaison N-1."
          rows={byAgencyRows}
          metric="quantite_pertinente"
          emptyMessage="Aucune donnée par agence sur le jour focus."
        />
        <MtdComparisonMatrix
          title={`Depuis début du mois par agence — au ${formatDateFr(focusDate)}`}
          subtitle={
            mtdComparisonReady
              ? mtdComparisonBasis.detailLabel
              : "Préparation de la comparaison N-1 par rang de jour d'expédition BL…"
          }
          rows={byAgencyMtdComparisonRows}
          comparisonReady={mtdComparisonReady}
          emptyMessage="Aucune donnée par agence depuis le début du mois."
        />
      </div>

      {agencyTablesError && (
        <div style={styles.errorBox}>
          Erreur tableaux portefeuille / projection : {agencyTablesError}
        </div>
      )}
      {agencyTablesLoading && (
        <div style={styles.infoBox}>
          Chargement du portefeuille de commande et de la projection du CA par
          agence…
        </div>
      )}

      <div
        style={styles.sectionGrid}
        className="focus-pdf-section-grid focus-pdf-agency-section-grid"
      >
        <AgencyPortfolioTable
          title={`Portefeuille de commande au ${formatDateFr(focusDate)}`}
          rows={agencyPortfolioRows}
          emptyMessage="Aucune donnée d'activité disponible pour le portefeuille de commande."
        />
        <AgencyProjectionTable
          title={`Projection facturation mois par agence — au ${formatDateFr(focusDate)}`}
          rows={agencyProjectionRows}
          emptyMessage="Aucune donnée disponible pour la projection du CA du mois."
        />
      </div>

      {comparisonError && (
        <div style={styles.errorBox}>
          Erreur tableaux activité N / N-1 : {comparisonError}
        </div>
      )}
      {comparisonLoading && (
        <div style={styles.infoBox}>
          {comparisonProgressLabel || "Chargement du cache comparatif global…"}
        </div>
      )}
      {mtdComparisonLoading && !isPdfMode && (
        <div style={styles.infoBox}>
          Chargement du Month to date N-1 par rang de jour d’expédition BL…
        </div>
      )}
      {mtdComparisonError && (
        <div style={styles.errorBox}>{mtdComparisonError}</div>
      )}

      <div style={styles.optionCard} className="focus-pdf-section-card">
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={useProjectedCurrentMonthFactures}
            disabled={agencyTablesLoading || !agencyProjectionRows.length}
            onChange={(event) =>
              setUseProjectedCurrentMonthFactures(event.target.checked)
            }
            style={styles.checkboxInput}
          />
          <span>{projectedFacturesOptionLabel}</span>
        </label>
        <div style={styles.optionHelp}>
          Option appliquée uniquement aux colonnes Fac N et Evol Fac des
          tableaux “Activité par agence depuis le début de l’année” et “Activité
          12 mois glissants”. Le tableau “Activité par famille macro” reste
          calculé sur les factures réelles.
        </div>
      </div>

      <div
        style={styles.wideSectionStack}
        className="focus-pdf-comparison-grid"
      >
        <ActivityByAgencyComparisonTable
          title={`Activité par agence depuis le début de l'année (01/01/${focusDate.slice(0, 4)} au ${formatDateFr(focusDate)})`}
          subtitle={`Option CA projeté : si cochée, les factures réelles de ${formatMonthFr(month).toLowerCase()} sont remplacées par le CA projeté du tableau Projection facturation mois par agence ; le total et l'évolution Fac sont recalculés.`}
          rows={comparisonReady ? ytdAgencyComparisonRowsForTable : []}
          emptyMessage={
            comparisonLoading
              ? "Actualisation en cours : le tableau sera affiché une fois le chargement complet terminé."
              : "Aucune donnée d'activité par agence sur la période."
          }
        />
        <ActivityByFamilyComparisonTable
          title={`Activité par famille macro depuis le début de l'année (01/01/${focusDate.slice(0, 4)} au ${formatDateFr(focusDate)})`}
          rows={comparisonReady ? ytdFamilyComparisonRowsForTable : []}
          emptyMessage={
            comparisonLoading
              ? "Actualisation en cours : le tableau sera affiché une fois le chargement complet terminé."
              : "Aucune donnée d'activité par famille macro sur la période."
          }
        />
        <Rolling12ComparisonTable
          title="Activité 12 mois glissants"
          subtitle={`Lecture en mois calendaires complets : les colonnes N et N-1 affichent le cumul disponible du 1er au dernier jour de chaque mois, indépendamment du jour focus sélectionné. Option CA projeté : si cochée, la ligne ${formatShortMonthFr(month)} remplace les factures réelles du mois par le CA projeté total ; la ligne TOTAL 12 MOIS G. et l'évolution Fac sont recalculées.`}
          rows={comparisonReady ? rollingComparisonRowsForTable : []}
          emptyMessage={
            comparisonLoading
              ? "Actualisation en cours : le tableau sera affiché une fois le chargement complet terminé."
              : "Aucune donnée d'activité sur les 12 mois glissants."
          }
        />
      </div>

      <div style={styles.highlightsGrid} className="focus-pdf-highlights-grid">
        <HighlightTable
          title="Top 20 devis créés — depuis le début du mois"
          rows={highlights.topDevis}
        />
        <HighlightTable
          title="Top 20 commandes CDC — depuis le début du mois"
          rows={highlights.topCdc}
        />
        <HighlightTable
          title="Top 20 documents BL / CDC / Factures — depuis le début du mois"
          rows={highlights.topDocs}
        />
      </div>
    </section>
  );
}

export function normalizeDailyRows(rows: DailyRow[]) {
  return rows.map((row) => ({
    ...row,
    jour: dateOnly(row.jour),
    nb_documents: Number(row.nb_documents || 0),
    nb_lignes: Number(row.nb_lignes || 0),
    montant_ht: Number(row.montant_ht || 0),
    quantite_brute: Number(row.quantite_brute || 0),
    quantite_pertinente: Number(row.quantite_pertinente || 0),
  }));
}

function createEmptyComparisonCell(): ComparisonCell {
  return { amountN1: 0, amountN: 0, qtyPertN1: 0, qtyPertN: 0 };
}

function createEmptyComparisonRecord(): Record<DocType, ComparisonCell> {
  return {
    Devis: createEmptyComparisonCell(),
    CDC: createEmptyComparisonCell(),
    BL: createEmptyComparisonCell(),
    Factures: createEmptyComparisonCell(),
  };
}

export function aggregateComparisonRows(
  currentRows: DailyRow[],
  previousRows: DailyRow[],
  currentLabelFn: (row: DailyRow) => string,
  previousLabelFn: (row: DailyRow) => string,
): ComparisonRow[] {
  const map = new Map<string, ComparisonRow>();

  const ensureRow = (label: string) => {
    const key = normalizeKey(label || "—");
    const existing = map.get(key);
    if (existing) return existing;
    const created: ComparisonRow = {
      label: label || "—",
      byType: createEmptyComparisonRecord(),
      total: 0,
    };
    map.set(key, created);
    return created;
  };

  currentRows.forEach((row) => {
    if (!isDocType(row.type_document)) return;
    const target = ensureRow(currentLabelFn(row));
    target.byType[row.type_document].amountN += Number(row.montant_ht || 0);
    target.byType[row.type_document].qtyPertN += Number(
      row.quantite_pertinente || 0,
    );
    target.total += Number(row.montant_ht || 0);
  });

  previousRows.forEach((row) => {
    if (!isDocType(row.type_document)) return;
    const target = ensureRow(previousLabelFn(row));
    target.byType[row.type_document].amountN1 += Number(row.montant_ht || 0);
    target.byType[row.type_document].qtyPertN1 += Number(
      row.quantite_pertinente || 0,
    );
  });

  return Array.from(map.values()).sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
}

export function buildRollingComparisonRows(
  currentRows: DailyRow[],
  previousRows: DailyRow[],
  months: string[],
): ComparisonRow[] {
  const currentMonthSet = new Set(months);
  const previousRowsShifted = previousRows.map((row) => ({
    ...row,
    jour: addYearsYmd(dateOnly(row.jour), 1),
  }));

  const rows = months.map((month) => {
    const monthCurrentRows = currentRows.filter(
      (row) => monthKey(row.jour) === month,
    );
    const monthPreviousRows = previousRowsShifted.filter(
      (row) => monthKey(row.jour) === month,
    );
    const aggregated = aggregateComparisonRows(
      monthCurrentRows,
      monthPreviousRows,
      () => formatShortMonthFr(month),
      () => formatShortMonthFr(month),
    );
    return (
      aggregated[0] || {
        label: formatShortMonthFr(month),
        byType: createEmptyComparisonRecord(),
        total: 0,
      }
    );
  });

  const totalRows = aggregateComparisonRows(
    currentRows.filter((row) => currentMonthSet.has(monthKey(row.jour))),
    previousRowsShifted.filter((row) =>
      currentMonthSet.has(monthKey(row.jour)),
    ),
    () => "TOTAL 12 MOIS G.",
    () => "TOTAL 12 MOIS G.",
  );
  const total = totalRows[0] || {
    label: "TOTAL 12 MOIS G.",
    byType: createEmptyComparisonRecord(),
    total: 0,
  };

  return [total, ...rows];
}

export function buildComparisonRowsFromAnnualCache(
  rows: AnnualCacheRpcRow[],
  tableKey: "agency_ytd" | "family_ytd" | "rolling_12",
): ComparisonRow[] {
  const map = new Map<
    string,
    { row: ComparisonRow; sortOrder: number }
  >();

  rows
    .filter((source) => String(source.table_key) === tableKey)
    .forEach((source) => {
      if (!isDocType(source.type_document)) return;
      const label = String(source.label || "—");
      const key = normalizeKey(label);
      const existing = map.get(key);
      const target =
        existing ||
        {
          row: {
            label,
            byType: createEmptyComparisonRecord(),
            total: 0,
          },
          sortOrder: Number(source.sort_order ?? 1000),
        };

      const cell = target.row.byType[source.type_document];
      cell.amountN1 += Number(source.amount_n1 || 0);
      cell.amountN += Number(source.amount_n || 0);
      cell.qtyPertN1 += Number(source.qty_pert_n1 || 0);
      cell.qtyPertN += Number(source.qty_pert_n || 0);
      target.row.total += Number(source.amount_n || 0);
      target.sortOrder = Math.min(
        target.sortOrder,
        Number(source.sort_order ?? 1000),
      );
      map.set(key, target);
    });

  const values = Array.from(map.values());
  if (tableKey === "rolling_12") {
    return values
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.row.label.localeCompare(b.row.label, "fr-FR");
      })
      .map(({ row }) => ({
        ...row,
        label: row.label.startsWith("TOTAL")
          ? row.label
          : formatShortMonthFr(row.label),
      }));
  }

  return values
    .map(({ row }) => row)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function cloneComparisonRow(row: ComparisonRow): ComparisonRow {
  return {
    label: row.label,
    byType: Object.fromEntries(
      DOC_TYPES.map((type) => [type, { ...row.byType[type] }]),
    ) as Record<DocType, ComparisonCell>,
    total: Number(row.total || 0),
  };
}

export function buildProjectionCaByAgency(rows: AgencyProjectionRow[]) {
  const values = new Map<string, { label: string; projectionCa: number }>();

  rows.forEach((row) => {
    const label = String(row.label || "").trim() || "Sans agence";
    if (normalizeKey(label) === "TOTAL") return;
    const key = normalizeKey(label);
    const current = values.get(key);
    const projectionCa = Number(row.projectionCa || 0);
    if (current) {
      current.projectionCa += projectionCa;
    } else {
      values.set(key, { label, projectionCa });
    }
  });

  return values;
}

export function buildCurrentMonthFacturesByAgency(
  rows: DailyRow[],
  currentMonth: string,
) {
  const values = new Map<string, number>();

  rows.forEach((row) => {
    if (row.type_document !== "Factures") return;
    if (monthKey(row.jour) !== currentMonth) return;
    const label = row.agence || "Sans agence";
    const key = normalizeKey(label);
    values.set(key, (values.get(key) || 0) + Number(row.montant_ht || 0));
  });

  return values;
}

export function applyProjectedCurrentMonthFacturesToAgencyRows(
  rows: ComparisonRow[],
  currentRows: DailyRow[],
  projectionRows: AgencyProjectionRow[],
  currentMonth: string,
): ComparisonRow[] {
  const projectionByAgency = buildProjectionCaByAgency(projectionRows);
  if (!projectionByAgency.size) return rows;

  const actualFacturesByAgency = buildCurrentMonthFacturesByAgency(
    currentRows,
    currentMonth,
  );
  const adjustedRows = rows.map((row) => {
    const key = normalizeKey(row.label);
    const projection = projectionByAgency.get(key);
    if (!projection) return cloneComparisonRow(row);

    const cloned = cloneComparisonRow(row);
    const actualFacturesMonth = actualFacturesByAgency.get(key) || 0;
    const delta = projection.projectionCa - actualFacturesMonth;
    cloned.byType.Factures.amountN += delta;
    cloned.total += delta;
    return cloned;
  });

  const existingKeys = new Set(rows.map((row) => normalizeKey(row.label)));
  projectionByAgency.forEach((projection, key) => {
    if (existingKeys.has(key)) return;
    if (!projection.projectionCa) return;

    const created: ComparisonRow = {
      label: projection.label,
      byType: createEmptyComparisonRecord(),
      total: projection.projectionCa,
    };
    created.byType.Factures.amountN = projection.projectionCa;
    adjustedRows.push(created);
  });

  return adjustedRows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export function applyProjectedCurrentMonthFacturesToRollingRows(
  rows: ComparisonRow[],
  currentRows: DailyRow[],
  projectionRows: AgencyProjectionRow[],
  currentMonth: string,
): ComparisonRow[] {
  const projectedFacturesMonth = sum(projectionRows, (row) => row.projectionCa);
  if (!projectedFacturesMonth) return rows;

  const actualFacturesMonth = sum(
    currentRows.filter(
      (row) =>
        row.type_document === "Factures" && monthKey(row.jour) === currentMonth,
    ),
    (row) => row.montant_ht,
  );
  const delta = projectedFacturesMonth - actualFacturesMonth;
  const monthLabel = formatShortMonthFr(currentMonth);

  return rows.map((row) => {
    const cloned = cloneComparisonRow(row);
    const isTotal = normalizeKey(cloned.label).startsWith("TOTAL");
    const isCurrentMonth =
      normalizeKey(cloned.label) === normalizeKey(monthLabel);

    if (isTotal || isCurrentMonth) {
      cloned.byType.Factures.amountN += delta;
      cloned.total += delta;
    }

    return cloned;
  });
}

export function buildTotalComparisonRow(
  rows: ComparisonRow[],
  label = "TOTAL",
): ComparisonRow {
  const total: ComparisonRow = {
    label,
    byType: createEmptyComparisonRecord(),
    total: 0,
  };

  rows.forEach((row) => {
    DOC_TYPES.forEach((type) => {
      total.byType[type].amountN1 += Number(row.byType[type].amountN1 || 0);
      total.byType[type].amountN += Number(row.byType[type].amountN || 0);
      total.byType[type].qtyPertN1 += Number(row.byType[type].qtyPertN1 || 0);
      total.byType[type].qtyPertN += Number(row.byType[type].qtyPertN || 0);
    });
    total.total += Number(row.total || 0);
  });

  return total;
}

export function pctEvolution(current: number, previous: number) {
  if (!previous) return null;
  return (
    ((Number(current || 0) - Number(previous || 0)) / Math.abs(previous)) * 100
  );
}

function pctCellStyle(
  value: number | null | undefined,
  isTotal = false,
  compact = false,
): React.CSSProperties {
  const base = compact
    ? isTotal
      ? styles.tdRightTotalCompact
      : styles.tdRightCompact
    : isTotal
      ? styles.tdRightTotal
      : styles.tdRight;
  if (value === null || value === undefined || !Number.isFinite(value))
    return { ...base, color: "#64748b", fontWeight: 900 };
  if (value > 0) return { ...base, color: "#047857", fontWeight: 950 };
  if (value < 0) return { ...base, color: "#b91c1c", fontWeight: 950 };
  return { ...base, color: "#64748b", fontWeight: 900 };
}

function moneyCellStyle(
  value: number,
  color: string,
  isTotal = false,
  compact = false,
): React.CSSProperties {
  const base = compact
    ? isTotal
      ? styles.tdRightTotalCompact
      : styles.tdRightCompact
    : isTotal
      ? styles.tdRightTotal
      : styles.tdRight;
  return { ...base, color, fontWeight: 950 };
}

function qtyCellStyle(
  value: number,
  color: string,
  isTotal = false,
  compact = false,
): React.CSSProperties {
  const base = compact
    ? isTotal
      ? styles.tdRightTotalCompact
      : styles.tdRightCompact
    : isTotal
      ? styles.tdRightTotal
      : styles.tdRight;
  return { ...base, color, fontWeight: 900 };
}

function modeValueFromComponents(
  values: { amount: number; nb: number; qtyPert: number },
  mode: ViewMode,
) {
  if (mode === "nb_documents") return values.nb;
  if (mode === "quantite_pertinente") return values.qtyPert;
  return values.amount;
}

function modeValueFromRows(rows: DailyRow[], mode: ViewMode) {
  return sum(rows, (r) => valueOf(r, mode));
}

function aggregateMatrix(
  rows: DailyRow[],
  labelFn: (row: DailyRow) => string,
  docOverrides?: Map<string, Record<DocType, number>>,
): MatrixRow[] {
  const grouped = groupBy(rows, labelFn);
  return Array.from(grouped.entries())
    .map(([label, items]) => {
      const override = docOverrides?.get(normalizeKey(label));
      const byType = Object.fromEntries(
        DOC_TYPES.map((type) => {
          const typeRows = items.filter((r) => r.type_document === type);
          return [
            type,
            {
              amount: sum(typeRows, (r) => r.montant_ht),
              nb: override
                ? Number(override[type] || 0)
                : sum(typeRows, (r) => r.nb_documents),
              qtyPert: sum(typeRows, (r) => r.quantite_pertinente),
            },
          ];
        }),
      ) as Record<DocType, MatrixCell>;
      return { label, byType, total: sum(items, (r) => r.montant_ht) };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export type MatrixMetric = "nb_documents" | "quantite_pertinente";

function DenseMatrixColGroup() {
  return (
    <colgroup>
      <col style={{ width: "18%" }} />
      {Array.from({ length: 8 }, (_, index) => (
        <col key={`dense-col-${index}`} style={{ width: "10.25%" }} />
      ))}
    </colgroup>
  );
}

export function SummaryMatrix({
  title,
  subtitle,
  rows,
  metric = "nb_documents",
  emptyMessage = "Aucune donnée sur le jour focus.",
}: {
  title: string;
  subtitle?: string;
  rows: MatrixRow[];
  metric?: MatrixMetric;
  emptyMessage?: string;
}) {
  const metricLabel = metric === "quantite_pertinente" ? "Q pert." : "Docs";
  const totalRow =
    rows.length > 0
      ? {
          label: "TOTAL",
          byType: Object.fromEntries(
            DOC_TYPES.map((type) => [
              type,
              {
                amount: rows.reduce(
                  (acc, row) => acc + Number(row.byType[type].amount || 0),
                  0,
                ),
                nb: rows.reduce(
                  (acc, row) => acc + Number(row.byType[type].nb || 0),
                  0,
                ),
                qtyPert: rows.reduce(
                  (acc, row) => acc + Number(row.byType[type].qtyPert || 0),
                  0,
                ),
              },
            ]),
          ) as Record<DocType, { amount: number; nb: number; qtyPert: number }>,
          total: rows.reduce((acc, row) => acc + Number(row.total || 0), 0),
        }
      : null;
  const displayRows = totalRow ? [totalRow, ...rows] : [];

  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      {subtitle ? <div style={styles.sectionSubtitle}>{subtitle}</div> : null}
      <div
        style={styles.denseMatrixTableWrap}
        className="focus-pdf-table-wrap"
      >
        <table
          style={styles.denseMatrixTable}
          className="focus-pdf-dense-matrix-table"
        >
          <DenseMatrixColGroup />
          <thead>
            <tr>
              <th rowSpan={2} style={styles.denseThDimension}>
                Dimension
              </th>
              {DOC_TYPES.map((type) => (
                <th
                  key={`${type}-day-group`}
                  colSpan={2}
                  style={{
                    ...styles.denseThGroup,
                    color: DOC_COLORS[type],
                  }}
                >
                  {type}
                </th>
              ))}
            </tr>
            <tr>
              {DOC_TYPES.flatMap((type) => [
                <th
                  key={`${type}-day-metric`}
                  style={{ ...styles.denseThMetric, color: DOC_COLORS[type] }}
                >
                  {metricLabel}
                </th>,
                <th
                  key={`${type}-day-ca`}
                  style={{ ...styles.denseThMetric, color: DOC_COLORS[type] }}
                >
                  CA
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={styles.emptyCell}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayRows.map((row, index) => {
                const isTotal = index === 0 && row.label === "TOTAL";

                const currentRow = (
                  <tr
                    key={`day-current-${row.label}`}
                    style={isTotal ? styles.totalRow : styles.mtdCurrentRow}
                  >
                    <td
                      style={
                        isTotal
                          ? styles.mtdDimensionCurrentTotal
                          : styles.mtdDimensionCurrent
                      }
                    >
                      <span>{row.label}</span>
                      <span style={styles.mtdPeriodCurrent}>N</span>
                    </td>
                    {DOC_TYPES.flatMap((type) => {
                      const metricValue =
                        metric === "quantite_pertinente"
                          ? row.byType[type].qtyPert
                          : row.byType[type].nb;

                      return [
                        <td
                          key={`${type}-day-metric`}
                          style={{
                            ...(isTotal
                              ? styles.mtdTdCurrentTotal
                              : styles.mtdTdCurrent),
                            color: DOC_COLORS[type],
                          }}
                        >
                          {formatNumber(metricValue)}
                        </td>,
                        <td
                          key={`${type}-day-ca`}
                          style={{
                            ...(isTotal
                              ? styles.mtdTdCurrentTotal
                              : styles.mtdTdCurrent),
                            color: DOC_COLORS[type],
                          }}
                        >
                          {formatMoneyCompact(row.byType[type].amount)}
                        </td>,
                      ];
                    })}
                  </tr>
                );

                const spacerRow = (
                  <tr
                    key={`day-spacer-${row.label}`}
                    style={styles.mtdPreviousRow}
                    aria-hidden="true"
                  >
                    <td
                      style={
                        isTotal
                          ? styles.mtdDimensionPreviousTotal
                          : styles.mtdDimensionPrevious
                      }
                    >
                      {"\u00A0"}
                    </td>
                    {DOC_TYPES.flatMap((type) => [
                      <td
                        key={`${type}-day-spacer-metric`}
                        style={
                          isTotal
                            ? styles.mtdTdPreviousTotal
                            : styles.mtdTdPrevious
                        }
                      >
                        {"\u00A0"}
                      </td>,
                      <td
                        key={`${type}-day-spacer-ca`}
                        style={
                          isTotal
                            ? styles.mtdTdPreviousTotal
                            : styles.mtdTdPrevious
                        }
                      >
                        {"\u00A0"}
                      </td>,
                    ])}
                  </tr>
                );

                return [currentRow, spacerRow];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export function MtdComparisonMatrix({
  title,
  subtitle,
  rows,
  comparisonReady,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  rows: ComparisonRow[];
  comparisonReady: boolean;
  emptyMessage: string;
}) {
  const displayRows = rows.length
    ? [buildTotalComparisonRow(rows, "TOTAL"), ...rows]
    : [];

  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionSubtitle}>{subtitle}</div>
      <div
        style={styles.mtdComparisonTableWrap}
        className="focus-pdf-table-wrap"
      >
        <table
          style={styles.mtdComparisonTable}
          className="focus-pdf-mtd-comparison-table"
        >
          <DenseMatrixColGroup />
          <thead>
            <tr>
              <th rowSpan={2} style={styles.denseThDimension}>
                Dimension / période
              </th>
              {DOC_TYPES.map((type) => (
                <th
                  key={`${type}-group`}
                  colSpan={2}
                  style={{
                    ...styles.denseThGroup,
                    color: DOC_COLORS[type],
                  }}
                >
                  {type}
                </th>
              ))}
            </tr>
            <tr>
              {DOC_TYPES.flatMap((type) => [
                <th
                  key={`${type}-qty`}
                  style={{ ...styles.denseThMetric, color: DOC_COLORS[type] }}
                >
                  Q pert.
                </th>,
                <th
                  key={`${type}-ca`}
                  style={{ ...styles.denseThMetric, color: DOC_COLORS[type] }}
                >
                  CA
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={styles.emptyCell}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayRows.map((row, index) => {
                const isTotal = index === 0 && row.label === "TOTAL";

                const currentRow = (
                  <tr
                    key={`mtd-current-${row.label}`}
                    style={isTotal ? styles.totalRow : styles.mtdCurrentRow}
                  >
                    <td
                      style={
                        isTotal
                          ? styles.mtdDimensionCurrentTotal
                          : styles.mtdDimensionCurrent
                      }
                    >
                      <span>{row.label}</span>
                      <span style={styles.mtdPeriodCurrent}>N</span>
                    </td>
                    {DOC_TYPES.flatMap((type) => {
                      const cell = row.byType[type];
                      return [
                        <td
                          key={`${type}-qty-current`}
                          style={{
                            ...(isTotal
                              ? styles.mtdTdCurrentTotal
                              : styles.mtdTdCurrent),
                            color: DOC_COLORS[type],
                          }}
                        >
                          {formatNumber(cell.qtyPertN)}
                        </td>,
                        <td
                          key={`${type}-ca-current`}
                          style={{
                            ...(isTotal
                              ? styles.mtdTdCurrentTotal
                              : styles.mtdTdCurrent),
                            color: DOC_COLORS[type],
                          }}
                        >
                          {formatMoneyCompact(cell.amountN)}
                        </td>,
                      ];
                    })}
                  </tr>
                );

                const previousRow = (
                  <tr
                    key={`mtd-previous-${row.label}`}
                    style={styles.mtdPreviousRow}
                  >
                    <td
                      style={
                        isTotal
                          ? styles.mtdDimensionPreviousTotal
                          : styles.mtdDimensionPrevious
                      }
                    >
                      N-1
                    </td>
                    {DOC_TYPES.flatMap((type) => {
                      const cell = row.byType[type];
                      return [
                        <td
                          key={`${type}-qty-previous`}
                          style={
                            isTotal
                              ? styles.mtdTdPreviousTotal
                              : styles.mtdTdPrevious
                          }
                        >
                          {comparisonReady ? formatNumber(cell.qtyPertN1) : "…"}
                        </td>,
                        <td
                          key={`${type}-ca-previous`}
                          style={
                            isTotal
                              ? styles.mtdTdPreviousTotal
                              : styles.mtdTdPrevious
                          }
                        >
                          {comparisonReady
                            ? formatMoneyCompact(cell.amountN1)
                            : "…"}
                        </td>,
                      ];
                    })}
                  </tr>
                );

                return [currentRow, previousRow];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export function ActivityByAgencyComparisonTable({
  title,
  subtitle,
  rows,
  emptyMessage,
}: {
  title: string;
  subtitle?: string;
  rows: ComparisonRow[];
  emptyMessage: string;
}) {
  const displayRows = rows.length
    ? [buildTotalComparisonRow(rows, "TOTAL"), ...rows]
    : [];

  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      {subtitle ? <div style={styles.sectionSubtitle}>{subtitle}</div> : null}
      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Dimension</th>
            {DOC_TYPES.flatMap((type) => [
              <th
                key={`${type}-n1`}
                style={{ ...styles.thRight, color: DOC_COLORS[type] }}
              >
                {shortDocLabel(type)} N-1
              </th>,
              <th
                key={`${type}-n`}
                style={{ ...styles.thRight, color: DOC_COLORS[type] }}
              >
                {shortDocLabel(type)} N
              </th>,
              <th
                key={`${type}-evol`}
                style={{ ...styles.thRight, color: DOC_COLORS[type] }}
              >
                Evol {shortDocLabel(type)}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={13} style={styles.emptyCell}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            displayRows.map((row, index) => {
              const isTotal = index === 0 && row.label === "TOTAL";
              return (
                <tr
                  key={`agency-comparison-${row.label}`}
                  style={isTotal ? styles.totalRow : undefined}
                >
                  <td style={isTotal ? styles.tdStrongTotal : styles.tdStrong}>
                    {row.label}
                  </td>
                  {DOC_TYPES.flatMap((type) => {
                    const cell = row.byType[type];
                    const evol = pctEvolution(cell.amountN, cell.amountN1);
                    return [
                      <td
                        key={`${type}-n1`}
                        style={moneyCellStyle(
                          cell.amountN1,
                          DOC_COLORS[type],
                          isTotal,
                        )}
                      >
                        {formatMoneyCompact(cell.amountN1)}
                      </td>,
                      <td
                        key={`${type}-n`}
                        style={moneyCellStyle(
                          cell.amountN,
                          DOC_COLORS[type],
                          isTotal,
                        )}
                      >
                        {formatMoneyCompact(cell.amountN)}
                      </td>,
                      <td
                        key={`${type}-evol`}
                        style={pctCellStyle(evol, isTotal)}
                      >
                        {formatPct(evol)}
                      </td>,
                    ];
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    </div>
  );
}

export function ActivityByFamilyComparisonTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: ComparisonRow[];
  emptyMessage: string;
}) {
  const displayRows = rows.length
    ? [buildTotalComparisonRow(rows, "TOTAL"), ...rows]
    : [];
  const compactHeaderBase: React.CSSProperties = {
    ...styles.thRightCompact,
  };

  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      <div
        style={styles.compactTableWrap}
        className="focus-pdf-family-table-wrap"
      >
        <table
          style={styles.familyComparisonTable}
          className="focus-pdf-family-table"
        >
          <colgroup>
            <col style={{ width: "92px" }} />
            {Array.from({ length: 24 }).map((_, index) => (
              <col key={index} style={{ width: "calc((100% - 92px) / 24)" }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={styles.thCompact}>Dimension</th>
              {DOC_TYPES.flatMap((type) => [
                <th
                  key={`${type}-qty-n1`}
                  style={{ ...compactHeaderBase, color: DOC_COLORS[type] }}
                >
                  {shortDocLabel(type)} Q N-1
                </th>,
                <th
                  key={`${type}-qty-n`}
                  style={{ ...compactHeaderBase, color: DOC_COLORS[type] }}
                >
                  {shortDocLabel(type)} Q N
                </th>,
                <th
                  key={`${type}-qty-evol`}
                  style={{ ...compactHeaderBase, color: DOC_COLORS[type] }}
                >
                  Evol Q
                </th>,
              ])}
              {DOC_TYPES.flatMap((type) => [
                <th
                  key={`${type}-amt-n1`}
                  style={{ ...compactHeaderBase, color: DOC_COLORS[type] }}
                >
                  {shortDocLabel(type)} € N-1
                </th>,
                <th
                  key={`${type}-amt-n`}
                  style={{ ...compactHeaderBase, color: DOC_COLORS[type] }}
                >
                  {shortDocLabel(type)} € N
                </th>,
                <th
                  key={`${type}-amt-evol`}
                  style={{ ...compactHeaderBase, color: DOC_COLORS[type] }}
                >
                  Evol €
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={25} style={styles.emptyCell}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayRows.map((row, index) => {
                const isTotal = index === 0 && row.label === "TOTAL";
                return (
                  <tr
                    key={`family-comparison-${row.label}`}
                    style={isTotal ? styles.totalRow : undefined}
                  >
                    <td
                      style={
                        isTotal
                          ? styles.tdStrongTotalCompact
                          : styles.tdStrongCompact
                      }
                    >
                      {row.label}
                    </td>
                    {DOC_TYPES.flatMap((type) => {
                      const cell = row.byType[type];
                      const evol = pctEvolution(cell.qtyPertN, cell.qtyPertN1);
                      return [
                        <td
                          key={`${type}-qty-n1`}
                          style={qtyCellStyle(
                            cell.qtyPertN1,
                            DOC_COLORS[type],
                            isTotal,
                            true,
                          )}
                        >
                          {formatNumber(cell.qtyPertN1)}
                        </td>,
                        <td
                          key={`${type}-qty-n`}
                          style={qtyCellStyle(
                            cell.qtyPertN,
                            DOC_COLORS[type],
                            isTotal,
                            true,
                          )}
                        >
                          {formatNumber(cell.qtyPertN)}
                        </td>,
                        <td
                          key={`${type}-qty-evol`}
                          style={pctCellStyle(evol, isTotal, true)}
                        >
                          {formatPct(evol)}
                        </td>,
                      ];
                    })}
                    {DOC_TYPES.flatMap((type) => {
                      const cell = row.byType[type];
                      const evol = pctEvolution(cell.amountN, cell.amountN1);
                      return [
                        <td
                          key={`${type}-amt-n1`}
                          style={moneyCellStyle(
                            cell.amountN1,
                            DOC_COLORS[type],
                            isTotal,
                            true,
                          )}
                        >
                          {formatMoneyCompact(cell.amountN1)}
                        </td>,
                        <td
                          key={`${type}-amt-n`}
                          style={moneyCellStyle(
                            cell.amountN,
                            DOC_COLORS[type],
                            isTotal,
                            true,
                          )}
                        >
                          {formatMoneyCompact(cell.amountN)}
                        </td>,
                        <td
                          key={`${type}-amt-evol`}
                          style={pctCellStyle(evol, isTotal, true)}
                        >
                          {formatPct(evol)}
                        </td>,
                      ];
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Rolling12ComparisonTable({
  title,
  subtitle,
  rows,
  emptyMessage,
}: {
  title: string;
  subtitle?: string;
  rows: ComparisonRow[];
  emptyMessage: string;
}) {
  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      {subtitle ? <div style={styles.sectionSubtitle}>{subtitle}</div> : null}
      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Dimension</th>
            {DOC_TYPES.flatMap((type) => [
              <th
                key={`${type}-n1`}
                style={{ ...styles.thRight, color: DOC_COLORS[type] }}
              >
                {shortDocLabel(type)} N-1
              </th>,
              <th
                key={`${type}-n`}
                style={{ ...styles.thRight, color: DOC_COLORS[type] }}
              >
                {shortDocLabel(type)} N
              </th>,
              <th
                key={`${type}-evol`}
                style={{ ...styles.thRight, color: DOC_COLORS[type] }}
              >
                Evol {shortDocLabel(type)}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={13} style={styles.emptyCell}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const isTotal = index === 0 && row.label.startsWith("TOTAL");
              return (
                <tr
                  key={`rolling-comparison-${row.label}`}
                  style={isTotal ? styles.totalRow : undefined}
                >
                  <td style={isTotal ? styles.tdStrongTotal : styles.tdStrong}>
                    {row.label}
                  </td>
                  {DOC_TYPES.flatMap((type) => {
                    const cell = row.byType[type];
                    const evol = pctEvolution(cell.amountN, cell.amountN1);
                    return [
                      <td
                        key={`${type}-n1`}
                        style={moneyCellStyle(
                          cell.amountN1,
                          DOC_COLORS[type],
                          isTotal,
                        )}
                      >
                        {formatMoneyCompact(cell.amountN1)}
                      </td>,
                      <td
                        key={`${type}-n`}
                        style={moneyCellStyle(
                          cell.amountN,
                          DOC_COLORS[type],
                          isTotal,
                        )}
                      >
                        {formatMoneyCompact(cell.amountN)}
                      </td>,
                      <td
                        key={`${type}-evol`}
                        style={pctCellStyle(evol, isTotal)}
                      >
                        {formatPct(evol)}
                      </td>,
                    ];
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    </div>
  );
}

export function AgencyPortfolioTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: AgencyPortfolioRow[];
  emptyMessage?: string;
}) {
  const totalRow = useMemo<AgencyPortfolioRow | null>(() => {
    if (!rows.length) return null;
    return {
      label: "TOTAL",
      cdc: sum(rows, (row) => row.cdc),
      cdcLivMx: sum(rows, (row) => row.cdcLivMx),
      pl: sum(rows, (row) => row.pl),
      plLivMPlus: sum(rows, (row) => row.plLivMPlus),
      brMx: sum(rows, (row) => row.brMx),
      brM: sum(rows, (row) => row.brM),
      blMx: sum(rows, (row) => row.blMx),
      blM: sum(rows, (row) => row.blM),
      total: sum(rows, (row) => row.total),
    };
  }, [rows]);

  const displayRows = totalRow ? [totalRow, ...rows] : rows;

  const moneyCellStyle = (
    value: number,
    color: string,
    isTotal = false,
  ): React.CSSProperties => ({
    ...(isTotal ? styles.tdRightTotal : styles.tdRight),
    color: value < 0 ? "#b91c1c" : color,
    fontWeight: isTotal ? 950 : 900,
  });

  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionSubtitle}>
        Base activité non facturée : CDC, PL, BL et BR ventilés par agence. Les
        colonnes “dont” utilisent le champ date_livraison d’activite_lignes.
      </div>

      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Dimension</th>
            <th style={styles.thRight}>CDC €</th>
            <th style={styles.thRight}>dont CDC liv M-x</th>
            <th style={styles.thRight}>PL €</th>
            <th style={styles.thRight}>dont PL liv M+x</th>
            <th style={styles.thRight}>BL/BR M-x</th>
            <th style={styles.thRight}>BL/BR M</th>
            <th style={styles.thRight}>Total €</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={8} style={styles.emptyCell}>
                {emptyMessage || "Aucune donnée sur le périmètre."}
              </td>
            </tr>
          ) : (
            displayRows.map((row, index) => {
              const isTotal = index === 0 && row.label === "TOTAL";

              return (
                <tr
                  key={row.label}
                  style={isTotal ? styles.totalRow : undefined}
                >
                  <td style={isTotal ? styles.tdStrongTotal : styles.tdStrong}>
                    {row.label}
                  </td>

                  <td style={moneyCellStyle(row.cdc, DOC_COLORS.CDC, isTotal)}>
                    {formatMoneyCompact(row.cdc)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.cdcLivMx,
                      DOC_COLORS.CDC,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.cdcLivMx)}
                  </td>
                  <td style={moneyCellStyle(row.pl, DOC_COLORS.BL, isTotal)}>
                    {formatMoneyCompact(row.pl)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.plLivMPlus,
                      DOC_COLORS.BL,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.plLivMPlus)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.blMx + row.brMx,
                      DOC_COLORS.BL,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.blMx + row.brMx)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.blM + row.brM,
                      DOC_COLORS.BL,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.blM + row.brM)}
                  </td>
                  <td style={moneyCellStyle(row.total, "#0f172a", isTotal)}>
                    {formatMoneyCompact(row.total)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    </div>
  );
}

export function AgencyProjectionTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: AgencyProjectionRow[];
  emptyMessage?: string;
}) {
  const totalRow = useMemo<AgencyProjectionRow | null>(() => {
    if (!rows.length) return null;

    const blBrMx = sum(rows, (row) => row.blBrMx);
    const blBrM = sum(rows, (row) => row.blBrM);
    const factures = sum(rows, (row) => row.factures);
    const projectionFluxBl = sum(rows, (row) => row.projectionFluxBl);
    const valeurBlNf3Pct = sum(rows, (row) => row.valeurBlNf3Pct);
    const projectionCa = sum(rows, (row) => row.projectionCa);
    const caN1 = sum(rows, (row) => row.caN1);

    return {
      label: "TOTAL",
      blBrMx,
      blBrM,
      factures,
      projectionFluxBl,
      valeurBlNf3Pct,
      projectionCa,
      caN1,
      evolPct: caN1 ? ((projectionCa - caN1) / Math.abs(caN1)) * 100 : null,
    };
  }, [rows]);

  const displayRows = totalRow ? [totalRow, ...rows] : rows;

  const moneyCellStyle = (
    value: number,
    color: string,
    isTotal = false,
  ): React.CSSProperties => ({
    ...(isTotal ? styles.tdRightTotal : styles.tdRight),
    color: value < 0 ? "#b91c1c" : color,
    fontWeight: isTotal ? 950 : 900,
  });

  const pctCellStyle = (
    value: number | null | undefined,
    isTotal = false,
  ): React.CSSProperties => ({
    ...(isTotal ? styles.tdRightTotal : styles.tdRight),
    color:
      value === null || value === undefined
        ? "#64748b"
        : value < 0
          ? "#b91c1c"
          : "#166534",
    fontWeight: isTotal ? 950 : 900,
  });

  return (
    <div style={styles.sectionCard} className="focus-pdf-section-card">
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionSubtitle}>
        BL/BR non facturés + Factures à date + Projection du flux BL restant(BL
        à venir) – 4% de BL non facturés(BL NF 4%).
      </div>

      <Table>
        <thead>
          <tr>
            <th style={styles.th}>Dimension</th>
            <th style={styles.thRight}>BL/BR M-x</th>
            <th style={styles.thRight}>BL/BR M</th>
            <th style={styles.thRight}>Factures €</th>
            <th style={styles.thRight}>BL à venir</th>
            <th style={styles.thRight}>BL NF 4%</th>
            <th style={styles.thRight}>Proj. CA</th>
            <th style={styles.thRight}>CA N-1</th>
            <th style={styles.thRight}>Evol.</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={9} style={styles.emptyCell}>
                {emptyMessage || "Aucune donnée sur le périmètre."}
              </td>
            </tr>
          ) : (
            displayRows.map((row, index) => {
              const isTotal = index === 0 && row.label === "TOTAL";

              return (
                <tr
                  key={row.label}
                  style={isTotal ? styles.totalRow : undefined}
                >
                  <td style={isTotal ? styles.tdStrongTotal : styles.tdStrong}>
                    {row.label}
                  </td>

                  <td
                    style={moneyCellStyle(row.blBrMx, DOC_COLORS.BL, isTotal)}
                  >
                    {formatMoneyCompact(row.blBrMx)}
                  </td>
                  <td style={moneyCellStyle(row.blBrM, DOC_COLORS.BL, isTotal)}>
                    {formatMoneyCompact(row.blBrM)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.factures,
                      DOC_COLORS.Factures,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.factures)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.projectionFluxBl,
                      DOC_COLORS.BL,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.projectionFluxBl)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.valeurBlNf3Pct,
                      "#b91c1c",
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.valeurBlNf3Pct)}
                  </td>
                  <td
                    style={moneyCellStyle(
                      row.projectionCa,
                      DOC_COLORS.Factures,
                      isTotal,
                    )}
                  >
                    {formatMoneyCompact(row.projectionCa)}
                  </td>
                  <td style={moneyCellStyle(row.caN1, "#0f172a", isTotal)}>
                    {formatMoneyCompact(row.caN1)}
                  </td>
                  <td style={pctCellStyle(row.evolPct, isTotal)}>
                    {formatPct(row.evolPct)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>
    </div>
  );
}

export const styles: Record<string, React.CSSProperties> = {
  reportBrandHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    background: "#ffffff",
    padding: "7px 12px 9px",
    borderBottom: "1px solid #e5e7eb",
  },
  reportBrandLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  reportLogo: {
    width: 98,
    height: "auto",
    objectFit: "contain",
    flexShrink: 0,
  },
  reportBrandTextBlock: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minWidth: 0,
  },
  reportBrandSubtitle: {
    fontSize: 13,
    fontWeight: 650,
    color: "#2d3748",
    lineHeight: 1.12,
    whiteSpace: "nowrap",
  },
  reportBrandTitle: {
    fontSize: 17,
    fontWeight: 950,
    color: "#111827",
    lineHeight: 1.12,
    whiteSpace: "nowrap",
  },
  reportMainTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: 950,
    color: "#17344d",
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  },
  reportMainTitleDate: {
    color: "#dc2626",
    fontWeight: 950,
  },
  reportBrandRightSpacer: {
    width: 260,
    flexShrink: 0,
  },
  filterDisplayValue: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "9px 10px",
    background: "#fff",
    fontWeight: 800,
    minWidth: 0,
    minHeight: 20,
  },
  page: { padding: 20, color: "#0f172a" },
  headerCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid #e2e8f0",
    borderRadius: 22,
    padding: 18,
    boxShadow: "0 10px 28px rgba(15,23,42,0.06)",
    marginBottom: 14,
  },
  title: { margin: 0, fontSize: 26, fontWeight: 900 },
  titleDate: { color: "#dc2626", fontWeight: 950 },
  subtitle: {
    marginTop: 6,
    color: "#64748b",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.45,
  },
  subtitleBasisNote: { color: "#64748b", fontSize: 12, fontWeight: 700 },
  focusDayText: { color: "#0f172a", fontSize: 15, fontWeight: 950 },
  headerActions: { display: "flex", gap: 8, alignItems: "center" },
  filtersCard: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(150px, 1fr))",
    gap: 12,
    background: "rgba(248,250,252,0.96)",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: {
    fontSize: 12,
    fontWeight: 900,
    color: "#475569",
    textTransform: "uppercase",
  },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "9px 10px",
    background: "#fff",
    fontWeight: 800,
    minWidth: 0,
  },
  lockedInput: {
    background: "#f1f5f9",
    color: "#64748b",
    cursor: "not-allowed",
  },
  accessBadge: {
    border: "1px solid #facc15",
    background: "#fffbeb",
    color: "#7c2d12",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 14,
    fontSize: 13,
    fontWeight: 900,
  },
  warningButton: {
    border: "1px solid #d97706",
    background: "#f59e0b",
    color: "#111827",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 900,
    cursor: "pointer",
  },

  primaryButton: {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#fff",
    borderRadius: 10,
    padding: "9px 13px",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    borderRadius: 10,
    padding: "9px 13px",
    fontWeight: 900,
    cursor: "pointer",
  },
  successBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: "#dcfce7",
    border: "1px solid #86efac",
    color: "#166534",
    fontWeight: 800,
  },

  errorBox: {
    background: "#fef2f2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    fontWeight: 900,
  },
  infoBox: {
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    fontWeight: 900,
  },
  progressText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: 850,
    color: "#1e40af",
  },
  neutralBox: {
    background: "#f8fafc",
    color: "#334155",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    fontWeight: 800,
  },
  reportCard: {
    background: "rgba(255,255,255,0.96)",
    border: "1px solid #dbeafe",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    boxShadow: "0 8px 22px rgba(15,23,42,0.06)",
  },
  reportCardCollapsed: {
    padding: "9px 12px",
  },
  reportHeadingGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  reportCollapsedLine: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 750,
  },
  reportStatusPill: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 950,
  },
  reportToggleButton: {
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#0f172a",
    borderRadius: 10,
    padding: "8px 11px",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  reportHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  reportTitle: {
    fontSize: 16,
    fontWeight: 950,
    color: "#0f172a",
    marginBottom: 4,
  },
  reportSubtitle: {
    fontSize: 12,
    fontWeight: 750,
    color: "#64748b",
    lineHeight: 1.45,
  },
  reportActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  },
  reportFormRow: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
    gap: 12,
    alignItems: "end",
  },
  reportField: { display: "flex", flexDirection: "column", gap: 5 },
  reportInput: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    fontWeight: 800,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  reportPathBox: {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "9px 11px",
    background: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  },
  reportPathLabel: {
    fontSize: 11,
    fontWeight: 950,
    color: "#64748b",
    textTransform: "uppercase",
  },
  reportPathText: {
    fontSize: 12,
    fontWeight: 850,
    color: "#0f172a",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  kpiCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 8px 22px rgba(15,23,42,0.06)",
  },
  kpiHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  docPill: {
    borderRadius: 999,
    padding: "5px 9px",
    fontWeight: 900,
    fontSize: 12,
  },
  smallDocPill: { fontWeight: 900 },
  evoPill: {
    borderRadius: 999,
    padding: "5px 8px",
    fontWeight: 900,
    fontSize: 12,
  },
  mtdBasisPill: {
    borderRadius: 999,
    padding: "5px 8px",
    fontWeight: 900,
    fontSize: 11,
    color: "#075985",
    background: "#e0f2fe",
    border: "1px solid #bae6fd",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "72%",
  },
  kpiValuesGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    alignItems: "center",
    marginTop: 8,
  },
  kpiValuesGridMtd: {
    display: "grid",
    // Environ 45 % pour Jour et 55 % pour Month to date :
    // le séparateur est déplacé vers la droite pour laisser les montants Jour
    // sur une seule ligne, même aux résolutions intermédiaires.
    gridTemplateColumns: "minmax(145px, 0.9fr) minmax(0, 1.1fr)",
    gap: 12,
    alignItems: "start",
    marginTop: 8,
  },
  kpiValueBlockLeft: {
    textAlign: "center",
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "18px 44px 25px",
    alignItems: "center",
    alignSelf: "stretch",
    paddingRight: 2,
  },
  kpiMtdBlock: {
    minWidth: 0,
    borderLeft: "1px solid #e2e8f0",
    paddingLeft: 13,
    display: "block",
    alignSelf: "stretch",
  },
  kpiMtdMetric: {
    background: "transparent",
    minWidth: 0,
    width: "100%",
    display: "grid",
    gridTemplateRows: "18px 44px 25px",
    justifyItems: "end",
    alignItems: "center",
    textAlign: "right",
  },
  kpiMtdMetricTop: {
    display: "block",
  },
  kpiMtdMetricBottom: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    width: "100%",
    minWidth: 0,
  },
  kpiMtdMetricLabel: {
    width: "100%",
    fontSize: 11,
    lineHeight: "18px",
    fontWeight: 950,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    textAlign: "right",
  },
  kpiMtdMetricCurrent: {
    width: "100%",
    fontSize: 36,
    lineHeight: 1,
    fontWeight: 950,
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  kpiMtdMetricPrevious: {
    fontSize: 19,
    lineHeight: 1.1,
    fontWeight: 900,
    color: "#475569",
    whiteSpace: "nowrap",
  },
  mtdEvolutionBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 62,
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11.5,
    lineHeight: 1.1,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  kpiValueBlockRight: { textAlign: "center", minWidth: 0 },
  kpiValueLabel: {
    fontSize: 11,
    lineHeight: "18px",
    fontWeight: 950,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: 0,
  },
  kpiMain: {
    fontSize: 36,
    lineHeight: 1,
    fontWeight: 950,
    margin: 0,
    whiteSpace: "nowrap",
  },
  kpiSub: {
    fontSize: 13,
    color: "#475569",
    fontWeight: 800,
    marginTop: 10,
    marginBottom: 0,
  },
  kpiValueSub: {
    fontSize: 12,
    lineHeight: 1.1,
    color: "#64748b",
    fontWeight: 850,
  },
  kpiMeta: { fontSize: 12, color: "#64748b", marginTop: 5 },
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 14,
  },
  chartBox: {
    position: "relative",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 8px 22px rgba(15,23,42,0.06)",
    minWidth: 0,
  },
  chartTitle: { fontSize: 15, fontWeight: 900, marginBottom: 8 },
  chartSvg: { width: "100%", height: 260, display: "block" },

  chartTooltip: {
    position: "absolute",
    zIndex: 20,
    minWidth: 190,
    pointerEvents: "none",
    background: "rgba(255,255,255,0.98)",
    border: "2px solid #0f172a",
    borderRadius: 12,
    padding: "8px 10px",
    boxShadow: "0 14px 32px rgba(15,23,42,0.18)",
    fontSize: 12,
    fontWeight: 800,
    color: "#0f172a",
  },
  tooltipDoc: {
    fontSize: 12,
    fontWeight: 950,
    marginBottom: 3,
  },
  tooltipValue: {
    fontSize: 15,
    fontWeight: 950,
    marginTop: 3,
  },
  legendRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 6,
  },
  legendItem: {
    display: "inline-flex",
    gap: 6,
    alignItems: "center",
    fontSize: 12,
    fontWeight: 900,
    color: "#475569",
  },
  legendDot: { width: 10, height: 10, borderRadius: "50%" },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 14,
  },
  wideSectionStack: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 14,
    marginBottom: 14,
  },
  optionCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 8px 22px rgba(15,23,42,0.06)",
    marginBottom: 14,
  },
  checkboxLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 950,
    cursor: "pointer",
  },
  checkboxInput: { width: 16, height: 16, cursor: "pointer" },
  optionHelp: {
    marginTop: 6,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 750,
    lineHeight: 1.45,
  },
  highlightsGrid: { display: "grid", gridTemplateColumns: "1fr", gap: 14 },
  sectionCard: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 8px 22px rgba(15,23,42,0.06)",
    minWidth: 0,
  },
  sectionTitle: { fontSize: 16, fontWeight: 950, marginBottom: 10 },
  sectionSubtitle: {
    marginTop: -4,
    marginBottom: 10,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.45,
  },
  tableWrap: {
    overflow: "auto",
    maxWidth: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    minWidth: 760,
  },
  compactTableWrap: {
    overflowX: "hidden",
    overflowY: "visible",
    maxWidth: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
  },
  denseMatrixTableWrap: {
    overflowX: "hidden",
    overflowY: "visible",
    width: "100%",
    maxWidth: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
  },
  denseMatrixTable: {
    width: "100%",
    minWidth: 0,
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: 10.5,
  },
  mtdComparisonTableWrap: {
    overflowX: "hidden",
    overflowY: "visible",
    width: "100%",
    maxWidth: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
  },
  mtdComparisonTable: {
    width: "100%",
    minWidth: 0,
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: 10.5,
  },
  denseThDimension: {
    background: "#f1f5f9",
    color: "#0f172a",
    borderBottom: "1px solid #cbd5e1",
    padding: "6px 7px",
    textAlign: "left",
    verticalAlign: "middle",
    fontWeight: 950,
    lineHeight: 1.05,
  },
  denseThGroup: {
    background: "#f1f5f9",
    borderBottom: "1px solid #cbd5e1",
    padding: "5px 3px 3px",
    textAlign: "center",
    fontWeight: 950,
    whiteSpace: "nowrap",
    lineHeight: 1.05,
  },
  denseThMetric: {
    background: "#f8fafc",
    borderBottom: "1px solid #cbd5e1",
    padding: "3px 2px 5px",
    textAlign: "right",
    fontWeight: 900,
    whiteSpace: "nowrap",
    lineHeight: 1.05,
    fontSize: 9.5,
  },
  denseTdDimension: {
    borderBottom: "1px solid #e2e8f0",
    padding: "5px 7px",
    fontWeight: 900,
    color: "#0f172a",
    lineHeight: 1.08,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  denseTdDimensionTotal: {
    borderBottom: "2px solid #cbd5e1",
    padding: "5px 7px",
    fontWeight: 950,
    color: "#0f172a",
    lineHeight: 1.08,
    whiteSpace: "nowrap",
  },
  denseTdValue: {
    borderBottom: "1px solid #e2e8f0",
    padding: "5px 3px",
    textAlign: "right",
    fontWeight: 900,
    lineHeight: 1.08,
    whiteSpace: "nowrap",
  },
  denseTdValueTotal: {
    borderBottom: "2px solid #cbd5e1",
    padding: "5px 3px",
    textAlign: "right",
    fontWeight: 950,
    lineHeight: 1.08,
    whiteSpace: "nowrap",
  },
  mtdCurrentRow: {
    background: "#ffffff",
  },
  mtdPreviousRow: {
    background: "#f8fafc",
  },
  mtdDimensionCurrent: {
    borderBottom: "1px solid #e2e8f0",
    padding: "5px 7px 3px",
    fontWeight: 950,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
    whiteSpace: "nowrap",
    overflow: "hidden",
  },
  mtdDimensionCurrentTotal: {
    borderBottom: "1px solid #cbd5e1",
    padding: "5px 7px 3px",
    fontWeight: 950,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
    whiteSpace: "nowrap",
  },
  mtdPeriodCurrent: {
    flexShrink: 0,
    borderRadius: 999,
    background: "#e2e8f0",
    color: "#475569",
    padding: "1px 5px",
    fontSize: 9,
    fontWeight: 950,
  },
  mtdDimensionPrevious: {
    borderBottom: "2px solid #e2e8f0",
    padding: "3px 7px 5px",
    textAlign: "right",
    color: "#475569",
    fontSize: 11.5,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  mtdDimensionPreviousTotal: {
    borderBottom: "2px solid #cbd5e1",
    padding: "3px 7px 5px",
    textAlign: "right",
    color: "#334155",
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  mtdTdCurrent: {
    borderBottom: "1px solid #e2e8f0",
    padding: "5px 3px 3px",
    textAlign: "right",
    fontSize: 11,
    lineHeight: 1.05,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  mtdTdCurrentTotal: {
    borderBottom: "1px solid #cbd5e1",
    padding: "5px 3px 3px",
    textAlign: "right",
    fontSize: 11.5,
    lineHeight: 1.05,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  mtdTdPrevious: {
    borderBottom: "2px solid #e2e8f0",
    padding: "3px 3px 5px",
    textAlign: "right",
    color: "#475569",
    fontSize: 11,
    lineHeight: 1.05,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  mtdTdPreviousTotal: {
    borderBottom: "2px solid #cbd5e1",
    padding: "3px 3px 5px",
    textAlign: "right",
    color: "#334155",
    fontSize: 11.5,
    lineHeight: 1.05,
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  familyComparisonTable: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: 10,
  },
  th: {
    background: "#f1f5f9",
    color: "#0f172a",
    borderBottom: "1px solid #e2e8f0",
    padding: "8px 9px",
    textAlign: "left",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  thRight: {
    background: "#f1f5f9",
    color: "#0f172a",
    borderBottom: "1px solid #e2e8f0",
    padding: "8px 9px",
    textAlign: "right",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  thCompact: {
    background: "#f1f5f9",
    color: "#0f172a",
    borderBottom: "1px solid #e2e8f0",
    padding: "5px 4px",
    textAlign: "left",
    fontWeight: 950,
    whiteSpace: "normal",
    lineHeight: 1.05,
  },
  thRightCompact: {
    background: "#f1f5f9",
    color: "#0f172a",
    borderBottom: "1px solid #e2e8f0",
    padding: "5px 3px",
    textAlign: "right",
    fontWeight: 950,
    whiteSpace: "normal",
    lineHeight: 1.05,
  },
  td: {
    borderBottom: "1px solid #f1f5f9",
    padding: "7px 9px",
    color: "#0f172a",
    whiteSpace: "nowrap",
  },
  tdStrong: {
    borderBottom: "1px solid #f1f5f9",
    padding: "7px 9px",
    color: "#0f172a",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  tdRight: {
    borderBottom: "1px solid #f1f5f9",
    padding: "7px 9px",
    textAlign: "right",
    color: "#0f172a",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  tdStrongCompact: {
    borderBottom: "1px solid #f1f5f9",
    padding: "5px 4px",
    color: "#0f172a",
    fontWeight: 900,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  tdRightCompact: {
    borderBottom: "1px solid #f1f5f9",
    padding: "5px 3px",
    textAlign: "right",
    color: "#0f172a",
    fontWeight: 800,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "clip",
  },
  totalRow: { background: "#f8fafc" },
  tdStrongTotal: {
    borderBottom: "2px solid #cbd5e1",
    padding: "8px 9px",
    color: "#0f172a",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  tdRightTotal: {
    borderBottom: "2px solid #cbd5e1",
    padding: "8px 9px",
    textAlign: "right",
    color: "#0f172a",
    fontWeight: 950,
    whiteSpace: "nowrap",
  },
  tdStrongTotalCompact: {
    borderBottom: "2px solid #cbd5e1",
    padding: "5px 4px",
    color: "#0f172a",
    fontWeight: 950,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  tdRightTotalCompact: {
    borderBottom: "2px solid #cbd5e1",
    padding: "5px 3px",
    textAlign: "right",
    color: "#0f172a",
    fontWeight: 950,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "clip",
  },
  emptyCell: {
    padding: 18,
    textAlign: "center",
    color: "#64748b",
    fontWeight: 900,
  },
};

export default function FocusMensuelPage() {
  return (
    <Suspense
      fallback={<div style={{ padding: 24 }}>Chargement du focus mensuel…</div>}
    >
      <FocusMensuelPageContent />
    </Suspense>
  );
}