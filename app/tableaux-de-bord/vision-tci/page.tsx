"use client";

// app/tableaux-de-bord/vision-tci/page.tsx (Vision ONE PAGE)
//
// VISION ONE PAGE BIS — page de travail pour la mise en forme.
//
// V2 (2026-11-10 après-midi) :
//  - Lisible en sombre : les graphes sont posés sur --cg-panel (foncé en
//    sombre, blanc en clair) au lieu de --cg-card (papier dans les deux
//    thèmes), encre / légendes / axes suivent --cg-ink.
//  - Grille de widgets libre, comme Vision ONE PAGE : on ajoute les graphes
//    par familles (BL, Factures, CDC, Devis, Portefeuille CDC) ET tous les
//    pavés de la page d'origine (flux, compteurs, taux, portefeuille,
//    projection, espaces vides). Ordre au glisser-déposer (poignée ⠿) ou
//    aux flèches, largeur réglable (1/4, 1/2, 3/4, pleine largeur) — dans
//    la zone des 2/3.
//  - Disposition enregistrée par utilisateur en base
//    (vision_tci_bis_preferences) — premier affichage : les graphes par
//    familles puis la disposition actuelle de Vision ONE PAGE.
//  - Chaque graphe flux garde les 3 métriques Jour / Mois (MTD) / Année
//    (YTD) avec l'évolution vs N-1 (get_vision_tci_kpi, comme les pavés
//    flux d'origine ; bascule Jour / J-1 en en-tête).
//
// V3 (2026-11-10) — remplace Vision ONE PAGE (/tableaux-de-bord/vision-tci) :
//  - colonne agenda / todo alignée sur le haut des widgets, collante sous le
//    bandeau et à la hauteur de l'écran (mesurée, valable pour tous les
//    écrans) : seule la zone des widgets défile ;
//  - disposition commune (vision_tci_bis_defaut) imposée par un
//    administrateur (« Imposer à tous »), chacun peut ensuite la modifier et
//    y revenir (« Disposition par défaut ») ;
//  - clic sur le titre ou les métriques : CDC / BL / Factures -> Activité
//    quotidienne, Devis -> Analyse devis, Portefeuille CDC -> Portefeuille
//    de commandes (nouvel onglet, comme les pavés d'origine) ;
//  - correctif : la disposition n'était pas enregistrée (requête Supabase
//    jamais exécutée).
//
// V1 : 3 modes par graphe (Mensuel N + N-1 fin et terne / Cumulé + N-1
// toutes familles / Base 100 + panneau YtD, clic mois), portefeuille CDC
// hebdo par famille (empilé E / petits multiples F), agenda et todo compacts
// dans le 1/3 droit.
//
// Données : get_vision_bis_flux_familles, get_vision_bis_portefeuille_cdc,
// get_vision_tci_kpi ; périmètre agence / collaborateur du profil
// (usePageFilterAccess) sinon sélecteurs libres.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ComposedChart,
} from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { usePageFilterAccess } from "@/lib/pageAccessFilters";
import { useViewport } from "@/lib/useViewport";
import MobileStandaloneActivite from "@/components/mobile/MobileStandaloneActivite";
import OutlookAgenda from "@/components/OutlookAgenda";
import TodoDenseList from "@/components/TodoDenseList";
import LastSyncBadge from "@/components/LastSyncBadge";
import { useAccess } from "@/components/AccessContext";
import {
  AjouterKpiForm, CompteurCard, FamilleMacroFiltreRow, FluxCard, FluxCardGrand, PortefeuilleCard,
  ProjectionCard, RetardsPaiementCard, SpacerCard, TauxCard,
  type KpiCardConfig,
} from "@/components/VisionTciKpiPanel";

// ─── Constantes ──────────────────────────────────────────────────────────

type DocType = "BL" | "Factures" | "CDC" | "Devis";
type CardKey = DocType | "PORTEFEUILLE";
type Mode = "mensuel" | "cumul" | "base100";

const CARDS: { key: CardKey; label: string; color: string }[] = [
  { key: "CDC", label: "Commandes (CDC)", color: "#C1683C" },
  { key: "BL", label: "Livraisons (BL)", color: "#4B92AC" },
  { key: "Factures", label: "Factures", color: "#3F9142" },
  { key: "Devis", label: "Devis", color: "#D69A4A" },
  { key: "PORTEFEUILLE", label: "Portefeuille CDC", color: "#7A5EA8" },
];

const FAMILLE_COLORS: Record<string, string> = {
  "R/R": "#4C8FD6",
  "R/O": "#C9A24A",
  ACC: "#E07A3F",
  PV: "#8E7BD6",
  DRV: "#3FA58A",
  ECS: "#D25C7E",
  R_ZONE: "#5BB8C9",
  SAV: "#B08968",
  Autres: "#7A8494",
};
const EXTRA_COLORS = ["#9C6ADE", "#6DBE6A", "#E0B04A", "#4AA3B8", "#C46A9A"];
function familleColor(f: string, i = 0) {
  return FAMILLE_COLORS[f] || EXTRA_COLORS[i % EXTRA_COLORS.length];
}

// Écran ouvert au clic sur le titre / les métriques d'un graphe.
const LIENS: Record<CardKey, { href: string; libelle: string }> = {
  CDC: { href: "/focus_mensuel2", libelle: "Activité quotidienne" },
  BL: { href: "/focus_mensuel2", libelle: "Activité quotidienne" },
  Factures: { href: "/focus_mensuel2", libelle: "Activité quotidienne" },
  Devis: { href: "/cycle-documents", libelle: "Analyse devis" },
  PORTEFEUILLE: { href: "/portefeuille-livraison", libelle: "Portefeuille de commandes" },
};
function ouvrir(k: CardKey) {
  window.open(LIENS[k].href, "_blank", "noopener,noreferrer");
}

const MOIS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

const GRID = "rgba(var(--cg-ink-rgb), 0.12)";
const AXIS = "rgba(var(--cg-ink-rgb), 0.6)";

// Périmètre transmis aux métriques Jour / MTD / YTD des graphes.
type KpiScope = { agence: string | null; collaborateur: string | null; familleMacro: string | null; jMoins1: boolean; refreshTick: number };

// ─── Utilitaires ─────────────────────────────────────────────────────────

function fmtEur(v: number | null | undefined, digits = 1): string {
  const n = Number(v || 0);
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })} M€`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k€`;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}
function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}
function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}
function evol(n: number, p: number): number | null {
  return p ? (n - p) / Math.abs(p) : null;
}

// ─── Types de données ────────────────────────────────────────────────────

type FluxRow = { type_document: DocType; annee: number; mois: number; famille_macro: string; montant: number; montant_a_date: number };
type PfRow = { semaine: string; annee_iso: number; semaine_iso: number; famille_macro: string; montant: number; calcule_at: string | null };

// Regroupe les familles : top N (sur le cumul N à date) + "Autres".
function topFamilles(rows: { famille_macro: string; montant: number }[], n: number): string[] {
  const tot = new Map<string, number>();
  rows.forEach((r) => tot.set(r.famille_macro, (tot.get(r.famille_macro) || 0) + Number(r.montant || 0)));
  return Array.from(tot.entries())
    .filter(([f]) => f !== "AUTRES")
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([f]) => f);
}
function bucket(f: string, top: string[]) {
  return top.includes(f) ? f : "Autres";
}

// ─── Petits composants UI ────────────────────────────────────────────────

function Segmented<T extends string>({
  value, options, onChange, color,
}: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; color: string }) {
  return (
    <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: GRID }}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className="px-2.5 py-1 text-[11px] font-bold transition"
            style={{
              background: active ? `${color}33` : "transparent",
              color: active ? color : "rgba(var(--cg-ink-rgb),0.62)",
            }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ familles, n1Label }: { familles: string[]; n1Label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
      {familles.map((f, i) => (
        <span key={f} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: familleColor(f, i) }} />
          {f}
        </span>
      ))}
      {n1Label && (
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--cg-ink)" }} />
          {n1Label}
        </span>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label, familles, kind }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload || {};
  const lignes = familles.map((f: string, i: number) => ({
    f, c: familleColor(f, i),
    n: Number(row[`N_${f}`] ?? 0),
    p: Number(row[`P_${f}`] ?? 0),
  }));
  const totN = Number(row.totN ?? lignes.reduce((s: number, l: any) => s + l.n, 0));
  const totP = Number(row.totP ?? lignes.reduce((s: number, l: any) => s + l.p, 0));
  return (
    <div className="rounded-lg border px-3 py-2 text-[11px] shadow-lg" style={{ background: "var(--cg-panel)", borderColor: GRID, color: "var(--cg-ink)" }}>
      <div className="mb-1 font-bold">{label}{kind ? ` · ${kind}` : ""}</div>
      <table className="tabular-nums">
        <thead>
          <tr style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
            <th className="pr-3 text-left font-semibold">Famille</th>
            <th className="pr-3 text-right font-semibold">N</th>
            <th className="pr-3 text-right font-semibold">N-1</th>
            <th className="text-right font-semibold">Évol.</th>
          </tr>
        </thead>
        <tbody>
          {lignes.slice().reverse().map((l: any) => (
            <tr key={l.f}>
              <td className="pr-3"><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: l.c }} />{l.f}</td>
              <td className="pr-3 text-right">{row.hasN === false ? "—" : fmtEur(l.n)}</td>
              <td className="pr-3 text-right" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>{fmtEur(l.p)}</td>
              <td className="text-right">{row.hasN === false ? "—" : fmtPct(evol(l.n, l.p))}</td>
            </tr>
          ))}
          <tr className="border-t font-bold" style={{ borderColor: GRID }}>
            <td className="pr-3 pt-1">Total</td>
            <td className="pr-3 pt-1 text-right">{row.hasN === false ? "—" : fmtEur(totN)}</td>
            <td className="pr-3 pt-1 text-right" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>{fmtEur(totP)}</td>
            <td className="pt-1 text-right">{row.hasN === false ? "—" : fmtPct(evol(totN, totP))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Carte graphe "flux" (BL / Factures / CDC / Devis) ───────────────────

function GrapheFamillesCard({
  type, label, color, rows, topN, mode, onMode, anneeN, onRemove, kpiScope,
}: {
  type: DocType; label: string; color: string; rows: FluxRow[]; topN: number;
  mode: Mode; onMode: (m: Mode) => void; anneeN: number; onRemove: () => void;
  kpiScope: KpiScope;
}) {
  const moisCourant = new Date().getMonth() + 1;
  const [moisSel, setMoisSel] = useState<number | null>(null);

  const rowsType = useMemo(() => rows.filter((r) => r.type_document === type), [rows, type]);
  const familles = useMemo(() => {
    const top = topFamilles(rowsType.filter((r) => r.annee === anneeN), topN);
    const hasAutres = rowsType.some((r) => !top.includes(r.famille_macro));
    return hasAutres ? [...top, "Autres"] : top;
  }, [rowsType, topN, anneeN]);

  // Matrice mois x famille pour N, N-1 (mois complet) et N-1 à date.
  const mat = useMemo(() => {
    const N: Record<string, number>[] = Array.from({ length: 12 }, () => ({}));
    const P: Record<string, number>[] = Array.from({ length: 12 }, () => ({}));
    const PD: Record<string, number>[] = Array.from({ length: 12 }, () => ({}));
    rowsType.forEach((r) => {
      const f = bucket(r.famille_macro, familles.filter((x) => x !== "Autres"));
      const i = r.mois - 1;
      if (r.annee === anneeN) N[i][f] = (N[i][f] || 0) + Number(r.montant || 0);
      else if (r.annee === anneeN - 1) {
        P[i][f] = (P[i][f] || 0) + Number(r.montant || 0);
        PD[i][f] = (PD[i][f] || 0) + Number(r.montant_a_date || 0);
      }
    });
    return { N, P, PD };
  }, [rowsType, familles, anneeN]);

  const dataMensuel = useMemo(() => MOIS.map((m, i) => {
    const o: Record<string, any> = { mois: m, idx: i + 1, hasN: i + 1 <= moisCourant };
    let tn = 0, tp = 0;
    familles.forEach((f) => {
      const n = mat.N[i][f] || 0;
      const p = mat.P[i][f] || 0;
      if (i + 1 <= moisCourant) o[`N_${f}`] = n;
      o[`P_${f}`] = p;
      tn += n; tp += p;
    });
    o.totN = tn; o.totP = tp;
    return o;
  }), [mat, familles, moisCourant]);

  const dataCumul = useMemo(() => {
    const cn: Record<string, number> = {};
    const cp: Record<string, number> = {};
    let ctp = 0;
    return MOIS.map((m, i) => {
      const o: Record<string, any> = { mois: m, hasN: i + 1 <= moisCourant };
      let tn = 0;
      familles.forEach((f) => {
        cn[f] = (cn[f] || 0) + (mat.N[i][f] || 0);
        cp[f] = (cp[f] || 0) + (mat.P[i][f] || 0);
        if (i + 1 <= moisCourant) o[`N_${f}`] = cn[f];
        o[`P_${f}`] = cp[f];
        tn += cn[f];
      });
      ctp += familles.reduce((s, f) => s + (mat.P[i][f] || 0), 0);
      o.totN = tn; o.totP = ctp; o.n1 = ctp;
      return o;
    });
  }, [mat, familles, moisCourant]);

  const dataBase100 = useMemo(() => dataMensuel.slice(0, moisCourant).map((o) => {
    const r: Record<string, any> = { ...o };
    familles.forEach((f) => { r[`S_${f}`] = o.totN ? (Number(o[`N_${f}`] || 0) / o.totN) * 100 : 0; });
    return r;
  }), [dataMensuel, familles, moisCourant]);

  // Panneau de droite (Base 100) : YtD par défaut, mois cliqué sinon.
  const panneau = useMemo(() => {
    const lignes = familles.map((f, i) => {
      let n = 0, p = 0;
      if (moisSel) {
        n = mat.N[moisSel - 1][f] || 0;
        p = moisSel === moisCourant ? (mat.PD[moisSel - 1][f] || 0) : (mat.P[moisSel - 1][f] || 0);
      } else {
        for (let k = 0; k < moisCourant; k++) {
          n += mat.N[k][f] || 0;
          p += k + 1 === moisCourant ? (mat.PD[k][f] || 0) : (mat.P[k][f] || 0);
        }
      }
      return { f, c: familleColor(f, i), n, p };
    });
    const tn = lignes.reduce((s, l) => s + l.n, 0);
    const tp = lignes.reduce((s, l) => s + l.p, 0);
    return { lignes, tn, tp };
  }, [familles, mat, moisSel, moisCourant]);

  const kpi = useMemo(() => {
    let n = 0, p = 0;
    for (let k = 0; k < moisCourant; k++) {
      familles.forEach((f) => {
        n += mat.N[k][f] || 0;
        p += k + 1 === moisCourant ? (mat.PD[k][f] || 0) : (mat.P[k][f] || 0);
      });
    }
    return { n, p, e: evol(n, p) };
  }, [mat, familles, moisCourant]);

  void kpi;
  return (
    <div className="relative flex h-full flex-col rounded-2xl border-2 p-3" style={{ borderColor: `${color}55`, background: "var(--cg-panel)" }}>
      <RemoveButton onRemove={onRemove} />
      <div className="mb-2 flex flex-wrap items-center gap-2 pr-6">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <button type="button" onClick={() => ouvrir(type)} title={`Ouvrir ${LIENS[type].libelle}`}
          className="text-[14px] font-extrabold uppercase tracking-[0.08em] hover:underline" style={{ color }}>
          {label} <span className="text-[11px] opacity-70">↗</span>
        </button>
        <div className="ml-auto">
          <Segmented<Mode>
            value={mode}
            onChange={(m) => { setMoisSel(null); onMode(m); }}
            color={color}
            options={[{ v: "mensuel", l: "Mensuel" }, { v: "cumul", l: "Cumulé" }, { v: "base100", l: "Base 100" }]}
          />
        </div>
      </div>
      <div role="button" tabIndex={0} onClick={() => ouvrir(type)} onKeyDown={(e) => { if (e.key === "Enter") ouvrir(type); }}
        title={`Ouvrir ${LIENS[type].libelle}`} className="cursor-pointer rounded-xl transition hover:brightness-110">
        <TroisMetriques famille={type} scope={kpiScope} />
      </div>

      {mode === "mensuel" && (
        <>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataMensuel} barGap={2} barCategoryGap="18%" margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="mois" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip cursor={{ fill: "rgba(var(--cg-ink-rgb),0.05)" }} content={<ChartTooltip familles={familles} />} />
                {familles.map((f, i) => (
                  <Bar key={`P_${f}`} dataKey={`P_${f}`} stackId="P" barSize={9} fill={familleColor(f, i)} fillOpacity={0.32} isAnimationActive={false} />
                ))}
                {familles.map((f, i) => (
                  <Bar key={`N_${f}`} dataKey={`N_${f}`} stackId="N" barSize={22} fill={familleColor(f, i)} isAnimationActive={false}
                    radius={i === familles.length - 1 ? [3, 3, 0, 0] : undefined} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <Legend familles={familles} />
            <span className="whitespace-nowrap text-[10px]" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>barre fine terne = N-1</span>
          </div>
        </>
      )}

      {mode === "cumul" && (
        <>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dataCumul} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="mois" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<ChartTooltip familles={familles} kind="cumul" />} />
                {familles.map((f, i) => (
                  <Area key={f} type="monotone" dataKey={`N_${f}`} stackId="N" stroke={familleColor(f, i)} fill={familleColor(f, i)} fillOpacity={0.75} isAnimationActive={false} />
                ))}
                <Line type="monotone" dataKey="n1" stroke="var(--cg-ink)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1"><Legend familles={familles} n1Label="N-1 toutes familles" /></div>
        </>
      )}

      {mode === "base100" && (
        <div className="flex gap-3">
          <div className="min-w-0 flex-1" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dataBase100}
                barCategoryGap="14%"
                margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
                onClick={(s: any) => {
                  const idx = Number(s?.activeTooltipIndex ?? s?.activeIndex);
                  if (Number.isFinite(idx) && idx >= 0) setMoisSel((cur) => (cur === idx + 1 ? null : idx + 1));
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="mois" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={38} />
                <Tooltip cursor={{ fill: "rgba(var(--cg-ink-rgb),0.06)" }} content={<ChartTooltip familles={familles} />} />
                {familles.map((f, i) => (
                  <Bar key={f} dataKey={`S_${f}`} stackId="S" fill={familleColor(f, i)} isAnimationActive={false}>
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="w-[200px] shrink-0 rounded-xl border p-2" style={{ borderColor: GRID, background: "rgba(var(--cg-ink-rgb),0.04)" }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color }}>
                {moisSel ? `${MOIS[moisSel - 1]} ${anneeN}` : `YtD ${anneeN}`}
              </span>
              {moisSel && (
                <button type="button" onClick={() => setMoisSel(null)} className="text-[10px] font-bold underline" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
                  ← YtD
                </button>
              )}
            </div>
            <table className="w-full text-[11px] tabular-nums" style={{ color: "var(--cg-ink)" }}>
              <thead>
                <tr style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
                  <th className="text-left font-semibold">Fam.</th>
                  <th className="text-right font-semibold">Part</th>
                  <th className="text-right font-semibold">N-1</th>
                  <th className="text-right font-semibold">Évol.</th>
                </tr>
              </thead>
              <tbody>
                {panneau.lignes.slice().reverse().map((l) => {
                  const part = panneau.tn ? l.n / panneau.tn : 0;
                  const partP = panneau.tp ? l.p / panneau.tp : 0;
                  const e = evol(l.n, l.p);
                  return (
                    <tr key={l.f} title={`${l.f} : ${fmtEur(l.n)} (N-1 ${fmtEur(l.p)})`}>
                      <td className="py-0.5"><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: l.c }} />{l.f}</td>
                      <td className="text-right font-bold">{Math.round(part * 100)}%</td>
                      <td className="text-right" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>{Math.round(partP * 100)}%</td>
                      <td className="text-right" style={{ color: e !== null && e < 0 ? "var(--cg-down-ink)" : "var(--cg-up-ink)" }}>{fmtPct(e)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t font-bold" style={{ borderColor: GRID }}>
                  <td className="pt-1">Total</td>
                  <td className="pt-1 text-right" colSpan={2}>{fmtEur(panneau.tn)}</td>
                  <td className="pt-1 text-right" style={{ color: evol(panneau.tn, panneau.tp) !== null && (evol(panneau.tn, panneau.tp) as number) < 0 ? "var(--cg-down-ink)" : "var(--cg-up-ink)" }}>
                    {fmtPct(evol(panneau.tn, panneau.tp))}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="mt-1 text-[10px]" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
              {moisSel ? "Cliquer à nouveau le mois pour revenir au YtD." : "Cliquer un mois pour le détail."} N-1 du mois en cours : à date.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Carte Portefeuille CDC (E : aires empilées / F : petits multiples) ──

function PortefeuilleFamillesCard({
  rows, topN, color, anneeN, vue, setVue, onRemove,
}: {
  rows: PfRow[]; topN: number; color: string; anneeN: number;
  vue: "E" | "F"; setVue: (v: "E" | "F") => void; onRemove: () => void;
}) {

  const semaineCourante = useMemo(() => {
    const n = rows.filter((r) => r.annee_iso === anneeN).map((r) => r.semaine_iso);
    return n.length ? Math.max(...n) : 0;
  }, [rows, anneeN]);

  const familles = useMemo(() => {
    const top = topFamilles(rows.filter((r) => r.annee_iso === anneeN && r.semaine_iso === semaineCourante), topN);
    const hasAutres = rows.some((r) => !top.includes(r.famille_macro));
    return hasAutres ? [...top, "Autres"] : top;
  }, [rows, topN, anneeN, semaineCourante]);

  const data = useMemo(() => {
    const top = familles.filter((f) => f !== "Autres");
    const byWeek = new Map<number, Record<string, any>>();
    for (let w = 1; w <= 52; w++) byWeek.set(w, { sem: `S${w}`, w, hasN: w <= semaineCourante });
    rows.forEach((r) => {
      if (r.semaine_iso > 52) return;
      const o = byWeek.get(r.semaine_iso)!;
      const f = bucket(r.famille_macro, top);
      if (r.annee_iso === anneeN) o[`N_${f}`] = (o[`N_${f}`] || 0) + Number(r.montant || 0);
      else if (r.annee_iso === anneeN - 1) o[`P_${f}`] = (o[`P_${f}`] || 0) + Number(r.montant || 0);
    });
    return Array.from(byWeek.values()).map((o) => {
      const totN = familles.reduce((s, f) => s + Number(o[`N_${f}`] || 0), 0);
      const totP = familles.reduce((s, f) => s + Number(o[`P_${f}`] || 0), 0);
      if (!o.hasN) familles.forEach((f) => { delete o[`N_${f}`]; });
      return { ...o, totN, totP, n1: totP } as Record<string, any>;
    });
  }, [rows, familles, anneeN, semaineCourante]);

  const actuel = data.find((d) => d.w === semaineCourante);
  const e = actuel ? evol(actuel.totN, actuel.totP) : null;
  const calculeAt = rows[0]?.calcule_at ? new Date(rows[0].calcule_at) : null;

  return (
    <div className="relative flex h-full flex-col rounded-2xl border-2 p-3" style={{ borderColor: `${color}55`, background: "var(--cg-panel)" }}>
      <RemoveButton onRemove={onRemove} />
      <div className="mb-2 flex flex-wrap items-center gap-2 pr-6">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <button type="button" onClick={() => ouvrir("PORTEFEUILLE")} title={`Ouvrir ${LIENS.PORTEFEUILLE.libelle}`}
          className="text-[14px] font-extrabold uppercase tracking-[0.08em] hover:underline" style={{ color }}>
          Portefeuille CDC <span className="text-[11px] opacity-70">↗</span>
        </button>
        {actuel && (
          <span className="text-[12px] tabular-nums" style={{ color: "var(--cg-ink)" }}>
            <b>{fmtEur(actuel.totN)}</b> S{semaineCourante}
            <span className="ml-1.5" style={{ color: e !== null && e < 0 ? "var(--cg-down-ink)" : "var(--cg-up-ink)" }}>{fmtPct(e)}</span>
            <span className="ml-1.5" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>vs {fmtEur(actuel.totP)}</span>
          </span>
        )}
        <div className="ml-auto">
          <Segmented<"E" | "F">
            value={vue}
            onChange={setVue}
            color={color}
            options={[{ v: "E", l: "Empilé" }, { v: "F", l: "Par famille" }]}
          />
        </div>
      </div>

      {vue === "E" ? (
        <>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="sem" interval={3} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<ChartTooltip familles={familles} kind="fin de semaine" />} />
                {familles.map((f, i) => (
                  <Area key={f} type="monotone" dataKey={`N_${f}`} stackId="N" stroke={familleColor(f, i)} fill={familleColor(f, i)} fillOpacity={0.75} isAnimationActive={false} />
                ))}
                <Line type="monotone" dataKey="n1" stroke="var(--cg-ink)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1"><Legend familles={familles} n1Label={`${anneeN - 1} toutes familles`} /></div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
          {familles.map((f, i) => {
            const cur = actuel ? Number((actuel as any)[`N_${f}`] || 0) : 0;
            const prev = actuel ? Number((actuel as any)[`P_${f}`] || 0) : 0;
            const ef = evol(cur, prev);
            return (
              <div key={f} className="rounded-xl border p-2" style={{ borderColor: GRID, background: "rgba(var(--cg-ink-rgb),0.04)" }}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-bold" style={{ color: familleColor(f, i) }}>{f}</span>
                  <span className="tabular-nums" style={{ color: "var(--cg-ink)" }}>
                    {fmtEur(cur)} <span style={{ color: ef !== null && ef < 0 ? "var(--cg-down-ink)" : "var(--cg-up-ink)" }}>{fmtPct(ef)}</span>
                  </span>
                </div>
                <div style={{ height: 82 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                      <XAxis dataKey="sem" hide />
                      <YAxis hide domain={[0, "auto"]} />
                      <Tooltip
                        formatter={(v: any, name: any) => [fmtEur(Number(v)), String(name).startsWith("N_") ? String(anneeN) : String(anneeN - 1)]}
                        labelStyle={{ color: "var(--cg-ink)" }}
                        contentStyle={{ background: "var(--cg-panel)", border: `1px solid ${GRID}`, fontSize: 11, color: "var(--cg-ink)" }}
                      />
                      <Line type="monotone" dataKey={`P_${f}`} stroke={familleColor(f, i)} strokeOpacity={0.45} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey={`N_${f}`} stroke={familleColor(f, i)} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1 text-[10px]" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
        Reconstitué en fin de semaine (lignes de CDC entre date de commande et date de PL/BL/facture).
        {calculeAt ? ` Calculé le ${calculeAt.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.` : ""}
      </div>
    </div>
  );
}

// ─── Agenda compact ──────────────────────────────────────────────────────

type RdvCompact = { id: string; start: string; subject: string; company: string | null; type: string; allDay: boolean };

function AgendaCompact({ onOpenFull }: { onOpenFull: () => void }) {
  const [rdvs, setRdvs] = useState<RdvCompact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email?.toLowerCase();
      if (!email) { setLoading(false); return; }
      const { data: access } = await supabase.from("user_page_access").select("blg_partner_id").eq("email", email).maybeSingle();
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 14);
      const orParts: string[] = [`created_by_email.eq.${email}`];
      if (access?.blg_partner_id) orParts.push(`blg_partner_id.eq.${access.blg_partner_id}`);
      const { data } = await supabase
        .from("v_rdv_unifie")
        .select("rdv_id, start_date, subject, company_name, type, all_day")
        .gte("start_date", start.toISOString())
        .lt("start_date", end.toISOString())
        .or(orParts.join(","))
        .order("start_date", { ascending: true })
        .limit(40);
      if (cancelled) return;
      setRdvs(((data || []) as any[]).map((r) => ({
        id: String(r.rdv_id), start: String(r.start_date || ""), subject: String(r.subject || "RDV"),
        company: r.company_name || null, type: String(r.type || ""), allDay: Boolean(r.all_day),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const parJour = useMemo(() => {
    const m = new Map<string, RdvCompact[]>();
    rdvs.forEach((r) => {
      const d = new Date(r.start);
      const k = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
      m.set(k, [...(m.get(k) || []), r]);
    });
    return Array.from(m.entries());
  }, [rdvs]);

  if (loading) return <div className="p-2 text-[12px]" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>Chargement…</div>;
  if (rdvs.length === 0) {
    return (
      <div className="p-2 text-[12px]" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
        Aucun rendez-vous sur 14 jours. <button type="button" className="underline" onClick={onOpenFull}>Ouvrir l’agenda</button>
      </div>
    );
  }
  return (
    <div className="pr-1">
      {parJour.map(([jour, liste]) => (
        <div key={jour} className="mb-1.5">
          <div className="sticky top-0 z-[1] py-0.5 text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "#7A5EA8", background: "var(--cg-bg)" }}>{jour}</div>
          {liste.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={onOpenFull}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition hover:bg-[color:var(--cg-panel-hover)]"
              style={{ color: "var(--cg-ink)" }}
            >
              <span className="w-10 shrink-0 tabular-nums" style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}>
                {r.allDay ? "jour" : new Date(r.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <b>{r.company || r.subject}</b>
                {r.company && <span style={{ color: "rgba(var(--cg-ink-rgb),0.62)" }}> · {r.subject}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Panneau latéral repliable ───────────────────────────────────────────

function SidePanel({
  title, icon, color, open, onToggle, actions, children, grow = "flex-1",
}: {
  title: string; icon: string; color: string; open: boolean; onToggle: () => void;
  actions?: React.ReactNode; children: React.ReactNode; grow?: string;
}) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 ${open ? grow : "flex-none"}`} style={{ borderColor: `${color}55` }}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ background: `${color}22`, borderBottom: open ? `2px solid ${color}` : "none" }}>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-[16px]">{icon}</span>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.1em]" style={{ color }}>{title}</span>
          <span className="text-[12px]" style={{ color }}>{open ? "▾" : "▸"}</span>
        </button>
        {actions}
      </div>
      {open && <div className="min-h-0 flex-1 overflow-auto bg-[color:var(--cg-bg)] p-2">{children}</div>}
    </div>
  );
}

function Overlay({ title, color, onClose, children, lien }: { title: string; color: string; onClose: () => void; children: React.ReactNode; lien?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="flex h-[88vh] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-2xl border-2 shadow-2xl"
        style={{ borderColor: color, background: "var(--cg-bg)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: `${color}2A`, borderBottom: `3px solid ${color}` }}>
          <span className="text-[14px] font-extrabold uppercase tracking-[0.12em]" style={{ color }}>{title}</span>
          {lien && (
            <a href={lien} target="_blank" rel="noopener noreferrer" className="ml-auto text-[12px] font-bold underline" style={{ color }}>
              Page complète ↗
            </a>
          )}
          <button type="button" onClick={onClose} className={`${lien ? "" : "ml-auto "}rounded-lg border px-2.5 py-1 text-[12px] font-bold`} style={{ color, borderColor: `${color}88` }}>
            Fermer ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      </div>
    </div>
  );
}

// ─── Briques communes widgets ────────────────────────────────────────────

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
      title="Retirer ce widget"
      className="absolute right-2 top-2 z-10 text-[14px] leading-none text-[color:var(--cg-ink)]/30 hover:text-[color:var(--cg-ink)]/80"
    >
      ✕
    </button>
  );
}

type FluxValues = { jour_valeur: number; jour_n1: number; mois_valeur: number; mois_n1: number; annee_valeur: number; annee_n1: number };

function Evol({ v, n1 }: { v: number; n1: number }) {
  if (!n1) return <span className="text-[11px]" style={{ color: "rgba(var(--cg-ink-rgb),0.35)" }}>—</span>;
  const pct = ((v - n1) / Math.abs(n1)) * 100;
  const up = pct >= 0;
  return (
    <span className="text-[11px] font-semibold" style={{ color: up ? "var(--cg-up-ink)" : "var(--cg-down-ink)" }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
    </span>
  );
}

// Jour / Mois (MTD) / Année (YTD) + évolution N-1 — même source que les
// pavés flux de Vision ONE PAGE (get_vision_tci_kpi).
function TroisMetriques({ famille, scope }: { famille: DocType; scope: KpiScope }) {
  const [values, setValues] = useState<FluxValues | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_vision_tci_kpi", {
      p_famille: famille,
      p_famille_macro: scope.familleMacro,
      p_agence: scope.agence,
      p_collaborateur: scope.collaborateur,
      p_utiliser_j_moins_1: scope.jMoins1,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(error.message); return; }
      setErr(null);
      setValues((Array.isArray(data) ? data[0] : data) as FluxValues);
    });
    return () => { cancelled = true; };
  }, [famille, scope.familleMacro, scope.agence, scope.collaborateur, scope.jMoins1, scope.refreshTick]);

  if (err) return <div className="mb-2 text-[11px]" style={{ color: "var(--cg-err-ink)" }}>{err}</div>;
  const cols: { l: string; v: number; n1: number }[] = values
    ? [
        { l: scope.jMoins1 ? "Jour (J-1)" : "Jour", v: Number(values.jour_valeur || 0), n1: Number(values.jour_n1 || 0) },
        { l: "Mois (MTD)", v: Number(values.mois_valeur || 0), n1: Number(values.mois_n1 || 0) },
        { l: "Année (YTD)", v: Number(values.annee_valeur || 0), n1: Number(values.annee_n1 || 0) },
      ]
    : [];
  return (
    <div className="mb-2 grid grid-cols-3 gap-2 rounded-xl px-2 py-1.5" style={{ background: "rgba(var(--cg-ink-rgb),0.04)" }}>
      {values
        ? cols.map((c) => (
            <div key={c.l} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(var(--cg-ink-rgb),0.55)" }}>{c.l}</div>
              <div className="whitespace-nowrap text-[20px] font-extrabold leading-tight tabular-nums" style={{ color: "var(--cg-ink)" }}>{fmtEur(c.v, 2)}</div>
              <Evol v={c.v} n1={c.n1} />
            </div>
          ))
        : [0, 1, 2].map((i) => <div key={i} className="h-[52px] animate-pulse rounded" style={{ background: "rgba(var(--cg-ink-rgb),0.06)" }} />)}
    </div>
  );
}

// ─── Widgets ─────────────────────────────────────────────────────────────

type Largeur = 1 | 2 | 3 | 4;
type Widget =
  | { id: string; w: Largeur; type: "graphe"; cle: CardKey; mode?: Mode; vue?: "E" | "F" }
  | { id: string; w: Largeur; type: "kpi"; kpi: KpiCardConfig };

const COL_SPAN: Record<Largeur, string> = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4" };

function largeurParDefaut(k: KpiCardConfig): Largeur {
  if (k.kind === "flux") return 2;
  if (k.kind === "spacer") return k.cle === "2" ? 2 : 1;
  if (k.kind === "compteur" && k.cle === "clients_actifs") return 2;
  return 1;
}

function newId() {
  try { return crypto.randomUUID(); } catch { return `w${Date.now()}${Math.random().toString(36).slice(2, 8)}`; }
}

function widgetsParDefaut(layout: KpiCardConfig[]): Widget[] {
  const graphes: Widget[] = (["CDC", "BL", "Factures", "PORTEFEUILLE"] as CardKey[]).map((cle) => ({ id: newId(), w: 2, type: "graphe", cle }));
  return [...graphes, ...layout.map((k) => ({ id: newId(), w: largeurParDefaut(k), type: "kpi" as const, kpi: k }))];
}

// Coquille de widget : poignée de glisser-déposer, flèches, largeur.
function WidgetFrame({
  widget, index, total, onMove, onWidth, onDragStartId, onDropOn, dragging, children,
}: {
  widget: Widget; index: number; total: number;
  onMove: (dir: -1 | 1) => void; onWidth: (w: Largeur) => void;
  onDragStartId: (id: string | null) => void; onDropOn: (targetId: string, after: boolean) => void;
  dragging: string | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<null | "avant" | "apres">(null);
  return (
    <div
      ref={ref}
      data-widget={widget.id}
      className={`group relative ${COL_SPAN[widget.w]} [&>*:first-child]:h-full`}
      style={{
        opacity: dragging === widget.id ? 0.4 : 1,
        boxShadow: over === "avant" ? "-4px 0 0 0 #2E5BB8" : over === "apres" ? "4px 0 0 0 #2E5BB8" : undefined,
        borderRadius: 16,
      }}
      onDragOver={(e) => {
        if (!dragging || dragging === widget.id) return;
        e.preventDefault();
        const r = ref.current?.getBoundingClientRect();
        setOver(r && e.clientX > r.left + r.width / 2 ? "apres" : "avant");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        const after = over === "apres";
        setOver(null);
        onDropOn(widget.id, after);
      }}
    >
      {children}
      <div
        className="pointer-events-none absolute -top-3 left-1/2 z-20 flex h-6 -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full border px-1 opacity-0 shadow-md transition group-hover:pointer-events-auto group-hover:opacity-100"
        style={{ background: "var(--cg-panel)", borderColor: GRID, color: "var(--cg-ink)" }}
      >
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", widget.id);
            if (ref.current) e.dataTransfer.setDragImage(ref.current, 30, 20);
            onDragStartId(widget.id);
          }}
          onDragEnd={() => onDragStartId(null)}
          title="Glisser pour déplacer"
          className="cursor-grab select-none px-1.5 text-[13px] active:cursor-grabbing"
        >
          ⠿
        </span>
        <button type="button" disabled={index === 0} onClick={() => onMove(-1)} title="Avancer" className="px-1 text-[12px] disabled:opacity-25">◀</button>
        <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} title="Reculer" className="px-1 text-[12px] disabled:opacity-25">▶</button>
        <span className="mx-0.5 h-3 w-px" style={{ background: GRID }} />
        {([1, 2, 3, 4] as Largeur[]).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onWidth(w)}
            title={w === 4 ? "Pleine largeur" : `${w}/4 de largeur`}
            className="rounded px-1 text-[10px] font-bold"
            style={{ background: widget.w === w ? "rgba(46,91,184,0.35)" : "transparent" }}
          >
            {w === 4 ? "▭" : `${w}/4`}
          </button>
        ))}
      </div>
    </div>
  );
}

function AjouterWidget({
  famillesMacro, agenceForcee, agencesDisponibles, onAddGraphe, onAddKpi, onClose,
}: {
  famillesMacro: string[]; agenceForcee: string | null; agencesDisponibles: string[];
  onAddGraphe: (k: CardKey) => void; onAddKpi: (c: Omit<KpiCardConfig, "id">) => void; onClose: () => void;
}) {
  return (
    <div className="mb-3 rounded-2xl border p-3" style={{ borderColor: GRID, background: "var(--cg-panel)" }}>
      <div className="mb-2 flex items-center">
        <span className="text-[12px] font-extrabold uppercase tracking-wider" style={{ color: "var(--cg-ink)" }}>Ajouter un widget</span>
        <button type="button" onClick={onClose} className="ml-auto text-[12px] underline" style={{ color: "rgba(var(--cg-ink-rgb),0.6)" }}>Fermer</button>
      </div>
      <div className="mb-1 text-[11px] font-semibold" style={{ color: "rgba(var(--cg-ink-rgb),0.6)" }}>Graphes par familles</div>
      <div className="mb-3 flex flex-wrap gap-2">
        {CARDS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onAddGraphe(c.key)}
            className="rounded-full border-2 px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: c.color, background: `${c.color}22`, color: c.color }}
          >
            + {c.label}
          </button>
        ))}
      </div>
      <div className="mb-1 text-[11px] font-semibold" style={{ color: "rgba(var(--cg-ink-rgb),0.6)" }}>Pavés de Vision ONE PAGE</div>
      <AjouterKpiForm
        famillesMacro={famillesMacro}
        agenceForcee={agenceForcee}
        agencesDisponibles={agencesDisponibles}
        onAdd={onAddKpi}
        onCancel={onClose}
      />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

type Reglages = { topN?: number; agendaOpen?: boolean; todoOpen?: boolean; jMoins1?: boolean };

export default function VisionTciBisPage() {
  const { isMobile } = useViewport();
  const access = usePageFilterAccess();
  const anneeN = new Date().getFullYear();

  const [email, setEmail] = useState<string>("");
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [reglages, setReglages] = useState<Reglages>({});
  const [prefsLues, setPrefsLues] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "agenda" | "todo">(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [familleMacroFiltre, setFamilleMacroFiltre] = useState<string | null>(null);
  const [defautCommun, setDefautCommun] = useState<{ widgets: Widget[]; reglages: Reglages } | null>(null);
  const [messageDefaut, setMessageDefaut] = useState<string | null>(null);
  const { rights } = useAccess();
  const personnalise = useMemo(
    () => Boolean(defautCommun) && JSON.stringify(widgets) !== JSON.stringify(defautCommun?.widgets),
    [widgets, defautCommun],
  );

  // Hauteur du bandeau collant de l'application : la colonne agenda / todo
  // reste fixée juste dessous et tient sur la hauteur de l'écran, quel que
  // soit l'écran (seule la zone des graphes défile).
  const [hautBandeau, setHautBandeau] = useState(150);
  useEffect(() => {
    function mesurer() {
      let el = document.elementFromPoint(window.innerWidth / 2, 2) as HTMLElement | null;
      let bas = 0;
      while (el && el !== document.body && el !== document.documentElement) {
        const pos = window.getComputedStyle(el).position;
        if (pos === "sticky" || pos === "fixed") { bas = el.getBoundingClientRect().bottom; break; }
        el = el.parentElement;
      }
      setHautBandeau(Math.max(0, Math.round(bas)));
    }
    mesurer();
    const t = window.setTimeout(mesurer, 800);
    window.addEventListener("resize", mesurer);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", mesurer); };
  }, []);

  const [agence, setAgence] = useState<string>("");
  const [collaborateur, setCollaborateur] = useState<string>("");
  const [collabs, setCollabs] = useState<{ nom: string; agence: string }[]>([]);
  const [famillesMacro, setFamillesMacro] = useState<string[]>([]);

  const [flux, setFlux] = useState<FluxRow[]>([]);
  const [pf, setPf] = useState<PfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const topN = reglages.topN ?? 5;
  const agendaOpen = reglages.agendaOpen ?? true;
  const todoOpen = reglages.todoOpen ?? true;
  const jMoins1 = reglages.jMoins1 ?? true;

  // Chargement de la disposition (base), sinon disposition par défaut.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const mail = (s.session?.user?.email || "").toLowerCase();
      if (!mail) { setPrefsLues(true); return; }
      const [{ data: pref }, { data: defaut }, { data: layout }, { data: fams }, { data: cols }] = await Promise.all([
        supabase.from("vision_tci_bis_preferences").select("widgets, reglages").eq("user_email", mail).maybeSingle(),
        supabase.from("vision_tci_bis_defaut").select("widgets, reglages").eq("id", 1).maybeSingle(),
        supabase.rpc("get_vision_tci_effective_layout", { p_email: mail }),
        supabase.from("ref_familles").select("famille_macro"),
        supabase.from("ref_collaborateurs").select("nom, agence, mise_en_sommeil").order("nom"),
      ]);
      if (cancelled) return;
      setEmail(mail);
      const saved = (pref?.widgets || null) as Widget[] | null;
      const commun = (defaut?.widgets || null) as Widget[] | null;
      setDefautCommun(commun && Array.isArray(commun) && commun.length > 0 ? { widgets: commun, reglages: (defaut?.reglages || {}) as Reglages } : null);
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setWidgets(saved);
      } else if (commun && Array.isArray(commun) && commun.length > 0) {
        setWidgets(commun);
      } else {
        const raw = ((layout as any[] | null) || []).map((c) => ({
          id: String(c.id || newId()), kind: c.kind || "flux", cle: c.cle || c.famille || "BL",
          famille_macro: c.famille_macro ?? null, agence: c.agence ?? null, grand: Boolean(c.grand),
        })) as KpiCardConfig[];
        setWidgets(widgetsParDefaut(raw));
      }
      setReglages({ ...((defaut?.reglages || {}) as Reglages), ...((pref?.reglages || {}) as Reglages) });
      setFamillesMacro(Array.from(new Set(((fams || []) as Array<{ famille_macro: string | null }>).map((f) => f.famille_macro).filter((v): v is string => Boolean(v)))).sort());
      setCollabs(((cols || []) as any[])
        .filter((c) => c.nom && c.agence && !c.mise_en_sommeil && !String(c.nom).includes(" "))
        .map((c) => ({ nom: String(c.nom), agence: String(c.agence) })));
      setPrefsLues(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Enregistrement (léger différé) à chaque changement de disposition.
  useEffect(() => {
    if (!prefsLues || !email) return;
    const t = window.setTimeout(() => {
      supabase.from("vision_tci_bis_preferences").upsert({
        user_email: email, widgets, reglages, updated_at: new Date().toISOString(),
      }).then(({ error: e }) => { if (e) console.error("[VisionTCI] sauvegarde disposition", e); });
    }, 600);
    return () => window.clearTimeout(t);
  }, [widgets, reglages, prefsLues, email]);

  const setReglage = useCallback(<K extends keyof Reglages>(k: K, v: Reglages[K]) => {
    setReglages((cur) => ({ ...cur, [k]: v }));
  }, []);

  // Périmètre
  const agenceForcee = access.hasAgenceRestriction && access.allowedAgences.length > 0 ? access.allowedAgences[0] : null;
  const collaborateurForce = access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0 ? access.allowedCollaborateurs[0] : null;
  const effAgence = agenceForcee || agence || null;
  const effCollab = collaborateurForce || collaborateur || null;

  const agences = useMemo(() => Array.from(new Set(collabs.map((c) => c.agence))).sort(), [collabs]);
  const collabsVisibles = useMemo(() => collabs.filter((c) => !effAgence || c.agence === effAgence), [collabs, effAgence]);

  useEffect(() => {
    if (access.loading) return;
    let cancelled = false;
    Promise.all([
      supabase.rpc("get_vision_bis_flux_familles", { p_agence: effAgence, p_collaborateur: effCollab }),
      supabase.rpc("get_vision_bis_portefeuille_cdc", { p_agence: effAgence, p_collaborateur: effCollab }),
    ]).then(([f, p]) => {
      if (cancelled) return;
      setError(f.error?.message || p.error?.message || null);
      setFlux(((f.data || []) as any[]).map((r) => ({ ...r, montant: Number(r.montant || 0), montant_a_date: Number(r.montant_a_date || 0) })));
      setPf(((p.data || []) as any[]).map((r) => ({ ...r, montant: Number(r.montant || 0) })));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [access.loading, effAgence, effCollab, refreshTick]);

  const kpiScope: KpiScope = useMemo(
    () => ({ agence: effAgence, collaborateur: effCollab, familleMacro: familleMacroFiltre, jMoins1, refreshTick }),
    [effAgence, effCollab, familleMacroFiltre, jMoins1, refreshTick],
  );

  // Opérations sur la disposition
  async function imposerATous() {
    if (!window.confirm("Imposer la disposition actuelle à tous les utilisateurs ? Elle remplace leurs dispositions personnelles.")) return;
    const { data, error: e } = await supabase.rpc("set_vision_tci_bis_defaut", { p_widgets: widgets, p_reglages: reglages });
    if (e) { setMessageDefaut(`Erreur : ${e.message}`); return; }
    setDefautCommun({ widgets, reglages });
    setMessageDefaut(`Disposition imposée à tous (${Number(data || 0)} disposition(s) personnelle(s) remplacée(s)).`);
  }
  function revenirAuDefaut() {
    if (!defautCommun) return;
    setWidgets(defautCommun.widgets);
    setReglages((cur) => ({ ...cur, ...defautCommun.reglages }));
  }
  function retirer(id: string) { setWidgets((cur) => cur.filter((w) => w.id !== id)); }
  function maj(id: string, patch: Partial<Widget>) {
    setWidgets((cur) => cur.map((w) => (w.id === id ? ({ ...w, ...patch } as Widget) : w)));
  }
  function deplacer(id: string, dir: -1 | 1) {
    setWidgets((cur) => {
      const i = cur.findIndex((w) => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function deposer(targetId: string, after: boolean) {
    const src = dragging;
    setDragging(null);
    if (!src || src === targetId) return;
    setWidgets((cur) => {
      const moved = cur.find((w) => w.id === src);
      if (!moved) return cur;
      const rest = cur.filter((w) => w.id !== src);
      const t = rest.findIndex((w) => w.id === targetId);
      rest.splice(after ? t + 1 : t, 0, moved);
      return rest;
    });
  }

  if (isMobile) return <MobileStandaloneActivite />;

  const selectCls = "rounded-lg border px-2 py-1 text-[12px] font-semibold";
  const selectStyle = { background: "var(--cg-panel)", borderColor: GRID, color: "var(--cg-ink)" } as React.CSSProperties;
  const btnStyle = { background: "var(--cg-panel)", borderColor: GRID, color: "var(--cg-ink)" } as React.CSSProperties;

  function renderWidget(w: Widget) {
    if (w.type === "graphe") {
      const def = CARDS.find((c) => c.key === w.cle) || CARDS[0];
      if (w.cle === "PORTEFEUILLE") {
        return (
          <PortefeuilleFamillesCard
            rows={pf} topN={topN} color={def.color} anneeN={anneeN}
            vue={w.vue || "E"} setVue={(v) => maj(w.id, { vue: v })}
            onRemove={() => retirer(w.id)}
          />
        );
      }
      return (
        <GrapheFamillesCard
          type={w.cle} label={def.label} color={def.color} rows={flux} topN={topN} anneeN={anneeN}
          mode={w.mode || "mensuel"} onMode={(m) => maj(w.id, { mode: m })}
          onRemove={() => retirer(w.id)} kpiScope={kpiScope}
        />
      );
    }
    const c = w.kpi;
    const ag = agenceForcee || agence || c.agence || null;
    const co = effCollab;
    const rm = () => retirer(w.id);
    switch (c.kind) {
      case "flux":
        return c.grand
          ? <FluxCardGrand config={c} effectiveAgence={ag} effectiveCollaborateur={co} refreshTick={refreshTick} familleMacroEffective={familleMacroFiltre ?? c.famille_macro} onRemove={rm} />
          : <FluxCard config={c} effectiveAgence={ag} effectiveCollaborateur={co} utiliserJMoins1={jMoins1} refreshTick={refreshTick} familleMacroFiltre={familleMacroFiltre} onRemove={rm} />;
      case "taux":
        return <TauxCard config={c} effectiveAgence={ag} effectiveCollaborateur={co} refreshTick={refreshTick} familleMacroFiltre={familleMacroFiltre} onRemove={rm} />;
      case "portefeuille":
        return <PortefeuilleCard effectiveAgence={ag} effectiveCollaborateur={co} refreshTick={refreshTick} familleMacroFiltre={familleMacroFiltre} onRemove={rm} />;
      case "projection":
        return <ProjectionCard effectiveAgence={ag} effectiveCollaborateur={co} refreshTick={refreshTick} familleMacroFiltre={familleMacroFiltre} onRemove={rm} />;
      case "spacer":
        return <SpacerCard span={c.cle === "2" ? 2 : 1} onRemove={rm} />;
      default:
        return c.cle === "factures_retard"
          ? <RetardsPaiementCard effectiveAgence={ag} effectiveCollaborateur={co} refreshTick={refreshTick} onRemove={rm} />
          : <CompteurCard config={c} effectiveAgence={ag} effectiveCollaborateur={co} refreshTick={refreshTick} onRemove={rm} />;
    }
  }

  return (
    <div className="min-h-screen w-full bg-[color:var(--cg-bg)] p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="rounded-full border-2 px-3 py-1 text-[12px] font-bold"
              style={{ borderColor: "#2E5BB8", background: "rgba(46,91,184,0.18)", color: "var(--cg-ink)" }}
            >
              + Ajouter un widget
            </button>
            <span className="text-[11px] font-semibold" style={{ color: "rgba(var(--cg-ink-rgb),0.6)" }}>Familles</span>
            <Segmented<string>
              value={String(topN)}
              onChange={(v) => setReglage("topN", Number(v))}
              color="#4C8FD6"
              options={[{ v: "3", l: "Top 3" }, { v: "5", l: "Top 5" }, { v: "8", l: "Top 8" }]}
            />
            <Segmented<string>
              value={jMoins1 ? "j1" : "j"}
              onChange={(v) => setReglage("jMoins1", v === "j1")}
              color="#A6A181"
              options={[{ v: "j", l: "Jour" }, { v: "j1", l: "J-1" }]}
            />
            <button type="button" onClick={() => setRefreshTick((t) => t + 1)} className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={btnStyle} title="Actualiser toutes les valeurs">
              ↻ Actualiser
            </button>
            {defautCommun && personnalise && (
              <button type="button" onClick={revenirAuDefaut} className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={btnStyle}
                title="Abandonner ma disposition et reprendre la disposition commune">
                ↺ Disposition par défaut
              </button>
            )}
            {rights?.can_autorisation && (
              <button type="button" onClick={() => void imposerATous()} className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold"
                style={{ ...btnStyle, borderColor: "#A6A181" }} title="Administrateur : la disposition actuelle devient celle de tous les utilisateurs">
                ⚙ Imposer à tous
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {agenceForcee ? (
                <span className={selectCls} style={selectStyle}>{agenceForcee} 🔒</span>
              ) : (
                <select className={selectCls} style={selectStyle} value={agence} onChange={(e) => { setAgence(e.target.value); setCollaborateur(""); }}>
                  <option value="">Toutes agences</option>
                  {agences.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              {collaborateurForce ? (
                <span className={selectCls} style={selectStyle}>{collaborateurForce} 🔒</span>
              ) : (
                <select className={selectCls} style={selectStyle} value={collaborateur} onChange={(e) => setCollaborateur(e.target.value)}>
                  <option value="">Tous collaborateurs</option>
                  {collabsVisibles.map((c) => <option key={c.nom} value={c.nom}>{c.nom}</option>)}
                </select>
              )}
              <LastSyncBadge compact />
            </div>
          </div>

          <FamilleMacroFiltreRow familles={famillesMacro} actif={familleMacroFiltre} onChange={setFamilleMacroFiltre} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        {/* ── Colonne widgets (2/3) ── */}
        <div className="min-w-0">
          {messageDefaut && (
            <div className="mb-3 text-[11px]" style={{ color: "rgba(var(--cg-ink-rgb),0.7)" }}>{messageDefaut}</div>
          )}
          {showAdd && (
            <AjouterWidget
              famillesMacro={famillesMacro}
              agenceForcee={agenceForcee}
              agencesDisponibles={agences}
              onAddGraphe={(k) => { setWidgets((cur) => [...cur, { id: newId(), w: 2, type: "graphe", cle: k }]); setShowAdd(false); }}
              onAddKpi={(c) => {
                const kpi: KpiCardConfig = { ...c, id: newId() };
                setWidgets((cur) => [...cur, { id: newId(), w: largeurParDefaut(kpi), type: "kpi", kpi }]);
                setShowAdd(false);
              }}
              onClose={() => setShowAdd(false)}
            />
          )}

          {error && (
            <div className="mb-3 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "var(--cg-danger-border)", background: "var(--cg-danger-bg)", color: "var(--cg-danger-text)" }}>
              {error}
            </div>
          )}

          {!prefsLues ? (
            <div className="grid grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => <div key={i} className="col-span-2 h-72 animate-pulse rounded-2xl" style={{ background: "rgba(var(--cg-ink-rgb),0.05)" }} />)}
            </div>
          ) : widgets.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-10 text-center text-[13px]" style={{ borderColor: GRID, color: "rgba(var(--cg-ink-rgb),0.6)" }}>
              Aucun widget — « + Ajouter un widget » pour composer la page.
            </div>
          ) : (
            <div className={`grid grid-cols-4 gap-4 pt-2 ${loading ? "opacity-60" : ""}`}>
              {widgets.map((w, i) => (
                <WidgetFrame
                  key={w.id}
                  widget={w}
                  index={i}
                  total={widgets.length}
                  onMove={(dir) => deplacer(w.id, dir)}
                  onWidth={(l) => maj(w.id, { w: l })}
                  onDragStartId={setDragging}
                  onDropOn={deposer}
                  dragging={dragging}
                >
                  {renderWidget(w)}
                </WidgetFrame>
              ))}
            </div>
          )}
        </div>

        {/* ── Colonne agenda / todo (1/3) ── */}
        <div
          className="mt-2 flex min-w-0 flex-col gap-4 xl:sticky xl:top-[var(--vb-top)] xl:h-[calc(100vh-var(--vb-top)-16px)] xl:self-start"
          style={{ ["--vb-top" as string]: `${hautBandeau + 12}px` } as React.CSSProperties}
        >
          <SidePanel
            grow="xl:flex-[2]"
            title="Mon Agenda"
            icon="📅"
            color="#7A5EA8"
            open={agendaOpen}
            onToggle={() => setReglage("agendaOpen", !agendaOpen)}
            actions={
              <button type="button" onClick={() => setOverlay("agenda")} className="rounded-lg border px-2 py-0.5 text-[11px] font-bold"
                style={{ color: "#A48BD6", borderColor: "#7A5EA888" }}>
                Agenda complet ⤢
              </button>
            }
          >
            <AgendaCompact onOpenFull={() => setOverlay("agenda")} />
          </SidePanel>

          <SidePanel
            grow="xl:flex-[3]"
            title="Ma Todo"
            icon="✅"
            color="#B4761A"
            open={todoOpen}
            onToggle={() => setReglage("todoOpen", !todoOpen)}
            actions={
              <button type="button" onClick={() => setOverlay("todo")} className="rounded-lg border px-2 py-0.5 text-[11px] font-bold"
                style={{ color: "#D69A4A", borderColor: "#B4761A88" }}>
                Agrandir ⤢
              </button>
            }
          >
            <TodoDenseList />
          </SidePanel>
        </div>
      </div>

      {overlay === "agenda" && (
        <Overlay title="Mon Agenda" color="#7A5EA8" lien="/agenda" onClose={() => setOverlay(null)}>
          <div className="h-full min-h-[70vh]"><OutlookAgenda /></div>
        </Overlay>
      )}
      {overlay === "todo" && (
        <Overlay title="Ma Todo" color="#B4761A" lien="/todo" onClose={() => setOverlay(null)}>
          <TodoDenseList />
        </Overlay>
      )}
    </div>
  );
}
