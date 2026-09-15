'use client'

// ============================================================================
// app/stock/page.tsx — Stock articles (desktop)
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-16) : version PC de l'écran mobile « Stock articles »
// (components/mobile/MobileStockArticles.tsx), qui exploite toute la largeur :
//   - colonne gauche : filtres (famille macro → famille, dépôt, dispo), recherche
//     libre ou liste de références collées, résultats (RPC
//     search_stock_articles_mobile, même source que le mobile) ;
//   - zone principale, pour la référence sélectionnée :
//       • bandeau : dispo tous dépôts, réel, réservé, à terme, réceptions
//         fournisseurs attendues, besoins CDC fermes ;
//       • courbe de projection sur documents réels — stock dispo aujourd'hui,
//         moins les commandes clients (CDC) à leur date de livraison, plus les
//         commandes fournisseurs (sage.bdcf, type 12) à leur date de réception
//         (CDF en retard ou sans date = supposées reçues demain, comme dans
//         v_portefeuille_couverture_stock) ; horizon 3 / 6 / 12 mois ;
//       • alertes « commande non complète à la date de livraison client » :
//         lignes RUPTURE / RECEPTION_TARDIVE de v_portefeuille_couverture_stock
//         avec la date estimée de disponibilité et la prochaine réception ;
//       • simulateur « nouvelle commande » : première date à laquelle une
//         quantité donnée est disponible sans mettre en rupture les commandes
//         déjà prises ;
//       • stock par dépôt (get_stock_par_depot) et liste des réceptions.
//   - ?ref=XXXX ouvre directement la référence.
// Sur mobile (< 768 px) on rend MobileStockArticles tel quel.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useViewport } from '@/lib/useViewport'
import MobileStockArticles from '@/components/mobile/MobileStockArticles'

// ── Types ─────────────────────────────────────────────────────────────────
type StockRow = {
  reference_article: string
  designation: string | null
  famille: string | null
  famille_macro: string | null
  depot: string
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

type FamilleRow = { famille: string; famille_macro: string; libelle_famille: string | null }

type ReceptionRow = {
  ligne_cdf_id: string
  numero_cdf: string | null
  numero_fournisseur: string | null
  nom_fournisseur: string | null
  depot_reception: string | null
  date_commande: string | null
  date_livraison_sage: string | null
  quantite_attendue: number
  hypothese_reception: 'PREVUE' | 'RETARD' | 'SANS_DATE'
  date_reception_retenue: string
}

type CouvertureRow = {
  id: string
  numero_document: string | null
  numero_tiers: string | null
  nom_tiers: string | null
  representant: string | null
  agence: string | null
  date_creation_document: string | null
  date_livraison: string | null
  quantite: number
  montant_ht: number
  rang_service: number
  stock_disponible: number
  besoin_cumule: number
  receptions_avant_livraison: number
  stock_projete_a_date: number
  manque_a_date: number
  statut_couverture: 'COUVERT' | 'COUVERT_PAR_RECEPTION' | 'RECEPTION_TARDIVE' | 'RUPTURE'
  date_couverture_estimee: string | null
  retard_estime_jours: number | null
  prochaine_reception_date: string | null
  prochaine_reception_quantite: number | null
  prochaine_reception_cdf: string | null
  prochaine_reception_hypothese: boolean
}

type EvenementProjection = {
  date: string
  ordre: 0 | 1 // 0 = réception (avant), 1 = besoin
  type: 'RECEPTION' | 'CDC'
  quantite: number // signée
  label: string
  detail: string
  hypothese: boolean
  stockApres: number
}

// ── Constantes ────────────────────────────────────────────────────────────
const DEPOTS_PROPOSES = [
  'ANGLET CEGECLIM', 'ANGOULEME CEGECLIM', 'ARCACHON CEGECLIM', 'ARTIGUES CEGECLIM',
  'BRIVE CEGECLIM', 'DAX CEGECLIM', 'FMS', 'LA ROCHELLE CEGECLIM',
  'MARMANDE CEGECLIM', 'MERIGNAC CEGECLIM', 'PAU CEGECLIM',
]
const HORIZONS: Array<[number, string]> = [[3, '3 mois'], [6, '6 mois'], [12, '12 mois']]
const STATUT_LABEL: Record<CouvertureRow['statut_couverture'], string> = {
  COUVERT: 'Couvert (stock)',
  COUVERT_PAR_RECEPTION: 'Couvert par réception',
  RECEPTION_TARDIVE: 'Réception tardive',
  RUPTURE: 'Rupture',
}
const STATUT_COLOR: Record<CouvertureRow['statut_couverture'], string> = {
  COUVERT: '#8fd4a8',
  COUVERT_PAR_RECEPTION: '#8FC7DA',
  RECEPTION_TARDIVE: '#E0A961',
  RUPTURE: '#e0a685',
}

// ── Helpers ───────────────────────────────────────────────────────────────
function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}
function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0)
}
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayIso(): string {
  return toIsoDate(new Date())
}
function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return toIsoDate(d)
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)
}
function formatDateFr(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function formatDateCourte(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}
function depotCourt(depot: string): string {
  return String(depot || '').replace(/\s*CEGECLIM\s*$/i, '').trim() || depot
}
function couleurDispo(n: number): string {
  if (n > 0) return '#8fd4a8'
  if (n < 0) return '#e0a685'
  return 'rgba(255,255,255,0.35)'
}
function parseReferences(q: string): string[] {
  return Array.from(new Set(q.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase())))
}

/** Projection sur documents réels : stock dispo d'aujourd'hui, réceptions
 * fournisseurs (+) et besoins CDC (−) dans l'ordre chronologique, réception
 * avant besoin à date égale. Les besoins dont la livraison est passée sont
 * ramenés à aujourd'hui (besoin immédiat). */
function construireProjection(stock0: number, receptions: ReceptionRow[], besoins: CouvertureRow[]): EvenementProjection[] {
  const auj = todayIso()
  const events: Omit<EvenementProjection, 'stockApres'>[] = []
  for (const r of receptions) {
    events.push({
      date: r.date_reception_retenue,
      ordre: 0,
      type: 'RECEPTION',
      quantite: toNumber(r.quantite_attendue),
      label: r.numero_cdf || 'CDF',
      detail: [r.nom_fournisseur || r.numero_fournisseur, r.depot_reception ? depotCourt(r.depot_reception) : null].filter(Boolean).join(' · '),
      hypothese: r.hypothese_reception !== 'PREVUE',
    })
  }
  for (const b of besoins) {
    const date = b.date_livraison && b.date_livraison >= auj ? b.date_livraison : auj
    events.push({
      date,
      ordre: 1,
      type: 'CDC',
      quantite: -toNumber(b.quantite),
      label: b.numero_document || 'CDC',
      detail: [b.nom_tiers || b.numero_tiers, b.date_livraison && b.date_livraison < auj ? `livraison prévue le ${formatDateCourte(b.date_livraison)} (dépassée)` : null].filter(Boolean).join(' · '),
      hypothese: false,
    })
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.ordre - b.ordre || a.label.localeCompare(b.label))
  let courant = stock0
  return events.map((e) => {
    courant += e.quantite
    return { ...e, stockApres: courant }
  })
}

/** Première date à laquelle `quantite` pièces peuvent être promises sans
 * mettre en rupture les commandes déjà prises : le stock projeté doit rester
 * ≥ quantite à cette date et pour tous les événements suivants. */
function premiereDateDisponible(stock0: number, events: EvenementProjection[], quantite: number): { date: string | null; niveau: number } {
  if (quantite <= 0) return { date: todayIso(), niveau: stock0 }
  const n = events.length
  const suffixMin = new Array<number>(n + 1)
  suffixMin[n] = n > 0 ? events[n - 1].stockApres : stock0
  for (let i = n - 1; i >= 0; i -= 1) suffixMin[i] = Math.min(events[i].stockApres, suffixMin[i + 1])
  // Aujourd'hui : il faut stock0 >= q et aucun événement futur ne descend sous q.
  const minGlobal = Math.min(stock0, n > 0 ? suffixMin[0] : stock0)
  if (minGlobal >= quantite) return { date: todayIso(), niveau: minGlobal }
  for (let i = 0; i < n; i += 1) {
    if (events[i].stockApres >= quantite && suffixMin[i] >= quantite) return { date: events[i].date, niveau: suffixMin[i] }
  }
  return { date: null, niveau: n > 0 ? events[n - 1].stockApres : stock0 }
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function StockPage() {
  const { isMobile } = useViewport()
  if (isMobile) return <MobileStockArticles />
  return <StockDesktop />
}

function StockDesktop() {
  // ── Recherche & filtres ────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [famillesRef, setFamillesRef] = useState<FamilleRow[] | null>(null)
  const [familleMacro, setFamilleMacro] = useState('')
  const [famille, setFamille] = useState('')
  const [depot, setDepot] = useState('')
  const [dispoFiltre, setDispoFiltre] = useState<'tous' | 'oui' | 'non'>('tous')
  const filtresActifs = Boolean(familleMacro || famille || depot || dispoFiltre !== 'tous')

  // ── Référence sélectionnée ─────────────────────────────────────────────
  const [selected, setSelected] = useState<{ reference: string; designation: string } | null>(null)
  const [horizonMois, setHorizonMois] = useState(6)
  const [quantiteSimulee, setQuantiteSimulee] = useState('1')

  useEffect(() => {
    let cancelled = false
    async function chargerFamilles() {
      const { data } = await supabase.from('ref_familles').select('famille, famille_macro, libelle_famille').order('famille_macro')
      if (!cancelled) setFamillesRef((data || []) as FamilleRow[])
    }
    void chargerFamilles()
    return () => { cancelled = true }
  }, [])

  // Ouverture directe ?ref=XXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = String(params.get('ref') || '').trim().toUpperCase()
    if (ref) { setSelected({ reference: ref, designation: '' }); setQuery(ref) }
  }, [])

  const famillesMacroDisponibles = useMemo(
    () => (famillesRef ? Array.from(new Set(famillesRef.map((f) => f.famille_macro).filter(Boolean))).sort() : []),
    [famillesRef],
  )
  const famillesDuMacro = useMemo(
    () => (famillesRef && familleMacro ? famillesRef.filter((f) => f.famille_macro === familleMacro).sort((a, b) => a.famille.localeCompare(b.famille)) : []),
    [famillesRef, familleMacro],
  )

  useEffect(() => {
    const q = query.trim()
    if (!q && !filtresActifs) { setResults(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(async () => {
      const refs = parseReferences(q)
      const isListe = refs.length > 1
      const { data, error: err } = await supabase.rpc('search_stock_articles_mobile', {
        p_query: isListe || !q ? null : q,
        p_references: isListe ? refs : null,
        p_famille_macro: familleMacro || null,
        p_famille: famille || null,
        p_depot: depot || null,
        p_disponible_only: dispoFiltre === 'tous' ? null : dispoFiltre === 'oui',
        p_limit: isListe ? 300 : 120,
      })
      if (cancelled) return
      if (err) { setError(err.message); setResults([]) } else {
        setError(null)
        setResults(((data || []) as any[]).map((r) => ({
          reference_article: r.reference_article,
          designation: r.designation,
          famille: r.famille,
          famille_macro: r.famille_macro,
          depot: r.depot,
          stock_reel: toNumber(r.stock_reel),
          stock_disponible: toNumber(r.stock_disponible),
          stock_a_terme: toNumber(r.stock_a_terme),
        })))
      }
      setLoading(false)
    }, 300)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query, familleMacro, famille, depot, dispoFiltre, filtresActifs])

  const refsSaisies = useMemo(() => parseReferences(query), [query])
  const isListe = refsSaisies.length > 1

  function reinitialiserFiltres() {
    setFamilleMacro(''); setFamille(''); setDepot(''); setDispoFiltre('tous')
  }

  function selectionner(reference: string, designation: string) {
    setSelected({ reference, designation })
    const url = new URL(window.location.href)
    url.searchParams.set('ref', reference)
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div style={styles.page}>
      <style>{`
        .stkBtn:hover { background: rgba(255,255,255,0.10); color: #fff; border-color: rgba(255,255,255,0.3); }
        .stkRow:hover { background: rgba(255,255,255,0.07); }
        .stkBtn:focus-visible, .stkRow:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
        .stkTable th { position: sticky; top: 0; background: #101A2E; z-index: 1; }
      `}</style>

      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Stocks &amp; logistique</div>
          <h1 style={styles.title}>Stock articles</h1>
          <div style={styles.lead}>Stock global tous dépôts, projection sur les documents réels (commandes clients et commandes fournisseurs) et disponibilité pour une nouvelle commande.</div>
        </div>
      </div>

      <div style={styles.layout}>
        {/* ── Colonne gauche : filtres, recherche, résultats ── */}
        <aside style={styles.side}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>Rechercher</div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Référence ou désignation — ou une liste de références (une par ligne)"
              rows={isListe ? 4 : 2}
              style={styles.searchArea}
            />
            {isListe && <div style={styles.hint}>{refsSaisies.length} référence(s) détectée(s)</div>}

            <div style={styles.filters}>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>Famille macro</span>
                <select value={familleMacro} onChange={(e) => { setFamilleMacro(e.target.value); setFamille('') }} style={styles.select}>
                  <option value="">Toutes</option>
                  {famillesMacroDisponibles.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>Famille</span>
                <select value={famille} onChange={(e) => setFamille(e.target.value)} disabled={!familleMacro} style={{ ...styles.select, opacity: familleMacro ? 1 : 0.5 }}>
                  <option value="">Toutes</option>
                  {famillesDuMacro.map((f) => <option key={f.famille} value={f.famille}>{f.famille}{f.libelle_famille ? ` — ${f.libelle_famille}` : ''}</option>)}
                </select>
              </label>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>Dépôt</span>
                <select value={depot} onChange={(e) => setDepot(e.target.value)} style={styles.select}>
                  <option value="">Tous (global)</option>
                  {DEPOTS_PROPOSES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>Stock dispo</span>
                <select value={dispoFiltre} onChange={(e) => setDispoFiltre(e.target.value as 'tous' | 'oui' | 'non')} style={styles.select}>
                  <option value="tous">Tous</option>
                  <option value="oui">Avec stock disponible</option>
                  <option value="non">Sans stock disponible</option>
                </select>
              </label>
            </div>
            {filtresActifs && (
              <button type="button" className="stkBtn" onClick={reinitialiserFiltres} style={{ ...styles.ghostBtn, marginTop: 8, borderColor: 'rgba(193,104,60,0.5)', color: '#e0a685' }}>✕ Réinitialiser les filtres</button>
            )}
          </div>

          <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={styles.cardTitle}>
              Résultats{results ? ` — ${results.length}` : ''}
              {loading ? <span style={styles.muted}> · recherche…</span> : null}
            </div>
            {error && <div style={styles.errorBox}>{error}</div>}
            {results === null && !loading && (
              <div style={styles.muted}>Tape une référence ou une désignation, ou choisis un filtre pour parcourir le stock.</div>
            )}
            {results && results.length === 0 && !loading && <div style={styles.muted}>Aucune référence trouvée.</div>}
            <div style={styles.resultList}>
              {(results || []).map((r) => {
                const actif = selected?.reference === r.reference_article
                return (
                  <button
                    key={`${r.reference_article}-${r.depot}`}
                    type="button"
                    className="stkRow"
                    onClick={() => selectionner(r.reference_article, r.designation || '')}
                    style={{ ...styles.resultRow, ...(actif ? styles.resultRowActive : {}) }}
                  >
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={styles.resultRef}>{r.reference_article}</span>
                      <span style={styles.resultDesignation}>{r.designation || '—'}</span>
                      {depot && <span style={styles.resultDepot}>Dépôt : {depotCourt(r.depot)}</span>}
                    </span>
                    <span style={styles.resultStats}>
                      <span style={{ ...styles.resultStat, color: couleurDispo(r.stock_disponible) }}>{formatNumber(r.stock_disponible)}<small>dispo</small></span>
                      <span style={styles.resultStat}>{formatNumber(r.stock_reel)}<small>réel</small></span>
                      <span style={{ ...styles.resultStat, color: r.stock_a_terme < 0 ? '#e0a685' : undefined }}>{formatNumber(r.stock_a_terme)}<small>à terme</small></span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        {/* ── Zone principale : fiche article ── */}
        <div style={styles.main}>
          {selected ? (
            <ArticleDetail
              reference={selected.reference}
              designation={selected.designation}
              horizonMois={horizonMois}
              onHorizonChange={setHorizonMois}
              quantiteSimulee={quantiteSimulee}
              onQuantiteSimuleeChange={setQuantiteSimulee}
            />
          ) : (
            <div style={styles.emptyMain}>
              <div style={{ fontSize: 34 }}>📦</div>
              <div style={{ fontWeight: 700, color: '#fff', marginTop: 8, fontSize: 16 }}>Sélectionne une référence</div>
              <div style={{ ...styles.muted, marginTop: 6, maxWidth: 520, textAlign: 'center' }}>
                Le stock par dépôt, la projection sur les commandes clients et fournisseurs, les commandes non complètes à leur date de livraison et la date de disponibilité pour une nouvelle commande s'affichent ici.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fiche article ─────────────────────────────────────────────────────────
function ArticleDetail({
  reference, designation, horizonMois, onHorizonChange, quantiteSimulee, onQuantiteSimuleeChange,
}: {
  reference: string
  designation: string
  horizonMois: number
  onHorizonChange: (m: number) => void
  quantiteSimulee: string
  onQuantiteSimuleeChange: (v: string) => void
}) {
  const [designationResolue, setDesignationResolue] = useState(designation)
  const [depotRows, setDepotRows] = useState<DepotStockRow[] | null>(null)
  const [receptions, setReceptions] = useState<ReceptionRow[]>([])
  const [couverture, setCouverture] = useState<CouvertureRow[]>([])
  const [stockGlobal, setStockGlobal] = useState<{ stock_disponible: number; stock_reel: number; stock_a_terme: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [afficherDepotsVides, setAfficherDepotsVides] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function charger() {
      setLoading(true)
      setError(null)
      try {
        const [depotRes, recRes, couvRes, stockRes, refRes] = await Promise.all([
          supabase.rpc('get_stock_par_depot', { p_reference_article: reference }),
          supabase.from('v_couverture_stock_receptions').select('*').eq('reference_article', reference).order('date_reception_retenue', { ascending: true }),
          supabase.from('v_portefeuille_couverture_stock')
            .select('id,numero_document,numero_tiers,nom_tiers,representant,agence,date_creation_document,date_livraison,quantite,montant_ht,rang_service,stock_disponible,besoin_cumule,receptions_avant_livraison,stock_projete_a_date,manque_a_date,statut_couverture,date_couverture_estimee,retard_estime_jours,prochaine_reception_date,prochaine_reception_quantite,prochaine_reception_cdf,prochaine_reception_hypothese')
            .eq('reference_article', reference)
            .order('rang_service', { ascending: true }),
          supabase.from('v_stock_articles_latest').select('designation,stock_disponible,stock_reel,stock_a_terme').eq('reference_article', reference).maybeSingle(),
          designation ? Promise.resolve({ data: null }) : supabase.from('ref_articles').select('designation').eq('reference_article', reference).maybeSingle(),
        ])
        if (cancelled) return
        if (depotRes.error) throw depotRes.error
        if (recRes.error) throw recRes.error
        if (couvRes.error) throw couvRes.error
        setDepotRows((depotRes.data || []) as DepotStockRow[])
        setReceptions(((recRes.data || []) as any[]).map((r) => ({ ...r, quantite_attendue: toNumber(r.quantite_attendue) })) as ReceptionRow[])
        setCouverture(((couvRes.data || []) as any[]).map((r) => ({
          ...r,
          quantite: toNumber(r.quantite), montant_ht: toNumber(r.montant_ht), rang_service: toNumber(r.rang_service),
          stock_disponible: toNumber(r.stock_disponible), besoin_cumule: toNumber(r.besoin_cumule),
          receptions_avant_livraison: toNumber(r.receptions_avant_livraison), stock_projete_a_date: toNumber(r.stock_projete_a_date),
          manque_a_date: toNumber(r.manque_a_date),
          prochaine_reception_quantite: r.prochaine_reception_quantite === null ? null : toNumber(r.prochaine_reception_quantite),
          prochaine_reception_hypothese: Boolean(r.prochaine_reception_hypothese),
        })) as CouvertureRow[])
        const s = stockRes.data as any
        setStockGlobal(s ? { stock_disponible: toNumber(s.stock_disponible), stock_reel: toNumber(s.stock_reel), stock_a_terme: toNumber(s.stock_a_terme) } : null)
        const desig = designation || String(s?.designation || (refRes as any)?.data?.designation || '')
        setDesignationResolue(desig)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void charger()
    return () => { cancelled = true }
  }, [reference, designation])

  // Stock de départ de la projection : dispo global (sto_qte − sto_prepa),
  // même base que v_portefeuille_couverture_stock.
  const totalDepot = useMemo(() => {
    if (!depotRows) return null
    return depotRows.reduce(
      (acc, r) => ({
        stock_reel: acc.stock_reel + toNumber(r.stock_reel),
        stock_reserve: acc.stock_reserve + toNumber(r.stock_reserve),
        stock_disponible: acc.stock_disponible + toNumber(r.stock_disponible),
        stock_a_terme: acc.stock_a_terme + toNumber(r.stock_a_terme),
        stock_commande_fournisseur: acc.stock_commande_fournisseur + toNumber(r.stock_commande_fournisseur),
      }),
      { stock_reel: 0, stock_reserve: 0, stock_disponible: 0, stock_a_terme: 0, stock_commande_fournisseur: 0 },
    )
  }, [depotRows])

  const stock0 = couverture.length > 0 ? couverture[0].stock_disponible : (stockGlobal?.stock_disponible ?? totalDepot?.stock_disponible ?? 0)
  const events = useMemo(() => construireProjection(stock0, receptions, couverture), [stock0, receptions, couverture])
  const horizonFin = useMemo(() => addMonthsIso(todayIso(), horizonMois), [horizonMois])
  const totalReceptions = useMemo(() => receptions.reduce((s, r) => s + toNumber(r.quantite_attendue), 0), [receptions])
  const totalBesoins = useMemo(() => couverture.reduce((s, r) => s + r.quantite, 0), [couverture])
  const nonCompletes = useMemo(() => couverture.filter((r) => r.statut_couverture === 'RUPTURE' || r.statut_couverture === 'RECEPTION_TARDIVE'), [couverture])
  const receptionsAvecHypothese = receptions.filter((r) => r.hypothese_reception !== 'PREVUE').length

  const quantite = Math.max(0, Math.floor(toNumber(quantiteSimulee)))
  const dispoNouvelleCommande = useMemo(() => premiereDateDisponible(stock0, events, quantite), [stock0, events, quantite])
  const stockFinal = events.length > 0 ? events[events.length - 1].stockApres : stock0

  const { depotsAvecStock, depotsVides, maxDispo } = useMemo(() => {
    const rows = [...(depotRows || [])].sort((a, b) => toNumber(b.stock_disponible) - toNumber(a.stock_disponible) || a.depot.localeCompare(b.depot, 'fr'))
    const avec = rows.filter((r) => toNumber(r.stock_reel) !== 0 || toNumber(r.stock_reserve) !== 0 || toNumber(r.stock_disponible) !== 0)
    const vides = rows.filter((r) => !avec.includes(r))
    return { depotsAvecStock: avec, depotsVides: vides, maxDispo: Math.max(1, ...avec.map((r) => Math.max(0, toNumber(r.stock_disponible)))) }
  }, [depotRows])

  return (
    <div style={styles.detail}>
      {/* ── En-tête article ── */}
      <div style={styles.detailHeader}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.detailRef}>{reference}</div>
          <div style={styles.detailDesignation}>{designationResolue || '—'}</div>
        </div>
        <div style={styles.headerActions}>
          <a href={`/portefeuille-livraison?couverture=non-servable`} target="_blank" rel="noopener noreferrer" className="stkBtn" style={styles.ghostBtn}>Portefeuille livraison ↗</a>
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {/* ── Bandeau KPI ── */}
      <div style={styles.kpiRow}>
        <Kpi label="Disponible tous dépôts" value={loading ? '…' : formatNumber(stock0)} color={couleurDispo(stock0)} big />
        <Kpi label="Réel" value={loading || !totalDepot ? '…' : formatNumber(totalDepot.stock_reel)} />
        <Kpi label="Réservé" value={loading || !totalDepot ? '…' : formatNumber(totalDepot.stock_reserve)} color={totalDepot && totalDepot.stock_reserve > 0 ? '#D69A4A' : undefined} />
        <Kpi label="À terme (SAGE)" value={loading || !totalDepot ? '…' : formatNumber(totalDepot.stock_a_terme)} color={totalDepot && totalDepot.stock_a_terme < 0 ? '#e0a685' : undefined} />
        <Kpi label="Réceptions attendues" value={loading ? '…' : `+ ${formatNumber(totalReceptions)}`} color="#8FC7DA" sub={receptionsAvecHypothese > 0 ? `${receptionsAvecHypothese} CDF en retard / sans date → demain` : `${receptions.length} ligne(s) CDF`} />
        <Kpi label="Besoins CDC fermes" value={loading ? '…' : `− ${formatNumber(totalBesoins)}`} color="#E0A961" sub={`${couverture.length} ligne(s) · ${nonCompletes.length} non complète(s)`} />
        <Kpi label="Stock projeté fin de besoins" value={loading ? '…' : formatNumber(stockFinal)} color={couleurDispo(stockFinal)} sub="après toutes réceptions et CDC connus" />
      </div>

      {/* ── Projection ── */}
      <div style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div>
            <div style={styles.cardTitle}>Projection du stock disponible sur documents réels</div>
            <div style={styles.muted}>
              Stock dispo aujourd'hui, moins les commandes clients à leur date de livraison, plus les commandes fournisseurs à leur date de réception. Les CDF en retard ou sans date sont supposées reçues demain (pointillés).
            </div>
          </div>
          <div style={styles.segment}>
            {HORIZONS.map(([m, label]) => (
              <button key={m} type="button" className="stkBtn" onClick={() => onHorizonChange(m)} style={{ ...styles.segmentBtn, ...(horizonMois === m ? styles.segmentBtnActive : {}) }}>{label}</button>
            ))}
          </div>
        </div>
        {loading ? <div style={styles.skeleton} /> : <ProjectionChart stock0={stock0} events={events} debut={todayIso()} fin={horizonFin} />}
      </div>

      <div style={styles.twoCols}>
        {/* ── Alertes commandes non complètes ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            Commandes non complètes à la date de livraison client
            <span style={{ ...styles.countTag, background: nonCompletes.length > 0 ? 'rgba(193,104,60,0.25)' : 'rgba(255,255,255,0.08)', color: nonCompletes.length > 0 ? '#e0a685' : 'rgba(255,255,255,0.5)' }}>{nonCompletes.length}</span>
          </div>
          {loading ? <div style={styles.skeleton} /> : nonCompletes.length === 0 ? (
            <div style={styles.okBox}>✓ Toutes les commandes clients connues sur cette référence sont servables à leur date de livraison.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table className="stkTable" style={styles.table}>
                <thead>
                  <tr>
                    {['CDC', 'Client', 'Livraison', 'Qté', 'Manque', 'Statut', 'Complète le', 'Prochaine réception'].map((h) => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {nonCompletes.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>{r.numero_document}</td>
                      <td style={styles.td}>
                        <div style={{ color: '#fff' }}>{r.nom_tiers || r.numero_tiers}</div>
                        <div style={styles.tdSub}>{[r.agence, r.representant].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: r.date_livraison && r.date_livraison < todayIso() ? '#e0a685' : undefined }}>{formatDateFr(r.date_livraison)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatNumber(r.quantite)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#e0a685', fontWeight: 700 }}>{formatNumber(r.manque_a_date)}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, borderColor: STATUT_COLOR[r.statut_couverture], color: STATUT_COLOR[r.statut_couverture] }}>{STATUT_LABEL[r.statut_couverture]}</span></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {r.date_couverture_estimee
                          ? <span style={{ color: '#E0A961', fontWeight: 700 }}>{formatDateFr(r.date_couverture_estimee)}{r.retard_estime_jours !== null ? <span style={styles.tdSub}> +{r.retard_estime_jours} j</span> : null}</span>
                          : <span style={{ color: '#e0a685', fontWeight: 700 }}>Aucune réception connue</span>}
                      </td>
                      <td style={styles.td}>
                        {r.prochaine_reception_date
                          ? <><span style={{ color: '#8FC7DA' }}>{formatDateCourte(r.prochaine_reception_date)}</span> · +{formatNumber(r.prochaine_reception_quantite || 0)} <span style={styles.tdSub}>{r.prochaine_reception_cdf}{r.prochaine_reception_hypothese ? ' (hypothèse demain)' : ''}</span></>
                          : <span style={styles.tdSub}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={styles.expected}>
            <strong>Ce qui est attendu :</strong> chercher une substitution (autre référence), voir si une autre commande client peut être dépriorisée, puis contacter le client pour valider la solution et recaler la date de livraison dans SAGE / BLG.
          </div>
        </div>

        {/* ── Simulateur nouvelle commande ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Nouvelle commande sur cette référence</div>
          <div style={styles.muted}>Première date à laquelle la quantité peut être promise sans mettre en rupture les commandes clients déjà prises (stock projeté ≥ quantité à cette date et après).</div>
          <div style={styles.simRow}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Quantité</span>
              <input type="number" min={1} step={1} value={quantiteSimulee} onChange={(e) => onQuantiteSimuleeChange(e.target.value)} onFocus={(e) => e.target.select()} style={styles.input} />
            </label>
            <div style={styles.simResult}>
              {loading ? <div style={styles.muted}>…</div> : quantite <= 0 ? (
                <div style={styles.muted}>Saisis une quantité.</div>
              ) : dispoNouvelleCommande.date ? (
                <>
                  <div style={styles.simKicker}>{dispoNouvelleCommande.date === todayIso() ? 'Disponible dès' : 'Disponible à partir du'}</div>
                  <div style={{ ...styles.simDate, color: dispoNouvelleCommande.date === todayIso() ? '#8fd4a8' : '#E0A961' }}>
                    {dispoNouvelleCommande.date === todayIso() ? "aujourd'hui" : formatDateFr(dispoNouvelleCommande.date)}
                  </div>
                  <div style={styles.tdSub}>
                    {dispoNouvelleCommande.date === todayIso() ? '' : `dans ${daysBetween(todayIso(), dispoNouvelleCommande.date)} j · `}
                    stock projeté minimum ensuite : {formatNumber(dispoNouvelleCommande.niveau)} · reste {formatNumber(dispoNouvelleCommande.niveau - quantite)} après cette commande
                  </div>
                </>
              ) : (
                <>
                  <div style={styles.simKicker}>Aucune date connue</div>
                  <div style={{ ...styles.simDate, color: '#e0a685', fontSize: 18 }}>Réapprovisionnement nécessaire</div>
                  <div style={styles.tdSub}>Les réceptions connues ne couvrent pas les besoins déjà pris ({formatNumber(Math.max(0, quantite - Math.min(stockFinal, dispoNouvelleCommande.niveau)))} pièce(s) manquante(s) pour servir cette commande).</div>
                </>
              )}
            </div>
          </div>
          {!loading && events.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={styles.subTitle}>Chronologie des mouvements prévus</div>
              <div style={styles.tableWrap}>
                <table className="stkTable" style={styles.table}>
                  <thead><tr>{['Date', 'Mouvement', 'Détail', 'Qté', 'Stock après'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    <tr>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(todayIso())}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, borderColor: '#A6A181', color: '#E9E5D6' }}>Stock dispo</span></td>
                      <td style={styles.td}><span style={styles.tdSub}>tous dépôts</span></td>
                      <td style={{ ...styles.td, textAlign: 'right' }}></td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: couleurDispo(stock0) }}>{formatNumber(stock0)}</td>
                    </tr>
                    {events.map((e, i) => (
                      <tr key={`${e.type}-${e.label}-${i}`} style={{ opacity: e.date > horizonFin ? 0.5 : 1 }}>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(e.date)}{e.hypothese ? <span title="CDF en retard ou sans date : supposée reçue demain" style={{ color: '#E0A961' }}> *</span> : null}</td>
                        <td style={styles.td}><span style={{ ...styles.badge, borderColor: e.type === 'RECEPTION' ? '#8FC7DA' : '#E0A961', color: e.type === 'RECEPTION' ? '#8FC7DA' : '#E0A961' }}>{e.type === 'RECEPTION' ? 'Réception' : 'CDC'} {e.label}</span></td>
                        <td style={styles.td}><span style={styles.tdSub}>{e.detail || '—'}</span></td>
                        <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: e.quantite > 0 ? '#8FC7DA' : '#E0A961' }}>{e.quantite > 0 ? '+' : ''}{formatNumber(e.quantite)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: couleurDispo(e.stockApres) }}>{formatNumber(e.stockApres)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {receptionsAvecHypothese > 0 && <div style={{ ...styles.tdSub, marginTop: 6 }}>* CDF en retard ou sans date SAGE : réception supposée demain (hypothèse).</div>}
            </div>
          )}
        </div>
      </div>

      <div style={styles.twoCols}>
        {/* ── Stock par dépôt ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Stock disponible par dépôt</div>
          {loading ? <div style={styles.skeleton} /> : !depotRows || depotRows.length === 0 ? (
            <div style={styles.muted}>Aucune position de stock.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {depotsAvecStock.length === 0 && <div style={styles.muted}>Aucun dépôt avec du stock pour cette référence.</div>}
              {depotsAvecStock.map((r) => <LigneDepot key={r.depot} row={r} maxDispo={maxDispo} />)}
              {depotsVides.length > 0 && (
                <button type="button" onClick={() => setAfficherDepotsVides((v) => !v)} style={styles.linkBtn}>
                  {afficherDepotsVides ? 'Masquer' : 'Afficher'} les {depotsVides.length} dépôt{depotsVides.length > 1 ? 's' : ''} à zéro
                </button>
              )}
              {afficherDepotsVides && depotsVides.map((r) => <LigneDepot key={r.depot} row={r} maxDispo={maxDispo} />)}
            </div>
          )}
        </div>

        {/* ── Réceptions fournisseurs ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Commandes fournisseurs en cours (SAGE) <span style={styles.countTag}>{receptions.length}</span></div>
          {loading ? <div style={styles.skeleton} /> : receptions.length === 0 ? (
            <div style={styles.muted}>Aucune commande fournisseur non réceptionnée pour cette référence.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table className="stkTable" style={styles.table}>
                <thead><tr>{['Réception retenue', 'Date SAGE', 'N° CDF', 'Fournisseur', 'Dépôt', 'Qté'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {receptions.map((r) => (
                    <tr key={r.ligne_cdf_id}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: r.hypothese_reception === 'PREVUE' ? '#8FC7DA' : '#E0A961', fontWeight: 700 }}>
                        {formatDateFr(r.date_reception_retenue)}
                        {r.hypothese_reception === 'RETARD' ? <span style={styles.tdSub}> · en retard, supposée demain</span> : r.hypothese_reception === 'SANS_DATE' ? <span style={styles.tdSub}> · sans date, supposée demain</span> : null}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{r.date_livraison_sage ? formatDateFr(r.date_livraison_sage) : <span style={styles.tdSub}>à confirmer</span>}</td>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', color: '#fff' }}>{r.numero_cdf || '—'}</td>
                      <td style={styles.td}>{r.nom_fournisseur || r.numero_fournisseur || '—'}</td>
                      <td style={styles.td}>{r.depot_reception ? depotCourt(r.depot_reception) : '—'}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>+ {formatNumber(r.quantite_attendue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Graphe de projection (courbe en escalier) ─────────────────────────────
function ProjectionChart({ stock0, events, debut, fin }: { stock0: number; events: EvenementProjection[]; debut: string; fin: string }) {
  const width = 1100
  const height = 300
  const padding = { top: 18, right: 20, bottom: 34, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null) // index dans points

  const totalJours = Math.max(1, daysBetween(debut, fin))
  const x = (iso: string) => padding.left + (Math.min(Math.max(daysBetween(debut, iso), 0), totalJours) / totalJours) * innerW

  // Points de la courbe : (aujourd'hui, stock0) puis chaque événement dans l'horizon.
  const points = useMemo(() => {
    const pts: Array<{ date: string; stock: number; event: EvenementProjection | null }> = [{ date: debut, stock: stock0, event: null }]
    for (const e of events) {
      if (e.date > fin) break
      pts.push({ date: e.date, stock: e.stockApres, event: e })
    }
    return pts
  }, [events, stock0, debut, fin])

  const dernierNiveau = points[points.length - 1].stock
  const allValues = points.map((p) => p.stock)
  const maxVal = Math.max(1, ...allValues)
  const minVal = Math.min(0, ...allValues)
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH
  const yZero = y(0)

  // Courbe en escalier : niveau constant jusqu'à l'événement suivant.
  const path = useMemo(() => {
    let d = ''
    points.forEach((p, i) => {
      const px = x(p.date)
      const py = y(p.stock)
      if (i === 0) d += `M ${px} ${py}`
      else d += ` L ${px} ${y(points[i - 1].stock)} L ${px} ${py}`
    })
    d += ` L ${padding.left + innerW} ${y(dernierNiveau)}`
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, dernierNiveau, maxVal, minVal, totalJours])

  // Zone négative (sous zéro) : segments où le stock projeté est < 0.
  const negSegments = useMemo(() => {
    const segs: Array<{ x1: number; x2: number; ymin: number }> = []
    for (let i = 0; i < points.length; i += 1) {
      if (points[i].stock < 0) {
        const x1 = x(points[i].date)
        const x2 = i + 1 < points.length ? x(points[i + 1].date) : padding.left + innerW
        segs.push({ x1, x2, ymin: y(points[i].stock) })
      }
    }
    return segs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, maxVal, minVal, totalJours])

  // Graduations mensuelles.
  const mois = useMemo(() => {
    const out: Array<{ iso: string; label: string }> = []
    const d = new Date(`${debut}T00:00:00`)
    d.setDate(1); d.setMonth(d.getMonth() + 1)
    while (toIsoDate(d) <= fin) {
      out.push({ iso: toIsoDate(d), label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) })
      d.setMonth(d.getMonth() + 1)
    }
    return out
  }, [debut, fin])

  const ticks = useMemo(() => {
    const range = maxVal - minVal || 1
    return [minVal, minVal + range / 4, minVal + range / 2, minVal + (range * 3) / 4, maxVal]
  }, [maxVal, minVal])

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    let best = 0
    for (let i = 0; i < points.length; i += 1) if (x(points[i].date) <= svgX) best = i
    setHover(best)
  }

  const hp = hover !== null ? points[hover] : null
  const hpX = hp ? x(hp.date) : 0

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', cursor: 'crosshair' }} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="stk-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8FC7DA" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#8FC7DA" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <text x={padding.left - 8} y={y(t) + 3} fontSize={10} textAnchor="end" fill="rgba(255,255,255,0.45)" fontFamily="var(--font-mono)">{formatNumber(t)}</text>
          </g>
        ))}
        {mois.map((m) => (
          <g key={m.iso}>
            <line x1={x(m.iso)} y1={padding.top} x2={x(m.iso)} y2={padding.top + innerH} stroke="rgba(255,255,255,0.06)" />
            <text x={x(m.iso)} y={height - 12} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.45)">{m.label}</text>
          </g>
        ))}
        {/* ligne zéro */}
        <line x1={padding.left} y1={yZero} x2={width - padding.right} y2={yZero} stroke="#C1683C" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.8} />
        <text x={width - padding.right} y={yZero - 4} fontSize={10} textAnchor="end" fill="#e0a685">rupture</text>
        {/* zones négatives */}
        {negSegments.map((s, i) => (
          <rect key={i} x={s.x1} y={yZero} width={Math.max(0, s.x2 - s.x1)} height={Math.max(0, s.ymin - yZero)} fill="rgba(193,104,60,0.25)" />
        ))}
        {/* aire sous la courbe (positive) */}
        <path d={`${path} L ${padding.left + innerW} ${yZero} L ${padding.left} ${yZero} Z`} fill="url(#stk-area)" />
        <path d={path} fill="none" stroke="#8FC7DA" strokeWidth={2.4} strokeLinejoin="round" />
        {/* marqueurs d'événements */}
        {points.slice(1).map((p, i) => (
          <g key={i}>
            <circle cx={x(p.date)} cy={y(p.stock)} r={4} fill={p.event?.type === 'RECEPTION' ? '#8FC7DA' : '#E0A961'} stroke="#101A2E" strokeWidth={1.5} />
            {p.event?.hypothese && <circle cx={x(p.date)} cy={y(p.stock)} r={7} fill="none" stroke="#E0A961" strokeDasharray="2 2" />}
          </g>
        ))}
        {/* aujourd'hui */}
        <text x={padding.left} y={padding.top - 5} fontSize={10} fill="rgba(255,255,255,0.55)">aujourd'hui</text>
        {hp && (
          <line x1={hpX} y1={padding.top} x2={hpX} y2={padding.top + innerH} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        )}
      </svg>
      {hp && (
        <div style={{ ...styles.tooltip, left: `${Math.min(88, Math.max(6, (hpX / width) * 100))}%` }}>
          <div style={{ fontWeight: 700, color: '#fff' }}>{formatDateFr(hp.date)}</div>
          {hp.event ? (
            <div style={{ color: hp.event.type === 'RECEPTION' ? '#8FC7DA' : '#E0A961' }}>
              {hp.event.type === 'RECEPTION' ? 'Réception' : 'CDC'} {hp.event.label} : {hp.event.quantite > 0 ? '+' : ''}{formatNumber(hp.event.quantite)}
              {hp.event.detail ? <div style={styles.tdSub}>{hp.event.detail}</div> : null}
              {hp.event.hypothese ? <div style={styles.tdSub}>hypothèse : CDF en retard / sans date → demain</div> : null}
            </div>
          ) : <div style={{ color: '#E9E5D6' }}>Stock disponible aujourd'hui</div>}
          <div style={{ marginTop: 3 }}>Stock projeté : <strong style={{ color: couleurDispo(hp.stock) }}>{formatNumber(hp.stock)}</strong></div>
        </div>
      )}
      <div style={styles.legend}>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#8FC7DA' }} />Réception fournisseur</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#E0A961' }} />Commande client (CDC)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'transparent', border: '1.5px dashed #E0A961' }} />Réception supposée demain (CDF en retard / sans date)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'rgba(193,104,60,0.6)' }} />Période de rupture</span>
      </div>
    </div>
  )
}

// ── Petits composants ─────────────────────────────────────────────────────
function Kpi({ label, value, color, sub, big }: { label: string; value: string; color?: string; sub?: string; big?: boolean }) {
  return (
    <div style={{ ...styles.kpi, ...(big ? styles.kpiBig : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(big ? { fontSize: 36 } : {}), color: color || '#fff' }}>{value}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
    </div>
  )
}

function LigneDepot({ row, maxDispo }: { row: DepotStockRow; maxDispo: number }) {
  const dispo = toNumber(row.stock_disponible)
  const reel = toNumber(row.stock_reel)
  const reserve = toNumber(row.stock_reserve)
  const largeur = Math.max(0, Math.min(100, (Math.max(0, dispo) / maxDispo) * 100))
  const couleur = couleurDispo(dispo)
  return (
    <div style={styles.depotRow}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{depotCourt(row.depot)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: couleur }}>{formatNumber(dispo)}</span>
      </div>
      <div style={{ marginTop: 5, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${largeur}%`, height: '100%', borderRadius: 3, background: couleur }} />
      </div>
      <div style={{ marginTop: 4, display: 'flex', gap: 12, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)' }}>
        <span>réel <span style={{ color: 'rgba(255,255,255,0.8)' }}>{formatNumber(reel)}</span></span>
        <span>réservé <span style={{ color: reserve > 0 ? '#D69A4A' : 'rgba(255,255,255,0.8)' }}>{formatNumber(reserve)}</span></span>
        <span>cde fourn. <span style={{ color: 'rgba(255,255,255,0.8)' }}>{formatNumber(toNumber(row.stock_commande_fournisseur))}</span></span>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1700, margin: '0 auto', padding: '10px 4px 40px', color: '#F5F3EC', fontFamily: 'var(--font-body)' },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 },
  kicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  title: { margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  lead: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.6)', maxWidth: 900 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  layout: { display: 'grid', gridTemplateColumns: '380px minmax(0, 1fr)', gap: 16, alignItems: 'start' },
  side: { position: 'sticky', top: 130, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 150px)' },
  main: { minWidth: 0 },

  card: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: 16 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 10 },
  cardHeaderRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  subTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  countTag: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', letterSpacing: 0, textTransform: 'none' },
  muted: { fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 },
  hint: { marginTop: 6, fontSize: 11.5, color: 'rgba(166,161,129,0.9)' },
  errorBox: { marginBottom: 12, padding: 12, borderRadius: 12, border: '1px solid rgba(193,104,60,0.35)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13 },
  okBox: { padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(143,212,168,0.35)', background: 'rgba(143,212,168,0.08)', color: '#8fd4a8', fontSize: 13 },
  skeleton: { height: 120, borderRadius: 12, background: 'rgba(255,255,255,0.05)' },

  searchArea: { width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  filters: { marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  select: { height: 36, borderRadius: 9, border: '1px solid rgba(255,255,255,0.15)', background: '#141A26', color: '#fff', padding: '0 8px', fontSize: 13, fontFamily: 'inherit', width: '100%' },
  input: { height: 40, width: 120, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', boxSizing: 'border-box' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.78)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' },
  linkBtn: { marginTop: 4, alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'rgba(255,255,255,0.45)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', fontFamily: 'inherit' },

  resultList: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 },
  resultRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#F5F3EC', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' },
  resultRowActive: { borderColor: 'rgba(166,161,129,0.7)', background: 'rgba(166,161,129,0.16)' },
  resultRef: { display: 'block', fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 700, color: '#fff' },
  resultDesignation: { display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  resultDepot: { display: 'block', fontSize: 10.5, color: 'rgba(166,161,129,0.9)' },
  resultStats: { display: 'flex', gap: 10, flexShrink: 0 },
  resultStat: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 700, color: '#fff', lineHeight: 1.1 },

  emptyMain: { minHeight: 420, borderRadius: 18, border: '1px dashed rgba(255,255,255,0.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28 },

  detail: { display: 'flex', flexDirection: 'column', gap: 14 },
  detailHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  detailRef: { fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' },
  detailDesignation: { marginTop: 2, fontSize: 14, color: 'rgba(255,255,255,0.65)' },

  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 },
  kpi: { borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '12px 14px', minWidth: 0 },
  kpiBig: { border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.12)' },
  kpiLabel: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  kpiValue: { marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap' },
  kpiSub: { marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.35 },

  segment: { display: 'flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', flexShrink: 0 },
  segmentBtn: { padding: '6px 12px', borderRadius: 9, border: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.65)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  segmentBtnActive: { background: 'rgba(75,146,172,0.22)', borderColor: 'rgba(75,146,172,0.55)', color: '#8FC7DA' },

  twoCols: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' },

  tableWrap: { maxHeight: 360, overflow: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top' },
  tdSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  badge: { display: 'inline-flex', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, border: '1px solid', fontSize: 11, fontWeight: 700 },
  expected: { marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.10)', color: '#E9E5D6', fontSize: 12.5, lineHeight: 1.45 },

  simRow: { marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  simResult: { flex: 1, minWidth: 220, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' },
  simKicker: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  simDate: { marginTop: 2, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, lineHeight: 1.1 },

  depotRow: { borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '9px 12px' },

  tooltip: { position: 'absolute', top: 8, transform: 'translateX(-50%)', pointerEvents: 'none', whiteSpace: 'nowrap', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: '#0B1220', padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 24px rgba(0,0,0,0.4)', zIndex: 5 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
}
