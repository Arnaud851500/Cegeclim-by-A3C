'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Écran "Stock articles" (mobile) :
//   1. Recherche libre (référence ou désignation) OU liste de références
//      collées (une par ligne, ou séparées par virgule) -- détectée
//      automatiquement selon qu'il y a plusieurs "tokens" dans la saisie.
//   2. Filtres au-dessus de la recherche : famille macro -> famille,
//      dépôt (bascule l'affichage sur LE stock de ce dépôt plutôt que le
//      global), et disponibilité (oui/non). Passent tous par la RPC
//      search_stock_articles_mobile.
//   3. Liste de résultats avec le stock actuel.
//   4. Fiche détail par référence : total dispo, stock par dépôt
//      (get_stock_par_depot) + prochaines livraisons fournisseurs attendues
//      (v_commandes_fournisseurs_ouvertes_enrichies).
//      Peut aussi s'ouvrir directement via `cibleReference`.
//
//   ÉVOLUTION (2026-09-10) : le graphe de projection hebdomadaire (et
//   l'appel /api/stocks-disponibilites/detail qui l'alimentait) est
//   supprimé -- aucune valeur ajoutée sur mobile, et une requête de moins
//   à l'ouverture de la fiche. À la place, la lecture du stock disponible
//   par dépôt est mise en avant : bandeau total, puis une ligne par dépôt
//   avec le dispo en gros (vert/gris/rouge selon signe), une barre
//   proportionnelle au dépôt le mieux fourni, réel/réservé en secondaire,
//   dépôts à zéro repliés par défaut.
// ─────────────────────────────────────────────────────────────────────────

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

// Une ligne de commande fournisseur ouverte (pas encore livrée) pour la
// référence consultée -- affichée ligne à ligne avec sa date réelle.
type CommandeFournisseurRow = {
  numero_piece: string | null
  fournisseur_nom: string | null
  depot: string | null
  date_livraison_calculee: string | null
  quantite_attendue: number
}

// Dépôts physiques proposés au filtre -- exclut les dépôts TRANSIT_* (zones
// de transit internes, sans intérêt pour "où trouver du stock").
const DEPOTS_PROPOSES = [
  'ANGLET CEGECLIM', 'ANGOULEME CEGECLIM', 'ARCACHON CEGECLIM', 'ARTIGUES CEGECLIM',
  'BRIVE CEGECLIM', 'DAX CEGECLIM', 'FMS', 'LA ROCHELLE CEGECLIM',
  'MARMANDE CEGECLIM', 'MERIGNAC CEGECLIM', 'PAU CEGECLIM',
]

// SAGE utilise 1753-01-01 (date minimale DATETIME de SQL Server) comme
// valeur "vide" quand la date de livraison n'a pas encore été confirmée
// par le fournisseur. On l'affiche comme "Date à confirmer".
const SEUIL_DATE_VALIDE = '2000-01-01'

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
function dateLivraisonValide(iso?: string | null): boolean {
  return Boolean(iso) && iso! >= SEUIL_DATE_VALIDE
}
function depotCourt(depot: string): string {
  return String(depot || '').replace(/\s*CEGECLIM\s*$/i, '').trim() || depot
}
/** Couleur du dispo : vert si > 0, gris si 0, rouge si négatif. */
function couleurDispo(n: number): string {
  if (n > 0) return '#8fd4a8'
  if (n < 0) return '#e0a685'
  return 'rgba(255,255,255,0.35)'
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

export default function MobileStockArticles({
  cibleReference,
  cibleDesignation,
  onCibleConsommee,
}: {
  /** Référence à ouvrir directement en détail -- passée par MobileShell
   * quand la navigation vient d'un autre écran (ex. ligne d'article d'un
   * devis/BL/commande). Consommée une fois (onCibleConsommee). */
  cibleReference?: string | null
  cibleDesignation?: string | null
  onCibleConsommee?: () => void
} = {}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openReference, setOpenReference] = useState<{ reference: string; designation: string } | null>(null)

  // ── Filtres ──────────────────────────────────────────────────────────
  const [famillesRef, setFamillesRef] = useState<FamilleRow[] | null>(null)
  const [familleMacro, setFamilleMacro] = useState<string | null>(null)
  const [famille, setFamille] = useState<string | null>(null)
  const [depot, setDepot] = useState<string | null>(null)
  const [dispoFiltre, setDispoFiltre] = useState<'tous' | 'oui' | 'non'>('tous')
  const [panneauFamille, setPanneauFamille] = useState(false)
  const [panneauDepot, setPanneauDepot] = useState(false)
  const filtresActifs = Boolean(familleMacro || famille || depot || dispoFiltre !== 'tous')

  useEffect(() => {
    let cancelled = false
    async function chargerFamilles() {
      const { data } = await supabase.from('ref_familles').select('famille, famille_macro, libelle_famille').order('famille_macro')
      if (!cancelled) setFamillesRef((data || []) as FamilleRow[])
    }
    void chargerFamilles()
    return () => { cancelled = true }
  }, [])

  const famillesMacroDisponibles = useMemo(() => {
    if (!famillesRef) return []
    return Array.from(new Set(famillesRef.map((f) => f.famille_macro).filter(Boolean))).sort()
  }, [famillesRef])

  const famillesDuMacro = useMemo(() => {
    if (!famillesRef || !familleMacro) return []
    return famillesRef
      .filter((f) => f.famille_macro === familleMacro)
      .sort((a, b) => a.famille.localeCompare(b.famille))
  }, [famillesRef, familleMacro])

  // Ouverture directe via cible (venue d'un autre écran) -- une seule fois.
  useEffect(() => {
    if (!cibleReference) return
    setOpenReference({ reference: cibleReference, designation: cibleDesignation || '' })
    onCibleConsommee?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cibleReference])

  useEffect(() => {
    const q = query.trim()
    if (!q && !filtresActifs) {
      setResults(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(async () => {
      const refs = parseReferences(q)
      const isListe = refs.length > 1

      const { data, error: err } = await supabase.rpc('search_stock_articles_mobile', {
        p_query: isListe || !q ? null : q,
        p_references: isListe ? refs : null,
        p_famille_macro: familleMacro,
        p_famille: famille,
        p_depot: depot,
        p_disponible_only: dispoFiltre === 'tous' ? null : dispoFiltre === 'oui',
        p_limit: isListe ? 300 : 60,
      })

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
            famille_macro: r.famille_macro,
            depot: r.depot,
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
  }, [query, familleMacro, famille, depot, dispoFiltre, filtresActifs])

  const refsSaisies = useMemo(() => parseReferences(query), [query])
  const isListe = refsSaisies.length > 1

  function reinitialiserFiltres() {
    setFamilleMacro(null)
    setFamille(null)
    setDepot(null)
    setDispoFiltre('tous')
  }

  return (
    <div style={{ flex: 1, padding: '18px 3px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Barre de filtres ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FiltrePill
          actif={Boolean(familleMacro)}
          label={famille ? `Famille : ${famille}` : familleMacro ? `Famille : ${familleMacro}` : 'Famille'}
          onClick={() => setPanneauFamille(true)}
        />
        <FiltrePill
          actif={Boolean(depot)}
          label={depot ? `Dépôt : ${depotCourt(depot)}` : 'Dépôt'}
          onClick={() => setPanneauDepot(true)}
        />
        <button
          type="button"
          onClick={() => setDispoFiltre((v) => (v === 'tous' ? 'oui' : v === 'oui' ? 'non' : 'tous'))}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 999,
            border: `1px solid ${dispoFiltre !== 'tous' ? 'rgba(75,146,172,0.5)' : 'rgba(255,255,255,0.15)'}`,
            background: dispoFiltre !== 'tous' ? 'rgba(75,146,172,0.18)' : 'rgba(255,255,255,0.04)',
            color: dispoFiltre !== 'tous' ? '#8FC7DA' : 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 600,
          }}
        >
          Stock dispo : {dispoFiltre === 'tous' ? 'Tous' : dispoFiltre === 'oui' ? 'Oui' : 'Non'}
        </button>
        {filtresActifs && (
          <button
            type="button"
            onClick={reinitialiserFiltres}
            style={{ padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(193,104,60,0.4)', background: 'rgba(193,104,60,0.10)', color: '#e0a685', fontSize: 12, fontWeight: 600 }}
          >
            ✕ Filtres
          </button>
        )}
      </div>

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
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14.5, fontWeight: 700, color: '#fff' }}>{r.reference_article}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Détail ›</span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.designation || '—'}
              </div>
              {depot && (
                <div style={{ fontSize: 10.5, color: 'rgba(166,161,129,0.9)', marginBottom: 6 }}>Dépôt : {r.depot}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                <MiniStat label="Dispo" value={formatNumber(r.stock_disponible)} accent={couleurDispo(r.stock_disponible)} />
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
          Tape une référence ou une désignation, ou choisis un filtre ci-dessus pour parcourir.
        </div>
      )}

      {openReference && (
        <StockArticleDetailSheet
          reference={openReference.reference}
          designation={openReference.designation}
          onClose={() => setOpenReference(null)}
        />
      )}

      {panneauFamille && (
        <PanneauFamille
          famillesMacro={famillesMacroDisponibles}
          famillesDuMacro={famillesDuMacro}
          familleMacro={familleMacro}
          famille={famille}
          onChoisirMacro={(m) => { setFamilleMacro(m); setFamille(null) }}
          onChoisirFamille={(f) => setFamille(f)}
          onRetourMacro={() => setFamilleMacro(null)}
          onEffacer={() => { setFamilleMacro(null); setFamille(null) }}
          onClose={() => setPanneauFamille(false)}
        />
      )}

      {panneauDepot && (
        <PanneauDepot
          depot={depot}
          onChoisir={(d) => setDepot(d)}
          onClose={() => setPanneauDepot(false)}
        />
      )}
    </div>
  )
}

function FiltrePill({ label, actif, onClick }: { label: string; actif: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 999,
        border: `1px solid ${actif ? 'rgba(75,146,172,0.5)' : 'rgba(255,255,255,0.15)'}`,
        background: actif ? 'rgba(75,146,172,0.18)' : 'rgba(255,255,255,0.04)',
        color: actif ? '#8FC7DA' : 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 600,
        maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {label} ▾
    </button>
  )
}

function PanneauFamille({
  famillesMacro, famillesDuMacro, familleMacro, famille,
  onChoisirMacro, onChoisirFamille, onRetourMacro, onEffacer, onClose,
}: {
  famillesMacro: string[]
  famillesDuMacro: FamilleRow[]
  familleMacro: string | null
  famille: string | null
  onChoisirMacro: (m: string) => void
  onChoisirFamille: (f: string) => void
  onRetourMacro: () => void
  onEffacer: () => void
  onClose: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        style={{ width: '100%', maxWidth: 480, maxHeight: '75vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
            {familleMacro ? `Famille — ${familleMacro}` : 'Famille macro'}
          </div>
          {familleMacro && (
            <button onClick={onRetourMacro} style={{ fontSize: 12, color: '#8FC7DA', background: 'none', border: 'none' }}>‹ Retour</button>
          )}
        </div>

        {!familleMacro && (
          <>
            <PanneauChoix label="Toutes les familles" actif={false} onClick={onEffacer} />
            {famillesMacro.map((m) => (
              <PanneauChoix key={m} label={m} actif={false} onClick={() => onChoisirMacro(m)} />
            ))}
          </>
        )}

        {familleMacro && (
          <>
            <PanneauChoix label={`Toutes (${familleMacro})`} actif={!famille} onClick={() => onChoisirFamille('')} />
            {famillesDuMacro.map((f) => (
              <PanneauChoix
                key={f.famille}
                label={`${f.famille}${f.libelle_famille ? ` — ${f.libelle_famille}` : ''}`}
                actif={famille === f.famille}
                onClick={() => onChoisirFamille(f.famille)}
              />
            ))}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{ marginTop: 10, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
        >
          Fermer
        </button>
      </div>
    </div>
  )
}

function PanneauDepot({ depot, onChoisir, onClose }: { depot: string | null; onChoisir: (d: string | null) => void; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        style={{ width: '100%', maxWidth: 480, maxHeight: '75vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Dépôt</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
          Choisir un dépôt affiche directement son stock, sans avoir besoin de taper une recherche.
        </div>
        <PanneauChoix label="Tous les dépôts (global)" actif={!depot} onClick={() => { onChoisir(null); onClose() }} />
        {DEPOTS_PROPOSES.map((d) => (
          <PanneauChoix key={d} label={d} actif={depot === d} onClick={() => { onChoisir(d); onClose() }} />
        ))}
        <button
          type="button"
          onClick={onClose}
          style={{ marginTop: 10, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
        >
          Fermer
        </button>
      </div>
    </div>
  )
}

function PanneauChoix({ label, actif, onClick }: { label: string; actif: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left',
        padding: '11px 13px', borderRadius: 10,
        border: `1px solid ${actif ? 'rgba(75,146,172,0.5)' : 'rgba(255,255,255,0.08)'}`,
        background: actif ? 'rgba(75,146,172,0.14)' : 'rgba(255,255,255,0.03)',
        color: '#fff', fontSize: 14,
      }}
    >
      <span>{label}</span>
      {actif && <span style={{ color: '#8FC7DA' }}>✓</span>}
    </button>
  )
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: accent || '#fff' }}>{value}</div>
    </div>
  )
}

// ── Fiche détail : total dispo + stock par dépôt + livraisons attendues ──

function StockArticleDetailSheet({
  reference, designation, onClose,
}: { reference: string; designation: string; onClose: () => void }) {
  const [depotRows, setDepotRows] = useState<DepotStockRow[] | null>(null)
  const [depotLoading, setDepotLoading] = useState(true)
  const [depotError, setDepotError] = useState<string | null>(null)
  const [designationResolue, setDesignationResolue] = useState(designation)
  // Dépôts sans aucun stock (réel = réservé = dispo = 0) repliés par
  // défaut, pour ne montrer que là où il y a quelque chose.
  const [afficherDepotsVides, setAfficherDepotsVides] = useState(false)

  const [livraisonsRows, setLivraisonsRows] = useState<CommandeFournisseurRow[] | null>(null)
  const [livraisonsLoading, setLivraisonsLoading] = useState(true)
  const [livraisonsError, setLivraisonsError] = useState<string | null>(null)
  const [livraisonsOuvertes, setLivraisonsOuvertes] = useState(false)

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
    async function loadLivraisons() {
      setLivraisonsLoading(true)
      setLivraisonsError(null)
      const { data, error } = await supabase
        .from('v_commandes_fournisseurs_ouvertes_enrichies')
        .select('numero_piece, fournisseur_nom, depot, date_livraison_calculee, quantite_attendue')
        .eq('reference_article', reference)
        .gt('quantite_attendue', 0)
        .order('date_livraison_calculee', { ascending: true })
        .limit(20)
      if (cancelled) return
      if (error) {
        setLivraisonsError(error.message)
        setLivraisonsRows([])
      } else {
        setLivraisonsRows(
          ((data || []) as any[]).map((r) => ({
            numero_piece: r.numero_piece,
            fournisseur_nom: r.fournisseur_nom,
            depot: r.depot,
            date_livraison_calculee: r.date_livraison_calculee,
            quantite_attendue: toNumber(r.quantite_attendue),
          })),
        )
      }
      setLivraisonsLoading(false)
    }
    void loadLivraisons()
    return () => { cancelled = true }
  }, [reference])

  // Résout la désignation si arrivée vide (ouverture directe via
  // cibleReference) -- lookup léger, sans bloquer le reste de la fiche.
  useEffect(() => {
    if (designation) { setDesignationResolue(designation); return }
    let cancelled = false
    async function resoudre() {
      const { data } = await supabase.from('v_stock_articles_latest').select('designation').eq('reference_article', reference).maybeSingle()
      if (!cancelled && data?.designation) setDesignationResolue(String(data.designation))
    }
    void resoudre()
    return () => { cancelled = true }
  }, [reference, designation])

  const totalDepot = useMemo(() => {
    if (!depotRows) return null
    return depotRows.reduce(
      (acc, r) => ({
        stock_reel: acc.stock_reel + toNumber(r.stock_reel),
        stock_reserve: acc.stock_reserve + toNumber(r.stock_reserve),
        stock_disponible: acc.stock_disponible + toNumber(r.stock_disponible),
        stock_a_terme: acc.stock_a_terme + toNumber(r.stock_a_terme),
      }),
      { stock_reel: 0, stock_reserve: 0, stock_disponible: 0, stock_a_terme: 0 },
    )
  }, [depotRows])

  // Dépôts triés par dispo décroissant (puis nom), séparés en "avec stock"
  // et "vides" ; largeur de barre relative au dépôt le mieux fourni.
  const { depotsAvecStock, depotsVides, maxDispo } = useMemo(() => {
    const rows = [...(depotRows || [])]
      .sort((a, b) => toNumber(b.stock_disponible) - toNumber(a.stock_disponible) || a.depot.localeCompare(b.depot, 'fr'))
    const avec = rows.filter((r) => toNumber(r.stock_reel) !== 0 || toNumber(r.stock_reserve) !== 0 || toNumber(r.stock_disponible) !== 0)
    const vides = rows.filter((r) => !avec.includes(r))
    const max = Math.max(1, ...avec.map((r) => Math.max(0, toNumber(r.stock_disponible))))
    return { depotsAvecStock: avec, depotsVides: vides, maxDispo: max }
  }, [depotRows])

  const livraisonsTriees = useMemo(() => {
    if (!livraisonsRows) return []
    const avecDate = livraisonsRows.filter((r) => dateLivraisonValide(r.date_livraison_calculee))
    const sansDate = livraisonsRows.filter((r) => !dateLivraisonValide(r.date_livraison_calculee))
    return [...avecDate, ...sansDate]
  }, [livraisonsRows])

  const totalQuantiteAttendue = useMemo(
    () => livraisonsTriees.reduce((acc, r) => acc + r.quantite_attendue, 0),
    [livraisonsTriees],
  )

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
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: '#fff' }}>{reference}</span>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{designationResolue || '—'}</div>
            </div>
            <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none', flexShrink: 0 }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Bandeau total ── */}
          <div style={{ borderRadius: 14, border: '1px solid rgba(166,161,129,0.35)', background: 'rgba(166,161,129,0.10)', padding: '12px 14px' }}>
            {depotLoading || !totalDepot ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#A6A181', fontWeight: 700 }}>Disponible tous dépôts</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 700, lineHeight: 1.1, marginTop: 2, color: couleurDispo(totalDepot.stock_disponible) }}>
                    {formatNumber(totalDepot.stock_disponible)}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 10px', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.6)', textAlign: 'right' }}>
                  <span>réel</span><span style={{ color: '#fff' }}>{formatNumber(totalDepot.stock_reel)}</span>
                  <span>réservé</span><span style={{ color: '#fff' }}>{formatNumber(totalDepot.stock_reserve)}</span>
                  <span>à terme</span><span style={{ color: totalDepot.stock_a_terme < 0 ? '#e0a685' : '#fff' }}>{formatNumber(totalDepot.stock_a_terme)}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Par dépôt ── */}
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
              Stock disponible par dépôt
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
                {depotsAvecStock.length === 0 && (
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '8px 0' }}>Aucun dépôt avec du stock pour cette référence.</div>
                )}
                {depotsAvecStock.map((r) => <LigneDepot key={r.depot} row={r} maxDispo={maxDispo} />)}
                {depotsVides.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAfficherDepotsVides((v) => !v)}
                    style={{ marginTop: 4, alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'rgba(255,255,255,0.45)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                  >
                    {afficherDepotsVides ? 'Masquer' : 'Afficher'} les {depotsVides.length} dépôt{depotsVides.length > 1 ? 's' : ''} à zéro
                  </button>
                )}
                {afficherDepotsVides && depotsVides.map((r) => <LigneDepot key={r.depot} row={r} maxDispo={maxDispo} />)}
              </div>
            )}
          </div>

          {/* ── Prochaines livraisons fournisseurs (repliable) ── */}
          <div>
            <button
              type="button"
              onClick={() => setLivraisonsOuvertes((v) => !v)}
              disabled={livraisonsLoading || livraisonsTriees.length === 0}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', padding: 0, marginBottom: livraisonsOuvertes ? 8 : 0,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
                  Prochaines livraisons attendues
                </span>
                {!livraisonsLoading && livraisonsTriees.length > 0 && (
                  <span
                    style={{
                      display: 'inline-block', transform: livraisonsOuvertes ? 'rotate(180deg)' : 'none',
                      transition: 'transform .15s', color: 'rgba(255,255,255,0.4)', fontSize: 10,
                    }}
                  >
                    ▾
                  </span>
                )}
              </span>
              {livraisonsTriees.length > 0 && (
                <span style={{ fontSize: 11.5, color: '#8FC7DA', fontWeight: 600 }}>
                  Total {formatNumber(totalQuantiteAttendue)}
                </span>
              )}
            </button>
            {livraisonsError && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#e0a685' }}>{livraisonsError}</div>
            )}
            {livraisonsLoading ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '16px 0', textAlign: 'center' }}>Chargement…</div>
            ) : livraisonsTriees.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '8px 0 0' }}>
                Aucune commande fournisseur en cours pour cette référence.
              </div>
            ) : livraisonsOuvertes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {livraisonsTriees.map((r, i) => {
                  const dateValide = dateLivraisonValide(r.date_livraison_calculee)
                  return (
                    <div
                      key={`${r.numero_piece || 'cdf'}-${i}`}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        borderRadius: 10, border: '1px solid rgba(75,146,172,0.25)', background: 'rgba(75,146,172,0.08)',
                        padding: '9px 12px',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: dateValide ? '#8FC7DA' : '#D69A4A' }}>
                          {dateValide ? formatDateCourte(r.date_livraison_calculee) : 'Date à confirmer'}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {[r.numero_piece, r.fournisseur_nom, r.depot ? depotCourt(r.depot) : null].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        + {formatNumber(r.quantite_attendue)}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Une ligne de dépôt : nom, dispo en gros (couleur selon signe), barre
 * proportionnelle au dépôt le mieux fourni, réel/réservé en secondaire. */
function LigneDepot({ row, maxDispo }: { row: DepotStockRow; maxDispo: number }) {
  const dispo = toNumber(row.stock_disponible)
  const reel = toNumber(row.stock_reel)
  const reserve = toNumber(row.stock_reserve)
  const largeur = Math.max(0, Math.min(100, (Math.max(0, dispo) / maxDispo) * 100))
  const couleur = couleurDispo(dispo)
  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {depotCourt(row.depot)}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: couleur, flexShrink: 0 }}>
          {formatNumber(dispo)}
        </span>
      </div>
      <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${largeur}%`, height: '100%', borderRadius: 3, background: couleur, transition: 'width .2s' }} />
      </div>
      <div style={{ marginTop: 5, display: 'flex', gap: 12, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)' }}>
        <span>réel <span style={{ color: 'rgba(255,255,255,0.8)' }}>{formatNumber(reel)}</span></span>
        <span>réservé <span style={{ color: reserve > 0 ? '#D69A4A' : 'rgba(255,255,255,0.8)' }}>{formatNumber(reserve)}</span></span>
      </div>
    </div>
  )
}
