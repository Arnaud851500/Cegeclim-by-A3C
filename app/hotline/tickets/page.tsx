'use client'

/**
 * Tickets — Hotline technique / SAV (/hotline/tickets). Créé le 02/11/2026.
 *
 * Pipe des tickets : filtres filière / statut / niveau / « mes tickets »,
 * recherche (n°, client, chantier, n° de série), fiche détaillée à droite avec
 * la chronologie horodatée et les actions (prendre en charge, escalader,
 * résoudre, clore, rouvrir, commentaire). URL : ?id=<ticket>.
 * Suppression définitive d'un ticket (04/11/2026) : réservée au compte
 * valancha@gmail.com et a.valanchauskas@cegeclim-energies.com (RPC hotline_supprimer_ticket, migration 20261104b).
 * Revue du 12/11/2026 : plus d'état « Clos » (résolu = clos), colonne « Motif
 * de l'appel » (note rapide), rappels confiés à un N1 (filtre « Mes rappels »,
 * ?rappels=1), escalade vers un collaborateur N2 choisi, retour au niveau
 * inférieur, commentaire interne, historique complet et fiche ticket PDF.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur, Pastille } from '@/components/hotline/HotlineHeader'
import PiecesJointes from '@/components/hotline/PiecesJointes'
import HistoriqueTicket from '@/components/hotline/HistoriqueTicket'
import FenetreNiveau from '@/components/hotline/FenetreNiveau'
import { telechargerFicheTicket } from '@/lib/hotlineFiche'
import FiltresClassification, { FILTRE_CLASSIF_VIDE, type FiltreClassif } from '@/components/hotline/FiltresClassification'
import ClassificationTicket, { patchClassif, useClassification, valeursDepuisTicket, type ValeursClassif } from '@/components/hotline/ClassificationTicket'
import {
  FILIERES,
  GAMMES,
  NATURES,
  STATUTS,
  styleStatut,
  estResolu,
  ajouterEtape,
  chargerEtapes,
  chargerCollaborateurs,
  COLLABORATEURS_VIDE,
  nomCollaborateur,
  demanderRappel,
  rappelEffectue,
  redescendre,
  escalader,
  fmtDateHeure,
  fmtDuree,
  fmtTel,
  issueRequise,
  libelleClassif,
  libelleFiliere,
  libelleGamme,
  libelleMotif,
  libelleNature,
  majTicket,
  messageErreur,
  resoudre,
  rouvrir,
  type Collaborateurs,
  type Etape,
  type Filiere,
  type Statut,
  type Ticket,
} from '@/lib/hotline'

type FiltreStatut = 'ACTIFS' | Statut | 'TOUS'

export default function HotlineTicketsWrapper() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Chargement…</div>}>
      <HotlineTickets />
    </Suspense>
  )
}

function HotlineTickets() {
  const router = useRouter()
  const params = useSearchParams()
  const selectedId = params.get('id')
  const { email } = useAccess()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [filiere, setFiliere] = useState<Filiere | 'TOUTES'>('TOUTES')
  const [statut, setStatut] = useState<FiltreStatut>('ACTIFS')
  const [niveau, setNiveau] = useState<number | 0>(0)
  const [mesTickets, setMesTickets] = useState(false)
  // (12/11/2026) Tickets dont le client est à rappeler par moi.
  const [mesRappels, setMesRappels] = useState(params.get('rappels') === '1')
  const [collaborateurs, setCollaborateurs] = useState<Collaborateurs>(COLLABORATEURS_VIDE)
  useEffect(() => {
    chargerCollaborateurs().then(setCollaborateurs).catch(() => undefined)
  }, [])
  // Lien « 📞 clients à rappeler » de l'en-tête.
  const rappelsDemandes = params.get('rappels') === '1'
  useEffect(() => {
    if (rappelsDemandes) setMesRappels(true)
  }, [rappelsDemandes])
  const [recherche, setRecherche] = useState('')
  // Filtres de classification (08/11/2026) : '' = tous, '-' = non renseigné.
  const [classifF, setClassifF] = useState<FiltreClassif>(FILTRE_CLASSIF_VIDE)
  const [natureF, setNatureF] = useState('')
  const [gammeF, setGammeF] = useState('')
  const { classif } = useClassification()
  // Filtre sur la date de création (06/11/2026) : bornes incluses, dates locales AAAA-MM-JJ.
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')

  const charger = useCallback(async () => {
    setLoading(true)
    try {
      // Jusqu'à 10 000 tickets, lus par pages de 1 000 (plafond de l'API).
      const MAX = 10_000
      const PAGE = 1_000
      const tous: Ticket[] = []
      for (let debut = 0; debut < MAX; debut += PAGE) {
        let query = supabase.from('hotline_tickets').select('*').order('opened_at', { ascending: false }).order('id').range(debut, debut + PAGE - 1)
        if (filiere !== 'TOUTES') query = query.eq('filiere', filiere)
        if (statut === 'ACTIFS') query = query.in('statut', ['OUVERT', 'EN_COURS', 'ESCALADE'])
        else if (statut !== 'TOUS') query = query.eq('statut', statut)
        if (niveau) query = query.eq('niveau', niveau)
        if (mesTickets && email) query = query.eq('assigne_a', email)
        if (mesRappels && email) query = query.eq('rappel_par', email)
        if (du) query = query.gte('opened_at', new Date(`${du}T00:00:00`).toISOString())
        if (au) query = query.lt('opened_at', new Date(new Date(`${au}T00:00:00`).getTime() + 86_400_000).toISOString())
        for (const [col, v] of [['symptome', classifF.symptome], ['organe', classifF.organe], ['issue', classifF.issue], ['nature', natureF], ['gamme', gammeF]] as const) {
          if (v === '-') query = query.is(col, null)
          else if (v) query = query.eq(col, v)
        }
        if (classifF.action === '-') query = query.is('actions', null)
        else if (classifF.action) query = query.contains('actions', [classifF.action])
        const { data, error } = await query
        if (error) throw error
        const lot = (data || []) as Ticket[]
        tous.push(...lot)
        if (lot.length < PAGE) break
      }
      setTickets(tous)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setLoading(false)
    }
  }, [filiere, statut, niveau, mesTickets, mesRappels, email, du, au, classifF, natureF, gammeF])

  useEffect(() => {
    void charger()
  }, [charger])

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return tickets
    return tickets.filter((t) =>
      [t.numero, t.intitule_tiers, t.numero_tiers, t.contact_nom, t.chantier, t.numero_serie, t.serie_ge, t.modele_ge, t.reference_article, t.code_defaut, t.telephone_appelant, t.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [tickets, recherche])

  const compteurs = useMemo(() => {
    const c = { n1: 0, n2: 0, n3: 0, escalades: 0, rappels: 0 }
    tickets.forEach((t) => {
      if (t.rappel_par && email && t.rappel_par.toLowerCase() === email.toLowerCase()) c.rappels += 1
      if (t.niveau === 1) c.n1 += 1
      if (t.niveau === 2) c.n2 += 1
      if (t.niveau === 3) c.n3 += 1
      if (t.statut === 'ESCALADE') c.escalades += 1
    })
    return c
  }, [tickets, email])

  function ouvrir(id: string | null) {
    router.replace(id ? `/hotline/tickets?id=${id}` : '/hotline/tickets', { scroll: false })
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader
        titre="Tickets"
        sousTitre="Suivi des tickets ouverts, escalades niveau 2 / niveau 3 et historique"
        actions={
          ['valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com'].includes(String(email || '').toLowerCase()) ? (
            <Link href="/hotline/import" className="h-9 rounded-lg border border-[color:var(--cg-hdr-line)] px-3 py-1.5 text-sm font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A]">
              Reprendre l’historique
            </Link>
          ) : null
        }
      />

      <div className="border-b border-[#E2DFD8] bg-[#F4F3F0]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-center gap-2 px-4 py-2 md:px-8">
          <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[13px]">
            {(['TOUTES', ...FILIERES.map((f) => f.value)] as Array<Filiere | 'TOUTES'>).map((f) => (
              <button key={f} type="button" onClick={() => setFiliere(f)} className={`rounded-md px-3 py-1 font-semibold ${filiere === f ? 'bg-[#0B1220] text-white' : 'text-slate-600'}`}>
                {f === 'TOUTES' ? 'Toutes filières' : libelleFiliere(f)}
              </button>
            ))}
          </div>
          <select value={statut} onChange={(e) => setStatut(e.target.value as FiltreStatut)} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[13px]">
            <option value="ACTIFS">Non résolus (ouverts, en cours, escaladés)</option>
            {(Object.keys(STATUTS) as Statut[]).map((s) => (
              <option key={s} value={s}>
                {STATUTS[s].label}
              </option>
            ))}
            <option value="TOUS">Tous les statuts</option>
          </select>
          <select value={niveau} onChange={(e) => setNiveau(Number(e.target.value))} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[13px]">
            <option value={0}>Tous niveaux</option>
            <option value={1}>Niveau 1</option>
            <option value={2}>Niveau 2</option>
            <option value={3}>Niveau 3</option>
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <input type="checkbox" checked={mesTickets} onChange={(e) => setMesTickets(e.target.checked)} className="h-3.5 w-3.5 accent-[#B4761A]" />
            Mes tickets
          </label>
          <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#5B3F8C]">
            <input type="checkbox" checked={mesRappels} onChange={(e) => setMesRappels(e.target.checked)} className="h-3.5 w-3.5 accent-[#7A5EA8]" />
            📞 Mes rappels
          </label>
          <div className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <span className="font-semibold">Créés du</span>
            <input type="date" value={du} max={au || undefined} onChange={(e) => setDu(e.target.value)} className="h-9 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[12px] text-slate-900" />
            <span className="font-semibold">au</span>
            <input type="date" value={au} min={du || undefined} onChange={(e) => setAu(e.target.value)} className="h-9 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[12px] text-slate-900" />
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value
                const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                const auj = new Date()
                if (v === 'AUJ') {
                  setDu(iso(auj))
                  setAu(iso(auj))
                } else if (v === 'HIER') {
                  const h = new Date(auj.getTime() - 86_400_000)
                  setDu(iso(h))
                  setAu(iso(h))
                } else if (v === '7J' || v === '30J') {
                  setDu(iso(new Date(auj.getTime() - (v === '7J' ? 6 : 29) * 86_400_000)))
                  setAu(iso(auj))
                } else if (v === 'MOIS') {
                  setDu(iso(new Date(auj.getFullYear(), auj.getMonth(), 1)))
                  setAu(iso(auj))
                } else if (v === 'MOIS_PREC') {
                  setDu(iso(new Date(auj.getFullYear(), auj.getMonth() - 1, 1)))
                  setAu(iso(new Date(auj.getFullYear(), auj.getMonth(), 0)))
                } else if (v === 'ANNEE') {
                  setDu(iso(new Date(auj.getFullYear(), 0, 1)))
                  setAu(iso(auj))
                } else if (v === 'TOUT') {
                  setDu('')
                  setAu('')
                }
              }}
              className="h-9 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[12px] text-slate-700"
            >
              <option value="">Période…</option>
              <option value="AUJ">Aujourd’hui</option>
              <option value="HIER">Hier</option>
              <option value="7J">7 derniers jours</option>
              <option value="30J">30 derniers jours</option>
              <option value="MOIS">Ce mois-ci</option>
              <option value="MOIS_PREC">Mois précédent</option>
              <option value="ANNEE">Depuis le 1er janvier</option>
              <option value="TOUT">Toutes les dates</option>
            </select>
            {du || au ? (
              <button type="button" onClick={() => { setDu(''); setAu('') }} className="font-semibold text-slate-500 underline">
                Effacer
              </button>
            ) : null}
          </div>
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="N° ticket, client, chantier, n° de série…"
            className="ml-auto h-8 w-full max-w-[320px] rounded-lg border border-[#D8D3C8] bg-white px-2.5 text-[13px] outline-none focus:border-[#B4761A]"
          />
        </div>
        <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-center gap-2 px-4 pb-2 md:px-8">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">Classification</span>
          <select value={natureF} onChange={(e) => setNatureF(e.target.value)} className={`h-8 rounded-lg border bg-white px-2 text-[13px] ${natureF ? 'border-[#1E4E8C] font-semibold text-[#1E4E8C]' : 'border-[#D8D3C8] text-slate-700'}`}>
            <option value="">Toutes natures</option>
            <option value="-">Nature non renseignée</option>
            {NATURES.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </select>
          <select value={gammeF} onChange={(e) => setGammeF(e.target.value)} className={`h-8 rounded-lg border bg-white px-2 text-[13px] ${gammeF ? 'border-[#1E4E8C] font-semibold text-[#1E4E8C]' : 'border-[#D8D3C8] text-slate-700'}`}>
            <option value="">Toutes gammes</option>
            <option value="-">Gamme non renseignée</option>
            {GAMMES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <FiltresClassification valeur={classifF} onChange={setClassifF} classif={classif} />
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 md:px-8">
        {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            { label: 'Tickets affichés', value: filtres.length },
            { label: 'Niveau 1', value: compteurs.n1 },
            { label: 'Niveau 2', value: compteurs.n2 },
            { label: 'Niveau 3', value: compteurs.n3 },
            { label: 'En escalade', value: compteurs.escalades },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-[#E2DFD8] bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">{k.label}</div>
              <div className="mt-1 text-[22px] font-bold text-slate-900">{k.value}</div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMesRappels((v) => !v)}
            className={`rounded-xl border bg-white px-4 py-3 text-left hover:border-[#7A5EA8] ${mesRappels ? 'border-[#7A5EA8] ring-2 ring-[#D9CCEB]' : 'border-[#E2DFD8]'}`}
            title="Tickets dont le client est à rappeler par moi"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#5B3F8C]">📞 Rappels pour moi</div>
            <div className="mt-1 text-[22px] font-bold text-[#5B3F8C]">{compteurs.rappels}</div>
          </button>
        </div>

        <div className={`grid grid-cols-1 gap-4 ${selectedId ? 'xl:grid-cols-[minmax(0,1fr)_520px]' : ''}`}>
          <section className="min-w-0 rounded-2xl border border-[#E2DFD8] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-[13px]">
                <thead className="bg-[#FAF9F7] text-[11px] uppercase tracking-[0.05em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Ticket</th>
                    <th className="px-3 py-2 text-left">Ouvert</th>
                    <th className="px-3 py-2 text-left">Filière · motif</th>
                    <th className="px-3 py-2 text-left">Classification</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Motif de l’appel</th>
                    <th className="px-3 py-2 text-left">Chantier / n° série</th>
                    <th className="px-3 py-2 text-center">Niv.</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2 text-left">Assigné</th>
                    <th className="px-3 py-2 text-right">Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                        Chargement des tickets…
                      </td>
                    </tr>
                  ) : !filtres.length ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                        Aucun ticket pour ces filtres.
                      </td>
                    </tr>
                  ) : (
                    filtres.map((t) => (
                      <tr
                        key={t.id}
                        onClick={() => ouvrir(t.id)}
                        className={`cursor-pointer border-t border-[#EFEDE8] hover:bg-[#FDF7EA] ${t.id === selectedId ? 'bg-[#FDF7EA]' : ''}`}
                      >
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {t.numero}
                          {t.rappel_par ? (
                            <div className="text-[11px] font-semibold text-[#5B3F8C]" title="Client à rappeler">
                              📞 {nomCollaborateur(t.rappel_par, collaborateurs)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{fmtDateHeure(t.opened_at)}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {libelleFiliere(t.filiere)} <span className="text-slate-500">· {libelleMotif(t.motif)}</span>
                          {t.nature || t.gamme ? <div className="text-[11px] text-slate-500">{[libelleNature(t.nature), libelleGamme(t.gamme)].filter(Boolean).join(' · ')}</div> : null}
                        </td>
                        <td className="max-w-[260px] px-3 py-2 text-[12px]">
                          {t.symptome || t.organe || t.issue ? (
                            <>
                              <div className="text-slate-800">{[libelleClassif(classif, 'symptome', t.symptome), libelleClassif(classif, 'organe', t.organe)].filter(Boolean).join(' · ') || '—'}</div>
                              {t.issue ? <div className="font-semibold text-[#1E4E8C]">→ {libelleClassif(classif, 'issue', t.issue)}</div> : null}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{t.intitule_tiers || t.numero_tiers || fmtTel(t.telephone_appelant) || '—'}</div>
                          {t.contact_nom ? <div className="text-[11px] text-slate-500">{t.contact_nom}</div> : null}
                        </td>
                        <td className="max-w-[300px] px-3 py-2 text-[12px] text-slate-700">
                          <div className="line-clamp-2" title={t.description || undefined}>
                            {t.description || <span className="text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{[t.chantier, t.numero_serie].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-3 py-2 text-center font-semibold">N{t.niveau}</td>
                        <td className="px-3 py-2">
                          <Pastille {...styleStatut(t.statut)} />
                        </td>
                        <td className="px-3 py-2 text-[12px] text-slate-500">{t.assigne_a ? nomCollaborateur(t.assigne_a, collaborateurs) : '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtDuree(t.opened_at, t.resolved_at || t.closed_at || new Date().toISOString())}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selectedId ? (
            <FicheTicket
              id={selectedId}
              collaborateurs={collaborateurs}
              onClose={() => ouvrir(null)}
              onChange={charger}
              onSupprime={() => {
                ouvrir(null)
                void charger()
              }}
            />
          ) : null}
        </div>
      </main>
    </div>
  )
}

const SUPPRESSION_AUTORISEE = ['valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com']

function FicheTicket({
  id,
  collaborateurs,
  onClose,
  onChange,
  onSupprime,
}: {
  id: string
  collaborateurs: Collaborateurs
  onClose: () => void
  onChange: () => void
  onSupprime: () => void
}) {
  const { email } = useAccess()
  const [confirmerSuppression, setConfirmerSuppression] = useState(false)
  const peutSupprimer = SUPPRESSION_AUTORISEE.includes(String(email || '').toLowerCase())
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [etapes, setEtapes] = useState<Etape[]>([])
  const [commentaire, setCommentaire] = useState('')
  const [commentaireInterne, setCommentaireInterne] = useState('')
  const [fenetreNiveau, setFenetreNiveau] = useState<'escalade' | 'redescente' | null>(null)
  // N2 par défaut = département du client du ticket.
  const [collabTicket, setCollabTicket] = useState<Collaborateurs>(collaborateurs)
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const { classif } = useClassification()
  const [classifForm, setClassifForm] = useState<ValeursClassif>(valeursDepuisTicket(null))

  const charger = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('hotline_tickets').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      setTicket((data as Ticket) || null)
      setClassifForm(valeursDepuisTicket(data as Ticket | null))
      setEtapes(await chargerEtapes(id))
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }, [id])

  useEffect(() => {
    void charger()
  }, [charger])

  useEffect(() => {
    setCollabTicket(collaborateurs)
    if (!ticket?.numero_tiers) return
    chargerCollaborateurs(ticket.numero_tiers).then(setCollabTicket).catch(() => undefined)
  }, [ticket?.numero_tiers, collaborateurs])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      setCommentaire('')
      setCommentaireInterne('')
      await charger()
      onChange()
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function supprimer() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('hotline_supprimer_ticket', { p_ticket: id })
      if (error) throw error
      const chemins = ((data as { chemins?: string[] } | null)?.chemins || []).filter(Boolean)
      if (chemins.length) await supabase.storage.from('hotline-pieces').remove(chemins)
      onSupprime()
    } catch (e) {
      setErreur(messageErreur(e))
      setBusy(false)
    }
  }

  if (!ticket) {
    return <aside className="rounded-2xl border border-[#E2DFD8] bg-white p-6 text-sm text-slate-500">{erreur || 'Chargement du ticket…'}</aside>
  }

  const actif = !estResolu(ticket)
  const n1 = collaborateurs.liste.filter((c) => c.niveau === 1)
  const bouton = 'rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-40'

  return (
    <aside className="rounded-2xl border border-[#E2DFD8] bg-white xl:sticky xl:top-4 xl:self-start">
      <div className="flex items-start justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[16px] font-bold text-slate-900">
            {ticket.numero} <Pastille {...styleStatut(ticket.statut)} /> <span className="text-[13px] text-slate-500">N{ticket.niveau}</span>
          </div>
          <div className="text-[12px] text-slate-500">
            {libelleFiliere(ticket.filiere)} · {libelleMotif(ticket.motif)} · ouvert {fmtDateHeure(ticket.opened_at)} par {ticket.ouvert_par.split('@')[0]}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {peutSupprimer ? (
            confirmerSuppression ? (
              <span className="flex items-center gap-2 text-[12px]">
                <span className="font-semibold text-[#A32C2C]">Supprimer définitivement ?</span>
                <button type="button" disabled={busy} onClick={supprimer} className="rounded-md bg-[#A32C2C] px-2 py-1 font-semibold text-white disabled:opacity-50">
                  {busy ? '…' : 'Oui, supprimer'}
                </button>
                <button type="button" onClick={() => setConfirmerSuppression(false)} className="font-semibold text-slate-500 underline">
                  Non
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmerSuppression(true)} className="text-[13px] font-semibold text-[#A32C2C] hover:underline">
                Supprimer
              </button>
            )
          ) : null}
          <button type="button" onClick={onClose} className="text-[13px] font-semibold text-slate-500 hover:text-slate-900">
            Fermer ✕
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          {[
            ['Client', [ticket.intitule_tiers, ticket.numero_tiers].filter(Boolean).join(' · ')],
            ['Contact', ticket.contact_nom],
            ['Téléphone', fmtTel(ticket.telephone_appelant)],
            ['Chantier', ticket.chantier],
            ['Nature', libelleNature(ticket.nature)],
            ['Code défaut', ticket.code_defaut],
            ['GE', [ticket.modele_ge, ticket.serie_ge && `n° ${ticket.serie_ge}`].filter(Boolean).join(' · ')],
            ['UI', [ticket.reference_article, ticket.numero_serie && `n° ${ticket.numero_serie}`].filter(Boolean).join(' · ')],
            ['Mise en service', ticket.date_mes ? new Date(ticket.date_mes).toLocaleDateString('fr-FR') : ''],
            ['Assigné à', nomCollaborateur(ticket.assigne_a, collaborateurs)],
            ['1re action', fmtDuree(ticket.opened_at, ticket.first_action_at)],
            ['Résolution', fmtDuree(ticket.opened_at, ticket.resolved_at)],
            ['Escalade', ticket.escalated_at ? fmtDateHeure(ticket.escalated_at) : '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold uppercase tracking-[0.04em] text-slate-400">{k}</dt>
              <dd className="text-slate-800">{v || '—'}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D9CCEB] bg-[#F4F0FA] px-3 py-2 text-[12px] text-[#5B3F8C]">
          <span className="font-semibold">📞 Client à rappeler par</span>
          <select
            value={ticket.rappel_par || ''}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value
              void run(() => demanderRappel(ticket.id, v ? { email: v, nom: nomCollaborateur(v, collaborateurs) } : null))
            }}
            className="h-8 rounded-lg border border-[#D9CCEB] bg-white px-2 text-[12px] text-slate-800"
          >
            <option value="">— Pas de rappel —</option>
            {n1.map((c) => (
              <option key={c.email} value={c.email}>
                {c.nom}
              </option>
            ))}
            {ticket.rappel_par && !n1.some((c) => c.email === ticket.rappel_par) ? <option value={ticket.rappel_par}>{nomCollaborateur(ticket.rappel_par, collaborateurs)}</option> : null}
          </select>
          {ticket.rappel_par ? (
            <button type="button" disabled={busy} onClick={() => run(() => rappelEffectue(ticket.id, String(email || '').split('@')[0], commentaire.trim()))} className="font-semibold underline disabled:opacity-40">
              Rappel effectué
            </button>
          ) : null}
        </div>
        {ticket.preconisation ? (
          <div className="rounded-lg border border-[#CDE5D1] bg-[#EEF7EF] p-3 text-[13px] text-slate-800">
            <span className="font-semibold">Préconisation :</span> {ticket.preconisation}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => telechargerFicheTicket(ticket.id).catch((e) => setErreur(messageErreur(e)))}
          className="flex h-9 w-full items-center justify-center rounded-lg border border-[#D8D3C8] text-[13px] font-semibold text-slate-700 hover:border-[#B4761A]"
          title="Fiche ticket PDF : tout l'historique, sans les commentaires internes"
        >
          Fiche ticket PDF
        </button>

        <a
          href={`/hotline?ticket=${ticket.id}`}
          className="flex h-10 w-full items-center justify-center rounded-lg bg-[#B4761A] text-[14px] font-bold text-white hover:bg-[#9A6414]"
          title="Recharge le ticket dans la console : documents de vente, historiques, envoi de documents et diagnostic là où il s'était arrêté"
        >
          {actif ? 'Reprendre dans la console' : 'Rouvrir dans la console'}
        </a>

        <div className="flex flex-wrap gap-2">
          {ticket.assigne_a !== email ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await majTicket(ticket.id, { assigne_a: email, statut: ticket.statut === 'OUVERT' || ticket.statut === 'ESCALADE' ? 'EN_COURS' : ticket.statut })
                  await ajouterEtape(ticket.id, 'COMMENTAIRE', `Pris en charge par ${String(email || '').split('@')[0]} (niveau ${ticket.niveau})`)
                })
              }
              className={`${bouton} bg-[#0B1220] text-white`}
            >
              Prendre en charge
            </button>
          ) : null}
          {actif ? (
            <>
              <button type="button" disabled={busy || ticket.niveau >= 3} onClick={() => setFenetreNiveau('escalade')} className={`${bouton} bg-[#C1683C] text-white`}>
                Escalader N{Math.min(3, ticket.niveau + 1)}
              </button>
              {ticket.niveau >= 2 ? (
                <button type="button" disabled={busy} onClick={() => setFenetreNiveau('redescente')} className={`${bouton} bg-[#1E4E8C] text-white`}>
                  Redescendre N{ticket.niveau - 1}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || (issueRequise(ticket) && !classifForm.issue)}
                title={issueRequise(ticket) && !classifForm.issue ? 'Choisir d’abord l’issue dans le bloc Classification' : undefined}
                onClick={() =>
                  run(async () => {
                    await majTicket(ticket.id, patchClassif(classifForm))
                    await resoudre(ticket.id, commentaire || ticket.preconisation || '')
                  })
                }
                className={`${bouton} bg-[#2F6B3A] text-white`}
              >
                Résolu
              </button>
            </>
          ) : null}
          {!actif ? (
            <button type="button" disabled={busy} onClick={() => run(() => rouvrir(ticket.id))} className={`${bouton} border border-[#D8D3C8] text-slate-700`}>
              Rouvrir
            </button>
          ) : null}
        </div>

        {ticket.filiere === 'THERMIQUE' ? (
          <div className="space-y-1.5">
            <ClassificationTicket
              valeurs={classifForm}
              onChange={setClassifForm}
              classif={classif}
              issueObligatoire={issueRequise(ticket) && actif}
              source={ticket.classif_source}
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy || JSON.stringify(classifForm) === JSON.stringify(valeursDepuisTicket(ticket))}
              onClick={() =>
                run(async () => {
                  await majTicket(ticket.id, patchClassif(classifForm))
                  await ajouterEtape(ticket.id, 'COMMENTAIRE', 'Classification mise à jour')
                })
              }
              className={`${bouton} border border-[#1E4E8C] text-[#1E4E8C]`}
            >
              Enregistrer la classification
            </button>
          </div>
        ) : null}

        <div className="space-y-2">
          <textarea
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            rows={2}
            placeholder="Commentaire (sert aussi de motif d’escalade ou de solution) — repris dans la fiche ticket"
            className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#B4761A]"
          />
          <textarea
            value={commentaireInterne}
            onChange={(e) => setCommentaireInterne(e.target.value)}
            rows={2}
            placeholder="Commentaire interne — jamais repris dans la fiche ticket PDF"
            className="w-full rounded-lg border border-[#EBD8AE] bg-[#FFFCF5] px-2.5 py-2 text-[13px] outline-none focus:border-[#B4761A]"
          />
          <button
            type="button"
            disabled={busy || (!commentaire.trim() && !commentaireInterne.trim())}
            onClick={() =>
              run(async () => {
                if (commentaire.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE', commentaire.trim())
                if (commentaireInterne.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE_INTERNE', commentaireInterne.trim())
              })
            }
            className={`${bouton} border border-[#D8D3C8] text-slate-700`}
          >
            Ajouter le commentaire
          </button>
        </div>

        <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Pièces jointes</div>
          <PiecesJointes key={ticket.id} ticketId={ticket.id} onChange={() => void charger()} />
        </div>

        <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Historique du ticket</div>
          <HistoriqueTicket ticket={ticket} etapes={etapes} hauteurMax={520} />
        </div>
      </div>

      {fenetreNiveau ? (
        <FenetreNiveau
          mode={fenetreNiveau}
          niveau={ticket.niveau}
          collaborateurs={collabTicket}
          motifInitial={commentaire.trim()}
          busy={busy}
          onFermer={() => setFenetreNiveau(null)}
          onValider={(v) =>
            run(async () => {
              if (commentaireInterne.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE_INTERNE', commentaireInterne.trim())
              if (fenetreNiveau === 'escalade') {
                await majTicket(ticket.id, patchClassif(classifForm))
                await escalader({ ...ticket, actions: classifForm.actions }, v.motif, v.destinataire)
              } else {
                await redescendre(ticket, v.motif, v.destinataire)
              }
              setFenetreNiveau(null)
            })
          }
        />
      ) : null}
    </aside>
  )
}
