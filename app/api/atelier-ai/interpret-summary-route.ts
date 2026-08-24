// app/api/atelier-ai/interpret-summary/route.ts
//
// Interprète la demande orale du "Résumé vocal" (MobileHomeSummary) et la
// classe dans un intent structuré + paramètres (nombre de RDV demandés,
// seuil de montant, période, famille macro...).
//
// CORRECTIF / ÉVOLUTION : l'ancienne classification par mots-clés
// (classifierChoix, regex côté front) ne pouvait reconnaître qu'une
// poignée de tournures figées et AUCUN paramètre ("mes 3 prochains rdv",
// "les 10 derniers devis de plus de 15000 euros", "mon CA depuis le
// début du mois sur les pompes à chaleur"...). Une regex ne peut
// raisonnablement pas extraire un nombre dicté en toutes lettres, un
// seuil monétaire, ou une période -- on route donc cette étape vers un
// modèle rapide et bon marché (gpt-4o-mini, température 0, réponse JSON
// contrainte), qui fait exactement ce travail de "slot filling".
//
// Échoue toujours en douceur : en cas d'erreur réseau/API, renvoie
// {intent:"inconnu"} avec un statut 200 plutôt qu'une erreur HTTP -- le
// front traite ça exactement comme "je n'ai pas compris" et redemande,
// sans branche d'erreur séparée à gérer.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const SYSTEM_PROMPT = `Tu interprètes une demande orale (français) posée par un commercial CVC/HVAC à un assistant vocal d'entreprise, et tu la classes dans EXACTEMENT un des intents ci-dessous. Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant/après, au format :
{"intent": "...", "params": { ... }}

Intents disponibles :
- "alertes" -- aucun paramètre. Ex. "mes alertes", "y a-t-il des soucis en cours".
- "compte_rendu_client" -- aucun paramètre (le nom/numéro du client sera redemandé séparément). Ex. "le compte-rendu d'un client", "dernier compte-rendu de Dupont".
- "rdv_prochains" -- {"n": entier, défaut 5}. Ex. "mes 3 prochains rendez-vous" -> n=3. "mes prochains rdv" -> n=5.
- "rdv_semaine_prochaine" -- aucun paramètre. Ex. "mes rdv de la semaine prochaine", "mon planning la semaine prochaine".
- "taches_periode" -- {"periode": "jour" | "semaine"}. Ex. "mes tâches en retard" ou "d'aujourd'hui" -> jour. "mes tâches de cette semaine" -> semaine.
- "taches_prochaines" -- {"n": entier, défaut 5}. Ex. "mes 10 prochaines tâches", "mes tâches à réaliser triées par échéance", "mes 5 tâches".
- "ca_periode" -- {"periode": "hier" | "aujourdhui" | "mois", "famille": chaîne ou null}. Ex. "quel CA ai-je fait hier" -> periode=hier. "mon chiffre d'affaires depuis le début du mois sur les pompes à chaleur" -> periode=mois, famille="R/R". Familles connues (choisis la plus proche du terme cité, sinon null) : R/R (pompes à chaleur air/eau ou eau/eau, réfrigération), PV (photovoltaïque), ACC (accessoires), TECH (prestations techniques), R_ZONE (multisplit/zone), SAV, ECS (eau chaude sanitaire), AUTRES, DIV.
- "devis_montant" -- {"n": entier défaut 10, "montant_min": nombre défaut 15000}. Ex. "les 10 derniers devis de plus de 15000 euros", "mes 5 derniers gros devis au-dessus de 20000".
- "rdv_sans_compte_rendu" -- {"jours": entier défaut 7}. Ex. "combien de rdv passés ces 7 derniers jours n'ont pas de compte-rendu", "les rdv du mois sans compte-rendu" -> jours=30.
- "inconnu" -- aucun paramètre, si la demande ne correspond clairement à rien ci-dessus.

Convertis toujours les nombres dictés en toutes lettres en entiers (ex. "dix" -> 10, "quinze mille" -> 15000, "trois derniers jours" -> jours=3). Réponds STRICTEMENT en JSON valide.`

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json()
    const clean = String(transcript || '').trim().slice(0, 500)
    if (!clean) return NextResponse.json({ intent: 'inconnu', params: {} })

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: clean },
        ],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Interprétation échouée (${res.status}) : ${detail.slice(0, 300)}`)
    }

    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content || '{}'

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { intent: 'inconnu', params: {} }
    }

    const intent = typeof parsed?.intent === 'string' ? parsed.intent : 'inconnu'
    const params = parsed?.params && typeof parsed.params === 'object' ? parsed.params : {}

    return NextResponse.json({ intent, params })
  } catch (error: any) {
    console.error('[interpret-summary] erreur', error)
    // 200 volontaire : le front traite ça comme "je n'ai pas compris" et
    // redemande, sans avoir besoin d'un chemin d'erreur HTTP séparé.
    return NextResponse.json({ intent: 'inconnu', params: {}, error: error?.message || 'Erreur inattendue.' })
  }
}
