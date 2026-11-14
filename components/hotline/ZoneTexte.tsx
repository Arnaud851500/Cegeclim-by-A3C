'use client'

/**
 * Zone de texte qui s'agrandit avec son contenu (retours d'ergonomie du
 * 13/11/2026) : plus besoin de faire défiler un commentaire de plusieurs lignes.
 * (14/11/2026) Majuscule automatique en début de texte, de ligne et de phrase
 * (désactivable avec majuscules={false}).
 */

import { useLayoutEffect, useRef, type ChangeEvent, type TextareaHTMLAttributes } from 'react'

/** Première lettre du texte, de chaque ligne et après « . », « ! », « ? » en majuscule. */
export function capitaliser(texte: string) {
  return texte.replace(/(^|\n|[.!?]\s+)(\s*)(\p{Ll})/gu, (_m, avant: string, espaces: string, lettre: string) => `${avant}${espaces}${lettre.toUpperCase()}`)
}

export default function ZoneTexte({
  value,
  minRows = 2,
  maxHeight = 420,
  majuscules = true,
  onChange,
  style,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number; maxHeight?: number; majuscules?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`
  }, [value, maxHeight])

  function changer(e: ChangeEvent<HTMLTextAreaElement>) {
    if (majuscules) {
      const el = e.target
      const brut = el.value
      const propre = capitaliser(brut)
      if (propre !== brut) {
        // Même longueur : le curseur reste où il est.
        const debut = el.selectionStart
        const fin = el.selectionEnd
        el.value = propre
        el.setSelectionRange(debut, fin)
      }
    }
    onChange?.(e)
  }

  return <textarea ref={ref} value={value} rows={minRows} onChange={changer} style={{ resize: 'vertical', overflowY: 'auto', ...style }} {...props} />
}
