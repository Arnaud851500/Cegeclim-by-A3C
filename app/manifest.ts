import type { MetadataRoute } from 'next'

// Convention Next.js App Router : ce fichier doit être placé à
// app/manifest.ts (pas dans public/). Next.js le sert automatiquement
// sur /manifest.webmanifest et lie la balise <link rel="manifest"> lui-même.
//
// Les icônes référencées ici (src) doivent exister dans public/ :
//   public/icon-192.png        (192x192, requis par Chrome Android pour
//                               proposer l'installation — ajouté le 25/09/2026)
//   public/icon.png            (512x512, plein cadre, pour icon.png standard)
//   public/icon-maskable.png   (512x512, marge ~32% pour survivre au recadrage Android)
//
// ÉVOLUTION (2026-09-25) : lancement du Compagnon auprès des commerciaux.
// - id / scope explicites : l'app installée reste la même si start_url change.
// - start_url '/' : ClientRootShell renvoie vers /login sans session, puis
//   vers /accueil (mobile) une fois connecté.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Le compagnon CEGECLIM',
    short_name: 'CEGECLIM',
    description:
      "Compagnon interne CEGECLIM by A3C — activité, clients, stock et pilotage au quotidien.",
    lang: 'fr',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B1220',
    theme_color: '#0B1220',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
