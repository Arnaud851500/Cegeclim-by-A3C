'use client'

/**
 * Écran « Engagement Hitachi » (menu Stocks & logistique, /stock/engagement-hitachi).
 * ---------------------------------------------------------------------------
 * Créé le 19/11/2026 à la demande d'Arnaud — accès réservé (page + hitachi_engagement_autorise()).
 *
 * Engagement de l'année avec Hitachi (annexe 6 « Objectifs du 1er janvier au 31 décembre ») :
 *  - objectif de CA HT hors DEEE (BFA 1 %) et objectifs quantitatifs par gamme et par semestre ;
 *  - situation à date côté ACHATS : reçu sur l'année (lignes de CDF BLG du fournisseur, quantité
 *    livrée à sa date, prix d'achat net) + ferme à livrer d'ici le 31/12 (CDF SAGE ouvertes, en
 *    retard ou sans date = demain) ;
 *  - situation à date côté VENTES : BL de l'année (flux articles, CA et valeur d'achat = CA − marge)
 *    + CDC à livrer d'ici le 31/12 (valorisées en CA et au prix d'achat) ;
 *  - verdict par gamme et par semestre : atteint / atteint avec le ferme / manque N.
 *  En unités : les articles « comptés » de chaque gamme (groupes extérieurs, UI DRV pour System Free) ;
 *  en euros : toutes les familles, articles non rattachés compris (« Autres articles Hitachi »).
 *
 * Comptage en unités (choix du 19/11/2026) : il reproduit le « Réalisé 2025 » d'Hitachi, contrôlé sur nos
 * réceptions 2025 (RAC Mono 2 243 vs 2 259, Multi 1 061 vs 1 064, Yutampo 687 vs 687). Il diffère du drapeau
 * « quantité pertinente » SAGE sur 4 familles : groupes Airhome 200 (00AH200) et Triple C (00TRIPLCUE)
 * comptés bien que non pertinents SAGE ; ballons Yutampo (00YUTAMPUI) non comptés, Hitachi ne comptant que
 * les groupes ; UI System Free (00FREEUI) comptées, l'objectif étant en UI. Écarts signalés en orange ;
 * décocher « compter en unités » dans la règle pour revenir au drapeau SAGE.
 * Les « Autres articles Hitachi » (non rattachés) portent aussi les lignes négatives de régularisation
 * (−353 k€ au 19/11/2026), conservées dans le total en euros.
 *
 * Clic sur une gamme : rattachement des familles SAGE et des familles / sous-familles BLG
 * (règles hitachi_engagement_regles), articles comptés en unités, références de la gamme.
 *
 * Données : refresh_hitachi_engagement (pg_cron chaque heure + bouton « Actualiser »),
 * lecture get_hitachi_engagement / get_hitachi_engagement_refs, édition save / delete_hitachi_engagement_regle.
 * Migration : supabase/migrations/20261119_engagement_hitachi.sql.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

const COMPTES_AUTORISES = ['a.valanchauskas@cegeclim-energies.com', 'valancha@gmail.com']

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Gamme = {
  code: string; libelle: string; parent: string | null; est_total: boolean; ordre: number; unite: string | null
  obj_s1: number | null; obj_s2: number | null; realise_n1_s1: number | null; realise_n1_s2: number | null
  remises: string | null; bfa: string | null
}
type Regle = {
  id: number; gamme_code: string; famille_sage: string | null; famille_blg: string | null; sous_famille_blg: string | null
  motif_reference: string | null; exclure_motif: string | null; compte_qte: boolean; priorite: number; commentaire: string | null
  updated_at: string | null; updated_by: string | null
}
const MESURES = [
  'ach_recu_q_s1', 'ach_recu_q_s2', 'ach_recu_v_s1', 'ach_recu_v_s2', 'ach_n1_q_s1', 'ach_n1_q_s2', 'ach_n1_v',
  'ach_ferme_q_s1', 'ach_ferme_q_s2', 'ach_ferme_v_s1', 'ach_ferme_v_s2', 'ach_ferme_q_apres', 'ach_ferme_v_apres', 'ach_ferme_q_hyp',
  'ven_bl_q_s1', 'ven_bl_q_s2', 'ven_bl_ca_s1', 'ven_bl_ca_s2', 'ven_bl_cout_s1', 'ven_bl_cout_s2',
  'ven_ferme_q_s1', 'ven_ferme_q_s2', 'ven_ferme_ca', 'ven_ferme_cout', 'ven_ferme_q_apres', 'ven_ferme_ca_apres',
] as const
type Mesure = (typeof MESURES)[number]
type Mesures = Record<Mesure, number>
type Ligne = Partial<Record<Mesure, number | null>> & {
  gamme: string; regle_id: number | null; famille_sage: string | null; famille_blg: string | null; sous_famille_blg: string | null
  compte_qte: boolean; pertinent_sage: boolean | null; nb_refs: number
}
type Catalogue = {
  famille_sage: string | null; famille_blg: string | null; sous_famille_blg: string | null; gamme: string; regle_id: number | null
  compte_qte: boolean | null; pertinent_sage: boolean | null; nb_refs: number; nb_actifs: number; exemples: string[] | null
}
type Engagement = {
  annee: number; libelle: string; fournisseur_sage: string; fournisseur_blg: string; objectif_ca: number | null
  conditions: Record<string, string>
}
type Donnees = {
  annee: number; aujourdhui: string; engagement: Engagement | null
  refresh: { refreshed_at: string; duree_s: number | null; sources: Record<string, string | null> | null } | null
  gammes: Gamme[]; regles: Regle[]; lignes: Ligne[]; catalogue: Catalogue[]
}
type RefLigne = Partial<Record<Mesure, number | null>> & {
  ref_key: string | null; designation: string | null; famille_sage: string | null; famille_blg: string | null
  sous_famille_blg: string | null; compte_qte: boolean; regle_id: number | null
}

// Agrégat d'une gamme : quantités comptées (q*) et valeurs toutes familles (v*)
type Agg = { q: Mesures; v: Mesures; nbRefs: number }

// ─────────────────────────────────────────────────────────────────────────
// Formats
// ─────────────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtEur(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M€`
  if (a >= 10_000) return `${Math.round(v / 1000).toLocaleString('fr-FR')} k€`
  return `${Math.round(v).toLocaleString('fr-FR')} €`
}
function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${Math.round(v * 100)} %`
}
function fmtDateHeure(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
const vide = (): Mesures => Object.fromEntries(MESURES.map((k) => [k, 0])) as Mesures
const aggVide = (): Agg => ({ q: vide(), v: vide(), nbRefs: 0 })
function ajouter(a: Agg, l: Partial<Record<Mesure, number | null>>, compte: boolean, nbRefs = 0) {
  for (const k of MESURES) {
    const x = n(l[k])
    a.v[k] += x
    if (compte) a.q[k] += x
  }
  a.nbRefs += nbRefs
}
function cumuler(a: Agg, b: Agg) {
  for (const k of MESURES) {
    a.q[k] += b.q[k]
    a.v[k] += b.v[k]
  }
  a.nbRefs += b.nbRefs
}

// Verdict d'un semestre / de l'année
type Verdict = { cls: string; label: string; titre: string }
function verdict(reel: number, ferme: number, obj: number | null, clos: boolean): Verdict | null {
  if (!obj || obj <= 0) return null
  const ecart = reel - obj
  if (reel >= obj) return { cls: 'bg-emerald-100 text-emerald-800', label: `Atteint ${fmtPct(reel / obj)}`, titre: `Réel ${fmtNum(reel)} pour un objectif de ${fmtNum(obj)} (+${fmtNum(ecart)})` }
  if (clos) return { cls: 'bg-rose-100 text-rose-800', label: `Manqué ${fmtNum(ecart)}`, titre: `Semestre clos : ${fmtNum(reel)} pour ${fmtNum(obj)} (${fmtPct(reel / obj)})` }
  if (reel + ferme >= obj) return { cls: 'bg-sky-100 text-sky-800', label: `Avec le ferme ${fmtPct((reel + ferme) / obj)}`, titre: `Réel ${fmtNum(reel)} + ferme ${fmtNum(ferme)} = ${fmtNum(reel + ferme)} pour ${fmtNum(obj)}` }
  return { cls: 'bg-amber-100 text-amber-800', label: `Manque ${fmtNum(obj - reel - ferme)}`, titre: `Réel ${fmtNum(reel)} + ferme ${fmtNum(ferme)} = ${fmtNum(reel + ferme)} pour ${fmtNum(obj)} (${fmtPct((reel + ferme) / obj)})` }
}
function Badge({ v }: { v: Verdict | null }) {
  if (!v) return <span className="text-[#B8B3A7]">—</span>
  return <span title={v.titre} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${v.cls}`}>{v.label}</span>
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function EngagementHitachi() {
  const { loading: accessLoading, email } = useAccess()
  const autorise = COMPTES_AUTORISES.includes((email || '').trim().toLowerCase())

  const [annee, setAnnee] = useState<number>(new Date().getFullYear())
  const [data, setData] = useState<Donnees | null>(null)
  const [chargement, setChargement] = useState(false)
  const [actualisation, setActualisation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [vue, setVue] = useState<'unites' | 'euros'>('unites')
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const [editeur, setEditeur] = useState<string | null>(null)
  const [annexe, setAnnexe] = useState(false)

  const charger = useCallback(async (an: number) => {
    setChargement(true)
    setErreur(null)
    try {
      const { data: d, error } = await supabase.rpc('get_hitachi_engagement', { p_annee: an })
      if (error) throw error
      setData(d as Donnees)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => {
    if (autorise) charger(annee)
  }, [autorise, annee, charger])

  async function actualiser() {
    setActualisation(true)
    setErreur(null)
    setMessage(null)
    try {
      const { data: r, error } = await supabase.rpc('refresh_hitachi_engagement', { p_annee: annee })
      if (error) throw error
      const res = r as { duree_s?: number } | null
      setMessage(`Données actualisées${res?.duree_s ? ` en ${fmtNum(res.duree_s, 1)} s` : ''}.`)
      await charger(annee)
    } catch (e) {
      setErreur('Actualisation : ' + messageErreur(e))
    } finally {
      setActualisation(false)
    }
  }

  // ── Agrégats ──────────────────────────────────────────────────────────
  const gammes = useMemo(() => data?.gammes || [], [data])
  const parGamme = useMemo(() => {
    const m = new Map<string, Agg>()
    gammes.forEach((g) => m.set(g.code, aggVide()))
    for (const l of data?.lignes || []) {
      const code = m.has(l.gamme) ? l.gamme : 'AUTRES'
      if (!m.has(code)) m.set(code, aggVide())
      ajouter(m.get(code)!, l, !!l.compte_qte, n(l.nb_refs))
    }
    // totaux = somme des gammes filles
    for (const g of gammes.filter((x) => x.est_total)) {
      const t = aggVide()
      gammes.filter((x) => x.parent === g.code).forEach((c) => cumuler(t, m.get(c.code) || aggVide()))
      m.set(g.code, t)
    }
    return m
  }, [data, gammes])

  const total = useMemo(() => {
    const t = aggVide()
    for (const l of data?.lignes || []) ajouter(t, l, false, n(l.nb_refs))
    return t
  }, [data])

  const aujourdhui = data?.aujourdhui ? new Date(`${data.aujourdhui}T12:00:00`) : new Date()
  const s1Clos = aujourdhui >= new Date(annee, 6, 1)
  const objCa = n(data?.engagement?.objectif_ca)
  const achReel = total.v.ach_recu_v_s1 + total.v.ach_recu_v_s2
  const achFerme = total.v.ach_ferme_v_s1 + total.v.ach_ferme_v_s2
  const venReel = total.v.ven_bl_cout_s1 + total.v.ven_bl_cout_s2
  const venFerme = total.v.ven_ferme_cout
  const caVente = total.v.ven_bl_ca_s1 + total.v.ven_bl_ca_s2
  const debutAnnee = new Date(annee, 0, 1).getTime()
  const finAnnee = new Date(annee + 1, 0, 1).getTime()
  const prorata = Math.min(1, Math.max(0, (aujourdhui.getTime() - debutAnnee) / (finAnnee - debutAnnee)))

  const lignesDe = useCallback((code: string) => (data?.lignes || []).filter((l) => (l.gamme || 'AUTRES') === code), [data])

  // ── Accès ──────────────────────────────────────────────────────────────
  if (accessLoading) return <main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>
  if (!autorise) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F4F3F0] p-6 text-center">
        <div className="rounded-xl border border-[#E5E1D8] bg-white px-6 py-5">
          <div className="text-[17px] font-bold">Accès réservé</div>
          <p className="mt-1 text-[13px] text-[#5E5A44]">Le suivi de l’engagement Hitachi n’est pas encore ouvert.</p>
        </div>
      </main>
    )
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const th = 'whitespace-nowrap px-2 py-1.5 text-right text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#8A8474]'
  const td = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums'
  const sep = 'border-l-2 border-[#E5E1D8]'
  const visibles = gammes.filter((g) => g.code !== 'AUTRES' || (parGamme.get('AUTRES')?.nbRefs || 0) > 0)

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* En-tête */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · accès réservé</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Engagement Hitachi {annee}</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              {data?.engagement?.libelle || 'Objectifs annuels'} · fournisseur {data?.engagement?.fournisseur_sage || 'H0001'}
              {data?.refresh && <> · données du {fmtDateHeure(data.refresh.refreshed_at)}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className={ctl}>
              {[new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="flex overflow-hidden rounded-md border border-[#E5E1D8] text-[12px] font-semibold">
              {(['unites', 'euros'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setVue(v)} className={`px-3 py-1.5 ${vue === v ? 'bg-[#0B1220] text-white' : 'bg-white text-[#5E5A44]'}`}>
                  {v === 'unites' ? 'Unités' : 'Euros'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setAnnexe(true)} disabled={!data?.engagement} className="h-8 rounded-md border border-[#C8102E] bg-white px-3 text-[12px] font-semibold text-[#C8102E] hover:bg-[#FDECEE] disabled:opacity-50" title="Le contrat sous la forme de l’annexe 6 Hitachi, avec le réel du compagnon sous chaque bloc">
              Vue annexe 6
            </button>
            <button type="button" onClick={actualiser} disabled={actualisation} className="h-8 rounded-md bg-[#0B1220] px-3 text-[12px] font-semibold text-white disabled:opacity-50">
              {actualisation ? 'Actualisation…' : '⟳ Actualiser'}
            </button>
          </div>
        </section>

        {erreur && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{erreur}</div>}
        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">{message}</div>}
        {chargement && !data && <div className="rounded-lg bg-white px-3 py-6 text-center text-[13px] text-[#8A8474]">Chargement…</div>}
        {data && !data.engagement && (
          <div className="rounded-lg bg-white px-3 py-6 text-center text-[13px] text-[#8A8474]">Aucun engagement Hitachi saisi pour {annee}.</div>
        )}

        {data?.engagement && (
          <>
            {/* Indicateurs CA */}
            <section className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
              <Kpi
                titre="Objectif de CA (achats HT hors DEEE)"
                valeur={fmtEur(objCa)}
                detail={`Au prorata du ${aujourdhui.toLocaleDateString('fr-FR')} : ${fmtEur(objCa * prorata)} (${fmtPct(prorata)} de l’année)`}
              />
              <Kpi
                titre="Achats — reçu + ferme d’ici le 31/12"
                valeur={fmtEur(achReel + achFerme)}
                detail={`Reçu ${fmtEur(achReel)} (${fmtPct(objCa ? achReel / objCa : null)}) · ferme ${fmtEur(achFerme)}`}
                badge={verdict(achReel, achFerme, objCa, false)}
                jauge={objCa ? achReel / objCa : null}
                jaugeFerme={objCa ? (achReel + achFerme) / objCa : null}
              />
              <Kpi
                titre="Ventes — BL + CDC à livrer (valeur d’achat)"
                valeur={fmtEur(venReel + venFerme)}
                detail={`BL ${fmtEur(venReel)} (CA vente ${fmtEur(caVente)}) · CDC ${fmtEur(venFerme)} (CA ${fmtEur(total.v.ven_ferme_ca)})`}
                badge={verdict(venReel, venFerme, objCa, false)}
                jauge={objCa ? venReel / objCa : null}
                jaugeFerme={objCa ? (venReel + venFerme) / objCa : null}
              />
              <Kpi
                titre="BFA CA (1 % si objectif atteint)"
                valeur={achReel + achFerme >= objCa && objCa ? fmtEur((achReel + achFerme) * 0.01) : '0 €'}
                detail={
                  achReel + achFerme >= objCa && objCa
                    ? `Sur reçu + ferme (barème évolutif de l’annexe 7 non appliqué) · réel seul : ${achReel >= objCa ? fmtEur(achReel * 0.01) : 'pas encore'}`
                    : `Il manque ${fmtEur(objCa - achReel - achFerme)} d’achats`
                }
              />
            </section>
            <p className="px-1 text-[11px] text-[#8A8474]">
              CDF déjà passées pour livraison après le 31/12 : {fmtEur(total.v.ach_ferme_v_apres)} ({fmtNum(total.v.ach_ferme_q_apres)} pièces) — hors {annee}.
              {' '}Achats {annee - 1} reçus : {fmtEur(total.v.ach_n1_v)}.
            </p>

            {/* Tableau par gamme */}
            <section className="overflow-x-auto rounded-xl border border-[#E5E1D8] bg-white">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="bg-[#FAF9F6]">
                  <tr className="border-b border-[#E5E1D8]">
                    <th className="px-2 py-1" />
                    <th colSpan={4} className={`${th} ${sep} text-center text-[#5E5A44]`}>Objectif {vue === 'unites' ? '(unités)' : ''}</th>
                    <th colSpan={6} className={`${th} ${sep} text-center text-[#245A9E]`}>Achats {annee} — reçus + ferme</th>
                    <th colSpan={5} className={`${th} ${sep} text-center text-[#2F6B3A]`}>Ventes {annee} — BL + CDC à livrer</th>
                  </tr>
                  <tr className="border-b border-[#E5E1D8]">
                    <th className={`${th} text-left`}>Gamme</th>
                    {vue === 'unites' ? (
                      <>
                        <th className={`${th} ${sep}`}>S1</th>
                        <th className={th}>S2</th>
                        <th className={th}>Année</th>
                        <th className={th} title="Réalisé communiqué par Hitachi (annexe) · entre parenthèses : nos réceptions BLG de l’année précédente">Réal. {annee - 1}</th>
                        <th className={`${th} ${sep}`}>Reçu S1</th>
                        <th className={th}>S1</th>
                        <th className={th}>Reçu S2</th>
                        <th className={th} title="CDF SAGE ouvertes à livrer d’ici le 31/12 (en retard ou sans date = demain)">Ferme</th>
                        <th className={th}>S2</th>
                        <th className={th}>Année</th>
                        <th className={`${th} ${sep}`}>BL S1</th>
                        <th className={th}>BL S2</th>
                        <th className={th} title="CDC à livrer d’ici le 31/12 (date passée = à livrer)">CDC</th>
                        <th className={th}>S2</th>
                        <th className={th}>Année</th>
                      </>
                    ) : (
                      <>
                        <th className={`${th} ${sep}`} colSpan={2}>Part de l’objectif CA</th>
                        <th className={th}>Remises</th>
                        <th className={th} title="Nos réceptions BLG de l’année précédente">Achats {annee - 1}</th>
                        <th className={`${th} ${sep}`}>Reçu S1</th>
                        <th className={th}>Reçu S2</th>
                        <th className={th}>Ferme</th>
                        <th className={th}>Total</th>
                        <th className={th} colSpan={2}>vs {annee - 1}</th>
                        <th className={`${th} ${sep}`} title="Valeur d’achat des BL (CA − marge)">BL (achat)</th>
                        <th className={th}>CA BL</th>
                        <th className={th} title="CDC à livrer d’ici le 31/12, au prix d’achat">CDC (achat)</th>
                        <th className={th}>CA CDC</th>
                        <th className={th}>Total achat</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((g) => {
                    const a = parGamme.get(g.code) || aggVide()
                    const enfant = !!g.parent
                    const quantif = (g.obj_s1 ?? g.obj_s2 ?? g.realise_n1_s1) !== null && g.unite
                    const objAn = g.obj_s1 !== null || g.obj_s2 !== null ? n(g.obj_s1) + n(g.obj_s2) : null
                    const n1Hit = g.realise_n1_s1 !== null || g.realise_n1_s2 !== null ? n(g.realise_n1_s1) + n(g.realise_n1_s2) : null
                    const recuS1 = a.q.ach_recu_q_s1, recuS2 = a.q.ach_recu_q_s2
                    const fermeS1 = a.q.ach_ferme_q_s1, fermeS2 = a.q.ach_ferme_q_s2
                    const blS1 = a.q.ven_bl_q_s1, blS2 = a.q.ven_bl_q_s2
                    const cdcS1 = a.q.ven_ferme_q_s1, cdcS2 = a.q.ven_ferme_q_s2
                    const achV = a.v.ach_recu_v_s1 + a.v.ach_recu_v_s2
                    const achVF = a.v.ach_ferme_v_s1 + a.v.ach_ferme_v_s2
                    const ouvert = ouverts.has(g.code)
                    const detail = g.est_total ? [] : lignesDe(g.code)
                    const cls = g.est_total ? 'bg-[#F7F5EF] font-bold' : enfant ? '' : 'font-semibold'
                    return (
                      <React.Fragment key={g.code}>
                        <tr className={`border-b border-[#EFECE5] ${cls}`}>
                          <td className="whitespace-nowrap px-2 py-1.5 text-left">
                            <div className={`flex items-center gap-1.5 ${enfant ? 'pl-5' : ''}`}>
                              {!g.est_total && (
                                <button
                                  type="button"
                                  onClick={() => setOuverts((s) => { const x = new Set(s); if (x.has(g.code)) x.delete(g.code); else x.add(g.code); return x })}
                                  className="w-4 text-[#8A8474]"
                                  title="Détail par famille"
                                >
                                  {ouvert ? '▾' : '▸'}
                                </button>
                              )}
                              {g.est_total ? (
                                <span>{g.libelle}</span>
                              ) : (
                                <button type="button" onClick={() => setEditeur(g.code)} className="text-left underline decoration-dotted underline-offset-2 hover:text-[#B4761A]" title="Familles et sous-familles rattachées">
                                  {g.libelle}
                                </button>
                              )}
                              {g.bfa && <span className="rounded bg-[#7A5EA8]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#5B4385]" title={g.bfa}>BFA</span>}
                              {g.unite && quantif && <span className="text-[10.5px] font-normal text-[#8A8474]">{g.unite}</span>}
                            </div>
                          </td>
                          {vue === 'unites' ? (
                            <>
                              <td className={`${td} ${sep}`}>{fmtNum(g.obj_s1)}</td>
                              <td className={td}>{fmtNum(g.obj_s2)}</td>
                              <td className={td}>{fmtNum(objAn)}</td>
                              <td className={`${td} text-[#5E5A44]`} title={`Hitachi : S1 ${fmtNum(g.realise_n1_s1)} · S2 ${fmtNum(g.realise_n1_s2)} — nos réceptions : S1 ${fmtNum(a.q.ach_n1_q_s1)} · S2 ${fmtNum(a.q.ach_n1_q_s2)}`}>
                                {quantif ? <>{fmtNum(n1Hit)} <span className="text-[10.5px] text-[#8A8474]">({fmtNum(a.q.ach_n1_q_s1 + a.q.ach_n1_q_s2)})</span></> : '—'}
                              </td>
                              <td className={`${td} ${sep}`}>{quantif ? fmtNum(recuS1) : '—'}</td>
                              <td className={td}><Badge v={quantif ? verdict(recuS1, fermeS1, g.obj_s1, s1Clos) : null} /></td>
                              <td className={td}>{quantif ? fmtNum(recuS2) : '—'}</td>
                              <td className={td} title={a.q.ach_ferme_q_hyp ? `dont ${fmtNum(a.q.ach_ferme_q_hyp)} en retard ou sans date (supposées demain) · après le 31/12 : ${fmtNum(a.q.ach_ferme_q_apres)}` : `après le 31/12 : ${fmtNum(a.q.ach_ferme_q_apres)}`}>
                                {quantif ? fmtNum(fermeS1 + fermeS2) : '—'}
                              </td>
                              <td className={td}><Badge v={quantif ? verdict(recuS2, fermeS2, g.obj_s2, false) : null} /></td>
                              <td className={td}><Badge v={quantif ? verdict(recuS1 + recuS2, fermeS1 + fermeS2, objAn, false) : null} /></td>
                              <td className={`${td} ${sep}`}>{quantif ? fmtNum(blS1) : '—'}</td>
                              <td className={td}>{quantif ? fmtNum(blS2) : '—'}</td>
                              <td className={td} title={`après le 31/12 : ${fmtNum(a.q.ven_ferme_q_apres)}`}>{quantif ? fmtNum(cdcS1 + cdcS2) : '—'}</td>
                              <td className={td}><Badge v={quantif ? verdict(blS2, cdcS2, g.obj_s2, false) : null} /></td>
                              <td className={td}><Badge v={quantif ? verdict(blS1 + blS2, cdcS1 + cdcS2, objAn, false) : null} /></td>
                            </>
                          ) : (
                            <>
                              <td className={`${td} ${sep}`} colSpan={2}>
                                <span className="text-[#5E5A44]">{objCa ? fmtPct((achV + achVF) / objCa) : '—'}</span>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] text-[#8A8474]">{g.remises || ''}</td>
                              <td className={`${td} text-[#5E5A44]`}>{fmtEur(a.v.ach_n1_v)}</td>
                              <td className={`${td} ${sep}`}>{fmtEur(a.v.ach_recu_v_s1)}</td>
                              <td className={td}>{fmtEur(a.v.ach_recu_v_s2)}</td>
                              <td className={td} title={`après le 31/12 : ${fmtEur(a.v.ach_ferme_v_apres)}`}>{fmtEur(achVF)}</td>
                              <td className={`${td} font-bold`}>{fmtEur(achV + achVF)}</td>
                              <td className={td} colSpan={2}>
                                {a.v.ach_n1_v ? <span className={achV + achVF >= a.v.ach_n1_v ? 'text-emerald-700' : 'text-rose-700'}>{fmtPct((achV + achVF) / a.v.ach_n1_v - 1).replace(/^(?!-)/, '+')}</span> : '—'}
                              </td>
                              <td className={`${td} ${sep}`}>{fmtEur(a.v.ven_bl_cout_s1 + a.v.ven_bl_cout_s2)}</td>
                              <td className={`${td} text-[#5E5A44]`}>{fmtEur(a.v.ven_bl_ca_s1 + a.v.ven_bl_ca_s2)}</td>
                              <td className={td}>{fmtEur(a.v.ven_ferme_cout)}</td>
                              <td className={`${td} text-[#5E5A44]`}>{fmtEur(a.v.ven_ferme_ca)}</td>
                              <td className={`${td} font-bold`}>{fmtEur(a.v.ven_bl_cout_s1 + a.v.ven_bl_cout_s2 + a.v.ven_ferme_cout)}</td>
                            </>
                          )}
                        </tr>
                        {ouvert && detail.map((l, i) => {
                          const libelle = [l.famille_sage, l.famille_blg && l.sous_famille_blg ? `${l.famille_blg} › ${l.sous_famille_blg}` : l.famille_blg].filter(Boolean).join(' · ') || 'Article sans famille'
                          const q = (k: Mesure) => (l.compte_qte ? fmtNum(n(l[k])) : '—')
                          return (
                            <tr key={`${g.code}-${i}`} className="border-b border-[#F3F1EC] bg-[#FCFBF8] text-[11.5px] text-[#5E5A44]">
                              <td className="whitespace-nowrap px-2 py-1 text-left">
                                <div className={`${enfant ? 'pl-11' : 'pl-6'} flex items-center gap-1.5`}>
                                  <span>{libelle}</span>
                                  <span className={`rounded px-1 text-[10px] font-bold ${l.compte_qte ? 'bg-[#245A9E]/10 text-[#245A9E]' : 'bg-[#EFECE5] text-[#8A8474]'}`} title={l.compte_qte ? 'Compté en unités' : 'En euros seulement'}>
                                    {l.compte_qte ? 'unités' : '€'}
                                  </span>
                                  {l.pertinent_sage !== null && l.compte_qte !== l.pertinent_sage && (
                                    <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700" title="Différent du drapeau « quantité pertinente » de la famille SAGE">
                                      {l.pertinent_sage ? 'pertinent SAGE' : 'non pertinent SAGE'}
                                    </span>
                                  )}
                                  <span className="text-[10.5px] text-[#B8B3A7]">{fmtNum(l.nb_refs)} réf.</span>
                                </div>
                              </td>
                              {vue === 'unites' ? (
                                <>
                                  <td className={`${td} ${sep}`} colSpan={3} />
                                  <td className={td}>{l.compte_qte ? fmtNum(n(l.ach_n1_q_s1) + n(l.ach_n1_q_s2)) : '—'}</td>
                                  <td className={`${td} ${sep}`}>{q('ach_recu_q_s1')}</td>
                                  <td className={td} />
                                  <td className={td}>{q('ach_recu_q_s2')}</td>
                                  <td className={td}>{l.compte_qte ? fmtNum(n(l.ach_ferme_q_s1) + n(l.ach_ferme_q_s2)) : '—'}</td>
                                  <td className={td} colSpan={2} />
                                  <td className={`${td} ${sep}`}>{q('ven_bl_q_s1')}</td>
                                  <td className={td}>{q('ven_bl_q_s2')}</td>
                                  <td className={td}>{l.compte_qte ? fmtNum(n(l.ven_ferme_q_s1) + n(l.ven_ferme_q_s2)) : '—'}</td>
                                  <td className={td} colSpan={2} />
                                </>
                              ) : (
                                <>
                                  <td className={`${td} ${sep}`} colSpan={3} />
                                  <td className={td}>{fmtEur(n(l.ach_n1_v))}</td>
                                  <td className={`${td} ${sep}`}>{fmtEur(n(l.ach_recu_v_s1))}</td>
                                  <td className={td}>{fmtEur(n(l.ach_recu_v_s2))}</td>
                                  <td className={td}>{fmtEur(n(l.ach_ferme_v_s1) + n(l.ach_ferme_v_s2))}</td>
                                  <td className={td}>{fmtEur(n(l.ach_recu_v_s1) + n(l.ach_recu_v_s2) + n(l.ach_ferme_v_s1) + n(l.ach_ferme_v_s2))}</td>
                                  <td className={td} colSpan={2} />
                                  <td className={`${td} ${sep}`}>{fmtEur(n(l.ven_bl_cout_s1) + n(l.ven_bl_cout_s2))}</td>
                                  <td className={td}>{fmtEur(n(l.ven_bl_ca_s1) + n(l.ven_bl_ca_s2))}</td>
                                  <td className={td}>{fmtEur(n(l.ven_ferme_cout))}</td>
                                  <td className={td}>{fmtEur(n(l.ven_ferme_ca))}</td>
                                  <td className={td}>{fmtEur(n(l.ven_bl_cout_s1) + n(l.ven_bl_cout_s2) + n(l.ven_ferme_cout))}</td>
                                </>
                              )}
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                  {vue === 'euros' && (
                    <tr className="border-t-2 border-[#0B1220] bg-[#F7F5EF] font-bold">
                      <td className="px-2 py-1.5 text-left">Total Hitachi (toutes familles)</td>
                      <td className={`${td} ${sep}`} colSpan={2}>{fmtPct(objCa ? (achReel + achFerme) / objCa : null)}</td>
                      <td className={`${td} text-[11px] font-semibold text-[#5E5A44]`}>obj. {fmtEur(objCa)}</td>
                      <td className={td}>{fmtEur(total.v.ach_n1_v)}</td>
                      <td className={`${td} ${sep}`}>{fmtEur(total.v.ach_recu_v_s1)}</td>
                      <td className={td}>{fmtEur(total.v.ach_recu_v_s2)}</td>
                      <td className={td}>{fmtEur(achFerme)}</td>
                      <td className={td}>{fmtEur(achReel + achFerme)}</td>
                      <td className={td} colSpan={2}>{total.v.ach_n1_v ? fmtPct((achReel + achFerme) / total.v.ach_n1_v - 1).replace(/^(?!-)/, '+') : '—'}</td>
                      <td className={`${td} ${sep}`}>{fmtEur(venReel)}</td>
                      <td className={td}>{fmtEur(caVente)}</td>
                      <td className={td}>{fmtEur(venFerme)}</td>
                      <td className={td}>{fmtEur(total.v.ven_ferme_ca)}</td>
                      <td className={td}>{fmtEur(venReel + venFerme)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {/* Règles de lecture — mises en commentaire à la demande d'Arnaud (19/11/2026), conservées pour mémoire :
            <section className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-3 text-[11.5px] leading-relaxed text-[#5E5A44]">
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#8A8474]">Lecture</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li><b>Unités</b> : articles comptés de chaque gamme (groupes extérieurs ; UI DRV pour System Free), comme le « Réalisé {annee - 1} » d’Hitachi. <b>Euros</b> : toutes les familles, articles non rattachés compris. Cliquer sur une gamme pour modifier ses familles et sous-familles.</li>
                <li><b>Achats</b> : reçu = lignes de commandes fournisseur BLG livrées dans l’année (prix d’achat net) ; ferme = CDF SAGE ouvertes à livrer d’ici le 31/12, celles en retard ou sans date étant supposées livrées demain.</li>
                <li><b>Ventes</b> : BL de l’année (valeur d’achat = CA − marge) et CDC à livrer d’ici le 31/12 (prix d’achat de l’article).</li>
                <li><b>Verdicts</b> : « Atteint » sur le réel seul ; « Avec le ferme » si réel + ferme couvrent l’objectif ; « Manque » = ce qui reste à commander / vendre ; « Manqué » = semestre clos sous l’objectif.</li>
                {data.engagement.conditions?.bfa_ca && <li>{data.engagement.conditions.bfa_ca}</li>}
                {data.engagement.conditions?.bfa_rac && <li>{data.engagement.conditions.bfa_rac}</li>}
                {data.engagement.conditions?.bfa_setfree && <li>{data.engagement.conditions.bfa_setfree}</li>}
                {data.refresh?.sources && (
                  <li>
                    Sources : réceptions BLG synchronisées le {fmtDateHeure(data.refresh.sources.recus_blg)} · CDF SAGE chargées le {fmtDateHeure(data.refresh.sources.cdf_sage)} · BL le {fmtDateHeure(data.refresh.sources.bl_flux)}.
                  </li>
                )}
              </ul>
            </section>
            */}
          </>
        )}
      </div>

      {annexe && data?.engagement && (
        <VueAnnexe6
          annee={annee}
          engagement={data.engagement}
          gammes={gammes}
          parGamme={parGamme}
          lignes={data.lignes}
          total={total}
          s1Clos={s1Clos}
          aujourdhui={aujourdhui}
          sources={data.refresh}
          onClose={() => setAnnexe(false)}
        />
      )}

      {editeur && data && (
        <EditeurGamme
          annee={annee}
          gamme={gammes.find((g) => g.code === editeur)!}
          gammes={gammes}
          regles={data.regles}
          catalogue={data.catalogue}
          onClose={() => setEditeur(null)}
          onChange={() => charger(annee)}
        />
      )}
    </main>
  )
}

function Kpi({ titre, valeur, detail, badge, jauge, jaugeFerme }: { titre: string; valeur: string; detail?: string; badge?: Verdict | null; jauge?: number | null; jaugeFerme?: number | null }) {
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#8A8474]">{titre}</p>
        {badge && <Badge v={badge} />}
      </div>
      <p className="mt-1 whitespace-nowrap text-[22px] font-bold tabular-nums">{valeur}</p>
      {jauge !== undefined && jauge !== null && (
        <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-[#EFECE5]">
          {jaugeFerme !== undefined && jaugeFerme !== null && <div className="absolute inset-y-0 left-0 bg-sky-300" style={{ width: `${Math.min(100, jaugeFerme * 100)}%` }} />}
          <div className={`absolute inset-y-0 left-0 ${jauge >= 1 ? 'bg-emerald-600' : 'bg-[#245A9E]'}`} style={{ width: `${Math.min(100, jauge * 100)}%` }} />
        </div>
      )}
      {detail && <p className="mt-1 text-[11.5px] text-[#5E5A44]">{detail}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Éditeur de rattachement d'une gamme
// ─────────────────────────────────────────────────────────────────────────

type Brouillon = {
  id: number | null; famille_sage: string; famille_blg: string; sous_famille_blg: string; motif_reference: string
  exclure_motif: string; compte_qte: boolean; priorite: number; commentaire: string; gamme_code: string
}

function EditeurGamme({ annee, gamme, gammes, regles, catalogue, onClose, onChange }: {
  annee: number; gamme: Gamme; gammes: Gamme[]; regles: Regle[]; catalogue: Catalogue[]; onClose: () => void; onChange: () => Promise<void> | void
}) {
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [refs, setRefs] = useState<RefLigne[] | null>(null)
  const [refsChargement, setRefsChargement] = useState(false)

  const mesRegles = regles.filter((r) => r.gamme_code === gamme.code)
  const rattaches = catalogue.filter((c) => c.gamme === gamme.code)
  const autres = catalogue.filter((c) => c.gamme === 'AUTRES' && c.nb_actifs > 0 && gamme.code !== 'AUTRES')
  const famillesSage = Array.from(new Set(catalogue.map((c) => c.famille_sage).filter(Boolean) as string[])).sort()
  const famillesBlg = Array.from(new Set(catalogue.map((c) => c.famille_blg).filter(Boolean) as string[])).sort()
  const sousFamilles = (fam: string) => Array.from(new Set(catalogue.filter((c) => !fam || c.famille_blg === fam).map((c) => c.sous_famille_blg).filter(Boolean) as string[])).sort()
  const feuilles = gammes.filter((g) => !g.est_total)

  const nouveau = (base?: Partial<Brouillon>): Brouillon => ({
    id: null, famille_sage: '', famille_blg: '', sous_famille_blg: '', motif_reference: '', exclure_motif: '',
    compte_qte: !!gamme.unite, priorite: 100, commentaire: '', gamme_code: gamme.code, ...base,
  })
  const depuis = (r: Regle): Brouillon => ({
    id: r.id, famille_sage: r.famille_sage || '', famille_blg: r.famille_blg || '', sous_famille_blg: r.sous_famille_blg || '',
    motif_reference: r.motif_reference || '', exclure_motif: r.exclure_motif || '', compte_qte: r.compte_qte, priorite: r.priorite,
    commentaire: r.commentaire || '', gamme_code: r.gamme_code,
  })

  async function enregistrer(b: Brouillon) {
    setOccupe(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('save_hitachi_engagement_regle', {
        p_id: b.id, p_annee: annee, p_gamme: b.gamme_code, p_famille_sage: b.famille_sage, p_famille_blg: b.famille_blg,
        p_sous_famille_blg: b.sous_famille_blg, p_motif: b.motif_reference, p_exclure: b.exclure_motif, p_compte_qte: b.compte_qte,
        p_priorite: b.priorite, p_commentaire: b.commentaire,
      })
      if (error) throw error
      setBrouillon(null)
      setRefs(null)
      await onChange()
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setOccupe(false)
    }
  }
  async function supprimer(id: number) {
    if (!window.confirm('Supprimer cette règle de rattachement ?')) return
    setOccupe(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('delete_hitachi_engagement_regle', { p_id: id })
      if (error) throw error
      setRefs(null)
      await onChange()
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setOccupe(false)
    }
  }
  async function chargerRefs() {
    setRefsChargement(true)
    setErreur(null)
    try {
      const { data, error } = await supabase.rpc('get_hitachi_engagement_refs', { p_annee: annee, p_gamme: gamme.code })
      if (error) throw error
      setRefs((data as RefLigne[]) || [])
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setRefsChargement(false)
    }
  }

  const ctl = 'h-8 w-full min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] text-[#3A362E] outline-none focus:border-[#B4761A]'
  const critere = (r: { famille_sage: string | null; famille_blg: string | null; sous_famille_blg: string | null; motif_reference?: string | null; exclure_motif?: string | null }) =>
    [
      r.famille_sage && `SAGE ${r.famille_sage}`,
      r.famille_blg && `BLG ${r.famille_blg}${r.sous_famille_blg ? ` › ${r.sous_famille_blg}` : ''}`,
      !r.famille_blg && r.sous_famille_blg && `BLG › ${r.sous_famille_blg}`,
      r.motif_reference && `réf. ${r.motif_reference}`,
      r.exclure_motif && `sauf ${r.exclure_motif}`,
    ].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-[980px] overflow-y-auto bg-[#F4F3F0] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">Rattachement · {annee}</p>
            <h2 className="text-[18px] font-bold">{gamme.libelle}</h2>
            <p className="text-[11.5px] text-[#8A8474]">
              {!gamme.unite
                ? 'Gamme suivie en euros'
                : gamme.obj_s1 === null && gamme.obj_s2 === null && gamme.parent
                  ? `Comptée en ${gamme.unite} · objectif porté par « ${gammes.find((g) => g.code === gamme.parent)?.libelle || gamme.parent} »`
                  : `Objectif en ${gamme.unite} : S1 ${fmtNum(gamme.obj_s1)} · S2 ${fmtNum(gamme.obj_s2)}`}
              {gamme.remises && <> · {gamme.remises}</>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-[#E5E1D8] bg-white px-3 py-1.5 text-[12px] font-semibold">Fermer</button>
        </div>

        {erreur && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{erreur}</div>}

        {/* Règles */}
        <section className="mt-3 rounded-xl border border-[#E5E1D8] bg-white">
          <div className="flex items-center justify-between border-b border-[#EFECE5] px-3 py-2">
            <p className="text-[12px] font-bold">Règles de rattachement</p>
            <button type="button" onClick={() => setBrouillon(nouveau())} className="rounded-md bg-[#0B1220] px-2.5 py-1 text-[11.5px] font-semibold text-white">+ Ajouter</button>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8A8474]">
                <th className="px-3 py-1.5">Critère</th>
                <th className="px-2 py-1.5">Unités</th>
                <th className="px-2 py-1.5 text-right">Priorité</th>
                <th className="px-2 py-1.5">Commentaire</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {mesRegles.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-[#8A8474]">Aucune règle : rien n’est rattaché à cette gamme.</td></tr>}
              {mesRegles.map((r) => (
                <tr key={r.id} className="border-t border-[#F3F1EC]">
                  <td className="px-3 py-1.5 font-semibold">{critere(r)}</td>
                  <td className="px-2 py-1.5">{r.compte_qte ? <span className="rounded bg-[#245A9E]/10 px-1.5 text-[10.5px] font-bold text-[#245A9E]">comptées</span> : <span className="text-[#8A8474]">€ seulement</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.priorite}</td>
                  <td className="px-2 py-1.5 text-[#5E5A44]">{r.commentaire}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <button type="button" onClick={() => setBrouillon(depuis(r))} className="mr-2 text-[#245A9E] hover:underline">Modifier</button>
                    <button type="button" onClick={() => supprimer(r.id)} disabled={occupe} className="text-rose-700 hover:underline">Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-[#F3F1EC] px-3 py-1.5 text-[10.5px] text-[#8A8474]">
            Chaque article prend la première règle qui lui correspond, toutes gammes confondues : priorité la plus basse d’abord, puis la plus précise (motif de référence, sous-famille BLG, famille BLG). Motif : syntaxe LIKE, % = n’importe quels caractères (ex. RAS-%FS%NME%).
          </p>
        </section>

        {brouillon && (
          <section className="mt-3 rounded-xl border-2 border-[#B4761A]/40 bg-white p-3">
            <p className="mb-2 text-[12px] font-bold">{brouillon.id ? 'Modifier la règle' : 'Nouvelle règle'}</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <label className="text-[11px] font-semibold text-[#5E5A44]">Famille SAGE
                <input list="he-familles-sage" value={brouillon.famille_sage} onChange={(e) => setBrouillon({ ...brouillon, famille_sage: e.target.value.toUpperCase() })} className={ctl} placeholder="ex. 00RACUE" />
              </label>
              <label className="text-[11px] font-semibold text-[#5E5A44]">Famille BLG
                <input list="he-familles-blg" value={brouillon.famille_blg} onChange={(e) => setBrouillon({ ...brouillon, famille_blg: e.target.value })} className={ctl} />
              </label>
              <label className="text-[11px] font-semibold text-[#5E5A44]">Sous-famille BLG
                <input list="he-sous-familles" value={brouillon.sous_famille_blg} onChange={(e) => setBrouillon({ ...brouillon, sous_famille_blg: e.target.value })} className={ctl} />
              </label>
              <label className="text-[11px] font-semibold text-[#5E5A44]">Motif de référence
                <input value={brouillon.motif_reference} onChange={(e) => setBrouillon({ ...brouillon, motif_reference: e.target.value.toUpperCase() })} className={ctl} placeholder="ex. RAC-%" />
              </label>
              <label className="text-[11px] font-semibold text-[#5E5A44]">Sauf motif
                <input value={brouillon.exclure_motif} onChange={(e) => setBrouillon({ ...brouillon, exclure_motif: e.target.value.toUpperCase() })} className={ctl} />
              </label>
              <label className="text-[11px] font-semibold text-[#5E5A44]">Gamme
                <select value={brouillon.gamme_code} onChange={(e) => setBrouillon({ ...brouillon, gamme_code: e.target.value })} className={ctl}>
                  {feuilles.map((g) => <option key={g.code} value={g.code}>{g.libelle}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-[#5E5A44]">Priorité
                <input type="number" value={brouillon.priorite} onChange={(e) => setBrouillon({ ...brouillon, priorite: Number(e.target.value) || 100 })} className={ctl} />
              </label>
              <label className="md:col-span-2 text-[11px] font-semibold text-[#5E5A44]">Commentaire
                <input value={brouillon.commentaire} onChange={(e) => setBrouillon({ ...brouillon, commentaire: e.target.value })} className={ctl} />
              </label>
              <label className="flex items-center gap-2 text-[12px] font-semibold text-[#3A362E]">
                <input type="checkbox" checked={brouillon.compte_qte} onChange={(e) => setBrouillon({ ...brouillon, compte_qte: e.target.checked })} />
                Compter ces articles en unités (objectif quantitatif)
              </label>
            </div>
            <datalist id="he-familles-sage">{famillesSage.map((f) => <option key={f} value={f} />)}</datalist>
            <datalist id="he-familles-blg">{famillesBlg.map((f) => <option key={f} value={f} />)}</datalist>
            <datalist id="he-sous-familles">{sousFamilles(brouillon.famille_blg).map((f) => <option key={f} value={f} />)}</datalist>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setBrouillon(null)} className="rounded-md border border-[#E5E1D8] px-3 py-1.5 text-[12px] font-semibold">Annuler</button>
              <button type="button" onClick={() => enregistrer(brouillon)} disabled={occupe} className="rounded-md bg-[#0B1220] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
                {occupe ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </section>
        )}

        {/* Classements rattachés */}
        <section className="mt-3 rounded-xl border border-[#E5E1D8] bg-white">
          <p className="border-b border-[#EFECE5] px-3 py-2 text-[12px] font-bold">Familles et sous-familles rattachées ({rattaches.length})</p>
          <Classements lignes={rattaches} regles={regles} />
        </section>

        {autres.length > 0 && (
          <section className="mt-3 rounded-xl border border-[#E5E1D8] bg-white">
            <p className="border-b border-[#EFECE5] px-3 py-2 text-[12px] font-bold">Non rattachées, avec de l’activité (« Autres articles Hitachi »)</p>
            <Classements
              lignes={autres}
              regles={regles}
              action={(c) => (
                <button
                  type="button"
                  className="text-[#245A9E] hover:underline"
                  onClick={() => setBrouillon(nouveau({ famille_sage: c.famille_blg ? '' : c.famille_sage || '', famille_blg: c.famille_blg || '', sous_famille_blg: c.sous_famille_blg || '' }))}
                >
                  Rattacher ici
                </button>
              )}
            />
          </section>
        )}

        {/* Références */}
        <section className="mt-3 rounded-xl border border-[#E5E1D8] bg-white">
          <div className="flex items-center justify-between border-b border-[#EFECE5] px-3 py-2">
            <p className="text-[12px] font-bold">Références de la gamme avec de l’activité {annee}</p>
            <button type="button" onClick={chargerRefs} disabled={refsChargement} className="rounded-md border border-[#E5E1D8] px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50">
              {refsChargement ? 'Chargement…' : refs ? 'Recharger' : 'Afficher'}
            </button>
          </div>
          {refs && (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-[#FAF9F6]">
                  <tr className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#8A8474]">
                    <th className="px-2 py-1 text-left">Référence</th>
                    <th className="px-2 py-1 text-left">Famille SAGE · BLG</th>
                    <th className="px-2 py-1 text-right">Reçu</th>
                    <th className="px-2 py-1 text-right">Reçu €</th>
                    <th className="px-2 py-1 text-right">Ferme</th>
                    <th className="px-2 py-1 text-right">BL</th>
                    <th className="px-2 py-1 text-right">CDC</th>
                  </tr>
                </thead>
                <tbody>
                  {refs.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-[#8A8474]">Aucune référence avec de l’activité.</td></tr>}
                  {refs.map((r, i) => (
                    <tr key={`${r.ref_key}-${i}`} className="border-t border-[#F3F1EC]">
                      <td className="whitespace-nowrap px-2 py-1">
                        <span className="font-semibold">{r.ref_key || '(sans référence)'}</span>
                        {!r.compte_qte && <span className="ml-1 text-[10px] text-[#8A8474]">€</span>}
                        {r.designation && <div className="max-w-[300px] truncate text-[10.5px] text-[#8A8474]">{r.designation}</div>}
                      </td>
                      <td className="px-2 py-1 text-[#5E5A44]">{[r.famille_sage, r.sous_famille_blg].filter(Boolean).join(' · ')}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmtNum(n(r.ach_recu_q_s1) + n(r.ach_recu_q_s2))}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmtEur(n(r.ach_recu_v_s1) + n(r.ach_recu_v_s2))}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmtNum(n(r.ach_ferme_q_s1) + n(r.ach_ferme_q_s2))}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmtNum(n(r.ven_bl_q_s1) + n(r.ven_bl_q_s2))}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmtNum(n(r.ven_ferme_q_s1) + n(r.ven_ferme_q_s2))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Classements({ lignes, regles, action }: { lignes: Catalogue[]; regles: Regle[]; action?: (c: Catalogue) => React.ReactNode }) {
  if (lignes.length === 0) return <p className="px-3 py-3 text-[12px] text-[#8A8474]">Aucune.</p>
  const regle = (id: number | null) => regles.find((r) => r.id === id)
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr className="text-left text-[10px] font-bold uppercase tracking-[0.05em] text-[#8A8474]">
          <th className="px-3 py-1">Famille SAGE</th>
          <th className="px-2 py-1">Famille › sous-famille BLG</th>
          <th className="px-2 py-1 text-right">Réf.</th>
          <th className="px-2 py-1 text-right">Actives</th>
          <th className="px-2 py-1">Unités</th>
          <th className="px-2 py-1">Exemples</th>
          {action && <th className="px-2 py-1" />}
        </tr>
      </thead>
      <tbody>
        {lignes.map((c, i) => {
          const r = regle(c.regle_id)
          return (
            <tr key={i} className="border-t border-[#F3F1EC]" title={r ? `Règle : ${[r.famille_sage, r.famille_blg, r.sous_famille_blg, r.motif_reference].filter(Boolean).join(' · ')} (priorité ${r.priorite})` : 'Aucune règle'}>
              <td className="whitespace-nowrap px-3 py-1 font-semibold">{c.famille_sage || '—'}</td>
              <td className="px-2 py-1 text-[#5E5A44]">{c.famille_blg ? `${c.famille_blg}${c.sous_famille_blg ? ` › ${c.sous_famille_blg}` : ''}` : '—'}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtNum(c.nb_refs)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtNum(c.nb_actifs)}</td>
              <td className="whitespace-nowrap px-2 py-1">
                {c.compte_qte ? <span className="text-[#245A9E]">comptées</span> : <span className="text-[#8A8474]">€</span>}
                {c.pertinent_sage !== null && !!c.compte_qte !== c.pertinent_sage && (
                  <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700">{c.pertinent_sage ? 'pertinent SAGE' : 'non pertinent SAGE'}</span>
                )}
              </td>
              <td className="max-w-[260px] truncate px-2 py-1 text-[10.5px] text-[#8A8474]">{(c.exemples || []).join(', ')}</td>
              {action && <td className="whitespace-nowrap px-2 py-1 text-right">{action(c)}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function EngagementHitachiPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <EngagementHitachi />
    </Suspense>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Vue « Annexe 6 » (20/11/2026, demandée par Arnaud) : le contrat présenté comme
// le document Hitachi (mêmes blocs, mêmes colonnes), avec sous chaque bloc les
// lignes du réel calculé par le compagnon.
// ─────────────────────────────────────────────────────────────────────────

const ANNEXE_COLONNES: { code: string; libelle: string; bfa?: 1 | 2 }[] = [
  { code: 'ACC', libelle: 'Accessoires' },
  { code: 'RAC_MONO', libelle: 'RAC Mono' },
  { code: 'RAC_MULTI', libelle: 'RAC Multi' },
  { code: 'RAC_TOTAL', libelle: 'RAC Total', bfa: 1 },
  { code: 'YUTAKI_S', libelle: 'Yutaki S / AirH2O 600' },
  { code: 'YUTAKI_M', libelle: 'YUTAKI-M/ AirH2O 800' },
  { code: 'AIRH2O400', libelle: 'AirH2O 400' },
  { code: 'PAC_TOTAL', libelle: 'TOTAL PAC Air / Eau' },
  { code: 'YUTAMPO', libelle: 'YUTAMPO' },
  { code: 'PACKAGE', libelle: 'PRIMAIRY / IVX / UTOPIA PRIME' },
  { code: 'SETFREE_MINI', libelle: 'Air 365 - Set Free Mini', bfa: 2 },
  { code: 'SYSTEM_FREE', libelle: 'System Free (UI DRV)' },
]

function VueAnnexe6({ annee, engagement, gammes, parGamme, lignes, total, s1Clos, aujourdhui, sources, onClose }: {
  annee: number; engagement: Engagement; gammes: Gamme[]; parGamme: Map<string, Agg>; lignes: Ligne[]; total: Agg
  s1Clos: boolean; aujourdhui: Date; sources: Donnees['refresh']; onClose: () => void
}) {
  const ROUGE = '#E2232E'
  const g = (code: string) => gammes.find((x) => x.code === code)
  const a = (code: string) => parGamme.get(code) || aggVide()
  const dateJour = aujourdhui.toLocaleDateString('fr-FR')

  // ── Euros par semestre (achats reçus + ferme) ──
  const vRecu = (x: Agg, s: 1 | 2) => (s === 1 ? x.v.ach_recu_v_s1 : x.v.ach_recu_v_s2)
  const vFerme = (x: Agg, s: 1 | 2) => (s === 1 ? x.v.ach_ferme_v_s1 : x.v.ach_ferme_v_s2)
  const qRecu = (x: Agg, s: 1 | 2) => (s === 1 ? x.q.ach_recu_q_s1 : x.q.ach_recu_q_s2)
  const qFerme = (x: Agg, s: 1 | 2) => (s === 1 ? x.q.ach_ferme_q_s1 : x.q.ach_ferme_q_s2)
  const qVente = (x: Agg, s: 1 | 2) => (s === 1 ? x.q.ven_bl_q_s1 + x.q.ven_ferme_q_s1 : x.q.ven_bl_q_s2 + x.q.ven_ferme_q_s2)
  const obj = (gm: Gamme | undefined, s: 1 | 2) => (gm ? (s === 1 ? gm.obj_s1 : gm.obj_s2) : null)
  const n1 = (gm: Gamme | undefined, s: 1 | 2) => (gm ? (s === 1 ? gm.realise_n1_s1 : gm.realise_n1_s2) : null)

  // ── CA ──
  const objCa = n(engagement.objectif_ca)
  const caRecu = total.v.ach_recu_v_s1 + total.v.ach_recu_v_s2
  const caFerme = total.v.ach_ferme_v_s1 + total.v.ach_ferme_v_s2
  const caProj = caRecu + caFerme
  // Barème évolutif de l'annexe 7 non fourni : on en reste au 1 % du CA (exemple de l'annexe : 102,8 % → 105,6 %).
  const bfaCa = (ca: number) => (objCa && ca >= objCa ? ca * 0.01 : 0)

  // ── BFA croissance S1 : RAC Total (CA RAC + CA Light commercial) × 1 % ──
  const rac = a('RAC_TOTAL')
  const racObj = n(g('RAC_TOTAL')?.obj_s1)
  const racQ = qRecu(rac, 1) + (s1Clos ? 0 : qFerme(rac, 1))
  const racCa = vRecu(rac, 1) + (s1Clos ? 0 : vFerme(rac, 1))
  const lightCa = vRecu(a('PACKAGE'), 1) + (s1Clos ? 0 : vFerme(a('PACKAGE'), 1))
  // ── BFA croissance S2 : Set Free Mini → 1 % × (CA GE Air 365 + GE Set Free Mini + 60 % CA UI DRV) ──
  const sfm = a('SETFREE_MINI')
  const sfmObj = n(g('SETFREE_MINI')?.obj_s2)
  const sfmQ = qRecu(sfm, 2) + qFerme(sfm, 2)
  const sfLignes = lignes.filter((l) => l.gamme === 'SYSTEM_FREE')
  const v2 = (l: Ligne) => n(l.ach_recu_v_s2) + n(l.ach_ferme_v_s2)
  const caUiDrv = sfLignes.filter((l) => l.compte_qte).reduce((s, l) => s + v2(l), 0)
  const caGeAir365 = sfLignes.filter((l) => !l.compte_qte).reduce((s, l) => s + v2(l), 0)
  const caGeSfm = vRecu(sfm, 2) + vFerme(sfm, 2)
  const baseBfaS2 = caGeAir365 + caGeSfm + 0.6 * caUiDrv

  const pctCls = (p: number | null) => (p === null ? '' : p >= 1 ? 'bg-[#E3F2E6] text-[#1F6B3A]' : p >= 0.9 ? 'bg-[#FBF1DC] text-[#8A5A11]' : 'bg-[#FBE6E3] text-[#A32C2C]')

  const bord = 'border border-[#3A3A3A]'
  const cell = `${bord} px-1 py-1 text-center align-middle`
  const lab = `${bord} px-2 py-1 text-center align-middle`
  const bandeau = (texte: string, span: number) => (
    <td colSpan={span} className={`${bord} py-0.5 text-center text-[10.5px] font-semibold text-white`} style={{ background: ROUGE }}>{texte}</td>
  )
  const ajout = 'bg-[#EEF3F8]'
  const ajoutLab = `${lab} ${ajout} text-left text-[11px] font-semibold text-[#245A9E]`

  // Ligne d'un bloc quantitatif (un semestre)
  function cellules(s: 1 | 2, rendu: (code: string, gm: Gamme | undefined, x: Agg) => React.ReactNode, cls = '') {
    return ANNEXE_COLONNES.map((c) => {
      const surligne = c.bfa === s ? 'bg-[#F6E9EC]' : ''
      return <td key={`${s}-${c.code}`} className={`${cell} ${cls} ${surligne} whitespace-nowrap tabular-nums`}>{rendu(c.code, g(c.code), a(c.code))}</td>
    })
  }
  const quantif = (code: string) => code !== 'ACC'
  const nb = (v: number | null | undefined, gras = false) => (v === null || v === undefined ? '' : <span className={gras ? 'font-bold' : ''}>{fmtNum(v)}</span>)
  const tiret = '–'

  /** Les 8 lignes d'un semestre (cellules seulement) : N-1, objectif, puis les lignes ajoutées du réel. */
  const blocQuantitatif = (s: 1 | 2): React.ReactNode[][] => {
    const clos = s === 1 && s1Clos
    const proj = (x: Agg) => qRecu(x, s) + (clos ? 0 : qFerme(x, s))
    return [
      cellules(s, (code, gm) => <span className="italic">{quantif(code) ? nb(n1(gm, s)) : tiret}</span>),
      cellules(s, (code, gm) => (quantif(code) ? nb(obj(gm, s), code === 'RAC_TOTAL' || code === 'SETFREE_MINI') : tiret)),
      cellules(s, (code, _gm, x) => (quantif(code) ? fmtNum(qRecu(x, s)) : tiret), ajout),
      cellules(s, (code, _gm, x) => (quantif(code) && !clos ? fmtNum(qFerme(x, s)) : tiret), ajout),
      cellules(s, (code, gm, x) => {
        if (!quantif(code)) return tiret
        const o = obj(gm, s)
        const r = proj(x)
        if (!o) return '' // RAC Mono / Multi : objectif porté par RAC Total
        const p = r / o
        return <span className={`inline-block rounded px-1 font-bold ${pctCls(p)}`} title={`${fmtNum(r)} / ${fmtNum(o)} (${r - o >= 0 ? '+' : ''}${fmtNum(r - o)})`}>{fmtPct(p)}</span>
      }, ajout),
      cellules(s, (code, gm, x) => {
        if (!quantif(code)) return tiret
        const o = obj(gm, s)
        if (!o) return ''
        const e = proj(x) - o
        return <span className={e >= 0 ? 'text-[#1F6B3A]' : 'font-semibold text-[#A32C2C]'}>{e >= 0 ? `+${fmtNum(e)}` : fmtNum(e)}</span>
      }, ajout),
      cellules(s, (_code, _gm, x) => fmtEur(vRecu(x, s) + (clos ? 0 : vFerme(x, s))), `${ajout} text-[10.5px]`),
      cellules(s, (code, _gm, x) => (quantif(code) ? fmtNum(qVente(x, s)) : tiret), `${ajout} text-[#5E5A44]`),
    ]
  }

  const enteteColonnes = () => ANNEXE_COLONNES.map((c) => (
    <td key={c.code} className={`${cell} text-[10px] font-bold leading-tight`}>{c.libelle}</td>
  ))

  const enteteRemises1 = (k: string) => [
        <td key={`${k}a`} rowSpan={2} className={`${cell} text-[10px] font-bold`}>Accessoires</td>,
        <td key={`${k}r`} colSpan={3} className={`${cell} text-[10px] font-bold`}>RAC</td>,
        <td key={`${k}h`} colSpan={4} className={`${cell} text-[10px] font-bold`}>HEATING</td>,
        <td key={`${k}p`} className={`${cell} text-[10px] font-bold`}>PACKAGE</td>,
        <td key={`${k}v`} colSpan={3} className={`${cell} text-[10px] font-bold`}>VRF</td>,
  ]
  const enteteRemises2 = (k: string) => ([
          ['RAC Mono / Multi', 2], ['TRIPLE C', 1], ['YUTAKI-S / AirH2O 600 /YUTAKI-M/ AirH2O 800', 2], ['AirH2O 400', 1], ['YUTAMPO', 1],
          ['Light Commercial / Primairy / UTOPIA Prime / IVX Premium pour Dx Kit', 1], ['IVX Confort · IVX Prime et Centrifuges', 1], ['Air 365 - Set Free Mini', 1], ['System Free', 1],
        ] as [string, number][]).map(([l, sp]) => <td key={k + l} colSpan={sp} className={`${cell} text-[9.5px] font-bold leading-tight`}>{l}</td>)
  // Grille des remises de l'annexe ramenée aux 12 colonnes d'un semestre : Acc · RAC Mono/Multi ×2 · Triple C ·
  // Yutaki ×2 · 400 · Yutampo · Package · IVX (Confort + Prime, regroupés) · Set Free Mini · System Free.
  const ligneRemise = (k: 'std' | 'stock') => (
    <>
      <td className={cell}>{k === 'std' ? '65,5%' : '69,0%'}</td>
      <td colSpan={3} className={cell}>{k === 'std' ? '65,5%' : '69,0%'}</td>
      <td colSpan={2} className={cell}>{k === 'std' ? '63,3%' : '68,5%'}</td>
      <td className={cell}>{k === 'std' ? '63,3%' : '-'}</td>
      <td className={cell}>{k === 'std' ? '63,3%' : '68,5%'}</td>
      <td className={cell}>{k === 'std' ? '70,0%' : '73,0%'}</td>
      <td colSpan={3} className={cell}>{k === 'std' ? '70,0%' : '76,0%'}</td>
    </>
  )
  const ligneContainers = () => (
    <>
      <td className={cell}>74,5%</td>
      <td colSpan={3} className={cell}>74,5%</td>
      <td className={cell}>-</td><td className={cell}>-</td>
      <td className={cell}>68,5%</td>
      <td className={cell}>69,8%</td>
      <td className={cell}>74,5%</td>
      <td className={cell}>-</td><td className={cell}>-</td><td className={cell}>-</td>
    </>
  )

  const statutBfa = (atteint: boolean, reste: number) => (
    <span className={`inline-block rounded px-2 py-0.5 font-bold ${atteint ? 'bg-[#E3F2E6] text-[#1F6B3A]' : 'bg-[#FBE6E3] text-[#A32C2C]'}`}>
      {atteint ? 'Objectif atteint' : `Manque ${fmtNum(reste)} groupes`}
    </span>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/40 p-3" onClick={onClose}>
      <div className="mx-auto w-full max-w-[1700px] rounded-lg bg-white p-4 text-[11.5px] text-black shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#5E5A44]">
            Annexe 6 Hitachi — lignes <span className={`${ajout} rounded px-1 font-semibold text-[#245A9E]`}>en bleu</span> ajoutées par le compagnon au {dateJour}
            {sources?.refreshed_at && <> (données du {fmtDateHeure(sources.refreshed_at)})</>} : achats reçus = commandes fournisseur BLG livrées ; ferme = CDF SAGE à recevoir d’ici la fin du semestre ; ventes = BL + CDC à livrer.
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => window.print()} className="rounded-md border border-[#E5E1D8] px-3 py-1.5 text-[12px] font-semibold">Imprimer</button>
            <button type="button" onClick={onClose} className="rounded-md bg-[#0B1220] px-3 py-1.5 text-[12px] font-semibold text-white">Fermer</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse border-2 border-[#3A3A3A]">
            <colgroup>
              <col style={{ width: 150 }} />
              {Array.from({ length: 24 }).map((_, i) => <col key={i} />)}
            </colgroup>
            <tbody>
              {/* En-tête */}
              <tr>
                <td className={`${lab} font-bold`}>Année / Période</td>
                <td colSpan={24} className={`${cell} py-2 text-[14px] font-bold`}>OBJECTIFS du 1er Janvier {annee} au 31 décembre {annee} - (ANNEXE 6)</td>
              </tr>
              <tr>
                <td className={`${lab} font-bold`}>CONCESSIONNAIRE</td>
                <td colSpan={24} className={`${cell} py-2 text-[18px] font-bold`}>CEGECLIM</td>
              </tr>

              {/* Objectif CA */}
              <tr><td className={bord} style={{ background: ROUGE }} />{bandeau('OBJECTIF CA (€) HT et Hors DEEE', 24)}</tr>
              <tr>
                <td className={lab}>OBJECTIF CA (HT et hors DEEE)</td>
                <td colSpan={24} className={`${cell} py-1.5 text-[17px] font-bold`}>{fmtNum(objCa)} €</td>
              </tr>
              <tr>
                <td className={ajoutLab}>Achats reçus au {dateJour}</td>
                <td colSpan={8} className={`${cell} ${ajout} font-bold`}>{fmtNum(Math.round(caRecu))} €</td>
                <td colSpan={8} className={`${cell} ${ajout}`}>Ferme à recevoir d’ici le 31/12 : <b>{fmtNum(Math.round(caFerme))} €</b></td>
                <td colSpan={8} className={`${cell} ${ajout}`}>
                  Reçu + ferme : <b>{fmtNum(Math.round(caProj))} €</b>{' '}
                  <span className={`ml-1 inline-block rounded px-1.5 font-bold ${pctCls(objCa ? caProj / objCa : null)}`}>{fmtPct(objCa ? caProj / objCa : null)}</span>
                  <span className="ml-2 text-[#5E5A44]">(réel seul {fmtPct(objCa ? caRecu / objCa : null)})</span>
                </td>
              </tr>

              {/* Objectifs quantitatifs */}
              <tr><td className={bord} style={{ background: ROUGE }} />{bandeau(`OBJECTIFS QUANTITATIFS - 1er Semestre ${annee}`, 12)}{bandeau(`OBJECTIFS QUANTITATIFS - 2ème Semestre ${annee}`, 12)}</tr>
              <tr><td className={`${lab} font-bold`}>GAMMES</td>{enteteColonnes()}{enteteColonnes()}</tr>
              {(() => {
                const s1 = blocQuantitatif(1)
                const s2 = blocQuantitatif(2)
                const libelles: [string, boolean][] = [
                  [`Réalisé CY ${annee - 1}`, false],
                  [`OBJECTIFS QUANTITATIFS CY ${annee}`, false],
                  ['Achats reçus (unités)', true],
                  ['Ferme à recevoir d’ici fin de semestre', true],
                  ['% objectif (reçu + ferme)', true],
                  ['Écart à l’objectif (unités)', true],
                  ['Achats reçus + ferme (€)', true],
                  ['Ventes BL + CDC à livrer (unités)', true],
                ]
                return libelles.map(([lib, aj], i) => (
                  <tr key={lib}>
                    <td className={aj ? ajoutLab : `${lab} ${i === 0 ? 'italic' : ''}`}>{lib}</td>
                    {s1[i]}
                    {s2[i]}
                  </tr>
                ))
              })()}

              {/* Remises */}
              <tr><td className={bord} style={{ background: ROUGE }} />{bandeau('CONDITIONS COMMERCIALES CATEGORIE 1 - REMISES', 12)}{bandeau('CONDITIONS COMMERCIALES CATEGORIE 1 - REMISES', 12)}</tr>
              <tr>
                <td rowSpan={2} className={`${lab} font-bold`}>GAMMES</td>
                {enteteRemises1('s1')}
                {enteteRemises1('s2')}
              </tr>
              <tr>
                {enteteRemises2('s1')}
                {enteteRemises2('s2')}
              </tr>
              <tr><td className={lab}>Remise Standard</td>{ligneRemise('std')}{ligneRemise('std')}</tr>
              <tr><td className={lab}>Remise de Stock M-3<br /><span className="text-[10px]">* Voir Convention Unique {annee}</span></td>{ligneRemise('stock')}{ligneRemise('stock')}</tr>
              <tr><td className={lab}>Remise Containers<br /><span className="text-[10px]">* Voir Convention Unique {annee}</span></td>{ligneContainers()}{ligneContainers()}</tr>

              {/* BFA croissance */}
              <tr><td className={bord} style={{ background: ROUGE }} />{bandeau('Bonifications Fin d’Année (BFA) Croissance', 24)}</tr>
              <tr>
                <td rowSpan={3} className={`${lab} text-[10.5px]`}>BFA CROISSANCE QUANTITATIVE PRODUITS</td>
                <td colSpan={12} className={`${cell} py-2 text-[10.5px] font-bold`}>RAC Total (mono + multi)</td>
                <td colSpan={12} className={`${cell} py-2 text-[10.5px] font-bold`}>AIR 365 - SET FREE MINI</td>
              </tr>
              <tr>
                <td colSpan={12} className={`${cell} py-3 text-[11px] leading-snug`}>
                  La BFA sera déclenchée à l’atteinte de 100% de l’objectif quantitatif<br />
                  Cette bonification n’est pas plafonnée et est évolutive. (voir annexe 7 jointe)<br />
                  L’objectif quantitatif fixé par gamme en Année N ne peut être inférieur au réalisé de l’année N-1.<br /><br />
                  La comptabilisation se fait sur le nombre de groupes extérieurs.<br />
                  Bonification à l’atteinte de l’objectif : 1% du CA HT de la gamme correspondante<br /><br />
                  BFA = CA RAC + CA Light commercial x 1%
                </td>
                <td colSpan={12} className={`${cell} py-3 text-[11px] leading-snug`}>
                  La BFA sera déclenchée à l’atteinte de 100% de l’objectif quantitatif<br />
                  Cette bonification n’est pas plafonnée et est évolutive. (voir annexe 7 jointe)<br />
                  L’objectif quantitatif fixé par gamme en Année N ne peut être inférieur au réalisé de l’année N-1.<br /><br />
                  La comptabilisation se fait sur le nombre de groupes extérieurs.<br />
                  Bonification à l’atteinte de l’objectif : 1% du CA HT de la gamme correspondante<br /><br />
                  <b>BFA</b> = (CA GE AIR365 + GE Set FREE MINI + 60% CA UI DRV) x 1%
                </td>
              </tr>
              <tr>
                <td colSpan={12} className={`${cell} ${ajout} py-2 text-left text-[11px] leading-relaxed`}>
                  <b className="text-[#245A9E]">Au {dateJour} — S1 {s1Clos ? 'clos' : 'en cours'} :</b> {fmtNum(racQ)} groupes RAC pour un objectif de {fmtNum(racObj)} ({fmtPct(racObj ? racQ / racObj : null)}){' '}
                  {statutBfa(racQ >= racObj, racObj - racQ)}<br />
                  CA RAC S1 {fmtNum(Math.round(racCa))} € + CA Light commercial (Primairy / IVX / Utopia) {fmtNum(Math.round(lightCa))} € →{' '}
                  <b>BFA estimée {racQ >= racObj ? `${fmtNum(Math.round((racCa + lightCa) * 0.01))} €` : '0 €'}</b>
                </td>
                <td colSpan={12} className={`${cell} ${ajout} py-2 text-left text-[11px] leading-relaxed`}>
                  <b className="text-[#245A9E]">Au {dateJour} — S2 en cours (reçu + ferme) :</b> {fmtNum(sfmQ)} groupes Set Free Mini pour un objectif de {fmtNum(sfmObj)} ({fmtPct(sfmObj ? sfmQ / sfmObj : null)}){' '}
                  {statutBfa(sfmQ >= sfmObj, sfmObj - sfmQ)}<br />
                  CA GE Air 365 {fmtNum(Math.round(caGeAir365))} € + GE Set Free Mini {fmtNum(Math.round(caGeSfm))} € + 60 % × UI DRV {fmtNum(Math.round(caUiDrv))} € = {fmtNum(Math.round(baseBfaS2))} € →{' '}
                  <b>BFA {sfmQ >= sfmObj ? 'estimée' : 'potentielle'} {fmtNum(Math.round(baseBfaS2 * 0.01))} €</b>
                </td>
              </tr>

              {/* BFA CA */}
              <tr><td className={bord} style={{ background: ROUGE }} />{bandeau('Bonification Fin d’Année (BFA) sur CA', 24)}</tr>
              <tr>
                <td rowSpan={2} className={`${lab} text-[10.5px]`}>OBJECTIF CHIFFRE D’AFFAIRES</td>
                <td colSpan={24} className={`${cell} py-2 text-[11px] leading-snug`}>
                  <b className="text-[13px]">Objectif Annuel : {fmtNum(objCa)}€ HT et Hors DEEE</b><br />
                  La BFA sera déclenchée à l’atteinte de 100% de l’objectif annuel de chiffre d’affaires, la bonification déclenchée sera de 1% du CA HT réalisé. (Hors commandes en dérogations YYTI-F)<br />
                  Cette bonification n’est pas plafonnée et est évolutive. (voir annexe 7 jointe)<br />
                  Ex : si CA de 14,9 M€ (Soit 102,8 % de son objectif) il sera reversé 105,6% de sa bonification = 14,9 M€ * 1,056% = 157 344 €
                </td>
              </tr>
              <tr>
                <td colSpan={24} className={`${cell} ${ajout} py-2 text-[11px]`}>
                  <b className="text-[#245A9E]">Au {dateJour} :</b> achats reçus {fmtNum(Math.round(caRecu))} € ({fmtPct(objCa ? caRecu / objCa : null)}) · reçu + ferme {fmtNum(Math.round(caProj))} € ({fmtPct(objCa ? caProj / objCa : null)}) →{' '}
                  <b>BFA CA estimée {fmtNum(Math.round(bfaCa(caProj)))} €</b> (1 % ; coefficient évolutif de l’annexe 7 non appliqué
                  {objCa && caProj > objCa ? `, ici ${fmtPct(caProj / objCa)} de l’objectif` : ''}) · sur le réel seul : {fmtNum(Math.round(bfaCa(caRecu)))} €
                </td>
              </tr>

              {/* Budget promotion */}
              <tr><td className={bord} style={{ background: ROUGE }} />{bandeau('BUDGET COMMUNICATION ET PROMOTION DE LA MARQUE', 24)}</tr>
              <tr>
                <td className={`${lab} text-[10.5px]`}>Budget promotion</td>
                <td colSpan={24} className={`${cell} py-2 text-[11px]`}>
                  1% du CA réalisé sur la période du 01/01/{annee} au 31/12/{annee}.<br />
                  * Voir l’annexe de la Convention Unique relative aux conditions de prestation de service et de promotion de la marque HITACHI.
                </td>
              </tr>
              <tr>
                <td className={ajoutLab}>Au {dateJour}</td>
                <td colSpan={24} className={`${cell} ${ajout} py-1.5 text-[11px]`}>
                  Budget sur achats reçus : <b>{fmtNum(Math.round(caRecu * 0.01))} €</b> · sur reçu + ferme : <b>{fmtNum(Math.round(caProj * 0.01))} €</b>
                </td>
              </tr>
              <tr>
                <td className={`${lab} text-[10.5px]`}>Conditions de règlement</td>
                <td colSpan={24} className={`${cell} py-2 text-[11px]`}>30 jours fin de mois le 15 par virement</td>
              </tr>
              <tr>
                <td className={lab}>Bon pour Accord</td>
                <td colSpan={12} className={`${bord} px-2 py-2 text-left align-top text-[11px] leading-6`}>
                  Pour Hitachi<br />Date : <span className="italic">18/06/{annee}</span><br />Nom : <span className="italic">P. BERRY</span><br />Tampon et Signature : JOHNSON CONTROLS HITACHI AIR CONDITIONING EUROPE SAS
                </td>
                <td colSpan={12} className={`${bord} px-2 py-2 text-left align-top text-[11px] leading-6`}>
                  Pour le Concessionnaire<br />Date :<br />Nom :<br />Tampon et Signature
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
