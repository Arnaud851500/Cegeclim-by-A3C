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
  const xKey = dimensions[0]
  const stackKey = dimensions[1]
  const valueKey = measures[0]

  if (visualization === 'histogramme_empile') {
    return [
      'Prépare les données pour un véritable histogramme empilé côté interface.',
      `Retourne exactement une ligne agrégée par ${xKey || 'première dimension'} et ${stackKey || 'seconde dimension'}.`,
      `La mesure principale est ${valueKey || 'la première mesure'}.`,
      'Ne pivote pas les séries en colonnes SQL : conserve une colonne pour la dimension empilée et une colonne pour la valeur.',
      'Évite toute autre dimension non demandée qui créerait des doublons visuels.',
    ].join(' ')
  }

  if (visualization === 'courbe') {
    return `Retourne les lignes dans l’ordre chronologique de ${xKey || 'la première dimension'} et conserve les mesures demandées comme colonnes numériques.`
  }

  if (visualization === 'camembert') {
    return `Retourne au maximum 12 catégories pour ${xKey || 'la première dimension'}, triées par ${valueKey || 'la mesure principale'} décroissante, avec une ligne Autres si nécessaire.`
  }

  return 'Retourne un jeu de données plat, agrégé uniquement selon les dimensions demandées, exploitable pour le tableau détaillé et le tableau croisé.'
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

  function changeSubject(next: SemanticSubjectKey) {
    const definition = getSubject(next)
    setSubject(next)
    setMeasures([...definition.defaultMeasures])
    setDimensions([...definition.defaultDimensions])
    setTemplateSuffix('')
    setResult(null)
    setError('')
  }

  function applyTemplate(template: AnalysisTemplate) {
    setSubject(template.subject)
    setMeasures([...template.measures])
    setDimensions([...template.dimensions])
    setVisualization(template.visualization)
    setTemplateSuffix(template.promptSuffix || '')
    setFreeText('')
    setResult(null)
    setError('')
  }

  async function runAnalysis(extraInstruction = '') {
    if (!measures.length) {
      setError('Sélectionne au moins une mesure.')
      return
    }
    if (!dimensions.length) {
      setError('Sélectionne au moins un niveau de détail.')
      return
    }
    if (visualization === 'histogramme_empile' && dimensions.length < 2) {
      setError('Un histogramme empilé nécessite deux dimensions : la première pour l’axe et la seconde pour les couleurs empilées.')
      return
    }
    if (dateStart && dateEnd && dateStart > dateEnd) {
      setError('La date de début doit être antérieure à la date de fin.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const temporal = monthHints(dateStart, dateEnd)
      const allowedAgencies = rights.allowed_agences || []
      const allowedCollaborators = rights.allowed_collaborateurs || []
      const allowedDepartments = rights.allowed_departements || []
      const scopeLines = [
        allowedAgencies.length ? `Agences autorisées : ${allowedAgencies.join(', ')}.` : '',
        allowedCollaborators.length ? `Collaborateurs autorisés : ${allowedCollaborators.join(', ')}.` : '',
        allowedDepartments.length ? `Départements autorisés : ${allowedDepartments.join(', ')}.` : '',
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
            horsStatistique: 'non',
          },
          dataContext: {
            activeTemporalContext: { dateStart, dateEnd },
            semanticSubject: selectedSubject,
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
          <p style={styles.subtitle}>Construis une analyse, visualise le mix, croise les données et exporte un rapport prêt à partager.</p>
        </div>
        <div style={styles.topActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => window.location.assign('/atelier-analyse')}>Atelier classique</button>
          <button type="button" style={styles.primaryButton} onClick={() => void runAnalysis()} disabled={loading}>{loading ? 'Analyse en cours…' : 'Lancer l’analyse'}</button>
        </div>
      </section>

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div><h2 style={styles.sectionTitle}>Analyses prêtes à l’emploi</h2><p style={styles.sectionText}>Sélectionne un modèle, puis adapte les dimensions ou les mesures.</p></div>
          <span style={styles.proBadge}>VERSION PRO</span>
        </div>
        <div style={styles.templateGrid}>
          {ANALYSIS_TEMPLATES.map((template) => (
            <button type="button" key={template.id} style={styles.templateCard} onClick={() => applyTemplate(template)}>
              <strong>{template.title}</strong><span>{template.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={styles.workspace}>
        <aside style={styles.builder}>
          <Step number="1" title="Sujet métier">
            <div style={styles.choiceGrid}>
              {SUBJECTS.map((item) => <ChoiceButton key={item.key} active={subject === item.key} title={item.label} description={item.description} onClick={() => changeSubject(item.key)} />)}
            </div>
          </Step>

          <Step number="2" title="Mesures">
            <div style={styles.orderHint}>La première mesure pilote le graphique et le tableau croisé.</div>
            <div style={styles.chipRow}>
              {MEASURES.map((item) => {
                const index = measures.indexOf(item.key as SemanticMeasureKey)
                return <button type="button" key={item.key} style={{ ...styles.chip, ...(index >= 0 ? styles.chipActive : {}) }} onClick={() => setMeasures(toggleValue(measures, item.key as SemanticMeasureKey))}>{index >= 0 ? `${index + 1}. ` : ''}{item.label}</button>
              })}
            </div>
          </Step>

          <Step number="3" title="Niveaux de détail">
            <div style={styles.orderHint}>Ordre important : 1 = axe du graphique, 2 = couleur/empilement et colonnes du tableau croisé.</div>
            <div style={styles.selectedPath}>
              {dimensions.length ? dimensions.map((key, index) => <span key={key} style={styles.pathPill}>{index + 1}. {labelFor(key, DIMENSIONS)}</span>) : <span>Aucune dimension sélectionnée</span>}
            </div>
            <div style={styles.chipRow}>
              {DIMENSIONS.map((item) => {
                const index = dimensions.indexOf(item.key as SemanticDimensionKey)
                return <button type="button" key={item.key} style={{ ...styles.chip, ...(index >= 0 ? styles.chipActive : {}) }} onClick={() => setDimensions(toggleValue(dimensions, item.key as SemanticDimensionKey))}>{index >= 0 ? `${index + 1}. ` : ''}{item.label}</button>
              })}
            </div>
          </Step>

          <Step number="4" title="Période et restitution">
            <div style={styles.dateRow}>
              <label style={styles.fieldLabel}>Du<input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} style={styles.input} /></label>
              <label style={styles.fieldLabel}>Au<input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} style={styles.input} /></label>
            </div>
            <div style={styles.visualGrid}>
              {VISUALIZATIONS.map((item) => <ChoiceButton key={item.key} active={visualization === item.key} title={item.label} description={item.description} onClick={() => setVisualization(item.key)} compact />)}
            </div>
            {visualization === 'histogramme_empile' ? (
              <div style={styles.infoBox}><b>Empilement professionnel :</b> chaque valeur de la dimension n°2 aura une couleur stable, une légende cliquable et sera empilée sur la dimension n°1.</div>
            ) : null}
          </Step>

          <Step number="5" title="Précision libre">
            <textarea value={freeText} onChange={(event) => setFreeText(event.target.value)} placeholder="Ex. comparer Marmande au réseau, regrouper les petites familles dans Autres, isoler R/R…" style={styles.textarea} />
            <details style={styles.previewBox}><summary>Voir la demande transmise à l’IA</summary><pre style={styles.previewText}>{generatedQuestion}</pre></details>
          </Step>

          {error ? <div style={styles.error}>{error}</div> : null}
          <button type="button" style={{ ...styles.primaryButton, width: '100%', justifyContent: 'center' }} onClick={() => void runAnalysis()} disabled={loading}>{loading ? 'Interrogation et préparation du rapport…' : 'Générer le rapport professionnel'}</button>
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
              <p style={{ maxWidth: 520 }}>KPI, synthèse IA, vrai graphique empilé, légende interactive, tableau croisé, données triables et exports CEGECLIM.</p>
              <div style={styles.emptyFeatures}><span>✓ Couleurs stables</span><span>✓ Totaux automatiques</span><span>✓ Tableau croisé</span><span>✓ Excel / Word / PDF</span></div>
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

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#F2F6FB', color: '#172033', padding: '20px', fontFamily: 'Arial, sans-serif' },
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
  workspace: { display: 'grid', gridTemplateColumns: 'minmax(390px,.82fr) minmax(600px,1.65fr)', gap: 16, alignItems: 'start', marginTop: 16 },
  builder: { background: 'white', border: '1px solid #DCE5F0', borderRadius: 15, padding: 16, position: 'sticky', top: 88, maxHeight: 'calc(100vh - 105px)', overflowY: 'auto', boxShadow: '0 8px 24px rgba(15,23,42,.05)' },
  results: { minWidth: 0 },
  step: { paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid #E8EEF5' },
  stepTitle: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 },
  stepNumber: { width: 23, height: 23, borderRadius: '50%', background: '#2563EB', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 },
  choiceGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7 },
  choice: { textAlign: 'left', border: '1px solid #DCE5F0', borderRadius: 9, padding: 9, background: '#FFF', cursor: 'pointer', display: 'grid', gap: 4, color: '#172033', fontSize: 12 },
  choiceCompact: { minHeight: 62 },
  choiceActive: { border: '2px solid #2563EB', background: '#EFF6FF', padding: 8 },
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
  infoBox: { marginTop: 9, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#166534', borderRadius: 8, padding: 9, fontSize: 10, lineHeight: 1.4 },
  textarea: { width: '100%', minHeight: 76, resize: 'vertical', border: '1px solid #CBD5E1', borderRadius: 9, padding: 9, boxSizing: 'border-box', fontFamily: 'inherit' },
  previewBox: { marginTop: 8, background: '#F8FAFC', borderRadius: 8, padding: 8, fontSize: 11 },
  previewText: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#475569', lineHeight: 1.45 },
  error: { marginBottom: 10, borderRadius: 9, padding: 10, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', fontSize: 12, whiteSpace: 'pre-wrap' },
  emptyState: { minHeight: 620, background: 'white', border: '1px dashed #B8C7D9', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748B', textAlign: 'center', padding: 30 },
  emptyIcon: { width: 72, height: 72, borderRadius: 22, background: '#DBEAFE', color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 24 },
  emptyFeatures: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'center' },
}
