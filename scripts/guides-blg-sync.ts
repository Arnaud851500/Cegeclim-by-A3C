// ============================================================================
// scripts/guides-blg-sync.ts — Guides BLG : synchronisation depuis le dossier
// OneDrive du Mac (09/11/2026)
// ----------------------------------------------------------------------------
// Les chapitres CHAPITRE-xxx.html sont rangés dans l'équipe Teams
// « CEGECLIM <=> BLG // Marcel ». Le partage « Toute personne disposant du lien »
// étant interdit chez Cegeclim, le compagnon ne peut pas les lire lui-même : ce
// script tourne sur le Mac d'Arnaud, où OneDrive synchronise le dossier Teams.
//
// À chaque passage (toutes les 5 minutes via launchd, voir
// scripts/installer-synchro-guides-mac.sh) :
//   1. liste les fichiers CHAPITRE-*.html du dossier (sans descendre dans les
//      sous-dossiers, pour ignorer les brouillons type « RELECTURE MODOP ») ;
//   2. ignore ceux dont la taille et la date de modification n'ont pas bougé
//      depuis le passage précédent (état local ~/.cegeclim-guides-sync.json) ;
//   3. pour les autres, calcule l'empreinte SHA-256 et la compare à
//      guides_blg.source_hash : si elle diffère, publie le chapitre exactement
//      comme un dépôt dans l'écran (lib/guidesBlg.ts : extraction des images et
//      PDF dans le bucket « guides-blg », page légère, sommaire), version + 1,
//      puis supprime l'ancienne version ;
//   4. trace le résultat dans guides_blg.source_verifie_at / source_message,
//      visible dans la fenêtre du chapitre.
// Un nouveau chapitre (nouveau fichier CHAPITRE-xxx.html) est créé en fin de liste.
//
// 10/11/2026 — pavé « Formation » : le sous-dossier « z - Formation » du même dossier
// Teams est publié sous le nom « Formation », arborescence comprise, PDF seulement
// (les autres fichiers sont ignorés). Chaque PDF est envoyé une fois sous
// formation/<sha256>.pdf (bucket « guides-blg ») ; renommer ou déplacer un PDF dans
// Teams ne fait que mettre à jour son chemin ; un PDF supprimé dans Teams disparaît
// du compagnon. Par sécurité, rien n'est supprimé si le dossier est introuvable ou
// vide (OneDrive en cours de resynchronisation).
// Dossier : GUIDES_FORMATION_DOSSIER (ou --formation), sinon « z - Formation » cherché
// dans le dossier des chapitres puis dans ses parents (jusqu'à 3 niveaux). Migration : 20261110a_guides_blg_formation.sql
//
// Lancement manuel :  npx tsx scripts/guides-blg-sync.ts [--force]   (dossier repris de la tâche macOS si non précisé)
//                    npx tsx scripts/guides-blg-sync.ts [--force] [--dossier "<chemin>"] [--formation "<chemin>"]
// Configuration : GUIDES_BLG_DOSSIER (ou --dossier), et dans .env.local :
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { GUIDES_BUCKET, preparerGuide, slugDepuisFichier } from '../lib/guidesBlg'

// lib/guidesBlg.ts s'appuie sur le DOMParser du navigateur.
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = LinkedomDOMParser

const RACINE = resolve(__dirname, '..')
const ETAT = join(homedir(), '.cegeclim-guides-sync.json')
const AUTEUR = 'synchro OneDrive (Mac)'

type Etat = Record<string, { taille: number; mtime: number; hash: string }>
type FormationRow = { chemin: string; dossier: string; nom: string; taille: number | null; hash: string; storage_path: string; modifie_le: string | null }
const FORMATION_PREFIXE = 'formation'
const FORMATION_DOSSIER_DEFAUT = 'z - Formation'
type GuideRow = { slug: string; titre: string; ordre: number; version: number; prefixe: string; actif: boolean; icone: string | null; source_hash: string | null; fichier_origine: string | null }

function log(msg: string) {
  console.log(`[${new Date().toLocaleString('fr-FR')}] ${msg}`)
}

function argument(nom: string): string | null {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

// Lancement manuel sans --dossier : reprend le dossier enregistré dans la tâche
// macOS installée par scripts/installer-synchro-guides-mac.sh (10/11/2026).
function dossierDeLaTacheMac(): string | null {
  const plist = join(homedir(), 'Library', 'LaunchAgents', 'fr.cegeclim.guides-blg-sync.plist')
  if (!existsSync(plist)) return null
  try {
    const v = execFileSync('/usr/bin/plutil', ['-extract', 'EnvironmentVariables.GUIDES_BLG_DOSSIER', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim()
    return v || null
  } catch {
    return null
  }
}

function chargerEnv() {
  for (const fichier of ['.env.local', '.env']) {
    const p = join(RACINE, fichier)
    if (!existsSync(p)) continue
    for (const ligne of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(ligne)
      if (!m || process.env[m[1]]) continue
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}

function lireEtat(): Etat {
  try {
    return JSON.parse(readFileSync(ETAT, 'utf8')) as Etat
  } catch {
    return {}
  }
}

async function viderDossier(sb: SupabaseClient, prefixe: string) {
  const bucket = sb.storage.from(GUIDES_BUCKET)
  for (let tour = 0; tour < 50; tour++) {
    const { data } = await bucket.list(prefixe, { limit: 1000 })
    const paths = (data ?? []).filter((o) => o.name).map((o) => `${prefixe}/${o.name}`)
    if (!paths.length) break
    const { error } = await bucket.remove(paths)
    if (error || paths.length < 1000) break
  }
}

async function publier(sb: SupabaseClient, chemin: string, nom: string, hash: string, existant: GuideRow | null, ordreMax: number) {
  const buf = readFileSync(chemin)
  const file = new File([buf], nom, { type: 'text/html' })
  const prep = await preparerGuide(file)
  const slug = existant?.slug ?? prep.slug
  if (!prep.nb_modop) throw new Error('aucun mode opératoire trouvé dans le fichier (fichier incomplet ou en cours de synchronisation ?)')

  const version = (existant?.version ?? 0) + 1
  const prefixe = `${slug}/v${version}`
  const bucket = sb.storage.from(GUIDES_BUCKET)

  const queue = [...prep.assets]
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const { error } = await bucket.upload(`${prefixe}/${a.nom}`, a.blob, { contentType: a.mime, upsert: true, cacheControl: '31536000' })
      if (error) throw new Error(`${a.nom} : ${error.message}`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))

  const page = new Blob([prep.html], { type: 'text/plain;charset=utf-8' })
  const { error: pageErr } = await bucket.upload(`${prefixe}/index.html`, page, { contentType: 'text/plain;charset=utf-8', upsert: true, cacheControl: '60' })
  if (pageErr) throw new Error(`page : ${pageErr.message}`)

  const maintenant = new Date().toISOString()
  const { error: rowErr } = await sb.from('guides_blg').upsert(
    {
      slug,
      titre: existant?.titre ?? prep.titre,
      sous_titre: prep.sous_titre || null,
      fichier_origine: nom,
      ordre: existant?.ordre ?? ordreMax + 10,
      version,
      prefixe,
      sommaire: prep.sommaire,
      nb_modop: prep.nb_modop,
      nb_etapes: prep.nb_etapes,
      nb_images: prep.nb_images,
      nb_pdf: prep.nb_pdf,
      taille_origine: prep.taille_origine,
      taille_page: prep.taille_page,
      actif: existant?.actif ?? true,
      icone: existant?.icone ?? null,
      source_hash: hash,
      source_verifie_at: maintenant,
      source_message: 'Nouvelle version publiée depuis le dossier OneDrive.',
      updated_at: maintenant,
      updated_by: AUTEUR,
    },
    { onConflict: 'slug' },
  )
  if (rowErr) throw new Error(`catalogue : ${rowErr.message}`)
  if (existant?.prefixe && existant.prefixe !== prefixe) await viderDossier(sb, existant.prefixe)
  return `${existant?.titre ?? prep.titre} v${version} (${prep.nb_modop} modes opératoires, ${prep.nb_etapes} étapes, ${prep.assets.length} images/PDF)`
}

/**
 * Dossier « z - Formation » : cherché dans le dossier des chapitres puis dans ses
 * parents (jusqu'à 3 niveaux) — chez Cegeclim il est dans « MODE OPERATOIRE », au-dessus
 * de CFLUIDE où sont les chapitres. Nom comparé sans tenir compte de la casse.
 */
function trouverDossierFormation(dossierChapitres: string): string {
  let courant = resolve(dossierChapitres)
  for (let niveau = 0; niveau <= 3; niveau++) {
    try {
      const trouve = readdirSync(courant, { withFileTypes: true }).find(
        (e) => e.isDirectory() && e.name.trim().toLowerCase() === FORMATION_DOSSIER_DEFAUT.toLowerCase(),
      )
      if (trouve) return join(courant, trouve.name)
    } catch {
      // dossier illisible : on remonte
    }
    const parent = dirname(courant)
    if (parent === courant) break
    courant = parent
  }
  return join(dossierChapitres, FORMATION_DOSSIER_DEFAUT)
}

/** PDF du dossier Formation (récursif), chemins relatifs avec « / ». */
function listerPdf(racine: string): { chemin: string; abs: string }[] {
  const out: { chemin: string; abs: string }[] = []
  const parcourir = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name.startsWith('~$')) continue
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) parcourir(abs)
      else if (ent.isFile() && /\.pdf$/i.test(ent.name)) out.push({ chemin: relative(racine, abs).split(sep).join('/'), abs })
    }
  }
  parcourir(racine)
  return out.sort((a, b) => a.chemin.localeCompare(b.chemin, 'fr', { numeric: true }))
}

async function synchroFormation(sb: SupabaseClient, racine: string, etat: Etat, force: boolean) {
  const majEtat = (champs: Record<string, unknown>) => sb.from('guides_blg_formation_etat').upsert({ id: 1, verifie_at: new Date().toISOString(), ...champs }, { onConflict: 'id' })

  if (!existsSync(racine)) {
    log(`Formation : dossier introuvable (${racine}), rien n'est modifié`)
    await majEtat({ message: `Dossier introuvable sur le Mac : ${racine}` })
    return
  }
  let fichiers: { chemin: string; abs: string }[]
  try {
    fichiers = listerPdf(racine)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    throw new Error(code === 'EPERM' || code === 'EACCES' ? `macOS refuse l'accès au dossier Formation (${code}).` : `Lecture du dossier Formation : ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!fichiers.length) {
    log('Formation : aucun PDF trouvé, rien n\'est supprimé par sécurité')
    await majEtat({ message: 'Aucun PDF trouvé dans le dossier : contenu du compagnon conservé.' })
    return
  }

  const { data, error } = await sb.from('guides_blg_formation').select('chemin, dossier, nom, taille, hash, storage_path, modifie_le')
  if (error) throw new Error(`Formation, lecture du catalogue : ${error.message}`)
  const existants = new Map(((data ?? []) as FormationRow[]).map((r) => [r.chemin, r]))
  const hashesConnus = new Set(((data ?? []) as FormationRow[]).map((r) => r.hash))
  const bucket = sb.storage.from(GUIDES_BUCKET)

  const vus = new Set<string>()
  const lignes: FormationRow[] = []
  let envoyes = 0
  let enAttente = 0
  for (const f of fichiers) {
    vus.add(f.chemin)
    const st = statSync(f.abs)
    const avant = etat[f.abs]
    const existant = existants.get(f.chemin)
    if (Date.now() - st.mtimeMs < 20_000) {
      enAttente++
      continue
    }
    let hash: string
    if (!force && avant && avant.taille === st.size && avant.mtime === st.mtimeMs) hash = avant.hash
    else {
      hash = createHash('sha256').update(readFileSync(f.abs)).digest('hex')
      etat[f.abs] = { taille: st.size, mtime: st.mtimeMs, hash }
    }
    const storagePath = `${FORMATION_PREFIXE}/${hash}.pdf`
    if (force || !hashesConnus.has(hash)) {
      const { error: upErr } = await bucket.upload(storagePath, readFileSync(f.abs), { contentType: 'application/pdf', upsert: true, cacheControl: '31536000' })
      if (upErr) {
        delete etat[f.abs]
        log(`Formation : ${f.chemin} : ERREUR envoi — ${upErr.message}`)
        continue
      }
      hashesConnus.add(hash)
      envoyes++
      log(`Formation : ${f.chemin} envoyé`)
    }
    const morceaux = f.chemin.split('/')
    const ligne: FormationRow = {
      chemin: f.chemin,
      dossier: morceaux.slice(0, -1).join('/'),
      nom: morceaux[morceaux.length - 1],
      taille: st.size,
      hash,
      storage_path: storagePath,
      modifie_le: new Date(st.mtimeMs).toISOString(),
    }
    if (!existant || existant.hash !== hash || existant.taille !== ligne.taille || existant.storage_path !== storagePath) lignes.push(ligne)
  }

  const maintenant = new Date().toISOString()
  for (let i = 0; i < lignes.length; i += 200) {
    const { error: upErr } = await sb.from('guides_blg_formation').upsert(lignes.slice(i, i + 200).map((l) => ({ ...l, updated_at: maintenant })), { onConflict: 'chemin' })
    if (upErr) throw new Error(`Formation, catalogue : ${upErr.message}`)
  }

  // PDF retirés de Teams (fichiers en cours d'écriture conservés jusqu'au passage suivant).
  const retires = Array.from(existants.keys()).filter((c) => !vus.has(c))
  for (let i = 0; i < retires.length; i += 200) {
    const { error: delErr } = await sb.from('guides_blg_formation').delete().in('chemin', retires.slice(i, i + 200))
    if (delErr) throw new Error(`Formation, suppression : ${delErr.message}`)
  }
  if (retires.length) log(`Formation : ${retires.length} PDF retiré(s) — ${retires.join(' · ')}`)

  // Fichiers du stockage qui ne sont plus référencés.
  const { data: restants } = await sb.from('guides_blg_formation').select('hash')
  const utiles = new Set(((restants ?? []) as { hash: string }[]).map((r) => r.hash))
  const objets: { name: string }[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error: listErr } = await bucket.list(FORMATION_PREFIXE, { limit: 1000, offset })
    if (listErr) throw new Error(`Formation, lecture du stockage : ${listErr.message}`)
    objets.push(...(page ?? []))
    if (!page || page.length < 1000) break
  }
  const orphelins = objets
    .filter((o) => o.name && !utiles.has(o.name.replace(/\.pdf$/i, '')))
    .map((o) => `${FORMATION_PREFIXE}/${o.name}`)
  for (let i = 0; i < orphelins.length; i += 200) await bucket.remove(orphelins.slice(i, i + 200))

  const dossiers = new Set<string>()
  for (const c of vus) {
    const m = c.split('/').slice(0, -1)
    for (let k = 1; k <= m.length; k++) dossiers.add(m.slice(0, k).join('/'))
  }
  const parts = [`${vus.size} PDF dans ${dossiers.size} dossier(s)`]
  if (envoyes) parts.push(`${envoyes} envoyé(s)`)
  if (lignes.length) parts.push(`${lignes.length} mis à jour`)
  if (retires.length) parts.push(`${retires.length} retiré(s)`)
  if (enAttente) parts.push(`${enAttente} en cours de synchronisation OneDrive`)
  await majEtat({ message: `Synchronisé depuis le dossier OneDrive : ${parts.join(', ')}.`, nb_fichiers: vus.size, nb_dossiers: dossiers.size })
  if (envoyes || lignes.length || retires.length) log(`Formation : ${parts.join(', ')}`)
}

async function synchroChapitres(sb: SupabaseClient, dossier: string, etat: Etat, force: boolean) {
  let noms: string[]
  try {
    noms = readdirSync(dossier).filter((n) => /^chapitre[-_ ].+\.html?$/i.test(n) && !n.startsWith('~$')).sort()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES')
      throw new Error(`macOS refuse l'accès au dossier (${code}). Réglages Système › Confidentialité et sécurité › Accès complet au disque : ajoutez « node » (${process.execPath}).`)
    throw new Error(`Dossier introuvable : ${dossier}`)
  }
  if (!noms.length) {
    log(`Aucun fichier CHAPITRE-*.html dans ${dossier}`)
    return
  }

  const { data, error } = await sb.from('guides_blg').select('slug, titre, ordre, version, prefixe, actif, icone, source_hash, fichier_origine')
  if (error) throw new Error(`Lecture du catalogue : ${error.message}`)
  const guides = (data ?? []) as GuideRow[]
  let ordreMax = guides.reduce((m, g) => Math.max(m, g.ordre ?? 0), 0)

  const inchanges: string[] = []
  let publies = 0
  for (const nom of noms) {
    const chemin = join(dossier, nom)
    const slug = slugDepuisFichier(nom)
    const existant = guides.find((g) => g.slug === slug) ?? null
    try {
      const st = statSync(chemin)
      const avant = etat[chemin]
      // Fichier en cours d'écriture par OneDrive : on attend le passage suivant.
      if (Date.now() - st.mtimeMs < 20_000) {
        log(`${nom} : modifié à l'instant, traité au prochain passage`)
        continue
      }
      if (!force && avant && avant.taille === st.size && avant.mtime === st.mtimeMs && existant?.source_hash === avant.hash) {
        inchanges.push(slug)
        continue
      }

      const hash = createHash('sha256').update(readFileSync(chemin)).digest('hex')
      etat[chemin] = { taille: st.size, mtime: st.mtimeMs, hash }
      if (!force && existant?.source_hash === hash) {
        await sb.from('guides_blg').update({ source_verifie_at: new Date().toISOString(), source_message: 'Synchronisé depuis le dossier OneDrive, inchangé.' }).eq('slug', slug)
        continue
      }
      log(`${nom} : nouvelle version, publication…`)
      const resume = await publier(sb, chemin, nom, hash, existant, ordreMax)
      if (!existant) ordreMax += 10
      publies++
      log(`${nom} : publié — ${resume}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      delete etat[chemin]
      log(`${nom} : ERREUR — ${msg}`)
      if (existant)
        await sb.from('guides_blg').update({ source_verifie_at: new Date().toISOString(), source_message: `Synchronisation OneDrive en échec : ${msg}` }).eq('slug', slug)
    }
  }
  // Date de dernière vérification visible dans l'écran (preuve que la synchro tourne).
  if (inchanges.length) await sb.from('guides_blg').update({ source_verifie_at: new Date().toISOString() }).in('slug', inchanges)
  if (publies) log(`${publies} chapitre(s) publié(s).`)
}

async function main() {
  chargerEnv()
  const force = process.argv.includes('--force')
  const dossier = argument('--dossier') ?? process.env.GUIDES_BLG_DOSSIER ?? dossierDeLaTacheMac() ?? ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!dossier) throw new Error('Dossier des chapitres non renseigné (GUIDES_BLG_DOSSIER ou --dossier).')
  if (!url || !cle) throw new Error(`NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent de ${join(RACINE, '.env.local')}.`)
  const dossierFormation = argument('--formation') ?? process.env.GUIDES_FORMATION_DOSSIER ?? trouverDossierFormation(dossier)

  const sb = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  const etat = lireEtat()
  let echec: unknown = null
  try {
    await synchroChapitres(sb, dossier, etat, force)
  } catch (e) {
    echec = e
    log(`Chapitres : ERREUR — ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    await synchroFormation(sb, dossierFormation, etat, force)
  } catch (e) {
    echec = echec ?? e
    const msg = e instanceof Error ? e.message : String(e)
    log(`Formation : ERREUR — ${msg}`)
    await sb.from('guides_blg_formation_etat').upsert({ id: 1, verifie_at: new Date().toISOString(), message: `Synchronisation en échec : ${msg}` }, { onConflict: 'id' })
  }
  writeFileSync(ETAT, JSON.stringify(etat, null, 2))
  if (echec) throw echec
}

main().catch((e) => {
  log(`ERREUR — ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
