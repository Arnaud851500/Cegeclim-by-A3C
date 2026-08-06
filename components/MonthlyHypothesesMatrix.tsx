"use client";

/**
 * MonthlyHypothesesMatrix
 * ------------------------------------------------------------------------
 * Grille d'hypothèses mensuelles d'évolution des ventes vs N-1, par famille.
 * Remplace l'ancien "scénario % global" : chaque famille porte désormais
 * un coefficient par mois (100% par défaut), persistant à travers les
 * imports. La cascade de résolution côté base est :
 *   override semaine exacte (fiche article) > hypothèse MENSUELLE propre à
 *   l'article (V2 — cette révision) > hypothèse mensuelle de sa famille > 100%
 *
 * V2 (cette révision) : chaque ligne famille peut être dépliée (flèche) pour
 * révéler la liste des références qui lui sont rattachées. Par défaut, une
 * référence affiche exactement les mêmes valeurs que sa famille (héritage,
 * aucune ligne stockée en base) ; on peut éditer une cellule d'une référence
 * précise, ce qui crée une surcharge PROPRE à cette référence pour ce mois,
 * prise en compte au recalcul.
 *
 * Si on modifie un mois au niveau FAMILLE alors que des références de cette
 * famille ont, pour ce même mois, une valeur propre différente de l'ancienne
 * valeur famille (donc une vraie personnalisation, pas un simple héritage),
 * une boîte de dialogue propose trois choix avant d'enregistrer :
 *   1. Écraser : toutes les surcharges de ces références sont supprimées,
 *      elles héritent de la nouvelle valeur famille.
 *   2. Annuler ces cellules famille : les modifications famille concernées
 *      sont abandonnées (le reste de la saisie, lui, est conservé).
 *   3. Aligner seulement celles qui suivaient la famille : les références
 *      dont la valeur actuelle était égale à l'ANCIENNE valeur famille
 *      suivent le changement ; celles réellement personnalisées ne bougent pas.
 *
 * Deux usages pour la grille elle-même (inchangé) :
 *  - familleFilter = null  → écran plein : toutes les familles macro / familles,
 *    ouvert depuis le bouton "Paramétrage hypothèses mensuelles" en haut de
 *    l'écran principal.
 *  - familleFilter = "XXX" → une seule famille, ouvert depuis l'écran famille
 *    ("Paramétrage hypothèses de cette famille"). À la sauvegarde, la
 *    projection de cette famille est recalculée automatiquement avant de
 *    revenir à l'écran d'origine.
 *
 * RPC utilisées (SECURITY DEFINER, cf. migrations Supabase) :
 *  - get_stock_hypotheses_matrice(p_nb_mois, p_famille)                    — familles
 *  - get_stock_hypotheses_matrice_articles(p_famille, p_nb_mois)           — références d'une famille (V2)
 *  - upsert_stock_hypotheses_mensuelles(p_hypotheses jsonb)                — familles
 *  - upsert_stock_hypotheses_mensuelles_articles(p_hypotheses jsonb)       — références (V2)
 *  - check_stock_hypotheses_conflits_articles(p_famille, p_mois date[])    — détection conflit (V2)
 *  - recalc_stock_projection_scope_hypotheses(p_run_id, p_scope, p_cle, p_depot)
 * ------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MatriceRow = { famille_macro: string; famille: string; horizon_semaines: number; mois: string; coefficient: number };
type MatriceArticleRow = { reference_article: string; designation: string; mois: string; coefficient: number; is_override: boolean; coefficient_famille: number };

type Props = {
  /** null = toutes les familles. Une valeur = édition scoping à cette famille + recalcul auto à la sauvegarde. */
  familleFilter?: string | null;
  /** Run actif, requis uniquement quand familleFilter est renseigné (pour déclencher le recalcul). */
  runId?: string | null;
  nbMois?: number;
  onClose: () => void;
  /** Appelé après une sauvegarde réussie (et, le cas échéant, le recalcul de périmètre). */
  onSaved?: () => void;
};

type ConflitCellule = { famille: string; mois: string; nbReferences: number };
type ConflitDetail = { famille: string; mois: string; reference_article: string; designation: string; coefficient: number };

function key(famille: string, mois: string) {
  return `${famille}|${mois}`;
}
function keyArticle(famille: string, ref: string, mois: string) {
  return `${famille}|${ref}|${mois}`;
}

export default function MonthlyHypothesesMatrix({ familleFilter = null, runId = null, nbMois = 24, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [rowsMeta, setRowsMeta] = useState<Array<{ macro: string; famille: string }>>([]);

  // Familles : valeurs courantes (éditées) + valeurs d'origine (jamais
  // mutées après le chargement — nécessaires pour détecter, à la sauvegarde,
  // quelles cellules ont réellement changé et comparer avec les surcharges
  // article existantes).
  const [values, setValues] = useState<Map<string, number>>(new Map());
  const [originalValues, setOriginalValues] = useState<Map<string, number>>(new Map());
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const [horizons, setHorizons] = useState<Map<string, number>>(new Map());
  const [horizonsDirty, setHorizonsDirty] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Dépliant par référence (V2)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [articleLoading, setArticleLoading] = useState<Set<string>>(new Set());
  const [articleRowsByFamille, setArticleRowsByFamille] = useState<Map<string, Array<{ reference_article: string; designation: string }>>>(new Map());
  const [articleValues, setArticleValues] = useState<Map<string, number>>(new Map());
  const [articleIsOverrideServer, setArticleIsOverrideServer] = useState<Set<string>>(new Set());
  const [articleDirty, setArticleDirty] = useState<Set<string>>(new Set());
  const [articleDeletes, setArticleDeletes] = useState<Set<string>>(new Set()); // cellules à effacer (retour héritage)

  // Boîte de dialogue de conflit famille/article, ouverte au moment de Save
  const [conflitOuvert, setConflitOuvert] = useState(false);
  const [conflitCellules, setConflitCellules] = useState<ConflitCellule[]>([]);
  const [conflitDetails, setConflitDetails] = useState<ConflitDetail[]>([]);
  const [conflitResolution, setConflitResolution] = useState<"ecraser" | "annuler" | "aligner">("aligner");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.rpc("get_stock_hypotheses_matrice", {
          p_nb_mois: nbMois,
          p_famille: familleFilter,
        });
        if (err) throw new Error(err.message);
        const rows = (data || []) as MatriceRow[];
        if (cancelled) return;
        const monthsSet = Array.from(new Set(rows.map((r) => r.mois))).sort();
        const metaMap = new Map<string, { macro: string; famille: string }>();
        const val = new Map<string, number>();
        const horizonMap = new Map<string, number>();
        rows.forEach((r) => {
          metaMap.set(r.famille, { macro: r.famille_macro, famille: r.famille });
          val.set(key(r.famille, r.mois), Math.round(Number(r.coefficient) * 100));
          horizonMap.set(r.famille, Number(r.horizon_semaines) || 26);
        });
        setMonths(monthsSet);
        setRowsMeta(Array.from(metaMap.values()).sort((a, b) => a.macro.localeCompare(b.macro) || a.famille.localeCompare(b.famille)));
        setValues(val);
        setOriginalValues(new Map(val));
        setDirty(new Set());
        setHorizons(horizonMap);
        setHorizonsDirty(new Set());
        setSaved(null);
        // Grille famille scopée à une seule famille : on la déplie directement,
        // c'est très probablement pour ça que l'utilisateur est venu.
        if (familleFilter) setExpanded(new Set([familleFilter]));
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
  }, [familleFilter, nbMois]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rowsMeta;
    const s = search.trim().toLowerCase();
    return rowsMeta.filter((r) => r.famille.toLowerCase().includes(s) || r.macro.toLowerCase().includes(s));
  }, [rowsMeta, search]);

  function setValue(famille: string, mois: string, pct: number) {
    setValues((prev) => {
      const next = new Map(prev);
      next.set(key(famille, mois), pct);
      return next;
    });
    setDirty((prev) => {
      const next = new Set(prev);
      next.add(key(famille, mois));
      return next;
    });
  }

  function applyToRow(famille: string, pct: number) {
    setValues((prev) => {
      const next = new Map(prev);
      months.forEach((m) => next.set(key(famille, m), pct));
      return next;
    });
    setDirty((prev) => {
      const next = new Set(prev);
      months.forEach((m) => next.add(key(famille, m)));
      return next;
    });
  }

  function setHorizonValue(famille: string, semaines: number) {
    const v = Math.max(1, Math.min(104, Math.round(semaines) || 26));
    setHorizons((prev) => {
      const next = new Map(prev);
      next.set(famille, v);
      return next;
    });
    setHorizonsDirty((prev) => {
      const next = new Set(prev);
      next.add(famille);
      return next;
    });
  }

  // ── Dépliant par référence (V2) ───────────────────────────────────────────

  async function toggleExpand(famille: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(famille)) next.delete(famille);
      else next.add(famille);
      return next;
    });
    if (articleRowsByFamille.has(famille)) return; // déjà chargé

    setArticleLoading((prev) => new Set(prev).add(famille));
    try {
      const { data, error: err } = await supabase.rpc("get_stock_hypotheses_matrice_articles", {
        p_famille: famille,
        p_nb_mois: nbMois,
      });
      if (err) throw new Error(err.message);
      const rows = (data || []) as MatriceArticleRow[];

      const refsMap = new Map<string, { reference_article: string; designation: string }>();
      const val = new Map<string, number>();
      const isOverride = new Set<string>();
      rows.forEach((r) => {
        refsMap.set(r.reference_article, { reference_article: r.reference_article, designation: r.designation });
        const k = keyArticle(famille, r.reference_article, r.mois);
        val.set(k, Math.round(Number(r.coefficient) * 100));
        if (r.is_override) isOverride.add(k);
      });

      setArticleRowsByFamille((prev) => new Map(prev).set(famille, Array.from(refsMap.values()).sort((a, b) => a.reference_article.localeCompare(b.reference_article))));
      setArticleValues((prev) => new Map([...prev, ...val]));
      setArticleIsOverrideServer((prev) => new Set([...prev, ...isOverride]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setArticleLoading((prev) => {
        const next = new Set(prev);
        next.delete(famille);
        return next;
      });
    }
  }

  function setArticleValue(famille: string, ref: string, mois: string, pct: number) {
    const k = keyArticle(famille, ref, mois);
    setArticleValues((prev) => new Map(prev).set(k, pct));
    setArticleDirty((prev) => new Set(prev).add(k));
    setArticleDeletes((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  }

  /** Efface toutes les surcharges d'une référence (retour à l'héritage famille) sur tous les mois affichés. */
  function resetArticleRow(famille: string, ref: string) {
    const famCoefByMois = new Map<string, number>();
    months.forEach((m) => famCoefByMois.set(m, values.get(key(famille, m)) ?? 100));
    setArticleValues((prev) => {
      const next = new Map(prev);
      months.forEach((m) => next.set(keyArticle(famille, ref, m), famCoefByMois.get(m) ?? 100));
      return next;
    });
    setArticleDirty((prev) => {
      const next = new Set(prev);
      months.forEach((m) => next.delete(keyArticle(famille, ref, m)));
      return next;
    });
    setArticleDeletes((prev) => {
      const next = new Set(prev);
      months.forEach((m) => {
        // On efface uniquement les cellules qui portaient réellement une
        // surcharge côté serveur — pas la peine d'appeler delete sur des
        // cellules qui héritaient déjà.
        if (articleIsOverrideServer.has(keyArticle(famille, ref, m))) next.add(keyArticle(famille, ref, m));
      });
      return next;
    });
  }

  // ── Sauvegarde, avec détection de conflit famille / article ──────────────

  /** Cellules famille dirty regroupées par famille, avec ancienne et nouvelle valeur. */
  function getDirtyFamilleCells() {
    return Array.from(dirty).map((k) => {
      const [famille, mois] = k.split("|");
      return { famille, mois, ancienneValeur: originalValues.get(k) ?? 100, nouvelleValeur: values.get(k) ?? 100 };
    }).filter((c) => c.ancienneValeur !== c.nouvelleValeur);
  }

  async function handleSaveClick() {
    setError(null);
    const dirtyFamilleCells = getDirtyFamilleCells();

    if (!dirtyFamilleCells.length) {
      await doSave();
      return;
    }

    // Regroupe par famille pour minimiser les appels RPC.
    const moisParFamille = new Map<string, Set<string>>();
    dirtyFamilleCells.forEach((c) => {
      const s = moisParFamille.get(c.famille) || new Set<string>();
      s.add(c.mois);
      moisParFamille.set(c.famille, s);
    });

    try {
      const allDetails: ConflitDetail[] = [];
      for (const [famille, moisSet] of moisParFamille) {
        const { data, error: err } = await supabase.rpc("check_stock_hypotheses_conflits_articles", {
          p_famille: famille,
          p_mois: Array.from(moisSet),
        });
        if (err) throw new Error(err.message);
        ((data || []) as Array<{ mois: string; reference_article: string; designation: string; coefficient: number }>).forEach((row) => {
          const cell = dirtyFamilleCells.find((c) => c.famille === famille && c.mois === row.mois);
          if (!cell) return;
          // Conflit réel uniquement si la surcharge diffère de l'ANCIENNE
          // valeur famille — sinon la référence "suivait" déjà la famille,
          // ce n'est pas une vraie personnalisation.
          const coefPct = Math.round(Number(row.coefficient) * 100);
          if (coefPct !== cell.ancienneValeur) {
            allDetails.push({ famille, mois: row.mois, reference_article: row.reference_article, designation: row.designation, coefficient: coefPct });
          }
        });
      }

      if (!allDetails.length) {
        await doSave();
        return;
      }

      const cellulesMap = new Map<string, ConflitCellule>();
      allDetails.forEach((d) => {
        const k = `${d.famille}|${d.mois}`;
        const c = cellulesMap.get(k) || { famille: d.famille, mois: d.mois, nbReferences: 0 };
        c.nbReferences += 1;
        cellulesMap.set(k, c);
      });

      setConflitDetails(allDetails);
      setConflitCellules(Array.from(cellulesMap.values()));
      setConflitResolution("aligner");
      setConflitOuvert(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleConfirmConflit() {
    setConflitOuvert(false);

    if (conflitResolution === "annuler") {
      // Abandonne uniquement les cellules famille concernées par un conflit ;
      // le reste de la saisie (autres cellules famille, surcharges article
      // saisies manuellement) est conservé.
      const cellulesConcernees = new Set(conflitCellules.map((c) => key(c.famille, c.mois)));
      setValues((prev) => {
        const next = new Map(prev);
        cellulesConcernees.forEach((k) => {
          const original = originalValues.get(k);
          if (original !== undefined) next.set(k, original);
        });
        return next;
      });
      setDirty((prev) => {
        const next = new Set(prev);
        cellulesConcernees.forEach((k) => next.delete(k));
        return next;
      });
      await doSave();
      return;
    }

    if (conflitResolution === "ecraser") {
      // Supprime la surcharge de toutes les références en conflit : elles
      // hériteront de la nouvelle valeur famille.
      const extraDeletes = new Set(articleDeletes);
      conflitDetails.forEach((d) => {
        const famMeta = rowsMeta.find((r) => r.famille === d.famille);
        if (!famMeta) return;
        extraDeletes.add(keyArticle(d.famille, d.reference_article, d.mois));
      });
      setArticleDeletes(extraDeletes);
      // On retire aussi ces cellules d'un éventuel dirty local (la valeur
      // locale n'a plus de sens, elles vont être supprimées côté base).
      setArticleDirty((prev) => {
        const next = new Set(prev);
        conflitDetails.forEach((d) => next.delete(keyArticle(d.famille, d.reference_article, d.mois)));
        return next;
      });
      await doSave(extraDeletes);
      return;
    }

    // "aligner" : seules les références dont la valeur ACTUELLE égale
    // l'ancienne valeur famille suivent le changement (mise à jour explicite
    // vers la nouvelle valeur famille) ; celles réellement personnalisées ne
    // bougent pas.
    const extraUpserts = new Map(articleValues);
    const extraDirty = new Set(articleDirty);
    const dirtyFamilleCells = getDirtyFamilleCells();
    conflitDetails.forEach((d) => {
      const cell = dirtyFamilleCells.find((c) => c.famille === d.famille && c.mois === d.mois);
      if (!cell) return;
      if (d.coefficient === cell.ancienneValeur) {
        const k = keyArticle(d.famille, d.reference_article, d.mois);
        extraUpserts.set(k, cell.nouvelleValeur);
        extraDirty.add(k);
      }
    });
    setArticleValues(extraUpserts);
    setArticleDirty(extraDirty);
    await doSave(undefined, extraUpserts, extraDirty);
  }

  async function doSave(
    extraDeletesOverride?: Set<string>,
    articleValuesOverride?: Map<string, number>,
    articleDirtyOverride?: Set<string>,
  ) {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      let nbSaved = 0;

      // 1) Familles
      const dirtyFamilleCells = getDirtyFamilleCells();
      if (dirtyFamilleCells.length > 0) {
        const hypotheses = dirtyFamilleCells.map((c) => ({ famille: c.famille, mois: c.mois, coefficient: Math.max(0, c.nouvelleValeur) / 100 }));
        const { data, error: err } = await supabase.rpc("upsert_stock_hypotheses_mensuelles", { p_hypotheses: hypotheses });
        if (err) throw new Error(err.message);
        nbSaved += (data as { lignes?: number })?.lignes ?? hypotheses.length;
      }
      // Purge tout le "dirty" famille (y compris cellules sans changement réel, pour repartir propre)
      setDirty(new Set());

      // 2) Références — surcharges saisies (édition directe + éventuel alignement)
      const effectiveArticleDirty = articleDirtyOverride ?? articleDirty;
      const effectiveArticleValues = articleValuesOverride ?? articleValues;
      const effectiveDeletes = extraDeletesOverride ?? articleDeletes;

      const articlePayload: Array<{ reference_article: string; mois: string; coefficient: number | null }> = [];
      effectiveArticleDirty.forEach((k) => {
        if (effectiveDeletes.has(k)) return; // traité séparément ci-dessous
        const [, ref, mois] = k.split("|");
        const pct = effectiveArticleValues.get(k) ?? 100;
        articlePayload.push({ reference_article: ref, mois, coefficient: Math.max(0, pct) / 100 });
      });
      effectiveDeletes.forEach((k) => {
        const [, ref, mois] = k.split("|");
        articlePayload.push({ reference_article: ref, mois, coefficient: null });
      });

      if (articlePayload.length > 0) {
        const { data, error: err } = await supabase.rpc("upsert_stock_hypotheses_mensuelles_articles", { p_hypotheses: articlePayload });
        if (err) throw new Error(err.message);
        const res = data as { lignes_maj?: number; lignes_supprimees?: number } | null;
        nbSaved += (res?.lignes_maj || 0) + (res?.lignes_supprimees || 0);
      }
      setArticleDirty(new Set());
      setArticleDeletes(new Set());

      // 3) Horizons (inchangé)
      if (horizonsDirty.size > 0) {
        for (const famille of horizonsDirty) {
          const { error: err } = await supabase.rpc("set_stock_famille_horizon", {
            p_famille: famille,
            p_horizon_semaines: horizons.get(famille) ?? 26,
          });
          if (err) throw new Error(err.message);
          nbSaved += 1;
        }
        setHorizonsDirty(new Set());
      }
      if (nbSaved > 0) setSaved(`${nbSaved} valeur(s) enregistrée(s).`);

      // Édition scopée à une famille : on recalcule immédiatement cette
      // famille à partir des hypothèses tout juste enregistrées (familles ET
      // références confondues, resolve_forecast_coefficient gère la
      // cascade), pour que l'écran d'origine affiche la projection à jour
      // dès le retour.
      if (familleFilter && runId) {
        const { data: recalcData, error: recalcErr } = await supabase.rpc("recalc_stock_projection_scope_hypotheses", {
          p_run_id: runId,
          p_scope: "famille",
          p_cle: familleFilter,
          p_depot: "GLOBAL",
        });
        if (recalcErr) throw new Error(recalcErr.message);
        const recalcResult = recalcData as { success?: boolean; message?: string } | null;
        if (!recalcResult?.success) throw new Error(recalcResult?.message || "Échec du recalcul de la famille");
      }

      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function monthLabel(iso: string) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  }

  const hasPendingChanges = dirty.size > 0 || articleDirty.size > 0 || articleDeletes.size > 0 || horizonsDirty.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#060A12]/80 p-4">
      <div className="flex h-[88vh] w-full max-w-[1500px] flex-col rounded-2xl border border-white/10 bg-[#101A2E] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="font-[var(--font-display)] text-lg font-bold text-white">
              Paramétrage hypothèses mensuelles {familleFilter ? `— ${familleFilter}` : "— toutes les familles"}
            </h2>
            <p className="mt-0.5 text-xs text-white/45">
              % d&rsquo;évolution des ventes vs N-1, par famille et par mois. 100% = identique à N-1. Dépliez une famille
              (flèche) pour ajuster une référence précise — par défaut, une référence suit exactement sa famille. Ces
              valeurs sont conservées à travers les imports et pilotent le recalcul de la projection. La colonne
              « Horizon » fixe le nombre de semaines affichées sur l&rsquo;écran de chaque famille — le recalcul
              complet couvre toujours la plus grande plage enregistrée, quelle que soit cette valeur.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:text-white">
            Fermer
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-white/10 px-6 py-3">
          {!familleFilter && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer par famille ou famille macro…"
              className="w-72 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[#A6A181]"
            />
          )}
          <span className="text-xs text-white/40">
            {filteredRows.length} famille(s) · {months.length} mois
          </span>
          <div className="ml-auto flex items-center gap-3">
            {saved && <span className="text-xs text-[#3F9142]">{saved}</span>}
            {error && <span className="text-xs text-[#C1683C]">{error}</span>}
            <button
              onClick={() => void handleSaveClick()}
              disabled={saving || !hasPendingChanges}
              className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : familleFilter ? "Enregistrer et recalculer cette famille" : "Enregistrer"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-6 text-sm text-white/50">Chargement…</div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[#101A2E]">
                <tr>
                  <th className="sticky left-0 z-20 w-7 border-b border-r border-white/10 bg-[#101A2E] px-1 py-2" />
                  <th className="sticky left-7 z-20 min-w-[150px] border-b border-r border-white/10 bg-[#101A2E] px-3 py-2 text-left text-white/50">
                    Famille macro
                  </th>
                  <th className="sticky left-[157px] z-20 min-w-[200px] border-b border-r border-white/10 bg-[#101A2E] px-3 py-2 text-left text-white/50">
                    Famille / Référence
                  </th>
                  <th className="sticky left-[357px] z-20 min-w-[90px] border-b border-r border-white/10 bg-[#101A2E] px-2 py-2 text-center text-white/50">
                    Horizon (sem.)
                  </th>
                  {months.map((m) => (
                    <th key={m} className="min-w-[64px] border-b border-white/10 px-1 py-2 text-center text-white/50">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className="min-w-[70px] border-b border-white/10 px-2 py-2 text-center text-white/50">Ligne</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const isExpanded = expanded.has(r.famille);
                  const articleRows = articleRowsByFamille.get(r.famille) || [];
                  const isArticleLoading = articleLoading.has(r.famille);
                  return (
                    <>
                      <tr key={r.famille} className="odd:bg-white/[0.02]">
                        <td className="sticky left-0 z-10 border-r border-white/10 bg-[#101A2E] px-1 py-1.5 text-center">
                          <button
                            onClick={() => void toggleExpand(r.famille)}
                            className="inline-flex h-5 w-5 items-center justify-center rounded text-white/50 transition hover:bg-white/10 hover:text-white"
                            title="Voir / ajuster les références de cette famille"
                          >
                            {isExpanded ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="sticky left-7 z-10 border-r border-white/10 bg-[#101A2E] px-3 py-1.5 text-white/70">{r.macro}</td>
                        <td className="sticky left-[157px] z-10 border-r border-white/10 bg-[#101A2E] px-3 py-1.5 font-medium text-white">{r.famille}</td>
                        <td className="sticky left-[357px] z-10 border-r border-white/10 bg-[#101A2E] p-1 text-center">
                          <input
                            type="number"
                            min={1}
                            max={104}
                            value={horizons.get(r.famille) ?? 26}
                            onChange={(e) => setHorizonValue(r.famille, Number(e.target.value))}
                            title="Nombre de semaines affichées sur l'écran de cette famille — le recalcul complet couvre toujours la plus grande plage enregistrée, quelle que soit cette valeur"
                            className={`w-16 rounded border bg-white/5 px-1 py-1 text-center font-[var(--font-mono)] text-white outline-none focus:border-[#A6A181] ${
                              horizonsDirty.has(r.famille) ? "border-[#A6A181]" : "border-white/10"
                            }`}
                          />
                        </td>
                        {months.map((m) => {
                          const v = values.get(key(r.famille, m)) ?? 100;
                          const isDirty = dirty.has(key(r.famille, m));
                          return (
                            <td key={m} className="border-r border-white/5 p-0.5 text-center">
                              <input
                                type="number"
                                value={v}
                                onChange={(e) => setValue(r.famille, m, Number(e.target.value))}
                                className={`w-14 rounded border bg-white/5 px-1 py-1 text-center font-[var(--font-mono)] text-white outline-none focus:border-[#A6A181] ${
                                  isDirty ? "border-[#A6A181]" : v === 100 ? "border-white/10" : "border-[#D69A4A]/50"
                                }`}
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 text-center">
                          <button title="Remettre 100% sur toute la ligne" onClick={() => applyToRow(r.famille, 100)} className="text-white/40 hover:text-white">
                            ↺
                          </button>
                        </td>
                      </tr>

                      {isExpanded && isArticleLoading && (
                        <tr>
                          <td colSpan={months.length + 5} className="bg-[#0B1220] px-4 py-3 text-center text-white/40">
                            Chargement des références…
                          </td>
                        </tr>
                      )}

                      {isExpanded && !isArticleLoading && articleRows.length === 0 && (
                        <tr>
                          <td colSpan={months.length + 5} className="bg-[#0B1220] px-4 py-3 text-center text-white/40">
                            Aucune référence rattachée à cette famille.
                          </td>
                        </tr>
                      )}

                      {isExpanded && !isArticleLoading && articleRows.map((ar) => (
                        <tr key={`${r.famille}-${ar.reference_article}`} className="bg-[#0B1220]">
                          <td className="sticky left-0 z-10 border-r border-white/10 bg-[#0B1220]" />
                          <td className="sticky left-7 z-10 border-r border-white/10 bg-[#0B1220]" />
                          <td className="sticky left-[157px] z-10 border-r border-white/10 bg-[#0B1220] px-3 py-1.5 pl-6">
                            <div className="font-[var(--font-mono)] text-[11px] font-medium text-[#A6A181]">{ar.reference_article}</div>
                            <div className="truncate text-[10px] text-white/40" title={ar.designation}>{ar.designation}</div>
                          </td>
                          <td className="sticky left-[357px] z-10 border-r border-white/10 bg-[#0B1220]" />
                          {months.map((m) => {
                            const k = keyArticle(r.famille, ar.reference_article, m);
                            const v = articleValues.get(k) ?? values.get(key(r.famille, m)) ?? 100;
                            const isDirtyCell = articleDirty.has(k) || articleDeletes.has(k);
                            const isOverrideServer = articleIsOverrideServer.has(k) && !articleDeletes.has(k);
                            return (
                              <td key={m} className="border-r border-white/5 p-0.5 text-center">
                                <input
                                  type="number"
                                  value={v}
                                  onChange={(e) => setArticleValue(r.famille, ar.reference_article, m, Number(e.target.value))}
                                  title={isOverrideServer ? "Valeur propre à cette référence" : "Hérite de la famille"}
                                  className={`w-14 rounded border bg-white/5 px-1 py-1 text-center font-[var(--font-mono)] text-[11px] outline-none focus:border-[#A6A181] ${
                                    isDirtyCell
                                      ? "border-[#A6A181] text-white"
                                      : isOverrideServer
                                        ? "border-[#4B92AC]/60 text-[#8FCBE0]"
                                        : "border-white/10 text-white/50"
                                  }`}
                                />
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              title="Retirer les surcharges de cette référence (revenir à la famille)"
                              onClick={() => resetArticleRow(r.famille, ar.reference_article)}
                              className="text-white/30 hover:text-white"
                            >
                              ↺
                            </button>
                          </td>
                        </tr>
                      ))}
                    </>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={months.length + 5} className="px-4 py-8 text-center text-white/40">
                      Aucune famille trouvée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-white/10 px-6 py-2 text-[10px] text-white/40">
          <span><span className="mr-1 inline-block h-2 w-4 rounded border border-[#4B92AC]/60 align-middle" /> Référence avec valeur propre</span>
          <span><span className="mr-1 inline-block h-2 w-4 rounded border border-white/10 align-middle" /> Référence héritant de la famille</span>
          <span><span className="mr-1 inline-block h-2 w-4 rounded border border-[#A6A181] align-middle" /> Modification non enregistrée</span>
        </div>
      </div>

      {/* ── Boîte de dialogue de conflit famille / référence ────────────────── */}
      {conflitOuvert && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#D69A4A]/40 bg-[#101A2E] shadow-2xl">
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-[var(--font-display)] text-base font-bold text-white">Des références ont une valeur différente de la famille</h3>
              <p className="mt-1 text-xs text-white/50">
                Sur {conflitCellules.length} mois de famille modifié(s), certaines références ont une valeur propre qui ne
                suivait pas la famille. Que faire ?
              </p>
            </div>

            <div className="max-h-64 overflow-auto px-6 py-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-white/40">
                    <th className="py-1">Famille</th>
                    <th className="py-1">Mois</th>
                    <th className="py-1 text-right">Réf. concernées</th>
                  </tr>
                </thead>
                <tbody>
                  {conflitCellules.map((c) => (
                    <tr key={`${c.famille}-${c.mois}`} className="border-t border-white/5">
                      <td className="py-1.5 text-white">{c.famille}</td>
                      <td className="py-1.5 text-white/70">{monthLabel(c.mois)}</td>
                      <td className="py-1.5 text-right font-[var(--font-mono)] text-[#D69A4A]">{c.nbReferences}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 border-t border-white/10 px-6 py-4">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-2.5 text-sm text-white/80 hover:bg-white/5">
                <input type="radio" name="conflit" className="mt-0.5" checked={conflitResolution === "aligner"} onChange={() => setConflitResolution("aligner")} />
                <span>
                  <strong className="text-white">Aligner seulement celles qui suivaient la famille</strong>
                  <br />
                  <span className="text-xs text-white/45">Les références dont la valeur actuelle était identique à l&rsquo;ancienne valeur famille suivent le changement. Les autres, réellement personnalisées, ne bougent pas.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-2.5 text-sm text-white/80 hover:bg-white/5">
                <input type="radio" name="conflit" className="mt-0.5" checked={conflitResolution === "ecraser"} onChange={() => setConflitResolution("ecraser")} />
                <span>
                  <strong className="text-white">Écraser toutes les références</strong>
                  <br />
                  <span className="text-xs text-white/45">Toutes les surcharges concernées sont supprimées : ces références hériteront de la nouvelle valeur famille.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-2.5 text-sm text-white/80 hover:bg-white/5">
                <input type="radio" name="conflit" className="mt-0.5" checked={conflitResolution === "annuler"} onChange={() => setConflitResolution("annuler")} />
                <span>
                  <strong className="text-white">Annuler ces cellules famille</strong>
                  <br />
                  <span className="text-xs text-white/45">Les modifications famille concernées par un conflit sont abandonnées. Le reste de la saisie (autres mois, autres familles, surcharges saisies à la main) est conservé.</span>
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setConflitOuvert(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white">
                Retour
              </button>
              <button onClick={() => void handleConfirmConflit()} className="rounded-lg bg-[#A6A181] px-4 py-2 text-sm font-semibold text-[#141A26] hover:brightness-110">
                Confirmer et enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
