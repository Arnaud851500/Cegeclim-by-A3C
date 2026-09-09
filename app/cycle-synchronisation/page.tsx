'use client'

// Page "Fraîcheur des données" -- v3.
//
// Changements vs v2 :
//  - BL / Factures / CDC / Devis (Vision ONE PAGE) séparés en 4 cartes
//    distinctes, chacune avec SA propre chaîne réelle -- évite la fausse
//    impression d'une chaîne linéaire unique où devis_lignes/facture_lignes
//    semblaient "en aval" de activite_lignes alors qu'ils sont des racines
//    indépendantes.
//  - Détection de RÉGRESSION par étape : chaque étape de la chaîne est
//    comparée à la plus récente des étapes qui la PRÉCÈDENT (pas
//    seulement à l'étape finale) -- une étape plus vieille que ce qui la
//    précède s'allume immédiatement en orange, avec sa date affichée en
//    clair. C'est ce qui permet de repérer en un coup d'oeil un maillon
//    resté en retard au milieu de la chaîne (ex. un indicateur mensuel pas
//    reconstruit alors que sa table source, elle, l'a été).
//  - Captures redimensionnées plus petites (largeur max 380px).
//
// Les dates viennent de get_data_lineage_status() (inchangée). Le
// découpage par widget et les images sont propres à cette page.
//
// À FAIRE CÔTÉ APP : copier widget-captures/ dans public/fraicheur-donnees/.

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
const IMAGE_MAX_WIDTH = 380

const WIDGETS: WidgetDef[] = [
  {
    key: 'vision-bl',
    screen: 'Vision ONE PAGE',
    title: 'Vision ONE PAGE — BL',
    image: `${IMG_BASE}/vision_bl.png`,
    chain: [
      { table_name: 'sage.activite_non_facturee' },
      { table_name: 'activite_lignes' },
      { table_name: 'indicateur_activite_mensuel' },
    ],
  },
  {
    key: 'vision-factures',
    screen: 'Vision ONE PAGE',
    title: 'Vision ONE PAGE — Factures',
    image: `${IMG_BASE}/vision_factures.png`,
    chain: [
      { table_name: 'facture_lignes' },
      { table_name: 'indicateur_factures_mensuel' },
    ],
  },
  {
    key: 'vision-cdc',
    screen: 'Vision ONE PAGE',
    title: 'Vision ONE PAGE — CDC',
    image: `${IMG_BASE}/vision_cdc.png`,
    chain: [
      { table_name: 'sage.activite_non_facturee' },
      { table_name: 'activite_lignes' },
      { table_name: 'indicateur_activite_mensuel' },
    ],
  },
  {
    key: 'vision-devis',
    screen: 'Vision ONE PAGE',
    title: 'Vision ONE PAGE — Devis',
    image: `${IMG_BASE}/vision_devis.png`,
    chain: [
      { table_name: 'devis_lignes' },
      { table_name: 'indicateur_devis_mensuel' },
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
    title: 'Focus Mensuel — Vue d\u2019ensemble (KPI jour/mois)',
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
    title: 'Focus Mensuel — Cumul BL / CDC',
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
    title: 'Focus Mensuel — Portefeuille / Projection CA',
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
      { placeholder: 'À confirmer', note: 'En réalité dans Focus_mensuel2 (code non fourni) -- chaîne non câblée.' },
    ],
  },
  {
    key: 'focus-comparatif-famille',
    screen: 'Focus Mensuel',
    title: 'Focus Mensuel — Comparatif famille',
    image: `${IMG_BASE}/focus_mensuel_comparatif_famille.png`,
    chain: [
      { placeholder: 'Cache non identifié', note: 'get_focus_mensuel_annual_tables_cached -- table de cache exacte non identifiée.' },
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
      { placeholder: 'Vues sans horodatage propre', note: 'v_portefeuille_livraison_lignes + mv_controle_frais_port_* -- fraîcheur héritée de activite_lignes.' },
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

// Tolérance : deux étapes à moins de 60s d'écart ne sont pas considérées
// comme "en régression" (évite le bruit sur des synchros quasi simultanées).
const TOLERANCE_MS = 60_000

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
        Chaque bloc : capture réelle du widget, puis sa chaîne de mise à jour. Une étape s&rsquo;allume en orange dès qu&rsquo;elle est plus ancienne qu&rsquo;une étape qui la précède -- c&rsquo;est le maillon resté en retard. Vérifié {checkedAt ? ecouleDepuis(checkedAt) : ''}.
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, fontSize: 12.5, color: 'rgba(255,255,255,0.55)', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#3F9142', marginRight: 6 }} />étape cohérente</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#C1683C', marginRight: 6 }} />étape en régression (plus vieille qu&rsquo;une étape précédente)</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', marginRight: 6 }} />non confirmée</span>
      </div>

      {error && <div style={{ color: '#e0a685', marginBottom: 16 }}>Erreur de chargement : {error}</div>}
      {!rows && !error && <div style={{ color: 'rgba(255,255,255,0.4)' }}>Chargement…</div>}

      {rows && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 20 }}>
          {WIDGETS.map((widget) => {
            const steps = widget.chain
            let maxSoFar = 0
            const stepStates = steps.map((step) => {
              const isPlaceholder = 'placeholder' in step
              const row = !isPlaceholder ? byName.get((step as { table_name: string }).table_name) : null
              const time = row?.last_updated_at ? new Date(row.last_updated_at).getTime() : 0
              const isRegression = !isPlaceholder && row?.last_updated_at && time < maxSoFar - TOLERANCE_MS
              if (time > maxSoFar) maxSoFar = time
              return { step, isPlaceholder, row, isRegression }
            })

            const hasUnconfirmed = stepStates.some((s) => s.isPlaceholder || !s.row)
            const hasRegression = stepStates.some((s) => s.isRegression)
            const finalState = stepStates[stepStates.length - 1]
            const overallDot = hasRegression ? '#C1683C' : hasUnconfirmed ? 'rgba(255,255,255,0.25)' : '#3F9142'

            return (
              <div key={widget.key} style={{ borderRadius: 16, border: `1px solid ${hasRegression ? 'rgba(193,104,60,0.4)' : 'rgba(255,255,255,0.08)'}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: overallDot, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{widget.title}</span>
                  {finalState?.row && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, fontWeight: 700 }}>{formatDateHeure(finalState.row.last_updated_at)}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{ecouleDepuis(finalState.row.last_updated_at)}</div>
                    </div>
                  )}
                </div>

                <div style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={widget.image}
                      alt={widget.title}
                      style={{ width: '100%', maxWidth: IMAGE_MAX_WIDTH, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', display: 'block' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {stepStates.map((s, idx) => {
                      const dot = s.isRegression ? '#C1683C' : s.isPlaceholder || !s.row ? 'rgba(255,255,255,0.25)' : '#3F9142'
                      const label = s.isPlaceholder ? (s.step as { placeholder: string }).placeholder : s.row?.label || (s.step as { table_name: string }).table_name
                      const dateText = s.isPlaceholder ? 'à confirmer' : formatDateHeure(s.row?.last_updated_at || null)
                      return (
                        <div
                          key={idx}
                          title={s.isPlaceholder ? (s.step as { note: string }).note : s.row?.description || undefined}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            borderRadius: 8,
                            border: `1px solid ${s.isRegression ? 'rgba(193,104,60,0.5)' : 'rgba(255,255,255,0.08)'}`,
                            background: s.isRegression ? 'rgba(193,104,60,0.1)' : 'rgba(255,255,255,0.02)',
                            padding: '6px 10px',
                          }}
                        >
                          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1 }}>{label}</span>
                          <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono, monospace)', color: s.isRegression ? '#E8A96A' : 'rgba(255,255,255,0.45)' }}>
                            {dateText}
                          </span>
                          {s.isRegression && <span style={{ fontSize: 10, color: '#E8A96A' }} title="Plus ancienne qu'une étape précédente">⚠</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
