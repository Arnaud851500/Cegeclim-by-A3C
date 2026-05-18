import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

type DataSource = 'factures' | 'activite' | 'mixte'
type ClientFilterMode = 'include' | 'exclude'

type AtelierFilters = {
  sources: DataSource[]
  years: number[]
  months: number[]
  agences: string[]
  collaborateurs: string[]
  famillesMacro: string[]
  typesDocument: string[]
  clients: string[]
  clientMode: ClientFilterMode
  horsStatistique: 'non' | 'oui' | 'tous'
}

type AtelierAiBody = {
  question?: string
  currentViewName?: string
  globalFilters?: any
  widgets?: any[]
  selectedWidget?: any
  dataContext?: unknown
  versions?: unknown
}

const DEFAULT_FILTERS: AtelierFilters = {
  sources: ['mixte'],
  years: [],
  months: [],
  agences: [],
  collaborateurs: [],
  famillesMacro: [],
  typesDocument: [],
  clients: [],
  clientMode: 'include',
  horsStatistique: 'non',
}

const ALLOWED_WIDGET_TYPES = ['kpi', 'histogramme', 'histogramme_empile', 'courbe', 'bridge', 'tableau', 'camembert', 'synthese']
const ALLOWED_SOURCES = ['factures', 'activite', 'mixte']
const ALLOWED_MEASURES = ['ca_ht', 'marge_valeur', 'marge_pct', 'quantite', 'nb_lignes']
const ALLOWED_DIMENSIONS = ['annee', 'mois', 'type_document', 'agence_collaborateur', 'collaborateur', 'famille_macro', 'famille', 'intitule_tiers', 'numero_tiers', 'source']
const ALLOWED_SIZES = ['small', 'medium', 'large', 'full']
const ALLOWED_PERIODS = ['mois', 'cumul']
const ALLOWED_COMPARE_MODES = ['year', 'month', 'dimension']
const ALLOWED_EVOLUTION_MODES = ['none', 'value', 'percent', 'both']
const ALLOWED_SORT_MODES = ['label_asc', 'value_desc', 'value_asc']

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((v) => String(v || '').trim()).filter(Boolean)
    : []
}

function asNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : []
}

function normalizeSources(value: unknown): DataSource[] {
  const allowed = new Set(['factures', 'activite', 'mixte'])
  const values = asStringArray(value).filter((v) => allowed.has(v)) as DataSource[]
  return values.length ? values : ['mixte']
}

function normalizeHorsStatistique(value: unknown): 'non' | 'oui' | 'tous' {
  return value === 'oui' || value === 'tous' ? value : 'non'
}

function normalizeClientMode(value: unknown): ClientFilterMode {
  return value === 'exclude' ? 'exclude' : 'include'
}

function normalizeFilters(input: any): AtelierFilters {
  return {
    sources: normalizeSources(input?.sources),
    years: asNumberArray(input?.years),
    months: asNumberArray(input?.months),
    agences: asStringArray(input?.agences),
    collaborateurs: asStringArray(input?.collaborateurs),
    famillesMacro: asStringArray(input?.famillesMacro),
    typesDocument: asStringArray(input?.typesDocument),
    clients: asStringArray(input?.clients),
    clientMode: normalizeClientMode(input?.clientMode),
    horsStatistique: normalizeHorsStatistique(input?.horsStatistique),
  }
}

function isNonEmptyArray(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

function mergeLocalFilters(globalFilters: AtelierFilters, selectedWidget: any): AtelierFilters {
  if (!selectedWidget) return globalFilters

  const local = selectedWidget?.localFilters || {}
  const base: AtelierFilters = selectedWidget?.useGlobalFilters === false ? { ...DEFAULT_FILTERS } : { ...globalFilters }
  const next: AtelierFilters = { ...base }

  if (selectedWidget?.source === 'factures' || selectedWidget?.source === 'activite' || selectedWidget?.source === 'mixte') {
    next.sources = [selectedWidget.source]
  }

  if (isNonEmptyArray(local.years)) next.years = asNumberArray(local.years)
  if (isNonEmptyArray(local.months)) next.months = asNumberArray(local.months)
  if (isNonEmptyArray(local.agences)) next.agences = asStringArray(local.agences)
  if (isNonEmptyArray(local.collaborateurs)) next.collaborateurs = asStringArray(local.collaborateurs)
  if (isNonEmptyArray(local.famillesMacro)) next.famillesMacro = asStringArray(local.famillesMacro)
  if (isNonEmptyArray(local.typesDocument)) next.typesDocument = asStringArray(local.typesDocument)
  if (isNonEmptyArray(local.clients)) next.clients = asStringArray(local.clients)
  if (local.clientMode) next.clientMode = normalizeClientMode(local.clientMode)
  if (local.horsStatistique) next.horsStatistique = normalizeHorsStatistique(local.horsStatistique)

  return next
}

function extractOutputText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()

  const parts: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text)
      if (typeof content?.text?.value === 'string') parts.push(content.text.value)
    }
  }

  return parts.join('\n').trim()
}

function tryParseJsonObject(text: string) {
  const clean = String(text || '').trim()
  if (!clean) return null

  try {
    return JSON.parse(clean)
  } catch {}

  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) {
    try {
      return JSON.parse(fenced.trim())
    } catch {}
  }

  const first = clean.indexOf('{')
  const last = clean.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(clean.slice(first, last + 1))
    } catch {}
  }

  return null
}

function keepAllowed(value: any, allowed: string[], fallback?: string) {
  const text = String(value || '').trim()
  return allowed.includes(text) ? text : fallback
}

function sanitizeWidgetProposal(raw: any) {
  if (!raw || typeof raw !== 'object') return null

  const proposal: Record<string, any> = {}

  proposal.title = String(raw.title || raw.titre || 'Widget proposé par l’IA').trim().slice(0, 90)
  proposal.type = keepAllowed(raw.type, ALLOWED_WIDGET_TYPES, 'tableau')
  proposal.source = keepAllowed(raw.source, ALLOWED_SOURCES, 'factures')
  proposal.size = keepAllowed(raw.size || raw.taille, ALLOWED_SIZES, proposal.type === 'tableau' || proposal.type === 'synthese' ? 'full' : 'medium')
  proposal.measure = keepAllowed(raw.measure || raw.valeur, ALLOWED_MEASURES, 'ca_ht')
  proposal.secondMeasure = keepAllowed(raw.secondMeasure, ALLOWED_MEASURES, undefined)

  if (Array.isArray(raw.tableMeasures)) {
    const measures = raw.tableMeasures.map((v: any) => keepAllowed(v, ALLOWED_MEASURES)).filter(Boolean)
    if (measures.length) proposal.tableMeasures = measures
  }

  proposal.dimension = keepAllowed(raw.dimension, ALLOWED_DIMENSIONS, proposal.type === 'camembert' ? 'famille_macro' : 'mois')
  proposal.seriesDimension = raw.seriesDimension === '' ? '' : keepAllowed(raw.seriesDimension, ALLOWED_DIMENSIONS, proposal.type === 'courbe' || proposal.type === 'histogramme' ? 'annee' : '')
  proposal.rowDimension = keepAllowed(raw.rowDimension, ALLOWED_DIMENSIONS, 'agence_collaborateur')
  proposal.rowDimension2 = raw.rowDimension2 === '' ? '' : keepAllowed(raw.rowDimension2, ALLOWED_DIMENSIONS, '')
  proposal.columnDimension = keepAllowed(raw.columnDimension, ALLOWED_DIMENSIONS, 'mois')
  proposal.columnDimension2 = raw.columnDimension2 === '' ? '' : keepAllowed(raw.columnDimension2, ALLOWED_DIMENSIONS, '')
  proposal.periodMode = keepAllowed(raw.periodMode, ALLOWED_PERIODS, 'cumul')
  proposal.compareMode = keepAllowed(raw.compareMode, ALLOWED_COMPARE_MODES, 'year')
  proposal.compareDimension = raw.compareDimension === '' ? '' : keepAllowed(raw.compareDimension, ALLOWED_DIMENSIONS, '')
  proposal.evolutionMode = keepAllowed(raw.evolutionMode, ALLOWED_EVOLUTION_MODES, 'percent')
  proposal.sortMode = keepAllowed(raw.sortMode, ALLOWED_SORT_MODES, 'value_desc')

  if (typeof raw.compareValue === 'string') proposal.compareValue = raw.compareValue
  if (typeof raw.useGlobalFilters === 'boolean') proposal.useGlobalFilters = raw.useGlobalFilters
  if (typeof raw.stacked100 === 'boolean') proposal.stacked100 = raw.stacked100
  if (typeof raw.showValues === 'boolean') proposal.showValues = raw.showValues

  const topN = Number(raw.topN)
  if (Number.isFinite(topN)) proposal.topN = Math.max(1, Math.min(50, Math.round(topN)))

  const bridgeMonth = Number(raw.bridgeMonth)
  if (Number.isFinite(bridgeMonth)) proposal.bridgeMonth = Math.max(1, Math.min(12, Math.round(bridgeMonth)))

  const yearN = Number(raw.yearN)
  const yearN1 = Number(raw.yearN1)
  if (Number.isFinite(yearN)) proposal.yearN = yearN
  if (Number.isFinite(yearN1)) proposal.yearN1 = yearN1

  if (raw.localFilters && typeof raw.localFilters === 'object') proposal.localFilters = raw.localFilters
  if (raw.rationale || raw.raison) proposal.rationale = String(raw.rationale || raw.raison).slice(0, 500)
  if (raw.confidence !== undefined) proposal.confidence = raw.confidence

  return proposal
}

function fallbackWidgetProposals(question: string) {
  const q = question.toLowerCase()
  if (!q.includes('widget') && !q.includes('graph') && !q.includes('tableau') && !q.includes('bridge') && !q.includes('propose')) return []

  return [
    {
      title: 'Bridge CA N-1 ⇒ N par agence',
      type: 'bridge',
      source: 'mixte',
      size: 'medium',
      measure: 'ca_ht',
      dimension: 'agence_collaborateur',
      periodMode: 'cumul',
      compareMode: 'year',
      rationale: 'Permet d’identifier rapidement les agences qui expliquent l’écart de CA entre N-1 et N.',
    },
    {
      title: 'Top clients contributeurs CA',
      type: 'tableau',
      source: 'mixte',
      size: 'full',
      rowDimension: 'intitule_tiers',
      rowDimension2: 'famille_macro',
      columnDimension: 'annee',
      columnDimension2: '',
      tableMeasures: ['ca_ht', 'marge_pct'],
      sortMode: 'value_desc',
      topN: 20,
      rationale: 'Donne la lecture client/famille pour comprendre les contributeurs principaux.',
    },
  ]
}

async function loadSupabaseContext(filters: AtelierFilters) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Variables Supabase manquantes : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.')
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabaseAdmin.rpc('ai_atelier_context', {
    p_filters: filters,
    p_limit: 25,
  })

  if (error) {
    throw new Error(
      `Contexte Supabase IA impossible : ${error.message}. ` +
        `Exécute d'abord le SQL ai_atelier_context.sql dans Supabase, puis relance la question.`
    )
  }

  return data
}

export async function POST(req: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY manquante. Ajoute la clé dans .env.local ou dans les variables d’environnement Vercel.' },
        { status: 500 }
      )
    }

    const body = (await req.json()) as AtelierAiBody
    const question = String(body.question || '').trim()

    if (!question) return NextResponse.json({ error: 'Question vide.' }, { status: 400 })

    const globalFilters = normalizeFilters(body.globalFilters || {})
    const effectiveFilters = mergeLocalFilters(globalFilters, body.selectedWidget)
    const supabaseContext = await loadSupabaseContext(effectiveFilters)

    const systemContext = `
Tu es l'assistant IA de l'Atelier d'analyse CEGECLIM.

Tu analyses les indicateurs factures et activité à partir :
1. De la configuration de la vue et des widgets.
2. D'un contexte Supabase agrégé en lecture seule.
3. Des règles métier CA / marge / activité.

Règles métier :
- Les factures viennent des agrégats de facturation.
- L'activité vient des agrégats d'activité.
- La source "mixte" signifie factures + activité selon les filtres actifs.
- CA = ca_ht.
- Marge valeur = marge_valeur.
- Marge % = marge_valeur / ca_ht.
- Hors statistique est exclu par défaut.
- Les BR correspondent généralement à des retours et doivent être interprétés avec prudence.
- Tu ne dois jamais inventer de chiffres : les chiffres doivent venir du contexte Supabase.

Étape 3 : tu peux proposer des widgets à ajouter dans l'atelier.
Tu ne modifies jamais la vue toi-même : tu proposes des widgets, le front les applique seulement après validation utilisateur.

Tu dois répondre exclusivement avec un JSON valide, sans markdown, sous cette forme :
{
  "answer": "réponse métier en français",
  "proposed_widgets": [
    {
      "title": "Titre court",
      "type": "kpi | histogramme | histogramme_empile | courbe | bridge | tableau | camembert | synthese",
      "source": "factures | activite | mixte",
      "size": "small | medium | large | full",
      "measure": "ca_ht | marge_valeur | marge_pct | quantite | nb_lignes",
      "secondMeasure": "ca_ht | marge_valeur | marge_pct | quantite | nb_lignes",
      "tableMeasures": ["ca_ht", "marge_pct"],
      "dimension": "mois | annee | agence_collaborateur | collaborateur | famille_macro | famille | intitule_tiers | numero_tiers | type_document | source",
      "seriesDimension": "annee",
      "rowDimension": "agence_collaborateur",
      "rowDimension2": "famille_macro",
      "columnDimension": "annee",
      "columnDimension2": "mois",
      "periodMode": "mois | cumul",
      "compareMode": "year | month | dimension",
      "evolutionMode": "none | value | percent | both",
      "topN": 12,
      "sortMode": "label_asc | value_desc | value_asc",
      "useGlobalFilters": true,
      "localFilters": {},
      "rationale": "Pourquoi ce widget est utile"
    }
  ]
}

Propose 0 widget si la question ne demande qu'une explication simple.
Propose 1 à 3 widgets si la question demande de créer, ajouter, proposer, comprendre un écart, trouver les contributeurs, ou améliorer la vue.
Les champs proposés doivent respecter strictement les valeurs autorisées ci-dessus.
`

    const userContext = `
Vue active :
${body.currentViewName || 'Non renseignée'}

Versions :
${JSON.stringify(body.versions || {}, null, 2)}

Filtres globaux transmis par le front :
${JSON.stringify(globalFilters, null, 2)}

Filtres réellement utilisés pour le contexte Supabase :
${JSON.stringify(effectiveFilters, null, 2)}

Widget sélectionné :
${JSON.stringify(body.selectedWidget || null, null, 2)}

Widgets présents dans la vue :
${JSON.stringify(body.widgets || [], null, 2)}

Contexte des données chargées côté front :
${JSON.stringify(body.dataContext || {}, null, 2)}

Contexte Supabase agrégé et contrôlé :
${JSON.stringify(supabaseContext || {}, null, 2)}

Question utilisateur :
${question}
`

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: systemContext,
        input: userContext,
      }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const rawMessage = data?.error?.message || `Erreur OpenAI (${response.status}).`
      const errorCode = data?.error?.code || ''
      const isQuotaError =
        errorCode === 'insufficient_quota' ||
        rawMessage.toLowerCase().includes('quota') ||
        rawMessage.toLowerCase().includes('billing')

      return NextResponse.json(
        {
          error: isQuotaError
            ? "Le compte API OpenAI utilisé par cette application n'a plus de quota ou n'a pas encore de facturation active. Vérifie Billing / Usage limits sur platform.openai.com."
            : rawMessage,
          details: data,
        },
        { status: response.status }
      )
    }

    const outputText = extractOutputText(data)
    const parsed = tryParseJsonObject(outputText)
    const answer = typeof parsed?.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : outputText || 'Réponse vide.'

    let proposedWidgets = Array.isArray(parsed?.proposed_widgets)
      ? parsed.proposed_widgets.map(sanitizeWidgetProposal).filter(Boolean)
      : []

    if (!proposedWidgets.length) proposedWidgets = fallbackWidgetProposals(question).map(sanitizeWidgetProposal).filter(Boolean)

    return NextResponse.json({
      answer,
      proposed_widgets: proposedWidgets,
      model: OPENAI_MODEL,
      ai_step: 'STEP-3-WIDGET-BUILDER-01',
      supabase_context_version: supabaseContext?.version || null,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erreur serveur atelier-ai.' }, { status: 500 })
  }
}
