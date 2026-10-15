'use client'

// ============================================================================
// app/admin/performance-extraction/page.tsx — Performance des extractions SAGE
// ----------------------------------------------------------------------------
// 15/10/2026. Reprend l'analyse « lenteurs export SAGE » du 07/10/2026 en
// écran permanent :
//   - historique reconstitué depuis le bucket sage-imports/archive (heure de
//     dépôt de chaque CSV, RPC get_sage_export_fichiers) : lancements, mode
//     (Fréquent / Quotidien), durée de chaque export = écart avec le dépôt
//     précédent du même lancement ;
//   - journal d'exécution du script Export_Sage_Supabase.ps1, déposé par le
//     TSE dans sage-imports/journal et intégré à l'ouverture de l'écran
//     (route /api/admin/performance-extraction/journal → sage_export_journal).
//     Quand une ligne du journal correspond à un export (même nom, ± 15 min),
//     sa durée remplace la durée estimée.
// Seuils : < 60 s vert, 60 s à 10 min ambre, ≥ 10 min rouge.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Types ───────────────────────────────────────────────────────────────────

type Fichier = { export: string; depose_le: string; taille: number | null; lot: string | null }

type LigneJournal = {
  id: number
  lancement: string
  mode: string | null
  export: string
  debut: string | null
  fin: string | null
  lignes: number | null
  duree_sql_s: number | null
  duree_totale_s: number | null
  statut: string | null
  message: string | null
  recu_le: string
}

type Mode = 'FREQUENT' | 'QUOTIDIEN'

type Etape = {
  export: string
  depose: Date
  taille: number | null
  duree: number | null // secondes
  source: 'bucket' | 'journal' | null
  journal?: LigneJournal
}

type Lancement = {
  id: string
  debut: Date
  fin: Date
  mode: Mode
  etapes: Etape[]
  duree: number // secondes, du 1er au dernier dépôt (+ 1re étape si connue)
  erreurs: number
}

type EtatJournal = {
  chargement: boolean
  present?: boolean
  depose_le?: string | null
  lues?: number
  integrees?: number
  colonnes?: string[]
  message?: string
  erreur?: string
}

// ── Réglages ────────────────────────────────────────────────────────────────

const DEBUT_HISTORIQUE = '2026-08-19'
const EXPORTS_FREQUENTS = new Set(['Activite_non_facture', 'BDCF', 'Entete_activite_non_fac', 'Stock_depot'])
// Un nouveau lancement commence quand un export réapparaît, après un silence
// de plus de 90 min, ou après 20 min sur un export qui ouvre habituellement
// un lancement (Tiers en quotidien, Activite_non_facture en fréquent) : un
// export lent (Facture_du_jour a déjà pris plus d'une heure) reste rattaché
// à son lancement.
const ECART_NOUVEAU_LANCEMENT_S = 90 * 60
const ECART_DEBUT_PROBABLE_S = 20 * 60
const EXPORTS_DE_DEBUT = new Set(['Tiers', 'Activite_non_facture'])
const TOLERANCE_JOURNAL_S = 15 * 60
const SEUIL_AMBRE_S = 60
const SEUIL_ROUGE_S = 600

const PERIODES = [
  { id: '7', label: '7 jours', jours: 7 },
  { id: '30', label: '30 jours', jours: 30 },
  { id: 'tout', label: 'Depuis le 19/08', jours: null as number | null },
]

// ── Styles (variables du thème clair / sombre) ─────────────────────────────

const ink = 'var(--cg-ink)'
const muted = 'rgba(var(--cg-ink-rgb), 0.62)'
const faint = 'rgba(var(--cg-ink-rgb), 0.42)'
const line = 'rgba(var(--cg-ink-rgb), 0.12)'
const carte: React.CSSProperties = {
  background: 'var(--cg-surface)',
  border: `1px solid ${line}`,
  borderRadius: 14,
  padding: 18,
}
const teinte = (couleur: string, pct: number) => `color-mix(in srgb, ${couleur} ${pct}%, transparent)`
const COULEUR_MODE: Record<Mode, string> = { FREQUENT: 'var(--cg-accent)', QUOTIDIEN: 'var(--cg-sauge)' }

// ── Utilitaires ─────────────────────────────────────────────────────────────

function couleurDuree(s: number | null) {
  if (s == null) return null
  if (s >= SEUIL_ROUGE_S) return 'var(--cg-danger)'
  if (s >= SEUIL_AMBRE_S) return 'var(--cg-warn)'
  return 'var(--cg-ok)'
}

function fmtDuree(s: number | null | undefined) {
  if (s == null || !Number.isFinite(s)) return '—'
  const r = Math.round(s)
  if (r < 60) return `${r} s`
  if (r < 3600) return `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')}`
  return `${Math.floor(r / 3600)} h ${String(Math.floor((r % 3600) / 60)).padStart(2, '0')}`
}

const fmtDateHeure = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' })
const fmtJour = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })
const cleJour = new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Paris' })

function fmtTaille(o: number | null | undefined) {
  if (o == null) return '—'
  if (o >= 1_000_000) return `${(o / 1_000_000).toFixed(1).replace('.', ',')} Mo`
  return `${Math.round(o / 1000)} Ko`
}

function ilYa(d: Date) {
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `il y a ${h} h ${String(min % 60).padStart(2, '0')}`
  return `il y a ${Math.floor(h / 24)} j`
}

function moyenne(v: number[]) {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function mediane(v: number[]) {
  if (!v.length) return null
  const t = [...v].sort((a, b) => a - b)
  const m = Math.floor(t.length / 2)
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2
}

function dureeJournal(l: LigneJournal): number | null {
  if (l.duree_totale_s != null) return Number(l.duree_totale_s)
  if (l.debut && l.fin) return (new Date(l.fin).getTime() - new Date(l.debut).getTime()) / 1000
  if (l.duree_sql_s != null) return Number(l.duree_sql_s)
  return null
}

function estErreur(l: LigneJournal) {
  const s = (l.statut || '').toUpperCase()
  return !!s && !['OK', 'SUCCES', 'SUCCÈS', 'SUCCESS', 'TERMINE', 'TERMINÉ'].includes(s)
}

/** Regroupe les dépôts en lancements et calcule la durée de chaque export. */
function construireLancements(fichiers: Fichier[], journal: LigneJournal[]): Lancement[] {
  const parExport = new Map<string, LigneJournal[]>()
  for (const l of journal) {
    const k = l.export.toLowerCase()
    if (!parExport.has(k)) parExport.set(k, [])
    parExport.get(k)!.push(l)
  }

  const groupes: Fichier[][] = []
  let courant: Fichier[] = []
  let precedent: Date | null = null
  for (const f of fichiers) {
    const t = new Date(f.depose_le)
    const ecart = precedent ? (t.getTime() - precedent.getTime()) / 1000 : Infinity
    const nouveau =
      ecart > ECART_NOUVEAU_LANCEMENT_S ||
      (ecart > ECART_DEBUT_PROBABLE_S && EXPORTS_DE_DEBUT.has(f.export)) ||
      courant.some((c) => c.export === f.export)
    if (nouveau && courant.length) {
      groupes.push(courant)
      courant = []
    }
    courant.push(f)
    precedent = t
  }
  if (courant.length) groupes.push(courant)

  return groupes.map((g) => {
    const etapes: Etape[] = g.map((f, i) => {
      const depose = new Date(f.depose_le)
      const ecart = i === 0 ? null : (depose.getTime() - new Date(g[i - 1].depose_le).getTime()) / 1000
      const candidates = parExport.get(f.export.toLowerCase()) || []
      let meilleure: LigneJournal | undefined
      let meilleurEcart = Infinity
      for (const l of candidates) {
        const ref = l.fin || l.debut
        if (!ref) continue
        const e = Math.abs(new Date(ref).getTime() - depose.getTime()) / 1000
        if (e < meilleurEcart && e <= TOLERANCE_JOURNAL_S) {
          meilleurEcart = e
          meilleure = l
        }
      }
      const dj = meilleure ? dureeJournal(meilleure) : null
      return {
        export: f.export,
        depose,
        taille: f.taille,
        duree: dj ?? ecart,
        source: dj != null ? 'journal' : ecart != null ? 'bucket' : null,
        journal: meilleure,
      }
    })
    const debut = etapes[0].depose
    const fin = etapes[etapes.length - 1].depose
    const premiere = etapes[0].source === 'journal' ? etapes[0].duree ?? 0 : 0
    const mode: Mode = g.every((f) => EXPORTS_FREQUENTS.has(f.export)) ? 'FREQUENT' : 'QUOTIDIEN'
    return {
      id: `${debut.toISOString()}-${g.length}`,
      debut,
      fin,
      mode,
      etapes,
      duree: (fin.getTime() - debut.getTime()) / 1000 + premiere,
      erreurs: etapes.filter((e) => e.journal && estErreur(e.journal)).length,
    }
  })
}

// ── Petits composants ───────────────────────────────────────────────────────

function Kpi({ titre, valeur, detail, couleur }: { titre: string; valeur: string; detail?: string; couleur?: string | null }) {
  return (
    <div style={{ ...carte, padding: 16, minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: muted, fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6, color: couleur || ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valeur}</div>
      {detail ? <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>{detail}</div> : null}
    </div>
  )
}

function PastilleMode({ mode }: { mode: Mode }) {
  const c = COULEUR_MODE[mode]
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: c, background: teinte(c, 14), border: `1px solid ${teinte(c, 35)}` }}>
      {mode === 'FREQUENT' ? 'Fréquent' : 'Quotidien'}
    </span>
  )
}

function CelluleDuree({ etape }: { etape: Etape | undefined }) {
  if (!etape) return <td style={{ padding: '6px 8px', borderBottom: `1px solid ${line}`, color: faint, textAlign: 'center' }}>·</td>
  const c = couleurDuree(etape.duree)
  const titre = [
    `${etape.export} — déposé à ${fmtHeure.format(etape.depose)}`,
    etape.source === 'journal' ? 'Durée lue dans le journal' : etape.source === 'bucket' ? 'Durée estimée (écart avec le dépôt précédent)' : '1er export : durée inconnue sans journal',
    etape.journal?.lignes != null ? `${etape.journal.lignes.toLocaleString('fr-FR')} lignes` : '',
    etape.journal?.duree_sql_s != null ? `SQL ${fmtDuree(Number(etape.journal.duree_sql_s))}` : '',
    etape.journal?.statut ? `Statut ${etape.journal.statut}` : '',
    `Fichier ${fmtTaille(etape.taille)}`,
  ].filter(Boolean).join('\n')
  const erreur = etape.journal && estErreur(etape.journal)
  return (
    <td title={titre} style={{ padding: '6px 8px', borderBottom: `1px solid ${line}`, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: erreur ? 'var(--cg-danger)' : c || faint, background: erreur ? teinte('var(--cg-danger)', 14) : c ? teinte(c, 10) : undefined }}>
      {erreur ? '⚠ ' : ''}
      {etape.duree == null ? '—' : fmtDuree(etape.duree)}
      {etape.source === 'journal' ? <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>J</span> : null}
    </td>
  )
}

function GraphiqueJours({ lancements }: { lancements: Lancement[] }) {
  const jours = useMemo(() => {
    const m = new Map<string, { jour: Date; quotidien: number | null; frequents: number[] }>()
    for (const l of lancements) {
      const k = cleJour.format(l.debut)
      if (!m.has(k)) m.set(k, { jour: l.debut, quotidien: null, frequents: [] })
      const j = m.get(k)!
      if (l.mode === 'QUOTIDIEN') j.quotidien = Math.max(j.quotidien ?? 0, l.duree)
      else j.frequents.push(l.duree)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ k, ...v, frequent: moyenne(v.frequents) }))
  }, [lancements])

  if (!jours.length) return <div style={{ color: muted, fontSize: 13 }}>Aucun lancement sur la période.</div>

  const max = Math.max(60, ...jours.map((j) => Math.max(j.quotidien ?? 0, j.frequent ?? 0)))
  const W = 1000
  const H = 220
  const pad = { g: 52, d: 10, h: 12, b: 28 }
  const largeur = (W - pad.g - pad.d) / jours.length
  const y = (v: number) => pad.h + (H - pad.h - pad.b) * (1 - v / max)
  const graduations = [0, 0.25, 0.5, 0.75, 1].map((r) => r * max)
  const pointsFreq = jours
    .map((j, i) => (j.frequent == null ? null : `${pad.g + largeur * (i + 0.5)},${y(j.frequent)}`))
    .filter(Boolean)
    .join(' ')
  const pas = Math.max(1, Math.ceil(jours.length / 16))

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {graduations.map((g) => (
          <g key={g}>
            <line x1={pad.g} x2={W - pad.d} y1={y(g)} y2={y(g)} style={{ stroke: line }} />
            <text x={pad.g - 6} y={y(g) + 4} textAnchor="end" fontSize={11} style={{ fill: faint }}>{fmtDuree(g)}</text>
          </g>
        ))}
        {jours.map((j, i) => {
          const x = pad.g + largeur * i
          return (
            <g key={j.k}>
              {j.quotidien != null ? (
                <rect x={x + largeur * 0.18} width={largeur * 0.64} y={y(j.quotidien)} height={Math.max(1, y(0) - y(j.quotidien))} rx={2} style={{ fill: COULEUR_MODE.QUOTIDIEN, opacity: 0.85 }}>
                  <title>{`${fmtJour.format(j.jour)} — Quotidien ${fmtDuree(j.quotidien)}${j.frequent != null ? ` · Fréquent moyen ${fmtDuree(j.frequent)} (${j.frequents.length} lancements)` : ''}`}</title>
                </rect>
              ) : null}
              {i % pas === 0 ? (
                <text x={x + largeur / 2} y={H - 8} textAnchor="middle" fontSize={10} style={{ fill: faint }}>{fmtJour.format(j.jour)}</text>
              ) : null}
            </g>
          )
        })}
        {pointsFreq ? <polyline points={pointsFreq} fill="none" style={{ stroke: COULEUR_MODE.FREQUENT, strokeWidth: 2 }} /> : null}
        {jours.map((j, i) =>
          j.frequent == null ? null : (
            <circle key={`p${j.k}`} cx={pad.g + largeur * (i + 0.5)} cy={y(j.frequent)} r={3} style={{ fill: COULEUR_MODE.FREQUENT }}>
              <title>{`${fmtJour.format(j.jour)} — Fréquent moyen ${fmtDuree(j.frequent)} (${j.frequents.length} lancements)`}</title>
            </circle>
          ),
        )}
      </svg>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, color: muted, marginTop: 6, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COULEUR_MODE.QUOTIDIEN, marginRight: 6 }} />Lancement quotidien (durée totale)</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: COULEUR_MODE.FREQUENT, marginRight: 6, verticalAlign: 'middle' }} />Lancements fréquents (durée moyenne du jour)</span>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PerformanceExtractionPage() {
  const [periode, setPeriode] = useState('30')
  const [filtreMode, setFiltreMode] = useState<'TOUS' | Mode>('TOUS')
  const [fichiers, setFichiers] = useState<Fichier[]>([])
  const [journal, setJournal] = useState<LigneJournal[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [etatJournal, setEtatJournal] = useState<EtatJournal>({ chargement: false })
  const [lignesVisibles, setLignesVisibles] = useState(60)
  const [rafraichir, setRafraichir] = useState(0)

  const depuis = useMemo(() => {
    const p = PERIODES.find((x) => x.id === periode)
    if (!p?.jours) return DEBUT_HISTORIQUE
    const d = new Date(Date.now() - p.jours * 86400000)
    const iso = cleJour.format(d)
    return iso < DEBUT_HISTORIQUE ? DEBUT_HISTORIQUE : iso
  }, [periode])

  // Intégration du journal déposé par le TSE (une fois par ouverture / clic)
  const integrerJournal = useCallback(async () => {
    setEtatJournal({ chargement: true })
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const r = await fetch('/api/admin/performance-extraction/journal', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const p = await r.json().catch(() => null)
      setEtatJournal({
        chargement: false,
        present: p?.present,
        depose_le: p?.depose_le,
        lues: p?.lues,
        integrees: p?.integrees,
        colonnes: p?.colonnes,
        message: p?.message,
        erreur: r.ok ? undefined : p?.error || `Erreur HTTP ${r.status}`,
      })
    } catch (e) {
      setEtatJournal({ chargement: false, erreur: e instanceof Error ? e.message : String(e) })
    }
    setRafraichir((n) => n + 1)
  }, [])

  useEffect(() => {
    integrerJournal()
  }, [integrerJournal])

  useEffect(() => {
    let annule = false
    async function charger() {
      setChargement(true)
      setErreur(null)
      try {
        const tous: Fichier[] = []
        for (let debut = 0; ; debut += 1000) {
          const { data, error } = await supabase.rpc('get_sage_export_fichiers', { p_depuis: depuis }).range(debut, debut + 999)
          if (error) throw error
          tous.push(...((data as Fichier[]) || []))
          if (!data || data.length < 1000) break
        }
        const { data: j, error: ej } = await supabase
          .from('sage_export_journal')
          .select('id, lancement, mode, export, debut, fin, lignes, duree_sql_s, duree_totale_s, statut, message, recu_le')
          .gte('debut', `${depuis}T00:00:00`)
          .order('debut', { ascending: false })
          .limit(5000)
        if (annule) return
        setFichiers(tous)
        setJournal(ej ? [] : ((j as LigneJournal[]) || []))
      } catch (e) {
        if (!annule) setErreur(e instanceof Error ? e.message : (e as { message?: string })?.message || String(e))
      } finally {
        if (!annule) setChargement(false)
      }
    }
    charger()
    return () => {
      annule = true
    }
  }, [depuis, rafraichir])

  const lancements = useMemo(() => construireLancements(fichiers, journal), [fichiers, journal])
  const lancementsFiltres = useMemo(
    () => lancements.filter((l) => filtreMode === 'TOUS' || l.mode === filtreMode).slice().reverse(),
    [lancements, filtreMode],
  )

  // Ordre des colonnes : celui du dernier lancement quotidien, puis le reste
  const colonnes = useMemo(() => {
    const ordre: string[] = []
    const dernierQuotidien = [...lancements].reverse().find((l) => l.mode === 'QUOTIDIEN')
    dernierQuotidien?.etapes.forEach((e) => ordre.includes(e.export) || ordre.push(e.export))
    const autres = new Set<string>()
    lancementsFiltres.forEach((l) => l.etapes.forEach((e) => ordre.includes(e.export) || autres.add(e.export)))
    const toutes = [...ordre, ...[...autres].sort()]
    const presentes = new Set(lancementsFiltres.flatMap((l) => l.etapes.map((e) => e.export)))
    return toutes.filter((c) => presentes.has(c))
  }, [lancements, lancementsFiltres])

  // Statistiques par export
  const statsExports = useMemo(() => {
    const m = new Map<string, { durees: number[]; tailles: number[]; derniere: Etape | null; recentes: number[]; anciennes: number[] }>()
    const limite = Date.now() - 7 * 86400000
    for (const l of lancementsFiltres.slice().reverse()) {
      for (const e of l.etapes) {
        if (!m.has(e.export)) m.set(e.export, { durees: [], tailles: [], derniere: null, recentes: [], anciennes: [] })
        const s = m.get(e.export)!
        if (e.duree != null) {
          s.durees.push(e.duree)
          if (e.depose.getTime() >= limite) s.recentes.push(e.duree)
          else s.anciennes.push(e.duree)
        }
        if (e.taille != null) s.tailles.push(e.taille)
        s.derniere = e
      }
    }
    return [...m.entries()]
      .map(([exp, s]) => ({
        export: exp,
        n: s.durees.length,
        moyenne: moyenne(s.durees),
        mediane: mediane(s.durees),
        max: s.durees.length ? Math.max(...s.durees) : null,
        derniere: s.derniere,
        taille: moyenne(s.tailles),
        recente: moyenne(s.recentes),
        ancienne: moyenne(s.anciennes),
        frequent: EXPORTS_FREQUENTS.has(exp),
      }))
      .sort((a, b) => (b.moyenne ?? -1) - (a.moyenne ?? -1))
  }, [lancementsFiltres])

  // Indicateurs
  const kpis = useMemo(() => {
    const dernier = lancements[lancements.length - 1] || null
    const limite = Date.now() - 7 * 86400000
    const recents = lancements.filter((l) => l.debut.getTime() >= limite)
    const quotidiens = recents.filter((l) => l.mode === 'QUOTIDIEN').map((l) => l.duree)
    const frequents = recents.filter((l) => l.mode === 'FREQUENT').map((l) => l.duree)
    const dernierQuotidien = [...lancements].reverse().find((l) => l.mode === 'QUOTIDIEN') || null
    const plusLent = statsExports.filter((s) => s.recente != null).sort((a, b) => (b.recente ?? 0) - (a.recente ?? 0))[0] || null
    const erreurs = journal.filter(estErreur).length
    return { dernier, quotidiens, frequents, dernierQuotidien, plusLent, erreurs }
  }, [lancements, statsExports, journal])

  const boutonFiltre = (actif: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: `1px solid ${actif ? 'var(--cg-accent)' : line}`,
    background: actif ? teinte('var(--cg-accent)', 14) : 'transparent',
    color: actif ? 'var(--cg-accent)' : muted,
  })

  const th: React.CSSProperties = { padding: '8px', fontSize: 11, fontWeight: 700, color: muted, textAlign: 'left', borderBottom: `1px solid ${line}`, whiteSpace: 'nowrap', background: 'var(--cg-surface-2)', position: 'sticky', top: 0 }
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${line}`, fontSize: 13, color: ink, whiteSpace: 'nowrap' }

  return (
    <div style={{ maxWidth: 1720, margin: '0 auto', padding: '24px 20px 60px', color: ink }}>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, color: muted, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Admin · Synchronisation SAGE</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: '4px 0 0' }}>Performance des extractions</h1>
          <div style={{ fontSize: 13, color: muted, marginTop: 4 }}>
            Durée des exports Export_Sage_Supabase.ps1 (TSE) : heure de dépôt de chaque fichier dans le bucket, complétée par le journal d’exécution.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {PERIODES.map((p) => (
            <button key={p.id} type="button" style={boutonFiltre(periode === p.id)} onClick={() => setPeriode(p.id)}>{p.label}</button>
          ))}
          <span style={{ width: 1, height: 22, background: line, margin: '0 4px' }} />
          {(['TOUS', 'FREQUENT', 'QUOTIDIEN'] as const).map((m) => (
            <button key={m} type="button" style={boutonFiltre(filtreMode === m)} onClick={() => setFiltreMode(m)}>
              {m === 'TOUS' ? 'Tous' : m === 'FREQUENT' ? 'Fréquent' : 'Quotidien'}
            </button>
          ))}
        </div>
      </div>

      {erreur ? (
        <div style={{ ...carte, borderColor: 'var(--cg-danger-border)', background: 'var(--cg-danger-bg)', color: 'var(--cg-danger-text)', marginBottom: 16 }}>
          {erreur.includes('get_sage_export_fichiers') || erreur.includes('sage_export_journal')
            ? 'La migration supabase/sql/20261015_performance_extraction_sage.sql n’a pas encore été exécutée.'
            : erreur}
        </div>
      ) : null}

      {/* Indicateurs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi
          titre="Dernier lancement"
          valeur={kpis.dernier ? fmtDuree(kpis.dernier.duree) : '—'}
          couleur={kpis.dernier ? couleurDuree(kpis.dernier.duree / Math.max(1, kpis.dernier.etapes.length)) : null}
          detail={kpis.dernier ? `${kpis.dernier.mode === 'FREQUENT' ? 'Fréquent' : 'Quotidien'} · ${fmtDateHeure.format(kpis.dernier.debut)} · ${ilYa(kpis.dernier.fin)}` : undefined}
        />
        <Kpi
          titre="Dernier quotidien"
          valeur={kpis.dernierQuotidien ? fmtDuree(kpis.dernierQuotidien.duree) : '—'}
          detail={kpis.dernierQuotidien ? `${kpis.dernierQuotidien.etapes.length} exports · ${fmtDateHeure.format(kpis.dernierQuotidien.debut)}` : undefined}
        />
        <Kpi
          titre="Quotidien · moyenne 7 j"
          valeur={fmtDuree(moyenne(kpis.quotidiens))}
          detail={`${kpis.quotidiens.length} lancement(s) · max ${fmtDuree(kpis.quotidiens.length ? Math.max(...kpis.quotidiens) : null)}`}
        />
        <Kpi
          titre="Fréquent · moyenne 7 j"
          valeur={fmtDuree(moyenne(kpis.frequents))}
          detail={`${kpis.frequents.length} lancement(s) · max ${fmtDuree(kpis.frequents.length ? Math.max(...kpis.frequents) : null)}`}
        />
        <Kpi
          titre="Export le plus lent · 7 j"
          valeur={kpis.plusLent ? fmtDuree(kpis.plusLent.recente) : '—'}
          couleur={couleurDuree(kpis.plusLent?.recente ?? null)}
          detail={kpis.plusLent?.export}
        />
        <Kpi
          titre="Erreurs du journal"
          valeur={journal.length ? String(kpis.erreurs) : '—'}
          couleur={journal.length ? (kpis.erreurs ? 'var(--cg-danger)' : 'var(--cg-ok)') : null}
          detail={journal.length ? `${journal.length} ligne(s) de journal sur la période` : 'Journal pas encore reçu'}
        />
      </div>

      {/* Journal d'exécution : état de l'intégration */}
      <div style={{ ...carte, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ fontWeight: 700 }}>Journal d’exécution</span>
        {etatJournal.chargement ? (
          <span style={{ color: muted }}>Lecture de sage-imports/journal…</span>
        ) : etatJournal.erreur ? (
          <span style={{ color: 'var(--cg-danger)' }}>{etatJournal.erreur}</span>
        ) : etatJournal.present ? (
          <span style={{ color: muted }}>
            Déposé {etatJournal.depose_le ? `le ${fmtDateHeure.format(new Date(etatJournal.depose_le))}` : ''} · {etatJournal.lues ?? 0} ligne(s) lue(s), {etatJournal.integrees ?? 0} intégrée(s)
            {etatJournal.colonnes?.length ? <span style={{ color: faint }}> · colonnes : {etatJournal.colonnes.join(', ')}</span> : null}
          </span>
        ) : (
          <span style={{ color: muted }}>{etatJournal.message || 'Pas encore de journal déposé par le TSE : durées estimées depuis le bucket.'}</span>
        )}
        <button type="button" onClick={integrerJournal} disabled={etatJournal.chargement} style={{ ...boutonFiltre(false), marginLeft: 'auto' }}>
          Relire le journal
        </button>
      </div>

      {/* Graphique */}
      <div style={{ ...carte, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Durée des lancements par jour</div>
        {chargement ? <div style={{ color: muted, fontSize: 13 }}>Chargement…</div> : <GraphiqueJours lancements={lancements.filter((l) => filtreMode === 'TOUS' || l.mode === filtreMode)} />}
      </div>

      {/* Chronologie */}
      <div style={{ ...carte, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Chronologie des lancements</div>
          <div style={{ fontSize: 12, color: muted }}>
            Durée de chaque export (s) · {lancementsFiltres.length} lancement(s) · <span style={{ color: 'var(--cg-ok)' }}>● &lt; 1 min</span>{' '}
            <span style={{ color: 'var(--cg-warn)' }}>● 1 à 10 min</span> <span style={{ color: 'var(--cg-danger)' }}>● ≥ 10 min</span> · J = durée lue dans le journal ; sinon écart avec le dépôt précédent (1er export : —)
          </div>
        </div>
        <div style={{ overflow: 'auto', maxHeight: 640 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, left: 0, zIndex: 2 }}>Lancement</th>
                <th style={th}>Mode</th>
                <th style={{ ...th, textAlign: 'right' }}>Durée</th>
                {colonnes.map((c) => (
                  <th key={c} style={{ ...th, textAlign: 'right', color: EXPORTS_FREQUENTS.has(c) ? 'var(--cg-accent)' : muted }} title={c}>
                    {c.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lancementsFiltres.slice(0, lignesVisibles).map((l) => {
                const parExport = new Map(l.etapes.map((e) => [e.export, e]))
                return (
                  <tr key={l.id}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: 'var(--cg-surface)', fontWeight: 600 }}>{fmtDateHeure.format(l.debut)}</td>
                    <td style={td}><PastilleMode mode={l.mode} /></td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtDuree(l.duree)}
                      {l.erreurs ? <span style={{ color: 'var(--cg-danger)', marginLeft: 6 }}>⚠ {l.erreurs}</span> : null}
                    </td>
                    {colonnes.map((c) => <CelluleDuree key={c} etape={parExport.get(c)} />)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!chargement && !lancementsFiltres.length ? <div style={{ padding: 18, color: muted, fontSize: 13 }}>Aucun lancement sur la période.</div> : null}
        </div>
        {lancementsFiltres.length > lignesVisibles ? (
          <div style={{ padding: 12, textAlign: 'center', borderTop: `1px solid ${line}` }}>
            <button type="button" style={boutonFiltre(false)} onClick={() => setLignesVisibles((n) => n + 100)}>
              Afficher 100 lancements de plus ({lancementsFiltres.length - lignesVisibles} restants)
            </button>
          </div>
        ) : null}
      </div>

      {/* Synthèse par export */}
      <div style={{ ...carte, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', fontWeight: 800, fontSize: 15 }}>Synthèse par export</div>
        <div style={{ overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['Export', 'Mode', 'Mesures', 'Moyenne', 'Médiane', 'Max', '7 derniers jours', 'Avant', 'Dernière', 'Taille moy.'].map((h, i) => (
                  <th key={h} style={{ ...th, position: 'static', textAlign: i > 1 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statsExports.map((s) => {
                const tendance = s.recente != null && s.ancienne != null && s.ancienne > 0 ? (s.recente - s.ancienne) / s.ancienne : null
                return (
                  <tr key={s.export}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.export}</td>
                    <td style={td}><PastilleMode mode={s.frequent ? 'FREQUENT' : 'QUOTIDIEN'} /></td>
                    <td style={{ ...td, textAlign: 'right', color: muted }}>{s.n}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: couleurDuree(s.moyenne) || ink }}>{fmtDuree(s.moyenne)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtDuree(s.mediane)}</td>
                    <td style={{ ...td, textAlign: 'right', color: couleurDuree(s.max) || ink }}>{fmtDuree(s.max)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      {fmtDuree(s.recente)}
                      {tendance != null && Math.abs(tendance) >= 0.1 ? (
                        <span style={{ marginLeft: 6, fontSize: 11, color: tendance < 0 ? 'var(--cg-ok)' : 'var(--cg-danger)' }}>
                          {tendance < 0 ? '▼' : '▲'} {Math.round(Math.abs(tendance) * 100)} %
                        </span>
                      ) : null}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: muted }}>{fmtDuree(s.ancienne)}</td>
                    <td style={{ ...td, textAlign: 'right', color: muted }}>{s.derniere ? fmtDateHeure.format(s.derniere.depose) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', color: muted }}>{fmtTaille(s.taille)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Journal détaillé */}
      <div style={{ ...carte, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Journal d’exécution</div>
          <div style={{ fontSize: 12, color: muted }}>{journal.length ? `${journal.length} ligne(s) sur la période` : 'Aucune ligne reçue pour l’instant'}</div>
        </div>
        {journal.length ? (
          <div style={{ overflow: 'auto', maxHeight: 520 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
              <thead>
                <tr>
                  {['Lancement', 'Mode', 'Export', 'Début', 'Fin', 'Lignes', 'Durée SQL', 'Durée totale', 'Statut', 'Message'].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i >= 5 && i <= 7 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {journal.slice(0, 400).map((l) => {
                  const d = dureeJournal(l)
                  const err = estErreur(l)
                  return (
                    <tr key={l.id} style={{ background: err ? teinte('var(--cg-danger)', 8) : undefined }}>
                      <td style={{ ...td, color: muted }}>{l.lancement}</td>
                      <td style={{ ...td, color: muted }}>{l.mode || '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{l.export}</td>
                      <td style={td}>{l.debut ? fmtDateHeure.format(new Date(l.debut)) : '—'}</td>
                      <td style={td}>{l.fin ? fmtHeure.format(new Date(l.fin)) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.lignes != null ? Number(l.lignes).toLocaleString('fr-FR') : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtDuree(l.duree_sql_s != null ? Number(l.duree_sql_s) : null)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: couleurDuree(d) || ink }}>{fmtDuree(d)}</td>
                      <td style={{ ...td, fontWeight: 700, color: err ? 'var(--cg-danger)' : 'var(--cg-ok)' }}>{l.statut || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 240, color: muted }}>{l.message || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '0 18px 18px', fontSize: 13, color: muted }}>
            Le script du TSE dépose le journal dans sage-imports/journal à la fin de chaque lancement (scripts/tse/Envoi_journal_exports.ps1). Il est intégré automatiquement à l’ouverture de cet écran ; les durées SQL, nombres de lignes et statuts apparaîtront alors ici et dans la chronologie.
          </div>
        )}
      </div>
    </div>
  )
}
