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

// ============================================================================
// 03/11/2026 (b) — Index de recherche et icônes des chapitres
// ----------------------------------------------------------------------------
// indexerGuide()     : à partir de la page déposée, liste des modes opératoires avec
//                      résumé et étapes (titre + texte), les étapes étant rattachées au
//                      mode opératoire qui les précède dans le document.
// rechercherModops() : question libre → modes opératoires pertinents (mots-clés
//                      normalisés, racines françaises simples, quelques synonymes
//                      métier), avec l'étape la plus proche pour ouvrir au bon endroit.
// ============================================================================

export type GuideEtapeIndex = { id: string; numero: string; titre: string; texte: string }
export type GuideModopIndex = {
  id: string
  numero: string
  titre: string
  resume: string
  texte: string
  etapes: GuideEtapeIndex[]
}

export function indexerGuide(html: string): GuideModopIndex[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const modops: GuideModopIndex[] = []
  const parId = new Map<string, GuideModopIndex>()
  let courant: GuideModopIndex | null = null
  doc.querySelectorAll('section[id]').forEach((sec) => {
    const id = sec.getAttribute('id') ?? ''
    if (sec.classList.contains('intro')) {
      courant = {
        id,
        numero: texte(sec.querySelector('.k')).split('·')[0].trim(),
        titre: texte(sec.querySelector('h2')) || id,
        resume: texte(sec.querySelector('.sub')),
        texte: [texte(sec.querySelector('.sub')), texte(sec.querySelector('.cas'))].filter(Boolean).join(' '),
        etapes: [],
      }
      modops.push(courant)
      parId.set(id, courant)
      return
    }
    if (!sec.classList.contains('step')) return
    const cible = parId.get(sec.getAttribute('data-m') ?? '') ?? courant
    if (!cible) return
    const parties = Array.from(sec.querySelectorAll('.do, .encart, .cap, .att')).map((e) => texte(e))
    cible.etapes.push({
      id,
      numero: texte(sec.querySelector('.badge')),
      titre: texte(sec.querySelector('h3')),
      texte: parties.join(' '),
    })
  })
  return modops
}

const MOTS_VIDES = new Set(
  (
    'a au aux avec ce ces cet cette comment dans de des du d elle en est et etre faire fait faut il ils je j l la le les leur lui ' +
    'ma mais me mes mon ne nous on ou par pas peut peux plus pour quand que quel quelle quelles quels qui quoi qu sa se ses si son ' +
    'sont sur ta te tes ton tu un une vous veux voudrais souhaite dois doit y savoir comme ca cela ceci via apres avant'
  ).split(' '),
)

const SYNONYMES: Record<string, string[]> = {
  cde: ['command'],
  cdc: ['command', 'client'],
  cdf: ['command', 'fournisseur'],
  bl: ['livr'],
  pl: ['reserv', 'prepar'],
  frs: ['fournisseur'],
  fournisseurs: ['fournisseur'],
  prepa: ['prepar', 'reserv'],
  preparation: ['prepar', 'reserv'],
  supprimer: ['archiv', 'retir', 'supprim'],
  effacer: ['archiv', 'retir'],
  trouver: ['recherch'],
  chercher: ['recherch'],
  retrouver: ['recherch', 'retrouv'],
  bloque: ['bloqu'],
  encours: ['encour'],
  adresse: ['adress'],
  expedier: ['livr', 'expedi'],
  expedition: ['livr', 'expedi'],
  envoyer: ['livr'],
  comptoir: ['comptoir', 'enlev'],
  devis: ['devi'],
}

const SUFFIXES = [
  'issements', 'issement', 'aisons', 'aison', 'ations', 'ation', 'ements', 'ement', 'ances', 'ance',
  'ages', 'age', 'euses', 'euse', 'eurs', 'eur', 'ees', 'ee', 'ers', 'er', 'ez', 'ent', 'es', 'ir', 'is', 'e', 's', 'x',
]

function normaliser(v: string): string {
  return sansAccents(v.toLowerCase()).replace(/[’']/g, ' ')
}

/** Racine simple d'un mot français (bloquer / bloqué / blocage → bloqu…). */
export function racine(mot: string): string {
  let m = normaliser(mot).replace(/[^a-z0-9]/g, '')
  if (m.length <= 3) return m
  for (const suf of SUFFIXES) {
    if (m.length - suf.length >= 4 && m.endsWith(suf)) {
      m = m.slice(0, -suf.length)
      break
    }
  }
  return m
}

function racines(v: string): Set<string> {
  const out = new Set<string>()
  for (const mot of normaliser(v).split(/[^a-z0-9]+/)) {
    if (mot.length < 2 || MOTS_VIDES.has(mot)) continue
    out.add(racine(mot))
  }
  return out
}

function contient(ens: Set<string>, r: string): boolean {
  if (ens.has(r)) return true
  if (r.length < 4) return false
  for (const x of ens) {
    if (x.length >= 4 && (x.startsWith(r) || r.startsWith(x))) return true
  }
  return false
}

export type GuidePourRecherche = { slug: string; titre: string; icone: string; modops: GuideModopIndex[] }
export type ResultatRecherche = {
  slug: string
  guideTitre: string
  icone: string
  modop: GuideModopIndex
  etape: GuideEtapeIndex | null
  ancre: string
  score: number
  couverture: number
}

type ModopPrepare = {
  titre: Set<string>
  resume: Set<string>
  texte: Set<string>
  etapes: { e: GuideEtapeIndex; titre: Set<string>; texte: Set<string> }[]
}
const cachePrepare = new WeakMap<GuideModopIndex, ModopPrepare>()

function preparerModop(m: GuideModopIndex): ModopPrepare {
  const deja = cachePrepare.get(m)
  if (deja) return deja
  const p: ModopPrepare = {
    titre: racines(m.titre),
    resume: racines(m.resume),
    texte: racines(m.texte),
    etapes: m.etapes.map((e) => ({ e, titre: racines(e.titre), texte: racines(e.texte) })),
  }
  cachePrepare.set(m, p)
  return p
}

/** Verbes génériques : comptent s'ils sont trouvés, ne pénalisent pas s'ils manquent. */
const VERBES_GENERIQUES = new Set(
  'modifier changer mettre gerer utiliser voir renseigner saisir indiquer completer remplir corriger faire avoir obtenir afficher acceder ouvrir'.split(' '),
)

type Terme = { alt: string[]; faible: boolean }

/** Termes de la question : racines + synonymes métier (chaque terme = liste d'alternatives). */
function termesQuestion(question: string): Terme[] {
  const termes: Terme[] = []
  for (const mot of normaliser(question).split(/[^a-z0-9]+/)) {
    if (mot.length < 2 || MOTS_VIDES.has(mot)) continue
    const alt = new Set<string>([racine(mot), ...(SYNONYMES[mot] ?? [])])
    termes.push({ alt: Array.from(alt), faible: VERBES_GENERIQUES.has(mot) })
  }
  return termes
}

export function rechercherModops(question: string, guides: GuidePourRecherche[], max = 8): ResultatRecherche[] {
  const termes = termesQuestion(question)
  if (!termes.length) return []
  const resultats: ResultatRecherche[] = []
  for (const g of guides) {
    const titreGuide = racines(g.titre)
    for (const m of g.modops) {
      const p = preparerModop(m)
      let score = 0
      let trouves = 0
      let attendus = 0
      for (const { alt, faible } of termes) {
        const dans = (ens: Set<string>) => alt.some((r) => contient(ens, r))
        let s = 0
        if (dans(p.titre)) s = 6
        else if (p.etapes.some((e) => dans(e.titre))) s = 3
        else if (dans(p.resume)) s = 2.5
        else if (dans(titreGuide)) s = 2
        else if (dans(p.texte) || p.etapes.some((e) => dans(e.texte))) s = 1
        if (s > 0) trouves++
        if (s > 0 || !faible) attendus++
        score += faible ? s / 2 : s
      }
      if (!trouves) continue
      const couverture = trouves / Math.max(1, attendus)
      // Étape la plus proche : titre d'étape (3) + texte (1) par terme.
      let meilleure: GuideEtapeIndex | null = null
      let meilleurScore = 0
      for (const e of p.etapes) {
        let s = 0
        for (const { alt } of termes) {
          if (alt.some((r) => contient(e.titre, r))) s += 3
          else if (alt.some((r) => contient(e.texte, r))) s += 1
        }
        if (s > meilleurScore) {
          meilleurScore = s
          meilleure = e.e
        }
      }
      // Si le titre porte toute la question (au moins 2 mots-clés), on ouvre au début du mode opératoire.
      const present = (t: Terme) =>
        t.alt.some((r) => contient(p.titre, r) || contient(p.resume, r) || contient(p.texte, r) || p.etapes.some((e) => contient(e.titre, r) || contient(e.texte, r)))
      const forts = termes.filter((t) => !t.faible && present(t))
      const titreSuffit = forts.length >= 2 && forts.every((t) => t.alt.some((r) => contient(p.titre, r)))
      const etape = !titreSuffit && meilleurScore >= 3 ? meilleure : null
      resultats.push({
        slug: g.slug,
        guideTitre: g.titre,
        icone: g.icone,
        modop: m,
        etape,
        ancre: etape?.id ?? m.id,
        score: score * (0.4 + 0.6 * couverture * couverture),
        couverture,
      })
    }
  }
  resultats.sort((a, b) => b.score - a.score)
  const top = resultats[0]?.score ?? 0
  return resultats.filter((r) => r.score >= top * 0.25).slice(0, max)
}

const ICONES: Array<[RegExp, string]> = [
  [/client|tiers|contact/, '👥'],
  [/article|produit|nomenclature/, '📦'],
  [/environnement|general|prise/, '🧭'],
  [/logisti|livraison|expedi|stock|depot/, '🚚'],
  [/opportunit|devis|preco/, '💡'],
  [/achat|fournisseur|appro/, '🛒'],
  [/factur|compta|reglement|paiement/, '💶'],
  [/vente|commande/, '🧾'],
  [/sav|hotline|intervention|parc/, '🛠️'],
  [/planning|agenda|rdv/, '📅'],
  [/admin|parametr|droit/, '⚙️'],
]

export function iconeGuide(slug: string, titre: string, icone?: string | null): string {
  if (icone && icone.trim()) return icone.trim()
  const cle = normaliser(`${slug} ${titre}`)
  return ICONES.find(([re]) => re.test(cle))?.[1] ?? '📘'
}

const DEGRADES: [string, string][] = [
  ['#2E6E66', '#173C3A'],
  ['#245A9E', '#173B6C'],
  ['#7A5EA8', '#4B3870'],
  ['#B5643A', '#7A3D1E'],
  ['#3B7D4F', '#1F4A2C'],
  ['#54459F', '#352B6B'],
  ['#8A8466', '#4F4B38'],
  ['#2F6E8E', '#1A4258'],
]

export function degradeGuide(index: number): [string, string] {
  return DEGRADES[((index % DEGRADES.length) + DEGRADES.length) % DEGRADES.length]
}
