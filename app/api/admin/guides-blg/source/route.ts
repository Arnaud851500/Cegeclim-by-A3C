// ============================================================================
// app/api/admin/guides-blg/source/route.ts — Guides BLG : relecture d'un chapitre
// depuis son lien Teams / SharePoint (09/11/2026)
// ----------------------------------------------------------------------------
// POST { slug, force? }
//  1. lit guides_blg.source_url (lien de partage « Toute personne disposant du lien »
//     du fichier CHAPITRE-xxx.html) ;
//  2. télécharge le fichier côté serveur (le navigateur ne peut pas : CORS SharePoint),
//     en forçant le téléchargement (&download=1) ;
//  3. vérifie qu'il s'agit bien d'un chapitre (et pas de la page de connexion Microsoft,
//     signe d'un lien réservé aux membres de Cegeclim) ;
//  4. compare son empreinte SHA-256 à celle du dernier fichier publié :
//       - inchangé → { statut: 'INCHANGE' } (sauf force) ;
//       - modifié  → dépose le fichier brut dans le bucket privé « guides-blg » sous
//         _sources/<slug>.html et renvoie { statut: 'A_PUBLIER', path, hash } ; le
//         navigateur le relit et le publie avec le traitement habituel (extraction des
//         images, sommaire), puis supprime ce fichier temporaire.
// Le fichier (~20 Mo) ne transite pas par la réponse de la fonction (limite Vercel 4,5 Mo).
// Accès : /api/admin/* → session + droit administrateur contrôlés par proxy.ts.
// Migration : 20261109c_guides_blg_source_teams.sql
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'guides-blg'
const TAILLE_MAX = 80 * 1024 * 1024

function lienTelechargement(url: string): string {
  const u = new URL(url)
  if (/\.sharepoint\.com$/i.test(u.hostname) || /onedrive|1drv/i.test(u.hostname)) u.searchParams.set('download', '1')
  return u.toString()
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status })
}

export async function POST(req: NextRequest) {
  let slug = ''
  let force = false
  try {
    const body = (await req.json()) as { slug?: string; force?: boolean }
    slug = String(body.slug ?? '').trim()
    force = Boolean(body.force)
  } catch {
    return json({ statut: 'ERREUR', message: 'Requête invalide.' }, 400)
  }
  if (!slug) return json({ statut: 'ERREUR', message: 'Chapitre manquant.' }, 400)

  const admin = createSupabaseAdmin()
  const { data: guide, error: gErr } = await admin
    .from('guides_blg')
    .select('slug, source_url, source_hash')
    .eq('slug', slug)
    .maybeSingle()
  if (gErr) return json({ statut: 'ERREUR', message: gErr.message }, 500)
  if (!guide) return json({ statut: 'ERREUR', message: 'Chapitre inconnu.' }, 404)
  if (!guide.source_url) return json({ statut: 'SANS_LIEN', message: 'Aucun lien Teams renseigné pour ce chapitre.' })

  const noter = async (message: string, hash?: string | null) => {
    await admin
      .from('guides_blg')
      .update({ source_verifie_at: new Date().toISOString(), source_message: message, ...(hash ? { source_hash: hash } : {}) })
      .eq('slug', slug)
  }

  let res: Response
  try {
    res = await fetch(lienTelechargement(guide.source_url), {
      redirect: 'follow',
      headers: { 'User-Agent': 'CEGECLIM-compagnon/1.0', Accept: 'text/html,application/octet-stream,*/*' },
      cache: 'no-store',
    })
  } catch (e) {
    const message = `Lien injoignable : ${e instanceof Error ? e.message : String(e)}`
    await noter(message)
    return json({ statut: 'ERREUR', message })
  }

  const hoteFinal = (() => {
    try {
      return new URL(res.url).hostname
    } catch {
      return ''
    }
  })()
  if (/login\.microsoftonline\.com|login\.live\.com/i.test(hoteFinal) || res.status === 401 || res.status === 403) {
    const message =
      'Le lien demande une connexion Microsoft : il est réservé aux membres de Cegeclim. Dans Teams, partagez le fichier avec « Toute personne disposant du lien » et recollez ce nouveau lien.'
    await noter(message)
    return json({ statut: 'ERREUR', message })
  }
  if (!res.ok) {
    const message = `Téléchargement refusé (HTTP ${res.status}).`
    await noter(message)
    return json({ statut: 'ERREUR', message })
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > TAILLE_MAX) {
    const message = `Fichier trop volumineux (${Math.round(buf.length / 1048576)} Mo).`
    await noter(message)
    return json({ statut: 'ERREUR', message })
  }
  const debut = buf.subarray(0, Math.min(buf.length, 400_000)).toString('utf8')
  const estChapitre = /<html/i.test(debut) && /<section[^>]*class\s*=\s*["'][^"']*\bintro\b/i.test(buf.toString('utf8'))
  if (!estChapitre) {
    const pageConnexion = /microsoftonline|Sign in to your account|Se connecter à votre compte/i.test(debut)
    const message = pageConnexion
      ? 'Le lien renvoie la page de connexion Microsoft : partagez le fichier avec « Toute personne disposant du lien » dans Teams.'
      : 'Le fichier téléchargé n’est pas un chapitre de guide (aucune section de mode opératoire trouvée).'
    await noter(message)
    return json({ statut: 'ERREUR', message })
  }

  const hash = createHash('sha256').update(buf).digest('hex')
  if (!force && guide.source_hash && guide.source_hash === hash) {
    await noter('Inchangé depuis la dernière publication.')
    return json({ statut: 'INCHANGE', hash, taille: buf.length })
  }

  const path = `_sources/${slug}.html`
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: 'text/plain;charset=utf-8', upsert: true, cacheControl: '0' })
  if (upErr) {
    const message = `Dépôt temporaire impossible : ${upErr.message}`
    await noter(message)
    return json({ statut: 'ERREUR', message })
  }
  return json({ statut: 'A_PUBLIER', path, hash, taille: buf.length })
}
