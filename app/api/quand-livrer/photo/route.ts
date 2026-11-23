import { NextRequest, NextResponse } from 'next/server'
import {
  callOpenAIResponses,
  extractOutputText,
  tryParseJsonObject,
  AiRouteError,
  type OpenAIContentPart,
} from '../../financement/controle-pieces/_shared'

// ============================================================================
// /api/quand-livrer/photo — lecture d'une photo de commande (20/11/2026)
// ----------------------------------------------------------------------------
// Écran « Quand puis-je livrer ? » : une photo (ou capture) d'un bon de
// commande, d'une liste manuscrite ou d'un mail est lue par l'IA, qui renvoie
// les couples référence article / quantité. Le contrôle (référence connue,
// dispo) est ensuite fait côté base par l'écran. Session obligatoire (proxy.ts).
// ÉVOLUTION (23/11/2026) : lit aussi la date de livraison prévue / souhaitée du
// document (ex. « Date livraison Prévue 040127 » d'un bon de commande SAGE) et la
// renvoie en date_livraison (AAAA-MM-JJ) ; l'écran dit si elle est tenable.
// ÉVOLUTION (23/11/2026, captures SAGE mal lues) : image envoyée en détail « high »,
// consigne propre aux grilles SAGE / BLG (colonne Référence article, références
// tronquées « … » gardées et signalées, désignation recopiée en entier, colonne
// Quantité et non Montant) ; chaque ligne renvoie sa désignation et un drapeau
// tronquee, que l'écran rapproche du catalogue (RPC ql_resoudre_references).
// ============================================================================

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const images: string[] = Array.isArray(body?.images)
      ? body.images.filter((x: unknown) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 4)
      : []
    if (!images.length) return NextResponse.json({ error: 'Aucune image reçue.' }, { status: 400 })

    const prompt = `Tu lis une capture d'écran ou une photo de commande / devis de matériel de génie climatique (climatisation, pompes à chaleur, ECS, accessoires frigorifiques, cuivre, aéraulique) pour un distributeur français.
Ce peut être une grille du logiciel SAGE ou BLG (colonnes « Référence article », « Désignation », « P.U. HT », « Quantité », « Conditionnement », « Remise », « P.U. net », « Montant HT », « Dépôt »), un bon de commande client, un mail ou une liste manuscrite.

Relève CHAQUE ligne d'article, dans l'ordre, sans en sauter aucune :
- "ref" : la référence article (colonne « Référence article », 1re colonne d'une grille SAGE). Recopie-la caractère par caractère, exactement comme écrite (majuscules, chiffres, tirets, barres obliques). Attention aux confusions I / L / 1, O / 0, et à l'ordre des lettres. N'ajoute ni ne retire aucune lettre.
- si la référence est coupée par la largeur de la colonne (elle se termine par « ... » ou « … »), recopie la partie visible suivie de « … » et mets "tronquee": true ; ne devine pas la fin ;
- "designation" : la désignation complète de la ligne, recopiée telle quelle (elle sert à retrouver une référence tronquée ou mal lue) ;
- "qte" : la quantité commandée (colonne « Quantité », ex. 4,00 → 4) ; jamais le prix, la remise ni le montant ; 1 si absente ;
- garde les lignes sans prix (numéro de série, kit, code affaire) ;
- ignore les lignes de commentaire sans référence, les totaux, frais de port, en-têtes de colonnes ;
- si une référence est totalement illisible, mets ce que tu vois avec "tronquee": true plutôt que de sauter la ligne, si la désignation est lisible.

Date : si le document porte une date de livraison prévue, souhaitée ou demandée (en-tête « Date livraison », « Livraison souhaitée », « À livrer le »…), donne-la au format AAAA-MM-JJ dans "date_livraison" ; dans SAGE elle peut être écrite JJMMAA (ex. 040127 = 2027-01-04, 071226 = 2026-12-07) ; n'utilise pas la date du document ; sinon mets null.

Réponds uniquement avec ce JSON : {"lignes": [{"ref": "…", "qte": 1, "designation": "…", "tronquee": false}], "date_livraison": "AAAA-MM-JJ" ou null}`

    const content: OpenAIContentPart[] = [{ type: 'input_text', text: prompt }]
    for (const url of images) content.push({ type: 'input_image', image_url: url, detail: 'high' })

    const data = await callOpenAIResponses(content, { maxOutputTokens: 6000 })
    const parsed = tryParseJsonObject(extractOutputText(data))
    if (!parsed) return NextResponse.json({ error: 'La lecture de l’image a échoué. Réessayez avec une photo plus nette.' }, { status: 502 })

    const lignes = (Array.isArray(parsed.lignes) ? parsed.lignes : [])
      .map((l: any) => ({
        ref: String(l?.ref || '').trim().toUpperCase().replace(/\s+/g, '').replace(/…$/, '...'),
        qte: Number(String(l?.qte ?? '1').replace(',', '.')) || 1,
        designation: String(l?.designation || '').trim(),
        tronquee: Boolean(l?.tronquee) || /(\.\.\.|…)$/.test(String(l?.ref || '').trim()),
      }))
      .filter((l: { ref: string }) => l.ref.length >= 2 && l.ref.length <= 40)

    const dl = typeof parsed.date_livraison === 'string' ? parsed.date_livraison.trim() : ''
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dl) && !Number.isNaN(new Date(`${dl}T12:00:00`).getTime()) && dl >= '2020-01-01' && dl <= '2035-12-31'

    return NextResponse.json({ lignes, date_livraison: dateOk ? dl : null })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}
