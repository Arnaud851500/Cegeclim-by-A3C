"use client";

/**
 * TodoDenseList — V4
 * ------------------------------------------------------------------------
 * Vue dense de todo_actions, filtrée sur les tâches ACCESSIBLES à
 * l'utilisateur connecté :
 *   - assignées à lui (assigned_to = son email OU son display_name, ancien
 *     format, même logique que refreshTodoSignal() dans AppShell) ;
 *   - OU créées par lui (created_by_email), même s'il les a confiées à
 *     quelqu'un d'autre -- c'est ce qui manquait, cf. l'onglet "Créées par
 *     moi" de l'écran /todo complet.
 *
 * Colonnes : domaine (mission_project) / description (description_action) /
 * client (numero_tiers -> intitule, tronqué à 15 caractères) / confiée à
 * (assigned_to, résolu en nom d'affichage) / quand (due_date), triable par
 * colonne.
 *
 * FIX (2026-08, cette révision) :
 *  - "Confiée à" affichait l'email brut -- résolu en nom d'affichage via
 *    user_page_access (même mécanique que /todo, TodoPage.tsx), colonne
 *    rétrécie en conséquence (les noms sont plus courts que les emails).
 *  - Colonne "Client" ajoutée : numero_tiers -> intitule via ref_tiers,
 *    tronqué à 15 caractères pile (pas juste une troncature CSS -- la
 *    demande était un nombre de caractères précis).
 *  - Colonne "Domaine" (mission_project) réduite en largeur.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TodoRow = {
  id: string;
  mission_project: string | null;
  description_action: string | null;
  assigned_to: string | null;
  created_by_email: string | null;
  due_date: string | null;
  status: string | null;
  numero_tiers: string | null;
};

type SortKey = "due_date" | "mission_project" | "assigned_to";

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

/** Nom lisible par défaut quand user_page_access n'a pas de display_name
 * pour cette adresse (repli, même logique que le reste de l'app). */
function fallbackNameFromEmail(value: string) {
  const local = String(value || "").split("@")[0] || value;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || value;
}

/** Troncature à N caractères exactement (pas une troncature CSS) -- la
 * demande portait spécifiquement sur "15 caractères", donc on tronque la
 * chaîne elle-même et on ajoute une ellipse si nécessaire. */
function truncateChars(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export default function TodoDenseList() {
  const router = useRouter();
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortAsc, setSortAsc] = useState(true);
  const [hideTerminees, setHideTerminees] = useState(true);
  const [assigneeNames, setAssigneeNames] = useState<Map<string, string>>(new Map());
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());

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

        // Assigné à moi (email ou ancien display_name) OU créé par moi —
        // même si je l'ai confié à quelqu'un d'autre.
        const orParts = [
          ...assigneeValues.map((v) => `assigned_to.eq.${v.replace(/,/g, "\\,")}`),
          `created_by_email.eq.${email.replace(/,/g, "\\,")}`,
        ];
        const orFilter = orParts.join(",");
        const { data, error: err } = await supabase
          .from("todo_actions")
          .select("id, mission_project, description_action, assigned_to, created_by_email, due_date, status, numero_tiers")
          .or(orFilter)
          .order("due_date", { ascending: true, nullsFirst: false });
        if (cancelled) return;
        if (err) throw err;
        const loadedRows = (data || []) as TodoRow[];
        setRows(loadedRows);

        // Résolution des noms d'affichage pour "Confiée à" -- toute la
        // table user_page_access (léger, pas besoin de filtrer sur can_todo
        // ici puisqu'on ne fait que résoudre des libellés déjà présents).
        const { data: usersData } = await supabase.from("user_page_access").select("email, display_name");
        const nameMap = new Map<string, string>();
        ((usersData || []) as Array<{ email: string | null; display_name: string | null }>).forEach((u) => {
          const key = String(u.email || "").trim().toLowerCase();
          if (!key) return;
          nameMap.set(key, String(u.display_name || "").trim() || fallbackNameFromEmail(key));
        });
        if (!cancelled) setAssigneeNames(nameMap);

        // Résolution des noms client pour la colonne "Client".
        const numeros = Array.from(new Set(loadedRows.map((r) => r.numero_tiers).filter((v): v is string => Boolean(v))));
        if (numeros.length > 0) {
          const { data: tiersData } = await supabase.from("ref_tiers").select("numero, intitule").in("numero", numeros);
          const clientMap = new Map<string, string>();
          ((tiersData || []) as Array<{ numero: string | null; intitule: string | null }>).forEach((t) => {
            if (!t.numero) return;
            clientMap.set(t.numero, String(t.intitule || "").trim() || t.numero);
          });
          if (!cancelled) setClientNames(clientMap);
        } else if (!cancelled) {
          setClientNames(new Map());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  /** "Confiée à" peut contenir un email OU un display_name (ancien format,
   * cf. note en tête de fichier) -- on résout les deux vers le nom actuel. */
  function assigneeLabel(value: string | null): string {
    const raw = String(value || "").trim();
    if (!raw) return "—";
    const byEmail = assigneeNames.get(raw.toLowerCase());
    if (byEmail) return byEmail;
    const byName = Array.from(assigneeNames.values()).find((n) => n.toLowerCase() === raw.toLowerCase());
    if (byName) return byName;
    return raw.includes("@") ? fallbackNameFromEmail(raw) : raw;
  }

  function clientLabel(numeroTiers: string | null): string | null {
    if (!numeroTiers) return null;
    const nom = clientNames.get(numeroTiers) || numeroTiers;
    return truncateChars(nom, 15);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const visibleRows = useMemo(() => {
    let list = hideTerminees ? rows.filter((r) => r.status !== "Terminé" && r.status !== "Annulé") : rows;
    list = [...list].sort((a, b) => {
      const av = sortKey === "assigned_to" ? assigneeLabel(a.assigned_to) : (a[sortKey] || "").toString();
      const bv = sortKey === "assigned_to" ? assigneeLabel(b.assigned_to) : (b[sortKey] || "").toString();
      const cmp = av.toLowerCase().localeCompare(bv.toLowerCase(), "fr");
      return sortAsc ? cmp : -cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortAsc, hideTerminees, assigneeNames]);

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
                <th className="cursor-pointer whitespace-nowrap px-1.5 py-1" style={{ width: 64 }} onClick={() => toggleSort("mission_project")}>
                  Domaine {sortKey === "mission_project" && (sortAsc ? "▲" : "▼")}
                </th>
                <th className="px-1.5 py-1">Description</th>
                <th className="whitespace-nowrap px-1.5 py-1" style={{ width: 96 }}>Client</th>
                <th className="cursor-pointer whitespace-nowrap px-1.5 py-1" style={{ width: 84 }} onClick={() => toggleSort("assigned_to")}>
                  Confiée à {sortKey === "assigned_to" && (sortAsc ? "▲" : "▼")}
                </th>
                <th className="cursor-pointer whitespace-nowrap px-1.5 py-1" onClick={() => toggleSort("due_date")}>
                  Quand {sortKey === "due_date" && (sortAsc ? "▲" : "▼")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {visibleRows.map((r) => {
                const client = clientLabel(r.numero_tiers);
                return (
                  <tr key={r.id} className={isEnRetard(r.due_date, r.status) ? "bg-[#C1683C]/[0.06]" : undefined}>
                    <td className="max-w-[64px] truncate px-1.5 py-1 text-[#141A26]/75" title={r.mission_project || ""}>{r.mission_project || "—"}</td>
                    <td className="max-w-[140px] truncate px-1.5 py-1 text-[#141A26]" title={r.description_action || ""}>{r.description_action || "—"}</td>
                    <td className="max-w-[96px] truncate px-1.5 py-1 text-[#2C6F88]" title={clientNames.get(r.numero_tiers || "") || ""}>{client || "—"}</td>
                    <td className="max-w-[84px] truncate px-1.5 py-1 text-[#141A26]/70" title={assigneeLabel(r.assigned_to)}>{assigneeLabel(r.assigned_to)}</td>
                    <td className={`whitespace-nowrap px-1.5 py-1 font-medium ${isEnRetard(r.due_date, r.status) ? "text-[#C1683C]" : "text-[#141A26]/70"}`}>
                      {formatDate(r.due_date)}
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-6 text-center text-[#141A26]/40">Aucune tâche.</td></tr>
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
