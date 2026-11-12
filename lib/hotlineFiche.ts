// ============================================================================
// lib/hotlineFiche.ts — Fiche ticket PDF (12/11/2026)
// ----------------------------------------------------------------------------
// Fiche d'un ticket hotline téléchargée en PDF depuis la console (/hotline) ou
// la fiche du ticket (/hotline/tickets) : identification, matériel,
// classification, note rapide (motif de l'appel), préconisation, puis TOUT
// l'historique du ticket… sauf les commentaires internes (étape
// COMMENTAIRE_INTERNE), qui ne sortent jamais de l'outil.
// ============================================================================

import { supabase } from '@/lib/supabaseClient'
import {
  AXES_CLASSIF,
  ETAPE_LIBELLES,
  chargerClassification,
  chargerEtapes,
  chargerPieces,
  estInterne,
  fmtDate,
  fmtDateHeure,
  fmtTel,
  libelleClassif,
  libelleFiliere,
  libelleGamme,
  libelleMotif,
  libelleNature,
  styleStatut,
  type Ticket,
} from '@/lib/hotline'

/** Polices standard jsPDF : pas d'espace fine, de tiret long ni de points de suspension. */
function p(v: string | null | undefined): string {
  return String(v ?? '')
    .replace(/[  ]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/ · /g, ' / ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, '')
}

const auteur = (email: string | null | undefined) => String(email || '').split('@')[0]

export async function telechargerFicheTicket(ticketId: string) {
  const [{ data, error }, etapes, pieces, classif, { default: jsPDF }, { default: autoTable }] = await Promise.all([
    supabase.from('hotline_tickets').select('*').eq('id', ticketId).maybeSingle(),
    chargerEtapes(ticketId),
    chargerPieces(ticketId).catch(() => []),
    chargerClassification().catch(() => null),
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  if (error) throw error
  if (!data) throw new Error('Ticket introuvable.')
  const t = data as Ticket

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const w = doc.internal.pageSize.getWidth()
  const finY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30

  // En-tête
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(180, 118, 26)
  doc.text('CEGECLIM - HOTLINE TECHNIQUE / SAV', 12, 12)
  doc.setTextColor(0)
  doc.setFontSize(15)
  doc.text(p(`Fiche ticket ${t.numero}`), 12, 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(
    p(`${libelleFiliere(t.filiere)}${t.gamme ? ` ${libelleGamme(t.gamme)}` : ''} / ${libelleMotif(t.motif)} / niveau ${t.niveau} / ${styleStatut(t.statut).label}`),
    12,
    26,
  )
  doc.text(p(`Ouvert le ${fmtDateHeure(t.opened_at)} par ${auteur(t.ouvert_par)}${t.resolved_at ? ` - résolu le ${fmtDateHeure(t.resolved_at)}` : ''}`), 12, 31)
  doc.setTextColor(0)

  const lignesInfo: Array<[string, string]> = [
    ['Client', [t.intitule_tiers, t.numero_tiers].filter(Boolean).join(' - ')],
    ['Contact', [t.contact_nom, t.contact_email].filter(Boolean).join(' - ')],
    ['Téléphone', fmtTel(t.telephone_appelant)],
    ['Chantier / référence', t.chantier || ''],
    ["Nature de l'appel", libelleNature(t.nature)],
    ['Code défaut', t.code_defaut || ''],
    ['Groupe extérieur (GE)', [t.modele_ge, t.serie_ge && `n° ${t.serie_ge}`].filter(Boolean).join(' - ')],
    ['Unité intérieure (UI)', [t.reference_article, t.numero_serie && `n° ${t.numero_serie}`].filter(Boolean).join(' - ')],
    ['Mise en service', t.date_mes ? fmtDate(t.date_mes) : ''],
  ]
  if (classif) {
    AXES_CLASSIF.forEach(({ axe, label }) => {
      const v = axe === 'action' ? (t.actions || []).map((a) => libelleClassif(classif, 'action', a)).join(', ') : libelleClassif(classif, axe, t[axe as 'symptome' | 'organe' | 'issue'])
      if (v) lignesInfo.push([label, v])
    })
  }

  autoTable(doc, {
    startY: 36,
    body: lignesInfo.filter(([, v]) => v).map(([k, v]) => [p(k), p(v)]),
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, textColor: [90, 90, 90] } },
    margin: { left: 12, right: 12 },
  })

  // Note rapide (motif de l'appel) et préconisation
  const notes = etapes.filter((e) => e.type === 'NOTE_RAPIDE')
  const note = notes[notes.length - 1]?.libelle || t.description || ''
  const blocs: Array<[string, string]> = []
  if (note) blocs.push(["Note rapide - motif de l'appel", note])
  if (t.preconisation) blocs.push(['Préconisation / solution', t.preconisation])
  if (blocs.length) {
    autoTable(doc, {
      startY: finY() + 4,
      head: [],
      body: blocs.map(([k, v]) => [p(k), p(v)]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2, lineColor: [226, 223, 216] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, fillColor: [253, 247, 234] } },
      margin: { left: 12, right: 12 },
    })
  }

  // Historique complet, hors commentaires internes
  const historique = etapes.filter((e) => !estInterne(e) && e !== notes[notes.length - 1])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Historique du ticket', 12, finY() + 9)
  autoTable(doc, {
    startY: finY() + 11,
    head: [['Date', 'Par', 'Étape', 'Détail'].map(p)],
    body: historique.map((e) => [
      p(fmtDateHeure(e.at)),
      p(auteur(e.auteur)),
      p(ETAPE_LIBELLES[e.type] || e.type),
      p(e.libelle.replace(/^Diagnostic : /, 'Diagnostic (ancien outil) : ')),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [11, 18, 32], fontSize: 8.5 },
    styles: { fontSize: 8.5, cellPadding: 1.6, valign: 'top' },
    columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 24 }, 2: { cellWidth: 30, fontStyle: 'bold' } },
    margin: { left: 12, right: 12 },
  })

  if (pieces.length) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Pièces jointes', 12, finY() + 9)
    autoTable(doc, {
      startY: finY() + 11,
      body: pieces.map((pc) => [p(fmtDateHeure(pc.ajoute_le)), p(pc.mail_objet || pc.nom)]),
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 1.2 },
      columnStyles: { 0: { cellWidth: 26 } },
      margin: { left: 12, right: 12 },
    })
  }

  // Pied de page
  const total = doc.getNumberOfPages()
  const h = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(120)
    doc.text(p(`Ticket ${t.numero} - édité le ${fmtDateHeure(new Date().toISOString())}`), 12, h - 6)
    doc.text(`Page ${i} / ${total}`, w - 12, h - 6, { align: 'right' })
  }
  doc.save(`Fiche ${t.numero}.pdf`)
}
