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

const FREE_TEXT_EXAMPLES = [
  'Montre-moi l’évolution mensuelle du CA facturé par agence depuis janvier, sous forme de courbe.',
  'Top 20 clients en BL sur les 12 derniers mois, hors Marmande, avec le CA et la marge.',
  'Compare les quantités de la famille macro R/R par référence et par agence cette année.',
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

function sourceForSubject(subject: SemanticSubjectKey) {
  if (subject === 'factures') return ['factures']
  if (subject === 'devis') return ['devis']
  return ['activite']
}

function documentTypesForSubject(subject: SemanticSubjectKey) {
  if (subject === 'ventes_bl') return ['BL']
  if (subject === 'portefeuille') return ['CDC', 'PL', 'BL', 'BR', 'BL M-x']
  return []
}

function documentLabelForSubject(subject: SemanticSubjectKey) {
  if (subject === 'factures') return 'Factures — source dédiée facture_lignes'
  if (subject === 'devis') return 'Devis — source dédiée devis_lignes'
  const types = documentTypesForSubject(subject)
  return types.length ? types.join(', ') : 'Selon le sujet et les filtres'
}

function monthHints(dateStart: string, dateEnd: string) {
  const start = dateStart ? new Date(`${dateStart}T12:00:00`) : null
  const end = dateEnd ? new Date(`${dateEnd}T12:00:00`) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { years: [] as number[], months: [] as number[] }
  }
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
  if (visualization === 'histogramme_empile') {
    return `Prépare un véritable histogramme empilé : axe ${dimensions[0]}, couleur ${dimensions[1]}, valeur ${measures[0]}. Retourne une ligne par combinaison des deux dimensions.`
  }
  if (visualization === 'courbe') return `Trie chronologiquement selon ${dimensions[0]}.`
  if (visualization === 'camembert') return `Retourne au maximum 12 catégories triées par ${measures[0]} décroissante.`
  return 'Retourne un jeu de données plat, agrégé uniquement selon les dimensions demandées.'
}

function resolveCalculationSource(
  subject: SemanticSubjectKey,
  dimensions: SemanticDimensionKey[],
  measures: SemanticMeasureKey[],
) {
  if (measures.includes('nb_clients_crees') || dimensions.includes('annee_creation_client')) {
    return { title: 'Référentiel clients', detail: 'ref_tiers.date_creation enrichi par ref_collaborateurs.' }
  }
  const hasArticle = dimensions.some((key) => key === 'reference_article' || key === 'designation')
  const hasAbc = dimensions.some((key) => key === 'classe_abc_ca' || key === 'classe_abc_lignes')
  if ((hasArticle && ['factures', 'clients', 'devis', 'ventes_bl', 'portefeuille'].includes(subject)) || hasAbc) {
    const lineTable = subject === 'factures' || subject === 'clients'
      ? 'facture_lignes'
      : subject === 'devis'
        ? 'devis_lignes'
        : 'activite_lignes'
    return { title: 'Lignes détaillées enrichies', detail: `${lineTable} + référentiels client, collaborateur, article et famille${hasAbc ? ' + ABC actuelle' : ''}.` }
  }
  if (subject === 'factures') return { title: 'Agrégat factures', detail: 'indicateur_factures_mensuel.' }
  if (subject === 'devis') return { title: 'Agrégat devis', detail: 'indicateur_devis_mensuel.' }
  if (subject === 'articles' || hasArticle) return { title: 'Agrégat articles', detail: 'indicateur_flux_articles_mensuel.' }
  return { title: 'Agrégat activité', detail: 'indicateur_activite_mensuel.' }
}

function emptyInterpretation(): AssistantBiFreeTextInterpretation {
  return {
    summary: 'Aucune précision libre.',
    filters: emptyAssistantBiStructuredFilters(),
    plan: emptyAssistantBiAnalysisPlan(),
    assumptions: [],
    needsConfirmation: false,
    clarificationQuestion: '',
  }
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
  const [freeText, setFreeText] = useState('')
  const [templateSuffix, setTemplateSuffix] = useState('')
  const [excludeHorsStatistique, setExcludeHorsStatistique] = useState(true)
  const [includeProspects, setIncludeProspects] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('dimensions_asc')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [interpretation, setInterpretation] = useState<AssistantBiFreeTextInterpretation | null>(null)
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
  const calculationSource = useMemo(() => resolveCalculationSource(subject, dimensions, measures), [subject, dimensions, measures])
  const allowedAgencies = rights.allowed_agences || []
  const allowedCollaborators = rights.allowed_collaborateurs || []
  const allowedDepartments = rights.allowed_departements || []
  const isClientCreation = measures.includes('nb_clients_crees') || dimensions.includes('annee_creation_client')
  const usesAbc = dimensions.includes('classe_abc_ca') || dimensions.includes('classe_abc_lignes')

  useEffect(() => {
    if (!showConfirmation) return
    const timer = window.setTimeout(() => {
      interpretationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [showConfirmation])

  function resetCalculatedState() {
    setShowConfirmation(false)
    setInterpretation(null)
    setResult(null)
    setError('')
  }

  function changeSubject(next: SemanticSubjectKey) {
    const definition = getSubject(next)
    setSubject(next)
    setMeasures([...definition.defaultMeasures])
    setDimensions([...definition.defaultDimensions])
    setVisualization(recommendedVisualization(definition.defaultDimensions, definition.defaultMeasures))
    setTemplateSuffix('')
    resetCalculatedState()
  }

  function applyTemplate(template: AnalysisTemplate) {
    setSubject(template.subject)
    setMeasures([...template.measures])
    setDimensions([...template.dimensions])
    setVisualization(template.visualization)
    setTemplateSuffix(template.promptSuffix || '')
    setFreeText('')
    resetCalculatedState()
  }

  function validateConfiguration() {
    if (!measures.length) return 'Sélectionne au moins une mesure.'
    if (!dimensions.length) return 'Sélectionne au moins un niveau de détail.'
    if (visualization === 'histogramme_empile' && dimensions.length < 2) return 'Un histogramme empilé nécessite deux dimensions : axe puis couleur.'
    if (dateStart && dateEnd && dateStart > dateEnd) return 'La date de début doit être antérieure à la date de fin.'
    if (isClientCreation && !measures.includes('nb_clients_crees')) return 'Année de création client doit être associée à la mesure Nouveaux clients.'
    return ''
  }

  function applyInterpretedPlan(interpreted: AssistantBiFreeTextInterpretation) {
    const sanitized = sanitizeSubjectConfiguration({
      subject,
      measures: interpreted.plan.measures.length ? interpreted.plan.measures : measures,
      dimensions: interpreted.plan.dimensions.length ? interpreted.plan.dimensions : dimensions,
    })
    const nextVisualization = interpreted.plan.visualization ||
      recommendedVisualization(sanitized.dimensions, sanitized.measures)

    setMeasures(sanitized.measures)
    setDimensions(sanitized.dimensions)
    setVisualization(nextVisualization)
    if (interpreted.plan.dateStart) setDateStart(interpreted.plan.dateStart)
    if (interpreted.plan.dateEnd) setDateEnd(interpreted.plan.dateEnd)
    if (interpreted.filters.sortMode) setSortMode(interpreted.filters.sortMode)
  }

  async function prepareAnalysis() {
    setError('')
    setInterpreting(true)
    try {
      let interpreted = emptyInterpretation()
      if (freeText.trim()) {
        const response = await fetch('/api/atelier-ai-db/interpret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
              source: calculationSource,
            },
          }),
        })
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>
        if (!response.ok || payload.error) throw new Error(String(payload.error || `Erreur HTTP ${response.status}`))
        interpreted = normalizeAssistantBiFreeTextInterpretation(payload.interpretation)
        interpreted = {
          ...interpreted,
          plan: {
            ...interpreted.plan,
            subject,
            environment: environmentForSubject(subject),
          },
        }
        applyInterpretedPlan(interpreted)
      }

      setInterpretation(interpreted)
      setShowConfirmation(true)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setShowConfirmation(false)
    } finally {
      setInterpreting(false)
    }
  }

  async function runAnalysis(extraInstruction = '') {
    const validationError = validateConfiguration()
    if (validationError) {
      setError(validationError)
      return
    }
    setLoading(true)
    setError('')
    try {
      const temporal = monthHints(dateStart, dateEnd)
      const confirmed = interpretation || emptyInterpretation()
      const response = await fetch('/api/atelier-ai-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: [
            generatedQuestion,
            professionalDataInstruction(visualization, dimensions, measures),
            `Demande libre interprétée : ${confirmed.summary}`,
            extraInstruction,
          ].filter(Boolean).join('\n'),
          currentViewName: 'Assistant BI CEGECLIM professionnel',
          globalFilters: {
            sources: sourceForSubject(subject),
            years: temporal.years,
            months: temporal.months,
            agences: allowedAgencies,
            collaborateursFacture: allowedCollaborators,
            collaborateursTiers: allowedCollaborators,
            departementsTiers: allowedDepartments,
            typesDocument: documentTypesForSubject(subject),
            horsStatistique: excludeHorsStatistique ? 'non' : 'tous',
            inclureProspects: includeProspects ? 'oui' : 'non',
            sortMode,
            interpretedFreeText: confirmed.filters,
          },
          dataContext: {
            activeTemporalContext: { dateStart, dateEnd },
            semanticEnvironment: selectedEnvironment,
            semanticSubject: selectedSubject,
            confirmedCalculationPlan: {
              source: calculationSource,
              excludeHorsStatistique,
              includeProspects,
              sortMode,
              freeTextInterpretation: confirmed,
            },
            visualizationRequest: {
              kind: visualization,
              xKey: dimensions[0] || null,
              stackBy: visualization === 'histogramme_empile' ? dimensions[1] || null : null,
              valueKey: measures[0] || null,
              dimensions,
              measures,
            },
          },
        }),
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
  }

  const confirmationPanel = showConfirmation ? (
    <section ref={interpretationRef} style={{ ...styles.templateSection, scrollMarginTop: 210 }}>
      <div style={styles.sectionHeading}>
        <div>
          <h2 style={styles.sectionTitle}>Interprétation à valider</h2>
          <p style={styles.sectionText}>Le sujet reste celui que tu as sélectionné. L’Assistant adapte seulement les mesures, les niveaux de détail, la période, les filtres et la restitution.</p>
        </div>
        <span style={styles.proBadge}>À CONFIRMER</span>
      </div>
      <div style={styles.confirmCard}>
        <PlanLine label="Analyse comprise" value={interpretation?.summary || 'Configuration guidée manuelle'} />
        <PlanLine label="Domaine" value={selectedEnvironment.label} />
        <PlanLine label="Sujet conservé" value={selectedSubject.label} />
        <PlanLine label="Source" value={`${calculationSource.title} — ${calculationSource.detail}`} />
        <PlanLine label="Période" value={`${dateStart} au ${dateEnd}`} />
        <PlanLine label="Mesures" value={measures.map((key) => labelFor(key, MEASURES)).join(', ')} />
        <PlanLine label="Regroupement" value={dimensions.map((key, index) => `${index + 1}. ${labelFor(key, DIMENSIONS)}`).join(' → ')} />
        <PlanLine label="Restitution" value={VISUALIZATIONS.find((item) => item.key === visualization)?.label || visualization} />
        <PlanLine label="Documents" value={documentLabelForSubject(subject)} />
        <PlanLine label="Périmètre" value={`${allowedAgencies.length || 'toutes'} agence(s), ${allowedDepartments.length || 'tous'} département(s) autorisé(s).`} />
        <div style={styles.interpretationBox}>
          <strong>Filtres compris</strong>
          <b>{describeAssistantBiStructuredFilters(interpretation?.filters || emptyAssistantBiStructuredFilters())}</b>
          {interpretation?.assumptions.length ? <ul style={styles.assumptionList}>{interpretation.assumptions.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </div>
        {interpretation?.needsConfirmation || interpretation?.clarificationQuestion ? <div style={styles.clarificationBox}><strong>Point à confirmer :</strong> {interpretation.clarificationQuestion || 'Vérifie que l’interprétation correspond à ton besoin.'}</div> : null}
        <div style={styles.settingBlock}><strong>Exclure les articles hors statistiques ?</strong><ToggleChoice value={excludeHorsStatistique} onChange={setExcludeHorsStatistique} /></div>
        {isClientCreation ? <div style={styles.settingBlock}><strong>Inclure aussi les prospects créés ?</strong><ToggleChoice value={includeProspects} onChange={setIncludeProspects} /></div> : null}
        <label style={styles.selectLabel}>Ordre de tri<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} style={styles.select}>{SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><span>{SORT_OPTIONS.find((option) => option.key === sortMode)?.description}</span></label>
        {usesAbc ? <div style={styles.warningBox}><strong>Attention ABC :</strong> la classe utilisée est la classe actuelle issue de la projection stock. Elle n’est pas recalculée historiquement.</div> : null}
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
          <p style={styles.subtitle}>Pose une question libre ou construis précisément ton analyse. Le sujet sélectionné reste la référence du calcul.</p>
        </div>
        <div style={styles.topActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => window.location.assign('/atelier-analyse')}>Atelier classique</button>
          <button type="button" style={styles.primaryButton} onClick={() => void prepareAnalysis()} disabled={loading || interpreting}>
            {interpreting ? 'Compréhension en cours…' : 'Comprendre et vérifier'}
          </button>
        </div>
      </section>

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div>
            <h2 style={styles.sectionTitle}>Demande libre</h2>
            <p style={styles.sectionText}>Décris le résultat attendu. L’Assistant conserve le sujet choisi à gauche et adapte les mesures, axes, dates, filtres et graphique.</p>
          </div>
          <span style={styles.proBadge}>MODÈLE SÉMANTIQUE V2</span>
        </div>
        <textarea
          value={freeText}
          onChange={(event) => { setFreeText(event.target.value); invalidateInterpretation() }}
          placeholder="Ex. Liste les articles de la famille macro R/R avec les quantités facturées en 2025 et 2026."
          style={{ ...styles.textarea, minHeight: 110, fontSize: 15 }}
        />
        <div style={{ ...styles.chipRow, marginTop: 10 }}>
          {FREE_TEXT_EXAMPLES.map((example) => (
            <button type="button" key={example} style={styles.chip} onClick={() => { setFreeText(example); invalidateInterpretation() }}>
              {example}
            </button>
          ))}
        </div>
        <div style={styles.confirmActions}>
          <button type="button" style={styles.confirmButton} onClick={() => void prepareAnalysis()} disabled={loading || interpreting || !freeText.trim()}>
            {interpreting ? 'Interprétation…' : 'Interpréter cette demande'}
          </button>
        </div>
      </section>

      {confirmationPanel}

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div><h2 style={styles.sectionTitle}>Analyses prêtes à l’emploi</h2><p style={styles.sectionText}>Les modèles configurent le sujet, les mesures, les dimensions et la restitution.</p></div>
          <span style={styles.proBadge}>MODE GUIDÉ</span>
        </div>
        <div style={styles.templateGrid}>
          {ANALYSIS_TEMPLATES.map((template) => <button type="button" key={template.id} style={styles.templateCard} onClick={() => applyTemplate(template)}><strong>{template.title}</strong><span>{template.description}</span></button>)}
        </div>
      </section>

      <section style={styles.workspace}>
        <aside style={styles.builder}>
          <div style={styles.subjectImpact}>
            <strong>Domaine métier : {selectedEnvironment.label}</strong>
            <span>Le domaine organise le catalogue en interne. Tu sélectionnes seulement le sujet de données à analyser.</span>
          </div>

          <Step number="1" title="Sujet métier">
            <div style={styles.choiceGrid}>
              {SUBJECTS.map((item) => <ChoiceButton key={item.key} active={subject === item.key} title={item.label} description={item.description} onClick={() => changeSubject(item.key)} />)}
            </div>
            <div style={styles.subjectImpact}><strong>Impact du sujet sélectionné</strong><span>{selectedSubject.sourceHint}</span></div>
          </Step>

          <Step number="2" title="Mesures">
            <div style={styles.orderHint}>La mesure n°1 pilote le graphique, le tableau croisé et le tri par valeur.</div>
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
          <button type="button" style={{ ...styles.primaryButton, width: '100%', justifyContent: 'center' }} onClick={() => void prepareAnalysis()} disabled={loading || interpreting}>
            {interpreting ? 'Interprétation de la demande…' : 'Vérifier le calcul configuré'}
          </button>
        </aside>

        <section style={styles.results}>
          {result ? <ProfessionalResults result={result} visualization={visualization} dimensions={dimensions} measures={measures} title={result.visualization?.title || resultTitle} dateStart={dateStart} dateEnd={dateEnd} generatedQuestion={generatedQuestion} onFollowUp={(instruction) => void runAnalysis(instruction)} /> : <div style={styles.emptyState}><div style={styles.emptyIcon}>BI</div><h2 style={{ marginBottom: 4 }}>Ton rapport professionnel apparaîtra ici</h2><p style={{ maxWidth: 580 }}>Pose une question libre ou configure l’analyse, vérifie ce que l’Assistant a compris, puis confirme le calcul.</p><div style={styles.emptyFeatures}><span>✓ Langage naturel</span><span>✓ Sujet conservé</span><span>✓ Plan sémantique contrôlé</span><span>✓ Droits appliqués</span><span>✓ Traçabilité SQL</span></div></div>}
        </section>
      </section>
    </main>
  )
}
