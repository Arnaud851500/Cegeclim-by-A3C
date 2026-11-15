// ============================================================================
// app/api/admin/guides-compagnon/route.ts — Guide utilisateur « Mon Compagnon » :
// fichiers du dépôt à publier (15/11/2026)
// ----------------------------------------------------------------------------
// Les chapitres du guide du compagnon sont rangés dans le dépôt, un dossier par pavé
// de la page d'accueil : guides-compagnon/<id du pavé>/CHAPITRE-xxx.html. Ils sont
// livrés avec la fonction (next.config.ts → outputFileTracingIncludes).
//
// GET  → { fichiers: [{ chemin, bloc, fichier, taille, hash }] } : liste des chapitres
//        du dépôt avec leur empreinte SHA-256 ; le navigateur la compare à
//        guides_compagnon.source_hash pour ne republier que ce qui a changé.
// POST { chemin } → dépose le fichier brut dans le bucket privé « guides-blg » sous
//        _sources/compagnon/<fichier aplati>.html et renvoie { path, hash } ; le
//        navigateur le relit, le publie avec le traitement habituel des guides
//        (lib/guidesBlg.ts : extraction des images, sommaire) puis supprime ce fichier
//        temporaire. Le fichier (~4 Mo) ne transite pas par la réponse de la fonction
//        (limite Vercel 4,5 Mo).
// Accès : /api/admin/* → session + droit administrateur contrôlés par proxy.ts.
// Migration : 20261115a_guides_compagnon.sql
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'guides-blg'
const RACINE = resolve(process.cwd(), 'guides-compagnon')

type Fichier = { chemin: string; bloc: string; fichier: string; taille: number; hash: string }

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status })
}

/** Chapitres HTML rangés dans guides-compagnon/<bloc>/ (un niveau de dossier). */
async function listerFichiers(): Promise<Fichier[]> {
  let blocs: string[] = []
  try {
    blocs = (await readdir(RACINE, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out: Fichier[] = []
  for (const bloc of blocs.sort()) {
    const dossier = join(RACINE, bloc)
    const noms = (await readdir(dossier, { withFileTypes: true })).filter((d) => d.isFile() && /\.html?$/i.test(d.name)).map((d) => d.name)
    for (const fichier of noms.sort()) {
      const abs = join(dossier, fichier)
      const contenu = await readFile(abs)
      out.push({
        chemin: `${bloc}/${fichier}`,
        bloc,
        fichier,
        taille: (await stat(abs)).size,
        hash: createHash('sha256').update(contenu).digest('hex'),
      })
    }
  }
  return out
}

export async function GET() {
  try {
    return json({ fichiers: await listerFichiers() })
  } catch (e) {
    return json({ message: `Lecture des fichiers du guide : ${e instanceof Error ? e.message : String(e)}` }, 500)
  }
}

export async function POST(req: NextRequest) {
  let chemin = ''
  try {
    const body = (await req.json()) as { chemin?: string }
    chemin = String(body.chemin ?? '').trim()
  } catch {
    return json({ message: 'Requête invalide.' }, 400)
  }
  // Uniquement un fichier HTML d'un dossier de pavé : guides-compagnon/<bloc>/<fichier>.html
  if (!/^[a-z0-9-]+\/[^/\\]+\.html?$/i.test(chemin)) return json({ message: 'Chemin de chapitre invalide.' }, 400)
  const abs = resolve(RACINE, chemin)
  if (!abs.startsWith(RACINE + sep)) return json({ message: 'Chemin de chapitre invalide.' }, 400)

  let contenu: Buffer
  try {
    contenu = await readFile(abs)
  } catch {
    return json({ message: `Fichier introuvable dans le dépôt : ${relative(RACINE, abs)}` }, 404)
  }
  const hash = createHash('sha256').update(contenu).digest('hex')
  const path = `_sources/compagnon/${chemin.replace(/[^A-Za-z0-9._-]+/g, '_')}`

  const admin = createSupabaseAdmin()
  const { error } = await admin.storage.from(BUCKET).upload(path, contenu, { contentType: 'text/plain;charset=utf-8', upsert: true, cacheControl: '0' })
  if (error) return json({ message: `Dépôt temporaire du fichier : ${error.message}` }, 500)
  return json({ path, hash, taille: contenu.length })
}
