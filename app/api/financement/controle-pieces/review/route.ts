import { NextRequest, NextResponse } from 'next/server'
import {
  checkFinancementAccess,
  isTypePiece,
  TYPE_META,
  CONTROL_GUIDANCE,
  extractOutputText,
  tryParseJsonObject,
  callOpenAIResponses,
  AiRouteError,
  OpenAIContentPart,
} from '../_shared'

export const runtime = 'nodejs'

type ChecklistItemIn = { id?: unknown; label?: unknown; hint?: unknown }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

    const allowed = await checkFinancementAccess(body.email)
    if (!allowed) return NextResponse.json({ error: 'Accès non autorisé.', code: 'forbidden' }, { status: 403 })

    const typePiece = body.typePiece
    if (!isTypePiece(typePiece)) return NextResponse.json({ error: 'Type de pièce invalide.' }, { status: 400 })
    const meta = TYPE_META[typePiece]

    const items = (Array.isArray(body.items) ? (body.items as ChecklistItemIn[]) : [])
      .filter((it) => it && it.id && it.label)
      .map((it) => ({ id: String(it.id), label: String(it.label), hint: it.hint ? String(it.hint) : '' }))
    if (!items.length) return NextResponse.json({ error: 'Checklist vide.' }, { status: 400 })

    const beneficiaire = String(body.beneficiaire || '').trim()
    const images: string[] = Array.isArray(body.images) ? body.images.filter((x: unknown) => typeof x === 'string').slice(0, 8) : []
    let text = String(body.text || '')
    const budget = 48000
    if (text.length > budget) text = text.slice(0, budget) + '\n[… texte tronqué]'

    const pts = items.map((it) => `- id "${it.id}" : ${it.label}${it.hint ? ` (précision : ${it.hint})` : ''}`).join('\n')
    const guidance = CONTROL_GUIDANCE[typePiece] ? `\n${CONTROL_GUIDANCE[typePiece]}\n` : ''

    const prompt = `Tu es contrôleur de conformité pour des dossiers CEE (certificats d'économies d'énergie, France). Tu fais une PREMIÈRE relecture d'une pièce transmise par un artisan ; un humain validera ensuite.

Pièce attendue : ${meta.art}.
Bénéficiaire du dossier : ${beneficiaire || 'non renseigné'}.
${images.length ? `Les ${images.length} image(s) jointe(s) sont les pages du document, dans l'ordre.${text ? " Le texte extrait du PDF est aussi fourni plus bas ; en cas de doute, fie-toi à ce qui est visible sur les images." : ''}` : "Tu n'as pas les images du document, seulement le texte extrait du PDF (fourni plus bas) : la mise en page (tableaux, colonnes) peut être perdue, rapproche les libellés et les valeurs avec soin. Si une information n'est pas trouvable dans ce texte, mets \"nc\" et précise dans le commentaire qu'elle est à vérifier visuellement."}

Checklist à vérifier :
${pts}
${guidance}
Pour CHAQUE point, attribue un statut :
- "c" : l'information est présente, lisible et exploitable ;
- "nc" : elle est absente, illisible, incomplète, incohérente ou sans unité quand une unité est demandée ;
- "na" : le point ne s'applique manifestement pas à ce dossier (explique pourquoi dans le commentaire).
Indique "valeur" : la valeur relevée telle qu'elle figure sur le document (avec son unité), ou "" si absente.
Indique "commentaire" : une phrase courte en français. Pour "nc", écris une phrase directement réutilisable comme puce dans le mail à l'artisan. Pour "c", laisse vide sauf doute ou incohérence à signaler.
Ne devine jamais une valeur : si tu ne la vois pas, c'est "nc".
Si le document ne semble pas être ${meta.art}, mets "document_correspond" à false et explique en une phrase.
Indique aussi "beneficiaire" : le nom du bénéficiaire (particulier ou ménage client final, jamais l'entreprise) tel qu'écrit sur le document, "" s'il n'apparaît pas.${beneficiaire ? ` S'il diffère nettement du bénéficiaire indiqué ci-dessus, signale-le dans "remarque_document".` : ''}

Réponds uniquement avec ce JSON, sans autre texte :
{"document_correspond": true, "remarque_document": "", "beneficiaire": "…", "points": [{"id": "…", "statut": "c", "valeur": "…", "commentaire": "…"}]}${text ? `\n\nTEXTE EXTRAIT DU PDF :\n${text}` : ''}`

    const content: OpenAIContentPart[] = [{ type: 'input_text', text: prompt }]
    for (const url of images) content.push({ type: 'input_image', image_url: url })

    const data = await callOpenAIResponses(content, { maxOutputTokens: 4000 })
    const outText = extractOutputText(data)
    const parsed = tryParseJsonObject(outText)
    if (!parsed) return NextResponse.json({ error: 'La réponse de l’IA était incomplète. Relancez la relecture.', code: 'invalid_json' }, { status: 502 })

    const known = new Set(items.map((it) => it.id))
    const points = Array.isArray(parsed.points)
      ? parsed.points
          .filter((p: any) => p && known.has(String(p.id)))
          .map((p: any) => ({
            id: String(p.id),
            statut: ['c', 'nc', 'na'].includes(p.statut) ? p.statut : null,
            valeur: String(p.valeur || '').trim(),
            commentaire: String(p.commentaire || '').trim(),
          }))
      : []

    return NextResponse.json({
      document_correspond: parsed.document_correspond !== false,
      remarque_document: String(parsed.remarque_document || ''),
      beneficiaire: String(parsed.beneficiaire || ''),
      points,
    })
  } catch (error: any) {
    const status = error instanceof AiRouteError ? error.status : 500
    return NextResponse.json({ error: error?.message || 'Erreur serveur.', code: error?.code }, { status })
  }
}
