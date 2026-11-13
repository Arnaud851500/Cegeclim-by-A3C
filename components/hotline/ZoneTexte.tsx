'use client'

/**
 * Zone de texte qui s'agrandit avec son contenu (retours d'ergonomie du
 * 13/11/2026) : plus besoin de faire défiler un commentaire de plusieurs lignes.
 */

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

export default function ZoneTexte({ value, minRows = 2, maxHeight = 420, style, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number; maxHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`
  }, [value, maxHeight])
  return <textarea ref={ref} value={value} rows={minRows} style={{ resize: 'vertical', overflowY: 'auto', ...style }} {...props} />
}
