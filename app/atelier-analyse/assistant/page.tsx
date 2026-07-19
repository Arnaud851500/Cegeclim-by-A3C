'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useAccess } from '@/components/AccessContext'
import { ProfessionalResults } from '@/components/assistant-bi/ProfessionalResults'
import { normalizeAiResult, type AiResult } from '@/lib/ai/assistantBiTypes'
import {
  ANALYSIS_TEMPLATES,
  DIMENSIONS,
  MEASURES,
  SUBJECTS,
  buildGuidedQuestion,
  getSubject,
  type AnalysisTemplate,
  type SemanticDimensionKey,
  type SemanticMeasureKey,
  type SemanticSubjectKey,
  type SemanticVisualizationKey,
} from '@/lib/ai/cegeclimSemanticCatalog'

type SortMode = 'dimensions_asc' | 'measure_desc' | 'measure_asc'

const VISUALIZATIONS: Array<{
  key: SemanticVisualizationKey
  label: string
  description: string
}> = [
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

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function sourceForSubject(subject: SemanticSubjectKey) {
  if (subject === 'factures') return ['factures']
  if (subject === 'devis') return ['devis']
  return ['activite']
}

function documentTypesForSubject(subject: SemanticSubjectKey) {
  if (subject === 'ventes_bl') return ['BL']
  if (subject === 'portefeuille') return ['CDC', 'PL', 'BL', 'BR', 'BL M-x']
  if (subject === 'devis') return ['DEVIS']
  if (subject === 'factures') return ['FACTURE']
  return []
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

function labelFor(key: string, definitions: Array<{ key: string; label: string }>) {
  return definitions.find((item) => item.key === key)?.label || key
}

function professionalDataInstruction(
  visualization: SemanticVisualizationKey,
  dimensions: SemanticDimensionKey[],
  measures: SemanticMeasureKey[],
) {
  if (visualization === 'histogramme_empile') {
    return [
      'Prépare les données pour un véritable histogramme empilé.',
      `La dimension d’axe est ${dimensions[0] || 'la première dimension'}.`,
      `La dimension de couleur est ${dimensions[1] || 'la deuxième dimension'}.`,
      `La mesure principale est ${measures[0] || 'la première mesure'}.`,
      'Retourne une ligne par combinaison des deux dimensions, sans pivot SQL.',
    ].join(' ')
  }
  if (visualization === 'courbe') {
    return `Retourne les lignes dans l’ordre chronologique de ${dimensions[0] || 'la première dimension'}.`
  }
  if (visualization === 'camembert') {
    return `Retourne au maximum 12 catégories triées par ${measures[0] || 'la mesure principale'} décroissante.`
  }
  return 'Retourne un jeu de données plat, agrégé uniquement selon les dimensions demandées.'
}

function resolveCalculationSource(
  subject: SemanticSubjectKey,
  dimensions: SemanticDimensionKey[],
  measures: SemanticMeasureKey[],
) {
  if (measures.includes('nb_clients_crees') || dimensions.includes('annee_creation_client')) {
    return {
      title: 'Référentiel clients',
      detail: 'ref_tiers.date_creation, enrichi par ref_collaborateurs pour l’agence de rattachement.',
    }
  }

  const hasArticle = dimensions.some((key) => key === 'reference_article' || key === 'designation')
  const hasRelation = dimensions.some((key) => [
    'agence_collaborateur',
    'departement_tiers',
    'numero_tiers',
    'intitule_tiers',
    'collaborateur_facture',
  ].includes(key))
  const hasAbc = dimensions.some((key) => key === 'classe_abc_ca' || key === 'classe_abc_lignes')

  if ((hasArticle && hasRelation) || hasAbc) {
    const lineTable = subject === 'factures' || subject === 'clients'
      ? 'facture_lignes'
      : subject === 'devis'
        ? 'devis_lignes'
        : 'activite_lignes'
    return {
      title: 'Lignes détaillées enrichies',
      detail: `${lineTable} + référentiels client, collaborateur, article et famille${hasAbc ? ' + classe ABC actuelle de la projection stock' : ''}.`,
    }
  }

  if (subject === 'factures') return { title: 'Agrégat factures', detail: 'indicateur_factures_mensuel.' }
  if (subject === 'devis') return { title: 'Agrégat devis', detail: 'indicateur_devis_mensuel.' }
  if (subject === 'articles' || hasArticle) return { title: 'Agrégat articles', detail: 'indicateur_flux_articles_mensuel.' }
  return { title: 'Agrégat activité', detail: 'indicateur_activite_mensuel.' }
}

export default function AssistantBiPage() {
  const { rights } = useAccess()
  const now = useMemo(() => new Date(), [])
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AiResult | null>(null)

  const selectedSubject = useMemo(() => getSubject(subject), [subject])
  const generatedQuestion = useMemo(() => buildGuidedQuestion({
    subject,
    measures,
    dimensions,
    visualization,
    dateStart,
    dateEnd,
    freeText,
    promptSuffix: templateSuffix,
  }), [subject, measures, dimensions, visualization, dateStart, dateEnd, freeText, templateSuffix])

  const resultTitle = useMemo(() => {
    const measure = labelFor(measures[0] || '', MEASURES)
    const firstDimension = labelFor(dimensions[0] || '', DIMENSIONS)
    const secondDimension = dimensions[1] ? ` et ${labelFor(dimensions[1], DIMENSIONS)}` : ''
    return `${measure} par ${firstDimension}${secondDimension}`
  }, [measures, dimensions])

  const calculationSource = useMemo(
    () => resolveCalculationSource(subject, dimensions, measures),
    [subject, dimensions, measures],
  )

  const allowedAgencies = rights.allowed_agences || []
  const allowedCollaborators = rights.allowed_collaborateurs || []
  const allowedDepartments = rights.allowed_departements || []
  const isClientCreation = measures.includes('nb_clients_crees') || dimensions.includes('annee_creation_client')
  const usesAbc = dimensions.includes('classe_abc_ca') || dimensions.includes('classe_abc_lignes')

  function resetCalculatedState() {
    setShowConfirmation(false)
    setResult(null)
    setError('')
  }

  function changeSubject(next: SemanticSubjectKey) {
    const definition = getSubject(next)
    setSubject(next)
    setMeasures([...definition.defaultMeasures])
    setDimensions([...definition.defaultDimensions])
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
    if (visualization === 'histogramme_empile' && dimensions.length < 2) {
      return 'Un histogramme empilé nécessite deux dimensions : axe puis couleur/empilement.'
    }
    if (dateStart && dateEnd && dateStart > dateEnd) return 'La date de début doit être antérieure à la date de fin.'
    if (isClientCreation && !measures.includes('nb_clients_crees')) {
      return 'Année de création client doit être associée à la mesure Nouveaux clients.'
    }
    return ''
  }

  function prepareAnalysis() {
    const validationError = validateConfiguration()
    if (validationError) {
      setError(validationError)
      setShowConfirmation(false)
      return
    }
    setError('')
    setShowConfirmation(true)
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
      const scopeLines = [
        allowedAgencies.length ? `Agences autorisées : ${allowedAgencies.join(', ')}.` : '',
        allowedCollaborators.length ? `Collaborateurs autorisés : ${allowedCollaborators.join(', ')}.` : '',
        allowedDepartments.length ? `Départements autorisés : ${allowedDepartments.join(', ')}.` : '',
        `Articles hors statistiques exclus : ${excludeHorsStatistique ? 'OUI' : 'NON'}.`,
        `Prospects inclus : ${includeProspects ? 'OUI' : 'NON'}.`,
        `Tri demandé : ${SORT_OPTIONS.find((item) => item.key === sortMode)?.label || sortMode}.`,
      ].filter(Boolean).join('\n')

      const response = await fetch('/api/atelier-ai-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: [
            generatedQuestion,
            professionalDataInstruction(visualization, dimensions, measures),
            scopeLines,
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
          },
          dataContext: {
            activeTemporalContext: { dateStart, dateEnd },
            semanticSubject: selectedSubject,
            confirmedCalculationPlan: {
              source: calculationSource,
              excludeHorsStatistique,
              includeProspects,
              sortMode,
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

  return (
    <main style={styles.page}>
      <section style={styles.topBar}>
        <div>
          <div style={styles.eyebrow}>CEGECLIM · ASSISTANT DÉCISIONNEL</div>
          <h1 style={styles.title}>Analyse BI professionnelle</h1>
          <p style={styles.subtitle}>Choisis, vérifie le plan de calcul, confirme, puis analyse et exporte.</p>
        </div>
        <div style={styles.topActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => window.location.assign('/atelier-analyse')}>Atelier classique</button>
          <button type="button" style={styles.primaryButton} onClick={prepareAnalysis} disabled={loading}>Vérifier le calcul</button>
        </div>
      </section>

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div>
            <h2 style={styles.sectionTitle}>Analyses prêtes à l’emploi</h2>
            <p style={styles.sectionText}>Les modèles configurent le sujet, les mesures, les dimensions et la restitution.</p>
          </div>
          <span style={styles.proBadge}>MODE GUIDÉ</span>
        </div>
        <div style={styles.templateGrid}>
          {ANALYSIS_TEMPLATES.map((template) => (
            <button type="button" key={template.id} style={styles.templateCard} onClick={() => applyTemplate(template)}>
              <strong>{template.title}</strong>
              <span>{template.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={styles.workspace}>
        <aside style={styles.builder}>
          <Step number="1" title="Sujet métier">
            <div style={styles.choiceGrid}>
              {SUBJECTS.map((item) => (
                <ChoiceButton
                  key={item.key}
                  active={subject === item.key}
                  title={item.label}
                  description={item.description}
                  onClick={() => changeSubject(item.key)}
                />
              ))}
            </div>
            <div style={styles.subjectImpact}>
              <strong>Impact du sujet sélectionné</strong>
              <span>{selectedSubject.sourceHint}</span>
            </div>
          </Step>

          <Step number="2" title="Mesures">
            <div style={styles.orderHint}>La mesure n°1 pilote le graphique, le tableau croisé et le tri par valeur.</div>
            <div style={styles.chipRow}>
              {MEASURES.map((item) => {
                const index = measures.indexOf(item.key as SemanticMeasureKey)
                return (
                  <button
                    type="button"
                    key={item.key}
                    title={item.description}
                    style={{ ...styles.chip, ...(index >= 0 ? styles.chipActive : {}) }}
                    onClick={() => {
                      setMeasures(toggleValue(measures, item.key as SemanticMeasureKey))
                      setShowConfirmation(false)
                    }}
                  >
                    {index >= 0 ? `${index + 1}. ` : ''}{item.label}
                  </button>
                )
              })}
            </div>
          </Step>

          <Step number="3" title="Niveaux de détail">
            <div style={styles.orderHint}>1 = axe/lignes ; 2 = couleur/colonnes ; les suivantes détaillent le tableau.</div>
            <div style={styles.selectedPath}>
              {dimensions.length
                ? dimensions.map((key, index) => <span key={key} style={styles.pathPill}>{index + 1}. {labelFor(key, DIMENSIONS)}</span>)
                : <span>Aucune dimension sélectionnée</span>}
            </div>
            <div style={styles.chipRow}>
              {DIMENSIONS.map((item) => {
                const index = dimensions.indexOf(item.key as SemanticDimensionKey)
                return (
                  <button
                    type="button"
                    key={item.key}
                    title={item.description}
                    style={{ ...styles.chip, ...(index >= 0 ? styles.chipActive : {}) }}
                    onClick={() => {
                      setDimensions(toggleValue(dimensions, item.key as SemanticDimensionKey))
                      setShowConfirmation(false)
                    }}
                  >
                    {index >= 0 ? `${index + 1}. ` : ''}{item.label}
                  </button>
                )
              })}
            </div>
          </Step>

          <Step number="4" title="Période et restitution">
            <div style={styles.dateRow}>
              <label style={styles.fieldLabel}>Du<input type="date" value={dateStart} onChange={(event) => { setDateStart(event.target.value); setShowConfirmation(false) }} style={styles.input} /></label>
              <label style={styles.fieldLabel}>Au<input type="date" value={dateEnd} onChange={(event) => { setDateEnd(event.target.value); setShowConfirmation(false) }} style={styles.input} /></label>
            </div>
            <div style={styles.visualGrid}>
              {VISUALIZATIONS.map((item) => (
                <ChoiceButton
                  key={item.key}
                  active={visualization === item.key}
                  title={item.label}
                  description={item.description}
                  onClick={() => { setVisualization(item.key); setShowConfirmation(false) }}
                  compact
                />
              ))}
            </div>
          </Step>

          <Step number="5" title="Précision libre">
            <textarea
              value={freeText}
              onChange={(event) => { setFreeText(event.target.value); setShowConfirmation(false) }}
              placeholder="Ex. uniquement famille macro R/R, comparer Marmande au réseau…"
              style={styles.textarea}
            />
            <details style={styles.previewBox}>
              <summary>Voir la demande comprise par l’IA</summary>
              <pre style={styles.previewText}>{generatedQuestion}</pre>
            </details>
          </Step>

          {showConfirmation ? (
            <Step number="6" title="Vérification et confirmation">
              <div style={styles.confirmCard}>
                <PlanLine label="Source" value={`${calculationSource.title} — ${calculationSource.detail}`} />
                <PlanLine label="Période" value={`${dateStart} au ${dateEnd}`} />
                <PlanLine label="Mesures" value={measures.map((key) => labelFor(key, MEASURES)).join(', ')} />
                <PlanLine label="Regroupement" value={dimensions.map((key, index) => `${index + 1}. ${labelFor(key, DIMENSIONS)}`).join(' → ')} />
                <PlanLine label="Documents" value={documentTypesForSubject(subject).join(', ') || 'Selon le sujet et les filtres'} />
                <PlanLine label="Périmètre utilisateur" value={`${allowedAgencies.length || 'toutes'} agence(s), ${allowedDepartments.length || 'tous'} département(s) autorisé(s). Ce contrôle reste obligatoire.`} />

                <div style={styles.settingBlock}>
                  <strong>Exclure les articles hors statistiques ?</strong>
                  <ToggleChoice value={excludeHorsStatistique} onChange={setExcludeHorsStatistique} />
                </div>

                {isClientCreation ? (
                  <div style={styles.settingBlock}>
                    <strong>Inclure aussi les prospects créés ?</strong>
                    <ToggleChoice value={includeProspects} onChange={setIncludeProspects} />
                  </div>
                ) : null}

                <label style={styles.selectLabel}>
                  Ordre de tri
                  <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} style={styles.select}>
                    {SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                  <span>{SORT_OPTIONS.find((option) => option.key === sortMode)?.description}</span>
                </label>

                {usesAbc ? (
                  <div style={styles.warningBox}>
                    <strong>Attention ABC :</strong> la classe utilisée est la classe actuelle issue de la projection stock. Elle n’est pas recalculée historiquement à la date de la facture.
                  </div>
                ) : null}

                <div style={styles.confirmActions}>
                  <button type="button" style={styles.cancelButton} onClick={() => setShowConfirmation(false)}>Modifier la sélection</button>
                  <button type="button" style={styles.confirmButton} onClick={() => void runAnalysis()} disabled={loading}>
                    {loading ? 'Calcul en cours…' : 'Je confirme et je lance le calcul'}
                  </button>
                </div>
              </div>
            </Step>
          ) : null}

          {error ? <div style={styles.error}>{error}</div> : null}
          {!showConfirmation ? (
            <button type="button" style={{ ...styles.primaryButton, width: '100%', justifyContent: 'center' }} onClick={prepareAnalysis} disabled={loading}>
              Vérifier le calcul avant lancement
            </button>
          ) : null}
        </aside>

        <section style={styles.results}>
          {result ? (
            <ProfessionalResults
              result={result}
              visualization={visualization}
              dimensions={dimensions}
              measures={measures}
              title={result.visualization?.title || resultTitle}
              dateStart={dateStart}
              dateEnd={dateEnd}
              generatedQuestion={generatedQuestion}
              onFollowUp={(instruction) => void runAnalysis(instruction)}
            />
          ) : (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>BI</div>
              <h2 style={{ marginBottom: 4 }}>Ton rapport professionnel apparaîtra ici</h2>
              <p style={{ maxWidth: 560 }}>Sélectionne une analyse, vérifie la source et les règles proposées, puis confirme le calcul.</p>
              <div style={styles.emptyFeatures}>
                <span>✓ Plan confirmé</span><span>✓ Droits appliqués</span><span>✓ Exclusions explicites</span><span>✓ Traçabilité SQL</span>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section style={styles.step}><div style={styles.stepTitle}><span style={styles.stepNumber}>{number}</span><strong>{title}</strong></div>{children}</section>
}

function ChoiceButton({ active, title, description, onClick, compact = false }: { active: boolean; title: string; description: string; onClick: () => void; compact?: boolean }) {
  return <button type="button" onClick={onClick} style={{ ...styles.choice, ...(compact ? styles.choiceCompact : {}), ...(active ? styles.choiceActive : {}) }}><strong>{title}</strong><span>{description}</span></button>
}

function PlanLine({ label, value }: { label: string; value: string }) {
  return <div style={styles.planLine}><span>{label}</span><strong>{value}</strong></div>
}

function ToggleChoice({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div style={styles.toggleRow}>
      <button type="button" onClick={() => onChange(true)} style={{ ...styles.toggleButton, ...(value ? styles.toggleActive : {}) }}>OUI</button>
      <button type="button" onClick={() => onChange(false)} style={{ ...styles.toggleButton, ...(!value ? styles.toggleActive : {}) }}>NON</button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#F2F6FB', color: '#172033', padding: 20, fontFamily: 'Arial, sans-serif' },
  topBar: { display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'center', background: 'linear-gradient(135deg,#0F2744,#174A7E)', color: 'white', borderRadius: 18, padding: '22px 26px', boxShadow: '0 16px 40px rgba(15,39,68,.18)' },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, fontWeight: 900, opacity: .75 },
  title: { margin: '5px 0 4px', fontSize: 30 },
  subtitle: { margin: 0, opacity: .86, fontSize: 14 },
  topActions: { display: 'flex', gap: 9, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryButton: { border: 0, borderRadius: 10, padding: '11px 16px', background: '#16A34A', color: 'white', fontWeight: 900, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' },
  secondaryButton: { border: '1px solid rgba(255,255,255,.35)', borderRadius: 10, padding: '11px 16px', background: 'rgba(255,255,255,.08)', color: 'white', fontWeight: 800, cursor: 'pointer' },
  templateSection: { marginTop: 16, background: 'white', border: '1px solid #DCE5F0', borderRadius: 15, padding: 16 },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  sectionTitle: { margin: 0, fontSize: 18 },
  sectionText: { margin: '4px 0 0', color: '#64748B', fontSize: 12 },
  proBadge: { background: '#DCFCE7', color: '#15803D', border: '1px solid #BBF7D0', borderRadius: 999, padding: '5px 9px', fontSize: 10, fontWeight: 900, letterSpacing: .6 },
  templateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 9, marginTop: 12 },
  templateCard: { textAlign: 'left', border: '1px solid #DCE5F0', borderRadius: 11, padding: 12, background: '#F8FAFC', cursor: 'pointer', display: 'grid', gap: 4, color: '#172033' },
  workspace: { display: 'grid', gridTemplateColumns: 'minmax(410px,.85fr) minmax(600px,1.65fr)', gap: 16, alignItems: 'start', marginTop: 16 },
  builder: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 15, padding: 16, position: 'sticky', top: 88, maxHeight: 'calc(100vh - 105px)', overflowY: 'auto', boxShadow: '0 8px 24px rgba(15,23,42,.05)' },
  results: { minWidth: 0 },
  step: { paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid #E8EEF5' },
  stepTitle: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 },
  stepNumber: { width: 23, height: 23, borderRadius: '50%', background: '#2563EB', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 },
  choiceGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7 },
  choice: { textAlign: 'left', border: '1px solid #DCE5F0', borderRadius: 9, padding: 9, background: '#FFF', cursor: 'pointer', display: 'grid', gap: 4, color: '#172033', fontSize: 12 },
  choiceCompact: { minHeight: 62 },
  choiceActive: { border: '2px solid #2563EB', background: '#EFF6FF', padding: 8 },
  subjectImpact: { marginTop: 9, padding: 10, borderRadius: 9, background: '#F1F5F9', color: '#475569', display: 'grid', gap: 4, fontSize: 11, lineHeight: 1.4 },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { border: '1px solid #CBD5E1', borderRadius: 999, background: 'white', padding: '6px 10px', cursor: 'pointer', fontSize: 11, color: '#334155' },
  chipActive: { background: '#1D4ED8', borderColor: '#1D4ED8', color: 'white', fontWeight: 800 },
  orderHint: { color: '#64748B', fontSize: 10, marginBottom: 7 },
  selectedPath: { display: 'flex', flexWrap: 'wrap', gap: 5, padding: 8, marginBottom: 8, background: '#F8FAFC', borderRadius: 8, color: '#64748B', fontSize: 10 },
  pathPill: { background: '#DBEAFE', color: '#1D4ED8', borderRadius: 999, padding: '4px 7px', fontWeight: 800 },
  dateRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 9 },
  fieldLabel: { display: 'grid', gap: 4, fontSize: 11, color: '#475569', fontWeight: 800 },
  input: { border: '1px solid #CBD5E1', borderRadius: 8, padding: 8, background: 'white' },
  visualGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7 },
  textarea: { width: '100%', minHeight: 76, resize: 'vertical', border: '1px solid #CBD5E1', borderRadius: 9, padding: 9, boxSizing: 'border-box', fontFamily: 'inherit' },
  previewBox: { marginTop: 8, background: '#F8FAFC', borderRadius: 8, padding: 8, fontSize: 11 },
  previewText: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#475569', lineHeight: 1.45 },
  confirmCard: { border: '1px solid #93C5FD', background: '#EFF6FF', borderRadius: 12, padding: 12, display: 'grid', gap: 10 },
  planLine: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 9, alignItems: 'start', fontSize: 11, color: '#334155' },
  settingBlock: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderTop: '1px solid #BFDBFE', paddingTop: 9, fontSize: 11 },
  toggleRow: { display: 'flex', gap: 5 },
  toggleButton: { border: '1px solid #94A3B8', borderRadius: 7, background: 'white', color: '#475569', fontWeight: 800, padding: '5px 9px', cursor: 'pointer' },
  toggleActive: { background: '#1D4ED8', color: 'white', borderColor: '#1D4ED8' },
  selectLabel: { display: 'grid', gap: 5, color: '#334155', fontSize: 11, fontWeight: 800 },
  select: { border: '1px solid #93C5FD', borderRadius: 8, padding: 8, background: 'white', color: '#172033' },
  warningBox: { border: '1px solid #F59E0B', background: '#FFFBEB', color: '#92400E', borderRadius: 8, padding: 9, fontSize: 10, lineHeight: 1.45 },
  confirmActions: { display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8, marginTop: 2 },
  cancelButton: { border: '1px solid #CBD5E1', borderRadius: 9, background: 'white', color: '#475569', fontWeight: 800, padding: 10, cursor: 'pointer' },
  confirmButton: { border: 0, borderRadius: 9, background: '#16A34A', color: 'white', fontWeight: 900, padding: 10, cursor: 'pointer' },
  error: { marginBottom: 10, borderRadius: 9, padding: 10, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', fontSize: 12, whiteSpace: 'pre-wrap' },
  emptyState: { minHeight: 620, background: 'white', border: '1px dashed #B8C7D9', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748B', textAlign: 'center', padding: 30 },
  emptyIcon: { width: 72, height: 72, borderRadius: 22, background: '#DBEAFE', color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 24 },
  emptyFeatures: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'center' },
}
