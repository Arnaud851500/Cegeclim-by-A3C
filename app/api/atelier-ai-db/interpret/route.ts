import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  emptyAssistantBiAnalysisPlan,
  emptyAssistantBiStructuredFilters,
  mergeExplicitYearRules,
  normalizeAssistantBiFreeTextInterpretation,
  type AssistantBiFreeTextInterpretation,
} from '@/lib/ai/assistantBiStructuredFilters'
import {
  buildSemanticPromptReference,
  environmentForSubject,
  getSubject,
  recommendedVisualization,
  sanitizeSubjectConfiguration,
  type SemanticDimensionKey,
  type SemanticMeasureKey,
  type SemanticSubjectKey,
  type SemanticVisualizationKey,
} from '@/lib/ai/cegeclimSemanticCatalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.OPENAI_INTERPRET_MODEL || process.env.OPENAI_BI_MODEL || 'gpt-4.1-mini'

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

function unique<T extends string>(values: T[]) {
  return Array.from(new Set(values))
}

function inferSubject(text: string): SemanticSubjectKey | null {
  const rules: Array<[RegExp, SemanticSubjectKey]> = [
    [/\b(?:nouveaux?\s+clients?|clients?\s+cr[eé][eé]s?|prospects?|tiers)\b/i, 'clients'],
    [/\b(?:factures?|facturation|ca\s+factur[eé])\b/i, 'factures'],
    [/\b(?:devis|offres?|propositions?\s+commerciales?)\b/i, 'devis'],
    [/\b(?:portefeuille|encours|commandes?|cdc|pr[eé]parations?|\bpl\b|\bbr\b)\b/i, 'portefeuille'],
    [/\b(?:articles?|r[eé]f[eé]rences?|produits?|familles?|classe\s+abc|\babc\b)\b/i, 'articles'],
    [/\b(?:ventes?|livraisons?|bons?\s+de\s+livraison|\bbl\b|sorties?)\b/i, 'ventes_bl'],
  ]
  return rules.find(([pattern]) => pattern.test(text))?.[1] || null
}

function inferMeasures(text: string, subject: SemanticSubjectKey): SemanticMeasureKey[] {
  const measures: SemanticMeasureKey[] = []
  if (/\b(?:nouveaux?\s+clients?|clients?\s+cr[eé][eé]s?|cr[eé]ations?\s+clients?)\b/i.test(text)) measures.push('nb_clients_crees')
  if (/\b(?:ca|chiffre\s+d['’]affaires|montant|valeur|contribution)\b/i.test(text)) measures.push('ca_ht')
  if (/\b(?:quantit[eé]s?|volumes?|unit[eé]s?|sorties?)\b/i.test(text)) measures.push('quantite')
  if (/\b(?:marge\s+en\s+euros?|marge\s+valeur)\b/i.test(text)) measures.push('marge_valeur')
  if (/\b(?:taux\s+de\s+marge|marge\s*%|pourcentage\s+de\s+marge)\b/i.test(text)) measures.push('marge_pct')
  if (/\b(?:panier|ticket|montant)\s+moyen\b/i.test(text)) measures.push('panier_moyen')
  if (/\b(?:nombre|nb)\s+de\s+lignes?\b/i.test(text)) measures.push('nb_lignes')
  if (measures.length) return unique(measures)
  return [...getSubject(subject).defaultMeasures]
}

function inferDimensions(text: string, subject: SemanticSubjectKey): SemanticDimensionKey[] {
  const dimensions: SemanticDimensionKey[] = []
  const rules: Array<[RegExp, SemanticDimensionKey]> = [
    [/\b(?:mois|mensuel|mensuelle|mois\s+par\s+mois|[eé]volution)\b/i, 'mois'],
    [/\b(?:ann[eé]e|annuel|annuelle|n-1)\b/i, 'annee'],
    [/\b(?:agence|agences)\b/i, 'agence_collaborateur'],
    [/\b(?:d[eé]p[oô]t|d[eé]p[oô]ts)\b/i, 'depot'],
    [/\b(?:d[eé]partement|d[eé]partements|territoire|zone\s+g[eé]ographique)\b/i, 'departement_tiers'],
    [/\b(?:famille\s+macro|macro\s+famille)\b/i, 'famille_macro'],
    [/\b(?:famille|familles)\b/i, 'famille'],
    [/\b(?:r[eé]f[eé]rence|r[eé]f[eé]rences|article|articles|sku)\b/i, 'reference_article'],
    [/\b(?:d[eé]signation|libell[eé]\s+article)\b/i, 'designation'],
    [/\b(?:client|clients|tiers)\b/i, 'intitule_tiers'],
    [/\b(?:type\s+de\s+document|documents?|flux)\b/i, 'type_document'],
    [/\b(?:commercial|collaborateur|vendeur|repr[eé]sentant)\b/i, 'collaborateur_tiers'],
    [/\b(?:classe\s+abc\s+ca|abc\s+ca)\b/i, 'classe_abc_ca'],
    [/\b(?:classe\s+abc\s+lignes?|abc\s+lignes?)\b/i, 'classe_abc_lignes'],
    [/\b(?:ann[eé]e\s+de\s+cr[eé]ation|anciennet[eé]\s+client)\b/i, 'annee_creation_client'],
  ]
  for (const [pattern, dimension] of rules) {
    if (pattern.test(text)) dimensions.push(dimension)
  }

  if (/\btop\s+\d+\s+clients?\b/i.test(text) && !dimensions.includes('intitule_tiers')) dimensions.unshift('intitule_tiers')
  if (/\btop\s+\d+\s+(?:articles?|r[eé]f[eé]rences?)\b/i.test(text) && !dimensions.includes('reference_article')) dimensions.unshift('reference_article')

  return dimensions.length ? unique(dimensions) : [...getSubject(subject).defaultDimensions]
}

function inferVisualization(text: string, dimensions: SemanticDimensionKey[], measures: SemanticMeasureKey[]): SemanticVisualizationKey {
  if (/\b(?:tableau|liste|d[eé]tail)\b/i.test(text)) return 'tableau'
  if (/\b(?:courbe|ligne|[eé]volution|tendance)\b/i.test(text)) return 'courbe'
  if (/\b(?:camembert|secteurs?|r[eé]partition\s+circulaire)\b/i.test(text)) return 'camembert'
  if (/\b(?:empil[eé]|stack)\b/i.test(text)) return 'histogramme_empile'
  if (/\b(?:histogramme|barres?|graphique)\b/i.test(text)) return dimensions.length > 1 ? 'histogramme_empile' : 'histogramme'
  return recommendedVisualization(dimensions, measures)
}

function mergeDeterministicBusinessRules(
  interpretation: AssistantBiFreeTextInterpretation,
  freeText: string,
  context: unknown,
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

  if (/\b(?:uniquement|seulement|s[eé]lectionner)[^\n]{0,100}\bR\s*\/\s*R\b/i.test(normalized)) {
    if (!filters.includeFamilyMacros.includes('R/R')) filters.includeFamilyMacros.push('R/R')
  }

  const documentRules: Array<[RegExp, string]> = [
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bBL\b/i, 'BL'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bDEVIS\b/i, 'DEVIS'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bFACTURES?\b/i, 'FACTURE'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bCDC\b/i, 'CDC'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bPL\b/i, 'PL'],
    [/\b(?:uniquement|seulement)[^\n]{0,60}\bBR\b/i, 'BR'],
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

  const contextRecord = context && typeof context === 'object' ? context as Record<string, unknown> : {}
  const contextSubject = contextRecord.subject && typeof contextRecord.subject === 'object'
    ? String((contextRecord.subject as Record<string, unknown>).key || '')
    : String(contextRecord.subject || '')
  const lockSubject = contextRecord.lockSubject === true
  const validContextSubject = ['ventes_bl', 'factures', 'devis', 'portefeuille', 'clients', 'articles'].includes(contextSubject)
    ? contextSubject as SemanticSubjectKey
    : null

  const inferredSubject = lockSubject && validContextSubject
    ? validContextSubject
    : interpretation.plan.subject || inferSubject(normalized) || validContextSubject || 'ventes_bl'

  const rawMeasures = interpretation.plan.measures.length
    ? interpretation.plan.measures
    : inferMeasures(normalized, inferredSubject)
  const rawDimensions = interpretation.plan.dimensions.length
    ? interpretation.plan.dimensions
    : inferDimensions(normalized, inferredSubject)
  const sanitized = sanitizeSubjectConfiguration({
    subject: inferredSubject,
    measures: rawMeasures,
    dimensions: rawDimensions,
  })
  const visualization = interpretation.plan.visualization ||
    inferVisualization(normalized, sanitized.dimensions, sanitized.measures)

  return {
    ...interpretation,
    filters,
    plan: {
      ...interpretation.plan,
      subject: inferredSubject,
      environment: environmentForSubject(inferredSubject),
      measures: sanitized.measures,
      dimensions: sanitized.dimensions,
      visualization,
      title: interpretation.plan.title || interpretation.summary || getSubject(inferredSubject).label,
    },
  }
}

async function interpretWithAi(freeText: string, context: unknown) {
  const clientRequestId = randomUUID()
  const today = new Date().toISOString().slice(0, 10)
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
          content: `Tu es l'interpréteur sémantique de l'Assistant BI CEGECLIM.
Date du jour : ${today}. Langue métier : français.

Ta mission est de transformer une demande libre en :
1. un plan d'analyse métier contrôlé ;
2. des filtres structurés ;
3. une restitution lisible et adaptée.

Tu ne génères jamais de SQL. Tu n'inventes aucune valeur métier.
Tu peux corriger les formulations imprécises grâce aux synonymes du catalogue.
Si le contexte contient lockSubject:true, conserve obligatoirement le sujet du contexte, même si la demande emploie des mots associés à un autre sujet. Adapte alors seulement les mesures, dimensions, dates, filtres et restitution.
Si l'utilisateur donne seulement une précision de filtre, conserve le sujet, les mesures, les dimensions et la période du contexte.
Résous les périodes relatives ("cette année", "mois dernier", "12 derniers mois") en dates ISO.
Choisis :
- courbe pour une tendance temporelle ;
- histogramme pour comparer des catégories ;
- histogramme_empile pour une évolution ou une comparaison avec une seconde dimension ;
- tableau pour un top, un détail ou plus de deux dimensions ;
- camembert uniquement pour une répartition simple de 6 catégories maximum.
N'utilise que les clés exactes du catalogue ci-dessous.

${buildSemanticPromptReference()}

Retourne strictement ce JSON :
{
  "summary":"phrase courte décrivant l'analyse comprise",
  "plan":{
    "environment":null,
    "subject":null,
    "measures":[],
    "dimensions":[],
    "visualization":null,
    "dateStart":"",
    "dateEnd":"",
    "title":""
  },
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
          content: `Demande libre : ${freeText}\nContexte actuel : ${JSON.stringify(context || {})}`,
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
          plan: emptyAssistantBiAnalysisPlan(),
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
        summary: 'Interprétation automatique basée sur le catalogue métier et les règles explicites détectées.',
        filters: emptyAssistantBiStructuredFilters(),
        plan: emptyAssistantBiAnalysisPlan(),
        assumptions: [`IA indisponible : ${aiError}`],
        needsConfirmation: true,
        clarificationQuestion: '',
      }
    }

    const withYears = mergeExplicitYearRules(
      normalizeAssistantBiFreeTextInterpretation(raw),
      freeText,
    )
    const normalized = mergeDeterministicBusinessRules(withYears, freeText, body.context)

    return NextResponse.json({
      interpretation: normalized,
      ai: {
        available: aiAvailable,
        model: MODEL,
        error: aiError || undefined,
      },
      version: 'SEMANTIC-PLAN-V2-LOCKED-SUBJECT',
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
