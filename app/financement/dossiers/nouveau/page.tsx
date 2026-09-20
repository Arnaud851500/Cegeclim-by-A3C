'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

// Création d'un dossier CEE (table cee_dossiers). La référence interne est
// générée automatiquement (CEE-AAAA-NNNN) si elle est laissée vide. Le
// rattachement SAGE (devis / commande / BL) est saisi à la main ici ;
// l'appairage automatique viendra plus tard.

type Etape = { code: string; ordre: number; libelle: string }

const ETAT_OPTIONS = [
  { value: 'pret', label: 'Prêt' },
  { value: 'a_corriger', label: 'À corriger' },
  { value: 'bloque', label: 'Bloqué' },
]

type Form = {
  reference: string
  reference_financeur: string
  financeur: string
  pro_raison_sociale: string
  pro_siret: string
  pro_email: string
  pro_telephone: string
  numero_tiers: string
  agence: string
  representant: string
  chantier_nom: string
  chantier_adresse: string
  chantier_code_postal: string
  chantier_ville: string
  beneficiaire_nom: string
  fiche_operation: string
  equipement: string
  montant_travaux_ht: string
  montant_aide_estime: string
  date_devis: string
  date_previsionnelle_travaux: string
  numero_devis: string
  numero_commande: string
  numero_bl: string
  statut: string
  etat: string
  commentaire: string
}

const EMPTY: Form = {
  reference: '',
  reference_financeur: '',
  financeur: '',
  pro_raison_sociale: '',
  pro_siret: '',
  pro_email: '',
  pro_telephone: '',
  numero_tiers: '',
  agence: '',
  representant: '',
  chantier_nom: '',
  chantier_adresse: '',
  chantier_code_postal: '',
  chantier_ville: '',
  beneficiaire_nom: '',
  fiche_operation: '',
  equipement: '',
  montant_travaux_ht: '',
  montant_aide_estime: '',
  date_devis: '',
  date_previsionnelle_travaux: '',
  numero_devis: '',
  numero_commande: '',
  numero_bl: '',
  statut: 'demande_deposee',
  etat: 'pret',
  commentaire: '',
}

function nullIfEmpty(v: string): string | null {
  const s = v.trim()
  return s ? s : null
}
function numOrNull(v: string): number | null {
  const s = v.trim().replace(/\s/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function NouveauDossierCeePage() {
  const router = useRouter()
  const { rights, email, loading: accessLoading } = useAccess()

  const [etapes, setEtapes] = useState<Etape[]>([])
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [suggestedRef, setSuggestedRef] = useState('')

  useEffect(() => {
    if (accessLoading) return
    if (!rights.can_financement) router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const year = new Date().getFullYear()
      const [{ data: etapesData }, { count }] = await Promise.all([
        supabase.from('cee_etapes').select('code, ordre, libelle').order('ordre', { ascending: true }),
        supabase.from('cee_dossiers').select('id', { count: 'exact', head: true }).like('reference', `CEE-${year}-%`),
      ])
      if (cancelled) return
      setEtapes((etapesData || []) as Etape[])
      setSuggestedRef(`CEE-${year}-${String((count || 0) + 1).padStart(4, '0')}`)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function genererReference(): Promise<string> {
    const year = new Date().getFullYear()
    const { count } = await supabase.from('cee_dossiers').select('id', { count: 'exact', head: true }).like('reference', `CEE-${year}-%`)
    return `CEE-${year}-${String((count || 0) + 1).padStart(4, '0')}`
  }

  async function enregistrer() {
    setError('')
    if (!form.pro_raison_sociale.trim()) return setError('La raison sociale du professionnel est obligatoire.')
    if (!form.chantier_nom.trim()) return setError('Le nom du chantier est obligatoire.')
    if (!form.statut) return setError("L'étape est obligatoire.")
    setSaving(true)

    const now = new Date().toISOString()
    let reference = form.reference.trim() || (await genererReference())

    const base = {
      reference_financeur: nullIfEmpty(form.reference_financeur),
      financeur: nullIfEmpty(form.financeur),
      pro_raison_sociale: form.pro_raison_sociale.trim(),
      pro_siret: nullIfEmpty(form.pro_siret),
      pro_email: nullIfEmpty(form.pro_email),
      pro_telephone: nullIfEmpty(form.pro_telephone),
      numero_tiers: nullIfEmpty(form.numero_tiers),
      agence: nullIfEmpty(form.agence),
      representant: nullIfEmpty(form.representant),
      chantier_nom: form.chantier_nom.trim(),
      chantier_adresse: nullIfEmpty(form.chantier_adresse),
      chantier_code_postal: nullIfEmpty(form.chantier_code_postal),
      chantier_ville: nullIfEmpty(form.chantier_ville),
      beneficiaire_nom: nullIfEmpty(form.beneficiaire_nom),
      fiche_operation: nullIfEmpty(form.fiche_operation),
      equipement: nullIfEmpty(form.equipement),
      montant_travaux_ht: numOrNull(form.montant_travaux_ht),
      montant_aide_estime: numOrNull(form.montant_aide_estime),
      montant_aide_verse: null,
      date_devis: nullIfEmpty(form.date_devis),
      date_previsionnelle_travaux: nullIfEmpty(form.date_previsionnelle_travaux),
      date_fin_travaux: null,
      numero_devis: nullIfEmpty(form.numero_devis),
      numero_commande: nullIfEmpty(form.numero_commande),
      numero_bl: nullIfEmpty(form.numero_bl),
      appairage_mode: form.numero_devis.trim() || form.numero_commande.trim() || form.numero_bl.trim() ? 'manuel' : null,
      appairage_confiance: null,
      statut: form.statut,
      etat: form.etat,
      points_bloquants: [] as string[],
      commentaire: nullIfEmpty(form.commentaire),
      statut_depuis: now,
      cree_le: now,
      cree_par: email || null,
      modifie_le: now,
      modifie_par: email || null,
      cloture: false,
    }

    // Deux tentatives si la référence générée est déjà prise (création concurrente).
    let inserted: { id: string } | null = null
    let lastErr = ''
    for (let essai = 0; essai < 2 && !inserted; essai++) {
      const { data, error: insErr } = await supabase
        .from('cee_dossiers')
        .insert({ ...base, reference })
        .select('id')
        .single()
      if (!insErr && data) {
        inserted = data as { id: string }
        break
      }
      lastErr = insErr?.message || 'erreur inconnue'
      if (insErr?.code === '23505' && !form.reference.trim()) {
        reference = `${await genererReference()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
        continue
      }
      break
    }

    setSaving(false)
    if (!inserted) {
      setError(`Création impossible : ${lastErr}`)
      return
    }
    router.push(`/financement/dossiers/${inserted.id}`)
  }

  if (accessLoading || !rights.can_financement) {
    return <div className="min-h-screen bg-[#F4F3F0]" />
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-6 md:px-8">
          <button onClick={() => router.push('/financement')} className="w-fit text-xs font-semibold uppercase tracking-[0.2em] text-[#9EAD43] hover:text-white">
            ← Financement CEE
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Nouveau dossier</h1>
            <p className="mt-1 text-sm text-slate-300">Créez le dossier pour pouvoir y rattacher les pièces contrôlées et suivre son avancement.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 px-4 py-6 md:px-8 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Identification</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Référence interne" hint={suggestedRef ? `Laissez vide pour générer ${suggestedRef}.` : 'Laissez vide pour la générer automatiquement.'}>
                <Input value={form.reference} onChange={(v) => set('reference', v)} placeholder={suggestedRef || 'CEE-2026-0001'} />
              </Field>
              <Field label="Financeur">
                <Input value={form.financeur} onChange={(v) => set('financeur', v)} placeholder="Ex : Hellio, Effy…" />
              </Field>
              <Field label="Référence financeur">
                <Input value={form.reference_financeur} onChange={(v) => set('reference_financeur', v)} />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Professionnel (artisan)</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Raison sociale *">
                <Input value={form.pro_raison_sociale} onChange={(v) => set('pro_raison_sociale', v)} />
              </Field>
              <Field label="SIRET">
                <Input value={form.pro_siret} onChange={(v) => set('pro_siret', v)} inputMode="numeric" />
              </Field>
              <Field label="Numéro tiers CEGECLIM">
                <Input value={form.numero_tiers} onChange={(v) => set('numero_tiers', v)} placeholder="Code client SAGE" />
              </Field>
              <Field label="E-mail">
                <Input value={form.pro_email} onChange={(v) => set('pro_email', v)} type="email" />
              </Field>
              <Field label="Téléphone">
                <Input value={form.pro_telephone} onChange={(v) => set('pro_telephone', v)} type="tel" />
              </Field>
              <Field label="Agence">
                <Input value={form.agence} onChange={(v) => set('agence', v)} />
              </Field>
              <Field label="Représentant">
                <Input value={form.representant} onChange={(v) => set('representant', v)} />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Chantier et bénéficiaire</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Nom du chantier *">
                <Input value={form.chantier_nom} onChange={(v) => set('chantier_nom', v)} placeholder="Ex : DUPONT – PAC air/eau" />
              </Field>
              <Field label="Bénéficiaire" hint="Nom utilisé pour l'appairage automatique des pièces contrôlées.">
                <Input value={form.beneficiaire_nom} onChange={(v) => set('beneficiaire_nom', v)} />
              </Field>
              <Field label="Adresse">
                <Input value={form.chantier_adresse} onChange={(v) => set('chantier_adresse', v)} />
              </Field>
              <Field label="Code postal">
                <Input value={form.chantier_code_postal} onChange={(v) => set('chantier_code_postal', v)} inputMode="numeric" />
              </Field>
              <Field label="Ville">
                <Input value={form.chantier_ville} onChange={(v) => set('chantier_ville', v)} />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Opération</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Fiche opération">
                <Input value={form.fiche_operation} onChange={(v) => set('fiche_operation', v)} placeholder="Ex : BAR-TH-171" />
              </Field>
              <Field label="Équipement">
                <Input value={form.equipement} onChange={(v) => set('equipement', v)} placeholder="Marque / modèle" />
              </Field>
              <Field label="Montant travaux HT (€)">
                <Input value={form.montant_travaux_ht} onChange={(v) => set('montant_travaux_ht', v)} inputMode="decimal" />
              </Field>
              <Field label="Aide estimée (€)">
                <Input value={form.montant_aide_estime} onChange={(v) => set('montant_aide_estime', v)} inputMode="decimal" />
              </Field>
              <Field label="Date du devis">
                <Input value={form.date_devis} onChange={(v) => set('date_devis', v)} type="date" />
              </Field>
              <Field label="Travaux prévus le">
                <Input value={form.date_previsionnelle_travaux} onChange={(v) => set('date_previsionnelle_travaux', v)} type="date" />
              </Field>
            </div>

            <div className="mt-5 rounded-xl border border-[#E7E4DD] bg-[#FAF9F7] p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rattachement CEGECLIM (facultatif)</div>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="N° devis">
                  <Input value={form.numero_devis} onChange={(v) => set('numero_devis', v)} />
                </Field>
                <Field label="N° commande">
                  <Input value={form.numero_commande} onChange={(v) => set('numero_commande', v)} />
                </Field>
                <Field label="N° BL">
                  <Input value={form.numero_bl} onChange={(v) => set('numero_bl', v)} />
                </Field>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="sticky top-4 rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Suivi initial</h2>
            <div className="mt-4 space-y-4">
              <Field label="Étape *">
                <select value={form.statut} onChange={(e) => set('statut', e.target.value)} className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
                  {etapes.length === 0 && <option value="demande_deposee">1 · Demande déposée</option>}
                  {etapes.map((etape) => (
                    <option key={etape.code} value={etape.code}>
                      {etape.ordre} · {etape.libelle}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="État">
                <select value={form.etat} onChange={(e) => set('etat', e.target.value)} className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
                  {ETAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Commentaire">
                <textarea value={form.commentaire} onChange={(e) => set('commentaire', e.target.value)} rows={4} className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm" />
              </Field>

              {error && <div className="rounded-xl border border-[#E7B7A6] bg-[#FBE9E9] px-3 py-2 text-sm text-[#A32C2C]">{error}</div>}

              <button
                onClick={() => void enregistrer()}
                disabled={saving}
                className="h-11 w-full rounded-xl bg-[#111820] text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {saving ? 'Création…' : 'Créer le dossier'}
              </button>
              <button onClick={() => router.push('/financement')} className="h-10 w-full rounded-xl border border-[#D8D3C8] text-sm font-medium text-slate-600 hover:border-[#B4761A]">
                Annuler
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-400">Les champs marqués * sont obligatoires. Les autres pourront être complétés depuis la fiche du dossier.</p>
          </section>
        </div>
      </main>
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

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  inputMode?: 'numeric' | 'decimal' | 'text' | 'email' | 'tel'
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      inputMode={inputMode}
      className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm focus:border-[#B4761A] focus:outline-none"
    />
  )
}
