// ============================================================================
// lib/tarifsFournisseurs.ts — Lecture des propositions de tarif fournisseur
// (écran « Tarifs fournisseurs », /stock/tarifs-fournisseurs — 19/11/2026)
// ----------------------------------------------------------------------------
// N'importe quel fichier Excel / CSV / PDF de tarif est ramené à une grille
// (lignes × colonnes), puis :
//   - la ligne d'en-tête est détectée (mots-clés réf., désignation, prix…) ;
//   - chaque colonne reçoit un rôle (réf. fournisseur, EAN, désignation, prix,
//     quantité de palier…) que l'utilisateur peut corriger ;
//   - les paliers sont lus par paires « quantité → prix » dans l'ordre des
//     colonnes (ex. Aspen : Qté 1 / PU, Qté 10 / PU, Qté 25 / PU, Qté 100 / PU) ;
//     une colonne de prix sans colonne de quantité devant elle prend la quantité
//     écrite dans son en-tête (« Prix ≥ 10 », « 25+ ») ou 1 ;
//   - une colonne de remise (%) s'applique à tous les prix de la ligne.
// Les PDF sont lus avec pdf.js (texte positionné) : les morceaux de texte sont
// regroupés en lignes, puis rangés sous la colonne d'en-tête la plus proche.
// Pour un PDF mal structuré, l'écran propose une extraction par l'IA
// (route /api/stock/tarifs/extraire) qui renvoie directement les lignes.
//
// Calculs de comparaison (prix à quantité égale, palier SAGE / nouveau palier)
// partagés par l'écran et l'export Excel.
// ============================================================================

export type Cellule = string | number | null
export type Grille = { feuille: string; lignes: Cellule[][] }

export const CHAMPS = [
  'ignorer', 'ref_fournisseur', 'designation', 'ean', 'marque', 'gamme', 'unite',
  'prix_public', 'colisage', 'qte_palette', 'qte_palier', 'prix', 'remise',
] as const
export type Champ = (typeof CHAMPS)[number]

export const LIBELLES_CHAMPS: Record<Champ, string> = {
  ignorer: '— ignorer —',
  ref_fournisseur: 'Réf. fournisseur',
  designation: 'Désignation',
  ean: 'Code EAN',
  marque: 'Marque',
  gamme: 'Gamme / famille',
  unite: 'Unité',
  prix_public: 'Prix public',
  colisage: 'Colisage (par boîte)',
  qte_palette: 'Qté par palette',
  qte_palier: 'Qté de palier',
  prix: 'Prix d’achat (palier)',
  remise: 'Remise %',
}

export type Mapping = { ligneEntete: number; colonnes: Champ[] }

export type Palier = { qte: number; prix: number }
export type LigneImport = {
  ligne_no: number
  ref_fournisseur: string | null
  ean: string | null
  designation: string | null
  marque: string | null
  gamme: string | null
  unite: string | null
  prix_public: number | null
  colisage: number | null
  qte_palette: number | null
  paliers: Palier[]
  brut?: Record<string, Cellule>
}

// ─────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────

export function texte(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleDateString('fr-FR')
  return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Nombre écrit à la française ou à l'anglaise : « 1 234,56 € », « 117.78 », « 12,5 % ». */
export function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).replace(/[  \s]/g, '').replace(/[€$£%]/g, '').replace(/EUR/i, '')
  if (!s || !/\d/.test(s)) return null
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '') // 1,234.56
  else s = s.replace(',', '.')
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null
  const x = Number(s)
  return Number.isFinite(x) ? x : null
}

export function normRef(v: unknown): string {
  return texte(v).toUpperCase().replace(/\s+/g, '')
}

// ─────────────────────────────────────────────────────────────────────────
// Détection de l'en-tête et des colonnes
// ─────────────────────────────────────────────────────────────────────────

type Regle = { champ: Champ; re: RegExp; sauf?: RegExp }
// Ordre important : la première règle qui correspond l'emporte.
const REGLES: Regle[] = [
  { champ: 'ean', re: /\b(ean|gtin|code ?barre|codebarre|upc)\b/ },
  { champ: 'designation', re: /(designation|libelle|description|descriptif|denomination)/ },
  { champ: 'prix_public', re: /(prix public|tarif public|prix catalogue|ppi|pvc|prix de vente conseille|prix de vente public|public price|list price|rrp|msrp)/ },
  { champ: 'remise', re: /(remise|discount|rabais)/ },
  { champ: 'qte_palette', re: /palette/ },
  { champ: 'colisage', re: /(par boite|par carton|colisage|conditionnement|pcb|uv\b|unite de vente|pack size|qte par boite|quantite par boite)/ },
  { champ: 'marque', re: /\b(marque|brand|fabricant)\b/ },
  { champ: 'gamme', re: /(gamme|famille|categorie|category|sous-famille|range)/ },
  { champ: 'unite', re: /^(unite|u\.?|uom|unit)$/ },
  { champ: 'qte_palier', re: /(quantite|qte|qty|quantity|palier|seuil|mini)/, sauf: /prix|price|tarif/ },
  { champ: 'prix', re: /(prix|price|tarif|p\.?u\.?\b|pu ht|net|cout|cost|montant)/ },
  { champ: 'ref_fournisseur', re: /(ref|reference|code|produit|article|item|part ?n|sku|modele|model)/ },
]

export function champDepuisEntete(entete: string): Champ {
  const t = sansAccents(texte(entete))
  if (!t) return 'ignorer'
  for (const r of REGLES) {
    if (r.re.test(t) && !(r.sauf && r.sauf.test(t))) return r.champ
  }
  return 'ignorer'
}

/** Ligne d'en-tête = la ligne (parmi les 60 premières) qui reconnaît le plus de rôles, dont au moins un prix. */
export function detecterEntete(lignes: Cellule[][]): number {
  let best = 0
  let bestScore = -1
  const max = Math.min(lignes.length, 60)
  for (let i = 0; i < max; i++) {
    const champs = (lignes[i] || []).map((c) => (typeof c === 'number' ? 'ignorer' : champDepuisEntete(texte(c))))
    const roles = new Set(champs.filter((c) => c !== 'ignorer'))
    let score = roles.size
    if (roles.has('prix')) score += 2
    if (roles.has('ref_fournisseur')) score += 1
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

export function detecterMapping(lignes: Cellule[][], ligneEntete?: number): Mapping {
  const idx = ligneEntete ?? detecterEntete(lignes)
  const entete = lignes[idx] || []
  const nbCol = Math.max(entete.length, ...lignes.slice(idx + 1, idx + 30).map((l) => l.length))
  const colonnes: Champ[] = []
  const vus = new Set<Champ>()
  for (let c = 0; c < nbCol; c++) {
    let ch = champDepuisEntete(texte(entete[c]))
    // Les rôles multiples ne sont admis que pour les paliers (qté / prix).
    if (ch !== 'prix' && ch !== 'qte_palier' && ch !== 'ignorer' && vus.has(ch)) ch = 'ignorer'
    colonnes.push(ch)
    vus.add(ch)
  }
  // Pas de colonne réf. reconnue : première colonne texte dont les valeurs ressemblent à des codes.
  if (!colonnes.includes('ref_fournisseur')) {
    const echantillon = lignes.slice(idx + 1, idx + 40)
    for (let c = 0; c < nbCol; c++) {
      if (colonnes[c] !== 'ignorer') continue
      const vals = echantillon.map((l) => texte(l[c])).filter(Boolean)
      if (vals.length >= 3 && vals.filter((v) => /^[A-Z0-9][A-Z0-9\-_./]{2,24}$/i.test(v) && /\d/.test(v)).length >= vals.length * 0.7) {
        colonnes[c] = 'ref_fournisseur'
        break
      }
    }
  }
  return { ligneEntete: idx, colonnes }
}

/** Quantité écrite dans un en-tête de colonne de prix : « Prix ≥ 10 », « 25+ », « de 100 à 499 », « x50 ». */
function qteDepuisEntete(entete: string): number | null {
  const t = sansAccents(texte(entete))
  const m = t.match(/(?:>=|≥|>|de|from|x|a partir de|des)\s*(\d+)/) || t.match(/(\d+)\s*(?:\+|et plus|pcs?|pieces?|u\b)/)
  if (m) return Number(m[1])
  return null
}

/** Applique le mapping : une ligne par article (au moins une réf. ou un EAN, et un prix). */
export function lireLignes(lignes: Cellule[][], mapping: Mapping): LigneImport[] {
  const { ligneEntete, colonnes } = mapping
  const entete = lignes[ligneEntete] || []
  const out: LigneImport[] = []
  const premier = (l: Cellule[], ch: Champ) => {
    const c = colonnes.indexOf(ch)
    return c >= 0 ? l[c] : null
  }
  for (let i = ligneEntete + 1; i < lignes.length; i++) {
    const l = lignes[i] || []
    if (!l.some((c) => texte(c) !== '')) continue
    // Ligne d'en-tête répétée (PDF multi-pages, Excel par blocs)
    if (texte(l[colonnes.indexOf('ref_fournisseur')]) && texte(l[colonnes.indexOf('ref_fournisseur')]) === texte(entete[colonnes.indexOf('ref_fournisseur')])) continue

    const ref = texte(premier(l, 'ref_fournisseur')) || null
    const eanBrut = premier(l, 'ean')
    const ean = eanBrut === null || eanBrut === undefined ? null
      : (typeof eanBrut === 'number' ? Math.round(eanBrut).toString() : texte(eanBrut).replace(/\s/g, '')) || null
    const remise = nombre(premier(l, 'remise'))

    // Paliers : paires (qté, prix) dans l'ordre des colonnes
    const paliers: Palier[] = []
    let qteEnAttente: number | null = null
    for (let c = 0; c < colonnes.length; c++) {
      if (colonnes[c] === 'qte_palier') {
        qteEnAttente = nombre(l[c])
      } else if (colonnes[c] === 'prix') {
        let prix = nombre(l[c])
        if (prix !== null && prix > 0) {
          if (remise !== null && remise > 0 && remise < 100) prix = Math.round(prix * (1 - remise / 100) * 10000) / 10000
          const q = qteEnAttente ?? qteDepuisEntete(texte(entete[c])) ?? (paliers.length === 0 ? 1 : null)
          if (q !== null) paliers.push({ qte: Math.max(1, q), prix })
        }
        qteEnAttente = null
      }
    }
    if (!ref && !ean) continue
    if (!paliers.length) continue
    // Dédoublonne et trie les paliers
    const parQte = new Map<number, number>()
    for (const p of paliers) if (!parQte.has(p.qte)) parQte.set(p.qte, p.prix)
    const tri = [...parQte.entries()].sort((a, b) => a[0] - b[0]).map(([qte, prix]) => ({ qte, prix }))

    const brut: Record<string, Cellule> = {}
    for (let c = 0; c < l.length; c++) {
      if (!texte(l[c])) continue
      let cle = texte(entete[c]) || `col${c + 1}`
      if (cle in brut) cle = `${cle} (${c + 1})`
      brut[cle] = l[c]
    }

    out.push({
      ligne_no: i + 1,
      ref_fournisseur: ref,
      ean,
      designation: texte(premier(l, 'designation')) || null,
      marque: texte(premier(l, 'marque')) || null,
      gamme: texte(premier(l, 'gamme')) || null,
      unite: texte(premier(l, 'unite')) || null,
      prix_public: nombre(premier(l, 'prix_public')),
      colisage: nombre(premier(l, 'colisage')),
      qte_palette: nombre(premier(l, 'qte_palette')),
      paliers: tri,
      brut,
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Lecture des fichiers
// ─────────────────────────────────────────────────────────────────────────

export async function lireExcel(file: File): Promise<Grille[]> {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return wb.SheetNames.map((nom: string) => ({
    feuille: nom,
    lignes: (XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null }) as unknown[][]).map((l) =>
      l.map((c) => (c === null || c === undefined ? null : typeof c === 'number' ? c : c instanceof Date ? c.toLocaleDateString('fr-FR') : String(c)))
    ),
  }))
}

/** Feuille la plus probable : celle qui produit le plus de lignes de tarif. */
export function choisirFeuille(grilles: Grille[]): number {
  let best = 0
  let bestN = -1
  grilles.forEach((g, i) => {
    const n = lireLignes(g.lignes, detecterMapping(g.lignes)).length
    if (n > bestN) {
      bestN = n
      best = i
    }
  })
  return best
}

// ── PDF ──────────────────────────────────────────────────────────────────

export const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
export const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- objets pdf.js non typés (bibliothèque chargée par CDN) */
async function chargerPdfJs(): Promise<any> {
  const w = window as any
  if (!w.pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const existant = document.querySelector(`script[src="${PDF_JS_URL}"]`) as HTMLScriptElement | null
      const s = existant || document.createElement('script')
      s.addEventListener('load', () => resolve())
      s.addEventListener('error', () => reject(new Error('Lecteur PDF indisponible (connexion à cdnjs).')))
      if (!existant) {
        s.src = PDF_JS_URL
        document.head.appendChild(s)
      } else if (w.pdfjsLib) resolve()
    })
  }
  for (let i = 0; i < 40 && !w.pdfjsLib; i++) await new Promise((r) => setTimeout(r, 100))
  if (!w.pdfjsLib) throw new Error('Lecteur PDF indisponible.')
  w.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL
  return w.pdfjsLib
}

export type CellulePdf = { t: string; x0: number; x1: number }
export type LignePdf = { page: number; y: number; cells: CellulePdf[] }

/** Texte positionné du PDF regroupé en lignes (même hauteur) et en cellules (morceaux proches). */
export async function lirePdf(file: File): Promise<{ lignes: LignePdf[]; texteParPage: string[] }> {
  const pdfjsLib = await chargerPdfJs()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const lignes: LignePdf[] = []
  const texteParPage: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const items = (tc.items as any[])
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => {
        const x = it.transform[4] as number
        const y = it.transform[5] as number
        const h = Math.abs(it.height || it.transform[3] || 8)
        return { t: String(it.str), x0: x, x1: x + (it.width || 0), y, h }
      })
      .sort((a, b) => b.y - a.y || a.x0 - b.x0)
    // Lignes : même ordonnée à ±40 % de la hauteur du texte
    const groupes: { y: number; h: number; items: typeof items }[] = []
    for (const it of items) {
      const g = groupes.find((gg) => Math.abs(gg.y - it.y) <= Math.max(2, Math.min(gg.h, it.h) * 0.4))
      if (g) g.items.push(it)
      else groupes.push({ y: it.y, h: it.h, items: [it] })
    }
    groupes.sort((a, b) => b.y - a.y)
    const textes: string[] = []
    for (const g of groupes) {
      const tri = g.items.sort((a, b) => a.x0 - b.x0)
      const cells: CellulePdf[] = []
      for (const it of tri) {
        const der = cells[cells.length - 1]
        const ecart = der ? it.x0 - der.x1 : Infinity
        if (der && ecart < Math.max(2.5, g.h * 0.35)) {
          der.t = (der.t + (ecart > g.h * 0.12 ? ' ' : '') + it.t).replace(/\s+/g, ' ')
          der.x1 = Math.max(der.x1, it.x1)
        } else {
          cells.push({ t: it.t.trim(), x0: it.x0, x1: it.x1 })
        }
      }
      lignes.push({ page: p, y: g.y, cells })
      textes.push(cells.map((c) => c.t).join(' | '))
    }
    texteParPage.push(textes.join('\n'))
  }
  return { lignes, texteParPage }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Grille brute (cellules dans l'ordre) — sert à repérer la ligne d'en-tête. */
export function grilleBrutePdf(lignes: LignePdf[]): Cellule[][] {
  return lignes.map((l) => l.cells.map((c) => c.t))
}

/**
 * Grille alignée sur les colonnes de la ligne d'en-tête : chaque cellule est rangée
 * sous l'en-tête dont elle recouvre le plus la largeur (sinon le plus proche).
 */
export function grilleAligneePdf(lignes: LignePdf[], idxEntete: number): Cellule[][] {
  const entete = lignes[idxEntete]
  if (!entete) return grilleBrutePdf(lignes)
  const cols = entete.cells.map((c) => ({ x0: c.x0, x1: c.x1, m: (c.x0 + c.x1) / 2 }))
  // Bornes de colonnes : milieu entre deux en-têtes consécutifs
  const bornes = cols.map((c, i) => ({
    g: i === 0 ? -Infinity : (cols[i - 1].x1 + c.x0) / 2,
    d: i === cols.length - 1 ? Infinity : (c.x1 + cols[i + 1].x0) / 2,
  }))
  return lignes.map((l, i) => {
    if (i === idxEntete) return entete.cells.map((c) => c.t)
    const out: Cellule[] = new Array(cols.length).fill(null)
    for (const c of l.cells) {
      const m = (c.x0 + c.x1) / 2
      let k = bornes.findIndex((b) => m >= b.g && m < b.d)
      if (k < 0) k = 0
      out[k] = out[k] ? `${out[k]} ${c.t}` : c.t
    }
    return out
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Informations d'en-tête du fichier (validité, conditions, fournisseur)
// ─────────────────────────────────────────────────────────────────────────

function dateIso(jjmmaaaa: string): string | null {
  const m = jjmmaaaa.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (!m) return null
  const a = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export type InfosFichier = { date_effet: string | null; date_fin: string | null; conditions: string[] }

/** Repère « dates de validité 01/01/2027 - 31/12/2027 », « applicable au … » et les lignes « libellé : valeur » hors grille. */
export function infosFichier(textes: string[]): InfosFichier {
  let date_effet: string | null = null
  let date_fin: string | null = null
  const conditions: string[] = []
  const tout = textes.join('\n')
  const plage = tout.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s*(?:-|–|au|à|a|to)\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i)
  if (plage) {
    date_effet = dateIso(plage[1])
    date_fin = dateIso(plage[2])
  } else {
    const app = sansAccents(tout).match(/(?:applicable|valable|effet|en vigueur|validite)[^0-9]{0,40}(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/)
    if (app) date_effet = dateIso(app[1])
  }
  for (const t of textes) {
    const s = texte(t)
    if (s.length < 6 || s.length > 220) continue
    if (/:/.test(s) && /(franco|livraison|minimum|minimun|reglement|règlement|paiement|port|validit|commande|frais|escompte|delai|délai)/i.test(s)) {
      if (!conditions.includes(s)) conditions.push(s)
    }
  }
  return { date_effet, date_fin, conditions: conditions.slice(0, 20) }
}

/** Textes « libellé : valeur » des cellules d'un classeur, ligne par ligne (feuilles hors grille de prix). */
export function textesClasseur(grilles: Grille[], exclure?: string): string[] {
  const out: string[] = []
  for (const g of grilles) {
    if (g.feuille === exclure) {
      for (const l of g.lignes.slice(0, 15)) {
        const s = l.map(texte).filter(Boolean).join(' ')
        if (s) out.push(s)
      }
      continue
    }
    for (const l of g.lignes.slice(0, 300)) {
      const cells = l.map(texte).filter(Boolean)
      if (!cells.length) continue
      out.push(cells.length > 1 && !cells[0].endsWith(':') ? cells.join(' ') : cells.join(' '))
    }
  }
  return out
}

/** Fournisseur le plus cité dans le fichier (nom SAGE, mots de 4 lettres et plus). */
export function devinerFournisseur(textes: string[], fournisseurs: { fournisseur: string; nom: string | null }[]): string | null {
  const corpus = sansAccents(textes.join(' ')).replace(/[^a-z0-9]+/g, ' ')
  let best: string | null = null
  let bestScore = 0
  for (const f of fournisseurs) {
    const nom = sansAccents(f.nom || '').replace(/[^a-z0-9]+/g, ' ').trim()
    if (nom.length < 4) continue
    const mots = nom.split(' ').filter((m) => m.length >= 4 && !['france', 'group', 'groupe', 'societe', 'distribution', 'industrie', 'industries'].includes(m))
    if (!mots.length) continue
    let score = 0
    if (corpus.includes(` ${nom} `) || corpus.startsWith(`${nom} `)) score += 10
    for (const m of mots) {
      const n = corpus.split(` ${m} `).length - 1
      score += Math.min(n, 5)
    }
    score = score / mots.length
    if (score > bestScore) {
      bestScore = score
      best = f.fournisseur
    }
  }
  return bestScore >= 1 ? best : null
}

// ─────────────────────────────────────────────────────────────────────────
// Prix à quantité donnée
// ─────────────────────────────────────────────────────────────────────────

export type PalierSage = { de: number; a: number; prix: number }

/**
 * Prix SAGE pour une quantité : palier tel que borne précédente < q ≤ borne sup
 * (au-delà de la dernière borne : dernier palier) ; sans palier : prix net fournisseur.
 */
export function prixSage(prixNet: number | null, paliers: PalierSage[] | null | undefined, q: number): number | null {
  if (paliers && paliers.length) {
    const tri = [...paliers].sort((a, b) => Number(a.a) - Number(b.a))
    const p = tri.find((x) => q <= Number(x.a)) || tri[tri.length - 1]
    const v = Number(p.prix)
    if (Number.isFinite(v) && v > 0) return v
  }
  return prixNet !== null && Number.isFinite(prixNet) && prixNet > 0 ? prixNet : null
}

/** Nouveau prix pour une quantité : dernier palier dont la quantité minimale ≤ q (sinon le premier). */
export function prixPalier(paliers: Palier[] | null | undefined, q: number): number | null {
  if (!paliers || !paliers.length) return null
  const tri = [...paliers].sort((a, b) => a.qte - b.qte)
  let p = tri[0]
  for (const x of tri) if (x.qte <= q) p = x
  return Number.isFinite(p.prix) ? p.prix : null
}

/** Quantités à comparer pour le détail d'un article : seuils des deux grilles. */
export function seuilsComparaison(nouveaux: Palier[], sage: PalierSage[] | null | undefined): number[] {
  const s = new Set<number>([1])
  for (const p of nouveaux) s.add(Math.max(1, Math.round(p.qte)))
  for (const p of sage || []) s.add(Math.max(1, Math.floor(Number(p.de)) + 1))
  return [...s].sort((a, b) => a - b).slice(0, 10)
}
