'use client'

/**
 * Statistiques — Hotline technique / SAV (/hotline/stats). Créé le 02/11/2026.
 * Réservé au droit can_hotline_expert (contrôlé aussi par la RPC hotline_stats).
 *
 * Période libre (raccourcis 7 j / 30 j / 90 j / année) : volumes, tickets encore
 * ouverts, délais médians et moyens (1re action, résolution), taux de
 * résolution au niveau 1, répartitions filière / motif / niveau / statut,
 * préconisations et clients les plus fréquents, évolution hebdomadaire PV /
 * thermique (tableau avec barres, valeurs toujours affichées).
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur } from '@/components/hotline/HotlineHeader'
import { STATUTS, fmtHeures, libelleFiliere, libelleMotif, messageErreur, type Statut } from '@/lib/hotline'

type Stats = {
  total: number
  ouverts: number
  par_filiere: Record<string, number>
  par_motif: Record<string, number>
  par_statut: Record<string, number>
  par_niveau: Record<string, number>
  delai_premiere_action_h: { moyenne: number | null; mediane: number | null } | null
  delai_resolution_h: { moyenne: number | null; mediane: number | null } | null
  taux_resolution_n1: number | null
  top_preconisations: Array<{ libelle: string; n: number }>
  top_clients: Array<{ numero_tiers: string; intitule: string | null; n: number }>
  par_semaine: Array<{ semaine: string; PV: number; THERMIQUE: number }>
}

// Couleurs de série (validées daltonisme, script dataviz) : la filière garde
// toujours la même couleur. Contraste < 3:1 pour l'or → valeurs affichées.
const COULEUR_FILIERE: Record<string, string> = { PV: '#C98A1E', THERMIQUE: '#2D5FA0' }
const NEUTRE = '#5E6B7E'

function isoJour(d: Date) {
  return d.toISOString().slice(0, 10)
}

function decaler(jours: number) {
  const d = new Date()
  d.setDate(d.getDate() - jours)
  return isoJour(d)
}

export default function HotlineStatsPage() {
  const { rights } = useAccess()
  const expert = Boolean(rights.can_hotline_expert || rights.can_autorisation)
  const [debut, setDebut] = useState(decaler(30))
  const [fin, setFin] = useState(isoJour(new Date()))
  const [stats, setStats] = useState<Stats | null>(null)
  // Clé de la période chargée : « en cours » tant qu'elle diffère de la période affichée.
  const [chargee, setChargee] = useState('')
  const loading = chargee !== `${debut}|${fin}`
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (!expert) return
    supabase
      .rpc('hotline_stats', { p_debut: debut, p_fin: fin })
      .then(({ data, error }) => {
        if (error) setErreur(messageErreur(error))
        else setStats(data as Stats)
        setChargee(`${debut}|${fin}`)
      })
  }, [debut, fin, expert])

  const maxSemaine = useMemo(() => Math.max(1, ...(stats?.par_semaine || []).map((s) => s.PV + s.THERMIQUE)), [stats])

  if (!expert) {
    return (
      <div className="min-h-screen bg-[#F4F3F0]">
        <HotlineHeader titre="Statistiques" />
        <main className="mx-auto max-w-[1760px] px-4 py-6 md:px-8">
          <HotlineErreur message="Écran réservé aux experts hotline : demander le droit « Hotline – expert » (Admin › Profils et autorisations)." />
        </main>
      </div>
    )
  }

  const raccourcis: Array<[string, number]> = [
    ['7 j', 7],
    ['30 j', 30],
    ['90 j', 90],
    ['12 mois', 365],
  ]

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader
        titre="Statistiques"
        sousTitre="Origine des appels, délais de prise en charge et de résolution, escalades"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {raccourcis.map(([label, jours]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setDebut(decaler(jours))
                  setFin(isoJour(new Date()))
                }}
                className="h-8 rounded-lg border border-[color:var(--cg-hdr-line)] px-2.5 text-[12px] font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A]"
              >
                {label}
              </button>
            ))}
            <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} className="h-8 rounded-lg border border-[color:var(--cg-hdr-line)] bg-[color:var(--cg-hdr-field)] px-2 text-[12px] text-[color:var(--cg-hdr-ink)]" />
            <span className="text-[color:var(--cg-hdr-muted)]">→</span>
            <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className="h-8 rounded-lg border border-[color:var(--cg-hdr-line)] bg-[color:var(--cg-hdr-field)] px-2 text-[12px] text-[color:var(--cg-hdr-ink)]" />
          </div>
        }
      />

      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 md:px-8">
        {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}
        {loading || !stats ? (
          <div className="rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">Calcul des statistiques…</div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Tickets', value: String(stats.total) },
                { label: 'Encore ouverts', value: String(stats.ouverts) },
                { label: '1re action (médiane)', value: fmtHeures(stats.delai_premiere_action_h?.mediane), sub: `moy. ${fmtHeures(stats.delai_premiere_action_h?.moyenne)}` },
                { label: 'Résolution (médiane)', value: fmtHeures(stats.delai_resolution_h?.mediane), sub: `moy. ${fmtHeures(stats.delai_resolution_h?.moyenne)}` },
                { label: 'Résolus au niveau 1', value: stats.taux_resolution_n1 === null ? '—' : `${String(stats.taux_resolution_n1).replace('.', ',')} %` },
                { label: 'Escaladés N2 / N3', value: String((stats.par_niveau['2'] || 0) + (stats.par_niveau['3'] || 0)) },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-[#E2DFD8] bg-white px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">{k.label}</div>
                  <div className="mt-1 text-[24px] font-bold text-slate-900">{k.value}</div>
                  {k.sub ? <div className="text-[11px] text-slate-500">{k.sub}</div> : null}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <Repartition
                titre="Par filière"
                lignes={Object.entries(stats.par_filiere).map(([k, n]) => ({ label: libelleFiliere(k), n, couleur: COULEUR_FILIERE[k] || NEUTRE }))}
              />
              <Repartition titre="Par motif" lignes={Object.entries(stats.par_motif).map(([k, n]) => ({ label: libelleMotif(k === 'NON_RENSEIGNE' ? null : k), n }))} />
              <Repartition titre="Par niveau atteint" lignes={['1', '2', '3'].map((k) => ({ label: `Niveau ${k}`, n: stats.par_niveau[k] || 0 }))} />
              <Repartition
                titre="Par statut"
                lignes={(Object.keys(STATUTS) as Statut[]).map((s) => ({ label: STATUTS[s].label, n: stats.par_statut[s] || 0 }))}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
              <section className="rounded-2xl border border-[#E2DFD8] bg-white xl:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3">
                  <span className="text-[14px] font-bold text-slate-900">Tickets par semaine</span>
                  <span className="flex gap-3 text-[12px] text-slate-600">
                    {Object.entries(COULEUR_FILIERE).map(([k, c]) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                        {libelleFiliere(k)}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="overflow-x-auto p-4">
                  {stats.par_semaine.length ? (
                    <table className="w-full text-[12px]">
                      <thead className="text-[11px] uppercase tracking-[0.05em] text-slate-500">
                        <tr>
                          <th className="pb-2 text-left">Semaine du</th>
                          <th className="pb-2 text-right">PV</th>
                          <th className="pb-2 text-right">Thermique</th>
                          <th className="pb-2 pl-4 text-left" />
                        </tr>
                      </thead>
                      <tbody>
                        {stats.par_semaine.map((s) => (
                          <tr key={s.semaine} className="border-t border-[#EFEDE8]">
                            <td className="py-1.5 text-slate-700">{new Date(s.semaine).toLocaleDateString('fr-FR')}</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-900">{s.PV}</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-900">{s.THERMIQUE}</td>
                            <td className="w-[55%] py-1.5 pl-4">
                              <div className="flex h-3 gap-[2px]" title={`PV ${s.PV} · Thermique ${s.THERMIQUE}`}>
                                {s.PV ? <div className="rounded-l-[4px]" style={{ width: `${(100 * s.PV) / maxSemaine}%`, background: COULEUR_FILIERE.PV }} /> : null}
                                {s.THERMIQUE ? (
                                  <div className="rounded-r-[4px]" style={{ width: `${(100 * s.THERMIQUE) / maxSemaine}%`, background: COULEUR_FILIERE.THERMIQUE }} />
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-[13px] text-slate-500">Aucun ticket sur la période.</p>
                  )}
                </div>
              </section>

              <div className="space-y-4">
                <Classement titre="Préconisations les plus données" lignes={stats.top_preconisations.map((p) => ({ label: p.libelle, n: p.n }))} />
                <Classement titre="Clients qui appellent le plus" lignes={stats.top_clients.map((c) => ({ label: `${c.intitule || c.numero_tiers} · ${c.numero_tiers}`, n: c.n }))} />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Repartition({ titre, lignes }: { titre: string; lignes: Array<{ label: string; n: number; couleur?: string }> }) {
  const total = lignes.reduce((s, l) => s + l.n, 0)
  const max = Math.max(1, ...lignes.map((l) => l.n))
  return (
    <section className="rounded-2xl border border-[#E2DFD8] bg-white">
      <div className="border-b border-[#EFEDE8] px-4 py-3 text-[14px] font-bold text-slate-900">{titre}</div>
      <div className="space-y-2.5 p-4">
        {lignes.map((l) => (
          <div key={l.label} title={`${l.label} : ${l.n} ticket(s)`}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-slate-700">{l.label}</span>
              <span className="tabular-nums text-slate-900">
                {l.n} <span className="text-slate-400">{total ? `· ${Math.round((100 * l.n) / total)} %` : ''}</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-[#F1EFEA]">
              <div className="h-2 rounded-full" style={{ width: `${(100 * l.n) / max}%`, background: l.couleur || NEUTRE }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Classement({ titre, lignes }: { titre: string; lignes: Array<{ label: string; n: number }> }) {
  return (
    <section className="rounded-2xl border border-[#E2DFD8] bg-white">
      <div className="border-b border-[#EFEDE8] px-4 py-3 text-[14px] font-bold text-slate-900">{titre}</div>
      <ol className="space-y-1.5 p-4 text-[12px]">
        {lignes.length ? (
          lignes.map((l, i) => (
            <li key={`${l.label}-${i}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-slate-700">{l.label}</span>
              <span className="tabular-nums font-semibold text-slate-900">{l.n}</span>
            </li>
          ))
        ) : (
          <li className="text-slate-500">Rien sur la période.</li>
        )}
      </ol>
    </section>
  )
}
