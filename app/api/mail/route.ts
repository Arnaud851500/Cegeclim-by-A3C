import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type RecipientInput = string | string[] | undefined | null

type StorageAttachmentInput = {
  bucket?: string
  path?: string
  filename?: string
  contentType?: string
}

type RawAttachmentInput = {
  filename: string
  contentBase64: string
  contentType?: string
}

type MailAttachmentInput = StorageAttachmentInput | RawAttachmentInput

type SendMailPayload = {
  from?: string
  to: RecipientInput
  cc?: RecipientInput
  bcc?: RecipientInput
  reply_to?: RecipientInput
  subject: string
  html?: string
  text?: string
  attachments?: MailAttachmentInput[]
  tags?: Array<{ name: string; value: string }>
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session'
  email?: string | null
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function normalizeRecipients(value: RecipientInput) {
  if (!value) return []
  const items = Array.isArray(value) ? value : String(value).split(/[;,]/)
  return items.map((item) => String(item || '').trim()).filter(Boolean)
}

function normalizeReplyTo(value: RecipientInput) {
  const recipients = normalizeRecipients(value)
  if (!recipients.length) return undefined
  return recipients.length === 1 ? recipients[0] : recipients
}

function assertBasicEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function base64FromArrayBuffer(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString('base64')
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function parseMaybeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function buildSupabaseAdmin() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL')
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
}

async function authorizeRequest(req: NextRequest, supabaseAdmin: SupabaseClient): Promise<AuthorizedCaller> {
  const trustedSecret = process.env.REPORT_PDF_RENDER_SECRET || process.env.INTERNAL_API_SECRET || ''
  const incomingSecret = req.headers.get('x-report-secret') || req.headers.get('x-internal-secret') || ''

  if (trustedSecret && incomingSecret && incomingSecret === trustedSecret) {
    return { mode: 'trusted_secret' }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (!token) {
    throw new Error('Unauthorized : ajoute un Bearer token utilisateur ou le header interne x-report-secret.')
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    throw new Error(`Unauthorized : session utilisateur invalide${error?.message ? ` (${error.message})` : ''}.`)
  }

  return { mode: 'user_session', email: data.user.email }
}

function isRawAttachment(attachment: MailAttachmentInput): attachment is RawAttachmentInput {
  return Boolean((attachment as RawAttachmentInput).contentBase64)
}

async function buildResendAttachments(
  supabaseAdmin: SupabaseClient,
  attachments: MailAttachmentInput[] | undefined
) {
  if (!attachments?.length) return []
  if (attachments.length > 10) throw new Error('Trop de pièces jointes : maximum 10.')

  const result: Array<{ filename: string; content: string; content_type?: string }> = []

  for (const attachment of attachments) {
    if (isRawAttachment(attachment)) {
      if (!attachment.filename || !attachment.contentBase64) {
        throw new Error('Pièce jointe base64 invalide : filename et contentBase64 sont obligatoires.')
      }

      result.push({
        filename: attachment.filename,
        content: attachment.contentBase64,
        content_type: attachment.contentType,
      })
      continue
    }

    const bucket = attachment.bucket || 'commercial-imports'
    const path = String(attachment.path || '').trim()
    if (!path) throw new Error('Pièce jointe Storage invalide : path est obligatoire.')

    const { data, error } = await supabaseAdmin.storage.from(bucket).download(path)
    if (error || !data) {
      throw new Error(`Téléchargement pièce jointe impossible : ${bucket}/${path} — ${error?.message || 'fichier absent'}`)
    }

    const arrayBuffer = await data.arrayBuffer()
    const filename = attachment.filename || path.split('/').pop() || 'piece-jointe'

    result.push({
      filename,
      content: base64FromArrayBuffer(arrayBuffer),
      content_type: attachment.contentType || data.type || undefined,
    })
  }

  return result
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = buildSupabaseAdmin()
  let caller: AuthorizedCaller | null = null

  try {
    caller = await authorizeRequest(req, supabaseAdmin)

    const payload = (await req.json()) as SendMailPayload
    const resendApiKey = getRequiredEnv('RESEND_API_KEY')
    const from = payload.from || getRequiredEnv('REPORT_FROM_EMAIL')
    const to = normalizeRecipients(payload.to)
    const cc = normalizeRecipients(payload.cc)
    const bcc = normalizeRecipients(payload.bcc)
    const replyTo = normalizeReplyTo(payload.reply_to)
    const subject = String(payload.subject || '').trim()

    if (!to.length) throw new Error('Aucun destinataire email renseigné.')
    if (!subject) throw new Error('Sujet email obligatoire.')
    if (!payload.html && !payload.text) throw new Error('Contenu email obligatoire : html ou text.')

    const invalidRecipients = [...to, ...cc, ...bcc].filter((recipient) => !assertBasicEmail(recipient))
    if (invalidRecipients.length) {
      throw new Error(`Adresse(s) email invalide(s) : ${invalidRecipients.join(', ')}`)
    }

    const attachments = await buildResendAttachments(supabaseAdmin, payload.attachments)

    const resendPayload: Record<string, unknown> = {
      from,
      to,
      subject,
      html: payload.html,
      text: payload.text,
    }

    if (cc.length) resendPayload.cc = cc
    if (bcc.length) resendPayload.bcc = bcc
    if (replyTo) resendPayload.reply_to = replyTo
    if (attachments.length) resendPayload.attachments = attachments
    if (payload.tags?.length) resendPayload.tags = payload.tags

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    })

    const responseText = await response.text()
    const responseBody = parseMaybeJson(responseText)

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Envoi email Resend impossible (${response.status})`,
          resend_status: response.status,
          resend_response: responseBody,
          from,
          to,
          cc,
          bcc,
          attachments: attachments.map((attachment) => attachment.filename),
          caller,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      resend_status: response.status,
      resend_response: responseBody,
      from,
      to,
      cc,
      bcc,
      attachments: attachments.map((attachment) => attachment.filename),
      caller,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: sanitizeError(error),
        caller,
      },
      { status: 500 }
    )
  }
}
