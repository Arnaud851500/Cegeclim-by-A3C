'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'
import { NavigationChoiceSheet, PhoneChoiceSheet } from './MobileActionSheets'
import VoiceReportButtons from './VoiceReportButtons'
import MobileTaskDetailSheet, { type TaskRow } from './MobileTaskDetailSheet'

// ─────────────────────────────────────────────────────────────────────────
// Schéma confirmé via synthese_multi_clients/page.tsx :
// - Table clients : synthese_multi_clients_cache, row_kind = 'client', annee = N.
//   Colonne tiers réelle sur CETTE table : numero_tiers (confirmée, aucune erreur).
// - "Profil CA 12MG" : calculé côté client (caBand), pas une colonne stockée.
// - Dates de visite : REMPLACÉ (cf. plus bas) — ne vient plus de objectif_tiers
//   mais de crm_base_activity (BLG), pour refléter les vrais RDV/appels.
// - Actions client : todo_actions.numero_tiers, désormais filtrées sur les
//   statuts non terminés (Non débuté / En cours), et éditables au tap.
//
// - facture_lignes : erreur confirmée en prod → "numero_tiers" N'EXISTE PAS
//   sur cette table. Seule numero_tiers_entete existe.
//
// - Devis N-1 (comparaison) : la valeur brute du cache au niveau client
//   (devis_ytd_n1) est fausse/à 0 pour certains clients — le desktop la
//   recalcule à partir des lignes mensuelles du cache
//   (recomputeClientN1ComparisonFromMonths). Reproduit ici pour Devis
//   uniquement — CA et Marge N-1 du cache client correspondent déjà
//   exactement au desktop, testé sur DUPRE HABITAT ENERGIES.
//
// - Visites (dernière/prochaine) : le lien client -> entreprise BLG se fait
//   via partner_base_partner.reference = numero_tiers du client (match EXACT,
//   confirmé empiriquement : "DB0079" -> company_name renseigné, alors que
//   "DB0079-9430" etc. sont des contacts individuels liés à cette même
//   entreprise, à exclure). Puis crm_activity_company (company_fk) donne les
//   activity_fk liées, et crm_base_activity (internal_tag='normal', type in
//   meeting/phoneCall) donne les RDV/appels. Même filtre de type que
//   MobileRdv.tsx, pour rester cohérent avec l'écran "Mes rdv".
//
// - Documents (CDC/PL/BL/BR/Devis) : agrégés en 1 ligne par document
//   (numero_piece), montant total + référence chantier, calculés à partir
//   des LIGNES (activite_lignes / devis_lignes) plutôt que de
//   public.activite_entete — cette dernière est une table historique figée
//   (dernier import classique, ne contient aucun document créé depuis la
//   mise en place du pipeline SAGE temps réel) et donnerait des listes
//   incomplètes/périmées. Clic sur un document -> détail des lignes
//   (référence, désignation, qté, montant HT).
//
// - BL / CA "depuis le 1er janvier" (cases stats) : NE PAS calculer en
//   filtrant simplement activite_lignes/facture_lignes côté client comme
//   avant (donnait un BL sous-évalué, ex. 14,2 K€ au lieu de ~50,9 K€ pour
//   DUPRE HABITAT ENERGIES) -- activite_lignes seule est un état courant
//   côté SAGE et ne reflète pas tout le flux annuel une fois les documents
//   soldés/facturés. On réutilise désormais EXACTEMENT la même convention
//   que l'écran Activité (get_vision_tci_kpi / get_focus_mensuel_daily_
//   summary_metier / rebuild_focus_mensuel_agency_activity_cache), via la
//   fonction SQL dédiée public.get_client_flux_ytd(numero_tiers, debut, fin) :
//     - BL = activite_lignes "Bon de livraison" (+) et "Bon de retour" (-)
//       sur date_bl, PLUS facture_lignes sur leur date_bl (même règle de
//       signe que Factures ci-dessous) -- capte le BL une fois le document
//       facturé et sorti d'activite_lignes.
//     - CA = facture_lignes sur date_facture, numero_piece ILIKE 'FA0%' =
//       facture (+), sinon (ex. "FAR..." = avoir) = négatif. Intègre donc
//       bien les avoirs, conformément à la demande.
//   La case "Factures" dédiée est supprimée (elle faisait doublon avec CA,
//   qui couvre déjà exactement le même flux avec avoirs).
//
// - Badge contacts (à côté du nom client) : partner_base_partner filtré sur
//   reference LIKE '<numero_tiers>-%' ET reference NOT ILIKE '%-liv' (les
//   entrées '-liv' sont des adresses de livraison, pas des contacts -- même
//   principe que le filtre "-liv" exclu partout ailleurs sur cette table ;
//   confirmé empiriquement : type='contact' pour les vraies personnes,
//   type='company' pour la fiche société elle-même et les adresses '-liv').
//   phone/mail sont des colonnes text contenant du JSON (tableau d'objets
//   {value,...}) -- on affiche la première valeur.
// ─────────────────────────────────────────────────────────────────────────

const N = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CA_PROFILE_BANDS = ['400K€', '150K€', '80K€', '20K€', 'vide'] as const
type CaBand = typeof CA_PROFILE_BANDS[number]

// Mêmes clés/libellés que MobileRdv.tsx, pour une cohérence totale entre les
// deux écrans (type stocké en texte sur crm_base_activity, IDs numériques
// ajoutés par sécurité).
const RDV_TYPE_KEYS = ['meeting', 'phoneCall', 'reminder', '4', '7', '9']
const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: 'RDV', phoneCall: 'Appel', reminder: 'Rappel',
  '4': 'RDV', '7': 'Appel', '9': 'Rappel',
}

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
function safeText(value: any) {
  return String(value ?? '').trim()
}
function caBand(value: number | null | undefined): CaBand {
  const n = safeNumber(value)
  if (n >= 400000) return '400K€'
  if (n >= 150000) return '150K€'
  if (n >= 80000) return '80K€'
  if (n >= 20000) return '20K€'
  return 'vide'
}
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function yearStartIso() {
  return `${N}-01-01`
}
function yearStartN1Iso() {
  return `${N - 1}-01-01`
}
/** Même jour calendaire, un an plus tôt (convention utilisée par
 * get_vision_tci_kpi côté SQL pour les comparaisons N-1). */
function sameDayLastYearIso() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function normalizeDateIso(value: any) {
  const text = safeText(value)
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return ''
}
function formatDateFr(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
/** partner_base_partner.phone / .mail sont des colonnes text contenant du
 * JSON (tableau d'objets { value, type/category, label }). Renvoie la
 * première valeur exploitable, ou une chaîne vide. */
function parseFirstJsonValue(raw: any): string {
  const text = safeText(raw)
  if (!text || text === '[]') return ''
  try {
    const arr = JSON.parse(text)
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.value) return String(arr[0].value)
    return ''
  } catch {
    // Valeur déjà en texte brut (pas du JSON) -> on la renvoie telle quelle.
    return text
  }
}
function cleanJobTitle(raw: any): string {
  return safeText(raw).replace(/\|/g, ' ').trim()
}
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}

async function fetchAllCache(select: string, apply?: (q: any) => any) {
  const output: Record<string, any>[] = []
  const chunkSize = 1000
  let from = 0
  while (true) {
    // .order() indispensable pour une pagination .range() stable — sans lui,
    // Postgres/PostgREST ne garantit pas un ordre cohérent entre deux appels
    // successifs (des lignes peuvent être sautées, notamment si la table est
    // réécrite pendant la pagination par un rebuild de cache concurrent).
    let query = supabase
      .from('synthese_multi_clients_cache')
      .select(select)
      .order('numero_tiers', { ascending: true })
      .range(from, from + chunkSize - 1)
    if (apply) query = apply(query)
    const { data, error } = await query
    if (error) throw error
    const rows = (data || []) as Record<string, any>[]
    output.push(...rows)
    if (rows.length < chunkSize) break
    from += chunkSize
  }
  return output
}

type ClientRow = {
  numero: string
  nom: string
  dateCreationIso: string
  caYtdN: number
  caYtdN1: number
  caN1: number
  ca12m: number
  band: CaBand
  devisYtdN: number
  margePctYtdN: number | null
  margePctYtdN1: number | null
}

// Une ligne agrégée = 1 document (CDC/PL/BL/BR/Devis), pas une ligne d'article.
type DocAgrege = {
  numeroPiece: string
  date: string
  reference: string
  montantHt: number
  lignes: { reference_article: string; designation: string; quantite: number; montant_ht: number }[]
}
type ActionRow = { id: string; libelle: string; status: string; due_date: string | null; assigned_to: string | null }
type VisiteEvent = {
  id: string
  type: string
  subject: string
  start: string
  end: string
  allDay: boolean
}
type ContactRow = {
  id: string
  nom: string
  jobTitle: string
  phone: string
  mail: string
}
type AdresseClient = { ligne1: string; codePostal: string; ville: string; telephone: string } | null
type ClientDetail = {
  commandes: DocAgrege[] // CDC
  preparations: DocAgrege[] // PL
  livraisons: DocAgrege[] // BL
  retours: DocAgrege[] // BR
  devis: DocAgrege[]
  actions: ActionRow[]
  blYtd: number
  caYtd: number
  caYtdN1: number
  contacts: ContactRow[]
  adresse: AdresseClient
  derniereVisite: VisiteEvent | null
  prochaineVisite: VisiteEvent | null
  devisYtdN1: number
  loadErrors: string[]
}

/** Regroupe des lignes brutes (activite_lignes ou devis_lignes) en 1 ligne par numero_piece. */
function aggregateByDocument(
  rows: Record<string, any>[],
  dateFields: string[],
): DocAgrege[] {
  const byPiece = new Map<string, DocAgrege>()
  for (const r of rows) {
    const numeroPiece = safeText(r.numero_piece)
    if (!numeroPiece) continue
    const existing = byPiece.get(numeroPiece)
    const ligne = {
      reference_article: safeText(r.reference_article),
      designation: safeText(r.designation),
      quantite: safeNumber(r.quantite),
      montant_ht: safeNumber(r.montant_ht),
    }
    if (existing) {
      existing.montantHt += ligne.montant_ht
      existing.lignes.push(ligne)
    } else {
      byPiece.set(numeroPiece, {
        numeroPiece,
        date: normalizeDateIso(pick(r, dateFields)),
        reference: safeText(r.reference),
        montantHt: ligne.montant_ht,
        lignes: [ligne],
      })
    }
  }
  return Array.from(byPiece.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

export default function MobileClients({
  cibleNumero,
  cibleNom,
  onCibleConsommee,
}: {
  /** Numéro de tiers à ouvrir directement au montage/à la mise à jour --
   * utilisé pour la navigation depuis un autre écran (ex. "Mes rdv" ->
   * clic sur l'entreprise d'un rendez-vous). */
  cibleNumero?: string | null
  cibleNom?: string | null
  /** Appelé une fois la cible consommée (fiche ouverte), pour que l'écran
   * appelant efface son état de navigation et ne redéclenche pas
   * l'ouverture si l'utilisateur revient plus tard sur cet écran. */
  onCibleConsommee?: () => void
}) {
  const [allClients, setAllClients] = useState<ClientRow[] | null>(null)
  const [clientsError, setClientsError] = useState<string | null>(null)

  // Identité de l'utilisateur courant — nécessaire pour VoiceReportButtons
  // (created_by des tâches/compte-rendu créés depuis "prochaine visite").
  const [currentEmail, setCurrentEmail] = useState('')
  const [currentName, setCurrentName] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadIdentity() {
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData.session?.user?.email?.toLowerCase()
      if (!email || cancelled) return
      const { data: access } = await supabase
        .from('user_page_access')
        .select('display_name')
        .eq('email', email)
        .maybeSingle()
      if (cancelled) return
      setCurrentEmail(email)
      setCurrentName(String(access?.display_name || '').trim() || email.split('@')[0])
    }
    void loadIdentity()
    return () => { cancelled = true }
  }, [])

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const rows = await fetchAllCache(
          'numero_tiers,intitule_tiers,date_creation,ca_n1,ca_ytd_n,ca_ytd_n1,devis_ytd_n,marge_pct_ytd_n,marge_ytd_n1_value',
          (q) => q.eq('annee', N).eq('row_kind', 'client'),
        )
        if (cancelled) return

        const mapped: ClientRow[] = rows.map((row) => {
          const caYtdN = safeNumber(row.ca_ytd_n)
          const caYtdN1 = safeNumber(row.ca_ytd_n1)
          const caN1 = safeNumber(row.ca_n1)
          const ca12m = caYtdN + Math.max(0, caN1 - caYtdN1)
          const margeYtdN1Value = safeNumber(row.marge_ytd_n1_value)
          return {
            numero: safeText(row.numero_tiers),
            nom: safeText(row.intitule_tiers),
            dateCreationIso: normalizeDateIso(row.date_creation),
            caYtdN,
            caYtdN1,
            caN1,
            ca12m,
            band: caBand(ca12m),
            devisYtdN: safeNumber(row.devis_ytd_n),
            margePctYtdN: row.marge_pct_ytd_n === null || row.marge_pct_ytd_n === undefined ? null : safeNumber(row.marge_pct_ytd_n),
            margePctYtdN1: caYtdN1 ? (margeYtdN1Value / caYtdN1) * 100 : null,
          }
        })
        setAllClients(mapped)
      } catch (e) {
        console.error('[MobileClients] erreur chargement synthese_multi_clients_cache', e)
        if (!cancelled) setClientsError(e instanceof Error ? e.message : String(e))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    if (!allClients) return { total: null as number | null, nouveaux: null as number | null, parProfil: null as { label: string; count: number }[] | null }
    const ys = yearStartIso()
    const nouveaux = allClients.filter((c) => c.dateCreationIso && c.dateCreationIso >= ys).length
    const counts = new Map<CaBand, number>()
    allClients.forEach((c) => counts.set(c.band, (counts.get(c.band) || 0) + 1))
    const parProfil = CA_PROFILE_BANDS
      .map((band) => ({ label: band, count: counts.get(band) || 0 }))
      .filter((p) => p.count > 0)
    return { total: allClients.length, nouveaux, parProfil }
  }, [allClients])

  const results = useMemo(() => {
    if (!allClients) return []
    const term = search.trim().toLowerCase()
    if (!term) return []
    return allClients
      .filter((c) => c.numero.toLowerCase().includes(term) || c.nom.toLowerCase().includes(term))
      .slice(0, 40)
  }, [allClients, search])

  // Ouverture directe sur un client cible (navigation depuis un autre
  // écran, ex. "Mes rdv") -- attend que allClients soit chargé pour
  // pouvoir reprendre la fiche complète du cache (CA, marge...) si connue,
  // sinon ouvre quand même avec une fiche minimale (numéro + nom) : le
  // détail complet se charge de toute façon en direct dans openClient.
  useEffect(() => {
    if (!cibleNumero || !allClients) return
    const trouve = allClients.find((c) => c.numero === cibleNumero)
    const client: ClientRow = trouve || {
      numero: cibleNumero,
      nom: cibleNom || cibleNumero,
      dateCreationIso: '',
      caYtdN: 0,
      caYtdN1: 0,
      caN1: 0,
      ca12m: 0,
      band: CA_PROFILE_BANDS[0],
      devisYtdN: 0,
      margePctYtdN: null,
      margePctYtdN1: null,
    }
    void openClient(client)
    onCibleConsommee?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cibleNumero, allClients])

  async function openClient(client: ClientRow) {
    setSelected(client)
    setDetail(null)
    setDetailLoading(true)

    const loadErrors: string[] = []

    try {
      const ys = yearStartIso()
      const today = todayIso()
      const ysN1 = yearStartN1Iso()
      const sameDayN1 = sameDayLastYearIso()

      const [
        activiteRes, devisRes, actionsRes, monthRes,
        fluxNRes, fluxN1Res, partnerRes, contactsRes, adresseRes,
      ] = await Promise.all([
        // CDC + PL + BL + BR en une seule requête (mêmes colonnes, types
        // filtrés) -- agrégation par document faite ensuite côté client.
        supabase
          .from('activite_lignes')
          .select('numero_piece,type_document,reference,date_piece,date_bc,date_pl,date_bl,reference_article,designation,quantite,montant_ht')
          .in('type_document', ['Bon de commande', 'Préparation de livraison', 'Bon de livraison', 'Bon de retour'])
          .eq('numero_tiers_entete', client.numero)
          .limit(600),
        supabase
          .from('devis_lignes')
          .select('numero_piece,reference_client,date_devis,reference_article,designation,quantite,montant_ht')
          .eq('numero_tiers_entete', client.numero)
          .order('date_devis', { ascending: false })
          .limit(300),
        // Uniquement les tâches NON terminées (ni "Terminé" ni "Annulé").
        supabase
          .from('todo_actions')
          .select('id,description_action,status,due_date,assigned_to')
          .eq('numero_tiers', client.numero)
          .not('status', 'in', '("Terminé","Annulé")')
          .order('due_date', { ascending: true })
          .limit(30),
        supabase
          .from('synthese_multi_clients_cache')
          .select('mois,devis_n1')
          .eq('annee', N)
          .eq('row_kind', 'month')
          .eq('numero_tiers', client.numero),
        // BL + CA (avec avoirs) depuis le 1er janvier -- même convention que
        // l'écran Activité (get_vision_tci_kpi), via la fonction dédiée
        // qui filtre par client au lieu d'agréger par agence/famille macro.
        supabase.rpc('get_client_flux_ytd', { p_numero_tiers: client.numero, p_date_debut: ys, p_date_fin: today }),
        // Même période, N-1, pour l'évolution affichée sur la case CA.
        supabase.rpc('get_client_flux_ytd', { p_numero_tiers: client.numero, p_date_debut: ysN1, p_date_fin: sameDayN1 }),
        // Résolution du lien client -> entreprise BLG. Match EXACT sur
        // "reference" (le numéro tiers seul, sans suffixe "-XXXX" qui
        // identifie un contact individuel plutôt que l'entreprise).
        supabase
          .from('partner_base_partner')
          .select('id')
          .eq('reference', client.numero)
          .limit(1),
        // Contacts individuels rattachés au client : reference "<numero>-xxxx",
        // en excluant les adresses de livraison ("-liv").
        supabase
          .from('partner_base_partner')
          .select('id,first_name,last_name,company_name,job_title,phone,mail')
          .ilike('reference', `${client.numero}-%`)
          .not('reference', 'ilike', '%-liv')
          .order('last_name', { ascending: true })
          .limit(50),
        // Adresse du siège (SAGE) -- pour le badge "naviguer vers".
        supabase
          .from('ref_tiers')
          .select('adresse,complement_adresse,code_postal,ville,telephone')
          .eq('numero', client.numero)
          .maybeSingle(),
      ])

      if (activiteRes.error) loadErrors.push(activiteRes.error.message)
      if (devisRes.error) loadErrors.push(devisRes.error.message)
      if (actionsRes.error) loadErrors.push(actionsRes.error.message)
      if (fluxNRes.error) loadErrors.push(fluxNRes.error.message)
      if (fluxN1Res.error) loadErrors.push(fluxN1Res.error.message)
      if (contactsRes.error) loadErrors.push(contactsRes.error.message)

      const activiteRows = activiteRes.data || []
      const byType = (t: string) => activiteRows.filter((r: any) => r.type_document === t)

      const commandes = aggregateByDocument(byType('Bon de commande'), ['date_bc', 'date_piece'])
      const preparations = aggregateByDocument(byType('Préparation de livraison'), ['date_pl', 'date_piece'])
      const livraisons = aggregateByDocument(byType('Bon de livraison'), ['date_bl', 'date_piece'])
      const retours = aggregateByDocument(byType('Bon de retour'), ['date_bl', 'date_piece'])
      const devis = aggregateByDocument(
        (devisRes.data || []).map((r: any) => ({ ...r, reference: r.reference_client })),
        ['date_devis'],
      )

      const fluxN = Array.isArray(fluxNRes.data) ? fluxNRes.data[0] : fluxNRes.data
      const fluxN1 = Array.isArray(fluxN1Res.data) ? fluxN1Res.data[0] : fluxN1Res.data
      const blYtd = safeNumber(fluxN?.bl_ytd)
      const caYtd = safeNumber(fluxN?.ca_ytd)
      const caYtdN1 = safeNumber(fluxN1?.ca_ytd)

      const contacts: ContactRow[] = (contactsRes.data || []).map((r: any) => ({
        id: String(r.id),
        nom: [safeText(r.first_name), safeText(r.last_name)].filter(Boolean).join(' ') || safeText(r.company_name) || 'Contact',
        jobTitle: cleanJobTitle(r.job_title),
        phone: parseFirstJsonValue(r.phone),
        mail: parseFirstJsonValue(r.mail),
      }))

      const adresseRow: any = adresseRes && !('error' in adresseRes && adresseRes.error) ? adresseRes.data : null
      const adresse: AdresseClient = adresseRow && safeText(adresseRow.adresse)
        ? {
            ligne1: [safeText(adresseRow.adresse), safeText(adresseRow.complement_adresse)].filter(Boolean).join(', '),
            codePostal: safeText(adresseRow.code_postal),
            ville: safeText(adresseRow.ville),
            telephone: safeText(adresseRow.telephone),
          }
        : null

      let devisYtdN1 = 0
      if (monthRes.error) {
        loadErrors.push(monthRes.error.message)
      } else {
        devisYtdN1 = (monthRes.data || [])
          .filter((r: any) => Number(r.mois || 0) <= CURRENT_MONTH)
          .reduce((sum: number, r: any) => sum + safeNumber(r.devis_n1), 0)
      }

      // Dernière / prochaine visite via BLG (crm_base_activity), liée par
      // l'entreprise partner_base_partner résolue ci-dessus.
      let derniereVisite: VisiteEvent | null = null
      let prochaineVisite: VisiteEvent | null = null
      if (partnerRes.error) {
        loadErrors.push(partnerRes.error.message)
      } else {
        const partnerId = partnerRes.data?.[0]?.id
        if (partnerId) {
          const { data: links, error: linksErr } = await supabase
            .from('crm_activity_company')
            .select('activity_fk')
            .eq('company_fk', partnerId)
          if (linksErr) {
            loadErrors.push(linksErr.message)
          } else {
            const activityIds = (links || []).map((l: any) => l.activity_fk).filter((v: any) => v !== null && v !== undefined)
            if (activityIds.length > 0) {
              const { data: activities, error: actErr } = await supabase
                .from('crm_base_activity')
                .select('*')
                .in('id', activityIds)
                .eq('internal_tag', 'normal')
                .in('type', RDV_TYPE_KEYS)
                .order('start_date', { ascending: true })
              if (actErr) {
                loadErrors.push(actErr.message)
              } else {
                const mapped = (activities || []).map((row: any) => ({
                  id: String(row.id),
                  type: String(row.type ?? ''),
                  subject: String(pick(row, ['comment', 'subject', 'title', 'name', 'label']) || RDV_TYPE_LABELS[String(row.type ?? '')] || 'Activité'),
                  start: String(row.start_date || ''),
                  end: String(row.end_date || row.start_date || ''),
                  allDay: Boolean(row.all_day),
                }))
                const past = mapped.filter((e) => e.start && e.start.slice(0, 10) < today)
                const future = mapped.filter((e) => e.start && e.start.slice(0, 10) >= today)
                derniereVisite = past.length ? past[past.length - 1] : null
                prochaineVisite = future.length ? future[0] : null
              }
            }
          }
        }
      }

      setDetail({
        commandes, preparations, livraisons, retours, devis,
        actions: actionsRes.error
          ? []
          : (actionsRes.data || []).map((r: any) => ({
              id: String(r.id),
              libelle: String(r.description_action || ''),
              status: String(r.status || ''),
              due_date: r.due_date || null,
              assigned_to: r.assigned_to || null,
            })),
        blYtd,
        caYtd,
        caYtdN1,
        contacts,
        adresse,
        derniereVisite,
        prochaineVisite,
        devisYtdN1,
        loadErrors,
      })
    } catch (e) {
      console.error('[MobileClients] erreur chargement fiche client', e)
      setDetail({
        commandes: [], preparations: [], livraisons: [], retours: [], devis: [], actions: [],
        blYtd: 0, caYtd: 0, caYtdN1: 0, contacts: [], adresse: null, derniereVisite: null, prochaineVisite: null, devisYtdN1: 0,
        loadErrors: [e instanceof Error ? e.message : String(e)],
      })
    } finally {
      setDetailLoading(false)
    }
  }

  if (selected) {
    return (
      <ClientDetailScreen
        client={selected}
        detail={detail}
        loading={detailLoading}
        currentEmail={currentEmail}
        currentName={currentName}
        onBack={() => {
          setSelected(null)
          setDetail(null)
        }}
        onActionSaved={(updated) => {
          setDetail((cur) => {
            if (!cur) return cur
            const isNowDone = updated.status === 'Terminé' || updated.status === 'Annulé'
            return {
              ...cur,
              // Une tâche qui passe en Terminé/Annulé disparaît de la liste
              // (au lieu d'y rester avec son nouveau statut affiché).
              actions: isNowDone
                ? cur.actions.filter((a) => a.id !== updated.id)
                : cur.actions.map((a) =>
                    a.id === updated.id
                      ? {
                          id: updated.id,
                          libelle: updated.description_action || '',
                          status: updated.status,
                          due_date: updated.due_date,
                          assigned_to: updated.assigned_to,
                        }
                      : a,
                  ),
            }
          })
        }}
      />
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher un client (nom ou n° tiers)"
        style={{
          width: '100%',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.05)',
          color: '#fff',
          padding: '12px 14px',
          fontSize: 15,
          outline: 'none',
        }}
      />

      {clientsError && (
        <div style={{ fontSize: 12.5, color: '#e0a685' }}>
          Impossible de charger la base clients (synthese_multi_clients_cache) : {clientsError}
        </div>
      )}

      {!search.trim() && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatCard label="Clients" value={stats.total} />
            <StatCard label="Nouveaux (année)" value={stats.nouveaux} />
          </div>

          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.04)',
              padding: '14px 14px 12px',
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: 10,
              }}
            >
              Profil CA 12MG
            </div>
            {stats.parProfil === null ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.parProfil.map((p) => (
                  <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                    <span style={{ color: 'rgba(255,255,255,0.75)' }}>{p.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{p.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {search.trim() && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {allClients === null ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Chargement…</div>
          ) : results.length === 0 ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Aucun client trouvé.</div>
          ) : (
            results.map((c) => (
              <button
                key={c.numero}
                onClick={() => openClient(c)}
                style={{
                  textAlign: 'left',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: '11px 13px',
                  color: '#fff',
                }}
              >
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{c.nom || '(nom non renseigné)'}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>N° {c.numero}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)',
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color: '#fff', marginTop: 4 }}>
        {value === null ? '—' : value}
      </div>
    </div>
  )
}

function EvolLine({ value, n1, isPoints }: { value: number | null; n1: number | null; isPoints?: boolean }) {
  if (value === null || n1 === null) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>N-1 : —</span>
  const delta = isPoints ? value - n1 : n1 ? ((value - n1) / Math.abs(n1)) * 100 : null
  return (
    <>
      {delta !== null && (
        <span style={{ color: delta >= 0 ? '#8fd4a8' : '#e0a685', fontWeight: 600 }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}{isPoints ? ' pts' : '%'}
        </span>
      )}
      <span style={{ color: 'rgba(255,255,255,0.4)' }}>
        {' '}N-1 : {isPoints ? `${n1.toFixed(1)} %` : formatMoney(n1)}
      </span>
    </>
  )
}

function ClientDetailScreen({
  client, detail, loading, currentEmail, currentName, onBack, onActionSaved,
}: {
  client: ClientRow
  detail: ClientDetail | null
  loading: boolean
  currentEmail: string
  currentName: string
  onBack: () => void
  onActionSaved: (updated: TaskRow) => void
}) {
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[]; footer?: React.ReactNode } | null>(null)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)
  const [contactsOuverts, setContactsOuverts] = useState(false)
  const [navigationVers, setNavigationVers] = useState<{ adresse: string; lat?: number | null; lon?: number | null } | null>(null)
  const [appelVers, setAppelVers] = useState<string | null>(null)

  function openActionDetail(a: ActionRow) {
    setOpenTask({
      id: a.id,
      description_action: a.libelle,
      status: a.status,
      due_date: a.due_date,
      numero_tiers: client.numero,
      assigned_to: a.assigned_to,
    })
  }

  function openDocDetail(d: DocAgrege, type: string) {
    setOpenDetail({
      title: d.numeroPiece || '(sans numéro)',
      subtitle: `${type} · ${formatMoney(d.montantHt)}`,
      fields: [
        { label: 'Date', value: formatDateFr(d.date) },
        { label: 'Référence chantier', value: d.reference || '—' },
        { label: 'Montant total HT', value: formatMoney(d.montantHt) },
        ...d.lignes.map((l, i) => ({
          label: `${l.reference_article || '—'}${l.designation ? ` — ${l.designation}` : ''}`,
          value: `${l.quantite} × ${formatMoney(l.montant_ht)}`,
        })),
      ],
    })
  }

  function openContactsDetail() {
    setContactsOuverts(true)
  }

  function openVisiteDetail(v: VisiteEvent) {
    const startDate = v.start ? new Date(v.start) : null
    const endDate = v.end ? new Date(v.end) : null
    const fmtTime = (d: Date | null) => (d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
    setOpenDetail({
      title: v.subject,
      subtitle: RDV_TYPE_LABELS[v.type] || v.type || 'Activité',
      fields: [
        { label: 'Client', value: `${client.nom} (${client.numero})` },
        { label: 'Début', value: v.allDay ? (startDate ? startDate.toLocaleDateString('fr-FR') : '') : fmtTime(startDate) },
        { label: 'Fin', value: v.allDay ? (endDate ? endDate.toLocaleDateString('fr-FR') : '') : fmtTime(endDate) },
        { label: 'Toute la journée', value: v.allDay ? 'Oui' : 'Non' },
      ],
      footer: (
        <VoiceReportButtons
          numeroTiers={client.numero}
          clientNom={client.nom}
          rdvActivityId={v.id}
          rdvLabel={v.subject}
          userEmail={currentEmail}
          userName={currentName}
        />
      ),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={onBack}
        style={{
          alignSelf: 'flex-start',
          margin: '12px 0 4px 16px',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 9,
          padding: '6px 11px',
          fontSize: 12.5,
          color: 'rgba(255,255,255,0.75)',
          background: 'transparent',
        }}
      >
        ← Recherche
      </button>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#fff' }}>{client.nom || '(nom non renseigné)'}</div>
            {!loading && detail && (
              <button
                onClick={openContactsDetail}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.75)', fontSize: 11.5, fontWeight: 600, padding: '3px 9px',
                  cursor: 'pointer',
                }}
              >
                👤 {detail.contacts.length}
              </button>
            )}
            {!loading && detail && detail.adresse && (
              <button
                onClick={() => setNavigationVers({
                  adresse: [detail.adresse!.ligne1, detail.adresse!.codePostal, detail.adresse!.ville].filter(Boolean).join(', '),
                })}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999,
                  border: '1px solid rgba(75,146,172,0.3)', background: 'rgba(75,146,172,0.12)',
                  color: '#8FC7DA', fontSize: 11.5, fontWeight: 600, padding: '3px 9px',
                  cursor: 'pointer',
                }}
              >
                📍 Adresse
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>N° {client.numero}</div>
        </div>

        {detail && detail.loadErrors.length > 0 && (
          <div style={{ fontSize: 12, color: '#e0a685' }}>
            {detail.loadErrors.join(' · ')}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MiniCard
            label="Dernière visite"
            value={loading ? '…' : detail?.derniereVisite ? formatDateFr(detail.derniereVisite.start.slice(0, 10)) : 'Non renseigné'}
            onClick={detail?.derniereVisite ? () => openVisiteDetail(detail.derniereVisite!) : undefined}
          />
          <MiniCard
            label="Prochaine visite"
            value={loading ? '…' : detail?.prochaineVisite ? formatDateFr(detail.prochaineVisite.start.slice(0, 10)) : 'Non renseigné'}
            onClick={detail?.prochaineVisite ? () => openVisiteDetail(detail.prochaineVisite!) : undefined}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatMini label="CA depuis le 1er janvier (avoirs inclus)" value={loading || !detail ? '…' : formatMoney(detail.caYtd)}>
            {loading || !detail ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>…</span> : <EvolLine value={detail.caYtd} n1={detail.caYtdN1} />}
          </StatMini>
          <StatMini label="Devis depuis le 1er janvier" value={formatMoney(client.devisYtdN)}>
            {loading || !detail ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>…</span> : <EvolLine value={client.devisYtdN} n1={detail.devisYtdN1} />}
          </StatMini>
        </div>

        <StatMini label="BL depuis le 1er janvier" value={loading || !detail ? '…' : formatMoney(detail.blYtd)} />

        <div
          style={{
            borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
            padding: '12px 13px',
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
            Marge depuis le 1er janvier
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, color: '#fff', marginTop: 4 }}>
            {client.margePctYtdN === null ? '—' : `${client.margePctYtdN.toFixed(1)} %`}
          </div>
          <div style={{ marginTop: 5, fontSize: 11 }}>
            <EvolLine value={client.margePctYtdN} n1={client.margePctYtdN1} isPoints />
          </div>
        </div>

        <Section title="Actions">
          {loading ? (
            <Loading />
          ) : !detail || detail.actions.length === 0 ? (
            <Empty text="Aucune action en cours pour ce client." />
          ) : (
            detail.actions.map((a) => (
              <RowItem
                key={a.id}
                title={a.libelle || '(sans libellé)'}
                subtitle={[
                  a.due_date ? `Échéance ${formatDateFr(normalizeDateIso(a.due_date))}` : '',
                  a.assigned_to ? `Assigné : ${a.assigned_to}` : '',
                ].filter(Boolean).join(' · ')}
                trailing={a.status}
                onClick={() => openActionDetail(a)}
              />
            ))
          )}
        </Section>

        <DocumentSection title="Commandes (CDC)" loading={loading} docs={detail?.commandes} onOpen={(d) => openDocDetail(d, 'Bon de commande')} />
        <DocumentSection title="Préparations de livraison (PL)" loading={loading} docs={detail?.preparations} onOpen={(d) => openDocDetail(d, 'Préparation de livraison')} />
        <DocumentSection title="Bons de livraison (BL)" loading={loading} docs={detail?.livraisons} onOpen={(d) => openDocDetail(d, 'Bon de livraison')} />
        <DocumentSection title="Bons de retour (BR)" loading={loading} docs={detail?.retours} onOpen={(d) => openDocDetail(d, 'Bon de retour')} />
        <DocumentSection title="Devis" loading={loading} docs={detail?.devis} onOpen={(d) => openDocDetail(d, 'Devis')} />
      </div>

      {openDetail && (
        <MobileDetailSheet
          title={openDetail.title}
          subtitle={openDetail.subtitle}
          fields={openDetail.fields}
          footer={openDetail.footer}
          onClose={() => setOpenDetail(null)}
        />
      )}

      {openTask && (
        <MobileTaskDetailSheet
          task={openTask}
          onClose={() => setOpenTask(null)}
          onSaved={onActionSaved}
        />
      )}

      {contactsOuverts && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 240, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setContactsOuverts(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Contacts</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>{client.nom || client.numero}</div>

            {(detail?.contacts || []).length === 0 && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', padding: '10px 0' }}>Aucun contact.</div>
            )}

            {(detail?.contacts || []).map((c) => (
              <div key={c.id} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff' }}>
                  {c.nom}{c.jobTitle ? <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.5)' }}> — {c.jobTitle}</span> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {c.phone && (
                    <button
                      type="button"
                      onClick={() => setAppelVers(c.phone)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 999, border: '1px solid rgba(63,145,66,0.35)', background: 'rgba(63,145,66,0.12)', color: '#8fd4a8', fontSize: 12.5, fontWeight: 600 }}
                    >
                      📞 {c.phone}
                    </button>
                  )}
                  {c.mail && (
                    <a
                      href={`mailto:${c.mail}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 999, border: '1px solid rgba(75,146,172,0.35)', background: 'rgba(75,146,172,0.12)', color: '#8FC7DA', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}
                    >
                      ✉️ {c.mail}
                    </a>
                  )}
                  {!c.phone && !c.mail && (
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Pas de coordonnées</span>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setContactsOuverts(false)}
              style={{ marginTop: 8, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
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

function DocumentSection({
  title, loading, docs, onOpen,
}: { title: string; loading: boolean; docs: DocAgrege[] | undefined; onOpen: (d: DocAgrege) => void }) {
  return (
    <Section title={title}>
      {loading ? (
        <Loading />
      ) : !docs || docs.length === 0 ? (
        <Empty text="Aucun document." />
      ) : (
        docs.map((d) => (
          <RowItem
            key={d.numeroPiece}
            title={d.numeroPiece}
            subtitle={[formatDateFr(d.date), d.reference].filter(Boolean).join(' · ')}
            trailing={formatMoney(d.montantHt)}
            onClick={() => onOpen(d)}
          />
        ))
      )}
    </Section>
  )
}

function StatMini({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
        padding: '12px 13px',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, color: '#fff', marginTop: 4 }}>
        {value}
      </div>
      {children && <div style={{ marginTop: 5, fontSize: 11 }}>{children}</div>}
    </div>
  )
}

function MiniCard({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)',
        padding: '11px 13px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, color: '#fff', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', padding: '0 2px' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function RowItem({
  title, subtitle, trailing, onClick,
}: { title: string; subtitle?: string; trailing?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        padding: '9px 12px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {trailing && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', marginLeft: 10 }}>
          {trailing}
        </div>
      )}
    </div>
  )
}

function Loading() {
  return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '4px 2px' }}>Chargement…</div>
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '4px 2px' }}>{text}</div>
}
