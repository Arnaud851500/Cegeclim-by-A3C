/**
 * lib/inventaire.ts — Inventaire de fin d'année par dépôt (01/11/2026)
 * ---------------------------------------------------------------------------
 * Types, libellés, mise en forme et éditions partagés par :
 *   - app/stock/inventaire/page.tsx         (pilotage achats)
 *   - app/stock/inventaire/saisie/page.tsx  (saisie en agence)
 *
 * Éditions :
 *   - pdfListeComptage : liste à compter d'un dépôt (1er, 2e ou 3e comptage) —
 *     réf. CEGECLIM, réf. fournisseur, désignation, qté en stock, case de saisie,
 *     PUMP, case commentaire ; cadre « équipe (initiales) / date / feuille x/y » en tête
 *     de CHAQUE page (feuilles réparties entre plusieurs équipes), pagination en pied ;
 *     23/11/2026 : code de liste « INV-xxxxxxxx-Cn » en tête de page et colonne « Éq. »
 *     (une feuille peut servir à 2 équipes) pour l'intégration des feuilles scannées ;
 *     colonne « N° » = identifiant stable de la ligne, clé de rapprochement des scans ;
 *   - pdfEcarts : écarts d'un ou plusieurs dépôts avec les comptages, la valeur
 *     au PUMP et la décision des achats ;
 *   - excelEcarts : écarts validés prêts à saisir dans SAGE (+ détail + synthèse).
 *
 * Sources : RPC inv_* (supabase/migrations/20261101_inventaire_annuel.sql).
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

export type StatutDepot = 'preparation' | 'comptage' | 'analyse' | 'valide'
export type Decision = 'valide' | 'refuse' | null

export type Comptage = {
  numero: number
  initiales: string | null
  statut: 'en_cours' | 'termine'
  lance_le: string
  lance_par: string | null
  termine_le: string | null
  termine_par: string | null
}

export type Campagne = {
  id: string
  libelle: string
  date_inventaire: string
  statut: 'ouverte' | 'cloturee'
  commentaire?: string | null
  nb_depots?: number
}

export type InvDepot = {
  id: string
  campagne_id: string
  depot_num: string
  depot_libelle: string
  familles_macro: string[]
  familles: string[]
  fournisseurs: string[]
  inclure_stock_nul: boolean
  inclure_transit?: boolean
  depot_transit_num?: string | null
  statut: StatutDepot
  comptage_courant: number
  stock_sage_le: string | null
  stock_charge_le: string | null
  active_le: string | null
  active_par: string | null
  valide_le: string | null
  valide_par: string | null
  campagne: { id: string; libelle: string; date_inventaire: string; statut: string } | null
  comptages: Comptage[]
}

export type SuiviDepot = InvDepot & {
  nb_lignes: number
  nb_hors_liste: number
  nb_transit?: number
  valeur_transit?: number
  nb_a_compter: number
  nb_saisies: number
  valeur_theorique: number
  /** Unités à compter (somme du stock théorique SAGE des lignes, transit compris). */
  qte_theorique?: number
  qte_transit?: number
  /** Unités des lignes du comptage ouvert : théoriques / déjà saisies. */
  qte_a_compter?: number
  qte_saisie?: number
  nb_ecarts: number
  nb_ecarts_a_decider: number
  nb_valides: number
  nb_refuses: number
  valeur_ecart_plus: number
  valeur_ecart_moins: number
  valeur_ecart_net: number
  valeur_validee_net: number
}

export type LignePilotage = {
  id: number
  reference: string
  ref_fournisseur: string | null
  designation: string | null
  famille: string | null
  famille_macro: string | null
  fournisseur: string | null
  fournisseur_nom: string | null
  qte_theorique: number
  pump: number
  pump_source: string | null
  hors_liste: boolean
  /** Ligne du dépôt SAGE « TRANSIT » rattaché au dépôt inventorié. */
  transit?: boolean
  depot_stock?: string | null
  depot_stock_libelle?: string | null
  nb_comptages: number
  q1: number | null; q2: number | null; q3: number | null
  com1: string | null; com2: string | null; com3: string | null
  /** Équipe (initiales) ayant compté la ligne à chaque comptage (20/11/2026). */
  ini1?: string | null; ini2?: string | null; ini3?: string | null
  saisi1_par?: string | null; saisi1_le?: string | null
  saisi2_par?: string | null; saisi2_le?: string | null
  saisi3_par?: string | null; saisi3_le?: string | null
  qte_finale: number | null
  ecart: number | null
  valeur_ecart: number | null
  decision: Decision
  decision_commentaire: string | null
  decision_le: string | null
  decision_par: string | null
  // présents dans inv_campagne_ecarts
  inv_depot_id?: string
  depot_num?: string
  depot_libelle?: string
  depot_statut?: StatutDepot
}

export type LigneSaisie = {
  id: number
  reference: string
  ref_fournisseur: string | null
  designation: string | null
  famille: string | null
  famille_macro: string | null
  qte_theorique: number
  pump: number
  hors_liste: boolean
  transit?: boolean
  depot_stock?: string | null
  depot_stock_libelle?: string | null
  qte: number | null
  commentaire: string | null
  /** Équipe (initiales) ayant saisi la ligne au comptage en cours. */
  initiales?: string | null
  /** Équipes des comptages précédents (sans leurs quantités) : ne peuvent pas recompter la ligne. */
  equipes_prec?: string | null
  /** V2 (26/11/2026) : détail par équipe du comptage en cours ; qte = somme des équipes. */
  saisies?: SaisieEquipe[]
}

export type SaisieEquipe = { equipe: string; qte: number | null; commentaire: string | null; saisi_le?: string | null }

export type ListeSaisie = InvDepot & { numero: number; lignes: LigneSaisie[] }

// ─────────────────────────────────────────────────────────────────────────
// Libellés et formats
// ─────────────────────────────────────────────────────────────────────────

export const ORDINAL: Record<number, string> = { 1: '1er', 2: '2e', 3: '3e' }
export const ORDINAL_LONG: Record<number, string> = { 1: 'premier', 2: 'second', 3: 'troisième' }

export function libelleStatut(d: Pick<InvDepot, 'statut' | 'comptage_courant'>): string {
  switch (d.statut) {
    case 'preparation': return 'Liste préparée'
    case 'comptage': return `${ORDINAL[d.comptage_courant] || ''} comptage en cours`
    case 'analyse': return `${ORDINAL[d.comptage_courant] || ''} comptage terminé · analyse achats`
    case 'valide': return 'Inventaire validé'
  }
}

export function couleurStatut(s: StatutDepot): string {
  switch (s) {
    case 'preparation': return 'bg-[#F4F3F0] text-[#5E5A44] border-[#E5E1D8]'
    case 'comptage': return 'bg-[#E8F0FB] text-[#1D4F91] border-[#B9CFEE]'
    case 'analyse': return 'bg-[#FDF3E3] text-[#96600F] border-[#F0D4A6]'
    case 'valide': return 'bg-[#E9F5EA] text-[#2F6F33] border-[#BFE0C1]'
  }
}

export function n0(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/** Quantité : entiers sans décimale, sinon jusqu'à 3 décimales. */
export function fmtQte(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 })
}

export function fmtEuro(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec, maximumFractionDigits: dec })
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR')
}

export function fmtDateHeure(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Équipe de comptage : membres séparés par « / » (ex. « pjc + av » → « PJC/AV »), même règle que inv_normaliser_initiales. */
export function normaliserEquipe(v: string): string {
  return v.toUpperCase().split(/[^A-ZÀ-Ÿ]+/).filter(Boolean).join('/')
}

export function membresEquipe(v: string | null | undefined): string[] {
  return v ? normaliserEquipe(v).split('/').filter(Boolean) : []
}

/** Inventoristes communs à deux équipes (règle : une ligne ne se recompte pas par les mêmes personnes). */
export function membresCommuns(a: string | null | undefined, b: string | null | undefined): string[] {
  const mb = new Set(membresEquipe(b))
  return membresEquipe(a).filter((m) => mb.has(m))
}

/** Lit une saisie « 12 », « 12,5 », « 1 200 ». Vide = null ; invalide = NaN. */
export function lireQuantite(v: string): number | null {
  const t = v.replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

export function messageErreur(e: unknown): string {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export function slug(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Quantité du comptage n d'une ligne de pilotage. */
export function qteComptage(l: LignePilotage, n: number): number | null {
  return n === 1 ? l.q1 : n === 2 ? l.q2 : l.q3
}

export function comComptage(l: LignePilotage, n: number): string | null {
  return n === 1 ? l.com1 : n === 2 ? l.com2 : l.com3
}

/**
 * Code de la liste imprimé en tête de chaque feuille (« INV-1A2B3C4D-C1 ») : début de l'identifiant
 * de l'inventaire du dépôt + n° de comptage. Sert à l'intégration des feuilles scannées (PDF) pour
 * retrouver la liste et le comptage sans ambiguïté.
 */
export function codeListe(invDepotId: string, numero: number): string {
  return `INV-${invDepotId.replace(/-/g, '').slice(0, 8).toUpperCase()}-C${numero}`
}

/** Lit un code de liste (tolère espaces, O/0) : { prefixe, numero } ou null. */
export function lireCodeListe(v: string | null | undefined): { prefixe: string; numero: number } | null {
  const t = String(v || '').toUpperCase().replace(/\s+/g, '')
  const m = t.match(/INV-?([0-9A-FO]{8})-?C([123])/)
  if (!m) return null
  return { prefixe: m[1].replace(/O/g, '0'), numero: Number(m[2]) }
}

export function iniComptage(l: LignePilotage, n: number): string | null {
  return (n === 1 ? l.ini1 : n === 2 ? l.ini2 : l.ini3) ?? null
}

export function commentairesLigne(l: LignePilotage): string {
  return [1, 2, 3]
    .map((n) => (comComptage(l, n) ? `C${n} : ${comComptage(l, n)}` : ''))
    .concat(l.decision_commentaire ? [`Achats : ${l.decision_commentaire}`] : [])
    .filter(Boolean)
    .join(' · ')
}

/**
 * Section d'affichage d'une ligne : « En transit » en tête, puis le stock du dépôt.
 * 23/11/2026 (Arnaud) : plus de regroupement par famille, les listes sont triées sur la seule
 * référence CEGECLIM ; l'intertitre « Stock du dépôt » n'apparaît qu'après une section transit.
 */
export function sectionLigne(l: { transit?: boolean; famille_macro?: string | null; depot_stock?: string | null; depot_stock_libelle?: string | null }): string {
  if (l.transit) return `En transit — ${l.depot_stock_libelle || 'dépôt transit'} (dépôt SAGE n° ${l.depot_stock || '?'})`
  return 'Stock du dépôt'
}

export const AIDE_TRANSIT = 'Expédié par FMS, pas encore réceptionné dans SAGE : compter ce qui est physiquement arrivé à l’agence (0 si rien).'

export function libelleDecision(d: Decision): string {
  return d === 'valide' ? 'Écart validé' : d === 'refuse' ? 'Écart refusé' : '—'
}

// ─────────────────────────────────────────────────────────────────────────
// PDF — utilitaires (polices standard jsPDF : pas d'espace fine ni de tiret long)
// ─────────────────────────────────────────────────────────────────────────

function p(v: string): string {
  return v.replace(/[\u202f\u00a0]/g, ' ').replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/[\u2019]/g, "'").replace(/ \u00b7 /g, ' / ')
}

const pQte = (v: number | null | undefined) => p(fmtQte(v))
const pEuro = (v: number | null | undefined, dec = 2) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? '-' : `${p(fmtNum(v, dec))} EUR`

function piedDePage(doc: jsPDF, gauche: string) {
  const total = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(120)
    doc.text(p(gauche), 8, h - 5)
    doc.text(`Page ${i} / ${total}`, w - 8, h - 5, { align: 'right' })
  }
  doc.setTextColor(0)
}

/** Bandeau commun : « CEGECLIM » au-dessus du titre, puis une ligne de contexte. */
function enteteCegeclim(doc: jsPDF, titre: string, sousTitre: string) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(180, 118, 26)
  doc.text('CEGECLIM', 8, 8)
  doc.setTextColor(0); doc.setFontSize(12.5)
  doc.text(p(titre), 8, 14)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90)
  doc.text(p(sousTitre), 8, 19.5)
  doc.setTextColor(0)
}

function telecharger(doc: jsPDF, nom: string) {
  doc.save(nom)
}

// ─────────────────────────────────────────────────────────────────────────
// PDF — liste de comptage
// ─────────────────────────────────────────────────────────────────────────

export function pdfListeComptage(
  liste: ListeSaisie,
  opts: { avecSaisies?: boolean; lignes?: LigneSaisie[]; selection?: string } = {},
) {
  const numero = liste.numero
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  const titre = `${liste.campagne?.libelle || 'Inventaire'} - ${liste.depot_libelle}`
  const code = codeListe(liste.id, numero)
  const sousTitre = `${ORDINAL[numero]} comptage - inventaire du ${fmtDate(liste.campagne?.date_inventaire)} - stock SAGE du ${fmtDateHeure(liste.stock_sage_le)}`
    + (opts.selection ? ` - sélection : ${opts.selection}` : '')
  const avec = !!opts.avecSaisies

  // Cadre équipe sur chaque page : chaque feuille peut être confiée à une équipe différente.
  const entete = () => {
    enteteCegeclim(doc, titre, sousTitre)
    // Code de liste lisible par l'intégration des feuilles scannées
    doc.setFont('courier', 'bold'); doc.setFontSize(13); doc.setTextColor(0)
    doc.text(`Liste ${code}`, w - 116, 9, { align: 'right' })
    doc.setDrawColor(60); doc.setLineWidth(0.3)
    doc.rect(w - 112, 4, 104, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(p('Équipe(s) (initiales, ex. PJC/AV) :'), w - 110, 9)
    doc.line(w - 60, 9.6, w - 34, 9.6)
    doc.text('Date / heure :', w - 110, 16)
    doc.line(w - 88, 16.6, w - 34, 16.6)
  }

  const lignes = opts.lignes ? [...opts.lignes] : [...liste.lignes]
  const nbCol = 9
  const body: Array<Array<string | { content: string; colSpan?: number; styles?: Record<string, unknown> }>> = []
  let macro = ''
  for (const l of lignes) {
    const m = sectionLigne(l)
    if (m !== macro && (l.transit || macro !== '')) {
      macro = m
      body.push([{ content: p(l.transit ? `${m} : ${AIDE_TRANSIT}` : m), colSpan: nbCol,
        styles: { font: 'helvetica', fontSize: 8, halign: 'left', ...(l.transit ? { fillColor: [232, 240, 251], fontStyle: 'bold', textColor: [29, 79, 145] } : { fillColor: [238, 235, 226], fontStyle: 'bold', textColor: [60, 56, 46] }) } }])
    }
    const row = [
      String(l.id),
      p(l.reference) + (l.hors_liste ? ' (hors liste)' : '') + (l.transit ? ' (transit)' : ''),
      p(l.ref_fournisseur || ''),
      p(l.designation || ''),
      pQte(l.qte_theorique),
      avec && l.qte !== null ? pQte(l.qte) : '',
      pEuro(l.pump),
      avec ? p(l.commentaire || '') : '',
    ]
    row.splice(6, 0, avec && l.qte !== null ? p(l.initiales || '') : '')
    body.push(row)
  }

  // Colonne « N° » : identifiant stable de la ligne (inventaire_lignes.id), clé de lecture des feuilles scannées.
  // Colonne « Éq. » : une feuille peut servir à deux équipes, chacune note ses initiales sur ses lignes.
  const head = [['N°', 'Réf. CEGECLIM', 'Réf. fournisseur', 'Désignation', 'Qté stock', 'Qté comptée', 'Éq.', 'PUMP', 'Commentaire']]
  const columnStyles: Record<number, Record<string, unknown>> = {
    0: { cellWidth: 16, font: 'courier', fontStyle: 'bold', fontSize: 10, halign: 'center' },
    1: { cellWidth: 34, fontStyle: 'bold' }, 2: { cellWidth: 30 }, 3: { cellWidth: 'auto' },
    4: { cellWidth: 16, halign: 'right' }, 5: { cellWidth: 24, halign: 'center', minCellHeight: 7.5 },
    6: { cellWidth: 16, halign: 'center' }, 7: { cellWidth: 21, halign: 'right' }, 8: { cellWidth: 46 },
  }

  autoTable(doc, {
    startY: 25,
    head,
    body,
    theme: 'grid',
    margin: { top: 25, right: 8, bottom: 12, left: 8 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, valign: 'middle', lineColor: [170, 170, 170], lineWidth: 0.15 },
    headStyles: { fillColor: [17, 24, 32], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    columnStyles,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    willDrawPage: () => entete(),
  })

  // Récapitulatif et signature
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30
  let y = finalY + 8
  if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); entete(); y = 30 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const nbArt = lignes.length
  doc.text(p(`${nbArt} ligne(s) à compter${opts.selection ? ' (sélection)' : ''}. Toutes les lignes doivent être comptées, y compris à 0.`), 8, y)
  doc.text(p('Articles trouvés hors liste : les noter ci-dessous (réf., quantité). Feuille partagée par 2 équipes : initiales dans la colonne Éq.'), 8, y + 5)
  doc.setDrawColor(120)
  doc.rect(8, y + 8, 160, 16)
  doc.text(p('Signature de l\'équipe :'), 180, y + 12)
  doc.rect(180, y + 14, 70, 12)

  // Feuille x / y dans le cadre équipe de chaque page (+ pied de page).
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text(`Feuille ${i} / ${total}`, w - 10, 9, { align: 'right' })
  }
  doc.setFont('helvetica', 'normal')
  piedDePage(doc, `${titre} - ${ORDINAL[numero]} comptage - édité le ${fmtDateHeure(new Date().toISOString())}`)
  telecharger(doc, `inventaire_${slug(liste.depot_libelle)}_comptage${numero}${opts.selection ? '_selection' : ''}.pdf`)
}

// ─────────────────────────────────────────────────────────────────────────
// PDF — écarts (un ou plusieurs dépôts)
// ─────────────────────────────────────────────────────────────────────────

export function pdfEcarts(lignes: LignePilotage[], opts: { campagne: string; dateInventaire?: string | null; titre?: string }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const parDepot = new Map<string, LignePilotage[]>()
  for (const l of lignes) {
    const k = l.depot_libelle || 'Dépôt'
    if (!parDepot.has(k)) parDepot.set(k, [])
    parDepot.get(k)!.push(l)
  }
  const titre = opts.titre || `Écarts d'inventaire - ${opts.campagne}`
  let premiere = true
  let depotCourant = ''

  const entete = () => enteteCegeclim(doc, `${titre} - ${depotCourant}`,
    `${opts.dateInventaire ? `Inventaire du ${fmtDate(opts.dateInventaire)} - ` : ''}écart = dernier comptage - stock théorique, valorisé au PUMP du dépôt - sous chaque comptage : équipe`)

  for (const [depot, ls] of parDepot) {
    if (!premiere) doc.addPage()
    premiere = false
    depotCourant = depot
    const plus = ls.reduce((s, l) => s + (n0(l.valeur_ecart) > 0 ? n0(l.valeur_ecart) : 0), 0)
    const moins = ls.reduce((s, l) => s + (n0(l.valeur_ecart) < 0 ? n0(l.valeur_ecart) : 0), 0)
    const valide = ls.reduce((s, l) => s + (l.decision === 'valide' ? n0(l.valeur_ecart) : 0), 0)

    autoTable(doc, {
      startY: 25,
      head: [['Réf. CEGECLIM', 'Réf. fourn.', 'Désignation', 'Théo.', 'C1', 'C2', 'C3', 'Retenu', 'Écart', 'PUMP', 'Valeur écart', 'Décision', 'Commentaires']],
      body: ls.map((l) => [
        p(l.reference) + (l.hors_liste ? ' *' : '') + (l.transit ? ' (transit)' : ''),
        p(l.ref_fournisseur || ''),
        p(l.designation || ''),
        pQte(l.qte_theorique),
        l.q1 === null ? '' : pQte(l.q1) + (l.ini1 ? `\n${p(l.ini1)}` : ''),
        l.nb_comptages >= 2 ? pQte(l.q2) + (l.ini2 ? `\n${p(l.ini2)}` : '') : '',
        l.nb_comptages >= 3 ? pQte(l.q3) + (l.ini3 ? `\n${p(l.ini3)}` : '') : '',
        pQte(l.qte_finale),
        (n0(l.ecart) > 0 ? '+' : '') + pQte(l.ecart),
        pEuro(l.pump),
        (n0(l.valeur_ecart) > 0 ? '+' : '') + pEuro(l.valeur_ecart),
        p(libelleDecision(l.decision)),
        p(commentairesLigne(l)),
      ]),
      foot: [[
        { content: p(`${ls.length} écart(s) - positifs ${pEuro(plus)} - négatifs ${pEuro(moins)} - net ${pEuro(plus + moins)} - validés ${pEuro(valide)}`), colSpan: 13, styles: { halign: 'left' } },
      ]],
      theme: 'grid',
      margin: { top: 25, right: 8, bottom: 12, left: 8 },
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.3, valign: 'middle', lineColor: [170, 170, 170], lineWidth: 0.15 },
      headStyles: { fillColor: [17, 24, 32], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [238, 235, 226], textColor: [30, 30, 30], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 30, fontStyle: 'bold' }, 1: { cellWidth: 24 }, 2: { cellWidth: 'auto' },
        3: { cellWidth: 12, halign: 'right' }, 4: { cellWidth: 14, halign: 'right' }, 5: { cellWidth: 14, halign: 'right' },
        6: { cellWidth: 14, halign: 'right' }, 7: { cellWidth: 13, halign: 'right', fontStyle: 'bold' },
        8: { cellWidth: 13, halign: 'right', fontStyle: 'bold' }, 9: { cellWidth: 20, halign: 'right' },
        10: { cellWidth: 23, halign: 'right', fontStyle: 'bold' }, 11: { cellWidth: 20 }, 12: { cellWidth: 46 },
      },
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const l = ls[data.row.index]
        if (!l) return
        if (data.column.index === 8 || data.column.index === 10) {
          data.cell.styles.textColor = n0(l.ecart) < 0 ? [180, 35, 24] : [47, 111, 51]
        }
      },
      rowPageBreak: 'avoid',
      willDrawPage: () => entete(),
    })

    const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30) + 8
    if (y < doc.internal.pageSize.getHeight() - 26) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text('Visa responsable dépôt :', 8, y)
      doc.rect(8, y + 2, 80, 14)
      doc.text('Visa achats :', 100, y)
      doc.rect(100, y + 2, 80, 14)
      doc.setFontSize(7.5); doc.setTextColor(110)
      doc.text('* article ajouté hors liste pendant le 1er comptage', 190, y + 4)
      doc.setTextColor(0)
    }
  }

  if (parDepot.size === 0) {
    entete()
    doc.setFontSize(11); doc.text('Aucun écart.', 8, 30)
  }

  piedDePage(doc, `${titre} - édité le ${fmtDateHeure(new Date().toISOString())}`)
  telecharger(doc, `ecarts_inventaire_${slug(opts.campagne)}${parDepot.size === 1 ? '_' + slug([...parDepot.keys()][0]) : ''}.pdf`)
}

// ─────────────────────────────────────────────────────────────────────────
// Excel — écarts à passer dans SAGE
// ─────────────────────────────────────────────────────────────────────────

export async function excelEcarts(lignes: LignePilotage[], suivi: SuiviDepot[], opts: { campagne: string; dateInventaire?: string | null }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  const entete = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1)
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } }
    r.alignment = { vertical: 'middle', wrapText: true }
    r.height = 30
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  }
  const euro = '#,##0.00 "€";[Red]-#,##0.00 "€"'
  const qte = '#,##0.###;[Red]-#,##0.###'

  // 1. Écarts validés : une ligne par article et dépôt, quantité signée
  const valides = lignes.filter((l) => l.decision === 'valide' && n0(l.ecart) !== 0)
  const ws1 = wb.addWorksheet('Écarts à passer SAGE')
  ws1.columns = [
    { header: 'N° dépôt', key: 'depot_num', width: 9 },
    { header: 'Dépôt', key: 'depot', width: 24 },
    { header: 'Référence', key: 'reference', width: 22 },
    { header: 'Désignation', key: 'designation', width: 46 },
    { header: 'Sens', key: 'sens', width: 9 },
    { header: 'Quantité (écart)', key: 'qte', width: 13, style: { numFmt: qte } },
    { header: 'Quantité (valeur absolue)', key: 'qte_abs', width: 13, style: { numFmt: qte } },
    { header: 'PU (PUMP)', key: 'pump', width: 13, style: { numFmt: euro } },
    { header: 'Montant', key: 'montant', width: 14, style: { numFmt: euro } },
    { header: 'Stock théorique', key: 'theo', width: 12, style: { numFmt: qte } },
    { header: 'Stock compté', key: 'compte', width: 12, style: { numFmt: qte } },
  ]
  for (const l of valides) {
    ws1.addRow({
      depot_num: l.depot_stock || l.depot_num, depot: l.depot_stock_libelle || l.depot_libelle, reference: l.reference, designation: l.designation,
      sens: n0(l.ecart) > 0 ? 'Entrée' : 'Sortie', qte: n0(l.ecart), qte_abs: Math.abs(n0(l.ecart)),
      pump: n0(l.pump), montant: Math.round(n0(l.ecart) * n0(l.pump) * 100) / 100,
      theo: n0(l.qte_theorique), compte: n0(l.qte_finale),
    })
  }
  entete(ws1)
  const tot1 = ws1.addRow({ designation: `Total (${valides.length} lignes)`, montant: valides.reduce((s, l) => s + Math.round(n0(l.ecart) * n0(l.pump) * 100) / 100, 0) })
  tot1.font = { bold: true }

  // 2. Détail de tous les écarts avec comptages et décisions
  const ws2 = wb.addWorksheet('Détail des écarts')
  ws2.columns = [
    { header: 'N° dépôt', key: 'depot_num', width: 9 }, { header: 'Dépôt', key: 'depot', width: 24 },
    { header: 'Référence', key: 'reference', width: 22 }, { header: 'Réf. fournisseur', key: 'ref_f', width: 20 },
    { header: 'Désignation', key: 'designation', width: 42 }, { header: 'Famille macro', key: 'macro', width: 12 },
    { header: 'Famille', key: 'famille', width: 13 }, { header: 'Fournisseur', key: 'fourn', width: 22 },
    { header: 'Hors liste', key: 'hl', width: 9 },
    { header: 'Transit', key: 'tr', width: 8 },
    { header: 'Inventaire du dépôt', key: 'inv', width: 22 },
    { header: 'Stock théorique', key: 'theo', width: 11, style: { numFmt: qte } },
    { header: 'Comptage 1', key: 'q1', width: 11, style: { numFmt: qte } },
    { header: 'Comptage 2', key: 'q2', width: 11, style: { numFmt: qte } },
    { header: 'Comptage 3', key: 'q3', width: 11, style: { numFmt: qte } },
    { header: 'Équipe C1', key: 'i1', width: 10 },
    { header: 'Équipe C2', key: 'i2', width: 10 },
    { header: 'Équipe C3', key: 'i3', width: 10 },
    { header: 'Qté retenue', key: 'fin', width: 11, style: { numFmt: qte } },
    { header: 'Écart', key: 'ecart', width: 10, style: { numFmt: qte } },
    { header: 'PUMP', key: 'pump', width: 12, style: { numFmt: euro } },
    { header: 'Valeur écart', key: 'val', width: 13, style: { numFmt: euro } },
    { header: 'Décision', key: 'decision', width: 14 },
    { header: 'Commentaires', key: 'com', width: 60 },
  ]
  for (const l of lignes) {
    ws2.addRow({
      depot_num: l.depot_stock || l.depot_num, depot: l.depot_stock_libelle || l.depot_libelle, inv: l.depot_libelle,
      reference: l.reference, ref_f: l.ref_fournisseur, designation: l.designation,
      macro: l.famille_macro, famille: l.famille, fourn: l.fournisseur_nom || l.fournisseur, hl: l.hors_liste ? 'Oui' : '', tr: l.transit ? 'Oui' : '',
      theo: n0(l.qte_theorique), q1: l.q1, q2: l.nb_comptages >= 2 ? l.q2 : null, q3: l.nb_comptages >= 3 ? l.q3 : null,
      i1: l.ini1 || '', i2: l.nb_comptages >= 2 ? l.ini2 || '' : '', i3: l.nb_comptages >= 3 ? l.ini3 || '' : '',
      fin: l.qte_finale, ecart: l.ecart, pump: n0(l.pump), val: l.valeur_ecart,
      decision: l.decision ? libelleDecision(l.decision) : 'À décider', com: commentairesLigne(l),
    })
  }
  entete(ws2)

  // 3. Synthèse par dépôt
  const ws3 = wb.addWorksheet('Synthèse par dépôt')
  ws3.columns = [
    { header: 'N° dépôt', key: 'num', width: 9 }, { header: 'Dépôt', key: 'dep', width: 26 },
    { header: 'Statut', key: 'statut', width: 30 }, { header: 'Lignes', key: 'lignes', width: 9 },
    { header: 'Valeur théorique', key: 'vt', width: 16, style: { numFmt: euro } },
    { header: 'Écarts', key: 'ne', width: 9 }, { header: 'À décider', key: 'nad', width: 10 },
    { header: 'Écarts +', key: 'vp', width: 14, style: { numFmt: euro } },
    { header: 'Écarts −', key: 'vm', width: 14, style: { numFmt: euro } },
    { header: 'Écart net', key: 'vn', width: 14, style: { numFmt: euro } },
    { header: 'Écart validé net', key: 'vv', width: 15, style: { numFmt: euro } },
  ]
  for (const d of suivi) {
    ws3.addRow({
      num: d.depot_num, dep: d.depot_libelle, statut: libelleStatut(d), lignes: d.nb_lignes, vt: n0(d.valeur_theorique),
      ne: d.nb_ecarts, nad: d.nb_ecarts_a_decider, vp: n0(d.valeur_ecart_plus), vm: n0(d.valeur_ecart_moins),
      vn: n0(d.valeur_ecart_net), vv: n0(d.valeur_validee_net),
    })
  }
  entete(ws3)

  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `ecarts_inventaire_${slug(opts.campagne)}_${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────────────────────
// V2 (26/11/2026, demandé par Arnaud) — tri alpha / famille, feuille portrait dense
// ─────────────────────────────────────────────────────────────────────────

export type TriListe = 'alpha' | 'famille'
export const LIB_TRI: Record<TriListe, string> = {
  alpha: 'Tri alphabétique (réf. CEGECLIM)',
  famille: 'Tri par famille puis réf. CEGECLIM',
}

type LigneTriable = { transit?: boolean; reference: string; famille: string | null; famille_macro: string | null }

export function libelleFamille(l: { famille: string | null; famille_macro: string | null }): string {
  return [l.famille_macro, l.famille].filter(Boolean).join(' > ') || 'Sans famille'
}

const cmpFr = (a: string | null | undefined, b: string | null | undefined) =>
  String(a || '').localeCompare(String(b || ''), 'fr', { numeric: true, sensitivity: 'base' })

/** Transit en tête, puis référence (alpha) ou famille macro > famille > référence (famille). */
export function trierLignes<T extends LigneTriable>(lignes: T[], tri: TriListe): T[] {
  return [...lignes].sort((a, b) => {
    if (!!a.transit !== !!b.transit) return a.transit ? -1 : 1
    if (tri === 'famille') {
      const f = cmpFr(a.famille_macro, b.famille_macro) || cmpFr(a.famille, b.famille)
      if (f) return f
    }
    return cmpFr(a.reference, b.reference)
  })
}

/** Rupture d'affichage : transit, puis famille (tri famille) ou « Stock du dépôt » (tri alpha). */
export function sectionLigneV2(l: LigneTriable & { depot_stock?: string | null; depot_stock_libelle?: string | null }, tri: TriListe): string {
  if (l.transit) return sectionLigne(l)
  return tri === 'famille' ? libelleFamille(l) : 'Stock du dépôt'
}

/** Détail « AV/LD 3 + PJ/YV 2 » des saisies par équipe. */
export function detailEquipes(saisies: SaisieEquipe[] | undefined): string {
  return (saisies || []).filter((s) => s.qte !== null).map((s) => `${s.equipe} ${fmtQte(s.qte)}`).join(' + ')
}

/**
 * Feuille de comptage V2 : A4 portrait, en-tête complet en page 1 puis réduit (densité),
 * désignation limitée à 40 caractères, sans colonne « Éq. » (l'équipe est celle du cadre de
 * la page), commentaire réduit, mode de tri rappelé en en-tête, ruptures par famille.
 * Conserve le code de liste et la colonne N° (clés de l'intégration des feuilles scannées).
 */
export function pdfListeComptageV2(
  liste: ListeSaisie,
  opts: { avecSaisies?: boolean; lignes?: LigneSaisie[]; selection?: string; tri?: TriListe } = {},
) {
  const numero = liste.numero
  const tri: TriListe = opts.tri || 'alpha'
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const titre = `${liste.campagne?.libelle || 'Inventaire'} - ${liste.depot_libelle}`
  const code = codeListe(liste.id, numero)
  const sousTitre = `${ORDINAL[numero]} comptage - inventaire du ${fmtDate(liste.campagne?.date_inventaire)} - stock SAGE du ${fmtDateHeure(liste.stock_sage_le)}`
  const avec = !!opts.avecSaisies

  // Page 1 : en-tête complet. Titre, contexte et tri restent à gauche de l'encart équipe
  // (largeur bornée, retour à la ligne si besoin) : jamais de superposition.
  const xEncart = w - 86
  const largeurTexte = xEncart - 8 - 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5)
  let tailleTitre = 12.5
  let lignesTitre: string[] = doc.splitTextToSize(p(titre), largeurTexte)
  if (lignesTitre.length > 2) { tailleTitre = 10.5; doc.setFontSize(tailleTitre); lignesTitre = doc.splitTextToSize(p(titre), largeurTexte) }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const lignesSous: string[] = doc.splitTextToSize(p(sousTitre), largeurTexte)
  doc.setFont('helvetica', 'bold')
  const lignesTri: string[] = doc.splitTextToSize(p(`${LIB_TRI[tri]}${opts.selection ? ` - sélection : ${opts.selection}` : ''}`), largeurTexte)
  const yTitre = 14
  const ySous = yTitre + (lignesTitre.length - 1) * (tailleTitre * 0.42) + 5.5
  const yTri = ySous + (lignesSous.length - 1) * 3.8 + 4.8
  const basEntete = Math.max(29, yTri + (lignesTri.length - 1) * 3.8 + 4.5)

  const enteteComplet = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(180, 118, 26)
    doc.text('CEGECLIM', 8, 8)
    doc.setTextColor(0); doc.setFontSize(tailleTitre)
    doc.text(lignesTitre, 8, yTitre)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90)
    doc.text(lignesSous, 8, ySous)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(29, 79, 145)
    doc.text(lignesTri, 8, yTri)
    doc.setTextColor(0)
    doc.setFont('courier', 'bold'); doc.setFontSize(11)
    doc.text(`Liste ${code}`, xEncart, 8)
    doc.setDrawColor(60); doc.setLineWidth(0.3)
    doc.rect(xEncart, 11, 78, 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(p('Équipe(s) (initiales, ex. PJC/AV) :'), xEncart + 2, 16)
    doc.line(w - 38, 16.6, w - 10, 16.6)
    doc.text('Date / heure :', xEncart + 2, 23)
    doc.line(w - 64, 23.6, w - 10, 23.6)
  }
  // Pages suivantes : en-tête réduit sur une ligne (code de liste et cadre équipe conservés).
  const enteteReduit = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(180, 118, 26)
    doc.text('CEGECLIM', 8, 7.5)
    doc.setTextColor(0)
    doc.text(p(`${liste.depot_libelle} - ${ORDINAL[numero]} comptage`), 26, 7.5)
    doc.setFont('courier', 'bold'); doc.setFontSize(11)
    doc.text(`Liste ${code}`, 8, 12.5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(29, 79, 145)
    doc.text(p(tri === 'famille' ? 'Tri famille puis réf.' : 'Tri alphabétique'), 66, 12.5)
    doc.setTextColor(0)
    doc.setDrawColor(60); doc.setLineWidth(0.3)
    doc.rect(w - 86, 3.5, 78, 10)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.text(p('Équipe(s) :'), w - 84, 9)
    doc.line(w - 69, 9.6, w - 34, 9.6)
  }

  const lignes = trierLignes(opts.lignes ? [...opts.lignes] : [...liste.lignes], tri)
  const nbCol = 8
  const body: Array<Array<string | { content: string; colSpan?: number; styles?: Record<string, unknown> }>> = []
  let section = ''
  for (const l of lignes) {
    const m = sectionLigneV2(l, tri)
    if (m !== section && (l.transit || tri === 'famille' || section !== '')) {
      section = m
      body.push([{ content: p(l.transit ? `${m} : ${AIDE_TRANSIT}` : m.toUpperCase()), colSpan: nbCol,
        styles: { font: 'helvetica', fontSize: 7.5, halign: 'left', fontStyle: 'bold', cellPadding: 1, overflow: 'linebreak',
          ...(l.transit ? { fillColor: [232, 240, 251], textColor: [29, 79, 145] } : { fillColor: [238, 235, 226], textColor: [60, 56, 46] }) } }])
    } else if (!section) section = m
    const des = (l.designation || '').replace(/\s+/g, ' ').trim()
    const comAvec = avec ? [detailEquipes(l.saisies).includes('+') ? detailEquipes(l.saisies) : '', l.commentaire || ''].filter(Boolean).join(' - ') : ''
    body.push([
      String(l.id),
      p(l.reference) + (l.hors_liste ? ' (HL)' : ''),
      p(l.ref_fournisseur || ''),
      p(des.length > 40 ? des.slice(0, 40) : des),
      pQte(l.qte_theorique),
      avec && l.qte !== null ? pQte(l.qte) : '',
      pEuro(l.pump),
      p(comAvec),
    ])
  }

  // N° = identifiant stable de la ligne (clé de l'intégration des feuilles scannées).
  const head = [['N°', 'Réf. CEGECLIM', 'Réf. fourn.', 'Désignation', 'Stock', 'Qté comptée', 'PUMP', 'Commentaire']]
  const columnStyles: Record<number, Record<string, unknown>> = {
    0: { cellWidth: 13, font: 'courier', fontStyle: 'bold', fontSize: 8.5, halign: 'center' },
    1: { cellWidth: 29, fontStyle: 'bold' }, 2: { cellWidth: 23 }, 3: { cellWidth: 'auto' },
    4: { cellWidth: 12, halign: 'right' }, 5: { cellWidth: 21, halign: 'center', minCellHeight: 6.6 },
    6: { cellWidth: 17, halign: 'right' }, 7: { cellWidth: 27 },
  }

  autoTable(doc, {
    startY: basEntete,
    head,
    body,
    theme: 'grid',
    margin: { top: 15, right: 8, bottom: 10, left: 8 },
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.1, valign: 'middle', lineColor: [170, 170, 170], lineWidth: 0.15, overflow: 'ellipsize' },
    headStyles: { fillColor: [17, 24, 32], textColor: 255, fontStyle: 'bold', fontSize: 7.5, cellPadding: 1.2 },
    columnStyles,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    willDrawPage: (data: { pageNumber: number }) => { if (data.pageNumber === 1) enteteComplet(); else enteteReduit() },
  })

  // Récapitulatif, articles hors liste et signature.
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30
  let y = finalY + 6
  if (y > h - 34) { doc.addPage(); enteteReduit(); y = 18 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(p(`${lignes.length} ligne(s) à compter${opts.selection ? ' (sélection)' : ''}. Toutes les lignes doivent être comptées, y compris à 0.`), 8, y)
  doc.text(p('Articles trouvés hors liste : les noter ci-dessous (réf., quantité).'), 8, y + 4.5)
  doc.setDrawColor(120)
  doc.rect(8, y + 7, 120, 16)
  doc.text(p('Signature de l\'équipe :'), 134, y + 10.5)
  doc.rect(134, y + 12, w - 142, 11)

  // Feuille x / y : dans le cadre équipe (page 1) ou à droite de l'en-tête réduit.
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
    doc.text(`Feuille ${i} / ${total}`, w - 9, i === 1 ? 8 : 9, { align: 'right' })
  }
  doc.setFont('helvetica', 'normal')
  piedDePage(doc, `${titre} - ${ORDINAL[numero]} comptage - ${tri === 'famille' ? 'tri famille' : 'tri alpha'} - édité le ${fmtDateHeure(new Date().toISOString())}`)
  telecharger(doc, `inventaire_${slug(liste.depot_libelle)}_comptage${numero}_${tri}${opts.selection ? '_selection' : ''}.pdf`)
}
