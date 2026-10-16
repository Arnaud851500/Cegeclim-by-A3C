// Helpers partagés par les routes /api/financement/controle-pieces/*.
// Ce dossier alimente la page /financement/controle-pieces (relecture des
// pièces de dossiers CEE par IA) : détection du bénéficiaire, relecture
// point par point de la checklist, relevé des caractéristiques du dossier
// (contrôle de cohérence entre pièces), rédaction du mail de retour à l'artisan.
//
// 16/10/2026 : ajout du type « cadre_contribution » et du relevé des
// caractéristiques (registre cee_champs).
//
// La clé OpenAI reste côté serveur (process.env.OPENAI_API_KEY, déjà utilisée
// par /api/atelier-ai) : le navigateur n'appelle jamais OpenAI directement.

import { supabaseAdmin } from '@/lib/supabaseAdmin'

export type TypePieceId = 'avis_imposition' | 'note_dimensionnement' | 'devis' | 'facture' | 'cadre_contribution'

export const TYPE_META: Record<TypePieceId, { label: string; art: string; the: string; of: string }> = {
  avis_imposition: { label: "Avis d'imposition", art: "un avis d'imposition", the: "L'avis d'imposition", of: "de l'avis d'imposition" },
  note_dimensionnement: { label: 'Note de dimensionnement', art: 'une note de dimensionnement', the: 'La note de dimensionnement', of: 'de la note de dimensionnement' },
  devis: { label: 'Devis', art: 'un devis', the: 'Le devis', of: 'du devis' },
  facture: { label: 'Facture', art: 'une facture', the: 'La facture', of: 'de la facture' },
  cadre_contribution: { label: 'Cadre de contribution', art: 'un cadre de contribution', the: 'Le cadre de contribution', of: 'du cadre de contribution' },
}

// Consignes de contrôle spécifiques par type, injectées dans le prompt de
// relecture en complément de la liste des points de la checklist elle-même.
export const CONTROL_GUIDANCE: Record<TypePieceId, string> = {
  avis_imposition: `Règles de contrôle spécifiques à l'avis d'imposition :
- Vérifie qu'il s'agit bien d'un avis d'imposition (ou de non-imposition) sur le revenu, et non d'une déclaration de revenus ou d'un autre document fiscal.
- Le nom, prénom et l'adresse du foyer fiscal doivent correspondre au bénéficiaire attendu du dossier.
- L'année des revenus doit être cohérente avec la date de la demande (avis le plus récent disponible).
- Le revenu fiscal de référence (RFR) et le nombre de parts doivent être lisibles : ce sont eux qui déterminent le classement du ménage (précarité / grande précarité / classique) — signale toute valeur illisible, manquante ou incohérente.
- Vérifie la présence d'une référence permettant d'identifier l'avis comme authentique.`,
  note_dimensionnement: `Règles de contrôle spécifiques à la note de dimensionnement :
- Le logement décrit (adresse, surface) doit correspondre à celui du dossier.
- Un calcul chiffré (déperditions, puissance nécessaire, etc.) doit être présent, avec sa méthode ; une note qui affirme une conclusion sans calcul ni valeur chiffrée est non conforme.
- La puissance ou les caractéristiques préconisées doivent être cohérentes avec l'équipement figurant au devis/à la facture du même dossier si ces informations apparaissent dans le texte fourni ; signale toute incohérence de puissance ou de modèle.
- L'auteur de la note doit être identifiable (bureau d'études ou professionnel qualifié) et le document daté.
- La date de la note doit être antérieure à la signature du devis ou au début des travaux.`,
  devis: `Règles de contrôle spécifiques au devis :
- Le devis doit être établi par le professionnel au bénéficiaire (jamais l'inverse), avec l'identité complète des deux parties.
- Vérifie la mention de la qualification RGE de l'artisan pour le type de travaux concerné, ainsi que son SIRET.
- La description des travaux doit être suffisamment précise (marque, référence, caractéristiques techniques/performance) pour vérifier l'éligibilité CEE ; une ligne générique sans détail technique est non conforme.
- Le devis doit être signé et daté par le client ("bon pour accord"), avec une date de signature postérieure à la date d'établissement du devis et antérieure au démarrage des travaux.
- Vérifie la cohérence des montants (HT, TTC, taux de TVA applicable) et, si le dispositif "coup de pouce" est mentionné, la présence du montant de l'aide CEE déduite.`,
  facture: `Règles de contrôle spécifiques à la facture :
- La facture doit correspondre au même professionnel, au même bénéficiaire et aux mêmes travaux que le devis du dossier (signale toute différence).
- Sa date doit être postérieure à la fin des travaux (une facture datée avant les travaux ou avant le devis est suspecte).
- Elle doit comporter les mentions légales obligatoires (SIRET, numéro de TVA intracommunautaire) et la qualification RGE.
- La description des prestations facturées doit correspondre aux travaux réellement réalisés, pas seulement recopier le devis.
- Le montant TTC doit être cohérent avec le devis (tout écart doit être expliqué) et la facture doit indiquer qu'elle est soldée ou préciser les modalités de paiement restantes.`,
  cadre_contribution: `Règles de contrôle spécifiques au cadre de contribution :
- Vérifie qu'il s'agit bien du cadre de contribution (document du délégataire, ex. DRAPO, précisant la contribution du délégataire aux travaux d'économies d'énergie).
- Le délégataire, le professionnel et le bénéficiaire doivent être identifiés ; l'adresse du bénéficiaire doit être lisible.
- La date du cadre de contribution doit être lisible : le devis doit être signé au plus tard 14 jours après cette date.
- Le montant de la prime CEE bénéficiaire, la fiche d'opération (ex. BAR-TH-171) et, le cas échéant, la mention « Coup de pouce » doivent apparaître.
- Le document doit être signé par le professionnel.`,
}

export function isTypePiece(v: unknown): v is TypePieceId {
  return v === 'avis_imposition' || v === 'note_dimensionnement' || v === 'devis' || v === 'facture' || v === 'cadre_contribution'
}

// Caractéristiques du dossier à relever sur la pièce (registre cee_champs,
// transmis par la page) : l'IA les renvoie normalisées pour que la base
// puisse les comparer à la saisie et aux autres pièces.
export type ChampAExtraire = { code: string; libelle: string; type: string; options: string[] }

export function normaliserChampsAExtraire(raw: unknown): ChampAExtraire[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c: any) => c && typeof c.code === 'string' && /^[a-z0-9_]+$/.test(c.code) && c.libelle)
    .slice(0, 60)
    .map((c: any) => ({
      code: String(c.code),
      libelle: String(c.libelle),
      type: ['text', 'number', 'integer', 'date', 'bool', 'enum'].includes(c.type) ? String(c.type) : 'text',
      options: Array.isArray(c.options) ? c.options.map((o: unknown) => String(o)).slice(0, 20) : [],
    }))
}

export function consigneExtraction(champs: ChampAExtraire[]): string {
  if (!champs.length) return ''
  const lignes = champs
    .map((c) => {
      const format =
        c.type === 'date'
          ? 'date au format AAAA-MM-JJ'
          : c.type === 'number'
          ? 'nombre seul, sans unité, point décimal'
          : c.type === 'integer'
          ? 'nombre entier'
          : c.type === 'bool'
          ? 'true ou false'
          : c.type === 'enum'
          ? `exactement l'une des valeurs : ${c.options.map((o) => `"${o}"`).join(', ')}`
          : 'texte tel qu’écrit sur le document'
      return `- "${c.code}" : ${c.libelle} (${format})`
    })
    .join('\n')
  return `\nCaractéristiques du dossier à relever sur ce document (objet "champs") :\n${lignes}\nRenseigne uniquement ce qui figure sur le document ; mets "" pour ce qui n'y figure pas. Ne déduis rien qui ne soit pas écrit.\n`
}

export function nettoyerChampsExtraits(raw: unknown, champs: ChampAExtraire[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  const connus = new Map(champs.map((c) => [c.code, c]))
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = connus.get(k)
    if (!c || v === null || v === undefined) continue
    const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v).trim()
    if (!s) continue
    out[k] = s
  }
  return out
}

/**
 * Vérifie côté serveur que l'email transmis a bien le droit can_financement
 * (profil OU flag individuel, can_autorisation servant de passe-partout admin)
 * — même logique que la fonction SQL peut_acceder_financement(), pour ne pas
 * dépendre uniquement de la coque applicative côté client avant d'appeler
 * l'API OpenAI (qui a un coût).
 */
export async function checkFinancementAccess(rawEmail: unknown): Promise<boolean> {
  const email = String(rawEmail || '').toLowerCase().trim()
  if (!email) return false

  const { data: userRow } = await supabaseAdmin
    .from('user_page_access')
    .select('can_financement, can_autorisation, access_profile_id')
    .eq('email', email)
    .maybeSingle()

  if (!userRow) return false
  if (userRow.can_financement || userRow.can_autorisation) return true

  const profileId = String(userRow.access_profile_id || '').trim()
  if (!profileId) return false

  const { data: profileRow } = await supabaseAdmin
    .from('access_profiles')
    .select('can_financement, can_autorisation, is_active')
    .eq('id', profileId)
    .maybeSingle()

  if (!profileRow || profileRow.is_active === false) return false
  return Boolean(profileRow.can_financement || profileRow.can_autorisation)
}

export function extractOutputText(data: any): string {
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

export function tryParseJsonObject(text: string): any {
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

export type OpenAIContentPart = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_CEE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'

export class AiRouteError extends Error {
  status: number
  code: string
  constructor(message: string, status = 500, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function callOpenAIResponses(content: OpenAIContentPart[], opts?: { maxOutputTokens?: number }) {
  if (!OPENAI_API_KEY) {
    throw new AiRouteError("La relecture automatique n'est pas configurée sur ce serveur (clé OpenAI manquante).", 500, 'not_configured')
  }
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{ role: 'user', content }],
      ...(opts?.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
    }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const rawMessage = data?.error?.message || `Erreur OpenAI (${res.status}).`
    const rawCode = String(data?.error?.code || '')
    const isQuota = rawCode === 'insufficient_quota' || rawMessage.toLowerCase().includes('quota') || rawMessage.toLowerCase().includes('billing')
    throw new AiRouteError(
      isQuota ? "Le compte IA utilisé par cette application n'a plus de quota. Contactez l'administrateur." : rawMessage,
      res.status,
      isQuota ? 'quota' : rawCode
    )
  }
  return data
}
