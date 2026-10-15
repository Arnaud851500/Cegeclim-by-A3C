'use client'

// =============================================================================
// Bandeau « Une tâche vous a été affectée » (2026-10-15, demandé par Arnaud)
// =============================================================================
// Affiché dans le bandeau supérieur, sur PC (ClientRootShell) et sur mobile
// (MobileBrandBar), dès qu'une tâche m'a été confiée par quelqu'un d'autre —
// directement, ou via un de mes groupes tant qu'elle n'a pas été prise.
// Source : RPC get_mes_alertes_taches_affectees() (table
// todo_assignment_notifications alimentée par trigger sur todo_actions).
// Lecture toutes les 60 s et au retour sur l'onglet / l'app.
// « Ouvrir » / « Vu » / « Je la prends » marquent l'alerte comme vue.
// Tant que la migration n'est pas appliquée, la RPC échoue et rien ne s'affiche.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { prendreTacheGroupe } from '@/lib/taskAssignment'
import MobileTaskDetailSheet, { type TaskRow } from '@/components/mobile/MobileTaskDetailSheet'

type AlerteTache = {
  id: string
  todo_id: string
  description_action: string | null
  numero_tiers: string | null
  intitule_tiers: string | null
  due_date: string | null
  status: string | null
  assigned_by_name: string | null
  assigned_by_email: string | null
  via_team_id: string | null
  via_team_name: string | null
  created_at: string
}

const POLL_MS = 60_000

function formatEcheance(iso: string | null) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function resume(a: AlerteTache, max = 90) {
  const txt = String(a.description_action || '').replace(/\s+/g, ' ').trim() || '(sans libellé)'
  return txt.length > max ? `${txt.slice(0, max - 1)}…` : txt
}

export default function TaskAssignmentBanner({ variant }: { variant: 'desktop' | 'mobile' }) {
  const router = useRouter()
  const pathname = usePathname()
  const [alertes, setAlertes] = useState<AlerteTache[]>([])
  const [ouvert, setOuvert] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [tacheOuverte, setTacheOuverte] = useState<TaskRow | null>(null)
  const myEmailRef = useRef('')
  const indisponibleRef = useRef(false)

  const charger = useCallback(async () => {
    if (indisponibleRef.current) return
    const { data, error } = await supabase.rpc('get_mes_alertes_taches_affectees')
    if (error) {
      // RPC absente (migration pas encore appliquée) : on se tait jusqu'au rechargement.
      if (/function|does not exist|schema cache/i.test(error.message || '')) indisponibleRef.current = true
      return
    }
    setAlertes((data || []) as AlerteTache[])
  }, [])

  useEffect(() => {
    let annule = false
    void supabase.auth.getUser().then(({ data }) => {
      if (!annule) myEmailRef.current = String(data.user?.email || '').trim().toLowerCase()
    })
    void charger()
    const timer = window.setInterval(() => void charger(), POLL_MS)
    function auRetour() {
      if (document.visibilityState === 'visible') void charger()
    }
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('focus', auRetour)
    window.addEventListener('cegeclim:tasks-changed', auRetour)
    return () => {
      annule = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', auRetour)
      window.removeEventListener('focus', auRetour)
      window.removeEventListener('cegeclim:tasks-changed', auRetour)
    }
  }, [charger])

  // Changement d'écran : on revérifie (une tâche a pu être créée sur l'écran quitté).
  useEffect(() => {
    void charger()
  }, [pathname, charger])

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  async function marquerVues(ids: string[] | null) {
    setAlertes((cur) => (ids ? cur.filter((a) => !ids.includes(a.id)) : []))
    await supabase.rpc('marquer_alertes_taches_vues', { p_ids: ids })
  }

  async function ouvrir(a: AlerteTache) {
    void marquerVues([a.id])
    setOuvert(false)
    if (variant === 'mobile') {
      const { data } = await supabase
        .from('todo_actions')
        .select('id, description_action, status, due_date, numero_tiers, assigned_to, category_id, team_id, concerned_person')
        .eq('id', a.todo_id)
        .maybeSingle<TaskRow>()
      if (data) setTacheOuverte(data)
      else setMessage('Cette tâche n’est plus disponible.')
      return
    }
    if (pathname?.startsWith('/todo')) {
      window.dispatchEvent(new CustomEvent('cegeclim:open-task', { detail: { id: a.todo_id } }))
    } else {
      router.push(`/todo?tache=${encodeURIComponent(a.todo_id)}`)
    }
  }

  async function prendre(a: AlerteTache) {
    setBusyId(a.id)
    const erreur = await prendreTacheGroupe(a.todo_id, myEmailRef.current)
    setBusyId(null)
    await marquerVues([a.id])
    setMessage(erreur || 'Tâche prise : elle a disparu chez les autres membres du groupe.')
    window.dispatchEvent(new Event('cegeclim:tasks-changed'))
  }

  const mobile = variant === 'mobile'
  const premiere = alertes[0]
  const autres = alertes.length - 1

  if (!premiere && !message && !tacheOuverte) return null

  return (
    <>
      <style>{`
        @keyframes cgcTaskPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(1.35); } }
        .cgcTaskBtn:hover { filter: brightness(1.12); }
        .cgcTaskBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
      `}</style>

      {message && !premiere && (
        <div role="status" style={{ ...barStyle(mobile), background: '#2F6B4F' }}>
          <span style={{ flex: 1, fontSize: mobile ? 12.5 : 13 }}>{message}</span>
        </div>
      )}

      {premiere && (
        <div role="alert" aria-live="polite" style={barStyle(mobile)}>
          <span
            aria-hidden="true"
            style={{ width: 9, height: 9, borderRadius: '50%', background: '#F5F3EC', flexShrink: 0, animation: 'cgcTaskPulse 1.4s ease-in-out infinite' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: mobile ? 12.5 : 13, lineHeight: 1.3 }}>
              {premiere.via_team_id
                ? `👥 Nouvelle tâche pour le groupe ${premiere.via_team_name || ''} — à prendre`
                : `📌 ${premiere.assigned_by_name || 'Quelqu’un'} vous a confié une tâche`}
              {autres > 0 && (
                <button
                  type="button"
                  className="cgcTaskBtn"
                  onClick={() => setOuvert((v) => !v)}
                  style={{ marginLeft: 8, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  +{autres} {ouvert ? '▲' : '▼'}
                </button>
              )}
            </div>
            <div style={{ fontSize: mobile ? 12 : 12.5, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              « {resume(premiere, mobile ? 70 : 140)} »
              {premiere.intitule_tiers || premiere.numero_tiers ? ` · ${premiere.intitule_tiers || premiere.numero_tiers}` : ''}
              {premiere.due_date ? ` · échéance ${formatEcheance(premiere.due_date)}` : ''}
              {premiere.via_team_id && premiere.assigned_by_name ? ` · par ${premiere.assigned_by_name}` : ''}
            </div>
          </div>
          <Actions
            a={premiere}
            mobile={mobile}
            busy={busyId === premiere.id}
            onOuvrir={() => void ouvrir(premiere)}
            onPrendre={() => void prendre(premiere)}
            onVu={() => void marquerVues([premiere.id])}
          />
        </div>
      )}

      {ouvert && autres > 0 && (
        <div style={{ background: 'rgba(43,31,64,0.97)', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: mobile ? '4px 12px 8px' : '6px 24px 10px' }}>
          {alertes.slice(1).map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>
                  {a.via_team_id ? `👥 Groupe ${a.via_team_name || ''}` : `📌 De ${a.assigned_by_name || '—'}`}
                  {a.due_date ? <span style={{ fontWeight: 400, opacity: 0.8 }}> · échéance {formatEcheance(a.due_date)}</span> : null}
                </div>
                <div style={{ opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  « {resume(a, mobile ? 60 : 120)} »{a.intitule_tiers || a.numero_tiers ? ` · ${a.intitule_tiers || a.numero_tiers}` : ''}
                </div>
              </div>
              <Actions
                a={a}
                mobile={mobile}
                busy={busyId === a.id}
                onOuvrir={() => void ouvrir(a)}
                onPrendre={() => void prendre(a)}
                onVu={() => void marquerVues([a.id])}
              />
            </div>
          ))}
          <div style={{ textAlign: 'right', paddingTop: 6 }}>
            <button
              type="button"
              className="cgcTaskBtn"
              onClick={() => { void marquerVues(null); setOuvert(false) }}
              style={{ border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Tout marquer comme vu
            </button>
          </div>
        </div>
      )}

      {/* Portail : le bandeau mobile a un backdrop-filter, qui piégerait un position: fixed. */}
      {tacheOuverte &&
        createPortal(
          <MobileTaskDetailSheet
            task={tacheOuverte}
            onClose={() => setTacheOuverte(null)}
            onSaved={() => window.dispatchEvent(new Event('cegeclim:tasks-changed'))}
          />,
          document.body
        )}
    </>
  )
}

function Actions({
  a, mobile, busy, onOuvrir, onPrendre, onVu,
}: {
  a: AlerteTache
  mobile: boolean
  busy: boolean
  onOuvrir: () => void
  onPrendre: () => void
  onVu: () => void
}) {
  const btn: React.CSSProperties = {
    border: 'none', borderRadius: 9, padding: mobile ? '7px 10px' : '7px 12px',
    fontSize: mobile ? 12 : 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {a.via_team_id && (
        <button type="button" className="cgcTaskBtn" onClick={onPrendre} disabled={busy} style={{ ...btn, background: '#F5F3EC', color: '#2B1F40' }}>
          {busy ? '…' : '✋ Je la prends'}
        </button>
      )}
      <button
        type="button"
        className="cgcTaskBtn"
        onClick={onOuvrir}
        style={{ ...btn, background: a.via_team_id ? 'rgba(255,255,255,0.18)' : '#F5F3EC', color: a.via_team_id ? '#fff' : '#2B1F40' }}
      >
        Ouvrir
      </button>
      <button
        type="button"
        className="cgcTaskBtn"
        onClick={onVu}
        aria-label="Marquer comme vu"
        title="Marquer comme vu"
        style={{ ...btn, background: 'transparent', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.3)', padding: mobile ? '6px 9px' : '6px 10px' }}
      >
        {mobile ? '✕' : 'Vu'}
      </button>
    </div>
  )
}

function barStyle(mobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: mobile ? 9 : 12,
    padding: mobile ? '9px 12px' : '9px 24px',
    background: 'linear-gradient(90deg, #7A5EA8 0%, #5E4688 100%)',
    color: '#fff',
    borderBottom: '1px solid rgba(255,255,255,0.15)',
    boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
    fontFamily: 'var(--font-body)',
  }
}
