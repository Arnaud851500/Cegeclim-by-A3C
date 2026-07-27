/**
 * GET /api/stocks-disponibilites/export-excel
 *
 * Génère le fichier Excel en Node.js avec ExcelJS (npm install exceljs).
 * Paramètres : famille, macro, granularite (mensuel|hebdo)
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

// ── Colonnes lues ─────────────────────────────────────────────────────────
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

// ── Groupes ────────────────────────────────────────────────────────────────
type FieldName = keyof Row;

const GROUPES: Array<{
  label: string;
  fields: FieldName[];
  bgARGB: string;
  headerColor: string;
}> = [
  { label:"BL N-1",     fields:["prevision_base_n1_origine"],                              bgARGB:"FFE8F0E9", headerColor:"3F9142" },
  { label:"PRÉVISIONS", fields:["coefficient_prevision_applique","prevision_ventes"],       bgARGB:"FFFFF3E0", headerColor:"C1683C" },
  { label:"CDC FERMES", fields:["besoins_clients_fermes","besoins_clients_retard"],         bgARGB:"FFF3EEF8", headerColor:"7A5EA8" },
  { label:"ENTRÉES CF", fields:["commandes_fournisseurs_attendues"],                        bgARGB:"FFE3F0F4", headerColor:"4B92AC" },
  { label:"STOCK",      fields:["stock_projete","stock_securite"],                          bgARGB:"FFE8F4FD", headerColor:"0B1220" },
];

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
const INFO_LABELS  = ["Fam. macro","Famille","Référence","Désignation","Fournisseur","Stk actuel","Statut","Alerte","Rupture"];
const INFO_WIDTHS  = [14,14,18,44,18,9,14,8,12];

const ALERTE_BG: Record<string, string>  = { ROUGE:"FFFEE2D5", ORANGE:"FFFEF3CD", JAUNE:"FFFEFBCA", VERT:"FFD1E7DD" };
const STATUT_COLOR: Record<string,string> = { REMPLACEE:"8A93A6", REMPLACANTE:"3F9142", PARTIELLE:"C1683C", ACTIVE:"141A26" };

const thin = (argb = "FFD0CAC0"): ExcelJS.Border => ({ style:"thin", color:{ argb } });
const allBorders = (): Partial<ExcelJS.Borders> => ({ left:thin(), right:thin(), top:thin(), bottom:thin() });

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
      for (const f of sumF) (copy as Record<string, unknown>)[f] = 0;
      agg.set(k, copy);
    }
    const a = agg.get(k)!;
    for (const f of sumF) {
      (a as Record<string, unknown>)[f] = ((a[f] as number) || 0) + ((r[f] as number) || 0);
    }
    a.stock_projete = r.stock_projete;
    if ((poids[r.niveau_alerte ?? "VERT"] ?? 0) > (poids[a.niveau_alerte ?? "VERT"] ?? 0)) {
      a.niveau_alerte = r.niveau_alerte;
    }
    if (r.date_rupture && (!a.date_rupture || r.date_rupture < a.date_rupture)) {
      a.date_rupture = r.date_rupture;
    }
  }
  return [...agg.values()];
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

  let query = supabase
    .from("v_stock_projection_hebdo_latest")
    .select(SELECT_COLS)
    .order("macro_famille").order("famille").order("reference_article").order("periode_debut");
  if (famille)    query = query.eq("famille",       famille);
  else if (macro) query = query.eq("macro_famille", macro);

  const { data, error } = await query;
  if (error)         return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Aucune donnée" }, { status: 404 });

  let rows: Row[] = data as unknown as Row[];
  if (granularite === "mensuel") rows = agrMensuel(rows);

  const allPeriods = [...new Set(rows.map(r => r.periode_debut))].sort();
  const allMetrics = GROUPES.flatMap(g => g.fields);
  const nM = allMetrics.length;
  const nP = allPeriods.length;
  const INFO_N = INFO_FIELDS.length;
  const GRP_START = INFO_N + 1;

  const idx = new Map<string, Row>();
  for (const r of rows) idx.set(r.reference_article + "|" + r.periode_debut, r);

  const refs: string[] = [];
  const refFirst = new Map<string, Row>();
  for (const r of rows) {
    if (!refFirst.has(r.reference_article)) { refFirst.set(r.reference_article, r); refs.push(r.reference_article); }
  }

  // ── Workbook ─────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();

  // Légende
  const leg = wb.addWorksheet("Légende");
  leg.getColumn(2).width = 30;
  leg.getColumn(3).width = 55;
  const legRows: [string|null, string|null, string|null][] = [
    ["PROJECTION DE STOCK — CEGECLIM",null,null],
    [null,null,null],
    ["COULEURS",null,null],
    [null,"Fond vert pâle","Ventes N-1"],
    [null,"Fond orange pâle","Prévisions (hypothèse × et volume)"],
    [null,"Fond violet pâle","CDC fermes et retards"],
    [null,"Fond bleu pâle","Entrées fournisseur"],
    [null,"Fond bleu clair","Stock projeté"],
    [null,null,null],
    ["ALERTES",null,null],
    [null,"ROUGE","Stock insuffisant"],[null,"ORANGE","Stock tendu"],[null,"JAUNE","À surveiller"],[null,"VERT","Satisfaisant"],
    [null,null,null],
    ["STATUTS",null,null],
    [null,"REMPLACEE","Besoins transférés, prévision 0"],
    [null,"REMPLACANTE","Reprend l'historique d'une ou plusieurs références"],
    [null,"ACTIVE","Référence courante"],
    [null,null,null],
    ["PÉRIMÈTRE",null,null],
    [null,"Famille macro", macro||"(toutes)"],
    [null,"Famille", famille||"(toutes)"],
    [null,"Granularité", granularite],
  ];
  legRows.forEach((lr, i) => {
    const row = leg.getRow(i + 1);
    if (lr[0] && !lr[1]) {
      const c = row.getCell(2);
      c.value = lr[0];
      c.font  = { name:"Arial", bold:true, size:10, color:{ argb:"FF141A26" } };
      c.fill  = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFA6A181" } };
    } else {
      if (lr[1]) { const c = row.getCell(2); c.value = lr[1]; c.font = { name:"Arial", bold:true, size:9 }; }
      if (lr[2]) { const c = row.getCell(3); c.value = lr[2]; c.font = { name:"Arial", size:9 }; }
    }
    row.commit();
  });

  // Projection
  const ws = wb.addWorksheet("Projection stock", {
    views: [{ state:"frozen", xSplit:INFO_N, ySplit:3 }],
  });
  ws.properties.showGridLines = false;

  ws.columns = [
    ...INFO_WIDTHS.map(w => ({ width: w })),
    ...Array<{ width: number }>(nM * nP).fill({ width: 8.5 }),
  ];

  // Ligne 1 : titre
  ws.mergeCells(1, 1, 1, INFO_N + nM * nP);
  const r1 = ws.getRow(1); r1.height = 26;
  const c1 = r1.getCell(1);
  c1.value = (famille || macro || "Toutes familles") + " — Projection stock " + granularite.toUpperCase();
  c1.font  = { name:"Arial", bold:true, size:13, color:{ argb:"FFFFFFFF" } };
  c1.fill  = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
  c1.alignment = { horizontal:"left", vertical:"middle", indent:1 };
  r1.commit();

  // Ligne 2 : colonnes info (fusionnées sur lignes 2-3) + périodes
  const r2 = ws.getRow(2); r2.height = 26;
  for (let ci = 1; ci <= INFO_N; ci++) {
    ws.mergeCells(2, ci, 3, ci);
    const c = r2.getCell(ci);
    c.value     = INFO_LABELS[ci - 1];
    c.font      = { name:"Arial", bold:true, size:8, color:{ argb:"FFFFFFFF" } };
    c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF0B1220" } };
    c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
    c.border    = allBorders();
  }
  allPeriods.forEach((pd, pi) => {
    const startC = GRP_START + pi * nM;
    ws.mergeCells(2, startC, 2, startC + nM - 1);
    const c = r2.getCell(startC);
    let label = pd;
    try {
      if (granularite === "hebdo") {
        const d = new Date(pd);
        const jan = new Date(d.getFullYear(), 0, 1);
        const wk  = Math.ceil(((d.getTime() - jan.getTime()) / 86400000 + jan.getDay() + 1) / 7);
        label = `S${String(wk).padStart(2,"0")} ${d.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})}`;
      } else {
        label = new Date(pd + "-01").toLocaleDateString("fr-FR",{ month:"short", year:"numeric" });
      }
    } catch { /* keep pd */ }
    c.value     = label;
    c.font      = { name:"Arial", bold:true, size:7, color:{ argb:"FFFFFFFF" } };
    c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFA6A181" } };
    c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
    c.border    = allBorders();
  });
  r2.commit();

  // Ligne 3 : labels métriques
  const r3 = ws.getRow(3); r3.height = 26;
  let metricOffset = 0;
  for (const g of GROUPES) {
    allPeriods.forEach((_, pi) => {
      g.fields.forEach((field, mi) => {
        const col = GRP_START + pi * nM + metricOffset + mi;
        const c = r3.getCell(col);
        c.value     = LABELS[field] ?? String(field);
        c.font      = { name:"Arial", bold:true, size:7, color:{ argb:"FF" + g.headerColor } };
        c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb:g.bgARGB } };
        c.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
        c.border    = allBorders();
      });
    });
    metricOffset += g.fields.length;
  }
  r3.commit();

  // Données
  refs.forEach((ref, ri) => {
    const r0      = refFirst.get(ref)!;
    const statut  = r0.statut_substitution ?? "ACTIVE";
    const rowBg   = statut === "REMPLACEE" ? "FFF8F5EF" : "FFFFFFFF";
    const dataRow = ws.getRow(4 + ri);
    dataRow.height = 15;

    INFO_FIELDS.forEach((field, ci) => {
      const c   = dataRow.getCell(ci + 1);
      const val = r0[field];
      c.value     = (val === null || val === undefined) ? "" : val as ExcelJS.CellValue;
      c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb: rowBg } };
      c.border    = allBorders();
      c.alignment = { horizontal:"left", vertical:"middle" };
      c.font      = { name:"Arial", size:8, color:{ argb:"FF141A26" } };
      if (field === "reference_article") {
        c.font = { name:"Arial", bold:true, size:8, color:{ argb:"FF" + (STATUT_COLOR[statut] ?? "141A26") } };
      }
      if (field === "niveau_alerte") {
        const al = String(val ?? "VERT");
        c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb: ALERTE_BG[al] ?? rowBg } };
        c.alignment = { horizontal:"center", vertical:"middle" };
      }
      if (field === "date_rupture" && val) {
        c.font = { name:"Arial", size:8, color:{ argb:"FFC1683C" } };
      }
    });

    let mOff = 0;
    for (const g of GROUPES) {
      allPeriods.forEach((pd, pi) => {
        const r = idx.get(ref + "|" + pd);
        g.fields.forEach((field, mi) => {
          const col = GRP_START + pi * nM + mOff + mi;
          const c   = dataRow.getCell(col);
          const raw = r ? r[field] : null;
          const num = raw === null || raw === undefined ? null : Number(raw);

          c.fill      = { type:"pattern", pattern:"solid", fgColor:{ argb: g.bgARGB } };
          c.border    = allBorders();
          c.alignment = { horizontal:"right", vertical:"middle" };
          c.font      = { name:"Arial", size:8, color:{ argb:"FF141A26" } };

          if (num === null) {
            c.value = "";
          } else if (field === "coefficient_prevision_applique") {
            c.value    = num;
            c.numFmt   = '0.00"×"';
          } else if (field === "stock_projete" && num < 0) {
            c.value  = Math.round(num * 10) / 10;
            c.numFmt = "#,##0;[Red]-#,##0;-";
            c.font   = { name:"Arial", bold:true, size:8, color:{ argb:"FFC1683C" } };
          } else {
            c.value  = Math.round(num * 10) / 10;
            c.numFmt = "#,##0.#";
          }
        });
      });
      mOff += g.fields.length;
    }
    dataRow.commit();
  });

  ws.autoFilter = { from:{ row:3, column:1 }, to:{ row:3, column:INFO_N } };

  // Sérialisation
  const buffer = await wb.xlsx.writeBuffer();
  const scope  = famille || macro || "tous";

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="projection_stock_${scope}_${granularite}.xlsx"`,
    },
  });
}
