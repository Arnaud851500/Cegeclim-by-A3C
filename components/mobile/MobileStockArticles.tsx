'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Écran "Stock articles" (mobile) :
//   1. Recherche libre (référence ou désignation) OU liste de références
//      collées (une par ligne, ou séparées par virgule) -- détectée
//      automatiquement selon qu'il y a plusieurs "tokens" dans la saisie.
//   2. Liste de résultats avec le stock actuel (source : v_stock_articles_
//      latest, déjà corrigée pour agréger tous les dépôts -- cf. échanges
//      précédents).
//   3. Fiche détail par référence : stock par dépôt (get_stock_par_depot,
//      même RPC que l'écran desktop "Projections stock") + projection
//      hebdomadaire (réutilise /api/stocks-disponibilites/detail, la même
//      route que la fiche article desktop -- pas de nouvelle route créée).
// ─────────────────────────────────────────────────────────────────────────

type StockRow = {
  reference_article: string
  designation: string | null
  famille: string | null
  stock_reel: number
  stock_disponible: number
  stock_a_terme: number
}

type DepotStockRow = {
  depot: string
  stock_reel: number
  stock_reserve: number
  stock_commande_fournisseur: number
  stock_prepare: number
  stock_disponible: number
  stock_a_terme: number
}

type ProjectionWeekRow = {
  periode_debut: string
  stock_projete: number | null
  besoins_clients_fermes: number | null
  prevision_ventes: number | null
  commandes_fournisseurs_attendues: number | null
  niveau_alerte: string | null
  date_rupture?: string | null
}

const ALERT_COLOR: Record<string, string> = {
  ROUGE: '#C1683C',
  ORANGE: '#D69A4A',
  JAUNE: '#B8A63A',
  VERT: '#4B92AC',
}

function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}
function formatDateCourte(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}

// Détecte une saisie "liste de références" (plusieurs lignes / virgules /
// points-virgules) plutôt qu'une recherche libre à un seul terme.
function parseReferences(q: string): string[] {
  return Array.from(
    new Set(
      q
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    ),
  )
}

export default function MobileStockArticles() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openReference, setOpenReference] = useState<{ reference: string; designation: string } | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(async () => {
      const refs = parseReferences(q)
      const isListe = refs.length > 1

      const base = supabase
        .from('v_stock_articles_latest')
        .select('reference_article, designation, famille, stock_reel, stock_disponible, stock_a_terme')

      const { data, error: err } = isListe
        ? await base.in('reference_article', refs).limit(300)
        : await base
            .or(`reference_article.ilike.%${q}%,designation.ilike.%${q}%`)
            .order('reference_article')
            .limit(40)

      if (cancelled) return
      if (err) {
        setError(err.message)
        setResults([])
      } else {
        setError(null)
        setResults(
          ((data || []) as any[]).map((r) => ({
            reference_article: r.reference_article,
            designation: r.designation,
            famille: r.famille,
            stock_reel: toNumber(r.stock_reel),
            stock_disponible: toNumber(r.stock_disponible),
            stock_a_terme: toNumber(r.stock_a_terme),
          })),
        )
      }
      setLoading(false)
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query])

  const refsSaisies = useMemo(() => parseReferences(query), [query])
  const isListe = refsSaisies.length > 1

  return (
    <div style={{ flex: 1, padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={'Référence ou désignation'}
          rows={isListe ? 3 : 1}
          style={{
            width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
            color: '#fff', padding: '10px 12px', fontSize: 14.5, resize: 'none', fontFamily: 'var(--font-body)',
          }}
        />
        {isListe && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'rgba(166,161,129,0.9)' }}>
            {refsSaisies.length} référence(s) détectée(s) dans la liste
          </div>
        )}
      </div>

      {loading && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Recherche…</div>}

      {error && (
        <div style={{ borderRadius: 10, border: '1px solid rgba(193,104,60,0.4)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13, padding: '10px 12px' }}>
          {error}
        </div>
      )}

      {!loading && results !== null && results.length === 0 && !error && (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Aucune référence trouvée.</div>
      )}

      {!loading && results && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r) => (
            <button
              key={r.reference_article}
              onClick={() => setOpenReference({ reference: r.reference_article, designation: r.designation || '' })}
              style={{
                textAlign: 'left', borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.04)', padding: '12px 14px', width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{r.reference_article}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Détail ›</span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.designation || '—'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                <MiniStat label="Dispo" value={formatNumber(r.stock_disponible)} />
                <MiniStat label="Réel" value={formatNumber(r.stock_reel)} />
                <MiniStat
                  label="À terme"
                  value={formatNumber(r.stock_a_terme)}
                  accent={r.stock_a_terme < 0 ? '#e0a685' : undefined}
                />
              </div>
            </button>
          ))}
        </div>
      )}

      {results === null && !loading && (
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12.5, padding: '20px 4px', lineHeight: 1.6 }}>
          Tape une référence ou une désignation pour chercher un seul article, ou colle plusieurs références (une par ligne) pour vérifier une liste d&rsquo;un coup.
        </div>
      )}

      {openReference && (
        <StockArticleDetailSheet
          reference={openReference.reference}
          designation={openReference.designation}
          onClose={() => setOpenReference(null)}
        />
      )}
    </div>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: accent || '#fff' }}>{value}</div>
    </div>
  )
}

// ── Fiche détail : stock par dépôt + projection hebdomadaire ─────────────

function StockArticleDetailSheet({
  reference, designation, onClose,
}: { reference: string; designation: string; onClose: () => void }) {
  const [depotRows, setDepotRows] = useState<DepotStockRow[] | null>(null)
  const [depotLoading, setDepotLoading] = useState(true)
  const [depotError, setDepotError] = useState<string | null>(null)

  const [projRows, setProjRows] = useState<ProjectionWeekRow[] | null>(null)
  const [projLoading, setProjLoading] = useState(true)
  const [projError, setProjError] = useState<string | null>(null)
  const [designationResolue, setDesignationResolue] = useState(designation)

  useEffect(() => {
    let cancelled = false
    async function loadDepot() {
      setDepotLoading(true)
      const { data, error } = await supabase.rpc('get_stock_par_depot', { p_reference_article: reference })
      if (cancelled) return
      if (error) { setDepotError(error.message); setDepotRows([]) } else { setDepotRows((data || []) as DepotStockRow[]) }
      setDepotLoading(false)
    }
    void loadDepot()
    return () => { cancelled = true }
  }, [reference])

  useEffect(() => {
    let cancelled = false
    // Réutilise la même route que la fiche article desktop -- pas de
    // nouvelle route créée : /api/stocks-disponibilites/detail retourne
    // déjà "projection" (lignes hebdomadaires du dernier run) pour une
    // référence donnée.
    async function loadProjection() {
      setProjLoading(true)
      setProjError(null)
      try {
        const session = await supabase.auth.getSession()
        const token = session.data.session?.access_token
        const params = new URLSearchParams({ reference_article: reference, depot: 'GLOBAL' })
        const res = await fetch(`/api/stocks-disponibilites/detail?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        const payload = (await res.json()) as { success: boolean; message?: string; projection?: ProjectionWeekRow[] }
        if (!res.ok || !payload.success) throw new Error(payload?.message || 'Erreur de chargement de la projection.')
        if (!cancelled) setProjRows(payload.projection || [])
      } catch (e) {
        if (!cancelled) { setProjError(e instanceof Error ? e.message : String(e)); setProjRows([]) }
      } finally {
        if (!cancelled) setProjLoading(false)
      }
    }
    void loadProjection()
    return () => { cancelled = true }
  }, [reference])

  // Si on est arrivé ici sans désignation (ex. recherche multi-références
  // où elle n'était pas encore chargée), on la récupère depuis la 1re
  // ligne de dépôt/projection dès qu'elle arrive -- filet de sécurité,
  // pas indispensable la plupart du temps puisque la liste la fournit déjà.
  useEffect(() => {
    if (designation) setDesignationResolue(designation)
  }, [designation])

  const totalDepot = useMemo(() => {
    if (!depotRows) return null
    return depotRows.reduce(
      (acc, r) => ({
        stock_reel: acc.stock_reel + toNumber(r.stock_reel),
        stock_prepare: acc.stock_prepare + toNumber(r.stock_prepare),
        stock_disponible: acc.stock_disponible + toNumber(r.stock_disponible),
      }),
      { stock_reel: 0, stock_prepare: 0, stock_disponible: 0 },
    )
  }, [depotRows])

  const prochaineRupture = useMemo(() => {
    if (!projRows) return null
    const r = projRows.find((r) => toNumber(r.stock_projete) < 0)
    return r?.periode_debut || null
  }, [projRows])

  const niveauActuel = projRows && projRows.length > 0 ? projRows[0].niveau_alerte || 'VERT' : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
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
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {niveauActuel && (
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ALERT_COLOR[niveauActuel] || '#8A93A6', flexShrink: 0 }} />
                )}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: '#fff' }}>{reference}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{designationResolue || '—'}</div>
            </div>
            <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none', flexShrink: 0 }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Résumé + projection ── */}
          <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>Stock projeté</div>
              {prochaineRupture && (
                <div style={{ fontSize: 11, color: '#e0a685' }}>Rupture : {formatDateCourte(prochaineRupture)}</div>
              )}
            </div>
            {projLoading ? (
              <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Chargement…</span>
              </div>
            ) : projError ? (
              <div style={{ fontSize: 12, color: '#e0a685' }}>{projError}</div>
            ) : !projRows || projRows.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', padding: '10px 0' }}>Aucune projection disponible pour cette référence.</div>
            ) : (
              <ProjectionMiniChart rows={projRows} />
            )}
          </div>

          {/* ── Par dépôt ── */}
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
              Stock par dépôt
            </div>
            {depotError && (
              <div style={{ marginBottom: 8, fontSize: 12, color: '#e0a685' }}>{depotError}</div>
            )}
            {depotLoading ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '16px 0', textAlign: 'center' }}>Chargement…</div>
            ) : !depotRows || depotRows.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '16px 0', textAlign: 'center' }}>Aucune position de stock.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {depotRows.map((r) => (
                  <div key={r.depot} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '8px 12px' }}>
                    <span style={{ fontSize: 12.5, color: '#fff', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.depot}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginRight: 10 }}>
                      réel {formatNumber(toNumber(r.stock_reel))}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: '#fff' }}>
                      dispo {formatNumber(toNumber(r.stock_disponible))}
                    </span>
                  </div>
                ))}
                {totalDepot && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, background: 'rgba(166,161,129,0.12)', border: '1px solid rgba(166,161,129,0.3)', padding: '8px 12px', marginTop: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#A6A181' }}>Total</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginRight: 10 }}>
                      réel {formatNumber(totalDepot.stock_reel)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                      dispo {formatNumber(totalDepot.stock_disponible)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Mini graphique SVG du stock projeté (léger, sans dépendance) ─────────

function ProjectionMiniChart({ rows }: { rows: ProjectionWeekRow[] }) {
  const largeur = 300
  const hauteur = 110
  const marge = 8

  const valeurs = rows.map((r) => toNumber(r.stock_projete))
  const max = Math.max(1, ...valeurs)
  const min = Math.min(0, ...valeurs)

  function chemin() {
    const n = valeurs.length
    if (n < 2) return ''
    return valeurs
      .map((v, i) => {
        const x = marge + (i / (n - 1)) * (largeur - marge * 2)
        const y = hauteur - marge - ((v - min) / (max - min || 1)) * (hauteur - marge * 2)
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }

  const zeroY = hauteur - marge - ((0 - min) / (max - min || 1)) * (hauteur - marge * 2)
  const dernier = rows[rows.length - 1]
  const couleur = ALERT_COLOR[dernier?.niveau_alerte || 'VERT'] || '#4B92AC'

  return (
    <div>
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} style={{ width: '100%', height: 90, display: 'block' }}>
        {min < 0 && (
          <line x1={marge} y1={zeroY} x2={largeur - marge} y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        <path d={chemin()} fill="none" stroke={couleur} strokeWidth={2} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{formatDateCourte(rows[0]?.periode_debut)}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{formatDateCourte(dernier?.periode_debut)}</span>
      </div>
    </div>
  )
}
