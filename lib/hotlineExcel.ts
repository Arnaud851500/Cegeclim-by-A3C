// ============================================================================
// lib/hotlineExcel.ts — Hotline : fichier Excel normé des parcours de
// diagnostic (03/11/2026)
// ----------------------------------------------------------------------------
// Un seul format sert de modèle, d'export et d'import : TOUT sur un seul
// onglet « Parcours de diagnostic », une ligne par réponse possible ; les
// cellules du parcours et de la question ne sont écrites que sur leur première
// ligne (vide = « comme au-dessus »). Les documents d'une question tiennent
// dans une cellule, un par ligne : Titre | Type | Lien.
// L'ancien format à 4 onglets (Parcours/Questions/Réponses/Documents) reste
// accepté à l'import.
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
  /** Thermique : GAINABLE, RR, RO ou vide (toutes gammes). */
  gamme?: string
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

// ----------------------------------------------------------------------------
// Format à un seul onglet
// ----------------------------------------------------------------------------
const ONGLET_UNIQUE = 'Parcours de diagnostic'
const COLONNES_UNIQUE = [
  'Code parcours', 'Filière', 'Motif', 'Gamme', 'Nom du parcours', 'Famille produit', 'Actif', 'Publié extranet',
  'Code question', 'Ordre', 'Départ', 'Question', 'Consigne niveau 1', 'Documents (Titre | Type | Lien)',
  'Réponse', 'Question suivante', 'Rappel : question suivante', 'Préconisation (fin de parcours)', 'Proposer escalade',
] as const
const LARGEURS_UNIQUE = [14, 12, 17, 10, 30, 14, 8, 10, 11, 7, 8, 48, 40, 40, 26, 12, 40, 48, 11]
// Colonnes (1-based) : blocs parcours / question / réponse
const BLOC_PARCOURS = [1, 8]
const BLOC_QUESTION = [9, 14]

const MODE_EMPLOI_UNIQUE = [
  'PARCOURS DE DIAGNOSTIC — HOTLINE TECHNIQUE CEGECLIM',
  '',
  'Tout se trouve dans l’onglet « Parcours de diagnostic » : UNE LIGNE PAR RÉPONSE POSSIBLE.',
  'Il s’importe dans le compagnon : Hotline technique › Éditeur de diagnostic › « Importer un Excel ».',
  '',
  'LECTURE DE L’ONGLET',
  '• Colonnes bleues = le parcours. Elles ne sont remplies que sur la première ligne du parcours.',
  '• Colonnes vertes = la question. Elles ne sont remplies que sur la première réponse de la question.',
  '• Colonnes orange = la réponse : libellé, question suivante (ou préconisation si fin de parcours), escalade.',
  '• Une cellule vide dans un bloc bleu ou vert veut dire « comme au-dessus ».',
  '• « Rappel : question suivante » recopie le texte de la question visée, pour s’y retrouver. Elle est ignorée à l’import.',
  '',
  'RÈGLES',
  '• Chaque parcours a un CODE unique (ex. TH-MES-1). Code déjà connu = mise à jour ; nouveau code = création.',
  '• Un parcours présent dans le fichier est REMPLACÉ par son contenu : ses questions absentes du fichier sont supprimées.',
  '• Les parcours absents du fichier ne sont pas modifiés. Pour ne retoucher qu’un parcours, ne laissez que ses lignes.',
  '• Chaque question a un CODE unique dans son parcours (ex. Q1, Q2…). Une seule question « Départ » = OUI par parcours.',
  '• Gamme (thermique) = GAINABLE, RR (air/air) ou RO (air/eau) ; vide = toutes gammes. Elle oriente la console après « Thermie ».',
  '• Filière = PV ou THERMIQUE. Motif = MISE_EN_SERVICE ou EXPLOITATION. Actif, Publié extranet, Départ, Proposer escalade = OUI ou NON.',
  '• « Question suivante » vide = fin du parcours : renseigner alors la Préconisation donnée à l’appelant.',
  '• Documents : un document par ligne dans la cellule (Alt+Entrée), sous la forme  Titre | Type | Lien.',
  '  Types : PDF, SCHEMA, FIRMWARE, VIDEO, XLS, LIEN, VUE_ECLATEE (lien = vue:RÉFÉRENCE, ex. vue:RAK-DJ35RHAE).',
  '• Pour ajouter une réponse à une question : insérer une ligne sous ses réponses et ne remplir que les colonnes orange.',
  '',
  'À l’import, tout le fichier est contrôlé avant d’être appliqué : en cas d’erreur, rien n’est modifié et la liste des erreurs s’affiche.',
]

const COULEURS = { parcours: 'FF1E3A8A', question: 'FF166534', reponse: 'FF9A3412' }
const FONDS = { parcours: 'FFEFF6FF', question: 'FFF0FDF4' }

type LigneUnique = (string | number)[]

/** Export de tous les parcours sur un seul onglet (ou modèle avec un exemple si aucun). */
export async function exporterParcoursExcel(arbres: Arbre[]) {
  const Excel = await chargerExcelJS()
  const { data, error } = await supabase.from('hotline_noeuds').select('*').order('ordre')
  if (error) throw error
  const noeuds = ((data || []) as Record<string, unknown>[]).map((r) => ({ ...normaliserNoeud(r), code: String(r.code || '') }))
  const parId = new Map(noeuds.map((n) => [n.id, n]))

  const wb = new Excel.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  const ws = wb.addWorksheet(ONGLET_UNIQUE, { views: [{ state: 'frozen', ySplit: 1 }] })
  const guide = wb.addWorksheet('Mode d’emploi')
  guide.getColumn(1).width = 130
  MODE_EMPLOI_UNIQUE.forEach((l, i) => {
    const c = guide.getCell(i + 1, 1)
    c.value = l
    if (i === 0 || l === 'RÈGLES' || l === 'LECTURE DE L’ONGLET') c.font = { bold: true, color: { argb: 'FF0B1220' }, size: i === 0 ? 14 : 11 }
  })

  ws.addRow([...COLONNES_UNIQUE])
  const entete = ws.getRow(1)
  entete.height = 32
  COLONNES_UNIQUE.forEach((_, i) => {
    const col = i + 1
    const bloc = col <= BLOC_PARCOURS[1] ? 'parcours' : col <= BLOC_QUESTION[1] ? 'question' : 'reponse'
    const c = entete.getCell(col)
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COULEURS[bloc] } }
    c.alignment = { wrapText: true, vertical: 'middle' }
    ws.getColumn(col).width = LARGEURS_UNIQUE[i]
  })

  // Construction des lignes : [ligne, est 1re du parcours, est 1re de la question, n° de question dans le parcours]
  const lignes: Array<{ v: LigneUnique; debutParcours: boolean; debutQuestion: boolean; rangQuestion: number }> = []
  const tries = [...arbres].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))
  if (!tries.length) {
    const P: LigneUnique = ['TH-MES-1', 'THERMIQUE', 'MISE_EN_SERVICE', 'RO', 'Mise en service PAC air/eau', 'PAC', 'OUI', 'NON']
    const vide7: LigneUnique = ['', '', '', '', '', '', '', '']
    const vide6: LigneUnique = ['', '', '', '', '', '']
    const q1: LigneUnique = ['Q1', 1, 'OUI', 'La PAC affiche-t-elle un code défaut ?', 'Faire lire l’afficheur de la télécommande.', 'Procédure de mise en service | PDF | https://…']
    const q2: LigneUnique = ['Q2', 2, 'NON', 'Quel code défaut ?', '', '']
    lignes.push({ v: [...P, ...q1, 'Oui', 'Q2', 'Quel code défaut ?', '', 'NON'], debutParcours: true, debutQuestion: true, rangQuestion: 0 })
    lignes.push({ v: [...vide7, ...vide6, 'Non', '', '', 'Vérifier l’alimentation puis relancer la mise en service', 'NON'], debutParcours: false, debutQuestion: false, rangQuestion: 0 })
    lignes.push({ v: [...vide7, ...q2, 'Autre code', '', '', 'Escalade niveau 2 avec le code relevé', 'OUI'], debutParcours: false, debutQuestion: true, rangQuestion: 1 })
  }
  for (const a of tries) {
    const ns = noeuds.filter((n) => n.arbre_id === a.id).sort((x, y) => x.ordre - y.ordre)
    const P: LigneUnique = [a.code || '', a.filiere, a.motif, a.gamme || '', a.nom, a.famille || '', ouiNon(a.actif), ouiNon(a.publie_extranet)]
    if (!ns.length) {
      lignes.push({ v: [...P], debutParcours: true, debutQuestion: true, rangQuestion: 0 })
      continue
    }
    ns.forEach((n, iq) => {
      const Q: LigneUnique = [
        n.code, n.ordre, ouiNon(n.id === a.noeud_racine), n.question, n.aide || '',
        n.documents.map((d) => [d.titre, d.type || 'PDF', d.url || ''].join(' | ')).join('\n'),
      ]
      const choix = n.choix.length ? n.choix : [null]
      choix.forEach((c, ic) => {
        const suivant = c?.suivant ? parId.get(c.suivant) : undefined
        const R: LigneUnique = c
          ? [c.libelle, suivant?.code || '', suivant?.question || '', c.suivant ? '' : c.preconisation || '', ouiNon(Boolean(c.escalade))]
          : ['', '', '', '', '']
        const premier = iq === 0 && ic === 0
        lignes.push({
          v: [...(premier ? P : P.map(() => '')), ...(ic === 0 ? Q : Q.map(() => '')), ...R],
          debutParcours: premier,
          debutQuestion: ic === 0,
          rangQuestion: iq,
        })
      })
    })
  }

  const bordure = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
  const forte = { style: 'medium' as const, color: { argb: 'FF0B1220' } }
  lignes.forEach((l) => {
    const row = ws.addRow(l.v)
    row.alignment = { wrapText: true, vertical: 'top' }
    for (let col = 1; col <= COLONNES_UNIQUE.length; col++) {
      const c = row.getCell(col)
      if (col <= BLOC_PARCOURS[1]) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDS.parcours } }
      else if (col <= BLOC_QUESTION[1] && l.rangQuestion % 2 === 0) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDS.question } }
      if (l.debutParcours) c.border = { top: forte }
      else if (l.debutQuestion) c.border = { top: bordure }
      if (col === 17) c.font = { italic: true, color: { argb: 'FF64748B' } }
    }
    if (l.debutParcours) {
      for (let col = 1; col <= 4; col++) row.getCell(col).font = { bold: true }
    }
    if (l.debutQuestion) {
      row.getCell(9).font = { bold: true }
      row.getCell(12).font = { bold: true }
    }
  })

  // Listes déroulantes posées APRÈS les données (sinon les lignes créées
  // repoussent les données vers le bas).
  const fin = Math.max(ws.rowCount, 1) + 300
  const liste = (col: string, valeurs: string[]) => {
    for (let r = 2; r <= fin; r++) {
      ws.getCell(`${col}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${valeurs.join(',')}"`] }
    }
  }
  liste('B', ['PV', 'THERMIQUE'])
  liste('C', ['MISE_EN_SERVICE', 'EXPLOITATION'])
  liste('D', ['GAINABLE', 'RR', 'RO'])
  ;['G', 'H', 'K', 'S'].forEach((c) => liste(c, ['OUI', 'NON']))
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLONNES_UNIQUE.length } }

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

function gamme(v: string) {
  const k = cle(v)
  if (!k) return ''
  if (['gainable', 'gainables', 'g'].includes(k)) return 'GAINABLE'
  if (['rr', 'r r', 'air air', 'split', 'mural', 'muraux'].includes(k)) return 'RR'
  if (['ro', 'r o', 'air eau', 'pac', 'pac air eau'].includes(k)) return 'RO'
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
    // Correspondance exacte d'abord (« Question » ≠ « Question suivante »), puis approchée
    const trouve = attendues.find((a) => cle(a) === k) || attendues.find((a) => k.startsWith(cle(a)) || cle(a).startsWith(k))
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

type Resultat = { parcours: ParcoursImport[]; erreurs: string[] }

export async function lireExcelParcours(fichier: File): Promise<Resultat> {
  const Excel = await chargerExcelJS()
  const wb = new Excel.Workbook()
  await wb.xlsx.load(await fichier.arrayBuffer())
  const unique = wb.worksheets.find((w) => cle(w.name) === cle(ONGLET_UNIQUE))
  const ancien = wb.worksheets.some((w) => cle(w.name) === 'questions')
  if (unique || !ancien) return lireUnOnglet(wb, unique)
  return lireMultiOnglets(wb)
}

/** Documents d'une cellule : un par ligne, « Titre | Type | Lien ». */
function lireDocuments(texte: string, ou: string, erreurs: string[]): DocumentImport[] {
  const TYPES = ['PDF', 'SCHEMA', 'FIRMWARE', 'VIDEO', 'XLS', 'LIEN', 'VUE_ECLATEE']
  return texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split('|').map((x) => x.trim())
      let titre = parts[0] || ''
      let type = ''
      let url = ''
      if (parts.length >= 3) {
        type = parts[1]
        url = parts.slice(2).join('|')
      } else if (parts.length === 2) {
        if (TYPES.includes(parts[1].toUpperCase())) type = parts[1]
        else url = parts[1]
      } else if (/^https?:\/\//i.test(titre)) {
        url = titre
        titre = titre.replace(/^https?:\/\//i, '').split(/[?#]/)[0]
      }
      type = (type || (url ? 'PDF' : 'LIEN')).toUpperCase()
      if (!TYPES.includes(type)) erreurs.push(`${ou} : type de document « ${type} » inconnu (${TYPES.join(', ')}).`)
      return { titre, type, url }
    })
    .filter((d) => d.titre)
}

function lireUnOnglet(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet | undefined): Resultat {
  const erreurs: string[] = []
  const feuille = ws || wb.worksheets.find((w) => {
    const t = (w.getRow(1).values as unknown[]).map((v) => cle(String(v ?? '')))
    return t.includes('code question') && t.includes('reponse')
  })
  if (!feuille) return { parcours: [], erreurs: [`Onglet « ${ONGLET_UNIQUE} » introuvable.`] }
  const rows = lignes(wb, feuille.name, COLONNES_UNIQUE, erreurs)

  const parcours = new Map<string, ParcoursImport>()
  let p: ParcoursImport | null = null
  let q: QuestionImport | null = null
  for (const r of rows) {
    // Bloc parcours : vide = comme au-dessus
    const codeP = (r['Code parcours'] || '').trim().toUpperCase()
    if (codeP) {
      p = parcours.get(codeP) || null
      if (!p) {
        p = {
          code: codeP,
          filiere: filiere(r['Filière'] || ''),
          motif: motif(r['Motif'] || ''),
          gamme: gamme(r['Gamme'] || ''),
          nom: (r['Nom du parcours'] || '').trim(),
          famille: (r['Famille produit'] || '').trim(),
          actif: oui(r['Actif'] || '', true),
          publie_extranet: oui(r['Publié extranet'] || '', false),
          questions: [],
        }
        parcours.set(codeP, p)
      }
      q = null
    }
    if (!p) {
      erreurs.push(`${r._ligne} : aucun code parcours au-dessus de cette ligne.`)
      continue
    }
    // Bloc question : vide = comme au-dessus
    const codeQ = (r['Code question'] || '').trim().toUpperCase()
    if (codeQ) {
      q = p.questions.find((x) => x.code === codeQ) || null
      if (!q) {
        const ordreTxt = String(r['Ordre'] || '').trim()
        const ordre = Number(ordreTxt.replace(',', '.'))
        q = {
          code: codeQ,
          ordre: ordreTxt && Number.isFinite(ordre) ? Math.round(ordre) : null,
          question: (r['Question'] || '').trim(),
          aide: (r['Consigne niveau 1'] || '').trim(),
          depart: oui(r['Départ'] || ''),
          reponses: [],
          documents: lireDocuments(r['Documents (Titre | Type | Lien)'] || '', r._ligne, erreurs),
        }
        p.questions.push(q)
      } else {
        // Question déjà vue plus haut : on complète ce qui manquait
        if (!q.question) q.question = (r['Question'] || '').trim()
        if (!q.aide) q.aide = (r['Consigne niveau 1'] || '').trim()
        if (!q.depart) q.depart = oui(r['Départ'] || '')
        q.documents.push(...lireDocuments(r['Documents (Titre | Type | Lien)'] || '', r._ligne, erreurs))
      }
    } else if ((r['Question'] || '').trim() && q) {
      erreurs.push(`${r._ligne} : texte de question sans code question.`)
    }
    // Bloc réponse
    const libelle = (r['Réponse'] || '').trim()
    const suivant = (r['Question suivante'] || '').trim().toUpperCase()
    const precon = (r['Préconisation (fin de parcours)'] || '').trim()
    if (!libelle && !suivant && !precon) continue
    if (!q) {
      erreurs.push(`${r._ligne} : réponse sans question au-dessus.`)
      continue
    }
    if (!libelle) erreurs.push(`${r._ligne} : libellé de réponse vide.`)
    q.reponses.push({
      libelle,
      suivant,
      preconisation: suivant ? '' : precon,
      escalade: oui(r['Proposer escalade'] || ''),
    })
  }
  return { parcours: Array.from(parcours.values()), erreurs }
}

/** Ancien format à 4 onglets (Parcours / Questions / Réponses / Documents). */
function lireMultiOnglets(wb: ExcelJS.Workbook): Resultat {
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
