// ============================================================================
// lib/server/hiparts.ts — Aspiration du catalogue Hitachi Hi-Parts (12/11/2026)
// ----------------------------------------------------------------------------
// Site : https://hitachi.spelog.com (Spelog, ASP.NET WebForms). Compte partagé
// fourni par Hitachi (Philippe Verges), lu dans HIPARTS_LOGIN / HIPARTS_PASSWORD.
//
// Pages utilisées (relevées le 12/11/2026) :
//   POST /Mvc/Remote/getRemoteControl  ctrlFamillePhotoList.ascx (idFamilleParent)
//                                      → sous-familles (ListeFamilles.aspx?FAMILLE_PARENT_ID=)
//                                        et listes de produits (ListeProduits.aspx?FAMILLE_ID=)
//   POST /Mvc/Remote/getRemoteControl  ctrlProductList.ascx (idFamille)
//                                      → modèles (FicheProduit.aspx?IDGAM=&IDFAM=)
//   GET  /ListSchema.aspx?IDGAM=&IDRUB= → planches (FicheSchema.aspx?IDSCG=, vignette, code, libellé)
//   GET  /FicheSchema.aspx?IDSCG=       → image /Data/Schemas/…, nomenclature (Référence,
//                                         Désignation, Repère) et hotspotsData (positions px)
//   POST /ajax/…SpelogAjaxObjects,SpelogWeb.ashx?_method=GetNomenclature
//                                       → prix unitaire HT, réf. de remplacement, stock
// Les images /Data/Schemas/… sont lisibles sans connexion : elles ne sont pas copiées.
// Parsing par expressions régulières (pas de dépendance DOM côté serveur).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export const HIPARTS_BASE = 'https://hitachi.spelog.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 CEGECLIM-compagnon'

// ── Utilitaires HTML ──────────────────────────────────────────────────────────
const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', iuml: 'ï', euml: 'ë', ugrave: 'ù', deg: '°' }

export function decoder(s: string | null | undefined): string {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m)
}

export function texte(html: string | null | undefined): string {
  return decoder(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

type Lien = { href: string; texte: string; html: string }
function liens(html: string): Lien[] {
  const out: Lien[] = []
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] || /href\s*=\s*'([^']*)'/i.exec(m[1])?.[1] || ''
    out.push({ href: decoder(href), texte: texte(m[2]), html: m[2] })
  }
  return out
}

function typeUnite(chemin: string): 'GE' | 'UI' | 'AUTRE' {
  const c = chemin.toUpperCase()
  if (c.startsWith('UNITES EXTERIEURES')) return 'GE'
  if (c.startsWith('UNITES INTERIEURES')) return 'UI'
  return 'AUTRE'
}

// ── Parseurs (fonctions pures) ─────────────────────────────────────────────────
export function parserFamilles(html: string, idParent: number) {
  const sous = new Map<number, string>()
  const listes = new Map<number, string>()
  for (const l of liens(html)) {
    let m = /FAMILLE_PARENT_ID=(-?\d+)/i.exec(l.href)
    if (m && l.texte && Number(m[1]) !== idParent && !/language=/i.test(l.href)) sous.set(Number(m[1]), l.texte)
    m = /ListeProduits\.aspx\?FAMILLE_ID=(\d+)/i.exec(l.href)
    if (m && l.texte) listes.set(Number(m[1]), l.texte)
  }
  return {
    sousFamilles: [...sous].map(([id, nom]) => ({ id, nom })),
    listesProduits: [...listes].map(([id, nom]) => ({ id, nom })),
  }
}

export function parserProduits(html: string) {
  const out = new Map<number, { idgam: number; idfam: number; nom: string }>()
  for (const l of liens(html)) {
    const m = /FicheProduit\.aspx\?IDGAM=(\d+)&IDFAM=(\d+)/i.exec(l.href)
    if (m && l.texte) out.set(Number(m[1]), { idgam: Number(m[1]), idfam: Number(m[2]), nom: l.texte })
  }
  return [...out.values()]
}

export function parserListeSchemas(html: string, idgam: number) {
  const rubrique = /planches? trouv[ée]+s? dans la rubrique\s*([^<.]*)/i.exec(decoder(html))?.[1]?.trim() || null
  const schemas: Array<{ idscg: number; image: string | null; code: string | null; libelle: string | null; ordre: number }> = []
  // une vignette = bloc « thumbnail » : lien FicheSchema + image + lblCode + lblLibelle
  const blocs = html.split(/class="thumbnail"/i).slice(1)
  blocs.forEach((b, i) => {
    const id = /FicheSchema\.aspx\?IDSCG=(\d+)/i.exec(b)?.[1]
    if (!id || schemas.some((s) => s.idscg === Number(id))) return
    schemas.push({
      idscg: Number(id),
      image: /<img[^>]*src="([^"]+)"/i.exec(b)?.[1] || null,
      code: texte(/_lblCode"[^>]*>([\s\S]*?)<\/span>/i.exec(b)?.[1]) || null,
      libelle: texte(/_lblLibelle"[^>]*>([\s\S]*?)<\/span>/i.exec(b)?.[1]) || null,
      ordre: i,
    })
  })
  // planches éventuellement listées hors vignettes
  for (const l of liens(html)) {
    const m = /FicheSchema\.aspx\?IDSCG=(\d+)/i.exec(l.href)
    if (m && !schemas.some((s) => s.idscg === Number(m[1]))) schemas.push({ idscg: Number(m[1]), image: null, code: null, libelle: null, ordre: schemas.length })
  }
  const rubriques = new Map<number, string>()
  const re = new RegExp(`ListSchema\\.aspx\\?IDGAM=${idgam}&IDRUB=(\\d+)(?!&language)`, 'i')
  for (const l of liens(html)) {
    if (/language=/i.test(l.href)) continue
    const m = re.exec(l.href)
    if (m) rubriques.set(Number(m[1]), l.texte)
  }
  return { rubrique, schemas, rubriques: [...rubriques].map(([idrub, nom]) => ({ idrub, nom })) }
}

export type LigneSchema = { ligne: number; repere: string | null; reference: string | null; designation: string | null; id_nomenclature: number | null; positions: number[][] }

export function parserSchema(html: string) {
  const titre = texte(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1])
  const image = /src="((?:https?:\/\/[^"]*)?\/Data\/Schemas\/[^"]+)"/i.exec(html)?.[1] || null
  const lignes: LigneSchema[] = []
  const reRow = /_TdRef"[\s\S]*?<div class="ClientRef">([\s\S]*?)<\/div>[\s\S]*?_TdLib"[\s\S]*?<div class="ClientRef">([\s\S]*?)<\/div>[\s\S]*?_TdRep"[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null
  while ((m = reRow.exec(html))) {
    lignes.push({ ligne: lignes.length + 1, reference: texte(m[1]) || null, designation: texte(m[2]) || null, repere: texte(m[3]) || null, id_nomenclature: null, positions: [] })
  }
  type Spot = { id: number; repere: string; x: number; y: number }
  const spots: Spot[] = []
  const brut = /hotspotsData\s*=\s*(\[[\s\S]*?\])\s*(?:;|<\/script>|\r?\n)/i.exec(html)?.[1]
  if (brut) {
    try {
      for (const s of JSON.parse(brut) as Array<{ id: string; norepere: string; position: string }>) {
        const id = /spot_(\d+)_/.exec(s.id)?.[1]
        const [x, y] = String(s.position || '').split(',').map(Number)
        if (id && Number.isFinite(x) && Number.isFinite(y)) spots.push({ id: Number(id), repere: String(s.norepere), x, y })
      }
    } catch {
      /* hotspots illisibles : nomenclature sans positions */
    }
  }
  // Rapprochement par repère ; plusieurs lignes d'un même repère se partagent les points dans l'ordre.
  const parRepere = new Map<string, Spot[]>()
  for (const s of spots) parRepere.set(s.repere, [...(parRepere.get(s.repere) || []), s])
  const dejaPris = new Map<string, number>()
  for (const l of lignes) {
    const liste = parRepere.get(String(l.repere)) || []
    if (!liste.length) continue
    const k = dejaPris.get(String(l.repere)) || 0
    const premier = liste[Math.min(k, liste.length - 1)]
    l.id_nomenclature = premier.id
    l.positions = liste.map((s) => [s.x, s.y])
    dejaPris.set(String(l.repere), k + 1)
  }
  return { titre, image, lignes }
}

/** Réponse GetNomenclature non remplie (session perdue) : marqueurs [LabelXxx.Text] restés tels quels. */
export function estGabaritVide(reponse: string) {
  return /\[Label(PUHT|Title|RefSubstitution)\.Text\]/i.test(reponse)
}

export function parserPrix(reponse: string) {
  const html = reponse.replace(/\\r\\n|\\n|\\t/g, ' ').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  const designation = texte(/id="ctl00_LabelTitle"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]) || null
  const prixTxt = texte(/class="labelpuht"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1])
  const n = prixTxt.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const prix = n && Number.isFinite(Number(n)) ? Number(n) : null
  const remplacement = texte(/id="ctl00_LabelRefSubstitution"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/i.exec(html)?.[1] || /class="LabelRefSubstitution">([^<]*)</i.exec(html)?.[1]) || null
  const stock = decoder(/id="ctl00_ImageSTOCK"[^>]*title="([^"]*)"/i.exec(html)?.[1] || /title="([^"]*)"[^>]*id="ctl00_ImageSTOCK"/i.exec(html)?.[1] || '') || null
  return { designation, prix, remplacement, stock }
}

// ── Client HTTP avec cookies et reconnexion ─────────────────────────────────────
export class HiPartsClient {
  private cookies = new Map<string, string>()
  private connecte = false

  constructor(private login: string, private motDePasse: string) {}

  private enteteCookies() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  private garderCookies(r: Response) {
    const liste = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || []
    for (const c of liste) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim())
    }
  }

  /** Requête avec suivi manuel des redirections (pour garder les cookies). */
  async requete(chemin: string, init: RequestInit = {}): Promise<{ url: string; status: number; body: string }> {
    let url = new URL(chemin, HIPARTS_BASE).toString()
    let opts: RequestInit = init
    for (let i = 0; i < 6; i++) {
      const r = await fetch(url, {
        ...opts,
        redirect: 'manual',
        headers: { 'User-Agent': UA, Cookie: this.enteteCookies(), ...(opts.headers || {}) },
        signal: AbortSignal.timeout(30000),
      })
      this.garderCookies(r)
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        url = new URL(r.headers.get('location') as string, url).toString()
        opts = { method: 'GET' }
        continue
      }
      return { url, status: r.status, body: await r.text() }
    }
    throw new Error(`Trop de redirections sur ${chemin}`)
  }

  async connecter() {
    this.cookies.clear()
    const page = await this.requete('/Login.aspx')
    const champs = new URLSearchParams()
    const reInput = /<input\b[^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = reInput.exec(page.body))) {
      const tag = m[0]
      const type = /type="([^"]*)"/i.exec(tag)?.[1]?.toLowerCase()
      const nom = /name="([^"]*)"/i.exec(tag)?.[1]
      if (!nom || type !== 'hidden') continue
      champs.set(decoder(nom), decoder(/value="([^"]*)"/i.exec(tag)?.[1] || ''))
    }
    champs.set('ctl00$LanguageChooser1$ddlLanguages', 'FR')
    champs.set('ctl00$MainContent$TAB_LOGIN$TextBoxLOGIN', this.login)
    champs.set('ctl00$MainContent$TAB_LOGIN$TextBoxPASSWORD', this.motDePasse)
    champs.set('ctl00$MainContent$TAB_LOGIN$LinkValider', 'Se connecter')
    const r = await this.requete('/Login.aspx?ReturnUrl=%2f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: champs.toString(),
    })
    if (/Login\.aspx/i.test(r.url) || /TextBoxPASSWORD/.test(r.body)) throw new Error('Connexion Hi-Parts refusée (identifiants HIPARTS_LOGIN / HIPARTS_PASSWORD ?)')
    this.connecte = true
  }

  private async assurer() {
    if (!this.connecte) await this.connecter()
  }

  /** GET d'une page ; reconnexion automatique si la session a expiré. */
  async page(chemin: string): Promise<string> {
    await this.assurer()
    let r = await this.requete(chemin)
    if (/Login\.aspx/i.test(r.url)) {
      await this.connecter()
      r = await this.requete(chemin)
    }
    if (r.status >= 400) throw new Error(`HTTP ${r.status} sur ${chemin}`)
    return r.body
  }

  async controle(fichier: string, param: string, valeur: number): Promise<string> {
    await this.assurer()
    const corps = JSON.stringify({ name: `UserControls/Navigation/${fichier}`, parametres: [{ name: 'file', value: fichier }, { name: param, value: valeur }] })
    const appel = () => this.requete('/Mvc/Remote/getRemoteControl', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: corps })
    let r = await appel()
    if (r.status >= 400 || /Login\.aspx/i.test(r.url)) {
      await this.connecter()
      r = await appel()
    }
    if (r.status >= 400) throw new Error(`HTTP ${r.status} sur ${fichier}`)
    return (JSON.parse(r.body) as { d?: string }).d || ''
  }

  async prix(idNomenclature: number): Promise<string> {
    await this.assurer()
    const appel = () =>
      this.requete('/ajax/SpelogWeb.Libraries.Core.ajax.SpelogAjaxObjects,SpelogWeb.ashx?_method=GetNomenclature&_session=r', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `idNomenclature=${idNomenclature}\r\ntypeRub=PR\r\nidIncident=0\r\nmultirepere=false`,
      })
    // (12/11/2026) Session expirée : Hi-Parts ne redirige pas, il renvoie le
    // gabarit vide « [LabelPUHT.Text] [LabelTitle.Text]… ». On se reconnecte et,
    // si le gabarit revient encore, on échoue (l'élément reste dans la file)
    // plutôt que d'enregistrer une pièce sans prix.
    const vide = (body: string) => !/labelpuht|LabelTitle/i.test(body) || estGabaritVide(body)
    let r = await appel()
    if (r.status >= 400 || /Login\.aspx/i.test(r.url) || vide(r.body)) {
      await this.connecter()
      r = await appel()
    }
    if (r.status >= 400) throw new Error(`HTTP ${r.status} sur GetNomenclature ${idNomenclature}`)
    if (estGabaritVide(r.body)) throw new Error(`Session Hi-Parts non reconnue pour le prix (nomenclature ${idNomenclature})`)
    return r.body
  }
}

// ── Traitement de la file ───────────────────────────────────────────────────────
type Element = { id: number; type: string; cle: string; payload: Record<string, unknown>; essais: number }
type Ajout = { type: string; cle: string; payload: Record<string, unknown>; priorite: number }

const PRIORITE: Record<string, number> = { FAMILLE: 1, PRODUITS: 2, PRODUIT: 3, RUBRIQUE: 3, SCHEMA: 4, PRIX: 6 }

async function ajouter(db: SupabaseClient, items: Ajout[]) {
  if (!items.length) return
  // ignoreDuplicates : un élément déjà connu garde son statut (remis à faire par la relance hebdomadaire)
  const { error } = await db.from('hiparts_file').upsert(items, { onConflict: 'type,cle', ignoreDuplicates: true })
  if (error) throw error
}

async function traiter(db: SupabaseClient, hp: HiPartsClient, el: Element, compteurs: Record<string, number>) {
  const p = el.payload
  const maintenant = new Date().toISOString()
  switch (el.type) {
    case 'FAMILLE': {
      const id = Number(p.id)
      const chemin = String(p.chemin || '')
      const { sousFamilles, listesProduits } = parserFamilles(await hp.controle('ctrlFamillePhotoList.ascx', 'idFamilleParent', id), id)
      const join = (n: string) => (chemin ? `${chemin} > ${n}` : n)
      await ajouter(db, [
        ...sousFamilles.map((f) => ({ type: 'FAMILLE', cle: String(f.id), payload: { id: f.id, chemin: join(f.nom) }, priorite: PRIORITE.FAMILLE })),
        ...listesProduits.map((f) => ({ type: 'PRODUITS', cle: String(f.id), payload: { id: f.id, chemin: join(f.nom) }, priorite: PRIORITE.PRODUITS })),
      ])
      break
    }
    case 'PRODUITS': {
      const chemin = String(p.chemin || '')
      const produits = parserProduits(await hp.controle('ctrlProductList.ascx', 'idFamille', Number(p.id)))
      if (produits.length) {
        const { error } = await db.from('hiparts_produits').upsert(
          produits.map((x) => ({ ...x, chemin, type_unite: typeUnite(chemin), maj_le: maintenant })),
          { onConflict: 'idgam' },
        )
        if (error) throw error
      }
      compteurs.produits = (compteurs.produits || 0) + produits.length
      await ajouter(db, produits.map((x) => ({ type: 'PRODUIT', cle: String(x.idgam), payload: { idgam: x.idgam, idfam: x.idfam }, priorite: PRIORITE.PRODUIT })))
      break
    }
    case 'PRODUIT':
    case 'RUBRIQUE': {
      const idgam = Number(p.idgam)
      const chemin = el.type === 'PRODUIT' ? `/FicheProduit.aspx?IDGAM=${idgam}&IDFAM=${Number(p.idfam)}` : `/ListSchema.aspx?IDGAM=${idgam}&IDRUB=${Number(p.idrub)}`
      const html = await hp.page(chemin)
      const { rubrique, schemas, rubriques } = parserListeSchemas(html, idgam)
      const idrub = el.type === 'RUBRIQUE' ? Number(p.idrub) : Number(/IDRUB=(\d+)/i.exec(html)?.[1] || 1)
      if (schemas.length) {
        const { error } = await db.from('hiparts_schemas').upsert(
          schemas.map((s) => ({
            idscg: s.idscg,
            idgam,
            idrub,
            rubrique: rubrique || (typeof p.nom === 'string' ? p.nom : null),
            code: s.code,
            libelle: s.libelle,
            image_path: s.image,
            ordre: idrub * 1000 + s.ordre,
            maj_le: maintenant,
          })),
          { onConflict: 'idscg' },
        )
        if (error) throw error
      }
      await ajouter(db, [
        ...schemas.map((s) => ({ type: 'SCHEMA', cle: String(s.idscg), payload: { idscg: s.idscg, idgam }, priorite: PRIORITE.SCHEMA })),
        ...rubriques.filter((r) => r.idrub !== idrub).map((r) => ({ type: 'RUBRIQUE', cle: `${idgam}-${r.idrub}`, payload: { idgam, idrub: r.idrub, nom: r.nom }, priorite: PRIORITE.RUBRIQUE })),
      ])
      break
    }
    case 'SCHEMA': {
      const idscg = Number(p.idscg)
      const { image, lignes } = parserSchema(await hp.page(`/FicheSchema.aspx?IDSCG=${idscg}`))
      const imagePath = image ? image.replace(/^https?:\/\/[^/]+/i, '') : null
      const { error: e1 } = await db.from('hiparts_schemas').update({ nb_pieces: lignes.length, maj_le: maintenant, ...(imagePath ? { image_path: imagePath } : {}) }).eq('idscg', idscg)
      if (e1) throw e1
      const { error: e2 } = await db.from('hiparts_schema_pieces').delete().eq('idscg', idscg)
      if (e2) throw e2
      if (lignes.length) {
        const { error: e3 } = await db.from('hiparts_schema_pieces').insert(lignes.map((l) => ({ idscg, ...l })))
        if (e3) throw e3
      }
      compteurs.schemas = (compteurs.schemas || 0) + 1
      // un prix par référence (le premier repère rencontré sert à l'interroger)
      const parRef = new Map<string, number>()
      for (const l of lignes) if (l.reference && l.id_nomenclature && !parRef.has(l.reference)) parRef.set(l.reference, l.id_nomenclature)
      await ajouter(db, [...parRef].map(([reference, idn]) => ({ type: 'PRIX', cle: reference, payload: { reference, id_nomenclature: idn }, priorite: PRIORITE.PRIX })))
      break
    }
    case 'PRIX': {
      const reference = String(p.reference)
      const idn = Number(p.id_nomenclature)
      const r = parserPrix(await hp.prix(idn))
      const { error } = await db.from('hiparts_articles').upsert(
        { reference, designation: r.designation, prix_ht: r.prix, ref_remplacement: r.remplacement, stock_info: r.stock, id_nomenclature: idn, prix_maj_le: maintenant, erreur: r.prix === null ? 'Prix non trouvé' : null },
        { onConflict: 'reference' },
      )
      if (error) throw error
      compteurs.prix = (compteurs.prix || 0) + 1
      break
    }
    default:
      throw new Error(`Type inconnu ${el.type}`)
  }
}

/** Un passage : prend des lots dans la file jusqu'à épuisement du temps imparti. */
export async function passageHiParts(db: SupabaseClient, opts: { dureeMs: number; parallelisme?: number; forcerRelance?: boolean }) {
  const login = process.env.HIPARTS_LOGIN
  const motDePasse = process.env.HIPARTS_PASSWORD
  if (!login || !motDePasse) throw new Error('Variables HIPARTS_LOGIN / HIPARTS_PASSWORD manquantes (Vercel → Settings → Environment Variables).')

  const debut = Date.now()
  const relance = await db.rpc('hiparts_relancer_si_besoin', { p_jours: 7, p_forcer: Boolean(opts.forcerRelance) })
  if (relance.error) throw relance.error

  const hp = new HiPartsClient(login, motDePasse)
  const compteurs: Record<string, number> = { traites: 0, erreurs: 0 }
  const parallelisme = Math.max(1, Math.min(opts.parallelisme || 4, 8))

  while (Date.now() - debut < opts.dureeMs) {
    const { data, error } = await db.rpc('hiparts_prendre_lot', { p_n: parallelisme * 6 })
    if (error) throw error
    const lot = (data || []) as Element[]
    if (!lot.length) break
    let i = 0
    const travailleur = async () => {
      while (i < lot.length) {
        const el = lot[i++]
        if (Date.now() - debut > opts.dureeMs + 20000) {
          await db.from('hiparts_file').update({ statut: 'A_FAIRE', verrou_jusqua: null, essais: Math.max(0, el.essais - 1) }).eq('id', el.id)
          continue
        }
        try {
          await traiter(db, hp, el, compteurs)
          await db.from('hiparts_file').update({ statut: 'FAIT', traite_le: new Date().toISOString(), erreur: null, verrou_jusqua: null }).eq('id', el.id)
          compteurs.traites++
        } catch (e) {
          compteurs.erreurs++
          const msg = e instanceof Error ? e.message : String(e)
          if (/Connexion Hi-Parts refusée|HIPARTS_/.test(msg)) throw e
          await db
            .from('hiparts_file')
            .update({ statut: el.essais >= 3 ? 'ERREUR' : 'A_FAIRE', erreur: msg.slice(0, 500), verrou_jusqua: null, traite_le: new Date().toISOString() })
            .eq('id', el.id)
        }
      }
    }
    await Promise.all(Array.from({ length: parallelisme }, travailleur))
  }

  const message = `${compteurs.traites} élément(s) traité(s), ${compteurs.erreurs} erreur(s) — ${compteurs.produits || 0} modèles, ${compteurs.schemas || 0} vues, ${compteurs.prix || 0} prix`
  await db.from('hiparts_sync_etat').update({ dernier_passage: new Date().toISOString(), dernier_message: message }).eq('id', 1)
  return { relance: relance.data, ...compteurs, message, dureeMs: Date.now() - debut }
}

/**
 * (12/11/2026) Copie immédiate d'un modèle à la demande de la console : sans
 * attendre la file, traite tout de suite ce qui reste à copier pour ce modèle
 * (fiche produit, rubriques, vues éclatées, puis prix des pièces de ses vues).
 * Les éléments sont réservés atomiquement (RPC hiparts_reserver) pour ne pas
 * être traités en même temps par le cron, puis marqués FAIT comme par lui.
 */
export async function copierModeleHiParts(db: SupabaseClient, idgam: number, opts: { dureeMs?: number; parallelisme?: number } = {}) {
  const login = process.env.HIPARTS_LOGIN
  const motDePasse = process.env.HIPARTS_PASSWORD
  if (!login || !motDePasse) throw new Error('Variables HIPARTS_LOGIN / HIPARTS_PASSWORD manquantes (Vercel → Settings → Environment Variables).')
  const debut = Date.now()
  const dureeMs = opts.dureeMs ?? 50_000
  const parallelisme = Math.max(1, Math.min(opts.parallelisme || 4, 6))
  const hp = new HiPartsClient(login, motDePasse)
  const compteurs: Record<string, number> = { traites: 0, erreurs: 0 }

  async function executer(lot: Element[]) {
    let i = 0
    const travailleur = async () => {
      while (i < lot.length) {
        const el = lot[i++]
        if (Date.now() - debut > dureeMs) {
          // plus de temps : rendu à la file, le cron le reprendra
          await db.from('hiparts_file').update({ statut: 'A_FAIRE', verrou_jusqua: null }).eq('id', el.id)
          continue
        }
        try {
          await traiter(db, hp, el, compteurs)
          await db.from('hiparts_file').update({ statut: 'FAIT', traite_le: new Date().toISOString(), erreur: null, verrou_jusqua: null }).eq('id', el.id)
          compteurs.traites++
        } catch (e) {
          compteurs.erreurs++
          const msg = e instanceof Error ? e.message : String(e)
          await db.from('hiparts_file').update({ statut: 'A_FAIRE', erreur: msg.slice(0, 500), verrou_jusqua: null }).eq('id', el.id)
          if (/Connexion Hi-Parts refusée|HIPARTS_/.test(msg)) throw e
        }
      }
    }
    await Promise.all(Array.from({ length: parallelisme }, travailleur))
  }

  async function prendre(filtre: string, limite = 60): Promise<Element[]> {
    const { data, error } = await db.from('hiparts_file').select('id').or(filtre).neq('statut', 'FAIT').order('priorite').limit(limite)
    if (error) throw error
    const ids = (data || []).map((r: { id: number }) => r.id)
    if (!ids.length) return []
    const res = await db.rpc('hiparts_reserver', { p_ids: ids })
    if (res.error) throw res.error
    return (res.data || []) as Element[]
  }

  // 1. fiche produit, rubriques et vues du modèle (les vues découvertes à un tour sont reprises au suivant)
  const filtreModele = `and(type.eq.PRODUIT,cle.eq.${idgam}),and(type.eq.RUBRIQUE,payload->>idgam.eq.${idgam}),and(type.eq.SCHEMA,payload->>idgam.eq.${idgam})`
  for (let tour = 0; tour < 4 && Date.now() - debut < dureeMs; tour++) {
    const lot = await prendre(filtreModele)
    if (!lot.length) break
    await executer(lot)
  }

  // 2. prix des pièces des vues du modèle
  if (Date.now() - debut < dureeMs) {
    const { data: schemas } = await db.from('hiparts_schemas').select('idscg').eq('idgam', idgam)
    const ids = (schemas || []).map((s: { idscg: number }) => s.idscg)
    if (ids.length) {
      const { data: refs } = await db.from('hiparts_schema_pieces').select('reference').in('idscg', ids).not('reference', 'is', null)
      const references = Array.from(new Set((refs || []).map((r: { reference: string }) => r.reference))).slice(0, 300)
      for (let k = 0; k < references.length && Date.now() - debut < dureeMs; k += 60) {
        const tranche = references.slice(k, k + 60).map((r) => `"${String(r).replace(/[",()]/g, '')}"`).join(',')
        const lot = await prendre(`and(type.eq.PRIX,cle.in.(${tranche}))`, 60)
        if (lot.length) await executer(lot)
      }
    }
  }

  return { idgam, ...compteurs, dureeMs: Date.now() - debut }
}
