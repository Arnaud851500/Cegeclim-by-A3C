// lib/voiceSessionLock.ts
//
// Verrou vocal PARTAGÉ entre tous les composants qui ouvrent le micro ou
// jouent de l'audio (VoiceReportButtons -- "Nouvelle tâche"/"Compte-rendu"
// -- et MobileHomeSummary -- "Résumé vocal") : empêche deux sessions
// vocales de tourner en même temps dans l'app, quel que soit l'écran.
//
// CORRECTIF : avant ce fichier, le verrou vivait comme simple variable de
// module DANS VoiceReportButtons.tsx -- MobileHomeSummary.tsx n'en avait
// aucune connaissance et ne le posait ni ne le vérifiait jamais. Deux
// sessions pouvaient donc tourner en parallèle (ex. "Résumé vocal" lancé
// pendant une dictée de tâche ailleurs), confirmé en usage réel par deux
// appels à /api/atelier-ai/speak à la même seconde. Centraliser le verrou
// ici, importé par les deux composants, corrige ça une fois pour toutes.
//
// Simple variable de module (pas de contexte React) : une seule page/
// onglet à la fois côté mobile, pas besoin de plus.

let verrou: { id: symbol } | null = null

/** Tente de prendre le verrou pour `id`. Renvoie true si acquis (déjà
 * détenu par `id` ou libre), false si détenu par quelqu'un d'autre --
 * dans ce cas l'appelant doit refuser de démarrer sa session. */
export function acquerirVerrouVocal(id: symbol): boolean {
  if (verrou && verrou.id !== id) return false
  verrou = { id }
  return true
}

/** Libère le verrou SEULEMENT si `id` le détient actuellement -- ne touche
 * jamais à une session détenue par quelqu'un d'autre. */
export function libererVerrouVocal(id: symbol) {
  if (verrou?.id === id) verrou = null
}

/** Vrai si le verrou est actuellement détenu par une session AUTRE que
 * `id` -- sert à afficher "une écoute est déjà en cours ailleurs" plutôt
 * que de démarrer une deuxième session en parallèle. */
export function verrouVocalDetenuParAutre(id: symbol): boolean {
  return Boolean(verrou && verrou.id !== id)
}

/** Vrai si `id` détient actuellement le verrou -- sert à savoir, au
 * démontage d'un composant ou au changement d'écran, s'il faut le
 * libérer (ne libère jamais une session détenue par un autre composant). */
export function verrouVocalDetenuPar(id: symbol): boolean {
  return verrou?.id === id
}
