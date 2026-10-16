'use client'

// Fiche d'un dossier d'aides CEE (16/10/2026) — parcours CEGECLIM en parallèle de DRAPO.
//
// * Synoptique : les 16 statuts CEGECLIM répartis dans les 6 étapes DRAPO,
//   statut courant surligné, statuts déjà franchis datés (date d'effet), boucles
//   de retours DRAPO, exception SAV, sorties Devis KO / Prime rejetée, jalons
//   SAGE (BL autorisé après le statut 6, prime premium après le statut 14).
// * Activation manuelle d'un statut : date d'effet + commentaire (RPC
//   cee_activer_statut). Les passages 2 → 3 et 7 → 8 vérifient les derniers
//   contrôles de pièces, les écarts entre sources et les règles de dates ; on
//   peut forcer avec un commentaire.
// * Caractéristiques du dossier (fiche Notion) par groupe, avec leur origine et
//   la valeur relevée sur chaque pièce : toute saisie passe par
//   cee_maj_champs(source « saisie ») et déclenche le contrôle de cohérence.
// * Contrôles de pièces : chaque passage numéroté, avec le contrôle remplacé.
// * Suivi admin CEGECLIM : synchronisation SAGE (cee_sync_sage).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import {
  afficherValeur,
  aujourdhuiIso,
  chargerReferentiels,
  formatDateFr,
  formatDateHeure,
  GROUPES_ORDRE,
  libelleStatut,
  NATURE_STYLE,
  ORIGINE_LABEL,
  ORIGINE_STYLE,
  SOURCE_LABEL,
  TYPES_PIECE_CONTROLE,
  valeurEnTexte,
  valeursEgales,
  VERDICT_STYLE,
  type ChampCee,
  type Coherence,
  type EtapeDrapo,
  type StatutCee,
  type ValeurSource,
} from '@/lib/financementCee'

type Dossier = Record<string, unknown> & {
  id: string
  reference: string
  pro_raison_sociale: string
  chantier_nom: string
  beneficiaire_nom: string | null
  statut: string
  statut_cee: string | null
  statut_cee_depuis: string | null
  etat: string
  points_bloquants: string[]
  commentaire: string | null
  cloture: boolean
  offre_aides: string | null
  mention_cee_sage: boolean | null
  sage_synchro_le: string | null
  cree_le: string
  cree_par: string | null
  modifie_le: string
  modifie_par: string | null
}

type PieceType = { code: string; libelle: string; etape_code: string; source: string; obligatoire: boolean; ordre: number }
type PieceEtat = { dossier_id: string; type_piece: string; statut: string; recue_le: string | null; validee_le: string | null; commentaire: string | null }

type Historique = {
  id: number
  statut_avant: string | null
  statut_apres: string
  statut_cee_avant: string | null
  statut_cee_apres: string | null
  etat_avant: string | null
  etat_apres: string
  points_bloquants: string[]
  change_le: string
  change_par: string | null
  commentaire: string | null
  date_effet: string | null
}

type Controle = {
  id: string
  type_piece: string
  passage: number | null
  controle_precedent_id: string | null
  statut_cee: string | null
  verdict: string
  nb_conformes: number
  nb_non_conformes: number
  nb_na: number
  nb_sans_statut: number
  fichiers: string[]
  resultats: Array<{ label: string; statut: string | null; commentaire: string }>
  valeurs: Record<string, string>
  controle_le: string
  controle_par: string | null
}

const ETAT_OPTIONS = [
  { value: 'pret', label: 'Prêt' },
  { value: 'a_corriger', label: 'À corriger' },
  { value: 'bloque', label: 'Bloqué' },
]

const PIECE_STATUT_OPTIONS = [
  { value: 'manquante', label: 'Manquante' },
  { value: 'recue', label: 'Reçue' },
  { value: 'validee', label: 'Validée' },
  { value: 'refusee', label: 'Refusée' },
]

const PIECE_STATUT_STYLE: Record<string, { bg: string; fg: string }> = {
  manquante: { bg: '#F0EEE8', fg: '#6B6459' },
  recue: { bg: '#FDF1DE', fg: '#93600F' },
  validee: { bg: '#EAF3E8', fg: '#2E6B3E' },
  refusee: { bg: '#FBE9E9', fg: '#A32C2C' },
}

export default function FinancementDossierPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { rights, email, loading: accessLoading } = useAccess()
  const dossierId = String(params?.id || '')

  const [accesAccorde, setAccesAccorde] = useState(false)
  useEffect(() => {
    if (accessLoading) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verrou d'accès, posé une seule fois
    if (rights.can_financement) setAccesAccorde(true)
    else router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [etapes, setEtapes] = useState<EtapeDrapo[]>([])
  const [statuts, setStatuts] = useState<StatutCee[]>([])
  const [champs, setChamps] = useState<ChampCee[]>([])
  const [valeurs, setValeurs] = useState<ValeurSource[]>([])
  const [coherence, setCoherence] = useState<Coherence | null>(null)
  const [pieceTypes, setPieceTypes] = useState<PieceType[]>([])
  const [pieces, setPieces] = useState<PieceEtat[]>([])
  const [historique, setHistorique] = useState<Historique[]>([])
  const [controles, setControles] = useState<Controle[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  // Suivi (état / points bloquants / commentaire / clôture)
  const [draftEtat, setDraftEtat] = useState('')
  const [draftCommentaire, setDraftCommentaire] = useState('')
  const [draftPoints, setDraftPoints] = useState('')
  const [draftCloture, setDraftCloture] = useState(false)
  const [savingSuivi, setSavingSuivi] = useState(false)

  // Activation de statut
  const [activation, setActivation] = useState<{ statut: string; date: string; commentaire: string; forcer: boolean; bloquants: string[]; busy: boolean; erreur: string } | null>(null)

  // Édition des caractéristiques (par groupe)
  const [groupeEdite, setGroupeEdite] = useState<string | null>(null)
  const [brouillon, setBrouillon] = useState<Record<string, string>>({})
  const [savingChamps, setSavingChamps] = useState(false)

  // Acceptation d'un écart
  const [ecartOuvert, setEcartOuvert] = useState<{ champ: string; libelle: string; commentaire: string; busy: boolean; erreur: string } | null>(null)

  const [syncBusy, setSyncBusy] = useState(false)
  const [statutDetail, setStatutDetail] = useState<string | null>(null)

  const charger = useCallback(async () => {
    if (!dossierId) return
    setErrorMsg('')
    const [ref, { data: d, error: dErr }, { data: v }, { data: pt }, { data: p }, { data: h }, { data: c }, coh] = await Promise.all([
      chargerReferentiels(),
      supabase.from('cee_dossiers').select('*').eq('id', dossierId).maybeSingle(),
      supabase.from('cee_dossier_valeurs').select('*').eq('dossier_id', dossierId),
      supabase.from('cee_pieces_types').select('*').order('ordre', { ascending: true }),
      supabase.from('cee_dossier_pieces').select('*').eq('dossier_id', dossierId),
      supabase.from('cee_dossier_statuts_historique').select('*').eq('dossier_id', dossierId).order('change_le', { ascending: false }),
      supabase
        .from('cee_controles')
        .select('id, type_piece, passage, controle_precedent_id, statut_cee, verdict, nb_conformes, nb_non_conformes, nb_na, nb_sans_statut, fichiers, resultats, valeurs, controle_le, controle_par')
        .eq('dossier_id', dossierId)
        .order('controle_le', { ascending: false }),
      supabase.rpc('cee_get_coherence', { p_dossier: dossierId }),
    ])
    if (dErr || !d) {
      setErrorMsg(dErr?.message || 'Dossier introuvable.')
      setLoading(false)
      return
    }
    const dos = d as Dossier
    setDossier(dos)
    setEtapes(ref.etapes)
    setStatuts(ref.statuts)
    setChamps(ref.champs)
    setValeurs((v || []) as ValeurSource[])
    setPieceTypes((pt || []) as PieceType[])
    setPieces((p || []) as PieceEtat[])
    setHistorique((h || []) as Historique[])
    setControles((c || []) as Controle[])
    setCoherence(coh.error ? null : (coh.data as Coherence))
    setDraftEtat(dos.etat)
    setDraftCommentaire(dos.commentaire || '')
    setDraftPoints((dos.points_bloquants || []).join('\n'))
    setDraftCloture(dos.cloture)
    setLoading(false)
  }, [dossierId])

  useEffect(() => {
    if (accesAccorde) void charger()
  }, [accesAccorde, charger])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const statutParCode = useMemo(() => new Map(statuts.map((s) => [s.code, s])), [statuts])
  const statutCourant = dossier?.statut_cee ? statutParCode.get(dossier.statut_cee) : undefined

  // Passages par statut (date d'effet la plus récente, nombre de passages)
  const passages = useMemo(() => {
    const m = new Map<string, { derniere: string | null; nb: number }>()
    for (const h of historique) {
      if (!h.statut_cee_apres || h.statut_cee_apres === h.statut_cee_avant) continue
      const prev = m.get(h.statut_cee_apres)
      const date = h.date_effet || h.change_le.slice(0, 10)
      if (!prev) m.set(h.statut_cee_apres, { derniere: date, nb: 1 })
      else m.set(h.statut_cee_apres, { derniere: prev.derniere && prev.derniere > date ? prev.derniere : date, nb: prev.nb + 1 })
    }
    return m
  }, [historique])

  const valeursParChamp = useMemo(() => {
    const m = new Map<string, ValeurSource[]>()
    for (const v of valeurs) {
      const l = m.get(v.champ_code) || []
      l.push(v)
      m.set(v.champ_code, l)
    }
    return m
  }, [valeurs])

  const ecartsParChamp = useMemo(() => new Map((coherence?.ecarts || []).map((e) => [e.champ, e])), [coherence])

  const champsParGroupe = useMemo(() => {
    const m = new Map<string, ChampCee[]>()
    for (const c of champs) {
      const l = m.get(c.groupe) || []
      l.push(c)
      m.set(c.groupe, l)
    }
    const ordre = [...GROUPES_ORDRE, ...Array.from(m.keys()).filter((g) => !GROUPES_ORDRE.includes(g))]
    return ordre.filter((g) => m.has(g)).map((g) => ({ groupe: g, champs: m.get(g)! }))
  }, [champs])

  const controlesParType = useMemo(() => {
    const m = new Map<string, Controle[]>()
    for (const c of controles) {
      const l = m.get(c.type_piece) || []
      l.push(c)
      m.set(c.type_piece, l)
    }
    return m
  }, [controles])

  const pieceParEtape = useMemo(() => {
    const parType = new Map(pieces.map((p) => [p.type_piece, p]))
    const groupes = new Map<string, Array<{ type: PieceType; etat: PieceEtat | null }>>()
    pieceTypes.forEach((type) => {
      const liste = groupes.get(type.etape_code) || []
      liste.push({ type, etat: parType.get(type.code) || null })
      groupes.set(type.etape_code, liste)
    })
    return groupes
  }, [pieceTypes, pieces])

  const nbEcartsOuverts = (coherence?.ecarts || []).filter((e) => !e.accepte).length
  const nbReglesKo = (coherence?.regles || []).filter((r) => r.statut === 'ko').length

  // --- Actions ------------------------------------------------------------

  function ouvrirActivation(code?: string) {
    const proposition = code || statutCourant?.suivants?.[0] || ''
    setActivation({ statut: proposition, date: aujourdhuiIso(), commentaire: '', forcer: false, bloquants: [], busy: false, erreur: '' })
  }

  async function validerActivation() {
    if (!activation || !dossier) return
    if (!activation.statut) return setActivation({ ...activation, erreur: 'Choisissez le statut à activer.' })
    if (!activation.date) return setActivation({ ...activation, erreur: "La date d'effet est obligatoire." })
    setActivation({ ...activation, busy: true, erreur: '' })
    const { data, error } = await supabase.rpc('cee_activer_statut', {
      p_dossier: dossier.id,
      p_statut: activation.statut,
      p_date_effet: activation.date,
      p_commentaire: activation.commentaire.trim() || null,
      p_forcer: activation.forcer,
    })
    if (error) {
      setActivation({ ...activation, busy: false, erreur: error.message })
      return
    }
    const res = data as { ok: boolean; bloquants?: string[]; forces?: string[] }
    if (!res.ok) {
      setActivation({ ...activation, busy: false, bloquants: res.bloquants || [], erreur: '' })
      return
    }
    const s = statutParCode.get(activation.statut)
    setActivation(null)
    setToast({
      tone: 'success',
      text: `Statut « ${libelleStatut(s)} » activé au ${formatDateFr(activation.date)}${res.forces && res.forces.length ? ' (passage forcé, motif tracé dans l’historique)' : ''}.`,
    })
    await charger()
  }

  function commencerEdition(groupe: string, liste: ChampCee[]) {
    if (!dossier) return
    const b: Record<string, string> = {}
    for (const c of liste) b[c.code] = versSaisie(c, dossier[c.code])
    setBrouillon(b)
    setGroupeEdite(groupe)
  }

  async function enregistrerChamps(liste: ChampCee[]) {
    if (!dossier) return
    const changes: Record<string, string | null> = {}
    for (const c of liste) {
      const avant = versSaisie(c, dossier[c.code])
      const apres = (brouillon[c.code] ?? '').trim()
      if (avant !== apres) changes[c.code] = apres || null
    }
    if (!Object.keys(changes).length) {
      setGroupeEdite(null)
      return
    }
    setSavingChamps(true)
    const { error } = await supabase.rpc('cee_maj_champs', { p_dossier: dossier.id, p_valeurs: changes, p_source: 'saisie' })
    setSavingChamps(false)
    if (error) {
      setToast({ tone: 'error', text: `Enregistrement impossible : ${error.message}` })
      return
    }
    setGroupeEdite(null)
    setToast({ tone: 'success', text: `${Object.keys(changes).length} caractéristique(s) enregistrée(s) — contrôle de cohérence mis à jour.` })
    await charger()
  }

  async function accepterEcart() {
    if (!ecartOuvert || !dossier) return
    if (!ecartOuvert.commentaire.trim()) return setEcartOuvert({ ...ecartOuvert, erreur: 'Expliquez pourquoi cet écart est acceptable.' })
    setEcartOuvert({ ...ecartOuvert, busy: true, erreur: '' })
    const { error } = await supabase.rpc('cee_accepter_ecart', { p_dossier: dossier.id, p_champ: ecartOuvert.champ, p_commentaire: ecartOuvert.commentaire.trim() })
    if (error) {
      setEcartOuvert({ ...ecartOuvert, busy: false, erreur: error.message })
      return
    }
    setEcartOuvert(null)
    await charger()
  }

  async function synchroniserSage() {
    if (!dossier) return
    setSyncBusy(true)
    const { data, error } = await supabase.rpc('cee_sync_sage', { p_dossier: dossier.id })
    setSyncBusy(false)
    if (error) {
      setToast({ tone: 'error', text: `Synchronisation SAGE impossible : ${error.message}` })
      return
    }
    const res = data as { ok: boolean; message?: string }
    setToast(res.ok ? { tone: 'success', text: 'Données SAGE mises à jour (commande, BL, facture, CEE Premium, échéance).' } : { tone: 'error', text: res.message || 'Aucune donnée SAGE trouvée.' })
    await charger()
  }

  async function enregistrerSuivi() {
    if (!dossier) return
    setSavingSuivi(true)
    const points = draftPoints
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const { error } = await supabase
      .from('cee_dossiers')
      .update({ etat: draftEtat, commentaire: draftCommentaire.trim() || null, points_bloquants: points, cloture: draftCloture, modifie_par: email })
      .eq('id', dossier.id)
    setSavingSuivi(false)
    if (error) {
      setToast({ tone: 'error', text: `Enregistrement impossible : ${error.message}` })
      return
    }
    setToast({ tone: 'success', text: 'Suivi du dossier enregistré.' })
    await charger()
  }

  async function changerStatutPiece(typePiece: string, nouveauStatut: string) {
    if (!dossier) return
    const now = new Date().toISOString()
    const existante = pieces.find((p) => p.type_piece === typePiece)
    const { error } = await supabase.from('cee_dossier_pieces').upsert(
      {
        dossier_id: dossier.id,
        type_piece: typePiece,
        statut: nouveauStatut,
        modifie_le: now,
        modifie_par: email,
        recue_le: nouveauStatut === 'recue' ? now : existante?.recue_le || null,
        validee_le: nouveauStatut === 'validee' ? now : existante?.validee_le || null,
      },
      { onConflict: 'dossier_id,type_piece' }
    )
    if (error) {
      setToast({ tone: 'error', text: `Pièce non mise à jour : ${error.message}` })
      return
    }
    await charger()
  }

  // --- Rendu ----------------------------------------------------------------

  if (!accesAccorde) return <div className="min-h-screen bg-[#F4F3F0]" />
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#F4F3F0] text-slate-400">Chargement…</div>
  if (errorMsg || !dossier) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F4F3F0] text-center">
        <div className="text-sm text-[#A32C2C]">{errorMsg || 'Dossier introuvable.'}</div>
        <button onClick={() => router.push('/financement')} className="text-sm font-semibold text-[#111820] underline">
          Retour au tableau de bord
        </button>
      </div>
    )
  }

  const etapeCourante = etapes.find((e) => e.code === dossier.statut)
  const premium = Boolean(coherence?.premium)
  const ordreCourant = statutCourant?.ordre ?? -1
  const statutsSortie = statuts.filter((s) => s.nature === 'sortie')
  const jalonBl = passages.has('s06')
  const jalonPrime = passages.has('s14')
  const detail = statutParCode.get(statutDetail || dossier.statut_cee || '') || statutCourant

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      {/* Bandeau : couleurs du thème (sombre = inchangé, clair = blanc / encre marine), 16/10/2026 */}
      <header className="border-b border-[color:var(--cg-hdr-border)] bg-[color:var(--cg-hdr-bg)]">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-4 py-6 md:px-8">
          <button onClick={() => router.push('/financement')} className="w-fit text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--cg-fin-kicker)] hover:text-[color:var(--cg-hdr-ink)]">
            ← Financement CEE
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--cg-fin-kicker)]">Dossier d&apos;aides CEE · {dossier.reference}</div>
              <h1 className="mt-1 text-[26px] font-bold leading-tight text-[color:var(--cg-hdr-ink)]">{dossier.beneficiaire_nom || dossier.chantier_nom || dossier.reference}</h1>
              <p className="mt-1 text-sm text-[color:var(--cg-hdr-ink-3)]">
                {dossier.pro_raison_sociale || 'Installateur non renseigné'}
                {dossier.numero_tiers ? ` · ${String(dossier.numero_tiers)}` : ''}
                {dossier.chantier_ville ? ` · ${String(dossier.chantier_ville)}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge label={`Étape DRAPO ${etapeCourante?.ordre ?? '—'} · ${etapeCourante?.libelle || dossier.statut}`} />
                <Badge label={`Statut ${libelleStatut(statutCourant)}${dossier.statut_cee_depuis ? ` depuis le ${formatDateFr(dossier.statut_cee_depuis)}` : ''}`} tone="gold" />
                {premium && <Badge label="Offre premium" tone="blue" />}
                {dossier.cloture && <Badge label="Clôturé" tone="red" />}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push(`/financement/controle-pieces?dossier=${dossier.id}`)}
                className="h-10 rounded-xl border border-[color:var(--cg-fin-line)] px-4 text-sm font-medium text-[color:var(--cg-hdr-ink-2)] hover:border-[#9EAD43] hover:text-[color:var(--cg-hdr-ink)]"
              >
                Contrôler une pièce
              </button>
              <button type="button" onClick={() => ouvrirActivation()} className="h-10 rounded-xl bg-[#9EAD43] px-4 text-sm font-semibold text-[#111820] hover:brightness-110">
                Activer un statut
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-5 px-4 py-6 md:px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        {toast && (
          <div
            className={`xl:col-span-2 rounded-xl px-4 py-3 text-sm ${
              toast.tone === 'success' ? 'border border-[#BEDCC2] bg-[#EAF3E8] text-[#2E6B3E]' : 'border border-[#E7B7A6] bg-[#FBE9E9] text-[#A32C2C]'
            }`}
          >
            {toast.text}
          </div>
        )}

        {/* Synoptique ---------------------------------------------------- */}
        <section className="xl:col-span-2 rounded-2xl border border-[#E2DFD8] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Synoptique du dossier</h2>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
              <Legende bg="#111820" label="Statut courant" fg="#fff" />
              <Legende bg="#EAF3E8" label="Franchi (date d'effet)" fg="#2E6B3E" />
              <Legende bg="#FDF1DE" label="Boucle retours DRAPO" fg="#7A4F0C" />
              <Legende bg="#FBE9E9" label="Exception SAV" fg="#8E2A2A" />
              <span className="rounded border border-dashed border-[#9EAD43] px-1.5 py-0.5">Suivant possible</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {etapes.map((e) => {
              const liste = statuts.filter((s) => s.etape_code === e.code)
              const etapeActive = dossier.statut === e.code
              return (
                <div key={e.code} className={`flex flex-col gap-2 rounded-xl border p-2 ${etapeActive ? 'border-[#111820] bg-[#FAF9F7]' : 'border-[#E7E4DD]'}`}>
                  <div className="rounded-lg bg-[#1E2833] px-3 py-2 text-white">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9EAD43]">DRAPO {e.ordre}</div>
                    <div className="text-sm font-semibold leading-tight">{e.libelle}</div>
                  </div>
                  {liste.map((s) => {
                    const passe = passages.get(s.code)
                    const courant = s.code === dossier.statut_cee
                    const suivant = !courant && (statutCourant?.suivants || []).includes(s.code)
                    const franchi = !courant && !!passe && s.ordre <= ordreCourant
                    const st = NATURE_STYLE[s.nature]
                    const style = courant
                      ? { background: '#111820', color: '#fff', borderColor: '#111820' }
                      : franchi && s.nature === 'normal'
                      ? { background: '#EAF3E8', color: '#2E6B3E', borderColor: '#BEDCC2' }
                      : { background: st.bg, color: st.fg, borderColor: suivant ? '#9EAD43' : st.border }
                    return (
                      <button
                        key={s.code}
                        type="button"
                        onClick={() => setStatutDetail(s.code)}
                        onDoubleClick={() => ouvrirActivation(s.code)}
                        title="Clic : détail du statut · double-clic : activer ce statut"
                        className={`rounded-lg border px-2.5 py-2 text-left text-xs leading-snug transition hover:brightness-95 ${suivant ? 'border-dashed' : ''} ${
                          statutDetail === s.code ? 'ring-2 ring-[#B4761A]' : ''
                        }`}
                        style={style}
                      >
                        <div className="font-semibold">{libelleStatut(s)}</div>
                        {passe && (
                          <div className="mt-1 text-[11px] opacity-80">
                            {courant ? 'Depuis le ' : 'Le '}
                            {formatDateFr(courant ? dossier.statut_cee_depuis : passe.derniere)}
                            {passe.nb > 1 ? ` · ${passe.nb} passages` : ''}
                          </div>
                        )}
                      </button>
                    )
                  })}
                  {e.code === 'drapo_3' && <Jalon ok={jalonBl} label="BL CEGECLIM autorisé" detail="Après la validation avant travaux (statut 6)" />}
                  {e.code === 'drapo_5' && <Jalon ok={jalonPrime} label="Prime premium versable" detail="Après la validation COFRAC (statut 14)" />}
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Sorties à tout moment :</span>
            {statutsSortie.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => ouvrirActivation(s.code)}
                className={`rounded-full border px-3 py-1 font-medium ${s.code === dossier.statut_cee ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#D8D3C8] bg-white text-slate-700 hover:border-[#A32C2C]'}`}
              >
                {s.libelle}
              </button>
            ))}
            <span className="ml-auto">Boucles : 3 → 4 → 5 et 8 → 9 → 10 · Exception : SAV puis retour en 12</span>
          </div>

          {detail && (
            <div className="mt-4 grid gap-3 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-4 md:grid-cols-5">
              <div className="md:col-span-5 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  {libelleStatut(detail)}
                  {detail.code === dossier.statut_cee && <span className="ml-2 text-xs font-medium text-[#B4761A]">statut courant</span>}
                </div>
                {detail.code !== dossier.statut_cee && (
                  <button type="button" onClick={() => ouvrirActivation(detail.code)} className="rounded-lg border border-[#111820] px-3 py-1 text-xs font-semibold text-[#111820] hover:bg-[#111820] hover:text-white">
                    Activer ce statut
                  </button>
                )}
              </div>
              <DetailCase titre="Documents contrôlés" texte={detail.documents} couleur="#3B6D11" />
              <DetailCase titre="Infos complétées" texte={detail.infos_crm} couleur="#993C1D" />
              <DetailCase titre="Actions" texte={detail.actions} couleur="#44494E" />
              <DetailCase titre="Outils" texte={detail.outils} couleur="#44494E" />
              <DetailCase titre="Suivi admin" texte={detail.suivi_admin} couleur="#0F6E56" />
            </div>
          )}
        </section>

        <div className="space-y-5">
          {/* Cohérence --------------------------------------------------- */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Contrôle de cohérence</h2>
              <div className="flex gap-2 text-xs">
                <Pastille label={nbEcartsOuverts ? `${nbEcartsOuverts} écart(s) à traiter` : 'Aucun écart ouvert'} bg={nbEcartsOuverts ? '#FBE9E9' : '#EAF3E8'} fg={nbEcartsOuverts ? '#A32C2C' : '#2E6B3E'} />
                <Pastille label={nbReglesKo ? `${nbReglesKo} règle(s) non respectée(s)` : 'Règles de dates respectées'} bg={nbReglesKo ? '#FBE9E9' : '#EAF3E8'} fg={nbReglesKo ? '#A32C2C' : '#2E6B3E'} />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Chaque caractéristique est comparée entre la saisie, les pièces contrôlées et SAGE. Les passages 2 → 3 et 7 → 8 sont bloqués tant qu&apos;un écart n&apos;est pas corrigé ou accepté.
            </p>

            {(coherence?.ecarts || []).length > 0 && (
              <div className="mt-4 space-y-2">
                {coherence!.ecarts.map((e) => (
                  <div key={e.champ} className={`rounded-xl border p-3 ${e.accepte ? 'border-[#E7E4DD] bg-[#FAF9F7]' : 'border-[#E7B7A6] bg-[#FDF6F4]'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        {e.libelle} <span className="text-xs font-normal text-slate-400">· {e.groupe}</span>
                      </div>
                      {e.accepte ? (
                        <Pastille label="Écart accepté" bg="#EAF3E8" fg="#2E6B3E" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEcartOuvert({ champ: e.champ, libelle: e.libelle, commentaire: '', busy: false, erreur: '' })}
                          className="rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-[#B4761A]"
                        >
                          Accepter l&apos;écart
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {e.sources.map((s) => (
                        <span key={s.source} className="rounded-lg bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-[#E7E4DD]">
                          <b className="mr-1 font-medium text-slate-400">{SOURCE_LABEL[s.source] || s.source}</b>
                          {s.valeur || '—'}
                        </span>
                      ))}
                    </div>
                    {e.accepte && e.accepte_commentaire && (
                      <div className="mt-2 text-xs text-slate-500">
                        « {e.accepte_commentaire} » — {e.accepte_par || '—'}, {formatDateHeure(e.accepte_le)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 divide-y divide-[#F0EEE8] rounded-xl border border-[#E7E4DD]">
              {(coherence?.regles || []).map((r) => (
                <div key={r.code} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="text-slate-800">{r.libelle}</div>
                    <div className="text-xs text-slate-500">
                      {r.detail}
                      {r.bloque_vers ? ` · bloque le passage en ${statutParCode.get(r.bloque_vers)?.numero ?? r.bloque_vers}` : ''}
                    </div>
                  </div>
                  <Pastille
                    label={r.statut === 'ok' ? 'Respectée' : r.statut === 'ko' ? 'Non respectée' : 'À vérifier'}
                    bg={r.statut === 'ok' ? '#EAF3E8' : r.statut === 'ko' ? '#FBE9E9' : '#EFEDE8'}
                    fg={r.statut === 'ok' ? '#2E6B3E' : r.statut === 'ko' ? '#A32C2C' : '#6B7580'}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Caractéristiques -------------------------------------------- */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Caractéristiques du dossier</h2>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {(Object.keys(ORIGINE_LABEL) as Array<keyof typeof ORIGINE_LABEL>).map((o) => (
                  <span key={o} className="rounded px-1.5 py-0.5 font-semibold" style={{ background: ORIGINE_STYLE[o].bg, color: ORIGINE_STYLE[o].fg }}>
                    {ORIGINE_LABEL[o]}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              La valeur retenue est celle saisie ; à défaut, la première valeur lue sur une pièce ou dans SAGE. Les valeurs relevées sur chaque pièce sont affichées en dessous.
            </p>

            <div className="mt-4 space-y-4">
              {champsParGroupe.map(({ groupe, champs: liste }) => {
                const enEdition = groupeEdite === groupe
                return (
                  <div key={groupe} className="rounded-xl border border-[#E7E4DD]">
                    <div className="flex items-center justify-between gap-2 border-b border-[#E7E4DD] bg-[#FAF9F7] px-4 py-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{groupe}</div>
                      {enEdition ? (
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setGroupeEdite(null)} className="rounded-lg px-2.5 py-1 text-xs text-slate-500 hover:bg-white">
                            Annuler
                          </button>
                          <button
                            type="button"
                            disabled={savingChamps}
                            onClick={() => void enregistrerChamps(liste)}
                            className="rounded-lg bg-[#111820] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {savingChamps ? 'Enregistrement…' : 'Enregistrer'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={groupeEdite !== null}
                          onClick={() => commencerEdition(groupe, liste)}
                          className="rounded-lg border border-[#D8D3C8] bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-[#B4761A] disabled:opacity-40"
                        >
                          Modifier
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 md:grid-cols-2">
                      {liste.map((c) => {
                        const vs = valeursParChamp.get(c.code) || []
                        const ecart = ecartsParChamp.get(c.code)
                        const retenu = valeurEnTexte(dossier[c.code])
                        return (
                          <div key={c.code} className={`rounded-lg px-2 py-1.5 ${ecart && !ecart.accepte ? 'bg-[#FDF6F4] ring-1 ring-[#E7B7A6]' : ''}`}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs text-slate-500">{c.libelle}</span>
                              <span className="rounded px-1 py-px text-[10px] font-semibold" style={{ background: ORIGINE_STYLE[c.origine].bg, color: ORIGINE_STYLE[c.origine].fg }}>
                                {ORIGINE_LABEL[c.origine]}
                              </span>
                              {ecart && !ecart.accepte && <span className="text-[10px] font-semibold uppercase text-[#A32C2C]">écart</span>}
                            </div>
                            {enEdition ? (
                              <ChampInput champ={c} value={brouillon[c.code] ?? ''} onChange={(v) => setBrouillon((b) => ({ ...b, [c.code]: v }))} />
                            ) : (
                              <div className="mt-0.5 text-sm text-slate-900">{afficherValeur(c, dossier[c.code])}</div>
                            )}
                            {vs.filter((v) => v.source !== 'saisie' || vs.length > 1).length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {vs.map((v) => {
                                  const diff = retenu && v.valeur ? !valeursEgales(c.type, retenu, v.valeur) : false
                                  return (
                                    <span
                                      key={v.source}
                                      title={`Relevé le ${formatDateHeure(v.releve_le)}${v.releve_par ? ` par ${v.releve_par}` : ''}`}
                                      className={`rounded px-1.5 py-0.5 text-[11px] ${diff ? 'bg-[#FBE9E9] text-[#A32C2C]' : 'bg-[#F4F3F0] text-slate-600'}`}
                                    >
                                      {SOURCE_LABEL[v.source] || v.source} : {afficherValeur(c, v.valeur)}
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                            {c.sources.length > 0 && !vs.some((v) => v.source !== 'saisie') && (
                              <div className="mt-0.5 text-[11px] text-slate-400">À lire sur : {c.sources.map((s) => SOURCE_LABEL[s] || s).join(', ')}</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Contrôles de pièces ----------------------------------------- */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Contrôles des pièces</h2>
            <p className="mt-1 text-xs text-slate-500">Chaque contrôle est numéroté par type de pièce : un nouveau contrôle (pièce corrigée) remplace le précédent sans l&apos;effacer.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {TYPES_PIECE_CONTROLE.map((t) => {
                const liste = controlesParType.get(t.id) || []
                return (
                  <div key={t.id} className="rounded-xl border border-[#E7E4DD] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-[11px] text-slate-400">{t.code}</span>
                        <div className="text-sm font-semibold text-slate-900">{t.label}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push(`/financement/controle-pieces?dossier=${dossier.id}&type=${t.id}`)}
                        className="rounded-lg border border-[#D8D3C8] px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-[#B4761A]"
                      >
                        {liste.length ? 'Nouveau contrôle' : 'Contrôler'}
                      </button>
                    </div>
                    {liste.length === 0 ? (
                      <div className="mt-2 text-xs text-slate-400">Pas encore contrôlée.</div>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {liste.map((c, i) => {
                          const v = VERDICT_STYLE[c.verdict] || VERDICT_STYLE.incomplet
                          const precedent = c.controle_precedent_id ? controles.find((x) => x.id === c.controle_precedent_id) : null
                          return (
                            <li key={c.id} className={`rounded-lg px-2.5 py-1.5 text-xs ${i === 0 ? 'bg-[#FAF9F7]' : 'opacity-70'}`}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-slate-800">
                                  Contrôle n°{c.passage ?? '?'} · {formatDateHeure(c.controle_le)}
                                </span>
                                <Pastille label={v.label} bg={v.bg} fg={v.fg} />
                              </div>
                              <div className="mt-0.5 text-slate-500">
                                {c.nb_conformes} conforme(s) · {c.nb_non_conformes} non conforme(s)
                                {c.nb_sans_statut ? ` · ${c.nb_sans_statut} sans statut` : ''}
                                {c.controle_par ? ` · ${c.controle_par}` : ''}
                                {precedent ? ` · remplace le n°${precedent.passage ?? '?'} du ${formatDateFr(precedent.controle_le.slice(0, 10))}` : ''}
                                {c.statut_cee ? ` · au statut ${statutParCode.get(c.statut_cee)?.numero ?? c.statut_cee}` : ''}
                              </div>
                              {i === 0 && c.verdict !== 'conforme' && (c.resultats || []).filter((r) => r.statut === 'nc').length > 0 && (
                                <ul className="mt-1 list-inside list-disc text-[#A32C2C]">
                                  {(c.resultats || [])
                                    .filter((r) => r.statut === 'nc')
                                    .map((r, k) => (
                                      <li key={k}>
                                        {r.label}
                                        {r.commentaire ? ` — ${r.commentaire}` : ''}
                                      </li>
                                    ))}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Pièces par étape DRAPO -------------------------------------- */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Pièces attendues par étape DRAPO</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {etapes.map((etape) => {
                const liste = pieceParEtape.get(etape.code) || []
                if (!liste.length) return null
                return (
                  <div key={etape.code} className="rounded-xl border border-[#E7E4DD] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      DRAPO {etape.ordre} · {etape.libelle}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {liste.map(({ type, etat }) => {
                        const statutPiece = etat?.statut || 'manquante'
                        const style = PIECE_STATUT_STYLE[statutPiece] || PIECE_STATUT_STYLE.manquante
                        return (
                          <div key={type.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FAF9F7] px-3 py-1.5">
                            <span className="text-sm text-slate-800">
                              {type.libelle}
                              {!type.obligatoire && <span className="ml-1 text-xs text-slate-400">(facultative)</span>}
                            </span>
                            <select
                              value={statutPiece}
                              onChange={(e) => void changerStatutPiece(type.code, e.target.value)}
                              className="h-8 rounded-lg border-0 px-2 text-xs font-semibold"
                              style={{ background: style.bg, color: style.fg }}
                            >
                              {PIECE_STATUT_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Historique --------------------------------------------------- */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Historique des statuts</h2>
            {historique.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Aucun changement enregistré pour l&apos;instant.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {historique.map((h) => {
                  const changeStatut = h.statut_cee_apres && h.statut_cee_apres !== h.statut_cee_avant
                  return (
                    <li key={h.id} className="rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">
                          {changeStatut
                            ? `${h.statut_cee_avant ? `${libelleStatut(statutParCode.get(h.statut_cee_avant))} → ` : ''}${libelleStatut(statutParCode.get(h.statut_cee_apres!))}`
                            : `État : ${labelEtat(h.etat_avant)} → ${labelEtat(h.etat_apres)}`}
                        </span>
                        <span className="text-xs text-slate-400">
                          {h.date_effet ? `Effet au ${formatDateFr(h.date_effet)} · ` : ''}saisi le {formatDateHeure(h.change_le)}
                          {h.change_par ? ` · ${h.change_par}` : ''}
                        </span>
                      </div>
                      {h.commentaire && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{h.commentaire}</p>}
                      {!changeStatut && h.points_bloquants.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs text-[#A32C2C]">
                          {h.points_bloquants.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Colonne latérale --------------------------------------------- */}
        <div className="space-y-5">
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Suivi admin CEGECLIM</h2>
            <div className="mt-3 space-y-2 text-sm">
              <Ligne label="N° devis CEGECLIM" value={valeurEnTexte(dossier.numero_devis) || '—'} />
              <Ligne label="Commande" value={valeurEnTexte(dossier.numero_commande) || '—'} />
              <Ligne label="BL" value={`${valeurEnTexte(dossier.numero_bl) || '—'}${dossier.date_livraison_cegeclim ? ` · ${formatDateFr(valeurEnTexte(dossier.date_livraison_cegeclim))}` : ''}`} />
              <Ligne label="Facture" value={`${valeurEnTexte(dossier.numero_facture_cegeclim) || '—'}${dossier.date_emission_facture ? ` · ${formatDateFr(valeurEnTexte(dossier.date_emission_facture))}` : ''}`} />
              <Ligne label="Échéance" value={`${formatDateFr(valeurEnTexte(dossier.date_echeance_facture))}${premium ? ' (J+60 premium)' : ''}`} />
              <Ligne label="Mention CEE Premium SAGE" value={dossier.mention_cee_sage === null || dossier.mention_cee_sage === undefined ? '—' : dossier.mention_cee_sage ? 'Oui' : 'Non'} />
            </div>
            <button
              type="button"
              disabled={syncBusy}
              onClick={() => void synchroniserSage()}
              className="mt-4 h-10 w-full rounded-xl border-2 border-[#111820] text-sm font-semibold text-[#111820] hover:bg-[#111820] hover:text-white disabled:opacity-50"
            >
              {syncBusy ? 'Lecture de SAGE…' : 'Synchroniser avec SAGE'}
            </button>
            <div className="mt-2 text-xs text-slate-400">
              {dossier.sage_synchro_le ? `Dernière synchronisation : ${formatDateHeure(dossier.sage_synchro_le)}` : 'Jamais synchronisé'} · rapprochement par n° pro + n° devis ou commande
            </div>
          </section>

          <section className="sticky top-4 rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Suivi du dossier</h2>
            <div className="mt-4 space-y-4">
              <Field label="État">
                <select value={draftEtat} onChange={(e) => setDraftEtat(e.target.value)} className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
                  {ETAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Points bloquants" hint="Un point par ligne.">
                <textarea value={draftPoints} onChange={(e) => setDraftPoints(e.target.value)} rows={4} className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm" />
              </Field>
              <Field label="Commentaire">
                <textarea value={draftCommentaire} onChange={(e) => setDraftCommentaire(e.target.value)} rows={3} className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm" />
              </Field>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
                <input type="checkbox" checked={draftCloture} onChange={(e) => setDraftCloture(e.target.checked)} className="h-4 w-4 accent-[#B4761A]" />
                Dossier clôturé
              </label>
              <button
                onClick={() => void enregistrerSuivi()}
                disabled={savingSuivi}
                className="h-11 w-full rounded-xl bg-[#111820] text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {savingSuivi ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            <div className="mt-5 border-t border-[#E7E4DD] pt-4 text-xs text-slate-400">
              <div>
                Créé le {formatDateHeure(dossier.cree_le)}
                {dossier.cree_par ? ` par ${dossier.cree_par}` : ''}
              </div>
              <div className="mt-1">
                Modifié le {formatDateHeure(dossier.modifie_le)}
                {dossier.modifie_par ? ` par ${dossier.modifie_par}` : ''}
              </div>
              {etapeCourante?.delai_cible_jours ? <div className="mt-1">Délai cible de l&apos;étape DRAPO : {etapeCourante.delai_cible_jours} j</div> : null}
            </div>
          </section>
        </div>
      </main>

      {/* Fenêtre d'activation de statut ------------------------------------ */}
      {activation && (
        <Modale titre="Activer un statut" onClose={() => setActivation(null)}>
          <div className="space-y-4">
            <Field label="Statut">
              <select
                value={activation.statut}
                onChange={(e) => setActivation({ ...activation, statut: e.target.value, bloquants: [], forcer: false, erreur: '' })}
                className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm"
              >
                <option value="">— Choisir —</option>
                {(statutCourant?.suivants || []).length > 0 && (
                  <optgroup label="Suivants prévus par le parcours">
                    {(statutCourant?.suivants || []).map((c) => (
                      <option key={`s-${c}`} value={c}>
                        {libelleStatut(statutParCode.get(c))}
                      </option>
                    ))}
                  </optgroup>
                )}
                {etapes.map((e) => (
                  <optgroup key={e.code} label={`DRAPO ${e.ordre} · ${e.libelle}`}>
                    {statuts
                      .filter((s) => s.etape_code === e.code)
                      .map((s) => (
                        <option key={s.code} value={s.code} disabled={s.code === dossier.statut_cee}>
                          {libelleStatut(s)}
                          {s.code === dossier.statut_cee ? ' (actuel)' : ''}
                        </option>
                      ))}
                  </optgroup>
                ))}
                <optgroup label="Sorties">
                  {statutsSortie.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.libelle}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            {(() => {
              const s = statutParCode.get(activation.statut)
              if (!s) return null
              return (
                <div className="rounded-xl bg-[#FAF9F7] px-3 py-2 text-xs text-slate-600">
                  {s.actions && <div><b className="font-medium text-slate-800">À faire :</b> {s.actions}</div>}
                  {s.champ_date && <div className="mt-1">La date d&apos;effet alimente « {champs.find((c) => c.code === s.champ_date)?.libelle || s.champ_date} ».</div>}
                  {s.nature === 'sortie' && <div className="mt-1 text-[#A32C2C]">Sortie du parcours : le dossier sera clôturé ; le motif est obligatoire.</div>}
                  {s.controles_requis.length > 0 && <div className="mt-1">Vérifié avant passage : derniers contrôles conformes, écarts traités, règles de dates.</div>}
                </div>
              )
            })()}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="Date d'effet">
                <input
                  type="date"
                  value={activation.date}
                  max={aujourdhuiIso()}
                  onChange={(e) => setActivation({ ...activation, date: e.target.value })}
                  className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm"
                />
              </Field>
              <Field label="Commentaire">
                <textarea
                  value={activation.commentaire}
                  onChange={(e) => setActivation({ ...activation, commentaire: e.target.value })}
                  rows={3}
                  placeholder="Ex : retour DRAPO du 14/10 — ETAS manquant sur le devis"
                  className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm"
                />
              </Field>
            </div>

            {activation.bloquants.length > 0 && (
              <div className="rounded-xl border border-[#E7B7A6] bg-[#FBE9E9] p-3 text-sm text-[#A32C2C]">
                <div className="font-semibold">Passage refusé : contrôle de cohérence non satisfait</div>
                <ul className="mt-1 list-inside list-disc text-xs">
                  {activation.bloquants.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-800">
                  <input type="checkbox" checked={activation.forcer} onChange={(e) => setActivation({ ...activation, forcer: e.target.checked })} className="h-4 w-4 accent-[#A32C2C]" />
                  Forcer le passage (commentaire obligatoire, tracé dans l&apos;historique)
                </label>
              </div>
            )}
            {activation.erreur && <div className="text-sm text-[#A32C2C]">{activation.erreur}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setActivation(null)} className="h-10 rounded-xl border border-[#D8D3C8] px-4 text-sm font-medium">
                Annuler
              </button>
              <button
                type="button"
                disabled={activation.busy || (activation.bloquants.length > 0 && !activation.forcer)}
                onClick={() => void validerActivation()}
                className="h-10 rounded-xl bg-[#111820] px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                {activation.busy ? 'Activation…' : 'Activer'}
              </button>
            </div>
          </div>
        </Modale>
      )}

      {ecartOuvert && (
        <Modale titre={`Accepter l'écart · ${ecartOuvert.libelle}`} onClose={() => setEcartOuvert(null)}>
          <p className="text-sm text-slate-600">
            L&apos;acceptation reste valable tant que les valeurs comparées ne changent pas. Si une pièce est recontrôlée avec une autre valeur, l&apos;écart redevient à traiter.
          </p>
          <textarea
            value={ecartOuvert.commentaire}
            onChange={(e) => setEcartOuvert({ ...ecartOuvert, commentaire: e.target.value })}
            rows={3}
            placeholder="Justification (obligatoire)"
            className="mt-3 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm"
          />
          {ecartOuvert.erreur && <div className="mt-2 text-sm text-[#A32C2C]">{ecartOuvert.erreur}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEcartOuvert(null)} className="h-10 rounded-xl border border-[#D8D3C8] px-4 text-sm font-medium">
              Annuler
            </button>
            <button type="button" disabled={ecartOuvert.busy} onClick={() => void accepterEcart()} className="h-10 rounded-xl bg-[#111820] px-4 text-sm font-semibold text-white disabled:opacity-40">
              {ecartOuvert.busy ? 'Enregistrement…' : 'Accepter'}
            </button>
          </div>
        </Modale>
      )}
    </div>
  )
}

// --- Helpers ----------------------------------------------------------------

function labelEtat(e: string | null): string {
  return ETAT_OPTIONS.find((o) => o.value === e)?.label || e || '—'
}

function versSaisie(c: ChampCee, v: unknown): string {
  const s = valeurEnTexte(v)
  if (!s) return ''
  if (c.type === 'date') return s.slice(0, 10)
  if (c.type === 'bool') return s === 'true' ? 'true' : s === 'false' ? 'false' : ''
  return s
}

function ChampInput({ champ, value, onChange }: { champ: ChampCee; value: string; onChange: (v: string) => void }) {
  const cls = 'mt-0.5 h-9 w-full rounded-lg border border-[#D8D3C8] bg-white px-2.5 text-sm focus:border-[#B4761A] focus:outline-none'
  if (champ.type === 'bool') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">—</option>
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    )
  }
  if (champ.type === 'enum') {
    const options = champ.options.includes(value) || !value ? champ.options : [value, ...champ.options]
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      type={champ.type === 'date' ? 'date' : 'text'}
      inputMode={champ.type === 'number' ? 'decimal' : champ.type === 'integer' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  )
}

function Modale({ titre, onClose, children }: { titre: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="max-h-[calc(100vh-48px)] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{titre}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-[#F4F3F0]">
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Jalon({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${ok ? 'border-[#5DCAA5] bg-[#E1F5EE] text-[#085041]' : 'border-dashed border-[#B4B2A9] text-slate-500'}`}>
      <div className="font-semibold">
        {ok ? '✓ ' : ''}
        {label}
      </div>
      <div>{detail}</div>
    </div>
  )
}

function DetailCase({ titre, texte, couleur }: { titre: string; texte: string | null; couleur: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: couleur }}>
        {titre}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-slate-700">{texte || '—'}</div>
    </div>
  )
}

function Legende({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <span className="rounded px-1.5 py-0.5" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

function Badge({ label, tone }: { label: string; tone?: 'gold' | 'blue' | 'red' }) {
  // Couleurs du thème (bandeau sombre ou clair), 16/10/2026
  const style =
    tone === 'gold'
      ? { borderColor: 'var(--cg-fin-gold-line)', color: 'var(--cg-fin-gold-ink)' }
      : tone === 'blue'
      ? { borderColor: 'var(--cg-fin-blue-line)', color: 'var(--cg-fin-blue-ink)' }
      : tone === 'red'
      ? { borderColor: 'var(--cg-fin-red-line)', color: 'var(--cg-fin-red-ink)' }
      : { borderColor: 'var(--cg-fin-badge-line)', color: 'var(--cg-fin-badge-ink)' }
  return (
    <span className="rounded-full border px-2.5 py-1" style={style}>
      {label}
    </span>
  )
}

function Pastille({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}
