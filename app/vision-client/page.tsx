'use client'

// app/vision-client/page.tsx
//
// Fiche client complète, ouverte en nouvel onglet depuis la Synthèse
// multi-clients (clic sur le numéro ou l'intitulé). Regroupe :
//   - carte d'identité (ref_tiers)
//   - CA mensuel N vs N-1, empilé par famille macro
//   - devis mensuel N vs N-1 (courbe)
//   - marge mensuelle N vs N-1, en % (courbe)
//   - encours de commandes (activité), mini-tableau
//   - KPI : CERFA non à jour, CDC en retard, factures en retard (fictif)
//
// Section "à enrichir" prévue pour les infos à venir (dernière/prochaine
// visite, validité certificat gaz déjà affichée, RGE déjà affiché…).

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

const FAMILY_MACROS = ['R/R', 'R/O', 'ECS', 'DRV', 'R_zone', 'Accessoire', 'PV', 'Autres']
const MACRO_COLORS: Record<string, string> = {
  'R/R': '#4B92AC',
  'R/O': '#C1683C',
  ECS: '#D69A4A',
  DRV: '#7A5EA8',
  R_zone: '#3F9142',
  Accessoire: '#8ba9be',
  PV: '#E0A961',
  Autres: '#94a3b8',
}
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']
const N = new Date().getFullYear()

type Identity = {
  numero: string
  intitule: string
  siret: string | null
  code_naf: string | null
  adresse: string | null
  complement_adresse: string | null
  code_postal: string | null
  ville: string | null
  representant: string | null
  agence: string | null
  date_creation: string | null
  prospect: boolean | null
  mise_en_sommeil: boolean | null
  rge: string | null
  attestation_capacite: string | null
  capacite_expiration: string | null
  code_risque: string | null
  qualite_relationnelle: string | null
  encours_autorise: number | null
  solde_comptable: number | null
  portefeuille_bl_fa: number | null
  portefeuille_bc_pl: number | null
  objectif_ca: number | null
  lien_blg_tiers: string | null
}

type CaMensuelRow = { annee: number; mois: number; famille_macro: string; ca: number }
type DevisMensuelRow = { annee: number; mois: number; montant: number }
type MargeMensuelRow = { annee: number; mois: number; marge_pct: number | null }
type Encours = { encours_total: number; encours_by_macro: Record<string, number>; encours_by_type: Record<string, number> }
type DernierDocument = { type_document: string; numero_piece: string; date_piece: string | null; montant_ht: number; nb_lignes: number }

function safeNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatKEur(value: number | null | undefined): string {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((value || 0) / 1000)} K€`
}

function formatEur(value: number | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0)
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`
}

function formatDateFr(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const d = new Date(value + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

// ── Graphe CA mensuel : barres groupées N / N-1, empilées par famille macro ──

function MonthlyStackedCaChart({ rows }: { rows: CaMensuelRow[] }) {
  const width = 900
  const height = 320
  const padding = { top: 16, right: 16, bottom: 30, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const byMonth = useMemo(() => {
    const out: Array<{ mois: number; n: Record<string, number>; n1: Record<string, number>; totalN: number; totalN1: number }> = []
    for (let m = 1; m <= 12; m++) {
      const n: Record<string, number> = {}
      const n1: Record<string, number> = {}
      FAMILY_MACROS.forEach((fm) => { n[fm] = 0; n1[fm] = 0 })
      rows.filter((r) => r.mois === m).forEach((r) => {
        const macro = FAMILY_MACROS.includes(r.famille_macro) ? r.famille_macro : 'Autres'
        if (r.annee === N) n[macro] = (n[macro] || 0) + r.ca
        else if (r.annee === N - 1) n1[macro] = (n1[macro] || 0) + r.ca
      })
      const totalN = Object.values(n).reduce((s, v) => s + v, 0)
      const totalN1 = Object.values(n1).reduce((s, v) => s + v, 0)
      out.push({ mois: m, n, n1, totalN, totalN1 })
    }
    return out
  }, [rows])

  const maxVal = Math.max(1, ...byMonth.map((m) => Math.max(m.totalN, m.totalN1)))
  const groupWidth = innerW / 12
  const barWidth = Math.min(22, groupWidth / 2 - 6)

  function y(v: number) {
    return padding.top + innerH - (v / maxVal) * innerH
  }

  function stackedBar(x: number, values: Record<string, number>) {
    let cumulative = 0
    return FAMILY_MACROS.map((fm) => {
      const v = values[fm] || 0
      const yTop = y(cumulative + v)
      const yBottom = y(cumulative)
      cumulative += v
      if (v <= 0) return null
      return <rect key={fm} x={x} y={yTop} width={barWidth} height={Math.max(0, yBottom - yTop)} fill={MACRO_COLORS[fm]} />
    })
  }

  const ticks = [0, maxVal / 2, maxVal]

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? undefined : '3 3'} />
            <text x={padding.left - 6} y={y(t) + 3} fontSize={10} textAnchor="end" fill="#64748b">{formatKEur(t)}</text>
          </g>
        ))}
        {byMonth.map((m, i) => {
          const groupX = padding.left + i * groupWidth + (groupWidth - barWidth * 2 - 4) / 2
          return (
            <g key={m.mois}>
              {stackedBar(groupX, m.n)}
              {stackedBar(groupX + barWidth + 4, m.n1)}
              <text x={groupX + barWidth + 2} y={height - padding.bottom + 14} fontSize={10} textAnchor="middle" fill="#475569">
                {MONTH_LABELS[m.mois - 1]}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="chartLegend">
        {FAMILY_MACROS.map((fm) => (
          <span key={fm}><span className="dot" style={{ background: MACRO_COLORS[fm] }} />{fm}</span>
        ))}
        <span className="legendSep">·</span>
        <span><span className="dot" style={{ background: '#111827' }} /> gauche = {N}</span>
        <span><span className="dot" style={{ background: '#94a3b8' }} /> droite = {N - 1}</span>
      </div>
    </div>
  )
}

// ── Graphe courbe générique, 2 séries (N / N-1) ──────────────────────────

function MonthlyLineChart({
  seriesN, seriesN1, color, formatValue,
}: {
  seriesN: number[]
  seriesN1: number[]
  color: string
  formatValue: (v: number) => string
}) {
  const width = 900
  const height = 220
  const padding = { top: 14, right: 16, bottom: 26, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxVal = Math.max(1, ...seriesN, ...seriesN1)
  const minVal = Math.min(0, ...seriesN, ...seriesN1)
  const x = (i: number) => padding.left + (i / 11) * innerW
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH

  function path(series: number[]) {
    return series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
  }

  const ticks = [minVal, (minVal + maxVal) / 2, maxVal]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? undefined : '3 3'} />
          <text x={padding.left - 6} y={y(t) + 3} fontSize={10} textAnchor="end" fill="#64748b">{formatValue(t)}</text>
        </g>
      ))}
      <path d={path(seriesN1)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.55} />
      <path d={path(seriesN)} fill="none" stroke={color} strokeWidth={2.5} />
      {seriesN.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === seriesN.length - 1 ? 4 : 2.5} fill={color} />)}
      {MONTH_LABELS.map((label, i) => (
        <text key={label} x={x(i)} y={height - 6} fontSize={10} textAnchor="middle" fill="#475569">{label}</text>
      ))}
    </svg>
  )
}

// ── Composant principal ──────────────────────────────────────────────────

export default function VisionClientPage() {
  const searchParams = useSearchParams()
  const numero = searchParams.get('numero') || ''

  const [identity, setIdentity] = useState<Identity | null>(null)
  const [caRows, setCaRows] = useState<CaMensuelRow[]>([])
  const [devisRows, setDevisRows] = useState<DevisMensuelRow[]>([])
  const [margeRows, setMargeRows] = useState<MargeMensuelRow[]>([])
  const [encours, setEncours] = useState<Encours | null>(null)
  const [cerfaKo, setCerfaKo] = useState<number | null>(null)
  const [cdcRetard, setCdcRetard] = useState<number | null>(null)
  const [derniersDocuments, setDerniersDocuments] = useState<DernierDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!numero) { setLoading(false); setError('Aucun numéro de client fourni.'); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [identityRes, caRes, devisRes, margeRes, encoursRes, cerfaRes, cdcRes, derniersRes] = await Promise.all([
          supabase.rpc('get_vision_client_identity', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_ca_mensuel', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_devis_mensuel', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_marge_mensuel', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_encours', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_cerfa_ko', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_cdc_retard', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_derniers_documents', { p_numero_tiers: numero, p_limit: 10 }),
        ])
        for (const r of [identityRes, caRes, devisRes, margeRes, encoursRes, cerfaRes, cdcRes, derniersRes]) {
          if (r.error) throw r.error
        }
        if (cancelled) return
        setIdentity((Array.isArray(identityRes.data) ? identityRes.data[0] : identityRes.data) || null)
        setCaRows((caRes.data || []) as CaMensuelRow[])
        setDevisRows((devisRes.data || []) as DevisMensuelRow[])
        setMargeRows((margeRes.data || []) as MargeMensuelRow[])
        const encoursRow = Array.isArray(encoursRes.data) ? encoursRes.data[0] : encoursRes.data
        setEncours(encoursRow || { encours_total: 0, encours_by_macro: {}, encours_by_type: {} })
        setCerfaKo(Number(cerfaRes.data) || 0)
        setCdcRetard(Number(cdcRes.data) || 0)
        setDerniersDocuments((derniersRes.data || []) as DernierDocument[])
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [numero])

  const devisSeriesN = useMemo(() => Array.from({ length: 12 }, (_, i) => devisRows.find((r) => r.annee === N && r.mois === i + 1)?.montant || 0), [devisRows])
  const devisSeriesN1 = useMemo(() => Array.from({ length: 12 }, (_, i) => devisRows.find((r) => r.annee === N - 1 && r.mois === i + 1)?.montant || 0), [devisRows])
  const margeSeriesN = useMemo(() => Array.from({ length: 12 }, (_, i) => devisNullToZero(margeRows.find((r) => r.annee === N && r.mois === i + 1)?.marge_pct)), [margeRows])
  const margeSeriesN1 = useMemo(() => Array.from({ length: 12 }, (_, i) => devisNullToZero(margeRows.find((r) => r.annee === N - 1 && r.mois === i + 1)?.marge_pct)), [margeRows])

  function devisNullToZero(v: number | null | undefined) {
    return v === null || v === undefined ? 0 : v
  }

  const derniersDevis = useMemo(() => derniersDocuments.filter((d) => d.type_document === 'Devis').slice(0, 10), [derniersDocuments])
  const dernieresCommandes = useMemo(() => derniersDocuments.filter((d) => d.type_document === 'Bon de commande').slice(0, 10), [derniersDocuments])
  const derniersBl = useMemo(() => derniersDocuments.filter((d) => d.type_document === 'Bon de livraison').slice(0, 10), [derniersDocuments])

  const capaciteJours = daysUntil(identity?.capacite_expiration)
  // Fictif, demandé explicitement — pas de colonne d'échéance de paiement
  // fiable dans facture_lignes pour calculer ce montant réellement.
  const facturesRetardFictif = 6840

  if (loading) {
    return <main className="page"><div className="loadingBox">Chargement de la fiche client…</div><style jsx>{pageStyles}</style></main>
  }

  if (error || !identity) {
    return (
      <main className="page">
        <div className="errorBox">{error || `Client "${numero}" introuvable.`}</div>
        <style jsx>{pageStyles}</style>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="clientHeader">
        <div>
          <div className="eyebrow">Vision Client</div>
          <h1>{identity.intitule} <span className="numeroTag">{identity.numero}</span></h1>
          <p>{identity.representant || 'Représentant non renseigné'} · {identity.agence || 'Agence non renseignée'}</p>
        </div>
        {identity.lien_blg_tiers && (
          <a href={identity.lien_blg_tiers} target="_blank" rel="noopener noreferrer" className="blgLink">Ouvrir la fiche CRM ↗</a>
        )}
      </header>

      {/* ── Carte d'identité ── */}
      <section className="card">
        <h2>Carte d'identité</h2>
        <div className="identityGrid">
          <div><span>SIRET</span><strong>{identity.siret || '—'}</strong></div>
          <div><span>Code NAF</span><strong>{identity.code_naf || '—'}</strong></div>
          <div><span>Adresse</span><strong>{[identity.adresse, identity.complement_adresse].filter(Boolean).join(', ') || '—'}</strong></div>
          <div><span>Ville</span><strong>{[identity.code_postal, identity.ville].filter(Boolean).join(' ') || '—'}</strong></div>
          <div><span>Date création</span><strong>{formatDateFr(identity.date_creation)}</strong></div>
          <div><span>Statut</span><strong>{identity.prospect ? 'Prospect' : 'Client'}{identity.mise_en_sommeil ? ' · en sommeil' : ''}</strong></div>
          <div><span>RGE</span><strong className={identity.rge ? 'ok' : 'muted'}>{identity.rge || 'NON'}</strong></div>
          <div>
            <span>Capacité gaz</span>
            <strong className={capaciteJours !== null && capaciteJours < 30 ? 'danger' : capaciteJours !== null ? 'ok' : 'muted'}>
              {identity.attestation_capacite ? 'OUI' : 'NON'}{identity.capacite_expiration ? ` · exp. ${formatDateFr(identity.capacite_expiration)}` : ''}
            </strong>
          </div>
          <div><span>Code risque</span><strong>{identity.code_risque || '—'}</strong></div>
          <div><span>Qualité relationnelle</span><strong>{identity.qualite_relationnelle || '—'}</strong></div>
          <div><span>Encours autorisé</span><strong>{formatEur(identity.encours_autorise)}</strong></div>
          <div><span>Solde comptable</span><strong>{formatEur(identity.solde_comptable)}</strong></div>
          <div><span>Portefeuille BL/FA</span><strong>{formatEur(identity.portefeuille_bl_fa)}</strong></div>
          <div><span>Portefeuille BC/PL</span><strong>{formatEur(identity.portefeuille_bc_pl)}</strong></div>
          <div><span>Objectif CA {N}</span><strong>{identity.objectif_ca ? formatEur(identity.objectif_ca) : '—'}</strong></div>
        </div>
        <p className="futureNote">
          À enrichir prochainement : date de dernière visite, date de prochaine visite — en plus de la capacité gaz et du RGE déjà affichés ci-dessus.
        </p>
      </section>

      {/* ── KPI ── */}
      <section className="kpiRow">
        <a className="kpiCard" href={`/portefeuille-livraison?client=${encodeURIComponent(identity.numero)}`} target="_blank" rel="noopener noreferrer">
          <span>CERFA non à jour</span>
          <strong className={cerfaKo ? 'danger' : 'ok'}>{cerfaKo ?? 0}</strong>
        </a>
        <a className="kpiCard" href="/portefeuille-livraison" target="_blank" rel="noopener noreferrer">
          <span>CDC en retard de livraison</span>
          <strong className={cdcRetard ? 'danger' : 'ok'}>{cdcRetard ?? 0}</strong>
        </a>
        <div className="kpiCard">
          <span>Factures en retard de paiement <em className="fictifTag">fictif</em></span>
          <strong className="danger">{formatEur(facturesRetardFictif)}</strong>
        </div>
      </section>

      {/* ── CA mensuel empilé ── */}
      <section className="card">
        <h2>CA mensuel par famille macro — {N} vs {N - 1}</h2>
        <MonthlyStackedCaChart rows={caRows} />
      </section>

      <div className="chartGrid">
        <section className="card">
          <h2>Devis mensuel — {N} vs {N - 1}</h2>
          <MonthlyLineChart seriesN={devisSeriesN} seriesN1={devisSeriesN1} color="#D69A4A" formatValue={formatKEur} />
        </section>
        <section className="card">
          <h2>Marge mensuelle (%) — {N} vs {N - 1}</h2>
          <MonthlyLineChart seriesN={margeSeriesN} seriesN1={margeSeriesN1} color="#7A5EA8" formatValue={(v) => `${v.toFixed(0)} %`} />
        </section>
      </div>

      {/* ── Encours de commandes ── */}
      <section className="card">
        <h2>Encours de commandes (activité)</h2>
        <div className="encoursTotal">{formatKEur(encours?.encours_total)}</div>
        <div className="encoursTables">
          <table>
            <thead><tr><th>Famille macro</th><th>Encours</th></tr></thead>
            <tbody>
              {FAMILY_MACROS.map((fm) => (
                <tr key={fm}>
                  <td><span className="dot" style={{ background: MACRO_COLORS[fm] }} />{fm}</td>
                  <td className="num">{formatKEur(encours?.encours_by_macro?.[fm])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead><tr><th>Type de document</th><th>Encours</th></tr></thead>
            <tbody>
              {['BL-BR', 'PL', 'CDC'].map((type) => (
                <tr key={type}>
                  <td>{type}</td>
                  <td className="num">{formatKEur(encours?.encours_by_type?.[type])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Derniers documents ── */}
      <section className="card">
        <h2>Derniers documents</h2>
        <div className="documentsGrid">
          <DocumentsMiniTable title="Derniers devis" rows={derniersDevis} accent="#D69A4A" />
          <DocumentsMiniTable title="Dernières commandes" rows={dernieresCommandes} accent="#4B92AC" />
          <DocumentsMiniTable title="Derniers BL" rows={derniersBl} accent="#3F9142" />
        </div>
      </section>

      <style jsx>{pageStyles}</style>
    </main>
  )
}

function DocumentsMiniTable({ title, rows, accent }: { title: string; rows: DernierDocument[]; accent: string }) {
  return (
    <div className="documentsMiniTable" style={{ borderTopColor: accent }}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="documentsEmpty">Aucun document.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Pièce</th><th>Date</th><th className="num">Montant HT</th><th className="num">Lignes</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.numero_piece}>
                <td className="mono">{row.numero_piece}</td>
                <td>{formatDateFr(row.date_piece)}</td>
                <td className="num">{formatEur(row.montant_ht)}</td>
                <td className="num">{row.nb_lignes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const pageStyles = `
  .page { padding: 20px 24px 40px; background: #f6f8fb; min-height: 100vh; color: #0f172a; max-width: 1200px; margin: 0 auto; }
  .loadingBox, .errorBox { background: white; border-radius: 14px; padding: 40px; text-align: center; font-weight: 800; color: #64748b; }
  .errorBox { color: #991b1b; background: #fee2e2; }
  .clientHeader { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; }
  h1 { margin: 2px 0 4px; font-size: 26px; font-weight: 900; letter-spacing: -0.02em; }
  .numeroTag { font-family: monospace; font-size: 15px; font-weight: 700; color: #64748b; background: #e2e8f0; border-radius: 6px; padding: 2px 8px; margin-left: 8px; vertical-align: middle; }
  .clientHeader p { margin: 0; color: #64748b; font-size: 13px; font-weight: 700; }
  .blgLink { align-self: center; background: #0f172a; color: white; border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 800; text-decoration: none; white-space: nowrap; }
  .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
  .card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 900; }
  .identityGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 18px; }
  .identityGrid div { min-width: 0; }
  .identityGrid span { display: block; font-size: 10px; font-weight: 900; text-transform: uppercase; color: #94a3b8; margin-bottom: 2px; }
  .identityGrid strong { display: block; font-size: 13px; font-weight: 800; color: #0f172a; overflow: hidden; text-overflow: ellipsis; }
  .identityGrid strong.ok { color: #047857; }
  .identityGrid strong.danger { color: #dc2626; }
  .identityGrid strong.muted { color: #94a3b8; }
  .futureNote { margin: 14px 0 0; padding-top: 10px; border-top: 1px dashed #e2e8f0; font-size: 11px; color: #94a3b8; font-style: italic; }
  .kpiRow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
  .kpiCard { display: block; background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(15,23,42,.05); text-decoration: none; color: inherit; }
  .kpiCard span { display: block; font-size: 11px; font-weight: 900; text-transform: uppercase; color: #64748b; }
  .kpiCard strong { display: block; margin-top: 4px; font-size: 22px; font-weight: 950; }
  .kpiCard strong.ok { color: #047857; }
  .kpiCard strong.danger { color: #dc2626; }
  .fictifTag { font-style: normal; font-size: 9px; font-weight: 900; text-transform: uppercase; background: #fde68a; color: #92400e; border-radius: 999px; padding: 1px 6px; margin-left: 6px; }
  .chartGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .chartLegend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 10px; color: #64748b; align-items: center; }
  .chartLegend span { display: inline-flex; align-items: center; gap: 4px; }
  .chartLegend .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .legendSep { color: #cbd5e1; }
  .encoursTotal { font-size: 26px; font-weight: 950; margin-bottom: 10px; }
  .encoursTables { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .encoursTables table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .encoursTables th { text-align: left; font-size: 10px; text-transform: uppercase; color: #94a3b8; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
  .encoursTables td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; }
  .encoursTables td.num { text-align: right; font-weight: 800; }
  .encoursTables .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 6px; }
  .documentsGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .documentsMiniTable { border-top: 3px solid #cbd5e1; padding-top: 10px; min-width: 0; }
  .documentsMiniTable h3 { margin: 0 0 8px; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  .documentsMiniTable table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .documentsMiniTable th { text-align: left; font-size: 9.5px; text-transform: uppercase; color: #94a3b8; padding: 3px 5px; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
  .documentsMiniTable td { padding: 5px; border-bottom: 1px solid #f1f5f9; }
  .documentsMiniTable td.num, .documentsMiniTable th.num { text-align: right; }
  .documentsMiniTable td.mono { font-family: monospace; font-weight: 700; }
  .documentsEmpty { font-size: 12px; color: #94a3b8; font-style: italic; margin: 0; }
`
