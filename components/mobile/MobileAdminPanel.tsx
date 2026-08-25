"use client";

// MobileAdminPanel.tsx
//
// À ADAPTER AVANT INTÉGRATION (3 points seulement) :
//   1. Ligne d'import du client Supabase ci-dessous — remplacer par le chemin
//      réel utilisé dans le reste du projet (ex: '@/lib/supabase', '@/lib/supabaseClient'...).
//   2. Ajouter une entrée de navigation vers ce composant dans MobileShell
//      (visible uniquement si l'utilisateur est admin — le composant fait
//      de toute façon sa propre vérification via current_user_is_admin()).
//   3. Le nom du bucket est 'sage-imports' — à ajuster si différent.
//
// Sécurité : chaque action sensible (lancer le VPS, lancer un job pg_cron)
// redemande le mot de passe du compte connecté et le revalide via
// supabase.auth.signInWithPassword() avant d'écrire quoi que ce soit.
// Le requêteur de tables est strictement lecture seule côté serveur
// (fonction admin_query, SELECT uniquement, jamais d'INSERT/UPDATE/DELETE).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient"; // <-- (1) ajuster ce chemin

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StorageObject = {
  name: string;
  created_at?: string;
  updated_at?: string;
  metadata?: { size?: number };
};

type JobStatus = "pending" | "running" | "completed" | "error";

type WhereCondition = {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is_null" | "is_not_null";
  value: string;
};

const BUCKET_NAME = "sage-imports"; // <-- (3) ajuster si besoin

// ---------------------------------------------------------------------------
// Composant : confirmation par mot de passe avant action sensible
// ---------------------------------------------------------------------------

function PasswordConfirmModal({
  open,
  actionLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  actionLabel: string;
  onCancel: () => void;
  onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm(password);
      setPassword("");
    } catch (e: any) {
      setError(e?.message || "Mot de passe incorrect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-[#F5F3EC] p-5 sm:rounded-2xl">
        <h3 className="mb-1 font-['Space_Grotesk'] text-lg font-semibold text-[#0B1220]">
          Confirmation requise
        </h3>
        <p className="mb-4 text-sm text-[#0B1220]/70">
          Ressaisis ton mot de passe pour : <strong>{actionLabel}</strong>
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          className="mb-2 w-full rounded-lg border border-[#0B1220]/15 bg-white px-3 py-2 text-[#0B1220] outline-none focus:border-[#7A5EA8]"
        />
        {error && <p className="mb-2 text-sm text-[#C1683C]">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[#0B1220]/15 py-2 text-sm font-medium text-[#0B1220]"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || password.length === 0}
            className="flex-1 rounded-lg bg-[#0B1220] py-2 text-sm font-medium text-[#F5F3EC] disabled:opacity-40"
          >
            {loading ? "Vérification..." : "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export default function MobileAdminPanel() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [pendingFiles, setPendingFiles] = useState<StorageObject[]>([]);
  const [archivedFiles, setArchivedFiles] = useState<StorageObject[]>([]);
  const [bucketLoading, setBucketLoading] = useState(false);

  const [vpsStatus, setVpsStatus] = useState<JobStatus | null>(null);
  const [syncJobStatus, setSyncJobStatus] = useState<JobStatus | null>(null);
  const [recalculJobStatus, setRecalculJobStatus] = useState<JobStatus | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    label: string;
    onConfirmed: () => Promise<void>;
  } | null>(null);

  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([]);
  const [queryResults, setQueryResults] = useState<Record<string, any>[] | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  // -- Vérification admin (source de vérité : la fonction SQL elle-même) ----
  useEffect(() => {
    supabase.rpc("current_user_is_admin").then(({ data, error }) => {
      if (error) {
        console.error(error);
        setIsAdmin(false);
        return;
      }
      setIsAdmin(Boolean(data));
    });
  }, []);

  // -- Bucket -----------------------------------------------------------------
  const loadBucket = useCallback(async () => {
    setBucketLoading(true);
    const [rootRes, archiveRes] = await Promise.all([
      supabase.storage.from(BUCKET_NAME).list("", { limit: 50 }),
      supabase.storage.from(BUCKET_NAME).list("archive", {
        limit: 20,
        sortBy: { column: "created_at", order: "desc" },
      }),
    ]);
    setPendingFiles((rootRes.data as StorageObject[]) || []);
    setArchivedFiles((archiveRes.data as StorageObject[]) || []);
    setBucketLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) loadBucket();
  }, [isAdmin, loadBucket]);

  // -- Table listing pour le requêteur ----------------------------------------
  useEffect(() => {
    if (!isAdmin) return;
    supabase.rpc("admin_list_tables").then(({ data, error }) => {
      if (error) {
        console.error(error);
        return;
      }
      setTables((data || []).map((r: any) => r.table_name));
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!selectedTable) {
      setColumns([]);
      setSelectedFields([]);
      return;
    }
    supabase.rpc("admin_list_columns", { p_table: selectedTable }).then(({ data, error }) => {
      if (error) {
        console.error(error);
        return;
      }
      setColumns((data || []).map((r: any) => r.column_name));
      setSelectedFields([]);
      setWhereConditions([]);
      setQueryResults(null);
    });
  }, [selectedTable]);

  // -- Confirmation mot de passe -----------------------------------------------
  const requireConfirmation = (label: string, action: () => Promise<void>) => {
    setConfirmModal({
      label,
      onConfirmed: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const email = userData?.user?.email;
        if (!email) throw new Error("Session expirée, reconnecte-toi.");
        // password est fourni via le paramètre du modal — voir handlePasswordConfirm
        await action();
      },
    });
  };

  const handlePasswordConfirm = async (password: string) => {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData?.user?.email;
    if (!email) throw new Error("Session expirée, reconnecte-toi.");

    // Revalide le mot de passe sans perdre la session en cours.
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Mot de passe incorrect.");

    if (confirmModal) {
      await confirmModal.onConfirmed();
    }
    setConfirmModal(null);
  };

  // -- Déclenchement VPS ---------------------------------------------------
  const pollJobStatus = (
    table: "admin_vps_commands" | "admin_background_jobs",
    id: string,
    setStatus: (s: JobStatus) => void,
  ) => {
    const interval = setInterval(async () => {
      const { data } = await supabase.from(table).select("status").eq("id", id).single();
      if (data) {
        setStatus(data.status as JobStatus);
        if (data.status === "completed" || data.status === "error") {
          clearInterval(interval);
          if (table === "admin_vps_commands") loadBucket();
        }
      }
    }, 2000);
  };

  const triggerVpsImport = () => {
    requireConfirmation("Lancer l'import VPS", async () => {
      setVpsStatus("pending");
      const { data, error } = await supabase
        .from("admin_vps_commands")
        .insert({ command: "start_sage_import" })
        .select("id")
        .single();
      if (error || !data) {
        setVpsStatus("error");
        throw error;
      }
      pollJobStatus("admin_vps_commands", data.id, setVpsStatus);
    });
  };

  const triggerBackgroundJob = (
    jobName: "sync_sage_to_activite" | "stock_projection_recalcul",
    label: string,
    setStatus: (s: JobStatus) => void,
  ) => {
    requireConfirmation(label, async () => {
      setStatus("pending");
      const { data, error } = await supabase
        .from("admin_background_jobs")
        .insert({ job_name: jobName })
        .select("id")
        .single();
      if (error || !data) {
        setStatus("error");
        throw error;
      }
      pollJobStatus("admin_background_jobs", data.id, setStatus);
    });
  };

  // -- Requêteur de tables ---------------------------------------------------
  const toggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  };

  const addWhereCondition = () => {
    if (columns.length === 0) return;
    setWhereConditions((prev) => [...prev, { field: columns[0], operator: "eq", value: "" }]);
  };

  const updateWhereCondition = (index: number, patch: Partial<WhereCondition>) => {
    setWhereConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const removeWhereCondition = (index: number) => {
    setWhereConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const runQuery = async () => {
    if (!selectedTable || selectedFields.length === 0) return;
    setQueryLoading(true);
    setQueryError(null);
    setQueryResults(null);

    const { data, error } = await supabase.rpc("admin_query", {
      p_table: selectedTable,
      p_fields: selectedFields,
      p_where: whereConditions.filter((c) => c.field && c.operator),
      p_limit: 100,
    });

    setQueryLoading(false);
    if (error) {
      setQueryError(error.message);
      return;
    }
    setQueryResults(data as Record<string, any>[]);
  };

  // ---------------------------------------------------------------------------

  if (isAdmin === null) {
    return <div className="p-6 text-sm text-[#0B1220]/60">Vérification des droits...</div>;
  }

  if (isAdmin === false) {
    return (
      <div className="p-6 text-sm text-[#C1683C]">
        Accès réservé au profil administrateur.
      </div>
    );
  }

  const statusBadge = (status: JobStatus | null) => {
    if (!status) return null;
    const styles: Record<JobStatus, string> = {
      pending: "bg-[#A6A181]/20 text-[#0B1220]",
      running: "bg-[#7A5EA8]/20 text-[#7A5EA8]",
      completed: "bg-green-100 text-green-700",
      error: "bg-[#C1683C]/20 text-[#C1683C]",
    };
    const labels: Record<JobStatus, string> = {
      pending: "En attente",
      running: "En cours...",
      completed: "Terminé ✓",
      error: "Erreur ✗",
    };
    return (
      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F3EC] pb-24 font-['IBM_Plex_Sans']">
      <div className="sticky top-0 z-10 bg-[#0B1220] px-4 py-4">
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold text-[#F5F3EC]">
          Administration
        </h1>
      </div>

      {/* --- Bucket --- */}
      <section className="mx-4 mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#0B1220]">
            Bucket sage-imports
          </h2>
          <button onClick={loadBucket} className="text-xs text-[#7A5EA8]">
            {bucketLoading ? "..." : "Rafraîchir"}
          </button>
        </div>

        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#0B1220]/50">
          En attente ({pendingFiles.length})
        </p>
        <div className="mb-3 space-y-1">
          {pendingFiles.length === 0 && (
            <p className="text-sm text-[#0B1220]/50">Aucun fichier en attente.</p>
          )}
          {pendingFiles.map((f) => (
            <div key={f.name} className="flex justify-between text-sm text-[#0B1220]">
              <span className="truncate">{f.name}</span>
              <span className="ml-2 shrink-0 text-[#0B1220]/50">
                {f.metadata?.size ? `${Math.round((f.metadata.size / 1024) * 10) / 10} Ko` : ""}
              </span>
            </div>
          ))}
        </div>

        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#0B1220]/50">
          Derniers archivés
        </p>
        <div className="space-y-1">
          {archivedFiles.map((f) => (
            <div key={f.name} className="flex justify-between text-sm text-[#0B1220]/70">
              <span className="truncate">{f.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* --- Actions --- */}
      <section className="mx-4 mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-['Space_Grotesk'] text-base font-semibold text-[#0B1220]">
          Actions serveur
        </h2>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-[#0B1220]">Lancer l'import VPS</span>
          <div className="flex items-center">
            {statusBadge(vpsStatus)}
            <button
              onClick={triggerVpsImport}
              disabled={vpsStatus === "pending" || vpsStatus === "running"}
              className="ml-2 rounded-lg bg-[#0B1220] px-3 py-1.5 text-xs font-medium text-[#F5F3EC] disabled:opacity-40"
            >
              Lancer
            </button>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-[#0B1220]">Sync SAGE → activité</span>
          <div className="flex items-center">
            {statusBadge(syncJobStatus)}
            <button
              onClick={() =>
                triggerBackgroundJob("sync_sage_to_activite", "Lancer sync SAGE → activité", setSyncJobStatus)
              }
              disabled={syncJobStatus === "pending" || syncJobStatus === "running"}
              className="ml-2 rounded-lg bg-[#0B1220] px-3 py-1.5 text-xs font-medium text-[#F5F3EC] disabled:opacity-40"
            >
              Lancer
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-[#0B1220]">Recalcul projection stock</span>
          <div className="flex items-center">
            {statusBadge(recalculJobStatus)}
            <button
              onClick={() =>
                triggerBackgroundJob(
                  "stock_projection_recalcul",
                  "Lancer le recalcul de projection stock",
                  setRecalculJobStatus,
                )
              }
              disabled={recalculJobStatus === "pending" || recalculJobStatus === "running"}
              className="ml-2 rounded-lg bg-[#0B1220] px-3 py-1.5 text-xs font-medium text-[#F5F3EC] disabled:opacity-40"
            >
              Lancer
            </button>
          </div>
        </div>
      </section>

      {/* --- Requêteur --- */}
      <section className="mx-4 mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-['Space_Grotesk'] text-base font-semibold text-[#0B1220]">
          Requêteur (lecture seule)
        </h2>

        <label className="mb-1 block text-xs font-medium text-[#0B1220]/60">Table</label>
        <select
          value={selectedTable}
          onChange={(e) => setSelectedTable(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[#0B1220]/15 bg-white px-3 py-2 text-sm text-[#0B1220]"
        >
          <option value="">— Choisir une table —</option>
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {columns.length > 0 && (
          <>
            <label className="mb-1 block text-xs font-medium text-[#0B1220]/60">
              Champs à retourner
            </label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleField(c)}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    selectedFields.includes(c)
                      ? "bg-[#7A5EA8] text-white"
                      : "bg-[#0B1220]/5 text-[#0B1220]/70"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-xs font-medium text-[#0B1220]/60">
              Conditions (WHERE)
            </label>
            <div className="mb-2 space-y-2">
              {whereConditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={cond.field}
                    onChange={(e) => updateWhereCondition(i, { field: e.target.value })}
                    className="rounded-lg border border-[#0B1220]/15 px-2 py-1.5 text-xs"
                  >
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={cond.operator}
                    onChange={(e) =>
                      updateWhereCondition(i, { operator: e.target.value as WhereCondition["operator"] })
                    }
                    className="rounded-lg border border-[#0B1220]/15 px-2 py-1.5 text-xs"
                  >
                    <option value="eq">=</option>
                    <option value="neq">≠</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&lt;=</option>
                    <option value="like">contient</option>
                    <option value="ilike">contient (insensible casse)</option>
                    <option value="is_null">est vide</option>
                    <option value="is_not_null">n'est pas vide</option>
                  </select>
                  {cond.operator !== "is_null" && cond.operator !== "is_not_null" && (
                    <input
                      value={cond.value}
                      onChange={(e) => updateWhereCondition(i, { value: e.target.value })}
                      placeholder="valeur"
                      className="min-w-0 flex-1 rounded-lg border border-[#0B1220]/15 px-2 py-1.5 text-xs"
                    />
                  )}
                  <button onClick={() => removeWhereCondition(i)} className="text-[#C1683C]">
                    ✕
                  </button>
                </div>
              ))}
              <button onClick={addWhereCondition} className="text-xs text-[#7A5EA8]">
                + Ajouter une condition
              </button>
            </div>

            <button
              onClick={runQuery}
              disabled={selectedFields.length === 0 || queryLoading}
              className="mb-3 w-full rounded-lg bg-[#0B1220] py-2 text-sm font-medium text-[#F5F3EC] disabled:opacity-40"
            >
              {queryLoading ? "Exécution..." : "Exécuter"}
            </button>
          </>
        )}

        {queryError && (
          <p className="mb-2 rounded-lg bg-[#C1683C]/10 p-2 text-xs text-[#C1683C]">{queryError}</p>
        )}

        {queryResults && (
          <div className="overflow-x-auto rounded-lg border border-[#0B1220]/10">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0B1220]/5">
                  {selectedFields.map((f) => (
                    <th key={f} className="whitespace-nowrap px-2 py-1.5 font-medium text-[#0B1220]">
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queryResults.map((row, i) => (
                  <tr key={i} className="border-t border-[#0B1220]/5">
                    {selectedFields.map((f) => (
                      <td key={f} className="whitespace-nowrap px-2 py-1.5 text-[#0B1220]/80">
                        {String(row[f] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {queryResults.length === 0 && (
              <p className="p-2 text-xs text-[#0B1220]/50">Aucun résultat.</p>
            )}
          </div>
        )}
      </section>

      <PasswordConfirmModal
        open={confirmModal !== null}
        actionLabel={confirmModal?.label || ""}
        onCancel={() => setConfirmModal(null)}
        onConfirm={handlePasswordConfirm}
      />
    </div>
  );
}
