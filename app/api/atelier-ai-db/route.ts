import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MAX_RESULT_ROWS = 500

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
      temperature: 0.1,
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
  const sql = stripSql(sqlInput)
  const lower = sql.toLowerCase()

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

  return finalSql
}

function compactJson(value: any, maxLength = 12000) {
  const json = JSON.stringify(value ?? {}, null, 2)
  if (json.length <= maxLength) return json
  return `${json.slice(0, maxLength)}\n... tronqué ...`
}

function buildFilterHints(body: any) {
  const globalFilters = body?.globalFilters || {}
  const active = body?.dataContext?.activeTemporalContext || {}
  return {
    currentViewName: body?.currentViewName || null,
    activeTemporalContext: active,
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const question = String(body?.question || '').trim()
    if (!question) return jsonResponse({ error: 'Question vide.' }, 400)

    const filterHints = buildFilterHints(body)

    const sqlJson = await callOpenAIJson([
      {
        role: 'system',
        content: `Tu es un générateur SQL analytique pour un écran Supply Chain / commerce. Tu dois répondre en JSON strict uniquement. ${CONTROLLED_SCHEMA}`,
      },
      {
        role: 'user',
        content: `Question utilisateur : ${question}\n\nContexte écran et filtres à appliquer quand ils sont pertinents :\n${compactJson(filterHints)}\n\nRetourne uniquement ce JSON : {"sql":"...", "reason":"..."}. La clé sql doit contenir une seule requête SQL read-only exécutable sur PostgreSQL/Supabase.`,
      },
    ])

    const safeSql = validateReadonlySql(String(sqlJson?.sql || ''))
    const supabase = supabaseAdmin()
    const { data, error } = await supabase.rpc('atelier_ai_run_readonly_sql', { p_sql: safeSql })

    if (error) {
      throw new Error(`Erreur Supabase RPC atelier_ai_run_readonly_sql : ${error.message}`)
    }

    const rows = Array.isArray(data) ? data : data ? [data] : []

    const answerJson = await callOpenAIJson([
      {
        role: 'system',
        content: `Tu es un contrôleur de gestion commercial. Réponds en français, avec des chiffres lisibles, des limites claires, et si utile 1 à 3 recommandations d'analyse. Réponds en JSON strict.` ,
      },
      {
        role: 'user',
        content: `Question : ${question}\n\nSQL exécuté :\n${safeSql}\n\nNombre de lignes retournées : ${rows.length}\nRésultat, aperçu :\n${compactJson(resultPreview(rows), 20000)}\n\nRetourne uniquement ce JSON : {"answer":"réponse métier en français", "proposed_widgets": []}. proposed_widgets peut rester vide.`,
      },
    ])

    return jsonResponse({
      answer: answerJson?.answer || 'La requête a été exécutée, mais la synthèse IA est vide.',
      sql: safeSql,
      row_count: rows.length,
      rows_preview: resultPreview(rows),
      proposed_widgets: Array.isArray(answerJson?.proposed_widgets) ? answerJson.proposed_widgets : [],
      mode: 'aggregated_db',
    })
  } catch (error: any) {
    return jsonResponse({ error: error?.message || String(error) }, 500)
  }
}
