'use client'

// ============================================================================
// app/admin/flux-donnees/page.tsx — Flux de données du compagnon (15/11/2026)
// ----------------------------------------------------------------------------
// Schéma en couches demandé par Arnaud, à la manière d'une architecture
// réseau : une bande par couche, éléments alignés de gauche à droite, reliés
// par des barres de liaison.
//   1. Sources (SAGE, BLG, Sirene, RGE, Hi-Parts, compagnies maritimes…)
//   2. Supabase — données de base, puis rythmes de mise à jour, puis
//      données calculées (familles de tâches pg_cron / planificateur)
//   3. Vercel — blocs du compagnon (lib/navigation.ts)
// Chaque brique porte une pastille d'état (vert à jour, orange en retard,
// rouge échec, gris non suivi), son volume et sa dernière mise à jour.
// Clic → détail des composants mesurés (tâches, imports, tables).
// Survol d'un bloc Vercel → met en avant les familles qui l'alimentent.
//
// Données : RPC get_admin_flux_etat() (registre admin_flux_registre), voir
// supabase/migrations/20261115a_admin_flux_donnees.sql. Rafraîchi toutes les
// 60 s. Droit : can_autorisation (contrôlé aussi en base).
// ============================================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { NAV_BLOCS } from '@/lib/navigation'

// ── Types ───────────────────────────────────────────────────────────────────

type Statut = 'ok' | 'retard' | 'echec' | 'non_suivi'

type Detail = {
  type: 'import' | 'table' | 'cron' | 'planificateur'
  nom: string
  statut: Statut
  derniere_maj?: string | null
  message?: string | null
  planification?: string
  attendu_depuis?: string | null
  duree_s?: number | null
  passages_24h?: number
  echecs_24h?: number
  dernier_passage?: string | null
  prochain_passage?: string | null
  seuil_minutes?: number | null
  lignes?: number
  tables?: Record<string, number> | null
}

type Flux = {
  code: string
  couche: 'source' | 'base' | 'calcule'
  ordre: number
  libelle: string
  icone: string | null
  mode: string | null
  frequence: string | null
  description: string | null
  lien: string | null
  blocs: string[]
  statut: Statut
  derniere_maj: string | null
  derniere_maj_recente: string | null
  volume: number | null
  nb_tables: number | null
  details: Detail[]
}

type Etat = { genere_le: string; flux: Flux[] }

// ── Présentation ────────────────────────────────────────────────────────────

const STATUT: Record<Statut, { libelle: string; point: string; texte: string; fond: string; rang: number }> = {
  ok: { libelle: 'À jour', point: 'bg-emerald-500', texte: 'text-emerald-700', fond: 'bg-emerald-50 border-emerald-200', rang: 1 },
  retard: { libelle: 'En retard', point: 'bg-amber-500', texte: 'text-amber-700', fond: 'bg-amber-50 border-amber-200', rang: 2 },
  echec: { libelle: 'Échec', point: 'bg-red-500', texte: 'text-red-700', fond: 'bg-red-50 border-red-200', rang: 3 },
  non_suivi: { libelle: 'Non suivi', point: 'bg-slate-300', texte: 'text-slate-500', fond: 'bg-slate-50 border-slate-200', rang: 0 },
}

const TYPE_LIBELLE: Record<Detail['type'], string> = {
  import: 'Import',
  table: 'Table',
  cron: 'Tâche pg_cron',
  planificateur: 'Planification des jobs',
}

const RYTHMES = ['Temps réel · vues', 'Chaque minute · workers', '10–15 min', 'Horaire 5h–20h', '7 fois / jour', 'Nuit']

const BLOCS_EXCLUS = new Set(['guides'])

const fmtVolume = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

function fmtNombre(n: number | null | undefined) {
  if (n == null) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString('fr-FR')} k`
  return fmtVolume.format(n)
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtRelatif(iso: string | null | undefined, maintenant: number) {
  if (!iso) return 'jamais'
  const min = Math.round((maintenant - new Date(iso).getTime()) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `il y a ${h} h`
  return `il y a ${Math.round(h / 24)} j`
}

function pire(statuts: Statut[]): Statut {
  return statuts.reduce<Statut>((acc, s) => (STATUT[s].rang > STATUT[acc].rang ? s : acc), 'non_suivi')
}

// ── Composants ──────────────────────────────────────────────────────────────

function Pastille({ statut, taille = 'h-2.5 w-2.5' }: { statut: Statut; taille?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${taille} ${STATUT[statut].point}`} title={STATUT[statut].libelle} />
}

function Fleche() {
  return <span aria-hidden className="block h-4 w-px bg-slate-400" />
}

function Bus({ couleur = 'bg-slate-300' }: { couleur?: string }) {
  return <div className={`mx-2 h-2 rounded-full ${couleur}`} />
}

function Brique({
  flux,
  maintenant,
  actif,
  attenue,
  onClick,
  flecheHaut,
  flecheBas,
}: {
  flux: Flux
  maintenant: number
  actif: boolean
  attenue: boolean
  onClick: () => void
  flecheHaut?: boolean
  flecheBas?: boolean
}) {
  const vol = fmtNombre(flux.volume)
  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center transition-opacity ${attenue ? 'opacity-30' : ''}`}>
      {flecheHaut && <Fleche />}
      <button
        type="button"
        onClick={onClick}
        className={`group flex w-full max-w-[150px] flex-col items-center rounded-xl px-1.5 py-2 text-center hover:bg-white/70 ${actif ? 'bg-white ring-2 ring-blue-500' : ''}`}
      >
        <span className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-2xl shadow-sm">
          <span aria-hidden>{flux.icone ?? '•'}</span>
          <span className="absolute -right-1 -top-1 rounded-full border-2 border-white">
            <Pastille statut={flux.statut} taille="h-3 w-3" />
          </span>
        </span>
        <span className="mt-1.5 text-[13px] font-semibold leading-tight text-slate-900">{flux.libelle}</span>
        {flux.frequence && <span className="mt-0.5 text-[11px] leading-tight text-slate-500">{flux.frequence}</span>}
        <span className={`mt-1 text-[11px] font-medium leading-tight ${STATUT[flux.statut].texte}`}>
          {fmtRelatif(flux.derniere_maj_recente, maintenant)}
        </span>
        {vol && <span className="text-[11px] leading-tight text-slate-400 tabular-nums">{vol} lignes</span>}
      </button>
      {flecheBas && <Fleche />}
    </div>
  )
}

function Bande({
  titre,
  sousTitre,
  fond,
  titreCouleur,
  children,
}: {
  titre: string
  sousTitre?: string
  fond: string
  titreCouleur: string
  children: ReactNode
}) {
  return (
    <section className={`grid grid-cols-[130px_minmax(0,1fr)] rounded-2xl border px-3 py-3 ${fond}`}>
      <div className="flex flex-col justify-center pr-3">
        <div className={`text-base font-black leading-tight ${titreCouleur}`}>{titre}</div>
        {sousTitre && <div className="mt-0.5 text-xs text-slate-500">{sousTitre}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function FluxDonneesPage() {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const [selection, setSelection] = useState<string | null>(null)
  const [blocSurvole, setBlocSurvole] = useState<string | null>(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())

  const charger = useCallback(async () => {
    setChargement(true)
    const { data, error } = await supabase.rpc('get_admin_flux_etat')
    if (error) setErreur(error.message)
    else {
      setEtat(data as Etat)
      setErreur(null)
    }
    setMaintenant(Date.now())
    setChargement(false)
  }, [])

  useEffect(() => {
    const premier = window.setTimeout(() => void charger(), 0)
    const id = window.setInterval(() => void charger(), 60_000)
    return () => {
      window.clearTimeout(premier)
      window.clearInterval(id)
    }
  }, [charger])

  const parCouche = useMemo(() => {
    const flux = etat?.flux ?? []
    const tri = (c: Flux['couche']) => flux.filter((f) => f.couche === c).sort((a, b) => a.ordre - b.ordre)
    return { source: tri('source'), base: tri('base'), calcule: tri('calcule') }
  }, [etat])

  const blocs = useMemo(() => {
    const calcules = parCouche.calcule
    return NAV_BLOCS.filter((b) => !BLOCS_EXCLUS.has(b.id)).map((b) => {
      const lies = calcules.filter((f) => f.blocs.includes(b.id))
      return { bloc: b, lies, statut: lies.length ? pire(lies.map((f) => f.statut)) : ('non_suivi' as Statut) }
    })
  }, [parCouche])

  const compteurs = useMemo(() => {
    const c: Record<Statut, number> = { ok: 0, retard: 0, echec: 0, non_suivi: 0 }
    for (const f of etat?.flux ?? []) c[f.statut] += 1
    return c
  }, [etat])

  const fluxSelectionne = etat?.flux.find((f) => f.code === selection) ?? null
  const liesAuBloc = blocSurvole ? new Set(blocs.find((b) => b.bloc.id === blocSurvole)?.lies.map((f) => f.code)) : null

  const brique = (f: Flux, opts: { haut?: boolean; bas?: boolean } = {}) => (
    <Brique
      key={f.code}
      flux={f}
      maintenant={maintenant}
      actif={selection === f.code}
      attenue={Boolean(liesAuBloc && f.couche === 'calcule' && !liesAuBloc.has(f.code))}
      onClick={() => setSelection(selection === f.code ? null : f.code)}
      flecheHaut={opts.haut}
      flecheBas={opts.bas}
    />
  )

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-blue-700">Administration</div>
              <h1 className="mt-1 text-3xl font-black">Flux de données</h1>
              <p className="mt-2 text-sm text-slate-600">
                Des sources jusqu’aux écrans : mode et fréquence de chaque synchronisation, volume et dernière mise à jour.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['echec', 'retard', 'ok', 'non_suivi'] as Statut[]).map((s) => (
                <span key={s} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${STATUT[s].fond}`}>
                  <Pastille statut={s} />
                  <span className={`font-semibold ${STATUT[s].texte}`}>{compteurs[s]}</span>
                  <span className="text-slate-600">{STATUT[s].libelle}</span>
                </span>
              ))}
              <button
                type="button"
                onClick={() => void charger()}
                disabled={chargement}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                {chargement ? 'Actualisation…' : 'Actualiser'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Orange : pas de passage depuis le dernier déclenchement prévu, ou au-delà du seuil de la source. Rouge : dernier passage
            en erreur, ou plus de 3 fois le seuil. Gris : alimentation manuelle, non surveillée.
            {etat && <> État calculé le {fmtDate(etat.genere_le)}, actualisé chaque minute.</>}
          </p>
        </header>

        {erreur && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erreur}</div>}

        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-2">
            {/* Sources */}
            <Bande titre="Sources" sousTitre="mode · fréquence" fond="bg-slate-100 border-slate-200" titreCouleur="text-slate-800">
              <div className="flex items-start justify-around gap-1">{parCouche.source.map((f) => brique(f, { bas: true }))}</div>
              <Bus />
            </Bande>

            {/* Supabase */}
            <Bande titre="Supabase" sousTitre="base de données · Paris" fond="bg-emerald-50 border-emerald-200" titreCouleur="text-emerald-800">
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Données de base</div>
              <div className="flex items-start justify-around gap-1">{parCouche.base.map((f) => brique(f, { haut: true, bas: true }))}</div>
              <Bus couleur="bg-emerald-300" />
              <div className="my-2 flex flex-wrap justify-around gap-2">
                {RYTHMES.map((r) => (
                  <span key={r} className="whitespace-nowrap rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-800">
                    {r}
                  </span>
                ))}
              </div>
              <Bus couleur="bg-emerald-300" />
              <div className="mt-1 text-xs font-bold uppercase tracking-wide text-emerald-700">Tables, vues et données calculées</div>
              <div className="flex items-start justify-around gap-1">{parCouche.calcule.map((f) => brique(f, { haut: true, bas: true }))}</div>
              <Bus couleur="bg-emerald-300" />
            </Bande>

            {/* Vercel */}
            <Bande titre="Vercel" sousTitre="site et blocs du compagnon" fond="bg-blue-50 border-blue-200" titreCouleur="text-blue-800">
              <div className="flex items-start justify-around gap-1">
                {blocs.map(({ bloc, lies, statut }) => (
                  <div
                    key={bloc.id}
                    className="flex min-w-0 flex-1 flex-col items-center"
                    onMouseEnter={() => setBlocSurvole(bloc.id)}
                    onMouseLeave={() => setBlocSurvole(null)}
                  >
                    <Fleche />
                    <Link
                      href={bloc.pages[0]?.path ?? '/accueil'}
                      className={`flex w-full max-w-[150px] flex-col items-center rounded-xl px-1.5 py-2 text-center hover:bg-white/70 ${blocSurvole === bloc.id ? 'bg-white ring-2 ring-blue-500' : ''}`}
                    >
                      <span
                        className="relative flex h-12 w-12 items-center justify-center rounded-xl text-2xl shadow-sm"
                        style={{ background: `linear-gradient(${bloc.gradient[0]}, ${bloc.gradient[1]})` }}
                      >
                        <span aria-hidden>{bloc.icon}</span>
                        {lies.length > 0 && (
                          <span className="absolute -right-1 -top-1 rounded-full border-2 border-white">
                            <Pastille statut={statut} taille="h-3 w-3" />
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 text-[13px] font-semibold leading-tight text-slate-900">{bloc.label}</span>
                      <span className="mt-0.5 text-[11px] leading-tight text-slate-500">
                        {bloc.pages.length} écran{bloc.pages.length > 1 ? 's' : ''}
                      </span>
                    </Link>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Survolez un bloc pour voir les données calculées qui l’alimentent ; sa pastille reprend le pire de leurs états.
              </p>
            </Bande>
          </div>

          {/* Détail */}
          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm 2xl:sticky 2xl:top-4">
            {!fluxSelectionne ? (
              <div className="text-sm text-slate-500">
                <div className="mb-2 text-base font-bold text-slate-800">Détail</div>
                Cliquez sur une brique pour voir ses composants : imports, tâches planifiées, tables surveillées, avec leur dernier
                passage et leur message d’erreur éventuel.
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      {fluxSelectionne.couche === 'source' ? 'Source' : fluxSelectionne.couche === 'base' ? 'Données de base' : 'Données calculées'}
                    </div>
                    <div className="mt-0.5 text-xl font-black">
                      <span aria-hidden className="mr-1.5">{fluxSelectionne.icone}</span>
                      {fluxSelectionne.libelle}
                    </div>
                  </div>
                  <button type="button" onClick={() => setSelection(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Fermer">
                    ✕
                  </button>
                </div>
                <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${STATUT[fluxSelectionne.statut].fond}`}>
                  <Pastille statut={fluxSelectionne.statut} />
                  <span className={`font-semibold ${STATUT[fluxSelectionne.statut].texte}`}>{STATUT[fluxSelectionne.statut].libelle}</span>
                  <span className="text-slate-500">· {fmtDate(fluxSelectionne.derniere_maj_recente)}</span>
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  {fluxSelectionne.mode && (
                    <div><dt className="inline text-slate-500">Mode : </dt><dd className="inline">{fluxSelectionne.mode}</dd></div>
                  )}
                  {fluxSelectionne.frequence && (
                    <div><dt className="inline text-slate-500">Fréquence : </dt><dd className="inline">{fluxSelectionne.frequence}</dd></div>
                  )}
                  {fluxSelectionne.volume != null && (
                    <div>
                      <dt className="inline text-slate-500">Volume : </dt>
                      <dd className="inline tabular-nums">
                        ≈ {fmtVolume.format(fluxSelectionne.volume)} lignes
                        {fluxSelectionne.nb_tables && fluxSelectionne.nb_tables > 1 ? ` sur ${fluxSelectionne.nb_tables} tables` : ''}
                      </dd>
                    </div>
                  )}
                  {fluxSelectionne.description && <div className="text-slate-600">{fluxSelectionne.description}</div>}
                </dl>
                {fluxSelectionne.lien && (
                  <Link href={fluxSelectionne.lien} className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline">
                    Ouvrir l’écran lié →
                  </Link>
                )}

                <div className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Composants surveillés ({fluxSelectionne.details.length})
                </div>
                {fluxSelectionne.details.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">Aucun : alimentation en temps réel ou manuelle.</p>
                )}
                <ul className="mt-2 space-y-2">
                  {fluxSelectionne.details
                    .slice()
                    .sort((a, b) => STATUT[b.statut].rang - STATUT[a.statut].rang)
                    .map((d, i) => (
                      <li key={`${d.nom}-${i}`} className="rounded-xl border border-slate-200 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Pastille statut={d.statut} />
                          <span className="min-w-0 flex-1 truncate font-semibold" title={d.nom}>{d.nom}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {TYPE_LIBELLE[d.type]}
                          {d.planification && <> · <code className="font-mono">{d.planification}</code> (UTC)</>}
                        </div>
                        <div className="mt-1 text-xs text-slate-700">
                          Dernière réussite : {fmtDate(d.derniere_maj)} ({fmtRelatif(d.derniere_maj, maintenant)})
                          {d.duree_s != null && <> · {d.duree_s.toLocaleString('fr-FR')} s</>}
                        </div>
                        {d.attendu_depuis && d.statut !== 'ok' && (
                          <div className="text-xs text-amber-700">Passage attendu depuis {fmtDate(d.attendu_depuis)}</div>
                        )}
                        {d.passages_24h != null && (
                          <div className="text-xs text-slate-500">
                            24 h : {d.passages_24h} passage{d.passages_24h > 1 ? 's' : ''}
                            {d.echecs_24h ? <span className="text-red-600">, {d.echecs_24h} en échec</span> : null}
                          </div>
                        )}
                        {d.prochain_passage && <div className="text-xs text-slate-500">Prochain passage : {fmtDate(d.prochain_passage)}</div>}
                        {d.lignes != null && <div className="text-xs text-slate-500">{fmtVolume.format(d.lignes)} lignes dans le lot</div>}
                        {d.message && (
                          <div className={`mt-1 break-words rounded-lg px-2 py-1 text-xs ${d.statut === 'ok' || d.statut === 'non_suivi' ? 'bg-slate-50 text-slate-600' : 'bg-red-50 text-red-700'}`}>
                            {d.message}
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
