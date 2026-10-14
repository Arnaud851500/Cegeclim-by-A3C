// ============================================================================
// app/api/actualites/assistant/route.ts — Assistant de rédaction du fil
// d'actualité (14/10/2026)
// ----------------------------------------------------------------------------
// À partir d'un mail (ou d'un texte) collé, des consignes du rédacteur et
// d'images (photos, impressions d'écran), propose une publication mise en
// forme dans le format de blocs du fil (lib/actualites.ts) : titre, catégorie,
// résumé, synthèse, encadrés, tableaux, images, liens — sur le modèle du
// premier « Dispo » Air-Eau. Le rédacteur relit et corrige dans l'éditeur.
//
// Sécurité :
//   - la clé OpenAI reste côté serveur (process.env.OPENAI_API_KEY) ;
//   - l'utilisateur est identifié par son jeton de session Supabase
//     (Authorization: Bearer …), pas par un e-mail envoyé par le navigateur ;
//   - seuls les rédacteurs (administrateurs + table actualites_redacteurs)
//     peuvent l'appeler, comme pour l'écriture en base ;
//   - la réponse de l'IA est filtrée : seuls les types de blocs connus,
//     des chaînes de texte et des liens http(s) / internes sont gardés.
// Modèle : OPENAI_ACTUALITES_MODEL, sinon OPENAI_MODEL (vercel.json).
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON d'OpenAI et corps de requête non typés, filtrés champ par champ ci-dessous */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const maxDuration = 180

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_ACTUALITES_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'

const MAX_TEXTE = 60000
const MAX_CONSIGNES = 4000
const MAX_IMAGES = 8
const MAX_IMAGE_CHARS = 3_000_000 // ≈ 2,2 Mo par image (data URL, déjà réduite par le navigateur)

const CATEGORIES = ['Dispo', 'Pénurie', 'Opération', 'Produit', 'Tarifs', 'Logistique', 'Outil', 'Info']

const LIENS_INTERNES = [
  ['/stock', 'Stock articles (recherche par référence, projection)'],
  ['/stock/groupes', "Disponibilité par groupe d'articles"],
  ['/stock/penurie', 'Références en pénurie'],
  ['/portefeuille-livraison', 'Portefeuille livraison (CDC à livrer)'],
  ['/vision-client', 'Vision client 360'],
  ['/actualites', "Fil d'actualité"],
]

type ImageIn = { dataUrl: string; role: 'auto' | 'photo' | 'capture_lire' | 'capture_inserer'; nom: string }

// ── Droits ─────────────────────────────────────────────────────────────────
async function emailDepuisJeton(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user?.email) return null
  return data.user.email.toLowerCase().trim()
}

async function peutPublier(email: string) {
  const { data: redacteur } = await supabaseAdmin.from('actualites_redacteurs').select('email').eq('email', email).maybeSingle()
  if (redacteur) return true

  const { data: userRow } = await supabaseAdmin
    .from('user_page_access')
    .select('can_autorisation, access_profile_id')
    .ilike('email', email)
    .maybeSingle()
  if (!userRow) return false
  if (userRow.can_autorisation) return true
  const profileId = String(userRow.access_profile_id || '').trim()
  if (!profileId) return false
  const { data: profil } = await supabaseAdmin
    .from('access_profiles')
    .select('name, can_autorisation, is_active')
    .eq('id', profileId)
    .maybeSingle()
  if (!profil) return false
  return Boolean(profil.can_autorisation) || (profil.is_active !== false && String(profil.name || '').trim().toLowerCase() === 'administrateur')
}

// ── Appel OpenAI (API Responses, même usage que /api/financement) ─────────
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

function tryParseJsonObject(text: string): any {
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
  const first = clean.indexOf('{')
  const last = clean.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(clean.slice(first, last + 1))
    } catch {}
  }
  return null
}

// ── Consignes de rédaction ────────────────────────────────────────────────
function construirePrompt(p: {
  type: 'actualite' | 'nouveaute'
  texte: string
  consignes: string
  images: ImageIn[]
  aujourdhui: string
}) {
  const roles = p.images
    .map((img, i) => {
      const role =
        img.role === 'photo'
          ? 'PHOTO à insérer (en tête de la publication sauf consigne contraire)'
          : img.role === 'capture_lire'
            ? 'CAPTURE À LIRE : transcris son contenu (tableaux, chiffres) en blocs texte / tableau, ne l’insère PAS comme image'
            : img.role === 'capture_inserer'
              ? 'CAPTURE À INSÉRER telle quelle, à l’endroit le plus pertinent, avec une légende'
              : 'à toi de décider : photo de produit → en tête ; capture de tableau ou de chiffres → transcrire en tableau (et ne pas l’insérer) ; capture d’écran d’un outil → insérer avec une légende'
      return `- Image n°${i} (« ${img.nom || 'sans nom'} ») : ${role}.`
    })
    .join('\n')

  return `Tu es le rédacteur du fil d'actualité interne de CEGECLIM, distributeur de climatisation et de pompes à chaleur Hitachi (Cooling & Heating). Les lecteurs sont les commerciaux et les agences, souvent sur leur téléphone entre deux rendez-vous : ils doivent comprendre en 10 secondes ce qui change et ce qu'ils doivent faire.

Ta tâche : transformer le contenu source ci-dessous (souvent un mail copié) en ${p.type === 'nouveaute' ? '« nouveauté du Compagnon » (nouvelle fonction de l’outil interne)' : 'actualité du fil'} prête à relire, en respectant les consignes du rédacteur.

RÈGLES ABSOLUES
- Ne jamais inventer un chiffre, une date, une référence, un prix ou une promesse. Recopie les valeurs exactement (références articles caractère par caractère). Si une information est ambiguë ou semble incohérente, garde-la telle quelle et signale-la dans "points_a_verifier".
- Français professionnel, phrases courtes, tutoiement interdit, pas d'emoji, pas de formules creuses.
- Retire ce qui ne sert pas au lecteur : salutations, signatures, en-têtes de mail, destinataires.
- Si la source mentionne une personne, garde son nom seulement quand c'est utile (source de l'information, contact).

STRUCTURE ATTENDUE (adapter, ne pas forcer)
1. Une photo en tête si une image est une photo de produit.
2. Un paragraphe de synthèse : l'essentiel en 2 à 3 phrases, chiffres clés en **gras**.
3. Un encadré "alerte" (rouge) pour une contrainte forte : pénurie, allocation, délai, date limite. Titre court.
4. Un encadré "info" intitulé « Ce qui est attendu de vous » avec 2 à 4 actions numérotées (1. 2. 3., une par ligne) — tirées de la source, pas inventées.
5. Si la source contient des stocks / quantités : un tableau « À proposer en priorité » avec les plus gros volumes disponibles (6 à 8 lignes max, colonnes Référence | Dispo | Désignation).
6. Les tableaux de détail : un intertitre par famille / gamme, puis un tableau. Ordre des colonnes : Référence, puis la valeur clé (Dispo, prix, date…), puis la désignation, puis le reste. Désignations raccourcies (retire le code article répété en fin de libellé). Valeurs négatives de dispo : écrire « −5 → arrivage ». Une longue liste d'arrivages ligne par ligne doit être regroupée par référence (1re date, quantités par mois, total) en vérifiant que le total est conservé.
7. Si des tableaux sont nombreux, un court paragraphe « Comment lire les tableaux ».
8. Une ligne « Source : … » (auteur, date) quand la source est un mail.
9. Des liens vers les écrans utiles de l'application, uniquement parmi : ${LIENS_INTERNES.map(([u, l]) => `${u} (${l})`).join(' ; ')}. Liens externes seulement s'ils figurent dans la source.

FORMAT DES BLOCS (JSON)
- {"type":"paragraph","text":"…"} — texte, **gras**, *italique*, [libellé](/chemin) autorisés.
- {"type":"heading","text":"…"}
- {"type":"list","ordered":false,"items":["…","…"]}
- {"type":"table","header":true,"rows":[["Col1","Col2"],["v1","v2"]]} — toutes les lignes ont le même nombre de cellules, valeurs en texte.
- {"type":"image","image":0,"caption":"…"} — "image" = numéro de l'image fournie.
- {"type":"callout","tone":"alerte"|"info","title":"…","text":"…"} — retours à la ligne avec \\n.
- {"type":"link","label":"…","url":"/stock"}

IMAGES FOURNIES
${roles || '- Aucune image.'}

CATÉGORIE : une parmi ${CATEGORIES.join(', ')}. « Dispo » pour un état des stocks / disponibilités.
Date du jour : ${p.aujourdhui}.

Réponds UNIQUEMENT avec ce JSON :
{"titre":"… (≤ 90 caractères, informatif, avec le chiffre clé si possible)","categorie":"…","resume":"… (1 à 2 phrases, ≤ 220 caractères, affiché dans la liste et « À la une »)","bandeau_jours": 7,"blocks":[…],"points_a_verifier":["…"]}
"bandeau_jours" = nombre de jours pendant lesquels l'information reste pertinente dans le bandeau (1 à 30).

CONSIGNES DU RÉDACTEUR
${p.consignes || '(aucune)'}

CONTENU SOURCE
${p.texte || '(aucun texte : travailler à partir des images)'}`
}

// ── Nettoyage de la réponse ───────────────────────────────────────────────
const str = (v: unknown, max = 4000) => String(v ?? '').slice(0, max)

function lienSur(url: unknown): string | null {
  const v = String(url || '').trim()
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v)) return v
  if (v.startsWith('/') && !v.startsWith('//')) return v
  return null
}

function nettoyerBlocs(raw: unknown, nbImages: number) {
  if (!Array.isArray(raw)) return []
  const out: Record<string, unknown>[] = []
  for (const b of raw.slice(0, 120)) {
    if (!b || typeof b !== 'object') continue
    const block = b as Record<string, unknown>
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        if (str(block.text).trim()) out.push({ type: block.type, text: str(block.text) })
        break
      case 'list': {
        const items = Array.isArray(block.items) ? block.items.map((x) => str(x, 600)).filter((x) => x.trim()) : []
        if (items.length) out.push({ type: 'list', ordered: Boolean(block.ordered), items: items.slice(0, 40) })
        break
      }
      case 'table': {
        const rows = Array.isArray(block.rows)
          ? block.rows.slice(0, 200).map((r) => (Array.isArray(r) ? r.slice(0, 12).map((c) => str(c, 300)) : []))
          : []
        const width = Math.max(0, ...rows.map((r) => r.length))
        if (width > 0 && rows.length > 0) {
          out.push({ type: 'table', header: block.header !== false, rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]) })
        }
        break
      }
      case 'image': {
        const n = Number(block.image)
        if (Number.isInteger(n) && n >= 0 && n < nbImages) out.push({ type: 'image', image: n, caption: str(block.caption, 300) })
        break
      }
      case 'callout':
        if (str(block.text).trim() || str(block.title).trim()) {
          out.push({ type: 'callout', tone: block.tone === 'alerte' ? 'alerte' : 'info', title: str(block.title, 120), text: str(block.text) })
        }
        break
      case 'link': {
        const url = lienSur(block.url)
        if (url && str(block.label).trim()) out.push({ type: 'link', label: str(block.label, 200), url })
        break
      }
      default:
        break
    }
  }
  return out
}

// ── Route ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const email = await emailDepuisJeton(req)
    if (!email) return NextResponse.json({ error: 'Session expirée : reconnectez-vous.' }, { status: 401 })
    if (!(await peutPublier(email))) {
      return NextResponse.json({ error: 'Réservé aux rédacteurs du fil d’actualité.' }, { status: 403 })
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "L'assistant n'est pas configuré sur ce serveur (clé OpenAI manquante)." }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

    let texte = str(body.texte, MAX_TEXTE + 1)
    if (texte.length > MAX_TEXTE) texte = `${texte.slice(0, MAX_TEXTE)}\n[… texte tronqué]`
    const consignes = str(body.consignes, MAX_CONSIGNES)
    const type: 'actualite' | 'nouveaute' = body.type === 'nouveaute' ? 'nouveaute' : 'actualite'
    const images: ImageIn[] = (Array.isArray(body.images) ? body.images : [])
      .slice(0, MAX_IMAGES)
      .filter((img: any) => typeof img?.dataUrl === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(img.dataUrl) && img.dataUrl.length <= MAX_IMAGE_CHARS)
      .map((img: any) => ({
        dataUrl: img.dataUrl,
        role: ['photo', 'capture_lire', 'capture_inserer'].includes(img.role) ? img.role : 'auto',
        nom: str(img.nom, 120),
      }))

    if (!texte.trim() && images.length === 0) {
      return NextResponse.json({ error: 'Collez un texte ou ajoutez au moins une image.' }, { status: 400 })
    }

    const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
    const prompt = construirePrompt({ type, texte, consignes, images, aujourdhui })

    const content: Record<string, unknown>[] = [{ type: 'input_text', text: prompt }]
    images.forEach((img, i) => {
      content.push({ type: 'input_text', text: `Image n°${i} :` })
      content.push({ type: 'input_image', image_url: img.dataUrl })
    })

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, input: [{ role: 'user', content }], max_output_tokens: 16000 }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = String(data?.error?.message || `Erreur OpenAI (${res.status}).`)
      const quota = /quota|billing/i.test(msg) || data?.error?.code === 'insufficient_quota'
      return NextResponse.json(
        { error: quota ? "Le compte IA de l'application n'a plus de quota. Contactez l'administrateur." : msg },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 }
      )
    }

    const parsed = tryParseJsonObject(extractOutputText(data))
    if (!parsed) return NextResponse.json({ error: 'La réponse de l’IA était incomplète. Relancez la proposition.' }, { status: 502 })

    const categorie = CATEGORIES.includes(String(parsed.categorie)) ? String(parsed.categorie) : 'Info'
    const jours = Math.min(30, Math.max(1, Math.round(Number(parsed.bandeau_jours) || 7)))

    return NextResponse.json({
      titre: str(parsed.titre, 140).trim(),
      categorie,
      resume: str(parsed.resume, 400).trim(),
      bandeau_jours: jours,
      blocks: nettoyerBlocs(parsed.blocks, images.length),
      points_a_verifier: Array.isArray(parsed.points_a_verifier)
        ? parsed.points_a_verifier.map((x: unknown) => str(x, 400)).filter((x: string) => x.trim()).slice(0, 12)
        : [],
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erreur serveur.' }, { status: 500 })
  }
}
