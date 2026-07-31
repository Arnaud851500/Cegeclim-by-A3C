"use client";

/**
 * MonthlyHypothesesMatrix
 * ------------------------------------------------------------------------
 * Grille d'hypothèses mensuelles d'évolution des ventes vs N-1, par famille.
 * Remplace l'ancien "scénario % global" : chaque famille porte désormais
 * un coefficient par mois (100% par défaut), persistant à travers les
 * imports. La cascade de résolution côté base est :
 *   hypothèse propre à un article  >  hypothèse mensuelle de sa famille  >  100%
 *
 * Deux usages :
 *  - familleFilter = null  → écran plein : toutes les familles macro / familles,
 *    ouvert depuis le bouton "Hypothèses mensuelles" en haut de l'écran principal.
 *  - familleFilter = "XXX" → une seule famille, ouvert depuis l'écran famille
 *    ("Ajuster les hypothèses de cette famille"). À la sauvegarde, la
 *    projection de cette famille est recalculée automatiquement avant de
 *    revenir à l'écran d'origine.
 *
 * RPC utilisées (SECURITY DEFINER, cf. migrations Supabase) :
 *  - get_stock_hypotheses_matrice(p_nb_mois, p_famille)
 *  - upsert_stock_hypotheses_mensuelles(p_hypotheses jsonb)
 *  - recalc_stock_projection_scope_hypotheses(p_run_id, p_scope, p_cle, p_depot)
 * ------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MatriceRow = { famille_macro: string; famille: string; mois: string; coefficient: number };

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

function key(famille: string, mois: string) {
  return `${famille}|${mois}`;
}

export default function MonthlyHypothesesMatrix({ familleFilter = null, runId = null, nbMois = 24, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [rowsMeta, setRowsMeta] = useState<Array<{ macro: string; famille: string }>>([]);
  const [values, setValues] = useState<Map<string, number>>(new Map()); // pct entier, 100 = 100%
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

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
        rows.forEach((r) => {
          metaMap.set(r.famille, { macro: r.famille_macro, famille: r.famille });
          val.set(key(r.famille, r.mois), Math.round(Number(r.coefficient) * 100));
        });
        setMonths(monthsSet);
        setRowsMeta(Array.from(metaMap.values()).sort((a, b) => a.macro.localeCompare(b.macro) || a.famille.localeCompare(b.famille)));
        setValues(val);
        setDirty(new Set());
        setSaved(null);
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

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      if (dirty.size > 0) {
        const hypotheses = Array.from(dirty).map((k) => {
          const [famille, mois] = k.split("|");
          const pct = values.get(k) ?? 100;
          return { famille, mois, coefficient: Math.max(0, pct) / 100 };
        });
        const { data, error: err } = await supabase.rpc("upsert_stock_hypotheses_mensuelles", { p_hypotheses: hypotheses });
        if (err) throw new Error(err.message);
        setSaved(`${(data as { lignes?: number })?.lignes ?? hypotheses.length} valeur(s) enregistrée(s).`);
        setDirty(new Set());
      }

      // Édition scopée à une famille : on recalcule immédiatement cette
      // famille à partir des hypothèses tout juste enregistrées, pour que
      // l'écran d'origine affiche la projection à jour dès le retour.
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#060A12]/80 p-4">
      <div className="flex h-[88vh] w-full max-w-[1400px] flex-col rounded-2xl border border-white/10 bg-[#101A2E] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="font-[var(--font-display)] text-lg font-bold text-white">
              Hypothèses mensuelles {familleFilter ? `— ${familleFilter}` : "— toutes les familles"}
            </h2>
            <p className="mt-0.5 text-xs text-white/45">
              % d&rsquo;évolution des ventes vs N-1, par famille et par mois. 100% = identique à N-1. Ces valeurs sont
              conservées à travers les imports et pilotent le recalcul de la projection ; elles sont interprétées au
              prorata pour obtenir un coefficient hebdomadaire.
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
              onClick={() => void handleSave()}
              disabled={saving}
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
                  <th className="sticky left-0 z-20 min-w-[160px] border-b border-r border-white/10 bg-[#101A2E] px-3 py-2 text-left text-white/50">
                    Famille macro
                  </th>
                  <th className="sticky left-[160px] z-20 min-w-[160px] border-b border-r border-white/10 bg-[#101A2E] px-3 py-2 text-left text-white/50">
                    Famille
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
                {filteredRows.map((r) => (
                  <tr key={r.famille} className="odd:bg-white/[0.02]">
                    <td className="sticky left-0 z-10 border-r border-white/10 bg-[#101A2E] px-3 py-1.5 text-white/70">{r.macro}</td>
                    <td className="sticky left-[160px] z-10 border-r border-white/10 bg-[#101A2E] px-3 py-1.5 font-medium text-white">{r.famille}</td>
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
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={months.length + 3} className="px-4 py-8 text-center text-white/40">
                      Aucune famille trouvée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
