"use client";

/**
 * TodoDenseList
 * ------------------------------------------------------------------------
 * Vue dense de la table todo_actions pour l'écran Vision One page TCI :
 * une ligne par tâche, triable par date prévue. Colonnes demandées :
 * domaine / description / qui / quand.
 *
 * Correspondance de colonnes (table todo_actions n'a pas de colonne
 * "domaine" à proprement parler — mission_project en tient lieu, c'est le
 * champ le plus proche sémantiquement) :
 *   domaine      → mission_project
 *   description  → description_action
 *   qui          → assigned_to
 *   quand        → due_date
 *
 * Lecture seule ici (pas d'édition) — l'écran /todo existant reste l'outil
 * de gestion complet.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TodoRow = {
  id: string;
  mission_project: string | null;
  description_action: string | null;
  assigned_to: string | null;
  due_date: string | null;
  status: string | null;
};

type SortKey = "due_date" | "mission_project" | "assigned_to";

const STATUT_COLOR: Record<string, string> = {
  "Terminé": "#3F9142",
  "Annulé": "#8A93A6",
  "En cours": "#D69A4A",
  "À faire": "#4B92AC",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function isEnRetard(value: string | null, status: string | null): boolean {
  if (!value || status === "Terminé" || status === "Annulé") return false;
  return value < new Date().toISOString().slice(0, 10);
}

export default function TodoDenseList() {
  const router = useRouter();
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortAsc, setSortAsc] = useState(true);
  const [hideTerminees, setHideTerminees] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("todo_actions")
        .select("id, mission_project, description_action, assigned_to, due_date, status")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data || []) as TodoRow[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const visibleRows = useMemo(() => {
    let list = hideTerminees ? rows.filter((r) => r.status !== "Terminé" && r.status !== "Annulé") : rows;
    list = [...list].sort((a, b) => {
      const av = (a[sortKey] || "").toString().toLowerCase();
      const bv = (b[sortKey] || "").toString().toLowerCase();
      const cmp = av.localeCompare(bv, "fr");
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, sortAsc, hideTerminees]);

  return (
    <div className="rounded-2xl border border-black/10 bg-[#F5F3EC] p-3 text-[#141A26]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-[var(--font-display,inherit)] text-base font-bold">À faire</h3>
        <span className="text-xs text-[#141A26]/45">{visibleRows.length} tâche(s)</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-[#141A26]/60">
          <input type="checkbox" checked={hideTerminees} onChange={(e) => setHideTerminees(e.target.checked)} className="h-3.5 w-3.5 accent-[#A6A181]" />
          Masquer terminées/annulées
        </label>
        <button
          onClick={() => router.push("/todo")}
          className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-semibold text-[#141A26]/70 hover:bg-black/5"
        >
          Ouvrir la todo list complète
        </button>
      </div>

      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      {loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-black/[0.04]" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.03] text-left uppercase tracking-wide text-[#141A26]/50">
                <th className="cursor-pointer whitespace-nowrap px-2 py-1.5" onClick={() => toggleSort("mission_project")}>
                  Domaine {sortKey === "mission_project" && (sortAsc ? "▲" : "▼")}
                </th>
                <th className="px-2 py-1.5">Description</th>
                <th className="cursor-pointer whitespace-nowrap px-2 py-1.5" onClick={() => toggleSort("assigned_to")}>
                  Qui {sortKey === "assigned_to" && (sortAsc ? "▲" : "▼")}
                </th>
                <th className="cursor-pointer whitespace-nowrap px-2 py-1.5" onClick={() => toggleSort("due_date")}>
                  Quand {sortKey === "due_date" && (sortAsc ? "▲" : "▼")}
                </th>
                <th className="whitespace-nowrap px-2 py-1.5">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {visibleRows.map((r) => (
                <tr key={r.id} className={isEnRetard(r.due_date, r.status) ? "bg-[#C1683C]/[0.06]" : undefined}>
                  <td className="whitespace-nowrap px-2 py-1 text-[#141A26]/80">{r.mission_project || "—"}</td>
                  <td className="max-w-[320px] truncate px-2 py-1 text-[#141A26]">{r.description_action || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-[#141A26]/70">{r.assigned_to || "—"}</td>
                  <td className={`whitespace-nowrap px-2 py-1 font-medium ${isEnRetard(r.due_date, r.status) ? "text-[#C1683C]" : "text-[#141A26]/70"}`}>
                    {formatDate(r.due_date)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: `${STATUT_COLOR[r.status || ""] || "#8A93A6"}22`, color: STATUT_COLOR[r.status || ""] || "#8A93A6" }}
                    >
                      {r.status || "—"}
                    </span>
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-6 text-center text-[#141A26]/40">Aucune tâche.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
