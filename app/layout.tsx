// SERVEUR — pas de 'use client' ici, volontairement : c'est ce qui permet
// d'exporter `metadata` et `viewport` (Next.js l'interdit dans un composant
// marqué 'use client'). Toute la logique interactive (auth, menu, alertes,
// hooks...) vit dans ClientRootShell, rendu comme simple enfant ci-dessous.
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono, IBM_Plex_Serif } from 'next/font/google'
import './globals.css'
// 13/10/2026 : variables du thème clair / sombre + animations du bandeau
import './theme.css'
import ClientRootShell from './ClientRootShell'
import PwaSetup from '@/components/PwaSetup'
import { THEME_BOOT_SCRIPT } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Le compagnon CEGECLIM',
  appleWebApp: {
    title: 'Le compagnon CEGECLIM',
    statusBarStyle: 'black-translucent',
    // 'standalone' masque la barre d'adresse quand l'app est lancée
    // depuis l'icône ajoutée à l'écran d'accueil (iOS Safari).
    capable: true,
  },
}

export const viewport: Viewport = {
  themeColor: '#0B1220',
  // Empêche le zoom accidentel au double-tap dans l'app "installée".
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

const fontDisplay = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' })
const fontBody = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
const fontMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' })
// 13/10/2026 : police de lecture du fil d'actualité (components/actualites/ActualiteContent.tsx)
const fontReading = IBM_Plex_Serif({ subsets: ['latin'], weight: ['400', '600'], style: ['normal', 'italic'], variable: '--font-reading' })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning : data-theme est posé sur <html> par le script
    // ci-dessous avant l'hydratation (13/10/2026, mode clair / sombre).
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable} ${fontReading.variable}`}>
        {/* 25/09/2026 : service worker + capture de l'invite d'installation (page /installer) */}
        <PwaSetup />
        <ClientRootShell>{children}</ClientRootShell>
      </body>
    </html>
  )
}
