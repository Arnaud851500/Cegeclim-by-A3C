'use client'

/**
 * Scénarios proposés à partir des statistiques (12/11/2026, demande d'Arnaud).
 * Bloc de l'écran Statistiques (/hotline/stats), thermie uniquement.
 *
 * RPC hotline_scenarios(p_mois, p_min) (migration 20261112d_hotline_scenarios.sql) :
 * situations récurrentes gamme × code défaut (ou × symptôme sans code), avec la
 * part résolue au téléphone, la part finie en pièce / garantie, l'organe et les
 * modèles dominants. Chaque situation reçoit un scénario de traitement :
 *  - PIECE     : parcours court N1 → pièce de l'organe dominant, garantie, demande de pièce ;
 *  - TELEPHONE : contrôles guidés N1 (reset, réglages) avant escalade ;
 *  - MIXTE     : contrôles guidés N1 puis escalade N2 avec les mesures relevées.
 * Les parcours de diagnostic déjà en place sur la gamme sont rappelés pour
 * repérer les situations fréquentes qui n'en ont pas.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { libelleClassif, libelleGamme, messageErreur, type Classification } from '@/lib/hotline'

type Scenario = {
  axe: 'CODE' | 'SYMPTOME'
  gamme: string
  cle: string
  n: number
  pct_tel: number
  pct_piece: number
  pct_installation: number
  pct_escalade: number
  organe: string | null
  pct_organe: number | null
  symptome: string | null
  modeles: Array<{ modele: string; n: number }>
  parcours: Array<{ code: string; nom: string; motif: string }>
  type: 'PIECE' | 'TELEPHONE' | 'MIXTE'
}

const TYPES: Record<Scenario['type'], { label: string; tone: string; bg: string }> = {
  PIECE: { label: 'Pièce probable', tone: '#A32C2C', bg: '#FCE9E6' },
  TELEPHONE: { label: 'Résolvable au N1', tone: '#2F6B3A', bg: '#E5F2E7' },
  MIXTE: { label: 'Contrôles puis N2', tone: '#8A5A11', bg: '#FDF2DD' },
}

function recommandation(s: Scenario, classif: Classification) {
  const organe = s.organe ? libelleClassif(classif, 'organe', s.organe).toLowerCase() : 'l’organe en cause'
  if (s.type === 'PIECE') {
    return `Parcours court N1 : relever le code et le n° de série, vérifier la date de mise en service (garantie), ouvrir la vue éclatée sur ${organe} et préparer la demande de pièce — ${s.pct_piece} % de ces tickets finissent en pièce ou garantie.`
  }
  if (s.type === 'TELEPHONE') {
    return `Parcours de contrôles guidés N1 (reset, paramètres, réglages) avant toute escalade : ${s.pct_tel} % se règlent au téléphone.${s.organe ? ` Si le défaut persiste, regarder ${organe}.` : ''}`
  }
  return `Contrôles guidés N1 (mesures, alimentation, ${organe}) puis escalade N2 avec les relevés : ${s.pct_tel} % réglés au téléphone, ${s.pct_piece} % en pièce${s.pct_installation ? `, ${s.pct_installation} % liés à l’installation` : ''}.`
}

export default function ScenariosHotline({ classif }: { classif: Classification }) {
  const [mois, setMois] = useState(24)
  const [resultat, setResultat] = useState<{ mois: number; tickets: number; scenarios: Scenario[] } | null>(null)
  // Données affichées seulement si elles correspondent à la période choisie.
  const donnees = resultat && resultat.mois === mois ? resultat : null
  const [erreur, setErreur] = useState<string | null>(null)
  const [type, setType] = useState<Scenario['type'] | ''>('')
  const [gamme, setGamme] = useState('')
  const [sansParcours, setSansParcours] = useState(false)
  const [tout, setTout] = useState(false)

  useEffect(() => {
    let vivant = true
    supabase
      .rpc('hotline_scenarios', { p_mois: mois, p_min: 30 })
      .then(({ data, error }) => {
        if (!vivant) return
        if (error) setErreur(messageErreur(error))
        else {
          const v = (data || {}) as { tickets?: number; scenarios?: Scenario[] }
          setResultat({ mois, tickets: Number(v.tickets || 0), scenarios: v.scenarios || [] })
        }
      })
    return () => {
      vivant = false
    }
  }, [mois])

  const liste = useMemo(
    () =>
      (donnees?.scenarios || []).filter(
        (s) => (!type || s.type === type) && (!gamme || s.gamme === gamme) && (!sansParcours || !s.parcours.length),
      ),
    [donnees, type, gamme, sansParcours],
  )
  const visibles = tout ? liste : liste.slice(0, 15)
  const resume = useMemo(() => {
    const r = { PIECE: 0, TELEPHONE: 0, MIXTE: 0 }
    ;(donnees?.scenarios || []).forEach((s) => (r[s.type] += s.n))
    return r
  }, [donnees])

  return (
    <section className="mt-4 rounded-2xl border border-[#E2DFD8] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3">
        <div>
          <div className="text-[14px] font-bold text-slate-900">Scénarios proposés (thermie)</div>
          <div className="text-[12px] text-slate-500">
            Situations récurrentes (≥ 30 tickets) et traitement conseillé d’après l’issue des tickets passés
            {donnees ? ` — ${donnees.tickets.toLocaleString('fr-FR')} tickets thermiques sur ${mois} mois` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <select value={mois} onChange={(e) => setMois(Number(e.target.value))} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2">
            <option value={12}>12 derniers mois</option>
            <option value={24}>24 derniers mois</option>
            <option value={36}>36 derniers mois</option>
          </select>
          <select value={gamme} onChange={(e) => setGamme(e.target.value)} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2">
            <option value="">Toutes gammes</option>
            <option value="RO">R/O</option>
            <option value="RR">R/R</option>
            <option value="GAINABLE">Gainable</option>
            <option value="-">Gamme non renseignée</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as Scenario['type'] | '')} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2">
            <option value="">Tous scénarios</option>
            {(Object.keys(TYPES) as Scenario['type'][]).map((t) => (
              <option key={t} value={t}>
                {TYPES[t].label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={sansParcours} onChange={(e) => setSansParcours(e.target.checked)} className="h-3.5 w-3.5 accent-[#B4761A]" />
            Gamme sans parcours
          </label>
        </div>
      </div>

      {erreur ? <div className="px-4 py-3 text-[13px] text-[#7F1D1D]">{erreur}</div> : null}
      {!donnees && !erreur ? <div className="px-4 py-8 text-center text-[13px] text-slate-500">Analyse de l’historique…</div> : null}

      {donnees ? (
        <>
          <div className="grid grid-cols-1 gap-3 px-4 pt-4 md:grid-cols-3">
            {(Object.keys(TYPES) as Scenario['type'][]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(type === t ? '' : t)}
                className={`rounded-xl border px-4 py-3 text-left ${type === t ? 'ring-2 ring-[#B4761A]' : ''}`}
                style={{ borderColor: TYPES[t].bg, background: TYPES[t].bg }}
              >
                <div className="text-[11px] font-bold uppercase tracking-[0.05em]" style={{ color: TYPES[t].tone }}>
                  {TYPES[t].label}
                </div>
                <div className="mt-1 text-[20px] font-bold text-slate-900">{resume[t].toLocaleString('fr-FR')} tickets</div>
                <div className="text-[11px] text-slate-600">
                  {t === 'PIECE' ? '≥ 55 % finis en pièce / garantie' : t === 'TELEPHONE' ? '≥ 40 % réglés au téléphone' : 'issue partagée : contrôles puis escalade'}
                </div>
              </button>
            ))}
          </div>
          <div className="overflow-x-auto p-4">
            <table className="w-full min-w-[1200px] text-[12px]">
              <thead className="bg-[#FAF9F7] text-left text-[11px] uppercase tracking-[0.05em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Situation</th>
                  <th className="px-3 py-2 text-right">Tickets</th>
                  <th className="px-3 py-2 text-right">Réglés au tél.</th>
                  <th className="px-3 py-2 text-right">Pièce / garantie</th>
                  <th className="px-3 py-2">Organe dominant</th>
                  <th className="px-3 py-2">Modèles les plus touchés</th>
                  <th className="px-3 py-2">Scénario conseillé</th>
                  <th className="px-3 py-2">Parcours en place</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {visibles.map((s) => (
                  <tr key={`${s.axe}-${s.gamme}-${s.cle}`} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">
                        {s.axe === 'CODE' ? `Code ${s.cle}` : libelleClassif(classif, 'symptome', s.cle)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {s.gamme === '-' ? 'Gamme non renseignée' : libelleGamme(s.gamme)}
                        {s.axe === 'CODE' && s.symptome ? ` · ${libelleClassif(classif, 'symptome', s.symptome)}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{s.n}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#2F6B3A]">{s.pct_tel} %</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#A32C2C]">{s.pct_piece} %</td>
                    <td className="px-3 py-2 text-slate-700">
                      {s.organe ? libelleClassif(classif, 'organe', s.organe) : '—'}
                      {s.pct_organe !== null && s.organe ? <span className="text-slate-400"> · {s.pct_organe} %</span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{s.modeles.map((m) => `${m.modele} (${m.n})`).join(', ') || '—'}</td>
                    <td className="max-w-[420px] px-3 py-2">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: TYPES[s.type].tone, background: TYPES[s.type].bg }}>
                        {TYPES[s.type].label}
                      </span>
                      <div className="mt-1 text-slate-700">{recommandation(s, classif)}</div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-600">
                      {s.parcours.length ? s.parcours.map((p) => p.nom).join(' · ') : <span className="font-semibold text-[#C1683C]">Aucun : parcours à créer</span>}
                    </td>
                  </tr>
                ))}
                {!visibles.length ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                      Aucune situation pour ces filtres.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {liste.length > 15 ? (
              <button type="button" onClick={() => setTout((v) => !v)} className="mt-2 text-[12px] font-semibold text-slate-600 underline">
                {tout ? 'Réduire' : `Développer (${liste.length - 15} situations de plus)`}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
