'use client'

// Fiche détaillée d'une agence ou d'un collaborateur (écran Suivi agences /
// commerciaux) : CA N-2 / N-1 / N par période avec évolution et comparaison à
// l'entreprise (hors exclusions), marge, familles suivies dans les objectifs,
// profil CA des clients.

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabaseClient'
import {
  FAMILLES_LIBELLES,
  MOIS_COURTS,
  MOIS_LONGS,
  addToSerie,
  emptySerie,
  evolPct,
  fmtEuro,
  fmtInt,
  fmtK,
  fmtPct,
  fmtPts,
  moisComparables,
  periodesDetail,
  positionsTrimestrielles,
  quadrantOf,
  QUADRANT_LIBELLES,
  sumMonths,
  tauxMarge,
  toneOf,
  type DataRow,
  type Entity,
  type Objectif,
  type ObjectifsEntite,
  type RefRow,
  type Serie,
} from '@/lib/suiviAgences'

type Profil = {
  mois_clos: number
  tranches: Array<{
    code: string
    libelle: string
    n2: { nb: number; ca: number }
    n1: { nb: number; ca: number }
    g12: { nb: number; ca: number }
    g12n1: { nb: number; ca: number }
  }>
  clients: Array<{
    numero: string
    intitule: string
    ca_n2: number
    ca_n1: number
    ca_12mg: number
    ca_12mg_n1: number
    ca_ytd: number
    ca_ytd_n1: number
  }>
  nb_clients_actifs: number
  nb_clients_actifs_n1: number
}

const TYPE_LIBELLES: Record<string, string> = {
  ca_valeur: 'CA',
  ca_evolution_pct: 'Évolution CA',
  marge_evolution_pct: 'Évolution marge',
  nb_clients_gros: 'Gros clients',
  nb_clients_moyens: 'Clients moyens',
  nb_clients_petits: 'Petits clients',
}

export default function FicheDetail({
  entity,
  annee,
  moisClos,
  moisMax,
  serie,
  refSerie,
  rowsEntite,
  refRows,
  famillesFiltre,
  objectifs,
  exclusionsLibelle,
  onClose,
}: {
  entity: Entity
  annee: number
  moisClos: number
  moisMax: number
  serie: Serie
  refSerie: Serie
  rowsEntite: DataRow[]
  refRows: RefRow[]
  famillesFiltre: string[]
  objectifs: ObjectifsEntite
  exclusionsLibelle: string
  onClose: () => void
}) {
  const [profil, setProfil] = useState<Profil | null>(null)
  const [profilError, setProfilError] = useState<string | null>(null)
  const [profilBase, setProfilBase] = useState<'g12' | 'n1' | 'n2'>('g12')

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setProfil(null)
    setProfilError(null)
    void supabase
      .rpc('get_suivi_profil_clients', {
        p_annee: annee,
        p_mois_clos: moisClos,
        p_codes: entity.kind === 'entreprise' ? null : entity.codes,
        p_familles: famillesFiltre.length ? famillesFiltre : null,
      })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setProfilError(error.message)
        else setProfil(data as Profil)
      })
    return () => {
      cancelled = true
    }
  }, [annee, moisClos, entity, famillesFiltre])

  const libMoisClos = MOIS_COURTS[moisClos] || ''
  const aDate = valeurs(serie, 1, moisClos)
  const aDateRef = valeurs(refSerie, 1, moisClos)
  const tauxN = tauxMarge(aDate.mgN, aDate.n)
  const tauxN1 = tauxMarge(aDate.mgN1, aDate.n1)
  const tauxRefN = tauxMarge(aDateRef.mgN, aDateRef.n)
  const tauxRefN1 = tauxMarge(aDateRef.mgN1, aDateRef.n1)
  const positions = positionsTrimestrielles(serie, moisClos)
  const quadrant = quadrantOf(positions[positions.length - 1])

  const objectifCa = objectifs.propres.find((o) => o.type_objectif === 'ca_valeur' && !o.famille_macro)
  const caN1Total = sumMonths(serie.ca[1], 1, 12)
  const attenduADate = objectifCa && caN1Total > 0 ? objectifCa.valeur_cible * (aDate.n1 / caN1Total) : null

  // ------------------------------------------------------------- tableau CA
  const lignes = useMemo(() => {
    const out: Array<{ label: string; sub?: string; v: ReturnType<typeof valeurs>; r: ReturnType<typeof valeurs>; enCours?: boolean; total?: boolean }> = []
    const totalV = valeurs(serie, 1, 12)
    const totalR = valeurs(refSerie, 1, 12)
    out.push({ label: 'Total année', sub: moisMax < 12 ? `N en cours (jusqu’à ${MOIS_COURTS[moisMax] || '—'})` : undefined, v: totalV, r: totalR, enCours: moisClos < 12, total: true })
    out.push({ label: 'À date', sub: `janv. → ${libMoisClos}`, v: aDate, r: aDateRef })
    periodesDetail().forEach((p) => {
      const c = moisComparables(p, moisClos)
      if (c.vide) {
        out.push({ label: p.label, sub: 'à venir', v: valeurs(serie, p.from, p.to, true), r: valeurs(refSerie, p.from, p.to, true), enCours: true })
        return
      }
      out.push({ label: p.label, sub: c.complet ? undefined : `à fin ${libMoisClos}`, v: valeurs(serie, c.from, c.to), r: valeurs(refSerie, c.from, c.to) })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serie, refSerie, moisClos, moisMax])

  // --------------------------------------------------------- graphe mensuel
  const chartData = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({
        mois: MOIS_COURTS[m],
        [`${annee - 2}`]: Math.round(serie.ca[0][m]),
        [`${annee - 1}`]: Math.round(serie.ca[1][m]),
        [`${annee}`]: m <= moisMax ? Math.round(serie.ca[2][m]) : null,
      })),
    [serie, annee, moisMax]
  )

  // ---------------------------------------------------- familles suivies
  const famillesSuivies = useMemo(() => {
    return objectifs.familles.map((f) => {
      const s = emptySerie()
      rowsEntite.forEach((r) => {
        if (r.famille === f.famille) addToSerie(s, r.annee - (annee - 2), r.mois, r.ca, r.marge)
      })
      const rs = emptySerie()
      refRows.forEach((r) => {
        if (r.famille === f.famille) addToSerie(rs, r.annee - (annee - 2), r.mois, r.ca, r.marge)
      })
      return { ...f, v: valeurs(s, 1, moisClos), r: valeurs(rs, 1, moisClos), totalN1: sumMonths(s.ca[1], 1, 12) }
    })
  }, [objectifs, rowsEntite, refRows, annee, moisClos])

  const titreKind = entity.kind === 'agence' ? 'Agence' : entity.kind === 'collaborateur' ? 'Collaborateur' : 'Entreprise'

  return (
    <div className="fixed inset-0 z-[80] flex justify-center overflow-y-auto bg-[#0B1220]/55 p-3 md:p-8" onMouseDown={onClose}>
      <div className="relative h-fit w-full max-w-[1240px] rounded-2xl bg-[#F4F3F0] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 rounded-t-2xl border-b border-[#1E2833] bg-[#111820] px-5 py-4 md:px-7">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#B4761A]">
              {titreKind}
              {entity.kind === 'collaborateur' && ` · ${entity.agence}`}
              {entity.kind === 'agence' && ` · ${entity.codes.length} collaborateur${entity.codes.length > 1 ? 's' : ''}`}
            </div>
            <h2 className="mt-1 text-2xl font-bold text-white">{entity.label}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
              <span>CA facturé {annee} · à date = janv. → {MOIS_LONGS[moisClos] || '—'} (dernier mois clos)</span>
              {famillesFiltre.length > 0 && (
                <span className="rounded bg-[#B4761A]/25 px-1.5 text-[#F5D79B]">Familles : {famillesFiltre.join(', ')}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#2C3946] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:border-[#B4761A] hover:text-white" aria-label="Fermer">
            ✕ Fermer
          </button>
        </div>

        <div className="space-y-5 p-4 md:p-7">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label={`CA ${annee} à date`} value={fmtK(aDate.n)} sub={`N-1 ${fmtK(aDate.n1)}`} />
            <Kpi label="Évolution vs N-1" value={fmtPct(aDate.evolN)} tone={toneOf(aDate.evolN)} sub={`${aDate.n - aDate.n1 >= 0 ? '+' : ''}${fmtK(aDate.n - aDate.n1)}`} />
            <Kpi
              label="vs entreprise"
              value={aDate.evolN !== null && aDateRef.evolN !== null ? fmtPts(aDate.evolN - aDateRef.evolN) : '—'}
              tone={toneOf(aDate.evolN !== null && aDateRef.evolN !== null ? aDate.evolN - aDateRef.evolN : null)}
              sub={`Entreprise ${fmtPct(aDateRef.evolN)}`}
            />
            <Kpi label="Taux de marge" value={fmtPct(tauxN, 1, false)} sub={`N-1 ${fmtPct(tauxN1, 1, false)}`} />
            <Kpi
              label="Évol. marge"
              value={tauxN !== null && tauxN1 !== null ? fmtPts(tauxN - tauxN1) : '—'}
              tone={toneOf(tauxN !== null && tauxN1 !== null ? tauxN - tauxN1 : null, 0.1)}
              sub={`Entreprise ${tauxRefN !== null && tauxRefN1 !== null ? fmtPts(tauxRefN - tauxRefN1) : '—'}`}
            />
            <Kpi
              label="Positionnement"
              value={quadrant ? QUADRANT_LIBELLES[quadrant].label : '—'}
              tone=""
              style={quadrant ? { color: QUADRANT_LIBELLES[quadrant].tone } : undefined}
              sub={positions.length ? `fin T${positions[positions.length - 1].q}` : 'aucun trimestre clos'}
            />
          </div>

          {/* CA par période */}
          <Section title="Chiffre d’affaires facturé" hint={`Comparaison à l’entreprise ${exclusionsLibelle}. Les périodes incomplètes sont comparées sur les mêmes mois.`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2DFD8] text-[11px] uppercase tracking-[0.06em] text-slate-500">
                    <th className="py-2 text-left font-semibold">Période</th>
                    <th className="py-2 text-right font-semibold">{annee - 2}</th>
                    <th className="py-2 text-right font-semibold">{annee - 1}</th>
                    <th className="py-2 text-right font-semibold">Évol. N-1</th>
                    <th className="py-2 text-right font-semibold">{annee}</th>
                    <th className="py-2 text-right font-semibold">Évol. vs N-1</th>
                    <th className="py-2 text-right font-semibold">Entreprise</th>
                    <th className="py-2 text-right font-semibold">Écart vs entr.</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const evolN = l.total && l.enCours ? null : l.v.evolN
                    const evolRef = l.total && l.enCours ? null : l.r.evolN
                    const ecart = evolN !== null && evolRef !== null ? evolN - evolRef : null
                    const nVide = l.sub === 'à venir'
                    return (
                      <tr key={l.label} className={`border-b border-[#EFEDE8] ${l.label === 'À date' ? 'bg-[#FDF7EA] font-semibold' : ''}`}>
                        <td className="py-2">
                          <span className="font-semibold text-slate-800">{l.label}</span>
                          {l.sub && <span className="ml-2 text-[11px] text-slate-400">{l.sub}</span>}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">{fmtEuro(l.v.n2)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtEuro(l.v.n1)}</td>
                        <td className={`py-2 text-right tabular-nums ${toneOf(l.v.evolN1)}`}>{fmtPct(l.v.evolN1)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{nVide ? '—' : fmtEuro(l.v.n)}</td>
                        <td className={`py-2 text-right font-semibold tabular-nums ${toneOf(evolN)}`}>{nVide ? '—' : fmtPct(evolN)}</td>
                        <td className={`py-2 text-right tabular-nums ${toneOf(evolRef)}`}>{nVide ? '—' : fmtPct(evolRef)}</td>
                        <td className={`py-2 text-right font-semibold tabular-nums ${toneOf(ecart)}`}>{nVide ? '—' : fmtPts(ecart)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E4DD" vertical={false} />
                  <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => fmtK(Number(v))} width={64} />
                  <Tooltip formatter={(v) => fmtEuro(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey={`${annee - 1}`} fill="#C9C4B6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey={`${annee}`} fill="#245A9E" radius={[3, 3, 0, 0]} />
                  <Line dataKey={`${annee - 2}`} stroke="#B4761A" strokeDasharray="4 3" dot={false} strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Section>

          {/* Marge */}
          <Section title="Marge" hint="Marge en valeur et taux de marge (marge / CA facturé).">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2DFD8] text-[11px] uppercase tracking-[0.06em] text-slate-500">
                    <th className="py-2 text-left font-semibold">Période</th>
                    <th className="py-2 text-right font-semibold">Marge {annee - 1}</th>
                    <th className="py-2 text-right font-semibold">Marge {annee}</th>
                    <th className="py-2 text-right font-semibold">Taux {annee - 2}</th>
                    <th className="py-2 text-right font-semibold">Taux {annee - 1}</th>
                    <th className="py-2 text-right font-semibold">Taux {annee}</th>
                    <th className="py-2 text-right font-semibold">Évol. taux</th>
                    <th className="py-2 text-right font-semibold">Entreprise</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const t2 = tauxMarge(l.v.mgN2, l.v.n2)
                    const t1 = tauxMarge(l.v.mgN1, l.v.n1)
                    const t = tauxMarge(l.v.mgN, l.v.n)
                    const rt1 = tauxMarge(l.r.mgN1, l.r.n1)
                    const rt = tauxMarge(l.r.mgN, l.r.n)
                    const nVide = l.sub === 'à venir'
                    return (
                      <tr key={l.label} className={`border-b border-[#EFEDE8] ${l.label === 'À date' ? 'bg-[#FDF7EA] font-semibold' : ''}`}>
                        <td className="py-2">
                          <span className="font-semibold text-slate-800">{l.label}</span>
                          {l.sub && <span className="ml-2 text-[11px] text-slate-400">{l.sub}</span>}
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmtEuro(l.v.mgN1)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{nVide ? '—' : fmtEuro(l.v.mgN)}</td>
                        <td className="py-2 text-right tabular-nums text-slate-600">{fmtPct(t2, 1, false)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(t1, 1, false)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{nVide ? '—' : fmtPct(t, 1, false)}</td>
                        <td className={`py-2 text-right font-semibold tabular-nums ${toneOf(t !== null && t1 !== null ? t - t1 : null, 0.1)}`}>
                          {nVide || t === null || t1 === null ? '—' : fmtPts(t - t1)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {nVide ? '—' : `${fmtPct(rt, 1, false)} (${rt !== null && rt1 !== null ? fmtPts(rt - rt1) : '—'})`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Objectifs & familles */}
          <Section title="Objectifs et familles suivies" hint="Familles de produits listées dans l’écran Objectifs pour ce périmètre (à défaut : objectifs de l’agence puis de l’entreprise).">
            {objectifs.propres.filter((o) => !o.famille_macro).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {objectifs.propres
                  .filter((o) => !o.famille_macro)
                  .map((o) => (
                    <ObjectifChip key={`${o.type_objectif}`} objectif={o} reel={reelPour(o, aDate, tauxN, tauxN1, attenduADate)} />
                  ))}
              </div>
            )}
            {famillesSuivies.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#D8D3C8] bg-white px-4 py-5 text-sm text-slate-500">
                Aucune famille de produits n’est listée dans les objectifs {annee} de ce périmètre, de son agence ou de l’entreprise. Ajoutez-en
                dans l’écran Objectifs (bloc « CA par famille » ou « Marge par famille ») pour les voir apparaître ici.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E2DFD8] text-[11px] uppercase tracking-[0.06em] text-slate-500">
                      <th className="py-2 text-left font-semibold">Famille</th>
                      <th className="py-2 text-right font-semibold">CA {annee - 1} à date</th>
                      <th className="py-2 text-right font-semibold">CA {annee} à date</th>
                      <th className="py-2 text-right font-semibold">Évol.</th>
                      <th className="py-2 text-right font-semibold">Entreprise</th>
                      <th className="py-2 text-right font-semibold">Taux marge</th>
                      <th className="py-2 text-right font-semibold">Évol. taux</th>
                      <th className="py-2 text-left font-semibold pl-4">Objectif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {famillesSuivies.map((f) => {
                      const t = tauxMarge(f.v.mgN, f.v.n)
                      const t1 = tauxMarge(f.v.mgN1, f.v.n1)
                      return (
                        <tr key={f.famille} className="border-b border-[#EFEDE8]">
                          <td className="py-2">
                            <span className="font-semibold text-slate-800">{FAMILLES_LIBELLES[f.famille] || f.famille}</span>
                            {f.source !== 'propre' && <span className="ml-2 rounded bg-[#EDEAE3] px-1.5 text-[10px] text-slate-500">objectif {f.source}</span>}
                          </td>
                          <td className="py-2 text-right tabular-nums">{fmtEuro(f.v.n1)}</td>
                          <td className="py-2 text-right font-semibold tabular-nums">{fmtEuro(f.v.n)}</td>
                          <td className={`py-2 text-right font-semibold tabular-nums ${toneOf(f.v.evolN)}`}>{fmtPct(f.v.evolN)}</td>
                          <td className={`py-2 text-right tabular-nums ${toneOf(f.r.evolN)}`}>{fmtPct(f.r.evolN)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtPct(t, 1, false)}</td>
                          <td className={`py-2 text-right tabular-nums ${toneOf(t !== null && t1 !== null ? t - t1 : null, 0.1)}`}>{t !== null && t1 !== null ? fmtPts(t - t1) : '—'}</td>
                          <td className="py-2 pl-4">
                            <div className="flex flex-wrap gap-1.5">
                              {f.objectifs.map((o) => (
                                <ObjectifChip
                                  key={o.type_objectif}
                                  compact
                                  objectif={o}
                                  reel={reelPour(o, f.v, t, t1, f.totalN1 > 0 && o.type_objectif === 'ca_valeur' ? o.valeur_cible * (f.v.n1 / f.totalN1) : null)}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Profil clients */}
          <Section
            title="Profil CA des clients"
            hint={`Nombre de clients par tranche de CA annuel. « 12 mois glissants » = d’${MOIS_COURTS[(moisClos % 12) + 1] || 'janv.'} ${moisClos === 12 ? annee : annee - 1} à ${libMoisClos} ${annee}.`}
          >
            {profilError ? (
              <p className="text-sm text-[#A32C2C]">Profil indisponible : {profilError}</p>
            ) : !profil ? (
              <p className="text-sm text-slate-500">Calcul du profil clients…</p>
            ) : (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="border-b border-[#E2DFD8] text-[11px] uppercase tracking-[0.06em] text-slate-500">
                        <th className="py-2 text-left font-semibold">Tranche</th>
                        <th className="py-2 text-right font-semibold">{annee - 2}</th>
                        <th className="py-2 text-right font-semibold">{annee - 1}</th>
                        <th className="py-2 text-right font-semibold">12 MG N-1</th>
                        <th className="py-2 text-right font-semibold">12 MG</th>
                        <th className="py-2 text-right font-semibold">CA 12 MG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profil.tranches.map((t) => (
                        <tr key={t.code} className="border-b border-[#EFEDE8]">
                          <td className="py-2 font-semibold text-slate-800">{t.libelle}</td>
                          <td className="py-2 text-right tabular-nums text-slate-600">{fmtInt(t.n2.nb)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtInt(t.n1.nb)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtInt(t.g12n1.nb)}</td>
                          <td className={`py-2 text-right font-bold tabular-nums ${t.g12.nb > t.g12n1.nb ? 'text-[#1F6B3A]' : t.g12.nb < t.g12n1.nb ? 'text-[#A32C2C]' : 'text-slate-900'}`}>
                            {fmtInt(t.g12.nb)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-600">{fmtK(t.g12.ca)}</td>
                        </tr>
                      ))}
                      <tr className="text-[12px] text-slate-500">
                        <td className="py-2">Clients actifs</td>
                        <td />
                        <td />
                        <td className="py-2 text-right tabular-nums">{fmtInt(profil.nb_clients_actifs_n1)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-slate-800">{fmtInt(profil.nb_clients_actifs)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                  <ProfilBars profil={profil} base={profilBase} setBase={setProfilBase} annee={annee} />
                </div>

                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Principaux clients (12 mois glissants)</div>
                  <div className="max-h-[360px] overflow-y-auto rounded-xl border border-[#E7E4DD] bg-white">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-[#FAF9F7]">
                        <tr className="text-[10px] uppercase tracking-[0.06em] text-slate-500">
                          <th className="px-2 py-1.5 text-left font-semibold">Client</th>
                          <th className="px-2 py-1.5 text-right font-semibold">{annee - 1}</th>
                          <th className="px-2 py-1.5 text-right font-semibold">12 MG</th>
                          <th className="px-2 py-1.5 text-right font-semibold">À date vs N-1</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profil.clients.map((c) => {
                          const e = evolPct(c.ca_ytd, c.ca_ytd_n1)
                          return (
                            <tr key={c.numero} className="border-t border-[#F1EFEA]">
                              <td className="max-w-[220px] truncate px-2 py-1.5">
                                <a href={`/vision-client?numero=${encodeURIComponent(c.numero)}`} target="_blank" rel="noreferrer" className="font-medium text-slate-800 hover:text-[#245A9E] hover:underline">
                                  {c.intitule || c.numero}
                                </a>
                                <span className="ml-1 text-[10px] text-slate-400">{c.numero}</span>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{fmtK(c.ca_n1)}</td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtK(c.ca_12mg)}</td>
                              <td className={`px-2 py-1.5 text-right tabular-nums ${toneOf(e)}`}>{e === null ? (c.ca_ytd > 0 ? 'nouveau' : '—') : fmtPct(e, 0)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
function valeurs(serie: Serie, from: number, to: number, nVide = false) {
  const n2 = sumMonths(serie.ca[0], from, to)
  const n1 = sumMonths(serie.ca[1], from, to)
  const n = nVide ? 0 : sumMonths(serie.ca[2], from, to)
  return {
    n2,
    n1,
    n,
    evolN1: evolPct(n1, n2),
    evolN: nVide ? null : evolPct(n, n1),
    mgN2: sumMonths(serie.mg[0], from, to),
    mgN1: sumMonths(serie.mg[1], from, to),
    mgN: nVide ? 0 : sumMonths(serie.mg[2], from, to),
  }
}

type Reel = { texte: string; statut: 'ok' | 'ko' | 'neutre'; detail?: string }

function reelPour(
  o: Objectif,
  v: ReturnType<typeof valeurs>,
  taux: number | null,
  tauxN1: number | null,
  attenduADate: number | null
): Reel {
  switch (o.type_objectif) {
    case 'ca_valeur': {
      const pct = o.valeur_cible > 0 ? (v.n / o.valeur_cible) * 100 : null
      const ok = attenduADate !== null ? v.n >= attenduADate : null
      return {
        texte: `${fmtK(v.n)} (${pct === null ? '—' : `${Math.round(pct)} %`})`,
        statut: ok === null ? 'neutre' : ok ? 'ok' : 'ko',
        detail: attenduADate !== null ? `Attendu à date (saisonnalité N-1) : ${fmtK(attenduADate)}` : undefined,
      }
    }
    case 'ca_evolution_pct':
      return { texte: fmtPct(v.evolN), statut: v.evolN === null ? 'neutre' : v.evolN >= o.valeur_cible ? 'ok' : 'ko' }
    case 'marge_evolution_pct': {
      const d = taux !== null && tauxN1 !== null ? taux - tauxN1 : null
      return { texte: fmtPts(d), statut: d === null ? 'neutre' : d >= o.valeur_cible ? 'ok' : 'ko' }
    }
    default:
      return { texte: 'voir profil clients', statut: 'neutre' }
  }
}

function ObjectifChip({ objectif, reel, compact = false }: { objectif: Objectif; reel: Reel; compact?: boolean }) {
  const cible =
    objectif.type_objectif === 'ca_valeur'
      ? fmtK(objectif.valeur_cible)
      : objectif.type_objectif === 'ca_evolution_pct'
      ? fmtPct(objectif.valeur_cible)
      : objectif.type_objectif === 'marge_evolution_pct'
      ? fmtPts(objectif.valeur_cible)
      : `${fmtInt(objectif.valeur_cible)} clients`
  const colors =
    reel.statut === 'ok'
      ? 'border-[#B9DCC3] bg-[#EEF7F0]'
      : reel.statut === 'ko'
      ? 'border-[#F0C5BE] bg-[#FCEFEC]'
      : 'border-[#E2DFD8] bg-white'
  return (
    <div className={`rounded-lg border ${colors} ${compact ? 'px-2 py-1' : 'px-3 py-2'}`} title={reel.detail}>
      <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-semibold uppercase tracking-[0.06em] text-slate-500`}>
        {TYPE_LIBELLES[objectif.type_objectif] || objectif.type_objectif} · cible {cible}
      </div>
      <div className={`${compact ? 'text-[12px]' : 'text-[14px]'} font-bold text-slate-900`}>
        {reel.statut === 'ok' ? '✓ ' : reel.statut === 'ko' ? '▼ ' : ''}
        {reel.texte}
      </div>
      {!compact && reel.detail && <div className="text-[11px] text-slate-500">{reel.detail}</div>}
    </div>
  )
}

function ProfilBars({
  profil,
  base,
  setBase,
  annee,
}: {
  profil: Profil
  base: 'g12' | 'n1' | 'n2'
  setBase: (b: 'g12' | 'n1' | 'n2') => void
  annee: number
}) {
  const total = profil.tranches.reduce((s, t) => s + Math.max(0, t[base].ca), 0)
  const colors = ['#173B6C', '#245A9E', '#4F7FC0', '#86A8D6', '#B9CDE8', '#DDE6F2']
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-500">
        <span className="font-semibold uppercase tracking-[0.1em]">Répartition du CA</span>
        {(['n2', 'n1', 'g12'] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBase(b)}
            className={`rounded px-1.5 py-0.5 font-semibold ${base === b ? 'bg-[#111820] text-white' : 'hover:bg-[#EDEAE3]'}`}
          >
            {b === 'n2' ? annee - 2 : b === 'n1' ? annee - 1 : '12 MG'}
          </button>
        ))}
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-[#E2DFD8] bg-white">
        {profil.tranches.map((t, i) => {
          const pct = total > 0 ? (Math.max(0, t[base].ca) / total) * 100 : 0
          if (pct < 0.5) return null
          return (
            <div
              key={t.code}
              style={{ width: `${pct}%`, background: colors[i] }}
              className="flex items-center justify-center text-[10px] font-semibold text-white"
              title={`${t.libelle} : ${fmtK(t[base].ca)} (${Math.round(pct)} %) · ${t[base].nb} clients`}
            >
              {pct >= 8 ? `${Math.round(pct)} %` : ''}
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        {profil.tranches.map((t, i) => (
          <span key={t.code} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colors[i] }} />
            {t.libelle}
          </span>
        ))}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone = 'text-slate-900', style }: { label: string; value: string; sub?: string; tone?: string; style?: React.CSSProperties }) {
  return (
    <div className="rounded-xl border border-[#E2DFD8] bg-white px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-[19px] font-bold leading-tight ${tone}`} style={style}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#E2DFD8] bg-white p-4 md:p-5">
      <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
      {hint && <p className="mb-3 mt-0.5 text-[12px] text-slate-500">{hint}</p>}
      {children}
    </section>
  )
}
