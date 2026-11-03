'use client'

// ============================================================================
// components/suivi-agences/ContratsSuivi.tsx — bloc « Contrat d'objectifs » de la
// fiche agence / collaborateur de l'écran Suivi agences – commerciaux.
// Créé le 03/11/2026 (demandé par Arnaud) : la fiche reprend les principaux
// éléments de suivi des contrats d'objectifs (/objectifs/contrats) :
//   - collaborateur : objectif CA (perso ou agence), commission sur marge,
//     avances, solde, primes annuelles avec leur état (mêmes calculs que la
//     fiche contrat : lib/contratsObjectifs.ts, RPC get_obj_contrat) ;
//   - agence : contrats des collaborateurs de l'agence (get_obj_contrats_liste).
// Droits : ceux des contrats (obj_peut_lire) — un contrat hors périmètre ou
// absent affiche simplement un message.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { normAgence, type Entity } from '@/lib/suiviAgences'
import {
  MOIS,
  RESULTAT_LIBELLES,
  caObjectif,
  calculerContrat,
  etatPrime,
  fmtE,
  fmtK,
  fmtPct,
  type FicheContrat,
  type LigneListe,
  type Resultat,
} from '@/lib/contratsObjectifs'

const PASTILLE: Record<string, string> = {
  vert: 'bg-[#2F7A4A]',
  orange: 'bg-[#D99A2B]',
  rouge: 'bg-[#C1683C]',
  gris: 'bg-[#A8A49A]',
}

export default function ContratsSuivi({ entity, annee }: { entity: Entity; annee: number }) {
  if (entity.kind === 'collaborateur') return <ContratCollaborateur code={entity.id} annee={annee} />
  if (entity.kind === 'agence') return <ContratsAgence agence={entity.agence || entity.label} annee={annee} />
  return null
}

function lien(code: string, annee: number) {
  return `/objectifs/contrats?annee=${annee}&code=${encodeURIComponent(code)}`
}

function ContratCollaborateur({ code, annee }: { code: string; annee: number }) {
  const [f, setF] = useState<FicheContrat | null>(null)
  const [etat, setEtat] = useState<'chargement' | 'ok' | 'erreur'>('chargement')

  useEffect(() => {
    let annule = false
    setEtat('chargement')
    supabase.rpc('get_obj_contrat', { p_annee: annee, p_code: code }).then(({ data, error }) => {
      if (annule) return
      if (error) {
        setEtat('erreur')
        return
      }
      setF(data as FicheContrat)
      setEtat('ok')
    })
    return () => {
      annule = true
    }
  }, [code, annee])

  const calc = useMemo(() => (f?.contrat ? calculerContrat(f) : null), [f])

  if (etat === 'chargement') return <div className="text-[12px] text-slate-500">Chargement du contrat d’objectifs…</div>
  if (etat === 'erreur' || !f) return <div className="text-[12px] text-slate-500">Contrat d’objectifs non consultable pour ce collaborateur.</div>
  if (!f.contrat || !calc)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-500">
        <span>Pas de contrat d’objectifs {annee} pour ce collaborateur.</span>
        {f.modifier && (
          <a href={lien(code, annee)} className="font-semibold text-[#2D6F86] hover:underline">
            Créer le contrat →
          </a>
        )}
      </div>
    )

  const c = f.contrat
  const obj = caObjectif(f, calc)
  const pct = c.objectif_caht ? obj.realise / c.objectif_caht : null
  const pctProj = c.objectif_caht && obj.projection != null ? obj.projection / c.objectif_caht : null
  const etats = f.primes.map((p) => ({ p, e: etatPrime(p, f, calc) }))
  const totMax = etats.reduce((s, x) => s + x.e.montantMax, 0)
  const totProj = etats.reduce((s, x) => s + x.e.montantProjete, 0)
  const aEvaluer = etats.filter((x) => !x.e.evaluee && (x.p.indicateur === 'manuel' || x.p.indicateur === 'cerfa_complet')).length
  const finMois = MOIS[calc.moisCalc]?.toLowerCase() || '—'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-600">
        <span>
          Contrat {c.statut === 'signe' ? 'signé' : c.statut === 'brouillon' ? 'en brouillon' : 'validé'}
          {c.date_fin && <b className="text-[#B4501F]"> · fin le {new Date(c.date_fin).toLocaleDateString('fr-FR')}</b>}
          {' · '}situation à fin {finMois}
        </span>
        <a href={lien(code, annee)} className="font-semibold text-[#2D6F86] hover:underline">
          Ouvrir le contrat →
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tuile
          titre={obj.agence ? `Objectif CA agence` : 'Objectif CA HT'}
          valeur={fmtK(c.objectif_caht)}
          detail={`${fmtK(obj.realise)} réalisé · ${fmtPct(pct, 0)}${pctProj != null ? ` · proj. ${fmtPct(pctProj, 0)}` : ''}`}
          ton={pct != null && pct >= (calc.part || 0) ? 'vert' : 'neutre'}
          jauge={pct}
        />
        <Tuile titre={`Commission ${(c.taux_commission * 100).toLocaleString('fr-FR')} %`} valeur={fmtE(calc.commissionAcquise)} detail={`marge ${fmtK(calc.margeTotal)}`} />
        <Tuile titre="Avances versées" valeur={fmtE(calc.avancesADate)} detail={`${fmtE(calc.avance)} / mois · ${calc.moisCalc} mois`} />
        <Tuile
          titre="Solde prime à date"
          valeur={fmtE(calc.soldeADate)}
          detail={`régul projetée ${fmtE(calc.soldeProjete)}`}
          ton={calc.soldeADate >= 0 ? 'vert' : 'rouge'}
        />
        <Tuile
          titre="Primes annuelles"
          valeur={`${fmtE(totProj)}`}
          detail={`probables sur ${fmtE(totMax)}${aEvaluer ? ` · ${aEvaluer} à évaluer` : ''}`}
          ton={aEvaluer ? 'orange' : 'neutre'}
        />
      </div>

      {etats.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#E2DFD8]">
          <table className="w-full text-[12px]">
            <tbody>
              {etats.map(({ p, e }, i) => (
                <tr key={p.id || i} className="border-t border-[#EEEBE4] first:border-t-0 align-top">
                  <td className="w-[34%] px-3 py-1.5">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${PASTILLE[e.statut]}`} />
                      <div>
                        <div className="font-semibold text-[#0B1220]">{p.libelle}</div>
                        {p.description && <div className="text-[11px] text-slate-500">{p.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {e.evaluee ? (
                      <span>
                        <b>{RESULTAT_LIBELLES[p.resultat as Resultat]}</b> par la direction{p.commentaire_evaluation ? ` · « ${p.commentaire_evaluation} »` : ''}
                      </span>
                    ) : p.indicateur === 'manuel' || p.indicateur === 'cerfa_complet' ? (
                      <span className="font-semibold text-[#8A5A12]">À évaluer par la direction</span>
                    ) : (
                      e.texte
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    <b>{fmtE(e.montantProjete)}</b>
                    <span className="text-slate-400"> / {fmtE(e.montantMax)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ContratsAgence({ agence, annee }: { agence: string; annee: number }) {
  const [rows, setRows] = useState<LigneListe[] | null>(null)
  const [moisClos, setMoisClos] = useState(0)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let annule = false
    setRows(null)
    supabase.rpc('get_obj_contrats_liste', { p_annee: annee }).then(({ data, error }) => {
      if (annule) return
      if (error) {
        setErr(true)
        return
      }
      const d = data as { mois_clos: number; rows: LigneListe[] }
      setMoisClos(d.mois_clos)
      setRows((d.rows || []).filter((r) => normAgence(r.agence) === normAgence(agence)))
    })
    return () => {
      annule = true
    }
  }, [agence, annee])

  if (err) return <div className="text-[12px] text-slate-500">Contrats d’objectifs non consultables.</div>
  if (!rows) return <div className="text-[12px] text-slate-500">Chargement des contrats…</div>
  if (rows.length === 0) return <div className="text-[12px] text-slate-500">Aucun contrat d’objectifs {annee} pour les collaborateurs de cette agence.</div>

  const somme = rows.filter((r) => r.perimetre_objectif === 'perso').reduce((s, r) => s + (r.objectif_caht || 0), 0)
  return (
    <div className="space-y-2">
      <div className="text-[12px] text-slate-600">
        Objectif de l’agence = somme des objectifs CA perso des contrats : <b className="tabular-nums">{fmtK(somme)}</b>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[#E2DFD8]">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead className="bg-[#F1EFE8] text-left text-[10px] uppercase tracking-[0.06em] text-slate-500">
            <tr>
              <th className="px-3 py-1.5">Collaborateur</th>
              <th className="px-3 py-1.5 text-right">Objectif</th>
              <th className="px-3 py-1.5 text-right">CA à date</th>
              <th className="px-3 py-1.5 text-right">Avancement</th>
              <th className="px-3 py-1.5 text-right">Commission</th>
              <th className="px-3 py-1.5 text-right">Solde</th>
              <th className="px-3 py-1.5 text-center">À évaluer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const mc = r.mois_calc ?? moisClos
              const com = r.marge * r.taux_commission
              const solde = com - r.avance_mensuelle * mc
              const pct = r.objectif_caht ? r.ca_objectif / r.objectif_caht : null
              return (
                <tr key={r.id} className="border-t border-[#EEEBE4]">
                  <td className="px-3 py-1.5">
                    <a href={lien(r.code, annee)} className="font-semibold text-[#0B1220] hover:underline">
                      {r.nom}
                    </a>
                    {r.perimetre_objectif === 'agence' && <span className="ml-1 text-[10px] font-semibold uppercase text-[#2D6F86]">obj. CA agence</span>}
                    {r.date_fin && <span className="ml-1 text-[10px] font-semibold text-[#B4501F]">fin {new Date(r.date_fin).toLocaleDateString('fr-FR')}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtK(r.objectif_caht)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtK(r.ca_objectif)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(pct, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtE(com)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${solde >= 0 ? 'text-[#2F7A4A]' : 'text-[#C1683C]'}`}>{fmtE(solde)}</td>
                  <td className="px-3 py-1.5 text-center">{r.nb_a_evaluer || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Tuile({
  titre,
  valeur,
  detail,
  ton = 'neutre',
  jauge,
}: {
  titre: string
  valeur: string
  detail?: string
  ton?: 'vert' | 'rouge' | 'orange' | 'neutre'
  jauge?: number | null
}) {
  const couleur = ton === 'vert' ? 'text-[#1F5A35]' : ton === 'rouge' ? 'text-[#8A3A1C]' : ton === 'orange' ? 'text-[#8A5A12]' : 'text-[#0B1220]'
  return (
    <div className="rounded-lg border border-[#E2DFD8] bg-[#FBFAF7] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{titre}</div>
      <div className={`mt-0.5 text-[16px] font-bold tabular-nums ${couleur}`}>{valeur}</div>
      {jauge != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#E7E3DA]">
          <div className={`h-full rounded-full ${jauge >= 1 ? 'bg-[#2F7A4A]' : 'bg-[#2D6F86]'}`} style={{ width: `${Math.min(100, jauge * 100)}%` }} />
        </div>
      )}
      {detail && <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div>}
    </div>
  )
}
