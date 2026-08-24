'use client'

/**
 * Écran de visualisation "Clients SAGE"
 * ---------------------------------------------------------------------------
 * Combine sage.tiers_complet (fiche client) et sage.adresse_livraison (une
 * ligne par adresse de livraison, dont le flag "adresse principale"), avec
 * résolution du mode d'expédition (code -> désignation, ref_expedition_codes)
 * -- via la vue public.v_sage_clients_adresse_livraison (sage.tiers_complet
 * et sage.adresse_livraison ne sont pas accessibles directement à l'app).
 *
 * Filtres disponibles : recherche libre (n° tiers / intitulé / ville),
 * agence de rattachement, famille, mode d'expédition, "adresses principales
 * uniquement", "exclure les tiers en sommeil".
 *
 * Placer ce fichier en app/<route-de-ton-choix>/page.tsx -- un autre page.tsx
 * existe déjà pour l'écran de contrôle SAGE ↔ BLG, donc une route distincte.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Types ────────────────────────────────────────────────────────────────

type ClientAdresseRow = {
  numero_tiers: string
  intitule: string | null
  type_tiers: string | null
  qualite: string | null
  siret: string | null
  ville_siege: string | null
  code_postal_siege: string | null
  famille: string | null
  agence_rattachement: string | null
  en_sommeil: boolean
  n_expedition_defaut: string | null
  expedition_defaut_designation: string | null
  li_no: string | null
  adresse_intitule: string | null
  li_adresse: string | null
  li_complement: string | null
  li_codepostal: string | null
  li_ville: string | null
  li_pays: string | null
  adresse_principale: boolean | null
  n_expedition_adresse: string | null
  expedition_adresse_designation: string | null
  li_telephone: string | null
  li_contact: string | null
}

function safeText(v: unknown) {
  return String(v ?? '').trim()
}

// Nettoyage des libellés d'agence -- doublons connus dans la donnée brute
// SAGE ("LA ROCHELLE" / "LA ROCHELLE " / "LAROCHELLE", espaces parasites,
// "." isolé) : on les regroupe pour ne pas polluer le filtre.
function normaliserAgence(v: string | null): string | null {
  const t = safeText(v).toUpperCase()
  if (!t || t === '.') return null
  if (t.replace(/\s+/g, '') === 'LAROCHELLE') return 'LA ROCHELLE'
  return t
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function ClientsSagePage() {
  const [rows, setRows] = useState<ClientAdresseRow[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [agenceFilter, setAgenceFilter] = useState('')
  const [familleFilter, setFamilleFilter] = useState('')
  const [expeditionFilter, setExpeditionFilter] = useState('')
  const [onlyPrincipale, setOnlyPrincipale] = useState(true)
  const [exclureSommeil, setExclureSommeil] = useState(true)

  const [selected, setSelected] = useState<ClientAdresseRow | null>(null)

  // Options de filtre -- chargées une fois, à partir de TOUTE la base (pas
  // seulement des lignes déjà filtrées), pour ne jamais proposer une
  // combinaison de filtres qui viderait la liste sans le vouloir.
  const [agenceOptions, setAgenceOptions] = useState<string[]>([])
  const [familleOptions, setFamilleOptions] = useState<string[]>([])
  const [expeditionOptions, setExpeditionOptions] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const { data, error: err } = await supabase
        .from('v_sage_clients_adresse_livraison')
        .select('agence_rattachement,famille,expedition_adresse_designation,expedition_defaut_designation')
        .limit(6000)
      if (cancelled || err || !data) return

      const agences = new Set<string>()
      const familles = new Set<string>()
      const expeditions = new Set<string>()
      ;(data as any[]).forEach((r) => {
        const ag = normaliserAgence(r.agence_rattachement)
        if (ag) agences.add(ag)
        const fam = safeText(r.famille)
        if (fam && fam !== 'Aucune') familles.add(fam)
        const exp = safeText(r.expedition_adresse_designation) || safeText(r.expedition_defaut_designation)
        if (exp) expeditions.add(exp)
      })
      setAgenceOptions(Array.from(agences).sort())
      setFamilleOptions(Array.from(familles).sort())
      setExpeditionOptions(Array.from(expeditions).sort())
    }
    void loadOptions()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        let query = supabase
          .from('v_sage_clients_adresse_livraison')
          // count: 'exact' -- pour connaître le VRAI total correspondant aux
          // filtres, indépendamment de la limite de lignes rapatriées
          // ci-dessous (sinon impossible de savoir si la liste affichée est
          // tronquée ou complète).
          .select('*', { count: 'exact' })
          .order('numero_tiers', { ascending: true })
          // 3000 -- constaté ~2 240 lignes avec les filtres par défaut et
          // ~3 520 adresses principales au total (toutes agences/familles) :
          // 3000 couvre confortablement tous les cas réels, contrairement
          // à l'ancienne limite de 500 qui tronquait systématiquement.
          .limit(3000)

        const term = search.trim()
        if (term) {
          query = query.or(`numero_tiers.ilike.%${term}%,intitule.ilike.%${term}%,li_ville.ilike.%${term}%`)
        }
        if (onlyPrincipale) query = query.eq('adresse_principale', true)
        if (exclureSommeil) query = query.eq('en_sommeil', false)
        if (familleFilter) query = query.eq('famille', familleFilter)
        if (agenceFilter) {
          // Comparaison insensible aux variantes d'espaces/casse repérées
          // dans la donnée brute -- voir normaliserAgence().
          query = query.ilike('agence_rattachement', `%${agenceFilter}%`)
        }
        if (expeditionFilter) {
          query = query.or(`expedition_adresse_designation.eq.${expeditionFilter},expedition_defaut_designation.eq.${expeditionFilter}`)
        }

        const { data, count, error: err } = await query
        if (cancelled) return
        if (err) throw err
        setRows((data || []) as ClientAdresseRow[])
        setTotalCount(typeof count === 'number' ? count : null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [search, agenceFilter, familleFilter, expeditionFilter, onlyPrincipale, exclureSommeil])

  const stats = useMemo(() => {
    const clientsDistincts = new Set(rows.map((r) => r.numero_tiers)).size
    const adressesPrincipales = rows.filter((r) => r.adresse_principale).length
    const enSommeil = rows.filter((r) => r.en_sommeil).length
    return { total: rows.length, clientsDistincts, adressesPrincipales, enSommeil }
  }, [rows])

  const filtresActifs = Boolean(search.trim() || agenceFilter || familleFilter || expeditionFilter)

  return (
    <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1700px] space-y-4">
        {/* En-tête */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Référentiel SAGE</p>
          <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-[#111820]">Clients SAGE — Fiches &amp; adresses de livraison</h1>
          <p className="mt-1 text-[13px] text-[#8A8474]">
            Fiche client (tiers_complet) croisée avec ses adresses de livraison, mode d&rsquo;expédition résolu (code → désignation).
          </p>
        </section>

        {/* KPI */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Lignes affichées" value={stats.total} loading={loading} />
          <KpiCard label="Clients distincts" value={stats.clientsDistincts} loading={loading} />
          <KpiCard label="Adresses principales" value={stats.adressesPrincipales} loading={loading} tone="ok" />
          <KpiCard label="Dont en sommeil" value={stats.enSommeil} loading={loading} tone="warn" />
        </section>

        {/* Filtres */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="grid gap-2 md:grid-cols-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° tiers, raison sociale ou ville…"
              className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2"
            />
            <select
              value={agenceFilter}
              onChange={(e) => setAgenceFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
            >
              <option value="">Agence : Toutes</option>
              {agenceOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <select
              value={familleFilter}
              onChange={(e) => setFamilleFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
            >
              <option value="">Famille : Toutes</option>
              {familleOptions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <select
              value={expeditionFilter}
              onChange={(e) => setExpeditionFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E] md:col-span-2"
            >
              <option value="">Mode d&rsquo;expédition : Tous</option>
              {expeditionOptions.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
              <input type="checkbox" checked={onlyPrincipale} onChange={(e) => setOnlyPrincipale(e.target.checked)} className="accent-[#B4761A]" />
              Adresses principales uniquement
            </label>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
              <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
              Exclure les tiers en sommeil
            </label>
          </div>

          {filtresActifs && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-[#8A8474]">
              <button
                type="button"
                onClick={() => { setSearch(''); setAgenceFilter(''); setFamilleFilter(''); setExpeditionFilter('') }}
                className="font-bold text-[#B4761A] hover:underline"
              >
                Réinitialiser les filtres
              </button>
            </div>
          )}
        </section>

        {/* Liste + détail */}
        <section className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
          <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
                {loading
                  ? 'Chargement…'
                  : totalCount !== null && totalCount > rows.length
                    ? `${rows.length} affiché(s) sur ${totalCount} au total — affinez la recherche pour voir le reste`
                    : `${rows.length} résultat${rows.length > 1 ? 's' : ''}`}
              </div>
              {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
            </div>
            <div className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8]">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                  <tr>
                    <th className="px-3 py-2 font-bold">N° tiers</th>
                    <th className="px-3 py-2 font-bold">Agence</th>
                    <th className="px-3 py-2 font-bold">Expédition</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const key = `${r.numero_tiers}-${r.li_no ?? i}`
                    const isSelected = selected && selected.numero_tiers === r.numero_tiers && selected.li_no === r.li_no
                    const expedition = r.expedition_adresse_designation || r.expedition_defaut_designation
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelected(r)}
                        className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${isSelected ? 'bg-[#B4761A]/[0.06]' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</span>
                            {r.adresse_principale && (
                              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Principale</span>
                            )}
                            {r.en_sommeil && (
                              <span className="rounded-full bg-[#F4F3F0] px-1.5 py-0.5 text-[10px] font-bold text-[#8A8474]">Sommeil</span>
                            )}
                          </div>
                          <div className="truncate text-[12px] text-[#111820]">{r.intitule || '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-[12px] text-[#3A362E]">{normaliserAgence(r.agence_rattachement) || '—'}</td>
                        <td className="px-3 py-2 text-[12px] text-[#3A362E]">{expedition || '—'}</td>
                      </tr>
                    )
                  })}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Détail */}
          <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Détail</div>
            {!selected ? (
              <div className="flex h-64 items-center justify-center text-center text-[13px] text-[#8A8474]">
                Sélectionne une ligne dans la liste pour voir la fiche complète.
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-start justify-between border-b border-[#E5E1D8] pb-3">
                  <div>
                    <div className="font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero_tiers}</div>
                    <div className="text-[16px] font-bold text-[#111820]">{selected.intitule || '(intitulé non renseigné)'}</div>
                  </div>
                  <div className="flex gap-1.5">
                    {selected.adresse_principale && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Adresse principale</span>
                    )}
                    {selected.en_sommeil && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">En sommeil</span>
                    )}
                  </div>
                </div>

                <DetailGroup title="Fiche client (SAGE)">
                  <DetailRow label="Type" value={selected.type_tiers} />
                  <DetailRow label="Qualité" value={selected.qualite} />
                  <DetailRow label="SIRET" value={selected.siret} />
                  <DetailRow label="Famille" value={selected.famille} />
                  <DetailRow label="Agence de rattachement" value={normaliserAgence(selected.agence_rattachement)} />
                  <DetailRow label="Ville du siège" value={[selected.code_postal_siege, selected.ville_siege].filter(Boolean).join(' ')} />
                  <DetailRow label="Mode d'expédition par défaut" value={selected.expedition_defaut_designation ? `${selected.expedition_defaut_designation} (code ${selected.n_expedition_defaut})` : selected.n_expedition_defaut} />
                </DetailGroup>

                <DetailGroup title="Adresse de livraison">
                  <DetailRow label="N° adresse" value={selected.li_no} />
                  <DetailRow label="Intitulé adresse" value={selected.adresse_intitule} />
                  <DetailRow label="Adresse" value={[selected.li_adresse, selected.li_complement].filter(Boolean).join(', ')} />
                  <DetailRow label="Code postal / Ville" value={[selected.li_codepostal, selected.li_ville].filter(Boolean).join(' ')} />
                  <DetailRow label="Pays" value={selected.li_pays} />
                  <DetailRow label="Contact" value={selected.li_contact} />
                  <DetailRow label="Téléphone" value={selected.li_telephone} />
                  <DetailRow
                    label="Mode d'expédition (adresse)"
                    value={selected.expedition_adresse_designation ? `${selected.expedition_adresse_designation} (code ${selected.n_expedition_adresse})` : selected.n_expedition_adresse}
                  />
                </DetailGroup>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

// ── Composants ───────────────────────────────────────────────────────────

function KpiCard({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : '#111820'
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      {loading ? (
        <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[#F4F3F0]" />
      ) : (
        <div className="mt-1 text-[28px] font-bold tracking-tight" style={{ color }}>{value.toLocaleString('fr-FR')}</div>
      )}
    </div>
  )
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[1fr_1.4fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
      <span className="font-semibold text-[#3A362E]">{label}</span>
      <span className="text-[#111820]">{value || '—'}</span>
    </div>
  )
}
