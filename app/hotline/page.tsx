'use client'

/**
 * Console d'appel — Hotline technique / SAV (/hotline). Créé le 02/11/2026.
 *
 * - Ouverte par 3CX sur appel entrant : /hotline?tel=<appelant>&ligne=<numéro appelé>
 *   (voir lib/hotline.ts). Le numéro est recherché dans SAGE (fiche tiers,
 *   contacts) et BLG (contacts) — RPC hotline_identifier_appelant.
 * - La ligne appelée choisit la filière (hotline_lignes) : PV ou thermique.
 * - Colonne gauche : appelant, filière / motif, champs du ticket, chronologie.
 * - Colonne centrale : diagnostic guidé (arbre de questions-réponses de la
 *   filière et du motif) ; chaque réponse est horodatée dans le ticket.
 * - Colonne droite : contexte en temps réel — trois historiques hotline
 *   (client, contact, chantier / machine), documents de vente filtrés par
 *   chantier / n° de série — et
 *   documents proposés par le diagnostic, envoyables à l'appelant.
 * Tables / RPC : migration 20261102_hotline_technique.sql.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur, Pastille } from '@/components/hotline/HotlineHeader'
import {
  ETAPE_LIBELLES,
  FILIERES,
  MOTIFS,
  STATUTS,
  ajouterEtape,
  chargerArbres,
  CONTEXTE_VIDE,
  chargerContexte,
  chargerEtapes,
  chargerLignes,
  chargerNoeuds,
  escalader,
  fmtDate,
  fmtDateHeure,
  fmtEuro,
  fmtHeure,
  fmtTel,
  identifierAppelant,
  libelleFiliere,
  libelleMotif,
  creerBrouillonEmail,
  majTicket,
  messageErreur,
  rechercherTiers,
  resoudre,
  telCle,
  type Appelant,
  type Arbre,
  type Choix,
  type Contexte,
  type DocumentLien,
  type Etape,
  type Filiere,
  type Ligne,
  type Motif,
  type Noeud,
  type Ticket,
  type TicketHistorique,
  type TiersTrouve,
} from '@/lib/hotline'

type Formulaire = {
  filiere: Filiere | null
  motif: Motif | null
  numero_tiers: string
  intitule_tiers: string
  contact_nom: string
  contact_email: string
  chantier: string
  numero_serie: string
  reference_article: string
  description: string
}

const FORM_VIDE: Formulaire = {
  filiere: null,
  motif: null,
  numero_tiers: '',
  intitule_tiers: '',
  contact_nom: '',
  contact_email: '',
  chantier: '',
  numero_serie: '',
  reference_article: '',
  description: '',
}

const champ =
  'h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]'
const carte = 'rounded-2xl border border-[#E2DFD8] bg-white'
const titreCarte = 'border-b border-[#EFEDE8] px-4 py-3 text-[14px] font-bold text-slate-900'

export default function HotlineConsoleWrapper() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Chargement…</div>}>
      <HotlineConsole />
    </Suspense>
  )
}

function HotlineConsole() {
  const params = useSearchParams()
  const { email } = useAccess()

  const [telephone, setTelephone] = useState(params.get('tel') || '')
  const [ligneAppelee] = useState(params.get('ligne') || '')
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [arbres, setArbres] = useState<Arbre[]>([])
  const [appelants, setAppelants] = useState<AppelantGroupe[] | null>(null)
  // Liste des propositions repliée dès qu'un appelant est retenu (auto ou clic).
  const [listeOuverte, setListeOuverte] = useState(false)
  const [voirTout, setVoirTout] = useState(false)
  const [recherche, setRecherche] = useState(false)
  const [form, setForm] = useState<Formulaire>(FORM_VIDE)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [etapes, setEtapes] = useState<Etape[]>([])
  const [contexte, setContexte] = useState<Contexte>(CONTEXTE_VIDE)
  const [contexteLoading, setContexteLoading] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [envoiEnCours, setEnvoiEnCours] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Diagnostic guidé
  const [arbreId, setArbreId] = useState<string>('')
  const [noeuds, setNoeuds] = useState<Noeud[]>([])
  const [noeudCourant, setNoeudCourant] = useState<string | null>(null)
  const [parcours, setParcours] = useState<Array<{ noeud: string; choix: string }>>([])
  const [fin, setFin] = useState<Choix | null>(null)
  const [docsDiagnostic, setDocsDiagnostic] = useState<DocumentLien[]>([])
  const [commentaire, setCommentaire] = useState('')

  const patch = (p: Partial<Formulaire>) => setForm((f) => ({ ...f, ...p }))

  // Référentiels -------------------------------------------------------------
  useEffect(() => {
    Promise.all([chargerLignes(), chargerArbres({ actifsSeulement: true })])
      .then(([l, a]) => {
        setLignes(l)
        setArbres(a)
      })
      .catch((e) => setErreur(messageErreur(e)))
  }, [])

  // Filière déduite de la ligne 3CX appelée.
  useEffect(() => {
    if (!ligneAppelee || !lignes.length || form.filiere) return
    const cle = telCle(ligneAppelee)
    const ligne = lignes.find((l) => l.actif && (l.numero === ligneAppelee || (cle && telCle(l.numero) === cle)))
    if (ligne) patch({ filiere: ligne.filiere })
  }, [ligneAppelee, lignes, form.filiere])

  // Identification de l'appelant ---------------------------------------------
  const identifier = useCallback(async (tel: string) => {
    if (telCle(tel).length < 9) return
    setRecherche(true)
    try {
      const liste = regrouperAppelants(await identifierAppelant(tel))
      setAppelants(liste)
      setVoirTout(false)
      // Contact déjà enregistré par la hotline (appel précédent) : pré-saisie
      // directe, il fait foi. Sinon, pré-saisie si un seul client correspond.
      const tiers = Array.from(new Set(liste.map((a) => a.numero_tiers).filter(Boolean)))
      const memorise = liste.find((a) => a.sources.includes('Hotline'))
      const a = memorise || (liste.length && tiers.length === 1 ? liste[0] : null)
      setListeOuverte(!a)
      if (a) {
        setForm((f) => ({
          ...f,
          numero_tiers: a.numero_tiers || f.numero_tiers,
          intitule_tiers: a.intitule || f.intitule_tiers,
          contact_nom: f.contact_nom || (a.source !== 'SAGE fiche tiers' ? a.contact || '' : ''),
          contact_email: f.contact_email || a.email || '',
        }))
      }
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setRecherche(false)
    }
  }, [])

  const telInitial = useRef(params.get('tel') || '')
  useEffect(() => {
    if (telInitial.current) void identifier(telInitial.current)
  }, [identifier])

  function choisirAppelant(a: AppelantGroupe) {
    patch({ numero_tiers: a.numero_tiers || '', intitule_tiers: a.intitule || '', contact_nom: a.contact || '', contact_email: a.email || '' })
    setListeOuverte(false)
  }

  // Contexte temps réel (debounce 400 ms) -----------------------------------
  useEffect(() => {
    const handle = window.setTimeout(async () => {
      if (!form.numero_tiers && !form.numero_serie && !form.chantier && telCle(telephone).length < 9) {
        setContexte(CONTEXTE_VIDE)
        return
      }
      setContexteLoading(true)
      try {
        setContexte(
          await chargerContexte({
            numeroTiers: form.numero_tiers,
            telephone,
            chantier: form.chantier,
            numeroSerie: form.numero_serie,
            contactNom: form.contact_nom,
          }),
        )
      } catch (e) {
        setErreur(messageErreur(e))
      } finally {
        setContexteLoading(false)
      }
    }, 400)
    return () => window.clearTimeout(handle)
  }, [form.numero_tiers, form.chantier, form.numero_serie, form.contact_nom, telephone, ticket?.id])

  // Arbre de diagnostic ------------------------------------------------------
  const arbresPossibles = useMemo(
    () => arbres.filter((a) => a.filiere === form.filiere && (!form.motif || a.motif === form.motif)),
    [arbres, form.filiere, form.motif],
  )

  useEffect(() => {
    if (arbresPossibles.some((a) => a.id === arbreId)) return
    setArbreId(arbresPossibles.length === 1 ? arbresPossibles[0].id : '')
  }, [arbresPossibles, arbreId])

  useEffect(() => {
    setNoeuds([])
    setNoeudCourant(null)
    setParcours([])
    setFin(null)
    setDocsDiagnostic([])
    if (!arbreId) return
    chargerNoeuds(arbreId)
      .then((liste) => {
        setNoeuds(liste)
        const arbre = arbres.find((a) => a.id === arbreId)
        const racine = liste.find((n) => n.id === arbre?.noeud_racine) || liste[0]
        if (racine) {
          setNoeudCourant(racine.id)
          setDocsDiagnostic(racine.documents)
        }
      })
      .catch((e) => setErreur(messageErreur(e)))
  }, [arbreId, arbres])

  const noeudMap = useMemo(() => new Map(noeuds.map((n) => [n.id, n])), [noeuds])
  const noeud = noeudCourant ? noeudMap.get(noeudCourant) || null : null

  // Ticket ---------------------------------------------------------------------
  const rafraichirEtapes = useCallback(async (id: string) => {
    setEtapes(await chargerEtapes(id))
    const { data } = await supabase.from('hotline_tickets').select('*').eq('id', id).maybeSingle()
    if (data) setTicket(data as Ticket)
  }, [])

  async function ouvrirTicket() {
    if (!form.filiere) {
      setErreur('Choisir la filière (photovoltaïque ou thermique) avant d’ouvrir le ticket.')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('hotline_tickets')
        .insert({
          filiere: form.filiere,
          motif: form.motif,
          source: telephone ? 'TELEPHONE' : 'MANUEL',
          telephone_appelant: telephone || null,
          ligne_appelee: ligneAppelee || null,
          numero_tiers: form.numero_tiers || null,
          intitule_tiers: form.intitule_tiers || null,
          contact_nom: form.contact_nom || null,
          contact_email: form.contact_email.trim() || null,
          chantier: form.chantier || null,
          numero_serie: form.numero_serie || null,
          reference_article: form.reference_article || null,
          description: form.description || null,
          arbre_id: arbreId || null,
          assigne_a: email || null,
        })
        .select('*')
        .single()
      if (error) throw error
      const t = data as Ticket
      await ajouterEtape(t.id, 'OUVERTURE', `Ticket ${t.numero} ouvert · ${libelleFiliere(t.filiere)} · ${libelleMotif(t.motif)}`, {
        details: { telephone: telephone || null, ligne: ligneAppelee || null },
      })
      if (form.numero_tiers) {
        await ajouterEtape(t.id, 'IDENTIFICATION', `Appelant : ${form.intitule_tiers || form.numero_tiers}${form.contact_nom ? ` (${form.contact_nom})` : ''}`)
      }
      setTicket(t)
      await rafraichirEtapes(t.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function enregistrerInfos() {
    if (!ticket) return
    setBusy(true)
    try {
      await majTicket(ticket.id, {
        filiere: form.filiere || ticket.filiere,
        motif: form.motif,
        numero_tiers: form.numero_tiers || null,
        intitule_tiers: form.intitule_tiers || null,
        contact_nom: form.contact_nom || null,
        contact_email: form.contact_email.trim() || null,
        chantier: form.chantier || null,
        numero_serie: form.numero_serie || null,
        reference_article: form.reference_article || null,
        description: form.description || null,
        arbre_id: arbreId || null,
      })
      await ajouterEtape(ticket.id, 'COMMENTAIRE', 'Informations du ticket mises à jour')
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  async function repondre(c: Choix) {
    if (!noeud) return
    if (!ticket) {
      setErreur('Ouvrir le ticket avant de dérouler le diagnostic : chaque réponse y est horodatée.')
      return
    }
    setBusy(true)
    try {
      await ajouterEtape(ticket.id, 'QUESTION', `${noeud.question} → ${c.libelle}`, { noeud_id: noeud.id })
      if (ticket.statut === 'OUVERT') await majTicket(ticket.id, { statut: 'EN_COURS', arbre_id: arbreId || null })
      setParcours((p) => [...p, { noeud: noeud.id, choix: c.libelle }])
      const suivant = c.suivant ? noeudMap.get(c.suivant) : null
      if (suivant) {
        setNoeudCourant(suivant.id)
        setDocsDiagnostic((docs) => {
          const titres = new Set(docs.map((d) => d.titre))
          return [...docs, ...suivant.documents.filter((d) => !titres.has(d.titre))]
        })
      } else {
        setFin(c)
        if (c.preconisation) {
          await majTicket(ticket.id, { preconisation: c.preconisation })
          await ajouterEtape(ticket.id, 'PRECONISATION', c.preconisation, { noeud_id: noeud.id })
        }
      }
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  function revenir() {
    const precedent = parcours[parcours.length - 1]
    if (!precedent) return
    setParcours((p) => p.slice(0, -1))
    setNoeudCourant(precedent.noeud)
    setFin(null)
  }

  async function action(nom: 'escalader' | 'resoudre' | 'commentaire') {
    if (!ticket) return
    setBusy(true)
    try {
      if (nom === 'escalader') await escalader(ticket, commentaire || fin?.preconisation || '')
      if (nom === 'resoudre') await resoudre(ticket.id, fin?.preconisation || commentaire || '')
      if (nom === 'commentaire' && commentaire.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE', commentaire.trim())
      setCommentaire('')
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  // Brouillon Outlook (.eml) avec le document en pièce jointe quand il est
  // téléchargeable, sinon avec le lien (voir lib/hotline.ts).
  async function envoyerDocument(doc: DocumentLien) {
    setEnvoiEnCours(doc.titre)
    try {
      const destinataire = form.contact_email.trim()
      const { joint } = await creerBrouillonEmail({
        doc,
        destinataire,
        contactNom: form.contact_nom,
        ticketNumero: ticket?.numero,
      })
      setInfo(
        `Brouillon d’e-mail « ${doc.titre} » téléchargé${destinataire ? ` pour ${destinataire}` : ' (destinataire à saisir)'} : ${
          joint ? 'document en pièce jointe' : 'document non téléchargeable, le lien est dans le texte'
        }. Ouvrez-le pour l’envoyer depuis Outlook.`,
      )
      window.setTimeout(() => setInfo(null), 8000)
      if (ticket) {
        await ajouterEtape(ticket.id, 'DOCUMENT', `Document envoyé${joint ? ' (pièce jointe)' : ' (lien)'} : ${doc.titre}${destinataire ? ` → ${destinataire}` : ''}`, {
          details: { ...doc, destinataire: destinataire || null, piece_jointe: joint },
        })
        await rafraichirEtapes(ticket.id)
      }
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setEnvoiEnCours(null)
    }
  }

  function nouvelAppel() {
    setTelephone('')
    setAppelants(null)
    setForm(FORM_VIDE)
    setTicket(null)
    setEtapes([])
    setArbreId('')
    setCommentaire('')
    setErreur(null)
    window.history.replaceState(null, '', '/hotline')
  }

  const statut = ticket ? STATUTS[ticket.statut] : null

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader
        titre="Console d’appel"
        sousTitre={
          ligneAppelee
            ? `Appel reçu sur ${fmtTel(ligneAppelee)}${form.filiere ? ` · ${libelleFiliere(form.filiere)}` : ''}`
            : 'Saisir le numéro de l’appelant, ou ouvrir la console depuis 3CX'
        }
        actions={
          <>
            {ticket ? (
              <span className="flex items-center gap-2 rounded-lg border border-[color:var(--cg-hdr-line)] px-3 py-1.5 text-sm font-semibold text-[color:var(--cg-hdr-ink)]">
                {ticket.numero} · N{ticket.niveau} {statut ? <Pastille {...statut} /> : null}
              </span>
            ) : null}
            <button
              type="button"
              onClick={nouvelAppel}
              className="h-9 rounded-lg border border-[color:var(--cg-hdr-line)] px-3 text-sm font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A]"
            >
              Nouvel appel
            </button>
          </>
        }
      />

      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 md:px-8">
        {erreur ? <HotlineErreur message={erreur} onClose={() => setErreur(null)} /> : null}
        {info ? <div className="mb-4 rounded-xl border border-[#CDE5D1] bg-[#EEF7EF] px-4 py-2.5 text-[13px] text-[#2F6B3A]">{info}</div> : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {/* ── Appelant et ticket ───────────────────────────────────── */}
          <section className={`${carte} xl:col-span-3`}>
            <div className={titreCarte}>Appelant</div>
            <div className="space-y-3 p-4">
              <div className="flex gap-2">
                <input
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && identifier(telephone)}
                  placeholder="N° de téléphone"
                  className={champ}
                />
                <button
                  type="button"
                  onClick={() => identifier(telephone)}
                  className="h-9 shrink-0 rounded-lg bg-[#0B1220] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
                  disabled={recherche}
                >
                  {recherche ? '…' : 'Identifier'}
                </button>
              </div>

              {appelants !== null ? (
                appelants.length ? (
                  <PropositionsAppelant
                    appelants={appelants}
                    numeroTiers={form.numero_tiers}
                    contactNom={form.contact_nom}
                    ouverte={listeOuverte}
                    voirTout={voirTout}
                    onOuvrir={() => setListeOuverte(true)}
                    onVoirTout={() => setVoirTout(true)}
                    onChoisir={choisirAppelant}
                  />
                ) : (
                  <div className="rounded-lg border border-[#EBD8AE] bg-[#FDF7EA] px-3 py-2 text-[12px] text-[#6B470E]">
                    Numéro inconnu dans SAGE et BLG : saisir le code tiers ou le nom ci-dessous. Il sera mémorisé à l’ouverture du ticket.
                  </div>
                )
              ) : null}

              <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[13px]">
                {FILIERES.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => patch({ filiere: f.value })}
                    className={`flex-1 rounded-md px-2 py-1.5 font-semibold ${form.filiere === f.value ? 'bg-[#0B1220] text-white' : 'text-slate-600'}`}
                  >
                    {f.icon} {f.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[12px]">
                {MOTIFS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => patch({ motif: m.value })}
                    className={`flex-1 rounded-md px-2 py-1.5 font-semibold ${form.motif === m.value ? 'bg-[#B4761A] text-white' : 'text-slate-600'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ChampTiers
                  label="Code tiers"
                  mode="code"
                  value={form.numero_tiers}
                  onChange={(v) => patch({ numero_tiers: v.toUpperCase() })}
                  onSelect={(t) =>
                  setForm((f) => ({ ...f, numero_tiers: t.numero_tiers, intitule_tiers: t.intitule || '', contact_email: f.contact_email || t.email || '' }))
                }
                />
                <label className="text-[11px] font-semibold text-slate-500">
                  Contact
                  <input value={form.contact_nom} onChange={(e) => patch({ contact_nom: e.target.value })} className={champ} />
                </label>
              </div>
              <ChampTiers
                label="Client"
                mode="nom"
                value={form.intitule_tiers}
                onChange={(v) => patch({ intitule_tiers: v })}
                onSelect={(t) =>
                  setForm((f) => ({ ...f, numero_tiers: t.numero_tiers, intitule_tiers: t.intitule || '', contact_email: f.contact_email || t.email || '' }))
                }
              />
              <label className="block text-[11px] font-semibold text-slate-500">
                E-mail du contact
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => patch({ contact_email: e.target.value })}
                  placeholder="Pré-rempli depuis la fiche contact"
                  className={champ}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-slate-500">
                  Chantier / référence
                  <input value={form.chantier} onChange={(e) => patch({ chantier: e.target.value })} className={champ} />
                </label>
                <label className="text-[11px] font-semibold text-slate-500">
                  N° de série
                  <input value={form.numero_serie} onChange={(e) => patch({ numero_serie: e.target.value })} className={champ} />
                </label>
              </div>
              <label className="block text-[11px] font-semibold text-slate-500">
                Modèle / référence article
                <input value={form.reference_article} onChange={(e) => patch({ reference_article: e.target.value })} className={champ} />
              </label>
              <label className="block text-[11px] font-semibold text-slate-500">
                Motif de l’appel
                <textarea
                  value={form.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]"
                />
              </label>

              {ticket ? (
                <button
                  type="button"
                  onClick={enregistrerInfos}
                  disabled={busy}
                  className="h-9 w-full rounded-lg border border-[#D8D3C8] text-[13px] font-semibold text-slate-700 hover:border-[#B4761A] disabled:opacity-50"
                >
                  Mettre à jour le ticket
                </button>
              ) : (
                <button
                  type="button"
                  onClick={ouvrirTicket}
                  disabled={busy || !form.filiere}
                  className="h-10 w-full rounded-lg bg-[#B4761A] text-[14px] font-bold text-white hover:bg-[#9A6414] disabled:opacity-50"
                >
                  Ouvrir le ticket
                </button>
              )}
            </div>

            {ticket ? (
              <div className="border-t border-[#EFEDE8] p-4">
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Chronologie</div>
                <ol className="space-y-1.5">
                  {etapes.map((e) => (
                    <li key={e.id} className="text-[12px] leading-snug">
                      <span className="font-mono text-[11px] text-slate-400">{fmtHeure(e.at)}</span>{' '}
                      <span className="font-semibold text-slate-700">{ETAPE_LIBELLES[e.type]}</span>{' '}
                      <span className="text-slate-600">{e.libelle}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          {/* ── Diagnostic guidé ─────────────────────────────────────── */}
          <section className={`${carte} xl:col-span-5`}>
            <div className={`${titreCarte} flex flex-wrap items-center justify-between gap-2`}>
              <span>Diagnostic guidé</span>
              {arbresPossibles.length > 1 ? (
                <select value={arbreId} onChange={(e) => setArbreId(e.target.value)} className="h-8 rounded-lg border border-[#D8D3C8] px-2 text-[12px] font-normal">
                  <option value="">Choisir le parcours…</option>
                  {arbresPossibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nom}
                      {a.famille ? ` · ${a.famille}` : ''}
                    </option>
                  ))}
                </select>
              ) : arbresPossibles[0] ? (
                <span className="text-[12px] font-normal text-slate-500">{arbresPossibles[0].nom}</span>
              ) : null}
            </div>
            <div className="p-5">
              {!form.filiere ? (
                <p className="text-[13px] text-slate-500">Choisir la filière pour afficher le parcours de diagnostic.</p>
              ) : !arbresPossibles.length ? (
                <p className="text-[13px] text-slate-500">
                  Aucun parcours actif pour {libelleFiliere(form.filiere)}
                  {form.motif ? ` · ${libelleMotif(form.motif)}` : ''}. Un expert peut le créer dans l’éditeur de diagnostic.
                </p>
              ) : !noeud ? (
                <p className="text-[13px] text-slate-500">{arbreId ? 'Chargement du parcours…' : 'Choisir le parcours ci-dessus.'}</p>
              ) : (
                <div className="space-y-4">
                  {parcours.length ? (
                    <ol className="space-y-1 border-l-2 border-[#EBD8AE] pl-3 text-[12px] text-slate-500">
                      {parcours.map((p, i) => (
                        <li key={`${p.noeud}-${i}`}>
                          {noeudMap.get(p.noeud)?.question} <span className="font-semibold text-slate-700">→ {p.choix}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}

                  {fin ? (
                    <div className={`rounded-xl border p-4 ${fin.escalade ? 'border-[#F0C5BE] bg-[#FCEFEC]' : 'border-[#CDE5D1] bg-[#EEF7EF]'}`}>
                      <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Préconisation</div>
                      <div className="mt-1 text-[15px] font-semibold text-slate-900">{fin.preconisation || 'Fin du parcours'}</div>
                      {fin.escalade ? <div className="mt-1 text-[12px] text-[#7F1D1D]">Ce cas relève du niveau supérieur : escalader le ticket.</div> : null}
                    </div>
                  ) : (
                    <div>
                      <div className="text-[18px] font-bold text-slate-900">{noeud.question}</div>
                      {noeud.aide ? <div className="mt-1 text-[13px] text-slate-500">{noeud.aide}</div> : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {noeud.choix.map((c, i) => (
                          <button
                            key={`${c.libelle}-${i}`}
                            type="button"
                            onClick={() => repondre(c)}
                            disabled={busy}
                            className="rounded-lg bg-[#0B1220] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#1C2A44] disabled:opacity-50"
                          >
                            {c.libelle}
                          </button>
                        ))}
                        {!noeud.choix.length ? <span className="text-[13px] text-slate-500">Question sans réponse paramétrée.</span> : null}
                      </div>
                      {!ticket ? <div className="mt-3 text-[12px] text-[#8A5A11]">Ouvrir le ticket pour enregistrer les réponses.</div> : null}
                    </div>
                  )}

                  {parcours.length ? (
                    <button type="button" onClick={revenir} className="text-[12px] font-semibold text-slate-500 hover:text-slate-800">
                      ← Revenir à la question précédente
                    </button>
                  ) : null}
                </div>
              )}

              {ticket ? (
                <div className="mt-6 space-y-2 border-t border-[#EFEDE8] pt-4">
                  <textarea
                    value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value)}
                    rows={2}
                    placeholder="Commentaire, code défaut relevé, motif d’escalade…"
                    className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#B4761A]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => action('commentaire')} disabled={busy || !commentaire.trim()} className="rounded-lg border border-[#D8D3C8] px-3 py-2 text-[13px] font-semibold text-slate-700 disabled:opacity-40">
                      Ajouter le commentaire
                    </button>
                    <button type="button" onClick={() => action('escalader')} disabled={busy || ticket.niveau >= 3} className="rounded-lg bg-[#C1683C] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                      Escalader au niveau {Math.min(3, ticket.niveau + 1)}
                    </button>
                    <button type="button" onClick={() => action('resoudre')} disabled={busy || ticket.statut === 'RESOLU' || ticket.statut === 'CLOS'} className="rounded-lg bg-[#2F6B3A] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                      Marquer résolu
                    </button>
                    <Link href={`/hotline/tickets?id=${ticket.id}`} className="ml-auto self-center text-[12px] font-semibold text-slate-500 underline">
                      Ouvrir dans la liste des tickets
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* ── Contexte et documents ────────────────────────────────── */}
          <section className="space-y-4 xl:col-span-4">
            <div className={carte}>
              <div className={titreCarte}>Documents à envoyer</div>
              <div className="space-y-1.5 p-4">
                {docsDiagnostic.length ? (
                  docsDiagnostic.map((d, i) => (
                    <div key={`${d.titre}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-[#E2DFD8] px-3 py-2 text-[13px]">
                      <span className="min-w-0 truncate">
                        <span className="mr-1.5 rounded bg-[#EEEDEA] px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{d.type || 'DOC'}</span>
                        {d.titre}
                      </span>
                      <span className="flex shrink-0 gap-2">
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-slate-500 underline">
                            Ouvrir
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => envoyerDocument(d)}
                          disabled={envoiEnCours !== null}
                          title={form.contact_email ? `Brouillon Outlook pour ${form.contact_email}, document en pièce jointe` : 'Brouillon Outlook, document en pièce jointe'}
                          className="text-[12px] font-semibold text-[#B4761A] underline disabled:opacity-50"
                        >
                          {envoiEnCours === d.titre ? 'Préparation…' : 'Envoyer'}
                        </button>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[12px] text-slate-500">Les documents (procédures, schémas, firmwares) apparaissent au fil du diagnostic.</p>
                )}
              </div>
            </div>

            <PaveHistorique
              titre="HOTLINE Historique Contact"
              precision={form.contact_nom || (telCle(telephone) ? fmtTel(telephone) : '')}
              tickets={contexte.ticketsContact.filter((t) => t.id !== ticket?.id)}
              chargement={contexteLoading}
              vide={telCle(telephone) || form.contact_nom ? 'Aucun appel précédent de ce contact.' : 'Saisir le numéro ou le contact pour afficher ses appels.'}
              afficherClient
            />
            <PaveHistorique
              titre="HOTLINE Historique Chantier / Machine"
              precision={[form.chantier, form.numero_serie].filter(Boolean).join(' · ')}
              tickets={contexte.ticketsChantier.filter((t) => t.id !== ticket?.id)}
              chargement={contexteLoading}
              vide={form.chantier || form.numero_serie ? 'Aucun appel précédent sur ce chantier ou cette machine.' : 'Saisir le chantier ou le n° de série pour afficher son historique.'}
              afficherClient
              afficherChantier
            />

            <div className={carte}>
              <div className={titreCarte}>
                Documents de vente
                {form.chantier ? <span className="ml-2 text-[12px] font-normal text-slate-500">chantier « {form.chantier} »</span> : null}
                {form.numero_serie ? <span className="ml-2 text-[12px] font-normal text-slate-500">n° série « {form.numero_serie} »</span> : null}
              </div>
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto p-4">
                {contexte.documents.length ? (
                  contexte.documents.map((d) => (
                    <div key={d.numero_piece} className="rounded-lg border border-[#E2DFD8] px-3 py-2 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          {d.numero_piece}
                          {d.numero_bl ? <span className="font-normal text-slate-500"> · {d.numero_bl}</span> : null}
                        </span>
                        <span className="text-slate-500">
                          {fmtDate(d.date)} · {fmtEuro(d.montant_ht)}
                        </span>
                      </div>
                      {d.reference || d.projet ? <div className="text-slate-600">{[d.reference, d.projet].filter(Boolean).join(' · ')}</div> : null}
                      {d.articles?.length ? <div className="truncate text-slate-500">{d.articles.join(' · ')}</div> : null}
                      {d.series?.length ? <div className="text-slate-500">N° série : {d.series.join(', ')}</div> : null}
                    </div>
                  ))
                ) : (
                  <p className="text-[12px] text-slate-500">
                    {form.numero_tiers || form.numero_serie
                      ? 'Aucune facture sur 36 mois pour ces critères.'
                      : 'Identifier le client (ou saisir un n° de série) pour afficher ses factures.'}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

// ── Historique (client / contact / chantier-machine) ─────────────────────────
function PaveHistorique({
  titre,
  precision,
  tickets,
  chargement,
  vide,
  afficherClient,
  afficherChantier,
}: {
  titre: string
  precision?: string
  tickets: TicketHistorique[]
  chargement: boolean
  vide: string
  afficherClient?: boolean
  afficherChantier?: boolean
}) {
  return (
    <div className={carte}>
      <div className={`${titreCarte} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">
          {titre}
          {precision ? <span className="ml-2 text-[12px] font-normal text-slate-500">{precision}</span> : null}
        </span>
        <span className="shrink-0 text-[11px] font-normal text-slate-400">{chargement ? 'mise à jour…' : tickets.length ? `${tickets.length} appel${tickets.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      <div className="max-h-[300px] space-y-1.5 overflow-y-auto p-4">
        {tickets.length ? (
          tickets.map((t) => (
            <Link key={t.id} href={`/hotline/tickets?id=${t.id}`} className="block rounded-lg border border-[#E2DFD8] px-3 py-2 text-[12px] hover:border-[#B4761A]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  {t.numero} · {fmtDateHeure(t.opened_at)}
                </span>
                <Pastille {...STATUTS[t.statut]} />
              </div>
              <div className="text-slate-600">
                {libelleFiliere(t.filiere)} · {libelleMotif(t.motif)} · N{t.niveau}
              </div>
              {afficherClient && (t.intitule_tiers || t.contact_nom) ? (
                <div className="truncate text-slate-600">{[t.intitule_tiers || t.numero_tiers, t.contact_nom].filter(Boolean).join(' · ')}</div>
              ) : null}
              {afficherChantier && (t.chantier || t.numero_serie) ? (
                <div className="truncate text-slate-600">{[t.chantier, t.numero_serie ? `n° ${t.numero_serie}` : ''].filter(Boolean).join(' · ')}</div>
              ) : null}
              {t.description ? <div className="truncate text-slate-500">{t.description}</div> : null}
              {t.preconisation ? <div className="truncate text-[#2F6B3A]">→ {t.preconisation}</div> : null}
            </Link>
          ))
        ) : (
          <p className="text-[12px] text-slate-500">{vide}</p>
        )}
      </div>
    </div>
  )
}

// ── Aide à la saisie du client (code tiers ou nom) ───────────────────────────
// Liste SAGE (ref_tiers) dès 2 caractères ; choisir une ligne remplit le code
// ET le nom. Code saisi en entier puis sortie du champ : le nom se remplit seul.
function ChampTiers({
  label,
  mode,
  value,
  onChange,
  onSelect,
}: {
  label: string
  mode: 'code' | 'nom'
  value: string
  onChange: (value: string) => void
  onSelect: (tiers: TiersTrouve) => void
}) {
  const [saisie, setSaisie] = useState<string | null>(null)
  const [resultats, setResultats] = useState<TiersTrouve[]>([])
  const [ouvert, setOuvert] = useState(false)
  const [actif, setActif] = useState(0)

  // Recherche seulement sur une frappe de l'utilisateur (pas quand le champ est
  // rempli par l'identification ou par l'autre champ).
  useEffect(() => {
    if (saisie === null) return
    const q = saisie.trim()
    const handle = window.setTimeout(async () => {
      if (q.length < 2) {
        setResultats([])
        return
      }
      try {
        const liste = await rechercherTiers(q)
        setResultats(liste)
        setActif(0)
        setOuvert(liste.length > 0)
      } catch {
        setResultats([])
      }
    }, 250)
    return () => window.clearTimeout(handle)
  }, [saisie])

  function choisir(t: TiersTrouve) {
    onSelect(t)
    setSaisie(null)
    setResultats([])
    setOuvert(false)
  }

  function quitter() {
    window.setTimeout(() => setOuvert(false), 150)
    if (mode === 'code' && value.trim()) {
      const exact = resultats.find((t) => t.numero_tiers.toUpperCase() === value.trim().toUpperCase())
      if (exact) choisir(exact)
    }
  }

  return (
    <label className="relative block text-[11px] font-semibold text-slate-500">
      {label}
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setSaisie(e.target.value)
        }}
        onFocus={() => resultats.length && setOuvert(true)}
        onBlur={quitter}
        onKeyDown={(e) => {
          if (!ouvert || !resultats.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActif((i) => Math.min(resultats.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActif((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choisir(resultats[actif])
          } else if (e.key === 'Escape') {
            setOuvert(false)
          }
        }}
        placeholder={mode === 'code' ? 'Code SAGE…' : 'Nom du client…'}
        autoComplete="off"
        className={champ}
      />
      {ouvert && resultats.length ? (
        <div
          className={`absolute left-0 top-full z-30 mt-1 max-h-[280px] overflow-y-auto rounded-lg border border-[#D8D3C8] bg-white py-1 font-normal shadow-lg ${
            mode === 'code' ? 'w-[340px]' : 'w-full min-w-[340px]'
          }`}
        >
          {resultats.map((t, i) => (
            <button
              key={t.numero_tiers}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                choisir(t)
              }}
              onMouseEnter={() => setActif(i)}
              className={`block w-full px-3 py-1.5 text-left text-[12px] ${i === actif ? 'bg-[#FDF7EA]' : ''}`}
            >
              <div className="text-slate-900">
                <span className="font-semibold">{t.numero_tiers}</span> · {t.intitule || '—'}
              </div>
              <div className="text-[11px] text-slate-500">{[t.code_postal, t.ville, t.agence].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
        </div>
      ) : null}
    </label>
  )
}

// ── Propositions d'appelant ──────────────────────────────────────────────────
// Un même client / contact remonte souvent plusieurs fois (fiche SAGE, contact
// SAGE, contact BLG, carnet hotline) : on regroupe par client + contact (nom
// normalisé, « Jean MORA » = « MORA Jean »), on écarte les codes tiers
// inconnus quand le même contact existe sur un client connu, et on n'affiche
// que les 3 premières propositions (carnet hotline d'abord).
type AppelantGroupe = Appelant & { sources: string[] }

const PROPOSITIONS_VISIBLES = 3

function normaliserNom(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

function regrouperAppelants(liste: Appelant[]): AppelantGroupe[] {
  const groupes = new Map<string, AppelantGroupe>()
  for (const a of liste) {
    const contact = normaliserNom(a.contact)
    // Contact = raison sociale (fiche tiers) : pas un vrai contact.
    const contactUtile = contact && contact !== normaliserNom(a.intitule) ? contact : ''
    const cle = `${a.numero_tiers || ''}|${contactUtile}`
    const existant = groupes.get(cle)
    if (existant) {
      if (!existant.sources.includes(a.source)) existant.sources.push(a.source)
      existant.intitule = existant.intitule || a.intitule
      existant.ville = existant.ville || a.ville
      existant.agence = existant.agence || a.agence
      existant.contact = existant.contact || (contactUtile ? a.contact : null)
      existant.email = existant.email || a.email || null
    } else {
      groupes.set(cle, { ...a, contact: contactUtile ? a.contact : null, sources: [a.source] })
    }
  }
  const tous = Array.from(groupes.values())
  const contactsConnus = new Set(tous.filter((g) => g.intitule && g.contact).map((g) => normaliserNom(g.contact)))
  const rang = (g: AppelantGroupe) => (g.sources.includes('Hotline') ? 0 : g.intitule ? (g.contact ? 1 : 2) : 3)
  return tous
    .filter((g) => g.intitule || !g.contact || !contactsConnus.has(normaliserNom(g.contact)))
    .sort((a, b) => rang(a) - rang(b))
}

function PropositionsAppelant({
  appelants,
  numeroTiers,
  contactNom,
  ouverte,
  voirTout,
  onOuvrir,
  onVoirTout,
  onChoisir,
}: {
  appelants: AppelantGroupe[]
  numeroTiers: string
  contactNom: string
  ouverte: boolean
  voirTout: boolean
  onOuvrir: () => void
  onVoirTout: () => void
  onChoisir: (a: AppelantGroupe) => void
}) {
  const estChoisi = (a: AppelantGroupe) => a.numero_tiers === numeroTiers && normaliserNom(a.contact) === normaliserNom(contactNom)
  const choisi = appelants.find(estChoisi) || appelants.find((a) => a.numero_tiers === numeroTiers) || null

  if (!ouverte && choisi) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[#CDE5D1] bg-[#EEF7EF] px-3 py-2 text-[12px]">
        <span className="min-w-0 truncate text-[#2F6B3A]">
          ✓ Reconnu : <span className="font-semibold">{choisi.intitule || choisi.numero_tiers}</span>
          {choisi.contact ? ` · ${choisi.contact}` : ''}
          <span className="text-[11px] text-[#5E8A66]"> ({choisi.sources.join(', ')})</span>
        </span>
        {appelants.length > 1 ? (
          <button type="button" onClick={onOuvrir} className="shrink-0 font-semibold text-slate-600 underline">
            Changer ({appelants.length})
          </button>
        ) : null}
      </div>
    )
  }

  const visibles = voirTout ? appelants : appelants.slice(0, PROPOSITIONS_VISIBLES)
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-slate-500">
        {appelants.length > 1 ? `${appelants.length} correspondances : choisir l’appelant` : 'Correspondance trouvée'}
      </div>
      {visibles.map((a, i) => (
        <button
          key={`${a.numero_tiers}-${a.contact}-${i}`}
          type="button"
          onClick={() => onChoisir(a)}
          className={`block w-full rounded-lg border px-3 py-1.5 text-left text-[12px] ${
            estChoisi(a) ? 'border-[#B4761A] bg-[#FDF7EA]' : 'border-[#E2DFD8] hover:border-[#B4761A]'
          }`}
        >
          <div className="truncate text-slate-900">
            <span className="font-semibold">{a.intitule || 'Code non trouvé dans SAGE'}</span>
            <span className="text-slate-500"> · {a.numero_tiers || '—'}</span>
            {a.contact ? <span className="text-slate-600"> · {a.contact}</span> : null}
          </div>
          <div className="truncate text-[11px] text-slate-400">
            {[a.ville, a.agence].filter(Boolean).join(' · ')}
            {a.ville || a.agence ? ' — ' : ''}
            {a.sources.join(', ')}
          </div>
        </button>
      ))}
      {!voirTout && appelants.length > PROPOSITIONS_VISIBLES ? (
        <button type="button" onClick={onVoirTout} className="text-[12px] font-semibold text-slate-500 underline">
          Voir les {appelants.length - PROPOSITIONS_VISIBLES} autres
        </button>
      ) : null}
    </div>
  )
}
