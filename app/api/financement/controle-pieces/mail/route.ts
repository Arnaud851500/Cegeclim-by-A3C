import { NextRequest, NextResponse } from 'next/server'
import { checkFinancementAccess, isTypePiece, TYPE_META, extractOutputText, callOpenAIResponses, AiRouteError, OpenAIContentPart } from '../_shared'

export const runtime = 'nodejs'

type LineItem = { label?: unknown; valeur?: unknown; commentaire?: unknown }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

    const allowed = await checkFinancementAccess(body.email)
    if (!allowed) return NextResponse.json({ error: 'Accès non autorisé.', code: 'forbidden' }, { status: 403 })

    const typePiece = body.typePiece
    if (!isTypePiece(typePiece)) return NextResponse.json({ error: 'Type de pièce invalide.' }, { status: 400 })
    const meta = TYPE_META[typePiece]

    const beneficiaire = String(body.beneficiaire || '').trim()
    const nonConformes: LineItem[] = Array.isArray(body.nonConformes) ? body.nonConformes : []
    const conformes: LineItem[] = Array.isArray(body.conformes) ? body.conformes : []
    const exempleMail = String(body.exempleMail || '').trim()
    const docCheck = body.docCheck as { ok?: boolean; remark?: string } | null | undefined

    const line = (it: LineItem) =>
      `- ${String(it.label || '')}${it.valeur ? ` [valeur relevée : ${String(it.valeur)}]` : ''}${it.commentaire ? ` — commentaire : ${String(it.commentaire)}` : ''}`

    const prompt = `Rédige en français le passage d'un mail adressé à un artisan, pour lui faire un retour sur ${meta.art} qu'il a transmis dans le cadre d'un dossier CEE.
Bénéficiaire du dossier : ${beneficiaire || "non précisé (ne l'invente pas)"}.
${docCheck && docCheck.ok === false ? `Attention : le document transmis ne semble pas être ${meta.art} (${docCheck.remark || ''}). Mentionne-le.\n` : ''}
Points NON CONFORMES (à demander à l'artisan de corriger) :
${nonConformes.length ? nonConformes.map(line).join('\n') : 'aucun'}

Points conformes (ne pas les détailler, sauf si l'exemple le fait) :
${conformes.length ? conformes.map((it) => '- ' + String(it.label || '')).join('\n') : 'aucun'}

${
  exempleMail
    ? `Voici un mail type à suivre de près : mêmes formules d'appel et de politesse, même structure, même ton. Remplace les éléments spécifiques (points listés, "XXX (Nom du client)" ou équivalent → bénéficiaire du dossier ; s'il n'est pas précisé, retire la mention plutôt que de laisser un espace réservé) :\n"""\n${exempleMail}\n"""\n`
    : "Commence par « Bonjour, », ton professionnel et cordial, vouvoiement, phrases courtes. Liste à puces pour les points à corriger, puis une demande claire de document corrigé, et termine par « Bien cordialement ».\n"
}
Chaque point non conforme devient une puce, formulée comme une phrase claire (réutilise les commentaires quand ils sont bien formulés, corrige les fautes éventuelles).
Contraintes : uniquement le texte du mail (pas d'objet, pas de nom en signature, pas de commentaire autour), puces avec « - ». N'invente aucune information absente ci-dessus. S'il n'y a aucun point non conforme, écris un court message confirmant que le document est conforme, dans le même style.`

    const content: OpenAIContentPart[] = [{ type: 'input_text', text: prompt }]
    const data = await callOpenAIResponses(content, { maxOutputTokens: 1200 })
    const mail = extractOutputText(data).trim()

    return NextResponse.json({ mail })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}
