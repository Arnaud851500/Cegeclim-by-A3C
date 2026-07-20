import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  emptyAssistantBiStructuredFilters,
  mergeExplicitYearRules,
  normalizeAssistantBiFreeTextInterpretation,
  type AssistantBiFreeTextInterpretation,
} from '@/lib/ai/assistantBiStructuredFilters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// L'interprétation utilise volontairement un modèle stable et peu coûteux.
// Elle ne dépend plus de OPENAI_MODEL, qui peut être configuré avec un modèle
// de raisonnement dont certains paramètres Chat Completions sont incompatibles.
const MODEL = process.env.OPENAI_INTERPRET_MODEL || 'gpt-4.1-mini'

type JsonObject = Record<string, unknown>

type OpenAiFailureDetails = {
  status: number
  model: string
  requestId: string
  code: string
  type: string
  message: string
}

class OpenAiRequestError extends Error {
  details: OpenAiFailureDetails

  constructor(details: OpenAiFailureDetails) {
    super(details.message)
    this.name = 'OpenAiRequestError'
    this.details = details
  }
}

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function parseJson(text: string): JsonObject {
  const source = String(text || '').trim()
  try {
    return JSON.parse(source) as JsonObject
  } catch {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) return JSON.parse(fenced.trim()) as JsonObject
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1)) as JsonObject
    throw new Error('Réponse IA non JSON.')
  }
}

function errorRecord(payload: unknown) {
  if (!payload || typeof payload !== 'object') return {} as Record<string, unknown>
  const root = payload as Record<string, unknown>
  return root.error && typeof root.error === 'object'
    ? root.error as Record<string, unknown>
    : {}
}

function publicErrorMessage(error: unknown) {
  if (error instanceof OpenAiRequestError) {
    const code = error.details.code ? ` / ${error.details.code}` : ''
    const requestId = error.details.requestId ? ` / request ${error.details.requestId}` : ''
    return `OpenAI ${error.details.status}${code} : ${error.details.message}${requestId}`.slice(0, 500)
  }
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
}

function mergeDeterministicBusinessRules(
  interpretation: AssistantBiFreeTextInterpretation,
  freeText: string,
): AssistantBiFreeTextInterpretation {
  const filters = {
    ...interpretation.filters,
    includeFamilyMacros: [...interpretation.filters.includeFamilyMacros],
    includeDocumentTypes: [...interpretation.filters.includeDocumentTypes],
  }
  const normalized = freeText.replace(/[’']/g, "'")

  const macroMatches = [
    ...normalized.matchAll(/famille\s+macro\s+(?:est\s+|=\s*|de\s+)?([A-Z0-9][A-Z0-9_\/-]*)/gi),
  ]
  for (const match of macroMatches) {
    const value = String(match[1] || '').trim().toUpperCase()
    if (value && !filters.includeFamilyMacros.includes(value)) filters.includeFamilyMacros.push(value)
  }

  if (/\b(?:uniquement|seulement|sélectionner|selectionner)[^\n]{0,100}\bR\s*\/\s*R\b/i.test(normalized)) {
    if (!filters.includeFamilyMacros.includes('R/R')) filters.includeFamilyMacros.push('R/R')
  }

  const documentRules: Array<[RegExp, string]> = [
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bBL\b/i, 'BL'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bDEVIS\b/i, 'DEVIS'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bFACTURES?\b/i, 'FACTURE'],
  ]
  for (const [pattern, value] of documentRules) {
    if (pattern.test(normalized) && !filters.includeDocumentTypes.includes(value)) {
      filters.includeDocumentTypes.push(value)
    }
  }

  const topMatch = normalized.match(/\btop\s+(\d{1,3})\b/i)
  if (topMatch && !filters.topN) {
    const top = Number(topMatch[1])
    if (top > 0 && top <= 500) {
      filters.topN = top
      filters.sortMode = filters.sortMode || 'measure_desc'
    }
  }

  return { ...interpretation, filters }
}

async function interpretWithAi(freeText: string, context: unknown) {
  const clientRequestId = randomUUID()
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
      'X-Client-Request-Id': clientRequestId,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Tu interprètes une demande libre d'analyse BI CEGECLIM.
Transforme uniquement les contraintes réellement demandées en filtres structurés.
N'invente aucune valeur. Distingue clairement inclure et exclure.
Exemples :
- "ne prends pas les clients créés en 2015" => excludeYears:[2015]
- "uniquement la famille macro R/R" => includeFamilyMacros:["R/R"]
- "hors Marmande" => excludeAgencies:["MARMANDE"]
- "top 20 clients" => topN:20 et sortMode:"measure_desc"
- "uniquement les BL" => includeDocumentTypes:["BL"]
Si la demande est ambiguë, formule une clarification mais fournis l'interprétation la plus prudente.
Retourne strictement :
{
  "summary":"phrase courte décrivant ce qui sera appliqué",
  "filters":{
    "includeYears":[],"excludeYears":[],
    "includeAgencies":[],"excludeAgencies":[],
    "includeDepartments":[],"excludeDepartments":[],
    "includeFamilyMacros":[],"excludeFamilyMacros":[],
    "includeFamilies":[],"excludeFamilies":[],
    "includeReferences":[],"excludeReferences":[],
    "includeClients":[],"excludeClients":[],
    "includeDocumentTypes":[],"excludeDocumentTypes":[],
    "topN":null,
    "sortMode":null
  },
  "assumptions":[],
  "needsConfirmation":false,
  "clarificationQuestion":""
}`,
        },
        {
          role: 'user',
          content: `Demande libre : ${freeText}\nContexte de l'analyse : ${JSON.stringify(context || {})}`,
        },
      ],
    }),
  })

  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const apiError = errorRecord(payload)
    const details: OpenAiFailureDetails = {
      status: response.status,
      model: MODEL,
      requestId: response.headers.get('x-request-id') || clientRequestId,
      code: String(apiError.code || ''),
      type: String(apiError.type || ''),
      message: String(apiError.message || `Erreur OpenAI ${response.status}`),
    }
    console.error('[assistant-bi][openai-interpret]', details)
    throw new OpenAiRequestError(details)
  }

  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const choices = Array.isArray(root.choices) ? root.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {}
  return parseJson(String(message.content || '{}'))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const freeText = String(body.freeText || '').trim()
    if (!freeText) {
      return NextResponse.json({
        interpretation: {
          summary: 'Aucune précision libre.',
          filters: emptyAssistantBiStructuredFilters(),
          assumptions: [],
          needsConfirmation: false,
          clarificationQuestion: '',
        },
        ai: { available: true, model: MODEL },
      })
    }

    let raw: unknown = {}
    let aiAvailable = true
    let aiError = ''
    try {
      raw = await interpretWithAi(freeText, body.context)
    } catch (error: unknown) {
      aiAvailable = false
      aiError = publicErrorMessage(error)
      raw = {
        summary: 'Interprétation automatique limitée aux règles explicites détectées.',
        filters: emptyAssistantBiStructuredFilters(),
        assumptions: [`IA indisponible : ${aiError}`],
        needsConfirmation: true,
        clarificationQuestion: '',
      }
    }

    const withYears = mergeExplicitYearRules(
      normalizeAssistantBiFreeTextInterpretation(raw),
      freeText,
    )
    const normalized = mergeDeterministicBusinessRules(withYears, freeText)

    return NextResponse.json({
      interpretation: normalized,
      ai: {
        available: aiAvailable,
        model: MODEL,
        error: aiError || undefined,
      },
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
