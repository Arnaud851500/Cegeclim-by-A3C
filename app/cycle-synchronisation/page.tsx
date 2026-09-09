'use client'

// Page "Fraîcheur des données" -- v2, organisée par écran/widget.
//
// Pour chaque widget (ou groupe de widgets) : une capture d'écran, la
// chaîne visuelle de sa mise à jour (source externe -> table de base ->
// cache agrégat, dans l'ordre), et la date de la DERNIÈRE étape (celle
// que le widget affiche réellement) mise en avant en gros. Une pastille
// rouge/orange apparaît dès qu'une étape amont est plus récente que
// l'étape que le widget consomme -- c'est le signal "widget pas à jour
// malgré des données de base fraîches" demandé.
//
// Les dates viennent de get_data_lineage_status() (déjà en place, ne pas
// modifier) ; le découpage par écran/widget et les images sont propres à
// cette page.
//
// À FAIRE CÔTÉ APP : copier le dossier widget-captures/ dans public/
// (ex. public/fraicheur-donnees/), pour que les chemins d'image ci-dessous
// résolvent correctement.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type LineageRow = {
  table_name: string
  category: 'source_externe' | 'table_base' | 'cache_agregat'
  label: string
  last_updated_at: string | null
  depends_on: string[]
  used_by: string[]
  description: string | null
  confidence: 'confirmee' | 'deduite'
}

type ChainStep = { table_name: string } | { placeholder: string; note: string }

type WidgetDef = {
  key: string
  screen: string
  title: string
  image: string
  chain: ChainStep[]
}

const IMG_BASE = '/fraicheur-donnees'

const WIDGETS: WidgetDef[] = [
  {
    key: 'vision-flux',
    screen: 'Vision ONE PAGE',
    title: 'Vision ONE PAGE — Flux BL / Factures / CDC / Devis',
    image: `${IMG_BASE}/vision_flux_grid.png`,
    chain: [
      { table_name: 'sage.activite_non_facturee' },
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
      { table_name: 'indicateur_activite_mensuel' },
      { table_name: 'indicateur_devis_mensuel' },
      { table_name: 'indicateur_factures_mensuel' },
    ],
  },
  {
    key: 'vision-clients-portefeuille',
    screen: 'Vision ONE PAGE',
    title: 'Vision ONE PAGE — Clients actifs / Portefeuille / Projection CA',
    image: `${IMG_BASE}/vision_clients_portefeuille_projection.png`,
    chain: [
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
      { table_name: 'synthese_multi_clients_cache' },
      { table_name: 'focus_mensuel_agency_control_cache_status' },
    ],
  },
  {
    key: 'focus-kpis',
    screen: 'Focus Mensuel',
    title: 'Focus Mensuel — Vue d\u2019ensemble (KPI jour/mois Devis/CDC/BL/Factures)',
    image: `${IMG_BASE}/focus_mensuel_kpis.png`,
    chain: [
      { placeholder: 'Lecture directe', note: 'get_focus_mensuel_daily_summary_metier lit ces tables en direct, sans cache -- borné à 1 mois pour rester performant.' },
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
    ],
  },
  {
    key: 'focus-cumul-blcdc',
    screen: 'Focus Mensuel',
    title: 'Focus Mensuel — Cumul BL / CDC depuis le 1er du mois',
    image: `${IMG_BASE}/focus_mensuel_cumul_blcdc.png`,
    chain: [
      { placeholder: 'Lecture directe', note: 'Même RPC que les KPI ci-dessus, pas de cache intermédiaire.' },
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
    ],
  },
  {
    key: 'focus-portefeuille-projection',
    screen: 'Focus Mensuel',
    title: 'Focus Mensuel — Portefeuille / Projection CA (tableaux compacts)',
    image: `${IMG_BASE}/focus_mensuel_portefeuille_projection.png`,
    chain: [
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
      { table_name: 'focus_mensuel_agency_control_cache_status' },
      { table_name: 'focus_mensuel_agency_activity_cache' },
    ],
  },
  {
    key: 'focus-rolling12',
    screen: 'Focus Mensuel',
    title: 'Focus Mensuel — Rolling 12 mois',
    image: `${IMG_BASE}/focus_mensuel_rolling12.png`,
    chain: [
      { placeholder: 'À confirmer', note: 'Cet onglet est en réalité dans Focus_mensuel2 (code non fourni) -- chaîne non câblée tant que le fichier n\u2019a pas été vu.' },
    ],
  },
  {
    key: 'focus-comparatif-famille',
    screen: 'Focus Mensuel',
    title: 'Focus Mensuel — Comparatif famille (MTD + YTD)',
    image: `${IMG_BASE}/focus_mensuel_comparatif_famille.png`,
    chain: [
      { placeholder: 'Cache non identifié', note: 'Alimenté par get_focus_mensuel_annual_tables_cached -- la table de cache exacte lue par cette RPC n\u2019a pas encore été identifiée dans le code.' },
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
    ],
  },
  {
    key: 'portefeuille-livraison',
    screen: 'Contrôle frais de port',
    title: 'Contrôle frais de port (Portefeuille de livraison)',
    image: `${IMG_BASE}/portefeuille_livraison.png`,
    chain: [
      { placeholder: 'Vues sans horodatage propre', note: 'v_portefeuille_livraison_lignes + mv_controle_frais_port_actions/_groupes -- pas de colonne de rafraîchissement propre, fraîcheur héritée de activite_lignes.' },
      { table_name: 'activite_lignes' },
    ],
  },
  {
    key: 'approvisionnements',
    screen: 'Approvisionnements & flux commerciaux',
    title: 'Approvisionnements & flux commerciaux',
    image: `${IMG_BASE}/approvisionnements_flux.png`,
    chain: [
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
      { table_name: 'indicateur_flux_articles_mensuel' },
    ],
  },
  {
    key: 'smc',
    screen: 'Synthèse multi-clients',
    title: 'Synthèse multi-clients — KPI + tableau',
    image: `${IMG_BASE}/smc_kpis.png`,
    chain: [
      { table_name: 'activite_lignes' },
      { table_name: 'devis_lignes' },
      { table_name: 'facture_lignes' },
      { table_name: 'ref_tiers' },
      { table_name: 'synthese_multi_clients_cache' },
    ],
  },
]

function formatDateHeure(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ecouleDepuis(iso: string | null) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const heures = diffMs / 3_600_000
  if (heures < 1) return `il y a ${Math.max(1, Math.round(diffMs / 60_000))} min`
  if (heures < 48) return `il y a ${Math.round(heures)} h`
  return `il y a ${Math.round(heures / 24)} j`
}

export default function FraicheurDonneesParEcranPage() {
  const [rows, setRows] = useState<LineageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string>('')

  async function charger() {
    setError(null)
    const { data, error: err } = await supabase.rpc('get_data_lineage_status')
    if (err) {
      setError(err.message)
      return
    }
    setRows((data || []) as LineageRow[])
    setCheckedAt(new Date().toISOString())
  }

  useEffect(() => {
    void charger()
  }, [])

  const byName = useMemo(() => {
    const map = new Map<string, LineageRow>()
    ;(rows || []).forEach((r) => map.set(r.table_name, r))
    return map
  }, [rows])

  return (
    <div style={{ padding: '24px 20px', background: '#0B1220', minHeight: '100vh', color: '#fff', fontFamily: 'var(--font-sans, sans-serif)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Fraîcheur des données — par écran</h1>
        <button
          onClick={() => void charger()}
          style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)', padding: '6px 14px', fontSize: 12.5 }}
        >
          ↻ Actualiser
        </button>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 2, marginBottom: 20 }}>
        Chaque bloc : capture de l&rsquo;écran réel, puis la chaîne de mise à jour de la source jusqu&rsquo;à ce que ce widget affiche. Vérifié {checkedAt ? ecouleDepuis(checkedAt) : ''}.
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, fontSize: 12.5, color: 'rgba(255,255,255,0.55)', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#3F9142', marginRight: 6 }} />widget à jour</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#C1683C', marginRight: 6 }} />widget en retard sur une étape amont</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', marginRight: 6 }} />chaîne non confirmée</span>
      </div>

      {error && <div style={{ color: '#e0a685', marginBottom: 16 }}>Erreur de chargement : {error}</div>}
      {!rows && !error && <div style={{ color: 'rgba(255,255,255,0.4)' }}>Chargement…</div>}

      {rows && WIDGETS.map((widget) => {
        const steps = widget.chain
        const tableSteps = steps.filter((s): s is { table_name: string } => 'table_name' in s)
        const resolved = tableSteps.map((s) => byName.get(s.table_name)).filter((r): r is LineageRow => Boolean(r))
        const hasUnconfirmedStep = steps.some((s) => 'placeholder' in s) || resolved.length !== tableSteps.length
        const finalStep = resolved[resolved.length - 1] || null
        const upstreamMax = resolved.slice(0, -1).reduce<number>((max, r) => {
          const t = r.last_updated_at ? new Date(r.last_updated_at).getTime() : 0
          return Math.max(max, t)
        }, 0)
        const finalTime = finalStep?.last_updated_at ? new Date(finalStep.last_updated_at).getTime() : 0
        const statut: 'ok' | 'retard' | 'inconnu' = !finalStep || !finalStep.last_updated_at
          ? 'inconnu'
          : upstreamMax > finalTime + 60_000
            ? 'retard'
            : 'ok'
        const dotColor = statut === 'ok' ? '#3F9142' : statut === 'retard' ? '#C1683C' : 'rgba(255,255,255,0.25)'

        return (
          <div key={widget.key} style={{ marginBottom: 36, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span aria-hidden style={{ width: 11, height: 11, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{widget.title}</span>
              {finalStep && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 15, fontWeight: 700 }}>{formatDateHeure(finalStep.last_updated_at)}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>{ecouleDepuis(finalStep.last_updated_at)}</div>
                </div>
              )}
            </div>

            <div style={{ padding: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={widget.image}
                alt={widget.title}
                style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', display: 'block', marginBottom: 14 }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {steps.map((step, idx) => {
                  const isLast = idx === steps.length - 1
                  const isPlaceholder = 'placeholder' in step
                  const row = !isPlaceholder ? byName.get((step as { table_name: string }).table_name) : null
                  const stepDot = isPlaceholder || !row ? 'rgba(255,255,255,0.25)' : '#3F9142'
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <div
                        title={isPlaceholder ? (step as { note: string }).note : row?.description || undefined}
                        style={{
                          borderRadius: 10,
                          border: `1px solid ${isLast ? 'rgba(230,159,74,0.5)' : 'rgba(255,255,255,0.12)'}`,
                          background: isLast ? 'rgba(230,159,74,0.08)' : 'rgba(255,255,255,0.03)',
                          padding: '8px 12px',
                          minWidth: 150,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: stepDot, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600 }}>
                            {isPlaceholder ? (step as { placeholder: string }).placeholder : row?.label || (step as { table_name: string }).table_name}
                          </span>
                        </div>
                        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>
                          {isPlaceholder ? 'à confirmer' : formatDateHeure(row?.last_updated_at || null)}
                        </div>
                      </div>
                      {!isLast && <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>→</span>}
                    </div>
                  )
                })}
              </div>

              {hasUnconfirmedStep && (
                <div style={{ marginTop: 10, fontSize: 11, color: '#E8A96A' }}>
                  ⚠ Chaîne partiellement non confirmée — voir l&rsquo;info-bulle des étapes grises.
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
