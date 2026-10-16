'use client'

// Ouverture d'un dossier d'aides CEE (16/10/2026) — formulaire installateur,
// statut 0 « Cadre de contribution à générer » (étape DRAPO 1).
//
// Les champs proposés sont ceux du registre cee_champs marqués « ouverture »
// (slide « Informations recueillies à l'ouverture ») : acteurs et contacts,
// logement et ménage, installation et aides. Chaque valeur est enregistrée
// comme source « saisie » (RPC cee_maj_champs) : elle sera comparée aux
// valeurs lues sur les pièces (avis d'imposition, note de dimensionnement,
// devis, facture, cadre de contribution) et dans SAGE.
//
// Les autres caractéristiques (dates des pièces, ETAS, catégorie de revenus,
// prime CEE…) se remplissent automatiquement au contrôle des pièces ou se
// complètent depuis la fiche du dossier.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import { ORIGINE_LABEL, SOURCE_LABEL, type ChampCee } from '@/lib/financementCee'

type ClientCee = { numero: string; intitule: string; email: string | null; ville: string | null }

const GROUPES_OUVERTURE = ['Acteurs et contacts', 'Logement et ménage', 'Installation et aides']
const CHAMPS_ADRESSE_BENEF = ['beneficiaire_adresse', 'beneficiaire_code_postal', 'beneficiaire_ville']

export default function NouveauDossierCeePage() {
  const router = useRouter()
  const { rights, email, loading: accessLoading } = useAccess()

  const [accesAccorde, setAccesAccorde] = useState(false)
  useEffect(() => {
    if (accessLoading) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verrou d'accès, posé une seule fois
    if (rights.can_financement) setAccesAccorde(true)
    else router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  const [champs, setChamps] = useState<ChampCee[]>([])
  // Chargement du registre : le message « registre indisponible » ne s'affiche
  // qu'après une vraie erreur de lecture, jamais pendant le chargement (16/10/2026).
  const [registreEtat, setRegistreEtat] = useState<'chargement' | 'ok' | 'erreur'>('chargement')
  const [registreErreur, setRegistreErreur] = useState('')
  const [clients, setClients] = useState<ClientCee[]>([])
  const [valeurs, setValeurs] = useState<Record<string, string>>({ fiches_cee: 'BAR-TH-171', offre_aides: 'Offre premium' })
  const [adresseDifferente, setAdresseDifferente] = useState(false)
  const [reference, setReference] = useState('')
  const [suggestedRef, setSuggestedRef] = useState('')
  const [commentaire, setCommentaire] = useState('')
  const [lienFormulaire, setLienFormulaire] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Registre des caractéristiques et référence suggérée : rapides, ils
  // conditionnent l'affichage du formulaire.
  useEffect(() => {
    if (!accesAccorde) return
    let annule = false
    async function load() {
      const year = new Date().getFullYear()
      const [{ data, error }, { count }] = await Promise.all([
        supabase.from('cee_champs').select('*').eq('ouverture', true).order('ordre', { ascending: true }),
        supabase.from('cee_dossiers').select('id', { count: 'exact', head: true }).like('reference', `CEE-${year}-%`),
      ])
      if (annule) return
      setSuggestedRef(`CEE-${year}-${String((count || 0) + 1).padStart(4, '0')}`)
      if (error) {
        setRegistreErreur(error.message)
        setRegistreEtat('erreur')
        return
      }
      setChamps(((data || []) as ChampCee[]).map((c) => ({ ...c, options: c.options || [], sources: c.sources || [] })))
      setRegistreEtat((data || []).length ? 'ok' : 'erreur')
    }
    void load()
    return () => {
      annule = true
    }
  }, [accesAccorde])

  // Liste des installateurs (clients Convention CEE) : plus lente, chargée à
  // part pour ne pas retarder le formulaire ; elle alimente seulement la
  // suggestion du champ Installateur.
  useEffect(() => {
    if (!accesAccorde) return
    let annule = false
    async function load() {
      const year = new Date().getFullYear()
      const { data } = await supabase.rpc('get_cee_clients', { p_depuis: `${year}-01-01`, p_ro_only: false })
      if (annule) return
      setClients(((data as { clients?: ClientCee[] } | null)?.clients || []).map((c) => ({ numero: c.numero, intitule: c.intitule, email: c.email, ville: c.ville })))
    }
    void load()
    return () => {
      annule = true
    }
  }, [accesAccorde])

  const parGroupe = useMemo(
    () =>
      GROUPES_OUVERTURE.map((g) => ({
        groupe: g,
        champs: champs.filter((c) => c.groupe === g && (adresseDifferente || !CHAMPS_ADRESSE_BENEF.includes(c.code))),
      })).filter((g) => g.champs.length),
    [champs, adresseDifferente]
  )

  function set(code: string, v: string) {
    setValeurs((prev) => ({ ...prev, [code]: v }))
  }

  // Choix de l'installateur dans la liste des clients « Convention CEE »
  function choisirInstallateur(saisie: string) {
    set('pro_raison_sociale', saisie)
    const c = clients.find((x) => `${x.intitule} (${x.numero})` === saisie || x.intitule === saisie)
    if (c) {
      setValeurs((prev) => ({ ...prev, pro_raison_sociale: c.intitule, numero_tiers: c.numero, pro_email: prev.pro_email || c.email || '' }))
    }
  }

  async function genererReference(): Promise<string> {
    const year = new Date().getFullYear()
    const { count } = await supabase.from('cee_dossiers').select('id', { count: 'exact', head: true }).like('reference', `CEE-${year}-%`)
    return `CEE-${year}-${String((count || 0) + 1).padStart(4, '0')}`
  }

  async function enregistrer() {
    setError('')
    const manquants = champs.filter((c) => c.obligatoire_ouverture && !(valeurs[c.code] || '').trim()).map((c) => c.libelle)
    if (manquants.length) return setError(`Champs obligatoires manquants : ${manquants.join(', ')}.`)
    setSaving(true)

    let ref = reference.trim() || (await genererReference())
    const base = {
      pro_raison_sociale: (valeurs.pro_raison_sociale || '').trim(),
      chantier_nom: (valeurs.beneficiaire_nom || '').trim(),
      beneficiaire_nom: (valeurs.beneficiaire_nom || '').trim(),
      numero_tiers: (valeurs.numero_tiers || '').trim() || null,
      lien_formulaire: lienFormulaire.trim() || null,
      commentaire: commentaire.trim() || null,
      statut: 'drapo_1',
      statut_cee: 's00',
      etat: 'pret',
      points_bloquants: [] as string[],
      cree_par: email || null,
      modifie_par: email || null,
      cloture: false,
    }

    let inserted: { id: string } | null = null
    let lastErr = ''
    for (let essai = 0; essai < 2 && !inserted; essai++) {
      const { data, error: insErr } = await supabase.from('cee_dossiers').insert({ ...base, reference: ref }).select('id').single()
      if (!insErr && data) {
        inserted = data as { id: string }
        break
      }
      lastErr = insErr?.message || 'erreur inconnue'
      if (insErr?.code === '23505' && !reference.trim()) {
        ref = `${await genererReference()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
        continue
      }
      break
    }
    if (!inserted) {
      setSaving(false)
      setError(`Création impossible : ${lastErr}`)
      return
    }

    // Toutes les caractéristiques saisies, tracées comme source « saisie »
    const saisies: Record<string, string> = {}
    for (const c of champs) {
      if (!adresseDifferente && CHAMPS_ADRESSE_BENEF.includes(c.code)) continue
      const v = (valeurs[c.code] || '').trim()
      if (v) saisies[c.code] = v
    }
    const { error: majErr } = await supabase.rpc('cee_maj_champs', { p_dossier: inserted.id, p_valeurs: saisies, p_source: 'saisie' })
    setSaving(false)
    if (majErr) {
      setError(`Dossier ${ref} créé, mais les caractéristiques n'ont pas été enregistrées : ${majErr.message}. Complétez-les depuis la fiche.`)
      return
    }
    router.push(`/financement/dossiers/${inserted.id}`)
  }

  if (!accesAccorde) return <div className="min-h-screen bg-[#F4F3F0]" />

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      {/* Bandeau : couleurs du thème (sombre = inchangé, clair = blanc / encre marine), 16/10/2026 */}
      <header className="border-b border-[color:var(--cg-hdr-border)] bg-[color:var(--cg-hdr-bg)]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-6 md:px-8">
          <button onClick={() => router.push('/financement')} className="w-fit text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--cg-fin-kicker)] hover:text-[color:var(--cg-hdr-ink)]">
            ← Financement CEE
          </button>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--cg-fin-kicker)]">DRAPO 1 · Constitution du dossier · statut 0</div>
            <h1 className="mt-1 text-2xl font-bold text-[color:var(--cg-hdr-ink)]">Nouveau dossier d&apos;aides</h1>
            <p className="mt-1 max-w-3xl text-sm text-[color:var(--cg-hdr-ink-3)]">
              Informations du formulaire installateur. Les autres caractéristiques seront lues sur les pièces au moment de leur contrôle, puis comparées à cette saisie.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 px-4 py-6 md:px-8 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {parGroupe.map(({ groupe, champs: liste }) => (
            <section key={groupe} className="rounded-2xl border border-[#E2DFD8] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{groupe}</h2>
                {groupe === 'Acteurs et contacts' && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={adresseDifferente} onChange={(e) => setAdresseDifferente(e.target.checked)} className="h-4 w-4 accent-[#B4761A]" />
                    Adresse du bénéficiaire différente de l&apos;adresse des travaux
                  </label>
                )}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {liste.map((c) => (
                  <Field
                    key={c.code}
                    label={`${c.libelle}${c.obligatoire_ouverture ? ' *' : ''}`}
                    hint={[c.aide, c.sources.length ? `Contrôlé avec : ${c.sources.map((s) => SOURCE_LABEL[s] || s).join(', ')}` : ''].filter(Boolean).join(' · ')}
                  >
                    {c.code === 'pro_raison_sociale' ? (
                      <>
                        <input
                          list="cee-installateurs"
                          value={valeurs.pro_raison_sociale || ''}
                          onChange={(e) => choisirInstallateur(e.target.value)}
                          placeholder="Rechercher un client Convention CEE…"
                          className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm focus:border-[#B4761A] focus:outline-none"
                        />
                        <datalist id="cee-installateurs">
                          {clients.map((cl) => (
                            <option key={cl.numero} value={`${cl.intitule} (${cl.numero})`}>
                              {cl.ville || ''}
                            </option>
                          ))}
                        </datalist>
                      </>
                    ) : (
                      <ChampInput champ={c} value={valeurs[c.code] || ''} onChange={(v) => set(c.code, v)} />
                    )}
                  </Field>
                ))}
              </div>
            </section>
          ))}
          {registreEtat === 'chargement' && (
            <div className="rounded-2xl border border-[#E2DFD8] bg-white p-5 text-sm text-slate-500">Chargement du formulaire…</div>
          )}
          {registreEtat === 'erreur' && (
            <div className="rounded-2xl border border-[#E7B7A6] bg-[#FBE9E9] p-5 text-sm text-[#A32C2C]">
              Registre des caractéristiques indisponible (table cee_champs){registreErreur ? ` : ${registreErreur}` : ''}. Rechargez la page ; si le message persiste, vérifiez que la migration 20261016_cee_parcours_drapo.sql est appliquée.
            </div>
          )}
        </div>

        <div className="space-y-5">
          <section className="sticky top-4 rounded-2xl border border-[#E2DFD8] bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Dossier</h2>
            <div className="mt-4 space-y-4">
              <Field label="Référence interne" hint={suggestedRef ? `Laissez vide pour générer ${suggestedRef}.` : 'Générée automatiquement si vide.'}>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={suggestedRef || 'CEE-2026-0001'}
                  className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm focus:border-[#B4761A] focus:outline-none"
                />
              </Field>
              <Field label="Lien du formulaire installateur" hint="Facultatif">
                <input
                  value={lienFormulaire}
                  onChange={(e) => setLienFormulaire(e.target.value)}
                  placeholder="https://forms…"
                  className="h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm focus:border-[#B4761A] focus:outline-none"
                />
              </Field>
              <Field label="Commentaire">
                <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={3} className="w-full rounded-xl border border-[#D8D3C8] bg-white px-3 py-2 text-sm" />
              </Field>
              <div className="rounded-xl bg-[#FAF9F7] px-3 py-2 text-xs text-slate-600">
                Le dossier démarre au statut <b className="font-medium">0 · Cadre de contribution à générer</b>. Devis v1 et note de dimensionnement v1, s&apos;ils sont fournis, se contrôlent ensuite depuis la fiche
                (bouton « Contrôler une pièce ») : leurs valeurs sont relevées en « {ORIGINE_LABEL.piece} ».
              </div>

              {error && <div className="rounded-xl border border-[#E7B7A6] bg-[#FBE9E9] px-3 py-2 text-sm text-[#A32C2C]">{error}</div>}

              <button
                onClick={() => void enregistrer()}
                disabled={saving || registreEtat !== 'ok'}
                className="h-11 w-full rounded-xl bg-[#111820] text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {saving ? 'Création…' : 'Créer le dossier'}
              </button>
              <button onClick={() => router.push('/financement')} className="h-10 w-full rounded-xl border border-[#D8D3C8] text-sm font-medium text-slate-600 hover:border-[#B4761A]">
                Annuler
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-400">Les champs marqués * sont obligatoires.</p>
          </section>
        </div>
      </main>
    </div>
  )
}

function ChampInput({ champ, value, onChange }: { champ: ChampCee; value: string; onChange: (v: string) => void }) {
  const cls = 'h-10 w-full rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm focus:border-[#B4761A] focus:outline-none'
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
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">—</option>
        {champ.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      type={champ.type === 'date' ? 'date' : champ.code.includes('email') ? 'email' : champ.code.includes('telephone') ? 'tel' : 'text'}
      inputMode={champ.type === 'number' ? 'decimal' : champ.type === 'integer' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
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
