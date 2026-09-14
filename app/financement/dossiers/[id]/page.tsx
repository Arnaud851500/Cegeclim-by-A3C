'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

type Dossier = {
  id: string
  reference: string
  reference_financeur: string | null
  financeur: string | null
  pro_raison_sociale: string
  pro_siret: string | null
  pro_email: string | null
  pro_telephone: string | null
  numero_tiers: string | null
  agence: string | null
  representant: string | null
  chantier_nom: string
  chantier_adresse: string | null
  chantier_code_postal: string | null
  chantier_ville: string | null
  beneficiaire_nom: string | null
  fiche_operation: string | null
  equipement: string | null
  montant_travaux_ht: number | null
  montant_aide_estime: number | null
  montant_aide_verse: number | null
  date_devis: string | null
  date_previsionnelle_travaux: string | null
  date_fin_travaux: string | null
  numero_devis: string | null
  numero_commande: string | null
  numero_bl: string | null
  appairage_mode: string | null
  appairage_confiance: number | null
  statut: string
  etat: string
  points_bloquants: string[]
  commentaire: string | null
  statut_depuis: string
  cree_le: string
  cree_par: string | null
  modifie_le: string
  modifie_par: string | null
  cloture: boolean
}

type Etape = {
  code: string
  ordre: number
  libelle: string
  description: string
  acteur: string
  delai_cible_jours: number | null
}

type PieceType = {
  code: string
  libelle: string
  etape_code: string
  source: string
  obligatoire: boolean
  ordre: number
}

type PieceEtat = {
  dossier_id: string
  type_piece: string
  statut: string
  url: string | null
  recue_le: string | null
  validee_le: string | null
  commentaire: string | null
}

type Historique = {
  id: number
  statut_avant: string | null
  statut_apres: string
  etat_avant: string | null
  etat_apres: string
  points_bloquants: string[]
  change_le: string
  change_par: string | null
  commentaire: string | null
}

type NoteDimensionnement = {
  id: string
  contenu: string
  verdict: string
  points_ko: string[]
  mail_correction: string | null
  fournisseur_ia: string | null
  verifie_le: string
  verifie_par: string | null
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

function formatEuros(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function FinancementDossierPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { rights, email, loading: accessLoading } = useAccess()

  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [etapes, setEtapes] = useState<Etape[]>([])
  const [pieceTypes, setPieceTypes] = useState<PieceType[]>([])
  const [pieces, setPieces] = useState<PieceEtat[]>([])
  const [historique, setHistorique] = useState<Historique[]>([])
  const [notes, setNotes] = useState<NoteDimensionnement[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  // Brouillon d'édition (statut / état / commentaire / points bloquants / paiement)
  const [draftStatut, setDraftStatut] = useState('')
  const [draftEtat, setDraftEtat] = useState('')
  const [draftCommentaire, setDraftCommentaire] = useState('')
  const [draftPointsBloquants, setDraftPointsBloquants] = useState('')
  const [draftMontantVerse, setDraftMontantVerse] = useState('')
  const [draftCloture, setDraftCloture] = useState(false)

  useEffect(() => {
    if (accessLoading) return
    if (!rights.can_financement) router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  const dossierId = String(params?.id || '')

  const charger = useCallback(async () => {
    if (!dossierId) return
    setLoading(true)
    setErrorMsg('')

    const [
      { data: dossierData, error: dossierError },
      { data: etapesData },
      { data: pieceTypesData },
      { data: piecesData },
      { data: historiqueData },
      { data: notesData },
    ] = await Promise.all([
      supabase.from('cee_dossiers').select('*').eq('id', dossierId).maybeSingle(),
      supabase.from('cee_etapes').select('*').order('ordre', { ascending: true }),
      supabase.from('cee_pieces_types').select('*').order('ordre', { ascending: true }),
      supabase.from('cee_dossier_pieces').select('*').eq('dossier_id', dossierId),
      supabase
        .from('cee_dossier_statuts_historique')
        .select('*')
        .eq('dossier_id', dossierId)
        .order('change_le', { ascending: false }),
      supabase.from('cee_notes_dimensionnement').select('*').eq('dossier_id', dossierId).order('verifie_le', { ascending: false }),
    ])

    if (dossierError || !dossierData) {
      setErrorMsg(dossierError?.message || 'Dossier introuvable.')
      setLoading(false)
      return
    }

    const d = dossierData as Dossier
    setDossier(d)
    setEtapes((etapesData || []) as Etape[])
    setPieceTypes((pieceTypesData || []) as PieceType[])
    setPieces((piecesData || []) as PieceEtat[])
    setHistorique((historiqueData || []) as Historique[])
    setNotes((notesData || []) as NoteDimensionnement[])

    setDraftStatut(d.statut)
    setDraftEtat(d.etat)
    setDraftCommentaire(d.commentaire || '')
    setDraftPointsBloquants((d.points_bloquants || []).join('\n'))
    setDraftMontantVerse(d.montant_aide_verse !== null ? String(d.montant_aide_verse) : '')
    setDraftCloture(d.cloture)

    setLoading(false)
  }, [dossierId])

  useEffect(() => {
    void charger()
  }, [charger])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

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

  async function enregistrer() {
    if (!dossier) return
    setSaving(true)

    const pointsBloquants = draftPointsBloquants
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    const statutChange = draftStatut !== dossier.statut
    const etatChange = draftEtat !== dossier.etat
    const now = new Date().toISOString()

    const montantVerse = draftMontantVerse.trim() ? Number(draftMontantVerse.replace(',', '.')) : null

    const payload: Record<string, unknown> = {
      statut: draftStatut,
      etat: draftEtat,
      commentaire: draftCommentaire.trim() || null,
      points_bloquants: pointsBloquants,
      montant_aide_verse: montantVerse,
      cloture: draftCloture,
      modifie_le: now,
      modifie_par: email,
    }
    if (statutChange) payload.statut_depuis = now

    const { error: updateError } = await supabase.from('cee_dossiers').update(payload).eq('id', dossier.id)

    if (updateError) {
      setSaving(false)
      setToast({ tone: 'error', text: `Enregistrement impossible : ${updateError.message}` })
      return
    }

    if (statutChange || etatChange) {
      const { error: histError } = await supabase.from('cee_dossier_statuts_historique').insert({
        dossier_id: dossier.id,
        statut_avant: dossier.statut,
        statut_apres: draftStatut,
        etat_avant: dossier.etat,
        etat_apres: draftEtat,
        points_bloquants: pointsBloquants,
        change_par: email,
        commentaire: draftCommentaire.trim() || null,
      })
      if (histError) {
        console.warn('[financement] historique non journalisé :', histError.message)
      }
    }

    setSaving(false)
    setToast({ tone: 'success', text: 'Dossier enregistré.' })
    await charger()
  }

  async function changerStatutPiece(typePiece: string, nouveauStatut: string) {
    if (!dossier) return
    const now = new Date().toISOString()
    const existante = pieces.find((p) => p.type_piece === typePiece)

    const payload: Record<string, unknown> = {
      dossier_id: dossier.id,
      type_piece: typePiece,
      statut: nouveauStatut,
      modifie_le: now,
      modifie_par: email,
      recue_le: nouveauStatut === 'recue' ? now : existante?.recue_le || null,
      validee_le: nouveauStatut === 'validee' ? now : existante?.validee_le || null,
    }

    const { error } = await supabase.from('cee_dossier_pieces').upsert(payload, { onConflict: 'dossier_id,type_piece' })
    if (error) {
      setToast({ tone: 'error', text: `Pièce non mise à jour : ${error.message}` })
      return
    }
    await charger()
  }

  if (accessLoading || !rights.can_financement) {
    return <div className="min-h-screen bg-[#F4F3F0]" />
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#F4F3F0] text-slate-400">Chargement…</div>
  }

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

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-6 md:px-8">
          <button
            onClick={() => router.push('/financement')}
            className="w-fit text-xs font-semibold uppercase tracking-[0.2em] text-[#9EAD43] hover:text-white"
          >
            ← Financement CEE
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{dossier.reference}</h1>
              <p className="mt-1 text-sm text-slate-300">
                {dossier.pro_raison_sociale} · {dossier.chantier_nom}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 px-4 py-6 md:px-8 lg:grid-cols-3">
        {toast && (
          <div
            className={`lg:col-span-3 rounded-xl px-4 py-3 text-sm ${
              toast.tone === 'success' ? 'border border-[#BEDCC2] bg-[#EAF3E8] text-[#2E6B3E]' : 'border border-[#E7B7A6] bg-[#FBE9E9] text-[#A32C2C]'
            }`}
          >
            {toast.text}
          </div>
        )}

        {/* Colonne principale */}
        <div className="space-y-5 lg:col-span-2">
          {/* Infos dossier */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Dossier</h2>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <InfoField label="Professionnel" value={dossier.pro_raison_sociale} />
              <InfoField label="SIRET" value={dossier.pro_siret || '—'} />
              <InfoField label="Numéro tiers" value={dossier.numero_tiers || '—'} />
              <InfoField label="Agence" value={dossier.agence || '—'} />
              <InfoField label="Représentant" value={dossier.representant || '—'} />
              <InfoField label="Financeur" value={dossier.financeur || '—'} />
              <InfoField label="Chantier" value={dossier.chantier_nom} />
              <InfoField
                label="Adresse chantier"
                value={[dossier.chantier_adresse, dossier.chantier_code_postal, dossier.chantier_ville].filter(Boolean).join(' ') || '—'}
              />
              <InfoField label="Bénéficiaire" value={dossier.beneficiaire_nom || '—'} />
              <InfoField label="Fiche opération" value={dossier.fiche_operation || '—'} />
              <InfoField label="Équipement" value={dossier.equipement || '—'} />
              <InfoField label="Montant travaux HT" value={formatEuros(dossier.montant_travaux_ht)} />
              <InfoField label="Aide estimée" value={formatEuros(dossier.montant_aide_estime)} />
              <InfoField label="Date devis" value={formatDate(dossier.date_devis)} />
              <InfoField label="Travaux prévus" value={formatDate(dossier.date_previsionnelle_travaux)} />
              <InfoField label="Fin de travaux" value={formatDate(dossier.date_fin_travaux)} />
            </div>

            <div className="mt-5 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rattachement CEGECLIM</div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                <InfoField label="Devis" value={dossier.numero_devis || '—'} />
                <InfoField label="Commande" value={dossier.numero_commande || '—'} />
                <InfoField label="BL" value={dossier.numero_bl || '—'} />
                <InfoField
                  label="Appairage"
                  value={
                    dossier.appairage_mode
                      ? `${dossier.appairage_mode}${dossier.appairage_confiance !== null ? ` (${Math.round(Number(dossier.appairage_confiance) * 100)}%)` : ''}`
                      : 'Non rattaché'
                  }
                />
              </div>
            </div>
          </section>

          {/* Note de dimensionnement */}
          {notes.length > 0 && (
            <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Note de dimensionnement</h2>
              {notes.map((note) => (
                <div key={note.id} className="mt-3 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{
                        background: note.verdict === 'ok' ? '#EAF3E8' : '#FBE9E9',
                        color: note.verdict === 'ok' ? '#2E6B3E' : '#A32C2C',
                      }}
                    >
                      {note.verdict}
                    </span>
                    <span className="text-xs text-slate-400">
                      Vérifié le {formatDateTime(note.verifie_le)}
                      {note.verifie_par ? ` · ${note.verifie_par}` : ''}
                      {note.fournisseur_ia ? ` · ${note.fournisseur_ia}` : ''}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{note.contenu}</p>
                  {note.points_ko.length > 0 && (
                    <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-[#A32C2C]">
                      {note.points_ko.map((point, i) => (
                        <li key={i}>{point}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Pièces obligatoires par étape */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Pièces du dossier</h2>
            <div className="mt-4 space-y-4">
              {etapes.map((etape) => {
                const liste = pieceParEtape.get(etape.code) || []
                if (liste.length === 0) return null
                return (
                  <div key={etape.code} className="rounded-xl border border-[#E7E4DD] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {etape.ordre} · {etape.libelle}
                    </div>
                    <div className="mt-3 space-y-2">
                      {liste.map(({ type, etat }) => {
                        const statutPiece = etat?.statut || 'manquante'
                        const style = PIECE_STATUT_STYLE[statutPiece] || PIECE_STATUT_STYLE.manquante
                        return (
                          <div key={type.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FAF9F7] px-3 py-2">
                            <span className="text-sm text-slate-800">
                              {type.libelle}
                              {!type.obligatoire && <span className="ml-1 text-xs text-slate-400">(optionnelle)</span>}
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

          {/* Historique */}
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Historique</h2>
            {historique.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Aucun changement de statut enregistré pour l’instant.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {historique.map((h) => (
                  <li key={h.id} className="rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">
                        {h.statut_avant ? `${h.statut_avant} → ${h.statut_apres}` : h.statut_apres}
                        {h.etat_avant !== h.etat_apres ? ` · ${h.etat_avant || '—'} → ${h.etat_apres}` : ''}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatDateTime(h.change_le)}
                        {h.change_par ? ` · ${h.change_par}` : ''}
                      </span>
                    </div>
                    {h.points_bloquants.length > 0 && (
                      <ul className="mt-2 list-inside list-disc text-xs text-[#A32C2C]">
                        {h.points_bloquants.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {h.commentaire && <p className="mt-2 text-xs text-slate-600">{h.commentaire}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Colonne édition */}
        <div className="space-y-5">
          <section className="sticky top-4 rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Suivi du dossier</h2>

            <div className="mt-4 space-y-4">
              <Field label="Étape">
                <select
                  value={draftStatut}
                  onChange={(e) => setDraftStatut(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm"
                >
                  {etapes.map((etape) => (
                    <option key={etape.code} value={etape.code}>
                      {etape.ordre} · {etape.libelle}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="État">
                <select
                  value={draftEtat}
                  onChange={(e) => setDraftEtat(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm"
                >
                  {ETAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Points bloquants" hint="Un point par ligne.">
                <textarea
                  value={draftPointsBloquants}
                  onChange={(e) => setDraftPointsBloquants(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm"
                  placeholder="Ex : Attestation RGE expirée"
                />
              </Field>

              <Field label="Commentaire">
                <textarea
                  value={draftCommentaire}
                  onChange={(e) => setDraftCommentaire(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm"
                />
              </Field>

              {draftStatut === 'aide_versee' && (
                <Field label="Montant versé" hint={`Daté de l’entrée dans cette étape : ${formatDate(dossier.statut_depuis)}.`}>
                  <input
                    value={draftMontantVerse}
                    onChange={(e) => setDraftMontantVerse(e.target.value)}
                    inputMode="decimal"
                    placeholder="Ex : 4200"
                    className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm"
                  />
                </Field>
              )}

              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
                <input
                  type="checkbox"
                  checked={draftCloture}
                  onChange={(e) => setDraftCloture(e.target.checked)}
                  className="h-4 w-4 accent-[#B4761A]"
                />
                Dossier clôturé
              </label>

              <button
                onClick={() => void enregistrer()}
                disabled={saving}
                className="h-11 w-full rounded-xl bg-[#111820] text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>

            <div className="mt-5 border-t border-[#E7E4DD] pt-4 text-xs text-slate-400">
              <div>Créé le {formatDateTime(dossier.cree_le)}{dossier.cree_par ? ` par ${dossier.cree_par}` : ''}</div>
              <div className="mt-1">Modifié le {formatDateTime(dossier.modifie_le)}{dossier.modifie_par ? ` par ${dossier.modifie_par}` : ''}</div>
              {etapeCourante?.delai_cible_jours && (
                <div className="mt-1">Délai cible pour cette étape : {etapeCourante.delai_cible_jours} j</div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-slate-800">{value}</div>
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
