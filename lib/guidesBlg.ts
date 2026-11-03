// ============================================================================
// lib/guidesBlg.ts — Guides BLG (modes opératoires BLG Cloud) — 03/11/2026
// ----------------------------------------------------------------------------
// Les chapitres arrivent en HTML autonome (ex. CHAPITRE-Clients.html, ~20 Mo) :
// captures d'écran et PDF y sont intégrés en data:…;base64.
//  - preparerGuide()   : au dépôt (navigateur de l'administrateur), extrait chaque
//    ressource intégrée en fichier séparé et la remplace dans la page par
//    __GUIDE_ASSET__/<fichier> → page légère (~160 Ko) + fichiers.
//  - construireGuide() : à la lecture, remplace ces marqueurs par des URL signées
//    (bucket privé « guides-blg »), ouvre les PDF dans un nouvel onglet, charge les
//    images à la demande et peut positionner la page sur une étape (ancre).
// Migration : supabase/migrations/20261103g_guides_blg.sql
// ============================================================================

export const GUIDES_BUCKET = 'guides-blg'
export const ASSET_TOKEN = '__GUIDE_ASSET__/'
/** Durée de validité des URL signées des images / PDF (secondes). */
export const GUIDES_URL_TTL = 6 * 3600

export type GuideSommaireItem = {
  id: string
  numero: string
  titre: string
  nb_etapes: number
}

export type GuideAsset = { nom: string; mime: string; blob: Blob }

export type GuidePrepare = {
  slug: string
  titre: string
  sous_titre: string
  html: string
  assets: GuideAsset[]
  sommaire: GuideSommaireItem[]
  nb_modop: number
  nb_etapes: number
  nb_images: number
  nb_pdf: number
  taille_origine: number
  taille_page: number
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
}

const DATA_URI = /data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi
const TOKEN_RE = /__GUIDE_ASSET__\/([A-Za-z0-9._-]+)/g

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function sansAccents(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** CHAPITRE-Clients.html → clients */
export function slugDepuisFichier(nomFichier: string): string {
  const base = nomFichier.replace(/\.[^.]+$/, '').replace(/^chapitre[-_ ]*/i, '')
  const slug = sansAccents(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `guide-${Date.now()}`
}

function texte(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Prépare un chapitre HTML autonome pour le dépôt. */
export async function preparerGuide(file: File): Promise<GuidePrepare> {
  const source = await file.text()
  const parNom = new Map<string, string>() // contenu base64 → nom de fichier (dédoublonnage)
  const assets: GuideAsset[] = []
  let nbImages = 0
  let nbPdf = 0

  const html = source.replace(DATA_URI, (_m, mimeBrut: string, b64: string) => {
    const mime = mimeBrut.toLowerCase()
    const deja = parNom.get(b64)
    if (deja) return ASSET_TOKEN + deja
    const ext = EXTENSIONS[mime] ?? 'bin'
    const nom = `a${String(assets.length + 1).padStart(4, '0')}.${ext}`
    parNom.set(b64, nom)
    assets.push({ nom, mime, blob: base64ToBlob(b64, mime) })
    if (mime === 'application/pdf') nbPdf++
    else if (mime.startsWith('image/')) nbImages++
    return ASSET_TOKEN + nom
  })

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const titreComplet = texte(doc.querySelector('title')) || file.name.replace(/\.[^.]+$/, '')
  const [titre, ...reste] = titreComplet.split(/\s+[—–-]\s+/)
  const sousTitre = reste.join(' — ')

  const sommaire: GuideSommaireItem[] = []
  doc.querySelectorAll('section.intro[id]').forEach((sec) => {
    const id = sec.getAttribute('id') ?? ''
    if (!id) return
    const numero = texte(sec.querySelector('.k')).split('·')[0].trim()
    const titreModop = texte(sec.querySelector('h2')) || numero || id
    let nbEtapes = 0
    doc.querySelectorAll('section.step[data-m]').forEach((st) => {
      if (st.getAttribute('data-m') === id) nbEtapes++
    })
    sommaire.push({ id, numero, titre: titreModop, nb_etapes: nbEtapes })
  })
  const nbEtapesTotal = doc.querySelectorAll('section.step').length

  return {
    slug: slugDepuisFichier(file.name),
    titre: titre.trim() || titreComplet,
    sous_titre: sousTitre.trim(),
    html,
    assets,
    sommaire,
    nb_modop: sommaire.length,
    nb_etapes: nbEtapesTotal,
    nb_images: nbImages,
    nb_pdf: nbPdf,
    taille_origine: file.size,
    taille_page: new Blob([html]).size,
  }
}

/** Noms des fichiers référencés par une page préparée. */
export function assetsReferences(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(TOKEN_RE)) out.add(m[1])
  return Array.from(out)
}

function attrEsc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;')
}

/**
 * Page prête à afficher : marqueurs remplacés par les URL signées, PDF ouverts
 * dans un nouvel onglet (téléchargés sous leur nom d'origine), images en
 * chargement différé, positionnement optionnel sur une ancre (ex. comprendre-fiche-04).
 */
export function construireGuide(html: string, urls: Map<string, string>, ancre?: string | null): string {
  const nomsPdf = new Map<string, string>()

  let out = html.replace(/<a\b[^>]*>/gi, (tag) => {
    if (!tag.includes(ASSET_TOKEN)) return tag
    const m = /__GUIDE_ASSET__\/([A-Za-z0-9._-]+)/.exec(tag)
    const d = /\sdownload\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/i.exec(tag)
    if (m) nomsPdf.set(m[1], (d?.[1] ?? d?.[2] ?? d?.[3] ?? m[1]).trim())
    return tag.replace(/^<a\b/i, '<a target=_blank rel=noopener')
  })

  out = out.replace(TOKEN_RE, (_m, nom: string) => {
    const url = urls.get(nom)
    if (!url) return ''
    const nomPdf = nomsPdf.get(nom)
    const final = nomPdf ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(nomPdf)}` : url
    return attrEsc(final)
  })

  out = out.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading=lazy')

  // Dans une iframe srcdoc, un lien « #etape » se résout sur l'URL du compagnon et
  // rechargerait le cadre : on intercepte ces liens (et location.hash du script de
  // la page) pour faire défiler le document lui-même.
  const ancreSure = (ancre ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  const script =
    `<script>(function(){` +
    `function aller(id){var e=id?document.getElementById(id):null;if(e){e.scrollIntoView();}else if(!id){scrollTo(0,0);}}` +
    `document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a[href^="#"]'):null;` +
    `if(!a)return;ev.preventDefault();aller(decodeURIComponent(a.getAttribute('href').slice(1)));},true);` +
    `addEventListener('hashchange',function(){aller(decodeURIComponent(location.hash.slice(1)));});` +
    (ancreSure
      ? `function go(){aller('${ancreSure}');}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',go);}else{go();}setTimeout(go,300);`
      : '') +
    `})();</script>`
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${script}</body>`) : out + script
  return out
}

export function formatTaille(octets: number | null | undefined): string {
  const n = Number(octets ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}
