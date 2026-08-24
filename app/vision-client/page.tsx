'use client'

// app/vision-client/page.tsx
//
// Fiche client complète, ouverte en nouvel onglet depuis la Synthèse
// multi-clients (clic sur le numéro ou l'intitulé). Regroupe :
//   - carte d'identité (ref_tiers)
//   - CA mensuel N vs N-1, empilé par famille macro
//   - devis mensuel N vs N-1 (courbe)
//   - marge mensuelle N vs N-1, en % (courbe)
//   - encours de commandes (activité), mini-tableau
//   - KPI : CERFA non à jour, CDC en retard, factures en retard (fictif)
//   - visites (réelles, RDV BLG + compagnon CEGECLIM unifiés), cliquables
//   - tâches non terminées affectées au client
//
// V2 (cette révision) :
//   - Dernière/prochaine visite : REMPLACÉ le fictif par v_rdv_unifie
//     (RDV synchronisés BLG + RDV créés depuis l'app "compagnon
//     CEGECLIM", avant toute connexion BLG/Outlook -- cf. rdv_compagnon).
//   - Documents : ajout du champ "reference" (chantier/BC/devis client),
//     et clic sur un document -> fenêtre de détail.
//   - Clic sur une visite -> fenêtre de détail avec le compte-rendu
//     existant (client_comptes_rendus, rdv_activity_id), éditable à la
//     main directement ici.
//   - Bouton "+ Nouveau RDV" : crée un RDV "compagnon CEGECLIM"
//     (rdv_compagnon) pour ce client, avec possibilité d'y attacher un
//     compte-rendu tout de suite ou plus tard.
//   - Nouvelle section "Tâches non terminées" (todo_actions).
//   - Graphiques : légendes de famille macro agrandies, lecture densifiée
//     (plus de graduations, tracés plus marqués).

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

const FAMILY_MACROS = ['R/R', 'R/O', 'ECS', 'DRV', 'R_zone', 'Accessoire', 'PV', 'Autres']
const MACRO_COLORS: Record<string, string> = {
  'R/R': '#4B92AC',
  'R/O': '#C1683C',
  ECS: '#D69A4A',
  DRV: '#7A5EA8',
  R_zone: '#3F9142',
  Accessoire: '#8ba9be',
  PV: '#E0A961',
  Autres: '#94a3b8',
}
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']
const N = new Date().getFullYear()

const RDV_TYPE_KEYS = ['meeting', 'phoneCall', 'reminder', '4', '7', '9']
const RDV_TYPE_LABELS: Record<string, string> = {
  meeting: 'RDV', phoneCall: 'Appel', reminder: 'Rappel',
  '4': 'RDV', '7': 'Appel', '9': 'Rappel',
}

type Identity = {
  numero: string
  intitule: string
  siret: string | null
  code_naf: string | null
  adresse: string | null
  complement_adresse: string | null
  code_postal: string | null
  ville: string | null
  representant: string | null
  agence: string | null
  date_creation: string | null
  prospect: boolean | null
  mise_en_sommeil: boolean | null
  rge: string | null
  attestation_capacite: string | null
  capacite_expiration: string | null
  code_risque: string | null
  qualite_relationnelle: string | null
  encours_autorise: number | null
  solde_comptable: number | null
  portefeuille_bl_fa: number | null
  portefeuille_bc_pl: number | null
  objectif_ca: number | null
  lien_blg_tiers: string | null
}

type CaMensuelRow = { annee: number; mois: number; famille_macro: string; ca: number }
type DevisMensuelRow = { annee: number; mois: number; montant: number }
type MargeMensuelRow = { annee: number; mois: number; marge_pct: number | null }
type Encours = { encours_total: number; encours_by_macro: Record<string, number>; encours_by_type: Record<string, number> }
type DernierDocument = { type_document: string; numero_piece: string; date_piece: string | null; montant_ht: number; nb_lignes: number; reference: string | null }

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
  statut: string | null
  a_compte_rendu: boolean
}

type CompteRendu = {
  id: string
  resume: string | null
  transcript: string | null
  taches_detectees: unknown
  created_by_name: string | null
  created_at: string
}

type TacheClient = { id: string; description_action: string | null; status: string; due_date: string | null; assigned_to: string | null }

function safeNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatKEur(value: number | null | undefined): string {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((value || 0) / 1000)} K€`
}

function formatEur(value: number | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0)
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`
}

function formatDateFr(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTimeFr(value: string | null | undefined, allDay?: boolean): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return allDay
    ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const d = new Date(value + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Tooltip flottant partagé par les 3 graphes ───────────────────────────

type TooltipState = { x: number; y: number; lines: string[] } | null

function ChartTooltip({ tooltip }: { tooltip: TooltipState }) {
  if (!tooltip) return null
  return (
    <div className="chartTooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      {tooltip.lines.map((line, i) => (
        <div key={i} className={i === 0 ? 'chartTooltipTitle' : ''}>{line}</div>
      ))}
    </div>
  )
}

// ── Pastille d'évolution YTD vs N-1 (même date), colorée ─────────────────

function EvolutionBadge({ value, unit }: { value: number | null; unit: 'pct' | 'points' }) {
  if (value === null || !Number.isFinite(value)) return <span className="evolutionBadge neutral">—</span>
  const up = value >= 0
  const label = unit === 'pct'
    ? `${up ? '▲' : '▼'} ${Math.abs(value).toFixed(1)} %`
    : `${up ? '▲' : '▼'} ${Math.abs(value).toFixed(1)} pts`
  return <span className={`evolutionBadge ${up ? 'up' : 'down'}`}>{label}</span>
}

// ── Graphe CA mensuel : barres groupées N / N-1, empilées par famille macro ──

function MonthlyStackedCaChart({ rows }: { rows: CaMensuelRow[] }) {
  const width = 900
  const height = 320
  const padding = { top: 16, right: 16, bottom: 30, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState>(null)

  const byMonth = useMemo(() => {
    const out: Array<{ mois: number; n: Record<string, number>; n1: Record<string, number>; totalN: number; totalN1: number }> = []
    for (let m = 1; m <= 12; m++) {
      const n: Record<string, number> = {}
      const n1: Record<string, number> = {}
      FAMILY_MACROS.forEach((fm) => { n[fm] = 0; n1[fm] = 0 })
      rows.filter((r) => r.mois === m).forEach((r) => {
        const macro = FAMILY_MACROS.includes(r.famille_macro) ? r.famille_macro : 'Autres'
        if (r.annee === N) n[macro] = (n[macro] || 0) + r.ca
        else if (r.annee === N - 1) n1[macro] = (n1[macro] || 0) + r.ca
      })
      const totalN = Object.values(n).reduce((s, v) => s + v, 0)
      const totalN1 = Object.values(n1).reduce((s, v) => s + v, 0)
      out.push({ mois: m, n, n1, totalN, totalN1 })
    }
    return out
  }, [rows])

  const maxVal = Math.max(1, ...byMonth.map((m) => Math.max(m.totalN, m.totalN1)))
  const groupWidth = innerW / 12
  const barWidth = Math.min(22, groupWidth / 2 - 6)

  function y(v: number) {
    return padding.top + innerH - (v / maxVal) * innerH
  }

  function handleHover(e: React.MouseEvent, annee: number, mois: number, values: Record<string, number>, total: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const lines = [
      `${MONTH_LABELS[mois - 1]} ${annee} — ${formatEur(total)}`,
      ...FAMILY_MACROS.filter((fm) => (values[fm] || 0) > 0).map((fm) => `${fm} : ${formatEur(values[fm])}`),
    ]
    setTooltip({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 10, lines })
  }

  function stackedBar(x: number, values: Record<string, number>, annee: number, mois: number, total: number) {
    let cumulative = 0
    return (
      <g
        onMouseMove={(e) => handleHover(e, annee, mois, values, total)}
        onMouseLeave={() => setTooltip(null)}
        style={{ cursor: 'default' }}
      >
        {/* Rectangle invisible sur toute la hauteur : évite les trous de survol entre segments. */}
        <rect x={x} y={padding.top} width={barWidth} height={innerH} fill="transparent" />
        {FAMILY_MACROS.map((fm) => {
          const v = values[fm] || 0
          const yTop = y(cumulative + v)
          const yBottom = y(cumulative)
          cumulative += v
          if (v <= 0) return null
          return <rect key={fm} x={x} y={yTop} width={barWidth} height={Math.max(0, yBottom - yTop)} fill={MACRO_COLORS[fm]} opacity={annee === N ? 1 : 0.4} />
        })}
      </g>
    )
  }

  // "Densifie la lecture" : 5 graduations horizontales au lieu de 3, pour
  // repérer les valeurs plus facilement sans passer la souris partout.
  const ticks = [0, maxVal / 4, maxVal / 2, (maxVal * 3) / 4, maxVal]

  return (
    <div className="chartContainer" ref={containerRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? undefined : '3 3'} />
            <text x={padding.left - 6} y={y(t) + 3} fontSize={11} textAnchor="end" fill="#475569">{formatKEur(t)}</text>
          </g>
        ))}
        {byMonth.map((m, i) => {
          const groupX = padding.left + i * groupWidth + (groupWidth - barWidth * 2 - 4) / 2
          return (
            <g key={m.mois}>
              {stackedBar(groupX, m.n, N, m.mois, m.totalN)}
              {stackedBar(groupX + barWidth + 4, m.n1, N - 1, m.mois, m.totalN1)}
              <text x={groupX + barWidth + 2} y={height - padding.bottom + 14} fontSize={11} textAnchor="middle" fill="#334155">
                {MONTH_LABELS[m.mois - 1]}
              </text>
            </g>
          )
        })}
      </svg>
      <ChartTooltip tooltip={tooltip} />
      <div className="chartLegend">
        {FAMILY_MACROS.map((fm) => (
          <span key={fm}><span className="dot" style={{ background: MACRO_COLORS[fm] }} />{fm}</span>
        ))}
        <span className="legendSep">·</span>
        <span><span className="dot" style={{ background: '#111827' }} /> gauche = {N}</span>
        <span><span className="dot" style={{ background: '#94a3b8' }} /> droite = {N - 1}</span>
      </div>
    </div>
  )
}

// ── Graphe courbe générique, 2 séries (N / N-1) ──────────────────────────

function MonthlyLineChart({
  seriesN, seriesN1, color, formatValue,
}: {
  seriesN: number[]
  seriesN1: number[]
  color: string
  formatValue: (v: number) => string
}) {
  const width = 900
  const height = 220
  const padding = { top: 14, right: 16, bottom: 26, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState>(null)

  const maxVal = Math.max(1, ...seriesN, ...seriesN1)
  const minVal = Math.min(0, ...seriesN, ...seriesN1)
  const x = (i: number) => padding.left + (i / 11) * innerW
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH

  function path(series: number[]) {
    return series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
  }

  function handleHover(e: React.MouseEvent, i: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({
      x: e.clientX - rect.left + 14,
      y: e.clientY - rect.top + 10,
      lines: [MONTH_LABELS[i], `${N} : ${formatValue(seriesN[i])}`, `${N - 1} : ${formatValue(seriesN1[i])}`],
    })
  }

  // "Densifie la lecture" : 5 graduations au lieu de 3.
  const ticks = [minVal, minVal + (maxVal - minVal) * 0.25, minVal + (maxVal - minVal) * 0.5, minVal + (maxVal - minVal) * 0.75, maxVal]

  return (
    <div className="chartContainer" ref={containerRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? undefined : '3 3'} />
            <text x={padding.left - 6} y={y(t) + 3} fontSize={11} textAnchor="end" fill="#475569">{formatValue(t)}</text>
          </g>
        ))}
        <path d={path(seriesN1)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.4} />
        <path d={path(seriesN)} fill="none" stroke={color} strokeWidth={2.5} />
        {seriesN.map((v, i) => (
          <g key={i} onMouseMove={(e) => handleHover(e, i)} onMouseLeave={() => setTooltip(null)} style={{ cursor: 'default' }}>
            {/* Zone de survol invisible, plus large que le point pour rester facile à cibler à la souris. */}
            <rect x={x(i) - (innerW / 22)} y={padding.top} width={innerW / 11} height={innerH} fill="transparent" />
            <circle cx={x(i)} cy={y(v)} r={i === seriesN.length - 1 ? 4 : 2.5} fill={color} />
          </g>
        ))}
        {MONTH_LABELS.map((label, i) => (
          <text key={label} x={x(i)} y={height - 6} fontSize={11} textAnchor="middle" fill="#334155">{label}</text>
        ))}
      </svg>
      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}

// ── Fenêtre de détail générique (document ou visite) ─────────────────────

function DetailModal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle">{title}</div>
            {subtitle && <div className="modalSubtitle">{subtitle}</div>}
          </div>
          <button className="modalClose" onClick={onClose}>✕</button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="detailFieldRow">
      <span className="detailFieldLabel">{label}</span>
      <span className="detailFieldValue">{value}</span>
    </div>
  )
}

// ── Détail d'une visite : infos + compte-rendu (consultable/éditable) ────

function VisiteDetailModal({
  rdv, currentEmail, currentName, onClose,
}: {
  rdv: RdvUnifie
  currentEmail: string
  currentName: string
  onClose: () => void
}) {
  const [compteRendu, setCompteRendu] = useState<CompteRendu | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [resumeEdit, setResumeEdit] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const activityId = rdv.source === 'blg' ? rdv.blg_activity_id : rdv.compagnon_id
      const { data } = await supabase
        .from('client_comptes_rendus')
        .select('id, resume, transcript, taches_detectees, created_by_name, created_at')
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
  }, [rdv])

  async function enregistrerCompteRendu() {
    setSaving(true)
    setSaveError(null)
    try {
      const activityId = rdv.source === 'blg' ? rdv.blg_activity_id : rdv.compagnon_id
      if (compteRendu) {
        const { error } = await supabase.from('client_comptes_rendus').update({ resume: resumeEdit }).eq('id', compteRendu.id)
        if (error) throw error
        setCompteRendu({ ...compteRendu, resume: resumeEdit })
      } else {
        const { data, error } = await supabase
          .from('client_comptes_rendus')
          .insert({
            numero_tiers: rdv.numero_tiers,
            rdv_activity_id: activityId,
            rdv_label: rdv.subject,
            created_by_email: currentEmail,
            created_by_name: currentName,
            resume: resumeEdit,
            transcript: null,
          })
          .select('id, resume, transcript, taches_detectees, created_by_name, created_at')
          .single()
        if (error) throw error
        setCompteRendu(data as CompteRendu)
      }
      setEditMode(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DetailModal title={rdv.subject} subtitle={`${RDV_TYPE_LABELS[rdv.type] || rdv.type} · ${rdv.source === 'compagnon' ? 'RDV compagnon CEGECLIM' : 'Synchronisé BLG'}`} onClose={onClose}>
      <DetailField label="Entreprise" value={rdv.company_name || '—'} />
      <DetailField label="Début" value={formatDateTimeFr(rdv.start_date, rdv.all_day)} />
      <DetailField label="Fin" value={formatDateTimeFr(rdv.end_date, rdv.all_day)} />
      {rdv.lieu && <DetailField label="Lieu" value={rdv.lieu} />}

      <div className="crBlock">
        <div className="crBlockHeader">
          <span className="crBlockTitle">Compte-rendu</span>
          {!editMode && (
            <button className="crEditBtn" onClick={() => setEditMode(true)}>
              {compteRendu ? '✎ Modifier' : '+ Ajouter'}
            </button>
          )}
        </div>

        {loading ? (
          <p className="crMuted">Chargement…</p>
        ) : editMode ? (
          <div>
            <textarea
              className="crTextarea"
              value={resumeEdit}
              onChange={(e) => setResumeEdit(e.target.value)}
              rows={6}
              placeholder="Résumé du rendez-vous…"
              autoFocus
            />
            {saveError && <p className="crError">{saveError}</p>}
            <div className="crActions">
              <button className="crSaveBtn" onClick={() => void enregistrerCompteRendu()} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button className="crCancelBtn" onClick={() => { setEditMode(false); setResumeEdit(compteRendu?.resume || '') }} disabled={saving}>
                Annuler
              </button>
            </div>
          </div>
        ) : compteRendu ? (
          <div>
            <p className="crResume">{compteRendu.resume || '(résumé vide)'}</p>
            <p className="crMeta">
              {compteRendu.created_by_name ? `Par ${compteRendu.created_by_name} · ` : ''}
              {new Date(compteRendu.created_at).toLocaleString('fr-FR')}
            </p>
          </div>
        ) : (
          <p className="crMuted">Aucun compte-rendu pour ce rendez-vous.</p>
        )}
      </div>
    </DetailModal>
  )
}

// ── Détail d'un document ──────────────────────────────────────────────────

function DocumentDetailModal({ doc, onClose }: { doc: DernierDocument; onClose: () => void }) {
  return (
    <DetailModal title={doc.numero_piece} subtitle={doc.type_document} onClose={onClose}>
      <DetailField label="Date" value={formatDateFr(doc.date_piece)} />
      <DetailField label="Référence" value={doc.reference || '—'} />
      <DetailField label="Montant HT" value={formatEur(doc.montant_ht)} />
      <DetailField label="Nombre de lignes" value={String(doc.nb_lignes)} />
    </DetailModal>
  )
}

// ── Création d'un RDV "compagnon CEGECLIM" ────────────────────────────────

function NouveauRdvModal({
  numeroTiers, currentEmail, currentName, onClose, onCreated,
}: {
  numeroTiers: string
  currentEmail: string
  currentName: string
  onClose: () => void
  onCreated: () => void
}) {
  const [subject, setSubject] = useState('')
  const [type, setType] = useState<'meeting' | 'phoneCall' | 'reminder'>('meeting')
  const [date, setDate] = useState('')
  const [heure, setHeure] = useState('09:00')
  const [duree, setDuree] = useState(60)
  const [lieu, setLieu] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function creer() {
    if (!subject.trim() || !date) {
      setError('Objet et date sont obligatoires.')
      return
    }
    setSaving(true)
    setError(null)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DetailModal title="Nouveau rendez-vous" subtitle="RDV compagnon CEGECLIM — indépendant de BLG/Outlook" onClose={onClose}>
      <div className="formGrid">
        <label className="formField">
          <span>Objet</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. : Visite chantier, appel de relance…" autoFocus />
        </label>
        <label className="formField">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="meeting">RDV</option>
            <option value="phoneCall">Appel</option>
            <option value="reminder">Rappel</option>
          </select>
        </label>
        <label className="formField">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="formField">
          <span>Heure</span>
          <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
        </label>
        <label className="formField">
          <span>Durée (minutes)</span>
          <input type="number" value={duree} onChange={(e) => setDuree(Number(e.target.value) || 60)} min={15} step={15} />
        </label>
        <label className="formField">
          <span>Lieu (facultatif)</span>
          <input value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Ex. : Chez le client, agence…" />
        </label>
      </div>
      {error && <p className="crError">{error}</p>}
      <div className="crActions">
        <button className="crSaveBtn" onClick={() => void creer()} disabled={saving}>{saving ? 'Création…' : 'Créer le RDV'}</button>
        <button className="crCancelBtn" onClick={onClose} disabled={saving}>Annuler</button>
      </div>
    </DetailModal>
  )
}

// ── Composant principal ──────────────────────────────────────────────────

function VisionClientPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const numero = searchParams.get('numero') || ''

  const [identity, setIdentity] = useState<Identity | null>(null)
  const [caRows, setCaRows] = useState<CaMensuelRow[]>([])
  const [devisRows, setDevisRows] = useState<DevisMensuelRow[]>([])
  const [margeRows, setMargeRows] = useState<MargeMensuelRow[]>([])
  const [encours, setEncours] = useState<Encours | null>(null)
  const [cerfaKo, setCerfaKo] = useState<number | null>(null)
  const [cdcRetard, setCdcRetard] = useState<number | null>(null)
  const [derniersDocuments, setDerniersDocuments] = useState<DernierDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Visites réelles (v_rdv_unifie) + tâches non terminées.
  const [derniereVisite, setDerniereVisite] = useState<RdvUnifie | null>(null)
  const [prochaineVisite, setProchaineVisite] = useState<RdvUnifie | null>(null)
  const [taches, setTaches] = useState<TacheClient[]>([])

  const [currentEmail, setCurrentEmail] = useState('')
  const [currentName, setCurrentName] = useState('')

  const [openDoc, setOpenDoc] = useState<DernierDocument | null>(null)
  const [openVisite, setOpenVisite] = useState<RdvUnifie | null>(null)
  const [nouveauRdvOuvert, setNouveauRdvOuvert] = useState(false)

  // Recherche pour changer de client sans repasser par la Synthèse multi-clients.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ numero: string; intitule: string }>>([])
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    async function loadIdentity() {
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData.session?.user?.email?.toLowerCase()
      if (!email) return
      const { data: access } = await supabase.from('user_page_access').select('display_name').eq('email', email).maybeSingle()
      setCurrentEmail(email)
      setCurrentName(String(access?.display_name || '').trim() || email.split('@')[0])
    }
    void loadIdentity()
  }, [])

  async function loadVisites(numeroTiers: string) {
    const todayIso = new Date().toISOString()
    const [{ data: passees }, { data: futures }] = await Promise.all([
      supabase
        .from('v_rdv_unifie')
        .select('*')
        .eq('numero_tiers', numeroTiers)
        .lt('start_date', todayIso)
        .order('start_date', { ascending: false })
        .limit(1),
      supabase
        .from('v_rdv_unifie')
        .select('*')
        .eq('numero_tiers', numeroTiers)
        .gte('start_date', todayIso)
        .order('start_date', { ascending: true })
        .limit(1),
    ])
    setDerniereVisite(((passees || [])[0] as RdvUnifie) || null)
    setProchaineVisite(((futures || [])[0] as RdvUnifie) || null)
  }

  async function loadTaches(numeroTiers: string) {
    const { data } = await supabase
      .from('todo_actions')
      .select('id, description_action, status, due_date, assigned_to')
      .eq('numero_tiers', numeroTiers)
      .not('status', 'in', '("Terminé","Annulé")')
      .order('due_date', { ascending: true })
      .limit(30)
    setTaches((data || []) as TacheClient[])
  }

  useEffect(() => {
    if (!numero) { setLoading(false); setError('Aucun numéro de client fourni.'); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [identityRes, caRes, devisRes, margeRes, encoursRes, cerfaRes, cdcRes, derniersRes] = await Promise.all([
          supabase.rpc('get_vision_client_identity', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_ca_mensuel', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_devis_mensuel', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_marge_mensuel', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_encours', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_cerfa_ko', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_cdc_retard', { p_numero_tiers: numero }),
          supabase.rpc('get_vision_client_derniers_documents', { p_numero_tiers: numero, p_limit: 10 }),
        ])
        for (const r of [identityRes, caRes, devisRes, margeRes, encoursRes, cerfaRes, cdcRes, derniersRes]) {
          if (r.error) throw r.error
        }
        if (cancelled) return
        setIdentity((Array.isArray(identityRes.data) ? identityRes.data[0] : identityRes.data) || null)
        setCaRows((caRes.data || []) as CaMensuelRow[])
        setDevisRows((devisRes.data || []) as DevisMensuelRow[])
        setMargeRows((margeRes.data || []) as MargeMensuelRow[])
        const encoursRow = Array.isArray(encoursRes.data) ? encoursRes.data[0] : encoursRes.data
        setEncours(encoursRow || { encours_total: 0, encours_by_macro: {}, encours_by_type: {} })
        setCerfaKo(Number(cerfaRes.data) || 0)
        setCdcRetard(Number(cdcRes.data) || 0)
        setDerniersDocuments((derniersRes.data || []) as DernierDocument[])
        await Promise.all([loadVisites(numero), loadTaches(numero)])
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [numero])

  // Recherche client : débounce simple, sur numero ou intitule.
  useEffect(() => {
    const term = searchQuery.trim()
    if (term.length < 2) { setSearchResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      const { data, error: searchError } = await supabase
        .from('ref_tiers')
        .select('numero, intitule')
        .or(`numero.ilike.%${term}%,intitule.ilike.%${term}%`)
        .limit(8)
      if (cancelled || searchError) return
      setSearchResults((data || []) as Array<{ numero: string; intitule: string }>)
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery])

  function goToClient(nextNumero: string) {
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
    router.push(`/vision-client?numero=${encodeURIComponent(nextNumero)}`)
  }

  const devisSeriesN = useMemo(() => Array.from({ length: 12 }, (_, i) => devisRows.find((r) => r.annee === N && r.mois === i + 1)?.montant || 0), [devisRows])
  const devisSeriesN1 = useMemo(() => Array.from({ length: 12 }, (_, i) => devisRows.find((r) => r.annee === N - 1 && r.mois === i + 1)?.montant || 0), [devisRows])
  const margeSeriesN = useMemo(() => Array.from({ length: 12 }, (_, i) => devisNullToZero(margeRows.find((r) => r.annee === N && r.mois === i + 1)?.marge_pct)), [margeRows])
  const margeSeriesN1 = useMemo(() => Array.from({ length: 12 }, (_, i) => devisNullToZero(margeRows.find((r) => r.annee === N - 1 && r.mois === i + 1)?.marge_pct)), [margeRows])

  function devisNullToZero(v: number | null | undefined) {
    return v === null || v === undefined ? 0 : v
  }

  const derniersDevis = useMemo(() => derniersDocuments.filter((d) => d.type_document === 'Devis').slice(0, 10), [derniersDocuments])
  const dernieresCommandes = useMemo(() => derniersDocuments.filter((d) => d.type_document === 'Bon de commande').slice(0, 10), [derniersDocuments])
  const derniersBl = useMemo(() => derniersDocuments.filter((d) => d.type_document === 'Bon de livraison').slice(0, 10), [derniersDocuments])

  const currentMonth = new Date().getMonth() + 1

  // CA YTD : cumul jusqu'au mois en cours, N vs N-1 à la même date.
  const caYtdN = useMemo(() => caRows.filter((r) => r.annee === N && r.mois <= currentMonth).reduce((s, r) => s + r.ca, 0), [caRows, currentMonth])
  const caYtdN1 = useMemo(() => caRows.filter((r) => r.annee === N - 1 && r.mois <= currentMonth).reduce((s, r) => s + r.ca, 0), [caRows, currentMonth])
  const caYtdEvolPct = caYtdN1 !== 0 ? ((caYtdN - caYtdN1) / Math.abs(caYtdN1)) * 100 : null

  // Devis YTD : évolution en %.
  const devisYtdN = useMemo(() => devisSeriesN.slice(0, currentMonth).reduce((s, v) => s + v, 0), [devisSeriesN, currentMonth])
  const devisYtdN1 = useMemo(() => devisSeriesN1.slice(0, currentMonth).reduce((s, v) => s + v, 0), [devisSeriesN1, currentMonth])
  const devisYtdEvolPct = devisYtdN1 !== 0 ? ((devisYtdN - devisYtdN1) / Math.abs(devisYtdN1)) * 100 : null

  // Marge YTD : évolution en points (moyenne des % mensuels réellement renseignés jusqu'au mois en cours).
  const margeYtdMoyenne = (annee: number) => {
    const values = margeRows.filter((r) => r.annee === annee && r.mois <= currentMonth && r.marge_pct !== null).map((r) => r.marge_pct as number)
    if (!values.length) return null
    return values.reduce((s, v) => s + v, 0) / values.length
  }
  const margeYtdN = margeYtdMoyenne(N)
  const margeYtdN1 = margeYtdMoyenne(N - 1)
  const margeYtdEvolPoints = margeYtdN !== null && margeYtdN1 !== null ? margeYtdN - margeYtdN1 : null

  const capaciteJours = daysUntil(identity?.capacite_expiration)
  // Fictif, demandé explicitement — pas de colonne d'échéance de paiement
  // fiable dans facture_lignes pour calculer ce montant réellement.
  const facturesRetardFictif = 6840

  if (loading) {
    return <main className="page"><div className="loadingBox">Chargement de la fiche client…</div><style jsx>{pageStyles}</style></main>
  }

  if (error || !identity) {
    return (
      <main className="page">
        <header className="clientHeader">
          <div>
            <div className="eyebrow">Vision Client</div>
            <h1>{numero ? 'Client introuvable' : 'Choisir un client'}</h1>
            <p>{error || (numero ? `"${numero}" ne correspond à aucun client.` : 'Utilise la recherche pour ouvrir la fiche d\'un client.')}</p>
          </div>
          <div className="clientSearch">
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Rechercher un client — code ou nom…"
              className="clientSearchInput"
              autoFocus
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="clientSearchResults">
                {searchResults.map((r) => (
                  <button key={r.numero} type="button" className="clientSearchResult" onMouseDown={() => goToClient(r.numero)}>
                    <span className="mono">{r.numero}</span>
                    <span>{r.intitule}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>
        <style jsx>{pageStyles}</style>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="clientHeader">
        <div>
          <div className="eyebrow">Vision Client</div>
          <h1>{identity.intitule} <span className="numeroTag">{identity.numero}</span></h1>
          <p>{identity.representant || 'Représentant non renseigné'} · {identity.agence || 'Agence non renseignée'}</p>
        </div>

        {/* Recherche pour basculer sur un autre client sans repasser par la SMC. */}
        <div className="clientSearch">
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Changer de client — code ou nom…"
            className="clientSearchInput"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="clientSearchResults">
              {searchResults.map((r) => (
                <button key={r.numero} type="button" className="clientSearchResult" onMouseDown={() => goToClient(r.numero)}>
                  <span className="mono">{r.numero}</span>
                  <span>{r.intitule}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="newRdvBtn" onClick={() => setNouveauRdvOuvert(true)}>+ Nouveau RDV</button>

        {identity.lien_blg_tiers && (
          <a href={identity.lien_blg_tiers} target="_blank" rel="noopener noreferrer" className="blgLink">Ouvrir la fiche CRM ↗</a>
        )}
      </header>

      {/* ── Carte d'identité ── */}
      <section className="card">
        <h2>Carte d'identité</h2>
        <div className="identityGrid">
          <div><span>SIRET</span><strong>{identity.siret || '—'}</strong></div>
          <div><span>Code NAF</span><strong>{identity.code_naf || '—'}</strong></div>
          <div><span>Adresse</span><strong>{[identity.adresse, identity.complement_adresse].filter(Boolean).join(', ') || '—'}</strong></div>
          <div><span>Ville</span><strong>{[identity.code_postal, identity.ville].filter(Boolean).join(' ') || '—'}</strong></div>
          <div><span>Date création</span><strong>{formatDateFr(identity.date_creation)}</strong></div>
          <div><span>Statut</span><strong>{identity.prospect ? 'Prospect' : 'Client'}{identity.mise_en_sommeil ? ' · en sommeil' : ''}</strong></div>
          <div><span>RGE</span><strong className={identity.rge ? 'ok' : 'muted'}>{identity.rge || 'NON'}</strong></div>
          <div>
            <span>Capacité gaz</span>
            <strong className={capaciteJours !== null && capaciteJours < 30 ? 'danger' : capaciteJours !== null ? 'ok' : 'muted'}>
              {identity.attestation_capacite ? 'OUI' : 'NON'}{identity.capacite_expiration ? ` · exp. ${formatDateFr(identity.capacite_expiration)}` : ''}
            </strong>
          </div>
          <div><span>Code risque</span><strong>{identity.code_risque || '—'}</strong></div>
          <div><span>Qualité relationnelle</span><strong>{identity.qualite_relationnelle || '—'}</strong></div>
          <div><span>Encours autorisé</span><strong>{formatEur(identity.encours_autorise)}</strong></div>
          <div><span>Solde comptable</span><strong>{formatEur(identity.solde_comptable)}</strong></div>
          <div><span>Portefeuille BL/FA</span><strong>{formatEur(identity.portefeuille_bl_fa)}</strong></div>
          <div><span>Portefeuille BC/PL</span><strong>{formatEur(identity.portefeuille_bc_pl)}</strong></div>
          <div><span>Objectif CA {N}</span><strong>{identity.objectif_ca ? formatEur(identity.objectif_ca) : '—'}</strong></div>
        </div>
      </section>

      {/* ── KPI ── */}
      <section className="kpiRow">
        <a className="kpiCard" href={`/portefeuille-livraison?client=${encodeURIComponent(identity.numero)}`} target="_blank" rel="noopener noreferrer">
          <span>CERFA non à jour</span>
          <strong className={cerfaKo ? 'danger' : 'ok'}>{cerfaKo ?? 0}</strong>
        </a>
        <a className="kpiCard" href="/portefeuille-livraison" target="_blank" rel="noopener noreferrer">
          <span>CDC en retard de livraison</span>
          <strong className={cdcRetard ? 'danger' : 'ok'}>{cdcRetard ?? 0}</strong>
        </a>
        <div className="kpiCard">
          <span>Factures en retard de paiement <em className="fictifTag">fictif</em></span>
          <strong className="danger">{formatEur(facturesRetardFictif)}</strong>
        </div>
        <div className="kpiCard kpiCardVisites">
          <span>Visites</span>
          <div className="visitesLines">
            <div>
              <span className="visiteLabel">Dern. visite :</span>{' '}
              {derniereVisite ? (
                <button type="button" className="visiteDateLink" onClick={() => setOpenVisite(derniereVisite)}>
                  {formatDateTimeFr(derniereVisite.start_date, derniereVisite.all_day)}
                  {derniereVisite.a_compte_rendu && <span className="crDot" title="Compte-rendu disponible" />}
                </button>
              ) : (
                <span className="visiteDate muted">Non renseigné</span>
              )}
            </div>
            <div>
              <span className="visiteLabel">Proch. visite :</span>{' '}
              {prochaineVisite ? (
                <button type="button" className="visiteDateLink" onClick={() => setOpenVisite(prochaineVisite)}>
                  {formatDateTimeFr(prochaineVisite.start_date, prochaineVisite.all_day)}
                </button>
              ) : (
                <span className="visiteDate muted">Non renseigné</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tâches non terminées ── */}
      <section className="card">
        <h2>Tâches non terminées affectées à ce client</h2>
        {taches.length === 0 ? (
          <p className="emptyNote">Aucune tâche en cours pour ce client.</p>
        ) : (
          <table className="tachesTable">
            <thead>
              <tr><th>Description</th><th>Échéance</th><th>Assigné à</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {taches.map((t) => (
                <tr key={t.id}>
                  <td>{t.description_action || '(sans libellé)'}</td>
                  <td>{formatDateFr(t.due_date)}</td>
                  <td>{t.assigned_to || '—'}</td>
                  <td><span className="tacheStatut">{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── CA mensuel empilé + panneau YTD ── */}
      <div className="caChartRow">
        <section className="card caChartCard">
          <h2>CA mensuel par famille macro — {N} vs {N - 1}</h2>
          <MonthlyStackedCaChart rows={caRows} />
        </section>
        <section className="card caYtdCard">
          <h3>CA cumulé depuis le 1er janvier</h3>
          <div className="ytdBlock">
            <span className="ytdLabel">{N} (jusqu'au mois en cours)</span>
            <strong className="ytdValue">{formatEur(caYtdN)}</strong>
          </div>
          <div className="ytdBlock">
            <span className="ytdLabel">{N - 1} (même période)</span>
            <strong className="ytdValueSecondary">{formatEur(caYtdN1)}</strong>
          </div>
          <div className="ytdEvolWrap">
            <span className="ytdLabel">Évolution</span>
            <EvolutionBadge value={caYtdEvolPct} unit="pct" />
          </div>
        </section>
      </div>

      <div className="chartGrid">
        <section className="card">
          <div className="chartCardHeader">
            <h2>Devis mensuel — {N} vs {N - 1}</h2>
            <span className="chartCardHeaderRight">
              <span className="ytdMiniLabel">YTD vs N-1</span>
              <EvolutionBadge value={devisYtdEvolPct} unit="pct" />
            </span>
          </div>
          <MonthlyLineChart seriesN={devisSeriesN} seriesN1={devisSeriesN1} color="#D69A4A" formatValue={formatKEur} />
        </section>
        <section className="card">
          <div className="chartCardHeader">
            <h2>Marge mensuelle (%) — {N} vs {N - 1}</h2>
            <span className="chartCardHeaderRight">
              <span className="ytdMiniLabel">YTD vs N-1</span>
              <EvolutionBadge value={margeYtdEvolPoints} unit="points" />
            </span>
          </div>
          <MonthlyLineChart seriesN={margeSeriesN} seriesN1={margeSeriesN1} color="#7A5EA8" formatValue={(v) => `${v.toFixed(0)} %`} />
        </section>
      </div>

      {/* ── Encours de commandes ── */}
      <section className="card">
        <h2>Encours de commandes (activité)</h2>
        <div className="encoursTotal">{formatKEur(encours?.encours_total)}</div>
        <div className="encoursTables">
          <table>
            <thead><tr><th>Famille macro</th><th>Encours</th></tr></thead>
            <tbody>
              {FAMILY_MACROS.map((fm) => (
                <tr key={fm}>
                  <td><span className="dot" style={{ background: MACRO_COLORS[fm] }} />{fm}</td>
                  <td className="num">{formatKEur(encours?.encours_by_macro?.[fm])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead><tr><th>Type de document</th><th>Encours</th></tr></thead>
            <tbody>
              {['BL-BR', 'PL', 'CDC'].map((type) => (
                <tr key={type}>
                  <td>{type}</td>
                  <td className="num">{formatKEur(encours?.encours_by_type?.[type])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Derniers documents ── */}
      <section className="card">
        <h2>Derniers documents</h2>
        <div className="documentsGrid">
          <DocumentsMiniTable title="Derniers devis" rows={derniersDevis} accent="#D69A4A" onOpen={setOpenDoc} />
          <DocumentsMiniTable title="Dernières commandes" rows={dernieresCommandes} accent="#4B92AC" onOpen={setOpenDoc} />
          <DocumentsMiniTable title="Derniers BL" rows={derniersBl} accent="#3F9142" onOpen={setOpenDoc} />
        </div>
      </section>

      {openDoc && <DocumentDetailModal doc={openDoc} onClose={() => setOpenDoc(null)} />}
      {openVisite && (
        <VisiteDetailModal rdv={openVisite} currentEmail={currentEmail} currentName={currentName} onClose={() => setOpenVisite(null)} />
      )}
      {nouveauRdvOuvert && (
        <NouveauRdvModal
          numeroTiers={identity.numero}
          currentEmail={currentEmail}
          currentName={currentName}
          onClose={() => setNouveauRdvOuvert(false)}
          onCreated={() => void loadVisites(identity.numero)}
        />
      )}

      <style jsx>{pageStyles}</style>
    </main>
  )
}

function DocumentsMiniTable({
  title, rows, accent, onOpen,
}: { title: string; rows: DernierDocument[]; accent: string; onOpen: (d: DernierDocument) => void }) {
  return (
    <div className="documentsMiniTable" style={{ borderTopColor: accent }}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="documentsEmpty">Aucun document.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Pièce</th><th>Date</th><th>Référence</th><th className="num">Montant HT</th><th className="num">Lignes</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.numero_piece} onClick={() => onOpen(row)} className="documentRow">
                <td className="mono">{row.numero_piece}</td>
                <td>{formatDateFr(row.date_piece)}</td>
                <td className="documentReference">{row.reference || '—'}</td>
                <td className="num">{formatEur(row.montant_ht)}</td>
                <td className="num">{row.nb_lignes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// useSearchParams() exige une frontière Suspense pour le pré-rendu (build
// Next.js) — sans ça, `next build` échoue avec "Error occurred prerendering
// page /vision-client". Le composant réel reste inchangé, seul l'export par
// défaut change pour l'envelopper.
export default function VisionClientPage() {
  return (
    <Suspense fallback={<main className="page"><div className="loadingBox">Chargement de la fiche client…</div><style jsx>{pageStyles}</style></main>}>
      <VisionClientPageInner />
    </Suspense>
  )
}

const pageStyles = `
  .page { padding: 20px 28px 40px; background: #f6f8fb; min-height: 100vh; color: #0f172a; width: 100%; }
  .loadingBox, .errorBox { background: white; border-radius: 14px; padding: 40px; text-align: center; font-weight: 800; color: #64748b; }
  .errorBox { color: #991b1b; background: #fee2e2; }
  .clientHeader { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
  .clientHeader > div:first-child { flex: 1 1 auto; min-width: 0; }
  .eyebrow { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; }
  h1 { margin: 2px 0 4px; font-size: 26px; font-weight: 900; letter-spacing: -0.02em; }
  .numeroTag { font-family: monospace; font-size: 15px; font-weight: 700; color: #64748b; background: #e2e8f0; border-radius: 6px; padding: 2px 8px; margin-left: 8px; vertical-align: middle; }
  .clientHeader p { margin: 0; color: #64748b; font-size: 13px; font-weight: 700; }
  .blgLink { align-self: center; background: #0f172a; color: white; border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 800; text-decoration: none; white-space: nowrap; }
  .newRdvBtn { align-self: center; background: #2E5BB8; color: white; border: none; border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 800; white-space: nowrap; cursor: pointer; }
  .newRdvBtn:hover { background: #244a96; }
  .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
  .card h2 { margin: 0 0 12px; font-size: 15px; font-weight: 900; }
  .emptyNote { margin: 0; font-size: 12.5px; color: #94a3b8; font-style: italic; }
  .identityGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 18px; }
  .identityGrid div { min-width: 0; }
  .identityGrid span { display: block; font-size: 10px; font-weight: 900; text-transform: uppercase; color: #94a3b8; margin-bottom: 2px; }
  .identityGrid strong { display: block; font-size: 13px; font-weight: 800; color: #0f172a; overflow: hidden; text-overflow: ellipsis; }
  .identityGrid strong.ok { color: #047857; }
  .identityGrid strong.danger { color: #dc2626; }
  .identityGrid strong.muted { color: #94a3b8; }
  .kpiRow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .kpiCard { display: block; background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(15,23,42,.05); text-decoration: none; color: inherit; }
  .kpiCard span { display: block; font-size: 11px; font-weight: 900; text-transform: uppercase; color: #64748b; }
  .kpiCard strong { display: block; margin-top: 4px; font-size: 22px; font-weight: 950; }
  .kpiCard strong.ok { color: #047857; }
  .kpiCard strong.danger { color: #dc2626; }
  .fictifTag { font-style: normal; font-size: 9px; font-weight: 900; text-transform: uppercase; background: #fde68a; color: #92400e; border-radius: 999px; padding: 1px 6px; margin-left: 6px; }
  .chartGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* "Densifie la lecture" : légendes de famille macro nettement agrandies */
  .chartLegend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; font-size: 13px; font-weight: 700; color: #334155; align-items: center; }
  .chartLegend span { display: inline-flex; align-items: center; gap: 6px; }
  .chartLegend .dot { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
  .legendSep { color: #cbd5e1; }

  .encoursTotal { font-size: 26px; font-weight: 950; margin-bottom: 10px; }
  .encoursTables { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .encoursTables table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .encoursTables th { text-align: left; font-size: 10px; text-transform: uppercase; color: #94a3b8; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
  .encoursTables td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; }
  .encoursTables td.num { text-align: right; font-weight: 800; }
  .encoursTables .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 6px; }
  .documentsGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .documentsMiniTable { border-top: 3px solid #cbd5e1; padding-top: 10px; min-width: 0; }
  .documentsMiniTable h3 { margin: 0 0 8px; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  .documentsMiniTable table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .documentsMiniTable th { text-align: left; font-size: 9.5px; text-transform: uppercase; color: #94a3b8; padding: 3px 5px; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
  .documentsMiniTable td { padding: 5px; border-bottom: 1px solid #f1f5f9; }
  .documentsMiniTable td.num, .documentsMiniTable th.num { text-align: right; }
  .documentsMiniTable td.mono { font-family: monospace; font-weight: 700; }
  .documentReference { color: #64748b; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .documentRow { cursor: pointer; }
  .documentRow:hover { background: #f8fafc; }
  .documentsEmpty { font-size: 12px; color: #94a3b8; font-style: italic; margin: 0; }

  /* ── Tâches non terminées ── */
  .tachesTable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .tachesTable th { text-align: left; font-size: 10px; text-transform: uppercase; color: #94a3b8; padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 800; }
  .tachesTable td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; }
  .tacheStatut { display: inline-block; font-size: 10.5px; font-weight: 800; background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 2px 8px; }

  /* ── Recherche client (en-tête) ── */
  .clientSearch { position: relative; flex: 0 0 300px; }
  .clientSearchInput { width: 100%; height: 40px; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0 12px; font-size: 13px; outline: none; background: white; }
  .clientSearchInput:focus { border-color: #0f172a; }
  .clientSearchResults { position: absolute; top: 44px; left: 0; right: 0; z-index: 20; background: white; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 12px 30px rgba(15,23,42,.15); overflow: hidden; max-height: 320px; overflow-y: auto; }
  .clientSearchResult { display: flex; gap: 10px; align-items: baseline; width: 100%; text-align: left; padding: 8px 12px; border: 0; background: white; cursor: pointer; font-size: 12.5px; border-bottom: 1px solid #f1f5f9; }
  .clientSearchResult:hover { background: #f1f5f9; }
  .clientSearchResult .mono { font-family: monospace; font-weight: 800; color: #64748b; flex-shrink: 0; }

  /* ── Pavé visites (réel) ── */
  .kpiCardVisites { }
  .visitesLines { margin-top: 4px; font-size: 12px; font-weight: 700; color: #0f172a; }
  .visitesLines div { margin-top: 6px; white-space: nowrap; }
  .visiteDate { font-size: 15px; font-weight: 900; margin-left: 2px; }
  .visiteDate.muted { color: #94a3b8; font-weight: 700; }
  .visiteDateLink { font-size: 14px; font-weight: 900; margin-left: 2px; background: none; border: none; color: #2E5BB8; cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 2px; display: inline-flex; align-items: center; gap: 5px; }
  .visiteDateLink:hover { color: #1a3f8a; }
  .visiteLabel { color: #64748b; font-weight: 800; text-transform: uppercase; font-size: 10px; margin-right: 4px; }
  .crDot { width: 7px; height: 7px; border-radius: 999px; background: #D69A4A; display: inline-block; }

  /* ── Rangée CA mensuel + panneau YTD ── */
  .caChartRow { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; align-items: stretch; margin-bottom: 16px; }
  .caChartCard { margin-bottom: 0; }
  .caYtdCard { margin-bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
  .caYtdCard h3 { margin: 0 0 4px; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  .ytdBlock { display: flex; flex-direction: column; gap: 2px; }
  .ytdLabel { font-size: 10.5px; font-weight: 800; text-transform: uppercase; color: #94a3b8; }
  .ytdValue { font-size: 24px; font-weight: 950; color: #0f172a; }
  .ytdValueSecondary { font-size: 17px; font-weight: 800; color: #64748b; }
  .ytdEvolWrap { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px dashed #e2e8f0; }

  /* ── En-têtes de graphe avec pastille d'évolution YTD ── */
  .chartCardHeader { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
  .chartCardHeader h2 { margin: 0; }
  .chartCardHeaderRight { display: inline-flex; align-items: center; gap: 6px; }
  .ytdMiniLabel { font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #94a3b8; }

  /* ── Pastille d'évolution, code couleur ── */
  .evolutionBadge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 900; white-space: nowrap; }
  .evolutionBadge.up { background: #dcfce7; color: #047857; }
  .evolutionBadge.down { background: #fee2e2; color: #dc2626; }
  .evolutionBadge.neutral { background: #e5e7eb; color: #64748b; }

  /* ── Conteneurs de graphe + tooltip flottant au survol ── */
  .chartContainer { position: relative; }
  .chartTooltip { position: absolute; z-index: 30; background: #0f172a; color: white; border-radius: 8px; padding: 8px 10px; font-size: 11px; line-height: 1.5; pointer-events: none; white-space: nowrap; box-shadow: 0 10px 24px rgba(15,23,42,.35); }
  .chartTooltipTitle { font-weight: 900; margin-bottom: 2px; }

  /* ── Fenêtres de détail (document / visite / nouveau RDV) ── */
  .modalOverlay { position: fixed; inset: 0; z-index: 100; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modalCard { background: white; border-radius: 16px; width: 100%; max-width: 480px; max-height: 85vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(15,23,42,.3); }
  .modalHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 12px; border-bottom: 1px solid #f1f5f9; }
  .modalTitle { font-size: 17px; font-weight: 900; color: #0f172a; }
  .modalSubtitle { font-size: 12px; font-weight: 700; color: #64748b; margin-top: 2px; }
  .modalClose { border: none; background: #f1f5f9; color: #64748b; width: 28px; height: 28px; border-radius: 999px; font-size: 14px; cursor: pointer; flex-shrink: 0; }
  .modalClose:hover { background: #e2e8f0; }
  .modalBody { padding: 16px 20px 20px; }
  .detailFieldRow { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f8fafc; font-size: 13px; }
  .detailFieldLabel { color: #64748b; font-weight: 800; }
  .detailFieldValue { color: #0f172a; font-weight: 700; text-align: right; }

  /* ── Compte-rendu (visite) ── */
  .crBlock { margin-top: 16px; padding-top: 14px; border-top: 1px dashed #e2e8f0; }
  .crBlockHeader { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .crBlockTitle { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  .crEditBtn { border: none; background: #eef2ff; color: #3730a3; font-size: 11.5px; font-weight: 800; padding: 5px 10px; border-radius: 8px; cursor: pointer; }
  .crEditBtn:hover { background: #e0e7ff; }
  .crMuted { font-size: 12.5px; color: #94a3b8; font-style: italic; margin: 0; }
  .crResume { font-size: 13.5px; color: #0f172a; line-height: 1.6; white-space: pre-wrap; margin: 0 0 6px; }
  .crMeta { font-size: 11px; color: #94a3b8; margin: 0; }
  .crTextarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; }
  .crTextarea:focus { border-color: #2E5BB8; }
  .crError { color: #dc2626; font-size: 12px; font-weight: 700; margin: 6px 0 0; }
  .crActions { display: flex; gap: 8px; margin-top: 10px; }
  .crSaveBtn { border: none; background: #0f172a; color: white; font-size: 12.5px; font-weight: 800; padding: 9px 16px; border-radius: 9px; cursor: pointer; }
  .crSaveBtn:disabled { opacity: .5; cursor: not-allowed; }
  .crCancelBtn { border: 1px solid #e2e8f0; background: white; color: #64748b; font-size: 12.5px; font-weight: 800; padding: 9px 16px; border-radius: 9px; cursor: pointer; }

  /* ── Formulaire "Nouveau RDV" ── */
  .formGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .formField { display: flex; flex-direction: column; gap: 5px; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #64748b; }
  .formField input, .formField select { height: 38px; border: 1px solid #cbd5e1; border-radius: 9px; padding: 0 10px; font-size: 13px; font-weight: 600; color: #0f172a; text-transform: none; outline: none; font-family: inherit; }
  .formField input:focus, .formField select:focus { border-color: #2E5BB8; }
`
