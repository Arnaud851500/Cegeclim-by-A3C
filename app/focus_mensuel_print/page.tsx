import type { CSSProperties } from 'react'
import FocusMensuelReportView from './FocusMensuelReportView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type SearchParamValue = string | string[] | undefined

type PageProps = {
  searchParams?: Promise<Record<string, SearchParamValue>> | Record<string, SearchParamValue>
}

function firstParam(value: SearchParamValue) {
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

export default async function FocusMensuelPrintPage({ searchParams }: PageProps) {
  const resolvedSearchParams =
    searchParams && typeof (searchParams as Promise<Record<string, SearchParamValue>>).then === 'function'
      ? await searchParams
      : searchParams || {}

  const params = resolvedSearchParams as Record<string, SearchParamValue>

  const expectedSecret = process.env.REPORT_PDF_RENDER_SECRET || ''
  const receivedSecret = firstParam(params['render_secret'])

  const isAuthorized =
    expectedSecret.length > 0 &&
    receivedSecret.length > 0 &&
    receivedSecret === expectedSecret

  if (!isAuthorized) {
    return (
      <main style={styles.deniedPage}>
        <div style={styles.deniedCard}>
          <h1 style={styles.deniedTitle}>Accès impression refusé</h1>
          <p style={styles.deniedText}>
            Le lien de génération PDF Focus Mensuel est invalide ou le secret de rendu est absent.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={styles.page}>
      <FocusMensuelReportView />
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    margin: 0,
    padding: 0,
    background: '#eef5fb',
  },

  deniedPage: {
    minHeight: '100vh',
    margin: 0,
    padding: 24,
    background: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },

  deniedCard: {
    maxWidth: 560,
    width: '100%',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    padding: 24,
    boxShadow: '0 20px 45px rgba(15,23,42,0.12)',
  },

  deniedTitle: {
    margin: '0 0 10px',
    fontSize: 24,
    fontWeight: 900,
    color: '#991b1b',
  },

  deniedText: {
    margin: 0,
    fontSize: 15,
    fontWeight: 700,
    color: '#475569',
    lineHeight: 1.5,
  },
}