'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'
import { accessLockedSelectClassName, firstAllowedValue, restrictOptions, usePageFilterAccess } from '@/lib/pageAccessFilters'

/* ------------------------------------------------------------------ */
/* Charte graphique                                                    */
/* ------------------------------------------------------------------ */

const C = {
  bg: '#0B1220',
  panel: '#111A2E',
  panelSoft: '#16213A',
  input: '#0F1729',
  line: 'rgba(245,243,236,0.10)',
  lineStrong: 'rgba(245,243,236,0.18)',
  text: '#F5F3EC',
  muted: '#8B93A7',
  sauge: '#A6A181',
  alerte: '#C1683C',
  violet: '#7A5EA8',
  blue: '#4C6FD8',
  sky: '#8FC6E3',
  green: '#5BA35B',
  red: '#D9534F',
}

const FONT_TITLE = "'Space Grotesk', 'IBM Plex Sans', system-ui, sans-serif"
const FONT_BODY = "'IBM Plex Sans', system-ui, sans-serif"
const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace"

const MACRO_COLORS: Record<string, string> = {
  ACC: '#4F8FB0',
  DIV: '#D9A441',
  DRV: '#C8743F',
  ECS: '#4FA35A',
  PV: '#7A5EA8',
  'R/O': '#A6A181',
  'R/R': '#8FC6E3',
  R_ZONE: '#E3A35F',
  SAV: '#3F9BC4',
  TECH: '#D9A441',
}

function macroColor(value: string) {
  return MACRO_COLORS[value.toUpperCase()] || MACRO_COLORS[value] || C.muted
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type AxisType = 'agence' | 'collaborateur' | 'famille_macro' | 'famille' | 'client'
type TransformationStatus = 'Tous' | 'Non transformé' | 'CDC créée' | 'BL créé' | 'Facturé'
type HorizonKey = 'taux_30' | 'taux_60' | 'taux_90' | 'taux_maturite'
type CoverageKey = 'couverture_30' | 'couverture_60' | 'couverture_90' | 'couverture_maturite'

type FilterOptions = {
  agences: string[]
  collaborateurs: string[]
  familles_macro: string[]
  familles: string[]
  statuts: string[]
}

type KpiRow = {
  nb_lignes_devis: number
  ca_devis: number
  nb_lignes_avec_cdc: number
  nb_lignes_avec_bl: number
  nb_lignes_avec_facture: number
  ca_devis_avec_cdc: number
  ca_devis_avec_bl: number
  ca_devis_avec_facture: number
  taux_cdc_valeur: number | null
  taux_bl_valeur: number | null
  taux_facture_valeur: number | null
  taux_facture_nombre: number | null
  delai_moyen_facture: number | null
  delai_median_facture: number | null
  delai_pondere_facture: number | null
  nb_devis_a_risque: number
  ca_devis_a_risque: number
}

type FunnelRow = {
  ordre: number
  etape: string
  nb_lignes: number
  ca_devis_reference: number
  taux_nombre: number | null
  taux_valeur: number | null
  delai_moyen: number | null
  delai_median: number | null
  delai_pondere: number | null
}

type AxisRow = {
  axe_type: string
  axe: string
  nb_lignes_devis: number
  ca_devis: number
  ca_devis_avec_cdc: number
  ca_devis_avec_bl: number
  ca_devis_avec_facture: number
  taux_cdc_valeur: number | null
  taux_bl_valeur: number | null
  taux_facture_valeur: number | null
  delai_facture_moyen: number | null
  delai_facture_median: number | null
  panier_moyen_devis: number
  nb_devis_a_risque: number
}

type TopDevisRow = {
  rang: number
  date_devis: string | null
  numero_devis: string
  numero_tiers: string
  intitule_tiers: string
  agence_collaborateur: string
  collaborateur_tiers: string
  famille_macro_principale: string
  nb_lignes: number
  ca_devis: number
  quantite_devis: number
  statut_transformation: string
  date_premiere_cdc: string | null
  date_premier_bl: string | null
  date_premiere_facture: string | null
  delai_devis_facture: number | null
}

type RiskRow = {
  priorite: string
  age_jours: number
  date_devis: string | null
  numero_devis: string
  numero_tiers: string
  intitule_tiers: string
  agence_collaborateur: string
  collaborateur_tiers: string
  famille_macro_principale: string
  nb_lignes: number
  ca_devis: number
  quantite_devis: number
  derniere_designation: string
}

type AlertRow = {
  type_alerte: string
  numero_tiers: string
  intitule_tiers: string
  agence_collaborateur: string
  collaborateur_tiers: string
  famille_macro_principale: string
  ca_devis_periode: number
  ca_devis_n1: number
  ecart_ca: number
  evolution_pct: number | null
  nb_devis_periode: number
  nb_devis_n1: number
  dernier_devis: string | null
}

type CohortRow = {
  periode: 'N' | 'N-1'
  mois: string
  nb_lignes: number
  ca_devis: number
  taux_30: number | null
  taux_60: number | null
  taux_90: number | null
  taux_maturite: number | null
  couverture_30: number | null
  couverture_60: number | null
  couverture_90: number | null
  couverture_maturite: number | null
}

type CohortAxisRow = {
  axe: string
  nb_lignes: number
  ca_devis: number
  taux_30: number | null
  taux_60: number | null
  taux_90: number | null
  taux_maturite: number | null
  ca_devis_n1: number
  taux_30_n1: number | null
  taux_60_n1: number | null
  taux_90_n1: number | null
  taux_maturite_n1: number | null
}

type HorizonDef = { key: HorizonKey; coverage: CoverageKey; label: string; color: string }

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const EMPTY_OPTIONS: FilterOptions = {
  agences: [],
  collaborateurs: [],
  familles_macro: [],
  familles: [],
  statuts: ['Non transformé', 'CDC créée', 'BL créé', 'Facturé'],
}

const AXIS_LABELS: Record<AxisType, string> = {
  agence: 'Agence',
  collaborateur: 'Collaborateur',
  famille_macro: 'Famille macro',
  famille: 'Famille',
  client: 'Client',
}

const MATURITE_OPTIONS = [90, 120, 150, 180]

function horizonDefs(maturite: number): HorizonDef[] {
  return [
    { key: 'taux_30', coverage: 'couverture_30', label: '30 j', color: C.sky },
    { key: 'taux_60', coverage: 'couverture_60', label: '60 j', color: C.blue },
    { key: 'taux_90', coverage: 'couverture_90', label: '90 j', color: C.sauge },
    { key: 'taux_maturite', coverage: 'couverture_maturite', label: `Maturité ${maturite} j`, color: C.alerte },
  ]
}

const STATUS_COLORS: Record<string, string> = {
  'Non transformé': 'bg-white/5 text-[#C9CEDA] border-white/15',
  'CDC créée': 'bg-[#8FC6E3]/10 text-[#8FC6E3] border-[#8FC6E3]/30',
  'BL créé': 'bg-[#4C6FD8]/15 text-[#9DB2F0] border-[#4C6FD8]/40',
  Facturé: 'bg-[#5BA35B]/15 text-[#8FD08F] border-[#5BA35B]/40',
}

const ALERT_COLORS: Record<string, string> = {
  'Décrochage total': 'bg-[#D9534F]/15 text-[#F0928F] border-[#D9534F]/40',
  'Baisse forte': 'bg-[#C1683C]/15 text-[#E8A07C] border-[#C1683C]/40',
  'Nouveau signal': 'bg-[#4C6FD8]/15 text-[#9DB2F0] border-[#4C6FD8]/40',
  'Hausse forte': 'bg-[#5BA35B]/15 text-[#8FD08F] border-[#5BA35B]/40',
  Stable: 'bg-white/5 text-[#C9CEDA] border-white/15',
}

const PRIORITY_COLORS: Record<string, string> = {
  Haute: 'bg-[#D9534F]/15 text-[#F0928F] border-[#D9534F]/40',
  Moyenne: 'bg-[#D9A441]/15 text-[#E8C27A] border-[#D9A441]/40',
  Basse: 'bg-white/5 text-[#C9CEDA] border-white/15',
}

const FIELD_CLASS = 'h-11 rounded-xl border border-white/10 bg-[#0F1729] px-3 text-sm font-semibold text-[#F5F3EC] outline-none focus:border-[#4C6FD8]'
const SMALL_FIELD_CLASS = 'h-9 rounded-lg border border-white/10 bg-[#0F1729] px-2 text-sm font-semibold text-[#F5F3EC] outline-none focus:border-[#4C6FD8]'
const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8B93A7]'
const TH_CLASS = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8B93A7]'

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function safeNullableNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = safeNumber(value)
  return Number.isFinite(n) ? n : null
}

function safeText(value: any, fallback = 'NON RENSEIGNE') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function uniqueSorted(values: any[]) {
  return Array.from(new Set(values.map((value) => safeText(value, '')).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  )
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateForInput(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
}

function firstDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1)
}

function addMonths(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1 + months, day || 1)
  return formatDateForInput(date)
}

function normalizeBusinessDate(value: any): string | null {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  const timestamp = new Date(text).getTime()
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString().slice(0, 10)
}

function formatDate(value: string | null | undefined) {
  const iso = normalizeBusinessDate(value)
  if (!iso) return '—'
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function formatDateShort(value: string | null | undefined) {
  const iso = normalizeBusinessDate(value)
  if (!iso) return '—'
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function formatMonth(iso: string | null | undefined, withYear = false) {
  const value = normalizeBusinessDate(iso)
  if (!value) return '—'
  const [year, month] = value.split('-')
  const label = MONTHS_FR[Number(month) - 1] || month
  return withYear ? `${label} ${year.slice(2)}` : label
}

function formatNumber(value: number | null | undefined, fractionDigits = 0) {
  const number = safeNumber(value)
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(number)
}

function formatCurrency(value: number | null | undefined, compact = false) {
  const number = safeNumber(value)
  if (compact && Math.abs(number) >= 1000000) return `${formatNumber(number / 1000000, 2)} M€`
  if (compact && Math.abs(number) >= 1000) return `${formatNumber(number / 1000, 0)} K€`
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(number)
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${formatNumber(Number(value), 1)} %`
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return `${formatNumber(Number(value), 1)} j`
}

function deltaPoints(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  return Number(current) - Number(previous)
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const v = Number(value)
  const arrow = v > 0.05 ? '▲' : v < -0.05 ? '▼' : '='
  return `${arrow} ${v > 0 ? '+' : ''}${formatNumber(v, 1)} pt`
}

function deltaColor(value: number | null | undefined) {
  if (value === null || value === undefined) return C.muted
  if (value > 0.05) return '#8FD08F'
  if (value < -0.05) return '#E8A07C'
  return C.muted
}

function isComplete(coverage: number | null | undefined) {
  return safeNumber(coverage) >= 99.95
}

function defaultPeriod() {
  const now = new Date()
  const start = firstDayOfMonth(now.getFullYear(), 0)
  const end = firstDayOfMonth(now.getFullYear(), now.getMonth() + 1)
  return {
    start: formatDateForInput(start),
    end: formatDateForInput(end),
  }
}

function defaultYearOptions() {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let year = current; year >= 2023; year -= 1) years.push(year)
  return years
}

function downloadWorkbook(filename: string, sheets: Array<{ name: string; rows: Array<Record<string, any>> }>) {
  const workbook = XLSX.utils.book_new()
  sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
  })
  XLSX.writeFile(workbook, filename)
}

function asArray<T>(data: any): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data === null || data === undefined) return []
  return [data as T]
}

function firstRow<T>(data: any): T | null {
  const rows = asArray<T>(data)
  return rows.length ? rows[0] : null
}

/** Régression linéaire simple : renvoie pente et ordonnée à l'origine. */
function linearRegression(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return null
  const n = points.length
  const sx = points.reduce((s, p) => s + p.x, 0)
  const sy = points.reduce((s, p) => s + p.y, 0)
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0)
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0)
  const den = n * sxx - sx * sx
  if (den === 0) return null
  const slope = (n * sxy - sx * sy) / den
  const intercept = (sy - slope * sx) / n
  return { slope, intercept }
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

function mapKpi(row: any): KpiRow {
  return {
    nb_lignes_devis: safeNumber(row?.nb_lignes_devis),
    ca_devis: safeNumber(row?.ca_devis),
    nb_lignes_avec_cdc: safeNumber(row?.nb_lignes_avec_cdc),
    nb_lignes_avec_bl: safeNumber(row?.nb_lignes_avec_bl),
    nb_lignes_avec_facture: safeNumber(row?.nb_lignes_avec_facture),
    ca_devis_avec_cdc: safeNumber(row?.ca_devis_avec_cdc),
    ca_devis_avec_bl: safeNumber(row?.ca_devis_avec_bl),
    ca_devis_avec_facture: safeNumber(row?.ca_devis_avec_facture),
    taux_cdc_valeur: safeNullableNumber(row?.taux_cdc_valeur),
    taux_bl_valeur: safeNullableNumber(row?.taux_bl_valeur),
    taux_facture_valeur: safeNullableNumber(row?.taux_facture_valeur),
    taux_facture_nombre: safeNullableNumber(row?.taux_facture_nombre),
    delai_moyen_facture: safeNullableNumber(row?.delai_moyen_facture),
    delai_median_facture: safeNullableNumber(row?.delai_median_facture),
    delai_pondere_facture: safeNullableNumber(row?.delai_pondere_facture),
    nb_devis_a_risque: safeNumber(row?.nb_devis_a_risque),
    ca_devis_a_risque: safeNumber(row?.ca_devis_a_risque),
  }
}

function mapFunnel(row: any): FunnelRow {
  return {
    ordre: safeNumber(row.ordre),
    etape: safeText(row.etape),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis_reference: safeNumber(row.ca_devis_reference),
    taux_nombre: safeNullableNumber(row.taux_nombre),
    taux_valeur: safeNullableNumber(row.taux_valeur),
    delai_moyen: safeNullableNumber(row.delai_moyen),
    delai_median: safeNullableNumber(row.delai_median),
    delai_pondere: safeNullableNumber(row.delai_pondere),
  }
}

function mapAxis(row: any): AxisRow {
  return {
    axe_type: safeText(row.axe_type, ''),
    axe: safeText(row.axe),
    nb_lignes_devis: safeNumber(row.nb_lignes_devis),
    ca_devis: safeNumber(row.ca_devis),
    ca_devis_avec_cdc: safeNumber(row.ca_devis_avec_cdc),
    ca_devis_avec_bl: safeNumber(row.ca_devis_avec_bl),
    ca_devis_avec_facture: safeNumber(row.ca_devis_avec_facture),
    taux_cdc_valeur: safeNullableNumber(row.taux_cdc_valeur),
    taux_bl_valeur: safeNullableNumber(row.taux_bl_valeur),
    taux_facture_valeur: safeNullableNumber(row.taux_facture_valeur),
    delai_facture_moyen: safeNullableNumber(row.delai_facture_moyen),
    delai_facture_median: safeNullableNumber(row.delai_facture_median),
    panier_moyen_devis: safeNumber(row.panier_moyen_devis),
    nb_devis_a_risque: safeNumber(row.nb_devis_a_risque),
  }
}

function mapTop(row: any): TopDevisRow {
  return {
    rang: safeNumber(row.rang),
    date_devis: normalizeBusinessDate(row.date_devis),
    numero_devis: safeText(row.numero_devis, ''),
    numero_tiers: safeText(row.numero_tiers, ''),
    intitule_tiers: safeText(row.intitule_tiers),
    agence_collaborateur: safeText(row.agence_collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    famille_macro_principale: safeText(row.famille_macro_principale),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis: safeNumber(row.ca_devis),
    quantite_devis: safeNumber(row.quantite_devis),
    statut_transformation: safeText(row.statut_transformation, 'Non transformé'),
    date_premiere_cdc: normalizeBusinessDate(row.date_premiere_cdc),
    date_premier_bl: normalizeBusinessDate(row.date_premier_bl),
    date_premiere_facture: normalizeBusinessDate(row.date_premiere_facture),
    delai_devis_facture: safeNullableNumber(row.delai_devis_facture),
  }
}

function mapRisk(row: any): RiskRow {
  return {
    priorite: safeText(row.priorite, 'Moyenne'),
    age_jours: safeNumber(row.age_jours),
    date_devis: normalizeBusinessDate(row.date_devis),
    numero_devis: safeText(row.numero_devis, ''),
    numero_tiers: safeText(row.numero_tiers, ''),
    intitule_tiers: safeText(row.intitule_tiers),
    agence_collaborateur: safeText(row.agence_collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    famille_macro_principale: safeText(row.famille_macro_principale),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis: safeNumber(row.ca_devis),
    quantite_devis: safeNumber(row.quantite_devis),
    derniere_designation: safeText(row.derniere_designation, ''),
  }
}

function mapAlert(row: any): AlertRow {
  return {
    type_alerte: safeText(row.type_alerte, 'Stable'),
    numero_tiers: safeText(row.numero_tiers, ''),
    intitule_tiers: safeText(row.intitule_tiers),
    agence_collaborateur: safeText(row.agence_collaborateur, 'NON AFFECTE'),
    collaborateur_tiers: safeText(row.collaborateur_tiers, 'NON AFFECTE'),
    famille_macro_principale: safeText(row.famille_macro_principale),
    ca_devis_periode: safeNumber(row.ca_devis_periode),
    ca_devis_n1: safeNumber(row.ca_devis_n1),
    ecart_ca: safeNumber(row.ecart_ca),
    evolution_pct: safeNullableNumber(row.evolution_pct),
    nb_devis_periode: safeNumber(row.nb_devis_periode),
    nb_devis_n1: safeNumber(row.nb_devis_n1),
    dernier_devis: normalizeBusinessDate(row.dernier_devis),
  }
}

function mapCohort(row: any): CohortRow {
  return {
    periode: row.periode === 'N-1' ? 'N-1' : 'N',
    mois: normalizeBusinessDate(row.mois) || '',
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis: safeNumber(row.ca_devis),
    taux_30: safeNullableNumber(row.taux_30),
    taux_60: safeNullableNumber(row.taux_60),
    taux_90: safeNullableNumber(row.taux_90),
    taux_maturite: safeNullableNumber(row.taux_maturite),
    couverture_30: safeNullableNumber(row.couverture_30),
    couverture_60: safeNullableNumber(row.couverture_60),
    couverture_90: safeNullableNumber(row.couverture_90),
    couverture_maturite: safeNullableNumber(row.couverture_maturite),
  }
}

function mapCohortAxis(row: any): CohortAxisRow {
  return {
    axe: safeText(row.axe),
    nb_lignes: safeNumber(row.nb_lignes),
    ca_devis: safeNumber(row.ca_devis),
    taux_30: safeNullableNumber(row.taux_30),
    taux_60: safeNullableNumber(row.taux_60),
    taux_90: safeNullableNumber(row.taux_90),
    taux_maturite: safeNullableNumber(row.taux_maturite),
    ca_devis_n1: safeNumber(row.ca_devis_n1),
    taux_30_n1: safeNullableNumber(row.taux_30_n1),
    taux_60_n1: safeNullableNumber(row.taux_60_n1),
    taux_90_n1: safeNullableNumber(row.taux_90_n1),
    taux_maturite_n1: safeNullableNumber(row.taux_maturite_n1),
  }
}

function statusBadgeClass(status: string) {
  return STATUS_COLORS[status] || 'bg-white/5 text-[#C9CEDA] border-white/15'
}

function alertBadgeClass(status: string) {
  return ALERT_COLORS[status] || 'bg-white/5 text-[#C9CEDA] border-white/15'
}

function priorityBadgeClass(priority: string) {
  return PRIORITY_COLORS[priority] || 'bg-white/5 text-[#C9CEDA] border-white/15'
}

/* ------------------------------------------------------------------ */
/* Composants UI                                                       */
/* ------------------------------------------------------------------ */

function Panel({
  accent = C.blue,
  tag,
  title,
  subtitle,
  right,
  className = '',
  children,
}: {
  accent?: string
  tag?: string
  title?: string
  subtitle?: string
  right?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${className}`}
      style={{ background: C.panel, borderColor: C.line, borderTop: `3px solid ${accent}` }}
    >
      {(tag || title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {tag && (
              <span
                className="mb-2 inline-flex rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: accent, color: C.bg, fontFamily: FONT_TITLE }}
              >
                {tag}
              </span>
            )}
            {title && (
              <h2 className="text-lg font-bold" style={{ fontFamily: FONT_TITLE, color: C.text }}>
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-1 text-xs" style={{ color: C.muted }}>{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

function KpiCard({
  title,
  value,
  subtitle,
  intent = 'neutral',
  accent,
}: {
  title: string
  value: string
  subtitle?: ReactNode
  intent?: 'neutral' | 'good' | 'warning' | 'danger'
  accent?: string
}) {
  const colors = {
    neutral: C.blue,
    good: C.green,
    warning: C.alerte,
    danger: C.red,
  }
  const color = accent || colors[intent]
  return (
    <div className="rounded-2xl border p-4" style={{ background: C.panel, borderColor: C.line, borderTop: `3px solid ${color}` }}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.muted }}>{title}</div>
      <div className="mt-2 text-2xl font-bold" style={{ fontFamily: FONT_TITLE, color: C.text }}>{value}</div>
      {subtitle && <div className="mt-1 text-xs" style={{ color: C.muted, fontFamily: FONT_MONO }}>{subtitle}</div>}
    </div>
  )
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const className = accessLockedSelectClassName(FIELD_CLASS, disabled)

  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL_CLASS}>
        {label}{disabled ? ' 🔒' : ''}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (!disabled) onChange(event.target.value)
        }}
        className={className}
      >
        <option value="">Tous</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function PillButton({
  active,
  onClick,
  children,
  dot,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  dot?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition"
      style={{
        fontFamily: FONT_TITLE,
        background: active ? 'rgba(245,243,236,0.12)' : 'transparent',
        borderColor: active ? 'rgba(245,243,236,0.45)' : C.lineStrong,
        color: active ? C.text : '#C9CEDA',
      }}
    >
      {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  )
}

function MacroPills({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  const list = options.filter((option) => option !== 'NON RENSEIGNE')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-semibold uppercase tracking-[0.08em]" style={{ color: C.muted, fontFamily: FONT_TITLE }}>
        Famille macro :
      </span>
      <PillButton active={!value} onClick={() => onChange('')}>Toutes</PillButton>
      {list.map((option) => (
        <PillButton key={option} active={value === option} onClick={() => onChange(value === option ? '' : option)} dot={macroColor(option)}>
          {option}
        </PillButton>
      ))}
    </div>
  )
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-full border p-1" style={{ borderColor: C.lineStrong, background: C.input }}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
            style={{
              fontFamily: FONT_TITLE,
              background: active ? '#3A4560' : 'transparent',
              color: active ? C.text : C.muted,
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ProgressBar({ value, color = C.sauge }: { value: number | null | undefined; color?: string }) {
  const width = Math.max(0, Math.min(100, safeNumber(value)))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(245,243,236,0.08)' }}>
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </div>
  )
}

function TableShell({ children, maxHeight }: { children: ReactNode; maxHeight?: number }) {
  return (
    <div className="overflow-auto rounded-xl border" style={{ borderColor: C.line, maxHeight }}>
      <table className="min-w-full text-sm" style={{ color: C.text }}>{children}</table>
    </div>
  )
}

function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10" style={{ background: C.panelSoft }}>
      {children}
    </thead>
  )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm" style={{ color: C.muted }}>{label}</td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/* Courbe de transformation par cohorte                                */
/* ------------------------------------------------------------------ */

function CohortChart({
  rows,
  horizons,
  showN1,
  showTrend,
}: {
  rows: CohortRow[]
  horizons: HorizonDef[]
  showN1: boolean
  showTrend: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)

  const nRows = useMemo(() => rows.filter((row) => row.periode === 'N').sort((a, b) => a.mois.localeCompare(b.mois)), [rows])
  const n1ByMonth = useMemo(() => {
    const map = new Map<string, CohortRow>()
    rows.filter((row) => row.periode === 'N-1').forEach((row) => map.set(addMonths(row.mois, 12), row))
    return map
  }, [rows])

  const W = 920
  const H = 320
  const PL = 48
  const PR = 18
  const PT = 18
  const PB = 36
  const plotW = W - PL - PR
  const plotH = H - PT - PB

  const maxValue = useMemo(() => {
    let max = 10
    nRows.forEach((row) => {
      horizons.forEach((h) => {
        max = Math.max(max, safeNumber(row[h.key]))
        if (showN1) max = Math.max(max, safeNumber(n1ByMonth.get(row.mois)?.[h.key]))
      })
    })
    return Math.ceil((max * 1.12) / 5) * 5
  }, [nRows, horizons, showN1, n1ByMonth])

  const count = nRows.length
  const xAt = (i: number) => PL + (count <= 1 ? plotW / 2 : (i * plotW) / (count - 1))
  const yAt = (v: number) => PT + plotH - (v / maxValue) * plotH
  const ticks = useMemo(() => {
    const step = maxValue <= 20 ? 5 : maxValue <= 50 ? 10 : 20
    const values: number[] = []
    for (let v = 0; v <= maxValue; v += step) values.push(v)
    return values
  }, [maxValue])

  if (!count) {
    return <div className="rounded-xl p-10 text-center text-sm" style={{ background: C.panelSoft, color: C.muted }}>Aucune cohorte de devis sur la période.</div>
  }

  const hovered = hover !== null ? nRows[hover] : null
  const hoveredN1 = hovered ? n1ByMonth.get(hovered.mois) : undefined

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PL} x2={W - PR} y1={yAt(tick)} y2={yAt(tick)} stroke={C.line} strokeDasharray={tick === 0 ? undefined : '3 4'} />
            <text x={PL - 8} y={yAt(tick) + 4} textAnchor="end" fontSize="11" fill={C.muted} fontFamily={FONT_MONO}>{tick} %</text>
          </g>
        ))}

        {nRows.map((row, i) => (
          <text key={row.mois} x={xAt(i)} y={H - 12} textAnchor="middle" fontSize="11" fill={hover === i ? C.text : C.muted} fontFamily={FONT_BODY}>
            {formatMonth(row.mois, count > 12)}
          </text>
        ))}

        {hover !== null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={PT} y2={PT + plotH} stroke={C.lineStrong} />
        )}

        {horizons.map((h) => {
          const nPoints = nRows
            .map((row, i) => ({ i, v: row[h.key], complete: isComplete(row[h.coverage]) }))
            .filter((p) => p.v !== null) as Array<{ i: number; v: number; complete: boolean }>

          const n1Points = showN1
            ? (nRows
                .map((row, i) => ({ i, v: n1ByMonth.get(row.mois)?.[h.key] ?? null }))
                .filter((p) => p.v !== null) as Array<{ i: number; v: number }>)
            : []

          const completePoints = nPoints.filter((p) => p.complete)
          const regression = showTrend ? linearRegression(completePoints.map((p) => ({ x: p.i, y: p.v }))) : null

          return (
            <g key={h.key}>
              {n1Points.length > 1 && (
                <polyline
                  points={n1Points.map((p) => `${xAt(p.i)},${yAt(p.v)}`).join(' ')}
                  fill="none"
                  stroke={h.color}
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                />
              )}
              {n1Points.map((p) => (
                <circle key={`n1-${p.i}`} cx={xAt(p.i)} cy={yAt(p.v)} r={2.5} fill={h.color} fillOpacity={0.45} />
              ))}

              {nPoints.slice(1).map((p, idx) => {
                const prev = nPoints[idx]
                const partial = !p.complete || !prev.complete
                return (
                  <line
                    key={`seg-${p.i}`}
                    x1={xAt(prev.i)}
                    y1={yAt(prev.v)}
                    x2={xAt(p.i)}
                    y2={yAt(p.v)}
                    stroke={h.color}
                    strokeWidth={partial ? 1.5 : 2.5}
                    strokeDasharray={partial ? '2 4' : undefined}
                    strokeLinecap="round"
                  />
                )
              })}

              {regression && completePoints.length > 1 && (
                <line
                  x1={xAt(completePoints[0].i)}
                  y1={yAt(Math.max(0, regression.intercept + regression.slope * completePoints[0].i))}
                  x2={xAt(nPoints[nPoints.length - 1].i)}
                  y2={yAt(Math.max(0, regression.intercept + regression.slope * nPoints[nPoints.length - 1].i))}
                  stroke={h.color}
                  strokeOpacity={0.7}
                  strokeWidth={1}
                  strokeDasharray="1 3"
                />
              )}

              {nPoints.map((p) => (
                <circle
                  key={`pt-${p.i}`}
                  cx={xAt(p.i)}
                  cy={yAt(p.v)}
                  r={hover === p.i ? 5 : 3.5}
                  fill={p.complete ? h.color : C.panel}
                  stroke={h.color}
                  strokeWidth={p.complete ? 0 : 1.5}
                />
              ))}
            </g>
          )
        })}

        {nRows.map((row, i) => {
          const half = count <= 1 ? plotW / 2 : plotW / (count - 1) / 2
          return (
            <rect
              key={`hit-${row.mois}`}
              x={xAt(i) - half}
              y={PT}
              width={half * 2}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          )
        })}
      </svg>

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-20 w-64 rounded-xl border p-3 text-xs shadow-xl"
          style={{
            left: `${Math.min(70, Math.max(2, (xAt(hover) / W) * 100 - (hover > count / 2 ? 30 : -2)))}%`,
            background: C.bg,
            borderColor: C.lineStrong,
            color: C.text,
          }}
        >
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-bold" style={{ fontFamily: FONT_TITLE }}>Devis de {formatMonth(hovered.mois, true)}</span>
            <span style={{ color: C.muted, fontFamily: FONT_MONO }}>{formatCurrency(hovered.ca_devis, true)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1" style={{ fontFamily: FONT_MONO }}>
            <span style={{ color: C.muted }}>Âge</span>
            <span className="text-right" style={{ color: C.muted }}>N</span>
            <span className="text-right" style={{ color: C.muted }}>N-1</span>
            <span className="text-right" style={{ color: C.muted }}>Δ</span>
            {horizons.map((h) => {
              const v = hovered[h.key]
              const v1 = hoveredN1?.[h.key] ?? null
              const complete = isComplete(hovered[h.coverage])
              const d = deltaPoints(v, v1)
              return (
                <div key={h.key} className="contents">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: h.color }} />
                    {h.label}
                  </span>
                  <span className="text-right">
                    {formatPercent(v)}
                    {v !== null && !complete && <span style={{ color: C.muted }}>*</span>}
                  </span>
                  <span className="text-right" style={{ color: C.muted }}>{formatPercent(v1)}</span>
                  <span className="text-right" style={{ color: deltaColor(d) }}>{d === null ? '—' : `${d > 0 ? '+' : ''}${formatNumber(d, 1)}`}</span>
                </div>
              )
            })}
          </div>
          {horizons.some((h) => hovered[h.key] !== null && !isComplete(hovered[h.coverage])) && (
            <div className="mt-2 border-t pt-2 text-[11px]" style={{ borderColor: C.line, color: C.muted }}>
              * cohorte partielle : taux calculé sur{' '}
              {horizons
                .filter((h) => hovered[h.key] !== null && !isComplete(hovered[h.coverage]))
                .map((h) => `${formatNumber(hovered[h.coverage], 0)} % du CA (${h.label})`)
                .join(', ')}
              , soit les devis ayant déjà atteint cet âge.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CycleDocumentsPage() {
  const access = usePageFilterAccess()
  const period = useMemo(defaultPeriod, [])
  const [dateDebut, setDateDebut] = useState(period.start)
  const [dateFin, setDateFin] = useState(period.end)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  const [agence, setAgence] = useState('')
  const [collaborateur, setCollaborateur] = useState('')
  const [familleMacro, setFamilleMacro] = useState('')
  const [famille, setFamille] = useState('')
  const [client, setClient] = useState('')
  const [statut, setStatut] = useState<TransformationStatus>('Tous')
  const [includeHorsStat, setIncludeHorsStat] = useState(false)
  const [axis, setAxis] = useState<AxisType>('famille_macro')
  const [ageRisque, setAgeRisque] = useState(30)
  const [montantRisque, setMontantRisque] = useState(15000)
  const [seuilAlerte, setSeuilAlerte] = useState(50)
  const [topMonths, setTopMonths] = useState(3)

  const [maturite, setMaturite] = useState(120)
  const [selectedHorizons, setSelectedHorizons] = useState<HorizonKey[]>(['taux_30', 'taux_60', 'taux_90'])
  const [showN1, setShowN1] = useState(true)
  const [showTrend, setShowTrend] = useState(true)

  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS)
  const [kpis, setKpis] = useState<KpiRow | null>(null)
  const [funnelRows, setFunnelRows] = useState<FunnelRow[]>([])
  const [axisRows, setAxisRows] = useState<AxisRow[]>([])
  const [topRows, setTopRows] = useState<TopDevisRow[]>([])
  const [riskRows, setRiskRows] = useState<RiskRow[]>([])
  const [alertRows, setAlertRows] = useState<AlertRow[]>([])
  const [cohortRows, setCohortRows] = useState<CohortRow[]>([])
  const [cohortAxisRows, setCohortAxisRows] = useState<CohortAxisRow[]>([])

  const [loading, setLoading] = useState(false)
  const [loadingCohorts, setLoadingCohorts] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [rebuildLoading, setRebuildLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const horizons = useMemo(() => horizonDefs(maturite), [maturite])
  const activeHorizons = useMemo(() => horizons.filter((h) => selectedHorizons.includes(h.key)), [horizons, selectedHorizons])

  const topDateDebut = useMemo(() => addMonths(dateFin, -Math.max(1, topMonths)), [dateFin, topMonths])
  const effectiveAgence = access.hasAgenceRestriction ? firstAllowedValue(access.allowedAgences) : agence
  const effectiveCollaborateur = access.hasCollaborateurRestriction ? firstAllowedValue(access.allowedCollaborateurs) : collaborateur
  const visibleAgences = useMemo(() => restrictOptions(options.agences, access.allowedAgences), [options.agences, access.allowedAgences])
  const visibleCollaborateurs = useMemo(() => restrictOptions(options.collaborateurs, access.allowedCollaborateurs), [options.collaborateurs, access.allowedCollaborateurs])

  useEffect(() => {
    if (access.hasAgenceRestriction) setAgence(firstAllowedValue(access.allowedAgences))
  }, [access.hasAgenceRestriction, access.allowedAgences])

  useEffect(() => {
    if (access.hasCollaborateurRestriction) setCollaborateur(firstAllowedValue(access.allowedCollaborateurs))
  }, [access.hasCollaborateurRestriction, access.allowedCollaborateurs])

  const commonParams = useMemo(() => ({
    p_date_debut: dateDebut,
    p_date_fin: dateFin,
    p_agence: effectiveAgence || null,
    p_collaborateur: effectiveCollaborateur || null,
    p_famille_macro: familleMacro || null,
    p_famille: famille || null,
    p_client: client || null,
    p_include_hors_stat: includeHorsStat,
  }), [dateDebut, dateFin, effectiveAgence, effectiveCollaborateur, familleMacro, famille, client, includeHorsStat])

  function updateYear(year: number) {
    setSelectedYear(year)
    setDateDebut(`${year}-01-01`)
    const now = new Date()
    const end = year === now.getFullYear() ? firstDayOfMonth(year, now.getMonth() + 1) : firstDayOfMonth(year + 1, 0)
    setDateFin(formatDateForInput(end))
  }

  function toggleHorizon(key: HorizonKey) {
    setSelectedHorizons((current) => {
      if (current.includes(key)) return current.length > 1 ? current.filter((k) => k !== key) : current
      return [...current, key]
    })
  }

  async function loadOptions() {
    setLoadingOptions(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('get_cycle_documents_filter_options', {
        p_date_debut: dateDebut,
        p_date_fin: dateFin,
        p_include_hors_stat: includeHorsStat,
      })
      if (rpcError) throw rpcError

      const payload = Array.isArray(data)
        ? ((data[0]?.get_cycle_documents_filter_options || data[0] || {}) as any)
        : ((data || {}) as any)

      setOptions({
        agences: uniqueSorted(payload.agences || []),
        collaborateurs: uniqueSorted(payload.collaborateurs || []),
        familles_macro: uniqueSorted(payload.familles_macro || []),
        familles: uniqueSorted(payload.familles || []),
        statuts: uniqueSorted(payload.statuts || EMPTY_OPTIONS.statuts),
      })
    } catch (exception: any) {
      setError(`Chargement des filtres impossible : ${exception?.message || exception}`)
      setOptions(EMPTY_OPTIONS)
    } finally {
      setLoadingOptions(false)
    }
  }

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [kpiResult, funnelResult, axisResult, topResult, riskResult, alertsResult] = await Promise.all([
        supabase.rpc('get_cycle_documents_kpis', {
          ...commonParams,
          p_age_risque_jours: ageRisque,
          p_montant_risque: montantRisque,
        }),
        supabase.rpc('get_cycle_documents_funnel', commonParams),
        supabase.rpc('get_cycle_documents_axes', {
          ...commonParams,
          p_axe: axis,
          p_age_risque_jours: ageRisque,
          p_montant_risque: montantRisque,
        }),
        supabase.rpc('get_cycle_documents_top_devis', {
          p_date_debut: topDateDebut,
          p_date_fin: dateFin,
          p_agence: effectiveAgence || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_famille_macro: familleMacro || null,
          p_famille: famille || null,
          p_client: client || null,
          p_statut: statut === 'Tous' ? null : statut,
          p_include_hors_stat: includeHorsStat,
          p_montant_min: 0,
          p_limit: 30,
        }),
        supabase.rpc('get_cycle_documents_devis_a_risque', {
          ...commonParams,
          p_age_min_jours: ageRisque,
          p_montant_min: montantRisque,
          p_limit: 100,
        }),
        supabase.rpc('get_cycle_documents_alertes_clients', {
          p_date_debut: dateDebut,
          p_date_fin: dateFin,
          p_agence: effectiveAgence || null,
          p_collaborateur: effectiveCollaborateur || null,
          p_famille_macro: familleMacro || null,
          p_famille: famille || null,
          p_include_hors_stat: includeHorsStat,
          p_seuil_pct: seuilAlerte,
          p_montant_min: montantRisque,
          p_limit: 100,
        }),
      ])

      const rpcErrors = [kpiResult, funnelResult, axisResult, topResult, riskResult, alertsResult].map((result) => result.error).filter(Boolean)
      if (rpcErrors.length) throw rpcErrors[0]

      setKpis(mapKpi(firstRow<any>(kpiResult.data) || {}))
      setFunnelRows(asArray<any>(funnelResult.data).map(mapFunnel))
      setAxisRows(asArray<any>(axisResult.data).map(mapAxis))
      setTopRows(asArray<any>(topResult.data).map(mapTop))
      setRiskRows(asArray<any>(riskResult.data).map(mapRisk))
      setAlertRows(asArray<any>(alertsResult.data).map(mapAlert))
    } catch (exception: any) {
      setError(`Chargement de l'analyse impossible : ${exception?.message || exception}`)
      setKpis(null)
      setFunnelRows([])
      setAxisRows([])
      setTopRows([])
      setRiskRows([])
      setAlertRows([])
    } finally {
      setLoading(false)
    }
  }

  async function loadCohorts() {
    setLoadingCohorts(true)
    try {
      const [cohortResult, cohortAxisResult] = await Promise.all([
        supabase.rpc('get_cycle_documents_cohortes', { ...commonParams, p_maturite_jours: maturite }),
        supabase.rpc('get_cycle_documents_cohortes_axes', { ...commonParams, p_maturite_jours: maturite, p_axe: axis }),
      ])
      if (cohortResult.error) throw cohortResult.error
      if (cohortAxisResult.error) throw cohortAxisResult.error
      setCohortRows(asArray<any>(cohortResult.data).map(mapCohort).filter((row) => row.mois))
      setCohortAxisRows(asArray<any>(cohortAxisResult.data).map(mapCohortAxis))
    } catch (exception: any) {
      setError(`Chargement des cohortes impossible : ${exception?.message || exception}`)
      setCohortRows([])
      setCohortAxisRows([])
    } finally {
      setLoadingCohorts(false)
    }
  }

  async function rebuildCycle() {
    if (rebuildLoading) return
    if (!window.confirm(`Rebuilder le cycle documents du ${formatDate(dateDebut)} au ${formatDate(dateFin)} avec un horizon de 180 jours ?`)) return

    setRebuildLoading(true)
    setMessage('Rebuild du cycle documents en cours…')
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('rebuild_indicateur_cycle_documents_periode', {
        p_date_debut: dateDebut,
        p_date_fin: dateFin,
        p_horizon_jours: 180,
      })
      if (rpcError) throw rpcError
      setMessage('Rebuild cycle documents terminé. Rechargement des données…')
      await loadOptions()
      await Promise.all([loadData(), loadCohorts()])
      setMessage('Cycle documents à jour.')
    } catch (exception: any) {
      setError(`Rebuild impossible : ${exception?.message || exception}`)
      setMessage(null)
    } finally {
      setRebuildLoading(false)
    }
  }

  function resetFilters() {
    setAgence('')
    setCollaborateur('')
    setFamilleMacro('')
    setFamille('')
    setClient('')
    setStatut('Tous')
  }

  function exportExcel() {
    const n1ByMonth = new Map<string, CohortRow>()
    cohortRows.filter((row) => row.periode === 'N-1').forEach((row) => n1ByMonth.set(addMonths(row.mois, 12), row))

    downloadWorkbook(`cycle_documents_${dateDebut}_${dateFin}.xlsx`, [
      {
        name: 'KPIs',
        rows: kpis ? [{
          'Nb lignes devis': kpis.nb_lignes_devis,
          'CA devis': kpis.ca_devis,
          'CA devis avec CDC': kpis.ca_devis_avec_cdc,
          'CA devis avec BL': kpis.ca_devis_avec_bl,
          'CA devis avec facture': kpis.ca_devis_avec_facture,
          'Taux CDC valeur': kpis.taux_cdc_valeur,
          'Taux BL valeur': kpis.taux_bl_valeur,
          'Taux facture valeur': kpis.taux_facture_valeur,
          'Taux facture nombre': kpis.taux_facture_nombre,
          'Délai moyen facture': kpis.delai_moyen_facture,
          'Délai médian facture': kpis.delai_median_facture,
          'Délai pondéré facture': kpis.delai_pondere_facture,
          'Nb devis à risque': kpis.nb_devis_a_risque,
          'CA devis à risque': kpis.ca_devis_a_risque,
        }] : [],
      },
      {
        name: 'Cohortes mensuelles',
        rows: cohortRows
          .filter((row) => row.periode === 'N')
          .map((row) => {
            const n1 = n1ByMonth.get(row.mois)
            return {
              'Mois devis': row.mois,
              'CA devis': row.ca_devis,
              'Nb lignes': row.nb_lignes,
              'Taux 30 j': row.taux_30,
              'Taux 30 j N-1': n1?.taux_30 ?? null,
              'Couverture 30 j %': row.couverture_30,
              'Taux 60 j': row.taux_60,
              'Taux 60 j N-1': n1?.taux_60 ?? null,
              'Couverture 60 j %': row.couverture_60,
              'Taux 90 j': row.taux_90,
              'Taux 90 j N-1': n1?.taux_90 ?? null,
              'Couverture 90 j %': row.couverture_90,
              [`Taux maturité ${maturite} j`]: row.taux_maturite,
              [`Taux maturité ${maturite} j N-1`]: n1?.taux_maturite ?? null,
              'Couverture maturité %': row.couverture_maturite,
            }
          }),
      },
      {
        name: `Cohortes ${axis}`,
        rows: cohortAxisRows.map((row) => ({
          [AXIS_LABELS[axis]]: row.axe,
          'CA devis': row.ca_devis,
          'CA devis N-1': row.ca_devis_n1,
          'Taux 30 j': row.taux_30,
          'Taux 30 j N-1': row.taux_30_n1,
          'Taux 60 j': row.taux_60,
          'Taux 60 j N-1': row.taux_60_n1,
          'Taux 90 j': row.taux_90,
          'Taux 90 j N-1': row.taux_90_n1,
          [`Taux maturité ${maturite} j`]: row.taux_maturite,
          [`Taux maturité ${maturite} j N-1`]: row.taux_maturite_n1,
        })),
      },
      { name: 'Funnel', rows: funnelRows },
      { name: `Analyse ${axis}`, rows: axisRows },
      { name: 'Top devis', rows: topRows },
      { name: 'Devis à risque', rows: riskRows },
      { name: 'Alertes clients', rows: alertRows },
    ])
  }

  useEffect(() => {
    loadOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateDebut, dateFin, includeHorsStat])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateDebut, dateFin, agence, collaborateur, familleMacro, famille, client, statut, includeHorsStat, axis, ageRisque, montantRisque, seuilAlerte, topMonths])

  useEffect(() => {
    loadCohorts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateDebut, dateFin, agence, collaborateur, familleMacro, famille, client, includeHorsStat, axis, maturite])

  const maxAxisCa = useMemo(() => Math.max(...axisRows.map((row) => row.ca_devis), 1), [axisRows])

  const nCohorts = useMemo(() => cohortRows.filter((row) => row.periode === 'N').sort((a, b) => a.mois.localeCompare(b.mois)), [cohortRows])
  const n1CohortByMonth = useMemo(() => {
    const map = new Map<string, CohortRow>()
    cohortRows.filter((row) => row.periode === 'N-1').forEach((row) => map.set(addMonths(row.mois, 12), row))
    return map
  }, [cohortRows])

  /** Pour chaque âge : dernière cohorte mensuelle complète à cet âge, comparée à N-1 même mois. */
  const latestSignals = useMemo(() => {
    return horizons.map((h) => {
      const latest = [...nCohorts].reverse().find((row) => row[h.key] !== null && isComplete(row[h.coverage]))
      const n1 = latest ? n1CohortByMonth.get(latest.mois) : undefined
      return {
        horizon: h,
        row: latest,
        value: latest ? latest[h.key] : null,
        n1: n1 ? n1[h.key] : null,
        delta: latest ? deltaPoints(latest[h.key], n1?.[h.key] ?? null) : null,
      }
    })
  }, [horizons, nCohorts, n1CohortByMonth])

  return (
    <main className="min-h-screen p-6" style={{ background: C.bg, color: C.text, fontFamily: FONT_BODY }}>
      {/* En-tête */}
      <header className="mb-6 overflow-hidden rounded-2xl border" style={{ background: 'linear-gradient(180deg,#121C33 0%,#0E1628 100%)', borderColor: C.line }}>
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl text-2xl" style={{ background: '#1C2A4A' }}>📈</div>
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-[0.14em]" style={{ fontFamily: FONT_TITLE, color: '#4C6FD8' }}>
                Cycle devis → facture
              </h1>
              <p className="mt-1 text-sm" style={{ color: C.muted }}>
                Transformation des devis par cohorte, délais, devis à risque et alertes clients · {formatDate(dateDebut)} → {formatDate(dateFin)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={rebuildCycle}
              disabled={rebuildLoading}
              className="rounded-full border px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: C.sauge, color: C.sauge, fontFamily: FONT_TITLE }}
            >
              {rebuildLoading ? 'Rebuild…' : '⟳ Rebuild cycle'}
            </button>
            <button
              type="button"
              onClick={() => { loadOptions(); loadData(); loadCohorts() }}
              className="rounded-full border px-4 py-2.5 text-sm font-semibold"
              style={{ borderColor: C.lineStrong, color: C.text, fontFamily: FONT_TITLE }}
            >
              ↻ Actualiser
            </button>
            <button
              type="button"
              onClick={exportExcel}
              className="rounded-full border px-4 py-2.5 text-sm font-semibold"
              style={{ borderColor: C.lineStrong, color: C.text, fontFamily: FONT_TITLE }}
            >
              ⤓ Exporter Excel
            </button>
          </div>
        </div>
        <div className="h-[3px]" style={{ background: '#3B5BDB' }} />
        <div className="px-6 py-4">
          <MacroPills options={options.familles_macro} value={familleMacro} onChange={setFamilleMacro} />
        </div>
      </header>

      {error && <div className="mb-4 rounded-xl border p-4 text-sm font-semibold" style={{ borderColor: 'rgba(217,83,79,0.4)', background: 'rgba(217,83,79,0.12)', color: '#F0928F' }}>{error}</div>}
      {message && <div className="mb-4 rounded-xl border p-4 text-sm font-semibold" style={{ borderColor: 'rgba(91,163,91,0.4)', background: 'rgba(91,163,91,0.12)', color: '#8FD08F' }}>{message}</div>}
      {access.accessBadge && <div className="mb-4 rounded-xl border p-4 text-sm font-semibold" style={{ borderColor: 'rgba(217,164,65,0.4)', background: 'rgba(217,164,65,0.12)', color: '#E8C27A' }}>Périmètre utilisateur appliqué : {access.accessBadge}</div>}
      {(loading || loadingCohorts || loadingOptions || access.loading) && (
        <div className="mb-4 rounded-xl border p-3 text-sm" style={{ borderColor: C.line, background: C.panel, color: C.muted }}>Chargement de l'analyse cycle documents…</div>
      )}

      {/* Filtres */}
      <section className="mb-6 rounded-2xl border p-4" style={{ background: C.panel, borderColor: C.line }}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12">
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Année</span>
            <select value={selectedYear} onChange={(event) => updateYear(Number(event.target.value))} className={FIELD_CLASS}>
              {defaultYearOptions().map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 xl:col-span-2">
            <span className={LABEL_CLASS}>Début</span>
            <input type="date" value={dateDebut} onChange={(event) => setDateDebut(event.target.value)} className={FIELD_CLASS} style={{ colorScheme: 'dark' }} />
          </label>
          <label className="flex flex-col gap-1 xl:col-span-2">
            <span className={LABEL_CLASS}>Fin exclue</span>
            <input type="date" value={dateFin} onChange={(event) => setDateFin(event.target.value)} className={FIELD_CLASS} style={{ colorScheme: 'dark' }} />
          </label>
          <SelectFilter label="Agence" value={effectiveAgence} options={access.hasAgenceRestriction ? access.allowedAgences : visibleAgences} onChange={setAgence} disabled={access.hasAgenceRestriction} />
          <SelectFilter label="Collaborateur" value={effectiveCollaborateur} options={access.hasCollaborateurRestriction ? access.allowedCollaborateurs : visibleCollaborateurs} onChange={setCollaborateur} disabled={access.hasCollaborateurRestriction} />
          <SelectFilter label="Famille" value={famille} options={options.familles} onChange={setFamille} />
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={LABEL_CLASS}>Client</span>
            <input value={client} onChange={(event) => setClient(event.target.value)} placeholder="Code ou nom client" className={FIELD_CLASS} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Axe</span>
            <select value={axis} onChange={(event) => setAxis(event.target.value as AxisType)} className={FIELD_CLASS}>
              {Object.entries(AXIS_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Statut top devis</span>
            <select value={statut} onChange={(event) => setStatut(event.target.value as TransformationStatus)} className={FIELD_CLASS}>
              <option value="Tous">Tous</option>
              {options.statuts.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm" style={{ color: '#C9CEDA' }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeHorsStat} onChange={(event) => setIncludeHorsStat(event.target.checked)} className="accent-[#4C6FD8]" />
            Inclure les articles hors statistique
          </label>
          <label className="flex items-center gap-2">
            Âge risque
            <input type="number" min={1} value={ageRisque} onChange={(event) => setAgeRisque(Number(event.target.value || 30))} className={`${SMALL_FIELD_CLASS} w-20`} />
            jours
          </label>
          <label className="flex items-center gap-2">
            Montant risque
            <input type="number" min={0} step={1000} value={montantRisque} onChange={(event) => setMontantRisque(Number(event.target.value || 0))} className={`${SMALL_FIELD_CLASS} w-28`} />
            €
          </label>
          <label className="flex items-center gap-2">
            Seuil alerte
            <input type="number" min={0} step={5} value={seuilAlerte} onChange={(event) => setSeuilAlerte(Number(event.target.value || 50))} className={`${SMALL_FIELD_CLASS} w-20`} />
            %
          </label>
          <label className="flex items-center gap-2">
            Top devis
            <select value={topMonths} onChange={(event) => setTopMonths(Number(event.target.value))} className={SMALL_FIELD_CLASS}>
              <option value={1}>1 mois</option>
              <option value={2}>2 mois</option>
              <option value={3}>3 mois</option>
            </select>
          </label>
          <button type="button" onClick={resetFilters} className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: C.lineStrong, color: C.text }}>
            Réinitialiser les filtres
          </button>
        </div>
      </section>

      {/* Signal de transformation à âge égal */}
      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {latestSignals.map((signal) => (
          <KpiCard
            key={signal.horizon.key}
            accent={signal.horizon.color}
            title={`Transformation à ${signal.horizon.label.replace('Maturité ', '')}${signal.horizon.key === 'taux_maturite' ? ' (maturité)' : ''}`}
            value={formatPercent(signal.value)}
            subtitle={
              signal.row ? (
                <span>
                  Devis de {formatMonth(signal.row.mois, true)} · N-1 {formatPercent(signal.n1)} ·{' '}
                  <span style={{ color: deltaColor(signal.delta) }}>{formatDelta(signal.delta)}</span>
                </span>
              ) : (
                'Aucune cohorte complète à cet âge'
              )
            }
          />
        ))}
      </section>

      {/* Courbe cohortes */}
      <section className="mb-6">
        <Panel
          accent={C.sauge}
          tag="Transformation devis → commande"
          title="Taux de transformation par cohorte de devis, à âge égal"
          subtitle="Chaque point = les devis émis dans le mois, part du CA transformée en CDC au bout de 30, 60, 90 jours ou à maturité. Trait plein : N · tirets : N-1 même mois · pointillé fin : tendance · point creux : cohorte encore partielle."
          right={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex flex-wrap gap-2">
                {horizons.map((h) => (
                  <PillButton key={h.key} active={selectedHorizons.includes(h.key)} onClick={() => toggleHorizon(h.key)} dot={h.color}>
                    {h.label}
                  </PillButton>
                ))}
              </div>
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              options={MATURITE_OPTIONS.map((value) => ({ value, label: `Maturité ${value} j` }))}
              value={maturite}
              onChange={setMaturite}
            />
            <Segmented
              options={[{ value: 'on', label: 'Avec N-1' }, { value: 'off', label: 'Sans N-1' }]}
              value={showN1 ? 'on' : 'off'}
              onChange={(value) => setShowN1(value === 'on')}
            />
            <Segmented
              options={[{ value: 'on', label: 'Tendance' }, { value: 'off', label: 'Sans tendance' }]}
              value={showTrend ? 'on' : 'off'}
              onChange={(value) => setShowTrend(value === 'on')}
            />
            {familleMacro && (
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: C.lineStrong }}>
                <span className="h-2 w-2 rounded-full" style={{ background: macroColor(familleMacro) }} />
                Filtré sur {familleMacro}
              </span>
            )}
          </div>

          <CohortChart rows={cohortRows} horizons={activeHorizons} showN1={showN1} showTrend={showTrend} />

          {/* Matrice des cohortes */}
          <div className="mt-5">
            <TableShell maxHeight={420}>
              <THead>
                <tr>
                  <th className={`${TH_CLASS} text-left`}>Cohorte</th>
                  <th className={`${TH_CLASS} text-right`}>CA devis</th>
                  {horizons.map((h) => (
                    <th key={h.key} className={`${TH_CLASS} text-right`} colSpan={2}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: h.color }} />
                        {h.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </THead>
              <tbody style={{ fontFamily: FONT_MONO }}>
                {[...nCohorts].reverse().map((row) => {
                  const n1 = n1CohortByMonth.get(row.mois)
                  return (
                    <tr key={row.mois} className="border-t" style={{ borderColor: C.line }}>
                      <td className="px-3 py-2 font-semibold" style={{ fontFamily: FONT_BODY }}>{formatMonth(row.mois, true)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(row.ca_devis, true)}</td>
                      {horizons.map((h) => {
                        const v = row[h.key]
                        const complete = isComplete(row[h.coverage])
                        const d = deltaPoints(v, n1?.[h.key] ?? null)
                        return (
                          <td key={h.key} colSpan={2} className="px-3 py-2 text-right">
                            <span
                              title={v !== null && !complete ? `Cohorte partielle : ${formatNumber(row[h.coverage], 0)} % du CA a atteint cet âge` : undefined}
                              style={{ color: v === null ? C.muted : complete ? C.text : C.muted, fontStyle: complete ? 'normal' : 'italic' }}
                            >
                              {formatPercent(v)}{v !== null && !complete ? '*' : ''}
                            </span>
                            <span className="ml-2 inline-block w-14 text-right text-xs" style={{ color: deltaColor(d) }}>
                              {d === null ? '' : `${d > 0 ? '+' : ''}${formatNumber(d, 1)}`}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {!nCohorts.length && <EmptyRow colSpan={2 + horizons.length * 2} label="Aucune cohorte." />}
              </tbody>
            </TableShell>
            <p className="mt-2 text-xs" style={{ color: C.muted }}>
              Écart en points vs le même mois N-1 au même âge. * cohorte partielle : seuls les devis ayant déjà atteint l'âge sont pris en compte.
            </p>
          </div>
        </Panel>
      </section>

      {/* Transformation par axe, à âge égal */}
      <section className="mb-6">
        <Panel
          accent={C.violet}
          tag={AXIS_LABELS[axis]}
          title={`Transformation à âge égal par ${AXIS_LABELS[axis].toLowerCase()}`}
          subtitle="Sur toute la période sélectionnée, comparé à la même période N-1 au même âge. Changer l'axe dans les filtres (famille macro, collaborateur, agence…)."
        >
          <TableShell maxHeight={520}>
            <THead>
              <tr>
                <th className={`${TH_CLASS} text-left`}>{AXIS_LABELS[axis]}</th>
                <th className={`${TH_CLASS} text-right`}>CA devis</th>
                <th className={`${TH_CLASS} text-right`}>Évol. CA</th>
                {horizons.map((h) => (
                  <th key={h.key} className={`${TH_CLASS} text-right`}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: h.color }} />
                      {h.label}
                    </span>
                  </th>
                ))}
              </tr>
            </THead>
            <tbody>
              {cohortAxisRows.map((row) => {
                const evolCa = row.ca_devis_n1 ? ((row.ca_devis - row.ca_devis_n1) / Math.abs(row.ca_devis_n1)) * 100 : null
                const n1Values: Record<HorizonKey, number | null> = {
                  taux_30: row.taux_30_n1,
                  taux_60: row.taux_60_n1,
                  taux_90: row.taux_90_n1,
                  taux_maturite: row.taux_maturite_n1,
                }
                return (
                  <tr
                    key={row.axe}
                    className="cursor-pointer border-t hover:bg-white/5"
                    style={{ borderColor: C.line }}
                    onClick={() => {
                      if (axis === 'famille_macro') setFamilleMacro(familleMacro === row.axe ? '' : row.axe)
                    }}
                  >
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-2">
                        {axis === 'famille_macro' && <span className="h-2.5 w-2.5 rounded-full" style={{ background: macroColor(row.axe) }} />}
                        <span className="max-w-[260px] truncate">{row.axe}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatCurrency(row.ca_devis, true)}</td>
                    <td className="px-3 py-2 text-right text-xs" style={{ fontFamily: FONT_MONO, color: evolCa === null ? C.muted : evolCa >= 0 ? '#8FD08F' : '#E8A07C' }}>
                      {evolCa === null ? 'Nouveau' : `${evolCa > 0 ? '+' : ''}${formatNumber(evolCa, 1)} %`}
                    </td>
                    {horizons.map((h) => {
                      const d = deltaPoints(row[h.key], n1Values[h.key])
                      return (
                        <td key={h.key} className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>
                          <div>{formatPercent(row[h.key])}</div>
                          <div className="text-[11px]" style={{ color: deltaColor(d) }}>
                            {d === null ? '—' : formatDelta(d)}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {!cohortAxisRows.length && <EmptyRow colSpan={3 + horizons.length} label="Aucune donnée par axe." />}
            </tbody>
          </TableShell>
        </Panel>
      </section>

      {/* KPIs cycle complet */}
      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="CA devis" value={formatCurrency(kpis?.ca_devis, true)} subtitle={`${formatNumber(kpis?.nb_lignes_devis)} lignes devis`} />
        <KpiCard title="Taux devis → CDC" value={formatPercent(kpis?.taux_cdc_valeur)} subtitle={formatCurrency(kpis?.ca_devis_avec_cdc, true)} accent={C.sky} />
        <KpiCard title="Taux devis → BL" value={formatPercent(kpis?.taux_bl_valeur)} subtitle={formatCurrency(kpis?.ca_devis_avec_bl, true)} accent={C.blue} />
        <KpiCard title="Taux devis → facture" value={formatPercent(kpis?.taux_facture_valeur)} subtitle={`${formatPercent(kpis?.taux_facture_nombre)} en nombre`} intent="good" />
        <KpiCard title="Délai facture" value={formatDays(kpis?.delai_pondere_facture)} subtitle={`Moy. ${formatDays(kpis?.delai_moyen_facture)} · méd. ${formatDays(kpis?.delai_median_facture)}`} accent={C.sauge} />
        <KpiCard title="Devis à risque" value={formatNumber(kpis?.nb_devis_a_risque)} subtitle={formatCurrency(kpis?.ca_devis_a_risque, true)} intent={safeNumber(kpis?.nb_devis_a_risque) ? 'warning' : 'neutral'} />
      </section>

      {/* Funnel + analyse par axe */}
      <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel accent={C.sky} tag="Funnel" title="Devis → CDC → BL → Facture" subtitle="Taux calculés sur le CA des devis de la période (tous âges confondus)." className="xl:col-span-2">
          <div className="space-y-3">
            {funnelRows.map((row) => (
              <div key={row.etape} className="rounded-xl border p-3" style={{ borderColor: C.line, background: C.panelSoft }}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold" style={{ fontFamily: FONT_TITLE }}>{row.ordre}. {row.etape}</div>
                    <div className="text-xs" style={{ color: C.muted, fontFamily: FONT_MONO }}>{formatNumber(row.nb_lignes)} lignes · {formatCurrency(row.ca_devis_reference, true)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold" style={{ fontFamily: FONT_TITLE }}>{formatPercent(row.taux_valeur)}</div>
                    <div className="text-xs" style={{ color: C.muted }}>{formatPercent(row.taux_nombre)} en nombre</div>
                  </div>
                </div>
                <ProgressBar value={row.taux_valeur} />
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]" style={{ color: C.muted, fontFamily: FONT_MONO }}>
                  <div>Moy. {formatDays(row.delai_moyen)}</div>
                  <div>Méd. {formatDays(row.delai_median)}</div>
                  <div>Pond. {formatDays(row.delai_pondere)}</div>
                </div>
              </div>
            ))}
            {!funnelRows.length && <div className="rounded-xl p-8 text-center text-sm" style={{ background: C.panelSoft, color: C.muted }}>Aucune donnée funnel.</div>}
          </div>
        </Panel>

        <Panel accent={C.blue} tag={AXIS_LABELS[axis]} title={`Cycle complet par ${AXIS_LABELS[axis].toLowerCase()}`} subtitle="Tri par CA devis décroissant. Taux en valeur, tous âges confondus." className="xl:col-span-3">
          <TableShell maxHeight={560}>
            <THead>
              <tr>
                <th className={`${TH_CLASS} text-left`}>{AXIS_LABELS[axis]}</th>
                <th className={`${TH_CLASS} text-right`}>CA devis</th>
                <th className={`${TH_CLASS} text-right`}>Tx CDC</th>
                <th className={`${TH_CLASS} text-right`}>Tx BL</th>
                <th className={`${TH_CLASS} text-right`}>Tx facture</th>
                <th className={`${TH_CLASS} text-right`}>Délai facture</th>
                <th className={`${TH_CLASS} text-right`}>Risque</th>
              </tr>
            </THead>
            <tbody>
              {axisRows.map((row) => (
                <tr key={row.axe} className="border-t" style={{ borderColor: C.line }}>
                  <td className="px-3 py-2 font-semibold">
                    <div className="flex max-w-[260px] items-center gap-2 truncate">
                      {axis === 'famille_macro' && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: macroColor(row.axe) }} />}
                      {row.axe}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(245,243,236,0.08)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, Math.min(100, (row.ca_devis / maxAxisCa) * 100))}%`,
                          background: axis === 'famille_macro' ? macroColor(row.axe) : C.blue,
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatCurrency(row.ca_devis, true)}</td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatPercent(row.taux_cdc_valeur)}</td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatPercent(row.taux_bl_valeur)}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: FONT_MONO, color: '#8FD08F' }}>{formatPercent(row.taux_facture_valeur)}</td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatDays(row.delai_facture_moyen)}</td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatNumber(row.nb_devis_a_risque)}</td>
                </tr>
              ))}
              {!axisRows.length && <EmptyRow colSpan={7} label="Aucune donnée par axe." />}
            </tbody>
          </TableShell>
        </Panel>
      </section>

      {/* Top devis + devis à risque */}
      <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel accent={C.sauge} tag="Top 30" title="Devis récents" subtitle={`Période top : ${formatDate(topDateDebut)} → ${formatDate(dateFin)}.`}>
          <TableShell maxHeight={520}>
            <THead>
              <tr>
                <th className={`${TH_CLASS} text-right`}>#</th>
                <th className={`${TH_CLASS} text-left`}>Devis</th>
                <th className={`${TH_CLASS} text-left`}>Client</th>
                <th className={`${TH_CLASS} text-left`}>Agence</th>
                <th className={`${TH_CLASS} text-right`}>CA devis</th>
                <th className={`${TH_CLASS} text-center`}>Statut</th>
              </tr>
            </THead>
            <tbody>
              {topRows.map((row) => (
                <tr key={`${row.rang}-${row.numero_devis}-${row.numero_tiers}`} className="border-t" style={{ borderColor: C.line }}>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO, color: C.muted }}>{row.rang}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold" style={{ fontFamily: FONT_MONO }}>{row.numero_devis || '—'}</div>
                    <div className="text-xs" style={{ color: C.muted }}>{formatDate(row.date_devis)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-[260px] truncate font-semibold">{row.intitule_tiers}</div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: macroColor(row.famille_macro_principale) }} />
                      {row.numero_tiers} · {row.famille_macro_principale}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.agence_collaborateur}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: FONT_MONO }}>{formatCurrency(row.ca_devis, true)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadgeClass(row.statut_transformation)}`}>{row.statut_transformation}</span>
                  </td>
                </tr>
              ))}
              {!topRows.length && <EmptyRow colSpan={6} label="Aucun devis récent." />}
            </tbody>
          </TableShell>
        </Panel>

        <Panel accent={C.alerte} tag="Risque" title="Devis à risque" subtitle={`Sans CDC, BL ni facture · âge ≥ ${ageRisque} jours · montant ≥ ${formatCurrency(montantRisque)}.`}>
          <TableShell maxHeight={520}>
            <THead>
              <tr>
                <th className={`${TH_CLASS} text-left`}>Priorité</th>
                <th className={`${TH_CLASS} text-left`}>Devis</th>
                <th className={`${TH_CLASS} text-left`}>Client</th>
                <th className={`${TH_CLASS} text-right`}>Âge</th>
                <th className={`${TH_CLASS} text-right`}>CA devis</th>
              </tr>
            </THead>
            <tbody>
              {riskRows.map((row) => (
                <tr key={`${row.numero_devis}-${row.numero_tiers}`} className="border-t" style={{ borderColor: C.line }}>
                  <td className="px-3 py-2"><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${priorityBadgeClass(row.priorite)}`}>{row.priorite}</span></td>
                  <td className="px-3 py-2">
                    <div className="font-semibold" style={{ fontFamily: FONT_MONO }}>{row.numero_devis || '—'}</div>
                    <div className="text-xs" style={{ color: C.muted }}>{formatDate(row.date_devis)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="max-w-[320px] truncate font-semibold">{row.intitule_tiers}</div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: macroColor(row.famille_macro_principale) }} />
                      {row.agence_collaborateur} · {row.famille_macro_principale}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatNumber(row.age_jours)} j</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: FONT_MONO }}>{formatCurrency(row.ca_devis, true)}</td>
                </tr>
              ))}
              {!riskRows.length && <EmptyRow colSpan={5} label="Aucun devis à risque avec ces paramètres." />}
            </tbody>
          </TableShell>
        </Panel>
      </section>

      {/* Alertes clients */}
      <section className="mb-6">
        <Panel accent={C.violet} tag="Alertes" title="Comportement clients" subtitle={`Période sélectionnée vs même période N-1 · seuil ${seuilAlerte} % · montant minimum ${formatCurrency(montantRisque)}.`}>
          <TableShell>
            <THead>
              <tr>
                <th className={`${TH_CLASS} text-left`}>Alerte</th>
                <th className={`${TH_CLASS} text-left`}>Client</th>
                <th className={`${TH_CLASS} text-left`}>Agence</th>
                <th className={`${TH_CLASS} text-right`}>CA période</th>
                <th className={`${TH_CLASS} text-right`}>CA N-1</th>
                <th className={`${TH_CLASS} text-right`}>Écart</th>
                <th className={`${TH_CLASS} text-right`}>Évol.</th>
                <th className={`${TH_CLASS} text-right`}>Dernier devis</th>
              </tr>
            </THead>
            <tbody>
              {alertRows.map((row) => (
                <tr key={`${row.type_alerte}-${row.numero_tiers}`} className="border-t" style={{ borderColor: C.line }}>
                  <td className="px-3 py-2"><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${alertBadgeClass(row.type_alerte)}`}>{row.type_alerte}</span></td>
                  <td className="px-3 py-2">
                    <div className="max-w-[320px] truncate font-semibold">{row.intitule_tiers}</div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: macroColor(row.famille_macro_principale) }} />
                      {row.numero_tiers} · {row.famille_macro_principale}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.agence_collaborateur}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: FONT_MONO }}>{formatCurrency(row.ca_devis_periode, true)}</td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO, color: C.muted }}>{formatCurrency(row.ca_devis_n1, true)}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: FONT_MONO, color: row.ecart_ca < 0 ? '#E8A07C' : '#8FD08F' }}>{formatCurrency(row.ecart_ca, true)}</td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ fontFamily: FONT_MONO, color: safeNumber(row.evolution_pct) < 0 ? '#E8A07C' : '#8FD08F' }}>{row.evolution_pct === null ? 'Nouveau' : formatPercent(row.evolution_pct)}</td>
                  <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO }}>{formatDateShort(row.dernier_devis)}</td>
                </tr>
              ))}
              {!alertRows.length && <EmptyRow colSpan={8} label="Aucune alerte client avec ces paramètres." />}
            </tbody>
          </TableShell>
        </Panel>
      </section>
    </main>
  )
}
