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
// Aucune écriture en base : l'écran propose la saisie, l'utilisateur valide.
//
// Sécurité : session obligatoire (proxy.ts). Les droits sur le dépôt sont
// contrôlés au moment de l'enregistrement par les RPC inv_* (inv_peut_saisir).
// Même circuit de reconnaissance que « Quand puis-je livrer ? » (lecture photo de
// commande, /api/quand-livrer/photo) : callOpenAIResponses partagé, image en
// détail « high », une page par appel. OPENAI_INVENTAIRE_MODEL permet, si besoin,
// d'imposer un autre modèle pour l'écriture manuscrite.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any -- réponse JSON de l'IA filtrée champ par champ */
import { NextRequest, NextResponse } from 'next/server'
import {
  AiRouteError,
  callOpenAIResponses,
  extractOutputText,
  tryParseJsonObject,
  type OpenAIContentPart,
} from '../../../financement/controle-pieces/_shared'

export const runtime = 'nodejs'
export const maxDuration = 180

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODELE_SPECIFIQUE = process.env.OPENAI_INVENTAIRE_MODEL || ''

const PROMPT = `Tu lis la photo ou le scan d'une feuille de comptage d'inventaire d'un distributeur français de génie climatique (CEGECLIM).
La feuille est un tableau IMPRIMÉ (texte machine) complété À LA MAIN par les inventoristes.

EN-TÊTE (haut de page) :
- "titre" : la ligne de titre imprimée en gras, ex. « Inventaire fin d'année 2026 - ANGLET CEGECLIM » (recopie telle quelle) ;
- "depot" : le nom du dépôt contenu dans le titre (ex. « ANGLET CEGECLIM ») ;
- "comptage" : 1, 2 ou 3 d'après la ligne « 1er comptage / 2e comptage / 3e comptage » imprimée sous le titre, sinon null ;
- "code_liste" : le code imprimé « Liste INV-XXXXXXXX-Cn » (police machine à écrire), recopié exactement (ex. « INV-1A2B3C4D-C1 »), sinon "" ;
- "date_inventaire" : la date « inventaire du JJ/MM/AAAA » au format AAAA-MM-JJ, sinon "" ;
- "equipes" : les initiales manuscrites écrites dans le cadre « Équipe(s) (initiales) » en haut à droite. Une équipe peut regrouper 2 personnes écrites « PJC/AV ». S'il y a deux équipes distinctes (deux groupes d'initiales séparés par « et », une virgule, un tiret ou sur deux lignes), renvoie-les comme deux éléments. Lettres seules, en majuscules. Liste vide si rien n'est écrit ;
- "feuille" : le texte « Feuille x / y » imprimé, sinon "".

TABLEAU : colonnes imprimées « Réf. CEGECLIM | Réf. fournisseur | Désignation | Qté stock | Qté comptée | Éq. | PUMP | Commentaire » (la colonne « Éq. » peut ne pas exister sur les anciennes feuilles).
Relève CHAQUE ligne d'article imprimée de la page, dans l'ordre, y compris celles dont la case « Qté comptée » est vide. Ignore les lignes de titre de section (familles comme « ACC », « En transit … ») et la ligne d'en-tête des colonnes.
Pour chaque ligne :
- "ref" : la Réf. CEGECLIM imprimée (1re colonne, en gras), recopiée exactement, sans le texte « (hors liste) » ou « (transit) » ;
- "qte" et "etat" : uniquement ce qui est écrit À LA MAIN dans la case « Qté comptée ». ATTENTION : ne prends JAMAIS le nombre imprimé de la colonne « Qté stock » ni le PUMP.
   * case vide → "etat": "vide", "qte": null ;
   * nombre manuscrit net → "etat": "lisible", "qte": le nombre (0 est une valeur valable ; virgule décimale possible) ;
   * nombre barré puis un autre nombre écrit à côté → "etat": "corrige", "qte": le nombre NON barré ;
   * case barrée, rayée, gribouillée ou nombre barré sans remplaçant → "etat": "barre", "qte": null ;
   * écriture impossible à lire avec certitude → "etat": "illisible", "qte": ta meilleure lecture ou null ;
- "doute" : true si tu hésites sur un chiffre (1/7, 4/9, 5/6, 0/6, 3/8…), sinon false ;
- "commentaire" : le texte manuscrit de la colonne « Commentaire » de la ligne, recopié tel quel (sinon "") ; un texte barré ne compte pas ;
- "equipe" : les initiales manuscrites de la colonne « Éq. » de la ligne, ou à défaut des initiales écrites à côté de la quantité ou en marge de cette ligne (sinon "").
Une flèche ou un trait « idem » / guillemets « " » dans la case quantité ne sont pas une quantité : "etat": "illisible".

HORS LISTE : en bas de la dernière page, un cadre « Articles trouvés hors liste » peut contenir des références écrites à la main avec une quantité. Relève-les dans "hors_liste" : [{"ref": "…", "qte": nombre ou null, "commentaire": "…"}]. Liste vide sinon.

Réponds uniquement avec ce JSON :
{"entete": {"titre": "", "depot": "", "comptage": null, "code_liste": "", "date_inventaire": "", "equipes": [], "feuille": ""},
 "lignes": [{"ref": "", "qte": null, "etat": "vide", "doute": false, "commentaire": "", "equipe": ""}],
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const image = typeof body?.image === 'string' && body.image.startsWith('data:image/') ? body.image : ''
    if (!image) return NextResponse.json({ error: 'Aucune image reçue.' }, { status: 400 })

    const data = await lireImage(image)
    const json = tryParseJsonObject(extractOutputText(data))
    if (!json || !Array.isArray(json.lignes)) return NextResponse.json({ error: 'Lecture de la page impossible (réponse IA illisible). Rescanner la page plus nettement.' }, { status: 502 })

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
          ref: texte(l?.ref, 60).toUpperCase().replace(/\s*\((HORS LISTE|TRANSIT)\)\s*/g, '').replace(/\s+/g, ''),
          qte,
          etat: etat === 'lisible' && qte === null ? 'illisible' : etat,
          doute: Boolean(l?.doute),
          commentaire: texte(l?.commentaire, 300),
          equipe: initiales(l?.equipe),
        }
      })
      .filter((l: { ref: string }) => l.ref.length >= 2)
    const horsListe = (Array.isArray(json.hors_liste) ? json.hors_liste : [])
      .map((l: any) => ({ ref: texte(l?.ref, 60).toUpperCase().replace(/\s+/g, ''), qte: nombre(l?.qte), commentaire: texte(l?.commentaire, 300) }))
      .filter((l: { ref: string }) => l.ref.length >= 2)

    return NextResponse.json({ entete, lignes, hors_liste: horsListe })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}
