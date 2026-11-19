'use client'

/**
 * Écran « Contrôle stock FMS — SAGE ↔ MyStock » (Stocks & logistique, /stock/controle-mystock?id=).
 * ---------------------------------------------------------------------------------------------
 * Créé le 12/11/2026, droit can_appro. Version 2 le 19/11/2026.
 *
 * 1. Image MyStock : fichier (Référence + Quantité physique) et HEURE de l'image (lue dans le nom
 *    « STOCK_FMS_121126_8h48 »). Le stock SAGE comparé est la dernière photo SAGE quotidienne prise
 *    avant cette heure (stock_depot_snapshot_journalier, import SAGE ≈ 23h05) : stock réel du dépôt
 *    FMS, PL comprises.
 * 2. Mouvements MyStock à la ligne (bouton « Mouvements MyStock ») : fichier des préparations /
 *    expéditions (reporting_commandes : N° commande = BL SAGE ou transfert 28xxx) et fichier des
 *    réceptions (reporting_arrivages, retours d'agences compris). Réimporter met à jour sans doublon.
 * 3. Rapprochement (lib/mystockRapprochement.ts) : chaque référence en écart est classée
 *      - « expliqué à coup sûr » : décalages prouvés par les deux systèmes (BL SAGE expédié par FMS
 *        après l'image, BL daté après J mais expédié avant, retour d'agence encore en TRANSIT FMS,
 *        réception ou transfert enregistré dans SAGE dans les 3 jours avec la même quantité) ;
 *      - « à valider » : il faut une ou plusieurs hypothèses (BL jamais expédié par FMS → dépôt à
 *        vérifier, préparé avant l'image, BL sur un dépôt d'agence expédié par FMS, transfert ou
 *        réception non retrouvé dans SAGE, unité différente…) qui ensemble expliquent exactement l'écart ;
 *      - « sans explication » : reste un résidu, les pistes sont affichées.
 * 4. Fiche d'une référence : explications retenues, pistes, BL SAGE et mouvements MyStock,
 *    suivi (à analyser / expliqué / corrigé + commentaire). Export Excel.
 *
 * SQL : 20261112a_stock_depot_snapshot_journalier.sql, 20261112b_controle_stock_mystock.sql,
 *       20261119a_controle_mystock_mouvements.sql (RPC mystock_*).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import {
  analyserRapprochement, resumerRapprochement, fmtDateHeureCourt,
  type Analyse, type DonneesRapprochement, type Explication, type Groupe, type LigneBase, type ResumeRapprochement,
} from '@/lib/mystockRapprochement'
import {
  CHAMPS_OBLIGATOIRES, LIBELLES_CHAMPS, detecterColonnesMouvement, detecterEnteteMouvement, heureImageDepuisTexte, lireMouvements,
  type ChampMouvement, type ColonnesMouvement, type TypeMouvement,
} from '@/lib/mystockImport'

type Suivi = 'a_analyser' | 'explique' | 'corrige'
type ResumeListe = Partial<ResumeRapprochement> & { nb_ecart?: number; nb_absent_mystock?: number; nb_absent_sage?: number; valeur_ecart_abs?: number }
type ControleListe = {
  id: number; date_image: string; heure_image: string | null; depot_num: string; fichier_nom: string | null; nb_lignes_fichier: number | null
  cree_le: string; cree_par: string | null; resume: ResumeListe | null; photo_disponible: boolean
}
type Photo = { date_stock: string; loaded_at: string }
type Couverture = { types: Partial<Record<TypeMouvement, { lignes: number; date_min: string; date_max: string; documents: number }>>; imports: Array<{ id: number; type: TypeMouvement; fichier_nom: string; nb_lignes: number; nb_nouvelles: number; nb_maj: number; date_min: string; date_max: string; cree_le: string; cree_par: string | null }> }
type Donnees = DonneesRapprochement & { resume: Record<string, number>; controle: DonneesRapprochement['controle'] & { colonne_reference: string | null; colonne_quantite: string | null; nb_lignes_fichier: number | null } }

type FichierStock = {
  nom: string; feuilles: string[]; feuille: string; matrice: unknown[][]; ligneEntete: number
  colRef: number; colQte: number; colDes: number; heure: string
}
type FichierMvt = {
  type: TypeMouvement; nom: string; matrice: unknown[][]; ligneEntete: number; colonnes: ColonnesMouvement
}

const GROUPES: Record<Groupe, { libelle: string; court: string; bg: string; fg: string }> = {
  inexplique: { libelle: 'Sans explication', court: 'Sans explication', bg: '#FBE4DD', fg: '#A3401C' },
  avalider:   { libelle: 'Explication à valider', court: 'À valider', bg: '#FCEFD9', fg: '#96600F' },
  sur:        { libelle: 'Expliqué à coup sûr', court: 'Expliqué', bg: '#E4EEF8', fg: '#2D5F8C' },
  ok:         { libelle: 'Identique', court: 'Identique', bg: '#E9F5EA', fg: '#2F6F33' },
}
const SUIVIS: Record<Suivi, string> = { a_analyser: 'À analyser', explique: 'Expliqué', corrige: 'Corrigé' }
const TYPES_MVT: Record<TypeMouvement, { titre: string; aide: string }> = {
  expedition: { titre: 'Préparations / expéditions', aide: 'reporting_commandes à la ligne : N° commande (BL SAGE ou transfert 28xxx), Référence, Quantité, date' },
  reception: { titre: 'Réceptions', aide: 'reporting_arrivages à la ligne : N° réception, Nom, Retour, Référence, Quantité, Date de validation' },
}

const n0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const fmtQte = (v: number | null | undefined) => v === null || v === undefined ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v)
const fmtEuro = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
const fmtDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '—'
const fmtDateHeure = (d: string | null | undefined) => d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const signe = (v: number) => (v > 0 ? `+${fmtQte(v)}` : fmtQte(v))

function messageErreur(e: unknown): string {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'string') return e
  const o = e as { message?: string; details?: string }
  return o.message || o.details || JSON.stringify(e)
}

/** « AAAA-MM-JJTHH:MM » (heure de Paris saisie) → instant ISO. Paris = UTC+1 en hiver, +2 en été. */
function parisVersIso(local: string): string {
  const essai = new Date(`${local}:00Z`)
  const decalage = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(d)
    return (Number(p) - d.getUTCHours() + 24) % 24
  }
  return new Date(essai.getTime() - decalage(essai) * 3600000).toISOString()
}

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/\s| | /g, '').replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}
const MOTS_REF = ['reference article', 'ref article', 'code article', 'reference', 'ref', 'article', 'sku', 'code produit', 'produit', 'code']
const MOTS_QTE = ['quantite physique', 'stock physique', 'qte physique', 'stock reel', 'stock total', 'qte en stock', 'quantite en stock', 'stock', 'quantite', 'qte', 'qty', 'disponible', 'dispo']
const MOTS_DES = ['designation', 'libelle', 'description', 'desc']
function trouverColonne(entetes: string[], mots: string[], exclure: number[] = []): number {
  for (const mot of mots) { const i = entetes.findIndex((h, idx) => !exclure.includes(idx) && h === norm(mot)); if (i >= 0) return i }
  for (const mot of mots) { const i = entetes.findIndex((h, idx) => !exclure.includes(idx) && h.includes(norm(mot))); if (i >= 0) return i }
  return -1
}
function detecterEntete(matrice: unknown[][]): number {
  for (let i = 0; i < Math.min(20, matrice.length); i++) {
    const h = (matrice[i] || []).map(norm)
    if (trouverColonne(h, MOTS_REF) >= 0 && trouverColonne(h, MOTS_QTE) >= 0) return i
  }
  return 0
}
function lignesStock(f: FichierStock) {
  const agg = new Map<string, { reference: string; designation: string | null; qte: number; nb: number }>()
  let nbLues = 0, nbQteInvalide = 0
  for (const row of f.matrice.slice(f.ligneEntete + 1)) {
    const r = row as unknown[]
    const ref = String(r?.[f.colRef] ?? '').trim().toUpperCase()
    if (!ref) continue
    const q = nombre(r?.[f.colQte])
    if (q === null) nbQteInvalide += 1
    nbLues += 1
    const des = f.colDes >= 0 ? (String(r?.[f.colDes] ?? '').trim() || null) : null
    const cur = agg.get(ref)
    if (cur) { cur.qte += q ?? 0; cur.nb += 1; if (!cur.designation && des) cur.designation = des }
    else agg.set(ref, { reference: ref, designation: des, qte: q ?? 0, nb: 1 })
  }
  const lignes = Array.from(agg.values())
  return { lignes, nbLues, nbQteInvalide, total: lignes.reduce((s, l) => s + l.qte, 0) }
}

async function lireMatrice(file: File, feuille?: string) {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const nom = feuille && wb.SheetNames.includes(feuille) ? feuille : wb.SheetNames[0]
  const matrice: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null })
  return { feuilles: wb.SheetNames as string[], feuille: nom, matrice }
}

function Kpi({ label, value, sub, tone, onClick, actif }: { label: string; value: string; sub?: string; tone?: 'alerte' | 'warn' | 'ok' | 'info'; onClick?: () => void; actif?: boolean }) {
  const color = tone === 'alerte' ? '#A3401C' : tone === 'warn' ? '#96600F' : tone === 'ok' ? '#2F6F33' : tone === 'info' ? '#2D5F8C' : '#111820'
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`min-w-0 rounded-xl border bg-white px-3 py-2 text-left ${actif ? 'border-[#111820] ring-1 ring-[#111820]' : 'border-[#E5E1D8]'} ${onClick ? 'hover:border-[#B4761A]' : 'cursor-default'}`}>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[20px] font-bold leading-7 tracking-tight" style={{ color }}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[#8A8474]">{sub}</div>}
    </button>
  )
}
function Badge({ groupe }: { groupe: Groupe }) {
  const g = GROUPES[groupe]
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: g.bg, color: g.fg }}>{g.court}</span>
}
function LigneExplication({ e }: { e: Explication }) {
  return (
    <li className="flex items-start gap-2 border-t border-[#EFECE5] py-1.5 text-[12.5px]">
      <span className={`mt-0.5 shrink-0 rounded-full px-1.5 text-[10px] font-bold ${e.niveau === 'sur' ? 'bg-[#E4EEF8] text-[#2D5F8C]' : 'bg-[#FCEFD9] text-[#96600F]'}`}>{e.niveau === 'sur' ? 'Sûr' : 'À valider'}</span>
      <span className="min-w-0 flex-1">{e.libelle}</span>
      <span className={`shrink-0 font-bold ${e.qte > 0 ? 'text-[#2D5F8C]' : 'text-[#A3401C]'}`}>{signe(e.qte)}</span>
    </li>
  )
}

/** Résumé court des explications d'une référence pour la colonne du tableau. */
function resumeExplications(a: Analyse | undefined): string {
  if (!a || a.groupe === 'ok') return ''
  const lib: Record<string, string> = {
    expedie_apres: 'BL expédié après l’image', pas_encore_expedie: 'BL pas encore expédié', expedie_avant_bl: 'expédié avant le BL SAGE',
    retour_transit: 'retour en TRANSIT FMS', reception_sage_tard: 'réception SAGE après J', transfert_sage_tard: 'transfert SAGE après J',
    jamais_expedie: 'BL jamais expédié par FMS', prepare_avant: 'préparé avant l’image', depot_agence: 'BL sur dépôt agence',
    bl_sans_ligne: 'référence absente du BL SAGE', retour: 'retour non entré', reception_non_vue: 'réception non vue dans SAGE',
    transfert_avant: 'transfert non vu dans SAGE', transfert_apres: 'transfert après l’image', reception_sage_avance: 'réception SAGE en avance',
    qte_differente: 'quantité BL différente', bl_recents: 'BL récents non expédiés', hors_fichier: 'BL antérieur au fichier', unite: 'unité différente',
  }
  const parCode = new Map<string, { n: number; q: number }>()
  for (const e of a.explications) { const c = parCode.get(e.code) || { n: 0, q: 0 }; c.n++; c.q += e.qte; parCode.set(e.code, c) }
  const parts = [...parCode.entries()].sort((x, y) => Math.abs(y[1].q) - Math.abs(x[1].q)).map(([c, v]) => `${lib[c] || c}${v.n > 1 ? ` ×${v.n}` : ''} (${signe(v.q)})`)
  if (a.groupe === 'inexplique') parts.push(`reste ${signe(a.residu)}`)
  return parts.join(' · ')
}

async function exporterExcel(d: Donnees, analyses: Map<string, Analyse>) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  const qte = '#,##0.##;[Red]-#,##0.##'
  const euro = '#,##0.00 "€";[Red]-#,##0.00 "€"'
  const ws = wb.addWorksheet('Écarts')
  ws.columns = [
    { header: 'Référence', key: 'reference', width: 22 },
    { header: 'Désignation', key: 'designation', width: 40 },
    { header: 'Classement', key: 'groupe', width: 20 },
    { header: 'MyStock', key: 'my', width: 10, style: { numFmt: qte } },
    { header: `SAGE fin ${fmtDate(d.controle.date_image)}`, key: 'sage', width: 11, style: { numFmt: qte } },
    { header: 'Écart', key: 'ecart', width: 9, style: { numFmt: qte } },
    { header: 'Valeur écart', key: 'val', width: 12, style: { numFmt: euro } },
    { header: 'Reste inexpliqué', key: 'residu', width: 10, style: { numFmt: qte } },
    { header: 'Explications retenues', key: 'expl', width: 110 },
    { header: 'Pistes', key: 'pistes', width: 80 },
    { header: 'Suivi', key: 'suivi', width: 12 },
    { header: 'Commentaire', key: 'com', width: 40 },
  ]
  const ordre: Groupe[] = ['inexplique', 'avalider', 'sur', 'ok']
  const lignes = d.lignes.filter((l) => n0(l.ecart) !== 0).sort((a, b) => ordre.indexOf(analyses.get(a.reference)?.groupe ?? 'ok') - ordre.indexOf(analyses.get(b.reference)?.groupe ?? 'ok') || Math.abs(n0(b.ecart_valeur)) - Math.abs(n0(a.ecart_valeur)))
  for (const l of lignes) {
    const a = analyses.get(l.reference)
    ws.addRow({
      reference: l.reference, designation: l.designation, groupe: GROUPES[a?.groupe ?? 'ok'].libelle,
      my: l.qte_mystock, sage: n0(l.qte_sage), ecart: n0(l.ecart), val: n0(l.ecart_valeur), residu: a?.residu || null,
      expl: (a?.explications || []).map((e) => `[${e.niveau === 'sur' ? 'sûr' : 'à valider'}] ${signe(e.qte)} ${e.libelle}`).join('\n'),
      pistes: a?.groupe === 'inexplique' ? (a.pistes || []).slice(0, 8).map((e) => `${signe(e.qte)} ${e.libelle}`).join('\n') : '',
      suivi: SUIVIS[l.suivi_statut || 'a_analyser'], com: l.suivi_commentaire,
    })
  }
  ws.getColumn('expl').alignment = { wrapText: true, vertical: 'top' }
  ws.getColumn('pistes').alignment = { wrapText: true, vertical: 'top' }
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `controle_mystock_fms_${d.controle.date_image}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function ControleMyStock() {
  const router = useRouter()
  const params = useSearchParams()
  const idUrl = params.get('id')

  const [liste, setListe] = useState<ControleListe[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [couverture, setCouverture] = useState<Couverture | null>(null)
  const [donnees, setDonnees] = useState<Donnees | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [refuse, setRefuse] = useState(false)

  const [panneau, setPanneau] = useState<'aucun' | 'image' | 'mouvements'>('aucun')
  const [fichier, setFichier] = useState<FichierStock | null>(null)
  const [fichierBrut, setFichierBrut] = useState<File | null>(null)
  const [fichiersMvt, setFichiersMvt] = useState<Partial<Record<TypeMouvement, FichierMvt>>>({})

  const [filtre, setFiltre] = useState<'ecarts' | Groupe | 'tous'>('inexplique')
  const [filtreSuivi, setFiltreSuivi] = useState<'tous' | Suivi>('tous')
  const [recherche, setRecherche] = useState('')
  const [fiche, setFiche] = useState<LigneBase | null>(null)
  const [annot, setAnnot] = useState<{ statut: Suivi; commentaire: string }>({ statut: 'a_analyser', commentaire: '' })

  const chargerListe = useCallback(async () => {
    const [l, c] = await Promise.all([supabase.rpc('mystock_controles_liste'), supabase.rpc('mystock_mouvements_couverture')])
    if (l.error) {
      if (/Accès refusé/i.test(l.error.message)) setRefuse(true)
      else setErreur(messageErreur(l.error))
      return
    }
    const d = l.data as { controles: ControleListe[]; photos: Photo[] }
    setListe(d.controles || [])
    setPhotos(d.photos || [])
    if (!c.error) setCouverture(c.data as Couverture)
    if (!idUrl && (d.controles || []).length === 0) setPanneau('image')
  }, [idUrl])

  const chargerDonnees = useCallback(async (id: number) => {
    setOccupe('resultat'); setErreur(null)
    const { data, error } = await supabase.rpc('mystock_controle_donnees', { p_id: id })
    setOccupe(null)
    if (error) { setErreur(messageErreur(error)); return }
    setDonnees(data as Donnees)
  }, [])

  useEffect(() => { void chargerListe() }, [chargerListe])
  useEffect(() => {
    if (idUrl) void chargerDonnees(Number(idUrl))
    else setDonnees(null)
  }, [idUrl, chargerDonnees])

  const analyses = useMemo(() => (donnees ? analyserRapprochement(donnees) : new Map<string, Analyse>()), [donnees])
  const resume = useMemo(() => (donnees ? resumerRapprochement(donnees, analyses) : null), [donnees, analyses])

  // Le classement est calculé dans le navigateur : on l'enregistre pour la liste des contrôles.
  useEffect(() => {
    if (!donnees || !resume) return
    const id = donnees.controle.id
    const existant = liste.find((c) => c.id === id)?.resume
    if (existant && existant.v2 && existant.nb_sur === resume.nb_sur && existant.nb_avalider === resume.nb_avalider && existant.nb_inexplique === resume.nb_inexplique) return
    void supabase.rpc('mystock_controle_enregistrer_resume', { p_id: id, p_resume: resume }).then(({ error }) => {
      if (!error) setListe((ls) => ls.map((c) => (c.id === id ? { ...c, resume: { ...(c.resume || {}), ...resume } } : c)))
    })
  }, [donnees, resume, liste])

  const ouvrir = (id: number | null) => {
    setFiche(null)
    router.replace(id ? `/stock/controle-mystock?id=${id}` : '/stock/controle-mystock')
  }

  // ---- Image MyStock --------------------------------------------------------------------------
  const deposerImage = async (file: File, feuille?: string) => {
    setErreur(null); setOccupe('lecture')
    try {
      const { feuilles, feuille: f, matrice } = await lireMatrice(file, feuille)
      if (!matrice.length) throw new Error('Le fichier est vide.')
      const ligneEntete = detecterEntete(matrice)
      const h = (matrice[ligneEntete] || []).map(norm)
      const colRef = trouverColonne(h, MOTS_REF)
      const colQte = trouverColonne(h, MOTS_QTE, [colRef])
      const colDes = trouverColonne(h, MOTS_DES, [colRef, colQte])
      const enteteQte = colQte >= 0 ? String((matrice[ligneEntete] || [])[colQte] ?? '') : ''
      const heure = (fichier && feuille ? fichier.heure : null) || heureImageDepuisTexte(file.name) || heureImageDepuisTexte(enteteQte) || ''
      setFichierBrut(file)
      setFichier({ nom: file.name, feuilles, feuille: f, matrice, ligneEntete, colRef, colQte, colDes, heure })
    } catch (e) {
      setErreur(`Lecture du fichier impossible : ${messageErreur(e)}`)
    } finally {
      setOccupe(null)
    }
  }
  const apercu = useMemo(() => (fichier && fichier.colRef >= 0 && fichier.colQte >= 0 ? lignesStock(fichier) : null), [fichier])
  const entetes = useMemo(() => (fichier ? (fichier.matrice[fichier.ligneEntete] || []).map((h, i) => String(h ?? '').trim() || `Colonne ${i + 1}`) : []), [fichier])
  const photoRetenue = useMemo(() => {
    if (!fichier?.heure) return null
    const t = new Date(parisVersIso(fichier.heure)).getTime()
    return photos.filter((p) => new Date(p.loaded_at).getTime() < t).sort((a, b) => b.date_stock.localeCompare(a.date_stock))[0] || null
  }, [fichier, photos])

  const lancer = async () => {
    if (!fichier || !apercu || !fichier.heure) return
    setOccupe('creation'); setErreur(null)
    const { data, error } = await supabase.rpc('mystock_controle_creer', {
      p_date_image: photoRetenue?.date_stock ?? null,
      p_fichier: fichier.nom,
      p_col_reference: entetes[fichier.colRef],
      p_col_quantite: entetes[fichier.colQte],
      p_nb_lignes_fichier: apercu.nbLues,
      p_lignes: apercu.lignes.map((l) => ({ reference: l.reference, designation: l.designation, qte: l.qte, nb: l.nb })),
      p_depot_num: '3',
      p_heure_image: parisVersIso(fichier.heure),
    })
    setOccupe(null)
    if (error) { setErreur(messageErreur(error)); return }
    const r = data as { controle: { id: number } }
    setFichier(null); setFichierBrut(null); setPanneau('aucun')
    setFiltre('inexplique')
    await chargerListe()
    ouvrir(r.controle.id)
  }

  // ---- Mouvements MyStock ---------------------------------------------------------------------
  const deposerMvt = async (type: TypeMouvement, file: File) => {
    setErreur(null); setInfo(null); setOccupe(`lecture-${type}`)
    try {
      const { matrice } = await lireMatrice(file)
      const ligneEntete = detecterEnteteMouvement(matrice, type)
      const colonnes = detecterColonnesMouvement(matrice[ligneEntete] || [], type)
      setFichiersMvt((f) => ({ ...f, [type]: { type, nom: file.name, matrice, ligneEntete, colonnes } }))
    } catch (e) {
      setErreur(`Lecture du fichier impossible : ${messageErreur(e)}`)
    } finally {
      setOccupe(null)
    }
  }
  const apercusMvt = useMemo(() => {
    const out: Partial<Record<TypeMouvement, ReturnType<typeof lireMouvements>>> = {}
    for (const t of ['expedition', 'reception'] as TypeMouvement[]) {
      const f = fichiersMvt[t]
      if (f && CHAMPS_OBLIGATOIRES.every((c) => f.colonnes[c] >= 0)) out[t] = lireMouvements(f.matrice, f.ligneEntete, f.colonnes)
    }
    return out
  }, [fichiersMvt])

  const importerMvt = async (type: TypeMouvement) => {
    const f = fichiersMvt[type]; const a = apercusMvt[type]
    if (!f || !a || !a.lignes.length) return
    setOccupe(`import-${type}`); setErreur(null); setInfo(null)
    let nouvelles = 0, maj = 0
    for (let i = 0; i < a.lignes.length; i += 1500) {
      const { data, error } = await supabase.rpc('mystock_mouvements_importer', { p_type: type, p_fichier: f.nom, p_lignes: a.lignes.slice(i, i + 1500) })
      if (error) { setOccupe(null); setErreur(messageErreur(error)); return }
      const r = data as { nouvelles: number; maj: number }
      nouvelles += r.nouvelles; maj += r.maj
    }
    setOccupe(null)
    setInfo(`${TYPES_MVT[type].titre} : ${nouvelles.toLocaleString('fr-FR')} ligne(s) ajoutée(s), ${maj.toLocaleString('fr-FR')} mise(s) à jour.`)
    setFichiersMvt((x) => ({ ...x, [type]: undefined }))
    await chargerListe()
    if (donnees) await chargerDonnees(donnees.controle.id)
  }

  // ---- Suivi ----------------------------------------------------------------------------------
  const ouvrirFiche = (l: LigneBase) => {
    setFiche(l)
    setAnnot({ statut: (l.suivi_statut as Suivi) || 'a_analyser', commentaire: l.suivi_commentaire || '' })
  }
  const lignesFiltrees = useMemo(() => {
    if (!donnees) return []
    const q = recherche.trim().toUpperCase()
    const ordre: Groupe[] = ['inexplique', 'avalider', 'sur', 'ok']
    return donnees.lignes.filter((l) => {
      const g = analyses.get(l.reference)?.groupe ?? 'ok'
      if (filtre === 'ecarts' && g === 'ok') return false
      if (filtre !== 'ecarts' && filtre !== 'tous' && g !== filtre) return false
      if (filtreSuivi !== 'tous' && (l.suivi_statut || 'a_analyser') !== filtreSuivi) return false
      if (q && !`${l.reference} ${l.designation || ''} ${l.famille || ''}`.toUpperCase().includes(q)) return false
      return true
    }).sort((a, b) => ordre.indexOf(analyses.get(a.reference)?.groupe ?? 'ok') - ordre.indexOf(analyses.get(b.reference)?.groupe ?? 'ok')
      || Math.abs(n0(b.ecart_valeur)) - Math.abs(n0(a.ecart_valeur)) || a.reference.localeCompare(b.reference))
  }, [donnees, analyses, filtre, filtreSuivi, recherche])

  const enregistrerAnnotation = async (suivant: boolean) => {
    if (!donnees || !fiche) return
    setOccupe('annotation')
    const { error } = await supabase.rpc('mystock_controle_annoter', {
      p_id: donnees.controle.id, p_reference: fiche.reference, p_statut: annot.statut, p_commentaire: annot.commentaire,
    })
    setOccupe(null)
    if (error) { setErreur(messageErreur(error)); return }
    const maj: LigneBase = { ...fiche, suivi_statut: annot.statut, suivi_commentaire: annot.commentaire.trim() || null, suivi_le: new Date().toISOString() }
    setDonnees((d) => (d ? { ...d, lignes: d.lignes.map((x) => (x.reference === fiche.reference ? maj : x)) } : d))
    if (suivant) {
      const idx = lignesFiltrees.findIndex((x) => x.reference === fiche.reference)
      const next = lignesFiltrees[idx + 1]
      if (next) ouvrirFiche(next); else setFiche(null)
    } else setFiche(maj)
  }

  const ctl = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-2.5 text-[13px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const btn = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12.5px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-40'
  const btnNoir = 'h-9 rounded-lg bg-[#111820] px-3 text-[12.5px] font-bold text-white disabled:opacity-40'
  const lab = 'text-[11px] font-bold uppercase tracking-wide text-[#8A8474]'

  if (refuse) {
    return (
      <main className="min-h-screen bg-[#F4F3F0] p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-[#E5E1D8] bg-white p-5 text-[14px]">
          Le contrôle du stock FMS avec MyStock est réservé aux utilisateurs ayant le droit « Appro ».
        </div>
      </main>
    )
  }

  // Couverture des mouvements par rapport à l'heure de l'image du contrôle ouvert
  const T = donnees?.controle.heure_image ? new Date(donnees.controle.heure_image) : null
  const covExp = donnees?.couverture?.expedition
  const covRec = donnees?.couverture?.reception
  const expOk = !!(covExp && T && new Date(covExp.date_max) >= T && new Date(covExp.date_min).getTime() <= T.getTime() - 2 * 86400000)
  const recOk = !!(covRec && T && new Date(covRec.date_max) >= T)

  const pastille = (cle: typeof filtre, label: string, nb: number | undefined) => (
    <button type="button" onClick={() => setFiltre(cle)}
      className={`rounded-full border px-3 py-1 text-[12px] font-bold ${filtre === cle ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:border-[#B4761A]'}`}>
      {label} <span className="opacity-70">{nb ?? 0}</span>
    </button>
  )

  const zoneDepot = (texte: string, sous: string, onFile: (f: File) => void, actif: boolean) => (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center ${actif ? 'border-[#B4761A] bg-[#FCF6EC]' : 'border-[#D8D3C7] bg-[#FAF9F6]'}`}>
      <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      <span className="text-[13.5px] font-bold">{texte}</span>
      <span className="mt-1 text-[11.5px] text-[#8A8474]">{sous}</span>
    </label>
  )

  const analyseFiche = fiche ? analyses.get(fiche.reference) : undefined

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · Appro</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Contrôle stock FMS — SAGE ↔ MyStock</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              L’image MyStock est comparée au stock réel SAGE du dépôt FMS (PL comprises) de la dernière photo SAGE prise avant l’heure de l’image ; les écarts sont expliqués par les mouvements SAGE et MyStock.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {liste.length > 0 && (
              <select value={donnees?.controle.id ?? idUrl ?? ''} onChange={(e) => ouvrir(e.target.value ? Number(e.target.value) : null)} className={`${ctl} h-10 max-w-[380px] font-bold`}>
                <option value="">— Contrôles enregistrés —</option>
                {liste.map((c) => (
                  <option key={c.id} value={c.id}>
                    Image du {c.heure_image ? fmtDateHeure(c.heure_image) : fmtDate(c.date_image)} · {c.resume?.v2 ? `${c.resume.nb_inexplique} sans explication` : ''} · {c.fichier_nom || ''}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={`${panneau === 'image' ? btnNoir : btn} h-10`} onClick={() => setPanneau((p) => (p === 'image' ? 'aucun' : 'image'))}>+ Image MyStock</button>
            <button type="button" className={`${panneau === 'mouvements' ? btnNoir : btn} h-10`} onClick={() => setPanneau((p) => (p === 'mouvements' ? 'aucun' : 'mouvements'))}>⇅ Mouvements MyStock</button>
            {donnees && <button type="button" className={`${btn} h-10`} onClick={() => void exporterExcel(donnees, analyses)}>⬇ Excel</button>}
            {donnees && <button type="button" className={`${btn} h-10`} title="Recalculer" onClick={() => void chargerDonnees(donnees.controle.id)}>↻</button>}
          </div>
        </section>

        {erreur && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-semibold text-red-800">{erreur}</div>}
        {info && <div className="rounded-xl border border-[#CFE3D0] bg-[#E9F5EA] px-4 py-2.5 text-[13px] font-semibold text-[#2F6F33]">{info}</div>}

        {/* Image MyStock */}
        {panneau === 'image' && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <h2 className="text-[15px] font-bold">Nouveau contrôle — image de stock MyStock</h2>
            <div className="mt-3">
              {zoneDepot(occupe === 'lecture' ? 'Lecture…' : fichier ? `📄 ${fichier.nom}` : 'Déposez l’image de stock MyStock ici ou cliquez pour la choisir',
                'Excel (.xlsx, .xls) ou CSV — Référence + Quantité physique ; les lignes d’une même référence sont additionnées.', (f) => void deposerImage(f), !!fichier)}
            </div>
            {fichier && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <label className={lab}>Date et heure de l’image
                    <input type="datetime-local" value={fichier.heure} onChange={(e) => setFichier({ ...fichier, heure: e.target.value })} className={`${ctl} mt-1 w-full`} />
                  </label>
                  {fichier.feuilles.length > 1 && (
                    <label className={lab}>Feuille
                      <select value={fichier.feuille} onChange={(e) => fichierBrut && void deposerImage(fichierBrut, e.target.value)} className={`${ctl} mt-1 w-full`}>
                        {fichier.feuilles.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                  )}
                  <label className={lab}>Ligne d’en-tête
                    <select value={fichier.ligneEntete} onChange={(e) => {
                      const ligneEntete = Number(e.target.value)
                      const h = (fichier.matrice[ligneEntete] || []).map(norm)
                      const colRef = trouverColonne(h, MOTS_REF); const colQte = trouverColonne(h, MOTS_QTE, [colRef])
                      setFichier({ ...fichier, ligneEntete, colRef, colQte, colDes: trouverColonne(h, MOTS_DES, [colRef, colQte]) })
                    }} className={`${ctl} mt-1 w-full`}>
                      {fichier.matrice.slice(0, 20).map((_, i) => <option key={i} value={i}>Ligne {i + 1}</option>)}
                    </select>
                  </label>
                  {([['colRef', 'Colonne référence *'], ['colQte', 'Colonne quantité *'], ['colDes', 'Colonne désignation']] as const).map(([k, l]) => (
                    <label key={k} className={lab}>{l}
                      <select value={fichier[k]} onChange={(e) => setFichier({ ...fichier, [k]: Number(e.target.value) })} className={`${ctl} mt-1 w-full`}>
                        <option value={-1}>— {k === 'colDes' ? 'aucune' : 'choisir'} —</option>
                        {entetes.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <div className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold ${photoRetenue ? 'bg-[#E9F5EA] text-[#2F6F33]' : 'bg-[#FCEFD9] text-[#96600F]'}`}>
                  {!fichier.heure ? 'Indiquez la date et l’heure de l’image.'
                    : photoRetenue ? `Stock SAGE comparé : photo du ${fmtDate(photoRetenue.date_stock)} (import SAGE du ${fmtDateHeure(photoRetenue.loaded_at)}), dernière photo avant l’image.`
                    : 'Aucune photo SAGE avant cette heure (photos quotidiennes depuis le 11/11/2026) : le stock SAGE sera reconstitué (partiel).'}
                </div>
                {apercu ? (
                  <div className="flex flex-wrap gap-4 text-[12.5px] text-[#3A362E]">
                    <span><b>{apercu.nbLues.toLocaleString('fr-FR')}</b> lignes lues</span>
                    <span><b>{apercu.lignes.length.toLocaleString('fr-FR')}</b> références</span>
                    <span>Quantité totale <b>{fmtQte(apercu.total)}</b></span>
                    {apercu.nbQteInvalide > 0 && <span className="font-bold text-[#A3401C]">{apercu.nbQteInvalide} quantité(s) non numérique(s) comptée(s) à 0</span>}
                  </div>
                ) : <div className="text-[12.5px] font-semibold text-[#A3401C]">Choisissez la colonne référence et la colonne quantité.</div>}
                <div className="flex justify-end gap-2">
                  <button type="button" className={btn} onClick={() => { setFichier(null); setFichierBrut(null) }}>Annuler</button>
                  <button type="button" className={btnNoir} disabled={!apercu || !apercu.lignes.length || !fichier.heure || occupe !== null} onClick={() => void lancer()}>
                    {occupe === 'creation' ? 'Calcul…' : 'Lancer le contrôle'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Mouvements MyStock */}
        {panneau === 'mouvements' && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <h2 className="text-[15px] font-bold">Mouvements MyStock à la ligne</h2>
            <p className="text-[12px] text-[#8A8474]">Ils servent à expliquer les écarts de tous les contrôles. Importez des fichiers qui couvrent au moins la semaine avant l’image et les jours qui suivent ; réimporter un fichier met à jour les lignes déjà connues.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {(['expedition', 'reception'] as TypeMouvement[]).map((t) => {
                const cov = couverture?.types?.[t]
                const f = fichiersMvt[t]
                const a = apercusMvt[t]
                const ent = f ? (f.matrice[f.ligneEntete] || []).map((h, i) => String(h ?? '').trim() || `Colonne ${i + 1}`) : []
                return (
                  <div key={t} className="rounded-xl border border-[#EFECE5] p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[13.5px] font-bold">{TYPES_MVT[t].titre}</h3>
                      <span className="text-[11.5px] text-[#8A8474]">{cov ? `${cov.lignes.toLocaleString('fr-FR')} lignes en base, du ${fmtDateHeure(cov.date_min)} au ${fmtDateHeure(cov.date_max)}` : 'Aucun mouvement en base'}</span>
                    </div>
                    <div className="mt-2">
                      {zoneDepot(occupe === `lecture-${t}` ? 'Lecture…' : f ? `📄 ${f.nom}` : 'Déposez le fichier ici', TYPES_MVT[t].aide, (file) => void deposerMvt(t, file), !!f)}
                    </div>
                    {f && (
                      <div className="mt-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                          {(Object.keys(LIBELLES_CHAMPS) as ChampMouvement[]).filter((c) => t === 'reception' || c !== 'retour').map((c) => (
                            <label key={c} className={lab}>{LIBELLES_CHAMPS[c]}{CHAMPS_OBLIGATOIRES.includes(c) ? ' *' : ''}
                              <select value={f.colonnes[c]} onChange={(e) => setFichiersMvt((x) => ({ ...x, [t]: { ...f, colonnes: { ...f.colonnes, [c]: Number(e.target.value) } } }))} className={`${ctl} mt-1 w-full`}>
                                <option value={-1}>— aucune —</option>
                                {ent.map((h, i) => <option key={i} value={i}>{h} (col. {i + 1})</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                        {a ? (
                          <div className="text-[12px] text-[#3A362E]">
                            <b>{a.lignes.length.toLocaleString('fr-FR')}</b> lignes, <b>{a.documents.toLocaleString('fr-FR')}</b> documents, du <b>{a.dateMin ? fmtDateHeure(a.dateMin) : '—'}</b> au <b>{a.dateMax ? fmtDateHeure(a.dateMax) : '—'}</b>
                            {a.ignorees > 0 && <span className="text-[#8A8474]"> · {a.ignorees} ligne(s) incomplète(s) ignorée(s)</span>}
                          </div>
                        ) : <div className="text-[12px] font-semibold text-[#A3401C]">Choisissez les colonnes obligatoires (*).</div>}
                        <div className="flex justify-end gap-2">
                          <button type="button" className={btn} onClick={() => setFichiersMvt((x) => ({ ...x, [t]: undefined }))}>Annuler</button>
                          <button type="button" className={btnNoir} disabled={!a || !a.lignes.length || occupe !== null} onClick={() => void importerMvt(t)}>
                            {occupe === `import-${t}` ? 'Import…' : 'Importer'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {occupe === 'resultat' && !donnees && <div className="rounded-xl border border-[#E5E1D8] bg-white p-4 text-[13px] text-[#8A8474]">Calcul…</div>}

        {!donnees && panneau === 'aucun' && occupe !== 'resultat' && liste.length > 0 && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white">
            <div className="px-4 py-2.5 text-[13px] font-bold">Contrôles enregistrés</div>
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F4F3F0] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                <tr>
                  <th className="px-3 py-1.5">Image du</th><th className="px-3 py-1.5">Stock SAGE du</th><th className="px-3 py-1.5">Fichier</th>
                  <th className="px-3 py-1.5 text-right">Expliqués</th><th className="px-3 py-1.5 text-right">À valider</th><th className="px-3 py-1.5 text-right">Sans explication</th>
                  <th className="px-3 py-1.5">Créé</th><th />
                </tr>
              </thead>
              <tbody>
                {liste.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-t border-[#EFECE5] hover:bg-[#FAF9F6]" onClick={() => ouvrir(c.id)}>
                    <td className="px-3 py-1.5 font-bold">{c.heure_image ? fmtDateHeure(c.heure_image) : fmtDate(c.date_image)}</td>
                    <td className="px-3 py-1.5">{fmtDate(c.date_image)}{c.photo_disponible ? '' : ' (reconstitué)'}</td>
                    <td className="px-3 py-1.5">{c.fichier_nom}</td>
                    <td className="px-3 py-1.5 text-right">{c.resume?.v2 ? c.resume.nb_sur : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{c.resume?.v2 ? c.resume.nb_avalider : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-bold">{c.resume?.v2 ? c.resume.nb_inexplique : '—'}</td>
                    <td className="px-3 py-1.5 text-[#8A8474]">{fmtDateHeure(c.cree_le)} · {c.cree_par}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button type="button" className="text-[12px] font-bold text-[#A3401C]" onClick={async (e) => {
                        e.stopPropagation()
                        if (!window.confirm('Supprimer ce contrôle et ses annotations ?')) return
                        const { error } = await supabase.rpc('mystock_controle_supprimer', { p_id: c.id })
                        if (error) setErreur(messageErreur(error)); else await chargerListe()
                      }}>Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {donnees && resume && (
          <>
            <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5 text-[12.5px]">
              <div>
                <b>Image MyStock du {T ? fmtDateHeure(donnees.controle.heure_image) : fmtDate(donnees.controle.date_image)}</b> · {donnees.controle.fichier_nom}
                {' · '}stock SAGE {donnees.meta.source_sage === 'photo' ? `photo du ${fmtDate(donnees.controle.date_image)} (import du ${fmtDateHeure(donnees.meta.photo_loaded_at)})` : 'reconstitué (partiel)'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${expOk ? 'bg-[#E9F5EA] text-[#2F6F33]' : 'bg-[#FCEFD9] text-[#96600F]'}`}>
                  {expOk ? 'Préparations MyStock : couvrent l’image' : covExp ? `Préparations MyStock du ${fmtDate(covExp.date_min)} au ${fmtDate(covExp.date_max)} : ne couvrent pas l’image` : 'Préparations MyStock : aucune'}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${recOk ? 'bg-[#E9F5EA] text-[#2F6F33]' : 'bg-[#FCEFD9] text-[#96600F]'}`}>
                  {recOk ? 'Réceptions MyStock : couvrent l’image' : covRec ? `Réceptions jusqu’au ${fmtDate(covRec.date_max)}` : 'Réceptions MyStock : aucune'}
                </span>
                {!T && <span className="rounded-full bg-[#FCEFD9] px-2.5 py-1 text-[11.5px] font-bold text-[#96600F]">Heure de l’image inconnue : fin de journée supposée</span>}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Références" value={resume.nb_references.toLocaleString('fr-FR')} sub={`${resume.nb_references - resume.nb_ok} en écart`} onClick={() => setFiltre('tous')} actif={filtre === 'tous'} />
              <Kpi label="Identiques" value={resume.nb_ok.toLocaleString('fr-FR')} tone="ok" onClick={() => setFiltre('ok')} actif={filtre === 'ok'} />
              <Kpi label="Expliqués à coup sûr" value={resume.nb_sur.toLocaleString('fr-FR')} tone="info" sub={`${fmtEuro(resume.valeur_sur)} · décalages prouvés`} onClick={() => setFiltre('sur')} actif={filtre === 'sur'} />
              <Kpi label="Explication à valider" value={resume.nb_avalider.toLocaleString('fr-FR')} tone="warn" sub={`${fmtEuro(resume.valeur_avalider)} · hypothèses à confirmer`} onClick={() => setFiltre('avalider')} actif={filtre === 'avalider'} />
              <Kpi label="Sans explication" value={resume.nb_inexplique.toLocaleString('fr-FR')} tone={resume.nb_inexplique ? 'alerte' : 'ok'} sub={fmtEuro(resume.valeur_inexplique)} onClick={() => setFiltre('inexplique')} actif={filtre === 'inexplique'} />
              <Kpi label="Restant à analyser" value={donnees.lignes.filter((l) => ['avalider', 'inexplique'].includes(analyses.get(l.reference)?.groupe ?? 'ok') && (l.suivi_statut || 'a_analyser') === 'a_analyser').length.toLocaleString('fr-FR')}
                tone="warn" sub="à valider + sans explication, non traités" onClick={() => { setFiltre('ecarts'); setFiltreSuivi('a_analyser') }} actif={filtre === 'ecarts' && filtreSuivi === 'a_analyser'} />
            </section>

            <section className="rounded-xl border border-[#E5E1D8] bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-[#EFECE5] px-3 py-2">
                {pastille('inexplique', 'Sans explication', resume.nb_inexplique)}
                {pastille('avalider', 'À valider', resume.nb_avalider)}
                {pastille('sur', 'Expliqués à coup sûr', resume.nb_sur)}
                {pastille('ecarts', 'Tous les écarts', resume.nb_references - resume.nb_ok)}
                {pastille('ok', 'Identiques', resume.nb_ok)}
                <span className="mx-1 h-5 w-px bg-[#E5E1D8]" />
                <select value={filtreSuivi} onChange={(e) => setFiltreSuivi(e.target.value as typeof filtreSuivi)} className={ctl}>
                  <option value="tous">Suivi : tous</option>
                  {(Object.keys(SUIVIS) as Suivi[]).map((k) => <option key={k} value={k}>Suivi : {SUIVIS[k]}</option>)}
                </select>
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Référence, désignation, famille…" className={`${ctl} min-w-[220px] flex-1`} />
                <span className="text-[12px] text-[#8A8474]">{lignesFiltrees.length.toLocaleString('fr-FR')} ligne(s)</span>
              </div>
              <div className="max-h-[calc(100vh-330px)] overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-[#F4F3F0] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                    <tr>
                      <th className="px-2 py-1.5">Référence</th>
                      <th className="px-2 py-1.5">Désignation</th>
                      <th className="px-2 py-1.5">Classement</th>
                      <th className="px-2 py-1.5 text-right">MyStock</th>
                      <th className="px-2 py-1.5 text-right" title="Stock réel SAGE du dépôt FMS, PL comprises, à la photo retenue">SAGE</th>
                      <th className="px-2 py-1.5 text-right">Écart</th>
                      <th className="px-2 py-1.5 text-right">Valeur</th>
                      <th className="px-2 py-1.5">Explications</th>
                      <th className="px-2 py-1.5">Suivi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesFiltrees.slice(0, 1500).map((l) => {
                      const a = analyses.get(l.reference)
                      const g = a?.groupe ?? 'ok'
                      return (
                        <tr key={l.reference} onClick={() => ouvrirFiche(l)}
                          className={`cursor-pointer border-t border-[#EFECE5] align-top hover:bg-[#FAF9F6] ${fiche?.reference === l.reference ? 'bg-[#FCF6EC]' : ''}`}>
                          <td className="whitespace-nowrap px-2 py-1 font-mono font-semibold">{l.reference}</td>
                          <td className="max-w-[280px] truncate px-2 py-1" title={l.designation || ''}>{l.designation || '—'}</td>
                          <td className="px-2 py-1"><Badge groupe={g} /></td>
                          <td className="px-2 py-1 text-right">{fmtQte(l.qte_mystock)}</td>
                          <td className="px-2 py-1 text-right">{fmtQte(l.qte_sage)}</td>
                          <td className={`px-2 py-1 text-right font-bold ${n0(l.ecart) > 0 ? 'text-[#2D5F8C]' : n0(l.ecart) < 0 ? 'text-[#A3401C]' : 'text-[#8A8474]'}`}>{n0(l.ecart) ? signe(n0(l.ecart)) : '0'}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">{n0(l.ecart_valeur) ? fmtEuro(n0(l.ecart_valeur)) : '—'}</td>
                          <td className="max-w-[560px] px-2 py-1 text-[12px] text-[#3A362E]">{resumeExplications(a)}</td>
                          <td className="max-w-[180px] truncate px-2 py-1 text-[12px]" title={l.suivi_commentaire || ''}>
                            {g !== 'ok' && (
                              <>
                                <span className={`font-bold ${l.suivi_statut === 'corrige' ? 'text-[#2F6F33]' : l.suivi_statut === 'explique' ? 'text-[#2D5F8C]' : 'text-[#8A8474]'}`}>{SUIVIS[(l.suivi_statut as Suivi) || 'a_analyser']}</span>
                                {l.suivi_commentaire ? ` · ${l.suivi_commentaire}` : ''}
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {lignesFiltrees.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[13px] text-[#8A8474]">Aucune ligne pour ces filtres.</td></tr>}
                  </tbody>
                </table>
                {lignesFiltrees.length > 1500 && <div className="px-3 py-2 text-[12px] text-[#8A8474]">1 500 premières lignes affichées — affinez les filtres ou exportez en Excel.</div>}
              </div>
            </section>
          </>
        )}
      </div>

      {fiche && donnees && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={() => setFiche(null)}>
          <aside className="h-full w-full max-w-[640px] overflow-y-auto bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[16px] font-bold">{fiche.reference}</div>
                <div className="text-[13px] text-[#3A362E]">{fiche.designation || '—'}{fiche.famille ? ` · ${fiche.famille}` : ''}</div>
                <div className="mt-1"><Badge groupe={analyseFiche?.groupe ?? 'ok'} /></div>
              </div>
              <button type="button" className={btn} onClick={() => setFiche(null)}>✕</button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Kpi label="MyStock (image)" value={fmtQte(fiche.qte_mystock)} sub={fiche.nb_lignes_fichier > 1 ? `${fiche.nb_lignes_fichier} lignes additionnées` : undefined} />
              <Kpi label={`SAGE ${fmtDate(donnees.controle.date_image)} (stock réel)`} value={fmtQte(fiche.qte_sage)} sub={fiche.prepa_fin_j ? `PL comprises : ${fmtQte(fiche.prepa_fin_j)}` : undefined} />
              <Kpi label="Écart" value={signe(n0(fiche.ecart))} sub={n0(fiche.ecart_valeur) ? fmtEuro(n0(fiche.ecart_valeur)) : undefined} tone={n0(fiche.ecart) === 0 ? 'ok' : 'alerte'} />
            </div>

            {analyseFiche && analyseFiche.groupe !== 'ok' && (
              <div className="mt-3 rounded-xl border border-[#E5E1D8] p-3">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#8A8474]">
                  {analyseFiche.groupe === 'inexplique' ? `Explications trouvées — reste ${signe(analyseFiche.residu)} sans explication` : 'Explication de l’écart'}
                </h3>
                {analyseFiche.explications.length > 0
                  ? <ul className="mt-1">{analyseFiche.explications.map((e, i) => <LigneExplication key={i} e={e} />)}</ul>
                  : <p className="mt-1 text-[12.5px] text-[#8A8474]">Aucun mouvement certain n’explique cet écart.</p>}
                {analyseFiche.groupe === 'inexplique' && analyseFiche.pistes.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Pistes (ne suffisent pas à expliquer l’écart)</h4>
                    <ul className="mt-1">{analyseFiche.pistes.slice(0, 12).map((e, i) => <LigneExplication key={i} e={e} />)}</ul>
                  </>
                )}
              </div>
            )}

            <h3 className="mt-4 text-[12px] font-bold uppercase tracking-wide text-[#8A8474]">BL SAGE et mouvements MyStock (J − 21 j → aujourd’hui)</h3>
            <table className="mt-1 w-full text-[12px]">
              <thead className="text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                <tr><th className="py-1">Date</th><th className="py-1">Source</th><th className="py-1">Document</th><th className="py-1">Tiers / dépôt</th><th className="py-1 text-right">Qté</th></tr>
              </thead>
              <tbody>
                {[
                  ...donnees.bl.filter((b) => b[0] === fiche.reference).map((b) => ({ tri: `${b[2]}T12:00`, date: fmtDate(b[2]), src: 'BL SAGE', doc: b[1], tiers: `${b[6] || ''} · ${b[4] || 'sans dépôt'}${b[5] ? ` · ${b[5]}` : ''}`, q: n0(b[3]) })),
                  ...donnees.mvt.filter((m) => m[0] === fiche.reference).map((m) => ({ tri: m[3], date: fmtDateHeureCourt(m[3]), src: m[1] === 'expedition' ? 'Expé. MyStock' : m[7] ? 'Retour MyStock' : 'Récep. MyStock', doc: m[2], tiers: m[5] || '', q: n0(m[4]) })),
                ].sort((a, b) => a.tri.localeCompare(b.tri)).map((x, i) => (
                  <tr key={i} className={`border-t border-[#EFECE5] ${x.src.startsWith('BL') ? '' : 'bg-[#FAF9F6]'}`}>
                    <td className="whitespace-nowrap py-1 pr-2">{x.date}</td>
                    <td className="whitespace-nowrap py-1 pr-2 font-semibold">{x.src}</td>
                    <td className="py-1 pr-2 font-mono">{x.doc}</td>
                    <td className="max-w-[220px] truncate py-1 pr-2" title={x.tiers}>{x.tiers}</td>
                    <td className="py-1 text-right font-semibold">{fmtQte(x.q)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {donnees.photos.some((p) => p[0] === fiche.reference) && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                <span className="font-bold text-[#8A8474]">Stock SAGE en fin de journée :</span>
                {donnees.photos.filter((p) => p[0] === fiche.reference).map((p) => (
                  <span key={p[1]} className={`rounded-full border px-2 py-0.5 ${p[1] === donnees.controle.date_image ? 'border-[#111820] font-bold' : 'border-[#E5E1D8]'}`}>
                    {fmtDate(p[1])} : {fmtQte(n0(p[2]))}{n0(p[3]) ? ` (+${fmtQte(n0(p[3]))} transit)` : ''}
                  </span>
                ))}
              </div>
            )}

            {(analyseFiche?.groupe ?? 'ok') !== 'ok' && (
              <div className="mt-4 rounded-xl border border-[#E5E1D8] p-3">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#8A8474]">Suivi de l’écart</h3>
                <div className="mt-2 flex gap-1.5">
                  {(Object.keys(SUIVIS) as Suivi[]).map((k) => (
                    <button key={k} type="button" onClick={() => setAnnot({ ...annot, statut: k })}
                      className={`rounded-full border px-3 py-1 text-[12px] font-bold ${annot.statut === k ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E]'}`}>
                      {SUIVIS[k]}
                    </button>
                  ))}
                </div>
                <textarea value={annot.commentaire} onChange={(e) => setAnnot({ ...annot, commentaire: e.target.value })} rows={3}
                  placeholder="Explication, action menée (dépôt du BL corrigé, régularisation SAGE, demande à FMS…)"
                  className="mt-2 w-full rounded-lg border border-[#E5E1D8] px-2.5 py-2 text-[13px] outline-none focus:border-[#B4761A]" />
                {fiche.suivi_par && <div className="text-[11px] text-[#8A8474]">Dernière mise à jour : {fiche.suivi_par} · {fmtDateHeure(fiche.suivi_le)}</div>}
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" className={btn} disabled={occupe === 'annotation'} onClick={() => void enregistrerAnnotation(false)}>Enregistrer</button>
                  <button type="button" className={btnNoir} disabled={occupe === 'annotation'} onClick={() => void enregistrerAnnotation(true)}>Enregistrer et suivant →</button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}

export default function ControleMyStockPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <ControleMyStock />
    </Suspense>
  )
}
