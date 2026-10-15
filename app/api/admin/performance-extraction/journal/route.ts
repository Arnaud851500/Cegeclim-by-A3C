// ============================================================================
// app/api/admin/performance-extraction/journal/route.ts — Intégration du journal
// ----------------------------------------------------------------------------
// 15/10/2026. Le script Export_Sage_Supabase.ps1 (TSE) dépose son journal
// d'exécution dans sage-imports/journal/journal_exports.csv à chaque
// lancement (scripts/tse/Envoi_journal_exports.ps1). Cette route, appelée par
// l'écran Admin › Performance des extractions, lit ce fichier et l'intègre
// dans public.sage_export_journal via la RPC ingest_sage_export_journal
// (upsert lancement + export : rejouer le même journal ne crée pas de doublon).
//
// Encodages acceptés : UTF-8 (avec ou sans BOM), UTF-16 (Export-Csv de
// Windows PowerShell 5), Windows-1252. Séparateur détecté (; , ou tabulation).
// Accès : administrateurs (todo_is_admin).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'sage-imports'
const OBJET_JOURNAL = 'journal/journal_exports.csv'
const TAILLE_LOT = 500

function decoder(octets: Uint8Array): string {
  if (octets.length >= 2 && octets[0] === 0xff && octets[1] === 0xfe) return new TextDecoder('utf-16le').decode(octets.subarray(2))
  if (octets.length >= 2 && octets[0] === 0xfe && octets[1] === 0xff) return new TextDecoder('utf-16be').decode(octets.subarray(2))
  if (octets.length >= 3 && octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf) return new TextDecoder('utf-8').decode(octets.subarray(3))
  // UTF-16 sans BOM : un octet nul sur deux
  const echantillon = octets.subarray(0, Math.min(octets.length, 400))
  let nulsImpairs = 0
  let nulsPairs = 0
  for (let i = 0; i < echantillon.length; i++) {
    if (echantillon[i] === 0) {
      if (i % 2 === 1) nulsImpairs++
      else nulsPairs++
    }
  }
  if (nulsImpairs > echantillon.length / 4 && nulsPairs < echantillon.length / 20) return new TextDecoder('utf-16le').decode(octets)
  if (nulsPairs > echantillon.length / 4 && nulsImpairs < echantillon.length / 20) return new TextDecoder('utf-16be').decode(octets)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets)
  } catch {
    return new TextDecoder('windows-1252').decode(octets)
  }
}

function lireCsv(texte: string): Record<string, string>[] {
  const lignesBrutes = texte.replace(/\r\n?/g, '\n')
  const premiere = lignesBrutes.split('\n', 1)[0] ?? ''
  const separateur = [';', '\t', ','].map((s) => ({ s, n: premiere.split(s).length })).sort((a, b) => b.n - a.n)[0].s

  const lignes: string[][] = []
  let champ = ''
  let ligne: string[] = []
  let guillemets = false
  for (let i = 0; i < lignesBrutes.length; i++) {
    const c = lignesBrutes[i]
    if (guillemets) {
      if (c === '"') {
        if (lignesBrutes[i + 1] === '"') {
          champ += '"'
          i++
        } else guillemets = false
      } else champ += c
    } else if (c === '"') guillemets = true
    else if (c === separateur) {
      ligne.push(champ)
      champ = ''
    } else if (c === '\n') {
      ligne.push(champ)
      lignes.push(ligne)
      ligne = []
      champ = ''
    } else champ += c
  }
  if (champ !== '' || ligne.length) {
    ligne.push(champ)
    lignes.push(ligne)
  }

  const entetes = (lignes.shift() ?? []).map((e) => e.replace(/\0/g, '').trim())
  return lignes
    .filter((l) => l.some((v) => v.replace(/\0/g, '').trim() !== ''))
    .map((l) => {
      const objet: Record<string, string> = {}
      entetes.forEach((e, i) => {
        if (e) objet[e] = (l[i] ?? '').replace(/\0/g, '').trim()
      })
      return objet
    })
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    return NextResponse.json({ error: 'Variables Supabase manquantes côté serveur.' }, { status: 500 })
  }

  const jeton = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jeton) return NextResponse.json({ error: 'Session utilisateur absente.' }, { status: 401 })

  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jeton}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: estAdmin, error: erreurAdmin } = await client.rpc('todo_is_admin')
  if (erreurAdmin) return NextResponse.json({ error: erreurAdmin.message }, { status: 401 })
  if (!estAdmin) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: liste } = await admin.storage.from(BUCKET).list('journal', { limit: 10, search: 'journal_exports.csv' })
  const objet = (liste || []).find((o) => o.name === 'journal_exports.csv')
  if (!objet) {
    return NextResponse.json({ present: false, message: 'Aucun journal déposé pour l’instant dans sage-imports/journal.' })
  }
  const deposeLe = objet.updated_at || objet.created_at || null

  const { data: fichier, error: erreurFichier } = await admin.storage.from(BUCKET).download(OBJET_JOURNAL)
  if (erreurFichier || !fichier) {
    return NextResponse.json({ error: erreurFichier?.message || 'Téléchargement du journal impossible.' }, { status: 500 })
  }
  const octets = new Uint8Array(await fichier.arrayBuffer())
  if (octets.length && octets.every((o) => o === 0)) {
    return NextResponse.json({
      present: true,
      depose_le: deposeLe,
      error: 'Le journal déposé ne contient que des octets nuls (fichier en cours d’écriture ou non synchronisé).',
    }, { status: 422 })
  }

  const lignes = lireCsv(decoder(octets))
  const colonnes = lignes.length ? Object.keys(lignes[0]) : []
  let integrees = 0
  for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
    const { data, error } = await admin.rpc('ingest_sage_export_journal', {
      p_lignes: lignes.slice(i, i + TAILLE_LOT),
      p_poste: 'TSE',
    })
    if (error) {
      return NextResponse.json({ present: true, depose_le: deposeLe, colonnes, lues: lignes.length, integrees, error: error.message }, { status: 500 })
    }
    integrees += Number(data) || 0
  }

  return NextResponse.json({ present: true, depose_le: deposeLe, colonnes, lues: lignes.length, integrees })
}
