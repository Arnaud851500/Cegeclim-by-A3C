'use client'

/**
 * Écran « Contrôle stock FMS — SAGE ↔ MyStock » (Stocks & logistique, /stock/controle-mystock?id=).
 * ---------------------------------------------------------------------------
 * Créé le 12/11/2026, droit can_appro.
 *
 * FMS (plateforme logistique) envoie une image de son stock MyStock. Règle fixée par Arnaud :
 * l'image est un stock de FIN DE JOURNÉE J (toutes réceptions et expéditions du jour passées).
 * Le contrôle étant fait à J+1 / J+2, on ne compare pas l'image au stock SAGE du moment mais au
 * stock SAGE du dépôt FMS de fin de journée J :
 *   - « photo » : photo quotidienne de sage.stock_depot prise après le dernier import SAGE du jour
 *     (≈ 23h05, table stock_depot_snapshot_journalier, en place depuis le 11/11/2026) — exact ;
 *   - « reconstitué » (pas de photo pour J) : stock SAGE actuel + BL / factures FMS datés après J.
 *     Réceptions fournisseurs et transferts de dépôt absents des données importées → partiel.
 *
 * 1. Déposer le fichier MyStock (xlsx, xls, csv), choisir les colonnes référence / quantité
 *    (détection automatique), indiquer la date de l'image (J).
 * 2. Résultat par référence : stock MyStock, stock SAGE fin de J, écart, valeur (PUMP FMS),
 *    BL SAGE datés de J (piège : BL daté J parti physiquement J+1), stock en transit vers FMS.
 *    Statuts : ok / écart = BL du jour / absent MyStock / absent SAGE / écart à analyser.
 * 3. Fiche d'une référence : mouvements SAGE J−7 → aujourd'hui, photos quotidiennes, annotation
 *    (à analyser / expliqué / corrigé + commentaire). Export Excel.
 *
 * SQL : supabase/migrations/20261112a_stock_depot_snapshot_journalier.sql,
 *       supabase/migrations/20261112b_controle_stock_mystock.sql (RPC mystock_*).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

type Statut = 'ok' | 'bl_jour' | 'transit' | 'absent_mystock' | 'absent_sage' | 'ecart'
type Suivi = 'a_analyser' | 'explique' | 'corrige'

type Resume = {
  nb_references: number; nb_ok: number; nb_bl_jour: number; nb_transit?: number; nb_ecart: number
  valeur_bl_jour?: number; valeur_transit?: number; valeur_a_analyser_abs?: number
  nb_absent_mystock: number; nb_absent_sage: number; nb_a_analyser: number
  qte_mystock: number; qte_sage: number; valeur_ecart_abs: number; valeur_ecart_net: number
}
type ControleListe = {
  id: number; date_image: string; depot_num: string; fichier_nom: string | null; nb_lignes_fichier: number | null
  cree_le: string; cree_par: string | null; resume: Resume | null; photo_disponible: boolean
}
type Ligne = {
  reference: string; designation: string | null; famille: string | null
  qte_mystock: number | null; nb_lignes_fichier: number
  qte_sage: number; qte_sage_actuel: number; prepa_fin_j: number
  bl_jour: number; bl_apres: number; transit: number
  bl_non_expedies?: number; bl_depuis?: string | null
  ecart: number; pu: number; ecart_valeur: number; statut: Statut
  suivi_statut: Suivi | null; suivi_commentaire: string | null; suivi_par: string | null; suivi_le: string | null
}
type Resultat = {
  controle: { id: number; date_image: string; depot_num: string; fichier_nom: string | null; colonne_reference: string | null; colonne_quantite: string | null; nb_lignes_fichier: number | null; cree_le: string; cree_par: string | null }
  meta: { depot: string; source_sage: 'photo' | 'reconstitue'; photo_loaded_at: string | null; stock_actuel_loaded_at: string | null; reconstitution_partielle: boolean }
  resume: Resume
  lignes: Ligne[]
}
type Mouvement = { date: string; numero: string; client: string | null; quantite: number; source: string; position: 'avant' | 'jour' | 'apres' }
type Fichier = {
  nom: string; feuilles: string[]; feuille: string; matrice: unknown[][]; ligneEntete: number
  colRef: number; colQte: number; colDes: number; date: string
}

const STATUTS: Record<Statut, { libelle: string; court: string; bg: string; fg: string }> = {
  ecart:          { libelle: 'Écart à analyser', court: 'Écart', bg: '#FBE4DD', fg: '#A3401C' },
  absent_mystock: { libelle: 'Absent de MyStock', court: 'Absent MyStock', bg: '#FCEFD9', fg: '#96600F' },
  absent_sage:    { libelle: 'Absent de SAGE', court: 'Absent SAGE', bg: '#EDE6F6', fg: '#5E4590' },
  bl_jour:        { libelle: 'Écart = BL SAGE non encore expédiés', court: 'BL non expédiés', bg: '#E4EEF8', fg: '#2D5F8C' },
  transit:        { libelle: 'Écart = stock en transit vers FMS', court: 'Transit', bg: '#E3F1F0', fg: '#1F6B66' },
  ok:             { libelle: 'Identique', court: 'OK', bg: '#E9F5EA', fg: '#2F6F33' },
}
const SUIVIS: Record<Suivi, string> = { a_analyser: 'À analyser', explique: 'Expliqué', corrige: 'Corrigé' }

const n0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const fmtQte = (v: number | null | undefined) => v === null || v === undefined ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v)
const fmtEuro = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
const fmtDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '—'
const fmtDateHeure = (d: string | null | undefined) => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const signe = (v: number) => (v > 0 ? `+${fmtQte(v)}` : fmtQte(v))

function messageErreur(e: unknown): string {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'string') return e
  const o = e as { message?: string; details?: string }
  return o.message || o.details || JSON.stringify(e)
}

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Date de l'image (J) lue dans le nom du fichier : 2026-11-11, 20261111, 11-11-2026, 11112026 ou
 * 121126 (jjmmaa, export MyStock « STOCK_FMS_121126_8h48 »). Une image prise le matin (heure < 12h,
 * « 8h48 ») est le stock de fin de la journée précédente : J = veille. Sans date : la veille.
 */
function dateDepuisNomFichier(nom: string): string {
  const valide = (a: number, m: number, j: number) => m >= 1 && m <= 12 && j >= 1 && j <= 31 && a >= 2020 && a <= 2099
  let d: Date | null = null
  const a = nom.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/)
  const b = nom.match(/(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(20\d{2})(?!\d)/)
  const c = nom.match(/(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/)
  if (a && valide(+a[1], +a[2], +a[3])) d = new Date(+a[1], +a[2] - 1, +a[3])
  else if (b && valide(+b[3], +b[2], +b[1])) d = new Date(+b[3], +b[2] - 1, +b[1])
  else if (c && valide(2000 + +c[3], +c[2], +c[1])) d = new Date(2000 + +c[3], +c[2] - 1, +c[1])
  if (!d) { const v = new Date(); v.setDate(v.getDate() - 1); return isoLocal(v) }
  const h = nom.match(/(?<!\d)(\d{1,2})\s?h\s?\d{0,2}/i)
  if (h && +h[1] < 12) d.setDate(d.getDate() - 1)
  return isoLocal(d)
}

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/\s| | /g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

const MOTS_REF = ['reference article', 'ref article', 'code article', 'reference', 'référence', 'ref', 'article', 'sku', 'code produit', 'produit', 'code']
const MOTS_QTE = ['stock physique', 'qte physique', 'quantite physique', 'stock reel', 'stock total', 'qte en stock', 'quantite en stock', 'stock', 'quantite', 'qte', 'qty', 'disponible', 'dispo']
const MOTS_DES = ['designation', 'libelle', 'description', 'desc']

function trouverColonne(entetes: string[], mots: string[], exclure: number[] = []): number {
  for (const mot of mots) {
    const m = norm(mot)
    const i = entetes.findIndex((h, idx) => !exclure.includes(idx) && h === m)
    if (i >= 0) return i
  }
  for (const mot of mots) {
    const m = norm(mot)
    const i = entetes.findIndex((h, idx) => !exclure.includes(idx) && h.includes(m))
    if (i >= 0) return i
  }
  return -1
}

/** Ligne d'en-tête : la première des 20 premières lignes qui contient un libellé de référence et de quantité. */
function detecterEntete(matrice: unknown[][]): number {
  for (let i = 0; i < Math.min(20, matrice.length); i++) {
    const h = (matrice[i] || []).map(norm)
    if (trouverColonne(h, MOTS_REF) >= 0 && trouverColonne(h, MOTS_QTE) >= 0) return i
  }
  return 0
}

function preparerColonnes(f: Omit<Fichier, 'colRef' | 'colQte' | 'colDes' | 'ligneEntete'>): Fichier {
  const ligneEntete = detecterEntete(f.matrice)
  const entetes = (f.matrice[ligneEntete] || []).map(norm)
  const colRef = trouverColonne(entetes, MOTS_REF)
  const colQte = trouverColonne(entetes, MOTS_QTE, [colRef])
  const colDes = trouverColonne(entetes, MOTS_DES, [colRef, colQte])
  return { ...f, ligneEntete, colRef, colQte, colDes }
}

function lignesDuFichier(f: Fichier) {
  const agg = new Map<string, { reference: string; designation: string | null; qte: number; nb: number }>()
  let nbLues = 0, nbIgnorees = 0, nbQteInvalide = 0
  for (const row of f.matrice.slice(f.ligneEntete + 1)) {
    const r = row as unknown[]
    const ref = String(r?.[f.colRef] ?? '').trim().toUpperCase()
    if (!ref) { nbIgnorees += 1; continue }
    const q = nombre(r?.[f.colQte])
    if (q === null) nbQteInvalide += 1
    nbLues += 1
    const des = f.colDes >= 0 ? (String(r?.[f.colDes] ?? '').trim() || null) : null
    const cur = agg.get(ref)
    if (cur) { cur.qte += q ?? 0; cur.nb += 1; if (!cur.designation && des) cur.designation = des }
    else agg.set(ref, { reference: ref, designation: des, qte: q ?? 0, nb: 1 })
  }
  const lignes = Array.from(agg.values())
  return { lignes, nbLues, nbIgnorees, nbQteInvalide, total: lignes.reduce((s, l) => s + l.qte, 0) }
}

async function lireClasseur(file: File, feuille?: string): Promise<Omit<Fichier, 'colRef' | 'colQte' | 'colDes' | 'ligneEntete' | 'date'>> {
  const XLSX = await import('xlsx-js-style')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const nom = feuille && wb.SheetNames.includes(feuille) ? feuille : wb.SheetNames[0]
  const matrice: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null })
  return { nom: file.name, feuilles: wb.SheetNames, feuille: nom, matrice }
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

function Badge({ statut }: { statut: Statut }) {
  const s = STATUTS[statut]
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.court}</span>
}

async function exporterExcel(res: Resultat) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM'
  const qte = '#,##0.##;[Red]-#,##0.##'
  const euro = '#,##0.00 "€";[Red]-#,##0.00 "€"'
  const ws = wb.addWorksheet('Écarts')
  ws.columns = [
    { header: 'Référence', key: 'reference', width: 22 },
    { header: 'Désignation', key: 'designation', width: 42 },
    { header: 'Famille', key: 'famille', width: 14 },
    { header: 'Statut', key: 'statut', width: 22 },
    { header: `MyStock ${fmtDate(res.controle.date_image)}`, key: 'mystock', width: 12, style: { numFmt: qte } },
    { header: `SAGE fin ${fmtDate(res.controle.date_image)}`, key: 'sage', width: 12, style: { numFmt: qte } },
    { header: 'Écart (MyStock − SAGE)', key: 'ecart', width: 12, style: { numFmt: qte } },
    { header: 'PUMP FMS', key: 'pu', width: 11, style: { numFmt: euro } },
    { header: 'Valeur écart', key: 'val', width: 13, style: { numFmt: euro } },
    { header: 'BL SAGE datés J', key: 'bl_jour', width: 11, style: { numFmt: qte } },
    { header: 'BL non expédiés (explication)', key: 'bl_ne', width: 12, style: { numFmt: qte } },
    { header: 'BL datés depuis le', key: 'bl_depuis', width: 12 },
    { header: 'BL SAGE après J', key: 'bl_apres', width: 11, style: { numFmt: qte } },
    { header: 'PL en cours fin J', key: 'prepa', width: 11, style: { numFmt: qte } },
    { header: 'Transit vers FMS', key: 'transit', width: 11, style: { numFmt: qte } },
    { header: 'SAGE actuel', key: 'actuel', width: 11, style: { numFmt: qte } },
    { header: 'Suivi', key: 'suivi', width: 12 },
    { header: 'Commentaire', key: 'com', width: 50 },
  ]
  for (const l of res.lignes) {
    ws.addRow({
      reference: l.reference, designation: l.designation, famille: l.famille, statut: STATUTS[l.statut].libelle,
      mystock: l.qte_mystock, sage: n0(l.qte_sage), ecart: n0(l.ecart), pu: n0(l.pu), val: n0(l.ecart_valeur),
      bl_jour: n0(l.bl_jour), bl_ne: n0(l.bl_non_expedies) || null, bl_depuis: l.bl_depuis ? fmtDate(l.bl_depuis) : '', bl_apres: n0(l.bl_apres), prepa: n0(l.prepa_fin_j), transit: n0(l.transit), actuel: n0(l.qte_sage_actuel),
      suivi: l.statut === 'ok' ? '' : SUIVIS[l.suivi_statut || 'a_analyser'], com: l.suivi_commentaire,
    })
  }
  const r = ws.getRow(1)
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } }
  r.alignment = { vertical: 'middle', wrapText: true }
  r.height = 30
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }

  const ws2 = wb.addWorksheet('Synthèse')
  const s = res.resume
  const meta: Array<[string, string | number]> = [
    ['Date de l’image MyStock (J)', fmtDate(res.controle.date_image)],
    ['Fichier', res.controle.fichier_nom || ''],
    ['Dépôt SAGE', res.meta.depot],
    ['Stock SAGE fin de J', res.meta.source_sage === 'photo' ? `Photo SAGE du ${fmtDateHeure(res.meta.photo_loaded_at)}` : 'Reconstitué (stock actuel + BL après J, sans réceptions ni transferts)'],
    ['Références', s.nb_references], ['Identiques', s.nb_ok], ['Écart = BL SAGE non encore expédiés', s.nb_bl_jour], ['Écart = transit vers FMS', s.nb_transit ?? 0],
    ['Écarts à analyser', s.nb_ecart], ['Absentes de MyStock', s.nb_absent_mystock], ['Absentes de SAGE', s.nb_absent_sage],
    ['Quantité MyStock', s.qte_mystock], ['Quantité SAGE', s.qte_sage],
    ['Valeur des écarts (absolue)', s.valeur_ecart_abs], ['Valeur des écarts (nette)', s.valeur_ecart_net],
  ]
  ws2.columns = [{ width: 34 }, { width: 70 }]
  meta.forEach(([a, b]) => ws2.addRow([a, b]))
  ws2.getColumn(1).font = { bold: true }

  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `controle_mystock_fms_${res.controle.date_image}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function ControleMyStock() {
  const router = useRouter()
  const params = useSearchParams()
  const idUrl = params.get('id')

  const [liste, setListe] = useState<ControleListe[]>([])
  const [photos, setPhotos] = useState<Array<{ date_stock: string; loaded_at: string }>>([])
  const [res, setRes] = useState<Resultat | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [refuse, setRefuse] = useState(false)

  const [fichier, setFichier] = useState<Fichier | null>(null)
  const [fichierBrut, setFichierBrut] = useState<File | null>(null)
  const [survol, setSurvol] = useState(false)
  const [voirImport, setVoirImport] = useState(false)

  const [filtre, setFiltre] = useState<'a_traiter' | Statut | 'tous'>('a_traiter')
  const [filtreSuivi, setFiltreSuivi] = useState<'tous' | Suivi>('tous')
  const [recherche, setRecherche] = useState('')
  const [tri, setTri] = useState<'valeur' | 'ecart' | 'reference'>('valeur')
  const [fiche, setFiche] = useState<Ligne | null>(null)
  const [mouvements, setMouvements] = useState<{ mouvements: Mouvement[]; photos: Array<{ date_stock: string; qte: number; prepa: number }> } | null>(null)
  const [annot, setAnnot] = useState<{ statut: Suivi; commentaire: string }>({ statut: 'a_analyser', commentaire: '' })

  const chargerListe = useCallback(async () => {
    const { data, error } = await supabase.rpc('mystock_controles_liste')
    if (error) {
      if (/Accès refusé/i.test(error.message)) setRefuse(true)
      else setErreur(messageErreur(error))
      return
    }
    const d = data as { controles: ControleListe[]; photos: Array<{ date_stock: string; loaded_at: string }> }
    setListe(d.controles || [])
    setPhotos(d.photos || [])
    if (!idUrl && (d.controles || []).length === 0) setVoirImport(true)
  }, [idUrl])

  const chargerResultat = useCallback(async (id: number) => {
    setOccupe('resultat'); setErreur(null)
    const { data, error } = await supabase.rpc('mystock_controle_resultat', { p_id: id })
    setOccupe(null)
    if (error) { setErreur(messageErreur(error)); return }
    setRes(data as Resultat)
  }, [])

  useEffect(() => { void chargerListe() }, [chargerListe])
  useEffect(() => {
    if (idUrl) void chargerResultat(Number(idUrl))
    else setRes(null)
  }, [idUrl, chargerResultat])

  const ouvrir = (id: number | null) => {
    setFiche(null)
    router.replace(id ? `/stock/controle-mystock?id=${id}` : '/stock/controle-mystock')
  }

  const deposer = async (file: File, feuille?: string) => {
    setErreur(null); setOccupe('lecture')
    try {
      const brut = await lireClasseur(file, feuille)
      if (!brut.matrice.length) throw new Error('Le fichier est vide.')
      setFichierBrut(file)
      const prepare = preparerColonnes({ ...brut, date: '' })
      const enteteQte = prepare.colQte >= 0 ? String((prepare.matrice[prepare.ligneEntete] || [])[prepare.colQte] ?? '') : ''
      // Date lue dans le nom du fichier, sinon dans l'en-tête de la colonne quantité (« Quantité physique 121126 8h48 »).
      const dateNom = /\d{6}/.test(file.name) ? dateDepuisNomFichier(file.name) : dateDepuisNomFichier(enteteQte)
      setFichier({ ...prepare, date: fichier && feuille ? fichier.date : dateNom })
    } catch (e) {
      setErreur(`Lecture du fichier impossible : ${messageErreur(e)}`)
    } finally {
      setOccupe(null)
    }
  }

  const apercu = useMemo(() => (fichier && fichier.colRef >= 0 && fichier.colQte >= 0 ? lignesDuFichier(fichier) : null), [fichier])
  const entetes = useMemo(() => (fichier ? (fichier.matrice[fichier.ligneEntete] || []).map((h, i) => String(h ?? '').trim() || `Colonne ${i + 1}`) : []), [fichier])
  const photoJ = fichier ? photos.find((p) => p.date_stock === fichier.date) : undefined

  const lancer = async () => {
    if (!fichier || !apercu) return
    setOccupe('creation'); setErreur(null)
    const { data, error } = await supabase.rpc('mystock_controle_creer', {
      p_date_image: fichier.date,
      p_fichier: fichier.nom,
      p_col_reference: entetes[fichier.colRef],
      p_col_quantite: entetes[fichier.colQte],
      p_nb_lignes_fichier: apercu.nbLues,
      p_lignes: apercu.lignes.map((l) => ({ reference: l.reference, designation: l.designation, qte: l.qte, nb: l.nb })),
      p_depot_num: '3',
    })
    setOccupe(null)
    if (error) { setErreur(messageErreur(error)); return }
    const r = data as Resultat
    setFichier(null); setFichierBrut(null); setVoirImport(false)
    setFiltre('a_traiter')
    await chargerListe()
    ouvrir(r.controle.id)
  }

  const supprimer = async (id: number) => {
    if (!window.confirm('Supprimer ce contrôle et ses annotations ?')) return
    const { error } = await supabase.rpc('mystock_controle_supprimer', { p_id: id })
    if (error) { setErreur(messageErreur(error)); return }
    await chargerListe()
    if (res?.controle.id === id) ouvrir(null)
  }

  const ouvrirFiche = async (l: Ligne) => {
    setFiche(l); setMouvements(null)
    setAnnot({ statut: l.suivi_statut || 'a_analyser', commentaire: l.suivi_commentaire || '' })
    if (!res) return
    const { data, error } = await supabase.rpc('mystock_controle_mouvements', { p_id: res.controle.id, p_reference: l.reference })
    if (error) { setErreur(messageErreur(error)); return }
    setMouvements(data as typeof mouvements)
  }

  const enregistrerAnnotation = async (suivant: boolean) => {
    if (!res || !fiche) return
    setOccupe('annotation')
    const { error } = await supabase.rpc('mystock_controle_annoter', {
      p_id: res.controle.id, p_reference: fiche.reference, p_statut: annot.statut, p_commentaire: annot.commentaire,
    })
    setOccupe(null)
    if (error) { setErreur(messageErreur(error)); return }
    const maj: Ligne = { ...fiche, suivi_statut: annot.statut, suivi_commentaire: annot.commentaire.trim() || null, suivi_le: new Date().toISOString() }
    setRes((r) => (r ? { ...r, lignes: r.lignes.map((x) => (x.reference === fiche.reference ? maj : x)) } : r))
    if (suivant) {
      const idx = lignesFiltrees.findIndex((x) => x.reference === fiche.reference)
      const next = lignesFiltrees[idx + 1]
      if (next) void ouvrirFiche(next); else setFiche(null)
    } else setFiche(maj)
  }

  const lignesFiltrees = useMemo(() => {
    if (!res) return []
    const q = recherche.trim().toUpperCase()
    const out = res.lignes.filter((l) => {
      if (filtre === 'a_traiter' && !['ecart', 'absent_mystock', 'absent_sage'].includes(l.statut)) return false
      if (filtre !== 'a_traiter' && filtre !== 'tous' && l.statut !== filtre) return false
      if (filtreSuivi !== 'tous' && (l.suivi_statut || 'a_analyser') !== filtreSuivi) return false
      if (q && !`${l.reference} ${l.designation || ''} ${l.famille || ''}`.toUpperCase().includes(q)) return false
      return true
    })
    if (tri === 'ecart') out.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart))
    else if (tri === 'reference') out.sort((a, b) => a.reference.localeCompare(b.reference))
    else out.sort((a, b) => Math.abs(b.ecart_valeur) - Math.abs(a.ecart_valeur) || Math.abs(b.ecart) - Math.abs(a.ecart))
    return out
  }, [res, filtre, filtreSuivi, recherche, tri])

  const ctl = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-2.5 text-[13px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const btn = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12.5px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-40'
  const btnNoir = 'h-9 rounded-lg bg-[#111820] px-3 text-[12.5px] font-bold text-white disabled:opacity-40'

  if (refuse) {
    return (
      <main className="min-h-screen bg-[#F4F3F0] p-6">
        <div className="mx-auto max-w-xl rounded-xl border border-[#E5E1D8] bg-white p-5 text-[14px]">
          Le contrôle du stock FMS avec MyStock est réservé aux utilisateurs ayant le droit « Appro ».
        </div>
      </main>
    )
  }

  const s = res?.resume
  const pastille = (cle: typeof filtre, label: string, nb: number | undefined) => (
    <button type="button" onClick={() => setFiltre(cle)}
      className={`rounded-full border px-3 py-1 text-[12px] font-bold ${filtre === cle ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:border-[#B4761A]'}`}>
      {label} <span className="opacity-70">{nb ?? 0}</span>
    </button>
  )

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* En-tête */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · Appro</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Contrôle stock FMS — SAGE ↔ MyStock</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              L’image MyStock est un stock de fin de journée J : elle est comparée au stock SAGE du dépôt FMS de fin de journée J, pas au stock SAGE du moment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {liste.length > 0 && (
              <select value={res?.controle.id ?? ''} onChange={(e) => ouvrir(e.target.value ? Number(e.target.value) : null)} className={`${ctl} h-10 max-w-[360px] font-bold`}>
                <option value="">— Contrôles enregistrés —</option>
                {liste.map((c) => (
                  <option key={c.id} value={c.id}>
                    Image du {fmtDate(c.date_image)} · {c.resume ? `${c.resume.nb_ecart + c.resume.nb_absent_mystock + c.resume.nb_absent_sage} écart(s)` : '…'} · {c.fichier_nom || ''}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={`${btnNoir} h-10`} onClick={() => setVoirImport((v) => !v)}>+ Nouveau contrôle</button>
            {res && <button type="button" className={`${btn} h-10`} onClick={() => void exporterExcel(res)}>⬇ Excel</button>}
            {res && <button type="button" className={`${btn} h-10`} title="Recalculer" onClick={() => void chargerResultat(res.controle.id)}>↻</button>}
          </div>
        </section>

        {erreur && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-semibold text-red-800">{erreur}</div>}

        {/* Import */}
        {voirImport && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-4">
            <h2 className="text-[15px] font-bold">Nouveau contrôle — fichier MyStock</h2>
            <label
              onDragOver={(e) => { e.preventDefault(); setSurvol(true) }}
              onDragLeave={() => setSurvol(false)}
              onDrop={(e) => { e.preventDefault(); setSurvol(false); const f = e.dataTransfer.files?.[0]; if (f) void deposer(f) }}
              className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center ${survol ? 'border-[#B4761A] bg-[#FCF6EC]' : 'border-[#D8D3C7] bg-[#FAF9F6]'}`}>
              <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void deposer(f); e.target.value = '' }} />
              <span className="text-[14px] font-bold">{occupe === 'lecture' ? 'Lecture…' : fichier ? `📄 ${fichier.nom}` : 'Déposez le fichier MyStock ici ou cliquez pour le choisir'}</span>
              <span className="mt-1 text-[12px] text-[#8A8474]">Excel (.xlsx, .xls) ou CSV — une ligne par article / emplacement, les lignes d’une même référence sont additionnées.</span>
            </label>

            {fichier && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <label className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Date de l’image (J)
                    <input type="date" value={fichier.date} onChange={(e) => setFichier({ ...fichier, date: e.target.value })} className={`${ctl} mt-1 w-full`} />
                  </label>
                  {fichier.feuilles.length > 1 && (
                    <label className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Feuille
                      <select value={fichier.feuille} onChange={(e) => fichierBrut && void deposer(fichierBrut, e.target.value)} className={`${ctl} mt-1 w-full`}>
                        {fichier.feuilles.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Ligne d’en-tête
                    <select value={fichier.ligneEntete} onChange={(e) => {
                      const ligneEntete = Number(e.target.value)
                      const h = (fichier.matrice[ligneEntete] || []).map(norm)
                      const colRef = trouverColonne(h, MOTS_REF); const colQte = trouverColonne(h, MOTS_QTE, [colRef])
                      setFichier({ ...fichier, ligneEntete, colRef, colQte, colDes: trouverColonne(h, MOTS_DES, [colRef, colQte]) })
                    }} className={`${ctl} mt-1 w-full`}>
                      {fichier.matrice.slice(0, 20).map((_, i) => <option key={i} value={i}>Ligne {i + 1}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Colonne référence *
                    <select value={fichier.colRef} onChange={(e) => setFichier({ ...fichier, colRef: Number(e.target.value) })} className={`${ctl} mt-1 w-full`}>
                      <option value={-1}>— choisir —</option>
                      {entetes.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Colonne quantité *
                    <select value={fichier.colQte} onChange={(e) => setFichier({ ...fichier, colQte: Number(e.target.value) })} className={`${ctl} mt-1 w-full`}>
                      <option value={-1}>— choisir —</option>
                      {entetes.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Colonne désignation
                    <select value={fichier.colDes} onChange={(e) => setFichier({ ...fichier, colDes: Number(e.target.value) })} className={`${ctl} mt-1 w-full`}>
                      <option value={-1}>— aucune —</option>
                      {entetes.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </label>
                </div>

                <div className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold ${photoJ ? 'bg-[#E9F5EA] text-[#2F6F33]' : 'bg-[#FCEFD9] text-[#96600F]'}`}>
                  {photoJ
                    ? `Stock SAGE fin du ${fmtDate(fichier.date)} disponible : photo prise après l’import SAGE du ${fmtDateHeure(photoJ.loaded_at)}. Comparaison exacte.`
                    : `Pas de photo SAGE pour le ${fmtDate(fichier.date)} (photos quotidiennes depuis le 11/11/2026) : le stock SAGE sera reconstitué à partir du stock actuel en réintégrant les BL datés après J. Réceptions fournisseurs et transferts de dépôt postérieurs ne sont pas connus : écarts possibles sur les références réceptionnées ou transférées depuis.`}
                </div>

                {apercu ? (
                  <>
                    <div className="flex flex-wrap gap-4 text-[12.5px] text-[#3A362E]">
                      <span><b>{apercu.nbLues.toLocaleString('fr-FR')}</b> lignes lues</span>
                      <span><b>{apercu.lignes.length.toLocaleString('fr-FR')}</b> références</span>
                      <span>Quantité totale <b>{fmtQte(apercu.total)}</b></span>
                      {apercu.nbIgnorees > 0 && <span className="text-[#8A8474]">{apercu.nbIgnorees} ligne(s) sans référence ignorée(s)</span>}
                      {apercu.nbQteInvalide > 0 && <span className="font-bold text-[#A3401C]">{apercu.nbQteInvalide} quantité(s) non numérique(s) comptée(s) à 0 — vérifiez la colonne</span>}
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-[#E5E1D8]">
                      <table className="w-full text-[12px]">
                        <thead className="bg-[#F4F3F0] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                          <tr><th className="px-2 py-1.5">Référence</th><th className="px-2 py-1.5">Désignation</th><th className="px-2 py-1.5 text-right">Quantité</th><th className="px-2 py-1.5 text-right">Lignes</th></tr>
                        </thead>
                        <tbody>
                          {apercu.lignes.slice(0, 6).map((l) => (
                            <tr key={l.reference} className="border-t border-[#EFECE5]">
                              <td className="px-2 py-1 font-mono font-semibold">{l.reference}</td>
                              <td className="px-2 py-1">{l.designation || '—'}</td>
                              <td className="px-2 py-1 text-right">{fmtQte(l.qte)}</td>
                              <td className="px-2 py-1 text-right">{l.nb}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="text-[12.5px] font-semibold text-[#A3401C]">Choisissez la colonne référence et la colonne quantité.</div>
                )}

                <div className="flex justify-end gap-2">
                  <button type="button" className={btn} onClick={() => { setFichier(null); setFichierBrut(null) }}>Annuler</button>
                  <button type="button" className={btnNoir} disabled={!apercu || !apercu.lignes.length || !fichier.date || occupe !== null} onClick={() => void lancer()}>
                    {occupe === 'creation' ? 'Calcul…' : 'Lancer le contrôle'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {occupe === 'resultat' && !res && <div className="rounded-xl border border-[#E5E1D8] bg-white p-4 text-[13px] text-[#8A8474]">Calcul…</div>}

        {!res && !voirImport && occupe !== 'resultat' && liste.length > 0 && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white">
            <div className="px-4 py-2.5 text-[13px] font-bold">Contrôles enregistrés</div>
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F4F3F0] text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                <tr>
                  <th className="px-3 py-1.5">Image du</th><th className="px-3 py-1.5">Fichier</th><th className="px-3 py-1.5">Stock SAGE</th>
                  <th className="px-3 py-1.5 text-right">Références</th><th className="px-3 py-1.5 text-right">Écarts</th><th className="px-3 py-1.5 text-right">À analyser</th>
                  <th className="px-3 py-1.5 text-right">Valeur écarts</th><th className="px-3 py-1.5">Créé</th><th />
                </tr>
              </thead>
              <tbody>
                {liste.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-t border-[#EFECE5] hover:bg-[#FAF9F6]" onClick={() => ouvrir(c.id)}>
                    <td className="px-3 py-1.5 font-bold">{fmtDate(c.date_image)}</td>
                    <td className="px-3 py-1.5">{c.fichier_nom}</td>
                    <td className="px-3 py-1.5">{c.photo_disponible ? 'Photo' : 'Reconstitué'}</td>
                    <td className="px-3 py-1.5 text-right">{c.resume?.nb_references ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">{c.resume ? c.resume.nb_ecart + c.resume.nb_absent_mystock + c.resume.nb_absent_sage : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{c.resume?.nb_a_analyser ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">{c.resume ? fmtEuro(c.resume.valeur_ecart_abs) : '—'}</td>
                    <td className="px-3 py-1.5 text-[#8A8474]">{fmtDateHeure(c.cree_le)} · {c.cree_par}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button type="button" className="text-[12px] font-bold text-[#A3401C]" onClick={(e) => { e.stopPropagation(); void supprimer(c.id) }}>Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {res && s && (
          <>
            <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5 text-[12.5px]">
              <div>
                <b>Image MyStock du {fmtDate(res.controle.date_image)}</b> · {res.controle.fichier_nom} ({res.controle.nb_lignes_fichier?.toLocaleString('fr-FR')} lignes, colonnes « {res.controle.colonne_reference} » / « {res.controle.colonne_quantite} »)
                {' · '}dépôt SAGE {res.meta.depot}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${res.meta.source_sage === 'photo' ? 'bg-[#E9F5EA] text-[#2F6F33]' : 'bg-[#FCEFD9] text-[#96600F]'}`}
                title={res.meta.source_sage === 'photo' ? '' : 'Stock SAGE actuel + BL / factures datés après J. Les réceptions fournisseurs et transferts postérieurs à J ne sont pas réintégrés.'}>
                {res.meta.source_sage === 'photo'
                  ? `SAGE fin de J = photo du ${fmtDateHeure(res.meta.photo_loaded_at)}`
                  : `SAGE fin de J reconstitué depuis le stock du ${fmtDateHeure(res.meta.stock_actuel_loaded_at)} (partiel)`}
              </span>
            </section>

            <section className="grid grid-cols-2 gap-2 md:grid-cols-5 xl:grid-cols-9">
              <Kpi label="Références" value={s.nb_references.toLocaleString('fr-FR')} sub={`MyStock ${fmtQte(s.qte_mystock)} · SAGE ${fmtQte(s.qte_sage)}`} onClick={() => setFiltre('tous')} actif={filtre === 'tous'} />
              <Kpi label="Identiques" value={s.nb_ok.toLocaleString('fr-FR')} tone="ok" sub={s.nb_references ? `${Math.round((s.nb_ok / s.nb_references) * 100)} % des références` : undefined} onClick={() => setFiltre('ok')} actif={filtre === 'ok'} />
              <Kpi label="BL non expédiés" value={s.nb_bl_jour.toLocaleString('fr-FR')} tone="info" sub={`BL SAGE pas encore partis · ${fmtEuro(s.valeur_bl_jour ?? 0)}`} onClick={() => setFiltre('bl_jour')} actif={filtre === 'bl_jour'} />
              <Kpi label="Transit vers FMS" value={(s.nb_transit ?? 0).toLocaleString('fr-FR')} tone="info" sub={`arrivé, non réceptionné SAGE · ${fmtEuro(s.valeur_transit ?? 0)}`} onClick={() => setFiltre('transit')} actif={filtre === 'transit'} />
              <Kpi label="Écarts à analyser" value={s.nb_ecart.toLocaleString('fr-FR')} tone={s.nb_ecart ? 'alerte' : 'ok'} onClick={() => setFiltre('ecart')} actif={filtre === 'ecart'} />
              <Kpi label="Absentes de MyStock" value={s.nb_absent_mystock.toLocaleString('fr-FR')} tone={s.nb_absent_mystock ? 'warn' : 'ok'} sub="stock SAGE, pas dans le fichier" onClick={() => setFiltre('absent_mystock')} actif={filtre === 'absent_mystock'} />
              <Kpi label="Absentes de SAGE" value={s.nb_absent_sage.toLocaleString('fr-FR')} tone={s.nb_absent_sage ? 'warn' : 'ok'} sub="dans le fichier, stock SAGE nul" onClick={() => setFiltre('absent_sage')} actif={filtre === 'absent_sage'} />
              <Kpi label="Restant à analyser" value={s.nb_a_analyser.toLocaleString('fr-FR')} tone={s.nb_a_analyser ? 'warn' : 'ok'} sub="non expliqués / non corrigés" onClick={() => { setFiltre('a_traiter'); setFiltreSuivi('a_analyser') }} actif={filtre === 'a_traiter' && filtreSuivi === 'a_analyser'} />
              <Kpi label="Valeur à analyser" value={fmtEuro(s.valeur_a_analyser_abs ?? s.valeur_ecart_abs)} sub={`tous écarts ${fmtEuro(s.valeur_ecart_abs)} (au PUMP FMS)`} tone={(s.valeur_a_analyser_abs ?? s.valeur_ecart_abs) ? 'alerte' : 'ok'} />
            </section>

            <section className="rounded-xl border border-[#E5E1D8] bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-[#EFECE5] px-3 py-2">
                {pastille('a_traiter', 'Écarts inexpliqués', s.nb_ecart + s.nb_absent_mystock + s.nb_absent_sage)}
                {pastille('ecart', 'Écarts', s.nb_ecart)}
                {pastille('absent_mystock', 'Absents MyStock', s.nb_absent_mystock)}
                {pastille('absent_sage', 'Absents SAGE', s.nb_absent_sage)}
                {pastille('bl_jour', 'BL non expédiés', s.nb_bl_jour)}
                {pastille('transit', 'Transit', s.nb_transit ?? 0)}
                {pastille('ok', 'Identiques', s.nb_ok)}
                {pastille('tous', 'Tout', s.nb_references)}
                <span className="mx-1 h-5 w-px bg-[#E5E1D8]" />
                <select value={filtreSuivi} onChange={(e) => setFiltreSuivi(e.target.value as typeof filtreSuivi)} className={ctl}>
                  <option value="tous">Suivi : tous</option>
                  {(Object.keys(SUIVIS) as Suivi[]).map((k) => <option key={k} value={k}>Suivi : {SUIVIS[k]}</option>)}
                </select>
                <select value={tri} onChange={(e) => setTri(e.target.value as typeof tri)} className={ctl}>
                  <option value="valeur">Tri : valeur de l’écart</option>
                  <option value="ecart">Tri : quantité de l’écart</option>
                  <option value="reference">Tri : référence</option>
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
                      <th className="px-2 py-1.5">Statut</th>
                      <th className="px-2 py-1.5 text-right">MyStock J</th>
                      <th className="px-2 py-1.5 text-right" title="Stock réel SAGE du dépôt FMS en fin de journée J (sto_qte), PL en cours comprises">SAGE fin J</th>
                      <th className="px-2 py-1.5 text-right">Écart</th>
                      <th className="px-2 py-1.5 text-right">Valeur</th>
                      <th className="px-2 py-1.5 text-right" title="BL / factures SAGE du dépôt FMS datés du jour de l’image">BL datés J</th>
                      <th className="px-2 py-1.5 text-right" title="BL / factures SAGE datés après J">BL après J</th>
                      <th className="px-2 py-1.5 text-right" title="Stock du dépôt SAGE TRANSIT FMS">Transit</th>
                      <th className="px-2 py-1.5 text-right">SAGE actuel</th>
                      <th className="px-2 py-1.5">Suivi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesFiltrees.slice(0, 1500).map((l) => (
                      <tr key={l.reference} onClick={() => void ouvrirFiche(l)}
                        className={`cursor-pointer border-t border-[#EFECE5] hover:bg-[#FAF9F6] ${fiche?.reference === l.reference ? 'bg-[#FCF6EC]' : ''}`}>
                        <td className="whitespace-nowrap px-2 py-1 font-mono font-semibold">{l.reference}</td>
                        <td className="max-w-[340px] truncate px-2 py-1" title={l.designation || ''}>{l.designation || '—'}</td>
                        <td className="px-2 py-1"><Badge statut={l.statut} /></td>
                        <td className="px-2 py-1 text-right">{fmtQte(l.qte_mystock)}</td>
                        <td className="px-2 py-1 text-right">{fmtQte(l.qte_sage)}</td>
                        <td className={`px-2 py-1 text-right font-bold ${l.ecart > 0 ? 'text-[#2D5F8C]' : l.ecart < 0 ? 'text-[#A3401C]' : 'text-[#8A8474]'}`}>{l.ecart ? signe(l.ecart) : '0'}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right">{l.ecart_valeur ? fmtEuro(l.ecart_valeur) : '—'}</td>
                        <td className="px-2 py-1 text-right">{l.bl_jour ? fmtQte(l.bl_jour) : ''}</td>
                        <td className="px-2 py-1 text-right text-[#8A8474]">{l.bl_apres ? fmtQte(l.bl_apres) : ''}</td>
                        <td className="px-2 py-1 text-right text-[#8A8474]">{l.transit ? fmtQte(l.transit) : ''}</td>
                        <td className="px-2 py-1 text-right text-[#8A8474]">{fmtQte(l.qte_sage_actuel)}</td>
                        <td className="max-w-[220px] truncate px-2 py-1 text-[12px]" title={l.suivi_commentaire || ''}>
                          {l.statut !== 'ok' && (
                            <>
                              <span className={`font-bold ${l.suivi_statut === 'corrige' ? 'text-[#2F6F33]' : l.suivi_statut === 'explique' ? 'text-[#2D5F8C]' : 'text-[#8A8474]'}`}>{SUIVIS[l.suivi_statut || 'a_analyser']}</span>
                              {l.suivi_commentaire ? ` · ${l.suivi_commentaire}` : ''}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {lignesFiltrees.length === 0 && (
                      <tr><td colSpan={12} className="px-3 py-6 text-center text-[13px] text-[#8A8474]">Aucune ligne pour ces filtres.</td></tr>
                    )}
                  </tbody>
                </table>
                {lignesFiltrees.length > 1500 && <div className="px-3 py-2 text-[12px] text-[#8A8474]">1 500 premières lignes affichées — affinez les filtres ou exportez en Excel.</div>}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Fiche référence */}
      {fiche && res && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={() => setFiche(null)}>
          <aside className="h-full w-full max-w-[560px] overflow-y-auto bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[16px] font-bold">{fiche.reference}</div>
                <div className="text-[13px] text-[#3A362E]">{fiche.designation || '—'}{fiche.famille ? ` · ${fiche.famille}` : ''}</div>
                <div className="mt-1"><Badge statut={fiche.statut} /></div>
              </div>
              <button type="button" className={btn} onClick={() => setFiche(null)}>✕</button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Kpi label={`MyStock ${fmtDate(res.controle.date_image)}`} value={fmtQte(fiche.qte_mystock)} sub={fiche.nb_lignes_fichier > 1 ? `${fiche.nb_lignes_fichier} lignes additionnées` : undefined} />
              <Kpi label="SAGE fin de J (stock réel)" value={fmtQte(fiche.qte_sage)} sub={fiche.prepa_fin_j ? `PL comprises : ${fmtQte(fiche.prepa_fin_j)}` : 'aucune PL en cours'} />
              <Kpi label="Écart" value={signe(fiche.ecart)} sub={fiche.ecart_valeur ? fmtEuro(fiche.ecart_valeur) : undefined} tone={fiche.ecart === 0 ? 'ok' : 'alerte'} />
            </div>

            <div className="mt-3 rounded-lg bg-[#FAF9F6] px-3 py-2 text-[12.5px] text-[#3A362E]">
              {fiche.statut === 'bl_jour' && <>L’écart est égal aux BL SAGE datés {fiche.bl_depuis && fiche.bl_depuis !== res.controle.date_image ? `du ${fmtDate(fiche.bl_depuis)} au ${fmtDate(res.controle.date_image)}` : `du ${fmtDate(res.controle.date_image)}`} ({fmtQte(fiche.bl_non_expedies ?? fiche.bl_jour)}) : BL saisis dans SAGE mais pas encore partis de chez FMS au moment de l’image.{fiche.bl_depuis && fiche.bl_depuis < res.controle.date_image ? ' Si le BL a plusieurs jours, vérifier avec FMS qu’il part bien.' : ' Rien à corriger.'}</>}
              {fiche.statut === 'transit' && <>L’écart correspond au stock SAGE du dépôt « TRANSIT {res.meta.depot} » ({fmtQte(fiche.transit)}){fiche.bl_non_expedies ? ` et à ${fmtQte(fiche.bl_non_expedies)} en BL non expédiés` : ''} : marchandise arrivée chez FMS mais pas encore réceptionnée dans SAGE.</>}
              {fiche.statut === 'absent_mystock' && <>La référence a du stock dans SAGE mais n’est pas dans le fichier MyStock.</>}
              {fiche.statut === 'absent_sage' && <>La référence est dans le fichier MyStock mais n’a pas de stock SAGE sur le dépôt FMS en fin de J.</>}
              {fiche.statut === 'ecart' && <>{fiche.ecart > 0 ? 'FMS a plus de stock que SAGE' : 'FMS a moins de stock que SAGE'}{fiche.bl_jour ? ` · BL SAGE datés de J : ${fmtQte(fiche.bl_jour)}` : ''}{fiche.transit ? ` · ${fmtQte(fiche.transit)} en transit vers FMS dans SAGE` : ''}.</>}
              {fiche.statut === 'ok' && <>Stocks identiques.</>}
            </div>

            <h3 className="mt-4 text-[12px] font-bold uppercase tracking-wide text-[#8A8474]">Mouvements SAGE FMS de J − 7 j à aujourd’hui</h3>
            {!mouvements ? <div className="py-2 text-[12.5px] text-[#8A8474]">Chargement…</div> : (
              <>
                <table className="mt-1 w-full text-[12px]">
                  <thead className="text-left text-[10.5px] uppercase tracking-wide text-[#8A8474]">
                    <tr><th className="py-1">Date</th><th className="py-1">Pièce</th><th className="py-1">Client</th><th className="py-1 text-right">Qté sortie</th></tr>
                  </thead>
                  <tbody>
                    {mouvements.mouvements.map((m, i) => (
                      <tr key={`${m.numero}-${i}`} className={`border-t border-[#EFECE5] ${m.position === 'jour' ? 'bg-[#E4EEF8]' : m.position === 'apres' ? 'text-[#8A8474]' : ''}`}>
                        <td className="py-1">{fmtDate(m.date)}{m.position === 'jour' ? ' · J' : ''}</td>
                        <td className="py-1 font-mono">{m.numero}</td>
                        <td className="max-w-[200px] truncate py-1">{m.client}</td>
                        <td className="py-1 text-right font-semibold">{fmtQte(m.quantite)}</td>
                      </tr>
                    ))}
                    {mouvements.mouvements.length === 0 && <tr><td colSpan={4} className="py-2 text-[#8A8474]">Aucun BL sur la période.</td></tr>}
                  </tbody>
                </table>
                {mouvements.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                    <span className="font-bold text-[#8A8474]">Stock SAGE fin de journée :</span>
                    {mouvements.photos.map((p) => (
                      <span key={p.date_stock} className={`rounded-full border px-2 py-0.5 ${p.date_stock === res.controle.date_image ? 'border-[#111820] font-bold' : 'border-[#E5E1D8]'}`}>
                        {fmtDate(p.date_stock)} : {fmtQte(p.qte)}{p.prepa ? ` (PL ${fmtQte(p.prepa)})` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11.5px] text-[#8A8474]">Les réceptions fournisseurs et transferts entre dépôts ne figurent pas dans les données SAGE importées.</p>
              </>
            )}

            {fiche.statut !== 'ok' && (
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
                  placeholder="Explication, action menée (régularisation SAGE, demande à FMS…)"
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
