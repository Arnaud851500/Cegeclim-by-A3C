import type { MetadataRoute } from 'next'

// Convention Next.js App Router : ce fichier doit être placé à
// app/manifest.ts (pas dans public/). Next.js le sert automatiquement
// sur /manifest.webmanifest et lie la balise <link rel="manifest"> lui-même.
//
// Les icônes référencées ici (src) doivent exister dans public/ :
//   public/icon.png            (512x512, plein cadre, pour icon.png standard)
//   public/icon-maskable.png   (512x512, marge ~32% pour survivre au recadrage Android)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Le compagnon CEGECLIM',
    short_name: 'CEGECLIM',
    description:
      "Compagnon interne CEGECLIM by A3C — activité, clients, stock et pilotage au quotidien.",
    start_url: '/',
    display: 'standalone',
    background_color: '#0B1220',
    theme_color: '#0B1220',
    icons: [
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
