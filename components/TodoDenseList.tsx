"use client";

/**
 * TodoDenseList — V2
 * ------------------------------------------------------------------------
 * Vue dense de todo_actions, filtrée sur les tâches ACCESSIBLES à
 * l'utilisateur connecté — même logique que refreshTodoSignal() dans
 * AppShell (layout.tsx) : assigné à son email, OU à son display_name
 * (ancien format, avant migration vers l'email comme identifiant).
 *
 * Colonnes : domaine (mission_project) / description (description_action) /
 * qui (assigned_to) / quand (due_date), triable par colonne.
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
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const email = sessionData.session?.user?.email?.toLowerCase();
        if (!email) { setRows([]); setLoading(false); return; }

        // display_name (ancien identifiant d'assignation) : lu depuis
        // user_page_access, même source que AppShell.
        const { data: profile } = await supabase
          .from("user_page_access")
          .select("display_name")
          .ilike("email", email)
          .maybeSingle();
        const legacyDisplayName = (profile?.display_name || email.split("@")[0] || "").trim();
        const assigneeValues = Array.from(new Set([email, legacyDisplayName].map((v) => v.trim()).filter(Boolean)));

        if (!assigneeValues.length) { if (!cancelled) { setRows([]); setLoading(false); } return; }

        const orFilter = assigneeValues.map((v) => `assigned_to.eq.${v.replace(/,/g, "\\,")}`).join(",");
        const { data, error: err } = await supabase
          .from("todo_actions")
          .select("id, mission_project, description_action, assigned_to, due_date, status")
          .or(orFilter)
          .order("due_date", { ascending: true, nullsFirst: false });
        if (cancelled) return;
        if (err) throw err;
        setRows((data || []) as TodoRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
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
        <h3 className="font-[var(--font-display,inherit)] text-sm font-bold">Mes tâches</h3>
        <span className="text-[10px] text-[#141A26]/45">{visibleRows.length}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1 text-[10px] text-[#141A26]/60">
          <input type="checkbox" checked={hideTerminees} onChange={(e) => setHideTerminees(e.target.checked)} className="h-3 w-3 accent-[#A6A181]" />
          Masquer term./annul.
        </label>
      </div>

      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-[10px] text-red-700">{error}</p>}

      {loading ? (
        <div className="h-32 animate-pulse rounded-lg bg-black/[0.04]" />
      ) : (
        <div className="max-h-[280px] overflow-auto rounded-lg border border-black/10">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#EDEAE0]">
              <tr className="border-b border-black/10 text-left uppercase tracking-wide text-[#141A26]/50">
                <th className="cursor-pointer whitespace-nowrap px-1.5 py-1" onClick={() => toggleSort("mission_project")}>
                  Domaine {sortKey === "mission_project" && (sortAsc ? "▲" : "▼")}
                </th>
                <th className="px-1.5 py-1">Description</th>
                <th className="cursor-pointer whitespace-nowrap px-1.5 py-1" onClick={() => toggleSort("due_date")}>
                  Quand {sortKey === "due_date" && (sortAsc ? "▲" : "▼")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {visibleRows.map((r) => (
                <tr key={r.id} className={isEnRetard(r.due_date, r.status) ? "bg-[#C1683C]/[0.06]" : undefined}>
                  <td className="whitespace-nowrap px-1.5 py-1 text-[#141A26]/75">{r.mission_project || "—"}</td>
                  <td className="max-w-[160px] truncate px-1.5 py-1 text-[#141A26]" title={r.description_action || ""}>{r.description_action || "—"}</td>
                  <td className={`whitespace-nowrap px-1.5 py-1 font-medium ${isEnRetard(r.due_date, r.status) ? "text-[#C1683C]" : "text-[#141A26]/70"}`}>
                    {formatDate(r.due_date)}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><td colSpan={3} className="px-2 py-6 text-center text-[#141A26]/40">Aucune tâche.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={() => router.push("/todo")}
        className="mt-2 w-full rounded-lg border border-black/15 py-1.5 text-[10px] font-semibold text-[#141A26]/70 hover:bg-black/5"
      >
        Ouvrir la todo list complète
      </button>
    </div>
  );
}
