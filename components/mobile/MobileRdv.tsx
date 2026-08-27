'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'
import VoiceReportButtons from './VoiceReportButtons'

const SEARCH_TABLES = ['activite_lignes', 'facture_lignes', 'devis_lignes']

const SEARCH_FIELDS = [
  { key: 'numero_piece' },
  { key: 'numero_document' },
  { key: 'reference_article' },
  { key: 'reference' },
  { key: 'numero_tiers_entete' },
]

const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: 'RDV', phoneCall: 'Appel', reminder: 'Rappel',
  '4': 'RDV', '7': 'Appel', '9': 'Rappel',
}
const RDV_TYPE_COLORS: Record<string, string> = {
  meeting: '#2E5BB8', phoneCall: '#D68910', reminder: '#8E44AD',
  '4': '#2E5BB8', '7': '#D68910', '9': '#8E44AD',
}

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

type CompteRendu = { id: string; resume: string | null; created_by_name: string | null; created_at: string }

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

function fallbackNameFromEmail(email: string) {
  const local = String(email || '').split('@')[0] || email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || email
}

type DocResult = {
  key: string
  type: string
  numero: string
  tiers: string
  reference: string
  date: string
  montant_ht: number
}

async function searchByField(table: string, field: string, term: string) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .ilike(field, `%${term}%`)
      .limit(30)
    if (error) return []
    return (data || []) as Record<string, any>[]
  } catch {
    return []
  }
}

export default function MobileRdv({ onOpenClient }: { onOpenClient?: (numeroTiers: string, nom: string) => void }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<DocResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[]; footer?: React.ReactNode } | null>(null)

  const [rdvList, setRdvList] = useState<RdvUnifie[] | null>(null)
  const [rdvLoading, setRdvLoading] = useState(true)
  const [blgPartnerId, setBlgPartnerId] = useState<string | null>(null)

  // Numéros de tiers (clients) ayant au moins une tâche NON terminée en
  // cours, assignée à l'utilisateur -- affiché comme alerte ⚠️ sur les rdv
  // concernés (voir chargerTachesEnCours()), pour ne pas oublier un
  // engagement pris avec ce client avant de le revoir.
  const [tachesEnCoursParTiers, setTachesEnCoursParTiers] = useState<Set<string>>(new Set())

  const [periodeLabel, setPeriodeLabel] = useState('30 prochains jours')
  const [agendaOuvert, setAgendaOuvert] = useState(false)
  const [dateDebutInput, setDateDebutInput] = useState('')
  const [dateFinInput, setDateFinInput] = useState('')
  const [periodeBornes, setPeriodeBornes] = useState<{ debut: Date; fin: Date } | null>(null)

  const [nouveauRdvOuvert, setNouveauRdvOuvert] = useState(false)

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentName, setCurrentName] = useState('')

  /** Charge, pour un lot de numéros de tiers, ceux qui ont au moins une
   * tâche non terminée assignée à l'utilisateur -- utilisé pour l'alerte
   * ⚠️ sur la liste de rdv. Jamais bloquant (repli silencieux sur "aucune
   * alerte" en cas d'erreur). */
  async function chargerTachesEnCours(email: string, name: string, numerosTiers: (string | null)[]) {
    const uniques = Array.from(new Set(numerosTiers.filter((n): n is string => Boolean(n && n.trim()))))
    if (uniques.length === 0) {
      setTachesEnCoursParTiers(new Set())
      return
    }
    try {
      const identities = Array.from(new Set([email, name].filter(Boolean)))
      const assignedFilter = identities.map((v) => `assigned_to.eq.${v.replace(/,/g, '\\,')}`).join(',')
      const { data, error } = await supabase
        .from('todo_actions')
        .select('numero_tiers')
        .or(assignedFilter)
        .not('status', 'in', '("Terminé","Annulé")')
        .in('numero_tiers', uniques)
      if (error) {
        console.warn('[MobileRdv] chargerTachesEnCours', error.message)
        setTachesEnCoursParTiers(new Set())
        return
      }
      setTachesEnCoursParTiers(new Set(((data || []) as any[]).map((r) => safeText(r.numero_tiers)).filter(Boolean)))
    } catch (e) {
      console.warn('[MobileRdv] chargerTachesEnCours', e)
      setTachesEnCoursParTiers(new Set())
    }
  }

  async function chargerRdv(email: string, name: string, partnerId: string | null, debut: Date, fin: Date) {
    setRdvLoading(true)
    setPeriodeBornes({ debut, fin })
    try {
      const start = debut.toISOString().slice(0, 10)
      const end = fin.toISOString().slice(0, 10)

      const orParts = [`created_by_email.eq.${email}`]
      if (partnerId) orParts.push(`blg_partner_id.eq.${partnerId}`)

      const { data, error } = await supabase
        .from('v_rdv_unifie')
        .select('*')
        .gte('start_date', start)
        .lt('start_date', end)
        .or(orParts.join(','))
        .order('start_date', { ascending: true })
        .limit(200)

      if (error) {
        console.error('[MobileRdv] v_rdv_unifie', error)
        setRdvList([])
        setTachesEnCoursParTiers(new Set())
        return
      }
      const rows = (data || []) as RdvUnifie[]
      setRdvList(rows)
      void chargerTachesEnCours(email, name, rows.map((r) => r.numero_tiers))
    } finally {
      setRdvLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      setRdvLoading(true)
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const email = sessionData.session?.user?.email?.toLowerCase()
        if (!email) return

        const { data: access } = await supabase
          .from('user_page_access')
          .select('blg_partner_id, display_name')
          .eq('email', email)
          .maybeSingle()

        if (cancelled) return
        const nom = String(access?.display_name || '').trim() || fallbackNameFromEmail(email)
        setCurrentEmail(email)
        setCurrentName(nom)
        setBlgPartnerId(access?.blg_partner_id || null)

        const today = new Date()
        const later = new Date(today)
        later.setDate(later.getDate() + 30)
        await chargerRdv(email, nom, access?.blg_partner_id || null, today, later)
      } finally {
        if (!cancelled) setRdvLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  async function rafraichirPeriode() {
    if (!currentEmail || !periodeBornes) return
    await chargerRdv(currentEmail, currentName, blgPartnerId, periodeBornes.debut, periodeBornes.fin)
  }

  function selectionnerPeriode(preset: 'semaine_derniere' | 'semaine_courante' | 'semaine_prochaine' | 'defaut') {
    if (!currentEmail) return
    const aujourdHui = new Date()
    const jourSemaine = aujourdHui.getDay() || 7
    const lundiCourant = new Date(aujourdHui)
    lundiCourant.setDate(aujourdHui.getDate() - (jourSemaine - 1))
    lundiCourant.setHours(0, 0, 0, 0)

    let debut: Date
    let fin: Date
    let label: string

    if (preset === 'defaut') {
      debut = new Date(aujourdHui)
      fin = new Date(aujourdHui)
      fin.setDate(fin.getDate() + 30)
      label = '30 prochains jours'
    } else if (preset === 'semaine_derniere') {
      debut = new Date(lundiCourant)
      debut.setDate(debut.getDate() - 7)
      fin = new Date(lundiCourant)
      label = 'Semaine dernière'
    } else if (preset === 'semaine_courante') {
      debut = new Date(lundiCourant)
      fin = new Date(lundiCourant)
      fin.setDate(fin.getDate() + 7)
      label = 'Cette semaine'
    } else {
      debut = new Date(lundiCourant)
      debut.setDate(debut.getDate() + 7)
      fin = new Date(lundiCourant)
      fin.setDate(fin.getDate() + 14)
      label = 'Semaine prochaine'
    }

    setPeriodeLabel(label)
    setAgendaOuvert(false)
    void chargerRdv(currentEmail, currentName, blgPartnerId, debut, fin)
  }

  function appliquerPeriodePersonnalisee() {
    if (!currentEmail || !dateDebutInput || !dateFinInput) return
    const debut = new Date(`${dateDebutInput}T00:00:00`)
    const finSaisie = new Date(`${dateFinInput}T00:00:00`)
    if (Number.isNaN(debut.getTime()) || Number.isNaN(finSaisie.getTime())) return
    const fin = new Date(finSaisie)
    fin.setDate(fin.getDate() + 1)

    const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    setPeriodeLabel(`${fmt(debut)} → ${fmt(finSaisie)}`)
    setAgendaOuvert(false)
    void chargerRdv(currentEmail, currentName, blgPartnerId, debut, fin)
  }

  function openRdvDetail(r: RdvUnifie) {
    const startDate = r.start_date ? new Date(r.start_date) : null
    const endDate = r.end_date ? new Date(r.end_date) : null
    const fmtTime = (d: Date | null) => (d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
    const peutNaviguer = Boolean(r.numero_tiers && onOpenClient)
    const activityId = r.source === 'compagnon' ? r.compagnon_id : r.blg_activity_id
    const aTacheEnCours = Boolean(r.numero_tiers && tachesEnCoursParTiers.has(r.numero_tiers))
    setOpenDetail({
      title: r.subject,
      subtitle: `${RDV_TYPE_LABELS[r.type] || r.type || 'Activité'}${r.source === 'compagnon' ? ' · RDV compagnon' : ''}`,
      fields: [
        ...(r.company_name ? [{ label: 'Entreprise', value: r.company_name }] : []),
        { label: 'Début', value: r.all_day ? (startDate ? startDate.toLocaleDateString('fr-FR') : '') : fmtTime(startDate) },
        { label: 'Fin', value: r.all_day ? (endDate ? endDate.toLocaleDateString('fr-FR') : '') : fmtTime(endDate) },
        ...(r.lieu ? [{ label: 'Lieu', value: r.lieu }] : []),
      ],
      footer: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {aTacheEnCours && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, border: '1px solid rgba(230,159,74,0.4)', background: 'rgba(230,159,74,0.12)', padding: '10px 12px' }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <span style={{ fontSize: 12.5, color: '#E8A96A' }}>Une tâche non terminée est en cours pour ce client — engagement pris à ne pas oublier avant ce rendez-vous.</span>
            </div>
          )}
          {peutNaviguer && (
            <button
              type="button"
              onClick={() => {
                setOpenDetail(null)
                onOpenClient?.(r.numero_tiers as string, r.company_name || '')
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '13px', borderRadius: 12, border: '1px solid rgba(75,146,172,0.4)',
                background: 'rgba(75,146,172,0.14)', color: '#8FC7DA', fontSize: 14, fontWeight: 700,
              }}
            >
              Voir la fiche client
            </button>
          )}
          <CompteRenduBlock
            activityId={activityId}
            numeroTiers={r.numero_tiers}
            rdvLabel={r.subject}
            currentEmail={currentEmail}
            currentName={currentName}
            onSaved={() => void rafraichirPeriode()}
          />
          {r.numero_tiers && (
            <VoiceReportButtons
              numeroTiers={r.numero_tiers}
              clientNom={r.company_name || ''}
              rdvActivityId={activityId || undefined}
              rdvLabel={r.subject}
              userEmail={currentEmail}
              userName={currentName}
            />
          )}
        </div>
      ),
    })
  }

  function openResultDetail(r: DocResult) {
    setOpenDetail({
      title: r.numero || '(sans numéro)',
      subtitle: r.type || 'Document',
      fields: [
        { label: 'Type', value: r.type },
        { label: 'N° de pièce', value: r.numero },
        { label: 'Client', value: r.tiers },
        { label: 'Référence', value: r.reference },
        { label: 'Date', value: r.date ? formatDateFr(r.date) : '' },
        { label: 'Montant HT', value: r.montant_ht ? formatMoney(r.montant_ht) : '' },
      ],
    })
  }

  async function runSearch() {
    const q = term.trim()
    if (!q) {
      setResults(null)
      return
    }
    setLoading(true)
    try {
      const calls: Promise<Record<string, any>[]>[] = []
      SEARCH_TABLES.forEach((table) => {
        SEARCH_FIELDS.forEach((f) => calls.push(searchByField(table, f.key, q)))
      })
      const rawResultsPerCall = await Promise.all(calls)

      const merged = new Map<string, DocResult>()
      rawResultsPerCall.flat().forEach((row) => {
        const numero = safeText(pick(row, ['numero_piece', 'numero_document', 'num_piece']))
        const type = safeText(row.type_document)
        const tiers = safeText(pick(row, ['numero_tiers_entete']))
        const key = `${type}-${numero}-${tiers}`
        if (merged.has(key)) return
        merged.set(key, {
          key,
          type,
          numero,
          tiers,
          reference: safeText(pick(row, ['reference_article', 'reference'])),
          date: normalizeDateIso(pick(row, [
            'date_document', 'date_facture', 'date_piece',
            'date_bl', 'date_piece_bl', 'date_livraison_bl', 'date_livraison',
            'date_devis',
          ])),
          montant_ht: Number(row.montant_ht || 0),
        })
      })
      setResults(Array.from(merged.values()).slice(0, 40))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '16px 3px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.10)',
          background: 'rgba(255,255,255,0.04)',
          padding: '14px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
            Rendez-vous — {periodeLabel}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setNouveauRdvOuvert(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
                border: '1px solid rgba(63,145,66,0.4)', background: 'rgba(63,145,66,0.14)',
                color: '#8fd4a8', fontSize: 12.5, fontWeight: 700,
              }}
            >
              + RDV
            </button>
            <button
              type="button"
              onClick={() => setAgendaOuvert(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
                border: '1px solid rgba(75,146,172,0.4)', background: 'rgba(75,146,172,0.14)',
                color: '#8FC7DA', fontSize: 12.5, fontWeight: 700,
              }}
            >
              Agenda
            </button>
          </div>
        </div>

        {rdvLoading ? (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
        ) : !rdvList || rdvList.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Aucun rendez-vous sur cette période ({periodeLabel}).</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rdvList.map((r) => {
              const color = RDV_TYPE_COLORS[r.type] || '#7A5EA8'
              const d = r.start_date ? new Date(r.start_date) : null
              const dateLabel = d
                ? r.all_day
                  ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
                  : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : ''
              const aTacheEnCours = Boolean(r.numero_tiers && tachesEnCoursParTiers.has(r.numero_tiers))
              return (
                <div
                  key={r.rdv_id}
                  onClick={() => openRdvDetail(r)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12,
                    border: aTacheEnCours ? '1px solid rgba(230,159,74,0.45)' : '1px solid rgba(255,255,255,0.08)',
                    background: aTacheEnCours ? 'rgba(230,159,74,0.07)' : 'rgba(255,255,255,0.03)',
                    padding: '9px 12px', cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {r.company_name && (
                      <div
                        onClick={(e) => {
                          if (r.numero_tiers && onOpenClient) {
                            e.stopPropagation()
                            onOpenClient(r.numero_tiers, r.company_name as string)
                          }
                        }}
                        style={{
                          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em',
                          color: '#E8A96A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          textDecoration: r.numero_tiers && onOpenClient ? 'underline' : 'none',
                          textUnderlineOffset: 2,
                        }}
                      >
                        {r.company_name}
                      </div>
                    )}
                    <div style={{ fontSize: 14.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {r.a_compte_rendu && <span title="Compte-rendu disponible" style={{ fontSize: 11 }}>[CR]</span>}
                      {aTacheEnCours && <span title="Tâche non terminée en cours pour ce client" style={{ fontSize: 13, flexShrink: 0 }}>⚠️</span>}
                      {r.subject}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                      {[RDV_TYPE_LABELS[r.type] || r.type, dateLabel, r.source === 'compagnon' ? 'Compagnon' : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
          Rechercher un document
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="N° de pièce, référence chantier, n° client…"
            style={{
              flex: 1,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              padding: '11px 13px',
              fontSize: 14.5,
              outline: 'none',
            }}
          />
          <button
            onClick={runSearch}
            style={{
              borderRadius: 12,
              border: '1px solid rgba(166,161,129,0.4)',
              background: 'rgba(166,161,129,0.15)',
              color: '#e4dfc9',
              padding: '0 16px',
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            Chercher
          </button>
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Recherche…</div>
          ) : results === null ? null : results.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Aucun document trouvé.</div>
          ) : (
            results.map((r) => (
              <div
                key={r.key}
                onClick={() => openResultDetail(r)}
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: '#fff' }}>{r.numero || '—'}</span>
                  {r.montant_ht > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
                      {formatMoney(r.montant_ht)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
                  {[r.type, r.tiers && `Client ${r.tiers}`, r.date && formatDateFr(r.date), r.reference]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {agendaOuvert && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(6,10,18,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setAgendaOuvert(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Choisir une période</div>

            <div>
              <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                Raccourcis
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => selectionnerPeriode('semaine_derniere')} style={periodeChipStyle(periodeLabel === 'Semaine dernière')}>
                  Semaine dernière
                </button>
                <button type="button" onClick={() => selectionnerPeriode('semaine_courante')} style={periodeChipStyle(periodeLabel === 'Cette semaine')}>
                  Cette semaine
                </button>
                <button type="button" onClick={() => selectionnerPeriode('semaine_prochaine')} style={periodeChipStyle(periodeLabel === 'Semaine prochaine')}>
                  Semaine prochaine
                </button>
                <button type="button" onClick={() => selectionnerPeriode('defaut')} style={periodeChipStyle(periodeLabel === '30 prochains jours')}>
                  30 prochains jours
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                Dates libres (passées ou futures)
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="date"
                  value={dateDebutInput}
                  onChange={(e) => setDateDebutInput(e.target.value)}
                  style={{ flex: 1, height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 13.5 }}
                />
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>→</span>
                <input
                  type="date"
                  value={dateFinInput}
                  onChange={(e) => setDateFinInput(e.target.value)}
                  style={{ flex: 1, height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 13.5 }}
                />
              </div>
              <button
                type="button"
                onClick={appliquerPeriodePersonnalisee}
                disabled={!dateDebutInput || !dateFinInput}
                style={{
                  marginTop: 10, width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                  background: dateDebutInput && dateFinInput ? '#A6A181' : 'rgba(166,161,129,0.3)',
                  color: '#141A26', fontSize: 14, fontWeight: 700,
                }}
              >
                Voir cette période
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAgendaOuvert(false)}
              style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {nouveauRdvOuvert && (
        <NouveauRdvSheet
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setNouveauRdvOuvert(false)}
          onCreated={() => void rafraichirPeriode()}
        />
      )}

      {openDetail && (
        <MobileDetailSheet
          title={openDetail.title}
          subtitle={openDetail.subtitle}
          fields={openDetail.fields}
          footer={openDetail.footer}
          onClose={() => setOpenDetail(null)}
        />
      )}
    </div>
  )
}

function periodeChipStyle(actif: boolean): React.CSSProperties {
  return {
    padding: '9px 14px', borderRadius: 999, border: `1px solid ${actif ? 'rgba(75,146,172,0.6)' : 'rgba(255,255,255,0.15)'}`,
    background: actif ? 'rgba(75,146,172,0.3)' : 'rgba(255,255,255,0.04)',
    color: '#fff', fontSize: 13, fontWeight: 600,
  }
}

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
  // FIX (2026-08) : bouton de suppression ajouté côté mobile -- il n'existait
  // que dans OutlookAgenda.tsx (desktop). Voir aussi la note ci-dessous sur
  // supprimer() : même correctif que côté desktop (vérification réelle du
  // nombre de lignes supprimées, indispensable avec Supabase/RLS).
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!activityId) { setLoading(false); return }
      setLoading(true)
      const { data } = await supabase
        .from('client_comptes_rendus')
        .select('id, resume, created_by_name, created_at')
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
          .insert({
            numero_tiers: numeroTiers,
            rdv_activity_id: activityId,
            rdv_label: rdvLabel,
            created_by_email: currentEmail,
            created_by_name: currentName,
            resume: resumeEdit,
            transcript: null,
          })
          .select('id, resume, created_by_name, created_at')
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

  /** FIX (2026-08) : `.select('id')` ajouté après le `.delete()` -- sans ça,
   * Supabase ne signale AUCUNE erreur quand une policy RLS bloque la
   * suppression (0 ligne réellement supprimée, error === null). Le code
   * vidait alors l'UI comme si ça avait marché, alors que rien n'était
   * supprimé en base (le compte-rendu réapparaissait à la réouverture).
   * Voir la même note dans OutlookAgenda.tsx (RdvDetailModal). */
  async function supprimer() {
    if (!compteRendu) return
    if (!window.confirm('Supprimer ce compte-rendu ? Cette action est définitive.')) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const { data, error: err } = await supabase
        .from('client_comptes_rendus')
        .delete()
        .eq('id', compteRendu.id)
        .select('id')
      if (err) throw err
      if (!data || data.length === 0) {
        throw new Error("Suppression refusée par la base (droits insuffisants) — le compte-rendu n'a pas été supprimé.")
      }
      setCompteRendu(null)
      setResumeEdit('')
      onSaved()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  if (!activityId) return null

  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.5)' }}>Compte-rendu</span>
        {!editMode && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setEditMode(true)}
              style={{ border: 'none', background: 'rgba(166,161,129,0.18)', color: '#e4dfc9', fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}
            >
              {compteRendu ? 'Modifier' : '+ Ajouter'}
            </button>
            {compteRendu && (
              <button
                type="button"
                onClick={() => void supprimer()}
                disabled={deleting}
                style={{ border: 'none', background: 'rgba(193,104,60,0.18)', color: '#e0a685', fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, opacity: deleting ? 0.5 : 1 }}
              >
                {deleting ? '…' : '🗑 Supprimer'}
              </button>
            )}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
      ) : editMode ? (
        <div>
          <textarea
            value={resumeEdit}
            onChange={(e) => setResumeEdit(e.target.value)}
            rows={5}
            placeholder="Résumé du rendez-vous…"
            autoFocus
            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 13.5, resize: 'vertical' }}
          />
          {error && <div style={{ fontSize: 12, color: '#e0a685', marginTop: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => void enregistrer()}
              disabled={saving}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 13, fontWeight: 700 }}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => { setEditMode(false); setResumeEdit(compteRendu?.resume || '') }}
              disabled={saving}
              style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : compteRendu ? (
        <div>
          <p style={{ fontSize: 13, color: '#fff', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{compteRendu.resume || '(résumé vide)'}</p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
            {compteRendu.created_by_name ? `Par ${compteRendu.created_by_name} · ` : ''}{new Date(compteRendu.created_at).toLocaleString('fr-FR')}
          </p>
          {deleteError && <p style={{ fontSize: 12, color: '#e0a685', marginTop: 8 }}>{deleteError}</p>}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Aucun compte-rendu pour ce rendez-vous.</div>
      )}
    </div>
  )
}

function NouveauRdvSheet({
  currentEmail, currentName, onClose, onCreated,
}: { currentEmail: string; currentName: string; onClose: () => void; onCreated: () => void }) {
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<{ numero: string; intitule: string }[]>([])
  const [numeroTiers, setNumeroTiers] = useState<string | null>(null)
  const [intituleTiers, setIntituleTiers] = useState('')
  const [subject, setSubject] = useState('')
  const [type, setType] = useState<'meeting' | 'phoneCall' | 'reminder'>('meeting')
  const [date, setDate] = useState('')
  const [heure, setHeure] = useState('09:00')
  const [duree, setDuree] = useState(60)
  const [lieu, setLieu] = useState('')
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

  async function creer() {
    if (!subject.trim() || !date) { setError('Objet et date sont obligatoires.'); return }
    setSaving(true)
    setError('')
    try {
      const start = new Date(`${date}T${heure}:00`)
      const end = new Date(start.getTime() + duree * 60000)
      const { error: err } = await supabase.from('rdv_compagnon').insert({
        numero_tiers: numeroTiers,
        type,
        subject: subject.trim(),
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        all_day: false,
        lieu: lieu.trim() || null,
        created_by_email: currentEmail,
        created_by_name: currentName,
      })
      if (err) throw err
      onCreated()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la création du RDV.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2200, background: 'rgba(6,10,18,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !saving && onClose()}>
      <div style={{ width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Nouveau rendez-vous</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: -6 }}>RDV compagnon CEGECLIM — indépendant de BLG/Outlook</div>

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Client (facultatif)</div>
          <input
            value={numeroTiers ? `${intituleTiers} (${numeroTiers})` : clientSearch}
            onChange={(e) => { setClientSearch(e.target.value); setNumeroTiers(null) }}
            placeholder="Nom ou numéro du client…"
            style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}
          />
          {numeroTiers && (
            <button type="button" onClick={() => { setNumeroTiers(null); setClientSearch('') }} style={{ marginTop: 4, background: 'none', border: 'none', color: '#e0a685', fontSize: 11.5, fontWeight: 600, padding: 0 }}>Retirer</button>
          )}
          {clientResults.length > 0 && !numeroTiers && (
            <div style={{ marginTop: 6, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#0B1220', overflow: 'hidden' }}>
              {clientResults.map((c) => (
                <button
                  key={c.numero}
                  type="button"
                  onClick={() => { setNumeroTiers(c.numero); setIntituleTiers(c.intitule); setClientResults([]) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: '#fff', fontSize: 13.5 }}
                >
                  <span style={{ color: '#E8A96A', fontWeight: 700 }}>{c.numero}</span> · {c.intitule}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Objet</div>
          <textarea
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            rows={2}
            placeholder="Ex. : Visite chantier, appel de relance…"
            style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '10px', fontSize: 14.5, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Type</div>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}>
              <option value="meeting">RDV</option>
              <option value="phoneCall">Appel</option>
              <option value="reminder">Rappel</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Durée (min)</div>
            <input type="number" value={duree} onChange={(e) => setDuree(Number(e.target.value) || 60)} min={15} step={15} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Date</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Heure</div>
            <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>Lieu (facultatif)</div>
          <input value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Ex. : Chez le client, agence…" style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }} />
        </div>

        {error && <div style={{ fontSize: 13, color: '#e0a685' }}>{error}</div>}

        <button
          type="button"
          onClick={() => void creer()}
          disabled={saving}
          style={{ padding: '13px', borderRadius: 12, border: 'none', background: '#A6A181', color: '#141A26', fontSize: 14.5, fontWeight: 700 }}
        >
          {saving ? 'Création…' : 'Créer le RDV'}
        </button>
        <button
          type="button"
          onClick={() => !saving && onClose()}
          style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}
        >
          Annuler
        </button>
      </div>
    </div>
  )
}
