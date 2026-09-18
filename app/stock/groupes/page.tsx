'use client'

// ============================================================================
// app/stock/groupes/page.tsx — Disponibilité par groupe d'articles
// ----------------------------------------------------------------------------
// (2026-09-18) Groupes d'articles nommés (table stock_groupes_articles) et,
// pour le groupe choisi, à chaque échéance (aujourd'hui + fins de mois) :
//   • capacité de prise de commande livrable d'ici l'échéance sans repousser
//     une commande client déjà en base (min du stock projeté à partir de P) ;
//   • commandes clients déjà prises livrables sur la période, à leur date de
//     complétude (v_portefeuille_couverture_stock.date_couverture_estimee),
//     ventilées par référence et par agence ;
//   • arrivées de stock (CDF SAGE) datées.
// Calcul côté base : RPC get_stock_groupe_disponibilite(p_references,
// p_periodes) → jsonb { periodes, references, agences, receptions, cdc }.
// Même moteur d'événements que l'écran Stock articles (/stock).
// ?groupe=<uuid> ouvre directement un groupe ; ?refs=A,B,C un groupe ad hoc.
// À ajouter dans lib/navigation.ts sous « Stocks & logistique ».
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExcelJS from 'exceljs'

// ── Types ─────────────────────────────────────────────────────────────────
type Groupe = { id: string; nom: string; description: string | null; references_articles: string[]; updated_at: string }
type PeriodeTotal = { p: string; atp: number; cdc_livrables: number; nb_cdc_livrables: number; receptions: number }
type RefPeriode = { p: string; atp: number; cdc_livrables: number; receptions: number }
type RefDispo = { ref: string; designation: string | null; stock_dispo: number; premiere_date: string | null; periodes: RefPeriode[] }
type AgencePeriode = { p: string; q: number; nb: number }
type AgenceDispo = { agence: string; total: number; periodes: AgencePeriode[] }
type Reception = { d: string; q: number; n: number; refs: Record<string, number> }
type CdcRow = {
  ref: string; id: string; numero_document: string | null; nom_tiers: string | null; numero_tiers: string | null; agence: string
  date_creation: string | null; date_livraison: string | null; date_complete: string; quantite: number; montant_ht: number; statut: string
}
type Dispo = { periodes: PeriodeTotal[]; references: RefDispo[]; agences: AgenceDispo[]; receptions: Reception[]; cdc: CdcRow[] }

// ── Helpers ───────────────────────────────────────────────────────────────
function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function formatNumber(n: number | null | undefined): string { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('fr-FR') }
function formatMoney(n: number): string { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0) }
function formatDateFr(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
function formatDateCourte(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y.slice(2)}` }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function todayIso(): string { return toIsoDate(new Date()) }
function finDeMois(offset: number): string { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset + 1); d.setDate(0); return toIsoDate(d) }
function libellePeriode(p: string, index: number): string {
  if (index === 0) return `Aujourd'hui · ${formatDateCourte(p)}`
  const d = new Date(`${p}T00:00:00`)
  return `Fin ${d.toLocaleDateString('fr-FR', { month: 'long' })}`
}
function couleurAtp(n: number): string { if (n <= 0) return '#e0a685'; if (n < 50) return '#E0A961'; return '#8fd4a8' }
function parseReferences(q: string): string[] { return Array.from(new Set(q.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))) }
const STATUT_LABEL: Record<string, string> = { COUVERT: 'Couvert (stock)', COUVERT_PAR_RECEPTION: 'Couvert par réception', RECEPTION_TARDIVE: 'Réception tardive', RUPTURE: 'Rupture' }
const STATUT_COLOR: Record<string, string> = { COUVERT: '#8fd4a8', COUVERT_PAR_RECEPTION: '#8FC7DA', RECEPTION_TARDIVE: '#E0A961', RUPTURE: '#e0a685' }

// ── Page ──────────────────────────────────────────────────────────────────
export default function StockGroupesPage() {
  const [groupes, setGroupes] = useState<Groupe[]>([])
  const [groupeId, setGroupeId] = useState<string>('')
  const [refsAdHoc, setRefsAdHoc] = useState<string[]>([])
  const [horizonMois, setHorizonMois] = useState(3)
  const [data, setData] = useState<Dispo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editeur, setEditeur] = useState<{ id: string | null; nom: string; description: string; refs: string } | null>(null)
  const [sauvegarde, setSauvegarde] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Détail
  const [detailRef, setDetailRef] = useState('')
  const [detailAgence, setDetailAgence] = useState('')
  const [detailPeriode, setDetailPeriode] = useState('')

  const periodes = useMemo(() => [todayIso(), ...Array.from({ length: horizonMois }, (_, i) => finDeMois(i))], [horizonMois])
  const groupe = groupes.find((g) => g.id === groupeId) || null
  const references = groupe ? groupe.references_articles : refsAdHoc

  async function chargerGroupes(): Promise<Groupe[]> {
    const { data: rows, error: err } = await supabase.from('stock_groupes_articles').select('id,nom,description,references_articles,updated_at').order('nom')
    if (err) { setError(err.message); return [] }
    const list = (rows || []) as Groupe[]
    setGroupes(list)
    return list
  }

  useEffect(() => {
    void (async () => {
      const list = await chargerGroupes()
      const params = new URLSearchParams(window.location.search)
      const g = params.get('groupe')
      const refs = params.get('refs')
      if (refs) { setRefsAdHoc(parseReferences(refs)); setGroupeId('') } else if (g && list.some((x) => x.id === g)) setGroupeId(g)
      else if (list.length > 0) setGroupeId(list[0].id)
    })()
  }, [])

  useEffect(() => {
    if (references.length === 0) { setData(null); return }
    let cancelled = false
    async function charger() {
      setLoading(true); setError(null)
      const { data: res, error: err } = await supabase.rpc('get_stock_groupe_disponibilite', { p_references: references, p_periodes: periodes })
      if (cancelled) return
      if (err) { setError(err.message); setData(null) } else {
        const r = res as any
        setData({
          periodes: ((r.periodes || []) as any[]).map((p) => ({ p: p.p, atp: toNumber(p.atp), cdc_livrables: toNumber(p.cdc_livrables), nb_cdc_livrables: toNumber(p.nb_cdc_livrables), receptions: toNumber(p.receptions) })),
          references: ((r.references || []) as any[]).map((x) => ({ ref: x.ref, designation: x.designation, stock_dispo: toNumber(x.stock_dispo), premiere_date: x.premiere_date, periodes: ((x.periodes || []) as any[]).map((p) => ({ p: p.p, atp: toNumber(p.atp), cdc_livrables: toNumber(p.cdc_livrables), receptions: toNumber(p.receptions) })) })),
          agences: ((r.agences || []) as any[]).map((a) => ({ agence: a.agence, total: toNumber(a.total), periodes: ((a.periodes || []) as any[]).map((p) => ({ p: p.p, q: toNumber(p.q), nb: toNumber(p.nb) })) })),
          receptions: ((r.receptions || []) as any[]).map((x) => ({ d: x.d, q: toNumber(x.q), n: toNumber(x.n), refs: x.refs || {} })),
          cdc: ((r.cdc || []) as any[]).map((c) => ({ ...c, quantite: toNumber(c.quantite), montant_ht: toNumber(c.montant_ht) })),
        })
      }
      setLoading(false)
    }
    void charger()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references.join('|'), periodes.join('|')])

  function choisirGroupe(id: string) {
    setGroupeId(id); setRefsAdHoc([]); setDetailRef(''); setDetailAgence(''); setDetailPeriode('')
    const url = new URL(window.location.href); url.searchParams.set('groupe', id); url.searchParams.delete('refs'); window.history.replaceState(null, '', url.toString())
  }

  async function sauvegarderGroupe() {
    if (!editeur) return
    const refs = parseReferences(editeur.refs)
    if (!editeur.nom.trim() || refs.length === 0) { setError('Un nom et au moins une référence sont nécessaires.'); return }
    setSauvegarde(true); setError(null)
    const payload = { nom: editeur.nom.trim(), description: editeur.description.trim() || null, references_articles: refs }
    const res = editeur.id
      ? await supabase.from('stock_groupes_articles').update(payload).eq('id', editeur.id).select('id').single()
      : await supabase.from('stock_groupes_articles').insert(payload).select('id').single()
    setSauvegarde(false)
    if (res.error) { setError(res.error.message); return }
    const list = await chargerGroupes()
    setEditeur(null)
    const id = (res.data as any)?.id as string
    if (id && list.some((g) => g.id === id)) choisirGroupe(id)
  }

  async function supprimerGroupe(g: Groupe) {
    if (!window.confirm(`Supprimer le groupe « ${g.nom} » ?`)) return
    const { error: err } = await supabase.from('stock_groupes_articles').delete().eq('id', g.id)
    if (err) { setError(err.message); return }
    const list = await chargerGroupes()
    setEditeur(null)
    if (list.length > 0) choisirGroupe(list[0].id); else { setGroupeId(''); setData(null) }
  }

  const receptionsHorizon = useMemo(() => (data ? data.receptions.filter((r) => r.d <= periodes[periodes.length - 1]) : []), [data, periodes])
  const maxReception = useMemo(() => Math.max(1, ...receptionsHorizon.map((r) => r.q)), [receptionsHorizon])
  const agencesTriees = useMemo(() => (data ? [...data.agences].sort((a, b) => (b.periodes[b.periodes.length - 1]?.q ?? 0) - (a.periodes[a.periodes.length - 1]?.q ?? 0)) : []), [data])
  const maxAgence = useMemo(() => Math.max(1, ...agencesTriees.map((a) => a.periodes[a.periodes.length - 1]?.q ?? 0)), [agencesTriees])

  const cdcDetail = useMemo(() => {
    if (!data) return []
    return data.cdc.filter((c) => (!detailRef || c.ref === detailRef) && (!detailAgence || c.agence === detailAgence) && (!detailPeriode || c.date_complete <= detailPeriode))
  }, [data, detailRef, detailAgence, detailPeriode])
  const detailActif = Boolean(detailRef || detailAgence || detailPeriode)

  async function exporterExcel() {
    if (!data) return
    setExporting(true)
    try {
      const wb = new ExcelJS.Workbook(); wb.creator = 'CEGECLIM by A3C'
      const header = (ws: ExcelJS.Worksheet) => { ws.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }; c.font = { color: { argb: 'FFF5F3EC' }, bold: true } }); ws.views = [{ state: 'frozen', ySplit: 1 }] }
      const libs = periodes.map((p, i) => libellePeriode(p, i))
      const ws1 = wb.addWorksheet('Synthèse')
      ws1.columns = [{ header: 'Échéance', key: 'p', width: 22 }, { header: 'Capacité de vente', key: 'atp', width: 18 }, { header: 'CDC livrables (pièces)', key: 'cdc', width: 22 }, { header: 'CDC livrables (nb)', key: 'nb', width: 18 }, { header: 'Réceptions cumulées', key: 'rec', width: 20 }]
      header(ws1); data.periodes.forEach((p, i) => ws1.addRow({ p: libs[i], atp: p.atp, cdc: p.cdc_livrables, nb: p.nb_cdc_livrables, rec: p.receptions }))
      const ws2 = wb.addWorksheet('Par référence')
      ws2.columns = [{ header: 'Référence', key: 'ref', width: 16 }, { header: 'Désignation', key: 'des', width: 40 }, { header: 'Dispo SAGE', key: 'dispo', width: 12 }, { header: '1ʳᵉ pièce vendable', key: 'pd', width: 18 }, ...periodes.flatMap((p, i) => [{ header: `Capacité ${libs[i]}`, key: `atp${i}`, width: 18 }, { header: `CDC livrables ${libs[i]}`, key: `cdc${i}`, width: 20 }])]
      header(ws2); data.references.forEach((r) => ws2.addRow({ ref: r.ref, des: r.designation, dispo: r.stock_dispo, pd: formatDateFr(r.premiere_date), ...Object.fromEntries(r.periodes.flatMap((p, i) => [[`atp${i}`, p.atp], [`cdc${i}`, p.cdc_livrables]])) }))
      const ws3 = wb.addWorksheet('Par agence')
      ws3.columns = [{ header: 'Agence', key: 'agence', width: 16 }, ...periodes.map((p, i) => ({ header: `CDC livrables ${libs[i]}`, key: `q${i}`, width: 20 }))]
      header(ws3); data.agences.forEach((a) => ws3.addRow({ agence: a.agence, ...Object.fromEntries(a.periodes.map((p, i) => [`q${i}`, p.q])) }))
      const ws4 = wb.addWorksheet('Réceptions')
      ws4.columns = [{ header: 'Date', key: 'd', width: 12 }, { header: 'Pièces', key: 'q', width: 10 }, { header: 'Lignes CDF', key: 'n', width: 10 }, { header: 'Détail', key: 'refs', width: 60 }]
      header(ws4); data.receptions.forEach((r) => ws4.addRow({ d: formatDateFr(r.d), q: r.q, n: r.n, refs: Object.entries(r.refs).map(([k, v]) => `${k}: ${v}`).join(' · ') }))
      const ws5 = wb.addWorksheet('Commandes clients')
      ws5.columns = [{ header: 'Référence', key: 'ref', width: 16 }, { header: 'CDC', key: 'numero_document', width: 12 }, { header: 'Client', key: 'nom_tiers', width: 30 }, { header: 'N° tiers', key: 'numero_tiers', width: 10 }, { header: 'Agence', key: 'agence', width: 14 }, { header: 'Créée le', key: 'date_creation', width: 12 }, { header: 'Livraison demandée', key: 'date_livraison', width: 18 }, { header: 'Complète le', key: 'date_complete', width: 12 }, { header: 'Qté', key: 'quantite', width: 8 }, { header: 'Montant HT', key: 'montant_ht', width: 14, style: { numFmt: '#,##0 €' } }, { header: 'Statut', key: 'statut', width: 22 }]
      header(ws5); data.cdc.forEach((c) => ws5.addRow({ ...c, date_creation: formatDateFr(c.date_creation), date_livraison: formatDateFr(c.date_livraison), date_complete: formatDateFr(c.date_complete), statut: STATUT_LABEL[c.statut] || c.statut }))
      ws5.autoFilter = { from: 'A1', to: 'K1' }
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `disponibilite-${(groupe?.nom || 'groupe').replace(/[^\w-]+/g, '_')}-${todayIso()}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setExporting(false) }
  }

  const derniere = data ? data.periodes[data.periodes.length - 1] : null

  return (
    <div style={styles.page}>
      <style>{`
        .sgBtn:hover { background: rgba(255,255,255,0.10); color: #fff; border-color: rgba(255,255,255,0.3); }
        .sgBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
        .sgTable th { position: sticky; top: 0; background: #101A2E; z-index: 1; }
        .sgTable tbody tr.sgClick { cursor: pointer; }
        .sgTable tbody tr.sgClick:hover td { background: rgba(255,255,255,0.05); }
      `}</style>

      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Stocks &amp; logistique</div>
          <h1 style={styles.title}>Disponibilité par groupe d'articles</h1>
          <div style={styles.lead}>Capacité de prise de commande livrable d'ici chaque échéance sans repousser une commande client déjà en base, en regard des commandes déjà prises livrables sur la même période (à leur date de complétude, pas à la date demandée).</div>
        </div>
        <div style={styles.params}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Groupe</span>
            <select value={groupeId} onChange={(e) => choisirGroupe(e.target.value)} style={{ ...styles.select, minWidth: 300 }}>
              {refsAdHoc.length > 0 && <option value="">Sélection ad hoc ({refsAdHoc.length} réf.)</option>}
              {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom} — {g.references_articles.length} référence{g.references_articles.length > 1 ? 's' : ''}</option>)}
              {groupes.length === 0 && refsAdHoc.length === 0 && <option value="">Aucun groupe</option>}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Horizon</span>
            <select value={horizonMois} onChange={(e) => setHorizonMois(Number(e.target.value))} style={styles.select}>
              {[2, 3, 4, 6].map((m) => <option key={m} value={m}>{m} fins de mois</option>)}
            </select>
          </label>
          <button type="button" className="sgBtn" onClick={() => setEditeur({ id: null, nom: '', description: '', refs: refsAdHoc.join('\n') })} style={styles.ghostBtn}>+ Nouveau groupe</button>
          {groupe && <button type="button" className="sgBtn" onClick={() => setEditeur({ id: groupe.id, nom: groupe.nom, description: groupe.description || '', refs: groupe.references_articles.join('\n') })} style={styles.ghostBtn}>✎ Modifier</button>}
          {data && <button type="button" className="sgBtn" onClick={exporterExcel} disabled={exporting} style={styles.ghostBtn}>{exporting ? 'Export…' : 'Excel'}</button>}
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {editeur && (
        <div style={{ ...styles.card, border: '1px solid rgba(166,161,129,0.5)' }}>
          <div style={styles.cardTitle}>{editeur.id ? 'Modifier le groupe' : 'Nouveau groupe'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={styles.field}><span style={styles.fieldLabel}>Nom</span><input value={editeur.nom} onChange={(e) => setEditeur({ ...editeur, nom: e.target.value })} placeholder="Murales Airhome 400" style={styles.input} /></label>
              <label style={styles.field}><span style={styles.fieldLabel}>Description</span><input value={editeur.description} onChange={(e) => setEditeur({ ...editeur, description: e.target.value })} placeholder="Pourquoi ce groupe, pour qui" style={styles.input} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="sgBtn" onClick={sauvegarderGroupe} disabled={sauvegarde} style={styles.primaryBtn}>{sauvegarde ? 'Enregistrement…' : 'Enregistrer'}</button>
                <button type="button" className="sgBtn" onClick={() => setEditeur(null)} style={styles.ghostBtn}>Annuler</button>
                {editeur.id && groupe && <button type="button" className="sgBtn" onClick={() => supprimerGroupe(groupe)} style={{ ...styles.ghostBtn, marginLeft: 'auto', borderColor: 'rgba(193,104,60,0.5)', color: '#e0a685' }}>Supprimer</button>}
              </div>
            </div>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Références — une par ligne, ou séparées par virgule / espace ({parseReferences(editeur.refs).length} détectée{parseReferences(editeur.refs).length > 1 ? 's' : ''})</span>
              <textarea value={editeur.refs} onChange={(e) => setEditeur({ ...editeur, refs: e.target.value })} rows={6} style={{ ...styles.input, height: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400, resize: 'vertical' }} />
            </label>
          </div>
        </div>
      )}

      {references.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={styles.fieldLabel}>Composition</span>
          {references.map((r) => <button key={r} type="button" className="sgBtn" onClick={() => setDetailRef((v) => (v === r ? '' : r))} style={{ ...styles.chip, ...(detailRef === r ? styles.chipActive : {}) }}>{r}</button>)}
          {groupe?.description && <span style={{ ...styles.muted, marginLeft: 8 }}>{groupe.description}</span>}
        </div>
      )}

      {references.length === 0 && !loading && (
        <div style={styles.emptyMain}>
          <div style={{ fontSize: 34 }}>📦</div>
          <div style={{ fontWeight: 700, color: '#fff', marginTop: 8, fontSize: 16 }}>Crée un groupe d'articles</div>
          <div style={{ ...styles.muted, marginTop: 6, maxWidth: 520, textAlign: 'center' }}>Un nom, une liste de références : la capacité de vente par échéance, les commandes déjà prises et leur répartition par agence s'affichent ici.</div>
        </div>
      )}
      {loading && <div style={styles.skeleton} />}

      {data && !loading && (
        <>
          {/* ── Cartes par échéance ── */}
          <div style={{ ...styles.kpiRow, gridTemplateColumns: `repeat(${data.periodes.length}, minmax(0, 1fr))` }}>
            {data.periodes.map((p, i) => {
              const last = i === data.periodes.length - 1
              const actif = detailPeriode === p.p
              return (
                <button key={p.p} type="button" onClick={() => setDetailPeriode((v) => (v === p.p ? '' : p.p))} style={{ ...styles.kpi, ...(p.atp > 0 && last ? styles.kpiOk : {}), ...(actif ? styles.kpiActive : {}), textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={styles.kpiLabel}>{libellePeriode(p.p, i)}</div>
                  <div style={{ ...styles.kpiValue, fontSize: 40, color: couleurAtp(p.atp) }}>{formatNumber(p.atp)}</div>
                  <div style={styles.kpiSub}>{i === 0 ? 'pièces vendables en livraison immédiate' : 'pièces vendables livrables d\'ici là'}</div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5, color: '#E9E5D6' }}>
                    <span>CDC en base livrables : <b style={{ fontFamily: 'var(--font-mono)', color: '#E0A961' }}>{formatNumber(p.cdc_livrables)}</b> <span style={styles.tdSub}>({formatNumber(p.nb_cdc_livrables)} lignes)</span></span>
                    <span>Réceptions cumulées : <b style={{ fontFamily: 'var(--font-mono)', color: '#8FC7DA' }}>+ {formatNumber(p.receptions)}</b></span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* ── Arrivées de stock ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Arrivées de stock du groupe <span style={styles.muted}>(commandes fournisseurs SAGE, CDF en retard ou sans date → demain)</span></div>
              <div style={styles.muted}>{receptionsHorizon.length} date{receptionsHorizon.length > 1 ? 's' : ''} · {formatNumber(receptionsHorizon.reduce((s, r) => s + r.q, 0))} pièces sur l'horizon</div>
            </div>
            {receptionsHorizon.length === 0 ? <div style={styles.muted}>Aucune réception attendue sur l'horizon.</div> : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 160, overflowX: 'auto', paddingBottom: 4 }}>
                {receptionsHorizon.map((r) => (
                  <div key={r.d} title={Object.entries(r.refs).map(([k, v]) => `${k} : +${v}`).join('\n')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 72, flex: 1, height: '100%' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8FC7DA' }}>+{formatNumber(r.q)}</span>
                    <div style={{ width: '100%', height: `${Math.max(4, (r.q / maxReception) * 110)}px`, borderRadius: '4px 4px 0 0', background: '#8FC7DA' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{formatDateCourte(r.d)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.twoCols}>
            {/* ── Par référence ── */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Par référence — capacité de vente livrable d'ici… <span style={styles.muted}>(en gris : CDC en base livrables sur la même échéance)</span></div>
              <div style={styles.tableWrap}>
                <table className="sgTable" style={styles.table}>
                  <thead><tr>
                    <th style={styles.th}>Référence</th><th style={{ ...styles.th, textAlign: 'right' }}>Dispo SAGE</th>
                    {data.periodes.map((p, i) => <th key={p.p} style={{ ...styles.th, textAlign: 'right' }}>{i === 0 ? 'Immédiat' : libellePeriode(p.p, i)}</th>)}
                    <th style={styles.th}>1ʳᵉ pièce vendable</th>
                  </tr></thead>
                  <tbody>
                    {data.references.map((r) => (
                      <tr key={r.ref} className="sgClick" onClick={() => setDetailRef((v) => (v === r.ref ? '' : r.ref))} style={{ background: detailRef === r.ref ? 'rgba(166,161,129,0.14)' : undefined }}>
                        <td style={styles.td}>
                          <a href={`/stock?ref=${encodeURIComponent(r.ref)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', textDecoration: 'none' }}>{r.ref} ↗</a>
                          <div style={styles.tdSub}>{r.designation || '—'}</div>
                        </td>
                        <td style={{ ...styles.tdNum, color: r.stock_dispo > 0 ? '#8fd4a8' : '#e0a685' }}>{formatNumber(r.stock_dispo)}</td>
                        {r.periodes.map((p) => (
                          <td key={p.p} style={{ ...styles.tdNum, color: couleurAtp(p.atp), fontWeight: p.atp > 0 ? 700 : 400 }}>{formatNumber(p.atp)} <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>/ {formatNumber(p.cdc_livrables)}</span></td>
                        ))}
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: r.premiere_date ? (r.premiere_date === todayIso() ? '#8fd4a8' : '#E0A961') : '#e0a685', fontWeight: 700 }}>{r.premiere_date ? (r.premiere_date === todayIso() ? "aujourd'hui" : formatDateFr(r.premiere_date)) : 'aucune réception suffisante'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...styles.muted, marginTop: 8 }}>« Dispo SAGE » = stock disponible tous dépôts, déjà réservé par les CDC en retard : la capacité réelle de vente immédiate est la colonne « Immédiat ». Clic sur une ligne pour filtrer le détail.</div>
            </div>

            {/* ── Par agence ── */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Par agence — CDC en base livrables d'ici… <span style={styles.muted}>(cumul, pièces · agence du collaborateur de la fiche client)</span></div>
              <div style={styles.tableWrap}>
                <table className="sgTable" style={styles.table}>
                  <thead><tr>
                    <th style={styles.th}>Agence</th>
                    {data.periodes.map((p, i) => <th key={p.p} style={{ ...styles.th, textAlign: 'right' }}>{i === 0 ? 'Auj.' : libellePeriode(p.p, i)}</th>)}
                    <th style={{ ...styles.th, width: 110 }}>Part</th>
                  </tr></thead>
                  <tbody>
                    {agencesTriees.map((a) => {
                      const dernier = a.periodes[a.periodes.length - 1]?.q ?? 0
                      return (
                        <tr key={a.agence} className="sgClick" onClick={() => setDetailAgence((v) => (v === a.agence ? '' : a.agence))} style={{ background: detailAgence === a.agence ? 'rgba(166,161,129,0.14)' : undefined }}>
                          <td style={{ ...styles.td, color: '#fff' }}>{a.agence}</td>
                          {a.periodes.map((p, i) => <td key={p.p} style={{ ...styles.tdNum, fontWeight: i === a.periodes.length - 1 ? 700 : 400 }}>{formatNumber(p.q)}</td>)}
                          <td style={styles.td}><div style={styles.barTrack}><div style={{ ...styles.barFill, width: `${(dernier / maxAgence) * 100}%` }} /></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {derniere && (
                <div style={styles.expected}>
                  <strong>Discours commercial, lu tel quel :</strong> {data.periodes.slice(0, -1).every((p) => p.atp === 0)
                    ? `aucune prise de commande en livraison courte avant ${libellePeriode(derniere.p, data.periodes.length - 1).toLowerCase()}`
                    : `capacité de livraison courte limitée à ${formatNumber(data.periodes[1]?.atp ?? 0)} pièces d'ici ${libellePeriode(data.periodes[1]?.p ?? derniere.p, 1).toLowerCase()}`}
                  {' '}; {formatNumber(derniere.atp)} pièces vendables d'ici {libellePeriode(derniere.p, data.periodes.length - 1).toLowerCase()}. Les {formatNumber(derniere.receptions)} pièces reçues sur l'horizon servent d'abord les {formatNumber(derniere.cdc_livrables)} pièces de commandes déjà en base{agencesTriees.slice(0, 2).map((a) => `, dont ${formatNumber(a.periodes[a.periodes.length - 1]?.q ?? 0)} pour ${a.agence}`).join('')}.
                </div>
              )}
            </div>
          </div>

          {/* ── Détail des CDC ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>
                Commandes clients en base <span style={styles.countTag}>{cdcDetail.length}</span>
                {detailRef && <span style={{ ...styles.countTag, color: '#E9E5D6' }}>{detailRef}</span>}
                {detailAgence && <span style={{ ...styles.countTag, color: '#E9E5D6' }}>{detailAgence}</span>}
                {detailPeriode && <span style={{ ...styles.countTag, color: '#E9E5D6' }}>complètes ≤ {formatDateCourte(detailPeriode)}</span>}
                {detailActif && <button type="button" className="sgBtn" onClick={() => { setDetailRef(''); setDetailAgence(''); setDetailPeriode('') }} style={{ ...styles.chip, padding: '2px 8px' }}>✕ tout afficher</button>}
              </div>
              <div style={styles.muted}>Clic sur une échéance, une référence ou une agence pour filtrer · {formatNumber(cdcDetail.reduce((s, c) => s + c.quantite, 0))} pièces · {formatMoney(cdcDetail.reduce((s, c) => s + c.montant_ht, 0))} HT</div>
            </div>
            <div style={{ ...styles.tableWrap, maxHeight: 520 }}>
              <table className="sgTable" style={styles.table}>
                <thead><tr>{['Référence', 'CDC', 'Client', 'Agence', 'Créée', 'Livraison demandée', 'Complète le', 'Qté', 'Montant HT', 'Statut'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {cdcDetail.slice(0, 600).map((c) => (
                    <tr key={c.id}>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', color: '#fff', whiteSpace: 'nowrap' }}>{c.ref}</td>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>{c.numero_document}</td>
                      <td style={styles.td}><div style={{ color: '#fff' }}>{c.nom_tiers || c.numero_tiers}</div><div style={styles.tdSub}>{c.numero_tiers}</div></td>
                      <td style={styles.td}>{c.agence}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(c.date_creation)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: c.date_livraison && c.date_livraison < todayIso() ? '#e0a685' : undefined }}>{formatDateCourte(c.date_livraison)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', fontWeight: 700, color: c.date_complete > (c.date_livraison || '') ? '#E0A961' : '#8fd4a8' }}>{formatDateCourte(c.date_complete)}</td>
                      <td style={styles.tdNum}>{formatNumber(c.quantite)}</td>
                      <td style={styles.tdNum}>{formatMoney(c.montant_ht)}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, borderColor: STATUT_COLOR[c.statut] || '#A6A181', color: STATUT_COLOR[c.statut] || '#E9E5D6' }}>{STATUT_LABEL[c.statut] || c.statut}</span></td>
                    </tr>
                  ))}
                  {cdcDetail.length === 0 && <tr><td colSpan={10} style={{ ...styles.td, textAlign: 'center' }}><span style={styles.muted}>Aucune commande pour ce filtre.</span></td></tr>}
                </tbody>
              </table>
            </div>
            {cdcDetail.length > 600 && <div style={{ ...styles.muted, marginTop: 6 }}>600 premières lignes affichées — l'export Excel contient tout.</div>}
          </div>
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1700, margin: '0 auto', padding: '10px 4px 40px', color: '#F5F3EC', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  kicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  title: { margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  lead: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.6)', maxWidth: 980 },
  params: { display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  select: { height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: '#141A26', color: '#fff', padding: '0 10px', fontSize: 13.5, fontFamily: 'inherit' },
  input: { height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '8px 10px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' },
  primaryBtn: { height: 40, padding: '0 16px', borderRadius: 10, border: '1px solid #A6A181', background: '#A6A181', color: '#0B1220', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.78)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' },
  chip: { padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer' },
  chipActive: { borderColor: 'rgba(166,161,129,0.8)', background: 'rgba(166,161,129,0.2)' },

  card: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: 16 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 10, flexWrap: 'wrap' },
  cardHeaderRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  countTag: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', letterSpacing: 0, textTransform: 'none' },
  muted: { fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, textTransform: 'none', letterSpacing: 0, fontWeight: 400 },
  errorBox: { padding: 12, borderRadius: 12, border: '1px solid rgba(193,104,60,0.35)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13 },
  skeleton: { height: 160, borderRadius: 12, background: 'rgba(255,255,255,0.05)' },
  emptyMain: { minHeight: 360, borderRadius: 18, border: '1px dashed rgba(255,255,255,0.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28 },

  kpiRow: { display: 'grid', gap: 12 },
  kpi: { borderRadius: 16, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '14px 16px', minWidth: 0 },
  kpiOk: { border: '1px solid rgba(92,138,110,0.8)', background: 'rgba(19,37,30,0.8)' },
  kpiActive: { outline: '2px solid rgba(166,161,129,0.8)', outlineOffset: 1 },
  kpiLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  kpiValue: { marginTop: 6, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' },
  kpiSub: { marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.35 },

  twoCols: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' },
  tableWrap: { maxHeight: 460, overflow: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' },
  tdSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  badge: { display: 'inline-flex', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, border: '1px solid', fontSize: 11, fontWeight: 700 },
  barTrack: { height: 8, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', borderRadius: 3, background: '#E0A961' },
  expected: { marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.10)', color: '#E9E5D6', fontSize: 12.5, lineHeight: 1.45 },
}
