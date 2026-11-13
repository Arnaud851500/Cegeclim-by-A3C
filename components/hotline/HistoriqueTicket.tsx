'use client'

/**
 * Historique complet d'un ticket hotline (12/11/2026, demande d'Arnaud).
 *
 * - En tête : la « Note rapide » = motif de l'appel saisi à la création
 *   (étape NOTE_RAPIDE ; pour les tickets repris de l'ancien outil, la
 *   description du ticket).
 * - Puis toute la chronologie, dans l'ordre : commentaires, réponses du
 *   diagnostic, escalades / retours de niveau, rappels, documents, pièces
 *   jointes, résolution… Chaque commentaire ajouté dans la zone centrale
 *   apparaît ici.
 * - Les commentaires internes sont signalés (fond ambré, badge INTERNE) et
 *   exclus de la fiche ticket PDF (masquerInternes).
 * Utilisé par la console (/hotline, haut de la colonne centrale), la fiche du
 * ticket (/hotline/tickets), la fenêtre d'historique et la fiche imprimable.
 */

import { useEffect, useMemo, useRef } from 'react'
import { ETAPE_LIBELLES, estInterne, fmtDateHeure, type Etape, type Ticket } from '@/lib/hotline'

type TicketMini = Pick<Ticket, 'description' | 'opened_at' | 'ouvert_par' | 'source'>

/** Diagnostic repris de l'ancien outil (étape d'import). */
export function estDiagnosticRepris(e: Etape) {
  return e.type === 'COMMENTAIRE' && Boolean(e.details && (e.details as Record<string, unknown>).import) && e.libelle.startsWith('Diagnostic : ')
}

const COMMENTAIRES = new Set(['COMMENTAIRE', 'COMMENTAIRE_INTERNE', 'PRECONISATION', 'RESOLUTION', 'ESCALADE', 'REDESCENTE', 'RAPPEL', 'REPRISE'])

const TONS: Partial<Record<Etape['type'], { bord: string; fond: string; titre: string }>> = {
  COMMENTAIRE: { bord: '#E2DFD8', fond: '#FFFFFF', titre: '#334155' },
  COMMENTAIRE_INTERNE: { bord: '#EBD8AE', fond: '#FDF7EA', titre: '#8A5A11' },
  ESCALADE: { bord: '#F0C5BE', fond: '#FCEFEC', titre: '#A32C2C' },
  REDESCENTE: { bord: '#C9D8EE', fond: '#EEF3FA', titre: '#1E4E8C' },
  RAPPEL: { bord: '#D9CCEB', fond: '#F4F0FA', titre: '#5B3F8C' },
  REPRISE: { bord: '#D9CCEB', fond: '#F4F0FA', titre: '#5B3F8C' },
  PRECONISATION: { bord: '#CDE5D1', fond: '#EEF7EF', titre: '#2F6B3A' },
  RESOLUTION: { bord: '#CDE5D1', fond: '#EEF7EF', titre: '#2F6B3A' },
}

export default function HistoriqueTicket({
  ticket,
  etapes,
  masquerInternes = false,
  hauteurMax = 460,
  impression = false,
}: {
  ticket: TicketMini
  etapes: Etape[]
  masquerInternes?: boolean
  /** Hauteur maximale (px) avant défilement ; 0 = pas de limite. */
  hauteurMax?: number
  impression?: boolean
}) {
  const fin = useRef<HTMLDivElement | null>(null)

  const { note, suite } = useMemo(() => {
    const visibles = etapes.filter((e) => !(masquerInternes && estInterne(e)))
    const notes = visibles.filter((e) => e.type === 'NOTE_RAPIDE')
    const derniere = notes[notes.length - 1] || null
    const noteTicket = derniere
      ? { texte: derniere.libelle, at: derniere.at, auteur: derniere.auteur, modifiee: notes.length > 1 }
      : ticket.description
        ? { texte: ticket.description, at: ticket.opened_at, auteur: ticket.ouvert_par, modifiee: false }
        : null
    return { note: noteTicket, suite: visibles.filter((e) => e !== derniere) }
  }, [etapes, masquerInternes, ticket.description, ticket.opened_at, ticket.ouvert_par])

  // Le dernier commentaire reste visible : défilement en bas à chaque ajout.
  useEffect(() => {
    if (impression) return
    const el = fin.current?.parentElement
    if (el) el.scrollTop = el.scrollHeight
  }, [suite.length, impression])

  return (
    <div
      className={`space-y-2 text-[13px] leading-relaxed text-slate-800 ${hauteurMax && !impression ? 'overflow-y-auto pr-1' : ''}`}
      style={hauteurMax && !impression ? { maxHeight: hauteurMax } : undefined}
    >
      {note ? (
        <div className="rounded-lg border border-[#B4761A] bg-[#FDF7EA] px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.05em] text-[#8A5A11]">
            <span>Note rapide · motif de l’appel{note.modifiee ? ' (modifiée)' : ''}</span>
            <span className="font-normal normal-case tracking-normal text-slate-500">
              {fmtDateHeure(note.at)} · {String(note.auteur || '').split('@')[0]}
            </span>
          </div>
          <div className="whitespace-pre-wrap text-slate-900">{note.texte}</div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#D8D3C8] px-3 py-2 text-[12px] text-slate-500">Aucune note rapide (motif de l’appel non saisi).</div>
      )}

      {suite.map((e) => {
        if (estDiagnosticRepris(e)) {
          return (
            <div key={e.id} className="rounded-lg border border-[#E2DFD8] bg-[#FAF9F7] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-400">
                Diagnostic (ancien outil) · {fmtDateHeure(e.at)} · {e.auteur.split('@')[0]}
              </div>
              <div className="whitespace-pre-wrap">{e.libelle.replace(/^Diagnostic : /, '')}</div>
            </div>
          )
        }
        const ton = TONS[e.type]
        if (COMMENTAIRES.has(e.type) && ton) {
          return (
            <div key={e.id} className="rounded-lg border px-3 py-2" style={{ borderColor: ton.bord, background: ton.fond }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                <span className="font-bold uppercase tracking-[0.04em]" style={{ color: ton.titre }}>
                  {ETAPE_LIBELLES[e.type]}
                  {estInterne(e) ? <span className="ml-1.5 rounded bg-[#B4761A] px-1.5 py-0.5 text-[9px] text-white">INTERNE</span> : null}
                </span>
                <span className="text-slate-500">
                  {fmtDateHeure(e.at)} · {e.auteur.split('@')[0]}
                </span>
              </div>
              <div className="whitespace-pre-wrap">{e.libelle}</div>
            </div>
          )
        }
        return (
          <div key={e.id} className="flex gap-2 px-1 text-[12px] leading-snug">
            <span className="w-[92px] shrink-0 font-mono text-[11px] text-slate-400">{fmtDateHeure(e.at)}</span>
            <span className="min-w-0">
              <span className="font-semibold text-slate-700">{ETAPE_LIBELLES[e.type] || e.type}</span>{' '}
              <span className="text-slate-600">{e.libelle}</span>
              <span className="text-[11px] text-slate-400"> · {e.auteur.split('@')[0]}</span>
            </span>
          </div>
        )
      })}
      {!suite.length ? <div className="px-1 text-[12px] text-slate-500">Aucun commentaire pour l’instant.</div> : null}
      <div ref={fin} />
    </div>
  )
}
