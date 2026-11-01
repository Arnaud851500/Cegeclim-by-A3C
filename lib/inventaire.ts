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
 *     PUMP, case commentaire ; initiales de l'inventoriste et signature ;
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
  nb_a_compter: number
  nb_saisies: number
  valeur_theorique: number
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
  nb_comptages: number
  q1: number | null; q2: number | null; q3: number | null
  com1: string | null; com2: string | null; com3: string | null
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
  qte: number | null
  commentaire: string | null
}

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

export function commentairesLigne(l: LignePilotage): string {
  return [1, 2, 3]
    .map((n) => (comComptage(l, n) ? `C${n} : ${comComptage(l, n)}` : ''))
    .concat(l.decision_commentaire ? [`Achats : ${l.decision_commentaire}`] : [])
    .filter(Boolean)
    .join(' · ')
}

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

export function pdfListeComptage(liste: ListeSaisie, opts: { avecSaisies?: boolean } = {}) {
  const numero = liste.numero
  const comptage = liste.comptages.find((c) => c.numero === numero)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  const titre = `${liste.campagne?.libelle || 'Inventaire'} - ${liste.depot_libelle}`
  const sousTitre = `${ORDINAL[numero]} comptage - inventaire du ${fmtDate(liste.campagne?.date_inventaire)} - stock SAGE du ${fmtDateHeure(liste.stock_sage_le)}`

  const entete = () => {
    enteteCegeclim(doc, titre, sousTitre)
    // Cadre inventoriste
    doc.setDrawColor(60); doc.setLineWidth(0.3)
    doc.rect(w - 86, 5, 78, 13)
    doc.setFontSize(8)
    doc.text('Inventoriste (initiales) :', w - 84, 10)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.text(p(comptage?.initiales || ''), w - 48, 10.5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text('Date / heure :', w - 84, 16)
  }

  const lignes = [...liste.lignes]
  const body: Array<Array<string | { content: string; colSpan?: number; styles?: Record<string, unknown> }>> = []
  let macro = ''
  for (const l of lignes) {
    const m = l.famille_macro || 'Sans famille macro'
    if (m !== macro) {
      macro = m
      body.push([{ content: p(m), colSpan: 7, styles: { fillColor: [238, 235, 226], fontStyle: 'bold', textColor: [60, 56, 46] } }])
    }
    body.push([
      p(l.reference) + (l.hors_liste ? ' (hors liste)' : ''),
      p(l.ref_fournisseur || ''),
      p(l.designation || ''),
      pQte(l.qte_theorique),
      opts.avecSaisies && l.qte !== null ? pQte(l.qte) : '',
      pEuro(l.pump),
      opts.avecSaisies ? p(l.commentaire || '') : '',
    ])
  }

  autoTable(doc, {
    startY: 25,
    head: [['Réf. CEGECLIM', 'Réf. fournisseur', 'Désignation', 'Qté stock', 'Qté comptée', 'PUMP', 'Commentaire']],
    body,
    theme: 'grid',
    margin: { top: 25, right: 8, bottom: 12, left: 8 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, valign: 'middle', lineColor: [170, 170, 170], lineWidth: 0.15 },
    headStyles: { fillColor: [17, 24, 32], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 34 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 24, halign: 'center', minCellHeight: 7.5 },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 62 },
    },
    rowPageBreak: 'avoid',
    willDrawPage: () => entete(),
  })

  // Récapitulatif et signature
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30
  let y = finalY + 8
  if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); entete(); y = 30 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(`${lignes.length} ligne(s) à compter. Toutes les lignes doivent être comptées, y compris à 0.`, 8, y)
  doc.text('Articles trouvés hors liste : les noter ci-dessous puis les ajouter à l\'écran (1er comptage).', 8, y + 5)
  doc.setDrawColor(120)
  doc.rect(8, y + 8, 160, 16)
  doc.text('Signature de l\'inventoriste :', 180, y + 12)
  doc.rect(180, y + 14, 70, 12)

  piedDePage(doc, `${titre} - ${ORDINAL[numero]} comptage - édité le ${fmtDateHeure(new Date().toISOString())}`)
  telecharger(doc, `inventaire_${slug(liste.depot_libelle)}_comptage${numero}.pdf`)
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
    `${opts.dateInventaire ? `Inventaire du ${fmtDate(opts.dateInventaire)} - ` : ''}écart = dernier comptage - stock théorique, valorisé au PUMP du dépôt`)

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
        p(l.reference) + (l.hors_liste ? ' *' : ''),
        p(l.ref_fournisseur || ''),
        p(l.designation || ''),
        pQte(l.qte_theorique),
        l.q1 === null ? '' : pQte(l.q1),
        l.nb_comptages >= 2 ? pQte(l.q2) : '',
        l.nb_comptages >= 3 ? pQte(l.q3) : '',
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
        3: { cellWidth: 12, halign: 'right' }, 4: { cellWidth: 11, halign: 'right' }, 5: { cellWidth: 11, halign: 'right' },
        6: { cellWidth: 11, halign: 'right' }, 7: { cellWidth: 13, halign: 'right', fontStyle: 'bold' },
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
      depot_num: l.depot_num, depot: l.depot_libelle, reference: l.reference, designation: l.designation,
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
    { header: 'Stock théorique', key: 'theo', width: 11, style: { numFmt: qte } },
    { header: 'Comptage 1', key: 'q1', width: 11, style: { numFmt: qte } },
    { header: 'Comptage 2', key: 'q2', width: 11, style: { numFmt: qte } },
    { header: 'Comptage 3', key: 'q3', width: 11, style: { numFmt: qte } },
    { header: 'Qté retenue', key: 'fin', width: 11, style: { numFmt: qte } },
    { header: 'Écart', key: 'ecart', width: 10, style: { numFmt: qte } },
    { header: 'PUMP', key: 'pump', width: 12, style: { numFmt: euro } },
    { header: 'Valeur écart', key: 'val', width: 13, style: { numFmt: euro } },
    { header: 'Décision', key: 'decision', width: 14 },
    { header: 'Commentaires', key: 'com', width: 60 },
  ]
  for (const l of lignes) {
    ws2.addRow({
      depot_num: l.depot_num, depot: l.depot_libelle, reference: l.reference, ref_f: l.ref_fournisseur, designation: l.designation,
      macro: l.famille_macro, famille: l.famille, fourn: l.fournisseur_nom || l.fournisseur, hl: l.hors_liste ? 'Oui' : '',
      theo: n0(l.qte_theorique), q1: l.q1, q2: l.nb_comptages >= 2 ? l.q2 : null, q3: l.nb_comptages >= 3 ? l.q3 : null,
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
