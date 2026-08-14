'use client'

/**
 * Écran de contrôle SAGE ↔ BLG
 * ---------------------------------------------------------------------------
 * - Comparatif automatique champ par champ (Fiche client)
 * - Informations complémentaires affichées mais non auto-comparées (formats
 *   trop différents entre les deux systèmes pour un diff fiable : qualité/
 *   tags, interlocuteur/contacts, IBAN, agence de rattachement…)
 * - Panneau de mapping manuel : liste tous les champs SAGE (ref_tiers) et
 *   BLG (blg.ref_tiers_blg) disponibles, avec possibilité de documenter/
 *   modifier la correspondance entre les deux pour ceux non encore couverts
 * - Bouton de synchro à la demande (via /api/blg-sync, qui relaie vers le
 *   petit serveur de déclenchement sur le VPS)
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Types ────────────────────────────────────────────────────────────────

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

type SyncLogEntry = {
  table_name: string
  rows_synced: number
  status: string
  started_at: string
  finished_at: string
}

const CHAMP_LABELS: Record<string, string> = {
  intitule: 'Intitulé', siret: 'SIRET', code_naf: 'Code NAF', code_postal: 'Code postal', ville: 'Ville',
  representant: 'Représentant', encours: "Encours autorisé", assurance_credit: 'Assurance crédit',
  famille: 'Famille', frais_facturation: 'Frais de facturation', releve_facture: 'Relevé de facture',
  type_facture: 'Type de facture', capacite_expiration: 'Capacité expiration',
}

const FIELD_PAIRS: Array<{ key: string; label: string; sage: keyof ControleRow; blg: keyof ControleRow; format?: (v: unknown) => string }> = [
  { key: 'intitule', label: 'Intitulé', sage: 'sage_intitule', blg: 'blg_intitule' },
  { key: 'siret', label: 'SIRET', sage: 'sage_siret', blg: 'blg_siret' },
  { key: 'code_naf', label: 'Code NAF', sage: 'sage_code_naf', blg: 'blg_code_naf' },
  { key: 'code_postal', label: 'Code postal', sage: 'sage_code_postal', blg: 'blg_code_postal' },
  { key: 'ville', label: 'Ville', sage: 'sage_ville', blg: 'blg_ville' },
  { key: 'representant', label: 'Représentant', sage: 'sage_representant', blg: 'blg_commercial' },
  { key: 'encours', label: 'Encours autorisé', sage: 'sage_encours', blg: 'blg_encours', format: formatMontant },
  { key: 'assurance_credit', label: 'Assurance crédit', sage: 'sage_assurance_credit', blg: 'blg_assurance_credit', format: formatMontant },
  { key: 'famille', label: 'Famille', sage: 'sage_famille', blg: 'blg_famille' },
  { key: 'frais_facturation', label: 'Frais de facturation', sage: 'sage_frais_facturation', blg: 'blg_frais_facturation' },
  { key: 'routage_promo', label: 'Routage promo', sage: 'sage_routage_promo', blg: 'blg_routage_promo' },
  { key: 'facture_email', label: 'Facture électronique', sage: 'sage_facture_email', blg: 'blg_facture_electronique' },
  { key: 'releve_facture', label: 'Relevé de facture', sage: 'sage_releve_facture', blg: 'blg_releve_facture' },
  { key: 'type_facture', label: 'Type de facture', sage: 'sage_type_facture', blg: 'blg_type_facture' },
  { key: 'capacite_expiration', label: 'Capacité expiration', sage: 'sage_capacite_expiration', blg: 'blg_capacite_expiration', format: formatDate },
]

// Champs affichés côte à côte mais non comparés automatiquement (formats trop
// différents entre SAGE et BLG pour un diff fiable — à l'œil pour l'instant).
const INFO_PAIRS: Array<{ label: string; sage: keyof ControleRow; blg: keyof ControleRow; formatBlg?: (v: unknown) => string }> = [
  { label: 'Abrégé / Nom court', sage: 'sage_abrege', blg: 'blg_nom_court' },
  { label: 'Qualité / Tags', sage: 'sage_qualite', blg: 'blg_tags', formatBlg: (v) => (Array.isArray(v) ? v.join(', ') : '—') },
  { label: 'Interlocuteur / Contact principal', sage: 'sage_contact', blg: 'blg_contact_principal' },
]

function formatMontant(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return `${n.toLocaleString('fr-FR')} €`
}
function formatDate(v: unknown): string {
  if (!v) return '—'
  try { return new Date(String(v)).toLocaleDateString('fr-FR') } catch { return String(v) }
}
function displayValue(v: unknown, format?: (v: unknown) => string): string {
  if (format) return format(v)
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function ControleSageBlgPage() {
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

  const [selected, setSelected] = useState<ControleRow | null>(null)

  const [showMapping, setShowMapping] = useState(false)
  const [inventaire, setInventaire] = useState<ChampInventaire[]>([])
  const [mapping, setMapping] = useState<ChampMapping[]>([])
  const [loadingMapping, setLoadingMapping] = useState(false)

  const [syncLoading, setSyncLoading] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([])
  const [showSyncLog, setShowSyncLog] = useState(false)

  useEffect(() => { void loadSummary() }, [])
  useEffect(() => { void loadRows() }, [search, statutFilter, onlyEcarts, champFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSummary() {
    setLoadingSummary(true)
    const { data, error: err } = await supabase.rpc('get_controle_tiers_summary')
    if (err) setError(err.message)
    else setSummary(Array.isArray(data) ? data[0] : data)
    setLoadingSummary(false)
  }

  async function loadRows() {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('get_controle_tiers_sage_blg', {
      p_statut: statutFilter === 'tous' ? null : statutFilter,
      p_only_ecarts: onlyEcarts,
      p_champ: champFilter,
      p_search: search.trim() || null,
      p_limit: 300,
      p_offset: 0,
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

  function toggleMappingPanel() {
    const next = !showMapping
    setShowMapping(next)
    if (next && inventaire.length === 0) void loadMappingPanel()
  }

  const blgInventaire = useMemo(() => inventaire.filter((c) => c.cote === 'blg'), [inventaire])

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

  const champsTries = useMemo(() => {
    if (!summary) return []
    return Object.entries(summary.par_champ).sort((a, b) => b[1] - a[1]).map(([champ, nb]) => ({ champ, nb, label: CHAMP_LABELS[champ] || champ }))
  }, [summary])

  return (
    <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1700px] space-y-4">
        {/* En-tête */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Migration BLG</p>
              <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-[#111820]">Contrôle de cohérence SAGE ↔ BLG</h1>
              <p className="mt-1 text-[13px] text-[#8A8474]">Compare les données des deux systèmes, domaine par domaine, pour préparer la bascule.</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                onClick={() => void lancerSynchro()}
                disabled={syncLoading}
                className="rounded-lg bg-[#111820] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#252E3D] disabled:cursor-not-allowed disabled:opacity-60"
              >
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

          <div className="mt-4 flex flex-wrap gap-2">
            <DomaineTab active={domaine === 'client'} onClick={() => setDomaine('client')} label="Fiche client" />
            <DomaineTab active={false} disabled label="Fiche article" note="bientôt" />
            <DomaineTab active={false} disabled label="Devis" note="bientôt" />
            <DomaineTab active={false} disabled label="Factures" note="bientôt" />
          </div>
        </section>

        {domaine !== 'client' ? (
          <section className="rounded-xl border border-dashed border-[#E5E1D8] bg-white p-12 text-center">
            <p className="text-[15px] font-bold text-[#3A362E]">Domaine pas encore disponible</p>
            <p className="mt-1 text-[13px] text-[#8A8474]">Le rapprochement pour ce domaine sera ajouté dans une prochaine étape.</p>
          </section>
        ) : (
          <>
            {/* KPI */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <KpiCard label="Tiers SAGE" value={summary?.total_sage} loading={loadingSummary} />
              <KpiCard label="Appariés avec BLG" value={summary?.apparies} loading={loadingSummary} />
              <KpiCard label="Manquants côté BLG" value={summary?.manquants_blg} loading={loadingSummary} tone="warn" />
              <KpiCard label="Sans écart" value={summary?.sans_ecart} loading={loadingSummary} tone="ok" />
              <KpiCard label="Avec au moins un écart" value={summary?.avec_ecart} loading={loadingSummary} tone="warn" />
            </section>

            {/* Champs les plus en écart */}
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

            {/* Panneau de mapping manuel */}
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
                  {loadingMapping ? (
                    <div className="h-32 animate-pulse rounded bg-[#F4F3F0]" />
                  ) : (
                    <MappingBuilder mapping={mapping} blgInventaire={blgInventaire} onMappingChange={setMapping} />
                  )}
                </div>
              )}
            </section>

            {/* Filtres */}
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
            </section>

            {/* Liste + détail */}
            <section className="grid gap-4 lg:grid-cols-[1fr_560px]">
              <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{loading ? 'Chargement…' : `${rows.length} résultat${rows.length > 1 ? 's' : ''}`}</div>
                  {error && <div className="text-[12px] font-semibold text-red-600">{error}</div>}
                </div>
                <div className="max-h-[640px] overflow-auto rounded-lg border border-[#E5E1D8]">
                  <table className="w-full text-left text-[13px]">
                    <thead className="sticky top-0 bg-[#F4F3F0] text-[11px] uppercase tracking-wide text-[#8A8474]">
                      <tr><th className="px-3 py-2 font-bold">N° tiers</th><th className="px-3 py-2 font-bold">Intitulé</th><th className="px-3 py-2 font-bold">Statut</th><th className="px-3 py-2 font-bold">Écarts</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.numero_tiers} onClick={() => setSelected(r)}
                          className={`cursor-pointer border-t border-[#E5E1D8] transition-colors hover:bg-[#F4F3F0] ${selected?.numero_tiers === r.numero_tiers ? 'bg-[#B4761A]/[0.06]' : ''}`}>
                          <td className="px-3 py-2 font-mono text-[12px] font-semibold text-[#3A362E]">{r.numero_tiers}</td>
                          <td className="px-3 py-2 text-[#111820]">{r.sage_intitule || r.blg_intitule || '—'}</td>
                          <td className="px-3 py-2">
                            {r.statut_appariement === 'manquant_blg' ? (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Manquant BLG</span>
                            ) : r.champs_en_ecart.length === 0 ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">OK</span>
                            ) : (
                              <span className="rounded-full bg-[#B4761A]/[0.1] px-2 py-0.5 text-[11px] font-bold text-[#96600F]">À vérifier</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[#8A8474]">{r.champs_en_ecart.length === 0 ? '—' : r.champs_en_ecart.map((c) => CHAMP_LABELS[c] || c).join(', ')}</td>
                        </tr>
                      ))}
                      {!loading && rows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-[#8A8474]">Aucun résultat pour ces filtres.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Détail comparatif */}
              <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
                <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Comparaison détaillée</div>
                {!selected ? (
                  <div className="flex h-64 items-center justify-center text-center text-[13px] text-[#8A8474]">Sélectionne un tiers dans la liste pour voir le détail champ par champ.</div>
                ) : (
                  <div>
                    <div className="mb-3 border-b border-[#E5E1D8] pb-3">
                      <div className="font-mono text-[12px] font-bold text-[#8A8474]">{selected.numero_tiers}</div>
                      <div className="text-[15px] font-bold text-[#111820]">{selected.sage_intitule || selected.blg_intitule}</div>
                      {selected.blg_partner_id && (
                        <a href={`https://app.blgcloud.com/cegeclim-test/?app/crm/company/${selected.blg_partner_id}#`} target="_blank" rel="noopener noreferrer"
                          className="mt-1 inline-block text-[12px] font-semibold text-[#B4761A] hover:underline">Ouvrir dans BLG ↗</a>
                      )}
                    </div>

                    {selected.statut_appariement === 'manquant_blg' ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] font-semibold text-red-700">
                        Ce tiers n'a pas de correspondance identifiée côté BLG (`blg_id_tiers` non renseigné ou introuvable).
                      </div>
                    ) : (
                      <>
                        <div className="space-y-0.5">
                          <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
                            <span>Champ</span><span>SAGE</span><span>BLG</span>
                          </div>
                          {FIELD_PAIRS.map((f) => {
                            const isEcart = selected.champs_en_ecart.includes(f.key)
                            return (
                              <div key={f.key} className={`grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1.5 text-[13px] ${isEcart ? 'bg-[#B4761A]/[0.08]' : ''}`}>
                                <span className="font-semibold text-[#3A362E]">{f.label}</span>
                                <span className={isEcart ? 'font-bold text-[#96600F]' : 'text-[#111820]'}>{displayValue(selected[f.sage], f.format)}</span>
                                <span className={isEcart ? 'font-bold text-[#96600F]' : 'text-[#111820]'}>{displayValue(selected[f.blg], f.format)}</span>
                              </div>
                            )
                          })}
                        </div>

                        <div className="mt-4 border-t border-[#E5E1D8] pt-3">
                          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">Informations complémentaires (affichage, non comparé automatiquement)</div>
                          <div className="space-y-0.5">
                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">
                              <span>Champ</span><span>SAGE</span><span>BLG</span>
                            </div>
                            {INFO_PAIRS.map((f) => (
                              <div key={f.label} className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1.5 text-[13px]">
                                <span className="font-semibold text-[#3A362E]">{f.label}</span>
                                <span className="text-[#111820]">{displayValue(selected[f.sage])}</span>
                                <span className="text-[#111820]">{displayValue(selected[f.blg], f.formatBlg)}</span>
                              </div>
                            ))}
                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1.5 text-[13px]">
                              <span className="font-semibold text-[#3A362E]">Agence de rattachement (SAGE)</span>
                              <span className="text-[#111820]">{displayValue(selected.sage_agence_rattachement)}</span>
                              <span className="text-[#8A8474]">Pas d'équivalent identifié — voir mapping</span>
                            </div>
                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1.5 text-[13px]">
                              <span className="font-semibold text-[#3A362E]">Contacts rattachés (BLG)</span>
                              <span className="text-[#8A8474]">—</span>
                              <span className="text-[#111820]">{selected.blg_nb_contacts ?? 0} — {selected.blg_contacts_resume || '—'}</span>
                            </div>
                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg px-2 py-1.5 text-[13px]">
                              <span className="font-semibold text-[#3A362E]">IBAN / Banque (BLG)</span>
                              <span className="text-[#8A8474]">—</span>
                              <span className="text-[#111820]">{selected.blg_iban || '—'} {selected.blg_banque ? `(${selected.blg_banque})` : ''}</span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

// ── Composants ───────────────────────────────────────────────────────────

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

function KpiCard({ label, value, loading, tone }: { label: string; value: number | undefined; loading: boolean; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : '#111820'
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      {loading ? <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[#F4F3F0]" /> : (
        <div className="mt-1 text-[28px] font-bold tracking-tight" style={{ color }}>{value !== undefined ? value.toLocaleString('fr-FR') : '—'}</div>
      )}
    </div>
  )
}

// ── Sélecteur de mapping interactif ─────────────────────────────────────
//
// Choisis un client exemple, puis clique un champ SAGE (colonne de gauche)
// et le champ BLG correspondant (colonne de droite) pour les associer. Les
// paires déjà mappées s'affichent alignées en haut ; les champs non mappés
// suivent en dessous, chacun avec sa valeur réelle pour ce client.

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function MappingBuilder({
  mapping,
  blgInventaire,
  onMappingChange,
}: {
  mapping: ChampMapping[]
  blgInventaire: ChampInventaire[]
  onMappingChange: (m: ChampMapping[]) => void
}) {
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
      {/* Sélecteur de client */}
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
            <span>SAGE</span>
            <span>BLG</span>
          </div>

          {/* Paires déjà mappées, alignées */}
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

          {/* Champs non mappés */}
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
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] transition-colors ${
                      pendingSageField ? 'hover:bg-[#B4761A]/[0.1]' : 'cursor-default'
                    }`}>
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
