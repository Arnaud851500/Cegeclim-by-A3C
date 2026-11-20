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
// ============================================================================

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const images: string[] = Array.isArray(body?.images)
      ? body.images.filter((x: unknown) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 4)
      : []
    if (!images.length) return NextResponse.json({ error: 'Aucune image reçue.' }, { status: 400 })

    const prompt = `Tu lis une commande ou une liste de matériel de génie climatique (climatisation, pompes à chaleur, accessoires frigorifiques, cuivre) pour un distributeur français.
Relève chaque ligne d'article : la référence article (code produit du fabricant ou du distributeur, ex. RAK-DJ35RHAE, SPX-URFG1, E-38, C2X0.75) et la quantité commandée.
Règles :
- recopie la référence exactement comme écrite (majuscules, tirets, points, barres obliques), sans la désignation ;
- quantité = nombre d'unités commandées ; si elle n'apparaît pas, mets 1 ;
- ignore les lignes de total, de frais de port, de remise, les en-têtes et les commentaires ;
- si une référence est illisible, ne l'invente pas : ignore la ligne.
Réponds uniquement avec ce JSON : {"lignes": [{"ref": "…", "qte": 1, "designation": "…"}]}`

    const content: OpenAIContentPart[] = [{ type: 'input_text', text: prompt }]
    for (const url of images) content.push({ type: 'input_image', image_url: url })

    const data = await callOpenAIResponses(content, { maxOutputTokens: 3000 })
    const parsed = tryParseJsonObject(extractOutputText(data))
    if (!parsed) return NextResponse.json({ error: 'La lecture de l’image a échoué. Réessayez avec une photo plus nette.' }, { status: 502 })

    const lignes = (Array.isArray(parsed.lignes) ? parsed.lignes : [])
      .map((l: any) => ({
        ref: String(l?.ref || '').trim().toUpperCase().replace(/\s+/g, ''),
        qte: Number(String(l?.qte ?? '1').replace(',', '.')) || 1,
        designation: String(l?.designation || '').trim(),
      }))
      .filter((l: { ref: string }) => l.ref.length >= 2 && l.ref.length <= 40)

    return NextResponse.json({ lignes })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}
