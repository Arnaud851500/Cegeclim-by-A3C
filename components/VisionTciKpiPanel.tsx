"use client";

/**
 * VisionTciKpiPanel
 * ------------------------------------------------------------------------
 * Pavés KPI configurables du mockup "Vision One page TCI" (colonne de
 * gauche). Un utilisateur choisit, via "+ Ajouter un KPI", une famille (BL,
 * Devis, CDC, Facturation, Marge) et optionnellement une famille macro —
 * chaque pavé affiche alors Jour / Mois / Année vs N-1, dans le style de
 * Focus Mensuel V3 (cf. capture de référence fournie).
 *
 * Filtrage agence/représentant : suit automatiquement les habilitations de
 * l'utilisateur connecté (user_page_access.allowed_agences /
 * allowed_collaborateurs) — un pavé ne peut jamais afficher plus de données
 * que ce que l'utilisateur est déjà autorisé à voir ailleurs dans l'appli.
 *
 * ⚠️ COULEURS PROVISOIRES : BL/Devis/CDC/Facturation/Marge ci-dessous
 * (FOCUS_MENSUEL_COLORS) sont des couleurs plausibles, PAS encore calées
 * sur l'écran Focus Mensuel V3 réel (je n'ai pas ce fichier). Un seul
 * endroit à corriger une fois les vraies couleurs connues.
 *
 * Persistance : table vision_tci_preferences (kpi_cards jsonb), une ligne
 * par utilisateur — les pavés choisis sont donc retrouvés à chaque visite,
 * sur n'importe quel appareil.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ⚠️ BL/Devis/CDC/Factures : PROVISOIRE, à remplacer par DOC_COLORS de
// app/focus_mensuel/page.tsx (pas pu le vérifier — colle-moi cet export et
// je corrige en une fois). Marge : hors périmètre de Focus Mensuel, pas de
// couleur de référence existante — couleur libre en attendant ton avis.
export const FOCUS_MENSUEL_COLORS: Record<string, string> = {
  BL: "#4B92AC",
  Devis: "#D69A4A",
  CDC: "#7A5EA8",
  Factures: "#3F9142",
  Marge: "#C1683C",
};

const FAMILLES_KPI = ["BL", "Devis", "CDC", "Factures", "Marge"] as const;
type FamilleKpi = (typeof FAMILLES_KPI)[number];

type KpiCardConfig = {
  id: string;
  famille: FamilleKpi;
  famille_macro: string | null;
  agence: string | null;
};

type KpiValues = {
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

function EvolBadge({ valeur, n1 }: { valeur: number; n1: number }) {
  if (n1 === 0) return <span className="text-white/30 text-[10px]">—</span>;
  const pct = ((valeur - n1) / Math.abs(n1)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-[10px] font-medium ${up ? "text-emerald-400" : "text-orange-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% vs N-1
    </span>
  );
}

function KpiCard({ config, onRemove }: { config: KpiCardConfig; onRemove: () => void }) {
  const [values, setValues] = useState<KpiValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const color = FOCUS_MENSUEL_COLORS[config.famille] || "#4B92AC";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.rpc("get_vision_tci_kpi", {
        p_famille: config.famille,
        p_famille_macro: config.famille_macro,
        p_agence: config.agence,
        p_collaborateur: null,
      });
      if (cancelled) return;
      if (err) {
        setError(err.message);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setValues(row as KpiValues);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [config.famille, config.famille_macro, config.agence]);

  return (
    <div className="relative rounded-xl border border-white/10 bg-[#141A26] p-3" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <button
        onClick={onRemove}
        title="Retirer ce KPI"
        className="absolute right-2 top-2 text-white/25 hover:text-white/70"
      >
        ✕
      </button>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-[#141A26]" style={{ background: color }}>
          {config.famille}
        </span>
        {config.famille_macro && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">Fam : {config.famille_macro}</span>
        )}
        {config.agence && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">{config.agence}</span>
        )}
      </div>

      {loading ? (
        <div className="h-16 animate-pulse rounded bg-white/5" />
      ) : error ? (
        <p className="text-[10px] text-red-300">{error}</p>
      ) : values ? (
        <div className="grid grid-cols-3 gap-2 text-white">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-white/40">Jour</div>
            <div className="font-[var(--font-mono,monospace)] text-sm font-semibold">{formatMontant(values.jour_valeur)}</div>
            <EvolBadge valeur={values.jour_valeur} n1={values.jour_n1} />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-white/40">Mois</div>
            <div className="font-[var(--font-mono,monospace)] text-sm font-semibold">{formatMontant(values.mois_valeur)}</div>
            <EvolBadge valeur={values.mois_valeur} n1={values.mois_n1} />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-white/40">Année</div>
            <div className="font-[var(--font-mono,monospace)] text-sm font-semibold">{formatMontant(values.annee_valeur)}</div>
            <EvolBadge valeur={values.annee_valeur} n1={values.annee_n1} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AjouterKpiForm({
  famillesMacro,
  agencesAutorisees,
  onAdd,
  onCancel,
}: {
  famillesMacro: string[];
  agencesAutorisees: string[] | null; // null = pas de restriction (voit tout)
  onAdd: (c: Omit<KpiCardConfig, "id">) => void;
  onCancel: () => void;
}) {
  const [famille, setFamille] = useState<FamilleKpi>("BL");
  const [familleMacro, setFamilleMacro] = useState<string>("");
  const [agence, setAgence] = useState<string>("");

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select value={famille} onChange={(e) => setFamille(e.target.value as FamilleKpi)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
          {FAMILLES_KPI.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select value={familleMacro} onChange={(e) => setFamilleMacro(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
          <option value="">Toutes familles</option>
          {famillesMacro.map((fm) => (
            <option key={fm} value={fm}>{fm}</option>
          ))}
        </select>
        {(agencesAutorisees === null || agencesAutorisees.length > 1) && (
          <select value={agence} onChange={(e) => setAgence(e.target.value)} className="rounded border border-white/20 bg-[#141A26] px-2 py-1 text-xs text-white">
            <option value="">Toutes agences autorisées</option>
            {(agencesAutorisees ?? []).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1 text-xs text-white/60 hover:text-white">Annuler</button>
        <button
          onClick={() => onAdd({ famille, famille_macro: familleMacro || null, agence: agence || null })}
          className="rounded bg-white/20 px-3 py-1 text-xs font-semibold text-white hover:bg-white/30"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

export default function VisionTciKpiPanel() {
  const [cards, setCards] = useState<KpiCardConfig[]>([]);
  const [famillesMacro, setFamillesMacro] = useState<string[]>([]);
  const [agencesAutorisees, setAgencesAutorisees] = useState<string[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) {
      setLoading(false);
      return;
    }

    const [{ data: prefs }, { data: acces }, { data: fams }] = await Promise.all([
      supabase.from("vision_tci_preferences").select("kpi_cards").eq("user_email", email).maybeSingle(),
      supabase.from("user_page_access").select("allowed_agences, can_change_scope").eq("email", email).maybeSingle(),
      supabase.from("ref_familles").select("famille_macro"),
    ]);

    setCards(((prefs?.kpi_cards as KpiCardConfig[] | null) || []));
    // allowed_agences vide/absent + can_change_scope => pas de restriction connue (null = tout afficher)
    const allowed = acces?.allowed_agences as string[] | null | undefined;
    setAgencesAutorisees(allowed && allowed.length > 0 ? allowed : null);
    setFamillesMacro(Array.from(new Set(((fams || []) as Array<{ famille_macro: string | null }>).map((f) => f.famille_macro).filter((v): v is string => Boolean(v)))).sort());
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  async function persistCards(next: KpiCardConfig[]) {
    setCards(next);
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email?.toLowerCase();
    if (!email) return;
    await supabase.from("vision_tci_preferences").upsert({
      user_email: email,
      kpi_cards: next,
      updated_at: new Date().toISOString(),
    });
  }

  function handleAdd(c: Omit<KpiCardConfig, "id">) {
    const next = [...cards, { ...c, id: crypto.randomUUID() }];
    setShowForm(false);
    void persistCards(next);
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
        {cards.map((c) => (
          <KpiCard key={c.id} config={c} onRemove={() => handleRemove(c.id)} />
        ))}
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
