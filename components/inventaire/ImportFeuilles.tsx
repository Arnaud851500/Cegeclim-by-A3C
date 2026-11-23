'use client'

/**
 * components/inventaire/ImportFeuilles.tsx — Intégration des feuilles de comptage scannées
 * ---------------------------------------------------------------------------
 * Créé le 23/11/2026 (demandé par Arnaud). Ouvert depuis :
 *   - l'écran de saisie d'un dépôt (/stock/inventaire/saisie) : la liste cible est celle du
 *     dépôt affiché (alerte si l'en-tête de la feuille désigne une autre liste) ;
 *   - l'écran de pilotage (/stock/inventaire) : la liste cible de chaque page est retrouvée
 *     par l'en-tête du document (code « INV-xxxxxxxx-Cn » imprimé depuis le 23/11/2026, sinon
 *     nom du dépôt du titre), modifiable page par page.
 *
 * Déroulé : PDF (ou photos) → une image par page → lecture IA (/api/stock/inventaire/lire-feuille,
 * même reconnaissance que « Quand puis-je livrer ? ») → REVUE par l'utilisateur → enregistrement
 * par les RPC habituelles (inv_saisir, inv_ajouter_hors_liste), avec les mêmes contrôles qu'à l'écran.
 *
 * Règles fixées par Arnaud :
 *   - initiales de l'équipe reprises du cadre « Équipe(s) » de la feuille ; une feuille peut servir
 *     à 2 équipes (initiales par ligne dans la colonne « Éq. », sinon choix à la revue) ;
 *   - quantités et commentaires pré-saisis ; case barrée / gribouillée (ou vide) = pas de quantité ;
 *   - référence déjà saisie (en base ou par une autre page du lot) : la quantité lue est proposée
 *     EN AJOUT, avec une alerte à confirmer avant l'enregistrement (ou remplacer / ignorer) ;
 *   - rien n'est enregistré sans la validation de la personne qui intègre le document.
 *   - 23/11/2026 : contrôle de décalage de ligne — l'IA relève, pour chaque écriture, la réf.
 *     fournisseur et la qté stock IMPRIMÉES de sa ligne ; si elles ne correspondent pas à la ligne
 *     de la liste, ou si l'écriture est à cheval sur deux lignes, la ligne est « à vérifier »
 *     (proposition de la bonne référence en un clic) et la case de vérification est exigée.
 *   - 23/11/2026 (idée d'Arnaud) : n° de ligne imprimé (colonne « N° » = inventaire_lignes.id) :
 *     rapprochement d'abord par ce numéro ; s'il concorde avec la référence lue (à une erreur de
 *     lecture près), pas de contrôle de décalage. Anciennes feuilles : rapprochement par référence.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  ORDINAL, codeListe, fmtQte, lireCodeListe, lireQuantite, membresCommuns, messageErreur, normaliserEquipe,
  type LigneSaisie, type ListeSaisie,
} from '@/lib/inventaire'
import {
  cleRef, enParallele, equipesDe, lireFeuille, pagesEnImages, refsProches, trouverLigne,
  type EtatLu, type FeuilleLue,
} from '@/lib/inventaireImport'

export type DepotCible = {
  id: string
  depot_libelle: string
  depot_num: string
  statut: string
  comptage_courant: number
  campagne?: { libelle: string } | null
}

type Props = {
  depots: DepotCible[]
  /** Écran de saisie d'un dépôt : la liste cible est imposée. */
  depotFixe?: string | null
  equipeParDefaut?: string
  onFermer: () => void
  onEnregistre: () => void
}

type Etape = 'choix' | 'lecture' | 'revue' | 'enregistrement' | 'fin'
type Action = 'auto' | 'ajouter' | 'remplacer' | 'ignorer'

type PageRev = {
  cle: string
  fichier: string
  page: number
  nbPages: number
  image: string
  lu: FeuilleLue | null
  erreur: string | null
  cibleId: string | null
  motif: string
  alerteCible: string | null
  equipes: string
}

type LigneRev = {
  cle: string
  pageCle: string
  horsListe: boolean
  refLue: string
  ref: string
  qteLue: number | null
  etat: EtatLu
  doute: boolean
  comLu: string
  equipe: string
  qte: string
  com: string
  action: Action
  /** N° de ligne imprimé lu sur la feuille (inventaire_lignes.id), null sur les anciennes feuilles. */
  no: number | null
  refFournLue: string
  qteStockLue: number | null
  positionIncertaine: boolean
  refVoisine: string
  /** Référence confirmée ou corrigée à la main : plus de contrôle de décalage. */
  verifiee: boolean
}

type Calcul = {
  ligne: LigneSaisie | null
  liste: ListeSaisie | null
  equipe: string
  existant: number | null
  existantEquipe: string | null
  resolu: 'saisir' | 'ajouter' | 'remplacer' | 'ignorer' | 'hors_liste' | null
  apres: number | null
  erreur: string | null
  info: string | null
  cleCible: string | null
  /** Décalage de ligne possible : message et références proposées. */
  verif: string | null
  propositions: string[]
}

type Ecriture = {
  cle: string
  invDepotId: string
  numero: number
  ligneId: number | null
  ref: string
  qte: number
  com: string | null
  equipe: string
  horsListe: boolean
  libelle: string
}

const norm = (v: string) => v.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '')
const vQ = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))

const ETAT_LIB: Record<EtatLu, string> = { vide: 'vide', lisible: 'lu', corrige: 'corrigé', barre: 'barré', illisible: 'illisible' }
const ETAT_CLS: Record<EtatLu, string> = {
  vide: 'bg-[#F4F3F0] text-[#8A8474]', lisible: 'bg-[#E9F5EA] text-[#2F6F33]', corrige: 'bg-[#E8F0FB] text-[#1D4F91]',
  barre: 'bg-[#F7E3E1] text-[#B42318]', illisible: 'bg-[#FDF3E3] text-[#96600F]',
}

function detecterCible(lu: FeuilleLue, depots: DepotCible[]): { id: string | null; motif: string } {
  const code = lireCodeListe(lu.entete.code_liste)
  if (code) {
    const d = depots.find((x) => x.id.replace(/-/g, '').toUpperCase().startsWith(code.prefixe))
    if (d) return { id: d.id, motif: `code ${codeListe(d.id, code.numero)}` }
  }
  const t = norm(`${lu.entete.depot} ${lu.entete.titre}`)
  if (t) {
    const cands = depots.filter((d) => t.includes(norm(d.depot_libelle)))
    if (cands.length === 1) return { id: cands[0].id, motif: `dépôt « ${cands[0].depot_libelle} » du titre` }
    const parNom = depots.filter((d) => {
      const n = norm(d.depot_libelle.replace(/CEGECLIM/i, ''))
      return n.length >= 3 && t.includes(n)
    })
    if (parNom.length === 1) return { id: parNom[0].id, motif: `dépôt « ${parNom[0].depot_libelle} » du titre` }
  }
  return { id: null, motif: 'liste non reconnue dans l’en-tête' }
}

function comptageFeuille(lu: FeuilleLue | null): number | null {
  if (!lu) return null
  return lireCodeListe(lu.entete.code_liste)?.numero ?? lu.entete.comptage ?? null
}

export default function ImportFeuilles({ depots, depotFixe, equipeParDefaut, onFermer, onEnregistre }: Props) {
  const [etape, setEtape] = useState<Etape>('choix')
  const [progres, setProgres] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [pages, setPages] = useState<PageRev[]>([])
  const [lignes, setLignes] = useState<LigneRev[]>([])
  const [listes, setListes] = useState<Record<string, ListeSaisie>>({})
  const [voirVides, setVoirVides] = useState(false)
  const [ajoutsVus, setAjoutsVus] = useState(false)
  const [imageVue, setImageVue] = useState<string | null>(null)
  const [resultat, setResultat] = useState<{ ok: number; erreurs: Array<{ libelle: string; msg: string }> } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const chargees = useRef<Set<string>>(new Set())

  const depotsParId = useMemo(() => new Map(depots.map((d) => [d.id, d])), [depots])

  async function chargerListe(id: string) {
    if (chargees.current.has(id)) return
    chargees.current.add(id)
    const { data, error } = await supabase.rpc('inv_saisie_liste', { p_inv_depot_id: id })
    if (error) { chargees.current.delete(id); setErreur(`${depotsParId.get(id)?.depot_libelle || 'Liste'} : ${messageErreur(error)}`); return }
    setListes((cur) => ({ ...cur, [id]: data as ListeSaisie }))
  }

  // Listes des cibles choisies (y compris après changement de cible à la revue).
  const ciblesUtilisees = useMemo(() => Array.from(new Set(pages.map((p) => p.cibleId).filter((x): x is string => !!x))), [pages])
  useEffect(() => {
    for (const id of ciblesUtilisees) void chargerListe(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargerListe mémorise ses chargements
  }, [ciblesUtilisees])

  async function lancer(fichiers: File[]) {
    if (!fichiers.length) return
    setErreur(null); setEtape('lecture')
    try {
      const imgs = await pagesEnImages(fichiers, setProgres)
      if (!imgs.length) throw new Error('Aucune page trouvée dans le document.')
      let faites = 0
      setProgres(`Lecture des feuilles : 0 / ${imgs.length} page(s)…`)
      const lues = await enParallele(imgs, 3, async (im) => {
        try {
          const lu = await lireFeuille(im.image)
          return { lu, erreur: null as string | null }
        } catch (e) {
          return { lu: null, erreur: messageErreur(e) }
        } finally {
          faites++
          setProgres(`Lecture des feuilles : ${faites} / ${imgs.length} page(s)…`)
        }
      })
      const nPages: PageRev[] = []
      const nLignes: LigneRev[] = []
      // Équipe de la page précédente du même fichier : le cadre n'est pas toujours rempli sur chaque feuille.
      let equipePrec = ''
      let fichierPrec = ''
      imgs.forEach((im, i) => {
        const { lu, erreur: err } = lues[i]
        let cibleId: string | null = null
        let motif = ''
        let alerteCible: string | null = null
        if (lu) {
          const det = detecterCible(lu, depots)
          if (depotFixe) {
            cibleId = depotFixe
            motif = 'liste de cet écran'
            if (det.id && det.id !== depotFixe) alerteCible = `L’en-tête désigne la liste « ${depotsParId.get(det.id)?.depot_libelle || det.motif} » et non celle de cet écran.`
            else if (!det.id && lu.entete.depot && !norm(lu.entete.depot).includes(norm(depotsParId.get(depotFixe)?.depot_libelle || '').slice(0, 5)))
              alerteCible = `L’en-tête indique « ${lu.entete.depot} » : vérifier qu’il s’agit bien de ce dépôt.`
          } else {
            cibleId = det.id
            motif = det.motif
          }
        }
        if (im.fichier !== fichierPrec) { equipePrec = ''; fichierPrec = im.fichier }
        const eqLues = lu?.entete.equipes || []
        const equipes = eqLues.length ? eqLues.join(', ') : equipePrec || ''
        if (eqLues.length) equipePrec = eqLues.join(', ')
        nPages.push({ cle: im.cle, fichier: im.fichier, page: im.page, nbPages: im.nbPages, image: im.image, lu, erreur: err, cibleId, motif, alerteCible, equipes: equipes || (depotFixe ? equipeParDefaut || '' : '') })
        for (const [k, l] of (lu?.lignes || []).entries()) {
          nLignes.push({
            cle: `${im.cle}:${k}`, pageCle: im.cle, horsListe: false, refLue: l.ref, ref: l.ref, qteLue: l.qte, etat: l.etat, doute: l.doute,
            comLu: l.commentaire, equipe: l.equipe, qte: l.etat === 'barre' || l.etat === 'vide' ? '' : vQ(l.qte), com: l.commentaire, action: 'auto',
            no: l.no ?? null, refFournLue: l.ref_fournisseur || '', qteStockLue: l.qte_stock ?? null, positionIncertaine: !!l.position_incertaine, refVoisine: l.ref_voisine || '', verifiee: false,
          })
        }
        for (const [k, l] of (lu?.hors_liste || []).entries()) {
          nLignes.push({
            cle: `${im.cle}:HL${k}`, pageCle: im.cle, horsListe: true, refLue: l.ref, ref: l.ref, qteLue: l.qte, etat: l.qte === null ? 'illisible' : 'lisible', doute: false,
            comLu: l.commentaire, equipe: '', qte: vQ(l.qte), com: l.commentaire, action: 'auto',
            no: null, refFournLue: '', qteStockLue: null, positionIncertaine: false, refVoisine: '', verifiee: true,
          })
        }
      })
      setPages(nPages); setLignes(nLignes); setAjoutsVus(false)
      setEtape('revue')
    } catch (e) {
      setErreur(messageErreur(e)); setEtape('choix')
    }
  }

  // ── Calcul de la revue : rapprochement, cumul des quantités, contrôles ─────────────
  const { calculs, ecritures, stats } = useMemo(() => {
    const pageParCle = new Map(pages.map((p) => [p.cle, p]))
    type Run = { val: number | null; equipe: string | null; dbCom: string; garderDbCom: boolean; coms: string[]; sources: string[]; ecr: Ecriture | null }
    const runs = new Map<string, Run>()
    const out = new Map<string, Calcul>()
    for (const r of lignes) {
      const p = pageParCle.get(r.pageCle)
      const liste = p?.cibleId ? listes[p.cibleId] || null : null
      const c: Calcul = { ligne: null, liste, equipe: '', existant: null, existantEquipe: null, resolu: null, apres: null, erreur: null, info: null, cleCible: null, verif: null, propositions: [] }
      out.set(r.cle, c)
      if (!p || !p.lu) { c.erreur = 'page non lue'; continue }
      if (!p.cibleId) { c.erreur = 'liste à choisir pour la page'; continue }
      if (!liste) { c.info = 'chargement de la liste…'; continue }
      // Rapprochement : n° de ligne imprimé d'abord (clé stable), puis référence lue.
      const parNo = !r.verifiee && r.no !== null ? liste.lignes.find((x) => x.id === r.no) || null : null
      const parRef = trouverLigne(liste.lignes, r.ref)
      let cleSure = false
      if (parNo && (!parRef || parRef.id === parNo.id || refsProches(r.ref, parNo.reference))) { c.ligne = parNo; cleSure = true }
      else if (parNo && parRef) {
        // N° et référence désignent deux lignes différentes : on garde la référence, à vérifier.
        c.ligne = parRef
        c.verif = `Ligne à vérifier sur le scan : n° ${r.no} lu (= ${parNo.reference}) mais référence ${r.ref}`
        c.propositions = [parNo.reference]
      } else c.ligne = parRef
      // Contrôle de décalage : ancres imprimées de la ligne de l'écriture vs ligne de la liste.
      if (!cleSure && !c.verif && !r.verifiee && (r.qteLue !== null || r.etat !== 'vide')) {
        const props = new Set<string>()
        const motifs: string[] = []
        if (r.positionIncertaine) {
          motifs.push(`écriture à cheval${r.refVoisine ? ` avec la ligne ${r.refVoisine}` : ' sur deux lignes'}`)
          const v = r.refVoisine ? trouverLigne(liste.lignes, r.refVoisine) : null
          if (v) props.add(v.reference)
        }
        if (c.ligne) {
          // Tolérance de lecture : une lettre d'écart sur la réf. fournisseur n'est pas un décalage.
          const stockKo = r.qteStockLue !== null && Math.abs(r.qteStockLue - c.ligne.qte_theorique) > 1e-9
          const fournKo = !!r.refFournLue && !!c.ligne.ref_fournisseur && !refsProches(r.refFournLue, c.ligne.ref_fournisseur)
          if (stockKo || fournKo) {
            motifs.push(`la feuille porte ${[fournKo ? `réf. fourn. ${r.refFournLue}` : '', stockKo ? `stock ${fmtQte(r.qteStockLue)}` : ''].filter(Boolean).join(' / ')} sur cette ligne (liste : ${c.ligne.ref_fournisseur || '—'} / ${fmtQte(c.ligne.qte_theorique)})`)
            // Propositions : uniquement les lignes voisines (2 au-dessus / 2 au-dessous) qui collent aux valeurs lues.
            const i = liste.lignes.findIndex((x) => x.id === c.ligne?.id)
            const voisines = liste.lignes.slice(Math.max(0, i - 2), i + 3).filter((x) => x.id !== c.ligne?.id)
            for (const x of voisines) {
              const okStock = r.qteStockLue === null || Math.abs(x.qte_theorique - r.qteStockLue) < 1e-9
              const okFourn = !r.refFournLue || refsProches(r.refFournLue, x.ref_fournisseur)
              if (okStock && okFourn) props.add(x.reference)
            }
          }
        }
        if (motifs.length) { c.verif = `Ligne à vérifier sur le scan : ${motifs.join(' ; ')}`; c.propositions = Array.from(props).slice(0, 3) }
      }
      // Même avec un n° de ligne sûr, une écriture à cheval sur deux lignes reste à vérifier.
      if (cleSure && !r.verifiee && r.positionIncertaine && r.qteLue !== null) {
        const v = r.refVoisine ? trouverLigne(liste.lignes, r.refVoisine) : null
        c.verif = `Ligne à vérifier sur le scan : écriture à cheval${v ? ` avec la ligne ${v.reference}` : ' sur deux lignes'}`
        c.propositions = v ? [v.reference] : []
      }
      const q = lireQuantite(r.qte)
      if (q === null) { c.resolu = 'ignorer'; c.info = r.etat === 'barre' ? 'case barrée : pas de saisie' : r.etat === 'vide' ? 'non comptée sur la feuille' : 'pas de quantité'; continue }
      const ouverte = liste.statut === 'comptage' && liste.comptages.some((k) => k.numero === liste.numero && k.statut === 'en_cours')
      if (!ouverte) { c.erreur = 'liste non ouverte à la saisie'; continue }
      const nf = comptageFeuille(p.lu)
      if (nf !== null && nf !== liste.numero) { c.erreur = `feuille du ${ORDINAL[nf]} comptage, liste au ${ORDINAL[liste.numero]}`; continue }
      if (Number.isNaN(q) || q < 0) { c.erreur = 'quantité invalide'; continue }
      if (r.action === 'ignorer') { c.resolu = 'ignorer'; c.info = 'ignorée'; continue }
      const eqPage = equipesDe(p.equipes)
      c.equipe = normaliserEquipe(r.equipe) || (eqPage.length === 1 ? eqPage[0] : '')
      if (!c.equipe) { c.erreur = eqPage.length > 1 ? 'équipe à choisir (feuille à 2 équipes)' : 'initiales de l’équipe à saisir'; continue }
      if (!c.ligne) {
        if (liste.numero !== 1) { c.erreur = 'référence absente du recomptage'; continue }
        if (!r.horsListe && r.action === 'auto') { c.erreur = 'référence absente de la liste : corriger la réf. ou choisir « ajouter hors liste »'; continue }
      }
      if (c.ligne) {
        const communs = membresCommuns(c.equipe, c.ligne.equipes_prec)
        if (communs.length) { c.erreur = `déjà comptée par ${communs.join('/')} au comptage précédent`; continue }
      }
      const cle = c.ligne ? `${p.cibleId}:${c.ligne.id}` : `${p.cibleId}:HL:${cleRef(r.ref)}`
      c.cleCible = cle
      let run = runs.get(cle)
      if (!run) {
        run = { val: c.ligne?.qte ?? null, equipe: c.ligne?.initiales ?? null, dbCom: c.ligne?.commentaire || '', garderDbCom: true, coms: [], sources: [], ecr: null }
        if (run.val !== null) run.sources.push(`${fmtQte(run.val)} (${run.equipe || 'saisi'})`)
        runs.set(cle, run)
      }
      c.existant = run.val
      c.existantEquipe = run.equipe
      if (run.val === null) c.resolu = c.ligne ? 'saisir' : 'hors_liste'
      else c.resolu = r.action === 'remplacer' ? 'remplacer' : 'ajouter'
      if (c.resolu === 'remplacer') { run.val = q; run.sources = []; run.coms = []; run.garderDbCom = false }
      else run.val = (run.val ?? 0) + q
      run.sources.push(`${fmtQte(q)} (${c.equipe})`)
      run.equipe = c.equipe
      if (r.com.trim()) run.coms.push(r.com.trim())
      c.apres = run.val
      const ref = c.ligne?.reference || r.ref.toUpperCase().trim()
      run.ecr = {
        cle, invDepotId: p.cibleId, numero: liste.numero, ligneId: c.ligne?.id ?? null, ref, qte: run.val, com: null, equipe: c.equipe,
        horsListe: !c.ligne, libelle: `${liste.depot_libelle} · ${ref}`,
      }
      const coms = Array.from(new Set([...(run.garderDbCom && run.dbCom ? [run.dbCom] : []), ...run.coms]))
      const cumul = run.sources.length > 1 ? `cumul ${run.sources.join(' + ')}` : ''
      run.ecr.com = [...coms, cumul].filter(Boolean).join(' · ').slice(0, 300) || null
    }
    const ecr = Array.from(runs.values()).map((x) => x.ecr).filter((x): x is Ecriture => !!x)
    const vals = Array.from(out.values())
    return {
      calculs: out,
      ecritures: ecr,
      stats: {
        ajouts: vals.filter((c) => c.resolu === 'ajouter').length,
        remplacements: vals.filter((c) => c.resolu === 'remplacer').length,
        erreurs: vals.filter((c) => c.erreur).length,
        verifs: vals.filter((c) => c.verif && !c.erreur && c.resolu !== 'ignorer').length,
        horsListe: ecr.filter((e) => e.horsListe).length,
      },
    }
  }, [lignes, pages, listes])

  function majLigne(cle: string, patch: Partial<LigneRev>) {
    setLignes((cur) => cur.map((l) => (l.cle === cle ? { ...l, ...patch } : l)))
    if ('action' in patch || 'qte' in patch || 'ref' in patch) setAjoutsVus(false)
  }
  function majPage(cle: string, patch: Partial<PageRev>) {
    setPages((cur) => cur.map((p) => (p.cle === cle ? { ...p, ...patch } : p)))
    setAjoutsVus(false)
  }

  async function enregistrer() {
    setEtape('enregistrement'); setErreur(null)
    let ok = 0
    const erreurs: Array<{ libelle: string; msg: string }> = []
    let faites = 0
    await enParallele(ecritures, 4, async (e) => {
      try {
        let id = e.ligneId
        if (id === null) {
          const { data, error } = await supabase.rpc('inv_ajouter_hors_liste', { p_inv_depot_id: e.invDepotId, p_reference: e.ref })
          if (error) throw error
          id = (data as { id: number }).id
        }
        const { error } = await supabase.rpc('inv_saisir', { p_ligne_id: id, p_numero: e.numero, p_qte: e.qte, p_commentaire: e.com, p_initiales: e.equipe })
        if (error) throw error
        ok++
      } catch (err) {
        erreurs.push({ libelle: e.libelle, msg: messageErreur(err) })
      } finally {
        faites++
        setProgres(`Enregistrement : ${faites} / ${ecritures.length}…`)
      }
    })
    setResultat({ ok, erreurs })
    setEtape('fin')
    onEnregistre()
  }

  const lignesVisibles = lignes.filter((r) => voirVides || r.etat !== 'vide' || lireQuantite(r.qte) !== null)
  const nbVides = lignes.length - lignesVisibles.length
  const aVerifier = stats.ajouts + stats.remplacements + stats.verifs
  const peutEnregistrer = ecritures.length > 0 && (aVerifier === 0 || ajoutsVus)
  const ctl = 'h-8 rounded-md border border-[#D9D4C7] bg-white px-2 text-[12.5px] outline-none focus:border-[#B4761A]'
  const btn = 'h-9 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[13px] font-bold text-[#3A362E] hover:bg-[#F4F3F0] disabled:opacity-40'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 p-2 sm:p-4">
      <div className="flex w-full max-w-[1600px] flex-col overflow-hidden rounded-xl bg-[#F4F3F0] shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E1D8] bg-white px-4 py-2.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">Inventaire — intégration de feuilles scannées</p>
            <h2 className="text-[17px] font-bold">
              {depotFixe ? depotsParId.get(depotFixe)?.depot_libelle : 'Toutes les listes de la campagne'}
              {etape === 'revue' && ` · ${pages.length} page(s) lue(s)`}
            </h2>
          </div>
          <button type="button" className={btn} onClick={onFermer} disabled={etape === 'lecture' || etape === 'enregistrement'}>Fermer</button>
        </div>

        {erreur && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-800">{erreur}</div>}

        {etape === 'choix' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void lancer(Array.from(e.dataTransfer.files)) }}>
            <div className="text-[44px]">📄</div>
            <p className="max-w-[640px] text-[14px] text-[#3A362E]">
              Déposez ici le PDF des feuilles de comptage scannées (plusieurs fichiers possibles, photos acceptées).
              Chaque page est lue : initiales de l’équipe, quantités et commentaires manuscrits sont <b>proposés</b> ; rien n’est enregistré avant votre validation.
            </p>
            <p className="max-w-[640px] text-[12.5px] text-[#8A8474]">
              {depotFixe
                ? 'Les feuilles sont saisies dans la liste de cet écran (alerte si l’en-tête désigne une autre liste).'
                : 'La liste de chaque page est retrouvée par son en-tête (code « Liste INV-… » ou nom du dépôt) ; vous pourrez la corriger.'}
            </p>
            <button type="button" className="h-11 rounded-lg bg-[#111820] px-5 text-[14px] font-bold text-white" onClick={() => inputRef.current?.click()}>Choisir les fichiers…</button>
            <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple className="hidden"
              onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; void lancer(f) }} />
          </div>
        )}

        {(etape === 'lecture' || etape === 'enregistrement') && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#E5E1D8] border-t-[#B4761A]" />
            <p className="text-[14px] font-semibold text-[#3A362E]">{progres || 'Traitement…'}</p>
            {etape === 'lecture' && <p className="text-[12px] text-[#8A8474]">Une à deux minutes par page manuscrite, 3 pages lues en parallèle : vous pouvez laisser la fenêtre ouverte.</p>}
          </div>
        )}

        {etape === 'fin' && resultat && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-[40px]">{resultat.erreurs.length ? '⚠️' : '✅'}</div>
            <p className="text-[16px] font-bold">{resultat.ok} ligne(s) enregistrée(s){resultat.erreurs.length ? `, ${resultat.erreurs.length} en erreur` : ''}.</p>
            {resultat.erreurs.length > 0 && (
              <ul className="max-h-[40vh] w-full max-w-[760px] overflow-auto rounded-lg border border-red-200 bg-white p-3 text-left text-[12.5px]">
                {resultat.erreurs.map((e, i) => <li key={i} className="py-0.5"><b>{e.libelle}</b> : <span className="text-red-700">{e.msg}</span></li>)}
              </ul>
            )}
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => { setPages([]); setLignes([]); setResultat(null); setEtape('choix') }}>Intégrer d’autres feuilles</button>
              <button type="button" className="h-9 rounded-lg bg-[#111820] px-4 text-[13px] font-bold text-white" onClick={onFermer}>Terminer</button>
            </div>
          </div>
        )}

        {etape === 'revue' && (
          <>
            <div className="flex-1 overflow-auto px-4 py-3">
              {/* Pages */}
              <section className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {pages.map((p) => {
                  const liste = p.cibleId ? listes[p.cibleId] : null
                  const nf = comptageFeuille(p.lu)
                  const eqs = equipesDe(p.equipes)
                  return (
                    <div key={p.cle} className={`flex gap-2.5 rounded-xl border bg-white p-2.5 ${p.erreur || !p.cibleId || p.alerteCible ? 'border-[#F0D4A6]' : 'border-[#E5E1D8]'}`}>
                      <button type="button" onClick={() => setImageVue(p.image)} title="Voir la page" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local d'une page scannée */}
                        <img src={p.image} alt={`${p.fichier} page ${p.page}`} className="h-[86px] w-[120px] rounded border border-[#E5E1D8] object-cover object-top" />
                      </button>
                      <div className="min-w-0 flex-1 text-[12px]">
                        <div className="truncate font-bold" title={p.fichier}>{p.fichier} · p. {p.page}/{p.nbPages}{p.lu?.entete.feuille ? ` · ${p.lu.entete.feuille}` : ''}</div>
                        {p.erreur ? <div className="font-semibold text-red-700">{p.erreur}</div> : (
                          <>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[#8A8474]">Liste</span>
                              <select value={p.cibleId || ''} disabled={!!depotFixe} onChange={(e) => majPage(p.cle, { cibleId: e.target.value || null, motif: 'choix manuel', alerteCible: null })} className={`${ctl} min-w-0 flex-1`}>
                                <option value="">— à choisir —</option>
                                {depots.map((d) => <option key={d.id} value={d.id}>{d.depot_libelle}{d.statut === 'comptage' ? ` (${ORDINAL[d.comptage_courant]} comptage)` : ' (non ouverte)'}</option>)}
                              </select>
                            </div>
                            <div className="mt-0.5 text-[11px] text-[#8A8474]">
                              {p.motif}{nf ? ` · feuille du ${ORDINAL[nf]} comptage` : ''}
                              {liste && nf && nf !== liste.numero && <span className="font-semibold text-red-700"> · la liste est au {ORDINAL[liste.numero]} comptage</span>}
                            </div>
                            {p.alerteCible && <div className="text-[11px] font-semibold text-[#96600F]">⚠ {p.alerteCible}</div>}
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[#8A8474]">Équipe(s)</span>
                              <input value={p.equipes} onChange={(e) => majPage(p.cle, { equipes: e.target.value.toUpperCase() })} placeholder="ex. PJC/AV, LD" className={`${ctl} w-40 font-bold tracking-wider`} />
                              {eqs.length > 1 && <span className="text-[11px] text-[#1D4F91]">2 équipes : préciser l’équipe des lignes sans « Éq. »</span>}
                              {eqs.length === 0 && <span className="text-[11px] font-semibold text-[#B4761A]">à saisir</span>}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>

              {/* Alerte ajouts */}
              {aVerifier > 0 && (
                <section className="mb-3 rounded-xl border border-[#F0D4A6] bg-[#FDF3E3] px-3 py-2.5 text-[13px] text-[#6B4A10]">
                  {stats.verifs > 0 && (
                    <div className="mb-1"><b>⚠ {stats.verifs} écriture(s) peut-être sur la mauvaise ligne</b> (chiffre à cheval sur deux lignes ou référence imprimée qui ne correspond pas) :
                      vérifiez sur le scan (clic sur « p. X ») et corrigez la référence si besoin — un clic sur la référence proposée suffit.</div>
                  )}
                  {stats.ajouts + stats.remplacements > 0 && (<div>
                  <b>⚠ {stats.ajouts + stats.remplacements} ligne(s) portent sur une référence déjà saisie</b> (en base ou sur une autre page de ce lot).
                  {stats.ajouts > 0 && <> La quantité lue sera <b>AJOUTÉE</b> à la quantité existante pour {stats.ajouts} d’entre elles</>}
                  {stats.remplacements > 0 && <>{stats.ajouts > 0 ? ' ;' : ''} {stats.remplacements} remplaceront la quantité existante</>}.
                  Vérifiez les lignes surlignées en orange (choix « ajouter / remplacer / ignorer » par ligne).</div>)}
                  <label className="mt-1.5 flex items-center gap-2 font-bold">
                    <input type="checkbox" checked={ajoutsVus} onChange={(e) => setAjoutsVus(e.target.checked)} className="h-4 w-4" />
                    J’ai vérifié ces lignes{stats.ajouts + stats.remplacements > 0 ? ' : appliquer les ajouts / remplacements' : ''}
                  </label>
                </section>
              )}

              {/* Lignes */}
              <section className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-[#EFECE4] px-3 py-2 text-[12px] text-[#5E5A44]">
                  <span><b>{lignes.filter((r) => r.etat !== 'vide' || lireQuantite(r.qte) !== null).length}</b> ligne(s) comptée(s) lue(s)</span>
                  {nbVides > 0 && <button type="button" className="font-bold text-[#1D4F91] underline" onClick={() => setVoirVides(true)}>afficher aussi les {nbVides} ligne(s) non comptées</button>}
                  {voirVides && <button type="button" className="font-bold text-[#1D4F91] underline" onClick={() => setVoirVides(false)}>masquer les lignes non comptées</button>}
                  <span className="ml-auto">Cliquer sur la page pour voir le scan · référence modifiable si mal lue</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1250px] border-collapse text-[12.5px]">
                    <thead className="bg-[#FAF8F3] text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474]">
                      <tr>
                        <th className="px-2 py-2">Page</th><th className="px-2 py-2">Référence</th><th className="px-2 py-2">Désignation</th>
                        <th className="px-2 py-2 text-center">Lu</th><th className="px-2 py-2 text-center">Qté</th><th className="px-2 py-2">Équipe</th>
                        <th className="px-2 py-2 text-right">Déjà saisi</th><th className="px-2 py-2">Action</th><th className="px-2 py-2 text-right">Après</th>
                        <th className="px-2 py-2">Commentaire</th><th className="px-2 py-2 min-w-[220px]">Contrôle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesVisibles.map((r) => {
                        const c = calculs.get(r.cle)
                        const p = pages.find((x) => x.cle === r.pageCle)
                        const eqPage = p ? equipesDe(p.equipes) : []
                        const alerte = c?.resolu === 'ajouter' || c?.resolu === 'remplacer' || (!!c?.verif && c?.resolu !== 'ignorer')
                        const bg = c?.erreur ? 'bg-[#FDF0EF]' : alerte ? 'bg-[#FFF6E6]' : c?.resolu === 'ignorer' ? 'bg-[#FAFAF8] text-[#8A8474]' : ''
                        return (
                          <tr key={r.cle} className={`border-t border-[#EFECE4] ${bg}`}>
                            <td className="whitespace-nowrap px-2 py-1">
                              <button type="button" className="font-semibold text-[#1D4F91] underline" onClick={() => p && setImageVue(p.image)}>p. {p?.page}</button>
                              {r.horsListe && <span className="ml-1 rounded bg-[#FDF3E3] px-1 text-[10px] font-bold text-[#96600F]">hors liste</span>}
                            </td>
                            <td className="px-2 py-1">
                              <input value={!r.verifiee && c?.ligne ? c.ligne.reference : r.ref} list={p?.cibleId ? `inv-refs-${p.cibleId}` : undefined}
                                onChange={(e) => majLigne(r.cle, { ref: e.target.value.toUpperCase(), verifiee: true })}
                                className={`${ctl} w-40 font-bold ${c && !c.ligne && c.resolu !== 'ignorer' ? 'border-[#E8B4AE]' : ''}`} title={r.refLue !== r.ref ? `Lu : ${r.refLue}` : undefined} />
                            </td>
                            <td className="max-w-[260px] truncate px-2 py-1" title={c?.ligne?.designation || ''}>{c?.ligne?.designation || <span className="text-[#B42318]">—</span>}</td>
                            <td className="whitespace-nowrap px-2 py-1 text-center">
                              <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${ETAT_CLS[r.etat]}`}>{ETAT_LIB[r.etat]}{r.qteLue !== null && r.etat !== 'lisible' ? ` ${fmtQte(r.qteLue)}` : ''}</span>
                              {r.doute && <span className="ml-1 text-[11px] font-bold text-[#B4761A]" title="Chiffre incertain : vérifier sur le scan">?</span>}
                            </td>
                            <td className="px-2 py-1 text-center">
                              <input value={r.qte} inputMode="decimal" onChange={(e) => majLigne(r.cle, { qte: e.target.value })}
                                className={`${ctl} w-16 text-center text-[14px] font-bold ${r.doute ? 'border-[#F0D4A6] bg-[#FFFBF3]' : ''}`} />
                            </td>
                            <td className="px-2 py-1">
                              {eqPage.length > 1 && !normaliserEquipe(r.equipe) ? (
                                <select value="" onChange={(e) => majLigne(r.cle, { equipe: e.target.value })} className={`${ctl} w-24 font-bold`}>
                                  <option value="">choisir…</option>
                                  {eqPage.map((x) => <option key={x} value={x}>{x}</option>)}
                                </select>
                              ) : (
                                <input value={r.equipe} placeholder={c?.equipe || (eqPage[0] ?? '')} onChange={(e) => majLigne(r.cle, { equipe: e.target.value.toUpperCase() })}
                                  className={`${ctl} w-24 font-bold`} title="Vide = équipe de la feuille" />
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1 text-right">
                              {c?.existant !== null && c?.existant !== undefined ? <b className="text-[#96600F]">{fmtQte(c.existant)}<span className="ml-1 text-[10.5px] font-semibold">{c.existantEquipe || ''}</span></b> : <span className="text-[#C9C4B6]">—</span>}
                            </td>
                            <td className="px-2 py-1">
                              <select value={r.action} onChange={(e) => majLigne(r.cle, { action: e.target.value as Action })} className={`${ctl} w-36`}>
                                <option value="auto">{c?.resolu === 'hors_liste' ? 'Ajouter hors liste' : c?.existant !== null && c?.existant !== undefined ? 'Ajouter (proposé)' : 'Saisir'}</option>
                                <option value="ajouter">{c && !c.ligne ? 'Ajouter hors liste' : 'Ajouter à l’existant'}</option>
                                <option value="remplacer">Remplacer</option>
                                <option value="ignorer">Ignorer</option>
                              </select>
                            </td>
                            <td className="px-2 py-1 text-right font-bold">{c?.apres !== null && c?.apres !== undefined ? fmtQte(c.apres) : ''}</td>
                            <td className="px-2 py-1">
                              <input value={r.com} onChange={(e) => majLigne(r.cle, { com: e.target.value })} maxLength={300} className={`${ctl} w-full min-w-[160px]`} />
                            </td>
                            <td className="max-w-[340px] px-2 py-1 text-[11.5px]">
                              {c?.verif && c.resolu !== 'ignorer' && (
                                <div className="mb-0.5 font-semibold text-[#B42318]">
                                  {c.verif}
                                  {c.propositions.length > 0 && (
                                    <div className="mt-0.5 flex flex-wrap gap-1">
                                      {c.propositions.map((ref) => (
                                        <button key={ref} type="button" onClick={() => majLigne(r.cle, { ref, verifiee: true })}
                                          className="rounded border border-[#B42318] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#B42318] hover:bg-[#FDF0EF]">→ {ref}</button>
                                      ))}
                                      <button type="button" onClick={() => majLigne(r.cle, { verifiee: true })}
                                        className="rounded border border-[#8A8474] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#5E5A44]">ligne correcte</button>
                                    </div>
                                  )}
                                  {c.propositions.length === 0 && (
                                    <button type="button" onClick={() => majLigne(r.cle, { verifiee: true })}
                                      className="mt-0.5 rounded border border-[#8A8474] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#5E5A44]">ligne correcte</button>
                                  )}
                                </div>
                              )}
                              {c?.erreur ? <span className="font-semibold text-red-700">{c.erreur}</span>
                                : c?.resolu === 'ajouter' || c?.resolu === 'remplacer' ? <span className="font-semibold text-[#96600F]">{c?.resolu === 'ajouter' ? `déjà saisie : ${fmtQte(c?.existant)} + ${r.qte}` : `remplace ${fmtQte(c?.existant)}`}</span>
                                : c?.resolu === 'hors_liste' ? <span className="font-semibold text-[#96600F]">sera ajoutée à la liste</span>
                                : c?.resolu === 'saisir' ? <span className="text-[#2F6F33]">✓ à saisir</span>
                                : <span>{c?.info}</span>}
                            </td>
                          </tr>
                        )
                      })}
                      {lignesVisibles.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-[#8A8474]">Aucune quantité lue sur ces feuilles.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
              {Object.values(listes).map((l) => (
                <datalist key={l.id} id={`inv-refs-${l.id}`}>
                  {l.lignes.map((x) => <option key={x.id} value={x.reference}>{x.designation || ''}</option>)}
                </datalist>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#E5E1D8] bg-white px-4 py-2.5">
              <span className="mr-auto text-[12.5px] text-[#5E5A44]">
                {ecritures.length} référence(s) à enregistrer{stats.horsListe ? ` dont ${stats.horsListe} hors liste` : ''}
                {stats.erreurs > 0 && <span className="font-semibold text-red-700"> · {stats.erreurs} ligne(s) en anomalie non enregistrée(s)</span>}
              </span>
              <button type="button" className={btn} onClick={() => { setPages([]); setLignes([]); setEtape('choix') }}>Recommencer</button>
              <button type="button" disabled={!peutEnregistrer} onClick={() => void enregistrer()}
                title={!peutEnregistrer && ecritures.length ? 'Cocher la vérification des lignes déjà saisies' : ''}
                className="h-10 rounded-lg bg-[#2F6F33] px-4 text-[14px] font-bold text-white disabled:bg-[#B8B3A4]">
                ✓ Valider et enregistrer {ecritures.length} saisie(s)
              </button>
            </div>
          </>
        )}
      </div>

      {imageVue && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/70 p-4" onClick={() => setImageVue(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- page scannée en grand */}
          <img src={imageVue} alt="Page scannée" className="max-w-[min(1600px,100%)] rounded bg-white shadow-2xl" />
        </div>
      )}
    </div>
  )
}
