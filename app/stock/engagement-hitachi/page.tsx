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
