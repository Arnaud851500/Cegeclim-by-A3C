// ============================================================================
// POST /api/hotline/envoyer-document — Hotline technique (02/11/2026)
// ----------------------------------------------------------------------------
// Envoie à l'appelant, depuis le compagnon, un e-mail avec le document du
// diagnostic EN PIÈCE JOINTE (Resend, même compte que les rapports PDF).
// - appel authentifié (jeton Supabase de l'utilisateur) et réservé aux droits
//   hotline (can_hotline / can_hotline_expert / can_autorisation) ;
// - le document est récupéré CÔTÉ SERVEUR depuis son lien (pas de blocage CORS
//   comme dans le navigateur) ; s'il n'est pas récupérable ou dépasse 15 Mo,
//   l'e-mail part avec le lien dans le texte ;
// - réponse au technicien : « Répondre » de l'appelant arrive chez lui
//   (reply_to), et il reçoit une copie s'il le demande ;
// - l'envoi est tracé dans la chronologie du ticket (étape DOCUMENT).
// Expéditeur : HOTLINE_FROM_EMAIL, sinon REPORT_FROM_EMAIL (adresse d'un
// domaine vérifié dans Resend).
// Route propre au module hotline : /api/mail/send (rapports) n'est pas modifiée.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TAILLE_MAX = 15 * 1024 * 1024

type Payload = {
  ticketId?: string | null
  to: string
  copieAMoi?: boolean
  subject: string
  text: string
  document: { titre: string; url?: string | null; type?: string | null }
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/zip': 'zip',
  'video/mp4': 'mp4',
}

function emailValide(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function nomFichier(titre: string, url: string, mime: string, type?: string | null) {
  let depuisUrl = ''
  try {
    depuisUrl = decodeURIComponent(new URL(url).pathname).split('/').pop() || ''
  } catch {
    depuisUrl = ''
  }
  const ext = /\.([a-z0-9]{2,5})$/i.exec(depuisUrl)?.[1]?.toLowerCase() || EXTENSIONS[mime] || (type || 'pdf').toLowerCase()
  const base = (titre || 'document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

function texteEnHtml(text: string) {
  const echappe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const avecLiens = echappe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#141A26">${avecLiens.replace(/\n/g, '<br>')}</div>`
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendKey = process.env.RESEND_API_KEY
    const from = process.env.HOTLINE_FROM_EMAIL || process.env.REPORT_FROM_EMAIL
    if (!supabaseUrl || !serviceKey) throw new Error('Configuration Supabase serveur manquante.')
    if (!resendKey || !from) {
      throw new Error("Envoi d'e-mails non configuré sur cet environnement (RESEND_API_KEY et HOTLINE_FROM_EMAIL / REPORT_FROM_EMAIL).")
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // Utilisateur et droits hotline
    const auth = req.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    if (!token) return NextResponse.json({ ok: false, error: 'Session absente : reconnectez-vous.' }, { status: 401 })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const email = userData?.user?.email?.toLowerCase().trim()
    if (userError || !email) return NextResponse.json({ ok: false, error: 'Session invalide : reconnectez-vous.' }, { status: 401 })
    const { data: droits } = await admin
      .from('user_page_access')
      .select('can_hotline, can_hotline_expert, can_autorisation, display_name')
      .eq('email', email)
      .maybeSingle()
    if (!droits || !(droits.can_hotline || droits.can_hotline_expert || droits.can_autorisation)) {
      return NextResponse.json({ ok: false, error: 'Accès hotline refusé.' }, { status: 403 })
    }

    const payload = (await req.json()) as Payload
    const to = String(payload.to || '').trim().toLowerCase()
    if (!emailValide(to)) throw new Error('Adresse e-mail du destinataire invalide.')
    const subject = String(payload.subject || '').trim()
    if (!subject) throw new Error('Objet obligatoire.')
    const doc = payload.document || { titre: '' }
    let text = String(payload.text || '').trim()

    // Pièce jointe récupérée côté serveur
    let piece: { filename: string; content: string; content_type: string } | null = null
    if (doc.url && /^https?:\/\//i.test(doc.url)) {
      try {
        const res = await fetch(doc.url)
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer())
          if (buffer.length > 0 && buffer.length <= TAILLE_MAX) {
            const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
            piece = { filename: nomFichier(doc.titre, doc.url, mime, doc.type), content: buffer.toString('base64'), content_type: mime }
          }
        }
      } catch {
        piece = null
      }
    }
    if (!piece && doc.url && !text.includes(doc.url)) {
      text = `${text}\n\nLien vers le document « ${doc.titre} » :\n${doc.url}`
    }

    const resendPayload: Record<string, unknown> = {
      from,
      to: [to],
      reply_to: email,
      subject,
      text,
      html: texteEnHtml(text),
    }
    if (payload.copieAMoi) resendPayload.cc = [email]
    if (piece) resendPayload.attachments = [piece]

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(resendPayload),
    })
    const corps = await res.text()
    if (!res.ok) throw new Error(`Envoi refusé par le service d'e-mail (${res.status}) : ${corps.slice(0, 300)}`)
    let resendId: string | null = null
    try {
      resendId = (JSON.parse(corps) as { id?: string }).id || null
    } catch {
      resendId = null
    }

    // Trace dans le ticket
    if (payload.ticketId) {
      await admin.from('hotline_ticket_etapes').insert({
        ticket_id: payload.ticketId,
        auteur: email,
        type: 'DOCUMENT',
        libelle: `E-mail envoyé à ${to}${piece ? ' avec pièce jointe' : ' avec le lien'} : ${doc.titre}`,
        details: { destinataire: to, objet: subject, document: doc, piece_jointe: Boolean(piece), fichier: piece?.filename || null, copie: Boolean(payload.copieAMoi), resend_id: resendId },
      })
    }

    return NextResponse.json({ ok: true, joint: Boolean(piece), fichier: piece?.filename || null, from, id: resendId })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
