"use client";

/**
 * VisionTciKpiPanel — V4
 * ------------------------------------------------------------------------
 * Changements vs V3 :
 *
 *  - BASCULE JOUR / J-1 en en-tête : pilote le "p_utiliser_j_moins_1" de
 *    get_vision_tci_kpi pour tous les pavés flux d'un coup.
 *
 *  - MISE EN PAGE PAR PROFIL : résolution en cascade — préférences
 *    personnelles (vision_tci_preferences, si personnalise=true) sinon
 *    disposition par défaut du profil de l'utilisateur
 *    (access_profiles.default_vision_tci_layout_id → vision_tci_layouts),
 *    sinon vide. Toute modification manuelle bascule automatiquement
 *    l'utilisateur en "personnalisé" (n'affecte jamais les autres
 *    utilisateurs du même profil). Un bouton permet de revenir à la
 *    disposition du profil. Les administrateurs (can_autorisation)
 *    peuvent en plus enregistrer la disposition courante comme modèle
 *    nommé réutilisable, pour l'affecter à un profil depuis l'écran
 *    Autorisation.
 *
 *  - Le reste (grille 4 colonnes, color coding, filtrage agence) reprend
 *    le comportement de la V3.
 *
 *  - V4.1 : badge "dernière synchro SAGE" dans l'en-tête (LastSyncBadge),
 *    pour que l'utilisateur sache à quel point les chiffres affichés sont
 *    frais sans avoir à le deviner.
 *
 *  - V4.2 (2026-08) :
 *    - Nouveau format de pavé flux "grand format" (option à l'ajout,
 *      config.grand=true) : même largeur que le pavé flux compact, mais
 *      deux fois plus haut, avec une courbe cumulée depuis le 1er janvier
 *      (année en cours en trait plein, N-1 en pointillé, tooltip au
 *      survol) en plus du total YTD affiché en gros. Alimenté par la
 *      nouvelle RPC get_vision_tci_kpi_courbe_annuelle, qui réutilise
 *      exactement les mêmes sous-fonctions par famille que
 *      get_vision_tci_kpi (get_focus_mensuel_daily_summary_metier /
 *      _factures_marge / _marge_bl) -- même nettage BR, mêmes chiffres
 *      que le pavé compact, juste la série jour par jour au lieu d'un
 *      seul total.
 *    - Pavé "Clients actifs" (CompteurCard, cle="clients_actifs") :
 *      largeur doublée (col-span-2 sm:col-span-1 -> col-span-4
 *      sm:col-span-2) et chiffres agrandis, pour rester lisibles au
 *      premier coup d'œil. S'applique directement aux pavés déjà en
 *      place (déterminé par la clé du KPI, pas par une option à
 *      resélectionner).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePageFilterAccess } from "@/lib/pageAccessFilters";
import { useAccess } from "@/components/AccessContext";
import LastSyncBadge from "@/components/LastSyncBadge";


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
  // Uniquement pour kind="flux" : pavé grand format avec courbe annuelle
  // cumulée (voir FluxCardGrand) au lieu du pavé compact jour/mois/année.
  grand?: boolean;
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

type CourbePoint = { jour_annee: number; valeur_n: number; valeur_n1: number };

function formatMontant(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} K€`;
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}
function formatPct(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

// jour_annee (1 = 1er janvier de l'année en cours) -> Date réelle, pour les
// libellés de mois et le tooltip de CourbeAnnuelleChart.
function anneeCouranteDate(jourAnnee: number): Date {
  const annee = new Date().getFullYear();
  const d = new Date(annee, 0, 1);
  d.setDate(d.getDate() + (jourAnnee - 1));
  return d;
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
      className={`relative flex h-full flex-col rounded-xl border border-white/10 bg-[#141A26] ${compact ? "p-2" : "p-3"} ${onClick ? "cursor-pointer hover:border-white/25 hover:bg-[#182034]" : ""}`}
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

// ── Pavé FLUX (compact) ──────────────────────────────────────────────────

function FluxCard({
  config, effectiveAgence, effectiveCollaborateur, utiliserJMoins1, refreshTick, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; effectiveCollaborateur: string | null; utiliserJMoins1: boolean; refreshTick: number; onRemove: () => void }) {
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
        p_collaborateur: effectiveCollaborateur,
        p_utiliser_j_moins_1: utiliserJMoins1,
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else setValues((Array.isArray(data) ? data[0] : data) as FluxValues);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [famille, config.famille_macro, effectiveAgence, effectiveCollaborateur, utiliserJMoins1, refreshTick]);

  function handleClick() {
    if (famille === "BL" || famille === "CDC" || famille === "Factures") window.open("/focus_mensuel2", "_blank", "noopener,noreferrer");
    else if (famille === "Devis") window.open("/cycle-documents", "_blank", "noopener,noreferrer");
    else if (famille === "Marge") window.open("/atelier-analyse?raccourci=analyse-marge", "_blank", "noopener,noreferrer");
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
              <div className="text-[9px] uppercase tracking-wide text-white/40">{utiliserJMoins1 ? "Jour (J-1)" : "Jour"}</div>
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

// ── Pavé FLUX (grand format, courbe annuelle) ───────────────────────────
// Même largeur que le pavé compact (col-span-4 sm:col-span-2), mais deux
// fois plus haut : gros total YTD + courbe cumulée depuis le 1er janvier
// (N plein, N-1 pointillé), tooltip au survol.

function CourbeAnnuelleChart({ points, color, estMarge }: { points: CourbePoint[]; color: string; estMarge: boolean }) {
  const width = 460;
  const height = 168;
  const padding = { top: 8, right: 8, bottom: 18, left: 50 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = points.length;
  const valuesN = points.map((p) => p.valeur_n);
  const valuesN1 = points.map((p) => p.valeur_n1);
  const maxVal = Math.max(1, ...valuesN, ...valuesN1);
  const minVal = 0;
  const x = (i: number) => padding.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH;

  const pathN = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.valeur_n)}`).join(" ");
  const pathN1 = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.valeur_n1)}`).join(" ");
  const areaPath = n > 1 ? `${pathN} L ${x(n - 1)} ${y(0)} L ${x(0)} ${y(0)} Z` : "";
  const gradientId = `courbe-annuelle-${color.replace("#", "")}`;

  const ticks = [0, maxVal / 2, maxVal];

  // Un libellé par mois, positionné au premier jour de ce mois rencontré
  // dans la série (donc toujours présent quel que soit le point de départ
  // de la fenêtre affichée).
  const moisLabels = useMemo(() => {
    const seen = new Set<number>();
    const labels: { idx: number; label: string }[] = [];
    points.forEach((p, i) => {
      const d = anneeCouranteDate(p.jour_annee);
      const mois = d.getMonth();
      if (!seen.has(mois)) {
        seen.add(mois);
        labels.push({ idx: i, label: d.toLocaleDateString("fr-FR", { month: "short" }) });
      }
    });
    return labels;
  }, [points]);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = relX * width;
    const idx = Math.round(((svgX - padding.left) / innerW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  }

  const hp = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverLeftPct = hoverIdx !== null ? (x(hoverIdx) / width) * 100 : null;

  if (n === 0) return <div className="flex h-[168px] items-center justify-center text-[10px] text-white/30">Aucune donnée.</div>;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="#FFFFFF14" strokeDasharray={i === ticks.length - 1 ? undefined : "3 3"} />
            <text x={padding.left - 4} y={y(t) + 3} fontSize={9} textAnchor="end" fill="#FFFFFF55">
              {estMarge ? `${t.toFixed(0)}%` : formatMontant(t)}
            </text>
          </g>
        ))}
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        <path d={pathN1} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.55} />
        <path d={pathN} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        {hoverIdx !== null && (
          <>
            <line x1={x(hoverIdx)} y1={padding.top} x2={x(hoverIdx)} y2={height - padding.bottom} stroke="#FFFFFF33" strokeWidth={1} />
            <circle cx={x(hoverIdx)} cy={y(points[hoverIdx].valeur_n)} r={3.5} fill={color} />
            <circle cx={x(hoverIdx)} cy={y(points[hoverIdx].valeur_n1)} r={3} fill={color} opacity={0.55} />
          </>
        )}
        {moisLabels.map(({ idx, label }) => (
          <text key={idx} x={x(idx)} y={height - 3} fontSize={9} textAnchor="middle" fill="#FFFFFF55">{label}</text>
        ))}
      </svg>

      {hp && hoverLeftPct !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-[#0B1220] px-2.5 py-1.5 text-[10px] shadow-lg"
          style={{ left: `${Math.min(92, Math.max(8, hoverLeftPct))}%` }}
        >
          <div className="mb-0.5 font-semibold text-white/80">
            {anneeCouranteDate(hp.jour_annee).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
          </div>
          <div className="flex items-center gap-1.5 text-white">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            N&nbsp;: <span className="font-[var(--font-mono,monospace)] font-semibold">{estMarge ? formatPct(hp.valeur_n) : formatMontant(hp.valeur_n)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-white/60">
            <span className="inline-block h-1.5 w-1.5 rounded-full border border-white/40" />
            N-1&nbsp;: <span className="font-[var(--font-mono,monospace)]">{estMarge ? formatPct(hp.valeur_n1) : formatMontant(hp.valeur_n1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FluxCardGrand({
  config, effectiveAgence, effectiveCollaborateur, refreshTick, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; effectiveCollaborateur: string | null; refreshTick: number; onRemove: () => void }) {
  const famille = config.cle as FamilleFlux;
  const [points, setPoints] = useState<CourbePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const color = FOCUS_MENSUEL_COLORS[famille] || "#4B92AC";
  const estMarge = famille === "Marge";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.rpc("get_vision_tci_kpi_courbe_annuelle", {
        p_famille: famille,
        p_famille_macro: config.famille_macro,
        p_agence: effectiveAgence,
        p_collaborateur: effectiveCollaborateur,
      });
      if (cancelled) return;
      if (err) {
        setError(err.message);
      } else {
        setPoints(((data || []) as CourbePoint[]).map((p) => ({
          jour_annee: Number(p.jour_annee),
          valeur_n: Number(p.valeur_n),
          valeur_n1: Number(p.valeur_n1),
        })));
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [famille, config.famille_macro, effectiveAgence, effectiveCollaborateur, refreshTick]);

  function handleClick() {
    if (famille === "BL" || famille === "CDC" || famille === "Factures") window.open("/focus_mensuel2", "_blank", "noopener,noreferrer");
    else if (famille === "Devis") window.open("/cycle-documents", "_blank", "noopener,noreferrer");
    else if (famille === "Marge") window.open("/atelier-analyse?raccourci=analyse-marge", "_blank", "noopener,noreferrer");
  }

  const fmt = estMarge ? formatPct : formatMontant;
  const dernier = points.length ? points[points.length - 1] : null;
  const ytdN = dernier?.valeur_n ?? 0;
  const ytdN1 = dernier?.valeur_n1 ?? 0;

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
          <div className="h-56 animate-pulse rounded bg-white/5" />
        ) : error ? (
          <p className="text-[10px] text-red-300">{error}</p>
        ) : (
          <div className="text-white">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] uppercase tracking-wide text-white/40">Cumul depuis le 1er janvier</div>
                <div className="whitespace-nowrap font-[var(--font-mono,monospace)] text-2xl font-semibold">{fmt(ytdN)}</div>
              </div>
              <div className="shrink-0 text-right">
                <EvolBadge valeur={ytdN} n1={ytdN1} unite={estMarge ? "points" : "montant"} />
                <div className="mt-0.5 text-[10px] text-white/40">N-1 : {fmt(ytdN1)}</div>
              </div>
            </div>
            <div className="mt-2">
              <CourbeAnnuelleChart points={points} color={color} estMarge={estMarge} />
            </div>
          </div>
        )}
      </CardShell>
    </div>
  );
}

// ── Pavé COMPTEUR ─────────────────────────────────────────────────────────
// "Clients actifs" (cle="clients_actifs") est agrandi (largeur doublée,
// chiffres plus gros) — les autres compteurs gardent le format compact.

const CA_BAND_ORDER = ["400K€", "150K€", "80K€", "20K€", "vide"] as const;

function CompteurCard({
  config, effectiveAgence, effectiveCollaborateur, refreshTick, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; effectiveCollaborateur: string | null; refreshTick: number; onRemove: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [bands, setBands] = useState<Record<string, number> | null>(null);

  const meta = COMPTEUR_OPTIONS.find((o) => o.cle === config.cle) || (config.cle === "clients_crees_n" ? { cle: "clients_crees_n", label: "Clients créés cette année", isAlerte: false } : undefined);
  const label = meta?.label || config.cle;
  const isAlerte = meta?.isAlerte ?? false;
  const [clientsCreesN, setClientsCreesN] = useState<number | null>(null);

  // FIX (2026-08) : "Clients actifs" doit rester lisible en un coup d'œil —
  // largeur doublée et chiffres agrandis, appliqué directement à ce pavé
  // existant (déterminé par sa clé, pas par une option à ressélectionner).
  const estClientsActifs = config.cle === "clients_actifs";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (config.cle === "clients_actifs") {
          const [actifsRes, creesRes] = await Promise.all([
            supabase.rpc("get_vision_tci_clients_actifs", { p_agence: effectiveAgence, p_collaborateur: effectiveCollaborateur }),
            supabase.rpc("get_vision_tci_clients_crees_n", { p_agence: effectiveAgence, p_collaborateur: effectiveCollaborateur }),
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
          const { data, error: err } = await supabase.rpc("get_vision_tci_clients_crees_n", { p_agence: effectiveAgence, p_collaborateur: effectiveCollaborateur });
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
          const { data, error: err } = await supabase.rpc("get_vision_tci_cdc_avant_2026", { p_agence: effectiveAgence, p_collaborateur: effectiveCollaborateur });
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
  }, [config.cle, effectiveAgence, effectiveCollaborateur, refreshTick]);

  function handleClick() {
    if (config.cle === "clients_actifs" || config.cle === "clients_crees_n") window.open("/synthese_multi_clients", "_blank", "noopener,noreferrer");
    else if (config.cle === "cerfa_ko") window.dispatchEvent(new CustomEvent("cegeclim:open-cerfa-ko"));
    else if (config.cle === "cdc_avant_2026") window.open("/portefeuille-livraison", "_blank", "noopener,noreferrer");
  }

  const isMontant = config.cle === "factures_retard";
  const valueColor = isAlerte ? ((total || 0) > 0 ? "#C1683C" : "#3F9142") : "#FFFFFF";

  return (
    <div className={estClientsActifs ? "col-span-4 sm:col-span-2" : "col-span-2 sm:col-span-1"}>
      <CardShell color="#A6A181" badgeLabel={label} onRemove={onRemove} onClick={config.cle !== "factures_retard" ? handleClick : undefined} compact={!estClientsActifs}>
        {loading ? (
          <div className={estClientsActifs ? "h-14 animate-pulse rounded bg-white/5" : "h-8 animate-pulse rounded bg-white/5"} />
        ) : error ? (
          <p className="text-[9px] text-red-300">{error}</p>
        ) : (
          <>
            <div
              className={`font-[var(--font-mono,monospace)] font-semibold ${estClientsActifs ? "text-5xl" : "text-lg"}`}
              style={{ color: valueColor }}
            >
              {isMontant ? formatMontant(total || 0) : (total ?? 0).toLocaleString("fr-FR")}
            </div>
            {config.cle === "clients_actifs" && clientsCreesN !== null && (
              <div className={`mt-1 text-white/50 ${estClientsActifs ? "text-sm" : "text-[9px]"}`}>
                dont <span className={`font-semibold text-white/80 ${estClientsActifs ? "text-base" : ""}`}>{clientsCreesN.toLocaleString("fr-FR")}</span> créés cette année
              </div>
            )}
            {bands && (
              <div className={`flex flex-wrap gap-1.5 ${estClientsActifs ? "mt-3" : "mt-1"}`}>
                {CA_BAND_ORDER.filter((b) => bands[b]).slice(0, 3).map((b) => (
                  <span
                    key={b}
                    className={`rounded bg-white/10 text-white/60 ${estClientsActifs ? "px-2.5 py-1 text-[12px]" : "px-1 py-0.5 text-[8px]"}`}
                  >
                    {b}:{bands[b]}
                  </span>
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
  config, effectiveAgence, effectiveCollaborateur, refreshTick, onRemove,
}: { config: KpiCardConfig; effectiveAgence: string | null; effectiveCollaborateur: string | null; refreshTick: number; onRemove: () => void }) {
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
        p_agence: effectiveAgence, p_collaborateur: effectiveCollaborateur,
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
  }, [effectiveAgence, effectiveCollaborateur, config.famille_macro, refreshTick]);

  return (
    <div className="col-span-2 sm:col-span-1">
      <CardShell color="#D69A4A" badgeLabel="Taux transfo devis" onRemove={onRemove} onClick={() => window.open("/cycle-documents", "_blank", "noopener,noreferrer")} clickHint="Ouvrir Analyse Devis" compact>
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
  const [grand, setGrand] = useState(false);

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

        {kind === "flux" && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white/80">
            <input type="checkbox" checked={grand} onChange={(e) => setGrand(e.target.checked)} className="h-3.5 w-3.5 accent-[#A6A181]" />
            Grand format (courbe annuelle)
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-xs text-white/60 hover:text-white">Annuler</button>
        <button
          onClick={() =>
            kind === "spacer"
              ? onAdd({ kind, cle: String(spacerSpan), famille_macro: null, agence: null })
              : onAdd({
                  kind,
                  cle,
                  famille_macro: kind === "flux" ? (familleMacro || null) : null,
                  agence: agenceForcee || agence || null,
                  grand: kind === "flux" ? grand : undefined,
                })
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
  const { rights, email: userEmail } = useAccess();
  const [cards, setCards] = useState<KpiCardConfig[]>([]);
  const [personnalise, setPersonnalise] = useState(false);
  const [famillesMacro, setFamillesMacro] = useState<string[]>([]);
  const [agencesDisponibles, setAgencesDisponibles] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [utiliserJMoins1, setUtiliserJMoins1] = useState(true);

  // Rafraîchissement périodique des valeurs — uniquement pendant que l'onglet
  // est visible. Rien ne se déclenche en arrière-plan : ça évite exactement
  // le désagrément inverse (rafraîchir alors que l'utilisateur ne regarde
  // pas l'écran). Toutes les 90s pendant que c'est affiché, sinon en pause.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    function start() {
      if (interval) return;
      interval = setInterval(() => setRefreshTick((t) => t + 1), 90_000);
    }
    function stop() {
      if (interval) { clearInterval(interval); interval = null; }
    }
    if (document.visibilityState === "visible") start();
    function handleVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Modèles nommés (réservé aux administrateurs, can_autorisation) — pour
  // enregistrer la disposition courante comme modèle affectable à un profil
  // depuis l'écran Autorisation.
  const [nomModele, setNomModele] = useState("");
  const [savingModele, setSavingModele] = useState(false);
  const [modeleMessage, setModeleMessage] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    const email = (userEmail || (await supabase.auth.getSession()).data.session?.user?.email || "").toLowerCase();
    if (!email) { setLoading(false); return; }

    const [{ data: prefsRow }, { data: effectiveCards }, { data: fams }, { data: agences }] = await Promise.all([
      supabase.from("vision_tci_preferences").select("kpi_cards, personnalise").eq("user_email", email).maybeSingle(),
      supabase.rpc("get_vision_tci_effective_layout", { p_email: email }),
      supabase.from("ref_familles").select("famille_macro"),
      supabase.from("ref_collaborateurs").select("agence"),
    ]);

    const raw = (effectiveCards as any[] | null) || [];
    const normalized: KpiCardConfig[] = raw.map((c) => ({
      id: c.id, kind: c.kind || "flux", cle: c.cle || c.famille || "BL",
      famille_macro: c.famille_macro ?? null, agence: c.agence ?? null,
      grand: Boolean(c.grand),
    }));
    setCards(normalized);
    setPersonnalise(Boolean(prefsRow?.personnalise));
    setFamillesMacro(Array.from(new Set(((fams || []) as Array<{ famille_macro: string | null }>).map((f) => f.famille_macro).filter((v): v is string => Boolean(v)))).sort());
    setAgencesDisponibles(Array.from(new Set(((agences || []) as Array<{ agence: string | null }>).map((a) => a.agence).filter((v): v is string => Boolean(v)))).sort());
    setLoading(false);
  }, [userEmail]);

  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  // Le panneau ne doit afficher le squelette qu'au tout premier chargement.
  // `access.loading` repasse brièvement à `true` à chaque revalidation de
  // session (notamment au retour de focus sur la fenêtre, cf. layout.tsx) —
  // sans ce garde, chaque flicker démonte puis remonte toute la grille de
  // cartes, ce qui relance TOUS les appels RPC de TOUTES les cartes alors
  // que rien n'a réellement changé. Une fois le premier affichage réussi,
  // on ignore les flickers suivants et on continue d'afficher les cartes
  // (elles gèrent déjà leur propre état de chargement individuellement).
  const hasLoadedOnceRef = useRef(false);
  useEffect(() => {
    if (!loading && !access.loading) hasLoadedOnceRef.current = true;
  });

  const agenceForcee = access.hasAgenceRestriction && access.allowedAgences.length > 0 ? access.allowedAgences[0] : null;
  // Un utilisateur peut être restreint sur l'agence ET le collaborateur en
  // même temps (cas courant : un commercial rattaché à une agence). Les deux
  // s'appliquent ensemble, jamais l'un au détriment de l'autre.
  const collaborateurForcee = access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0 ? access.allowedCollaborateurs[0] : null;

  function effectiveAgenceFor(card: KpiCardConfig): string | null {
    return agenceForcee || card.agence;
  }
  function effectiveCollaborateurFor(_card: KpiCardConfig): string | null {
    return collaborateurForcee;
  }

  // Toute modification manuelle rend la disposition "personnalisée" — elle
  // n'affecte plus jamais que cet utilisateur, même si son profil change
  // de disposition par défaut par la suite.
  async function persistCards(next: KpiCardConfig[]) {
    setCards(next);
    setPersonnalise(true);
    const email = (userEmail || (await supabase.auth.getSession()).data.session?.user?.email || "").toLowerCase();
    if (!email) return;
    await supabase.from("vision_tci_preferences").upsert({
      user_email: email, kpi_cards: next, personnalise: true, updated_at: new Date().toISOString(),
    });
  }

  async function revenirAuProfil() {
    const email = (userEmail || (await supabase.auth.getSession()).data.session?.user?.email || "").toLowerCase();
    if (!email) return;
    await supabase.from("vision_tci_preferences").upsert({
      user_email: email, kpi_cards: [], personnalise: false, updated_at: new Date().toISOString(),
    });
    await loadPrefs();
  }

  async function enregistrerCommeModele() {
    if (!nomModele.trim()) return;
    setSavingModele(true);
    setModeleMessage(null);
    const { error } = await supabase.from("vision_tci_layouts").upsert(
      { nom: nomModele.trim(), kpi_cards: cards, created_by: userEmail || null, updated_at: new Date().toISOString() },
      { onConflict: "nom" },
    );
    setSavingModele(false);
    setModeleMessage(error ? `Erreur : ${error.message}` : `Modèle "${nomModele.trim()}" enregistré — à affecter à un profil depuis Autorisation.`);
  }

  function handleAdd(c: Omit<KpiCardConfig, "id">) {
    setShowForm(false);
    void persistCards([...cards, { ...c, id: crypto.randomUUID() }]);
  }
  function handleRemove(id: string) {
    void persistCards(cards.filter((c) => c.id !== id));
  }

  if ((loading || access.loading) && !hasLoadedOnceRef.current) {
    return (
      <div>
        <h1 className="mb-3 text-xl font-bold text-white">Vision ONE PAGE</h1>
        <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="col-span-2 h-28 animate-pulse rounded-xl bg-white/5" />)}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-white">Vision ONE PAGE</h1>
          <div className="mt-1">
            <LastSyncBadge compact />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            title="Actualiser toutes les valeurs maintenant"
            className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/5 hover:text-white"
          >
            ↻ Actualiser
          </button>

          {/* Bascule Jour / J-1 : pilote tous les pavés flux compacts d'un
              coup (les pavés grand format affichent le cumul YTD, non
              concernés par cette bascule). */}
          <div className="flex items-center rounded-full border border-white/15 bg-white/5 p-0.5 text-xs">
            <button
              onClick={() => setUtiliserJMoins1(false)}
              className={`rounded-full px-2.5 py-1 font-semibold ${!utiliserJMoins1 ? "bg-[#A6A181] text-[#141A26]" : "text-white/50"}`}
            >
              Jour
            </button>
            <button
              onClick={() => setUtiliserJMoins1(true)}
              className={`rounded-full px-2.5 py-1 font-semibold ${utiliserJMoins1 ? "bg-[#A6A181] text-[#141A26]" : "text-white/50"}`}
            >
              J-1
            </button>
          </div>

          {personnalise && (
            <button
              onClick={() => void revenirAuProfil()}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/5 hover:text-white"
              title="Abandonner ma personnalisation et revenir à la disposition par défaut de mon profil"
            >
              ↺ Revenir à la disposition du profil
            </button>
          )}
          {!personnalise && (
            <span className="text-[11px] text-white/35">Disposition du profil (non personnalisée)</span>
          )}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-3">
        {cards.map((c) =>
          c.kind === "flux" ? (
            c.grand ? (
              <FluxCardGrand key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} effectiveCollaborateur={effectiveCollaborateurFor(c)} refreshTick={refreshTick} onRemove={() => handleRemove(c.id)} />
            ) : (
              <FluxCard key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} effectiveCollaborateur={effectiveCollaborateurFor(c)} utiliserJMoins1={utiliserJMoins1} refreshTick={refreshTick} onRemove={() => handleRemove(c.id)} />
            )
          ) : c.kind === "taux" ? (
            <TauxCard key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} effectiveCollaborateur={effectiveCollaborateurFor(c)} refreshTick={refreshTick} onRemove={() => handleRemove(c.id)} />
          ) : c.kind === "spacer" ? (
            <SpacerCard key={c.id} span={c.cle === "2" ? 2 : 1} onRemove={() => handleRemove(c.id)} />
          ) : (
            <CompteurCard key={c.id} config={c} effectiveAgence={effectiveAgenceFor(c)} effectiveCollaborateur={effectiveCollaborateurFor(c)} refreshTick={refreshTick} onRemove={() => handleRemove(c.id)} />
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

      {/* Réservé aux administrateurs (can_autorisation) : enregistrer la
          disposition courante comme modèle nommé, réutilisable comme
          disposition par défaut d'un profil depuis l'écran Autorisation.
          L'affectation elle-même (modèle → profil) se fait dans cet écran,
          pas ici — voir le composant fourni séparément à y intégrer. */}
      {rights?.can_autorisation && (
        <div className="mt-4 rounded-xl border border-[#A6A181]/25 bg-[#A6A181]/[0.05] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#A6A181]">
            Administrateur — enregistrer comme modèle nommé
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nomModele}
              onChange={(e) => setNomModele(e.target.value)}
              placeholder='Nom du modèle (ex. "TCI", "Direction", "Chef d&apos;agence")'
              className="min-w-[220px] flex-1 rounded border border-white/20 bg-[#141A26] px-2 py-1.5 text-xs text-white outline-none"
            />
            <button
              onClick={() => void enregistrerCommeModele()}
              disabled={savingModele || !nomModele.trim()}
              className="rounded bg-[#A6A181] px-3 py-1.5 text-xs font-semibold text-[#141A26] hover:brightness-110 disabled:opacity-50"
            >
              {savingModele ? "Enregistrement…" : "Enregistrer le modèle"}
            </button>
          </div>
          {modeleMessage && <p className="mt-1.5 text-[10px] text-white/60">{modeleMessage}</p>}
          <p className="mt-1.5 text-[10px] text-white/35">
            Enregistre la disposition actuelle (celle affichée ci-dessus) comme modèle réutilisable. L&rsquo;affectation
            à un profil se fait ensuite depuis Admin → Profils et autorisation.
          </p>
        </div>
      )}
    </div>
  );
}
