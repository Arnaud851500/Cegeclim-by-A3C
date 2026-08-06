"use client";

/**
 * VisionTciKpiPanel — V3
 * ------------------------------------------------------------------------
 * Changements vs V2 :
 *
 *  - FILTRAGE PAR AUTORISATIONS (correctif prioritaire) : branché sur
 *    usePageFilterAccess(), le même hook que focus_mensuel3 /
 *    cycle-documents / synthese_multi_clients. Si l'utilisateur a une
 *    restriction d'agence (user_page_access), elle est appliquée à TOUS
 *    les pavés, quel que soit ce qui a été choisi dans le formulaire
 *    d'ajout — un utilisateur restreint ne peut pas se donner à lui-même
 *    un périmètre plus large en configurant un pavé. Le sélecteur d'agence
 *    du formulaire se verrouille sur la valeur imposée, comme ailleurs
 *    dans l'appli (🔒).
 *
 *  - GRILLE 4 COLONNES : les pavés "flux" gardent leur taille (2 colonnes
 *    sur 4, donc 2 par ligne comme avant) ; les pavés "compteur" et "taux"
 *    passent à 1 colonne sur 4 (4 par ligne), contenu resserré.
 *
 *  - COLOR CODING : pour les compteurs D'ALERTE (CERFA KO, CDC < 2026,
 *    Factures en retard) — pas les compteurs "Clients", purement
 *    informatifs — la valeur s'affiche en rouge si > 0, en vert si = 0.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { usePageFilterAccess } from "@/lib/pageAccessFilters";

// ⚠️ BL et CDC confirmés (CUMUL_BL_COLOR / CUMUL_CDC_COLOR dans
// focus_mensuel3/page.tsx). Devis/Factures/Marge non vérifiés contre
// DOC_COLORS (jamais vu sa valeur exacte).
export const FOCUS_MENSUEL_COLORS: Record<string, string> = {
  BL: "#4B92AC",
  Devis: "#D69A4A",
  CDC: "#C1683C",
  Factures: "#3F9142",
  Marge: "#7A5EA8",
};

const FAMILLES_FLUX = ["BL", "Devis", "CDC", "Factures", "Marge"] as const;
type FamilleFlux = (typeof FAMILLES_FLUX)[number];

type KpiKind = "flux" | "compteur" | "taux" | "spacer";

type KpiCardConfig = {
  id: string;
  kind: KpiKind;
  cle: string;
  famille_macro: string | null;
  agence: string | null;
};

const COMPTEUR_OPTIONS = [
  // "Clients créés cette année" n'est plus un pavé séparé — intégré comme
  // sous-mesure de "Clients actifs" (cf. CompteurCard).
  { cle: "clients_actifs", label: "Clients actifs", isAlerte: false },
  { cle: "cerfa_ko", label: "CERFA non à jour", isAlerte: true },
  { cle: "cdc_avant_2026", label: "CDC livraison < 2026", isAlerte: true },
  { cle: "factures_retard", label: "Factures en retard", isAlerte: true },
] as const;

const TAUX_OPTIONS = [{ cle: "taux_transformation_devis", label: "Taux transfo devis" }] as const;

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
    const delta = valeur - n1;
    if (!Number.isFinite(delta)) return <span className="text-[10px] text-white/30">—</span>;
    const up = delta >= 0;
    return (
      <span className={`text-[10px] font-medium ${up ? "text-emerald-400" : "text-orange-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} pts
      </span>
    );
  }
  if (n1 === 0) return <span className="text-white/30 text-[10px]">—</span>;
  const pct = ((valeur - n1) / Math.abs(n1)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-[10px] font-medium ${up ? "text-emerald-400" : "text-orange-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function CardShell({
  color, badgeLabel, badges, onRemove, onClick, clickHint, compact, children,
}: {
  color: string;
  badgeLabel: string;
  badges?: string[];
  onRemove: () => void;
  onClick?: () => void;
  clickHint?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative rounded-xl border border-white/10 bg-[#141A26] ${compact ? "p-2" : "p-3"} ${onClick ? "cursor-pointer hover:border-white/25 hover:bg-[#182034]" : ""}`}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
      onClick={onClick}
      title={clickHint}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Retirer ce KPI"
        className="absolute right-1.5 top-1.5 z-10 text-white/25 hover:text-white/70"
      >
        ✕
      </button>
      <div className={`${compact ? "mb-1" : "mb-2"} flex flex-wrap items-center gap-1`}>
        <span className={`rounded-full font-bold text-[#141A26] ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"}`} style={{ background: color }}>
          {badgeLabel}
        </span>
        {!compact && (badges || []).map((b) => (
          <span key={b} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">{b}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

// ── Pavé FLUX ─────────────────────────────────────────────────────────────

function FluxCard({
  config, effectiveAgence, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; onRemove: () => void }) {
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
        p_agence: effectiveAgence,
        p_collaborateur: null,
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else setValues((Array.isArray(data) ? data[0] : data) as FluxValues);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [famille, config.famille_macro, effectiveAgence]);

  function handleClick() {
    if (famille === "BL" || famille === "CDC" || famille === "Factures") router.push("/focus_mensuel2");
    else if (famille === "Devis") router.push("/cycle-documents");
    else if (famille === "Marge") router.push("/atelier-analyse?raccourci=analyse-marge");
  }

  const fmt = estMarge ? formatPct : formatMontant;

  return (
    <div className="col-span-4 sm:col-span-2">
      <CardShell
        color={color}
        badgeLabel={famille}
        badges={[config.famille_macro, effectiveAgence].filter((v): v is string => Boolean(v)).map((v) => (v === config.famille_macro ? `Fam : ${v}` : v))}
        onRemove={onRemove}
        onClick={handleClick}
        clickHint={famille === "Marge" ? "Ouvrir Atelier d'analyse — Analyse marge" : famille === "Devis" ? "Ouvrir Analyse Devis" : "Ouvrir Activité Quotidienne"}
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
    </div>
  );
}

// ── Pavé COMPTEUR (réduit : 1 colonne sur 4) ────────────────────────────

const CA_BAND_ORDER = ["400K€", "150K€", "80K€", "20K€", "vide"] as const;

function CompteurCard({
  config, effectiveAgence, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; onRemove: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [bands, setBands] = useState<Record<string, number> | null>(null);

  const meta = COMPTEUR_OPTIONS.find((o) => o.cle === config.cle) || (config.cle === "clients_crees_n" ? { cle: "clients_crees_n", label: "Clients créés cette année", isAlerte: false } : undefined);
  const label = meta?.label || config.cle;
  const isAlerte = meta?.isAlerte ?? false;
  const [clientsCreesN, setClientsCreesN] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (config.cle === "clients_actifs") {
          const [actifsRes, creesRes] = await Promise.all([
            supabase.rpc("get_vision_tci_clients_actifs", { p_agence: effectiveAgence, p_collaborateur: null }),
            supabase.rpc("get_vision_tci_clients_crees_n", { p_agence: effectiveAgence, p_collaborateur: null }),
          ]);
          if (actifsRes.error) throw actifsRes.error;
          if (creesRes.error) throw creesRes.error;
          const rows = (actifsRes.data || []) as Array<{ band: string; nb_clients: number }>;
          const map: Record<string, number> = {};
          rows.forEach((r) => { map[r.band] = r.nb_clients; });
          if (!cancelled) {
            setBands(map);
            setTotal(rows.reduce((s, r) => s + r.nb_clients, 0));
            setClientsCreesN(Number(creesRes.data) || 0);
          }
        } else if (config.cle === "clients_crees_n") {
          const { data, error: err } = await supabase.rpc("get_vision_tci_clients_crees_n", { p_agence: effectiveAgence, p_collaborateur: null });
          if (err) throw err;
          if (!cancelled) setTotal(Number(data) || 0);
        } else if (config.cle === "cerfa_ko") {
          const { data, error: err } = await supabase.rpc("get_cerfa_ko_count_for_user", {
            p_email: (await supabase.auth.getUser()).data.user?.email,
            p_allowed_agences: effectiveAgence ? [effectiveAgence] : null,
          });
          if (err) throw err;
          const n = Array.isArray(data) ? Number((data[0] as any)?.count ?? (data[0] as any)?.nb_lignes ?? 0) : Number(data ?? 0);
          if (!cancelled) setTotal(Number.isFinite(n) ? n : 0);
        } else if (config.cle === "cdc_avant_2026") {
          const { data, error: err } = await supabase.rpc("get_vision_tci_cdc_avant_2026", { p_agence: effectiveAgence, p_collaborateur: null });
          if (err) throw err;
          if (!cancelled) setTotal(Number(data) || 0);
        } else if (config.cle === "factures_retard") {
          if (!cancelled) setTotal(48250); // fictif, demandé explicitement
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
  }, [config.cle, effectiveAgence]);

  function handleClick() {
    if (config.cle === "clients_actifs" || config.cle === "clients_crees_n") router.push("/synthese_multi_clients");
    else if (config.cle === "cerfa_ko") window.dispatchEvent(new CustomEvent("cegeclim:open-cerfa-ko"));
    else if (config.cle === "cdc_avant_2026") router.push("/portefeuille-livraison");
  }

  const isMontant = config.cle === "factures_retard";
  const valueColor = isAlerte ? ((total || 0) > 0 ? "#C1683C" : "#3F9142") : "#FFFFFF";

  return (
    <div className="col-span-2 sm:col-span-1">
      <CardShell color="#A6A181" badgeLabel={label} onRemove={onRemove} onClick={config.cle !== "factures_retard" ? handleClick : undefined} compact>
        {loading ? (
          <div className="h-8 animate-pulse rounded bg-white/5" />
        ) : error ? (
          <p className="text-[9px] text-red-300">{error}</p>
        ) : (
          <>
            <div className="font-[var(--font-mono,monospace)] text-lg font-semibold" style={{ color: valueColor }}>
              {isMontant ? formatMontant(total || 0) : (total ?? 0).toLocaleString("fr-FR")}
            </div>
            {config.cle === "clients_actifs" && clientsCreesN !== null && (
              <div className="mt-0.5 text-[9px] text-white/50">
                dont <span className="font-semibold text-white/80">{clientsCreesN.toLocaleString("fr-FR")}</span> créés cette année
              </div>
            )}
            {bands && (
              <div className="mt-1 flex flex-wrap gap-1">
                {CA_BAND_ORDER.filter((b) => bands[b]).slice(0, 3).map((b) => (
                  <span key={b} className="rounded bg-white/10 px-1 py-0.5 text-[8px] text-white/60">{b}:{bands[b]}</span>
                ))}
              </div>
            )}
          </>
        )}
      </CardShell>
    </div>
  );
}

// ── Pavé TAUX (réduit : 1 colonne sur 4) ────────────────────────────────

function TauxCard({
  config, effectiveAgence, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; onRemove: () => void }) {
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
        p_date_debut: debut, p_date_fin: fin,
        p_agence: effectiveAgence, p_collaborateur: null,
        p_famille_macro: config.famille_macro, p_famille: null, p_client: null,
        p_include_hors_stat: false, p_age_risque_jours: 30, p_montant_risque: 15000,
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else { const row = Array.isArray(data) ? data[0] : data; setTaux(row ? Number(row.taux_facture_valeur) : null); }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [effectiveAgence, config.famille_macro]);

  return (
    <div className="col-span-2 sm:col-span-1">
      <CardShell color="#D69A4A" badgeLabel="Taux transfo devis" onRemove={onRemove} onClick={() => router.push("/cycle-documents")} clickHint="Ouvrir Analyse Devis" compact>
        {loading ? (
          <div className="h-8 animate-pulse rounded bg-white/5" />
        ) : error ? (
          <p className="text-[9px] text-red-300">{error}</p>
        ) : (
          <div className="font-[var(--font-mono,monospace)] text-lg font-semibold text-white">
            {taux === null ? "—" : formatPct(taux)}
          </div>
        )}
      </CardShell>
    </div>
  );
}

// ── Pavé vide (mise en forme uniquement, pas de bordure ni de données) ───

function SpacerCard({ span, onRemove }: { span: 1 | 2; onRemove: () => void }) {
  return (
    <div className={span === 2 ? "col-span-4 sm:col-span-2" : "col-span-2 sm:col-span-1"}>
      <div className="group relative flex h-full min-h-[64px] items-center justify-center rounded-xl">
        <button
          onClick={onRemove}
          title="Retirer cet espace"
          className="absolute right-1.5 top-1.5 text-white/0 group-hover:text-white/30 hover:!text-white/70"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Formulaire d'ajout ───────────────────────────────────────────────────

function AjouterKpiForm({
  famillesMacro, agenceForcee, agencesDisponibles, onAdd, onCancel,
}: {
  famillesMacro: string[];
  agenceForcee: string | null;
  agencesDisponibles: string[];
  onAdd: (c: Omit<KpiCardConfig, "id">) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<KpiKind>("flux");
  const [cle, setCle] = useState<string>("BL");
  const [familleMacro, setFamilleMacro] = useState("");
  const [agence, setAgence] = useState(agenceForcee || "");
  const [spacerSpan, setSpacerSpan] = useState<1 | 2>(1);

  function handleKindChange(next: KpiKind) {
    setKind(next);
    if (next === "flux") setCle("BL");
    else if (next === "compteur") setCle(COMPTEUR_OPTIONS[0].cle);
    else if (next === "taux") setCle(TAUX_OPTIONS[0].cle);
  }

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => handleKindChange(e.target.value as KpiKind)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
          <option value="flux">Flux (BL/Devis/CDC/Factures/Marge)</option>
          <option value="compteur">Compteur</option>
          <option value="taux">Taux</option>
          <option value="spacer">Espace vide (mise en forme)</option>
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
        {kind === "spacer" && (
          <select value={spacerSpan} onChange={(e) => setSpacerSpan(Number(e.target.value) as 1 | 2)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            <option value={1}>Petit (largeur d&rsquo;un compteur)</option>
            <option value={2}>Grand (largeur d&rsquo;un flux)</option>
          </select>
        )}

        {kind === "flux" && (
          <select value={familleMacro} onChange={(e) => setFamilleMacro(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            <option value="">Toutes familles</option>
            {famillesMacro.map((fm) => <option key={fm} value={fm}>{fm}</option>)}
          </select>
        )}

        {/* Liste complète des agences (pas seulement celles auxquelles
            l'utilisateur courant est restreint) — la restriction éventuelle
            de l'utilisateur reste appliquée à l'affichage quoi qu'il choisisse
            ici (cf. agenceForcee / effectiveAgenceFor dans le composant parent). */}
        {kind !== "spacer" && (
          <select
            value={agenceForcee || agence}
            disabled={Boolean(agenceForcee)}
            onChange={(e) => setAgence(e.target.value)}
            className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!agenceForcee && <option value="">Toutes agences</option>}
            {agencesDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {agenceForcee && kind !== "spacer" && <span className="text-[10px] uppercase tracking-wide text-[#A6A181]">périmètre 🔒</span>}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-xs text-white/60 hover:text-white">Annuler</button>
        <button
          onClick={() =>
            kind === "spacer"
              ? onAdd({ kind, cle: String(spacerSpan), famille_macro: null, agence: null })
              : onAdd({ kind, cle, famille_macro: kind === "flux" ? (familleMacro || null) : null, agence: agenceForcee || agence || null })
          }
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
  const access = usePageFilterAccess();
  const [cards, setCards] = useState<KpiCardConfig[]>([]);
  const [famillesMacro, setFamillesMacro] = useState<string[]>([]);
  const [agencesDisponibles, setAgencesDisponibles] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) { setLoading(false); return; }

    const [{ data: prefs }, { data: fams }, { data: agences }] = await Promise.all([
      supabase.from("vision_tci_preferences").select("kpi_cards").eq("user_email", email).maybeSingle(),
      supabase.from("ref_familles").select("famille_macro"),
      // Liste complète des agences (pas "autorisées" : la restriction de
      // l'utilisateur reste appliquée à l'affichage via agenceForcee, quel
      // que soit ce qui est proposé ici dans le sélecteur).
      supabase.from("ref_collaborateurs").select("agence"),
    ]);

    const raw = (prefs?.kpi_cards as any[] | null) || [];
    const normalized: KpiCardConfig[] = raw.map((c) => ({
      id: c.id, kind: c.kind || "flux", cle: c.cle || c.famille || "BL",
      famille_macro: c.famille_macro ?? null, agence: c.agence ?? null,
    }));
    setCards(normalized);
    setFamillesMacro(Array.from(new Set(((fams || []) as Array<{ famille_macro: string | null }>).map((f) => f.famille_macro).filter((v): v is string => Boolean(v)))).sort());
    setAgencesDisponibles(Array.from(new Set(((agences || []) as Array<{ agence: string | null }>).map((a) => a.agence).filter((v): v is string => Boolean(v)))).sort());
    setLoading(false);
  }, []);

  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  // Périmètre imposé par les autorisations : prioritaire sur ce qui a été
  // choisi dans le formulaire d'ajout, pour CHAQUE pavé, sans exception.
  const agenceForcee = access.hasAgenceRestriction && access.allowedAgences.length > 0 ? access.allowedAgences[0] : null;

  function effectiveAgenceFor(card: KpiCardConfig): string | null {
    return agenceForcee || card.agence;
  }

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

  if (loading || access.loading) {
    return <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="col-span-2 h-28 animate-pulse rounded-xl bg-white/5" />)}</div>;
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-4 gap-3">
        {cards.map((c) =>
          c.kind === "flux" ? (
            <FluxCard key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} onRemove={() => handleRemove(c.id)} />
          ) : c.kind === "taux" ? (
            <TauxCard key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} onRemove={() => handleRemove(c.id)} />
          ) : c.kind === "spacer" ? (
            <SpacerCard key={c.id} span={c.cle === "2" ? 2 : 1} onRemove={() => handleRemove(c.id)} />
          ) : (
            <CompteurCard key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} onRemove={() => handleRemove(c.id)} />
          ),
        )}
      </div>

      {showForm ? (
        <AjouterKpiForm
          famillesMacro={famillesMacro}
          agenceForcee={agenceForcee}
          agencesDisponibles={agencesDisponibles}
          onAdd={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-xl border border-dashed border-white/20 py-3 text-xs font-medium text-white/50 hover:border-white/40 hover:text-white/80"
        >
          + Ajouter un KPI
        </button>
      )}

      {/* Bloc sous les KPI — encore à définir (cf. mockup "À définir plus
          tard"). Rien construit ici volontairement pour l'instant. */}
    </div>
  );
}
