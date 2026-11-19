'use client'

// ============================================================================
// app/piliers/page.tsx — Réunion Piliers / Feuille de route (19/11/2026)
// ----------------------------------------------------------------------------
// Rubrique réservée aux membres de la réunion mensuelle des Piliers.
//   1. Prochaine réunion : déroulé guidé — météo, revue des actions de la
//      réunion précédente (par porteur), nouveaux sujets à qualifier,
//      communication aux équipes, clôture et date de la suivante.
//   2. Feuille de route : tous les sujets, en colonnes par statut, en liste
//      ou par porteur, avec filtres (impact CA, irritants, en retard…).
//   3. Entre deux réunions : remonter un sujet / une question, donner une
//      nouvelle sur un sujet, fil de ce qui a bougé depuis la dernière réunion.
//   4. Communication : ce qu'on dit aux collaborateurs, et à qui.
//   5. Réunions passées : comptes rendus (copie, envoi par mail).
// Données : tables piliers_* (supabase/migrations/20261119a_reunion_piliers.sql),
// accès limité aux membres par RLS ; référentiels dans lib/piliers.ts.
// ============================================================================

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import {
  COM_CIBLES,
  COM_STATUTS,
  ENJEUX,
  ISSUES,
  MOODS,
  NATURES,
  OPEN_STATUTS,
  PRIORITES,
  RESSENTIS,
  STATUTS,
  SUIVI_TYPES,
  addDaysIso,
  daysBetween,
  fmtDate,
  fmtDateLong,
  fmtDateTime,
  estInfo,
  isOpen,
  prioriteAttendue,
  isOverdue,
  refOf,
  scoreSujet,
  todayIso,
  type ComStatut,
  type Origine,
  type Issue,
  type Membre,
  type Meteo,
  type Nature,
  type Porteur,
  type Reunion,
  type ReunionSujet,
  type Ressenti,
  type Statut,
  type Suivi,
  type SuiviType,
  type Sujet,
} from '@/lib/piliers'

// ----------------------------------------------------------------------------
// Couleurs (variables du thème clair / sombre — app/theme.css)
// ----------------------------------------------------------------------------
const C = {
  ink: 'var(--cg-ink)',
  muted: 'rgba(var(--cg-ink-rgb), 0.64)',
  faint: 'rgba(var(--cg-ink-rgb), 0.42)',
  line: 'rgba(var(--cg-ink-rgb), 0.12)',
  lineStrong: 'rgba(var(--cg-ink-rgb), 0.22)',
  soft: 'rgba(var(--cg-ink-rgb), 0.04)',
  soft2: 'rgba(var(--cg-ink-rgb), 0.07)',
  card: 'var(--cg-surface)',
  card2: 'var(--cg-surface-2)',
  accent: '#7A5EA8',
  alert: '#C1683C',
  ok: '#2E7D5B',
  gold: '#C9A227',
}
const FONT_TITLE = '"Space Grotesk", "IBM Plex Sans", system-ui, sans-serif'
const FONT_BODY = '"IBM Plex Sans", system-ui, sans-serif'

type Tab = 'reunion' | 'feuille' | 'entre' | 'com' | 'historique'

// ----------------------------------------------------------------------------
// Contexte de l'écran (données + actions)
// ----------------------------------------------------------------------------
type NewSujetInput = {
  titre: string
  contexte: string
  nature: Nature
  impacte_ca?: boolean
  domaine?: string
  pilote_id?: string | null
  statut?: Statut
  reunion_origine?: string | null
  parent_id?: string | null
  origine?: Origine
  prochain_point?: string | null
  /** Membre qui met le sujet à l'ODJ (défaut : moi). */
  propose_par?: string | null
  confidentiel?: boolean
}

type Api = {
  email: string | null
  me: Membre | null
  membres: Membre[]
  membresActifs: Membre[]
  membreById: Map<string, Membre>
  sujets: Sujet[]
  sujetById: Map<string, Sujet>
  porteurs: Porteur[]
  suivis: Suivi[]
  reunions: Reunion[]
  meteo: Meteo[]
  reunionSujets: ReunionSujet[]
  prochaine: Reunion | null
  derniere: Reunion | null
  depuis: string | null
  nameOfEmail: (email: string | null | undefined) => string
  porteursOf: (sujetId: string) => { membre: Membre; role: 'pilote' | 'contributeur' }[]
  suivisOf: (sujetId: string) => Suivi[]
  openSujet: (id: string) => void
  updateSujet: (sujet: Sujet, patch: Partial<Sujet>, reunionId?: string | null) => Promise<boolean>
  addSuivi: (sujetId: string, type: SuiviType, texte: string, reunionId?: string | null) => Promise<boolean>
  setPorteurs: (sujetId: string, list: { membre_id: string; role: 'pilote' | 'contributeur' }[]) => Promise<boolean>
  createSujet: (input: NewSujetInput) => Promise<Sujet | null>
  reload: () => Promise<void>
  notify: (msg: string, kind?: 'ok' | 'err') => void
}

const PiliersCtx = createContext<Api | null>(null)
function useApi() {
  const api = useContext(PiliersCtx)
  if (!api) throw new Error('PiliersCtx manquant')
  return api
}

// ============================================================================
// Page
// ============================================================================
export default function PiliersPage() {
  const { email, loading: accessLoading } = useAccess()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('reunion')
  const [membres, setMembres] = useState<Membre[]>([])
  const [sujets, setSujets] = useState<Sujet[]>([])
  const [porteurs, setPorteursState] = useState<Porteur[]>([])
  const [suivis, setSuivis] = useState<Suivi[]>([])
  const [reunions, setReunions] = useState<Reunion[]>([])
  const [meteo, setMeteo] = useState<Meteo[]>([])
  const [reunionSujets, setReunionSujets] = useState<ReunionSujet[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState(false)
  const [showMembres, setShowMembres] = useState(false)
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)

  const notify = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind })
    window.setTimeout(() => setToast(null), kind === 'err' ? 6000 : 2600)
  }, [])

  const reload = useCallback(async () => {
    const [m, s, p, sv, r, mt, rs] = await Promise.all([
      supabase.from('piliers_membres').select('*').order('ordre'),
      supabase.from('piliers_sujets').select('*').order('numero'),
      supabase.from('piliers_sujet_porteurs').select('*'),
      supabase.from('piliers_suivis').select('*').order('created_at', { ascending: false }),
      supabase.from('piliers_reunions').select('*').order('date_reunion', { ascending: false }),
      supabase.from('piliers_meteo').select('*'),
      supabase.from('piliers_reunion_sujets').select('*'),
    ])
    const firstError = [m, s, p, sv, r, mt, rs].find((res) => res.error)?.error
    if (firstError) {
      setError(firstError.message)
    } else {
      setError(null)
    }
    setMembres((m.data || []) as Membre[])
    setSujets(((s.data || []) as Sujet[]).map((row) => ({ ...row, enjeux: row.enjeux || [] })))
    setPorteursState((p.data || []) as Porteur[])
    setSuivis((sv.data || []) as Suivi[])
    setReunions((r.data || []) as Reunion[])
    setMeteo((mt.data || []) as Meteo[])
    setReunionSujets((rs.data || []) as ReunionSujet[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (accessLoading) return
    void reload()
  }, [accessLoading, reload])

  // --------------------------------------------------------------- dérivés
  const membreById = useMemo(() => new Map(membres.map((m) => [m.id, m])), [membres])
  const membresActifs = useMemo(() => membres.filter((m) => m.actif), [membres])
  const sujetById = useMemo(() => new Map(sujets.map((s) => [s.id, s])), [sujets])
  const me = useMemo(
    () => membres.find((m) => m.email && email && m.email.toLowerCase() === email.toLowerCase()) || null,
    [membres, email],
  )
  const prochaine = useMemo(() => {
    const open = reunions.filter((r) => r.statut !== 'cloturee')
    return open.sort((a, b) => a.date_reunion.localeCompare(b.date_reunion))[0] || null
  }, [reunions])
  const derniere = useMemo(() => {
    const closed = reunions.filter((r) => r.statut === 'cloturee')
    return closed.sort((a, b) => b.date_reunion.localeCompare(a.date_reunion))[0] || null
  }, [reunions])
  const depuis = derniere ? derniere.cloturee_le || `${derniere.date_reunion}T23:59:59` : null

  const nameOfEmail = useCallback(
    (mail: string | null | undefined) => {
      if (!mail) return '—'
      const m = membres.find((x) => x.email && x.email.toLowerCase() === mail.toLowerCase())
      return m ? m.prenom : mail.split('@')[0]
    },
    [membres],
  )

  const porteursOf = useCallback(
    (sujetId: string) =>
      porteurs
        .filter((p) => p.sujet_id === sujetId && membreById.has(p.membre_id))
        .map((p) => ({ membre: membreById.get(p.membre_id)!, role: p.role }))
        .sort((a, b) => (a.role === 'pilote' ? -1 : b.role === 'pilote' ? 1 : a.membre.ordre - b.membre.ordre)),
    [porteurs, membreById],
  )

  const suivisOf = useCallback((sujetId: string) => suivis.filter((s) => s.sujet_id === sujetId), [suivis])

  // --------------------------------------------------------------- actions
  const addSuivi = useCallback(
    async (sujetId: string, type: SuiviType, texte: string, reunionId: string | null = null) => {
      const t = texte.trim()
      if (!t) return false
      const { error: e } = await supabase.from('piliers_suivis').insert({ sujet_id: sujetId, type, texte: t, reunion_id: reunionId })
      if (e) {
        notify(`Enregistrement impossible : ${e.message}`, 'err')
        return false
      }
      return true
    },
    [notify],
  )

  const updateSujet = useCallback(
    async (sujet: Sujet, patch: Partial<Sujet>, reunionId: string | null = null) => {
      const clean: Record<string, unknown> = { ...patch }
      ;['id', 'numero', 'created_at', 'created_by', 'updated_at', 'updated_by', 'clos_le'].forEach((k) => delete clean[k])
      const { error: e } = await supabase.from('piliers_sujets').update(clean).eq('id', sujet.id)
      if (e) {
        notify(`Enregistrement impossible : ${e.message}`, 'err')
        return false
      }
      if (patch.statut && patch.statut !== sujet.statut) {
        const from = refOf(STATUTS, sujet.statut)?.label || sujet.statut
        const to = refOf(STATUTS, patch.statut)?.label || patch.statut
        await supabase.from('piliers_suivis').insert({ sujet_id: sujet.id, type: 'statut', texte: `${from} → ${to}`, reunion_id: reunionId })
      }
      return true
    },
    [notify],
  )

  const setPorteurs = useCallback(
    async (sujetId: string, list: { membre_id: string; role: 'pilote' | 'contributeur' }[]) => {
      const del = await supabase.from('piliers_sujet_porteurs').delete().eq('sujet_id', sujetId)
      if (del.error) {
        notify(`Porteurs non enregistrés : ${del.error.message}`, 'err')
        return false
      }
      if (list.length) {
        const ins = await supabase.from('piliers_sujet_porteurs').insert(list.map((p) => ({ ...p, sujet_id: sujetId })))
        if (ins.error) {
          notify(`Porteurs non enregistrés : ${ins.error.message}`, 'err')
          return false
        }
      }
      return true
    },
    [notify],
  )

  const createSujet = useCallback(
    async (input: NewSujetInput) => {
      const titre = input.titre.trim()
      if (!titre) return null
      const { data, error: e } = await supabase
        .from('piliers_sujets')
        .insert({
          titre,
          contexte: input.contexte.trim(),
          nature: input.nature,
          impacte_ca: !!input.impacte_ca,
          domaine: input.domaine || '',
          statut: input.statut || 'a_aborder',
          reunion_origine: input.reunion_origine || null,
          parent_id: input.parent_id || null,
          origine: input.origine || 'remonte',
          prochain_point: input.prochain_point || null,
          propose_par: input.propose_par === undefined ? me?.id || null : input.propose_par,
          confidentiel: !!input.confidentiel,
        })
        .select('*')
        .single()
      if (e || !data) {
        notify(`Création impossible : ${e?.message || 'erreur inconnue'}`, 'err')
        return null
      }
      if (input.pilote_id) {
        await supabase.from('piliers_sujet_porteurs').insert({ sujet_id: (data as Sujet).id, membre_id: input.pilote_id, role: 'pilote' })
      }
      return data as Sujet
    },
    [notify, me],
  )

  const api: Api = {
    email,
    me,
    membres,
    membresActifs,
    membreById,
    sujets,
    sujetById,
    porteurs,
    suivis,
    reunions,
    meteo,
    reunionSujets,
    prochaine,
    derniere,
    depuis,
    nameOfEmail,
    porteursOf,
    suivisOf,
    openSujet: setOpenId,
    updateSujet,
    addSuivi,
    setPorteurs,
    createSujet,
    reload,
    notify,
  }

  // --------------------------------------------------------------- KPI
  const today = todayIso()
  const ouverts = sujets.filter((s) => OPEN_STATUTS.includes(s.statut))
  const aAborder = sujets.filter((s) => s.statut === 'a_aborder')
  const enRetard = sujets.filter((s) => isOverdue(s, today))
  const impactCa = sujets.filter((s) => isOpen(s) && s.impacte_ca)
  const irritants = sujets.filter((s) => isOpen(s) && s.ressenti === 'irritant')
  const mesSujets = me ? sujets.filter((s) => isOpen(s) && porteurs.some((p) => p.sujet_id === s.id && p.membre_id === me.id)) : []

  if (loading || accessLoading) {
    return <div style={{ padding: 40, color: C.muted, fontFamily: FONT_BODY }}>Chargement de la feuille de route…</div>
  }

  if (!me) {
    return (
      <div style={{ padding: 40, fontFamily: FONT_BODY, color: C.ink, maxWidth: 640 }}>
        <h1 style={{ fontFamily: FONT_TITLE, fontSize: 24, margin: '0 0 12px' }}>Réunion Piliers / Feuille de route</h1>
        <p style={{ color: C.muted, lineHeight: 1.6 }}>
          Cette rubrique est réservée aux membres de la réunion des Piliers. Si vous devez y avoir accès, demandez à un animateur de vous ajouter.
        </p>
        {error && <p style={{ color: C.alert }}>{error}</p>}
      </div>
    )
  }

  const joursAvant = prochaine ? daysBetween(today, prochaine.date_reunion) : null

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'reunion', label: prochaine ? 'Prochaine réunion' : 'Réunion' },
    { key: 'feuille', label: 'Feuille de route', count: ouverts.length + aAborder.length },
    { key: 'entre', label: 'Entre deux réunions' },
    { key: 'com', label: 'Communication', count: sujets.filter((s) => s.a_communiquer && s.communication_statut !== 'diffuse').length },
    { key: 'historique', label: 'Réunions passées', count: reunions.filter((r) => r.statut === 'cloturee').length },
  ]

  return (
    <PiliersCtx.Provider value={api}>
      <div style={{ fontFamily: FONT_BODY, color: C.ink, padding: '20px 24px 80px', maxWidth: 1480, margin: '0 auto' }}>
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ flex: '1 1 420px' }}>
            <div style={{ fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.accent, fontWeight: 700 }}>Réunion Piliers</div>
            <h1 style={{ fontFamily: FONT_TITLE, fontSize: 28, margin: '2px 0 6px', fontWeight: 700 }}>Feuille de route CEGECLIM</h1>
            <div style={{ color: C.muted, fontSize: 14 }}>
              {prochaine ? (
                <>
                  Prochaine réunion <b style={{ color: C.ink }}>{fmtDateLong(prochaine.date_reunion)}</b>
                  {joursAvant !== null && (
                    <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, background: C.soft2, fontSize: 12 }}>
                      {joursAvant > 0 ? `dans ${joursAvant} j` : joursAvant === 0 ? 'aujourd’hui' : `il y a ${-joursAvant} j`}
                    </span>
                  )}
                  {' · '}
                  {aAborder.length} sujet{aAborder.length > 1 ? 's' : ''} remonté{aAborder.length > 1 ? 's' : ''} · {ouverts.length} action
                  {ouverts.length > 1 ? 's' : ''} à revoir
                </>
              ) : (
                'Aucune réunion planifiée'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Btn onClick={() => setShowMembres(true)} title="Membres de la réunion">
              👥 {membresActifs.length} membres
            </Btn>
            <Btn primary big onClick={() => setQuickAdd(true)}>
              ＋ Remonter un sujet
            </Btn>
          </div>
        </div>

        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 18 }}>
          <Kpi label="À aborder" value={aAborder.length} hint="Remontés, pas encore vus" color={C.gold} onClick={() => setTab('reunion')} />
          <Kpi label="Actions ouvertes" value={ouverts.length} hint="À planifier, en cours, en attente" color="#4E7A2A" onClick={() => setTab('feuille')} />
          <Kpi label="Point dépassé" value={enRetard.length} hint="Nouvelle attendue non donnée" color={C.alert} alarm={enRetard.length > 0} onClick={() => setTab('feuille')} />
          <Kpi label="⚡ Impacte le CA" value={impactCa.length} hint="Sujets ouverts" color="#245A9E" onClick={() => setTab('feuille')} />
          <Kpi label="🔥 Irritants" value={irritants.length} hint="Ressentis par les équipes" color={C.alert} onClick={() => setTab('feuille')} />
          <Kpi label={`Mes sujets · ${me.prenom}`} value={mesSujets.length} hint="Où je suis porteur" color={me.couleur} onClick={() => setTab('entre')} />
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`, marginBottom: 20, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderBottom: `3px solid ${tab === t.key ? C.accent : 'transparent'}`,
                background: 'transparent',
                color: tab === t.key ? C.ink : C.muted,
                fontWeight: tab === t.key ? 700 : 500,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: FONT_BODY,
              }}
            >
              {t.label}
              {t.count ? <span style={{ marginLeft: 6, fontSize: 12, padding: '1px 7px', borderRadius: 999, background: C.soft2 }}>{t.count}</span> : null}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${C.alert}`, color: C.alert, marginBottom: 16 }}>
            Erreur de lecture : {error}
          </div>
        )}

        {tab === 'reunion' && <TabReunion />}
        {tab === 'feuille' && <TabFeuille />}
        {tab === 'entre' && <TabEntre onQuickAdd={() => setQuickAdd(true)} />}
        {tab === 'com' && <TabCom />}
        {tab === 'historique' && <TabHistorique />}

        {openId && sujetById.get(openId) && <SujetDrawer key={openId} sujet={sujetById.get(openId)!} onClose={() => setOpenId(null)} />}
        {quickAdd && <QuickAddModal onClose={() => setQuickAdd(false)} />}
        {showMembres && <MembresModal onClose={() => setShowMembres(false)} />}

        {toast && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 18px',
              borderRadius: 10,
              background: toast.kind === 'err' ? C.alert : '#0B1220',
              color: '#fff',
              fontSize: 14,
              zIndex: 1300,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </PiliersCtx.Provider>
  )
}

// ============================================================================
// Onglet 1 — Prochaine réunion (déroulé)
// ============================================================================
function TabReunion() {
  const api = useApi()
  const { prochaine, sujets, reunionSujets, membresActifs, derniere } = api
  const [dateNouvelle, setDateNouvelle] = useState(() => addDaysIso(derniere?.date_reunion || todayIso(), derniere ? 28 : 7))
  const [busy, setBusy] = useState(false)

  if (!prochaine) {
    const enAttente = sujets.filter((s) => s.statut === 'a_aborder').length
    return (
      <Card style={{ maxWidth: 620 }}>
        <h2 style={h2}>Planifier la prochaine réunion</h2>
        <p style={{ color: C.muted, lineHeight: 1.6, marginTop: 0 }}>
          L’ordre du jour se construit tout seul : la météo, la revue des actions en cours, puis les {enAttente} sujet
          {enAttente > 1 ? 's' : ''} remonté{enAttente > 1 ? 's' : ''} entre deux réunions.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={dateNouvelle} onChange={(e) => setDateNouvelle(e.target.value)} style={input} />
          <Btn
            primary
            disabled={busy || !dateNouvelle}
            onClick={async () => {
              setBusy(true)
              const { error } = await supabase.from('piliers_reunions').insert({ date_reunion: dateNouvelle })
              setBusy(false)
              if (error) api.notify(error.message, 'err')
              else {
                api.notify('Réunion planifiée')
                await api.reload()
              }
            }}
          >
            Planifier
          </Btn>
        </div>
      </Card>
    )
  }

  const R = prochaine
  const revusIci = reunionSujets.filter((rs) => rs.reunion_id === R.id)
  const issueOf = (sujetId: string) => revusIci.find((rs) => rs.sujet_id === sujetId) || null

  // 2. Revue : actions ouvertes + celles déjà revues dans cette réunion
  const revue = sujets.filter((s) => {
    const rs = issueOf(s.id)
    if (rs) return !['qualifie', 'pour_info'].includes(rs.issue) && !(rs.issue === 'abandonne' && s.reunion_origine === R.id)
    // les actions nées pendant cette réunion seront revues à la suivante
    return OPEN_STATUTS.includes(s.statut) && s.reunion_origine !== R.id
  })
  // 3. Nouveaux sujets proposés (demandes) : remontés entre deux réunions ou
  // pendant le tour de météo, + ceux déjà tranchés dans cette réunion. Les
  // actions tirées d'un sujet restent rattachées à leur sujet.
  const nouveaux = sujets.filter((s) => {
    if (s.origine === 'action_liee') return false
    const rs = issueOf(s.id)
    if (rs) return ['qualifie', 'pour_info'].includes(rs.issue) || (rs.issue === 'abandonne' && s.reunion_origine === R.id)
    return s.statut === 'a_aborder'
  })

  const revueFaits = revue.filter((s) => issueOf(s.id)).length
  // (19/11/2026) Clôture bloquée tant que chaque sujet de la réunion n'est pas tranché
  // (statut) et priorisé (sauf info, fait, abandonné).
  const vus = new Set<string>()
  const blocages: { sujet: Sujet; statut: boolean; priorite: boolean }[] = []
  ;[...revue, ...nouveaux, ...sujets.filter((s) => s.reunion_origine === R.id)].forEach((s) => {
    if (vus.has(s.id)) return
    vus.add(s.id)
    const rs = issueOf(s.id)
    const statut = !rs && (revue.includes(s) || nouveaux.includes(s))
    const priorite = prioriteAttendue(s) && !s.priorite && rs?.issue !== 'abandonne'
    if (statut || priorite) blocages.push({ sujet: s, statut, priorite })
  })
  const nouveauxFaits = nouveaux.filter((s) => issueOf(s.id)).length
  const meteoFaite = api.meteo.filter((m) => m.reunion_id === R.id && m.humeur).length
  const total = revue.length + nouveaux.length
  const fait = revueFaits + nouveauxFaits
  const pct = total ? Math.round((fait / total) * 100) : 0

  // Revue groupée par pilote (ordre des membres), puis « sans pilote »
  const groupes: { membre: Membre | null; items: Sujet[] }[] = []
  membresActifs.forEach((m) => {
    const items = revue.filter((s) => api.porteursOf(s.id).find((p) => p.role === 'pilote')?.membre.id === m.id)
    if (items.length) groupes.push({ membre: m, items: items.sort((a, b) => scoreSujet(b) - scoreSujet(a) || a.numero - b.numero) })
  })
  const sansPilote = revue.filter((s) => !api.porteursOf(s.id).some((p) => p.role === 'pilote' && p.membre.actif))
  if (sansPilote.length) groupes.push({ membre: null, items: sansPilote })

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Bandeau réunion */}
        <Card style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', borderLeft: `5px solid ${C.accent}` }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontFamily: FONT_TITLE, fontSize: 20, fontWeight: 700, textTransform: 'capitalize' }}>{fmtDateLong(R.date_reunion)}</div>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
              {R.statut === 'en_cours' ? '🟢 Réunion en cours' : '🗓️ En préparation — chacun peut remonter ses sujets jusqu’au jour J'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={() => document.getElementById('pil-nouveaux')?.scrollIntoView({ behavior: 'smooth' })} style={{ ...chipBase, borderColor: C.gold, color: C.ink, fontWeight: 700 }}>
                📥 {nouveaux.length} nouveau{nouveaux.length > 1 ? 'x' : ''} sujet{nouveaux.length > 1 ? 's' : ''} proposé{nouveaux.length > 1 ? 's' : ''}
              </button>
              <button onClick={() => document.getElementById('pil-revue')?.scrollIntoView({ behavior: 'smooth' })} style={{ ...chipBase, borderColor: '#4E7A2A', color: C.ink, fontWeight: 700 }}>
                🔁 {revue.length} action{revue.length > 1 ? 's' : ''} en suivi
              </button>
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: C.muted }}>
            ✍️ Rédacteur (rédige et clôture)
            <select
              value={R.redacteur_id || ''}
              onChange={async (e) => {
                await supabase.from('piliers_reunions').update({ redacteur_id: e.target.value || null }).eq('id', R.id)
                await api.reload()
              }}
              style={{ ...input, borderColor: R.redacteur_id ? C.lineStrong : C.alert, minWidth: 170 }}
            >
              <option value="">— à désigner —</option>
              {membresActifs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.prenom}
                </option>
              ))}
            </select>
          </label>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
              {fait} / {total} sujets traités
            </div>
            <div style={{ height: 8, borderRadius: 99, background: C.soft2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: C.accent, transition: 'width .3s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="date"
              defaultValue={R.date_reunion}
              onBlur={async (e) => {
                if (e.target.value && e.target.value !== R.date_reunion) {
                  await supabase.from('piliers_reunions').update({ date_reunion: e.target.value }).eq('id', R.id)
                  await api.reload()
                }
              }}
              style={{ ...input, width: 150 }}
              title="Déplacer la réunion"
            />
            {R.statut === 'preparation' && (
              <Btn
                primary
                onClick={async () => {
                  await supabase.from('piliers_reunions').update({ statut: 'en_cours' }).eq('id', R.id)
                  await api.reload()
                }}
              >
                ▶ Démarrer
              </Btn>
            )}
          </div>
        </Card>

        <Step id="pil-meteo" n={1} title="Météo" subtitle="Cliquez sur la personne qui parle : son humeur, et les sujets qu’elle met à l’ordre du jour, saisis à la volée.">
          <MeteoGrid reunion={R} />
        </Step>

        <Step
          id="pil-revue"
          n={2}
          title="Suivi des actions en cours"
          subtitle={
            derniere
              ? `Actions déjà connues : ce qui a bougé depuis la réunion du ${fmtDate(derniere.date_reunion, { day: 'numeric', month: 'long' })}, porteur par porteur.`
              : 'Actions déjà connues, porteur par porteur.'
          }
        >
          {groupes.length === 0 && <Empty>Aucune action ouverte. Les sujets pris en charge aujourd’hui apparaîtront ici à la prochaine réunion.</Empty>}
          {groupes.map((g) => (
            <div key={g.membre?.id || 'sans'} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 10px' }}>
                {g.membre ? <Avatar membre={g.membre} size={30} /> : <span style={{ fontSize: 20 }}>❔</span>}
                <div style={{ fontWeight: 700, fontSize: 15 }}>{g.membre ? g.membre.prenom : 'Sans pilote'}</div>
                <div style={{ color: C.faint, fontSize: 13 }}>{g.membre?.role}</div>
                <div style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
                  {g.items.filter((s) => issueOf(s.id)).length} / {g.items.length}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.items.map((s) => (
                  <ReviewCard key={s.id} sujet={s} reunion={R} revu={issueOf(s.id)} />
                ))}
              </div>
            </div>
          ))}
        </Step>

        <Step id="pil-nouveaux" n={3} title="Nouveaux sujets proposés" subtitle="Les demandes mises à l’ordre du jour (entre deux réunions ou pendant la météo) : on tranche le statut et la priorité, ligne par ligne.">
          <OdjListe sujets={[...nouveaux].sort((a, b) => a.numero - b.numero)} reunion={R} />
          <InlineAdd reunion={R} />
        </Step>

        <Step id="pil-com" n={4} title="Communication aux équipes" subtitle="Qu’est-ce qu’on dit aux collaborateurs à la suite de cette réunion ?">
          <ComStep reunion={R} revus={revusIci} />
        </Step>

        <Step id="pil-cloture" n={5} title="Clôture" subtitle="Synthèse en quelques lignes et date de la prochaine réunion.">
          <Cloture reunion={R} blocages={blocages} stats={{ revueFaits, revueTotal: revue.length, nouveauxFaits, nouveauxTotal: nouveaux.length, meteoFaite }} />
        </Step>
      </div>

      {/* Sommaire collant */}
      <div style={{ position: 'sticky', top: 16 }}>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 10 }}>Ordre du jour</div>
          {[
            { id: 'pil-meteo', label: '1. Météo', done: meteoFaite, tot: membresActifs.length },
            { id: 'pil-revue', label: '2. Revue des actions', done: revueFaits, tot: revue.length },
            { id: 'pil-nouveaux', label: '3. Nouveaux sujets', done: nouveauxFaits, tot: nouveaux.length },
            { id: 'pil-com', label: '4. Communication', done: -1, tot: 0 },
            { id: 'pil-cloture', label: '5. Clôture', done: -1, tot: 0 },
          ].map((it) => (
            <button
              key={it.id}
              onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                display: 'flex',
                width: '100%',
                justifyContent: 'space-between',
                padding: '8px 6px',
                border: 'none',
                background: 'transparent',
                color: C.ink,
                cursor: 'pointer',
                fontSize: 14,
                borderRadius: 6,
                fontFamily: FONT_BODY,
              }}
            >
              <span>{it.label}</span>
              {it.done >= 0 && (
                <span style={{ color: it.tot && it.done >= it.tot ? C.ok : C.muted, fontSize: 12 }}>
                  {it.tot && it.done >= it.tot ? '✓' : `${it.done}/${it.tot}`}
                </span>
              )}
            </button>
          ))}
        </Card>
      </div>
    </div>
  )
}

function Step({ id, n, title, subtitle, children }: { id: string; n: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 99,
            background: C.accent,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            flex: '0 0 auto',
            fontFamily: FONT_TITLE,
          }}
        >
          {n}
        </span>
        <div>
          <h2 style={{ ...h2, margin: 0 }}>{title}</h2>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- 1. Météo
// (19/11/2026, v3) On clique sur la personne qui parle : sa tuile s'ouvre en un
// petit tableau des sujets qu'elle met à l'ordre du jour (déjà proposés ou
// saisis à la volée sur les lignes vides). Ces sujets alimentent la liste
// « Nouveaux sujets proposés » de l'étape 3.
function MeteoGrid({ reunion }: { reunion: Reunion }) {
  const api = useApi()
  const [actif, setActif] = useState<string | null>(null)
  const save = async (membreId: string, patch: { humeur?: number | null; mot?: string }) => {
    const current = api.meteo.find((m) => m.reunion_id === reunion.id && m.membre_id === membreId)
    const { error } = await supabase.from('piliers_meteo').upsert({
      reunion_id: reunion.id,
      membre_id: membreId,
      humeur: patch.humeur !== undefined ? patch.humeur : current?.humeur ?? null,
      mot: patch.mot !== undefined ? patch.mot : current?.mot ?? '',
      updated_at: new Date().toISOString(),
    })
    if (error) api.notify(error.message, 'err')
    await api.reload()
  }
  const sujetsDe = (membreId: string) =>
    api.sujets
      .filter(
        (s) =>
          s.propose_par === membreId &&
          s.origine !== 'action_liee' &&
          (s.statut === 'a_aborder' || s.reunion_origine === reunion.id || api.reunionSujets.some((rs) => rs.reunion_id === reunion.id && rs.sujet_id === s.id)),
      )
      .sort((a, b) => a.numero - b.numero)
  const membreActif = actif ? api.membreById.get(actif) || null : null

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {api.membresActifs.map((m) => {
          const mt = api.meteo.find((x) => x.reunion_id === reunion.id && x.membre_id === m.id)
          const nb = sujetsDe(m.id).length
          const on = actif === m.id
          return (
            <Card key={m.id} style={{ padding: 12, borderColor: on ? m.couleur : C.line, boxShadow: on ? `0 0 0 2px ${m.couleur}` : 'none' }}>
              <button
                onClick={() => setActif(on ? null : m.id)}
                title="Ouvrir le tour de parole : ses sujets pour l’ordre du jour"
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.ink, width: '100%', fontFamily: FONT_BODY }}
              >
                <Avatar membre={m} size={26} />
                <b style={{ fontSize: 14 }}>{m.prenom}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: nb ? C.ink : C.faint, padding: '1px 8px', borderRadius: 999, background: nb ? `${C.gold}33` : C.soft2 }}>
                  {nb ? `📥 ${nb}` : '＋ sujets'} {on ? '▴' : '▾'}
                </span>
              </button>
              <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                {MOODS.map((mood) => (
                  <button
                    key={mood.key}
                    title={mood.label}
                    onClick={() => void save(m.id, { humeur: mt?.humeur === mood.key ? null : mood.key })}
                    style={{
                      fontSize: 19,
                      padding: '2px 3px',
                      borderRadius: 8,
                      border: `2px solid ${mt?.humeur === mood.key ? C.accent : 'transparent'}`,
                      background: mt?.humeur === mood.key ? C.soft2 : 'transparent',
                      cursor: 'pointer',
                      opacity: mt?.humeur && mt.humeur !== mood.key ? 0.35 : 1,
                    }}
                  >
                    {mood.icon}
                  </button>
                ))}
              </div>
              <input
                defaultValue={mt?.mot || ''}
                key={`${m.id}-${mt?.mot || ''}`}
                placeholder="En un mot…"
                onBlur={(e) => {
                  if (e.target.value !== (mt?.mot || '')) void save(m.id, { mot: e.target.value })
                }}
                style={{ ...input, width: '100%' }}
              />
            </Card>
          )
        })}
      </div>

      {membreActif && (
        <Card style={{ marginTop: 12, borderLeft: `5px solid ${membreActif.couleur}`, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Avatar membre={membreActif} size={30} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Tour de {membreActif.prenom}</div>
              <div style={{ fontSize: 12, color: C.muted }}>Ses sujets pour l’ordre du jour — ils s’ajoutent à l’étape 3.</div>
            </div>
            <button style={{ ...linkBtn, marginLeft: 'auto', fontSize: 20 }} onClick={() => setActif(null)} aria-label="Fermer">
              ×
            </button>
          </div>
          <OdjListe sujets={sujetsDe(membreActif.id)} reunion={reunion} vide="" />
          <NouvellesLignes reunion={reunion} proposePar={membreActif.id} />
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 2. Revue
function ReviewCard({ sujet, reunion, revu }: { sujet: Sujet; reunion: Reunion; revu: ReunionSujet | null }) {
  const api = useApi()
  const [commentaire, setCommentaire] = useState('')
  const [prochain, setProchain] = useState(sujet.prochain_point || addDaysIso(reunion.date_reunion, 28))
  const [busy, setBusy] = useState(false)
  const today = todayIso()
  const recents = api.suivisOf(sujet.id).filter((s) => s.type !== 'statut' && (!api.depuis || s.created_at > api.depuis))
  const questions = recents.filter((s) => s.type === 'question')
  const overdue = isOverdue(sujet, today)
  const piloteId = api.porteursOf(sujet.id).find((p) => p.role === 'pilote')?.membre.id || ''
  // Actions tirées de ce sujet pendant cette réunion
  const enfantsIci = api.sujets.filter((s) => s.parent_id === sujet.id && s.reunion_origine === reunion.id)

  const act = async (issue: Issue) => {
    setBusy(true)
    const statutCible: Statut =
      issue === 'fait' ? 'fait' : issue === 'abandonne' ? 'abandonne' : issue === 'en_attente' ? 'en_attente' : sujet.statut === 'a_planifier' || sujet.statut === 'en_cours' ? sujet.statut : 'en_cours'
    const patch: Partial<Sujet> = { statut: statutCible, a_l_ordre_du_jour: false }
    if (issue === 'on_continue' || issue === 'en_attente') patch.prochain_point = prochain || null
    const ok = await api.updateSujet(sujet, patch, reunion.id)
    if (ok) {
      await supabase.from('piliers_reunion_sujets').upsert({ reunion_id: reunion.id, sujet_id: sujet.id, issue, commentaire: commentaire.trim(), revu_le: new Date().toISOString() })
      if (commentaire.trim()) await api.addSuivi(sujet.id, 'decision', commentaire, reunion.id)
      setCommentaire('')
    }
    await api.reload()
    setBusy(false)
  }

  if (revu) {
    const is = ISSUES[revu.issue]
    return (
      <div style={{ padding: '10px 14px', borderRadius: 12, border: `1px solid ${C.line}`, background: C.soft }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>{is.icon}</span>
        <SujetTitle sujet={sujet} small />
        <span style={{ fontSize: 12, color: is.color, fontWeight: 700 }}>{is.label}</span>
        {revu.commentaire && <span style={{ fontSize: 13, color: C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {revu.commentaire}</span>}
        {sujet.prochain_point && isOpen(sujet) && <span style={{ fontSize: 12, color: C.muted, marginLeft: 'auto' }}>prochain point {fmtDate(sujet.prochain_point)}</span>}
        {prioriteAttendue(sujet) && <PrioInline sujet={sujet} reunionId={reunion.id} />}
        <button
          onClick={async () => {
            await supabase.from('piliers_reunion_sujets').delete().eq('reunion_id', reunion.id).eq('sujet_id', sujet.id)
            await api.reload()
          }}
          style={linkBtn}
          title="Revenir sur ce sujet"
        >
          Revoir
        </button>
      </div>
      {revu.issue !== 'abandonne' && (
        <QuickLines
          reunion={reunion}
          items={enfantsIci}
          defaultPiloteId={piloteId}
          parentId={sujet.id}
          origine="action_liee"
          label="＋ Nouvelles actions sur ce sujet"
          collapsed={!enfantsIci.length}
        />
      )}
      </div>
    )
  }

  return (
    <Card style={{ padding: 14, borderLeft: `4px solid ${overdue ? C.alert : sujet.a_l_ordre_du_jour ? C.gold : C.line}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <SujetTitle sujet={sujet} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <SujetBadges sujet={sujet} />
            {sujet.a_l_ordre_du_jour && <Tag color={C.gold}>🔎 à creuser</Tag>}
            {overdue && <Tag color={C.alert}>point attendu le {fmtDate(sujet.prochain_point)}</Tag>}
          </div>
        </div>
        <PorteursInline sujetId={sujet.id} />
      </div>

      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: C.soft, fontSize: 13 }}>
        {recents.length === 0 ? (
          <span style={{ color: C.faint }}>Pas de nouvelle donnée depuis la dernière réunion.</span>
        ) : (
          recents.slice(0, 3).map((s) => <SuiviLine key={s.id} suivi={s} compact />)
        )}
        {recents.length > 3 && (
          <button style={linkBtn} onClick={() => api.openSujet(sujet.id)}>
            + {recents.length - 3} autre{recents.length - 3 > 1 ? 's' : ''}
          </button>
        )}
        {questions.length > 0 && <div style={{ marginTop: 4, color: C.gold, fontWeight: 600 }}>❓ {questions.length} question{questions.length > 1 ? 's' : ''} posée{questions.length > 1 ? 's' : ''} pour cette réunion</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          placeholder="Décision / ce qu’on retient (facultatif)"
          style={{ ...input, flex: '1 1 260px' }}
        />
        <label style={{ fontSize: 12, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          prochain point
          <input type="date" value={prochain} onChange={(e) => setProchain(e.target.value)} style={{ ...input, width: 140 }} />
        </label>
        {!estInfo(sujet.nature) && <PrioInline sujet={sujet} reunionId={reunion.id} />}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <Btn disabled={busy} color={C.ok} onClick={() => void act('fait')}>
          ✅ Fait
        </Btn>
        <Btn disabled={busy} color="#2D6F86" onClick={() => void act('on_continue')}>
          ➡️ On continue
        </Btn>
        <Btn disabled={busy} color={C.alert} onClick={() => void act('en_attente')}>
          ⏸️ En attente
        </Btn>
        <Btn disabled={busy} color="#7C8597" onClick={() => void act('abandonne')}>
          ✖️ Abandonner
        </Btn>
        <Btn onClick={() => api.openSujet(sujet.id)} style={{ marginLeft: 'auto' }}>
          Ouvrir la fiche
        </Btn>
      </div>
      <QuickLines
        reunion={reunion}
        items={enfantsIci}
        defaultPiloteId={piloteId}
        parentId={sujet.id}
        origine="action_liee"
        label="＋ Nouvelles actions sur ce sujet"
        collapsed={!enfantsIci.length}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- 3. Nouveaux sujets proposés
// (19/11/2026, v3) Lecture « une ligne » : À aborder · c'est… · proposé par ·
// titre (+ le blabla) · 🔒 · statut · priorité · Détail. Le statut et la
// priorité se tranchent directement sur la ligne ; passer un sujet en cours /
// à planifier / en attente le rattache par défaut à la personne qui l'a proposé.
function OdjListe({ sujets, reunion, vide }: { sujets: Sujet[]; reunion: Reunion | null; vide?: string }) {
  if (!sujets.length) {
    return vide === '' ? null : <Empty>{vide || 'Aucun sujet proposé pour l’instant. « ＋ Remonter un sujet » pour alimenter l’ordre du jour.'}</Empty>
  }
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: C.card }}>
      {sujets.map((s, i) => (
        <SujetLigne key={s.id} sujet={s} reunion={reunion} last={i === sujets.length - 1} />
      ))}
    </div>
  )
}

const ODJ_SELECT: React.CSSProperties = { padding: '5px 6px', borderRadius: 8, fontSize: 12, fontFamily: FONT_BODY, cursor: 'pointer', outline: 'none' }

function SujetLigne({ sujet, reunion, last }: { sujet: Sujet; reunion: Reunion | null; last?: boolean }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const rs = reunion ? api.reunionSujets.find((x) => x.reunion_id === reunion.id && x.sujet_id === sujet.id) || null : null
  const propose = sujet.propose_par ? api.membreById.get(sujet.propose_par) || null : null
  const pilote = api.porteursOf(sujet.id).find((p) => p.role === 'pilote')?.membre || null
  const na = refOf(NATURES, sujet.nature)
  const st = refOf(STATUTS, sujet.statut)
  const enfants = api.sujets.filter((x) => x.parent_id === sujet.id).length

  const changerStatut = async (statut: Statut) => {
    setBusy(true)
    const ouvert = OPEN_STATUTS.includes(statut)
    const patch: Partial<Sujet> = { statut, a_l_ordre_du_jour: false }
    if (reunion && statut !== 'a_aborder') patch.reunion_origine = sujet.reunion_origine || reunion.id
    if (ouvert && !sujet.prochain_point) patch.prochain_point = addDaysIso(reunion?.date_reunion || todayIso(), 28)
    if (statut === 'fait' && sujet.nature === 'question') patch.nature = 'info'
    const ok = await api.updateSujet(sujet, patch, reunion?.id || null)
    if (ok && ouvert && !pilote) {
      const qui = propose?.actif ? propose.id : api.me?.id
      if (qui) await api.setPorteurs(sujet.id, [{ membre_id: qui, role: 'pilote' }])
    }
    if (ok && reunion) {
      if (statut === 'a_aborder') {
        await supabase.from('piliers_reunion_sujets').delete().eq('reunion_id', reunion.id).eq('sujet_id', sujet.id)
      } else {
        const issue: Issue = ouvert ? 'qualifie' : statut === 'abandonne' ? 'abandonne' : estInfo(sujet.nature) || sujet.nature === 'question' ? 'pour_info' : 'fait'
        await supabase.from('piliers_reunion_sujets').upsert({ reunion_id: reunion.id, sujet_id: sujet.id, issue, commentaire: rs?.commentaire || '', revu_le: new Date().toISOString() })
      }
    }
    await api.reload()
    setBusy(false)
  }

  const tag = rs
    ? { label: 'Tranché', icon: '✓', color: C.ok }
    : sujet.statut === 'a_aborder'
      ? { label: 'À aborder', icon: '📥', color: C.gold }
      : { label: 'À l’ODJ', icon: '📌', color: '#5E8FB3' }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderBottom: last ? 'none' : `1px solid ${C.line}`,
        flexWrap: 'wrap',
        opacity: busy ? 0.6 : 1,
        background: rs ? C.soft : 'transparent',
      }}
    >
      <span style={{ width: 92, flex: '0 0 auto' }}>
        <Tag color={tag.color}>
          {tag.icon} {tag.label}
        </Tag>
      </span>
      <select
        value={sujet.nature}
        onChange={async (e) => {
          await api.updateSujet(sujet, { nature: e.target.value as Nature })
          await api.reload()
        }}
        title="C’est…"
        style={{ ...ODJ_SELECT, width: 158, flex: '0 0 auto', border: `1px solid ${na?.color || C.line}`, background: `${na?.color || '#888'}1F`, color: C.ink }}
      >
        {NATURES.map((n) => (
          <option key={n.key} value={n.key}>
            {n.icon} {n.label}
          </option>
        ))}
      </select>
      <span style={{ width: 26, flex: '0 0 auto' }} title={propose ? `Mis à l’ordre du jour par ${propose.prenom}` : 'Proposé par ?'}>
        {propose ? <Avatar membre={propose} size={24} /> : <span style={{ color: C.faint }}>?</span>}
      </span>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <button
          onClick={() => api.openSujet(sujet.id)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.ink, textAlign: 'left', fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY, maxWidth: '100%' }}
        >
          <span style={{ color: C.faint, fontWeight: 500 }}>#{sujet.numero} </span>
          {sujet.impacte_ca && <span title="Impacte le CA">⚡ </span>}
          {sujet.titre}
          {enfants > 0 && <span style={{ color: C.faint, fontWeight: 500, fontSize: 12 }}> · ↳ {enfants} action{enfants > 1 ? 's' : ''}</span>}
        </button>
        {sujet.contexte && (
          <div style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sujet.contexte}>
            {sujet.contexte}
          </div>
        )}
      </div>
      <button
        onClick={async () => {
          await api.updateSujet(sujet, { confidentiel: !sujet.confidentiel, ...(sujet.confidentiel ? {} : { a_communiquer: false }) })
          await api.reload()
        }}
        title={sujet.confidentiel ? 'Confidentiel — cliquer pour retirer' : 'Marquer confidentiel'}
        style={{
          ...chipBase,
          padding: '3px 8px',
          fontSize: 12,
          flex: '0 0 auto',
          borderColor: sujet.confidentiel ? C.alert : C.line,
          background: sujet.confidentiel ? `${C.alert}22` : 'transparent',
          color: sujet.confidentiel ? C.ink : C.faint,
          fontWeight: sujet.confidentiel ? 700 : 400,
        }}
      >
        🔒{sujet.confidentiel ? ' Confidentiel' : ''}
      </button>
      <select
        value={sujet.statut}
        disabled={busy}
        onChange={(e) => void changerStatut(e.target.value as Statut)}
        title="Statut"
        style={{ ...ODJ_SELECT, width: 132, flex: '0 0 auto', border: `1px solid ${st?.color || C.line}`, background: `${st?.color || '#888'}1F`, color: C.ink }}
      >
        {STATUTS.map((x) => (
          <option key={x.key} value={x.key}>
            {x.icon} {x.label}
          </option>
        ))}
      </select>
      <span style={{ flex: '0 0 auto', minWidth: 112 }}>{prioriteAttendue(sujet) ? <PrioInline sujet={sujet} reunionId={reunion?.id} /> : <span style={{ fontSize: 12, color: C.faint }}>—</span>}</span>
      {pilote && OPEN_STATUTS.includes(sujet.statut) && (
        <span title={`Porté par ${pilote.prenom}`} style={{ flex: '0 0 auto' }}>
          <Avatar membre={pilote} size={20} />
        </span>
      )}
      <Btn onClick={() => api.openSujet(sujet.id)} style={{ flex: '0 0 auto', padding: '8px 16px', fontSize: 14 }}>
        Détail ›
      </Btn>
    </div>
  )
}

/** Lignes vides de saisie rapide (tour de météo) : c'est… · titre · le blabla · 🔒 */
function NouvellesLignes({ reunion, proposePar }: { reunion: Reunion; proposePar: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      <LigneVide reunion={reunion} proposePar={proposePar} autoFocus />
      <LigneVide reunion={reunion} proposePar={proposePar} />
    </div>
  )
}

function LigneVide({ reunion, proposePar, autoFocus }: { reunion: Reunion; proposePar: string; autoFocus?: boolean }) {
  const api = useApi()
  const [nature, setNature] = useState<Nature>('question')
  const [titre, setTitre] = useState('')
  const [contexte, setContexte] = useState('')
  const [confidentiel, setConfidentiel] = useState(false)
  const [busy, setBusy] = useState(false)
  const na = refOf(NATURES, nature)

  const ajouter = async () => {
    if (!titre.trim() || busy) return
    setBusy(true)
    const s = await api.createSujet({
      titre,
      contexte,
      nature,
      propose_par: proposePar,
      origine: 'meteo',
      reunion_origine: reunion.id,
      confidentiel,
      pilote_id: nature === 'action' || nature === 'projet' ? proposePar : null,
      domaine: api.membreById.get(proposePar)?.domaine || '',
    })
    if (s) {
      setTitre('')
      setContexte('')
      setConfidentiel(false)
    }
    await api.reload()
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 10px', borderRadius: 10, border: `1px dashed ${C.lineStrong}` }}>
      <span style={{ width: 92, flex: '0 0 auto', fontSize: 12, color: C.faint }}>＋ nouveau</span>
      <select
        value={nature}
        onChange={(e) => setNature(e.target.value as Nature)}
        style={{ ...ODJ_SELECT, width: 158, flex: '0 0 auto', border: `1px solid ${na?.color || C.line}`, background: `${na?.color || '#888'}1F`, color: C.ink }}
      >
        {NATURES.map((n) => (
          <option key={n.key} value={n.key}>
            {n.icon} {n.label}
          </option>
        ))}
      </select>
      <input
        autoFocus={autoFocus}
        value={titre}
        disabled={busy}
        onChange={(e) => setTitre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void ajouter()
        }}
        placeholder="Le sujet… puis Entrée"
        style={{ ...input, padding: '6px 9px', fontSize: 13, flex: '2 1 220px' }}
      />
      <input
        value={contexte}
        disabled={busy}
        onChange={(e) => setContexte(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void ajouter()
        }}
        placeholder="Le blabla (facultatif)"
        style={{ ...input, padding: '6px 9px', fontSize: 13, flex: '3 1 220px' }}
      />
      <button
        onClick={() => setConfidentiel(!confidentiel)}
        title="Confidentiel"
        style={{ ...chipBase, padding: '4px 8px', fontSize: 12, borderColor: confidentiel ? C.alert : C.line, background: confidentiel ? `${C.alert}22` : 'transparent', color: confidentiel ? C.ink : C.faint }}
      >
        🔒
      </button>
      <Btn disabled={busy || !titre.trim()} onClick={() => void ajouter()}>
        Ajouter
      </Btn>
    </div>
  )
}

// ---------------------------------------------------------------- Lignes rapides
// Saisie d'actions à la volée : une ligne = une action, Entrée pour valider,
// collage de plusieurs lignes = plusieurs actions. L'action est rattachée par
// défaut au porteur indiqué ; le détail se complète plus tard dans la fiche.
function QuickLines({
  reunion,
  items,
  defaultPiloteId,
  parentId,
  origine,
  allowInfo,
  label,
  placeholder,
  collapsed,
  hidePiloteSelect,
}: {
  reunion?: Reunion | null
  items: Sujet[]
  defaultPiloteId?: string | null
  parentId?: string | null
  origine: Origine
  allowInfo?: boolean
  label?: string
  placeholder?: string
  collapsed?: boolean
  hidePiloteSelect?: boolean
}) {
  const api = useApi()
  const [open, setOpen] = useState(!collapsed)
  const [kind, setKind] = useState<'action' | 'info'>('action')
  const [texte, setTexte] = useState('')
  const [pilote, setPilote] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const piloteEffectif = pilote || defaultPiloteId || ''

  const add = async (raw: string) => {
    const lignes = raw
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-•*·]\s*/, '').trim())
      .filter(Boolean)
    if (!lignes.length) return
    setBusy(true)
    for (const titre of lignes) {
      const info = allowInfo && kind === 'info'
      const s = await api.createSujet({
        titre,
        contexte: '',
        nature: info ? 'info' : 'action',
        statut: info ? 'fait' : 'en_cours',
        pilote_id: piloteEffectif || null,
        reunion_origine: reunion?.id || null,
        parent_id: parentId || null,
        origine,
        prochain_point: info ? null : addDaysIso(reunion?.date_reunion || todayIso(), 28),
        domaine: (piloteEffectif && api.membreById.get(piloteEffectif)?.domaine) || '',
      })
      if (s && reunion) {
        await supabase
          .from('piliers_reunion_sujets')
          .upsert({ reunion_id: reunion.id, sujet_id: s.id, issue: info ? 'pour_info' : 'qualifie', commentaire: '', revu_le: new Date().toISOString() })
      }
    }
    setTexte('')
    await api.reload()
    setBusy(false)
  }

  if (!open) {
    return (
      <button style={{ ...linkBtn, fontSize: 12, marginTop: 8 }} onClick={() => setOpen(true)}>
        {label || '＋ Ajouter des actions'}
      </button>
    )
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((s) => {
        const p = api.porteursOf(s.id).find((x) => x.role === 'pilote')
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 2px' }}>
            <span style={{ width: 18 }}>{estInfo(s.nature) ? 'ℹ️' : s.statut === 'fait' ? '✅' : '🎯'}</span>
            <button
              onClick={() => api.openSujet(s.id)}
              style={{ background: 'none', border: 'none', padding: 0, color: C.ink, cursor: 'pointer', textAlign: 'left', flex: 1, fontSize: 13, fontFamily: FONT_BODY }}
            >
              {s.titre}
            </button>
            {prioriteAttendue(s) && <PrioInline sujet={s} reunionId={reunion?.id} />}
            {p && <Avatar membre={p.membre} size={18} />}
            <button
              title="Retirer cette ligne"
              style={{ ...linkBtn, color: C.faint, fontSize: 14 }}
              onClick={async () => {
                const { error } = await supabase.from('piliers_sujets').delete().eq('id', s.id)
                if (error) api.notify(error.message, 'err')
                await api.reload()
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {allowInfo && (
          <button
            onClick={() => setKind(kind === 'action' ? 'info' : 'action')}
            title="Basculer action / info"
            style={{ ...chipBase, padding: '4px 8px', fontSize: 12, borderColor: kind === 'action' ? '#4E7A2A' : '#5E8FB3', color: C.ink, flex: '0 0 auto' }}
          >
            {kind === 'action' ? '🎯 Action' : 'ℹ️ Info'}
          </button>
        )}
        <input
          value={texte}
          disabled={busy}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add(texte)
            }
          }}
          onPaste={(e) => {
            const txt = e.clipboardData.getData('text')
            if (txt.includes('\n')) {
              e.preventDefault()
              void add(txt)
            }
          }}
          placeholder={kind === 'info' && allowInfo ? 'Une info partagée… puis Entrée' : placeholder || 'Une action… puis Entrée (coller plusieurs lignes = plusieurs actions)'}
          style={{ ...input, padding: '6px 9px', fontSize: 13, flex: 1, minWidth: 0 }}
        />
        {!hidePiloteSelect && kind === 'action' && (
          <select value={piloteEffectif} onChange={(e) => setPilote(e.target.value)} title="Qui porte l’action" style={{ ...input, padding: '5px 6px', fontSize: 12, flex: '0 0 auto', maxWidth: 120 }}>
            <option value="">Personne</option>
            {api.membresActifs.map((m) => (
              <option key={m.id} value={m.id}>
                {m.prenom}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function InlineAdd({ reunion }: { reunion: Reunion }) {
  const api = useApi()
  const [titre, setTitre] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async (raw: string) => {
    const lignes = raw
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-•*·]\s*/, '').trim())
      .filter(Boolean)
    if (!lignes.length) return
    setBusy(true)
    for (const t of lignes) await api.createSujet({ titre: t, contexte: '', nature: 'question', reunion_origine: reunion.id, origine: 'seance' })
    setTitre('')
    await api.reload()
    setBusy(false)
  }
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <input
        value={titre}
        disabled={busy}
        onChange={(e) => setTitre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add(titre)
        }}
        onPaste={(e) => {
          const txt = e.clipboardData.getData('text')
          if (txt.includes('\n')) {
            e.preventDefault()
            void add(txt)
          }
        }}
        placeholder="Un sujet arrive en séance ? Tapez-le puis Entrée (ou collez une liste)"
        style={{ ...input, flex: 1 }}
      />
      <Btn disabled={busy || !titre.trim()} onClick={() => void add(titre)}>
        Ajouter
      </Btn>
    </div>
  )
}

// ---------------------------------------------------------------- 4. Communication
function ComStep({ reunion, revus }: { reunion: Reunion; revus: ReunionSujet[] }) {
  const api = useApi()
  const aCommuniquer = api.sujets.filter((s) => s.a_communiquer && s.communication_statut !== 'diffuse')
  const candidats = revus
    .filter((rs) => ['fait', 'qualifie', 'on_continue'].includes(rs.issue))
    .map((rs) => api.sujetById.get(rs.sujet_id))
    .filter((s): s is Sujet => !!s && !s.a_communiquer && !s.confidentiel)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {aCommuniquer.length === 0 && <Empty>Aucun message en préparation.</Empty>}
      {aCommuniquer.map((s) => (
        <ComCard key={s.id} sujet={s} />
      ))}
      {candidats.length > 0 && (
        <Card style={{ padding: 12, background: C.soft }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Sujets traités aujourd’hui — faut-il en parler aux équipes ?</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {candidats.map((s) => (
              <button
                key={s.id}
                onClick={async () => {
                  await api.updateSujet(s, { a_communiquer: true, communication_statut: 'a_preparer' }, reunion.id)
                  await api.reload()
                }}
                style={{ ...chipBase, borderColor: C.lineStrong }}
              >
                📣 #{s.numero} {s.titre}
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function ComCard({ sujet }: { sujet: Sujet }) {
  const api = useApi()
  const [message, setMessage] = useState(sujet.communication_message)
  const [cible, setCible] = useState(sujet.communication_cible)
  const save = async (patch: Partial<Sujet>) => {
    await api.updateSujet(sujet, patch)
    await api.reload()
  }
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <SujetTitle sujet={sujet} small />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {COM_STATUTS.map((c) => (
            <button
              key={c.key}
              onClick={() => void save({ communication_statut: c.key })}
              style={{
                ...chipBase,
                borderColor: sujet.communication_statut === c.key ? c.color : C.line,
                background: sujet.communication_statut === c.key ? `${c.color}22` : 'transparent',
                color: sujet.communication_statut === c.key ? C.ink : C.muted,
              }}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          list="pil-cibles"
          value={cible}
          onChange={(e) => setCible(e.target.value)}
          onBlur={() => cible !== sujet.communication_cible && void save({ communication_cible: cible })}
          placeholder="À qui ?"
          style={{ ...input, width: 220 }}
        />
        <datalist id="pil-cibles">
          {COM_CIBLES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onBlur={() => message !== sujet.communication_message && void save({ communication_message: message })}
          placeholder="Le message, tel qu’on le dira aux équipes"
          rows={2}
          style={{ ...input, flex: '1 1 320px', resize: 'vertical' }}
        />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- 5. Clôture
function Cloture({
  reunion,
  stats,
  blocages,
}: {
  reunion: Reunion
  stats: { revueFaits: number; revueTotal: number; nouveauxFaits: number; nouveauxTotal: number; meteoFaite: number }
  blocages: { sujet: Sujet; statut: boolean; priorite: boolean }[]
}) {
  const api = useApi()
  const [synthese, setSynthese] = useState(reunion.synthese)
  // Une réunion suivante déjà planifiée (ex. réunion rouverte) est réutilisée
  const suivante = api.reunions
    .filter((r) => r.id !== reunion.id && r.statut !== 'cloturee' && r.date_reunion > reunion.date_reunion)
    .sort((x, y) => x.date_reunion.localeCompare(y.date_reunion))[0]
  const [prochaine, setProchaine] = useState(suivante?.date_reunion || addDaysIso(reunion.date_reunion, 28))
  const [busy, setBusy] = useState(false)
  const redacteur = reunion.redacteur_id ? api.membreById.get(reunion.redacteur_id) || null : null
  const suisRedacteur = !!redacteur && redacteur.id === api.me?.id
  const nbStatut = blocages.filter((b) => b.statut).length
  const nbPrio = blocages.filter((b) => b.priorite).length

  return (
    <Card>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 14 }}>
        <span>☀️ Météo : {stats.meteoFaite}/{api.membresActifs.length}</span>
        <span>🔁 Actions revues : {stats.revueFaits}/{stats.revueTotal}</span>
        <span>📥 Nouveaux traités : {stats.nouveauxFaits}/{stats.nouveauxTotal}</span>
      </div>

      {blocages.length > 0 ? (
        <div style={{ border: `1px solid ${C.alert}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: C.alert, marginBottom: 6 }}>
            Avant de clôturer : {nbStatut > 0 && `${nbStatut} sujet${nbStatut > 1 ? 's' : ''} à trancher`}
            {nbStatut > 0 && nbPrio > 0 && ' · '}
            {nbPrio > 0 && `${nbPrio} priorité${nbPrio > 1 ? 's' : ''} à donner`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {blocages.map((b) => (
              <div key={b.sujet.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0', borderBottom: `1px solid ${C.line}` }}>
                <SujetTitle sujet={b.sujet} small />
                <PorteursInline sujetId={b.sujet.id} small />
                <span style={{ flex: 1 }} />
                {b.statut && <Tag color={C.alert}>statut à trancher</Tag>}
                {b.priorite && <PrioInline sujet={b.sujet} reunionId={reunion.id} />}
              </div>
            ))}
          </div>
          {nbStatut > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Les statuts se tranchent dans les étapes 2 et 3 (Fait, On continue, On lance, Pris pour info…).</div>}
        </div>
      ) : (
        <div style={{ color: C.ok, fontSize: 14, marginBottom: 12, fontWeight: 600 }}>✓ Tous les sujets sont tranchés et priorisés.</div>
      )}

      <textarea
        value={synthese}
        onChange={(e) => setSynthese(e.target.value)}
        onBlur={async () => {
          if (synthese !== reunion.synthese) await supabase.from('piliers_reunions').update({ synthese }).eq('id', reunion.id)
        }}
        rows={4}
        placeholder="Les 3 messages clés de la réunion…"
        style={{ ...input, width: '100%', resize: 'vertical' }}
      />
      <div style={{ fontSize: 13, marginTop: 10, color: redacteur ? C.muted : C.alert }}>
        {redacteur ? (
          <>
            ✍️ Rédacteur : <b style={{ color: C.ink }}>{redacteur.prenom}</b>
            {suisRedacteur ? ' — c’est vous qui clôturez.' : ` — seul(e) ${redacteur.prenom} peut clôturer.`}
          </>
        ) : (
          '✍️ Désignez le rédacteur de la réunion (en haut de page) : c’est lui qui rédige et clôture.'
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: C.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          Prochaine réunion le
          <input type="date" value={prochaine} onChange={(e) => setProchaine(e.target.value)} style={{ ...input, width: 150 }} />
        </label>
        <Btn
          primary
          big
          disabled={busy || blocages.length > 0 || !suisRedacteur}
          title={!suisRedacteur ? 'Réservé au rédacteur de la réunion' : blocages.length ? 'Tranchez et priorisez tous les sujets avant de clôturer' : undefined}
          onClick={async () => {
            if (!window.confirm('Clôturer la réunion ? Le compte rendu sera disponible dans « Réunions passées » (elle pourra être rouverte).')) return
            setBusy(true)
            const up = await supabase
              .from('piliers_reunions')
              .update({ statut: 'cloturee', synthese, cloturee_le: new Date().toISOString() })
              .eq('id', reunion.id)
            if (up.error) api.notify(up.error.message, 'err')
            else if (prochaine) {
              if (suivante) await supabase.from('piliers_reunions').update({ date_reunion: prochaine }).eq('id', suivante.id)
              else await supabase.from('piliers_reunions').insert({ date_reunion: prochaine })
            }
            await api.reload()
            setBusy(false)
            if (!up.error) api.notify('Réunion clôturée — la suivante est prête')
          }}
        >
          ✓ Clôturer et préparer la suivante
        </Btn>
      </div>
    </Card>
  )
}

// ============================================================================
// Onglet 2 — Feuille de route
// ============================================================================
type Vue = 'colonnes' | 'liste' | 'porteurs'

function TabFeuille() {
  const api = useApi()
  const [vue, setVue] = useState<Vue>('colonnes')
  const [q, setQ] = useState('')
  const [porteur, setPorteur] = useState('')
  const [domaine, setDomaine] = useState('')
  const [onlyCa, setOnlyCa] = useState(false)
  const [onlyIrritant, setOnlyIrritant] = useState(false)
  const [onlyRetard, setOnlyRetard] = useState(false)
  const [enjeu, setEnjeu] = useState('')
  const [showClos, setShowClos] = useState(false)
  const today = todayIso()

  const domaines = useMemo(() => Array.from(new Set([...api.membres.map((m) => m.domaine), ...api.sujets.map((s) => s.domaine)].filter(Boolean))).sort(), [api.membres, api.sujets])

  const filtered = api.sujets.filter((s) => {
    if (!showClos && !isOpen(s) && !(s.clos_le && daysBetween(s.clos_le.slice(0, 10), today) <= 45)) return false
    if (q) {
      const needle = q.toLowerCase()
      if (!`#${s.numero} ${s.titre} ${s.contexte}`.toLowerCase().includes(needle)) return false
    }
    if (porteur && !api.porteurs.some((p) => p.sujet_id === s.id && p.membre_id === porteur)) return false
    if (domaine && s.domaine !== domaine) return false
    if (onlyCa && !s.impacte_ca) return false
    if (onlyIrritant && s.ressenti !== 'irritant') return false
    if (onlyRetard && !isOverdue(s, today)) return false
    if (enjeu && !s.enjeux.includes(enjeu)) return false
    return true
  })
  const sorted = [...filtered].sort((a, b) => scoreSujet(b, today) - scoreSujet(a, today) || a.numero - b.numero)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
          {(
            [
              ['colonnes', '▦ Par statut'],
              ['porteurs', '👥 Par porteur'],
              ['liste', '☰ Liste'],
            ] as [Vue, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setVue(k)}
              style={{ padding: '7px 12px', border: 'none', background: vue === k ? C.accent : 'transparent', color: vue === k ? '#fff' : C.muted, cursor: 'pointer', fontSize: 13, fontFamily: FONT_BODY }}
            >
              {l}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" style={{ ...input, width: 200 }} />
        <select value={porteur} onChange={(e) => setPorteur(e.target.value)} style={input}>
          <option value="">Tous les porteurs</option>
          {api.membresActifs.map((m) => (
            <option key={m.id} value={m.id}>
              {m.prenom}
            </option>
          ))}
        </select>
        <select value={domaine} onChange={(e) => setDomaine(e.target.value)} style={input}>
          <option value="">Tous les domaines</option>
          {domaines.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={enjeu} onChange={(e) => setEnjeu(e.target.value)} style={input}>
          <option value="">Tous les enjeux</option>
          {ENJEUX.map((e) => (
            <option key={e.key} value={e.key}>
              {e.icon} {e.label}
            </option>
          ))}
        </select>
        <Toggle on={onlyCa} onClick={() => setOnlyCa(!onlyCa)}>
          ⚡ Impacte le CA
        </Toggle>
        <Toggle on={onlyIrritant} onClick={() => setOnlyIrritant(!onlyIrritant)}>
          🔥 Irritants
        </Toggle>
        <Toggle on={onlyRetard} onClick={() => setOnlyRetard(!onlyRetard)}>
          ⏰ Point dépassé
        </Toggle>
        <Toggle on={showClos} onClick={() => setShowClos(!showClos)}>
          Afficher tout l’historique
        </Toggle>
      </div>

      {vue === 'colonnes' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 12, overflowX: 'auto' }}>
          {STATUTS.filter((st) => st.key !== 'abandonne' || showClos).map((st) => {
            const items = sorted.filter((s) => s.statut === st.key)
            return (
              <div key={st.key} style={{ background: C.soft, borderRadius: 14, padding: 10, minHeight: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '0 4px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: st.color }} />
                  <b style={{ fontSize: 13 }}>{st.label}</b>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>{items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((s) => (
                    <SujetCard key={s.id} sujet={s} />
                  ))}
                  {items.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: 6 }}>—</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {vue === 'porteurs' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {api.membresActifs.map((m) => {
            const items = sorted.filter((s) => api.porteurs.some((p) => p.sujet_id === s.id && p.membre_id === m.id))
            const pilote = items.filter((s) => api.porteurs.some((p) => p.sujet_id === s.id && p.membre_id === m.id && p.role === 'pilote')).length
            return (
              <div key={m.id} style={{ background: C.soft, borderRadius: 14, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Avatar membre={m} size={28} />
                  <div>
                    <b style={{ fontSize: 14 }}>{m.prenom}</b>
                    <div style={{ fontSize: 11, color: C.muted }}>{m.role}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
                    ★ {pilote} · {items.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((s) => (
                    <SujetCard key={s.id} sujet={s} showStatut />
                  ))}
                  {items.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: 6 }}>Aucun sujet</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {vue === 'liste' && (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.muted, fontSize: 12 }}>
                {['#', 'Sujet', 'Statut', 'Nature', 'Porteurs', 'Prio.', 'Équipes', 'Enjeux', 'Prochain point', 'Dernière nouvelle'].map((h) => (
                  <th key={h} style={{ padding: '10px 10px', borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const st = refOf(STATUTS, s.statut)
                const na = refOf(NATURES, s.nature)
                const re = refOf(RESSENTIS, s.ressenti)
                const last = api.suivisOf(s.id)[0]
                return (
                  <tr key={s.id} onClick={() => api.openSujet(s.id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.line}` }}>
                    <td style={td}>{s.numero}</td>
                    <td style={{ ...td, fontWeight: 600, maxWidth: 320 }}>
                      {s.impacte_ca && <span title="Impacte le CA">⚡ </span>}
                      {s.titre}
                    </td>
                    <td style={td}>
                      <Tag color={st?.color || C.muted}>{st?.label}</Tag>
                    </td>
                    <td style={td}>
                      {na?.icon} {na?.label}
                    </td>
                    <td style={td}>
                      <PorteursInline sujetId={s.id} small />
                    </td>
                    <td style={td}>{s.priorite ? `P${s.priorite}` : '—'}</td>
                    <td style={td}>{s.ressenti !== 'neutre' ? `${re?.icon} ${re?.label}` : '—'}</td>
                    <td style={td}>{s.enjeux.map((e) => refOf(ENJEUX, e)?.icon).join(' ')}</td>
                    <td style={{ ...td, color: isOverdue(s, today) ? C.alert : undefined, fontWeight: isOverdue(s, today) ? 700 : 400 }}>{fmtDate(s.prochain_point) || '—'}</td>
                    <td style={{ ...td, color: C.muted }}>{last ? fmtDateTime(last.created_at) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length === 0 && <Empty>Aucun sujet ne correspond aux filtres.</Empty>}
        </Card>
      )}
    </div>
  )
}

function SujetCard({ sujet, showStatut }: { sujet: Sujet; showStatut?: boolean }) {
  const api = useApi()
  const today = todayIso()
  const overdue = isOverdue(sujet, today)
  const st = refOf(STATUTS, sujet.statut)
  const nbSuivis = api.suivisOf(sujet.id).filter((s) => s.type !== 'statut').length
  return (
    <button
      onClick={() => api.openSujet(sujet.id)}
      style={{
        textAlign: 'left',
        background: C.card,
        border: `1px solid ${overdue ? C.alert : C.line}`,
        borderRadius: 12,
        padding: 10,
        cursor: 'pointer',
        color: C.ink,
        fontFamily: FONT_BODY,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
        <span style={{ color: C.faint, fontWeight: 500 }}>#{sujet.numero} </span>
        {sujet.titre}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {showStatut && st && <Tag color={st.color}>{st.label}</Tag>}
        <SujetBadges sujet={sujet} compact />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted }}>
        <PorteursInline sujetId={sujet.id} small />
        <span style={{ marginLeft: 'auto', color: overdue ? C.alert : C.muted, fontWeight: overdue ? 700 : 400 }}>
          {sujet.prochain_point && isOpen(sujet) ? `⏰ ${fmtDate(sujet.prochain_point)}` : ''}
        </span>
        {nbSuivis > 0 && <span>💬 {nbSuivis}</span>}
      </div>
    </button>
  )
}

// ============================================================================
// Onglet 3 — Entre deux réunions
// ============================================================================
function TabEntre({ onQuickAdd }: { onQuickAdd: () => void }) {
  const api = useApi()
  const [sujetId, setSujetId] = useState('')
  const [type, setType] = useState<SuiviType>('update')
  const [texte, setTexte] = useState('')
  const [busy, setBusy] = useState(false)
  const today = todayIso()
  const me = api.me!

  const mesSujets = api.sujets
    .filter((s) => isOpen(s) && api.porteurs.some((p) => p.sujet_id === s.id && p.membre_id === me.id))
    .sort((a, b) => (a.prochain_point || '9999').localeCompare(b.prochain_point || '9999'))

  // Fil depuis la dernière réunion : suivis + sujets créés
  type Ev = { at: string; kind: 'suivi' | 'nouveau'; suivi?: Suivi; sujet: Sujet }
  const events: Ev[] = []
  api.suivis.forEach((s) => {
    if (api.depuis && s.created_at <= api.depuis) return
    const sj = api.sujetById.get(s.sujet_id)
    if (sj) events.push({ at: s.created_at, kind: 'suivi', suivi: s, sujet: sj })
  })
  api.sujets.forEach((s) => {
    if (api.depuis && s.created_at <= api.depuis) return
    events.push({ at: s.created_at, kind: 'nouveau', sujet: s })
  })
  events.sort((a, b) => b.at.localeCompare(a.at))

  const ouverts = api.sujets.filter((s) => isOpen(s)).sort((a, b) => a.numero - b.numero)
  const proposes = api.sujets.filter((s) => s.statut === 'a_aborder' && s.origine !== 'action_liee').sort((a, b) => a.numero - b.numero)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card style={{ borderLeft: `5px solid ${C.gold}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ ...h2, margin: 0, flex: 1 }}>📥 Proposés pour la prochaine réunion ({proposes.length})</h2>
            <Btn primary onClick={onQuickAdd}>
              ＋ Remonter un sujet
            </Btn>
          </div>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 0 }}>Les nouvelles demandes (hors suivi des actions déjà connues), dans l’ordre où elles seront abordées.</p>
          <OdjListe sujets={proposes} reunion={null} vide="Aucun sujet proposé pour l’instant." />
        </Card>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <Card>
          <h2 style={h2}>Donner une nouvelle sur un sujet</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select value={sujetId} onChange={(e) => setSujetId(e.target.value)} style={input}>
              <option value="">— Choisir le sujet —</option>
              {mesSujets.length > 0 && (
                <optgroup label="Mes sujets">
                  {mesSujets.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.numero} {s.titre}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Tous les sujets ouverts">
                {ouverts.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.numero} {s.titre}
                  </option>
                ))}
              </optgroup>
            </select>
            <Chips list={SUIVI_TYPES.filter((t) => t.key !== 'statut' && t.key !== 'decision')} value={type} onChange={(v) => setType(v as SuiviType)} />
            <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} placeholder="Où on en est, ce qui bloque, la question à poser…" style={{ ...input, resize: 'vertical' }} />
            <div>
              <Btn
                primary
                disabled={busy || !sujetId || !texte.trim()}
                onClick={async () => {
                  setBusy(true)
                  const ok = await api.addSuivi(sujetId, type, texte)
                  if (ok) {
                    setTexte('')
                    api.notify(type === 'question' ? 'Question ajoutée pour la prochaine réunion' : 'Nouvelle enregistrée')
                  }
                  await api.reload()
                  setBusy(false)
                }}
              >
                Publier
              </Btn>
            </div>
          </div>
        </Card>

        <Card>
          <h2 style={h2}>Mes sujets ({mesSujets.length})</h2>
          {mesSujets.length === 0 && <Empty>Vous ne portez aucun sujet ouvert.</Empty>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mesSujets.map((s) => {
              const pil = api.porteurs.some((p) => p.sujet_id === s.id && p.membre_id === me.id && p.role === 'pilote')
              const overdue = isOverdue(s, today)
              return (
                <button key={s.id} onClick={() => api.openSujet(s.id)} style={{ ...rowBtn }}>
                  <span style={{ width: 16 }}>{pil ? '★' : '·'}</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ color: C.faint }}>#{s.numero}</span> {s.titre}
                  </span>
                  <span style={{ fontSize: 12, color: overdue ? C.alert : C.muted, fontWeight: overdue ? 700 : 400 }}>
                    {s.prochain_point ? `${overdue ? 'en retard · ' : ''}${fmtDate(s.prochain_point)}` : 'pas de date'}
                  </span>
                </button>
              )
            })}
          </div>
        </Card>
      </div>

      <Card>
        <h2 style={h2}>Ce qui a bougé {api.derniere ? `depuis la réunion du ${fmtDate(api.derniere.date_reunion, { day: 'numeric', month: 'long' })}` : ''}</h2>
        {events.length === 0 && <Empty>Rien pour l’instant.</Empty>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {events.slice(0, 80).map((ev, i) => (
            <button key={i} onClick={() => api.openSujet(ev.sujet.id)} style={{ ...rowBtn, alignItems: 'flex-start', borderBottom: `1px solid ${C.line}`, borderRadius: 0, padding: '10px 4px' }}>
              <span style={{ fontSize: 18, width: 26 }}>{ev.kind === 'nouveau' ? '📥' : refOf(SUIVI_TYPES, ev.suivi!.type)?.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ fontSize: 12, color: C.muted }}>
                  {ev.kind === 'nouveau' ? api.nameOfEmail(ev.sujet.created_by) : api.nameOfEmail(ev.suivi!.auteur_email)} · {fmtDateTime(ev.at)} · #{ev.sujet.numero} {ev.sujet.titre}
                </span>
                <span style={{ display: 'block', fontSize: 14, marginTop: 2, whiteSpace: 'pre-wrap' }}>
                  {ev.kind === 'nouveau' ? <i>Nouveau sujet remonté</i> : ev.suivi!.texte}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Card>
    </div>
    </div>
  )
}

// ============================================================================
// Onglet 4 — Communication
// ============================================================================
function TabCom() {
  const api = useApi()
  const items = api.sujets.filter((s) => s.a_communiquer)
  const pret = items.filter((s) => s.communication_statut === 'pret')

  const copier = async () => {
    const parCible = new Map<string, Sujet[]>()
    pret.forEach((s) => {
      const k = s.communication_cible || 'Tous les collaborateurs'
      parCible.set(k, [...(parCible.get(k) || []), s])
    })
    const txt = Array.from(parCible.entries())
      .map(([cible, list]) => `▶ ${cible}\n${list.map((s) => `• ${s.titre}${s.communication_message ? ` — ${s.communication_message}` : ''}`).join('\n')}`)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(txt)
      api.notify('Messages copiés — prêts à coller dans un mail ou le fil d’actualité')
    } catch {
      api.notify('Copie impossible depuis ce navigateur', 'err')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ color: C.muted, fontSize: 14, flex: 1 }}>
          Ce qu’on dit aux collaborateurs à la suite des réunions. Cochez « 📣 À communiquer » dans la fiche d’un sujet pour l’ajouter ici.
        </div>
        <Btn primary disabled={!pret.length} onClick={() => void copier()}>
          📋 Copier les {pret.length} message{pret.length > 1 ? 's' : ''} prêt{pret.length > 1 ? 's' : ''}
        </Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(260px, 1fr))', gap: 12 }}>
        {COM_STATUTS.map((c) => {
          const list = items.filter((s) => s.communication_statut === c.key).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          return (
            <div key={c.key} style={{ background: C.soft, borderRadius: 14, padding: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                <span>{c.icon}</span>
                <b style={{ fontSize: 14 }}>{c.label}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>{list.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((s) => (
                  <button key={s.id} onClick={() => api.openSujet(s.id)} style={{ ...rowBtn, flexDirection: 'column', alignItems: 'stretch', background: C.card, border: `1px solid ${C.line}`, padding: 10 }}>
                    <span style={{ fontSize: 12, color: C.muted, textAlign: 'left' }}>
                      {s.communication_cible || 'Cible à préciser'}
                      {s.communication_diffusee_le ? ` · diffusé le ${fmtDate(s.communication_diffusee_le)}` : ''}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, textAlign: 'left' }}>
                      #{s.numero} {s.titre}
                    </span>
                    <span style={{ fontSize: 13, color: s.communication_message ? C.ink : C.faint, textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                      {s.communication_message || 'Message à rédiger…'}
                    </span>
                  </button>
                ))}
                {list.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: 6 }}>—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// Onglet 5 — Réunions passées
// ============================================================================
function TabHistorique() {
  const api = useApi()
  const closed = api.reunions.filter((r) => r.statut === 'cloturee')
  const [openId, setOpenId] = useState<string | null>(closed[0]?.id || null)

  if (!closed.length) return <Empty>Aucune réunion clôturée pour l’instant. Le compte rendu apparaîtra ici après la clôture.</Empty>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
      <Card style={{ padding: 8 }}>
        {closed.map((r) => (
          <button
            key={r.id}
            onClick={() => setOpenId(r.id)}
            style={{ ...rowBtn, background: openId === r.id ? C.soft2 : 'transparent', fontWeight: openId === r.id ? 700 : 400, textTransform: 'capitalize' }}
          >
            {fmtDate(r.date_reunion, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </button>
        ))}
      </Card>
      {openId && <CompteRendu reunion={closed.find((r) => r.id === openId)!} />}
    </div>
  )
}

function compteRenduTexte(api: Api, r: Reunion) {
  const rs = api.reunionSujets.filter((x) => x.reunion_id === r.id)
  const mt = api.meteo.filter((m) => m.reunion_id === r.id)
  const lines: string[] = []
  lines.push(`Réunion Piliers — ${fmtDateLong(r.date_reunion)}`)
  const red = r.redacteur_id ? api.membreById.get(r.redacteur_id) : null
  if (red) lines.push(`Rédacteur : ${red.prenom}`)
  lines.push('')
  if (r.synthese) {
    lines.push('SYNTHÈSE', r.synthese, '')
  }
  if (mt.length) {
    lines.push('MÉTÉO')
    mt.forEach((m) => {
      const mb = api.membreById.get(m.membre_id)
      const mood = MOODS.find((x) => x.key === m.humeur)
      lines.push(`  ${mb?.prenom || '?'} ${mood?.icon || ''} ${m.mot || ''}`.trimEnd())
    })
    lines.push('')
  }
  const section = (title: string, issues: Issue[]) => {
    const list = rs.filter((x) => issues.includes(x.issue))
    if (!list.length) return
    lines.push(title)
    list.forEach((x) => {
      const s = api.sujetById.get(x.sujet_id)
      if (!s) return
      const pil = api.porteursOf(s.id).find((p) => p.role === 'pilote')?.membre.prenom
      lines.push(`  #${s.numero}${s.confidentiel ? ' [CONFIDENTIEL]' : ''} ${s.titre} — ${ISSUES[x.issue].label}${pil ? ` (${pil})` : ''}${x.commentaire ? ` : ${x.commentaire}` : ''}${isOpen(s) && s.prochain_point ? ` · prochain point ${fmtDate(s.prochain_point)}` : ''}`)
    })
    lines.push('')
  }
  section('ACTIONS REVUES', ['fait', 'on_continue', 'en_attente', 'abandonne'])
  section('NOUVEAUX SUJETS', ['qualifie', 'pour_info'])
  const com = api.sujets.filter((s) => s.a_communiquer && rs.some((x) => x.sujet_id === s.id))
  if (com.length) {
    lines.push('À COMMUNIQUER')
    com.forEach((s) => lines.push(`  ${s.communication_cible || 'Tous'} : ${s.titre}${s.communication_message ? ` — ${s.communication_message}` : ''}`))
  }
  return lines.join('\n')
}

function CompteRendu({ reunion }: { reunion: Reunion }) {
  const api = useApi()
  const rs = api.reunionSujets.filter((x) => x.reunion_id === reunion.id)
  const mt = api.meteo.filter((m) => m.reunion_id === reunion.id)
  const txt = compteRenduTexte(api, reunion)
  const mails = api.membresActifs.map((m) => m.email).filter(Boolean).join(';')

  const bloc = (title: string, issues: Issue[]) => {
    const list = rs.filter((x) => issues.includes(x.issue))
    if (!list.length) return null
    return (
      <div style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, margin: '0 0 8px' }}>{title}</h3>
        {list.map((x) => {
          const s = api.sujetById.get(x.sujet_id)
          if (!s) return null
          const is = ISSUES[x.issue]
          return (
            <div key={x.sujet_id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.line}`, alignItems: 'center' }}>
              <span>{is.icon}</span>
              <div style={{ flex: 1 }}>
                <SujetTitle sujet={s} small />
                {x.commentaire && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{x.commentaire}</div>}
              </div>
              <PorteursInline sujetId={s.id} small />
              <span style={{ fontSize: 12, color: is.color, fontWeight: 700, minWidth: 100, textAlign: 'right' }}>{is.label}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ ...h2, margin: 0, textTransform: 'capitalize', flex: 1 }}>{fmtDateLong(reunion.date_reunion)}</h2>
        <Btn
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(txt)
              api.notify('Compte rendu copié')
            } catch {
              api.notify('Copie impossible', 'err')
            }
          }}
        >
          📋 Copier
        </Btn>
        <Btn
          disabled={!(api.me?.est_animateur || (reunion.redacteur_id && reunion.redacteur_id === api.me?.id))}
          title="Réservé au rédacteur de la réunion et aux animateurs"
          onClick={async () => {
            if (!window.confirm('Rouvrir cette réunion ? Elle redevient la réunion en cours (onglet « Prochaine réunion ») ; les décisions déjà prises sont conservées.')) return
            const { error } = await supabase.from('piliers_reunions').update({ statut: 'en_cours', cloturee_le: null }).eq('id', reunion.id)
            if (error) api.notify(error.message, 'err')
            else api.notify('Réunion rouverte — elle est dans l’onglet « Prochaine réunion »')
            await api.reload()
          }}
        >
          ↺ Rouvrir
        </Btn>
        <Btn
          onClick={() => {
            const body = txt.length > 1800 ? `${txt.slice(0, 1800)}\n…\n(compte rendu complet dans le compagnon : Réunion Piliers › Réunions passées)` : txt
            window.location.href = `mailto:${mails}?subject=${encodeURIComponent(`Compte rendu réunion Piliers — ${fmtDate(reunion.date_reunion, { day: 'numeric', month: 'long', year: 'numeric' })}`)}&body=${encodeURIComponent(body)}`
          }}
        >
          ✉️ Envoyer aux membres
        </Btn>
      </div>
      {reunion.redacteur_id && api.membreById.get(reunion.redacteur_id) && (
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>✍️ Rédigé par {api.membreById.get(reunion.redacteur_id)!.prenom}</div>
      )}
      {reunion.synthese && <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: C.soft, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{reunion.synthese}</div>}
      {mt.length > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
          {mt.map((m) => {
            const mb = api.membreById.get(m.membre_id)
            const mood = MOODS.find((x) => x.key === m.humeur)
            return (
              <span key={m.membre_id} style={{ fontSize: 13 }}>
                {mood?.icon || '·'} <b>{mb?.prenom}</b> {m.mot && <span style={{ color: C.muted }}>« {m.mot} »</span>}
              </span>
            )
          })}
        </div>
      )}
      {bloc('Actions revues', ['fait', 'on_continue', 'en_attente', 'abandonne'])}
      {bloc('Nouveaux sujets', ['qualifie', 'pour_info'])}
    </Card>
  )
}

// ============================================================================
// Fiche sujet (fenêtre de détail)
// ============================================================================
// (19/11/2026, v3) Fenêtre simplifiée : l'essentiel d'abord (c'est…, le
// blabla, proposé par, porteur, statut, priorité, prochain point, CA,
// confidentiel), le reste replié sous « Plus de détails ».
function SujetDrawer({ sujet, onClose }: { sujet: Sujet; onClose: () => void }) {
  const api = useApi()
  const [d, setD] = useState<Sujet>(sujet)
  const initialPorteurs = api.porteursOf(sujet.id).map((p) => ({ membre_id: p.membre.id, role: p.role }))
  const [pt, setPt] = useState(initialPorteurs)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [plus, setPlus] = useState(false)
  const [type, setType] = useState<SuiviType>('update')
  const [texte, setTexte] = useState('')
  const suivis = api.suivisOf(sujet.id)
  const enfants = api.sujets.filter((x) => x.parent_id === sujet.id)
  const parent = sujet.parent_id ? api.sujetById.get(sujet.parent_id) || null : null
  const piloteId = pt.find((p) => p.role === 'pilote')?.membre_id || ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof Sujet>(k: K, v: Sujet[K]) => {
    setD((prev) => ({ ...prev, [k]: v }))
    setDirty(true)
  }

  const setPilote = (membreId: string) => {
    setDirty(true)
    setPt((prev) => {
      const sansPilote = prev.filter((p) => p.role !== 'pilote' && p.membre_id !== membreId)
      return membreId ? [{ membre_id: membreId, role: 'pilote' as const }, ...sansPilote] : sansPilote
    })
  }

  const toggleAppui = (membreId: string) => {
    setDirty(true)
    setPt((prev) => {
      const ex = prev.find((p) => p.membre_id === membreId)
      if (ex?.role === 'pilote') return prev
      if (ex) return prev.filter((p) => p.membre_id !== membreId)
      if (prev.length >= 4) {
        api.notify('Un porteur et 3 appuis au maximum', 'err')
        return prev
      }
      return [...prev, { membre_id: membreId, role: 'contributeur' as const }]
    })
  }

  const save = async () => {
    setBusy(true)
    const ok = await api.updateSujet(sujet, {
      titre: d.titre,
      contexte: d.contexte,
      nature: d.nature,
      statut: d.statut,
      domaine: d.domaine,
      ressenti: d.ressenti,
      enjeux: d.enjeux,
      impacte_ca: d.impacte_ca,
      impact_ca_note: d.impact_ca_note,
      priorite: d.priorite,
      prochain_point: d.prochain_point || null,
      echeance: d.echeance || null,
      a_l_ordre_du_jour: d.a_l_ordre_du_jour,
      a_communiquer: d.confidentiel ? false : d.a_communiquer,
      communication_statut: d.communication_statut,
      communication_cible: d.communication_cible,
      communication_message: d.communication_message,
      confidentiel: d.confidentiel,
      propose_par: d.propose_par,
    })
    const norm = (l: { membre_id: string; role: string }[]) => JSON.stringify([...l].sort((a, b) => a.membre_id.localeCompare(b.membre_id)))
    if (ok && norm(pt) !== norm(initialPorteurs)) await api.setPorteurs(sujet.id, pt)
    await api.reload()
    setBusy(false)
    if (ok) {
      setDirty(false)
      api.notify('Sujet enregistré')
    }
  }

  const close = () => {
    if (dirty && !window.confirm('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return
    onClose()
  }

  const domaines = Array.from(new Set(api.membres.map((m) => m.domaine).filter(Boolean)))
  const lbl: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(6,10,18,0.5)' }} />
      <div
        style={{
          position: 'relative',
          width: 'min(760px, 100%)',
          maxHeight: '92vh',
          background: C.card,
          color: C.ink,
          borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: FONT_BODY,
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: C.faint, fontFamily: FONT_TITLE, fontWeight: 700 }}>#{sujet.numero}</span>
          <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>
            créé le {fmtDate(sujet.created_at.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}
            {parent && (
              <>
                {' · tirée de '}
                <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => api.openSujet(parent.id)}>
                  #{parent.numero} {parent.titre}
                </button>
              </>
            )}
          </span>
          <button onClick={close} style={{ ...linkBtn, fontSize: 24, lineHeight: 1 }} aria-label="Fermer">
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input value={d.titre} onChange={(e) => set('titre', e.target.value)} style={{ ...input, fontSize: 18, fontWeight: 700, fontFamily: FONT_TITLE, flexShrink: 0 }} />

          <div>
            <div style={lbl}>C’est…</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {NATURES.map((n) => {
                const on = n.key === d.nature
                return (
                  <button
                    key={n.key}
                    title={n.help}
                    onClick={() => set('nature', n.key)}
                    style={{ ...chipBase, borderColor: on ? n.color : C.line, background: on ? `${n.color}26` : 'transparent', color: on ? C.ink : C.muted, fontWeight: on ? 700 : 500 }}
                  >
                    {n.icon} {n.label}
                  </button>
                )
              })}
            </div>
          </div>

          <textarea
            value={d.contexte}
            onChange={(e) => set('contexte', e.target.value)}
            rows={4}
            placeholder="Le blabla : de quoi parle-t-on, pourquoi maintenant, ce qu’on attend du groupe…"
            style={{ ...input, resize: 'vertical', lineHeight: 1.5, minHeight: 96, flexShrink: 0 }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div>
              <div style={lbl}>Mis à l’ODJ par</div>
              <select value={d.propose_par || ''} onChange={(e) => set('propose_par', e.target.value || null)} style={{ ...input, width: '100%' }}>
                <option value="">—</option>
                {api.membresActifs.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.prenom}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={lbl}>Porteur</div>
              <select value={piloteId} onChange={(e) => setPilote(e.target.value)} style={{ ...input, width: '100%' }}>
                <option value="">{estInfo(d.nature) ? '— (pas nécessaire)' : '— à désigner —'}</option>
                {api.membresActifs.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.prenom}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={lbl}>Statut</div>
              <select value={d.statut} onChange={(e) => set('statut', e.target.value as Statut)} style={{ ...input, width: '100%' }}>
                {STATUTS.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.icon} {x.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={lbl}>Priorité</div>
              <PrioPicker value={d.priorite} onChange={(v) => set('priorite', v)} required={isOpen(d) && !estInfo(d.nature)} />
            </div>
            <div>
              <div style={lbl}>Prochain point</div>
              <input type="date" value={d.prochain_point || ''} onChange={(e) => set('prochain_point', e.target.value || null)} style={{ ...input, width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <CaToggle value={d.impacte_ca} onChange={(v) => set('impacte_ca', v)} />
              <button
                onClick={() => set('confidentiel', !d.confidentiel)}
                style={{ ...chipBase, borderColor: d.confidentiel ? C.alert : C.line, background: d.confidentiel ? `${C.alert}22` : 'transparent', color: d.confidentiel ? C.ink : C.muted, fontWeight: 700 }}
              >
                🔒 {d.confidentiel ? 'Confidentiel' : 'Confidentiel ?'}
              </button>
            </div>
          </div>

          {/* Actions liées */}
          <div style={{ padding: 12, borderRadius: 12, background: C.soft }}>
            <div style={{ fontSize: 12, color: C.muted }}>Actions tirées de ce sujet ({enfants.length})</div>
            <QuickLines
              reunion={api.prochaine && api.prochaine.statut === 'en_cours' ? api.prochaine : null}
              items={enfants}
              defaultPiloteId={piloteId || d.propose_par}
              parentId={sujet.id}
              origine="action_liee"
              label="＋ Ajouter des actions"
              collapsed={!enfants.length}
            />
          </div>

          <button style={{ ...linkBtn, alignSelf: 'flex-start' }} onClick={() => setPlus(!plus)}>
            {plus ? 'Moins de détails ▴' : 'Plus de détails ▾ (appuis, ressenti des équipes, enjeux, échéance, communication)'}
          </button>

          {plus && (
            <div style={{ padding: 12, borderRadius: 12, border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={lbl}>Appuis (en plus du porteur)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {api.membresActifs
                    .filter((m) => m.id !== piloteId)
                    .map((m) => {
                      const on = pt.some((p) => p.membre_id === m.id)
                      return (
                        <button
                          key={m.id}
                          onClick={() => toggleAppui(m.id)}
                          style={{ ...chipBase, display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: on ? m.couleur : C.line, background: on ? `${m.couleur}26` : 'transparent', color: on ? C.ink : C.muted }}
                        >
                          <Avatar membre={m} size={18} />
                          {m.prenom}
                        </button>
                      )
                    })}
                </div>
              </div>
              <Field label="Pour les équipes">
                <Chips list={RESSENTIS} value={d.ressenti} onChange={(v) => set('ressenti', v as Ressenti)} />
              </Field>
              <Field label="Enjeux pour l’entreprise">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ENJEUX.map((e) => {
                    const on = d.enjeux.includes(e.key)
                    return (
                      <button
                        key={e.key}
                        title={e.help}
                        onClick={() => set('enjeux', on ? d.enjeux.filter((x) => x !== e.key) : [...d.enjeux, e.key])}
                        style={{ ...chipBase, borderColor: on ? e.color : C.line, background: on ? `${e.color}22` : 'transparent', color: on ? C.ink : C.muted }}
                      >
                        {e.icon} {e.label}
                      </button>
                    )
                  })}
                </div>
              </Field>
              {d.impacte_ca && (
                <input value={d.impact_ca_note} onChange={(e) => set('impact_ca_note', e.target.value)} placeholder="⚡ Ordre de grandeur de l’impact CA" style={input} />
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Échéance visée">
                  <input type="date" value={d.echeance || ''} onChange={(e) => set('echeance', e.target.value || null)} style={{ ...input, width: '100%' }} />
                </Field>
                <Field label="Domaine">
                  <input list="pil-domaines" value={d.domaine} onChange={(e) => set('domaine', e.target.value)} style={{ ...input, width: '100%' }} />
                  <datalist id="pil-domaines">
                    {domaines.map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Toggle on={d.a_l_ordre_du_jour} onClick={() => set('a_l_ordre_du_jour', !d.a_l_ordre_du_jour)}>
                  🔎 À creuser à la prochaine réunion
                </Toggle>
                {!d.confidentiel && (
                  <Toggle on={d.a_communiquer} onClick={() => set('a_communiquer', !d.a_communiquer)}>
                    📣 À communiquer aux équipes
                  </Toggle>
                )}
              </div>
              {d.a_communiquer && !d.confidentiel && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Chips list={COM_STATUTS} value={d.communication_statut} onChange={(v) => set('communication_statut', v as ComStatut)} />
                  <input list="pil-cibles-d" value={d.communication_cible} onChange={(e) => set('communication_cible', e.target.value)} placeholder="À qui ?" style={input} />
                  <datalist id="pil-cibles-d">
                    {COM_CIBLES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <textarea value={d.communication_message} onChange={(e) => set('communication_message', e.target.value)} rows={3} placeholder="Le message, tel qu’on le dira aux équipes" style={{ ...input, resize: 'vertical' }} />
                </div>
              )}
            </div>
          )}

          {/* Fil de suivi */}
          <div>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 6 }}>Fil de suivi</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <select value={type} onChange={(e) => setType(e.target.value as SuiviType)} style={{ ...input, padding: '6px 8px', fontSize: 13 }}>
                {SUIVI_TYPES.filter((t) => t.key !== 'statut').map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.icon} {t.label}
                  </option>
                ))}
              </select>
              <input
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && texte.trim()) {
                    const ok = await api.addSuivi(sujet.id, type, texte)
                    if (ok) setTexte('')
                    await api.reload()
                  }
                }}
                placeholder="Une nouvelle, une question, une décision… puis Entrée"
                style={{ ...input, flex: 1, fontSize: 13 }}
              />
            </div>
            <div style={{ marginTop: 6 }}>
              {suivis.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>Pas encore de suivi.</div>}
              {suivis.map((s) => (
                <SuiviLine key={s.id} suivi={s} />
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
            <button
              style={{ ...linkBtn, color: C.alert, fontSize: 12 }}
              onClick={async () => {
                if (!window.confirm(`Supprimer définitivement le sujet #${sujet.numero} et son fil de suivi ?\n(Préférez « Abandonné » pour garder la trace.)`)) return
                const { error } = await supabase.from('piliers_sujets').delete().eq('id', sujet.id)
                if (error) api.notify(error.message, 'err')
                else {
                  onClose()
                  await api.reload()
                }
              }}
            >
              Supprimer ce sujet
            </button>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.line}`, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: dirty ? C.alert : C.faint, flex: 1 }}>
            {dirty ? 'Modifications non enregistrées' : `Mis à jour ${fmtDateTime(sujet.updated_at)} par ${api.nameOfEmail(sujet.updated_by || sujet.created_by)}`}
          </span>
          <Btn onClick={close}>Fermer</Btn>
          <Btn primary disabled={!dirty || busy || !d.titre.trim()} onClick={() => void save()}>
            Enregistrer
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Remonter un sujet (fenêtre rapide)
// ============================================================================
// (19/11/2026, v3) Le minimum : le sujet, c'est…, le blabla, confidentiel.
// Le reste se tranche en réunion, sur la ligne ou dans le détail.
function QuickAddModal({ onClose }: { onClose: () => void }) {
  const api = useApi()
  const [titre, setTitre] = useState('')
  const [contexte, setContexte] = useState('')
  const [nature, setNature] = useState<Nature>('question')
  const [confidentiel, setConfidentiel] = useState(false)
  const [proposePar, setProposePar] = useState(api.me?.id || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!titre.trim() || busy) return
    setBusy(true)
    const s = await api.createSujet({
      titre,
      contexte,
      nature,
      confidentiel,
      propose_par: proposePar || null,
      pilote_id: (nature === 'action' || nature === 'projet') && proposePar ? proposePar : null,
      domaine: api.membreById.get(proposePar)?.domaine || '',
    })
    await api.reload()
    setBusy(false)
    if (s) {
      api.notify(`Sujet #${s.numero} ajouté à l’ordre du jour`)
      onClose()
    }
  }

  return (
    <Modal onClose={onClose} title="Mettre un sujet à l’ordre du jour">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          autoFocus
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          placeholder="Le sujet en une phrase"
          style={{ ...input, fontSize: 16, fontWeight: 600 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {NATURES.map((n) => {
            const on = n.key === nature
            return (
              <button
                key={n.key}
                title={n.help}
                onClick={() => setNature(n.key)}
                style={{ ...chipBase, borderColor: on ? n.color : C.line, background: on ? `${n.color}26` : 'transparent', color: on ? C.ink : C.muted, fontWeight: on ? 700 : 500 }}
              >
                {n.icon} {n.label}
              </button>
            )
          })}
        </div>
        <textarea
          value={contexte}
          onChange={(e) => setContexte(e.target.value)}
          rows={3}
          placeholder="Le blabla (facultatif)"
          style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setConfidentiel(!confidentiel)}
            style={{ ...chipBase, borderColor: confidentiel ? C.alert : C.line, background: confidentiel ? `${C.alert}22` : 'transparent', color: confidentiel ? C.ink : C.muted, fontWeight: 700 }}
          >
            🔒 {confidentiel ? 'Confidentiel' : 'Confidentiel ?'}
          </button>
          <label style={{ fontSize: 13, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            Proposé par
            <select value={proposePar} onChange={(e) => setProposePar(e.target.value)} style={{ ...input, padding: '6px 8px' }}>
              {api.membresActifs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.prenom}
                </option>
              ))}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn primary disabled={busy || !titre.trim()} onClick={() => void submit()}>
            Ajouter à l’ODJ
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================================
// Membres
// ============================================================================
function MembresModal({ onClose }: { onClose: () => void }) {
  const api = useApi()
  const anim = !!api.me?.est_animateur
  const [rows, setRows] = useState<Membre[]>(api.membres)
  const [busy, setBusy] = useState(false)

  const upd = (id: string, patch: Partial<Membre>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const save = async () => {
    setBusy(true)
    for (const r of rows) {
      const orig = api.membres.find((m) => m.id === r.id)
      const payload = {
        email: r.email ? r.email.toLowerCase().trim() : null,
        prenom: r.prenom,
        role: r.role,
        domaine: r.domaine,
        couleur: r.couleur,
        ordre: r.ordre,
        actif: r.actif,
        est_animateur: r.est_animateur,
      }
      if (!orig) {
        const { error } = await supabase.from('piliers_membres').insert(payload)
        if (error) api.notify(error.message, 'err')
      } else if (JSON.stringify({ ...orig }) !== JSON.stringify({ ...r })) {
        const { error } = await supabase.from('piliers_membres').update(payload).eq('id', r.id)
        if (error) api.notify(error.message, 'err')
      }
    }
    await api.reload()
    setBusy(false)
    api.notify('Membres enregistrés — un nouveau membre voit la rubrique à sa prochaine connexion')
    onClose()
  }

  return (
    <Modal onClose={onClose} title="Membres de la réunion Piliers" wide>
      <p style={{ color: C.muted, fontSize: 13, marginTop: 0 }}>
        Seuls les membres actifs avec un e-mail voient la rubrique. {anim ? 'Vous êtes animateur : vous pouvez modifier la liste.' : 'La liste est gérée par les animateurs.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '28px 110px 1fr 1fr 1.3fr 70px 90px', gap: 6, alignItems: 'center', opacity: r.actif ? 1 : 0.5 }}>
            <input type="color" disabled={!anim} value={r.couleur} onChange={(e) => upd(r.id, { couleur: e.target.value })} style={{ width: 26, height: 26, border: 'none', background: 'none', padding: 0 }} />
            <input disabled={!anim} value={r.prenom} onChange={(e) => upd(r.id, { prenom: e.target.value })} style={input} />
            <input disabled={!anim} value={r.role} onChange={(e) => upd(r.id, { role: e.target.value })} placeholder="Rôle" style={input} />
            <input disabled={!anim} value={r.domaine} onChange={(e) => upd(r.id, { domaine: e.target.value })} placeholder="Domaine" style={input} />
            <input disabled={!anim} value={r.email || ''} onChange={(e) => upd(r.id, { email: e.target.value || null })} placeholder="e-mail (accès)" style={input} />
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" disabled={!anim} checked={r.actif} onChange={(e) => upd(r.id, { actif: e.target.checked })} /> actif
            </label>
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" disabled={!anim} checked={r.est_animateur} onChange={(e) => upd(r.id, { est_animateur: e.target.checked })} /> animateur
            </label>
          </div>
        ))}
      </div>
      {anim && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <Btn
            onClick={() =>
              setRows((prev) => [
                ...prev,
                {
                  id: `new-${Date.now()}`,
                  email: '',
                  prenom: 'Nouveau',
                  role: '',
                  domaine: '',
                  couleur: '#7A5EA8',
                  ordre: (prev[prev.length - 1]?.ordre || 0) + 10,
                  actif: true,
                  est_animateur: false,
                },
              ])
            }
          >
            ＋ Ajouter un membre
          </Btn>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={onClose}>Annuler</Btn>
            <Btn primary disabled={busy} onClick={() => void save()}>
              Enregistrer
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ============================================================================
// Petits composants
// ============================================================================
const input: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${C.lineStrong}`,
  background: C.card2,
  color: C.ink,
  fontSize: 14,
  fontFamily: FONT_BODY,
  outline: 'none',
  boxSizing: 'border-box',
}
const h2: React.CSSProperties = { fontFamily: FONT_TITLE, fontSize: 18, fontWeight: 700, margin: '0 0 10px' }
const td: React.CSSProperties = { padding: '9px 10px', verticalAlign: 'middle' }
const chipBase: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 999,
  border: `1px solid ${C.line}`,
  background: 'transparent',
  color: C.muted,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: FONT_BODY,
}
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13, padding: 2, fontFamily: FONT_BODY }
const rowBtn: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  width: '100%',
  padding: '8px 8px',
  border: 'none',
  background: 'transparent',
  color: C.ink,
  cursor: 'pointer',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: FONT_BODY,
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, ...style }}>{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '14px 4px', color: C.faint, fontSize: 14 }}>{children}</div>
}

function Btn({
  children,
  onClick,
  primary,
  big,
  disabled,
  color,
  title,
  style,
}: {
  children: React.ReactNode
  onClick?: () => void
  primary?: boolean
  big?: boolean
  disabled?: boolean
  color?: string
  title?: string
  style?: React.CSSProperties
}) {
  const bg = primary ? C.accent : color ? `${color}1F` : 'transparent'
  const border = primary ? C.accent : color || C.lineStrong
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: big ? '11px 18px' : '7px 13px',
        borderRadius: 10,
        border: `1px solid ${border}`,
        background: bg,
        color: primary ? '#fff' : C.ink,
        fontWeight: primary || big ? 700 : 600,
        fontSize: big ? 15 : 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontFamily: FONT_BODY,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...chipBase,
        borderColor: on ? C.accent : C.line,
        background: on ? `${C.accent}26` : 'transparent',
        color: on ? C.ink : C.muted,
        fontWeight: on ? 700 : 500,
      }}
    >
      {children}
    </button>
  )
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `${color}22`, color: C.ink, border: `1px solid ${color}55`, whiteSpace: 'nowrap' }}>{children}</span>
  )
}

function Kpi({ label, value, hint, color, alarm, onClick }: { label: string; value: number; hint: string; color: string; alarm?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: C.card,
        border: `1px solid ${alarm ? color : C.line}`,
        borderRadius: 14,
        padding: '12px 14px',
        cursor: 'pointer',
        color: C.ink,
        fontFamily: FONT_BODY,
        borderTop: `4px solid ${color}`,
      }}
    >
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      <div style={{ fontFamily: FONT_TITLE, fontSize: 28, fontWeight: 700, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{hint}</div>
    </button>
  )
}

function Avatar({ membre, size = 24 }: { membre: Membre; size?: number }) {
  return (
    <span
      title={`${membre.prenom} · ${membre.role}`}
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        background: membre.couleur,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(9, Math.round(size * 0.42)),
        fontWeight: 700,
        flex: '0 0 auto',
        fontFamily: FONT_TITLE,
      }}
    >
      {membre.prenom.slice(0, 2).toUpperCase()}
    </span>
  )
}

function PorteursInline({ sujetId, small }: { sujetId: string; small?: boolean }) {
  const api = useApi()
  const list = api.porteursOf(sujetId)
  if (!list.length) return <span style={{ fontSize: 12, color: C.faint }}>sans porteur</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: small ? 2 : 6 }}>
      {list.map((p) => (
        <span key={p.membre.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: p.role === 'pilote' ? 1 : 0.8 }}>
          <Avatar membre={p.membre} size={small ? 20 : 24} />
          {!small && p.role === 'pilote' && <span style={{ fontSize: 13, fontWeight: 600 }}>{p.membre.prenom} ★</span>}
        </span>
      ))}
    </span>
  )
}

function SujetTitle({ sujet, small }: { sujet: Sujet; small?: boolean }) {
  const api = useApi()
  return (
    <button
      onClick={() => api.openSujet(sujet.id)}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.ink, textAlign: 'left', fontFamily: small ? FONT_BODY : FONT_TITLE, fontSize: small ? 14 : 16, fontWeight: 700 }}
    >
      <span style={{ color: C.faint, fontWeight: 500 }}>#{sujet.numero} </span>
      {sujet.confidentiel && <span title="Confidentiel">🔒 </span>}
      {sujet.impacte_ca && <span title="Impacte le CA">⚡ </span>}
      {sujet.titre}
      {sujet.parent_id && api.sujetById.get(sujet.parent_id) && (
        <span style={{ color: C.faint, fontWeight: 500, fontSize: 12 }}> ↳ tirée de #{api.sujetById.get(sujet.parent_id)!.numero}</span>
      )}
    </button>
  )
}

function SujetBadges({ sujet, compact }: { sujet: Sujet; compact?: boolean }) {
  const na = refOf(NATURES, sujet.nature)
  const re = refOf(RESSENTIS, sujet.ressenti)
  const pr = PRIORITES.find((p) => p.key === sujet.priorite)
  return (
    <>
      {na && <Tag color={na.color}>{compact ? na.icon : `${na.icon} ${na.label}`}</Tag>}
      {pr && <Tag color={pr.color}>{pr.label}</Tag>}
      {sujet.impacte_ca && !compact && <Tag color="#245A9E">⚡ CA</Tag>}
      {sujet.ressenti !== 'neutre' && re && <Tag color={re.color}>{compact ? re.icon : `${re.icon} ${re.label}`}</Tag>}
      {sujet.enjeux.map((e) => {
        const en = refOf(ENJEUX, e)
        return en ? (
          <Tag key={e} color={en.color}>
            {compact ? en.icon : `${en.icon} ${en.label}`}
          </Tag>
        ) : null
      })}
    </>
  )
}

function SuiviLine({ suivi, compact }: { suivi: Suivi; compact?: boolean }) {
  const api = useApi()
  const t = refOf(SUIVI_TYPES, suivi.type)
  return (
    <div style={{ display: 'flex', gap: 8, padding: compact ? '3px 0' : '8px 0', borderBottom: compact ? 'none' : `1px solid ${C.line}`, fontSize: 13 }}>
      <span title={t?.label} style={{ width: 20, flex: '0 0 auto' }}>
        {t?.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: suivi.type === 'statut' ? C.muted : C.ink, whiteSpace: 'pre-wrap', fontStyle: suivi.type === 'statut' ? 'italic' : 'normal', fontWeight: suivi.type === 'decision' ? 600 : 400 }}>
          {suivi.texte}
        </span>
        <span style={{ color: C.faint, fontSize: 11, marginLeft: 6 }}>
          {api.nameOfEmail(suivi.auteur_email)} · {fmtDateTime(suivi.created_at)}
        </span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

function Chips({
  list,
  value,
  onChange,
  showHelp,
}: {
  list: { key: string; label: string; icon: string; help: string; color: string }[]
  value: string
  onChange: (v: string) => void
  showHelp?: boolean
}) {
  const current = list.find((x) => x.key === value)
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {list.map((x) => {
          const on = x.key === value
          return (
            <button
              key={x.key}
              title={x.help}
              onClick={() => onChange(x.key)}
              style={{ ...chipBase, borderColor: on ? x.color : C.line, background: on ? `${x.color}26` : 'transparent', color: on ? C.ink : C.muted, fontWeight: on ? 700 : 500 }}
            >
              {x.icon} {x.label}
            </button>
          )
        })}
      </div>
      {showHelp && current && <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>{current.help}</div>}
    </div>
  )
}

function PrioPicker({
  value,
  onChange,
  withHelp,
  small,
  required,
}: {
  value: number | null
  onChange: (v: number | null) => void
  withHelp?: boolean
  small?: boolean
  required?: boolean
}) {
  const manque = required && !value
  return (
    <div
      title={manque ? 'Priorité à donner' : undefined}
      style={{ display: 'inline-flex', gap: 4, padding: manque ? 2 : 0, borderRadius: 999, outline: manque ? `2px dashed ${C.alert}` : 'none', outlineOffset: 1 }}
    >
      {PRIORITES.map((p) => {
        const on = value === p.key
        return (
          <button
            key={p.key}
            title={p.help}
            onClick={() => onChange(on ? null : p.key)}
            style={{
              ...chipBase,
              ...(small ? { padding: '2px 7px', fontSize: 11 } : {}),
              borderColor: on ? p.color : C.line,
              background: on ? `${p.color}26` : 'transparent',
              color: on ? C.ink : C.muted,
              fontWeight: on ? 700 : 500,
            }}
          >
            {p.label}
            {withHelp ? ` · ${p.help}` : ''}
          </button>
        )
      })}
    </div>
  )
}

/** Priorité modifiable en un clic, enregistrée tout de suite (lignes compactes, clôture). */
function PrioInline({ sujet, reunionId }: { sujet: Sujet; reunionId?: string | null }) {
  const api = useApi()
  return (
    <PrioPicker
      small
      required={prioriteAttendue(sujet)}
      value={sujet.priorite}
      onChange={async (v) => {
        await api.updateSujet(sujet, { priorite: v }, reunionId || null)
        await api.reload()
      }}
    />
  )
}

function CaToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        ...chipBase,
        borderColor: value ? '#245A9E' : C.line,
        background: value ? '#245A9E' : 'transparent',
        color: value ? '#fff' : C.muted,
        fontWeight: 700,
      }}
    >
      ⚡ {value ? 'Impacte le CA' : 'Impacte le CA ?'}
    </button>
  )
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(6,10,18,0.5)' }} />
      <div
        style={{
          position: 'relative',
          width: wide ? 'min(1000px, 100%)' : 'min(620px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: C.card,
          color: C.ink,
          borderRadius: 18,
          padding: 22,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          fontFamily: FONT_BODY,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ ...h2, margin: 0, flex: 1 }}>{title}</h2>
          <button onClick={onClose} style={{ ...linkBtn, fontSize: 22 }} aria-label="Fermer">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
