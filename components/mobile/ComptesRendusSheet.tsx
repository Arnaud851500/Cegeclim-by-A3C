'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * ComptesRendusSheet (2026-09-29) — retrouver un compte-rendu passé, y
 * compris sur un RDV sans client (prospect pas encore créé dans SAGE).
 *
 * Utilisé par l'agenda PC (app/agenda/page.tsx) et par Mes rdv mobile
 * (components/mobile/MobileRdv.tsx). Lit la vue v_comptes_rendus_liste
 * (migration 20260929_rdv_sans_client_comptes_rendus.sql) :
 *   - « Mes CR » (par défaut) ou « Toute l'équipe » ;
 *   - filtre « Sans client » : CR rattachés seulement à un RDV (prospect) ;
 *   - recherche texte dans le client / prospect, l'objet du RDV, le résumé
 *     et la transcription.
 * Un tap sur une ligne affiche le compte-rendu complet.
 *
 * Quand le prospect devient client : modifier le RDV et choisir le client
 * -> tous ses CR passent automatiquement sur ce client (trigger
 * rdv_compagnon_rattacher_cr) et apparaissent dans sa fiche.
 */

type CrLigne = {
  id: string
  created_at: string
  created_by_email: string | null
  created_by_name: string | null
  resume: string | null
  transcript: string | null
  numero_tiers: string | null
  interlocuteur: string | null
  rdv_objet: string | null
  rdv_date: string | null
  sans_client: boolean
}

const LIMITE = 100

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Retire les caractères qui cassent la syntaxe du filtre .or() PostgREST. */
function nettoyerRecherche(q: string) {
  return q.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function ComptesRendusSheet({
  currentEmail,
  onClose,
  onOpenClient,
}: {
  currentEmail: string
  onClose: () => void
  /** Optionnel : ouvre la fiche client (mobile) / Vision client 360 (PC). */
  onOpenClient?: (numeroTiers: string, nom: string) => void
}) {
  const [portee, setPortee] = useState<'miens' | 'equipe'>('miens')
  const [sansClientSeul, setSansClientSeul] = useState(false)
  const [saisie, setSaisie] = useState('')
  const [recherche, setRecherche] = useState('')
  const [lignes, setLignes] = useState<CrLigne[] | null>(null)
  const [erreur, setErreur] = useState('')
  const [ouvert, setOuvert] = useState<CrLigne | null>(null)

  // Recherche déclenchée 300 ms après la dernière frappe.
  useEffect(() => {
    const t = window.setTimeout(() => setRecherche(nettoyerRecherche(saisie)), 300)
    return () => window.clearTimeout(t)
  }, [saisie])

  useEffect(() => {
    let annule = false
    async function charger() {
      setLignes(null)
      setErreur('')
      let q = supabase
        .from('v_comptes_rendus_liste')
        .select('id, created_at, created_by_email, created_by_name, resume, transcript, numero_tiers, interlocuteur, rdv_objet, rdv_date, sans_client')
        .order('created_at', { ascending: false })
        .limit(LIMITE)
      if (portee === 'miens' && currentEmail) q = q.ilike('created_by_email', currentEmail)
      if (sansClientSeul) q = q.eq('sans_client', true)
      if (recherche) {
        const m = `%${recherche}%`
        q = q.or(`interlocuteur.ilike.${m},rdv_objet.ilike.${m},resume.ilike.${m},transcript.ilike.${m},numero_tiers.ilike.${m}`)
      }
      const { data, error } = await q
      if (annule) return
      if (error) { setErreur(error.message); setLignes([]); return }
      setLignes((data || []) as CrLigne[])
    }
    void charger()
    return () => { annule = true }
  }, [portee, sansClientSeul, recherche, currentEmail])

  const chip = (actif: boolean): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: actif ? '1px solid rgba(166,161,129,0.7)' : '1px solid rgba(255,255,255,0.16)',
    background: actif ? 'rgba(166,161,129,0.22)' : 'transparent',
    color: actif ? '#E4DFC9' : 'rgba(255,255,255,0.7)',
  })

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(6,10,18,0.65)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none', padding: '12px 16px 20px', gap: 10,
          color: '#fff',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />

        {ouvert ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => setOuvert(null)} style={{ ...chip(false), padding: '7px 12px' }}>← Liste</button>
              <div style={{ fontSize: 15, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ouvert.interlocuteur || 'Sans client'}{ouvert.numero_tiers ? ` (${ouvert.numero_tiers})` : ''}
              </div>
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                {ouvert.rdv_objet ? `RDV « ${ouvert.rdv_objet} »` : 'RDV'}
                {ouvert.rdv_date ? ` du ${fmtDate(ouvert.rdv_date)}` : ''} · CR du {fmtDate(ouvert.created_at)}
                {ouvert.created_by_name || ouvert.created_by_email ? ` par ${ouvert.created_by_name || ouvert.created_by_email}` : ''}
              </div>
              {ouvert.sans_client && (
                <div style={{ fontSize: 12, color: '#E8A96A', border: '1px solid rgba(232,169,106,0.35)', borderRadius: 10, padding: '8px 10px' }}>
                  Prospect sans fiche client. Quand il sera créé dans SAGE, modifiez le RDV et choisissez le client :
                  ce compte-rendu passera automatiquement dans sa fiche.
                </div>
              )}
              <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ouvert.resume || '—'}</div>
              {ouvert.transcript && ouvert.transcript !== ouvert.resume && (
                <details>
                  <summary style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}>Transcription complète</summary>
                  <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.8)', whiteSpace: 'pre-wrap' }}>{ouvert.transcript}</div>
                </details>
              )}
              {ouvert.numero_tiers && onOpenClient && (
                <button
                  type="button"
                  onClick={() => { onOpenClient(ouvert.numero_tiers as string, ouvert.interlocuteur || ''); onClose() }}
                  style={{ padding: '12px', borderRadius: 12, border: '1px solid rgba(75,146,172,0.4)', background: 'rgba(75,146,172,0.14)', color: '#8FC7DA', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Voir la fiche client
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Comptes-rendus</div>
            <input
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="Client, prospect, objet du RDV, mot du compte-rendu…"
              style={{ width: '100%', height: 42, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 14.5 }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setPortee('miens')} style={chip(portee === 'miens')}>Mes CR</button>
              <button type="button" onClick={() => setPortee('equipe')} style={chip(portee === 'equipe')}>Toute l&apos;équipe</button>
              <button type="button" onClick={() => setSansClientSeul((v) => !v)} style={chip(sansClientSeul)}>Sans client</button>
            </div>

            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }}>
              {erreur && <div style={{ fontSize: 12.5, color: '#e0a685' }}>Lecture impossible : {erreur}</div>}
              {lignes === null && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Chargement…</div>}
              {lignes && lignes.length === 0 && !erreur && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Aucun compte-rendu trouvé.</div>
              )}
              {lignes?.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setOuvert(l)}
                  style={{
                    textAlign: 'left', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.03)', padding: '10px 12px', color: '#fff', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.interlocuteur || l.rdv_objet || 'Sans client'}
                      {l.numero_tiers ? <span style={{ color: '#E8A96A', fontWeight: 600 }}> · {l.numero_tiers}</span> : null}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>{fmtDate(l.rdv_date || l.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                    {l.sans_client && <span style={{ color: '#E8A96A', fontWeight: 700 }}>Prospect · </span>}
                    {l.rdv_objet || ''}
                    {portee === 'equipe' && (l.created_by_name || l.created_by_email) ? ` · ${l.created_by_name || l.created_by_email}` : ''}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {l.resume || '—'}
                  </div>
                </button>
              ))}
              {lignes && lignes.length === LIMITE && (
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>{LIMITE} plus récents affichés — affinez la recherche.</div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{ padding: '11px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Fermer
            </button>
          </>
        )}
      </div>
    </div>
  )
}
