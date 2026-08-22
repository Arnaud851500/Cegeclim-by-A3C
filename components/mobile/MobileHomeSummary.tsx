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
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          width: '100%', padding: '9px 8px', borderRadius: 10,
          border: '1px solid rgba(75,146,172,0.4)', background: 'rgba(75,146,172,0.14)',
          color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', lineHeight: 1.25,
        }}
      >
        🔊 Résumé vocal
      </button>
    )
  }

  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(75,146,172,0.3)', background: 'rgba(75,146,172,0.08)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.45)' }}>
          Résumé vocal
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {lectureEnCours && (
            <button
              type="button"
              onClick={arreterLecture}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.08)',
                color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ⏹ Stop
            </button>
          )}
          <button type="button" onClick={fermer} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHOIX.map((c) => (
          <button
            key={c.portee}
            type="button"
            onClick={() => void genererResume(c.portee)}
            disabled={chargement !== null}
            style={{
              padding: '8px 12px', borderRadius: 999, border: '1px solid rgba(75,146,172,0.4)',
              background: chargement === c.portee ? 'rgba(75,146,172,0.35)' : 'rgba(75,146,172,0.12)',
              color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {chargement === c.portee ? '…' : c.label}
          </button>
        ))}
      </div>

      {erreur && <div style={{ fontSize: 12.5, color: '#e0a685' }}>{erreur}</div>}

      {texte && (
        <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', padding: '10px 12px' }}>
          <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{texte}</div>
          <button
            type="button"
            onClick={() => void jouerTexte(texte)}
            disabled={lectureEnCours}
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#8FC7DA', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >
            🔊 {lectureEnCours ? 'Lecture…' : 'Réécouter'}
          </button>
        </div>
      )}
    </div>
  )
}
