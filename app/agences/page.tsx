'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useSocieteFilter } from '@/components/SocieteFilterContext'

type Agence = {
  id: string
  type: 'Agence' | 'Plateforme'
  departement: string
  societe: 'Cegeclim' | 'CVC'
  agence: string
  rattachement_pf: string | null
  region:
    | 'Nouvelle-Aquitaine'
    | 'Pays de Loire'
    | 'Centre Val de Loire'
    | 'Bretagne'
    | 'Normandie'
  resp_agence: string | null
  nb_tci: number | null
  nb_tcs: number | null
  nb_hotliner: number | null
  effectif_total: number | null
  ca_ke: number | null
  stock_ke: number | null
  surface_totale: number | null
  surface_stockage: number | null
  statut: 'Ouvert' | 'Fermé'
  adresse: string | null
  image: string | null
  commentaire: string | null
  created_at?: string
  updated_at?: string
}

type SortKey = keyof Agence
type SortDirection = 'asc' | 'desc'

const REGIONS = [
  'Nouvelle-Aquitaine',
  'Pays de Loire',
  'Centre Val de Loire',
  'Bretagne',
  'Normandie',
] as const

const REGIONS_SYNTHSE = [
  'Nouvelle-Aquitaine',
  'Pays de Loire',
  'Bretagne',
  'Normandie',
] as const

const emptyString = (v: string | null | undefined) => v ?? ''
const emptyNumber = (v: number | null | undefined) => v ?? 0

function formatNumber(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value ?? 0)
}

function formatKeur(value: number | null | undefined) {
  return `${formatNumber(value, 0)} K€`
}

function getGoogleMapsLink(address: string | null | undefined) {
  if (!address) return ''
  const trimmed = address.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`
}

export default function AgencesPage() {
  const { societeFilter } = useSocieteFilter()

  const [agences, setAgences] = useState<Agence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterRegion, setFilterRegion] = useState('Toutes')
  const [filterSociete, setFilterSociete] = useState('Toutes')
  const [filterType, setFilterType] = useState('Tous')
  const [filterStatut, setFilterStatut] = useState('Tous')

  const [sortKey, setSortKey] = useState<SortKey>('region')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const [selectedAgence, setSelectedAgence] = useState<Agence | null>(null)
  const [draftAgence, setDraftAgence] = useState<Agence | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadAgences() {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('agences')
      .select('*')
      .order('region', { ascending: true })
      .order('agence', { ascending: true })

    if (error) {
      setError(error.message)
      setAgences([])
      setLoading(false)
      return
    }

    setAgences((data ?? []) as Agence[])
    setLoading(false)
  }

  useEffect(() => {
    loadAgences()
  }, [])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('asc')
  }

  function matchesGlobalSocieteFilter(a: Agence) {
    if (societeFilter === 'Global') return true
    if (societeFilter === 'Cegeclim') return a.societe === 'Cegeclim'
    if (societeFilter === 'CVC PdL') return a.societe === 'CVC'
    return true
  }

  const agencesApresFiltreGlobal = useMemo(() => {
    return agences.filter(matchesGlobalSocieteFilter)
  }, [agences, societeFilter])

  const filteredAgences = useMemo(() => {
    const q = search.trim().toLowerCase()

    return agencesApresFiltreGlobal.filter((a) => {
      const searchable = [
        a.agence,
        a.region,
        a.societe,
        a.type,
        a.departement,
        a.rattachement_pf,
        a.resp_agence,
        a.statut,
        a.adresse,
        a.commentaire,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchesSearch = !q || searchable.includes(q)
      const matchesRegion = filterRegion === 'Toutes' || a.region === filterRegion
      const matchesSociete = filterSociete === 'Toutes' || a.societe === filterSociete
      const matchesType = filterType === 'Tous' || a.type === filterType
      const matchesStatut = filterStatut === 'Tous' || a.statut === filterStatut

      return matchesSearch && matchesRegion && matchesSociete && matchesType && matchesStatut
    })
  }, [
    agencesApresFiltreGlobal,
    search,
    filterRegion,
    filterSociete,
    filterType,
    filterStatut,
  ])

  const sortedAgences = useMemo(() => {
    const items = [...filteredAgences]

    items.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]

      const aVal = av ?? ''
      const bVal = bv ?? ''

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      const res = String(aVal).localeCompare(String(bVal), 'fr', {
        numeric: true,
        sensitivity: 'base',
      })
      return sortDirection === 'asc' ? res : -res
    })

    return items
  }, [filteredAgences, sortKey, sortDirection])

  const syntheseParRegion = useMemo(() => {
    return REGIONS_SYNTHSE.map((region) => {
      const items = agencesApresFiltreGlobal.filter((a) => a.region === region)

      return {
        region,
        nbAgences: items.length,
        caKe: items.reduce((sum, a) => sum + emptyNumber(a.ca_ke), 0),
        surfaceTotale: items.reduce((sum, a) => sum + emptyNumber(a.surface_totale), 0),
        stockKe: items.reduce((sum, a) => sum + emptyNumber(a.stock_ke), 0),
        effectif: items.reduce((sum, a) => sum + emptyNumber(a.effectif_total), 0),
      }
    })
  }, [agencesApresFiltreGlobal])

  function openView(agence: Agence) {
    setSelectedAgence(agence)
    setDraftAgence({ ...agence })
    setIsEditing(false)
  }

  function closeModal() {
    setSelectedAgence(null)
    setDraftAgence(null)
    setIsEditing(false)
  }

  function updateDraft<K extends keyof Agence>(key: K, value: Agence[K]) {
    setDraftAgence((prev) => {
      if (!prev) return prev
      return { ...prev, [key]: value }
    })
  }

  async function handleSave() {
    if (!draftAgence) return

    setSaving(true)

    const payload = {
      type: draftAgence.type,
      departement: draftAgence.departement,
      societe: draftAgence.societe,
      agence: draftAgence.agence,
      rattachement_pf: draftAgence.rattachement_pf,
      region: draftAgence.region,
      resp_agence: draftAgence.resp_agence,
      nb_tci: draftAgence.nb_tci,
      nb_tcs: draftAgence.nb_tcs,
      nb_hotliner: draftAgence.nb_hotliner,
      effectif_total: draftAgence.effectif_total,
      ca_ke: draftAgence.ca_ke,
      stock_ke: draftAgence.stock_ke,
      surface_totale: draftAgence.surface_totale,
      surface_stockage: draftAgence.surface_stockage,
      statut: draftAgence.statut,
      adresse: draftAgence.adresse,
      image: draftAgence.image,
      commentaire: draftAgence.commentaire,
    }

    const { data, error } = await supabase
      .from('agences')
      .update(payload)
      .eq('id', draftAgence.id)
      .select()
      .single()

    setSaving(false)

    if (error) {
      alert(`Erreur lors de l'enregistrement : ${error.message}`)
      return
    }

    const updated = data as Agence

    setAgences((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    setSelectedAgence(updated)
    setDraftAgence(updated)
    setIsEditing(false)
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm('Voulez-vous vraiment supprimer cette agence ?')
    if (!confirmed) return

    setDeletingId(id)

    const { error } = await supabase.from('agences').delete().eq('id', id)

    setDeletingId(null)

    if (error) {
      alert(`Erreur lors de la suppression : ${error.message}`)
      return
    }

    setAgences((prev) => prev.filter((a) => a.id !== id))

    if (selectedAgence?.id === id) {
      closeModal()
    }
  }

  const totalGeneral = useMemo(() => {
    return agencesApresFiltreGlobal.reduce(
      (acc, a) => {
        acc.nbAgences += 1
        acc.caKe += emptyNumber(a.ca_ke)
        acc.surfaceTotale += emptyNumber(a.surface_totale)
        acc.stockKe += emptyNumber(a.stock_ke)
        acc.effectif += emptyNumber(a.effectif_total)
        return acc
      },
      {
        nbAgences: 0,
        caKe: 0,
        surfaceTotale: 0,
        stockKe: 0,
        effectif: 0,
      }
    )
  }, [agencesApresFiltreGlobal])

  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', padding: 24 }}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800, color: '#0f172a' }}>
            Agences
          </h1>
          <p style={{ marginTop: 8, color: '#64748b', fontSize: 15 }}>
            Synthèse par région et détail des agences / plateformes
          </p>
          <p style={{ marginTop: 8, color: '#334155', fontSize: 14, fontWeight: 600 }}>
            Vision active : {societeFilter}
          </p>
        </div>

        <section
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 20,
            padding: 20,
            boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div style={summaryGlobalCardStyle}>
              <div style={summaryLabelStyle}>Total agences / PF</div>
              <div style={summaryValueStyle}>{formatNumber(totalGeneral.nbAgences)}</div>
            </div>
            <div style={summaryGlobalCardStyle}>
              <div style={summaryLabelStyle}>CA total</div>
              <div style={summaryValueStyle}>{formatKeur(totalGeneral.caKe)}</div>
            </div>
            <div style={summaryGlobalCardStyle}>
              <div style={summaryLabelStyle}>Surface totale</div>
              <div style={summaryValueStyle}>
                {formatNumber(totalGeneral.surfaceTotale, 0)} m²
              </div>
            </div>
            <div style={summaryGlobalCardStyle}>
              <div style={summaryLabelStyle}>Stock total</div>
              <div style={summaryValueStyle}>{formatKeur(totalGeneral.stockKe)}</div>
            </div>
            <div style={summaryGlobalCardStyle}>
              <div style={summaryLabelStyle}>Effectif total</div>
              <div style={summaryValueStyle}>{formatNumber(totalGeneral.effectif)}</div>
            </div>
          </div>

          <h2 style={{ margin: '0 0 16px 0', fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
            Synthèse par région
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 16,
            }}
          >
            {syntheseParRegion.map((item) => (
              <div key={item.region} style={regionCardStyle}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>
                  {item.region}
                </div>
                <div style={regionLineStyle}>
                  <span>Nb agences / PF</span>
                  <strong>{formatNumber(item.nbAgences)}</strong>
                </div>
                <div style={regionLineStyle}>
                  <span>CA</span>
                  <strong>{formatKeur(item.caKe)}</strong>
                </div>
                <div style={regionLineStyle}>
                  <span>Surface</span>
                  <strong>{formatNumber(item.surfaceTotale, 0)} m²</strong>
                </div>
                <div style={regionLineStyle}>
                  <span>Stock</span>
                  <strong>{formatKeur(item.stockKe)}</strong>
                </div>
                <div style={regionLineStyle}>
                  <span>Effectif</span>
                  <strong>{formatNumber(item.effectif)}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 20,
            padding: 20,
            boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
              Détail des agences
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher agence, responsable, département..."
              style={inputStyle}
            />

            <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} style={inputStyle}>
              <option>Toutes</option>
              {REGIONS.filter((region) => region !== 'Centre Val de Loire').map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>

            <select value={filterSociete} onChange={(e) => setFilterSociete(e.target.value)} style={inputStyle}>
              <option>Toutes</option>
              <option>Cegeclim</option>
              <option>CVC</option>
            </select>

            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={inputStyle}>
              <option>Tous</option>
              <option>Agence</option>
              <option>Plateforme</option>
            </select>

            <select value={filterStatut} onChange={(e) => setFilterStatut(e.target.value)} style={inputStyle}>
              <option>Tous</option>
              <option>Ouvert</option>
              <option>Fermé</option>
            </select>
          </div>

          {loading ? (
            <div style={{ padding: 24, color: '#64748b' }}>Chargement des données...</div>
          ) : error ? (
            <div style={{ padding: 24, color: '#b91c1c' }}>{error}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <SortableTh label="Région" sortKey="region" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Société" sortKey="societe" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Type" sortKey="type" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Dépt" sortKey="departement" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Agence" sortKey="agence" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Resp. Agence" sortKey="resp_agence" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="CA K€" sortKey="ca_ke" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Stock K€" sortKey="stock_ke" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Surface Totale" sortKey="surface_totale" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Effectif" sortKey="effectif_total" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <SortableTh label="Statut" sortKey="statut" currentKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {sortedAgences.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        Aucun enregistrement
                      </td>
                    </tr>
                  ) : (
                    sortedAgences.map((agence) => (
                      <tr key={agence.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                        <td style={tdStyle}>{agence.region}</td>
                        <td style={tdStyle}>{agence.societe}</td>
                        <td style={tdStyle}>{agence.type}</td>
                        <td style={tdStyle}>{agence.departement}</td>
                        <td style={tdStyle}>{agence.agence}</td>
                        <td style={tdStyle}>{agence.resp_agence || '-'}</td>
                        <td style={tdStyle}>{formatNumber(agence.ca_ke, 0)}</td>
                        <td style={tdStyle}>{formatNumber(agence.stock_ke, 0)}</td>
                        <td style={tdStyle}>{formatNumber(agence.surface_totale, 0)}</td>
                        <td style={tdStyle}>{formatNumber(agence.effectif_total, 0)}</td>
                        <td style={tdStyle}>{agence.statut}</td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={() => openView(agence)} style={viewButtonStyle}>
                              Voir
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(agence.id)}
                              disabled={deletingId === agence.id}
                              style={deleteButtonStyle}
                            >
                              {deletingId === agence.id ? 'Suppression...' : 'Supprimer'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selectedAgence && draftAgence && (
        <div onClick={closeModal} style={modalOverlayStyle}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={modalContainerStyle}
          >
            <div style={modalMediaColumnStyle}>
              {draftAgence.image ? (
                <>
                  <div
                    style={{
                      ...modalMediaBackgroundStyle,
                      backgroundImage: `url(${draftAgence.image})`,
                    }}
                  />
                  <div style={modalMediaInnerStyle}>
                    <img
                      src={draftAgence.image}
                      alt={draftAgence.agence}
                      style={modalImageStyle}
                    />
                  </div>
                </>
              ) : (
                <div style={modalNoImageStyle}>
                  Aucune photo disponible
                </div>
              )}
            </div>

            <div style={modalContentColumnStyle}>
              <div style={modalHeaderStickyStyle}>
                <div>
                  <h2 style={modalTitleStyle}>{draftAgence.agence}</h2>

                  <div style={modalSubtitleRowStyle}>
                    <span style={pillStyle}>{draftAgence.type}</span>
                    <span style={pillStyle}>{draftAgence.societe}</span>
                    <span style={pillStyle}>{draftAgence.region}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      style={editButtonStyle}
                    >
                      Mettre à jour
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      style={saveButtonStyle}
                    >
                      {saving ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  )}

                  <button type="button" onClick={closeModal} style={closeButtonStyle}>
                    Fermer
                  </button>
                </div>
              </div>

              <div style={modalBodyStyle}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 14,
                  }}
                >
                  <Field label="Type">
                    {isEditing ? (
                      <select
                        value={draftAgence.type}
                        onChange={(e) => updateDraft('type', e.target.value as Agence['type'])}
                        style={inputStyle}
                      >
                        <option value="Agence">Agence</option>
                        <option value="Plateforme">Plateforme</option>
                      </select>
                    ) : (
                      <Value>{draftAgence.type}</Value>
                    )}
                  </Field>

                  <Field label="Département">
                    {isEditing ? (
                      <input
                        value={emptyString(draftAgence.departement)}
                        onChange={(e) => updateDraft('departement', e.target.value)}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{draftAgence.departement}</Value>
                    )}
                  </Field>

                  <Field label="Société">
                    {isEditing ? (
                      <select
                        value={draftAgence.societe}
                        onChange={(e) => updateDraft('societe', e.target.value as Agence['societe'])}
                        style={inputStyle}
                      >
                        <option value="Cegeclim">Cegeclim</option>
                        <option value="CVC">CVC</option>
                      </select>
                    ) : (
                      <Value>{draftAgence.societe}</Value>
                    )}
                  </Field>

                  <Field label="Agence">
                    {isEditing ? (
                      <input
                        value={emptyString(draftAgence.agence)}
                        onChange={(e) => updateDraft('agence', e.target.value)}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{draftAgence.agence}</Value>
                    )}
                  </Field>

                  <Field label="Rattachement PF">
                    {isEditing ? (
                      <input
                        value={emptyString(draftAgence.rattachement_pf)}
                        onChange={(e) => updateDraft('rattachement_pf', e.target.value)}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{draftAgence.rattachement_pf || '-'}</Value>
                    )}
                  </Field>

                  <Field label="Région">
                    {isEditing ? (
                      <select
                        value={draftAgence.region}
                        onChange={(e) => updateDraft('region', e.target.value as Agence['region'])}
                        style={inputStyle}
                      >
                        {REGIONS.map((region) => (
                          <option key={region} value={region}>
                            {region}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Value>{draftAgence.region}</Value>
                    )}
                  </Field>

                  <Field label="Resp. Agence">
                    {isEditing ? (
                      <input
                        value={emptyString(draftAgence.resp_agence)}
                        onChange={(e) => updateDraft('resp_agence', e.target.value)}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{draftAgence.resp_agence || '-'}</Value>
                    )}
                  </Field>

                  <Field label="Statut">
                    {isEditing ? (
                      <select
                        value={draftAgence.statut}
                        onChange={(e) => updateDraft('statut', e.target.value as Agence['statut'])}
                        style={inputStyle}
                      >
                        <option value="Ouvert">Ouvert</option>
                        <option value="Fermé">Fermé</option>
                      </select>
                    ) : (
                      <Value>{draftAgence.statut}</Value>
                    )}
                  </Field>

                  <Field label="Nb TCI">
                    {isEditing ? (
                      <input
                        type="number"
                        value={draftAgence.nb_tci ?? 0}
                        onChange={(e) => updateDraft('nb_tci', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.nb_tci)}</Value>
                    )}
                  </Field>

                  <Field label="Nb TCS">
                    {isEditing ? (
                      <input
                        type="number"
                        value={draftAgence.nb_tcs ?? 0}
                        onChange={(e) => updateDraft('nb_tcs', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.nb_tcs)}</Value>
                    )}
                  </Field>

                  <Field label="Nb Hotliner">
                    {isEditing ? (
                      <input
                        type="number"
                        value={draftAgence.nb_hotliner ?? 0}
                        onChange={(e) => updateDraft('nb_hotliner', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.nb_hotliner)}</Value>
                    )}
                  </Field>

                  <Field label="Effectif total">
                    {isEditing ? (
                      <input
                        type="number"
                        value={draftAgence.effectif_total ?? 0}
                        onChange={(e) => updateDraft('effectif_total', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.effectif_total)}</Value>
                    )}
                  </Field>

                  <Field label="CA K€">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={draftAgence.ca_ke ?? 0}
                        onChange={(e) => updateDraft('ca_ke', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.ca_ke, 0)}</Value>
                    )}
                  </Field>

                  <Field label="Stock K€">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={draftAgence.stock_ke ?? 0}
                        onChange={(e) => updateDraft('stock_ke', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.stock_ke, 0)}</Value>
                    )}
                  </Field>

                  <Field label="Surface totale">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={draftAgence.surface_totale ?? 0}
                        onChange={(e) => updateDraft('surface_totale', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.surface_totale, 0)} m²</Value>
                    )}
                  </Field>

                  <Field label="Surface stockage">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={draftAgence.surface_stockage ?? 0}
                        onChange={(e) => updateDraft('surface_stockage', Number(e.target.value))}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{formatNumber(draftAgence.surface_stockage, 0)} m²</Value>
                    )}
                  </Field>

                  <Field label="Adresse / Google Maps" fullWidth>
                    {isEditing ? (
                      <input
                        value={emptyString(draftAgence.adresse)}
                        onChange={(e) => updateDraft('adresse', e.target.value)}
                        style={inputStyle}
                      />
                    ) : getGoogleMapsLink(draftAgence.adresse) ? (
                      <a
                        href={getGoogleMapsLink(draftAgence.adresse)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: '#2563eb',
                          textDecoration: 'underline',
                          wordBreak: 'break-word',
                        }}
                      >
                        {draftAgence.adresse}
                      </a>
                    ) : (
                      <Value>-</Value>
                    )}
                  </Field>

                  <Field label="Lien image" fullWidth>
                    {isEditing ? (
                      <input
                        value={emptyString(draftAgence.image)}
                        onChange={(e) => updateDraft('image', e.target.value)}
                        style={inputStyle}
                      />
                    ) : (
                      <Value>{draftAgence.image || '-'}</Value>
                    )}
                  </Field>

                  <Field label="Commentaire" fullWidth>
                    {isEditing ? (
                      <textarea
                        value={emptyString(draftAgence.commentaire)}
                        onChange={(e) => updateDraft('commentaire', e.target.value)}
                        rows={5}
                        style={{ ...inputStyle, resize: 'vertical' }}
                      />
                    ) : (
                      <div
                        style={{
                          minHeight: 110,
                          padding: '12px 14px',
                          borderRadius: 12,
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          color: '#334155',
                          whiteSpace: 'pre-line',
                          lineHeight: 1.6,
                        }}
                      >
                        {draftAgence.commentaire || '-'}
                      </div>
                    )}
                  </Field>

                  <Field label="ID" fullWidth>
                    <Value>{draftAgence.id}</Value>
                  </Field>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function SortableTh({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
}) {
  const isActive = currentKey === sortKey
  const arrow = !isActive ? '↕' : direction === 'asc' ? '↑' : '↓'

  return (
    <th style={thStyle}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        style={{
          border: 'none',
          background: 'transparent',
          fontWeight: 700,
          color: '#0f172a',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 0,
        }}
      >
        <span>{label}</span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{arrow}</span>
      </button>
    </th>
  )
}

function Field({
  label,
  children,
  fullWidth = false,
}: {
  label: string
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        borderRadius: 12,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        color: '#0f172a',
      }}
    >
      {children}
    </div>
  )
}

const summaryGlobalCardStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 16,
  padding: 16,
  minWidth: 0,
}

const summaryLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
  marginBottom: 8,
  fontWeight: 600,
}

const summaryValueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: '#0f172a',
  whiteSpace: 'nowrap',
}

const regionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 18,
  padding: 16,
}

const regionLineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '8px 0',
  borderTop: '1px solid #f1f5f9',
  color: '#334155',
  fontSize: 14,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  borderRadius: 12,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  padding: '10px 14px',
  fontSize: 14,
  color: '#0f172a',
  outline: 'none',
  boxSizing: 'border-box',
}

const thStyle: React.CSSProperties = {
  padding: '14px 12px',
  textAlign: 'left',
  fontSize: 13,
  color: '#0f172a',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid #e2e8f0',
}

const tdStyle: React.CSSProperties = {
  padding: '12px',
  fontSize: 14,
  color: '#334155',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
}

const viewButtonStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #0f172a',
  background: '#0f172a',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 600,
}

const deleteButtonStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#b91c1c',
  cursor: 'pointer',
  fontWeight: 600,
}

const editButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid #0f172a',
  background: '#0f172a',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 700,
}

const saveButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid #15803d',
  background: '#15803d',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 700,
}

const closeButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#334155',
  cursor: 'pointer',
  fontWeight: 700,
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.48)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  zIndex: 1000,
}

const modalContainerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 1480,
  height: '92vh',
  background: '#ffffff',
  borderRadius: 28,
  overflow: 'hidden',
  boxShadow: '0 30px 80px rgba(15,23,42,0.28)',
  display: 'grid',
  gridTemplateColumns: '1.1fr 0.9fr',
}

const modalMediaColumnStyle: React.CSSProperties = {
  position: 'relative',
  background: '#e5e7eb',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
}

const modalMediaBackgroundStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  filter: 'blur(26px)',
  transform: 'scale(1.08)',
  opacity: 0.35,
}

const modalMediaInnerStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 20,
  boxSizing: 'border-box',
}

const modalImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  objectPosition: 'top center',
  display: 'block',
  transition: 'transform 0.35s ease',
}

const modalNoImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#64748b',
  fontSize: 16,
  background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
}

const modalContentColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: '#ffffff',
}

const modalHeaderStickyStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'rgba(255,255,255,0.96)',
  backdropFilter: 'blur(8px)',
  borderBottom: '1px solid #e2e8f0',
  padding: 24,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
}

const modalBodyStyle: React.CSSProperties = {
  padding: 24,
  overflowY: 'auto',
}

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 42,
  lineHeight: 1.05,
  fontWeight: 800,
  color: '#0f172a',
}

const modalSubtitleRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 12,
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '7px 12px',
  borderRadius: 999,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#475569',
  fontSize: 13,
  fontWeight: 700,
}