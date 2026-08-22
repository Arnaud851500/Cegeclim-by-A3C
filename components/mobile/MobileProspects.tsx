'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Version mobile de "Prospects autour de moi", branchée sur les mêmes
// principes que la carte de l'écran Clients desktop (app/clients/page.tsx) :
// visualisation carte, filtres, détail client au clic. Réécrite pour un
// écran de téléphone : carte plein écran (pas de liste latérale), filtres
// dans un tiroir plutôt qu'une barre d'outils, fiche de détail en bottom
// sheet.
//
// SIMPLIFICATION ASSUMÉE (v1) : au lieu de charger toute la table clients
// (comme le fait le desktop, adapté à un poste de travail), on interroge
// uniquement une boîte englobante autour de la position GPS de
// l'utilisateur -- plus léger sur mobile/4G. Conséquence : seules les
// fiches ayant déjà latitude/longitude renseignées apparaissent (celles
// avec uniquement des coordonnées Lambert ne remontent pas tant qu'un job
// de fond ne les aura pas converties, cf. lambert93ToWgs84 côté desktop).
// ─────────────────────────────────────────────────────────────────────────

const MapContainer: any = dynamic(() => import('react-leaflet').then((m) => m.MapContainer as any), { ssr: false })
const TileLayer: any = dynamic(() => import('react-leaflet').then((m) => m.TileLayer as any), { ssr: false })
const CircleMarker: any = dynamic(() => import('react-leaflet').then((m) => m.CircleMarker as any), { ssr: false })
const Circle: any = dynamic(() => import('react-leaflet').then((m) => m.Circle as any), { ssr: false })

type ProspectRow = {
  id: string
  siret: string | null
  raison_sociale_affichee: string | null
  activitePrincipaleEtablissement: string | null
  naf_libelle_traduit: string | null
  codePostalEtablissement: string | null
  libelleCommuneEtablissement: string | null
  latitude: number | null
  longitude: number | null
  telephone: string | null
  email: string | null
  nom_dirigeant: string | null
  prospect_status: string | null
  prospect_comment: string | null
  present_dans_cegeclim: string | boolean | null
  dateCreationEtablissement: string | null
  etatAdministratifUniteLegale: string | null
  rge: boolean | null
  capacite_gaz: boolean | null
}

type UserPosition = { lat: number; lng: number; accuracy: number | null }

type ProspectStatusValue =
  | ''
  | '1 : A contacter'
  | '2 : A relancer'
  | '3 : Rdv pris'
  | '4 : Proposition faite'
  | '5 : Client non intéressé'
  | '6 : Ne pas poursuivre'
  | '7 : Abandon'

const PROSPECT_STATUS_OPTIONS: ProspectStatusValue[] = [
  '1 : A contacter',
  '2 : A relancer',
  '3 : Rdv pris',
  '4 : Proposition faite',
  '5 : Client non intéressé',
  '6 : Ne pas poursuivre',
  '7 : Abandon',
]

const RADIUS_PRESETS_KM = [5, 10, 25, 50, 100]

// Mêmes secteurs suivis et mêmes couleurs que côté desktop
// (app/clients/page.tsx, TRACKED_SECTORS) -- à garder synchronisés si
// la liste évolue là-bas.
type TrackedSectorDefinition = { prefixes: string[]; label: string; color: string }
const TRACKED_SECTORS: TrackedSectorDefinition[] = [
  { prefixes: ['43.21', '4321'], label: 'Electricité ENR', color: '#a2cc88' },
  { prefixes: ['43.22A', '4322A'], label: 'Plomberie', color: '#c3b691' },
  { prefixes: ['43.22B', '4322B'], label: 'Installateur CVC', color: '#8ba9be' },
  { prefixes: ['41.20', '4120'], label: 'CMI', color: '#e0a961' },
  { prefixes: ['28.25Z', '2825Z'], label: 'Equipement Frigorifiques Indus.', color: '#00A3FF' },
  { prefixes: ['33.20B', '3320B'], label: 'Installation de machines mécaniques', color: '#94a3b8' },
  { prefixes: ['33.12Z', '3312Z'], label: 'Réparation de machines', color: '#94a3b8' },
  { prefixes: ['43.29A', '4329A'], label: "Travaux d'isolation", color: '#f9a8d4' },
  { prefixes: ['43.99', '4399'], label: 'Bâtiment', color: '#8e9db3' },
]

function normalizeNafCode(value: string | null | undefined): string {
  return String(value || '').replace(/\s/g, '').toUpperCase()
}
function findTrackedSectorByCode(code: string | null | undefined) {
  const c = normalizeNafCode(code)
  if (!c) return null
  return TRACKED_SECTORS.find((s) => s.prefixes.some((p) => c.startsWith(p))) || null
}
function getSectorLabel(row: Pick<ProspectRow, 'naf_libelle_traduit' | 'activitePrincipaleEtablissement'>): string {
  const tracked = findTrackedSectorByCode(row.activitePrincipaleEtablissement)
  if (tracked) return tracked.label
  return String(row.naf_libelle_traduit || '').trim() || 'AUTRES'
}
function getSectorColor(sector: string): string {
  return TRACKED_SECTORS.find((s) => s.label === sector)?.color || '#d9d9d9'
}

function isPresentDansCegeclim(value: unknown): boolean {
  const raw = String(value ?? '').trim().toUpperCase()
  return raw !== '' && raw !== 'NON' && raw !== 'FALSE' && raw !== '0' && raw !== 'NULL'
}

function distanceKmWgs84(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10
}

function zoomForRadiusKm(km: number): number {
  if (km <= 5) return 12
  if (km <= 15) return 11
  if (km <= 30) return 10
  if (km <= 60) return 9
  return 8
}

function formatDateFr(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

export default function MobileProspects() {
  const [position, setPosition] = useState<UserPosition | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [radiusKm, setRadiusKm] = useState(25)

  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [secteursActifs, setSecteursActifs] = useState<Set<string>>(new Set())
  const [rgeSeul, setRgeSeul] = useState(false)

  const [selected, setSelected] = useState<ProspectRow | null>(null)
  const [statutBrouillon, setStatutBrouillon] = useState<ProspectStatusValue>('')
  const [commentaireBrouillon, setCommentaireBrouillon] = useState('')
  const [saving, setSaving] = useState(false)

  const mapRef = useRef<any>(null)

  function localiser() {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGeoError("La géolocalisation n'est pas disponible sur ce téléphone.")
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        })
        setLocating(false)
      },
      (err) => {
        setLocating(false)
        const messages: Record<number, string> = {
          1: 'Accès refusé : autorise la localisation dans les réglages du navigateur.',
          2: 'Position indisponible. Vérifie le GPS.',
          3: 'Délai dépassé, réessaie.',
        }
        setGeoError(messages[err.code] || 'Erreur de géolocalisation.')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  }

  useEffect(() => {
    localiser()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!position) return
    let cancelled = false

    async function charger() {
      setLoading(true)
      setLoadError(null)
      try {
        const latDelta = radiusKm / 111
        const lonDelta = radiusKm / (111 * Math.max(0.2, Math.cos((position!.lat * Math.PI) / 180)))

        const { data, error } = await supabase
          .from('clients')
          .select(
            'id, siret, raison_sociale_affichee, activitePrincipaleEtablissement, naf_libelle_traduit, codePostalEtablissement, libelleCommuneEtablissement, latitude, longitude, telephone, email, nom_dirigeant, prospect_status, prospect_comment, present_dans_cegeclim, dateCreationEtablissement, etatAdministratifUniteLegale, rge, capacite_gaz',
          )
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)
          .gte('latitude', position!.lat - latDelta)
          .lte('latitude', position!.lat + latDelta)
          .gte('longitude', position!.lng - lonDelta)
          .lte('longitude', position!.lng + lonDelta)
          .limit(3000)

        if (cancelled) return
        if (error) throw error

        const rows = ((data || []) as ProspectRow[]).filter((r) => {
          if (String(r.etatAdministratifUniteLegale || '').trim().toUpperCase() === 'C') return false
          if (isPresentDansCegeclim(r.present_dans_cegeclim)) return false
          const dist = distanceKmWgs84(position!.lat, position!.lng, r.latitude as number, r.longitude as number)
          return dist <= radiusKm
        })

        setProspects(rows)
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'Erreur de chargement.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void charger()
    return () => { cancelled = true }
  }, [position, radiusKm])

  const secteursDisponibles = useMemo(() => {
    return Array.from(new Set(prospects.map((p) => getSectorLabel(p)))).sort()
  }, [prospects])

  const prospectsFiltres = useMemo(() => {
    return prospects.filter((p) => {
      const sector = getSectorLabel(p)
      if (secteursActifs.size > 0 && !secteursActifs.has(sector)) return false
      if (rgeSeul && !p.rge) return false
      return true
    })
  }, [prospects, secteursActifs, rgeSeul])

  function toggleSecteur(sector: string) {
    setSecteursActifs((prev) => {
      const next = new Set(prev)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }

  function ouvrirDetail(p: ProspectRow) {
    setSelected(p)
    setStatutBrouillon((p.prospect_status as ProspectStatusValue) || '')
    setCommentaireBrouillon(p.prospect_comment || '')
  }

  async function enregistrerFiche() {
    if (!selected) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('clients')
        .update({ prospect_status: statutBrouillon || null, prospect_comment: commentaireBrouillon })
        .eq('id', selected.id)
      if (error) throw error

      setProspects((prev) =>
        prev.map((p) => (p.id === selected.id ? { ...p, prospect_status: statutBrouillon, prospect_comment: commentaireBrouillon } : p)),
      )
      setSelected(null)
    } catch (e: any) {
      alert("Erreur lors de l'enregistrement : " + (e?.message || String(e)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ---- Bandeau haut : statut + bouton filtres ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
        <div style={{ flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
          {loading
            ? 'Recherche…'
            : loadError
              ? loadError
              : position
                ? `${prospectsFiltres.length} prospect${prospectsFiltres.length > 1 ? 's' : ''} dans un rayon de ${radiusKm} km`
                : 'Position non disponible'}
        </div>
        <button
          type="button"
          onClick={() => setFiltresOuverts(true)}
          style={{
            border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)',
            color: '#fff', borderRadius: 10, padding: '7px 12px', fontSize: 12.5, fontWeight: 600,
          }}
        >
          ⚙️ Filtres
        </button>
      </div>

      {geoError && (
        <div style={{ margin: '0 14px 10px', padding: '10px 12px', borderRadius: 10, background: 'rgba(193,104,60,0.14)', border: '1px solid rgba(193,104,60,0.32)', color: '#e0a685', fontSize: 12.5 }}>
          {geoError}
          <button type="button" onClick={localiser} style={{ display: 'block', marginTop: 6, background: 'none', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
            Réessayer
          </button>
        </div>
      )}

      {/* ---- Carte plein écran ---- */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {position ? (
          <MapContainer
            center={[position.lat, position.lng] as any}
            zoom={zoomForRadiusKm(radiusKm)}
            preferCanvas
            style={{ height: '100%', width: '100%' }}
            ref={(m: any) => { if (m) mapRef.current = m }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://api.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=3750cd83dca34199969e6b9e2dcdca40"
            />

            <Circle
              center={[position.lat, position.lng] as any}
              radius={radiusKm * 1000}
              pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.06, weight: 2, dashArray: '6 6' }}
            />
            <CircleMarker
              center={[position.lat, position.lng] as any}
              radius={8}
              pathOptions={{ color: '#ffffff', fillColor: '#0ea5e9', fillOpacity: 1, weight: 3 }}
            />

            {prospectsFiltres.map((p) => {
              const sector = getSectorLabel(p)
              return (
                <CircleMarker
                  key={p.id}
                  center={[p.latitude as number, p.longitude as number]}
                  radius={7}
                  pathOptions={{ color: '#0f172a', fillColor: getSectorColor(sector), fillOpacity: 0.95, weight: 1.5 }}
                  eventHandlers={{ click: () => ouvrirDetail(p) }}
                />
              )
            })}
          </MapContainer>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', padding: 24 }}>
            {locating ? 'Localisation en cours…' : 'Active la localisation pour voir les prospects autour de toi.'}
          </div>
        )}
      </div>

      {/* ---- Tiroir filtres ---- */}
      {filtresOuverts && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setFiltresOuverts(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 14 }}>Filtres</div>

            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Rayon de recherche</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {RADIUS_PRESETS_KM.map((km) => (
                <button
                  key={km}
                  type="button"
                  onClick={() => setRadiusKm(km)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(75,146,172,0.4)',
                    background: radiusKm === km ? 'rgba(75,146,172,0.35)' : 'rgba(75,146,172,0.1)',
                    color: '#fff', fontSize: 13, fontWeight: 700,
                  }}
                >
                  {km} km
                </button>
              ))}
            </div>

            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Secteur d'activité</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {secteursDisponibles.map((sector) => {
                const actif = secteursActifs.has(sector)
                return (
                  <button
                    key={sector}
                    type="button"
                    onClick={() => toggleSecteur(sector)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
                      border: `1px solid ${actif ? getSectorColor(sector) : 'rgba(255,255,255,0.18)'}`,
                      background: actif ? `${getSectorColor(sector)}33` : 'rgba(255,255,255,0.04)',
                      color: '#fff', fontSize: 12.5, fontWeight: 600,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: getSectorColor(sector) }} />
                    {sector}
                  </button>
                )
              })}
              {secteursActifs.size > 0 && (
                <button type="button" onClick={() => setSecteursActifs(new Set())} style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 12.5 }}>
                  Effacer
                </button>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: '#fff', fontWeight: 600, marginBottom: 20 }}>
              <input type="checkbox" checked={rgeSeul} onChange={(e) => setRgeSeul(e.target.checked)} style={{ width: 18, height: 18 }} />
              RGE uniquement
            </label>

            <button
              type="button"
              onClick={() => setFiltresOuverts(false)}
              style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: '#A6A181', color: '#141A26', fontSize: 14, fontWeight: 700 }}
            >
              Voir {prospectsFiltres.length} résultat{prospectsFiltres.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ---- Fiche détail prospect ---- */}
      {selected && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px' }} />

            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{selected.raison_sociale_affichee || '(sans nom)'}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{getSectorLabel(selected)}</div>

            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['SIRET', selected.siret || '—'],
                ['Adresse', [selected.codePostalEtablissement, selected.libelleCommuneEtablissement].filter(Boolean).join(' ') || '—'],
                ['Téléphone', selected.telephone || '—'],
                ['Email', selected.email || '—'],
                ['Dirigeant', selected.nom_dirigeant || '—'],
                ['Créée le', formatDateFr(selected.dateCreationEtablissement)],
                ['Distance', position ? `${distanceKmWgs84(position.lat, position.lng, selected.latitude as number, selected.longitude as number)} km` : '—'],
                ['RGE', selected.rge ? 'Oui' : 'Non'],
              ].map(([label, value]) => (
                <div key={label} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{label}</div>
                  <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, marginTop: 3 }}>{value}</div>
                </div>
              ))}

              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Action prospect</div>
                <select
                  value={statutBrouillon}
                  onChange={(e) => setStatutBrouillon(e.target.value as ProspectStatusValue)}
                  style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14 }}
                >
                  <option value="">Vide</option>
                  {PROSPECT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Remarque</div>
                <textarea
                  value={commentaireBrouillon}
                  onChange={(e) => setCommentaireBrouillon(e.target.value)}
                  rows={3}
                  placeholder="Notes sur ce prospect…"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 14, resize: 'vertical' }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void enregistrerFiche()}
              disabled={saving}
              style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14, fontWeight: 700 }}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{ marginTop: 8, width: '100%', padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
