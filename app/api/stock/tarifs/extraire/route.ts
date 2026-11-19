// ============================================================================
// app/api/stock/tarifs/extraire/route.ts — Extraction IA d'une grille de tarif
// fournisseur (écran « Tarifs fournisseurs », 19/11/2026)
// ----------------------------------------------------------------------------
// Utilisée quand un PDF de proposition de tarif est trop mal structuré pour la
// lecture par colonnes : le navigateur envoie le texte d'un lot de pages (pdf.js,
// cellules séparées par « | ») et reçoit les lignes d'articles normalisées
// { ref_fournisseur, ean, designation, marque, gamme, prix_public, paliers[] }.
//
// Sécurité : session Supabase obligatoire (Authorization: Bearer, vérifiée ici
// comme par proxy.ts) et droit Appro (can_appro / can_autorisation, utilisateur
// ou profil). La clé OpenAI reste côté serveur.
// Modèle : OPENAI_TARIFS_MODEL, sinon OPENAI_MODEL, sinon gpt-4.1-mini.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON d'OpenAI filtrées champ par champ */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const maxDuration = 300

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_TARIFS_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MAX_TEXTE = 40000

async function emailDepuisJeton(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user?.email) return null
  return data.user.email.toLowerCase().trim()
}

async function peutAcceder(email: string) {
  const { data: userRow } = await supabaseAdmin.from('user_page_access').select('*').ilike('email', email).maybeSingle()
  if (!userRow) return false
  if (userRow.can_appro || userRow.can_autorisation) return true
  const principalId = String(userRow.access_profile_id || '').trim()
  const complementaires = Array.isArray(userRow.profils_complementaires) ? userRow.profils_complementaires : []
  const ids = Array.from(new Set([principalId, ...complementaires.map((id: unknown) => String(id || '').trim())].filter(Boolean)))
  if (!ids.length) return false
  const { data: profils } = await supabaseAdmin.from('access_profiles').select('*').in('id', ids)
  return (profils || []).some((p: any) => p.is_active !== false && Boolean(p.can_appro || p.can_autorisation))
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  const parts: string[] = []
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text)
      if (typeof content?.text?.value === 'string') parts.push(content.text.value)
    }
  }
  return parts.join('\n').trim()
}

function tryParseJson(text: string): any {
  const clean = String(text || '').trim()
  if (!clean) return null
  try {
    return JSON.parse(clean)
  } catch {}
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  if (fenced) {
    try {
      return JSON.parse(fenced.trim())
    } catch {}
  }
  const a = clean.indexOf('{')
  const b = clean.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(clean.slice(a, b + 1))
    } catch {}
  }
  return null
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.').replace(/[€%]/g, ''))
  return Number.isFinite(x) ? x : null
}
function str(v: any, max = 200): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

export async function POST(req: NextRequest) {
  try {
    const email = await emailDepuisJeton(req)
    if (!email) return NextResponse.json({ error: 'Session requise.' }, { status: 401 })
    if (!(await peutAcceder(email))) return NextResponse.json({ error: 'Accès réservé aux utilisateurs Appro.' }, { status: 403 })
    if (!OPENAI_API_KEY) return NextResponse.json({ error: "L'extraction IA n'est pas configurée sur ce serveur (clé OpenAI manquante)." }, { status: 500 })

    const body = await req.json().catch(() => null)
    let texte = String(body?.texte || '')
    if (!texte.trim()) return NextResponse.json({ error: 'Texte vide.' }, { status: 400 })
    if (texte.length > MAX_TEXTE) texte = texte.slice(0, MAX_TEXTE)
    const fournisseur = str(body?.fournisseur, 120) || 'non précisé'

    const prompt = `Tu lis une proposition de tarif d'achat envoyée par un fournisseur (${fournisseur}) à un distributeur français de génie climatique.
Le texte ci-dessous a été extrait d'un PDF : chaque ligne du document est sur une ligne, les cellules sont séparées par « | ». Les colonnes peuvent être décalées.

Extrais CHAQUE article du tarif, sans en oublier ni en inventer :
- "ref" : la référence / le code article du fournisseur, tel qu'écrit ;
- "ean" : le code EAN/GTIN s'il existe, sinon "" ;
- "designation" : le libellé ;
- "marque" et "gamme" si le document les indique (titre de section, colonne), sinon "" ;
- "prix_public" : prix public / catalogue s'il existe, sinon null ;
- "paliers" : la liste des prix d'achat nets HT par quantité minimale de commande, [{"qte": 1, "prix": 117.78}, {"qte": 10, "prix": 105.89}] ; s'il n'y a qu'un prix d'achat : [{"qte": 1, "prix": …}]. Si seul un prix brut et une remise sont donnés, calcule le prix net. N'utilise jamais le prix public comme prix d'achat sauf si c'est le seul prix et qu'aucune remise n'est indiquée.
Nombres au format JSON (point décimal, sans symbole).
Indique aussi, si tu les vois, "date_effet" et "date_fin" de validité du tarif (AAAA-MM-JJ) et "conditions" (franco, minimum de commande, règlement…), sinon "".

Réponds uniquement avec ce JSON :
{"date_effet": "", "date_fin": "", "conditions": [""], "lignes": [{"ref": "", "ean": "", "designation": "", "marque": "", "gamme": "", "prix_public": null, "paliers": [{"qte": 1, "prix": 0}]}]}

TEXTE :
${texte}`

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], max_output_tokens: 16000 }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = data?.error?.message || `Erreur OpenAI (${res.status}).`
      return NextResponse.json({ error: /quota|billing/i.test(msg) ? "Le compte IA n'a plus de quota. Contactez l'administrateur." : msg }, { status: 502 })
    }
    const json = tryParseJson(extractOutputText(data))
    if (!json || !Array.isArray(json.lignes)) return NextResponse.json({ error: "Réponse de l'IA illisible." }, { status: 502 })

    const lignes = json.lignes
      .map((l: any) => ({
        ref_fournisseur: str(l?.ref, 80),
        ean: str(l?.ean, 20),
        designation: str(l?.designation, 300),
        marque: str(l?.marque, 80),
        gamme: str(l?.gamme, 160),
        prix_public: num(l?.prix_public),
        paliers: (Array.isArray(l?.paliers) ? l.paliers : [])
          .map((p: any) => ({ qte: Math.max(1, num(p?.qte) ?? 1), prix: num(p?.prix) }))
          .filter((p: any) => p.prix !== null && p.prix > 0),
      }))
      .filter((l: any) => (l.ref_fournisseur || l.ean) && l.paliers.length)

    const dateOk = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
    return NextResponse.json({
      date_effet: dateOk(json.date_effet),
      date_fin: dateOk(json.date_fin),
      conditions: (Array.isArray(json.conditions) ? json.conditions : []).map((c: any) => str(c, 220)).filter(Boolean).slice(0, 15),
      lignes,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur inattendue.' }, { status: 500 })
  }
}
