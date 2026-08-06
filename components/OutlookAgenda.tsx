"use client";

/**
 * OutlookAgenda
 * ------------------------------------------------------------------------
 * Bloc "AGENDA" du mockup "Vision One page TCI" :
 *  - 10 jours (2 semaines glissantes et superposées, lundi→vendredi),
 *    empilées en pleine largeur — plus de place pour lire les rendez-vous
 *  - navigation +/- pour glisser d'une semaine
 *  - vision horaire 8h→18h
 *  - couleurs Outlook (catégories, résolues côté serveur)
 *  - clic sur un évènement → callback onActivityClick (à brancher sur le
 *    mur d'activité BLG — je n'ai pas cette route, donc callback ouvert)
 *
 * Contient aussi un petit panneau d'administration (icône ⚙) pour gérer
 * outlook_calendar_autorisations : qui peut voir quel agenda, visible
 * uniquement si l'utilisateur a le droit can_autorisation (la policy RLS
 * de la table refuse de toute façon l'écriture côté serveur si absent —
 * ce composant se contente de ne pas proposer l'action si ce n'est pas
 * la peine, l'écriture reste protégée indépendamment de l'UI).
 * ------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Autorisation = {
  id: string;
  collaborateur: string;
  email_outlook: string;
  actif: boolean;
  couleur_defaut: string | null;
};

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
};

const HOUR_START = 8;
const HOUR_END = 18;
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const DEFAULT_COLOR = "#4B92AC";

function toIsoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayOf(d: Date) {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export default function OutlookAgenda({
  onActivityClick,
}: {
  /** Appelé au clic sur un évènement — à brancher sur le mur d'activité BLG. */
  onActivityClick?: (evt: OutlookEvent) => void;
}) {
  const [autorisations, setAutorisations] = useState<Autorisation[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string>("");
  const [anchorMonday, setAnchorMonday] = useState<Date>(() => mondayOf(new Date()));
  const [events, setEvents] = useState<OutlookEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [formCollaborateur, setFormCollaborateur] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formIcsUrl, setFormIcsUrl] = useState("");
  // Formulaire dédié à la connexion réelle (OAuth) — nécessaire pour tout
  // compte hors tenant Cegeclim (personnel, ou organisationnel sans
  // consentement app-only) : l'utilisateur doit se connecter une fois via
  // l'écran de login Microsoft.
  const [connectCollaborateur, setConnectCollaborateur] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Sélecteur (visible par tout utilisateur connecté) : vue restreinte,
  // sans le lien ICS ni l'email complet des détails sensibles — juste de
  // quoi peupler la liste déroulante.
  const loadAutorisations = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("v_outlook_calendar_autorisations_publique")
      .select("id, collaborateur, email_outlook, actif")
      .order("collaborateur");
    if (err) {
      setError(err.message);
      return;
    }
    const rows = (data || []) as Autorisation[];
    setAutorisations((prev) => {
      // On conserve couleur_defaut déjà connue si présente (chargée via le
      // panneau admin), sinon null.
      const couleurs = new Map(prev.map((p) => [p.id, p.couleur_defaut]));
      return rows.map((r) => ({ ...r, couleur_defaut: couleurs.get(r.id) ?? null }));
    });
    if (!selectedEmail) {
      const premierActif = rows.find((r) => r.actif);
      if (premierActif) setSelectedEmail(premierActif.email_outlook);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Panneau admin (⚙) : table complète, réservée à can_autorisation côté
  // RLS. Un utilisateur sans ce droit obtient simplement une liste vide ou
  // une erreur de permission ici — sans jamais voir les liens ICS/emails
  // complets des autres.
  const loadAdminAutorisations = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("outlook_calendar_autorisations")
      .select("id, collaborateur, email_outlook, actif, couleur_defaut")
      .order("collaborateur");
    if (err) {
      setError(`Droits insuffisants pour administrer les agendas : ${err.message}`);
      return;
    }
    setAutorisations((data || []) as Autorisation[]);
  }, []);

  useEffect(() => {
    void loadAutorisations();
  }, [loadAutorisations]);

  useEffect(() => {
    if (adminOpen) void loadAdminAutorisations();
  }, [adminOpen, loadAdminAutorisations]);

  // Retour du callback OAuth (?outlook_connected=email ou ?outlook_error=...
  // ajoutés par app/api/outlook/oauth/callback à la redirection). On les lit
  // une fois au montage, on affiche un message, puis on nettoie l'URL pour
  // ne pas répéter le message si l'utilisateur recharge la page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("outlook_connected");
    const err = params.get("outlook_error");
    if (connected) {
      setNotice({ type: "success", message: `Agenda de ${connected} connecté avec succès.` });
      setAdminOpen(true);
      void loadAdminAutorisations();
    } else if (err) {
      setNotice({ type: "error", message: `Connexion Microsoft impossible : ${err}` });
      setAdminOpen(true);
    }
    if (connected || err) {
      params.delete("outlook_connected");
      params.delete("outlook_error");
      const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", cleanUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnectMicrosoft() {
    if (!connectCollaborateur.trim()) return;
    setConnecting(true);
    setNotice(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch("/api/outlook/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ collaborateur: connectCollaborateur.trim() }),
      });
      const payload = (await res.json()) as { success: boolean; message?: string; url?: string };
      if (!res.ok || !payload.success || !payload.url) throw new Error(payload?.message || "Erreur inconnue");
      window.location.assign(payload.url);
    } catch (e) {
      setNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      setConnecting(false);
    }
  }

  // 2 semaines glissantes et superposées à partir de anchorMonday — pas 3
  // côte à côte : moins de colonnes en largeur = chaque jour est bien plus
  // large, donc plus lisible pour y positionner des rendez-vous. Naviguer
  // d'une semaine (+/-) fait glisser la fenêtre d'un cran, avec toujours une
  // semaine commune entre deux vues consécutives ("glissantes superposées").
  const semaines = useMemo(() => {
    return [0, 1].map((w) => {
      const debut = addDays(anchorMonday, w * 7);
      return {
        debut,
        jours: JOURS.map((label, i) => ({ label, date: addDays(debut, i) })),
      };
    });
  }, [anchorMonday]);

  const rangeLabel = useMemo(() => {
    const fin = addDays(anchorMonday, 11); // vendredi de la 2e semaine
    const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    return `${fmt(anchorMonday)} → ${fmt(fin)}`;
  }, [anchorMonday]);

  // Mode "données fictives" — persisté en base par utilisateur
  // (vision_tci_preferences.mock_agenda), plus besoin de ?mock=1 à chaque
  // visite. ?mock=1 / ?mock=0 dans l'URL reste utilisable comme bascule
  // rapide et met aussi à jour la préférence enregistrée.
  const [useMockData, setUseMockData] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function loadMockPref() {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email?.toLowerCase();
      if (!email) return;

      const params = new URLSearchParams(window.location.search);
      const overrideParam = params.get("mock");

      if (overrideParam === "1" || overrideParam === "0") {
        const value = overrideParam === "1";
        if (!cancelled) setUseMockData(value);
        await supabase.from("vision_tci_preferences").upsert({
          user_email: email,
          mock_agenda: value,
          updated_at: new Date().toISOString(),
        });
        // Nettoie l'URL pour ne pas avoir à s'en souvenir la prochaine fois.
        params.delete("mock");
        window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
        return;
      }

      const { data } = await supabase.from("vision_tci_preferences").select("mock_agenda").eq("user_email", email).maybeSingle();
      if (!cancelled) setUseMockData(Boolean(data?.mock_agenda));
    }
    loadMockPref();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleMockData() {
    const next = !useMockData;
    setUseMockData(next);
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) return;
    await supabase.from("vision_tci_preferences").upsert({
      user_email: email,
      mock_agenda: next,
      updated_at: new Date().toISOString(),
    });
  }

  function buildMockEvents(weekStart: Date): OutlookEvent[] {
    const mk = (dayOffset: number, hStart: number, hEnd: number, subject: string, colorHex: string, allDay = false): OutlookEvent => {
      const d = addDays(weekStart, dayOffset);
      const start = new Date(d); start.setHours(hStart, 0, 0, 0);
      const end = new Date(d); end.setHours(hEnd, 0, 0, 0);
      return {
        id: `mock-${dayOffset}-${hStart}-${subject}`,
        subject,
        start: start.toISOString().slice(0, 19),
        end: end.toISOString().slice(0, 19),
        isAllDay: allDay,
        location: null,
        categories: [],
        colorHex,
        webLink: null,
      };
    };
    return [
      mk(0, 9, 10, "Point équipe", "#3498DB"),
      mk(0, 14, 15.5, "RDV client — A0050 ABADI", "#E74C3C"),
      mk(2, 10, 12, "Visite agence", "#27AE60"),
      mk(4, 16, 17, "Bilan hebdo", "#8E44AD"),
      mk(7, 9, 9.5, "Appel fournisseur", "#D68910"),
      mk(8, 14, 15, "Vision TCI — démo", "#3498DB"),
    ];
  }

  useEffect(() => {
    if (useMockData) {
      setLoading(false);
      setError(null);
      setEvents(buildMockEvents(anchorMonday));
      return;
    }
    if (!selectedEmail) return;
    let cancelled = false;
    async function loadEvents() {
      setLoading(true);
      setError(null);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const start = toIsoDate(anchorMonday);
        const end = toIsoDate(addDays(anchorMonday, 12)); // exclusif, couvre le vendredi de la 2e semaine
        const params = new URLSearchParams({ email: selectedEmail, start, end });
        const res = await fetch(`/api/outlook/calendar?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = (await res.json()) as { success: boolean; message?: string; events?: OutlookEvent[]; debug?: unknown };
        if (!res.ok || !payload.success) throw new Error(payload?.message || "Erreur inconnue");
        if (payload.debug) {
          // eslint-disable-next-line no-console
          console.log("[OutlookAgenda] diagnostic ICS :", payload.debug);
        }
        if (!cancelled) setEvents(payload.events || []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadEvents();
    return () => {
      cancelled = true;
    };
  }, [selectedEmail, anchorMonday, useMockData]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, OutlookEvent[]>();
    events.forEach((e) => {
      const key = e.start.slice(0, 10);
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    });
    return map;
  }, [events]);

  async function handleAddAutorisation() {
    if (!formCollaborateur.trim() || !formEmail.trim()) return;
    setAdminSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("outlook_calendar_autorisations").insert({
        collaborateur: formCollaborateur.trim(),
        email_outlook: formEmail.trim().toLowerCase(),
        actif: true,
        ics_url: formIcsUrl.trim() || null,
      });
      if (err) throw new Error(err.message);
      setFormCollaborateur("");
      setFormEmail("");
      setFormIcsUrl("");
      await loadAdminAutorisations();
      await loadAutorisations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdminSaving(false);
    }
  }

  async function handleToggleActif(a: Autorisation) {
    setAdminSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("outlook_calendar_autorisations")
        .update({ actif: !a.actif })
        .eq("id", a.id);
      if (err) throw new Error(err.message);
      await loadAdminAutorisations();
      await loadAutorisations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdminSaving(false);
    }
  }

  async function handleDeleteAutorisation(a: Autorisation) {
    if (!window.confirm(`Retirer l'agenda de ${a.collaborateur} (${a.email_outlook}) ?`)) return;
    setAdminSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("outlook_calendar_autorisations").delete().eq("id", a.id);
      if (err) throw new Error(err.message);
      await loadAdminAutorisations();
      await loadAutorisations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdminSaving(false);
    }
  }

  function eventStyle(evt: OutlookEvent, defaultColor: string | null) {
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
      background: evt.colorHex || defaultColor || DEFAULT_COLOR,
    };
  }

  const currentAutorisation = autorisations.find((a) => a.email_outlook === selectedEmail);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-[#5B8DEF] to-[#2E5BB8] p-4 text-white">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-[var(--font-display,inherit)] text-base font-bold">Agenda</h3>
        {useMockData && (
          <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#141A26]">
            Données fictives
          </span>
        )}

        <select
          value={selectedEmail}
          onChange={(e) => setSelectedEmail(e.target.value)}
          className="rounded-lg border border-white/25 bg-white/10 px-2 py-1 text-xs text-white outline-none"
        >
          {autorisations.filter((a) => a.actif || a.email_outlook === selectedEmail).map((a) => (
            <option key={a.id} value={a.email_outlook} className="bg-[#1a3a7a] text-white">
              {a.collaborateur}{!a.actif ? " (inactif)" : ""}
            </option>
          ))}
          {autorisations.length === 0 && <option value="">Aucun agenda autorisé</option>}
        </select>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setAnchorMonday((d) => addDays(d, -7))}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-sm hover:bg-white/25"
            title="Semaine précédente"
          >
            −
          </button>
          <span className="min-w-[110px] text-center text-[11px] text-white/80">{rangeLabel}</span>
          <button
            onClick={() => setAnchorMonday((d) => addDays(d, 7))}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-sm hover:bg-white/25"
            title="Semaine suivante"
          >
            +
          </button>
          <button
            onClick={() => setAnchorMonday(mondayOf(new Date()))}
            className="ml-1 rounded-full bg-white/15 px-2 py-1 text-[10px] hover:bg-white/25"
            title="Revenir à aujourd'hui"
          >
            Auj.
          </button>
          <button
            onClick={() => setAdminOpen((v) => !v)}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs hover:bg-white/25"
            title="Gérer les agendas autorisés"
          >
            ⚙
          </button>
          <button
            onClick={() => void toggleMockData()}
            title="Basculer entre données réelles et données fictives (pour tester l'affichage)"
            className={`ml-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              useMockData ? "bg-amber-400/90 text-[#141A26]" : "bg-white/10 text-white/50 hover:bg-white/20"
            }`}
          >
            {useMockData ? "Fictif" : "Réel"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-2 rounded-lg bg-black/20 px-3 py-1.5 text-xs text-red-100">{error}</div>
      )}

      {adminOpen && (
        <div className="mb-3 rounded-xl bg-black/20 p-3 text-xs">
          {notice && (
            <div className={`mb-3 rounded px-2 py-1.5 ${notice.type === "success" ? "bg-emerald-400/20 text-emerald-100" : "bg-red-400/20 text-red-100"}`}>
              {notice.message}
            </div>
          )}

          {/* Connexion réelle (OAuth) — seul moyen de lire un agenda hors
              tenant Cegeclim (personnel) ou un agenda Cegeclim tant que le
              consentement app-only n'est pas en place. Redirige vers l'écran
              de login Microsoft, puis revient ici automatiquement. */}
          <div className="mb-3 rounded-lg border border-white/20 bg-white/5 p-2.5">
            <div className="mb-1.5 font-semibold">Connecter un agenda (recommandé)</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={connectCollaborateur}
                onChange={(e) => setConnectCollaborateur(e.target.value)}
                placeholder="Nom du collaborateur"
                className="rounded border border-white/25 bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/40"
              />
              <button
                onClick={() => void handleConnectMicrosoft()}
                disabled={connecting || !connectCollaborateur.trim()}
                className="rounded bg-white px-3 py-1 text-xs font-semibold text-[#2E5BB8] hover:brightness-95 disabled:opacity-40"
              >
                {connecting ? "Redirection…" : "Se connecter avec Microsoft"}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-white/50">
              Ouvre l&rsquo;écran de connexion Microsoft dans cet onglet. Fonctionne avec n&rsquo;importe quel compte
              (personnel ou professionnel) — c&rsquo;est la personne qui va se connecter qui doit cliquer sur ce bouton.
            </p>
          </div>

          <div className="mb-2 font-semibold">Agendas autorisés</div>
          <div className="mb-3 space-y-1">
            {autorisations.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1">
                <span className="flex-1 truncate">{a.collaborateur} — {a.email_outlook}</span>
                <button
                  onClick={() => void handleToggleActif(a)}
                  disabled={adminSaving}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.actif ? "bg-emerald-400/30 text-emerald-100" : "bg-white/10 text-white/50"}`}
                >
                  {a.actif ? "Actif" : "Inactif"}
                </button>
                <button
                  onClick={() => void handleDeleteAutorisation(a)}
                  disabled={adminSaving}
                  className="rounded-full bg-red-400/20 px-2 py-0.5 text-[10px] text-red-100 hover:bg-red-400/30"
                >
                  Retirer
                </button>
              </div>
            ))}
            {autorisations.length === 0 && <p className="text-white/50">Aucun agenda autorisé pour l&rsquo;instant.</p>}
          </div>
          <p className="mb-1 text-white/50">
            Ajout manuel — pour une messagerie Cegeclim <strong className="text-white/70">déjà couverte par le
            consentement app-only</strong> (pas encore en place), OU un lien ICS (Yahoo Agenda, Google Calendar…)
            pour tester sans attendre Microsoft.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={formCollaborateur}
              onChange={(e) => setFormCollaborateur(e.target.value)}
              placeholder="Nom du collaborateur"
              className="rounded border border-white/25 bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/40"
            />
            <input
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              placeholder="adresse@cegeclim.fr (identifiant, peut être fictif si lien ICS renseigné)"
              className="w-64 rounded border border-white/25 bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/40"
            />
            <input
              value={formIcsUrl}
              onChange={(e) => setFormIcsUrl(e.target.value)}
              placeholder="Lien ICS (optionnel — Yahoo Agenda, Google Calendar…)"
              className="w-72 rounded border border-white/25 bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/40"
            />
            <button
              onClick={() => void handleAddAutorisation()}
              disabled={adminSaving || !formCollaborateur.trim() || !formEmail.trim()}
              className="rounded bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 overflow-auto">
        {semaines.map((s, si) => (
          <div key={si} className="rounded-xl bg-white/10 p-2.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
              Semaine du {s.jours[0].date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })}
            </div>
            <div className="grid grid-cols-5 gap-1 text-xs font-medium text-white/70">
              {s.jours.map((j) => (
                <div key={j.label} className="text-center">
                  {j.label} {j.date.getDate()}
                </div>
              ))}
            </div>
            <div className="relative mt-1 grid grid-cols-5 gap-1" style={{ height: 340 }}>
              {/* Repères horaires en fond */}
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-0.5 text-[9px] text-white/30">
                {Array.from({ length: HOUR_END - HOUR_START + 1 }).map((_, i) => (
                  <div key={i} className="border-t border-white/10">{HOUR_START + i}h</div>
                ))}
              </div>
              {s.jours.map((j) => {
                const iso = toIsoDate(j.date);
                const dayEvents = eventsByDay.get(iso) || [];
                return (
                  <div key={iso} className="relative border-l border-white/5 first:border-l-0">
                    {dayEvents.filter((e) => !e.isAllDay).map((e) => (
                      <button
                        key={e.id}
                        onClick={() => onActivityClick?.(e)}
                        title={`${e.subject}${e.location ? " · " + e.location : ""}`}
                        style={eventStyle(e, currentAutorisation?.couleur_defaut || null)}
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight text-white shadow hover:brightness-110"
                      >
                        <div className="truncate font-medium">{e.subject}</div>
                        {e.location && <div className="truncate text-[9px] opacity-80">{e.location}</div>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            {/* Évènements journée entière, listés sous la grille horaire */}
            {s.jours.some((j) => (eventsByDay.get(toIsoDate(j.date)) || []).some((e) => e.isAllDay)) && (
              <div className="mt-1 grid grid-cols-5 gap-1">
                {s.jours.map((j) => {
                  const iso = toIsoDate(j.date);
                  const allDay = (eventsByDay.get(iso) || []).filter((e) => e.isAllDay);
                  return (
                    <div key={iso} className="space-y-0.5">
                      {allDay.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => onActivityClick?.(e)}
                          title={e.subject}
                          style={{ background: e.colorHex || currentAutorisation?.couleur_defaut || DEFAULT_COLOR }}
                          className="w-full truncate rounded px-1.5 py-1 text-left text-[10px] text-white"
                        >
                          {e.subject}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {loading && <div className="mt-2 text-center text-[10px] text-white/60">Chargement de l&rsquo;agenda…</div>}
    </div>
  );
}
