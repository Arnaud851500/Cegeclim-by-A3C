import { NextRequest, NextResponse } from 'next/server'
import {
  checkFinancementAccess,
  isTypePiece,
  TYPE_META,
  extractOutputText,
  tryParseJsonObject,
  callOpenAIResponses,
  AiRouteError,
  OpenAIContentPart,
} from '../_shared'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

    const allowed = await checkFinancementAccess(body.email)
    if (!allowed) return NextResponse.json({ error: 'Accès non autorisé.', code: 'forbidden' }, { status: 403 })

    const typePiece = body.typePiece
    if (!isTypePiece(typePiece)) return NextResponse.json({ error: 'Type de pièce invalide.' }, { status: 400 })
    const meta = TYPE_META[typePiece]

    const images: string[] = Array.isArray(body.images) ? body.images.filter((x: unknown) => typeof x === 'string').slice(0, 2) : []
    const text = String(body.text || '').slice(0, 6000)

    const prompt = `${images.length ? 'Ces images sont les premières pages' : 'Voici le texte extrait des premières pages'} d'un document de dossier CEE (pièce attendue : ${meta.art}).
Trouve le nom du BÉNÉFICIAIRE : le particulier ou le ménage chez qui les travaux sont réalisés (client final), ou le(s) déclarant(s) s'il s'agit d'un avis d'imposition. Ce n'est jamais le nom de l'entreprise, de l'artisan, du bureau d'études ni du signataire côté professionnel.
Recopie le nom tel qu'il est écrit (civilité comprise si présente, ex. « M. et Mme Martin », « Mme Claire Dupont »). Si aucun nom de bénéficiaire n'apparaît, renvoie "".
Réponds uniquement avec ce JSON : {"beneficiaire": "…", "confiance": "haute" | "moyenne" | "basse"}${text ? `\n\nTexte extrait du PDF (extrait) :\n${text}` : ''}`

    const content: OpenAIContentPart[] = [{ type: 'input_text', text: prompt }]
    for (const url of images) content.push({ type: 'input_image', image_url: url })

    const data = await callOpenAIResponses(content, { maxOutputTokens: 300 })
    const out = tryParseJsonObject(extractOutputText(data)) || {}

    return NextResponse.json({ beneficiaire: String(out.beneficiaire || ''), confiance: String(out.confiance || '') })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}
