import { NextRequest, NextResponse } from 'next/server'
import {
  emptyAssistantBiStructuredFilters,
  mergeExplicitYearRules,
  normalizeAssistantBiFreeTextInterpretation,
} from '@/lib/ai/assistantBiStructuredFilters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

type JsonObject = Record<string, unknown>

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

async function interpretWithAi(freeText: string, context: unknown) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
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

  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) throw new Error(payload?.error?.message || `Erreur OpenAI ${response.status}`)
  return parseJson(String(payload?.choices?.[0]?.message?.content || '{}'))
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
      })
    }

    let raw: unknown = {}
    try {
      raw = await interpretWithAi(freeText, body.context)
    } catch {
      raw = {
        summary: 'Interprétation automatique limitée aux règles explicites détectées.',
        filters: emptyAssistantBiStructuredFilters(),
        assumptions: ['La synthèse IA était indisponible ; les règles explicites restent appliquées.'],
        needsConfirmation: true,
        clarificationQuestion: '',
      }
    }

    const normalized = mergeExplicitYearRules(
      normalizeAssistantBiFreeTextInterpretation(raw),
      freeText,
    )

    return NextResponse.json({ interpretation: normalized })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
