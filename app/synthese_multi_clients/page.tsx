'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type ModeSelection = 'collaborateur' | 'agence'
type SortDirection = 'asc' | 'desc'
type ObjectiveType = 'texte' | 'nombre' | 'montant' | 'date' | 'action'
type ObjectiveDomain = 'Remarque' | 'Objectif' | 'QRC' | 'Initiative' | 'Visite'
type RowKind = 'total' | 'client' | 'month'

type TiersRow = {
  numero: string
  intitule: string
  codePostal: string
  codeNaf: string
  libelleNaf: string
  dateCreation: string
  prospect: boolean | null
  collaborateur: string
  agence: string
  raw: Record<string, any>
}

type CollaborateurRow = {
  nom: string
  agence: string
}

type AggRow = {
  annee: number
  mois: number
  numero_tiers: string
  intitule_tiers: string
  collaborateur: string
  agence_collaborateur: string
  famille_macro: string
  ca_ht: number
  marge_valeur: number
  nb_lignes: number
}

type ObjectiveRow = {
  id?: number
  numero_tiers: string
  annee: number
  domaine: ObjectiveDomain | string
  rubrique: string
  valeur_type: ObjectiveType | string
  valeur_text: string | null
  valeur_number: number | null
  valeur_date: string | null
}

type SummaryRow = {
  id: string
  kind: RowKind
  level: number
  numero: string
  intitule: string
  totalMois: string
  codePostal: string
  libelleNaf: string
  dateCreation: string
  prospectLabel: string
  caN3: number
  caN2: number
  devisN1: number
  devisN1ByMacro: Record<string, number>
  caN1: number
  caN1ByMacro: Record<string, number>
  margePctN1: number | null
  margeN1ByMacro: Record<string, number>
  objectifCa: number
  potentiel: number
  devisYtdN: number
  devisYtdNByMacro: Record<string, number>
  caYtdN: number
  caYtdNByMacro: Record<string, number>
  margePctYtdN: number | null
  margeYtdNByMacro: Record<string, number>
  contratBfa: number
  caVsN1: number | null
  margeVsN1: number | null
  realiseObjectif: number | null
  qrcN1: number
  frequenceCommande: number
  niveauExclusivite: number
  comNotreFaveur: number
  garantie: number
  qrcN: number
  visiteTheorique: number
  visiteRealise: number
}

type ColumnDef = {
  key: string
  label: string
  group: string
  width: number
  sticky?: 'code' | 'label' | 'month'
  className?: string
  rotate?: boolean
  editable?: {
    domaine: ObjectiveDomain
    rubrique: string
    type: ObjectiveType
  }
  value: (row: SummaryRow) => any
  format?: 'text' | 'keur' | 'pct' | 'number' | 'date' | 'action'
}

type SortState = { key: string; direction: SortDirection }

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']
const FAMILY_MACROS = ['R/R', 'R/O', 'ECS', 'DRV', 'AirZone', 'Accessoire', 'PV', 'Autres']
const N = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_DAY = new Date().getDate()
const CLOSED_MONTH = CURRENT_DAY <= 6 ? (CURRENT_MONTH === 1 ? 12 : CURRENT_MONTH - 1) : CURRENT_MONTH
const CLOSED_MONTH_YEAR = CURRENT_MONTH === 1 && CURRENT_DAY <= 6 ? N - 1 : N
const ANALYSIS_YEAR = CLOSED_MONTH_YEAR

const ACTIONS = [
  'Pack Sérénité PAC\n5 ans pièces',
  'Pack Sérénité PAC\n10 ans pièces',
  'Pack Sérénité PAC\n5 ans MO / 5 ans pièces',
  'Garantie 5 ans YUTAKI\n(formation3j Merignac)',
  'G5',
  'Promo PAC RO installateurs',
  'REC PROTRUST2',
  'MES offerte',
  'PRESTA TECH facturée',
  'PRESTA MPR',
  'C2E - Drapo',
  'Synerciel',
  'Rappel Vanne',
  'Animation AGENCE\n(barbecue, dej technique…)',
  'Animation Cegeclim\n(Barcelone, Rugby, ODP…)',
]

const VISITES = Array.from({ length: 24 }, (_, i) => `Visite n°${i + 1}`)

function normalize(value: any) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function loose(value: any) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function safeText(value: any, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value).replace(/\s/g, '').replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

function safeBool(value: any): boolean | null {
  if (value === null || value === undefined || value === '') return null
  if (value === true || value === false) return value
  const text = loose(value)
  if (['oui', 'true', 'vrai', '1', 'yes'].includes(text)) return true
  if (['non', 'false', 'faux', '0', 'no'].includes(text)) return false
  return null
}

function raw(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== null && value !== undefined && String(value).trim() !== '') return value
  }
  return null
}

function normalizeDateForInput(value: any) {
  if (!value) return ''
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return ''
}

function formatDateFr(value: any) {
  const iso = normalizeDateForInput(value)
  if (!iso) return safeText(value)
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function formatKEur(value: number) {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((value || 0) / 1000)} K€`
}

function formatPct(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}

function objectiveKey(numero: string, annee: number, domaine: string, rubrique: string) {
  return `${normalize(numero)}§${annee}§${normalize(domaine)}§${normalize(rubrique)}`
}

function macroBucket(value: any) {
  const t = loose(value).replace(/[^a-z0-9]/g, '')
  if (t === 'rr' || t.includes('refrigeration')) return 'R/R'
  if (t === 'ro' || t.includes('renouvellement')) return 'R/O'
  if (t.includes('ecs')) return 'ECS'
  if (t.includes('drv')) return 'DRV'
  if (t.includes('airzone')) return 'AirZone'
  if (t.includes('acc') || t.includes('accessoire')) return 'Accessoire'
  if (t === 'pv' || t.includes('photovolt')) return 'PV'
  return 'Autres'
}

function emptyByMacro() {
  return Object.fromEntries(FAMILY_MACROS.map((m) => [m, 0])) as Record<string, number>
}

function ratio(num: number, den: number) {
  if (!den) return null
  return (num / den) * 100
}

async function fetchAll(table: string, select = '*', apply?: (query: any) => any) {
  const output: Record<string, any>[] = []
  const chunkSize = 1000
  let from = 0
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + chunkSize - 1)
    if (apply) query = apply(query)
    const { data, error } = await query
    if (error) throw new Error(`${table} : ${error.message}`)
    const rows = (data || []) as Record<string, any>[]
    output.push(...rows)
    if (rows.length < chunkSize) break
    from += chunkSize
  }
  return output
}

function chunk<T>(values: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

async function fetchAggForTiers(table: string, codes: string[], y0: number, y1: number) {
  const rows: Record<string, any>[] = []
  for (const group of chunk(codes, 200)) {
    const part = await fetchAll(table, '*', (q) => q.gte('annee', y0).lte('annee', y1).in('numero_tiers', group))
    rows.push(...part)
  }
  return rows.map(normalizeAgg)
}

async function fetchObjectivesForTiers(codes: string[], annee: number) {
  const rows: ObjectiveRow[] = []
  for (const group of chunk(codes, 200)) {
    const part = await fetchAll('objectif_tiers', '*', (q) => q.eq('annee', annee).in('numero_tiers', group))
    rows.push(...(part as ObjectiveRow[]))
  }
  return rows
}

function normalizeAgg(row: Record<string, any>): AggRow {
  return {
    annee: safeNumber(row.annee),
    mois: safeNumber(row.mois),
    numero_tiers: safeText(row.numero_tiers || row.numero || row.code_tiers, 'NON RENSEIGNE'),
    intitule_tiers: safeText(row.intitule_tiers || row.intitule || row.tiers, 'NON RENSEIGNE'),
    collaborateur: safeText(row.collaborateur, 'NON AFFECTE'),
    agence_collaborateur: safeText(row.agence_collaborateur || row.agence, 'NON AFFECTE'),
    famille_macro: macroBucket(row.famille_macro),
    ca_ht: safeNumber(row.ca_ht || row.montant_ht || row.ca),
    marge_valeur: safeNumber(row.marge_valeur || row.marge),
    nb_lignes: safeNumber(row.nb_lignes || row.nombre_lignes),
  }
}

function normalizeTiers(row: Record<string, any>, nafByCode: Map<string, string>): TiersRow {
  const codeNaf = safeText(raw(row, ['code_naf', 'naf']))
  return {
    numero: safeText(raw(row, ['numero', 'numero_tiers', 'code_tiers']), 'SANS CODE'),
    intitule: safeText(raw(row, ['intitule', 'intitule_tiers', 'raison_sociale', 'tiers']), 'SANS INTITULE'),
    codePostal: safeText(raw(row, ['code_postal', 'cp'])),
    codeNaf,
    libelleNaf: nafByCode.get(normalize(codeNaf)) || safeText(raw(row, ['libelle_naf', 'designation_naf', 'famille']), 'NA'),
    dateCreation: formatDateFr(raw(row, ['date_creation', 'creation_date', 'created_at'])),
    prospect: safeBool(raw(row, ['prospect', 'is_prospect'])),
    collaborateur: safeText(raw(row, ['collaborateur', 'representant', 'commercial', 'vendeur']), 'NON AFFECTE'),
    agence: safeText(raw(row, ['agence_rattachement', 'agence', 'depot_rattachement', 'depot']), 'NON AFFECTE'),
    raw: row,
  }
}

function objectiveNumber(map: Map<string, ObjectiveRow>, numero: string, domaine: string, rubrique: string) {
  const row = map.get(objectiveKey(numero, N, domaine, rubrique))
  return safeNumber(row?.valeur_number ?? row?.valeur_text)
}

function objectiveText(map: Map<string, ObjectiveRow>, numero: string, domaine: string, rubrique: string) {
  const row = map.get(objectiveKey(numero, N, domaine, rubrique))
  return safeText(row?.valeur_text ?? row?.valeur_number ?? row?.valeur_date)
}

function objectiveDate(map: Map<string, ObjectiveRow>, numero: string, domaine: string, rubrique: string) {
  const row = map.get(objectiveKey(numero, N, domaine, rubrique))
  return normalizeDateForInput(row?.valeur_date ?? row?.valeur_text)
}

function sumAmount(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number; macro?: string }) {
  return rows.reduce((sum, row) => {
    if (numero && normalize(row.numero_tiers) !== normalize(numero)) return sum
    if (row.annee !== year) return sum
    if (opts?.month && row.mois !== opts.month) return sum
    if (opts?.monthMax && row.mois > opts.monthMax) return sum
    if (opts?.macro && row.famille_macro !== opts.macro) return sum
    return sum + row.ca_ht
  }, 0)
}

function sumMarge(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number; macro?: string }) {
  return rows.reduce((sum, row) => {
    if (numero && normalize(row.numero_tiers) !== normalize(numero)) return sum
    if (row.annee !== year) return sum
    if (opts?.month && row.mois !== opts.month) return sum
    if (opts?.monthMax && row.mois > opts.monthMax) return sum
    if (opts?.macro && row.famille_macro !== opts.macro) return sum
    return sum + row.marge_valeur
  }, 0)
}

function byMacro(rows: AggRow[], numero: string | null, year: number, opts?: { month?: number; monthMax?: number; metric?: 'ca' | 'marge' }) {
  const out = emptyByMacro()
  for (const macro of FAMILY_MACROS) {
    out[macro] = opts?.metric === 'marge'
      ? sumMarge(rows, numero, year, { month: opts?.month, monthMax: opts?.monthMax, macro })
      : sumAmount(rows, numero, year, { month: opts?.month, monthMax: opts?.monthMax, macro })
  }
  return out
}

function buildSummaryForNumero(tier: TiersRow | null, factures: AggRow[], devis: AggRow[], objectives: Map<string, ObjectiveRow>, month?: number): SummaryRow {
  const numero = tier?.numero || ''
  const monthFilter = month ? { month } : undefined
  const caN1 = sumAmount(factures, numero || null, N - 1, monthFilter)
  const margeN1 = sumMarge(factures, numero || null, N - 1, monthFilter)
  const caYtdN = sumAmount(factures, numero || null, N, month ? { month } : { monthMax: CLOSED_MONTH })
  const margeYtdN = sumMarge(factures, numero || null, N, month ? { month } : { monthMax: CLOSED_MONTH })
  const caYtdN1 = sumAmount(factures, numero || null, N - 1, month ? { month } : { monthMax: CLOSED_MONTH })
  const margeYtdN1 = sumMarge(factures, numero || null, N - 1, month ? { month } : { monthMax: CLOSED_MONTH })
  const objectifCa = objectiveNumber(objectives, numero, 'Objectif', 'CA')
  const objectifProrata = month ? objectifCa / 12 : (objectifCa / 12) * CLOSED_MONTH
  const frequenceCommande = objectiveNumber(objectives, numero, 'QRC', 'Fréquence commande')
  const niveauExclusivite = objectiveNumber(objectives, numero, 'QRC', 'Niveau exclusivité')
  const comNotreFaveur = objectiveNumber(objectives, numero, 'QRC', 'Com en notre faveur')
  const garantie = objectiveNumber(objectives, numero, 'QRC', 'Garantie')
  const visiteRealise = VISITES.reduce((count, rubrique) => count + (objectiveDate(objectives, numero, 'Visite', rubrique) ? 1 : 0), 0)

  return {
    id: month ? `${numero}-m${month}` : numero || 'TOTAL',
    kind: month ? 'month' : tier ? 'client' : 'total',
    level: month ? 1 : 0,
    numero: tier?.numero || 'TOTAL',
    intitule: tier?.intitule || '',
    totalMois: month ? MONTHS[month - 1] : 'TOTAL',
    codePostal: tier?.codePostal || '',
    libelleNaf: tier?.libelleNaf || '',
    dateCreation: tier?.dateCreation || '',
    prospectLabel: tier?.prospect === true ? 'OUI' : tier?.prospect === false ? 'NON' : 'NA',
    caN3: sumAmount(factures, numero || null, N - 3, monthFilter),
    caN2: sumAmount(factures, numero || null, N - 2, monthFilter),
    devisN1: sumAmount(devis, numero || null, N - 1, monthFilter),
    devisN1ByMacro: byMacro(devis, numero || null, N - 1, { month, metric: 'ca' }),
    caN1,
    caN1ByMacro: byMacro(factures, numero || null, N - 1, { month, metric: 'ca' }),
    margePctN1: caN1 ? (margeN1 / caN1) * 100 : null,
    margeN1ByMacro: byMacro(factures, numero || null, N - 1, { month, metric: 'marge' }),
    objectifCa,
    potentiel: objectiveNumber(objectives, numero, 'Objectif', 'POTENTIEL'),
    devisYtdN: sumAmount(devis, numero || null, N, month ? { month } : { monthMax: CLOSED_MONTH }),
    devisYtdNByMacro: byMacro(devis, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'ca' }),
    caYtdN,
    caYtdNByMacro: byMacro(factures, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'ca' }),
    margePctYtdN: caYtdN ? (margeYtdN / caYtdN) * 100 : null,
    margeYtdNByMacro: byMacro(factures, numero || null, N, { month, monthMax: month ? undefined : CLOSED_MONTH, metric: 'marge' }),
    contratBfa: objectiveNumber(objectives, numero, 'Objectif', 'Contrat\nBFA'),
    caVsN1: ratio(caYtdN, caYtdN1),
    margeVsN1: ratio(margeYtdN, margeYtdN1),
    realiseObjectif: ratio(caYtdN, objectifProrata),
    qrcN1: objectiveNumber(objectives, numero, 'QRC', `QRC ${N - 1}`) || objectiveNumber(objectives, numero, 'QRC', 'QRC N-1'),
    frequenceCommande,
    niveauExclusivite,
    comNotreFaveur,
    garantie,
    qrcN: frequenceCommande + niveauExclusivite + comNotreFaveur + garantie,
    visiteTheorique: objectiveNumber(objectives, numero, 'Visite', 'Théorique'),
    visiteRealise,
  }
}

function buildColumns(showFamilies: boolean): ColumnDef[] {
  const cols: ColumnDef[] = [
    { key: 'numero', label: 'Code Client', group: 'Client', width: 86, sticky: 'code', value: (r) => r.numero, format: 'text' },
    { key: 'intitule', label: 'Intitulé Client', group: 'Client', width: 210, sticky: 'label', value: (r) => r.intitule, format: 'text' },
    { key: 'totalMois', label: 'Total / Mois', group: 'Client', width: 105, sticky: 'month', value: (r) => r.totalMois, format: 'text' },
    { key: 'codePostal', label: 'Code postal', group: 'Client', width: 82, value: (r) => r.codePostal, format: 'text' },
    { key: 'libelleNaf', label: 'Désignation Naf', group: 'Client', width: 130, value: (r) => r.libelleNaf, format: 'text' },
    { key: 'dateCreation', label: 'Date Création', group: 'Client', width: 95, value: (r) => r.dateCreation, format: 'date' },
    { key: 'prospectLabel', label: 'Prospect OUI/NON', group: 'Client', width: 86, value: (r) => r.prospectLabel, format: 'text' },
    { key: 'remarque', label: 'Remarque', group: 'Client', width: 310, value: (r) => r.numero, editable: { domaine: 'Remarque', rubrique: 'Remarque', type: 'texte' }, format: 'text' },
    { key: 'caN3', label: `CA ${N - 3}`, group: 'CA / Objectifs', width: 92, className: 'metric previous', value: (r) => r.caN3, format: 'keur' },
    { key: 'caN2', label: `CA ${N - 2}`, group: 'CA / Objectifs', width: 92, className: 'metric previous', value: (r) => r.caN2, format: 'keur' },
    { key: 'devisN1', label: `DEVIS ${N - 1}`, group: 'CA / Objectifs', width: 98, className: 'metric devis', value: (r) => r.devisN1, format: 'keur' },
  ]

  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `devisN1_${macro}`, label: `Dont ${macro}`, group: `Devis ${N - 1}`, width: 78, rotate: true, value: (r) => r.devisN1ByMacro[macro], format: 'keur' }))
  }

  cols.push({ key: 'caN1', label: `CA ${N - 1}`, group: 'CA / Objectifs', width: 98, className: 'metric ca', value: (r) => r.caN1, format: 'keur' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `caN1_${macro}`, label: `Dont ${macro}`, group: `CA ${N - 1}`, width: 78, rotate: true, value: (r) => r.caN1ByMacro[macro], format: 'keur' }))
  }
  cols.push({ key: 'margePctN1', label: `MARGE ${N - 1}`, group: 'CA / Objectifs', width: 92, className: 'metric margin', value: (r) => r.margePctN1, format: 'pct' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `margeN1_${macro}`, label: `Dont ${macro}`, group: `Marge ${N - 1}`, width: 78, rotate: true, value: (r) => r.margeN1ByMacro[macro], format: 'keur' }))
  }

  cols.push(
    { key: 'objectifCa', label: `OBJECTIF ${N}`, group: 'CA / Objectifs', width: 104, className: 'editableNumber', value: (r) => r.objectifCa, editable: { domaine: 'Objectif', rubrique: 'CA', type: 'montant' }, format: 'keur' },
    { key: 'potentiel', label: 'POTENTIEL', group: 'CA / Objectifs', width: 98, className: 'editableNumber', value: (r) => r.potentiel, editable: { domaine: 'Objectif', rubrique: 'POTENTIEL', type: 'montant' }, format: 'keur' },
    { key: 'devisYtdN', label: `DEVIS ${String(CLOSED_MONTH).padStart(2, '0')}-${N}`, group: 'CA / Objectifs', width: 108, className: 'metric devis redLabel', value: (r) => r.devisYtdN, format: 'keur' },
  )
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `devisYtdN_${macro}`, label: `Dont ${macro}`, group: `Devis ${N}`, width: 78, rotate: true, value: (r) => r.devisYtdNByMacro[macro], format: 'keur' }))
  }
  cols.push({ key: 'caYtdN', label: `CA RÉEL ${N}`, group: 'CA / Objectifs', width: 108, className: 'metric ca redLabel', value: (r) => r.caYtdN, format: 'keur' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `caYtdN_${macro}`, label: `Dont ${macro}`, group: `CA ${N}`, width: 78, rotate: true, value: (r) => r.caYtdNByMacro[macro], format: 'keur' }))
  }
  cols.push({ key: 'margePctYtdN', label: `MARGE RÉEL ${N}`, group: 'CA / Objectifs', width: 110, className: 'metric margin redLabel', value: (r) => r.margePctYtdN, format: 'pct' })
  if (showFamilies) {
    FAMILY_MACROS.forEach((macro) => cols.push({ key: `margeYtdN_${macro}`, label: `Dont ${macro}`, group: `Marge ${N}`, width: 78, rotate: true, value: (r) => r.margeYtdNByMacro[macro], format: 'keur' }))
  }

  cols.push(
    { key: 'contratBfa', label: 'Contrat BFA', group: 'Objectif', width: 96, className: 'editableNumber', value: (r) => r.contratBfa, editable: { domaine: 'Objectif', rubrique: 'Contrat\nBFA', type: 'montant' }, format: 'keur' },
    { key: 'caVsN1', label: `CA Réalisé / ${N - 1}`, group: 'Comparatif', width: 86, rotate: true, value: (r) => r.caVsN1, format: 'pct' },
    { key: 'margeVsN1', label: `Marge / ${N - 1}`, group: 'Comparatif', width: 86, rotate: true, value: (r) => r.margeVsN1, format: 'pct' },
    { key: 'realiseObjectif', label: 'Réalisé / Objectif', group: 'Comparatif', width: 86, rotate: true, value: (r) => r.realiseObjectif, format: 'pct' },
    { key: 'qrcN1', label: `QRC ${N - 1}`, group: 'QRC', width: 70, rotate: true, value: (r) => r.qrcN1, editable: { domaine: 'QRC', rubrique: `QRC ${N - 1}`, type: 'nombre' }, format: 'number' },
    { key: 'frequenceCommande', label: 'Fréquence commande', group: 'QRC', width: 76, rotate: true, value: (r) => r.frequenceCommande, editable: { domaine: 'QRC', rubrique: 'Fréquence commande', type: 'nombre' }, format: 'number' },
    { key: 'niveauExclusivite', label: 'Niveau exclusivité', group: 'QRC', width: 76, rotate: true, value: (r) => r.niveauExclusivite, editable: { domaine: 'QRC', rubrique: 'Niveau exclusivité', type: 'nombre' }, format: 'number' },
    { key: 'comNotreFaveur', label: 'Com en notre faveur', group: 'QRC', width: 76, rotate: true, value: (r) => r.comNotreFaveur, editable: { domaine: 'QRC', rubrique: 'Com en notre faveur', type: 'nombre' }, format: 'number' },
    { key: 'garantie', label: 'Garantie', group: 'QRC', width: 76, rotate: true, value: (r) => r.garantie, editable: { domaine: 'QRC', rubrique: 'Garantie', type: 'nombre' }, format: 'number' },
    { key: 'qrcN', label: `QRC ${N}`, group: 'QRC', width: 70, rotate: true, className: 'redLabel', value: (r) => r.qrcN, format: 'number' },
  )

  ACTIONS.forEach((rubrique) => cols.push({
    key: `action_${rubrique}`,
    label: rubrique,
    group: 'Dynamisme Client',
    width: 76,
    rotate: true,
    editable: { domaine: 'Initiative', rubrique, type: 'action' },
    value: (r) => r.numero,
    format: 'action',
  }))

  cols.push(
    { key: 'visiteTheorique', label: 'Théorique', group: 'Fréquence visite', width: 76, rotate: true, value: (r) => r.visiteTheorique, editable: { domaine: 'Visite', rubrique: 'Théorique', type: 'nombre' }, format: 'number' },
    { key: 'visiteRealise', label: 'Réalisé', group: 'Fréquence visite', width: 76, rotate: true, className: 'redLabel', value: (r) => r.visiteRealise, format: 'number' },
  )

  VISITES.forEach((rubrique) => cols.push({
    key: `visite_${rubrique}`,
    label: rubrique,
    group: 'Visite',
    width: 82,
    rotate: true,
    editable: { domaine: 'Visite', rubrique, type: 'date' },
    value: (r) => r.numero,
    format: 'date',
  }))

  return cols
}

function displayValue(col: ColumnDef, row: SummaryRow, objectiveMap: Map<string, ObjectiveRow>) {
  if (col.editable && row.kind === 'client') {
    const { domaine, rubrique, type } = col.editable
    if (type === 'date') return formatDateFr(objectiveDate(objectiveMap, row.numero, domaine, rubrique))
    if (type === 'texte') return objectiveText(objectiveMap, row.numero, domaine, rubrique)
    const n = objectiveNumber(objectiveMap, row.numero, domaine, rubrique)
    if (type === 'montant') return formatKEur(n)
    return n ? formatNumber(n) : ''
  }

  const value = col.value(row)
  if (col.format === 'keur') return formatKEur(safeNumber(value))
  if (col.format === 'pct') return formatPct(value as number | null)
  if (col.format === 'number') return formatNumber(safeNumber(value))
  return safeText(value)
}

function rawSortableValue(col: ColumnDef, row: SummaryRow, objectiveMap: Map<string, ObjectiveRow>) {
  if (col.editable && row.kind === 'client') {
    if (col.editable.type === 'texte' || col.editable.type === 'date') return displayValue(col, row, objectiveMap)
    return objectiveNumber(objectiveMap, row.numero, col.editable.domaine, col.editable.rubrique)
  }
  return col.value(row)
}

function editableRawValue(row: SummaryRow, col: ColumnDef, objectiveMap: Map<string, ObjectiveRow>) {
  if (!col.editable) return ''
  const { domaine, rubrique, type } = col.editable
  if (type === 'date') return objectiveDate(objectiveMap, row.numero, domaine, rubrique)
  if (type === 'texte') return objectiveText(objectiveMap, row.numero, domaine, rubrique)
  const value = objectiveNumber(objectiveMap, row.numero, domaine, rubrique)
  return value ? String(value) : ''
}

export default function SyntheseMultiClientsPage() {
  const [mode, setMode] = useState<ModeSelection>('collaborateur')
  const [selected, setSelected] = useState('')
  const [tiers, setTiers] = useState<TiersRow[]>([])
  const [collaborateurs, setCollaborateurs] = useState<CollaborateurRow[]>([])
  const [factures, setFactures] = useState<AggRow[]>([])
  const [devis, setDevis] = useState<AggRow[]>([])
  const [objectiveRows, setObjectiveRows] = useState<ObjectiveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFamilies, setShowFamilies] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>({ key: 'caN1', direction: 'desc' })
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const objectiveMap = useMemo(() => {
    const map = new Map<string, ObjectiveRow>()
    objectiveRows.forEach((row) => map.set(objectiveKey(row.numero_tiers, row.annee, row.domaine, row.rubrique), row))
    return map
  }, [objectiveRows])

  const columns = useMemo(() => buildColumns(showFamilies), [showFamilies])

  useEffect(() => {
    let alive = true
    async function init() {
      setLoading(true)
      setError(null)
      try {
        const [nafRows, rawCollaborateurs, rawTiers] = await Promise.all([
          fetchAll('ref_code_naf', '*'),
          fetchAll('ref_collaborateurs', '*'),
          fetchAll('ref_tiers', '*'),
        ])

        const nafByCode = new Map<string, string>()
        nafRows.forEach((row) => {
          const code = normalize(raw(row, ['code_naf', 'code']))
          if (code) nafByCode.set(code, safeText(raw(row, ['libelle_naf', 'contenu_correspondance', 'designation', 'libelle']), 'NA'))
        })

        const normalizedCollaborateurs = rawCollaborateurs.map((row) => ({
          nom: safeText(raw(row, ['nom', 'collaborateur', 'representant']), 'NON AFFECTE'),
          agence: safeText(raw(row, ['agence', 'agence_collaborateur', 'depot']), 'NON AFFECTE'),
        }))

        const normalizedTiers = rawTiers.map((row) => normalizeTiers(row, nafByCode))
        if (!alive) return
        setCollaborateurs(normalizedCollaborateurs)
        setTiers(normalizedTiers)

        const options = getSelectionOptions('collaborateur', normalizedTiers, normalizedCollaborateurs)
        setSelected((current) => current || options[0] || '')
      } catch (err: any) {
        if (alive) setError(err?.message || 'Erreur de chargement des référentiels')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void init()
    return () => { alive = false }
  }, [])

  const selectionOptions = useMemo(() => getSelectionOptions(mode, tiers, collaborateurs), [mode, tiers, collaborateurs])

  useEffect(() => {
    if (!selectionOptions.length) return
    if (!selected || !selectionOptions.includes(selected)) setSelected(selectionOptions[0])
  }, [selectionOptions, selected])

  const selectedTiers = useMemo(() => {
    if (!selected) return []
    if (mode === 'collaborateur') {
      return tiers.filter((t) => normalize(t.collaborateur) === normalize(selected))
    }
    const collabsForAgence = new Set(
      collaborateurs
        .filter((c) => normalize(c.agence) === normalize(selected))
        .map((c) => normalize(c.nom))
    )
    return tiers.filter((t) => normalize(t.agence) === normalize(selected) || collabsForAgence.has(normalize(t.collaborateur)))
  }, [mode, selected, tiers, collaborateurs])

  useEffect(() => {
    let alive = true
    async function loadBusinessData() {
      const codes = selectedTiers.map((t) => t.numero).filter(Boolean)
      if (!codes.length) {
        setFactures([])
        setDevis([])
        setObjectiveRows([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const [facturesRows, devisRows, objectives] = await Promise.all([
          fetchAggForTiers('indicateur_factures_mensuel', codes, N - 3, N),
          fetchAggForTiers('indicateur_devis_mensuel', codes, N - 1, N),
          fetchObjectivesForTiers(codes, N),
        ])
        if (!alive) return
        setFactures(facturesRows)
        setDevis(devisRows)
        setObjectiveRows(objectives)
      } catch (err: any) {
        if (alive) setError(err?.message || 'Erreur de chargement des données activité / objectifs')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void loadBusinessData()
    return () => { alive = false }
  }, [selectedTiers])

  const baseClientRows = useMemo(() => selectedTiers.map((t) => buildSummaryForNumero(t, factures, devis, objectiveMap)), [selectedTiers, factures, devis, objectiveMap])
  const totalRow = useMemo(() => {
    const base = buildSummaryForNumero(null, factures, devis, objectiveMap)
    base.objectifCa = baseClientRows.reduce((s, r) => s + r.objectifCa, 0)
    base.potentiel = baseClientRows.reduce((s, r) => s + r.potentiel, 0)
    base.contratBfa = baseClientRows.reduce((s, r) => s + r.contratBfa, 0)
    base.qrcN1 = baseClientRows.reduce((s, r) => s + r.qrcN1, 0)
    base.frequenceCommande = baseClientRows.reduce((s, r) => s + r.frequenceCommande, 0)
    base.niveauExclusivite = baseClientRows.reduce((s, r) => s + r.niveauExclusivite, 0)
    base.comNotreFaveur = baseClientRows.reduce((s, r) => s + r.comNotreFaveur, 0)
    base.garantie = baseClientRows.reduce((s, r) => s + r.garantie, 0)
    base.qrcN = base.frequenceCommande + base.niveauExclusivite + base.comNotreFaveur + base.garantie
    base.visiteTheorique = baseClientRows.reduce((s, r) => s + r.visiteTheorique, 0)
    base.visiteRealise = baseClientRows.reduce((s, r) => s + r.visiteRealise, 0)
    base.realiseObjectif = ratio(base.caYtdN, (base.objectifCa / 12) * CLOSED_MONTH)
    return base
  }, [factures, devis, objectiveMap, baseClientRows])

  const visibleRows = useMemo(() => {
    const sortCol = columns.find((c) => c.key === sort.key) || columns.find((c) => c.key === 'caN1')!
    let rows = baseClientRows.filter((row) => {
      return Object.entries(filters).every(([key, value]) => {
        if (!String(value).trim()) return true
        const col = columns.find((c) => c.key === key)
        if (!col) return true
        return loose(displayValue(col, row, objectiveMap)).includes(loose(String(value)))
      })
    })

    rows = [...rows].sort((a, b) => {
      const av = rawSortableValue(sortCol, a, objectiveMap)
      const bv = rawSortableValue(sortCol, b, objectiveMap)
      const an = typeof av === 'number' ? av : Number(av)
      const bn = typeof bv === 'number' ? bv : Number(bv)
      let cmp = 0
      if (Number.isFinite(an) && Number.isFinite(bn)) cmp = an - bn
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'fr')
      return sort.direction === 'asc' ? cmp : -cmp
    })

    const out: SummaryRow[] = [totalRow]
    rows.forEach((row) => {
      out.push(row)
      if (expanded.has(row.numero)) {
        for (let month = 1; month <= 12; month += 1) {
          const tier = selectedTiers.find((t) => t.numero === row.numero)
          if (tier) out.push(buildSummaryForNumero(tier, factures, devis, objectiveMap, month))
        }
      }
    })
    return out
  }, [baseClientRows, filters, sort, columns, objectiveMap, totalRow, expanded, selectedTiers, factures, devis])

  function getFilterValue(key: string) {
    return filters[key] || ''
  }

  function updateFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function toggleSort(key: string) {
    setSort((prev) => prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' })
  }

  function toggleExpanded(numero: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(numero)) next.delete(numero)
      else next.add(numero)
      return next
    })
  }

  async function saveObjective(numero: string, editable: NonNullable<ColumnDef['editable']>, rawValue: string) {
    if (!numero || numero === 'TOTAL') return
    const key = objectiveKey(numero, N, editable.domaine, editable.rubrique)
    setSavingKey(key)
    const value = rawValue.trim()
    const payload: Record<string, any> = {
      numero_tiers: numero,
      annee: N,
      domaine: editable.domaine,
      rubrique: editable.rubrique,
      valeur_type: editable.type,
      valeur_text: null,
      valeur_number: null,
      valeur_date: null,
    }

    if (editable.type === 'date') payload.valeur_date = value || null
    else if (editable.type === 'texte') payload.valeur_text = value || null
    else payload.valeur_number = value === '' ? null : safeNumber(value)

    const { data, error } = await supabase
      .from('objectif_tiers')
      .upsert(payload, { onConflict: 'numero_tiers,annee,domaine,rubrique' })
      .select('*')
      .single()

    setSavingKey(null)
    if (error) {
      setError(`Sauvegarde impossible : ${error.message}`)
      return
    }
    setObjectiveRows((prev) => {
      const next = prev.filter((r) => objectiveKey(r.numero_tiers, r.annee, r.domaine, r.rubrique) !== key)
      next.push(data as ObjectiveRow)
      return next
    })
  }

  async function exportExcel() {
    // @ts-ignore - xlsx-js-style est déjà présent dans le projet mais n'a pas toujours les types TS.
    const XLSX = await import('xlsx-js-style')
    const exportColumns = columns
    const aoa = [
      exportColumns.map((c) => c.group),
      exportColumns.map((c) => c.label.replace(/\n/g, ' ')),
      ...visibleRows.map((row) => exportColumns.map((col) => displayValue(col, row, objectiveMap))),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (!ws[addr]) continue
        ws[addr].s = {
          font: { bold: r <= 1 || r === 2, sz: r <= 1 ? 10 : 9 },
          alignment: { horizontal: r <= 1 ? 'center' : 'left', vertical: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: '111111' } },
            bottom: { style: 'thin', color: { rgb: '111111' } },
            left: { style: 'thin', color: { rgb: '111111' } },
            right: { style: 'thin', color: { rgb: '111111' } },
          },
          fill: r === 0 ? { fgColor: { rgb: 'FFF7DF' } } : r === 1 ? { fgColor: { rgb: 'F5F5F5' } } : r === 2 ? { fgColor: { rgb: 'E2F0D9' } } : undefined,
        }
      }
    }
    ws['!cols'] = exportColumns.map((c) => ({ wch: Math.max(7, Math.min(32, Math.round(c.width / 8))) }))
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: Math.max(1, range.e.r), c: range.e.c } }) }
    ws['!freeze'] = { xSplit: 3, ySplit: 2, topLeftCell: 'D3', activePane: 'bottomRight', state: 'frozen' }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Synthèse multi-clients')
    XLSX.writeFile(wb, `synthese_multi_clients_${mode}_${selected || 'selection'}_${N}.xlsx`)
  }

  return (
    <main className="page">
      <section className="toolbar">
        <div>
          <h1>Synthèse multi-clients</h1>
          <p>Vue dense par collaborateur ou agence · N = {N} · période réalisée arrêtée à {String(CLOSED_MONTH).padStart(2, '0')}/{N}</p>
        </div>
        <div className="toolbarActions">
          <label>
            Sélection
            <select value={mode} onChange={(e) => { setMode(e.target.value as ModeSelection); setExpanded(new Set()) }}>
              <option value="collaborateur">Collaborateur</option>
              <option value="agence">Agence</option>
            </select>
          </label>
          <label>
            {mode === 'collaborateur' ? 'Collaborateur' : 'Agence'}
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setExpanded(new Set()) }}>
              {selectionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setShowFamilies((v) => !v)}>
            {showFamilies ? 'Masquer familles macro' : 'Afficher familles macro'}
          </button>
          <button type="button" onClick={exportExcel}>Exporter Excel</button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Chargement…</div>}

      <section className="kpis">
        <div><span>Tiers</span><strong>{selectedTiers.length}</strong></div>
        <div><span>CA {N - 1}</span><strong>{formatKEur(totalRow.caN1)}</strong></div>
        <div><span>CA réel {N}</span><strong>{formatKEur(totalRow.caYtdN)}</strong></div>
        <div><span>Marge réel {N}</span><strong>{formatPct(totalRow.margePctYtdN)}</strong></div>
        <div><span>Réalisé / objectif</span><strong>{formatPct(totalRow.realiseObjectif)}</strong></div>
      </section>

      <div className="tableShell">
        <table className="synthTable">
          <thead>
            <tr className="groupRow">
              {columns.map((col) => <th key={`${col.key}-g`} className={`group ${groupClass(col.group)} ${stickyClass(col.sticky)}`} style={{ width: col.width, minWidth: col.width }}>{col.group}</th>)}
            </tr>
            <tr className="headerRow">
              {columns.map((col) => (
                <th key={col.key} className={`${col.className || ''} ${stickyClass(col.sticky)} ${col.rotate ? 'rotate' : ''}`} style={{ width: col.width, minWidth: col.width }} onClick={() => toggleSort(col.key)} title="Cliquer pour trier">
                  <span>{col.label}</span>
                  {sort.key === col.key ? <b>{sort.direction === 'asc' ? '▲' : '▼'}</b> : null}
                </th>
              ))}
            </tr>
            <tr className="filterRow">
              {columns.map((col) => (
                <th key={`${col.key}-f`} className={stickyClass(col.sticky)} style={{ width: col.width, minWidth: col.width }}>
                  {['numero', 'intitule', 'totalMois', 'codePostal', 'libelleNaf', 'prospectLabel'].includes(col.key) ? (
                    <input value={getFilterValue(col.key)} onChange={(e) => updateFilter(col.key, e.target.value)} placeholder="filtre" />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className={`${row.kind} ${row.level ? 'child' : ''}`}>
                {columns.map((col, index) => {
                  const canEdit = row.kind === 'client' && Boolean(col.editable)
                  const saveKey = col.editable ? objectiveKey(row.numero, N, col.editable.domaine, col.editable.rubrique) : ''
                  return (
                    <td key={`${row.id}-${col.key}`} className={`${col.className || ''} ${stickyClass(col.sticky)} ${index >= 8 ? 'num' : ''}`} style={{ width: col.width, minWidth: col.width }}>
                      {col.key === 'numero' && row.kind === 'client' ? (
                        <button type="button" className="expandBtn" onClick={() => toggleExpanded(row.numero)}>{expanded.has(row.numero) ? '−' : '+'}</button>
                      ) : null}
                      {canEdit ? (
                        <EditableCell
                          type={col.editable!.type}
                          value={editableRawValue(row, col, objectiveMap)}
                          saving={savingKey === saveKey}
                          onSave={(value) => saveObjective(row.numero, col.editable!, value)}
                        />
                      ) : (
                        <span>{displayValue(col, row, objectiveMap)}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .page { padding: 18px; background: #f6f8fb; min-height: 100vh; color: #0f172a; }
        .toolbar { display: flex; gap: 18px; justify-content: space-between; align-items: end; margin-bottom: 12px; }
        h1 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.02em; }
        p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
        .toolbarActions { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; justify-content: flex-end; }
        label { font-size: 11px; font-weight: 800; color: #475569; display: flex; flex-direction: column; gap: 3px; text-transform: uppercase; }
        select, button, input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; background: white; font-size: 12px; }
        button { cursor: pointer; font-weight: 800; background: #0f172a; color: white; border-color: #0f172a; }
        .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 10px; margin-bottom: 10px; font-weight: 700; }
        .loading { position: fixed; right: 18px; bottom: 18px; background: #0f172a; color: white; padding: 8px 12px; border-radius: 999px; z-index: 20; font-weight: 900; }
        .kpis { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }
        .kpis div { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
        .kpis span { display: block; color: #64748b; font-size: 11px; font-weight: 900; text-transform: uppercase; }
        .kpis strong { display: block; margin-top: 2px; font-size: 18px; font-weight: 950; }
        .tableShell { overflow: auto; height: calc(100vh - 210px); border: 2px solid #0f172a; background: white; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
        .synthTable { border-collapse: separate; border-spacing: 0; font-size: 11px; table-layout: fixed; }
        th, td { border-right: 1px solid #111827; border-bottom: 1px solid #111827; padding: 2px 4px; height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #fffdf3; }
        thead th { position: sticky; top: 0; z-index: 5; background: #f8fafc; text-align: center; font-weight: 950; }
        .groupRow th { top: 0; height: 24px; font-size: 11px; background: #fff7df; border-top: 2px solid #111827; }
        .headerRow th { top: 25px; height: 108px; vertical-align: bottom; background: #f8fafc; }
        .filterRow th { top: 134px; height: 25px; background: #f8fafc; padding: 1px; }
        .filterRow input { width: 95%; height: 19px; padding: 1px 3px; font-size: 10px; border-radius: 3px; }
        .rotate span { writing-mode: vertical-rl; transform: rotate(180deg); display: inline-block; max-height: 96px; }
        .client, .stickyCode, .stickyLabel, .stickyMonth { background: #e2f0d9; }
        .stickyCode { position: sticky; left: 0; z-index: 4; }
        .stickyLabel { position: sticky; left: 86px; z-index: 4; }
        .stickyMonth { position: sticky; left: 296px; z-index: 4; border-right: 3px solid #111827; }
        thead .stickyCode, thead .stickyLabel, thead .stickyMonth { z-index: 8; }
        tbody tr.total td { background: #fff2cc; font-weight: 950; }
        tbody tr.client td { background: #e2f0d9; }
        tbody tr.month td { background: #edf7e7; font-style: italic; }
        td.num { text-align: right; }
        .metric { background: #fff7e6; }
        .devis { border-left: 3px solid #ffbf00; }
        .ca { border-left: 3px solid #111827; }
        .margin { border-left: 3px solid #111827; }
        .redLabel, .redLabel span { color: #e60000; font-weight: 950; }
        .groupComparatif, .groupComparatif { background: #f3e8ff !important; }
        .groupQRC { background: #e9f7e6 !important; }
        .groupDynamismeClient { background: #eff6ff !important; }
        .groupFréquencevisite, .groupVisite { background: #fff7ed !important; }
        .expandBtn { padding: 0; margin-right: 3px; width: 17px; height: 17px; border-radius: 4px; font-size: 11px; line-height: 12px; display: inline-flex; align-items: center; justify-content: center; }
        .editInput, .editSelect { width: 100%; height: 20px; padding: 1px 3px; border-radius: 3px; font-size: 11px; background: #ffffff; }
        .saving { opacity: .55; }
      `}</style>
    </main>
  )
}

function getSelectionOptions(mode: ModeSelection, tiers: TiersRow[], collaborateurs: CollaborateurRow[]) {
  if (mode === 'collaborateur') {
    return Array.from(new Set(tiers.map((t) => t.collaborateur).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
  }
  return Array.from(new Set([
    ...tiers.map((t) => t.agence),
    ...collaborateurs.map((c) => c.agence),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
}

function stickyClass(sticky?: ColumnDef['sticky']) {
  if (sticky === 'code') return 'stickyCode'
  if (sticky === 'label') return 'stickyLabel'
  if (sticky === 'month') return 'stickyMonth'
  return ''
}

function groupClass(group: string) {
  return `group${group.replace(/[^A-Za-zÀ-ÿ0-9]/g, '')}`
}

function EditableCell({ type, value, saving, onSave }: { type: ObjectiveType; value: string; saving: boolean; onSave: (value: string) => void }) {
  const [local, setLocal] = useState(value)

  useEffect(() => { setLocal(value) }, [value])

  if (type === 'action') {
    return (
      <select className={`editSelect ${saving ? 'saving' : ''}`} value={local} onChange={(e) => { setLocal(e.target.value); onSave(e.target.value) }}>
        <option value=""></option>
        <option value="0">0</option>
        <option value="1">1</option>
        <option value="2">2</option>
      </select>
    )
  }

  return (
    <input
      className={`editInput ${saving ? 'saving' : ''}`}
      type={type === 'date' ? 'date' : type === 'texte' ? 'text' : 'number'}
      step={type === 'montant' ? '100' : '1'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onSave(local)}
    />
  )
}
