'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
// CORRECTIF carte invisible : react-leaflet a besoin de son propre CSS pour
// positionner les tuiles et donner une hauteur réelle au conteneur -- sans
// cet import, la carte reste vide/collabsée même quand tout le reste
// (position, requête, marqueurs) fonctionne. Le desktop doit le charger
// globalement ailleurs dans l'app ; ce fichier mobile ne l'avait jamais.
import 'leaflet/dist/leaflet.css'
import { supabase } from '@/lib/supabaseClient'
import { NavigationChoiceSheet, PhoneChoiceSheet } from './MobileActionSheets'

// ─────────────────────────────────────────────────────────────────────────
// Version mobile de "Prospects autour de moi", branchée sur les mêmes
// principes que la carte de l'écran Clients desktop (app/clients/page.tsx).
//
// v2 -> v3 :
// - Requête basée sur les coordonnées Lambert93 (bien mieux renseignées que
//   latitude/longitude), avec conversion à la volée -- corrige le "0
//   prospect" quasi partout de la v1.
// - leaflet.css importé -- corrige la carte invisible malgré des données
//   chargées.
// - Filtres étendus : capacité gaz et capital social, en plus de secteur/
//   type d'activité, RGE et ancienneté -- disponibles avant la carte
//   (options fixes, ne dépendent pas des données chargées) ET dans le
//   tiroir une fois la carte affichée.
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
  adresse_complete: string | null
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
  capital_social: string | null
}

/** Fiche enrichie avec des coordonnées WGS84 garanties (natives ou
 * converties depuis Lambert93), prête pour affichage/calcul de distance. */
type ProspectRowGeo = ProspectRow & {
  latEff: number
  lonEff: number
  /** true si l'entreprise est déjà cliente CEGECLIM (trouvée dans ref_tiers
   * par SIRET, active ou en sommeil) -- avant, ces fiches étaient
   * simplement exclues ; l'écran "Carte Prospects & Clients" les affiche
   * maintenant aussi, togglable via le filtre "Client CEGECLIM". */
  estClientCegeclim: boolean
  /** Collaborateur en charge (ref_tiers.representant), uniquement pour
   * les fiches déjà clientes -- null pour un prospect pur. */
  representant: string | null
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
// Raccourcis pratiques (région d'activité habituelle) -- n'importe quel
// autre département reste saisissable via le champ texte libre, ce n'est
// pas une liste fermée.
const DEPARTEMENTS_RACCOURCIS = ['85', '44', '49', '79', '17', '86']

type AnciennetePreset = { key: string; label: string; maxDays: number | null }
const ANCIENNETE_PRESETS: AnciennetePreset[] = [
  { key: 'tout', label: 'Tout', maxDays: null },
  { key: '3m', label: '< 3 mois', maxDays: 90 },
  { key: '1a', label: '< 1 an', maxDays: 365 },
  { key: '3a', label: '< 3 ans', maxDays: 1095 },
]

// Mêmes tranches que côté desktop (app/clients/page.tsx,
// CAPITAL_SOCIAL_FILTER_OPTIONS) -- à garder synchronisées si elles changent
// là-bas.
type CapitalSocialOption = 'NC' | '<= 1 000€' | '>1 000€' | '>5000€' | '>9999€'
const CAPITAL_SOCIAL_OPTIONS: CapitalSocialOption[] = ['NC', '<= 1 000€', '>1 000€', '>5000€', '>9999€']

function parseCapitalSocialNumber(value: string | null | undefined): number | null {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return null
  const cleaned = raw.replace('EUR', '').replace(/\s/g, '').replace(',', '.').trim()
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}
function matchesCapitalSocial(value: string | null | undefined, selected: Set<CapitalSocialOption>): boolean {
  if (selected.size === 0) return true
  const amount = parseCapitalSocialNumber(value)
  const isNc = amount == null
  return Array.from(selected).some((filter) => {
    switch (filter) {
      case 'NC': return isNc
      case '<= 1 000€': return amount != null && amount <= 1000
      case '>1 000€': return amount != null && amount > 1000
      case '>5000€': return amount != null && amount > 5000
      case '>9999€': return amount != null && amount > 9999
      default: return true
    }
  })
}

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

type RefTiersRow = { siret: string | null; mise_en_sommeil: string | boolean | null; representant: string | null }

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

function formatAdresseComplete(row: Pick<ProspectRow, 'adresse_complete' | 'codePostalEtablissement' | 'libelleCommuneEtablissement'>): string {
  if (row.adresse_complete && row.adresse_complete.trim()) return row.adresse_complete.trim()
  return [row.codePostalEtablissement, row.libelleCommuneEtablissement].filter(Boolean).join(' ')
}

// ── Projection Lambert93 (RGF93) <-> WGS84 ─────────────────────────────
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
  // Géolocalisation rendue optionnelle : par défaut activée (comportement
  // inchangé), mais désactivable -- dans ce cas la recherche ne dépend
  // plus d'un rayon autour d'une position, mais du filtre "Département"
  // (ou de rien du tout si aucun département n'est choisi non plus,
  // auquel cas toute la base suivie est interrogée, avec une limite de
  // sécurité). La vue "Carte" nécessite toujours une position réelle pour
  // avoir un centre : désactivée quand la géolocalisation est éteinte.
  const [geolocalisationActivee, setGeolocalisationActivee] = useState(true)
  const [departementFiltre, setDepartementFiltre] = useState('')

  // Filtres réglés AVANT d'afficher la carte -- tous à options fixes,
  // aucun ne dépend des données chargées (contrairement au secteur, qui
  // n'est connu qu'une fois les résultats arrivés).
  const [filtresValides, setFiltresValides] = useState(false)
  const [radiusKm, setRadiusKm] = useState(25)
  const [rgeSeul, setRgeSeul] = useState(false)
  const [capaciteGazSeul, setCapaciteGazSeul] = useState(false)
  const [ancienneteMax, setAncienneteMax] = useState<AnciennetePreset>(ANCIENNETE_PRESETS[0]) // "Tout" par défaut
  const [capitalSocialActifs, setCapitalSocialActifs] = useState<Set<CapitalSocialOption>>(new Set())
  // Le pavé d'accueil s'appelle désormais "Carte Prospects & Clients" :
  // l'écran affiche maintenant les deux catégories, chacune togglable
  // indépendamment (avant : les clients CEGECLIM étaient toujours exclus
  // sans possibilité de les afficher).
  const [afficherProspects, setAfficherProspects] = useState(true)
  const [afficherClients, setAfficherClients] = useState(true)
  const [collaborateurFiltre, setCollaborateurFiltre] = useState('')
  const [collaborateursDisponibles, setCollaborateursDisponibles] = useState<string[]>([])

  const [secteursActifs, setSecteursActifs] = useState<Set<string>>(new Set())

  const [prospects, setProspects] = useState<ProspectRowGeo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [diagnosticRecherche, setDiagnosticRecherche] = useState<{
    position: { lat: number; lng: number } | null
    rayonKm: number | null
    departement: string | null
    candidatsBruts: number
    exclusFerme: number
    exclusSansCoords: number
    exclusDistance: number
    apresFiltrageGeo: number
    siretsVerifies: number
    siretsReconnus: number
    refTiersErreur: string | null
  } | null>(null)
  const [diagnosticRechercheOuvert, setDiagnosticRechercheOuvert] = useState(false)

  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [vue, setVue] = useState<'liste' | 'carte'>('liste')
  const [selected, setSelected] = useState<ProspectRowGeo | null>(null)
  const [statutBrouillon, setStatutBrouillon] = useState<ProspectStatusValue>('')
  const [commentaireBrouillon, setCommentaireBrouillon] = useState('')
  const [saving, setSaving] = useState(false)
  const [navigationVers, setNavigationVers] = useState<{ adresse: string; lat?: number | null; lon?: number | null } | null>(null)
  const [appelVers, setAppelVers] = useState<string | null>(null)

  const mapRef = useRef<any>(null)
  const mapWrapperRef = useRef<HTMLDivElement | null>(null)
  const [mapHeightPx, setMapHeightPx] = useState(0)
  // Journal de diagnostic affiché à l'écran (bouton "🔧 Diagnostic" sous la
  // carte) -- après deux correctifs à l'aveugle sans succès (CSS manquant,
  // puis invalidateSize mal déclenché), la seule façon de vraiment
  // résoudre le problème est de voir l'erreur réelle sans debug distant.
  const [journalCarte, setJournalCarte] = useState<string[]>([])
  const [diagnosticOuvert, setDiagnosticOuvert] = useState(false)
  function logCarte(message: string) {
    const ts = new Date().toLocaleTimeString('fr-FR')
    setJournalCarte((prev) => [...prev.slice(-29), `${ts}  ${message}`])
  }

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

  // Liste des collaborateurs pour le filtre "Collaborateur" -- chargée une
  // seule fois (liste de référence indépendante du rayon/position), à
  // partir des clients CEGECLIM déjà connus en base (ref_tiers.representant).
  useEffect(() => {
    let cancelled = false
    async function charger() {
      const { data, error } = await supabase
        .from('ref_tiers')
        .select('representant')
        .not('representant', 'is', null)
        .not('representant', 'eq', '')
      if (cancelled || error) return
      const distincts = Array.from(new Set((data || []).map((r: any) => String(r.representant || '').trim()).filter(Boolean))).sort()
      setCollaborateursDisponibles(distincts)
    }
    void charger()
    return () => { cancelled = true }
  }, [])

  // CORRECTIF carte blanche, cette fois confirmé par le diagnostic à
  // l'écran : Leaflet mesurait son conteneur à 362×0px au montage (hauteur
  // nulle), alors que le <div> parent affichait déjà 362×689px au même
  // instant -- la chaîne CSS "flex:1 -> height:100% -> height:100%" ne se
  // résolvait jamais correctement (bug de timing/cascade CSS, confirmé par
  // le fait qu'invalidateSize() tournait 10 fois sans jamais rien changer :
  // la hauteur réelle du conteneur Leaflet restait 0 en continu, pas juste
  // au tout premier instant).
  //
  // Solution robuste : ne plus dépendre du tout d'un height:100% en
  // cascade. On mesure la hauteur RÉELLE du conteneur en pixels via JS, et
  // on ne monte MapContainer qu'une fois cette mesure disponible, avec
  // cette valeur fixe en pixels (pas de pourcentage) -- Leaflet reçoit
  // alors une hauteur définitive dès son tout premier rendu.
  useEffect(() => {
    if (vue !== 'carte' || !filtresValides || !position) {
      setMapHeightPx(0)
      return
    }

    logCarte('Écran carte affiché -- mesure directe de la hauteur en pixels')

    function surErreur(e: ErrorEvent) {
      logCarte(`❌ Erreur JS : ${e.message} (${e.filename?.split('/').pop() || '?'}:${e.lineno})`)
    }
    function surRejetNonGere(e: PromiseRejectionEvent) {
      logCarte(`❌ Promesse rejetée : ${String(e.reason?.message || e.reason || '?')}`)
    }
    window.addEventListener('error', surErreur)
    window.addEventListener('unhandledrejection', surRejetNonGere)

    function mesurer() {
      const h = mapWrapperRef.current?.getBoundingClientRect().height || 0
      if (h > 0) {
        setMapHeightPx(Math.round(h))
        logCarte(`✅ Hauteur mesurée en pixels : ${Math.round(h)}px`)
      }
    }

    // Mesure immédiate + une seconde passe après le premier paint (au cas
    // où la toute première mesure tombe encore avant la stabilisation du
    // flex), + un écouteur resize pour suivre les rotations d'écran.
    mesurer()
    const t = window.setTimeout(mesurer, 150)
    window.addEventListener('resize', mesurer)

    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', mesurer)
      window.removeEventListener('error', surErreur)
      window.removeEventListener('unhandledrejection', surRejetNonGere)
    }
  }, [vue, filtresValides, position])

  useEffect(() => {
    if (!filtresValides) return
    // Si la géolocalisation est activée, on attend une position avant de
    // charger quoi que ce soit (comme avant). Si elle est désactivée, on
    // charge sans attendre -- la recherche repose alors sur le département
    // (ou sur toute la base suivie si aucun département n'est choisi non
    // plus).
    if (geolocalisationActivee && !position) return
    let cancelled = false

    async function charger() {
      setLoading(true)
      setLoadError(null)
      try {
        const champs =
          'id, siret, raison_sociale_affichee, activitePrincipaleEtablissement, naf_libelle_traduit, codePostalEtablissement, libelleCommuneEtablissement, adresse_complete, latitude, longitude, coordonneeLambertAbscisseEtablissement, coordonneeLambertOrdonneeEtablissement, telephone, email, nom_dirigeant, prospect_status, prospect_comment, present_dans_cegeclim, dateCreationEtablissement, etatAdministratifUniteLegale, rge, capacite_gaz, capital_social'

        let requete = supabase.from('clients').select(champs)

        if (geolocalisationActivee && position) {
          // Mode géolocalisé : boîte Lambert93 autour de la position, comme
          // avant. BUG CORRIGÉ précédemment : cette requête n'avait aucun
          // tri, avec une limite à 3000 -- la boîte grandit avec le rayon
          // (environ ×4 en surface pour un rayon doublé), et sans tri,
          // PostgREST pouvait couper arbitrairement des lignes pourtant
          // plus proches. Limite remontée à 20000.
          const { x: x0, y: y0 } = wgs84ToLambert93(position.lat, position.lng)
          const rayonM = radiusKm * 1000
          requete = requete
            .not('coordonneeLambertAbscisseEtablissement', 'is', null)
            .not('coordonneeLambertOrdonneeEtablissement', 'is', null)
            .gte('coordonneeLambertAbscisseEtablissement', x0 - rayonM)
            .lte('coordonneeLambertAbscisseEtablissement', x0 + rayonM)
            .gte('coordonneeLambertOrdonneeEtablissement', y0 - rayonM)
            .lte('coordonneeLambertOrdonneeEtablissement', y0 + rayonM)
            .limit(20000)
        } else {
          // Mode sans géolocalisation : pas de boîte géographique -- on
          // filtre directement par département en base si renseigné
          // (beaucoup plus efficace que de tout charger puis filtrer côté
          // client), sinon on interroge toute la base suivie avec une
          // limite de sécurité raisonnable (le volume total suivi tourne
          // autour de quelques milliers de lignes, largement en dessous).
          if (departementFiltre.trim()) {
            requete = requete.ilike('codePostalEtablissement', `${departementFiltre.trim()}%`)
          }
          requete = requete.limit(6000)
        }

        const { data, error } = await requete

        if (cancelled) return
        if (error) throw error
        if (data && data.length >= 20000) {
          console.warn(
            '[MobileProspects] La requête a atteint la limite de 20000 lignes -- des résultats pourraient encore manquer sur un très grand rayon dans une zone très dense. Augmenter la limite si ça se reproduit.',
          )
        }

        const rawRows = (data || []) as ProspectRow[]

        const siretsEnvisages = Array.from(new Set(rawRows.map((r) => normalizeSiret(r.siret)).filter(Boolean)))
        // Map siret -> representant plutôt qu'un simple Set : on n'exclut
        // plus les clients CEGECLIM ici, on les annote pour que
        // prospectsFiltres puisse les inclure/exclure dynamiquement selon
        // les filtres "Client CEGECLIM" / "Collaborateur" (togglables sans
        // recharger les données).
        //
        // BUG CORRIGÉ : sur un grand rayon (ex. 2107 candidats bruts à
        // 50 km, confirmé par le diagnostic à l'écran), un seul
        // .in('siret', [...]) avec autant de valeurs produit une URL de
        // dizaines de Ko -- au-delà de ce que la plupart des serveurs/
        // proxys acceptent (souvent ~8 Ko). La requête échouait
        // silencieusement (erreur juste logguée en console.warn), laissant
        // la correspondance CEGECLIM entièrement vide : TOUTES les lignes
        // retombaient à "prospect", et avec le filtre "Client CEGECLIM
        // uniquement" activé, plus rien ne passait. Découpage en lots de
        // 200 SIRET, en parallèle, pour rester largement sous toute limite
        // d'URL quel que soit le nombre de candidats.
        let clientsCegeclimParSiret = new Map<string, string | null>()
        let refTiersErreur: string | null = null
        if (siretsEnvisages.length > 0) {
          const TAILLE_LOT = 200
          const lots: string[][] = []
          for (let i = 0; i < siretsEnvisages.length; i += TAILLE_LOT) {
            lots.push(siretsEnvisages.slice(i, i + TAILLE_LOT))
          }

          const resultats = await Promise.all(
            lots.map((lot) =>
              supabase
                .from('ref_tiers')
                .select('siret, mise_en_sommeil, representant')
                .in('siret', lot)
                .limit(lot.length),
            ),
          )

          const erreurs = resultats.filter((r) => r.error)
          if (erreurs.length > 0) {
            refTiersErreur = erreurs[0].error!.message
            console.warn('[MobileProspects] lecture ref_tiers impossible sur au moins un lot :', erreurs.map((e) => e.error!.message))
          }

          const toutesLesLignes = resultats.flatMap((r) => (r.data || []) as RefTiersRow[])
          clientsCegeclimParSiret = new Map(
            toutesLesLignes
              .map((row) => [normalizeSiret(row.siret), row.representant ? String(row.representant).trim() : null] as const)
              .filter(([siret]) => Boolean(siret)),
          )
        }

        // Diagnostic : compte combien de lignes sont écartées à chaque
        // étape, pour voir précisément où le total tombe à zéro sans
        // avoir à deviner. Affiché sur l'écran liste (bouton "🔧
        // Diagnostic"), comme le panneau déjà présent sur l'écran carte.
        let exclusFerme = 0
        let exclusSansCoords = 0
        let exclusDistance = 0

        const rows: ProspectRowGeo[] = []
        for (const r of rawRows) {
          if (String(r.etatAdministratifUniteLegale || '').trim().toUpperCase() === 'C') { exclusFerme++; continue }

          const siret = normalizeSiret(r.siret)
          const estClientCegeclim = siret ? clientsCegeclimParSiret.has(siret) : false
          const representant = siret ? clientsCegeclimParSiret.get(siret) ?? null : null

          const coords = coordonneesEffectives(r)
          if (!coords) { exclusSansCoords++; continue }

          // Le filtre de distance exacte ne s'applique qu'en mode
          // géolocalisé -- sans position, la boîte géographique n'existe
          // pas non plus, donc rien à comparer à un rayon.
          if (position) {
            const dist = distanceKmWgs84(position.lat, position.lng, coords.lat, coords.lon)
            if (dist > radiusKm) { exclusDistance++; continue }
          }

          rows.push({ ...r, latEff: coords.lat, lonEff: coords.lon, estClientCegeclim, representant })
        }

        setDiagnosticRecherche({
          position: position ? { lat: position.lat, lng: position.lng } : null,
          rayonKm: geolocalisationActivee && position ? radiusKm : null,
          departement: departementFiltre.trim() || null,
          candidatsBruts: rawRows.length,
          exclusFerme,
          exclusSansCoords,
          exclusDistance,
          apresFiltrageGeo: rows.length,
          siretsVerifies: siretsEnvisages.length,
          siretsReconnus: clientsCegeclimParSiret.size,
          refTiersErreur,
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
  }, [position, filtresValides, radiusKm, geolocalisationActivee, departementFiltre])

  const prospectsFiltres = useMemo(() => {
    return prospects.filter((p) => {
      // Client CEGECLIM / Prospect : deux interrupteurs indépendants,
      // pas un choix exclusif -- si les deux sont éteints, rien ne
      // s'affiche (comportement attendu, pas un bug).
      if (p.estClientCegeclim) {
        if (!afficherClients) return false
        if (collaborateurFiltre && p.representant !== collaborateurFiltre) return false
      } else {
        if (!afficherProspects) return false
      }

      const sector = getSectorLabel(p)
      if (secteursActifs.size > 0 && !secteursActifs.has(sector)) return false
      if (rgeSeul && !p.rge) return false
      if (capaciteGazSeul && !p.capacite_gaz) return false
      if (!matchesCapitalSocial(p.capital_social, capitalSocialActifs)) return false
      if (departementFiltre.trim() && !String(p.codePostalEtablissement || '').startsWith(departementFiltre.trim())) return false
      if (ancienneteMax.maxDays != null) {
        const age = diffDaysFromToday(p.dateCreationEtablissement)
        if (age == null || age < 0 || age > ancienneteMax.maxDays) return false
      }
      return true
    })
  }, [prospects, secteursActifs, rgeSeul, capaciteGazSeul, capitalSocialActifs, ancienneteMax, afficherClients, afficherProspects, collaborateurFiltre, departementFiltre])

  function toggleSecteur(sector: string) {
    setSecteursActifs((prev) => {
      const next = new Set(prev)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }
  function toggleCapitalSocial(option: CapitalSocialOption) {
    setCapitalSocialActifs((prev) => {
      const next = new Set(prev)
      if (next.has(option)) next.delete(option)
      else next.add(option)
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

  // Bloc de filtres réutilisé (options fixes) sur l'écran d'avant-carte ET
  // dans le tiroir sur la carte, pour rester cohérent.
  function BlocFiltresFixes({ compact }: { compact: boolean }) {
    const [dimensionOuverte, setDimensionOuverte] = useState<
      null | 'rayon' | 'anciennete' | 'capital' | 'secteur' | 'collaborateur' | 'departement'
    >(null)

    const resumeRayon = `${radiusKm} km`
    const resumeAnciennete = ancienneteMax.label
    const resumeCapital = capitalSocialActifs.size === 0 ? 'Tous' : `${capitalSocialActifs.size} sélection${capitalSocialActifs.size > 1 ? 's' : ''}`
    const resumeSecteur = secteursActifs.size === 0 ? 'Tous' : `${secteursActifs.size} sélection${secteursActifs.size > 1 ? 's' : ''}`
    const resumeCollaborateur = collaborateurFiltre || 'Tous'
    const resumeDepartement = departementFiltre.trim() || 'Tous'

    return (
      <>
        {/* Client CEGECLIM / Prospect : deux interrupteurs simples, pas
           besoin d'un sous-tiroir pour un Oui/Non. */}
        <LigneInterrupteur label="Client CEGECLIM" valeur={afficherClients} onChange={setAfficherClients} compact={compact} />
        <LigneInterrupteur label="Prospect" valeur={afficherProspects} onChange={setAfficherProspects} compact={compact} />

        {/* Géolocalisation : désactivable -- dans ce cas la recherche ne
           dépend plus d'un rayon autour d'une position, mais du filtre
           "Département" (ou de rien, auquel cas toute la base suivie est
           interrogée). Le rayon est grisé quand la géolocalisation est
           éteinte, puisqu'il ne s'applique plus. */}
        <LigneInterrupteur label="Géolocalisation" valeur={geolocalisationActivee} onChange={setGeolocalisationActivee} compact={compact} />
        <LigneDimension
          label="Rayon de recherche"
          valeur={geolocalisationActivee ? resumeRayon : 'Non applicable'}
          onClick={() => geolocalisationActivee && setDimensionOuverte('rayon')}
          compact={compact}
          desactive={!geolocalisationActivee}
        />
        <LigneDimension label="Département" valeur={resumeDepartement} onClick={() => setDimensionOuverte('departement')} compact={compact} />

        {/* Collaborateur : ne filtre que les clients CEGECLIM (les
           prospects n'ont pas de représentant assigné) -- grisé si les
           clients CEGECLIM sont masqués, pour que ce soit clair. */}
        <LigneDimension
          label="Collaborateur"
          valeur={resumeCollaborateur}
          onClick={() => afficherClients && setDimensionOuverte('collaborateur')}
          compact={compact}
          desactive={!afficherClients}
        />

        <LigneDimension label="Ancienneté" valeur={resumeAnciennete} onClick={() => setDimensionOuverte('anciennete')} compact={compact} />
        <LigneDimension label="Capital social" valeur={resumeCapital} onClick={() => setDimensionOuverte('capital')} compact={compact} />
        <LigneDimension label="Secteur / type d'activité" valeur={resumeSecteur} onClick={() => setDimensionOuverte('secteur')} compact={compact} />

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: compact ? 13.5 : 14.5, color: '#fff', fontWeight: 600 }}>
            <input type="checkbox" checked={rgeSeul} onChange={(e) => setRgeSeul(e.target.checked)} style={{ width: compact ? 18 : 20, height: compact ? 18 : 20 }} />
            RGE uniquement
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: compact ? 13.5 : 14.5, color: '#fff', fontWeight: 600 }}>
            <input type="checkbox" checked={capaciteGazSeul} onChange={(e) => setCapaciteGazSeul(e.target.checked)} style={{ width: compact ? 18 : 20, height: compact ? 18 : 20 }} />
            Capacité gaz uniquement
          </label>
        </div>

        {/* ---- Sous-tiroir de détail, un seul à la fois ---- */}
        {dimensionOuverte && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={() => setDimensionOuverte(null)}
          >
            <div
              style={{ width: '100%', maxWidth: 480, maxHeight: '75vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />

              {dimensionOuverte === 'rayon' && (
                <>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Rayon de recherche</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {RADIUS_PRESETS_KM.map((km) => (
                      <button key={km} type="button" onClick={() => setRadiusKm(km)} style={chipStyle(radiusKm === km, '75,146,172', '10px 16px', 14)}>
                        {km} km
                      </button>
                    ))}
                  </div>
                </>
              )}

              {dimensionOuverte === 'departement' && (
                <>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Département</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setDepartementFiltre('')} style={chipStyle(departementFiltre.trim() === '', '166,161,129', '10px 16px', 14)}>
                      Tous
                    </button>
                    {DEPARTEMENTS_RACCOURCIS.map((dept) => (
                      <button key={dept} type="button" onClick={() => setDepartementFiltre(dept)} style={chipStyle(departementFiltre.trim() === dept, '166,161,129', '10px 16px', 14)}>
                        {dept}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Ou saisir un autre code (2 ou 3 chiffres)</div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={departementFiltre}
                      onChange={(e) => setDepartementFiltre(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                      placeholder="Ex. 44"
                      style={{ width: '100%', height: 44, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#fff', padding: '0 12px', fontSize: 15 }}
                    />
                  </div>
                </>
              )}

              {dimensionOuverte === 'anciennete' && (
                <>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Ancienneté</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ANCIENNETE_PRESETS.map((preset) => (
                      <button key={preset.key} type="button" onClick={() => setAncienneteMax(preset)} style={chipStyle(ancienneteMax.key === preset.key, '166,161,129', '10px 16px', 14)}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {dimensionOuverte === 'capital' && (
                <>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Capital social</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {CAPITAL_SOCIAL_OPTIONS.map((option) => (
                      <button key={option} type="button" onClick={() => toggleCapitalSocial(option)} style={chipStyle(capitalSocialActifs.has(option), '224,169,74', '10px 16px', 14)}>
                        {option}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {dimensionOuverte === 'secteur' && (
                <>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Secteur / type d'activité</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {TRACKED_SECTORS.map((sector) => {
                      const actif = secteursActifs.has(sector.label)
                      return (
                        <button
                          key={sector.label}
                          type="button"
                          onClick={() => toggleSecteur(sector.label)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 999,
                            border: `1px solid ${actif ? sector.color : 'rgba(255,255,255,0.18)'}`,
                            background: actif ? `${sector.color}33` : 'rgba(255,255,255,0.04)',
                            color: '#fff', fontSize: 13.5, fontWeight: 700,
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: sector.color }} />
                          {sector.label}
                        </button>
                      )
                    })}
                    {secteursActifs.size > 0 && (
                      <button type="button" onClick={() => setSecteursActifs(new Set())} style={{ padding: '9px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 13.5 }}>
                        Effacer
                      </button>
                    )}
                  </div>
                </>
              )}

              {dimensionOuverte === 'collaborateur' && (
                <>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Collaborateur</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: -8 }}>
                    Filtre uniquement les clients CEGECLIM affichés -- sans effet sur les prospects.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setCollaborateurFiltre('')}
                      style={{ ...ligneOptionStyle(collaborateurFiltre === '') }}
                    >
                      Tous
                    </button>
                    {collaborateursDisponibles.map((c) => (
                      <button key={c} type="button" onClick={() => setCollaborateurFiltre(c)} style={ligneOptionStyle(collaborateurFiltre === c)}>
                        {c}
                      </button>
                    ))}
                    {collaborateursDisponibles.length === 0 && (
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Aucun collaborateur trouvé.</div>
                    )}
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => setDimensionOuverte(null)}
                style={{ marginTop: 6, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: '#A6A181', color: '#141A26', fontSize: 14, fontWeight: 700 }}
              >
                OK
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── Écran 1 : filtres, affiché AVANT la carte ─────────────────────────
  if (!filtresValides) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 18px 28px', gap: 18, overflowY: 'auto' }}>
        {geolocalisationActivee ? (
          geoError ? (
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
          )
        ) : (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)' }}>
            Géolocalisation désactivée -- la recherche porte sur le département choisi ci-dessous (ou sur toute la base suivie si aucun n'est choisi).
          </div>
        )}

        <BlocFiltresFixes compact={false} />

        <div style={{ marginTop: 'auto', display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => { setVue('liste'); setFiltresValides(true) }}
            disabled={geolocalisationActivee && !position}
            style={{
              flex: 1, padding: '15px', borderRadius: 14,
              border: 'none', background: (!geolocalisationActivee || position) ? '#A6A181' : 'rgba(166,161,129,0.3)',
              color: '#141A26', fontSize: 15, fontWeight: 700,
              cursor: (!geolocalisationActivee || position) ? 'pointer' : 'default',
            }}
          >
            {!geolocalisationActivee || position ? '📋 Voir la liste' : '…'}
          </button>
          <button
            type="button"
            onClick={() => { setVue('carte'); setFiltresValides(true) }}
            disabled={!position}
            title={!geolocalisationActivee ? "La carte nécessite une position réelle -- réactive la géolocalisation pour l'utiliser." : undefined}
            style={{
              flex: 1, padding: '15px', borderRadius: 14,
              border: `1px solid ${position ? 'rgba(75,146,172,0.5)' : 'rgba(75,146,172,0.2)'}`,
              background: position ? 'rgba(75,146,172,0.18)' : 'rgba(75,146,172,0.06)',
              color: '#fff', fontSize: 15, fontWeight: 700,
              cursor: position ? 'pointer' : 'default',
            }}
          >
            {position ? '🗺️ Voir la carte' : !geolocalisationActivee ? '🗺️ Carte (géoloc requise)' : 'En attente…'}
          </button>
        </div>
      </div>
    )
  }

  // ── Écran 2 : résultats (liste par défaut, carte en option) ────────────
  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
        <button
          type="button"
          onClick={() => setFiltresValides(false)}
          style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: '7px 10px', fontSize: 12 }}
        >
          ← Filtres
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
        <button
          type="button"
          onClick={() => setDiagnosticRechercheOuvert(true)}
          style={{ border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.5)', borderRadius: 10, padding: '7px 9px', fontSize: 12.5 }}
        >
          🔧
        </button>
      </div>

      {diagnosticRechercheOuvert && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2250, background: 'rgba(6,10,18,0.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setDiagnosticRechercheOuvert(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 520, background: '#0B1220', borderTopLeftRadius: 18, borderTopRightRadius: 18, border: '1px solid rgba(255,255,255,0.12)', padding: '14px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Diagnostic recherche</div>
              <button type="button" onClick={() => setDiagnosticRechercheOuvert(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
              Fais une capture d'écran de ce panneau et envoie-la.
            </div>
            {!diagnosticRecherche ? (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12.5 }}>Aucune recherche effectuée pour l'instant.</div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8fd4a8', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  Position utilisée : {diagnosticRecherche.position ? `${diagnosticRecherche.position.lat.toFixed(5)}, ${diagnosticRecherche.position.lng.toFixed(5)}` : '(géolocalisation désactivée)'}
                </div>
                <div>Rayon demandé : {diagnosticRecherche.rayonKm != null ? `${diagnosticRecherche.rayonKm} km` : '(non applicable)'}</div>
                <div>Département filtré : {diagnosticRecherche.departement || '(tous)'}</div>
                <div>Candidats bruts (boîte Lambert93) : {diagnosticRecherche.candidatsBruts}</div>
                <div>Écartés (entreprise fermée) : {diagnosticRecherche.exclusFerme}</div>
                <div>Écartés (pas de coordonnées exploitables) : {diagnosticRecherche.exclusSansCoords}</div>
                <div>Écartés (distance exacte &gt; rayon) : {diagnosticRecherche.exclusDistance}</div>
                <div style={{ color: '#fff', fontWeight: 700 }}>Restants après filtrage géo : {diagnosticRecherche.apresFiltrageGeo}</div>
                <div>SIRET vérifiés vs ref_tiers : {diagnosticRecherche.siretsVerifies}</div>
                <div>… dont reconnus clients CEGECLIM : {diagnosticRecherche.siretsReconnus}</div>
                {diagnosticRecherche.refTiersErreur && (
                  <div style={{ color: '#e0a685' }}>❌ Erreur ref_tiers : {diagnosticRecherche.refTiersErreur}</div>
                )}
                <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.5)' }}>— État des filtres actifs —</div>
                <div>Client CEGECLIM affiché : {afficherClients ? 'OUI' : 'NON'}</div>
                <div>Prospect affiché : {afficherProspects ? 'OUI' : 'NON'}</div>
                <div>Collaborateur : {collaborateurFiltre || '(tous)'}</div>
                <div>Secteurs sélectionnés : {secteursActifs.size === 0 ? '(tous)' : Array.from(secteursActifs).join(', ')}</div>
                <div>RGE uniquement : {rgeSeul ? 'OUI' : 'NON'}</div>
                <div>Capacité gaz uniquement : {capaciteGazSeul ? 'OUI' : 'NON'}</div>
                <div>Capital social sélectionné : {capitalSocialActifs.size === 0 ? '(tous)' : Array.from(capitalSocialActifs).join(', ')}</div>
                <div>Ancienneté : {ancienneteMax.label}</div>
                <div style={{ color: '#fff', fontWeight: 700, marginTop: 4 }}>Après filtres actifs : {prospectsFiltres.length}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {vue === 'liste' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 90px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Recherche…</div>
          ) : prospectsFiltres.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Aucun prospect sur ce périmètre.</div>
          ) : (
            [...prospectsFiltres]
              .sort((a, b) => distanceKmWgs84(position!.lat, position!.lng, a.latEff, a.lonEff) - distanceKmWgs84(position!.lat, position!.lng, b.latEff, b.lonEff))
              .map((p) => {
                const sector = getSectorLabel(p)
                const distance = distanceKmWgs84(position!.lat, position!.lng, p.latEff, p.lonEff)
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
                      padding: '11px 12px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => ouvrirDetail(p)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0 }}
                    >
                      <span
                        style={{
                          width: 10, height: 10, borderRadius: '50%', background: getSectorColor(sector), flexShrink: 0,
                          boxShadow: p.estClientCegeclim ? '0 0 0 2px #FFC98B' : 'none',
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p.raison_sociale_affichee || '(sans nom)'}
                          </div>
                          {p.estClientCegeclim && (
                            <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: '#141A26', background: '#FFC98B', borderRadius: 999, padding: '2px 6px' }}>
                              CLIENT
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {formatAdresseComplete(p) || sector}
                        </div>
                      </div>
                    </button>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#8FC7DA', flexShrink: 0 }}>{distance} km</div>
                    <button
                      type="button"
                      onClick={() => setNavigationVers({ adresse: formatAdresseComplete(p), lat: p.latEff, lon: p.lonEff })}
                      aria-label="Naviguer vers"
                      style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(75,146,172,0.4)', background: 'rgba(75,146,172,0.14)', fontSize: 15 }}
                    >
                      📍
                    </button>
                    {p.telephone && (
                      <button
                        type="button"
                        onClick={() => setAppelVers(p.telephone as string)}
                        aria-label="Appeler"
                        style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(63,145,66,0.4)', background: 'rgba(63,145,66,0.14)', fontSize: 15 }}
                      >
                        📞
                      </button>
                    )}
                  </div>
                )
              })
          )}
        </div>
      ) : (
        // Hauteur mesurée en pixels par JS (voir l'effet plus haut) --
        // remplace le height:100% en cascade qui ne se résolvait jamais
        // (confirmé par le diagnostic à l'écran : 362×0px en continu).
        <div ref={mapWrapperRef} id="cgc-map-conteneur" style={{ flex: 1, minHeight: 320, position: 'relative', paddingBottom: 74 }}>
          {position && mapHeightPx === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              Préparation de la carte…
            </div>
          )}
          {position && mapHeightPx > 0 && (
            <MapContainer
              center={[position.lat, position.lng] as any}
              zoom={zoomForRadiusKm(radiusKm)}
              preferCanvas
              style={{ height: mapHeightPx, width: '100%' }}
              ref={(m: any) => {
                if (m && !mapRef.current) {
                  mapRef.current = m
                  logCarte('✅ MapContainer monté (ref reçue par Leaflet).')
                  try {
                    const size = m.getSize?.()
                    logCarte(`Taille interne Leaflet à la ref : ${size ? `${size.x}×${size.y}px` : 'indisponible'} (hauteur fixée à ${mapHeightPx}px)`)
                  } catch (e: any) {
                    logCarte(`❌ getSize() a levé : ${e?.message || e}`)
                  }
                } else if (m) {
                  mapRef.current = m
                }
              }}
              whenReady={() => logCarte('✅ whenReady déclenché par Leaflet (carte prête côté lib).')}
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://api.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=3750cd83dca34199969e6b9e2dcdca40"
                eventHandlers={{
                  tileerror: (e: any) => logCarte(`❌ Erreur de chargement tuile : ${e?.error?.message || e?.error || 'inconnue'}`),
                  tileload: () => logCarte('✅ Au moins une tuile a chargé avec succès.'),
                }}
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
                    pathOptions={{
                      color: p.estClientCegeclim ? '#FFC98B' : '#0f172a',
                      fillColor: getSectorColor(sector), fillOpacity: 0.95,
                      weight: p.estClientCegeclim ? 3 : 1.5,
                    }}
                    eventHandlers={{ click: () => ouvrirDetail(p) }}
                  />
                )
              })}
            </MapContainer>
          )}
        </div>
      )}

      {/* ---- Bascule liste / carte, en bas de l'écran ---- */}
      <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, display: 'flex', gap: 8, zIndex: 1500 }}>
        <button
          type="button"
          onClick={() => setVue('liste')}
          style={{
            flex: 1, padding: '13px', borderRadius: 12, border: '1px solid rgba(75,146,172,0.4)',
            background: vue === 'liste' ? 'rgba(75,146,172,0.5)' : 'rgba(20,26,38,0.92)',
            color: '#fff', fontSize: 14, fontWeight: 700, backdropFilter: 'blur(6px)',
          }}
        >
          📋 Liste
        </button>
        <button
          type="button"
          onClick={() => setVue('carte')}
          style={{
            flex: 1, padding: '13px', borderRadius: 12, border: '1px solid rgba(75,146,172,0.4)',
            background: vue === 'carte' ? 'rgba(75,146,172,0.5)' : 'rgba(20,26,38,0.92)',
            color: '#fff', fontSize: 14, fontWeight: 700, backdropFilter: 'blur(6px)',
          }}
        >
          🗺️ Carte
        </button>
      </div>

      {/* ---- Diagnostic carte (temporaire) : journal visible à l'écran,
         pour voir enfin l'erreur réelle sans debug distant sur Mac. ---- */}
      {vue === 'carte' && (
        <button
          type="button"
          onClick={() => setDiagnosticOuvert((v) => !v)}
          style={{
            position: 'absolute', right: 14, bottom: 76, zIndex: 1501,
            padding: '6px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(20,26,38,0.9)', color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600,
          }}
        >
          🔧 Diagnostic
        </button>
      )}
      {diagnosticOuvert && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2050, background: 'rgba(6,10,18,0.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setDiagnosticOuvert(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 520, maxHeight: '70vh', background: '#0B1220', borderTopLeftRadius: 18, borderTopRightRadius: 18, border: '1px solid rgba(255,255,255,0.12)', padding: '14px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Diagnostic carte</div>
              <button type="button" onClick={() => setDiagnosticOuvert(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
              Fais une capture d'écran de ce panneau et envoie-la : ça montre exactement ce qui bloque.
            </div>
            <div style={{ overflowY: 'auto', flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8fd4a8', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {journalCarte.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.4)' }}>Aucune entrée pour l'instant…</div>
              ) : (
                journalCarte.map((ligne, i) => <div key={i}>{ligne}</div>)
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Tiroir filtres (rayon, ancienneté, capital social, secteur, RGE, capacité gaz) ---- */}
      {filtresOuverts && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2010, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setFiltresOuverts(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Filtres</div>

            <BlocFiltresFixes compact />

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
          style={{ position: 'fixed', inset: 0, zIndex: 2020, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 14px' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{selected.raison_sociale_affichee || '(sans nom)'}</div>
              {selected.estClientCegeclim && (
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#141A26', background: '#FFC98B', borderRadius: 999, padding: '2px 8px' }}>
                  CLIENT CEGECLIM
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              {getSectorLabel(selected)}{selected.estClientCegeclim && selected.representant ? ` · ${selected.representant}` : ''}
            </div>

            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => setNavigationVers({ adresse: formatAdresseComplete(selected), lat: selected.latEff, lon: selected.lonEff })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', borderRadius: 10, border: '1px solid rgba(75,146,172,0.3)', background: 'rgba(75,146,172,0.1)', padding: '8px 10px' }}
              >
                <div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Adresse</div>
                  <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, marginTop: 3 }}>{formatAdresseComplete(selected) || '—'}</div>
                </div>
                <span style={{ fontSize: 18, flexShrink: 0, marginLeft: 8 }}>📍</span>
              </button>

              {selected.telephone && (
                <button
                  type="button"
                  onClick={() => setAppelVers(selected.telephone as string)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', borderRadius: 10, border: '1px solid rgba(63,145,66,0.3)', background: 'rgba(63,145,66,0.1)', padding: '8px 10px' }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Téléphone</div>
                    <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, marginTop: 3 }}>{selected.telephone}</div>
                  </div>
                  <span style={{ fontSize: 18, flexShrink: 0, marginLeft: 8 }}>📞</span>
                </button>
              )}

              {[
                ['SIRET', selected.siret || '—'],
                ['Email', selected.email || '—'],
                ['Dirigeant', selected.nom_dirigeant || '—'],
                ['Créée le', formatDateFr(selected.dateCreationEtablissement)],
                ['Distance', `${distanceKmWgs84(position!.lat, position!.lng, selected.latEff, selected.lonEff)} km`],
                ['RGE', selected.rge ? 'Oui' : 'Non'],
                ['Capacité gaz', selected.capacite_gaz ? 'Oui' : 'Non'],
                ['Capital social', selected.capital_social || '—'],
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

      {navigationVers && (
        <NavigationChoiceSheet adresse={navigationVers.adresse} lat={navigationVers.lat} lon={navigationVers.lon} onClose={() => setNavigationVers(null)} />
      )}
      {appelVers && <PhoneChoiceSheet telephone={appelVers} onClose={() => setAppelVers(null)} />}
    </div>
  )
}

function LigneDimension({
  label,
  valeur,
  onClick,
  compact,
  desactive,
}: {
  label: string
  valeur: string
  onClick: () => void
  compact: boolean
  desactive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactive}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        padding: compact ? '11px 2px' : '13px 2px',
        background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)',
        opacity: desactive ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: compact ? 13.5 : 14.5, fontWeight: 600, color: '#fff' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 12.5 : 13.5, color: 'rgba(255,255,255,0.55)' }}>
        {valeur}
        <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>›</span>
      </span>
    </button>
  )
}

function LigneInterrupteur({
  label,
  valeur,
  onChange,
  compact,
}: {
  label: string
  valeur: boolean
  onChange: (v: boolean) => void
  compact: boolean
}) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        padding: compact ? '11px 2px' : '13px 2px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span style={{ fontSize: compact ? 13.5 : 14.5, fontWeight: 600, color: '#fff' }}>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!valeur)}
        aria-label={label}
        style={{
          width: 46, height: 27, borderRadius: 999, border: 'none', position: 'relative', flexShrink: 0,
          background: valeur ? '#A6A181' : 'rgba(255,255,255,0.15)',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2.5, left: valeur ? 21 : 2.5, width: 22, height: 22, borderRadius: '50%',
            background: '#fff', transition: 'left 0.15s ease',
          }}
        />
      </button>
    </div>
  )
}

function ligneOptionStyle(actif: boolean): React.CSSProperties {
  return {
    textAlign: 'left', padding: '12px 14px', borderRadius: 10,
    border: `1px solid ${actif ? 'rgba(166,161,129,0.5)' : 'rgba(255,255,255,0.1)'}`,
    background: actif ? 'rgba(166,161,129,0.18)' : 'rgba(255,255,255,0.03)',
    color: '#fff', fontSize: 14, fontWeight: actif ? 700 : 500,
  }
}

function chipStyle(actif: boolean, rgb: string, padding: string, fontSize: number): React.CSSProperties {
  return {
    padding, borderRadius: 999, border: `1px solid rgba(${rgb},0.4)`,
    background: actif ? `rgba(${rgb},0.35)` : `rgba(${rgb},0.1)`,
    color: '#fff', fontSize, fontWeight: 700,
  }
}
