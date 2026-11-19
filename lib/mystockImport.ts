/**
 * Lecture des fichiers MyStock (reporting FMS) pour l'écran /stock/controle-mystock — 19/11/2026.
 *  - image de stock (Référence + Quantité physique) : voir la page ;
 *  - préparations / expéditions à la ligne (reporting_commandes) ;
 *  - réceptions à la ligne (reporting_arrivages).
 * Fonctions pures sur la matrice de cellules (première feuille), testables hors navigateur.
 */

export type TypeMouvement = 'expedition' | 'reception'

export type ChampMouvement = 'document' | 'reference' | 'quantite' | 'date' | 'date_import' | 'tiers' | 'transporteur' | 'retour' | 'commande_fms'

export type ColonnesMouvement = Record<ChampMouvement, number>

export type LigneMouvementImport = {
  document: string
  reference: string
  quantite: number
  date: string
  date_import: string | null
  tiers: string | null
  transporteur: string | null
  retour: boolean
  commande_fms: string | null
}

export const LIBELLES_CHAMPS: Record<ChampMouvement, string> = {
  document: 'N° de document',
  reference: 'Référence',
  quantite: 'Quantité',
  date: 'Date du mouvement',
  date_import: "Date d'import",
  tiers: 'Client / fournisseur',
  transporteur: 'Transporteur',
  retour: 'Retour (0/1)',
  commande_fms: 'Commande FMS',
}

export const CHAMPS_OBLIGATOIRES: ChampMouvement[] = ['document', 'reference', 'quantite', 'date']

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Libellés reconnus, par ordre de préférence (comparaison sans accents ni casse, égalité stricte). */
const LIBELLES: Record<TypeMouvement, Partial<Record<ChampMouvement, string[]>>> = {
  expedition: {
    document: ['n° commande', 'n°commande', 'numero commande', 'no commande'],
    reference: ['reference', 'ref article', 'code article'],
    quantite: ['quantite', 'quantite preparee', 'quantite expediee', 'qte'],
    date: ['date de preparation', 'date de fin de preparation', "date d'expedition", 'date de validation'],
    date_import: ["date d'import"],
    tiers: ['societe', 'client final'],
    transporteur: ['transporteur'],
    commande_fms: ['commande fms', 'identifiant commande'],
  },
  reception: {
    document: ['n°reception', 'n° reception', 'numero reception', 'no reception'],
    reference: ['reference', 'ref article', 'code article'],
    quantite: ['quantite', 'quantite recue', 'qte'],
    date: ['date de validation', 'date de reception', "date d'import"],
    date_import: ["date d'import"],
    tiers: ['nom', 'expediteur'],
    retour: ['retour'],
    commande_fms: ['po/br n°'],
  },
}

/** Première ligne (parmi les 15 premières) qui contient un libellé de document et de référence. */
export function detecterEnteteMouvement(matrice: unknown[][], type: TypeMouvement): number {
  for (let i = 0; i < Math.min(15, matrice.length); i++) {
    const h = (matrice[i] || []).map(norm)
    const doc = LIBELLES[type].document!.some((l) => h.includes(norm(l)))
    const ref = LIBELLES[type].reference!.some((l) => h.includes(norm(l)))
    if (doc && ref) return i
  }
  return 0
}

/** Correspondance colonnes ↔ champs. Pour un libellé présent deux fois (ex. « Quantité » dans
 *  reporting_commandes : quantité préparée puis stock de l'article), la PREMIÈRE colonne est retenue. */
export function detecterColonnesMouvement(entetes: unknown[], type: TypeMouvement): ColonnesMouvement {
  const h = entetes.map(norm)
  const res = {} as ColonnesMouvement
  const champs = Object.keys(LIBELLES_CHAMPS) as ChampMouvement[]
  for (const champ of champs) {
    res[champ] = -1
    for (const lib of LIBELLES[type][champ] || []) {
      const i = h.indexOf(norm(lib))
      if (i >= 0) { res[champ] = i; break }
    }
  }
  return res
}

function deux(n: number) { return String(n).padStart(2, '0') }

/** Date/heure lue dans une cellule → « AAAA-MM-JJTHH:MM:SS » (heure locale du fichier, Paris). */
export function lireDateHeure(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${deux(v.getMonth() + 1)}-${deux(v.getDate())}T${deux(v.getHours())}:${deux(v.getMinutes())}:${deux(v.getSeconds())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Numéro de série Excel (jours depuis le 30/12/1899)
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}T${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}:${deux(d.getUTCSeconds())}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return `${m[3]}-${deux(+m[2])}-${deux(+m[1])}T${deux(+(m[4] ?? 0))}:${m[5] ?? '00'}:${m[6] ?? '00'}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`
  return null
}

function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/\s| | /g, '').replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}

export function lireMouvements(matrice: unknown[][], ligneEntete: number, col: ColonnesMouvement) {
  const lignes: LigneMouvementImport[] = []
  let ignorees = 0
  let dateMin: string | null = null
  let dateMax: string | null = null
  const txt = (r: unknown[], i: number) => (i >= 0 ? (String(r[i] ?? '').trim() || null) : null)
  for (const row of matrice.slice(ligneEntete + 1)) {
    const r = (row || []) as unknown[]
    const document = txt(r, col.document)
    const reference = txt(r, col.reference)
    const date = col.date >= 0 ? lireDateHeure(r[col.date]) : null
    const quantite = col.quantite >= 0 ? nombre(r[col.quantite]) : null
    if (!document || !reference || !date || quantite === null) { ignorees++; continue }
    const retourBrut = col.retour >= 0 ? String(r[col.retour] ?? '').trim().toLowerCase() : ''
    lignes.push({
      document: document.toUpperCase(),
      reference: reference.toUpperCase(),
      quantite,
      date,
      date_import: col.date_import >= 0 ? lireDateHeure(r[col.date_import]) : null,
      tiers: txt(r, col.tiers),
      transporteur: txt(r, col.transporteur),
      retour: ['1', 'oui', 'true', 'vrai', 'x'].includes(retourBrut),
      commande_fms: txt(r, col.commande_fms),
    })
    if (!dateMin || date < dateMin) dateMin = date
    if (!dateMax || date > dateMax) dateMax = date
  }
  const documents = new Set(lignes.map((l) => l.document)).size
  return { lignes, ignorees, dateMin, dateMax, documents }
}

/**
 * Heure de l'image de stock lue dans un texte (nom du fichier ou en-tête de colonne) :
 * « STOCK_FMS_121126_8h48 », « 2026-11-12 08h48 », « 12/11/2026 8:48 »… → « AAAA-MM-JJTHH:MM ».
 * Sans heure trouvée : 07:00 le jour lu. Sans date : null.
 */
export function heureImageDepuisTexte(t: string): string | null {
  const s = t || ''
  let a: number | null = null, m: number | null = null, j: number | null = null
  const ok = (aa: number, mm: number, jj: number) => aa >= 2020 && aa <= 2099 && mm >= 1 && mm <= 12 && jj >= 1 && jj <= 31
  let x = s.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/)
  if (x && ok(+x[1], +x[2], +x[3])) { a = +x[1]; m = +x[2]; j = +x[3] }
  if (a === null) { x = s.match(/(?<!\d)(\d{2})[-_./]?(\d{2})[-_./]?(20\d{2})(?!\d)/); if (x && ok(+x[3], +x[2], +x[1])) { a = +x[3]; m = +x[2]; j = +x[1] } }
  if (a === null) { x = s.match(/(?<!\d)(\d{2})[-_./]?(\d{2})[-_./]?(\d{2})(?!\d)/); if (x && ok(2000 + +x[3], +x[2], +x[1])) { a = 2000 + +x[3]; m = +x[2]; j = +x[1] } }
  if (a === null || m === null || j === null) return null
  let hh = 7, mn = 0
  const h = s.match(/(?<!\d)(\d{1,2})\s?[h:]\s?(\d{2})?(?!\d)/i)
  if (h && +h[1] < 24) { hh = +h[1]; mn = h[2] ? +h[2] : 0 }
  return `${a}-${deux(m)}-${deux(j)}T${deux(hh)}:${deux(mn)}`
}
