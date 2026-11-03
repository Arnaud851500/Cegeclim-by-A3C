// ============================================================================
// lib/hotlineExcel.ts — Hotline : fichier Excel normé des parcours de
// diagnostic (03/11/2026)
// ----------------------------------------------------------------------------
// Un seul format sert de modèle, d'export et d'import :
//   Mode d'emploi · Parcours · Questions · Réponses · Documents
// Parcours et questions sont désignés par leur CODE : code existant = mise à
// jour, nouveau code = création. Un parcours présent dans le fichier est
// remplacé entièrement par son contenu ; les parcours absents ne bougent pas.
// L'import passe par la RPC hotline_importer_parcours (contrôle complet du
// fichier, puis application en une seule transaction) — migration
// 20261103b_hotline_import_excel.sql.
// ExcelJS est chargé à la demande (pas dans le bundle des autres écrans).
// ============================================================================

import type ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { normaliserNoeud, type Arbre } from '@/lib/hotline'

export type ReponseImport = { libelle: string; suivant: string; preconisation: string; escalade: boolean }
export type DocumentImport = { titre: string; type: string; url: string }
export type QuestionImport = {
  code: string
  ordre: number | null
  question: string
  aide: string
  depart: boolean
  reponses: ReponseImport[]
  documents: DocumentImport[]
}
export type ParcoursImport = {
  code: string
  filiere: string
  motif: string
  nom: string
  famille: string
  actif: boolean
  publie_extranet: boolean
  questions: QuestionImport[]
}

export type BilanImport = {
  ok: boolean
  simulation?: boolean
  erreurs?: string[]
  parcours_crees?: number
  parcours_maj?: number
  questions?: number
  reponses?: number
  documents?: number
  questions_supprimees?: number
}

const COLONNES = {
  Parcours: ['Code parcours', 'Filière', 'Motif', 'Nom du parcours', 'Famille produit', 'Actif', 'Publié extranet'],
  Questions: ['Code parcours', 'Code question', 'Ordre', 'Question', 'Consigne niveau 1', 'Départ'],
  'Réponses': ['Code parcours', 'Code question', 'Réponse', 'Question suivante', 'Préconisation (fin de parcours)', 'Proposer escalade'],
  Documents: ['Code parcours', 'Code question', 'Titre du document', 'Type', 'Lien'],
} as const

const LARGEURS: Record<string, number[]> = {
  Parcours: [16, 14, 20, 40, 20, 10, 16],
  Questions: [16, 14, 8, 60, 50, 10],
  'Réponses': [16, 14, 32, 18, 60, 18],
  Documents: [16, 14, 45, 12, 70],
}

const MODE_EMPLOI = [
  'PARCOURS DE DIAGNOSTIC — HOTLINE TECHNIQUE CEGECLIM',
  '',
  'Ce fichier sert à créer ou mettre à jour les parcours de diagnostic suivis par le niveau 1.',
  'Il s’importe dans le compagnon : Hotline technique › Éditeur de diagnostic › « Importer un Excel ».',
  '',
  'RÈGLES',
  '• Chaque parcours a un CODE unique (ex. TH-MES-1). Code déjà connu = mise à jour ; nouveau code = création.',
  '• Un parcours présent dans le fichier est REMPLACÉ par son contenu : ses questions absentes du fichier sont supprimées.',
  '• Les parcours absents du fichier ne sont pas modifiés. Pour ne retoucher qu’un parcours, ne laissez que ses lignes.',
  '• Chaque question a un CODE unique dans son parcours (ex. Q1, Q2, CODE_DEFAUT…).',
  '• Une seule question « Départ » = OUI par parcours (sinon la première question est le départ).',
  '',
  'ONGLETS',
  '• Parcours : une ligne par parcours. Filière = PV ou THERMIQUE. Motif = MISE_EN_SERVICE ou EXPLOITATION. Actif / Publié extranet = OUI ou NON.',
  '• Questions : une ligne par question. Consigne niveau 1 = aide affichée sous la question (facultatif).',
  '• Réponses : une ligne par réponse possible. « Question suivante » = code de la question qui suit.',
  '   Laisser « Question suivante » vide = fin du parcours : renseigner alors la « Préconisation » donnée à l’appelant,',
  '   et « Proposer escalade » = OUI si ce cas relève du niveau supérieur.',
  '• Documents : documents proposés à l’envoi quand la question s’affiche (procédure, schéma, firmware…). Lien = adresse web du document.',
  '',
  'À l’import, tout le fichier est contrôlé avant d’être appliqué : en cas d’erreur, rien n’est modifié et la liste des erreurs s’affiche.',
]

function chargerExcelJS() {
  return import('exceljs').then((m) => (m.default || m) as typeof ExcelJS)
}

const ouiNon = (v: boolean) => (v ? 'OUI' : 'NON')

function telecharger(buffer: ArrayBuffer, nom: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Export de tous les parcours (ou modèle vide avec un exemple si aucun). */
export async function exporterParcoursExcel(arbres: Arbre[]) {
  const Excel = await chargerExcelJS()
  const { data, error } = await supabase.from('hotline_noeuds').select('*').order('ordre')
  if (error) throw error
  const noeuds = ((data || []) as Record<string, unknown>[]).map((r) => ({ ...normaliserNoeud(r), code: String(r.code || '') }))
  const codeParId = new Map(noeuds.map((n) => [n.id, n.code]))

  const wb = new Excel.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  const guide = wb.addWorksheet('Mode d’emploi')
  guide.getColumn(1).width = 130
  MODE_EMPLOI.forEach((l, i) => {
    const c = guide.getCell(i + 1, 1)
    c.value = l
    if (i === 0 || l === 'RÈGLES' || l === 'ONGLETS') c.font = { bold: true, color: { argb: 'FF0B1220' }, size: i === 0 ? 14 : 11 }
  })

  const feuilles: Record<string, ExcelJS.Worksheet> = {}
  for (const [nom, cols] of Object.entries(COLONNES)) {
    const ws = wb.addWorksheet(nom, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.addRow([...cols])
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }
    LARGEURS[nom].forEach((w, i) => (ws.getColumn(i + 1).width = w))
    feuilles[nom] = ws
  }

  const liste = (ws: ExcelJS.Worksheet, col: string, valeurs: string[]) => {
    for (let r = 2; r <= 1000; r++) {
      ws.getCell(`${col}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${valeurs.join(',')}"`] }
    }
  }
  liste(feuilles.Parcours, 'B', ['PV', 'THERMIQUE'])
  liste(feuilles.Parcours, 'C', ['MISE_EN_SERVICE', 'EXPLOITATION'])
  liste(feuilles.Parcours, 'F', ['OUI', 'NON'])
  liste(feuilles.Parcours, 'G', ['OUI', 'NON'])
  liste(feuilles.Questions, 'F', ['OUI', 'NON'])
  liste(feuilles['Réponses'], 'F', ['OUI', 'NON'])
  liste(feuilles.Documents, 'D', ['PDF', 'SCHEMA', 'FIRMWARE', 'VIDEO', 'XLS', 'LIEN'])

  const tries = [...arbres].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))
  if (!tries.length) {
    feuilles.Parcours.addRow(['TH-MES-1', 'THERMIQUE', 'MISE_EN_SERVICE', 'Mise en service PAC air/eau', 'PAC', 'OUI', 'NON'])
    feuilles.Questions.addRow(['TH-MES-1', 'Q1', 1, 'La PAC affiche-t-elle un code défaut ?', 'Faire lire l’afficheur de la télécommande.', 'OUI'])
    feuilles.Questions.addRow(['TH-MES-1', 'Q2', 2, 'Quel code défaut ?', '', 'NON'])
    feuilles['Réponses'].addRow(['TH-MES-1', 'Q1', 'Oui', 'Q2', '', 'NON'])
    feuilles['Réponses'].addRow(['TH-MES-1', 'Q1', 'Non', '', 'Vérifier l’alimentation puis relancer la mise en service', 'NON'])
    feuilles['Réponses'].addRow(['TH-MES-1', 'Q2', 'Autre code', '', 'Escalade niveau 2 avec le code relevé', 'OUI'])
    feuilles.Documents.addRow(['TH-MES-1', 'Q1', 'Procédure de mise en service', 'PDF', 'https://…'])
  }
  for (const a of tries) {
    feuilles.Parcours.addRow([a.code || '', a.filiere, a.motif, a.nom, a.famille || '', ouiNon(a.actif), ouiNon(a.publie_extranet)])
    const ns = noeuds.filter((n) => n.arbre_id === a.id).sort((x, y) => x.ordre - y.ordre)
    for (const n of ns) {
      feuilles.Questions.addRow([a.code || '', n.code, n.ordre, n.question, n.aide || '', ouiNon(n.id === a.noeud_racine)])
      for (const c of n.choix) {
        feuilles['Réponses'].addRow([a.code || '', n.code, c.libelle, c.suivant ? codeParId.get(c.suivant) || '' : '', c.suivant ? '' : c.preconisation || '', ouiNon(Boolean(c.escalade))])
      }
      for (const d of n.documents) {
        feuilles.Documents.addRow([a.code || '', n.code, d.titre, d.type || 'PDF', d.url || ''])
      }
    }
  }
  ;[feuilles.Questions, feuilles['Réponses']].forEach((ws) => {
    ws.getColumn(4).alignment = { wrapText: true, vertical: 'top' }
    ws.getColumn(5).alignment = { wrapText: true, vertical: 'top' }
  })

  const date = new Date().toISOString().slice(0, 10)
  telecharger((await wb.xlsx.writeBuffer()) as ArrayBuffer, `parcours-diagnostic-hotline-${date}.xlsx`)
}

// ----------------------------------------------------------------------------
// Lecture du fichier
// ----------------------------------------------------------------------------
function cle(v: string) {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function texteCellule(c: ExcelJS.Cell) {
  const v = c.value as unknown
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as { text?: unknown; hyperlink?: string; result?: unknown; richText?: Array<{ text: string }> }
    if (o.hyperlink) return String(o.hyperlink)
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('')
    if (o.text !== undefined) return String(o.text)
    if (o.result !== undefined) return String(o.result)
  }
  return String(c.text ?? v).trim()
}

function oui(v: string, defaut = false) {
  const k = cle(v)
  if (!k) return defaut
  return ['oui', 'o', 'x', '1', 'vrai', 'true', 'yes', 'y'].includes(k)
}

function filiere(v: string) {
  const k = cle(v)
  if (['pv', 'photo', 'photovoltaique', 'photovoltaique pv'].includes(k)) return 'PV'
  if (['th', 'thermie', 'thermique'].includes(k)) return 'THERMIQUE'
  return v.trim().toUpperCase()
}

function motif(v: string) {
  const k = cle(v)
  if (['mes', 'mise en service'].includes(k)) return 'MISE_EN_SERVICE'
  if (['exp', 'exploitation', 'probleme en exploitation', 'panne', 'panne en exploitation', 'run'].includes(k)) return 'EXPLOITATION'
  return v.trim().toUpperCase().replace(/\s+/g, '_')
}

function lignes(wb: ExcelJS.Workbook, nom: string, attendues: readonly string[], erreurs: string[]) {
  const ws = wb.worksheets.find((w) => cle(w.name) === cle(nom))
  if (!ws) {
    if (nom === 'Parcours' || nom === 'Questions') erreurs.push(`Onglet « ${nom} » introuvable.`)
    return [] as Array<Record<string, string> & { _ligne: string }>
  }
  const entetes: Record<number, string> = {}
  ws.getRow(1).eachCell((c, i) => {
    const k = cle(texteCellule(c))
    if (!k) return
    const trouve = attendues.find((a) => cle(a) === k || k.startsWith(cle(a)) || cle(a).startsWith(k))
    if (trouve) entetes[i] = trouve
  })
  const manquantes = attendues.filter((a) => !Object.values(entetes).includes(a)).filter((a) => ['Code parcours', 'Code question'].includes(a))
  if (manquantes.length) erreurs.push(`Onglet « ${nom} » : colonne(s) ${manquantes.join(', ')} introuvable(s).`)
  const res: Array<Record<string, string> & { _ligne: string }> = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const o: Record<string, string> & { _ligne: string } = { _ligne: `${nom} ligne ${n}` }
    let vide = true
    Object.entries(entetes).forEach(([i, a]) => {
      const t = texteCellule(row.getCell(Number(i)))
      o[a] = t
      if (t) vide = false
    })
    if (!vide) res.push(o)
  })
  return res
}

export async function lireExcelParcours(fichier: File): Promise<{ parcours: ParcoursImport[]; erreurs: string[] }> {
  const Excel = await chargerExcelJS()
  const wb = new Excel.Workbook()
  await wb.xlsx.load(await fichier.arrayBuffer())
  const erreurs: string[] = []
  const lp = lignes(wb, 'Parcours', COLONNES.Parcours, erreurs)
  const lq = lignes(wb, 'Questions', COLONNES.Questions, erreurs)
  const lr = lignes(wb, 'Réponses', COLONNES['Réponses'], erreurs)
  const ld = lignes(wb, 'Documents', COLONNES.Documents, erreurs)

  const parcours = new Map<string, ParcoursImport>()
  for (const r of lp) {
    const code = (r['Code parcours'] || '').trim().toUpperCase()
    if (!code) {
      erreurs.push(`${r._ligne} : code parcours vide.`)
      continue
    }
    parcours.set(code, {
      code,
      filiere: filiere(r['Filière'] || ''),
      motif: motif(r['Motif'] || ''),
      nom: (r['Nom du parcours'] || '').trim(),
      famille: (r['Famille produit'] || '').trim(),
      actif: oui(r['Actif'] || '', true),
      publie_extranet: oui(r['Publié extranet'] || '', false),
      questions: [],
    })
  }
  const question = (r: Record<string, string> & { _ligne: string }) => {
    const p = parcours.get((r['Code parcours'] || '').trim().toUpperCase())
    if (!p) {
      erreurs.push(`${r._ligne} : parcours « ${r['Code parcours'] || ''} » absent de l’onglet Parcours.`)
      return null
    }
    const code = (r['Code question'] || '').trim().toUpperCase()
    const q = p.questions.find((x) => x.code === code)
    if (!q) erreurs.push(`${r._ligne} : question « ${code} » absente de l’onglet Questions pour le parcours ${p.code}.`)
    return q || null
  }
  for (const r of lq) {
    const p = parcours.get((r['Code parcours'] || '').trim().toUpperCase())
    if (!p) {
      erreurs.push(`${r._ligne} : parcours « ${r['Code parcours'] || ''} » absent de l’onglet Parcours.`)
      continue
    }
    const ordre = Number(String(r['Ordre'] || '').replace(',', '.'))
    p.questions.push({
      code: (r['Code question'] || '').trim().toUpperCase(),
      ordre: Number.isFinite(ordre) && String(r['Ordre'] || '').trim() ? Math.round(ordre) : null,
      question: (r['Question'] || '').trim(),
      aide: (r['Consigne niveau 1'] || '').trim(),
      depart: oui(r['Départ'] || ''),
      reponses: [],
      documents: [],
    })
  }
  for (const r of lr) {
    const q = question(r)
    if (!q) continue
    const suivant = (r['Question suivante'] || '').trim().toUpperCase()
    q.reponses.push({
      libelle: (r['Réponse'] || '').trim(),
      suivant,
      preconisation: suivant ? '' : (r['Préconisation (fin de parcours)'] || '').trim(),
      escalade: oui(r['Proposer escalade'] || ''),
    })
  }
  for (const r of ld) {
    const q = question(r)
    if (!q) continue
    if (!(r['Titre du document'] || '').trim()) continue
    q.documents.push({ titre: r['Titre du document'].trim(), type: (r['Type'] || 'PDF').trim().toUpperCase(), url: (r['Lien'] || '').trim() })
  }
  return { parcours: Array.from(parcours.values()), erreurs }
}

export async function importerParcours(parcours: ParcoursImport[], simulation: boolean): Promise<BilanImport> {
  const { data, error } = await supabase.rpc('hotline_importer_parcours', { p_parcours: parcours, p_simulation: simulation })
  if (error) throw error
  return data as BilanImport
}
