// ============================================================================
// app/api/stock/inventaire/lire-feuille/route.ts — lecture IA d'une feuille de
// comptage d'inventaire scannée (23/11/2026, demandé par Arnaud)
// ----------------------------------------------------------------------------
// Le navigateur rend chaque page du PDF scanné (ou chaque photo) en image JPEG
// et l'envoie ici, une page par appel. L'IA relève :
//   - l'en-tête imprimé (titre « campagne - dépôt », n° de comptage, code de
//     liste « INV-xxxxxxxx-Cn ») et les initiales manuscrites du cadre équipe ;
//   - chaque ligne d'article imprimée : référence (imprimée), quantité comptée
//     manuscrite, commentaire manuscrit, initiales de la colonne « Éq. » ;
//     case barrée / gribouillée / illisible = pas de quantité ;
//   - les articles hors liste notés à la main en bas de feuille.
// Aucune écriture dans l'inventaire : l'écran propose la saisie, l'utilisateur valide.
//
// 23/11/2026 (1er essai : « Failed to fetch ») : la lecture d'une page manuscrite
// dépasse souvent la minute et la connexion était coupée avant la réponse. La
// lecture se fait maintenant EN ARRIÈRE-PLAN : POST { image } crée une ligne dans
// inventaire_lectures_ia et répond aussitôt { id } ; la page est lue après la
// réponse (after()) et le résultat déposé dans la ligne ; l'écran interroge
// GET ?id=… toutes les 3 s. Les pages pivotées (scan portrait d'une feuille
// paysage) sont redressées par le navigateur ; l'IA est aussi prévenue.
// 23/11/2026 (2e essai : un « 1 » à cheval sur deux lignes attribué à la ligne du
// dessus) : l'IA part de chaque écriture manuscrite et relève les ancres imprimées
// de SA ligne (réf. fournisseur, qté stock) + position incertaine / ligne voisine ;
// l'écran compare ces ancres à la liste et alerte en cas de décalage.
// 23/11/2026 (3e essai) : ne relever que les lignes manuscrites faisait perdre le fil
// des lignes (quantités décalées d'une ligne) : retour à la transcription COMPLÈTE,
// ligne par ligne de haut en bas, ancres conservées.
// 23/11/2026 (idée d'Arnaud) : colonne « N° » imprimée = identifiant stable de la
// ligne ; l'IA le relève et l'écran rapproche d'abord par ce numéro (bien plus sûr
// que la lecture d'une référence comme « C90138GR »).
//
// Sécurité : session obligatoire (proxy.ts). Les droits sur le dépôt sont
// contrôlés au moment de l'enregistrement par les RPC inv_* (inv_peut_saisir).
// Même circuit de reconnaissance que « Quand puis-je livrer ? » (lecture photo de
// commande, /api/quand-livrer/photo) : callOpenAIResponses partagé, image en
// détail « high », une page par appel. OPENAI_INVENTAIRE_MODEL permet, si besoin,
// d'imposer un autre modèle pour l'écriture manuscrite.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any -- réponse JSON de l'IA filtrée champ par champ */
import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  AiRouteError,
  callOpenAIResponses,
  extractOutputText,
  tryParseJsonObject,
  type OpenAIContentPart,
} from '../../../financement/controle-pieces/_shared'

export const runtime = 'nodejs'
export const maxDuration = 300

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODELE_SPECIFIQUE = process.env.OPENAI_INVENTAIRE_MODEL || ''

const PROMPT = `Tu lis la photo ou le scan d'une feuille de comptage d'inventaire d'un distributeur français de génie climatique (CEGECLIM).
La feuille est un tableau IMPRIMÉ (texte machine) complété À LA MAIN par les inventoristes.
La feuille est au format paysage ; l'image peut être pivotée d'un quart de tour ou à l'envers : lis-la dans le bon sens.

EN-TÊTE (haut de page) :
- "titre" : la ligne de titre imprimée en gras, ex. « Inventaire fin d'année 2026 - ANGLET CEGECLIM » (recopie telle quelle) ;
- "depot" : le nom du dépôt contenu dans le titre (ex. « ANGLET CEGECLIM ») ;
- "comptage" : 1, 2 ou 3 d'après la ligne « 1er comptage / 2e comptage / 3e comptage » imprimée sous le titre, sinon null ;
- "code_liste" : le code imprimé « Liste INV-XXXXXXXX-Cn » (police machine à écrire), recopié exactement, caractère par caractère (ex. « INV-1A2B3C4D-C1 ») ; les 8 caractères après « INV- » sont UNIQUEMENT des chiffres 0-9 et des lettres A à F (hexadécimal : jamais de O, I, S…) ; sinon "" ;
- "date_inventaire" : la date « inventaire du JJ/MM/AAAA » au format AAAA-MM-JJ, sinon "" ;
- "equipes" : les initiales manuscrites écrites dans le cadre « Équipe(s) (initiales) » en haut à droite. Une équipe regroupe souvent 2 personnes reliées par « / », « + » ou « & » (ex. « PL + YV ») : c'est UNE équipe, renvoie-la sous la forme « PL/YV ». Seulement s'il y a deux équipes distinctes (deux groupes d'initiales séparés par une virgule, « et », ou écrits sur deux lignes), renvoie-les comme deux éléments. Lettres seules, en majuscules. Liste vide si rien n'est écrit ;
- "feuille" : le texte « Feuille x / y » imprimé, sinon "".

TABLEAU : colonnes imprimées « N° | Réf. CEGECLIM | Réf. fournisseur | Désignation | Qté stock | Qté comptée | Éq. | PUMP | Commentaire » (les colonnes « N° » et « Éq. » n'existent pas sur les anciennes feuilles).
La colonne « N° » (1re colonne, chiffres en police machine à écrire) est la CLÉ de la ligne : lis-la avec le plus grand soin, chiffre par chiffre.
MÉTHODE (important : ne jamais décaler d'une ligne) :
Parcours le tableau LIGNE PAR LIGNE, de haut en bas, sans en sauter aucune, et relève CHAQUE ligne d'article imprimée, y compris celles dont la case « Qté comptée » est vide.
Pour chaque ligne, lis de gauche à droite en suivant la ligne horizontale du tableau : N°, Réf. CEGECLIM, Réf. fournisseur, Qté stock imprimés, puis ce qui est écrit à la main dans les cases « Qté comptée », « Éq. » et « Commentaire » de CETTE ligne.
Une écriture appartient à la ligne dont la case contient la plus grande partie de l'écriture. Si elle est vraiment à cheval sur deux lignes, mets "position_incertaine": true et indique dans "ref_voisine" la Réf. CEGECLIM de l'autre ligne possible.
Ignore les lignes de titre de section (« ACC », « En transit … ») et l'en-tête des colonnes.
Pour chaque ligne :
- "no" : le nombre imprimé de la colonne « N° » de la ligne (entier), null si la colonne n'existe pas ;
- "ref" : la Réf. CEGECLIM imprimée (1re colonne, en gras) de la ligne, recopiée exactement, sans « (hors liste) » ni « (transit) » ;
- "ref_fournisseur" : la Réf. fournisseur imprimée sur la même ligne ;
- "qte_stock" : le nombre IMPRIMÉ de la colonne « Qté stock » de la même ligne (ancre de contrôle, peut être négatif) ;
- "qte" et "etat" : uniquement ce qui est écrit À LA MAIN dans la case « Qté comptée ». ATTENTION : ne prends JAMAIS le nombre imprimé de la colonne « Qté stock » ni le PUMP comme quantité comptée.
   * rien d'écrit dans la case → "etat": "vide", "qte": null ;
   * nombre manuscrit net → "etat": "lisible", "qte": le nombre (0 est une valeur valable ; virgule décimale possible) ;
   * nombre barré puis un autre nombre écrit à côté → "etat": "corrige", "qte": le nombre NON barré ;
   * case barrée, rayée, gribouillée ou nombre barré sans remplaçant → "etat": "barre", "qte": null ;
   * écriture impossible à lire avec certitude → "etat": "illisible", "qte": ta meilleure lecture ou null ;
- "doute" : true si tu hésites sur un chiffre (1/7, 4/9, 5/6, 0/6, 3/8…), sinon false ;
- "position_incertaine" et "ref_voisine" : voir la méthode ci-dessus (false et "" sinon) ;
- "commentaire" : le texte manuscrit de la colonne « Commentaire » de la ligne, recopié tel quel (sinon "") ; un texte barré ne compte pas ;
- "equipe" : les initiales manuscrites de la colonne « Éq. » de la ligne, ou à défaut des initiales écrites à côté de la quantité ou en marge de cette ligne (sinon "").
Une flèche ou un trait « idem » / guillemets « " » dans la case quantité ne sont pas une quantité : "etat": "illisible".

HORS LISTE : en bas de la dernière page, un cadre « Articles trouvés hors liste » peut contenir des références écrites à la main avec une quantité. Relève-les dans "hors_liste" : [{"ref": "…", "qte": nombre ou null, "commentaire": "…"}]. Liste vide sinon.

Réponds uniquement avec ce JSON :
{"entete": {"titre": "", "depot": "", "comptage": null, "code_liste": "", "date_inventaire": "", "equipes": [], "feuille": ""},
 "lignes": [{"no": null, "ref": "", "ref_fournisseur": "", "qte_stock": 0, "qte": null, "etat": "lisible", "doute": false, "position_incertaine": false, "ref_voisine": "", "commentaire": "", "equipe": ""}],
 "hors_liste": []}`

async function lireImage(image: string): Promise<any> {
  const content: OpenAIContentPart[] = [{ type: 'input_text', text: PROMPT }, { type: 'input_image', image_url: image, detail: 'high' }]
  if (!MODELE_SPECIFIQUE) return callOpenAIResponses(content, { maxOutputTokens: 8000 })
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELE_SPECIFIQUE, input: [{ role: 'user', content }], max_output_tokens: 8000 }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error?.message || `Erreur OpenAI (${res.status}).`
    throw new AiRouteError(/quota|billing/i.test(msg) ? "Le compte IA n'a plus de quota. Contactez l'administrateur." : msg, 502)
  }
  return data
}

function nombre(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(x) && x >= 0 && x < 1e7 ? x : null
}
function texte(v: any, max = 300): string {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max)
}
function initiales(v: any): string {
  return texte(v, 30).toUpperCase().split(/[^A-ZÀ-Ÿ]+/).filter(Boolean).join('/')
}
const ETATS = new Set(['vide', 'lisible', 'corrige', 'barre', 'illisible'])

async function emailDepuisJeton(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user?.email) return null
  return data.user.email.toLowerCase().trim()
}

/** Lecture d'une page : renvoie { entete, lignes, hors_liste } ou lève une erreur. */
async function analyser(image: string) {
  const data = await lireImage(image)
  const json = tryParseJsonObject(extractOutputText(data))
  if (!json || !Array.isArray(json.lignes)) throw new Error('Lecture de la page impossible (réponse IA illisible). Rescanner la page plus nettement.')

  const e = json.entete || {}
  const comptage = [1, 2, 3].includes(Number(e.comptage)) ? Number(e.comptage) : null
  const dateInv = /^\d{4}-\d{2}-\d{2}$/.test(String(e.date_inventaire || '')) ? String(e.date_inventaire) : ''
  const entete = {
    titre: texte(e.titre, 200),
    depot: texte(e.depot, 120),
    comptage,
    code_liste: texte(e.code_liste, 40).toUpperCase(),
    date_inventaire: dateInv,
    equipes: (Array.isArray(e.equipes) ? e.equipes : [e.equipes]).map(initiales).filter(Boolean).slice(0, 4),
    feuille: texte(e.feuille, 30),
  }
  const lignes = json.lignes
    .map((l: any) => {
      const etat = ETATS.has(String(l?.etat)) ? String(l.etat) : 'illisible'
      const qte = etat === 'vide' || etat === 'barre' ? null : nombre(l?.qte)
      return {
        no: (() => { const x = Number(String(l?.no ?? '').replace(/\D/g, '')); return l?.no === null || l?.no === undefined || l?.no === '' || !Number.isSafeInteger(x) || x <= 0 ? null : x })(),
        ref: texte(l?.ref, 60).toUpperCase().replace(/\s*\((HORS LISTE|TRANSIT)\)\s*/g, '').replace(/\s+/g, ''),
        qte,
        etat: etat === 'lisible' && qte === null ? 'illisible' : etat,
        doute: Boolean(l?.doute),
        ref_fournisseur: texte(l?.ref_fournisseur, 60).toUpperCase(),
        qte_stock: (() => { const x = Number(String(l?.qte_stock ?? '').replace(/\s/g, '').replace(',', '.')); return l?.qte_stock === null || l?.qte_stock === '' || !Number.isFinite(x) ? null : x })(),
        position_incertaine: Boolean(l?.position_incertaine),
        ref_voisine: texte(l?.ref_voisine, 60).toUpperCase().replace(/\s+/g, ''),
        commentaire: texte(l?.commentaire, 300),
        equipe: initiales(l?.equipe),
      }
    })
    .filter((l: { ref: string }) => l.ref.length >= 2)
  const horsListe = (Array.isArray(json.hors_liste) ? json.hors_liste : [])
    .map((l: any) => ({ ref: texte(l?.ref, 60).toUpperCase().replace(/\s+/g, ''), qte: nombre(l?.qte), commentaire: texte(l?.commentaire, 300) }))
    .filter((l: { ref: string }) => l.ref.length >= 2)
  return { entete, lignes, hors_liste: horsListe }
}

/** Démarre la lecture d'une page : réponse immédiate { id }, lecture en arrière-plan. */
export async function POST(req: NextRequest) {
  try {
    if (!OPENAI_API_KEY) return NextResponse.json({ error: "La lecture IA n'est pas configurée sur ce serveur (clé OpenAI manquante)." }, { status: 500 })
    const email = await emailDepuisJeton(req)
    if (!email) return NextResponse.json({ error: 'Session requise.' }, { status: 401 })
    const body = await req.json().catch(() => null)
    const image = typeof body?.image === 'string' && body.image.startsWith('data:image/') ? body.image : ''
    if (!image) return NextResponse.json({ error: 'Aucune image reçue.' }, { status: 400 })

    const { data: row, error } = await supabaseAdmin.from('inventaire_lectures_ia').insert({ cree_par: email }).select('id').single()
    if (error || !row) return NextResponse.json({ error: `Lecture impossible à démarrer : ${error?.message || 'erreur base'}` }, { status: 500 })
    const id = row.id as string
    console.log(`[inventaire/lire-feuille] ${id} démarrée par ${email} (${Math.round(image.length / 1024)} Ko)`)

    after(async () => {
      const t0 = Date.now()
      try {
        const resultat = await analyser(image)
        await supabaseAdmin.from('inventaire_lectures_ia').update({ statut: 'ok', resultat, duree_ms: Date.now() - t0 }).eq('id', id)
        console.log(`[inventaire/lire-feuille] ${id} ok en ${Date.now() - t0} ms (${resultat.lignes.length} lignes)`)
      } catch (err: any) {
        await supabaseAdmin.from('inventaire_lectures_ia').update({ statut: 'erreur', erreur: String(err?.message || err).slice(0, 500), duree_ms: Date.now() - t0 }).eq('id', id)
        console.error(`[inventaire/lire-feuille] ${id} erreur en ${Date.now() - t0} ms : ${err?.message || err}`)
      }
      await supabaseAdmin.from('inventaire_lectures_ia').delete().lt('cree_le', new Date(Date.now() - 7 * 86400000).toISOString())
    })

    return NextResponse.json({ id })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}

/** État d'une lecture : { statut: 'en_cours' | 'ok' | 'erreur', resultat?, erreur? }. */
export async function GET(req: NextRequest) {
  const email = await emailDepuisJeton(req)
  if (!email) return NextResponse.json({ error: 'Session requise.' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Lecture inconnue.' }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('inventaire_lectures_ia').select('statut, resultat, erreur, cree_par, cree_le').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.cree_par !== email) return NextResponse.json({ error: 'Lecture inconnue.' }, { status: 404 })
  // Lecture jamais terminée (fonction arrêtée) : erreur au-delà de 6 minutes.
  if (data.statut === 'en_cours' && Date.now() - new Date(data.cree_le).getTime() > 6 * 60000) {
    return NextResponse.json({ statut: 'erreur', erreur: 'La lecture de la page n’a pas abouti (délai dépassé). Relancer la page.' })
  }
  return NextResponse.json({ statut: data.statut, resultat: data.resultat, erreur: data.erreur })
}
