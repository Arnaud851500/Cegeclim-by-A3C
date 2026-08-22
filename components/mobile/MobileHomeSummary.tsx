'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * Bouton "Résumé vocal" pour l'accueil : lit à voix haute (et affiche) soit
 * les tâches à échéance du jour/de la semaine, soit les prochains rdv.
 *
 * Volontairement SANS IA : contrairement à VoiceReportButtons, il n'y a
 * rien à interpréter ici (pas de dictée), juste des données déjà en base à
 * mettre en forme — un formatage déterministe est plus rapide, plus fiable
 * (aucun risque de "rien à synthétiser"), et gratuit. Seule la lecture à
 * voix haute passe par /api/atelier-ai/speak.
 */

type Portee = 'jour' | 'semaine' | 'rdv'

const CHOIX: Array<{ portee: Portee; label: string }> = [
  { portee: 'jour', label: "Aujourd'hui" },
  { portee: 'semaine', label: 'Cette semaine' },
  { portee: 'rdv', label: 'Prochains rdv' },
]

const RDV_TYPE_KEYS = ['meeting', 'phoneCall', 'reminder', '4', '7', '9']

function safeText(value: any) {
  return String(value ?? '').trim()
}
function formatDateCourte(value: any) {
  const text = safeText(value)
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return text
  return `${m[3]}/${m[2]}`
}
function finDeSemaineIso() {
  const d = new Date()
  const jour = d.getDay() || 7 // dimanche = 0 -> 7, pour une semaine lun-dim
  d.setDate(d.getDate() + (7 - jour))
  return d.toISOString().slice(0, 10)
}
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export default function MobileHomeSummary({ userEmail }: { userEmail?: string | null }) {
  const [ouvert, setOuvert] = useState(false)
  const [chargement, setChargement] = useState<Portee | null>(null)
  const [texte, setTexte] = useState('')
  const [erreur, setErreur] = useState('')
  const [lectureEnCours, setLectureEnCours] = useState(false)
  const audioEnCoursRef = useRef<HTMLAudioElement | null>(null)
  const resolveLectureRef = useRef<(() => void) | null>(null)

  async function jouerTexte(texte: string) {
    if (!texte) return
    setLectureEnCours(true)
    try {
      const res = await fetch('/api/atelier-ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texte }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioEnCoursRef.current = audio
      await new Promise<void>((resolve) => {
        resolveLectureRef.current = resolve
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        void audio.play().catch(() => resolve())
      })
      URL.revokeObjectURL(url)
    } catch {
      // silencieux : le texte reste affiché à l'écran dans tous les cas.
    } finally {
      audioEnCoursRef.current = null
      resolveLectureRef.current = null
      setLectureEnCours(false)
    }
  }

  /** Coupe la lecture à tout moment. pause() ne déclenche pas onended, donc
   * on résout manuellement la promesse en attente. */
  function arreterLecture() {
    if (audioEnCoursRef.current) {
      try { audioEnCoursRef.current.pause() } catch {}
    }
    if (resolveLectureRef.current) {
      resolveLectureRef.current()
      resolveLectureRef.current = null
    }
  }

  async function genererResume(portee: Portee) {
    setChargement(portee)
    setErreur('')
    setTexte('')

    try {
      const email = String(userEmail || '').toLowerCase().trim()
      if (!email) throw new Error('Utilisateur non identifié.')

      const { data: access } = await supabase
        .from('user_page_access')
        .select('display_name, blg_partner_id')
        .eq('email', email)
        .maybeSingle()

      const displayName = String(access?.display_name || '').trim() || email.split('@')[0]

      let resultat = ''

      if (portee === 'rdv') {
        if (!access?.blg_partner_id) {
          throw new Error('Identifiant partner BLG non renseigné pour ce compte.')
        }

        const { data: rows, error } = await supabase
          .from('crm_base_activity')
          .select('type, comment, start_date')
          .eq('internal_tag', 'normal')
          .in('type', RDV_TYPE_KEYS)
          .eq('from_fk', access.blg_partner_id)
          .gte('start_date', new Date().toISOString())
          .order('start_date', { ascending: true })
          .limit(10)

        if (error) throw error

        if (!rows || rows.length === 0) {
          resultat = "Tu n'as aucun rendez-vous à venir."
        } else {
          const lignes = rows.map((r: any, i: number) => {
            const d = new Date(r.start_date)
            const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' })
            const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            const sujet = safeText(r.comment) || 'sans sujet précisé'
            return `${i + 1}. ${dateLabel} à ${heure} — ${sujet}`
          })
          resultat = `Voici tes ${rows.length} prochain${rows.length > 1 ? 's' : ''} rendez-vous :\n${lignes.join('\n')}`
        }
      } else {
        const identities = Array.from(new Set([email, displayName]))
        const assignedFilter = identities.map((v) => `assigned_to.eq.${v.replace(/,/g, '\\,')}`).join(',')
        const fin = portee === 'jour' ? todayIso() : finDeSemaineIso()

        const { data: rows, error } = await supabase
          .from('todo_actions')
          .select('description_action, due_date')
          .or(assignedFilter)
          .not('status', 'in', '("Terminé","Annulé")')
          .not('due_date', 'is', null)
          .lte('due_date', fin)
          .order('due_date', { ascending: true })
          .limit(30)

        if (error) throw error

        const periodeTexte = portee === 'jour' ? "pour aujourd'hui (ou en retard)" : 'cette semaine (ou en retard)'

        if (!rows || rows.length === 0) {
          resultat = `Tu n'as aucune tâche ${periodeTexte}.`
        } else {
          const lignes = rows.map(
            (r: any, i: number) => `${i + 1}. ${safeText(r.description_action) || '(sans libellé)'} (${formatDateCourte(r.due_date)})`,
          )
          resultat = `Tu as ${rows.length} tâche${rows.length > 1 ? 's' : ''} ${periodeTexte} :\n${lignes.join('\n')}`
        }
      }

      setTexte(resultat)
      void jouerTexte(resultat)
    } catch (e: any) {
      setErreur(e?.message || 'Erreur inattendue.')
    } finally {
      setChargement(null)
    }
  }

  function fermer() {
    setOuvert(false)
    setTexte('')
    setErreur('')
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          width: '100%', height: 52, padding: '0 10px', borderRadius: 12,
          border: '1px solid rgba(75,146,172,0.4)', background: 'rgba(75,146,172,0.14)',
          color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', lineHeight: 1.25,
        }}
      >
        🔊 Résumé vocal
      </button>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 230, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={fermer}
    >
      <div
        style={{
          width: '100%', maxWidth: 520, height: '92vh', maxHeight: '92vh',
          background: '#141A26', borderTopLeftRadius: 24, borderTopRightRadius: 24,
          border: '1px solid rgba(75,146,172,0.3)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '14px auto 6px', flexShrink: 0 }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px 16px', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
            🔊 Résumé vocal
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lectureEnCours && (
              <button
                type="button"
                onClick={arreterLecture}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)',
                  color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                ⏹ Stop
              </button>
            )}
            <button type="button" onClick={fermer} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {CHOIX.map((c) => (
              <button
                key={c.portee}
                type="button"
                onClick={() => void genererResume(c.portee)}
                disabled={chargement !== null}
                style={{
                  flex: '1 1 30%', minWidth: 100, padding: '16px 10px', borderRadius: 14,
                  border: '1px solid rgba(75,146,172,0.4)',
                  background: chargement === c.portee ? 'rgba(75,146,172,0.4)' : 'rgba(75,146,172,0.14)',
                  color: '#fff', fontSize: 15.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {chargement === c.portee ? '…' : c.label}
              </button>
            ))}
          </div>

          {erreur && <div style={{ fontSize: 14, color: '#e0a685' }}>{erreur}</div>}

          {texte && (
            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', padding: '18px 16px' }}>
              <div style={{ fontSize: 17, color: '#fff', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{texte}</div>
              <button
                type="button"
                onClick={() => void jouerTexte(texte)}
                disabled={lectureEnCours}
                style={{ marginTop: 16, width: '100%', padding: '14px', borderRadius: 12, border: '1px solid rgba(143,199,218,0.4)', background: 'rgba(143,199,218,0.14)', color: '#8FC7DA', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                🔊 {lectureEnCours ? 'Lecture…' : 'Réécouter'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
