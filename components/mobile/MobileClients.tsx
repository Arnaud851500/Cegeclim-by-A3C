'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'
import { NavigationChoiceSheet, PhoneChoiceSheet } from './MobileActionSheets'
import VoiceReportButtons from './VoiceReportButtons'
import MobileTaskDetailSheet, { type TaskRow } from './MobileTaskDetailSheet'
import { NouveauRdvSheet } from './MobileRdv'

const N = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CA_PROFILE_BANDS = ['400K€', '150K€', '80K€', '20K€', 'vide'] as const
type CaBand = typeof CA_PROFILE_BANDS[number]

const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: 'RDV', phoneCall: 'Appel', reminder: 'Rappel',
  '4': 'RDV', '7': 'Appel', '9': 'Rappel',
}

// ── Périmètre agence/collaborateur (2026-08-30) ──────────────────────────
// Avant ce correctif, "Mes clients" chargeait TOUTE la table
// synthese_multi_clients_cache sans aucun filtre -- un collaborateur avec
// un périmètre restreint (ex. Damien Mena, agence ANGLET) voyait donc les
// 476 clients de toute l'entreprise, au lieu des 110 clients affichés pour
// lui sur Vision ONE PAGE (pavé "Clients actifs", filtré par
// allowed_collaborateurs / allowed_agences comme toutes les autres pages).
// Repris ici du même mécanisme déjà utilisé côté useMobileAlertsCount.tsx
// (perimetreRef) : allowed_agences ET allowed_collaborateurs de
// user_page_access, restriction cumulative (chaque liste non vide réduit
// encore le résultat), vide = pas de restriction sur ce critère.
type Perimetre = { agences: string[]; collaborateurs: string[] }

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
/** "Damien MENA" -> "D. MENA" -- affiché à côté du numéro de client (liste
 * + fiche), pour identifier le collaborateur qui suit ce client d'un coup
 * d'œil sans ouvrir la fiche complète. Repli sur le nom tel quel si un
 * seul mot (pas de prénom identifiable). */
function formatCollaborateurCourt(nom: string): string {
  const texte = safeText(nom)
  if (!texte) return ''
  const mots = texte.split(/\s+/).filter(Boolean)
  if (mots.length < 2) return texte
  const prenom = mots[0]
  const reste = mots.slice(1).join(' ')
  return `${prenom.charAt(0).toUpperCase()}. ${reste}`
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
function parseFirstJsonValue(raw: any): string {
  const text = safeText(raw)
  if (!text || text === '[]') return ''
  try {
    const arr = JSON.parse(text)
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.value) return String(arr[0].value)
    return ''
  } catch {
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

/** FIX (2026-08-30) : accepte désormais un périmètre agence/collaborateur
 * et l'applique en filtre Supabase -- restriction cumulative (les deux
 * listes s'appliquent en ET si toutes deux non vides), exactement comme
 * useMobileAlertsCount.tsx pour les autres alertes/listes mobiles. Une
 * liste vide = pas de restriction sur ce critère (comportement inchangé
 * pour un profil sans périmètre, ex. Administrateur). */
async function fetchAllCache(select: string, perimetre: Perimetre, apply?: (q: any) => any) {
  const output: Record<string, any>[] = []
  const chunkSize = 1000
  let from = 0
  while (true) {
    let query = supabase
      .from('synthese_multi_clients_cache')
      .select(select)
      .order('numero_tiers', { ascending: true })
      .range(from, from + chunkSize - 1)
    if (perimetre.collaborateurs.length > 0) query = query.in('collaborateur', perimetre.collaborateurs)
    if (perimetre.agences.length > 0) query = query.in('agence_collaborateur', perimetre.agences)
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
  collaborateur: string
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

type DocAgrege = {
  numeroPiece: string
  date: string
  reference: string
  montantHt: number
  lignes: { reference_article: string; designation: string; quantite: number; montant_ht: number }[]
}
type ActionRow = { id: string; libelle: string; status: string; due_date: string | null; assigned_to: string | null }
/** Tâche terminée, pour l'historique "6 derniers mois" -- voir
 * ouvrirTachesTerminees() dans ClientDetailScreen. updatedAt sert de date
 * d'achèvement : todo_actions n'a pas de colonne dédiée "terminée le",
 * mais son updated_at reflète le moment du passage à Terminé (aucune
 * autre modification n'a de raison d'avoir lieu après coup sur une tâche
 * close). */
type TacheTermineeRow = { id: string; libelle: string; dueDate: string | null; updatedAt: string; assignedTo: string | null }
/** ÉVOLUTION : "décision client sur devis" -- quand un devis est accepté
 * (en tout ou partie) par le client, l'utilisateur peut le flaguer "à
 * traiter" et composer, à partir des lignes du devis d'origine, un
 * document "Devis à transformer en CDC" : lignes conservées, lignes
 * retirées (flag suppression), et nouvelles lignes ajoutées à la main
 * (référence avec aide à la saisie via v_stock_articles_latest, quantité,
 * taux de remise saisi manuellement -- pas de calcul automatique). Stocké
 * dans devis_transformations / devis_transformation_lignes (nouvelles
 * tables, migration du 2026-09-02) pour rester consultable ensuite ; une
 * tâche todo_actions est créée en parallèle pour le suivi commercial. */
type DevisTransformation = {
  id: string
  typeDocument: 'devis' | 'commande'
  numeroPieceDevisOrigine: string
  statut: string
  motif: string | null
  dateLivraisonSouhaitee: string | null
  referenceChantierDemandee: string | null
  createdByName: string | null
  createdAt: string
}
type DevisTransformationLigne = {
  id: string
  numeroLigne: number | null
  origine: 'conservee' | 'supprimee' | 'nouvelle'
  referenceArticle: string
  designation: string
  quantite: number | null
  montantHt: number | null
  tauxRemise: number | null
}
/** Visite unifiée (BLG synchronisé OU RDV "compagnon CEGECLIM") -- source
 * v_rdv_unifie (voir CORRECTIF ci-dessous), pas crm_base_activity seul.
 * blgActivityId/compagnonId : l'un des deux est rempli selon `source`,
 * c'est celui-là (pas rdvId) qu'il faut passer à VoiceReportButtons pour
 * lier un compte-rendu au bon rendez-vous (cf. openVisiteDetail). */
type VisiteEvent = {
  rdvId: string
  source: 'blg' | 'compagnon'
  blgActivityId: string | null
  compagnonId: string | null
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
  commandes: DocAgrege[]
  preparations: DocAgrege[]
  livraisons: DocAgrege[]
  retours: DocAgrege[]
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
  /** Documents (devis ou commandes) ayant un traitement "à traiter" en
   * cours (voir DevisTransformation ci-dessus) -- sert à afficher le
   * badge dans la liste et à enrichir la fiche du document concerné.
   * Ne contient que statut === 'a_traiter' : chargé une fois à
   * l'ouverture de la fiche client, pas de rafraîchissement temps réel. */
  transformationsEnCours: DevisTransformation[]
  loadErrors: string[]
}

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
  onOpenStock,
}: {
  cibleNumero?: string | null
  cibleNom?: string | null
  onCibleConsommee?: () => void
  /** Ouvre le détail stock d'une référence -- passé par MobileShell, qui
   * bascule l'écran vers "Stock" avec cette référence pré-sélectionnée.
   * Câblé ici sur les lignes d'articles des documents (CDC/PL/BL/BR/devis) :
   * un tap sur une ligne emmène directement sur sa fiche stock. */
  onOpenStock?: (reference: string, designation: string) => void
}) {
  const [allClients, setAllClients] = useState<ClientRow[] | null>(null)
  const [clientsError, setClientsError] = useState<string | null>(null)

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentName, setCurrentName] = useState('')
  // null = pas encore résolu (on ne charge pas les clients tant que le
  // périmètre n'est pas connu, pour ne jamais afficher par erreur la
  // liste complète non filtrée le temps d'un aller-retour réseau).
  const [perimetre, setPerimetre] = useState<Perimetre | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadIdentity() {
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData.session?.user?.email?.toLowerCase()
      if (!email || cancelled) return
      const { data: access } = await supabase
        .from('user_page_access')
        .select('display_name, allowed_agences, allowed_collaborateurs')
        .eq('email', email)
        .maybeSingle()
      if (cancelled) return
      setCurrentEmail(email)
      setCurrentName(String(access?.display_name || '').trim() || email.split('@')[0])
      setPerimetre({
        agences: ((access?.allowed_agences || []) as string[]).map((v) => String(v || '').trim()).filter(Boolean),
        collaborateurs: ((access?.allowed_collaborateurs || []) as string[]).map((v) => String(v || '').trim()).filter(Boolean),
      })
    }
    void loadIdentity()
    return () => { cancelled = true }
  }, [])

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    // On attend que le périmètre soit résolu (voir loadIdentity ci-dessus)
    // avant de charger quoi que ce soit -- évite un premier rendu avec la
    // liste complète non filtrée pendant la résolution du périmètre.
    if (!perimetre) return

    let cancelled = false

    async function load() {
      try {
        const rows = await fetchAllCache(
          'numero_tiers,intitule_tiers,collaborateur,date_creation,ca_n1,ca_ytd_n,ca_ytd_n1,devis_ytd_n,marge_pct_ytd_n,marge_ytd_n1_value',
          perimetre as Perimetre,
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
            collaborateur: safeText(row.collaborateur),
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
  }, [perimetre])

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

  useEffect(() => {
    if (!cibleNumero || !allClients) return
    const trouve = allClients.find((c) => c.numero === cibleNumero)
    const client: ClientRow = trouve || {
      numero: cibleNumero,
      nom: cibleNom || cibleNumero,
      collaborateur: '',
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
      const nowIso = new Date().toISOString()

      const [
        activiteRes, devisRes, devisConvertisBcRes, devisConvertisFactureRes, actionsRes, monthRes,
        fluxNRes, fluxN1Res, contactsRes, adresseRes,
        visitePasseeRes, visiteFutureRes, transformationsRes,
      ] = await Promise.all([
        supabase
          .from('activite_lignes')
          .select('numero_piece,type_document,reference,date_piece,date_bc,date_pl,date_bl,reference_article,designation,quantite,montant_ht')
          .in('type_document', ['Bon de commande', 'Préparation de livraison', 'Bon de livraison', 'Bon de retour'])
          .eq('numero_tiers_entete', client.numero)
          .limit(600),
        supabase
          .from('devis_lignes')
          // CORRECTIF : sélectionnait jusqu'ici reference_client (colonne
          // 100% vide sur toute la table -- vérifié : 0 valeur non nulle
          // sur 843 003 lignes) au lieu de reference, qui porte la vraie
          // référence chantier (ex. "YACHVILI EXE5"), déjà utilisée telle
          // quelle côté activite_lignes pour les CDC/PL/BL/BR ci-dessus.
          // La "Référence chantier" affichée sur une fiche devis était
          // donc systématiquement vide.
          //
          // CORRECTIF : aucun filtre type_document n'était appliqué --
          // devis_lignes contient aussi les lignes de commande/PL/BL/BR
          // liées (colonnes numero_piece_bc, numero_piece_bl...), donc la
          // section "Devis" pouvait afficher des pièces d'un autre type.
          .select('numero_piece,reference,date_devis,reference_article,designation,quantite,montant_ht')
          .eq('numero_tiers_entete', client.numero)
          .eq('type_document', 'Devis')
          .order('date_devis', { ascending: false })
          .limit(300),
        // ÉVOLUTION : seuls les devis pas encore transformés en commande
        // ni facturés doivent s'afficher -- ces deux requêtes récupèrent
        // les numéros de devis déjà "consommés" (via numero_piece_devis,
        // rempli sur les lignes de commande de devis_lignes et sur
        // facture_lignes quand Sage a conservé le lien vers le devis
        // d'origine), pour les exclure ci-dessous. Absence de lien = on
        // ne peut pas savoir, le devis reste affiché plutôt que d'être
        // masqué à tort.
        supabase
          .from('devis_lignes')
          .select('numero_piece_devis')
          .eq('numero_tiers_entete', client.numero)
          .eq('type_document', 'Bon de commande')
          .not('numero_piece_devis', 'is', null),
        supabase
          .from('facture_lignes')
          .select('numero_piece_devis')
          .eq('numero_tiers_entete', client.numero)
          .not('numero_piece_devis', 'is', null),
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
        supabase.rpc('get_client_flux_ytd', { p_numero_tiers: client.numero, p_date_debut: ys, p_date_fin: today }),
        supabase.rpc('get_client_flux_ytd', { p_numero_tiers: client.numero, p_date_debut: ysN1, p_date_fin: sameDayN1 }),
        supabase
          .from('partner_base_partner')
          .select('id,first_name,last_name,company_name,job_title,phone,mail')
          .ilike('reference', `${client.numero}-%`)
          .not('reference', 'ilike', '%-liv')
          .order('last_name', { ascending: true })
          .limit(50),
        supabase
          .from('ref_tiers')
          .select('adresse,complement_adresse,code_postal,ville,telephone')
          .eq('numero', client.numero)
          .maybeSingle(),
        // CORRECTIF : dernière/prochaine visite venaient uniquement de
        // crm_base_activity (RDV synchronisés BLG), donc invisibles pour
        // les RDV "compagnon CEGECLIM" (créés dans l'app, indépendants de
        // BLG/Outlook -- table rdv_compagnon). v_rdv_unifie combine les
        // deux sources par numero_tiers, comme déjà fait dans
        // MobileRdv.tsx -- même requête reprise ici.
        supabase
          .from('v_rdv_unifie')
          .select('rdv_id,source,blg_activity_id,compagnon_id,type,subject,start_date,end_date,all_day')
          .eq('numero_tiers', client.numero)
          .lt('start_date', nowIso)
          .order('start_date', { ascending: false })
          .limit(1),
        supabase
          .from('v_rdv_unifie')
          .select('rdv_id,source,blg_activity_id,compagnon_id,type,subject,start_date,end_date,all_day')
          .eq('numero_tiers', client.numero)
          .gte('start_date', nowIso)
          .order('start_date', { ascending: true })
          .limit(1),
        // ÉVOLUTION : documents (devis/commandes) avec un traitement "à
        // traiter" en cours -- pour le badge dans la liste et l'affichage
        // enrichi dans openDocDetail (voir DevisTransformation).
        supabase
          .from('devis_transformations')
          .select('id, type_document, numero_piece_devis_origine, statut, motif, date_livraison_souhaitee, reference_chantier_demandee, created_by_name, created_at')
          .eq('numero_tiers', client.numero)
          .eq('statut', 'a_traiter'),
      ])

      if (activiteRes.error) loadErrors.push(activiteRes.error.message)
      if (devisRes.error) loadErrors.push(devisRes.error.message)
      if (actionsRes.error) loadErrors.push(actionsRes.error.message)
      if (fluxNRes.error) loadErrors.push(fluxNRes.error.message)
      if (fluxN1Res.error) loadErrors.push(fluxN1Res.error.message)
      if (contactsRes.error) loadErrors.push(contactsRes.error.message)
      if (visitePasseeRes.error) loadErrors.push(visitePasseeRes.error.message)
      if (visiteFutureRes.error) loadErrors.push(visiteFutureRes.error.message)
      if (transformationsRes.error) loadErrors.push(transformationsRes.error.message)
      // Les deux requêtes d'exclusion (devisConvertisBcRes/FactureRes) ne
      // sont volontairement pas remontées dans loadErrors : une erreur
      // dessus ne doit pas bloquer l'affichage de la fiche, juste
      // désactiver l'exclusion (le filtre ci-dessous les traite comme des
      // listes vides en cas d'erreur, via `.data || []`).
      if (devisConvertisBcRes.error) console.warn('[MobileClients] lecture devis->commande impossible :', devisConvertisBcRes.error.message)
      if (devisConvertisFactureRes.error) console.warn('[MobileClients] lecture devis->facture impossible :', devisConvertisFactureRes.error.message)

      const activiteRows = activiteRes.data || []
      const byType = (t: string) => activiteRows.filter((r: any) => r.type_document === t)

      const commandes = aggregateByDocument(byType('Bon de commande'), ['date_bc', 'date_piece'])
      const preparations = aggregateByDocument(byType('Préparation de livraison'), ['date_pl', 'date_piece'])
      const livraisons = aggregateByDocument(byType('Bon de livraison'), ['date_bl', 'date_piece'])
      const retours = aggregateByDocument(byType('Bon de retour'), ['date_bl', 'date_piece'])

      // ÉVOLUTION : ne garder que les devis pas encore transformés en
      // commande ni facturés -- exclusion via les numéros de devis déjà
      // référencés (numero_piece_devis) côté commande/facture.
      const numerosDevisConvertis = new Set<string>([
        ...((devisConvertisBcRes.data || []) as Array<{ numero_piece_devis: string | null }>).map((r) => safeText(r.numero_piece_devis)),
        ...((devisConvertisFactureRes.data || []) as Array<{ numero_piece_devis: string | null }>).map((r) => safeText(r.numero_piece_devis)),
      ].filter(Boolean))
      const devisNonConvertis = (devisRes.data || []).filter((r: any) => !numerosDevisConvertis.has(safeText(r.numero_piece)))
      const devis = aggregateByDocument(devisNonConvertis, ['date_devis'])

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

      function mapVisite(row: any): VisiteEvent | null {
        if (!row) return null
        return {
          rdvId: String(row.rdv_id ?? ''),
          source: row.source === 'compagnon' ? 'compagnon' : 'blg',
          blgActivityId: row.blg_activity_id ? String(row.blg_activity_id) : null,
          compagnonId: row.compagnon_id ? String(row.compagnon_id) : null,
          type: String(row.type ?? ''),
          subject: String(row.subject || RDV_TYPE_LABELS[String(row.type ?? '')] || 'Activité'),
          start: String(row.start_date || ''),
          end: String(row.end_date || row.start_date || ''),
          allDay: Boolean(row.all_day),
        }
      }
      const derniereVisite = mapVisite((visitePasseeRes.data || [])[0])
      const prochaineVisite = mapVisite((visiteFutureRes.data || [])[0])

      const transformationsEnCours: DevisTransformation[] = transformationsRes.error
        ? []
        : (transformationsRes.data || []).map((r: any) => ({
            id: String(r.id),
            typeDocument: r.type_document === 'commande' ? 'commande' : 'devis',
            numeroPieceDevisOrigine: String(r.numero_piece_devis_origine || ''),
            statut: String(r.statut || ''),
            motif: r.motif || null,
            dateLivraisonSouhaitee: r.date_livraison_souhaitee || null,
            referenceChantierDemandee: r.reference_chantier_demandee || null,
            createdByName: r.created_by_name || null,
            createdAt: String(r.created_at || ''),
          }))

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
        transformationsEnCours,
        loadErrors,
      })
    } catch (e) {
      console.error('[MobileClients] erreur chargement fiche client', e)
      setDetail({
        commandes: [], preparations: [], livraisons: [], retours: [], devis: [], actions: [],
        blYtd: 0, caYtd: 0, caYtdN1: 0, contacts: [], adresse: null, derniereVisite: null, prochaineVisite: null, devisYtdN1: 0,
        transformationsEnCours: [],
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
        onOpenStock={onOpenStock}
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
        onTaskCreated={(created) => {
          setDetail((cur) => (cur ? { ...cur, actions: [...cur.actions, created] } : cur))
        }}
      />
    )
  }

  return (
    <div style={{ padding: '16px 3px', display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          fontSize: 15.5,
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
                fontSize: 11,
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
                  <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
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
                <div style={{ fontSize: 15.5, fontWeight: 600 }}>{c.nom || '(nom non renseigné)'}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                  N° {c.numero}
                  {c.collaborateur && <span style={{ color: 'rgba(166,161,129,0.9)' }}> ({formatCollaborateurCourt(c.collaborateur)})</span>}
                </div>
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
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 23, fontWeight: 600, color: '#fff', marginTop: 4 }}>
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
  client, detail, loading, currentEmail, currentName, onBack, onActionSaved, onTaskCreated, onOpenStock,
}: {
  client: ClientRow
  detail: ClientDetail | null
  loading: boolean
  currentEmail: string
  currentName: string
  onBack: () => void
  onActionSaved: (updated: TaskRow) => void
  /** ÉVOLUTION : création manuelle (ou vocale) d'une tâche directement
   * depuis la fiche client -- voir bouton "+ Tâche" à côté du nom du
   * client et NouvelleTacheSheet ci-dessous. La tâche est immédiatement
   * ajoutée à la liste locale detail.actions (même mécanique que
   * onActionSaved) pour éviter de recharger toute la fiche. */
  onTaskCreated: (created: ActionRow) => void
  onOpenStock?: (reference: string, designation: string) => void
}) {
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[]; footer?: React.ReactNode } | null>(null)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)
  const [contactsOuverts, setContactsOuverts] = useState(false)
  const [navigationVers, setNavigationVers] = useState<{ adresse: string; lat?: number | null; lon?: number | null } | null>(null)
  const [appelVers, setAppelVers] = useState<string | null>(null)
  const [nouvelleTacheOuverte, setNouvelleTacheOuverte] = useState(false)
  // ÉVOLUTION (2026-09-02) : même principe que "+ Tâche" mais pour créer
  // un RDV avec ce client déjà préselectionné -- réutilise NouveauRdvSheet
  // (exporté depuis MobileRdv.tsx) au lieu de dupliquer le formulaire.
  const [nouveauRdvOuvert, setNouveauRdvOuvert] = useState(false)
  // ÉVOLUTION : "décision client sur devis" -- voir DevisTransformation*
  // ci-dessus. devisATraiter ouvre le formulaire de composition à partir
  // d'un devis donné ; transformationsOuvertes/transformations gèrent la
  // liste "Devis à transformer en CDC" déjà générés pour ce client
  // (chargée à la demande, comme tachesTerminees).
  const [devisATraiter, setDevisATraiter] = useState<DocAgrege | null>(null)
  const [transformationsOuvertes, setTransformationsOuvertes] = useState(false)
  const [transformations, setTransformations] = useState<DevisTransformation[] | null>(null)
  const [transformationsLoading, setTransformationsLoading] = useState(false)
  // ÉVOLUTION : modification d'une commande (date de livraison souhaitée /
  // référence chantier) -- même mécanique que devisATraiter mais pour les
  // commandes (CommandeModificationSheet ci-dessous).
  const [commandeAModifier, setCommandeAModifier] = useState<DocAgrege | null>(null)

  /** Documents (devis ou commandes) avec un traitement "à traiter" en
   * cours, indexés par numéro de pièce -- pour le badge dans les listes
   * et l'enrichissement de la fiche du document dans openDocDetail. */
  const transformationsParPiece = useMemo(() => {
    const map: Record<string, DevisTransformation> = {}
    for (const t of detail?.transformationsEnCours || []) {
      map[t.numeroPieceDevisOrigine] = t
    }
    return map
  }, [detail?.transformationsEnCours])

  // ÉVOLUTION : alertes de suivi paramétrables par client (nb d'appels/
  // visites min par mois, nb de jours sans devis, nb de jours sans
  // commande) -- lues/écrites via get_client_alertes_config /
  // upsert_client_alertes_config. Un contrôle quotidien côté base (cron)
  // évalue ces seuils pour tous les clients paramétrés et crée une tâche
  // dans todo_actions (due_date = jour de création, mission_project =
  // "Alerte suivi client") quand un seuil est dépassé -- rien à faire ici
  // pour la création de la tâche elle-même, cet écran ne gère que le
  // paramétrage des seuils.
  const [alertesConfig, setAlertesConfig] = useState<{
    min_appels_visites_mois: number | null
    max_jours_sans_devis: number | null
    max_jours_sans_commande: number | null
  } | null>(null)
  const [alertesSaving, setAlertesSaving] = useState(false)
  const [alertesSaved, setAlertesSaved] = useState(false)
  // ÉVOLUTION (2026-09-02) : pavé replié par défaut -- réduit l'encombrement
  // de la fiche client (le pavé était bien positionné mais toujours
  // déplié, prenait de la place même pour un client sans seuil particulier
  // à ajuster). Se déplie au tap sur l'en-tête.
  const [alertesOuvertes, setAlertesOuvertes] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function charger() {
      setAlertesConfig(null)
      const { data, error } = await supabase.rpc('get_client_alertes_config', { p_numero_tiers: client.numero })
      if (cancelled) return
      if (error) {
        console.warn('[MobileClients] lecture alertes config impossible :', error.message)
        setAlertesConfig({ min_appels_visites_mois: null, max_jours_sans_devis: null, max_jours_sans_commande: null })
        return
      }
      const row = Array.isArray(data) ? data[0] : data
      setAlertesConfig({
        min_appels_visites_mois: row?.min_appels_visites_mois ?? null,
        max_jours_sans_devis: row?.max_jours_sans_devis ?? null,
        max_jours_sans_commande: row?.max_jours_sans_commande ?? null,
      })
    }
    void charger()
    return () => { cancelled = true }
  }, [client.numero])

  async function enregistrerAlertesConfig() {
    if (!alertesConfig) return
    setAlertesSaving(true)
    setAlertesSaved(false)
    try {
      const { error } = await supabase.rpc('upsert_client_alertes_config', {
        p_numero_tiers: client.numero,
        p_min_appels_visites_mois: alertesConfig.min_appels_visites_mois,
        p_max_jours_sans_devis: alertesConfig.max_jours_sans_devis,
        p_max_jours_sans_commande: alertesConfig.max_jours_sans_commande,
        p_updated_by_email: currentEmail || null,
      })
      if (error) throw error
      setAlertesSaved(true)
      window.setTimeout(() => setAlertesSaved(false), 2000)
    } catch (e) {
      console.error('[MobileClients] échec enregistrement alertes config', e)
    } finally {
      setAlertesSaving(false)
    }
  }

  // ÉVOLUTION : historique des tâches terminées sur les 6 derniers mois --
  // chargé uniquement au clic (pas au chargement de la fiche), pour ne pas
  // alourdir l'ouverture d'un client avec une requête dont on n'a pas
  // toujours besoin.
  const [tachesTermineesOuvertes, setTachesTermineesOuvertes] = useState(false)
  const [tachesTerminees, setTachesTerminees] = useState<TacheTermineeRow[] | null>(null)
  const [tachesTermineesLoading, setTachesTermineesLoading] = useState(false)

  async function ouvrirTachesTerminees() {
    setTachesTermineesOuvertes(true)
    setTachesTermineesLoading(true)
    const depuis = new Date()
    depuis.setMonth(depuis.getMonth() - 6)
    const { data, error } = await supabase
      .from('todo_actions')
      .select('id, description_action, due_date, assigned_to, updated_at')
      .eq('numero_tiers', client.numero)
      .eq('status', 'Terminé')
      .gte('updated_at', depuis.toISOString())
      .order('updated_at', { ascending: false })
      .limit(100)
    setTachesTermineesLoading(false)
    if (error) {
      console.error('[MobileClients] erreur chargement tâches terminées', error)
      setTachesTerminees([])
      return
    }
    setTachesTerminees(
      (data || []).map((r: any) => ({
        id: String(r.id),
        libelle: String(r.description_action || ''),
        dueDate: r.due_date || null,
        updatedAt: String(r.updated_at || ''),
        assignedTo: r.assigned_to || null,
      })),
    )
  }

  /** Charge la liste des documents "à traiter" (devis à transformer en
   * CDC, commandes à modifier dans l'ERP) déjà générés pour ce client,
   * tous statuts confondus -- appelé au clic sur la section dédiée, pas
   * au chargement de la fiche. */
  async function ouvrirTransformations() {
    setTransformationsOuvertes(true)
    setTransformationsLoading(true)
    const { data, error } = await supabase
      .from('devis_transformations')
      .select('id, type_document, numero_piece_devis_origine, statut, motif, date_livraison_souhaitee, reference_chantier_demandee, created_by_name, created_at')
      .eq('numero_tiers', client.numero)
      .order('created_at', { ascending: false })
      .limit(50)
    setTransformationsLoading(false)
    if (error) {
      console.error('[MobileClients] erreur chargement devis_transformations', error)
      setTransformations([])
      return
    }
    setTransformations(
      (data || []).map((r: any) => ({
        id: String(r.id),
        typeDocument: r.type_document === 'commande' ? 'commande' : 'devis',
        numeroPieceDevisOrigine: String(r.numero_piece_devis_origine || ''),
        statut: String(r.statut || ''),
        motif: r.motif || null,
        dateLivraisonSouhaitee: r.date_livraison_souhaitee || null,
        referenceChantierDemandee: r.reference_chantier_demandee || null,
        createdByName: r.created_by_name || null,
        createdAt: String(r.created_at || ''),
      })),
    )
  }

  /** Détail (lecture) d'un document "à traiter" déjà généré -- branche
   * l'affichage selon le type : lignes (conservées/supprimées/nouvelles)
   * pour un devis, champs d'en-tête (date livraison / référence chantier)
   * pour une commande. Un bouton permet de marquer le document comme
   * traité manuellement (en plus du passage automatique par le trigger
   * DB quand la tâche liée est clôturée -- voir migration). */
  async function openTransformationDetail(t: DevisTransformation) {
    async function marquerTransforme() {
      const { error: err } = await supabase
        .from('devis_transformations')
        .update({ statut: 'transforme', updated_at: new Date().toISOString() })
        .eq('id', t.id)
      if (err) {
        window.alert(err.message)
        return
      }
      setOpenDetail(null)
      setTransformations((cur) => (cur ? cur.map((x) => (x.id === t.id ? { ...x, statut: 'transforme' } : x)) : cur))
    }
    const statutLabel = t.statut === 'transforme' ? '✅ Transformé' : t.statut === 'annule' ? '✖ Annulé' : '⏳ À traiter'
    const footerMarquer = t.statut === 'a_traiter' ? (
      <button
        type="button"
        onClick={() => void marquerTransforme()}
        style={{ padding: '13px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14, fontWeight: 700 }}
      >
        ✓ Marquer comme traité
      </button>
    ) : undefined

    if (t.typeDocument === 'commande') {
      setOpenDetail({
        title: `Modification de commande — ${t.numeroPieceDevisOrigine}`,
        subtitle: `${statutLabel}${t.motif ? ` · ${t.motif}` : ''}`,
        fields: [
          { label: 'Nouvelle date de livraison souhaitée', value: t.dateLivraisonSouhaitee ? formatDateFr(t.dateLivraisonSouhaitee) : '—' },
          { label: 'Nouvelle référence chantier', value: t.referenceChantierDemandee || '—' },
          { label: 'Demandé par', value: [t.createdByName, formatDateFr(normalizeDateIso(t.createdAt))].filter(Boolean).join(' · ') || '—' },
        ],
        footer: footerMarquer,
      })
      return
    }

    const { data, error } = await supabase
      .from('devis_transformation_lignes')
      .select('id, numero_ligne, origine, reference_article, designation, quantite, montant_ht, taux_remise')
      .eq('transformation_id', t.id)
      .order('numero_ligne', { ascending: true })
    if (error) {
      console.error('[MobileClients] erreur chargement devis_transformation_lignes', error)
    }
    const lignes: DevisTransformationLigne[] = (data || []).map((r: any) => ({
      id: String(r.id),
      numeroLigne: r.numero_ligne === null || r.numero_ligne === undefined ? null : Number(r.numero_ligne),
      origine: r.origine,
      referenceArticle: String(r.reference_article || ''),
      designation: String(r.designation || ''),
      quantite: r.quantite === null || r.quantite === undefined ? null : safeNumber(r.quantite),
      montantHt: r.montant_ht === null || r.montant_ht === undefined ? null : safeNumber(r.montant_ht),
      tauxRemise: r.taux_remise === null || r.taux_remise === undefined ? null : safeNumber(r.taux_remise),
    }))
    const labelOrigine: Record<string, string> = { conservee: 'Conservée', supprimee: 'À supprimer', nouvelle: 'Nouvelle' }
    setOpenDetail({
      title: `Devis à transformer en CDC — ${t.numeroPieceDevisOrigine}`,
      subtitle: `${statutLabel}${t.motif ? ` · ${t.motif}` : ''}`,
      fields: lignes.map((l) => ({
        label: `${l.numeroLigne ? `L${l.numeroLigne} · ` : ''}[${labelOrigine[l.origine] || l.origine}] ${l.referenceArticle || '—'}${l.designation ? ` — ${l.designation}` : ''}`,
        value: [
          l.quantite !== null ? `Qté ${l.quantite}` : null,
          l.tauxRemise !== null ? `Remise ${l.tauxRemise}%` : null,
          l.montantHt !== null ? formatMoney(l.montantHt) : null,
        ].filter(Boolean).join(' · ') || '—',
      })),
      footer: footerMarquer,
    })
  }

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

  /** ÉVOLUTION : si un traitement "à traiter" existe déjà pour ce document
   * (devis ou commande, voir transformationsParPiece), la fiche affiche
   * en plus les lignes modifiées/supprimées/ajoutées (pour un devis) ou
   * les nouvelles valeurs demandées (pour une commande), et le bouton
   * d'action pointe vers ce traitement au lieu d'en proposer un nouveau. */
  async function openDocDetail(d: DocAgrege, type: string) {
    const enCours = transformationsParPiece[d.numeroPiece]
    const estDevisAvecTraitement = type === 'Devis' && enCours && enCours.typeDocument === 'devis'
    const estCommandeAvecTraitement = type === 'Bon de commande' && enCours && enCours.typeDocument === 'commande'

    let lignesTraitement: DevisTransformationLigne[] = []
    if (estDevisAvecTraitement) {
      const { data } = await supabase
        .from('devis_transformation_lignes')
        .select('id, numero_ligne, origine, reference_article, designation, quantite, montant_ht, taux_remise')
        .eq('transformation_id', enCours!.id)
        .order('numero_ligne', { ascending: true })
      lignesTraitement = (data || []).map((r: any) => ({
        id: String(r.id),
        numeroLigne: r.numero_ligne === null || r.numero_ligne === undefined ? null : Number(r.numero_ligne),
        origine: r.origine,
        referenceArticle: String(r.reference_article || ''),
        designation: String(r.designation || ''),
        quantite: r.quantite === null || r.quantite === undefined ? null : safeNumber(r.quantite),
        montantHt: r.montant_ht === null || r.montant_ht === undefined ? null : safeNumber(r.montant_ht),
        tauxRemise: r.taux_remise === null || r.taux_remise === undefined ? null : safeNumber(r.taux_remise),
      }))
    }
    const lignesSupprimees = lignesTraitement.filter((l) => l.origine === 'supprimee')
    const lignesNouvelles = lignesTraitement.filter((l) => l.origine === 'nouvelle')

    const champsBase = [
      { label: 'Date', value: formatDateFr(d.date) },
      { label: 'Référence chantier', value: d.reference || '—' },
      { label: 'Montant total HT', value: formatMoney(d.montantHt) },
      // Lignes d'articles : tap -> détail stock de la référence (si
      // onOpenStock a été fourni par MobileShell). Une ligne sans
      // référence exploitable (rare, ligne de texte libre) reste non
      // cliquable plutôt que d'ouvrir une fiche stock vide.
      //
      // NOTE ordre des lignes : aucune colonne d'ordre fiable n'existe
      // dans devis_lignes/activite_lignes pour l'historique importé en
      // masse (CSV/Excel) -- le seul vrai numéro de ligne Sage
      // (vl_dlno) n'existe que dans sage.devis_hier_aujourdhui /
      // sage.activite_non_facturee, limités aux pièces d'hier/
      // aujourd'hui. Les lignes restent donc ici dans l'ordre renvoyé
      // par la requête, qui ne reflète pas forcément l'ordre Sage --
      // non résolu tant que le pipeline d'import ne capture pas ce
      // numéro de ligne à la source.
      ...d.lignes.map((l) => {
        // Une ligne d'origine flaguée "à supprimer" dans le traitement en
        // cours est signalée ici -- comparaison par référence+désignation
        // (les lignes du devis n'ont pas d'identifiant stable partagé
        // avec devis_transformation_lignes).
        const supprimee = lignesSupprimees.some((s) => s.referenceArticle === l.reference_article && s.designation === l.designation)
        return {
          label: `${supprimee ? '🗑 ' : ''}${l.reference_article || '—'}${l.designation ? ` — ${l.designation}` : ''}`,
          value: `${l.quantite} × ${formatMoney(l.montant_ht)}${supprimee ? ' · à supprimer' : ''}`,
          onClick: onOpenStock && l.reference_article ? () => onOpenStock(l.reference_article, l.designation) : undefined,
        }
      }),
      ...lignesNouvelles.map((l) => ({
        label: `➕ ${l.referenceArticle || '—'}${l.designation ? ` — ${l.designation}` : ''}`,
        value: [
          l.quantite !== null ? `Qté ${l.quantite}` : null,
          l.tauxRemise !== null ? `Remise ${l.tauxRemise}%` : null,
          'nouvelle ligne',
        ].filter(Boolean).join(' · '),
      })),
    ]

    if (estCommandeAvecTraitement) {
      champsBase.push(
        { label: 'Nouvelle date de livraison souhaitée', value: enCours!.dateLivraisonSouhaitee ? formatDateFr(enCours!.dateLivraisonSouhaitee) : '—' },
        { label: 'Nouvelle référence chantier demandée', value: enCours!.referenceChantierDemandee || '—' },
      )
    }

    let footer: React.ReactNode | undefined
    if (estDevisAvecTraitement || estCommandeAvecTraitement) {
      footer = (
        <button
          type="button"
          onClick={() => { setOpenDetail(null); void openTransformationDetail(enCours!) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px', borderRadius: 12, border: '1px solid rgba(75,146,172,0.4)',
            background: 'rgba(75,146,172,0.14)', color: '#8FC7DA', fontSize: 14, fontWeight: 700,
          }}
        >
          👁 Voir le traitement en cours
        </button>
      )
    } else if (type === 'Devis') {
      // ÉVOLUTION : uniquement pour les devis -- bouton pour composer le
      // document "Devis à transformer en CDC" à partir de ce devis
      // (décision prise par le client). Voir DevisTransformationSheet.
      footer = (
        <button
          type="button"
          onClick={() => { setOpenDetail(null); setDevisATraiter(d) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px', borderRadius: 12, border: '1px solid rgba(230,159,74,0.4)',
            background: 'rgba(230,159,74,0.14)', color: '#E8A96A', fontSize: 14, fontWeight: 700,
          }}
        >
          🔧 Traiter ce devis (décision client)
        </button>
      )
    } else if (type === 'Bon de commande') {
      // ÉVOLUTION : modifier la date de livraison souhaitée et/ou la
      // référence chantier d'une commande -- génère une tâche ERP + un
      // document dans la même table que les devis à transformer.
      footer = (
        <button
          type="button"
          onClick={() => { setOpenDetail(null); setCommandeAModifier(d) }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px', borderRadius: 12, border: '1px solid rgba(75,146,172,0.4)',
            background: 'rgba(75,146,172,0.14)', color: '#8FC7DA', fontSize: 14, fontWeight: 700,
          }}
        >
          📅 Modifier livraison / référence chantier
        </button>
      )
    }

    setOpenDetail({
      title: d.numeroPiece || '(sans numéro)',
      subtitle: `${type} · ${formatMoney(d.montantHt)}`,
      fields: champsBase,
      footer,
    })
  }

  function openContactsDetail() {
    setContactsOuverts(true)
  }

  function openVisiteDetail(v: VisiteEvent) {
    const startDate = v.start ? new Date(v.start) : null
    const endDate = v.end ? new Date(v.end) : null
    const fmtTime = (d: Date | null) => (d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
    // L'id à transmettre pour lier un compte-rendu dépend de la source --
    // v_rdv_unifie ne remplit que l'un des deux (voir type VisiteEvent).
    const activityId = v.source === 'compagnon' ? v.compagnonId : v.blgActivityId
    setOpenDetail({
      title: v.subject,
      subtitle: `${RDV_TYPE_LABELS[v.type] || v.type || 'Activité'}${v.source === 'compagnon' ? ' · RDV compagnon' : ''}`,
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
          rdvActivityId={activityId}
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
          margin: '12px 0 4px 10px',
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

      <div style={{ padding: '16px 3px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{client.nom || '(nom non renseigné)'}</div>
            {/* Groupe d'actions à droite -- "+ Tâche" toujours visible (ne
             * dépend pas du chargement du détail), contacts/adresse comme
             * avant une fois le détail chargé. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {!loading && detail && (
                <button
                  onClick={openContactsDetail}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, padding: '3px 9px',
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
                    color: '#8FC7DA', fontSize: 12, fontWeight: 600, padding: '3px 9px',
                    cursor: 'pointer',
                  }}
                >
                  📍 Adresse
                </button>
              )}
              <button
                type="button"
                onClick={() => setNouvelleTacheOuverte(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999,
                  border: '1px solid rgba(63,145,66,0.35)', background: 'rgba(63,145,66,0.12)',
                  color: '#8fd4a8', fontSize: 12, fontWeight: 700, padding: '3px 9px',
                  cursor: 'pointer',
                }}
              >
                + Tâche
              </button>
              <button
                type="button"
                onClick={() => setNouveauRdvOuvert(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999,
                  border: '1px solid rgba(75,146,172,0.35)', background: 'rgba(75,146,172,0.12)',
                  color: '#8FC7DA', fontSize: 12, fontWeight: 700, padding: '3px 9px',
                  cursor: 'pointer',
                }}
              >
                + RDV
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            N° {client.numero}
            {client.collaborateur && <span style={{ color: 'rgba(166,161,129,0.9)' }}> ({formatCollaborateurCourt(client.collaborateur)})</span>}
          </div>
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
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
            Marge depuis le 1er janvier
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>
            {client.margePctYtdN === null ? '—' : `${client.margePctYtdN.toFixed(1)} %`}
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5 }}>
            <EvolLine value={client.margePctYtdN} n1={client.margePctYtdN1} isPoints />
          </div>
        </div>

        <div
          style={{
            borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
            padding: '12px 13px',
          }}
        >
          <div
            onClick={() => setAlertesOuvertes((cur) => !cur)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
              marginBottom: alertesOuvertes ? 8 : 0,
            }}
          >
            <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
              🔔 Alertes de suivi
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', transform: alertesOuvertes ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              ▾
            </span>
          </div>
          {alertesOuvertes && (
            !alertesConfig ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <AlerteSeuilField
                    label="Nb d'appels/visites min par mois"
                    value={alertesConfig.min_appels_visites_mois}
                    onChange={(v) => setAlertesConfig((cur) => (cur ? { ...cur, min_appels_visites_mois: v } : cur))}
                  />
                  <AlerteSeuilField
                    label="Nb de jours sans devis"
                    value={alertesConfig.max_jours_sans_devis}
                    onChange={(v) => setAlertesConfig((cur) => (cur ? { ...cur, max_jours_sans_devis: v } : cur))}
                  />
                  <AlerteSeuilField
                    label="Nb de jours sans commande"
                    value={alertesConfig.max_jours_sans_commande}
                    onChange={(v) => setAlertesConfig((cur) => (cur ? { ...cur, max_jours_sans_commande: v } : cur))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void enregistrerAlertesConfig()}
                  disabled={alertesSaving}
                  style={{
                    marginTop: 10, width: '100%', padding: '10px', borderRadius: 10,
                    border: '1px solid rgba(166,161,129,0.4)',
                    background: alertesSaved ? 'rgba(63,145,66,0.18)' : 'rgba(166,161,129,0.16)',
                    color: alertesSaved ? '#8fd4a8' : '#e4dfc9', fontSize: 13, fontWeight: 700,
                  }}
                >
                  {alertesSaving ? 'Enregistrement…' : alertesSaved ? '✓ Enregistré' : 'Enregistrer les seuils'}
                </button>
                <p style={{ marginTop: 8, fontSize: 10.5, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 }}>
                  Un champ vide désactive la règle correspondante. Le contrôle tourne une fois par jour et crée une tâche dans « À faire » quand un seuil est dépassé.
                </p>
              </>
            )
          )}
        </div>

        <Section title="Actions">
          {loading ? (
            <Loading />
          ) : !detail || detail.actions.length === 0 ? (
            <Empty text="Aucune action en cours pour ce client." />
          ) : (
            detail.actions.map((a) => (
              <TacheRowItem key={a.id} action={a} onClick={() => openActionDetail(a)} />
            ))
          )}
        </Section>

        <RowItem
          title="✅ Tâches terminées (6 derniers mois)"
          onClick={() => void ouvrirTachesTerminees()}
        />

        <DocumentSection title="Commandes (CDC)" loading={loading} docs={detail?.commandes} transformationsParPiece={transformationsParPiece} onOpen={(d) => openDocDetail(d, 'Bon de commande')} />
        <DocumentSection title="Préparations de livraison (PL)" loading={loading} docs={detail?.preparations} onOpen={(d) => openDocDetail(d, 'Préparation de livraison')} />
        <DocumentSection title="Bons de livraison (BL)" loading={loading} docs={detail?.livraisons} onOpen={(d) => openDocDetail(d, 'Bon de livraison')} />
        <DocumentSection title="Bons de retour (BR)" loading={loading} docs={detail?.retours} onOpen={(d) => openDocDetail(d, 'Bon de retour')} />
        <DocumentSection title="Devis" loading={loading} docs={detail?.devis} transformationsParPiece={transformationsParPiece} onOpen={(d) => openDocDetail(d, 'Devis')} />

        <RowItem
          title="🔧 Documents à traiter (devis / commandes)"
          onClick={() => void ouvrirTransformations()}
        />
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

      {tachesTermineesOuvertes && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 240, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setTachesTermineesOuvertes(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Tâches terminées</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>{client.nom || client.numero} · 6 derniers mois</div>

            {tachesTermineesLoading ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', padding: '10px 0' }}>Chargement…</div>
            ) : !tachesTerminees || tachesTerminees.length === 0 ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', padding: '10px 0' }}>Aucune tâche terminée sur cette période.</div>
            ) : (
              tachesTerminees.map((t) => (
                <div key={t.id} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 13.5, color: '#fff', lineHeight: 1.4 }}>{t.libelle || '(sans libellé)'}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                    Terminée le {formatDateFr(normalizeDateIso(t.updatedAt))}
                    {t.assignedTo ? ` · ${t.assignedTo}` : ''}
                  </div>
                </div>
              ))
            )}

            <button
              type="button"
              onClick={() => setTachesTermineesOuvertes(false)}
              style={{ marginTop: 8, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {nouvelleTacheOuverte && (
        <NouvelleTacheSheet
          client={client}
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setNouvelleTacheOuverte(false)}
          onCreated={(task) => onTaskCreated(task)}
        />
      )}

      {nouveauRdvOuvert && (
        <NouveauRdvSheet
          currentEmail={currentEmail}
          currentName={currentName}
          clientPreselectionne={{ numero: client.numero, nom: client.nom }}
          onClose={() => setNouveauRdvOuvert(false)}
          onCreated={() => {}}
        />
      )}

      {devisATraiter && (
        <DevisTransformationSheet
          client={client}
          devis={devisATraiter}
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setDevisATraiter(null)}
          onCreated={(task) => onTaskCreated(task)}
        />
      )}

      {commandeAModifier && (
        <CommandeModificationSheet
          numeroTiers={client.numero}
          nomClient={client.nom}
          numeroPiece={commandeAModifier.numeroPiece}
          referenceActuelle={commandeAModifier.reference}
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setCommandeAModifier(null)}
          onCreated={(task) => onTaskCreated(task)}
        />
      )}

      {transformationsOuvertes && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 240, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setTransformationsOuvertes(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Documents à traiter</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>{client.nom || client.numero}</div>

            {transformationsLoading ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', padding: '10px 0' }}>Chargement…</div>
            ) : !transformations || transformations.length === 0 ? (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', padding: '10px 0' }}>Aucun document à traiter pour ce client.</div>
            ) : (
              transformations.map((t) => (
                <div
                  key={t.id}
                  onClick={() => { setTransformationsOuvertes(false); void openTransformationDetail(t) }}
                  style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: '#fff' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>
                        {t.typeDocument === 'commande' ? 'Commande' : 'Devis'}
                      </span>{' '}
                      {t.numeroPieceDevisOrigine || '—'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.statut === 'transforme' ? '#8fd4a8' : t.statut === 'annule' ? 'rgba(255,255,255,0.4)' : '#E8A96A' }}>
                      {t.statut === 'transforme' ? '✅ Traité' : t.statut === 'annule' ? '✖ Annulé' : '⏳ À traiter'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
                    {[t.createdByName, formatDateFr(normalizeDateIso(t.createdAt)), t.motif].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))
            )}

            <button
              type="button"
              onClick={() => setTransformationsOuvertes(false)}
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

/** ÉVOLUTION : création d'une tâche directement depuis la fiche client --
 * déjà affectée à ce client (numero_tiers pré-rempli, non modifiable) ;
 * deux façons de créer : saisie manuelle (description/échéance/assigné)
 * ou par la voix via VoiceReportButtons (bouton "Tâche vocale" déjà
 * utilisé ailleurs pour les comptes-rendus/tâches liés à un RDV -- ici
 * réutilisé sans rendez-vous associé, voir NOTE ci-dessous). */
function NouvelleTacheSheet({
  client, currentEmail, currentName, onClose, onCreated,
}: {
  client: ClientRow
  currentEmail: string
  currentName: string
  onClose: () => void
  onCreated: (task: ActionRow) => void
}) {
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // ÉVOLUTION (2026-09-02) : la dictée vocale bascule désormais sur un
  // calque plein écran dédié (même mécanique que MobileAlertes.tsx), au
  // lieu d'intégrer VoiceReportButtons directement dans la sheet -- FIX
  // du bouton flottant qui se superposait à l'en-tête de l'app faute de
  // fond opaque derrière lui.
  const [modeVocal, setModeVocal] = useState(false)

  async function creer() {
    if (!description.trim()) { setError('La description est obligatoire.'); return }
    setSaving(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('todo_actions')
        .insert({
          numero_tiers: client.numero,
          description_action: description.trim(),
          due_date: dueDate || null,
          assigned_to: assignedTo.trim() || null,
          status: 'Non débuté',
          // FIX : created_by_email / created_by_name sont NOT NULL sur
          // todo_actions (vérifié en base) -- oubliés dans une version
          // précédente de cette sheet, ce qui aurait fait échouer tout
          // insert de tâche manuelle.
          created_by_email: currentEmail,
          created_by_name: currentName,
        })
        .select('id, description_action, status, due_date, assigned_to')
        .single()
      if (err) throw err
      onCreated({
        id: String(data.id),
        libelle: String(data.description_action || ''),
        status: String(data.status || ''),
        due_date: data.due_date || null,
        assigned_to: data.assigned_to || null,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la création de la tâche.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !saving && onClose()}>
      <div style={{ width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Nouvelle tâche</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: -6 }}>{client.nom || client.numero}</div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Description</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Ex. : Relancer sur le devis en cours…"
            autoFocus
            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 14.5, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Échéance (facultatif)</div>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Assignée à</div>
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Nom…" style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
          </div>
        </div>

        {error && <div style={{ fontSize: 13, color: '#e0a685' }}>{error}</div>}

        <button
          type="button"
          onClick={() => void creer()}
          disabled={saving}
          style={{ padding: '13px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14.5, fontWeight: 700 }}
        >
          {saving ? 'Création…' : 'Créer la tâche'}
        </button>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            Ou par la voix
          </div>
          <button
            type="button"
            onClick={() => setModeVocal(true)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.35)',
              background: 'rgba(166,161,129,0.12)', color: '#e4dfc9', fontSize: 14, fontWeight: 700,
            }}
          >
            🎙️ Tâche vocale
          </button>
        </div>

        <button
          type="button"
          onClick={() => !saving && onClose()}
          style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
        >
          Fermer
        </button>
      </div>

      {/* ÉVOLUTION : calque plein écran dédié à la dictée vocale, avec un
         fond opaque (contrairement à l'ancien embed inline) -- même
         correctif que MobileAlertes.tsx : sans ce fond, le bouton
         flottant de VoiceReportButtons se superposait à l'en-tête de
         l'app derrière, illisible. NOTE : numeroTiers/clientNom sont
         transmis pour que la tâche créée par la voix reste rattachée à ce
         client, en plus de modeUnique/labelBouton/pleinEcran (mêmes props
         que l'usage plein écran de MobileAlertes.tsx) -- à vérifier côté
         VoiceReportButtons.tsx (non fourni) que la combinaison des deux
         jeux de props est bien prise en compte. */}
      {modeVocal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 280, background: '#0B1220' }}>
          <VoiceReportButtons
            numeroTiers={client.numero}
            clientNom={client.nom}
            modeUnique="tache"
            labelBouton="Tâche vocale"
            pleinEcran
            userEmail={currentEmail}
            userName={currentName}
          />
          <button
            type="button"
            onClick={() => setModeVocal(false)}
            aria-label="Fermer"
            style={{
              position: 'fixed', top: 18, right: 18, zIndex: 290,
              width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(20,26,38,0.9)', color: '#fff', fontSize: 20, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

/** ÉVOLUTION : composition du document "Devis à transformer en CDC" à
 * partir d'un devis existant, quand le client a pris sa décision. Trois
 * catégories de lignes possibles :
 * - les lignes du devis d'origine, conservées par défaut, que l'on peut
 *   flaguer "à supprimer" (toggle, pas de suppression physique -- la
 *   ligne est conservée avec origine='supprimee' dans le document généré,
 *   pour garder une trace de ce qui a été retiré) ;
 * - de nouvelles lignes ajoutées à la main, avec aide à la saisie de la
 *   référence article (autocomplete sur v_stock_articles_latest), une
 *   quantité et un taux de remise saisi manuellement (pas de calcul
 *   automatique -- choix explicite d'Arnaud, les taux de remise client
 *   n'étant pas centralisés en base).
 * À la validation : insert dans devis_transformations (statut initial
 * 'a_traiter') + toutes les lignes dans devis_transformation_lignes, puis
 * création d'une tâche todo_actions pour le suivi commercial. */
function DevisTransformationSheet({
  client, devis, currentEmail, currentName, onClose, onCreated,
}: {
  client: ClientRow
  devis: DocAgrege
  currentEmail: string
  currentName: string
  onClose: () => void
  onCreated: (task: ActionRow) => void
}) {
  const [motif, setMotif] = useState('')
  // Une entrée par ligne d'origine -- true = conservée (défaut), false =
  // flaguée pour suppression.
  const [garder, setGarder] = useState<boolean[]>(() => devis.lignes.map(() => true))

  const [nouvelles, setNouvelles] = useState<{ reference: string; designation: string; quantite: number; tauxRemise: string }[]>([])
  const [refSearch, setRefSearch] = useState('')
  const [refResults, setRefResults] = useState<{ reference_article: string; designation: string }[]>([])
  const [refSelectionnee, setRefSelectionnee] = useState<{ reference: string; designation: string } | null>(null)
  const [qteAAjouter, setQteAAjouter] = useState(1)
  const [remiseAAjouter, setRemiseAAjouter] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = refSearch.trim()
    if (!q || refSelectionnee) { setRefResults([]); return }
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from('v_stock_articles_latest')
        .select('reference_article, designation')
        .or(`reference_article.ilike.%${q}%,designation.ilike.%${q}%`)
        .limit(10)
      setRefResults(((data || []) as any[]).map((r) => ({ reference_article: String(r.reference_article || ''), designation: String(r.designation || '') })))
    }, 250)
    return () => window.clearTimeout(t)
  }, [refSearch, refSelectionnee])

  function ajouterLigne() {
    if (!refSelectionnee) return
    setNouvelles((cur) => [...cur, {
      reference: refSelectionnee.reference,
      designation: refSelectionnee.designation,
      quantite: qteAAjouter || 1,
      tauxRemise: remiseAAjouter,
    }])
    setRefSelectionnee(null)
    setRefSearch('')
    setQteAAjouter(1)
    setRemiseAAjouter('')
  }

  function retirerNouvelleLigne(index: number) {
    setNouvelles((cur) => cur.filter((_, i) => i !== index))
  }

  async function valider() {
    setSaving(true)
    setError('')
    try {
      const { data: transfo, error: errTransfo } = await supabase
        .from('devis_transformations')
        .insert({
          numero_tiers: client.numero,
          type_document: 'devis',
          numero_piece_devis_origine: devis.numeroPiece,
          statut: 'a_traiter',
          motif: motif.trim() || null,
          created_by_email: currentEmail,
          created_by_name: currentName,
        })
        .select('id')
        .single()
      if (errTransfo) throw errTransfo
      const transformationId = transfo.id as string

      // Numéro de ligne généré côté app (pas de numéro fiable en base,
      // voir commentaire sur la migration) : reprend l'ordre du devis
      // d'origine pour les lignes conservées/supprimées (1..N), puis
      // continue la numérotation pour les nouvelles lignes.
      const lignesOrigine = devis.lignes.map((l, i) => ({
        transformation_id: transformationId,
        numero_ligne: i + 1,
        origine: garder[i] ? 'conservee' : 'supprimee',
        reference_article: l.reference_article || null,
        designation: l.designation || null,
        quantite: l.quantite,
        montant_ht: l.montant_ht,
        taux_remise: null as number | null,
      }))
      const lignesNouvelles = nouvelles.map((n, i) => ({
        transformation_id: transformationId,
        numero_ligne: devis.lignes.length + i + 1,
        origine: 'nouvelle',
        reference_article: n.reference || null,
        designation: n.designation || null,
        quantite: n.quantite,
        montant_ht: null as number | null,
        taux_remise: n.tauxRemise.trim() === '' ? null : Number(n.tauxRemise),
      }))
      const lignesAInserer = [...lignesOrigine, ...lignesNouvelles]

      if (lignesAInserer.length > 0) {
        const { error: errLignes } = await supabase.from('devis_transformation_lignes').insert(lignesAInserer)
        if (errLignes) throw errLignes
      }

      const lignesSupprimeesDetail = lignesOrigine.filter((l) => l.origine === 'supprimee')
      const lignesNouvellesDetail = lignesNouvelles

      // Commentaire détaillé de la tâche (colonne comment_progress) :
      // motif saisi par l'utilisateur + détail des lignes supprimées et
      // ajoutées, chacune référencée par son numéro de ligne généré.
      const commentaireParts: string[] = []
      if (motif.trim()) commentaireParts.push(`Motif : ${motif.trim()}`)
      if (lignesSupprimeesDetail.length > 0) {
        commentaireParts.push(
          `Lignes supprimées :\n${lignesSupprimeesDetail
            .map((l) => `- L${l.numero_ligne} : ${l.reference_article || '—'}${l.designation ? ` — ${l.designation}` : ''} (${l.quantite} × ${formatMoney(l.montant_ht || 0)})`)
            .join('\n')}`,
        )
      }
      if (lignesNouvellesDetail.length > 0) {
        commentaireParts.push(
          `Lignes ajoutées :\n${lignesNouvellesDetail
            .map((l) => `- L${l.numero_ligne} : ${l.reference_article || '—'}${l.designation ? ` — ${l.designation}` : ''} (qté ${l.quantite}${l.taux_remise !== null ? `, remise ${l.taux_remise}%` : ''})`)
            .join('\n')}`,
        )
      }

      const { data: tache, error: errTache } = await supabase
        .from('todo_actions')
        .insert({
          numero_tiers: client.numero,
          description_action: `Transformer le devis ${devis.numeroPiece} en commande — Client : ${client.nom || client.numero} (N° ${client.numero})`,
          comment_progress: commentaireParts.join('\n\n') || null,
          status: 'Non débuté',
          assigned_to: currentName,
          created_by_email: currentEmail,
          created_by_name: currentName,
          devis_transformation_id: transformationId,
        })
        .select('id, description_action, status, due_date, assigned_to')
        .single()
      if (errTache) throw errTache

      onCreated({
        id: String(tache.id),
        libelle: String(tache.description_action || ''),
        status: String(tache.status || ''),
        due_date: tache.due_date || null,
        assigned_to: tache.assigned_to || null,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la génération du document.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !saving && onClose()}>
      <div style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Traiter le devis {devis.numeroPiece}</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: -6 }}>{client.nom || client.numero} — décision prise par le client</div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Motif / précisions (facultatif)</div>
          <textarea
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            rows={2}
            placeholder="Ex. : Client valide sauf la ligne pompe, ajoute 2 vannes…"
            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 14, resize: 'vertical' }}
          />
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            Lignes du devis — décocher pour retirer
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {devis.lignes.map((l, i) => (
              <label
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: garder[i] ? 'rgba(255,255,255,0.03)' : 'rgba(193,104,60,0.10)',
                  padding: '9px 11px', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={garder[i]}
                  onChange={(e) => setGarder((cur) => cur.map((g, idx) => (idx === i ? e.target.checked : g)))}
                  style={{ width: 18, height: 18, flexShrink: 0 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 13.5, color: garder[i] ? '#fff' : 'rgba(255,255,255,0.55)',
                    textDecoration: garder[i] ? 'none' : 'line-through',
                  }}>
                    {l.reference_article || '—'}{l.designation ? ` — ${l.designation}` : ''}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>
                    {l.quantite} × {formatMoney(l.montant_ht)}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            Nouvelles lignes
          </div>

          {nouvelles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {nouvelles.map((n, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, border: '1px solid rgba(75,146,172,0.3)', background: 'rgba(75,146,172,0.1)', padding: '9px 11px' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: '#fff' }}>{n.reference || '—'}{n.designation ? ` — ${n.designation}` : ''}</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
                      Qté {n.quantite}{n.tauxRemise.trim() !== '' ? ` · Remise ${n.tauxRemise}%` : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => retirerNouvelleLigne(i)} style={{ border: 'none', background: 'transparent', color: '#e0a685', fontSize: 16, padding: 4 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <input
              value={refSelectionnee ? `${refSelectionnee.reference} — ${refSelectionnee.designation}` : refSearch}
              onChange={(e) => { setRefSearch(e.target.value); setRefSelectionnee(null) }}
              placeholder="Référence ou désignation…"
              style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14 }}
            />
            {refSelectionnee && (
              <button type="button" onClick={() => { setRefSelectionnee(null); setRefSearch('') }} style={{ marginTop: 4, background: 'none', border: 'none', color: '#e0a685', fontSize: 11.5, fontWeight: 600, padding: 0 }}>Retirer</button>
            )}
            {refResults.length > 0 && !refSelectionnee && (
              <div style={{ marginTop: 6, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#0B1220', overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
                {refResults.map((r) => (
                  <button
                    key={r.reference_article}
                    type="button"
                    onClick={() => { setRefSelectionnee({ reference: r.reference_article, designation: r.designation }); setRefResults([]) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', fontSize: 13 }}
                  >
                    <span style={{ color: '#E8A96A', fontWeight: 700 }}>{r.reference_article}</span> · {r.designation}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Quantité</div>
              <input type="number" value={qteAAjouter} onChange={(e) => setQteAAjouter(Number(e.target.value) || 1)} min={1} style={{ width: '100%', height: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 13.5 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>Remise % (manuel)</div>
              <input type="number" value={remiseAAjouter} onChange={(e) => setRemiseAAjouter(e.target.value)} placeholder="—" style={{ width: '100%', height: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 13.5 }} />
            </div>
            <button
              type="button"
              onClick={ajouterLigne}
              disabled={!refSelectionnee}
              style={{
                alignSelf: 'flex-end', height: 38, padding: '0 14px', borderRadius: 10, border: 'none',
                background: refSelectionnee ? 'rgba(63,145,66,0.25)' : 'rgba(63,145,66,0.1)',
                color: refSelectionnee ? '#8fd4a8' : 'rgba(143,212,168,0.4)', fontSize: 13, fontWeight: 700,
              }}
            >
              + Ajouter
            </button>
          </div>
        </div>

        {error && <div style={{ fontSize: 13, color: '#e0a685' }}>{error}</div>}

        <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4, margin: 0 }}>
          Génère un document « Devis à transformer en CDC » (consultable dans « Documents à traiter » sur la fiche client) et une tâche de suivi, avec le détail des lignes retirées/ajoutées en commentaire. La commande elle-même reste à saisir dans Sage ; une fois la tâche clôturée, ce document est automatiquement marqué comme traité.
        </p>

        <button
          type="button"
          onClick={() => void valider()}
          disabled={saving}
          style={{ padding: '13px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14.5, fontWeight: 700 }}
        >
          {saving ? 'Génération…' : 'Générer le document + tâche'}
        </button>
        <button
          type="button"
          onClick={() => !saving && onClose()}
          style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

/** ÉVOLUTION : modification d'une commande (date de livraison souhaitée
 * et/ou référence chantier) -- même principe que DevisTransformationSheet
 * mais sans lignes : un document devis_transformations (type_document =
 * 'commande') porte les nouvelles valeurs demandées, et une tâche est
 * créée pour rappeler de reporter ce changement dans l'ERP (Sage), avec
 * l'ancienne et la nouvelle valeur en commentaire.
 * EXPORTÉ (2026-09-02) : signature en primitives (pas ClientRow/DocAgrege)
 * pour être réutilisable depuis MobileAlertes.tsx (écran "CDC < 2026"),
 * qui ne dispose que d'un CdcDocAgrege, pas d'un ClientRow/DocAgrege. */
export function CommandeModificationSheet({
  numeroTiers, nomClient, numeroPiece, referenceActuelle, currentEmail, currentName, onClose, onCreated,
}: {
  numeroTiers: string
  nomClient: string
  numeroPiece: string
  referenceActuelle: string
  currentEmail: string
  currentName: string
  onClose: () => void
  onCreated?: (task: { id: string; libelle: string; status: string; due_date: string | null; assigned_to: string | null }) => void
}) {
  const [dateLivraison, setDateLivraison] = useState('')
  const [referenceChantier, setReferenceChantier] = useState(referenceActuelle || '')
  const [motif, setMotif] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function valider() {
    const dateChangee = dateLivraison !== ''
    const refChangee = referenceChantier.trim() !== (referenceActuelle || '').trim()
    if (!dateChangee && !refChangee) {
      setError('Renseignez au moins une nouvelle date de livraison ou une nouvelle référence chantier.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data: transfo, error: errTransfo } = await supabase
        .from('devis_transformations')
        .insert({
          numero_tiers: numeroTiers,
          type_document: 'commande',
          numero_piece_devis_origine: numeroPiece,
          statut: 'a_traiter',
          motif: motif.trim() || null,
          date_livraison_souhaitee: dateChangee ? dateLivraison : null,
          reference_chantier_demandee: refChangee ? referenceChantier.trim() : null,
          created_by_email: currentEmail,
          created_by_name: currentName,
        })
        .select('id')
        .single()
      if (errTransfo) throw errTransfo

      const commentaireParts: string[] = []
      if (motif.trim()) commentaireParts.push(`Motif : ${motif.trim()}`)
      if (dateChangee) commentaireParts.push(`Nouvelle date de livraison souhaitée : ${formatDateFr(dateLivraison)}`)
      if (refChangee) commentaireParts.push(`Référence chantier actuelle : ${referenceActuelle || '—'} → demandée : ${referenceChantier.trim() || '—'}`)

      const { data: tache, error: errTache } = await supabase
        .from('todo_actions')
        .insert({
          numero_tiers: numeroTiers,
          description_action: `Reporter dans l'ERP la modification de la commande ${numeroPiece} — Client : ${nomClient || numeroTiers} (N° ${numeroTiers})`,
          comment_progress: commentaireParts.join('\n') || null,
          status: 'Non débuté',
          assigned_to: currentName,
          created_by_email: currentEmail,
          created_by_name: currentName,
          devis_transformation_id: transfo.id,
        })
        .select('id, description_action, status, due_date, assigned_to')
        .single()
      if (errTache) throw errTache

      onCreated?.({
        id: String(tache.id),
        libelle: String(tache.description_action || ''),
        status: String(tache.status || ''),
        due_date: tache.due_date || null,
        assigned_to: tache.assigned_to || null,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la génération de la demande.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(6,10,18,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !saving && onClose()}>
      <div style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Modifier la commande {numeroPiece}</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: -6 }}>{nomClient || numeroTiers}</div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Nouvelle date de livraison souhaitée</div>
          <input type="date" value={dateLivraison} onChange={(e) => setDateLivraison(e.target.value)} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Référence chantier</div>
          <input value={referenceChantier} onChange={(e) => setReferenceChantier(e.target.value)} placeholder="Référence chantier…" style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>Actuelle : {referenceActuelle || '—'}</div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Motif / précisions (facultatif)</div>
          <textarea
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            rows={2}
            placeholder="Ex. : Client demande un report de livraison de 2 semaines…"
            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 14, resize: 'vertical' }}
          />
        </div>

        {error && <div style={{ fontSize: 13, color: '#e0a685' }}>{error}</div>}

        <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4, margin: 0 }}>
          Génère une demande (consultable dans « Documents à traiter ») et une tâche pour reporter ce changement dans Sage — la modification n'est pas appliquée automatiquement dans l'ERP.
        </p>

        <button
          type="button"
          onClick={() => void valider()}
          disabled={saving}
          style={{ padding: '13px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14.5, fontWeight: 700 }}
        >
          {saving ? 'Génération…' : 'Générer la demande + tâche'}
        </button>
        <button
          type="button"
          onClick={() => !saving && onClose()}
          style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

function DocumentSection({
  title, loading, docs, transformationsParPiece, onOpen,
}: { title: string; loading: boolean; docs: DocAgrege[] | undefined; transformationsParPiece?: Record<string, DevisTransformation>; onOpen: (d: DocAgrege) => void }) {
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
            reference={d.reference}
            subtitle={formatDateFr(d.date)}
            trailing={formatMoney(d.montantHt)}
            badge={transformationsParPiece?.[d.numeroPiece] ? <PastilleTraitement /> : undefined}
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
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>
        {value}
      </div>
      {children && <div style={{ marginTop: 5, fontSize: 11.5 }}>{children}</div>}
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
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14.5, color: '#fff', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', padding: '0 2px' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

/** Couleur de pastille selon l'urgence de l'échéance -- même logique à 3
 * états que MobileTaskListSheet (rouge en retard / orange ≤ 4 j / vert
 * au-delà ou sans échéance), pour rester cohérent entre les deux écrans
 * où une tâche peut apparaître (liste "À faire" et fiche client). */
function pastilleCouleurAction(dueDateIso: string): string {
  if (!dueDateIso) return '#3F9142'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const echeance = new Date(`${dueDateIso}T00:00:00`)
  if (Number.isNaN(echeance.getTime())) return '#3F9142'
  const diffJours = Math.round((echeance.getTime() - today.getTime()) / 86400000)
  if (diffJours < 0) return '#C1683C'
  if (diffJours <= 4) return '#D69A4A'
  return '#3F9142'
}

/** Ligne de tâche dédiée à la section "Actions" de la fiche client --
 * ÉVOLUTION : le titre retourne désormais à la ligne au lieu d'être coupé
 * hors de la carte ; le statut ("Non débuté"...) n'a plus d'intérêt pour
 * des tâches par définition toutes non terminées ici (la liste exclut déjà
 * Terminé/Annulé), remplacé par l'échéance dans la même police ; une
 * pastille de couleur reflète l'urgence de cette échéance, comme sur la
 * liste "À faire". */
function TacheRowItem({ action, onClick }: { action: ActionRow; onClick: () => void }) {
  const dueIso = normalizeDateIso(action.due_date || '')
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
        padding: '9px 12px', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: pastilleCouleurAction(dueIso), flexShrink: 0 }} />
        <span style={{ fontSize: 14.5, color: '#fff', flex: 1, minWidth: 0, wordBreak: 'break-word', lineHeight: 1.4 }}>
          {action.libelle || '(sans libellé)'}
        </span>
        {dueIso && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {formatDateFr(dueIso)}
          </span>
        )}
      </div>
      {action.assigned_to && (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginLeft: 16 }}>
          Assigné : {action.assigned_to}
        </div>
      )}
    </div>
  )
}

/** ÉVOLUTION : nouvelle prop `reference`, affichée juste à côté du titre
 * (même taille/police que lui, couleur légèrement atténuée pour rester
 * lisiblement secondaire) au lieu d'être reléguée dans le sous-titre --
 * demande explicite : la référence chantier doit être visible d'un coup
 * d'œil à côté du numéro de pièce dans la liste, pas seulement une fois
 * la fiche ouverte. Utilisée par DocumentSection (BL/CDC/PL/BR/Devis) ;
 * les autres appelants (Actions) n'en ont simplement pas besoin. */
function RowItem({
  title, reference, subtitle, trailing, badge, onClick,
}: { title: string; reference?: string; subtitle?: string; trailing?: string; badge?: React.ReactNode; onClick?: () => void }) {
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          {badge}
          <span style={{ fontSize: 14.5, color: '#fff', flexShrink: 0, whiteSpace: 'nowrap' }}>{title}</span>
          {reference && (
            <span
              style={{
                fontSize: 14.5, color: 'rgba(255,255,255,0.55)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              }}
            >
              {reference}
            </span>
          )}
        </div>
        {subtitle && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {trailing && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', marginLeft: 10 }}>
          {trailing}
        </div>
      )}
    </div>
  )
}

/** Pastille "traitement en cours" affichée devant le titre d'un devis ou
 * d'une commande qui a un document devis_transformations non transformé
 * (statut 'a_traiter') -- disparaît automatiquement une fois la tâche
 * liée clôturée (le trigger DB repasse le statut à 'transforme', et le
 * document sort de transformationsEnCours au prochain chargement de la
 * fiche). */
function PastilleTraitement() {
  return (
    <span
      title="Traitement en cours"
      aria-hidden="true"
      style={{ fontSize: 13, flexShrink: 0, color: '#E8A96A' }}
    >
      ⭐
    </span>
  )
}

/** Champ "libellé + saisie numérique" pour un seuil d'alerte de suivi.
 * Vide = null = règle désactivée (pas de valeur par défaut imposée). */
function AlerteSeuilField({
  label, value, onChange,
}: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', flex: 1 }}>{label}</span>
      <input
        type="number"
        min={1}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? null : Math.max(1, Number(raw)))
        }}
        placeholder="—"
        style={{
          width: 64, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.06)', color: '#fff', padding: '6px 8px', fontSize: 13, textAlign: 'right',
        }}
      />
    </label>
  )
}

function Loading() {
  return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '4px 2px' }}>Chargement…</div>
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '4px 2px' }}>{text}</div>
}
