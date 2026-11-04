// ============================================================================
// lib/hotlineImport.ts — Hotline : reprise de l'historique de l'ancien outil
// de ticketing (04/11/2026)
// ----------------------------------------------------------------------------
// Fichier source : export CSV « historique-ticketing » (séparateur ;, UTF-8,
// textes multilignes entre guillemets) — colonnes Reference ticket, Date
// creation, Etat, Societe, Site, Contact, Telephone, Hotliner, Nature, Code
// defaut, Modele GE, N serie GE, Modele UI, N serie UI, Date MES, Notes
// rapides, Diagnostics. Le fichier de contrôle Excel exporté par l'écran
// reprend ces colonnes + le client retrouvé ; sa colonne « Code tiers »,
// corrigée à la main, est prioritaire au ré-import.
// Les lignes en double (même référence) sont fusionnées.
// RPC : hotline_importer_historique (migration 20261104c).
// ============================================================================

import type ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

export type LigneHistorique = {
  ref: string
  date_creation: string
  etat: string
  societe: string
  site: string
  contact: string
  telephone: string
  hotliner: string
  nature: string
  code_defaut: string
  modele_ge: string
  serie_ge: string
  modele_ui: string
  serie_ui: string
  date_mes: string | null
  notes: string
  diagnostics: string
  code_tiers: string
}

export type ResultatLigne = {
  ref: string
  date: string
  societe: string | null
  telephone: string | null
  numero_tiers: string | null
  intitule_tiers: string | null
  methode: 'FICHIER' | 'CODE_FICHIER_INCONNU' | 'TELEPHONE' | 'NOM' | 'TELEPHONE_AMBIGU' | 'AUCUN'
  candidats: string | null
  nature: string | null
  gamme: string | null
  statut: string
  existe: boolean
}

export type Stats = {
  lignes: number
  nouveaux: number
  deja_importes: number
  par_telephone: number
  par_nom: number
  par_fichier: number
  ambigus: number
  non_trouves: number
  ouverts: number
}

export const METHODES: Record<ResultatLigne['methode'], { label: string; ton: string }> = {
  FICHIER: { label: 'Code du fichier', ton: '#1E4E8C' },
  TELEPHONE: { label: 'Téléphone', ton: '#2F6B3A' },
  NOM: { label: 'Nom de société', ton: '#2F6B3A' },
  TELEPHONE_AMBIGU: { label: 'Téléphone ambigu', ton: '#8A5A11' },
  CODE_FICHIER_INCONNU: { label: 'Code inconnu', ton: '#A32C2C' },
  AUCUN: { label: 'Non trouvé', ton: '#A32C2C' },
}

const COLONNES: Array<[keyof LigneHistorique, string[]]> = [
  ['ref', ['reference ticket', 'reference', 'ref']],
  ['date_creation', ['date creation', 'date de creation']],
  ['etat', ['etat']],
  ['societe', ['societe']],
  ['site', ['site', 'chantier']],
  ['contact', ['contact']],
  ['telephone', ['telephone', 'tel']],
  ['hotliner', ['hotliner']],
  ['nature', ['nature']],
  ['code_defaut', ['code defaut']],
  ['modele_ge', ['modele ge']],
  ['serie_ge', ['n serie ge', 'numero serie ge', 'serie ge']],
  ['modele_ui', ['modele ui']],
  ['serie_ui', ['n serie ui', 'numero serie ui', 'serie ui']],
  ['date_mes', ['date mes', 'date mise en service']],
  ['notes', ['notes rapides', 'notes']],
  ['diagnostics', ['diagnostics', 'diagnostic']],
  ['code_tiers', ['code tiers']],
]

function cle(v: string) {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** CSV « ; » avec champs entre guillemets (sauts de ligne et "" autorisés). */
export function lireCsv(texte: string, sep = ';'): string[][] {
  const lignes: string[][] = []
  let ligne: string[] = []
  let champ = ''
  let guillemets = false
  const t = texte.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (guillemets) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          champ += '"'
          i++
        } else guillemets = false
      } else champ += c
      continue
    }
    if (c === '"' && champ === '') guillemets = true
    else if (c === sep) {
      ligne.push(champ)
      champ = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      ligne.push(champ)
      champ = ''
      if (ligne.some((x) => x !== '')) lignes.push(ligne)
      ligne = []
    } else champ += c
  }
  if (champ !== '' || ligne.length) {
    ligne.push(champ)
    if (ligne.some((x) => x !== '')) lignes.push(ligne)
  }
  return lignes
}

function dateIso(v: string): string {
  const s = v.trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace(' ', 'T').slice(0, 19)
  return ''
}

function versLignes(tableau: string[][]): { lignes: LigneHistorique[]; doublons: number; erreurs: string[] } {
  const erreurs: string[] = []
  if (!tableau.length) return { lignes: [], doublons: 0, erreurs: ['Fichier vide.'] }
  const entetes = tableau[0].map((h) => cle(h))
  const index: Partial<Record<keyof LigneHistorique, number>> = {}
  COLONNES.forEach(([k, noms]) => {
    const i = entetes.findIndex((h) => noms.includes(h))
    if (i >= 0) index[k] = i
  })
  if (index.ref === undefined || index.date_creation === undefined) {
    erreurs.push('Colonnes « Reference ticket » et « Date creation » introuvables : est-ce bien l’export de l’ancien outil ?')
    return { lignes: [], doublons: 0, erreurs }
  }
  const parRef = new Map<string, LigneHistorique>()
  let doublons = 0
  tableau.slice(1).forEach((r, n) => {
    const v = (k: keyof LigneHistorique) => (index[k] === undefined ? '' : String(r[index[k] as number] ?? '').trim())
    const ref = v('ref').toUpperCase()
    if (!ref) return
    const date = dateIso(v('date_creation'))
    if (!date) {
      erreurs.push(`Ligne ${n + 2} (${ref}) : date de création illisible « ${v('date_creation')} ».`)
      return
    }
    const mes = dateIso(v('date_mes'))
    const l: LigneHistorique = {
      ref,
      date_creation: date,
      etat: v('etat'),
      societe: v('societe'),
      site: v('site'),
      contact: v('contact'),
      telephone: v('telephone'),
      hotliner: v('hotliner'),
      nature: v('nature'),
      code_defaut: v('code_defaut'),
      modele_ge: v('modele_ge'),
      serie_ge: v('serie_ge'),
      modele_ui: v('modele_ui'),
      serie_ui: v('serie_ui'),
      date_mes: mes ? mes.slice(0, 10) : null,
      notes: v('notes'),
      diagnostics: v('diagnostics'),
      code_tiers: v('code_tiers').toUpperCase(),
    }
    const deja = parRef.get(ref)
    if (!deja) {
      parRef.set(ref, l)
      return
    }
    // Doublon : on garde la date la plus ancienne, on complète les champs vides
    // et on cumule les textes différents.
    doublons += 1
    if (l.date_creation < deja.date_creation) deja.date_creation = l.date_creation
    ;(Object.keys(l) as Array<keyof LigneHistorique>).forEach((k) => {
      if (k === 'ref' || k === 'date_creation') return
      const a = String(deja[k] || '')
      const b = String(l[k] || '')
      if (!b) return
      if (!a) (deja as Record<string, unknown>)[k] = l[k]
      else if ((k === 'notes' || k === 'diagnostics') && !a.includes(b)) (deja as Record<string, unknown>)[k] = `${a}\n${b}`
    })
  })
  const lignes = Array.from(parRef.values()).sort((a, b) => b.date_creation.localeCompare(a.date_creation))
  return { lignes, doublons, erreurs }
}

function chargerExcelJS() {
  return import('exceljs').then((m) => (m.default || m) as typeof ExcelJS)
}

export async function lireFichierHistorique(fichier: File) {
  if (/\.xlsx$/i.test(fichier.name)) {
    const Excel = await chargerExcelJS()
    const wb = new Excel.Workbook()
    await wb.xlsx.load(await fichier.arrayBuffer())
    const ws = wb.worksheets[0]
    const tableau: string[][] = []
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((x) => {
        if (x === null || x === undefined) return ''
        if (x instanceof Date) {
          const d = x
          return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
        }
        if (typeof x === 'object') {
          const o = x as { text?: unknown; richText?: Array<{ text: string }>; result?: unknown }
          if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('')
          if (o.text !== undefined) return String(o.text)
          if (o.result !== undefined) return String(o.result)
        }
        return String(x)
      })
      tableau.push(vals)
    })
    return versLignes(tableau)
  }
  const texte = await fichier.text()
  return versLignes(lireCsv(texte, texte.split('\n')[0].includes(';') ? ';' : ','))
}

/** Appel de la RPC par lots (simulation ou import). */
export async function traiterHistorique(
  lignes: LigneHistorique[],
  simulation: boolean,
  progression?: (fait: number, total: number) => void,
): Promise<{ stats: Stats; resultats: ResultatLigne[] }> {
  const LOT = 300
  const stats: Stats = { lignes: 0, nouveaux: 0, deja_importes: 0, par_telephone: 0, par_nom: 0, par_fichier: 0, ambigus: 0, non_trouves: 0, ouverts: 0 }
  const resultats: ResultatLigne[] = []
  for (let i = 0; i < lignes.length; i += LOT) {
    const lot = lignes.slice(i, i + LOT)
    const { data, error } = await supabase.rpc('hotline_importer_historique', { p_lignes: lot, p_simulation: simulation })
    if (error) throw error
    const r = data as { stats: Stats; lignes: ResultatLigne[] }
    ;(Object.keys(stats) as Array<keyof Stats>).forEach((k) => (stats[k] += Number(r.stats?.[k] || 0)))
    resultats.push(...(r.lignes || []))
    progression?.(Math.min(i + LOT, lignes.length), lignes.length)
  }
  resultats.sort((a, b) => b.date.localeCompare(a.date))
  return { stats, resultats }
}

/** Fichier de contrôle : colonnes source + client retrouvé ; « Code tiers » modifiable. */
export async function exporterControle(lignes: LigneHistorique[], resultats: ResultatLigne[]) {
  const Excel = await chargerExcelJS()
  const parRef = new Map(resultats.map((r) => [r.ref, r]))
  const wb = new Excel.Workbook()
  const ws = wb.addWorksheet('Historique', { views: [{ state: 'frozen', ySplit: 1 }] })
  const entetes = [
    'Reference ticket', 'Date creation', 'Etat', 'Societe', 'Code tiers', 'Client retrouvé', 'Méthode', 'Candidats (téléphone)',
    'Site', 'Contact', 'Telephone', 'Hotliner', 'Nature', 'Code defaut', 'Modele GE', 'N serie GE', 'Modele UI', 'N serie UI',
    'Date MES', 'Gamme déduite', 'Statut repris', 'Déjà importé', 'Notes rapides', 'Diagnostics',
  ]
  ws.addRow(entetes)
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }
  ws.getCell('E1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4761A' } }
  const larg = [16, 18, 11, 28, 11, 28, 16, 20, 22, 16, 15, 12, 18, 10, 16, 20, 16, 20, 11, 9, 11, 9, 40, 60]
  larg.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const fr = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/)
    return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}:${m[6]}` : ''}` : iso
  }
  lignes.forEach((l) => {
    const r = parRef.get(l.ref)
    const row = ws.addRow([
      l.ref, fr(l.date_creation), l.etat, l.societe, r?.numero_tiers || l.code_tiers || '', r?.intitule_tiers || '',
      r ? METHODES[r.methode]?.label || r.methode : '', r?.candidats || '', l.site, l.contact, l.telephone, l.hotliner, l.nature,
      l.code_defaut, l.modele_ge, l.serie_ge, l.modele_ui, l.serie_ui, l.date_mes ? fr(l.date_mes) : '', r?.gamme || '',
      r?.statut || '', r?.existe ? 'OUI' : 'NON', l.notes, l.diagnostics,
    ])
    if (r && (r.methode === 'AUCUN' || r.methode === 'TELEPHONE_AMBIGU' || r.methode === 'CODE_FICHIER_INCONNU')) {
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCEFEC' } }
    }
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: entetes.length } }
  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `historique-ticketing-controle-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
