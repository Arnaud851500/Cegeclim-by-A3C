// ============================================================================
// lib/theme.ts — Thème clair / sombre (13/10/2026)
// ----------------------------------------------------------------------------
// L'application est écrite en styles inline sur fond sombre (#0B1220, blancs
// translucides…). Plutôt que de réécrire chaque couleur, themed() et tc()
// remplacent les couleurs « sombres » connues par des variables CSS
// (app/globals.css) :
//   - en sombre, chaque variable vaut l'ancienne couleur → rendu identique ;
//   - en clair, les blancs translucides deviennent des encres marine
//     translucides, les fonds marine deviennent crème / blanc, etc.
//
// Passer un écran au thème clair :
//   1. envelopper son objet de styles : const styles = themed({ ... })
//   2. passer les couleurs écrites en dur dans le JSX par tc('…')
//   3. ajouter son chemin dans LIGHT_READY_PATHS ci-dessous (l'écran et ses
//      sous-écrans) ou dans LIGHT_READY_EXACT_PATHS (l'écran seul, quand ses
//      sous-écrans ne sont pas encore passés au clair — ex. /stock).
// Tant qu'un écran n'est pas dans la liste, sa zone de contenu reste sombre
// même si l'utilisateur a choisi le mode clair (le bandeau, lui, suit).
// ============================================================================

import type React from 'react'

export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cegeclim.theme'

/** Écrans dont le contenu sait s'afficher en clair (préfixes de chemin). */
export const LIGHT_READY_PATHS: string[] = [
  '/accueil',
  '/actualites',
  '/focus_mensuel2', // Activité quotidienne (14/10/2026)
  '/tableaux-de-bord/vision-tci', // Vision ONE PAGE (14/10/2026)
  '/agenda', // Agenda — Mes rdv (15/10/2026)
  '/cycle-documents', // Analyse devis (15/10/2026)
]

/** Écrans passés au clair sans leurs sous-écrans (chemin exact). */
export const LIGHT_READY_EXACT_PATHS: string[] = [
  '/stock', // Stock articles (14/10/2026) — /stock/groupes, /stock/reconstruction… restent sombres
]

export function isLightReadyPath(pathname: string | null | undefined) {
  if (!pathname) return false
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (LIGHT_READY_EXACT_PATHS.includes(path)) return true
  return LIGHT_READY_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
}

const NUM = '\\s*([0-9]*\\.?[0-9]+)\\s*'

const REPLACEMENTS: Array<[RegExp, string]> = [
  [new RegExp(`rgba\\(\\s*255\\s*,\\s*255\\s*,\\s*255\\s*,${NUM}\\)`, 'gi'), 'rgba(var(--cg-ink-rgb), $1)'],
  [new RegExp(`rgba\\(\\s*245\\s*,\\s*243\\s*,\\s*236\\s*,${NUM}\\)`, 'gi'), 'rgba(var(--cg-ink-rgb), $1)'],
  [new RegExp(`rgba\\(\\s*11\\s*,\\s*18\\s*,\\s*32\\s*,${NUM}\\)`, 'gi'), 'rgba(var(--cg-bg-rgb), $1)'],
  [new RegExp(`rgba\\(\\s*6\\s*,\\s*10\\s*,\\s*18\\s*,${NUM}\\)`, 'gi'), 'rgba(var(--cg-backdrop-rgb), calc($1 * var(--cg-backdrop-k)))'],
  [new RegExp(`rgba\\(\\s*0\\s*,\\s*0\\s*,\\s*0\\s*,${NUM}\\)`, 'gi'), 'rgba(0, 0, 0, calc($1 * var(--cg-shadow-k)))'],
  [/#(?:ffffff|fff)(?![0-9a-f])/gi, 'var(--cg-ink)'],
  [/#F5F3EC(?![0-9a-f])/gi, 'var(--cg-ink-soft)'],
  [/#0B1220(?![0-9a-f])/gi, 'var(--cg-bg)'],
  [/#101A2E(?![0-9a-f])/gi, 'var(--cg-surface)'],
  [/#E9E5D6(?![0-9a-f])/gi, 'var(--cg-sauge-ink)'],
  [/#A6A181(?![0-9a-f])/gi, 'var(--cg-sauge)'],
  [/#8FC7DA(?![0-9a-f])/gi, 'var(--cg-info-ink)'],
  [/#7FB7CB(?![0-9a-f])/gi, 'var(--cg-info-ink-2)'],
  [/#E07A4E(?![0-9a-f])/gi, 'var(--cg-alert-ink)'],
  [/#E0A961(?![0-9a-f])/gi, 'var(--cg-warn-ink)'],
  [/#D69A4A(?![0-9a-f])/gi, 'var(--cg-warn)'],
]

/** Couleur (ou chaîne CSS) sombre → version suivant le thème. */
export function tc(value: string): string {
  let out = value
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement)
  return out
}

function themeValue(value: unknown): unknown {
  return typeof value === 'string' ? tc(value) : value
}

/**
 * Objet de styles inline → mêmes styles, couleurs passées en variables de thème.
 * Les clés listées dans `keep` ne sont pas modifiées (ex. un logo sur fond blanc).
 */
export function themed<T extends Record<string, React.CSSProperties>>(styles: T, keep: string[] = []): T {
  const out: Record<string, React.CSSProperties> = {}
  for (const [key, style] of Object.entries(styles)) {
    if (keep.includes(key)) {
      out[key] = style
      continue
    }
    const converted: Record<string, unknown> = {}
    for (const [prop, value] of Object.entries(style)) converted[prop] = themeValue(value)
    out[key] = converted as React.CSSProperties
  }
  return out as T
}

/**
 * Script exécuté avant l'affichage (app/layout.tsx) : pose la préférence
 * enregistrée sur <html> pour éviter un flash sombre → clair. Le mode clair
 * n'est proposé que sur PC (≥ 768 px) ; le mobile reste sombre.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'&&window.innerWidth>=768){document.documentElement.setAttribute('data-theme','light');}else{document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`
