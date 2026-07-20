'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccess } from '@/components/AccessContext'
import { ChoiceButton, PlanLine, Step, ToggleChoice } from '@/components/assistant-bi/AssistantBiControls'
import { ProfessionalResults } from '@/components/assistant-bi/ProfessionalResults'
import { assistantBiPageStyles as styles } from '@/components/assistant-bi/assistantBiPageStyles'
import { normalizeAiResult, type AiResult } from '@/lib/ai/assistantBiTypes'
import {
  describeAssistantBiStructuredFilters,
  emptyAssistantBiAnalysisPlan,
  emptyAssistantBiStructuredFilters,
  normalizeAssistantBiFreeTextInterpretation,
  type AssistantBiFreeTextInterpretation,
} from '@/lib/ai/assistantBiStructuredFilters'
import {
  ANALYSIS_TEMPLATES,
  DIMENSIONS,
  MEASURES,
  SUBJECTS,
  buildGuidedQuestion,
  environmentForSubject,
  getEnvironment,
  getSubject,
  recommendedVisualization,
  sanitizeSubjectConfiguration,
  type AnalysisTemplate,
  type SemanticDimensionKey,
  type SemanticMeasureKey,
  type SemanticSubjectKey,
  type SemanticVisualizationKey,
} from '@/lib/ai/cegeclimSemanticCatalog'

type SortMode = 'dimensions_asc' | 'measure_desc' | 'measure_asc'
type ArticleFlow = 'ALL' | 'FACTURE' | 'BL' | 'DEVIS' | 'CDC'

type SourcePlan = {
  mode: string
  table: string
  title: string
  detail: string
  flow: ArticleFlow
  warnings: string[]
}

type EffectiveConfig = {
  measures: SemanticMeasureKey[]
  dimensions: SemanticDimensionKey[]
  visualization: SemanticVisualizationKey
  dateStart: string
  dateEnd: string
  sortMode: SortMode
  articleFlow: ArticleFlow
}

const VISUALIZATIONS: Array<{ key: SemanticVisualizationKey; label: string; description: string }> = [
  { key: 'tableau', label: 'Tableau', description: 'Détail triable et exportable' },
  { key: 'courbe', label: 'Courbe', description: 'Évolution dans le temps' },
  { key: 'histogramme', label: 'Histogramme', description: 'Comparaison de catégories' },
  { key: 'histogramme_empile', label: 'Histogramme empilé', description: 'Mix et contribution par série' },
  { key: 'camembert', label: 'Camembert', description: 'Répartition simple, 12 éléments max.' },
]

const SORT_OPTIONS: Array<{ key: SortMode; label: string; description: string }> = [
  { key: 'dimensions_asc', label: 'Dimensions croissantes', description: 'Ex. année, mois, agence, référence.' },
  { key: 'measure_desc', label: 'Mesure décroissante', description: 'Les plus fortes valeurs en premier.' },
  { key: 'measure_asc', label: 'Mesure croissante', description: 'Les plus faibles valeurs en premier.' },
]

const ARTICLE_FLOWS: Array<{ key: ArticleFlow; label: string; description: string }> = [
  { key: 'ALL', label: 'Tous les flux', description: 'DEVIS, CDC, BL et FACTURE, distingués par le type de document.' },
  { key: 'FACTURE', label: 'Facturation', description: 'Articles et familles issus du flux FACTURE.' },
  { key: 'BL', label: 'Ventes BL', description: 'Articles livrés selon les règles consolidées Flux Articles.' },
  { key: 'DEVIS', label: 'Devis', description: 'Articles présents dans les devis.' },
  { key: 'CDC', label: 'Commandes CDC', description: 'Articles rattachés au flux de commandes.' },
]

const FREE_TEXT_EXAMPLES = [
  'Quel est le chiffre d’affaires par famille macro en juin 2026 et juin 2025, avec l’évolution en % ?',
  'Liste les articles de la famille macro R/R avec les quantités facturées en 2025 et 2026.',
  'Top 20 clients en BL sur les 12 derniers mois, hors Marmande, avec le CA et la marge.',
]

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function labelFor(key: string, definitions: Array<{ key: string; label: string }>) {
  return definitions.find((item) => item.key === key)?.label || key
}

function subjectRoutingHint(subject: SemanticSubjectKey) {
  if (subject === 'articles') return 'Source physique : indicateur_flux_articles_mensuel. Ce sujet ne bascule jamais silencieusement sur activite_lignes.'
  if (subject === 'ventes_bl') return 'Ventes livrées : agrégat activité pour les analyses générales ; Flux Articles filtré sur BL dès qu’une famille ou un article est demandé.'
  if (subject === 'factures') return 'Facturation : agrégat factures pour les analyses générales ; Flux Articles filtré sur FACTURE pour les analyses famille/article.'
  if (subject === 'devis') return 'Devis : agrégat devis pour les analyses générales ; Flux Articles filtré sur DEVIS pour les analyses famille/article.'
  if (subject === 'clients') return 'Référentiel clients ou facturation détaillée selon la mesure et les dimensions demandées.'
  return 'Portefeuille : activité et documents encore présents dans le portefeuille.'
}

function sourceForSubject(subject: SemanticSubjectKey) {
  if (subject === 'factures') return ['factures']
  if (subject === 'devis') return ['devis']
  if (subject === 'articles') return ['flux_articles']
  return ['activite']
}

function documentTypesForSubject(subject: SemanticSubjectKey, articleFlow: ArticleFlow) {
  if (subject === 'articles') return articleFlow === 'ALL' ? [] : [articleFlow]
  if (subject === 'ventes_bl') return ['BL']
  if (subject === 'portefeuille') return ['CDC', 'PL', 'BL', 'BR', 'BL M-x']
  return []
}

function monthHints(dateStart: string, dateEnd: string) {
  const start = dateStart ? new Date(`${dateStart}T12:00:00`) : null
  const end = dateEnd ? new Date(`${dateEnd}T12:00:00`) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { years: [] as number[], months: [] as number[] }
  const years: number[] = []
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) years.push(year)
  const months = start.getFullYear() === end.getFullYear()
    ? Array.from({ length: Math.max(0, end.getMonth() - start.getMonth() + 1) }, (_, index) => start.getMonth() + index + 1)
    : []
  return { years, months }
}

function professionalDataInstruction(
  visualization: SemanticVisualizationKey,
  dimensions: SemanticDimensionKey[],
  measures: SemanticMeasureKey[],
) {
  if (visualization === 'histogramme_empile') return `Prépare un histogramme empilé : axe ${dimensions[0]}, couleur ${dimensions[1]}, valeur ${measures[0]}.`
  if (visualization === 'courbe') return `Trie chronologiquement selon ${dimensions[0]}.`
  if (visualization === 'camembert') return `Retourne au maximum 12 catégories triées par ${measures[0]} décroissante.`
  return 'Retourne un jeu de données plat, agrégé uniquement selon les dimensions demandées.'
}

function emptyInterpretation(): AssistantBiFreeTextInterpretation {
  return {
    summary: 'Configuration guidée manuelle.',
    filters: emptyAssistantBiStructuredFilters(),
    plan: emptyAssistantBiAnalysisPlan(),
    assumptions: [],
    needsConfirmation: false,
    clarificationQuestion: '',
  }
}

function inferArticleFlow(text: string, current: ArticleFlow) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:facture|factures|facturees?|facturation|ca facture)\b/.test(normalized)) return 'FACTURE' as const
  if (/\b(?:bl|bons? de livraison|livrees?|livraison)\b/.test(normalized)) return 'BL' as const
  if (/\b(?:devis|offres?|propositions?)\b/.test(normalized)) return 'DEVIS' as const
  if (/\b(?:cdc|bons? de commande|commandes?)\b/.test(normalized)) return 'CDC' as const
  return current
}

export default function AssistantBiPage() {
  const { rights } = useAccess()
  const now = useMemo(() => new Date(), [])
  const interpretationRef = useRef<HTMLElement | null>(null)
  const [subject, setSubject] = useState<SemanticSubjectKey>('ventes_bl')
  const [measures, setMeasures] = useState<SemanticMeasureKey[]>(['ca_ht', 'quantite'])
  const [dimensions, setDimensions] = useState<SemanticDimensionKey[]>(['mois', 'agence_collaborateur'])
  const [visualization, setVisualization] = useState<SemanticVisualizationKey>('histogramme_empile')
  const [dateStart, setDateStart] = useState(`${now.getFullYear()}-01-01`)
  const [dateEnd, setDateEnd] = useState(isoDate(now))
  const [articleFlow, setArticleFlow] = useState<ArticleFlow>('ALL')
  const [freeText, setFreeText] = useState('')
  const [templateSuffix, setTemplateSuffix] = useState('')
  const [excludeHorsStatistique, setExcludeHorsStatistique] = useState(true)
  const [includeProspects, setIncludeProspects] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('dimensions_asc')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [interpretation, setInterpretation] = useState<AssistantBiFreeTextInterpretation | null>(null)
  const [sourcePlan, setSourcePlan] = useState<SourcePlan | null>(null)
  const [interpreting, setInterpreting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AiResult | null>(null)

  const selectedSubject = useMemo(() => getSubject(subject), [subject])
  const selectedEnvironment = useMemo(() => getEnvironment(environmentForSubject(subject)), [subject])
  const generatedQuestion = useMemo(() => buildGuidedQuestion({
    subject, measures, dimensions, visualization, dateStart, dateEnd, freeText, promptSuffix: templateSuffix,
  }), [subject, measures, dimensions, visualization, dateStart, dateEnd, freeText, templateSuffix])
  const resultTitle = useMemo(() => {
    if (interpretation?.plan.title) return interpretation.plan.title
    const measure = labelFor(measures[0] || '', MEASURES)
    const first = labelFor(dimensions[0] || '', DIMENSIONS)
    const second = dimensions[1] ? ` et ${labelFor(dimensions[1], DIMENSIONS)}` : ''
    return `${measure} par ${first}${second}`
  }, [interpretation, measures, dimensions])
  const allowedAgencies = rights.allowed_agences || []
  const allowedCollaborators = rights.allowed_collaborateurs || []
  const allowedDepartments = rights.allowed_departements || []
  const isClientCreation = measures.includes('nb_clients_crees') || dimensions.includes('annee_creation_client')
  const usesAbc = dimensions.includes('classe_abc_ca') || dimensions.includes('classe_abc_lignes')

  useEffect(() => {
    if (!showConfirmation) return
    const timer = window.setTimeout(() => interpretationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => window.clearTimeout(timer)
  }, [showConfirmation])

  function resetCalculatedState() {
    setShowConfirmation(false)
    setInterpretation(null)
    setSourcePlan(null)
    setResult(null)
    setError('')
  }

  function changeSubject(next: SemanticSubjectKey) {
    const definition = getSubject(next)
    setSubject(next)
    setMeasures([...definition.defaultMeasures])
    setDimensions([...definition.defaultDimensions])
    setVisualization(recommendedVisualization(definition.defaultDimensions, definition.defaultMeasures))
    setArticleFlow(next === 'articles' ? 'ALL' : articleFlow)
    setTemplateSuffix('')
    resetCalculatedState()
  }

  function applyTemplate(template: AnalysisTemplate) {
    setSubject(template.subject)
    setMeasures([...template.measures])
    setDimensions([...template.dimensions])
    setVisualization(template.visualization)
    setArticleFlow(template.subject === 'articles' ? 'ALL' : articleFlow)
    setTemplateSuffix(template.promptSuffix || '')
    setFreeText('')
    resetCalculatedState()
  }

  function validateConfiguration(config: Pick<EffectiveConfig, 'measures' | 'dimensions' | 'visualization' | 'dateStart' | 'dateEnd'>) {
    if (!config.measures.length) return 'Sélectionne au moins une mesure.'
    if (!config.dimensions.length) return 'Sélectionne au moins un niveau de détail.'
    if (config.visualization === 'histogramme_empile' && config.dimensions.length < 2) return 'Un histogramme empilé nécessite deux dimensions.'
    if (config.dateStart && config.dateEnd && config.dateStart > config.dateEnd) return 'La date de début doit être antérieure à la date de fin.'
    return ''
  }

  function effectiveConfig(interpreted: AssistantBiFreeTextInterpretation): EffectiveConfig {
    const sanitized = sanitizeSubjectConfiguration({
      subject,
      measures: interpreted.plan.measures.length ? interpreted.plan.measures : measures,
      dimensions: interpreted.plan.dimensions.length ? interpreted.plan.dimensions : dimensions,
    })
    return {
      measures: sanitized.measures,
      dimensions: sanitized.dimensions,
      visualization: interpreted.plan.visualization || recommendedVisualization(sanitized.dimensions, sanitized.measures),
      dateStart: interpreted.plan.dateStart || dateStart,
      dateEnd: interpreted.plan.dateEnd || dateEnd,
      sortMode: interpreted.filters.sortMode || sortMode,
      articleFlow: subject === 'articles' ? inferArticleFlow(freeText, articleFlow) : articleFlow,
    }
  }

  function applyConfig(config: EffectiveConfig) {
    setMeasures(config.measures)
    setDimensions(config.dimensions)
    setVisualization(config.visualization)
    setDateStart(config.dateStart)
    setDateEnd(config.dateEnd)
    setSortMode(config.sortMode)
    setArticleFlow(config.articleFlow)
  }

  function requestPayload(config: EffectiveConfig, interpreted: AssistantBiFreeTextInterpretation, previewOnly = false, extraInstruction = '') {
    const temporal = monthHints(config.dateStart, config.dateEnd)
    const question = [
      buildGuidedQuestion({ subject, measures: config.measures, dimensions: config.dimensions, visualization: config.visualization, dateStart: config.dateStart, dateEnd: config.dateEnd, freeText, promptSuffix: templateSuffix }),
      professionalDataInstruction(config.visualization, config.dimensions, config.measures),
      `Demande libre interprétée : ${interpreted.summary}`,
      extraInstruction,
    ].filter(Boolean).join('\n')

    return {
      previewOnly,
      question,
      currentViewName: 'Assistant BI CEGECLIM professionnel',
      globalFilters: {
        sources: sourceForSubject(subject),
        years: temporal.years,
        months: temporal.months,
        agences: allowedAgencies,
        collaborateursFacture: allowedCollaborators,
        collaborateursTiers: allowedCollaborators,
        departementsTiers: allowedDepartments,
        typesDocument: documentTypesForSubject(subject, config.articleFlow),
        horsStatistique: excludeHorsStatistique ? 'non' : 'tous',
        inclureProspects: includeProspects ? 'oui' : 'non',
        sortMode: config.sortMode,
        interpretedFreeText: interpreted.filters,
        accessProfileCode: rights.profile_code,
        accessProfileName: rights.profile_name,
      },
      dataContext: {
        activeTemporalContext: { dateStart: config.dateStart, dateEnd: config.dateEnd },
        semanticEnvironment: selectedEnvironment,
        semanticSubject: selectedSubject,
        analysisBasis: { articleFlow: config.articleFlow },
        visualizationRequest: {
          kind: config.visualization,
          xKey: config.dimensions[0] || null,
          stackBy: config.visualization === 'histogramme_empile' ? config.dimensions[1] || null : null,
          valueKey: config.measures[0] || null,
          dimensions: config.dimensions,
          measures: config.measures,
        },
      },
    }
  }

  async function fetchSourcePlan(config: EffectiveConfig, interpreted: AssistantBiFreeTextInterpretation) {
    const response = await fetch('/api/atelier-ai-db', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload(config, interpreted, true)),
    })
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok || payload.error) throw new Error(String(payload.error || `Erreur HTTP ${response.status}`))
    return payload.sourcePlan as SourcePlan
  }

  async function prepareAnalysis() {
    setError('')
    setInterpreting(true)
    try {
      let interpreted = emptyInterpretation()
      if (freeText.trim()) {
        const response = await fetch('/api/atelier-ai-db/interpret', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            freeText,
            context: {
              lockSubject: true,
              environment: selectedEnvironment,
              subject: selectedSubject,
              measures,
              dimensions,
              visualization,
              dateStart,
              dateEnd,
              articleFlow,
            },
          }),
        })
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>
        if (!response.ok || payload.error) throw new Error(String(payload.error || `Erreur HTTP ${response.status}`))
        interpreted = normalizeAssistantBiFreeTextInterpretation(payload.interpretation)
        interpreted = { ...interpreted, plan: { ...interpreted.plan, subject, environment: environmentForSubject(subject) } }
      }

      const config = effectiveConfig(interpreted)
      const validationError = validateConfiguration(config)
      if (validationError) throw new Error(validationError)
      const plannedSource = await fetchSourcePlan(config, interpreted)
      applyConfig(config)
      setInterpretation(interpreted)
      setSourcePlan(plannedSource)
      setShowConfirmation(true)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setShowConfirmation(false)
    } finally {
      setInterpreting(false)
    }
  }

  async function runAnalysis(extraInstruction = '') {
    const confirmed = interpretation || emptyInterpretation()
    const config: EffectiveConfig = { measures, dimensions, visualization, dateStart, dateEnd, sortMode, articleFlow }
    const validationError = validateConfiguration(config)
    if (validationError) {
      setError(validationError)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/atelier-ai-db', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload(config, confirmed, false, extraInstruction)),
      })
      const raw: unknown = await response.json().catch(() => ({}))
      const payload = normalizeAiResult(raw)
      if (!response.ok || payload.error) throw new Error(payload.error || `Erreur HTTP ${response.status}`)
      setResult(payload)
      setShowConfirmation(false)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  const invalidateInterpretation = () => {
    setShowConfirmation(false)
    setInterpretation(null)
    setSourcePlan(null)
  }

  const confirmationPanel = showConfirmation ? (
    <section ref={interpretationRef} style={{ ...styles.templateSection, scrollMarginTop: 210 }}>
      <div style={styles.sectionHeading}>
        <div>
          <h2 style={styles.sectionTitle}>Interprétation à valider</h2>
          <p style={styles.sectionText}>La source affichée ci-dessous est calculée par le même planificateur que celui qui exécutera le SQL.</p>
        </div>
        <span style={styles.proBadge}>À CONFIRMER</span>
      </div>
      <div style={styles.confirmCard}>
        <PlanLine label="Analyse comprise" value={interpretation?.summary || 'Configuration guidée manuelle'} />
        <PlanLine label="Domaine" value={selectedEnvironment.label} />
        <PlanLine label="Sujet conservé" value={selectedSubject.label} />
        <PlanLine label="Source réelle" value={sourcePlan ? `${sourcePlan.title} — ${sourcePlan.detail}` : 'Planification indisponible'} />
        {sourcePlan?.flow && sourcePlan.flow !== 'ALL' ? <PlanLine label="Flux retenu" value={sourcePlan.flow} /> : null}
        <PlanLine label="Période" value={`${dateStart} au ${dateEnd}`} />
        <PlanLine label="Mesures" value={measures.map((key) => labelFor(key, MEASURES)).join(', ')} />
        <PlanLine label="Regroupement" value={dimensions.map((key, index) => `${index + 1}. ${labelFor(key, DIMENSIONS)}`).join(' → ')} />
        <PlanLine label="Restitution" value={VISUALIZATIONS.find((item) => item.key === visualization)?.label || visualization} />
        <PlanLine label="Périmètre" value={`${allowedAgencies.length || 'toutes'} agence(s), ${allowedDepartments.length || 'tous'} département(s) autorisé(s).`} />
        <div style={styles.interpretationBox}>
          <strong>Filtres compris</strong>
          <b>{describeAssistantBiStructuredFilters(interpretation?.filters || emptyAssistantBiStructuredFilters())}</b>
          {interpretation?.assumptions.length ? <ul style={styles.assumptionList}>{interpretation.assumptions.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </div>
        {sourcePlan?.warnings?.map((warning) => <div key={warning} style={styles.warningBox}><strong>Attention source :</strong> {warning}</div>)}
        {interpretation?.needsConfirmation || interpretation?.clarificationQuestion ? <div style={styles.clarificationBox}><strong>Point à confirmer :</strong> {interpretation.clarificationQuestion || 'Vérifie que l’interprétation correspond à ton besoin.'}</div> : null}
        <div style={styles.settingBlock}><strong>Exclure les articles hors statistiques ?</strong><ToggleChoice value={excludeHorsStatistique} onChange={setExcludeHorsStatistique} /></div>
        {isClientCreation ? <div style={styles.settingBlock}><strong>Inclure aussi les prospects créés ?</strong><ToggleChoice value={includeProspects} onChange={setIncludeProspects} /></div> : null}
        <label style={styles.selectLabel}>Ordre de tri<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} style={styles.select}>{SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><span>{SORT_OPTIONS.find((option) => option.key === sortMode)?.description}</span></label>
        {usesAbc ? <div style={styles.warningBox}><strong>Attention ABC :</strong> la classe utilisée est la classe actuelle issue de la projection stock.</div> : null}
        <div style={styles.confirmActions}>
          <button type="button" style={styles.cancelButton} onClick={() => setShowConfirmation(false)}>Modifier la sélection</button>
          <button type="button" style={styles.confirmButton} onClick={() => void runAnalysis()} disabled={loading}>{loading ? 'Calcul en cours…' : 'Je confirme et je lance le calcul'}</button>
        </div>
      </div>
    </section>
  ) : null

  return (
    <main style={styles.page}>
      <section style={styles.topBar}>
        <div>
          <div style={styles.eyebrow}>CEGECLIM · ASSISTANT DÉCISIONNEL</div>
          <h1 style={styles.title}>Analyse BI professionnelle</h1>
          <p style={styles.subtitle}>Le sujet sélectionné reste la référence ; la source physique est ensuite planifiée et affichée avant le calcul.</p>
        </div>
        <div style={styles.topActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => window.location.assign('/atelier-analyse')}>Atelier classique</button>
          <button type="button" style={styles.primaryButton} onClick={() => void prepareAnalysis()} disabled={loading || interpreting}>{interpreting ? 'Compréhension en cours…' : 'Comprendre et vérifier'}</button>
        </div>
      </section>

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div><h2 style={styles.sectionTitle}>Demande libre</h2><p style={styles.sectionText}>Décris le résultat attendu. Le sujet ne change pas automatiquement.</p></div>
          <span style={styles.proBadge}>MODÈLE SÉMANTIQUE V2</span>
        </div>
        <textarea value={freeText} onChange={(event) => { setFreeText(event.target.value); invalidateInterpretation() }} placeholder="Ex. Quel est le CA par famille macro en juin 2026 et juin 2025, avec l’évolution en % ?" style={{ ...styles.textarea, minHeight: 110, fontSize: 15 }} />
        <div style={{ ...styles.chipRow, marginTop: 10 }}>{FREE_TEXT_EXAMPLES.map((example) => <button type="button" key={example} style={styles.chip} onClick={() => { setFreeText(example); invalidateInterpretation() }}>{example}</button>)}</div>
        <div style={styles.confirmActions}><button type="button" style={styles.confirmButton} onClick={() => void prepareAnalysis()} disabled={loading || interpreting || !freeText.trim()}>{interpreting ? 'Interprétation…' : 'Interpréter cette demande'}</button></div>
      </section>

      {confirmationPanel}

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div><h2 style={styles.sectionTitle}>Analyses prêtes à l’emploi</h2><p style={styles.sectionText}>Les modèles configurent le sujet, les mesures, les dimensions et la restitution.</p></div>
          <span style={styles.proBadge}>MODE GUIDÉ</span>
        </div>
        <div style={styles.templateGrid}>{ANALYSIS_TEMPLATES.map((template) => <button type="button" key={template.id} style={styles.templateCard} onClick={() => applyTemplate(template)}><strong>{template.title}</strong><span>{template.description}</span></button>)}</div>
      </section>

      <section style={styles.workspace}>
        <aside style={styles.builder}>
          <div style={styles.subjectImpact}><strong>Domaine métier : {selectedEnvironment.label}</strong><span>Le domaine organise le catalogue ; seul le sujet pilote l’analyse.</span></div>

          <Step number="1" title="Sujet métier">
            <div style={styles.choiceGrid}>{SUBJECTS.map((item) => <ChoiceButton key={item.key} active={subject === item.key} title={item.label} description={item.description} onClick={() => changeSubject(item.key)} />)}</div>
            <div style={styles.subjectImpact}><strong>Routage du sujet sélectionné</strong><span>{subjectRoutingHint(subject)}</span></div>
            {subject === 'articles' ? <div style={{ marginTop: 12 }}>
              <div style={styles.orderHint}>Base de l’analyse article</div>
              <div style={styles.choiceGrid}>{ARTICLE_FLOWS.map((item) => <ChoiceButton key={item.key} active={articleFlow === item.key} title={item.label} description={item.description} onClick={() => { setArticleFlow(item.key); invalidateInterpretation() }} compact />)}</div>
            </div> : null}
          </Step>

          <Step number="2" title="Mesures">
            <div style={styles.orderHint}>La mesure n°1 pilote le graphique et le tri.</div>
            <div style={styles.chipRow}>{MEASURES.map((item) => {
              const index = measures.indexOf(item.key as SemanticMeasureKey)
              return <button type="button" key={item.key} title={item.description} style={{ ...styles.chip, ...(index >= 0 ? styles.chipActive : {}) }} onClick={() => { setMeasures(toggleValue(measures, item.key as SemanticMeasureKey)); invalidateInterpretation() }}>{index >= 0 ? `${index + 1}. ` : ''}{item.label}</button>
            })}</div>
          </Step>

          <Step number="3" title="Niveaux de détail">
            <div style={styles.orderHint}>1 = axe/lignes ; 2 = couleur/colonnes ; les suivantes détaillent le tableau.</div>
            <div style={styles.selectedPath}>{dimensions.length ? dimensions.map((key, index) => <span key={key} style={styles.pathPill}>{index + 1}. {labelFor(key, DIMENSIONS)}</span>) : <span>Aucune dimension sélectionnée</span>}</div>
            <div style={styles.chipRow}>{DIMENSIONS.map((item) => {
              const index = dimensions.indexOf(item.key as SemanticDimensionKey)
              return <button type="button" key={item.key} title={item.description} style={{ ...styles.chip, ...(index >= 0 ? styles.chipActive : {}) }} onClick={() => { setDimensions(toggleValue(dimensions, item.key as SemanticDimensionKey)); invalidateInterpretation() }}>{index >= 0 ? `${index + 1}. ` : ''}{item.label}</button>
            })}</div>
          </Step>

          <Step number="4" title="Période et restitution">
            <div style={styles.dateRow}>
              <label style={styles.fieldLabel}>Du<input type="date" value={dateStart} onChange={(event) => { setDateStart(event.target.value); invalidateInterpretation() }} style={styles.input} /></label>
              <label style={styles.fieldLabel}>Au<input type="date" value={dateEnd} onChange={(event) => { setDateEnd(event.target.value); invalidateInterpretation() }} style={styles.input} /></label>
            </div>
            <div style={styles.visualGrid}>{VISUALIZATIONS.map((item) => <ChoiceButton key={item.key} active={visualization === item.key} title={item.label} description={item.description} onClick={() => { setVisualization(item.key); invalidateInterpretation() }} compact />)}</div>
            {freeText.trim() ? <details style={styles.previewBox}><summary>Voir la demande complète transmise à l’Assistant</summary><pre style={styles.previewText}>{generatedQuestion}</pre></details> : null}
          </Step>

          {error ? <div style={styles.error}>{error}</div> : null}
          <button type="button" style={{ ...styles.primaryButton, width: '100%', justifyContent: 'center' }} onClick={() => void prepareAnalysis()} disabled={loading || interpreting}>{interpreting ? 'Planification de la source…' : 'Vérifier le calcul configuré'}</button>
        </aside>

        <section style={styles.results}>
          {result ? <ProfessionalResults result={result} visualization={visualization} dimensions={dimensions} measures={measures} title={result.visualization?.title || resultTitle} dateStart={dateStart} dateEnd={dateEnd} generatedQuestion={generatedQuestion} onFollowUp={(instruction) => void runAnalysis(instruction)} /> : <div style={styles.emptyState}><div style={styles.emptyIcon}>BI</div><h2 style={{ marginBottom: 4 }}>Ton rapport professionnel apparaîtra ici</h2><p style={{ maxWidth: 580 }}>Pose une question ou configure l’analyse, puis vérifie la source réelle avant de lancer le calcul.</p><div style={styles.emptyFeatures}><span>✓ Sujet conservé</span><span>✓ Source planifiée</span><span>✓ Flux Articles normalisé</span><span>✓ Traçabilité SQL</span></div></div>}
        </section>
      </section>
    </main>
  )
}
