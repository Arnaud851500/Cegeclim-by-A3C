'use client'

/**
 * Synthèse niveau 2 / niveau 3 — Hotline technique (/hotline/escalades).
 * Créé le 04/11/2026. Droit can_hotline_expert (profil « Hotline niveau 2 »).
 *
 * - Compteurs : tickets en attente au niveau 2 et au niveau 3, plus ancienne
 *   escalade, demandes de pièces au SAV en attente.
 * - Liste des tickets escaladés (niveau ≥ 2, non résolus par défaut) : âge
 *   depuis l'escalade, client, chantier, produit, préconisation, dernière
 *   étape ; reprise dans la console (?ticket=) ou fiche du ticket.
 * - Demandes de pièces (hotline_demandes_pieces) : marquer expédiée / annulée.
 * - Classification (08/11/2026) : filtres symptôme / organe / action / issue
 *   avec compteurs, colonne Classification, répartition cliquable des tickets
 *   affichés.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import HotlineHeader, { HotlineErreur, Pastille } from '@/components/hotline/HotlineHeader'
import { useClassification } from '@/components/hotline/ClassificationTicket'
import FiltresClassification, { FILTRE_CLASSIF_VIDE, compterClassif, passeFiltres, type FiltreClassif } from '@/components/hotline/FiltresClassification'
import {
  ETAPE_LIBELLES,
  FILIERES,
  styleStatut,
  estResolu,
  chargerCollaborateurs,
  COLLABORATEURS_VIDE,
  nomCollaborateur,
  type Collaborateurs,
  chargerDemandesPieces,
  fmtDateHeure,
  fmtHeures,
  libelleClassif,
  libelleFiliere,
  libelleGamme,
  libelleMotif,
  majDemandePiece,
  messageErreur,
  type AxeClassif,
  type DemandePiece,
  type Etape,
  type Filiere,
  type Ticket,
} from '@/lib/hotline'

type Niveau = 0 | 2 | 3

const carte = 'rounded-2xl border border-[#E2DFD8] bg-white'

export default function HotlineEscalades() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [dernieres, setDernieres] = useState<Record<string, Etape>>({})
  const [demandes, setDemandes] = useState<DemandePiece[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [niveau, setNiveau] = useState<Niveau>(0)
  const [filiere, setFiliere] = useState<Filiere | 'TOUTES'>('TOUTES')
  const [avecResolus, setAvecResolus] = useState(false)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [classifF, setClassifF] = useState<FiltreClassif>(FILTRE_CLASSIF_VIDE)
  const { classif } = useClassification()
  // (12/11/2026) Nom du collaborateur à qui le ticket a été escaladé.
  const [collaborateurs, setCollaborateurs] = useState<Collaborateurs>(COLLABORATEURS_VIDE)
  useEffect(() => {
    chargerCollaborateurs().then(setCollaborateurs).catch(() => undefined)
  }, [])

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      let q = supabase.from('hotline_tickets').select('*').gte('niveau', 2).order('escalated_at', { ascending: true, nullsFirst: false }).limit(500)
      if (!avecResolus) q = q.neq('statut', 'RESOLU')
      const { data, error } = await q
      if (error) throw error
      const liste = (data || []) as Ticket[]
      setTickets(liste)
      if (liste.length) {
        const { data: et, error: e2 } = await supabase
          .from('hotline_ticket_etapes')
          .select('*')
          .in('ticket_id', liste.map((t) => t.id))
          .order('at', { ascending: false })
          .limit(2000)
        if (e2) throw e2
        const map: Record<string, Etape> = {}
        ;((et || []) as Etape[]).forEach((e) => {
          if (!map[e.ticket_id]) map[e.ticket_id] = e
        })
        setDernieres(map)
      } else setDernieres({})
      setDemandes(await chargerDemandesPieces())
      setMaintenant(Date.now())
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setChargement(false)
    }
  }, [avecResolus])

  useEffect(() => {
    void charger()
    const t = window.setInterval(() => void charger(), 60_000)
    return () => window.clearInterval(t)
  }, [charger])

  // Tickets du niveau / de la filière choisis, avant les filtres de classification :
  // base des compteurs affichés dans les listes déroulantes et la répartition.
  const perimetre = useMemo(
    () => tickets.filter((t) => (!niveau || t.niveau === niveau) && (filiere === 'TOUTES' || t.filiere === filiere)),
    [tickets, niveau, filiere],
  )
  const visibles = useMemo(() => perimetre.filter((t) => passeFiltres(t, classifF)), [perimetre, classifF])
  const compteurs = useMemo(() => compterClassif(perimetre), [perimetre])
  const repartition = useMemo(() => compterClassif(visibles), [visibles])

  const kpi = useMemo(() => {
    const actifs = tickets.filter((t) => !estResolu(t))
    const ages = actifs.map((t) => maintenant - new Date(t.escalated_at || t.opened_at).getTime())
    return {
      n2: actifs.filter((t) => t.niveau === 2).length,
      n3: actifs.filter((t) => t.niveau === 3).length,
      plusAncien: ages.length ? Math.max(...ages) / 3_600_000 : null,
      moyen: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length / 3_600_000 : null,
      pieces: demandes.filter((d) => d.statut === 'DEMANDEE').length,
    }
  }, [tickets, demandes, maintenant])

  async function changerDemande(d: DemandePiece, statut: DemandePiece['statut']) {
    try {
      await majDemandePiece(d, statut)
      setDemandes((l) => l.map((x) => (x.id === d.id ? { ...x, statut } : x)))
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader
        titre="Synthèse niveau 2 / niveau 3"
        sousTitre="Tickets escaladés en attente de prise en charge et demandes de pièces au SAV — actualisé chaque minute"
        actions={
          <button type="button" onClick={() => void charger()} className="h-9 rounded-lg border border-[color:var(--cg-hdr-line)] px-3 text-sm font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A]">
            {chargement ? 'Actualisation…' : 'Actualiser'}
          </button>
        }
      />

      <main className="mx-auto w-full max-w-[1760px] space-y-4 px-4 py-5 md:px-8">
        {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="En attente niveau 2" valeur={kpi.n2} ton="#8A5A11" onClick={() => setNiveau(niveau === 2 ? 0 : 2)} actif={niveau === 2} />
          <Kpi label="En attente niveau 3" valeur={kpi.n3} ton="#A32C2C" onClick={() => setNiveau(niveau === 3 ? 0 : 3)} actif={niveau === 3} />
          <Kpi label="Plus ancienne escalade" valeur={kpi.plusAncien === null ? '—' : fmtHeures(kpi.plusAncien)} ton="#0B1220" />
          <Kpi label="Attente moyenne" valeur={kpi.moyen === null ? '—' : fmtHeures(kpi.moyen)} ton="#0B1220" />
          <Kpi label="Pièces demandées au SAV" valeur={kpi.pieces} ton="#C1683C" />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5">
            {([0, 2, 3] as Niveau[]).map((n) => (
              <button key={n} type="button" onClick={() => setNiveau(n)} className={`rounded-md px-3 py-1 font-semibold ${niveau === n ? 'bg-[#0B1220] text-white' : 'text-slate-600'}`}>
                {n ? `Niveau ${n}` : 'Niveaux 2 et 3'}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5">
            {(['TOUTES', ...FILIERES.map((f) => f.value)] as Array<Filiere | 'TOUTES'>).map((f) => (
              <button key={f} type="button" onClick={() => setFiliere(f)} className={`rounded-md px-3 py-1 font-semibold ${filiere === f ? 'bg-[#0B1220] text-white' : 'text-slate-600'}`}>
                {f === 'TOUTES' ? 'Toutes filières' : FILIERES.find((x) => x.value === f)?.court}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" checked={avecResolus} onChange={(e) => setAvecResolus(e.target.checked)} className="h-4 w-4 accent-[#B4761A]" />
            Inclure les tickets résolus
          </label>
          <span className="ml-auto text-[12px] text-slate-500">{visibles.length} ticket{visibles.length > 1 ? 's' : ''}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">Classification</span>
          <FiltresClassification valeur={classifF} onChange={setClassifF} classif={classif} compteurs={compteurs} />
        </div>

        {visibles.length ? (
          <section className={`${carte} grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-4`}>
            {(
              [
                ['symptome', 'Symptômes'],
                ['organe', 'Organes défaillants'],
                ['action', 'Actions menées'],
                ['issue', 'Issues'],
              ] as Array<[AxeClassif, string]>
            ).map(([axe, titre]) => {
              const lignes = Object.entries(repartition[axe]).sort((a, b) => Number(a[0] === '-') - Number(b[0] === '-') || b[1] - a[1])
              const max = Math.max(1, ...lignes.map(([, n]) => n))
              return (
                <div key={axe}>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-slate-500">{titre}</div>
                  <div className="space-y-1">
                    {lignes.slice(0, 6).map(([code, n]) => {
                      const actif = classifF[axe] === code
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setClassifF({ ...classifF, [axe]: actif ? '' : code })}
                          title={actif ? 'Retirer ce filtre' : 'Filtrer sur cette valeur'}
                          className={`block w-full rounded-md px-1.5 py-0.5 text-left text-[12px] hover:bg-[#F4F1EA] ${actif ? 'bg-[#EEF2F8]' : ''}`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`truncate ${code === '-' ? 'text-slate-400' : 'text-slate-700'}`}>{code === '-' ? 'Non renseigné' : libelleClassif(classif, axe, code)}</span>
                            <span className="tabular-nums font-semibold text-slate-900">{n}</span>
                          </div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-[#F1EFEA]">
                            <div className="h-1.5 rounded-full" style={{ width: `${(100 * n) / max}%`, background: code === '-' ? '#C9C4BA' : '#1E4E8C' }} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        ) : null}

        <section className={`${carte} overflow-x-auto`}>
          <table className="w-full min-w-[1400px] text-[12px]">
            <thead className="bg-[#FAF9F7] text-left text-[11px] uppercase tracking-[0.05em] text-slate-500">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Niveau</th>
                <th className="px-3 py-2">Attente</th>
                <th className="px-3 py-2">Filière</th>
                <th className="px-3 py-2">Client / chantier</th>
                <th className="px-3 py-2">Produit</th>
                <th className="px-3 py-2">Classification</th>
                <th className="px-3 py-2">Motif d’escalade / préconisation</th>
                <th className="px-3 py-2">Dernière étape</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1EFEA]">
              {visibles.map((t) => {
                const depuis = t.escalated_at || t.opened_at
                const heures = (maintenant - new Date(depuis).getTime()) / 3_600_000
                const der = dernieres[t.id]
                const st = styleStatut(t.statut)
                return (
                  <tr key={t.id} className="align-top hover:bg-[#FDFCFA]">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{t.numero}</div>
                      <Pastille {...st} />
                      {t.assigne_a ? <div className="mt-0.5 text-[11px] text-slate-500">→ {nomCollaborateur(t.assigne_a, collaborateurs)}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.niveau === 3 ? 'bg-[#FCE9E6] text-[#A32C2C]' : 'bg-[#FDF2DD] text-[#8A5A11]'}`}>N{t.niveau}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className={`font-semibold ${heures > 48 ? 'text-[#A32C2C]' : heures > 8 ? 'text-[#8A5A11]' : 'text-slate-800'}`}>{fmtHeures(heures)}</div>
                      <div className="text-[11px] text-slate-400">depuis {fmtDateHeure(depuis)}</div>
                    </td>
                    <td className="px-3 py-2">
                      {libelleFiliere(t.filiere)}
                      {t.gamme ? ` ${libelleGamme(t.gamme)}` : ''}
                      <div className="text-[11px] text-slate-500">{libelleMotif(t.motif)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800">{t.intitule_tiers || t.numero_tiers || '—'}</div>
                      <div className="text-slate-500">{[t.contact_nom, t.chantier && `chantier ${t.chantier}`].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{[t.reference_article, t.numero_serie].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="max-w-[240px] px-3 py-2">
                      {t.symptome || t.organe || t.issue || t.actions?.length ? (
                        <>
                          <div className="text-slate-800">{[libelleClassif(classif, 'symptome', t.symptome), libelleClassif(classif, 'organe', t.organe)].filter(Boolean).join(' · ') || '—'}</div>
                          {t.actions?.length ? <div className="text-[11px] text-slate-500">{t.actions.map((a) => libelleClassif(classif, 'action', a)).join(', ')}</div> : null}
                          {t.issue ? <div className="font-semibold text-[#1E4E8C]">→ {libelleClassif(classif, 'issue', t.issue)}</div> : null}
                        </>
                      ) : (
                        <span className="text-slate-400">À classer</span>
                      )}
                    </td>
                    <td className="max-w-[320px] px-3 py-2 text-slate-700">{t.preconisation || t.description || '—'}</td>
                    <td className="max-w-[280px] px-3 py-2 text-slate-600">
                      {der ? (
                        <>
                          <span className="font-semibold text-slate-700">{ETAPE_LIBELLES[der.type]}</span> {der.libelle}
                          <div className="text-[11px] text-slate-400">
                            {fmtDateHeure(der.at)} · {der.auteur.split('@')[0]}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link href={`/hotline?ticket=${t.id}`} className="rounded-md bg-[#B4761A] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#9A6414]">
                        Prendre en charge
                      </Link>
                      <Link href={`/hotline/tickets?id=${t.id}`} className="ml-2 text-[12px] font-semibold text-slate-500 underline">
                        Fiche
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {!visibles.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-[13px] text-slate-500">
                    {chargement ? 'Chargement…' : perimetre.length ? 'Aucun ticket pour ces filtres de classification.' : 'Aucun ticket escaladé en attente.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className={carte}>
          <div className="border-b border-[#EFEDE8] px-4 py-3 text-[14px] font-bold text-slate-900">Demandes de pièces au SAV</div>
          {demandes.length ? (
            <table className="w-full text-[12px]">
              <thead className="bg-[#FAF9F7] text-left text-[11px] uppercase tracking-[0.05em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Demandée le</th>
                  <th className="px-3 py-2">Pièce</th>
                  <th className="px-3 py-2">Qté</th>
                  <th className="px-3 py-2">Pour</th>
                  <th className="px-3 py-2">Précision</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EFEA]">
                {demandes.slice(0, 50).map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-slate-600">
                      {fmtDateHeure(d.demande_le)}
                      <div className="text-[11px] text-slate-400">{d.demande_par.split('@')[0]}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800">
                        {d.repere ? `Repère ${d.repere} — ` : ''}
                        {d.libelle}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {[d.reference_piece, d.reference_article].filter(Boolean).join(' · ')}
                        {d.simulation ? <span className="ml-2 font-sans font-bold text-[#8A5A11]">SIMULATION</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{d.quantite}</td>
                    <td className="px-3 py-2">
                      {d.intitule_tiers || d.numero_tiers || '—'}
                      {d.chantier ? <div className="text-slate-500">chantier {d.chantier}</div> : null}
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-slate-600">{d.commentaire || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={d.statut === 'EXPEDIEE' ? 'font-semibold text-[#2F6B3A]' : d.statut === 'ANNULEE' ? 'text-slate-400' : 'font-semibold text-[#C1683C]'}>
                        {d.statut === 'EXPEDIEE' ? 'Expédiée' : d.statut === 'ANNULEE' ? 'Annulée' : 'À expédier'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {d.statut === 'DEMANDEE' ? (
                        <>
                          <button type="button" onClick={() => changerDemande(d, 'EXPEDIEE')} className="rounded-md bg-[#2F6B3A] px-2.5 py-1 text-[12px] font-semibold text-white">
                            Marquer expédiée
                          </button>
                          <button type="button" onClick={() => changerDemande(d, 'ANNULEE')} className="ml-2 text-[12px] font-semibold text-slate-500 underline">
                            Annuler
                          </button>
                        </>
                      ) : null}
                      {d.ticket_id ? (
                        <Link href={`/hotline/tickets?id=${d.ticket_id}`} className="ml-2 text-[12px] font-semibold text-slate-500 underline">
                          Ticket
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-[13px] text-slate-500">Aucune demande de pièce. Elles se créent depuis la vue éclatée de la console d’appel.</p>
          )}
        </section>
      </main>
    </div>
  )
}

function Kpi({ label, valeur, ton, onClick, actif }: { label: string; valeur: number | string; ton: string; onClick?: () => void; actif?: boolean }) {
  const contenu = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</div>
      <div className="mt-1 text-[26px] font-bold leading-none" style={{ color: ton }}>
        {valeur}
      </div>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={`${carte} px-4 py-3 text-left hover:border-[#B4761A] ${actif ? 'ring-2 ring-[#B4761A]' : ''}`}>
      {contenu}
    </button>
  ) : (
    <div className={`${carte} px-4 py-3`}>{contenu}</div>
  )
}
