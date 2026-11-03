'use client'

/**
 * Écran « Contrats d'objectifs » (bloc « Mes agences / Mes commerciaux »,
 * /objectifs/contrats). Créé le 03/11/2026, demandé par Arnaud.
 *
 * Reprend les onglets Excel « un onglet par commercial » :
 *   - liste des contrats de l'année (direction / périmètre Suivi agences) ;
 *   - fiche individuelle (?code=AAMENA) dans la mise en forme du classeur :
 *     objectif CA HT, marge N-1 et avance mensuelle, tableau mensuel /
 *     trimestriel CA – marge – commission – déjà versé, solde de la prime
 *     au 31/12, primes annuelles (paliers CA perso / agence, qualitatives,
 *     avenant, avril N+1) avec leur état à date et en projection ;
 *   - import en masse du classeur (?import=1) : lecture de chaque onglet,
 *     rapprochement automatique du collaborateur (CA mensuels identiques,
 *     sinon nom de l'onglet), contrôle Excel ↔ compagnon, publication.
 *
 * Droits (fixés par Arnaud le 03/11/2026) : le commercial voit sa fiche sans
 * la modifier ; la direction (Jean-Marc L., Stéphane C. — table
 * obj_contrat_editeurs) et les administrateurs modifient et évaluent.
 * Contrôlés côté base (obj_peut_lire / obj_peut_modifier) —
 * migration supabase/migrations/20261103_contrats_objectifs.sql.
 * Marge PV ignorée pour l'instant. Réalisé = indicateur_factures_mensuel
 * (hors statistique exclus), commission calculée sur les mois clos.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  INDICATEUR_LIBELLES,
  MOIS,
  RESULTAT_LIBELLES,
  SECTION_LIBELLES,
  TRIMESTRES,
  apparier,
  avanceTheorique,
  calculerContrat,
  etatPrime,
  fmt0,
  fmt2,
  fmtE,
  fmtK,
  fmtPct,
  lireClasseur,
  montantMax,
  type CollabRef,
  type FicheContrat,
  type Indicateur,
  type LigneListe,
  type OngletLu,
  type Prime,
  type Resultat,
  type Section,
} from '@/lib/contratsObjectifs'

type Droits = { modifier: boolean; mon_code: string | null; suivi: boolean }

const ANNEE_COURANTE = new Date().getFullYear()

export default function ContratsObjectifsWrapper() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Chargement…</div>}>
      <ContratsObjectifsPage />
    </Suspense>
  )
}

function ContratsObjectifsPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const annee = Number(sp.get('annee')) || ANNEE_COURANTE
  const code = (sp.get('code') || '').toUpperCase()
  const vueImport = sp.get('import') === '1'
  const [droits, setDroits] = useState<Droits | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const go = useCallback(
    (params: Record<string, string | number | null>) => {
      const u = new URLSearchParams()
      const merged: Record<string, string | number | null> = { annee, ...params }
      for (const [k, v] of Object.entries(merged)) if (v != null && v !== '') u.set(k, String(v))
      router.push(`/objectifs/contrats?${u.toString()}`)
    },
    [annee, router],
  )

  useEffect(() => {
    supabase.rpc('get_obj_droits').then(({ data, error }) => {
      if (error) setErreur(error.message)
      else setDroits(data as Droits)
    })
  }, [])

  // Un commercial sans droit de pilotage arrive directement sur sa fiche
  useEffect(() => {
    if (!droits || code || vueImport) return
    if (!droits.modifier && !droits.suivi && droits.mon_code) go({ code: droits.mon_code })
  }, [droits, code, vueImport, go])

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16 print:bg-white">
      <header className="border-b border-[color:var(--cg-hdr-border)] bg-[color:var(--cg-hdr-bg)] print:hidden">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-end justify-between gap-4 px-4 py-4 md:px-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Mes agences / Mes commerciaux</div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight text-[color:var(--cg-hdr-ink)] md:text-[28px]">Contrats d’objectifs {annee}</h1>
            <p className="mt-1 text-[12px] text-[color:var(--cg-hdr-muted)]">
              Objectifs signés, commission sur marge, avances et primes annuelles · réalisé = CA facturé hors statistique, mois clos
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={annee}
              onChange={(e) => go({ annee: Number(e.target.value), code: code || null, import: vueImport ? 1 : null })}
              className="h-9 cursor-pointer rounded-lg border border-[color:var(--cg-hdr-line)] bg-[color:var(--cg-hdr-field)] px-2.5 text-sm font-semibold text-[color:var(--cg-hdr-ink)] outline-none focus:border-[#B4761A]"
              aria-label="Année"
            >
              {[ANNEE_COURANTE - 1, ANNEE_COURANTE, ANNEE_COURANTE + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {(code || vueImport) && (droits?.modifier || droits?.suivi) && (
              <button onClick={() => go({})} className={btnHdr}>
                ← Liste des contrats
              </button>
            )}
            {droits?.modifier && !vueImport && (
              <button onClick={() => go({ import: 1 })} className={btnHdr}>
                ⬆ Importer le classeur
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-8">
        {erreur && <Alerte texte={erreur} />}
        {!droits && !erreur && <div className="p-6 text-sm text-slate-500">Chargement…</div>}
        {droits && code && <Fiche annee={annee} code={code} droits={droits} />}
        {droits && !code && vueImport && droits.modifier && <ImportClasseur annee={annee} onOuvrir={(c) => go({ code: c })} />}
        {droits && !code && !vueImport && (droits.modifier || droits.suivi) && (
          <Liste annee={annee} droits={droits} onOuvrir={(c) => go({ code: c })} />
        )}
        {droits && !code && !vueImport && !droits.modifier && !droits.suivi && !droits.mon_code && (
          <Alerte texte="Aucun contrat d’objectifs n’est rattaché à votre compte (code collaborateur absent de votre fiche utilisateur)." />
        )}
      </main>
    </div>
  )
}

const btnHdr =
  'flex h-9 items-center rounded-lg border border-[color:var(--cg-hdr-line)] px-3 text-sm font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A] hover:text-[color:var(--cg-hdr-ink)]'
const btn = 'rounded-lg border border-[#D5D1C7] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#0B1220] hover:border-[#B4761A]'
const btnPrim = 'rounded-lg bg-[#0B1220] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1E2833] disabled:opacity-40'
const inp = 'h-8 rounded-md border border-[#D5D1C7] bg-white px-2 text-[13px] outline-none focus:border-[#B4761A]'

function Alerte({ texte, ton = 'rouge' }: { texte: string; ton?: 'rouge' | 'info' }) {
  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 text-[13px] ${
        ton === 'rouge' ? 'border-[#E8B4A0] bg-[#FBEDE7] text-[#8A3A1C]' : 'border-[#C9D6DE] bg-[#EEF4F7] text-[#18465A]'
      }`}
    >
      {texte}
    </div>
  )
}

// ============================================================================
// Liste des contrats
// ============================================================================
function Liste({ annee, droits, onOuvrir }: { annee: number; droits: Droits; onOuvrir: (code: string) => void }) {
  const [data, setData] = useState<{ mois_clos: number; rows: LigneListe[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refs, setRefs] = useState<CollabRef[] | null>(null)
  const [nouveau, setNouveau] = useState('')

  useEffect(() => {
    setData(null)
    supabase.rpc('get_obj_contrats_liste', { p_annee: annee }).then(({ data, error }) => {
      if (error) setErr(error.message)
      else setData(data as { mois_clos: number; rows: LigneListe[] })
    })
    if (droits.modifier)
      supabase.rpc('get_obj_import_reference', { p_annee: annee }).then(({ data }) => {
        setRefs(((data as { collaborateurs: CollabRef[] } | null)?.collaborateurs || []).filter((c) => !c.sommeil))
      })
  }, [annee, droits.modifier])

  if (err) return <Alerte texte={err} />
  if (!data) return <div className="p-6 text-sm text-slate-500">Chargement des contrats…</div>
  const mc = data.mois_clos
  const tot = data.rows.reduce(
    (s, r) => {
      s.obj += r.objectif_caht || 0
      s.ca += r.ca
      s.com += r.marge * r.taux_commission
      s.av += r.avance_mensuelle * mc
      return s
    },
    { obj: 0, ca: 0, com: 0, av: 0 },
  )

  return (
    <div className="space-y-4">
      {droits.modifier && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E2DFD8] bg-white px-4 py-3">
          <span className="text-[13px] font-semibold text-[#0B1220]">Nouveau contrat :</span>
          <select value={nouveau} onChange={(e) => setNouveau(e.target.value)} className={inp}>
            <option value="">— choisir un collaborateur —</option>
            {(refs || [])
              .filter((r) => !data.rows.some((x) => x.code === r.code))
              .map((r) => (
                <option key={r.code} value={r.code}>
                  {r.nom} · {r.agence || 'sans agence'}
                </option>
              ))}
          </select>
          <button disabled={!nouveau} className={btnPrim} onClick={() => onOuvrir(nouveau)}>
            Créer
          </button>
          <span className="ml-auto text-[12px] text-slate-500">ou importez le classeur (un onglet par commercial) avec le bouton du bandeau</span>
        </div>
      )}

      {data.rows.length === 0 ? (
        <Alerte ton="info" texte={`Aucun contrat d’objectifs ${annee} dans votre périmètre.`} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2DFD8] bg-white">
          <table className="w-full min-w-[1000px] text-[13px]">
            <thead className="bg-[#111820] text-left text-[11px] uppercase tracking-[0.08em] text-[#C9C4B8]">
              <tr>
                <th className="px-3 py-2.5">Collaborateur</th>
                <th className="px-3 py-2.5">Agence</th>
                <th className="px-3 py-2.5 text-right">Objectif CA HT</th>
                <th className="px-3 py-2.5 text-right">CA à fin {MOIS[mc]?.toLowerCase() || '—'}</th>
                <th className="px-3 py-2.5 text-right">vs N-1</th>
                <th className="px-3 py-2.5">Avancement</th>
                <th className="px-3 py-2.5 text-right">Marge</th>
                <th className="px-3 py-2.5 text-right">Commission acquise</th>
                <th className="px-3 py-2.5 text-right">Avances versées</th>
                <th className="px-3 py-2.5 text-right">Solde</th>
                <th className="px-3 py-2.5 text-center">Primes à évaluer</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const com = r.marge * r.taux_commission
                const av = r.avance_mensuelle * mc
                const pct = r.objectif_caht ? r.ca / r.objectif_caht : null
                const evol = r.ca_n1_a_date ? r.ca / r.ca_n1_a_date - 1 : null
                return (
                  <tr key={r.id} onClick={() => onOuvrir(r.code)} className="cursor-pointer border-t border-[#EEEBE4] hover:bg-[#FBF7EE]">
                    <td className="px-3 py-2 font-semibold text-[#0B1220]">
                      {r.nom}
                      {r.statut === 'brouillon' && <span className="ml-2 rounded bg-[#F2E3C7] px-1.5 py-0.5 text-[10px] font-bold text-[#8A5A12]">BROUILLON</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.agence || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtK(r.objectif_caht)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtK(r.ca)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${evol == null ? '' : evol >= 0 ? 'text-[#2F7A4A]' : 'text-[#C1683C]'}`}>
                      {evol == null ? '—' : `${evol >= 0 ? '+' : ''}${fmtPct(evol)}`}
                    </td>
                    <td className="px-3 py-2">
                      <Jauge pct={pct} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtK(r.marge)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtE(com)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtE(av)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${com - av >= 0 ? 'text-[#2F7A4A]' : 'text-[#C1683C]'}`}>{fmtE(com - av)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.nb_a_evaluer > 0 ? (
                        <span className="rounded-full bg-[#F2E3C7] px-2 py-0.5 text-[11px] font-bold text-[#8A5A12]">{r.nb_a_evaluer}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#0B1220] bg-[#F7F5F0] font-bold">
                <td className="px-3 py-2" colSpan={2}>
                  Total ({data.rows.length} contrats)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtK(tot.obj)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtK(tot.ca)}</td>
                <td />
                <td className="px-3 py-2">
                  <Jauge pct={tot.obj ? tot.ca / tot.obj : null} />
                </td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{fmtE(tot.com)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtE(tot.av)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtE(tot.com - tot.av)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Avances versées = avance mensuelle × mois clos (hors versements saisis sur la fiche). Commission acquise = marge des mois clos × taux de commission.
      </p>
    </div>
  )
}

function Jauge({ pct, projection }: { pct: number | null; projection?: number | null }) {
  if (pct == null) return <span className="text-slate-400">—</span>
  const w = Math.max(0, Math.min(1, pct)) * 100
  const pw = projection == null ? null : Math.max(0, Math.min(1.2, projection)) / 1.2
  return (
    <div className="flex min-w-[130px] items-center gap-2">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#E7E3DA]">
        <div className={`h-full rounded-full ${pct >= 1 ? 'bg-[#2F7A4A]' : 'bg-[#2D6F86]'}`} style={{ width: `${w}%` }} />
        {pw != null && <div className="absolute top-[-2px] h-3 w-[2px] bg-[#B4761A]" style={{ left: `${pw * 100}%` }} />}
      </div>
      <span className="w-12 text-right text-[12px] font-semibold tabular-nums">{fmtPct(pct, 0)}</span>
    </div>
  )
}

// ============================================================================
// Fiche individuelle
// ============================================================================
function Fiche({ annee, code, droits }: { annee: number; code: string; droits: Droits }) {
  const [f, setF] = useState<FicheContrat | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [edition, setEdition] = useState(false)
  const [rev, setRev] = useState(0)

  useEffect(() => {
    setF(null)
    setErr(null)
    supabase.rpc('get_obj_contrat', { p_annee: annee, p_code: code }).then(({ data, error }) => {
      if (error) setErr(error.message)
      else {
        const fiche = data as FicheContrat
        setF(fiche)
        if (!fiche.contrat && fiche.modifier) setEdition(true)
      }
    })
  }, [annee, code, rev])

  const calc = useMemo(() => (f ? calculerContrat(f) : null), [f])

  if (err) return <Alerte texte={err} />
  if (!f || !calc) return <div className="p-6 text-sm text-slate-500">Chargement de la fiche…</div>
  const c = f.contrat
  const modifier = f.modifier && droits.modifier

  return (
    <div className="space-y-5">
      {/* Bandeau fiche */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-[#111820] px-5 py-4 text-white md:px-7">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#B4761A]">Contrat d’objectifs {annee}</div>
          <h2 className="mt-1 text-2xl font-bold">{f.nom}</h2>
          <div className="mt-1 text-[12px] text-[#A9B2BC]">
            {f.code} · agence {f.agence || '—'}
            {c && <> · {c.statut === 'signe' ? 'signé' : c.statut === 'brouillon' ? 'brouillon' : 'validé'}</>}
            {c?.source_onglet && <> · repris de l’onglet « {c.source_onglet} »</>}
            {!modifier && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px]">Consultation</span>}
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-lg border border-white/20 px-3 py-1.5 text-[13px] font-semibold hover:border-[#B4761A]">
            🖨 Imprimer
          </button>
          {modifier && (
            <button onClick={() => setEdition((v) => !v)} className="rounded-lg bg-[#B4761A] px-3 py-1.5 text-[13px] font-semibold hover:bg-[#C98A2A]">
              {edition ? 'Fermer l’édition' : '✎ Modifier le contrat'}
            </button>
          )}
        </div>
      </div>

      {edition && modifier && (
        <EditeurContrat
          fiche={f}
          onSaved={() => {
            setEdition(false)
            setRev((x) => x + 1)
          }}
        />
      )}

      {!c ? (
        !modifier && <Alerte ton="info" texte={`Pas de contrat d’objectifs ${annee} enregistré pour ${f.nom}.`} />
      ) : (
        <>
          {/* Bandeau objectif / avance (couleurs du classeur) */}
          <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
            <div className="rounded-xl border border-[#C9D2A2] bg-[#E3E9C8] px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[13px] font-bold text-[#3D4A12]">Objectif CA HT</div>
                <div className="text-[22px] font-bold tabular-nums text-[#2C360B]">{fmtE(c.objectif_caht)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-[#3D4A12]">
                <span>
                  Réalisé à fin {MOIS[f.mois_clos]?.toLowerCase() || '—'} : <b className="tabular-nums">{fmtE(calc.caTotal)}</b>
                </span>
                <span>
                  Projection fin d’année : <b className="tabular-nums">{fmtK(calc.caProjete)}</b>
                </span>
              </div>
              <div className="mt-2">
                <Jauge
                  pct={c.objectif_caht ? calc.caTotal / c.objectif_caht : null}
                  projection={c.objectif_caht && calc.caProjete != null ? calc.caProjete / c.objectif_caht : null}
                />
              </div>
              <div className="mt-1 text-[11px] text-[#5B6630]">Le trait doré marque la projection (répartition mensuelle du bilan {annee}).</div>
            </div>
            <div className="rounded-xl border border-[#BFD5DF] bg-[#DCEAF0] px-5 py-4 text-[#18465A]">
              <div className="text-[13px] font-bold">
                Avance mensuelle {fmt0((c.taux_base || 0) * 100)} % de la marge N-1 avec régul en décembre
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Kpi libelle={`Marge ${annee - 1}`} valeur={fmt0(c.marge_n1)} />
                <Kpi libelle={`Base ${fmt0((c.taux_base || 0) * 100)} %`} valeur={fmt0((c.marge_n1 || 0) * c.taux_base)} />
                <Kpi libelle={`Avance ${fmt2((c.taux_commission || 0) * 100).replace(',00', '')} %`} valeur={fmt0(c.avance_mensuelle)} fort />
              </div>
              {c.avance_mensuelle_saisie != null && <div className="mt-2 text-[11px]">Avance saisie manuellement (calcul : {fmt0(avanceTheorique(c.marge_n1, c.taux_base, c.taux_commission))}).</div>}
            </div>
          </div>

          {/* Tableau 1 : prime trimestrielle liée à la marge */}
          <Bloc numero={1} titre="Prime trimestrielle liée à la marge dégagée">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-[12px] font-bold text-[#0B1220]">
                    <th className="w-[180px]" />
                    <th className="border-2 border-[#0B1220] px-3 py-1.5 text-center">CA HT réalisé</th>
                    <th className="border-2 border-[#0B1220] px-3 py-1.5 text-center">Marge dégagée</th>
                    <th className="w-3" />
                    <th className="border border-[#9CB8C6] px-3 py-1.5 text-center text-[#2D6F86]">Commission {fmt2(c.taux_commission * 100).replace(',00', '')} %</th>
                    <th className="w-3" />
                    <th className="border border-[#9C9A92] px-3 py-1.5 text-center">Total commission</th>
                    <th className="border border-[#9C9A92] px-3 py-1.5 text-center text-slate-500">Déjà versé</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.trimestres.map((t) => (
                    <TrimestreRows key={t.t} t={t} />
                  ))}
                  <tr className="text-[13px] font-bold">
                    <td className="px-3 py-2 text-center text-[12px] uppercase">Total général</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt2(calc.caTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt2(calc.margeTotal)}</td>
                    <td />
                    <td className="px-3 py-2 text-right tabular-nums text-[#2D6F86]">{fmt2(calc.commissionAcquise)}</td>
                    <td />
                    <td className="px-3 py-2 text-right tabular-nums">{fmtE(calc.commissionAcquise)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtE(calc.avancesAnnee)}</td>
                  </tr>
                  <tr>
                    <td />
                    <td />
                    <td className="px-3 text-right text-[12px] font-semibold text-[#2D6F86] tabular-nums">{calc.tauxMarge == null ? '' : fmt2(calc.tauxMarge * 100) + ' %'}</td>
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Mois en italique = en cours, non pris dans la commission. « Déjà versé » des mois à venir = avance prévue.
            </div>
          </Bloc>

          {/* Solde de la prime */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-[#D9D5EA] bg-[#ECEAF4] px-5 py-4">
              <div className="text-[13px] font-bold text-[#3A3360]">Prime à verser au 31/12/{annee} — situation à date</div>
              <Ligne libelle="Commission acquise (mois clos)" valeur={fmtE(calc.commissionAcquise)} />
              <Ligne libelle={`Avances versées (${f.mois_clos} mois)`} valeur={fmtE(-calc.avancesADate)} />
              <div className="mt-2 flex items-center justify-between rounded-md bg-[#FFF35C] px-3 py-1.5 font-bold text-[#0B1220]">
                <span>Solde prime {fmt2(c.taux_commission * 100).replace(',00', '')} %</span>
                <span className="tabular-nums">{fmtE(calc.soldeADate)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-[#E2DFD8] bg-white px-5 py-4">
              <div className="text-[13px] font-bold text-[#0B1220]">Projection fin d’année (régul de décembre)</div>
              <Ligne libelle="Commission projetée" valeur={fmtE(calc.commissionProjetee)} />
              <Ligne libelle="Avances de l’année (12 mois)" valeur={fmtE(-calc.avancesAnnee)} />
              <div
                className={`mt-2 flex items-center justify-between rounded-md px-3 py-1.5 font-bold ${
                  (calc.soldeProjete || 0) >= 0 ? 'bg-[#E3F1E7] text-[#1F5A35]' : 'bg-[#FBEDE7] text-[#8A3A1C]'
                }`}
              >
                <span>Régul projetée</span>
                <span className="tabular-nums">{fmtE(calc.soldeProjete)}</span>
              </div>
              {calc.autresVersements !== 0 && <div className="mt-1 text-[11px] text-slate-500">Autres versements saisis (régul, primes) : {fmtE(calc.autresVersements)}</div>}
            </div>
          </div>

          {/* Primes annuelles */}
          <PrimesAnnuelles fiche={f} calc={calc} modifier={modifier} onChange={() => setRev((x) => x + 1)} />

          {/* Versements */}
          <Versements fiche={f} modifier={modifier} onChange={() => setRev((x) => x + 1)} />

          {c.commentaire && (
            <div className="rounded-xl border border-[#E2DFD8] bg-white px-5 py-3 text-[13px] text-slate-700">
              <b>Commentaire :</b> {c.commentaire}
            </div>
          )}
          <div className="text-[11px] text-slate-500">
            Mis à jour le {new Date(c.updated_at).toLocaleString('fr-FR')} {c.updated_by ? `par ${c.updated_by}` : ''}. Marge PV non distinguée.
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ libelle, valeur, fort }: { libelle: string; valeur: string; fort?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold">{libelle}</div>
      <div className={`tabular-nums ${fort ? 'text-[20px] font-bold' : 'text-[16px] font-semibold'}`}>{valeur}</div>
    </div>
  )
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="mt-2 flex items-center justify-between text-[13px]">
      <span>{libelle}</span>
      <span className="font-semibold tabular-nums">{valeur}</span>
    </div>
  )
}

function Bloc({ numero, titre, children, droite }: { numero: number; titre: string; children: React.ReactNode; droite?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#E2DFD8] bg-white px-4 py-4 md:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0B1220] text-[12px] font-bold text-white">{numero}</span>
          <h3 className="text-[14px] font-bold text-[#0B1220]">{titre}</h3>
        </div>
        {droite}
      </div>
      {children}
    </section>
  )
}

function TrimestreRows({ t }: { t: ReturnType<typeof calculerContrat>['trimestres'][number] }) {
  return (
    <>
      {t.mois.map((m) => (
        <tr key={m.mois} className={m.enCours ? 'italic text-slate-400' : ''}>
          <td className="border-x-2 border-[#0B1220] px-3 py-1 text-center">{MOIS[m.mois]}</td>
          <td className="border-r-2 border-[#0B1220] border-b border-b-[#E2DFD8] px-3 py-1 text-right tabular-nums">{m.ca == null ? '-' : fmt2(m.ca)}</td>
          <td className="border-r-2 border-[#0B1220] border-b border-b-[#E2DFD8] px-3 py-1 text-right tabular-nums">{m.marge == null ? '-' : fmt2(m.marge)}</td>
          <td />
          <td />
          <td />
          <td />
          <td className={`px-3 py-1 text-right tabular-nums ${m.avanceVersee ? 'text-slate-600' : 'text-slate-400'}`}>{fmt0(m.avance)}</td>
        </tr>
      ))}
      <tr className="font-bold">
        <td className="border-2 border-[#0B1220] px-3 py-1.5 text-center">{TRIMESTRES[t.t - 1]}</td>
        <td className="border-2 border-[#0B1220] px-3 py-1.5 text-right tabular-nums">{t.ca ? fmt2(t.ca) : '-'}</td>
        <td className="border-2 border-[#0B1220] px-3 py-1.5 text-right tabular-nums">{t.marge ? fmt2(t.marge) : '-'}</td>
        <td />
        <td className="border border-[#9CB8C6] px-3 py-1.5 text-right font-normal tabular-nums text-[#2D6F86]">
          {fmt2(t.commission)}
          {!t.complet && t.marge > 0 && <span className="ml-1 text-[10px]">(partiel)</span>}
        </td>
        <td />
        <td className="border border-[#9C9A92] px-3 py-1.5 text-right tabular-nums">{fmtE(t.commission)}</td>
        <td className="border border-[#9C9A92] px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtE(t.avances)}</td>
      </tr>
    </>
  )
}

// ----------------------------------------------------------------------------
// Primes annuelles
// ----------------------------------------------------------------------------
const PASTILLE: Record<string, string> = {
  vert: 'bg-[#2F7A4A]',
  orange: 'bg-[#D99A2B]',
  rouge: 'bg-[#C1683C]',
  gris: 'bg-[#A8A49A]',
}

function PrimesAnnuelles({ fiche, calc, modifier, onChange }: { fiche: FicheContrat; calc: ReturnType<typeof calculerContrat>; modifier: boolean; onChange: () => void }) {
  const [evalId, setEvalId] = useState<string | null>(null)
  const etats = fiche.primes.map((p) => ({ p, e: etatPrime(p, fiche, calc) }))
  const totMax = etats.reduce((s, x) => s + x.e.montantMax, 0)
  const totADate = etats.reduce((s, x) => s + x.e.montantADate, 0)
  const totProj = etats.reduce((s, x) => s + x.e.montantProjete, 0)
  const sections: Section[] = ['ca_perso', 'ca_agence', 'qualitatif', 'avenant', 'avril_n1']

  return (
    <Bloc
      numero={2}
      titre="Primes annuelles"
      droite={
        <div className="flex flex-wrap gap-3 text-[12px]">
          <span>
            Maximum <b className="tabular-nums">{fmtE(totMax)}</b>
          </span>
          <span>
            Acquis à date <b className="tabular-nums">{fmtE(totADate)}</b>
          </span>
          <span className="rounded bg-[#F2E3C7] px-2 py-0.5 text-[#8A5A12]">
            Probable <b className="tabular-nums">{fmtE(totProj)}</b>
          </span>
        </div>
      }
    >
      {fiche.primes.length === 0 && <div className="text-[13px] text-slate-500">Aucune prime annuelle dans ce contrat.</div>}
      <div className="space-y-4">
        {sections
          .filter((s) => etats.some((x) => x.p.section === s))
          .map((s) => (
            <div key={s}>
              <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[#7A5E2A]">{SECTION_LIBELLES[s]}</div>
              <div className="grid gap-2 md:grid-cols-2">
                {etats
                  .filter((x) => x.p.section === s)
                  .map(({ p, e }) => (
                    <div key={p.id} className="rounded-lg border border-[#E2DFD8] bg-[#FBFAF7] px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-[13px] font-bold text-[#0B1220]">
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${PASTILLE[e.statut]}`} />
                            {p.libelle}
                          </div>
                          {p.description && <div className="mt-0.5 text-[12px] text-slate-600">{p.description}</div>}
                        </div>
                        <div className="text-right">
                          <div className="text-[15px] font-bold tabular-nums">{fmtE(e.montantProjete)}</div>
                          <div className="text-[11px] text-slate-500">sur {fmtE(e.montantMax)}</div>
                        </div>
                      </div>

                      {p.mode === 'paliers' && (
                        <PaliersBar paliers={p.paliers} valeur={e.valeur} projection={e.projection} />
                      )}
                      {e.texte && <div className="mt-1.5 text-[12px] text-slate-600">{e.texte}</div>}

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>
                          {INDICATEUR_LIBELLES[p.indicateur]} · versée {p.echeance === '31/12' ? 'au 31/12' : `en avril ${fiche.annee + 1}`}
                        </span>
                        {e.evaluee ? (
                          <span className="font-semibold text-[#0B1220]">
                            {RESULTAT_LIBELLES[p.resultat as Resultat]} · {fmtE(p.montant_retenu)}
                            {p.evalue_le && ` · ${new Date(p.evalue_le).toLocaleDateString('fr-FR')}`}
                          </span>
                        ) : (
                          (p.indicateur === 'manuel' || p.indicateur === 'cerfa_complet') && <span className="font-semibold text-[#8A5A12]">À évaluer par la direction</span>
                        )}
                      </div>
                      {p.commentaire_evaluation && <div className="mt-1 text-[12px] italic text-slate-600">« {p.commentaire_evaluation} »</div>}

                      {modifier && (
                        <div className="mt-2 print:hidden">
                          {evalId === p.id ? (
                            <EvaluationForm prime={p} onDone={() => { setEvalId(null); onChange() }} onCancel={() => setEvalId(null)} />
                          ) : (
                            <button className="text-[12px] font-semibold text-[#2D6F86] hover:underline" onClick={() => setEvalId(p.id || null)}>
                              {e.evaluee ? 'Modifier l’évaluation' : 'Évaluer'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
      </div>
      <div className="mt-3 text-[11px] text-slate-500">
        Primes à paliers et zéro impayé : calculées automatiquement (à date et en projection) tant que la direction ne les a pas évaluées ; l’évaluation de la direction prime.
      </div>
    </Bloc>
  )
}

function PaliersBar({ paliers, valeur, projection }: { paliers: Prime['paliers']; valeur: number | null; projection: number | null }) {
  const max = Math.max(...paliers.map((p) => p.seuil), valeur || 0, projection || 0) * 1.05 || 1
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="mt-3">
      <div className="relative h-2.5 rounded-full bg-[#E7E3DA]">
        {valeur != null && <div className="absolute left-0 top-0 h-full rounded-full bg-[#2D6F86]" style={{ width: pos(valeur) }} />}
        {projection != null && <div className="absolute top-[-3px] h-4 w-[2px] bg-[#B4761A]" style={{ left: pos(projection) }} title="Projection" />}
        {paliers.map((p, i) => (
          <div key={i} className="absolute top-[-4px] h-[18px] w-[2px] bg-[#0B1220]" style={{ left: pos(p.seuil) }} />
        ))}
      </div>
      <div className="relative mt-1 h-8 text-[10px] text-slate-600">
        {paliers.map((p, i) => (
          <div key={i} className="absolute -translate-x-1/2 text-center leading-tight" style={{ left: pos(p.seuil) }}>
            <div className="font-semibold">{fmtK(p.seuil)}</div>
            <div>{fmtE(p.montant)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EvaluationForm({ prime, onDone, onCancel }: { prime: Prime; onDone: () => void; onCancel: () => void }) {
  const [res, setRes] = useState<Resultat>(prime.resultat && prime.resultat !== 'a_evaluer' ? prime.resultat : 'atteint')
  const [montant, setMontant] = useState<string>(String(prime.montant_retenu ?? montantMax(prime)))
  const [com, setCom] = useState(prime.commentaire_evaluation || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async (r: Resultat) => {
    setBusy(true)
    const { error } = await supabase.rpc('evaluer_obj_prime', {
      p_id: prime.id,
      p_resultat: r,
      p_montant_retenu: r === 'a_evaluer' ? null : Number(montant.replace(',', '.')) || 0,
      p_commentaire: com,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else onDone()
  }
  return (
    <div className="rounded-md border border-[#D5D1C7] bg-white p-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={res}
          onChange={(e) => {
            const v = e.target.value as Resultat
            setRes(v)
            if (v === 'atteint') setMontant(String(montantMax(prime)))
            if (v === 'non_atteint') setMontant('0')
          }}
          className={inp}
        >
          <option value="atteint">Atteint</option>
          <option value="partiel">Partiel</option>
          <option value="non_atteint">Non atteint</option>
        </select>
        <input value={montant} onChange={(e) => setMontant(e.target.value)} className={`${inp} w-24 text-right`} aria-label="Montant retenu" />
        <span className="text-[12px]">€</span>
      </div>
      <textarea value={com} onChange={(e) => setCom(e.target.value)} placeholder="Commentaire (visible par le commercial)" className="mt-2 w-full rounded-md border border-[#D5D1C7] p-2 text-[12px]" rows={2} />
      {err && <div className="text-[12px] text-[#8A3A1C]">{err}</div>}
      <div className="mt-1 flex flex-wrap gap-2">
        <button disabled={busy} className={btnPrim} onClick={() => save(res)}>
          Enregistrer
        </button>
        {prime.resultat && prime.resultat !== 'a_evaluer' && (
          <button disabled={busy} className={btn} onClick={() => save('a_evaluer')}>
            Remettre « à évaluer »
          </button>
        )}
        <button className={btn} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Versements (avances réellement versées, régul, primes)
// ----------------------------------------------------------------------------
function Versements({ fiche, modifier, onChange }: { fiche: FicheContrat; modifier: boolean; onChange: () => void }) {
  const [mois, setMois] = useState(fiche.mois_clos || 1)
  const [nature, setNature] = useState<'avance' | 'regularisation' | 'prime' | 'autre'>('avance')
  const [montant, setMontant] = useState('')
  const [com, setCom] = useState('')
  const [err, setErr] = useState<string | null>(null)
  if (!modifier && fiche.versements.length === 0) return null
  const ajouter = async () => {
    const { error } = await supabase.rpc('save_obj_versement', {
      p_contrat_id: fiche.contrat!.id,
      p_mois: mois,
      p_nature: nature,
      p_montant: Number(montant.replace(',', '.')),
      p_date: null,
      p_commentaire: com,
    })
    if (error) setErr(error.message)
    else {
      setMontant('')
      setCom('')
      onChange()
    }
  }
  const supprimer = async (id: string) => {
    const { error } = await supabase.rpc('delete_obj_versement', { p_id: id })
    if (error) setErr(error.message)
    else onChange()
  }
  return (
    <Bloc numero={3} titre="Versements enregistrés">
      <div className="text-[12px] text-slate-500">
        Par défaut, chaque mois l’avance théorique est considérée comme versée. Saisir une avance pour un mois remplace l’avance théorique de ce mois.
      </div>
      {fiche.versements.length > 0 && (
        <table className="mt-2 w-full text-[13px]">
          <tbody>
            {fiche.versements.map((v) => (
              <tr key={v.id} className="border-t border-[#EEEBE4]">
                <td className="py-1.5">{MOIS[v.mois]}</td>
                <td>{v.nature === 'avance' ? 'Avance' : v.nature === 'regularisation' ? 'Régularisation' : v.nature === 'prime' ? 'Prime' : 'Autre'}</td>
                <td className="text-right tabular-nums">{fmtE(v.montant)}</td>
                <td className="pl-3 text-slate-500">{v.commentaire}</td>
                <td className="text-right print:hidden">
                  {modifier && (
                    <button className="text-[12px] text-[#C1683C] hover:underline" onClick={() => supprimer(v.id)}>
                      Supprimer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modifier && (
        <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
          <select value={mois} onChange={(e) => setMois(Number(e.target.value))} className={inp}>
            {MOIS.slice(1).map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select value={nature} onChange={(e) => setNature(e.target.value as typeof nature)} className={inp}>
            <option value="avance">Avance</option>
            <option value="regularisation">Régularisation</option>
            <option value="prime">Prime</option>
            <option value="autre">Autre</option>
          </select>
          <input value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="Montant €" className={`${inp} w-28 text-right`} />
          <input value={com} onChange={(e) => setCom(e.target.value)} placeholder="Commentaire" className={`${inp} w-64`} />
          <button className={btnPrim} disabled={!montant || !Number.isFinite(Number(montant.replace(',', '.')))} onClick={ajouter}>
            Ajouter
          </button>
        </div>
      )}
      {err && <div className="mt-2 text-[12px] text-[#8A3A1C]">{err}</div>}
    </Bloc>
  )
}

// ----------------------------------------------------------------------------
// Édition du contrat (direction)
// ----------------------------------------------------------------------------
type PrimeEdit = Prime & { _k: string }

function nouvellePrime(section: Section): PrimeEdit {
  const paliers = section === 'ca_perso' || section === 'ca_agence'
  return {
    _k: Math.random().toString(36).slice(2),
    section,
    libelle: SECTION_LIBELLES[section],
    description: '',
    mode: paliers ? 'paliers' : 'forfait',
    indicateur: section === 'ca_perso' ? 'ca_perso' : section === 'ca_agence' ? 'ca_agence' : 'manuel',
    paliers: paliers ? [{ seuil: 0, montant: 0 }] : [],
    montant: 0,
    echeance: 'avril_n1',
  }
}

function EditeurContrat({ fiche, onSaved }: { fiche: FicheContrat; onSaved: () => void }) {
  const c = fiche.contrat
  const [objectif, setObjectif] = useState(String(c?.objectif_caht ?? ''))
  const [margeN1, setMargeN1] = useState(String(c?.marge_n1 ?? ''))
  const [base, setBase] = useState(String((c?.taux_base ?? 0.08) * 100))
  const [taux, setTaux] = useState(String((c?.taux_commission ?? 0.01) * 100))
  const [avance, setAvance] = useState(c?.avance_mensuelle_saisie != null ? String(c.avance_mensuelle_saisie) : '')
  const [statut, setStatut] = useState(c?.statut || 'valide')
  const [commentaire, setCommentaire] = useState(c?.commentaire || '')
  const [primes, setPrimes] = useState<PrimeEdit[]>(() =>
    (fiche.primes.length
      ? fiche.primes
      : ([
          nouvellePrime('ca_perso'),
          { ...nouvellePrime('avril_n1'), libelle: 'Qualité / Pas d’impayés', indicateur: 'zero_impaye_45j', montant: 1000 },
          { ...nouvellePrime('avril_n1'), libelle: 'Cerfa complet', indicateur: 'cerfa_complet', montant: 500 },
        ] as Prime[])
    ).map((p): PrimeEdit => ({
      ...p,
      _k: p.id || Math.random().toString(36).slice(2),
    })),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const num = (s: string) => {
    const v = Number(String(s).replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(v) && String(s).trim() !== '' ? v : null
  }
  const avCalc = avanceTheorique(num(margeN1), (num(base) || 0) / 100, (num(taux) || 0) / 100)

  const maj = (k: string, patch: Partial<Prime>) => setPrimes((l) => l.map((p) => (p._k === k ? { ...p, ...patch } : p)))
  const deplacer = (k: string, d: number) =>
    setPrimes((l) => {
      const i = l.findIndex((p) => p._k === k)
      const j = i + d
      if (i < 0 || j < 0 || j >= l.length) return l
      const n = [...l]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  const enregistrer = async () => {
    setBusy(true)
    setErr(null)
    const payload = {
      annee: fiche.annee,
      collaborateur_code: fiche.code,
      objectif_caht: num(objectif),
      marge_n1: num(margeN1),
      taux_base: (num(base) ?? 8) / 100,
      taux_commission: (num(taux) ?? 1) / 100,
      avance_mensuelle_saisie: num(avance),
      statut,
      commentaire,
      primes: primes.map(({ _k, ...p }) => ({
        id: p.id || null,
        section: p.section,
        libelle: p.libelle,
        description: p.description,
        mode: p.mode,
        indicateur: p.indicateur,
        paliers: p.mode === 'paliers' ? p.paliers.filter((x) => x.seuil > 0 || x.montant > 0).sort((a, b) => a.seuil - b.seuil) : [],
        montant: p.mode === 'forfait' ? p.montant : 0,
        echeance: p.echeance,
      })),
    }
    const { error } = await supabase.rpc('save_obj_contrat', { p: payload })
    setBusy(false)
    if (error) setErr(error.message)
    else onSaved()
  }

  return (
    <section className="rounded-xl border-2 border-[#B4761A] bg-white px-4 py-4 md:px-5 print:hidden">
      <h3 className="text-[14px] font-bold text-[#0B1220]">{c ? 'Modifier le contrat' : `Nouveau contrat ${fiche.annee}`}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Champ libelle="Objectif CA HT (€)">
          <input value={objectif} onChange={(e) => setObjectif(e.target.value)} className={`${inp} w-full text-right`} />
        </Champ>
        <Champ libelle={`Marge ${fiche.annee - 1} (€)`}>
          <input value={margeN1} onChange={(e) => setMargeN1(e.target.value)} className={`${inp} w-full text-right`} />
        </Champ>
        <Champ libelle="Base avance (% de la marge N-1)">
          <input value={base} onChange={(e) => setBase(e.target.value)} className={`${inp} w-full text-right`} />
        </Champ>
        <Champ libelle="Commission sur marge (%)">
          <input value={taux} onChange={(e) => setTaux(e.target.value)} className={`${inp} w-full text-right`} />
        </Champ>
        <Champ libelle={`Avance mensuelle (vide = calculée : ${fmt0(avCalc)} €)`}>
          <input value={avance} onChange={(e) => setAvance(e.target.value)} placeholder={String(avCalc)} className={`${inp} w-full text-right`} />
        </Champ>
        <Champ libelle="Statut">
          <select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)} className={`${inp} w-full`}>
            <option value="brouillon">Brouillon</option>
            <option value="valide">Validé</option>
            <option value="signe">Signé</option>
          </select>
        </Champ>
        <div className="md:col-span-2">
          <Champ libelle="Commentaire">
            <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} className={`${inp} w-full`} />
          </Champ>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-[#0B1220]">Primes annuelles</h4>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SECTION_LIBELLES) as Section[]).map((s) => (
            <button key={s} className={btn} onClick={() => setPrimes((l) => [...l, nouvellePrime(s)])}>
              + {SECTION_LIBELLES[s].replace('Prime annuelle ', '').replace('Prime ', '')}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {primes.map((p) => (
          <div key={p._k} className="rounded-lg border border-[#E2DFD8] bg-[#FBFAF7] p-3">
            <div className="grid gap-2 md:grid-cols-[180px_1fr_1fr_190px_130px_auto]">
              <select value={p.section} onChange={(e) => maj(p._k, { section: e.target.value as Section })} className={inp}>
                {(Object.keys(SECTION_LIBELLES) as Section[]).map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LIBELLES[s]}
                  </option>
                ))}
              </select>
              <input value={p.libelle} onChange={(e) => maj(p._k, { libelle: e.target.value })} placeholder="Libellé" className={inp} />
              <input value={p.description || ''} onChange={(e) => maj(p._k, { description: e.target.value })} placeholder="Description / condition" className={inp} />
              <select value={p.indicateur} onChange={(e) => maj(p._k, { indicateur: e.target.value as Indicateur })} className={inp}>
                {(Object.keys(INDICATEUR_LIBELLES) as Indicateur[]).map((s) => (
                  <option key={s} value={s}>
                    {INDICATEUR_LIBELLES[s]}
                  </option>
                ))}
              </select>
              <select value={p.echeance} onChange={(e) => maj(p._k, { echeance: e.target.value as Prime['echeance'] })} className={inp}>
                <option value="avril_n1">Avril N+1</option>
                <option value="31/12">Au 31/12</option>
              </select>
              <div className="flex gap-1">
                <button className={btn} onClick={() => deplacer(p._k, -1)} title="Monter">
                  ↑
                </button>
                <button className={btn} onClick={() => deplacer(p._k, 1)} title="Descendre">
                  ↓
                </button>
                <button className={`${btn} text-[#C1683C]`} onClick={() => setPrimes((l) => l.filter((x) => x._k !== p._k))} title="Supprimer">
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
              <label className="flex items-center gap-1">
                <input type="radio" checked={p.mode === 'forfait'} onChange={() => maj(p._k, { mode: 'forfait' })} /> Forfait
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={p.mode === 'paliers'} onChange={() => maj(p._k, { mode: 'paliers', paliers: p.paliers.length ? p.paliers : [{ seuil: 0, montant: 0 }] })} /> Paliers
              </label>
              {p.mode === 'forfait' ? (
                <>
                  <input value={String(p.montant)} onChange={(e) => maj(p._k, { montant: num(e.target.value) ?? 0 })} className={`${inp} w-28 text-right`} />
                  <span>€</span>
                </>
              ) : (
                <>
                  {p.paliers.map((x, i) => (
                    <span key={i} className="flex items-center gap-1 rounded-md border border-[#E2DFD8] bg-white px-1.5 py-1">
                      CA ≥
                      <input
                        value={String(x.seuil / 1000)}
                        onChange={(e) => maj(p._k, { paliers: p.paliers.map((y, j) => (j === i ? { ...y, seuil: (num(e.target.value) ?? 0) * 1000 } : y)) })}
                        className={`${inp} h-7 w-20 text-right`}
                      />
                      k€ →
                      <input
                        value={String(x.montant)}
                        onChange={(e) => maj(p._k, { paliers: p.paliers.map((y, j) => (j === i ? { ...y, montant: num(e.target.value) ?? 0 } : y)) })}
                        className={`${inp} h-7 w-20 text-right`}
                      />
                      €
                      <button className="text-[#C1683C]" onClick={() => maj(p._k, { paliers: p.paliers.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <button className="font-semibold text-[#2D6F86] hover:underline" onClick={() => maj(p._k, { paliers: [...p.paliers, { seuil: 0, montant: 0 }] })}>
                    + palier
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {c && <div className="mt-2 text-[11px] text-slate-500">Une prime supprimée perd son évaluation ; les primes conservées gardent la leur.</div>}
      {err && <Alerte texte={err} />}
      <div className="mt-3 flex gap-2">
        <button className={btnPrim} disabled={busy} onClick={enregistrer}>
          {busy ? 'Enregistrement…' : 'Enregistrer le contrat'}
        </button>
      </div>
    </section>
  )
}

function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-600">{libelle}</span>
      {children}
    </label>
  )
}

// ============================================================================
// Import du classeur
// ============================================================================
type OngletImport = OngletLu & {
  inclure: boolean
  etat: 'a_publier' | 'publie' | 'erreur'
  message?: string
}

function ImportClasseur({ annee, onOuvrir }: { annee: number; onOuvrir: (code: string) => void }) {
  const [fichier, setFichier] = useState<string | null>(null)
  const [onglets, setOnglets] = useState<OngletImport[]>([])
  const [refs, setRefs] = useState<CollabRef[]>([])
  const [existants, setExistants] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [glisse, setGlisse] = useState(false)

  useEffect(() => {
    supabase.rpc('get_obj_import_reference', { p_annee: annee }).then(({ data, error }) => {
      if (error) return setErr(error.message)
      const d = data as { collaborateurs: CollabRef[]; contrats: Array<{ code: string }> }
      setRefs(d.collaborateurs || [])
      setExistants(new Set((d.contrats || []).map((c) => c.code)))
    })
  }, [annee])

  const charger = async (file: File) => {
    setErr(null)
    setBusy(true)
    try {
      const lus = await lireClasseur(file)
      setFichier(file.name)
      setOnglets(
        lus.map((o) => {
          const a = apparier(o, refs)
          return { ...o, collaborateur_code: a.code, appariement: a.methode, inclure: !!a.code, etat: 'a_publier' }
        }),
      )
    } catch (e) {
      setErr(`Lecture du classeur impossible : ${(e as Error).message}`)
    }
    setBusy(false)
  }

  const refParCode = useMemo(() => new Map(refs.map((r) => [r.code, r])), [refs])
  const doublons = useMemo(() => {
    const n = new Map<string, number>()
    onglets.filter((o) => o.inclure && o.collaborateur_code).forEach((o) => n.set(o.collaborateur_code!, (n.get(o.collaborateur_code!) || 0) + 1))
    return new Set([...n].filter(([, v]) => v > 1).map(([k]) => k))
  }, [onglets])

  const maj = (onglet: string, patch: Partial<OngletImport>) => setOnglets((l) => l.map((o) => (o.onglet === onglet ? { ...o, ...patch } : o)))

  const publier = async () => {
    const sel = onglets.filter((o) => o.inclure && o.collaborateur_code && o.etat !== 'publie')
    if (!sel.length) return
    if (doublons.size) return setErr(`Plusieurs onglets rattachés au même collaborateur : ${[...doublons].join(', ')}`)
    setBusy(true)
    setErr(null)
    const lot = crypto.randomUUID()
    const { data: st, error: e1 } = await supabase.rpc('obj_import_enregistrer', {
      p_lot: lot,
      p_annee: annee,
      p_fichier: fichier,
      p_onglets: sel.map(({ inclure, etat, message, ...o }) => o),
    })
    if (e1) {
      setBusy(false)
      return setErr(e1.message)
    }
    const stagingParOnglet = new Map(((st as Array<{ onglet: string; staging_id: string }>) || []).map((x) => [x.onglet, x.staging_id]))
    for (const o of sel) {
      const calc = avanceTheorique(o.marge_n1, o.taux_base ?? 0.08, o.taux_commission ?? 0.01)
      const payload = {
        annee,
        collaborateur_code: o.collaborateur_code,
        objectif_caht: o.objectif_caht,
        marge_n1: o.marge_n1,
        taux_base: o.taux_base ?? 0.08,
        taux_commission: o.taux_commission ?? 0.01,
        avance_mensuelle_saisie: o.avance_excel != null && Math.abs(Math.round(o.avance_excel) - calc) > 1 ? Math.round(o.avance_excel) : null,
        statut: 'valide',
        source_fichier: fichier,
        source_onglet: o.onglet,
        primes: o.primes,
      }
      const { data: id, error } = await supabase.rpc('save_obj_contrat', { p: payload })
      if (error) {
        maj(o.onglet, { etat: 'erreur', message: error.message })
        continue
      }
      const sid = stagingParOnglet.get(o.onglet)
      if (sid) await supabase.rpc('obj_import_marquer', { p_staging_id: sid, p_statut: 'publie', p_contrat_id: id, p_code: o.collaborateur_code })
      maj(o.onglet, { etat: 'publie', message: undefined })
    }
    setExistants((s) => new Set([...s, ...sel.map((o) => o.collaborateur_code!)]))
    setBusy(false)
  }

  const nbSel = onglets.filter((o) => o.inclure && o.collaborateur_code && o.etat !== 'publie').length

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setGlisse(true)
        }}
        onDragLeave={() => setGlisse(false)}
        onDrop={(e) => {
          e.preventDefault()
          setGlisse(false)
          const f = e.dataTransfer.files?.[0]
          if (f && refs.length) charger(f)
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-8 text-center ${glisse ? 'border-[#B4761A] bg-[#FBF3E4]' : 'border-[#D5D1C7] bg-white'}`}
      >
        <div className="text-[14px] font-bold text-[#0B1220]">Classeur des objectifs commerciaux {annee} (un onglet par commercial)</div>
        <div className="mt-1 text-[12px] text-slate-500">Glissez le fichier .xlsx ici ou</div>
        <label className={`${btnPrim} mt-3 inline-block cursor-pointer`}>
          Choisir le fichier
          <input type="file" accept=".xlsx,.xlsm" className="hidden" disabled={refs.length === 0} onChange={(e) => e.target.files?.[0] && charger(e.target.files[0])} />
        </label>
        {refs.length === 0 && !err && <div className="mt-2 text-[12px] text-slate-500">Chargement des collaborateurs…</div>}
        {busy && <div className="mt-2 text-[12px] text-slate-500">Traitement…</div>}
        {fichier && <div className="mt-2 text-[12px] text-slate-600">{fichier} · {onglets.length} onglet(s) lu(s)</div>}
      </div>

      {err && <Alerte texte={err} />}

      {onglets.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] text-slate-600">
              Vérifiez le collaborateur de chaque onglet, puis publiez. Le réalisé Excel n’est pas importé : il est comparé au CA facturé du compagnon.
            </div>
            <button className={btnPrim} disabled={busy || nbSel === 0} onClick={publier}>
              Publier {nbSel} contrat(s)
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#E2DFD8] bg-white">
            <table className="w-full min-w-[1100px] text-[13px]">
              <thead className="bg-[#111820] text-left text-[11px] uppercase tracking-[0.08em] text-[#C9C4B8]">
                <tr>
                  <th className="px-3 py-2.5">Inclure</th>
                  <th className="px-3 py-2.5">Onglet</th>
                  <th className="px-3 py-2.5">Collaborateur</th>
                  <th className="px-3 py-2.5 text-right">Objectif</th>
                  <th className="px-3 py-2.5 text-right">Marge N-1</th>
                  <th className="px-3 py-2.5 text-right">Avance Excel / calc.</th>
                  <th className="px-3 py-2.5 text-right">Écart CA Excel ↔ compagnon</th>
                  <th className="px-3 py-2.5 text-center">Primes</th>
                  <th className="px-3 py-2.5">État</th>
                </tr>
              </thead>
              <tbody>
                {onglets.map((o) => {
                  const ref = o.collaborateur_code ? refParCode.get(o.collaborateur_code) : undefined
                  const ecarts = o.mois
                    .filter((m) => m.ca != null && ref)
                    .map((m) => ({ mois: m.mois, ca: (ref!.ca[String(m.mois)] || 0) - (m.ca || 0), marge: (ref!.marge[String(m.mois)] || 0) - (m.marge || 0) }))
                  const ecartCa = ecarts.reduce((s, x) => s + Math.abs(x.ca), 0)
                  const ecartMarge = ecarts.reduce((s, x) => s + x.marge, 0)
                  const calc = avanceTheorique(o.marge_n1, o.taux_base ?? 0.08, o.taux_commission ?? 0.01)
                  const dejaLa = o.collaborateur_code && existants.has(o.collaborateur_code) && o.etat !== 'publie'
                  return (
                    <FragmentOnglet key={o.onglet}>
                      <tr className="border-t border-[#EEEBE4] align-top">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={o.inclure} disabled={o.etat === 'publie'} onChange={(e) => maj(o.onglet, { inclure: e.target.checked })} />
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          <button className="text-left hover:underline" onClick={() => setOuvert(ouvert === o.onglet ? null : o.onglet)}>
                            {ouvert === o.onglet ? '▾' : '▸'} {o.onglet}
                          </button>
                          {o.avertissements.length > 0 && <div className="mt-0.5 text-[11px] font-normal text-[#C1683C]">⚠ {o.avertissements.join(' · ')}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={o.collaborateur_code || ''}
                            disabled={o.etat === 'publie'}
                            onChange={(e) => maj(o.onglet, { collaborateur_code: e.target.value || null, appariement: e.target.value ? 'Choisi à la main' : null, inclure: !!e.target.value })}
                            className={`${inp} max-w-[220px] ${doublons.has(o.collaborateur_code || '') ? 'border-[#C1683C]' : ''}`}
                          >
                            <option value="">— à rattacher —</option>
                            {refs.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.nom}
                                {r.sommeil ? ' (sommeil)' : ''}
                              </option>
                            ))}
                          </select>
                          {o.appariement && <div className="mt-0.5 text-[11px] text-slate-500">{o.appariement}</div>}
                          {dejaLa && <div className="mt-0.5 text-[11px] text-[#8A5A12]">Contrat {annee} existant : sera remplacé</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtK(o.objectif_caht)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt0(o.marge_n1)}
                          {o.annee_marge_n1 && o.annee_marge_n1 !== annee - 1 && <div className="text-[11px] text-[#C1683C]">marge {o.annee_marge_n1} ≠ {annee - 1}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt0(o.avance_excel)} / {fmt0(calc)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${ecartCa > 1 ? 'text-[#C1683C]' : 'text-[#2F7A4A]'}`}>
                          {!ref ? '—' : ecarts.length === 0 ? 'pas de mois' : ecartCa <= 1 ? `✓ ${ecarts.length} mois` : fmtE(ecartCa)}
                          {ref && ecarts.length > 0 && <div className="text-[11px] text-slate-500">marge {ecartMarge >= 0 ? '+' : ''}{fmt0(ecartMarge)} €</div>}
                        </td>
                        <td className="px-3 py-2 text-center">{o.primes.length}</td>
                        <td className="px-3 py-2">
                          {o.etat === 'publie' ? (
                            <button className="font-semibold text-[#2F7A4A] hover:underline" onClick={() => onOuvrir(o.collaborateur_code!)}>
                              ✓ Publié — ouvrir
                            </button>
                          ) : o.etat === 'erreur' ? (
                            <span className="text-[#C1683C]">{o.message}</span>
                          ) : (
                            <span className="text-slate-500">À publier</span>
                          )}
                        </td>
                      </tr>
                      {ouvert === o.onglet && (
                        <tr className="bg-[#FBFAF7]">
                          <td />
                          <td colSpan={8} className="px-3 py-3">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-1 text-[12px] font-bold">Primes lues</div>
                                <ul className="space-y-1 text-[12px]">
                                  {o.primes.map((p, i) => (
                                    <li key={i}>
                                      <b>{SECTION_LIBELLES[p.section]}</b> — {p.libelle}
                                      {p.description ? ` : ${p.description}` : ''} ·{' '}
                                      {p.mode === 'paliers' ? p.paliers.map((x) => `${fmtK(x.seuil)} → ${fmtE(x.montant)}`).join(' ; ') : fmtE(p.montant)}
                                      <span className="text-slate-500"> ({INDICATEUR_LIBELLES[p.indicateur]})</span>
                                    </li>
                                  ))}
                                </ul>
                                <div className="mt-1 text-[11px] text-slate-500">Les libellés, paliers et indicateurs se corrigent ensuite sur la fiche (✎ Modifier le contrat).</div>
                              </div>
                              <div>
                                <div className="mb-1 text-[12px] font-bold">Réalisé Excel ↔ compagnon</div>
                                <table className="w-full text-[12px]">
                                  <thead className="text-slate-500">
                                    <tr>
                                      <th className="text-left">Mois</th>
                                      <th className="text-right">CA Excel</th>
                                      <th className="text-right">Écart CA</th>
                                      <th className="text-right">Marge Excel</th>
                                      <th className="text-right">Écart marge</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {o.mois
                                      .filter((m) => m.ca != null)
                                      .map((m) => {
                                        const e = ecarts.find((x) => x.mois === m.mois)
                                        return (
                                          <tr key={m.mois}>
                                            <td>{MOIS[m.mois]}</td>
                                            <td className="text-right tabular-nums">{fmt2(m.ca)}</td>
                                            <td className={`text-right tabular-nums ${e && Math.abs(e.ca) > 1 ? 'text-[#C1683C]' : ''}`}>{e ? fmt0(e.ca) : '—'}</td>
                                            <td className="text-right tabular-nums">{fmt2(m.marge)}</td>
                                            <td className={`text-right tabular-nums ${e && Math.abs(e.marge) > 100 ? 'text-[#C1683C]' : ''}`}>{e ? fmt0(e.marge) : '—'}</td>
                                          </tr>
                                        )
                                      })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentOnglet>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function FragmentOnglet({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
