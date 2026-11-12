'use client'

// =============================================================================
// Bandeau « Un ticket hotline vous a été confié » (12/11/2026, demandé par Arnaud)
// =============================================================================
// Même principe que le bandeau des tâches affectées (TaskAssignmentBanner) :
// bandeau violet en haut de l'écran, sur PC (ClientRootShell) et sur mobile
// (MobileBrandBar), dès qu'un ticket hotline m'est confié par quelqu'un d'autre :
//   - escalade (N1 → N2, N2 → N3) vers moi ;
//   - retour au niveau inférieur (N2 → N1) vers moi ;
//   - rappel du client à faire par moi.
// Source : RPC get_mes_alertes_hotline() (table hotline_notifications alimentée
// par trigger sur hotline_ticket_etapes, migration 20261112h). Lecture toutes
// les 60 s, au changement d'écran et au retour sur l'onglet / l'app.
// Clic sur le bandeau (12/11/2026) : un seul ticket → on bascule directement sur
// CE ticket (console sur PC, fiche sur mobile) ; plusieurs tickets en attente →
// fenêtre flottante listant les tickets, et le ticket choisi s'ouvre.
// « Vu » masque l'alerte. Un ticket résolu ne s'affiche plus.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type AlerteHotline = {
  id: string
  ticket_id: string
  numero: string
  type: 'ESCALADE' | 'REDESCENTE' | 'RAPPEL'
  niveau: number | null
  statut: string | null
  filiere: string | null
  intitule_tiers: string | null
  numero_tiers: string | null
  description: string | null
  auteur_nom: string | null
  auteur_email: string | null
  message: string | null
  created_at: string
}

const POLL_MS = 60_000

function titre(a: AlerteHotline) {
  const qui = a.auteur_nom || 'Quelqu’un'
  if (a.type === 'RAPPEL') return `📞 ${qui} vous demande de rappeler un client — ticket ${a.numero}`
  if (a.type === 'REDESCENTE') return `↩️ ${qui} vous a renvoyé le ticket ${a.numero} (niveau ${a.niveau ?? 1})`
  return `🎧 ${qui} vous a escaladé le ticket ${a.numero} (niveau ${a.niveau ?? 2})`
}

function detail(a: AlerteHotline, max: number) {
  const motif = String(a.description || '').replace(/\s+/g, ' ').trim()
  const consigne = String(a.message || '')
    .replace(/^(Escalade niveau \d|Retour au niveau \d|Client à rappeler par)[^:]*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const morceaux = [
    a.intitule_tiers || a.numero_tiers || '',
    consigne ? `« ${consigne} »` : motif ? `« ${motif} »` : '',
    a.filiere === 'PV' ? 'Photo' : a.filiere === 'THERMIQUE' ? 'Thermie' : '',
  ].filter(Boolean)
  const txt = morceaux.join(' · ')
  return txt.length > max ? `${txt.slice(0, max - 1)}…` : txt
}

export default function HotlineAssignmentBanner({ variant }: { variant: 'desktop' | 'mobile' }) {
  const router = useRouter()
  const pathname = usePathname()
  const [alertes, setAlertes] = useState<AlerteHotline[]>([])
  const [liste, setListe] = useState(false)
  const indisponibleRef = useRef(false)

  const charger = useCallback(async () => {
    if (indisponibleRef.current) return
    const { data, error } = await supabase.rpc('get_mes_alertes_hotline')
    if (error) {
      if (/function|does not exist|schema cache/i.test(error.message || '')) indisponibleRef.current = true
      return
    }
    setAlertes((data || []) as AlerteHotline[])
  }, [])

  useEffect(() => {
    const premier = window.setTimeout(() => void charger(), 0)
    const timer = window.setInterval(() => void charger(), POLL_MS)
    function auRetour() {
      if (document.visibilityState === 'visible') void charger()
    }
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('focus', auRetour)
    return () => {
      window.clearTimeout(premier)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', auRetour)
      window.removeEventListener('focus', auRetour)
    }
  }, [charger])

  // Changement d'écran : on revérifie.
  useEffect(() => {
    const t = window.setTimeout(() => void charger(), 0)
    return () => window.clearTimeout(t)
  }, [pathname, charger])

  useEffect(() => {
    if (!liste) return
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && setListe(false)
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [liste])

  async function marquerVues(ids: string[] | null) {
    setAlertes((cur) => (ids ? cur.filter((a) => !ids.includes(a.id)) : []))
    await supabase.rpc('marquer_alertes_hotline_vues', { p_ids: ids })
  }

  /** Bascule sur LE ticket : console sur PC, fiche du ticket sur mobile. */
  function ouvrirTicket(a: AlerteHotline) {
    // Toutes les alertes de ce ticket sont traitées d'un coup.
    void marquerVues(alertes.filter((x) => x.ticket_id === a.ticket_id).map((x) => x.id))
    setListe(false)
    router.push(variant === 'mobile' ? `/hotline/tickets?id=${encodeURIComponent(a.ticket_id)}` : `/hotline?ticket=${encodeURIComponent(a.ticket_id)}`)
  }

  const mobile = variant === 'mobile'
  // Un ticket peut porter plusieurs alertes (escalade puis rappel…) : une ligne par ticket.
  const parTicket = alertes.filter((a, i) => alertes.findIndex((x) => x.ticket_id === a.ticket_id) === i)
  const premiere = parTicket[0]
  if (!premiere) return null
  const plusieurs = parTicket.length > 1

  function clicBandeau() {
    if (plusieurs) setListe(true)
    else ouvrirTicket(premiere)
  }

  return (
    <>
      <style>{`
        @keyframes cgcHotlinePulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(1.35); } }
        .cgcHotlineBtn:hover { filter: brightness(1.12); }
        .cgcHotlineBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
        .cgcHotlineBar:hover { filter: brightness(1.06); }
        .cgcHotlineLigne:hover { background: #F4F0FA; }
      `}</style>

      <div
        role="button"
        tabIndex={0}
        aria-live="polite"
        className="cgcHotlineBar"
        onClick={clicBandeau}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            clicBandeau()
          }
        }}
        title={plusieurs ? 'Choisir le ticket à ouvrir' : 'Ouvrir le ticket'}
        style={{ ...barStyle(mobile), cursor: 'pointer' }}
      >
        <span
          aria-hidden="true"
          style={{ width: 9, height: 9, borderRadius: '50%', background: '#F5F3EC', flexShrink: 0, animation: 'cgcHotlinePulse 1.4s ease-in-out infinite' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: mobile ? 12.5 : 13, lineHeight: 1.3 }}>
            {plusieurs ? `🎧 ${parTicket.length} tickets hotline vous ont été confiés — cliquer pour choisir` : titre(premiere)}
          </div>
          <div style={{ fontSize: mobile ? 12 : 12.5, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {plusieurs
              ? parTicket
                  .slice(0, 4)
                  .map((a) => `${a.numero}${a.intitule_tiers ? ` (${a.intitule_tiers})` : ''}`)
                  .join(' · ') + (parTicket.length > 4 ? ' …' : '')
              : detail(premiere, mobile ? 80 : 160)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span className="cgcHotlineBtn" style={{ ...bouton(mobile), background: '#F5F3EC', color: '#2B1F40' }}>
            {plusieurs ? `Choisir (${parTicket.length})` : 'Ouvrir le ticket'}
          </span>
          {!plusieurs ? (
            <button
              type="button"
              className="cgcHotlineBtn"
              onClick={(e) => {
                e.stopPropagation()
                void marquerVues(alertes.filter((x) => x.ticket_id === premiere.ticket_id).map((x) => x.id))
              }}
              aria-label="Marquer comme vu"
              title="Marquer comme vu"
              style={{ ...bouton(mobile), background: 'transparent', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.3)' }}
            >
              {mobile ? '✕' : 'Vu'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Portail : le bandeau mobile a un backdrop-filter, qui piégerait un position: fixed. */}
      {liste &&
        createPortal(
          <div
            onClick={() => setListe(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(6,10,18,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, fontFamily: 'var(--font-body)' }}
          >
            <div
              role="dialog"
              aria-label="Tickets hotline qui vous ont été confiés"
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
            >
              <div style={{ background: 'linear-gradient(90deg, #7A5EA8 0%, #5E4688 100%)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>🎧 {parTicket.length} tickets vous ont été confiés</div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>Choisir le ticket à ouvrir</div>
                </div>
                <button type="button" onClick={() => setListe(false)} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 8, padding: '6px 10px', fontWeight: 700, cursor: 'pointer' }}>
                  Fermer ✕
                </button>
              </div>
              <div style={{ overflowY: 'auto' }}>
                {parTicket.map((a) => (
                  <div
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    className="cgcHotlineLigne"
                    onClick={() => ouvrirTicket(a)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') ouvrirTicket(a)
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid #EFEDE8', cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{titre(a)}</div>
                      <div style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail(a, 120)}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>
                        {new Date(a.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {a.statut === 'ESCALADE' ? ' · en escalade' : ''}
                      </div>
                    </div>
                    <span style={{ ...bouton(false), background: '#7A5EA8', color: '#fff' }}>Ouvrir</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void marquerVues(alertes.filter((x) => x.ticket_id === a.ticket_id).map((x) => x.id))
                      }}
                      title="Marquer comme vu sans ouvrir"
                      style={{ ...bouton(false), background: 'transparent', color: '#64748B', border: '1px solid #E2DFD8' }}
                    >
                      Vu
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 18px', textAlign: 'right', borderTop: '1px solid #EFEDE8' }}>
                <button
                  type="button"
                  onClick={() => {
                    void marquerVues(null)
                    setListe(false)
                  }}
                  style={{ border: '1px solid #E2DFD8', background: '#fff', color: '#334155', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Tout marquer comme vu
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function bouton(mobile: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 9,
    padding: mobile ? '7px 10px' : '7px 12px',
    fontSize: mobile ? 12 : 12.5,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'inline-block',
  }
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
