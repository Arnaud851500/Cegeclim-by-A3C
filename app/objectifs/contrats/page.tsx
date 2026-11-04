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
 * Évolutions du 03/11/2026 : objectif porté sur le CA perso ou le CA agence
 * (obj_contrat.perimetre_objectif, migration 20261103b) ; date de fin de
 * contrat (obj_contrat.date_fin, migration 20261103c) — calcul arrêté au mois
 * de la date de fin inclus, avances limitées, projection sur la période.
 * Primes « évolution du CA de familles » (03/11/2026, migration 20261103d) :
 * macro-familles / familles au choix, base CA perso ou agence, comparaison N vs
 * N-1 sur les mêmes mois, résultat automatique (forfait avec cible % ou paliers %).
 * Primes « évolution du taux de transformation » (03/11/2026, migration 20261103e) :
 * taux devis → commande à 120 j en CA (lecture à âge égal de l'écran Analyse devis),
 * devis du 01/01 au dernier jour mûr vs mêmes dates N-1, cible en points.
 * Primes « nombre de clients par tranche de CA 12 mois glissants » (03/11/2026,
 * migration 20261103f) ; ces contrats alimentent aussi les objectifs de l'écran
 * Suivi agences – commerciaux (get_suivi_objectifs), agence = somme.
 * Impression (03/11/2026, demandé par Arnaud) : document A4 dédié (ImpressionFiche),
 * rendu hors du shell de l'application via un portail ; seul ce document est
 * imprimé (bandeau, menus et écran masqués).
 * Classeur normé (04/11/2026, demandé par Arnaud — lib/contratsObjectifsExcel.ts) :
 * export Excel des contrats de l'année avec leur situation à date (liste et fiche),
 * copie de préparation N+1 pour la direction, réimport strict des onglets normés
 * (code collaborateur, primes par identifiant → évaluations conservées) ; les
 * anciens classeurs libres restent lus par lireOnglet.
 * Marge PV ignorée pour l'instant. Réalisé = indicateur_factures_mensuel
 * (hors statistique exclus), commission calculée sur les mois clos.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  INDICATEUR_LIBELLES,
  MOIS,
  RESULTAT_LIBELLES,
  SECTION_LIBELLES,
  TRANCHES,
  TRIMESTRES,
  apparier,
  avanceTheorique,
  caObjectif,
  calculerContrat,
  etatPrime,
  fmt0,
  fmt2,
  fmtE,
  fmtEvol,
  fmtK,
  fmtPts,
  libelleFamilles,
  fmtPct,
  lireOnglet,
  montantMax,
  type CollabRef,
  type FamilleRef,
  type FicheContrat,
  type Indicateur,
  type LigneListe,
  type OngletLu,
  type Prime,
  type Resultat,
  type Section,
  type Tranche,
} from '@/lib/contratsObjectifs'
import { construireClasseur, lireClasseurAuto, telecharger, type ModeExport, type OngletAuto } from '@/lib/contratsObjectifsExcel'

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

  // La liste occupe toute la largeur de l'écran (tableau large, sans défilement horizontal) ;
  // la fiche et l'import gardent une largeur de lecture.
  const largeur = !code && !vueImport ? 'max-w-none' : 'max-w-[1400px]'

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16 print:bg-white">
      <header className="border-b border-[color:var(--cg-hdr-border)] bg-[color:var(--cg-hdr-bg)] print:hidden">
        <div className={`mx-auto flex w-full ${largeur} flex-wrap items-end justify-between gap-4 px-4 py-4 md:px-8`}>
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

      <main className={`mx-auto w-full ${largeur} px-4 py-5 md:px-8`}>
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
/** Charge les fiches complètes (get_obj_contrat) par paquets de 4 ; les fiches refusées sont signalées, pas bloquantes. */
async function chargerFiches(annee: number, codes: string[], onProgress?: (n: number) => void) {
  const fiches: FicheContrat[] = []
  const erreurs: string[] = []
  let fait = 0
  for (let i = 0; i < codes.length; i += 4) {
    const lot = codes.slice(i, i + 4)
    const res = await Promise.all(lot.map((c) => supabase.rpc('get_obj_contrat', { p_annee: annee, p_code: c })))
    res.forEach(({ data, error }, k) => {
      if (error) erreurs.push(`${lot[k]} : ${error.message}`)
      else if ((data as FicheContrat)?.contrat) fiches.push(data as FicheContrat)
    })
    fait += lot.length
    onProgress?.(fait)
  }
  return { fiches, erreurs }
}

async function exporterExcel(annee: number, fiches: FicheContrat[], mode: ModeExport) {
  const { data: familles } = await supabase.rpc('get_obj_familles')
  const blob = await construireClasseur(fiches, { mode, annee, familles: (familles as FamilleRef[]) || [] })
  const jour = new Date().toISOString().slice(0, 10)
  const suffixe = fiches.length === 1 ? `_${fiches[0].code}` : ''
  telecharger(blob, mode === 'preparation' ? `Contrats_objectifs_${annee + 1}_preparation${suffixe}_${jour}.xlsx` : `Contrats_objectifs_${annee}${suffixe}_situation_${jour}.xlsx`)
}

function BarreExport({ annee, codes, droits }: { annee: number; codes: string[]; droits: Droits }) {
  const [etat, setEtat] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const lancer = async (mode: ModeExport) => {
    setErr(null)
    setEtat(`Préparation du classeur… 0 / ${codes.length}`)
    try {
      const { fiches, erreurs } = await chargerFiches(annee, codes, (n) => setEtat(`Préparation du classeur… ${n} / ${codes.length}`))
      if (!fiches.length) throw new Error(erreurs[0] || 'Aucun contrat à exporter')
      await exporterExcel(annee, fiches, mode)
      if (erreurs.length) setErr(`${erreurs.length} contrat(s) non exporté(s) : ${erreurs.join(' · ')}`)
    } catch (e) {
      setErr((e as Error).message)
    }
    setEtat(null)
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E2DFD8] bg-white px-4 py-3">
      <span className="text-[13px] font-semibold text-[#0B1220]">Excel :</span>
      <button className={btn} disabled={!!etat || !codes.length} onClick={() => lancer('situation')}>
        ⬇ Exporter les contrats {annee} et la situation à date
      </button>
      {droits.modifier && (
        <button className={btn} disabled={!!etat || !codes.length} onClick={() => lancer('preparation')}>
          ⬇ Préparer les contrats {annee + 1}
        </button>
      )}
      {etat && <span className="text-[12px] text-slate-500">{etat}</span>}
      <span className="ml-auto text-[12px] text-slate-500">
        Classeur normé : un onglet par commercial, modifiable par la direction puis réimportable (avenants, année suivante).
      </span>
      {err && <div className="w-full text-[12px] text-[#C1683C]">{err}</div>}
    </div>
  )
}

function Liste({ annee, droits, onOuvrir }: { annee: number; droits: Droits; onOuvrir: (code: string) => void }) {
  const [data, setData] = useState<{ mois_clos: number; rows: LigneListe[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [refs, setRefs] = useState<CollabRef[] | null>(null)
  const [nouveau, setNouveau] = useState('')
  // Primes annuelles max / probables par contrat, calculées comme sur la fiche (etatPrime)
  const [primes, setPrimes] = useState<Map<string, { max: number; probable: number; regul: number | null }> | null>(null)

  useEffect(() => {
    setData(null)
    supabase.rpc('get_obj_contrats_liste', { p_annee: annee }).then(({ data, error }) => {
      if (error) setErr(error.message)
      else {
        const d = data as { mois_clos: number; rows: LigneListe[] }
        setData(d)
        setPrimes(null)
        chargerFiches(annee, d.rows.map((r) => r.code)).then(({ fiches }) => {
          const m = new Map<string, { max: number; probable: number; regul: number | null }>()
          for (const f of fiches) {
            const calc = calculerContrat(f)
            const etats = (f.primes || []).map((p) => etatPrime(p, f, calc))
            m.set(f.code, {
              max: etats.reduce((s, e) => s + e.montantMax, 0),
              probable: etats.reduce((s, e) => s + e.montantProjete, 0),
              regul: calc.soldeProjete ?? null,
            })
          }
          setPrimes(m)
        })
      }
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
      s.ca += r.ca_objectif
      s.com += r.marge * r.taux_commission
      s.av += r.avance_mensuelle * (r.mois_calc ?? mc)
      s.pmax += primes?.get(r.code)?.max || 0
      s.pprob += primes?.get(r.code)?.probable || 0
      s.regul += primes?.get(r.code)?.regul || 0
      return s
    },
    { obj: 0, ca: 0, com: 0, av: 0, pmax: 0, pprob: 0, regul: 0 },
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

      {data.rows.length > 0 && <BarreExport annee={annee} codes={data.rows.map((r) => r.code)} droits={droits} />}

      {data.rows.length === 0 ? (
        <Alerte ton="info" texte={`Aucun contrat d’objectifs ${annee} dans votre périmètre.`} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E2DFD8] bg-white">
          <table className="w-full min-w-[1320px] text-[13px] [&_tbody_td]:whitespace-nowrap [&_tfoot_td]:whitespace-nowrap">
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
                <th className="px-3 py-2.5 text-right" title="Commission projetée sur l’année (ou jusqu’à la fin du contrat) − avances du contrat : régularisation de décembre, comme sur la fiche">Régul projetée</th>
                <th className="px-3 py-2.5 text-right" title="Somme des primes annuelles individuelles au plafond du contrat">Prime indiv. max</th>
                <th className="px-3 py-2.5 text-right" title="Prime annuelle probable en fin d’année : paliers sur la projection, indicateurs automatiques à date, primes évaluées au montant retenu, primes à évaluer au maximum">Prime indiv. probable</th>
                <th className="px-3 py-2.5 text-center">Primes à évaluer</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const com = r.marge * r.taux_commission
                const av = r.avance_mensuelle * (r.mois_calc ?? mc)
                const pct = r.objectif_caht ? r.ca_objectif / r.objectif_caht : null
                const evol = r.ca_objectif_n1_a_date ? r.ca_objectif / r.ca_objectif_n1_a_date - 1 : null
                return (
                  <tr key={r.id} onClick={() => onOuvrir(r.code)} className="cursor-pointer border-t border-[#EEEBE4] hover:bg-[#FBF7EE]">
                    <td className="px-3 py-2 font-semibold text-[#0B1220]">
                      {r.nom}
                      {r.statut === 'brouillon' && <span className="ml-2 rounded bg-[#F2E3C7] px-1.5 py-0.5 text-[10px] font-bold text-[#8A5A12]">BROUILLON</span>}
                      {r.date_fin && (
                        <span className="ml-2 rounded bg-[#FBE6DD] px-1.5 py-0.5 text-[10px] font-bold text-[#8A3A1C]">FIN {new Date(r.date_fin).toLocaleDateString('fr-FR')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.agence || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.perimetre_objectif === 'agence' && (
                        <span className="mr-1.5 rounded bg-[#E3EEF2] px-1 py-0.5 text-[9px] font-bold uppercase text-[#2D6F86]" title="Objectif porté sur le CA de l’agence">Agence</span>
                      )}
                      {fmtK(r.objectif_caht)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtK(r.ca_objectif)}</td>
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
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        !primes || primes.get(r.code)?.regul == null ? 'text-slate-400' : (primes.get(r.code)?.regul ?? 0) >= 0 ? 'text-[#1F5A35]' : 'text-[#C1683C]'
                      }`}
                    >
                      {primes ? (primes.get(r.code)?.regul == null ? '—' : fmtE(primes.get(r.code)?.regul ?? 0)) : '…'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{primes ? fmtE(primes.get(r.code)?.max ?? 0) : '…'}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-[#0B1220]">
                      {primes && (primes.get(r.code)?.max ?? 0) > 0 && (
                        <span className="mr-1.5 text-[10px] font-normal text-slate-500">{fmtPct((primes.get(r.code)?.probable ?? 0) / (primes.get(r.code)?.max ?? 1), 0)}</span>
                      )}
                      {primes ? fmtE(primes.get(r.code)?.probable ?? 0) : '…'}
                    </td>
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
                <td className="px-3 py-2 text-right tabular-nums">{primes ? fmtE(tot.regul) : '…'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{primes ? fmtE(tot.pmax) : '…'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{primes ? fmtE(tot.pprob) : '…'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Les contrats avec une date de fin sont calculés jusqu’au mois de cette date inclus. CA à date = CA perso, ou CA de l’agence quand l’objectif du contrat porte sur l’agence. Avances versées = avance mensuelle × mois clos (hors versements saisis sur la fiche). Commission acquise = marge perso des mois clos × taux de commission. Régul projetée = commission projetée sur l’année (ou jusqu’à la fin du contrat) − avances du contrat, comme sur la fiche. Prime indiv. max = somme des primes annuelles au plafond du contrat ; prime indiv. probable = estimation de fin d’année (paliers CA sur la projection, indicateurs automatiques à date, primes évaluées au montant retenu, primes qualitatives non encore évaluées comptées au maximum), comme sur la fiche.
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
  const obj = caObjectif(f, calc)

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
            {c?.date_fin && (
              <span className="ml-2 rounded bg-[#C1683C] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                Fin de contrat le {new Date(c.date_fin).toLocaleDateString('fr-FR')} · calcul arrêté à fin {MOIS[calc.moisFin]?.toLowerCase()}
              </span>
            )}
            {!modifier && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px]">Consultation</span>}
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-lg border border-white/20 px-3 py-1.5 text-[13px] font-semibold hover:border-[#B4761A]">
            🖨 Imprimer
          </button>
          {c && (
            <button
              onClick={() => exporterExcel(annee, [f], 'situation').catch((e) => alert((e as Error).message))}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-[13px] font-semibold hover:border-[#B4761A]"
            >
              ⬇ Excel
            </button>
          )}
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
                <div className="text-[13px] font-bold text-[#3D4A12]">
                  Objectif CA HT{obj.agence ? ` agence ${f.agence || ''}` : ''}
                  {obj.agence && <span className="ml-2 rounded bg-white/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em]">porté sur le CA agence</span>}
                </div>
                <div className="text-[22px] font-bold tabular-nums text-[#2C360B]">{fmtE(c.objectif_caht)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-[#3D4A12]">
                <span>
                  {obj.agence ? 'CA agence' : 'Réalisé'} à fin {MOIS[calc.moisCalc]?.toLowerCase() || '—'} : <b className="tabular-nums">{fmtE(obj.realise)}</b>
                </span>
                <span>
                  Projection {calc.moisFin < 12 ? 'fin de contrat' : 'fin d’année'} : <b className="tabular-nums">{fmtK(obj.projection)}</b>
                </span>
              </div>
              <div className="mt-2">
                <Jauge
                  pct={c.objectif_caht ? obj.realise / c.objectif_caht : null}
                  projection={c.objectif_caht && obj.projection != null ? obj.projection / c.objectif_caht : null}
                />
              </div>
              <div className="mt-1 text-[11px] text-[#5B6630]">
                Le trait doré marque la projection (répartition mensuelle du bilan {annee}).
                {obj.agence && <> CA perso du collaborateur : {fmtE(calc.caTotal)} (base de sa commission sur marge).</>}
              </div>
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
              {calc.moisFin < 12 && ' Mois barrés = après la fin du contrat, hors calcul.'}
            </div>
          </Bloc>

          {/* Solde de la prime */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-[#D9D5EA] bg-[#ECEAF4] px-5 py-4">
              <div className="text-[13px] font-bold text-[#3A3360]">Prime à verser au 31/12/{annee} — situation à date</div>
              <Ligne libelle="Commission acquise (mois clos)" valeur={fmtE(calc.commissionAcquise)} />
              <Ligne libelle={`Avances versées (${calc.moisCalc} mois)`} valeur={fmtE(-calc.avancesADate)} />
              <div className="mt-2 flex items-center justify-between rounded-md bg-[#FFF35C] px-3 py-1.5 font-bold text-[#0B1220]">
                <span>Solde prime {fmt2(c.taux_commission * 100).replace(',00', '')} %</span>
                <span className="tabular-nums">{fmtE(calc.soldeADate)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-[#E2DFD8] bg-white px-5 py-4">
              <div className="text-[13px] font-bold text-[#0B1220]">
                {calc.moisFin < 12 ? `Projection à la fin du contrat (${MOIS[calc.moisFin]?.toLowerCase() || '—'})` : 'Projection fin d’année (régul de décembre)'}
              </div>
              <Ligne libelle="Commission projetée" valeur={fmtE(calc.commissionProjetee)} />
              <Ligne libelle={`Avances du contrat (${calc.moisFin} mois)`} valeur={fmtE(-calc.avancesAnnee)} />
              <div
                className={`mt-2 flex items-center justify-between rounded-md px-3 py-1.5 font-bold ${
                  (calc.soldeProjete || 0) >= 0 ? 'bg-[#E3F1E7] text-[#1F5A35]' : 'bg-[#FBEDE7] text-[#8A3A1C]'
                }`}
              >
                <span>{calc.moisFin < 12 ? 'Solde de fin de contrat projeté' : 'Régul projetée'}</span>
                <span className="tabular-nums">{fmtE(calc.soldeProjete)}</span>
              </div>
              {calc.autresVersements !== 0 && <div className="mt-1 text-[11px] text-slate-500">Autres versements saisis (régul, primes) : {fmtE(calc.autresVersements)}</div>}
            </div>
          </div>

          {/* Primes annuelles */}
          <PrimesAnnuelles fiche={f} calc={calc} modifier={modifier} onChange={() => setRev((x) => x + 1)} />

          {/* Versements */}
          <Versements fiche={f} modifier={modifier} onChange={() => setRev((x) => x + 1)} />

          <ImpressionFiche fiche={f} calc={calc} />

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
        <tr key={m.mois} className={m.horsContrat ? 'text-slate-300 line-through decoration-slate-300' : m.enCours ? 'italic text-slate-400' : ''}>
          <td className="border-x-2 border-[#0B1220] px-3 py-1 text-center">{MOIS[m.mois]}</td>
          <td className="border-r-2 border-[#0B1220] border-b border-b-[#E2DFD8] px-3 py-1 text-right tabular-nums">{m.ca == null ? '-' : fmt2(m.ca)}</td>
          <td className="border-r-2 border-[#0B1220] border-b border-b-[#E2DFD8] px-3 py-1 text-right tabular-nums">{m.marge == null ? '-' : fmt2(m.marge)}</td>
          <td />
          <td />
          <td />
          <td />
          <td className={`px-3 py-1 text-right tabular-nums ${m.avanceVersee ? 'text-slate-600' : 'text-slate-400'}`}>{m.horsContrat ? '—' : fmt0(m.avance)}</td>
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
  const sections: Section[] = ['ca_perso', 'ca_agence', 'familles', 'transfo', 'clients', 'qualitatif', 'avenant', 'avril_n1']

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

                      {p.mode === 'paliers' && p.indicateur !== 'evol_familles' && p.indicateur !== 'evol_transfo' && (
                        <PaliersBar paliers={p.paliers} valeur={e.valeur} projection={e.projection} />
                      )}
                      {p.indicateur === 'evol_familles' && <EvolFamilles prime={p} evol={e.valeur} />}
                      {p.indicateur === 'evol_transfo' && <EvolFamilles prime={p} evol={e.valeur} enPoints />}
                      {p.indicateur === 'nb_clients' && p.tranche && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          <div className="min-w-[96px] flex-1 rounded-md border border-[#0B1220] bg-[#0B1220] px-2 py-1 text-center leading-tight text-white">
                            <div className="text-[11px] font-semibold">{TRANCHES[p.tranche]}</div>
                            <div className="text-[13px] font-bold tabular-nums">{e.valeur ?? '—'} client(s)</div>
                          </div>
                          <div
                            className={`min-w-[96px] flex-1 rounded-md border px-2 py-1 text-center leading-tight ${
                              e.statut === 'vert' ? 'border-[#2F7A4A] bg-[#E3F1E7] text-[#1F5A35]' : 'border-[#E2DFD8] bg-white text-slate-500'
                            }`}
                          >
                            <div className="text-[11px] font-semibold">Cible ≥ {Number(p.cible_nb ?? 0)}</div>
                            <div className="text-[13px] font-bold tabular-nums">{fmtE(e.montantMax)}</div>
                            <div className="text-[10px]">{e.statut === 'vert' ? '✓ atteint' : 'non atteint'}</div>
                          </div>
                        </div>
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

function EvolFamilles({ prime, evol, enPoints = false }: { prime: Prime; evol: number | null; enPoints?: boolean }) {
  const fmt = (v: number | null, d = 1) => (enPoints ? fmtPts(v, d) : fmtEvol(v, d))
  const seuils = prime.mode === 'paliers' ? [...prime.paliers].sort((a, b) => a.seuil - b.seuil) : [{ seuil: Number(prime.cible_evol ?? 0), montant: prime.montant }]
  return (
    <div className="mt-2.5">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {enPoints && <span className="rounded bg-[#E8F0F3] px-1.5 py-0.5 text-[10px] font-semibold text-[#18465A]">Devis → commande à 120 j</span>}
        {[...(enPoints ? [] : prime.familles_macro || []).map((x) => ({ x, macro: true })), ...(enPoints ? [] : prime.familles || []).map((x) => ({ x, macro: false }))].map(({ x, macro }) => (
          <span key={x} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${macro ? 'bg-[#E8F0F3] text-[#18465A]' : 'bg-[#F1EFE8] text-[#5B6370]'}`}>
            {x}
          </span>
        ))}
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-[#E2DFD8]">
          base {prime.base_ca === 'agence' ? (enPoints ? 'agence' : 'CA agence') : enPoints ? 'perso' : 'CA perso'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <div className="min-w-[96px] flex-1 rounded-md border border-[#0B1220] bg-[#0B1220] px-2 py-1 text-center leading-tight text-white">
          <div className="text-[11px] font-semibold">Évolution à date</div>
          <div className="text-[13px] font-bold tabular-nums">{fmt(evol)}</div>
        </div>
        {seuils.map((p, i) => {
          const atteint = evol != null && evol >= p.seuil
          return (
            <div
              key={i}
              className={`min-w-[96px] flex-1 rounded-md border px-2 py-1 text-center leading-tight ${
                atteint ? 'border-[#2F7A4A] bg-[#E3F1E7] text-[#1F5A35]' : 'border-[#E2DFD8] bg-white text-slate-500'
              }`}
            >
              <div className="text-[11px] font-semibold tabular-nums">≥ {fmt(p.seuil, 0)}</div>
              <div className="text-[13px] font-bold tabular-nums">{fmtE(p.montant)}</div>
              <div className="text-[10px]">{atteint ? '✓ atteint' : 'non atteint'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PaliersBar({ paliers, valeur, projection }: { paliers: Prime['paliers']; valeur: number | null; projection: number | null }) {
  // Barre sans libellés (repères seuls) + paliers en pastilles alignées dessous :
  // plus de chevauchement quand les seuils sont proches.
  const tries = [...paliers].sort((a, b) => a.seuil - b.seuil)
  const max = Math.max(...tries.map((p) => p.seuil), valeur || 0, projection || 0) * 1.05 || 1
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="mt-3">
      <div className="relative h-2.5 rounded-full bg-[#E7E3DA]">
        {valeur != null && <div className="absolute left-0 top-0 h-full rounded-full bg-[#2D6F86]" style={{ width: pos(valeur) }} />}
        {tries.map((p, i) => (
          <div key={i} className="absolute top-[-3px] h-4 w-[2px] rounded bg-[#0B1220]/70" style={{ left: pos(p.seuil) }} />
        ))}
        {projection != null && (
          <div className="absolute top-[-5px] h-5 w-[3px] rounded bg-[#B4761A]" style={{ left: pos(projection) }} title={`Projection ${fmtK(projection)}`} />
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {tries.map((p, i) => {
          const atteint = valeur != null && valeur >= p.seuil
          const projete = !atteint && projection != null && projection >= p.seuil
          return (
            <div
              key={i}
              className={`min-w-[96px] flex-1 rounded-md border px-2 py-1 text-center leading-tight ${
                atteint
                  ? 'border-[#2F7A4A] bg-[#E3F1E7] text-[#1F5A35]'
                  : projete
                    ? 'border-dashed border-[#B4761A] bg-[#FBF3E4] text-[#7A4E0E]'
                    : 'border-[#E2DFD8] bg-white text-slate-500'
              }`}
            >
              <div className="text-[11px] font-semibold tabular-nums">≥ {fmtK(p.seuil)}</div>
              <div className="text-[13px] font-bold tabular-nums">{fmtE(p.montant)}</div>
              <div className="text-[10px]">{atteint ? '✓ atteint' : projete ? 'en projection' : 'non atteint'}</div>
            </div>
          )
        })}
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
    indicateur:
      section === 'ca_perso' ? 'ca_perso' : section === 'ca_agence' ? 'ca_agence' : section === 'familles' ? 'evol_familles' : section === 'transfo' ? 'evol_transfo' : section === 'clients' ? 'nb_clients' : 'manuel',
    paliers: paliers ? [{ seuil: 0, montant: 0 }] : [],
    montant: 0,
    echeance: 'avril_n1',
    familles_macro: [],
    familles: [],
    base_ca: 'perso',
    cible_evol: section === 'familles' ? 0.2 : section === 'transfo' ? 2 : null,
    tranche: section === 'clients' ? 't100' : null,
    cible_nb: section === 'clients' ? 5 : null,
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
  const [perimetre, setPerimetre] = useState<'perso' | 'agence'>(c?.perimetre_objectif || 'perso')
  const [dateFin, setDateFin] = useState(c?.date_fin || '')
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
  const [famRef, setFamRef] = useState<FamilleRef[]>([])
  useEffect(() => {
    supabase.rpc('get_obj_familles').then(({ data }) => setFamRef((data as FamilleRef[]) || []))
  }, [])
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
      perimetre_objectif: perimetre,
      date_fin: dateFin || null,
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
        familles_macro: p.indicateur === 'evol_familles' ? p.familles_macro || [] : [],
        familles: p.indicateur === 'evol_familles' ? p.familles || [] : [],
        base_ca: p.base_ca || 'perso',
        cible_evol: (p.indicateur === 'evol_familles' || p.indicateur === 'evol_transfo') && p.mode === 'forfait' ? p.cible_evol ?? 0 : null,
        tranche: p.indicateur === 'nb_clients' ? p.tranche || 't100' : null,
        cible_nb: p.indicateur === 'nb_clients' ? p.cible_nb ?? 0 : null,
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
        <Champ libelle="Objectif porté sur">
          <select value={perimetre} onChange={(e) => setPerimetre(e.target.value as 'perso' | 'agence')} className={`${inp} w-full`}>
            <option value="perso">CA HT perso du collaborateur</option>
            <option value="agence">CA HT de l’agence {fiche.agence || ''}</option>
          </select>
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
        <Champ libelle="Date de fin de contrat (vide = année complète)">
          <div className="flex gap-1">
            <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className={`${inp} w-full`} />
            {dateFin && (
              <button className={btn} onClick={() => setDateFin('')} title="Retirer la date de fin">
                ✕
              </button>
            )}
          </div>
        </Champ>
        <div className="md:col-span-4">
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
              <select
                value={p.indicateur}
                onChange={(e) => {
                  const ind = e.target.value as Indicateur
                  maj(
                    p._k,
                    ind === 'evol_familles'
                      ? { indicateur: ind, section: 'familles', cible_evol: 0.2, base_ca: p.base_ca || 'perso' }
                      : ind === 'evol_transfo'
                        ? { indicateur: ind, section: 'transfo', cible_evol: 2, base_ca: p.base_ca || 'perso' }
                        : ind === 'nb_clients'
                          ? { indicateur: ind, section: 'clients', mode: 'forfait', tranche: p.tranche || 't100', cible_nb: p.cible_nb ?? 5, base_ca: p.base_ca || 'perso' }
                          : { indicateur: ind },
                  )
                }}
                className={inp}
              >
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
                  {p.indicateur === 'nb_clients' && (
                    <span className="ml-2 flex flex-wrap items-center gap-1">
                      si au moins
                      <input value={String(Number(p.cible_nb ?? 0))} onChange={(e) => maj(p._k, { cible_nb: num(e.target.value) ?? 0 })} className={`${inp} h-7 w-14 text-right`} />
                      <select value={p.tranche || 't100'} onChange={(e) => maj(p._k, { tranche: e.target.value as Tranche })} className={`${inp} h-7`}>
                        {(Object.keys(TRANCHES) as Tranche[]).map((t) => (
                          <option key={t} value={t}>
                            {TRANCHES[t].replace('Clients ', 'clients ')}
                          </option>
                        ))}
                      </select>
                      (CA 12 mois glissants)
                      <select value={p.base_ca || 'perso'} onChange={(e) => maj(p._k, { base_ca: e.target.value as 'perso' | 'agence' })} className={`${inp} ml-1 h-7`}>
                        <option value="perso">clients du collaborateur</option>
                        <option value="agence">clients de l’agence</option>
                      </select>
                    </span>
                  )}
                  {p.indicateur === 'evol_transfo' && (
                    <span className="ml-2 flex items-center gap-1">
                      si taux de transfo ≥ +
                      <input
                        value={String(Number(p.cible_evol ?? 0))}
                        onChange={(e) => maj(p._k, { cible_evol: num(e.target.value) ?? 0 })}
                        className={`${inp} h-7 w-16 text-right`}
                      />
                      pts vs N-1
                      <select value={p.base_ca || 'perso'} onChange={(e) => maj(p._k, { base_ca: e.target.value as 'perso' | 'agence' })} className={`${inp} ml-2 h-7`}>
                        <option value="perso">devis du collaborateur</option>
                        <option value="agence">devis de l’agence</option>
                      </select>
                    </span>
                  )}
                  {p.indicateur === 'evol_familles' && (
                    <span className="ml-2 flex items-center gap-1">
                      si évolution ≥ +
                      <input
                        value={String(Math.round(Number(p.cible_evol ?? 0) * 1000) / 10)}
                        onChange={(e) => maj(p._k, { cible_evol: (num(e.target.value) ?? 0) / 100 })}
                        className={`${inp} h-7 w-16 text-right`}
                      />
                      % vs N-1
                    </span>
                  )}
                </>
              ) : p.indicateur === 'evol_familles' || p.indicateur === 'evol_transfo' ? (
                <>
                  {p.paliers.map((x, i) => (
                    <span key={i} className="flex items-center gap-1 rounded-md border border-[#E2DFD8] bg-white px-1.5 py-1">
                      {p.indicateur === 'evol_transfo' ? 'transfo ≥ +' : 'évol. ≥ +'}
                      <input
                        value={String(p.indicateur === 'evol_transfo' ? x.seuil : Math.round(x.seuil * 1000) / 10)}
                        onChange={(e) =>
                          maj(p._k, {
                            paliers: p.paliers.map((y, j) =>
                              j === i ? { ...y, seuil: p.indicateur === 'evol_transfo' ? num(e.target.value) ?? 0 : (num(e.target.value) ?? 0) / 100 } : y,
                            ),
                          })
                        }
                        className={`${inp} h-7 w-16 text-right`}
                      />
                      {p.indicateur === 'evol_transfo' ? 'pts →' : '% →'}
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
            {p.indicateur === 'evol_familles' && <ChoixFamilles prime={p} refs={famRef} onChange={(patch) => maj(p._k, patch)} />}
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

function ChoixFamilles({ prime, refs, onChange }: { prime: Prime; refs: FamilleRef[]; onChange: (patch: Partial<Prime>) => void }) {
  const [ouvert, setOuvert] = useState<string | null>(null)
  const macros = new Set(prime.familles_macro || [])
  const fams = new Set(prime.familles || [])
  const basculeMacro = (m: string) => {
    const n = new Set(macros)
    if (n.has(m)) n.delete(m)
    else n.add(m)
    // une macro-famille cochée englobe ses familles : on retire les familles redondantes
    const famsDeM = new Set(refs.find((r) => r.macro === m)?.familles || [])
    onChange({ familles_macro: [...n], familles: n.has(m) ? [...fams].filter((f) => !famsDeM.has(f)) : [...fams] })
  }
  const basculeFam = (f: string) => {
    const n = new Set(fams)
    if (n.has(f)) n.delete(f)
    else n.add(f)
    onChange({ familles: [...n] })
  }
  return (
    <div className="mt-2 rounded-md border border-[#D9E4EA] bg-[#F4F8FA] p-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <b className="text-[#18465A]">Familles concernées :</b>
        <span className="text-slate-600">{libelleFamilles(prime)}</span>
        <span className="ml-auto flex items-center gap-1">
          Base
          <select value={prime.base_ca || 'perso'} onChange={(e) => onChange({ base_ca: e.target.value as 'perso' | 'agence' })} className={`${inp} h-7`}>
            <option value="perso">CA perso</option>
            <option value="agence">CA agence</option>
          </select>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {refs.map((r) => (
          <span key={r.macro} className="inline-flex items-center overflow-hidden rounded-md border border-[#C9D6DE] bg-white text-[12px]">
            <button
              className={`px-2 py-1 font-semibold ${macros.has(r.macro) ? 'bg-[#2D6F86] text-white' : 'text-[#18465A] hover:bg-[#E8F0F3]'}`}
              onClick={() => basculeMacro(r.macro)}
              title="Toute la macro-famille"
            >
              {macros.has(r.macro) ? '✓ ' : ''}
              {r.macro}
            </button>
            <button className="border-l border-[#C9D6DE] px-1.5 py-1 text-slate-500 hover:bg-[#E8F0F3]" onClick={() => setOuvert(ouvert === r.macro ? null : r.macro)} title="Choisir des familles">
              {r.familles.filter((f) => fams.has(f)).length > 0 ? `${r.familles.filter((f) => fams.has(f)).length} ▾` : '▾'}
            </button>
          </span>
        ))}
      </div>
      {ouvert && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(refs.find((r) => r.macro === ouvert)?.familles || []).map((f) => {
            const inclus = macros.has(ouvert)
            return (
              <button
                key={f}
                disabled={inclus}
                onClick={() => basculeFam(f)}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  inclus ? 'border-[#C9D6DE] bg-[#E8F0F3] text-slate-400' : fams.has(f) ? 'border-[#2D6F86] bg-[#2D6F86] text-white' : 'border-[#D5D1C7] bg-white text-slate-600 hover:border-[#2D6F86]'
                }`}
                title={inclus ? 'Déjà inclus par la macro-famille' : ''}
              >
                {f}
              </button>
            )
          })}
        </div>
      )}
    </div>
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
type OngletImport = OngletAuto & {
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

  const refParCode = useMemo(() => new Map(refs.map((r) => [r.code, r])), [refs])
  const anneesFichier = useMemo(() => [...new Set(onglets.filter((o) => o.format === 'norme' && o.annee != null && o.annee !== annee).map((o) => o.annee!))], [onglets, annee])

  const charger = async (file: File) => {
    setErr(null)
    setBusy(true)
    try {
      const lus = await lireClasseurAuto(file, lireOnglet)
      setFichier(file.name)
      setOnglets(
        lus.map((o) => {
          if (o.format === 'norme') {
            // Classeur normé : le code collaborateur fait foi, l'année doit être celle de l'écran
            const ref = o.code_lu ? refParCode.get(o.code_lu) : undefined
            const avert = [...o.avertissements]
            if (o.code_lu && !ref) avert.push(`Code collaborateur inconnu : ${o.code_lu}`)
            if (o.annee != null && o.annee !== annee) avert.push(`Onglet ${o.annee} : passez l’écran sur ${o.annee} pour l’importer`)
            const ok = !!ref && o.annee === annee
            return { ...o, avertissements: avert, collaborateur_code: ref ? ref.code : null, appariement: ref ? 'Code collaborateur du classeur' : null, inclure: ok, etat: 'a_publier' }
          }
          const a = apparier(o, refs)
          return { ...o, collaborateur_code: a.code, appariement: a.methode, inclure: !!a.code, etat: 'a_publier' }
        }),
      )
    } catch (e) {
      setErr(`Lecture du classeur impossible : ${(e as Error).message}`)
    }
    setBusy(false)
  }

  const doublons = useMemo(() => {
    const n = new Map<string, number>()
    onglets.filter((o) => o.inclure && o.collaborateur_code).forEach((o) => n.set(o.collaborateur_code!, (n.get(o.collaborateur_code!) || 0) + 1))
    return new Set([...n].filter(([, v]) => v > 1).map(([k]) => k))
  }, [onglets])

  const maj = (onglet: string, patch: Partial<OngletImport>) => setOnglets((l) => l.map((o) => (o.onglet === onglet ? { ...o, ...patch } : o)))

  const publier = async () => {
    const sel = onglets.filter((o) => o.inclure && o.collaborateur_code && o.etat !== 'publie' && (o.format !== 'norme' || o.annee === annee))
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
      const norme = o.format === 'norme'
      const payload = {
        annee,
        collaborateur_code: o.collaborateur_code,
        objectif_caht: o.objectif_caht,
        perimetre_objectif: o.perimetre_objectif,
        marge_n1: o.marge_n1,
        taux_base: o.taux_base ?? 0.08,
        taux_commission: o.taux_commission ?? 0.01,
        avance_mensuelle_saisie: norme
          ? o.avance_saisie != null
            ? Math.round(o.avance_saisie)
            : null
          : o.avance_excel != null && Math.abs(Math.round(o.avance_excel) - calc) > 1
            ? Math.round(o.avance_excel)
            : null,
        statut: norme ? o.statut || 'valide' : 'valide',
        source_fichier: fichier,
        source_onglet: o.onglet,
        primes: o.primes,
        // Classeur normé : date de fin et commentaire font partie du contrat (vides = effacés)
        ...(norme ? { date_fin: o.date_fin ?? null, commentaire: o.commentaire ?? null } : {}),
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
        <div className="mx-auto mt-1 max-w-[720px] text-[12px] text-slate-500">
          Classeur normé (exporté depuis la liste des contrats, « Exporter » ou « Préparer {annee + 1} ») : chaque onglet est rattaché par son code collaborateur et remplace le
          contrat {annee} — avenant compris ; les primes gardent leur évaluation. Les anciens classeurs libres restent acceptés (rapprochement automatique).
        </div>
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
      {anneesFichier.length > 0 && (
        <Alerte
          ton="info"
          texte={`Ce classeur contient des contrats ${anneesFichier.join(', ')} : ils ne seront pas importés sur l’écran ${annee}. Choisissez l’année ${anneesFichier[0]} dans le bandeau puis rechargez le fichier.`}
        />
      )}

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
                          <input type="checkbox" checked={o.inclure} disabled={o.etat === 'publie' || (o.format === 'norme' && o.annee !== annee)} onChange={(e) => maj(o.onglet, { inclure: e.target.checked })} />
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          <button className="text-left hover:underline" onClick={() => setOuvert(ouvert === o.onglet ? null : o.onglet)}>
                            {ouvert === o.onglet ? '▾' : '▸'} {o.onglet}
                          </button>
                          <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-bold ${o.format === 'norme' ? 'bg-[#E3EFE6] text-[#2F7A4A]' : 'bg-[#F2E3C7] text-[#8A5A12]'}`}>
                            {o.format === 'norme' ? `NORMÉ ${o.annee ?? ''}` : 'LIBRE'}
                          </span>
                          {o.format === 'norme' && (o.date_fin || o.statut === 'brouillon' || o.commentaire) && (
                            <div className="mt-0.5 text-[11px] font-normal text-slate-500">
                              {[o.statut === 'brouillon' ? 'brouillon' : o.statut === 'signe' ? 'signé' : null, o.date_fin ? `fin ${new Date(o.date_fin).toLocaleDateString('fr-FR')}` : null, o.commentaire]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
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
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtK(o.objectif_caht)}
                          <div>
                            <select value={o.perimetre_objectif} disabled={o.etat === 'publie'} onChange={(e) => maj(o.onglet, { perimetre_objectif: e.target.value as 'perso' | 'agence' })} className="mt-0.5 rounded border border-[#D5D1C7] bg-white px-1 text-[11px]">
                              <option value="perso">CA perso</option>
                              <option value="agence">CA agence</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt0(o.marge_n1)}
                          {o.annee_marge_n1 && o.annee_marge_n1 !== annee - 1 && <div className="text-[11px] text-[#C1683C]">marge {o.annee_marge_n1} ≠ {annee - 1}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {o.format === 'norme' ? (o.avance_saisie != null ? `${fmt0(o.avance_saisie)} saisie` : `${fmt0(calc)} calc.`) : `${fmt0(o.avance_excel)} / ${fmt0(calc)}`}
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
                                      {o.format === 'norme' && <span className={p.id ? 'text-slate-400' : 'text-[#2F7A4A]'}> · {p.id ? 'existante' : 'nouvelle'}</span>}
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

// ============================================================================
// Impression : document A4 dédié, monté directement sous <body> (portail) pour
// que @media print n'imprime que lui (le shell de l'application est masqué).
// ============================================================================
const PRINT_CSS = `
#obj-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 11mm 11mm 12mm 11mm; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(#obj-print-root) { display: none !important; }
  #obj-print-root { display: block !important; }
  #obj-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
#obj-print-root .op { font-family: var(--font-body, 'IBM Plex Sans'), 'IBM Plex Sans', Arial, sans-serif; color: #0B1220; font-size: 8.6pt; line-height: 1.35; }
#obj-print-root .op-num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
#obj-print-root .op h1 { font-family: var(--font-display, 'Space Grotesk'), 'Space Grotesk', Arial, sans-serif; font-size: 17pt; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
#obj-print-root .op h2 { font-family: var(--font-display, 'Space Grotesk'), 'Space Grotesk', Arial, sans-serif; font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 2mm 0; color: #0B1220; border-bottom: 1.2pt solid #0B1220; padding-bottom: 1mm; }
#obj-print-root .op section { margin-top: 5mm; break-inside: avoid; }
#obj-print-root .op table { width: 100%; border-collapse: collapse; }
#obj-print-root .op th { font-size: 7.4pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #5B6370; text-align: right; padding: 1.2mm 1.6mm; border-bottom: 0.8pt solid #0B1220; }
#obj-print-root .op th:first-child { text-align: left; }
#obj-print-root .op td { padding: 0.9mm 1.6mm; border-bottom: 0.4pt solid #E2DFD8; }
#obj-print-root .op tr.mois td { color: #3A4250; }
#obj-print-root .op tr.mois td:first-child { padding-left: 4mm; }
#obj-print-root .op tr.encours td { color: #A0A4AA; font-style: italic; }
#obj-print-root .op tr.trim td { background: #F1EFE8; font-weight: 700; border-bottom: 0.8pt solid #C9C4B8; }
#obj-print-root .op tr.total td { background: #0B1220; color: #fff; font-weight: 700; border: none; padding-top: 1.6mm; padding-bottom: 1.6mm; }
#obj-print-root .op .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; margin-top: 5mm; }
#obj-print-root .op .kpi { border: 0.6pt solid #D5D1C7; border-radius: 1.5mm; padding: 2.2mm 3mm; }
#obj-print-root .op .kpi .l { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5B6370; }
#obj-print-root .op .kpi .v { font-size: 13pt; font-weight: 700; margin-top: 0.8mm; font-variant-numeric: tabular-nums; }
#obj-print-root .op .kpi .s { font-size: 7.4pt; color: #5B6370; margin-top: 0.4mm; }
#obj-print-root .op .bar { height: 1.6mm; background: #E7E3DA; border-radius: 1mm; margin-top: 1.4mm; position: relative; overflow: hidden; }
#obj-print-root .op .bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: #2D6F86; border-radius: 1mm; }
#obj-print-root .op .solde { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 3mm; }
#obj-print-root .op .box { border: 0.6pt solid #D5D1C7; border-radius: 1.5mm; padding: 2.4mm 3mm; }
#obj-print-root .op .box .t { font-weight: 700; font-size: 8.4pt; margin-bottom: 1.2mm; }
#obj-print-root .op .box .r { display: flex; justify-content: space-between; padding: 0.5mm 0; }
#obj-print-root .op .box .r.f { border-top: 0.8pt solid #0B1220; margin-top: 1mm; padding-top: 1.2mm; font-weight: 700; font-size: 9.6pt; }
#obj-print-root .op .pos { color: #2F7A4A; }
#obj-print-root .op .neg { color: #B4501F; }
#obj-print-root .op .pill { display: inline-block; padding: 0.3mm 1.8mm; border-radius: 3mm; font-size: 7pt; font-weight: 700; white-space: nowrap; }
#obj-print-root .op .p-vert { background: #E3F1E7; color: #1F5A35; }
#obj-print-root .op .p-orange { background: #F7EBD3; color: #8A5A12; }
#obj-print-root .op .p-rouge { background: #FBE6DD; color: #8A3A1C; }
#obj-print-root .op .p-gris { background: #ECEAE4; color: #4A4F57; }
#obj-print-root .op .muted { color: #6B7280; }
#obj-print-root .op .small { font-size: 7.2pt; }
#obj-print-root .op section.p2 { break-before: page; margin-top: 0; }
#obj-print-root .op .rappel { display: flex; justify-content: space-between; font-size: 7.6pt; color: #5B6370; border-bottom: 0.6pt solid #D5D1C7; padding-bottom: 1.5mm; margin-bottom: 5mm; }
#obj-print-root .op .rappel b { color: #0B1220; }
#obj-print-root .op .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 7mm; break-inside: avoid; }
#obj-print-root .op .sig div { border-top: 0.6pt solid #9C9A92; padding-top: 1.2mm; height: 16mm; font-size: 7.4pt; color: #5B6370; }
`

function ImpressionFiche({ fiche, calc }: { fiche: FicheContrat; calc: ReturnType<typeof calculerContrat> }) {
  const [monte, setMonte] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMonte(true), 0)
    return () => clearTimeout(t)
  }, [])
  if (!monte || !fiche.contrat) return null
  return createPortal(
    <div id="obj-print-root">
      <style>{PRINT_CSS}</style>
      <DocumentContrat fiche={fiche} calc={calc} />
    </div>,
    document.body,
  )
}

const STATUT_PRIME: Record<string, { cls: string; txt: string }> = {
  vert: { cls: 'p-vert', txt: 'Acquis' },
  orange: { cls: 'p-orange', txt: 'En bonne voie' },
  rouge: { cls: 'p-rouge', txt: 'Non atteint à date' },
  gris: { cls: 'p-gris', txt: 'À évaluer' },
}

function DocumentContrat({ fiche, calc }: { fiche: FicheContrat; calc: ReturnType<typeof calculerContrat> }) {
  const c = fiche.contrat!
  const tauxCom = `${fmt2(c.taux_commission * 100).replace(',00', '')} %`
  const finMois = calc.moisCalc > 0 ? `fin ${MOIS[calc.moisCalc].toLowerCase()} ${fiche.annee}` : `début ${fiche.annee}`
  const finContrat = calc.moisFin < 12 && c.date_fin ? new Date(c.date_fin).toLocaleDateString('fr-FR') : null
  const obj = caObjectif(fiche, calc)
  const pctObj = c.objectif_caht ? obj.realise / c.objectif_caht : null
  const pctProj = c.objectif_caht && obj.projection != null ? obj.projection / c.objectif_caht : null
  const etats = fiche.primes.map((p) => ({ p, e: etatPrime(p, fiche, calc) }))
  const totMax = etats.reduce((s, x) => s + x.e.montantMax, 0)
  const totProj = etats.reduce((s, x) => s + x.e.montantProjete, 0)
  const totADate = etats.reduce((s, x) => s + x.e.montantADate, 0)
  const aujourdhui = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const sens = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'pos' : 'neg')

  const condition = (p: Prime) =>
    p.indicateur === 'nb_clients'
      ? `${p.tranche ? TRANCHES[p.tranche] : 'Tranche ?'} (12 mois glissants, ${p.base_ca === 'agence' ? 'agence' : 'perso'}) : au moins ${Number(p.cible_nb ?? 0)}`
      : p.indicateur === 'evol_transfo'
      ? `Taux de transfo devis à 120 j ${p.base_ca === 'agence' ? 'agence' : 'perso'} vs N-1 : ${
          p.mode === 'paliers' ? p.paliers.map((x) => `≥ ${fmtPts(x.seuil, 0)} : ${fmtE(x.montant)}`).join(' · ') : `≥ ${fmtPts(Number(p.cible_evol ?? 0), 0)}`
        }`
      : p.indicateur === 'evol_familles'
      ? `${p.base_ca === 'agence' ? 'CA agence' : 'CA perso'} ${libelleFamilles(p)} vs N-1 : ${
          p.mode === 'paliers' ? p.paliers.map((x) => `≥ ${fmtEvol(x.seuil, 0)} : ${fmtE(x.montant)}`).join(' · ') : `≥ ${fmtEvol(Number(p.cible_evol ?? 0), 0)}`
        }`
      : p.mode === 'paliers'
        ? p.paliers.map((x) => `≥ ${fmtK(x.seuil)} : ${fmtE(x.montant)}`).join(' · ')
        : p.description || INDICATEUR_LIBELLES[p.indicateur]

  return (
    <div className="op">
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2pt solid #0B1220', paddingBottom: '2.5mm' }}>
        <div>
          <div style={{ fontSize: '7.4pt', fontWeight: 700, letterSpacing: '0.2em', color: '#B4761A', textTransform: 'uppercase' }}>CEGECLIM · Contrat d’objectifs {fiche.annee}</div>
          <h1 style={{ marginTop: '1mm' }}>{fiche.nom}</h1>
          <div className="muted" style={{ marginTop: '0.6mm' }}>
            Agence {fiche.agence || '—'} · code {fiche.code} · contrat {c.statut === 'signe' ? 'signé' : c.statut === 'brouillon' ? 'en brouillon' : 'validé'}
            {finContrat && <b style={{ color: '#B4501F' }}> · fin de contrat le {finContrat}</b>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '9pt', fontWeight: 700 }}>Situation à {finMois}</div>
          <div className="muted small">Édité le {aujourdhui}</div>
        </div>
      </div>

      {/* Indicateurs clés */}
      <div className="kpis">
        <div className="kpi">
          <div className="l">Objectif {obj.agence ? 'CA HT agence' : 'CA HT'}</div>
          <div className="v">{fmtK(c.objectif_caht)}</div>
          <div className="s">{obj.agence ? `Agence ${fiche.agence || '—'} · ${fiche.annee}` : `Signé pour ${fiche.annee}`}</div>
        </div>
        <div className="kpi">
          <div className="l">{obj.agence ? 'CA HT agence réalisé' : 'CA HT réalisé'}</div>
          <div className="v">{fmtK(obj.realise)}</div>
          <div className="s">{pctObj == null ? '—' : `${fmtPct(pctObj, 0)} de l’objectif`}</div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (pctObj || 0) * 100)}%`, background: (pctObj || 0) >= 1 ? '#2F7A4A' : '#2D6F86' }} />
          </div>
        </div>
        <div className="kpi">
          <div className="l">Projection fin d’année</div>
          <div className="v">{fmtK(obj.projection)}</div>
          <div className="s">{pctProj == null ? '—' : `${fmtPct(pctProj, 0)} de l’objectif`}</div>
        </div>
        <div className="kpi">
          <div className="l">Marge dégagée{obj.agence ? ' (perso)' : ''}</div>
          <div className="v">{fmtK(calc.margeTotal)}</div>
          <div className="s">
            {obj.agence ? `CA perso ${fmtK(calc.caTotal)} · ` : ''}taux {calc.tauxMarge == null ? '—' : fmtPct(calc.tauxMarge)}
          </div>
        </div>
      </div>

      {/* 1. Commission trimestrielle */}
      <section>
        <h2>1 · Prime trimestrielle sur la marge dégagée</h2>
        <div className="muted small" style={{ marginBottom: '1.5mm' }}>
          Commission de {tauxCom} de la marge. Avance mensuelle de {fmtE(c.avance_mensuelle)} = {fmt0(c.taux_base * 100)} % de la marge {fiche.annee - 1} ({fmtE(c.marge_n1)}) × {tauxCom}, régularisée en décembre.
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Période</th>
              <th>CA HT réalisé</th>
              <th>Marge dégagée</th>
              <th>Taux</th>
              <th>Commission {tauxCom}</th>
              <th>Avances</th>
              <th>Écart</th>
            </tr>
          </thead>
          <tbody>
            {calc.trimestres.filter((t) => (t.t - 1) * 3 + 1 <= calc.moisFin).map((t) => (
              <FragmentOnglet key={t.t}>
                {t.mois.filter((m) => !m.horsContrat).map((m) => (
                  <tr key={m.mois} className={m.enCours ? 'mois encours' : 'mois'}>
                    <td>
                      {MOIS[m.mois]}
                      {m.enCours ? ' (en cours)' : ''}
                    </td>
                    <td className="op-num">{m.ca == null ? '–' : fmt0(m.ca)}</td>
                    <td className="op-num">{m.marge == null ? '–' : fmt0(m.marge)}</td>
                    <td className="op-num">{m.ca && m.marge != null ? fmtPct(m.marge / m.ca) : ''}</td>
                    <td />
                    <td className="op-num">{fmt0(m.avance)}{!m.avanceVersee ? '*' : ''}</td>
                    <td />
                  </tr>
                ))}
                <tr className="trim">
                  <td>
                    {TRIMESTRES[t.t - 1]}
                    {!t.complet && t.marge > 0 ? ' (partiel)' : ''}
                  </td>
                  <td className="op-num">{t.ca ? fmt0(t.ca) : '–'}</td>
                  <td className="op-num">{t.marge ? fmt0(t.marge) : '–'}</td>
                  <td className="op-num">{t.ca ? fmtPct(t.marge / t.ca) : ''}</td>
                  <td className="op-num">{t.marge ? fmtE(t.commission) : '–'}</td>
                  <td className="op-num">{fmtE(t.avances)}</td>
                  <td className={`op-num ${t.complet ? sens(t.commission - t.avances) : ''}`}>{t.complet ? fmtE(t.commission - t.avances) : ''}</td>
                </tr>
              </FragmentOnglet>
            ))}
            <tr className="total">
              <td>Total {finContrat ? 'du contrat' : fiche.annee}</td>
              <td className="op-num">{fmt0(calc.caTotal)}</td>
              <td className="op-num">{fmt0(calc.margeTotal)}</td>
              <td className="op-num">{calc.tauxMarge == null ? '' : fmtPct(calc.tauxMarge)}</td>
              <td className="op-num">{fmtE(calc.commissionAcquise)}</td>
              <td className="op-num">{fmtE(calc.avancesAnnee)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: '1mm' }}>
          * avance prévue. Réalisé = CA facturé hors statistique ; la commission ne porte que sur les mois clos ; écart affiché sur les trimestres complets.
        </div>

        <div className="solde">
          <div className="box">
            <div className="t">Solde de la prime {tauxCom} à {finMois}</div>
            <div className="r">
              <span>Commission acquise</span>
              <span className="op-num">{fmtE(calc.commissionAcquise)}</span>
            </div>
            <div className="r">
              <span>Avances versées ({calc.moisCalc} mois)</span>
              <span className="op-num">− {fmtE(calc.avancesADate)}</span>
            </div>
            <div className="r f">
              <span>Solde</span>
              <span className={`op-num ${sens(calc.soldeADate)}`}>{fmtE(calc.soldeADate)}</span>
            </div>
          </div>
          <div className="box">
            <div className="t">{finContrat ? `Projection à la fin du contrat (${finContrat})` : `Projection au 31/12/${fiche.annee}`}</div>
            <div className="r">
              <span>Commission projetée</span>
              <span className="op-num">{fmtE(calc.commissionProjetee)}</span>
            </div>
            <div className="r">
              <span>Avances du contrat ({calc.moisFin} mois)</span>
              <span className="op-num">− {fmtE(calc.avancesAnnee)}</span>
            </div>
            <div className="r f">
              <span>{finContrat ? 'Solde de fin de contrat' : 'Régularisation de décembre'}</span>
              <span className={`op-num ${sens(calc.soldeProjete)}`}>{fmtE(calc.soldeProjete)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Primes annuelles */}
      {etats.length > 0 && (
        <section className="p2">
          <div className="rappel">
            <span>
              <b>{fiche.nom}</b> · agence {fiche.agence || '—'}
            </span>
            <span>Contrat d’objectifs {fiche.annee} · situation à {finMois}</span>
          </div>
          <h2>2 · Primes annuelles</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Prime</th>
                <th style={{ textAlign: 'left', width: '25%' }}>Condition</th>
                <th style={{ textAlign: 'left', width: '23%' }}>Situation à date</th>
                <th>Maximum</th>
                <th>Probable</th>
                <th style={{ textAlign: 'center' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {etats.map(({ p, e }, i) => {
                const st = e.evaluee
                  ? { cls: STATUT_PRIME[e.statut].cls, txt: RESULTAT_LIBELLES[p.resultat as Resultat] }
                  : p.indicateur === 'manuel' || p.indicateur === 'cerfa_complet'
                    ? STATUT_PRIME.gris
                    : STATUT_PRIME[e.statut]
                return (
                  <tr key={p.id || i} style={{ verticalAlign: 'top' }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.libelle}</div>
                      <div className="muted small">
                        {SECTION_LIBELLES[p.section]} · {p.echeance === '31/12' ? 'versée au 31/12' : `versée en avril ${fiche.annee + 1}`}
                      </div>
                    </td>
                    <td className="small">{condition(p)}</td>
                    <td className="small">
                      {e.texte}
                      {p.commentaire_evaluation ? <div className="muted">« {p.commentaire_evaluation} »</div> : null}
                    </td>
                    <td className="op-num">{fmtE(e.montantMax)}</td>
                    <td className="op-num" style={{ fontWeight: 700 }}>
                      {fmtE(e.montantProjete)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`pill ${st.cls}`}>{st.txt}</span>
                    </td>
                  </tr>
                )
              })}
              <tr className="total">
                <td colSpan={3}>
                  Total primes annuelles <span style={{ fontWeight: 400, opacity: 0.75 }}>(acquis à date {fmtE(totADate)})</span>
                </td>
                <td className="op-num">{fmtE(totMax)}</td>
                <td className="op-num">{fmtE(totProj)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <div className="muted small" style={{ marginTop: '1mm' }}>
            Primes à paliers et zéro impayé calculées automatiquement (à date et en projection) ; primes qualitatives et Cerfa évaluées par la direction.
          </div>
        </section>
      )}

      {c.commentaire && (
        <section>
          <h2>Commentaire</h2>
          <div>{c.commentaire}</div>
        </section>
      )}

      <div className="sig">
        <div>Pour la direction — date et signature</div>
        <div>Le collaborateur — date et signature</div>
      </div>
      <div className="muted small" style={{ marginTop: '3mm', textAlign: 'center' }}>
        Document généré par le compagnon CEGECLIM · données de facturation arrêtées à {finMois}
      </div>
    </div>
  )
}
