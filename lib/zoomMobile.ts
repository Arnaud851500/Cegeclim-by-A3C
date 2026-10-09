'use client'

/**
 * ÉVOLUTION (2026-10-09) : « Zoom à deux doigts » dans le Compagnon mobile.
 *
 * Par défaut rien ne change : app/layout.tsx déclare toujours
 * `maximum-scale=1` (zoom bloqué, pas de zoom accidentel au double-tap).
 *
 * Les utilisateurs qui en ont besoin activent l'option dans « 🎙️ Voix »
 * (écran Voix & lecture). Préférence stockée par utilisateur dans
 * vision_tci_preferences.zoom_mobile (défaut false), et recopiée dans le
 * localStorage du téléphone pour être appliquée dès l'ouverture de l'app,
 * avant même le retour de la requête Supabase.
 *
 * Quand l'option est active :
 *  - la balise <meta name="viewport"> est réécrite côté navigateur
 *    (maximum-scale=5, user-scalable=yes) -> pinch-to-zoom possible ;
 *  - `touch-action: manipulation` sur <html> -> le double-tap ne zoome
 *    toujours pas (seul le geste à deux doigts zoome) ;
 *  - les champs de saisie passent à 16 px minimum : sinon iOS zoome
 *    automatiquement à chaque fois qu'on touche un champ, ce qui deviendrait
 *    gênant dès que le zoom est autorisé.
 *
 * Next.js peut régénérer la balise viewport lors d'une navigation : un
 * MutationObserver sur <head> réapplique l'état voulu si besoin.
 */

import { useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

const CLE_LOCALE = 'cgc_zoom_mobile'
const STYLE_ID = 'cgc-zoom-mobile-style'

// Doit rester identique au `viewport` exporté par app/layout.tsx.
const VIEWPORT_BLOQUE = 'width=device-width, initial-scale=1, maximum-scale=1'
const VIEWPORT_ZOOM = 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes'

const CSS_ZOOM = `
html[data-zoom-mobile="on"] { touch-action: manipulation; }
html[data-zoom-mobile="on"] input,
html[data-zoom-mobile="on"] textarea,
html[data-zoom-mobile="on"] select { font-size: 16px !important; }
`

// État voulu, partagé entre le hook (MobileShell) et la bascule (MobileHome).
let zoomVoulu = false
let observateur: MutationObserver | null = null

export function lireZoomMobileLocal(): boolean {
  try {
    return window.localStorage.getItem(CLE_LOCALE) === '1'
  } catch {
    return false
  }
}

function ecrireLocal(actif: boolean) {
  try {
    window.localStorage.setItem(CLE_LOCALE, actif ? '1' : '0')
  } catch {
    // Stockage indisponible (navigation privée...) : la préférence en base suffit.
  }
}

function metaViewport(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'viewport'
    document.head.appendChild(meta)
  }
  return meta
}

function synchroniserDom() {
  if (typeof document === 'undefined') return
  const contenu = zoomVoulu ? VIEWPORT_ZOOM : VIEWPORT_BLOQUE
  const meta = metaViewport()
  if (meta.getAttribute('content') !== contenu) meta.setAttribute('content', contenu)

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS_ZOOM
    document.head.appendChild(style)
  }
  if (zoomVoulu) document.documentElement.setAttribute('data-zoom-mobile', 'on')
  else document.documentElement.removeAttribute('data-zoom-mobile')
}

/** Applique immédiatement l'état et le mémorise sur le téléphone. */
export function appliquerZoomMobile(actif: boolean) {
  zoomVoulu = actif
  ecrireLocal(actif)
  synchroniserDom()
}

/**
 * À appeler une fois dans MobileShell : applique la préférence au montage
 * (cache local puis base), surveille la balise viewport, et remet le
 * comportement historique au démontage (passage en affichage PC).
 */
export function useZoomMobile(email: string | null | undefined) {
  useEffect(() => {
    zoomVoulu = lireZoomMobileLocal()
    synchroniserDom()

    observateur?.disconnect()
    observateur = new MutationObserver(() => synchroniserDom())
    observateur.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] })

    return () => {
      observateur?.disconnect()
      observateur = null
      zoomVoulu = false
      synchroniserDom()
    }
  }, [])

  useEffect(() => {
    let annule = false
    async function charger() {
      if (!email) return
      const { data } = await supabase
        .from('vision_tci_preferences')
        .select('zoom_mobile')
        .eq('user_email', email)
        .maybeSingle()
      if (annule) return
      appliquerZoomMobile(Boolean(data?.zoom_mobile))
    }
    void charger()
    return () => { annule = true }
  }, [email])
}
