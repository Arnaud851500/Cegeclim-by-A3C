// SERVEUR — pas de 'use client' ici, volontairement : c'est ce qui permet
// d'exporter `metadata` et `viewport` (Next.js l'interdit dans un composant
// marqué 'use client'). Toute la logique interactive (auth, menu, alertes,
// hooks...) vit dans ClientRootShell, rendu comme simple enfant ci-dessous.
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import ClientRootShell from './ClientRootShell'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
        <ClientRootShell>{children}</ClientRootShell>
      </body>
    </html>
  )
}
