"use client";

/**
 * OutlookAgenda
 * ------------------------------------------------------------------------
 * Bloc "AGENDA" du mockup "Vision One page TCI" :
 *  - fenêtre glissante des 7 PROCHAINS JOURS (pas une semaine calendaire
 *    lundi→vendredi), affichage restreint aux JOURS OUVRÉS (lundi→vendredi
 *    uniquement -- les week-ends de la fenêtre de 7 jours ne sont pas
 *    affichés, mais la fenêtre elle-même glisse toujours de 7 jours en 7
 *    jours pour rester alignée sur le même jour de la semaine)
 *  - navigation +/- pour glisser la fenêtre de 7 jours en 7 jours
 *  - vision horaire 8h→18h
 *  - clic sur un évènement -> fenêtre de détail intégrée (RDV + compte-rendu,
 *    consultable ET modifiable à la main) -- callback onActivityClick
 *    toujours disponible en plus, pour un usage externe éventuel.
 *
 * Les activités affichées viennent de v_rdv_unifie (BLG + RDV "compagnon
 * CEGECLIM" créés depuis l'app avant toute connexion BLG/Outlook).
 * Résolution du nom d'entreprise ET du numéro tiers déjà faite côté vue.
 *
 * Couleur des RDV basée sur le SECTEUR D'ACTIVITÉ du client lié (même
 * palette TRACKED_SECTORS que la carte "Prospects & Clients" --
 * Installateur CVC, Plomberie, Electricité ENR...), résolu côté vue via
 * numero_tiers -> ref_tiers.siret -> clients (naf_code, naf_libelle_traduit).
 * Repli sur la couleur par type de RDV (RDV_TYPE_COLORS) quand aucun
 * secteur n'est identifiable (client sans NAF connu, ou RDV sans client lié).
 *
 * RETRAIT (cette révision) : synchronisation Outlook/ICS native (sélection
 * d'un agenda de collaborateur, panneau d'administration des autorisations,
 * connexion Microsoft OAuth) et mode "données fictives" -- plus d'actualité,
 * l'agenda repose désormais uniquement sur v_rdv_unifie (RDV BLG + RDV
 * compagnon créés dans l'app).
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
// si la liste évolue là-bas. Dupliqué ici plutôt qu'importé : ce composant
// n'a pas de dépendance vers app/clients/page.tsx, et cette liste change
// rarement.
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
/** Même logique que getClientSectorLabel() côté écran Clients desktop :
 * priorité au code NAF (le plus fiable), repli sur le libellé déjà stocké
 * s'il correspond à un secteur suivi, sinon "AUTRES" (pas de couleur
 * dédiée -- le RDV retombe alors sur RDV_TYPE_COLORS). */
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
  // Secteur du client lié en priorité (même palette que la carte Clients) ;
  // repli sur la couleur par type de RDV si aucun secteur identifiable
  // (client sans NAF connu, ou RDV sans client lié du tout).
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

  return (
    <div className="oaModalOverlay" onClick={onClose}>
      <div className="oaModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="oaModalHeader">
          <div>
            <div className="oaModalTitle">{evt.subject}</div>
            <div className="oaModalSubtitle">
              {RDV_TYPE_LABELS[evt.categories[0]] || evt.categories[0] || "Activité"}
              {evt.sectorLabel ? ` · ${evt.sectorLabel}` : ""} · {evt.source === "compagnon" ? "RDV compagnon CEGECLIM" : "Synchronisé BLG"}
            </div>
          </div>
          <button className="oaModalClose" onClick={onClose}>✕</button>
        </div>
        <div className="oaModalBody">
          {evt.company && <div className="oaFieldRow"><span>Entreprise</span><strong>{evt.company}</strong></div>}
          <div className="oaFieldRow"><span>Début</span><strong>{formatDateTimeFr(evt.start, evt.isAllDay)}</strong></div>
          <div className="oaFieldRow"><span>Fin</span><strong>{formatDateTimeFr(evt.end, evt.isAllDay)}</strong></div>
          {evt.lieu && <div className="oaFieldRow"><span>Lieu</span><strong>{evt.lieu}</strong></div>}

          <div className="oaCrBlock">
            <div className="oaCrHeader">
              <span>Compte-rendu</span>
              {!editMode && (
                <button className="oaCrEditBtn" onClick={() => setEditMode(true)}>{compteRendu ? "✎ Modifier" : "+ Ajouter"}</button>
              )}
            </div>
            {loading ? (
              <p className="oaMuted">Chargement…</p>
            ) : editMode ? (
              <div>
                <textarea className="oaTextarea" rows={6} value={resumeEdit} onChange={(e) => setResumeEdit(e.target.value)} placeholder="Résumé du rendez-vous…" autoFocus />
                {saveError && <p className="oaError">{saveError}</p>}
                <div className="oaActions">
                  <button className="oaSaveBtn" onClick={() => void enregistrer()} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
                  <button className="oaCancelBtn" onClick={() => { setEditMode(false); setResumeEdit(compteRendu?.resume || ""); }} disabled={saving}>Annuler</button>
                </div>
              </div>
            ) : compteRendu ? (
              <div>
                <p className="oaCrResume">{compteRendu.resume || "(résumé vide)"}</p>
                <p className="oaCrMeta">{compteRendu.created_by_name ? `Par ${compteRendu.created_by_name} · ` : ""}{new Date(compteRendu.created_at).toLocaleString("fr-FR")}</p>
              </div>
            ) : (
              <p className="oaMuted">Aucun compte-rendu pour ce rendez-vous.</p>
            )}
          </div>
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
  // Créneau par défaut : 60 minutes, y compris quand la date/heure vient
  // d'un double-clic sur une case du calendrier.
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
    <div className="oaModalOverlay" onClick={onClose}>
      <div className="oaModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="oaModalHeader">
          <div>
            <div className="oaModalTitle">Nouveau rendez-vous</div>
            <div className="oaModalSubtitle">RDV compagnon CEGECLIM — indépendant de BLG/Outlook</div>
          </div>
          <button className="oaModalClose" onClick={onClose}>✕</button>
        </div>
        <div className="oaModalBody">
          <div className="oaFieldsetBox">
            <div className="oaFormField oaClientSearchWrap">
              <span className="oaFieldLabel">Client (facultatif)</span>
              <input
                className="oaFieldInput"
                value={numeroTiers ? `${intituleTiers} (${numeroTiers})` : clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setNumeroTiers(null); }}
                placeholder="Rechercher un client…"
              />
              {numeroTiers && (
                <button type="button" className="oaClearClient" onClick={() => { setNumeroTiers(null); setClientSearch(""); }}>✕ Retirer</button>
              )}
              {clientResults.length > 0 && !numeroTiers && (
                <div className="oaClientResults">
                  {clientResults.map((c) => (
                    <button key={c.numero} type="button" onClick={() => { setNumeroTiers(c.numero); setIntituleTiers(c.intitule); setClientResults([]); }}>
                      <span className="mono">{c.numero}</span><span>{c.intitule}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="oaFormField">
              <span className="oaFieldLabel">Objet</span>
              <input className="oaFieldInput" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. : Visite chantier, appel de relance…" />
            </div>

            <div className="oaFormGrid">
              <div className="oaFormField">
                <span className="oaFieldLabel">Type</span>
                <select className="oaFieldInput" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  <option value="meeting">RDV</option>
                  <option value="phoneCall">Appel</option>
                  <option value="reminder">Rappel</option>
                </select>
              </div>
              <div className="oaFormField">
                <span className="oaFieldLabel">Durée (min)</span>
                <input className="oaFieldInput" type="number" value={duree} onChange={(e) => setDuree(Number(e.target.value) || 60)} min={15} step={15} />
              </div>
              <div className="oaFormField">
                <span className="oaFieldLabel">Date</span>
                <input className="oaFieldInput" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="oaFormField">
                <span className="oaFieldLabel">Heure</span>
                <input className="oaFieldInput" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
              </div>
            </div>

            <div className="oaFormField">
              <span className="oaFieldLabel">Lieu (facultatif)</span>
              <input className="oaFieldInput" value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Ex. : Chez le client, agence…" />
            </div>
          </div>

          {error && <p className="oaError">{error}</p>}
          <div className="oaActions">
            <button className="oaSaveBtn" onClick={() => void creer()} disabled={saving}>{saving ? "Création…" : "Créer le RDV"}</button>
            <button className="oaCancelBtn" onClick={onClose} disabled={saving}>Annuler</button>
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
  // Ancre de la fenêtre glissante de 7 jours -- PAR DÉFAUT AUJOURD'HUI, pas
  // le lundi de la semaine courante. "Auj." et le montage initial repartent
  // toujours d'aujourd'hui ; +/- glisse la fenêtre de 7 jours à la fois.
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [rdvEvents, setRdvEvents] = useState<OutlookEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Détail RDV (clic sur un évènement) + création d'un nouveau RDV compagnon.
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

  // Fenêtre glissante de 7 jours à partir de anchorDate (aujourd'hui par
  // défaut), puis filtrage aux jours OUVRÉS uniquement (lundi -> vendredi).
  // La fenêtre glisse toujours de 7 jours en 7 jours (+/-), donc contient
  // toujours exactement 5 jours ouvrés une fois les week-ends retirés --
  // pas besoin de compenser en élargissant la fenêtre.
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

  // ── RDV fusionnés (v_rdv_unifie = BLG + compagnon CEGECLIM) ─────────────
  // Filtrés sur : mes RDV BLG (from_fk = mon partner id) OU mes RDV
  // compagnon (created_by_email = mon email) -- même périmètre "mes RDV"
  // qu'avant, étendu aux RDV créés depuis l'app avant toute connexion BLG.
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
      // Regroupement par jour LOCAL réel (Europe/Paris, fuseau du navigateur
      // des utilisateurs) — et non par simple découpage de la chaîne ISO,
      // qui donnait le jour en UTC et faisait glisser les évènements de fin
      // de journée (ex. 22h UTC = minuit local) sur la mauvaise date.
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
      background: evt.colorHex || DEFAULT_COLOR,
    };
  }

  function handleEventClick(e: OutlookEvent) {
    onActivityClick?.(e);
    setOpenEvent(e);
  }

  /** Double-clic sur une case du calendrier -> ouvre la création de RDV,
   * pré-remplie avec le jour cliqué et l'heure déduite de la position
   * verticale du clic dans la colonne (arrondie au quart d'heure le plus
   * proche), créneau de 60 min par défaut. */
  function handleDayDoubleClick(date: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return // double-clic sur un évènement existant, pas sur la case vide
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

  // Légende des secteurs -- affichée sous la grille, uniquement les
  // secteurs effectivement présents dans la fenêtre affichée (pas la liste
  // complète des 9 secteurs suivis à chaque fois).
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
                <div
                  key={iso}
                  className={`text-center ${estAujourdHui ? "font-bold text-[#2E5BB8]" : ""}`}
                >
                  {j.label} {j.date.getDate()}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[34px_repeat(5,1fr)] gap-1" style={{ height: 420 }}>
            {/* Colonne des heures — séparée de la grille des jours, ne peut
                donc plus jamais être masquée par un rendez-vous. */}
            <div className="flex flex-col justify-between py-0.5 text-right text-[10px] text-[#141A26]/45">
              {Array.from({ length: HOUR_END - HOUR_START + 1 }).map((_, i) => (
                <div key={i}>{HOUR_START + i}h</div>
              ))}
            </div>
            <div className="relative col-span-5 grid grid-cols-5 gap-1">
              {/* Repères horaires en fond, alignés sur la colonne des heures */}
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
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[10px] leading-tight text-white shadow hover:brightness-110"
                      >
                        {e.aCompteRendu && <span className="oaCrIcon" title="Compte-rendu disponible">📝</span>}
                        {e.company && (
                          <div className="truncate text-[8.5px] font-semibold uppercase tracking-wide text-[#FFC98B]">
                            {e.company}
                          </div>
                        )}
                        <div className="truncate font-medium">{e.subject}</div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Évènements journée entière, listés sous la grille horaire */}
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
                        {e.aCompteRendu && <span className="oaCrIcon" title="Compte-rendu disponible">📝</span>}
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

          {/* Légende des secteurs -- uniquement ceux présents dans la
             fenêtre affichée, pas la liste complète (souvent redondante). */}
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

      <style jsx>{`
        .oaCrIcon { display: inline-block; margin-right: 3px; font-size: 9px; line-height: 1; filter: drop-shadow(0 0 1px rgba(0,0,0,.6)); }

        .oaModalOverlay { position: fixed; inset: 0; z-index: 200; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .oaModalCard { background: white; border-radius: 16px; width: 100%; max-width: 460px; max-height: 85vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(15,23,42,.3); color: #0f172a; }
        .oaModalHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 10px; border-bottom: 1px solid #f1f5f9; }
        .oaModalTitle { font-size: 15.5px; font-weight: 900; }
        .oaModalSubtitle { font-size: 11.5px; font-weight: 700; color: #64748b; margin-top: 2px; }
        .oaModalClose { border: none; background: #f1f5f9; color: #64748b; width: 26px; height: 26px; border-radius: 999px; font-size: 13px; cursor: pointer; flex-shrink: 0; }
        .oaModalBody { padding: 14px 18px 18px; }
        .oaFieldRow { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f8fafc; font-size: 12.5px; }
        .oaFieldRow span { color: #64748b; font-weight: 800; }
        .oaFieldRow strong { color: #0f172a; font-weight: 700; text-align: right; }

        .oaCrBlock { margin-top: 14px; padding-top: 12px; border-top: 1px dashed #e2e8f0; }
        .oaCrHeader { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 11.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; color: #334155; }
        .oaCrEditBtn { border: none; background: #eef2ff; color: #3730a3; font-size: 11px; font-weight: 800; padding: 4px 9px; border-radius: 8px; cursor: pointer; text-transform: none; }
        .oaMuted { font-size: 12px; color: #94a3b8; font-style: italic; margin: 0; }
        .oaCrResume { font-size: 13px; color: #0f172a; line-height: 1.6; white-space: pre-wrap; margin: 0 0 6px; }
        .oaCrMeta { font-size: 10.5px; color: #94a3b8; margin: 0; }
        .oaTextarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px; font-size: 12.5px; font-family: inherit; resize: vertical; outline: none; color: #0f172a; }
        .oaTextarea:focus { border-color: #2E5BB8; }
        .oaError { color: #dc2626; font-size: 11.5px; font-weight: 700; margin: 6px 0 0; }
        .oaActions { display: flex; gap: 8px; margin-top: 10px; }
        .oaSaveBtn { border: none; background: #0f172a; color: white; font-size: 12px; font-weight: 800; padding: 8px 15px; border-radius: 9px; cursor: pointer; }
        .oaSaveBtn:disabled { opacity: .5; cursor: not-allowed; }
        .oaCancelBtn { border: 1px solid #e2e8f0; background: white; color: #64748b; font-size: 12px; font-weight: 800; padding: 8px 15px; border-radius: 9px; cursor: pointer; }

        .oaFieldsetBox { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 12px; padding: 14px 14px 4px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 4px; }
        .oaFormGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .oaFormField { display: flex; flex-direction: column; gap: 5px; }
        .oaFieldLabel { font-size: 10.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
        .oaFieldInput { height: 38px; border: 1px solid #cbd5e1; background: white; border-radius: 9px; padding: 0 10px; font-size: 13px; font-weight: 600; color: #0f172a; outline: none; font-family: inherit; }
        .oaFieldInput:focus { border-color: #2E5BB8; box-shadow: 0 0 0 3px rgba(46,91,184,.12); }
        .oaClientSearchWrap { position: relative; }
        .oaClearClient { align-self: flex-start; border: none; background: none; color: #dc2626; font-size: 10.5px; font-weight: 800; cursor: pointer; padding: 2px 0; text-transform: none; }
        .oaClientResults { position: absolute; top: 100%; left: 0; right: 0; z-index: 10; background: white; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 24px rgba(15,23,42,.15); max-height: 220px; overflow-y: auto; }
        .oaClientResults button { display: flex; gap: 8px; width: 100%; text-align: left; padding: 7px 10px; border: none; background: white; font-size: 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; text-transform: none; }
        .oaClientResults button:hover { background: #f8fafc; }
        .oaClientResults .mono { font-family: monospace; font-weight: 800; color: #64748b; }
      `}</style>
    </div>
  );
}
