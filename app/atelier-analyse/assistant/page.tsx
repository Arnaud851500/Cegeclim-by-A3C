'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
// @ts-ignore - xlsx-js-style est déjà utilisé dans le projet pour les exports stylés.
import * as XLSX from 'xlsx-js-style'
import { useAccess } from '@/components/AccessContext'
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

const CEGECLIM_LOGO_URL =
  'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#ef4444', '#0891b2']
const VISUALIZATIONS: Array<{ key: SemanticVisualizationKey; label: string; description: string }> = [
  { key: 'tableau', label: 'Tableau', description: 'Détail, tris et export complet' },
  { key: 'courbe', label: 'Courbe', description: 'Évolution dans le temps' },
  { key: 'histogramme', label: 'Histogramme', description: 'Comparaison de catégories' },
  { key: 'histogramme_empile', label: 'Histogramme empilé', description: 'Mix et contribution' },
  { key: 'camembert', label: 'Camembert', description: 'Répartition simple' },
]

const FOLLOW_UPS = [
  'Comparer le résultat avec N-1 et calculer les évolutions en valeur et en pourcentage.',
  'Ajouter la marge en valeur et la marge pondérée en pourcentage.',
  'Limiter l’analyse aux 20 principaux contributeurs et ajouter une ligne Autres.',
  'Rechercher les écarts atypiques et proposer des pistes d’analyse, sans confondre corrélation et causalité.',
]

type AiColumn = {
  key: string
  label: string
  type: 'number' | 'currency' | 'percent' | 'text'
}

type AiVisualization = {
  kind: 'table' | 'bar' | 'line' | 'pie'
  title: string
  xKey?: string
  yKeys?: string[]
  labelKey?: string
  valueKey?: string
  columns?: string[]
  note?: string
}

type AiResult = {
  answer: string
  sql?: string
  row_count: number
  rows_preview: Record<string, unknown>[]
  columns: AiColumn[]
  visualization: AiVisualization | null
  sql_repaired?: boolean
  error?: string
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatValue(value: unknown, type?: AiColumn['type']) {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'currency') {
    const number = Number(value)
    return Number.isFinite(number)
      ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(number)
      : String(value)
  }
  if (type === 'percent') {
    const number = Number(value)
    return Number.isFinite(number)
      ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(number)} %`
      : String(value)
  }
  if (type === 'number') {
    const number = Number(value)
    return Number.isFinite(number)
      ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(number)
      : String(value)
  }
  return String(value)
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function imageAsDataUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Logo CEGECLIM inaccessible.')
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
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

function monthHints(dateStart: string, dateEnd: string) {
  const start = dateStart ? new Date(`${dateStart}T12:00:00`) : null
  const end = dateEnd ? new Date(`${dateEnd}T12:00:00`) : null
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { years: [], months: [] }

  const years: number[] = []
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) years.push(year)
  const months = start.getFullYear() === end.getFullYear()
    ? Array.from({ length: end.getMonth() - start.getMonth() + 1 }, (_, index) => start.getMonth() + index + 1)
    : []
  return { years, months }
}

export default function AssistantBiPage() {
  const { rights } = useAccess()
  const now = new Date()
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
  const [showSql, setShowSql] = useState(false)

  const selectedSubject = useMemo(() => getSubject(subject), [subject])
  const columnMap = useMemo(
    () => new Map((result?.columns || []).map((column) => [column.key, column])),
    [result]
  )

  const generatedQuestion = useMemo(
    () => buildGuidedQuestion({ subject, measures, dimensions, visualization, dateStart, dateEnd, freeText, promptSuffix: templateSuffix }),
    [subject, measures, dimensions, visualization, dateStart, dateEnd, freeText, templateSuffix]
  )

  function changeSubject(nextSubject: SemanticSubjectKey) {
    const definition = getSubject(nextSubject)
    setSubject(nextSubject)
    setMeasures(definition.defaultMeasures)
    setDimensions(definition.defaultDimensions)
    setTemplateSuffix('')
    setResult(null)
  }

  function applyTemplate(template: AnalysisTemplate) {
    setSubject(template.subject)
    setMeasures(template.measures)
    setDimensions(template.dimensions)
    setVisualization(template.visualization)
    setTemplateSuffix(template.promptSuffix || '')
    setFreeText('')
    setResult(null)
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

    setLoading(true)
    setError('')
    try {
      const temporal = monthHints(dateStart, dateEnd)
      const scopeLines = [
        rights.allowed_agences.length ? `Agences autorisées : ${rights.allowed_agences.join(', ')}.` : '',
        rights.allowed_collaborateurs.length ? `Collaborateurs autorisés : ${rights.allowed_collaborateurs.join(', ')}.` : '',
        rights.allowed_departements.length ? `Départements autorisés : ${rights.allowed_departements.join(', ')}.` : '',
      ].filter(Boolean).join('\n')

      const response = await fetch('/api/atelier-ai-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: [generatedQuestion, scopeLines, extraInstruction].filter(Boolean).join('\n'),
          currentViewName: 'Assistant BI CEGECLIM',
          globalFilters: {
            sources: sourceForSubject(subject),
            years: temporal.years,
            months: temporal.months,
            agences: rights.allowed_agences,
            collaborateursFacture: rights.allowed_collaborateurs,
            collaborateursTiers: rights.allowed_collaborateurs,
            departementsTiers: rights.allowed_departements,
            typesDocument: documentTypesForSubject(subject),
            horsStatistique: 'non',
          },
          dataContext: {
            activeTemporalContext: { dateStart, dateEnd },
            semanticSubject: selectedSubject,
          },
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as AiResult
      if (!response.ok || payload.error) throw new Error(payload.error || `Erreur HTTP ${response.status}`)
      setResult(payload)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    if (!result?.rows_preview?.length) return
    const headers = result.columns.map((column) => column.label)
    const rows = result.rows_preview.map((row) => result.columns.map((column) => row[column.key] ?? ''))
    const sheet = XLSX.utils.aoa_to_sheet([
      ['ASSISTANT BI CEGECLIM'],
      [generatedQuestion],
      [],
      headers,
      ...rows,
    ])
    sheet['!cols'] = result.columns.map((column) => ({ wch: Math.max(14, Math.min(34, column.label.length + 8)) }))
    result.columns.forEach((_column, index) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: 3, c: index })]
      if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1D4ED8' } }, alignment: { horizontal: 'center' } }
    })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Analyse')
    const contextSheet = XLSX.utils.aoa_to_sheet([
      ['Sujet', selectedSubject.label],
      ['Période', `${dateStart} au ${dateEnd}`],
      ['Mesures', measures.join(', ')],
      ['Dimensions', dimensions.join(', ')],
      ['Restitution', visualization],
      ['Synthèse IA', result.answer],
    ])
    XLSX.utils.book_append_sheet(workbook, contextSheet, 'Contexte')
    XLSX.writeFile(workbook, `analyse-cegeclim-${isoDate(new Date())}.xlsx`)
  }

  async function exportPdf() {
    if (!result) return
    const orientation = result.columns.length > 6 ? 'landscape' : 'portrait'
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
    try {
      const logo = await imageAsDataUrl(CEGECLIM_LOGO_URL)
      doc.addImage(logo, 'JPEG', 12, 8, 42, 18)
    } catch {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text('CEGECLIM', 12, 16)
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('Rapport Assistant BI', 60, 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 60, 21)
    doc.text(`Période : ${dateStart} au ${dateEnd}`, 12, 32)
    doc.text(`Sujet : ${selectedSubject.label}`, 12, 37)

    doc.setFontSize(10)
    const answerLines = doc.splitTextToSize(result.answer || '', orientation === 'landscape' ? 260 : 185)
    doc.text(answerLines, 12, 45)
    const tableStart = 48 + answerLines.length * 4

    autoTable(doc, {
      startY: tableStart,
      head: [result.columns.map((column) => column.label)],
      body: result.rows_preview.slice(0, 100).map((row) =>
        result.columns.map((column) => formatValue(row[column.key], column.type))
      ),
      styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [29, 78, 216], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      margin: { left: 10, right: 10 },
      didDrawPage: (data) => {
        const pageCount = doc.getNumberOfPages()
        doc.setFontSize(8)
        doc.text(`CEGECLIM — page ${pageCount}`, data.settings.margin.left, doc.internal.pageSize.height - 6)
      },
    })
    doc.save(`rapport-cegeclim-${isoDate(new Date())}.pdf`)
  }

  async function exportWord() {
    if (!result) return
    let logo = CEGECLIM_LOGO_URL
    try {
      logo = await imageAsDataUrl(CEGECLIM_LOGO_URL)
    } catch {}
    const headers = result.columns.map((column) => `<th>${column.label}</th>`).join('')
    const body = result.rows_preview.slice(0, 200).map((row) =>
      `<tr>${result.columns.map((column) => `<td>${formatValue(row[column.key], column.type)}</td>`).join('')}</tr>`
    ).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;color:#172033} h1{color:#1d4ed8} img{width:180px;height:auto}
      table{border-collapse:collapse;width:100%;font-size:9pt} th{background:#1d4ed8;color:white;padding:6px;border:1px solid #cbd5e1}
      td{padding:5px;border:1px solid #cbd5e1} .meta{color:#475569;font-size:10pt}.answer{background:#eff6ff;padding:12px;border-left:4px solid #2563eb}
    </style></head><body><img src="${logo}" alt="CEGECLIM"><h1>Rapport Assistant BI</h1>
      <p class="meta">Généré le ${new Date().toLocaleString('fr-FR')} — période ${dateStart} au ${dateEnd}</p>
      <h2>${selectedSubject.label}</h2><p class="answer">${result.answer}</p><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`
    downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), `rapport-cegeclim-${isoDate(new Date())}.doc`)
  }

  function renderChart() {
    if (!result?.visualization || !result.rows_preview.length) return null
    const spec = result.visualization
    const rows = result.rows_preview.map((row) => {
      const next: Record<string, unknown> = { ...row }
      result.columns.forEach((column) => {
        if (column.type !== 'text') next[column.key] = Number(row[column.key] ?? 0)
      })
      return next
    })

    if (spec.kind === 'pie' && spec.labelKey && spec.valueKey) {
      return (
        <ResponsiveContainer width="100%" height={360}>
          <PieChart>
            <Pie data={rows} dataKey={spec.valueKey} nameKey={spec.labelKey} outerRadius={125} label>
              {rows.map((_row, index) => <Cell key={index} fill={PALETTE[index % PALETTE.length]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )
    }

    if (spec.kind === 'line' && spec.xKey && spec.yKeys?.length) {
      return (
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={rows} margin={{ top: 20, right: 30, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={spec.xKey} angle={-25} textAnchor="end" height={60} />
            <YAxis />
            <Tooltip formatter={(value) => new Intl.NumberFormat('fr-FR').format(Number(value || 0))} />
            <Legend />
            {spec.yKeys.map((key, index) => <Line key={key} type="monotone" dataKey={key} stroke={PALETTE[index % PALETTE.length]} strokeWidth={2} />)}
          </LineChart>
        </ResponsiveContainer>
      )
    }

    if (spec.kind === 'bar' && spec.xKey && spec.yKeys?.length) {
      return (
        <ResponsiveContainer width="100%" height={380}>
          <BarChart data={rows} margin={{ top: 20, right: 30, left: 10, bottom: 55 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={spec.xKey} angle={-25} textAnchor="end" height={70} />
            <YAxis />
            <Tooltip formatter={(value) => new Intl.NumberFormat('fr-FR').format(Number(value || 0))} />
            <Legend />
            {spec.yKeys.map((key, index) => (
              <Bar key={key} dataKey={key} fill={PALETTE[index % PALETTE.length]} stackId={visualization === 'histogramme_empile' ? 'stack' : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )
    }
    return null
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>CEGECLIM · BUSINESS INTELLIGENCE</div>
          <h1 style={styles.title}>Assistant BI</h1>
          <p style={styles.subtitle}>Construis une analyse fiable en quelques choix, puis approfondis-la avec l’IA.</p>
        </div>
        <div style={styles.heroActions}>
          <button style={styles.secondaryButton} onClick={() => window.location.assign('/atelier-analyse')}>Atelier classique</button>
          <button style={styles.primaryButton} onClick={() => runAnalysis()} disabled={loading}>{loading ? 'Analyse en cours…' : 'Lancer l’analyse'}</button>
        </div>
      </section>

      <section style={styles.templateSection}>
        <div style={styles.sectionHeading}>
          <div><h2 style={styles.sectionTitle}>Analyses préconstruites</h2><p style={styles.sectionText}>Un point de départ modifiable avant exécution.</p></div>
        </div>
        <div style={styles.templateGrid}>
          {ANALYSIS_TEMPLATES.map((template) => (
            <button key={template.id} style={styles.templateCard} onClick={() => applyTemplate(template)}>
              <strong>{template.title}</strong><span>{template.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={styles.workspace}>
        <aside style={styles.builder}>
          <Step number="1" title="Sujet">
            <div style={styles.choiceGrid}>
              {SUBJECTS.map((item) => (
                <ChoiceButton key={item.key} active={subject === item.key} title={item.label} description={item.description} onClick={() => changeSubject(item.key)} />
              ))}
            </div>
          </Step>

          <Step number="2" title="Mesures">
            <div style={styles.chipRow}>
              {MEASURES.map((item) => (
                <button key={item.key} style={{ ...styles.chip, ...(measures.includes(item.key as SemanticMeasureKey) ? styles.chipActive : {}) }} onClick={() => setMeasures(toggleValue(measures, item.key as SemanticMeasureKey))}>{item.label}</button>
              ))}
            </div>
          </Step>

          <Step number="3" title="Niveaux de détail">
            <div style={styles.chipRow}>
              {DIMENSIONS.map((item) => (
                <button key={item.key} style={{ ...styles.chip, ...(dimensions.includes(item.key as SemanticDimensionKey) ? styles.chipActive : {}) }} onClick={() => setDimensions(toggleValue(dimensions, item.key as SemanticDimensionKey))}>{item.label}</button>
              ))}
            </div>
          </Step>

          <Step number="4" title="Période et restitution">
            <div style={styles.dateRow}>
              <label style={styles.fieldLabel}>Du<input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} style={styles.input} /></label>
              <label style={styles.fieldLabel}>Au<input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} style={styles.input} /></label>
            </div>
            <div style={styles.visualGrid}>
              {VISUALIZATIONS.map((item) => (
                <ChoiceButton key={item.key} active={visualization === item.key} title={item.label} description={item.description} onClick={() => setVisualization(item.key)} compact />
              ))}
            </div>
          </Step>

          <Step number="5" title="Précision libre">
            <textarea value={freeText} onChange={(event) => setFreeText(event.target.value)} placeholder="Ex. Limiter à Marmande, comparer à la moyenne réseau, isoler la famille R/R…" style={styles.textarea} />
            <details style={styles.previewBox}><summary>Voir la demande comprise par l’IA</summary><pre style={styles.previewText}>{generatedQuestion}</pre></details>
          </Step>

          {error ? <div style={styles.error}>{error}</div> : null}
          <button style={{ ...styles.primaryButton, width: '100%', justifyContent: 'center' }} onClick={() => runAnalysis()} disabled={loading}>{loading ? 'Interrogation de la base…' : 'Générer le rapport'}</button>
        </aside>

        <section style={styles.results}>
          {!result ? (
            <div style={styles.emptyState}><div style={styles.emptyIcon}>BI</div><h2>Le résultat apparaîtra ici</h2><p>Synthèse, graphique, tableau détaillé et propositions d’approfondissement.</p></div>
          ) : (
            <>
              <div style={styles.resultHeader}>
                <div><div style={styles.eyebrow}>RÉSULTAT · {result.row_count} LIGNE(S)</div><h2 style={styles.resultTitle}>{result.visualization?.title || selectedSubject.label}</h2></div>
                <div style={styles.exportRow}>
                  <button style={styles.exportButton} onClick={exportExcel}>Excel</button>
                  <button style={styles.exportButton} onClick={exportWord}>Word</button>
                  <button style={styles.exportButton} onClick={exportPdf}>PDF CEGECLIM</button>
                </div>
              </div>

              <div style={styles.answerCard}>{result.answer}</div>
              {renderChart() ? <div style={styles.chartCard}>{renderChart()}</div> : null}

              <div style={styles.followUpCard}>
                <strong>Approfondir l’analyse</strong>
                <div style={styles.followUpGrid}>{FOLLOW_UPS.map((item) => <button key={item} style={styles.followUpButton} onClick={() => runAnalysis(item)}>{item}</button>)}</div>
              </div>

              <div style={styles.tableCard}>
                <div style={styles.tableHeader}><strong>Données détaillées</strong><span>Aperçu limité à {result.rows_preview.length} lignes</span></div>
                <div style={styles.tableScroll}>
                  <table style={styles.table}>
                    <thead><tr>{result.columns.map((column) => <th key={column.key} style={styles.th}>{column.label}</th>)}</tr></thead>
                    <tbody>{result.rows_preview.map((row, rowIndex) => <tr key={rowIndex}>{result.columns.map((column) => <td key={column.key} style={{ ...styles.td, textAlign: column.type === 'text' ? 'left' : 'right' }}>{formatValue(row[column.key], column.type)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>

              {result.sql ? <details open={showSql} onToggle={(event) => setShowSql((event.currentTarget as HTMLDetailsElement).open)} style={styles.sqlBox}><summary>Traçabilité SQL {result.sql_repaired ? '· requête corrigée automatiquement' : ''}</summary><pre style={styles.sqlText}>{result.sql}</pre></details> : null}
            </>
          )}
        </section>
      </section>
    </main>
  )
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section style={styles.step}><div style={styles.stepTitle}><span style={styles.stepNumber}>{number}</span><strong>{title}</strong></div>{children}</section>
}

function ChoiceButton({ active, title, description, onClick, compact = false }: { active: boolean; title: string; description: string; onClick: () => void; compact?: boolean }) {
  return <button onClick={onClick} style={{ ...styles.choice, ...(compact ? styles.choiceCompact : {}), ...(active ? styles.choiceActive : {}) }}><strong>{title}</strong><span>{description}</span></button>
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f4f7fb', color: '#172033', padding: '22px', fontFamily: 'Arial, sans-serif' },
  hero: { display: 'flex', justifyContent: 'space-between', gap: '20px', alignItems: 'center', background: 'linear-gradient(135deg,#0f2f64,#1d4ed8)', color: 'white', borderRadius: '20px', padding: '26px 30px', boxShadow: '0 18px 45px rgba(15,47,100,.18)' },
  eyebrow: { fontSize: '11px', letterSpacing: '1.5px', fontWeight: 800, opacity: .78 },
  title: { margin: '5px 0 4px', fontSize: '34px' },
  subtitle: { margin: 0, opacity: .85 },
  heroActions: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryButton: { border: 0, borderRadius: '10px', padding: '11px 16px', background: '#16a34a', color: 'white', fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' },
  secondaryButton: { border: '1px solid rgba(255,255,255,.35)', borderRadius: '10px', padding: '11px 16px', background: 'rgba(255,255,255,.08)', color: 'white', fontWeight: 700, cursor: 'pointer' },
  templateSection: { marginTop: '18px', background: 'white', border: '1px solid #dfe7f1', borderRadius: '16px', padding: '18px' },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { margin: 0, fontSize: '18px' },
  sectionText: { margin: '4px 0 0', color: '#64748b', fontSize: '13px' },
  templateGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '10px', marginTop: '14px' },
  templateCard: { textAlign: 'left', border: '1px solid #dbe5f0', borderRadius: '12px', padding: '13px', background: '#f8fafc', cursor: 'pointer', display: 'grid', gap: '5px', color: '#172033' },
  workspace: { display: 'grid', gridTemplateColumns: 'minmax(390px, .85fr) minmax(560px, 1.5fr)', gap: '18px', alignItems: 'start', marginTop: '18px' },
  builder: { background: 'white', border: '1px solid #dfe7f1', borderRadius: '16px', padding: '18px', position: 'sticky', top: '88px', maxHeight: 'calc(100vh - 105px)', overflowY: 'auto' },
  step: { paddingBottom: '18px', marginBottom: '18px', borderBottom: '1px solid #e8eef5' },
  stepTitle: { display: 'flex', gap: '9px', alignItems: 'center', marginBottom: '11px' },
  stepNumber: { width: '24px', height: '24px', borderRadius: '50%', background: '#1d4ed8', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800 },
  choiceGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '8px' },
  choice: { textAlign: 'left', border: '1px solid #dbe5f0', borderRadius: '10px', padding: '10px', background: '#fff', cursor: 'pointer', display: 'grid', gap: '4px', color: '#172033' },
  choiceCompact: { minHeight: '66px' },
  choiceActive: { border: '2px solid #2563eb', background: '#eff6ff' },
  chipRow: { display: 'flex', gap: '7px', flexWrap: 'wrap' },
  chip: { border: '1px solid #cbd5e1', borderRadius: '999px', background: 'white', padding: '7px 11px', cursor: 'pointer', fontSize: '12px', color: '#334155' },
  chipActive: { background: '#1d4ed8', borderColor: '#1d4ed8', color: 'white', fontWeight: 700 },
  dateRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px', marginBottom: '10px' },
  fieldLabel: { display: 'grid', gap: '5px', fontSize: '12px', color: '#475569', fontWeight: 700 },
  input: { border: '1px solid #cbd5e1', borderRadius: '8px', padding: '9px', background: 'white' },
  visualGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '8px' },
  textarea: { width: '100%', minHeight: '85px', resize: 'vertical', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '10px', boxSizing: 'border-box' },
  previewBox: { marginTop: '9px', background: '#f8fafc', borderRadius: '9px', padding: '9px', fontSize: '12px' },
  previewText: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#475569', lineHeight: 1.5 },
  error: { marginBottom: '12px', borderRadius: '10px', padding: '11px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '13px' },
  results: { minWidth: 0, display: 'grid', gap: '14px' },
  emptyState: { minHeight: '520px', background: 'white', border: '1px dashed #b8c7d9', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', textAlign: 'center', padding: '30px' },
  emptyIcon: { width: '72px', height: '72px', borderRadius: '22px', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '24px' },
  resultHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '15px', background: 'white', border: '1px solid #dfe7f1', borderRadius: '16px', padding: '16px 18px' },
  resultTitle: { margin: '4px 0 0', fontSize: '21px' },
  exportRow: { display: 'flex', gap: '7px', flexWrap: 'wrap' },
  exportButton: { border: '1px solid #bfdbfe', borderRadius: '8px', padding: '8px 11px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 800, cursor: 'pointer' },
  answerCard: { background: '#eff6ff', border: '1px solid #bfdbfe', borderLeft: '5px solid #2563eb', borderRadius: '12px', padding: '16px', lineHeight: 1.55, whiteSpace: 'pre-line' },
  chartCard: { background: 'white', border: '1px solid #dfe7f1', borderRadius: '16px', padding: '16px' },
  followUpCard: { background: 'white', border: '1px solid #dfe7f1', borderRadius: '16px', padding: '15px' },
  followUpGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '8px', marginTop: '10px' },
  followUpButton: { textAlign: 'left', border: '1px solid #dbe5f0', background: '#f8fafc', borderRadius: '9px', padding: '10px', cursor: 'pointer', color: '#334155' },
  tableCard: { background: 'white', border: '1px solid #dfe7f1', borderRadius: '16px', overflow: 'hidden' },
  tableHeader: { display: 'flex', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '13px' },
  tableScroll: { overflow: 'auto', maxHeight: '520px' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px' },
  th: { position: 'sticky', top: 0, zIndex: 1, background: '#1e3a5f', color: 'white', padding: '9px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '8px 9px', borderBottom: '1px solid #edf2f7', whiteSpace: 'nowrap' },
  sqlBox: { background: '#0f172a', color: '#dbeafe', borderRadius: '12px', padding: '12px' },
  sqlText: { overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: 1.5 },
}
