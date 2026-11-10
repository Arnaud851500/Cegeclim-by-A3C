"use client";

// app/tableaux-de-bord/vision-tci-bis/page.tsx
//
// VISION ONE PAGE BIS (2026-11-10) — page de travail pour la mise en forme.
//
//  - 2/3 de la largeur pour les graphes (2 graphes côte à côte), 1/3 pour un
//    agenda et une todo compacts (repliables, ouverture en grand au clic).
//  - Graphes par type de document choisi par l'utilisateur (BL, Factures,
//    CDC, Devis) + Portefeuille CDC — choix mémorisé dans le navigateur.
//  - 3 modes par graphe :
//      Mensuel  : barres empilées par famille macro (N) + barre fine et terne
//                 empilée pour N-1, côte à côte.
//      Cumulé   : aires empilées cumulées N par famille + courbe N-1 (toutes
//                 familles).
//      Base 100 : barres 100 % par mois (mix familles) + panneau YtD à droite
//                 (N vs N-1). Clic sur un mois -> valeurs du mois.
//  - Portefeuille CDC : aires empilées hebdo par famille + N-1 (vue E), bouton
//    pour basculer en petits multiples par famille (vue F).
//
// Données :
//  - get_vision_bis_flux_familles(p_agence, p_collaborateur) : mois x famille,
//    N et N-1 (montant du mois + montant à date pour N-1).
//  - get_vision_bis_portefeuille_cdc(p_agence, p_collaborateur) : portefeuille
//    CDC reconstitué en fin de semaine, par famille (recalcul 12h40 / 23h40).
//  - Périmètre : restrictions agence / collaborateur du profil
//    (usePageFilterAccess), sinon sélecteurs libres.

import React, { useEffect, useMemo, useState } from "react";
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

const MOIS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const LS_CARDS = "visionBis.cartes";
const LS_MODES = "visionBis.modes";
const LS_TOP = "visionBis.topFamilles";
const LS_AGENDA = "visionBis.agendaOuvert";
const LS_TODO = "visionBis.todoOuverte";

const GRID = "rgba(var(--cg-ink-rgb), 0.10)";
const AXIS = "rgba(var(--cg-ink-rgb), 0.55)";

// ─── Utilitaires ─────────────────────────────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

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
              color: active ? color : "var(--cg-ink-soft)",
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--cg-ink-soft)" }}>
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
    <div className="rounded-lg border px-3 py-2 text-[11px] shadow-lg" style={{ background: "var(--cg-card)", borderColor: GRID, color: "var(--cg-ink)" }}>
      <div className="mb-1 font-bold">{label}{kind ? ` · ${kind}` : ""}</div>
      <table className="tabular-nums">
        <thead>
          <tr style={{ color: "var(--cg-ink-soft)" }}>
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
              <td className="pr-3 text-right" style={{ color: "var(--cg-ink-soft)" }}>{fmtEur(l.p)}</td>
              <td className="text-right">{row.hasN === false ? "—" : fmtPct(evol(l.n, l.p))}</td>
            </tr>
          ))}
          <tr className="border-t font-bold" style={{ borderColor: GRID }}>
            <td className="pr-3 pt-1">Total</td>
            <td className="pr-3 pt-1 text-right">{row.hasN === false ? "—" : fmtEur(totN)}</td>
            <td className="pr-3 pt-1 text-right" style={{ color: "var(--cg-ink-soft)" }}>{fmtEur(totP)}</td>
            <td className="pt-1 text-right">{row.hasN === false ? "—" : fmtPct(evol(totN, totP))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Carte graphe "flux" (BL / Factures / CDC / Devis) ───────────────────

function FluxCard({
  type, label, color, rows, topN, mode, onMode, anneeN,
}: {
  type: DocType; label: string; color: string; rows: FluxRow[]; topN: number;
  mode: Mode; onMode: (m: Mode) => void; anneeN: number;
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

  return (
    <div className="flex flex-col rounded-2xl border-2 p-3" style={{ borderColor: `${color}55`, background: "var(--cg-card)" }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <span className="text-[14px] font-extrabold uppercase tracking-[0.08em]" style={{ color }}>{label}</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--cg-ink)" }}>
          <b>{fmtEur(kpi.n)}</b> YtD
          <span className="ml-1.5" style={{ color: kpi.e !== null && kpi.e < 0 ? "var(--cg-down-ink)" : "var(--cg-up-ink)" }}>{fmtPct(kpi.e)}</span>
          <span className="ml-1.5" style={{ color: "var(--cg-ink-soft)" }}>vs {fmtEur(kpi.p)}</span>
        </span>
        <div className="ml-auto">
          <Segmented<Mode>
            value={mode}
            onChange={(m) => { setMoisSel(null); onMode(m); }}
            color={color}
            options={[{ v: "mensuel", l: "Mensuel" }, { v: "cumul", l: "Cumulé" }, { v: "base100", l: "Base 100" }]}
          />
        </div>
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
            <span className="whitespace-nowrap text-[10px]" style={{ color: "var(--cg-ink-soft)" }}>barre fine terne = N-1</span>
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
          <div className="w-[200px] shrink-0 rounded-xl border p-2" style={{ borderColor: GRID, background: "var(--cg-panel)" }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color }}>
                {moisSel ? `${MOIS[moisSel - 1]} ${anneeN}` : `YtD ${anneeN}`}
              </span>
              {moisSel && (
                <button type="button" onClick={() => setMoisSel(null)} className="text-[10px] font-bold underline" style={{ color: "var(--cg-ink-soft)" }}>
                  ← YtD
                </button>
              )}
            </div>
            <table className="w-full text-[11px] tabular-nums" style={{ color: "var(--cg-ink)" }}>
              <thead>
                <tr style={{ color: "var(--cg-ink-soft)" }}>
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
                      <td className="text-right" style={{ color: "var(--cg-ink-soft)" }}>{Math.round(partP * 100)}%</td>
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
            <div className="mt-1 text-[10px]" style={{ color: "var(--cg-ink-soft)" }}>
              {moisSel ? "Cliquer à nouveau le mois pour revenir au YtD." : "Cliquer un mois pour le détail."} N-1 du mois en cours : à date.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Carte Portefeuille CDC (E : aires empilées / F : petits multiples) ──

function PortefeuilleCard({ rows, topN, color, anneeN }: { rows: PfRow[]; topN: number; color: string; anneeN: number }) {
  const [vue, setVue] = useState<"E" | "F">(() => (typeof window === "undefined" ? "E" : lsGet<"E" | "F">("visionBis.pfVue", "E")));
  useEffect(() => { lsSet("visionBis.pfVue", vue); }, [vue]);

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
    <div className="flex flex-col rounded-2xl border-2 p-3" style={{ borderColor: `${color}55`, background: "var(--cg-card)" }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <span className="text-[14px] font-extrabold uppercase tracking-[0.08em]" style={{ color }}>Portefeuille CDC</span>
        {actuel && (
          <span className="text-[12px] tabular-nums" style={{ color: "var(--cg-ink)" }}>
            <b>{fmtEur(actuel.totN)}</b> S{semaineCourante}
            <span className="ml-1.5" style={{ color: e !== null && e < 0 ? "var(--cg-down-ink)" : "var(--cg-up-ink)" }}>{fmtPct(e)}</span>
            <span className="ml-1.5" style={{ color: "var(--cg-ink-soft)" }}>vs {fmtEur(actuel.totP)}</span>
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
              <div key={f} className="rounded-xl border p-2" style={{ borderColor: GRID, background: "var(--cg-panel)" }}>
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
                        contentStyle={{ background: "var(--cg-card)", border: `1px solid ${GRID}`, fontSize: 11 }}
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
      <div className="mt-1 text-[10px]" style={{ color: "var(--cg-ink-soft)" }}>
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

  if (loading) return <div className="p-2 text-[12px]" style={{ color: "var(--cg-ink-soft)" }}>Chargement…</div>;
  if (rdvs.length === 0) {
    return (
      <div className="p-2 text-[12px]" style={{ color: "var(--cg-ink-soft)" }}>
        Aucun rendez-vous sur 14 jours. <button type="button" className="underline" onClick={onOpenFull}>Ouvrir l’agenda</button>
      </div>
    );
  }
  return (
    <div className="max-h-[34vh] overflow-y-auto pr-1">
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
              <span className="w-10 shrink-0 tabular-nums" style={{ color: "var(--cg-ink-soft)" }}>
                {r.allDay ? "jour" : new Date(r.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <b>{r.company || r.subject}</b>
                {r.company && <span style={{ color: "var(--cg-ink-soft)" }}> · {r.subject}</span>}
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
  title, icon, color, open, onToggle, actions, children,
}: {
  title: string; icon: string; color: string; open: boolean; onToggle: () => void;
  actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border-2" style={{ borderColor: `${color}55` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: `${color}22`, borderBottom: open ? `2px solid ${color}` : "none" }}>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-[16px]">{icon}</span>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.1em]" style={{ color }}>{title}</span>
          <span className="text-[12px]" style={{ color }}>{open ? "▾" : "▸"}</span>
        </button>
        {actions}
      </div>
      {open && <div className="bg-[color:var(--cg-bg)] p-2">{children}</div>}
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

// ─── Page ────────────────────────────────────────────────────────────────

export default function VisionTciBisPage() {
  const { isMobile } = useViewport();
  const access = usePageFilterAccess();
  const anneeN = new Date().getFullYear();

  const [cartes, setCartes] = useState<CardKey[]>(["CDC", "BL", "Factures", "PORTEFEUILLE"]);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [topN, setTopN] = useState<number>(5);
  const [agendaOpen, setAgendaOpen] = useState(true);
  const [todoOpen, setTodoOpen] = useState(true);
  const [prefsLues, setPrefsLues] = useState(false);
  const [overlay, setOverlay] = useState<null | "agenda" | "todo">(null);

  const [agence, setAgence] = useState<string>("");
  const [collaborateur, setCollaborateur] = useState<string>("");
  const [collabs, setCollabs] = useState<{ nom: string; agence: string }[]>([]);

  const [flux, setFlux] = useState<FluxRow[]>([]);
  const [pf, setPf] = useState<PfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Préférences locales
  useEffect(() => {
    setCartes(lsGet<CardKey[]>(LS_CARDS, ["CDC", "BL", "Factures", "PORTEFEUILLE"]));
    setModes(lsGet<Record<string, Mode>>(LS_MODES, {}));
    setTopN(lsGet<number>(LS_TOP, 5));
    setAgendaOpen(lsGet<boolean>(LS_AGENDA, true));
    setTodoOpen(lsGet<boolean>(LS_TODO, true));
    setPrefsLues(true);
  }, []);
  useEffect(() => { if (prefsLues) lsSet(LS_CARDS, cartes); }, [cartes, prefsLues]);
  useEffect(() => { if (prefsLues) lsSet(LS_MODES, modes); }, [modes, prefsLues]);
  useEffect(() => { if (prefsLues) lsSet(LS_TOP, topN); }, [topN, prefsLues]);
  useEffect(() => { if (prefsLues) lsSet(LS_AGENDA, agendaOpen); }, [agendaOpen, prefsLues]);
  useEffect(() => { if (prefsLues) lsSet(LS_TODO, todoOpen); }, [todoOpen, prefsLues]);

  // Périmètre imposé par le profil
  const agenceForcee = access.hasAgenceRestriction && access.allowedAgences.length > 0 ? access.allowedAgences[0] : null;
  const collaborateurForce = access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0 ? access.allowedCollaborateurs[0] : null;
  const effAgence = agenceForcee || agence || null;
  const effCollab = collaborateurForce || collaborateur || null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ref_collaborateurs").select("nom, agence, mise_en_sommeil").order("nom");
      setCollabs(((data || []) as any[])
        .filter((c) => c.nom && c.agence && !c.mise_en_sommeil && !String(c.nom).includes(" "))
        .map((c) => ({ nom: String(c.nom), agence: String(c.agence) })));
    })();
  }, []);
  const agences = useMemo(() => Array.from(new Set(collabs.map((c) => c.agence))).sort(), [collabs]);
  const collabsVisibles = useMemo(
    () => collabs.filter((c) => !effAgence || c.agence === effAgence),
    [collabs, effAgence],
  );

  useEffect(() => {
    if (access.loading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      supabase.rpc("get_vision_bis_flux_familles", { p_agence: effAgence, p_collaborateur: effCollab }),
      supabase.rpc("get_vision_bis_portefeuille_cdc", { p_agence: effAgence, p_collaborateur: effCollab }),
    ]).then(([f, p]) => {
      if (cancelled) return;
      if (f.error) setError(f.error.message);
      else if (p.error) setError(p.error.message);
      setFlux(((f.data || []) as any[]).map((r) => ({ ...r, montant: Number(r.montant || 0), montant_a_date: Number(r.montant_a_date || 0) })));
      setPf(((p.data || []) as any[]).map((r) => ({ ...r, montant: Number(r.montant || 0) })));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [access.loading, effAgence, effCollab]);

  function toggleCarte(k: CardKey) {
    setCartes((cur) => {
      if (cur.includes(k)) return cur.filter((c) => c !== k);
      const ordre = CARDS.map((c) => c.key);
      return [...cur, k].sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b));
    });
  }

  if (isMobile) return <MobileStandaloneActivite />;

  const selectCls = "rounded-lg border px-2 py-1 text-[12px] font-semibold";
  const selectStyle = { background: "var(--cg-panel)", borderColor: GRID, color: "var(--cg-ink)" } as React.CSSProperties;

  return (
    <div className="min-h-screen w-full bg-[color:var(--cg-bg)] p-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        {/* ── Colonne graphes (2/3) ── */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {CARDS.map((c) => {
              const on = cartes.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleCarte(c.key)}
                  className="rounded-full border-2 px-3 py-1 text-[12px] font-bold transition"
                  style={{
                    borderColor: on ? c.color : GRID,
                    background: on ? `${c.color}2A` : "transparent",
                    color: on ? c.color : "var(--cg-ink-soft)",
                  }}
                >
                  {on ? "✓ " : "+ "}{c.label}
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px" style={{ background: GRID }} />
            <span className="text-[11px] font-semibold" style={{ color: "var(--cg-ink-soft)" }}>Familles</span>
            <Segmented<string>
              value={String(topN)}
              onChange={(v) => setTopN(Number(v))}
              color="#2E5BB8"
              options={[{ v: "3", l: "Top 3" }, { v: "5", l: "Top 5" }, { v: "8", l: "Top 8" }]}
            />
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

          {error && (
            <div className="mb-3 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "var(--cg-danger-border)", background: "var(--cg-danger-bg)", color: "var(--cg-danger-text)" }}>
              {error}
            </div>
          )}

          {cartes.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-10 text-center text-[13px]" style={{ borderColor: GRID, color: "var(--cg-ink-soft)" }}>
              Choisissez un ou plusieurs types de document ci-dessus.
            </div>
          ) : (
            <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${loading ? "opacity-60" : ""}`}>
              {cartes.map((k) => {
                const def = CARDS.find((c) => c.key === k)!;
                if (k === "PORTEFEUILLE") {
                  return <PortefeuilleCard key={k} rows={pf} topN={topN} color={def.color} anneeN={anneeN} />;
                }
                return (
                  <FluxCard
                    key={k}
                    type={k}
                    label={def.label}
                    color={def.color}
                    rows={flux}
                    topN={topN}
                    anneeN={anneeN}
                    mode={modes[k] || "mensuel"}
                    onMode={(m) => setModes((cur) => ({ ...cur, [k]: m }))}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── Colonne agenda / todo (1/3) ── */}
        <div className="flex min-w-0 flex-col gap-4">
          <SidePanel
            title="Mon Agenda"
            icon="📅"
            color="#7A5EA8"
            open={agendaOpen}
            onToggle={() => setAgendaOpen((v) => !v)}
            actions={
              <button type="button" onClick={() => setOverlay("agenda")} className="rounded-lg border px-2 py-0.5 text-[11px] font-bold"
                style={{ color: "#7A5EA8", borderColor: "#7A5EA888" }}>
                Agenda complet ⤢
              </button>
            }
          >
            <AgendaCompact onOpenFull={() => setOverlay("agenda")} />
          </SidePanel>

          <SidePanel
            title="Ma Todo"
            icon="✅"
            color="#B4761A"
            open={todoOpen}
            onToggle={() => setTodoOpen((v) => !v)}
            actions={
              <button type="button" onClick={() => setOverlay("todo")} className="rounded-lg border px-2 py-0.5 text-[11px] font-bold"
                style={{ color: "#B4761A", borderColor: "#B4761A88" }}>
                Agrandir ⤢
              </button>
            }
          >
            <div className="max-h-[52vh] overflow-auto">
              <TodoDenseList />
            </div>
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
