// supabase/functions/cdc-flux-historique/index.ts
//
// Reprise de l'historique du flux des CDC (09/11/2026).
// Rejoue les instantanés archivés du portefeuille SAGE (bucket sage-imports,
// archive/Activite_non_facture-*.csv + archive/Entete_activite_non_fac-*.csv),
// du plus ancien au plus récent : chaque instantané est compacté par (CDC, article)
// dans public.cdc_flux_hist_lignes / cdc_flux_hist_entetes, puis comparé au
// précédent par public.cdc_flux_hist_comparer (même classification que la capture
// en direct). Les instantanés suspects (fichier tronqué, export raté) sont ignorés :
// la comparaison se fait alors avec le dernier instantané retenu.
//
// Traitement synchrone par tranches (~45 s), déclenché chaque minute par le job pg_cron
// « cdc-flux-historique » tant que la reprise n'est pas terminée ; un verrou en base
// (cdc_flux_hist_prendre_verrou) empêche deux tranches de se chevaucher.
// Appel : POST { "action": "run" } ou { "action": "diag", "snaps": ["20260820_090824"] }
// avec l'en-tête x-jeton = public.cdc_flux_hist_progress.jeton (verify_jwt désactivé).

import { createClient } from "npm:@supabase/supabase-js@2";
import Papa from "npm:papaparse@5.4.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BUCKET = "sage-imports";
const BUDGET_MS = 45_000;
const RATIO_MIN = 0.7;   // instantané ignoré si ses lignes de CDC tombent sous 70 % du précédent retenu
const LOT_INSERT = 5000;

type Stats = {
  format_ok: boolean;
  nb_lignes: number;
  nb_lignes_cdc: number;
  nb_cdc: number;
  nb_aval: number;
  nb_aval_bc: number;
  nb_entetes: number;
};

type LigneHist = {
  snap: string; kind: "C" | "A"; cdc: string; art: string;
  qte: number; nb: number; mt: number;
  tiers: string | null; rep: string | null; designation: string | null;
  date_piece: string | null; pieces: string | null;
};

type EnteteHist = {
  snap: string; numero_piece: string; numero_tiers: string | null;
  date_piece: string | null; date_livraison: string | null;
};

function num(v: string | undefined): number {
  if (v === undefined || v === null) return 0;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NULL") return 0;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function txt(v: string | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s && s.toUpperCase() !== "NULL" ? s : null;
}

function dateFr(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function telecharger(path: string): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Téléchargement ${path} impossible : ${error?.message || "fichier absent"}`);
  return (await data.text()).replace(/^﻿/, "");
}

/** Lecture ligne à ligne (pas de tableau complet en mémoire), en-têtes insensibles à la casse. */
function parcourir(texte: string, surLigne: (get: (h: string) => string | undefined) => void): Set<string> {
  const etat: { index: Map<string, number> | null } = { index: null };
  Papa.parse<string[]>(texte, {
    delimiter: "",          // détection automatique (« ; » attendu, « , » ou tabulation tolérés)
    skipEmptyLines: true,
    step: (res: { data: unknown }) => {
      const r = res.data as string[];
      if (!etat.index) {
        etat.index = new Map(r.map((h, i) => [String(h).trim().toUpperCase(), i]));
        return;
      }
      const ix = etat.index;
      surLigne((h) => {
        const i = ix.get(h);
        return i === undefined ? undefined : r[i];
      });
    },
  });
  return new Set(etat.index ? Array.from(etat.index.keys()) : []);
}

async function charger(snap: string) {
  const lignes = new Map<string, LigneHist & { _pieces?: Set<string> }>();
  const cdcs = new Set<string>();
  const stats: Stats = { format_ok: true, nb_lignes: 0, nb_lignes_cdc: 0, nb_cdc: 0, nb_aval: 0, nb_aval_bc: 0, nb_entetes: 0 };

  const activite = await telecharger(`archive/Activite_non_facture-${snap}.csv`);
  const entetesCsv = parcourir(activite, (g) => {
    stats.nb_lignes++;
    const type = txt(g("VL_DOCTYPE"));
    const docnum = txt(g("VL_DOCNUM"));
    const art = (txt(g("VL_ART_NUM")) || "").toUpperCase();
    if (!type || !docnum) return;

    if (type === "1") {
      if (!art) return;
      stats.nb_lignes_cdc++;
      cdcs.add(docnum);
      const k = `C|${docnum}|${art}`;
      const l = lignes.get(k) || {
        snap, kind: "C" as const, cdc: docnum, art, qte: 0, nb: 0, mt: 0,
        tiers: null, rep: null, designation: null, date_piece: null, pieces: null,
      };
      l.qte += num(g("QTEVENDUES"));
      l.nb += 1;
      l.mt += num(g("CAHTNET"));
      l.tiers = l.tiers || txt(g("VL_CTNUM"));
      l.rep = l.rep || txt(g("VL_RENOM"));
      l.designation = l.designation || txt(g("VL_DLDESIGN"));
      const dp = dateFr(g("DATE_PIECE"));
      if (dp && (!l.date_piece || dp > l.date_piece)) l.date_piece = dp;
      lignes.set(k, l);
    } else if (["2", "3", "6", "7"].includes(type)) {
      stats.nb_aval++;
      const bc = txt(g("VL_DLPIECEBC"));
      if (!bc || !bc.toUpperCase().startsWith("CDC") || !art) return;
      stats.nb_aval_bc++;
      const k = `A|${bc}|${art}`;
      const l = lignes.get(k) || {
        snap, kind: "A" as const, cdc: bc, art, qte: 0, nb: 0, mt: 0,
        tiers: null, rep: null, designation: null, date_piece: null, pieces: null, _pieces: new Set<string>(),
      };
      l.qte += num(g("QTEVENDUES"));
      l.nb += 1;
      l._pieces!.add(docnum);
      lignes.set(k, l);
    }
  });
  if (!entetesCsv.has("VL_DOCNUM") || !entetesCsv.has("VL_DOCTYPE") || !entetesCsv.has("QTEVENDUES")) stats.format_ok = false;
  stats.nb_cdc = cdcs.size;

  const entetes: EnteteHist[] = [];
  const enteteTxt = await telecharger(`archive/Entete_activite_non_fac-${snap}.csv`);
  parcourir(enteteTxt, (g) => {
    if (txt(g("TYPE_DOC_CODE")) !== "1") return;
    const piece = txt(g("NUMERO_PIECE"));
    if (!piece) return;
    entetes.push({
      snap,
      numero_piece: piece,
      numero_tiers: txt(g("NUMERO_TIERS")),
      date_piece: dateFr(g("DATE_PIECE")),
      date_livraison: dateFr(g("DATE_LIVRAISON")),
    });
  });
  stats.nb_entetes = entetes.length;

  const rows: LigneHist[] = Array.from(lignes.values()).map((l) => {
    const { _pieces, ...r } = l;
    return { ...r, qte: Math.round(r.qte * 10000) / 10000, mt: Math.round(r.mt * 100) / 100, pieces: _pieces ? Array.from(_pieces).sort().join(", ") : null };
  });

  return { rows, entetes, stats, colonnes: Array.from(entetesCsv).slice(0, 80) };
}

/** Raison d'ignorer un instantané, ou null s'il est exploitable. */
function controler(s: Stats, ref: { nb_lignes_cdc: number } | null): string | null {
  if (!s.format_ok) return "format de fichier inattendu (colonnes VL_DOCNUM / VL_DOCTYPE / QTEVENDUES absentes)";
  if (s.nb_lignes_cdc === 0) return "aucune ligne de CDC";
  if (s.nb_aval > 0 && s.nb_aval_bc === 0) return "PL / BL sans n° de CDC d'origine (VL_DLPIECEBC vide)";
  if (ref && ref.nb_lignes_cdc > 0 && s.nb_lignes_cdc < ref.nb_lignes_cdc * RATIO_MIN) {
    return `baisse anormale des lignes de CDC (${s.nb_lignes_cdc} contre ${ref.nb_lignes_cdc})`;
  }
  return null;
}

async function inserer(snap: string, rows: LigneHist[], entetes: EnteteHist[]) {
  await sb.from("cdc_flux_hist_lignes").delete().eq("snap", snap);
  await sb.from("cdc_flux_hist_entetes").delete().eq("snap", snap);
  for (let i = 0; i < rows.length; i += LOT_INSERT) {
    const { error } = await sb.from("cdc_flux_hist_lignes").insert(rows.slice(i, i + LOT_INSERT));
    if (error) throw new Error(`Insertion lignes ${snap} : ${error.message}`);
  }
  for (let i = 0; i < entetes.length; i += LOT_INSERT) {
    const { error } = await sb.from("cdc_flux_hist_entetes").insert(entetes.slice(i, i + LOT_INSERT));
    if (error) throw new Error(`Insertion entêtes ${snap} : ${error.message}`);
  }
}

function tsDe(snap: string) {
  return `${snap.slice(0, 4)}-${snap.slice(4, 6)}-${snap.slice(6, 8)}T${snap.slice(9, 11)}:${snap.slice(11, 13)}:${snap.slice(13, 15)}Z`;
}

async function enregistrerSnap(snap: string, stats: Stats, statut: string, motif: string | null) {
  await sb.from("cdc_flux_hist_snaps").upsert({
    snap, ts: tsDe(snap), nb_lignes: stats.nb_lignes, nb_lignes_cdc: stats.nb_lignes_cdc, nb_cdc: stats.nb_cdc,
    nb_aval: stats.nb_aval, nb_aval_bc: stats.nb_aval_bc, nb_entetes: stats.nb_entetes,
    statut, motif, traite_at: new Date().toISOString(),
  });
}

async function majProgress(champs: Record<string, unknown>) {
  await sb.from("cdc_flux_hist_progress").update({ ...champs, updated_at: new Date().toISOString() }).eq("id", 1);
}

async function run() {
  const t0 = Date.now();
  const { data: paires, error: e1 } = await sb.rpc("cdc_flux_hist_paires");
  if (e1) throw new Error(`Liste des instantanés : ${e1.message}`);
  const liste = (paires || []) as { snap: string }[];

  const { data: dejaVus } = await sb.from("cdc_flux_hist_snaps").select("snap, statut, nb_lignes_cdc");
  const ignores = new Set((dejaVus || []).filter((s) => s.statut === "ignore").map((s) => s.snap));

  const { data: prog } = await sb.from("cdc_flux_hist_progress").select("*").eq("id", 1).single();
  let dernier: string | null = prog?.dernier_snap_ok || null;
  let ref = dernier ? (dejaVus || []).find((s) => s.snap === dernier) || null : null;
  let traites = 0;
  let evenements = 0;

  for (const { snap } of liste) {
    if (dernier && snap <= dernier) continue;
    if (ignores.has(snap)) continue;
    if (Date.now() - t0 > BUDGET_MS) break;

    const { rows, entetes, stats } = await charger(snap);
    const motif = controler(stats, ref);
    if (motif) {
      await enregistrerSnap(snap, stats, "ignore", motif);
      ignores.add(snap);
      continue;
    }

    await inserer(snap, rows, entetes);
    await enregistrerSnap(snap, stats, "charge", null);

    if (dernier) {
      const { data: n, error } = await sb.rpc("cdc_flux_hist_comparer", { p_av: dernier, p_ap: snap });
      if (error) throw new Error(`Comparaison ${dernier} → ${snap} : ${error.message}`);
      evenements += Number(n || 0);
    } else {
      await sb.from("cdc_flux_hist_snaps").update({ statut: "traite", nb_evenements: 0 }).eq("snap", snap);
    }
    dernier = snap;
    ref = { snap, statut: "traite", nb_lignes_cdc: stats.nb_lignes_cdc };
    traites++;
    await majProgress({ dernier_snap_ok: dernier, message: `${snap} traité` });
  }

  const reste = liste.filter((p) => (!dernier || p.snap > dernier) && !ignores.has(p.snap)).length;
  if (reste === 0) {
    // fin : le dernier instantané compacté n'est plus utile
    if (dernier) {
      await sb.from("cdc_flux_hist_lignes").delete().eq("snap", dernier);
      await sb.from("cdc_flux_hist_entetes").delete().eq("snap", dernier);
    }
    await majProgress({ termine: true, message: `Reprise terminée (dernier instantané ${dernier})` });
  }
  return { traites, evenements, reste, dernier };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const jeton = req.headers.get("x-jeton") || "";
    const { data: prog } = await sb.from("cdc_flux_hist_progress").select("jeton, termine").eq("id", 1).single();
    if (!prog || !jeton || jeton !== prog.jeton) {
      return new Response(JSON.stringify({ ok: false, error: "Non autorisé" }), { status: 401 });
    }

    // Liens signés (24 h) vers les fichiers archivés, enregistrés en base pour que Postgres
    // les télécharge lui-même (pg_net) : l'analyse des CSV se fait en SQL, sans la limite
    // de calcul des Edge Functions.
    if (body.action === "urls") {
      const { data: paires, error: e1 } = await sb.rpc("cdc_flux_hist_paires");
      if (e1) throw new Error(`Liste des instantanés : ${e1.message}`);
      const snaps = ((paires || []) as { snap: string }[]).map((p) => p.snap);
      let n = 0;
      for (let i = 0; i < snaps.length; i += 50) {
        const lot = snaps.slice(i, i + 50);
        const chemins = lot.flatMap((s) => [`archive/Activite_non_facture-${s}.csv`, `archive/Entete_activite_non_fac-${s}.csv`]);
        const { data: signes, error } = await sb.storage.from(BUCKET).createSignedUrls(chemins, 86400);
        if (error || !signes) throw new Error(`Liens signés : ${error?.message}`);
        const parChemin = new Map(signes.map((x) => [x.path, x.signedUrl]));
        const rows = lot.map((s) => ({
          snap: s,
          url_activite: parChemin.get(`archive/Activite_non_facture-${s}.csv`),
          url_entete: parChemin.get(`archive/Entete_activite_non_fac-${s}.csv`),
          expire_at: new Date(Date.now() + 86400_000).toISOString(),
        }));
        const { error: e2 } = await sb.from("cdc_flux_hist_urls").upsert(rows);
        if (e2) throw new Error(`Enregistrement des liens : ${e2.message}`);
        n += rows.length;
      }
      return new Response(JSON.stringify({ ok: true, liens: n }), { headers: { "Content-Type": "application/json" } });
    }

    if (body.action === "tete") {
      const out: Record<string, string> = {};
      for (const chemin of (body.chemins || []) as string[]) {
        const t = await telecharger(chemin);
        out[chemin] = t.slice(0, 1500);
      }
      return new Response(JSON.stringify({ ok: true, tete: out }), { headers: { "Content-Type": "application/json" } });
    }

    if (body.action === "diag") {
      const out: Record<string, unknown> = {};
      for (const snap of (body.snaps || []) as string[]) {
        const { rows, entetes, stats, colonnes } = await charger(snap);
        out[snap] = { stats, colonnes, lignes_compactees: rows.length, entetes: entetes.length, exemple: rows.slice(0, 2) };
      }
      return new Response(JSON.stringify({ ok: true, diag: out }), { headers: { "Content-Type": "application/json" } });
    }

    if (body.action === "run") {
      if (prog.termine) return new Response(JSON.stringify({ ok: true, termine: true }));
      const { data: verrou } = await sb.rpc("cdc_flux_hist_prendre_verrou", { p_secondes: 170 });
      if (!verrou) return new Response(JSON.stringify({ ok: true, occupe: true }));
      try {
        const res = await run();
        return new Response(JSON.stringify({ ok: true, ...res }), { headers: { "Content-Type": "application/json" } });
      } finally {
        await sb.rpc("cdc_flux_hist_rendre_verrou");
      }
    }

    return new Response(JSON.stringify({ ok: false, error: "Action inconnue" }), { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await majProgress({ message: `ERREUR : ${message}` }).catch(() => undefined);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
});
