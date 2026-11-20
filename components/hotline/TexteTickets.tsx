'use client'

/**
 * Texte dont les n° de ticket (TICK… / TEST…) deviennent cliquables
 * (20/11/2026, « Suite au ticket TICK… » : le clic ouvre la fenêtre flottante
 * du ticket cité). Sans `onOuvrir`, le texte est rendu tel quel.
 */

import { Fragment } from 'react'

export default function TexteTickets({ texte, onOuvrir }: { texte: string; onOuvrir?: (numero: string) => void }) {
  // Groupe capturant : les n° de ticket restent dans le découpage, aux indices impairs.
  const morceaux = texte.split(/\b((?:TICK|TEST)\d{9,})\b/)
  if (!onOuvrir || morceaux.length === 1) return <>{texte}</>
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <button
            key={i}
            type="button"
            onClick={() => onOuvrir(m)}
            title={`Voir le ticket ${m}`}
            className="font-bold text-[#1E4E8C] underline decoration-dotted underline-offset-2 hover:text-[#B4761A]"
          >
            {m}
          </button>
        ) : (
          <Fragment key={i}>{m}</Fragment>
        ),
      )}
    </>
  )
}
