'use client'

/**
 * FOCUS MENSUEL — DOCUMENT D'IMPRESSION (A4 paysage)
 * ---------------------------------------------------------------------------
 * Route dédiée, volontairement hors de la coque applicative : `layout.tsx`
 * court-circuite déjà le bandeau et les alertes pour tout chemin commençant par
 * `/focus_mensuel_print/`. Rien à modifier ailleurs.
 *
 * Principe repris de l'écran V3 : AUCUN calcul n'est réécrit ici. Les tableaux
 * comparatifs, les agrégations et les formats de montant proviennent des
 * exports de app/focus_mensuel/page.tsx, les widgets de la vue d'ensemble de
 * app/focus_mensuel2/page.tsx. Les chiffres du PDF sont donc identiques à
 * l'écran par construction, et non par recopie.
 *
 * SEULE DUPLICATION ASSUMÉE : la séquence de chargement (5 RPC + mapping des
 * colonnes du contrôle agence). C'est du transport de données, pas du calcul.
 * Si elle évolue dans focus_mensuel2, la répercuter ici.
 *
 * Le document est en thème clair : imprimer le marine pleine page consomme
 * énormément d'encre et empâte les petits chiffres.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react'
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import { supabase } from '@/lib/supabaseClient'

import {
  DOC_TYPES,
  DOC_COLORS,
  type DailyRow,
  type HighlightRow,
  type ComparisonRow,
  type DocType,
  type AnnualCacheRpcRow,
  type AgencyControlRpcRow,
  type AgencyPortfolioRow,
  type AgencyProjectionRow,
  formatMoney,
  aggregateComparisonRows,
  buildComparisonRowsFromAnnualCache,
  HighlightTable,
  ActivityByAgencyComparisonTable,
  ActivityByFamilyComparisonTable,
  Rolling12ComparisonTable,
} from '../../focus_mensuel/page'

import {
  CumulativeBlCdcChart,
  PortfolioTableCompact,
  ProjectionTableCompact,
  KpiTrendChart,
  appliquerCaProjeteAuRolling,
} from '../../focus_mensuel2/page'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' })
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' })

const SECTIONS = [
  { key: 'vue', label: "Vue d'ensemble" },
  { key: 'agence', label: 'Comparatif agence' },
  { key: 'famille', label: 'Comparatif famille' },
  { key: 'rolling', label: 'Rolling 12 mois' },
  { key: 'faits', label: 'Faits marquants' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

// ---------------------------------------------------------------------------
// Dates (identiques à l'écran V3)
// ---------------------------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
function monthBounds(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number)
  return {
    debut: ymd(new Date(Date.UTC(y, m - 1, 1))),
    fin: ymd(new Date(Date.UTC(y, m, 0))),
  }
}
function shiftMonth(monthStr: string, delta: number) {
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}
function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
function last12Months(monthStr: string): string[] {
  return Array.from({ length: 12 }, (_, i) => shiftMonth(monthStr, i - 11))
}

type Params = {
  jour: string
  mois: string
  agence: string
  famille: string
  collaborateur: string
  horsStats: boolean
  caProjete: boolean
  sections: SectionKey[]
}

/**
 * Les paramètres sont lus depuis window.location plutôt qu'avec
 * useSearchParams : cela évite d'imposer une frontière Suspense au build tout
 * en restant strictement équivalent sur une page client.
 */
function lireParams(): Params {
  const defauts: Params = {
    jour: ymd(new Date()),
    mois: currentMonthStr(),
    agence: '',
    famille: '',
    collaborateur: '',
    horsStats: true,
    caProjete: true,
    sections: SECTIONS.map((s) => s.key),
  }

  if (typeof window === 'undefined') return defauts

  const q = new URLSearchParams(window.location.search)
  const jour = q.get('jour') || defauts.jour
  const sectionsBrutes = (q.get('sections') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as SectionKey[]

  const sectionsValides = sectionsBrutes.filter((s) => SECTIONS.some((def) => def.key === s))

  return {
    jour,
    // Le mois suit le jour focus si aucun mois n'est transmis, comme à l'écran.
    mois: q.get('mois') || jour.slice(0, 7),
    agence: q.get('agence') || '',
    famille: q.get('famille') || '',
    collaborateur: q.get('collaborateur') || '',
    horsStats: (q.get('horsStats') ?? '1') !== '0',
    // Reflète la case « Utiliser le CA projeté » de l'écran : le document doit
    // dire la même chose que ce que l'utilisateur avait sous les yeux.
    caProjete: (q.get('caProjete') ?? '1') !== '0',
    sections: sectionsValides.length ? sectionsValides : defauts.sections,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FocusMensuelPrintPage() {
  const [params, setParams] = useState<Params | null>(null)
  const [sectionsActives, setSectionsActives] = useState<SectionKey[]>([])
  // Échelle d'impression. Une section « une page » n'a aucune raison de tenir
  // pile dans 192 mm de haut : plutôt que de deviner, on réduit l'ensemble
  // proportionnellement et on laisse le réglage accessible.
  const [echelle, setEchelle] = useState(0.75)
  // Sombre par défaut : ce document est lu à l'écran neuf fois sur dix, et la
  // charte du front y gagne en lisibilité. Le thème clair reste disponible pour
  // une impression papier réelle.
  const [theme, setTheme] = useState<'ecran' | 'papier'>('ecran')

  const [monthRows, setMonthRows] = useState<DailyRow[]>([])
  const [monthRowsN1, setMonthRowsN1] = useState<DailyRow[]>([])
  const [annualCacheRows, setAnnualCacheRows] = useState<AnnualCacheRpcRow[]>([])
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const [agencyPortfolioRows, setAgencyPortfolioRows] = useState<AgencyPortfolioRow[]>([])
  const [agencyProjectionRows, setAgencyProjectionRows] = useState<AgencyProjectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const p = lireParams()
    setParams(p)
    setSectionsActives(p.sections)
  }, [])

  useEffect(() => {
    if (!params) return
    let cancelled = false

    async function load() {
      if (!params) return
      setLoading(true)
      setError(null)
      try {
        const { debut, fin } = monthBounds(params.mois)
        const monthN1 = shiftMonth(params.mois, -12)
        const { debut: debutN1, fin: finN1 } = monthBounds(monthN1)

        const commonParams = {
          p_agence: params.agence || null,
          p_famille_macro: params.famille || null,
          p_collaborateur: params.collaborateur || null,
          p_include_hors_statistiques: params.horsStats,
        }

        const [monthRes, monthN1Res, annualRes, highlightsRes, agencyRes] = await Promise.all([
          supabase.rpc('get_focus_mensuel_daily_summary_metier', { p_date_debut: debut, p_date_fin: fin, ...commonParams }),
          supabase.rpc('get_focus_mensuel_daily_summary_metier', { p_date_debut: debutN1, p_date_fin: finN1, ...commonParams }),
          supabase.rpc('get_focus_mensuel_annual_tables_cached', { p_focus_date: params.jour, p_month: params.mois, ...commonParams }),
          supabase.rpc('get_focus_mensuel_highlights', { p_date_debut: debut, p_date_fin: fin, p_limit: 500, ...commonParams }),
          supabase.rpc('get_focus_mensuel_agency_control_cached', { p_focus_date: params.jour, p_month: params.mois, ...commonParams }),
        ])

        for (const r of [monthRes, monthN1Res, annualRes, highlightsRes, agencyRes]) {
          if (r.error) throw r.error
        }

        if (cancelled) return

        setMonthRows((monthRes.data as DailyRow[]) || [])
        setMonthRowsN1((monthN1Res.data as DailyRow[]) || [])
        setAnnualCacheRows((annualRes.data as AnnualCacheRpcRow[]) || [])
        setHighlights((highlightsRes.data as HighlightRow[]) || [])

        const agencyRpcRows = (agencyRes.data as AgencyControlRpcRow[]) || []
        setAgencyPortfolioRows(
          agencyRpcRows.map((row) => ({
            label: String(row.label || 'Sans agence'),
            cdc: Number(row.cdc || 0),
            cdcLivMx: Number(row.cdc_liv_mx || 0),
            pl: Number(row.pl || 0),
            plLivMPlus: Number(row.pl_liv_mplus || 0),
            blMx: Number(row.blbr_mx || 0),
            brMx: 0,
            blM: Number(row.blbr_m || 0),
            brM: 0,
            total: Number(row.total || 0),
          })),
        )
        setAgencyProjectionRows(
          agencyRpcRows.map((row) => ({
            label: String(row.label || 'Sans agence'),
            blBrMx: Number(row.blbr_mx || 0),
            blBrM: Number(row.blbr_m || 0),
            factures: Number(row.factures || 0),
            projectionFluxBl: Number(row.projection_flux_bl || 0),
            valeurBlNf3Pct: Number(row.valeur_bl_nf_4pct || 0),
            projectionCa: Number(row.projection_ca || 0),
            caN1: Number(row.ca_n1 || 0),
            evolPct: row.evol_pct === null || row.evol_pct === undefined ? null : Number(row.evol_pct),
          })),
        )
      } catch (e) {
        console.error('[focus_mensuel_print] erreur de chargement :', e)
        const message =
          e instanceof Error
            ? e.message
            : e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : JSON.stringify(e)
        if (!cancelled) setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [params])

  // ---- Dérivations : uniquement via les fonctions partagées ---------------

  const focusDayOfMonth = params ? Number(params.jour.slice(8, 10)) : 0

  const monthRowsN1Mtd = useMemo(
    () => monthRowsN1.filter((r) => Number(r.jour.slice(8, 10)) <= focusDayOfMonth),
    [monthRowsN1, focusDayOfMonth],
  )

  const agencyComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, 'agency_ytd'),
    [annualCacheRows],
  )

  const familyComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, 'family_ytd'),
    [annualCacheRows],
  )

  const agencyComparisonRowsMtd: ComparisonRow[] = useMemo(
    () => aggregateComparisonRows(monthRows, monthRowsN1Mtd, (r) => r.agence || '—', (r) => r.agence || '—'),
    [monthRows, monthRowsN1Mtd],
  )

  const familyComparisonRowsMtd: ComparisonRow[] = useMemo(
    () => aggregateComparisonRows(monthRows, monthRowsN1Mtd, (r) => r.famille_macro || '—', (r) => r.famille_macro || '—'),
    [monthRows, monthRowsN1Mtd],
  )

  const rollingComparisonRows: ComparisonRow[] = useMemo(
    () => buildComparisonRowsFromAnnualCache(annualCacheRows, 'rolling_12'),
    [annualCacheRows],
  )

  // Même transformation que l'écran, par la même fonction : aucune variante
  // recodée ici, donc aucun risque d'écart entre l'affichage et le document.
  const rollingComparisonRowsDisplay: ComparisonRow[] = useMemo(() => {
    if (!params?.caProjete) return rollingComparisonRows
    return appliquerCaProjeteAuRolling(rollingComparisonRows, agencyProjectionRows)
  }, [rollingComparisonRows, agencyProjectionRows, params])

  const monthTotals = useMemo(() => {
    const totalRows = aggregateComparisonRows(monthRows, monthRowsN1, () => 'TOTAL', () => 'TOTAL')
    return totalRows[0] ?? null
  }, [monthRows, monthRowsN1])

  const dayValueByType = useMemo(() => {
    const map: Record<DocType, number> = { Devis: 0, CDC: 0, BL: 0, Factures: 0 }
    if (!params) return map
    monthRows
      .filter((r) => r.jour === params.jour)
      .forEach((r) => {
        if (r.type_document in map) map[r.type_document as DocType] += Number(r.montant_ht || 0)
      })
    return map
  }, [monthRows, params])

  const annualSeriesByType = useMemo(() => {
    const monthlyRows = rollingComparisonRows.filter((r) => !r.label.startsWith('TOTAL'))
    const series: Record<DocType, number[]> = { Devis: [], CDC: [], BL: [], Factures: [] }
    DOC_TYPES.forEach((type) => {
      series[type] = monthlyRows.map((r) => r.byType[type]?.amountN || 0)
    })
    return series
  }, [rollingComparisonRows])

  const top20ByType = useMemo(() => {
    const byType: Record<'Devis' | 'CDC' | 'BL', HighlightRow[]> = { Devis: [], CDC: [], BL: [] }
    ;(['Devis', 'CDC', 'BL'] as const).forEach((t) => {
      byType[t] = highlights
        .filter((h) => h.type_document === t)
        .sort((a, b) => (b.montant_ht || 0) - (a.montant_ht || 0))
        .slice(0, 20)
    })
    return byType
  }, [highlights])

  const months12 = useMemo(() => (params ? last12Months(params.mois) : []), [params])

  const monthLabel = useMemo(
    () => (params ? new Date(params.mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''),
    [params],
  )

  const perimetre = useMemo(() => {
    if (!params) return ''
    return [
      params.agence || 'Toutes agences',
      params.famille || 'Toutes familles',
      params.collaborateur || 'Tous collaborateurs',
      params.horsStats ? 'Hors-statistiques inclus' : 'Hors-statistiques exclus',
    ].join(' · ')
  }, [params])

  const dateEdition = useMemo(
    () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    [],
  )

  function basculerSection(key: SectionKey) {
    setSectionsActives((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]))
  }

  const estActive = (key: SectionKey) => sectionsActives.includes(key)

  // Chaque section imprimée s'ouvre sur son propre en-tête. Le compteur ne sert
  // qu'à savoir laquelle est la première : elle seule n'a pas de saut de page.
  //
  // `compacte` force la section à ne pas se scinder et lui applique l'échelle.
  // Les faits marquants en sont exclus : leurs TOP 20 doivent pouvoir couler
  // sur plusieurs pages, en réimprimant leurs en-têtes de colonnes.
  let indexSection = 0
  const classesSection = (compacte = true) => {
    const base = indexSection++ > 0 ? 'section avantSaut' : 'section'
    return compacte ? `${base} sectionCompacte` : base
  }

  if (!params) return null

  return (
    <div
      className={`${display.variable} ${body.variable} ${mono.variable} document ${theme === 'papier' ? 'themePapier' : 'themeEcran'}`}
      style={{ ['--echelle' as string]: String(echelle) } as React.CSSProperties}
    >
      {/* ---- Barre d'outils, absente du document imprimé ------------------ */}
      <div className="barre noPrint">
        <div className="barreTitre">Focus mensuel — document d&rsquo;impression</div>

        <div className="barreSections">
          {SECTIONS.map((s) => (
            <label key={s.key} className="barreCase">
              <input type="checkbox" checked={estActive(s.key)} onChange={() => basculerSection(s.key)} />
              {s.label}
            </label>
          ))}
        </div>

        <label className="barreEchelle">
          Rendu
          <select value={theme} onChange={(e) => setTheme(e.target.value as 'ecran' | 'papier')}>
            <option value="ecran">Écran — charte sombre</option>
            <option value="papier">Papier — fond blanc</option>
          </select>
        </label>

        <label className="barreEchelle">
          Échelle
          <select value={echelle} onChange={(e) => setEchelle(Number(e.target.value))}>
            <option value={0.9}>90 %</option>
            <option value={0.85}>85 %</option>
            <option value={0.8}>80 %</option>
            <option value={0.75}>75 %</option>
            <option value={0.7}>70 %</option>
            <option value={0.65}>65 %</option>
            <option value={0.6}>60 %</option>
          </select>
        </label>

        <button
          type="button"
          className="barreBouton"
          disabled={loading || sectionsActives.length === 0}
          onClick={() => window.print()}
        >
          Imprimer / Enregistrer en PDF
        </button>

        <div className="barreAide">
          Chaque onglet tient sur une page, sauf les faits marquants. Si une section déborde encore,
          descendez d&rsquo;un cran. Dans la boîte d&rsquo;impression : marges <strong>Minimum</strong>,
          en-têtes et pieds de page décochés.
        </div>
      </div>

      {loading && <div className="etat">Chargement des données…</div>}
      {error && <div className="etat erreur">Impossible de charger les données : {error}</div>}

      {!loading && !error && (
        <>
          {/* ================= Vue d'ensemble ================= */}
          {estActive('vue') && (
            <section className={classesSection()}>
              <EnTete
                titre="Vue d'ensemble"
                perimetre={perimetre}
                jour={params.jour}
                moisLabel={monthLabel}
                dateEdition={dateEdition}
              />

              <div className="kpiGrille">
                {monthTotals &&
                  DOC_TYPES.map((type) => (
                    <KpiPrint
                      key={type}
                      type={type}
                      dayValue={dayValueByType[type]}
                      jour={params.jour}
                      monthValue={monthTotals.byType[type].amountN}
                      monthValueN1={monthTotals.byType[type].amountN1}
                      annualSeries={annualSeriesByType[type]}
                      months={months12}
                      theme={theme}
                    />
                  ))}
              </div>

              <div className="trioGrille">
                <div className="bloc">
                  <h3 className="blocTitre">Cumul BL / CDC depuis le 1er du mois</h3>
                  <CumulativeBlCdcChart monthRows={monthRows} monthRowsN1={monthRowsN1} />
                </div>

                <div className="bloc">
                  <PortfolioTableCompact rows={agencyPortfolioRows} />
                </div>

                <div className="bloc">
                  <ProjectionTableCompact rows={agencyProjectionRows} />
                </div>
              </div>
            </section>
          )}

          {/* ================= Comparatif agence ================= */}
          {estActive('agence') && (
            <>
              <section className={classesSection()}>
                <EnTete
                  titre="Comparatif agence — mois en cours (MTD)"
                  perimetre={perimetre}
                  jour={params.jour}
                  moisLabel={monthLabel}
                  dateEdition={dateEdition}
                />
                <div className="panneauTable">
                <ActivityByAgencyComparisonTable
                  title={`Du 1er au ${focusDayOfMonth} ${monthLabel} vs N-1`}
                  subtitle={perimetre}
                  rows={agencyComparisonRowsMtd}
                  emptyMessage="Aucune donnée sur ce périmètre pour la période."
                />
                </div>
              </section>

              <section className={classesSection()}>
                <EnTete
                  titre="Comparatif agence — cumul annuel (YTD)"
                  perimetre={perimetre}
                  jour={params.jour}
                  moisLabel={monthLabel}
                  dateEdition={dateEdition}
                />
                <div className="panneauTable">
                <ActivityByAgencyComparisonTable
                  title="Cumul annuel vs N-1"
                  subtitle={perimetre}
                  rows={agencyComparisonRows}
                  emptyMessage="Aucune donnée sur ce périmètre pour la période."
                />
                </div>
              </section>
            </>
          )}

          {/* ================= Comparatif famille ================= */}
          {estActive('famille') && (
            <>
              <section className={classesSection()}>
                <EnTete
                  titre="Comparatif famille — mois en cours (MTD)"
                  perimetre={perimetre}
                  jour={params.jour}
                  moisLabel={monthLabel}
                  dateEdition={dateEdition}
                />
                <div className="panneauTable">
                <ActivityByFamilyComparisonTable
                  title={`Du 1er au ${focusDayOfMonth} ${monthLabel} vs N-1`}
                  rows={familyComparisonRowsMtd}
                  emptyMessage="Aucune donnée sur ce périmètre pour la période."
                />
                </div>
              </section>

              <section className={classesSection()}>
                <EnTete
                  titre="Comparatif famille — cumul annuel (YTD)"
                  perimetre={perimetre}
                  jour={params.jour}
                  moisLabel={monthLabel}
                  dateEdition={dateEdition}
                />
                <div className="panneauTable">
                <ActivityByFamilyComparisonTable
                  title="Cumul annuel vs N-1"
                  rows={familyComparisonRows}
                  emptyMessage="Aucune donnée sur ce périmètre pour la période."
                />
                </div>
              </section>
            </>
          )}

          {/* ================= Rolling 12 mois ================= */}
          {estActive('rolling') && (
            <section className={classesSection()}>
              <EnTete
                titre="Rolling 12 mois"
                perimetre={perimetre}
                jour={params.jour}
                moisLabel={monthLabel}
                dateEdition={dateEdition}
              />
              <div className="panneauTable">
              <Rolling12ComparisonTable
                title={
                  params.caProjete
                    ? `Glissant vs N-1 — CA projeté appliqué au mois en cours`
                    : 'Glissant vs N-1 — réalisé'
                }
                subtitle={`${months12[0]} → ${months12[months12.length - 1]} · ${perimetre}`}
                rows={rollingComparisonRowsDisplay}
                emptyMessage="Aucune donnée sur les 12 derniers mois pour ce périmètre."
              />
              </div>
            </section>
          )}

          {/* ================= Faits marquants ================= */}
          {estActive('faits') && (
            <>
              {(['Devis', 'CDC', 'BL'] as const).map((type) => (
                <section key={type} className={classesSection(false)}>
                  <EnTete
                    titre={`Faits marquants — TOP 20 ${type}`}
                    perimetre={perimetre}
                    jour={params.jour}
                    moisLabel={monthLabel}
                    dateEdition={dateEdition}
                  />
                  <div className="panneauTable">
                    <HighlightTable title={`TOP 20 ${type}`} rows={top20ByType[type]} />
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}

      <style jsx global>{`
        /* Marges nulles : le fond de page doit aller jusqu'au bord de la
           feuille. Les marges typographiques sont reprises en padding dans les
           sections, ce qui permet un aplat sombre plein format. */
        @page { size: A4 landscape; margin: 0; }

        html, body { margin: 0; }

        /* Le fond de l'élément racine se propage au canevas de la page :
           c'est ce qui donne un PDF entièrement sombre, bord à bord. */
        html {
          background: var(--doc-fond, #0B1220);
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .document {
          --doc-fond: #0B1220;
          --doc-texte: #FFFFFF;
          --doc-attenue: rgba(255,255,255,0.45);
          --doc-discret: rgba(255,255,255,0.30);
          --doc-filet: rgba(255,255,255,0.14);
          --doc-carte: rgba(255,255,255,0.045);
          --doc-carte-filet: rgba(255,255,255,0.11);
          --doc-panneau: #F5F3EC;
          --doc-accent: #A6A181;

          font-family: var(--font-body);
          color: var(--doc-texte);
          background: var(--doc-fond);
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .document.themePapier {
          --doc-fond: #FFFFFF;
          --doc-texte: #141A26;
          --doc-attenue: rgba(20,26,38,0.55);
          --doc-discret: rgba(20,26,38,0.40);
          --doc-filet: rgba(20,26,38,0.16);
          --doc-carte: #FFFFFF;
          --doc-carte-filet: rgba(20,26,38,0.16);
          --doc-panneau: #FFFFFF;
          --doc-accent: #8A855F;
        }

        /* Les composants réutilisés portent cette classe. Sur fond sombre, ils
           deviennent des panneaux crème, exactement comme à l'écran. */
        .focus-pdf-section-card { background: var(--doc-panneau) !important; }

        /* ---- Barre d'outils, absente du document imprimé ---------------- */

        .barre {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 16px;
          margin: 12px 14px 18px;
          padding: 12px 16px;
          border: 1px solid rgba(20,26,38,0.12);
          border-radius: 12px;
          background: #F5F3EC;
          color: #141A26;
        }
        .barreTitre { font-family: var(--font-display); font-size: 15px; font-weight: 700; }
        .barreSections { display: flex; flex-wrap: wrap; gap: 14px; }
        .barreCase { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
        .barreEchelle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
        .barreEchelle:first-of-type { margin-left: auto; }
        .barreEchelle select {
          border: 1px solid rgba(20,26,38,0.2);
          border-radius: 8px;
          padding: 6px 8px;
          font-family: var(--font-body);
          font-size: 13px;
          background: #fff;
          color: #141A26;
        }
        .barreBouton {
          border: none;
          border-radius: 9px;
          background: #A6A181;
          color: #141A26;
          padding: 9px 16px;
          font-family: var(--font-body);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .barreBouton:disabled { opacity: 0.5; cursor: default; }
        .barreAide { flex-basis: 100%; font-size: 11.5px; line-height: 1.5; color: rgba(20,26,38,0.55); }

        .etat { padding: 24px; font-size: 14px; color: var(--doc-attenue); }
        .etat.erreur {
          margin: 0 14px;
          border: 1px solid rgba(193,104,60,0.4);
          background: rgba(193,104,60,0.12);
          color: #e0a685;
          border-radius: 10px;
        }

        /* ---- Sections ---------------------------------------------------- */

        .section {
          padding: 9mm 10mm 7mm;
          box-sizing: border-box;
          background: var(--doc-fond);
        }
        .avantSaut { break-before: page; page-break-before: always; }

        .sectionCompacte {
          zoom: var(--echelle, 0.75);
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .sectionCompacte [class*="overflow-"],
        .sectionCompacte [style*="overflow"] {
          overflow: visible !important;
          max-height: none !important;
        }

        /* ---- En-tête de section ------------------------------------------ */

        .enTete {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--doc-accent);
        }
        .enTeteEyebrow {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--doc-accent);
        }
        .enTeteTitre {
          margin: 5px 0 0;
          font-family: var(--font-display);
          font-size: 27px;
          font-weight: 700;
          letter-spacing: -0.025em;
          line-height: 1.05;
          color: var(--doc-texte);
        }
        .enTeteMeta {
          text-align: right;
          font-family: var(--font-mono);
          font-size: 9px;
          line-height: 1.7;
          letter-spacing: 0.02em;
          color: var(--doc-attenue);
        }

        /* ---- Cartes KPI, calquées sur l'écran ----------------------------- */

        .kpiGrille {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .kpiCarte {
          border: 1px solid var(--doc-carte-filet);
          background: var(--doc-carte);
          border-radius: 12px;
          padding: 14px 16px 12px;
          break-inside: avoid;
        }
        .kpiEnTete { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .kpiBadge {
          display: inline-block;
          border-radius: 6px;
          padding: 3px 9px;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .kpiLigne { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
        .kpiEtiquette {
          font-family: var(--font-mono);
          font-size: 8px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--doc-discret);
          margin-bottom: 4px;
        }
        .kpiValeurJour {
          font-family: var(--font-mono);
          font-size: 26px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: -0.02em;
          color: var(--doc-texte);
          opacity: 0.85;
          white-space: nowrap;
        }
        .kpiValeurMois {
          font-family: var(--font-mono);
          font-size: 30px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: -0.025em;
          color: var(--doc-texte);
          white-space: nowrap;
        }
        .kpiComparaison {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 10px;
          padding-top: 9px;
          border-top: 1px solid var(--doc-filet);
        }
        .kpiPastille {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 999px;
          padding: 3px 9px;
          font-size: 10px;
          font-weight: 700;
        }
        .kpiN1 {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--doc-discret);
        }
        .kpiN1 b { font-weight: 600; color: var(--doc-attenue); letter-spacing: normal; text-transform: none; font-size: 11px; }
        .kpiTendance { margin-top: 10px; }
        .kpiTendanceTitre {
          font-family: var(--font-mono);
          font-size: 8px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--doc-discret);
          margin-bottom: 4px;
        }

        /* ---- Panneaux de données ------------------------------------------ */

        .trioGrille { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .bloc {
          border-radius: 12px;
          padding: 12px 14px;
          background: var(--doc-panneau);
          color: #141A26;
          break-inside: avoid;
        }
        .blocTitre {
          margin: 0 0 10px;
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 600;
          color: #141A26;
        }
        .trioGrille table { font-size: 10px; }

        /* Les tableaux comparatifs, eux aussi en panneau crème. */
        .panneauTable {
          border-radius: 12px;
          background: var(--doc-panneau);
          color: #141A26;
          padding: 4px 6px;
          overflow: hidden;
        }

        .section th, .section td {
          padding: 3px 6px !important;
          line-height: 1.28 !important;
        }

        table { break-inside: auto; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }

        @media print {
          .noPrint { display: none !important; }
          .section { margin: 0; }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sous-composants du document
// ---------------------------------------------------------------------------

function EnTete({
  titre, perimetre, jour, moisLabel, dateEdition,
}: {
  titre: string
  perimetre: string
  jour: string
  moisLabel: string
  dateEdition: string
}) {
  const jourLabel = new Date(jour).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="enTete">
      <div>
        <div className="enTeteEyebrow">CEGECLIM — Pilotage commercial</div>
        <h2 className="enTeteTitre">{titre}</h2>
      </div>
      <div className="enTeteMeta">
        <div>{perimetre}</div>
        <div>
          Jour focus {jourLabel} · Mois {moisLabel} · Édité le {dateEdition}
        </div>
      </div>
    </div>
  )
}

function KpiPrint({
  type, dayValue, jour, monthValue, monthValueN1, annualSeries, months, theme,
}: {
  type: DocType
  dayValue: number
  jour: string
  monthValue: number
  monthValueN1: number
  annualSeries: number[]
  months: string[]
  theme: 'ecran' | 'papier'
}) {
  const color = DOC_COLORS[type]
  const evolutionPct = monthValueN1 > 0 ? ((monthValue - monthValueN1) / monthValueN1) * 100 : null
  const isUp = (evolutionPct ?? 0) >= 0
  const jourLabel = new Date(jour).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  const teinte = isUp ? '#C1683C' : '#4B92AC'

  return (
    <div className="kpiCarte">
      <div className="kpiEnTete">
        <span className="kpiBadge" style={{ background: `${color}22`, color }}>{type}</span>
        <span className="kpiEtiquette" style={{ marginBottom: 0 }}>Mois en cours</span>
      </div>

      {/* Jour et mois sur la même ligne de base, à la même échelle : c'est la
          lecture retenue à l'écran, on ne la change pas sur le document. */}
      <div className="kpiLigne">
        <div>
          <div className="kpiEtiquette">Jour · {jourLabel}</div>
          <div className="kpiValeurJour">{formatMoney(dayValue)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="kpiValeurMois">{formatMoney(monthValue)}</div>
        </div>
      </div>

      <div className="kpiComparaison">
        {evolutionPct !== null && (
          <span
            className="kpiPastille"
            style={{ background: `${teinte}22`, color: teinte }}
          >
            {isUp ? '▲' : '▼'} {Math.abs(evolutionPct).toFixed(1)}%
          </span>
        )}
        <span className="kpiN1">
          N-1 <b>{formatMoney(monthValueN1)}</b>
        </span>
      </div>

      <div className="kpiTendance">
        <div className="kpiTendanceTitre">Tendance · 12 derniers mois</div>
        <KpiTrendChart
          values={annualSeries}
          months={months}
          color={color}
          theme={theme === 'papier' ? 'light' : 'dark'}
        />
      </div>
    </div>
  )
}
