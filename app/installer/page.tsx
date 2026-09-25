// Page publique /installer (25/09/2026) — cible du QR code de lancement du
// Compagnon auprès des commerciaux.
//
// Composant SERVEUR (pas de 'use client') : il sert uniquement à poser, dès
// le HTML initial, un manifest personnalisé quand l'URL porte ?u=identifiant.
//
// Pourquoi : quand on ajoute le site à l'écran d'accueil, l'iPhone (Safari
// comme Chrome iOS) et Chrome Android lancent l'icône sur la `start_url` du
// manifest, pas sur l'URL affichée. Avec le manifest générique (start_url
// '/'), l'identifiant du QR code était perdu, et l'app installée sur iPhone
// n'a pas accès au stockage de Safari. Le manifest personnalisé
// (/api/manifest?u=…) lance donc l'icône sur /installer?u=…, qui renvoie
// vers /login?u=… (identifiant prérempli) ou vers l'accueil si une session
// existe déjà.
//
// Toute l'interface est dans InstallerClient.tsx.

import type { Metadata } from 'next'
import InstallerClient from './InstallerClient'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams
  const brut = params.u
  const u = (Array.isArray(brut) ? brut[0] : brut)?.trim() ?? ''

  return {
    title: 'Installer le compagnon CEGECLIM',
    ...(u ? { manifest: `/api/manifest?u=${encodeURIComponent(u)}` } : {}),
  }
}

export default function InstallerPage() {
  return <InstallerClient />
}
