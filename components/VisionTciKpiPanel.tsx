"use client";

/**
 * VisionTciKpiPanel — V2
 * ------------------------------------------------------------------------
 * Pavés KPI configurables du mockup "Vision One page TCI".
 *
 * Trois familles de pavés, chacune avec son propre mode d'affichage et sa
 * propre destination de clic :
 *
 *  - FLUX (BL, Devis, CDC, Factures, Marge) : Jour / Mois / Année vs N-1.
 *    BL/CDC/Factures → focus_mensuel2. Devis → cycle-documents.
 *    Marge → atelier-analyse (raccourci "Analyse marge").
 *    Marge s'affiche en %, pas en montant (marge / CA), calculée sur le BL
 *    de l'environnement activité + factures (cf. get_vision_tci_kpi SQL).
 *
 *  - COMPTEUR (Clients actifs, Clients créés N, CERFA KO, CDC < 2026,
 *    Factures en retard) : une valeur unique, parfois détaillée (ex.
 *    répartition par classe de CA 12M pour "Clients actifs").
 *    Clients actifs / créés N → synthese_multi_clients.
 *    CERFA KO → ouvre la fenêtre flottante existante (évènement, cf. patch
 *    layout.tsx fourni séparément).
 *    CDC < 2026 → même comportement que la pastille du bandeau
 *    (portefeuille-livraison).
 *    Factures en retard → DONNÉE FICTIVE explicitement demandée, pas de
 *    source réelle branchée.
 *
 *  - TAUX (Taux de transformation devis) : pourcentage, réutilise
 *    get_cycle_documents_kpis (même RPC que l'écran Analyse Devis).
 *    → cycle-documents.
 *
 * ⚠️ COULEURS : BL (#4B92AC) et CDC (#C1683C) sont les couleurs confirmées
 * (constantes CUMUL_BL_COLOR / CUMUL_CDC_COLOR retrouvées dans
 * focus_mensuel3/page.tsx). Devis et Factures restent des choix cohérents
 * avec la charte du reste de l'appli, mais PAS vérifiés contre DOC_COLORS
 * (jamais vu sa valeur exacte, uniquement son import). Un seul endroit à
 * corriger si besoin : FOCUS_MENSUEL_COLORS ci-dessous.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// ⚠️ BL et CDC confirmés (cf. note ci-dessus). Devis/Factures/Marge : choix
// cohérents avec la charte, à valider.
export const FOCUS_MENSUEL_COLORS: Record<string, string> = {
  BL: "#4B92AC",
  Devis: "#D69A4A",
  CDC: "#C1683C",
  Factures: "#3F9142",
  Marge: "#7A5EA8",
};

const FAMILLES_FLUX = ["BL", "Devis", "CDC", "Factures", "Marge"] as const;
type FamilleFlux = (typeof FAMILLES_FLUX)[number];

type KpiKind = "flux" | "compteur" | "taux";

type KpiCardConfig = {
  id: string;
  kind: KpiKind;
  cle: string; // famille pour "flux" ; identifiant fixe pour "compteur"/"taux"
  famille_macro: string | null;
  agence: string | null;
};

const COMPTEUR_OPTIONS = [
  { cle: "clients_actifs", label: "Clients actifs" },
  { cle: "clients_crees_n", label: "Clients créés cette année" },
  { cle: "cerfa_ko", label: "CERFA non à jour" },
  { cle: "cdc_avant_2026", label: "CDC livraison < 2026" },
  { cle: "factures_retard", label: "Factures en retard de paiement" },
] as const;

const TAUX_OPTIONS = [{ cle: "taux_transformation_devis", label: "Taux de transformation devis" }] as const;

type FluxValues = {
  jour_valeur: number; jour_n1: number;
  mois_valeur: number; mois_n1: number;
  annee_valeur: number; annee_n1: number;
};

function formatMontant(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} K€`;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}
function formatPct(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function EvolBadge({ valeur, n1, unite = "montant" }: { valeur: number; n1: number; unite?: "montant" | "points" }) {
  if (unite === "points") {
    // Marge : l'écart pertinent est en points de %, pas en évolution relative.
    const delta = valeur - n1;
    if (!Number.isFinite(delta)) return <span className="text-[10px] text-white/30">—</span>;
    const up = delta >= 0;
    return (
      <span className={`text-[10px] font-medium ${up ? "text-emerald-400" : "text-orange-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} pts vs N-1
      </span>
    );
  }
  if (n1 === 0) return <span className="text-white/30 text-[10px]">—</span>;
  const pct = ((valeur - n1) / Math.abs(n1)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-[10px] font-medium ${up ? "text-emerald-400" : "text-orange-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% vs N-1
    </span>
  );
}

function CardShell({
  color, badgeLabel, badges, onRemove, onClick, clickHint, children,
}: {
  color: string;
  badgeLabel: string;
  badges?: string[];
  onRemove: () => void;
  onClick?: () => void;
  clickHint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative rounded-xl border border-white/10 bg-[#141A26] p-3 ${onClick ? "cursor-pointer hover:border-white/25 hover:bg-[#182034]" : ""}`}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
      onClick={onClick}
      title={clickHint}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Retirer ce KPI"
        className="absolute right-2 top-2 z-10 text-white/25 hover:text-white/70"
      >
        ✕
      </button>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-[#141A26]" style={{ background: color }}>
          {badgeLabel}
        </span>
        {(badges || []).map((b) => (
          <span key={b} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">{b}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

// ── Pavé FLUX (BL / Devis / CDC / Factures / Marge) ─────────────────────

function FluxCard({ config, onRemove }: { config: KpiCardConfig; onRemove: () => void }) {
  const router = useRouter();
  const famille = config.cle as FamilleFlux;
  const [values, setValues] = useState<FluxValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const color = FOCUS_MENSUEL_COLORS[famille] || "#4B92AC";
  const estMarge = famille === "Marge";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.rpc("get_vision_tci_kpi", {
        p_famille: famille,
        p_famille_macro: config.famille_macro,
        p_agence: config.agence,
        p_collaborateur: null,
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else setValues((Array.isArray(data) ? data[0] : data) as FluxValues);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [famille, config.famille_macro, config.agence]);

  function handleClick() {
    if (famille === "BL" || famille === "CDC" || famille === "Factures") router.push("/focus_mensuel2");
    else if (famille === "Devis") router.push("/cycle-documents");
    else if (famille === "Marge") router.push("/atelier-analyse?raccourci=analyse-marge");
  }

  const fmt = estMarge ? formatPct : formatMontant;

  return (
    <CardShell
      color={color}
      badgeLabel={famille}
      badges={[config.famille_macro, config.agence].filter((v): v is string => Boolean(v)).map((v) => (v === config.famille_macro ? `Fam : ${v}` : v))}
      onRemove={onRemove}
      onClick={handleClick}
      clickHint={
        famille === "Marge"
          ? "Ouvrir Atelier d'analyse — raccourci Analyse marge"
          : famille === "Devis"
            ? "Ouvrir Analyse Devis"
            : "Ouvrir Activité Quotidienne"
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-white/5" />
      ) : error ? (
        <p className="text-[10px] text-red-300">{error}</p>
      ) : values ? (
        <div className="grid grid-cols-3 gap-2 text-white">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-white/40">Jour</div>
            <div className="font-[var(--font-mono,monospace)] text-sm font-semibold">{fmt(values.jour_valeur)}</div>
            <EvolBadge valeur={values.jour_valeur} n1={values.jour_n1} unite={estMarge ? "points" : "montant"} />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-white/40">Mois</div>
            <div className="font-[var(--font-mono,monospace)] text-sm font-semibold">{fmt(values.mois_valeur)}</div>
            <EvolBadge valeur={values.mois_valeur} n1={values.mois_n1} unite={estMarge ? "points" : "montant"} />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-white/40">Année</div>
            <div className="font-[var(--font-mono,monospace)] text-sm font-semibold">{fmt(values.annee_valeur)}</div>
            <EvolBadge valeur={values.annee_valeur} n1={values.annee_n1} unite={estMarge ? "points" : "montant"} />
          </div>
        </div>
      ) : null}
    </CardShell>
  );
}

// ── Pavé COMPTEUR ─────────────────────────────────────────────────────────

const CA_BAND_ORDER = ["400K€", "150K€", "80K€", "20K€", "vide"] as const;

function CompteurCard({ config, onRemove }: { config: KpiCardConfig; onRemove: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [bands, setBands] = useState<Record<string, number> | null>(null);

  const label = COMPTEUR_OPTIONS.find((o) => o.cle === config.cle)?.label || config.cle;
  const color = "#A6A181";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (config.cle === "clients_actifs") {
          const { data, error: err } = await supabase.rpc("get_vision_tci_clients_actifs", {
            p_agence: config.agence, p_collaborateur: null,
          });
          if (err) throw err;
          const rows = (data || []) as Array<{ band: string; nb_clients: number }>;
          const map: Record<string, number> = {};
          rows.forEach((r) => { map[r.band] = r.nb_clients; });
          if (!cancelled) { setBands(map); setTotal(rows.reduce((s, r) => s + r.nb_clients, 0)); }
        } else if (config.cle === "clients_crees_n") {
          const { data, error: err } = await supabase.rpc("get_vision_tci_clients_crees_n", {
            p_agence: config.agence, p_collaborateur: null,
          });
          if (err) throw err;
          if (!cancelled) setTotal(Number(data) || 0);
        } else if (config.cle === "cerfa_ko") {
          const { data, error: err } = await supabase.rpc("get_cerfa_ko_count_for_user", {
            p_email: (await supabase.auth.getUser()).data.user?.email,
            p_allowed_agences: config.agence ? [config.agence] : null,
          });
          if (err) throw err;
          const n = Array.isArray(data) ? Number((data[0] as any)?.count ?? (data[0] as any)?.nb_lignes ?? 0) : Number(data ?? 0);
          if (!cancelled) setTotal(Number.isFinite(n) ? n : 0);
        } else if (config.cle === "cdc_avant_2026") {
          const { data, error: err } = await supabase.rpc("get_vision_tci_cdc_avant_2026", {
            p_agence: config.agence, p_collaborateur: null,
          });
          if (err) throw err;
          if (!cancelled) setTotal(Number(data) || 0);
        } else if (config.cle === "factures_retard") {
          // Donnée fictive, demandée explicitement — pas de source réelle branchée.
          if (!cancelled) setTotal(48250);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.cle, config.agence]);

  function handleClick() {
    if (config.cle === "clients_actifs" || config.cle === "clients_crees_n") router.push("/synthese_multi_clients");
    else if (config.cle === "cerfa_ko") window.dispatchEvent(new CustomEvent("cegeclim:open-cerfa-ko"));
    else if (config.cle === "cdc_avant_2026") router.push("/portefeuille-livraison");
    // "factures_retard" : donnée fictive, pas de destination réelle pour l'instant.
  }

  const isFake = config.cle === "factures_retard";
  const isMontant = config.cle === "factures_retard";

  return (
    <CardShell
      color={color}
      badgeLabel={label}
      badges={[config.agence, isFake ? "Donnée fictive" : null].filter((v): v is string => Boolean(v))}
      onRemove={onRemove}
      onClick={config.cle !== "factures_retard" ? handleClick : undefined}
      clickHint={
        config.cle === "clients_actifs" || config.cle === "clients_crees_n" ? "Ouvrir Synthèse multi-clients" :
        config.cle === "cerfa_ko" ? "Ouvrir la liste des CERFA KO" :
        config.cle === "cdc_avant_2026" ? "Ouvrir Portefeuille livraison" : undefined
      }
    >
      {loading ? (
        <div className="h-12 animate-pulse rounded bg-white/5" />
      ) : error ? (
        <p className="text-[10px] text-red-300">{error}</p>
      ) : (
        <div className="text-white">
          <div className="font-[var(--font-mono,monospace)] text-2xl font-semibold">
            {isMontant ? formatMontant(total || 0) : (total ?? 0).toLocaleString("fr-FR")}
          </div>
          {bands && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CA_BAND_ORDER.filter((b) => bands[b]).map((b) => (
                <span key={b} className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/60">{b} : {bands[b]}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

// ── Pavé TAUX (transformation devis) ────────────────────────────────────

function TauxCard({ config, onRemove }: { config: KpiCardConfig; onRemove: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taux, setTaux] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const now = new Date();
      const debut = `${now.getFullYear()}-01-01`;
      const fin = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
      const { data, error: err } = await supabase.rpc("get_cycle_documents_kpis", {
        p_date_debut: debut,
        p_date_fin: fin,
        p_agence: config.agence,
        p_collaborateur: null,
        p_famille_macro: config.famille_macro,
        p_famille: null,
        p_client: null,
        p_include_hors_stat: false,
        p_age_risque_jours: 30,
        p_montant_risque: 15000,
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else {
        const row = Array.isArray(data) ? data[0] : data;
        setTaux(row ? Number(row.taux_facture_valeur) : null);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [config.agence, config.famille_macro]);

  return (
    <CardShell
      color="#D69A4A"
      badgeLabel="Taux transfo devis"
      badges={[config.famille_macro, config.agence].filter((v): v is string => Boolean(v))}
      onRemove={onRemove}
      onClick={() => router.push("/cycle-documents")}
      clickHint="Ouvrir Analyse Devis"
    >
      {loading ? (
        <div className="h-12 animate-pulse rounded bg-white/5" />
      ) : error ? (
        <p className="text-[10px] text-red-300">{error}</p>
      ) : (
        <div className="font-[var(--font-mono,monospace)] text-2xl font-semibold text-white">
          {taux === null ? "—" : formatPct(taux)}
          <span className="ml-2 text-[10px] font-normal text-white/40">devis → facture, {new Date().getFullYear()}</span>
        </div>
      )}
    </CardShell>
  );
}

// ── Formulaire d'ajout ───────────────────────────────────────────────────

function AjouterKpiForm({
  famillesMacro, agencesAutorisees, onAdd, onCancel,
}: {
  famillesMacro: string[];
  agencesAutorisees: string[] | null;
  onAdd: (c: Omit<KpiCardConfig, "id">) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<KpiKind>("flux");
  const [cle, setCle] = useState<string>("BL");
  const [familleMacro, setFamilleMacro] = useState("");
  const [agence, setAgence] = useState("");

  function handleKindChange(next: KpiKind) {
    setKind(next);
    if (next === "flux") setCle("BL");
    else if (next === "compteur") setCle(COMPTEUR_OPTIONS[0].cle);
    else setCle(TAUX_OPTIONS[0].cle);
  }

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => handleKindChange(e.target.value as KpiKind)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
          <option value="flux">Flux (BL/Devis/CDC/Factures/Marge)</option>
          <option value="compteur">Compteur</option>
          <option value="taux">Taux</option>
        </select>

        {kind === "flux" && (
          <select value={cle} onChange={(e) => setCle(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            {FAMILLES_FLUX.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {kind === "compteur" && (
          <select value={cle} onChange={(e) => setCle(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            {COMPTEUR_OPTIONS.map((o) => <option key={o.cle} value={o.cle}>{o.label}</option>)}
          </select>
        )}
        {kind === "taux" && (
          <select value={cle} onChange={(e) => setCle(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            {TAUX_OPTIONS.map((o) => <option key={o.cle} value={o.cle}>{o.label}</option>)}
          </select>
        )}

        {kind === "flux" && (
          <select value={familleMacro} onChange={(e) => setFamilleMacro(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            <option value="">Toutes familles</option>
            {famillesMacro.map((fm) => <option key={fm} value={fm}>{fm}</option>)}
          </select>
        )}
        {(agencesAutorisees === null || agencesAutorisees.length > 1) && kind !== "flux" || (kind === "flux" && (agencesAutorisees === null || agencesAutorisees.length > 1)) ? (
          <select value={agence} onChange={(e) => setAgence(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            <option value="">Toutes agences autorisées</option>
            {(agencesAutorisees ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-xs text-white/60 hover:text-white">Annuler</button>
        <button
          onClick={() => onAdd({ kind, cle, famille_macro: kind === "flux" ? (familleMacro || null) : null, agence: agence || null })}
          className="rounded bg-white/20 px-3 py-1 text-xs font-semibold text-white hover:bg-white/30"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

// ── Panneau principal ────────────────────────────────────────────────────

export default function VisionTciKpiPanel() {
  const [cards, setCards] = useState<KpiCardConfig[]>([]);
  const [famillesMacro, setFamillesMacro] = useState<string[]>([]);
  const [agencesAutorisees, setAgencesAutorisees] = useState<string[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) { setLoading(false); return; }

    const [{ data: prefs }, { data: acces }, { data: fams }] = await Promise.all([
      supabase.from("vision_tci_preferences").select("kpi_cards").eq("user_email", email).maybeSingle(),
      supabase.from("user_page_access").select("allowed_agences").eq("email", email).maybeSingle(),
      supabase.from("ref_familles").select("famille_macro"),
    ]);

    const raw = (prefs?.kpi_cards as any[] | null) || [];
    // Compatibilité avec l'ancien format (pas de "kind") : on considère que
    // c'était un pavé "flux".
    const normalized: KpiCardConfig[] = raw.map((c) => ({
      id: c.id,
      kind: c.kind || "flux",
      cle: c.cle || c.famille || "BL",
      famille_macro: c.famille_macro ?? null,
      agence: c.agence ?? null,
    }));
    setCards(normalized);

    const allowed = acces?.allowed_agences as string[] | null | undefined;
    setAgencesAutorisees(allowed && allowed.length > 0 ? allowed : null);
    setFamillesMacro(Array.from(new Set(((fams || []) as Array<{ famille_macro: string | null }>).map((f) => f.famille_macro).filter((v): v is string => Boolean(v)))).sort());
    setLoading(false);
  }, []);

  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  async function persistCards(next: KpiCardConfig[]) {
    setCards(next);
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) return;
    await supabase.from("vision_tci_preferences").upsert({
      user_email: email, kpi_cards: next, updated_at: new Date().toISOString(),
    });
  }

  function handleAdd(c: Omit<KpiCardConfig, "id">) {
    setShowForm(false);
    void persistCards([...cards, { ...c, id: crypto.randomUUID() }]);
  }
  function handleRemove(id: string) {
    void persistCards(cards.filter((c) => c.id !== id));
  }

  if (loading) {
    return <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-white/5" />)}</div>;
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) =>
          c.kind === "flux" ? (
            <FluxCard key={c.id} config={c} onRemove={() => handleRemove(c.id)} />
          ) : c.kind === "taux" ? (
            <TauxCard key={c.id} config={c} onRemove={() => handleRemove(c.id)} />
          ) : (
            <CompteurCard key={c.id} config={c} onRemove={() => handleRemove(c.id)} />
          ),
        )}
      </div>

      {showForm ? (
        <AjouterKpiForm famillesMacro={famillesMacro} agencesAutorisees={agencesAutorisees} onAdd={handleAdd} onCancel={() => setShowForm(false)} />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-xl border border-dashed border-white/20 py-3 text-xs font-medium text-white/50 hover:border-white/40 hover:text-white/80"
        >
          + Ajouter un KPI
        </button>
      )}
    </div>
  );
}
