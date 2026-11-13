// ============================================================================
// lib/hotlineCsv.ts — Export CSV des tickets hotline (13/11/2026)
// ----------------------------------------------------------------------------
// Utilisé par l'export manuel (liste des tickets) et par l'export automatique
// (/api/hotline/export-auto). Séparateur « ; » et BOM UTF-8 : le fichier
// s'ouvre directement dans Excel en français.
// ============================================================================

export type LigneExport = Record<string, unknown>

/** Colonnes exportées : [colonne en base, en-tête]. */
export const COLONNES_EXPORT: Array<[string, string]> = [
  ['numero', 'Ticket'],
  ['statut', 'Statut'],
  ['est_test', 'Test'],
  ['filiere', 'Filière'],
  ['motif', 'Motif'],
  ['gamme', 'Gamme'],
  ['nature', 'Nature'],
  ['niveau', 'Niveau'],
  ['opened_at', 'Ouvert le'],
  ['ouvert_par', 'Ouvert par'],
  ['assigne_a', 'Assigné à'],
  ['numero_tiers', 'Code tiers'],
  ['intitule_tiers', 'Client'],
  ['contact_nom', 'Contact'],
  ['telephone_appelant', 'Téléphone'],
  ['contact_email', 'E-mail contact'],
  ['chantier', 'Chantier'],
  ['modele_ge', 'Modèle GE'],
  ['serie_ge', 'N° série GE'],
  ['reference_article', 'Modèle UI'],
  ['numero_serie', 'N° série UI'],
  ['pv_marque', 'Marque onduleur'],
  ['pv_equipement', 'Équipement'],
  ['onduleur_modele', 'Modèle onduleur'],
  ['onduleur_serie', 'N° série onduleur'],
  ['batterie_modele', 'Modèle batterie'],
  ['batterie_serie', 'N° série batterie'],
  ['severite', 'Sévérité'],
  ['code_defaut', 'Code défaut'],
  ['date_mes', 'Mise en service'],
  ['description', 'Motif de l’appel'],
  ['preconisation', 'Préconisation'],
  ['symptome', 'Symptôme'],
  ['organe', 'Organe'],
  ['issue', 'Issue'],
  ['first_action_at', 'Première action'],
  ['escalated_at', 'Escaladé le'],
  ['resolved_at', 'Résolu le'],
  ['commentaires', 'Commentaires'],
]

/** Colonnes à lire en base (sans les colonnes calculées). */
export const SELECT_EXPORT = COLONNES_EXPORT.map(([c]) => c)
  .filter((c) => c !== 'commentaires')
  .concat('id')
  .join(', ')

function cellule(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (typeof v === 'boolean') s = v ? 'oui' : ''
  else if (Array.isArray(v)) s = v.join(', ')
  else s = String(v)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) s = d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
  }
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV des tickets. `commentaires` : ticket_id → commentaires visibles (hors internes), déjà concaténés. */
export function construireCsv(tickets: LigneExport[], commentaires?: Map<string, string>): string {
  const lignes = [COLONNES_EXPORT.map(([, h]) => cellule(h)).join(';')]
  for (const t of tickets) {
    lignes.push(COLONNES_EXPORT.map(([c]) => cellule(c === 'commentaires' ? commentaires?.get(String(t.id)) || '' : t[c])).join(';'))
  }
  return '﻿' + lignes.join('\r\n') + '\r\n'
}

/** Regroupe les étapes de type commentaire par ticket (ordre chronologique). */
export function regrouperCommentaires(etapes: Array<{ ticket_id: string; at: string; auteur: string; type: string; libelle: string }>) {
  const m = new Map<string, string>()
  for (const e of etapes) {
    if (e.type !== 'COMMENTAIRE' && e.type !== 'NOTE_RAPIDE' && e.type !== 'RESOLUTION') continue
    const date = new Date(e.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })
    const ligne = `[${date} ${String(e.auteur || '').split('@')[0]}] ${e.libelle}`
    m.set(e.ticket_id, m.has(e.ticket_id) ? `${m.get(e.ticket_id)}\n${ligne}` : ligne)
  }
  return m
}

export function nomFichierExport(prefixe = 'tickets-hotline', d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefixe}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`
}
