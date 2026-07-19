export type AssistantBiStructuredFilters = {
  includeYears: number[]
  excludeYears: number[]
  includeAgencies: string[]
  excludeAgencies: string[]
  includeDepartments: string[]
  excludeDepartments: string[]
  includeFamilyMacros: string[]
  excludeFamilyMacros: string[]
  includeFamilies: string[]
  excludeFamilies: string[]
  includeReferences: string[]
  excludeReferences: string[]
  includeClients: string[]
  excludeClients: string[]
  includeDocumentTypes: string[]
  excludeDocumentTypes: string[]
  topN: number | null
  sortMode: 'dimensions_asc' | 'measure_desc' | 'measure_asc' | null
}

export type AssistantBiFreeTextInterpretation = {
  summary: string
  filters: AssistantBiStructuredFilters
  assumptions: string[]
  needsConfirmation: boolean
  clarificationQuestion: string
}

const EMPTY_FILTERS: AssistantBiStructuredFilters = {
  includeYears: [],
  excludeYears: [],
  includeAgencies: [],
  excludeAgencies: [],
  includeDepartments: [],
  excludeDepartments: [],
  includeFamilyMacros: [],
  excludeFamilyMacros: [],
  includeFamilies: [],
  excludeFamilies: [],
  includeReferences: [],
  excludeReferences: [],
  includeClients: [],
  excludeClients: [],
  includeDocumentTypes: [],
  excludeDocumentTypes: [],
  topN: null,
  sortMode: null,
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean)))
}

function years(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(Number).filter((item) => Number.isInteger(item) && item >= 1900 && item <= 2200)))
}

function topN(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : null
}

function sortMode(value: unknown): AssistantBiStructuredFilters['sortMode'] {
  return value === 'measure_desc' || value === 'measure_asc' || value === 'dimensions_asc'
    ? value
    : null
}

export function emptyAssistantBiStructuredFilters(): AssistantBiStructuredFilters {
  return { ...EMPTY_FILTERS }
}

export function normalizeAssistantBiStructuredFilters(value: unknown): AssistantBiStructuredFilters {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    includeYears: years(source.includeYears),
    excludeYears: years(source.excludeYears),
    includeAgencies: strings(source.includeAgencies),
    excludeAgencies: strings(source.excludeAgencies),
    includeDepartments: strings(source.includeDepartments),
    excludeDepartments: strings(source.excludeDepartments),
    includeFamilyMacros: strings(source.includeFamilyMacros),
    excludeFamilyMacros: strings(source.excludeFamilyMacros),
    includeFamilies: strings(source.includeFamilies),
    excludeFamilies: strings(source.excludeFamilies),
    includeReferences: strings(source.includeReferences),
    excludeReferences: strings(source.excludeReferences),
    includeClients: strings(source.includeClients),
    excludeClients: strings(source.excludeClients),
    includeDocumentTypes: strings(source.includeDocumentTypes),
    excludeDocumentTypes: strings(source.excludeDocumentTypes),
    topN: topN(source.topN),
    sortMode: sortMode(source.sortMode),
  }
}

export function normalizeAssistantBiFreeTextInterpretation(value: unknown): AssistantBiFreeTextInterpretation {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    summary: typeof source.summary === 'string' ? source.summary.trim() : '',
    filters: normalizeAssistantBiStructuredFilters(source.filters),
    assumptions: strings(source.assumptions),
    needsConfirmation: source.needsConfirmation === true,
    clarificationQuestion: typeof source.clarificationQuestion === 'string'
      ? source.clarificationQuestion.trim()
      : '',
  }
}

export function explicitYearRules(text: string) {
  const includeYears = new Set<number>()
  const excludeYears = new Set<number>()
  const normalized = text.replace(/[’']/g, "'")

  const exclusionPatterns = [
    /(?:exclu(?:re|s|ant)?|sans|sauf|hors)[^\d]{0,120}(20\d{2}|19\d{2})/gi,
    /ne\s+(?:prends?|prendre|tiens?|tenir|consid[eé]rer)[^\n]{0,140}?(?:pas|plus)[^\d]{0,120}(20\d{2}|19\d{2})/gi,
    /ne\s+(?:prends?|prendre|tiens?|tenir)[^\n]{0,160}(20\d{2}|19\d{2})[^\n]{0,40}(?:pas|plus)\s+en\s+compte/gi,
    /(?:ignore|retire|supprime)[^\d]{0,120}(20\d{2}|19\d{2})/gi,
  ]
  for (const pattern of exclusionPatterns) {
    for (const match of normalized.matchAll(pattern)) excludeYears.add(Number(match[1]))
  }

  for (const match of normalized.matchAll(/(?:uniquement|seulement|sur|pour|en)\s+(?:l[' ]ann[eé]e\s+)?(20\d{2}|19\d{2})/gi)) {
    const year = Number(match[1])
    if (!excludeYears.has(year)) includeYears.add(year)
  }

  return {
    includeYears: [...includeYears],
    excludeYears: [...excludeYears],
  }
}

export function mergeExplicitYearRules(
  interpretation: AssistantBiFreeTextInterpretation,
  text: string,
): AssistantBiFreeTextInterpretation {
  const explicit = explicitYearRules(text)
  const excluded = new Set([...interpretation.filters.excludeYears, ...explicit.excludeYears])
  const included = new Set([...interpretation.filters.includeYears, ...explicit.includeYears])
  excluded.forEach((year) => included.delete(year))
  return {
    ...interpretation,
    filters: {
      ...interpretation.filters,
      includeYears: [...included].sort((left, right) => left - right),
      excludeYears: [...excluded].sort((left, right) => left - right),
    },
  }
}

export function hasDetailedStructuredFilters(filters: AssistantBiStructuredFilters) {
  return Boolean(
    filters.includeReferences.length || filters.excludeReferences.length ||
    filters.includeClients.length || filters.excludeClients.length ||
    filters.includeDepartments.length || filters.excludeDepartments.length,
  )
}

export function describeAssistantBiStructuredFilters(filters: AssistantBiStructuredFilters) {
  const parts: string[] = []
  if (filters.includeYears.length) parts.push(`années incluses : ${filters.includeYears.join(', ')}`)
  if (filters.excludeYears.length) parts.push(`années exclues : ${filters.excludeYears.join(', ')}`)
  if (filters.includeAgencies.length) parts.push(`agences incluses : ${filters.includeAgencies.join(', ')}`)
  if (filters.excludeAgencies.length) parts.push(`agences exclues : ${filters.excludeAgencies.join(', ')}`)
  if (filters.includeDepartments.length) parts.push(`départements inclus : ${filters.includeDepartments.join(', ')}`)
  if (filters.excludeDepartments.length) parts.push(`départements exclus : ${filters.excludeDepartments.join(', ')}`)
  if (filters.includeFamilyMacros.length) parts.push(`familles macro incluses : ${filters.includeFamilyMacros.join(', ')}`)
  if (filters.excludeFamilyMacros.length) parts.push(`familles macro exclues : ${filters.excludeFamilyMacros.join(', ')}`)
  if (filters.includeFamilies.length) parts.push(`familles incluses : ${filters.includeFamilies.join(', ')}`)
  if (filters.excludeFamilies.length) parts.push(`familles exclues : ${filters.excludeFamilies.join(', ')}`)
  if (filters.includeReferences.length) parts.push(`références incluses : ${filters.includeReferences.join(', ')}`)
  if (filters.excludeReferences.length) parts.push(`références exclues : ${filters.excludeReferences.join(', ')}`)
  if (filters.includeClients.length) parts.push(`clients inclus : ${filters.includeClients.join(', ')}`)
  if (filters.excludeClients.length) parts.push(`clients exclus : ${filters.excludeClients.join(', ')}`)
  if (filters.includeDocumentTypes.length) parts.push(`documents inclus : ${filters.includeDocumentTypes.join(', ')}`)
  if (filters.excludeDocumentTypes.length) parts.push(`documents exclus : ${filters.excludeDocumentTypes.join(', ')}`)
  if (filters.topN) parts.push(`top ${filters.topN}`)
  if (filters.sortMode) parts.push(`tri : ${filters.sortMode}`)
  return parts.length ? parts.join(' ; ') : 'Aucun filtre complémentaire détecté.'
}
