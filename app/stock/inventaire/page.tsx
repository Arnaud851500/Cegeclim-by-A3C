'use client'

/**
 * Écran « Inventaire — pilotage achats » (menu Stocks & logistique, /stock/inventaire?campagne=&depot=).
 * ---------------------------------------------------------------------------
 * Créé le 01/11/2026 pour l'inventaire de fin d'année (≈ samedi 28/11/2026).
 *
 *  1. Campagne : libellé et date d'inventaire.
 *  2. Préparer les listes : dépôts choisis × périmètre (familles macro, familles,
 *     fournisseurs ; ET entre critères, OU à l'intérieur, vide = tout ; option stock nul).
 *     La liste est une photo du stock SAGE (quantité et PUMP du dépôt) ; elle peut être
 *     rafraîchie jusqu'à la fin du 1er comptage sans perdre les saisies.
 *  3. Activer : ouvre le 1er comptage dans l'écran de saisie de l'agence.
 *  4. Suivi : avancement des saisies par dépôt, écarts valorisés au PUMP (actualisé
 *     toutes les 30 s).
 *  5. Détail d'un dépôt : comptages 1 / 2 / 3 avec initiales et commentaires ; par ligne,
 *     valider l'écart, le refuser (non passé dans SAGE) ou envoyer en 2e puis 3e comptage ;
 *     rouvrir un comptage clôturé par erreur ; valider l'inventaire du dépôt.
 *  6. Éditions : liste de comptage et écarts en PDF, export Excel des écarts validés pour
 *     créer le document dans SAGE (+ détail et synthèse par dépôt).
 *
 * 01/11/2026 (suite) : stock en transit (dépôt SAGE « TRANSIT <agence> », expédié par FMS et non
 * réceptionné) inclus par défaut dans la liste du dépôt destinataire, section « En transit », écart
 * passé sur le dépôt transit (migration 20261101b_inventaire_transit.sql).
 *
 * Accès : droit can_appro (ou can_autorisation), contrôlé aussi par chaque RPC.
 * Sources : RPC inv_* (supabase/migrations/20261101_inventaire_annuel.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  ORDINAL, commentairesLigne, couleurStatut, excelEcarts, fmtDate, fmtDateHeure, fmtEuro, fmtNum, fmtQte,
  libelleDecision, libelleStatut, messageErreur, n0, pdfEcarts, pdfListeComptage,
  type Campagne, type InvDepot, type LignePilotage, type ListeSaisie, type SuiviDepot,
} from '@/lib/inventaire'

type Ctx = {
  email: string
  peut_piloter: boolean
  depots: Array<{ depot_num: string; libelle: string; nom_court: string | null; central: boolean | null }>
  campagnes: Campagne[]
}
type Option = { code: string; libelle?: string | null; nom?: string | null; macro?: string; nb_refs: number; valeur: number }
type Options = {
  familles_macro: Option[]; familles: Option[]; fournisseurs: Option[]
  depots: Array<{ depot_num: string; nb_refs: number; valeur: number; transit_libelle?: string | null; transit_nb_refs?: number | null; transit_valeur?: number | null }>
}
type DetailDepot = InvDepot & { lignes: LignePilotage[] }
type FiltreLignes = 'ecarts' | 'a_decider' | 'recomptage' | 'non_saisies' | 'hors_liste' | 'transit' | 'toutes'

const ANNEE = new Date().getFullYear()

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'alerte' | 'warn' | 'ok' }) {
  const color = tone === 'alerte' ? '#B42318' : tone === 'warn' ? '#B4761A' : tone === 'ok' ? '#3F9142' : '#111820'
  return (
    <div className="min-w-0 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[20px] font-bold leading-7 tracking-tight" style={{ color }}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[#8A8474]">{sub}</div>}
    </div>
  )
}

function Puces({ options, choix, onToggle, libelle }: {
  options: Option[]; choix: Set<string>; onToggle: (c: string) => void; libelle: (o: Option) => string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = choix.has(o.code)
        return (
          <button key={o.code} type="button" onClick={() => onToggle(o.code)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:border-[#B4761A]'}`}>
            {libelle(o)}
          </button>
        )
      })}
    </div>
  )
}

function PilotageInventaire() {
  const router = useRouter()
  const params = useSearchParams()
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [campagneId, setCampagneId] = useState<string | null>(params.get('campagne'))
  const [suivi, setSuivi] = useState<SuiviDepot[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)

  // Campagne (création / modification)
  const [formCampagne, setFormCampagne] = useState<null | { id: string | null; libelle: string; date: string; statut: 'ouverte' | 'cloturee'; commentaire: string }>(null)

  // Préparation des listes
  const [voirPrep, setVoirPrep] = useState(false)
  const [options, setOptions] = useState<Options | null>(null)
  const [prepDepots, setPrepDepots] = useState<Set<string>>(new Set())
  const [prepMacros, setPrepMacros] = useState<Set<string>>(new Set())
  const [prepFamilles, setPrepFamilles] = useState<Set<string>>(new Set())
  const [prepFourn, setPrepFourn] = useState<Set<string>>(new Set())
  const [prepStockNul, setPrepStockNul] = useState(false)
  const [prepTransit, setPrepTransit] = useState(true)
  const [rechFam, setRechFam] = useState('')
  const [rechFourn, setRechFourn] = useState('')

  // Détail d'un dépôt
  const [depotId, setDepotId] = useState<string | null>(params.get('depot'))
  const [detail, setDetail] = useState<DetailDepot | null>(null)
  const [filtre, setFiltre] = useState<FiltreLignes>('ecarts')
  const [tri, setTri] = useState<'famille' | 'valeur'>('famille')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [commentaireDecision, setCommentaireDecision] = useState('')
  const [confirmation, setConfirmation] = useState<null | { titre: string; texte: string; action: () => Promise<void>; bouton: string }>(null)

  const campagne = ctx?.campagnes.find((c) => c.id === campagneId) || null

  // ── Chargements ────────────────────────────────────────────────────────
  const chargerCtx = useCallback(async () => {
    const { data, error } = await supabase.rpc('inv_contexte')
    if (error) { setErreur(messageErreur(error)); return }
    const c = data as Ctx
    setCtx(c)
    setCampagneId((cur) => (cur && c.campagnes.some((x) => x.id === cur) ? cur : c.campagnes.find((x) => x.statut === 'ouverte')?.id || c.campagnes[0]?.id || null))
  }, [])

  const chargerSuivi = useCallback(async (silencieux = false) => {
    if (!campagneId) { setSuivi([]); return }
    const { data, error } = await supabase.rpc('inv_campagne_suivi', { p_campagne_id: campagneId })
    if (error) { if (!silencieux) setErreur(messageErreur(error)); return }
    setSuivi((data || []) as SuiviDepot[])
  }, [campagneId])

  const chargerDetail = useCallback(async (id: string, silencieux = false) => {
    const { data, error } = await supabase.rpc('inv_depot_pilotage', { p_inv_depot_id: id })
    if (error) { if (!silencieux) setErreur(messageErreur(error)); return }
    setDetail(data as DetailDepot)
  }, [])

  useEffect(() => { void chargerCtx() }, [chargerCtx])
  useEffect(() => { void chargerSuivi() }, [chargerSuivi])
  useEffect(() => {
    if (!depotId) { setDetail(null); return }
    setSelection(new Set())
    void chargerDetail(depotId)
  }, [depotId, chargerDetail])
  useEffect(() => {
    const q = new URLSearchParams()
    if (campagneId) q.set('campagne', campagneId)
    if (depotId) q.set('depot', depotId)
    router.replace(`/stock/inventaire${q.toString() ? `?${q}` : ''}`)
  }, [campagneId, depotId, router])
  // Actualisation automatique (saisies en cours dans les agences)
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return
      void chargerSuivi(true)
      if (depotId) void chargerDetail(depotId, true)
    }, 30000)
    return () => clearInterval(t)
  }, [chargerSuivi, chargerDetail, depotId])

  async function chargerOptions() {
    if (options) return
    const { data, error } = await supabase.rpc('inv_options_perimetre')
    if (error) { setErreur(messageErreur(error)); return }
    setOptions(data as Options)
  }

  async function executer(libelle: string, f: () => Promise<string | void>) {
    setOccupe(libelle); setErreur(null); setInfo(null)
    try {
      const msg = await f()
      if (msg) setInfo(msg)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setOccupe(null)
    }
  }

  async function rpc<T = unknown>(nom: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) throw error
    return data as T
  }

  async function rafraichirTout() {
    await chargerSuivi()
    if (depotId) await chargerDetail(depotId)
  }

  // ── Actions campagne ───────────────────────────────────────────────────
  async function enregistrerCampagne() {
    if (!formCampagne) return
    await executer('campagne', async () => {
      const id = await rpc<string>('inv_campagne_enregistrer', {
        p_id: formCampagne.id, p_libelle: formCampagne.libelle, p_date: formCampagne.date,
        p_statut: formCampagne.statut, p_commentaire: formCampagne.commentaire,
      })
      setFormCampagne(null)
      await chargerCtx()
      setCampagneId(id)
      return 'Campagne enregistrée.'
    })
  }

  async function preparer() {
    if (!campagneId) return
    await executer('preparer', async () => {
      const res = await rpc<Array<{ depot_num: string; ok: boolean; nb_lignes?: number; nb_transit?: number; message?: string }>>('inv_depots_preparer', {
        p_campagne_id: campagneId, p_depots: Array.from(prepDepots), p_familles_macro: Array.from(prepMacros),
        p_familles: Array.from(prepFamilles), p_fournisseurs: Array.from(prepFourn), p_inclure_stock_nul: prepStockNul,
        p_inclure_transit: prepTransit,
      })
      await rafraichirTout()
      const nom = (n: string) => ctx?.depots.find((d) => d.depot_num === n)?.nom_court || n
      return res.map((r) => `${nom(r.depot_num)} : ${r.ok ? `${fmtNum(r.nb_lignes)} ligne(s)${r.nb_transit ? ` dont ${fmtNum(r.nb_transit)} en transit` : ''}` : r.message}`).join(' · ')
    })
  }

  // ── Actions dépôt ──────────────────────────────────────────────────────
  const activer = (ids: string[]) => executer('activer', async () => {
    const n = await rpc<number>('inv_depots_activer', { p_ids: ids })
    await rafraichirTout()
    return `${n} dépôt(s) activé(s) : le 1er comptage est ouvert dans l’écran de saisie de l’agence.`
  })
  const rafraichirStock = (id: string) => executer('stock', async () => {
    const n = await rpc<number>('inv_depot_rafraichir_stock', { p_inv_depot_id: id })
    await rafraichirTout()
    return `Stock théorique rafraîchi (${fmtNum(n)} ligne(s), saisies conservées).`
  })
  const annuler = (id: string, supprimer: boolean) => executer('annuler', async () => {
    await rpc('inv_depot_annuler', { p_inv_depot_id: id, p_supprimer: supprimer })
    if (supprimer && depotId === id) setDepotId(null)
    await rafraichirTout()
    return supprimer ? 'Liste supprimée.' : 'Comptage annulé : la liste est revenue en préparation.'
  })
  const rouvrir = (id: string) => executer('rouvrir', async () => {
    await rpc('inv_comptage_rouvrir', { p_inv_depot_id: id })
    await rafraichirTout()
    return 'Comptage rouvert : l’agence peut corriger sa saisie.'
  })
  const recompter = (id: string, lignes: number[], n: number) => executer('recompter', async () => {
    const nb = await rpc<number>('inv_recomptage_lancer', { p_inv_depot_id: id, p_lignes: lignes })
    setSelection(new Set())
    await rafraichirTout()
    return `${nb} ligne(s) envoyée(s) en ${ORDINAL[n]} comptage : l’agence doit les recompter avec un autre inventoriste.`
  })
  const decider = (lignes: number[], decision: 'valide' | 'refuse' | null) => executer('decider', async () => {
    const nb = await rpc<number>('inv_decider', { p_lignes: lignes, p_decision: decision, p_commentaire: commentaireDecision || null })
    setSelection(new Set()); setCommentaireDecision('')
    await rafraichirTout()
    return `${nb} ligne(s) : ${decision === null ? 'décision annulée' : libelleDecision(decision).toLowerCase()}.`
  })
  const validerDepot = (id: string, valider: boolean) => executer('valider', async () => {
    await rpc('inv_depot_valider', { p_inv_depot_id: id, p_valider: valider })
    await rafraichirTout()
    return valider ? 'Inventaire du dépôt validé : ses écarts validés sont prêts pour l’export SAGE.' : 'Validation annulée.'
  })

  // ── Éditions ───────────────────────────────────────────────────────────
  async function imprimerEcarts(depotIds: string[] | null) {
    if (!campagneId || !campagne) return
    await executer('pdf', async () => {
      const lignes = await rpc<LignePilotage[]>('inv_campagne_ecarts', { p_campagne_id: campagneId, p_depot_ids: depotIds })
      pdfEcarts(lignes, { campagne: campagne.libelle, dateInventaire: campagne.date_inventaire })
    })
  }

  async function exporterExcel() {
    if (!campagneId || !campagne) return
    await executer('excel', async () => {
      const lignes = await rpc<LignePilotage[]>('inv_campagne_ecarts', { p_campagne_id: campagneId, p_depot_ids: null })
      await excelEcarts(lignes, suivi, { campagne: campagne.libelle, dateInventaire: campagne.date_inventaire })
      const nbVal = lignes.filter((l) => l.decision === 'valide').length
      return `Export : ${nbVal} écart(s) validé(s) à passer dans SAGE, ${lignes.length} écart(s) au total.`
    })
  }

  function imprimerListe(d: DetailDepot) {
    const n = Math.max(d.comptage_courant, 1)
    const liste: ListeSaisie = {
      ...d, numero: n,
      lignes: d.lignes.filter((l) => l.nb_comptages >= n).map((l) => ({
        id: l.id, reference: l.reference, ref_fournisseur: l.ref_fournisseur, designation: l.designation,
        famille: l.famille, famille_macro: l.famille_macro, qte_theorique: l.qte_theorique, pump: l.pump,
        hors_liste: l.hors_liste, transit: l.transit, depot_stock: l.depot_stock, depot_stock_libelle: l.depot_stock_libelle, qte: n === 1 ? l.q1 : n === 2 ? l.q2 : l.q3, commentaire: n === 1 ? l.com1 : n === 2 ? l.com2 : l.com3,
      })),
    }
    pdfListeComptage(liste, { avecSaisies: false })
  }

  // ── Calculs ────────────────────────────────────────────────────────────
  const totaux = useMemo(() => {
    const t = { prep: 0, comptage: 0, analyse: 0, valide: 0, lignes: 0, aCompter: 0, saisies: 0, valeur: 0, ecarts: 0, aDecider: 0, net: 0, plus: 0, moins: 0, valideNet: 0 }
    for (const d of suivi) {
      if (d.statut === 'preparation') t.prep++
      else if (d.statut === 'comptage') t.comptage++
      else if (d.statut === 'analyse') t.analyse++
      else t.valide++
      t.lignes += d.nb_lignes; t.aCompter += d.nb_a_compter; t.saisies += d.nb_saisies; t.valeur += n0(d.valeur_theorique)
      t.ecarts += d.nb_ecarts; t.aDecider += d.nb_ecarts_a_decider; t.net += n0(d.valeur_ecart_net)
      t.plus += n0(d.valeur_ecart_plus); t.moins += n0(d.valeur_ecart_moins); t.valideNet += n0(d.valeur_validee_net)
    }
    return t
  }, [suivi])

  const enRecomptage = (l: LignePilotage, d: InvDepot) => d.statut === 'comptage' && l.nb_comptages >= d.comptage_courant && d.comptage_courant > 1
  const aDecider = (l: LignePilotage, d: InvDepot) =>
    l.qte_finale !== null && n0(l.ecart) !== 0 && !l.decision && !(d.statut === 'comptage' && l.nb_comptages >= d.comptage_courant)

  const lignesDetail = useMemo(() => {
    if (!detail) return []
    const q = search.trim().toUpperCase()
    const ls = detail.lignes.filter((l) => {
      if (filtre === 'ecarts' && !((l.qte_finale !== null && n0(l.ecart) !== 0) || enRecomptage(l, detail))) return false
      if (filtre === 'a_decider' && !aDecider(l, detail)) return false
      if (filtre === 'recomptage' && l.nb_comptages < 2) return false
      if (filtre === 'non_saisies' && !(detail.statut === 'comptage' && l.nb_comptages >= detail.comptage_courant
        && (detail.comptage_courant === 1 ? l.q1 : detail.comptage_courant === 2 ? l.q2 : l.q3) === null)) return false
      if (filtre === 'hors_liste' && !l.hors_liste) return false
      if (filtre === 'transit' && !l.transit) return false
      if (!q) return true
      return [l.reference, l.ref_fournisseur, l.designation, l.famille, l.fournisseur_nom].some((x) => (x || '').toUpperCase().includes(q))
    })
    if (tri === 'valeur') ls.sort((a, b) => Math.abs(n0(b.valeur_ecart)) - Math.abs(n0(a.valeur_ecart)))
    return ls
  }, [detail, filtre, search, tri])

  const selLignes = useMemo(() => (detail?.lignes || []).filter((l) => selection.has(l.id)), [detail, selection])
  const selDecidables = detail ? selLignes.filter((l) => l.qte_finale !== null && !(detail.statut === 'comptage' && l.nb_comptages >= detail.comptage_courant)) : []
  const selRecomptables = detail && detail.statut === 'analyse' && detail.comptage_courant < 3
    ? selLignes.filter((l) => l.nb_comptages === detail.comptage_courant) : []
  const nbADeciderDetail = detail ? detail.lignes.filter((l) => aDecider(l, detail)).length : 0
  const suiviDetail = suivi.find((s) => s.id === depotId) || null

  const ctl = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-2.5 text-[13px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const btn = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12.5px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-40'
  const btnNoir = 'h-9 rounded-lg bg-[#111820] px-3 text-[12.5px] font-bold text-white disabled:opacity-40'

  if (ctx && !ctx.peut_piloter) {
    return (
      <main className="min-h-screen bg-[#F4F3F0] p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-[#E5E1D8] bg-white p-5 text-[14px]">
          Le pilotage de l’inventaire est réservé aux achats. Pour saisir les comptages de votre dépôt, ouvrez{' '}
          <a href="/stock/inventaire/saisie" className="font-bold text-[#96600F] underline">Inventaire — saisie dépôt</a>.
        </div>
      </main>
    )
  }

  const famillesVisibles = (options?.familles || []).filter((f) =>
    (prepMacros.size === 0 || prepMacros.has(f.macro || '')) &&
    (!rechFam.trim() || `${f.code} ${f.libelle || ''}`.toUpperCase().includes(rechFam.trim().toUpperCase())))
  const fournVisibles = (options?.fournisseurs || []).filter((f) =>
    !rechFourn.trim() || `${f.code} ${f.nom || ''}`.toUpperCase().includes(rechFourn.trim().toUpperCase()))
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (c: string) => {
    const s = new Set(set); if (s.has(c)) s.delete(c); else s.add(c); setter(s)
  }

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* En-tête */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · Achats</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Inventaire — pilotage</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              {campagne ? `${campagne.libelle} · inventaire du ${fmtDate(campagne.date_inventaire)}${campagne.statut === 'cloturee' ? ' · clôturée' : ''}` : 'Aucune campagne'}
              {' · '}écart = dernier comptage − stock théorique SAGE, valorisé au PUMP du dépôt
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ctx && ctx.campagnes.length > 0 && (
              <select value={campagneId || ''} onChange={(e) => { setCampagneId(e.target.value); setDepotId(null) }} className={`${ctl} h-10 font-bold`}>
                {ctx.campagnes.map((c) => <option key={c.id} value={c.id}>{c.libelle} ({fmtDate(c.date_inventaire)})</option>)}
              </select>
            )}
            <button type="button" className={`${btn} h-10`} onClick={() => setFormCampagne({ id: null, libelle: `Inventaire fin d’année ${ANNEE}`, date: `${ANNEE}-11-28`, statut: 'ouverte', commentaire: '' })}>+ Campagne</button>
            {campagne && (
              <button type="button" className={`${btn} h-10`} onClick={() => setFormCampagne({ id: campagne.id, libelle: campagne.libelle, date: campagne.date_inventaire, statut: campagne.statut, commentaire: campagne.commentaire || '' })}>✎</button>
            )}
            <button type="button" className={`${btn} h-10`} disabled={!campagne || occupe !== null || totaux.ecarts === 0} onClick={() => void imprimerEcarts(null)}>🖨 Écarts (PDF)</button>
            <button type="button" className={`${btnNoir} h-10`} disabled={!campagne || occupe !== null || totaux.ecarts === 0} onClick={() => void exporterExcel()}>{occupe === 'excel' ? 'Export…' : '⬇ Excel écarts SAGE'}</button>
            <button type="button" className={`${btn} h-10`} onClick={() => void rafraichirTout()} title="Actualiser">↻</button>
          </div>
        </section>

        {erreur && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-semibold text-red-800">{erreur}</div>}
        {info && !erreur && <div className="rounded-xl border border-[#BFE0C1] bg-[#E9F5EA] px-4 py-2.5 text-[13px] font-semibold text-[#2F6F33]">{info}</div>}

        {ctx && ctx.campagnes.length === 0 && !formCampagne && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-5 text-[14px]">
            Aucune campagne d’inventaire. Commencez par créer celle de fin d’année.{' '}
            <button type="button" className={btnNoir} onClick={() => setFormCampagne({ id: null, libelle: `Inventaire fin d’année ${ANNEE}`, date: `${ANNEE}-11-28`, statut: 'ouverte', commentaire: '' })}>Créer la campagne</button>
          </section>
        )}

        {campagne && (
          <>
            {/* Indicateurs */}
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              <Kpi label="Dépôts" value={fmtNum(suivi.length)} sub={`${totaux.prep} prép. · ${totaux.comptage} comptage · ${totaux.analyse} analyse · ${totaux.valide} validé(s)`} />
              <Kpi label="Lignes à inventorier" value={fmtNum(totaux.lignes)} sub={`valeur théorique ${fmtEuro(totaux.valeur)}`} />
              <Kpi label="Saisies en cours" value={totaux.aCompter ? `${fmtNum(totaux.saisies)} / ${fmtNum(totaux.aCompter)}` : '—'} sub={totaux.aCompter ? `${Math.round((totaux.saisies / totaux.aCompter) * 100)} % des lignes ouvertes` : 'aucun comptage ouvert'} />
              <Kpi label="Écarts" value={fmtNum(totaux.ecarts)} sub={`${fmtNum(totaux.aDecider)} à décider`} tone={totaux.aDecider ? 'warn' : undefined} />
              <Kpi label="Écarts positifs" value={fmtEuro(totaux.plus)} tone="ok" />
              <Kpi label="Écarts négatifs" value={fmtEuro(totaux.moins)} tone={totaux.moins < 0 ? 'alerte' : undefined} />
              <Kpi label="Écart net / validé" value={fmtEuro(totaux.net)} sub={`validé : ${fmtEuro(totaux.valideNet)}`} tone={totaux.net < 0 ? 'alerte' : undefined} />
            </section>

            {/* Préparation */}
            <section className="rounded-xl border border-[#E5E1D8] bg-white">
              <button type="button" onClick={() => { setVoirPrep((v) => !v); void chargerOptions() }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left">
                <span className="text-[14px] font-bold">{voirPrep ? '▾' : '▸'} Préparer les listes d’inventaire</span>
                <span className="text-[12px] text-[#8A8474]">dépôts × familles macro × familles × fournisseurs — photo du stock SAGE</span>
              </button>
              {voirPrep && (
                <div className="space-y-3 border-t border-[#EFECE4] px-4 py-3">
                  {!options ? <div className="h-24 animate-pulse rounded-lg bg-[#F4F3F0]" /> : (
                    <>
                      <div>
                        <div className="mb-1 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                          Dépôts
                          <button type="button" className="font-bold normal-case text-[#96600F] hover:underline" onClick={() => setPrepDepots(new Set(ctx?.depots.map((d) => d.depot_num)))}>tous</button>
                          <button type="button" className="font-bold normal-case text-[#96600F] hover:underline" onClick={() => setPrepDepots(new Set())}>aucun</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {ctx?.depots.map((d) => {
                            const on = prepDepots.has(d.depot_num)
                            const st = suivi.find((s) => s.depot_num === d.depot_num)
                            const o = options.depots.find((x) => x.depot_num === d.depot_num)
                            return (
                              <button key={d.depot_num} type="button" onClick={() => toggle(prepDepots, setPrepDepots)(d.depot_num)}
                                className={`rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${on ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white hover:border-[#B4761A]'}`}>
                                <div className="font-bold">{d.central ? 'FMS (central)' : d.nom_court || d.libelle}</div>
                                <div className={on ? 'text-white/70' : 'text-[#8A8474]'}>
                                  {fmtNum(o?.nb_refs)} réf. · {fmtEuro(o?.valeur)}{st ? ` · ${libelleStatut(st)}` : ''}
                                </div>
                                {o?.transit_nb_refs ? (
                                  <div className={on ? 'text-[#B9CFEE]' : 'text-[#1D4F91]'}>+ transit : {fmtNum(o.transit_nb_refs)} réf. · {fmtEuro(o.transit_valeur)}</div>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Familles macro <span className="normal-case">(aucune = toutes)</span></div>
                        <Puces options={options.familles_macro} choix={prepMacros} onToggle={toggle(prepMacros, setPrepMacros)} libelle={(o) => `${o.code} · ${fmtNum(o.nb_refs)}`} />
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                            Familles <span className="normal-case">(aucune = toutes{prepMacros.size ? ' celles des familles macro choisies' : ''})</span>
                            <input value={rechFam} onChange={(e) => setRechFam(e.target.value)} placeholder="Filtrer" className="ml-auto h-7 w-36 rounded-md border border-[#E5E1D8] px-2 text-[12px] font-normal normal-case" />
                          </div>
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-[#EFECE4] p-1">
                            {famillesVisibles.map((f) => (
                              <label key={f.code} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-[12px] hover:bg-[#F4F3F0]">
                                <input type="checkbox" checked={prepFamilles.has(f.code)} onChange={() => toggle(prepFamilles, setPrepFamilles)(f.code)} />
                                <span className="font-bold">{f.code}</span><span className="truncate text-[#5E5A44]">{f.libelle}</span>
                                <span className="ml-auto whitespace-nowrap text-[#8A8474]">{f.macro} · {fmtNum(f.nb_refs)} réf.</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                            Fournisseurs principaux <span className="normal-case">(aucun = tous)</span>
                            <input value={rechFourn} onChange={(e) => setRechFourn(e.target.value)} placeholder="Filtrer" className="ml-auto h-7 w-36 rounded-md border border-[#E5E1D8] px-2 text-[12px] font-normal normal-case" />
                          </div>
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-[#EFECE4] p-1">
                            {fournVisibles.map((f) => (
                              <label key={f.code} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-[12px] hover:bg-[#F4F3F0]">
                                <input type="checkbox" checked={prepFourn.has(f.code)} onChange={() => toggle(prepFourn, setPrepFourn)(f.code)} />
                                <span className="font-bold">{f.code}</span><span className="truncate text-[#5E5A44]">{f.nom}</span>
                                <span className="ml-auto whitespace-nowrap text-[#8A8474]">{fmtNum(f.nb_refs)} réf. · {fmtEuro(f.valeur)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="flex items-center gap-2 text-[12.5px]">
                            <input type="checkbox" checked={prepTransit} onChange={(e) => setPrepTransit(e.target.checked)} />
                            Inclure le stock en transit vers le dépôt (dépôt SAGE « TRANSIT … » : expédié par FMS, non réceptionné) — compté par l’agence, écart passé sur le dépôt transit
                          </label>
                          <label className="flex items-center gap-2 text-[12.5px]">
                            <input type="checkbox" checked={prepStockNul} onChange={(e) => setPrepStockNul(e.target.checked)} />
                            Inclure les références à stock nul du dépôt (pour retrouver des articles non enregistrés)
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-[#8A8474]">
                            {prepDepots.size} dépôt(s) · {prepMacros.size || 'toutes'} famille(s) macro · {prepFamilles.size || 'toutes'} famille(s) · {prepFourn.size || 'tous'} fournisseur(s)
                          </span>
                          <button type="button" className={btnNoir} disabled={prepDepots.size === 0 || occupe !== null || campagne.statut !== 'ouverte'} onClick={() => void preparer()}>
                            {occupe === 'preparer' ? 'Préparation…' : 'Préparer les listes'}
                          </button>
                        </div>
                      </div>
                      <p className="text-[11.5px] text-[#8A8474]">
                        Un dépôt déjà préparé est re-préparé avec ce périmètre ; un dépôt dont le comptage a commencé est laissé tel quel.
                        Les critères se cumulent (ex. fournisseur H0001 ET familles macro R/O + R/R).
                      </p>
                    </>
                  )}
                </div>
              )}
            </section>

            {/* Suivi des dépôts */}
            <section className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE4] px-4 py-2">
                <span className="text-[14px] font-bold">Suivi par dépôt</span>
                {suivi.some((d) => d.statut === 'preparation') && (
                  <button type="button" className={btnNoir} disabled={occupe !== null}
                    onClick={() => setConfirmation({
                      titre: 'Activer le 1er comptage', bouton: 'Activer',
                      texte: `Ouvrir le 1er comptage pour ${suivi.filter((d) => d.statut === 'preparation').map((d) => d.depot_libelle).join(', ')} ? Les agences verront leur liste dans l’écran de saisie.`,
                      action: () => activer(suivi.filter((d) => d.statut === 'preparation').map((d) => d.id)),
                    })}>
                    ▶ Activer toutes les listes préparées
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] border-collapse text-[12.5px]">
                  <thead className="bg-[#FAF8F3] text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474]">
                    <tr>
                      <th className="px-3 py-2">Dépôt</th><th className="px-2 py-2">Statut</th><th className="px-2 py-2">Périmètre</th>
                      <th className="px-2 py-2">Comptages</th><th className="px-2 py-2">Avancement</th>
                      <th className="px-2 py-2 text-right">Lignes</th><th className="px-2 py-2 text-right">Valeur théo.</th>
                      <th className="px-2 py-2 text-right">Écarts</th><th className="px-2 py-2 text-right">À décider</th>
                      <th className="px-2 py-2 text-right">Écart net</th><th className="px-2 py-2">Stock SAGE du</th><th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {suivi.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-[#8A8474]">Aucune liste : ouvrez « Préparer les listes d’inventaire ».</td></tr>}
                    {suivi.map((d) => {
                      const perim = [d.familles_macro.length ? `Macro ${d.familles_macro.join(', ')}` : '', d.familles.length ? `${d.familles.length} famille(s)` : '',
                        d.fournisseurs.length ? `Fourn. ${d.fournisseurs.join(', ')}` : '', d.inclure_stock_nul ? 'stock nul inclus' : '',
                        d.nb_transit ? `transit ${d.nb_transit} réf. (${fmtEuro(d.valeur_transit)})` : ''].filter(Boolean).join(' · ') || 'Tout le stock'
                      const pct = d.nb_a_compter ? Math.round((d.nb_saisies / d.nb_a_compter) * 100) : null
                      return (
                        <tr key={d.id} onClick={() => setDepotId(d.id)}
                          className={`cursor-pointer border-t border-[#EFECE4] ${depotId === d.id ? 'bg-[#FDF3E3]' : 'hover:bg-[#FAF8F3]'}`}>
                          <td className="px-3 py-2 font-bold">{d.depot_libelle}</td>
                          <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${couleurStatut(d.statut)}`}>{libelleStatut(d)}</span></td>
                          <td className="max-w-[260px] truncate px-2 py-2 text-[#5E5A44]" title={perim}>{perim}</td>
                          <td className="whitespace-nowrap px-2 py-2">
                            {d.comptages.length === 0 ? '—' : d.comptages.map((c) => (
                              <span key={c.numero} className={`mr-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${c.statut === 'termine' ? 'bg-[#E9F5EA] text-[#2F6F33]' : 'bg-[#E8F0FB] text-[#1D4F91]'}`}
                                title={`${ORDINAL[c.numero]} comptage ${c.statut === 'termine' ? `terminé le ${fmtDateHeure(c.termine_le)}` : 'en cours'}`}>
                                C{c.numero} {c.initiales || '?'}
                              </span>
                            ))}
                          </td>
                          <td className="px-2 py-2">
                            {pct === null ? <span className="text-[#8A8474]">—</span> : (
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-24 overflow-hidden rounded-full bg-[#EFECE4]"><div className="h-full bg-[#3F9142]" style={{ width: `${pct}%` }} /></div>
                                <span className="whitespace-nowrap text-[11.5px]">{fmtNum(d.nb_saisies)} / {fmtNum(d.nb_a_compter)}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">{fmtNum(d.nb_lignes)}{d.nb_hors_liste ? <span className="text-[#96600F]" title="Articles ajoutés hors liste"> +{d.nb_hors_liste}</span> : null}</td>
                          <td className="px-2 py-2 text-right">{fmtEuro(d.valeur_theorique)}</td>
                          <td className="px-2 py-2 text-right">{fmtNum(d.nb_ecarts)}</td>
                          <td className={`px-2 py-2 text-right font-bold ${d.nb_ecarts_a_decider ? 'text-[#B4761A]' : 'text-[#8A8474]'}`}>{fmtNum(d.nb_ecarts_a_decider)}</td>
                          <td className={`px-2 py-2 text-right font-bold ${n0(d.valeur_ecart_net) < 0 ? 'text-[#B42318]' : n0(d.valeur_ecart_net) > 0 ? 'text-[#2F6F33]' : ''}`}>{fmtEuro(d.valeur_ecart_net)}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-[#5E5A44]">{fmtDateHeure(d.stock_sage_le)}</td>
                          <td className="px-2 py-2 text-right text-[#96600F]">Détail ›</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Détail d'un dépôt */}
            {detail && (
              <section className="rounded-xl border border-[#E5E1D8] bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EFECE4] px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[17px] font-bold">{detail.depot_libelle}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${couleurStatut(detail.statut)}`}>{libelleStatut(detail)}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[#8A8474]">
                      Stock SAGE du {fmtDateHeure(detail.stock_sage_le)} (photo prise le {fmtDateHeure(detail.stock_charge_le)})
                      {detail.comptages.map((c) => ` · C${c.numero} ${c.initiales || '—'} ${c.statut === 'termine' ? `terminé ${fmtDateHeure(c.termine_le)}` : 'en cours'}`).join('')}
                      {detail.valide_le ? ` · validé le ${fmtDateHeure(detail.valide_le)} par ${detail.valide_par}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {detail.statut !== 'preparation' && <button type="button" className={btn} onClick={() => imprimerListe(detail)}>🖨 Liste {ORDINAL[Math.max(detail.comptage_courant, 1)]} comptage</button>}
                    {suiviDetail && suiviDetail.nb_ecarts > 0 && <button type="button" className={btn} disabled={occupe !== null} onClick={() => void imprimerEcarts([detail.id])}>🖨 Écarts du dépôt</button>}
                    {(detail.statut === 'preparation' || (detail.statut === 'comptage' && detail.comptage_courant === 1)) && (
                      <button type="button" className={btn} disabled={occupe !== null} onClick={() => void rafraichirStock(detail.id)} title="Recharger quantités et PUMP depuis la dernière synchro SAGE (saisies conservées)">
                        {occupe === 'stock' ? '…' : '↻ Rafraîchir le stock théorique'}
                      </button>
                    )}
                    {detail.statut === 'preparation' && (
                      <>
                        <button type="button" className={btnNoir} disabled={occupe !== null} onClick={() => void activer([detail.id])}>▶ Activer le 1er comptage</button>
                        <button type="button" className={`${btn} text-[#B42318]`} disabled={occupe !== null}
                          onClick={() => setConfirmation({ titre: 'Supprimer la liste', bouton: 'Supprimer', texte: `Supprimer la liste de ${detail.depot_libelle} ?`, action: () => annuler(detail.id, true) })}>Supprimer</button>
                      </>
                    )}
                    {detail.statut === 'comptage' && detail.comptage_courant === 1 && (
                      <button type="button" className={btn} disabled={occupe !== null}
                        onClick={() => setConfirmation({ titre: 'Annuler le comptage', bouton: 'Revenir en préparation', texte: 'Possible tant qu’aucune quantité n’a été saisie.', action: () => annuler(detail.id, false) })}>Annuler l’activation</button>
                    )}
                    {detail.statut === 'analyse' && (
                      <>
                        <button type="button" className={btn} disabled={occupe !== null}
                          onClick={() => setConfirmation({ titre: `Rouvrir le ${ORDINAL[detail.comptage_courant]} comptage`, bouton: 'Rouvrir', texte: 'L’agence pourra de nouveau modifier ses quantités, puis devra refaire « Fin du comptage ».', action: () => rouvrir(detail.id) })}>
                          Rouvrir le comptage
                        </button>
                        <button type="button" className={btnNoir} disabled={occupe !== null || nbADeciderDetail > 0}
                          title={nbADeciderDetail > 0 ? `${nbADeciderDetail} écart(s) sans décision` : ''}
                          onClick={() => setConfirmation({ titre: 'Valider l’inventaire du dépôt', bouton: 'Valider', texte: `Les écarts validés de ${detail.depot_libelle} seront prêts pour l’export SAGE.`, action: () => validerDepot(detail.id, true) })}>
                          ✓ Valider l’inventaire du dépôt
                        </button>
                      </>
                    )}
                    {detail.statut === 'valide' && (
                      <button type="button" className={btn} disabled={occupe !== null} onClick={() => void validerDepot(detail.id, false)}>Annuler la validation</button>
                    )}
                    <button type="button" className={btn} onClick={() => setDepotId(null)}>✕</button>
                  </div>
                </div>

                {suiviDetail && (
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4 xl:grid-cols-7">
                    <Kpi label="Lignes" value={fmtNum(suiviDetail.nb_lignes)} sub={suiviDetail.nb_hors_liste ? `dont ${suiviDetail.nb_hors_liste} hors liste` : undefined} />
                    <Kpi label="Valeur théorique" value={fmtEuro(suiviDetail.valeur_theorique)} />
                    <Kpi label="Saisies" value={suiviDetail.nb_a_compter ? `${fmtNum(suiviDetail.nb_saisies)} / ${fmtNum(suiviDetail.nb_a_compter)}` : '—'} sub={detail.statut === 'comptage' ? `${ORDINAL[detail.comptage_courant]} comptage` : undefined} />
                    <Kpi label="Écarts" value={fmtNum(suiviDetail.nb_ecarts)} sub={`${suiviDetail.nb_valides} validé(s) · ${suiviDetail.nb_refuses} refusé(s)`} />
                    <Kpi label="À décider" value={fmtNum(suiviDetail.nb_ecarts_a_decider)} tone={suiviDetail.nb_ecarts_a_decider ? 'warn' : 'ok'} />
                    <Kpi label="Écart net" value={fmtEuro(suiviDetail.valeur_ecart_net)} sub={`+${fmtEuro(suiviDetail.valeur_ecart_plus)} / ${fmtEuro(suiviDetail.valeur_ecart_moins)}`} tone={n0(suiviDetail.valeur_ecart_net) < 0 ? 'alerte' : undefined} />
                    <Kpi label="Écart validé net" value={fmtEuro(suiviDetail.valeur_validee_net)} />
                  </div>
                )}

                {/* Filtres et actions sur la sélection */}
                <div className="flex flex-wrap items-center gap-2 border-y border-[#EFECE4] bg-[#FAF8F3] px-4 py-2">
                  <div className="flex overflow-hidden rounded-lg border border-[#E5E1D8]">
                    {([['ecarts', 'Écarts'], ['a_decider', `À décider (${nbADeciderDetail})`], ['recomptage', 'Recomptées'], ['non_saisies', 'Non saisies'], ['hors_liste', 'Hors liste'], ['transit', 'Transit'], ['toutes', 'Toutes']] as Array<[FiltreLignes, string]>).map(([k, lib]) => (
                      <button key={k} type="button" onClick={() => { setFiltre(k); setSelection(new Set()) }}
                        className={`h-9 px-2.5 text-[12px] font-bold ${filtre === k ? 'bg-[#111820] text-white' : 'bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`}>{lib}</button>
                    ))}
                  </div>
                  <select value={tri} onChange={(e) => setTri(e.target.value as 'famille' | 'valeur')} className={ctl}>
                    <option value="famille">Tri : famille, référence</option>
                    <option value="valeur">Tri : valeur d’écart</option>
                  </select>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher" className={`${ctl} w-48`} />
                  <span className="text-[12px] text-[#8A8474]">{fmtNum(lignesDetail.length)} ligne(s){selection.size ? ` · ${selection.size} sélectionnée(s)` : ''}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <input value={commentaireDecision} onChange={(e) => setCommentaireDecision(e.target.value)} placeholder="Commentaire de décision (facultatif)" className={`${ctl} w-56 font-normal`} />
                    <button type="button" className={`${btn} border-[#BFE0C1] text-[#2F6F33]`} disabled={occupe !== null || selDecidables.length === 0} onClick={() => void decider(selDecidables.map((l) => l.id), 'valide')}>✓ Valider l’écart</button>
                    <button type="button" className={`${btn} text-[#B42318]`} disabled={occupe !== null || selDecidables.length === 0} onClick={() => void decider(selDecidables.map((l) => l.id), 'refuse')}>✕ Refuser l’écart</button>
                    <button type="button" className={btn} disabled={occupe !== null || !selDecidables.some((l) => l.decision)} onClick={() => void decider(selDecidables.filter((l) => l.decision).map((l) => l.id), null)}>Annuler la décision</button>
                    {detail.statut === 'analyse' && detail.comptage_courant < 3 && (
                      <button type="button" className={btnNoir} disabled={occupe !== null || selRecomptables.length === 0}
                        onClick={() => setConfirmation({
                          titre: `Envoyer en ${ORDINAL[detail.comptage_courant + 1]} comptage`, bouton: 'Envoyer',
                          texte: `${selRecomptables.length} ligne(s) seront recomptées par ${detail.depot_libelle}, avec un autre inventoriste. Les autres écarts restent à décider ici.`,
                          action: () => recompter(detail.id, selRecomptables.map((l) => l.id), detail.comptage_courant + 1),
                        })}>
                        ↺ Envoyer en {ORDINAL[detail.comptage_courant + 1]} comptage ({selRecomptables.length})
                      </button>
                    )}
                    {detail.statut === 'analyse' && nbADeciderDetail > 0 && (
                      <button type="button" className={btn} disabled={occupe !== null}
                        onClick={() => setConfirmation({
                          titre: 'Valider tous les écarts restants', bouton: 'Tout valider',
                          texte: `${nbADeciderDetail} écart(s) sans décision seront validés (passés dans SAGE).`,
                          action: () => decider(detail.lignes.filter((l) => aDecider(l, detail)).map((l) => l.id), 'valide'),
                        })}>Tout valider</button>
                    )}
                  </div>
                </div>

                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full min-w-[1400px] border-collapse text-[12.5px]">
                    <thead className="sticky top-0 z-10 bg-white text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474] shadow-[0_1px_0_#E5E1D8]">
                      <tr>
                        <th className="px-2 py-2">
                          <input type="checkbox" checked={lignesDetail.length > 0 && lignesDetail.every((l) => selection.has(l.id))}
                            onChange={(e) => setSelection(e.target.checked ? new Set(lignesDetail.map((l) => l.id)) : new Set())} />
                        </th>
                        <th className="px-2 py-2">Réf. CEGECLIM</th><th className="px-2 py-2">Réf. fournisseur</th><th className="px-2 py-2">Désignation</th>
                        <th className="px-2 py-2 text-right">Théo.</th>
                        <th className="px-2 py-2 text-right">C1</th><th className="px-2 py-2 text-right">C2</th><th className="px-2 py-2 text-right">C3</th>
                        <th className="px-2 py-2 text-right">Retenu</th><th className="px-2 py-2 text-right">Écart</th>
                        <th className="px-2 py-2 text-right">PUMP</th><th className="px-2 py-2 text-right">Valeur écart</th>
                        <th className="px-2 py-2">Commentaires</th><th className="px-2 py-2">Décision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesDetail.map((l) => {
                        const recompte = enRecomptage(l, detail)
                        const decide = aDecider(l, detail)
                        const bg = recompte ? 'bg-[#F2F6FC]' : l.decision === 'valide' ? 'bg-[#F5FAF5]' : l.decision === 'refuse' ? 'bg-[#F7F6F3]' : decide ? 'bg-[#FFFBF3]' : ''
                        const cellQ = (n: number) => {
                          if (l.nb_comptages < n && !(n === 1)) return <span className="text-[#C9C4B6]">·</span>
                          const v = n === 1 ? l.q1 : n === 2 ? l.q2 : l.q3
                          const pending = detail.statut === 'comptage' && detail.comptage_courant === n && l.nb_comptages >= n
                          return v === null ? <span className="text-[#8A8474]">{pending ? 'en cours' : '—'}</span> : <span className={v !== l.qte_theorique ? 'font-bold text-[#96600F]' : ''}>{fmtQte(v)}</span>
                        }
                        return (
                          <tr key={l.id} className={`border-t border-[#EFECE4] ${bg}`}>
                            <td className="px-2 py-1.5"><input type="checkbox" checked={selection.has(l.id)} onChange={() => { const s = new Set(selection); if (s.has(l.id)) s.delete(l.id); else s.add(l.id); setSelection(s) }} /></td>
                            <td className="whitespace-nowrap px-2 py-1.5 font-bold">
                              {l.reference}
                              {l.hors_liste && <span className="ml-1 rounded bg-[#FDF3E3] px-1 text-[10px] font-bold text-[#96600F]">hors liste</span>}
                              {l.transit && <span className="ml-1 rounded bg-[#E8F0FB] px-1 text-[10px] font-bold text-[#1D4F91]" title={`${l.depot_stock_libelle} (dépôt SAGE n° ${l.depot_stock})`}>transit</span>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-[#5E5A44]">{l.ref_fournisseur || '—'}</td>
                            <td className="max-w-[320px] truncate px-2 py-1.5" title={`${l.designation || ''} · ${l.famille || ''} · ${l.fournisseur_nom || l.fournisseur || ''}`}>{l.designation}</td>
                            <td className="px-2 py-1.5 text-right">{fmtQte(l.qte_theorique)}</td>
                            <td className="px-2 py-1.5 text-right">{cellQ(1)}</td>
                            <td className="px-2 py-1.5 text-right">{cellQ(2)}</td>
                            <td className="px-2 py-1.5 text-right">{cellQ(3)}</td>
                            <td className="px-2 py-1.5 text-right font-bold">{recompte ? '…' : fmtQte(l.qte_finale)}</td>
                            <td className={`px-2 py-1.5 text-right font-bold ${n0(l.ecart) < 0 ? 'text-[#B42318]' : n0(l.ecart) > 0 ? 'text-[#2F6F33]' : 'text-[#8A8474]'}`}>
                              {recompte || l.ecart === null ? '—' : `${n0(l.ecart) > 0 ? '+' : ''}${fmtQte(l.ecart)}`}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right text-[#5E5A44]" title={`PUMP : ${l.pump_source || ''}`}>{fmtEuro(l.pump, 2)}</td>
                            <td className={`whitespace-nowrap px-2 py-1.5 text-right font-bold ${n0(l.valeur_ecart) < 0 ? 'text-[#B42318]' : n0(l.valeur_ecart) > 0 ? 'text-[#2F6F33]' : 'text-[#8A8474]'}`}>
                              {recompte || l.valeur_ecart === null ? '—' : fmtEuro(l.valeur_ecart, 2)}
                            </td>
                            <td className="max-w-[300px] truncate px-2 py-1.5 text-[#5E5A44]" title={commentairesLigne(l)}>{commentairesLigne(l) || ''}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              {recompte ? <span className="font-bold text-[#1D4F91]">{ORDINAL[detail.comptage_courant]} comptage en cours</span>
                                : l.decision === 'valide' ? <span className="font-bold text-[#2F6F33]" title={`${l.decision_par} · ${fmtDateHeure(l.decision_le)}`}>✓ Validé</span>
                                : l.decision === 'refuse' ? <span className="font-bold text-[#8A8474]" title={`${l.decision_par} · ${fmtDateHeure(l.decision_le)}`}>✕ Refusé</span>
                                : decide ? <span className="font-bold text-[#B4761A]">À décider</span> : ''}
                            </td>
                          </tr>
                        )
                      })}
                      {lignesDetail.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-[#8A8474]">Aucune ligne pour ce filtre.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Fenêtre campagne */}
      {formCampagne && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormCampagne(null)}>
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold">{formCampagne.id ? 'Modifier la campagne' : 'Nouvelle campagne d’inventaire'}</h2>
            <label className="block text-[12px] font-semibold">Libellé
              <input value={formCampagne.libelle} onChange={(e) => setFormCampagne({ ...formCampagne, libelle: e.target.value })} className={`${ctl} mt-1 w-full`} />
            </label>
            <label className="block text-[12px] font-semibold">Date de l’inventaire
              <input type="date" value={formCampagne.date} onChange={(e) => setFormCampagne({ ...formCampagne, date: e.target.value })} className={`${ctl} mt-1 w-full`} />
            </label>
            <label className="block text-[12px] font-semibold">Commentaire
              <textarea value={formCampagne.commentaire} onChange={(e) => setFormCampagne({ ...formCampagne, commentaire: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-[#E5E1D8] p-2 text-[13px]" />
            </label>
            {formCampagne.id && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={formCampagne.statut === 'cloturee'} onChange={(e) => setFormCampagne({ ...formCampagne, statut: e.target.checked ? 'cloturee' : 'ouverte' })} />
                Campagne clôturée (plus visible dans les agences)
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setFormCampagne(null)}>Annuler</button>
              <button type="button" className={btnNoir} disabled={occupe !== null} onClick={() => void enregistrerCampagne()}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation */}
      {confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmation(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold">{confirmation.titre}</h2>
            <p className="mt-2 text-[13.5px] text-[#3A362E]">{confirmation.texte}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setConfirmation(null)}>Annuler</button>
              <button type="button" className={btnNoir} onClick={() => { const a = confirmation.action; setConfirmation(null); void a() }}>{confirmation.bouton}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function PilotageInventairePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <PilotageInventaire />
    </Suspense>
  )
}
