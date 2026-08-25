'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Deux cartes à intégrer dans MobileActivite.tsx, juste après les cartes
// Devis/CDC/BL/Factures/Marge existantes :
//
// - "Portefeuille de commandes" : reprend get_focus_mensuel_agency_control_
//   cached / get_focus_mensuel_famille_control_cached (mêmes fonctions que
//   le tableau desktop "Portefeuille de commandes par agence").
// - "Projection CA du mois" : mêmes fonctions, colonnes projection_ca /
//   ca_n1 / evol_pct (mêmes chiffres que "Projection du CA par agence").
//
// Cliquer sur une carte ouvre une fenêtre flottante avec :
//   1. Un graphique cumulé depuis le 1er janvier vs N-1 (get_focus_mensuel_
//      cumul_journalier, léger -- une ligne par jour, pas le détail brut).
//   2. Une bascule "Par agence" / "Par famille macro" pour le tableau de
//      détail en dessous (mêmes deux fonctions RPC que ci-dessus, appelées
//      une fois -- elles renvoient déjà toutes les lignes groupées, pas
//      besoin d'un appel par ligne comme pour les widgets Devis/CDC/BL/...).
//
// Reprend telles quelles les conventions déjà en place dans
// MobileActivite.tsx : cache localStorage, palette de couleurs, structure
// de la fenêtre flottante (BreakdownModal).
//
// CORRECTIF (utilisateurs restreints par agence SEULE, sans collaborateur
// -- ex. l.paroutot/BRIVE, v.voukotitch/LA ROCHELLE) : chargerLignesControle
// forçait `p_agence: null` dès que mode === 'agence', quel que soit
// agenceForcee. Or PortefeuilleCommandesCard et ProjectionCaCard appellent
// TOUJOURS chargerLignesControle('agence', ...) pour leur résumé -- ce
// `null` forcé annulait donc systématiquement la restriction d'agence pour
// ces deux cartes, renvoyant le total TOUTE L'ENTREPRISE au lieu du
// périmètre de l'utilisateur. Un utilisateur ayant AUSSI une restriction
// de collaborateur (ex. d.mena) ne voyait pas le problème : p_collaborateur
// continuait de filtrer correctement en parallèle, masquant le bug d'agence.
//
// Le `null` forcé n'a de sens que dans la fenêtre flottante, en vue
// "Par agence" (énumérer TOUTES les agences pour les lister) -- et ce mode
// n'est de toute façon accessible que quand agenceForcee est déjà null
// (bouton désactivé sinon, via canGroupByAgence = !agenceForcee, plus bas).
// Il est donc toujours correct de transmettre agenceForcee tel quel, sans
// jamais le forcer à null : redondant là où l'ancien code était correct
// (vue "Par agence" avec agenceForcee déjà null), et réparateur partout
// ailleurs (cartes de résumé, vue "Par famille macro" avec une agence
// imposée).
// ─────────────────────────────────────────────────────────────────────────

const COULEUR_PORTEFEUILLE = '#C1683C' // même orange/brun que CDC ailleurs dans l'appli
const COULEUR_PROJECTION = '#3F9142' // même vert que Factures ailleurs dans l'appli
const COULEUR_BL = '#4B92AC'

type LigneControle = {
  label: string
  cdc: number
  cdc_liv_mx: number
  pl: number
  pl_liv_mplus: number
  blbr_mx: number
  blbr_m: number
  total: number
  factures: number
  projection_flux_bl: number
  valeur_bl_nf_4pct: number
  projection_ca: number
  ca_n1: number
  evol_pct: number | null
}

type Vue = 'portefeuille' | 'projection'
type ModeGroupe = 'agence' | 'famille'

function formatMontant(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€`
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} K€`
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
}
function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

const CACHE_PREFIX = 'cegeclim:mobilePortefeuille:'
function loadCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function saveCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Stockage indisponible (navigation privée, quota...) : tant pis, pas de cache.
  }
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoDaysAgo(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function debutAnneeIso(annee: number) {
  return `${annee}-01-01`
}

// ── Chargement + agrégation des lignes de contrôle (agence ou famille) ────

async function chargerLignesControle(mode: ModeGroupe, agenceForcee: string | null, collaborateurForcee: string | null): Promise<LigneControle[]> {
  const rpcName = mode === 'agence' ? 'get_focus_mensuel_agency_control_cached' : 'get_focus_mensuel_famille_control_cached'
  const { data, error } = await supabase.rpc(rpcName, {
    p_focus_date: isoToday(),
    p_month: null,
    // CORRECTIF : ne plus jamais forcer null ici -- voir le commentaire en
    // tête de fichier. agenceForcee reflète déjà la restriction réelle de
    // l'utilisateur (ou null s'il n'en a pas), dans tous les cas d'usage.
    p_agence: agenceForcee,
    p_famille_macro: null,
    p_collaborateur: collaborateurForcee,
    p_include_hors_statistiques: true,
  })
  if (error) {
    console.error(`[MobilePortefeuilleWidgets] ${rpcName}`, error)
    return []
  }
  return (data || []) as LigneControle[]
}

function sommerLignes(lignes: LigneControle[]) {
  const total = lignes.reduce(
    (acc, l) => {
      acc.cdc += Number(l.cdc) || 0
      acc.pl += Number(l.pl) || 0
      acc.blbr_mx += Number(l.blbr_mx) || 0
      acc.blbr_m += Number(l.blbr_m) || 0
      acc.total += Number(l.total) || 0
      acc.projection_ca += Number(l.projection_ca) || 0
      acc.ca_n1 += Number(l.ca_n1) || 0
      acc.projection_flux_bl += Number(l.projection_flux_bl) || 0
      return acc
    },
    { cdc: 0, pl: 0, blbr_mx: 0, blbr_m: 0, total: 0, projection_ca: 0, ca_n1: 0, projection_flux_bl: 0 },
  )
  const evol_pct = total.ca_n1 ? ((total.projection_ca - total.ca_n1) / Math.abs(total.ca_n1)) * 100 : null
  return { ...total, evol_pct }
}

// ── Cartes ──────────────────────────────────────────────────────────────

export function PortefeuilleCommandesCard({
  agenceForcee, collaborateurForcee, onOpen,
}: { agenceForcee: string | null; collaborateurForcee: string | null; onOpen: () => void }) {
  const [resume, setResume] = useState<ReturnType<typeof sommerLignes> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const cacheKey = `${CACHE_PREFIX}resume:portefeuille:${agenceForcee || ''}:${collaborateurForcee || ''}`
    const cached = loadCache<ReturnType<typeof sommerLignes>>(cacheKey)
    if (cached) { setResume(cached); setLoading(false) }

    async function load() {
      const lignes = await chargerLignesControle('agence', agenceForcee, collaborateurForcee)
      if (cancelled) return
      const s = sommerLignes(lignes)
      setResume(s)
      saveCache(cacheKey, s)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [agenceForcee, collaborateurForcee])

  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: 'left', borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)', padding: '14px 14px 12px', width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span
          style={{
            display: 'inline-block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            color: COULEUR_PORTEFEUILLE, background: `${COULEUR_PORTEFEUILLE}22`, borderRadius: 6, padding: '3px 8px',
          }}
        >
          Portefeuille
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Détail ›</span>
      </div>

      {loading || !resume ? (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          <MiniStat label="Total" value={formatMontant(resume.total)} />
          <MiniStat label="CDC" value={formatMontant(resume.cdc)} />
          <MiniStat label="PL" value={formatMontant(resume.pl)} />
          <MiniStat label="BL/BR" value={formatMontant(resume.blbr_mx + resume.blbr_m)} />
        </div>
      )}
    </button>
  )
}

export function ProjectionCaCard({
  agenceForcee, collaborateurForcee, onOpen,
}: { agenceForcee: string | null; collaborateurForcee: string | null; onOpen: () => void }) {
  const [resume, setResume] = useState<ReturnType<typeof sommerLignes> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const cacheKey = `${CACHE_PREFIX}resume:projection:${agenceForcee || ''}:${collaborateurForcee || ''}`
    const cached = loadCache<ReturnType<typeof sommerLignes>>(cacheKey)
    if (cached) { setResume(cached); setLoading(false) }

    async function load() {
      const lignes = await chargerLignesControle('agence', agenceForcee, collaborateurForcee)
      if (cancelled) return
      const s = sommerLignes(lignes)
      setResume(s)
      saveCache(cacheKey, s)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [agenceForcee, collaborateurForcee])

  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: 'left', borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)', padding: '14px 14px 12px', width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span
          style={{
            display: 'inline-block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            color: COULEUR_PROJECTION, background: `${COULEUR_PROJECTION}22`, borderRadius: 6, padding: '3px 8px',
          }}
        >
          Projection CA du mois
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Détail ›</span>
      </div>

      {loading || !resume ? (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <MiniStat label="CA projeté" value={formatMontant(resume.projection_ca)} />
          <MiniStat label="CA N-1" value={formatMontant(resume.ca_n1)} />
          <MiniStat label="Évol." value={formatPct(resume.evol_pct)} accent={resume.evol_pct !== null ? (resume.evol_pct >= 0 ? '#8fd4a8' : '#e0a685') : undefined} />
        </div>
      )}
    </button>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 600, color: accent || '#fff', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  )
}

// ── Fenêtre flottante commune (Portefeuille ou Projection) ────────────────

export function PortefeuilleProjectionModal({
  vue, agenceForcee, collaborateurForcee, famillesMacro, agences, onClose,
}: {
  vue: Vue
  agenceForcee: string | null
  collaborateurForcee: string | null
  famillesMacro: string[]
  agences: string[]
  onClose: () => void
}) {
  const [modeGroupe, setModeGroupe] = useState<ModeGroupe>('agence')
  const [lignes, setLignes] = useState<LigneControle[] | null>(null)
  const [loadingLignes, setLoadingLignes] = useState(true)
  const [refreshingLignes, setRefreshingLignes] = useState(false)

  const canGroupByAgence = !agenceForcee
  const modeEffectif: ModeGroupe = modeGroupe === 'agence' && !canGroupByAgence ? 'famille' : modeGroupe

  const color = vue === 'portefeuille' ? COULEUR_PORTEFEUILLE : COULEUR_PROJECTION
  const titre = vue === 'portefeuille' ? 'Portefeuille de commandes' : 'Projection CA du mois'

  useEffect(() => {
    let cancelled = false
    const cacheKey = `${CACHE_PREFIX}table:${vue}:${modeEffectif}:${agenceForcee || ''}:${collaborateurForcee || ''}`
    const cached = loadCache<LigneControle[]>(cacheKey)
    if (cached) { setLignes(cached); setLoadingLignes(false); setRefreshingLignes(true) } else { setLoadingLignes(true) }

    async function load() {
      const data = await chargerLignesControle(modeEffectif, agenceForcee, collaborateurForcee)
      if (cancelled) return
      setLignes(data)
      saveCache(cacheKey, data)
      setLoadingLignes(false)
      setRefreshingLignes(false)
    }
    void load()
    return () => { cancelled = true }
  }, [vue, modeEffectif, agenceForcee, collaborateurForcee])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '12px auto 10px', flexShrink: 0 }} />

        <div style={{ padding: '0 18px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                display: 'inline-block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                color, background: `${color}22`, borderRadius: 6, padding: '4px 9px',
              }}
            >
              {titre}
            </span>
            <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none' }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'inline-flex', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', padding: 2, marginBottom: 10 }}>
              <button
                onClick={() => setModeGroupe('agence')}
                disabled={!canGroupByAgence}
                style={{
                  borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
                  background: modeEffectif === 'agence' ? '#A6A181' : 'transparent',
                  color: modeEffectif === 'agence' ? '#141A26' : 'rgba(255,255,255,0.55)',
                  opacity: canGroupByAgence ? 1 : 0.4,
                }}
              >
                Par agence
              </button>
              <button
                onClick={() => setModeGroupe('famille')}
                style={{
                  borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
                  background: modeEffectif === 'famille' ? '#A6A181' : 'transparent',
                  color: modeEffectif === 'famille' ? '#141A26' : 'rgba(255,255,255,0.55)',
                }}
              >
                Par famille macro
              </button>
            </div>

            {refreshingLignes && (
              <div style={{ marginBottom: 8, fontSize: 10.5, fontWeight: 700, color: '#FF3B30' }}>Actualisation…</div>
            )}

            {loadingLignes ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>Chargement…</div>
            ) : !lignes || lignes.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>Aucune donnée sur ce périmètre.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lignes.map((l) => (
                  <div key={l.label} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{l.label}</div>
                    {vue === 'portefeuille' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                        <MiniStat label="Total" value={formatMontant(l.total)} />
                        <MiniStat label="CDC" value={formatMontant(l.cdc)} />
                        <MiniStat label="PL" value={formatMontant(l.pl)} />
                        <MiniStat label="BL/BR" value={formatMontant(l.blbr_mx + l.blbr_m)} />
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                        <MiniStat label="CA projeté" value={formatMontant(l.projection_ca)} />
                        <MiniStat label="CA N-1" value={formatMontant(l.ca_n1)} />
                        <MiniStat label="Évol." value={formatPct(l.evol_pct)} accent={l.evol_pct !== null ? (l.evol_pct >= 0 ? '#8fd4a8' : '#e0a685') : undefined} />
                        <MiniStat label="BL à venir" value={formatMontant(l.projection_flux_bl)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
