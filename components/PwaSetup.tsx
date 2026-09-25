'use client'

// Mise en place PWA du Compagnon (ajouté le 25/09/2026), montée une seule
// fois dans app/layout.tsx :
// 1) enregistre le service worker public/sw.js (installabilité Chrome Android
//    + page « Pas de connexion ») ;
// 2) capte au plus tôt l'événement `beforeinstallprompt` de Chrome Android.
//    Chrome peut l'émettre avant que la page /installer soit montée : on le
//    garde donc sur window et on prévient la page par un événement maison.

import { useEffect } from 'react'

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    __cegeclimInstallPrompt?: BeforeInstallPromptEvent | null
  }
}

/** Événement émis sur window quand l'invite d'installation devient disponible. */
export const INSTALL_PROMPT_READY_EVENT = 'cegeclim:install-prompt-ready'
/** Événement émis sur window quand l'app vient d'être installée. */
export const APP_INSTALLED_EVENT = 'cegeclim:app-installed'

export default function PwaSetup() {
  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Empêche la mini-barre automatique de Chrome : c'est la page
      // /installer qui propose le bouton, au bon moment.
      event.preventDefault()
      window.__cegeclimInstallPrompt = event as BeforeInstallPromptEvent
      window.dispatchEvent(new Event(INSTALL_PROMPT_READY_EVENT))
    }

    const onInstalled = () => {
      window.__cegeclimInstallPrompt = null
      window.dispatchEvent(new Event(APP_INSTALLED_EVENT))
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('[pwa] enregistrement du service worker impossible', error)
      })
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  return null
}
