/**
 * lib/inventaireImport.ts — Intégration des feuilles de comptage scannées (23/11/2026)
 * ---------------------------------------------------------------------------
 * Utilisé par components/inventaire/ImportFeuilles.tsx (écran de saisie d'un dépôt et
 * écran de pilotage) :
 *   - pagesEnImages : chaque page d'un PDF (pdf.js) ou chaque photo devient une image
 *     JPEG (même préparation que la lecture photo de « Quand puis-je livrer ? ») ;
 *   - lireFeuille : appel de /api/stock/inventaire/lire-feuille (une page par appel) ; la lecture
 *     tourne en arrière-plan côté serveur, l'écran interroge le résultat toutes les 3 s
 *     (une page manuscrite peut demander plus d'une minute : appel unique coupé, « Failed to fetch ») ;
 *   - pages portrait redressées en paysage (feuille paysage scannée en A4 portrait) ;
 *   - rapprochement d'une référence lue avec les lignes de la liste.
 */

import type { LigneSaisie } from '@/lib/inventaire'

export const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
export const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

/** Taille maximale de l'image envoyée (côté le plus long), comme pour la lecture photo des commandes. */
const MAX_PX = 2400

export type EtatLu = 'vide' | 'lisible' | 'corrige' | 'barre' | 'illisible'

export type EnteteLue = {
  titre: string
  depot: string
  comptage: number | null
  code_liste: string
  date_inventaire: string
  equipes: string[]
  feuille: string
}

export type LigneLue = {
  ref: string; qte: number | null; etat: EtatLu; doute: boolean; commentaire: string; equipe: string
  /** N° imprimé de la ligne (= inventaire_lignes.id), feuilles imprimées depuis le 23/11/2026. */
  no?: number | null
  /** Ancres imprimées relevées sur la même ligne que l'écriture (contrôle de décalage de ligne). */
  ref_fournisseur?: string; qte_stock?: number | null
  position_incertaine?: boolean; ref_voisine?: string
}
export type HorsListeLu = { ref: string; qte: number | null; commentaire: string }
export type FeuilleLue = { entete: EnteteLue; lignes: LigneLue[]; hors_liste: HorsListeLu[] }

export type PageImage = { cle: string; fichier: string; page: number; nbPages: number; image: string }

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

/**
 * Les feuilles de comptage sont en paysage : une page portrait (scan A4 vertical) est tournée
 * d'un quart de tour dans le sens horaire (sens habituel du chargeur) ; l'IA corrige le reste.
 */
function canvasVersJpeg(canvas: HTMLCanvasElement): string {
  if (canvas.height <= canvas.width) return canvas.toDataURL('image/jpeg', 0.88)
  const r = document.createElement('canvas')
  r.width = canvas.height
  r.height = canvas.width
  const ctx = r.getContext('2d')
  if (!ctx) return canvas.toDataURL('image/jpeg', 0.88)
  ctx.translate(r.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(canvas, 0, 0)
  return r.toDataURL('image/jpeg', 0.88)
}

async function imageVersDataUrl(fichier: File): Promise<string> {
  const url = URL.createObjectURL(fichier)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error(`${fichier.name} : image illisible.`))
      i.src = url
    })
    const k = Math.min(1, MAX_PX / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * k)
    canvas.height = Math.round(img.height * k)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(`${fichier.name} : image illisible.`)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvasVersJpeg(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Une image JPEG par page de PDF (ou par photo). */
export async function pagesEnImages(fichiers: File[], onProgres?: (texte: string) => void): Promise<PageImage[]> {
  const out: PageImage[] = []
  for (const f of fichiers) {
    const estPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    if (!estPdf) {
      onProgres?.(`Préparation de ${f.name}…`)
      out.push({ cle: `${f.name}#1#${out.length}`, fichier: f.name, page: 1, nbPages: 1, image: await imageVersDataUrl(f) })
      continue
    }
    const pdfjsLib = await chargerPdfJs()
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgres?.(`Préparation de ${f.name} — page ${p} / ${pdf.numPages}…`)
      const page = await pdf.getPage(p)
      const v1 = page.getViewport({ scale: 1 })
      const scale = MAX_PX / Math.max(v1.width, v1.height)
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(vp.width)
      canvas.height = Math.round(vp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Rendu PDF impossible.')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      out.push({ cle: `${f.name}#${p}#${out.length}`, fichier: f.name, page: p, nbPages: pdf.numPages, image: canvasVersJpeg(canvas) })
    }
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function erreurReseau(e: unknown): Error {
  const m = e instanceof Error ? e.message : String(e)
  return new Error(/failed to fetch|load failed|network/i.test(m) ? 'Connexion au serveur interrompue : vérifier le réseau puis relancer.' : m)
}

/** Lecture IA d'une page : démarrage côté serveur puis interrogation du résultat (6 min au plus). */
export async function lireFeuille(image: string): Promise<FeuilleLue> {
  let id = ''
  try {
    const res = await fetch('/api/stock/inventaire/lire-feuille', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.id) throw new Error(json?.error || `Lecture impossible (${res.status})`)
    id = String(json.id)
  } catch (e) {
    throw erreurReseau(e)
  }
  const fin = Date.now() + 6.5 * 60000
  let echecs = 0
  while (Date.now() < fin) {
    await pause(3000)
    try {
      const res = await fetch(`/api/stock/inventaire/lire-feuille?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Suivi de lecture impossible (${res.status})`)
      echecs = 0
      if (json.statut === 'ok' && json.resultat) return json.resultat as FeuilleLue
      if (json.statut === 'erreur') throw new Error(json.erreur || 'Lecture de la page impossible.')
    } catch (e) {
      // Coupure passagère : on retente quelques fois avant d'abandonner.
      if (++echecs >= 5 || !(e instanceof TypeError)) throw erreurReseau(e)
    }
  }
  throw new Error('La lecture de la page n’a pas abouti dans les 6 minutes. Relancer la page.')
}

/** Exécute des tâches avec au plus n appels simultanés, dans l'ordre des résultats. */
export async function enParallele<T, R>(items: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length)
  let k = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) {
      const i = k++
      res[i] = await f(items[i], i)
    }
  }))
  return res
}

/** Clé de rapprochement d'une référence : majuscules, sans espace ni ponctuation, O lu pour 0 neutralisé. */
export function cleRef(v: string | null | undefined): string {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Distance d'édition (Levenshtein) entre deux clés courtes. */
export function distance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}

/** Deux références « semblables » malgré une erreur de lecture (1 caractère d'écart, confusions O/0, I/1…). */
export function refsProches(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = cleFloue(String(a || '')), y = cleFloue(String(b || ''))
  if (!x || !y) return true
  return x === y || distance(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 8))
}

function cleFloue(v: string): string {
  return cleRef(v).replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
}

/** Ligne de la liste correspondant à une référence lue (exacte, puis réf. fournisseur, puis lecture tolérante). */
export function trouverLigne(lignes: LigneSaisie[], ref: string): LigneSaisie | null {
  const k = cleRef(ref)
  if (!k) return null
  const exacte = lignes.find((l) => cleRef(l.reference) === k)
  if (exacte) return exacte
  const fourn = lignes.filter((l) => cleRef(l.ref_fournisseur) === k)
  if (fourn.length === 1) return fourn[0]
  const f = cleFloue(ref)
  const floues = lignes.filter((l) => cleFloue(l.reference) === f)
  return floues.length === 1 ? floues[0] : null
}

/** Lit « AB, CD/EF » → ['AB', 'CD/EF'] (équipes séparées par virgule ou point-virgule). */
export function equipesDe(v: string): string[] {
  return v.split(/[,;]+/).map((x) => x.toUpperCase().split(/[^A-ZÀ-Ÿ]+/).filter(Boolean).join('/')).filter(Boolean)
}
