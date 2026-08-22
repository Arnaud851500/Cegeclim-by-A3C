'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Version mobile de "Prospects autour de moi", branchée sur les mêmes
// principes que la carte de l'écran Clients desktop (app/clients/page.tsx) :
// visualisation carte, filtres, détail client au clic.
//
// CORRECTIF IMPORTANT (v2) : la première version interrogeait uniquement
// les colonnes latitude/longitude, qui sont vides sur la plupart des
// fiches (seules les coordonnées Lambert93 sont systématiquement
// renseignées à l'import SIRENE -- cf. lambert93ToWgs84 côté desktop, qui
// doit convertir à la volée pour la quasi-totalité des lignes). Résultat :
// "0 prospect" presque partout. On interroge maintenant en Lambert93
// (bien mieux renseigné, et boîte englobante triviale car c'est une
// projection métrique), puis on convertit en WGS84 pour l'affichage et le
// calcul de distance exact.
//
// Flux repensé : les filtres (rayon, secteur, ancienneté, RGE) sont
// présentés AVANT la carte, pas seulement dans un tiroir après coup --
// l'utilisateur voit et règle explicitement ce qui va être cherché.
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
  coordonneeLambertAbscisseEtablissement: number | null
  coordonneeLambertOrdonneeEtablissement: number | null
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

/** Fiche enrichie avec des coordonnées WGS84 garanties (natives ou
 * converties depuis Lambert93), prête pour affichage/calcul de distance. */
type ProspectRowGeo = ProspectRow & { latEff: number; lonEff: number }

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

type AnciennetePreset = { key: string; label: string; maxDays: number | null }
const ANCIENNETE_PRESETS: AnciennetePreset[] = [
  { key: 'tout', label: 'Tout', maxDays: null },
  { key: '3m', label: '< 3 mois', maxDays: 90 },
  { key: '1a', label: '< 1 an', maxDays: 365 },
  { key: '3a', label: '< 3 ans', maxDays: 1095 },
]

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

type RefTiersRow = { siret: string | null; mise_en_sommeil: string | boolean | null }

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
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

function diffDaysFromToday(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const ref = new Date(d)
  ref.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDateFr(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('fr-FR')
}

// ── Projection Lambert93 (RGF93) <-> WGS84 ─────────────────────────────
// Mêmes constantes que lambert93ToWgs84 côté desktop (app/clients/page.tsx)
// -- à garder synchronisées si elles changent là-bas. La fonction inverse
// (WGS84 -> Lambert93) est ajoutée ici pour pouvoir borner la requête
// Supabase directement en Lambert (bien mieux renseigné que latitude/
// longitude sur la table clients).
const LAMBERT_N = 0.725607765053267
const LAMBERT_C = 11754255.426096
const LAMBERT_XS = 700000
const LAMBERT_YS = 12655612.049876
const LAMBERT_LON0 = (3 * Math.PI) / 180
const LAMBERT_E = 0.0818191910428158

function lambert93ToWgs84(x: number | null | undefined, y: number | null | undefined): { latitude: number; longitude: number } | null {
  if (x == null || y == null) return null
  const X = Number(x)
  const Y = Number(y)
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return null

  const dx = X - LAMBERT_XS
  const dy = Y - LAMBERT_YS
  const R = Math.sqrt(dx * dx + dy * dy)
  if (!Number.isFinite(R) || R === 0) return null

  const gamma = Math.atan(dx / (LAMBERT_YS - Y))
  const lonRad = LAMBERT_LON0 + gamma / LAMBERT_N
  const latIso = -Math.log(Math.abs(R / LAMBERT_C)) / LAMBERT_N

  let latRad = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2
  for (let i = 0; i < 6; i += 1) {
    latRad =
      2 *
        Math.atan(
          Math.pow((1 + LAMBERT_E * Math.sin(latRad)) / (1 - LAMBERT_E * Math.sin(latRad)), LAMBERT_E / 2) *
            Math.exp(latIso),
        ) -
      Math.PI / 2
  }

  return { latitude: (latRad * 180) / Math.PI, longitude: (lonRad * 180) / Math.PI }
}

function wgs84ToLambert93(latDeg: number, lonDeg: number): { x: number; y: number } {
  const phi = (latDeg * Math.PI) / 180
  const lambda = (lonDeg * Math.PI) / 180

  const latIso = Math.atanh(Math.sin(phi)) - LAMBERT_E * Math.atanh(LAMBERT_E * Math.sin(phi))
  const R = LAMBERT_C * Math.exp(-LAMBERT_N * latIso)
  const gamma = LAMBERT_N * (lambda - LAMBERT_LON0)

  return {
    x: LAMBERT_XS + R * Math.sin(gamma),
    y: LAMBERT_YS - R * Math.cos(gamma),
  }
}

/** Coordonnées WGS84 effectives d'une fiche : natives si présentes, sinon
 * converties depuis Lambert93. Renvoie null si aucune des deux n'est
 * exploitable. */
function coordonneesEffectives(row: ProspectRow): { lat: number; lon: number } | null {
  if (typeof row.latitude === 'number' && Number.isFinite(row.latitude) && typeof row.longitude === 'number' && Number.isFinite(row.longitude)) {
    return { lat: row.latitude, lon: row.longitude }
  }
  const converted = lambert93ToWgs84(row.coordonneeLambertAbscisseEtablissement, row.coordonneeLambertOrdonneeEtablissement)
  if (!converted) return null
  return { lat: converted.latitude, lon: converted.longitude }
}

export default function MobileProspects() {
  const [position, setPosition] = useState<UserPosition | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  // Filtres réglés AVANT d'afficher la carte.
  const [filtresValides, setFiltresValides] = useState(false)
  const [radiusKm, setRadiusKm] = useState(25)
  const [secteursActifs, setSecteursActifs] = useState<Set<string>>(new Set())
  const [rgeSeul, setRgeSeul] = useState(false)
  const [ancienneteMax, setAncienneteMax] = useState<AnciennetePreset>(ANCIENNETE_PRESETS[0]) // "Tout" par défaut

  const [prospects, setProspects] = useState<ProspectRowGeo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [selected, setSelected] = useState<ProspectRowGeo | null>(null)
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
    if (!position || !filtresValides) return
    let cancelled = false

    async function charger() {
      setLoading(true)
      setLoadError(null)
      try {
        // Boîte englobante en Lambert93 : projection métrique, donc un
        // rayon en km se traduit directement en mètres, sans les
        // approximations de longitude/latitude en degrés.
        const { x: x0, y: y0 } = wgs84ToLambert93(position!.lat, position!.lng)
        const rayonM = radiusKm * 1000

        const { data, error } = await supabase
          .from('clients')
          .select(
            'id, siret, raison_sociale_affichee, activitePrincipaleEtablissement, naf_libelle_traduit, codePostalEtablissement, libelleCommuneEtablissement, latitude, longitude, coordonneeLambertAbscisseEtablissement, coordonneeLambertOrdonneeEtablissement, telephone, email, nom_dirigeant, prospect_status, prospect_comment, present_dans_cegeclim, dateCreationEtablissement, etatAdministratifUniteLegale, rge, capacite_gaz',
          )
          .not('coordonneeLambertAbscisseEtablissement', 'is', null)
          .not('coordonneeLambertOrdonneeEtablissement', 'is', null)
          .gte('coordonneeLambertAbscisseEtablissement', x0 - rayonM)
          .lte('coordonneeLambertAbscisseEtablissement', x0 + rayonM)
          .gte('coordonneeLambertOrdonneeEtablissement', y0 - rayonM)
          .lte('coordonneeLambertOrdonneeEtablissement', y0 + rayonM)
          .limit(3000)

        if (cancelled) return
        if (error) throw error

        const rawRows = (data || []) as ProspectRow[]

        // Croisement ref_tiers (comme le desktop) : exclut les entreprises
        // déjà clientes CEGECLIM, actives OU en sommeil.
        const siretsEnvisages = Array.from(new Set(rawRows.map((r) => normalizeSiret(r.siret)).filter(Boolean)))
        let siretsDejaCegeclim = new Set<string>()
        if (siretsEnvisages.length > 0) {
          const { data: refTiersData, error: refTiersError } = await supabase
            .from('ref_tiers')
            .select('siret, mise_en_sommeil')
            .in('siret', siretsEnvisages)

          if (refTiersError) {
            console.warn('[MobileProspects] lecture ref_tiers impossible :', refTiersError.message)
          } else {
            siretsDejaCegeclim = new Set(
              ((refTiersData || []) as RefTiersRow[]).map((row) => normalizeSiret(row.siret)).filter(Boolean),
            )
          }
        }

        const rows: ProspectRowGeo[] = []
        for (const r of rawRows) {
          if (String(r.etatAdministratifUniteLegale || '').trim().toUpperCase() === 'C') continue

          const siret = normalizeSiret(r.siret)
          if (siret && siretsDejaCegeclim.has(siret)) continue

          const coords = coordonneesEffectives(r)
          if (!coords) continue

          const dist = distanceKmWgs84(position!.lat, position!.lng, coords.lat, coords.lon)
          if (dist > radiusKm) continue

          rows.push({ ...r, latEff: coords.lat, lonEff: coords.lon })
        }

        setProspects(rows)
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'Erreur de chargement.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void charger()
    return () => { cancelled = true }
  }, [position, filtresValides, radiusKm])

  const secteursDisponibles = useMemo(() => {
    return Array.from(new Set(prospects.map((p) => getSectorLabel(p)))).sort()
  }, [prospects])

  const prospectsFiltres = useMemo(() => {
    return prospects.filter((p) => {
      const sector = getSectorLabel(p)
      if (secteursActifs.size > 0 && !secteursActifs.has(sector)) return false
      if (rgeSeul && !p.rge) return false
      if (ancienneteMax.maxDays != null) {
        const age = diffDaysFromToday(p.dateCreationEtablissement)
        if (age == null || age < 0 || age > ancienneteMax.maxDays) return false
      }
      return true
    })
  }, [prospects, secteursActifs, rgeSeul, ancienneteMax])

  function toggleSecteur(sector: string) {
    setSecteursActifs((prev) => {
      const next = new Set(prev)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }

  function ouvrirDetail(p: ProspectRowGeo) {
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

  // ── Écran 1 : filtres, affiché AVANT la carte ─────────────────────────
  if (!filtresValides) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 18px 28px', gap: 18, overflowY: 'auto' }}>
        {geoError ? (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(193,104,60,0.14)', border: '1px solid rgba(193,104,60,0.32)', color: '#e0a685', fontSize: 12.5 }}>
            {geoError}
            <button type="button" onClick={localiser} style={{ display: 'block', marginTop: 6, background: 'none', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
              Réessayer
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
            {locating ? 'Localisation en cours…' : position ? 'Position trouvée.' : 'En attente de la position…'}
          </div>
        )}

        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Rayon de recherche</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RADIUS_PRESETS_KM.map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => setRadiusKm(km)}
                style={{
                  padding: '10px 16px', borderRadius: 999, border: '1px solid rgba(75,146,172,0.4)',
                  background: radiusKm === km ? 'rgba(75,146,172,0.35)' : 'rgba(75,146,172,0.1)',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                }}
              >
                {km} km
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Ancienneté de l'entreprise</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ANCIENNETE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => setAncienneteMax(preset)}
                style={{
                  padding: '10px 16px', borderRadius: 999, border: '1px solid rgba(166,161,129,0.4)',
                  background: ancienneteMax.key === preset.key ? 'rgba(166,161,129,0.35)' : 'rgba(166,161,129,0.1)',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, color: '#fff', fontWeight: 600 }}>
          <input type="checkbox" checked={rgeSeul} onChange={(e) => setRgeSeul(e.target.checked)} style={{ width: 20, height: 20 }} />
          RGE uniquement
        </label>

        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
          Le secteur d'activité pourra être filtré une fois les résultats chargés, depuis le bouton "Filtres" sur la carte.
        </div>

        <button
          type="button"
          onClick={() => setFiltresValides(true)}
          disabled={!position}
          style={{
            marginTop: 'auto', width: '100%', padding: '15px', borderRadius: 14,
            border: 'none', background: position ? '#A6A181' : 'rgba(166,161,129,0.3)',
            color: '#141A26', fontSize: 15.5, fontWeight: 700,
            cursor: position ? 'pointer' : 'default',
          }}
        >
          {position ? 'Voir la carte' : 'En attente de la position…'}
        </button>
      </div>
    )
  }

  // ── Écran 2 : carte ────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
        <button
          type="button"
          onClick={() => setFiltresValides(false)}
          style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '7px 10px', fontSize: 12 }}
        >
          ← Rayon/ancienneté
        </button>
        <div style={{ flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
          {loading ? 'Recherche…' : loadError ? loadError : `${prospectsFiltres.length} prospect${prospectsFiltres.length > 1 ? 's' : ''} · ${radiusKm} km`}
        </div>
        <button
          type="button"
          onClick={() => setFiltresOuverts(true)}
          style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', borderRadius: 10, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}
        >
          ⚙️ Filtres
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {position && (
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
                  center={[p.latEff, p.lonEff]}
                  radius={7}
                  pathOptions={{ color: '#0f172a', fillColor: getSectorColor(sector), fillOpacity: 0.95, weight: 1.5 }}
                  eventHandlers={{ click: () => ouvrirDetail(p) }}
                />
              )
            })}
          </MapContainer>
        )}
      </div>

      {/* ---- Tiroir filtres (secteur + RGE + ancienneté, rayon incl.) ---- */}
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

            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Ancienneté</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {ANCIENNETE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setAncienneteMax(preset)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(166,161,129,0.4)',
                    background: ancienneteMax.key === preset.key ? 'rgba(166,161,129,0.35)' : 'rgba(166,161,129,0.1)',
                    color: '#fff', fontSize: 13, fontWeight: 700,
                  }}
                >
                  {preset.label}
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
                ['Distance', `${distanceKmWgs84(position!.lat, position!.lng, selected.latEff, selected.lonEff)} km`],
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
