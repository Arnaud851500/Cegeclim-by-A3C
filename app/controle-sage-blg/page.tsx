'use client'

/**
 * Écran "Clients SAGE / BLG"
 * ---------------------------------------------------------------------------
 * 3 onglets :
 *  - SAGE : fiche client (tiers_complet) + adresses de livraison + mode
 *    d'expédition résolu, filtrable (dont sélection MULTIPLE de modes
 *    d'expédition), avec export Excel de l'ensemble des champs.
 *  - BLG : même principe côté BLG uniquement (partner_base_partner via BLG),
 *    pour les tiers déjà appariés avec SAGE.
 *  - Comparaison : logique de contrôle de cohérence SAGE ↔ BLG restaurée
 *    telle quelle (comparatif champ par champ, panneau de mapping manuel,
 *    synchro à la demande), avec export Excel de l'ensemble des champs
 *    comparés SAGE ↔ BLG pour les clients filtrés à l'écran.
 *
 * Les 3 listes de gauche (SAGE / BLG / Comparaison) se naviguent au clavier
 * avec les flèches ↑ / ↓ une fois la liste focus (clic ou tabulation dessus).
 *
 * Nécessite le paquet "xlsx" (SheetJS) pour l'export Excel :
 * `npm install xlsx` si ce n'est pas déjà fait dans le projet.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import * as XLSX from 'xlsx'

// ─────────────────────────────────────────────────────────────────────────
// Onglet SAGE
// ─────────────────────────────────────────────────────────────────────────

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
  n_expedition_effectif: string | null
  expedition_designation: string | null
  expedition_base_calcul: string | null
  expedition_frais_port_ht: number | null
}

function safeText(v: unknown) {
  return String(v ?? '').trim()
}

function normaliserAgence(v: string | null): string | null {
  const t = safeText(v).toUpperCase()
  if (!t || t === '.') return null
  if (t.replace(/\s+/g, '') === 'LAROCHELLE') return 'LA ROCHELLE'
  return t
}

/** Colonnes à filtrer, factorisée pour être identique entre l'affichage à
 * l'écran (limité) et l'export Excel (toutes les lignes, paginé). */
function appliquerFiltresSage(
  query: any,
  params: { search: string; onlyPrincipale: boolean; exclureSommeil: boolean; familleFilter: string; agenceFilter: string; expeditionFilters: string[] },
) {
  const term = params.search.trim()
  if (term) query = query.or(`numero_tiers.ilike.%${term}%,intitule.ilike.%${term}%,li_ville.ilike.%${term}%`)
  if (params.onlyPrincipale) query = query.eq('adresse_principale', true)
  if (params.exclureSommeil) query = query.eq('en_sommeil', false)
  if (params.familleFilter) query = query.eq('famille', params.familleFilter)
  if (params.agenceFilter) query = query.ilike('agence_rattachement', `%${params.agenceFilter}%`)
  if (params.expeditionFilters.length > 0) query = query.in('expedition_designation', params.expeditionFilters)
  return query
}

const EXPORT_COLONNES_SAGE: Array<{ key: keyof ClientAdresseRow; label: string; transform?: (r: ClientAdresseRow) => string }> = [
  { key: 'numero_tiers', label: 'N° tiers' },
  { key: 'intitule', label: 'Intitulé' },
  { key: 'type_tiers', label: 'Type' },
  { key: 'qualite', label: 'Qualité' },
  { key: 'siret', label: 'SIRET' },
  { key: 'famille', label: 'Famille' },
  { key: 'agence_rattachement', label: 'Agence de rattachement', transform: (r) => normaliserAgence(r.agence_rattachement) || '' },
  { key: 'en_sommeil', label: 'En sommeil', transform: (r) => (r.en_sommeil ? 'Oui' : 'Non') },
  { key: 'ville_siege', label: 'Ville du siège' },
  { key: 'code_postal_siege', label: 'Code postal siège' },
  { key: 'n_expedition_effectif', label: "Code expédition (effectif)" },
  { key: 'expedition_designation', label: "Mode d'expédition (effectif)" },
  { key: 'expedition_base_calcul', label: 'Base de calcul frais de port' },
  { key: 'expedition_frais_port_ht', label: 'Frais de port prévu HT' },
  { key: 'adresse_principale', label: 'Adresse principale', transform: (r) => (r.adresse_principale ? 'Oui' : 'Non') },
  { key: 'li_no', label: 'N° adresse' },
  { key: 'adresse_intitule', label: 'Intitulé adresse' },
  { key: 'li_adresse', label: 'Adresse' },
  { key: 'li_complement', label: 'Complément adresse' },
  { key: 'li_codepostal', label: 'Code postal livraison' },
  { key: 'li_ville', label: 'Ville livraison' },
  { key: 'li_pays', label: 'Pays' },
  { key: 'li_contact', label: 'Contact livraison' },
  { key: 'li_telephone', label: 'Téléphone livraison' },
  { key: 'n_expedition_adresse', label: "Code expédition adresse" },
  { key: 'expedition_adresse_designation', label: "Mode d'expédition (adresse seule)" },
  { key: 'n_expedition_defaut', label: 'Code expédition défaut client' },
  { key: 'expedition_defaut_designation', label: "Mode d'expédition (défaut client seul)" },
]

/** Navigation clavier ↑/↓ générique pour les listes "N° tiers" à gauche.
 * `getIndex` retrouve l'index de la ligne actuellement sélectionnée dans
 * `rows` (comparaison propre à chaque onglet, ex. numero_tiers+li_no pour
 * SAGE, numero_tiers seul pour BLG/Comparaison). */
function creerHandlerNavigation<T>(
  rows: T[],
  selected: T | null,
  setSelected: (r: T) => void,
  getIndex: (rows: T[], selected: T | null) => number,
  refs: React.MutableRefObject<Record<number, HTMLTableRowElement | null>>,
) {
  return (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (rows.length === 0) return
    e.preventDefault()
    const currentIndex = getIndex(rows, selected)
    let nextIndex: number
    if (currentIndex === -1) nextIndex = 0
    else nextIndex = e.key === 'ArrowDown' ? Math.min(currentIndex + 1, rows.length - 1) : Math.max(currentIndex - 1, 0)
    setSelected(rows[nextIndex])
    refs.current[nextIndex]?.scrollIntoView({ block: 'nearest' })
  }
}

function OngletSage() {
  const [rows, setRows] = useState<ClientAdresseRow[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const [search, setSearch] = useState('')
  const [agenceFilter, setAgenceFilter] = useState('')
  const [familleFilter, setFamilleFilter] = useState('')
  const [expeditionFilters, setExpeditionFilters] = useState<string[]>([])
  const [expeditionOuvert, setExpeditionOuvert] = useState(false)
  const [onlyPrincipale, setOnlyPrincipale] = useState(true)
  const [exclureSommeil, setExclureSommeil] = useState(true)

  const [selected, setSelected] = useState<ClientAdresseRow | null>(null)

  const [agenceOptions, setAgenceOptions] = useState<string[]>([])
  const [familleOptions, setFamilleOptions] = useState<string[]>([])
  const [expeditionOptions, setExpeditionOptions] = useState<string[]>([])

  const expeditionRef = useRef<HTMLDivElement>(null)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (expeditionRef.current && !expeditionRef.current.contains(e.target as Node)) setExpeditionOuvert(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const { data, error: err } = await supabase
        .from('v_sage_clients_adresse_livraison')
        .select('agence_rattachement,famille,expedition_designation')
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
        const exp = safeText(r.expedition_designation)
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
          .select('*', { count: 'exact' })
          .order('numero_tiers', { ascending: true })
          .limit(10000)
        query = appliquerFiltresSage(query, { search, onlyPrincipale, exclureSommeil, familleFilter, agenceFilter, expeditionFilters })

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
  }, [search, agenceFilter, familleFilter, expeditionFilters, onlyPrincipale, exclureSommeil])

  const stats = useMemo(() => {
    const clientsDistincts = new Set(rows.map((r) => r.numero_tiers)).size
    const adressesPrincipales = rows.filter((r) => r.adresse_principale).length
    const enSommeil = rows.filter((r) => r.en_sommeil).length
    return { total: rows.length, clientsDistincts, adressesPrincipales, enSommeil }
  }, [rows])

  const filtresActifs = Boolean(search.trim() || agenceFilter || familleFilter || expeditionFilters.length > 0)

  function toggleExpedition(e: string) {
    setExpeditionFilters((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]))
  }

  function getIndexSage(list: ClientAdresseRow[], sel: ClientAdresseRow | null) {
    if (!sel) return -1
    return list.findIndex((r) => r.numero_tiers === sel.numero_tiers && r.li_no === sel.li_no)
  }
  const onListKeyDown = creerHandlerNavigation(rows, selected, setSelected, getIndexSage, listRefs)

  /** Export Excel : rapatrie TOUTES les lignes correspondant aux filtres
   * actuels (paginé par 1000, pas limité aux 3000 affichées à l'écran),
   * puis génère un .xlsx avec l'ensemble des champs (EXPORT_COLONNES_SAGE). */
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const toutes: ClientAdresseRow[] = []
      let from = 0
      const pageSize = 1000
      while (true) {
        let query = supabase
          .from('v_sage_clients_adresse_livraison')
          .select('*')
          .order('numero_tiers', { ascending: true })
          .range(from, from + pageSize - 1)
        query = appliquerFiltresSage(query, { search, onlyPrincipale, exclureSommeil, familleFilter, agenceFilter, expeditionFilters })
        const { data, error: err } = await query
        if (err) throw err
        const batch = (data || []) as ClientAdresseRow[]
        toutes.push(...batch)
        if (batch.length < pageSize) break
        from += pageSize
      }

      const feuille = toutes.map((r) => {
        const ligne: Record<string, string> = {}
        EXPORT_COLONNES_SAGE.forEach((c) => {
          ligne[c.label] = c.transform ? c.transform(r) : safeText(r[c.key])
        })
        return ligne
      })

      const ws = XLSX.utils.json_to_sheet(feuille)
      ws['!cols'] = EXPORT_COLONNES_SAGE.map(() => ({ wch: 22 }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Clients SAGE')
      XLSX.writeFile(wb, `clients_sage_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportEnCours(false)
    }
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Lignes affichées" value={stats.total} loading={loading} />
        <KpiCard label="Clients distincts" value={stats.clientsDistincts} loading={loading} />
        <KpiCard label="Adresses principales" value={stats.adressesPrincipales} loading={loading} tone="ok" />
        <KpiCard label="Dont en sommeil" value={stats.enSommeil} loading={loading} tone="warn" />
      </section>

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
          {/* Sélection MULTIPLE des modes d'expédition -- menu à cases à
             cocher (un <select> natif ne permet pas une sélection multiple
             confortable au clic simple). */}
          <div className="relative md:col-span-2" ref={expeditionRef}>
            <button
              type="button"
              onClick={() => setExpeditionOuvert((v) => !v)}
              className="flex h-10 w-full items-center justify-between rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]"
            >
              <span>{expeditionFilters.length === 0 ? "Mode d'expédition : Tous" : `Mode d'expédition (${expeditionFilters.length} sélectionné${expeditionFilters.length > 1 ? 's' : ''})`}</span>
              <span className="text-[#8A8474]">{expeditionOuvert ? '▲' : '▼'}</span>
            </button>
            {expeditionOuvert && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[#E5E1D8] bg-white p-1.5 shadow-lg">
                {expeditionFilters.length > 0 && (
                  <button type="button" onClick={() => setExpeditionFilters([])} className="mb-1 w-full rounded px-2 py-1 text-left text-[12px] font-bold text-[#B4761A] hover:underline">
                    Tout désélectionner
                  </button>
                )}
                {expeditionOptions.map((e) => (
                  <label key={e} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-[#F4F3F0]">
                    <input type="checkbox" checked={expeditionFilters.includes(e)} onChange={() => toggleExpedition(e)} className="accent-[#B4761A]" />
                    {e}
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={onlyPrincipale} onChange={(e) => setOnlyPrincipale(e.target.checked)} className="accent-[#B4761A]" />
            Adresses principales uniquement
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
            <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
            Exclure les tiers en sommeil
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
          {filtresActifs ? (
            <button
              type="button"
              onClick={() => { setSearch(''); setAgenceFilter(''); setFamilleFilter(''); setExpeditionFilters([]) }}
              className="text-[12px] font-bold text-[#B4761A] hover:underline"
            >
              Réinitialiser les filtres
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={() => void exporterExcel()}
            disabled={exportEnCours || loading}
            className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportEnCours ? 'Export en cours…' : '⬇ Exporter en Excel (tous les champs)'}
          </button>
        </div>
      </section>

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
          <div
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50"
          >
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                <tr>
                  <th className="px-3 py-2 font-bold">N° tiers</th>
                  <th className="px-3 py-2 font-bold">Agence</th>
                  <th className="px-3 py-2 font-bold">Expédition</th>
                  <th className="px-3 py-2 text-right font-bold">Frais de port</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const key = `${r.numero_tiers}-${r.li_no ?? i}`
                  const isSelected = selected && selected.numero_tiers === r.numero_tiers && selected.li_no === r.li_no
                  return (
                    <tr
                      key={key}
                      ref={(el) => { listRefs.current[i] = el }}
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
                      <td className="px-3 py-2 text-[12px] text-[#3A362E]">{r.expedition_designation || '—'}</td>
                      <td className="px-3 py-2 text-right text-[12px] font-[var(--font-mono,monospace)] text-[#3A362E]">
                        {r.expedition_frais_port_ht !== null ? `${Number(r.expedition_frais_port_ht).toFixed(2)} €` : '—'}
                      </td>
                    </tr>
                  )
                })}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

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

              <DetailGroup title="Expédition retenue (adresse si renseignée, sinon défaut client)">
                <DetailRow label="Mode d'expédition" value={selected.expedition_designation} />
                <DetailRow label="Code" value={selected.n_expedition_effectif} />
                <DetailRow label="Base de calcul frais de port" value={selected.expedition_base_calcul} />
                <DetailRow label="Frais de port prévu HT" value={selected.expedition_frais_port_ht !== null ? `${Number(selected.expedition_frais_port_ht).toFixed(2)} €` : null} />
              </DetailGroup>

              <DetailGroup title="Fiche client (SAGE)">
                <DetailRow label="Type" value={selected.type_tiers} />
                <DetailRow label="Qualité" value={selected.qualite} />
                <DetailRow label="SIRET" value={selected.siret} />
                <DetailRow label="Famille" value={selected.famille} />
                <DetailRow label="Agence de rattachement" value={normaliserAgence(selected.agence_rattachement)} />
                <DetailRow label="Ville du siège" value={[selected.code_postal_siege, selected.ville_siege].filter(Boolean).join(' ')} />
                <DetailRow label="Mode d'expédition par défaut (client)" value={selected.expedition_defaut_designation ? `${selected.expedition_defaut_designation} (code ${selected.n_expedition_defaut})` : selected.n_expedition_defaut} />
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
                  label="Mode d'expédition (adresse seule)"
                  value={selected.expedition_adresse_designation ? `${selected.expedition_adresse_designation} (code ${selected.n_expedition_adresse})` : selected.n_expedition_adresse}
                />
              </DetailGroup>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

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

// ─────────────────────────────────────────────────────────────────────────
// Types partagés SAGE ↔ BLG (onglets BLG + Comparaison)
// ─────────────────────────────────────────────────────────────────────────

type Summary = {
  total_sage: number
  apparies: number
  manquants_blg: number
  sans_ecart: number
  avec_ecart: number
  par_champ: Record<string, number>
}

type ControleRow = {
  numero_tiers: string
  blg_id_tiers: string | null
  blg_partner_id: number | null
  statut_appariement: 'apparie' | 'manquant_blg'
  sage_intitule: string | null; blg_intitule: string | null
  sage_siret: string | null; blg_siret: string | null
  sage_code_naf: string | null; blg_code_naf: string | null
  sage_code_postal: string | null; blg_code_postal: string | null
  sage_ville: string | null; blg_ville: string | null
  sage_representant: string | null; blg_commercial: string | null
  sage_encours: number | null; blg_encours: number | null
  sage_assurance_credit: number | null; blg_assurance_credit: number | null
  sage_famille: string | null; blg_famille: string | null
  sage_frais_facturation: string | null; blg_frais_facturation: string | null
  sage_routage_promo: string | null; blg_routage_promo: string | null
  sage_facture_email: string | null; blg_facture_electronique: string | null
  sage_releve_facture: string | null; blg_releve_facture: string | null
  sage_type_facture: string | null; blg_type_facture: string | null
  sage_capacite_expiration: string | null; blg_capacite_expiration: string | null
  champs_en_ecart: string[]
  sage_mise_en_sommeil: boolean | null
  blg_est_entite_interne: boolean | null
  blg_est_adresse_livraison: boolean | null
  sage_updated_at: string | null
  blg_last_update: string | null
  sage_qualite: string | null
  blg_tags: string[] | null
  sage_contact: string | null
  blg_contacts_resume: string | null
  blg_contact_principal: string | null
  blg_nb_contacts: number | null
  sage_agence_rattachement: string | null
  blg_iban: string | null
  blg_banque: string | null
  sage_abrege: string | null
  blg_nom_court: string | null
}

type Domaine = 'client' | 'article' | 'devis' | 'facture'
type ChampInventaire = { cote: 'sage' | 'blg'; colonne: string; type: string }
type ChampMapping = {
  id: number
  domaine: string
  champ_sage: string
  champ_blg: string | null
  label: string | null
  type_comparaison: 'auto' | 'manuel' | 'affichage_seul' | 'non_comparable'
  notes: string | null
}
type SyncLogEntry = { table_name: string; rows_synced: number; status: string; started_at: string; finished_at: string }
type Operateur = 'egal' | 'contient' | 'ne_contient_pas' | 'commence_par' | 'est_vide' | 'non_vide'
type FiltreCondition = { id: string; cote: 'sage' | 'blg'; champ: string; operateur: Operateur; valeur: string }

const OPERATEUR_LABELS: Record<Operateur, string> = {
  egal: 'est égal à', contient: 'contient', ne_contient_pas: 'ne contient pas',
  commence_par: 'commence par', est_vide: 'est vide', non_vide: "n'est pas vide",
}
function nouvelleCondition(): FiltreCondition {
  return { id: Math.random().toString(36).slice(2), cote: 'sage', champ: '', operateur: 'contient', valeur: '' }
}
const CHAMP_LABELS: Record<string, string> = {
  intitule: 'Intitulé', siret: 'SIRET', code_naf: 'Code NAF', code_postal: 'Code postal', ville: 'Ville',
  representant: 'Représentant', encours: "Encours autorisé", assurance_credit: 'Assurance crédit',
  famille: 'Famille', frais_facturation: 'Frais de facturation', releve_facture: 'Relevé de facture',
  type_facture: 'Type de facture', capacite_expiration: 'Capacité expiration',
}
function formatCellValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Colonnes d'export pour l'onglet Comparaison : reprend l'ensemble des
 * champs SAGE ↔ BLG déjà renvoyés par la RPC get_controle_tiers_sage_blg
 * (les mêmes que ceux affichés dans le panneau "Comparaison détaillée"). */
const EXPORT_COLONNES_COMPARAISON: Array<{ key: keyof ControleRow; label: string; transform?: (r: ControleRow) => string }> = [
  { key: 'numero_tiers', label: 'N° tiers' },
  { key: 'statut_appariement', label: 'Statut appariement', transform: (r) => (r.statut_appariement === 'apparie' ? 'Apparié' : 'Manquant BLG') },
  { key: 'champs_en_ecart', label: 'Nb champs en écart', transform: (r) => String(r.champs_en_ecart?.length ?? 0) },
  { key: 'champs_en_ecart', label: 'Champs en écart (détail)', transform: (r) => (r.champs_en_ecart || []).join(', ') },
  { key: 'sage_intitule', label: 'Intitulé (SAGE)' },
  { key: 'blg_intitule', label: 'Intitulé (BLG)' },
  { key: 'sage_qualite', label: 'Qualité (SAGE)' },
  { key: 'blg_tags', label: 'Qualité / tags (BLG)', transform: (r) => formatCellValue(r.blg_tags) },
  { key: 'sage_siret', label: 'SIRET (SAGE)' },
  { key: 'blg_siret', label: 'SIRET (BLG)' },
  { key: 'sage_code_naf', label: 'Code NAF (SAGE)' },
  { key: 'blg_code_naf', label: 'Code NAF (BLG)' },
  { key: 'sage_code_postal', label: 'Code postal (SAGE)' },
  { key: 'blg_code_postal', label: 'Code postal (BLG)' },
  { key: 'sage_ville', label: 'Ville (SAGE)' },
  { key: 'blg_ville', label: 'Ville (BLG)' },
  { key: 'sage_representant', label: 'Représentant (SAGE)' },
  { key: 'blg_commercial', label: 'Commercial (BLG)' },
  { key: 'sage_encours', label: 'Encours autorisé (SAGE)', transform: (r) => formatCellValue(r.sage_encours) },
  { key: 'blg_encours', label: 'Encours (BLG)', transform: (r) => formatCellValue(r.blg_encours) },
  { key: 'sage_assurance_credit', label: 'Assurance crédit (SAGE)', transform: (r) => formatCellValue(r.sage_assurance_credit) },
  { key: 'blg_assurance_credit', label: 'Assurance crédit (BLG)', transform: (r) => formatCellValue(r.blg_assurance_credit) },
  { key: 'sage_famille', label: 'Famille (SAGE)' },
  { key: 'blg_famille', label: 'Famille (BLG)' },
  { key: 'sage_frais_facturation', label: 'Frais de facturation (SAGE)' },
  { key: 'blg_frais_facturation', label: 'Frais de facturation (BLG)' },
  { key: 'sage_routage_promo', label: 'Routage promo (SAGE)' },
  { key: 'blg_routage_promo', label: 'Routage promo (BLG)' },
  { key: 'sage_facture_email', label: 'Facture électronique (SAGE)' },
  { key: 'blg_facture_electronique', label: 'Facture électronique (BLG)' },
  { key: 'sage_releve_facture', label: 'Relevé de facture (SAGE)' },
  { key: 'blg_releve_facture', label: 'Relevé de facture (BLG)' },
  { key: 'sage_type_facture', label: 'Type de facture (SAGE)' },
  { key: 'blg_type_facture', label: 'Type de facture (BLG)' },
  { key: 'sage_capacite_expiration', label: 'Capacité expiration (SAGE)' },
  { key: 'blg_capacite_expiration', label: 'Capacité expiration (BLG)' },
  { key: 'sage_mise_en_sommeil', label: 'Mise en sommeil (SAGE)', transform: (r) => formatCellValue(r.sage_mise_en_sommeil) },
  { key: 'blg_est_entite_interne', label: 'Entité interne (BLG)', transform: (r) => formatCellValue(r.blg_est_entite_interne) },
  { key: 'blg_est_adresse_livraison', label: 'Adresse de livraison uniquement (BLG)', transform: (r) => formatCellValue(r.blg_est_adresse_livraison) },
  { key: 'sage_contact', label: 'Contact (SAGE)' },
  { key: 'blg_contact_principal', label: 'Contact principal (BLG)' },
  { key: 'blg_contacts_resume', label: 'Contacts (BLG)' },
  { key: 'blg_nb_contacts', label: 'Nb contacts (BLG)', transform: (r) => formatCellValue(r.blg_nb_contacts) },
  { key: 'sage_agence_rattachement', label: 'Agence de rattachement (SAGE)' },
  { key: 'blg_iban', label: 'IBAN (BLG)' },
  { key: 'blg_banque', label: 'Banque (BLG)' },
  { key: 'sage_abrege', label: 'Abrégé (SAGE)' },
  { key: 'blg_nom_court', label: 'Nom court (BLG)' },
  { key: 'blg_id_tiers', label: 'ID tiers (BLG, brut)' },
  { key: 'blg_partner_id', label: 'Partner ID (BLG)', transform: (r) => formatCellValue(r.blg_partner_id) },
  { key: 'sage_updated_at', label: 'Dernière mise à jour (SAGE)' },
  { key: 'blg_last_update', label: 'Dernière mise à jour (BLG)' },
]

// ─────────────────────────────────────────────────────────────────────────
// Onglet BLG (lecture seule côté BLG, pour les tiers déjà appariés)
// ─────────────────────────────────────────────────────────────────────────

const BLG_DETAIL_FIELDS: Array<{ key: keyof ControleRow; label: string }> = [
  { key: 'blg_intitule', label: 'Intitulé' },
  { key: 'blg_siret', label: 'SIRET' },
  { key: 'blg_code_naf', label: 'Code NAF' },
  { key: 'blg_ville', label: 'Ville' },
  { key: 'blg_code_postal', label: 'Code postal' },
  { key: 'blg_commercial', label: 'Commercial' },
  { key: 'blg_famille', label: 'Famille' },
  { key: 'blg_encours', label: 'Encours' },
  { key: 'blg_assurance_credit', label: 'Assurance crédit' },
  { key: 'blg_frais_facturation', label: 'Frais de facturation' },
  { key: 'blg_routage_promo', label: 'Routage promo' },
  { key: 'blg_facture_electronique', label: 'Facture électronique' },
  { key: 'blg_releve_facture', label: 'Relevé de facture' },
  { key: 'blg_type_facture', label: 'Type de facture' },
  { key: 'blg_capacite_expiration', label: 'Capacité expiration' },
  { key: 'blg_contact_principal', label: 'Contact principal' },
  { key: 'blg_nb_contacts', label: 'Nb contacts' },
  { key: 'blg_contacts_resume', label: 'Contacts' },
  { key: 'blg_iban', label: 'IBAN' },
  { key: 'blg_banque', label: 'Banque' },
  { key: 'blg_nom_court', label: 'Nom court' },
  { key: 'blg_tags', label: 'Tags / qualité' },
  { key: 'blg_last_update', label: 'Dernière mise à jour BLG' },
]

function OngletBlg() {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ControleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ControleRow | null>(null)
  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase.rpc('get_controle_tiers_sage_blg', {
        p_statut: 'apparie', p_only_ecarts: false, p_champ: null,
        p_search: search.trim() || null, p_limit: 500, p_offset: 0,
        p_exclure_sommeil: true, p_filtres: [], p_combinateur: 'ET',
      })
      if (cancelled) return
      if (err) setError(err.message)
      else { setRows((data || []) as ControleRow[]); setError(null) }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [search])

  function getIndexBlg(list: ControleRow[], sel: ControleRow | null) {
    if (!sel) return -1
    return list.findIndex((r) => r.numero_tiers === sel.numero_tiers)
  }
  const onListKeyDown = creerHandlerNavigation(rows, selected, setSelected, getIndexBlg, listRefs)

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un n° tiers ou une raison sociale (côté BLG)…"
          className="h-10 w-full max-w-md rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A]"
        />
        <p className="mt-2 text-[12px] text-[#8A8474]">Limité aux tiers déjà appariés avec BLG — voir l&rsquo;onglet Comparaison pour les tiers manquants côté BLG.</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{loading ? 'Chargement…' : `${rows.length} résultat${rows.length > 1 ? 's' : ''}`}</div>
            {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
          </div>
          <div
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50"
          >
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                <tr><th className="px-3 py-2 font-bold">N° tiers</th><th className="px-3 py-2 font-bold">Ville</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.numero_tiers} ref={(el) => { listRefs.current[i] = el }} onClick={() => setSelected(r)}
                    className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${selected?.numero_tiers === r.numero_tiers ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</div>
                      <div className="truncate text-[12px] text-[#111820]">{r.blg_intitule || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-[#3A362E]">{r.blg_ville || '—'}</td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Fiche BLG</div>
          {!selected ? (
            <div className="flex h-64 items-center justify-center text-center text-[13px] text-[#8A8474]">Sélectionne un tiers dans la liste pour voir sa fiche BLG.</div>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between border-b border-[#E5E1D8] pb-3">
                <div>
                  <div className="font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero_tiers}</div>
                  <div className="text-[15px] font-bold text-[#111820]">{selected.blg_intitule || '—'}</div>
                </div>
                {selected.blg_partner_id && (
                  <a href={`https://app.blgcloud.com/cegeclim-test/?app/crm/company/${selected.blg_partner_id}#`} target="_blank" rel="noopener noreferrer"
                    className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>
                )}
              </div>
              <div className="space-y-0.5">
                {BLG_DETAIL_FIELDS.map((f) => (
                  <div key={String(f.key)} className="grid grid-cols-[1fr_1.4fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] odd:bg-[#F4F3F0]/60">
                    <span className="font-semibold text-[#3A362E]">{f.label}</span>
                    <span className="text-[#111820]">{formatCellValue(selected[f.key])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Comparaison — logique de contrôle SAGE ↔ BLG restaurée telle quelle
// ─────────────────────────────────────────────────────────────────────────

function OngletComparaison() {
  const [domaine, setDomaine] = useState<Domaine>('client')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<ControleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState<'tous' | 'apparie' | 'manquant_blg'>('tous')
  const [onlyEcarts, setOnlyEcarts] = useState(false)
  const [champFilter, setChampFilter] = useState<string | null>(null)
  const [exclureSommeil, setExclureSommeil] = useState(true)
  const [conditions, setConditions] = useState<FiltreCondition[]>([])
  const [logiqueConditions, setLogiqueConditions] = useState<'et' | 'ou'>('et')

  const [selected, setSelected] = useState<ControleRow | null>(null)
  const [selectedSageFull, setSelectedSageFull] = useState<Record<string, unknown>>({})
  const [selectedBlgFull, setSelectedBlgFull] = useState<Record<string, unknown>>({})
  const [loadingSelected, setLoadingSelected] = useState(false)

  const [showMapping, setShowMapping] = useState(false)
  const [inventaire, setInventaire] = useState<ChampInventaire[]>([])
  const [mapping, setMapping] = useState<ChampMapping[]>([])
  const [loadingMapping, setLoadingMapping] = useState(false)

  const [syncLoading, setSyncLoading] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([])
  const [showSyncLog, setShowSyncLog] = useState(false)

  const [exportEnCours, setExportEnCours] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ done: number } | null>(null)

  const listRefs = useRef<Record<number, HTMLTableRowElement | null>>({})

  const conditionsValides = useMemo(
    () => conditions.filter((c) => c.champ && (c.operateur === 'est_vide' || c.operateur === 'non_vide' || c.valeur.trim() !== '')),
    [conditions]
  )

  useEffect(() => { void loadMappingPanel() }, [])
  useEffect(() => { void loadSummary(); void loadRows() }, [search, statutFilter, onlyEcarts, champFilter, exclureSommeil, conditionsValides, logiqueConditions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected || selected.statut_appariement !== 'apparie' || !selected.blg_partner_id) {
      setSelectedSageFull({}); setSelectedBlgFull({})
      return
    }
    setLoadingSelected(true)
    Promise.all([
      supabase.rpc('get_tiers_sage_full', { p_numero: selected.numero_tiers }),
      supabase.rpc('get_tiers_blg_full', { p_partner_id: selected.blg_partner_id }),
    ]).then(([{ data: sage }, { data: blg }]) => {
      setSelectedSageFull((sage as Record<string, unknown>) || {})
      setSelectedBlgFull((blg as Record<string, unknown>) || {})
      setLoadingSelected(false)
    })
  }, [selected])

  function filtreParams() {
    return {
      p_exclure_sommeil: exclureSommeil,
      p_filtres: conditionsValides.map((c) => ({ cote: c.cote, champ: c.champ, operateur: c.operateur, valeur: c.valeur })),
      p_combinateur: logiqueConditions.toUpperCase(),
    }
  }

  async function loadSummary() {
    setLoadingSummary(true)
    const { data, error: err } = await supabase.rpc('get_controle_tiers_summary', {
      p_statut: statutFilter === 'tous' ? null : statutFilter,
      p_only_ecarts: onlyEcarts, p_champ: champFilter, p_search: search.trim() || null,
      ...filtreParams(),
    })
    if (err) setError(err.message)
    else setSummary(Array.isArray(data) ? data[0] : data)
    setLoadingSummary(false)
  }

  async function loadRows() {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('get_controle_tiers_sage_blg', {
      p_statut: statutFilter === 'tous' ? null : statutFilter,
      p_only_ecarts: onlyEcarts, p_champ: champFilter, p_search: search.trim() || null,
      p_limit: 300, p_offset: 0,
      ...filtreParams(),
    })
    if (err) setError(err.message)
    else { setRows((data || []) as ControleRow[]); setError(null) }
    setLoading(false)
  }

  async function loadMappingPanel() {
    setLoadingMapping(true)
    const [{ data: inv }, { data: map }] = await Promise.all([
      supabase.rpc('get_champ_inventaire_client'),
      supabase.from('champ_mapping_sage_blg').select('*').eq('domaine', 'client').order('type_comparaison').order('champ_sage'),
    ])
    setInventaire((inv || []) as ChampInventaire[])
    setMapping((map || []) as ChampMapping[])
    setLoadingMapping(false)
  }

  function toggleMappingPanel() { setShowMapping((v) => !v) }

  const blgInventaire = useMemo(() => inventaire.filter((c) => c.cote === 'blg'), [inventaire])
  const sageInventaire = useMemo(() => inventaire.filter((c) => c.cote === 'sage'), [inventaire])

  function valuesDiffer(a: unknown, b: unknown): boolean {
    const na = normalizeForCompare(a)
    const nb = normalizeForCompare(b)
    if (na === '' || nb === '') return false
    return na !== nb
  }
  function normalizeForCompare(v: unknown): string {
    if (v === null || v === undefined) return ''
    if (typeof v === 'boolean') return v ? 'oui' : 'non'
    if (Array.isArray(v)) return v.map(String).join(',').toUpperCase().replace(/\s+/g, ' ').trim()
    return String(v).toUpperCase().replace(/\s+/g, ' ').trim()
  }

  const mappedFields = useMemo(() => mapping.filter((m) => m.champ_blg), [mapping])
  const unmappedFields = useMemo(() => mapping.filter((m) => !m.champ_blg), [mapping])

  async function lancerSynchro() {
    setSyncLoading(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/blg-sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setSyncMessage(`Erreur : ${data.error || res.statusText}`)
      else setSyncMessage('Synchro lancée sur le VPS — ça prend en général 1 à quelques minutes selon les écarts à rattraper.')
    } catch (e) {
      setSyncMessage(`Impossible de joindre le serveur de synchro : ${(e as Error).message}`)
    }
    setSyncLoading(false)
  }

  async function verifierSynchro() {
    const { data } = await supabase.rpc('get_last_sync_status')
    setSyncLog((data || []) as SyncLogEntry[])
    setShowSyncLog(true)
    void loadSummary()
    void loadRows()
  }

  /** Export Excel : rapatrie TOUTES les lignes correspondant aux filtres
   * actuels de l'onglet Comparaison (statut, écarts, champ, recherche,
   * conditions avancées), paginé par 500 via la même RPC que la liste,
   * puis génère un .xlsx avec l'ensemble des champs SAGE ↔ BLG comparés
   * (EXPORT_COLONNES_COMPARAISON). */
  async function exporterExcelComparaison() {
    setExportEnCours(true)
    setExportProgress({ done: 0 })
    try {
      const toutes: ControleRow[] = []
      let offset = 0
      const pageSize = 500
      while (true) {
        const { data, error: err } = await supabase.rpc('get_controle_tiers_sage_blg', {
          p_statut: statutFilter === 'tous' ? null : statutFilter,
          p_only_ecarts: onlyEcarts, p_champ: champFilter, p_search: search.trim() || null,
          p_limit: pageSize, p_offset: offset,
          ...filtreParams(),
        })
        if (err) throw err
        const batch = (data || []) as ControleRow[]
        toutes.push(...batch)
        setExportProgress({ done: toutes.length })
        if (batch.length < pageSize) break
        offset += pageSize
      }

      const feuille = toutes.map((r) => {
        const ligne: Record<string, string> = {}
        EXPORT_COLONNES_COMPARAISON.forEach((c) => {
          ligne[c.label] = c.transform ? c.transform(r) : safeText(r[c.key])
        })
        return ligne
      })

      const ws = XLSX.utils.json_to_sheet(feuille)
      ws['!cols'] = EXPORT_COLONNES_COMPARAISON.map(() => ({ wch: 22 }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Comparaison SAGE-BLG')
      XLSX.writeFile(wb, `comparaison_sage_blg_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      alert('Erreur export Excel : ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportEnCours(false)
      setExportProgress(null)
    }
  }

  function getIndexComparaison(list: ControleRow[], sel: ControleRow | null) {
    if (!sel) return -1
    return list.findIndex((r) => r.numero_tiers === sel.numero_tiers)
  }
  const onListKeyDown = creerHandlerNavigation(rows, selected, setSelected, getIndexComparaison, listRefs)

  const champsTries = useMemo(() => {
    if (!summary) return []
    return Object.entries(summary.par_champ).sort((a, b) => b[1] - a[1]).map(([champ, nb]) => ({ champ, nb, label: CHAMP_LABELS[champ] || champ }))
  }, [summary])

  return (
    <>
      <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Migration BLG</p>
            <h2 className="mt-0.5 text-[22px] font-bold tracking-tight text-[#111820]">Contrôle de cohérence SAGE ↔ BLG</h2>
            <p className="mt-1 text-[13px] text-[#8A8474]">Compare les données des deux systèmes, domaine par domaine, pour préparer la bascule.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button type="button" onClick={() => void lancerSynchro()} disabled={syncLoading}
              className="rounded-lg bg-[#111820] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60">
              {syncLoading ? 'Lancement…' : '↻ Lancer la synchro BLG'}
            </button>
            <button type="button" onClick={() => void verifierSynchro()} className="text-[12px] font-semibold text-[#B4761A] hover:underline">
              Vérifier l'état de la dernière synchro
            </button>
          </div>
        </div>

        {syncMessage && <div className="mt-3 rounded-lg border border-[#B4761A]/25 bg-[#B4761A]/[0.06] px-3 py-2.5 text-[13px] font-semibold text-[#5A4321]">{syncMessage}</div>}

        {showSyncLog && (
          <div className="mt-3 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Dernières synchros (10 plus récentes)</div>
              <button type="button" onClick={() => setShowSyncLog(false)} className="text-[12px] font-bold text-[#8A8474] hover:text-[#111820]">Fermer</button>
            </div>
            <div className="space-y-1 text-[12px]">
              {syncLog.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded bg-white px-2 py-1">
                  <span className="font-semibold text-[#3A362E]">{l.table_name}</span>
                  <span className="text-[#8A8474]">{l.rows_synced} lignes</span>
                  <span className={l.status === 'ok' ? 'font-bold text-emerald-700' : 'font-bold text-red-600'}>{l.status}</span>
                  <span className="text-[#8A8474]">{new Date(l.finished_at).toLocaleString('fr-FR')}</span>
                </div>
              ))}
              {syncLog.length === 0 && <p className="text-[#8A8474]">Aucune donnée.</p>}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <DomaineTab active={domaine === 'client'} onClick={() => setDomaine('client')} label="Fiche client" />
            <DomaineTab active={false} disabled label="Fiche article" note="bientôt" />
            <DomaineTab active={false} disabled label="Devis" note="bientôt" />
            <DomaineTab active={false} disabled label="Factures" note="bientôt" />
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 py-2 text-[13px] font-bold text-[#3A362E]">
            <input type="checkbox" checked={exclureSommeil} onChange={(e) => setExclureSommeil(e.target.checked)} className="accent-[#B4761A]" />
            Exclure les tiers en sommeil (SAGE)
          </label>
        </div>
      </section>

      {domaine !== 'client' ? (
        <section className="rounded-xl border border-dashed border-[#E5E1D8] bg-white p-12 text-center">
          <p className="text-[15px] font-bold text-[#3A362E]">Domaine pas encore disponible</p>
          <p className="mt-1 text-[13px] text-[#8A8474]">Le rapprochement pour ce domaine sera ajouté dans une prochaine étape.</p>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Tiers SAGE" value={summary?.total_sage ?? 0} loading={loadingSummary} />
            <KpiCard label="Appariés avec BLG" value={summary?.apparies ?? 0} loading={loadingSummary} />
            <KpiCard label="Manquants côté BLG" value={summary?.manquants_blg ?? 0} loading={loadingSummary} tone="warn" />
            <KpiCard label="Sans écart" value={summary?.sans_ecart ?? 0} loading={loadingSummary} tone="ok" />
            <KpiCard label="Avec au moins un écart" value={summary?.avec_ecart ?? 0} loading={loadingSummary} tone="warn" />
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Champs les plus fréquemment en écart (comparaison automatique)</div>
            {loadingSummary ? (
              <div className="h-16 animate-pulse rounded bg-[#F4F3F0]" />
            ) : champsTries.length === 0 ? (
              <p className="text-[13px] text-[#8A8474]">Aucun écart détecté.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {champsTries.map(({ champ, nb, label }) => (
                  <button key={champ} type="button" onClick={() => setChampFilter(champFilter === champ ? null : champ)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                      champFilter === champ ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#96600F]' : 'border-[#E5E1D8] bg-[#F4F3F0] text-[#3A362E] hover:bg-[#EDEAE1]'
                    }`}>
                    <span>{label}</span>
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#8A8474]">{nb}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[12px] text-[#8A8474]">Clique sur un champ pour ne voir que les tiers concernés.</p>
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <button type="button" onClick={toggleMappingPanel} className="flex w-full items-center justify-between text-left">
              <div>
                <div className="text-[13px] font-bold text-[#111820]">Mapping des champs (SAGE ↔ BLG)</div>
                <p className="text-[12px] text-[#8A8474]">Choisis un client exemple, clique un champ SAGE puis le champ BLG correspondant pour les associer.</p>
              </div>
              <span className="text-[#8A8474]">{showMapping ? '▲' : '▼'}</span>
            </button>
            {showMapping && (
              <div className="mt-4">
                {loadingMapping ? <div className="h-32 animate-pulse rounded bg-[#F4F3F0]" /> : (
                  <MappingBuilder mapping={mapping} blgInventaire={blgInventaire} onMappingChange={setMapping} />
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <div className="grid gap-2 md:grid-cols-4">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un n° tiers ou une raison sociale…"
                className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A] md:col-span-2" />
              <select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value as typeof statutFilter)}
                className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                <option value="tous">Statut : Tous</option>
                <option value="apparie">Apparié avec BLG</option>
                <option value="manquant_blg">Manquant côté BLG</option>
              </select>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-semibold text-[#3A362E]">
                <input type="checkbox" checked={onlyEcarts} onChange={(e) => setOnlyEcarts(e.target.checked)} className="accent-[#B4761A]" />
                Avec écart uniquement
              </label>
            </div>
            {champFilter && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-[#8A8474]">
                Filtré sur : <span className="font-bold text-[#96600F]">{CHAMP_LABELS[champFilter] || champFilter}</span>
                <button type="button" onClick={() => setChampFilter(null)} className="font-bold text-[#B4761A] hover:underline">Retirer</button>
              </div>
            )}

            <div className="mt-3 border-t border-[#E5E1D8] pt-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Filtres avancés</div>
                {conditions.length >= 2 && (
                  <div className="flex items-center gap-1 text-[12px] font-semibold text-[#3A362E]">
                    Combiner avec :
                    <button type="button" onClick={() => setLogiqueConditions('et')} className={`rounded px-2 py-0.5 ${logiqueConditions === 'et' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>ET</button>
                    <button type="button" onClick={() => setLogiqueConditions('ou')} className={`rounded px-2 py-0.5 ${logiqueConditions === 'ou' ? 'bg-[#111820] text-white' : 'bg-[#F4F3F0]'}`}>OU</button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {conditions.map((c) => (
                  <div key={c.id} className="grid grid-cols-[110px_1fr_160px_1fr_32px] gap-2">
                    <select value={c.cote} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, cote: e.target.value as 'sage' | 'blg', champ: '' } : x))}
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]">
                      <option value="sage">SAGE</option>
                      <option value="blg">BLG</option>
                    </select>
                    <select value={c.champ} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, champ: e.target.value } : x))}
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]">
                      <option value="">Champ…</option>
                      {(c.cote === 'sage' ? sageInventaire : blgInventaire).map((col) => (
                        <option key={col.colonne} value={col.colonne}>{col.colonne}</option>
                      ))}
                    </select>
                    <select value={c.operateur} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, operateur: e.target.value as Operateur } : x))}
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E]">
                      {(Object.entries(OPERATEUR_LABELS) as [Operateur, string][]).map(([op, label]) => (
                        <option key={op} value={op}>{label}</option>
                      ))}
                    </select>
                    <input value={c.valeur} onChange={(e) => setConditions((prev) => prev.map((x) => x.id === c.id ? { ...x, valeur: e.target.value } : x))}
                      disabled={c.operateur === 'est_vide' || c.operateur === 'non_vide'} placeholder="Valeur…"
                      className="h-9 rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12px] font-medium outline-none focus:border-[#B4761A] disabled:bg-[#F4F3F0]" />
                    <button type="button" onClick={() => setConditions((prev) => prev.filter((x) => x.id !== c.id))}
                      className="flex h-9 items-center justify-center rounded-lg border border-[#E5E1D8] text-[#8A8474] hover:border-red-300 hover:text-red-600">✕</button>
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => setConditions((prev) => [...prev, nouvelleCondition()])}
                className="mt-2 text-[12px] font-bold text-[#B4761A] hover:underline">+ Ajouter une condition</button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E1D8] pt-3">
              <span className="text-[12px] text-[#8A8474]">
                {exportProgress ? `Export en cours… ${exportProgress.done} client${exportProgress.done > 1 ? 's' : ''} récupéré${exportProgress.done > 1 ? 's' : ''}` : '\u00A0'}
              </span>
              <button
                type="button"
                onClick={() => void exporterExcelComparaison()}
                disabled={exportEnCours || loading}
                className="rounded-lg bg-[#111820] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportEnCours ? 'Export en cours…' : '⬇ Exporter en Excel (tous les champs SAGE + BLG)'}
              </button>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{loading ? 'Chargement…' : `${rows.length} résultat${rows.length > 1 ? 's' : ''}`}</div>
                {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
              </div>
              <div
                tabIndex={0}
                onKeyDown={onListKeyDown}
                className="max-h-[760px] overflow-auto rounded-lg border border-[#E5E1D8] outline-none focus-visible:ring-2 focus-visible:ring-[#B4761A]/50"
              >
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                    <tr><th className="px-3 py-2 font-bold">N° tiers</th><th className="px-3 py-2 font-bold">Statut</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.numero_tiers} ref={(el) => { listRefs.current[i] = el }} onClick={() => setSelected(r)}
                        className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${selected?.numero_tiers === r.numero_tiers ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</div>
                          <div className="truncate text-[12px] text-[#111820]">{r.sage_intitule || r.blg_intitule || '—'}</div>
                        </td>
                        <td className="px-3 py-2">
                          {r.statut_appariement === 'manquant_blg' ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Manquant BLG</span>
                          ) : r.champs_en_ecart.length === 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">OK</span>
                          ) : (
                            <span className="rounded-full bg-[#B4761A]/[0.1] px-2 py-0.5 text-[11px] font-bold text-[#96600F]">{r.champs_en_ecart.length} écart{r.champs_en_ecart.length > 1 ? 's' : ''}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!loading && rows.length === 0 && <tr><td colSpan={2} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Comparaison détaillée (tous les champs mappés)</div>
              {!selected ? (
                <div className="flex h-64 items-center justify-center text-center text-[13px] text-[#8A8474]">Sélectionne un tiers dans la liste pour voir le détail champ par champ.</div>
              ) : (
                <div>
                  <div className="mb-3 flex items-center justify-between border-b border-[#E5E1D8] pb-3">
                    <div>
                      <div className="font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero_tiers}</div>
                      <div className="text-[15px] font-bold text-[#111820]">{selected.sage_intitule || selected.blg_intitule}</div>
                    </div>
                    {selected.blg_partner_id && (
                      <a href={`https://app.blgcloud.com/cegeclim-test/?app/crm/company/${selected.blg_partner_id}#`} target="_blank" rel="noopener noreferrer"
                        className="text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>
                    )}
                  </div>

                  {selected.statut_appariement === 'manquant_blg' ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] font-semibold text-red-700">
                      Ce tiers n'a pas de correspondance identifiée côté BLG (`blg_id_tiers` non renseigné ou introuvable).
                    </div>
                  ) : loadingSelected ? (
                    <div className="h-64 animate-pulse rounded-lg bg-[#F4F3F0]" />
                  ) : (
                    <div className="max-h-[720px] overflow-auto">
                      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
                        <span>Champ</span><span>SAGE</span><span>BLG</span>
                      </div>
                      <div className="space-y-0.5">
                        {mappedFields.map((m) => {
                          const sageVal = selectedSageFull[m.champ_sage]
                          const blgVal = selectedBlgFull[m.champ_blg as string]
                          const isEcart = m.type_comparaison !== 'affichage_seul' && valuesDiffer(sageVal, blgVal)
                          return (
                            <div key={m.id} className={`grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] ${isEcart ? 'bg-[#B4761A]/[0.08]' : ''}`}>
                              <span className="font-semibold text-[#3A362E]">{m.label || m.champ_sage}</span>
                              <span className={isEcart ? 'font-bold text-[#96600F]' : 'text-[#111820]'}>{formatCellValue(sageVal)}</span>
                              <span className={isEcart ? 'font-bold text-[#96600F]' : 'text-[#111820]'}>{formatCellValue(blgVal)}</span>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-4 border-t border-[#E5E1D8] pt-2">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Champs SAGE non mappés côté BLG ({unmappedFields.length})</div>
                        <div className="space-y-0.5">
                          {unmappedFields.map((m) => (
                            <div key={m.id} className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1 text-[13px] opacity-70">
                              <span className="font-semibold text-[#3A362E]">{m.label || m.champ_sage}</span>
                              <span className="text-[#111820]">{formatCellValue(selectedSageFull[m.champ_sage])}</span>
                              <span className="text-[#B3AD9E]">— non mappé —</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}

function DomaineTab({ active, disabled, onClick, label, note }: { active: boolean; disabled?: boolean; onClick?: () => void; label: string; note?: string }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-bold transition-colors ${
        active ? 'border-[#111820] bg-[#111820] text-white' : disabled ? 'cursor-not-allowed border-[#E5E1D8] bg-[#F4F3F0] text-[#B3AD9E]' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'
      }`}>
      {label}
      {note && <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">{note}</span>}
    </button>
  )
}

function MappingBuilder({
  mapping, blgInventaire, onMappingChange,
}: { mapping: ChampMapping[]; blgInventaire: ChampInventaire[]; onMappingChange: (m: ChampMapping[]) => void }) {
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<{ numero_tiers: string; blg_partner_id: number | null; sage_intitule: string | null }[]>([])
  const [selectedClient, setSelectedClient] = useState<{ numero: string; partnerId: number } | null>(null)
  const [sageValues, setSageValues] = useState<Record<string, unknown>>({})
  const [blgValues, setBlgValues] = useState<Record<string, unknown>>({})
  const [loadingClient, setLoadingClient] = useState(false)
  const [pendingSageField, setPendingSageField] = useState<string | null>(null)

  useEffect(() => {
    const q = clientSearch.trim()
    if (q.length < 2) { setClientResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('get_controle_tiers_sage_blg', {
        p_statut: 'apparie', p_only_ecarts: false, p_champ: null, p_search: q, p_limit: 8, p_offset: 0,
      })
      setClientResults(((data || []) as ControleRow[]).map((r) => ({ numero_tiers: r.numero_tiers, blg_partner_id: r.blg_partner_id, sage_intitule: r.sage_intitule })))
    }, 200)
    return () => clearTimeout(t)
  }, [clientSearch])

  async function pickClient(numero: string, partnerId: number | null) {
    if (!partnerId) return
    setSelectedClient({ numero, partnerId })
    setClientResults([])
    setClientSearch('')
    setPendingSageField(null)
    setLoadingClient(true)
    const [{ data: sage }, { data: blg }] = await Promise.all([
      supabase.rpc('get_tiers_sage_full', { p_numero: numero }),
      supabase.rpc('get_tiers_blg_full', { p_partner_id: partnerId }),
    ])
    setSageValues((sage as Record<string, unknown>) || {})
    setBlgValues((blg as Record<string, unknown>) || {})
    setLoadingClient(false)
  }

  async function setChampBlg(row: ChampMapping, champBlg: string | null) {
    const next = mapping.map((m) => (m.id === row.id ? { ...m, champ_blg: champBlg, type_comparaison: champBlg ? ('manuel' as const) : m.type_comparaison } : m))
    onMappingChange(next)
    await supabase.from('champ_mapping_sage_blg').update({ champ_blg: champBlg }).eq('id', row.id)
  }

  function handleSageClick(m: ChampMapping) {
    if (pendingSageField === m.champ_sage) { setPendingSageField(null); return }
    setPendingSageField(m.champ_sage)
  }
  function handleBlgClick(colonne: string) {
    if (!pendingSageField) return
    const row = mapping.find((m) => m.champ_sage === pendingSageField)
    if (row) void setChampBlg(row, colonne)
    setPendingSageField(null)
  }

  const mappedRows = mapping.filter((m) => m.champ_blg)
  const unmappedRows = mapping.filter((m) => !m.champ_blg)
  const blgUsed = new Set(mapping.map((m) => m.champ_blg).filter(Boolean) as string[])
  const blgAvailable = blgInventaire.filter((c) => !blgUsed.has(c.colonne))

  return (
    <div>
      <div className="relative mb-4">
        <input
          value={selectedClient ? `${selectedClient.numero}` : clientSearch}
          onChange={(e) => { setClientSearch(e.target.value); setSelectedClient(null) }}
          placeholder="Rechercher un client exemple (n° tiers ou raison sociale)…"
          className="h-10 w-full max-w-md rounded-lg border border-[#E5E1D8] bg-white px-3 text-sm font-medium outline-none focus:border-[#B4761A]"
        />
        {clientResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-w-md rounded-lg border border-[#E5E1D8] bg-white shadow-lg">
            {clientResults.map((c) => (
              <button key={c.numero_tiers} type="button" onClick={() => void pickClient(c.numero_tiers, c.blg_partner_id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-[#F4F3F0]">
                <span className="font-mono text-[12px] text-[#8A8474]">{c.numero_tiers}</span>
                <span className="text-[#111820]">{c.sage_intitule || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedClient ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[#E5E1D8] text-center text-[13px] text-[#8A8474]">
          Choisis un client ci-dessus pour voir ses valeurs et construire le mapping.
        </div>
      ) : loadingClient ? (
        <div className="h-40 animate-pulse rounded-lg bg-[#F4F3F0]" />
      ) : (
        <>
          {pendingSageField && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-[#B4761A]/30 bg-[#B4761A]/[0.08] px-3 py-2 text-[13px] font-semibold text-[#96600F]">
              <span>Champ SAGE sélectionné : <span className="font-mono">{pendingSageField}</span> — clique un champ BLG à droite pour l'associer.</span>
              <button type="button" onClick={() => setPendingSageField(null)} className="font-bold hover:underline">Annuler</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-b border-[#E5E1D8] pb-2 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
            <span>SAGE</span><span>BLG</span>
          </div>

          <div className="max-h-[420px] overflow-auto">
            {mappedRows.map((m) => {
              const isPending = pendingSageField === m.champ_sage
              return (
                <div key={m.id} className="grid grid-cols-2 gap-3 border-b border-[#F4F3F0] py-1.5">
                  <button type="button" onClick={() => handleSageClick(m)}
                    className={`flex items-center justify-between rounded px-2 py-1 text-left text-[13px] transition-colors ${isPending ? 'bg-[#B4761A]/[0.15]' : 'hover:bg-[#F4F3F0]'}`}>
                    <span className="font-semibold text-[#3A362E]">{m.label || m.champ_sage}</span>
                    <span className="ml-2 truncate text-[#111820]">{formatCellValue(sageValues[m.champ_sage])}</span>
                  </button>
                  <div className="flex items-center justify-between rounded bg-emerald-50/60 px-2 py-1 text-[13px]">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-emerald-700">{m.champ_blg}</span>
                      <span className="truncate text-[#111820]">{formatCellValue(blgValues[m.champ_blg as string])}</span>
                    </span>
                    <button type="button" onClick={() => void setChampBlg(m, null)} title="Dissocier" className="ml-2 shrink-0 text-[11px] font-bold text-[#8A8474] hover:text-red-600">✕</button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Champs SAGE non mappés ({unmappedRows.length})</div>
              <div className="max-h-[320px] space-y-0.5 overflow-auto rounded-lg border border-[#E5E1D8] p-1">
                {unmappedRows.map((m) => {
                  const isPending = pendingSageField === m.champ_sage
                  return (
                    <button key={m.id} type="button" onClick={() => handleSageClick(m)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] transition-colors ${isPending ? 'bg-[#B4761A]/[0.15]' : 'hover:bg-[#F4F3F0]'}`}>
                      <span className="font-semibold text-[#3A362E]">{m.label || m.champ_sage}</span>
                      <span className="ml-2 truncate text-[#8A8474]">{formatCellValue(sageValues[m.champ_sage])}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Champs BLG disponibles ({blgAvailable.length})</div>
              <div className={`max-h-[320px] space-y-0.5 overflow-auto rounded-lg border p-1 ${pendingSageField ? 'border-[#B4761A]' : 'border-[#E5E1D8]'}`}>
                {blgAvailable.map((c) => (
                  <button key={c.colonne} type="button" onClick={() => handleBlgClick(c.colonne)} disabled={!pendingSageField}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] transition-colors ${pendingSageField ? 'hover:bg-[#B4761A]/[0.1]' : 'cursor-default'}`}>
                    <span className="font-mono text-[11px] text-[#3A362E]">{c.colonne}</span>
                    <span className="ml-2 truncate text-[#8A8474]">{formatCellValue(blgValues[c.colonne])}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page principale : bascule entre les 3 onglets
// ─────────────────────────────────────────────────────────────────────────

type OngletPrincipal = 'sage' | 'blg' | 'comparaison'

export default function ClientsSageBlgPage() {
  const [onglet, setOnglet] = useState<OngletPrincipal>('sage')

  return (
    <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Référentiel clients</p>
          <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-[#111820]">Clients SAGE / BLG</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <OngletTab active={onglet === 'sage'} onClick={() => setOnglet('sage')} label="SAGE" />
            <OngletTab active={onglet === 'blg'} onClick={() => setOnglet('blg')} label="BLG" />
            <OngletTab active={onglet === 'comparaison'} onClick={() => setOnglet('comparaison')} label="Comparaison" />
          </div>
        </section>

        {onglet === 'sage' && <OngletSage />}
        {onglet === 'blg' && <OngletBlg />}
        {onglet === 'comparaison' && <OngletComparaison />}
      </div>
    </main>
  )
}

function OngletTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-5 py-2.5 text-[14px] font-bold transition-colors ${
        active ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'
      }`}>
      {label}
    </button>
  )
}
