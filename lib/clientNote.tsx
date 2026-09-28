'use client'

// lib/clientNote.tsx
//
// ÉVOLUTION (2026-09-28) : note libre par client -- petit bouton "i" affiché
// sur la fiche client (mobile "Mes clients", Synthèse multi-clients, Vision
// client). Un clic ouvre une fenêtre où l'on saisit ce que l'on veut.
//
// Stockage : table public.client_notes (une note partagée par client,
// numero_tiers en clé primaire, auteur + date de dernière modification).
// Une note vidée est supprimée de la table.
//
// Le "i" est plein (ambre) quand une note existe, en contour gris sinon.
//   - Sur une fiche (mobile, Vision client) : ne pas passer `hasNote`, le
//     composant vérifie lui-même s'il existe une note.
//   - Sur une liste (SMC) : passer `hasNote` depuis fetchNumerosAvecNote()
//     (une seule requête pour tous les clients) et `onHasNoteChange` pour
//     mettre à jour l'ensemble après enregistrement.
//
// La fenêtre est rendue dans document.body (portail) : elle n'est donc pas
// gênée par un tableau à cellules collantes, un conteneur qui défile ou une
// coque mobile transformée, et les clics ne remontent pas à la ligne du
// tableau.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabaseClient'

export type ClientNote = {
  numero_tiers: string
  note: string
  updated_by_email: string | null
  updated_by_name: string | null
  updated_at: string
}

function cleNumero(numero: string | null | undefined): string {
  return String(numero ?? '').trim()
}

/** Numéros de tous les clients qui ont une note non vide (pagination 1000). */
export async function fetchNumerosAvecNote(): Promise<Set<string>> {
  const numeros = new Set<string>()
  const taille = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('client_notes')
      .select('numero_tiers')
      .neq('note', '')
      .order('numero_tiers', { ascending: true })
      .range(from, from + taille - 1)
    if (error) throw error
    const rows = (data || []) as { numero_tiers: string | null }[]
    rows.forEach((r) => { const n = cleNumero(r.numero_tiers); if (n) numeros.add(n) })
    if (rows.length < taille) break
    from += taille
  }
  return numeros
}

export async function fetchClientNote(numero: string): Promise<ClientNote | null> {
  const { data, error } = await supabase
    .from('client_notes')
    .select('numero_tiers, note, updated_by_email, updated_by_name, updated_at')
    .eq('numero_tiers', cleNumero(numero))
    .maybeSingle()
  if (error) throw error
  if (!data || !String(data.note || '').trim()) return null
  return data as ClientNote
}

async function identiteUtilisateur(): Promise<{ email: string | null; nom: string | null }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const email = sessionData.session?.user?.email?.toLowerCase() || null
  if (!email) return { email: null, nom: null }
  const { data } = await supabase.from('user_page_access').select('display_name').ilike('email', email).maybeSingle()
  const nom = String(data?.display_name || '').trim() || email.split('@')[0]
  return { email, nom }
}

/** Enregistre la note (texte vide -> suppression). Renvoie la note à jour, ou null si supprimée. */
export async function saveClientNote(numero: string, texte: string): Promise<ClientNote | null> {
  const numeroTiers = cleNumero(numero)
  if (!numeroTiers) throw new Error('Numéro de client manquant.')
  if (!texte.trim()) {
    const { error } = await supabase.from('client_notes').delete().eq('numero_tiers', numeroTiers)
    if (error) throw error
    return null
  }
  const { email, nom } = await identiteUtilisateur()
  const { data, error } = await supabase
    .from('client_notes')
    .upsert(
      {
        numero_tiers: numeroTiers,
        note: texte,
        updated_by_email: email,
        updated_by_name: nom,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'numero_tiers' },
    )
    .select('numero_tiers, note, updated_by_email, updated_by_name, updated_at')
    .single()
  if (error) throw error
  return data as ClientNote
}

function formatDateHeure(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type Variante = 'light' | 'dark'

const PALETTE: Record<Variante, {
  overlay: string; carte: string; bord: string; texte: string; texteDoux: string
  champFond: string; champBord: string; boutonFond: string; boutonTexte: string
  secondaireBord: string; secondaireTexte: string; danger: string
  iVide: string; iVideBord: string
}> = {
  light: {
    overlay: 'rgba(15,23,42,0.45)', carte: '#ffffff', bord: '#e2e8f0', texte: '#0f172a', texteDoux: '#64748b',
    champFond: '#f8fafc', champBord: '#cbd5e1', boutonFond: '#2E5BB8', boutonTexte: '#ffffff',
    secondaireBord: '#cbd5e1', secondaireTexte: '#475569', danger: '#b91c1c',
    iVide: '#64748b', iVideBord: '#94a3b8',
  },
  dark: {
    overlay: 'rgba(6,10,18,0.7)', carte: '#141A26', bord: 'rgba(255,255,255,0.1)', texte: '#ffffff', texteDoux: 'rgba(255,255,255,0.5)',
    champFond: 'rgba(255,255,255,0.05)', champBord: 'rgba(255,255,255,0.18)', boutonFond: '#A6A181', boutonTexte: '#141A26',
    secondaireBord: 'rgba(255,255,255,0.18)', secondaireTexte: 'rgba(255,255,255,0.75)', danger: '#e0a685',
    iVide: 'rgba(255,255,255,0.6)', iVideBord: 'rgba(255,255,255,0.35)',
  },
}

const COULEUR_NOTE = '#D69A4A'

export function ClientNoteButton({
  numeroTiers,
  clientNom,
  variant = 'light',
  size = 20,
  hasNote,
  onHasNoteChange,
}: {
  numeroTiers: string
  clientNom?: string | null
  variant?: Variante
  size?: number
  /** Connu à l'avance (listes) ; si absent, le composant le vérifie lui-même. */
  hasNote?: boolean
  onHasNoteChange?: (numeroTiers: string, hasNote: boolean) => void
}) {
  const p = PALETTE[variant]
  const [aUneNoteLocal, setAUneNoteLocal] = useState<boolean | null>(null)
  const aUneNote = hasNote ?? aUneNoteLocal ?? false

  const [ouvert, setOuvert] = useState(false)
  const [chargement, setChargement] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')
  const [texte, setTexte] = useState('')
  const [note, setNote] = useState<ClientNote | null>(null)
  const ouvertureRef = useRef(0)

  // Fiche seule : vérifie s'il existe une note pour colorer le "i".
  useEffect(() => {
    if (hasNote !== undefined || !numeroTiers) return
    let annule = false
    setAUneNoteLocal(null)
    fetchClientNote(numeroTiers)
      .then((n) => { if (!annule) setAUneNoteLocal(Boolean(n)) })
      .catch((e) => { console.warn('[clientNote] lecture impossible :', e); if (!annule) setAUneNoteLocal(false) })
    return () => { annule = true }
  }, [numeroTiers, hasNote])

  async function ouvrir(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    ouvertureRef.current = Date.now()
    setOuvert(true)
    setErreur('')
    setChargement(true)
    try {
      const n = await fetchClientNote(numeroTiers)
      setNote(n)
      setTexte(n?.note || '')
    } catch (err: any) {
      setErreur(err?.message || 'Lecture de la note impossible.')
      setNote(null)
      setTexte('')
    } finally {
      setChargement(false)
    }
  }

  function fermer() {
    if (enregistrement) return
    setOuvert(false)
  }

  // Fermeture au clavier (Échap) sur desktop.
  useEffect(() => {
    if (!ouvert) return
    function surTouche(ev: KeyboardEvent) { if (ev.key === 'Escape') fermer() }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, enregistrement])

  async function enregistrer(valeur: string) {
    setEnregistrement(true)
    setErreur('')
    try {
      const n = await saveClientNote(numeroTiers, valeur)
      setNote(n)
      const existe = Boolean(n)
      setAUneNoteLocal(existe)
      onHasNoteChange?.(cleNumero(numeroTiers), existe)
      setOuvert(false)
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors de l'enregistrement.")
    } finally {
      setEnregistrement(false)
    }
  }

  const modifie = texte !== (note?.note || '')

  return (
    <>
      <button
        type="button"
        onClick={(e) => void ouvrir(e)}
        title={aUneNote ? 'Note client (voir / modifier)' : 'Ajouter une note client'}
        aria-label={aUneNote ? 'Voir la note client' : 'Ajouter une note client'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: size, height: size, borderRadius: '50%', padding: 0, cursor: 'pointer', verticalAlign: 'middle',
          border: `1.5px solid ${aUneNote ? COULEUR_NOTE : p.iVideBord}`,
          background: aUneNote ? COULEUR_NOTE : 'transparent',
          color: aUneNote ? '#ffffff' : p.iVide,
          fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700,
          fontSize: Math.round(size * 0.62), lineHeight: 1,
        }}
      >
        i
      </button>

      {ouvert && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => {
            e.stopPropagation()
            // Anti "clic fantôme" tactile : ignore un tap juste après l'ouverture.
            if (Date.now() - ouvertureRef.current < 400) return
            fermer()
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: p.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto',
              background: p.carte, color: p.texte, border: `1px solid ${p.bord}`, borderRadius: 16,
              boxShadow: '0 24px 60px rgba(15,23,42,0.35)', padding: '16px 18px 18px',
              display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left',
              fontFamily: 'inherit', whiteSpace: 'normal',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%',
                      background: COULEUR_NOTE, color: '#fff', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 14,
                    }}
                  >
                    i
                  </span>
                  Note client
                </div>
                <div style={{ fontSize: 12.5, color: p.texteDoux, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[clientNom, `N° ${numeroTiers}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                type="button"
                onClick={fermer}
                aria-label="Fermer"
                style={{
                  flexShrink: 0, width: 30, height: 30, borderRadius: '50%', border: `1px solid ${p.secondaireBord}`,
                  background: 'transparent', color: p.secondaireTexte, fontSize: 14, cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {chargement ? (
              <div style={{ fontSize: 13, color: p.texteDoux, padding: '18px 0' }}>Chargement…</div>
            ) : (
              <>
                <textarea
                  value={texte}
                  onChange={(e) => setTexte(e.target.value)}
                  rows={8}
                  autoFocus
                  placeholder="Saisir une note sur ce client (contexte, habitudes, points d'attention…)"
                  style={{
                    width: '100%', minHeight: 160, borderRadius: 10, border: `1px solid ${p.champBord}`,
                    background: p.champFond, color: p.texte, padding: '10px 12px', fontSize: 14.5, lineHeight: 1.45,
                    resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
                {note?.updated_at && (
                  <div style={{ fontSize: 11.5, color: p.texteDoux, marginTop: -4 }}>
                    Modifiée le {formatDateHeure(note.updated_at)}{note.updated_by_name ? ` par ${note.updated_by_name}` : ''}
                  </div>
                )}
              </>
            )}

            {erreur && <div style={{ fontSize: 13, color: p.danger }}>{erreur}</div>}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void enregistrer(texte)}
                disabled={chargement || enregistrement || !modifie}
                style={{
                  flex: 1, minWidth: 140, padding: '11px 14px', borderRadius: 10, border: 'none',
                  background: p.boutonFond, color: p.boutonTexte, fontSize: 14, fontWeight: 800,
                  opacity: chargement || enregistrement || !modifie ? 0.5 : 1, cursor: 'pointer',
                }}
              >
                {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                onClick={fermer}
                disabled={enregistrement}
                style={{
                  padding: '11px 14px', borderRadius: 10, border: `1px solid ${p.secondaireBord}`,
                  background: 'transparent', color: p.secondaireTexte, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              {note && (
                <button
                  type="button"
                  onClick={() => { if (window.confirm('Effacer la note de ce client ?')) void enregistrer('') }}
                  disabled={enregistrement}
                  style={{
                    padding: '11px 14px', borderRadius: 10, border: `1px solid ${p.secondaireBord}`,
                    background: 'transparent', color: p.danger, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Effacer
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
