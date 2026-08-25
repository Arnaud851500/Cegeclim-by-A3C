// app/api/atelier-ai/interpret-summary/route.ts
//
// ⚠️ IMPORTANT : ce fichier doit être commité dans le dépôt Git ET déployé
// pour avoir le moindre effet. Vérifié le 25/08 : ce fichier N'ÉTAIT PAS
// dans le build de production (absent de la liste des routes générée par
// `next build` sur le dernier déploiement Vercel) alors que le code du
// front (MobileHomeSummary.tsx) l'appelait déjà -- chaque appel retombait
// donc silencieusement sur le repli local par mots-clés (classifierChoixRepli),
// qui ne couvre qu'une poignée de demandes simples. C'est ça qui expliquait
// "chiffre d'affaires" fonctionnant à moitié et "devis"/"rdv sans
// compte-rendu" ne fonctionnant jamais : la vraie interprétation IA n'avait
// simplement jamais tourné. Après avoir copié ce fichier au bon endroit
// (app/api/atelier-ai/interpret-summary/route.ts), commit + push sur main
// pour déclencher le déploiement Vercel, PUIS tester.
//
// Interprète la demande orale du "Résumé vocal" (MobileHomeSummary) et la
// classe dans un intent structuré + paramètres (nombre de RDV demandés,
// seuil de montant, période, famille macro...).
//
// CORRECTIF (25/08) : trois désynchronisations entre les intents que ce
// prompt pouvait renvoyer et ceux que MobileHomeSummary.genererResume()
// sait réellement traiter -- toutes silencieuses :
//   1. "compte_rendu_client" -> renommé "compte_rendu" (nom attendu par le front).
//   2. "taches_periode" (avec params.periode) -> remplacé par les intents
//      directs "jour" / "semaine" / "semaine_prochaine", sans wrapper.
//   3. "ca_periode" -- règle de défaut ajoutée : periode="aujourdhui" si
//      non précisée, pour ne pas répondre "inconnu" à un simple "mon
//      chiffre d'affaires" sans période.
//
// ÉVOLUTION (25/08) : suivi de conversation. Le front peut désormais
// transmettre `contexte_precedent` (le dernier intent/params compris) --
// si la nouvelle phrase ne fait que préciser ou changer un élément (ex.
// "et depuis le début du mois ?" après une question de CA), le modèle
// réutilise le même intent et ne remplace que ce qui a changé, plutôt que
// de répondre "inconnu" faute de pouvoir classer la phrase seule.
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
- "compte_rendu" -- aucun paramètre (le nom/numéro du client sera redemandé séparément). Ex. "le compte-rendu d'un client", "dernier compte-rendu de Dupont".
- "rdv_prochains" -- {"n": entier, défaut 5}. Ex. "mes 3 prochains rendez-vous" -> n=3. "mes prochains rdv" -> n=5.
- "rdv_semaine_prochaine" -- aucun paramètre. Ex. "mes rdv de la semaine prochaine", "mon planning la semaine prochaine".
- "jour" -- aucun paramètre. Tâches du jour (et en retard). Ex. "mes tâches", "mes tâches en retard", "mes tâches d'aujourd'hui", "qu'est-ce que j'ai à faire".
- "semaine" -- aucun paramètre. Tâches de la semaine en cours (et en retard). Ex. "mes tâches de cette semaine", "mes tâches de la semaine".
- "semaine_prochaine" -- aucun paramètre. Tâches de la semaine PROCHAINE uniquement. Ex. "mes tâches de la semaine prochaine".
- "taches_prochaines" -- {"n": entier, défaut 5}. Ex. "mes 10 prochaines tâches", "mes tâches à réaliser triées par échéance", "mes 5 tâches".
- "ca_periode" -- {"periode": "hier" | "aujourdhui" | "mois" | "annee", "famille": chaîne ou null}. RÈGLE DE DÉFAUT IMPORTANTE : si aucune période n'est explicitement mentionnée dans la phrase, utilise TOUJOURS periode="aujourdhui" (ne réponds jamais "inconnu" pour une simple demande de chiffre d'affaires sans période précisée). Cet intent renvoie TOUJOURS 3 chiffres (prise de commande/devis, bons de livraison, facturation) sur la période demandée -- ne classe donc jamais séparément une demande de "devis signés" ou "livré" comme un autre intent, c'est le même "ca_periode". Ex. "quel CA ai-je fait hier" -> periode=hier. "mon chiffre d'affaires depuis le début du mois sur les pompes à chaleur" -> periode=mois, famille="R/R". "mon chiffre d'affaires" -> periode=aujourdhui, famille=null. "quel est mon CA" -> periode=aujourdhui, famille=null. "combien j'ai facturé" -> periode=aujourdhui, famille=null. "et depuis le début de l'année ?" -> periode=annee. "mon CA de l'année" / "cette année" -> periode=annee. Familles connues (choisis la plus proche du terme cité, sinon null) : R/R (pompes à chaleur air/eau ou eau/eau, réfrigération), PV (photovoltaïque), ACC (accessoires), TECH (prestations techniques), R_ZONE (multisplit/zone), SAV, ECS (eau chaude sanitaire), AUTRES, DIV.
- "devis_montant" -- {"n": entier défaut 10, "montant_min": nombre défaut 15000}. Ex. "les 10 derniers devis de plus de 15000 euros", "mes 5 derniers gros devis au-dessus de 20000", "mes derniers devis" (n=10, montant_min=15000 par défaut).
- "rdv_sans_compte_rendu" -- {"jours": entier défaut 7}. Ex. "combien de mes rdv passés ces 7 derniers jours n'ont pas de compte-rendu", "mes rdv du mois sans compte-rendu" -> jours=30, "quels rdv je n'ai pas encore comptes-rendus".
- "inconnu" -- aucun paramètre, si la demande ne correspond clairement à rien ci-dessus, MÊME avec le contexte précédent fourni ci-dessous.

Convertis toujours les nombres dictés en toutes lettres en entiers (ex. "dix" -> 10, "quinze mille" -> 15000, "trois derniers jours" -> jours=3). "CA" est l'abréviation usuelle de "chiffre d'affaires" -- traite-le comme un synonyme exact.

SUIVI DE CONVERSATION : le message utilisateur peut inclure un champ "contexte_precedent" (le dernier intent/params compris lors de l'échange précédent). Si la nouvelle phrase ne fait que préciser, corriger ou changer UN élément (période, nombre, seuil, famille) sans redéfinir toute la demande -- typiquement une phrase courte commençant par "et...", "sur...", "pour...", ou juste un complément ("depuis le début du mois", "depuis le début de l'année", "sur les pompes à chaleur", "plutôt 5") -- réutilise le MÊME intent que contexte_precedent.intent et pars de contexte_precedent.params, en ne remplaçant que ce qui a changé. Cette règle s'applique MÊME SI la phrase seule seule te semblerait normalement trop courte pour être classée -- la présence de contexte_precedent change cette évaluation. Exemple : contexte_precedent={"intent":"ca_periode","params":{"periode":"aujourdhui"}}, nouvelle phrase "et depuis le début du mois ?" -> réponds {"intent":"ca_periode","params":{"periode":"mois"}} (famille absente du contexte donc absente ici aussi). Si la nouvelle phrase est une demande complète et autonome qui n'a rien à voir avec contexte_precedent, ignore le contexte et classe normalement.

Réponds STRICTEMENT en JSON valide.`

export async function POST(req: NextRequest) {
  try {
    const { transcript, contexte_precedent } = await req.json()
    const clean = String(transcript || '').trim().slice(0, 500)
    if (!clean) return NextResponse.json({ intent: 'inconnu', params: {} })

    // Le contexte précédent (s'il existe) est transmis comme un bloc JSON
    // dans le message utilisateur -- voir la section "SUIVI DE CONVERSATION"
    // du prompt système, qui explique au modèle comment s'en servir.
    const userContent =
      contexte_precedent && typeof contexte_precedent === 'object'
        ? JSON.stringify({ transcript: clean, contexte_precedent })
        : clean

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
          { role: 'user', content: userContent },
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
