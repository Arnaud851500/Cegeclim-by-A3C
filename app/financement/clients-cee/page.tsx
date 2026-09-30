'use client'

// Clients « Convention CEE » (30/09/2026)
//
// Clients SAGE dont le champ libre « Convention CEE » = OUI
// (sage.tiers_complet.convention_cee) : ils peuvent déposer des dossiers d'aide
// CEE. Pour chacun : adresse, collaborateur de la fiche client et son agence
// (ref_collaborateurs), et le nombre de devis, commandes (CDC), BL
// (reconstitués à partir des factures) et factures depuis la date choisie —
// tous les documents, ou seulement ceux qui contiennent un article de la
// famille macro R/O.
//
// Source : RPC get_cee_clients(p_depuis, p_ro_only)
// (migration supabase/migrations/20260930_cee_clients_convention.sql).
// Un clic sur un client ouvre /financement/clients-cee/<code>.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

type ClientCee = {
  numero: string
  intitule: string
  adresse: string | null
  code_postal: string | null
  ville: string | null
  telephone: string | null
  email: string | null
  rge: string | null
  representant: string | null
  collaborateur: string | null
  agence: string | null
  nb_devis: number
  nb_cdc: number
  nb_bl: number
  nb_factures: number
  ht_devis: number
  ht_cdc: number
  ht_bl: number
  ht_factures: number
  nb_docs_cee_premium: number
}

function debutAnnee(): string {
  return `${new Date().getFullYear()}-01-01`
}

function euros(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function nombre(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString('fr-FR')
}

export default function ClientsConventionCeePage() {
  const router = useRouter()
  const { rights, loading: accessLoading } = useAccess()

  // Accès confirmé une fois : un rafraîchissement de session ne démonte pas la page.
  const [accesAccorde, setAccesAccorde] = useState(false)
  useEffect(() => {
    if (accessLoading) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verrou d'accès, posé une seule fois
    if (rights.can_financement) setAccesAccorde(true)
    else router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  const [depuis, setDepuis] = useState<string>(debutAnnee())
  const [roOnly, setRoOnly] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [agence, setAgence] = useState('')
  const [clients, setClients] = useState<ClientCee[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Reprise des filtres passés dans l'URL (retour depuis la fiche client).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const d = sp.get('depuis')
    /* eslint-disable react-hooks/set-state-in-effect -- lecture unique de l'URL au montage */
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDepuis(d)
    if (sp.get('ro') === '1') setRoOnly(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  useEffect(() => {
    if (!accesAccorde || !depuis) return
    let annule = false
    async function charger() {
      setLoading(true)
      setErrorMsg('')
      const { data, error } = await supabase.rpc('get_cee_clients', { p_depuis: depuis, p_ro_only: roOnly })
      if (annule) return
      setLoading(false)
      if (error) {
        setErrorMsg(`Chargement impossible : ${error.message}`)
        setClients([])
        return
      }
      setClients((data as { clients?: ClientCee[] } | null)?.clients || [])
    }
    void charger()
    const url = new URL(window.location.href)
    url.searchParams.set('depuis', depuis)
    if (roOnly) url.searchParams.set('ro', '1')
    else url.searchParams.delete('ro')
    window.history.replaceState(null, '', url.toString())
    return () => {
      annule = true
    }
  }, [accesAccorde, depuis, roOnly])

  const agences = useMemo(() => Array.from(new Set(clients.map((c) => c.agence).filter(Boolean) as string[])).sort(), [clients])

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return clients.filter((c) => {
      if (agence && c.agence !== agence) return false
      if (!q) return true
      return [c.numero, c.intitule, c.ville, c.collaborateur, c.agence, c.adresse].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [clients, recherche, agence])

  const totaux = useMemo(
    () =>
      filtres.reduce(
        (t, c) => ({
          nb_devis: t.nb_devis + c.nb_devis,
          nb_cdc: t.nb_cdc + c.nb_cdc,
          nb_bl: t.nb_bl + c.nb_bl,
          nb_factures: t.nb_factures + c.nb_factures,
          ht_devis: t.ht_devis + Number(c.ht_devis || 0),
          ht_cdc: t.ht_cdc + Number(c.ht_cdc || 0),
          ht_bl: t.ht_bl + Number(c.ht_bl || 0),
          ht_factures: t.ht_factures + Number(c.ht_factures || 0),
          cee: t.cee + c.nb_docs_cee_premium,
        }),
        { nb_devis: 0, nb_cdc: 0, nb_bl: 0, nb_factures: 0, ht_devis: 0, ht_cdc: 0, ht_bl: 0, ht_factures: 0, cee: 0 }
      ),
    [filtres]
  )

  function ouvrir(numero: string) {
    const qs = new URLSearchParams({ depuis })
    if (roOnly) qs.set('ro', '1')
    router.push(`/financement/clients-cee/${encodeURIComponent(numero)}?${qs.toString()}`)
  }

  if (!accesAccorde) return <div className="min-h-screen bg-[#F4F3F0]" />

  const libelleDocs = roOnly ? 'contenant du R/O' : 'tous documents'

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-3 px-4 py-6 md:px-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9EAD43]">Financement CEE · Partenaires</div>
          <h1 className="text-[26px] font-bold leading-tight text-white md:text-[30px]">Clients Convention CEE</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-300">
            Clients SAGE dont le champ « Convention CEE » est à OUI : ils peuvent déposer des dossiers d&apos;aide CEE. Documents de vente
            depuis la date choisie ; les BL sont reconstitués à partir des factures.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 md:px-8">
        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-[#E2DFD8] bg-white p-4">
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            Documents depuis le
            <input
              type="date"
              value={depuis}
              onChange={(e) => e.target.value && setDepuis(e.target.value)}
              className="h-10 rounded-xl border border-[#D8D3C8] px-3 text-sm text-slate-900 focus:border-[#B4761A] focus:outline-none"
            />
          </label>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-[#D8D3C8] px-3 text-sm text-slate-800 hover:border-[#B4761A]">
            <input type="checkbox" checked={roOnly} onChange={(e) => setRoOnly(e.target.checked)} className="h-4 w-4 accent-[#111820]" />
            Uniquement les documents avec du R/O
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            Agence
            <select
              value={agence}
              onChange={(e) => setAgence(e.target.value)}
              className="h-10 min-w-[160px] rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm text-slate-900 focus:border-[#B4761A] focus:outline-none"
            >
              <option value="">Toutes</option>
              {agences.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-medium text-slate-500">
            Recherche
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Code, nom, ville, collaborateur…"
              className="h-10 rounded-xl border border-[#D8D3C8] px-3 text-sm text-slate-900 focus:border-[#B4761A] focus:outline-none"
            />
          </label>
          {depuis !== debutAnnee() && (
            <button type="button" onClick={() => setDepuis(debutAnnee())} className="h-10 rounded-xl px-3 text-xs font-medium text-[#B4761A] underline underline-offset-2">
              Revenir au 1er janvier
            </button>
          )}
        </section>

        {errorMsg && <div className="mt-4 rounded-xl border border-[#E7B7A6] bg-[#FBE9E9] px-4 py-3 text-sm text-[#A32C2C]">{errorMsg}</div>}

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Clients convention CEE" value={nombre(filtres.length)} />
          <Kpi label={`Devis · ${libelleDocs}`} value={nombre(totaux.nb_devis)} sub={euros(totaux.ht_devis)} />
          <Kpi label={`Commandes · ${libelleDocs}`} value={nombre(totaux.nb_cdc)} sub={euros(totaux.ht_cdc)} />
          <Kpi label={`BL · ${libelleDocs}`} value={nombre(totaux.nb_bl)} sub={euros(totaux.ht_bl)} />
          <Kpi label={`Factures · ${libelleDocs}`} value={nombre(totaux.nb_factures)} sub={euros(totaux.ht_factures)} />
        </div>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DFD8] px-4 py-3">
            <h2 className="text-[15px] font-semibold text-slate-900">
              {loading ? 'Chargement…' : `${filtres.length} client${filtres.length > 1 ? 's' : ''}`}
            </h2>
            <span className="text-xs text-slate-500">
              Montants HT {roOnly ? 'des documents contenant du R/O (total du document)' : 'des documents'} · cliquez sur un client pour voir ses documents
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-[#E7E4DD] bg-[#FAF9F7] text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Code</th>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Adresse</th>
                  <th className="px-4 py-2.5">Collaborateur</th>
                  <th className="px-4 py-2.5">Agence</th>
                  <th className="px-4 py-2.5 text-right">Devis</th>
                  <th className="px-4 py-2.5 text-right">CDC</th>
                  <th className="px-4 py-2.5 text-right">BL</th>
                  <th className="px-4 py-2.5 text-right">Factures</th>
                  <th className="px-4 py-2.5 text-right" title="Documents contenant l'article CEEPRENIUM">CEE Premium</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((c) => (
                  <tr
                    key={c.numero}
                    onClick={() => ouvrir(c.numero)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') ouvrir(c.numero)
                    }}
                    tabIndex={0}
                    className="cursor-pointer border-b border-[#F0EEE8] align-top transition hover:bg-[#FAF7EE] focus:bg-[#FAF7EE] focus:outline-none"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{c.numero}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{c.intitule}</div>
                      {c.rge && <div className="mt-0.5 text-[11px] text-slate-500">RGE : {c.rge}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{c.adresse || '—'}</div>
                      <div className="text-xs text-slate-500">{[c.code_postal, c.ville].filter(Boolean).join(' ')}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{c.collaborateur || c.representant || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{c.agence || '—'}</td>
                    <CelluleCompte nb={c.nb_devis} ht={c.ht_devis} />
                    <CelluleCompte nb={c.nb_cdc} ht={c.ht_cdc} />
                    <CelluleCompte nb={c.nb_bl} ht={c.ht_bl} />
                    <CelluleCompte nb={c.nb_factures} ht={c.ht_factures} />
                    <td className="px-4 py-3 text-right">
                      {c.nb_docs_cee_premium > 0 ? (
                        <span className="inline-flex rounded-full bg-[#EEF5FA] px-2.5 py-0.5 text-xs font-semibold text-[#2E5E80]">{c.nb_docs_cee_premium}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && filtres.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                      Aucun client ne correspond aux filtres.
                    </td>
                  </tr>
                )}
              </tbody>
              {filtres.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-[#E2DFD8] bg-[#FAF9F7] font-semibold">
                    <td className="px-4 py-3" colSpan={5}>
                      Total
                    </td>
                    <CelluleCompte nb={totaux.nb_devis} ht={totaux.ht_devis} />
                    <CelluleCompte nb={totaux.nb_cdc} ht={totaux.ht_cdc} />
                    <CelluleCompte nb={totaux.nb_bl} ht={totaux.ht_bl} />
                    <CelluleCompte nb={totaux.nb_factures} ht={totaux.ht_factures} />
                    <td className="px-4 py-3 text-right">{totaux.cee || '—'}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          R/O = article dont la famille est rattachée à la famille macro R/O. CEE Premium = article CEEPRENIUM. Une commande est comptée à sa date de
          commande (y compris soldée), un BL à sa date de livraison, une facture à sa date de facture.
        </p>
      </main>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#E2DFD8] bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub} HT</div>}
    </div>
  )
}

function CelluleCompte({ nb, ht }: { nb: number; ht: number }) {
  return (
    <td className="px-4 py-3 text-right">
      {nb > 0 ? (
        <>
          <div className="font-semibold text-slate-900">{nombre(nb)}</div>
          <div className="text-[11px] text-slate-500">{euros(ht)}</div>
        </>
      ) : (
        <span className="text-slate-300">0</span>
      )}
    </td>
  )
}
