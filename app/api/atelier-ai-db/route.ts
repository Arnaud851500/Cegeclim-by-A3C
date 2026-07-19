import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MAX_ROWS = 500
const PREVIEW_ROWS = 200
const TABLES = [
  'indicateur_factures_mensuel',
  'indicateur_activite_mensuel',
  'indicateur_devis_mensuel',
  'indicateur_flux_articles_mensuel',
] as const

type TableName = (typeof TABLES)[number]
type SchemaMap = Record<TableName, string[]>
type JsonObject = Record<string, any>
type Row = Record<string, unknown>
type Column = { key: string; label: string; type: 'number' | 'currency' | 'percent' | 'text' }

type Execution = {
  rows: Row[]
  sql: string
  repaired: boolean
  firstError?: string
  reasons: string[]
}

const ALLOWED_TABLES = new Set<string>(TABLES)
const FALLBACK_SCHEMA: SchemaMap = {
  indicateur_factures_mensuel: ['annee', 'mois', 'collaborateur', 'collaborateur_facture', 'collaborateur_tiers', 'agence_collaborateur', 'depot', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille', 'famille_macro', 'hors_statistique', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
  indicateur_activite_mensuel: ['annee', 'mois', 'type_document', 'collaborateur', 'collaborateur_facture', 'collaborateur_tiers', 'agence_collaborateur', 'depot', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille', 'famille_macro', 'hors_statistique', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
  indicateur_devis_mensuel: ['annee', 'mois', 'collaborateur', 'collaborateur_facture', 'collaborateur_tiers', 'agence_collaborateur', 'depot', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille', 'famille_macro', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
  indicateur_flux_articles_mensuel: ['annee', 'mois', 'flux', 'type_document', 'depot', 'collaborateur_tiers', 'famille_macro', 'famille', 'reference_article', 'designation', 'hors_statistique', 'nb_lignes', 'quantite', 'ca_ht', 'marge_valeur'],
}

let schemaCache: { at: number; value: SchemaMap } | null = null

function response(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status })
}

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

function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  if (data && typeof data === 'object') return [data as Row]
  return []
}

async function readLiveSchema(): Promise<SchemaMap> {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60 * 1000) return schemaCache.value
  const client = supabaseAdmin()
  const entries = await Promise.all(TABLES.map(async (table) => {
    try {
      const { data, error } = await client.rpc('atelier_ai_run_readonly_sql', {
        p_sql: `SELECT * FROM public.${table} LIMIT 1`,
      })
      if (error) throw error
      const row = asRows(data)[0]
      const columns = row ? Object.keys(row).sort() : []
      return [table, columns.length ? columns : FALLBACK_SCHEMA[table]] as const
    } catch {
      return [table, FALLBACK_SCHEMA[table]] as const
    }
  }))
  const value = Object.fromEntries(entries) as SchemaMap
  schemaCache = { at: Date.now(), value }
  return value
}

function schemaInstructions(schema: SchemaMap) {
  const lines = TABLES.map((table) => `- ${table}: ${schema[table].join(', ')}`).join('\n')
  return `
Colonnes réellement disponibles dans Supabase, listes exhaustives :
${lines}

Règles obligatoires :
- Utiliser seulement les colonnes listées pour la table concernée.
- Ne jamais supposer que les tables ont les mêmes colonnes.
- Appliquer hors_statistique seulement aux tables qui possèdent cette colonne.
- Ne jamais utiliser reference_article ou designation dans indicateur_devis_mensuel si ces colonnes n'y figurent pas.
- Pour un devis par référence, utiliser indicateur_flux_articles_mensuel avec type_document = 'DEVIS', si ces colonnes existent.
- Ne jamais joindre deux tables indicateur_*_mensuel : elles sont déjà agrégées et un JOIN multiplierait les montants.
- Si des dimensions ne coexistent pas dans une table, produire des sections séparées avec CTE et UNION ALL, ou expliquer la limite.
- departement_tiers est du texte : utiliser par exemple IN ('16','17','33').
- Générer une seule requête SELECT ou WITH ... SELECT, sans écriture, avec LIMIT final <= ${MAX_ROWS}.
- Ne pas placer ORDER BY ou LIMIT dans les CTE.
- CA HT = sum(ca_ht), marge € = sum(marge_valeur), marge % = sum(marge_valeur)/sum(ca_ht)*100, quantité = sum(quantite), lignes = sum(nb_lignes).
`
}

function parseJson(text: string): JsonObject {
  const clean = String(text || '').trim()
  if (!clean) return {}
  try { return JSON.parse(clean) } catch {}
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) return JSON.parse(fenced.trim())
  const first = clean.indexOf('{')
  const last = clean.lastIndexOf('}')
  if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1))
  throw new Error('Réponse IA non JSON.')
}

async function askOpenAI(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const result = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.03, response_format: { type: 'json_object' }, messages }),
  })
  const payload = await result.json().catch(() => ({})) as JsonObject
  if (!result.ok) throw new Error(payload?.error?.message || `Erreur OpenAI ${result.status}`)
  return parseJson(payload?.choices?.[0]?.message?.content || '{}')
}

function stripSql(value: string) {
  return String(value || '').trim().replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').replace(/;\s*$/g, '').trim()
}

function normalizeSql(value: string) {
  let sql = stripSql(value)
  sql = sql.replace(/(\bannee\s*=\s*\d{4})\s+(\bmois\b)/gi, '$1 AND $2')
  sql = sql.replace(/(\bannee\s+in\s*\([^)]*\))\s+(\bmois\b)/gi, '$1 AND $2')
  sql = sql.replace(/\b(false|true)(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|AND|OR)\b/gi, '$1 $2')
  sql = sql.replace(/(\))(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION)\b/gi, '$1 $2')
  sql = sql.replace(/((?:\b[a-z_][a-z0-9_]*\.)?departement_tiers\s+IN\s*\()([^)]*)(\))/gi, (_match, start, values, end) => {
    const fixed = String(values).split(',').map((item) => item.trim()).map((item) => /^\d{1,3}$/.test(item) ? `'${item.padStart(2, '0')}'` : item)
    return `${start}${fixed.join(', ')}${end}`
  })
  return sql.replace(/[ \t]{2,}/g, ' ').trim()
}

function cteNames(sql: string) {
  const names = new Set<string>()
  const pattern = /(?:with|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) names.add(match[1].toLowerCase())
  return names
}

function validateSql(raw: string) {
  let sql = normalizeSql(raw)
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('La requête doit commencer par SELECT ou WITH.')
  if (/;|--|\/\*/.test(sql)) throw new Error('Une seule requête SQL sans commentaire est autorisée.')
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|refresh)\b/i.test(sql)) throw new Error('Instruction SQL non autorisée.')
  if (/\b(auth|storage|information_schema|pg_catalog|pg_[a-z0-9_]+)\b/i.test(sql)) throw new Error('Objet système non autorisé.')
  if (/\b(?:true|false)\s*\./i.test(sql)) throw new Error('Un booléen ne peut pas être un alias de table.')

  const ctes = cteNames(sql)
  const refs = [...sql.matchAll(/\b(from|join)\s+((?:public\.)?[a-zA-Z_][a-zA-Z0-9_]*)/gi)]
  for (const ref of refs) {
    const keyword = ref[1].toLowerCase()
    const table = ref[2].replace(/^public\./i, '').toLowerCase()
    if (!ALLOWED_TABLES.has(table) && !ctes.has(table)) throw new Error(`Table non autorisée : ${table}`)
    if (keyword === 'join' && ALLOWED_TABLES.has(table)) throw new Error('JOIN interdit entre tables mensuelles agrégées.')
  }

  const limits = [...sql.matchAll(/\blimit\s+(\d+)\b/gi)]
  if (!limits.length) sql = `${sql} LIMIT ${MAX_ROWS}`
  else {
    const last = limits[limits.length - 1]
    const start = last.index ?? 0
    sql = `${sql.slice(0, start)}LIMIT ${Math.min(Number(last[1]), MAX_ROWS)}${sql.slice(start + last[0].length)}`
  }
  return sql
}

function hints(body: JsonObject, schema: SchemaMap) {
  const filters = body?.globalFilters || {}
  return {
    period: body?.dataContext?.activeTemporalContext || {},
    subject: body?.dataContext?.semanticSubject || null,
    filters,
    horsStatistiqueRule: {
      requested: filters.horsStatistique || 'non',
      allowedTables: TABLES.filter((table) => schema[table].includes('hors_statistique')),
      instruction: 'Omettre le filtre pour toute autre table.',
    },
  }
}

async function execute(sql: string) {
  const { data, error } = await supabaseAdmin().rpc('atelier_ai_run_readonly_sql', { p_sql: sql })
  if (error) throw new Error(error.message)
  return asRows(data)
}

function repairable(message: string) {
  return /syntax error|column .* does not exist|operator does not exist|missing FROM-clause|GROUP BY|JOIN interdit|alias|Table non autorisée/i.test(message)
}

async function generateAndRun(question: string, filterContext: unknown, schemaText: string): Promise<Execution> {
  const generated = await askOpenAI([
    { role: 'system', content: `Génère du SQL PostgreSQL analytique et réponds en JSON strict. ${schemaText}` },
    { role: 'user', content: `Question : ${question}\nFiltres : ${JSON.stringify(filterContext)}\nRetourne {"sql":"...","reason":"..."}. Contrôle chaque colonne contre la liste exacte de sa table.` },
  ])

  let sql = String(generated?.sql || '')
  let firstError: string | undefined
  const reasons: string[] = []

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const validSql = validateSql(sql)
      return { rows: await execute(validSql), sql: validSql, repaired: attempt > 0, firstError, reasons }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!firstError) firstError = message
      if (!repairable(message) || attempt === 2) {
        throw new Error(`Erreur Supabase RPC atelier_ai_run_readonly_sql après tentative de correction : ${message}\n\nPremière erreur : ${firstError}\n\nSQL exécuté :\n${stripSql(sql)}`)
      }
      const corrected = await askOpenAI([
        { role: 'system', content: `Corrige le SQL PostgreSQL sans changer l'intention. Réponds en JSON strict. ${schemaText}` },
        { role: 'user', content: `Question : ${question}\nFiltres : ${JSON.stringify(filterContext)}\nSQL en erreur : ${stripSql(sql)}\nErreur : ${message}\nRetourne {"sql":"...","reason":"..."}. Supprime les colonnes absentes. Utilise une autre table seulement dans une section séparée, sans JOIN.` },
      ])
      sql = String(corrected?.sql || '')
      reasons.push(String(corrected?.reason || `Correction ${attempt + 1}`))
    }
  }
  throw new Error('Échec inattendu.')
}

function humanize(key: string) {
  const names: Record<string, string> = { section: 'Section', annee: 'Année', mois: 'Mois', agence_collaborateur: 'Agence', depot: 'Dépôt', departement_tiers: 'Département', famille_macro: 'Famille macro', famille: 'Famille', type_document: 'Type document', numero_tiers: 'Code client', intitule_tiers: 'Client', reference_article: 'Référence article', designation: 'Désignation', ca_ht: 'CA HT', marge_valeur: 'Marge €', marge_pct: 'Marge %', quantite: 'Quantité', nb_lignes: 'Nb lignes' }
  return names[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function inferColumns(rows: Row[]): Column[] {
  const keys = Array.from(new Set(rows.slice(0, 30).flatMap((row) => Object.keys(row))))
  return keys.map((key) => {
    const lower = key.toLowerCase()
    const values = rows.slice(0, 30).map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== '')
    const numeric = values.some((value) => Number.isFinite(Number(String(value).replace(',', '.'))))
    const type: Column['type'] = lower.includes('pct') || lower.includes('taux') ? 'percent' : lower.includes('ca') || lower.includes('marge') || lower.includes('montant') ? 'currency' : numeric ? 'number' : 'text'
    return { key, label: humanize(key), type }
  })
}

function inferVisualization(question: string, rows: Row[], columns: Column[]) {
  if (!rows.length || !columns.length) return null
  const keys = columns.map((item) => item.key)
  const numeric = columns.filter((item) => item.type !== 'text').map((item) => item.key)
  const xKey = ['mois', 'annee', 'agence_collaborateur', 'famille_macro', 'famille', 'departement_tiers', 'reference_article'].find((key) => keys.includes(key)) || keys[0]
  const yKeys = numeric.filter((key) => key !== xKey).slice(0, 3)
  if (!yKeys.length || rows.length > 30) return { kind: 'table', title: 'Résultat détaillé', columns: keys.slice(0, 12) }
  if (question.toLowerCase().includes('mois') || xKey === 'mois') return { kind: 'line', title: `Évolution par ${humanize(xKey).toLowerCase()}`, xKey, yKeys, columns: keys.slice(0, 12) }
  return { kind: 'bar', title: `Analyse par ${humanize(xKey).toLowerCase()}`, xKey, yKeys, columns: keys.slice(0, 12) }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as JsonObject
    const question = String(body?.question || '').trim()
    if (!question) return response({ error: 'Question vide.' }, 400)

    const schema = await readLiveSchema()
    const filterContext = hints(body, schema)
    const result = await generateAndRun(question, filterContext, schemaInstructions(schema))
    const preview = result.rows.slice(0, PREVIEW_ROWS)
    const columns = inferColumns(preview)

    const summary = await askOpenAI([
      { role: 'system', content: 'Tu es contrôleur de gestion commercial. Réponds en français et en JSON strict, sans tableau Markdown.' },
      { role: 'user', content: `Question : ${question}\nSQL : ${result.sql}\nLignes : ${result.rows.length}\nAperçu : ${JSON.stringify(preview).slice(0, 20000)}\nRetourne {"answer":"synthèse de 3 à 8 lignes","proposed_widgets":[]}. Mentionne les limites de granularité.` },
    ])

    return response({
      answer: String(summary?.answer || 'Analyse exécutée.'),
      sql: result.sql,
      sql_repaired: result.repaired,
      sql_repair_reason: result.reasons.join(' | '),
      sql_first_error: result.firstError,
      row_count: result.rows.length,
      rows_preview: preview,
      columns,
      visualization: inferVisualization(question, preview, columns),
      proposed_widgets: Array.isArray(summary?.proposed_widgets) ? summary.proposed_widgets : [],
      mode: 'aggregated_db',
      schema_source: 'live_supabase_with_fallback',
      version: 'STEP-7-LIVE-SCHEMA-01',
    })
  } catch (error: unknown) {
    return response({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
}
