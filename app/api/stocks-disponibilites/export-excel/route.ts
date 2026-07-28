/**
 * GET /api/stocks-disponibilites/export-excel
 *
 * Génère un fichier Excel multi-onglets :
 *   1. "Projection stock" — données hebdo ou mensuelles avec sous-totaux par famille
 *   2. "Ventes N / N-1"   — historique mensuel ou hebdo des BL par référence
 *
 * Paramètres :
 *   famille      — filtre famille (optionnel)
 *   macro        — filtre famille macro (optionnel)
 *   granularite  — "mensuel" (défaut) | "hebdo"
 *
 * Prérequis : npm install exceljs
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as ExcelJS from "exceljs";

// ── Types ──────────────────────────────────────────────────────────────────
type Row = {
  reference_article: string;
  designation: string;
  famille: string;
  macro_famille: string;
  fournisseur_principal: string | null;
  depot: string;
  periode_debut: string;
  stock_initial: number | null;
  stock_securite: number | null;
  commandes_fournisseurs_attendues: number | null;
  besoins_clients_fermes: number | null;
  besoins_clients_retard: number | null;
  prevision_base_n1_origine: number | null;
  prevision_base_n1: number | null;
  coefficient_prevision_applique: number | null;
  prevision_ventes: number | null;
  stock_projete: number | null;
  niveau_alerte: string | null;
  date_rupture: string | null;
  statut_substitution: string | null;
  prevision_transferee_entrante: number | null;
};

type VenteRow = {
  reference_article: string;
  designation: string;
  famille: string;
  macro_famille: string;
  periode: string;
  annee: number;
  qte_n: number;
  qte_n1: number;
};

type FieldName = keyof Row;

const SELECT_COLS = (
  "reference_article,designation,famille,macro_famille," +
  "fournisseur_principal,depot,periode_debut," +
  "stock_initial,stock_securite," +
  "commandes_fournisseurs_attendues,besoins_clients_fermes,besoins_clients_retard," +
  "prevision_base_n1_origine,prevision_base_n1," +
  "coefficient_prevision_applique,prevision_ventes," +
  "stock_projete,niveau_alerte,date_rupture," +
  "statut_substitution,prevision_transferee_entrante"
);

const GROUPES: Array<{ label: string; fields: FieldName[]; bgARGB: string; headerColor: string }> = [
  { label:"BL N-1",     fields:["prevision_base_n1_origine"],                          bgARGB:"FFE8F0E9", headerColor:"3F9142" },
  { label:"PRÉVISIONS", fields:["coefficient_prevision_applique","prevision_ventes"],  bgARGB:"FFFFF3E0", headerColor:"C1683C" },
  { label:"CDC FERMES", fields:["besoins_clients_fermes","besoins_clients_retard"],    bgARGB:"FFF3EEF8", headerColor:"7A5EA8" },
  { label:"ENTRÉES CF", fields:["commandes_fournisseurs_attendues"],                   bgARGB:"FFE3F0F4", headerColor:"4B92AC" },
  { label:"STOCK",      fields:["stock_projete","stock_securite"],                     bgARGB:"FFE8F4FD", headerColor:"0B1220" },
];

// Colonnes qui ont un sous-total (pas les colonnes "ratio" comme hyp. ×)
const SUM_FIELDS: Set<FieldName> = new Set([
  "prevision_base_n1_origine","prevision_ventes",
  "besoins_clients_fermes","besoins_clients_retard",
  "commandes_fournisseurs_attendues","stock_projete","stock_securite",
]);

const LABELS: Partial<Record<FieldName, string>> = {
  prevision_base_n1_origine:        "Ventes N-1",
  coefficient_prevision_applique:   "Hyp. ×",
  prevision_ventes:                 "Prévision",
  besoins_clients_fermes:           "CDC fermes",
  besoins_clients_retard:           "CDC retard",
  commandes_fournisseurs_attendues: "Entrées CF",
  stock_projete:                    "Stock projeté",
  stock_securite:                   "Stk sécu.",
};

const INFO_FIELDS: FieldName[] = [
  "macro_famille","famille","reference_article","designation",
  "fournisseur_principal","stock_initial","statut_substitution","niveau_alerte","date_rupture",
];
const INFO_LABELS = ["Fam. macro","Famille","Référence","Désignation","Fournisseur","Stk actuel","Statut","Alerte","Rupture"];
const INFO_WIDTHS = [14,14,18,44,18,9,14,8,12];

const ALERTE_BG: Record<string,string>  = { ROUGE:"FFFEE2D5", ORANGE:"FFFEF3CD", JAUNE:"FFFEFBCA", VERT:"FFD1E7DD" };
const STATUT_COLOR: Record<string,string> = { REMPLACEE:"8A93A6", REMPLACANTE:"3F9142", PARTIELLE:"C1683C", ACTIVE:"141A26" };

const thin = (): ExcelJS.Border => ({ style:"thin", color:{ argb:"FFD0CAC0" } });
const allB  = (): Partial<ExcelJS.Borders> => ({ left:thin(), right:thin(), top:thin(), bottom:thin() });
const thickBottom = (): Partial<ExcelJS.Borders> => ({ left:thin(), right:thin(), top:thin(), bottom:{ style:"medium", color:{ argb:"FF0B1220" } } });

// ── Agrégation mensuelle ───────────────────────────────────────────────────
function agrMensuel(rows: Row[]): Row[] {
  const sumF: FieldName[] = [
    "commandes_fournisseurs_attendues","besoins_clients_fermes","besoins_clients_retard",
    "prevision_base_n1_origine","prevision_base_n1","prevision_ventes","prevision_transferee_entrante",
  ];
  const poids: Record<string,number> = { ROUGE:3, ORANGE:2, JAUNE:1, VERT:0 };
  const agg = new Map<string, Row>();
  for (const r of rows) {
    const k = r.reference_article + "|" + r.periode_debut.slice(0,7);
    if (!agg.has(k)) {
      const copy: Row = { ...r, periode_debut: r.periode_debut.slice(0,7) };
      for (const f of sumF) (copy as Record<string,unknown>)[f] = 0;
      agg.set(k, copy);
    }
    const a = agg.get(k)!;
    for (const f of sumF) {
      (a as Record<string,unknown>)[f] = ((a[f] as number) || 0) + ((r[f] as number) || 0);
    }
    a.stock_projete = r.stock_projete;
    if ((poids[r.niveau_alerte ?? "VERT"] ?? 0) > (poids[a.niveau_alerte ?? "VERT"] ?? 0))
      a.niveau_alerte = r.niveau_alerte;
    if (r.date_rupture && (!a.date_rupture || r.date_rupture < a.date_rupture))
      a.date_rupture = r.date_rupture;
  }
  return [...agg.values()];
}

function labelPeriode(pd: string, granularite: string): string {
  try {
    if (granularite === "hebdo") {
      const d   = new Date(pd);
      const jan = new Date(d.getFullYear(), 0, 1);
      const wk  = Math.ceil(((d.getTime() - jan.getTime()) / 86400000 + jan.getDay() + 1) / 7);
      return `S${String(wk).padStart(2,"0")} ${d.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})}`;
    }
    return new Date(pd + "-01").toLocaleDateString("fr-FR",{ month:"short", year:"numeric" });
  } catch { return pd; }
}

// ── Handler ────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const userToken  = authHeader.replace(/^Bearer\s+/i, "").trim();
  const supabase   = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    userToken ? { global: { headers: { Authorization: `Bearer ${userToken}` } } } : undefined,
  );

  const { searchParams } = new URL(req.url);
  const famille     = searchParams.get("famille")     ?? "";
  const macro       = searchParams.get("macro")       ?? "";
  const granularite = searchParams.get("granularite") ?? "mensuel";

  // ── 1. Données projection ────────────────────────────────────────────────
  let projQuery = supabase.from("v_stock_projection_hebdo_latest").select(SELECT_COLS)
    .order("macro_famille").order("famille").order("reference_article").order("periode_debut");
  if (famille)    projQuery = projQuery.eq("famille",       famille);
  else if (macro) projQuery = projQuery.eq("macro_famille", macro);

  // ── 2. Données ventes historiques ────────────────────────────────────────
  const ventesQuery = supabase.rpc("get_stock_ventes_historique", {
    p_famille:       famille || null,
    p_famille_macro: (!famille && macro) ? macro : null,
    p_granularite:   granularite,
  });

  const [{ data: projData, error: projErr }, { data: ventesData, error: ventesErr }] =
    await Promise.all([projQuery, ventesQuery]);

  if (projErr)         return NextResponse.json({ error: projErr.message }, { status: 500 });
  if (!projData?.length) return NextResponse.json({ error: "Aucune donnée de projection" }, { status: 404 });

  let rows: Row[] = projData as unknown as Row[];
  if (granularite === "mensuel") rows = agrMensuel(rows);

  const ventesRows: VenteRow[] = (ventesData ?? []) as unknown as VenteRow[];

  const allPeriods = [...new Set(rows.map(r => r.periode_debut))].sort();
  const allMetrics = GROUPES.flatMap(g => g.fields);
  const nM  = allMetrics.length;
  const INFO_N  = INFO_FIELDS.length;
  const GRP_START = INFO_N + 1;

  // Index des données projection
  const idx = new Map<string, Row>();
  for (const r of rows) idx.set(r.reference_article + "|" + r.periode_debut, r);

  // Ordre des références et familles
  const refs: string[] = [];
  const refFirst = new Map<string, Row>();
  for (const r of rows) {
    if (!refFirst.has(r.reference_article)) { refFirst.set(r.reference_article, r); refs.push(r.reference_article); }
  }
  const familles = [...new Set(refs.map(ref => refFirst.get(ref)!.famille))];

  // ── Excel ─────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "CEGECLIM";
  wb.created = new Date();

  // ══════════════════════════════════════════════════════════════════════════
  // ONGLET 1 — PROJECTION STOCK
  // ══════════════════════════════════════════════════════════════════════════
  const ws = wb.addWorksheet("Projection stock", {
    views: [{ state:"frozen", xSplit:INFO_N, ySplit:3 }],
  });
  ws.properties.showGridLines = false;

  ws.columns = [
    ...INFO_WIDTHS.map(w => ({ width: w })),
    ...Array<{ width: number }>(nM * allPeriods.length).fill({ width: 8.5 }),
  ];

  // Ligne 1 : titre
  const totalCols = INFO_N + nM * allPeriods.length;
  ws.mergeCells(1, 1, 1, totalCols);
  const r1 = ws.getRow(1); r1.height = 26;
  const c1t = r1.getCell(1);
  c1t.value     = (famille || macro || "Toutes familles") + " — Projection stock " + granularite.toUpperCase();
  c1t.font      = { name:"Arial", bold:true, size:13, color:{ argb:"FFFFFFFF" } };
  c1t.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
  c1t.alignment = { horizontal:"left", vertical:"middle", indent:1 };
  r1.commit();

  // Ligne 2 : colonnes info fusionnées + étiquettes périodes
  const r2 = ws.getRow(2); r2.height = 26;
  for (let ci = 1; ci <= INFO_N; ci++) {
    ws.mergeCells(2, ci, 3, ci);
    const c = r2.getCell(ci);
    c.value     = INFO_LABELS[ci - 1];
    c.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
    c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
    c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
    c.border    = allB();
  }
  allPeriods.forEach((pd, pi) => {
    const startC = GRP_START + pi * nM;
    ws.mergeCells(2, startC, 2, startC + nM - 1);
    const c = r2.getCell(startC);
    c.value     = labelPeriode(pd, granularite);
    c.font      = { name:"Arial", bold:true, size:7, color:{ argb:"FFFFFFFF" } };
    c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFA6A181" } };
    c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
    c.border    = allB();
  });
  r2.commit();

  // Ligne 3 : labels métriques
  const r3 = ws.getRow(3); r3.height = 26;
  let mOff = 0;
  for (const g of GROUPES) {
    allPeriods.forEach((_, pi) => {
      g.fields.forEach((field, mi) => {
        const c = r3.getCell(GRP_START + pi * nM + mOff + mi);
        c.value     = LABELS[field] ?? String(field);
        c.font      = { name:"Arial", bold:true, size:7, color:{ argb:"FF" + g.headerColor } };
        c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:g.bgARGB } };
        c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
        c.border    = allB();
      });
    });
    mOff += g.fields.length;
  }
  r3.commit();

  // ── Données par famille avec sous-totaux ──────────────────────────────────
  let currentRow = 4;

  for (const famille_key of familles) {
    const famRefs = refs.filter(ref => refFirst.get(ref)!.famille === famille_key);
    const firstRowOfFamille = currentRow;

    // Lignes articles
    for (const ref of famRefs) {
      const r0      = refFirst.get(ref)!;
      const statut  = r0.statut_substitution ?? "ACTIVE";
      const rowBg   = statut === "REMPLACEE" ? "FFF8F5EF" : "FFFFFFFF";
      const dataRow = ws.getRow(currentRow);
      dataRow.height = 15;

      INFO_FIELDS.forEach((field, ci) => {
        const c   = dataRow.getCell(ci + 1);
        const val = r0[field];
        c.value     = (val === null || val === undefined) ? "" : val as ExcelJS.CellValue;
        c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb: rowBg } };
        c.border    = allB();
        c.alignment = { horizontal:"left", vertical:"middle" };
        c.font      = { name:"Arial", size:8, color:{ argb:"FF141A26" } };
        if (field === "reference_article")
          c.font = { name:"Arial", bold:true, size:8, color:{ argb:"FF" + (STATUT_COLOR[statut] ?? "141A26") } };
        if (field === "niveau_alerte") {
          c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: ALERTE_BG[String(val ?? "VERT")] ?? rowBg } };
          c.alignment = { horizontal:"center", vertical:"middle" };
        }
        if (field === "date_rupture" && val)
          c.font = { name:"Arial", size:8, color:{ argb:"FFC1683C" } };
      });

      let mo = 0;
      for (const g of GROUPES) {
        allPeriods.forEach((pd, pi) => {
          const r = idx.get(ref + "|" + pd);
          g.fields.forEach((field, mi) => {
            const c   = dataRow.getCell(GRP_START + pi * nM + mo + mi);
            const raw = r ? r[field] : null;
            const num = raw === null || raw === undefined ? null : Number(raw);
            c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb: g.bgARGB } };
            c.border    = allB();
            c.alignment = { horizontal:"right", vertical:"middle" };
            c.font      = { name:"Arial", size:8, color:{ argb:"FF141A26" } };
            if (num === null) { c.value = ""; }
            else if (field === "coefficient_prevision_applique") { c.value = num; c.numFmt = '0.00"×"'; }
            else if (field === "stock_projete" && num < 0) {
              c.value = Math.round(num * 10) / 10;
              c.numFmt = "#,##0;[Red]-#,##0;-";
              c.font   = { name:"Arial", bold:true, size:8, color:{ argb:"FFC1683C" } };
            } else {
              c.value  = Math.round(num * 10) / 10;
              c.numFmt = "#,##0.#";
            }
          });
        });
        mo += g.fields.length;
      }
      dataRow.commit();
      currentRow++;
    }

    // ── Ligne de sous-total famille ──────────────────────────────────────────
    const stRow = ws.getRow(currentRow);
    stRow.height = 16;
    const dataStart = firstRowOfFamille;
    const dataEnd   = currentRow - 1;

    // Label
    const labelCell = stRow.getCell(1);
    labelCell.value     = `Sous-total ${famille_key}`;
    labelCell.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
    labelCell.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
    labelCell.alignment = { horizontal:"left", vertical:"middle" };
    labelCell.border    = thickBottom();
    ws.mergeCells(currentRow, 1, currentRow, INFO_N);
    for (let ci = 2; ci <= INFO_N; ci++) {
      const c = stRow.getCell(ci);
      c.fill   = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
      c.border = thickBottom();
    }

    // Formules SOMME par colonne métrique
    let mo2 = 0;
    for (const g of GROUPES) {
      allPeriods.forEach((_, pi) => {
        g.fields.forEach((field, mi) => {
          const col = GRP_START + pi * nM + mo2 + mi;
          const c   = stRow.getCell(col);
          c.fill    = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF1A2742" } };
          c.border  = thickBottom();
          c.alignment = { horizontal:"right", vertical:"middle" };
          if (SUM_FIELDS.has(field)) {
            const colLetter = ws.getColumn(col).letter;
            c.value  = { formula: `SUM(${colLetter}${dataStart}:${colLetter}${dataEnd})` };
            c.numFmt = "#,##0.#";
            c.font   = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
          } else {
            c.value = "";
          }
        });
      });
      mo2 += g.fields.length;
    }
    stRow.commit();
    currentRow++;
  }

  ws.autoFilter = { from:{ row:3, column:1 }, to:{ row:3, column:INFO_N } };

  // ══════════════════════════════════════════════════════════════════════════
  // ONGLET 2 — VENTES N / N-1
  // ══════════════════════════════════════════════════════════════════════════
  const wv = wb.addWorksheet("Ventes N-N-1", {
    views: [{ state:"frozen", xSplit:4, ySplit:3 }],
  });
  wv.properties.showGridLines = false;

  const ventePeriods = [...new Set(ventesRows.map(v => v.periode))].sort();
  const venteRefs    = [...new Set(ventesRows.map(v => v.reference_article))];
  const venteIdx     = new Map<string, VenteRow>();
  for (const v of ventesRows) venteIdx.set(v.reference_article + "|" + v.periode, v);
  const venteFirst   = new Map<string, VenteRow>();
  for (const v of ventesRows) if (!venteFirst.has(v.reference_article)) venteFirst.set(v.reference_article, v);

  // Familles ventes
  const venteFamilles = [...new Set(venteRefs.map(ref => venteFirst.get(ref)?.famille ?? ""))];

  const V_INFO = ["Fam. macro","Famille","Référence","Désignation"];
  const V_WIDTHS = [14,14,18,44];
  const NP = ventePeriods.length;
  const V_INFO_N = V_INFO.length;

  wv.columns = [
    ...V_WIDTHS.map(w => ({ width: w })),
    ...Array<{ width: number }>(NP * 2).fill({ width: 8 }),
  ];

  // Titre
  wv.mergeCells(1, 1, 1, V_INFO_N + NP * 2);
  const vr1 = wv.getRow(1); vr1.height = 26;
  const vc1 = vr1.getCell(1);
  vc1.value     = (famille || macro || "Toutes familles") + " — Ventes BL " + granularite.toUpperCase();
  vc1.font      = { name:"Arial", bold:true, size:13, color:{ argb:"FFFFFFFF" } };
  vc1.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
  vc1.alignment = { horizontal:"left", vertical:"middle", indent:1 };
  vr1.commit();

  // Ligne 2 : en-têtes info + périodes (chaque période = 2 colonnes : N et N-1)
  const vr2 = wv.getRow(2); vr2.height = 26;
  for (let ci = 1; ci <= V_INFO_N; ci++) {
    wv.mergeCells(2, ci, 3, ci);
    const c = vr2.getCell(ci);
    c.value     = V_INFO[ci-1];
    c.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
    c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
    c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
    c.border    = allB();
  }
  ventePeriods.forEach((pd, pi) => {
    const startC = V_INFO_N + 1 + pi * 2;
    wv.mergeCells(2, startC, 2, startC + 1);
    const c = vr2.getCell(startC);
    c.value     = labelPeriode(pd, granularite);
    c.font      = { name:"Arial", bold:true, size:7, color:{ argb:"FFFFFFFF" } };
    c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFA6A181" } };
    c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
    c.border    = allB();
  });
  vr2.commit();

  // Ligne 3 : N / N-1 par période
  const vr3 = wv.getRow(3); vr3.height = 22;
  ventePeriods.forEach((_, pi) => {
    const cN  = vr3.getCell(V_INFO_N + 1 + pi * 2);
    const cN1 = vr3.getCell(V_INFO_N + 2 + pi * 2);
    cN.value  = "N"; cN1.value = "N-1";
    for (const c of [cN, cN1]) {
      c.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FF0B1220" } };
      c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFE8F0E9" } };
      c.alignment = { horizontal:"center", vertical:"middle" };
      c.border    = allB();
    }
    cN.fill  = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFE8F0E9" } };
    cN1.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFEF9F0" } };
  });
  vr3.commit();

  // Données ventes par famille avec sous-totaux
  let vRow = 4;
  for (const fam of venteFamilles) {
    const famVenteRefs = venteRefs.filter(r => (venteFirst.get(r)?.famille ?? "") === fam);
    const famStart = vRow;

    for (const ref of famVenteRefs) {
      const vfirst  = venteFirst.get(ref);
      const dataRow = wv.getRow(vRow);
      dataRow.height = 15;

      const infoVals = [
        vfirst?.macro_famille ?? "",
        vfirst?.famille ?? "",
        ref,
        vfirst?.designation ?? "",
      ];
      infoVals.forEach((val, ci) => {
        const c = dataRow.getCell(ci + 1);
        c.value     = val;
        c.font      = { name:"Arial", size:8, bold: ci === 2, color:{ argb:"FF141A26" } };
        c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFFFFF" } };
        c.border    = allB();
        c.alignment = { horizontal:"left", vertical:"middle" };
      });

      ventePeriods.forEach((pd, pi) => {
        const v   = venteIdx.get(ref + "|" + pd);
        const cN  = dataRow.getCell(V_INFO_N + 1 + pi * 2);
        const cN1 = dataRow.getCell(V_INFO_N + 2 + pi * 2);
        cN.value  = v ? Math.round(v.qte_n * 10) / 10 : 0;
        cN1.value = v ? Math.round(v.qte_n1 * 10) / 10 : 0;
        for (const [c, bg] of [[cN,"FFE8F0E9"],[cN1,"FFFEF9F0"]] as [ExcelJS.Cell, string][]) {
          c.numFmt    = "#,##0.#";
          c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:bg } };
          c.border    = allB();
          c.alignment = { horizontal:"right", vertical:"middle" };
          c.font      = { name:"Arial", size:8, color:{ argb:"FF141A26" } };
        }
      });
      dataRow.commit();
      vRow++;
    }

    // Sous-total ventes famille
    const stV = wv.getRow(vRow);
    stV.height = 16;
    wv.mergeCells(vRow, 1, vRow, V_INFO_N);
    const stLabel = stV.getCell(1);
    stLabel.value     = `Sous-total ${fam}`;
    stLabel.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
    stLabel.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
    stLabel.alignment = { horizontal:"left", vertical:"middle" };
    stLabel.border    = thickBottom();
    for (let ci = 2; ci <= V_INFO_N; ci++) {
      const c = stV.getCell(ci);
      c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
      c.border = thickBottom();
    }
    ventePeriods.forEach((_, pi) => {
      const cN  = stV.getCell(V_INFO_N + 1 + pi * 2);
      const cN1 = stV.getCell(V_INFO_N + 2 + pi * 2);
      const colN  = wv.getColumn(V_INFO_N + 1 + pi * 2).letter;
      const colN1 = wv.getColumn(V_INFO_N + 2 + pi * 2).letter;
      cN.value  = { formula: `SUM(${colN}${famStart}:${colN}${vRow-1})` };
      cN1.value = { formula: `SUM(${colN1}${famStart}:${colN1}${vRow-1})` };
      for (const c of [cN, cN1]) {
        c.numFmt    = "#,##0.#";
        c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF1A2742" } };
        c.border    = thickBottom();
        c.alignment = { horizontal:"right", vertical:"middle" };
        c.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
      }
    });
    stV.commit();
    vRow++;
  }

  wv.autoFilter = { from:{ row:3, column:1 }, to:{ row:3, column:V_INFO_N } };

  // ══════════════════════════════════════════════════════════════════════════
  // ONGLET 3 — LÉGENDE
  // ══════════════════════════════════════════════════════════════════════════
  const leg = wb.addWorksheet("Légende");
  leg.getColumn(2).width = 30;
  leg.getColumn(3).width = 55;
  const legRows: [string|null,string|null,string|null][] = [
    ["PROJECTION DE STOCK — CEGECLIM",null,null],[null,null,null],
    ["COULEURS",null,null],
    [null,"Fond vert pâle","Ventes N-1"],[null,"Fond orange pâle","Prévisions"],
    [null,"Fond violet pâle","CDC fermes"],[null,"Fond bleu pâle","Entrées fournisseur"],
    [null,"Fond bleu clair","Stock projeté"],[null,"Vert sur fond sombre","Sous-total N"],[null,"Crème sur fond sombre","Sous-total N-1"],
    [null,null,null],["ALERTES",null,null],
    [null,"ROUGE","Stock insuffisant"],[null,"ORANGE","Stock tendu"],[null,"JAUNE","À surveiller"],[null,"VERT","Satisfaisant"],
    [null,null,null],["STATUTS",null,null],
    [null,"REMPLACEE","Besoins transférés, prévision 0 (grisé)"],[null,"REMPLACANTE","Reprend l'historique d'une ou plusieurs ref."],[null,"ACTIVE","Référence courante"],
    [null,null,null],["PÉRIMÈTRE",null,null],
    [null,"Famille macro",macro||"(toutes)"],[null,"Famille",famille||"(toutes)"],[null,"Granularité",granularite],
  ];
  legRows.forEach((lr, i) => {
    const row = leg.getRow(i+1);
    if (lr[0] && !lr[1]) {
      const c = row.getCell(2); c.value = lr[0];
      c.font = { name:"Arial",bold:true,size:10,color:{argb:"FF141A26"} };
      c.fill = { type:"pattern",pattern:"solid",fgColor:{argb:"FFA6A181"} };
    } else {
      if (lr[1]) { const c=row.getCell(2); c.value=lr[1]; c.font={name:"Arial",bold:true,size:9}; }
      if (lr[2]) { const c=row.getCell(3); c.value=lr[2]; c.font={name:"Arial",size:9}; }
    }
    row.commit();
  });

  // ── Sérialisation ──────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const scope  = famille || macro || "tous";

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="projection_stock_${scope}_${granularite}.xlsx"`,
    },
  });
}
