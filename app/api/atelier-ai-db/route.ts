import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MAX_RESULT_ROWS = 500
const MAX_PREVIEW_ROWS = 200
const ALLOWED_TABLES = new Set([
  'indicateur_factures_mensuel',
  'indicateur_activite_mensuel',
  'indicateur_devis_mensuel',
  'indicateur_flux_articles_mensuel',
])

const CONTROLLED_SCHEMA = `
Tables public autorisées :
- indicateur_factures_mensuel : annee, mois, collaborateur, collaborateur_facture, collaborateur_tiers, agence_collaborateur, depot, departement_tiers, numero_tiers, intitule_tiers, famille, famille_macro, hors_statistique, nb_lignes, quantite, ca_ht, marge_valeur.
- indicateur_activite_mensuel : mêmes dimensions principales + type_document. Types usuels : BL, BL M-x, BR, CDC, PL.
- indicateur_devis_mensuel : mêmes dimensions principales pour les devis.
- indicateur_flux_articles_mensuel : annee, mois, flux, type_document, depot, collaborateur_tiers, famille_macro, famille, reference_article, designation, hors_statistique, nb_lignes, quantite, ca_ht, marge_valeur. Cette table ne contient pas agence_collaborateur, departement_tiers, numero_tiers ni intitule_tiers.

Mesures : CA HT=sum(ca_ht), marge €=sum(marge_valeur), marge %=sum(marge_valeur)/sum(ca_ht)*100, quantité=sum(quantite), lignes=sum(nb_lignes).

Règles impératives :
- Générer une seule requête SELECT ou WITH ... SELECT, read-only, avec LIMIT final <= 500.
- hors_statistique est booléen : écrire = false ou = true, jamais une chaîne.
- departement_tiers est traité comme texte : IN ('16','17','33').
- Toujours séparer les conditions WHERE par AND ou OR.
- Ces tables sont déjà agrégées : ne JAMAIS faire de JOIN entre deux tables indicateur_*_mensuel, car cela multiplie les montants.
- reference_article vient de indicateur_flux_articles_mensuel ; agence_collaborateur et departement_tiers viennent des autres agrégats. Pour une demande mélangeant ces dimensions, produire deux sections séparées avec des CTE et UNION ALL, ou expliquer la limite. Ne jamais joindre sur annee/mois/depot.
- Ne pas mettre ORDER BY ou LIMIT dans les CTE ; les placer sur le SELECT final.
- Interdits : INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, COPY, CALL, DO, EXECUTE, auth, storage, information_schema, pg_catalog et pg_*.
`

type JsonObject = Record<string, any>
type Row = Record<string, unknown>
type ColumnInfo = { key: string; label: string; type: 'number' | 'currency' | 'percent' | 'text' }
type Visualization = {
  kind: 'table' | 'bar' | 'line' | 'pie'
  title: string
  xKey?: string
  yKeys?: string[]
  labelKey?: string
  valueKey?: string
  columns: string[]
  note?: string
}

type Execution = {
  rows: Row[]
  sql: string
  repaired: boolean
  generationReason?: string
  repairReason?: string
  firstError?: string
}

function reply(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status })
}

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function adminClient() {
  return createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function parseJson(text: string): JsonObject {
  const value = String(text || '').trim()
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) return JSON.parse(fenced.trim())
    const first = value.indexOf('{')
    const last = value.lastIndexOf('}')
    if (first >= 0 && last > first) return JSON.parse(value.slice(first, last + 1))
    throw new Error('Réponse IA non JSON.')
  }
}

async function openAiJson(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.05,
      response_format: { type: 'json_object' },
      messages,
    }),
  })
  const payload = await response.json().catch(() => ({})) as JsonObject
  if (!response.ok) throw new Error(payload?.error?.message || `Erreur OpenAI ${response.status}`)
  return parseJson(payload?.choices?.[0]?.message?.content || '{}')
}

function stripSql(input: string) {
  return String(input || '')
    .trim()
    .replace(/^```sql\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .replace(/;\s*$/g, '')
    .trim()
}

function normalizeBooleanLiterals(input: string) {
  let sql = stripSql(input)
  const column = '(?:\\b[a-z_][a-z0-9_]*\\.)?\\bhors_statistique\\b'
  const falseWords = '(?:non|no|n|faux|false|f|0|exclu|exclude|excluded)'
  const trueWords = '(?:oui|yes|y|vrai|true|t|1|inclu|include|included|uniquement)'
  const endToken = "\\s*'?(?![a-z0-9_])(?!\\s*\\.)"

  // Important : le second garde-fou empêche de transformer l'alias f.hors_statistique
  // en false.hors_statistique.
  sql = sql.replace(new RegExp(`(${column}\\s*(?:=|<>|!=)\\s*)'?\\s*${falseWords}${endToken}`, 'gi'), '$1false')
  sql = sql.replace(new RegExp(`(${column}\\s*(?:=|<>|!=)\\s*)'?\\s*${trueWords}${endToken}`, 'gi'), '$1true')
  sql = sql.replace(new RegExp(`(${column}\\s+is\\s+)not\\s+'?\\s*${falseWords}${endToken}`, 'gi'), '$1not false')
  sql = sql.replace(new RegExp(`(${column}\\s+is\\s+)not\\s+'?\\s*${trueWords}${endToken}`, 'gi'), '$1not true')
  sql = sql.replace(new RegExp(`(${column}\\s+is\\s+)'?\\s*${falseWords}${endToken}`, 'gi'), '$1false')
  sql = sql.replace(new RegExp(`(${column}\\s+is\\s+)'?\\s*${trueWords}${endToken}`, 'gi'), '$1true')
  return sql
}

function normalizeDepartments(input: string) {
  return input.replace(
    /((?:\b[a-z_][a-z0-9_]*\.)?\bdepartement_tiers\b\s+(?:in|not\s+in)\s*\()([^)]*)(\))/gi,
    (_match, prefix: string, values: string, suffix: string) => {
      const list = values.split(',').map((item) => item.trim()).map((item) => {
        if (!/^\d{1,3}$/.test(item)) return item
        return `'${item.padStart(2, '0')}'`
      })
      return `${prefix}${list.join(', ')}${suffix}`
    }
  )
}

function normalizeSpacing(input: string) {
  let sql = input
  sql = sql.replace(/\b(true|false)(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|AND|OR)\b/gi, '$1 $2')
  sql = sql.replace(/(\d|\))(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|AND|OR|UNION|INTERSECT|EXCEPT)\b/gi, '$1 $2')
  sql = sql.replace(/([a-z_][a-z0-9_]*)(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/g, '$1 $2')
  return sql.replace(/[ \t]{2,}/g, ' ').trim()
}

function normalizeSql(input: string) {
  let sql = normalizeDepartments(normalizeBooleanLiterals(input))
  sql = sql.replace(/(\bannee\s*=\s*\d{4})\s+(\bmois\b)/gi, '$1 AND $2')
  sql = sql.replace(/(\bannee\s+in\s*\([^)]*\))\s+(\bmois\b)/gi, '$1 AND $2')
  sql = sql.replace(/(\bannee\s+between\s+\d{4}\s+and\s+\d{4})\s+(\bmois\b)/gi, '$1 AND $2')
  return normalizeSpacing(sql)
}

function cteNames(sql: string) {
  const names = new Set<string>()
  const pattern = /(?:with|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) names.add(match[1].toLowerCase())
  return names
}

function tableReferences(sql: string) {
  const refs: Array<{ keyword: string; table: string }> = []
  const pattern = /\b(from|join)\s+((?:public\.)?[a-zA-Z_][a-zA-Z0-9_]*)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    refs.push({ keyword: match[1].toLowerCase(), table: match[2].replace(/^public\./i, '').toLowerCase() })
  }
  return refs
}

function ensureFinalLimit(input: string) {
  const sql = stripSql(input)
  const matches = [...sql.matchAll(/\blimit\s+(\d+)\b/gi)]
  if (!matches.length) return `${sql} LIMIT ${MAX_RESULT_ROWS}`
  const last = matches[matches.length - 1]
  const start = last.index ?? 0
  const end = start + last[0].length
  return `${sql.slice(0, start)}LIMIT ${Math.min(Number(last[1]), MAX_RESULT_ROWS)}${sql.slice(end)}`
}

function validateSql(input: string) {
  let sql = normalizeSql(input)
  if (!sql) throw new Error('SQL vide.')
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('La requête doit commencer par SELECT ou WITH.')
  if (/;/.test(sql)) throw new Error('Une seule instruction SQL est autorisée.')
  if (/--|\/\*/.test(sql)) throw new Error('Les commentaires SQL sont interdits.')
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|refresh|set|reset)\b/i.test(sql)) {
    throw new Error('Instruction SQL non autorisée.')
  }
  if (/\b(auth|storage|information_schema|pg_catalog|pg_toast|pg_[a-z0-9_]+)\b/i.test(sql)) {
    throw new Error('Objet système non autorisé.')
  }
  if (/\b(?:true|false)\s*\./i.test(sql)) {
    throw new Error("SQL invalide : un booléen ne peut pas être utilisé comme alias de table.")
  }

  const ctes = cteNames(sql)
  const refs = tableReferences(sql)
  for (const ref of refs) {
    if (!ALLOWED_TABLES.has(ref.table) && !ctes.has(ref.table)) throw new Error(`Table non autorisée : ${ref.table}`)
  }
  const joinedAggregates = refs.filter((ref) => ref.keyword === 'join' && ALLOWED_TABLES.has(ref.table))
  if (joinedAggregates.length) {
    throw new Error('JOIN interdit entre tables mensuelles agrégées. Utilise des sections séparées afin d’éviter les doubles comptes.')
  }
  sql = ensureFinalLimit(sql)
  return normalizeSpacing(sql)
}

function compactJson(value: unknown, max = 12000) {
  const json = JSON.stringify(value ?? {}, null, 2)
  return json.length <= max ? json : `${json.slice(0, max)}\n... tronqué ...`
}

function filterHints(body: JsonObject) {
  const filters = body?.globalFilters || {}
  const raw = String(filters.horsStatistique || 'non')
  const bool = raw === 'non' ? false : raw === 'oui' ? true : null
  return {
    currentViewName: body?.currentViewName || null,
    activeTemporalContext: body?.dataContext?.activeTemporalContext || {},
    semanticSubject: body?.dataContext?.semanticSubject || null,
    databaseFilterRules: {
      hors_statistique: bool,
      departement_tiers: 'Comparer à des chaînes de caractères.',
    },
    globalFilters: {
      sources: filters.sources || [],
      years: filters.years || [],
      months: filters.months || [],
      agences: filters.agences || [],
      depots: filters.depots || [],
      collaborateursFacture: filters.collaborateursFacture || filters.collaborateurs || [],
      collaborateursTiers: filters.collaborateursTiers || [],
      departementsTiers: filters.departementsTiers || [],
      famillesMacro: filters.famillesMacro || [],
      typesDocument: filters.typesDocument || [],
      horsStatistique: filters.horsStatistique || 'non',
      clientMode: filters.clientMode || 'include',
      clients: filters.clients || [],
    },
  }
}

async function generateSql(question: string, hints: unknown) {
  return openAiJson([
    { role: 'system', content: `Tu génères du SQL analytique PostgreSQL et réponds uniquement en JSON strict. ${CONTROLLED_SCHEMA}` },
    {
      role: 'user',
      content: `Question : ${question}\n\nFiltres :\n${compactJson(hints)}\n\nRetourne {"sql":"...","reason":"..."}. Vérifie l'absence de JOIN entre agrégats, les AND/OR, les départements entre quotes et le LIMIT final.`,
    },
  ])
}

async function repairSql(question: string, hints: unknown, previousSql: string, error: string) {
  return openAiJson([
    { role: 'system', content: `Tu corriges du SQL PostgreSQL sans changer l'intention et réponds uniquement en JSON strict. ${CONTROLLED_SCHEMA}` },
    {
      role: 'user',
      content: `Question : ${question}\n\nFiltres :\n${compactJson(hints)}\n\nSQL en erreur :\n${previousSql}\n\nErreur :\n${error}\n\nRetourne {"sql":"...","reason":"..."}. Ne produis jamais false.hors_statistique. Le f de f.hors_statistique est un alias, pas false. Supprime tout JOIN entre agrégats et sépare les analyses si nécessaire.`,
    },
  ])
}

async function executeSql(sql: string) {
  const { data, error } = await adminClient().rpc('atelier_ai_run_readonly_sql', { p_sql: sql })
  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? data : data ? [data] : []
  return rows.filter((row): row is Row => Boolean(row) && typeof row === 'object')
}

function repairable(message: string) {
  return /syntax error|invalid input syntax|operator does not exist|column .* does not exist|missing FROM-clause|GROUP BY|JOIN interdit|alias de table/i.test(message)
}

async function generateValidateExecute(question: string, hints: unknown): Promise<Execution> {
  const generated = await generateSql(question, hints)
  const firstRaw = String(generated?.sql || '')
  let firstSql: string

  try {
    firstSql = validateSql(firstRaw)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const repaired = await repairSql(question, hints, firstRaw, message)
    const repairedSql = validateSql(String(repaired?.sql || ''))
    return {
      rows: await executeSql(repairedSql),
      sql: repairedSql,
      repaired: true,
      generationReason: String(generated?.reason || ''),
      repairReason: String(repaired?.reason || ''),
      firstError: message,
    }
  }

  try {
    return {
      rows: await executeSql(firstSql),
      sql: firstSql,
      repaired: false,
      generationReason: String(generated?.reason || ''),
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (!repairable(message)) throw new Error(`Erreur Supabase RPC atelier_ai_run_readonly_sql : ${message}\n\nSQL exécuté :\n${firstSql}`)
    const repaired = await repairSql(question, hints, firstSql, message)
    const repairedSql = validateSql(String(repaired?.sql || ''))
    try {
      return {
        rows: await executeSql(repairedSql),
        sql: repairedSql,
        repaired: true,
        generationReason: String(generated?.reason || ''),
        repairReason: String(repaired?.reason || ''),
        firstError: message,
      }
    } catch (second: unknown) {
      const secondMessage = second instanceof Error ? second.message : String(second)
      throw new Error(`Erreur Supabase RPC atelier_ai_run_readonly_sql après tentative de correction : ${secondMessage}\n\nPremière erreur : ${message}\n\nSQL corrigé exécuté :\n${repairedSql}`)
    }
  }
}

function humanize(key: string) {
  const labels: Record<string, string> = {
    section: 'Section', annee: 'Année', mois: 'Mois', agence: 'Agence', agence_collaborateur: 'Agence',
    depot: 'Dépôt', departement_tiers: 'Dépt tiers', famille_macro: 'Famille macro', famille: 'Famille',
    type_document: 'Type document', flux: 'Flux', numero_tiers: 'Code tiers', intitule_tiers: 'Client',
    reference_article: 'Référence article', designation: 'Désignation', ca_ht: 'CA HT', marge_valeur: 'Marge €',
    marge_pct: 'Marge %', quantite: 'Quantité', nb_lignes: 'Nb lignes', evolution_ca_ht: 'Écart CA HT', evolution_pct: 'Évolution %',
  }
  return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null || value === undefined || value === '') return null
  const text = String(value).replace(/\s/g, '').replace(',', '.')
  return /^[-+]?\d+(\.\d+)?$/.test(text) ? Number(text) : null
}

function columns(rows: Row[]): ColumnInfo[] {
  const keys: string[] = []
  rows.slice(0, 30).forEach((row) => Object.keys(row).forEach((key) => { if (!keys.includes(key)) keys.push(key) }))
  return keys.map((key) => {
    const lower = key.toLowerCase()
    const type: ColumnInfo['type'] = lower.includes('pct') || lower.includes('percent') || lower.includes('taux')
      ? 'percent'
      : lower.includes('ca') || lower.includes('marge') || lower.includes('montant') || lower.includes('valeur')
        ? 'currency'
        : rows.slice(0, 30).some((row) => numeric(row[key]) !== null)
          ? 'number'
          : 'text'
    return { key, label: humanize(key), type }
  })
}

function visualization(question: string, rows: Row[], infos: ColumnInfo[]): Visualization | null {
  if (!rows.length || !infos.length) return null
  const all = infos.map((item) => item.key)
  const numericKeys = infos.filter((item) => item.type !== 'text').map((item) => item.key)
  const textKeys = infos.filter((item) => item.type === 'text').map((item) => item.key)
  const priority = ['mois', 'annee', 'agence', 'agence_collaborateur', 'famille_macro', 'famille', 'type_document', 'depot', 'departement_tiers', 'intitule_tiers', 'reference_article']
  const xKey = priority.find((key) => all.includes(key)) || textKeys[0] || all[0]
  const yKeys = numericKeys.filter((key) => key !== xKey).slice(0, 3)
  if (!yKeys.length) return { kind: 'table', title: 'Résultat détaillé', columns: all.slice(0, 12) }
  if (rows.length > 30) return { kind: 'table', title: 'Résultat détaillé', columns: all.slice(0, 12), note: `${rows.length} lignes : tableau prioritaire.` }
  const q = question.toLowerCase()
  if ((q.includes('répartition') || q.includes('part ')) && yKeys.length === 1 && rows.length <= 12) {
    return { kind: 'pie', title: `Répartition par ${humanize(xKey).toLowerCase()}`, labelKey: xKey, valueKey: yKeys[0], columns: all.slice(0, 12) }
  }
  if (q.includes('mois') || xKey === 'mois') {
    return { kind: 'line', title: `Évolution par ${humanize(xKey).toLowerCase()}`, xKey, yKeys, columns: all.slice(0, 12) }
  }
  return { kind: 'bar', title: `Analyse par ${humanize(xKey).toLowerCase()}`, xKey, yKeys, columns: all.slice(0, 12) }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as JsonObject
    const question = String(body?.question || '').trim()
    if (!question) return reply({ error: 'Question vide.' }, 400)

    const execution = await generateValidateExecute(question, filterHints(body))
    const preview = execution.rows.slice(0, MAX_PREVIEW_ROWS)
    const infos = columns(preview)
    const visual = visualization(question, preview, infos)
    const summary = await openAiJson([
      {
        role: 'system',
        content: 'Tu es contrôleur de gestion commercial. Réponds en français et en JSON strict, avec des chiffres lisibles, des limites claires et 1 à 3 pistes utiles. Aucun tableau Markdown.',
      },
      {
        role: 'user',
        content: `Question : ${question}\n\nSQL :\n${execution.sql}\n\nLignes : ${execution.rows.length}\nAperçu :\n${compactJson(preview, 20000)}\n\nRetourne {"answer":"synthèse de 3 à 8 lignes","proposed_widgets":[]}. Signale si les références et territoires ont été analysés séparément.`,
      },
    ])

    return reply({
      answer: String(summary?.answer || 'La requête a été exécutée, mais la synthèse IA est vide.'),
      sql: execution.sql,
      sql_repaired: execution.repaired,
      sql_generation_reason: execution.generationReason,
      sql_repair_reason: execution.repairReason,
      sql_first_error: execution.firstError,
      row_count: execution.rows.length,
      rows_preview: preview,
      columns: infos,
      visualization: visual,
      proposed_widgets: Array.isArray(summary?.proposed_widgets) ? summary.proposed_widgets : [],
      mode: 'aggregated_db',
      version: 'STEP-6-SAFE-BOOLEAN-ALIAS-01',
    })
  } catch (error: unknown) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
}
