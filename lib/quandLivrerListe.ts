// ============================================================================
// lib/quandLivrerListe.ts — lecture d'une ligne collée dans « Quand puis-je livrer ? »
// ----------------------------------------------------------------------------
// Une ligne de texte collée → { ref, qte }. Formats acceptés : « REF  3 »,
// « 3 x REF », « REF;3 », et les lignes copiées depuis une grille SAGE / BLG /
// Excel (référence, désignation, P.U. HT, quantité, unité, remise, P.U. net,
// montant HT, taxe, dépôt…).
//
// CORRECTIF (23/11/2026, signalé par Arnaud sur TAW-270RHD) : sur une ligne de
// grille, le DERNIER nombre était pris pour la quantité — c'était le montant HT
// (1 017,52 au lieu de 1), d'où de faux « appro à passer ». La quantité est
// désormais choisie ainsi, dans l'ordre :
//   1. le nombre suivi d'une unité (« 4,00 unité », « 2 pce », « 20 ml »…) ;
//   2. le facteur entier d'un produit P.U. × quantité = montant présent sur la
//      ligne (ex. 435 × 4 = 1 740 → 4) ;
//   3. le seul nombre de la ligne ;
//   4. sinon le premier nombre entier, sinon le premier nombre.
// Les milliers séparés par une espace (« 1 452,65 ») sont lus comme un seul
// nombre quand les colonnes sont séparées par des tabulations.
// ============================================================================

export type LigneLue = { ref: string; qte: number }

const ESPACES = /[   ]/g
const UNITE = /^(unit[ée]s?|u|un|pce?s?|pi[eè]ces?|p|ml|m|m2|m²|kg|g|l|lots?|ens(emble)?s?|bo[iî]tes?|rouleaux?|couronnes?|paires?|jeux?|sacs?|cartons?|colis)\.?$/i
const ENTETE = /^(r[ée]f([ée]rence)?|article|code|d[ée]signation|quantit[ée]|qt[ée])\b/i

/** Nombre d'une cellule (« 1 452,65 », « 4,00 », « x3 », « 3x ») ou null. */
export function lireNombre(cellule: string): number | null {
  const t = cellule.replace(ESPACES, ' ').trim().replace(/^x\s*/i, '').replace(/\s*x$/i, '')
  if (!/^-?\d{1,3}( \d{3})+([.,]\d+)?$|^-?\d+([.,]\d+)?$/.test(t)) return null
  const n = Number(t.replace(/ /g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const estEntier = (n: number) => Math.abs(n - Math.round(n)) < 1e-9

/** Quantité parmi les cellules qui suivent la référence. */
function choisirQuantite(cellules: string[]): number | null {
  const nombres = cellules
    .map((c, i) => ({ i, n: lireNombre(c) }))
    .filter((x): x is { i: number; n: number } => x.n !== null)
  if (!nombres.length) return null

  // 1. Nombre suivi d'une unité.
  for (const x of nombres) {
    const suivante = (cellules[x.i + 1] || '').trim()
    if (suivante && UNITE.test(suivante) && x.n > 0) return x.n
  }

  // 2. P.U. × quantité = montant présent sur la ligne.
  const positifs = nombres.filter((x) => x.n > 0)
  let meilleur: number | null = null
  for (let a = 0; a < positifs.length; a++) {
    for (let b = a + 1; b < positifs.length; b++) {
      const p = positifs[a].n * positifs[b].n
      const montant = positifs.find((x, k) => k !== a && k !== b && Math.abs(x.n - p) <= Math.max(0.02, x.n * 0.005))
      if (!montant) continue
      const cands = [positifs[a].n, positifs[b].n].filter(estEntier)
      const q = cands.length ? Math.min(...cands) : Math.min(positifs[a].n, positifs[b].n)
      if (meilleur === null || q < meilleur) meilleur = q
    }
  }
  if (meilleur !== null) return meilleur

  // 3 et 4.
  if (nombres.length === 1) return nombres[0].n
  const entier = nombres.find((x) => estEntier(x.n) && x.n > 0)
  return (entier ?? nombres[0]).n
}

export function analyserLigneCollee(brut: string): LigneLue | null {
  const ligne = brut.replace(ESPACES, ' ').trim()
  if (!ligne) return null
  let tokens = ligne.split(/\t|;|\|/).map((t) => t.trim()).filter(Boolean)
  if (tokens.length <= 1) tokens = ligne.split(/\s+/).filter(Boolean)
  const estNombre = (t: string) => lireNombre(t) !== null

  // « 3 x RAK-… » ou « 3 RAK-… » : quantité en tête.
  if (tokens.length >= 2 && estNombre(tokens[0]) && !estNombre(tokens[1])) {
    const reste = tokens.slice(1).filter((t) => t.toLowerCase() !== 'x')
    if (!reste.length) return null
    const q = lireNombre(tokens[0]) || 1
    return { ref: reste[0].replace(/\s+/g, '').toUpperCase(), qte: q > 0 ? q : 1 }
  }

  const iRef = tokens.findIndex((t) => !estNombre(t))
  if (iRef < 0) return null
  const refTok = tokens[iRef]
  if (ENTETE.test(refTok) && !tokens.some(estNombre)) return null
  const qte = choisirQuantite(tokens.slice(iRef + 1))
  return { ref: refTok.replace(/\s+/g, '').toUpperCase(), qte: qte !== null && qte > 0 ? qte : 1 }
}
