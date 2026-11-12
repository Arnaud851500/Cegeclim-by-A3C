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
// « Prendre en charge » ouvre le ticket dans la console ; « Fiche » ouvre la
// fiche du ticket ; « Vu » masque l'alerte. Un ticket résolu ne s'affiche plus.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
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
  const [ouvert, setOuvert] = useState(false)
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

  async function marquerVues(ids: string[] | null) {
    setAlertes((cur) => (ids ? cur.filter((a) => !ids.includes(a.id)) : []))
    await supabase.rpc('marquer_alertes_hotline_vues', { p_ids: ids })
  }

  function prendre(a: AlerteHotline) {
    void marquerVues([a.id])
    setOuvert(false)
    router.push(variant === 'mobile' ? `/hotline/tickets?id=${encodeURIComponent(a.ticket_id)}` : `/hotline?ticket=${encodeURIComponent(a.ticket_id)}`)
  }

  function fiche(a: AlerteHotline) {
    void marquerVues([a.id])
    setOuvert(false)
    router.push(`/hotline/tickets?id=${encodeURIComponent(a.ticket_id)}`)
  }

  const mobile = variant === 'mobile'
  const premiere = alertes[0]
  const autres = alertes.length - 1
  if (!premiere) return null

  return (
    <>
      <style>{`
        @keyframes cgcHotlinePulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(1.35); } }
        .cgcHotlineBtn:hover { filter: brightness(1.12); }
        .cgcHotlineBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
      `}</style>

      <div role="alert" aria-live="polite" style={barStyle(mobile)}>
        <span
          aria-hidden="true"
          style={{ width: 9, height: 9, borderRadius: '50%', background: '#F5F3EC', flexShrink: 0, animation: 'cgcHotlinePulse 1.4s ease-in-out infinite' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: mobile ? 12.5 : 13, lineHeight: 1.3 }}>
            {titre(premiere)}
            {autres > 0 && (
              <button
                type="button"
                className="cgcHotlineBtn"
                onClick={() => setOuvert((v) => !v)}
                style={{ marginLeft: 8, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
              >
                +{autres} {ouvert ? '▲' : '▼'}
              </button>
            )}
          </div>
          <div style={{ fontSize: mobile ? 12 : 12.5, opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {detail(premiere, mobile ? 80 : 160)}
          </div>
        </div>
        <Actions mobile={mobile} onPrendre={() => prendre(premiere)} onFiche={() => fiche(premiere)} onVu={() => void marquerVues([premiere.id])} />
      </div>

      {ouvert && autres > 0 && (
        <div style={{ background: 'rgba(43,31,64,0.97)', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: mobile ? '4px 12px 8px' : '6px 24px 10px' }}>
          {alertes.slice(1).map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>{titre(a)}</div>
                <div style={{ opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail(a, mobile ? 70 : 140)}</div>
              </div>
              <Actions mobile={mobile} onPrendre={() => prendre(a)} onFiche={() => fiche(a)} onVu={() => void marquerVues([a.id])} />
            </div>
          ))}
          <div style={{ textAlign: 'right', paddingTop: 6 }}>
            <button
              type="button"
              className="cgcHotlineBtn"
              onClick={() => {
                void marquerVues(null)
                setOuvert(false)
              }}
              style={{ border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Tout marquer comme vu
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function Actions({ mobile, onPrendre, onFiche, onVu }: { mobile: boolean; onPrendre: () => void; onFiche: () => void; onVu: () => void }) {
  const btn: React.CSSProperties = {
    border: 'none',
    borderRadius: 9,
    padding: mobile ? '7px 10px' : '7px 12px',
    fontSize: mobile ? 12 : 12.5,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <button type="button" className="cgcHotlineBtn" onClick={onPrendre} style={{ ...btn, background: '#F5F3EC', color: '#2B1F40' }}>
        {mobile ? 'Ouvrir' : 'Prendre en charge'}
      </button>
      {!mobile && (
        <button type="button" className="cgcHotlineBtn" onClick={onFiche} style={{ ...btn, background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
          Fiche
        </button>
      )}
      <button
        type="button"
        className="cgcHotlineBtn"
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
