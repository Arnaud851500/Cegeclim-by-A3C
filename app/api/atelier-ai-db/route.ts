import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  hasDetailedStructuredFilters,
  normalizeAssistantBiStructuredFilters,
  type AssistantBiStructuredFilters,
} from '@/lib/ai/assistantBiStructuredFilters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const SUMMARY_SAMPLE_ROWS = 200

type JsonObject = Record<string, any>
type DataRow = Record<string, unknown>
type SortMode = 'dimensions_asc' | 'measure_desc' | 'measure_asc'
type ArticleFlow = 'ALL' | 'FACTURE' | 'BL' | 'DEVIS' | 'CDC'
type SourceMode = 'aggregate' | 'flux_articles' | 'detailed' | 'client_creation'

type SourcePlan = {
  mode: SourceMode
  table: string
  title: string
  detail: string
  flow: ArticleFlow
  warnings: string[]
}

type QueryResult = {
  rows: DataRow[]
  sql: string
  repaired: boolean
  reason: string
  visualization: JsonObject | null
  sourcePlan?: SourcePlan
}

const SCHEMA: Record<string, string[]> = {
  indicateur_factures_mensuel: ['annee', 'mois', 'collaborateur_facture', 'collaborateur_tiers', 'agence_collaborateur', 'depot', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille', 'famille_macro', 'hors_statistique', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
  indicateur_activite_mensuel: ['annee', 'mois', 'type_document', 'collaborateur_facture', 'collaborateur_tiers', 'agence_collaborateur', 'depot', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille', 'famille_macro', 'hors_statistique', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
  indicateur_devis_mensuel: ['annee', 'mois', 'collaborateur_facture', 'collaborateur_tiers', 'agence_collaborateur', 'depot', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille', 'famille_macro', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
  indicateur_flux_articles_mensuel: ['annee', 'mois', 'flux', 'type_document', 'depot', 'collaborateur_tiers', 'famille_macro', 'famille', 'reference_article', 'designation', 'hors_statistique', 'nb_lignes', 'quantite', 'quantite_pertinente', 'ca_ht', 'marge_valeur'],
  facture_lignes: ['type_document', 'numero_piece', 'date_facture', 'date_bl', 'date_bc', 'numero_tiers_entete', 'intitule_tiers_entete', 'reference_article', 'designation', 'quantite', 'montant_ht', 'marge_valeur', 'collaborateur', 'depot'],
  devis_lignes: ['type_document', 'numero_piece', 'date_devis', 'numero_tiers_entete', 'intitule_tiers_entete', 'reference_article', 'designation', 'quantite', 'montant_ht', 'marge_valeur', 'collaborateur', 'depot'],
  activite_lignes: ['type_document', 'numero_piece', 'date_piece', 'date_bl', 'date_bc', 'numero_tiers_entete', 'intitule_tiers_entete', 'reference_article', 'designation', 'quantite', 'montant_ht', 'marge_valeur', 'collaborateur', 'depot'],
  ref_tiers: ['numero', 'intitule', 'code_postal', 'representant', 'date_creation', 'prospect', 'mise_en_sommeil'],
  ref_collaborateurs: ['nom', 'agence'],
  ref_articles: ['reference_article', 'designation', 'famille', 'hors_statistique'],
  ref_familles: ['famille', 'famille_macro'],
  v_stock_projection_alertes_abc: ['reference_article', 'classe_abc_ca', 'classe_abc_lignes', 'run_created_at', 'run_completed_at'],
}

const ALLOWED_TABLES = new Set(Object.keys(SCHEMA))
const ALLOWED_JOIN_TARGETS = new Set(['ref_tiers', 'ref_collaborateurs', 'ref_articles', 'ref_familles', 'v_stock_projection_alertes_abc'])

const LABELS: Record<string, string> = {
  annee: 'Année', mois: 'Mois', annee_creation_client: 'Année de création client',
  agence_collaborateur: 'Agence', depot: 'Dépôt', collaborateur_facture: 'Collaborateur du document',
  collaborateur_tiers: 'Collaborateur du client', departement_tiers: 'Département client',
  famille_macro: 'Famille macro', famille: 'Famille', classe_abc_ca: 'Classe ABC CA',
  classe_abc_lignes: 'Classe ABC lignes', type_document: 'Type de document', numero_tiers: 'Code client',
  intitule_tiers: 'Client', reference_article: 'Référence article', designation: 'Désignation',
  ca_ht: 'CA HT', marge_valeur: 'Marge €', marge_pct: 'Marge %', quantite: 'Quantité',
  quantite_pertinente: 'Quantité pertinente', nb_lignes: 'Nombre de lignes', panier_moyen: 'Panier moyen',
  nb_clients_crees: 'Nouveaux clients', evolution_pct: 'Évolution %',
}

const ARTICLE_DIMENSIONS = new Set(['famille_macro', 'famille', 'reference_article', 'designation', 'classe_abc_ca', 'classe_abc_lignes'])
const FLUX_UNSUPPORTED_DIMENSIONS = new Set(['departement_tiers', 'numero_tiers', 'intitule_tiers', 'collaborateur_facture', 'annee_creation_client'])

const json = (value: Record<string, unknown>, status = 200) => NextResponse.json(value, { status })

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function supabaseAdmin() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function label(key: string) {
  return LABELS[key] || key.replaceAll('_', ' ')
}

function toRows(value: unknown): DataRow[] {
  if (Array.isArray(value)) return value.filter((item): item is DataRow => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  return value && typeof value === 'object' ? [value as DataRow] : []
}

async function execute(sql: string) {
  const { data, error } = await supabaseAdmin().rpc('atelier_ai_run_readonly_sql', { p_sql: sql })
  if (error) throw new Error(error.message)
  return toRows(data)
}

function parseJson(text: string): JsonObject {
  const source = String(text || '').trim()
  try {
    return JSON.parse(source)
  } catch {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) return JSON.parse(fenced.trim())
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1))
    throw new Error('Réponse IA non JSON.')
  }
}

async function openAi(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.03, response_format: { type: 'json_object' }, messages }),
  })
  const payload = await response.json().catch(() => ({})) as JsonObject
  if (!response.ok) throw new Error(payload?.error?.message || `Erreur OpenAI ${response.status}`)
  return parseJson(payload?.choices?.[0]?.message?.content || '{}')
}

function cleanSql(value: string) {
  return String(value || '').trim().replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').replace(/;\s*$/, '').trim()
}

function removeResultLimits(sql: string) {
  return sql.replace(/\s+limit\s+\d+(?:\s+offset\s+\d+)?/gi, '').replace(/\s+fetch\s+(?:first|next)\s+\d+\s+rows?\s+only/gi, '').trim()
}

function validateSql(value: string) {
  const sql = removeResultLimits(cleanSql(value))
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('SQL SELECT attendu.')
  if (/;|--|\/\*/.test(sql)) throw new Error('Commentaires et instructions multiples interdits.')
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|refresh)\b/i.test(sql)) {
    throw new Error('Instruction SQL non autorisée.')
  }
  const ctes = new Set([...sql.matchAll(/(?:\bwith\b|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((match) => match[1].toLowerCase()))
  const sqlForRelations = sql.replace(/EXTRACT\s*\(\s*(YEAR|MONTH|DAY|QUARTER)\s+FROM\s+/gi, 'EXTRACT($1 __DATE_FROM__ ')
  const relations = [...sqlForRelations.matchAll(/\b(from|join)\s+((?:public\.)?[a-zA-Z_][a-zA-Z0-9_]*)/gi)]
  for (const relation of relations) {
    const keyword = relation[1].toLowerCase()
    const table = relation[2].replace(/^public\./i, '').toLowerCase()
    if (!ALLOWED_TABLES.has(table) && !ctes.has(table)) throw new Error(`Table non autorisée : ${table}`)
    if (keyword === 'join' && ALLOWED_TABLES.has(table) && !ALLOWED_JOIN_TARGETS.has(table)) throw new Error(`JOIN non autorisé vers ${table}.`)
  }
  return sql
}

const quote = (value: unknown) => `'${String(value ?? '').replaceAll("'", "''")}'`
const normalizedStrings = (values: unknown[]) => values.map(String).map((value) => value.trim()).filter(Boolean)

function inSql(column: string, values: unknown[]) {
  const list = normalizedStrings(values)
  return list.length ? `${column} IN (${list.map(quote).join(', ')})` : ''
}

function notInSql(column: string, values: unknown[]) {
  const list = normalizedStrings(values)
  return list.length ? `${column} NOT IN (${list.map(quote).join(', ')})` : ''
}

function textMatchSql(columns: string[], values: string[], negate = false) {
  const list = normalizedStrings(values)
  if (!list.length) return ''
  const comparisons = list.map((value) => `(${columns.map((column) => `UPPER(BTRIM(COALESCE(${column}::text, ''))) = UPPER(${quote(value)})`).join(' OR ')})`)
  return negate ? `NOT (${comparisons.join(' OR ')})` : `(${comparisons.join(' OR ')})`
}

function structuredFilters(body: JsonObject) {
  return normalizeAssistantBiStructuredFilters(body?.globalFilters?.interpretedFreeText)
}

function normalizeSortMode(value: unknown): SortMode {
  return value === 'measure_desc' || value === 'measure_asc' ? value : 'dimensions_asc'
}

function effectiveSortMode(body: JsonObject, filters: AssistantBiStructuredFilters): SortMode {
  return normalizeSortMode(filters.sortMode || body?.globalFilters?.sortMode)
}

function orderBySql(dimensions: string[], firstMeasure: string, sortMode: SortMode) {
  if (sortMode === 'measure_desc') return `${firstMeasure} DESC NULLS LAST`
  if (sortMode === 'measure_asc') return `${firstMeasure} ASC NULLS LAST`
  return dimensions.join(', ')
}

function appendTopN(sql: string, filters: AssistantBiStructuredFilters) {
  return filters.topN ? `${sql}\nLIMIT ${filters.topN}` : sql
}

function pushCondition(where: string[], condition: string) {
  if (condition) where.push(condition)
}

function explicitMonths(question: string) {
  const text = question.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const names: Array<[RegExp, number]> = [
    [/\bjanv(?:ier)?\b/, 1], [/\bfevr(?:ier)?\b/, 2], [/\bmars\b/, 3], [/\bavr(?:il)?\b/, 4],
    [/\bmai\b/, 5], [/\bjuin\b/, 6], [/\bjuil(?:let)?\b/, 7], [/\baout\b/, 8],
    [/\bsept(?:embre)?\b/, 9], [/\boct(?:obre)?\b/, 10], [/\bnov(?:embre)?\b/, 11], [/\bdec(?:embre)?\b/, 12],
  ]
  return names.filter(([pattern]) => pattern.test(text)).map(([, month]) => month)
}

function wantsEvolution(question: string) {
  return /\b(?:évolution|evolution|écart|ecart|variation)\b/i.test(question) && /%|pourcentage/i.test(question)
}

function normalizeFlow(value: unknown): ArticleFlow {
  const upper = String(value || '').trim().toUpperCase()
  return upper === 'FACTURE' || upper === 'BL' || upper === 'DEVIS' || upper === 'CDC' ? upper : 'ALL'
}

function requestedFlow(body: JsonObject, subject: string): ArticleFlow {
  const explicit = normalizeFlow(body?.dataContext?.analysisBasis?.articleFlow)
  if (explicit !== 'ALL') return explicit
  const free = structuredFilters(body)
  const types = [...free.includeDocumentTypes, ...(Array.isArray(body?.globalFilters?.typesDocument) ? body.globalFilters.typesDocument : [])]
  for (const type of types) {
    const normalized = normalizeFlow(type)
    if (normalized !== 'ALL') return normalized
  }
  if (subject === 'factures' || subject === 'clients') return 'FACTURE'
  if (subject === 'devis') return 'DEVIS'
  if (subject === 'ventes_bl') return 'BL'
  return 'ALL'
}

function isAdminScope(body: JsonObject) {
  const code = `${body?.globalFilters?.accessProfileCode || ''} ${body?.globalFilters?.accessProfileName || ''}`.toUpperCase()
  return code.includes('ADMIN')
}

function aggregateSource(subject: string) {
  if (subject === 'factures' || subject === 'clients') return 'indicateur_factures_mensuel'
  if (subject === 'devis') return 'indicateur_devis_mensuel'
  return 'indicateur_activite_mensuel'
}

function needsClientCreation(dimensions: string[], measures: string[]) {
  return measures.includes('nb_clients_crees') || dimensions.includes('annee_creation_client')
}

function hasArticleDimension(dimensions: string[]) {
  return dimensions.some((key) => ARTICLE_DIMENSIONS.has(key))
}

function planSource(body: JsonObject, dimensions: string[], measures: string[]): SourcePlan {
  const subject = String(body?.dataContext?.semanticSubject?.key || '')
  const flow = requestedFlow(body, subject)
  const warnings: string[] = []

  if (needsClientCreation(dimensions, measures)) {
    return { mode: 'client_creation', table: 'ref_tiers', title: 'Référentiel clients', detail: 'Créations depuis ref_tiers.date_creation, enrichies par le collaborateur et son agence.', flow: 'ALL', warnings }
  }

  const articleAnalysis = subject === 'articles' || hasArticleDimension(dimensions)
  if (articleAnalysis) {
    const unsupported = dimensions.filter((key) => FLUX_UNSUPPORTED_DIMENSIONS.has(key))
    const free = structuredFilters(body)
    const explicitDepartmentFilter = free.includeDepartments.length || free.excludeDepartments.length

    if (subject === 'factures' && unsupported.length) {
      return { mode: 'detailed', table: 'facture_lignes', title: 'Facturation détaillée par article', detail: 'facture_lignes enrichie par les référentiels client, collaborateur, article et famille.', flow: 'FACTURE', warnings }
    }
    if (subject === 'devis' && unsupported.length) {
      return { mode: 'detailed', table: 'devis_lignes', title: 'Devis détaillés par article', detail: 'devis_lignes enrichie par les référentiels client, collaborateur, article et famille.', flow: 'DEVIS', warnings }
    }
    if (unsupported.length) {
      throw new Error(`${unsupported.map(label).join(', ')} n'est pas disponible dans Flux Articles. Choisis le sujet Factures pour un croisement article/client ou article/département.`)
    }
    if (explicitDepartmentFilter) {
      throw new Error('Un filtre département explicite ne peut pas être appliqué à Flux Articles, car le département client n’est pas stocké dans cet agrégat.')
    }

    const globalDepartments = Array.isArray(body?.globalFilters?.departementsTiers) ? body.globalFilters.departementsTiers : []
    if (globalDepartments.length && isAdminScope(body)) {
      warnings.push('Le profil administrateur possède un périmètre département, mais Flux Articles ne porte pas cette dimension. Les filtres agence et collaborateur restent appliqués.')
    } else if (globalDepartments.length) {
      throw new Error('Flux Articles ne permet pas encore de sécuriser un périmètre limité par département. Utilise le sujet Factures ou demande l’extension du modèle Flux Articles.')
    }

    const flowLabel = flow === 'ALL' ? 'tous flux' : `flux ${flow}`
    return {
      mode: 'flux_articles',
      table: 'indicateur_flux_articles_mensuel',
      title: `Flux Articles — ${flowLabel}`,
      detail: `Source canonique indicateur_flux_articles_mensuel${flow === 'ALL' ? '' : ` filtrée sur flux = ${flow}`}. Elle combine les sources avec les règles de signes et de dates du rebuild Flux Articles.`,
      flow,
      warnings,
    }
  }

  const free = structuredFilters(body)
  if (hasDetailedStructuredFilters(free)) {
    if (subject === 'factures' || subject === 'clients') return { mode: 'detailed', table: 'facture_lignes', title: 'Facturation détaillée', detail: 'facture_lignes enrichie par les référentiels.', flow: 'FACTURE', warnings }
    if (subject === 'devis') return { mode: 'detailed', table: 'devis_lignes', title: 'Devis détaillés', detail: 'devis_lignes enrichie par les référentiels.', flow: 'DEVIS', warnings }
    return { mode: 'detailed', table: 'activite_lignes', title: 'Activité détaillée', detail: 'activite_lignes enrichie par les référentiels.', flow, warnings }
  }

  const table = aggregateSource(subject)
  const titles: Record<string, string> = {
    indicateur_factures_mensuel: 'Agrégat mensuel Factures',
    indicateur_devis_mensuel: 'Agrégat mensuel Devis',
    indicateur_activite_mensuel: subject === 'ventes_bl' ? 'Agrégat mensuel Activité — BL' : 'Agrégat mensuel Activité',
  }
  return { mode: 'aggregate', table, title: titles[table], detail: `Source ${table}.`, flow, warnings }
}

function aggregateMetric(key: string, columns: string[]) {
  if (key === 'ca_ht' && columns.includes(key)) return 'SUM(ca_ht) AS ca_ht'
  if (key === 'quantite' && columns.includes(key)) return 'SUM(quantite) AS quantite'
  if (key === 'quantite_pertinente' && columns.includes(key)) return 'SUM(quantite_pertinente) AS quantite_pertinente'
  if (key === 'marge_valeur' && columns.includes(key)) return 'SUM(marge_valeur) AS marge_valeur'
  if (key === 'nb_lignes' && columns.includes(key)) return 'SUM(nb_lignes) AS nb_lignes'
  if (key === 'panier_moyen' && columns.includes('ca_ht') && columns.includes('nb_lignes')) return 'CASE WHEN SUM(nb_lignes) <> 0 THEN SUM(ca_ht) / SUM(nb_lignes) ELSE 0 END AS panier_moyen'
  if (key === 'marge_pct' && columns.includes('marge_valeur') && columns.includes('ca_ht')) return 'CASE WHEN SUM(ca_ht) <> 0 THEN SUM(marge_valeur) / SUM(ca_ht) * 100 ELSE 0 END AS marge_pct'
  return ''
}

function normalizedDocumentCondition(column: string, types: unknown[]) {
  const normalized = normalizedStrings(types).map((value) => value.toUpperCase())
  if (!normalized.length) return ''
  const expressions: string[] = []
  for (const type of normalized) {
    if (type === 'BL') expressions.push(`UPPER(BTRIM(COALESCE(${column}::text, ''))) IN ('BL','BON DE LIVRAISON','BL M-X','BL MX')`)
    else if (type === 'BR') expressions.push(`UPPER(BTRIM(COALESCE(${column}::text, ''))) IN ('BR','BON DE RETOUR')`)
    else if (type === 'CDC') expressions.push(`UPPER(BTRIM(COALESCE(${column}::text, ''))) IN ('CDC','BON DE COMMANDE')`)
    else if (type === 'PL') expressions.push(`UPPER(BTRIM(COALESCE(${column}::text, ''))) IN ('PL','PRÉPARATION DE LIVRAISON','PREPARATION DE LIVRAISON')`)
    else expressions.push(`UPPER(BTRIM(COALESCE(${column}::text, ''))) = ${quote(type)}`)
  }
  return `(${expressions.join(' OR ')})`
}

function applyAggregateStructuredFilters(where: string[], filters: AssistantBiStructuredFilters, columns: string[]) {
  if (filters.includeYears.length) pushCondition(where, inSql('annee', filters.includeYears))
  if (filters.excludeYears.length) pushCondition(where, notInSql('annee', filters.excludeYears))
  const mappings: Array<[string, string[], string[]]> = [
    ['agence_collaborateur', filters.includeAgencies, filters.excludeAgencies],
    ['departement_tiers', filters.includeDepartments, filters.excludeDepartments],
    ['famille_macro', filters.includeFamilyMacros, filters.excludeFamilyMacros],
    ['famille', filters.includeFamilies, filters.excludeFamilies],
    ['reference_article', filters.includeReferences, filters.excludeReferences],
  ]
  for (const [column, included, excluded] of mappings) {
    if (!columns.includes(column)) continue
    pushCondition(where, inSql(column, included))
    pushCondition(where, notInSql(column, excluded))
  }
  if (columns.includes('type_document')) {
    pushCondition(where, normalizedDocumentCondition('type_document', filters.includeDocumentTypes))
    if (filters.excludeDocumentTypes.length) pushCondition(where, `NOT ${normalizedDocumentCondition('type_document', filters.excludeDocumentTypes)}`)
  }
  if (columns.includes('numero_tiers') || columns.includes('intitule_tiers')) {
    const clientColumns = ['numero_tiers', 'intitule_tiers'].filter((column) => columns.includes(column))
    pushCondition(where, textMatchSql(clientColumns, filters.includeClients))
    pushCondition(where, textMatchSql(clientColumns, filters.excludeClients, true))
  }
}

function visualization(kind: string, dimensions: string[], measureKeys: string[]) {
  const kinds: Record<string, string> = { tableau: 'table', courbe: 'line', histogramme: 'bar', histogramme_empile: 'stacked_bar', camembert: 'pie' }
  return {
    kind: kinds[kind] || 'table',
    title: `${label(measureKeys[0] || '')} par ${label(dimensions[0] || '')}${dimensions[1] ? ` et ${label(dimensions[1])}` : ''}`,
    xKey: dimensions[0], stackBy: dimensions[1] || undefined, valueKey: measureKeys[0], yKeys: measureKeys, columns: [...dimensions, ...measureKeys],
  }
}

function periodConditions(where: string[], period: JsonObject, question: string, yearExpression = 'annee', monthExpression = 'mois') {
  const start = String(period.dateStart || '').slice(0, 7).replace('-', '')
  const end = String(period.dateEnd || '').slice(0, 7).replace('-', '')
  if (/^\d{6}$/.test(start) && /^\d{6}$/.test(end) && yearExpression === 'annee' && monthExpression === 'mois') {
    where.push(`(annee * 100 + mois) BETWEEN ${Math.min(Number(start), Number(end))} AND ${Math.max(Number(start), Number(end))}`)
  }
  const months = explicitMonths(question)
  if (months.length) pushCondition(where, inSql(monthExpression, months))
}

function aggregateQuery(body: JsonObject, dimensions: string[], wanted: string[], kind: string, plan: SourcePlan): QueryResult {
  const table = plan.table
  const columns = SCHEMA[table] || []
  const missing = dimensions.find((key) => !columns.includes(key))
  if (missing) throw new Error(`${label(missing)} n'existe pas dans ${table}. Une source détaillée est nécessaire.`)
  const metrics = wanted.map((key) => ({ key, sql: aggregateMetric(key, columns) })).filter((item) => Boolean(item.sql))
  if (!metrics.length) throw new Error('Aucune mesure disponible dans cette source.')

  const globals = body?.globalFilters || {}
  const free = structuredFilters(body)
  const period = body?.dataContext?.activeTemporalContext || {}
  const question = String(body?.question || '')
  const where: string[] = []
  periodConditions(where, period, question)
  if (columns.includes('hors_statistique') && String(globals.horsStatistique || 'non') === 'non') where.push('hors_statistique = FALSE')
  const scoped = [
    { column: 'agence_collaborateur', values: Array.isArray(globals.agences) ? globals.agences : [] },
    { column: 'departement_tiers', values: Array.isArray(globals.departementsTiers) ? globals.departementsTiers : [] },
    { column: 'collaborateur_tiers', values: Array.isArray(globals.collaborateursTiers) ? globals.collaborateursTiers : [] },
  ]
  for (const item of scoped) {
    if (!item.values.length || !columns.includes(item.column)) continue
    pushCondition(where, inSql(item.column, item.values))
  }
  const types = Array.isArray(globals.typesDocument) ? globals.typesDocument : []
  if (types.length && columns.includes('type_document')) pushCondition(where, normalizedDocumentCondition('type_document', types))
  applyAggregateStructuredFilters(where, free, columns)

  const measureKeys = metrics.map((item) => item.key)
  const order = orderBySql(dimensions, measureKeys[0], effectiveSortMode(body, free))
  const baseSql = validateSql(`SELECT\n  ${[...dimensions, ...metrics.map((item) => item.sql)].join(',\n  ')}\nFROM public.${table}${where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''}\nGROUP BY ${dimensions.join(', ')}\nORDER BY ${order}`)
  return { rows: [], sql: appendTopN(baseSql, free), repaired: false, reason: `${plan.title}. ${plan.detail}`, visualization: visualization(kind, dimensions, measureKeys), sourcePlan: plan }
}

function fluxDimension(key: string) {
  const expressions: Record<string, string> = {
    mois: 'fa.mois', annee: 'fa.annee',
    agence_collaborateur: "COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')",
    depot: "COALESCE(NULLIF(BTRIM(fa.depot::text), ''), 'NON RENSEIGNE')",
    collaborateur_tiers: "COALESCE(NULLIF(BTRIM(fa.collaborateur_tiers::text), ''), 'NON AFFECTE')",
    famille_macro: "COALESCE(NULLIF(BTRIM(fa.famille_macro::text), ''), 'NON RENSEIGNE')",
    famille: "COALESCE(NULLIF(BTRIM(fa.famille::text), ''), 'NON RENSEIGNE')",
    reference_article: "COALESCE(NULLIF(BTRIM(fa.reference_article::text), ''), 'NON RENSEIGNE')",
    designation: "COALESCE(NULLIF(BTRIM(fa.designation::text), ''), 'NON RENSEIGNE')",
    type_document: "COALESCE(NULLIF(BTRIM(fa.flux::text), ''), 'NON RENSEIGNE')",
    classe_abc_ca: "COALESCE(NULLIF(BTRIM(abc.classe_abc_ca::text), ''), 'NON CLASSE')",
    classe_abc_lignes: "COALESCE(NULLIF(BTRIM(abc.classe_abc_lignes::text), ''), 'NON CLASSE')",
  }
  if (!expressions[key]) throw new Error(`${label(key)} n'est pas disponible dans Flux Articles.`)
  return expressions[key]
}

function fluxMetric(key: string) {
  if (key === 'ca_ht') return 'SUM(COALESCE(fa.ca_ht, 0)) AS ca_ht'
  if (key === 'quantite') return 'SUM(COALESCE(fa.quantite, 0)) AS quantite'
  if (key === 'quantite_pertinente') return 'SUM(COALESCE(fa.quantite_pertinente, 0)) AS quantite_pertinente'
  if (key === 'marge_valeur') return 'SUM(COALESCE(fa.marge_valeur, 0)) AS marge_valeur'
  if (key === 'nb_lignes') return 'SUM(COALESCE(fa.nb_lignes, 0)) AS nb_lignes'
  if (key === 'panier_moyen') return 'CASE WHEN SUM(COALESCE(fa.nb_lignes, 0)) <> 0 THEN SUM(COALESCE(fa.ca_ht, 0)) / SUM(COALESCE(fa.nb_lignes, 0)) ELSE 0 END AS panier_moyen'
  if (key === 'marge_pct') return 'CASE WHEN SUM(COALESCE(fa.ca_ht, 0)) <> 0 THEN SUM(COALESCE(fa.marge_valeur, 0)) / SUM(COALESCE(fa.ca_ht, 0)) * 100 ELSE 0 END AS marge_pct'
  return ''
}

function fluxArticleQuery(body: JsonObject, dimensions: string[], wanted: string[], kind: string, plan: SourcePlan): QueryResult {
  const dimensionExpressions = dimensions.map((key) => ({ key, expression: fluxDimension(key) }))
  const metrics = wanted.map((key) => ({ key, sql: fluxMetric(key) })).filter((item) => Boolean(item.sql))
  if (!metrics.length) throw new Error('Aucune mesure disponible dans Flux Articles.')

  const globals = body?.globalFilters || {}
  const free = structuredFilters(body)
  const period = body?.dataContext?.activeTemporalContext || {}
  const question = String(body?.question || '')
  const where: string[] = []
  const start = String(period.dateStart || '').slice(0, 7).replace('-', '')
  const end = String(period.dateEnd || '').slice(0, 7).replace('-', '')
  if (/^\d{6}$/.test(start) && /^\d{6}$/.test(end)) where.push(`(fa.annee * 100 + fa.mois) BETWEEN ${Math.min(Number(start), Number(end))} AND ${Math.max(Number(start), Number(end))}`)
  const months = explicitMonths(question)
  if (months.length) pushCondition(where, inSql('fa.mois', months))
  if (String(globals.horsStatistique || 'non') === 'non') where.push('COALESCE(fa.hors_statistique, FALSE) = FALSE')
  if (plan.flow !== 'ALL') pushCondition(where, inSql('fa.flux', [plan.flow]))

  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", Array.isArray(globals.agences) ? globals.agences : []))
  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(fa.collaborateur_tiers::text), ''), 'NON AFFECTE')", Array.isArray(globals.collaborateursTiers) ? globals.collaborateursTiers : []))
  if (free.includeYears.length) pushCondition(where, inSql('fa.annee', free.includeYears))
  if (free.excludeYears.length) pushCondition(where, notInSql('fa.annee', free.excludeYears))
  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", free.includeAgencies))
  pushCondition(where, notInSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", free.excludeAgencies))
  pushCondition(where, inSql("BTRIM(COALESCE(fa.famille_macro::text, ''))", free.includeFamilyMacros))
  pushCondition(where, notInSql("BTRIM(COALESCE(fa.famille_macro::text, ''))", free.excludeFamilyMacros))
  pushCondition(where, inSql("BTRIM(COALESCE(fa.famille::text, ''))", free.includeFamilies))
  pushCondition(where, notInSql("BTRIM(COALESCE(fa.famille::text, ''))", free.excludeFamilies))
  pushCondition(where, inSql("BTRIM(COALESCE(fa.reference_article::text, ''))", free.includeReferences))
  pushCondition(where, notInSql("BTRIM(COALESCE(fa.reference_article::text, ''))", free.excludeReferences))
  if (free.includeDocumentTypes.length) pushCondition(where, inSql('fa.flux', free.includeDocumentTypes.map((value) => normalizeFlow(value)).filter((value) => value !== 'ALL')))
  if (free.excludeDocumentTypes.length) pushCondition(where, notInSql('fa.flux', free.excludeDocumentTypes.map((value) => normalizeFlow(value)).filter((value) => value !== 'ALL')))

  const needsAbc = dimensions.some((key) => key === 'classe_abc_ca' || key === 'classe_abc_lignes')
  const abcCte = needsAbc ? `WITH abc_current AS (\n  SELECT DISTINCT ON (reference_article) reference_article, classe_abc_ca, classe_abc_lignes\n  FROM public.v_stock_projection_alertes_abc\n  WHERE reference_article IS NOT NULL\n  ORDER BY reference_article, run_completed_at DESC NULLS LAST, run_created_at DESC NULLS LAST\n)\n` : ''
  const abcJoin = needsAbc
    ? '\nLEFT JOIN abc_current abc ON BTRIM(abc.reference_article::text) = BTRIM(fa.reference_article::text)'
    : '\nLEFT JOIN (SELECT NULL::text AS reference_article, NULL::text AS classe_abc_ca, NULL::text AS classe_abc_lignes) abc ON FALSE'

  const group = dimensionExpressions.map((_item, index) => String(index + 1)).join(', ')
  const measureKeys = metrics.map((item) => item.key)
  const sortMode = effectiveSortMode(body, free)
  const order = sortMode === 'dimensions_asc' ? group : `${measureKeys[0]} ${sortMode === 'measure_desc' ? 'DESC' : 'ASC'} NULLS LAST`
  const baseSql = validateSql(`${abcCte}SELECT\n  ${[...dimensionExpressions.map((item) => `${item.expression} AS ${item.key}`), ...metrics.map((item) => item.sql)].join(',\n  ')}\nFROM public.indicateur_flux_articles_mensuel fa\nLEFT JOIN public.ref_collaborateurs c ON BTRIM(c.nom::text) = BTRIM(fa.collaborateur_tiers::text)${abcJoin}${where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''}\nGROUP BY ${group}\nORDER BY ${order}`)
  return { rows: [], sql: appendTopN(baseSql, free), repaired: false, reason: `${plan.title}. ${plan.detail}`, visualization: visualization(kind, dimensions, measureKeys), sourcePlan: plan }
}

function safeDate(alias: string, column: string) {
  return `NULLIF(BTRIM(${alias}.${column}::text), '')::date`
}

function postalDigits(alias = 't') {
  return `REGEXP_REPLACE(COALESCE(${alias}.code_postal::text, ''), '[^0-9]', '', 'g')`
}

function departmentExpression(alias = 't') {
  const digits = postalDigits(alias)
  return `CASE WHEN ${digits} ~ '^(971|972|973|974|975|976|977|978|984|986|987|988)' THEN LEFT(${digits}, 3) ELSE LEFT(LPAD(${digits}, 5, '0'), 2) END`
}

function detailSource(plan: SourcePlan) {
  if (plan.table === 'facture_lignes') return { table: plan.table, date: safeDate('l', 'date_facture'), kind: 'facture' as const }
  if (plan.table === 'devis_lignes') return { table: plan.table, date: safeDate('l', 'date_devis'), kind: 'devis' as const }
  return { table: 'activite_lignes', date: `COALESCE(${safeDate('l', 'date_piece')}, ${safeDate('l', 'date_bl')})`, kind: 'activite' as const }
}

function detailedDimension(key: string, dateExpression: string) {
  const department = departmentExpression('t')
  const expressions: Record<string, string> = {
    mois: `EXTRACT(MONTH FROM ${dateExpression})::int`, annee: `EXTRACT(YEAR FROM ${dateExpression})::int`,
    agence_collaborateur: "COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')",
    depot: "COALESCE(NULLIF(BTRIM(l.depot::text), ''), 'NON RENSEIGNE')",
    collaborateur_facture: "COALESCE(NULLIF(BTRIM(l.collaborateur::text), ''), 'NON RENSEIGNE')",
    collaborateur_tiers: "COALESCE(NULLIF(BTRIM(t.representant::text), ''), 'NON RENSEIGNE')",
    departement_tiers: `COALESCE(NULLIF(${department}, ''), 'NON RENSEIGNE')`,
    famille_macro: "COALESCE(NULLIF(BTRIM(f.famille_macro::text), ''), 'NON RENSEIGNE')",
    famille: "COALESCE(NULLIF(BTRIM(a.famille::text), ''), 'NON RENSEIGNE')",
    classe_abc_ca: "COALESCE(NULLIF(BTRIM(abc.classe_abc_ca::text), ''), 'NON CLASSE')",
    classe_abc_lignes: "COALESCE(NULLIF(BTRIM(abc.classe_abc_lignes::text), ''), 'NON CLASSE')",
    numero_tiers: "COALESCE(NULLIF(BTRIM(l.numero_tiers_entete::text), ''), 'NON RENSEIGNE')",
    intitule_tiers: "COALESCE(NULLIF(BTRIM(l.intitule_tiers_entete::text), ''), 'NON RENSEIGNE')",
    reference_article: "COALESCE(NULLIF(BTRIM(l.reference_article::text), ''), 'NON RENSEIGNE')",
    designation: "COALESCE(NULLIF(BTRIM(l.designation::text), ''), 'NON RENSEIGNE')",
    type_document: "COALESCE(NULLIF(BTRIM(l.type_document::text), ''), 'NON RENSEIGNE')",
  }
  if (!expressions[key]) throw new Error(`${label(key)} n'est pas disponible dans l'extraction détaillée.`)
  return expressions[key]
}

function signedExpression(sourceKind: 'facture' | 'devis' | 'activite', expression: string) {
  return sourceKind === 'facture' ? `CASE WHEN l.numero_piece::text ILIKE 'FA0%' THEN ${expression} ELSE -${expression} END` : expression
}

function detailedMetric(key: string, sourceKind: 'facture' | 'devis' | 'activite') {
  const ca = signedExpression(sourceKind, 'COALESCE(l.montant_ht, 0)')
  const qty = signedExpression(sourceKind, 'COALESCE(l.quantite, 0)')
  const margin = signedExpression(sourceKind, 'COALESCE(l.marge_valeur, 0)')
  if (key === 'ca_ht') return `SUM(${ca}) AS ca_ht`
  if (key === 'quantite') return `SUM(${qty}) AS quantite`
  if (key === 'marge_valeur') return `SUM(${margin}) AS marge_valeur`
  if (key === 'nb_lignes') return 'COUNT(*) AS nb_lignes'
  if (key === 'panier_moyen') return `CASE WHEN COUNT(DISTINCT l.numero_piece) <> 0 THEN SUM(${ca}) / COUNT(DISTINCT l.numero_piece) ELSE 0 END AS panier_moyen`
  if (key === 'marge_pct') return `CASE WHEN SUM(${ca}) <> 0 THEN SUM(${margin}) / SUM(${ca}) * 100 ELSE 0 END AS marge_pct`
  return ''
}

function detailedQuery(body: JsonObject, dimensions: string[], wanted: string[], kind: string, plan: SourcePlan): QueryResult {
  const source = detailSource(plan)
  const dimensionExpressions = dimensions.map((key) => ({ key, expression: detailedDimension(key, source.date) }))
  const metrics = wanted.map((key) => ({ key, sql: detailedMetric(key, source.kind) })).filter((item) => Boolean(item.sql))
  if (!metrics.length) throw new Error('Aucune mesure disponible pour cette extraction détaillée.')

  const globals = body?.globalFilters || {}
  const free = structuredFilters(body)
  const period = body?.dataContext?.activeTemporalContext || {}
  const question = String(body?.question || '')
  const where: string[] = []
  if (period.dateStart) where.push(`${source.date} >= ${quote(period.dateStart)}::date`)
  if (period.dateEnd) where.push(`${source.date} <= ${quote(period.dateEnd)}::date`)
  const months = explicitMonths(question)
  if (months.length) pushCondition(where, inSql(`EXTRACT(MONTH FROM ${source.date})::int`, months))
  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", Array.isArray(globals.agences) ? globals.agences : []))
  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(t.representant::text), ''), 'NON RENSEIGNE')", Array.isArray(globals.collaborateursTiers) ? globals.collaborateursTiers : []))
  pushCondition(where, inSql(departmentExpression('t'), Array.isArray(globals.departementsTiers) ? globals.departementsTiers : []))
  if (String(globals.horsStatistique || 'non') === 'non') where.push('COALESCE(a.hors_statistique, FALSE) = FALSE')
  if (free.includeYears.length) pushCondition(where, inSql(`EXTRACT(YEAR FROM ${source.date})::int`, free.includeYears))
  if (free.excludeYears.length) pushCondition(where, notInSql(`EXTRACT(YEAR FROM ${source.date})::int`, free.excludeYears))
  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", free.includeAgencies))
  pushCondition(where, notInSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", free.excludeAgencies))
  pushCondition(where, inSql(departmentExpression('t'), free.includeDepartments))
  pushCondition(where, notInSql(departmentExpression('t'), free.excludeDepartments))
  pushCondition(where, inSql("BTRIM(COALESCE(f.famille_macro::text, ''))", free.includeFamilyMacros))
  pushCondition(where, notInSql("BTRIM(COALESCE(f.famille_macro::text, ''))", free.excludeFamilyMacros))
  pushCondition(where, inSql("BTRIM(COALESCE(a.famille::text, ''))", free.includeFamilies))
  pushCondition(where, notInSql("BTRIM(COALESCE(a.famille::text, ''))", free.excludeFamilies))
  pushCondition(where, inSql("BTRIM(COALESCE(l.reference_article::text, ''))", free.includeReferences))
  pushCondition(where, notInSql("BTRIM(COALESCE(l.reference_article::text, ''))", free.excludeReferences))
  pushCondition(where, textMatchSql(['l.numero_tiers_entete', 'l.intitule_tiers_entete'], free.includeClients))
  pushCondition(where, textMatchSql(['l.numero_tiers_entete', 'l.intitule_tiers_entete'], free.excludeClients, true))
  if (source.kind === 'activite' && plan.flow === 'BL') pushCondition(where, normalizedDocumentCondition('l.type_document', ['BL']))

  const needsAbc = dimensions.some((key) => key === 'classe_abc_ca' || key === 'classe_abc_lignes')
  const abcCte = needsAbc ? `WITH abc_current AS (\n  SELECT DISTINCT ON (reference_article) reference_article, classe_abc_ca, classe_abc_lignes\n  FROM public.v_stock_projection_alertes_abc\n  WHERE reference_article IS NOT NULL\n  ORDER BY reference_article, run_completed_at DESC NULLS LAST, run_created_at DESC NULLS LAST\n)\n` : ''
  const abcJoin = needsAbc ? '\nLEFT JOIN abc_current abc ON BTRIM(abc.reference_article::text) = BTRIM(l.reference_article::text)' : '\nLEFT JOIN (SELECT NULL::text AS reference_article, NULL::text AS classe_abc_ca, NULL::text AS classe_abc_lignes) abc ON FALSE'
  const group = dimensionExpressions.map((_item, index) => String(index + 1)).join(', ')
  const measureKeys = metrics.map((item) => item.key)
  const sortMode = effectiveSortMode(body, free)
  const order = sortMode === 'dimensions_asc' ? group : `${measureKeys[0]} ${sortMode === 'measure_desc' ? 'DESC' : 'ASC'} NULLS LAST`
  const baseSql = validateSql(`${abcCte}SELECT\n  ${[...dimensionExpressions.map((item) => `${item.expression} AS ${item.key}`), ...metrics.map((item) => item.sql)].join(',\n  ')}\nFROM public.${source.table} l\nLEFT JOIN public.ref_tiers t ON BTRIM(t.numero::text) = BTRIM(l.numero_tiers_entete::text)\nLEFT JOIN public.ref_collaborateurs c ON BTRIM(c.nom::text) = BTRIM(t.representant::text)\nLEFT JOIN public.ref_articles a ON BTRIM(a.reference_article::text) = BTRIM(l.reference_article::text)\nLEFT JOIN public.ref_familles f ON BTRIM(f.famille::text) = BTRIM(a.famille::text)${abcJoin}${where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''}\nGROUP BY ${group}\nORDER BY ${order}`)
  return { rows: [], sql: appendTopN(baseSql, free), repaired: false, reason: `${plan.title}. ${plan.detail}`, visualization: visualization(kind, dimensions, measureKeys), sourcePlan: plan }
}

function clientCreationQuery(body: JsonObject, dimensions: string[], wanted: string[], kind: string, plan: SourcePlan): QueryResult {
  if (!wanted.includes('nb_clients_crees')) throw new Error('La dimension Année de création client doit être utilisée avec la mesure Nouveaux clients.')
  const date = safeDate('t', 'date_creation')
  const department = departmentExpression('t')
  const expressions: Record<string, string> = {
    annee_creation_client: `EXTRACT(YEAR FROM ${date})::int`, annee: `EXTRACT(YEAR FROM ${date})::int`, mois: `EXTRACT(MONTH FROM ${date})::int`,
    agence_collaborateur: "COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')",
    collaborateur_tiers: "COALESCE(NULLIF(BTRIM(t.representant::text), ''), 'NON RENSEIGNE')",
    departement_tiers: `COALESCE(NULLIF(${department}, ''), 'NON RENSEIGNE')`,
    numero_tiers: "COALESCE(NULLIF(BTRIM(t.numero::text), ''), 'NON RENSEIGNE')",
    intitule_tiers: "COALESCE(NULLIF(BTRIM(t.intitule::text), ''), 'NON RENSEIGNE')",
  }
  const dimensionExpressions = dimensions.map((key) => {
    if (!expressions[key]) throw new Error(`${label(key)} n'est pas disponible pour l'analyse de création des clients.`)
    return { key, expression: expressions[key] }
  })
  const globals = body?.globalFilters || {}
  const free = structuredFilters(body)
  const period = body?.dataContext?.activeTemporalContext || {}
  const where = [`${date} IS NOT NULL`]
  if (period.dateStart) where.push(`${date} >= ${quote(period.dateStart)}::date`)
  if (period.dateEnd) where.push(`${date} <= ${quote(period.dateEnd)}::date`)
  const months = explicitMonths(String(body?.question || ''))
  if (months.length) pushCondition(where, inSql(`EXTRACT(MONTH FROM ${date})::int`, months))
  if (String(globals.inclureProspects || 'non') !== 'oui') where.push('COALESCE(t.prospect, FALSE) = FALSE')
  pushCondition(where, inSql("COALESCE(NULLIF(BTRIM(c.agence::text), ''), 'NON RENSEIGNE')", Array.isArray(globals.agences) ? globals.agences : []))
  pushCondition(where, inSql(departmentExpression('t'), Array.isArray(globals.departementsTiers) ? globals.departementsTiers : []))
  if (free.includeYears.length) pushCondition(where, inSql(`EXTRACT(YEAR FROM ${date})::int`, free.includeYears))
  if (free.excludeYears.length) pushCondition(where, notInSql(`EXTRACT(YEAR FROM ${date})::int`, free.excludeYears))
  pushCondition(where, textMatchSql(['t.numero', 't.intitule'], free.includeClients))
  pushCondition(where, textMatchSql(['t.numero', 't.intitule'], free.excludeClients, true))
  const group = dimensionExpressions.map((_item, index) => String(index + 1)).join(', ')
  const sortMode = effectiveSortMode(body, free)
  const order = sortMode === 'dimensions_asc' ? group : `nb_clients_crees ${sortMode === 'measure_desc' ? 'DESC' : 'ASC'} NULLS LAST`
  const baseSql = validateSql(`SELECT\n  ${dimensionExpressions.map((item) => `${item.expression} AS ${item.key}`).join(',\n  ')},\n  COUNT(DISTINCT t.numero) AS nb_clients_crees\nFROM public.ref_tiers t\nLEFT JOIN public.ref_collaborateurs c ON BTRIM(c.nom::text) = BTRIM(t.representant::text)\nWHERE ${where.join('\n  AND ')}\nGROUP BY ${group}\nORDER BY ${order}`)
  return { rows: [], sql: appendTopN(baseSql, free), repaired: false, reason: `${plan.title}. ${plan.detail}`, visualization: visualization(kind, dimensions, ['nb_clients_crees']), sourcePlan: plan }
}

function guided(body: JsonObject): QueryResult | null {
  const request = body?.dataContext?.visualizationRequest
  if (!request || typeof request !== 'object') return null
  const allDimensions: string[] = Array.isArray(request.dimensions) ? request.dimensions.map(String) : []
  const wanted: string[] = Array.isArray(request.measures) ? request.measures.map(String) : []
  if (!allDimensions.length || !wanted.length) return null
  const kind = String(request.kind || 'tableau')
  const dimensions = kind === 'histogramme_empile' ? allDimensions.slice(0, 2) : allDimensions
  const plan = planSource(body, dimensions, wanted)
  if (body.previewOnly === true) return { rows: [], sql: '', repaired: false, reason: plan.detail, visualization: visualization(kind, dimensions, wanted), sourcePlan: plan }
  if (plan.mode === 'client_creation') return clientCreationQuery(body, dimensions, wanted, kind, plan)
  if (plan.mode === 'flux_articles') return fluxArticleQuery(body, dimensions, wanted, kind, plan)
  if (plan.mode === 'detailed') return detailedQuery(body, dimensions, wanted, kind, plan)
  return aggregateQuery(body, dimensions, wanted, kind, plan)
}

function schemaPrompt() {
  return Object.entries(SCHEMA).map(([table, columns]) => `- ${table}: ${columns.join(', ')}`).join('\n') + '\nSELECT complet seulement, sans LIMIT. Les JOIN sont permis uniquement vers les tables ref_* et la vue ABC.'
}

async function legacy(question: string, body: JsonObject): Promise<QueryResult> {
  const generated = await openAi([
    { role: 'system', content: `Génère du SQL PostgreSQL en JSON. ${schemaPrompt()}` },
    { role: 'user', content: `Question: ${question}\nFiltres: ${JSON.stringify(body?.globalFilters || {})}\nRetourne {"sql":"...","reason":"..."}.` },
  ])
  let sql = String(generated?.sql || '')
  let reason = String(generated?.reason || 'SQL généré par l’IA.')
  try {
    sql = validateSql(sql)
    return { rows: await execute(sql), sql, repaired: false, reason, visualization: null }
  } catch (firstError: unknown) {
    const corrected = await openAi([
      { role: 'system', content: `Corrige le SQL en JSON. ${schemaPrompt()}` },
      { role: 'user', content: `SQL: ${cleanSql(sql)}\nErreur: ${firstError instanceof Error ? firstError.message : String(firstError)}\nRetourne {"sql":"...","reason":"..."}.` },
    ])
    sql = validateSql(String(corrected?.sql || ''))
    reason = String(corrected?.reason || 'SQL corrigé automatiquement.')
    return { rows: await execute(sql), sql, repaired: true, reason, visualization: null }
  }
}

function inferColumns(data: DataRow[]) {
  const keys = Array.from(new Set(data.slice(0, 50).flatMap((row) => Object.keys(row))))
  return keys.map((key) => {
    const lower = key.toLowerCase()
    const values = data.slice(0, 30).map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== '')
    const numeric = values.some((value) => Number.isFinite(Number(String(value).replace(',', '.'))))
    const type = lower.includes('pct') ? 'percent' : lower.includes('ca') || lower.includes('marge') || lower.includes('panier') ? 'currency' : numeric ? 'number' : 'text'
    return { key, label: label(key), type }
  })
}

function addEvolution(rows: DataRow[], dimensions: string[], measure: string) {
  if (!dimensions.includes('annee') || !rows.length) return rows
  const groupDimensions = dimensions.filter((key) => key !== 'annee')
  const groups = new Map<string, DataRow[]>()
  for (const row of rows) {
    const groupKey = JSON.stringify(groupDimensions.map((key) => row[key] ?? null))
    groups.set(groupKey, [...(groups.get(groupKey) || []), row])
  }
  const output: DataRow[] = []
  for (const groupRows of groups.values()) {
    const sorted = [...groupRows].sort((a, b) => Number(a.annee || 0) - Number(b.annee || 0))
    const latest = sorted[sorted.length - 1]
    const previous = sorted[sorted.length - 2]
    const currentValue = Number(latest?.[measure] || 0)
    const previousValue = Number(previous?.[measure] || 0)
    for (const row of sorted) {
      output.push({ ...row, evolution_pct: row === latest && previous && previousValue !== 0 ? ((currentValue - previousValue) / Math.abs(previousValue)) * 100 : null })
    }
  }
  return output
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as JsonObject
    const question = String(body?.question || '').trim()
    if (!question) return json({ error: 'Question vide.' }, 400)

    const structured = guided(body)
    if (body.previewOnly === true) {
      if (!structured?.sourcePlan) return json({ error: 'Plan de source indisponible.' }, 400)
      return json({ sourcePlan: structured.sourcePlan, visualization: structured.visualization, version: 'SEMANTIC-V2-SOURCE-PLANNER' })
    }

    const result = structured || await legacy(question, body)
    if (structured) result.rows = await execute(structured.sql)
    const requestConfig = body?.dataContext?.visualizationRequest || {}
    const dimensions = Array.isArray(requestConfig.dimensions) ? requestConfig.dimensions.map(String) : []
    const measures = Array.isArray(requestConfig.measures) ? requestConfig.measures.map(String) : []
    if (structured && wantsEvolution(question) && measures[0]) {
      result.rows = addEvolution(result.rows, dimensions, measures[0])
      if (result.visualization?.columns && !result.visualization.columns.includes('evolution_pct')) result.visualization.columns.push('evolution_pct')
    }

    const summarySample = result.rows.slice(0, SUMMARY_SAMPLE_ROWS)
    let answer = result.rows.length ? `Analyse exécutée sur ${result.rows.length} ligne(s).` : 'Aucune donnée ne correspond exactement aux critères appliqués.'
    try {
      const summary = await openAi([
        { role: 'system', content: 'Réponds en français et en JSON strict. Mentionne la source réellement utilisée et les exclusions appliquées. Si le résultat est vide, ne conclus pas à une absence d’activité générale.' },
        { role: 'user', content: `Question: ${question}\nSource: ${JSON.stringify(result.sourcePlan || {})}\nFiltres: ${JSON.stringify(structuredFilters(body))}\nSQL: ${result.sql}\nNombre de lignes: ${result.rows.length}\nÉchantillon: ${JSON.stringify(summarySample).slice(0, 20000)}\nRetourne {"answer":"synthèse courte"}.` },
      ])
      answer = String(summary?.answer || answer)
    } catch {
      // Les données restent utilisables si la synthèse IA échoue.
    }

    return json({
      answer, sql: result.sql, sql_repaired: result.repaired, sql_repair_reason: result.reason,
      row_count: result.rows.length, rows_preview: result.rows, columns: inferColumns(result.rows),
      visualization: result.visualization, source_plan: result.sourcePlan || null,
      proposed_widgets: [], is_complete: true, mode: structured ? 'guided_deterministic_db' : 'aggregated_db',
      version: 'SEMANTIC-V2-SOURCE-PLANNER',
    })
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
}
