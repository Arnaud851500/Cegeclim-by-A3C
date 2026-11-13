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
 * Classification thermie (08/11/2026) : symptômes, organes défaillants, issues,
 * actions et codes défaut les plus fréquents (part finie en pièce / réglée au
 * téléphone). Filtre de filière. L'historique de l'ancien outil est classé
 * automatiquement (classif_source AUTO_2026_11).
 * Scénarios proposés (12/11/2026) : components/hotline/ScenariosHotline.tsx,
 * RPC hotline_scenarios.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur } from '@/components/hotline/HotlineHeader'
import { FILIERES, STATUTS, chargerMonEnvironnement, fmtHeures, libelleFiliere, libelleMotif, messageErreur, type Filiere, type Statut } from '@/lib/hotline'
import { useClassification } from '@/components/hotline/ClassificationTicket'
import StatsClassification from '@/components/hotline/StatsClassification'
import ScenariosHotline from '@/components/hotline/ScenariosHotline'

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
  /** (13/11/2026) Tickets par semaine et par personne qui a créé le ticket. */
  par_semaine_createur?: Array<{ semaine: string; createur: string; nom: string; n: number }>
  // Classification (08/11/2026)
  par_nature?: Record<string, number>
  par_symptome?: Record<string, number>
  par_organe?: Record<string, number>
  par_issue?: Record<string, number>
  par_action?: Record<string, number>
  top_codes?: Array<{ code: string; n: number; piece: number; tel: number }>
  classifies?: number
  classifies_auto?: number
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
  const [filiere, setFiliere] = useState<Filiere | ''>('')
  // (13/11/2026) Filtre par défaut sur l'environnement hotline de l'utilisateur (modifiable).
  useEffect(() => {
    chargerMonEnvironnement()
      .then((env) => {
        if (env.filiere) setFiliere((f) => (f === '' ? env.filiere! : f))
      })
      .catch(() => undefined)
  }, [])
  const { classif } = useClassification()
  const [fin, setFin] = useState(isoJour(new Date()))
  const [stats, setStats] = useState<Stats | null>(null)
  // Clé de la période chargée : « en cours » tant qu'elle diffère de la période affichée.
  const [chargee, setChargee] = useState('')
  const loading = chargee !== `${debut}|${fin}|${filiere}`
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (!expert) return
    supabase
      .rpc('hotline_stats', { p_debut: debut, p_fin: fin, p_filiere: filiere || null })
      .then(({ data, error }) => {
        if (error) setErreur(messageErreur(error))
        else setStats(data as Stats)
        setChargee(`${debut}|${fin}|${filiere}`)
      })
  }, [debut, fin, filiere, expert])



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
            <select value={filiere} onChange={(e) => setFiliere(e.target.value as Filiere | '')} className="h-8 rounded-lg border border-[color:var(--cg-hdr-line)] bg-[color:var(--cg-hdr-field)] px-2 text-[12px] text-[color:var(--cg-hdr-ink)]">
              <option value="">Toutes filières</option>
              {FILIERES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
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
            <button
              type="button"
              title="Depuis la reprise de l’ancien outil (septembre 2022)"
              onClick={() => {
                setDebut('2022-09-01')
                setFin(isoJour(new Date()))
              }}
              className="h-8 rounded-lg border border-[color:var(--cg-hdr-line)] px-2.5 text-[12px] font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A]"
            >
              Tout l’historique
            </button>
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

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
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
              <HistogrammeSemaines semaines={stats.par_semaine.map((x) => x.semaine)} lignes={stats.par_semaine_createur || []} />

              <div className="space-y-4">
                <Classement titre="Préconisations les plus données" lignes={stats.top_preconisations.map((p) => ({ label: p.libelle, n: p.n }))} />
                <Classement titre="Clients qui appellent le plus" lignes={stats.top_clients.map((c) => ({ label: `${c.intitule || c.numero_tiers} · ${c.numero_tiers}`, n: c.n }))} />
              </div>
            </div>

            {filiere !== 'PV' ? <StatsClassification debut={debut} fin={fin} classif={classif} /> : null}
            {filiere !== 'PV' ? <ScenariosHotline classif={classif} /> : null}
          </>
        )}
      </main>
    </div>
  )
}

// (13/11/2026) Répartitions en pastilles compactes.
function Repartition({ titre, lignes }: { titre: string; lignes: Array<{ label: string; n: number; couleur?: string }> }) {
  const total = lignes.reduce((s, l) => s + l.n, 0)
  return (
    <section className="rounded-xl border border-[#E2DFD8] bg-white px-3 py-2">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500">{titre}</div>
      <div className="flex flex-wrap gap-1.5">
        {lignes.map((l) => (
          <span
            key={l.label}
            title={`${l.label} : ${l.n} ticket(s)`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD8] bg-[#FAF9F7] px-2 py-0.5 text-[11px] text-slate-700"
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.couleur || NEUTRE }} />
            {l.label}
            <span className="font-semibold tabular-nums text-slate-900">{l.n}</span>
            {total ? <span className="tabular-nums text-slate-400">{Math.round((100 * l.n) / total)} %</span> : null}
          </span>
        ))}
      </div>
    </section>
  )
}

// (13/11/2026) Tickets par semaine : semaines en abscisse, histogramme empilé
// par personne ayant créé le ticket (10 plus gros créateurs, le reste en « Autres »).
const PALETTE_CREATEURS = ['#1E4E8C', '#C1683C', '#2F6B3A', '#7A5EA8', '#B4761A', '#0E7490', '#A32C2C', '#5B6B2F', '#BE185D', '#475569']

function HistogrammeSemaines({ semaines, lignes }: { semaines: string[]; lignes: Array<{ semaine: string; createur: string; nom: string; n: number }> }) {
  const { createurs, colonnes, max } = useMemo(() => {
    const totaux = new Map<string, { nom: string; n: number }>()
    lignes.forEach((l) => {
      const c = totaux.get(l.createur) || { nom: l.nom, n: 0 }
      c.n += l.n
      totaux.set(l.createur, c)
    })
    const tries = Array.from(totaux.entries()).sort((a, b) => b[1].n - a[1].n)
    const principaux = tries.slice(0, PALETTE_CREATEURS.length).map(([cle, v], i) => ({ cle, nom: v.nom, n: v.n, couleur: PALETTE_CREATEURS[i] }))
    const autresN = tries.slice(PALETTE_CREATEURS.length).reduce((s, [, v]) => s + v.n, 0)
    const liste = autresN ? [...principaux, { cle: '__autres', nom: 'Autres', n: autresN, couleur: '#CBD5E1' }] : principaux
    const index = new Set(principaux.map((p) => p.cle))
    const toutesSemaines = Array.from(new Set([...semaines, ...lignes.map((l) => l.semaine)])).sort()
    const cols = toutesSemaines.map((sem) => {
      const parCle = new Map<string, number>()
      lignes
        .filter((l) => l.semaine === sem)
        .forEach((l) => {
          const cle = index.has(l.createur) ? l.createur : '__autres'
          parCle.set(cle, (parCle.get(cle) || 0) + l.n)
        })
      const total = Array.from(parCle.values()).reduce((a, b) => a + b, 0)
      return { semaine: sem, total, segments: liste.map((c) => ({ ...c, v: parCle.get(c.cle) || 0 })).filter((x) => x.v > 0) }
    })
    return { createurs: liste, colonnes: cols, max: Math.max(1, ...cols.map((c) => c.total)) }
  }, [semaines, lignes])

  const HAUTEUR = 240
  return (
    <section className="rounded-2xl border border-[#E2DFD8] bg-white xl:col-span-2">
      <div className="border-b border-[#EFEDE8] px-4 py-3">
        <span className="text-[14px] font-bold text-slate-900">Tickets par semaine</span>
        <span className="ml-2 text-[12px] text-slate-500">par personne ayant créé le ticket</span>
      </div>
      <div className="p-4">
        {colonnes.length ? (
          <>
            <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: HAUTEUR + 40 }}>
              {colonnes.map((c) => (
                <div key={c.semaine} className="flex min-w-[34px] flex-1 flex-col items-center justify-end">
                  <div className="mb-1 text-[11px] font-semibold tabular-nums text-slate-700">{c.total || ''}</div>
                  <div className="flex w-full max-w-[56px] flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: (HAUTEUR * c.total) / max }}>
                    {c.segments.map((sg) => (
                      <div
                        key={sg.cle}
                        title={`Semaine du ${new Date(c.semaine).toLocaleDateString('fr-FR')} · ${sg.nom} : ${sg.v} ticket(s)`}
                        style={{ height: `${(100 * sg.v) / (c.total || 1)}%`, background: sg.couleur }}
                        className="w-full border-t border-white/40"
                      />
                    ))}
                  </div>
                  <div className="mt-1 whitespace-nowrap text-[10px] text-slate-500">
                    {new Date(c.semaine).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-[#EFEDE8] pt-3 text-[11px] text-slate-700">
              {createurs.map((c) => (
                <span key={c.cle} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.couleur }} />
                  {c.nom}
                  <span className="tabular-nums text-slate-400">{c.n}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-slate-500">Aucun ticket sur la période.</p>
        )}
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
