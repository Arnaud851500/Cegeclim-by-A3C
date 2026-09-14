'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

type EtapeRow = {
  code: string
  ordre: number
  libelle: string
  description: string
  acteur: string
  delai_cible_jours: number | null
  total: number
  nb_pret: number
  nb_a_corriger: number
  nb_bloque: number
  montant_aide_estime: number
  age_median_jours: number
  age_max_jours: number
  nb_hors_delai: number
}

type DossierRow = {
  id: string
  reference: string
  financeur: string | null
  pro_raison_sociale: string
  numero_tiers: string | null
  agence: string | null
  chantier_nom: string
  chantier_ville: string | null
  montant_aide_estime: number | null
  montant_aide_verse: number | null
  numero_devis: string | null
  numero_commande: string | null
  numero_bl: string | null
  appairage_mode: string | null
  appairage_confiance: number | null
  statut: string
  statut_libelle: string
  statut_ordre: number
  etat: string
  points_bloquants: string[]
  pieces_manquantes: string[]
  age_etape_jours: number
  hors_delai: boolean
  cloture: boolean
}

const ETAT_STYLES: Record<string, { label: string; bg: string; fg: string }> = {
  pret: { label: 'Prêt', bg: '#EAF3E8', fg: '#2E6B3E' },
  a_corriger: { label: 'À corriger', bg: '#FDF1DE', fg: '#93600F' },
  bloque: { label: 'Bloqué', bg: '#FBE9E9', fg: '#A32C2C' },
}

function formatEuros(value: number | null | undefined) {
  const n = Number(value || 0)
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function EtatBadge({ etat }: { etat: string }) {
  const style = ETAT_STYLES[etat] || { label: etat, bg: '#EEE', fg: '#444' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  )
}

export default function FinancementDashboardPage() {
  const router = useRouter()
  const { rights, loading: accessLoading } = useAccess()

  const [etapes, setEtapes] = useState<EtapeRow[]>([])
  const [dossiers, setDossiers] = useState<DossierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  const [filtreEtape, setFiltreEtape] = useState<string>('')
  const [filtreEtat, setFiltreEtat] = useState<string>('')
  const [recherche, setRecherche] = useState('')
  const [afficherClotures, setAfficherClotures] = useState(false)

  // Garde d'accès : cette page n'est jamais dans le menu visible d'un
  // utilisateur sans can_financement, mais un lien direct doit aussi être
  // bloqué — d'où ce contrôle explicite plutôt que de compter uniquement
  // sur la coque applicative.
  useEffect(() => {
    if (accessLoading) return
    if (!rights.can_financement) router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  useEffect(() => {
    let annule = false

    async function charger() {
      setLoading(true)
      setErrorMsg('')

      const [{ data: etapesData, error: etapesError }, { data: dossiersData, error: dossiersError }] = await Promise.all([
        supabase.from('v_cee_dashboard_etapes').select('*').order('ordre', { ascending: true }),
        supabase
          .from('v_cee_dossiers_liste')
          .select('*')
          .order('statut_ordre', { ascending: true })
          .order('age_etape_jours', { ascending: false }),
      ])

      if (annule) return

      if (etapesError || dossiersError) {
        setErrorMsg(etapesError?.message || dossiersError?.message || 'Chargement impossible.')
        setLoading(false)
        return
      }

      setEtapes((etapesData || []) as EtapeRow[])
      setDossiers((dossiersData || []) as DossierRow[])
      setLoading(false)
    }

    void charger()
    return () => {
      annule = true
    }
  }, [])

  const kpis = useMemo(() => {
    const actifs = dossiers.filter((d) => !d.cloture)
    const montantEnCours = actifs.reduce((sum, d) => sum + Number(d.montant_aide_estime || 0), 0)
    const montantVerse = dossiers.reduce((sum, d) => sum + Number(d.montant_aide_verse || 0), 0)
    const horsDelai = actifs.filter((d) => d.hors_delai).length
    const bloques = actifs.filter((d) => d.etat === 'bloque').length
    return { total: actifs.length, montantEnCours, montantVerse, horsDelai, bloques }
  }, [dossiers])

  const dossiersFiltres = useMemo(() => {
    const texte = recherche.trim().toLowerCase()
    return dossiers.filter((d) => {
      if (!afficherClotures && d.cloture) return false
      if (filtreEtape && d.statut !== filtreEtape) return false
      if (filtreEtat && d.etat !== filtreEtat) return false
      if (texte) {
        const hay = `${d.reference} ${d.pro_raison_sociale} ${d.chantier_nom} ${d.chantier_ville || ''}`.toLowerCase()
        if (!hay.includes(texte)) return false
      }
      return true
    })
  }, [dossiers, filtreEtape, filtreEtat, recherche, afficherClotures])

  if (accessLoading || !rights.can_financement) {
    return <div className="min-h-screen bg-[#F4F3F0]" />
  }

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-4 px-4 py-6 md:px-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9EAD43]">
            Financement CEE
          </div>
          <h1 className="text-[26px] font-bold leading-tight text-white md:text-[30px]">
            Le pilotage des aides financières CEGECLIM
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-300">
            Du dépôt de la demande par le professionnel jusqu’au versement de la prime : pièces à collecter,
            rattachement au devis / commande / BL, dépôt auprès du financeur, preuves de chantier et validation.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 md:px-8">
        {errorMsg && (
          <div className="mb-4 rounded-xl border border-[#E7B7A6] bg-[#FBE9E9] px-4 py-3 text-sm text-[#A32C2C]">
            {errorMsg}
          </div>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Dossiers actifs" value={String(kpis.total)} />
          <KpiCard label="Aide estimée en cours" value={formatEuros(kpis.montantEnCours)} />
          <KpiCard label="Aide versée (cumul)" value={formatEuros(kpis.montantVerse)} accent="#2E6B3E" />
          <KpiCard
            label="Hors délai / bloqués"
            value={`${kpis.horsDelai} / ${kpis.bloques}`}
            accent={kpis.horsDelai + kpis.bloques > 0 ? '#A32C2C' : undefined}
          />
        </div>

        {/* Funnel des étapes */}
        <div className="mt-6 overflow-x-auto">
          <div className="flex min-w-max gap-3">
            {etapes.map((etape) => {
              const actif = filtreEtape === etape.code
              return (
                <button
                  key={etape.code}
                  type="button"
                  onClick={() => setFiltreEtape(actif ? '' : etape.code)}
                  className={`w-[190px] shrink-0 rounded-2xl border p-4 text-left transition ${
                    actif ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E2DFD8] bg-white hover:border-[#B4761A]'
                  }`}
                >
                  <div
                    className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                    style={{ color: actif ? '#9EAD43' : '#B4761A' }}
                  >
                    Étape {etape.ordre}
                  </div>
                  <div className={`mt-1 text-sm font-bold leading-tight ${actif ? 'text-white' : 'text-slate-900'}`}>
                    {etape.libelle}
                  </div>
                  <div className={`mt-3 text-2xl font-bold ${actif ? 'text-white' : 'text-slate-900'}`}>
                    {etape.total}
                  </div>
                  <div className={`mt-1 text-xs ${actif ? 'text-slate-300' : 'text-slate-500'}`}>
                    {formatEuros(etape.montant_aide_estime)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {etape.nb_bloque > 0 && <MiniBadge label={`${etape.nb_bloque} bloqué${etape.nb_bloque > 1 ? 's' : ''}`} bg="#FBE9E9" fg="#A32C2C" />}
                    {etape.nb_a_corriger > 0 && <MiniBadge label={`${etape.nb_a_corriger} à corriger`} bg="#FDF1DE" fg="#93600F" />}
                    {etape.nb_hors_delai > 0 && <MiniBadge label={`${etape.nb_hors_delai} hors délai`} bg="#F3E3EE" fg="#7A2E63" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Filtres */}
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E2DFD8] bg-white p-4">
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher : référence, professionnel, chantier…"
            className="h-10 min-w-[240px] flex-1 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm outline-none focus:border-[#B4761A]"
          />
          <select
            value={filtreEtat}
            onChange={(e) => setFiltreEtat(e.target.value)}
            className="h-10 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm"
          >
            <option value="">Tous les états</option>
            <option value="pret">Prêt</option>
            <option value="a_corriger">À corriger</option>
            <option value="bloque">Bloqué</option>
          </select>
          {filtreEtape && (
            <button
              type="button"
              onClick={() => setFiltreEtape('')}
              className="h-10 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm font-medium text-slate-700 hover:border-[#B4761A]"
            >
              Étape : {etapes.find((e) => e.code === filtreEtape)?.libelle || filtreEtape} ✕
            </button>
          )}
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm">
            <input
              type="checkbox"
              checked={afficherClotures}
              onChange={(e) => setAfficherClotures(e.target.checked)}
              className="h-4 w-4 accent-[#B4761A]"
            />
            Inclure les dossiers clôturés
          </label>
        </div>

        {/* Table */}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-[#E2DFD8] bg-white">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-[#E7E4DD] bg-[#FAF9F7] text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Référence</th>
                <th className="px-4 py-3">Professionnel</th>
                <th className="px-4 py-3">Chantier</th>
                <th className="px-4 py-3">Étape</th>
                <th className="px-4 py-3">État</th>
                <th className="px-4 py-3">Aide estimée</th>
                <th className="px-4 py-3">Âge étape</th>
                <th className="px-4 py-3">Points à traiter</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Chargement…
                  </td>
                </tr>
              ) : dossiersFiltres.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Aucun dossier ne correspond à ces filtres.
                  </td>
                </tr>
              ) : (
                dossiersFiltres.map((d) => {
                  const alertes = [...d.points_bloquants, ...d.pieces_manquantes.map((p) => `Pièce manquante : ${p}`)]
                  return (
                    <tr
                      key={d.id}
                      onClick={() => router.push(`/financement/dossiers/${d.id}`)}
                      className="cursor-pointer border-b border-[#F0EEE8] transition hover:bg-[#FAF9F7]"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{d.reference}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{d.pro_raison_sociale}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {d.chantier_nom}
                        {d.chantier_ville ? <span className="text-slate-400"> · {d.chantier_ville}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{d.statut_libelle}</td>
                      <td className="px-4 py-3">
                        <EtatBadge etat={d.etat} />
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatEuros(d.montant_aide_estime)}</td>
                      <td className="px-4 py-3">
                        <span className={d.hors_delai ? 'font-semibold text-[#A32C2C]' : 'text-slate-600'}>
                          {d.age_etape_jours} j{d.hors_delai ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {alertes.length === 0 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <span
                            className="inline-flex items-center rounded-full bg-[#FDF1DE] px-2.5 py-1 text-xs font-semibold text-[#93600F]"
                            title={alertes.join(' · ')}
                          >
                            {alertes.length} point{alertes.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-[#E2DFD8] bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold" style={{ color: accent || '#111820' }}>
        {value}
      </div>
    </div>
  )
}

function MiniBadge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}
