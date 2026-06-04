import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MAX_RESULT_ROWS = 500
const MAX_REPAIR_ATTEMPTS = 1

const ALLOWED_TABLES = [
  'indicateur_factures_mensuel',
  'indicateur_activite_mensuel',
  'indicateur_devis_mensuel',
  'indicateur_flux_articles_mensuel',
]

const CONTROLLED_SCHEMA = `
Tables autorisées uniquement, toutes dans le schéma public :

1) indicateur_factures_mensuel
Usage : agrégat mensuel factures.
Colonnes usuelles : annee, mois, collaborateur, collaborateur_facture, collaborateur_tiers, agence_collaborateur, depot, departement_tiers, population_departement, superficie_departement, numero_tiers, intitule_tiers, famille, famille_macro, hors_statistique, nb_lignes, quantite, ca_ht, marge_valeur.
Type document à considérer : FACTURE, même si la colonne type_document n'est pas toujours présente.

2) indicateur_activite_mensuel
Usage : agrégat mensuel activité non facturée.
Colonnes usuelles : annee, mois, type_document, collaborateur, collaborateur_facture, collaborateur_tiers, agence_collaborateur, depot, departement_tiers, population_departement, superficie_departement, numero_tiers, intitule_tiers, famille, famille_macro, hors_statistique, nb_lignes, quantite, ca_ht, marge_valeur.
Types document usuels : BL, BL M-x, BR, CDC, PL.

3) indicateur_devis_mensuel
Usage : agrégat mensuel devis.
Colonnes usuelles : annee, mois, collaborateur, collaborateur_facture, collaborateur_tiers, agence_collaborateur, depot, departement_tiers, population_departement, superficie_departement, numero_tiers, intitule_tiers, famille, famille_macro, hors_statistique, nb_lignes, quantite, ca_ht, marge_valeur.
Type document à considérer : DEVIS, même si la colonne type_document n'est pas toujours présente.

4) indicateur_flux_articles_mensuel
Usage : agrégat mensuel flux articles par référence et désignation.
Colonnes usuelles : annee, mois, flux, type_document, depot, collaborateur_tiers, famille_macro, famille, reference_article, designation, hors_statistique, nb_lignes, quantite, ca_ht, marge_valeur.
Types document usuels : DEVIS, CDC, BL, FACTURE.

Mesures :
- CA HT = sum(ca_ht)
- Marge € = sum(marge_valeur)
- Marge % = case when sum(ca_ht) <> 0 then sum(marge_valeur) / sum(ca_ht) * 100 else 0 end
- Quantité = sum(quantite)
- Nb lignes = sum(nb_lignes)

Règles de filtres importantes :
- hors_statistique est un booléen PostgreSQL.
- Si le filtre écran horsStatistique vaut "non" ou "Exclu", écrire obligatoirement : hors_statistique = false.
- Si le filtre écran horsStatistique vaut "oui" ou "Uniquement", écrire obligatoirement : hors_statistique = true.
- Si le filtre écran horsStatistique vaut "tous", ne pas filtrer cette colonne.
- Ne jamais comparer hors_statistique à une chaîne texte comme 'non', 'oui', 'Exclu' ou 'Tous'.
- annee et mois sont des entiers. Pour une période active 01-06 sur 2025→2026, écrire : annee IN (2025, 2026) AND mois BETWEEN 1 AND 6.
- Toujours séparer les conditions WHERE par AND ou OR. Ne jamais écrire "annee = 2026 mois <= 6" ni "annee IN (...) mois <= 6".

Règles SQL :
- Générer uniquement une requête SELECT ou WITH ... SELECT.
- Ne jamais utiliser INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, COPY, CALL, DO, EXECUTE.
- Ne jamais utiliser auth, storage, information_schema, pg_catalog, pg_*, fonctions réseau ou extensions.
- Utiliser uniquement les 4 tables autorisées ci-dessus.
- Toujours agréger avant d'afficher des résultats analytiques.
- Toujours mettre un LIMIT explicite, maximum 500.
- Préférer des alias de colonnes simples, sans accents, pour faciliter l'affichage JSON.
`

type OpenAIJson = Record<string, any>

type SqlExecutionResult = {
  rows: any[]
  sql: string
  repaired: boolean
  generationReason?: string
  repairReason?: string
  firstError?: string
}

function jsonResponse(payload: Record<string, any>, status = 200) {
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

function parseOpenAIJson(text: string): OpenAIJson {
  const trimmed = String(text || '').trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch (_e) {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Réponse IA non JSON.')
  }
}

async function callOpenAIJson(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.05,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Erreur OpenAI ${response.status}`)
  }

  const content = payload?.choices?.[0]?.message?.content || '{}'
  return parseOpenAIJson(content)
}

function stripSql(sql: string) {
  let value = String(sql || '').trim()
  value = value.replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  value = value.replace(/;\s*$/g, '').trim()
  return value
}

function normalizeBusinessBooleanLiterals(sqlInput: string) {
  let sql = stripSql(sqlInput)

  sql = sql.replace(
    /(\bhors_statistique\b\s*(?:=|<>|!=)\s*)'?\s*(non|no|n|faux|false|f|0|exclu|exclude|excluded)\s*'?/gi,
    (_match, prefix) => `${prefix}false`
  )
  sql = sql.replace(
    /(\bhors_statistique\b\s*(?:=|<>|!=)\s*)'?\s*(oui|yes|y|vrai|true|t|1|inclu|include|included|uniquement)\s*'?/gi,
    (_match, prefix) => `${prefix}true`
  )
  sql = sql.replace(
    /(\bhors_statistique\b\s+is\s+)not\s+'?\s*(non|no|n|faux|false|f|0|exclu|exclude|excluded)\s*'?/gi,
    (_match, prefix) => `${prefix}not false`
  )
  sql = sql.replace(
    /(\bhors_statistique\b\s+is\s+)not\s+'?\s*(oui|yes|y|vrai|true|t|1|inclu|include|included|uniquement)\s*'?/gi,
    (_match, prefix) => `${prefix}not true`
  )
  sql = sql.replace(
    /(\bhors_statistique\b\s+is\s+)'?\s*(non|no|n|faux|false|f|0|exclu|exclude|excluded)\s*'?/gi,
    (_match, prefix) => `${prefix}false`
  )
  sql = sql.replace(
    /(\bhors_statistique\b\s+is\s+)'?\s*(oui|yes|y|vrai|true|t|1|inclu|include|included|uniquement)\s*'?/gi,
    (_match, prefix) => `${prefix}true`
  )
  sql = sql.replace(
    /\bhors_statistique\b\s+in\s*\(\s*'?\s*(non|no|n|faux|false|f|0|exclu|exclude|excluded)\s*'?\s*\)/gi,
    'hors_statistique = false'
  )
  sql = sql.replace(
    /\bhors_statistique\b\s+in\s*\(\s*'?\s*(oui|yes|y|vrai|true|t|1|inclu|include|included|uniquement)\s*'?\s*\)/gi,
    'hors_statistique = true'
  )
  sql = sql.replace(
    /\bhors_statistique\b\s+not\s+in\s*\(\s*'?\s*(non|no|n|faux|false|f|0|exclu|exclude|excluded)\s*'?\s*\)/gi,
    'hors_statistique <> false'
  )
  sql = sql.replace(
    /\bhors_statistique\b\s+not\s+in\s*\(\s*'?\s*(oui|yes|y|vrai|true|t|1|inclu|include|included|uniquement)\s*'?\s*\)/gi,
    'hors_statistique <> true'
  )

  return sql
}


function normalizeSqlClauseSpacing(sqlInput: string) {
  let sql = String(sqlInput || '')

  // Correction défensive de l'erreur vue en production :
  // "hors_statistique = falseGROUP BY" ou ")ORDER BY" quand une normalisation
  // ou une génération IA colle deux clauses SQL sans espace.
  sql = sql.replace(
    /([)\w])(?=\b(?:where|group\s+by|order\s+by|having|limit|union|intersect|except)\b)/gi,
    '$1 '
  )
  sql = sql.replace(
    /([)\w])(?=\b(?:and|or)\s+\b)/gi,
    '$1 '
  )

  // Nettoyage léger des espaces multiples, sans toucher aux chaînes SQL.
  sql = sql.replace(/[ \t]{2,}/g, ' ').trim()
  return sql
}

function normalizeKnownSqlMistakes(sqlInput: string) {
  let sql = normalizeBusinessBooleanLiterals(sqlInput)

  // Correction défensive de l'erreur vue en production :
  // PostgreSQL renvoie "syntax error at or near \"mois\"" quand l'IA écrit par exemple
  // "WHERE annee = 2026 mois <= 6" au lieu de "WHERE annee = 2026 AND mois <= 6".
  sql = sql.replace(/(\bannee\s*=\s*\d{4})\s+(\bmois\b)/gi, '$1 AND $2')
  sql = sql.replace(/(\bannee\s+in\s*\([^)]*\))\s+(\bmois\b)/gi, '$1 AND $2')
  sql = sql.replace(/(\bannee\s+between\s+\d{4}\s+and\s+\d{4})\s+(\bmois\b)/gi, '$1 AND $2')

  // Autre variante fréquente : une condition après le filtre booléen sans AND.
  sql = sql.replace(/(\bhors_statistique\s*(?:=|<>|!=|is(?:\s+not)?)\s*(?:true|false))\s+(\b(?:annee|mois|agence_collaborateur|depot|famille_macro|type_document)\b)/gi, '$1 AND $2')

  return normalizeSqlClauseSpacing(sql)
}

function extractCteNames(sql: string) {
  const ctes = new Set<string>()
  const lower = sql.toLowerCase()
  if (!lower.trim().startsWith('with')) return ctes

  const pattern = /(?:with|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    ctes.add(match[1].toLowerCase())
  }
  return ctes
}

function normalizeTableRef(ref: string) {
  return String(ref || '')
    .replace(/["'`]/g, '')
    .replace(/^public\./i, '')
    .trim()
    .toLowerCase()
}

function validateReadonlySql(sqlInput: string) {
  const sql = normalizeKnownSqlMistakes(sqlInput)

  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error('La requête IA doit commencer par SELECT ou WITH.')
  }

  if (sql.slice(0, -1).includes(';')) {
    throw new Error('Requête SQL multiple interdite.')
  }

  const forbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|analyze|listen|notify|comment)\b|security\s+definer|set\s+role|set\s+session|information_schema|pg_catalog|\bpg_[a-zA-Z0-9_]*\b|\bauth\.|\bstorage\.|\bnet\./i
  if (forbidden.test(sql)) {
    throw new Error('La requête contient un mot-clé ou un schéma non autorisé.')
  }

  const allowed = new Set(ALLOWED_TABLES.map((table) => table.toLowerCase()))
  const ctes = extractCteNames(sql)
  const refs = Array.from(sql.matchAll(/\b(?:from|join)\s+([a-zA-Z0-9_."`']+)/gi)).map((match) => normalizeTableRef(match[1]))

  for (const ref of refs) {
    if (ctes.has(ref)) continue
    if (!allowed.has(ref)) {
      throw new Error(`Table non autorisée dans la requête IA : ${ref}`)
    }
  }

  let finalSql = sql
  if (!/\blimit\s+\d+\b/i.test(finalSql)) {
    finalSql = `${finalSql}\nLIMIT ${MAX_RESULT_ROWS}`
  } else {
    finalSql = finalSql.replace(/\blimit\s+(\d+)\b/i, (_m, n) => `LIMIT ${Math.min(Number(n || MAX_RESULT_ROWS), MAX_RESULT_ROWS)}`)
  }

  return normalizeSqlClauseSpacing(finalSql)
}

function compactJson(value: any, maxLength = 12000) {
  const json = JSON.stringify(value ?? {}, null, 2)
  if (json.length <= maxLength) return json
  return `${json.slice(0, maxLength)}\n... tronqué ...`
}

function buildFilterHints(body: any) {
  const globalFilters = body?.globalFilters || {}
  const active = body?.dataContext?.activeTemporalContext || {}
  const horsStatistiqueRaw = String(globalFilters.horsStatistique || 'non')
  const horsStatistiqueBoolean = horsStatistiqueRaw === 'non' ? false : horsStatistiqueRaw === 'oui' ? true : null

  return {
    currentViewName: body?.currentViewName || null,
    activeTemporalContext: active,
    databaseFilterRules: {
      hors_statistique: horsStatistiqueBoolean,
      note: horsStatistiqueBoolean === null
        ? 'Ne pas ajouter de filtre sur hors_statistique.'
        : `Ajouter hors_statistique = ${horsStatistiqueBoolean ? 'true' : 'false'}.`,
    },
    globalFilters: {
      sources: globalFilters.sources || [],
      years: globalFilters.years || [],
      months: globalFilters.months || [],
      agences: globalFilters.agences || [],
      depots: globalFilters.depots || [],
      collaborateursFacture: globalFilters.collaborateursFacture || globalFilters.collaborateurs || [],
      collaborateursTiers: globalFilters.collaborateursTiers || [],
      departementsTiers: globalFilters.departementsTiers || [],
      famillesMacro: globalFilters.famillesMacro || [],
      typesDocument: globalFilters.typesDocument || [],
      horsStatistique: globalFilters.horsStatistique || 'non',
      clientMode: globalFilters.clientMode || 'include',
      clients: globalFilters.clients || [],
    },
  }
}

function resultPreview(rows: any[]) {
  return rows.slice(0, 80)
}

function isRepairableSqlError(message: string) {
  return /syntax error|invalid input syntax|operator does not exist|column .* does not exist|missing FROM-clause|aggregate function calls cannot|must appear in the GROUP BY/i.test(message)
}

async function generateSql(question: string, filterHints: any) {
  return callOpenAIJson([
    {
      role: 'system',
      content: `Tu es un générateur SQL analytique pour un écran Supply Chain / commerce. Tu dois répondre en JSON strict uniquement. ${CONTROLLED_SCHEMA}`,
    },
    {
      role: 'user',
      content: `Question utilisateur : ${question}\n\nContexte écran et filtres à appliquer quand ils sont pertinents :\n${compactJson(filterHints)}\n\nRetourne uniquement ce JSON : {"sql":"...", "reason":"..."}. La clé sql doit contenir une seule requête SQL read-only exécutable sur PostgreSQL/Supabase. Vérifie spécialement que toutes les conditions WHERE sont séparées par AND/OR et qu'il y a toujours un espace avant GROUP BY, ORDER BY, HAVING et LIMIT.`,
    },
  ])
}

async function repairSql(question: string, filterHints: any, previousSql: string, previousError: string) {
  return callOpenAIJson([
    {
      role: 'system',
      content: `Tu es un correcteur SQL PostgreSQL/Supabase. Tu dois répondre en JSON strict uniquement. Corrige la requête sans changer l'intention métier. ${CONTROLLED_SCHEMA}`,
    },
    {
      role: 'user',
      content: `Question utilisateur : ${question}\n\nContexte écran et filtres :\n${compactJson(filterHints)}\n\nSQL qui a échoué :\n${previousSql}\n\nErreur Supabase/PostgreSQL :\n${previousError}\n\nRetourne uniquement ce JSON : {"sql":"requête corrigée", "reason":"correction effectuée"}. La requête corrigée doit être une seule requête SELECT ou WITH. Si l'erreur est proche de "mois", vérifie qu'il y a bien AND avant mois dans le WHERE. Si l'erreur est proche de "BY", vérifie qu'il y a bien un espace avant GROUP BY ou ORDER BY.`,
    },
  ])
}

async function executeReadonlySql(supabase: ReturnType<typeof supabaseAdmin>, sql: string) {
  const { data, error } = await supabase.rpc('atelier_ai_run_readonly_sql', { p_sql: sql })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : data ? [data] : []
}

async function generateValidateExecuteSql(question: string, filterHints: any): Promise<SqlExecutionResult> {
  const supabase = supabaseAdmin()
  const sqlJson = await generateSql(question, filterHints)
  let safeSql = validateReadonlySql(String(sqlJson?.sql || ''))

  try {
    const rows = await executeReadonlySql(supabase, safeSql)
    return {
      rows,
      sql: safeSql,
      repaired: false,
      generationReason: String(sqlJson?.reason || ''),
    }
  } catch (firstError: any) {
    const firstMessage = String(firstError?.message || firstError)
    if (!isRepairableSqlError(firstMessage) || MAX_REPAIR_ATTEMPTS < 1) {
      throw new Error(`Erreur Supabase RPC atelier_ai_run_readonly_sql : ${firstMessage}\n\nSQL exécuté :\n${safeSql}`)
    }

    const repairedJson = await repairSql(question, filterHints, safeSql, firstMessage)
    safeSql = validateReadonlySql(String(repairedJson?.sql || ''))

    try {
      const rows = await executeReadonlySql(supabase, safeSql)
      return {
        rows,
        sql: safeSql,
        repaired: true,
        generationReason: String(sqlJson?.reason || ''),
        repairReason: String(repairedJson?.reason || ''),
        firstError: firstMessage,
      }
    } catch (secondError: any) {
      const secondMessage = String(secondError?.message || secondError)
      throw new Error(
        `Erreur Supabase RPC atelier_ai_run_readonly_sql après tentative de correction : ${secondMessage}\n\nPremière erreur : ${firstMessage}\n\nSQL corrigé exécuté :\n${safeSql}`
      )
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const question = String(body?.question || '').trim()
    if (!question) return jsonResponse({ error: 'Question vide.' }, 400)

    const filterHints = buildFilterHints(body)
    const execution = await generateValidateExecuteSql(question, filterHints)
    const rows = execution.rows

    const answerJson = await callOpenAIJson([
      {
        role: 'system',
        content: `Tu es un contrôleur de gestion commercial. Réponds en français, avec des chiffres lisibles, des limites claires, et si utile 1 à 3 recommandations d'analyse. Réponds en JSON strict.` ,
      },
      {
        role: 'user',
        content: `Question : ${question}\n\nSQL exécuté :\n${execution.sql}\n\nNombre de lignes retournées : ${rows.length}\nRésultat, aperçu :\n${compactJson(resultPreview(rows), 20000)}\n\nRetourne uniquement ce JSON : {"answer":"réponse métier en français", "proposed_widgets": []}. proposed_widgets peut rester vide.`,
      },
    ])

    return jsonResponse({
      answer: answerJson?.answer || 'La requête a été exécutée, mais la synthèse IA est vide.',
      sql: execution.sql,
      sql_repaired: execution.repaired,
      sql_generation_reason: execution.generationReason,
      sql_repair_reason: execution.repairReason,
      sql_first_error: execution.firstError,
      row_count: rows.length,
      rows_preview: resultPreview(rows),
      proposed_widgets: Array.isArray(answerJson?.proposed_widgets) ? answerJson.proposed_widgets : [],
      mode: 'aggregated_db',
    })
  } catch (error: any) {
    return jsonResponse({ error: error?.message || String(error) }, 500)
  }
}
