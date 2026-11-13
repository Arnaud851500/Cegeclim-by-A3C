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
 * - Reprise d'un ticket non résolu (02/11/2026) : /hotline?ticket=<id> (bouton
 *   « Reprendre dans la console » de la liste des tickets) recharge le ticket,
 *   ses documents de vente, ses historiques et le diagnostic là où il s'était
 *   arrêté (réponses rejouées depuis la chronologie) ; on peut renvoyer des
 *   documents, poursuivre ou recommencer le parcours.
 * - Gamme thermique (04/11/2026) : après « Thermie », choix Gainable / R/R / R/O
 *   qui filtre les parcours (un parcours sans gamme vaut pour toutes).
 * - Vues éclatées (04/11/2026) : une référence ayant une vue (ligne d'un dossier
 *   de vente, champ « Modèle », document VUE_ECLATEE d'un parcours) ouvre la vue
 *   interactive (components/hotline/VueEclatee.tsx) : repères cliquables, stock,
 *   demande d'envoi au SAV enregistrée dans le ticket, mail au pro.
 * - Revue du 12/11/2026 (migration 20261112c_hotline_ticketing_v2.sql) :
 *   numéros TICKJJMMAA###, plus d'état « Clos » (résolu = clos), historique
 *   complet du ticket en haut de la colonne centrale (note rapide = motif de
 *   l'appel, puis tous les commentaires), commentaire interne (hors fiche PDF),
 *   escalade au N2 vers un collaborateur choisi (N2 du département du client
 *   proposé), retour N2 → N1, rappel du client confié à un N1, modèles GE / UI
 *   proposés d'après le début du n° de série, listes de droite repliées sur
 *   2 lignes (non résolus d'abord) avec un bouton « Développer ».
 * - Hi-Parts (12/11/2026) : boutons « Hi-Parts » à côté des modèles GE et UI ;
 *   vue éclatée du catalogue Hitachi (components/hotline/VueHiParts.tsx), la pièce
 *   choisie (référence, désignation, repère, prix HT) est ajoutée au motif de l'appel
 *   et, ticket ouvert, en commentaire (migration 20261112e_hiparts_catalogue.sql).
 * Tables / RPC : migration 20261102_hotline_technique.sql.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import HotlineHeader, { HotlineErreur, Pastille } from '@/components/hotline/HotlineHeader'
import PiecesJointes from '@/components/hotline/PiecesJointes'
import VueEclatee from '@/components/hotline/VueEclatee'
import VueHiParts from '@/components/hotline/VueHiParts'
import HistoriqueTicket from '@/components/hotline/HistoriqueTicket'
import FenetreNiveau from '@/components/hotline/FenetreNiveau'
import ChampSerie from '@/components/hotline/ChampSerie'
import ZoneTexte from '@/components/hotline/ZoneTexte'
import { telechargerFicheTicket } from '@/lib/hotlineFiche'
import ClassificationTicket, { CLASSIF_FORM_VIDE, patchClassif, useClassification, valeursDepuisTicket, type ValeursClassif } from '@/components/hotline/ClassificationTicket'
import {
  FILIERES,
  GAMMES,
  MOTIFS,
  NATURES,
  libelleNature,
  styleStatut,
  estResolu,
  trierTickets,
  chargerCollaborateurs,
  COLLABORATEURS_VIDE,
  nomCollaborateur,
  redescendre,
  demanderRappel,
  rappelEffectue,
  noteRapide,
  MARQUES_SOLEIL,
  marqueSoleil,
  libelleEquipementSoleil,
  SEVERITES,
  ACTIONS_REPRISE,
  CATEGORIES_DOC_SOLEIL,
  chargerDocsSoleil,
  chargerMonEnvironnement,
  planifierReprise,
  type ActionReprise,
  type DocSoleil,
  type MarqueSoleil,
  type Severite,
  type Collaborateurs,
  ajouterEtape,
  chargerArbres,
  CONTEXTE_VIDE,
  chargerContexte,
  chargerDossiers,
  chargerLivraisons,
  chargerEtapes,
  chargerLignes,
  chargerNoeuds,
  chargerReferencesVues,
  libelleGamme,
  referenceVue,
  escalader,
  fmtDate,
  fmtDateHeure,
  fmtEuro,
  fmtTel,
  identifierAppelant,
  libelleFiliere,
  libelleMotif,
  creerBrouillonEmail,
  ouvrirMessagerie,
  posteWindows,
  telechargerPieceJointe,
  messageEnvoiDocument,
  majTicket,
  messageErreur,
  rechercherTiers,
  resoudre,
  issueRequise,
  telCle,
  chargerParametres,
  PARAMETRES_DEFAUT,
  signalerConsultation,
  messagerieTelephonique,
  mettreEnAttenteClient,
  dupliquerTicket,
  type ParametresHotline,
  type Appelant,
  type Arbre,
  type Choix,
  type Contexte,
  type DocumentLien,
  type Etape,
  type Filiere,
  type Gamme,
  type Ligne,
  type Nature,
  type Dossier,
  type Livraison,
  type Motif,
  type Noeud,
  type Ticket,
  type TicketHistorique,
  type TiersTrouve,
} from '@/lib/hotline'

type Formulaire = {
  filiere: Filiere | null
  gamme: Gamme | null
  motif: Motif | null
  numero_tiers: string
  intitule_tiers: string
  contact_nom: string
  contact_email: string
  chantier: string
  numero_serie: string
  reference_article: string
  modele_ge: string
  serie_ge: string
  nature: Nature | ''
  code_defaut: string
  date_mes: string
  description: string
  /** (12/11/2026) Collaborateur N1 qui doit rappeler le client. */
  rappel_par: string
  /** (13/11/2026) Soleil : NIV 2 / NIV 3, onduleur, batterie, sévérité. */
  pv_marque: MarqueSoleil | null
  pv_equipement: string
  onduleur_modele: string
  onduleur_serie: string
  batterie_modele: string
  batterie_serie: string
  severite: Severite | ''
}

const FORM_VIDE: Formulaire = {
  filiere: null,
  gamme: null,
  motif: null,
  numero_tiers: '',
  intitule_tiers: '',
  contact_nom: '',
  contact_email: '',
  chantier: '',
  numero_serie: '',
  reference_article: '',
  modele_ge: '',
  serie_ge: '',
  nature: 'DEPANNAGE',
  code_defaut: '',
  date_mes: '',
  description: '',
  rappel_par: '',
  pv_marque: null,
  pv_equipement: '',
  onduleur_modele: '',
  onduleur_serie: '',
  batterie_modele: '',
  batterie_serie: '',
  severite: '',
}

/** Champs Soleil d'un ticket → formulaire. */
function formSoleil(t: Ticket): Pick<Formulaire, 'pv_marque' | 'pv_equipement' | 'onduleur_modele' | 'onduleur_serie' | 'batterie_modele' | 'batterie_serie' | 'severite'> {
  return {
    pv_marque: t.pv_marque || null,
    pv_equipement: t.pv_equipement || '',
    onduleur_modele: t.onduleur_modele || '',
    onduleur_serie: t.onduleur_serie || '',
    batterie_modele: t.batterie_modele || '',
    batterie_serie: t.batterie_serie || '',
    severite: t.severite || '',
  }
}

/** Formulaire → champs Soleil du ticket (vidés hors Soleil). */
function patchSoleil(f: Formulaire) {
  const pv = f.filiere === 'PV'
  return {
    pv_marque: pv ? f.pv_marque : null,
    pv_equipement: pv ? f.pv_equipement || null : null,
    onduleur_modele: pv ? f.onduleur_modele.trim() || null : null,
    onduleur_serie: pv ? f.onduleur_serie.trim() || null : null,
    batterie_modele: pv ? f.batterie_modele.trim() || null : null,
    batterie_serie: pv ? f.batterie_serie.trim() || null : null,
    severite: pv ? f.severite || null : null,
  }
}

type Reprise = { date: string; action: ActionReprise | ''; precision: string; pour: string }
const REPRISE_VIDE: Reprise = { date: '', action: '', precision: '', pour: '' }

// (12/11/2026) Nature proposée par défaut : « Dépannage », ou « Assistance /
// réglage » quand le motif est « Mise en service ». Une nature choisie à la main
// (autre que ces deux valeurs par défaut) n'est pas écrasée au changement de motif.
function natureParDefaut(motif: Motif | null): Nature {
  return motif === 'MISE_EN_SERVICE' ? 'ASSISTANCE' : 'DEPANNAGE'
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
  // Classification du ticket (08/11/2026) : symptôme, organe, actions, issue.
  const [classifForm, setClassifForm] = useState<ValeursClassif>(CLASSIF_FORM_VIDE)
  const { classif } = useClassification()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [etapes, setEtapes] = useState<Etape[]>([])
  const [contexte, setContexte] = useState<Contexte>(CONTEXTE_VIDE)
  const [contexteLoading, setContexteLoading] = useState(false)
  const [livraisons, setLivraisons] = useState<Livraison[]>([])
  const [livraisonsLoading, setLivraisonsLoading] = useState(false)
  const [dossiers, setDossiers] = useState<{ total: number; liste: Dossier[] }>({ total: 0, liste: [] })
  const [dossiersLoading, setDossiersLoading] = useState(false)
  const [dossierChoisi, setDossierChoisi] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [envoiEnCours, setEnvoiEnCours] = useState<string | null>(null)
  const [docAEnvoyer, setDocAEnvoyer] = useState<DocumentLien | null>(null)
  const [busy, setBusy] = useState(false)

  // Diagnostic guidé
  const [arbreId, setArbreId] = useState<string>('')
  const [noeuds, setNoeuds] = useState<Noeud[]>([])
  const [noeudCourant, setNoeudCourant] = useState<string | null>(null)
  const [parcours, setParcours] = useState<Array<{ noeud: string; choix: string }>>([])
  const [fin, setFin] = useState<Choix | null>(null)
  const [docsDiagnostic, setDocsDiagnostic] = useState<DocumentLien[]>([])
  const [commentaire, setCommentaire] = useState('')
  // (12/11/2026) Commentaire interne : jamais repris dans la fiche ticket PDF.
  const [commentaireInterne, setCommentaireInterne] = useState('')
  // Collaborateurs hotline (fonction N1 / N2 / N3) et fenêtre d'escalade / de retour.
  const [collaborateurs, setCollaborateurs] = useState<Collaborateurs>(COLLABORATEURS_VIDE)
  // (13/11/2026) Environnement hotline de l'utilisateur (Thermie / Soleil),
  // documents Soleil de la marque choisie, reprise du traitement (Soleil).
  const [environnement, setEnvironnement] = useState<Filiere | null>(null)
  const [docsSoleil, setDocsSoleil] = useState<DocSoleil[]>([])
  const [reprise, setReprise] = useState<Reprise>(REPRISE_VIDE)
  const [fenetreNiveau, setFenetreNiveau] = useState<'escalade' | 'redescente' | null>(null)
  // Vues éclatées : références qui en ont une, vue ouverte.
  const [refsVues, setRefsVues] = useState<Set<string>>(new Set())
  const [vueOuverte, setVueOuverte] = useState<string | null>(null)
  // Vue éclatée Hi-Parts (12/11/2026) : modèle GE ou UI ouvert.
  const [hiParts, setHiParts] = useState<{ modele: string; unite: 'GE' | 'UI' } | null>(null)
  // Ticket de l'historique affiché en fenêtre flottante (04/11/2026).
  const [ticketHisto, setTicketHisto] = useState<string | null>(null)
  const fermerTicketHisto = useCallback(() => setTicketHisto(null), [])
  // (13/11/2026) Paramètres hotline : diagnostic guidé et classification détaillée masqués en V1.
  const [parametres, setParametres] = useState<ParametresHotline>(PARAMETRES_DEFAUT)
  useEffect(() => {
    chargerParametres().then(setParametres).catch(() => undefined)
  }, [])
  // Ticket de test (numéroté TEST…), choisi avant l'ouverture.
  const [estTest, setEstTest] = useState(false)
  // Présence : le ticket ouvert ici est signalé aux autres hotliners (n° en rouge dans leur liste).
  const ticketIdPresence = ticket && !estResolu(ticket) ? ticket.id : null
  useEffect(() => {
    if (!ticketIdPresence || !email) return
    const id = ticketIdPresence
    void signalerConsultation(id, email)
    const h = window.setInterval(() => void signalerConsultation(id, email), 60_000)
    const liberer = () => void signalerConsultation(id, null)
    window.addEventListener('pagehide', liberer)
    return () => {
      window.clearInterval(h)
      window.removeEventListener('pagehide', liberer)
      liberer()
    }
  }, [ticketIdPresence, email])

  const patch = (p: Partial<Formulaire>) => setForm((f) => ({ ...f, ...p }))

  // Environnement : la filière de l'utilisateur est présélectionnée.
  useEffect(() => {
    chargerMonEnvironnement()
      .then((env) => {
        setEnvironnement(env.filiere)
        if (env.filiere) setForm((f) => (f.filiere ? f : { ...f, filiere: env.filiere }))
      })
      .catch(() => undefined)
  }, [])

  // Documents Soleil de la marque (NIV 2 + NIV 3).
  useEffect(() => {
    if (form.filiere !== 'PV' || !form.pv_marque) return
    let actif = true
    chargerDocsSoleil(form.pv_marque)
      .then((l) => actif && setDocsSoleil(l))
      .catch(() => undefined)
    return () => {
      actif = false
    }
  }, [form.filiere, form.pv_marque])

  // Référentiels -------------------------------------------------------------
  useEffect(() => {
    Promise.all([chargerLignes(), chargerArbres({ actifsSeulement: true })])
      .then(([l, a]) => {
        setLignes(l)
        setArbres(a)
        setArbresCharges(true)
      })
      .catch((e) => setErreur(messageErreur(e)))
    chargerReferencesVues()
      .then((refs) => setRefsVues(new Set(refs)))
      .catch(() => undefined)
  }, [])

  // Collaborateurs hotline : N2 par défaut selon le département du client.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      chargerCollaborateurs(form.numero_tiers.trim() || null)
        .then(setCollaborateurs)
        .catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(handle)
  }, [form.numero_tiers])

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

  // Reprise d'un ticket existant -------------------------------------------
  // (12/11/2026) Suivi du paramètre ?ticket= : le bandeau violet peut faire
  // basculer la console, déjà ouverte, sur un autre ticket.
  const ticketParam = params.get('ticket') || ''
  const dernierRepris = useRef('')
  // Réponses à rejouer quand les questions de l'arbre du ticket sont chargées.
  const aRejouer = useRef<{ arbreId: string; reponses: Etape[] } | null>(null)
  const [arbresCharges, setArbresCharges] = useState(false)
  // Rechargement du parcours quand on bascule sur un ticket du même arbre.
  const [rechargeArbre, setRechargeArbre] = useState(0)

  useEffect(() => {
    const id = ticketParam
    if (!id || !arbresCharges || dernierRepris.current === id) return
    dernierRepris.current = id
    void (async () => {
      try {
        // Saisie en cours du ticket précédent abandonnée.
        setCommentaire('')
        setCommentaireInterne('')
        setFenetreNiveau(null)
        setVueOuverte(null)
        setErreur(null)
        setAppelants(null)
        const { data, error } = await supabase.from('hotline_tickets').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (!data) throw new Error('Ticket introuvable.')
        const t = data as Ticket
        const liste = await chargerEtapes(t.id)
        setTelephone(t.telephone_appelant || '')
        setForm({
          filiere: t.filiere,
          gamme: t.gamme || arbres.find((a) => a.id === t.arbre_id)?.gamme || null,
          motif: t.motif,
          numero_tiers: t.numero_tiers || '',
          intitule_tiers: t.intitule_tiers || '',
          contact_nom: t.contact_nom || '',
          contact_email: t.contact_email || '',
          chantier: t.chantier || '',
          numero_serie: t.numero_serie || '',
          reference_article: t.reference_article || '',
          modele_ge: t.modele_ge || '',
          serie_ge: t.serie_ge || '',
          nature: t.nature || '',
          code_defaut: t.code_defaut || '',
          date_mes: t.date_mes || '',
          description: t.description || '',
          rappel_par: t.rappel_par || '',
          ...formSoleil(t),
        })
        setReprise(REPRISE_VIDE)
        setClassifForm(valeursDepuisTicket(t))
        if (t.arbre_id) {
          aRejouer.current = { arbreId: t.arbre_id, reponses: liste.filter((e) => e.type === 'QUESTION' && e.noeud_id) }
          setArbreId(t.arbre_id)
          setRechargeArbre((n) => n + 1)
        } else {
          aRejouer.current = null
          setArbreId('')
        }
        // (13/11/2026) Un ticket résolu est verrouillé : consultation seule,
        // « Dupliquer » pour reprendre le dossier.
        if (estResolu(t)) {
          setTicket(t)
          setEtapes(liste)
          return
        }
        // Reprise = prise en charge par la personne qui ouvre la console
        // (« en attente client » reste en attente jusqu'à la prochaine action).
        const statut = t.statut === 'ATTENTE_CLIENT' ? t.statut : ('EN_COURS' as const)
        const qui = String(email || '').split('@')[0]
        await majTicket(t.id, { assigne_a: email || t.assigne_a, statut })
        await ajouterEtape(t.id, 'COMMENTAIRE', `Repris dans la console par ${qui} (niveau ${t.niveau})`)
        setTicket({ ...t, assigne_a: email || t.assigne_a, statut })
        setEtapes(await chargerEtapes(t.id))
      } catch (e) {
        setErreur(messageErreur(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbresCharges, email, ticketParam])

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
      if (!form.numero_tiers && !form.numero_serie && !form.serie_ge && !form.chantier && telCle(telephone).length < 9) {
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
            numeroSerie: form.numero_serie || form.serie_ge,
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
  }, [form.numero_tiers, form.chantier, form.numero_serie, form.serie_ge, form.contact_nom, telephone, ticket?.id])

  // Dossiers de vente du client (02/11/2026) : référence chantier, n° de pièce
  // ou produit saisi dans « Chantier » (sinon « Modèle »). Sans recherche : les
  // dossiers les plus récents. Un seul dossier trouvé = ouvert directement.
  const rechercheDossier = (form.chantier.trim() || form.reference_article.trim())
  useEffect(() => {
    const tiers = form.numero_tiers.trim()
    const q = rechercheDossier
    const handle = window.setTimeout(async () => {
      if (!tiers) {
        setDossiers({ total: 0, liste: [] })
        return
      }
      setDossiersLoading(true)
      try {
        const r = await chargerDossiers(tiers, q.length >= 2 ? q : null)
        setDossiers({ total: r.total, liste: r.dossiers })
        setDossierChoisi((actuel) => {
          if (actuel && r.dossiers.some((d) => d.cle === actuel)) return actuel
          return q.length >= 2 && r.dossiers.length === 1 ? r.dossiers[0].cle : null
        })
      } catch (e) {
        setErreur(messageErreur(e))
      } finally {
        setDossiersLoading(false)
      }
    }, 500)
    return () => window.clearTimeout(handle)
  }, [form.numero_tiers, rechercheDossier])

  function choisirDossier(d: Dossier | null) {
    setDossierChoisi(d ? d.cle : null)
    if (d && ticket) {
      const pieces = [d.cdc?.piece, ...d.bls.map((b) => b.piece)].filter(Boolean).join(', ')
      void ajouterEtape(ticket.id, 'COMMENTAIRE', `Dossier consulté : ${d.reference || d.cle}${pieces ? ` (${pieces})` : ''}`).then(() => rafraichirEtapes(ticket.id))
    }
  }

  // Sans client identifié : livraisons par chantier / n° de série (tous clients)
  useEffect(() => {
    const chantier = form.chantier.trim()
    const article = form.reference_article.trim()
    const serie = form.numero_serie.trim()
    const avecClient = Boolean(form.numero_tiers.trim())
    const handle = window.setTimeout(async () => {
      if (avecClient || (chantier.length < 3 && serie.length < 4)) {
        setLivraisons([])
        return
      }
      setLivraisonsLoading(true)
      try {
        setLivraisons(await chargerLivraisons({ numeroTiers: form.numero_tiers, chantier, referenceArticle: article, numeroSerie: serie }))
      } catch (e) {
        setErreur(messageErreur(e))
      } finally {
        setLivraisonsLoading(false)
      }
    }, 500)
    return () => window.clearTimeout(handle)
  }, [form.numero_tiers, form.chantier, form.reference_article, form.numero_serie])


  // Arbre de diagnostic ------------------------------------------------------
  const arbresPossibles = useMemo(
    () =>
      arbres.filter(
        (a) =>
          a.filiere === form.filiere &&
          (!form.motif || a.motif === form.motif) &&
          (form.filiere !== 'THERMIQUE' || !form.gamme || !a.gamme || a.gamme === form.gamme),
      ),
    [arbres, form.filiere, form.motif, form.gamme],
  )

  useEffect(() => {
    if (arbresPossibles.some((a) => a.id === arbreId)) return
    // Thermie sans gamme choisie : on attend la gamme avant de proposer un parcours.
    if (form.filiere === 'THERMIQUE' && !form.gamme) {
      if (!aRejouer.current) setArbreId('')
      return
    }
    setArbreId(arbresPossibles.length === 1 ? arbresPossibles[0].id : '')
  }, [arbresPossibles, arbreId, form.filiere, form.gamme])

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
        if (!racine) return
        // Reprise : on rejoue les réponses déjà données (chronologie du ticket)
        // pour revenir à la question où le diagnostic s'était arrêté.
        const rejeu = aRejouer.current
        if (rejeu && rejeu.arbreId === arbreId) {
          aRejouer.current = null
          const map = new Map(liste.map((n) => [n.id, n]))
          let courant = racine.id
          let finRejeu: Choix | null = null
          const chemin: Array<{ noeud: string; choix: string }> = []
          const docs = [...racine.documents]
          for (const e of rejeu.reponses) {
            const n = map.get(String(e.noeud_id))
            const libelle = e.libelle.split(' → ').pop() || ''
            const c = n?.choix.find((x) => x.libelle === libelle)
            if (!n || !c) continue
            chemin.push({ noeud: n.id, choix: c.libelle })
            const suivant = c.suivant ? map.get(c.suivant) : null
            if (suivant) {
              courant = suivant.id
              finRejeu = null
              suivant.documents.forEach((d) => {
                if (!docs.some((x) => x.titre === d.titre)) docs.push(d)
              })
            } else {
              courant = n.id
              finRejeu = c
            }
          }
          setParcours(chemin)
          setNoeudCourant(courant)
          setFin(finRejeu)
          setDocsDiagnostic(docs)
          return
        }
        setNoeudCourant(racine.id)
        setDocsDiagnostic(racine.documents)
      })
      .catch((e) => setErreur(messageErreur(e)))
  }, [arbreId, arbres, rechargeArbre])

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
      setErreur('Choisir la filière (Soleil ou thermique) avant d’ouvrir le ticket.')
      return
    }
    if (form.filiere === 'PV' && !form.severite) {
      setErreur('Choisir la sévérité (non bloquant, bloquant, critique) avant d’ouvrir le ticket.')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('hotline_tickets')
        .insert({
          filiere: form.filiere,
          motif: form.motif,
          gamme: form.filiere === 'THERMIQUE' ? form.gamme : null,
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
          modele_ge: form.modele_ge.trim() || null,
          serie_ge: form.serie_ge.trim() || null,
          nature: form.nature || null,
          code_defaut: form.code_defaut.trim() || null,
          date_mes: form.date_mes || null,
          description: form.description || null,
          ...patchClassif(classifForm),
          arbre_id: arbreId || null,
          assigne_a: email || null,
          rappel_par: form.rappel_par || null,
          rappel_demande_le: form.rappel_par ? new Date().toISOString() : null,
          rappel_demande_par: form.rappel_par ? email || null : null,
          ...patchSoleil(form),
          est_test: estTest,
        })
        .select('*')
        .single()
      if (error) throw error
      const t = data as Ticket
      const soleil = t.filiere === 'PV' && t.pv_marque ? ` · ${marqueSoleil(t.pv_marque)?.label}${t.pv_equipement ? ` › ${libelleEquipementSoleil(t.pv_marque, t.pv_equipement)}` : ''}` : ''
      const sev = t.severite ? ` · ${SEVERITES.find((x) => x.value === t.severite)?.label}` : ''
      await ajouterEtape(t.id, 'OUVERTURE', `${t.est_test ? 'TICKET TEST · ' : ''}Ticket ${t.numero} ouvert · ${libelleFiliere(t.filiere)}${t.gamme ? ` ${libelleGamme(t.gamme)}` : ''} · ${libelleMotif(t.motif)}${soleil}${sev}`, {
        details: { telephone: telephone || null, ligne: ligneAppelee || null },
      })
      if (form.numero_tiers) {
        await ajouterEtape(t.id, 'IDENTIFICATION', `Appelant : ${form.intitule_tiers || form.numero_tiers}${form.contact_nom ? ` (${form.contact_nom})` : ''}`)
      }
      // Motif de l'appel = premier commentaire du ticket (« Note rapide »).
      await noteRapide(t.id, form.description)
      if (form.rappel_par) await ajouterEtape(t.id, 'RAPPEL', `Client à rappeler par ${nomCollaborateur(form.rappel_par, collaborateurs)}`, { details: { rappel_par: form.rappel_par } })
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
        gamme: (form.filiere || ticket.filiere) === 'THERMIQUE' ? form.gamme : null,
        motif: form.motif,
        numero_tiers: form.numero_tiers || null,
        intitule_tiers: form.intitule_tiers || null,
        contact_nom: form.contact_nom || null,
        contact_email: form.contact_email.trim() || null,
        chantier: form.chantier || null,
        numero_serie: form.numero_serie || null,
        reference_article: form.reference_article || null,
        modele_ge: form.modele_ge.trim() || null,
        serie_ge: form.serie_ge.trim() || null,
        nature: form.nature || null,
        code_defaut: form.code_defaut.trim() || null,
        date_mes: form.date_mes || null,
        description: form.description || null,
        ...patchClassif(classifForm),
        ...patchSoleil({ ...form, filiere: form.filiere || ticket.filiere }),
        arbre_id: arbreId || null,
      })
      await ajouterEtape(ticket.id, 'IDENTIFICATION', 'Informations du ticket mises à jour')
      if ((form.description || '').trim() !== (ticket.description || '').trim()) await noteRapide(ticket.id, form.description, true)
      if ((form.rappel_par || null) !== (ticket.rappel_par || null)) {
        await demanderRappel(ticket.id, form.rappel_par ? { email: form.rappel_par, nom: nomCollaborateur(form.rappel_par, collaborateurs) } : null)
      }
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

  function recommencer() {
    const arbre = arbres.find((a) => a.id === arbreId)
    const racine = noeuds.find((n) => n.id === arbre?.noeud_racine) || noeuds[0]
    if (!racine) return
    setParcours([])
    setFin(null)
    setNoeudCourant(racine.id)
    setDocsDiagnostic((docs) => [...docs, ...racine.documents.filter((d) => !docs.some((x) => x.titre === d.titre))])
    if (ticket) void ajouterEtape(ticket.id, 'COMMENTAIRE', 'Diagnostic recommencé depuis la première question').then(() => rafraichirEtapes(ticket.id))
  }

  function revenir() {
    const precedent = parcours[parcours.length - 1]
    if (!precedent) return
    setParcours((p) => p.slice(0, -1))
    setNoeudCourant(precedent.noeud)
    setFin(null)
  }

  // (13/11/2026) Soleil : un ticket non résolu doit avoir une reprise du
  // traitement planifiée (date + action) ; elle crée une tâche pour le collaborateur.
  const repriseSaisie = Boolean(reprise.date && reprise.action && (reprise.action !== 'AUTRE' || reprise.precision.trim()))
  const reprisePlanifiee = Boolean(ticket?.reprise_le && ticket.reprise_le >= new Date().toISOString().slice(0, 10))

  async function action(nom: 'resoudre' | 'commentaire') {
    if (!ticket) return
    if (nom === 'commentaire' && ticket.filiere === 'PV' && !estResolu(ticket) && !repriseSaisie && !reprisePlanifiee) {
      setErreur('Ticket non résolu : indiquer la reprise du traitement (date et action) avant d’enregistrer.')
      return
    }
    if (nom === 'commentaire' && reprise.action === 'AUTRE' && reprise.date && !reprise.precision.trim()) {
      setErreur('Action « Autre » : préciser l’action à mener.')
      return
    }
    setBusy(true)
    try {
      // Les commentaires en cours de saisie sont enregistrés avant l'action.
      if (commentaire.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE', commentaire.trim())
      if (commentaireInterne.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE_INTERNE', commentaireInterne.trim())
      if (nom === 'commentaire' && classifModifiee) {
        await majTicket(ticket.id, patchClassif(classifForm))
        await ajouterEtape(ticket.id, 'COMMENTAIRE', 'Issue / classification mise à jour')
      }
      if (nom === 'commentaire' && ticket.filiere === 'PV' && repriseSaisie) {
        const pourEmail = reprise.pour || email || ''
        await planifierReprise(
          { ...ticket, description: form.description || ticket.description },
          { date: reprise.date, action: reprise.action as ActionReprise, precision: reprise.precision, pour: { email: pourEmail, nom: nomCollaborateur(pourEmail, collaborateurs) } },
          { email: email || '', nom: nomCollaborateur(email, collaborateurs) },
        )
        setReprise(REPRISE_VIDE)
      }
      if (nom === 'resoudre') {
        if (issueRequise(ticket) && !classifForm.issue) throw new Error('Choisir l’issue du ticket (bloc Classification) avant de le marquer résolu.')
        await majTicket(ticket.id, patchClassif(classifForm))
        await resoudre(ticket.id, fin?.preconisation || commentaire.trim() || '')
        patch({ rappel_par: '' })
      }
      setCommentaire('')
      setCommentaireInterne('')
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  // (13/11/2026) Actions rapides : messagerie téléphonique, attente client, duplication.
  async function actionRapide(nom: 'messagerie' | 'attente' | 'dupliquer') {
    if (!ticket) return
    setBusy(true)
    try {
      if (nom === 'dupliquer') {
        const t = await dupliquerTicket(ticket, email || null)
        window.location.assign(`/hotline?ticket=${t.id}`)
        return
      }
      if (commentaire.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE', commentaire.trim())
      if (commentaireInterne.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE_INTERNE', commentaireInterne.trim())
      if (nom === 'messagerie') await messagerieTelephonique(ticket)
      else await mettreEnAttenteClient(ticket.id)
      setCommentaire('')
      setCommentaireInterne('')
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  // Soleil : NIV 2 (marque de l'onduleur) / NIV 3 (équipement), enregistrés
  // aussitôt sur un ticket ouvert.
  async function choisirSoleil(marque: MarqueSoleil | null, equipement: string) {
    patch({ pv_marque: marque, pv_equipement: equipement })
    if (!ticket) return
    try {
      await majTicket(ticket.id, { pv_marque: marque, pv_equipement: equipement || null })
      const m = marqueSoleil(marque)
      await ajouterEtape(ticket.id, 'IDENTIFICATION', m ? `Onduleur ${m.label}${equipement ? ` › ${libelleEquipementSoleil(marque, equipement)}` : ''}` : 'Marque de l’onduleur retirée')
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    }
  }

  // Escalade (collaborateur N2 obligatoire) ou retour au niveau inférieur (12/11/2026).
  async function changerNiveau(v: { destinataire: { email: string; nom: string } | null; motif: string }) {
    if (!ticket || !fenetreNiveau) return
    setBusy(true)
    try {
      if (commentaireInterne.trim()) await ajouterEtape(ticket.id, 'COMMENTAIRE_INTERNE', commentaireInterne.trim())
      if (fenetreNiveau === 'escalade') {
        await majTicket(ticket.id, patchClassif(classifForm))
        await escalader({ ...ticket, actions: classifForm.actions }, v.motif, v.destinataire)
        setClassifForm((c) => ({ ...c, actions: Array.from(new Set([...c.actions, 'ESCALADE'])) }))
      } else {
        await redescendre(ticket, v.motif, v.destinataire)
      }
      setCommentaire('')
      setCommentaireInterne('')
      setFenetreNiveau(null)
      await rafraichirEtapes(ticket.id)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  // Envoi d'un document par la messagerie du poste (02/11/2026) : fenêtre
  // d'aperçu (destinataire, objet, message), puis
  //  - Windows : brouillon .eml ouvert par Outlook, document joint ;
  //  - Mac : nouveau message (mailto) + document téléchargé à glisser dedans.
  // Rien n'est envoyé par le compagnon ; l'envoi est noté dans le ticket.
  function envoyerDocument(doc: DocumentLien) {
    setDocAEnvoyer(doc)
  }

  function ouvrirVue(reference: string) {
    const ref = reference.trim().toUpperCase()
    if (!ref) return
    setVueOuverte(ref)
    if (!form.reference_article.trim()) patch({ reference_article: ref })
    if (ticket) void ajouterEtape(ticket.id, 'COMMENTAIRE', `Vue éclatée consultée : ${ref}`).then(() => rafraichirEtapes(ticket.id))
  }

  // Hi-Parts : la pièce choisie est ajoutée au motif de l'appel (et au ticket s'il est ouvert).
  async function ajouterPieceHiParts(texte: string) {
    const base = form.description.trim()
    const description = base ? `${base}\n${texte}` : texte
    patch({ description })
    if (ticket) {
      await majTicket(ticket.id, { description })
      setTicket((t) => (t ? { ...t, description } : t))
      await ajouterEtape(ticket.id, 'COMMENTAIRE', texte)
      await rafraichirEtapes(ticket.id)
    }
  }

  async function preparerMessage(v: { to: string; subject: string; text: string; mode: 'auto' | 'eml' }) {
    if (!docAEnvoyer) return
    const doc = docAEnvoyer
    setEnvoiEnCours(doc.titre)
    try {
      let detail: string
      if (v.mode === 'eml' || posteWindows()) {
        const { joint } = await creerBrouillonEmail({ doc, destinataire: v.to, contactNom: form.contact_nom, ticketNumero: ticket?.numero, objet: v.subject, texte: v.text })
        detail = joint ? 'brouillon Outlook, document joint' : 'brouillon Outlook, lien dans le texte'
        setInfo(`Brouillon « ${doc.titre} » téléchargé : ouvrez-le, il s’affiche dans Outlook en nouveau message${joint ? ' avec le document joint' : ''}. Rien n’a été envoyé.`)
      } else {
        const fichier = await telechargerPieceJointe(doc)
        const body = fichier || !doc.url ? v.text : `${v.text}\n\nLien vers le document « ${doc.titre} » :\n${doc.url}`
        ouvrirMessagerie({ to: v.to, subject: v.subject, body })
        detail = fichier ? `messagerie + fichier « ${fichier} » à joindre` : 'messagerie, lien dans le texte'
        setInfo(
          fichier
            ? `Votre messagerie s’ouvre avec le message prêt. Le document « ${fichier} » vient d’être téléchargé : glissez-le dans le message, puis envoyez.`
            : `Votre messagerie s’ouvre avec le message prêt (le document n’a pas pu être téléchargé : son lien est dans le texte).`,
        )
      }
      window.setTimeout(() => setInfo(null), 12000)
      setDocAEnvoyer(null)
      if (ticket) {
        await ajouterEtape(ticket.id, 'DOCUMENT', `Document préparé pour envoi${v.to ? ` à ${v.to}` : ''} (${detail}) : ${doc.titre}`, {
          details: { ...doc, destinataire: v.to || null, mode: detail },
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
    setForm({ ...FORM_VIDE, filiere: environnement })
    setReprise(REPRISE_VIDE)
    setClassifForm(CLASSIF_FORM_VIDE)
    setTicket(null)
    setEtapes([])
    setArbreId('')
    setCommentaire('')
    setCommentaireInterne('')
    setFenetreNiveau(null)
    setErreur(null)
    setVueOuverte(null)
    setEstTest(false)
    dernierRepris.current = ''
    window.history.replaceState(null, '', '/hotline')
  }

  const statut = ticket ? styleStatut(ticket.statut) : null
  const verrouille = Boolean(ticket && estResolu(ticket))
  // « Sauvegarder état » actif dès qu'on tape un commentaire (ou qu'on change l'issue / la reprise).
  const classifModifiee = Boolean(ticket && ticket.filiere === 'THERMIQUE' && JSON.stringify(patchClassif(classifForm)) !== JSON.stringify(patchClassif(valeursDepuisTicket(ticket))))
  const etatModifie = Boolean(commentaire.trim() || commentaireInterne.trim() || classifModifiee || (ticket?.filiere === 'PV' && repriseSaisie))
  const diagnosticActif = parametres.diagnostic_guide_actif
  // (13/11/2026) Seuls les N1 de l'environnement du ticket (Thermie / Soleil) ou sans environnement.
  const filiereCourante = ticket?.filiere || form.filiere
  const collaborateursN1 = collaborateurs.liste.filter((c) => c.niveau === 1 && (!c.filiere || !filiereCourante || c.filiere === filiereCourante))

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <HotlineHeader
        titre="Console d’appel"
        sousTitre={
          ticket
            ? `Ticket ${ticket.numero} créé le ${fmtDateHeure(ticket.opened_at)} par ${String(ticket.ouvert_par || '').split('@')[0]}${ticket.source === 'IMPORT' ? ' (repris de l’ancien outil)' : ''}`
            : ligneAppelee
              ? `Appel reçu sur ${fmtTel(ligneAppelee)}${form.filiere ? ` · ${libelleFiliere(form.filiere)}` : ''}`
              : 'Saisir le numéro de l’appelant, ou ouvrir la console depuis 3CX'
        }
        actions={
          <>
            {ticket ? (
              <span className="flex items-center gap-2 rounded-lg border border-[color:var(--cg-hdr-line)] px-3 py-1.5 text-sm font-semibold text-[color:var(--cg-hdr-ink)]">
                {ticket.numero} · N{ticket.niveau} {statut ? <Pastille {...statut} /> : null}
                {ticket.est_test ? <span className="rounded bg-[#5F6670] px-1.5 py-px text-[10px] font-bold text-white">TEST</span> : null}
                <span className="text-[12px] font-normal text-[color:var(--cg-hdr-muted)]">créé le {fmtDateHeure(ticket.opened_at)}</span>
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
                {FILIERES.filter((f) => !environnement || f.value === environnement || f.value === form.filiere || f.value === ticket?.filiere).map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => patch({ filiere: f.value, gamme: f.value === 'THERMIQUE' ? form.gamme : null })}
                    className={`flex-1 rounded-md px-2 py-1.5 font-semibold ${form.filiere === f.value ? 'bg-[#0B1220] text-white' : 'text-slate-600'}`}
                  >
                    {f.icon} {f.court}
                  </button>
                ))}
              </div>
              {form.filiere === 'THERMIQUE' ? (
                <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[12px]">
                  {GAMMES.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      title={g.titre}
                      onClick={() => patch({ gamme: form.gamme === g.value ? null : g.value })}
                      className={`flex-1 rounded-md px-2 py-1.5 font-semibold ${form.gamme === g.value ? 'bg-[#1E4E8C] text-white' : 'text-slate-600'}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[12px]">
                {MOTIFS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() =>
                      patch({
                        motif: m.value,
                        ...(form.nature === '' || form.nature === 'DEPANNAGE' || form.nature === 'ASSISTANCE' ? { nature: natureParDefaut(m.value) } : {}),
                      })
                    }
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
              <label className="block text-[11px] font-semibold text-slate-500">
                Chantier / référence
                <input value={form.chantier} onChange={(e) => patch({ chantier: e.target.value })} placeholder="Chantier ou produit" title="Référence chantier SAGE, ou nom / référence de produit (client identifié)" className={champ} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-slate-500">
                  Nature de l’appel
                  <select value={form.nature} onChange={(e) => patch({ nature: e.target.value as Nature | '' })} className={champ}>
                    <option value="">—</option>
                    {NATURES.map((n) => (
                      <option key={n.value} value={n.value}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-slate-500">
                  Code défaut
                  <input value={form.code_defaut} onChange={(e) => patch({ code_defaut: e.target.value })} className={champ} />
                </label>
              </div>
              {form.filiere === 'PV' ? (
                <div className="rounded-lg border border-[#EFEDE8] bg-[#FAF9F7] p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">Onduleur</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={form.onduleur_modele} onChange={(e) => patch({ onduleur_modele: e.target.value })} placeholder="Modèle onduleur" className={champ} />
                    <input value={form.onduleur_serie} onChange={(e) => patch({ onduleur_serie: e.target.value.toUpperCase() })} placeholder="N° de série onduleur" className={champ} />
                  </div>
                  <div className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">Batterie</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={form.batterie_modele} onChange={(e) => patch({ batterie_modele: e.target.value })} placeholder="Modèle batterie" className={champ} />
                    <input value={form.batterie_serie} onChange={(e) => patch({ batterie_serie: e.target.value.toUpperCase() })} placeholder="N° de série batterie" className={champ} />
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                    Mise en service le
                    <input type="date" value={form.date_mes} onChange={(e) => patch({ date_mes: e.target.value })} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[12px] text-slate-900" />
                  </label>
                </div>
              ) : (
              <div className="rounded-lg border border-[#EFEDE8] bg-[#FAF9F7] p-2">
                <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
                  Groupe extérieur (GE)
                  <BoutonHiParts modele={form.modele_ge} onClick={() => setHiParts({ modele: form.modele_ge.trim(), unite: 'GE' })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.modele_ge} onChange={(e) => patch({ modele_ge: e.target.value })} placeholder="Modèle GE" className={champ} />
                  <ChampSerie
                    value={form.serie_ge}
                    onChange={(v) => patch({ serie_ge: v })}
                    onModele={(m) => patch({ modele_ge: m })}
                    typePrefere="GE"
                    placeholder="N° de série GE"
                    className={champ}
                  />
                </div>
                <div className="mb-1 mt-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
                  Unité intérieure (UI)
                  <span className="flex items-center gap-3">
                    {refsVues.has(form.reference_article.trim().toUpperCase()) ? (
                      <button type="button" onClick={() => ouvrirVue(form.reference_article)} className="text-[11px] font-bold normal-case tracking-normal text-[#B4761A] underline">
                        🔍 Vue éclatée
                      </button>
                    ) : null}
                    <BoutonHiParts modele={form.reference_article} onClick={() => setHiParts({ modele: form.reference_article.trim(), unite: 'UI' })} />
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.reference_article} onChange={(e) => patch({ reference_article: e.target.value })} placeholder="Modèle UI / référence" className={champ} />
                  <ChampSerie
                    value={form.numero_serie}
                    onChange={(v) => patch({ numero_serie: v })}
                    onModele={(m) => patch({ reference_article: m })}
                    typePrefere="UI"
                    placeholder="N° de série UI"
                    className={champ}
                  />
                </div>
                <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                  Mise en service le
                  <input type="date" value={form.date_mes} onChange={(e) => patch({ date_mes: e.target.value })} className="h-8 rounded-lg border border-[#D8D3C8] bg-white px-2 text-[12px] text-slate-900" />
                </label>
              </div>
              )}
              <label className="block text-[11px] font-semibold text-slate-500">
                Motif de l’appel
                <ZoneTexte
                  value={form.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  minRows={3}
                  className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]"
                />
                <span className="font-normal text-slate-400">Repris en tête des commentaires (« Note rapide ») et dans la liste des tickets.</span>
              </label>
              {form.filiere === 'PV' ? (
                <label className="block text-[11px] font-semibold text-slate-500">
                  Sévérité <span className="text-[#C1683C]">*</span>
                  <select
                    value={form.severite}
                    onChange={(e) => patch({ severite: e.target.value as Severite | '' })}
                    className={`${champ} ${!form.severite ? 'border-[#C1683C]' : 'font-semibold'}`}
                    style={form.severite ? { color: SEVERITES.find((x) => x.value === form.severite)?.tone } : undefined}
                  >
                    <option value="">— Choisir —</option>
                    {SEVERITES.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
              <label className="block text-[11px] font-semibold text-slate-500">
                📞 Client à rappeler par (N1)
                <select
                  value={form.rappel_par}
                  onChange={(e) => patch({ rappel_par: e.target.value })}
                  className={`${champ} ${form.rappel_par ? 'border-[#7A5EA8] font-semibold text-[#5B3F8C]' : ''}`}
                >
                  <option value="">— sans préférence —</option>
                  {collaborateursN1.map((c) => (
                    <option key={c.email} value={c.email}>
                      {c.nom}
                    </option>
                  ))}
                  {form.rappel_par && !collaborateursN1.some((c) => c.email === form.rappel_par) ? (
                    <option value={form.rappel_par}>{nomCollaborateur(form.rappel_par, collaborateurs)}</option>
                  ) : null}
                </select>
                {!collaborateursN1.length ? (
                  <span className="font-normal text-slate-400">Aucun collaborateur de fonction N1 (Autorisations › Utilisateurs › Hotline).</span>
                ) : null}
              </label>
              {ticket?.rappel_par ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[#D9CCEB] bg-[#F4F0FA] px-3 py-2 text-[12px] text-[#5B3F8C]">
                  <span>
                    📞 À rappeler par <span className="font-semibold">{nomCollaborateur(ticket.rappel_par, collaborateurs)}</span>
                    {ticket.rappel_demande_le ? <span className="text-[11px] text-slate-500"> depuis le {fmtDateHeure(ticket.rappel_demande_le)}</span> : null}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await rappelEffectue(ticket.id, String(email || '').split('@')[0])
                        patch({ rappel_par: '' })
                        await rafraichirEtapes(ticket.id)
                      } catch (e) {
                        setErreur(messageErreur(e))
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="shrink-0 font-semibold underline disabled:opacity-40"
                  >
                    Rappel effectué
                  </button>
                </div>
              ) : null}
                </>
              )}

              {verrouille ? null : ticket ? (
                <button
                  type="button"
                  onClick={enregistrerInfos}
                  disabled={busy}
                  className="h-9 w-full rounded-lg border border-[#D8D3C8] text-[13px] font-semibold text-slate-700 hover:border-[#B4761A] disabled:opacity-50"
                >
                  Mettre à jour le ticket
                </button>
              ) : (
                <>
                <label className="flex items-center gap-2 text-[12px] text-slate-600" title="Ticket fictif (formation, essai) : numéroté TEST…, exclu des statistiques et supprimable">
                  <input type="checkbox" checked={estTest} onChange={(e) => setEstTest(e.target.checked)} className="h-3.5 w-3.5 accent-[#5F6670]" />
                  Ticket de test (numéro TEST…)
                </label>
                <button
                  type="button"
                  onClick={ouvrirTicket}
                  disabled={busy || !form.filiere}
                  className="h-10 w-full rounded-lg bg-[#B4761A] text-[14px] font-bold text-white hover:bg-[#9A6414] disabled:opacity-50"
                >
                  Ouvrir le ticket
                </button>
                </>
              )}
            </div>

          </section>

          {/* ── Diagnostic guidé ─────────────────────────────────────── */}
          <section className={`${carte} xl:col-span-5`}>
            <div className={`${titreCarte} flex flex-wrap items-center justify-between gap-2`}>
              <span>{diagnosticActif ? 'Diagnostic guidé' : 'Ticket'}</span>
              {!diagnosticActif ? null : arbresPossibles.length > 1 ? (
                <select value={arbreId} onChange={(e) => setArbreId(e.target.value)} className="h-8 rounded-lg border border-[#D8D3C8] px-2 text-[12px] font-normal">
                  <option value="">Choisir le parcours…</option>
                  {arbresPossibles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nom}
                      {a.famille ? ` · ${a.famille}` : ''}
                      {a.gamme ? ` · ${libelleGamme(a.gamme)}` : ''}
                    </option>
                  ))}
                </select>
              ) : arbresPossibles[0] ? (
                <span className="text-[12px] font-normal text-slate-500">{arbresPossibles[0].nom}</span>
              ) : null}
            </div>
            <div className="p-5">
              {ticket && verrouille ? (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D5D9DE] bg-[#F3F4F6] px-4 py-3 text-[13px] text-slate-700">
                  <span>
                    🔒 <span className="font-semibold">Ticket résolu : verrouillé</span> (consultation seule). Pour reprendre le dossier, dupliquer le ticket.
                  </span>
                  <button type="button" disabled={busy} onClick={() => void actionRapide('dupliquer')} className="rounded-lg bg-[#0B1220] px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40">
                    ⧉ Dupliquer le ticket
                  </button>
                </div>
              ) : null}
              {ticket ? (
                <div className="mb-5 rounded-xl border border-[#E2DFD8] bg-[#FAF9F7]">
                  <div className="flex items-center justify-between gap-2 border-b border-[#EFEDE8] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">
                    <span>Historique du ticket{ticket.source === 'IMPORT' ? ' · repris de l’ancien outil' : ''}</span>
                    <button
                      type="button"
                      onClick={() => telechargerFicheTicket(ticket.id).catch((e) => setErreur(messageErreur(e)))}
                      title="Tout l’historique du ticket, sans les commentaires internes"
                      className="text-[11px] font-semibold normal-case tracking-normal text-[#B4761A] underline"
                    >
                      Fiche ticket PDF
                    </button>
                  </div>
                  {ticket.est_test ? (
                    <div className="border-b border-[#EFEDE8] bg-[#ECEEF1] px-4 py-1.5 text-[12px] font-bold tracking-[0.04em] text-[#3F4650]">🧪 TICKET TEST — exclu des statistiques, supprimable</div>
                  ) : null}
                  <div className="px-3 py-3">
                    <HistoriqueTicket ticket={ticket} etapes={etapes} hauteurMax={420} />
                  </div>
                </div>
              ) : null}
              <div className="mb-5">
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Pièces jointes</div>
                {ticket ? (
                  <PiecesJointes ticketId={ticket.id} onChange={() => void rafraichirEtapes(ticket.id)} lectureSeule={verrouille} />
                ) : (
                  <p className="text-[12px] text-slate-500">Ouvrir le ticket pour y joindre photos, mails et fichiers.</p>
                )}
              </div>
              {form.filiere === 'PV' ? (
                <div className="mb-5 rounded-xl border border-[#E2DFD8] bg-white p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">Niveau 2 · marque de l’onduleur</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MARQUES_SOLEIL.map((m) => {
                      const actif = form.pv_marque === m.value
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => void choisirSoleil(actif ? null : m.value, '')}
                          className="min-w-[120px] rounded-lg border-2 px-4 py-2 text-[14px] font-bold"
                          style={{ borderColor: m.couleur, background: actif ? m.couleur : '#fff', color: actif ? '#fff' : m.couleur }}
                        >
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                  {form.pv_marque ? (
                    <>
                      <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                        Niveau 3 · équipement {marqueSoleil(form.pv_marque)?.label}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {marqueSoleil(form.pv_marque)?.equipements.map((e) => {
                          const m = marqueSoleil(form.pv_marque)!
                          const actif = form.pv_equipement === e.value
                          return (
                            <button
                              key={e.value}
                              type="button"
                              onClick={() => void choisirSoleil(form.pv_marque, actif ? '' : e.value)}
                              className="min-w-[130px] rounded-lg border px-3 py-1.5 text-[13px] font-semibold"
                              style={{ borderColor: m.couleur, background: actif ? m.fond : '#fff', color: '#0F172A', boxShadow: actif ? `inset 0 0 0 1px ${m.couleur}` : undefined }}
                            >
                              {e.label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        La marque affiche les notices CEGECLIM ; l’équipement ajoute les fiches techniques et notices fabricant (colonne de droite).
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">Choisir la marque pour afficher les notices CEGECLIM correspondantes.</p>
                  )}
                </div>
              ) : null}
              {diagnosticActif ? (
                <div className="mb-5">
              {!form.filiere ? (
                <p className="text-[13px] text-slate-500">Choisir la filière pour afficher le parcours de diagnostic.</p>
              ) : form.filiere === 'THERMIQUE' && !form.gamme && !arbreId ? (
                <div>
                  <div className="text-[18px] font-bold text-slate-900">Quelle gamme ?</div>
                  <div className="mt-1 text-[13px] text-slate-500">Le choix de la gamme oriente vers les parcours de diagnostic correspondants.</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {GAMMES.map((g) => (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => patch({ gamme: g.value })}
                        className="rounded-lg bg-[#0B1220] px-4 py-2.5 text-left text-[14px] font-semibold text-white hover:bg-[#1C2A44]"
                      >
                        {g.label}
                        <span className="block text-[11px] font-normal text-slate-300">{g.titre}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : !arbresPossibles.length ? (
                <p className="text-[13px] text-slate-500">
                  Aucun parcours actif pour {libelleFiliere(form.filiere)}
                  {form.gamme ? ` ${libelleGamme(form.gamme)}` : ''}
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
                    <div className="flex flex-wrap gap-4">
                      <button type="button" onClick={revenir} className="text-[12px] font-semibold text-slate-500 hover:text-slate-800">
                        ← Revenir à la question précédente
                      </button>
                      <button type="button" onClick={recommencer} className="text-[12px] font-semibold text-slate-500 hover:text-slate-800">
                        ↺ Recommencer le diagnostic
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

                </div>
              ) : !form.filiere ? (
                <p className="mb-4 text-[13px] text-slate-500">Choisir la filière (Thermie ou Soleil) à gauche.</p>
              ) : null}
              {ticket && !verrouille ? (
                <div className="mt-2 space-y-3 border-t border-[#EFEDE8] pt-4">
                  {ticket.filiere === 'THERMIQUE' && parametres.classification_detaillee_active ? (
                    <ClassificationTicket
                      valeurs={classifForm}
                      onChange={setClassifForm}
                      classif={classif}
                      source={ticket.classif_source}
                      disabled={busy}
                      mode="detail"
                    />
                  ) : null}
                  <label className="block text-[11px] font-semibold text-slate-500">
                    Commentaire
                    <ZoneTexte
                      value={commentaire}
                      onChange={(e) => setCommentaire(e.target.value)}
                      placeholder="Commentaire, code défaut relevé, solution apportée… (repris dans la fiche ticket)"
                      className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] font-normal text-slate-900 outline-none focus:border-[#B4761A]"
                    />
                  </label>
                  {ticket.filiere === 'PV' ? (
                    <BlocReprise
                      ticket={ticket}
                      reprise={reprise}
                      onChange={setReprise}
                      collaborateurs={collaborateurs}
                      email={email || ''}
                      planifiee={reprisePlanifiee}
                    />
                  ) : (
                    <label className="block text-[11px] font-semibold text-[#8A5A11]">
                      Commentaire interne <span className="font-normal text-slate-400">— jamais repris dans la fiche ticket PDF</span>
                      <ZoneTexte
                        value={commentaireInterne}
                        onChange={(e) => setCommentaireInterne(e.target.value)}
                        placeholder="Information purement interne (client, contexte commercial, consigne…)"
                        className="w-full rounded-lg border border-[#EBD8AE] bg-[#FFFCF5] px-2.5 py-2 text-[13px] font-normal text-slate-900 outline-none focus:border-[#B4761A]"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => action('commentaire')}
                    disabled={busy || !etatModifie}
                    title="Enregistre le commentaire, le commentaire interne et l’issue dans l’historique du ticket"
                    className="h-10 w-full rounded-lg bg-[#0B1220] text-[14px] font-bold text-white hover:bg-[#1C2A44] disabled:bg-[#D8D3C8] disabled:text-slate-500"
                  >
                    💾 Sauvegarder état
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setFenetreNiveau('escalade')} disabled={busy || ticket.niveau >= 3} className="rounded-lg bg-[#C1683C] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                      Escalader au niveau {Math.min(3, ticket.niveau + 1)}
                    </button>
                    {ticket.niveau >= 2 ? (
                      <button type="button" onClick={() => setFenetreNiveau('redescente')} disabled={busy} className="rounded-lg bg-[#1E4E8C] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                        Redescendre au niveau {ticket.niveau - 1}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => action('resoudre')} disabled={busy || (issueRequise(ticket) && !classifForm.issue)} title={issueRequise(ticket) && !classifForm.issue ? 'Choisir d’abord l’issue ci-dessous' : 'Un ticket résolu est clos et verrouillé'} className="rounded-lg bg-[#2F6B3A] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                      Marquer résolu
                    </button>
                    <button type="button" onClick={() => void actionRapide('messagerie')} disabled={busy} title="Note dans l’historique (hotliner et heure) que l’appel est tombé sur la messagerie ; le ticket passe en attente client" className="rounded-lg border border-[#E8A35C] bg-[#FEF3E6] px-3 py-2 text-[13px] font-semibold text-[#9A4D06] disabled:opacity-40">
                      📞 Messagerie téléphonique
                    </button>
                    {ticket.statut !== 'ATTENTE_CLIENT' ? (
                      <button type="button" onClick={() => void actionRapide('attente')} disabled={busy} title="Le client doit revenir vers nous (relevé, photo, information…)" className="rounded-lg border border-[#E8A35C] px-3 py-2 text-[13px] font-semibold text-[#9A4D06] disabled:opacity-40">
                        ⏳ En attente client
                      </button>
                    ) : null}
                  </div>
                  {ticket.filiere === 'THERMIQUE' ? (
                    <ClassificationTicket
                      valeurs={classifForm}
                      onChange={setClassifForm}
                      classif={classif}
                      issueObligatoire={issueRequise(ticket)}
                      disabled={busy}
                      mode="issue"
                    />
                  ) : null}
                  <div className="text-right">
                    <Link href={`/hotline/tickets?id=${ticket.id}`} className="text-[12px] font-semibold text-slate-500 underline">
                      Ouvrir dans la liste des tickets
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* ── Contexte et documents ────────────────────────────────── */}
          <section className="space-y-4 xl:col-span-4">
            <PaveHistorique
              titre="HOTLINE Historique Contact"
              precision={form.contact_nom || (telCle(telephone) ? fmtTel(telephone) : '')}
              tickets={contexte.ticketsContact.filter((t) => t.id !== ticket?.id)}
              chargement={contexteLoading}
              vide={telCle(telephone) || form.contact_nom ? 'Aucun appel précédent de ce contact.' : 'Saisir le numéro ou le contact pour afficher ses appels.'}
              afficherClient
              onOuvrir={setTicketHisto}
            />
            <PaveHistorique
              titre="HOTLINE Historique Chantier / Machine"
              precision={[form.chantier, form.serie_ge, form.numero_serie].filter(Boolean).join(' · ')}
              tickets={contexte.ticketsChantier.filter((t) => t.id !== ticket?.id)}
              chargement={contexteLoading}
              vide={form.chantier || form.numero_serie || form.serie_ge ? 'Aucun appel précédent sur ce chantier ou cette machine.' : 'Saisir le chantier ou le n° de série pour afficher son historique.'}
              afficherClient
              afficherChantier
              onOuvrir={setTicketHisto}
              societe={{ numero_tiers: form.numero_tiers, intitule: form.intitule_tiers }}
            />
            <div className={carte}>
              <div className={titreCarte}>Documents à envoyer</div>
              <div className="p-4">
                {form.filiere === 'PV' && form.pv_marque ? (
                  <DocsSoleil
                    marque={form.pv_marque}
                    equipement={form.pv_equipement}
                    docs={docsSoleil.filter((d) => d.marque === form.pv_marque)}
                    envoiEnCours={envoiEnCours}
                    onEnvoyer={(d) => envoyerDocument({ titre: d.titre, type: 'PDF', url: d.url })}
                  />
                ) : null}
                {form.filiere === 'PV' && form.pv_marque && docsDiagnostic.length ? (
                  <div className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">Documents du diagnostic</div>
                ) : null}
                {docsDiagnostic.length ? (
                  <ListeRepliable
                    items={[...docsDiagnostic].reverse()}
                    cle={(d) => d.titre}
                    render={(d, i) =>
                    referenceVue(d) ? (
                      <div key={`${d.titre}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-[#EBD8AE] bg-[#FDF7EA] px-3 py-2 text-[13px]">
                        <span className="min-w-0 truncate">
                          <span className="mr-1.5 rounded bg-[#B4761A] px-1.5 py-0.5 text-[10px] font-bold text-white">VUE</span>
                          {d.titre}
                        </span>
                        <button type="button" onClick={() => ouvrirVue(referenceVue(d) || '')} className="shrink-0 text-[12px] font-bold text-[#B4761A] underline">
                          Ouvrir la vue interactive
                        </button>
                      </div>
                    ) : (
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
                          title={form.contact_email ? `Préparer un e-mail à ${form.contact_email} dans votre messagerie` : 'Préparer un e-mail dans votre messagerie'}
                          className="text-[12px] font-semibold text-[#B4761A] underline disabled:opacity-50"
                        >
                          {envoiEnCours === d.titre ? 'Préparation…' : 'Envoyer'}
                        </button>
                      </span>
                    </div>
                    )
                    }
                  />
                ) : form.filiere === 'PV' && form.pv_marque ? null : (
                  <p className="text-[12px] text-slate-500">
                    {form.filiere === 'PV'
                      ? 'Choisir la marque de l’onduleur (niveau 2) pour afficher les notices.'
                      : 'Les documents (procédures, schémas, firmwares) apparaissent au fil du diagnostic (les plus récents en premier).'}
                  </p>
                )}
              </div>
            </div>

            {form.numero_tiers.trim() ? (
              <PaveDossiers
                total={dossiers.total}
                dossiers={dossiers.liste}
                chargement={dossiersLoading}
                recherche={rechercheDossier}
                choisi={dossierChoisi}
                onChoisir={choisirDossier}
                refsVues={refsVues}
                onVue={ouvrirVue}
              />
            ) : (
            <PaveLivraisons
              livraisons={livraisons}
              chargement={livraisonsLoading}
              criteres={[form.chantier, form.reference_article, form.numero_serie].filter((v) => v.trim()).join(' · ')}
              articleSansClient={Boolean(form.reference_article.trim()) && !form.numero_tiers && !form.chantier.trim() && !form.numero_serie.trim()}
            />
            )}

          </section>
        </div>
      </main>

      {ticketHisto ? <FenetreTicket id={ticketHisto} onFermer={fermerTicketHisto} /> : null}

      {ticket && fenetreNiveau ? (
        <FenetreNiveau
          mode={fenetreNiveau}
          niveau={ticket.niveau}
          filiere={ticket.filiere}
          collaborateurs={collaborateurs}
          motifInitial={commentaire.trim() || (fenetreNiveau === 'escalade' ? fin?.preconisation || '' : '')}
          busy={busy}
          onValider={changerNiveau}
          onFermer={() => setFenetreNiveau(null)}
        />
      ) : null}

      {vueOuverte ? (
        <VueEclatee
          reference={vueOuverte}
          ticketId={ticket?.id || null}
          ticketNumero={ticket?.numero}
          client={{
            numeroTiers: form.numero_tiers,
            intitule: form.intitule_tiers,
            contact: form.contact_nom,
            email: form.contact_email,
            chantier: dossiers.liste.find((d) => d.cle === dossierChoisi)?.reference || form.chantier,
          }}
          onFermer={() => setVueOuverte(null)}
          onMail={(doc) => setDocAEnvoyer(doc)}
          onDemande={() => ticket && void rafraichirEtapes(ticket.id)}
        />
      ) : null}

      {hiParts ? (
        <VueHiParts
          modele={hiParts.modele}
          unite={hiParts.unite}
          onFermer={() => setHiParts(null)}
          onAjouter={ajouterPieceHiParts}
        />
      ) : null}

      {docAEnvoyer ? (
        <FenetreEnvoi
          doc={docAEnvoyer}
          destinataire={form.contact_email}
          objetParDefaut={`${ticket ? `[${ticket.numero}] ` : ''}${docAEnvoyer.titre}`}
          messageParDefaut={docAEnvoyer.message || messageEnvoiDocument(docAEnvoyer, form.contact_nom)}
          envoiEnCours={envoiEnCours !== null}
          windows={posteWindows()}
          onPreparer={preparerMessage}
          onFermer={() => setDocAEnvoyer(null)}
        />
      ) : null}
    </div>
  )
}

// ── Bouton Hi-Parts (12/11/2026) ─────────────────────────────────────────────
function BoutonHiParts({ modele, onClick }: { modele: string; onClick: () => void }) {
  const actif = modele.replace(/[^A-Za-z0-9]/g, '').length >= 3
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!actif}
      title={actif ? 'Vue éclatée et prix des pièces sur le catalogue Hitachi Hi-Parts' : 'Saisir le modèle pour ouvrir sa vue éclatée Hi-Parts'}
      className="rounded border border-[#C8102E] px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-[#C8102E] hover:bg-[#FDE7EA] disabled:border-[#D8D3C8] disabled:text-slate-400 disabled:hover:bg-transparent"
    >
      ⚙ Hi-Parts
    </button>
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
  onOuvrir,
  societe,
}: {
  titre: string
  precision?: string
  tickets: TicketHistorique[]
  chargement: boolean
  vide: string
  afficherClient?: boolean
  afficherChantier?: boolean
  onOuvrir: (id: string) => void
  /** (13/11/2026) Société de l'appel en cours : un ticket d'une autre société s'affiche en rouge. */
  societe?: { numero_tiers: string; intitule: string }
}) {
  const norm = (v: string | null | undefined) => String(v || '').trim().toUpperCase()
  const autreSociete = (t: TicketHistorique) => {
    if (!societe) return false
    if (norm(societe.numero_tiers) && norm(t.numero_tiers)) return norm(societe.numero_tiers) !== norm(t.numero_tiers)
    if (norm(societe.intitule) && norm(t.intitule_tiers)) return norm(societe.intitule) !== norm(t.intitule_tiers)
    return false
  }
  const nbAutres = tickets.filter(autreSociete).length
  return (
    <div className={carte}>
      <div className={`${titreCarte} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">
          {titre}
          {precision ? <span className="ml-2 text-[12px] font-normal text-slate-500">{precision}</span> : null}
        </span>
        <span className="shrink-0 text-[11px] font-normal text-slate-400">{chargement ? 'mise à jour…' : tickets.length ? `${tickets.length} appel${tickets.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      <div className="p-4">
        {nbAutres ? (
          <div className="mb-2 rounded-lg border border-[#F0C5BE] bg-[#FCEFEC] px-3 py-1.5 text-[12px] font-semibold text-[#C81E1E]">
            ⚠ {nbAutres} appel{nbAutres > 1 ? 's' : ''} sur cette machine par une autre société que l’appelant
          </div>
        ) : null}
        {tickets.length ? (
          <ListeRepliable
            items={trierTickets(tickets)}
            cle={(t) => t.id}
            render={(t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onOuvrir(t.id)}
              title="Voir le ticket"
              className="block w-full rounded-lg border border-[#E2DFD8] px-3 py-2 text-left text-[12px] hover:border-[#B4761A] hover:bg-[#FDF7EA]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={autreSociete(t) ? 'font-extrabold text-[#C81E1E]' : 'font-semibold text-slate-900'} title={autreSociete(t) ? 'Appel d’une autre société que l’appelant actuel' : undefined}>
                  {t.numero} · {fmtDateHeure(t.opened_at)}
                </span>
                <Pastille {...styleStatut(t.statut)} />
              </div>
              <div className="truncate text-slate-600">
                {t.nature ? `${libelleNature(t.nature)} · ` : ''}
                {libelleFiliere(t.filiere)} · {libelleMotif(t.motif)} · N{t.niveau}
                {t.source === 'IMPORT' ? <span className="ml-1 text-[10px] font-bold text-slate-400">HISTORIQUE</span> : null}
              </div>
              {afficherClient && (t.intitule_tiers || t.contact_nom) ? (
                <div className="truncate text-slate-600">{[t.intitule_tiers || t.numero_tiers, t.contact_nom].filter(Boolean).join(' · ')}</div>
              ) : null}
              {afficherChantier && (t.chantier || t.numero_serie || t.serie_ge) ? (
                <div className="truncate text-slate-600">
                  {[t.chantier, t.serie_ge ? `GE ${t.serie_ge}` : '', t.numero_serie ? `UI ${t.numero_serie}` : ''].filter(Boolean).join(' · ')}
                </div>
              ) : null}
              {t.description ? <div className="truncate text-slate-500">{t.description}</div> : null}
              {t.preconisation ? <div className="truncate text-[#2F6B3A]">→ {t.preconisation}</div> : null}
            </button>
            )}
          />
        ) : (
          <p className="text-[12px] text-slate-500">{vide}</p>
        )}
      </div>
    </div>
  )
}

// ── Listes de la colonne droite (12/11/2026) : les 2 premières lignes, puis
// « Développer » pour afficher la suite.
const LIGNES_VISIBLES = 2

function ListeRepliable<T>({ items, cle, render }: { items: T[]; cle: (item: T, i: number) => string; render: (item: T, i: number) => ReactNode }) {
  const [developpe, setDeveloppe] = useState(false)
  const visibles = developpe ? items : items.slice(0, LIGNES_VISIBLES)
  const reste = items.length - LIGNES_VISIBLES
  return (
    <div className="space-y-1.5">
      {visibles.map((item, i) => (
        <div key={`${cle(item, i)}-${i}`}>{render(item, i)}</div>
      ))}
      {reste > 0 ? (
        <button
          type="button"
          onClick={() => setDeveloppe((v) => !v)}
          className="w-full rounded-lg border border-dashed border-[#D8D3C8] py-1.5 text-[12px] font-semibold text-slate-600 hover:border-[#B4761A] hover:text-[#8A5A11]"
        >
          {developpe ? 'Réduire' : `Développer (${reste} de plus)`}
        </button>
      ) : null}
    </div>
  )
}

// ── Fenêtre flottante d'un ticket de l'historique (04/11/2026) ─────────────────
function FenetreTicket({ id, onFermer }: { id: string; onFermer: () => void }) {
  const [t, setT] = useState<Ticket | null>(null)
  const [etapes, setEtapesFenetre] = useState<Etape[]>([])
  const [erreurFenetre, setErreurFenetre] = useState<string | null>(null)

  useEffect(() => {
    let actif = true
    void (async () => {
      try {
        const { data, error } = await supabase.from('hotline_tickets').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (!actif) return
        setT((data as Ticket) || null)
        const liste = await chargerEtapes(id)
        if (actif) setEtapesFenetre(liste)
      } catch (e) {
        if (actif) setErreurFenetre(messageErreur(e))
      }
    })()
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && onFermer()
    window.addEventListener('keydown', touche)
    return () => {
      actif = false
      window.removeEventListener('keydown', touche)
    }
  }, [id, onFermer])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(6,10,18,0.45)] p-4" onClick={onFermer}>
      <div className="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[#EFEDE8] px-5 py-3">
          {t ? (
            <div>
              <div className="flex items-center gap-2 text-[17px] font-bold text-slate-900">
                {t.numero} <Pastille {...styleStatut(t.statut)} /> <span className="text-[13px] text-slate-500">N{t.niveau}</span>
              </div>
              <div className="text-[12px] text-slate-500">
                {libelleFiliere(t.filiere)}
                {t.gamme ? ` ${libelleGamme(t.gamme)}` : ''} · {libelleMotif(t.motif)} · ouvert le {fmtDateHeure(t.opened_at)} par {t.ouvert_par.split('@')[0]}
              </div>
            </div>
          ) : (
            <div className="text-[14px] text-slate-500">{erreurFenetre || 'Chargement du ticket…'}</div>
          )}
          <button type="button" onClick={onFermer} className="shrink-0 text-[13px] font-semibold text-slate-500 hover:text-slate-900">
            Fermer ✕
          </button>
        </div>
        {t ? (
          <div className="space-y-4 overflow-y-auto p-5 text-[13px]">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] md:grid-cols-3">
              {[
                ['Client', [t.intitule_tiers, t.numero_tiers].filter(Boolean).join(' · ')],
                ['Contact', t.contact_nom],
                ['Téléphone', fmtTel(t.telephone_appelant)],
                ['Chantier', t.chantier],
                ['Nature', libelleNature(t.nature)],
                ['Code défaut', t.code_defaut],
                ['Mise en service', t.date_mes ? fmtDate(t.date_mes) : ''],
                ['GE', [t.modele_ge, t.serie_ge && `n° ${t.serie_ge}`].filter(Boolean).join(' · ')],
                ['UI', [t.reference_article, t.numero_serie && `n° ${t.numero_serie}`].filter(Boolean).join(' · ')],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-semibold uppercase tracking-[0.04em] text-slate-400">{k}</dt>
                  <dd className="text-slate-800">{v || '—'}</dd>
                </div>
              ))}
            </dl>
            {t.preconisation ? (
              <div className="rounded-lg border border-[#CDE5D1] bg-[#EEF7EF] p-3 text-slate-800">
                <span className="font-semibold">Préconisation :</span> {t.preconisation}
              </div>
            ) : null}
            <div>
              <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-500">Historique du ticket</div>
              <HistoriqueTicket ticket={t} etapes={etapes} hauteurMax={0} />
            </div>
          </div>
        ) : null}
        {t ? (
          <div className="flex flex-wrap justify-end gap-3 border-t border-[#EFEDE8] px-5 py-3">
            <Link href={`/hotline/tickets?id=${t.id}`} target="_blank" className="text-[13px] font-semibold text-slate-500 underline">
              Fiche complète (nouvel onglet)
            </Link>
            <Link href={`/hotline?ticket=${t.id}`} target="_blank" className="rounded-lg bg-[#B4761A] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#9A6414]">
              Reprendre ce ticket (nouvel onglet)
            </Link>
          </div>
        ) : null}
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

// ── Fenêtre d'envoi d'un document (messagerie du poste) ─────────────────────
function FenetreEnvoi({
  doc,
  destinataire,
  objetParDefaut,
  messageParDefaut,
  envoiEnCours,
  windows,
  onPreparer,
  onFermer,
}: {
  doc: DocumentLien
  destinataire: string
  objetParDefaut: string
  messageParDefaut: string
  envoiEnCours: boolean
  windows: boolean
  onPreparer: (v: { to: string; subject: string; text: string; mode: 'auto' | 'eml' }) => void
  onFermer: () => void
}) {
  const [to, setTo] = useState(destinataire)
  const [subject, setSubject] = useState(objetParDefaut)
  const [text, setText] = useState(messageParDefaut)
  const adresseOk = !to.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,10,18,0.55)] p-4" onClick={onFermer}>
      <div className="w-full max-w-[620px] rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#EFEDE8] px-5 py-3">
          <div className="text-[15px] font-bold text-slate-900">Envoyer un document par e-mail</div>
          <button type="button" onClick={onFermer} className="text-[13px] font-semibold text-slate-500 hover:text-slate-900">
            Fermer ✕
          </button>
        </div>
        <div className="space-y-3 p-5">
          <label className="block text-[11px] font-semibold text-slate-500">
            À
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="adresse@client.fr" className={champ} autoFocus={!destinataire} />
          </label>
          <label className="block text-[11px] font-semibold text-slate-500">
            Objet
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={champ} />
          </label>
          <label className="block text-[11px] font-semibold text-slate-500">
            Message
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-[#B4761A]"
            />
          </label>
          <div className="flex items-center gap-2 rounded-lg bg-[#FAF9F7] px-3 py-2 text-[12px] text-slate-700">
            <span className="rounded bg-[#EEEDEA] px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{doc.type || 'DOC'}</span>
            <span className="min-w-0 truncate">📎 {doc.titre}</span>
            {!doc.url ? <span className="ml-auto shrink-0 text-[#A32C2C]">aucun lien : rien à joindre</span> : null}
          </div>
          <p className="text-[12px] leading-snug text-slate-500">
            {windows
              ? 'Le message s’ouvre dans Outlook comme un nouveau message, document déjà joint. Vous relisez et cliquez sur Envoyer dans Outlook.'
              : 'Votre messagerie s’ouvre avec le message prêt, et le document est téléchargé en même temps : glissez-le dans le message, puis cliquez sur Envoyer dans votre messagerie.'}{' '}
            Le compagnon n’envoie rien lui-même.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFEDE8] px-5 py-3">
          {!windows ? (
            <button
              type="button"
              onClick={() => onPreparer({ to: to.trim(), subject: subject.trim(), text, mode: 'eml' })}
              disabled={envoiEnCours}
              className="text-[12px] font-semibold text-slate-500 underline disabled:opacity-40"
              title="Fichier .eml avec le document joint (s'ouvre en nouveau message dans Outlook pour Windows ; en lecture seule sur Mac)"
            >
              Télécharger en .eml
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onFermer} className="rounded-lg border border-[#D8D3C8] px-4 py-2 text-[13px] font-semibold text-slate-700">
              Annuler
            </button>
            <button
              type="button"
              onClick={() => onPreparer({ to: to.trim(), subject: subject.trim(), text, mode: 'auto' })}
              disabled={envoiEnCours || !adresseOk || !subject.trim()}
              className="rounded-lg bg-[#B4761A] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#9A6414] disabled:opacity-40"
            >
              {envoiEnCours ? 'Préparation…' : 'Ouvrir dans ma messagerie'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Commande initiale & livraison ────────────────────────────────────────────
function PaveLivraisons({
  livraisons,
  chargement,
  criteres,
  articleSansClient,
}: {
  livraisons: Livraison[]
  chargement: boolean
  criteres: string
  articleSansClient: boolean
}) {
  return (
    <div className={carte}>
      <div className={`${titreCarte} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">
          Commande initiale &amp; livraison
          {criteres ? <span className="ml-2 text-[12px] font-normal text-slate-500">{criteres}</span> : null}
        </span>
        <span className="shrink-0 text-[11px] font-normal text-slate-400">
          {chargement ? 'recherche…' : livraisons.length ? `${livraisons.length} expédition${livraisons.length > 1 ? 's' : ''}` : ''}
        </span>
      </div>
      <div className="p-4">
        {livraisons.length ? (
          <ListeRepliable
            items={livraisons}
            cle={(l) => l.numero_bl}
            render={(l) => (
            <div className="rounded-lg border border-[#E2DFD8] text-[12px]">
              <div className="space-y-0.5 border-b border-[#EFEDE8] bg-[#FAF9F7] px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold text-slate-900">
                    Commande {l.numero_cdc || '—'}
                    {l.date_cdc ? <span className="font-normal text-slate-500"> du {fmtDate(l.date_cdc)}</span> : null}
                  </span>
                  <span className="font-semibold text-[#2F6B3A]">
                    Expédiée le {fmtDate(l.date_bl)}
                    <span className="font-normal text-slate-500"> · {l.numero_bl}</span>
                  </span>
                </div>
                <div className="truncate text-slate-600">
                  {[l.intitule || l.numero_tiers, l.chantier, l.projet, l.depot ? `dépôt ${l.depot}` : '', l.factures?.length ? `facture ${l.factures.join(', ')}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <ul className="divide-y divide-[#F1EFEA]">
                {l.lignes.map((p, i) => (
                  <li key={`${p.reference_article}-${i}`} className={`flex items-baseline gap-2 px-3 py-1.5 ${p.correspond ? 'bg-[#FDF7EA]' : ''}`}>
                    <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-slate-900">{p.quantite ?? ''}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-800">{p.reference_article || '—'}</span>{' '}
                      <span className="text-slate-600">{p.designation}</span>
                      {p.series?.length ? <span className="block text-[11px] text-slate-500">N° série : {p.series.join(', ')}</span> : null}
                    </span>
                    {p.correspond ? <span className="shrink-0 text-[10px] font-bold uppercase text-[#B4761A]">recherché</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            )}
          />
        ) : (
          <p className="text-[12px] text-slate-500">
            {chargement
              ? 'Recherche des livraisons…'
              : articleSansClient
                ? 'Identifier le client (ou saisir le chantier) pour retrouver la livraison de cette référence.'
                : criteres
                  ? 'Aucune livraison facturée trouvée sur 5 ans pour ces critères.'
                  : 'Saisir un chantier, une référence produit ou un n° de série pour retrouver la commande initiale, la date d’expédition et les produits livrés ensemble.'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Dossiers de vente (devis → commande → BL → facture) ─────────────────────
const ETAPE_STYLE: Record<Dossier['etape'], { tone: string; bg: string }> = {
  Devis: { tone: '#4B5563', bg: '#EEEDEA' },
  Commandé: { tone: '#8A5A11', bg: '#FDF2DD' },
  Livré: { tone: '#1E4E8C', bg: '#E6EEF9' },
  Facturé: { tone: '#2F6B3A', bg: '#E5F2E7' },
}

function PaveDossiers({
  total,
  dossiers,
  chargement,
  recherche,
  choisi,
  onChoisir,
  refsVues,
  onVue,
}: {
  total: number
  dossiers: Dossier[]
  chargement: boolean
  recherche: string
  choisi: string | null
  onChoisir: (d: Dossier | null) => void
  refsVues: Set<string>
  onVue: (reference: string) => void
}) {
  const dossier = choisi ? dossiers.find((d) => d.cle === choisi) || null : null
  return (
    <div className={carte}>
      <div className={`${titreCarte} flex items-center justify-between gap-2`}>
        <span className="min-w-0 truncate">
          Dossiers de vente
          {recherche ? <span className="ml-2 text-[12px] font-normal text-slate-500">« {recherche} »</span> : null}
        </span>
        <span className="shrink-0 text-[11px] font-normal text-slate-400">
          {chargement ? 'recherche…' : total ? `${total} dossier${total > 1 ? 's' : ''}${total > dossiers.length ? ` (${dossiers.length} affichés)` : ''}` : ''}
        </span>
      </div>
      <div className="p-4">
        {dossier ? (
          <DetailDossier d={dossier} retour={dossiers.length > 1 ? () => onChoisir(null) : null} nbDossiers={dossiers.length} refsVues={refsVues} onVue={onVue} />
        ) : dossiers.length ? (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-500">
              {recherche ? 'Choisir le dossier :' : 'Dossiers récents — saisir le chantier, un n° de pièce ou un produit pour filtrer :'}
            </div>
            <ListeRepliable
              items={dossiers}
              cle={(d) => d.cle}
              render={(d) => (
              <button
                type="button"
                onClick={() => onChoisir(d)}
                className="block w-full rounded-lg border border-[#E2DFD8] px-3 py-2 text-left text-[12px] hover:border-[#B4761A] hover:bg-[#FDF7EA]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-slate-900">{d.reference || 'Sans référence chantier'}</span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: ETAPE_STYLE[d.etape].tone, background: ETAPE_STYLE[d.etape].bg }}>
                    {d.etape}
                  </span>
                </div>
                <div className="truncate text-slate-600">
                  {[d.devis[0]?.piece, d.cdc?.piece, ...d.bls.map((b) => b.piece), ...d.factures.map((f) => f.piece)].filter(Boolean).join(' · ')}
                </div>
                <div className="text-[11px] text-slate-400">
                  {fmtDate(d.date_debut)}
                  {d.date_fin && d.date_fin !== d.date_debut ? ` → ${fmtDate(d.date_fin)}` : ''}
                </div>
              </button>
              )}
            />
          </div>
        ) : (
          <p className="text-[12px] text-slate-500">
            {chargement ? 'Recherche des dossiers…' : recherche ? `Aucun dossier de ce client ne correspond à « ${recherche} » (3 dernières années).` : 'Aucun dossier de vente sur les 3 dernières années.'}
          </p>
        )}
      </div>
    </div>
  )
}

type VuesProps = { refsVues: Set<string>; onVue: (reference: string) => void }

function ListeProduits({ lignes, statut, refsVues, onVue }: { lignes: ProduitDossierUI[]; statut?: boolean } & VuesProps) {
  return (
    <ul className="divide-y divide-[#F1EFEA]">
      {lignes.map((p, i) => (
        <li key={`${p.reference_article}-${i}`} className={`flex items-baseline gap-2 px-3 py-1.5 ${p.correspond ? 'bg-[#FDF7EA]' : ''}`}>
          <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-slate-900">{p.quantite ?? ''}</span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-slate-800">{p.reference_article || '—'}</span> <span className="text-slate-600">{p.designation}</span>
          </span>
          {statut && p.statut ? <span className="shrink-0 text-[10px] font-semibold text-[#8A5A11]">{p.statut}</span> : null}
          {p.correspond ? <span className="shrink-0 text-[10px] font-bold uppercase text-[#B4761A]">recherché</span> : null}
          {p.reference_article && refsVues.has(p.reference_article.toUpperCase()) ? (
            <button
              type="button"
              onClick={() => onVue(p.reference_article || '')}
              title="Ouvrir la vue éclatée interactive de ce produit"
              className="shrink-0 rounded-md border border-[#B4761A] px-1.5 py-0.5 text-[10px] font-bold text-[#B4761A] hover:bg-[#B4761A] hover:text-white"
            >
              🔍 Vue éclatée
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

type ProduitDossierUI = Dossier['reste_a_livrer'][number]

function DetailDossier({ d, retour, nbDossiers, refsVues, onVue }: { d: Dossier; retour: (() => void) | null; nbDossiers: number } & VuesProps) {
  return (
    <div className="space-y-3 text-[12px]">
      {retour ? (
        <button type="button" onClick={retour} className="text-[12px] font-semibold text-slate-500 hover:text-slate-900">
          ← Tous les dossiers ({nbDossiers})
        </button>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold text-slate-900">{d.reference || 'Sans référence chantier'}</div>
          <div className="text-slate-500">
            {fmtDate(d.date_debut)}
            {d.date_fin && d.date_fin !== d.date_debut ? ` → ${fmtDate(d.date_fin)}` : ''}
          </div>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: ETAPE_STYLE[d.etape].tone, background: ETAPE_STYLE[d.etape].bg }}>
          {d.etape}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[#FAF9F7] px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400">Devis</div>
          {d.devis.length ? (
            d.devis.map((x) => (
              <div key={x.piece} className="text-slate-800">
                <span className="font-semibold">{x.piece}</span> · {fmtDate(x.date)} · {fmtEuro(x.ht)}
              </div>
            ))
          ) : (
            <div className="text-slate-400">—</div>
          )}
        </div>
        <div className="rounded-lg bg-[#FAF9F7] px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400">Commande initiale</div>
          {d.cdc?.piece ? (
            <div className="text-slate-800">
              <span className="font-semibold">{d.cdc.piece}</span> · {fmtDate(d.cdc.date)}
              {d.cdc.en_cours ? <span className="ml-1 text-[10px] font-bold text-[#8A5A11]">EN COURS</span> : null}
            </div>
          ) : (
            <div className="text-slate-400">—</div>
          )}
        </div>
      </div>

      {d.bls.map((b) => (
        <div key={b.piece} className="rounded-lg border border-[#E2DFD8]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-[#EFEDE8] bg-[#FAF9F7] px-3 py-2">
            <span className="font-semibold text-[#2F6B3A]">
              Expédié le {fmtDate(b.date)} <span className="font-normal text-slate-500">· {b.piece}</span>
            </span>
            <span className="text-slate-500">{b.factures?.length ? `facture ${b.factures.join(', ')}` : b.facture ? 'facturé' : 'non facturé'}</span>
          </div>
          {b.lignes?.length ? <ListeProduits lignes={b.lignes} refsVues={refsVues} onVue={onVue} /> : <div className="px-3 py-2 text-slate-400">Aucune ligne produit.</div>}
        </div>
      ))}

      {d.reste_a_livrer.length ? (
        <div className="rounded-lg border border-[#EBD8AE]">
          <div className="border-b border-[#EFEDE8] bg-[#FDF7EA] px-3 py-2 font-semibold text-[#8A5A11]">Reste à livrer sur la commande</div>
          <ListeProduits lignes={d.reste_a_livrer} statut refsVues={refsVues} onVue={onVue} />
        </div>
      ) : null}

      {d.devis_lignes.length ? (
        <div className="rounded-lg border border-[#E2DFD8]">
          <div className="border-b border-[#EFEDE8] bg-[#FAF9F7] px-3 py-2 font-semibold text-slate-700">Contenu du devis (pas encore commandé)</div>
          <ListeProduits lignes={d.devis_lignes} refsVues={refsVues} onVue={onVue} />
        </div>
      ) : null}

      {d.factures.length ? (
        <div className="text-slate-600">
          <span className="font-semibold text-slate-700">Factures : </span>
          {d.factures.map((f) => `${f.piece} du ${fmtDate(f.date)} (${fmtEuro(f.ht)})`).join(' · ')}
        </div>
      ) : null}
    </div>
  )
}

// ── Soleil : reprise du traitement (13/11/2026) ─────────────────────────────────
function BlocReprise({
  ticket,
  reprise,
  onChange,
  collaborateurs,
  email,
  planifiee,
}: {
  ticket: Ticket
  reprise: Reprise
  onChange: (r: Reprise) => void
  collaborateurs: Collaborateurs
  email: string
  planifiee: boolean
}) {
  if (estResolu(ticket)) return null
  const liste = collaborateurs.liste.filter((c) => !c.filiere || c.filiere === 'PV')
  const pour = reprise.pour || email
  const requis = !planifiee
  const set = (p: Partial<Reprise>) => onChange({ ...reprise, ...p })
  return (
    <div className={`rounded-lg border p-3 ${requis ? 'border-[#C1683C] bg-[#FDF5F0]' : 'border-[#E2DFD8] bg-[#FAF9F7]'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-slate-600">
          Reprise du traitement du ticket {requis ? <span className="text-[#C1683C]">* obligatoire</span> : null}
        </div>
        {ticket.reprise_le ? (
          <div className="text-[11px] text-slate-500">
            Prévue le <span className="font-semibold text-slate-800">{fmtDate(ticket.reprise_le)}</span> :{' '}
            {ticket.reprise_action === 'AUTRE' ? ticket.reprise_precision : ACTIONS_REPRISE.find((a) => a.value === ticket.reprise_action)?.label}
            {ticket.reprise_par ? ` → ${nomCollaborateur(ticket.reprise_par, collaborateurs)}` : ''}
          </div>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[150px_1fr_1fr]">
        <label className="text-[11px] font-semibold text-slate-500">
          Reprise le
          <input
            type="date"
            value={reprise.date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => set({ date: e.target.value })}
            className="h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2 text-[13px] text-slate-900"
          />
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Action
          <select
            value={reprise.action}
            onChange={(e) => set({ action: e.target.value as ActionReprise | '' })}
            className="h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2 text-[13px] text-slate-900"
          >
            <option value="">— Choisir —</option>
            {ACTIONS_REPRISE.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-slate-500">
          Tâche pour
          <select value={pour} onChange={(e) => set({ pour: e.target.value })} className="h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2 text-[13px] text-slate-900">
            {!liste.some((c) => c.email === email) && email ? <option value={email}>Moi ({nomCollaborateur(email, collaborateurs)})</option> : null}
            {liste.map((c) => (
              <option key={c.email} value={c.email}>
                {c.email === email ? `Moi (${c.nom})` : `${c.nom} · N${c.niveau}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        value={reprise.precision}
        onChange={(e) => set({ precision: e.target.value })}
        placeholder={reprise.action === 'AUTRE' ? 'Préciser l’action à mener (obligatoire)' : 'Précision (facultatif)'}
        className={`mt-2 h-9 w-full rounded-lg border bg-white px-2.5 text-[13px] text-slate-900 ${reprise.action === 'AUTRE' && !reprise.precision.trim() ? 'border-[#C1683C]' : 'border-[#D8D3C8]'}`}
      />
      <p className="mt-1 text-[11px] text-slate-500">Une tâche est créée dans la Todo List du collaborateur choisi, à la date de reprise.</p>
    </div>
  )
}

// ── Soleil : notices CEGECLIM (NIV 2) en tête, documentation fabricant (NIV 3) séparée ──
function DocsSoleil({
  marque,
  equipement,
  docs,
  envoiEnCours,
  onEnvoyer,
}: {
  marque: MarqueSoleil
  equipement: string
  docs: DocSoleil[]
  envoiEnCours: string | null
  onEnvoyer: (d: DocSoleil) => void
}) {
  const m = marqueSoleil(marque)
  const notices = docs.filter((d) => !d.equipement && d.categorie === 'NOTICE_CEGECLIM')
  const fabricant = equipement ? docs.filter((d) => d.equipement === equipement) : []
  const ligne = (d: DocSoleil, accent: string) => (
    <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: accent }}>
      <span className="min-w-0 truncate">
        <span className="mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: accent }}>
          {d.categorie === 'FICHE_TECHNIQUE' ? 'FT' : d.categorie === 'NOTICE_FABRICANT' ? 'FAB.' : 'NOTICE'}
        </span>
        {d.titre}
      </span>
      <span className="flex shrink-0 gap-2">
        <a href={d.url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-slate-500 underline">
          Ouvrir
        </a>
        <button type="button" onClick={() => onEnvoyer(d)} disabled={envoiEnCours !== null} className="text-[12px] font-semibold text-[#B4761A] underline disabled:opacity-50">
          {envoiEnCours === d.titre ? 'Préparation…' : 'Envoyer'}
        </button>
      </span>
    </div>
  )
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.06em]" style={{ color: m?.couleur }}>
          Notices CEGECLIM · {m?.label}
        </div>
        <div className="space-y-1.5">
          {notices.length ? notices.map((d) => ligne(d, m?.couleur || '#334155')) : (
            <p className="text-[12px] text-slate-500">Aucune notice CEGECLIM enregistrée pour {m?.label}{m?.notices ? ` (${m.notices})` : ''}.</p>
          )}
        </div>
      </div>
      {equipement ? (
        <div className="rounded-lg border-2 border-dashed border-[#D8D3C8] bg-[#FAF9F7] p-2.5">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
            Documentation fabricant · {libelleEquipementSoleil(marque, equipement)}
          </div>
          <div className="space-y-1.5">
            {fabricant.length ? (
              CATEGORIES_DOC_SOLEIL.filter((c) => c.value !== 'NOTICE_CEGECLIM').flatMap((c) => fabricant.filter((d) => d.categorie === c.value)).concat(fabricant.filter((d) => d.categorie === 'NOTICE_CEGECLIM')).map((d) => ligne(d, '#64748B'))
            ) : (
              <p className="text-[12px] text-slate-500">Aucune fiche technique ni notice fabricant enregistrée pour cet équipement.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">Choisir l’équipement (niveau 3) pour ajouter les fiches techniques et notices fabricant.</p>
      )}
    </div>
  )
}
