'use client'

/**
 * Écran « Équivalences R/O AirH2O 600 / 800 » (menu Stocks & logistique, /stock/equivalences-ro).
 * ---------------------------------------------------------------------------
 * Créé le 21/10/2026.
 *
 * Pénurie R/O hiver 2026-2027 : les groupes extérieurs AirH2O 600 (split, RAS-xWH(V)RP2E) et
 * AirH2O 800 (monobloc, RASM-x(V)TW2E) sont en tension jusqu'à fin mars. En face de chaque
 * groupe, on propose des groupes d'anciennes générations en stock (Premium, S-Combi, Yutaki M/H,
 * AirH2O 400…) — règle d'Arnaud : puissance équivalente ou supérieure, gestion commerciale et
 * marge, sans passer par le technique.
 *
 * Un tableau par taille (code Hitachi) :
 *  - référence, désignation, prix public (SAGE ar_prixven) ;
 *  - stock dispo (réel − préparé) et quantité promettable aujourd'hui (get_references_penurie) ;
 *  - arrivages mois par mois jusqu'à fin mars (CDF en cours ; janv.→mars = non confirmés) ;
 *  - CDC à livrer et CDC non tenables ;
 *  - backups : groupes d'anciennes générations avec prix public et stock dispo.
 *
 * Glisser-déposer :
 *  - depuis le panneau « Anciennes générations » (ou la recherche d'article) vers une ligne = ajouter ;
 *  - d'une ligne à une autre = déplacer (Ctrl ou Alt enfoncé = copier) ;
 *  - sur un autre backup de la même ligne = changer l'ordre de proposition ;
 *  - × = retirer.
 * Les associations sont partagées (table stock_equivalences) : tout le monde voit les mêmes.
 *
 * Sources : RPC get_equivalences_ro, rechercher_article_equivalence ; table stock_equivalences
 * (SQL supabase/migrations/20261021b_equivalences_ro.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type MoisData = { mois: string; arrivages: number; cdc: number; non_tenable: number; nb_cdc_non_tenables: number }

type Cible = {
  ref: string
  designation: string | null
  famille: string | null
  gamme: '600' | '800'
  taille: string
  alim: string
  prix: number | null
  stock_reel: number | null
  stock_disponible: number | null
  qte_dispo_aujourdhui: number | null
  besoin_cdc_total: number | null
  nb_cdc: number | null
  date_prochaine_dispo: string | null
  mois: MoisData[]
}

type Backup = {
  ref: string
  designation: string | null
  famille: string | null
  prix: number | null
  stock_reel?: number | null
  stock_disponible: number | null
  qte_dispo_aujourdhui?: number | null
  besoin_cdc_total?: number | null
  nb_cdc?: number | null
  receptions_total?: number | null
  prochaine_reception_date?: string | null
  sommeil?: boolean | null
}

type Lien = {
  id: string
  ref_cible: string
  ref_backup: string
  rang: number
  origine: 'auto' | 'manuel'
  commentaire: string | null
  modifie_par?: string | null
  modifie_le?: string | null
}

type Donnees = { calcule_le: string; cibles: Cible[]; pool: Backup[]; liens: Lien[] }

type Glisse = { type: 'pool'; ref: string } | { type: 'lien'; id: string; ref: string; from: string }

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const n0 = (v: number | null | undefined) => Number(v ?? 0)
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPrix(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
}
function libMois(m: string): string {
  const [a, mm] = m.split('-')
  return `${NOMS_MOIS[Number(mm) - 1] || m} ${a.slice(2)}`
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
function normaliser(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}
/** Mois non confirmés : au-delà de décembre de l'année en cours (janv. → mars). */
function nonConfirme(m: string): boolean {
  return Number(m.slice(0, 4)) > new Date().getFullYear()
}
/** Famille lisible pour le panneau des anciennes générations. */
function typeAncien(b: Backup): string {
  if (b.famille === '00RORASM' || b.ref.startsWith('RASM')) return 'Monobloc (Yutaki M / H)'
  if (b.famille === '00ROH2OUE' || b.ref.startsWith('HZKF')) return 'AirH2O 400'
  if (b.famille === '00RORASUE' || b.ref.startsWith('RAS-')) return 'Split (Premium, S-Combi, IVX)'
  return 'Autres'
}
const TAILLE_KW_600: Record<string, string> = { '1.5': '3,5 kW', '2': '4 kW', '2.5': '6 kW', '3': '8 kW', '3.5': '8,5 kW', '4': '10 kW', '5': '12 kW', '6': '14 kW' }
const TAILLE_KW_800: Record<string, string> = { '2': '4 kW', '3': '6 kW', '3.5': '8 kW', '4': '10 kW', '5': '12 kW', '6': '14 kW' }

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>
}

function StockTag({ stock, libre }: { stock: number | null | undefined; libre?: number | null }) {
  const s = n0(stock)
  const cls = s <= 0 ? 'bg-red-50 text-red-700' : s < 3 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'
  return (
    <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold ${cls}`}
      title={libre !== undefined && libre !== null ? `Stock dispo ${fmtNum(s)} · promettable aujourd’hui ${fmtNum(libre)} (après CDC déjà prises)` : `Stock dispo ${fmtNum(s)}`}>
      stock {fmtNum(s)}{libre !== undefined && libre !== null && libre !== s ? <span className="font-semibold opacity-75"> · libre {fmtNum(libre)}</span> : null}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function EquivalencesRO() {
  const [donnees, setDonnees] = useState<Donnees | null>(null)
  const [liens, setLiens] = useState<Lien[]>([])
  const [poolExtra, setPoolExtra] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const [gammeF, setGammeF] = useState<'' | '600' | '800'>('')
  const [alimF, setAlimF] = useState('')
  const [search, setSearch] = useState('')
  const [poolSearch, setPoolSearch] = useState('')
  const [poolAvecStock, setPoolAvecStock] = useState(true)
  const [rechercheArt, setRechercheArt] = useState('')
  const [resultatsArt, setResultatsArt] = useState<Backup[]>([])
  const [dropCible, setDropCible] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)
  const glisse = useRef<Glisse | null>(null)

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_equivalences_ro')
    if (error) { setErreur(messageErreur(error)); setDonnees(null) }
    else {
      const d = data as Donnees
      setDonnees(d)
      setLiens(d.liens || [])
      setPoolExtra([])
    }
    setLoading(false)
  }, [])
  useEffect(() => { void charger() }, [charger])

  // Rechargement léger des seules associations (après une modification)
  const rechargerLiens = useCallback(async () => {
    const { data, error } = await supabase.from('stock_equivalences')
      .select('id,ref_cible,ref_backup,rang,origine,commentaire,created_by_email,updated_by_email,updated_at')
      .eq('groupe', 'RO_AIRH2O')
      .order('ref_cible').order('rang').order('created_at')
    if (error) { setErreur(messageErreur(error)); return }
    setLiens((data || []).map((l) => ({
      id: l.id as string, ref_cible: l.ref_cible as string, ref_backup: l.ref_backup as string, rang: Number(l.rang),
      origine: l.origine as 'auto' | 'manuel', commentaire: (l.commentaire as string | null) ?? null,
      modifie_par: (l.updated_by_email as string | null) || (l.created_by_email as string | null), modifie_le: l.updated_at as string,
    })))
  }, [])

  // Recherche d'article (n'importe quelle référence SAGE)
  useEffect(() => {
    const q = rechercheArt.trim()
    if (q.length < 2) { setResultatsArt([]); return }
    let annule = false
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('rechercher_article_equivalence', { p_q: q })
      if (annule) return
      if (error) setErreur(messageErreur(error))
      else setResultatsArt((data || []) as Backup[])
    }, 300)
    return () => { annule = true; clearTimeout(t) }
  }, [rechercheArt])

  const cibles = useMemo(() => donnees?.cibles ?? [], [donnees])
  const moisListe = useMemo(() => cibles[0]?.mois.map((m) => m.mois) ?? [], [cibles])
  const pool = useMemo(() => {
    const m = new Map<string, Backup>()
    ;(donnees?.pool ?? []).forEach((b) => m.set(b.ref, b))
    poolExtra.forEach((b) => { if (!m.has(b.ref)) m.set(b.ref, b) })
    return m
  }, [donnees, poolExtra])
  const refsCibles = useMemo(() => new Set(cibles.map((c) => c.ref)), [cibles])

  const liensParCible = useMemo(() => {
    const m = new Map<string, Lien[]>()
    liens.forEach((l) => { const a = m.get(l.ref_cible) || []; a.push(l); m.set(l.ref_cible, a) })
    m.forEach((a) => a.sort((x, y) => x.rang - y.rang || x.ref_backup.localeCompare(y.ref_backup)))
    return m
  }, [liens])
  const usagesBackup = useMemo(() => {
    const m = new Map<string, string[]>()
    liens.forEach((l) => { const a = m.get(l.ref_backup) || []; a.push(l.ref_cible); m.set(l.ref_backup, a) })
    return m
  }, [liens])

  // Cibles filtrées, regroupées par taille
  const tailles = useMemo(() => {
    const s = normaliser(search.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = cibles.filter((c) => {
      if (gammeF && c.gamme !== gammeF) return false
      if (alimF && c.alim !== alimF) return false
      if (termes.length) {
        const backups = (liensParCible.get(c.ref) || []).map((l) => `${l.ref_backup} ${pool.get(l.ref_backup)?.designation ?? ''}`).join(' ')
        const hay = normaliser(`${c.ref} ${c.designation} ${backups}`)
        if (!termes.every((t) => hay.includes(t))) return false
      }
      return true
    })
    const m = new Map<string, Cible[]>()
    list.forEach((c) => { const a = m.get(c.taille) || []; a.push(c); m.set(c.taille, a) })
    return Array.from(m.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([taille, rows]) => ({ taille, rows: rows.sort((a, b) => a.gamme.localeCompare(b.gamme) || a.alim.localeCompare(b.alim)) }))
  }, [cibles, gammeF, alimF, search, liensParCible, pool])

  // Panneau anciennes générations
  const poolListe = useMemo(() => {
    const s = normaliser(poolSearch.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = Array.from(pool.values()).filter((b) => {
      if (refsCibles.has(b.ref)) return false
      if (poolAvecStock && n0(b.stock_disponible) <= 0 && !usagesBackup.has(b.ref)) return false
      if (termes.length && !termes.every((t) => normaliser(`${b.ref} ${b.designation}`).includes(t))) return false
      return true
    })
    const m = new Map<string, Backup[]>()
    list.forEach((b) => { const k = typeAncien(b); const a = m.get(k) || []; a.push(b); m.set(k, a) })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'))
      .map(([k, rows]) => ({ k, rows: rows.sort((a, b) => a.ref.localeCompare(b.ref, 'fr', { numeric: true })) }))
  }, [pool, poolSearch, poolAvecStock, refsCibles, usagesBackup])

  // ── Écritures ──────────────────────────────────────────────────────────
  async function ajouter(cible: string, ref: string, avantId?: string) {
    if (cible === ref) return
    const existants = liensParCible.get(cible) || []
    if (existants.some((l) => l.ref_backup === ref)) { setInfo(`${ref} est déjà proposé pour ${cible}.`); return }
    setEnCours(true); setErreur(null)
    const rang = existants.length ? Math.max(...existants.map((l) => l.rang)) + 1 : 1
    const { data, error } = await supabase.from('stock_equivalences')
      .insert({ groupe: 'RO_AIRH2O', ref_cible: cible, ref_backup: ref, rang, origine: 'manuel' }).select('id').single()
    if (error) setErreur(messageErreur(error))
    else if (avantId && data) await reordonner(cible, [...existants.map((l) => l.id), data.id as string], data.id as string, avantId)
    await rechargerLiens()
    setEnCours(false)
  }

  async function deplacer(id: string, ref: string, from: string, vers: string, copier: boolean, avantId?: string) {
    if (from === vers) {
      if (avantId && avantId !== id) {
        setEnCours(true)
        await reordonner(vers, (liensParCible.get(vers) || []).map((l) => l.id), id, avantId)
        await rechargerLiens()
        setEnCours(false)
      }
      return
    }
    if (copier) { await ajouter(vers, ref, avantId); return }
    const cibleLiens = liensParCible.get(vers) || []
    setEnCours(true); setErreur(null)
    if (vers === ref) { setEnCours(false); return }
    if (cibleLiens.some((l) => l.ref_backup === ref)) {
      // déjà présent sur la ligne d'arrivée : on retire simplement de la ligne de départ
      const { error } = await supabase.from('stock_equivalences').delete().eq('id', id)
      if (error) setErreur(messageErreur(error))
    } else {
      const rang = cibleLiens.length ? Math.max(...cibleLiens.map((l) => l.rang)) + 1 : 1
      const { error } = await supabase.from('stock_equivalences').update({ ref_cible: vers, rang, origine: 'manuel' }).eq('id', id)
      if (error) setErreur(messageErreur(error))
      else if (avantId) await reordonner(vers, [...cibleLiens.map((l) => l.id), id], id, avantId)
    }
    await rechargerLiens()
    setEnCours(false)
  }

  /** Place `id` juste avant `avantId` et renumérote les rangs de la ligne. */
  async function reordonner(cible: string, ids: string[], id: string, avantId: string) {
    const ordre = ids.filter((x) => x !== id)
    const pos = ordre.indexOf(avantId)
    ordre.splice(pos >= 0 ? pos : ordre.length, 0, id)
    for (let i = 0; i < ordre.length; i += 1) {
      const { error } = await supabase.from('stock_equivalences').update({ rang: i + 1 }).eq('id', ordre[i])
      if (error) { setErreur(messageErreur(error)); return }
    }
    void cible
  }

  async function retirer(id: string) {
    setEnCours(true); setErreur(null)
    const { error } = await supabase.from('stock_equivalences').delete().eq('id', id)
    if (error) setErreur(messageErreur(error))
    await rechargerLiens()
    setEnCours(false)
  }

  // ── Glisser-déposer ────────────────────────────────────────────────────
  function debutGlissePool(e: React.DragEvent, b: Backup) {
    glisse.current = { type: 'pool', ref: b.ref }
    if (!pool.has(b.ref)) setPoolExtra((p) => [...p, b])
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', b.ref)
  }
  function debutGlisseLien(e: React.DragEvent, l: Lien) {
    glisse.current = { type: 'lien', id: l.id, ref: l.ref_backup, from: l.ref_cible }
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', l.ref_backup)
    e.stopPropagation()
  }
  function survol(e: React.DragEvent, cible: string) {
    if (!glisse.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = glisse.current.type === 'pool' || e.ctrlKey || e.altKey ? 'copy' : 'move'
    if (dropCible !== cible) setDropCible(cible)
  }
  function deposer(e: React.DragEvent, cible: string, avantId?: string) {
    e.preventDefault(); e.stopPropagation()
    const g = glisse.current
    glisse.current = null
    setDropCible(null)
    if (!g || enCours) return
    if (g.type === 'pool') void ajouter(cible, g.ref, avantId)
    else void deplacer(g.id, g.ref, g.from, cible, e.ctrlKey || e.altKey, avantId)
  }
  function finGlisse() { glisse.current = null; setDropCible(null) }

  // ── Export Excel ───────────────────────────────────────────────────────
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Équivalences R-O')
      ws.addRow([`Équivalences R/O AirH2O 600 / 800 — calculé le ${new Date().toLocaleString('fr-FR')} — arrivages janv.→mars non confirmés`]).font = { bold: true }
      const entete = ['Taille', 'Gamme', 'Alimentation', 'Référence', 'Désignation', 'Prix public', 'Stock dispo', 'Promettable auj.']
      moisListe.forEach((m) => entete.push(`Arrivages ${libMois(m)}${nonConfirme(m) ? ' (non confirmé)' : ''}`))
      entete.push('CDC à livrer (qté)', 'CDC (nb)', 'Non tenables', 'Rang backup', 'Backup réf.', 'Backup désignation', 'Backup prix public', 'Backup stock dispo', 'Backup promettable auj.', 'Backup aussi proposé pour')
      ws.addRow(entete).font = { bold: true }
      tailles.forEach(({ taille, rows }) => rows.forEach((c) => {
        const base: (string | number)[] = [taille, c.gamme, c.alim, c.ref, c.designation || '', n0(c.prix), n0(c.stock_disponible), n0(c.qte_dispo_aujourdhui)]
        c.mois.forEach((m) => base.push(n0(m.arrivages)))
        base.push(n0(c.besoin_cdc_total), n0(c.nb_cdc), c.mois.reduce((s, m) => s + n0(m.non_tenable), 0))
        const bks = liensParCible.get(c.ref) || []
        if (bks.length === 0) ws.addRow([...base, '', '', '', '', '', '', ''])
        bks.forEach((l, i) => {
          const b = pool.get(l.ref_backup)
          const autres = (usagesBackup.get(l.ref_backup) || []).filter((x) => x !== c.ref).join(', ')
          ws.addRow([...(i === 0 ? base : base.map((v, j) => (j < 5 ? v : ''))), i + 1, l.ref_backup, b?.designation || '', n0(b?.prix), n0(b?.stock_disponible), n0(b?.qte_dispo_aujourdhui), autres])
        })
      }))
      ws.getColumn(4).width = 18; ws.getColumn(5).width = 40
      ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 2 }]
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url
      a.download = `equivalences_RO_airh2o_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const segBtn = (actif: boolean) => `rounded-md px-3 py-1.5 ${actif ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474] hover:text-[#3A362E]'}`
  const alims = useMemo(() => Array.from(new Set(cibles.map((c) => c.alim))).sort(), [cibles])

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* Bandeau */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Équivalences R/O — AirH2O 600 / 800</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              En face de chaque groupe extérieur AirH2O, les groupes d’anciennes générations à proposer (puissance égale ou supérieure) · glisser-déposer pour ajouter, déplacer ou réordonner
              {donnees?.calcule_le && <> · calculé à {new Date(donnees.calcule_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enCours && <span className="text-[12px] font-semibold text-[#8A8474]">Enregistrement…</span>}
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || cibles.length === 0}
              className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">{exportEnCours ? 'Export…' : '⬇ Excel'}</button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recalculer" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            <span>{erreur}{/get_equivalences_ro|stock_equivalences/.test(erreur) ? ' — la migration 20261021b_equivalences_ro.sql est-elle appliquée ?' : ''}</span>
            <button type="button" onClick={() => setErreur(null)} className="font-bold">✕</button>
          </div>
        )}
        {info && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 py-2 text-[12.5px] text-[#3A362E]">
            <span>{info}</span>
            <button type="button" onClick={() => setInfo(null)} className="font-bold text-[#8A8474]">✕</button>
          </div>
        )}

        {/* Filtres */}
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
            <button type="button" onClick={() => setGammeF('')} className={segBtn(gammeF === '')}>600 + 800</button>
            <button type="button" onClick={() => setGammeF('600')} className={segBtn(gammeF === '600')}>AirH2O 600 (split)</button>
            <button type="button" onClick={() => setGammeF('800')} className={segBtn(gammeF === '800')}>AirH2O 800 (monobloc)</button>
          </div>
          <select value={alimF} onChange={(e) => setAlimF(e.target.value)} className={ctl}>
            <option value="">Alimentation : toutes</option>
            {alims.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, désignation, backup…" className={`${ctl} w-[280px] font-medium`} />
          <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-[#8A8474]">
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-[#E5D3B0] bg-[#FBF1E1]" />arrivages janv. → mars : non confirmés</span>
            <span>Glisser une ligne de backup avec <b>Ctrl</b> / <b>Alt</b> enfoncé = copier au lieu de déplacer</span>
          </span>
        </section>

        <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Tableaux par taille */}
          <div className="min-w-0 space-y-2.5">
            {loading && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Calcul en cours…</div>}
            {!loading && tailles.length === 0 && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Aucun groupe avec ces filtres.</div>}
            {!loading && tailles.map(({ taille, rows }) => {
              const tot = {
                stock: rows.reduce((s, c) => s + n0(c.stock_disponible), 0),
                cdc: rows.reduce((s, c) => s + n0(c.besoin_cdc_total), 0),
                ferme: rows.reduce((s, c) => s + c.mois.filter((m) => !nonConfirme(m.mois)).reduce((x, m) => x + n0(m.arrivages), 0), 0),
                nonConf: rows.reduce((s, c) => s + c.mois.filter((m) => nonConfirme(m.mois)).reduce((x, m) => x + n0(m.arrivages), 0), 0),
              }
              const backupsTaille = new Set(rows.flatMap((c) => (liensParCible.get(c.ref) || []).map((l) => l.ref_backup)))
              const stockBackups = Array.from(backupsTaille).reduce((s, r) => s + Math.max(0, n0(pool.get(r)?.stock_disponible)), 0)
              const kw = [TAILLE_KW_600[taille] && `600 : ${TAILLE_KW_600[taille]}`, TAILLE_KW_800[taille] && `800 : ${TAILLE_KW_800[taille]}`].filter(Boolean).join(' · ')
              return (
                <section key={taille} className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E5E1D8] bg-[#FAF8F3] px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-[15px] font-bold">Taille {taille.replace('.', ',')}</h2>
                      <span className="text-[11.5px] text-[#8A8474]">{kw}</span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-[11.5px] text-[#5E5A50]">
                      <span>Stock dispo <b className="text-[#111820]">{fmtNum(tot.stock)}</b></span>
                      <span>Arrivages oct.→déc. <b className="text-[#111820]">{fmtNum(tot.ferme)}</b></span>
                      <span>janv.→mars <b className="text-[#8A5A08]">{fmtNum(tot.nonConf)}</b></span>
                      <span>CDC à livrer <b className="text-[#111820]">{fmtNum(tot.cdc)}</b></span>
                      <span>Stock backups <b className="text-[#3F9142]">{fmtNum(stockBackups)}</b> ({fmtNum(backupsTaille.size)} réf.)</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead className="bg-[#F4F3F0] text-[10.5px] uppercase text-[#8A8474]">
                        <tr>
                          <th className="w-[290px] px-2 py-1.5 text-left font-bold">Groupe AirH2O · prix public</th>
                          <th className="px-2 py-1.5 text-right font-bold" title="Stock SAGE tous dépôts, réel − préparé · promettable = après CDC déjà prises">Dispo</th>
                          {moisListe.map((m, i) => (
                            <th key={m} className={`px-2 py-1.5 text-right font-bold ${nonConfirme(m) ? 'bg-[#FBF1E1] text-[#8A5A08]' : ''}`}
                              title={nonConfirme(m) ? 'Date fournisseur non confirmée' : i === 0 ? 'Reste du mois en cours (CDF en retard ou sans date comprises)' : undefined}>
                              {libMois(m)}{i === 0 ? '*' : ''}
                            </th>
                          ))}
                          <th className="px-2 py-1.5 text-right font-bold" title="Commandes clients à livrer · NT = non tenables">CDC</th>
                          <th className="min-w-[420px] px-2 py-1.5 text-left font-bold">Backups anciennes générations · prix public · stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => {
                          const bks = liensParCible.get(c.ref) || []
                          const nt = c.mois.reduce((s, m) => s + n0(m.non_tenable), 0)
                          const actif = dropCible === c.ref
                          return (
                            <tr key={c.ref} className="border-t border-[#F0EDE6] align-top">
                              <td className="px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-1">
                                  <a href={`/stock/penurie?ref=${encodeURIComponent(c.ref)}&mystock=tous`} className="font-bold hover:text-[#B4761A] hover:underline" title="Ouvrir la fiche pénurie">{c.ref}</a>
                                  <Badge cls={c.gamme === '800' ? 'bg-sky-50 text-sky-800' : 'bg-[#EDEAE1] text-[#3A362E]'}>{c.gamme}</Badge>
                                  <span className="text-[10.5px] text-[#8A8474]">{c.alim}</span>
                                </div>
                                <div className="truncate text-[11px] text-[#5E5A50]" title={c.designation || ''}>{c.designation}</div>
                                <div className="text-[11.5px] font-bold text-[#3A362E]">{fmtPrix(c.prix)}</div>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                <div className={`text-[13px] font-bold ${n0(c.stock_disponible) <= 0 ? 'text-[#B42318]' : ''}`}>{fmtNum(c.stock_disponible)}</div>
                                <div className="text-[10.5px] text-[#8A8474]" title="Quantité promettable aujourd’hui pour une nouvelle commande">libre {fmtNum(c.qte_dispo_aujourdhui)}</div>
                                {n0(c.qte_dispo_aujourdhui) <= 0 && c.date_prochaine_dispo && <div className="text-[10px] text-[#8A5A08]">dispo {fmtDate(c.date_prochaine_dispo)}</div>}
                              </td>
                              {c.mois.map((m) => (
                                <td key={m.mois} className={`whitespace-nowrap px-2 py-1.5 text-right ${nonConfirme(m.mois) ? 'bg-[#FBF1E1]' : ''}`}>
                                  {n0(m.arrivages) > 0
                                    ? <span className={`font-bold ${nonConfirme(m.mois) ? 'text-[#8A5A08]' : 'text-[#3F9142]'}`}>{fmtNum(m.arrivages)}</span>
                                    : <span className="text-[#C9C4B8]">·</span>}
                                </td>
                              ))}
                              <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                <div className="font-bold">{fmtNum(c.besoin_cdc_total)}</div>
                                <div className="text-[10.5px] text-[#8A8474]">{fmtNum(c.nb_cdc)} CDC</div>
                                {nt > 0 && <Badge cls="bg-red-50 text-red-700" title="Quantité en CDC non tenables (dates de livraison interdites)">NT {fmtNum(nt)}</Badge>}
                              </td>
                              <td className={`px-2 py-1.5 ${actif ? 'bg-[#B4761A]/[0.08] outline outline-2 -outline-offset-2 outline-[#B4761A]' : ''}`}
                                onDragOver={(e) => survol(e, c.ref)} onDragLeave={() => setDropCible((d) => (d === c.ref ? null : d))} onDrop={(e) => deposer(e, c.ref)}>
                                <div className="flex min-h-[44px] flex-wrap gap-1.5">
                                  {bks.map((l, i) => {
                                    const b = pool.get(l.ref_backup)
                                    const autres = (usagesBackup.get(l.ref_backup) || []).filter((x) => x !== c.ref)
                                    return (
                                      <div key={l.id} draggable onDragStart={(e) => debutGlisseLien(e, l)} onDragEnd={finGlisse}
                                        onDragOver={(e) => survol(e, c.ref)} onDrop={(e) => deposer(e, c.ref, l.id)}
                                        title={`${l.origine === 'auto' ? 'Pré-rempli automatiquement' : `Ajouté par ${l.modifie_par || '—'}`}${autres.length ? ` · aussi proposé pour ${autres.join(', ')}` : ''}`}
                                        className={`group relative w-[200px] cursor-grab rounded-lg border px-2 py-1 active:cursor-grabbing ${n0(b?.stock_disponible) > 0 ? 'border-[#D9E7D3] bg-[#F6FAF4]' : 'border-[#E5E1D8] bg-[#FAF8F3]'}`}>
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="truncate text-[11.5px] font-bold"><span className="mr-1 text-[10px] text-[#8A8474]">{i + 1}.</span>{l.ref_backup}</span>
                                          <button type="button" onClick={() => void retirer(l.id)} disabled={enCours} aria-label={`Retirer ${l.ref_backup}`}
                                            className="h-5 w-5 shrink-0 rounded text-[12px] font-bold text-[#8A8474] hover:bg-red-50 hover:text-red-700">×</button>
                                        </div>
                                        <div className="truncate text-[10.5px] text-[#5E5A50]">{b?.designation || '—'}</div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                          <span className="text-[11px] font-bold text-[#3A362E]">{fmtPrix(b?.prix)}</span>
                                          <StockTag stock={b?.stock_disponible} libre={b?.qte_dispo_aujourdhui} />
                                          {autres.length > 0 && <Badge cls="bg-violet-50 text-violet-800" title={`Stock partagé avec ${autres.join(', ')}`}>×{autres.length + 1}</Badge>}
                                          {l.origine === 'auto' && <Badge cls="bg-[#EDEAE1] text-[#8A8474]" title="Pré-rempli : puissance ≥, même alimentation">auto</Badge>}
                                        </div>
                                      </div>
                                    )
                                  })}
                                  {bks.length === 0 && <span className="self-center text-[11px] italic text-[#C9C4B8]">Déposer ici un groupe d’ancienne génération</span>}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}
            {!loading && (
              <p className="px-1 text-[10.5px] text-[#8A8474]">
                * Mois en cours : reste du mois, CDF en retard ou sans date comprises. Arrivages = commandes fournisseurs SAGE en cours, à leur date de réception retenue.
                Stock = stock SAGE tous dépôts, réel − préparé ; « libre » = quantité promettable aujourd’hui après les commandes clients déjà prises.
                Un backup proposé sur plusieurs lignes (×2, ×3…) partage le même stock.
              </p>
            )}
          </div>

          {/* Panneau anciennes générations */}
          <aside className="space-y-2 xl:sticky xl:top-3">
            <section className="rounded-xl border border-[#E5E1D8] bg-white">
              <div className="border-b border-[#E5E1D8] px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Anciennes générations — à glisser</div>
                <div className="mt-1.5 flex gap-1.5">
                  <input value={poolSearch} onChange={(e) => setPoolSearch(e.target.value)} placeholder="Filtrer…" className={`${ctl} w-full font-medium`} />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#5E5A50]">
                    <input type="checkbox" checked={poolAvecStock} onChange={(e) => setPoolAvecStock(e.target.checked)} />avec stock
                  </label>
                </div>
              </div>
              <div className="max-h-[calc(100vh-330px)] overflow-y-auto px-2 py-2">
                {poolListe.map(({ k, rows }) => (
                  <div key={k} className="mb-2">
                    <div className="px-1 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-[#B4761A]">{k}</div>
                    <div className="space-y-1">
                      {rows.map((b) => {
                        const usages = usagesBackup.get(b.ref) || []
                        return (
                          <div key={b.ref} draggable onDragStart={(e) => debutGlissePool(e, b)} onDragEnd={finGlisse}
                            title={usages.length ? `Déjà proposé pour ${usages.join(', ')}` : 'Glisser sur une ligne pour le proposer en backup'}
                            className="cursor-grab rounded-lg border border-[#E5E1D8] bg-white px-2 py-1 hover:border-[#B4761A] active:cursor-grabbing">
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-[11.5px] font-bold">{b.ref}</span>
                              <span className="text-[11px] font-bold text-[#3A362E]">{fmtPrix(b.prix)}</span>
                            </div>
                            <div className="truncate text-[10.5px] text-[#5E5A50]">{b.designation || '—'}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <StockTag stock={b.stock_disponible} libre={b.qte_dispo_aujourdhui} />
                              {n0(b.besoin_cdc_total) > 0 && <span className="text-[10.5px] text-[#8A8474]">CDC {fmtNum(b.besoin_cdc_total)}</span>}
                              {n0(b.receptions_total) > 0 && <span className="text-[10.5px] text-[#3F9142]" title={b.prochaine_reception_date ? `Prochaine réception ${fmtDate(b.prochaine_reception_date)}` : ''}>CDF {fmtNum(b.receptions_total)}</span>}
                              {usages.length > 0 && <Badge cls="bg-violet-50 text-violet-800">proposé ×{usages.length}</Badge>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {!loading && poolListe.length === 0 && <div className="px-2 py-6 text-center text-[11.5px] text-[#8A8474]">Aucune référence.</div>}
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Autre référence (toute la base SAGE)</div>
              <input value={rechercheArt} onChange={(e) => setRechercheArt(e.target.value)} placeholder="Réf. ou désignation (2 caractères min.)" className={`${ctl} mt-1.5 w-full font-medium`} />
              <div className="mt-1.5 max-h-[260px] space-y-1 overflow-y-auto">
                {resultatsArt.map((b) => (
                  <div key={b.ref} draggable onDragStart={(e) => debutGlissePool(e, b)} onDragEnd={finGlisse}
                    className="cursor-grab rounded-lg border border-[#E5E1D8] px-2 py-1 hover:border-[#B4761A] active:cursor-grabbing">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[11.5px] font-bold">{b.ref}</span>
                      <span className="text-[11px] font-bold">{fmtPrix(b.prix)}</span>
                    </div>
                    <div className="truncate text-[10.5px] text-[#5E5A50]">{b.designation}</div>
                    <StockTag stock={b.stock_disponible} />
                  </div>
                ))}
                {rechercheArt.trim().length >= 2 && resultatsArt.length === 0 && <div className="py-2 text-center text-[11px] text-[#8A8474]">Aucun article.</div>}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default function EquivalencesROPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <EquivalencesRO />
    </Suspense>
  )
}
