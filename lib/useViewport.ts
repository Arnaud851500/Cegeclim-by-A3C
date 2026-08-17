'use client'

import { useEffect, useState } from 'react'

export type Orientation = 'portrait' | 'landscape'

export interface ViewportState {
  width: number
  height: number
  orientation: Orientation
  isMobile: boolean
}

// Cohérent avec le breakpoint "md" habituellement utilisé côté Tailwind
// dans le projet (focus_mensuel3 utilise sm:/xl: par ex.). À ajuster si
// une config Tailwind différente existe.
const MOBILE_BREAKPOINT = 768

function measure(): ViewportState {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0, orientation: 'portrait', isMobile: false }
  }
  const width = window.innerWidth
  const height = window.innerHeight
  return {
    width,
    height,
    orientation: height >= width ? 'portrait' : 'landscape',
    isMobile: width < MOBILE_BREAKPOINT,
  }
}

/**
 * Hook réactif largeur/hauteur/orientation, pensé pour piloter la bascule
 * entre l'interface desktop (AppShell actuel) et l'interface mobile
 * (MobileShell). Écoute resize + orientationchange + matchMedia (plus fiable
 * qu'un simple resize sur certains navigateurs mobiles au changement
 * d'orientation).
 */
export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(() => measure())

  useEffect(() => {
    function onChange() {
      setState(measure())
    }

    onChange()

    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)

    const mql = window.matchMedia('(orientation: portrait)')
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)

    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  return state
}
