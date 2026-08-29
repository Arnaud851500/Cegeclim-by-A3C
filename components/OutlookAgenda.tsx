"use client";

/**
 * OutlookAgenda
 * ------------------------------------------------------------------------
 * Bloc "AGENDA" du mockup "Vision One page TCI" :
 *  - fenêtre glissante des 7 PROCHAINS JOURS, affichage restreint aux
 *    JOURS OUVRÉS (lundi→vendredi uniquement)
 *  - navigation +/- pour glisser la fenêtre de 7 jours en 7 jours
 *  - vision horaire 8h→18h
 *  - clic sur un évènement -> fenêtre de détail intégrée (RDV + compte-rendu,
 *    consultable, modifiable, et supprimable à la main)
 *
 * Les activités affichées viennent de v_rdv_unifie (BLG + RDV "compagnon
 * CEGECLIM" créés depuis l'app avant toute connexion BLG/Outlook).
 *
 * Couleur des RDV basée sur le SECTEUR D'ACTIVITÉ du client lié (même
 * palette TRACKED_SECTORS que la carte "Prospects & Clients").
 *
 * CORRECTIF visuel (révision précédente) : les fenêtres de détail RDV et de
 * création de RDV utilisaient un bloc `<style jsx>` scoped -- dans ce
 * contexte d'intégration, ces styles ne s'appliquaient pas du tout
 * (confirmé par capture d'écran : fenêtre affichée en flux normal, sans
 * overlay ni mise en forme, alors que le reste du composant -- géré en
 * classes Tailwind -- s'affichait correctement). Les deux fenêtres sont
 * donc entièrement réécrites en classes Tailwind, comme le reste du
 * fichier -- plus fiable, et visuellement plus soigné (flottantes,
 * arrondies, avec flou d'arrière-plan).
 *
 * AJOUTS (révision précédente) :
 *  - Suppression d'un RDV "compagnon CEGECLIM" (uniquement ceux-là -- un
 *    RDV synchronisé depuis BLG ne peut pas être supprimé ici, il faut le
 *    faire côté BLG/Outlook).
 *  - Suppression d'un compte-rendu de visite.
 *
 * FIX (2026-08, cette révision) : la suppression d'un compte-rendu (et
 * d'un RDV compagnon) semblait ne pas fonctionner -- le compte-rendu
 * réapparaissait après réouverture de la fiche. Cause : `.delete().eq(...)`
 * suivi d'une simple vérification de `error` ne suffit PAS avec Supabase --
 * quand une policy RLS bloque un DELETE, ça ne renvoie PAS d'erreur, ça
 * supprime silencieusement 0 ligne. Le code enchaînait alors
 * `setCompteRendu(null)` comme si ça avait marché, sans que rien n'ait
 * réellement changé en base. Correctif : `.select('id')` ajouté après
 * chaque `.delete()`, pour vérifier ce qui a RÉELLEMENT été supprimé -- si
 * le tableau retourné est vide, une erreur explicite est levée et affichée
 * (`deleteError`) plutôt que de laisser l'UI mentir. Si cette erreur
 * apparaît en pratique, c'est le signal qu'il manque une policy RLS DELETE
 * sur la table concernée (client_comptes_rendus / rdv_compagnon) côté
 * Supabase -- ce correctif ne peut pas se substituer à l'ajout de cette
 * policy, il rend juste le problème visible au lieu de silencieux.
 * ------------------------------------------------------------------------
 */

import { useMemo, useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

type OutlookEvent = {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  categories: string[];
  colorHex: string | null;
  webLink: string | null;
  source?: "blg" | "compagnon";
  /** Nom d'entreprise liée. */
  company?: string | null;
  /** Numéro tiers SAGE lié -- nécessaire pour ouvrir la fiche/le compte-rendu. */
  numeroTiers?: string | null;
  /** Identifiant technique côté BLG (crm_base_activity.id) ou côté compagnon (rdv_compagnon.id), selon `source`. */
  blgActivityId?: string | null;
  compagnonId?: string | null;
  /** Vrai si un compte-rendu (client_comptes_rendus) existe déjà pour ce RDV. */
  aCompteRendu?: boolean;
  lieu?: string | null;
  /** Secteur d'activité du client lié (même libellé que TRACKED_SECTORS côté carte Clients) — pour affichage/tooltip. */
  sectorLabel?: string | null;
};

const HOUR_START = 8;
const HOUR_END = 18;
const JOURS_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]; // index = Date.getDay()
const DEFAULT_COLOR = "#4B92AC";

const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: "RDV",
  phoneCall: "Appel",
  reminder: "Rappel",
  "4": "RDV",
  "7": "Appel",
  "9": "Rappel",
};
// Repli uniquement : utilisé quand aucun secteur n'est identifiable pour le
// client lié au RDV (voir TRACKED_SECTORS ci-dessous, désormais prioritaire).
const RDV_TYPE_COLORS: Record<string, string> = {
  meeting: "#2E5BB8",
  phoneCall: "#D68910",
  reminder: "#8E44AD",
  "4": "#2E5BB8",
  "7": "#D68910",
  "9": "#8E44AD",
};

// Mêmes secteurs suivis et mêmes couleurs que côté carte "Prospects &
// Clients" (app/clients/page.tsx, TRACKED_SECTORS) -- à garder synchronisés
// si la liste évolue là-bas.
type TrackedSectorDefinition = { prefixes: string[]; label: string; color: string };
const TRACKED_SECTORS: TrackedSectorDefinition[] = [
  { prefixes: ["43.21", "4321"], label: "Electricité ENR", color: "#a2cc88" },
  { prefixes: ["43.22A", "4322A"], label: "Plomberie", color: "#c3b691" },
  { prefixes: ["43.22B", "4322B"], label: "Installateur CVC", color: "#8ba9be" },
  { prefixes: ["41.20", "4120"], label: "CMI", color: "#e0a961" },
  { prefixes: ["28.25Z", "2825Z"], label: "Equipement Frigorifiques Indus.", color: "#00A3FF" },
  { prefixes: ["33.20B", "3320B"], label: "Installation de machines mécaniques", color: "#4b5563" },
  { prefixes: ["33.12Z", "3312Z"], label: "Réparation de machines", color: "#4b5563" },
  { prefixes: ["43.29A", "4329A"], label: "Travaux d'isolation", color: "#f9a8d4" },
  { prefixes: ["43.99", "4399"], label: "Bâtiment", color: "#8e9db3" },
];

function normalizeNafCode(value: string | null | undefined): string {
  return String(value || "").replace(/\s/g, "").toUpperCase();
}
function findTrackedSectorByCode(code: string | null | undefined) {
  const c = normalizeNafCode(code);
  if (!c) return null;
  return TRACKED_SECTORS.find((s) => s.prefixes.some((p) => c.startsWith(p))) || null;
}
function findTrackedSectorByLabel(label: string | null | undefined) {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return null;
  return TRACKED_SECTORS.find((s) => s.label.toLowerCase() === normalized) || null;
}
function resolveRdvSector(nafCode: string | null | undefined, nafLibelle: string | null | undefined): TrackedSectorDefinition | null {
  const byCode = findTrackedSectorByCode(nafCode);
  if (byCode) return byCode;
  return findTrackedSectorByLabel(nafLibelle);
}

function toIsoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function formatDateTimeFr(value: string | null | undefined, allDay?: boolean): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return allDay
    ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Une ligne de public.v_rdv_unifie -> un évènement de la grille. */
function mapUnifiedRdvToEvent(row: Record<string, any>): OutlookEvent {
  const type = String(row.type ?? "");
  const secteur = resolveRdvSector(row.naf_code, row.naf_libelle_traduit);
  const couleur = secteur?.color || RDV_TYPE_COLORS[type] || "#7A5EA8";
  return {
    id: row.rdv_id,
    subject: row.subject || RDV_TYPE_LABELS[type] || "Activité",
    start: String(row.start_date || ""),
    end: String(row.end_date || row.start_date || ""),
    isAllDay: Boolean(row.all_day),
    location: row.lieu || null,
    categories: type ? [type] : [],
    colorHex: couleur,
    webLink: null,
    source: row.source === "compagnon" ? "compagnon" : "blg",
    company: row.company_name || null,
    numeroTiers: row.numero_tiers || null,
    blgActivityId: row.blg_activity_id || null,
    compagnonId: row.compagnon_id || null,
    aCompteRendu: Boolean(row.a_compte_rendu),
    lieu: row.lieu || null,
    sectorLabel: secteur?.label || null,
  };
}

// ── Fenêtre de détail générique (RDV + compte-rendu) ─────────────────────

type CompteRendu = { id: string; resume: string | null; created_by_name: string | null; created_at: string };

function RdvDetailModal({
  evt, currentEmail, currentName, onClose, onChanged,
}: {
  evt: OutlookEvent
  currentEmail: string
  currentName: string
  onClose: () => void
  onChanged: () => void
}) {
  const [compteRendu, setCompteRendu] = useState<CompteRendu | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [resumeEdit, setResumeEdit] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingCr, setDeletingCr] = useState(false);
  const [deletingRdv, setDeletingRdv] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const activityId = evt.source === "compagnon" ? evt.compagnonId : evt.blgActivityId;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("client_comptes_rendus")
        .select("id, resume, created_by_name, created_at")
        .eq("rdv_activity_id", activityId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setCompteRendu((data as CompteRendu) || null);
      setResumeEdit((data as CompteRendu | null)?.resume || "");
      setLoading(false);
    }
    if (activityId) void load();
    else setLoading(false);
    return () => { cancelled = true; };
  }, [activityId]);

  async function enregistrer() {
    setSaving(true);
    setSaveError(null);
    try {
      if (compteRendu) {
        const { error } = await supabase.from("client_comptes_rendus").update({ resume: resumeEdit }).eq("id", compteRendu.id);
        if (error) throw error;
        setCompteRendu({ ...compteRendu, resume: resumeEdit });
      } else {
        const { data, error } = await supabase
          .from("client_comptes_rendus")
          .insert({
            numero_tiers: evt.numeroTiers,
            rdv_activity_id: activityId,
            rdv_label: evt.subject,
            created_by_email: currentEmail,
            created_by_name: currentName,
            resume: resumeEdit,
            transcript: null,
          })
          .select("id, resume, created_by_name, created_at")
          .single();
        if (error) throw error;
        setCompteRendu(data as CompteRendu);
      }
      setEditMode(false);
      onChanged();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  /** FIX (2026-08) : voir la note en tête de fichier -- `.select('id')`
   * ajouté après le `.delete()` pour vérifier ce qui a RÉELLEMENT été
   * supprimé. Sans ça, une policy RLS DELETE manquante ou trop stricte
   * fait "réussir" silencieusement un delete qui n'a rien supprimé (0
   * ligne, error === null), et l'UI se vidait à tort. */
  async function supprimerCompteRendu() {
    if (!compteRendu) return;
    if (!window.confirm("Supprimer ce compte-rendu ? Cette action est définitive.")) return;
    setDeletingCr(true);
    setDeleteError(null);
    try {
      const { data, error } = await supabase
        .from("client_comptes_rendus")
        .delete()
        .eq("id", compteRendu.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Suppression refusée par la base (droits insuffisants) — le compte-rendu n'a pas été supprimé.");
      }
      setCompteRendu(null);
      setResumeEdit("");
      onChanged();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingCr(false);
    }
  }

  /** FIX (2026-08) : même correctif que supprimerCompteRendu() ci-dessus --
   * `.select('id')` pour détecter un DELETE bloqué par RLS mais renvoyé
   * sans erreur. */
  async function supprimerRdv() {
    if (evt.source !== "compagnon" || !evt.compagnonId) return;
    if (!window.confirm(`Supprimer le rendez-vous "${evt.subject}" ? Cette action est définitive.`)) return;
    setDeletingRdv(true);
    setDeleteError(null);
    try {
      const { data, error } = await supabase
        .from("rdv_compagnon")
        .delete()
        .eq("id", evt.compagnonId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Suppression refusée par la base (droits insuffisants) — le rendez-vous n'a pas été supprimé.");
      }
      onChanged();
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeletingRdv(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/55 p-5 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <div className="truncate text-[20px] font-extrabold text-slate-900">{evt.subject}</div>
            <div className="mt-1 text-[13.5px] font-bold text-slate-500">
              {RDV_TYPE_LABELS[evt.categories[0]] || evt.categories[0] || "Activité"}
              {evt.sectorLabel ? ` · ${evt.sectorLabel}` : ""} · {evt.source === "compagnon" ? "RDV compagnon CEGECLIM" : "Synchronisé BLG"}
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-base text-slate-500 hover:bg-slate-200">✕</button>
        </div>

        <div className="px-6 pb-6 pt-4">
          {evt.company && (
            <div className="flex justify-between gap-3 border-b border-slate-50 py-2 text-[14.5px]">
              <span className="font-extrabold text-slate-500">Entreprise</span>
              <strong className="text-right font-bold text-slate-900">{evt.company}</strong>
            </div>
          )}
          <div className="flex justify-between gap-3 border-b border-slate-50 py-2 text-[14.5px]">
            <span className="font-extrabold text-slate-500">Début</span>
            <strong className="text-right font-bold text-slate-900">{formatDateTimeFr(evt.start, evt.isAllDay)}</strong>
          </div>
          <div className="flex justify-between gap-3 border-b border-slate-50 py-2 text-[14.5px]">
            <span className="font-extrabold text-slate-500">Fin</span>
            <strong className="text-right font-bold text-slate-900">{formatDateTimeFr(evt.end, evt.isAllDay)}</strong>
          </div>
          {evt.lieu && (
            <div className="flex justify-between gap-3 border-b border-slate-50 py-2 text-[14.5px]">
              <span className="font-extrabold text-slate-500">Lieu</span>
              <strong className="text-right font-bold text-slate-900">{evt.lieu}</strong>
            </div>
          )}

          <div className="mt-5 border-t border-dashed border-slate-200 pt-4">
            <div className="mb-3 flex items-center justify-between text-[13px] font-black uppercase tracking-wide text-slate-700">
              <span>Compte-rendu</span>
              {!editMode && (
                <span className="flex gap-2">
                  <button onClick={() => setEditMode(true)} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-[13px] font-extrabold normal-case text-indigo-700 hover:bg-indigo-100">
                    {compteRendu ? "✎ Modifier" : "+ Ajouter"}
                  </button>
                  {compteRendu && (
                    <button onClick={() => void supprimerCompteRendu()} disabled={deletingCr} className="rounded-lg bg-red-50 px-3 py-1.5 text-[13px] font-extrabold normal-case text-red-600 hover:bg-red-100 disabled:opacity-50">
                      {deletingCr ? "…" : "🗑 Supprimer"}
                    </button>
                  )}
                </span>
              )}
            </div>
            {loading ? (
              <p className="m-0 text-sm italic text-slate-400">Chargement…</p>
            ) : editMode ? (
              <div>
                <textarea
                  className="w-full rounded-xl border border-slate-300 p-3 text-[15px] font-inherit leading-relaxed outline-none focus:border-[#2E5BB8] focus:ring-2 focus:ring-[#2E5BB8]/15"
                  rows={8}
                  value={resumeEdit}
                  onChange={(e) => setResumeEdit(e.target.value)}
                  placeholder="Résumé du rendez-vous…"
                  autoFocus
                />
                {saveError && <p className="m-0 mt-2 text-[13px] font-bold text-red-600">{saveError}</p>}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => void enregistrer()} disabled={saving} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  <button onClick={() => { setEditMode(false); setResumeEdit(compteRendu?.resume || ""); }} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-500">
                    Annuler
                  </button>
                </div>
              </div>
            ) : compteRendu ? (
              <div>
                <p className="m-0 mb-2 whitespace-pre-wrap text-[16px] leading-relaxed text-slate-900">{compteRendu.resume || "(résumé vide)"}</p>
                <p className="m-0 text-[12.5px] text-slate-400">
                  {compteRendu.created_by_name ? `Par ${compteRendu.created_by_name} · ` : ""}{new Date(compteRendu.created_at).toLocaleString("fr-FR")}
                </p>
              </div>
            ) : (
              <p className="m-0 text-sm italic text-slate-400">Aucun compte-rendu pour ce rendez-vous.</p>
            )}
          </div>

          {deleteError && <p className="m-0 mt-4 text-[13px] font-bold text-red-600">{deleteError}</p>}

          {evt.source === "compagnon" && (
            <button
              onClick={() => void supprimerRdv()}
              disabled={deletingRdv}
              className="mt-5 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-extrabold text-red-600 hover:bg-red-100 disabled:opacity-50"
            >
              {deletingRdv ? "Suppression…" : "🗑 Supprimer ce rendez-vous"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Création d'un RDV "compagnon CEGECLIM" ────────────────────────────────

function NouveauRdvModal({
  currentEmail, currentName, initialDateTime, onClose, onCreated,
}: { currentEmail: string; currentName: string; initialDateTime?: Date | null; onClose: () => void; onCreated: () => void }) {
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState<Array<{ numero: string; intitule: string }>>([]);
  const [numeroTiers, setNumeroTiers] = useState<string | null>(null);
  const [intituleTiers, setIntituleTiers] = useState("");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState<"meeting" | "phoneCall" | "reminder">("meeting");
  const [date, setDate] = useState(() => (initialDateTime ? toIsoDate(initialDateTime) : ""));
  const [heure, setHeure] = useState(() => {
    if (!initialDateTime) return "09:00";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(initialDateTime.getHours())}:${pad(initialDateTime.getMinutes())}`;
  });
  const [duree, setDuree] = useState(60);
  const [lieu, setLieu] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = clientSearch.trim();
    if (q.length < 2 || numeroTiers) { setClientResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("ref_tiers").select("numero, intitule").or(`numero.ilike.%${q}%,intitule.ilike.%${q}%`).limit(8);
      setClientResults((data || []) as Array<{ numero: string; intitule: string }>);
    }, 220);
    return () => clearTimeout(t);
  }, [clientSearch, numeroTiers]);

  async function creer() {
    if (!subject.trim() || !date) { setError("Objet et date sont obligatoires."); return; }
    setSaving(true);
    setError(null);
    try {
      const start = new Date(`${date}T${heure}:00`);
      const end = new Date(start.getTime() + duree * 60000);
      const { error: err } = await supabase.from("rdv_compagnon").insert({
        numero_tiers: numeroTiers,
        type,
        subject: subject.trim(),
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        all_day: false,
        lieu: lieu.trim() || null,
        created_by_email: currentEmail,
        created_by_name: currentName,
      });
      if (err) throw err;
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/55 p-5 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-5">
          <div>
            <div className="text-[15.5px] font-extrabold text-slate-900">Nouveau rendez-vous</div>
            <div className="mt-0.5 text-[11.5px] font-bold text-slate-500">RDV compagnon CEGECLIM — indépendant de BLG/Outlook</div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-500 hover:bg-slate-200">✕</button>
        </div>

        <div className="px-5 pb-5 pt-3.5">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="relative flex flex-col gap-1.5">
              <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Client (facultatif)</span>
              <input
                className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8] focus:ring-2 focus:ring-[#2E5BB8]/15"
                value={numeroTiers ? `${intituleTiers} (${numeroTiers})` : clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setNumeroTiers(null); }}
                placeholder="Rechercher un client…"
              />
              {numeroTiers && (
                <button type="button" onClick={() => { setNumeroTiers(null); setClientSearch(""); }} className="self-start text-[10.5px] font-extrabold text-red-600">
                  ✕ Retirer
                </button>
              )}
              {clientResults.length > 0 && !numeroTiers && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                  {clientResults.map((c) => (
                    <button
                      key={c.numero}
                      type="button"
                      onClick={() => { setNumeroTiers(c.numero); setIntituleTiers(c.intitule); setClientResults([]); }}
                      className="flex w-full items-center gap-2 border-b border-slate-50 px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="font-mono font-extrabold text-slate-500">{c.numero}</span>
                      <span className="truncate text-slate-900">{c.intitule}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Objet</span>
              <input
                className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8] focus:ring-2 focus:ring-[#2E5BB8]/15"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex. : Visite chantier, appel de relance…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Type</span>
                <select
                  className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8]"
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                >
                  <option value="meeting">RDV</option>
                  <option value="phoneCall">Appel</option>
                  <option value="reminder">Rappel</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Durée (min)</span>
                <input
                  className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8]"
                  type="number"
                  value={duree}
                  onChange={(e) => setDuree(Number(e.target.value) || 60)}
                  min={15}
                  step={15}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Date</span>
                <input
                  className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8]"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Heure</span>
                <input
                  className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8]"
                  type="time"
                  value={heure}
                  onChange={(e) => setHeure(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Lieu (facultatif)</span>
              <input
                className="h-[38px] rounded-xl border border-slate-300 bg-white px-2.5 text-[13px] font-semibold text-slate-900 outline-none focus:border-[#2E5BB8] focus:ring-2 focus:ring-[#2E5BB8]/15"
                value={lieu}
                onChange={(e) => setLieu(e.target.value)}
                placeholder="Ex. : Chez le client, agence…"
              />
            </div>
          </div>

          {error && <p className="m-0 mt-2.5 text-[11.5px] font-bold text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => void creer()} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">
              {saving ? "Création…" : "Créer le RDV"}
            </button>
            <button onClick={onClose} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-extrabold text-slate-500">
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OutlookAgenda({
  onActivityClick,
}: {
  /** Appelé au clic sur un évènement, EN PLUS de l'ouverture de la fenêtre de détail intégrée -- optionnel, pour un usage externe éventuel. */
  onActivityClick?: (evt: OutlookEvent) => void;
}) {
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [rdvEvents, setRdvEvents] = useState<OutlookEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [openEvent, setOpenEvent] = useState<OutlookEvent | null>(null);
  const [nouveauRdvOuvert, setNouveauRdvOuvert] = useState(false);
  const [nouveauRdvPrefill, setNouveauRdvPrefill] = useState<Date | null>(null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentName, setCurrentName] = useState("");

  useEffect(() => {
    async function loadIdentity() {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email?.toLowerCase();
      if (!email) return;
      const { data: access } = await supabase.from("user_page_access").select("display_name").eq("email", email).maybeSingle();
      setCurrentEmail(email);
      setCurrentName(String(access?.display_name || "").trim() || email.split("@")[0]);
    }
    void loadIdentity();
  }, []);

  const jours = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(anchorDate, i);
      return { label: JOURS_LABELS[date.getDay()], date };
    }).filter((j) => j.date.getDay() !== 0 && j.date.getDay() !== 6);
  }, [anchorDate]);

  const rangeLabel = useMemo(() => {
    if (jours.length === 0) return "";
    const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    return `${fmt(jours[0].date)} → ${fmt(jours[jours.length - 1].date)}`;
  }, [jours]);

  async function loadRdvEvents() {
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) { setRdvEvents([]); return; }

    const { data: access } = await supabase.from("user_page_access").select("blg_partner_id").eq("email", email).maybeSingle();

    const start = toIsoDate(anchorDate);
    const end = toIsoDate(addDays(anchorDate, 7));

    const orParts: string[] = [`created_by_email.eq.${email}`];
    if (access?.blg_partner_id) orParts.push(`blg_partner_id.eq.${access.blg_partner_id}`);

    const { data, error: err } = await supabase
      .from("v_rdv_unifie")
      .select("*")
      .gte("start_date", start)
      .lt("start_date", end)
      .or(orParts.join(","));

    if (err) {
      console.error("[OutlookAgenda] v_rdv_unifie", err);
      setError(err.message);
      setRdvEvents([]);
      return;
    }
    setError(null);
    setRdvEvents(((data || []) as Record<string, any>[]).map(mapUnifiedRdvToEvent));
  }

  useEffect(() => {
    void loadRdvEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorDate]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, OutlookEvent[]>();
    rdvEvents.forEach((e) => {
      const parsed = new Date(e.start);
      const key = Number.isNaN(parsed.getTime()) ? e.start.slice(0, 10) : toIsoDate(parsed);
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    });
    return map;
  }, [rdvEvents]);

  function eventStyle(evt: OutlookEvent) {
    const start = new Date(evt.start);
    const end = new Date(evt.end);
    const startH = Math.max(HOUR_START, start.getHours() + start.getMinutes() / 60);
    const endH = Math.min(HOUR_END, Math.max(startH + 0.25, end.getHours() + end.getMinutes() / 60));
    const totalH = HOUR_END - HOUR_START;
    const top = ((startH - HOUR_START) / totalH) * 100;
    const height = Math.max(3, ((endH - startH) / totalH) * 100);
    return {
      top: `${top}%`,
      height: `${height}%`,
      // FIX (2026-08) : hauteur minimale en pixels en plus du pourcentage --
      // un RDV court (30 min) ne s'écrase plus au point de rendre le texte
      // illisible ; il déborde légèrement sur le créneau suivant plutôt que
      // de se compresser, ce qui reste préférable pour la lisibilité.
      minHeight: "30px",
      background: evt.colorHex || DEFAULT_COLOR,
    };
  }

  function handleEventClick(e: OutlookEvent) {
    onActivityClick?.(e);
    setOpenEvent(e);
  }

  function handleDayDoubleClick(date: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const totalH = HOUR_END - HOUR_START;
    const hourFloat = HOUR_START + ratio * totalH;
    const hour = Math.min(HOUR_END - 1, Math.floor(hourFloat));
    const minute = Math.round(((hourFloat - hour) * 60) / 15) * 15;
    const prefill = new Date(date);
    prefill.setHours(hour, minute % 60, 0, 0);
    setNouveauRdvPrefill(prefill);
    setNouveauRdvOuvert(true);
  }

  const aujourdHuiIso = toIsoDate(new Date());

  const secteursVisibles = useMemo(() => {
    const labels = new Set<string>();
    rdvEvents.forEach((e) => { if (e.sectorLabel) labels.add(e.sectorLabel); });
    return TRACKED_SECTORS.filter((s) => labels.has(s.label));
  }, [rdvEvents]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-black/10 bg-[#F5F3EC] p-3 text-[#141A26]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-[var(--font-display,inherit)] text-base font-bold">Agenda</h3>
        {rdvEvents.length > 0 && (
          <span className="rounded-full bg-[#7A5EA8]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7A5EA8]">
            + {rdvEvents.length} RDV
          </span>
        )}

        <button
          onClick={() => { setNouveauRdvPrefill(null); setNouveauRdvOuvert(true); }}
          className="rounded-lg bg-[#2E5BB8] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#244a96]"
        >
          + Nouveau RDV
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setAnchorDate((d) => addDays(d, -7))}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/[0.06] text-sm hover:bg-black/[0.12]"
            title="7 jours précédents"
          >
            −
          </button>
          <span className="min-w-[110px] text-center text-[11px] text-[#141A26]/75">{rangeLabel}</span>
          <button
            onClick={() => setAnchorDate((d) => addDays(d, 7))}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/[0.06] text-sm hover:bg-black/[0.12]"
            title="7 jours suivants"
          >
            +
          </button>
          <button
            onClick={() => setAnchorDate(startOfDay(new Date()))}
            className="ml-1 rounded-full bg-black/[0.06] px-2 py-1 text-[10px] hover:bg-black/[0.12]"
            title="Revenir à aujourd'hui"
          >
            Auj.
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-2 rounded-lg bg-black/20 px-3 py-1.5 text-xs text-red-100">{error}</div>
      )}

      <div className="flex flex-1 flex-col overflow-auto">
        <div className="rounded-xl bg-black/[0.05] p-2.5">
          <div className="grid grid-cols-[34px_repeat(5,1fr)] gap-1 text-xs font-medium text-[#141A26]/70">
            <div />
            {jours.map((j) => {
              const iso = toIsoDate(j.date);
              const estAujourdHui = iso === aujourdHuiIso;
              return (
                <div key={iso} className={`text-center ${estAujourdHui ? "font-bold text-[#2E5BB8]" : ""}`}>
                  {j.label} {j.date.getDate()}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[34px_repeat(5,1fr)] gap-1" style={{ height: 480 }}>
            <div className="flex flex-col justify-between py-0.5 text-right text-[10px] text-[#141A26]/45">
              {Array.from({ length: HOUR_END - HOUR_START + 1 }).map((_, i) => (
                <div key={i}>{HOUR_START + i}h</div>
              ))}
            </div>
            <div className="relative col-span-5 grid grid-cols-5 gap-1">
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-0.5">
                {Array.from({ length: HOUR_END - HOUR_START + 1 }).map((_, i) => (
                  <div key={i} className="border-t border-black/10" />
                ))}
              </div>
              {jours.map((j) => {
                const iso = toIsoDate(j.date);
                const dayEvents = eventsByDay.get(iso) || [];
                return (
                  <div
                    key={iso}
                    className="relative border-l border-black/5 first:border-l-0 cursor-pointer"
                    onDoubleClick={(e) => handleDayDoubleClick(j.date, e)}
                    title="Double-clic pour créer un RDV à cette heure"
                  >
                    {dayEvents.filter((e) => !e.isAllDay).map((e) => (
                      <button
                        key={e.id}
                        onClick={() => handleEventClick(e)}
                        title={`${e.company ? e.company + " — " : ""}${e.subject}${e.sectorLabel ? " · " + e.sectorLabel : ""}${e.location ? " · " + e.location : ""}`}
                        style={eventStyle(e)}
                        className="absolute left-0.5 right-0.5 z-10 overflow-hidden rounded-md px-2 py-1 text-left leading-snug text-white shadow hover:z-20 hover:brightness-110"
                      >
                        {e.aCompteRendu && <span className="mr-1 text-[10px] leading-none drop-shadow" title="Compte-rendu disponible">📝</span>}
                        {e.company && (
                          <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#FFC98B]">
                            {e.company}
                          </div>
                        )}
                        <div className="truncate text-[12.5px] font-semibold">{e.subject}</div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {jours.some((j) => (eventsByDay.get(toIsoDate(j.date)) || []).some((e) => e.isAllDay)) && (
            <div className="mt-1 grid grid-cols-[34px_repeat(5,1fr)] gap-1">
              <div />
              {jours.map((j) => {
                const iso = toIsoDate(j.date);
                const allDay = (eventsByDay.get(iso) || []).filter((e) => e.isAllDay);
                return (
                  <div key={iso} className="space-y-0.5">
                    {allDay.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => handleEventClick(e)}
                        title={`${e.company ? e.company + " — " : ""}${e.subject}${e.sectorLabel ? " · " + e.sectorLabel : ""}`}
                        style={{ background: e.colorHex || DEFAULT_COLOR }}
                        className="w-full truncate rounded px-1.5 py-1 text-left text-[10px] text-white"
                      >
                        {e.aCompteRendu && <span className="mr-0.5 text-[9px] leading-none drop-shadow" title="Compte-rendu disponible">📝</span>}
                        {e.company && (
                          <span className="mr-1 font-semibold uppercase tracking-wide text-[#FFC98B]">
                            {e.company} ·
                          </span>
                        )}
                        {e.subject}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {secteursVisibles.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-black/10 pt-2">
              {secteursVisibles.map((s) => (
                <span key={s.label} className="flex items-center gap-1.5 text-[10.5px] font-semibold text-[#141A26]/70">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
              <span className="text-[10.5px] text-[#141A26]/40">Couleur = secteur d&rsquo;activité du client</span>
            </div>
          )}
        </div>
      </div>

      {openEvent && (
        <RdvDetailModal
          evt={openEvent}
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setOpenEvent(null)}
          onChanged={() => void loadRdvEvents()}
        />
      )}
      {nouveauRdvOuvert && (
        <NouveauRdvModal
          currentEmail={currentEmail}
          currentName={currentName}
          initialDateTime={nouveauRdvPrefill}
          onClose={() => { setNouveauRdvOuvert(false); setNouveauRdvPrefill(null); }}
          onCreated={() => void loadRdvEvents()}
        />
      )}
    </div>
  );
}
