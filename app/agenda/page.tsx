'use client'

// ============================================================================
// app/agenda/page.tsx — Mes rdv (desktop)
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-15 soir) : écran cible du bloc « Mes rdv ». Reprend les
// fonctions de MobileRdv (components/mobile/MobileRdv.tsx) au format PC :
//   - planning hebdomadaire (7 colonnes, 7h → 20h, semaine précédente /
//     suivante / aujourd'hui) ou liste sur une période (raccourcis + dates
//     libres) — même source v_rdv_unifie (RDV BLG du partenaire + RDV
//     compagnon créés par l'utilisateur) ;
//   - panneau latéral de détail : entreprise, dates, lieu, alerte « tâche non
//     terminée pour ce client », compte-rendu (lecture / ajout / modification /
//     suppression dans client_comptes_rendus), dictée vocale
//     (VoiceReportButtons), modification / suppression d'un RDV compagnon,
//     accès à la Vision client 360 ;
//   - création d'un RDV compagnon (rdv_compagnon) ;
//   - recherche de documents (activite_lignes, facture_lignes, devis_lignes).
// Sur mobile (< 768 px) on rend MobileRdv tel quel.
//
// CORRECTIF (2026-09-15) : le lien « Vision client 360 » passait le numéro
// de client dans un paramètre `numero_tiers` alors que app/vision-client
// lit `numero` (cf. VisionClientPageInner : searchParams.get('numero')) —
// l'écran s'ouvrait donc sur « Aucun numéro de client fourni ». Le lien
// utilise maintenant `numero`, ce qui déclenche le chargement automatique
// de la fiche (voir ouvrirVisionClient).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useViewport } from '@/lib/useViewport'
import { formatMoney } from '@/app/focus_mensuel/page'
import MobileRdv from '@/components/mobile/MobileRdv'
import VoiceReportButtons from '@/components/mobile/VoiceReportButtons'

// ── Types & constantes (alignés sur MobileRdv) ─────────────────────────────
type RdvUnifie = {
  rdv_id: string
  source: 'blg' | 'compagnon'
  blg_activity_id: string | null
  compagnon_id: string | null
  type: string
  subject: string
  start_date: string
  end_date: string
  all_day: boolean
  numero_tiers: string | null
  company_name: string | null
  lieu: string | null
  a_compte_rendu: boolean
}

type CompteRendu = { id: string; resume: string | null; created_by_name: string | null; created_by_email: string | null; created_at: string }

type DocResult = { key: string; type: string; numero: string; tiers: string; reference: string; date: string; montant_ht: number }

type RdvType = 'meeting' | 'phoneCall' | 'reminder'

const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: 'RDV', phoneCall: 'Appel', reminder: 'Rappel',
  '4': 'RDV', '7': 'Appel', '9': 'Rappel',
}
const RDV_TYPE_COLORS: Record<string, string> = {
  meeting: '#2E5BB8', phoneCall: '#D68910', reminder: '#8E44AD',
  '4': '#2E5BB8', '7': '#D68910', '9': '#8E44AD',
}

const SEARCH_TABLES = ['activite_lignes', 'facture_lignes', 'devis_lignes']
const SEARCH_FIELDS = ['numero_piece', 'numero_document', 'reference_article', 'reference', 'numero_tiers_entete']

const GRILLE_HEURE_DEBUT = 7
const GRILLE_HEURE_FIN = 20
const GRILLE_HAUTEUR_HEURE = 56
const GRILLE_HAUTEUR_TOTALE = (GRILLE_HEURE_FIN - GRILLE_HEURE_DEBUT) * GRILLE_HAUTEUR_HEURE

/** Lien vers la fiche Vision client 360 : le paramètre attendu par
 * app/vision-client/page.tsx est `numero` (pas `numero_tiers`). */
function visionClientHref(numeroTiers: string) {
  return `/vision-client?numero=${encodeURIComponent(numeroTiers)}`
}

// ── Helpers ────────────────────────────────────────────────────────────────
function safeText(value: any) {
  return String(value ?? '').trim()
}
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}
function normalizeDateIso(value: any) {
  const text = safeText(value)
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  return ''
}
function formatDateFr(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function debutJourLocal(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}
function ajouterJours(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}
function lundiDeLaSemaine(d: Date) {
  const c = debutJourLocal(d)
  const jour = c.getDay() || 7
  c.setDate(c.getDate() - (jour - 1))
  return c
}
function memeJour(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function minutesDepuisDebutGrille(d: Date) {
  const minutes = (d.getHours() - GRILLE_HEURE_DEBUT) * 60 + d.getMinutes()
  return Math.max(0, Math.min(minutes, (GRILLE_HEURE_FIN - GRILLE_HEURE_DEBUT) * 60))
}
function fallbackNameFromEmail(email: string) {
  const local = String(email || '').split('@')[0] || email
  return local.split(/[._-]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || email
}
function auteurCompteRendu(cr: Pick<CompteRendu, 'created_by_name' | 'created_by_email'>) {
  const nom = safeText(cr.created_by_name)
  if (nom) return nom
  const email = safeText(cr.created_by_email)
  if (email) return fallbackNameFromEmail(email)
  return '—'
}

/** Répartition en colonnes des RDV qui se chevauchent (même algorithme que
 * le planning mobile). */
function repartirColonnes(events: RdvUnifie[]) {
  const items = events
    .map((ev) => {
      const debut = new Date(ev.start_date).getTime()
      const finBrute = new Date(ev.end_date || ev.start_date).getTime()
      const fin = finBrute > debut ? finBrute : debut + 30 * 60000
      return { ev, debut, fin }
    })
    .sort((a, b) => a.debut - b.debut || a.fin - b.fin)

  const resultats: { ev: RdvUnifie; colonne: number; nbColonnes: number }[] = []
  let cluster: { ev: RdvUnifie; colonne: number }[] = []
  let colonnesFin: number[] = []
  let clusterFin = -Infinity

  function clore() {
    if (!cluster.length) return
    const nbColonnes = Math.max(...cluster.map((c) => c.colonne)) + 1
    cluster.forEach((c) => resultats.push({ ...c, nbColonnes }))
    cluster = []
  }

  for (const item of items) {
    if (item.debut >= clusterFin) {
      clore()
      colonnesFin = []
      clusterFin = -Infinity
    }
    let colonne = colonnesFin.findIndex((fin) => fin <= item.debut)
    if (colonne === -1) {
      colonne = colonnesFin.length
      colonnesFin.push(item.fin)
    } else {
      colonnesFin[colonne] = item.fin
    }
    cluster.push({ ev: item.ev, colonne })
    clusterFin = Math.max(clusterFin, item.fin)
  }
  clore()
  return resultats
}

async function searchByField(table: string, field: string, term: string) {
  try {
    const { data, error } = await supabase.from(table).select('*').ilike(field, `%${term}%`).limit(30)
    if (error) return []
    return (data || []) as Record<string, any>[]
  } catch {
    return []
  }
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function AgendaPage() {
  const { isMobile } = useViewport()
  if (isMobile) return <MobileRdv />
  return <AgendaDesktop />
}

function AgendaDesktop() {
  const router = useRouter()

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentName, setCurrentName] = useState('')
  const [blgPartnerId, setBlgPartnerId] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  const [vueMode, setVueMode] = useState<'planning' | 'liste'>('planning')

  // Planning : semaine ancrée sur un lundi
  const [lundi, setLundi] = useState<Date>(() => lundiDeLaSemaine(new Date()))

  // Liste : période libre
  const [periodeLabel, setPeriodeLabel] = useState('30 prochains jours')
  const [periode, setPeriode] = useState<{ debut: Date; fin: Date }>(() => {
    const d = debutJourLocal(new Date())
    return { debut: d, fin: ajouterJours(d, 30) }
  })
  const [dateDebutInput, setDateDebutInput] = useState('')
  const [dateFinInput, setDateFinInput] = useState('')

  const [rdvList, setRdvList] = useState<RdvUnifie[]>([])
  const [rdvLoading, setRdvLoading] = useState(true)
  const [rdvError, setRdvError] = useState<string | null>(null)
  const [tachesEnCoursParTiers, setTachesEnCoursParTiers] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)

  const [selectedRdv, setSelectedRdv] = useState<RdvUnifie | null>(null)
  const [formRdv, setFormRdv] = useState<{ mode: 'create' } | { mode: 'edit'; rdv: RdvUnifie } | null>(null)

  // Recherche de documents
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<DocResult[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<DocResult | null>(null)

  // Bornes réellement chargées selon la vue
  const bornes = useMemo(() => {
    if (vueMode === 'planning') return { debut: lundi, fin: ajouterJours(lundi, 7) }
    return periode
  }, [vueMode, lundi, periode])

  // ── Session utilisateur ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function init() {
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData.session?.user?.email?.toLowerCase()
      if (!email || cancelled) return
      const { data: access } = await supabase
        .from('user_page_access')
        .select('blg_partner_id, display_name')
        .eq('email', email)
        .maybeSingle()
      if (cancelled) return
      setCurrentEmail(email)
      setCurrentName(String(access?.display_name || '').trim() || fallbackNameFromEmail(email))
      setBlgPartnerId(access?.blg_partner_id || null)
      setSessionReady(true)
    }
    void init()
    return () => { cancelled = true }
  }, [])

  // ── Chargement des RDV sur les bornes courantes ──────────────────────
  useEffect(() => {
    if (!sessionReady || !currentEmail) return
    let cancelled = false
    async function charger() {
      setRdvLoading(true)
      setRdvError(null)
      try {
        const orParts = [`created_by_email.eq.${currentEmail}`]
        if (blgPartnerId) orParts.push(`blg_partner_id.eq.${blgPartnerId}`)
        const { data, error } = await supabase
          .from('v_rdv_unifie')
          .select('*')
          .gte('start_date', toIsoDate(bornes.debut))
          .lt('start_date', toIsoDate(bornes.fin))
          .or(orParts.join(','))
          .order('start_date', { ascending: true })
          .limit(500)
        if (cancelled) return
        if (error) {
          console.error('[Agenda] v_rdv_unifie', error)
          setRdvError(error.message)
          setRdvList([])
          setTachesEnCoursParTiers(new Set())
          return
        }
        const rows = (data || []) as RdvUnifie[]
        setRdvList(rows)

        const tiers = Array.from(new Set(rows.map((r) => safeText(r.numero_tiers)).filter(Boolean)))
        if (!tiers.length) {
          setTachesEnCoursParTiers(new Set())
          return
        }
        const identities = Array.from(new Set([currentEmail, currentName].filter(Boolean)))
        const assignedFilter = identities.map((v) => `assigned_to.eq.${v.replace(/,/g, '\\,')}`).join(',')
        const { data: taches, error: tachesError } = await supabase
          .from('todo_actions')
          .select('numero_tiers')
          .or(assignedFilter)
          .not('status', 'in', '("Terminé","Annulé")')
          .in('numero_tiers', tiers)
        if (cancelled) return
        if (tachesError) {
          console.warn('[Agenda] todo_actions', tachesError.message)
          setTachesEnCoursParTiers(new Set())
          return
        }
        setTachesEnCoursParTiers(new Set(((taches || []) as any[]).map((r) => safeText(r.numero_tiers)).filter(Boolean)))
      } finally {
        if (!cancelled) setRdvLoading(false)
      }
    }
    void charger()
    return () => { cancelled = true }
  }, [sessionReady, currentEmail, currentName, blgPartnerId, bornes, refreshKey])

  const rafraichir = useCallback(() => setRefreshKey((k) => k + 1), [])

  /** Ouvre la fiche Vision client 360 avec chargement automatique du client. */
  const ouvrirVisionClient = useCallback((numeroTiers: string) => {
    const numero = safeText(numeroTiers)
    if (!numero) return
    router.push(visionClientHref(numero))
  }, [router])

  // Le RDV sélectionné suit les rechargements (ex. après enregistrement d'un CR)
  useEffect(() => {
    if (!selectedRdv) return
    const next = rdvList.find((r) => r.rdv_id === selectedRdv.rdv_id)
    if (next && next !== selectedRdv) setSelectedRdv(next)
  }, [rdvList, selectedRdv])

  // ── Périodes (liste) ─────────────────────────────────────────────────
  function selectionnerPeriode(preset: 'semaine_derniere' | 'semaine_courante' | 'semaine_prochaine' | 'defaut') {
    const aujourdHui = debutJourLocal(new Date())
    const lundiCourant = lundiDeLaSemaine(aujourdHui)
    if (preset === 'defaut') {
      setPeriode({ debut: aujourdHui, fin: ajouterJours(aujourdHui, 30) })
      setPeriodeLabel('30 prochains jours')
    } else if (preset === 'semaine_derniere') {
      setPeriode({ debut: ajouterJours(lundiCourant, -7), fin: lundiCourant })
      setPeriodeLabel('Semaine dernière')
    } else if (preset === 'semaine_courante') {
      setPeriode({ debut: lundiCourant, fin: ajouterJours(lundiCourant, 7) })
      setPeriodeLabel('Cette semaine')
    } else {
      setPeriode({ debut: ajouterJours(lundiCourant, 7), fin: ajouterJours(lundiCourant, 14) })
      setPeriodeLabel('Semaine prochaine')
    }
  }

  function appliquerPeriodePersonnalisee() {
    if (!dateDebutInput || !dateFinInput) return
    const debut = new Date(`${dateDebutInput}T00:00:00`)
    const finSaisie = new Date(`${dateFinInput}T00:00:00`)
    if (Number.isNaN(debut.getTime()) || Number.isNaN(finSaisie.getTime())) return
    setPeriode({ debut, fin: ajouterJours(finSaisie, 1) })
    const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    setPeriodeLabel(`${fmt(debut)} → ${fmt(finSaisie)}`)
  }

  // ── Suppression d'un RDV compagnon ───────────────────────────────────
  async function supprimerRdvCompagnon(r: RdvUnifie) {
    if (r.source !== 'compagnon' || !r.compagnon_id) return
    if (!window.confirm('Supprimer ce rendez-vous ? Cette action est définitive.')) return
    try {
      const { data, error } = await supabase.from('rdv_compagnon').delete().eq('id', r.compagnon_id).select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        window.alert("Suppression refusée par la base (droits insuffisants) — le rendez-vous n'a pas été supprimé.")
        return
      }
      setSelectedRdv(null)
      rafraichir()
    } catch (e) {
      console.error('[Agenda] suppression rdv_compagnon', e)
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  // ── Recherche de documents ───────────────────────────────────────────
  async function runSearch() {
    const q = term.trim()
    if (!q) {
      setResults(null)
      return
    }
    setSearchLoading(true)
    try {
      const calls: Promise<Record<string, any>[]>[] = []
      SEARCH_TABLES.forEach((table) => SEARCH_FIELDS.forEach((field) => calls.push(searchByField(table, field, q))))
      const raw = await Promise.all(calls)
      const merged = new Map<string, DocResult>()
      raw.flat().forEach((row) => {
        const numero = safeText(pick(row, ['numero_piece', 'numero_document', 'num_piece']))
        const type = safeText(row.type_document)
        const tiers = safeText(pick(row, ['numero_tiers_entete']))
        const key = `${type}-${numero}-${tiers}`
        if (merged.has(key)) return
        merged.set(key, {
          key, type, numero, tiers,
          reference: safeText(pick(row, ['reference_article', 'reference'])),
          date: normalizeDateIso(pick(row, ['date_document', 'date_facture', 'date_piece', 'date_bl', 'date_piece_bl', 'date_livraison_bl', 'date_livraison', 'date_devis'])),
          montant_ht: Number(row.montant_ht || 0),
        })
      })
      setResults(Array.from(merged.values()).slice(0, 60))
    } finally {
      setSearchLoading(false)
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────
  const jours = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => ajouterJours(lundi, i)), [lundi])
  const aujourdHui = new Date()
  const heures: number[] = []
  for (let h = GRILLE_HEURE_DEBUT; h <= GRILLE_HEURE_FIN; h++) heures.push(h)

  const labelSemaine = `${jours[0].toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} → ${jours[6].toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`
  const nbRdv = rdvList.length
  const nbSansCr = rdvList.filter((r) => !r.a_compte_rendu && new Date(r.start_date) < aujourdHui).length

  return (
    <div style={styles.page}>
      <style>{`
        .agdBtn:hover { background: rgba(255,255,255,0.10); color: #fff; border-color: rgba(255,255,255,0.3); }
        .agdRdv:hover { filter: brightness(1.12); }
        .agdRow:hover { background: rgba(255,255,255,0.07); }
        .agdBtn:focus-visible, .agdRdv:focus-visible, .agdRow:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
      `}</style>

      {/* En-tête */}
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Mes rdv</div>
          <h1 style={styles.title}>Agenda</h1>
          <div style={styles.lead}>
            {rdvLoading ? 'Chargement…' : `${nbRdv} rendez-vous sur la période${nbSansCr > 0 ? ` · ${nbSansCr} passé${nbSansCr > 1 ? 's' : ''} sans compte-rendu` : ''}`}
          </div>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.segment}>
            <button type="button" className="agdBtn" onClick={() => setVueMode('planning')} style={{ ...styles.segmentBtn, ...(vueMode === 'planning' ? styles.segmentBtnActive : {}) }}>🗓️ Planning</button>
            <button type="button" className="agdBtn" onClick={() => setVueMode('liste')} style={{ ...styles.segmentBtn, ...(vueMode === 'liste' ? styles.segmentBtnActive : {}) }}>📋 Liste</button>
          </div>
          <button type="button" className="agdBtn" onClick={rafraichir} style={styles.ghostBtn}>Actualiser</button>
          <button type="button" onClick={() => setFormRdv({ mode: 'create' })} style={styles.primaryBtn}>+ Nouveau RDV</button>
        </div>
      </div>

      {rdvError && <div style={styles.errorBox}>Impossible de charger les rendez-vous : {rdvError}</div>}

      <div style={styles.layout}>
        {/* Colonne principale */}
        <div style={styles.main}>
          {vueMode === 'planning' ? (
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={styles.weekNav}>
                  <button type="button" className="agdBtn" onClick={() => setLundi((l) => ajouterJours(l, -7))} style={styles.chevronBtn} aria-label="Semaine précédente">‹</button>
                  <div style={styles.weekLabel}>{labelSemaine}</div>
                  <button type="button" className="agdBtn" onClick={() => setLundi((l) => ajouterJours(l, 7))} style={styles.chevronBtn} aria-label="Semaine suivante">›</button>
                  <button type="button" className="agdBtn" onClick={() => setLundi(lundiDeLaSemaine(new Date()))} style={styles.ghostBtnSmall}>Aujourd'hui</button>
                </div>
                <div style={styles.legend}>
                  {(['meeting', 'phoneCall', 'reminder'] as RdvType[]).map((t) => (
                    <span key={t} style={styles.legendItem}>
                      <span style={{ ...styles.legendDot, background: RDV_TYPE_COLORS[t] }} />
                      {RDV_TYPE_LABELS[t]}
                    </span>
                  ))}
                  <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'transparent', border: '1.5px solid #E8A96A' }} />Tâche en cours</span>
                </div>
              </div>

              {/* Jours */}
              <div style={styles.gridHead}>
                <div />
                {jours.map((j) => {
                  const estAujourdhui = memeJour(j, aujourdHui)
                  return (
                    <div key={j.toISOString()} style={styles.gridHeadCell}>
                      <div style={styles.gridHeadWeekday}>{j.toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
                      <div style={{ ...styles.gridHeadDay, ...(estAujourdhui ? styles.gridHeadDayToday : {}) }}>{j.getDate()}</div>
                    </div>
                  )
                })}
              </div>

              {/* Journée entière */}
              {(() => {
                const parJour = jours.map((j) => rdvList.filter((r) => r.all_day && r.start_date && memeJour(new Date(r.start_date), j)))
                if (!parJour.some((l) => l.length)) return null
                return (
                  <div style={styles.gridAllDay}>
                    <div style={styles.gridAllDayLabel}>Journée</div>
                    {parJour.map((liste, i) => (
                      <div key={i} style={styles.gridAllDayCell}>
                        {liste.map((r) => (
                          <button key={r.rdv_id} type="button" className="agdRdv" onClick={() => setSelectedRdv(r)} style={{ ...styles.allDayChip, background: RDV_TYPE_COLORS[r.type] || '#7A5EA8' }}>
                            {r.subject}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Grille horaire */}
              <div style={styles.gridBodyWrapper}>
                <div style={styles.gridBody}>
                  <div style={{ position: 'relative', height: GRILLE_HAUTEUR_TOTALE }}>
                    {heures.map((h) => (
                      <div key={h} style={{ ...styles.hourLabel, top: (h - GRILLE_HEURE_DEBUT) * GRILLE_HAUTEUR_HEURE - 7 }}>{String(h).padStart(2, '0')}h</div>
                    ))}
                  </div>
                  {jours.map((j) => {
                    const evenements = rdvList.filter((r) => !r.all_day && r.start_date && memeJour(new Date(r.start_date), j))
                    const disposes = repartirColonnes(evenements)
                    const estAujourdhui = memeJour(j, aujourdHui)
                    const weekend = j.getDay() === 0 || j.getDay() === 6
                    return (
                      <div key={j.toISOString()} style={{ ...styles.dayColumn, height: GRILLE_HAUTEUR_TOTALE, background: weekend ? 'rgba(255,255,255,0.015)' : estAujourdhui ? 'rgba(143,199,218,0.05)' : 'transparent' }}>
                        {heures.map((h) => (
                          <div key={h} style={{ ...styles.hourLine, top: (h - GRILLE_HEURE_DEBUT) * GRILLE_HAUTEUR_HEURE }} />
                        ))}
                        {estAujourdhui && (
                          <div style={{ ...styles.nowLine, top: (minutesDepuisDebutGrille(aujourdHui) / 60) * GRILLE_HAUTEUR_HEURE }} />
                        )}
                        {disposes.map(({ ev, colonne, nbColonnes }) => {
                          const debutMin = minutesDepuisDebutGrille(new Date(ev.start_date))
                          const finMin = minutesDepuisDebutGrille(new Date(ev.end_date || ev.start_date))
                          const top = (debutMin / 60) * GRILLE_HAUTEUR_HEURE
                          const hauteur = Math.max(((finMin - debutMin) / 60) * GRILLE_HAUTEUR_HEURE, 24)
                          const largeur = 100 / nbColonnes
                          const tache = Boolean(ev.numero_tiers && tachesEnCoursParTiers.has(ev.numero_tiers))
                          const heureLabel = new Date(ev.start_date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                          const selected = selectedRdv?.rdv_id === ev.rdv_id
                          return (
                            <button
                              key={ev.rdv_id}
                              type="button"
                              className="agdRdv"
                              onClick={() => setSelectedRdv(ev)}
                              title={`${heureLabel} · ${ev.subject}${ev.company_name ? ` · ${ev.company_name}` : ''}`}
                              style={{
                                ...styles.event,
                                top, height: hauteur,
                                left: `calc(${colonne * largeur}% + 2px)`, width: `calc(${largeur}% - 4px)`,
                                background: RDV_TYPE_COLORS[ev.type] || '#7A5EA8',
                                border: tache ? '1.5px solid #E8A96A' : selected ? '1.5px solid #F5F3EC' : '1px solid rgba(0,0,0,0.25)',
                                boxShadow: selected ? '0 0 0 2px rgba(245,243,236,0.35)' : 'none',
                              }}
                            >
                              <span style={styles.eventTitle}>
                                {ev.a_compte_rendu ? '[CR] ' : ''}{tache ? '⚠️ ' : ''}{ev.subject}
                              </span>
                              {hauteur > 38 && <span style={styles.eventMeta}>{heureLabel}{ev.company_name ? ` · ${ev.company_name}` : ''}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={styles.cardTitle}>Rendez-vous — {periodeLabel}</div>
                <div style={styles.chips}>
                  {([
                    ['semaine_derniere', 'Semaine dernière'],
                    ['semaine_courante', 'Cette semaine'],
                    ['semaine_prochaine', 'Semaine prochaine'],
                    ['defaut', '30 prochains jours'],
                  ] as const).map(([preset, label]) => (
                    <button key={preset} type="button" className="agdBtn" onClick={() => selectionnerPeriode(preset)} style={{ ...styles.chip, ...(periodeLabel === label ? styles.chipActive : {}) }}>{label}</button>
                  ))}
                  <input type="date" value={dateDebutInput} onChange={(e) => setDateDebutInput(e.target.value)} style={styles.dateInput} />
                  <span style={{ color: 'rgba(255,255,255,0.4)' }}>→</span>
                  <input type="date" value={dateFinInput} onChange={(e) => setDateFinInput(e.target.value)} style={styles.dateInput} />
                  <button type="button" className="agdBtn" onClick={appliquerPeriodePersonnalisee} disabled={!dateDebutInput || !dateFinInput} style={{ ...styles.chip, opacity: dateDebutInput && dateFinInput ? 1 : 0.5 }}>Voir</button>
                </div>
              </div>

              {rdvLoading ? (
                <div style={styles.muted}>Chargement…</div>
              ) : rdvList.length === 0 ? (
                <div style={styles.muted}>Aucun rendez-vous sur cette période.</div>
              ) : (
                <div style={styles.list}>
                  {rdvList.map((r) => {
                    const d = r.start_date ? new Date(r.start_date) : null
                    const dateLabel = d
                      ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) + (r.all_day ? '' : ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                      : ''
                    const tache = Boolean(r.numero_tiers && tachesEnCoursParTiers.has(r.numero_tiers))
                    const selected = selectedRdv?.rdv_id === r.rdv_id
                    return (
                      <button
                        key={r.rdv_id}
                        type="button"
                        className="agdRow"
                        onClick={() => setSelectedRdv(r)}
                        style={{
                          ...styles.row,
                          borderColor: selected ? 'rgba(245,243,236,0.5)' : tache ? 'rgba(230,159,74,0.45)' : 'rgba(255,255,255,0.08)',
                          background: tache ? 'rgba(230,159,74,0.07)' : 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <span style={{ ...styles.rowBar, background: RDV_TYPE_COLORS[r.type] || '#7A5EA8' }} />
                        <span style={styles.rowDate}>{dateLabel}</span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          {r.company_name && <span style={styles.rowCompany}>{r.company_name}</span>}
                          <span style={styles.rowSubject}>
                            {r.a_compte_rendu && <span title="Compte-rendu disponible" style={styles.tagCr}>CR</span>}
                            {tache && <span title="Tâche non terminée pour ce client">⚠️ </span>}
                            {r.subject}
                          </span>
                        </span>
                        <span style={styles.rowMeta}>{[RDV_TYPE_LABELS[r.type] || r.type, r.source === 'compagnon' ? 'Compagnon' : 'BLG', r.lieu].filter(Boolean).join(' · ')}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Recherche de documents */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div style={styles.cardTitle}>Rechercher un document</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                placeholder="N° de pièce, référence chantier, n° client…"
                style={styles.searchInput}
              />
              <button type="button" onClick={() => void runSearch()} style={styles.primaryBtn}>Chercher</button>
            </div>
            <div style={{ marginTop: 10 }}>
              {searchLoading ? (
                <div style={styles.muted}>Recherche…</div>
              ) : results === null ? null : results.length === 0 ? (
                <div style={styles.muted}>Aucun document trouvé.</div>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Type', 'N° de pièce', 'Client', 'Référence', 'Date', 'Montant HT'].map((h) => <th key={h} style={styles.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.key} className="agdRow" onClick={() => setSelectedDoc(r)} style={{ cursor: 'pointer' }}>
                        <td style={styles.td}>{r.type || '—'}</td>
                        <td style={{ ...styles.td, fontWeight: 700, color: '#fff' }}>{r.numero || '—'}</td>
                        <td style={styles.td}>{r.tiers || '—'}</td>
                        <td style={styles.td}>{r.reference || '—'}</td>
                        <td style={styles.td}>{r.date ? formatDateFr(r.date) : '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.montant_ht ? formatMoney(r.montant_ht) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Panneau latéral : détail du RDV */}
        <aside style={styles.side}>
          {selectedRdv ? (
            <RdvDetailPanel
              rdv={selectedRdv}
              tacheEnCours={Boolean(selectedRdv.numero_tiers && tachesEnCoursParTiers.has(selectedRdv.numero_tiers))}
              currentEmail={currentEmail}
              currentName={currentName}
              onClose={() => setSelectedRdv(null)}
              onEdit={() => setFormRdv({ mode: 'edit', rdv: selectedRdv })}
              onDelete={() => void supprimerRdvCompagnon(selectedRdv)}
              onOpenClient={ouvrirVisionClient}
              onSaved={rafraichir}
            />
          ) : (
            <div style={styles.sideEmpty}>
              <div style={{ fontSize: 30 }}>📅</div>
              <div style={{ fontWeight: 700, color: '#fff', marginTop: 8 }}>Sélectionnez un rendez-vous</div>
              <div style={{ ...styles.muted, marginTop: 4 }}>Le détail, le compte-rendu et la dictée vocale s'affichent ici.</div>
            </div>
          )}
        </aside>
      </div>

      {formRdv && (
        <RdvFormModal
          mode={formRdv.mode}
          rdv={formRdv.mode === 'edit' ? formRdv.rdv : undefined}
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setFormRdv(null)}
          onSaved={() => { setFormRdv(null); rafraichir() }}
        />
      )}

      {selectedDoc && (
        <div style={styles.modalBackdrop} onClick={() => setSelectedDoc(null)} role="presentation">
          <div role="dialog" aria-modal="true" style={styles.modalSmall} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>{selectedDoc.numero || '(sans numéro)'}</div>
            <div style={styles.muted}>{selectedDoc.type || 'Document'}</div>
            <dl style={styles.dl}>
              {[
                ['Type', selectedDoc.type], ['N° de pièce', selectedDoc.numero], ['Client', selectedDoc.tiers],
                ['Référence', selectedDoc.reference], ['Date', selectedDoc.date ? formatDateFr(selectedDoc.date) : ''],
                ['Montant HT', selectedDoc.montant_ht ? formatMoney(selectedDoc.montant_ht) : ''],
              ].map(([label, value]) => (
                <div key={label} style={styles.dlRow}>
                  <dt style={styles.dt}>{label}</dt>
                  <dd style={styles.dd}>{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {selectedDoc.tiers && (
              <button type="button" className="agdBtn" onClick={() => ouvrirVisionClient(selectedDoc.tiers)} style={{ ...styles.ghostBtn, borderColor: 'rgba(75,146,172,0.5)', color: '#8FC7DA' }}>Vision client 360</button>
            )}
            <button type="button" className="agdBtn" onClick={() => setSelectedDoc(null)} style={styles.ghostBtn}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Panneau de détail ──────────────────────────────────────────────────────
function RdvDetailPanel({
  rdv, tacheEnCours, currentEmail, currentName, onClose, onEdit, onDelete, onOpenClient, onSaved,
}: {
  rdv: RdvUnifie
  tacheEnCours: boolean
  currentEmail: string
  currentName: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenClient: (numeroTiers: string) => void
  onSaved: () => void
}) {
  const start = rdv.start_date ? new Date(rdv.start_date) : null
  const end = rdv.end_date ? new Date(rdv.end_date) : null
  const fmt = (d: Date | null) => (d ? (rdv.all_day ? d.toLocaleDateString('fr-FR') : d.toLocaleString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })) : '')
  const activityId = rdv.source === 'compagnon' ? rdv.compagnon_id : rdv.blg_activity_id
  const estCompagnon = rdv.source === 'compagnon'

  return (
    <div style={styles.sidePanel}>
      <div style={styles.sideHeader}>
        <span style={{ ...styles.legendDot, width: 12, height: 12, background: RDV_TYPE_COLORS[rdv.type] || '#7A5EA8' }} />
        <span style={styles.sideKicker}>{RDV_TYPE_LABELS[rdv.type] || rdv.type || 'Activité'}{estCompagnon ? ' · RDV compagnon' : ' · BLG'}</span>
        <button type="button" className="agdBtn" onClick={onClose} style={styles.closeBtn} aria-label="Fermer">✕</button>
      </div>
      <div style={styles.sideTitle}>{rdv.subject}</div>
      {rdv.company_name && (
        <button type="button" onClick={() => rdv.numero_tiers && onOpenClient(rdv.numero_tiers)} disabled={!rdv.numero_tiers} style={styles.companyLink}>
          {rdv.company_name}{rdv.numero_tiers ? ` (${rdv.numero_tiers})` : ''}
        </button>
      )}

      <dl style={styles.dl}>
        <div style={styles.dlRow}><dt style={styles.dt}>Début</dt><dd style={styles.dd}>{fmt(start) || '—'}</dd></div>
        <div style={styles.dlRow}><dt style={styles.dt}>Fin</dt><dd style={styles.dd}>{fmt(end) || '—'}</dd></div>
        {rdv.lieu && <div style={styles.dlRow}><dt style={styles.dt}>Lieu</dt><dd style={styles.dd}>{rdv.lieu}</dd></div>}
      </dl>

      {tacheEnCours && (
        <div style={styles.warnBox}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span>Une tâche non terminée est en cours pour ce client — engagement pris à ne pas oublier avant ce rendez-vous.</span>
        </div>
      )}

      <div style={styles.sideActions}>
        {estCompagnon && (
          <>
            <button type="button" className="agdBtn" onClick={onEdit} style={styles.ghostBtn}>✏️ Modifier</button>
            <button type="button" className="agdBtn" onClick={onDelete} style={{ ...styles.ghostBtn, borderColor: 'rgba(193,104,60,0.5)', color: '#e0a685' }}>🗑 Supprimer</button>
          </>
        )}
        {rdv.numero_tiers && (
          <button type="button" className="agdBtn" onClick={() => onOpenClient(rdv.numero_tiers as string)} style={{ ...styles.ghostBtn, borderColor: 'rgba(75,146,172,0.5)', color: '#8FC7DA' }}>Vision client 360</button>
        )}
      </div>

      <CompteRenduBlock
        activityId={activityId}
        numeroTiers={rdv.numero_tiers}
        rdvLabel={rdv.subject}
        currentEmail={currentEmail}
        currentName={currentName}
        onSaved={onSaved}
      />

      {rdv.numero_tiers && (
        <VoiceReportButtons
          numeroTiers={rdv.numero_tiers}
          clientNom={rdv.company_name || ''}
          rdvActivityId={activityId || undefined}
          rdvLabel={rdv.subject}
          userEmail={currentEmail}
          userName={currentName}
        />
      )}
    </div>
  )
}

// ── Compte-rendu (même logique que MobileRdv, table client_comptes_rendus) ──
function CompteRenduBlock({
  activityId, numeroTiers, rdvLabel, currentEmail, currentName, onSaved,
}: {
  activityId: string | null
  numeroTiers: string | null
  rdvLabel: string
  currentEmail: string
  currentName: string
  onSaved: () => void
}) {
  const [compteRendu, setCompteRendu] = useState<CompteRendu | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [resumeEdit, setResumeEdit] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setEditMode(false)
      if (!activityId) { setCompteRendu(null); setLoading(false); return }
      setLoading(true)
      const { data } = await supabase
        .from('client_comptes_rendus')
        .select('id, resume, created_by_name, created_by_email, created_at')
        .eq('rdv_activity_id', activityId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setCompteRendu((data as CompteRendu) || null)
      setResumeEdit((data as CompteRendu | null)?.resume || '')
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activityId])

  async function enregistrer() {
    if (!activityId) return
    setSaving(true)
    setError(null)
    try {
      if (compteRendu) {
        const { error: err } = await supabase.from('client_comptes_rendus').update({ resume: resumeEdit }).eq('id', compteRendu.id)
        if (err) throw err
        setCompteRendu({ ...compteRendu, resume: resumeEdit })
      } else {
        const { data, error: err } = await supabase
          .from('client_comptes_rendus')
          .insert({ numero_tiers: numeroTiers, rdv_activity_id: activityId, rdv_label: rdvLabel, created_by_email: currentEmail, created_by_name: currentName, resume: resumeEdit, transcript: null })
          .select('id, resume, created_by_name, created_by_email, created_at')
          .single()
        if (err) throw err
        setCompteRendu(data as CompteRendu)
      }
      setEditMode(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function supprimer() {
    if (!compteRendu) return
    if (!window.confirm('Supprimer ce compte-rendu ? Cette action est définitive.')) return
    setError(null)
    try {
      const { data, error: err } = await supabase.from('client_comptes_rendus').delete().eq('id', compteRendu.id).select('id')
      if (err) throw err
      if (!data || data.length === 0) throw new Error("Suppression refusée par la base (droits insuffisants) — le compte-rendu n'a pas été supprimé.")
      setCompteRendu(null)
      setResumeEdit('')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!activityId) return null

  return (
    <div style={styles.crBlock}>
      <div style={styles.crHeader}>
        <span style={styles.sideKicker}>Compte-rendu</span>
        {!editMode && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="agdBtn" onClick={() => setEditMode(true)} style={styles.chip}>{compteRendu ? 'Modifier' : '+ Ajouter'}</button>
            {compteRendu && <button type="button" className="agdBtn" onClick={() => void supprimer()} style={{ ...styles.chip, color: '#e0a685', borderColor: 'rgba(193,104,60,0.5)' }}>Supprimer</button>}
          </span>
        )}
      </div>
      {loading ? (
        <div style={styles.muted}>Chargement…</div>
      ) : editMode ? (
        <div>
          <textarea value={resumeEdit} onChange={(e) => setResumeEdit(e.target.value)} rows={6} placeholder="Résumé du rendez-vous…" autoFocus style={styles.textarea} />
          {error && <div style={styles.errorText}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={() => void enregistrer()} disabled={saving} style={{ ...styles.primaryBtn, flex: 1 }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            <button type="button" className="agdBtn" onClick={() => { setEditMode(false); setResumeEdit(compteRendu?.resume || '') }} disabled={saving} style={styles.ghostBtn}>Annuler</button>
          </div>
        </div>
      ) : compteRendu ? (
        <div>
          <p style={styles.crText}>{compteRendu.resume || '(résumé vide)'}</p>
          <div style={styles.crFooter}>
            Créé par : <span style={{ color: '#E8A96A', fontWeight: 700 }}>{auteurCompteRendu(compteRendu)}</span>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}> · le {new Date(compteRendu.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {error && <div style={styles.errorText}>{error}</div>}
        </div>
      ) : (
        <div style={styles.muted}>Aucun compte-rendu pour ce rendez-vous.</div>
      )}
    </div>
  )
}

// ── Création / modification d'un RDV compagnon ─────────────────────────────
function RdvFormModal({
  mode, rdv, currentEmail, currentName, onClose, onSaved,
}: {
  mode: 'create' | 'edit'
  rdv?: RdvUnifie
  currentEmail: string
  currentName: string
  onClose: () => void
  onSaved: () => void
}) {
  const startInit = rdv?.start_date ? new Date(rdv.start_date) : null
  const endInit = rdv?.end_date ? new Date(rdv.end_date) : null
  const dureeInit = startInit && endInit ? Math.max(15, Math.round((endInit.getTime() - startInit.getTime()) / 60000)) : 60

  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<{ numero: string; intitule: string }[]>([])
  const [numeroTiers, setNumeroTiers] = useState<string | null>(rdv?.numero_tiers ?? null)
  const [intituleTiers, setIntituleTiers] = useState(rdv?.company_name ?? '')
  const [subject, setSubject] = useState(rdv?.subject ?? '')
  const [type, setType] = useState<RdvType>(rdv?.type === 'phoneCall' || rdv?.type === 'reminder' ? rdv.type : 'meeting')
  const [date, setDate] = useState(startInit ? toIsoDate(startInit) : toIsoDate(new Date()))
  const [heure, setHeure] = useState(startInit ? startInit.toTimeString().slice(0, 5) : '09:00')
  const [duree, setDuree] = useState(String(dureeInit))
  const [lieu, setLieu] = useState(rdv?.lieu ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = clientSearch.trim()
    if (!q || numeroTiers) { setClientResults([]); return }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('ref_tiers').select('numero, intitule').or(`numero.ilike.${q}%,intitule.ilike.%${q}%`).limit(8)
      setClientResults(((data || []) as any[]).map((r) => ({ numero: String(r.numero || ''), intitule: String(r.intitule || '') })))
    }, 250)
    return () => window.clearTimeout(t)
  }, [clientSearch, numeroTiers])

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  async function enregistrer() {
    if (!subject.trim() || !date) { setError('Objet et date sont obligatoires.'); return }
    if (mode === 'edit' && !rdv?.compagnon_id) { setError('Rendez-vous invalide (identifiant manquant).'); return }
    setSaving(true)
    setError('')
    try {
      const dureeMinutes = Math.max(1, Number(duree) || 60)
      const start = new Date(`${date}T${heure}:00`)
      const end = new Date(start.getTime() + dureeMinutes * 60000)
      const payload = {
        numero_tiers: numeroTiers,
        type,
        subject: subject.trim(),
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        all_day: false,
        lieu: lieu.trim() || null,
      }
      if (mode === 'edit') {
        const { error: err } = await supabase.from('rdv_compagnon').update(payload).eq('id', rdv!.compagnon_id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('rdv_compagnon').insert({ ...payload, created_by_email: currentEmail, created_by_name: currentName })
        if (err) throw err
      }
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de l’enregistrement du RDV.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={() => !saving && onClose()} role="presentation">
      <div role="dialog" aria-modal="true" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>{mode === 'edit' ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}</div>
        <div style={styles.muted}>RDV compagnon CEGECLIM — indépendant de BLG / Outlook</div>

        <div style={styles.formGrid}>
          <label style={{ ...styles.field, gridColumn: '1 / -1', position: 'relative' }}>
            <span style={styles.fieldLabel}>Client (facultatif)</span>
            <input
              value={numeroTiers ? `${intituleTiers} (${numeroTiers})` : clientSearch}
              onChange={(e) => { setClientSearch(e.target.value); setNumeroTiers(null) }}
              placeholder="Nom ou numéro du client…"
              style={styles.input}
            />
            {numeroTiers && <button type="button" onClick={() => { setNumeroTiers(null); setClientSearch('') }} style={styles.linkBtn}>Retirer le client</button>}
            {clientResults.length > 0 && !numeroTiers && (
              <div style={styles.suggestions}>
                {clientResults.map((c) => (
                  <button key={c.numero} type="button" className="agdRow" onClick={() => { setNumeroTiers(c.numero); setIntituleTiers(c.intitule); setClientResults([]) }} style={styles.suggestion}>
                    <span style={{ color: '#E8A96A', fontWeight: 700 }}>{c.numero}</span> · {c.intitule}
                  </button>
                ))}
              </div>
            )}
          </label>

          <label style={{ ...styles.field, gridColumn: '1 / -1' }}>
            <span style={styles.fieldLabel}>Objet</span>
            <textarea value={subject} onChange={(e) => setSubject(e.target.value)} rows={2} placeholder="Ex. : Visite chantier, appel de relance…" style={styles.textarea} />
          </label>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as RdvType)} style={styles.input}>
              <option value="meeting">RDV</option>
              <option value="phoneCall">Appel</option>
              <option value="reminder">Rappel</option>
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Durée (min)</span>
            <input type="number" value={duree} onChange={(e) => setDuree(e.target.value)} onFocus={(e) => e.target.select()} onBlur={() => { if (!duree.trim() || Number(duree) <= 0) setDuree('60') }} min={15} step={15} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Heure</span>
            <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} style={styles.input} />
          </label>
          <label style={{ ...styles.field, gridColumn: '1 / -1' }}>
            <span style={styles.fieldLabel}>Lieu (facultatif)</span>
            <input value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Ex. : Chez le client, agence…" style={styles.input} />
          </label>
        </div>

        {error && <div style={styles.errorText}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={() => void enregistrer()} disabled={saving} style={{ ...styles.primaryBtn, flex: 1 }}>
            {saving ? 'Enregistrement…' : mode === 'edit' ? 'Enregistrer les modifications' : 'Créer le RDV'}
          </button>
          <button type="button" className="agdBtn" onClick={() => !saving && onClose()} style={styles.ghostBtn}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1600, margin: '0 auto', padding: '10px 4px 40px', color: '#F5F3EC', fontFamily: 'var(--font-body)' },

  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 },
  kicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  title: { margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' },
  lead: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.6)' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  segment: { display: 'flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' },
  segmentBtn: { padding: '7px 12px', borderRadius: 9, border: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.65)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  segmentBtnActive: { background: 'rgba(75,146,172,0.22)', borderColor: 'rgba(75,146,172,0.55)', color: '#8FC7DA' },

  primaryBtn: { padding: '9px 16px', borderRadius: 10, border: 'none', background: '#A6A181', color: '#141A26', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  ghostBtn: { padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.78)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  ghostBtnSmall: { padding: '5px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.75)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' },
  chevronBtn: { width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 18, lineHeight: 1, cursor: 'pointer' },
  closeBtn: { marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer' },
  linkBtn: { alignSelf: 'flex-start', marginTop: 4, background: 'none', border: 'none', color: '#e0a685', fontSize: 11.5, fontWeight: 600, padding: 0, cursor: 'pointer', fontFamily: 'inherit' },

  errorBox: { marginBottom: 12, padding: 12, borderRadius: 12, border: '1px solid rgba(193,104,60,0.35)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13 },
  errorText: { marginTop: 8, fontSize: 12.5, color: '#e0a685' },
  muted: { fontSize: 12.5, color: 'rgba(255,255,255,0.45)' },

  layout: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 16, alignItems: 'start' },
  main: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },
  side: { position: 'sticky', top: 140 },

  card: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: 16 },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.55)' },

  weekNav: { display: 'flex', alignItems: 'center', gap: 8 },
  weekLabel: { fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 190, textAlign: 'center' },
  legend: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },

  gridHead: { display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)', borderTop: '1px solid rgba(255,255,255,0.08)' },
  gridHeadCell: { textAlign: 'center', padding: '8px 2px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  gridHeadWeekday: { fontSize: 10.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  gridHeadDay: { width: 28, height: 28, lineHeight: '28px', borderRadius: '50%', margin: '3px auto 0', fontSize: 15, fontWeight: 700, color: '#fff' },
  gridHeadDayToday: { background: '#8FC7DA', color: '#141A26' },

  gridAllDay: { display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)', borderTop: '1px solid rgba(255,255,255,0.08)' },
  gridAllDayLabel: { fontSize: 9.5, color: 'rgba(255,255,255,0.4)', padding: '6px 4px', textAlign: 'right' },
  gridAllDayCell: { borderLeft: '1px solid rgba(255,255,255,0.06)', padding: 4, display: 'flex', flexDirection: 'column', gap: 3 },
  allDayChip: { fontSize: 11, color: '#fff', borderRadius: 6, padding: '3px 6px', border: 'none', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', fontFamily: 'inherit' },

  gridBodyWrapper: { maxHeight: 'calc(100vh - 330px)', overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)' },
  gridBody: { display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)', position: 'relative' },
  hourLabel: { position: 'absolute', right: 6, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' },
  dayColumn: { position: 'relative', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.05)' },
  nowLine: { position: 'absolute', left: 0, right: 0, borderTop: '2px solid #C1683C', zIndex: 5 },
  event: { position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, borderRadius: 6, padding: '3px 6px', overflow: 'hidden', cursor: 'pointer', color: '#fff', textAlign: 'left', fontFamily: 'inherit', zIndex: 2 },
  eventTitle: { fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' },
  eventMeta: { fontSize: 10, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' },

  chips: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: { padding: '6px 11px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.8)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  chipActive: { background: 'rgba(75,146,172,0.3)', borderColor: 'rgba(75,146,172,0.6)', color: '#fff' },
  dateInput: { height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 8px', fontSize: 12.5, fontFamily: 'inherit' },

  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, border: '1px solid', color: '#F5F3EC', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' },
  rowBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, flexShrink: 0 },
  rowDate: { width: 200, flexShrink: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)' },
  rowCompany: { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', color: '#E8A96A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowSubject: { display: 'block', fontSize: 14.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowMeta: { flexShrink: 0, fontSize: 11.5, color: 'rgba(255,255,255,0.45)' },
  tagCr: { display: 'inline-block', marginRight: 6, padding: '1px 5px', borderRadius: 5, background: 'rgba(143,199,218,0.2)', color: '#8FC7DA', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', verticalAlign: 'middle' },

  searchInput: { flex: 1, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px 13px', fontSize: 14, outline: 'none', fontFamily: 'inherit' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  td: { padding: '9px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' },

  sidePanel: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.12)', background: '#101A2E', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' },
  sideEmpty: { borderRadius: 18, border: '1px dashed rgba(255,255,255,0.18)', padding: 28, textAlign: 'center' },
  sideHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  sideKicker: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)' },
  sideTitle: { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.2 },
  companyLink: { alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: '#E8A96A', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
  sideActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  warnBox: { display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, border: '1px solid rgba(230,159,74,0.4)', background: 'rgba(230,159,74,0.12)', padding: '10px 12px', fontSize: 12.5, color: '#E8A96A' },

  dl: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  dlRow: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, fontSize: 13 },
  dt: { color: 'rgba(255,255,255,0.5)' },
  dd: { margin: 0, color: '#fff' },

  crBlock: { borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', padding: '12px 14px' },
  crHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  crText: { fontSize: 13, color: '#fff', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '0 0 8px' },
  crFooter: { paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12.5, color: 'rgba(255,255,255,0.55)' },
  textarea: { width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: 10, fontSize: 13.5, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },

  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(6,10,18,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { width: 'min(620px, 96vw)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 20, border: '1px solid rgba(255,255,255,0.14)', background: '#141A26', padding: 22, display: 'flex', flexDirection: 'column', gap: 10, color: '#F5F3EC' },
  modalSmall: { width: 'min(440px, 96vw)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.14)', background: '#141A26', padding: 22, display: 'flex', flexDirection: 'column', gap: 12, color: '#F5F3EC' },
  modalTitle: { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#fff' },

  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 6 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  fieldLabel: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  input: { height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' },
  suggestions: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, marginTop: 4, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#0B1220', overflow: 'hidden' },
  suggestion: { display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' },
}
